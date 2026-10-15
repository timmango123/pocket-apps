// Rule + engine tests for 點格棋 (dots-and-boxes). Loads the game's own core (between CORE-START/CORE-END in index.html).
// Usage: node tests.js [--quick]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const D = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return DOTS;')();
const QUICK = process.argv.includes('--quick');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const rand = D.rng(2024);

// ---- geometry ----
const expectEdges = { '3x3': 24, '4x4': 40, '5x5': 60, '6x6': 84, '5x7': 82 };
for (const k in expectEdges) { const [C, R] = D.SIZES[k], G = D.geo(C, R); ok(G.NE === expectEdges[k] && G.NB === C * R, `${k}: ${G.NE} edges, ${G.NB} boxes`); }
{ const G = D.geo(4, 4); let okAll = true; for (let b = 0; b < G.NB; b++) for (let k = 0; k < 4; k++) { const e = G.BE[4 * b + k]; if (G.EB[2 * e] !== b && G.EB[2 * e + 1] !== b) okAll = false; } ok(okAll, 'box/edge incidence tables agree'); }
{ const G = D.geo(4, 4); ok(D.edgeAt(G, 0, 0, 1, 0) === 0 && D.edgeAt(G, 0, 0, 0, 1) === G.HN && D.edgeAt(G, 0, 0, -1, 0) === -1 && D.edgeAt(G, 4, 4, 1, 0) === -1, 'edgeAt maps dot+direction to edge (swipe input)'); }

// ---- basic turn rules ----
{ const g = D.newGame(4, 4, 1); D.play(g, 0); ok(g.turn === 2 && g.moves[0].p === 1, 'a line that completes nothing passes the turn'); ok(D.play(g, 0) === null, 'a drawn line cannot be drawn again'); }
{ // single box capture keeps the turn (2x2 board, box 0 = edges 0,2,6,7)
  const g = D.newGame(2, 2, 1); D.play(g, 0); D.play(g, 2); D.play(g, 6); // p1, p2, p1
  ok(g.turn === 2, 'turn alternates while nothing is completed');
  const cap = D.play(g, 7); ok(cap.length === 1 && cap[0] === 0 && g.own[0] === 2 && g.score[2] === 1 && g.turn === 2, 'completing a box scores it and the same player moves again');
}
{ // one line completes two boxes: middle vertical edge 7 between boxes 0 and 1 on a 2x2 board
  const g = D.newGame(2, 2, 1); for (const e of [0, 1, 2, 3, 6, 8]) { g.turn = 1; D.play(g, e); }
  g.turn = 1; const cap = D.play(g, 7);
  ok(cap.length === 2 && g.score[1] === 2 && g.own[0] === 1 && g.own[1] === 1 && g.turn === 1, 'one line completing two boxes scores both and keeps the turn');
}
{ // capturing is not compulsory
  const g = D.newGame(2, 2, 1); D.play(g, 0); D.play(g, 2); D.play(g, 6); // box 0 has 3 sides, p2 to move
  ok(D.completes(g.pos, 7) === 1, 'box with three sides is capturable');
  const cap = D.play(g, 11); ok(cap && cap.length === 0 && g.turn === 1, 'player may decline a capturable box (no forced capture)');
  ok(D.isDecline(D.posFrom(2, 2, [0, 2, 6]), 11) && !D.isDecline(D.posFrom(2, 2, [0, 2, 6]), 7), 'decline detection');
}
{ // game end, winner and draw
  let draws = 0, wins = 0, bad = 0;
  for (let t = 0; t < 400; t++) {
    const g = D.newGame(4, 4, 1);
    while (!g.over) { const f = D.freeList(g.pos); D.play(g, f[Math.floor(rand() * f.length)]); }
    const s = g.score[1] + g.score[2]; if (s !== 16 || g.drawn !== 40) bad++;
    if (g.winner === 0) { draws++; if (g.score[1] !== 8) bad++; } else { wins++; if (g.score[g.winner] <= g.score[3 - g.winner]) bad++; }
  }
  ok(!bad && draws > 0 && wins > 0, `game ends after all 40 lines, all 16 boxes owned; winner/draw correct (${wins} decided, ${draws} draws 8:8)`);
}
{ const g = D.newGame(3, 3, 2); ok(g.turn === 2, 'first-player option'); }
{ // neutral (pre-drawn daily) lines never capture and never pass the turn
  const g = D.newGame(2, 2, 1); D.play(g, 0, true); D.play(g, 2, true); D.play(g, 6, true);
  ok(g.turn === 1 && D.play(g, 7, true) === null, 'neutral lines keep the turn and cannot complete a box');
}

// ---- safe moves / third-side warning ----
{
  const p = D.posFrom(2, 2, [0, 2]); // box 0 has 2 sides
  ok(!D.isSafe(p, 6) && D.givesAway(p, 6), 'drawing a third side is flagged (novice warning)');
  ok(D.isSafe(p, 5) && !D.givesAway(p, 5), 'a line touching only boxes with <=1 side is safe');
  const q = D.posFrom(2, 2, [0, 2, 6]); ok(!D.givesAway(q, 7), 'completing a box is not giving one away');
}

// ---- undo whole turns ----
{
  const mv = a => a.map(([e, p]) => ({ e, p }));
  ok(D.undoLen(mv([[0, 1], [5, 2], [6, 2], [9, 2]]), 1) === 0, 'undo (vs computer): removes the computer turn and the human move before it');
  ok(D.undoLen(mv([[0, 1], [1, 2], [3, 1], [4, 1], [7, 1], [8, 2]]), 1) === 2, 'undo: a human turn with consecutive captures is rolled back as one turn');
  ok(D.undoLen(mv([[0, 0], [1, 0], [2, 2], [3, 2]]), 1) === 4, 'undo: nothing to undo when only pre-drawn and computer lines exist');
  ok(D.undoLen(mv([[0, 1], [1, 2], [2, 2]]), 0) === 1, 'undo (2 players): removes the last mover\'s whole turn');
  const g = D.newGame(4, 4, 1); for (let i = 0; i < 25; i++) { const f = D.freeList(g.pos); D.play(g, f[Math.floor(rand() * f.length)]); }
  const r = D.replay(4, 4, 1, g.moves.map(m => [m.e, m.p]));
  ok(r.score.join() === g.score.join() && r.turn === g.turn && r.own.join() === g.own.join(), 'replay from the move list reproduces the position (used by undo / resume)');
}

// ---- daily board ----
{
  const a = D.dailyLines(4, 4, '2026-10-14', 10), b = D.dailyLines(4, 4, '2026-10-14', 10), c = D.dailyLines(4, 4, '2026-10-15', 10);
  const p = D.posFrom(4, 4, a);
  ok(a.length === 10 && new Set(a).size === 10 && a.join() === b.join() && a.join() !== c.join() && ![...p.cnt].some(x => x >= 3), 'daily board: 10 seeded lines, deterministic per date, no box gets a third side');
}

// ---- chain / loop decomposition and loony values ----
{
  const p = D.posFrom(3, 1, [0, 1, 2, 3, 4, 5]); const a = D.analyze(p);
  ok(a.chains.join() === '3' && !a.loops.length, 'analyze: row of 3 boxes with top/bottom drawn is a 3-chain');
  const q = D.posFrom(2, 2, [0, 1, 4, 5, 6, 8, 9, 11]); const b = D.analyze(q);
  ok(b.loops.join() === '4' && !b.chains.length, 'analyze: 2x2 with the outline drawn is a 4-loop');
  ok(D.fval([3], []) === -3 && D.fval([3, 3], []) === -2 && D.fval([], [4]) === -4 && D.fval([1, 1], []) === 0 && D.fval([2], []) === -2, 'loony values: [3]=-3, [3,3]=-2 (double-dealing), loop 4=-4, [1,1]=0');
  ok(D.evalLoony(p) === D.exactValue(p, 0) && D.evalLoony(q) === D.exactValue(q, 0), 'loony values agree with exact search on simple positions');
}

// ---- exact alpha-beta + TT vs brute force without pruning (every position of 2x2 and 2x3) ----
function bruteFactory(C, R) {
  const NE = D.geo(C, R).NE, memo = new Map();
  const brute = (p, mask) => {
    if (mask === 2 ** NE - 1) return 0; if (memo.has(mask)) return memo.get(mask); let best = -1e9;
    for (let e = 0; e < NE; e++) { if (p.E[e]) continue; const c = D.draw(p, e); const v = c ? c + brute(p, mask | 1 << e) : -brute(p, mask | 1 << e); D.undraw(p, e); if (v > best) best = v; }
    memo.set(mask, best); return best;
  };
  return brute;
}
for (const [C, R] of QUICK ? [[2, 2]] : [[2, 2], [2, 3]]) {
  const NE = D.geo(C, R).NE, brute = bruteFactory(C, R); let bad = 0, n = 0; const t0 = Date.now();
  for (let m = 0; m < 2 ** NE - 1; m++) {
    const edges = []; for (let e = 0; e < NE; e++) if (m >> e & 1) edges.push(e);
    const p = D.posFrom(C, R, edges), b = brute(D.copy(p), m), x = D.exactSolve(p, 0, true);
    const q = D.copy(p), c = D.draw(q, x.e), mv = c ? c + brute(q, m | 1 << x.e) : -brute(q, m | 1 << x.e);
    if (b !== x.v || mv !== b) bad++; n++;
  }
  ok(!bad, `exact search == brute force on all ${n} positions of ${C}x${R} (value and chosen move), ${Date.now() - t0} ms`);
}
{ // hashed big-board solver agrees with the array solver
  let bad = 0;
  for (let t = 0; t < 30; t++) { const g = D.newGame(4, 4, 1); while (D.freeList(g.pos).length > 15 + t % 6) { const s = D.safeList(g.pos), f = D.freeList(g.pos); D.play(g, s.length ? s[Math.floor(rand() * s.length)] : f[Math.floor(rand() * f.length)]); } if (D.exactSolve(g.pos, 0, true).v !== D.exactSolveBig(g.pos, 0, 0).v) bad++; }
  ok(!bad, 'hashed exact solver (large boards) agrees with the table solver on 30 positions');
}

// ---- AI behaviour ----
function randomEndgame(C, R, maxFree, needDecline) {
  for (let tries = 0; tries < 20000; tries++) {
    const g = D.newGame(C, R, 1);
    while (D.safeList(g.pos).length) { const s = D.safeList(g.pos); D.play(g, s[Math.floor(rand() * s.length)]); }
    // open a random component and maybe eat into it
    while (D.freeList(g.pos).length > maxFree || (needDecline && !D.hasCap(g.pos))) {
      if (D.hasCap(g.pos) && rand() < 0.6) D.play(g, D.capStep(g.pos)); else { const f = D.freeList(g.pos); if (!f.length) break; D.play(g, f[Math.floor(rand() * f.length)]); }
      if (g.over) break;
    }
    if (!g.over && D.freeList(g.pos).length <= maxFree) return g;
  }
  return null;
}
{ // levels 3+ double-deal: positions where declining is the only optimal move
  let found = 0, l3 = 0, l4 = 0, l5 = 0;
  for (let t = 0; t < 4000 && found < (QUICK ? 15 : 40); t++) {
    const g = randomEndgame(4, 4, 16, true); if (!g) break;
    const p = g.pos; if (!D.hasCap(p)) continue;
    const free = D.freeList(p), vals = free.map(e => { const q = D.copy(p), c = D.draw(q, e); return c ? c + D.exactValue(q, 0) : -D.exactValue(q, 0); });
    const best = Math.max(...vals), bestMoves = free.filter((e, i) => vals[i] === best);
    if (!bestMoves.every(e => D.isDecline(p, e))) continue; // need: every optimal move is a decline
    if (D.ddMoves(p).length === 0) continue;
    found++;
    const edges = g.moves.map(m => m.e);
    const r3 = D.think({ C: 4, R: 4, edges, level: 3, seed: t, hint: true }); if (D.isDecline(p, r3.e)) l3++;
    const r4 = D.think({ C: 4, R: 4, edges, level: 4, seed: t, hint: true }); if (bestMoves.includes(r4.e)) l4++;
    const r5 = D.think({ C: 4, R: 4, edges, level: 5, seed: t }); if (bestMoves.includes(r5.e)) l5++;
  }
  console.log(`  double-dealing positions: ${found}; L3 declined in ${l3}, L4 optimal in ${l4}, L5 optimal in ${l5}`);
  ok(found >= 10 && l3 >= found * 0.8 && l5 === found, 'levels 3+ use 讓兩格 (decline) where it is required; L5 always optimal');
}
{ // L5 never errs in the endgame: chosen move value == exact best value (brute force, no pruning) on random positions
  let n = 0, bad = 0;
  for (let t = 0; t < (QUICK ? 25 : 80); t++) {
    const g = randomEndgame(4, 4, 14, false); if (!g) continue;
    const p = g.pos, free = D.freeList(p), map = new Map(free.map((e, i) => [e, i])), NE = free.length, memo = new Map();
    const brute = (q, mask) => { if (mask === 2 ** NE - 1) return 0; if (memo.has(mask)) return memo.get(mask); let best = -1e9; for (let i = 0; i < NE; i++) { if (mask >> i & 1) continue; const e = free[i], c = D.draw(q, e); const v = c ? c + brute(q, mask | 1 << i) : -brute(q, mask | 1 << i); D.undraw(q, e); if (v > best) best = v; } memo.set(mask, best); return best; };
    const best = brute(D.copy(p), 0), r = D.think({ C: 4, R: 4, edges: g.moves.map(m => m.e), level: 5, seed: t });
    const q = D.copy(p), c = D.draw(q, r.e), v = c ? c + brute(q, 1 << map.get(r.e)) : -brute(q, 1 << map.get(r.e));
    n++; if (v !== best) bad++;
  }
  ok(n >= 20 && !bad, `L5 endgame moves are optimal vs unpruned brute force on ${n} random positions`);
}
{ // every level returns a legal move quickly on every board size
  let bad = 0, slow = [];
  for (const k of Object.keys(D.SIZES)) for (let lv = 1; lv <= 5; lv++) {
    const [C, R] = D.SIZES[k], g = D.newGame(C, R, 1);
    for (let i = 0; i < 4 && !g.over; i++) { const f = D.freeList(g.pos); D.play(g, f[Math.floor(rand() * f.length)]); }
    const r = D.think({ C, R, edges: g.moves.map(m => m.e), level: lv, seed: lv });
    if (g.pos.E[r.e] || r.e < 0 || r.e >= g.G.NE) bad++;
    if (r.ms > D.LEVELS[lv - 1].ms * 1.25 + 30) slow.push(k + ' L' + lv + ' ' + r.ms + 'ms');
  }
  ok(!bad && !slow.length, 'all levels x all sizes return a legal move within budget ' + slow.join(','));
}
{ // level 1 is greedy but sloppy
  let caps = 0, n = 0;
  for (let t = 0; t < 300; t++) { const p = D.posFrom(2, 2, [0, 2, 6]); const r = D.think({ C: 2, R: 2, edges: [0, 2, 6], level: 1, seed: t + 1 }); n++; if (D.completes(p, r.e)) caps++; }
  ok(caps / n > 0.6 && caps / n < 0.85, `L1 takes an offered box about 70% of the time (${caps}/${n})`);
}
{ // level 2 avoids third sides while safe moves exist
  let bad = 0, n = 0;
  for (let t = 0; t < 200; t++) { const g = D.newGame(4, 4, 1); for (let i = 0; i < 8; i++) { const s = D.safeList(g.pos); if (!s.length) break; D.play(g, s[Math.floor(rand() * s.length)]); } if (!D.safeList(g.pos).length || D.hasCap(g.pos)) continue; const r = D.think({ C: 4, R: 4, edges: g.moves.map(m => m.e), level: 2, seed: t, hint: true }); n++; if (!D.isSafe(g.pos, r.e)) bad++; }
  ok(n > 50 && !bad, `L2 plays safe moves while they exist (${n} positions)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
