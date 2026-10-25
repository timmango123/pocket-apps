// Offline level generator for 數回 (slitherlink). Uses the game's own core.
//   node gen.js pool <band> <count> <seed>   -> appends candidates to pool/band-<b>.json
//   node gen.js select                        -> picks 100 levels with strictly rising difficulty, writes levels.json
// The core (rule engine, grader, generator, level plan) is read from ../index.html, so this always matches the game.
// Candidates go to ./pool (POOL=dir to override; not committed). levels.json is pasted into index.html as LEVELS.
// Every pick is re-checked by indep.js, a separate brute-force counter that shares no code with the game.
const fs = require('fs'), path = require('path');
const CORE_FILE = process.env.CORE || path.join(__dirname, '..', 'index.html');
let src = fs.readFileSync(CORE_FILE, 'utf8'); const m = src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//); if (m) src = m[1];
const C = new Function(src + '\nreturn {makeTopo,genInside,solFromInside,cluesFromSol,fastSolve,gradeSolve,mulberry,encodeLevel,parseLevel,levelParams,BANDS};')();
const POOL = process.env.POOL || path.join(__dirname, 'pool'); fs.mkdirSync(POOL, { recursive: true });
const TECHBITS = { 1: 1, 2: 3, 3: 7, 4: 7 };

function makeCandidate(band, rng, keep) {
  const [L0, W, H, maxLevel, maxChain] = C.BANDS[band];
  const P = C.makeTopo(W, H), N = W * H;
  const inside = C.genInside(W, H, rng, 0.48 + rng() * 0.14, 1.3 + rng() * 1.7);
  const sol = C.solFromInside(P, inside), full = C.cluesFromSol(P, sol);
  P.clue = full.slice();
  const tech = TECHBITS[maxLevel], trial = maxLevel >= 4 ? maxChain : false;
  const pairs = [...Array(N).keys()].filter(i => i <= N - 1 - i);
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const zeros = shuf(pairs.filter(i => full[i] === 0 || full[N - 1 - i] === 0)), rest = shuf(pairs.filter(i => !(full[i] === 0 || full[N - 1 - i] === 0)));
  let count = N;
  for (const i of zeros.concat(rest)) {
    if (keep && count <= keep * N) break;
    const j = N - 1 - i, a = P.clue[i], b = P.clue[j];
    P.clue[i] = -1; P.clue[j] = -1;
    if (C.fastSolve(P, tech, trial).status !== 'solved') { P.clue[i] = a; P.clue[j] = b; }
    else count -= (i === j ? 1 : 2);
  }
  const g = C.gradeSolve(P, maxLevel, maxChain || 30);
  if (g.status !== 'solved') return { bad: 'grade ' + g.status };
  for (let e = 0; e < P.NE; e++) if ((g.S.E[e] === 1) !== (sol[e] === 1)) return { bad: 'mismatch' };
  if (maxLevel >= 2 && !keep) { const g2 = C.gradeSolve(P, maxLevel - 1, 30); if (g2.status === 'solved') return { bad: 'easy' }; }
  const clues = [...P.clue].filter(x => x >= 0), nz = clues.filter(x => x === 0).length;
  return { code: C.encodeLevel(W, H, P.clue, inside), score: g.score, steps: g.steps, trialSteps: g.trialSteps || 0, maxChain: g.maxChain || 0, byT: g.byT, clues: clues.length, zeros: nz, density: +(clues.length / N).toFixed(3) };
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'pool') {
  const band = +rest[0], count = +rest[1], seed = +rest[2] || 1, keepArg = rest[3] ? +rest[3] : 0;
  const file = path.join(POOL, 'band-' + band + (keepArg ? '-k' + keepArg : '') + '.json');
  const pool = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const rng = C.mulberry(seed * 7919 + band * 104729);
  let made = 0, tries = 0; const t0 = Date.now();
  while (made < count && tries < count * 6) {
    tries++;
    const c = makeCandidate(band, rng, keepArg);
    if (c.bad) { continue; }
    if (c.zeros > Math.max(2, c.clues * 0.2)) continue;
    c.seed = seed; pool.push(c); made++;
    fs.writeFileSync(file, JSON.stringify(pool));
  }
  console.log('band', band, C.BANDS[band].join('/'), 'made', made, 'tries', tries, ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
module.exports = { C, makeCandidate };

// ---- relax: add clue pairs back (from the full clue set) to bring a candidate's difficulty down toward `target` ----
function grade(band, code) {
  const [L0, W, H, maxLevel, maxChain] = C.BANDS[band];
  const P = C.parseLevel(code), g = C.gradeSolve(P, maxLevel, maxChain || 30);
  if (g.status !== 'solved') return null;
  if (maxLevel >= 2) { const g2 = C.gradeSolve(P, maxLevel - 1, 30); if (g2.status === 'solved') return null; }
  const clues = [...P.clue].filter(x => x >= 0);
  return { code, score: g.score, steps: g.steps, trialSteps: g.trialSteps || 0, maxChain: g.maxChain || 0, byT: g.byT, clues: clues.length, zeros: clues.filter(x => x === 0).length, density: +(clues.length / P.NC).toFixed(3) };
}
function relax(band, cand, target, rng) {
  let cur = cand;
  for (let round = 0; round < 12 && cur.score > target * 1.04; round++) {
    const P = C.parseLevel(cur.code), full = C.cluesFromSol(P, P.sol), N = P.NC;
    const opts = [];
    for (let i = 0; i < N; i++) if (i <= N - 1 - i && P.clue[i] < 0) opts.push(i);
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    let best = null;
    for (const i of opts.slice(0, 6)) {
      const cl = P.clue.slice(); cl[i] = full[i]; cl[N - 1 - i] = full[N - 1 - i];
      if (full[i] === 0 && full[N - 1 - i] === 0) continue;
      const g = grade(band, C.encodeLevel(P.W, P.H, cl, P.inside));
      if (!g || g.score >= cur.score) continue;
      if (!best || Math.abs(Math.log(g.score / target)) < Math.abs(Math.log(best.score / target))) best = g;
    }
    if (!best) break;
    cur = best;
  }
  return cur;
}
// anchor targets (level -> score), geometric in between
const ANCH = [[1, 27], [4, 36], [7, 50], [10, 66], [14, 92], [20, 122], [26, 146], [32, 176], [37, 206], [43, 245], [49, 285], [55, 330], [61, 380], [67, 440], [73, 510], [79, 590], [85, 680], [91, 790], [95, 900], [98, 1000], [100, 1080]];
function targetOf(L) { for (let i = 0; i + 1 < ANCH.length; i++) { const [a, sa] = ANCH[i], [b, sb] = ANCH[i + 1]; if (L >= a && L <= b) return sa * Math.pow(sb / sa, (L - a) / (b - a)); } return 1000; }
const IND = require('./indep.js'), IC_FILE = path.join(POOL, 'indep-cache.json');
const indCache = new Map(fs.existsSync(IC_FILE) ? Object.entries(JSON.parse(fs.readFileSync(IC_FILE, 'utf8'))) : []);
const saveIC = () => fs.writeFileSync(IC_FILE, JSON.stringify(Object.fromEntries(indCache)));
function indepOK(code) {
  if (indCache.has(code)) return indCache.get(code);
  const P = C.parseLevel(code), t = Date.now(), r = IND.countSolutions(P.W, P.H, Array.from(P.clue), 2), ms = Date.now() - t;
  const okk = r.count === 1 && r.inside.every((v, i) => v === P.inside[i]) && ms < 1500;
  if (!okk) console.log('   reject (indep', r.count, ms + 'ms)');
  indCache.set(code, okk); saveIC(); return okk;
}
if (cmd === 'select') {
  const rng = C.mulberry(4242);
  const load = f => fs.existsSync(path.join(POOL, f)) ? JSON.parse(fs.readFileSync(path.join(POOL, f), 'utf8')) : [];
  const tut = { 1: load('band-0-k0.62.json'), 2: load('band-0-k0.55.json'), 3: load('band-0-k0.5.json') };
  const bandPool = {};
  const relaxCache = fs.existsSync(path.join(POOL, 'relaxed.json')) ? JSON.parse(fs.readFileSync(path.join(POOL, 'relaxed.json'), 'utf8')) : {};
  const candsOf = [];
  for (let L = 1; L <= 100; L++) {
    const pr = C.levelParams(L), b = pr.band, tgt = targetOf(L);
    if (tut[L] && tut[L].length) { candsOf[L] = tut[L].filter(c => indepOK(c.code)); continue; }
    if (!bandPool[b]) bandPool[b] = load('band-' + b + '.json').filter(c => indepOK(c.code));
    let list = bandPool[b].slice();
    const minS = Math.min(...list.map(c => c.score));
    if (minS > tgt * 1.06 && pr.maxLevel >= 2 && pr.W * pr.H <= 120) {
      const key = 'L' + L;
      if (!relaxCache[key]) {
        relaxCache[key] = [];
        for (const c of list.slice().sort((x, y) => x.score - y.score).slice(0, 5)) { const r = relax(b, c, tgt, rng); if (r.code !== c.code && indepOK(r.code)) relaxCache[key].push(r); }
        fs.writeFileSync(path.join(POOL, 'relaxed.json'), JSON.stringify(relaxCache));
      }
      list = list.concat(relaxCache[key]);
    }
    candsOf[L] = list;
  }
  // DP: one candidate per level, strictly rising score, close to the target curve, no big jumps
  const cost = [], from = [];
  const dev = (s, L) => { const d = Math.log(s / targetOf(L)); return d * d * 40; };
  const jump = r => { const lr = Math.log(r); if (lr > Math.log(1.106)) return 1e4; return (lr > Math.log(1.09) ? (lr - Math.log(1.09)) ** 2 * 900 : 0) + (lr < Math.log(1.004) ? 5 : 0); };
  for (let L = 1; L <= 100; L++) {
    cost[L] = []; from[L] = [];
    candsOf[L].forEach((c, i) => {
      if (L === 1) { cost[L][i] = dev(c.score, 1); from[L][i] = -1; return; }
      let best = Infinity, bj = -1;
      candsOf[L - 1].forEach((p, j) => { if (!(cost[L - 1][j] < Infinity) || !(c.score > p.score) || c.code === p.code) return; const v = cost[L - 1][j] + jump(c.score / p.score); if (v < best) { best = v; bj = j; } });
      cost[L][i] = best + dev(c.score, L); from[L][i] = bj;
    });
  }
  // distinct codes across levels in the same band: re-check after backtracking (strict rise already makes them distinct)
  let bi = -1, bc = Infinity; cost[100].forEach((v, i) => { if (v < bc) { bc = v; bi = i; } });
  if (bi < 0 || !(bc < Infinity)) { console.log('DP failed'); process.exit(1); }
  const pick = []; for (let L = 100; L >= 1; L--) { pick[L] = candsOf[L][bi]; bi = from[L][bi]; }
  const out = []; let prev = 0;
  for (let L = 1; L <= 100; L++) {
    const c = pick[L], b = C.levelParams(L).band;
    console.log('L' + L, C.BANDS[b].slice(1).join('/'), 'score', c.score, 'target', Math.round(targetOf(L)), 'step', prev ? '+' + ((c.score / prev - 1) * 100).toFixed(1) + '%' : '', 'dens', c.density, 'trials', c.trialSteps, 'chain', c.maxChain, c.relaxedFrom || c.code !== undefined && relaxCacheHas(c.code) ? '(relaxed)' : '');
    out.push({ L, band: b, ...c, target: Math.round(targetOf(L)) }); prev = c.score;
  }
  function relaxCacheHas(code) { for (const k in relaxCache) if (relaxCache[k].some(x => x.code === code)) return true; return false; }
  const codes = new Set(out.map(o => o.code)); if (codes.size !== 100) { console.log('DUPLICATES'); process.exit(1); }
  fs.writeFileSync(path.join(__dirname, 'levels.json'), JSON.stringify(out, null, 0));
  console.log('total cost', bc.toFixed(2));
}
