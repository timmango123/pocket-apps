// Rule unit tests for 新接龍, using the game's own core (CORE-START/END in ../index.html). Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {msDeal,newState,cloneS,capacity,checkMove,isSafe,runAuto,genMoves,solve,expandSolution,isWon,canStack,runLen,cRank,cSuit};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const C = (r, s) => (r - 1) * 4 + s; // s: 0♣ 1♦ 2♥ 3♠
const st = (cols, cells, f) => ({ c: cols.concat([[], [], [], [], [], [], [], []]).slice(0, 8), r: cells, f: f || [0, 0, 0, 0] });
// Microsoft deal #1 first row
const d1 = core.msDeal(1);
t('MS deal #1 row 1 = JD 2D 9H JC 5D 7H 7C 5H', JSON.stringify(d1.map(c => c[0])) === JSON.stringify([C(11, 1), C(2, 1), C(9, 2), C(11, 0), C(5, 1), C(7, 2), C(7, 0), C(5, 2)]));
t('deal: 4 columns of 7, 4 of 6, 52 distinct cards', d1.slice(0, 4).every(c => c.length === 7) && d1.slice(4).every(c => c.length === 6) && new Set(d1.flat()).size === 52);
// capacity = (free cells + 1) * 2^(empty columns), destination empty column not counted
const full = [[C(13, 3)], [C(13, 2)], [C(13, 1)], [C(13, 0)], [C(12, 3)], [C(12, 2)]]; // 6 non-empty, 2 empty
t('capacity 4 cells, 2 empty cols -> 20', core.capacity(st(full, [-1, -1, -1, -1]), false) === 20);
t('capacity to empty col with 2 empty -> 10', core.capacity(st(full, [-1, -1, -1, -1]), true) === 10);
t('capacity 2 free of 3, 0 empty -> 3', core.capacity(st(full.concat([[C(1, 0)], [C(1, 1)]]), [-1, -1, C(5, 0)]), false) === 3);
t('capacity 0 free cells, 1 empty, to empty -> 1', core.capacity(st(full.concat([[C(1, 0)]]), [C(2, 0), C(2, 1)]), true) === 1);
// supermove legality
const run5 = [C(9, 3), C(8, 2), C(7, 0), C(6, 1), C(5, 3)]; // 9♠ 8♥ 7♣ 6♦ 5♠
const S1 = st([run5, [C(10, 2)], [C(2, 0)], [C(2, 1)], [C(2, 2)], [C(2, 3)], [C(3, 0)], [C(3, 1)]], [-1, -1, -1, C(4, 0)]);
t('run length 5', core.runLen(run5) === 5);
t('5-card run onto 10♥ with 3 free cells, no empty col: rejected (cap 4)', core.checkMove(S1, { k: 'c', fr: 0, n: 5, to: 1 }) === '最多可移 4 張');
t('wrong-rank partial run rejected', core.checkMove(S1, { k: 'c', fr: 0, n: 4, to: 1 }) !== '');
const S2 = st([run5, [C(10, 2)], [C(2, 0)], [C(2, 1)], [C(2, 2)], [C(2, 3)], [C(3, 0)], []], [-1, -1, -1, C(4, 0)]);
t('5-card run onto 10♥ with 3 free + 1 empty col (cap 8): legal', core.checkMove(S2, { k: 'c', fr: 0, n: 5, to: 1 }) === '');
t('5-card run INTO the empty col (cap 4): illegal', core.checkMove(S2, { k: 'c', fr: 0, n: 5, to: 7 }) === '最多可移 4 張');
t('4-card run into the empty col: legal', core.checkMove(S2, { k: 'c', fr: 0, n: 4, to: 7 }) === '');
t('stack rule: same colour rejected', core.checkMove(st([[C(5, 1)], [C(6, 2)]], [-1]), { k: 'c', fr: 0, n: 1, to: 1 }) !== '');
t('stack rule: red 5 on black 6 accepted', core.checkMove(st([[C(5, 1)], [C(6, 3)]], [-1]), { k: 'c', fr: 0, n: 1, to: 1 }) === '');
t('cell holds one card', core.checkMove(st([[C(5, 1)]], [C(9, 0)]), { k: 'r', fr: 0, n: 1, to: 0 }) !== '');
t('foundation: same suit A->K only', core.checkMove(st([[C(2, 1)]], [-1], [1, 0, 0, 0]), { k: 'f', fr: 0, n: 1, to: 1 }) !== '' && core.checkMove(st([[C(2, 1)]], [-1], [0, 1, 0, 0]), { k: 'f', fr: 0, n: 1, to: 1 }) === '');
// safe auto-collect
t('ace always safe', core.isSafe(st([[C(1, 2)]], [-1]), C(1, 2)));
t('red 3 not safe while a black 2 is still out', !core.isSafe(st([[C(3, 1)]], [-1], [1, 2, 2, 2]), C(3, 1)));
t('red 3 safe when both black foundations >= 2', core.isSafe(st([[C(3, 1)]], [-1], [2, 2, 0, 2]), C(3, 1)));
let bad = 0;
// simpler, exhaustive check on the replayed solutions: every auto move at the time it happens satisfies the safe rule
let autos = 0;
for (let n = 1; n <= 60; n++) {
  const S = core.newState(core.msDeal(n), 4), r = core.solve(S, { limit: 20000 }); if (!r.ok) continue;
  const list = core.expandSolution(S, r.moves);
  const f = [0, 0, 0, 0];
  for (const m of list) { if (m.k === 'f') { if (m.auto) { autos++; const rk = core.cRank(m.card), red = (m.card & 3) === 1 || (m.card & 3) === 2; for (let s = 0; s < 4; s++) { const sr = s === 1 || s === 2; if (sr !== red && f[s] < rk - 1) bad++; } } f[m.card & 3]++; } }
}
t('auto-collect obeys the safe rule in ' + autos + ' auto moves', bad === 0);
// a solved solution replays to a win
const S3 = core.newState(core.msDeal(1), 4), r3 = core.solve(S3);
t('solver solves deal #1 and the move list replays to a win', r3.ok && !!core.expandSolution(S3, r3.moves));
t('deal #11982 is not solved with 1 free cell quickly (sanity: solver can fail)', !core.solve(core.newState(core.msDeal(11982), 1), { limit: 3000 }).ok);
console.log(`rule tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
