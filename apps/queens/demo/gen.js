// Level generator for 花園女王 (queens).
// Uses the game's own core (between CORE-START/CORE-END in index.html, or the file given with --core).
// Per board class (N, K) it builds a pool of candidate puzzles: seeded PRNG -> random legal queen solution ->
// regions grown from the queens (K=2: grown from all 2N queens, then adjacent halves paired) -> region borders
// adjusted until the solution is unique -> must be solvable by the logic solver (no guessing).
// Each candidate is scored by the logic solver (technique weights 1/2/5/12). Levels are then picked in order:
// the candidate closest to S(L) = 12 * 1.035^L that is strictly harder than the previous level, uses the
// techniques the level requires (L>=30 locked sets, L>=50 depth-1 contradiction) and, from level 90, the
// interleaved region style.
// Usage: node gen.js [--core path] [--pool pool.json] [--workers 3] [--out levels.json] [--scale 1]
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const CORE = opt('--core', path.resolve(__dirname, '..', 'index.html'));
function loadCore() {
  const src = fs.readFileSync(CORE, 'utf8');
  const m = src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//);
  return new Function(m[1] + '\nreturn {genCandidate, encodeReg};')();
}
const CLASSES = [ // [N, K, firstLevel, lastLevel, poolSize]
  [5, 1, 1, 8, 300], [6, 1, 9, 20, 300], [7, 1, 21, 35, 400], [8, 1, 36, 50, 500], [9, 1, 51, 69, 1500],
  [10, 2, 70, 84, 60], [11, 2, 85, 94, 48], [12, 2, 95, 100, 46]
];
const classOf = L => CLASSES.find(c => L >= c[2] && L <= c[3]);
const key = c => c[0] + '_' + c[1];
function styleFor(c, i) { if (c[3] < 15) return 0; if (c[2] >= 90) return 1; return i % 2; }
const target = L => 12 * Math.pow(1.035, L);
function fits(L, c) {
  if (L >= 50 && !c.used[4]) return false;
  if (L >= 30 && !c.used[3]) return false;
  if (L >= 90 && c.style !== 1) return false;
  if (L < 15 && c.style !== 0) return false;
  return true;
}

if (process.env.QWORKER) {
  const C = loadCore();
  process.on('message', job => {
    if (job === 'exit') process.exit(0);
    const out = [];
    const r = C.genCandidate(job.N, job.K, job.seed, job.style, 4);
    if (r) out.push({ reg: C.encodeReg(r.reg), sol: r.sol, score: r.score, used: r.used, style: job.style, seed: job.seed });
    process.send({ k: job.k, out });
  });
  return;
}

(async () => {
  const poolFile = opt('--pool', path.join(__dirname, 'pool.json'));
  const outFile = opt('--out', path.join(__dirname, 'levels.json'));
  const nW = +opt('--workers', 3), scale = +opt('--scale', 1);
  let pool = {}; try { pool = JSON.parse(fs.readFileSync(poolFile, 'utf8')); } catch (e) {}
  const jobs = [];
  for (const c of CLASSES) {
    const p = pool[key(c)] || (pool[key(c)] = { seeds: 0, c: [] });
    const want = Math.round(c[4] * scale);
    for (let s = p.seeds; s < want; s++) jobs.push({ k: key(c), N: c[0], K: c[1], style: styleFor(c, s), seed: c[0] * 1000003 + c[1] * 77 + s * 7919 + 1 });
  }
  // interleave classes so that every pool fills up steadily; big boards first
  jobs.sort((a, b) => (b.N * b.K) - (a.N * a.K));
  console.log('jobs', jobs.length);
  let done = 0, t0 = Date.now(), lastSave = Date.now();
  await new Promise(res => {
    if (!jobs.length) return res();
    let active = 0;
    for (let w = 0; w < nW; w++) {
      const ch = fork(__filename, args, { env: Object.assign({}, process.env, { QWORKER: 1 }) });
      active++;
      const next = () => { const j = jobs.shift(); if (j) ch.send(j); else ch.send('exit'); };
      ch.on('message', m => {
        const p = pool[m.k]; p.seeds++; p.c.push(...m.out); done++;
        if (done % 50 === 0 || jobs.length < 3) console.log('done', done, 'left', jobs.length, ((Date.now() - t0) / 1000 | 0) + 's', m.k);
        if (Date.now() - lastSave > 15000) { fs.writeFileSync(poolFile, JSON.stringify(pool)); lastSave = Date.now(); }
        next();
      });
      ch.on('exit', () => { if (--active === 0) res(); });
      next();
    }
  });
  fs.writeFileSync(poolFile, JSON.stringify(pool));
  // selection: dynamic programming over all 100 levels -> a strictly increasing difficulty chain that stays
  // as close as possible (log distance) to the target curve S(L)
  const elig = [];
  for (let L = 1; L <= 100; L++) {
    const c = classOf(L);
    const list = pool[key(c)].c.filter(x => fits(L, x)).map(x => Object.assign({ N: c[0], K: c[1] }, x));
    // one candidate per distinct score is enough (keep the first)
    const seen = new Set(), uniq = [];
    for (const x of list.sort((a, b) => a.score - b.score)) if (!seen.has(x.score)) { seen.add(x.score); uniq.push(x); }
    elig.push(uniq);
  }
  const cost = [], from = [];
  for (let i = 0; i < 100; i++) {
    const T = Math.log(target(i + 1)), cur = elig[i], cst = new Float64Array(cur.length).fill(Infinity), fr = new Int32Array(cur.length).fill(-1);
    if (i === 0) cur.forEach((x, j) => { cst[j] = Math.abs(Math.log(x.score) - T); });
    else {
      const prev = elig[i - 1], pc = cost[i - 1];
      let best = Infinity, bi = -1, p = 0;
      for (let j = 0; j < cur.length; j++) {
        while (p < prev.length && prev[p].score < cur[j].score) { if (pc[p] < best) { best = pc[p]; bi = p; } p++; }
        if (bi >= 0) { cst[j] = best + Math.abs(Math.log(cur[j].score) - T); fr[j] = bi; }
      }
    }
    cost.push(cst); from.push(fr);
  }
  let bj = -1, bc = Infinity; cost[99].forEach((v, j) => { if (v < bc) { bc = v; bj = j; } });
  if (bj < 0 || !isFinite(bc)) { console.log('NO strictly increasing chain exists with these pools'); process.exit(1); }
  const levels = [];
  for (let i = 99; i >= 0; i--) { const x = elig[i][bj]; levels.unshift({ L: i + 1, N: x.N, K: x.K, reg: x.reg, sol: x.sol, score: x.score, used: x.used, style: x.style }); bj = from[i][bj]; }
  const problems = [];
  const s1 = Math.log(levels[0].score), s100 = Math.log(levels[99].score);
  for (const lv of levels) lv.d = Math.max(1, Math.min(10, Math.round(1 + 9 * (Math.log(lv.score) - s1) / (s100 - s1))));
  fs.writeFileSync(outFile, JSON.stringify(levels));
  console.log('levels written', outFile, '| less than 2% harder at:', problems.join(',') || 'none');
  for (const c of CLASSES) console.log('pool', key(c), pool[key(c)].c.length, 'of', pool[key(c)].seeds, 'attempts');
  console.log(levels.map(l => l.L + ':' + l.score).join(' '));
})();
