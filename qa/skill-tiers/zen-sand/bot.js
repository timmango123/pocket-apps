// Skill-tier bot for zen-sand (禪意沙畫), a calm sandbox with no fail state.
// Usage: node bot.js [tier ...]  (default all five; env RUNS=n runs per tier, default 2) -> writes results.json
// Harness: real headless Chromium, mobile 390x844 @2x, every action is a real touch event through CDP
// Input.dispatchTouchEvent / page.touchscreen. Real-time rAF (the game animates on performance.now()).
// Bots READ window.__zen (height map, items) to judge their own work like a player looking at the sand, and never call
// a state-changing hook. "Skill" for a sandbox = how cleanly the player rakes an intended pattern, arranges items and
// how many of the game's features they trigger without breaking anything. Each run is a scripted session:
//   1 clear the sample garden (menu)      2 rake N parallel 5-tine lines     3 place three stones on targets, drag one
//   4 rake a ring around a stone          5 two-finger raking               6 smooth-all then undo
//   7 wait for autosave, reload, compare  8 undo the last stroke (↶)          9 今日臨摹: copy the day's pattern, 對照 → stars
//   (clumsy also: second finger, rapid taps, rotate (sand must stay bit-for-bit the same), background)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = __dirname;
const GAME = path.resolve(__dirname, '../../../apps/zen-sand/index.html');
const RUNS = +(process.env.RUNS || 2);

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  speed: 260,  lanes: 4, ring: 48, chaos: true },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  speed: 420,  lanes: 5, ring: 40 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  speed: 650,  lanes: 6, ring: 36 },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, speed: 900,  lanes: 6, ring: 36 },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     speed: 1600, lanes: 6, ring: 36 },
};
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// rAF interval recorder: dropped frames during a stroke show up as long gaps
const INIT = `(() => {
  const gaps = []; let last = 0;
  function tick(t) { if (last) gaps.push(t - last); last = t; requestAnimationFrame(tick); }
  requestAnimationFrame(tick);
  window.__frames = { reset() { gaps.length = 0; }, stats() { if (!gaps.length) return null; const s = gaps.slice().sort((a, b) => a - b); return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1) }; } };
  let hid = false;
  Object.defineProperty(Document.prototype, 'hidden', { get() { return hid; }, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return hid ? 'hidden' : 'visible'; }, configurable: true });
  window.__setHidden = h => { hid = h; document.dispatchEvent(new Event('visibilitychange')); };
})();`;

async function newPage(browser, storage) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, storageState: storage });
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>';
  await ctx.route('**/*', r => r.request().url().startsWith('http://game.test/') ? r.fulfill({ body: html, contentType: 'text/html' }) : r.abort());
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const t0 = Date.now();
  await page.goto('http://game.test/');
  await page.waitForFunction(() => window.__zen && __zen.size().cols > 8);
  const loadMs = Date.now() - t0;
  await sleep(300);
  return { ctx, page, cdp, errors, loadMs };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
async function center(page, sel) { return page.evaluate(s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel); }
const Z = (page, fn, arg) => page.evaluate(fn, arg);

// ---------------- the player ----------------
async function playRun(env, tierId, T, runNo, seed) {
  const r = rng(seed), { page, cdp } = env;
  const log = { run: runNo, seed, loadMs: env.loadMs, events: [], chaos: [] };
  const reactMs = () => Math.max(16, T.react[0] + gauss(r) * T.react[1]);
  const think = async (k = 1) => sleep(reactMs() * k);
  const jitter = () => gauss(r) * T.pos;
  const t0 = Date.now();
  let finger = null;
  const lift = async () => { if (finger) { await touch(cdp, 'touchEnd', []); finger = null; } };
  // tap a control by selector with motor noise; retry up to 3 times until `check` passes (a human looks and taps again)
  async function tapSel(sel, check, name, tries = 3) {
    for (let n = 0; n < tries; n++) {
      await think(0.6);
      const c = await center(page, sel); if (!c) { log.events.push({ t: Date.now() - t0, ev: 'control missing: ' + sel }); return false; }
      const x = Math.min(389, Math.max(1, c.x + jitter() * 0.5)), y = Math.min(843, Math.max(1, c.y + jitter() * 0.5));
      await touch(cdp, 'touchStart', [{ x, y }]); await sleep(40 + Math.abs(gauss(r)) * T.tim); await touch(cdp, 'touchEnd', []);
      await sleep(120);
      if (!check || await page.evaluate(check)) return true;
      log.events.push({ t: Date.now() - t0, ev: 'tap missed: ' + (name || sel) + ' (retry)' });
    }
    return false;
  }
  // drag a path of css points at tier finger speed with Ornstein–Uhlenbeck hand wobble; may slip (mistake)
  async function drag(pts, opts = {}) {
    let nx = 0, ny = 0, slipped = false;
    const sp = T.speed * (1 + gauss(r) * T.tim / 400);
    const start = { x: pts[0][0] + jitter(), y: pts[0][1] + jitter() };
    await touch(cdp, 'touchStart', [{ x: start.x, y: start.y, id: opts.id ?? 0 }]); finger = start;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i], len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.round(len / (sp / 60)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        nx = nx * 0.9 + gauss(r) * T.pos * 0.44; ny = ny * 0.9 + gauss(r) * T.pos * 0.44;
        const x = Math.min(389, Math.max(1, ax + (bx - ax) * t + nx)), y = Math.min(843, Math.max(1, ay + (by - ay) * t + ny));
        await touch(cdp, 'touchMove', [{ x, y, id: opts.id ?? 0 }]); finger = { x, y };
        await sleep(16);
        if (!opts.noSlip && T.mistake && r() < T.mistake / 40) {
          slipped = true; log.events.push({ t: Date.now() - t0, ev: 'mistake: finger slipped off mid-stroke' }); await lift(); await think();
          // the hand comes back down where it lifted, unless that spot is a button (then the stroke just ends there)
          if (!(await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.id === 'c'; }, [x, y]))) return slipped;
          await touch(cdp, 'touchStart', [{ x, y }]); finger = { x, y };
        }
      }
    }
    await lift();
    return slipped;
  }
  async function chaos() {
    if (!T.chaos || r() > 0.3) return;
    const kind = Math.floor(r() * 4);
    if (kind === 0) { // a second finger lands on the sand mid-session
      await touch(cdp, 'touchStart', [{ x: 60 + r() * 270, y: 200 + r() * 400, id: 7 }]); await sleep(150); await touch(cdp, 'touchEnd', []);
      log.chaos.push({ t: Date.now() - t0, ev: 'stray second finger' });
    } else if (kind === 1) {
      const x = 60 + r() * 270, y = 200 + r() * 400;
      for (let k = 0; k < 6; k++) { await touch(cdp, 'touchStart', [{ x: x + gauss(r) * 5, y: y + gauss(r) * 5 }]); await sleep(30); await touch(cdp, 'touchEnd', []); await sleep(30); }
      log.chaos.push({ t: Date.now() - t0, ev: 'rapid taps x6' });
    } else if (kind === 2) {
      const before = await Z(page, () => ({ n: __zen.items().length, m: __zen.maxAbs() }));
      const sig = () => Z(page, () => { const h = __zen.field().h; let s = 0; for (let i = 0; i < h.length; i++) s = (s * 31 + Math.round(h[i] * 1e5)) % 2147483647; return s; });
      const h0 = await sig();
      await page.setViewportSize({ width: 844, height: 390 }); await sleep(400);
      const mid = await Z(page, () => ({ n: __zen.items().length, m: __zen.maxAbs(), W: __zen.size().W, onSand: __zen.items().every(i => i.u > 0 && i.u < 1 && i.v > 0 && i.v < 1) }));
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
      const after = await Z(page, () => ({ n: __zen.items().length, m: __zen.maxAbs(), W: __zen.size().W }));
      after.sandUnchanged = (await sig()) === h0;
      log.chaos.push({ t: Date.now() - t0, ev: 'rotate to 844x390 and back', before, mid, after });
      if (!after.sandUnchanged) log.events.push({ t: Date.now() - t0, ev: 'BUG: rotation changed the sand' });
      if (mid.W !== 844 || after.W !== 390 || after.n !== before.n || !mid.onSand) log.events.push({ t: Date.now() - t0, ev: 'BUG: rotation lost state ' + JSON.stringify({ before, mid, after }) });
    } else {
      await Z(page, () => __setHidden(true)); await sleep(800); await Z(page, () => __setHidden(false)); await sleep(200);
      log.chaos.push({ t: Date.now() - t0, ev: 'background 0.8 s' });
    }
  }

  const size = await Z(page, () => __zen.size());
  const tray = await center(page, '.tray'), topBar = await center(page, '.top');
  const sandTop = topBar.y + topBar.h / 2 + 20, sandBottom = tray.y - tray.h / 2 - 20;
  const rakeW = size.cellPx * 5.2 * 5; // the 5-tine rake's groove band
  const spacing = size.cellPx * 5.2;

  // 1. clear the sample garden through the menu
  log.sampleItems = await Z(page, () => __zen.items().length);
  await tapSel('#bMenu', () => !document.getElementById('menu').hidden, 'menu');
  await tapSel('#aClear', () => document.getElementById('menu').hidden, 'clear');
  await sleep(1200);
  log.cleared = await Z(page, () => ({ items: __zen.items().length, maxAbs: +__zen.maxAbs().toFixed(3) }));
  await chaos();

  // 2. parallel lines: the player wants N evenly spaced 5-tine lines across the open sand
  await tapSel('#mRake', () => __zen.mode() === 'rake', 'rake mode');
  await tapSel('[data-rake="5"]', () => __zen.rake() === 5, '5 tines');
  if (T.mistake && r() < T.mistake) { await tapSel('[data-rake="2"]', () => __zen.rake() === 2); log.events.push({ t: Date.now() - t0, ev: 'mistake: picked the wrong rake, noticed after one line' }); }
  await Z(page, () => __frames.reset());
  const laneYs = []; for (let k = 0; k < T.lanes; k++) laneYs.push(sandTop + rakeW * 0.6 + k * rakeW);
  const lanesDone = [];
  for (let k = 0; k < laneYs.length; k++) {
    const y = laneYs[k];
    if (y > sandBottom - rakeW * 0.4) break;
    await think();
    const ltr = k % 2 === 0;
    await drag(ltr ? [[24, y], [366, y]] : [[366, y], [24, y]]);
    if (k === 0 && (await Z(page, () => __zen.rake())) !== 5) { await tapSel('[data-rake="5"]', () => __zen.rake() === 5); await drag(ltr ? [[24, y], [366, y]] : [[366, y], [24, y]]); }
    lanesDone.push(y);
    if (k === 1) await chaos();
  }
  log.frames = await Z(page, () => __frames.stats());
  // pattern score: along each intended groove, how much of the sand is a groove (h < -0.5)
  log.lines = await Z(page, ({ lanes, spacing }) => {
    let hit = 0, n = 0;
    for (const y of lanes) for (let i = -2; i <= 2; i++) { const gy = y + i * spacing; for (let x = 40; x <= 350; x += 4) { n++; let m = 0; for (let d = -3; d <= 3; d += 1) m = Math.min(m, __zen.heightAt(x, gy + d)); if (m < -0.5) hit++; } }
    return { lanes: lanes.length, coverage: +(hit / n * 100).toFixed(1) };
  }, { lanes: lanesDone, spacing });
  // straightness: the deepest point near each intended groove row, how far it wanders (px σ)
  log.wobble = await Z(page, ({ lanes, spacing }) => {
    const devs = [];
    for (const y of lanes) { const gy = y; for (let x = 40; x <= 350; x += 6) { let best = 0, by = gy; for (let d = -spacing * 0.5; d <= spacing * 0.5; d += 1) { const h = __zen.heightAt(x, gy + d); if (h < best) { best = h; by = gy + d; } } if (best < -0.5) devs.push(by - gy); } }
    if (!devs.length) return null; const m = devs.reduce((a, b) => a + b, 0) / devs.length; return +Math.sqrt(devs.reduce((a, b) => a + (b - m) * (b - m), 0) / devs.length).toFixed(1);
  }, { lanes: lanesDone, spacing });

  // 3. three stones on intended spots, then drag the first to a new spot
  await tapSel('#mPlace', () => __zen.mode() === 'place', 'place mode');
  await tapSel('[data-item="stone"]', () => document.querySelector('[data-item="stone"]').getAttribute('aria-pressed') === 'true');
  const targets = [[110, sandTop + 150], [250, sandTop + 230], [300, sandTop + 110]];
  const placeErr = [];
  for (const [tx, ty] of targets) {
    await think();
    const before = await Z(page, () => __zen.items().length);
    const x = tx + jitter(), y = ty + jitter();
    await touch(cdp, 'touchStart', [{ x, y }]); await sleep(60 + Math.abs(gauss(r)) * T.tim); await touch(cdp, 'touchEnd', []); await sleep(150);
    const st = await Z(page, () => { const it = __zen.items(); const l = it[it.length - 1]; return { n: it.length, x: l ? l.u * innerWidth : 0, y: l ? l.v * innerHeight : 0 }; });
    if (st.n === before + 1) placeErr.push(+Math.hypot(st.x - tx, st.y - ty).toFixed(1));
    else log.events.push({ t: Date.now() - t0, ev: 'stone not placed (tap landed on an item -> selected it) items ' + before + ' -> ' + st.n });
  }
  log.place = { placed: await Z(page, () => __zen.items().filter(i => i.t === 'stone').length), meanErrPx: placeErr.length ? +(placeErr.reduce((a, b) => a + b, 0) / placeErr.length).toFixed(1) : null, errs: placeErr };
  // drag the stone nearest the first target to a new spot
  await think();
  const from = await Z(page, t => { const it = __zen.items().filter(i => i.t === 'stone'); if (!it.length) return null; let b = it[0], bd = 1e9; for (const i of it) { const d = Math.hypot(i.u * innerWidth - t[0], i.v * innerHeight - t[1]); if (d < bd) { bd = d; b = i; } } return { x: b.u * innerWidth, y: b.v * innerHeight, idx: __zen.items().indexOf(b) }; }, targets[0]);
  if (from) {
    const to = [80, sandTop + 320];
    const nBefore = await Z(page, () => __zen.items().length);
    await drag([[from.x, from.y], [to[0], to[1]]], { noSlip: true });
    await sleep(150);
    const after = await Z(page, i => { const it = __zen.items()[i]; return it ? { x: it.u * innerWidth, y: it.v * innerHeight, n: __zen.items().length } : { n: __zen.items().length }; }, from.idx);
    log.move = after.x !== undefined ? { errPx: +Math.hypot(after.x - to[0], after.y - to[1]).toFixed(1), itemsLost: nBefore - after.n } : { errPx: null, itemsLost: nBefore - after.n, note: 'stone vanished during drag' };
    if (log.move.itemsLost > 0) log.events.push({ t: Date.now() - t0, ev: 'item lost while dragging' });
  }
  await chaos();

  // 4. a ring around the second stone with the 3-tine rake
  await tapSel('#mRake', () => __zen.mode() === 'rake');
  await tapSel('[data-rake="3"]', () => __zen.rake() === 3);
  const stone = await Z(page, t => { const it = __zen.items().filter(i => i.t === 'stone'); let b = null, bd = 1e9; for (const i of it) { const d = Math.hypot(i.u * innerWidth - t[0], i.v * innerHeight - t[1]); if (d < bd) { bd = d; b = i; } } return b ? { x: b.u * innerWidth, y: b.v * innerHeight, s: b.s } : null; }, targets[1]);
  if (stone) {
    const R = stone.s * 0.72 + 7 + T.ring, pts = [];
    const a0 = r() * Math.PI * 2;
    for (let a = 0; a <= 64; a++) { const th = a0 + a / 64 * Math.PI * 2; pts.push([stone.x + Math.cos(th) * R, stone.y + Math.sin(th) * R]); }
    await think();
    await drag(pts);
    log.ring = await Z(page, ({ x, y, R, s }) => {
      let hit = 0, n = 0, under = 0, un = 0;
      for (let a = 0; a < 72; a++) { const th = a / 72 * Math.PI * 2; n++; let m = 0; for (let d = -4; d <= 4; d += 1) m = Math.min(m, __zen.heightAt(x + Math.cos(th) * (R + d), y + Math.sin(th) * (R + d))); if (m < -0.5) hit++; }
      for (let a = 0; a < 36; a++) { const th = a / 36 * Math.PI * 2, rr = s * 0.5; un++; if (Math.abs(__zen.heightAt(x + Math.cos(th) * rr, y + Math.sin(th) * rr)) > 0.1) under++; }
      return { coverage: +(hit / n * 100).toFixed(1), disturbedUnderStone: +(under / un * 100).toFixed(1) };
    }, { x: stone.x, y: stone.y, R, s: stone.s });
  }

  // 5. two fingers at once, each raking its own line
  await tapSel('[data-rake="1"]', () => __zen.rake() === 1);
  await think();
  {
    const y1 = sandBottom - 120, y2 = sandBottom - 60;
    const a = { x: 40 + jitter(), y: y1 + jitter(), id: 1 }, b = { x: 40 + jitter(), y: y2 + jitter(), id: 2 };
    await touch(cdp, 'touchStart', [a]); await sleep(30 + Math.abs(gauss(r)) * T.tim); await touch(cdp, 'touchStart', [a, b]);
    const steps = Math.round(300 / (T.speed / 60));
    for (let s = 1; s <= steps; s++) { a.x = 40 + 300 * s / steps + gauss(r) * T.pos * 0.3; b.x = 40 + 300 * s / steps + gauss(r) * T.pos * 0.3; await touch(cdp, 'touchMove', [a, b]); await sleep(16); }
    await touch(cdp, 'touchEnd', []); await sleep(100);
    // judged where each finger actually travelled (its start row, hand wobble is small along a short line)
    log.twoFingers = await Z(page, ({ y1, y2, pos }) => {
      const cov = y => { let hit = 0, n = 0; for (let x = 70; x <= 310; x += 4) { n++; let m = 0; for (let d = -Math.max(4, pos * 0.6); d <= Math.max(4, pos * 0.6); d++) m = Math.min(m, __zen.heightAt(x, y + d)); if (m < -0.5) hit++; } return +(hit / n * 100).toFixed(1); };
      return { line1: cov(y1), line2: cov(y2) };
    }, { y1: a.y, y2: b.y, pos: T.pos });
    if (log.twoFingers.line1 < 50 || log.twoFingers.line2 < 50) log.events.push({ t: Date.now() - t0, ev: 'multi-touch: a finger was dropped ' + JSON.stringify(log.twoFingers) });
  }

  // 6. smooth everything, then change their mind
  const beforeSmooth = await Z(page, () => ({ m: +__zen.maxAbs().toFixed(3), h: +__zen.heightAt(200, 300).toFixed(3), n: __zen.items().length }));
  await tapSel('#mSmooth', () => __zen.smoothing() || __zen.maxAbs() < 0.02, 'smooth');
  await sleep(1300);
  const flat = await Z(page, () => +__zen.maxAbs().toFixed(3));
  await think(1.5);
  const undone = await tapSel('#toastBtn', () => document.getElementById('toast').hidden, 'undo');
  await sleep(200);
  const afterUndo = await Z(page, () => ({ m: +__zen.maxAbs().toFixed(3), h: +__zen.heightAt(200, 300).toFixed(3), n: __zen.items().length }));
  log.smooth = { flat, undone, restored: undone && Math.abs(afterUndo.h - beforeSmooth.h) < 0.02 && afterUndo.n === beforeSmooth.n, before: beforeSmooth, after: afterUndo };
  if (flat > 0.02) log.events.push({ t: Date.now() - t0, ev: 'BUG: smooth-all left sand uneven ' + flat });
  if (undone && !log.smooth.restored) log.events.push({ t: Date.now() - t0, ev: 'BUG: undo did not restore ' + JSON.stringify({ beforeSmooth, afterUndo }) });

  // 7. autosave then reload: the garden should come back exactly
  await sleep(1600);
  const snap = await Z(page, () => ({ n: __zen.items().length, items: __zen.items().map(i => [i.t, +i.u.toFixed(4), +i.v.toFixed(4)]), h: [[200, 300], [100, 500], [300, 650], [60, 250]].map(p => +__zen.heightAt(p[0], p[1]).toFixed(2)), m: +__zen.maxAbs().toFixed(2) }));
  await page.reload(); await page.waitForFunction(() => window.__zen && __zen.size().cols > 8); await sleep(400);
  const back = await Z(page, () => ({ n: __zen.items().length, items: __zen.items().map(i => [i.t, +i.u.toFixed(4), +i.v.toFixed(4)]), h: [[200, 300], [100, 500], [300, 650], [60, 250]].map(p => +__zen.heightAt(p[0], p[1]).toFixed(2)), m: +__zen.maxAbs().toFixed(2), sample: __zen.sample() }));
  const hOk = snap.h.every((v, i) => Math.abs(v - back.h[i]) < 0.03);
  log.save = { ok: !back.sample && back.n === snap.n && hOk && JSON.stringify(snap.items) === JSON.stringify(back.items), before: snap, after: back };
  if (!log.save.ok) log.events.push({ t: Date.now() - t0, ev: 'BUG: save/restore mismatch' });

  // 8. undo the last stroke: one line too many, take it back with ↶
  await tapSel('#mRake', () => __zen.mode() === 'rake');
  await tapSel('[data-rake="5"]', () => __zen.rake() === 5);
  {
    const y = sandTop + 60, probe = () => Z(page, y => { let m = 0; for (let x = 120; x <= 270; x += 6) for (let d = -14; d <= 14; d += 2) m = Math.min(m, __zen.heightAt(x, y + d)); return m; }, y);
    const before = await Z(page, () => __zen.field().h.slice(0)), undos = await Z(page, () => __zen.undoCount());
    await think(); await drag([[30, y], [360, y]], { noSlip: true }); await sleep(120);
    const raked = await probe();
    await tapSel('#mUndo', null, 'undo');
    await sleep(150);
    const same = await Z(page, b => { const h = __zen.field().h; let m = 0; for (let i = 0; i < h.length; i++) m = Math.max(m, Math.abs(h[i] - b[i])); return m; }, Array.from(before));
    log.undoStroke = { raked: +raked.toFixed(2), restoredMaxDiff: +same.toFixed(4), ok: raked < -0.5 && same < 1e-6 };
    if (!log.undoStroke.ok) log.events.push({ t: Date.now() - t0, ev: 'BUG: undo of the last stroke did not restore ' + JSON.stringify(log.undoStroke) });
  }

  // 9. 今日臨摹: open today's pattern, copy it stroke by stroke with this tier's hand, then 對照 for stars
  await tapSel('#bMenu', () => !document.getElementById('menu').hidden, 'menu', 6); // a person keeps tapping until the menu opens
  await tapSel('#aDaily', () => !document.getElementById('daily').hidden, 'daily', 6);
  await sleep(300);
  const plan = await Z(page, () => __zen.dailyPlan());
  if (plan) {
    await tapSel('#dRef', () => __zen.ghost(), 'show pattern'); // look at the pattern over the sand while copying
    await tapSel('#mRake', () => __zen.mode() === 'rake');
    await tapSel('[data-rake="5"]', () => __zen.rake() === 5);
    const t1 = Date.now();
    for (const st of plan.strokes) { await think(0.6); await drag(st.pts.map(p => [Math.min(388, Math.max(2, p[0])), p[1]])); }
    await tapSel('#dCheck', () => !document.getElementById('res').hidden, 'check');
    await sleep(200);
    const sc = await Z(page, () => __zen.lastScore());
    log.daily = { pattern: plan.name, strokes: plan.strokes.length, stars: sc ? sc.stars : null, score: sc ? +(sc.score * 100).toFixed(1) : null, missed: sc ? +(sc.detail.missed * 100).toFixed(0) : null, turned: sc ? +(sc.detail.turned * 100).toFixed(0) : null, copyS: +((Date.now() - t1) / 1000).toFixed(1) };
    await tapSel('#resClose', () => document.getElementById('res').hidden, 'close result');
  } else log.events.push({ t: Date.now() - t0, ev: 'gave up: could not open 今日臨摹 (taps kept missing)' });
  log.wallMs = Date.now() - t0;
  return log;
}

async function main() {
  const tiers = process.argv.slice(2).filter(a => TIERS[a]);
  const run = tiers.length ? tiers : Object.keys(TIERS);
  const resPath = path.join(OUT, process.env.OUTFILE || 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : { game: 'zen-sand', harness: {}, tiers: {}, findings: [] };
  results.harness = { viewport: '390x844@2 touch', runs: RUNS, note: 'real-time rAF; touch via CDP; sandbox scored on pattern fidelity, placement error, feature coverage, save/restore' };
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  for (const tierId of run) {
    const T = TIERS[tierId], runs = [];
    for (let n = 1; n <= RUNS; n++) {
      const env = await newPage(browser);
      let log;
      try { log = await playRun(env, tierId, T, n, 1000 * n + tierId.length * 17); }
      catch (e) { log = { run: n, crashed: String(e).slice(0, 300) }; }
      log.errors = env.errors.slice(0, 5); if (!log.errors.length) delete log.errors;
      await env.ctx.close();
      console.log(tierId, 'run', n, 'lines', log.lines && log.lines.coverage + '%', 'wobble', log.wobble, 'place', log.place && log.place.meanErrPx, 'ring', log.ring && log.ring.coverage + '%', 'two', log.twoFingers && JSON.stringify(log.twoFingers), 'save', log.save && log.save.ok, 'undo', log.undoStroke && log.undoStroke.ok, 'daily', log.daily && (log.daily.stars + '★ ' + log.daily.score + '%'), 'frames', log.frames && JSON.stringify(log.frames), 'wall', log.wallMs, log.events && log.events.length ? 'events ' + log.events.length : '', log.errors ? 'ERRORS ' + log.errors[0] : '');
      runs.push(log);
    }
    const ok = runs.filter(x => !x.crashed);
    const avg = f => { const v = ok.map(f).filter(x => typeof x === 'number'); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };
    results.tiers[tierId] = { runs, summary: {
      lineCoverage: avg(x => x.lines && x.lines.coverage), wobblePx: avg(x => x.wobble), placeErrPx: avg(x => x.place && x.place.meanErrPx), stonesPlaced: avg(x => x.place && x.place.placed),
      moveErrPx: avg(x => x.move && x.move.errPx), ringCoverage: avg(x => x.ring && x.ring.coverage), underStoneDisturbed: avg(x => x.ring && x.ring.disturbedUnderStone),
      twoFingerMin: avg(x => x.twoFingers && Math.min(x.twoFingers.line1, x.twoFingers.line2)), undoRestored: ok.every(x => x.smooth && x.smooth.restored), saveRestored: ok.every(x => x.save && x.save.ok),
      undoStrokeOk: ok.every(x => x.undoStroke && x.undoStroke.ok), dailyStars: avg(x => x.daily && x.daily.stars), dailyScore: avg(x => x.daily && x.daily.score), dailyStarsEach: ok.map(x => x.daily ? x.daily.stars : null),
      rotationsSandUnchanged: ok.reduce((a, x) => a.concat((x.chaos || []).filter(c => c.after && 'sandUnchanged' in c.after).map(c => c.after.sandUnchanged)), []),
      frameMeanMs: avg(x => x.frames && x.frames.mean), frameP95Ms: avg(x => x.frames && x.frames.p95), frameMaxMs: avg(x => x.frames && x.frames.max), loadMs: avg(x => x.loadMs),
      events: ok.reduce((a, x) => a + (x.events ? x.events.length : 0), 0), bugs: ok.reduce((a, x) => a.concat((x.events || []).filter(e => /BUG|lost|dropped|mismatch/.test(e.ev)).map(e => e.ev)), []), errors: runs.reduce((a, x) => a.concat(x.errors || []), []), crashed: runs.filter(x => x.crashed).length, wallS: avg(x => x.wallMs / 1000) } };
    fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  }
  await browser.close();
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { newPage, TIERS, touch };
