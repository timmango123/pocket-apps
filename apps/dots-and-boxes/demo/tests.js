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
  let found = 0, l3 = 0, l4 = 0, l5 = 0, l3dd = 0, l3play = 0;
  for (let t = 0; t < 4000 && found < (QUICK ? 15 : 30); t++) {
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
    for (let k = 0; k < 6; k++) { const r = D.think({ C: 4, R: 4, edges, level: 3, seed: t * 31 + k }); l3play++; if (D.isDecline(p, r.e)) l3dd++; }
  }
  ok(l3play > 0 && l3dd > l3play * 0.15 && l3dd < l3play * 0.7, `L3 (in play, not hints) uses 讓兩格 only part of the time: ${l3dd}/${l3play} (gentler step up from L2)`);
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
{ // difficulty ladder: a simple greedy player (takes boxes, plays safe, gives the fewest, 15% random) vs L2 and L3
  const bot = (p, r) => { const f = D.freeList(p); if (r() < 0.15) return f[Math.floor(r() * f.length)]; const c = D.capStep(p); if (c >= 0) return c; const s = D.safeList(p); if (s.length) return s[Math.floor(r() * s.length)]; let be = [], bk = 1e9; for (const e of f) { const w = D.copy(p); D.draw(w, e); const k = D.greedy(w); if (k < bk) { bk = k; be = [e]; } else if (k === bk) be.push(e); } return be[Math.floor(r() * be.length)]; };
  const rate = lv => { let pts = 0; const N = QUICK ? 30 : 60; for (let i = 0; i < N; i++) { const r = D.rng(900 + i), g = D.newGame(4, 4, 1), me = i % 2 ? 2 : 1; while (!g.over) D.play(g, g.turn === me ? bot(g.pos, r) : D.think({ C: 4, R: 4, edges: g.moves.map(m => m.e), level: lv, seed: i * 977 + g.moves.length }).e); pts += g.winner === me ? 1 : g.winner ? 0 : 0.5; } return pts / N; };
  const w2 = rate(2), w3 = rate(3);
  ok(w3 >= 0.12 && w3 <= 0.5 && w2 - w3 < 0.35, `no wall between L2 and L3: greedy player scores ${(w2 * 100).toFixed(0)}% vs L2, ${(w3 * 100).toFixed(0)}% vs L3`);
}
{ // source checks for small visual fixes
  ok(/t === 'chalk' \? 'rgba\(255,236,140,\.4\)'/.test(html), 'chalkboard theme: the computer\'s last line highlight is strong enough (alpha .4)');
  ok(/const DEF = \{ mode: 'ai', level: 2,/.test(html), 'new players start at level 2');
}

// ---- browser: real CDP touch, storage across reloads ----
async function browserTests() {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('  (playwright not found: browser checks skipped)'); return; }
  const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (vp) => {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const cdp = await ctx.newCDPSession(page);
    const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const tap = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
    const boot = async () => { await page.goto(APP); await page.waitForFunction(() => window.__game && __game.state()); };
    const st = () => page.evaluate(() => __game.state());
    const LS = k => page.evaluate(k => JSON.parse(localStorage.getItem('dots.' + k) || 'null'), k);
    const inject = (game, extra) => page.evaluate(([g, x]) => { localStorage.setItem('dots.game', JSON.stringify(g)); for (const k in x || {}) localStorage.setItem('dots.' + k, JSON.stringify(x[k])); }, [game, extra]);
    return { ctx, page, tapXY, tap, boot, st, LS, inject };
  };
  const saved = (C, R, level, moves, mode) => ({ mode: mode || 'ai', level, C, R, first: 1, human: mode === '2p' ? 0 : 1, daily: null, seed: 5, hints: 0, undos: 0, dd: 0, recorded: false, moves });
  // a 3x3 game one line from the end where the player's last line wins
  let endMoves = null, lastE = -1;
  for (let t = 0; t < 5000 && !endMoves; t++) {
    const g = D.newGame(3, 3, 1); while (D.freeList(g.pos).length > 1) { const f = D.freeList(g.pos); D.play(g, f[Math.floor(rand() * f.length)]); }
    if (g.turn !== 1) continue; const e = D.freeList(g.pos)[0], h = D.replay(3, 3, 1, g.moves.map(m => [m.e, m.p])); D.play(h, e);
    if (h.winner === 1) { endMoves = g.moves.map(m => [m.e, m.p]); lastE = e; }
  }
  try {
    { // (1) the result is written with the last line: reload at once keeps it (and the board), and is never counted twice
      const A = await mk(); await A.boot();
      await A.inject(saved(3, 3, 1, endMoves), { stats: { lv: {}, p2: { b: 0, r: 0, d: 0 }, daily: {}, ach: {}, dd: 0, altNext: 1 }, settings: { level: 1 } });
      await A.boot(); await A.tap('#mClose');
      await A.page.waitForFunction(() => __game.state().inputOK);
      const [x, y] = await A.page.evaluate(e => __game.edgeToClient(e), lastE); await A.tapXY(x, y);
      const right = await A.LS('stats'); // same task as the line: no waiting
      await A.page.reload(); await A.page.waitForFunction(() => window.__game && __game.state());
      const s1 = await A.LS('stats'), b1 = await A.st();
      await A.page.reload(); await A.page.waitForFunction(() => window.__game && __game.state());
      const s2 = await A.LS('stats');
      ok(right.lv.L1 && right.lv.L1.w === 1, 'result is in dots.stats as soon as the last line is drawn (no 650 ms gap)');
      ok(s1.lv.L1.w === 1 && s2.lv.L1.w === 1 && s2.ach.first && s2.ws === 1, 'reloading right after the last line keeps the result, recorded once (win, achievement, streak)');
      ok(b1.over && b1.edges.length === 24, 'the finished board is still there after a reload');
      // a game that ended but was never recorded (closed by an older version) is recorded on load
      await A.inject(Object.assign(saved(3, 3, 1, endMoves.concat([[lastE, 1]])), { recorded: false }), { stats: { lv: {}, p2: { b: 0, r: 0, d: 0 }, daily: {}, ach: {}, dd: 0 } });
      await A.boot(); const s3 = await A.LS('stats'); await A.page.reload(); await A.page.waitForFunction(() => window.__game && __game.state()); const s4 = await A.LS('stats');
      ok(s3.lv.L1 && s3.lv.L1.w === 1 && s4.lv.L1.w === 1, 'a finished but unrecorded saved game is recorded once on load');
      // (2) after a win the result screen suggests the next level, and that button starts it
      await A.inject(saved(3, 3, 1, endMoves), { settings: { level: 1 } }); await A.boot(); await A.tap('#mClose');
      await A.page.waitForFunction(() => __game.state().inputOK); await A.tapXY(...await A.page.evaluate(e => __game.edgeToClient(e), lastE));
      await A.page.waitForFunction(() => !document.querySelector('#result').hidden, null, { timeout: 15000 });
      ok(!(await A.page.locator('#rLvRow').isHidden()) && /等級 2/.test(await A.page.textContent('#rLevel')), 'after a win the result screen offers the next level');
      await A.tap('#rLevel'); await A.page.waitForFunction(() => document.querySelector('#result').hidden);
      ok((await A.st()).level === 2 && (await A.LS('settings')).level === 2, 'the 升一級 button starts a game at the next level and saves it');
      // (3) three losses in a row suggest an easier level
      await A.inject(saved(3, 3, 3, endMoves.map(m => [m[0], m[1] === 1 ? 2 : m[1] === 2 ? 1 : 0])), { settings: { level: 3 }, stats: { lv: {}, p2: { b: 0, r: 0, d: 0 }, daily: {}, ach: {}, dd: 0, run: { lv: 3, l: 2 } } });
      // (mirror: the computer owns the boxes the player owned; the player draws the last line)
      await A.boot(); const sm = await A.st();
      if (!sm.over && sm.inputOK === false) await A.tap('#mClose');
      await A.page.waitForFunction(() => __game.state().inputOK || __game.state().over, null, { timeout: 15000 });
      if (!(await A.st()).over) { await A.tapXY(...await A.page.evaluate(e => __game.edgeToClient(e), lastE)); }
      await A.page.waitForFunction(() => __game.state().over);
      const s5 = await A.LS('stats'), lost = (await A.st()).winner === 2;
      if (lost) { await A.page.waitForFunction(() => !document.querySelector('#result').hidden, null, { timeout: 15000 }); ok(s5.run.l === 3 && /降到等級 2/.test(await A.page.textContent('#rLevel')) && !(await A.page.locator('#rLvRow').isHidden()), 'three losses in a row: the result screen offers one level lower'); }
      else ok(true, 'three-loss suggestion (mirror game was not a loss; skipped)');
      // (4) 開始新局 from the menu asks before throwing away a game in progress; 取消 keeps it
      await A.inject(saved(4, 4, 2, [[0, 1], [5, 2]])); await A.boot();
      await A.tap('#mStart'); const cf = !(await A.page.locator('#confirm').isHidden());
      await A.tap('#cfNo'); const keep = (await A.LS('game')).moves.length === 2 && !(await A.page.locator('#menu').isHidden());
      await A.tap('#mStart'); await A.tap('#cfYes'); await A.page.waitForFunction(() => document.querySelector('#menu').hidden);
      ok(cf && keep && (await A.st()).edges.length === 0, '開始新局 over a game in progress asks first; 取消 keeps the game and the menu');
      // (5) the daily board always uses level 3, whatever level is chosen
      await A.page.evaluate(() => localStorage.clear()); await A.boot(); ok((await A.st()).level === 2, 'fresh storage: the first game is against level 2');
      await A.tap('#cLevel .chip[data-v="5"]'); await A.tap('#cMode .chip[data-v="daily"]'); await A.tap('#mStart');
      await A.page.waitForFunction(() => document.querySelector('#menu').hidden); const ds = await A.st();
      ok(ds.mode === 'daily' && ds.level === 3, 'daily board is played against the fixed level 3 (scores are comparable)');
      await A.ctx.close();
    }
    { // (6) the computer's 讓兩格 is explained (L5, 4x4: the player opens a chain, the computer declines the last 2 boxes)
      const B = await mk(); await B.boot();
      const pre = [[26, 1], [36, 2], [4, 1], [20, 2], [27, 1], [35, 2], [38, 1], [32, 2], [23, 1], [39, 2], [37, 1], [24, 2], [31, 1], [1, 2], [28, 1], [22, 2], [33, 1], [30, 2], [34, 1], [29, 2]];
      await B.inject(saved(4, 4, 5, pre), { settings: { level: 5, warn: false } }); await B.boot(); await B.tap('#mClose');
      await B.page.waitForFunction(() => __game.state().inputOK); await B.tapXY(...await B.page.evaluate(() => __game.edgeToClient(0)));
      await B.page.waitForFunction(() => { const s = __game.state(); return s.inputOK && s.edges.length > 21; }, null, { timeout: 30000 });
      const t = await B.page.evaluate(() => ({ show: document.querySelector('#toast').classList.contains('show'), txt: document.querySelector('#toast').textContent }));
      const g = await B.LS('game'), sts = await B.LS('stats');
      ok(t.show && /讓兩格/.test(t.txt) && /打開下一條鏈/.test(t.txt), 'when the computer declines boxes on purpose a toast explains 讓兩格: ' + t.txt.slice(0, 40));
      ok(g.aiDD >= 1 && sts.ddTip === 1, 'the decline is counted for the result screen and the tip is limited to the first few times');
      await B.ctx.close();
    }
    { // (7) wider line hit zones; dots and box centres stay dead; lobby-size 5x7 cells reach 44px
      const Cx = await mk({ width: 375, height: 500 }); await Cx.boot();
      await Cx.tap('#cMode .chip[data-v="2p"]'); await Cx.tap('#cSize .chip[data-v="5x7"]'); await Cx.tap('#mStart'); await Cx.page.waitForFunction(() => document.querySelector('#menu').hidden);
      const r = await Cx.page.evaluate(() => {
        const s = __game.state(), G = DOTS.geo(s.C, s.R), cell = __game.cell(); let rs = 12345; const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
        const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
        let hit = 0, n = 0, wrong = 0, dots = 0, centres = 0, quarter = 0;
        for (let e = 0; e < G.NE; e++) {
          const [mx, my] = __game.edgeToClient(e);
          for (let k = 0; k < 40; k++) { const h = __game.hitClient(mx + 7 * gauss(), my + 7 * gauss()); n++; if (h === e) hit++; else if (h >= 0) wrong++; }
          const [a, b, c, d] = DOTS.edgeDots(G, e), [x1, y1] = __game.dotToClient(a, b), [x2, y2] = __game.dotToClient(c, d), hz = b === d;
          const off = 0.3 * cell; if (__game.hitClient(x1 + (x2 - x1) * 0.4 + (hz ? 0 : off), y1 + (y2 - y1) * 0.4 + (hz ? off : 0)) === e) quarter++;
        }
        for (let y = 0; y <= s.R; y++) for (let x = 0; x <= s.C; x++) { const [px, py] = __game.dotToClient(x, y); if (__game.hitClient(px, py) === -1 && __game.hitClient(px + 3, py + 3) === -1) dots++; }
        for (let y = 0; y < s.R; y++) for (let x = 0; x < s.C; x++) { const [px, py] = __game.dotToClient(x + 0.5, y + 0.5); if (__game.hitClient(px, py) === -1) centres++; }
        return { cell, rate: hit / n, wrong: wrong / n, quarter, NE: G.NE, dots, nd: (s.C + 1) * (s.R + 1), centres, nb: s.C * s.R };
      });
      ok(r.cell >= 44, `375x500 (lobby) 5x7: cell ${r.cell.toFixed(1)}px >= 44`);
      ok(r.rate >= 0.9 && r.wrong < 0.05, `taps with 7px finger error around a line hit it ${(r.rate * 100).toFixed(1)}% (wrong line ${(r.wrong * 100).toFixed(1)}%)`);
      ok(r.quarter === r.NE, `0.4 along and 0.3 cell off a line still hits it (${r.quarter}/${r.NE}; was a dead zone)`);
      ok(r.dots === r.nd && r.centres === r.nb, `dots (${r.dots}/${r.nd}) and box centres (${r.centres}/${r.nb}) still hit nothing`);
      // a drawn line itself is dead (no stray neighbour), and a real touch next to a line draws it
      const [mx, my] = await Cx.page.evaluate(() => __game.edgeToClient(0)), cell = r.cell;
      await Cx.tapXY(mx + 0.2 * cell, my + 0.3 * cell); await Cx.page.waitForFunction(() => __game.state().edges.length === 1);
      const s1 = await Cx.st(); const onDrawn = await Cx.page.evaluate(([x, y]) => __game.hitClient(x, y), [mx, my]);
      ok(s1.edges[0] === 0 && onDrawn === -1, 'a touch 0.3 cell below a line draws it; touching an already drawn line does nothing');
      await Cx.ctx.close();
    }
  } finally { await browser.close(); }
  ok(!errors.length, 'no page or console errors in the browser checks ' + errors.slice(0, 3).join(' | '));
}
browserTests().catch(e => { fail++; console.log('FAIL browser checks threw:', e && e.stack || e); }).finally(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
});
