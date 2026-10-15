/* Offline support for the GitHub Pages site (scope: the whole site).
   Pages and app files: network first, so an online visit always gets the latest build; the copy kept here is used
   when offline (or when the network stalls). Covers, icons and fonts: served from here, refreshed in the background.
   Anything opened once (the shelf, each game or tool, its cover) keeps working without a connection. */
const CACHE = 'pocket-v1';
const SHELL = ['./', 'games/', 'tools/'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function keep(req, res) {
  if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
  return res;
}
async function networkFirst(req) {
  const cached = await caches.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => keep(req, res));
  if (!cached) return net;
  // with a copy on hand, don't let a stalled connection hold the page: fall back after 4 s
  const slow = new Promise(r => setTimeout(() => r(cached), 4000));
  return Promise.race([net.catch(() => cached), slow]);
}
async function staleWhileRevalidate(req) {
  const cached = await caches.match(req);
  const net = fetch(req).then(res => keep(req, res));
  if (cached) { net.catch(() => {}); return cached; }
  return net;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.startsWith(new URL('./', location).pathname)) return;
    e.respondWith(/\.(jpg|png|webp|svg)$/.test(url.pathname) ? staleWhileRevalidate(req) : networkFirst(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
  }
});
