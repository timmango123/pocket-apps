// Verification for 森林糖果樹屋 (rope-cut).
// 1) Node: loads the game's own physics core (CORE-START/END) and all 100 embedded levels, re-simulates every level's
//    stored solution (fixed step 1/120 s), checks: win with 3 stars, every op is necessary, and each op's timing window
//    (others fixed; scanned on a 50 ms grid, edges refined to 1 step) is >= 3 consecutive grid points / >= 150 ms.
//    Also recomputes the spec difficulty D = ops x (1/window) x kinds^0.5 x (spikes+1)^0.3 and checks it strictly rises.
// 2) Browser: an auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP
//    Input.dispatchTouchEvent): it taps to start, then swipes across the vines / taps gadgets at the solution's times.
//    Actions are >= 300 ms apart (first >= 500 ms after start). Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT || __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {normLevel, simulate, solved3, DT};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const OPN = ['切', '戳泡泡', '吹風', '翻重力'];

function measure(L, ops, k) {
  const s0 = ops[k][0];
  const lo = k > 0 ? ops[k - 1][0] + 12 : 48, hi = k < ops.length - 1 ? ops[k + 1][0] - 12 : s0 + 400;
  const test = s => { if (s < lo || s > hi) return false; const o = ops.map(x => x.slice()); o[k][0] = s; return C.solved3(L, o, 2600); };
  let a = 0, b = 0;
  while (a < 78 && test(s0 - a - 6)) a += 6;
  while (b < 78 && test(s0 + b + 6)) b += 6;
  let l = s0 - a, r = s0 + b;
  if (a < 78) for (let d = 1; d < 6; d++) { if (test(s0 - a - d)) l = s0 - a - d; else break; }
  if (b < 78) for (let d = 1; d < 6; d++) { if (test(s0 + b + d)) r = s0 + b + d; else break; }
  return { coarse: 1 + a / 6 + b / 6, win: (r - l + 1) * C.DT };
}
function solveAll() {
  let ok = true, prevD = 0, prevd = 0, minWinAll = 9, minCoarse = 99;
  const rows = [];
  for (let n = 1; n <= LEVELS.length; n++) {
    const L = C.normLevel(JSON.parse(JSON.stringify(LEVELS[n - 1])));
    const ops = L.sol;
    const W = C.simulate(L, ops, 2600);
    const win3 = W.status === 1 && W.nst === 3;
    const needed = ops.every((_, k) => !C.solved3(L, ops.filter((__, j) => j !== k), 2600));
    const ms = ops.map((_, k) => measure(L, ops, k));
    const minWin = Math.min(...ms.map(m => m.win)), coarse = Math.min(...ms.map(m => m.coarse));
    const kinds = 1 + (L.b.length > 0) + (L.w.length > 0) + (L.k.length > 0) + (L.a.length > 0) + (L.p.length > 0) + (L.r.some(r => r.length > 3)) + (!!L.g) + (L.h.length > 0);
    const D = ops.length / minWin * Math.sqrt(kinds) * Math.pow(L.k.length + 1, 0.3);
    const gapOk = ops[0][0] >= 60 && ops.every((o, k) => k === 0 || o[0] - ops[k - 1][0] >= 36);
    const good = win3 && needed && coarse >= 3 && minWin >= 0.15 && D > prevD && L.d > prevd && gapOk;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', { win3, needed, coarse, minWin, D, prevD, d: L.d, gapOk }); }
    prevD = D; prevd = L.d; minWinAll = Math.min(minWinAll, minWin); minCoarse = Math.min(minCoarse, coarse);
    rows.push({ n, ops: ops.length, minWin, coarse, kinds, spikes: L.k.length, D, d: L.d, end: W.t * C.DT, sol: ops });
  }
  console.log('All', LEVELS.length, 'levels: 3-star solution re-simulated, every op necessary, windows >= 150 ms, difficulty strictly increasing:', ok);
  console.log('  narrowest op window over all levels:', (minWinAll * 1000).toFixed(0) + ' ms; fewest consecutive 50 ms grid points:', minCoarse);
  for (const n of [1, 10, 25, 50, 75, 99, 100]) {
    const r = rows[n - 1];
    console.log('  L' + n, 'difficulty', r.d, 'D', r.D.toFixed(2), 'ops', r.ops, 'key window', (r.minWin * 1000).toFixed(0) + 'ms', 'kinds', r.kinds, 'spikes', r.spikes, 'clear at', r.end.toFixed(1) + 's');
  }
  return rows;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, type, x, y) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 6, radiusY: 6, force: 1 }] }); }
async function tapAt(cdp, x, y) { await touch(cdp, 'touchStart', x, y); await sleep(50); await touch(cdp, 'touchEnd'); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapAt(cdp, b.x + b.width / 2, b.y + b.height / 2); }
function segX(a, b, c, d) {
  const r1x = b[0] - a[0], r1y = b[1] - a[1], r2x = d[0] - c[0], r2y = d[1] - c[1], den = r1x * r2y - r1y * r2x;
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * r2y - (c[1] - a[1]) * r2x) / den, u = ((c[0] - a[0]) * r1y - (c[1] - a[1]) * r1x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
// pick a swipe across rope i that crosses no other vine and doesn't start on a tappable gadget
function planSwipe(segs, taps, i, sc) {
  const me = segs.find(s => s.rope === i); if (!me) return null;
  for (const f of [0.3, 0.2, 0.4, 0.5, 0.15, 0.6, 0.7, 0.8]) for (const len of [36, 28, 48, 22]) {
    const k = Math.min(me.p.length - 2, Math.max(0, Math.round(f * (me.p.length - 1))));
    const P = me.p[k], Q = me.p[k + 1];
    const dx = Q[0] - P[0], dy = Q[1] - P[1], dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
    const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
    const A = [mx - nx * len, my - ny * len], B = [mx + nx * len, my + ny * len];
    let bad = false;
    for (const s of segs) { if (s.rope === i) continue; for (let j = 0; j < s.p.length - 1 && !bad; j++) if (segX(A, B, s.p[j], s.p[j + 1])) bad = true; }
    if (bad) continue;
    const clear = P => taps.every(t => Math.hypot(t[0] - P[0], t[1] - P[1]) >= 40 * sc);
    if (clear(A)) return [A, B];
    if (clear(B)) return [B, A];
  }
  return null;
}
async function gstate(page) { return page.evaluate(() => window.__game.state()); }

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1000); await tapSel(cdp, page, '#iOk'); await sleep(500); }
  await sleep(900); // look at the level
  await tapAt(cdp, 195, 780); // tap anywhere: start the clock
  const landed = [];
  let lastAct = Date.now();
  let bias = 8; // input latency in sim steps, learned from how late the previous actions landed
  for (let k = 0; k < sol.length; k++) {
    const [step, type, idx] = sol[k];
    const lead = Math.round(bias) + (type === 0 ? 1 : 0);
    let st = await gstate(page);
    while (st.t < step - lead && st.status === 0) { if (step - lead - st.t > 30) await sleep(60); st = await gstate(page); }
    if (Date.now() - lastAct < 150) await sleep(150 - (Date.now() - lastAct)); // never faster than human reaction
    if (type === 0) {
      const info = await page.evaluate(() => ({ segs: window.__game.ropeSegs(), taps: window.__game.tappables(), sc: window.__game.scale() }));
      const sw = planSwipe(info.segs, info.taps, idx, info.sc);
      if (!sw) { landed.push([step, 'no-swipe', idx, JSON.stringify(info.segs.map(q => [q.rope, q.p.length, q.p[0].map(Math.round), q.p[q.p.length - 1].map(Math.round)])), JSON.stringify(info.taps.map(t => t.map(Math.round)))]); continue; }
      const [A, B] = sw;
      await touch(cdp, 'touchStart', A[0], A[1]);
      for (let m = 1; m <= 3; m++) await touch(cdp, 'touchMove', A[0] + (B[0] - A[0]) * m / 3, A[1] + (B[1] - A[1]) * m / 3);
      await touch(cdp, 'touchEnd');
    } else {
      const p = await page.evaluate(([t, j]) => window.__game.tapPos(t, j), [type, idx]);
      await touch(cdp, 'touchStart', p[0], p[1]); await sleep(40); await touch(cdp, 'touchEnd');
    }
    lastAct = Date.now();
    await sleep(30);
    const lg = (await gstate(page)).ops;
    if (lg.length > k) bias = Math.max(0, Math.min(24, bias + (lg[k][0] - step) * 0.7));
  }
  let st = await gstate(page);
  for (let w = 0; w < 200 && st.status === 0; w++) { await sleep(50); st = await gstate(page); }
  await sleep(2600);
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const ops = st.ops;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const offs = ops.map((o, k) => sol[k] ? o[0] - sol[k][0] : null);
  if (landed.length) console.log('  missed actions', JSON.stringify(landed));
  return { n, cleared: st.status === 1 && winVisible, stars: st.nst, ops: ops.length, need: sol.length, offsetsSteps: offs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const rows = solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    let r;
    for (let attempt = 1; attempt <= 3; attempt++) {
      r = await playLevel(browser, n, rows[n - 1].sol);
      r.attempt = attempt;
      if (r.cleared && r.stars === 3) break;
    }
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'stars', r.stars, 'ops', r.ops + '/' + r.need, 'timing offsets (steps of 1/120 s)', JSON.stringify(r.offsetsSteps), 'attempt', r.attempt, 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
