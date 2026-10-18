// Shared skill-tier harness (copied per game folder). Real headless Chromium, mobile context, CDP touch input.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, timing: 120, mistake: 0.15,  think: [1300, 450], attempts: 5 },
  casual:     { name: '普通', react: [400, 100], pos: 20, timing: 60,  mistake: 0.06,  think: [700, 250],  attempts: 3 },
  skilled:    { name: '熟練', react: [260, 50],  pos: 10, timing: 30,  mistake: 0.02,  think: [420, 140],  attempts: 3 },
  world:      { name: '世界級', react: [180, 25], pos: 4,  timing: 12,  mistake: 0.003, think: [220, 70],   attempts: 3 },
  superhuman: { name: '非人', react: [16, 0],    pos: 0,  timing: 0,   mistake: 0,     think: [0, 0],      attempts: 3 },
};
const TIER_IDS = Object.keys(TIERS);

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeRng(seed) {
  const r = mulberry32(seed);
  r.gauss = (m = 0, s = 1) => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  r.int = n => Math.floor(r() * n);
  r.pick = a => a[Math.floor(r() * a.length)];
  return r;
}
const sleep = ms => new Promise(res => setTimeout(res, Math.max(0, ms)));

async function launch() { return chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); }

async function newSession(browser, url, init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  // Single-file apps that are HTML fragments (no doctype / viewport meta) get the document skeleton the hosting
  // page adds at publish time; without it a mobile browser lays the page out at 980 px and zooms out.
  if (url.startsWith('file://')) {
    const fs = require('fs'), file = decodeURIComponent(url.slice(7));
    const src = fs.readFileSync(file, 'utf8');
    if (!/<!doctype/i.test(src.slice(0, 200))) {
      const WRAP = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>';
      await page.route(url, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: WRAP + src + '</body></html>' }));
    }
  }
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.stack || e).slice(0, 400)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(url);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

class Player {
  constructor(sess, tierId, seed) {
    Object.assign(this, sess);
    this.tierId = tierId; this.t = TIERS[tierId]; this.rng = makeRng(seed);
    this.stats = { taps: 0, swipes: 0, mistakes: 0 };
  }
  get superhuman() { return this.tierId === 'superhuman'; }
  reactMs() { const [m, s] = this.t.react; return Math.max(16, this.rng.gauss(m, s)); }
  thinkMs(scale = 1) { const [m, s] = this.t.think; return m ? Math.max(0, this.rng.gauss(m, s)) * scale : 0; }
  timingErr() { return this.t.timing ? this.rng.gauss(0, this.t.timing) : 0; }
  mistake() { const m = this.rng() < this.t.mistake; if (m) this.stats.mistakes++; return m; }
  jitter(x, y) { const s = this.t.pos; return s ? [x + this.rng.gauss(0, s), y + this.rng.gauss(0, s)] : [x, y]; }
  async touch(type, pts) { await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); }
  // tap with positional noise; hold ~60-110ms (superhuman: one frame)
  async tap(x, y, opts = {}) {
    const [jx, jy] = opts.exact ? [x, y] : this.jitter(x, y);
    this.stats.taps++;
    await this.touch('touchStart', [{ x: jx, y: jy, id: 1 }]);
    await sleep(this.superhuman ? 16 : 60 + Math.abs(this.rng.gauss(0, 25)));
    await this.touch('touchEnd', []);
    return [jx, jy];
  }
  // swipe from (x,y) by vector (dx,dy); noise on start and end; returns actual vector
  async swipe(x, y, dx, dy, opts = {}) {
    const [sx, sy] = opts.exact ? [x, y] : this.jitter(x, y);
    const [ex, ey] = opts.exact ? [x + dx, y + dy] : this.jitter(sx + dx, sy + dy);
    const steps = opts.steps || 6, stepMs = this.superhuman ? 8 : 16;
    this.stats.swipes++;
    await this.touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
    for (let i = 1; i <= steps; i++) {
      await sleep(stepMs);
      await this.touch('touchMove', [{ x: sx + (ex - sx) * i / steps, y: sy + (ey - sy) * i / steps, id: 1 }]);
    }
    await this.touch('touchEnd', []);
    return [ex - sx, ey - sy];
  }
  async tapSelector(sel) {
    const b = await this.page.locator(sel).first().boundingBox();
    if (!b) return false;
    // buttons: noise is clamped a bit (people aim at buttons more carefully)
    const s = Math.min(this.t.pos, Math.min(b.width, b.height) / 3);
    const x = b.x + b.width / 2 + (s ? this.rng.gauss(0, s) : 0), y = b.y + b.height / 2 + (s ? this.rng.gauss(0, s) : 0);
    await this.tap(x, y, { exact: true });
    return true;
  }
}

function summarize(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
  return { n: s.length, min: s[0], median: q(0.5), mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), max: s[s.length - 1] };
}

module.exports = { TIERS, TIER_IDS, makeRng, sleep, launch, newSession, Player, summarize };
