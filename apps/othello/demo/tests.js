// 黑白棋 rule unit tests. Uses the game's own core (extracted from index.html via CORE markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {initialPos,sides,perft,legalOf,flipsOf,playPos,passPos,isOver,counts,finalCounts,finalDiff,cellAt,setSq,sqName,parseSq,think,analyze,solve,genMoves,listSq,LEVELS,seededRng,openingMoves,dailySeed,get ML(){return ML},get MH(){return MH}};')();

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const sq = C.parseSq;
function posFrom(rows, turn) { // rows: 8 strings, 'X' black, 'O' white, '.' empty; row 1 first
  const p = { b: [0, 0], w: [0, 0], turn: turn || 0 };
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') C.setSq(p, y * 8 + x, 0); else if (ch === 'O') C.setSq(p, y * 8 + x, 1); }));
  return p;
}
// naive mailbox reference move generator
function naiveFlips(p, s) {
  if (C.cellAt(p, s) >= 0) return [];
  const me = p.turn, out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    let x = (s & 7) + dx, y = (s >> 3) + dy; const run = [];
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && C.cellAt(p, y * 8 + x) === (me ^ 1)) { run.push(y * 8 + x); x += dx; y += dy; }
    if (run.length && x >= 0 && x < 8 && y >= 0 && y < 8 && C.cellAt(p, y * 8 + x) === me) out.push(...run);
  }
  return out.sort((a, b) => a - b);
}
function naiveLegal(p) { const r = []; for (let s = 0; s < 64; s++) if (naiveFlips(p, s).length) r.push(s); return r; }

// 1. Initial position
const init = C.initialPos();
ok(C.cellAt(init, sq('d4')) === 1 && C.cellAt(init, sq('e5')) === 1 && C.cellAt(init, sq('d5')) === 0 && C.cellAt(init, sq('e4')) === 0 && init.turn === 0, 'initial setup d4/e5 white, d5/e4 black, black first');
ok(JSON.stringify(C.legalOf(init).map(C.sqName).sort()) === JSON.stringify(['c4', 'd3', 'e6', 'f5']), 'initial 4 legal moves', C.legalOf(init).map(C.sqName));

// 2. Perft vs published values (passes count as a ply)
const KNOWN = [1, 4, 12, 56, 244, 1396, 8200, 55092, 390216, 3005288];
const s0 = C.sides(init); const perftRes = [];
for (let d = 1; d <= 9; d++) { const t = Date.now(), n = C.perft(s0[0], s0[1], s0[2], s0[3], d, false); perftRes.push(`d${d}=${n} (${Date.now() - t}ms)`); ok(n === KNOWN[d], 'perft ' + d, n); }
console.log('perft:', perftRes.join(', '));

// 3. Multi-direction flips happen together
let p = posFrom(['X..X..X.', '.O.O.O..', '..OOO...', 'XOO.OOOX', '..OOO...', '.O.O.O..', 'X..X..X.', '........']);
const f = C.flipsOf(p, sq('d4')).map(C.sqName).sort();
ok(f.length === 17 && JSON.stringify(f) === JSON.stringify(naiveFlips(p, sq('d4')).map(C.sqName).sort()), 'all 8 directions flip at once (17 discs)', f);
const q = C.playPos(p, sq('d4')); ok(C.counts(q)[1] === C.counts(p)[1] - 17 && C.counts(q)[0] === C.counts(p)[0] + 18, 'counts after 8-direction move');

// 4. No wrap-around across edges (h-file to a-file of next row, and diagonals)
p = posFrom(['.......O', 'X.......', '........', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'no east/west wrap (h1 white, a2 black)', C.legalOf(p).map(C.sqName));
p = posFrom(['......OX', '........', '........', '........', '........', '........', '........', '........']);
ok(JSON.stringify(C.legalOf(p).map(C.sqName)) === JSON.stringify(['f1']), 'edge row move f1 only', C.legalOf(p).map(C.sqName));
p = posFrom(['........', '.......O', 'X.......', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'no diagonal wrap', C.legalOf(p).map(C.sqName));
// a move must bracket: run ending in empty or board edge is not legal
p = posFrom(['OOOOOOO.', '........', '........', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'unbracketed run to edge is illegal');

// 5. Bitboard generator == naive generator over 400 random games (every position), flips identical
let positions = 0, mism = 0, games = 0, fullBoards = 0, maxMoves = 0;
const R = C.seededRng(12345);
for (let g = 0; g < 400; g++) {
  let pp = C.initialPos(), n = 0;
  while (!C.isOver(pp)) {
    let L = C.legalOf(pp);
    if (!L.length) { // pass rule: side has no move but game not over -> other side must have one
      const pq = C.passPos(pp); if (!C.legalOf(pq).length) mism++; pp = pq; L = C.legalOf(pp);
    }
    positions++;
    const NL = naiveLegal(pp);
    if (JSON.stringify(L.slice().sort((a, b) => a - b)) !== JSON.stringify(NL)) mism++;
    const m = L[Math.floor(R() * L.length)];
    if (JSON.stringify(C.flipsOf(pp, m).sort((a, b) => a - b)) !== JSON.stringify(naiveFlips(pp, m))) mism++;
    pp = C.playPos(pp, m); n++;
  }
  games++; maxMoves = Math.max(maxMoves, n);
  const c = C.counts(pp); if (c[0] + c[1] === 64) fullBoards++;
  if (n > 60) mism++;
}
ok(mism === 0, 'bitboard vs naive move gen/flips across ' + positions + ' positions', mism);
ok(maxMoves <= 60, 'a game never exceeds 60 moves (board full ends it)', maxMoves);
console.log(`random games: ${games}, positions checked: ${positions}, ended on full board: ${fullBoards}, max moves ${maxMoves}`);

// 6. Pass and double-pass game end
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXO', 'XXXXXX..'], 1); // white to move: g8 brackets?
p = posFrom(['OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', 'OOOOOOX.'], 1);
// white to move: h7 or h8? white at g7 row... check with naive
ok(JSON.stringify(C.legalOf(p)) === JSON.stringify(naiveLegal(p)), 'pass test position legal sanity');
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXX.', 'XXXXXXO.'], 0);
ok(C.legalOf(p).map(C.sqName).includes('h8'), 'black can capture g8 from h8');
p = posFrom(['OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', 'OOOOOOX.'], 0);
ok(C.legalOf(p).length === 0 && !C.isOver(p), 'black has no move but game not over -> must pass');
ok(C.legalOf(C.passPos(p)).length > 0, 'after pass white has a move');
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXX....', '........', '........', '........'], 1);
ok(C.isOver(p), 'neither side can move -> game over (only black discs)');
// 7. Scoring: empties to the winner (WOF), draw
let fc = C.finalCounts(p); ok(fc[0] === 64 && fc[1] === 0, 'WOF: 36 black + 28 empty -> 64-0', fc);
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', '........', '........'], 0);
fc = C.finalCounts(p); ok(fc[0] === 41 && fc[1] === 23, 'WOF: 24 vs 23, 17 empties go to winner black -> 41-23', fc);
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO'], 0);
fc = C.finalCounts(p); ok(fc[0] === 32 && fc[1] === 32 && C.isOver(p), 'full board 32-32 draw');
const sd = C.sides(posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', '........', '........'], 0));
ok(C.finalDiff(sd[0], sd[1], sd[2], sd[3]) === 18, 'finalDiff from side-to-move perspective (41-23 = +18)');

// 8. Handicap corners (player gets corners)
p = C.initialPos(); [0, 63, 7, 56].forEach(s => C.setSq(p, s, 0));
ok(C.counts(p)[0] === 6 && [0, 7, 56, 63].every(s => C.cellAt(p, s) === 0), 'handicap: 4 corners placed for player');
ok(JSON.stringify(C.legalOf(p).sort()) === JSON.stringify(C.legalOf(C.initialPos()).sort()), 'handicap corners do not change opening legality');

// 9. Daily opening deterministic (same date -> same 6 moves), random opening legal
const d1 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261014))), d2 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261014))), d3 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261015)));
ok(d1.length === 6 && JSON.stringify(d1) === JSON.stringify(d2), 'daily opening deterministic', d1.map(C.sqName).join(''));
ok(JSON.stringify(d1) !== JSON.stringify(d3), 'different day -> different daily opening');
console.log('daily opening 2026-10-14:', d1.map(C.sqName).join(''));

// 10. Endgame exact solver == naive minimax on random positions with <= 9 empties
function naiveSolve(p, passed) {
  const L = C.legalOf(p);
  if (!L.length) { if (passed) { const s = C.sides(p); return C.finalDiff(s[0], s[1], s[2], s[3]); } return -naiveSolve(C.passPos(p), true); }
  let best = -999; for (const m of L) best = Math.max(best, -naiveSolve(C.playPos(p, m), false)); return best;
}
let solved = 0, solveBad = 0; const R2 = C.seededRng(99);
for (let g = 0; g < 30; g++) {
  let pp = C.initialPos();
  while (true) { if (C.isOver(pp)) break; if (!C.legalOf(pp).length) pp = C.passPos(pp); const c = C.counts(pp); if (64 - c[0] - c[1] <= 9) break; const L = C.legalOf(pp); pp = C.playPos(pp, L[Math.floor(R2() * L.length)]); }
  if (C.isOver(pp) || !C.legalOf(pp).length) continue;
  const s = C.sides(pp), v = C.solve(s[0], s[1], s[2], s[3], -1e9, 1e9, false, 1), nv = naiveSolve(pp, false);
  solved++; if (v !== nv) solveBad++;
}
ok(solveBad === 0 && solved > 20, 'exact solver matches naive minimax (' + solved + ' positions)', solveBad);

// 11. AI: every level returns a legal move; measure think time on a midgame position
let mid = C.initialPos(); const R3 = C.seededRng(7);
for (let i = 0; i < 20; i++) { if (!C.legalOf(mid).length) mid = C.passPos(mid); const L = C.legalOf(mid); mid = C.playPos(mid, L[Math.floor(R3() * L.length)]); }
if (!C.legalOf(mid).length) mid = C.passPos(mid);
const times = [];
for (let lv = 1; lv <= 5; lv++) {
  const r = C.think(C.sides(mid), lv); times.push(`L${lv} ${C.LEVELS[lv].name}: ${Math.round(r.ms)}ms depth ${r.depth} nodes ${r.nodes}`);
  ok(C.legalOf(mid).includes(r.move), 'level ' + lv + ' returns a legal move');
  ok(r.ms <= C.LEVELS[lv].ms * 1.15 + 30, 'level ' + lv + ' within time budget', Math.round(r.ms));
}
console.log('think (midgame, 40 empties):\n  ' + times.join('\n  '));
// level 1 greedy = max flips (when not making a deliberate mistake)
const g1 = C.LEVELS[1].err; C.LEVELS[1].err = 0; const r1 = C.think(C.sides(mid), 1); C.LEVELS[1].err = g1;
const maxF = Math.max(...C.legalOf(mid).map(m => C.flipsOf(mid, m).length));
ok(C.flipsOf(mid, r1.move).length === maxF, 'level 1 is greedy on flip count');
// level 5 takes a free corner when available
p = posFrom(['.OOOOOX.', '........', '........', '........', '........', '........', '........', '........'], 0);
ok(C.think(C.sides(p), 5).move === sq('a1'), 'expert takes a1 corner');
// 16-empty exact solve within budget (spec: level 5 reads last 16 empties)
let e16 = C.initialPos(); const R4 = C.seededRng(2024);
while (true) { if (C.isOver(e16)) { e16 = C.initialPos(); continue; } if (!C.legalOf(e16).length) e16 = C.passPos(e16); const c = C.counts(e16); if (64 - c[0] - c[1] <= 16) break; const L = C.legalOf(e16); e16 = C.playPos(e16, L[Math.floor(R4() * L.length)]); }
const r16 = C.think(C.sides(e16), 5);
ok(r16.ms <= 3200, 'level 5 at 16 empties answers within 3s', Math.round(r16.ms));
console.log(`level 5 @16 empties: ${Math.round(r16.ms)}ms, exact=${!!r16.exact}, nodes ${r16.nodes}, score ${r16.score}`);
// hint analysis: scores for every legal move, best first
const an = C.analyze(C.sides(mid), 1000);
ok(an.scores.length === C.legalOf(mid).length && an.scores.every((x, i) => i === 0 || an.scores[i - 1].v >= x.v), 'hint analysis scores every move, sorted');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
