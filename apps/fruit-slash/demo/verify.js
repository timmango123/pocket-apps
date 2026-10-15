// End-to-end check for 果園快刀 (fruit-slash).
// 1) Runs check-waves.js (generator guarantees, using the game's own CORE code).
// 2) Loads the real page in Chromium (390x844, touch), starts Classic by slicing the 「開始」 watermelon with a
//    real CDP touch swipe, then an auto-player plays at human pace: every >=150 ms it reads fruit positions, plans one
//    stroke (a straight line or a short polyline through fruits) that keeps clear of every chestnut, and executes it as
//    real touch events (~3.2 px/ms, one or two fingers). After 180 s it stops slicing so the run ends and the result screen shows.
//    Records demo/run.mp4 and demo/run-result.png.  Usage: [DPR=1] [DBG=1] node verify.js [seconds=180]
//    DPR defaults to 1 because headless Chromium rasterises in software: at DPR 2 on a shared, busy machine the page
//    drops to ~25 fps and touch delivery lags 200+ ms. Layout/visual checks at DPR 2 are done separately.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const PLAY_SECS = +(process.argv[2] || 180);
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(execFileSync(process.execPath, [path.join(__dirname, 'check-waves.js')]).toString());

const SPEED = 3.2;      // px per ms while swiping (a brisk human slash)
let LATENCY = 60;       // ms from snapshot to the first touch reaching the page (measured, see lag below)
let lag = 40;           // running estimate of CDP dispatch -> page delivery time (headless harness artefact, not game logic)
const NUT_CLEAR = 6 + 20; // cut tolerance + safety margin
const REJ = { len: 0, nut: 0, low: 0, empty: 0 };
const SLOW = 600;       // prefer fruits moving slower than this (px/s) -- i.e. near their apex

function predict(it, s, ms) {
  const tau = ms / 1000 * s.ts;
  if (s.pull && it.kind !== 'nut') return [it.x + it.vx * tau, it.y + it.vy * tau];
  return [it.x + it.vx * tau, it.y + it.vy * tau + it.g * tau * tau / 2];
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let u = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; u = Math.max(0, Math.min(1, u)); return Math.hypot(ax + u * dx - px, ay + u * dy - py); }

// Build a stroke through fruits (given order); returns {pts:[[x,y,ms]], ok} with pass times.
function buildStroke(order, s) {
  let P = order.map(it => predict(it, s, LATENCY + 60));
  let times;
  for (let iter = 0; iter < 3; iter++) {
    const pts = extend(P, order, s);
    times = [LATENCY]; for (let i = 1; i < pts.length; i++) times.push(times[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / SPEED);
    P = order.map((it, i) => predict(it, s, times[i + 1]));
  }
  const pts = extend(P, order, s);
  times = [LATENCY]; for (let i = 1; i < pts.length; i++) times.push(times[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / SPEED);
  return pts.map((p, i) => [p[0], p[1], times[i]]);
}
function extend(P, order, s) {
  const n = P.length; let a, b;
  if (n === 1) { // single fruit: cut across its motion direction
    const it = order[0], vx = it.vx, vy = it.vy + it.g * 0.1; const l = Math.hypot(vx, vy) || 1;
    let dx = -vy / l, dy = vx / l; if (Math.abs(dy) > 0.8) { dx = 1; dy = 0; }
    const e = it.r + 34; a = [P[0][0] - dx * e, P[0][1] - dy * e]; b = [P[0][0] + dx * e, P[0][1] + dy * e];
    return [clampPt(a, s), P[0], clampPt(b, s)];
  }
  const ext = (p, q, r) => { const dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1; return clampPt([p[0] + dx / l * (r + 30), p[1] + dy / l * (r + 30)], s); };
  return [ext(P[0], P[1], order[0].r), ...P, ext(P[n - 1], P[n - 2], order[n - 1].r)];
}
function clampPt(p, s) { return [Math.max(3, Math.min(s.W - 3, p[0])), Math.max(3, Math.min(s.H - 3, p[1]))]; }
function strokeSafe(st, nuts, s) {
  for (let i = 0; i + 1 < st.length; i++) {
    const [ax, ay, ta] = st[i], [bx, by, tb] = st[i + 1];
    for (const nut of nuts) for (let tm = ta - 100; tm <= tb + 100; tm += 20) {
      const q = predict(nut, s, tm);
      if (segDist(q[0], q[1], ax, ay, bx, by) < nut.r + NUT_CLEAR) return false;
    }
  }
  return true;
}
function plan(s) {
  const fr = s.items.filter(i => i.kind !== 'nut' && i.kind !== 'start');
  const nuts = s.items.filter(i => i.kind === 'nut');
  // targetable: on screen at swipe time
  const tg = fr.filter(it => { const p = predict(it, s, LATENCY + 80); return p[1] < s.H - it.r * 0.2 && p[1] > it.r * 0.3 && p[0] > 0 && p[0] < s.W; });
  if (!tg.length) { REJ.empty++; return null; }
  const speedAt = it => { const vy = it.vy + (s.pull ? 0 : it.g * (LATENCY + 80) / 1000 * s.ts); return Math.hypot(it.vx, vy) * s.ts; };
  const urgency = it => { const p = predict(it, s, 300); return (it.vy > 0 && p[1] > s.H * 0.55) ? 2.5 : it.vy > 0 ? 1.3 : 1; };
  // chance a fast fruit is still where we aim when the touch lands; rising fruits will slow down, so wait for them
  const hitP = it => { const v = speedAt(it); if (v < SLOW || it.kind === 'pine') return 1; if (it.vy < 0) return Math.max(0.05, 1 - (v - SLOW) / 500); return Math.max(0.3, 1 - (v - SLOW) / 1400); };
  // candidate orders: (a) each wave's fruits in spawn (= formation path) order, (b) contiguous runs in x order
  const cands = [];
  const waves = new Map(); for (const it of [...tg].sort((a, b) => a.id - b.id)) { if (!waves.has(it.w)) waves.set(it.w, []); waves.get(it.w).push(it); }
  for (const g of waves.values()) for (let i = 0; i < g.length; i++) for (let j = i; j < g.length; j++) cands.push(g.slice(i, j + 1));
  tg.sort((a, b) => a.x - b.x);
  for (let i = 0; i < tg.length; i++) for (let j = i; j < tg.length && j < i + 8; j++) cands.push(tg.slice(i, j + 1));
  const all = [];
  for (const ord of cands) {
    const st = buildStroke(ord, s);
    let len = 0; for (let k = 1; k < st.length; k++) len += Math.hypot(st[k][0] - st[k - 1][0], st[k][1] - st[k - 1][1]);
    if (len > 1100) { REJ.len++; continue; }
    if (!strokeSafe(st, nuts, s)) { REJ.nut++; continue; }
    let sc = 0; for (const it of ord) sc += hitP(it) * urgency(it) * (it.kind === 'pine' ? 3 : it.kind === 'ice' ? 2 : 1);
    if (sc < 0.5) { REJ.low++; continue; }
    sc -= len / 2500;
    all.push({ sc, st, n: ord.length, ids: new Set(ord.map(o => o.id)), box: bbox(st) });
  }
  if (!all.length) return null;
  all.sort((a, b) => b.sc - a.sc);
  const best = all[0];
  // second finger (the game supports two): best stroke on other fruit, well away from the first stroke
  const second = all.find(c => c !== best && ![...c.ids].some(i => best.ids.has(i)) && apart(c.box, best.box));
  return { strokes: second ? [best.st, second.st] : [best.st], n: best.n + (second ? second.n : 0) };
}
function bbox(st) { let a = [1e9, 1e9, -1e9, -1e9]; for (const p of st) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); } return a; }
function apart(a, b) { return a[2] + 30 < b[0] || b[2] + 30 < a[0] || a[3] + 30 < b[1] || b[3] + 30 < a[1]; }
// Touch events are paced at ~60 Hz on a fixed schedule (fire-and-forget, like a finger), not one-by-one round trips,
// so a busy renderer cannot stretch the stroke's geometry. `lag` (measured) aligns the schedule with page time.
async function swipe(cdp, strokes, base) {
  if (!Array.isArray(strokes[0][0])) strokes = [strokes];
  const first = strokes[0][0][2], total = Math.max(...strokes.map(st => st[st.length - 1][2]));
  const atS = (st, ms) => { for (let i = 1; i < st.length; i++) if (ms <= st[i][2]) { const f = (ms - st[i - 1][2]) / Math.max(1, st[i][2] - st[i - 1][2]); return { x: st[i - 1][0] + (st[i][0] - st[i - 1][0]) * f, y: st[i - 1][1] + (st[i][1] - st[i - 1][1]) * f }; } return { x: st[st.length - 1][0], y: st[st.length - 1][1] }; };
  const pts = ms => strokes.map((st, k) => Object.assign({ id: k }, atS(st, ms)));
  // wait until (send time + lag) reaches the stroke's first planned page time
  const wait = base + first - lag - Date.now(); if (wait > 0) await sleep(wait);
  const s0 = Date.now(), sends = [];
  sends.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', timestamp: s0 / 1000, touchPoints: pts(first) }));
  // include every vertex so corners are never cut, plus 16 ms samples in between
  const times = new Set(); for (let tm = first + 16; tm < total; tm += 16) times.add(tm); for (const st of strokes) for (const p of st) times.add(p[2]);
  const list = [...times].filter(x => x > first).sort((a, b) => a - b);
  for (const tm of list) { const d = s0 + (tm - first) - Date.now(); if (d > 2) await sleep(d); sends.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', timestamp: (s0 + tm - first) / 1000, touchPoints: pts(tm) })); }
  await sleep(10);
  sends.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', timestamp: (s0 + total - first + 10) / 1000, touchPoints: [] }));
  const sentAt = Date.now();
  // the fingers are already lifted; measure delivery lag in the background without blocking the next action
  Promise.all(sends).then(() => { const measured = Date.now() - sentAt; lag = Math.max(10, lag * 0.75 + measured * 0.25); });
}

(async () => {
  const vdir = path.join(OUT, '_vid'); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: +(process.env.DPR || 1), hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload();
  const cdp = await ctx.newCDPSession(page);
  await sleep(1500);
  // tap the 經典 chip, then slice the start melon like a player
  const b = await page.locator('.mode[data-m="classic"]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
  let s = await page.evaluate(() => __game.snap());
  const m = s.items.find(i => i.kind === 'start');
  await swipe(cdp, [[m.x - m.r * 1.4, m.y - 10, 0], [m.x + m.r * 1.4, m.y + 20, m.r * 2.8 / SPEED]], Date.now());
  for (let k = 0; k < 40; k++) { await sleep(50); if ((await page.evaluate(() => __game.state())).state === 'play') break; }
  const TM = { plan: 0, eval: 0, swipe: 0, n: 0, idle: 0 };
  const log = []; let two = 0, swipes = 0, lastLog = 0, lastLives = 3, lastMiss = 0;
  const events = [];
  for (;;) {
    const e0 = Date.now();
    const both = await page.evaluate(() => [__game.state(), __game.snap()]);
    const e1 = Date.now();
    const gs = both[0];
    if (gs.state !== 'play') break;
    if (process.env.DBG && gs.misses > lastMiss && s) console.log('MISS at', gs.real.toFixed(1), 'prev snapshot items:', s.items.map(i => `${i.kind}@${i.x.toFixed(0)},${i.y.toFixed(0)} vy${i.vy.toFixed(0)}`).join(' '));
    if (gs.lives < lastLives) { events.push(`t=${gs.real.toFixed(1)}s lost a leaf (${gs.misses > lastMiss ? 'missed fruit' : 'chestnut'})`); }
    lastLives = gs.lives; lastMiss = gs.misses;
    if (gs.real >= lastLog + 15) { lastLog += 15; log.push(gs); console.log(`  t=${gs.real.toFixed(0).padStart(3)}s  難度 ${String(gs.diff).padStart(2)}  score ${String(gs.score).padStart(4)}  lives ${gs.lives}  slices ${gs.slices}  max combo ${gs.maxCombo}  fps ${gs.fps}`); }
    if (gs.real >= PLAY_SECS) { await sleep(150); continue; } // stop slicing: let the run end
    s = both[1];
    const base = (e0 + e1) / 2; LATENCY = Date.now() - base + lag + 5;
    const tp0 = Date.now(); const p = plan(s); TM.plan += Date.now() - tp0; TM.eval += e1 - e0; TM.n++; if (!p) TM.idle++;
    const ts0 = Date.now();
    if (p) { const b4 = gs.slices; await swipe(cdp, p.strokes, base); if (p.strokes.length > 1) two++; TM.swipe += Date.now() - ts0; swipes++; if (process.env.DBG) { await sleep(30); const a = await page.evaluate(() => __game.state()); console.log('swipe n=' + p.n, 'got', a.slices - b4, 'misses', a.misses, 'items', s.items.length, 'fingers', p.strokes.length); } }
    await sleep(150); // human pace between actions
  }
  const fin = await page.evaluate(() => __game.state());
  await sleep(2200);
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'run.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '33', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(events.length ? 'Leaf losses:\n  ' + events.join('\n  ') : 'Leaf losses: none');
  console.log(`RUN: survived ${fin.real.toFixed(1)}s (bot played ${PLAY_SECS}s, then stopped), final score ${fin.score}, 難度 ${fin.diff}, slices ${fin.slices}, max combo ${fin.maxCombo}, misses ${fin.misses}, swipes ${swipes} (${two} with two fingers)`);
  if (process.env.DBG) console.log('rejections', JSON.stringify(REJ));
  if (process.env.DBG) console.log('timing per loop: eval', (TM.eval / TM.n).toFixed(0), 'ms, plan', (TM.plan / TM.n).toFixed(1), 'ms, swipe', (TM.swipe / Math.max(1, swipes)).toFixed(0), 'ms; loops', TM.n, 'idle', TM.idle);
  console.log(`mean CDP touch dispatch latency ~${lag.toFixed(0)} ms (harness), cycle = plan + swipe + 150 ms pause`);
  console.log(`video ${Math.round(fs.statSync(mp4).size / 1024)} KB`, errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors');
})();
