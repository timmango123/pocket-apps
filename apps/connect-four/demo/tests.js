// Rule + engine tests for 四子連線. Loads the game's own core (between CORE-START/CORE-END in index.html).
// Usage: node tests.js [--quick]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C4 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';C4.loadBook(C4_BOOK);return C4;')();
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const seq = s => s.split('').map(x => +x - 1);
function playStr(W, H, pop, s) { const g = C4.newGame(W, H, pop); for (const m of C4.fromNotation(s)) if (!C4.play(g, m)) throw new Error('illegal ' + s); return g; }
let seed = 2024; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;

// ---- basic rules ----
{ const g = playStr(7, 6, false, '4'); ok(g.grid[3 * 6 + 0] === 1 && g.hts[3] === 1 && g.turn === 2, 'drop lands on lowest empty cell'); }
{ const g = playStr(7, 6, false, '444444'); ok(!C4.canDrop(g, 3) && C4.play(g, 3) === null, 'full column rejects a drop'); }
{ const g = playStr(7, 6, false, '1213141'); ok(g.over && g.winner === 1 && g.lines.length === 1 && g.lines[0].length === 4, 'vertical four'); }
{ const g = playStr(7, 6, false, '1122334'); ok(g.over && g.winner === 1 && g.lines[0].every(([c, r]) => r === 0), 'horizontal four'); }
{ const g = playStr(7, 6, false, '12233434474'); ok(g.over && g.winner === 1, 'diagonal / four'); const L = g.lines[0]; ok(L.length === 4 && L[0][0] === 0 && L[0][1] === 0 && L[3][0] === 3 && L[3][1] === 3, 'diagonal / cells marked'); }
{ const g = playStr(7, 6, false, '76655454414'); ok(g.over && g.winner === 1, 'diagonal \\ four'); }
{ const g = playStr(7, 6, false, '1122335'); ok(!g.over, 'three in a row with gap is not a win'); C4.play(g, { t: 'd', c: 3 }); ok(!g.over, 'opponent filling the gap does not win for first player'); }
// a single drop completing two lines marks both (horizontal + vertical)
{
  let found = null;
  for (let t = 0; t < 50000 && !found; t++) { const g = C4.newGame(7, 6, false); while (!g.over) { const L = C4.legalMoves(g); C4.play(g, L[Math.floor(rnd() * L.length)]); } if (g.lines.length >= 2) found = g; }
  ok(found && found.lines.length >= 2 && found.lines.every(l => l.some(([c, r]) => c === found.moves[found.moves.length - 1].c && r === found.hts[c] - 1)), 'one move creating two fours marks every line through it');
  if (found) console.log('  double-line game:', C4.toNotation(found.moves), 'lines', found.lines.length);
}
// five in a row is one maximal line containing all five
{ const g = playStr(7, 6, false, '11225544'); C4.play(g, { t: 'd', c: 2 }); ok(g.over && g.lines.length === 1 && g.lines[0].length === 5, 'filling the middle of 2+2 marks a five-long line'); }
// draw on a full board: find one by random play
{
  let drawGame = null;
  for (let t = 0; t < 20000 && !drawGame; t++) {
    const g = C4.newGame(7, 6, false);
    while (!g.over) { const L = C4.legalMoves(g); C4.play(g, L[Math.floor(rnd() * L.length)]); }
    if (g.winner === 0) drawGame = g;
  }
  ok(drawGame && drawGame.moves.length === 42 && C4.fullBoard(drawGame) && drawGame.winner === 0, 'full board without a four is a draw');
  if (drawGame) console.log('  sample draw game:', C4.toNotation(drawGame.moves));
}
// variants: 5x4 and 8x7
{ const g = playStr(5, 4, false, '1122334'); ok(g.over && g.winner === 1, '5x4 horizontal four'); }
{ const g = playStr(5, 4, false, '12233434414'); ok(g.over && g.winner === 1, '5x4 diagonal four'); }
{ const g = playStr(8, 7, false, '5566778'); ok(g.over && g.winner === 1, '8x7 four touching right edge'); }
{ const g = playStr(8, 7, false, '8888888'); ok(g.hts[7] === 7 && !C4.canDrop(g, 7), '8x7 column holds 7'); }
// notation round trip
{ const m = C4.fromNotation('44p3p21'); ok(m.length === 5 && m[1].t === 'd' && m[2].t === 'p' && m[2].c === 2 && C4.toNotation(m) === '44p3p21', 'notation round trip with pops'); }

// ---- Pop Out ----
{
  const g = playStr(7, 6, true, '12');
  ok(C4.canPop(g, 0) && !C4.canPop(g, 1), 'pop only own bottom piece');
  ok(C4.legalMoves(g).filter(m => m.t === 'p').length === 1, 'legal pops listed');
  const g2 = playStr(7, 6, true, '1121'); // col1: R,Y,R from bottom ... red to move
  C4.play(g2, { t: 'p', c: 0 });
  ok(g2.grid[0] === 2 && g2.grid[1] === 2 && g2.grid[2] === 0 && g2.hts[0] === 2, 'pop shifts the column down');
  ok(C4.play(playStr(7, 6, true, '12'), { t: 'p', c: 1 }) === null, 'cannot pop opponent piece');
}
{ // popping that completes only the popper's four
  // red: a1? build: column 4 bottom = red, above it yellow; red has 3 on row 1 (cols 1..3) so popping col4 brings yellow down... construct explicitly
  const g = C4.newGame(7, 6, true);
  const set = (c, arr) => { arr.forEach((p, r) => { g.grid[c * 6 + r] = p; }); g.hts[c] = arr.length; };
  set(0, [2, 1]); set(1, [1, 1]); set(2, [2, 1]); set(3, [1, 2, 1]); g.turn = 1;
  // red pops col 4 bottom: column becomes [2,1] -> row1 has red 1,1,1,1 across cols 0..3 => red wins
  C4.play(g, { t: 'p', c: 3 });
  ok(g.over && g.winner === 1, 'pop that makes own four wins');
}
{ // pop that creates fours for BOTH players: popper wins
  const g = C4.newGame(7, 6, true);
  const set = (c, arr) => { arr.forEach((p, r) => { g.grid[c * 6 + r] = p; }); g.hts[c] = arr.length; };
  // after popping col 4 (index 3): col3 = [2,1]; row0: cols0-3 = 2,2,2,2 (yellow four), row1: cols0-3 = 1,1,1,1 (red four)
  set(0, [2, 1]); set(1, [2, 1]); set(2, [2, 1]); set(3, [1, 2, 1]); set(5, [2]); g.turn = 1;
  C4.play(g, { t: 'p', c: 3 });
  ok(g.over && g.winner === 1 && C4.allLines(g, 2).length === 1 && C4.allLines(g, 1).length === 1, 'pop creating fours for both players: popper wins');
}
{ // pop that creates only the opponent's four: opponent wins
  const g = C4.newGame(7, 6, true);
  const set = (c, arr) => { arr.forEach((p, r) => { g.grid[c * 6 + r] = p; }); g.hts[c] = arr.length; };
  set(0, [2]); set(1, [2]); set(2, [2]); set(3, [1, 2]); g.turn = 1;
  C4.play(g, { t: 'p', c: 3 });
  ok(g.over && g.winner === 2, 'pop that only completes the opponent four loses');
}
{ // threefold repetition draw in Pop Out
  const g = playStr(7, 6, true, '12');
  const cyc = [{ t: 'p', c: 0 }, { t: 'p', c: 1 }, { t: 'd', c: 0 }, { t: 'd', c: 1 }];
  let n = 0; while (!g.over && n < 40) { C4.play(g, cyc[n % 4]); n++; }
  ok(g.over && g.winner === 0 && g.drawReason === 'rep', 'Pop Out threefold repetition is a draw (after ' + n + ' moves)');
}
{ // full board in Pop Out is not automatically a draw
  let g = null;
  for (let t = 0; t < 20000; t++) { const h = C4.newGame(7, 6, false); while (!h.over) { const L = C4.legalMoves(h); C4.play(h, L[Math.floor(rnd() * L.length)]); } if (h.winner === 0) { g = C4.replay(7, 6, true, h.moves); break; } }
  ok(g && !g.over && C4.legalMoves(g).every(m => m.t === 'p'), 'Pop Out: full board continues with pops only');
}

// ---- bitboard engine agrees with the rules model ----
for (const [W, H] of [[7, 6], [5, 4], [8, 7]]) {
  const E = C4.Engine(W, H, 12); let bad = 0, checks = 0;
  for (let t = 0; t < 300; t++) {
    const g = C4.newGame(W, H, false); E.reset();
    while (!g.over) {
      for (let c = 0; c < W; c++) {
        ok(E.canPlay(c) === C4.canDrop(g, c), 'canPlay ' + W + 'x' + H);
        if (E.canPlay(c)) { const h = C4.replay(W, H, false, g.moves); C4.play(h, c); checks++; if (E.isWinningMove(c) !== (h.over && h.winner === g.turn)) bad++; }
      }
      const L = C4.legalMoves(g), m = L[Math.floor(rnd() * L.length)];
      C4.play(g, m); if (!g.over) E.playCol(m.c);
    }
  }
  ok(bad === 0, `bitboard winning-move detection matches rules on ${W}x${H} (${checks} checks, ${bad} mismatches)`);
}

// ---- move-generation counts (unique positions after n plies) ----
{
  const E = C4.Engine(7, 6, 10);
  const known = [1, 7, 49, 238, 1120, 4263, 16422, 54859, 184275];
  let level = new Map([['', []]]), counts = [1], perft = [1];
  // perft: move sequences (games end on a four)
  function perftN(d) { if (d === 0) return 1; let n = 0; for (let c = 0; c < 7; c++) if (E.canPlay(c)) { if (E.isWinningMove(c)) { n += d === 1 ? 1 : 0; continue; } const s = E.save(); E.playCol(c); n += perftN(d - 1); E.load(s); } return n; }
  const maxP = QUICK ? 6 : 8;
  for (let n = 1; n <= maxP; n++) {
    const next = new Map();
    for (const [, s] of level) { E.reset(); E.playSeq(s); for (let c = 0; c < 7; c++) { if (!E.canPlay(c)) continue; const win = E.isWinningMove(c); const ns = s.concat([c]); E.reset(); E.playSeq(s); const st = E.save(); if (win) { next.set('W' + ns.join(''), null); continue; } E.playCol(c); const k = E.mirrorKey(); const raw = JSON.stringify(E.save().slice(0, 4)); next.set(raw, ns); E.load(st); } }
    // count distinct positions (terminal ones are distinct boards too; dedupe them by board)
    const uniq = new Set();
    for (const [k, s] of next) { if (s) uniq.add(k); else { const sq = k.slice(1).split('').map(Number); const g = C4.replay(7, 6, false, sq.map(c => ({ t: 'd', c }))); uniq.add('T' + g.grid.join('')); } }
    counts.push(uniq.size);
    level = new Map([...next].filter(([, s]) => s));
    E.reset(); perft.push(perftN(n));
  }
  console.log('  distinct positions after n plies:', counts.join(', '));
  console.log('  published (OEIS A212693):        ', known.slice(0, maxP + 1).join(', '));
  console.log('  perft (move sequences, games stop at a four):', perft.join(', '));
  ok(counts.every((v, i) => v === known[i]), 'distinct-position counts match OEIS A212693');
  ok(perft.slice(0, 7).every((v, i) => v === Math.pow(7, i)), 'perft = 7^n before any four is possible');
}

// ---- exact solver vs an independent naive solver ----
function naive(W, H, cols) {
  const g = new Int8Array(W * H), h = new Int8Array(W); let n = 0;
  const at = (c, r) => (c < 0 || c >= W || r < 0 || r >= H) ? -1 : g[c * H + r];
  const wins = (c, p) => { const r = h[c]; for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) { let k = 1; for (let i = 1; at(c + dx * i, r + dy * i) === p; i++) k++; for (let i = 1; at(c - dx * i, r - dy * i) === p; i++) k++; if (k >= 4) return true; } return false; };
  for (const c of cols) { g[c * H + h[c]++] = 1 + (n % 2); n++; }
  function neg(a, b) {
    const p = 1 + (n % 2);
    for (let c = 0; c < W; c++) if (h[c] < H && wins(c, p)) return Math.floor((W * H + 1 - n) / 2);
    if (n >= W * H - 1) return 0;
    let best = -Infinity;
    for (let c = 0; c < W; c++) { if (h[c] >= H) continue; g[c * H + h[c]++] = p; n++; const s = -neg(-b, -a); n--; g[c * H + --h[c]] = 0; if (s > best) best = s; if (s > a) a = s; if (a >= b) break; }
    return best;
  }
  return neg(-1000, 1000);
}
function randomPosition(E, W, ply) {
  for (;;) { E.reset(); const s = []; let okp = true; for (let i = 0; i < ply; i++) { const cs = []; for (let c = 0; c < W; c++) if (E.canPlay(c) && !E.isWinningMove(c)) cs.push(c); if (!cs.length) { okp = false; break; } const c = cs[Math.floor(rnd() * cs.length)]; E.playCol(c); s.push(c); } if (okp && !E.canWinNext()) return s; }
}
{
  const E = C4.Engine(7, 6, 20); let agree = 0, total = QUICK ? 30 : 100, t0 = Date.now(), dist = {};
  for (let i = 0; i < total; i++) {
    const ply = 24 + (i % 10); const s = randomPosition(E, 7, ply);
    E.reset(); E.playSeq(s); const a = E.solve(false), b = naive(7, 6, s);
    if (a === b) agree++; else console.log('  mismatch', s.map(c => c + 1).join(''), a, b);
    dist[a > 0 ? 'win' : a < 0 ? 'loss' : 'draw'] = (dist[a > 0 ? 'win' : a < 0 ? 'loss' : 'draw'] || 0) + 1;
  }
  ok(agree === total, `7x6 exact scores agree with naive minimax on ${agree}/${total} positions (plies 24-33; ${JSON.stringify(dist)}) in ${Date.now() - t0} ms`);
  // mid-game positions vs naive (fewer, slower)
  let agree2 = 0, tot2 = QUICK ? 4 : 12;
  for (let i = 0; i < tot2; i++) { const s = randomPosition(E, 7, 18 + (i % 4)); E.reset(); E.playSeq(s); const a = E.solve(false), b = naive(7, 6, s); if (a === b) agree2++; else console.log('  mismatch', s.map(c => c + 1).join(''), a, b); }
  ok(agree2 === tot2, `7x6 exact scores agree with naive minimax on ${agree2}/${tot2} mid-game positions (plies 18-21)`);
  // Pons convention examples: score of an immediate win = (43 - stones)/2
  E.reset(); E.playSeq(seq('112233')); ok(E.solve(false) === 18, 'win with 4th stone scores 18 = (43-7+... )/2');
  E.reset(); E.playSeq(seq('2252576253462244111563365343671351441')); ok(E.solve(false) === -1, 'sample position score -1 (also -1 by naive)');
}
for (const [W, H, plies, n] of [[5, 4, [0, 2, 4, 6], 12], [8, 7, [36, 38, 40], 12]]) {
  const E = C4.Engine(W, H, 18); let agree = 0;
  for (let i = 0; i < n; i++) { const s = randomPosition(E, W, plies[i % plies.length]); E.reset(); E.playSeq(s); const a = E.solve(false), b = naive(W, H, s); if (a === b) agree++; else console.log('  mismatch', W, H, s.join(','), a, b); }
  ok(agree === n, `${W}x${H} exact scores agree with naive minimax on ${agree}/${n} positions`);
}
{ const E = C4.Engine(5, 4, 16); E.reset(); const v = E.solve(false); ok(v === naive(5, 4, []), '5x4 empty board value = ' + v + ' (naive agrees)'); console.log('  5x4 empty board value for first player:', v, v > 0 ? '(first player wins)' : v < 0 ? '(second player wins)' : '(draw)'); }

// ---- AI behaviour ----
const always = v => () => v;
{
  // immediate win is taken (levels 2-5)
  for (let lv = 2; lv <= 5; lv++) { const r = C4.think({ W: 7, H: 6, pop: false, moves: C4.fromNotation('112233'), level: lv, rand: always(0.99) }); ok(r.move.c === 3, 'level ' + lv + ' takes the immediate win'); }
  // forced block (levels 2-5): yellow must block column 4
  for (let lv = 2; lv <= 5; lv++) { const r = C4.think({ W: 7, H: 6, pop: false, moves: C4.fromNotation('11223'), level: lv, rand: always(0.99) }); ok(r.move.c === 3, 'level ' + lv + ' blocks an open three'); }
  // level 1 blocks only half the time
  let blocks = 0; for (let i = 0; i < 400; i++) { const r = C4.think({ W: 7, H: 6, pop: false, moves: C4.fromNotation('12131'), level: 1 }); if (r.move.c === 0) blocks++; }
  ok(blocks > 80 && blocks < 330, 'level 1 blocks an immediate four only sometimes (' + blocks + '/400)');
  // perfect opens in the centre and uses the book
  const r0 = C4.think({ W: 7, H: 6, pop: false, moves: [], level: 5 }); ok(r0.move.c === 3 && r0.info.kind === 'book', 'perfect AI opens in the centre column (book)');
  // perfect AI finds the fastest win in an endgame and the exact scores match analysis
  { const s = randomPosition(C4.Engine(7, 6, 10), 7, 26); const r = C4.think({ W: 7, H: 6, pop: false, moves: s.map(c => ({ t: 'd', c })), level: 5 }); ok(r.info.kind === 'exact', 'perfect AI solves a 26-ply position exactly'); const best = Math.max(...r.info.scores.filter(x => x != null)); ok(r.info.scores[r.move.c] === best, 'perfect AI plays a best-scoring column'); }
  // Pop Out AI takes a winning pop
  { const g = C4.newGame(7, 6, true); const req = { W: 7, H: 6, pop: true, moves: C4.fromNotation('121314'), level: 4, rand: always(0.99) }; const r = C4.think(req); ok(r.move.t === 'd' && r.move.c === 0, 'Pop Out AI completes a vertical four'); }
  // hint labels: exact scores for an endgame
  { const s = randomPosition(C4.Engine(7, 6, 10), 7, 28); const h = C4.hint({ W: 7, H: 6, pop: false, moves: s.map(c => ({ t: 'd', c })) }); ok(h.kind === 'exact' && h.scores.length === 7, 'hint returns exact per-column scores'); }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
