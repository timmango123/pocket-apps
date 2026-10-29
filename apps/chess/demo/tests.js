// Tests for 西洋棋 (apps/chess). Part 1 runs the game's own engine (between the CORE markers of ../index.html):
// perft on the standard positions, every special rule, draw rules, the flag-fall rule, the five AI levels and all 100 puzzles' key moves.
// Part 2 drives the real page in mobile Chromium with CDP touch: layout tiers on short screens, tap-tap / drag / promotion,
// taps while the computer thinks, save + validated resume, stats recorded once, abandoning counts as a loss, puzzle timers and resume.
// Usage: node tests.js [--no-browser]
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html'), html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {setFen,getFen,perft,legalMoves,make,unmake,inCheck,moveUci,san,handleMsg,gameStatus,findUci,canMate,parseMove,side:function(){return side;},F_CAS:F_CAS,F_EP:F_EP};')();
const PUZ = JSON.parse(html.match(/var PUZZLES = (\[[\s\S]*?\n\]);/)[1]);
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const ucis = () => C.legalMoves().map(C.moveUci).sort();
const play = (fen, list) => { C.setFen(fen); for (const u of list) { const m = C.findUci(u); if (!m) return false; C.make(m); } return true; };
const sans = () => { const L = C.legalMoves(); return L.map(m => C.san(m, L)); };

// --- perft (published node counts) ---
for (const [name, fen, exp] of [
  ['start', START, [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['pos3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['pos4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['pos5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['pos6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]]]) {
  C.setFen(fen); const got = exp.map((_, i) => C.perft(i + 1));
  ok(got.join() === exp.join(), 'perft ' + name + ': ' + got.join(',') + ' expected ' + exp.join(','));
}
// --- castling ---
{
  C.setFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); let u = ucis();
  ok(u.includes('e1g1') && u.includes('e1c1'), 'both castles available');
  C.setFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); const L = C.legalMoves(); ok(C.san(L.find(m => C.moveUci(m) === 'e1g1'), L) === 'O-O' && C.san(L.find(m => C.moveUci(m) === 'e1c1'), L) === 'O-O-O', 'castle SAN');
  C.setFen('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1'); u = ucis(); ok(!u.includes('e1g1') && u.includes('e1c1'), 'no castling through an attacked square (f1)');
  C.setFen('r3k2r/8/8/8/8/6r1/8/R3K2R w KQkq - 0 1'); u = ucis(); ok(!u.includes('e1g1') && u.includes('e1c1'), 'no castling onto an attacked square (g1)');
  C.setFen('r3k2r/8/8/8/8/1r6/8/R3K2R w KQkq - 0 1'); u = ucis(); ok(u.includes('e1c1'), 'long castle allowed when only b1 is attacked');
  C.setFen('r3k2r/8/8/8/4r3/8/8/R3K2R w KQkq - 0 1'); u = ucis(); ok(!u.includes('e1g1') && !u.includes('e1c1'), 'no castling while in check');
  C.setFen('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1'); ok(!ucis().includes('e1c1') && ucis().includes('e1g1'), 'no long castle with a piece on b1');
  C.setFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'); play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['a1a8']); ok(C.getFen().split(' ')[2] === 'Kk', 'capturing the a8 rook removes q, moving the a1 rook removes Q: ' + C.getFen());
  play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1e2', 'e8e7', 'e2e1', 'e7e8']); ok(C.getFen().split(' ')[2] === '-', 'a king move loses both rights even when it comes back');
  play('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', ['e1g1']); ok(C.getFen().startsWith('r3k2r/8/8/8/8/8/8/R4RK1 b kq'), 'O-O puts the rook on f1');
  ok(C.setFen('r3k2r/8/8/8/8/8/8/R3K1R1 w KQkq - 0 1') && C.getFen().split(' ')[2] === 'Qkq', 'FEN castle rights without the rook on its square are dropped');
}
// --- en passant ---
{
  play(START, ['e2e4', 'a7a6', 'e4e5', 'd7d5']); ok(ucis().includes('e5d6'), 'ep capture right after the double step');
  const L = C.legalMoves(), m = L.find(x => C.moveUci(x) === 'e5d6'); ok(!!(m & C.F_EP) && C.san(m, L) === 'exd6', 'ep flag + SAN exd6');
  C.make(m); ok(C.getFen().startsWith('rnbqkbnr/1pp1pppp/p2P4/8/'), 'ep removes the passed pawn: ' + C.getFen());
  play(START, ['e2e4', 'a7a6', 'e4e5', 'd7d5', 'g1f3', 'h7h6']); ok(!ucis().includes('e5d6'), 'ep expires after one move');
  C.setFen('8/8/8/K1Pp3r/8/8/8/7k w - d6 0 1'); ok(!ucis().includes('c5d6'), 'ep illegal when it exposes the king along the rank');
  play('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1', ['e2e4']); ok(C.getFen().split(' ')[3] === 'e3', 'ep square recorded when a pawn can take: ' + C.getFen());
  play('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', ['e2e4']); ok(C.getFen().split(' ')[3] === '-', 'no ep square when nobody can take (so it does not split repetitions)');
}
// --- promotion ---
{
  C.setFen('1n5k/P7/8/8/8/8/8/K7 w - - 0 1'); const u = ucis();
  ok(['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n', 'a7b8q', 'a7b8r', 'a7b8b', 'a7b8n'].every(x => u.includes(x)) && !u.includes('a7a8'), 'push and capture promotions, all four pieces, no bare a8');
  const L = C.legalMoves(); ok(C.san(L.find(m => C.moveUci(m) === 'a7b8n'), L) === 'axb8=N' && C.san(L.find(m => C.moveUci(m) === 'a7b8q'), L) === 'axb8=Q+', 'promotion SAN (axb8=N, axb8=Q+)');
  play('8/P6k/8/8/8/8/8/K7 w - - 0 1', ['a7a8n']); ok(C.getFen().startsWith('N7/'), 'under-promotion to a knight');
}
// --- SAN disambiguation, check and mate marks, parse ---
{
  C.setFen('k7/8/8/8/8/8/K7/R6R w - - 0 1'); let s = sans(); ok(s.includes('Rad1') && s.includes('Rhd1'), 'file disambiguation');
  C.setFen('R7/8/8/8/8/8/7k/R3K3 w - - 0 1'); s = sans(); ok(s.includes('R1a4') && s.includes('R8a4'), 'rank disambiguation');
  C.setFen('7k/8/8/8/8/Q7/8/Q1Q3K1 w - - 0 1'); s = sans().map(x => x.replace(/[+#]/, '')); ok(s.includes('Qa1b2') && s.includes('Q3b2') && s.includes('Qcb2'), 'square disambiguation (Qa1b2): ' + s.filter(x => /b2/.test(x)));
  C.setFen('k7/8/8/8/8/2N1N3/8/K1N1N3 w - - 0 1'); s = sans(); ok(s.includes('Ncd3') && s.includes('Ned3') && s.includes('N1e2') && s.includes('N3e2'), 'knight disambiguation by file and by rank');
  C.setFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'); s = sans(); ok(s.includes('Ra8#') && s.includes('Ra7'), 'mate mark');
  C.setFen(START); ok(C.parseMove('Nf3') && C.parseMove('e4') && C.parseMove('g1f3') && !C.parseMove('Ke2'), 'parse SAN + UCI, reject illegal');
}
// --- game status: mate, stalemate, threefold, fifty, dead positions ---
{
  play(START, ['f2f3', 'e7e5', 'g2g4', 'd8h4']); ok(C.gameStatus() === 'mate', "fool's mate");
  C.setFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'); ok(C.gameStatus() === 'stalemate', 'stalemate');
  play(START, ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']); ok(C.gameStatus() === '', 'second repetition is not yet a draw');
  C.make(C.findUci('f6g8')); ok(C.gameStatus() === 'threefold', 'third occurrence of the start position is a draw');
  play(START, ['e2e4', 'e7e5', 'e1e2', 'e8e7', 'e2e1', 'e7e8', 'e1e2', 'e8e7', 'e2e1', 'e7e8']); ok(C.gameStatus() === '', 'same placement but castling rights differ: no repetition with the pre-move position');
  play('4k3/8/8/8/8/8/8/R3K3 w - - 99 80', ['a1a2']); ok(C.gameStatus() === 'fifty', '100th quiet half-move: fifty-move draw');
  play('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 80', ['a1a8']); ok(C.gameStatus() === 'mate', 'mate on the 100th half-move stands');
  play('4k3/8/8/8/8/8/4P3/R3K3 w - - 99 80', ['e2e3']); ok(C.gameStatus() === '', 'a pawn move resets the count');
  for (const [fen, dead, why] of [['8/8/4k3/8/8/4K3/8/8 w - - 0 1', true, 'K v K'], ['8/8/4k3/8/8/4KB2/8/8 w - - 0 1', true, 'KB v K'], ['8/8/4k3/8/8/4KN2/8/8 w - - 0 1', true, 'KN v K'],
    ['8/8/2k1b3/8/8/4KB2/8/8 w - - 0 1', true, 'KB v KB, same colour'], ['8/8/2k2b2/8/8/4KB2/8/8 w - - 0 1', false, 'KB v KB, opposite colours'], ['8/8/4k3/8/8/4KNN1/8/8 w - - 0 1', false, 'KNN v K'],
    ['8/8/2k2n2/8/8/4KB2/8/8 w - - 0 1', false, 'KB v KN'], ['8/8/4k3/8/8/4KP2/8/8 w - - 0 1', false, 'KP v K']]) {
    C.setFen(fen); ok((C.gameStatus() === 'material') === dead, 'dead position: ' + why);
  }
  // flag fall: the flagger loses unless the opponent cannot mate by any legal sequence
  for (const [fen, c, can, why] of [['8/8/4k3/8/8/4KN2/8/8 w - - 0 1', 0, false, 'lone knight v bare king'], ['8/8/2k2p2/8/8/4KN2/8/8 w - - 0 1', 0, true, 'lone knight v king + pawn (helpmate exists)'],
    ['8/8/4k3/8/8/4KB2/8/8 w - - 0 1', 0, false, 'lone bishop v bare king'], ['8/8/2k2n2/8/8/4KB2/8/8 w - - 0 1', 0, true, 'bishop v knight'],
    ['8/8/2k1b3/8/8/4KB2/8/8 w - - 0 1', 0, false, 'bishop v same-colour bishop'], ['8/8/2k2b2/8/8/4KB2/8/8 w - - 0 1', 0, true, 'bishop v opposite bishop'],
    ['8/8/4k3/8/8/4KNN1/8/8 w - - 0 1', 0, true, 'two knights'], ['8/8/4k3/8/8/4K3/8/8 w - - 0 1', 0, false, 'bare king'], ['8/8/4k3/8/8/4KP2/8/8 w - - 0 1', 0, true, 'a pawn']]) {
    C.setFen(fen); ok(C.canMate(c) === can, 'canMate: ' + why);
  }
}
// --- AI levels: a legal move from the start, mate in one found from level 2 up, time limits respected ---
{
  for (let lv = 1; lv <= 5; lv++) {
    const t0 = Date.now(), r = C.handleMsg({ id: 1, cmd: 'think', fen: START, moves: ['e2e4'], level: lv }), ms = Date.now() - t0;
    play(START, ['e2e4']); ok(r.move && ucis().includes(r.move) && ms < [0, 600, 800, 1300, 2200, 3800][lv], 'level ' + lv + ' answers with a legal move in time: ' + r.move + ' ' + ms + 'ms');
  }
  const FEN = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
  for (let lv = 3; lv <= 5; lv++) { let hit = 0; for (let i = 0; i < 4; i++) if (C.handleMsg({ id: 1, cmd: 'think', fen: FEN, moves: [], level: lv }).move === 'a1a8') hit++; ok(hit >= 3, 'level ' + lv + ' finds a back-rank mate in one (' + hit + '/4)'); }
}
// --- puzzles: every key move is legal and accepted, a different first move always fails ---
{
  let bad = [];
  for (let i = 0; i < PUZ.length; i++) {
    const [fen, N, , , key] = PUZ[i];
    C.setFen(fen); const L = ucis(); if (!L.includes(key)) { bad.push(i + 1 + ':illegal key'); continue; }
    const r = C.handleMsg({ id: 1, cmd: 'pz', op: 'check', fen, moves: [key], left: N - 1, reset: true, key });
    if (!(N === 1 ? r.mate === true : r.ok === true && r.reply)) bad.push(i + 1 + ':key rejected');
    const alt = L.find(u => u !== key), r2 = C.handleMsg({ id: 1, cmd: 'pz', op: 'check', fen, moves: [alt], left: N - 1, reset: false, key });
    if (r2.ok) bad.push(i + 1 + ':alt accepted');
  }
  ok(bad.length === 0, 'all 100 puzzles: key accepted, other first move fails ' + bad.join(' '));
}
console.log('engine: ' + pass + ' passed, ' + fail + ' failed');

// ================= browser =================
let browser, tid = 1;
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
async function open(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // seed once per context (the flag lives in localStorage: sessionStorage of a file:// page is sometimes empty again after a reload)
  if (o.ls) await ctx.addInitScript(ls => { if (!localStorage.getItem('test.seeded')) { localStorage.clear(); localStorage.setItem('test.seeded', 1); for (const k in ls) localStorage.setItem(k, ls[k]); } }, o.ls);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await page.waitForFunction(() => window.__game);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: tid }] });
  const tap = async (x, y, hold = 40) => { tid++; await touch('touchStart', x, y); await sleep(hold); await touch('touchEnd'); };
  const settle = sel => page.waitForFunction(sel => { const e = document.querySelector(sel), c = e && e.closest('.card'); return !c || c.getAnimations().every(a => a.playState !== 'running'); }, sel, { timeout: 5000 }).catch(() => {});
  const tapSel = async sel => { await settle(sel); await page.locator(sel).first().scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); await sleep(50); const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel); await tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(150); };
  const st = () => page.evaluate(() => window.__game.state());
  const center = q => page.evaluate(q => window.__game.sqCenter(q), q);
  const tapSq = async q => { const c = await center(q); await tap(c.x, c.y); await sleep(60); };
  const dragSq = async (a, b) => { const p = await center(a), q = await center(b); tid++; await touch('touchStart', p.x, p.y); for (let i = 1; i <= 6; i++) { await touch('touchMove', p.x + (q.x - p.x) * i / 6, p.y + (q.y - p.y) * i / 6); await sleep(16); } await touch('touchEnd'); await sleep(60); };
  const humanReady = () => page.waitForFunction(() => { const s = window.__game.state(); return s && !s.busy && !s.over && s.side === s.human; }, null, { timeout: 20000 });
  const vis = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
  const ls = k => page.evaluate(k => { try { return JSON.parse(localStorage.getItem('chess.' + k)); } catch (e) { return 'BAD'; } }, k);
  return { ctx, page, errors, tap, tapSel, st, tapSq, dragSq, humanReady, vis, ls, close: () => ctx.close() };
}
const LV = lv => JSON.stringify({ level: lv, color: 'w', clock: 0 });
async function newAI(s, lv) { await s.tapSel('#tAI'); await s.tapSel('#ngLv button[data-v="' + lv + '"]'); await s.tapSel('#ngColor button[data-v="w"]'); await s.tapSel('#ngGo'); await s.humanReady(); }
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch)');
  try {
    await at('short screens: board squares >= 44px (375x500 used to be 29px), board and tools on screen, nothing overlaps; landscape toast stays small', async () => {
      for (const [w, h, minSq, tier] of [[375, 500, 44, 2], [390, 610, 44, 1], [430, 740, 44, 0], [390, 844, 44, 0], [844, 390, 44, 0]]) {
        const s = await open({ width: w, height: h });
        await newAI(s, 1);
        const g = await s.st(), box = await s.page.evaluate(() => { const r = e => { const b = document.querySelector(e).getBoundingClientRect(); return [b.top, b.bottom, b.left, b.right]; }; return { board: r('#board'), tools: r('#tools'), me: r('#meBar'), opp: r('#oppBar'), toast: r('#toast') }; });
        ok(g.sq >= minSq && g.tier === tier, `${w}x${h}: square ${g.sq}px, tier ${g.tier}`);
        ok(box.board[0] >= 0 && box.board[1] <= h && box.board[2] >= 0 && box.board[3] <= w && box.tools[1] <= h, `${w}x${h}: board + tools inside the viewport ${JSON.stringify(box)}`);
        if (w < h) ok(box.opp[1] <= box.board[0] + 0.5 && box.me[0] >= box.board[1] - 0.5 && box.tools[0] >= box.me[1] - 0.5, `${w}x${h}: bars do not overlap the board`);
        else ok(box.toast[1] - box.toast[0] < 60, `${w}x${h}: landscape toast is one line high (${box.toast[1] - box.toast[0]}px)`);
        if (tier === 2) { await s.tapSel('#tools [data-t="menu"]'); ok(await s.vis('menu'), 'compact: 選單 in the tool row opens the menu'); await s.tapSel('#mResume'); await s.tapSel('#tools [data-t="list"]'); ok(await s.page.evaluate(() => document.getElementById('sheet').classList.contains('open')), 'compact: 棋譜 opens the move list'); }
        ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
      }
    });
    await at('tap-tap and drag moves; taps while the computer thinks are ignored and the UI keeps drawing (Lv5 thinks 3 s in a worker)', async () => {
      const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4'; // not in the opening book: the computer has to search
      const s = await open({ width: 390, height: 844 }, { ls: { 'chess.game': JSON.stringify({ mode: 'ai', startFen: FEN, moves: [], human: 0, level: 5, clock: null, undos: 0, flipped: false }) } });
      await s.tapSel('#tResume'); await s.humanReady();
      await s.tapSq('d2'); ok((await s.st()).sel >= 0, 'tap selects d2'); await s.tapSq('d3');
      let g = await s.st(); ok(g.moves[0] === 'd3' && g.busy, 'tap-tap played d3 and the computer is thinking: ' + g.moves);
      const f0 = g.frames; await s.tapSq('c4'); await s.tapSq('b5'); await s.dragSq('b1', 'c3'); await sleep(600); g = await s.st();
      ok(g.busy && g.moves.length === 1 && g.sel === -1, 'taps and a drag while it thinks did nothing: ' + JSON.stringify([g.busy, g.moves, g.sel]));
      ok(g.frames - f0 > 10, 'frames kept running while it thinks (' + (g.frames - f0) + ')');
      await s.humanReady(); g = await s.st(); ok(g.moves.length === 2, 'computer answered: ' + g.moves);
      const mv = await s.page.evaluate(() => legalMoves().map(moveUci).filter(u => u.length === 4 && bd[sqParse(u.slice(0, 2))] === 2)[0]); // a knight move
      await s.dragSq(mv.slice(0, 2), mv.slice(2, 4)); g = await s.st(); ok(g.moves.length === 3 && /^N/.test(g.moves[2]), 'drag played ' + mv + ': ' + g.moves);
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('promotion: choice of four pieces; under-promotion to a knight; tapping outside cancels', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.page.evaluate(() => { document.getElementById('exImport'); importText('7k/P7/8/8/8/8/8/K7 w - - 0 1'); });
      await sleep(300); await s.tapSq('a7'); await s.tapSq('a8');
      ok(await s.vis('promo'), 'promotion dialog'); ok(await s.page.locator('#promoRow button').count() === 4, 'four choices');
      await s.page.evaluate(() => document.getElementById('promo').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await sleep(100);
      ok(!(await s.vis('promo')) && (await s.st()).moves.length === 0, 'backdrop tap cancels without moving');
      await s.dragSq('a7', 'a8'); ok(await s.vis('promo'), 'drag to the last rank also asks');
      await s.tapSel('#promoRow button[aria-label="馬"]'); const g = await s.st();
      ok(g.moves[0] === 'a8=N' && g.fen.startsWith('N6k/'), 'under-promoted: ' + g.moves + ' ' + g.fen);
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('save after every move, resume after reload; corrupt storage is ignored without errors', async () => {
      const s = await open({ width: 390, height: 844 }); // no seeding init script here: it would run again on the reload
      await newAI(s, 1); await s.tapSq('e2'); await s.tapSq('e4'); await s.humanReady(); await s.tapSq('d2'); await s.tapSq('d4');
      const sv = await s.ls('game'); ok(sv && sv.moves.length >= 3 && sv.moves[0] === 'e2e4', 'saved: ' + (sv && sv.moves));
      await s.humanReady(); const before = (await s.st()).moves;
      await s.page.reload(); await s.page.waitForFunction(() => window.__game && !document.getElementById('tResume').classList.contains('hidden'), null, { timeout: 4000 }).catch(() => {});
      ok(await s.vis('tResume'), 'title offers 繼續對局 ' + s.errors.join(' | ')); await s.tapSel('#tResume'); await s.humanReady();
      ok((await s.st()).moves.join() === before.join(), 'same moves after reload'); ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
      for (const [k, v] of [['chess.game', '{"mode":"ai","startFen":"x","moves":[]}'], ['chess.game', '{"mode":"ai","startFen":"' + START + '","moves":["e2e4"],"level":9,"human":0}'], ['chess.game', '{bad json'],
        ['chess.game', '{"mode":"ai","startFen":"' + START + '","moves":["e2e5"],"level":2,"human":0}']]) {
        const c = await open({ width: 390, height: 844 }, { ls: { [k]: v, 'chess.stats': '{"lv":7,"games":"x"}', 'chess.settings': '{"skin":"lava","sound":"yes"}', 'chess.progress': '{"done":[1,2],"cur":-4}', 'chess.lastOpts': '{"level":0}' } });
        ok(!(await c.vis('tResume')), 'corrupt save not offered: ' + v);
        await c.tapSel('#tStats'); ok(await c.vis('stats'), 'stats open with corrupt stats'); await c.tapSel('#stOk');
        await c.tapSel('#tPuzzle'); ok(await c.vis('select'), 'level select with corrupt progress'); await c.tapSel('#sBack');
        await newAI(c, 2); await c.tapSq('e2'); await c.tapSq('e4'); await c.humanReady();
        ok(c.errors.length === 0, 'errors: ' + c.errors.join(' | ')); await c.close();
      }
    });
    await at('a win is recorded once: 悔棋 after mating and mating again does not count twice; undo is off before your first move', async () => {
      const save = JSON.stringify({ mode: 'ai', startFen: START, moves: ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6'], human: 0, level: 1, clock: null, undos: 0, flipped: false });
      const s = await open({ width: 390, height: 844 }, { ls: { 'chess.game': save } });
      await s.tapSel('#tResume'); await s.humanReady();
      await s.tapSq('h5'); await s.tapSq('f7'); await s.page.waitForFunction(() => window.__game.state().result, null, { timeout: 5000 });
      let st = await s.page.evaluate(() => window.__game.stats()); ok(st.lv[1] && st.lv[1].w === 1 && st.games === 1, 'win recorded: ' + JSON.stringify(st.lv));
      await s.tapSel('#rReview'); await s.tapSel('#tools [data-t="undo"]'); await s.humanReady();
      await s.tapSq('h5'); await s.tapSq('f7'); await s.page.waitForFunction(() => window.__game.state().result, null, { timeout: 5000 });
      st = await s.page.evaluate(() => window.__game.stats()); ok(st.lv[1].w === 1 && st.games === 1, 'still one win after undo + mate again: ' + JSON.stringify(st.lv));
      // playing black: before your first move 悔棋 is off
      await s.page.evaluate(() => { lastOpts = { level: 1, color: 'b', clock: 0 }; startGame('ai', lastOpts); }); await s.humanReady();
      ok(await s.page.evaluate(() => document.querySelector('#tools [data-t="undo"]').disabled), '悔棋 disabled before the human has moved');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('starting a new game over an unfinished computer game asks first and records a loss', async () => {
      const s = await open({ width: 390, height: 844 }, { ls: { 'chess.lastOpts': LV(1) } });
      await newAI(s, 1); await s.tapSq('e2'); await s.tapSq('e4'); await s.humanReady();
      await s.tapSel('#bMenu'); await s.tapSel('#mNew'); await s.tapSel('#ngGo');
      ok(await s.vis('confirm'), 'confirm shown'); await s.tapSel('#cNo'); ok((await s.st()).moves.length >= 2, 'cancel keeps the game');
      await s.tapSel('#ngGo'); await s.tapSel('#cYes'); await s.humanReady();
      const st = await s.page.evaluate(() => window.__game.stats()); ok(st.lv[1] && st.lv[1].l === 1 && (await s.st()).moves.length === 0, 'loss recorded and a fresh game started: ' + JSON.stringify(st.lv));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('puzzles: a stale fail screen never lands on the restarted puzzle; a puzzle in progress survives a reload (tries kept)', async () => {
      const s = await open({ width: 390, height: 844 }); // (puzzle 21 has no theme intro; no seeding script, which would run again on the reload)
      await s.page.evaluate(() => startPuzzle(21)); await sleep(200);
      const [fen, , , , key] = PUZ[20]; C.setFen(fen); const wrong = ucis().find(u => u !== key && u[4] === undefined);
      await s.tapSq(wrong.slice(0, 2)); await s.tapSq(wrong.slice(2, 4));
      await s.page.waitForFunction(() => window.__game.state().over, null, { timeout: 8000 });
      await s.page.evaluate(() => restartPuzzle()); await sleep(1100);
      ok(!(await s.vis('result')) && !(await s.st()).over, 'no fail screen over the restarted puzzle');
      await s.tapSq(key.slice(0, 2)); await s.tapSq(key.slice(2, 4));
      await s.page.waitForFunction(() => { const g = window.__game.state(); return g.k === 1 && !g.busy && g.moves.length === 2; }, null, { timeout: 8000 });
      const before = await s.st(); await s.page.reload(); await s.page.waitForFunction(() => window.__game && !document.getElementById('tResumePz').classList.contains('hidden'), null, { timeout: 4000 }).catch(() => {});
      ok(await s.vis('tResumePz') && /21/.test(await s.page.textContent('#tResumePz')), 'title offers the puzzle');
      await s.tapSel('#tResumePz'); const g = await s.st();
      ok(g.n === 21 && g.k === 1 && g.moves.join() === before.moves.join() && g.tries === 2, 'resumed mid-puzzle: ' + JSON.stringify([g.n, g.k, g.moves, g.tries]));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('board coordinates readable on every skin (>= 3:1)', async () => {
      const s = await open({ width: 390, height: 844 }); const c = await s.page.evaluate(() => window.__game.contrast());
      ok(Object.values(c).every(x => x >= 3), 'contrast ' + JSON.stringify(c)); await s.close();
    });
  } finally { await browser.close(); }
}
(async () => {
  if (!process.argv.includes('--no-browser')) await browserTests();
  console.log((fail ? 'FAIL ' : '') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
