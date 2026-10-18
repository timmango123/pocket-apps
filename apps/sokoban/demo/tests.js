// Core tests for 推箱子 (sokoban). Loads the engine between CORE markers of ../index.html and replay-verifies every
// embedded level's stored solution (so all 100 are proven solvable), plus the movement, undo, pathfinding and star rules.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return {DX,DY,DCH,parseLevel,initState,cloneState,nb,tryMove,undo,isWon,reach,pathTo,replay,deadSquares,starsFor};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + ';return LEVELS;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

// --- parsing ---
{
  const L = C.parseLevel('#####|#@$.#|#####');
  ok(L.w === 5 && L.h === 3 && L.p0 === 6 && L.nBoxes === 1 && L.nGoals === 1, 'parse: size, player, counts');
  ok(L.wall[0] === 1 && L.wall[6] === 0 && L.box0[7] === 1 && L.goal[8] === 1, 'parse: wall/box/goal cells');
  ok(L.floor[6] && L.floor[7] && L.floor[8] && !L.floor[0], 'parse: floor = cells reachable from the player');
  const L2 = C.parseLevel('####|#+*#|####');
  ok(L2.goal[5] && L2.p0 === 5 && L2.box0[6] && L2.goal[6], 'parse: + and * (player/box on goal)');
  const L3 = C.parseLevel('###|#@|###');
  ok(L3.w === 3 && L3.wall[5] === 1, 'parse: short rows are padded with walls');
}
// --- moves, pushes, blocking ---
{
  const L = C.parseLevel('#######|#@-$-.#|#--#--#|#######'), S = C.initState(L);
  ok(C.tryMove(L, S, 3) === null && S.moves === 0, 'wall blocks a move');
  let r = C.tryMove(L, S, 1);
  ok(r && !r.push && S.p === 9 && S.moves === 1 && S.pushes === 0, 'plain step');
  r = C.tryMove(L, S, 1);
  ok(r && r.push && r.bFrom === 10 && r.bTo === 11 && S.box[10] === 0 && S.box[11] === 1 && S.pushes === 1, 'push moves the box one cell');
  r = C.tryMove(L, S, 1);
  ok(r && r.push && S.box[12] === 1 && C.isWon(L, S), 'push onto goal wins');
  ok(C.tryMove(L, S, 1) === null, 'cannot push a box into a wall');
  const Lb = C.parseLevel('######|#@$$-#|######'), Sb = C.initState(Lb);
  ok(C.tryMove(Lb, Sb, 1) === null && Sb.box[8] && Sb.box[9], 'cannot push two boxes at once');
  ok(C.tryMove(Lb, Sb, 0) === null && C.tryMove(Lb, Sb, 2) === null, 'walls above/below block');
}
// --- undo ---
{
  const L = C.parseLevel('#######|#@-$-.#|#-----#|#######'), S = C.initState(L);
  C.tryMove(L, S, 1); C.tryMove(L, S, 1); // step, push
  const u = C.undo(L, S, false);
  ok(u.length === 1 && u[0].push && S.box[10] === 1 && S.box[11] === 0 && S.p === 9 && S.pushes === 0 && S.moves === 1, 'undo restores pushed box and player');
  C.undo(L, S, false);
  ok(S.p === L.p0 && S.moves === 0 && S.hist.length === 0 && C.undo(L, S, true).length === 0, 'undo to the start; undo on empty history is a no-op');
  // group undo (tap-to-walk): three steps with one group tag, then one push
  C.tryMove(L, S, 2, 'walk'); C.tryMove(L, S, 1, 'walk'); C.tryMove(L, S, 1, 'walk');
  C.tryMove(L, S, 0); // up: from (3,2) to (3,1) where the box is -> push up? wall above box -> blocked
  ok(S.moves === 3, 'push into wall blocked after walk');
  C.tryMove(L, S, 1, 'walk2');
  const g = C.undo(L, S, true);
  ok(g.length === 1 && S.moves === 3, 'whole-group undo of a single-step group undoes one step');
  const g2 = C.undo(L, S, true);
  ok(g2.length === 3 && S.moves === 0 && S.p === L.p0, 'whole-group undo removes the entire walk');
  C.tryMove(L, S, 2, 'w'); C.tryMove(L, S, 1, 'w');
  ok(C.undo(L, S, false).length === 1 && S.moves === 1, 'single-step undo only pops one step of a group');
}
// --- reach / pathTo ---
{
  const L = C.parseLevel('#######|#@-$-.#|#--#--#|#--#--#|#######'), S = C.initState(L);
  const R = C.reach(L, S);
  ok(R.dist[10] === -1 && R.dist[9] === 1 && R.dist[11] === -1, 'reach: boxes block, cells behind a box are unreachable');
  const p = C.pathTo(L, S, 23); // (2,3)
  ok(p && p.length === 3, 'pathTo returns a shortest path');
  ok(C.pathTo(L, S, 11) === null && C.pathTo(L, S, 0) === null, 'pathTo null for unreachable / wall');
  // walking the path arrives
  const S2 = C.initState(L); for (const d of p) ok(!!C.tryMove(L, S2, d), 'path step is legal');
  ok(S2.p === 23 && S2.pushes === 0, 'walked path arrives without pushing');
}
// --- replay ---
{
  const L = C.parseLevel('#####|#@$.#|#####');
  ok(C.replay(L, 'r').won && C.replay(L, 'r').ok, 'replay solves a trivial level');
  ok(!C.replay(L, 'l').ok, 'replay reports a blocked step');
  ok(C.replay(L, '').ok && !C.replay(L, '').won, 'empty replay is ok but not won');
  ok(!C.replay(L, 'x').ok, 'replay rejects unknown letters');
}
// --- dead squares ---
{
  const L = C.parseLevel('######|#@---#|#--.-#|#----#|######'), D = C.deadSquares(L);
  ok(D[7] === 1 && D[10] === 1 && D[19] === 1 && D[22] === 1, 'corners are dead squares');
  ok(D[8] === 1 && D[13] === 1, 'wall-hugging cells with no goal on that wall are dead');
  ok(D[15] === 0 && D[14] === 0, 'goal and interior cells are live');
}
// --- stars ---
{
  ok(C.starsFor(10, 10) === 3 && C.starsFor(9, 10) === 3, '3 stars at or under par');
  ok(C.starsFor(14, 10) === 2 && C.starsFor(11, 10) === 2, '2 stars up to par+4 / par*1.4');
  ok(C.starsFor(15, 10) === 1 && C.starsFor(50, 10) === 1, '1 star otherwise');
  ok(C.starsFor(28, 20) === 2 && C.starsFor(29, 20) === 1, '2-star limit uses 1.4x for longer levels');
}
// --- all embedded levels: solvable (replay), well-formed, within size, distinct, gentle curve ---
{
  ok(LEVELS.length === 100, 'exactly 100 levels (got ' + LEVELS.length + ')');
  const seen = new Set(); let solvable = 0, prevTierPar = 0, curveOk = true, pushesTotal = 0;
  const ch = [];
  const med = a => { const v = a.slice().sort((x, y) => x - y); return (v[(v.length - 1) >> 1] + v[v.length >> 1]) / 2; };
  for (let n = 1; n <= LEVELS.length; n++) {
    const e = LEVELS[n - 1], L = C.parseLevel(e.m);
    const r = C.replay(L, e.s);
    if (r.ok && r.won) solvable++; else console.log('FAIL level', n, 'solution does not replay', r);
    ok(L.nBoxes === L.nGoals && L.nBoxes >= 1, 'level ' + n + ': boxes = goals');
    ok(L.w <= 12 && L.h <= 12 && L.w >= 3 && L.h >= 3, 'level ' + n + ': size within 12x12 incl. walls (' + L.w + 'x' + L.h + ')');
    ok(/^[-#.$*@+|]+$/.test(e.m), 'level ' + n + ': only known characters');
    ok(!seen.has(e.m), 'level ' + n + ': distinct from earlier levels'); seen.add(e.m);
    ok(r.pushes >= 1, 'level ' + n + ': needs at least one push');
    // every box starts off its goal (no free pre-solved crates)
    let onGoal = 0; for (let i = 0; i < L.n; i++) if (L.box0[i] && L.goal[i]) onGoal++;
    ok(onGoal === 0, 'level ' + n + ': no box starts on a goal');
    ok(e.p === r.pushes, 'level ' + n + ': stored push count matches the replay (' + e.p + ' vs ' + r.pushes + ')');
    ok(typeof e.d === 'number' && e.d > 0, 'level ' + n + ': has a difficulty metric');
    pushesTotal += r.pushes;
    const t = Math.floor((n - 1) / 10); (ch[t] = ch[t] || { p: [], d: [], b: [], area: [] });
    ch[t].p.push(r.pushes); ch[t].d.push(e.d); ch[t].b.push(L.nBoxes); ch[t].area.push(L.w * L.h);
  }
  ok(solvable === LEVELS.length, 'all ' + LEVELS.length + ' stored solutions replay to a win (' + solvable + ')');
  // difficulty curve: chapter medians of the metric strictly rise, each step by a clear margin; pushes and boxes trend up
  const dm = ch.map(c => med(c.d)), pm = ch.map(c => med(c.p)), bm = ch.map(c => med(c.b));
  for (let t = 1; t < ch.length; t++) if (!(dm[t] >= dm[t - 1] + 8)) curveOk = false;
  ok(curveOk, 'chapter median difficulty rises by >= 8 each chapter: ' + dm.join(' < '));
  let pOk = true; for (let t = 1; t < ch.length; t++) if (!(pm[t] > pm[t - 1])) pOk = false;
  ok(pOk, 'chapter median pushes strictly rise: ' + pm.join(' < '));
  let bOk = true; for (let t = 1; t < ch.length; t++) if (bm[t] < bm[t - 1]) bOk = false;
  ok(bOk && bm[9] >= 7, 'chapter median box count never falls and reaches 7+: ' + bm.join(', '));
  ok(pm[0] <= 4 && pm[9] >= 45 && med(ch[9].area) >= 2 * med(ch[0].area), 'quick start (<=4 pushes) and long late levels (>=45 pushes, rooms twice as big): ' + pm[0] + ' / ' + pm[9]);
  ok(Math.max.apply(null, ch[9].d) === LEVELS[99].d, 'level 100 is the hardest level');
  // breathers: inside a chapter not every level is harder than the one before
  let breathers = 0; for (let n = 2; n <= 100; n++) if (LEVELS[n - 1].d < LEVELS[n - 2].d) breathers++;
  ok(breathers >= 8 && breathers <= 30, 'some breather levels inside chapters (' + breathers + ')');
  const first = C.parseLevel(LEVELS[0].m), lastL = C.parseLevel(LEVELS[LEVELS.length - 1].m);
  ok(first.nBoxes <= 2 && first.w * first.h <= 49, 'level 1 is a small easy room');
  ok(lastL.nBoxes >= first.nBoxes + 2, 'last level has more boxes than the first');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
