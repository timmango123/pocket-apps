// Rule unit tests for 飛行棋, run against the game's own core (CORE block of ../index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const AP = new Function(src + ';return AP;')();
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const G = (o) => AP.newGame(Object.assign({ seed: 7 }, o || {}));
function setDie(st, d) { let k = st.k; while (AP.die(st.seed, k) !== d) k++; st.k = k; }   // next roll will be d
function rollTo(st, d) { setDie(st, d); return AP.roll(st); }
function mvFrom(st, c, d, from, stack) { return AP.legal(st, c, d).find(m => m.from === from && !!m.stack === !!stack); }
// relative progress of player o that sits on the same track square as player c's progress p
const sameSq = (c, p, o) => AP.relOf(o, AP.absOf(c, p));

console.log('Geometry');
t('52 distinct outer squares, each colour owns 13', () => {
  eq(new Set(AP.CELL.map(String)).size, 52);
  const n = [0, 0, 0, 0]; for (let a = 0; a < 52; a++) n[AP.colorOf(a)]++; eq(n, [13, 13, 13, 13]);
});
t('track is a closed loop of neighbouring squares (clockwise)', () => {
  for (let a = 0; a < 52; a++) { const p = AP.CELL[a], q = AP.CELL[(a + 1) % 52]; ok(Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1])) === 1, 'gap at ' + a); }
});
t('each colour: 6 runway squares leading from its own entrance to the centre', () => {
  for (let c = 0; c < 4; c++) {
    const tip = AP.CELL[AP.absOf(c, 51)], R = AP.RUN[c]; eq(R.length, 6);
    ok(Math.abs(tip[0] - R[0][0]) + Math.abs(tip[1] - R[0][1]) === 1, 'runway starts next to entrance');
    ok(Math.abs(R[5][0] - 7) + Math.abs(R[5][1] - 7) === 1, 'runway ends next to centre');
  }
});
t('own-colour squares every 4, shortcut square is own colour and crosses the previous colour\'s runway', () => {
  for (let c = 0; c < 4; c++) {
    for (let p = 4; p <= 48; p += 4) eq(AP.colorOf(AP.absOf(c, p)), c, 'p' + p);
    const a = AP.CELL[AP.absOf(c, AP.FLY)], b = AP.CELL[AP.absOf(c, AP.FLY + AP.FLYLEN)], x = AP.RUN[(c + 3) % 4][AP.CROSS_H - 1];
    eq([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], x, 'flight midpoint is the crossed runway square');
  }
});

console.log('Take-off');
t('only a 6 takes off (default), and the take-off does not advance', () => {
  const st = G(); let r = rollTo(st, 5); ok(r.pass, '5 cannot take off'); eq(st.turn, 1);
  st.turn = 0; st.phase = 'roll'; r = rollTo(st, 6); eq(r.moves.length, 1); ok(r.moves[0].takeoff);
  AP.play(st, r.moves[0]); eq(st.pos[0][0], 0, 'on launch point, not on the track');
});
t('house rule: 5 or 6 takes off', () => { const st = G({ rules: { five: true } }); const r = rollTo(st, 5); ok(r.moves && r.moves[0].takeoff); });
t('from the launch point a 1 reaches the start square', () => { const st = G(); st.pos[0][0] = 0; const m = mvFrom(st, 0, 1, 0); eq(m.to, 1); });

console.log('Movement');
t('moves forward clockwise by the die', () => { const st = G(); st.pos[0][0] = 9; eq(mvFrom(st, 0, 1, 9).to, 10); });
t('enters only its own runway: red at 49 + 5 = runway square 54, others pass that entrance', () => {
  const st = G(); st.pos[0][0] = 49; const m = mvFrom(st, 0, 5, 49); eq(m.to, 54); eq(m.path, [50, 51, 52, 53, 54]);
  // yellow passing red's entrance square keeps going on the outer track
  const yp = sameSq(0, 50, 1); st.pos[1][0] = yp; eq(mvFrom(st, 1, 3, yp).path, [yp + 1, yp + 2, yp + 3]); ok(yp + 3 <= 51);
});
t('must hit the centre exactly; extra pips bounce back', () => {
  const st = G(); st.pos[0][0] = 55; const m = mvFrom(st, 0, 6, 55); eq(m.to, 55); eq(m.path, [56, 57, 58, 57, 56, 55]); ok(m.bounce);
  const m2 = mvFrom(st, 0, 3, 55); eq(m2.to, 58);
});
t('reaching the centre with all planes finishes the player', () => {
  const st = G(); st.pos[0] = [58, 58, 58, 55]; st.d = 3; st.phase = 'move'; const ev = AP.play(st, mvFrom(st, 0, 3, 55));
  ok(ev.some(e => e.t === 'goal')); ok(ev.some(e => e.t === 'finish' && e.rank === 1)); eq(st.done, [0]);
});

console.log('Jump & shortcut');
t('landing on own colour jumps 4 to the next own-colour square', () => { const st = G(); st.pos[0][0] = 6; const m = mvFrom(st, 0, 2, 6); ok(m.jump); eq(m.to, 12); });
t('no jump on other colours', () => { const st = G(); st.pos[0][0] = 6; ok(!mvFrom(st, 0, 3, 6).jump); });
t('no jump from the last own-colour square before the runway (48)', () => { const st = G(); st.pos[0][0] = 46; const m = mvFrom(st, 0, 2, 46); ok(!m.jump); eq(m.to, 48); });
t('landing on the shortcut square flies 12 (and does not also jump)', () => { const st = G(); st.pos[0][0] = 29; const m = mvFrom(st, 0, 3, 29); ok(m.fly && !m.jump); eq(m.to, 44); });
t('jump that lands on the shortcut square still flies (jump 28→32, fly 32→44)', () => { const st = G(); st.pos[0][0] = 25; const m = mvFrom(st, 0, 3, 25); ok(m.jump && m.fly); eq(m.to, 44); });
t('only one jump per move: after the flight (44 is own colour) no further jump', () => { const st = G(); st.pos[0][0] = 29; eq(mvFrom(st, 0, 3, 29).to, 44); });
t('flight knocks back opponent planes on the crossed runway square', () => {
  const st = G(); st.pos[0][0] = 29; st.pos[3][0] = 51 + AP.CROSS_H; st.pos[3][1] = 51 + AP.CROSS_H; st.d = 3; st.phase = 'move';
  const ev = AP.play(st, mvFrom(st, 0, 3, 29)); const f = ev.find(e => e.t === 'fly'); eq(f.v.length, 2); eq(st.pos[3].slice(0, 2), [-1, -1]); eq(st.caps[0], 2);
});
t('flight does not touch other runway squares', () => {
  const st = G(); st.pos[0][0] = 29; st.pos[3][0] = 51 + 4; st.d = 3; st.phase = 'move'; AP.play(st, mvFrom(st, 0, 3, 29)); eq(st.pos[3][0], 55);
});

console.log('Captures & stacks');
t('landing on an opponent sends it back to its hangar', () => {
  const st = G(); st.pos[0][0] = 11; st.pos[1][0] = sameSq(0, 15, 1); ok(st.pos[1][0] >= 1); st.d = 4; st.phase = 'move';
  const ev = AP.play(st, mvFrom(st, 0, 4, 11)); ok(ev.some(e => e.t === 'cap')); eq(st.pos[1][0], -1);
});
t('passing over an opponent does not capture', () => {
  const st = G(); st.pos[0][0] = 10; const yp = sameSq(0, 11, 1); st.pos[1][0] = yp; st.d = 3; st.phase = 'move'; AP.play(st, mvFrom(st, 0, 3, 10)); eq(st.pos[1][0], yp);
});
t('capture also happens at the jump target', () => {
  const st = G(); st.pos[0][0] = 6; st.pos[2][0] = sameSq(0, 12, 2); st.d = 2; st.phase = 'move'; AP.play(st, mvFrom(st, 0, 2, 6)); eq(st.pos[2][0], -1); eq(st.pos[0][0], 12);
});
t('default: an opponent stack is captured as a whole', () => {
  const st = G(); st.pos[0][0] = 11; const yp = sameSq(0, 15, 1); st.pos[1][0] = yp; st.pos[1][1] = yp; st.d = 4; st.phase = 'move';
  AP.play(st, mvFrom(st, 0, 4, 11)); eq(st.pos[1].slice(0, 2), [-1, -1]);
});
t('own planes on one square form a stack that can move together or split', () => {
  const st = G(); st.pos[0][0] = 10; st.pos[0][1] = 10; const L = AP.legal(st, 0, 3).filter(m => m.from === 10); eq(L.length, 2);
  const s = L.find(m => m.stack); eq(s.pl, [0, 1]); st.d = 3; st.phase = 'move'; AP.play(st, s); eq(st.pos[0].slice(0, 2), [13, 13]);
  const st2 = G(); st2.pos[0][0] = 10; st2.pos[0][1] = 10; st2.d = 3; st2.phase = 'move'; AP.play(st2, AP.legal(st2, 0, 3).find(m => m.from === 10 && !m.stack)); eq(st2.pos[0].slice(0, 2), [13, 10]);
});
t('house rule 疊子成牆: opponent stack cannot be passed or landed on', () => {
  const st = G({ rules: { wall: true } }); st.pos[0][0] = 10; const yp = sameSq(0, 12, 1); st.pos[1][0] = yp; st.pos[1][1] = yp;
  ok(!mvFrom(st, 0, 2, 10), 'cannot land'); ok(!mvFrom(st, 0, 5, 10), 'cannot pass'); ok(mvFrom(st, 0, 1, 10), 'can stop before');
  const st2 = G({ rules: { wall: false } }); st2.pos[0][0] = 10; st2.pos[1][0] = yp; st2.pos[1][1] = yp; ok(mvFrom(st2, 0, 5, 10), 'no wall without the rule');
});
t('house rule 疊子成牆: a wall on the jump target cancels the jump', () => {
  const st = G({ rules: { wall: true } }); st.pos[0][0] = 6; const bp = sameSq(0, 12, 2); st.pos[2][0] = bp; st.pos[2][1] = bp; const m = mvFrom(st, 0, 2, 6); ok(!m.jump); eq(m.to, 8);
});

console.log('Turn flow');
t('a 6 grants another roll; other numbers pass the turn', () => {
  const st = G(); st.pos[0][0] = 10; let r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === 10)); eq(st.turn, 0); eq(st.phase, 'roll');
  r = rollTo(st, 2); AP.play(st, r.moves.find(m => m.from === 16 || m.from === 10 || true)); eq(st.turn, 1);
});
t('three 6s in a row: turn void and the last-moved plane returns to the hangar', () => {
  const st = G(); st.pos[0][0] = 10;
  let r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === 10));
  r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === st.pos[0][0]));
  const before = st.pos[0][0]; ok(before > 20);
  r = rollTo(st, 6); ok(r.pen, 'penalty'); eq(st.pos[0][0], -1); eq(st.turn, 1);
});
t('three 6s: a plane already on its runway is safe from the penalty', () => {
  const st = G(); st.pos[0][0] = 45;
  let r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === 45)); eq(st.pos[0][0], 51);
  r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === 51)); eq(st.pos[0][0], 57);
  r = rollTo(st, 6); ok(r.pen); eq(st.pos[0][0], 57);
});
t('three 6s with the rule off: the third 6 is played normally', () => {
  const st = G({ rules: { triple: false } }); st.pos[0][0] = 10;
  for (let k = 0; k < 2; k++) { const r = rollTo(st, 6); AP.play(st, r.moves.find(m => m.from === st.pos[0][0])); }
  const r = rollTo(st, 6); ok(!r.pen && r.moves.length > 0); eq(st.sixRuns[0], 1);
});
t('no movable plane: the turn is skipped automatically', () => { const st = G(); const r = rollTo(st, 3); ok(r.pass); eq(st.turn, 1); eq(st.phase, 'roll'); });
t('finished players are skipped; ranking continues until one is left', () => {
  const st = G({ active: [1, 1, 1, 0] }); st.pos[0] = [58, 58, 58, 57]; st.d = 1; st.phase = 'move'; AP.play(st, mvFrom(st, 0, 1, 57));
  eq(st.done, [0]); ok(!st.over); eq(st.turn, 1);
  st.pos[1] = [58, 58, 58, 57]; st.d = 1; st.phase = 'move'; AP.play(st, mvFrom(st, 1, 1, 57)); ok(st.over); eq(st.over.ranking, [0, 1, 2]);
});
t('option: game ends when the first player finishes', () => {
  const st = G({ rules: { first: true } }); st.pos[0] = [58, 58, 58, 57]; st.pos[2][0] = 30; st.d = 1; st.phase = 'move'; AP.play(st, mvFrom(st, 0, 1, 57));
  ok(st.over); eq(st.over.ranking[0], 0); eq(st.over.ranking[1], 2, 'others ranked by progress');
});
t('quick mode: 2 planes each', () => { const st = G({ np: 2 }); eq(st.pos.map(a => a.length), [2, 2, 2, 2]); });
t('empty seats are skipped', () => { const st = G({ active: [1, 0, 1, 0] }); eq(st.pos[1].length, 0); const r = rollTo(st, 3); ok(r.pass); eq(st.turn, 2); });

console.log('Dice & undo fairness');
t('dice sequence is fixed by the seed (same seed, same rolls)', () => { const a = [], b = []; for (let k = 0; k < 50; k++) { a.push(AP.die(99, k)); b.push(AP.die(99, k)); } eq(a, b); });
t('dice are fair-ish: 60 000 rolls within ±2% of 1/6', () => { const n = [0, 0, 0, 0, 0, 0, 0]; for (let k = 0; k < 60000; k++) n[AP.die(12345, k)]++; for (let d = 1; d <= 6; d++) ok(Math.abs(n[d] / 60000 - 1 / 6) < .02, 'face ' + d); });
t('undo (restore the pre-roll clone) gives the same die again', () => { const st = G(); const snap = AP.clone(st); const d1 = AP.roll(st).d; const st2 = AP.clone(snap); eq(AP.roll(st2).d, d1); });

console.log('Computer players');
t('every level returns a legal move index, from any position', () => {
  for (let lv = 1; lv <= 5; lv++) { const st = G(); st.pos[0] = [-1, 10, 10, 30]; st.pos[1][0] = sameSq(0, 14, 1); st.d = 4; st.phase = 'move'; const r = AP.think(st, lv, lv % 3, 3); ok(r.i >= 0 && r.i < AP.legal(st, 0, 4).length); }
});
t('level 3+ takes a capture worth 30 squares over a small advance', () => {
  const st = G(); st.pos[0] = [5, 40, -1, -1]; st.pos[1][0] = sameSq(0, 9, 1); st.d = 4; st.phase = 'move';
  // yellow plane far along its own route (high value)
  st.pos[1][0] = sameSq(0, 9, 1); ok(st.pos[1][0] > 30, 'yellow plane is valuable (' + st.pos[1][0] + ')');
  for (const lv of [3, 4, 5]) { const L = AP.legal(st, 0, 4), r = AP.think(st, lv, 0, 1); eq(L[r.i].from, 5, 'level ' + lv); }
});
t('hint explains its choice', () => { const st = G(); st.pos[0] = [5, -1, -1, -1]; st.pos[1][0] = sameSq(0, 9, 1); const m = mvFrom(st, 0, 4, 5); ok(/撞回/.test(AP.explain(st, m))); });

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
