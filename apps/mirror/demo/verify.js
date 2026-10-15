// End-to-end check for 鏡子 (mirror) in real Chromium with a fake front camera.
//  1. no camera request on load, no console errors, no horizontal overflow at 390 px
//  2. tap 開啟鏡子 -> the fake camera feed shows, mirrored (CSS scaleX(-1))
//  3. freeze: the still is the mirror image of the same camera frame, the track is disabled, 已凍結 shows
//  4. two-finger pinch (real touch events) zooms about the midpoint, one-finger pan is clamped (no black edges),
//     double tap toggles 1x <-> 2.5x, max 5x
//  5. 存照片 downloads a JPEG of exactly the visible (zoomed, mirrored) region
//  6. ring light, brightness filter, page hidden -> tracks stopped + 點一下繼續, close stops the camera
//  7. blocked camera (NotAllowedError without a prompt / no mediaDevices) -> website link; 只開補光 works with no camera
// Writes screenshots (demo/*.png, not committed). Usage: node verify.js [--cover]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) { pass++; console.log('  ok  ', name, extra || ''); } else { fail++; console.log('  FAIL', name, extra || ''); } }
function jpegSize(buf) { for (let i = 2; i < buf.length - 9;) { if (buf[i] !== 0xff) return null; const m = buf[i + 1], len = buf.readUInt16BE(i + 2); if (m >= 0xc0 && m <= 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + len; } return null; }

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, permissions: ['camera'] });
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.addInitScript(() => { window.__gum = 0; const md = navigator.mediaDevices, g = md && md.getUserMedia.bind(md); if (g) md.getUserMedia = (...a) => { window.__gum++; return g(...a); }; });
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
  async function pinchGesture(cx, cy, d0, d1, steps = 10) {
    await touch('touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
    for (let i = 1; i <= steps; i++) { const d = d0 + (d1 - d0) * i / steps; await touch('touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await sleep(16); }
    await touch('touchEnd', []);
  }
  async function swipe(x0, y0, x1, y1, steps = 10) {
    await touch('touchStart', [[x0, y0]]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); await sleep(16); }
    await touch('touchEnd', []);
  }
  async function tapAt(x, y) { await touch('touchStart', [[x, y]]); await sleep(40); await touch('touchEnd', []); }
  const covered = () => p.evaluate(() => { const v = document.getElementById('view').getBoundingClientRect(), l = document.getElementById('layer').getBoundingClientRect(); return l.left <= v.left + 0.5 && l.top <= v.top + 0.5 && l.right >= v.right - 0.5 && l.bottom >= v.bottom - 0.5; });
  const zoom = () => p.evaluate(() => window.__mirror.st.z);

  console.log('load');
  await p.goto(url); await sleep(600);
  t('no camera request on load', await p.evaluate(() => window.__gum === 0));
  t('no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  t('welcome card with 開啟鏡子', await p.isVisible('#startBtn'));
  await p.screenshot({ path: path.join(OUT, 'intro.png') });

  console.log('camera');
  await p.click('#startBtn');
  await p.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 8000 });
  await sleep(500);
  const vinfo = await p.evaluate(() => { const v = document.getElementById('video'), c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.drawImage(v, 0, 0, 64, 36); const d = x.getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2]; return { w: v.videoWidth, h: v.videoHeight, mean: s / (d.length / 4) / 3, tf: getComputedStyle(v).transform, stage: !document.getElementById('stage').hidden }; });
  t('fake camera feed is showing', vinfo.stage && vinfo.w > 0 && vinfo.mean > 10, JSON.stringify(vinfo));
  t('live view is mirrored', /^matrix\(-1, 0, 0, 1/.test(vinfo.tf), vinfo.tf);
  t('one getUserMedia call after the tap', await p.evaluate(() => window.__gum === 1));
  await p.screenshot({ path: path.join(OUT, 'live.png') });

  console.log('freeze');
  const fr = await p.evaluate(() => {
    const v = document.getElementById('video'), w = v.videoWidth, h = v.videoHeight, raw = document.createElement('canvas'); raw.width = w; raw.height = h;
    const rx = raw.getContext('2d'); rx.drawImage(v, 0, 0); window.__mirror.freeze();          // same task -> same camera frame
    const still = document.getElementById('still'), A = rx.getImageData(0, 0, w, h).data, B = still.getContext('2d').getImageData(0, 0, w, h).data;
    let diff = 0, n = 0, diffUnflipped = 0;
    for (let y = 0; y < h; y += 5) for (let x = 0; x < w; x += 5) { const i = (y * w + x) * 4, j = (y * w + (w - 1 - x)) * 4;
      for (let k = 0; k < 3; k++) { diff += Math.abs(A[j + k] - B[i + k]); diffUnflipped += Math.abs(A[i + k] - B[i + k]); } n += 3; }
    const st = window.__mirror.st;
    return { diff: diff / n, diffUnflipped: diffUnflipped / n, enabled: st.track.enabled, stillShown: !still.hidden, videoHidden: v.hidden, tag: !document.getElementById('tagFrozen').hidden };
  });
  t('frozen still = mirror image of the camera frame', fr.diff < 3 && fr.diffUnflipped > fr.diff * 3, `mean |Δ| ${fr.diff.toFixed(2)} (unflipped ${fr.diffUnflipped.toFixed(1)})`);
  t('track disabled while frozen', fr.enabled === false && fr.stillShown && fr.videoHidden);
  t('已凍結 label', fr.tag);

  console.log('zoom & pan');
  await pinchGesture(195, 420, 80, 240);
  const z1 = await zoom();
  t('pinch spread 3x -> ~3x', Math.abs(z1 - 3) < 0.25, z1.toFixed(2));
  t('no black edges after pinch', await covered());
  const midOk = await p.evaluate(() => { const s = window.__mirror.st, v = document.getElementById('view').getBoundingClientRect(); return Math.abs((195 - v.left - s.tx) / s.z - (195 - v.left)) < 6 && Math.abs((420 - v.top - s.ty) / s.z - (420 - v.top)) < 6; });
  t('pinch zooms about the fingers', midOk);
  for (let i = 0; i < 3; i++) await swipe(20, 120, 380, 800);
  t('pan to the corner is clamped', await covered() && await p.evaluate(() => window.__mirror.st.tx === 0 && window.__mirror.st.ty === 0));
  await swipe(380, 800, 10, 60); await swipe(380, 800, 10, 60);
  t('pan to the opposite corner is clamped', await covered());
  await pinchGesture(195, 420, 40, 380);
  t('zoom capped at 5x', Math.abs(await zoom() - 5) < 1e-9);
  await p.screenshot({ path: path.join(OUT, 'zoom.png') });

  console.log('save photo');
  const exp = await p.evaluate(() => { const c = window.__mirror.photoCanvas(), s = window.__mirror.st, still = document.getElementById('still'), v = document.getElementById('view');
    // first pixel of the photo must equal the still pixel at the top-left of the view
    const r = v.getBoundingClientRect(), sr = still.getBoundingClientRect(), k = sr.width / still.width;
    const sx = Math.round((r.left - sr.left) / k), sy = Math.round((r.top - sr.top) / k);
    const a = c.getContext('2d').getImageData(2, 2, 1, 1).data, b = still.getContext('2d').getImageData(sx + 2, sy + 2, 1, 1).data;
    return { w: c.width, h: c.height, ar: c.width / c.height, var: r.width / r.height, d: Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) }; });
  t('photo = visible region (aspect of the view)', Math.abs(exp.ar - exp.var) < 0.02, JSON.stringify(exp));
  t('photo pixels match what is on screen (mirrored)', exp.d < 12, 'Δ' + exp.d);
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('#saveBtn')]);
  const jp = path.join(OS_TMP(), dl.suggestedFilename()); await dl.saveAs(jp);
  const buf = fs.readFileSync(jp), js = jpegSize(buf); fs.unlinkSync(jp);
  t('downloads mirror-YYYYMMDD-HHMMSS.jpg', /^mirror-\d{8}-\d{6}\.jpg$/.test(dl.suggestedFilename()) && buf[0] === 0xff && buf[1] === 0xd8, dl.suggestedFilename());
  t('JPEG size = visible region', js && Math.abs(js.w - exp.w) <= 1 && Math.abs(js.h - exp.h) <= 1, JSON.stringify(js));

  console.log('double tap & resume');
  await p.click('#zoomBtn'); await sleep(100);
  t('zoom chip resets to 1x', await zoom() === 1);
  await tapAt(195, 400); await sleep(80); await tapAt(195, 400); await sleep(400);
  t('double tap -> 2.5x', Math.abs(await zoom() - 2.5) < 1e-9);
  await tapAt(195, 400); await sleep(80); await tapAt(195, 400); await sleep(400);
  t('double tap again -> 1x', await zoom() === 1);
  const barsBefore = await p.evaluate(() => document.getElementById('stage').classList.contains('bare'));
  await tapAt(195, 400); await sleep(500);
  t('single tap hides the controls', await p.evaluate(() => document.getElementById('stage').classList.contains('bare')) !== barsBefore);
  await tapAt(195, 400); await sleep(500);
  await p.click('#freezeBtn'); await sleep(300);
  t('繼續 re-enables the live feed', await p.evaluate(() => window.__mirror.st.track.enabled && !document.getElementById('video').hidden && document.getElementById('still').hidden));

  console.log('look');
  await p.click('#ringBtn'); await sleep(200);
  const ring = await p.evaluate(() => ({ inset: parseFloat(document.getElementById('view').style.inset), bg: document.getElementById('frame').style.background }));
  t('ring light frame on', ring.inset > 20 && /255, 255, 255|#fff/i.test(ring.bg), JSON.stringify(ring));
  await p.click('#adjBtn'); await p.fill('#bri', '30'); await p.dispatchEvent('#bri', 'input'); await sleep(100);
  t('brightness filter applied', /brightness\(1\.3\)/.test(await p.evaluate(() => document.getElementById('layer').style.filter)));
  await p.click('#mirSw'); await sleep(100);
  t('mirror switch off -> unflipped', await p.evaluate(() => getComputedStyle(document.getElementById('video')).transform === 'none'));
  await p.click('#mirSw'); await p.fill('#bri', '0'); await p.dispatchEvent('#bri', 'input'); await p.click('#adjBtn');
  t('settings saved to mirror.v1', await p.evaluate(() => JSON.parse(localStorage.getItem('mirror.v1')).ring.on === true));
  await p.click('#ringBtn');

  console.log('page hidden');
  await p.evaluate(() => { window.__trk = window.__mirror.st.track; Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  t('hidden -> camera tracks stopped', await p.evaluate(() => window.__trk.readyState === 'ended' && !window.__mirror.st.stream));
  await p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  t('back -> 點一下繼續, camera not reopened by itself', await p.isVisible('#resume') && await p.evaluate(() => window.__gum === 1));
  await p.click('#resume');
  await p.waitForFunction(() => window.__mirror.st.stream && document.getElementById('video').videoWidth > 0, null, { timeout: 8000 });
  t('tap reopens the camera', true);
  await p.evaluate(() => { window.__trk = window.__mirror.st.track; });
  await p.click('#closeBtn');
  t('關閉 stops the camera', await p.evaluate(() => window.__trk.readyState === 'ended' && !document.getElementById('intro').hidden));
  t('no page errors', errs.length === 0, errs.join(' | '));
  await ctx.close();

  console.log('blocked camera / fill light only');
  for (const [label, init] of [
    ['NotAllowedError without prompt', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); }],
    ['no navigator.mediaDevices', () => { Object.defineProperty(navigator, 'mediaDevices', { value: undefined }); }]]) {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }), q = await c2.newPage(), e2 = [];
    q.on('pageerror', e => e2.push(e.message));
    await q.addInitScript(init); await q.goto(url); await sleep(300);
    await q.click('#startBtn'); await sleep(300);
    t(label + ' -> website link in new tab', await q.getAttribute('#err a', 'href') === 'https://timmango123.github.io/pocket-apps/tools/#mirror' && await q.getAttribute('#err a', 'target') === '_blank', await q.textContent('#err'));
    t(label + ' -> no overflow', await q.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (label.startsWith('NotAllowed')) await q.screenshot({ path: path.join(OUT, 'blocked.png') });
    await q.click('#lightBtn'); await sleep(200);
    t(label + ' -> 只開補光 shows the fill light', await q.isVisible('#fillMsg') && await q.evaluate(() => parseFloat(document.getElementById('view').style.inset) > 20) && !e2.length);
    if (label.startsWith('NotAllowed')) await q.screenshot({ path: path.join(OUT, 'light.png') });
    await c2.close();
  }
  await browser.close();

  if (process.argv.includes('--cover')) {
    // cover: the mirror with the warm ring light on, fed a drawn portrait (fake camera from a y4m file)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-cover-')), png = path.join(tmp, 'face.png'), y4m = path.join(tmp, 'face.y4m');
    const b0 = await chromium.launch(), q0 = await b0.newPage({ viewport: { width: 720, height: 1280 } });
    await q0.setContent(`<body style="margin:0"><svg width="720" height="1280" viewBox="0 0 720 1280" xmlns="http://www.w3.org/2000/svg">
      <defs><radialGradient id="bg" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#e9d8cf"/><stop offset="1" stop-color="#9c8a86"/></radialGradient>
      <linearGradient id="skin" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f3c9a8"/><stop offset="1" stop-color="#e2aa86"/></linearGradient></defs>
      <rect width="720" height="1280" fill="url(#bg)"/>
      <rect x="40" y="120" width="140" height="300" rx="10" fill="#cdb9ae" opacity=".6"/><rect x="560" y="80" width="120" height="420" rx="10" fill="#b9a59c" opacity=".5"/>
      <path d="M120 1280 C150 1010 250 930 360 930 C470 930 570 1010 600 1280Z" fill="#3c5a7a"/>
      <path d="M300 860 h120 v110 c-20 30-100 30-120 0Z" fill="#e2aa86"/>
      <path d="M205 560 C190 330 280 250 360 250 C455 250 535 320 520 560 C520 640 500 700 470 760 L250 760 C220 700 205 640 205 560Z" fill="#3b2a24"/>
      <ellipse cx="360" cy="600" rx="135" ry="175" fill="url(#skin)"/>
      <path d="M225 520 C250 380 330 345 400 360 C460 372 500 420 505 520 C470 450 420 420 360 425 C300 430 250 460 225 520Z" fill="#3b2a24"/>
      <ellipse cx="305" cy="590" rx="16" ry="11" fill="#2b1d18"/><ellipse cx="415" cy="590" rx="16" ry="11" fill="#2b1d18"/>
      <path d="M280 560 q25 -14 50 0 M390 560 q25 -14 50 0" stroke="#3b2a24" stroke-width="7" fill="none" stroke-linecap="round"/>
      <path d="M360 610 q-10 40 6 52" stroke="#c98f6e" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M318 700 q42 30 84 0" stroke="#b35a55" stroke-width="9" fill="none" stroke-linecap="round"/>
      <ellipse cx="282" cy="660" rx="26" ry="14" fill="#f0a593" opacity=".45"/><ellipse cx="438" cy="660" rx="26" ry="14" fill="#f0a593" opacity=".45"/>
      </svg></body>`);
    await q0.screenshot({ path: png }); await b0.close();
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png, '-t', '2', '-r', '15', '-pix_fmt', 'yuv420p', y4m]);
    const b2 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + y4m] });
    const c3 = await b2.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, colorScheme: 'light', permissions: ['camera'] }), q = await c3.newPage();
    await q.goto(url); await q.evaluate(() => localStorage.setItem('mirror.v1', JSON.stringify({ mirrored: true, brightness: 0, contrast: 0, ring: { on: true, width: 9, tone: 'warm' }, facing: 'user' })));
    await q.reload(); await q.click('#startBtn');
    await q.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 8000 }); await sleep(800);
    await q.evaluate(() => window.__mirror.setZoom(1.35, 195, 210)); await sleep(900);
    await q.screenshot({ path: path.join(OUT, 'cover.png') });
    await b2.close(); fs.rmSync(tmp, { recursive: true, force: true });
  }
  srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
function OS_TMP() { return os.tmpdir(); }
