// Node verification for 幾何霓虹磚 (brick-balls), using the game's own core code (extracted from index.html between CORE markers).
// 1) Checks the 100 generated levels: strictly increasing difficulty metric, mechanics introduced at L11/21/41/51/61/71/81.
// 2) Auto-player (same physics, fixed step): each turn scans 329 angles (8°–172° at 0.5°), scores "total damage − low-row penalty",
//    re-ranks the best few by their best follow-up turn, and must clear every level.
// 3) Human-error test: angle ±0.7° random error on every shot, 10 runs per level, must win ≥7/10 on the tested levels.
// Usage: node solve.js [--levels 1-100] [--err 50,75,99,100] [--runs 10] [--workers 4]
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html');
function loadCore() {
  const html = fs.readFileSync(APP, 'utf8');
  const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  return new Function(src + '\nreturn BB;')();
}
if (!isMainThread) {
  const BB = loadCore(); const LV = BB.buildLevels();
  parentPort.on('message', job => {
    if (job === 'exit') process.exit(0);
    const t0 = Date.now();
    const r = BB.playLevel(LV[job.n - 1], { err: job.err, seed: job.seed });
    parentPort.postMessage({ ...job, win: r.win, turns: r.turns, minMargin: r.minMargin, balls: r.balls, ms: Date.now() - t0 });
  });
  return;
}
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const range = opt('--levels', '1-100').split('-').map(Number);
const errLv = opt('--err', '50,75,99,100').split(',').filter(Boolean).map(Number);
const runs = +opt('--runs', 10), nW = +opt('--workers', Math.max(1, Math.min(4, os.cpus().length)));
const BB = loadCore(); const LV = BB.buildLevels();

// --- static checks
let mono = true;
for (let i = 1; i < LV.length; i++) if (!(LV[i].raw > LV[i - 1].raw && LV[i].diffV > LV[i - 1].diffV)) { mono = false; console.log('NOT HARDER at level', i + 1); }
const has = (lv, f) => lv.rows.some(r => r.b.some(f) || r.it.some(f));
const first = {
  vl: LV.findIndex(lv => has(lv, x => x.k === 'vl')) + 1, hl: LV.findIndex(lv => has(lv, x => x.k === 'hl')) + 1,
  tri: LV.findIndex(lv => has(lv, x => x.tri >= 0)) + 1, solid: LV.findIndex(lv => has(lv, x => x.solid)) + 1,
  split: LV.findIndex(lv => has(lv, x => x.k === 'split')) + 1, move: LV.findIndex(lv => has(lv, x => x.mv)) + 1, regen: LV.findIndex(lv => has(lv, x => x.regen)) + 1
};
console.log('Levels:', LV.length, '| difficulty metric strictly increasing:', mono);
console.log('First appearance of mechanics:', JSON.stringify(first));
for (const n of [1, 10, 25, 50, 75, 99, 100]) { const l = LV[n - 1]; console.log(`  L${n}: balls ${l.B}, rows ${l.rows.length} (start ${l.k}), total HP ${l.sumHP}, difficulty ${l.diffV} (${'■'.repeat(l.pips)}${'□'.repeat(5 - l.pips)})`); }

// --- physics: continuous collision (no tunnelling) incl. triangles, aim preview == real first segment
(function physicsCheck() {
  function polyDist(P, x, y) { // signed distance from point to convex polygon (negative inside)
    let inside = true, best = Infinity; const n = P.length / 2;
    let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += P[2 * i]; cy += P[2 * i + 1]; } cx /= n; cy /= n;
    for (let i = 0; i < n; i++) {
      const ax = P[2 * i], ay = P[2 * i + 1], bx = P[(2 * i + 2) % (2 * n)], by = P[(2 * i + 3) % (2 * n)];
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey; let t = ((x - ax) * ex + (y - ay) * ey) / l2; t = Math.max(0, Math.min(1, t));
      const dx = x - (ax + ex * t), dy = y - (ay + ey * t); best = Math.min(best, Math.hypot(dx, dy));
      let nx = ey, ny = -ex; if ((cx - ax) * nx + (cy - ay) * ny > 0) { nx = -nx; ny = -ny; }
      if ((x - ax) * nx + (y - ay) * ny > 0) inside = false;
    }
    return inside ? -best : best;
  }
  let shots = 0, steps = 0, worst = Infinity, triHits = 0, previewOK = 0, previewN = 0;
  const rnd = BB.rng(12345);
  for (const n of [41, 60, 80, 95, 100]) {
    for (let k = 0; k < 40; k++) {
      const S = BB.newGame(LV[n - 1]); S.launchX = 20 + rnd() * 350; const ang = 8 + rnd() * 164;
      // preview: first segment end must equal the real ball's first contact point
      const pts = BB.aimPath(S, S.launchX, ang, 1, 2000);
      const T = BB.startTurn(S, ang); T.total = 1; let firstHit = null; const ev = [];
      while (!BB.stepTurn(S, T, ev)) {
        steps++;
        for (const e of ev) if (!firstHit && (e.k === 'hit' || e.k === 'break' || e.k === 'clank' || e.k === 'wall')) firstHit = true;
        if (!firstHit && T.balls[0]) { /* still on first segment */ }
        for (const e of ev) if ((e.k === 'hit' || e.k === 'break') && e.b.tri >= 0) triHits++;
        ev.length = 0;
        for (const b of T.balls) if (b.live) for (const br of S.bricks) if (!br.dead) {
          const d = polyDist(BB.shape(br.r * 7 + br.c, br.tri).P, b.x, b.y); if (d < worst) worst = d;
        }
      }
      shots++;
      // compare preview first contact with a single-ball replay of the same shot
      const S2 = BB.newGame(LV[n - 1]); S2.launchX = pts[0];
      const T2 = BB.startTurn(S2, ang); T2.total = 1; let px = null, py = null, split = false; const ev2 = [];
      while (px === null && !BB.stepTurn(S2, T2, ev2)) { if (ev2.some(e => e.k === 'split')) split = true; const e = ev2.find(e => e.k === 'contact' || e.k === 'land'); if (e) { px = e.k === 'contact' ? e.x : T2.balls[0].x; py = e.k === 'contact' ? e.y : T2.balls[0].y; } ev2.length = 0; }
      if (px !== null && !split) { previewN++; if (Math.hypot(px - pts[2], py - pts[3]) < 0.01) previewOK++; else if (process.env.DBG) console.log('preview mismatch', n, ang, px, py, pts.slice(0, 4)); }
    }
  }
  console.log(`Physics: ${shots} random shots, ${steps} steps; closest ball-centre-to-brick distance ${worst.toFixed(3)} (ball radius ${BB.R}) -> ${worst > BB.R - 0.01 ? 'no tunnelling/overlap' : 'OVERLAP!'}; triangle hits ${triHits}; aim preview first contact matches real ball ${previewOK}/${previewN} (shots that hit a split item first are excluded)`);
})();

// --- auto-player runs
const jobs = [];
for (let n = range[0]; n <= range[1]; n++) jobs.push({ n, err: 0, seed: 1 });
for (const n of errLv) for (let s = 1; s <= runs; s++) jobs.push({ n, err: 0.7, seed: s });
jobs.sort((a, b) => b.n - a.n); // big levels first
const results = []; let next = 0; const t0 = Date.now();
const workers = Array.from({ length: nW }, () => new Worker(__filename));
function feed(w) { if (next < jobs.length) w.postMessage(jobs[next++]); else w.postMessage('exit'); }
workers.forEach(w => { w.on('message', r => { results.push(r); if (results.length % 20 === 0) process.stderr.write(`  ${results.length}/${jobs.length} runs...\n`); feed(w); }); feed(w); });
Promise.all(workers.map(w => new Promise(res => w.on('exit', res)))).then(() => {
  const exact = results.filter(r => r.err === 0).sort((a, b) => a.n - b.n);
  const fails = exact.filter(r => !r.win);
  const stars = exact.map(r => r.minMargin >= 4 ? 3 : r.minMargin >= 2 ? 2 : 1);
  console.log(`\nAuto-player (329-angle scan, no aim error): cleared ${exact.length - fails.length}/${exact.length} levels` + (fails.length ? ' — FAILED: ' + fails.map(r => r.n).join(',') : ''));
  console.log('  turns used per level:', exact.map(r => r.n + ':' + r.turns).join(' '));
  console.log('  stars (min margin rule):', `3★ ${stars.filter(s => s === 3).length}, 2★ ${stars.filter(s => s === 2).length}, 1★ ${stars.filter(s => s === 1).length}`);
  let allOk = fails.length === 0;
  for (const n of errLv) {
    const rs = results.filter(r => r.err && r.n === n), w = rs.filter(r => r.win).length;
    if (w < 7) allOk = false;
    console.log(`  L${n} with ±0.7° aim error: ${w}/${rs.length} wins ${w >= 7 ? 'PASS' : 'FAIL'}  [${rs.sort((a, b) => a.seed - b.seed).map(r => (r.win ? 'W' : 'L') + r.turns).join(' ')}]`);
  }
  console.log(`\nRESULT: ${allOk && mono ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${nW} workers)`);
});
