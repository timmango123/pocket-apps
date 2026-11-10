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

/* ---- difficulty settings: 工蜂 sits between 蜜蜂 and 守衛 (retuned 2026-11 after the release review) ---- */
{
  const L = H.LEVELS;
  ok(L[1].sims < L[2].sims && L[0].sims < L[1].sims && !L[1].bridge && L[1].err > L[2].err && L[2].err > L[3].err, 'level strength increases step by step (sims, bridge playouts, error rate)');
}

/* ---- browser checks (real CDP touch) for the release-review findings ---- */
async function browserTests() {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('playwright missing: browser checks skipped'); return; }
  const html = fs.readFileSync(file, 'utf8'), ORIGIN = 'https://hex.test/';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40); } return false; };
  const browser = await chromium.launch();
  async function open(w, h, store) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => r.request().url() === ORIGIN ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
    if (store) await ctx.addInitScript(st => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); Object.keys(st).forEach(k => localStorage.setItem(k, JSON.stringify(st[k]))); } }, store);
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push('pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const cdp = await ctx.newCDPSession(page);
    await page.goto(ORIGIN); await page.waitForFunction(() => window.__hex);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    let id = 1;
    const tap = async (x, y) => { const i = id++; await T('touchStart', [{ x, y, id: i }]); await sleep(30); await T('touchEnd', []); await sleep(40); };
    const tapEl = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded().catch(() => {}); const b = await l.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
    const st = () => page.evaluate(() => window.__hex.state());
    const pt = i => page.evaluate(i => window.__hex.cellClient(i), i);
    const ls = k => page.evaluate(k => JSON.parse(localStorage.getItem('hex.' + k) || 'null'), k);
    return { ctx, page, errors, T, tap, tapEl, st, pt, ls };
  }
  const startFromMenu = async (o, seg) => {
    if (!(await o.page.isVisible('#menu'))) { await o.tapEl('#bMenu'); await until(() => o.page.isVisible('#menu')); }
    for (const [k, v] of Object.entries(seg)) await o.tapEl(`#${k} [data-v="${v}"]`);
    await o.tapEl('#bStart');
  };
  const settings = (o) => Object.assign({ mode: 'pvp', level: 0, color: 'red', size: 11, swap: false, confirm: false, resign: true, dist: true, coord: false, sound: true, theme: 'auto' }, o);
  try {
    // fresh start: default level is 蜜蜂, texts talk about coloured edges, not up/down
    {
      const o = await open(390, 844);
      const r = await o.page.evaluate(() => ({ lv: document.querySelector('#sgLevel .on').dataset.v, sub: document.querySelector('#menu .sub').textContent }));
      ok(r.lv === '0' && !/上下|左右/.test(r.sub), 'first visit: 蜜蜂 preselected, menu text names the coloured edges (' + r.sub + ')');
      ok(/工蜂/.test(await o.page.textContent('#dailyTxt')), 'daily opening is always against 工蜂');
      await o.tapEl('#sgLevel [data-v="3"]'); await o.tapEl('#bDaily');
      ok(await until(async () => (await o.st()).phase === 'play'), 'daily started');
      ok((await o.st()).level === 1, 'daily level stays 工蜂 when 女王 is selected');
      await o.ctx.close();
    }
    // reload while the computer thinks, never touch the page: no "Blocked call to navigator.vibrate"
    {
      const N = 11, moves = [5 * N + 5, 3 * N + 3, 2 * N + 7];
      const o = await open(390, 844, { 'hex.settings': settings({ mode: 'ai', level: 1 }), 'hex.game': { o: { size: N, swap: false }, moves, mode: 'ai', ai: 2, level: 1, daily: null, minMoves: 0 } });
      ok(await until(async () => (await o.st()).moves.length === moves.length + 1), 'resumed game: the computer moves after a reload without any tap');
      await sleep(300);
      ok(!o.errors.length, 'no console errors when the computer moves before the first tap (' + o.errors.join(' | ') + ')');
      await o.ctx.close();
    }
    // two overlapping finger taps are two taps; a real pinch zooms and places nothing
    {
      const o = await open(390, 844, { 'hex.settings': settings({}) });
      await startFromMenu(o, {}); await until(async () => (await o.st()).phase === 'play');
      let placed = 0;
      for (let k = 0; k < 4; k++) {
        const m1 = 12 + k * 2, m2 = 100 - k * 3, p1 = await o.pt(m1), p2 = await o.pt(m2), n0 = (await o.st()).moves.length;
        await o.T('touchStart', [{ x: p1[0], y: p1[1], id: 101 }]); await sleep(40);
        await o.T('touchStart', [{ x: p1[0], y: p1[1], id: 101 }, { x: p2[0], y: p2[1], id: 102 }]); await sleep(40);
        await o.T('touchEnd', [{ x: p2[0], y: p2[1], id: 102 }]); await sleep(40);
        await o.T('touchEnd', []); await sleep(60);
        const s = await o.st(); placed += s.moves.length - n0;
        ok(s.moves.slice(n0).sort((x, y) => x - y).join() === [m1, m2].sort((x, y) => x - y).join(), 'overlapping taps (A down, B down, one up, other up) place both stones (' + s.moves.slice(n0) + ')');
      }
      ok(placed === 8, 'overlapped two-finger taps: 8 sent, ' + placed + ' placed');
      const c = [195, 400], n0 = (await o.st()).moves.length;
      await o.T('touchStart', [{ x: c[0] - 30, y: c[1], id: 201 }, { x: c[0] + 30, y: c[1], id: 202 }]);
      for (let i = 1; i <= 6; i++) { await o.T('touchMove', [{ x: c[0] - 30 - i * 12, y: c[1], id: 201 }, { x: c[0] + 30 + i * 12, y: c[1], id: 202 }]); await sleep(20); }
      await o.T('touchEnd', []); await sleep(60);
      const z = await o.page.evaluate(() => document.getElementById('zoomR').hidden ? 1 : parseFloat(document.getElementById('zoomR').textContent));
      ok(z > 1.5 && (await o.st()).moves.length === n0, 'spreading two fingers zooms (' + z + '×) and places no stone');
      await o.ctx.close();
    }
    // small cells: the first touch zooms in around the finger, a forgiving second tap confirms, the view zooms back out
    {
      const o = await open(375, 500, { 'hex.settings': settings({ confirm: true }) });
      await startFromMenu(o, {}); await until(async () => (await o.st()).phase === 'play');
      const a = await o.pt(60), b = await o.pt(61), pitch0 = Math.hypot(a[0] - b[0], a[1] - b[1]);
      await o.tap(a[0], a[1]);
      const s1 = await o.st(), a2 = await o.pt(60), b2 = await o.pt(61), pitch1 = Math.hypot(a2[0] - b2[0], a2[1] - b2[1]);
      ok(pitch0 < 22 && pitch1 >= 30 && s1.preview === 60 && Math.hypot(a2[0] - a[0], a2[1] - a[1]) < 2, `small cells (${pitch0.toFixed(1)} px) zoom to ${pitch1.toFixed(1)} px on the first tap, cell stays under the finger`);
      // second tap 0.55 pitch towards the neighbour (just past the cell edge): still confirms the preview
      await o.tap(a2[0] + (b2[0] - a2[0]) * 0.55, a2[1] + (b2[1] - a2[1]) * 0.55);
      const s2 = await o.st(), a3 = await o.pt(60), b3 = await o.pt(61);
      ok(s2.moves.join() === '60', 'a confirming tap slightly outside the previewed cell places it (' + s2.moves + ')');
      ok(Math.abs(Math.hypot(a3[0] - b3[0], a3[1] - b3[1]) - pitch0) < 0.5, 'view zooms back out after the stone is placed');
      // a tap clearly on another empty cell moves the preview instead
      const c1 = await o.pt(30); await o.tap(c1[0], c1[1]); const c2 = await o.pt(32); await o.tap(c2[0], c2[1]);
      ok((await o.st()).preview === 32 && (await o.st()).moves.length === 1, 'a tap clearly on another empty cell moves the preview');
      await o.ctx.close();
    }
    // undo / hint counts survive a reload; wins with undo unlock nothing; clean wins unlock and suggest the next level
    {
      const N = 7, mv = []; for (let r = 0; r < 6; r++) { mv.push(r * N); mv.push(r * N + 6); }
      const game = extra => Object.assign({ o: { size: N, swap: false }, moves: mv, mode: 'ai', ai: 2, level: 0, daily: null, minMoves: 0 }, extra);
      const o = await open(390, 844, { 'hex.settings': settings({ mode: 'ai' }), 'hex.game': game({ undos: 1, hints: 2 }) });
      await until(async () => (await o.st()).phase === 'play');
      const w = await o.pt(6 * N); await o.tap(w[0], w[1]);
      ok(await until(() => o.page.isVisible('#result'), 15000), 'winning move shows the result');
      const sub = await o.page.textContent('#rSub'), stats = await o.ls('stats');
      ok(/悔棋 1 次/.test(sub) && /提示 2 次/.test(sub), 'result shows undo and hint counts restored from the saved game (' + sub + ')');
      ok(stats && Object.keys(stats.ach).length === 0 && stats.lv[0].w === 1, 'a win with undo counts as a win but unlocks no achievement');
      // the finished game is still there after a reload
      const rec = await o.page.evaluate(() => window.__hex.state().moves.length);
      await o.page.reload(); await o.page.waitForFunction(() => window.__hex);
      const s = await o.st();
      ok(s.phase === 'over' && s.moves.length === rec && s.winner === 1, 'after a reload the finished game is restored (phase ' + s.phase + ', ' + s.moves.length + ' moves)');
      await o.tapEl('#bRec'); ok(/^7: a1 g1/.test(await o.page.inputValue('#recText')), 'record of the last game is available after the reload');
      await o.ctx.close();
      const o2 = await open(390, 844, { 'hex.settings': settings({ mode: 'ai' }), 'hex.game': game({}) });
      await until(async () => (await o2.st()).phase === 'play');
      const w2 = await o2.pt(6 * N); await o2.tap(w2[0], w2[1]);
      await until(() => o2.page.isVisible('#result'), 15000);
      ok((await o2.ls('stats')).ach.first > 0 && await o2.page.isVisible('#rSug') && /工蜂/.test(await o2.page.textContent('#rNext')), 'clean win unlocks 初次連通 and offers the next level');
      const geo = await o2.page.evaluate(() => { const t = document.getElementById('rTitle'), r = document.createRange(); r.selectNodeContents(t); const a = r.getBoundingClientRect(), c = t.closest('.card').getBoundingClientRect(); return [a.left + a.width / 2, c.left + c.width / 2]; });
      ok(Math.abs(geo[0] - geo[1]) < 4, 'result title is centred on the card (' + geo.map(Math.round) + ')');
      await o2.tapEl('#rNext'); await until(async () => (await o2.st()).phase === 'play');
      ok((await o2.st()).level === 1, 'next-level button starts a game against 工蜂');
      await o2.ctx.close();
    }
    // leaving a game half-way asks first and counts as a loss; two losses in a row suggest an easier level
    {
      const st0 = { sz: {}, lv: [0, 1, 2, 3, 4].map(() => ({ p: 0, w: 0 })), pvp: 0, ach: {}, daily: {}, streak: { cur: [0, 0, 0, 0, 0], best: [0, 0, 0, 0, 0], loss: [0, 1, 0, 0, 0] } };
      const o = await open(390, 844, { 'hex.settings': settings({ mode: 'ai', level: 1, color: 'blue', size: 7 }), 'hex.stats': st0 });
      await o.tapEl('#bStart');
      ok(await until(async () => { const s = await o.st(); return s.phase === 'play' && s.turn === 2 && s.moves.length >= 1; }), 'computer opened as red');
      await o.page.waitForFunction(() => !document.getElementById('bSwap').disabled || true);
      const free = []; const s = await o.st(); for (let i = 0; i < 49; i++) if (!s.moves.includes(i)) free.push(i);
      const p = await o.pt(free[20]); await o.tap(p[0], p[1]);
      await until(async () => (await o.st()).moves.length >= 2);
      await o.tapEl('#bMenu'); await o.tapEl('#bStart');
      ok(await o.page.isVisible('#confirm') && /落敗/.test(await o.page.textContent('#cfText')), 'starting a new game mid-game asks first');
      await o.tapEl('#cfNo'); ok((await o.st()).phase === 'play' && (await o.ls('game')) !== null, 'cancel keeps the game');
      await o.tapEl('#bStart'); await o.tapEl('#cfYes');
      await until(async () => (await o.st()).moves.length <= 1);
      const sts = await o.ls('stats');
      ok(sts.lv[1].p === 1 && sts.lv[1].w === 0 && sts.streak.loss[1] === 2, 'the abandoned game is recorded as a loss (' + JSON.stringify(sts.lv[1]) + ')');
      await until(async () => { const q = await o.st(); return q.turn === 2 && !q.thinking; });
      await o.tapEl('#bResign'); await o.tapEl('#cfYes');
      await until(() => o.page.isVisible('#result'), 8000);
      ok(await o.page.isVisible('#rSug') && /蜜蜂/.test(await o.page.textContent('#rNext')), 'after repeated losses the result suggests 蜜蜂');
      await o.ctx.close();
    }
    // toasts sit at the top of the board, not over its centre
    {
      const o = await open(360, 640, { 'hex.settings': settings({}) });
      await startFromMenu(o, {}); await sleep(100);
      const r = await o.page.evaluate(() => { const t = document.getElementById('toast').getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return [t.bottom, m.top + m.height / 2]; });
      ok(r[0] < r[1] - 100, 'toast stays near the top edge of the board (' + r.map(Math.round) + ')');
      ok(!o.errors.length, 'no console errors (' + o.errors.join(' | ') + ')');
      await o.ctx.close();
    }
  } finally { await browser.close(); }
}

(async () => {
  if (!process.argv.includes('--no-browser')) await browserTests();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})();
