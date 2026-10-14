// Rule unit tests for 五子棋 (apps/gomoku) using the game's own core (extracted between CORE markers).
// Covers: win detection per rule (自由 / 標準 / 連珠), overline handling, renju forbidden moves (三三, 四四, 長連, recursive
// live-three judgement, five priority) with 30 forbidden-move positions, legality per colour, and threat helpers.
// Usage: node tests.js [path/to/index.html]
const fs = require('fs'), path = require('path');
const FILE = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(FILE, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + ';return {setup,clearBoard,play,B,legal,isFive,winLine,isForbidden,forbiddenAt,fivePts,wPts,threatMoves,fourMoves,tsFind,tsMinN,get SZ(){return SZ}};')();
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
// rows: 'X' black, 'O' white, '?' test point (empty), '.' empty. Placed with top-left at (ox, oy) on a 15x15 board.
function setPos(rule, rows, ox = 3, oy = 3) {
  C.setup(15, rule); let q = -1;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const p = (y + oy) * 15 + x + ox;
    if (ch === 'X') C.play(p, 1); else if (ch === 'O') C.play(p, 2); else if (ch === '?') q = p;
  }));
  return q;
}
// ---- 30 renju forbidden-move cases: [name, rows, expectForbidden] ----
const F = [
  ['三三 basic (horizontal + vertical live threes)', ['.........', '.........', '....X....', '....X....', '..XX?....', '.........', '.........'], true],
  ['三三 broken by adjacent white (one three closed)', ['....O....', '....X....', '....X....', '..XX?....', '.........'], false],
  ['四四 two lines (open four + four)', ['.........', '....X....', '....X....', '....X....', '.XXX?....', '.........'], true],
  ['四四 in one line X.X?X.X', ['.........', 'X.X?X.X..', '.........'], true],
  ['長連 overline XXX?XX', ['.........', 'XXX?XX...', '.........'], true],
  ['五連優先: exact five is a win', ['.........', '.XXXX?...', '.........'], false],
  ['五連優先 over 四四 (five + four in other line)', ['.....X...', '.....X...', '.....X...', '.XXXX?...', '.........'], false],
  ['五連優先 over 長連 in another line', ['.....X...', '.....X...', '.....X...', '.XXXX?...', '.....X...', '.....X...', '.........'], false],
  ['偽三: horizontal three whose only straight-four point is an overline point -> not 三三',
    ['.........', '......X..', '......X..', '.....XX..', 'X..XX?...', '......X..', '......X..', '.........'], false],
  ['control for 偽三 case: same without the overline column -> real 三三',
    ['.........', '.........', '.........', '.....X...', 'X..XX?...', '.....X...', '.........', '.........'], true],
  ['三三 with split three X.X? (horizontal) + vertical', ['.........', '....X....', '....X....', '.X.X?....', '.........', '.........'], true],
  ['三三 not formed: one three is closed OXX?', ['.........', '....X....', '....X....', 'OXX?.....'.replace('OXX?', 'OXX?'), '.........'], false],
  ['四三 is allowed', ['.........', '....X....', '....X....', '....X....', '..XX?....', '.........', '.........'], false],
  ['三三三 (three live threes)', ['.......', '.X.X...', '..XX...', '.XX?...', '.......', '.......'], true],
  ['four whose only five point is an overline is not a four -> single four, allowed',
    ['.........', '.....X...', '.....X...', '.....X...', 'XX.XX?...', '.........'], false],
  ['control: X.XXX? + vertical four -> 四四', ['.........', '.....X...', '.....X...', '.....X...', '.X.XX?...', '.........'], true],
  ['edge three (board edge closes it) + live three -> allowed', null, false],
  ['dead three O.XXX.O + live three -> allowed', ['.........', '....X....', '....X....', 'O.?XX.O..', '.........', '.........'], false],
  ['O..XXX..O is live + vertical three -> 三三', ['..........', '...X......', '...X......', 'O..?XX..O.', '..........', '..........'], true],
  ['四四 vertical + anti-diagonal', ['.........', '.........', '......?..', '.....XX..', '....X.X..', '...X..X..', '.........'], true],
  ['五連優先 over 三三', ['.........', '....X....', '....X....', '..XX?XX..', '.........', '.........'], false],
  ['三三 diagonal + anti-diagonal', ['.........', '..X...X..', '...X.X...', '....?....', '.........', '.........', '.........'], true],
  ['white stone in the gap breaks the three (XOX?) + vertical three -> allowed', ['.........', '....X....', '....X....', '.XOX?....', '.........'], false],
  ['四四 with a closed four (OXXX?) + vertical four', ['.........', '....X....', '....X....', '....X....', 'OXXX?....', '.........'], true],
  ['偽三 via 四四 at the extension point -> allowed',
    ['.........', '......X..', '......X..', '.....XX..', 'X..XX?...', '.........', '.........'], false],
  ['single live three only -> allowed', ['.........', '.........', '..XX?....', '.........'], false],
  ['long gap X..X? is not a three -> with vertical three allowed', ['.........', '....X....', '....X....', 'X..X?....', '.........', '.........'], false],
  ['split three XX.? (gap) + vertical split three -> 三三', ['....X....', '.........', '....X....', '.XX.?....', '.........', '.........'], true],
  ['overline in diagonal', ['X........', '.X.......', '..X......', '...?.....', '....X....', '.....X...', '.........'], true],
  ['two closed fours in different lines (OXXX? + vertical XXXO) -> 四四', ['....O....', '....X....', '....X....', '....X....', 'OXXX?....', '.........'], true],
];
// fix up special cases
F[16][1] = 'edge';
for (const [name, rows, exp] of F) {
  let q;
  if (rows === 'edge') { // three against the left edge: ?XX at x=0..2 (closed by edge) + vertical live three at x=0
    C.setup(15, 2); const y = 7; C.play(y * 15 + 1, 1); C.play(y * 15 + 2, 1); C.play((y - 1) * 15 + 0, 1); C.play((y - 2) * 15 + 0, 1); q = y * 15 + 0;
  } else q = setPos(2, rows);
  const got = C.isForbidden(q);
  ok(got === exp, 'forbidden: ' + name + ' expected ' + exp + ' got ' + got);
}
console.log('forbidden cases:', F.length);
// the same 三三 point is legal under 自由 / 標準 rules and for white
{ const rows = F[0][1]; let q = setPos(0, rows); ok(!C.isForbidden(q) && C.legal(q, 1), 'free rule: no forbidden');
  q = setPos(1, rows); ok(!C.isForbidden(q) && C.legal(q, 1), 'standard rule: no forbidden');
  q = setPos(2, rows); ok(!C.legal(q, 1), 'renju: black 三三 illegal'); }
{ // white may make 三三 in renju
  const q = setPos(2, F[0][1].map(r => r.replace(/X/g, 'O'))); ok(C.legal(q, 2), 'renju: white 三三 legal'); }
// ---- win detection per rule ----
function lineRule(rule, row, col) { const q = setPos(rule, ['.', row]); return { q, five: C.isFive(q, col) }; }
ok(lineRule(0, 'XXXX?', 1).five, 'free: black five');
ok(lineRule(0, 'XXX?XX', 1).five, 'free: black overline wins');
ok(lineRule(0, 'OOO?OO', 2).five, 'free: white overline wins');
ok(lineRule(1, 'XXXX?', 1).five, 'standard: black five');
ok(!lineRule(1, 'XXX?XX', 1).five, 'standard: black overline does not win');
ok(!lineRule(1, 'OOO?OO', 2).five, 'standard: white overline does not win');
ok(lineRule(1, 'OO?OO', 2).five, 'standard: white exact five');
ok(lineRule(2, 'XXXX?', 1).five, 'renju: black exact five');
ok(!lineRule(2, 'XXX?XX', 1).five, 'renju: black overline is not five');
ok(lineRule(2, 'OOO?OO', 2).five, 'renju: white overline wins');
ok(!lineRule(0, 'XXX?.', 1).five, 'four is not five');
{ const q = setPos(2, ['.', 'XXX?XX']); ok(C.isForbidden(q) && !C.legal(q, 1), 'renju: black overline forbidden'); }
{ const q = setPos(1, ['.', 'XXX?XX']); ok(!C.isForbidden(q) && C.legal(q, 1), 'standard: overline legal but no win'); }
// winLine returns exactly the five stones
{ setPos(0, ['.', 'XXXXX']); const L = C.winLine(4 * 15 + 3); ok(L && L.length === 5, 'winLine length 5'); }
{ setPos(2, ['.', 'XXXXXX']); ok(!C.winLine(4 * 15 + 3), 'renju: winLine none for black overline'); }
{ setPos(2, ['.', 'OOOOOO']); const L = C.winLine(4 * 15 + 3); ok(L && L.length === 6, 'renju: white overline line'); }
// diagonal / anti-diagonal wins
{ C.setup(15, 0); for (let i = 0; i < 5; i++) C.play((2 + i) * 15 + 2 + i, 2); ok(!!C.winLine(4 * 15 + 4), 'diagonal five'); }
{ C.setup(15, 0); for (let i = 0; i < 5; i++) C.play((10 - i) * 15 + 2 + i, 1); ok(!!C.winLine(8 * 15 + 4), 'anti-diagonal five'); }
// edges / other sizes
{ C.setup(9, 0); for (let i = 0; i < 5; i++) C.play(8 * 9 + 4 + i, 1); ok(!!C.winLine(8 * 9 + 8), '9x9 edge five'); }
{ C.setup(19, 2); for (let i = 0; i < 5; i++) C.play(18 * 19 + i, 1); ok(!!C.winLine(18 * 19), '19x19 corner five (renju black)'); }
// ---- threat helpers ----
{ setPos(0, ['.', '.XXXX.']); ok(C.fivePts(1).length === 2, 'open four has 2 five points'); }
{ setPos(0, ['.', 'OXXXX.']); ok(C.fivePts(1).length === 1, 'closed four has 1 five point'); }
{ setPos(0, ['.', '..XXX..']); ok(C.wPts(1).length === 2, 'open three has 2 open-four points'); }
{ setPos(2, ['.', '..XXX..', '.']); const fourBlocked = C.fivePts(1).length; ok(fourBlocked === 0, 'renju: three has no five point'); }
{ // renju: white four whose block point is forbidden for black -> black cannot block (white wins)
  // block point (?) is a black 三三 point
  const q = setPos(2, ['.........', '....X.X...', '....XX....', '....?OOOOX', '.........']);
  ok(C.fivePts(2).indexOf(q) >= 0 && !C.legal(q, 1), 'renju: forbidden block point');
  ok(C.tsFind(2, 1, false) === q, 'white wins by playing the five point'); }
{ // VCF search: black has a simple 4-3 win (needs 3 moves: 4-3 point, then open four, then five)
  setPos(0, ['.........', '.........', '..XX.....', '.........', '....X....', '....X....', '.........']);
  const n = C.tsMinN(1, 4, false); ok(n === 3, 'four-three wins in 3 (got ' + n + ')'); }
{ // a lone open three wins in 2 (open four, five)
  setPos(0, ['.', '..XXX..']); ok(C.tsMinN(1, 3, false) === 2, 'open three -> win in 2'); }
{ // defender with a four must be answered first (先擋再攻)
  setPos(0, ['..........', '..XXX.....', '..........', '.OOOO.....']); // white four (two five points? .OOOO. open) -> black loses
  ok(C.tsMinN(1, 3, false) === 0, 'cannot win while opponent has an open four'); }
console.log('tests passed', pass, 'failed', fail);
process.exit(fail ? 1 : 0);
