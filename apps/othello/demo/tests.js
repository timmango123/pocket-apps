// 黑白棋 rule unit tests. Uses the game's own core (extracted from index.html via CORE markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {initialPos,sides,perft,legalOf,flipsOf,playPos,passPos,isOver,counts,finalCounts,finalDiff,cellAt,setSq,sqName,parseSq,think,analyze,solve,genMoves,listSq,LEVELS,seededRng,openingMoves,dailySeed,get ML(){return ML},get MH(){return MH}};')();

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const sq = C.parseSq;
function posFrom(rows, turn) { // rows: 8 strings, 'X' black, 'O' white, '.' empty; row 1 first
  const p = { b: [0, 0], w: [0, 0], turn: turn || 0 };
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') C.setSq(p, y * 8 + x, 0); else if (ch === 'O') C.setSq(p, y * 8 + x, 1); }));
  return p;
}
// naive mailbox reference move generator
function naiveFlips(p, s) {
  if (C.cellAt(p, s) >= 0) return [];
  const me = p.turn, out = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    let x = (s & 7) + dx, y = (s >> 3) + dy; const run = [];
    while (x >= 0 && x < 8 && y >= 0 && y < 8 && C.cellAt(p, y * 8 + x) === (me ^ 1)) { run.push(y * 8 + x); x += dx; y += dy; }
    if (run.length && x >= 0 && x < 8 && y >= 0 && y < 8 && C.cellAt(p, y * 8 + x) === me) out.push(...run);
  }
  return out.sort((a, b) => a - b);
}
function naiveLegal(p) { const r = []; for (let s = 0; s < 64; s++) if (naiveFlips(p, s).length) r.push(s); return r; }

// 1. Initial position
const init = C.initialPos();
ok(C.cellAt(init, sq('d4')) === 1 && C.cellAt(init, sq('e5')) === 1 && C.cellAt(init, sq('d5')) === 0 && C.cellAt(init, sq('e4')) === 0 && init.turn === 0, 'initial setup d4/e5 white, d5/e4 black, black first');
ok(JSON.stringify(C.legalOf(init).map(C.sqName).sort()) === JSON.stringify(['c4', 'd3', 'e6', 'f5']), 'initial 4 legal moves', C.legalOf(init).map(C.sqName));

// 2. Perft vs published values (passes count as a ply)
const KNOWN = [1, 4, 12, 56, 244, 1396, 8200, 55092, 390216, 3005288];
const s0 = C.sides(init); const perftRes = [];
for (let d = 1; d <= 9; d++) { const t = Date.now(), n = C.perft(s0[0], s0[1], s0[2], s0[3], d, false); perftRes.push(`d${d}=${n} (${Date.now() - t}ms)`); ok(n === KNOWN[d], 'perft ' + d, n); }
console.log('perft:', perftRes.join(', '));

// 3. Multi-direction flips happen together
let p = posFrom(['X..X..X.', '.O.O.O..', '..OOO...', 'XOO.OOOX', '..OOO...', '.O.O.O..', 'X..X..X.', '........']);
const f = C.flipsOf(p, sq('d4')).map(C.sqName).sort();
ok(f.length === 17 && JSON.stringify(f) === JSON.stringify(naiveFlips(p, sq('d4')).map(C.sqName).sort()), 'all 8 directions flip at once (17 discs)', f);
const q = C.playPos(p, sq('d4')); ok(C.counts(q)[1] === C.counts(p)[1] - 17 && C.counts(q)[0] === C.counts(p)[0] + 18, 'counts after 8-direction move');

// 4. No wrap-around across edges (h-file to a-file of next row, and diagonals)
p = posFrom(['.......O', 'X.......', '........', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'no east/west wrap (h1 white, a2 black)', C.legalOf(p).map(C.sqName));
p = posFrom(['......OX', '........', '........', '........', '........', '........', '........', '........']);
ok(JSON.stringify(C.legalOf(p).map(C.sqName)) === JSON.stringify(['f1']), 'edge row move f1 only', C.legalOf(p).map(C.sqName));
p = posFrom(['........', '.......O', 'X.......', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'no diagonal wrap', C.legalOf(p).map(C.sqName));
// a move must bracket: run ending in empty or board edge is not legal
p = posFrom(['OOOOOOO.', '........', '........', '........', '........', '........', '........', '........']);
ok(C.legalOf(p).length === 0, 'unbracketed run to edge is illegal');

// 5. Bitboard generator == naive generator over 400 random games (every position), flips identical
let positions = 0, mism = 0, games = 0, fullBoards = 0, maxMoves = 0;
const R = C.seededRng(12345);
for (let g = 0; g < 400; g++) {
  let pp = C.initialPos(), n = 0;
  while (!C.isOver(pp)) {
    let L = C.legalOf(pp);
    if (!L.length) { // pass rule: side has no move but game not over -> other side must have one
      const pq = C.passPos(pp); if (!C.legalOf(pq).length) mism++; pp = pq; L = C.legalOf(pp);
    }
    positions++;
    const NL = naiveLegal(pp);
    if (JSON.stringify(L.slice().sort((a, b) => a - b)) !== JSON.stringify(NL)) mism++;
    const m = L[Math.floor(R() * L.length)];
    if (JSON.stringify(C.flipsOf(pp, m).sort((a, b) => a - b)) !== JSON.stringify(naiveFlips(pp, m))) mism++;
    pp = C.playPos(pp, m); n++;
  }
  games++; maxMoves = Math.max(maxMoves, n);
  const c = C.counts(pp); if (c[0] + c[1] === 64) fullBoards++;
  if (n > 60) mism++;
}
ok(mism === 0, 'bitboard vs naive move gen/flips across ' + positions + ' positions', mism);
ok(maxMoves <= 60, 'a game never exceeds 60 moves (board full ends it)', maxMoves);
console.log(`random games: ${games}, positions checked: ${positions}, ended on full board: ${fullBoards}, max moves ${maxMoves}`);

// 6. Pass and double-pass game end
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXO', 'XXXXXX..'], 1); // white to move: g8 brackets?
p = posFrom(['OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', 'OOOOOOX.'], 1);
// white to move: h7 or h8? white at g7 row... check with naive
ok(JSON.stringify(C.legalOf(p)) === JSON.stringify(naiveLegal(p)), 'pass test position legal sanity');
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXX.', 'XXXXXXO.'], 0);
ok(C.legalOf(p).map(C.sqName).includes('h8'), 'black can capture g8 from h8');
p = posFrom(['OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', 'OOOOOOX.'], 0);
ok(C.legalOf(p).length === 0 && !C.isOver(p), 'black has no move but game not over -> must pass');
ok(C.legalOf(C.passPos(p)).length > 0, 'after pass white has a move');
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXX....', '........', '........', '........'], 1);
ok(C.isOver(p), 'neither side can move -> game over (only black discs)');
// 7. Scoring: empties to the winner (WOF), draw
let fc = C.finalCounts(p); ok(fc[0] === 64 && fc[1] === 0, 'WOF: 36 black + 28 empty -> 64-0', fc);
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', '........', '........'], 0);
fc = C.finalCounts(p); ok(fc[0] === 41 && fc[1] === 23, 'WOF: 24 vs 23, 17 empties go to winner black -> 41-23', fc);
p = posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOOO'], 0);
fc = C.finalCounts(p); ok(fc[0] === 32 && fc[1] === 32 && C.isOver(p), 'full board 32-32 draw');
const sd = C.sides(posFrom(['XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'OOOOOOOO', 'OOOOOOOO', 'OOOOOOO.', '........', '........'], 0));
ok(C.finalDiff(sd[0], sd[1], sd[2], sd[3]) === 18, 'finalDiff from side-to-move perspective (41-23 = +18)');

// 8. Handicap corners (player gets corners)
p = C.initialPos(); [0, 63, 7, 56].forEach(s => C.setSq(p, s, 0));
ok(C.counts(p)[0] === 6 && [0, 7, 56, 63].every(s => C.cellAt(p, s) === 0), 'handicap: 4 corners placed for player');
ok(JSON.stringify(C.legalOf(p).sort()) === JSON.stringify(C.legalOf(C.initialPos()).sort()), 'handicap corners do not change opening legality');

// 9. Daily opening deterministic (same date -> same 6 moves), random opening legal
const d1 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261014))), d2 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261014))), d3 = C.openingMoves(C.initialPos(), 6, C.seededRng(C.dailySeed(20261015)));
ok(d1.length === 6 && JSON.stringify(d1) === JSON.stringify(d2), 'daily opening deterministic', d1.map(C.sqName).join(''));
ok(JSON.stringify(d1) !== JSON.stringify(d3), 'different day -> different daily opening');
console.log('daily opening 2026-10-14:', d1.map(C.sqName).join(''));

// 10. Endgame exact solver == naive minimax on random positions with <= 9 empties
function naiveSolve(p, passed) {
  const L = C.legalOf(p);
  if (!L.length) { if (passed) { const s = C.sides(p); return C.finalDiff(s[0], s[1], s[2], s[3]); } return -naiveSolve(C.passPos(p), true); }
  let best = -999; for (const m of L) best = Math.max(best, -naiveSolve(C.playPos(p, m), false)); return best;
}
let solved = 0, solveBad = 0; const R2 = C.seededRng(99);
for (let g = 0; g < 30; g++) {
  let pp = C.initialPos();
  while (true) { if (C.isOver(pp)) break; if (!C.legalOf(pp).length) pp = C.passPos(pp); const c = C.counts(pp); if (64 - c[0] - c[1] <= 9) break; const L = C.legalOf(pp); pp = C.playPos(pp, L[Math.floor(R2() * L.length)]); }
  if (C.isOver(pp) || !C.legalOf(pp).length) continue;
  const s = C.sides(pp), v = C.solve(s[0], s[1], s[2], s[3], -1e9, 1e9, false, 1), nv = naiveSolve(pp, false);
  solved++; if (v !== nv) solveBad++;
}
ok(solveBad === 0 && solved > 20, 'exact solver matches naive minimax (' + solved + ' positions)', solveBad);

// 11. AI: every level returns a legal move; measure think time on a midgame position
let mid = C.initialPos(); const R3 = C.seededRng(7);
for (let i = 0; i < 20; i++) { if (!C.legalOf(mid).length) mid = C.passPos(mid); const L = C.legalOf(mid); mid = C.playPos(mid, L[Math.floor(R3() * L.length)]); }
if (!C.legalOf(mid).length) mid = C.passPos(mid);
const times = [];
for (let lv = 1; lv <= 5; lv++) {
  const r = C.think(C.sides(mid), lv); times.push(`L${lv} ${C.LEVELS[lv].name}: ${Math.round(r.ms)}ms depth ${r.depth} nodes ${r.nodes}`);
  ok(C.legalOf(mid).includes(r.move), 'level ' + lv + ' returns a legal move');
  ok(r.ms <= C.LEVELS[lv].ms * 1.15 + 30, 'level ' + lv + ' within time budget', Math.round(r.ms));
}
console.log('think (midgame, 40 empties):\n  ' + times.join('\n  '));
// level 1 greedy = max flips (when not making a deliberate mistake)
const g1 = C.LEVELS[1].err; C.LEVELS[1].err = 0; const r1 = C.think(C.sides(mid), 1); C.LEVELS[1].err = g1;
const maxF = Math.max(...C.legalOf(mid).map(m => C.flipsOf(mid, m).length));
ok(C.flipsOf(mid, r1.move).length === maxF, 'level 1 is greedy on flip count');
// level 5 takes a free corner when available
p = posFrom(['.OOOOOX.', '........', '........', '........', '........', '........', '........', '........'], 0);
ok(C.think(C.sides(p), 5).move === sq('a1'), 'expert takes a1 corner');
// 16-empty exact solve within budget (spec: level 5 reads last 16 empties)
let e16 = C.initialPos(); const R4 = C.seededRng(2024);
while (true) { if (C.isOver(e16)) { e16 = C.initialPos(); continue; } if (!C.legalOf(e16).length) e16 = C.passPos(e16); const c = C.counts(e16); if (64 - c[0] - c[1] <= 16) break; const L = C.legalOf(e16); e16 = C.playPos(e16, L[Math.floor(R4() * L.length)]); }
const r16 = C.think(C.sides(e16), 5);
ok(r16.ms <= 3200, 'level 5 at 16 empties answers within 3s', Math.round(r16.ms));
console.log(`level 5 @16 empties: ${Math.round(r16.ms)}ms, exact=${!!r16.exact}, nodes ${r16.nodes}, score ${r16.score}`);
// hint analysis: scores for every legal move, best first
const an = C.analyze(C.sides(mid), 1000);
ok(an.scores.length === C.legalOf(mid).length && an.scores.every((x, i) => i === 0 || an.scores[i - 1].v >= x.v), 'hint analysis scores every move, sorted');

// 12. Difficulty ladder (release review): L3 must not be a wall for a 2-ply player, L4 must be beatable by a deep searcher.
ok(C.LEVELS[3].depth === 2 && C.LEVELS[3].err >= 0.3 && C.LEVELS[4].depth === 5 && C.LEVELS[4].err >= 0.08, 'L3/L4 tuned (see qa/skill-tiers/othello)', C.LEVELS.slice(3, 5));

// test games for the browser checks: a finished game in which black wins (optionally from a handicap start)
function finishedGame(seed, start, wantWinner) {
  for (let k = 0; k < 400; k++) {
    const R = C.seededRng(seed + k); let pp = start(), mv = [];
    while (!C.isOver(pp)) { if (!C.legalOf(pp).length) pp = C.passPos(pp); const L = C.legalOf(pp); const m = L[Math.floor(R() * L.length)]; mv.push(m); pp = C.playPos(pp, m); }
    const fc = C.finalCounts(pp); if (wantWinner == null || (wantWinner === 0 ? fc[0] > fc[1] : fc[1] > fc[0])) return { moves: mv, start: start() };
  }
}
const handStart = () => { const q = C.initialPos(); C.setSq(q, 0, 0); return q; };
const GAMES = { blackWin: finishedGame(500, C.initialPos, 0), handWin: finishedGame(900, handStart, 0), any: finishedGame(77, C.initialPos, null) };
ok(GAMES.blackWin && GAMES.handWin && GAMES.any, 'test games generated');

// 13. Browser regressions with real CDP touch (one Chromium; waits on conditions, never on wall-clock deltas)
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { console.log('playwright missing: browser checks skipped'); } }
  if (chromium) await browserChecks(chromium).catch(e => ok(false, 'browser checks crashed', String(e && e.stack || e)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

async function browserChecks(chromium) {
  const ORIGIN = 'https://othello.test', T0 = Date.now();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function ctxOpen(vp, scheme) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme || 'dark' });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(ORIGIN)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); if (u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); errors.push('external request ' + u); return r.abort(); });
    await ctx.addInitScript(() => { window.__clk = 0; document.addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) window.__clk++; }); });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const cdp = await ctx.newCDPSession(page);
    const T = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    // tap modes: plain, held 0.6 s / 1 s, and with another finger already resting on the status line (touchEnd lists only finger 2)
    const tap = async (x, y, mode) => {
      if (mode === '2finger') {
        const s = await page.evaluate(() => { const r = document.getElementById('stText').getBoundingClientRect(); return { x: Math.max(4, r.left + 4), y: r.top + r.height / 2 }; });
        await T('touchStart', [{ x: s.x, y: s.y, id: 1 }]);
        await T('touchStart', [{ x: s.x, y: s.y, id: 1 }, { x, y, id: 2 }]);
        await sleep(40); await T('touchEnd', [{ x, y, id: 2 }]); await T('touchEnd', [{ x: s.x, y: s.y, id: 1 }]);
        return;
      }
      await T('touchStart', [{ x, y, id: 1 }]);
      if (mode === 'hold600') await sleep(600); else if (mode === 'hold1000') await sleep(1000);
      await T('touchEnd', [{ x, y, id: 1 }]);
    };
    const box = sel => page.evaluate(sel => new Promise((res, rej) => { let last = '', same = 0, n = 0; const el = document.querySelector(sel); if (!el) return rej(new Error('no ' + sel));
      const f = () => { const r = el.getBoundingClientRect(), k = [r.x, r.y, r.width, r.height].map(v => v.toFixed(1)).join(); const moving = [el.closest('.card'), el.closest('.ov')].some(x => x && x.getAnimations().some(an => an.playState === 'running' || an.playState === 'pending'));
        if (k === last && r.width && !moving) same++; else same = 0; last = k;
        if (same >= 2 || ++n > 600) { const q = el.getBoundingClientRect(); res({ x: q.x + q.width / 2, y: q.y + q.height / 2, top: q.top, bottom: q.bottom }); } else requestAnimationFrame(f); }; f(); }), sel);
    const tapEl = async (sel, mode) => { const b = await box(sel); await tap(b.x, b.y, mode); };
    const until = (fn, arg, timeout = 20000) => page.waitForFunction(fn, arg, { timeout, polling: 20 });
    const sqXY = (sq, fx = 0.5, fy = 0.5) => page.evaluate(([sq, fx, fy]) => { const g = __oth.geom(), k = g.w / g.S; return { x: g.x + (g.M + ((sq & 7) + fx) * g.CELL) * k, y: g.y + (g.M + ((sq >> 3) + fy) * g.CELL) * k }; }, [sq, fx, fy]);
    const legal = () => page.evaluate(() => legalOf(__oth.P));
    const nMoves = () => page.evaluate(() => __oth.G ? __oth.G.moves.length : -1);
    const visible = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
    await page.goto(ORIGIN + '/', { waitUntil: 'load' });
    return { ctx, page, T, tap, tapEl, box, until, sqXY, legal, nMoves, visible };
  }
  async function start(h, o) {
    if (!(await h.visible('ovSetup'))) { await h.tapEl('#tNew'); await h.until(() => !document.getElementById('ovSetup').classList.contains('hidden')); }
    for (const [b, v] of [['sgMode', o.mode]].concat(o.mode === 'ai' ? [['sgLevel', String(o.level || 1)], ['sgColor', '0'], ['sgHand', '0']] : []).concat([['sgOpen', 'std']]))
      if (!(await h.page.getAttribute(`#${b} button[data-v="${v}"]`, 'class') || '').includes('on')) await h.tapEl(`#${b} button[data-v="${v}"]`);
    await h.tapEl('#sStart'); await h.until(() => __oth.phase === 'play' && __oth.canInput());
  }
  const save = o => Object.assign({ mode: '2p', level: 1, human: 0, hand: 0, open: 'std', moves: [], pre: 0, hints: 0, undos: 0, day: 0 }, o);
  const seed = async (h, sv, stats) => { await h.page.evaluate(([sv, stats]) => { localStorage.clear(); localStorage.setItem('othello.game', JSON.stringify(sv)); if (stats) localStorage.setItem('othello.stats', JSON.stringify(stats)); }, [sv, stats || null]); await h.page.reload({ waitUntil: 'load' }); };
  const stats = h => h.page.evaluate(() => JSON.parse(localStorage.getItem('othello.stats') || '{}'));

  // [嚴重／2] taps during the flip animation are not dropped: 2-player, 12 taps at 8/s on the side to move's legal square
  {
    const h = await ctxOpen();
    await start(h, { mode: '2p' });
    const n0 = await h.nMoves(); let sent = 0;
    for (let i = 0; i < 12; i++) { const L = await h.legal(); if (!L.length) break; const p = await h.sqXY(L[i % L.length]); const t = Date.now(); await h.tap(p.x, p.y); sent++; const rest = 125 - (Date.now() - t); if (rest > 0) await sleep(rest); }
    await h.until(n => __oth.G.moves.length >= n, n0 + sent, 5000).catch(() => {});
    ok((await h.nMoves()) - n0 === sent, '2p: every tap at 8/s during flip animations is a move', { sent, got: (await h.nMoves()) - n0 });
    // vs the computer: a tap right after the computer's disc lands (its flips still animating) is taken
    await h.tapEl('#bNew'); await h.until(() => !document.getElementById('ovSetup').classList.contains('hidden'));
    await start(h, { mode: 'ai', level: 1 });
    let taken = 0, tries = 0;
    for (let i = 0; i < 4; i++) {
      const L = await h.legal(); if (!L.length || (await h.page.evaluate(() => __oth.phase)) !== 'play') break;
      const n = await h.nMoves(); let p = await h.sqXY(L[0]); await h.tap(p.x, p.y);
      await h.until(n => __oth.G.moves.length >= n + 2 && __oth.canInput() || __oth.phase !== 'play', n, 15000);
      if ((await h.page.evaluate(() => __oth.phase)) !== 'play') break;
      const anim = await h.page.evaluate(() => __oth.animating());
      const L2 = await h.legal(); p = await h.sqXY(L2[0]); const n2 = await h.nMoves(); await h.tap(p.x, p.y);
      tries++; if ((await h.nMoves()) === n2 + 1) taken++;
      if (!anim) console.log('  note: computer flips had already finished before the tap');
      await h.until(n => __oth.canInput() || __oth.G.moves.length > n + 1 || __oth.phase !== 'play', n2, 15000);
      await h.until(() => __oth.canInput() || __oth.phase !== 'play', null, 15000);
    }
    ok(tries >= 3 && taken === tries, 'vs AI: a tap right after the computer moves is taken', { tries, taken });
    // [小／2] a tap just inside a neighbouring illegal square snaps to the legal one; a far illegal tap explains why
    await h.tapEl('#bNew'); await h.until(() => !document.getElementById('ovSetup').classList.contains('hidden'));
    await start(h, { mode: '2p' });
    let p = await h.sqXY(18, 0.9, 0.5); // c3, right next to the legal d3
    await h.tap(p.x, p.y);
    ok((await h.page.evaluate(() => __oth.G.moves.slice())).join() === '19', 'tap near the edge of a legal square snaps onto it (c3 edge -> d3)', await h.page.evaluate(() => __oth.G.moves.slice()));
    p = await h.sqXY(56); await h.tap(p.x, p.y);
    ok((await h.nMoves()) === 1 && /夾不到/.test(await h.page.textContent('#toast')) && await h.visible('toast'), 'illegal empty square: no move, toast says why');
    await h.ctx.close();
  }
  // [嚴重／2] buttons fire once on pointerup in every tap mode, including with another finger already down
  {
    const h = await ctxOpen();
    const rows = [];
    for (const mode of ['tap', 'hold600', 'hold1000', '2finger']) {
      const s0 = await h.page.evaluate(() => JSON.parse(localStorage.getItem('othello.settings') || '{"sound":true}').sound !== false);
      await h.page.evaluate(() => { window.__clk = 0; }); await h.tapEl('#tRules', mode);
      const rulesOpen = await h.visible('ovRules'); await h.tapEl('#ovRules .btn[data-close]', mode); await sleep(60);
      const rulesClosed = !(await h.visible('ovRules')), c1 = await h.page.evaluate(() => window.__clk);
      await h.page.evaluate(() => { window.__clk = 0; }); await h.tapEl('#tSet', mode); await h.tapEl('#swList .sw[data-k="sound"]', mode); await sleep(60);
      const s1 = await h.page.evaluate(() => JSON.parse(localStorage.getItem('othello.settings') || '{}').sound !== false);
      await h.tapEl('#setDone', mode); await sleep(60); const c2 = await h.page.evaluate(() => window.__clk), setClosed = !(await h.visible('ovSettings'));
      rows.push({ mode, ok: rulesOpen && rulesClosed && c1 === 2 && s1 === !s0 && c2 === 3 && setClosed, rulesOpen, rulesClosed, c1, toggled: s1 !== s0, c2, setClosed });
    }
    ok(rows.every(r => r.ok), 'buttons: single, held 0.6 s / 1 s and two-finger taps each fire exactly once', rows.filter(r => !r.ok));
    // the setup flow with two-finger taps: 新對局 -> level 1 -> 開始對局
    await h.tapEl('#tNew', '2finger'); await h.until(() => !document.getElementById('ovSetup').classList.contains('hidden'));
    await h.tapEl('#sgLevel button[data-v="3"]', '2finger');
    await h.tapEl('#sStart', '2finger');
    await h.until(() => __oth.phase === 'play', null, 5000).catch(() => {});
    ok((await h.page.evaluate(() => __oth.phase === 'play' && __oth.G.level === 3)), 'two-finger taps run the whole new-game flow');
    await h.ctx.close();
  }
  // [中／1] closing the page after the last move: stats are already written; 查看上局結果 shows the result
  {
    const h = await ctxOpen();
    const g = GAMES.any, last = g.moves[g.moves.length - 1];
    await seed(h, save({ moves: g.moves.slice(0, -1), start: g.start }));
    ok(await h.page.textContent('#tCont') === '繼續對局', 'unfinished save offers 繼續對局');
    await h.tapEl('#tCont'); await h.until(() => __oth.phase === 'play' && __oth.canInput());
    const p = await h.sqXY(last); await h.tap(p.x, p.y);
    ok((await h.page.evaluate(() => __oth.G.moves.length)) === g.moves.length && (await stats(h)).pvp === 1, 'stats written on the last move, before the count animation', await stats(h));
    await h.page.reload({ waitUntil: 'load' });
    ok((await stats(h)).pvp === 1 && await h.visible('tCont') && await h.page.textContent('#tCont') === '查看上局結果', 'after reload during the count: stats kept, title offers 查看上局結果');
    await h.tapEl('#tCont'); await h.until(() => !document.getElementById('ovResult').classList.contains('hidden'));
    const t = await h.page.evaluate(() => ({ cls: document.getElementById('rTitle').className, txt: document.getElementById('rTitle').textContent }));
    ok((await stats(h)).pvp === 1 && (t.txt === '和局' || /win/.test(t.cls)), 'result shown once, not double counted; 2p winner title uses the win colour', t);
    await h.page.reload({ waitUntil: 'load' });
    ok(!(await h.visible('tCont')), 'after the result has been shown the save is cleared');
    // [中／3] assisted win (hints/undos) is 輔助勝: no win, no achievements. Old saves of finished games are recorded on load.
    await seed(h, save({ mode: 'ai', level: 2, hints: 1, moves: GAMES.blackWin.moves, start: GAMES.blackWin.start }));
    await h.tapEl('#tCont'); await h.until(() => !document.getElementById('ovResult').classList.contains('hidden'));
    let st = await stats(h);
    ok(st.lv[2] && st.lv[2].p === 1 && st.lv[2].w === 0 && st.lv[2].a === 1 && !Object.keys(st.ach).length && await h.page.textContent('#rTitle') === '輔助勝' && /輔助勝/.test(await h.page.textContent('#rSub')), 'hinted win -> 輔助勝, not a win, no achievement', st);
    // [小／3] handicap games go to their own table and unlock nothing
    await seed(h, save({ mode: 'ai', level: 2, hand: 1, moves: GAMES.handWin.moves, start: GAMES.handWin.start }));
    await h.tapEl('#tCont'); await h.until(() => !document.getElementById('ovResult').classList.contains('hidden'));
    st = await stats(h);
    ok(st.hc && st.hc[2].w === 1 && !(st.lv[2]) && !Object.keys(st.ach).length, 'handicap win recorded separately, no achievement', st);
    // a clean win still counts and unlocks 初勝
    await seed(h, save({ mode: 'ai', level: 2, moves: GAMES.blackWin.moves, start: GAMES.blackWin.start }));
    await h.tapEl('#tCont'); await h.until(() => !document.getElementById('ovResult').classList.contains('hidden'));
    st = await stats(h);
    ok(st.lv[2].w === 1 && st.ach.first === 1 && await h.page.textContent('#rTitle') === '勝利！', 'clean win counts and unlocks 初勝', st);
    // [細節] daily streak: three days in a row ending today
    const today = await h.page.evaluate(() => { const d = new Date(), k = x => x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate(), a = []; for (let i = 0; i < 3; i++) { const e = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i); a.push(k(e)); } return a; });
    await h.page.evaluate(days => { const s = JSON.parse(localStorage.getItem('othello.stats')); days.forEach(k => { s.daily[k] = { r: 'w', s: '40-24' }; }); localStorage.setItem('othello.stats', JSON.stringify(s)); }, today);
    await h.page.reload({ waitUntil: 'load' }); await h.tapEl('#tStats'); await h.until(() => !document.getElementById('ovStats').classList.contains('hidden'));
    ok(/連續 3 天/.test(await h.page.textContent('#st2p')), 'stats show the daily streak', await h.page.textContent('#st2p'));
    await h.ctx.close();
  }
  // [小／7] 開始對局 visible without scrolling on short screens (lobby 375x500, landscape)
  {
    const rows = [];
    for (const vp of [[375, 500], [844, 390], [640, 360], [360, 640]]) {
      const h = await ctxOpen({ width: vp[0], height: vp[1] }, 'light');
      await h.tapEl('#tNew'); await h.until(() => !document.getElementById('ovSetup').classList.contains('hidden'));
      const b = await h.box('#sStart'), m = await h.page.evaluate(() => ({ H: innerHeight, sc: document.getElementById('ovSetup').scrollTop, ov: document.documentElement.scrollWidth > innerWidth }));
      rows.push({ vp: vp.join('x'), ok: b.bottom <= m.H && b.top >= 0 && m.sc === 0 && !m.ov, bottom: Math.round(b.bottom), H: m.H });
      await h.ctx.close();
    }
    ok(rows.every(r => r.ok), '開始對局 visible without scrolling at 375x500, 844x390, 640x360, 360x640', rows);
  }
  ok(!errors.length, 'no page/console errors or external requests in the browser checks', errors.slice(0, 5));
  console.log(`browser checks: ${Math.round((Date.now() - T0) / 1000)}s`);
  await browser.close();
}
