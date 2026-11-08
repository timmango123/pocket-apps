// Skill-tier players for othello (qa/skill-tiers/SPEC.md). Rules (move generation / flips) come from the game's own
// core, which demo/tests.js and rules-xcheck.js check against an independent naive generator. Decisions for
// clumsy..world use this file's own negamax and evaluation (independent of the game's AI); superhuman uses the
// game's own search with 2x the expert's time budget (no stronger engine is available offline).
const fs = require('fs');
const html = fs.readFileSync(require('path').resolve(__dirname, '../../../apps/othello/index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
function mkCore() { return new Function(coreSrc + '\nreturn {initialPos,sides,legalOf,flipsOf,playPos,passPos,isOver,counts,finalCounts,think,analyze,LEVELS,sqName,cellAt,genMoves,calcFlips,listSq,popc,get ML(){return ML},get MH(){return MH},get FL(){return FL},get FH(){return FH}};')(); }
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = R => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const TIERS = {
  clumsy: { react: [650, 200], pos: 40, mistake: 0.15, dec: 'halfRandomGreedy', think: [2500, 1200] },
  casual: { react: [400, 100], pos: 20, mistake: 0.06, dec: 'greedy15', think: [1500, 600] },
  skilled: { react: [260, 50], pos: 10, mistake: 0.02, dec: 'search2', think: [1200, 500] },
  world: { react: [180, 25], pos: 4, mistake: 0.003, dec: 'search6', think: [800, 300] },
  superhuman: { react: [16, 0], pos: 0, mistake: 0, dec: 'engine', think: [0, 0] },
  hint: { react: [0, 0], pos: 0, mistake: 0, dec: 'hint', think: [0, 0] } // degenerate strategy: always play the in-game hint's best move
};
// --- own evaluation: square weights + mobility + corners (classic textbook heuristic) ---
const W = [100, -20, 10, 5, 5, 10, -20, 100, -20, -50, -2, -2, -2, -2, -50, -20, 10, -2, -1, -1, -1, -1, -2, 10, 5, -2, -1, -1, -1, -1, -2, 5,
  5, -2, -1, -1, -1, -1, -2, 5, 10, -2, -1, -1, -1, -1, -2, 10, -20, -50, -2, -2, -2, -2, -50, -20, 100, -20, 10, 5, 5, 10, -20, 100];
function makeBrain(C) {
  const cellAt = (p, s) => C.cellAt(p, s);
  function evalPos(p, me) { // from `me`'s view
    let s = 0, mine = 0, his = 0;
    for (let i = 0; i < 64; i++) { const c = cellAt(p, i); if (c < 0) continue; const w = W[i] * (i === 1 || i === 8 || i === 9 ? (cellAt(p, 0) >= 0 ? 0 : 1) : i === 6 || i === 14 || i === 15 ? (cellAt(p, 7) >= 0 ? 0 : 1) : i === 48 || i === 49 || i === 57 ? (cellAt(p, 56) >= 0 ? 0 : 1) : i === 54 || i === 55 || i === 62 ? (cellAt(p, 63) >= 0 ? 0 : 1) : 1); if (c === me) { s += w; mine++; } else { s -= w; his++; } }
    const q = { b: p.b, w: p.w, turn: me }, mm = C.legalOf(q).length, hm = C.legalOf({ b: p.b, w: p.w, turn: me ^ 1 }).length;
    s += 8 * (mm - hm);
    if (mine + his > 52) s += 6 * (mine - his);
    return s;
  }
  function terminal(p, me) { const fc = C.finalCounts(p); return (fc[me] - fc[me ^ 1]) * 1000; }
  function negamax(p, depth, a, b, me, exact) {
    if (C.isOver(p)) return terminal(p, p.turn);
    let L = C.legalOf(p);
    if (!L.length) return -negamax(C.passPos(p), depth, -b, -a, me, exact);
    if (depth <= 0 && !exact) { const v = evalPos(p, p.turn); return v; }
    let best = -1e9;
    if (!exact) L = L.sort((x, y) => W[y] - W[x]);
    for (const m of L) { const v = -negamax(C.playPos(p, m), depth - 1, -b, -a, me, exact); if (v > best) best = v; if (v > a) a = v; if (a >= b) break; }
    return best;
  }
  // value of each root move from mover's view
  function scoreMoves(p, depth, exact) {
    return C.legalOf(p).map(m => { const q = C.playPos(p, m); let v; if (C.isOver(q)) { const fc = C.finalCounts(q); v = (fc[p.turn] - fc[p.turn ^ 1]) * 1000; } else v = -negamax(q, depth - 1, -1e9, 1e9, p.turn, exact); return { m, v }; }).sort((a, b) => b.v - a.v);
  }
  return { evalPos, scoreMoves, empties: p => 64 - C.counts(p)[0] - C.counts(p)[1] };
}
// pick the intended move for a tier. R = seeded rng
function decide(C, B, tier, p, R) {
  const L = C.legalOf(p); if (!L.length) return -1; if (L.length === 1) return L[0];
  const T = TIERS[tier], rnd = () => L[Math.floor(R() * L.length)];
  if (R() < T.mistake) return rnd();
  const greedy1 = () => L.map(m => ({ m, v: B.evalPos(C.playPos(p, m), p.turn) })).sort((a, b) => b.v - a.v)[0].m;
  switch (T.dec) {
    case 'halfRandomGreedy': return R() < 0.5 ? rnd() : greedy1();
    case 'greedy15': return R() < 0.15 ? rnd() : greedy1();
    case 'search2': return B.empties(p) <= 6 ? B.scoreMoves(p, 6, true)[0].m : B.scoreMoves(p, 2, false)[0].m;
    case 'search6': return B.empties(p) <= 12 ? B.scoreMoves(p, 12, true)[0].m : B.scoreMoves(p, 5, false)[0].m;
    case 'hint': return C.analyze(C.sides(p), 1000).scores[0].sq;
    case 'engine': { const r = C.think(C.sides(p), 5, { ms: 6000, forceSearch: true }); return r.move; }
  }
}
// motor model: tap lands at target + N(0, sigma px); cellPx = on-screen cell size. Returns the square tapped (-1 off board)
function motor(target, sigma, cellPx, R) {
  if (!sigma) return target;
  const x = ((target & 7) + 0.5) * cellPx + gauss(R) * sigma, y = ((target >> 3) + 0.5) * cellPx + gauss(R) * sigma;
  if (x < 0 || y < 0 || x >= 8 * cellPx || y >= 8 * cellPx) return -1;
  return Math.floor(y / cellPx) * 8 + Math.floor(x / cellPx);
}
module.exports = { mkCore, makeBrain, decide, motor, TIERS, rng, gauss };
