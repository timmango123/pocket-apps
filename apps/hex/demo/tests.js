// Rule unit tests for 六角連通 (Hex). Extracts the engine between the CORE markers of ../index.html and checks
// board geometry (6-neighbour table, four virtual edges, shared corners), win detection for both colours, the no-draw
// property on random full boards, the swap (pie) rule with (r,c)->(c,r) mirroring, undo by replay, notation/records,
// winning path, connection distance, the bridge-saving playout policy, edge templates II / IIIa (proved by brute force),
// virtual-connection detection, AI immediate win / block / must-play / resignation, the opening book, and move counts.
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const H = new Function(src + ';return HEX;')();
const { RED, BLUE, SWAP } = H;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const idx = (N, r, c) => r * N + c;
function setup(N, rows) {           // rows of 'R' 'B' '.'; turn is set by stone counts
  const g = new H.Game({ size: N, swap: false });
  rows.forEach((row, r) => [...row.replace(/\s/g, '')].forEach((ch, c) => { if (ch === 'R') g.cells[idx(N, r, c)] = RED; else if (ch === 'B') g.cells[idx(N, r, c)] = BLUE; }));
  const nr = g.stoneCount(RED), nb = g.stoneCount(BLUE); g.turn = nr > nb ? BLUE : RED;
  for (let i = 0; i < N * N; i++) if (g.cells[i]) g.link(i);
  return g;
}
function blueWinsBFS(cells, N) {     // independent check (BFS left -> right)
  const seen = new Uint8Array(N * N), st = [];
  for (let r = 0; r < N; r++) if (cells[r * N] === BLUE) { seen[r * N] = 1; st.push(r * N); }
  while (st.length) {
    const x = st.pop(), r = (x / N) | 0, c = x % N; if (c === N - 1) return true;
    for (const [dr, dc] of [[0, -1], [-1, 0], [-1, 1], [0, 1], [1, 0], [1, -1]]) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
      const y = rr * N + cc; if (cells[y] === BLUE && !seen[y]) { seen[y] = 1; st.push(y); }
    }
  }
  return false;
}

/* ---- geometry ---- */
for (const N of [7, 11, 14]) {
  const G = H.geo(N), NN = N * N, T = NN, B = NN + 1, L = NN + 2, R = NN + 3;
  ok(G.nb[idx(N, 3, 3)].length === 6 && G.nb[idx(N, 3, 3)].every(x => x < NN), N + ': interior cell has 6 cell neighbours');
  const has = (i, e) => G.nb[i].includes(e);
  ok(has(0, T) && has(0, L) && !has(0, B) && !has(0, R), N + ': corner a1 touches top (red) and left (blue)');
  ok(has(N - 1, T) && has(N - 1, R), N + ': top-right corner touches top (red) and right (blue)');
  ok(has(NN - N, B) && has(NN - N, L), N + ': bottom-left corner touches bottom (red) and left (blue)');
  ok(has(NN - 1, B) && has(NN - 1, R), N + ': bottom-right corner touches bottom (red) and right (blue)');
  ok(G.enb.every(l => l.length === N), N + ': each edge borders exactly N cells');
  ok(G.nb[0].filter(x => x < NN).length === 2 && G.nb[N - 1].filter(x => x < NN).length === 3, N + ': acute corner has 2 cell neighbours, obtuse corner 3');
  let sym = true; for (let i = 0; i < NN; i++) for (const j of G.nb[i]) if (j < NN && !G.nb[j].includes(i)) sym = false;
  ok(sym, N + ': adjacency is symmetric');
}

/* ---- edge ownership & win detection ---- */
{
  const N = 7;
  const col = setup(N, ['R......', 'R......', 'R......', 'R......', 'R......', 'R......', 'R......']); ok(col.winner === RED, 'red column on the blue edge (incl. both shared corners) connects top-bottom: red wins');
  const row = setup(N, ['BBBBBBB', '.......', '.......', '.......', '.......', '.......', '.......']); ok(row.winner === BLUE, 'blue row along the red edge connects left-right: blue wins');
  const zig = setup(N, ['...R...', '..R....', '..R....', '.R.....', '.R.....', 'R......', 'R......']); ok(zig.winner === RED, 'diagonal-adjacent red chain (r+1,c-1 links) wins');
  const gap = setup(N, ['R......', 'R......', 'R......', '.......', 'R......', 'R......', 'R......']); ok(gap.winner === 0, 'one empty cell in the chain: no winner yet');
  const notAdj = setup(N, ['R......', '.R.....', '..R....', '...R...', '....R..', '.....R.', '......R']); ok(notAdj.winner === 0, '(r+1,c+1) is not adjacent: main-diagonal red line does not connect');
  const g = new H.Game({ size: N, swap: false }), seq = [];
  for (let r = 0; r < N; r++) { seq.push(idx(N, r, 3)); if (r < N - 1) seq.push(idx(N, r, 0)); }
  seq.forEach((m, i) => { ok(g.winner === 0, 'no winner before move ' + i); g.play(m); });
  ok(g.winner === RED && g.moves.length === 2 * N - 1, 'winner detected immediately on the connecting move');
  ok(!g.legal(idx(N, 6, 6)), 'no moves accepted after the game is won');
}
/* the anti-diagonal (r, N-1-r) cells ARE adjacent ((r+1,c-1)), so it connects both pairs of edges' corners; who wins depends on whose stones */
{
  const N = 5, g = setup(N, ['....R', '...R.', '..R..', '.R...', 'R....']);
  ok(g.winner === RED, 'anti-diagonal red chain from top-right corner to bottom-left corner connects top-bottom (corners are shared)');
  const b = setup(N, ['....B', '...B.', '..B..', '.B...', 'B....']);
  ok(b.winner === BLUE, 'the same chain in blue connects left-right via the shared corners');
}

/* ---- no draws: random full boards always have exactly one winner ---- */
for (const N of [5, 7, 11, 14]) {
  let bad = 0, red = 0; const NN = N * N;
  for (let t = 0; t < 2000; t++) {
    const cells = new Int8Array(NN + 4); cells[NN] = cells[NN + 1] = RED; cells[NN + 2] = cells[NN + 3] = BLUE;
    const order = [...Array(NN).keys()].sort(() => Math.random() - 0.5); order.forEach((x, i) => { cells[x] = i % 2 ? BLUE : RED; });
    const r = H.redWins(cells, N), b = blueWinsBFS(cells, N);
    if (r === b) bad++; if (r) red++;
  }
  ok(bad === 0, N + 'x' + N + ': every full board has exactly one winner');
  console.log(`no-draw check ${N}x${N}: 2000 random full boards, ${bad} without exactly one winner (red won ${red})`);
}

/* ---- swap (pie) rule ---- */
{
  const N = 11, g = new H.Game({ size: N });
  ok(!g.canSwap() && !g.legal(SWAP), 'swap not available before the first move');
  const m = idx(N, 1, 4); g.play(m);
  ok(g.canSwap() && g.legal(SWAP) && g.legalMoves().includes(SWAP), 'blue may swap after red\'s first move');
  const q = g.play(SWAP);
  ok(q === idx(N, 4, 1) && g.cells[q] === BLUE && g.cells[m] === 0, 'swap mirrors (r,c)=(1,4) to (4,1) and turns it blue');
  ok(g.turn === RED && g.moves.length === 2 && g.swapped, 'after the swap red moves again');
  ok(!g.canSwap(), 'swap only once, at move 2');
  g.play(idx(N, 5, 5)); ok(!g.legal(SWAP), 'no swap later');
  const d = new H.Game({ size: N }); d.play(idx(N, 3, 3)); d.play(SWAP); ok(d.cells[idx(N, 3, 3)] === BLUE, 'diagonal cell stays in place and changes colour');
  const off = new H.Game({ size: N, swap: false }); off.play(idx(N, 2, 2)); ok(!off.canSwap() && !off.legal(SWAP), 'swap rule switched off: no swap');
  // connectivity is rebuilt after a swap: red's edge stone becomes a blue left-edge stone
  const e = new H.Game({ size: 5 }); e.play(idx(5, 0, 2)); e.play(SWAP);
  ok(e.cells[idx(5, 2, 0)] === BLUE, 'red top-edge stone c1 becomes blue a3 on the left edge');
  [idx(5, 4, 4), idx(5, 2, 1), idx(5, 3, 4), idx(5, 2, 2), idx(5, 4, 3), idx(5, 2, 3)].forEach(x => e.play(x));
  ok(e.winner === 0, 'not connected yet'); e.play(idx(5, 4, 0)); e.play(idx(5, 2, 4));
  ok(e.winner === BLUE, 'blue wins with the swapped stone as part of the chain');
  // undo = replay without the last move
  const u = H.Game.replay(e.opts(), e.moves.slice(0, -1));
  ok(u.winner === 0 && u.turn === BLUE && u.cells[idx(5, 2, 4)] === 0 && u.cells[idx(5, 2, 0)] === BLUE, 'undo by replay restores the position before the winning move');
  const u2 = H.Game.replay(e.opts(), e.moves.slice(0, 1)); ok(u2.cells[idx(5, 0, 2)] === RED && u2.canSwap(), 'undoing the swap restores red\'s first stone');
}

/* ---- notation & records ---- */
{
  ok(H.coord(11, 0) === 'a1' && H.coord(11, idx(11, 10, 10)) === 'k11' && H.coord(11, SWAP) === 'swap', 'coordinates a1 / k11 / swap');
  ok(H.parseMove(11, 'f6') === idx(11, 5, 5) && H.parseMove(11, 'z9') === null && H.parseMove(11, 'swap') === SWAP, 'parse moves');
  const g = new H.Game({ size: 9 }); [idx(9, 4, 4), SWAP, idx(9, 2, 6), idx(9, 6, 2)].forEach(m => g.play(m));
  const rec = H.toRecord(g), back = H.fromRecord(rec);
  ok(rec === '9: e5 swap g3 c7' && back.N === 9 && back.moves.join() === g.moves.join(), 'record round-trip: ' + rec);
  let threw = false; try { H.fromRecord('9: e5 e5'); } catch (e) { threw = true; } ok(threw, 'illegal record rejected');
}

/* ---- winning path & distance ---- */
{
  const N = 7, g = setup(N, ['..R....', '..RB...', '.RBB...', '.R.BB..', 'RR..B..', 'R...BB.', 'R....B.']);
  ok(g.winner === RED, 'position won by red');
  const p = H.winPath(g), G = g.G;
  ok(p.length >= N && p.every(x => g.cells[x] === RED) && G.nb[p[0]].includes(N * N) && G.nb[p[p.length - 1]].includes(N * N + 1) && p.every((x, i) => i === 0 || G.nb[x].includes(p[i - 1])), 'win path is a chain of red stones from top to bottom (' + p.map(x => H.coord(N, x)).join(' ') + ')');
  ok(p.length === 7, 'shortest path skips the extra stone (7 cells)');
  const e = new H.Game({ size: 11 });
  ok(H.needCells(e.cells, e.G, RED) === 11 && H.needCells(e.cells, e.G, BLUE) === 11, 'empty 11x11: both sides need 11 cells');
  const h = setup(7, ['...R...', '...R...', '...R...', '.......', '.......', '.......', '.......']);
  ok(H.needCells(h.cells, h.G, RED) === 4 && H.needCells(h.cells, h.G, BLUE) === 7, 'three red stones in a column: red needs 4, blue still needs 7 (must pass below them)');
}

/* ---- immediate wins / bridges ---- */
{
  const g = setup(7, ['R......', 'R......', 'R......', '.......', 'R......', 'R......', 'R......']);
  const w = H.winningCells(g.cells, g.G, RED); ok(w.length === 1 && w[0] === idx(7, 3, 0), 'winningCells finds the single gap cell a4 (b4 does not touch a3)');
  const b = setup(7, ['.......', '..R....', '.......', '.R.....', '.......', '.......', '.......']);
  ok(H.newBridges(b.cells, b.G, idx(7, 3, 1)).includes(idx(7, 1, 2)), 'newBridges: b4 and c2 form a bridge (carriers b3, c3)');
  b.cells[idx(7, 2, 1)] = BLUE; ok(H.newBridges(b.cells, b.G, idx(7, 3, 1)).length === 0, 'an intruded carrier is no longer reported as a bridge');
}

/* ---- playout policy: answering bridge intrusions ---- */
{
  const N = 7, g = setup(N, ['.......', '.......', '...R...', '.......', '..R....', '.......', '.......']);   // bridge d3-c5 via c4/d4
  const c1 = idx(N, 3, 2), c2 = idx(N, 3, 3), work = new Int8Array(N * N + 4), list = new Int32Array(N * N);
  let both = [0, 0];
  for (const br of [0, 1]) for (let t = 0; t < 3000; t++) {
    work.set(g.cells); let n = 0; for (let i = 0; i < N * N; i++) if (!work[i]) list[n++] = i;
    H.playout(g.G, work, BLUE, list, n, br);
    if (work[c1] === BLUE && work[c2] === BLUE) both[br]++;
  }
  ok(both[1] < 150 && both[0] > 450, `bridge response: both carriers lost ${both[0]}/3000 with random fill, ${both[1]}/3000 with the policy (only when one move intrudes two bridges)`);
  console.log(`bridge-saving playouts: carriers both taken by blue in ${both[0]}/3000 pure-random vs ${both[1]}/3000 policy playouts`);
}

/* ---- edge templates proved by brute force: defender moves first inside the carrier, attacker still connects ---- */
function templateHolds(N, p, stone, edge, carrier) {
  const G = H.geo(N), cells = new Int8Array(N * N + 4); cells[N * N] = cells[N * N + 1] = RED; cells[N * N + 2] = cells[N * N + 3] = BLUE; cells[stone] = p;
  const conn = () => { const seen = new Set([stone]), st = [stone]; while (st.length) { const x = st.pop(); for (const y of G.nb[x]) { if (y === edge) return true; if (y < N * N && cells[y] === p && !seen.has(y)) { seen.add(y); st.push(y); } } } return false; };
  const solve = att => {
    if (conn()) return true;
    const free = carrier.filter(c => !cells[c]); if (!free.length) return false;
    if (att) { for (const c of free) { cells[c] = p; const r = solve(false); cells[c] = 0; if (r) return true; } return false; }
    for (const c of free) { cells[c] = 3 - p; const r = solve(true); cells[c] = 0; if (!r) return false; } return true;
  };
  return solve(false);
}
{
  const N = 11, G = H.geo(N);
  let zigOK = 0, zigN = 0, minimal = 0;
  G.zig.forEach(z => {
    const p = z.e - N * N < 2 ? RED : BLUE; zigN++;
    if (templateHolds(N, p, z.s, z.e, z.car)) zigOK++;
    if (z.car.every((_, k) => !templateHolds(N, p, z.s, z.e, z.car.filter((__, j) => j !== k)))) minimal++;
  });
  ok(zigN > 0 && zigOK === zigN, `ziggurat (template IIIa) holds in all ${zigN} placements/orientations on 4 edges (${zigOK})`);
  ok(minimal === zigN, `every ziggurat carrier cell is necessary (${minimal}/${zigN})`);
  console.log(`edge template IIIa: ${zigOK}/${zigN} placements proved by exhaustive search, ${minimal} minimal`);
  const t2 = templateHolds(N, RED, idx(N, 1, 5), N * N, [idx(N, 0, 5), idx(N, 0, 6)]), t2b = templateHolds(N, BLUE, idx(N, 5, N - 2), N * N + 3, [idx(N, 5, N - 1), idx(N, 4, N - 1)]);
  ok(t2 && t2b, 'template II (second-row stone, two empty edge cells) holds for red top and blue right');
  ok(!templateHolds(N, RED, idx(N, 2, 5), N * N, [idx(N, 1, 5), idx(N, 1, 6), idx(N, 0, 5), idx(N, 0, 6), idx(N, 0, 7)]), 'a third-row stone with only a 5-cell carrier is NOT connected');
}

/* ---- virtual connections ---- */
{
  const N = 7;
  const g = setup(N, ['.......', '...R...', '.......', '..R....', '.......', '.R.....', '.......']);   // d2 - c4 - b6 chain of bridges + template II both ends
  const vc = H.findVC(g.cells, g.G, RED);
  ok(vc && !vc.won && vc.links.length === 4, 'bridge chain with template II at both edges is a virtual win for red (' + (vc ? vc.links.length : 0) + ' links)');
  const car = new Set(); let disjoint = true; vc.links.forEach(l => l.car.forEach(c => { if (car.has(c)) disjoint = false; car.add(c); }));
  ok(disjoint, 'chain carriers are pairwise disjoint');
  // the VC is sound: blue moves first anywhere in the carrier, red answers, red still has a VC; brute check one intrusion per cell
  let sound = true;
  vc.carrier.forEach(c => {
    const h = setup(N, ['.......', '...R...', '.......', '..R....', '.......', '.R.....', '.......']); h.cells[c] = BLUE; h.link(c); h.turn = RED;
    const ans = H.think(h, 3, { noBook: true, noErr: true }); h.cells[ans.move] = RED; h.link(ans.move);
    if (!H.findVC(h.cells, h.G, RED) && h.winner !== RED) sound = false;
  });
  ok(sound, 'after any intrusion into the carrier, 女王 restores the virtual connection');
  const h = setup(N, ['.......', '...R...', '..B....', '..R....', '.......', '.R.....', '.......']);
  // c3 intrudes the d2-c4 bridge (carriers c3? d3?) -> if it was a carrier, the chain needs the other cell
  h.turn = RED; const t = H.think(h, 3, { noBook: true, noErr: true });
  ok(t.move === idx(N, 2, 3), 'red answers the intrusion at c3 by taking the other carrier d3 (' + H.coord(N, t.move) + ')');
  const z = setup(11, ['...........', '...........', '.....R.....', '...........', '....R......', '...........', '...R.......', '...........', '..R........', '...........', '...........']);
  const vz = H.findVC(z.cells, z.G, RED); ok(vz && vz.links.some(l => l.car.length === 8), 'ziggurat links used by the VC search');
}

/* ---- AI: win in one, forced block, must-play, resignation ---- */
{
  const N = 7;
  for (const lv of [1, 2, 3, 4]) {
    const g = setup(N, ['R......', 'R......', 'R....B.', '....B..', 'R..B...', 'R......', 'R.B....']); g.turn = RED;
    const r = H.think(g, lv, { noBook: true }); ok(r.move === idx(N, 3, 0) || r.move === idx(N, 3, 1), `level ${lv}: plays the winning move (${H.coord(N, r.move)})`);
    const b = setup(N, ['R......', 'R......', 'R......', '.......', 'R......', 'R......', 'RBBB...']); b.cells[idx(N, 3, 1)] = BLUE; b.link(idx(N, 3, 1)); b.turn = BLUE;
    // red threatens a4 only (b4 is blue): blue must block a4
    const bb = H.think(b, lv, { noBook: true }); ok(bb.move === idx(N, 3, 0), `level ${lv}: blocks the single winning threat (${H.coord(N, bb.move)})`);
  }
  const lost = setup(N, ['.......', '...R...', '.......', '..R....', '.......', '.R.....', '...B...']); lost.turn = BLUE;
  const r = H.think(lost, 3, { noBook: true });
  ok(r.resign === true, 'blue detects that red has a virtual win (resign flag)');
  const vc = H.findVC(lost.cells, lost.G, RED);
  ok(vc.carrier.includes(r.move), '女王 must-plays inside the opponent\'s carrier (' + H.coord(N, r.move) + ')');
  const fine = new H.Game({ size: 11, swap: false }); fine.play(60); ok(H.think(fine, 2, { sims: 300, noBook: true }).resign === false, 'no resignation in an open position');
}

/* ---- opening book / swap decisions ---- */
{
  const g = new H.Game({ size: 11 }); g.play(idx(11, 5, 5)); ok(H.book(g) === SWAP, 'AI swaps a central first move');
  const e = new H.Game({ size: 11 }); e.play(idx(11, 2, 0)); ok(H.book(e) === null, 'AI does not swap the a3 edge opening');
  const f = new H.Game({ size: 11 }); const fm = H.book(f), fr = (fm / 11) | 0, fc = fm % 11;
  ok(Math.min(fr, fc, 10 - fr, 10 - fc) === 0, 'with swap on, the AI opens on the edge (' + H.coord(11, fm) + ')');
  ok(H.book(new H.Game({ size: 11, swap: false })) === idx(11, 5, 5), 'with swap off, the AI opens in the centre');
}

/* ---- move counts (the "perft" of Hex) ---- */
for (const N of [7, 11, 13, 14]) {
  const g = new H.Game({ size: N });
  let p1 = 0, p2 = 0, p2off = 0;
  for (const m of g.legalMoves()) { p1++; const h = H.Game.replay(g.opts(), [m]); p2 += h.legalMoves().length; p2off += h.legalMoves().filter(x => x !== SWAP).length; }
  ok(p1 === N * N && p2 === N * N * N * N && p2off === N * N * (N * N - 1), N + 'x' + N + ' move counts');
  console.log(`move counts ${N}x${N}: ply1 ${p1}, ply2 with swap ${p2} (= N^4), without swap ${p2off} (= N^2(N^2-1))`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
