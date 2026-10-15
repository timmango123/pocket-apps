// Unit tests for the 鏡湖雙影 rule engine, run against the core extracted from ../index.html.
// Usage: node test-core.js
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {parseLevel, initState, step, analyze, MIRROR};')();
const { parseLevel, initState, step, analyze } = core;
let n = 0;
function t(name, fn) { fn(); n++; console.log('  ok', name); }
// helper: level from two 5-wide worlds
const lv = (mode, A, B, g) => parseLevel([mode, A.join('/'), B.join('/'), g || '', 0, 0, 0]);
const at = (L, c) => [c % L.w, (c / L.w) | 0];
const U = 0, R = 1, D = 2, Lf = 3;

t('mirror tables: mode0 L/R flipped, mode1 U/D flipped, mode2 both', () => {
  assert.deepStrictEqual(core.MIRROR[0], [U, Lf, D, R]);
  assert.deepStrictEqual(core.MIRROR[1], [D, R, U, Lf]);
  assert.deepStrictEqual(core.MIRROR[2], [D, Lf, U, R]);
});
const open5 = ['.....', '.....', '..S..', '.....', '....G'];
const openB = ['.....', '.....', '..S..', '.....', 'G....'];
t('mode 0: right moves A right, B left; up moves both up', () => {
  const L = lv(0, open5, openB); let S = initState(L);
  let r = step(L, S, R); assert.deepStrictEqual(at(L, r.S.a), [3, 2]); assert.deepStrictEqual(at(L, r.S.b), [1, 2]);
  r = step(L, r.S, U); assert.deepStrictEqual(at(L, r.S.a), [3, 1]); assert.deepStrictEqual(at(L, r.S.b), [1, 1]);
});
t('mode 1: up moves B down, left moves both left', () => {
  const L = lv(1, open5, openB); const S = initState(L);
  let r = step(L, S, U); assert.deepStrictEqual(at(L, r.S.a), [2, 1]); assert.deepStrictEqual(at(L, r.S.b), [2, 3]);
  r = step(L, S, Lf); assert.deepStrictEqual(at(L, r.S.a), [1, 2]); assert.deepStrictEqual(at(L, r.S.b), [1, 2]);
});
t('mode 2: everything reversed for B', () => {
  const L = lv(2, open5, openB); const S = initState(L);
  let r = step(L, S, U); assert.deepStrictEqual(at(L, r.S.b), [2, 3]);
  r = step(L, S, R); assert.deepStrictEqual(at(L, r.S.b), [1, 2]);
});
t('wall blocks one fox only (錯位); both blocked = no move', () => {
  const L = lv(0, ['.....', '.....', '..S#.', '.....', '....G'], openB); const S = initState(L);
  let r = step(L, S, R); assert.strictEqual(r.S.a, S.a); assert.ok(r.ev.bumpA && !r.ev.bumpB); assert.deepStrictEqual(at(L, r.S.b), [1, 2]);
  const L2 = lv(0, ['.....', '.....', '..S#.', '.....', '....G'], ['G....', '.....', '.#S..', '.....', '.....']);
  assert.strictEqual(step(L2, initState(L2), R), null);
  const L3 = lv(0, ['..S..', '.....', '.....', '.....', '....G'], ['G....', '.....', '..S..', '.....', '.....']);
  r = step(L3, initState(L3), U); assert.ok(r.ev.bumpA, 'map edge blocks too');
});
t('win only when both stand on goals in the same step', () => {
  const L = lv(0, ['.....', '.....', '..SG.', '.....', '.....'], ['.....', '.....', '.GS..', '.....', '.....']);
  const r = step(L, initState(L), R); assert.strictEqual(r.ev.res, 'win');
  const L2 = lv(0, ['.....', '.....', '..SG.', '.....', '.....'], ['G....', '.....', '..S..', '.....', '.....']);
  assert.strictEqual(step(L2, initState(L2), R).ev.res, 'move');
});
t('spike kills', () => {
  const L = lv(0, ['.....', '.....', '..S*.', '.....', '....G'], openB);
  const r = step(L, initState(L), R); assert.strictEqual(r.ev.res, 'dead'); assert.strictEqual(r.ev.dead.why, 'spike');
});
t('button in A opens door in B (only while pressed)', () => {
  const L = lv(0, ['.....', '.....', '..So.', '.....', '....G'], ['G....', '.....', '.DS..', '.....', '.....']);
  let S = initState(L);
  let r = step(L, S, Lf); // A moves left, B tries right (door not involved) -> B moves right
  assert.deepStrictEqual(at(L, r.S.b), [3, 2]);
  r = step(L, S, R); // A onto button; B tries left into closed door -> blocked this step
  assert.ok(r.ev.bumpB); S = r.S;
  r = step(L, S, U); r = step(L, S, D); // stepping off releases the door
  r = step(L, S, Lf); // A leaves button (moves left) while B tries right: door irrelevant
  // A on button, door open: a move where A stays on the button (blocked) lets B pass through the door
  const L2 = lv(0, ['.....', '.....', '..So#', '.....', '....G'], ['G....', '.....', 'D.S..', '.....', '.....']);
  let S2 = initState(L2); S2 = step(L2, S2, R).S; // A on button, B moved left to x=1
  assert.deepStrictEqual(at(L2, S2.b), [1, 2]);
  r = step(L2, S2, R); // A blocked by wall (stays on button) -> B walks into the open door
  assert.ok(r.ev.bumpA); assert.deepStrictEqual(at(L2, r.S.b), [0, 2]);
});
t('ice slides until blocked or plain floor', () => {
  const L = lv(0, ['.....', '.....', 'S~~~.', '.....', '....G'], openB);
  const r = step(L, initState(L), R); assert.deepStrictEqual(at(L, r.S.a), [4, 2]); assert.ok(r.ev.slid);
  const L2 = lv(0, ['.....', '.....', 'S~~#.', '.....', '....G'], openB);
  assert.deepStrictEqual(at(L2, step(L2, initState(L2), R).S.a), [2, 2]);
});
t('teleport swaps the two foxes between worlds (identity flag flips)', () => {
  const L = lv(0, ['.....', '.....', '..ST.', '.....', '....G'], ['G....', '.....', '.S...', '.....', '.....']);
  const S = initState(L); const r = step(L, S, R);
  assert.ok(r.ev.swap); assert.strictEqual(r.S.sw, 1);
  assert.deepStrictEqual(at(L, r.S.a), [0, 2]); assert.deepStrictEqual(at(L, r.S.b), [3, 2]);
});
t('guard moves every step and kills on contact', () => {
  const L = lv(0, ['.....', '.....', '..S..', '.....', '....G'], openB, 'A:14,13');
  let r = step(L, initState(L), R); assert.strictEqual(r.ev.res, 'dead'); assert.strictEqual(r.ev.dead.why, 'guard');
  r = step(L, initState(L), Lf); assert.strictEqual(r.ev.res, 'move'); assert.strictEqual(r.S.ph, 1);
});
t('fragile floor breaks after being left; stepping back in is a fall', () => {
  const L = lv(0, ['.....', '.....', '.xS..', '.....', '....G'], openB);
  let S = initState(L); let r = step(L, S, Lf); assert.strictEqual(r.ev.res, 'move'); S = r.S;
  r = step(L, S, R); S = r.S; assert.ok(r.ev.broke.length === 1);
  r = step(L, S, Lf); assert.strictEqual(r.ev.res, 'dead'); assert.strictEqual(r.ev.dead.why, 'hole');
});
t('BFS returns optimum and fewest bumps among optimal paths', () => {
  const L = lv(0, open5, openB); const r = analyze(L, null, 1e6, true);
  assert.ok(r.len > 0 && r.sol.length === r.len);
  let S = initState(L), last; for (const d of r.sol) { last = step(L, S, d); S = last.S; }
  assert.strictEqual(last.ev.res, 'win');
});
console.log('All', n, 'core rule tests passed');
