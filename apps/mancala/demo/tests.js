// Rule + engine unit tests for 播棋 (mancala). Loads the game's own core (between CORE-START/CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const MC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MC;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b) => JSON.stringify(Array.from(a)) === JSON.stringify(Array.from(b));
let seed = 99; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
function game(rule, cells, side = 0, opt = {}) { const g = MC.newGame({ rule, seeds: 4, ec: opt.ec }); g.b = Int8Array.from(cells); g.side = side; return g; }
const total = b => Array.from(b).reduce((a, x) => a + x, 0);

// ================= Kalah =================
{ const g = MC.newGame({ rule: 'kalah', seeds: 4 }); ok(eq(g.b, [4,4,4,4,4,4,0,4,4,4,4,4,4,0]) && total(g.b) === 48, 'Kalah(6,4) start: 48 seeds'); }
for (const s of [3, 5, 6]) { const g = MC.newGame({ rule: 'kalah', seeds: s }); ok(total(g.b) === 12 * s && g.b[6] === 0 && g.b[13] === 0, `Kalah(6,${s}) start`); }
{ const g = MC.newGame({ rule: 'kalah', seeds: 4 }); const i = MC.play(g, 0); ok(eq(g.b, [0,5,5,5,5,4,0,4,4,4,4,4,4,0]) && g.side === 1 && !i.extra, 'basic sowing counter-clockwise, turn passes'); }
{ const g = MC.newGame({ rule: 'kalah', seeds: 4 }); const i = MC.play(g, 2); ok(i.extra && g.side === 0 && g.b[6] === 1, 'last seed in own store = extra turn (pit 3 with 4 seeds)'); }
{ // consecutive extra turns
  const g = game('kalah', [0,0,0,0,2,1,0, 4,4,4,4,4,4,0]); const a = MC.play(g, 5); const b = MC.play(g, 4);
  ok(a.extra && b.extra && g.side === 0 && g.b[6] === 2, 'chain: pit 6 (1 seed) extra, then pit 5 (2 seeds) extra again');
  const g2 = game('kalah', [0,0,0,3,2,1,0, 4,4,4,4,4,4,0]); const r1 = MC.play(g2, 5), r2 = MC.play(g2, 3), r3 = MC.play(g2, 4);
  ok(r1.extra && r2.extra && !r3.extra && g2.side === 1, 'chain ends when last seed misses the store');
  const g3 = game('kalah', [0,0,0,3,2,1,0, 4,4,4,4,4,4,0]); const s1 = MC.play(g3, 5), s2 = MC.play(g3, 3);
  ok(s1.extra && s2.extra && g3.side === 0 && g3.b[6] === 2, 'two extra turns in a row (pit 6 then pit 4 with 3)');
}
{ // skip opponent store
  const g = game('kalah', [0,0,0,0,0,10,0, 1,1,1,1,1,1,5]); const i = MC.play(g, 5);
  ok(!i.path.includes(13) && g.b[13] === 5 && i.path.length === 10 && i.path[7] === 0, 'side 0 skips side 1 store');
  const g2 = game('kalah', [1,1,1,1,1,1,5, 0,0,0,0,0,10,0], 1); const j = MC.play(g2, 5);
  ok(!j.path.includes(6) && g2.b[6] === 5, 'side 1 skips side 0 store');
}
{ // capture
  const g = game('kalah', [1,0,0,0,0,4,0, 4,4,4,4,4,7,0]); const i = MC.play(g, 0);
  ok(i.cap && i.cap.n === 5 && g.b[6] === 5 && g.b[1] === 0 && g.b[11] === 0 && g.b[12] === 7, 'capture: last in own empty pit takes opposite + itself');
  const g2 = game('kalah', [1,0,0,0,0,4,0, 4,4,4,4,0,7,0]); const j = MC.play(g2, 0);
  ok(!j.cap && g2.b[1] === 1 && g2.b[6] === 0, 'default: no capture when the opposite pit is empty');
  const g3 = game('kalah', [1,0,0,0,0,4,0, 4,4,4,4,0,7,0], 0, { ec: true }); const k = MC.play(g3, 0);
  ok(k.cap && k.cap.n === 1 && g3.b[6] === 1 && g3.b[1] === 0, 'variant: opposite empty still captures the one seed');
  const g4 = game('kalah', [1,0,0,0,0,4,0, 4,4,4,4,4,4,0], 1); g4.b[7] = 0; g4.b[8] = 1; const m = MC.play(g4, 1); // side 1 pit 8 -> 9 has 4 seeds: no capture
  ok(!m.cap, 'landing on a non-empty own pit does not capture');
  const g5 = game('kalah', [3,0,0,0,0,0,0, 1,0,4,4,4,4,0], 1); g5.b[0] = 3; const n = MC.play(g5, 0); // side1 pit7 (1) -> 8 empty, opposite 4 has 0? opposite of 8 is 4
  ok(!n.cap, 'side 1 lands in own empty pit with empty opposite: no capture');
  const g6 = game('kalah', [2,0,0,0,5,0,0, 1,0,4,4,4,4,0], 1); const q = MC.play(g6, 0);
  ok(q.cap && q.cap.n === 6 && g6.b[13] === 6 && g6.b[4] === 0, 'side 1 capture of opposite pit 4');
  const g7 = game('kalah', [0,0,0,0,0,0,0, 0,0,0,0,0,0,0]); g7.b[0] = 2; g7.b[5] = 1; g7.b[7] = 1; g7.b[10] = 3; // land on opponent's empty pit: no capture
  const g8 = game('kalah', [0,0,0,0,1,1,0, 0,1,0,0,0,0,0]); const r = MC.play(g8, 5); ok(r.extra, 'single seed from pit 6 goes into store');
}
{ // a lap: 13 seeds land back in the (now empty) origin pit and capture
  const g = game('kalah', [13,1,1,1,1,1,0, 1,1,1,1,1,2,0]); const i = MC.play(g, 0);
  ok(i.last === 0 && i.cap && i.cap.n === 1 + 3 && g.b[0] === 0 && g.b[12] === 0, 'full lap lands in the emptied origin and captures');
}
{ // game end: side empty -> other side sweeps own seeds
  const g = game('kalah', [0,0,0,0,0,1,20, 1,2,3,0,0,1,20]); const i = MC.play(g, 5);
  ok(i.over && g.over && g.b[6] === 21 && g.b[13] === 27 && i.sweep && i.sweep[1] === 7, 'game ends when a side is empty; remaining seeds go to their owner');
  ok(MC.winner(g) === 1 && eq(MC.score(g), [21, 27]), 'winner by store count');
  const g2 = game('kalah', [0,0,0,0,0,1,23, 0,0,0,0,0,1,23], 0); const j = MC.play(g2, 5);
  ok(j.over && eq(MC.score(g2), [24, 24]) && MC.winner(g2) === -1, '24:24 is a draw');
  const g3 = game('kalah', [0,0,0,1,0,0,10, 0,0,0,0,0,1,10], 1); const k = MC.play(g3, 5); // side 1 empties its own side by sowing into store
  ok(k.over && g3.b[6] === 11 && g3.b[13] === 11, 'mover emptying own side ends the game too (no extra turn)');
  ok(!k.extra, 'no extra turn after the game is over');
}
{ // random playouts keep seed count, never sow into opponent store, end consistently
  let bad = 0, games = 0;
  for (let t = 0; t < 3000; t++) {
    const s = 3 + (t % 4), g = MC.newGame({ rule: 'kalah', seeds: s, ec: t % 5 === 0 });
    while (!g.over) { const m = MC.moves('kalah', g.b, g.side); const side = g.side, opp = side ? 6 : 13, before = g.b[opp]; const i = MC.play(g, m[Math.floor(rnd() * m.length)]);
      if (total(g.b) !== 12 * s) bad++; if (!i.over && g.b[opp] !== before) bad++; if (i.path.includes(opp)) bad++; }
    games++; if (g.b.slice(0, 6).some(x => x) || g.b.slice(7, 13).some(x => x)) bad++;
  }
  ok(bad === 0, `3000 random Kalah games keep invariants (${bad} violations)`);
}
// ================= Oware =================
{ const g = MC.newGame({ rule: 'oware' }); ok(g.b.slice(0, 12).every(x => x === 4) && g.b[12] === 0 && g.b[13] === 0, 'Oware start 12x4'); }
{ const g = MC.newGame({ rule: 'oware' }); MC.play(g, 0); ok(eq(g.b.slice(0, 12), [0,5,5,5,5,4,4,4,4,4,4,4]) && g.side === 1, 'Oware basic sowing, no store'); }
{ // skip origin pit when sowing 12+
  const b = [0,0,0,0,0,0, 1,1,1,1,1,1, 0,0]; b[0] = 14; const g = game('oware', b); const i = MC.play(g, 0);
  ok(!i.path.includes(0) && g.b[0] === 0 && i.path.length === 14 && g.b[1] === 2 && g.b[2] === 2 && g.b[3] === 2 && g.b[4] === 1 && g.b[11] === 2, 'origin pit skipped on a full lap');
}
{ // capture 2/3 and chain backwards
  const b = [0,0,0,0,1,2, 1,2,2,0,4,4, 0,0]; const g = game('oware', b); const i = MC.play(g, 5); // 2 seeds -> pits 6,7 => 6 becomes 2, 7 becomes 3 -> capture 7 (3) then 6 (2)
  ok(i.cap && i.cap.n === 5 && g.b[12] === 5 && g.b[6] === 0 && g.b[7] === 0 && g.b[8] === 2, 'capture 2/3 and continue backwards');
  const b2 = [0,0,0,0,0,3, 1,4,1,2,9,0, 0,0]; const g2 = game('oware', b2); const j = MC.play(g2, 5); // -> 6:2,7:5,8:2 ; last 8=2 capture, 7=5 stops
  ok(j.cap && j.cap.n === 2 && g2.b[6] === 2 && g2.b[7] === 5, 'chain stops at a pit that is not 2 or 3');
  const b3 = [0,0,0,0,0,1, 2,0,0,0,0,9, 0,0]; const g3 = game('oware', b3); const k = MC.play(g3, 5);
  ok(k.cap && k.cap.n === 3 && g3.b[5] === 0, 'capture never continues onto own side');
  const b4 = [0,0,0,1,0,0, 3,0,0,0,0,0, 0,0]; const g4 = game('oware', b4); const k4 = MC.play(g4, 3); // lands in pit 4 (own side) – no capture
  ok(!k4.cap, 'last seed on own side never captures');
  const b5 = [1,0,0,0,0,0, 0,0,0,0,0,1, 0,0]; const g5 = game('oware', b5, 1); const k5 = MC.play(g5, 5); // side 1 sows into pit 0 -> 2 -> captures
  ok(k5.cap === null || k5.grandSlam, 'side 1: capturing all of side 0 is a grand slam (no capture)');
  const b6 = [1,3,0,0,0,0, 0,0,0,0,0,2, 0,0]; const g6 = game('oware', b6, 1); const k6 = MC.play(g6, 5); // 11 has 2 -> pits 0,1 => 0:2, 1:4 → last=1 (4) no capture
  ok(!k6.cap, 'side 1: last pit with 4 no capture');
  const b7 = [1,0,3,0,0,0, 0,0,0,0,0,2, 0,0]; const g7 = game('oware', b7, 1); const k7 = MC.play(g7, 5); // -> 0:2,1:1 last=1 (1) no
  const b8 = [1,1,3,0,0,0, 0,0,0,0,0,2, 0,0]; const g8 = game('oware', b8, 1); const k8 = MC.play(g8, 5); // -> 0:2,1:2 capture both (4); 3 remains on pit 2
  ok(!k7.cap && k8.cap && k8.cap.n === 4 && g8.b[13] === 4 && k8.over && g8.b[12] === 3, 'side 1 capture chain (then side 0 cannot feed: game ends, keeps its 3)');
}
{ // grand slam: no capture
  const b = [0,0,0,0,3,2, 1,2,0,0,0,0, 0,0]; const g = game('oware', b); const i = MC.play(g, 5);
  ok(!i.cap && i.grandSlam && g.b[6] === 2 && g.b[7] === 3 && g.b[12] === 0, 'grand slam (would take every opponent seed) captures nothing');
}
{ // must feed
  const b = [3,0,0,0,0,1, 0,0,0,0,0,0, 20,24]; const g = game('oware', b);
  ok(eq(MC.moves('oware', g.b, 0), [0, 5]) === false && eq(MC.moves('oware', g.b, 0), [5]), 'opponent empty: only moves that feed are legal');
  ok(MC.play(g, 0) === null, 'non-feeding move rejected');
  const b2 = [1,0,0,0,0,0, 0,0,0,0,0,0, 23,24]; b2[12] = 23; b2[13] = 24; const g2 = game('oware', b2, 1); // side 1 to move with nothing -> impossible state; instead:
  const b3 = [2,0,0,0,0,0, 0,0,0,0,0,1, 21,24]; const g3 = game('oware', b3, 1); const j = MC.play(g3, 5); // side1 plays last seed into pit 0 (3) ; side 0 must feed: pit0 has 3 -> cannot reach -> game over, side 0 takes its 3
  ok(j.over && g3.b[12] === 24 && g3.b[13] === 24 && MC.winner(g3) === -1, 'player who cannot feed ends the game and keeps own seeds (24:24 draw)');
}
{ // 25 wins
  const b = [0,0,0,0,0,2, 1,2,3,1,0,0, 21,10]; const g = game('oware', b); const i = MC.play(g, 5);
  ok(i.cap && i.over && g.b[12] >= 25 && MC.winner(g) === 0, '25 captured seeds ends the game');
}
{ // 100 plies without capture ends the game
  const g = MC.newGame({ rule: 'oware' }); g.b = Int8Array.from([1,0,0,0,0,0, 1,0,0,0,0,0, 23,23]); let n = 0, info;
  while (!g.over && n < 400) { const m = MC.moves('oware', g.b, g.side); info = MC.play(g, m[0]); n++; }
  ok(g.over && info.stallEnd && total(g.b) === 48 && g.b[12] + g.b[13] === 48, `stalled game ends after 100 capture-less plies (${n} plies)`);
}
{ let bad = 0;
  for (let t = 0; t < 3000; t++) { const g = MC.newGame({ rule: 'oware' }); let n = 0;
    while (!g.over) { const m = MC.moves('oware', g.b, g.side); if (!m.length) { bad++; break; } const opp = 1 - g.side, i = MC.play(g, m[Math.floor(rnd() * m.length)]); n++;
      if (total(g.b) !== 48) bad++; if (!i.over) { let os = 0; for (let k = 0; k < 6; k++) os += g.b[opp * 6 + k]; if (os === 0 && i.cap) bad++; } }
  }
  ok(bad === 0, `3000 random Oware games: seed count kept, never left without legal move, captures never starve (${bad} violations)`);
}
// ================= preview == play =================
{ let bad = 0;
  for (let t = 0; t < 2000; t++) {
    const rule = t % 3 ? 'kalah' : 'oware', g = MC.newGame({ rule, seeds: 3 + (t % 4), ec: t % 7 === 0 }); let k = Math.floor(rnd() * 30);
    while (!g.over && k-- > 0) { const m = MC.moves(rule, g.b, g.side); MC.play(g, m[Math.floor(rnd() * m.length)]); }
    if (g.over) continue;
    const m = MC.moves(rule, g.b, g.side), p = m[Math.floor(rnd() * m.length)], sim = MC.simulate(g, p), b0 = Array.from(g.b), info = MC.play(g, p);
    if (!eq(sim.board, g.b) && !info.stallEnd) bad++; if (sim.last !== info.last || sim.extra !== info.extra || JSON.stringify(sim.cap) !== JSON.stringify(info.cap) || JSON.stringify(sim.path) !== JSON.stringify(info.path)) bad++;
  }
  ok(bad === 0, `long-press preview (simulate) matches the real move in 2000 random positions (${bad})`);
}
// ================= search =================
// plain minimax (no pruning/TT) with the same evaluation conventions, to check negamax sign handling across extra turns
function evalK(B, side, rule) {
  if (rule === 'oware') { let ms = 0, os = 0; for (let i = 0; i < 6; i++) { ms += B[side * 6 + i]; os += B[(1 - side) * 6 + i]; } return 4 * (B[12 + side] - B[13 - side]) + (ms - os); }
  const me = side * 7, op = (1 - side) * 7; let ms = 0, os = 0, mx = 0, ox = 0;
  for (let i = 0; i < 6; i++) { ms += B[me + i]; os += B[op + i]; if (B[me + i] === 6 - i) mx++; if (B[op + i] === 6 - i) ox++; }
  return 4 * (B[me + 6] - B[op + 6]) + (ms - os) + 2 * (mx - ox);
}
function term(B, side, rule) { const d = rule === 'oware' ? B[12 + side] - B[13 - side] : B[side * 7 + 6] - B[(1 - side) * 7 + 6]; return d > 0 ? 10000 + d : d < 0 ? -10000 + d : 0; }
function mm(B, side, d, rule, ec) {
  if (d === 0) return evalK(B, side, rule);
  let best = -1e9;
  for (let p = 0; p < 6; p++) {
    if (!MC.legal(rule, B, 0, side, p)) continue;
    const C = new Int8Array(B), code = MC.sow(rule, C, 0, side, p, ec, null);
    const v = code & MC.OVER ? term(C, side, rule) : code & MC.EXTRA ? mm(C, side, d - 1, rule, ec) : -mm(C, 1 - side, d - 1, rule, ec);
    if (v > best) best = v;
  }
  return best;
}
{ let bad = 0, n = 0;
  for (let t = 0; t < 120; t++) {
    const rule = t % 4 === 3 ? 'oware' : 'kalah', g = MC.newGame({ rule, seeds: 4 }); let k = Math.floor(rnd() * 24);
    while (!g.over && k-- > 0) { const m = MC.moves(rule, g.b, g.side); MC.play(g, m[Math.floor(rnd() * m.length)]); }
    if (g.over || MC.moves(rule, g.b, g.side).length < 2) continue;
    const d = 1 + (t % 5), r = MC.think({ rule, b: Array.from(g.b), side: g.side, depth: d, ms: 60000, err: 0, level: 4 }), ref = mm(g.b, g.side, d, rule, false);
    n++; if (r.score !== ref) { bad++; if (bad < 4) console.log('  mismatch', rule, Array.from(g.b).join(','), 'side', g.side, 'd', d, r.score, ref); }
  }
  ok(bad === 0, `alpha-beta + TT score equals plain minimax at depth 1-5 (extra turns keep the sign) in ${n} positions`);
}
{ // endgame exact: few seeds -> search reaches the end and returns the true final margin
  let bad = 0, n = 0;
  function solve(B, side) { let best = -1e9; for (let p = 0; p < 6; p++) { if (!MC.legal('kalah', B, 0, side, p)) continue; const C = new Int8Array(B), code = MC.sow('kalah', C, 0, side, p, false, null); const v = code & MC.OVER ? term(C, side, 'kalah') : code & MC.EXTRA ? solve(C, side) : -solve(C, 1 - side); if (v > best) best = v; } return best; }
  for (let t = 0; t < 40; t++) {
    const B = new Int8Array(14); let left = 7 + (t % 5);
    while (left > 0) { const c = [0,1,2,3,4,5,7,8,9,10,11,12][Math.floor(rnd() * 12)]; B[c]++; left--; }
    B[6] = 20; B[13] = 48 - 20 - total(B); if (B[13] < 0) continue;
    if (B.slice(0, 6).every(x => !x) || B.slice(7, 13).every(x => !x)) continue;
    const r = MC.think({ rule: 'kalah', b: Array.from(B), side: 0, level: 5, hist: null });
    n++; if (!r.forced && (!r.exact || r.score !== solve(B, 0))) bad++;
  }
  ok(bad === 0, `level 5 solves small endgames exactly (${n} positions)`);
}
{ // tactical sanity: depth-1 engine takes the extra turn / big capture
  const r = MC.think({ rule: 'kalah', b: [0,0,0,0,4,1,0, 4,4,4,4,4,4,0], side: 0, depth: 1, err: 0, ms: 1000 }); ok(r.pit === 5, 'engine plays the extra-turn move');
  const r2 = MC.think({ rule: 'kalah', b: [1,0,5,0,0,0,10, 1,1,1,1,12,1,10], side: 0, depth: 3, err: 0, ms: 1000 }); ok(r2.pit === 0, 'engine takes a 13-seed capture');
}
{ // opening book: every entry is legal, level 5 uses it
  const keys = Object.keys(MC.BOOK); let bad = 0;
  for (const k of keys) { const [s, h] = k.split('|'); const g = MC.newGame({ rule: 'kalah', seeds: +s }); for (const c of h) MC.play(g, +c); if (!MC.legal('kalah', g.b, 0, g.side, MC.BOOK[k])) bad++; }
  ok(keys.length === 28 && bad === 0, `opening book: ${keys.length} entries for 3-6 seeds, all legal`);
  const g = MC.newGame({ rule: 'kalah', seeds: 4 }); const r = MC.think({ rule: 'kalah', b: Array.from(g.b), side: 0, level: 5, seeds: 4, hist: '' });
  ok(r.book && r.pit === 2, 'Kalah(6,4) book opening is pit 3 (extra turn)');
}
{ // mistake rate
  const g = MC.newGame({ rule: 'kalah', seeds: 4 }); let mis = 0;
  for (let i = 0; i < 400; i++) { const r = MC.think({ rule: 'kalah', b: Array.from(g.b), side: 0, level: 1 }); if (r.mistake) mis++; }
  ok(mis > 100 && mis < 180, `level 1 deliberately errs about 35% of the time (${mis}/400)`);
}
console.log('perft (each sowing is a ply), Kalah(6,4):', [1,2,3,4,5,6,7,8].map(d => MC.perft('kalah', 4, d)).join(', '));
console.log('perft Oware:', [1,2,3,4,5,6,7].map(d => MC.perft('oware', 4, d)).join(', '));
// ================= release-review fixes (2026-11) =================
{ // difficulty ladder: L3 and L4 sit between the skilled-tier search (depth 4) and 祖靈 without a wall
  const L = MC.LEVELS;
  ok(L[2].depth === 5 && L[2].err === 0.10 && L[3].depth === 8 && L[3].err === 0.05, 'levels: 長老 depth 5 / 10% slips, 部落智者 depth 8 / 5% slips (skilled tier ~67% / ~26% in tiers-sim)');
  ok(L.every((l, i) => !i || (l.depth >= L[i - 1].depth && l.err <= L[i - 1].err)), 'levels get strictly no weaker step by step');
}
{ // light theme: store score / name text contrast against the store groove (lightest gradient stop) >= 4.5:1
  const lum = h => { const c = h.match(/\w\w/g).map(x => parseInt(x, 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const m = html.match(/a: '#e2b674'[^}]*label: '(#[0-9a-f]{6})'/), lab = m && m[1], groove = '#965f2d'; // rgba(150,95,45)
  const cr = lab ? (lum(lab) + 0.05) / (lum(groove) + 0.05) : 0;
  ok(cr >= 4.5, `light store label ${lab} on ${groove}: contrast ${cr.toFixed(2)}:1`);
}

async function browserTests() {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('  (playwright not found: page tests skipped)'); return; }
  const ORIGIN = 'https://mancala.test/';
  const browser = await chromium.launch();
  const errors = [];
  async function open(vp = { width: 390, height: 844 }, init) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => r.request().url() === ORIGIN ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
    if (init) await ctx.addInitScript(init.fn, init.arg);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('dialog', d => d.accept());
    const cdp = await ctx.newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const tapPit = async (side, p) => { const [x, y] = await page.evaluate(([s, q]) => __game.pitToClient(s, q), [side, p]); await tap(x, y); };
    await page.goto(ORIGIN); await page.waitForFunction(() => window.__game);
    return { ctx, page, tap, tapPit };
  }
  const G = page => page.evaluate(() => __game.state());
  const ready = page => page.waitForFunction(() => { const s = __game.state(); return s.over || (s.inputOK && !s.busy && !s.thinking); }, null, { timeout: 60000 });
  // a saved game (old localStorage format, key mancala.game v1) for side 0 to move
  const saveOf = (o) => Object.assign({ v: 1, rule: 'kalah', seeds: 4, ec: false, side: 0, over: false, stall: 0, plies: 0, hist: [], mode: 'ai', level: 1, human: 0, first: 0, snaps: [], chain: 0, maxChain: 0, maxCap: 0, hints: 0, undos: 0, recorded: false }, o);
  const seed = (store) => ({ fn: (st) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); for (const k in st) localStorage.setItem('mancala.' + k, JSON.stringify(st[k])); }, arg: store });
  const SET = { speed: 'normal', mode: '2p', sound: false, vib: false };
  try {
    { // [1] a reload during the sowing animation keeps the move just played
      const { ctx, page, tapPit } = await open(undefined, seed({ settings: SET }));
      await page.click('#mStart'); await ready(page);
      await tapPit(0, 0);
      const mid = await page.evaluate(() => ({ busy: __game.state().busy, saved: JSON.parse(localStorage.getItem('mancala.game')).hist.length }));
      ok(mid.saved === 1, `move is saved before the animation ends (busy=${mid.busy}, saved hist ${mid.saved})`);
      await page.reload(); await ready(page);
      const s = await G(page);
      ok(s.hist.length === 1 && s.side === 1 && s.b[0] === 0 && s.b[1] === 5, `after a mid-animation reload the move is still there (hist ${s.hist.length}, side ${s.side})`);
      // [5] rotation updates the "tap the left column / bottom row" hint
      const before = await page.evaluate(() => __game.status());
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => !__game.state().vertical);
      const after = await page.evaluate(() => __game.status());
      ok(/右欄/.test(before) && /上排/.test(after), `status follows rotation: "${before}" -> "${after}"`);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => __game.state().vertical);
      ok(/右欄/.test(await page.evaluate(() => __game.status())), 'status back to the column wording after rotating back');
      // [detail] starting a new game over an unfinished one asks first
      await page.click('#bMenu'); await page.click('#mStart');
      ok(await page.isVisible('#ovConfirm') && (await G(page)).hist.length === 1, 'new game over an unfinished game asks for confirmation');
      await page.click('#cfNo');
      ok(!(await page.isVisible('#ovConfirm')) && (await G(page)).hist.length === 1, 'cancel keeps the unfinished game');
      await page.click('#mStart'); await page.click('#cfYes'); await ready(page);
      ok((await G(page)).hist.length === 0, 'confirm starts the new game');
      await ctx.close();
    }
    { // [1] the finishing move records the result before its animation: reload mid-animation keeps it
      const st = { settings: Object.assign({}, SET, { mode: 'ai', level: 1 }), game: saveOf({ b: [0,0,0,0,0,1,20, 1,2,3,0,0,1,20] }) };
      const { ctx, page, tapPit } = await open(undefined, seed(st));
      await ready(page); await tapPit(0, 5);
      await page.waitForFunction(() => __game.state().over);
      const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('mancala.stats')).games);
      await page.reload(); await page.waitForFunction(() => window.__game);
      const st2 = await page.evaluate(() => __game.stats());
      ok(rec === 1 && st2.games === 1 && st2.lv.k1[1] === 1, `result recorded at once and kept after reload (${rec}, ${JSON.stringify(st2.lv)})`);
      await ctx.close();
    }
    { // [3] wins after undo / hint are assisted wins: no level win, no badge; [4] unassisted wins earn level badges
      const winPos = [0,0,0,0,0,1,30, 1,1,1,0,0,0,14];
      const old = { lv: { k2: [3, 1, 0] }, p2: 0, games: 4, marginSum: 12, maxCap: 6, maxChain: 2, ach: { chain5: 1 } }; // stats saved by the previous version
      const { ctx, page, tapPit } = await open(undefined, seed({ settings: Object.assign({}, SET, { mode: 'ai', level: 1 }), stats: old, game: saveOf({ b: winPos, undos: 2 }) }));
      let s0 = await page.evaluate(() => __game.stats());
      ok(s0.lv.k2[0] === 3 && s0.ach.lv2 === 1 && s0.ach.chain5 === 1 && s0.aw && !s0.ach.lv1, 'old stats load unchanged and earn the badge for levels already beaten');
      await ready(page); await tapPit(0, 5);
      await page.waitForSelector('#ovResult:not([hidden])');
      let s = await page.evaluate(() => __game.stats());
      ok(s.aw.k1 === 1 && !(s.lv.k1 && s.lv.k1[0]) && !s.ach.lv1 && s.streak === 0, `assisted win counted apart (${JSON.stringify({ aw: s.aw, lv: s.lv.k1, ach: s.ach })})`);
      ok(/輔助勝/.test(await page.textContent('#rNote')), 'result sheet says the win is an assisted win');
      await page.click('#rBoard'); await page.click('#bStats');
      ok(/\+1 輔助/.test(await page.textContent('#stBody')) && /擊敗 1 撒豆子/.test(await page.textContent('#stAch')), 'stats table shows the assisted win and the badge list');
      await page.click('#ovStats [data-close]');
      await page.evaluate(() => { localStorage.setItem('mancala.game', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('mancala.game')), { b: [0,0,0,0,0,1,30, 1,1,1,0,0,0,14], over: false, undos: 0, hints: 0, recorded: false, lastRec: null, shown: false, hist: [], snaps: [] }))); });
      await page.reload(); await ready(page); await tapPit(0, 5);
      await page.waitForSelector('#ovResult:not([hidden])');
      s = await page.evaluate(() => __game.stats());
      ok(s.lv.k1[0] === 1 && s.ach.lv1 === 1 && s.streak === 1, `unassisted win counts and earns the level-1 badge (${JSON.stringify(s.lv.k1)})`);
      ok(/徽章/.test(await page.textContent('#rAch')) && /下一個目標/.test(await page.textContent('#rNote')), 'result sheet shows the new badge and the next goal');
      await page.click('#rBoard'); await page.click('#tUndo'); await ready(page);
      s = await page.evaluate(() => __game.stats());
      ok(s.lv.k1[0] === 0 && s.streak === 0 && s.games === 4 + 1, `undoing the finished game takes the win back (${JSON.stringify(s.lv.k1)}, games ${s.games})`);
      await ctx.close();
    }
    { // [detail] review a finished game move by move
      const g = MC.newGame({ rule: 'kalah', seeds: 3 }); let r = 5; const rr = () => (r = (r * 16807) % 2147483647) / 2147483647;
      for (;;) { const m = MC.moves('kalah', g.b, g.side), t = MC.newGame({ rule: 'kalah', seeds: 3 }); t.b = Int8Array.from(g.b); t.side = g.side;
        const end = m.find(p => MC.simulate(t, p).over); if (end != null && g.side === 0) break; MC.play(g, m[Math.floor(rr() * m.length)]); if (g.over) throw new Error('no end'); }
      const endPit = MC.moves('kalah', g.b, 0).find(p => MC.simulate(g, p).over);
      const save = saveOf({ seeds: 3, mode: '2p', b: Array.from(g.b), side: 0, plies: g.plies, hist: g.hist.map(h => h.p) });
      const { ctx, page, tapPit } = await open(undefined, seed({ settings: Object.assign({}, SET, { speed: 'instant' }), game: save }));
      await ready(page); await tapPit(0, endPit);
      await page.waitForSelector('#ovResult:not([hidden])');
      const fin = (await G(page)).b;
      await page.click('#rReview');
      let v = await page.evaluate(() => __game.review());
      ok(v && v.k === 0 && v.n === g.hist.length + 1 && v.board.join() === Array.from(MC.newBoard('kalah', 3)).join() && await page.isVisible('#rvBar') && !(await page.isVisible('nav.tools:not(#rvBar)')), `review starts at the opening (${v && v.n} moves)`);
      await page.click('#rvNext'); await page.click('#rvNext');
      const g2 = MC.newGame({ rule: 'kalah', seeds: 3 }); MC.play(g2, g.hist[0].p); MC.play(g2, g.hist[1].p);
      v = await page.evaluate(() => __game.review());
      ok(v.k === 2 && v.board.join() === Array.from(g2.b).join() && /回顧 2／/.test(await page.evaluate(() => __game.status())), 'next steps through the moves');
      await page.click('#rvPrev'); v = await page.evaluate(() => __game.review()); ok(v.k === 1, 'previous goes back');
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
      v = await page.evaluate(() => __game.review()); ok(v.k === 4, 'arrow keys step too');
      await page.click('#rvExit');
      ok(!(await page.evaluate(() => __game.review())) && (await G(page)).b.join() === fin.join() && await page.isVisible('nav.tools:not(#rvBar)'), 'leaving the review restores the final board and tool bar');
      await ctx.close();
    }
    { // [7] lobby iPhone-SE frame 375x500: the board switches to columns with >= 44px pit spacing and fills the stage; nearest pit wins a tap
      const { ctx, page } = await open({ width: 375, height: 500 }, seed({ settings: Object.assign({}, SET, { beginner: true }) }));
      await page.click('#mStart'); await ready(page);
      const q = await page.evaluate(() => __game.geo());
      ok(q.vertical && q.pitch >= 44 && q.bh >= q.H * 0.7, `375x500: pitch ${q.pitch.toFixed(1)}px, board ${(q.bh / q.H * 100).toFixed(0)}% of stage height`);
      const a = await page.evaluate(() => __game.pitToClient(0, 0)), b = await page.evaluate(() => __game.pitToClient(0, 1));
      const cdp = await ctx.newCDPSession(page), x = a[0] + (b[0] - a[0]) * 0.62, y = a[1] + (b[1] - a[1]) * 0.62;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForFunction(() => __game.state().previewOn != null);
      ok((await G(page)).previewOn === 1, 'a tap between two pits selects the nearer one');
      await ctx.close();
    }
    { // [detail] 360x640 menu fits; first-move warning; rules mention Oware's end rules
      const { ctx, page } = await open({ width: 360, height: 640 });
      await page.waitForSelector('#ovMenu:not([hidden])');
      const bot = await page.evaluate(() => document.getElementById('mStart').getBoundingClientRect().bottom);
      ok(bot <= 640, `360x640 menu: 開始新局 fully on screen (bottom ${Math.round(bot)})`);
      await page.click('#cMode .chip[data-v="ai"]'); await page.click('#cLevel .chip[data-v="4"]'); await page.click('#cFirst .chip[data-v="ai"]');
      ok(/先手占優/.test(await page.textContent('#toast')), 'choosing 電腦先 against level 4/5 warns about the first-move advantage');
      const rules = await page.textContent('#ovRule');
      ok(/100 手/.test(rules) && /24 : 24/.test(rules) && /先手/.test(rules), 'rules page lists the 100-move and 24:24 rules and the first-move advantage');
      await ctx.close();
    }
  } finally { await browser.close(); }
  ok(errors.length === 0, `no page or console errors (${errors.slice(0, 3).join(' | ')})`);
}
browserTests().catch(e => { fail++; console.log('FAIL browser tests threw:', e && e.stack || e); }).finally(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
});
