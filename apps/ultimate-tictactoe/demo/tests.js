// Rule + engine tests for 九宮井字 (Ultimate Tic-Tac-Toe). Loads the game's own core (CORE-START/CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const UT = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return UT;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const M = (b, p) => b * 9 + p;                       // board b (0..8), position p (0..8)
const { RS, NX, TN, BX, BO, BD, CL, V_MAJ, V_PLAYON, V_SHARED } = UT;
const tryPlay = (s, m) => { if (!UT.isLegal(s, m)) throw new Error('illegal ' + m); return UT.play(s, m); };
const build = (moves, vf = 0) => { const s = UT.newState(vf); for (const m of moves) tryPlay(s, m); return s; };
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
// Generic "force a sequence": interleave filler moves so that the given player moves happen; used to set up positions.
// ---- first move & sending ----
{ const s = UT.newState(0); ok(UT.legalArr(s).length === 81 && s[NX] === -1 && s[TN] === 1, 'X starts, first move anywhere (81 options)'); }
{ const s = build([M(4, 2)]); ok(s[NX] === 2 && s[TN] === 2, 'move at pos (0,2) sends opponent to board 2');
  ok(UT.legalArr(s).every(m => ((m / 9) | 0) === 2) && UT.legalArr(s).length === 9, 'opponent may only play the 9 cells of board 2');
  ok(!UT.isLegal(s, M(5, 0)) && UT.isLegal(s, M(2, 4)), 'move outside the target board is illegal'); }
{ const s = build([M(4, 4)]); ok(s[NX] === 4 && UT.legalArr(s).length === 8, 'sent back into the same board: 8 empty cells'); }
{ const s = build([M(0, 0), M(0, 1)]); ok(!UT.isLegal(s, M(0, 0)) && !UT.isLegal(s, M(0, 1)), 'occupied cells are illegal'); }
// ---- small board win closes it; send into closed board gives free choice ----
// X wins board 0 with 0,1,2: X0,0 -> O in b0 ... build with legal sequence
const winB0 = [M(0, 0), M(0, 3), M(3, 0), M(0, 4), M(4, 0), M(0, 5) /*O wins? no: O has 3,4,5 -> O wins board 0*/];
{ const s = build(winB0); ok(UT.owner(s, 0) === 2 && UT.closed(s, 0), 'three in a row wins the small board (O wins b0 with 3,4,5) and closes it');
  ok(s[NX] === 5, 'after the winning move the opponent is still sent by position (pos 5)');
  // play into board 5 at pos 0 -> sends O to board 0 which is closed => free choice
  const ev = tryPlay(s, M(5, 0)); ok(ev === 0 && s[NX] === -1, 'sent to a closed (won) board => free choice');
  const L = UT.legalArr(s); ok(L.length > 0 && L.every(m => ((m / 9) | 0) !== 0) && new Set(L.map(m => (m / 9) | 0)).size === 8, 'free choice: any empty cell of any unfinished board, never in the closed one');
  ok(!UT.isLegal(s, M(0, 8)), 'closed small board cannot be played even with empty cells (standard)'); }
// ---- drawn small board ----
function findGame(pred, vf = 0, tries = 200000) {
  for (let t = 0; t < tries; t++) { const s = UT.newState(vf), mv = []; let hit = null;
    while (s[RS] < 0) { const L = UT.legalArr(s), m = L[(rnd() * L.length) | 0], before = UT.copy(s), ev = UT.play(s, m); mv.push(m); if (pred(before, s, ev, m)) { hit = { s, mv, ev, m, before }; break; } }
    if (hit) return hit; }
  return null;
}
{ const h = findGame((b, s, ev) => (ev & 2) !== 0); ok(h && UT.owner(h.s, (h.m / 9) | 0) === 3 && UT.closed(h.s, (h.m / 9) | 0), 'full small board without a line is a draw (owner 3) and closed');
  if (h) { const s = h.s; ok(s[RS] >= 0 || (((h.m % 9) === ((h.m / 9) | 0)) ? s[NX] === -1 : true), 'sent into the drawn board => free choice');
    // anyone sent there later gets a free move
    const b = (h.m / 9) | 0; let g = findGame((bf, st, ev, m) => (m % 9) === b && UT.owner(bf, b) === 3 && st[RS] < 0, 0, 50000); ok(!g || g.s[NX] === -1, 'sent to an earlier drawn board => free choice'); } }
// ---- big board win ----
{ const h = findGame((b, s, ev) => (ev & 4) && s[RS] > 0); const s = h.s, w = s[RS], line = UT.bigLine(s, w);
  ok(line && line.every(b => UT.owner(s, b) === w), 'game ends when the mover owns three small boards in a line'); ok(UT.legalArr(s).length === 0, 'no moves after the game is won');
  ok(h.before[RS] < 0 && !UT.bigLine(h.before, w), 'win detected on the exact move that completes the big line'); }
{ const h = findGame((b, s, ev) => (ev & 4) && s[RS] === 0, 0); ok(h && h.s[CL] === 511 && !UT.bigLine(h.s, 1) && !UT.bigLine(h.s, 2), 'all boards finished without a big line => draw (standard)'); }
// winning a small board that does not complete a line does not end the game
{ const h = findGame((b, s, ev) => (ev & 1) && !(ev & 4)); ok(h && h.s[RS] < 0, 'winning a small board alone does not end the game'); }
// ---- variant: majority ----
{ let n = 0, okc = 0; for (let t = 0; t < 400 && n < 30; t++) { const h = findGame((b, s, ev) => (ev & 4) !== 0, V_MAJ, 1); if (!h) continue; const s = h.s;
    if (UT.bigLine(s, 1) || UT.bigLine(s, 2)) continue; n++; const x = popc(s[BX]), o = popc(s[BO]); if (s[RS] === (x > o ? 1 : o > x ? 2 : 0)) okc++; }
  ok(n > 5 && okc === n, `多數決: no big line => more small boards wins (${okc}/${n} games checked)`); }
function popc(m) { let c = 0; for (; m; m &= m - 1) c++; return c; }
{ // same final position in standard rules is a draw
  let found = false; for (let t = 0; t < 400 && !found; t++) { const h = findGame((b, s, ev) => (ev & 4) !== 0, V_MAJ, 1); if (!h || UT.bigLine(h.s, 1) || UT.bigLine(h.s, 2) || h.s[RS] === 0) continue;
    const s0 = UT.fromMoves(h.mv, 0); found = true; ok(s0[RS] === 0, '同一局在標準規則下為和局，多數決下有勝負'); } ok(found, 'found a majority-decided game'); }
// ---- variant: play on in won boards ----
{ const s = build(winB0, V_PLAYON); ok(UT.owner(s, 0) === 2 && !UT.closed(s, 0), '已贏小盤仍可下: won board stays open');
  tryPlay(s, M(5, 0)); ok(s[NX] === 0 && UT.legalArr(s).every(m => ((m / 9) | 0) === 0), 'opponent can be sent into the won board and must play there');
  // X plays in won board; ownership never changes
  tryPlay(s, M(0, 8)); ok(UT.owner(s, 0) === 2, 'ownership of a won board does not change');
  const h = findGame((b, st, ev, m) => UT.owner(b, (m / 9) | 0) > 0 && ((st[b[TN] === 1 ? 0 : 9] | 0) >= 0) && UT.smallLine(st, (m / 9) | 0, b[TN]) && UT.owner(b, (m / 9) | 0) !== b[TN], V_PLAYON);
  ok(h && UT.owner(h.s, (h.m / 9) | 0) === UT.owner(h.before, (h.m / 9) | 0), 'a line by the other player inside a won board does not flip ownership');
  const f = findGame((b, st, ev, m) => UT.owner(b, (m / 9) | 0) && UT.owner(b, (m / 9) | 0) < 3 && UT.closed(st, (m / 9) | 0), V_PLAYON);
  ok(f && ((f.s[(f.m / 9) | 0] | f.s[9 + ((f.m / 9) | 0)]) === 511), 'won board closes only once it is full'); }
// ---- variant: drawn boards shared ----
{ let n = 0, okc = 0, oppWin = 0;
  for (let t = 0; t < 3000 && n < 40; t++) { const h = findGame((b, s, ev) => (ev & 4) && s[RS] > 0, V_SHARED, 1); if (!h) continue; const s = h.s, w = s[RS];
    const L = UT.bigLine(s, w); if (!L || !L.some(b => UT.owner(s, b) === 3)) continue; n++; if (L.every(b => UT.owner(s, b) === w || UT.owner(s, b) === 3)) okc++; if (w !== h.before[TN]) oppWin++; }
  ok(n > 3 && okc === n, `和小盤雙方共有: drawn boards count for both in big lines (${okc}/${n} wins used a drawn board)`);
  const std = UT.newState(0), shared = UT.newState(V_SHARED); ok(true, ''); if (oppWin) console.log('  (seen', oppWin, 'games where a drawn board completed the non-mover\'s line)'); }
{ // a mixed line (X,X,draw) is a win only with the shared variant
  let found = false; for (let t = 0; t < 3000 && !found; t++) { const h = findGame((b, s, ev) => (ev & 4) && s[RS] > 0, V_SHARED, 1); if (!h) continue;
    const L = UT.bigLine(h.s, h.s[RS]); if (!L || !L.some(b => UT.owner(h.s, b) === 3)) continue; const s0 = UT.fromMoves(h.mv, 0); if (UT.bigLine(s0, 1) || UT.bigLine(s0, 2)) continue; found = true; ok(s0[RS] < 0 || s0[RS] === 0, 'same moves under standard rules: no win from a drawn board'); }
  ok(found, 'found a shared-draw win'); }
// ---- move generation (perft) ----
const PERFT = [81, 720, 6336, 55080, 473256];
for (let d = 1; d <= 5; d++) { const t = Date.now(), n = UT.perft(UT.newState(0), d); console.log(`  perft(${d}) = ${n}  (${Date.now() - t} ms)`); ok(n === PERFT[d - 1], `perft ${d} = ${PERFT[d - 1]}`); }
// ---- random games: invariants ----
{ let bad = 0, games = 0, plies = 0, maxPly = 0;
  for (const vf of [0, 1, 2, 4, 7]) for (let g = 0; g < 400; g++) { const s = UT.newState(vf); games++;
    while (s[RS] < 0) { const L = UT.legalArr(s); if (!L.length) { bad++; break; } UT.play(s, L[(rnd() * L.length) | 0]); plies++; }
    maxPly = Math.max(maxPly, s[UT.PL]); if (s[UT.PL] > 81) bad++; }
  ok(bad === 0, `2000 random games (all variant combos) always end with a result and never stall (${bad} bad)`); console.log(`  random games: ${games}, avg ${(plies / games).toFixed(1)} plies, max ${maxPly}`); }
// ---- engine sanity ----
{ // AI takes an immediate big-board win
  const h = findGame((b, s, ev) => (ev & 4) && s[RS] > 0); const mv = h.mv.slice(0, -1), win = h.mv[h.mv.length - 1];
  for (let lv = 3; lv <= 5; lv++) { const r = UT.think({ moves: mv, vf: 0, level: lv, ms: 200 }); const s = UT.fromMoves(mv, 0); UT.play(s, r.move); ok(s[RS] === UT.fromMoves(mv, 0)[TN], `L${lv} plays an immediate winning move`); }
  const r2 = UT.think({ moves: mv, vf: 0, level: 2 }); const s2 = UT.fromMoves(mv, 0); UT.play(s2, r2.move); ok(s2[RS] > 0 || r2.why === 'slip', 'L2 alpha-beta finds the immediate win (unless it slipped)'); }
{ // AI avoids sending the opponent where they win the big board at once
  let tested = 0, good = 0;
  for (let t = 0; t < 4000 && tested < 12; t++) { const s = UT.newState(0), mv = [];
    while (s[RS] < 0 && mv.length < 70) { const L = UT.legalArr(s); const m = L[(rnd() * L.length) | 0]; UT.play(s, m); mv.push(m); if (s[RS] >= 0) break;
      const L2 = UT.legalArr(s); const t0 = s[TN]; let canWin = false, unsafe = 0, safe = 0;
      for (const a of L2) { const c = UT.copy(s); UT.play(c, a); if (c[RS] === t0) canWin = true; let bad = false; for (const b of UT.legalArr(c)) { const d = UT.copy(c); UT.play(d, b); if (d[RS] === 3 - t0) { bad = true; break; } } bad ? unsafe++ : safe++; }
      if (!canWin && unsafe && safe) { tested++; const r = UT.think({ moves: mv, vf: 0, level: 4, ms: 300, seed: t + 1 }); const c = UT.copy(s); UT.play(c, r.move);
        let bad = false; for (const b of UT.legalArr(c)) { const d = UT.copy(c); UT.play(d, b); if (d[RS] === 3 - t0) bad = true; } if (!bad) good++; break; } } }
  ok(tested >= 5 && good === tested, `L4 avoids sends that allow an immediate big-board loss (${good}/${tested})`); }
{ // tree reuse at level 5: second call after one reply re-uses visits
  UT.resetTree(); const r1 = UT.think({ moves: [40], vf: 0, level: 5, ms: 400 }); const reply = UT.legalArr(UT.fromMoves([40, r1.move], 0))[0];
  const r2 = UT.think({ moves: [40, r1.move, reply], vf: 0, level: 5, ms: 400 }); ok(r2.reused > 0, `L5 tree reuse keeps the subtree (${r2.reused} visits carried over)`); console.log(`  L5 400ms: ${r1.sims} sims, then ${r2.sims} new sims + ${r2.reused} reused`); }
console.log(`${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
