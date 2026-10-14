// Offline level generator for 和紙數獨 (sudoku). Uses the game's own core (between CORE-START/CORE-END in ../index.html).
// Usage: node gen-levels.js [--pool-only] [--from-pool pool.json]
// For each level L: seeded mulberry32(L*7919) -> full solution (backtracking, random order) -> dig 180°-symmetric holes
// with DLX uniqueness check -> human-technique rating. Puzzles whose hardest technique is above the level's band are
// skipped; clue pairs are added back (keeping the band technique required) until the givens target is met.
// Then a DP picks one candidate per level so that difficulty D is strictly increasing and close to the target curve.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'index.html');
const coreFile = process.env.CORE || APP;
const src = fs.readFileSync(coreFile, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {dlxSolve,rateGrid,genSolution,digPuzzle,mulberry32,gridStr,countGivens,parseGrid,bandTier,targetGivens,shuffle,TECH};')();

// Givens schedule: levels 1-15 (singles only) lose one clue per level so D (=empty cells there) rises every level;
// from level 16 on it is the spec formula round(46 - 22(1 - 0.966^L)).
function givensFor(L) { return L <= 15 ? 52 - L : C.targetGivens(L); }
const SLACK = 3; // levels >= 16 may use up to 3 fewer givens than the formula (never more)
// Target difficulty curve: D(15)=44 (singles-only, 37 givens) rising ~1.4% per level to ~145 at level 100.
let RATE = 1.0141, BASE = 44; // fitted below to the generated pool
function targetD(L) { return L <= 15 ? 81 - givensFor(L) : BASE * Math.pow(RATE, L - 15); }

function digMore(g, rnd) { // asymmetric pass after the symmetric one: drop any further clue that keeps uniqueness
  const cells = []; for (let i = 0; i < 81; i++) if (g[i]) cells.push(i);
  C.shuffle(cells, rnd);
  for (const a of cells) { const v = g[a]; g[a] = 0; if (C.dlxSolve(g, 2).count !== 1) g[a] = v; }
  return g;
}
function makeCandidate(L, rnd, greedy, G) {
  const band = C.bandTier(L);
  const sol = C.genSolution(rnd);
  const g = C.digPuzzle(sol, rnd);
  if (C.countGivens(g) > G) digMore(g, rnd);
  let r = C.rateGrid(g);
  if (!r.solved || r.tier < band) return null;
  let c = C.countGivens(g);
  if (c > G) return null;
  // add clues back (symmetric pairs) keeping tier >= band; greedy mode keeps the hardest of several tries
  const pairs = []; for (let i = 0; i <= 40; i++) if (!g[i] || !g[80 - i]) pairs.push(i);
  C.shuffle(pairs, rnd);
  while (c < G && pairs.length) {
    let best = null, tries = 0;
    for (let k = 0; k < pairs.length && tries < (greedy ? 8 : 1); k++) {
      const a = pairs[k], b = 80 - a, add = [a, b].filter((x, j) => !g[x] && (j === 0 || a !== b));
      if (!add.length) { pairs.splice(k--, 1); continue; }
      if (c + add.length > G) continue;
      tries++;
      add.forEach(x => { g[x] = sol[x]; });
      const r2 = C.rateGrid(g);
      add.forEach(x => { g[x] = 0; });
      if (r2.solved && r2.tier >= band && (!best || r2.D > best.r.D)) best = { k, add, r: r2 };
      else if (!(r2.solved && r2.tier >= band)) { pairs.splice(k--, 1); tries--; }
    }
    if (!best) break;
    best.add.forEach(x => { g[x] = sol[x]; }); c += best.add.length; r = best.r; pairs.splice(best.k, 1);
  }
  if (c < G) { // one single clue to land exactly on G
    const cells = []; for (let i = 0; i < 81; i++) if (!g[i]) cells.push(i);
    C.shuffle(cells, rnd);
    for (const a of cells) { g[a] = sol[a]; const r2 = C.rateGrid(g); if (r2.solved && r2.tier >= band) { c++; r = r2; break; } g[a] = 0; }
  }
  if (c !== G || r.tier !== band) return null;
  if (C.dlxSolve(g, 2).count !== 1) throw new Error('not unique');
  return { p: C.gridStr(g), D: r.D, tier: r.tier, counts: r.counts, givens: c, seed: L };
}

function buildPool(K, maxAttempts, from, to) {
  const pool = {};
  for (let L = from; L <= to; L++) {
    const rnd = C.mulberry32(L * 7919 + (+process.env.SEEDOFF || 0)), cands = [], seen = new Set();
    let att = 0;
    const want = L <= 15 ? 1 : K;
    while (cands.length < want && att < maxAttempts) {
      att++;
      const cd = makeCandidate(L, rnd, process.env.GREEDY ? true : att % 2 === 0, L <= 15 ? givensFor(L) : givensFor(L) - Math.floor(rnd() * (SLACK + 1)));
      if (cd && !seen.has(cd.p)) { seen.add(cd.p); cands.push(cd); }
    }
    const Ds = cands.map(c => c.D).sort((a, b) => a - b);
    console.error('L' + L, 'band', C.bandTier(L), 'G', givensFor(L), 'cands', cands.length, 'attempts', att, 'D', Ds.join(','));
    pool[L] = cands;
  }
  return pool;
}
// Any candidate of the same technique band whose givens lie in the level's allowed range may be used for that level.
function groupPool(pool) {
  const all = []; for (const L in pool) all.push(...pool[L]);
  const out = [];
  for (let L = 1; L <= 100; L++) {
    if (L <= 15) { out.push(pool[L]); continue; }
    const hi = givensFor(L), lo = hi - SLACK, b = C.bandTier(L);
    out.push(all.filter(c => c.tier === b && c.givens >= lo && c.givens <= hi));
  }
  return out;
}

// DP: strictly increasing D, minimise sum of relative deviation from target (hard cap ±8% where possible)
function select(pool) {
  const n = pool.length, cost = [], prev = [];
  for (let L = 0; L < n; L++) {
    cost.push([]); prev.push([]);
    const T = targetD(L + 1);
    pool[L].forEach((c, j) => {
      const dev = Math.abs(c.D - T) / T, pen = dev + (dev > 0.08 ? 10 * (dev - 0.08) : 0);
      let best = Infinity, bp = -1;
      if (L === 0) best = 0;
      else pool[L - 1].forEach((p, k) => { if (p.D < c.D && cost[L - 1][k] < best) { best = cost[L - 1][k]; bp = k; } });
      cost[L].push(best + pen); prev[L].push(bp);
    });
  }
  let bj = -1, bc = Infinity;
  cost[n - 1].forEach((c, j) => { if (c < bc) { bc = c; bj = j; } });
  if (bj < 0 || !isFinite(bc)) throw new Error('no strictly increasing selection');
  const out = [];
  for (let L = n - 1; L >= 0; L--) { out.unshift(pool[L][bj]); bj = prev[L][bj]; }
  return out;
}

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const tmp = process.env.TMPDIR || '/tmp';
let pool = {};
if (opt('--range')) { // build part of the pool: --range 16-40 --out file.json
  const [a, b] = opt('--range').split('-').map(Number);
  pool = buildPool(+process.env.K || 6, +process.env.MAXATT || 6000, a, b);
  fs.writeFileSync(opt('--out') || path.join(tmp, 'sudoku-pool-' + a + '-' + b + '.json'), JSON.stringify(pool));
  process.exit(0);
}
if (opt('--pools')) opt('--pools').split(',').forEach(f => { const part = JSON.parse(fs.readFileSync(f, 'utf8')); for (const L in part) pool[L] = (pool[L] || []).concat(part[L]); });
else pool = buildPool(+process.env.K || 6, +process.env.MAXATT || 6000, 1, 100);
const grouped = groupPool(pool);
// fit the growth rate of the target curve to what the pool can deliver
let best = null;
for (let a = 44; a <= 52; a += 1) for (let r = 1.010; r <= 1.022; r += 0.0005) {
  RATE = r; BASE = a;
  try { const sel = select(grouped); let cost = 0, worst = 0; sel.forEach((c, i) => { const d = Math.abs(c.D - targetD(i + 1)) / targetD(i + 1); cost += d; worst = Math.max(worst, d); }); if (!best || worst < best.worst - 1e-9 || (Math.abs(worst - best.worst) < 1e-9 && cost < best.cost)) best = { r, a, cost, worst, sel }; } catch (e) { }
}
if (!best) throw new Error('no strictly increasing selection possible');
RATE = best.r; BASE = best.a;
const sel = best.sel;
const lines = sel.map((c, i) => '["' + c.p + '",' + c.D + ',' + c.tier + ']');
const block = '/*LEVELS-START*/\nvar LEVELS = [\n' + lines.join(',\n') + '\n];\n/*LEVELS-END*/';
if (!args.includes('--dry')) {
  const html = fs.readFileSync(APP, 'utf8');
  fs.writeFileSync(APP, html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, () => block));
}
console.log('target curve: D(L) = 81 - givens (L<=15), ' + BASE + ' x ' + RATE.toFixed(4) + '^(L-15) after');
console.log('levels written:', sel.length, 'D:', sel.map(c => c.D).join(' '));
console.log('max deviation from target: ' + (best.worst * 100).toFixed(1) + '%, mean ' + (best.cost / 100 * 100).toFixed(1) + '%');
