// Level generator for 經典接龍 (klondike-solitaire).
// Deals seeded deals (mulberry32 + Fisher-Yates, the game's own deal()), solves each with the game's own solver
// (omniscient DFS + transposition table + safe auto-foundation pruning, node cap), scores difficulty
// S = ln(N) + L/40 + R*0.8 + rule coefficient, and picks 100 levels with strictly increasing S.
// Usage: node gen.js [seedsPerBand=700]  -> prints the LEVELS array (JSON) to embed in index.html; chunk results are cached in $GEN_CACHE
const fs = require('fs'), path = require('path'), os = require('os'), { fork } = require('child_process');
const CACHE = process.env.GEN_CACHE || path.join(os.tmpdir(), 'klondike-gen-cache');
const CORE_FILE = process.env.CORE_FILE || path.resolve(__dirname, '..', 'index.html');
const MAXN = 600000;
function loadCore(file) {
  const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  return new Function(src + '\nreturn {deal, solve, diffScore, levelMode};')();
}
if (process.argv[2] === '--child') {
  const C = loadCore(CORE_FILE); const [draw, limit, from, cnt] = process.argv.slice(3).map(Number);
  const out = [];
  for (let s = from; s < from + cnt; s++) {
    const r = C.solve(C.deal(s, draw, limit), MAXN);
    if (r.ok) out.push({ seed: s, N: r.nodes, L: r.path.length, R: r.R, S: C.diffScore(r.nodes, r.path.length, r.R, draw, limit) });
  }
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(path.join(CACHE, `${draw}_${limit}_${from}_${cnt}_${MAXN}.json`), JSON.stringify(out));
  process.exit(0);
}
const BANDS = [
  { n0: 1, n1: 40, draw: 1, limit: -1, base: 100000 },
  { n0: 41, n1: 60, draw: 1, limit: 3, base: 200000 },
  { n0: 61, n1: 85, draw: 3, limit: -1, base: 300000 },
  { n0: 86, n1: 100, draw: 3, limit: 3, base: 400000 },
];
const PER = +(process.argv[2] || 700), CHUNK = 25;
const cacheFile = j => path.join(CACHE, `${j.b.draw}_${j.b.limit}_${j.from}_${j.cnt}_${MAXN}.json`);
(async () => {
  const jobs = [];
  for (const b of BANDS) for (let s = 0; s < PER; s += CHUNK) jobs.push({ b, from: b.base + s, cnt: Math.min(CHUNK, PER - s) });
  const pools = BANDS.map(() => []);
  let next = 0; const t0 = Date.now();
  await new Promise(res => {
    let running = 0;
    const launch = () => {
      while (running < 4 && next < jobs.length) {
        const j = jobs[next++];
        if (fs.existsSync(cacheFile(j))) { if (next >= jobs.length && running === 0) return res(); continue; }
        running++;
        const ch = fork(__filename, ['--child', j.b.draw, j.b.limit, j.from, j.cnt]);
        ch.on('exit', () => { running--; process.stderr.write('.'); if (next >= jobs.length && running === 0) res(); else launch(); });
      }
    };
    launch();
  });
  jobs.forEach(j => pools[BANDS.indexOf(j.b)].push(...JSON.parse(fs.readFileSync(cacheFile(j), 'utf8'))));
  process.stderr.write('\nsolved in ' + ((Date.now() - t0) / 1000).toFixed(0) + 's; pools ' + pools.map(p => p.length).join(',') + '\n');
  if (process.env.POOL_OUT) fs.writeFileSync(process.env.POOL_OUT, JSON.stringify(pools));
  console.log(JSON.stringify(select(pools)));
})();
// Selection: the four rule bands occupy consecutive, non-overlapping S ranges (so the score keeps rising across
// band boundaries). Inside a band, targets are spread geometrically over its range and a small dynamic program picks
// the candidates closest to the targets subject to every level being at least MIN_STEP harder than the previous one.
const RANGES = [[7.0, 13.0], [13.15, 16.5], [16.65, 20.3], [20.45, 23.0]], MIN_STEP = 0.1;
function select(pools) {
  const levels = []; let prev = 0;
  BANDS.forEach((b, bi) => {
    const lo = RANGES[bi][0], hi = RANGES[bi][1], count = b.n1 - b.n0 + 1;
    const pool = pools[bi].filter(c => c.S >= Math.max(lo - 0.3, prev + MIN_STEP) && c.S <= hi + 0.05).sort((x, y) => x.S - y.S);
    const tg = k => lo * Math.pow(hi / lo, k / (count - 1)), n = pool.length;
    const f = [], from = [];
    for (let k = 0; k < count; k++) {
      f.push(new Array(n).fill(Infinity)); from.push(new Array(n).fill(-1));
      for (let i = 0; i < n; i++) {
        const cost = Math.abs(pool[i].S - tg(k));
        if (k === 0) { f[0][i] = cost; continue; }
        for (let j = 0; j < i; j++) if (pool[i].S - pool[j].S >= MIN_STEP && f[k - 1][j] + cost < f[k][i]) { f[k][i] = f[k - 1][j] + cost; from[k][i] = j; }
      }
    }
    let bi2 = -1; for (let i = 0; i < n; i++) if (f[count - 1][i] < Infinity && (bi2 < 0 || f[count - 1][i] < f[count - 1][bi2])) bi2 = i;
    if (bi2 < 0) throw new Error('pool too small in band ' + bi);
    const pick = []; for (let k = count - 1, i = bi2; k >= 0; i = from[k][i], k--) pick.unshift(pool[i]);
    pick.forEach(c => levels.push([c.seed, +c.S.toFixed(3), c.N, c.L, c.R]));
    prev = pick[pick.length - 1].S;
  });
  return levels;
}
