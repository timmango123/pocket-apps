// Skill-tier harness for 彈幕射擊 (bullet-hell). Real headless Chromium, mobile context (390×844, DPR 2, touch),
// lock-stepped clock: the harness drives requestAnimationFrame at 16.67 ms per frame so every tier sees the same
// deterministic game regardless of the machine's rendering speed (software rendering here runs far below 60 fps).
// Math.random is seeded per run. Bots read window.__game.state() (read-only) and act only through CDP touch events:
// one finger dragging anywhere (relative movement), a second finger held for focus, taps on the 炸彈 button.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
// BH_SRC lets a sweep run against a frozen copy of the game while the real file is being edited
const SRC = process.env.BH_SRC || path.resolve(__dirname, '../../../apps/bullet-hell/index.html');
const FRAME = 1000 / 60;

const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, timing: 120, mistake: 0.15,  every: 12, policy: 'clumsy', pred: 0.5, speed: 600,  margin: 2, H: 0.35, focusBoss: false, bombThr: 6, bombP: 0.3 },
  casual:     { name: '普通', react: [400, 100], pos: 20, timing: 60,  mistake: 0.06,  every: 8,  policy: 'greedy', pred: 0.8, speed: 900,  margin: 3, H: 0.45, focusBoss: false, bombThr: 4, bombP: 0.6 },
  skilled:    { name: '熟練', react: [260, 50],  pos: 10, timing: 30,  mistake: 0.02,  every: 5,  policy: 'look2',  pred: 1,   speed: 1200, margin: 4, H: 0.6,  focusBoss: true,  bombThr: 2.5, bombP: 0.85 },
  world:      { name: '世界級', react: [180, 25], pos: 4,  timing: 12,  mistake: 0.003, every: 3,  policy: 'search', pred: 1,   speed: 1600, margin: 4, H: 0.8,  focusBoss: true,  bombThr: 1.5, bombP: 0.97, fine: true },
  superhuman: { name: '非人', react: [16, 0],    pos: 0,  timing: 0,   mistake: 0,     every: 1,  policy: 'perfect', pred: 1,  speed: 2000, margin: 3, H: 0.8,  focusBoss: true,  bombThr: 0.9, bombP: 1, fine: true, exact: true },
};
const TIER_IDS = Object.keys(TIERS);
const DIFFS = ['簡單', '普通', '困難', '地獄'];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeRng(seed) {
  const r = mulberry32(seed);
  r.gauss = (m = 0, s = 1) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return r;
}

// Runs before the page's own scripts: seeded Math.random, fake clock, rAF queue stepped by window.__step(n, record).
// Canvas drawing is thinned to one frame in 30 (the game logic does not depend on rendering).
const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  try { localStorage.setItem('bullet-hell:v1:mute', 'true'); } catch (e) {}
  let q = [], fakeT = 1000;
  window.__errs = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => fakeT;
  let fc = 0; const P = CanvasRenderingContext2D.prototype;
  for (const m of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText','clearRect']) { const o = P[m]; P[m] = function () { if (fc % 30 === 0) return o.apply(this, arguments); }; }
  window.__step = (n, rec) => {
    for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = [];
      for (const cb of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e).slice(0, 300)); } } }
    return rec && window.__game ? window.__game.state() : null; };
})();`;

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rsp.end(fs.readFileSync(SRC, 'utf8'));
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
async function launch() { return chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }); }

async function newSession(browser, url, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(INIT(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.stack || e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(url);
  await page.evaluate(() => window.__step(3));
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

// Touch helpers. Finger 1 = movement drag, finger 2 = focus hold, taps on buttons use a throw-away id.
// CDP semantics (checked against pointer events): touchStart/touchMove list every active point; touchEnd lists the
// points being LIFTED (an empty list lifts everything). Getting this wrong lifts the drag finger instead of the tap
// finger, or turns a re-grip into a jump of the drag finger, so each helper names exactly the finger it lifts.
class Hands {
  constructor(cdp) { this.cdp = cdp; this.f1 = null; this.f2 = null; }
  pts() { const p = []; if (this.f1) p.push({ ...this.f1, id: 1 }); if (this.f2) p.push({ ...this.f2, id: 2 }); return p; }
  async send(type, pts) { await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); }
  async down1(x, y) { this.f1 = { x, y }; await this.send('touchStart', this.pts()); }
  async move1(x, y) { this.f1 = { x, y }; await this.send('touchMove', this.pts()); }
  async up1() { if (!this.f1) return; const f = { ...this.f1, id: 1 }; this.f1 = null; await this.send('touchEnd', [f]); }
  async down2(x, y) { if (this.f2) return; this.f2 = { x, y }; await this.send('touchStart', this.pts()); }
  async up2() { if (!this.f2) return; const f = { ...this.f2, id: 2 }; this.f2 = null; await this.send('touchEnd', [f]); }
  async tap(x, y) { const t = { x, y, id: 7 }; await this.send('touchStart', this.pts().concat([t])); await this.send('touchEnd', [t]); }
  async release() { const p = this.pts(); this.f1 = this.f2 = null; if (p.length) await this.send('touchEnd', p); }
}

function summarize(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, min: s[0], median: q(0.5), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), max: s[s.length - 1] };
}

module.exports = { TIERS, TIER_IDS, DIFFS, FRAME, makeRng, serve, launch, newSession, Hands, summarize };
