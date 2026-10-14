// Offline level generator for 玉珠孤棋 (peg-solitaire). Reuses the game's own core (CORE-START/CORE-END in ../index.html,
// or CORE=<file>). Reverse play from the goal guarantees solvability; the DFS solver (dead-position table + pagoda pruning)
// then finds a chain-preferring solution and measures r.
// Usage: node gen.js pool <from> <to> <pool.json>   (run several ranges in parallel), then
//        node gen.js pick <levels.json> <pool files...>   (dynamic programming picks a strictly increasing D chain)
// r = mean, over the decision points (>= 2 legal moves) of the solution line, of the share of legal moves after which the
//     goal is still reachable (found by the solver within 4000 nodes). Lower r = more traps.
// D = 0.15 * pegs + 6 * (1 - r)   (spec metric). Levels are picked so D strictly increases from level 1 to 100.
// Inject the result into index.html between 'var LEVELS = ' and the closing '];' (one level per line).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.env.CORE || path.join(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {SHAPES, makeBoard, bit, setBit, pegCount, legalMoves, applyMove, goalOf, solve, handsOf, mulberry32, reverseGen, KeySet, B64, PATTERNS, placePattern, encLevel, decLevel, measureR, diffD};')();

function nOf(L) { return Math.min(36, Math.round(6 * Math.pow(1.03, L - 1))); } // spec: n(L) = 6 x 1.03^L, capped at 36 (and by the board)
function plan(L) {
  const P = { shapes: [], goal: 'a', diag: false, rocks: 0 };
  if (L <= 14) P.shapes = L <= 3 ? ['dia13', 'sq5'] : ['dia13', 'sq5', 'heart', 'arrow', 'zhong', 'tian', 'sq6'];
  else if (L <= 29) P.shapes = L % 2 || L === 15 ? ['eng'] : ['heart', 'arrow', 'sq6', 'tian', 'euro'];
  else if (L <= 39) { P.shapes = ['eng', 'euro', 'sq6', 'heart', 'arrow']; P.goal = L % 2 === 0 ? 'c' : 'a'; }
  else {
    const tri = L === 40 || (L % 2 === 0 && L < 70) || (L >= 70 && L % 4 === 2);
    P.shapes = tri ? (L > 55 ? ['hex37'] : ['tri21', 'tri28', 'hex19', 'hex37']) : (L < 60 ? ['eng', 'euro', 'sq6', 'sq7'] : ['eng', 'euro', 'sq7']);
    P.goal = L % 3 === 1 ? 'a' : 'c';
    if (L > 55 && P.goal === 'a') P.goal = 'c';
    if (L >= 60 && (L % 3 === 0)) P.goal = 'p';
    if (L >= 70 && !tri && (L === 70 || L % 3 === 1)) { P.diag = true; P.shapes = ['sq6', 'sq7', 'euro', 'eng']; if (P.goal === 'a') P.goal = 'c'; }
    if (L >= 85 && (L === 85 || L % 2 === 1)) P.rocks = 2 + Math.floor((L - 85) / 6);
  }
  return P;
}
function cand(L, P, n, seed) {
  const rnd = C.mulberry32(L * 100003 + seed * 7919);
  const shape = P.shapes[Math.floor(rnd() * P.shapes.length)];
  let B = C.makeBoard(shape, P.diag);
  let rocks = [];
  if (P.rocks) { const all = [...Array(B.N).keys()]; while (rocks.length < P.rocks) { const c = all[Math.floor(rnd() * all.length)]; if (!rocks.includes(c)) rocks.push(c); } rocks.sort((a, b) => a - b); B = C.makeBoard(shape, P.diag, rocks); }
  const free = B.N - rocks.length;
  if (n > free - 2) n = free - 2;
  let goalCells;
  if (P.goal === 'p') { goalCells = C.placePattern(B, rnd); if (!goalCells) return null; }
  else { let c; do c = Math.floor(rnd() * B.N); while (B.rock[c]); goalCells = [c]; }
  let gen = null;
  for (let t = 0; t < 30 && !gen; t++) gen = C.reverseGen(B, goalCells, n, rnd, 0.25);
  if (!gen) return null;
  const G = C.goalOf(B, P.goal, goalCells);
  const memo = new C.KeySet();
  const sv = C.solve(B, G, gen.s, 80000, memo);
  let sol = gen.sol;
  if (sv.r === 'solved' && C.handsOf(B, sv.path) < C.handsOf(B, sol)) sol = sv.path;
  const m = C.measureR(B, G, gen.s, sol, 4000);
  let fin = gen.s; for (const x of sol) fin = C.applyMove(B, fin, x);
  const finalCells = [...Array(B.N).keys()].filter(i => C.bit(fin, i));
  return { L, shape, diag: P.diag, rocks, goal: P.goal, goalCells: P.goal === 'a' ? finalCells : goalCells, s: gen.s, sol, n: C.pegCount(gen.s), r: m.r, D: C.diffD(C.pegCount(gen.s), m.r), hands: C.handsOf(B, sol) };
}
function fullBoard(L, shape, hole, goalCell) {
  const B = C.makeBoard(shape, false); const s = [0, 0]; for (let i = 0; i < B.N; i++) if (i !== hole) C.setBit(s, i, 1);
  let gc = goalCell;
  if (gc == null) { const a = C.solve(B, C.goalOf(B, 'a', []), s); let x = s; for (const m of a.path) x = C.applyMove(B, x, m); gc = [...Array(B.N).keys()].find(i => C.bit(x, i)); }
  const G = C.goalOf(B, 'c', [gc]); const sv = C.solve(B, G, s);
  const m = C.measureR(B, G, s, sv.path, 4000);
  return { L, shape, diag: false, rocks: [], goal: 'c', goalCells: [gc], s, sol: sv.path, n: C.pegCount(s), r: m.r, D: C.diffD(C.pegCount(s), m.r), hands: C.handsOf(B, sv.path) };
}
const t0 = Date.now();
const mode = process.argv[2];
if (mode === 'pool') {
  // node gen.js pool <from> <to> <out.json> : candidate pool per level (peg counts spread around n(L))
  const from = +process.argv[3], to = +process.argv[4], file = process.argv[5], pool = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  for (let L = from; L <= to; L++) {
    if (L === 55 || L === 100 || (pool[L] && pool[L].length)) continue;
    const P = plan(L), K = nOf(L) < 15 ? 30 : nOf(L) < 24 ? 14 : nOf(L) < 30 ? 9 : 7, list = [];
    for (let seed = 1; list.length < K && seed <= 4 * K; seed++) {
      // pattern endings are much more constrained, so they use fewer pegs to stay on the difficulty curve
      const n = Math.max(4, P.goal === 'p' ? nOf(L) - 3 - (seed % 9) : nOf(L) + (seed % 6) - 3);
      const PP = seed % 4 === 0 && P.goal === 'a' && L >= 30 ? Object.assign({}, P, { goal: 'c' }) : P;
      const c = cand(L, PP, n, seed);
      if (c) list.push(C.encLevel(c).concat([c.n]));
    }
    pool[L] = list;
    fs.writeFileSync(file, JSON.stringify(pool));
    const Ds = list.map(e => e[9] / 1000).sort((a, b) => a - b);
    console.log('L' + L, 'pool', list.length, 'D', Ds[0].toFixed(2), '..', Ds[Ds.length - 1].toFixed(2), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
} else if (mode === 'pick') {
  // node gen.js pick <out.json> <pool files...> : choose one candidate per level so D strictly increases (DP),
  // staying close to an even curve between the fixed anchors (1 -> 55 classic English -> 100 full European).
  const out = process.argv[3], pool = {};
  for (const f of process.argv.slice(4)) Object.assign(pool, JSON.parse(fs.readFileSync(f, 'utf8')));
  const B55 = C.makeBoard('eng'), B100 = C.makeBoard('euro');
  const a55 = C.encLevel(fullBoard(55, 'eng', B55.idx['3,3'], B55.idx['3,3'])).concat([32]), a100 = C.encLevel(fullBoard(100, 'euro', B100.idx['0,4'], null)).concat([36]);
  pool[55] = [a55]; pool[100] = [a100];
  const D = e => e[9] / 1000;
  // Candidates may move up to 8 levels from where they were generated, but never ahead of the level that introduces
  // their mechanic; the introduction levels themselves only take candidates that show the new mechanic.
  const tri = e => C.SHAPES[e[1]][0] !== 'sq', MECH = { 15: e => e[1] === 'eng', 30: e => e[4] === 'c', 40: e => tri(e), 60: e => e[4] === 'p', 70: e => !!e[2], 85: e => !!e[3] };
  const allowed = (L, e) => (e[1] !== 'eng' || L >= 15) && (e[4] !== 'c' || L >= 30) && (!tri(e) || L >= 40) && (e[4] !== 'p' || L >= 60) && (!e[2] || L >= 70) && (!e[3] || L >= 85) &&
    (L >= 15 || ['dia13', 'sq5', 'heart', 'arrow', 'zhong', 'tian', 'sq6'].includes(e[1])) && (!MECH[L] || MECH[L](e)) && (L <= 55 || e[4] !== 'a');
  const all = []; for (const k in pool) if (+k !== 55 && +k !== 100) pool[k].forEach(e => all.push(e));
  const cands = [];
  for (let L = 1; L <= 100; L++) cands[L] = L === 55 ? [a55] : L === 100 ? [a100] : all.filter(e => Math.abs(e[0] - L) <= 8 && allowed(L, e));
  const D1 = Math.min(...cands[1].map(D)), D55 = D(a55), D100 = D(a100);
  const T = L => L <= 55 ? D1 + (D55 - D1) * Math.pow((L - 1) / 54, 0.85) : D55 + (D100 - D55) * (L - 55) / 45;
  const EPS = 0.01, kind = e => e[1] + e[4] + e[2] + (e[3] ? 'r' : '');
  let prev = cands[1].map(e => ({ cost: Math.pow(D(e) - T(1), 2), from: -1 }));
  const back = [null, prev];
  for (let L = 2; L <= 100; L++) {
    const cur = cands[L].map(e => {
      let best = { cost: Infinity, from: -1 };
      cands[L - 1].forEach((pe, j) => {
        if (prev[j].cost === Infinity || D(pe) + EPS > D(e) || pe === e) return;
        const c = prev[j].cost + (kind(pe) === kind(e) ? 0.05 : 0); // prefer variety between neighbours
        if (c < best.cost) best = { cost: c, from: j };
      });
      const nDev = (e[11] - nOf(L)) / 4;
      return { cost: best.cost + Math.pow(D(e) - T(L), 2) + 0.02 * nDev * nDev, from: best.from };
    });
    back.push(cur); prev = cur;
    if (process.env.DBG) { const ok = cur.map((c, i) => c.cost < Infinity ? D(cands[L][i]) : 99); console.log('L' + L, cands[L].length, 'min reachable D', Math.min(...ok).toFixed(2), 'max D', Math.max(...cands[L].map(D)).toFixed(2)); }
    if (!cur.some(c => c.cost < Infinity)) { console.log('NO CHAIN reaching level', L); process.exit(1); }
  }
  let j = 0; const pick = [];
  for (let L = 100; L >= 1; L--) { if (L === 100) j = 0; const e = cands[L][j].slice(0, 11); e[0] = L; pick[L] = e; j = back[L][j].from; }
  // the same candidate can't be picked twice: D strictly increases
  const levels = pick.slice(1);
  fs.writeFileSync(out, JSON.stringify(levels));
  levels.forEach(e => console.log('L' + e[0], e[1] + (e[2] ? '/diag' : '') + (e[3] ? '/rocks' : ''), 'goal', e[4], 'pegs', C.decLevel(e).n, 'r', (e[10] / 1000).toFixed(3), 'D', D(e).toFixed(3), 'target', T(e[0]).toFixed(2), 'hands', e[8]));
}
