// Level generator for 金字塔接龍 (pyramid-solitaire).
// Uses the game's own rules + DFS solver extracted from index.html (CORE-START/CORE-END, SOLVER-BEGIN/END).
// 1) scans seeded deals (seeds 1..8000 under all three recycle rules, seeds 1..40000 under the no-recycle rule)
// 2) every candidate is solved (proof of winnability) and scored:
//    S = ln(expanded nodes) + 0.3 × deferred pairs + recycle coefficient (2→0, 1→2, 0→4) − ln(p + 0.01)
//    where p = success rate of 500 random legal-move players
// 3) picks 100 levels on a geometric target curve S(n) = S1 · g^(n−1) with S strictly increasing
//    (levels 1–30: 2 recycles, 31–70: 1 recycle, 71–100: none).
// Usage: node gen.js [coreFile]   → prints the LEVELS array to paste into index.html (also writes levels.json)
const fs = require('fs'), path = require('path'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const CAP = 60000, RUNS = 500;
function loadCore(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//);
  return new Function(m[1] + '\nreturn {dealFromSeed,initState,solve,randomRate,difficultyScore,deferredCount};')();
}
if (!isMainThread) {
  const C = loadCore(workerData.core), out = [];
  for (let seed = workerData.from; seed <= workerData.to; seed += workerData.step) {
    const D = C.dealFromSeed(seed);
    for (const R of seed <= 8000 ? [2, 1, 0] : [0]) {
      const r = C.solve(D, C.initState(), R, CAP);
      if (!r.ok) continue;
      const p = C.randomRate(D, R, RUNS, seed);
      out.push({ seed, R, S: C.difficultyScore(D, R, r, p), nodes: r.nodes, p, def: C.deferredCount(D, r.sol, R), len: r.sol.length });
    }
  }
  parentPort.postMessage(out);
  return;
}
(async () => {
  const core = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
  const W = Math.max(1, Math.min(3, os.cpus().length - 1)), MAX = 40000, t0 = Date.now();
  const parts = await Promise.all(Array.from({ length: W }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { core, from: 1 + i, to: MAX, step: W } });
    w.on('message', res); w.on('error', rej);
  })));
  const all = [].concat(...parts);
  const tiers = [[1, 30, 2], [31, 70, 1], [71, 100, 0]];
  const pool = R => all.filter(c => c.R === R).sort((a, b) => a.S - b.S);
  // curve: S1 = easiest 2-recycle deal, S100 = a hard but not freakish 0-recycle deal
  const p2 = pool(2), p0 = pool(0);
  const S1 = p2[0].S, S100 = p0[Math.floor(p0.length * 0.995)].S;
  const g = Math.pow(S100 / S1, 1 / 99);
  const used = new Set(), levels = [];
  let prev = -1;
  for (const [a, b, R] of tiers) {
    const P = pool(R);
    for (let n = a; n <= b; n++) {
      const target = S1 * Math.pow(g, n - 1);
      const minS = prev + 0.04; // strictly (and visibly) harder than the previous level
      let best = null;
      for (const c of P) { if (c.S < minS || used.has(c.seed)) continue; if (!best || Math.abs(c.S - target) < Math.abs(best.S - target)) best = c; }
      if (!best) throw new Error('no candidate for level ' + n);
      used.add(best.seed); prev = best.S;
      levels.push({ n, seed: best.seed, R, S: +best.S.toFixed(3), target: +target.toFixed(3), nodes: best.nodes, p: best.p, def: best.def, len: best.len });
    }
  }
  fs.writeFileSync(path.join(__dirname, 'levels.json'), JSON.stringify(levels, null, 1));
  console.log('candidates solved:', all.length, '(R2', p2.length, 'R1', pool(1).length, 'R0', p0.length, ') in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  console.log('curve S1 =', S1.toFixed(2), 'S100 =', S100.toFixed(2), 'growth g =', g.toFixed(4), '/level');
  for (const L of levels) if (L.n % 10 === 1 || L.n >= 98) console.log(' level', L.n, 'seed', L.seed, 'recycles', L.R, 'S', L.S, 'target', L.target, 'nodes', L.nodes, 'p', L.p);
  console.log('var LEVELS = [' + levels.map(L => '[' + L.seed + ',' + L.R + ',' + L.S + ']').join(',') + '];');
})();
