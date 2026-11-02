// Rule unit tests for 五子棋 (apps/gomoku) using the game's own core (extracted between CORE markers).
// Covers: win detection per rule (自由 / 標準 / 連珠), overline handling, renju forbidden moves (三三, 四四, 長連, recursive
// live-three judgement, five priority) with 30 forbidden-move positions, legality per colour, and threat helpers.
// Then one in-page regression check per release-review finding (Playwright Chromium, real CDP touch).
// Usage: node tests.js [path/to/index.html] [--no-browser]
const fs = require('fs'), path = require('path');
const FILE = process.argv.slice(2).find(a => !a.startsWith('--')) || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(FILE, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + ';return {setup,clearBoard,play,B,legal,isFive,winLine,isForbidden,forbiddenAt,fivePts,wPts,threatMoves,fourMoves,tsFind,tsMinN,moveThreat,AI_LV,get SZ(){return SZ}};')();
const HTML = fs.readFileSync(FILE, 'utf8');
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
// rows: 'X' black, 'O' white, '?' test point (empty), '.' empty. Placed with top-left at (ox, oy) on a 15x15 board.
function setPos(rule, rows, ox = 3, oy = 3) {
  C.setup(15, rule); let q = -1;
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    const p = (y + oy) * 15 + x + ox;
    if (ch === 'X') C.play(p, 1); else if (ch === 'O') C.play(p, 2); else if (ch === '?') q = p;
  }));
  return q;
}
// ---- 30 renju forbidden-move cases: [name, rows, expectForbidden] ----
const F = [
  ['三三 basic (horizontal + vertical live threes)', ['.........', '.........', '....X....', '....X....', '..XX?....', '.........', '.........'], true],
  ['三三 broken by adjacent white (one three closed)', ['....O....', '....X....', '....X....', '..XX?....', '.........'], false],
  ['四四 two lines (open four + four)', ['.........', '....X....', '....X....', '....X....', '.XXX?....', '.........'], true],
  ['四四 in one line X.X?X.X', ['.........', 'X.X?X.X..', '.........'], true],
  ['長連 overline XXX?XX', ['.........', 'XXX?XX...', '.........'], true],
  ['五連優先: exact five is a win', ['.........', '.XXXX?...', '.........'], false],
  ['五連優先 over 四四 (five + four in other line)', ['.....X...', '.....X...', '.....X...', '.XXXX?...', '.........'], false],
  ['五連優先 over 長連 in another line', ['.....X...', '.....X...', '.....X...', '.XXXX?...', '.....X...', '.....X...', '.........'], false],
  ['偽三: horizontal three whose only straight-four point is an overline point -> not 三三',
    ['.........', '......X..', '......X..', '.....XX..', 'X..XX?...', '......X..', '......X..', '.........'], false],
  ['control for 偽三 case: same without the overline column -> real 三三',
    ['.........', '.........', '.........', '.....X...', 'X..XX?...', '.....X...', '.........', '.........'], true],
  ['三三 with split three X.X? (horizontal) + vertical', ['.........', '....X....', '....X....', '.X.X?....', '.........', '.........'], true],
  ['三三 not formed: one three is closed OXX?', ['.........', '....X....', '....X....', 'OXX?.....'.replace('OXX?', 'OXX?'), '.........'], false],
  ['四三 is allowed', ['.........', '....X....', '....X....', '....X....', '..XX?....', '.........', '.........'], false],
  ['三三三 (three live threes)', ['.......', '.X.X...', '..XX...', '.XX?...', '.......', '.......'], true],
  ['four whose only five point is an overline is not a four -> single four, allowed',
    ['.........', '.....X...', '.....X...', '.....X...', 'XX.XX?...', '.........'], false],
  ['control: X.XXX? + vertical four -> 四四', ['.........', '.....X...', '.....X...', '.....X...', '.X.XX?...', '.........'], true],
  ['edge three (board edge closes it) + live three -> allowed', null, false],
  ['dead three O.XXX.O + live three -> allowed', ['.........', '....X....', '....X....', 'O.?XX.O..', '.........', '.........'], false],
  ['O..XXX..O is live + vertical three -> 三三', ['..........', '...X......', '...X......', 'O..?XX..O.', '..........', '..........'], true],
  ['四四 vertical + anti-diagonal', ['.........', '.........', '......?..', '.....XX..', '....X.X..', '...X..X..', '.........'], true],
  ['五連優先 over 三三', ['.........', '....X....', '....X....', '..XX?XX..', '.........', '.........'], false],
  ['三三 diagonal + anti-diagonal', ['.........', '..X...X..', '...X.X...', '....?....', '.........', '.........', '.........'], true],
  ['white stone in the gap breaks the three (XOX?) + vertical three -> allowed', ['.........', '....X....', '....X....', '.XOX?....', '.........'], false],
  ['四四 with a closed four (OXXX?) + vertical four', ['.........', '....X....', '....X....', '....X....', 'OXXX?....', '.........'], true],
  ['偽三 via 四四 at the extension point -> allowed',
    ['.........', '......X..', '......X..', '.....XX..', 'X..XX?...', '.........', '.........'], false],
  ['single live three only -> allowed', ['.........', '.........', '..XX?....', '.........'], false],
  ['long gap X..X? is not a three -> with vertical three allowed', ['.........', '....X....', '....X....', 'X..X?....', '.........', '.........'], false],
  ['split three XX.? (gap) + vertical split three -> 三三', ['....X....', '.........', '....X....', '.XX.?....', '.........', '.........'], true],
  ['overline in diagonal', ['X........', '.X.......', '..X......', '...?.....', '....X....', '.....X...', '.........'], true],
  ['two closed fours in different lines (OXXX? + vertical XXXO) -> 四四', ['....O....', '....X....', '....X....', '....X....', 'OXXX?....', '.........'], true],
];
// fix up special cases
F[16][1] = 'edge';
for (const [name, rows, exp] of F) {
  let q;
  if (rows === 'edge') { // three against the left edge: ?XX at x=0..2 (closed by edge) + vertical live three at x=0
    C.setup(15, 2); const y = 7; C.play(y * 15 + 1, 1); C.play(y * 15 + 2, 1); C.play((y - 1) * 15 + 0, 1); C.play((y - 2) * 15 + 0, 1); q = y * 15 + 0;
  } else q = setPos(2, rows);
  const got = C.isForbidden(q);
  ok(got === exp, 'forbidden: ' + name + ' expected ' + exp + ' got ' + got);
}
console.log('forbidden cases:', F.length);
// the same 三三 point is legal under 自由 / 標準 rules and for white
{ const rows = F[0][1]; let q = setPos(0, rows); ok(!C.isForbidden(q) && C.legal(q, 1), 'free rule: no forbidden');
  q = setPos(1, rows); ok(!C.isForbidden(q) && C.legal(q, 1), 'standard rule: no forbidden');
  q = setPos(2, rows); ok(!C.legal(q, 1), 'renju: black 三三 illegal'); }
{ // white may make 三三 in renju
  const q = setPos(2, F[0][1].map(r => r.replace(/X/g, 'O'))); ok(C.legal(q, 2), 'renju: white 三三 legal'); }
// ---- win detection per rule ----
function lineRule(rule, row, col) { const q = setPos(rule, ['.', row]); return { q, five: C.isFive(q, col) }; }
ok(lineRule(0, 'XXXX?', 1).five, 'free: black five');
ok(lineRule(0, 'XXX?XX', 1).five, 'free: black overline wins');
ok(lineRule(0, 'OOO?OO', 2).five, 'free: white overline wins');
ok(lineRule(1, 'XXXX?', 1).five, 'standard: black five');
ok(!lineRule(1, 'XXX?XX', 1).five, 'standard: black overline does not win');
ok(!lineRule(1, 'OOO?OO', 2).five, 'standard: white overline does not win');
ok(lineRule(1, 'OO?OO', 2).five, 'standard: white exact five');
ok(lineRule(2, 'XXXX?', 1).five, 'renju: black exact five');
ok(!lineRule(2, 'XXX?XX', 1).five, 'renju: black overline is not five');
ok(lineRule(2, 'OOO?OO', 2).five, 'renju: white overline wins');
ok(!lineRule(0, 'XXX?.', 1).five, 'four is not five');
{ const q = setPos(2, ['.', 'XXX?XX']); ok(C.isForbidden(q) && !C.legal(q, 1), 'renju: black overline forbidden'); }
{ const q = setPos(1, ['.', 'XXX?XX']); ok(!C.isForbidden(q) && C.legal(q, 1), 'standard: overline legal but no win'); }
// winLine returns exactly the five stones
{ setPos(0, ['.', 'XXXXX']); const L = C.winLine(4 * 15 + 3); ok(L && L.length === 5, 'winLine length 5'); }
{ setPos(2, ['.', 'XXXXXX']); ok(!C.winLine(4 * 15 + 3), 'renju: winLine none for black overline'); }
{ setPos(2, ['.', 'OOOOOO']); const L = C.winLine(4 * 15 + 3); ok(L && L.length === 6, 'renju: white overline line'); }
// diagonal / anti-diagonal wins
{ C.setup(15, 0); for (let i = 0; i < 5; i++) C.play((2 + i) * 15 + 2 + i, 2); ok(!!C.winLine(4 * 15 + 4), 'diagonal five'); }
{ C.setup(15, 0); for (let i = 0; i < 5; i++) C.play((10 - i) * 15 + 2 + i, 1); ok(!!C.winLine(8 * 15 + 4), 'anti-diagonal five'); }
// edges / other sizes
{ C.setup(9, 0); for (let i = 0; i < 5; i++) C.play(8 * 9 + 4 + i, 1); ok(!!C.winLine(8 * 9 + 8), '9x9 edge five'); }
{ C.setup(19, 2); for (let i = 0; i < 5; i++) C.play(18 * 19 + i, 1); ok(!!C.winLine(18 * 19), '19x19 corner five (renju black)'); }
// ---- threat helpers ----
{ setPos(0, ['.', '.XXXX.']); ok(C.fivePts(1).length === 2, 'open four has 2 five points'); }
{ setPos(0, ['.', 'OXXXX.']); ok(C.fivePts(1).length === 1, 'closed four has 1 five point'); }
{ setPos(0, ['.', '..XXX..']); ok(C.wPts(1).length === 2, 'open three has 2 open-four points'); }
{ setPos(2, ['.', '..XXX..', '.']); const fourBlocked = C.fivePts(1).length; ok(fourBlocked === 0, 'renju: three has no five point'); }
{ // renju: white four whose block point is forbidden for black -> black cannot block (white wins)
  // block point (?) is a black 三三 point
  const q = setPos(2, ['.........', '....X.X...', '....XX....', '....?OOOOX', '.........']);
  ok(C.fivePts(2).indexOf(q) >= 0 && !C.legal(q, 1), 'renju: forbidden block point');
  ok(C.tsFind(2, 1, false) === q, 'white wins by playing the five point'); }
{ // VCF search: black has a simple 4-3 win (needs 3 moves: 4-3 point, then open four, then five)
  setPos(0, ['.........', '.........', '..XX.....', '.........', '....X....', '....X....', '.........']);
  const n = C.tsMinN(1, 4, false); ok(n === 3, 'four-three wins in 3 (got ' + n + ')'); }
{ // a lone open three wins in 2 (open four, five)
  setPos(0, ['.', '..XXX..']); ok(C.tsMinN(1, 3, false) === 2, 'open three -> win in 2'); }
{ // defender with a four must be answered first (先擋再攻)
  setPos(0, ['..........', '..XXX.....', '..........', '.OOOO.....']); // white four (two five points? .OOOO. open) -> black loses
  ok(C.tsMinN(1, 3, false) === 0, 'cannot win while opponent has an open four'); }
// ---- release review 2026-11-02 (score.json toFix) ----
// [3] AI ladder: 入門 stronger than 初學, 中級 a little weaker than before (smoother 入門→中級 step)
ok(C.AI_LV[2].err === 0.15 && C.AI_LV[2].blind === 0.10 && C.AI_LV[3].err === 0.12 && C.AI_LV[1].err > C.AI_LV[2].err && C.AI_LV[3].err > C.AI_LV[4].err, 'AI ladder: L2 err 0.15 blind 0.10, L3 err 0.12');
// [5] the puzzle failure reason looks at THIS move: a lone stone is no threat, a move making a four / open three is
{ setPos(0, ['.', '..XX...']); const q = 4 * 15 + 3 + 4; C.play(q, 1); ok(C.moveThreat(q, 1), 'moveThreat: move making an open three');
  const far = 14 * 15; C.play(far, 1); ok(!C.moveThreat(far, 1), 'moveThreat: a1 far away is not a threat even with an open three on the board'); }
{ setPos(0, ['.', 'OXXX....']); const q = 4 * 15 + 3 + 4; C.play(q, 1); ok(C.moveThreat(q, 1), 'moveThreat: closed four'); }
// [6] light-theme preview crosshair is dark enough on the wood
ok(/'rgba\(125,28,8,0\.8\)'/.test(HTML) && !/rgba\(150,40,20,0\.45\)/.test(HTML), 'light preview crosshair darkened');
console.log('core tests passed', pass, 'failed', fail);

// ---------------- in the real page (mobile Chromium, real CDP touch): one regression check per review finding ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PZ = new Function(HTML.match(/var PUZZLES = \[[\s\S]*?\n\];/)[0] + ';return PUZZLES;')();
const dec = s => { const o = []; for (let i = 0; i + 1 < s.length; i += 2) o.push((s.charCodeAt(i + 1) - 97) * 15 + (s.charCodeAt(i) - 97)); return o; };
{ // level 1: a1 sits 4 points from an open-four point that was already there -> still "no threat"
  const P = PZ[0]; C.setup(15, P[4]); dec(P[0]).forEach(q => C.play(q, 1)); dec(P[1]).forEach(q => C.play(q, 2)); C.play(210, P[2]);
  ok(!C.moveThreat(210, P[2]), 'moveThreat: level 1 a1 (existing threat on its diagonal) is not this move\'s threat'); }
let browser = null, tid = 1;
async function at(name, fn) { if (process.env.ONLY && !name.includes(process.env.ONLY)) return; const t0 = Date.now(); let tm; try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); } catch (e) { clearTimeout(tm); fail++; console.log('  FAIL', name, '-', String(e.message || e).split('\n')[0]); } }
async function open(vp, seed = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: 'light' });
  // seed once per context (a marker in localStorage, not sessionStorage, which a reload under load can lose)
  await ctx.addInitScript(seed => { if (!localStorage.getItem('test.seeded')) { localStorage.clear(); localStorage.setItem('test.seeded', '1'); for (const k in seed) localStorage.setItem('gomoku.' + k, JSON.stringify(seed[k])); } }, seed);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + FILE);
  const cdp = await ctx.newCDPSession(page);
  const tap = async (x, y) => { const id = tid++; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const tapSel = async sel => { await page.waitForSelector(sel, { state: 'visible' }).catch(e => { throw new Error('waiting for ' + sel + ': ' + e.message.split('\n')[0]); }); const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
  const gs = () => page.evaluate(() => __gomoku.state());
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 45000, polling: 50 });
  const place = async p => { const c = await page.evaluate(p => __gomoku.cellXY(p), p); await tap(c.x, c.y); await until(p => __gomoku.state().preview === p, p); await tap(c.x, c.y); };
  const ls = k => page.evaluate(k => JSON.parse(localStorage.getItem('gomoku.' + k)), k);
  return { ctx, page, errors, tap, tapSel, gs, until, place, ls, close: () => ctx.close() };
}
const P390 = { width: 390, height: 844 };
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch)');
  try {
    // black four on row 8 (b..e), white stones in the corners: black (the human) wins at f8 / a8
    const four = [[7 * 15 + 1, 1], [0, 2], [7 * 15 + 2, 1], [14, 2], [7 * 15 + 3, 1], [210, 2], [7 * 15 + 4, 1], [224, 2]];
    const game = assist => Object.assign({ mode: 'ai', size: 15, rule: 0, lv: 1, human: 1, moves: four, swap: false, swapDone: false, swapped: false, tengen: true, clock: [0, 0, 0], recorded: false }, assist == null ? {} : { assist });
    await at('[3] win after hint/undo = 輔助勝: no win, streak or 初勝; old save (no assist key) still a normal win', async () => {
      let s = await open(P390, { game: game(true) });
      await s.tapSel('#tResume'); await s.until(() => __gomoku.state().mode === 'ai');
      await s.place(7 * 15 + 5); await s.until(() => !document.querySelector('#ovResult').classList.contains('hidden'));
      let st = await s.ls('stats'), ach = await s.ls('ach') || {};
      ok(st.aWins === 1 && st.wins === 0 && st.streak === 0 && st.lv[1].a === 1 && st.lv[1].w === 0 && !ach.first, 'assisted win stats ' + JSON.stringify(st) + ' ach ' + Object.keys(ach));
      ok(/輔助/.test(await s.page.textContent('#rTitle')), 'result card says 輔助');
      ok(!s.errors.length, 'errors ' + s.errors); await s.close();
      s = await open(P390, { game: game(null) });
      await s.tapSel('#tResume'); await s.until(() => __gomoku.state().mode === 'ai');
      await s.place(7 * 15 + 5); await s.until(() => !document.querySelector('#ovResult').classList.contains('hidden'));
      st = await s.ls('stats'); ach = await s.ls('ach') || {};
      ok(st.wins === 1 && st.streak === 1 && !st.aWins && !!ach.first, 'old-format save: normal win ' + JSON.stringify(st));
      await s.close();
      // tapping 提示 marks the running game (and its save) as assisted
      s = await open(P390, { game: game(null) });
      await s.tapSel('#tResume'); await s.until(() => __gomoku.state().mode === 'ai');
      await s.tapSel('#bHint'); await s.until(() => !/計算/.test(document.querySelector('#stTxt').textContent));
      ok((await s.ls('game')).assist === true, 'hint marks saved game assisted');
      ok(!s.errors.length, 'errors ' + s.errors); await s.close();
    });
    await at('[4] 每日殘局 comes from the player range (fresh: 1-15; 40 solved: <= 50) and stays fixed for the day', async () => {
      let s = await open(P390);
      let t = await s.page.textContent('#tDaily'), n = +/第 (\d+) 關/.exec(t)[1];
      ok(n >= 1 && n <= 15, 'fresh player daily level ' + n);
      await s.page.reload(); ok((await s.page.textContent('#tDaily')) === t, 'daily level stable after reload'); await s.close();
      const done = {}; for (let i = 1; i <= 40; i++) done[i] = 1;
      s = await open(P390, { progress: { done, cur: 41 } });
      n = +/第 (\d+) 關/.exec(await s.page.textContent('#tDaily'))[1]; ok(n >= 1 && n <= 50, '40 solved: daily level ' + n); await s.close();
    });
    await at('[4] level tiles show ★ for levels cleared without hints', async () => {
      const s = await open(P390, { progress: { done: { 1: 2, 2: 1 }, cur: 3 } });
      await s.tapSel('#tPz'); await s.page.waitForSelector('.lt[data-n="1"]');
      ok(await s.page.$eval('.lt[data-n="1"]', b => b.classList.contains('star')), 'level 1 has a star');
      ok(!(await s.page.$eval('.lt[data-n="2"]', b => b.classList.contains('star'))), 'level 2 (hint used) has no star');
      ok(/★ 1/.test(await s.page.textContent('#selSum')), 'summary counts stars'); await s.close();
    });
    await at('[5] puzzle failure reason: a move with no four/three says so (level 1, a1)', async () => {
      const s = await open(P390, { seenIntro: { 1: 1 } });
      await s.tapSel('#tPz'); await s.tapSel('.lt[data-n="1"]'); await s.until(() => __gomoku.state().mode === 'pz');
      await s.place(210); await s.until(() => !document.querySelector('#ovPzFail').classList.contains('hidden'));
      const m = await s.page.textContent('#pfMsg'); ok(/沒有形成衝四或活三/.test(m), 'reason: ' + m);
      ok(!s.errors.length, 'errors ' + s.errors); await s.close();
    });
    await at('[1] a puzzle left mid-way continues after a reload (moves + hint count kept)', async () => {
      const P = PZ[15], n = 16; // 四三, 3 moves
      C.setup(15, P[4]); dec(P[0]).forEach(q => C.play(q, 1)); dec(P[1]).forEach(q => C.play(q, 2));
      const first = C.tsFind(P[2], P[3], false);
      const s = await open(P390, { seenIntro: { 1: 1, 16: 1 }, unlockAll: true });
      await s.tapSel('#tPz'); await s.tapSel('.lt[data-n="16"]'); await s.until(n => __gomoku.state().mode === 'pz' && __gomoku.state().pz.n === n, n);
      await s.place(first); await s.until(() => { const g = __gomoku.state(); return g.moves.length === 2 && !g.thinking && !g.over; });
      const before = await s.ls('pzGame');
      // Chromium hands localStorage writes to the browser process in batches; under heavy load a reload can come first.
      // Wait until a second tab of the same origin sees the save (a real condition, not a sleep), then reload.
      { const p2 = await s.ctx.newPage(); await p2.goto('file://' + FILE); await p2.waitForFunction(() => !!localStorage.getItem('gomoku.pzGame'), null, { timeout: 30000, polling: 50 }); await p2.close(); }
      await s.page.reload(); await s.page.waitForSelector('#tResume', { state: 'visible' }).catch(async e => { throw new Error('no resume button, before=' + JSON.stringify(before) + ' pzGame=' + JSON.stringify(await s.ls('pzGame')) + ' screen=' + await s.page.evaluate(() => [...document.querySelectorAll('.scr')].filter(x => !x.classList.contains('hidden')).map(x => x.id))); });
      ok(/第 16 關/.test(await s.page.textContent('#tResume')), 'title offers to continue level 16');
      await s.tapSel('#tResume'); await s.until(() => __gomoku.state().mode === 'pz');
      const g = await s.gs(); ok(g.pz.n === 16 && g.moves.length === 2 && g.pz.left === P[3] - 1 && g.moves[0][0] === first, 'resumed ' + JSON.stringify([g.pz, g.moves]));
      ok(!s.errors.length, 'errors ' + s.errors); await s.close();
    });
    await at('[7] landscape board size does not depend on the start orientation; status text not cut', async () => {
      const L = { width: 844, height: 390 }, s = await open(L);
      await s.tapSel('#tPvp'); await s.tapSel('#nGo'); await s.until(() => __gomoku.state().mode === 'pvp');
      const w0 = await s.page.$eval('#cv', c => c.getBoundingClientRect().width);
      const frames = () => s.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      await s.page.setViewportSize(P390); await frames(); await s.page.setViewportSize(L); await frames();
      const w1 = await s.page.$eval('#cv', c => c.getBoundingClientRect().width);
      ok(w0 >= 340 && Math.abs(w0 - w1) <= 2, 'board ' + w0 + ' direct vs ' + w1 + ' after rotation');
      const c = await s.page.evaluate(() => __gomoku.cellXY(128)); await s.tap(c.x, c.y); await s.until(() => __gomoku.state().preview === 128);
      const cut = await s.page.$eval('#stTxt', e => [e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1, e.textContent]);
      ok(!cut[0], 'status text fits: ' + cut[1]);
      ok(!s.errors.length, 'errors ' + s.errors); await s.close();
    });
    await at('[7] narrow landscape (667x375, 568x320) puzzle 76 + a1 preview: side column readable, nothing overlaps; 844x390 keeps the big board', async () => {
      for (const [w, h, minBoard] of [[667, 375, 300], [568, 320, 220], [844, 390, 370]]) {
        const s = await open({ width: w, height: h }, { unlockAll: true, seenIntro: { 76: 1 } });
        await s.tapSel('#tPz'); await s.tapSel('.lt[data-n="76"]'); await s.until(() => __gomoku.state().mode === 'pz' && __gomoku.state().pz.n === 76);
        const c = await s.page.evaluate(() => __gomoku.cellXY(210)); await s.tap(c.x, c.y); await s.until(() => __gomoku.state().preview === 210);
        const r = await s.page.evaluate(() => {
          const q = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
          const st = document.querySelector('#stTxt');
          return { cv: q('#cv'), top: q('.top'), tools: q('#tools'), mid: q('.pzmid'), title: q('#pzTitle'), left: q('.pzmid .left'), pips: q('#pzPips'), st: q('#stTxt'),
            stCut: st.scrollHeight > st.clientHeight + 1, sw: document.documentElement.scrollWidth };
        });
        const tag = w + 'x' + h + ': ';
        const sep = (a, b) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
        ok(r.cv.w >= minBoard, tag + 'board ' + r.cv.w + ' >= ' + minBoard);
        ok(r.sw <= w, tag + 'no horizontal scroll ' + r.sw);
        ok(r.top.r <= r.cv.l && r.cv.r <= r.tools.l, tag + 'board clear of side columns');
        ok(sep(r.title, r.left), tag + '第 76 關 does not overlap 剩餘');
        for (const k of ['title', 'left', 'pips']) ok(r[k].l >= r.mid.l - 0.5 && r[k].r <= r.mid.r + 0.5 && r[k].b <= r.mid.b + 0.5, tag + k + ' inside the puzzle bar');
        ok(r.st.w >= 120 && !r.stCut, tag + 'status line ' + Math.round(r.st.w) + 'px wide, not cut');
        ok(!s.errors.length, tag + 'errors ' + s.errors); await s.close();
      }
    });
    await at('[5] a first-time player vs the computer starts on 自由規則 (no 三三 forbidden moves)', async () => {
      const s = await open(P390); await s.tapSel('#tAI'); await s.page.waitForSelector('#ovNew:not(.hidden)');
      ok(await s.page.$eval('#segRule button[data-v="0"]', b => b.getAttribute('aria-pressed') === 'true'), 'free rule preselected'); await s.close();
      const s2 = await open(P390, { lastOpts: { rule: 2 } }); await s2.tapSel('#tAI'); await s2.page.waitForSelector('#ovNew:not(.hidden)');
      ok(await s2.page.$eval('#segRule button[data-v="2"]', b => b.getAttribute('aria-pressed') === 'true'), 'saved rule choice kept'); await s2.close();
    });
  } finally { await browser.close(); }
}
(process.argv.includes('--no-browser') ? Promise.resolve() : browserTests()).catch(e => { fail++; console.log('FAIL browser', e.message); }).then(() => {
  console.log('tests passed', pass, 'failed', fail);
  process.exit(fail ? 1 : 0);
});
