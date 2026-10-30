// Rule tests for 中國跳棋: runs the game's own engine (code between CORE markers of ../index.html).
// Part 2 drives the real page in mobile Chromium with CDP touch (served over http): layout at phone, short and landscape sizes,
// snapping taps between holes, double taps, long-press preview, taps while the computer thinks, save / pagehide flush / validated resume,
// confirm before abandoning, stats recorded once at the end.
// Usage: node tests.js [--no-browser]
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
// ---- AI levels are a ladder (each level is a different policy: error rate, straggler weight, search) ----
{
  const lv = CC.LEVELS; ok(lv.every((l, i) => !i || (l.err <= lv[i - 1].err && l.time >= lv[i - 1].time)), 'levels: fewer mistakes and more time as they go up');
  // L1 vs L2 and L2 vs L3, a few quick games each with real budgets (full ladder, 12 games a pair: 1-11, 2-10, 0-12)
  for (const [a, b] of [[1, 2], [2, 3]]) {
    let wb = 0;
    for (let g = 0; g < 4; g++) {
      const st = CC.newGame({ np: 2 }), lvOf = q => ((q + g) % 2 === 0 ? a : b); let n = 0;
      while (!st.over) { const r = CC.think(st, st.turn, lvOf(st.turn), { seed: 11 + g * 1000 + n }); if (!r) CC.pass(st); else CC.play(st, r.from, r.to); n++; }
      if (lvOf(st.over.ranking[0]) === b) wb++;
    }
    ok(wb >= 3, 'L' + b + ' beats L' + a + ' in at least 3 of 4 games (' + wb + ')');
  }
}
// ---- player colours stay apart for colour-blind players (Machado 2009, CIE76 in Lab) ----
{
  const COLORS = JSON.parse(html.match(/const COLORS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
  const MX = { none: [1, 0, 0, 0, 1, 0, 0, 0, 1], prot: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998], deut: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881], trit: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900] };
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lab = (h, m) => { const r = lin(parseInt(h.slice(1, 3), 16)), g = lin(parseInt(h.slice(3, 5), 16)), b = lin(parseInt(h.slice(5, 7), 16)), cl = v => Math.min(1, Math.max(0, v));
    const R = cl(m[0] * r + m[1] * g + m[2] * b), G2 = cl(m[3] * r + m[4] * g + m[5] * b), B = cl(m[6] * r + m[7] * g + m[8] * b), f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const X = (R * 0.4124 + G2 * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G2 * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G2 * 0.1192 + B * 0.9505) / 1.08883;
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
  for (const np of [2, 3, 4, 6]) {
    let mn = 1e9, where = '';
    for (const k in MX) { if (np === 6 && k !== 'none') continue; const sc = CC.SEATS[np];
      for (let i = 0; i < sc.length; i++) for (let j = i + 1; j < sc.length; j++) { const A = lab(COLORS[sc[i]], MX[k]), B = lab(COLORS[sc[j]], MX[k]), d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); if (d < mn) { mn = d; where = k + ' ' + sc[i] + '/' + sc[j]; } } }
    ok(mn >= 25, np + 'p colours apart (ΔE ' + mn.toFixed(0) + ' at ' + where + ')' + (np === 6 ? ' — 6p with colour blindness relies on the shape option' : ''));
  }
}
console.log('rule tests:', pass, 'passed,', fail, 'failed');

// ================= real page in mobile Chromium (CDP touch), served over http =================
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, server, base, tid = 1;
function serve() {
  return new Promise(res => {
    server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'))); });
    server.listen(0, '127.0.0.1', () => { server.unref(); base = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
  });
}
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 90 s')), 90000); })]); clearTimeout(tm); console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0], process.env.DBG ? e.stack : ''); }
}
const SET = o => JSON.stringify(Object.assign({ np: 2, seats: [{ h: 1, l: 3 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }], quick: false, rule: true, firstEnds: false, cb: false, sound: false, speed: 4 }, o));
async function open(vp, ls, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base); await page.waitForFunction(() => window.__game);
  if (ls) { await page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('ccheckers.' + k, ls[k]); }, ls); await page.reload(); await page.waitForFunction(() => window.__game); }
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: tid }] });
  const tap = async (x, y, hold = 40) => { tid++; await touch('touchStart', x, y); await sleep(hold); await touch('touchEnd'); };
  const settle = sel => page.waitForFunction(sel => { const e = document.querySelector(sel), c = e && e.closest('.card'); return !c || c.getAnimations().every(a => a.playState !== 'running'); }, sel, { timeout: 5000 }).catch(() => {});
  const tapSel = async sel => {
    await settle(sel); await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel);
    await page.evaluate(sel => { window.__clicked = 0; document.querySelector(sel).addEventListener('click', () => { window.__clicked = 1; }, { once: true }); }, sel);
    await tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForFunction(() => window.__clicked, null, { timeout: 5000 });
  };
  const st = () => page.evaluate(() => window.__game.state());
  const xy = c => page.evaluate(c => window.__game.cellXY(c), c);
  const humanReady = () => page.waitForFunction(() => { const s = window.__game.state(); return s.phase === 'human' && s.human; }, null, { timeout: 30000 });
  const vis = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
  const ls2 = k => page.evaluate(k => { try { return JSON.parse(localStorage.getItem('ccheckers.' + k)); } catch (e) { return 'BAD'; } }, k);
  // a point ~0.42 hole spacings off cell c (between holes) whose nearest "meaningful" hole is still c
  const offPoint = async (c, meaningful) => page.evaluate(([c, M]) => {
    const g = window.__game, s = g.state().s, [x0, y0] = g.cellXY(c);
    for (let a = 0; a < 12; a++) { const x = x0 + Math.cos(a * Math.PI / 6) * s * 0.42, y = y0 + Math.sin(a * Math.PI / 6) * s * 0.42;
      if (M.every(q => q === c || Math.hypot(g.cellXY(q)[0] - x, g.cellXY(q)[1] - y) > s * 0.42 + 2)) return [x, y]; }
    return [x0 + s * 0.3, y0];
  }, [c, meaningful]);
  return { ctx, page, errors, tap, tapSel, st, xy, humanReady, vis, ls: ls2, offPoint, close: () => ctx.close() };
}
// first own marble with a plain step and the step's target, from the page state
function stepMove(g) {
  const b = g.st.board;
  for (let c = 0; c < CC.N; c++) if (b[c] === g.turn) { const st = CC.load(g.st), P = CC.paths(st, g.turn, c); for (const k in P) if (!P[k].jumps) return [c, +k]; }
  return null;
}
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  await serve(); browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch, http)');
  try {
    await at('board fits between the bars at phone sizes, short screens and landscape; rotating mid-game relayouts', async () => {
      for (const [w, h, np] of [[390, 844, 2], [375, 560, 2], [360, 640, 6], [844, 390, 4], [667, 375, 2]]) {
        const s = await open({ width: w, height: h }, { settings: SET({ np, seats: [{ h: 1, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }] }) });
        await s.tapSel('#bStart'); await s.humanReady();
        const r = await s.page.evaluate(([w, h]) => {
          const g = window.__game, land = document.body.classList.contains('land'), R = id => document.getElementById(id).getBoundingClientRect();
          const t = R('top'), b = R('bar'), st = R('status'), s = g.state().s; let bad = 0;
          for (let c = 0; c < 121; c++) { const [x, y] = g.cellXY(c), r = s * 0.42;
            if (x - r < 0 || x + r > w || y - r < 0 || y + r > h) bad++;
            else if (!land && (y - r < t.bottom - 1 || y + r > Math.min(b.top, st.top) + 1)) bad++;
            else if (land && (x - r < t.right - 1 || x + r > b.left + 1)) bad++; }
          return { bad, s: Math.round(s) };
        }, [w, h]);
        ok(r.bad === 0 && r.s >= 22, w + 'x' + h + ' ' + np + 'p: every hole inside the board area (' + r.bad + ' outside), spacing ' + r.s + 'px');
        if (w === 390) { await s.page.setViewportSize({ width: 844, height: 390 }); await s.page.waitForFunction(() => document.body.classList.contains('land')); const g = await s.st(); const [x, y] = await s.xy(0); ok(g.s > 20 && x > 200 && x < 760 && y > 0 && y < 390, 'rotated to landscape: board relaid out (' + Math.round(g.s) + 'px)'); }
        ok(!s.errors.length, w + 'x' + h + ' no page errors ' + s.errors.join(' | ')); await s.close();
      }
    });
    await at('taps between holes snap to your marble / lit destination; a quick double tap does not fast-forward the computer', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: SET({ seats: [{ h: 1, l: 3 }, { h: 0, l: 5 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }, { h: 0, l: 1 }] }) });
      await s.tapSel('#bStart'); await s.humanReady();
      let g = await s.st(); const [from, to] = stepMove(g);
      const own = []; for (let c = 0; c < CC.N; c++) if (g.st.board[c] === 0) own.push(c);
      let [x, y] = await s.offPoint(from, own); await s.tap(x, y);
      await s.page.waitForFunction(f => window.__game.state().sel === f, from, { timeout: 3000 });
      g = await s.st(); ok(g.sel === from && g.dests.includes(to), 'tap ~0.42 spacing off the marble selected it');
      { // a tap right on an empty hole that is not a destination deselects instead of snapping to a neighbouring destination
        const D = g.dests, cand = []; for (let c = 0; c < CC.N; c++) if (g.st.board[c] < 0 && !D.includes(c) && D.some(d => CC.ADJ[c * CC.N + d])) cand.push(c);
        const e = cand[0], [ex, ey] = await s.xy(e), [dx, dy] = await s.xy(D.find(d => CC.ADJ[e * CC.N + d]));
        await s.tap(ex + (dx - ex) * 0.2, ey + (dy - ey) * 0.2); await s.page.waitForFunction(() => window.__game.state().sel === -1, null, { timeout: 3000 });
        const g2 = await s.st(); ok(g2.sel === -1 && g2.st.round === 1 && g2.phase === 'human', 'tap inside a plain hole next to a destination: deselected, no move');
        await s.tap(x, y); await s.page.waitForFunction(f => window.__game.state().sel === f, from, { timeout: 3000 }); g = await s.st();
      }
      [x, y] = await s.offPoint(to, own.concat(g.dests)); 
      await s.page.evaluate(() => { window.__ffSeen = false; window.__ffI = setInterval(() => { if (window.__game.state().ff) window.__ffSeen = true; }, 5); });
      await s.tap(x, y); await sleep(170); await s.tap(x, y); await sleep(150); await s.tap(x, y);
      await s.page.waitForFunction(t => window.__game.state().st.board[t] === 0, to, { timeout: 3000 });
      await s.humanReady();
      g = await s.st(); const ffSeen = await s.page.evaluate(() => { clearInterval(window.__ffI); return window.__ffSeen; });
      ok(g.st.board[to] === 0 && g.st.board[from] < 0 && g.st.round === 2, 'tap off the destination moved there and the computer replied');
      ok(!ffSeen && g.sel === -1, 'the extra taps of a double/triple tap neither fast-forwarded the computer nor selected anything');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });
    await at('long press previews and keeps the path; a second tap goes; taps while the computers think only fast-forward, and the UI keeps running (6 players)', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: SET({ np: 6, seats: [{ h: 1, l: 3 }, { h: 0, l: 5 }, { h: 0, l: 5 }, { h: 0, l: 5 }, { h: 0, l: 5 }, { h: 0, l: 5 }], speed: 1 }) });
      await s.tapSel('#bStart'); await s.humanReady();
      let g = await s.st(); const [from, to] = stepMove(g);
      let p = await s.xy(from); await s.tap(p[0], p[1]); await s.page.waitForFunction(f => window.__game.state().sel === f, from);
      p = await s.xy(to); await s.tap(p[0], p[1], 650);
      await sleep(200); g = await s.st();
      ok(g.preview === to && g.st.board[to] < 0 && g.phase === 'human', 'long press: path previewed, no move (' + g.preview + ')');
      await s.tap(p[0], p[1]); await s.page.waitForFunction(() => window.__game.state().phase === 'think', null, { timeout: 5000 });
      g = await s.st(); ok(g.st.board[to] === 0, 'tap after the preview made the move');
      await sleep(750); // past the double-tap guard; five Lv5 seats think ~1.2 s each in a worker
      const frames = await s.page.evaluate(() => new Promise(res => { let n = 0; const t0 = performance.now(); (function f() { n++; if (performance.now() - t0 < 600) requestAnimationFrame(f); else res(n); })(); }));
      const q = await s.xy(CC.TRI[3][0]); await s.tap(q[0], q[1]); await sleep(60);
      g = await s.st(); ok(g.ff && g.sel === -1 && !g.human, 'tap while the computer thinks only fast-forwards (ff ' + g.ff + ', phase ' + g.phase + ')');
      ok(frames >= 6, 'page keeps drawing while Lv5 thinks in a worker (' + frames + ' frames in 0.6 s)');
      ok(await s.page.evaluate(() => document.getElementById('bHint').disabled), '提示 is greyed out while the computer is on move');
      await s.humanReady(); g = await s.st(); ok(!g.ff && g.st.round === 2, 'computer moved, fast-forward reset on your turn');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });
    await at('game, undo history and stats survive a reload; a move still animating is saved on pagehide; idle board stops redrawing', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: SET() });
      await s.tapSel('#bStart'); await s.humanReady();
      let g = await s.st(); const start = g.st.board.join();
      let [from, to] = stepMove(g); let p = await s.xy(from); await s.tap(p[0], p[1]); await s.page.waitForFunction(f => window.__game.state().sel === f, from);
      p = await s.xy(to); await s.tap(p[0], p[1]); await s.humanReady();
      await sleep(3200); g = await s.st(); ok(!g.raf, 'nothing moving on your turn: animation loop idle');
      [from, to] = stepMove(g); p = await s.xy(from); await s.tap(p[0], p[1]); await s.page.waitForFunction(f => window.__game.state().sel === f, from);
      g = await s.st(); ok(g.raf, 'selection pulse wakes the loop');
      p = await s.xy(to);
      const saved = s.page.evaluate(to => new Promise(res => { const i = setInterval(() => { const g = window.__game.state(); if (g.anim) { clearInterval(i); dispatchEvent(new Event('pagehide')); const sv = JSON.parse(localStorage.getItem('ccheckers.game')); res(sv.st.board[to]); } }, 1); }), to);
      await s.tap(p[0], p[1]); ok(await saved === 0, 'pagehide during the move animation saved the board with the move');
      await s.humanReady(); g = await s.st(); const board = g.st.board.join(), round = g.st.round;
      await s.page.reload(); await s.page.waitForFunction(() => window.__game);
      ok(await s.vis('bResume'), 'setup offers 繼續上局 after a reload'); await s.tapSel('#bResume'); await s.humanReady();
      g = await s.st(); ok(g.st.board.join() === board && g.st.round === round && g.undo === 2, 'resumed board, round and undo history (' + g.undo + ')');
      await s.tapSel('#bUndo'); await s.humanReady(); await s.tapSel('#bUndo'); await s.humanReady(); g = await s.st();
      ok(g.st.board.join() === start && g.st.round === 1 && g.undo === 0, 'two undos after the reload return to the opening');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });
    await at('corrupt storage falls back cleanly; restarting a game in progress asks first', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: '{"np":5,"seats":"x","speed":9,"cb":"yes"}', stats: '{"games":"a","byNp":5,"ach":null,"wins":-3}', game: '{"st":{"np":2,"corners":[0,3],"board":[1,2,3]},"seats":[]}' });
      ok(!(await s.vis('bResume')), 'broken saved game: no resume button'); ok((await s.ls('game')) === null, 'broken saved game removed');
      const onTop = sel => s.page.evaluate(sel => { const e = document.querySelector(sel), b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); }, sel);
      await s.tapSel('#bStats'); ok(await s.vis('stats') && await onTop('#stats [data-close]'), 'title screen: 戰績 opens above the setup screen (it used to open behind it)'); await s.tapSel('#stats [data-close]');
      await s.tapSel('#bRules'); ok(await onTop('#rules [data-close]'), 'title screen: 玩法 opens above the setup screen'); await s.tapSel('#rules [data-close]');
      for (const bad of [
        (b, f) => { b[0] = 7; }, (b, f) => { b[b.indexOf(0)] = -1; }, (b, f) => { f.fill(1); }]) {
        const sv = JSON.parse(JSON.stringify({ st: CC.save(CC.newGame({ np: 2 })), seats: [{ human: true, level: 3, name: '你' }, { human: false, level: 1, name: 'x' }], pst: [], hints: 0, rec: true }));
        bad(sv.st.board, sv.st.fresh);
        await s.page.evaluate(v => localStorage.setItem('ccheckers.game', v), JSON.stringify(sv));
        await s.page.reload(); await s.page.waitForFunction(() => window.__game);
        ok(!(await s.vis('bResume')), 'tampered board rejected');
      }
      await s.tapSel('#bStart'); await s.humanReady();
      let g = await s.st(); ok(g.st.np === 2, 'broken settings fell back to 2 players');
      const [from, to] = stepMove(g); let p = await s.xy(from); await s.tap(p[0], p[1]); await s.page.waitForFunction(f => window.__game.state().sel === f, from);
      p = await s.xy(to); await s.tap(p[0], p[1]); await s.humanReady();
      await s.tapSel('#bMenu'); await s.tapSel('#mRestart'); ok(await s.vis('confirm'), '重新開局 asks first');
      await s.tapSel('#cNo'); g = await s.st(); ok(!(await s.vis('confirm')) && g.st.round === 2, 'cancel keeps the game');
      await s.tapSel('#bMenu'); await s.tapSel('#mSetup'); ok(await s.vis('bResume'), '新局設定 keeps the game resumable');
      await s.tapSel('#bStart'); ok(await s.vis('confirm'), '開始對局 over a saved game asks first');
      await s.tapSel('#cYes'); await s.humanReady(); g = await s.st(); ok(g.st.round === 1 && g.undo === 0, 'confirmed: fresh game');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });
    await at('a win is recorded once, the moment the game ends (before the result card), and survives a reload; title colour readable', async () => {
      // seat 0 one step from home: nine marbles in the target, the tenth next to the last hole
      const st = CC.newGame({ np: 2 }); st.board.fill(-1); st.fresh.fill(0);
      const I = CC.info(st), gl = I[0].goalList, last = gl.find(c => CC.DIST[3][c] === 3);
      const from = CC.NB.slice(last * 6, last * 6 + 6).find(n => n >= 0 && CC.CORNER[n] < 0);
      gl.forEach(c => { if (c !== last) st.board[c] = 0; }); st.board[from] = 0;
      const mid = []; for (let c = 0; c < CC.N; c++) if (CC.CORNER[c] < 0 && st.board[c] < 0 && CC.hd(c, from) > 2 && CC.X[c] < 0) mid.push(c);
      mid.slice(0, 10).forEach(c => { st.board[c] = 1; }); st.round = 40;
      const sv = { st: CC.save(st), seats: [{ human: true, level: 3, name: '你' }, { human: false, level: 1, name: '藍・小孩' }], pst: [{ steps: 5, jumps: 30, maxJump: 4, moves: 35 }, { steps: 9, jumps: 20, maxJump: 3, moves: 29 }], hints: 0, rec: true, undo: [] };
      for (const dark of [false, true]) {
        const s = await open({ width: 390, height: 844 }, { settings: SET(), game: JSON.stringify(sv) }, { dark });
        await s.tapSel('#bResume'); await s.humanReady();
        let p = await s.xy(from); await s.tap(p[0], p[1]); await s.page.waitForFunction(f => window.__game.state().sel === f, from);
        p = await s.xy(last); await s.tap(p[0], p[1]);
        await s.page.waitForFunction(() => window.__game.state().phase === 'over', null, { timeout: 5000 });
        const early = await s.ls('stats'), vis0 = await s.vis('result');
        ok(early && early.games === 1 && early.wins === 1 && !vis0, 'stats written at the end, before the result card (' + JSON.stringify(early && [early.games, early.wins]) + ', card ' + vis0 + ')');
        await s.page.waitForFunction(() => window.__game.state().resultVisible, null, { timeout: 5000 });
        ok((await s.page.textContent('#rTitle')) === '你贏了！', 'result title');
        const c = await s.page.evaluate(() => window.__game.inkContrast());
        ok(c.every(x => x >= 4.5), (dark ? 'dark' : 'light') + ': winner colours as title text ≥ 4.5:1 ' + c.map(x => x.toFixed(1)));
        await s.tapSel('#rView'); await s.tapSel('#bResult');
        let st2 = await s.ls('stats'); ok(st2.games === 1, 'reopening the result does not count it again');
        await s.page.reload(); await s.page.waitForFunction(() => window.__game);
        st2 = await s.ls('stats'); ok(st2.games === 1 && st2.ach.first && !(await s.vis('bResume')), 'after a reload: still one game, 首勝 unlocked, no resume of a finished game');
        ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
      }
    });
  } finally { await browser.close(); }
}
(async () => {
  if (!process.argv.includes('--no-browser')) await browserTests();
  console.log((fail ? 'FAIL ' : '') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
