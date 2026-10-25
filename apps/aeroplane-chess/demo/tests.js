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
t('rewind (undo): the die already seen at the restored roll stays, every later die is re-drawn (no scouting, no re-roll fishing)', () => {
  const st = G(); st.pos[0][0] = 10; const snap = AP.clone(st); const seen = [];
  for (let n = 0; n < 30; n++) { const r = AP.roll(st); seen.push(r.d); if (r.moves && r.moves.length) AP.play(st, 0); }
  const back = AP.rewind(st, snap, 4242); eq(back.k, snap.k); eq(AP.roll(AP.clone(back)).d, seen[0], 'same die at the restored index');
  const later = []; for (let k = snap.k + 1; k < snap.k + 30; k++) later.push(AP.dieAt(back, k));
  ok(later.join('') !== seen.slice(1).join(''), 'later dice re-drawn');
  // a second undo from the rewound line keeps what was seen on that line
  const again = AP.clone(back); AP.roll(again); const d2 = AP.dieAt(again, back.k); const back2 = AP.rewind(again, back, 99); eq(AP.dieAt(back2, back.k), d2); eq(d2, seen[0]);
  // saved games from before (no pin/rs fields) roll exactly as before
  const old = JSON.parse(JSON.stringify(G())); eq(AP.dieAt(old, 3), AP.die(old.seed, 3));
});
t('undo (restore the pre-roll clone) gives the same die again', () => { const st = G(); const snap = AP.clone(st); const d1 = AP.roll(st).d; const st2 = AP.clone(snap); eq(AP.roll(st2).d, d1); });

console.log('Computer players');
t('every level returns a legal move index, from any position', () => {
  for (let lv = 1; lv <= 5; lv++) { const st = G(); st.pos[0] = [-1, 10, 10, 30]; st.pos[1][0] = sameSq(0, 14, 1); st.d = 4; st.phase = 'move'; const r = AP.think(st, lv, lv % 3, 3); ok(r.i >= 0 && r.i < AP.legal(st, 0, 4).length); }
});
t('level 3+ takes a capture worth 30 squares over a small advance', () => {
  const st = G(); st.pos[0] = [5, 40, -1, -1]; st.pos[1][0] = sameSq(0, 9, 1); st.d = 4; st.phase = 'move';
  // yellow plane far along its own route (high value)
  st.pos[1][0] = sameSq(0, 9, 1); ok(st.pos[1][0] > 30, 'yellow plane is valuable (' + st.pos[1][0] + ')');
  for (const lv of [3, 4]) { const L = AP.legal(st, 0, 4), r = AP.think(st, lv, 0, 1); eq(L[r.i].from, 5, 'level ' + lv); }
});
t('Lv5 is clearly stronger than Lv4 (first place vs three Lv3, quick 2-plane games to the first finisher, 80 fixed seeds each)', () => {
  const N = 80, rate = lv => { let first = 0; for (let g = 0; g < N; g++) { const seed = 50000 + g * 7919, st = AP.newGame({ seed, np: 2, rules: { five: true, first: true, triple: true } }), seat = g % 4; let k = 0;
    while (!st.over && ++k < 20000) { const r = AP.roll(st); if (!r.moves || !r.moves.length) continue; AP.play(st, AP.think(st, st.turn === seat ? lv : 3, st.turn === seat ? 0 : st.turn % 3, seed * 3 + k).i); }
    if (st.over.ranking[0] === seat) first++; } return first / N; };
  const r4 = rate(4), r5 = rate(5); console.log('        Lv4 ' + (r4 * 100).toFixed(1) + '%  Lv5 ' + (r5 * 100).toFixed(1) + '%');
  ok(r5 >= 0.4 && r5 - r4 >= 0.1, 'Lv5 ' + r5 + ' vs Lv4 ' + r4);
});
t('hint explains its choice', () => { const st = G(); st.pos[0] = [5, -1, -1, -1]; st.pos[1][0] = sameSq(0, 9, 1); const m = mvFrom(st, 0, 4, 5); ok(/撞回/.test(AP.explain(st, m))); });

// ---------------- in the real page (mobile Chromium, real CDP touch): one regression check per review finding ----------------
const APP = path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser = null, tid = 1;
async function at(name, fn) { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; const t0 = Date.now(); let tm; try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); } catch (e) { clearTimeout(tm); fail++; console.log('  FAIL', name, '-', String(e.message || e).split('\n')[0]); } }
async function open(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
  if (o.settings || o.stats) await ctx.addInitScript(([a, b]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); if (a) localStorage.setItem('aeroplane.settings', a); if (b) localStorage.setItem('aeroplane.stats', b); } }, [o.settings ? JSON.stringify(o.settings) : null, o.stats ? JSON.stringify(o.stats) : null]);
  await ctx.addInitScript(() => { window.__clears = 0; const f = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function (...a) { window.__clears++; return f.apply(this, a); }; });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (x, y, hold = 40) => { const id = tid++; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const box = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); return page.locator(sel).boundingBox(); };
  const tapSel = async sel => { const b = await box(sel); await tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(120); };
  const gs = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state())));
  const until = async (pred, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { const g = await gs(); if (await pred(g)) return g; await sleep(60); } throw new Error('timeout waiting'); };
  // play the human seat (0) with real taps until pred(state) holds
  const playUntil = async (pred, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { const g = await gs(); if (await pred(g)) return g;
    if (g.human && !g.busy && g.ui === 'await-roll') await tapSel('#diceBtn');
    else if (g.human && !g.busy && g.ui === 'choose') { if (g.chooser) await tapSel('#chOne'); else { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await page.evaluate(i => window.__game.planeXY(0, i), L[0].pl[0]); await tap(x, y); } }
    await sleep(90); } throw new Error('timeout playing'); };
  // put the human (red, seat 0) back to "your roll" in a known position, with a seed whose next die is <= maxDie: no waiting on the computers or on luck
  const reset = async (pos, maxDie = 4) => { await until(g => g.human && !g.busy && (g.ui === 'await-roll' || g.ui === 'choose'), 60000);
    await page.evaluate(([pos, maxDie]) => { G.turn = 0; G.phase = 'roll'; G.sixes = 0; G.last = []; G.pin = null; G.rs = null; G.pos[0] = pos.slice();
      for (let q = 1; q < 1000; q++) { G.seed = q; if (AP.dieAt(G, G.k) <= maxDie) break; } undoStack.length = 0; flow(); }, [pos, maxDie]);
    return until(g => g.human && !g.busy && g.ui === 'await-roll'); };
  // the next new game starts with seat 0 one roll from winning: the first finisher ends it, seat 0's first die d is 1..4 and its last plane is d short of home
  const nearWin = () => page.evaluate(() => { const ng = AP.newGame; AP.newGame = o => { AP.newGame = ng; const st = ng(o); st.rules.first = true;
    for (let q = 1; q < 1000; q++) { st.seed = q; const d = AP.dieAt(st, st.k); if (d <= 4) { st.pos[0] = st.pos[0].map((p, i) => i ? AP.GOAL : AP.GOAL - d); break; } } return st; }; });
  return { ctx, page, errors, tap, tapSel, box, gs, until, playUntil, reset, nearWin, close: () => ctx.close() };
}
const PLAY = { tut: true, speed: 4 };   // skip the auto tutorial, computers at 4x
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch)');
  try {
    await at('first visit: 開始飛行 is on screen without scrolling (360x640, 390x844), no dead 回到棋盤, 5-or-6 take-off on by default', async () => {
      for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }]) {
        const s = await open(vp);
        const r = await s.page.$eval('#mStart', b => { const q = b.getBoundingClientRect(); return [q.top, q.bottom, innerHeight]; });
        ok(r[0] >= 0 && r[1] <= r[2], 'start button at ' + r); ok(!(await s.page.isVisible('#mClose')), '回到棋盤 shown before any game');
        await s.tapSel('#mAdv summary'); ok(await s.page.$eval('[data-rule="five"]', b => b.getAttribute('aria-checked') === 'true'), 'five rule default');
        eq(s.errors, []); await s.close();
      }
    });
    await at('menu controls are all at least 44px tall; overlays use no backdrop blur', async () => {
      const s = await open({ width: 360, height: 640 }); await s.tapSel('#mAdv summary');
      const small = await s.page.$$eval('#menu button, #menu summary', bs => bs.filter(b => b.offsetParent).map(b => [b.textContent.trim().slice(0, 8), Math.round(b.getBoundingClientRect().height)]).filter(x => x[1] < 44));
      eq(small, [], 'small controls'); const bf = await s.page.$eval('#menu', e => getComputedStyle(e).backdropFilter); ok(!bf || bf === 'none', 'backdrop ' + bf); await s.close();
    });
    await at('first start opens the tutorial; touch screens show no keyboard hints (空白鍵 / Shift)', async () => {
      const s = await open({ width: 390, height: 844 }); await s.tapSel('#mStart'); await sleep(300);
      ok(await s.page.isVisible('#tut'), 'tutorial shown'); await s.tapSel('#tutSkip');
      const txt = (await s.page.textContent('#rollTip')) + (await s.page.textContent('#status'));
      ok(!/空白鍵|Shift/.test(txt), txt); await s.page.evaluate(() => window.__game.setSpeed(1));
      await s.playUntil(g => !g.human && g.ui !== 'await-roll'); await sleep(200);
      ok(!/Shift/.test(await s.page.textContent('#rollTip')), 'cpu rollTip');
      await s.tapSel('#bMenu'); await s.tapSel('#mHelp'); ok(!/空白鍵|Shift/.test(await s.page.textContent('#helpBody')), 'help');
      eq(s.errors, []); await s.close();
    });
    await at('悔棋 is enabled on your turn and rewinds; the restored roll keeps its die, the game is marked and not recorded', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: PLAY }); await s.tapSel('#mStart');
      await s.reset([10, 30, -1, -1]); await s.tapSel('#diceBtn');
      let g = await s.until(g => g.human && g.ui === 'choose' && !g.busy); const d1 = g.st.d, k1 = g.st.k - 1;
      ok(!(await s.page.$eval('#bUndo', b => b.disabled)), 'undo enabled while choosing');
      const [x, y] = await s.page.evaluate(() => window.__game.planeXY(0, 1)); await s.tap(x, y); await sleep(150); if ((await s.gs()).chooser) await s.tapSel('#chOne');
      // the three computers play at 4x, then it is your roll again
      g = await s.until(g => g.human && !g.busy && g.ui === 'await-roll' && g.st.k > k1 + 1, 60000);
      ok(!(await s.page.$eval('#bUndo', b => b.disabled)), 'undo enabled while waiting to roll');
      await s.tapSel('#bUndo'); g = await s.until(g => g.undo === 1 && !g.busy && g.ui === 'await-roll');
      ok(g.human, 'your turn after undo'); eq(g.st.k, k1, 'back at the earlier roll'); ok(g.st.pin && g.st.pin.k === k1 && g.st.pin.d === d1, 'die pinned: ' + JSON.stringify(g.st.pin));
      await s.tapSel('#diceBtn'); g = await s.until(g => g.human && g.ui === 'choose' && !g.busy);   // two planes can move, so it waits for you: no race with the computers
      eq(g.st.d, d1, 'same die after undo'); eq(g.st.pos[0], [10, 30, -1, -1], 'position restored');
      // finish the game on the next roll (others home, the last plane exactly one die short)
      await s.page.evaluate(() => { G.turn = 0; G.phase = 'roll'; G.sixes = 0; G.last = []; G.pin = null; G.rs = null; G.rules.first = true;
        for (let q = 1; q < 1000; q++) { G.seed = q; const d = AP.dieAt(G, G.k); if (d <= 4) { G.pos[0] = G.pos[0].map((p, i) => i ? AP.GOAL : AP.GOAL - d); break; } } undoStack.length = 0; flow(); });
      await s.until(g => g.human && !g.busy && g.ui === 'await-roll'); await s.tapSel('#diceBtn'); await s.playUntil(g => g.resultVisible, 30000); await sleep(300);
      ok(/不計入戰績/.test(await s.page.textContent('#rSub')), 'result note');
      const stt = await s.page.evaluate(() => JSON.parse(localStorage.getItem('aeroplane.stats') || '{}'));
      ok(!stt.games, 'undo game not counted: ' + stt.games); eq(s.errors, []); await s.close();
    });
    await at('tutorial step ① draws its rings (tutHL 0 is not skipped)', async () => {
      const s = await open({ width: 390, height: 844 }); await s.page.evaluate(() => { window.__tut = []; const f = window.drawTut; window.drawTut = function (t) { window.__tut.push(tutHL); return f(t); }; });
      await s.tapSel('#mStart'); await sleep(500); ok(await s.page.isVisible('#tut'), 'tutorial shown');
      const seen = await s.page.evaluate(() => window.__tut); ok(seen.includes(0), 'drawTut called on step 1: ' + seen.slice(0, 5)); eq(s.errors, []); await s.close();
    });
    await at('first visit preselects 快速 2 架; Lv5 shows 作弊級 on the level picker and the player card, and the card subtitle fits at 390px', async () => {
      const s = await open({ width: 390, height: 844 });
      ok(await s.page.$eval('#mMode button[data-v="2"]', b => b.classList.contains('on')), 'quick mode preselected'); await s.tapSel('#mAdv summary');
      for (let n = 0; n < 3; n++) await s.tapSel('[data-lv="1"][data-seat="1"]');
      ok(/作弊級/.test(await s.page.textContent('#seats .seat:nth-child(2) .step span')), 'stepper says 作弊級');
      await s.tapSel('[data-lv="1"][data-seat="2"]');   // and a Lv4 card, the longest non-cheat name
      await s.tapSel('#mStart'); await sleep(300); if (await s.page.isVisible('#tut')) await s.tapSel('#tutSkip'); await sleep(300);
      const subs = await s.page.$$eval('.pc .sub', es => es.map(e => [e.textContent, e.scrollWidth <= e.clientWidth + 1]));
      ok(subs.some(x => /作弊級/.test(x[0])), 'card says 作弊級: ' + subs.map(x => x[0]));
      ok(subs.every(x => x[1]), 'cut-off subtitle: ' + subs.filter(x => !x[1]).map(x => x[0])); eq(s.errors, []); await s.close();
    });
    await at('a missed tap with several movable planes pulses them (feedback, no move)', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: Object.assign({}, PLAY, { auto: false }) }); await s.tapSel('#mStart');
      await s.until(g => g.human && !g.busy && g.ui === 'await-roll');
      await s.page.evaluate(() => { const st = window.__game.state().st; st.pos[0] = [10, 30, -1, -1]; for (let q = 1; q < 1000; q++) { st.seed = q; if (AP.dieAt(st, st.k) <= 4) break; } });
      await s.tapSel('#diceBtn'); let g = await s.until(g => g.ui === 'choose' && !g.busy);
      const bb = await s.page.$eval('#boardBox', e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      await s.tap(bb[0] + bb[2] / 2, bb[1] + bb[3] / 2); await sleep(200); g = await s.gs();
      eq(g.ui, 'choose', 'still choosing'); ok(g.nudges >= 1, 'nudged ' + g.nudges); eq(s.errors, []); await s.close();
    });
    await at('a computers-only game does not count as your game', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: Object.assign({}, PLAY, { np: 2, seats: [{ t: 'c', lv: 2, pe: 0 }, { t: 'c', lv: 2, pe: 1 }, { t: 'x' }, { t: 'x' }], rules: { five: true, first: true, triple: true, wall: false } }) });
      await s.nearWin(); await s.tapSel('#mStart'); await s.until(g => g.resultVisible, 30000);
      const stt = await s.page.evaluate(() => JSON.parse(localStorage.getItem('aeroplane.stats') || '{}'));
      ok(!stt.games && !(stt.colorGames || []).some(Boolean), JSON.stringify(stt)); eq(s.errors, []); await s.close();
    });
    await at('menu, rules and stats pause the computers; closing resumes them', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: Object.assign({}, PLAY, { speed: 1 }) }); await s.tapSel('#mStart');
      await s.playUntil(g => !g.human); await s.tapSel('#bMenu'); await sleep(150); const k0 = (await s.gs()).st.k; await sleep(2500);
      eq((await s.gs()).st.k, k0, 'no roll while the menu is open'); await s.tapSel('#mClose');
      await s.until(g => g.st.k > k0, 5000); eq(s.errors, []); await s.close();
    });
    await at('開始飛行 / 每日航班 ask before throwing away an unfinished game', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: PLAY }); await s.tapSel('#mStart'); const seed = (await s.gs()).st.seed;
      await s.tapSel('#bMenu'); await s.tapSel('#mDaily'); ok(await s.page.isVisible('#confirm'), 'confirm shown');
      await s.tapSel('#cfNo'); eq((await s.gs()).st.seed, seed, 'cancel keeps the game');
      await s.tapSel('#mStart'); await s.tapSel('#cfYes'); ok((await s.gs()).st.seed !== seed, 'confirmed: new game'); ok(!(await s.page.isVisible('#menu')));
      // after a reload the saved game also counts
      await s.page.reload(); await sleep(500); await s.tapSel('#mStart'); ok(await s.page.isVisible('#confirm'), 'confirm for saved game'); eq(s.errors, []); await s.close();
    });
    await at('plane taps: >= 24px hit radius on a small board, and a single movable plane takes a tap anywhere on the board', async () => {
      const s = await open({ width: 375, height: 500 }, { settings: Object.assign({}, PLAY, { auto: false }) }); await s.tapSel('#mStart');
      const bb = await s.page.$eval('#boardBox', e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }); ok(bb[3] >= 260, 'board ' + bb[3] + 'px tall');
      const setup = async (pos) => { await s.reset(pos); await s.tapSel('#diceBtn'); return s.until(g => g.ui === 'choose' && !g.busy); };
      let g = await setup([10, 30, -1, -1]); const [x, y] = await s.page.evaluate(() => window.__game.planeXY(0, 1));
      await s.tap(x + 15, y + 15); await sleep(250); g = await s.gs(); ok(g.ui !== 'choose' && g.st.pos[0][1] !== 30, 'offset tap (21px) moved the plane');
      await s.page.evaluate(() => window.__game.setSpeed(4));
      g = await setup([10, -1, -1, -1]); const [cx, cy] = [bb[0] + bb[2] / 2 + 100, bb[1] + bb[3] - 30];
      await s.tap(cx, cy); await sleep(250); g = await s.gs(); ok(g.st.pos[0][0] !== 10, 'tap far from the only movable plane moved it');
      eq(s.errors, []); await s.close();
    });
    await at('hint toast does not cover the hinted plane or its landing square', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: PLAY }); await s.tapSel('#mStart');
      for (let n = 0; n < 6; n++) {
        await s.reset([[3, 20, -1, -1], [40, 44, 10, -1], [14, 2, -1, -1], [27, 31, 5, 8], [46, 12, -1, -1], [36, 30, 22, -1]][n]);   // straight back to your roll, no computer turns in between
        await s.tapSel('#diceBtn'); const g = await s.until(g => g.ui === 'choose' && !g.busy);
        await s.tapSel('#bHint'); await sleep(400);
        const mv = AP.legal(g.st, 0, g.st.d)[AP.think(g.st, 4, 0, 7).i];
        const pts = await s.page.evaluate(([from, to, i]) => { const b = document.getElementById('boardBox').getBoundingClientRect(), sz = Math.min(b.width, b.height), u = sz / 15, x0 = b.left + (b.width - sz) / 2, y0 = b.top + (b.height - sz) / 2;
          return [from, to].filter(p => p !== AP.GOAL).map(p => { const q = AP.gridOf(0, p, i); return [x0 + (q[1] + .5) * u, y0 + (q[0] + .5) * u]; }); }, [mv.from, mv.to, mv.pl[0]]);
        const r = await s.page.$eval('#toast', e => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.right, q.bottom]; });
        for (const [px, py] of pts) ok(!(px > r[0] && px < r[2] && py > r[1] && py < r[3]), 'toast ' + r.map(Math.round) + ' covers ' + [px, py].map(Math.round));
      }
      eq(s.errors, []); await s.close();
    });
    await at('nothing is redrawn while idle behind the menu (light theme)', async () => {
      const s = await open({ width: 390, height: 844 }); await sleep(600);
      const c0 = await s.page.evaluate(() => window.__clears); await sleep(1000); const c1 = await s.page.evaluate(() => window.__clears);
      ok(c1 - c0 <= 2, (c1 - c0) + ' redraws in 1 s'); await s.close();
    });
    await at('a game still plays to the end with the board taps (quick mode, no errors)', async () => {
      const s = await open({ width: 360, height: 640 }, { settings: Object.assign({}, PLAY, { np: 2, auto: false }) }); await s.nearWin(); await s.tapSel('#mStart');
      await s.playUntil(g => g.resultVisible, 30000); eq(s.errors, []); await s.close();
    });
  } finally { await browser.close(); }
}
(async () => {
  if (!process.argv.includes('--node-only')) await browserTests();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
