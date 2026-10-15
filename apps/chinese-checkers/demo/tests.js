// Rule tests for 中國跳棋: runs the game's own engine (code between CORE markers of ../index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const CC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return CC;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const cell = (x, y) => { for (let c = 0; c < CC.N; c++) if (CC.X[c] === x && CC.Y[c] === y) return c; return -1; };
const empty = (np, o) => { const st = CC.newGame(Object.assign({ np: np || 2 }, o || {})); st.board.fill(-1); st.fresh.fill(0); return st; };
const dests = (st, p, c) => Object.keys(CC.paths(st, p, c)).map(Number).sort((a, b) => a - b);

// ---- board geometry ----
ok(CC.N === 121, '121 holes, got ' + CC.N);
let hex = 0, deg = {}; for (let c = 0; c < CC.N; c++) { if (CC.CORNER[c] < 0) hex++; let n = 0; for (let d = 0; d < 6; d++) if (CC.NB[c * 6 + d] >= 0) n++; deg[n] = (deg[n] || 0) + 1; }
ok(hex === 61, 'central hexagon has 61 holes, got ' + hex);
ok(CC.TRI.every(t => t.length === 10), 'six triangles of 10 holes');
let sym = true, edges = 0;
for (let c = 0; c < CC.N; c++) for (let d = 0; d < 6; d++) { const n = CC.NB[c * 6 + d]; if (n >= 0) { edges++; if (CC.NB[n * 6 + (d + 3) % 6] !== c || CC.hd(c, n) !== 1) sym = false; } }
ok(sym, 'adjacency symmetric and unit distance');
ok(edges / 2 === 312, 'undirected edges = 156 (hexagon) + 6*18 (triangles) + 6*8 (links) = 312, got ' + edges / 2);
console.log('holes', CC.N, 'hexagon', hex, 'neighbour-count histogram', JSON.stringify(deg), 'edges', edges / 2);
// opposite corners are point-reflections of each other
for (let k = 0; k < 3; k++) ok(CC.TRI[k].every(c => CC.CORNER[cell(-CC.X[c], -CC.Y[c])] === k + 3), 'corner ' + k + ' opposite of ' + (k + 3));

// ---- seating ----
const expect = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 2, 3, 5], 6: [0, 1, 2, 3, 4, 5] };
for (const np of [2, 3, 4, 6]) {
  const st = CC.newGame({ np }), I = CC.info(st);
  ok(JSON.stringify(st.corners) === JSON.stringify(expect[np]), np + 'p corners');
  for (let p = 0; p < np; p++) {
    ok(st.board.filter(v => v === p).length === 10, np + 'p seat ' + p + ' has 10 pieces');
    ok(CC.TRI[st.corners[p]].every(c => st.board[c] === p), np + 'p seat ' + p + ' fills its start triangle');
    ok(I[p].t === (st.corners[p] + 3) % 6, np + 'p seat ' + p + ' target is the opposite triangle');
  }
  if (np === 3) ok(st.corners.every(k => CC.TRI[(k + 3) % 6].every(c => st.board[c] < 0)), '3p targets start empty');
}
{ const st = CC.newGame({ np: 2, quick: true }); ok(st.board.filter(v => v === 0).length === 6 && CC.SMALL[0].every(c => st.board[c] === 0), 'quick mode: 6 pieces in the small triangle'); }

// ---- move generation ----
const st0 = CC.newGame({ np: 2 });
ok(CC.moves(st0, 0).length === 14, 'opening has 14 moves (8 steps + 6 jumps), got ' + CC.moves(st0, 0).length);
for (let d = 1; d <= 4; d++) console.log('perft(2 players, start) depth', d, '=', CC.perft(CC.newGame({ np: 2 }), d));
ok(CC.perft(CC.newGame({ np: 2 }), 2) === 196, 'perft 2 = 14*14');
{ // simple jump, cannot jump empty, cannot jump two in a row, jump lands only on empty
  const st = empty(); const a = cell(0, 0), b = cell(1, -1), c2 = cell(2, -2), e = cell(3, -3);
  st.board[a] = 0; st.board[b] = 1;
  ok(dests(st, 0, a).includes(c2), 'jump over adjacent piece');
  st.board[c2] = 1; ok(!dests(st, 0, a).includes(e) && !dests(st, 0, a).includes(c2), 'cannot jump over two pieces in a row / onto occupied');
  st.board[c2] = -1; st.board[b] = -1; ok(!dests(st, 0, a).includes(c2), 'cannot jump over an empty hole');
  st.board[b] = 1; CC.play(st, a, c2); ok(st.board[b] === 1, 'jumped piece is not captured');
}
{ // multi-jump chain changes direction; path is the shortest; step+jump cannot mix
  const st = empty(); const a = cell(0, 0);
  st.board[a] = 0; st.board[cell(1, -1)] = 1; st.board[cell(2, -1)] = 1; st.board[cell(3, 0)] = 1; // (0,0)->(2,-2)->(2,0)? use generic check below
  const P = CC.paths(st, 0, a);
  const end = cell(2, -2); ok(P[end] && P[end].jumps === 1, 'first landing one jump');
  const two = Object.values(P).filter(v => v.jumps >= 2);
  ok(two.length > 0, 'chain of 2+ jumps found');
  const adjOnly = cell(3, -2); // adjacent to landing (2,-2) but not reachable by a pure jump chain
  ok(!P[adjOnly], 'no step after a jump (step and jump not mixed)');
}
// randomized: BFS endpoints == exhaustive DFS endpoints, and path lengths are minimal; also every path is a valid jump chain
function dfsAll(b, from) { const seen = new Set([from]), res = new Map(); const sv = b[from]; b[from] = -1;
  (function rec(u, depth) { for (let d = 0; d < 6; d++) { const n = CC.NB[u * 6 + d]; if (n < 0 || b[n] < 0) continue; const j = CC.NB[n * 6 + d]; if (j < 0 || b[j] >= 0 || seen.has(j)) continue; if (!res.has(j) || res.get(j) > depth + 1) res.set(j, depth + 1); seen.add(j); rec(j, depth + 1); seen.delete(j); } })(from, 0);
  b[from] = sv; return res; }
function bfsMin(b, from) { const sv = b[from]; b[from] = -1; const dist = new Map([[from, 0]]), q = [from];
  while (q.length) { const u = q.shift(); for (let d = 0; d < 6; d++) { const n = CC.NB[u * 6 + d]; if (n < 0 || b[n] < 0) continue; const j = CC.NB[n * 6 + d]; if (j < 0 || b[j] >= 0 || dist.has(j)) continue; dist.set(j, dist.get(u) + 1); q.push(j); } }
  b[from] = sv; dist.delete(from); return dist; }
{
  const rng = CC.rngOf(1234); let positions = 0, chains = 0, longest = 0, bad = 0;
  for (let t = 0; t < 250; t++) {
    const st = empty(2, { rule: false }); const hexCells = []; for (let c = 0; c < CC.N; c++) if (CC.CORNER[c] < 0) hexCells.push(c);
    for (const c of hexCells) if (rng() < 0.42) st.board[c] = rng() < 0.5 ? 0 : 1;
    const mine = hexCells.filter(c => st.board[c] === 0); if (!mine.length) continue; positions++;
    for (const from of mine) {
      const P = CC.paths(st, 0, from), dfs = t < 60 ? dfsAll(st.board, from) : null, bfs = bfsMin(st.board, from);
      for (const [j, dmin] of bfs) { if (CC.ADJ[from * CC.N + j]) continue; if (!P[j] || P[j].jumps !== dmin) bad++; }
      if (dfs) for (const j of dfs.keys()) if (!CC.ADJ[from * CC.N + j] && !P[j]) bad++;
      for (const k in P) { const v = P[k]; if (!v.jumps) continue; chains++; longest = Math.max(longest, v.jumps);
        for (let i = 1; i < v.path.length; i++) { const u = v.path[i - 1], w = v.path[i]; let okj = false; for (let d = 0; d < 6; d++) { const n = CC.NB[u * 6 + d]; if (n >= 0 && CC.NB[n * 6 + d] === w && st.board[n] >= 0 && n !== from) okj = true; } if (!okj || st.board[w] >= 0) bad++; } }
      const L = CC.gen(st.board, 0, CC.info(st)[0].allow, []).filter(m => m >> 7 === from).map(m => m & 127).sort((a, b) => a - b);
      if (JSON.stringify(L) !== JSON.stringify(Object.keys(P).map(Number).sort((a, b) => a - b))) bad++;
    }
  }
  ok(bad === 0, 'random positions: BFS endpoints = exhaustive DFS endpoints, minimal jump counts, valid chains, gen == paths (' + bad + ' mismatches)');
  console.log('random jump check:', positions, 'positions,', chains, 'jump destinations, longest shortest-chain', longest, 'jumps, mismatches', bad);
}
{ // loop-shaped ring of pieces: BFS must terminate and visit each landing once
  const st = empty(2, { rule: false }); const centre = cell(0, 0);
  for (let d = 0; d < 6; d++) st.board[CC.NB[centre * 6 + d]] = 1; // ring around the centre
  const from = cell(2, -2); st.board[from] = 0; // any piece outside the ring
  const t = Date.now(); const P = CC.paths(st, 0, from); ok(Date.now() - t < 50 && Object.keys(P).length > 0, 'ring of pieces: chain search terminates (' + Object.keys(P).length + ' destinations)');
}
// ---- house rule: may pass through but not stop in a foreign triangle ----
{
  const st = empty(2); // 2p: corners 0 and 3 are ours/target, 1,2,4,5 foreign
  const side = CC.TRI[1]; // lower-left triangle
  // find a jump that lands in triangle 1 from the hexagon
  let found = null;
  for (const c of side) for (let d = 0; d < 6 && !found; d++) { const n = CC.NB[c * 6 + d]; if (n < 0) continue; const f = CC.NB[n * 6 + d]; if (f >= 0 && CC.CORNER[f] < 0 && CC.CORNER[n] < 0) found = [f, n, c, d]; }
  const [f, n, land, d] = found; st.board[f] = 0; st.board[n] = 1;
  ok(!dests(st, 0, f).includes(land), 'house rule: cannot stop in another triangle');
  // place a second hurdle so the chain passes through the triangle and comes back out
  const st2 = CC.load(CC.save(st)); st2.rule = true;
  let through = false;
  for (let d2 = 0; d2 < 6 && !through; d2++) { const m = CC.NB[land * 6 + d2]; if (m < 0 || m === n) continue; const out = CC.NB[m * 6 + d2]; if (out < 0 || CC.CORNER[out] >= 0 || out === f) continue; const s3 = CC.load(CC.save(st)); s3.board[m] = 1; const P = CC.paths(s3, 0, f); if (P[out] && P[out].path.includes(land)) through = true; }
  ok(through, 'house rule: may jump through another triangle');
  const st3 = empty(2, { rule: false }); st3.board[f] = 0; st3.board[n] = 1; ok(dests(st3, 0, f).includes(land), 'house rule off: may stop there');
}
// ---- win, anti-block rule ----
{
  const st = empty(2), I = CC.info(st); I[0].goalList.forEach(c => st.board[c] = 0);
  ok(CC.done(st, 0), 'all 10 in target = finished');
}
{
  const st = empty(2), I = CC.info(st), gl = I[0].goalList; st.board[gl[0]] = 0;
  const blockCell = gl[1];
  gl.forEach((c, i) => { if (i !== 1) st.board[c] = 0; });
  st.board[blockCell] = 1; st.fresh[blockCell] = 1; st.board[gl[0]] = 0;
  ok(CC.done(st, 0), 'anti-block: opponent piece that never left + 9 own = finished');
  st.fresh[blockCell] = 0; st.round = 12; ok(!CC.done(st, 0), 'opponent piece that moved back in does not count before round 30');
  st.round = 30; ok(CC.done(st, 0), 'from round 30 a piece left in its start triangle counts (佔位)');
  ok(CC.squatter(st, blockCell), 'piece is flagged as 佔位 from round 30');
  const s4 = empty(3), I4 = CC.info(s4); I4[0].goalList.forEach((c, i) => s4.board[c] = i ? 0 : 1); s4.fresh[I4[0].goalList[0]] = 1; s4.round = 40;
  ok(!CC.done(s4, 0), 'a third player\'s piece in your target never counts as a blocker');
  const s5 = empty(2), I5 = CC.info(s5); I5[0].goalList.forEach((c, i) => s5.board[c] = i < 9 ? 0 : -1);
  ok(!CC.done(s5, 0), '9 in target with an empty hole is not finished');
}
// ---- turn flow, ranking, round limit, first-ends option ----
{
  const st = CC.newGame({ np: 3 }); ok(st.turn === 0 && st.round === 1, 'seat 0 starts round 1');
  let m = CC.moves(st, 0)[0]; CC.play(st, m >> 7, m & 127); ok(st.turn === 1, 'turn passes clockwise');
  m = CC.moves(st, 1)[0]; CC.play(st, m >> 7, m & 127); m = CC.moves(st, 2)[0]; CC.play(st, m >> 7, m & 127);
  ok(st.turn === 0 && st.round === 2, 'round increments after every seat moved');
  st.fin[1] = 1; st.order.push(1); m = CC.moves(st, 0)[0]; CC.play(st, m >> 7, m & 127); ok(st.turn === 2, 'finished players are skipped');
}
{ // a player finishing in a 3-player game: others keep playing for places
  const st = empty(3), I = CC.info(st);
  I[0].goalList.forEach((c, i) => st.board[c] = i ? 0 : -1); const last = I[0].goalList[0];
  const from = CC.NB.slice(last * 6, last * 6 + 6).find(n => n >= 0 && CC.CORNER[n] < 0); st.board[from] = 0;
  for (let p = 1; p < 3; p++) CC.TRI[st.corners[p]].forEach(c => st.board[c] = p);
  const ev = CC.play(st, from, last);
  ok(ev.newly[0] === 0 && st.fin[0] && !st.over && st.turn === 1, '3p: first finisher gets place 1, game continues');
  const sf = empty(3, { firstEnds: true }); const If = CC.info(sf); If[0].goalList.forEach((c, i) => sf.board[c] = i ? 0 : -1); sf.board[from] = 0;
  for (let p = 1; p < 3; p++) CC.TRI[sf.corners[p]].forEach(c => sf.board[c] = p);
  sf.board[CC.TRI[sf.corners[2]][0]] = -1; sf.board[CC.info(sf)[2].goalList[0]] = 2; // seat 2 slightly ahead of seat 1
  CC.play(sf, from, last);
  ok(sf.over && sf.over.reason === 'first' && JSON.stringify(sf.over.ranking) === '[0,2,1]', 'first-ends option ranks the rest by remaining distance ' + JSON.stringify(sf.over && sf.over.ranking));
}
{ // round limit
  const st = CC.newGame({ np: 2 }); st.round = 300;
  st.board[CC.TRI[3][0]] = -1; st.board[CC.info(st)[1].goalList[0]] = 1; // seat 1 is ahead
  let m = CC.moves(st, 0).find(x => CC.CORNER[x & 127] < 0); CC.play(st, m >> 7, m & 127); ok(!st.over, 'round 300 still played');
  m = CC.moves(st, 1)[0]; CC.play(st, m >> 7, m & 127);
  ok(st.over && st.over.reason === 'limit' && st.round === 301, '300-round limit ends the game');
  ok(CC.remaining(st, st.over.ranking[0]) <= CC.remaining(st, st.over.ranking[1]), 'limit ranking by remaining distance');
}
{ // all humans finished -> game ends, rest ranked by distance
  const st = empty(3, { humans: [0] }), I = CC.info(st);
  I[0].goalList.forEach((c, i) => st.board[c] = i ? 0 : -1); const last = I[0].goalList[0];
  const from = CC.NB.slice(last * 6, last * 6 + 6).find(n => n >= 0 && CC.CORNER[n] < 0); st.board[from] = 0;
  for (let p = 1; p < 3; p++) CC.TRI[st.corners[p]].forEach(c => st.board[c] = p);
  CC.play(st, from, last); ok(st.over && st.over.reason === 'humans' && st.over.ranking[0] === 0, 'all human seats finished ends the game');
}
{ // stall rule: 40 rounds in which nobody still playing gets closer ends the game
  const st = CC.newGame({ np: 2 }); st.bestRem = -1; let r = 0;
  while (!st.over && r < 200) { const L = CC.moves(st, st.turn); const m = L[0]; CC.play(st, m >> 7, m & 127); r++; }
  ok(st.over && st.over.reason === 'stall' && st.round === 41, 'stall rule ends the game after 40 rounds without progress (round ' + st.round + ')');
  const s2 = CC.newGame({ np: 2 }); for (let i = 0; i < 60; i++) { const x = CC.think(s2, s2.turn, 2, { seed: i }); CC.play(s2, x.from, x.to); }
  ok(!s2.over && s2.stall < 3, 'normal play never trips the stall rule');
}
// ---- AI: every level returns a legal move, timings ----
for (const np of [2, 6]) for (let lv = 1; lv <= 5; lv++) {
  const st = CC.newGame({ np }); const rng = CC.rngOf(lv * 7 + np);
  for (let i = 0; i < np * 8; i++) { const L = CC.moves(st, st.turn); const m = L[Math.floor(rng() * L.length)]; CC.play(st, m >> 7, m & 127); }
  const t = Date.now(); const r = CC.think(st, st.turn, lv, { seed: 3 }); const ms = Date.now() - t;
  ok(r && CC.paths(st, st.turn, r.from)[r.to], np + 'p level ' + lv + ' returns a legal move');
  ok(ms <= CC.LEVELS[lv - 1].time + 250, np + 'p level ' + lv + ' within time budget (' + ms + 'ms)');
  console.log(np + 'p midgame think, level', lv, CC.LEVELS[lv - 1].name, ':', ms + 'ms', 'mode', r.mode, 'depth', r.depth, 'nodes', r.nodes);
}
console.log('rule tests:', pass, 'passed,', fail, 'failed');
process.exitCode = fail ? 1 : 0;
