// Regression tests for 糖果連連看 (link-match), one per release-review finding where practical.
// Node part: the game's own core (CORE-START..CORE-END of ../index.html). Browser part: the real page in headless
// Chromium with real CDP touch events (one browser, contexts in turn). Waits are on page conditions, not fixed sleeps.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), URL = 'file://' + APP;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const ATT = JSON.parse(html.match(/var ATT = (\[[^\]]*\]);/)[1]);
const ALT = JSON.parse(html.match(/var ALT = (\[[\s\S]*?\]\]);/)[1]);
const C = new Function(coreSrc + '\nreturn {levelParams, timeBoost, genLevel, listMoves, solve, mkRng, ROT_EVERY};')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };
const T0 = Date.now();

// ---------- Node: timing curve and replay layouts ----------
const base = L => Math.round(C.levelParams(L).pairs * 3.6 * Math.pow(0.985, L));
ok([1, 2, 5, 9, 10].every(L => C.levelParams(L).ppt >= 5), 'levels 1-10 give at least 5 s per pair');
ok(C.levelParams(11).ppt < C.levelParams(10).ppt && C.levelParams(20).ppt > 3.6 * Math.pow(0.985, 20), 'extra time tapers off over levels 11-20');
ok([30, 31, 32, 33].every(L => C.levelParams(L).time >= base(L) * 1.15), 'gravity levels 30-33 get >= 15% more time');
ok([76, 77, 78, 79, 80].every(L => C.levelParams(L).time >= base(L) * 1.19), 'levels 76-80 (board 9x14 -> 10x16) get x1.2 time');
let dUp = true; for (let L = 2; L <= 100; L++) if (!(C.levelParams(L).D > C.levelParams(L - 1).D)) dUp = false;
ok(dUp, 'difficulty index D still strictly increasing');
ok(ALT.length === 100 && ALT.every(a => a.length === 2), 'two extra layouts listed for every level');
let altOk = true, altDiff = true;
for (const L of [1, 15, 30, 60, 80, 100]) for (const a of ALT[L - 1]) {
  const r = C.genLevel(L, 0, a, false), P = r.P;
  if (r.att !== a || !C.listMoves(r.g, P.W2, P.H2, true).length || r.g.filter(c => c & 32).length !== P.ice) altOk = false;
  if (r.g.join() === C.genLevel(L, 0, ATT[L - 1], false).g.join()) altDiff = false;
}
ok(altOk, 'replay layouts regenerate exactly, with the level\'s ice count and an opening move (sample; demo/solve.js checks all)');
ok(altDiff, 'replay layouts differ from the first layout');

// ---------- browser ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function until(page, fn, arg, ms = 15000) { await page.waitForFunction(fn, arg, { timeout: ms, polling: 20 }); }
async function tapSel(cdp, page, sel) { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
const st = page => page.evaluate(() => window.__game.state());
async function setup(browser, w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (opts.clock) await page.clock.install();
  await page.goto(URL);
  if (opts.ls) { await page.evaluate(ls => { for (const k in ls) localStorage.setItem(k, ls[k]); }, opts.ls); await page.reload(); }
  await until(page, () => window.__game && window.__game.state().screen === 'title');
  return { ctx, page, cdp: await ctx.newCDPSession(page), errors };
}
async function openLevel(cdp, page, L) {
  await tapSel(cdp, page, '#tSelect'); await until(page, () => !document.getElementById('select').classList.contains('hidden'));
  await tapSel(cdp, page, '.lt[data-n="' + L + '"]');
  await until(page, L => { const s = window.__game.state(); return s.L === L && s.status === 'play'; }, L);
  if (await page.isVisible('#iOk')) { await tapSel(cdp, page, '#iOk'); await until(page, () => window.__game.state().screen === 'play'); }
}
// one solver move via real touches; resolves once the move has been applied
async function playMove(cdp, page) {
  await until(page, () => !!window.__game.plan());
  const before = (await st(page)).moves, p = await page.evaluate(() => window.__game.plan());
  for (const q of p) await touch(cdp, q[0], q[1]);
  await until(page, n => window.__game.state().moves > n, before);
}
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.width && a.y < b.y + b.h && b.y < a.y + a.height;

(async () => {
  const browser = await chromium.launch();
  try {
    // ===== 390x844: old save keys, misses, 2-turn message, HUD feedback, clear saved at once, replay layouts =====
    {
      const { ctx, page, cdp, errors } = await setup(browser, 390, 844, { ls: { 'linkmatch.progress': JSON.stringify({ stars: { 1: 1, 2: 2, 3: 1 }, best: { 1: 120 }, max: 3 }), 'linkmatch.settings': JSON.stringify({ mute: true, cb: false, zen: false }) } });
      await tapSel(cdp, page, '#tSelect'); await until(page, () => !document.getElementById('select').classList.contains('hidden'));
      ok(/已通過 3 \/ 100/.test(await page.textContent('#selSum')), 'progress saved under the old key still loads');
      await tapSel(cdp, page, '#sBack'); await until(page, () => window.__game.state().screen === 'title');
      await openLevel(cdp, page, 1);
      let s = await st(page);
      ok(s.variant === 0 && s.board === C.genLevel(1, 0, ATT[0], false).g.join(), 'first play of a level deals the original layout');
      const firstBoard = s.board;
      await until(page, () => !window.__game.state().busy);
      // a miss beside the board keeps the selection; a near miss snaps onto the closest tile
      const R = await page.evaluate(() => window.__game.rect()), cell = s.cell, W2 = C.levelParams(1).W2;
      const c11 = W2 + 1, p11 = await page.evaluate(c => window.__game.center(c), c11);
      await touch(cdp, p11[0] - cell * .78, p11[1]);   // left of the board, 0.28 cell beyond the tile edge
      ok((await st(page)).sel === c11, 'tap just outside a tile selects that tile (snap)');
      await touch(cdp, R.x + R.w / 2, R.y + R.h + R.pad + cell * 1.2);   // empty space under the board
      ok((await st(page)).sel === c11, 'tap on empty space keeps the tile already selected');
      await touch(cdp, p11[0], p11[1]); ok((await st(page)).sel === -1, 'tapping the selected tile again deselects it');
      // same kind but more than two turns -> message
      const pair = await page.evaluate(() => { const s = window.__game.state(), g = s.board.split(',').map(Number), P = levelParams(s.L);
        for (let a = 0; a < g.length; a++) for (let b = a + 1; b < g.length; b++) if (canPair(g, a, b) && !findPath(g, P.W2, P.H2, a, b)) return [window.__game.center(a), window.__game.center(b)]; return null; });
      if (pair) {
        await touch(cdp, pair[0][0], pair[0][1]); await touch(cdp, pair[1][0], pair[1][1]);
        ok(/兩個彎/.test(await page.textContent('#toast')) && await page.isVisible('#toast'), 'same kind but no 2-turn path explains why');
        const tr = await page.locator('#toast').boundingBox();
        ok(!overlap(tr, R), 'toast does not cover the board (390x844)');
        await touch(cdp, pair[1][0], pair[1][1]);
      } else ok(false, 'found a same-kind pair with no path on level 1');
      // HUD shows +score / combo; no text drawn over the board
      await playMove(cdp, page);
      ok(/^\+\d+/.test(await page.textContent('#hLbl')), 'match feedback appears in the HUD score label');
      // clear the level: the clear is saved before the win card, and pause cannot open during the clear animation
      while ((await st(page)).left > 1) await playMove(cdp, page);
      await until(page, () => !!window.__game.plan());
      const last = await page.evaluate(() => window.__game.plan());
      for (const q of last) await touch(cdp, q[0], q[1]);
      await until(page, () => window.__game.state().left === 0, null, 5000);
      const saved = await page.evaluate(() => [JSON.parse(localStorage.getItem('linkmatch.progress')), document.getElementById('win').classList.contains('hidden'), JSON.parse(localStorage.getItem('linkmatch.stats'))]);
      ok(saved[1] && saved[0].best[1] > 120 && saved[0].stars[1] >= 1 && saved[2].clears === 1, 'clear is saved the moment the last pair goes (before the win card)');
      await tapSel(cdp, page, '#bPause');
      ok(await page.isHidden('#pause'), 'pause does not open while the cleared board animates out');
      await until(page, () => !document.getElementById('win').classList.contains('hidden'));
      ok(/第 1 關/.test(await page.textContent('#wTitle')), 'win card follows for the same game');
      await tapSel(cdp, page, '#wRetry'); await until(page, () => window.__game.state().status === 'play');
      s = await st(page);
      ok(s.variant === 1 && s.board !== firstBoard, 'replaying a level deals a different verified layout');
      // reload in the clear window of level 2 keeps the clear
      await tapSel(cdp, page, '#bPause'); await until(page, () => !document.getElementById('pause').classList.contains('hidden'));
      await tapSel(cdp, page, '#pSelect'); await until(page, () => !document.getElementById('select').classList.contains('hidden'));
      await tapSel(cdp, page, '.lt[data-n="2"]'); await until(page, () => window.__game.state().L === 2);
      while ((await st(page)).left > 1) await playMove(cdp, page);
      await until(page, () => !!window.__game.plan());
      for (const q of await page.evaluate(() => window.__game.plan())) await touch(cdp, q[0], q[1]);
      await until(page, () => window.__game.state().left === 0, null, 5000);
      await page.reload(); await until(page, () => window.__game && window.__game.state().screen === 'title');
      const p2 = await page.evaluate(() => JSON.parse(localStorage.getItem('linkmatch.progress')));
      ok(p2.max === 3 && p2.best[2] > 0 && p2.stars[2] >= 2 && p2.stars[1] >= 1, 'reload right after the last pair keeps the clear: ' + JSON.stringify(p2));
      ok(!errors.length, 'no page/console errors (390x844) ' + errors.join(' | '));
      await ctx.close();
    }
    // ===== board turn timer belongs to its game (level 80) =====
    {
      const { ctx, page, cdp, errors } = await setup(browser, 390, 844, { ls: { 'linkmatch.unlockAll': 'true', 'linkmatch.settings': JSON.stringify({ mute: true, cb: false, zen: true }) } });
      await openLevel(cdp, page, 80);
      ok((await st(page)).cell >= 36, '10x16 board cell at 390x844 is >= 36 px (was 34)');
      for (let i = 0; i < C.ROT_EVERY - 1; i++) await playMove(cdp, page);
      await until(page, () => !!window.__game.plan());
      const before = (await st(page)).moves;
      for (const q of await page.evaluate(() => window.__game.plan())) await touch(cdp, q[0], q[1]);
      await until(page, n => window.__game.state().moves > n, before);
      await tapSel(cdp, page, '#bPause'); await until(page, () => !document.getElementById('pause').classList.contains('hidden'));
      await tapSel(cdp, page, '#pRestart'); await until(page, () => window.__game.state().moves === 0 && window.__game.state().screen === 'play');
      await page.evaluate(() => new Promise(r => setTimeout(r, 800)));   // queued after the old 520 ms turn timer
      const s = await st(page);
      ok(s.grav === s.levelGrav && s.moves === 0, 'restart during a pending board turn: new game keeps its own gravity');
      ok(!errors.length, 'no page/console errors (level 80) ' + errors.join(' | '));
      await ctx.close();
    }
    // ===== 360x640: toast stays off the board on the biggest board =====
    {
      const { ctx, page, cdp, errors } = await setup(browser, 360, 640, { ls: { 'linkmatch.unlockAll': 'true', 'linkmatch.settings': JSON.stringify({ mute: true, cb: false, zen: true }) } });
      await openLevel(cdp, page, 100);
      await until(page, () => !window.__game.state().busy);
      const s = await st(page), R = await page.evaluate(() => window.__game.rect());
      ok(s.cell >= 30, '10x16 board cell at 360x640 is >= 30 px (was 29): ' + s.cell);
      const ice = s.board.split(',').map(Number).findIndex(c => c & 32), p = await page.evaluate(c => window.__game.center(c), ice);
      await touch(cdp, p[0], p[1]);
      await until(page, () => !document.getElementById('toast').classList.contains('hidden'));
      ok(!overlap(await page.locator('#toast').boundingBox(), R), 'toast does not cover the board (360x640, level 100)');
      ok(!errors.length, 'no page/console errors (360x640) ' + errors.join(' | '));
      await ctx.close();
    }
    // ===== 640x360 title: switches on the first screen =====
    {
      const { ctx, page, errors } = await setup(browser, 640, 360);
      const z = await page.locator('#swZen').boundingBox(), cb = await page.locator('#swCb').boundingBox(), h1 = await page.locator('.ttl h1').boundingBox();
      ok(z.y + z.height <= 360 && cb.y + cb.height <= 360 && h1.y >= 0, 'title switches fit the first screen at 640x360');
      ok(!errors.length, 'no page/console errors (640x360)');
      await ctx.close();
    }
    // ===== time out -> "多 30 秒再試" (fake clock) =====
    {
      const { ctx, page, cdp, errors } = await setup(browser, 390, 844, { clock: true, ls: { 'linkmatch.unlockAll': 'true', 'linkmatch.settings': JSON.stringify({ mute: true, cb: false, zen: false }) } });
      await openLevel(cdp, page, 100);
      const T = (await st(page)).timeMax;
      // jump the fake clock half a second at a time: each jump runs one frame, and a frame advances the game clock by at most 0.5 s
      for (let i = 0; i < 2 * T + 400 && (i < 2 * T || (await st(page)).status !== 'lost'); i++) await page.clock.fastForward(500);
      await until(page, () => window.__game.state().status === 'lost');
      for (let i = 0; i < 3; i++) await page.clock.fastForward(500);
      await until(page, () => !document.getElementById('fail').classList.contains('hidden'));
      ok(await page.isVisible('#fBonus'), 'fail card offers 多 30 秒再試');
      await tapSel(cdp, page, '#fBonus'); await until(page, () => window.__game.state().status === 'play');
      const s = await st(page);
      ok(s.timeMax === s.baseTime + 30 && s.bonus === 30 && s.time > s.baseTime, 'extra-time retry starts with 30 s more');
      ok(!errors.length, 'no page/console errors (time out) ' + errors.join(' | '));
      await ctx.close();
    }
  } catch (e) { ok(false, 'browser run: ' + (e && e.message || e)); }
  await browser.close();
  console.log((fail ? 'FAIL ' : '') + 'link-match tests: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - T0) / 1000).toFixed(1) + 's)');
  process.exit(fail ? 1 : 0);
})();
