// Node verification for 糖果連連看 (link-match), using the game's own core code (CORE-START/CORE-END in ../index.html).
// 1) unit tests for the <=2-turn connection test (incl. paths around the outer ring)
// 2) regenerates all 100 levels exactly as the page does and replays the generator's clearing sequence with the real
//    rules (same-type, unfrozen, same chain group, path <=2 turns, thaw + gravity) -> every level can be fully cleared
// 3) rotation levels (80+): independent DFS solve that also applies the 90-degree turn every ROT_EVERY clears
// 4) checks the parameter table: difficulty D strictly increasing, mechanics introduced at the specified levels
// Usage: node solve.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const ATT = JSON.parse(html.match(/var ATT = (\[[^\]]*\]);/)[1]);
const C = new Function(coreSrc + '\nreturn {levelParams, diffOf, genLevel, findPath, canPair, listMoves, applyMove, gravity, rotGrav, solve, countTiles, mkRng, emptyBoard, reshuffle, ROT_EVERY};')();
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL', msg); } };

// ---- 1) connection unit tests on a 4x3 board (W2=6,H2=5) ----
function board(rows) { const H2 = rows.length + 2, W2 = rows[0].length + 2, g = new Array(W2 * H2).fill(0); rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') g[(y + 1) * W2 + x + 1] = ch === '#' ? 24 : ch.charCodeAt(0) - 96; })); return { g, W2, H2, at: (x, y) => (y + 1) * W2 + x + 1 }; }
const turns = p => p ? p.length - 2 : -1;
let b = board(['a.a#', '####', '####']); check(turns(C.findPath(b.g, b.W2, b.H2, b.at(0, 0), b.at(2, 0))) === 0, 'straight line');
b = board(['a###', '.###', '..a#']); check(turns(C.findPath(b.g, b.W2, b.H2, b.at(0, 0), b.at(2, 2))) === 1, 'one turn');
b = board(['a#a#', '####', '####']); check(turns(C.findPath(b.g, b.W2, b.H2, b.at(0, 0), b.at(2, 0))) === 2, 'two turns via outer ring (top)');
b = board(['####', 'a##a', '####']); check(C.findPath(b.g, b.W2, b.H2, b.at(0, 1), b.at(3, 1)) === null, 'left edge to right edge of a middle row needs 4 turns -> rejected');
b = board(['####', '#a##', '###a']); check(C.findPath(b.g, b.W2, b.H2, b.at(1, 1), b.at(3, 2)) === null, 'enclosed tile cannot connect');
b = board(['a###', '####', 'a###']); check(turns(C.findPath(b.g, b.W2, b.H2, b.at(0, 0), b.at(0, 2))) === 2, 'same column around the left ring (2 turns)');
b = board(['#a##', '####', '##a#']); check(C.findPath(b.g, b.W2, b.H2, b.at(1, 0), b.at(2, 2)) === null, 'top row to bottom row needs 3 turns -> rejected');
console.log('connection unit tests:', fails ? 'FAILED' : 'all 7 passed');

// ---- 2-4) all levels ----
function replay(r) {
  const P = r.P, g = r.g.slice();
  for (const m of r.sol) {
    for (let i = 0; i < m.length; i += 2) {
      if (!C.canPair(g, m[i], m[i + 1]) || !C.findPath(g, P.W2, P.H2, m[i], m[i + 1])) return false;
      if (m.length === 4 && !((g[m[i]] >> 6) > 0)) return false; // 4-tile moves are chain groups only
    }
    if (m.length === 2 && (g[m[0]] >> 6)) return false; // chained tiles must go as a group
    C.applyMove(g, P.W2, P.H2, m, P.grav);
  }
  return C.countTiles(g) === 0;
}
function replayRot(g0, P, sol) {
  const g = g0.slice(); let grav = P.grav, done = 0;
  for (const m of sol) {
    for (let i = 0; i < m.length; i += 2) if (!C.canPair(g, m[i], m[i + 1]) || !C.findPath(g, P.W2, P.H2, m[i], m[i + 1])) return false;
    C.applyMove(g, P.W2, P.H2, m, grav); done++;
    if (done % C.ROT_EVERY === 0) { grav = C.rotGrav(grav); C.gravity(g, P.W2, P.H2, grav); }
  }
  return C.countTiles(g) === 0;
}
const rows = []; let prevD = 0, minStep = 1e9, t0 = Date.now();
for (let L = 1; L <= 100; L++) {
  const r = C.genLevel(L, 0, ATT[L - 1], false), P = r.P;
  check(r.att === ATT[L - 1], 'level ' + L + ' reproducible seed');
  const ok = replay(r); check(ok, 'level ' + L + ' clearing sequence replays with the real rules');
  let rotOk = null;
  if (P.rot) { const s = C.solve(r.g, { W2: P.W2, H2: P.H2, grav: P.grav, rot: C.ROT_EVERY }, 300, C.mkRng(ATT[L - 1] + 1)); rotOk = !!s && replayRot(r.g, P, s); check(rotOk, 'level ' + L + ' solvable with board turns'); }
  const ice = r.g.filter(c => c & 32).length, chains = new Set(r.g.filter(c => c >> 6).map(c => c >> 6)).size;
  check(ice === P.ice, 'level ' + L + ' ice count ' + ice + ' / ' + P.ice);
  check(chains === P.chains, 'level ' + L + ' chain groups ' + chains + ' / ' + P.chains);
  check(C.listMoves(r.g, P.W2, P.H2, true).length > 0, 'level ' + L + ' has an opening move');
  if (L > 1) { const step = P.D / prevD - 1; minStep = Math.min(minStep, step); check(step > 0, 'level ' + L + ' D strictly increasing'); }
  prevD = P.D;
  rows.push({ L, size: P.C + 'x' + P.R, pairs: P.pairs, K: P.K, time: P.time, ppt: P.ppt.toFixed(2), ice, chains, grav: P.grav, rot: P.rot, D: P.D.toFixed(1), diff: C.diffOf(L).toFixed(2), moves: r.sol.length, ok, rotOk });
}
// mechanics introduced at the specified levels
const first = f => (rows.find(f) || {}).L;
check(first(r => r.ice > 0) === 15, 'ice from level 15');
check(first(r => r.grav > 0) === 30, 'gravity from level 30');
check(first(r => r.grav > 1) >= 45 && rows.slice(29, 44).every(r => r.grav === 1), 'only downward gravity 30-44, random from 45');
check(first(r => r.chains > 0) === 60, 'chains from level 60');
check(first(r => r.rot) === 80, 'board turns from level 80');
// deadlock shuffle keeps at least one move (spot-check on mid-game states)
let shufOk = 0;
for (const L of [20, 50, 75, 100]) {
  const r = C.genLevel(L, 0, ATT[L - 1], false), g = r.g.slice();
  for (let i = 0; i < r.sol.length / 2; i++) C.applyMove(g, r.P.W2, r.P.H2, r.sol[i], r.P.grav);
  const s = C.reshuffle(g, r.P, r.P.grav, C.mkRng(L));
  if (s && C.listMoves(s.g, r.P.W2, r.P.H2, true).length && C.countTiles(s.g) === C.countTiles(g)) shufOk++;
}
check(shufOk === 4, 'reshuffle keeps tiles and leaves a move');

console.log('\nL    size  pairs K  time  s/pair ice chain grav rot   D      diff  clears');
for (const r of rows) if (r.L % 5 === 0 || r.L === 1 || [15, 30, 45, 60, 80, 99].includes(r.L))
  console.log(String(r.L).padEnd(4), r.size.padEnd(6), String(r.pairs).padEnd(4), String(r.K).padEnd(2), String(r.time).padEnd(5), r.ppt.padEnd(6), String(r.ice).padEnd(3), String(r.chains).padEnd(5), String(r.grav).padEnd(4), (r.rot ? 'yes' : 'no').padEnd(5), r.D.padEnd(6), r.diff.padEnd(5), r.moves + (r.ok ? ' ok' : ' BAD') + (r.rotOk === null ? '' : r.rotOk ? ' +turns ok' : ' +turns BAD'));
console.log('\nAll 100 levels fully clearable:', rows.every(r => r.ok) && rows.every(r => r.rotOk !== false));
console.log('Difficulty D strictly increasing every level; smallest step +' + (minStep * 100).toFixed(1) + '%, D1=' + rows[0].D + ' -> D100=' + rows[99].D + ' (x' + (rows[99].D / rows[0].D).toFixed(1) + ', avg +' + ((Math.pow(rows[99].D / rows[0].D, 1 / 99) - 1) * 100).toFixed(1) + '%/level)');
console.log('Checks failed:', fails, ' time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(fails ? 1 : 0);
