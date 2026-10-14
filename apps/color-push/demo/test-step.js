// Unit tests for the step() rules of 積木推推樂, using the core block extracted from the page.
// node test-step.js [path/to/index.html]
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {parseLevel, initState, step, solve, isWon, expandMoves};')();
const U = 0, R = 1, D = 2, Lt = 3;
// level helper: terrain rows and object rows written side by side as "terrain|objects"
function lv(rows, extra) {
  const t = rows.map(r => r.split('|')[0]).join('/'), o = rows.map(r => r.split('|')[1]).join('/');
  return C.parseLevel(Object.assign({ t, o }, extra || {}));
}
const cell = (L, x, y) => y * L.w + x;
let pass = 0, fail = 0;
function check(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
function run(L, moves) { let S = C.initState(L), last = null; for (const d of moves) { last = C.step(L, S, d); if (last) S = last.S; } return { S, last }; }
const colAt = (L, S, c) => { const i = S.pos.indexOf(c); return i < 0 ? -1 : S.col[i]; };

// 1-3 walking
{ const L = lv(['.....|@....']); const r = C.step(L, C.initState(L), R); check('01 walk right', r && !r.push && r.S.p === 1); }
{ const L = lv(['.#...|@....']); const r = C.step(L, C.initState(L), R); check('02 wall blocks walk', r === null && L.why === 'wall'); }
{ const L = lv(['.....|@....']); const r = C.step(L, C.initState(L), Lt); check('03 board edge blocks walk', r === null); }
// 4-8 pushing rows
{ const L = lv(['.....|@a...']); const r = C.step(L, C.initState(L), R); check('04 push one block', r.push && r.S.pos[0] === 2 && r.S.p === 1); }
{ const L = lv(['...#.|.@a..']); const r = C.step(L, C.initState(L), R); check('05 block against wall', r === null && L.why === 'block'); }
{ const L = lv(['.....|@ab..']); const r = C.step(L, C.initState(L), R); check('06 push row of two', r.set.length === 2 && r.S.pos.includes(2) && r.S.pos.includes(3)); }
{ const L = lv(['....|@abc']); const r = C.step(L, C.initState(L), R); check('07 row against edge', r === null); }
{ const L = lv(['......|@acb..']); const r = C.step(L, C.initState(L), R); check('08 mixed colours move together', r.set.length === 3 && colAt(L, r.S, 4) === 1 && colAt(L, r.S, 2) === 0); }
// 9-11 push limit
{ const L = lv(['......|@aaa..'], { P: 3 }); const r = C.step(L, C.initState(L), R); check('09 P=3 pushes three', r && r.set.length === 3); }
{ const L = lv(['.......|@aaaa..'], { P: 3 }); const r = C.step(L, C.initState(L), R); check('10 P=3 refuses four', r === null && L.why === 'heavy'); }
{ const L = lv(['........|@aaaaa..']); const r = C.step(L, C.initState(L), R); check('11 unlimited pushes five', r && r.set.length === 5); }
// 12-16 ice
{ const L = lv(['..~~~.|@a....']); const r = C.step(L, C.initState(L), R); check('12 ice slides to first floor cell', r.S.pos[0] === 5 && r.slid && r.S.p === 1); }
{ const L = lv(['..~~~.|@a...b']); const r = C.step(L, C.initState(L), R); check('13 ice slide stops at a block', r.S.pos[0] === 4); }
{ const L = lv(['...~~.|@ab...']); const r = C.step(L, C.initState(L), R); check('14 row: front slides, back stays', r.S.pos[0] === 2 && r.S.pos[1] === 5); }
{ const L = lv(['.~~~.|@....']); const r = C.step(L, C.initState(L), R); check('15 pusher does not slide', r.S.p === 1); }
{ const L = lv(['..~.~|@a...']); const r = C.step(L, C.initState(L), R); check('16 slide ends on floor after ice', r.S.pos[0] === 3); }
// 17-21 glue
{ const L = lv(['....|.a..', '....|@b..'], { g: [[1, 5]] }); const r = C.step(L, C.initState(L), R); check('17 glued partner follows sideways', r && r.S.pos[0] === 2 && r.S.pos[1] === 6); }
{ const L = lv(['..#.|.a..', '....|@b..'], { g: [[1, 5]] }); const r = C.step(L, C.initState(L), R); check('18 blocked partner stops both', r === null); }
{ const L = lv(['......|@ab...'], { g: [[1, 2]] }); const r = C.step(L, C.initState(L), R); check('19 glued pair pushed in line', r.S.pos[0] === 2 && r.S.pos[1] === 3); }
{ const L = lv(['.......|.a.....', '.......|@bcc...'], { P: 3, g: [[1, 8]] }); const r = C.step(L, C.initState(L), R); check('20 glue counts toward push limit', r === null && L.why === 'heavy'); }
{ const L = lv(['.....|.ac..', '.....|@b...'], { g: [[1, 6]] }); const r = C.step(L, C.initState(L), R); check('21 partner shoves a third block', r && r.S.pos[1] === 3 && r.set.length === 3); }
// 22-23 paint
{ const L = lv(['..2..|@a...']); const r = C.step(L, C.initState(L), R); check('22 paint recolours', r.S.col[0] === 1 && r.paint.length === 1); }
{ const L = lv(['..~3.|@a...']); const r = C.step(L, C.initState(L), R); check('23 slide onto paint recolours', r.S.col[0] === 2 && r.S.pos[0] === 3); }
// 24-27 one-way doors
{ const L = lv(['.>..|@...']); const r = C.step(L, C.initState(L), R); check('24 pass door with arrow', r && r.S.p === 1); }
{ const L = lv(['.<..|@...']); const r = C.step(L, C.initState(L), R); check('25 door against arrow', r === null); }
{ const L = lv(['..<.|@a..']); const r = C.step(L, C.initState(L), R); check('26 block cannot enter door against arrow', r === null); }
{ const L = lv(['..>.|@a..']); const r = C.step(L, C.initState(L), R); check('27 block passes door with arrow', r && r.S.pos[0] === 2); }
// 28-30 win, solver, purity
{ const L = lv(['AB.|ab@']); check('28 win needs matching colours', C.isWon(L, C.initState(L))); const L2 = lv(['AB.|ba@']); check('28b wrong colours not won', !C.isWon(L2, C.initState(L2))); }
{ const L = lv(['.A.A.|.....', '.....|.a.a.', '.....|.@...']); const s = C.solve(L); const ex = C.expandMoves(L, C.initState(L), s.pushes); check('29 solver optimum and replay', s.len === 2 && C.isWon(L, ex.S)); }
{ const L = lv(['.....|@ab..']); const S = C.initState(L), before = JSON.stringify(S); C.step(L, S, R); check('30 step does not mutate input', JSON.stringify(S) === before); }
{ const L = lv(['..~|@a.']); const r = C.step(L, C.initState(L), R); check('31 slide stops at board edge', r && r.S.pos[0] === 2); }
{ const L = lv(['......|.a....', '..~~..|@b....'], { g: [[1, 7]] }); const r = C.step(L, C.initState(L), R); check('32 glued pair slides together while either is on ice', r && r.S.pos[1] === 10 && r.S.pos[0] === 4); }
console.log('step tests:', pass, 'passed,', fail, 'failed');
process.exit(fail ? 1 : 0);
