// Regression tests for 積木推推樂 (color-push): level data in Node, then the page in Chromium with real CDP touch input.
// Each block maps to a 9.5 release re-review finding (2026-10-30).
// Usage: node tests.js   (about 30-60 s; waits on conditions, no timing-based assertions)
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, step, isWon, expandMoves};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEEN = { basic: 1, color: 1, split: 1, ice: 1, power: 1, glue: 1, paint: 1, door: 1, all: 1 };

(async () => {
  console.log('Levels');
  await t('every level: the stored solution replays to a win in exactly the stated minimum, never trivially', () => {
    for (let n = 1; n <= LEVELS.length; n++) {
      const e = LEVELS[n - 1], L = C.parseLevel(e), S0 = C.initState(L);
      ok(!C.isWon(L, S0), 'level ' + n + ' starts solved');
      const ex = C.expandMoves(L, S0, e.s.map(v => ({ c: v >> 2, d: v & 3 })));
      ok(ex && C.isWon(L, ex.S) && e.s.length === e.m && e.m >= 4, 'level ' + n);
      if (n > 1) ok(e.d > LEVELS[n - 2].d, 'difficulty rises at ' + n);
    }
  });

  console.log('Page');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  async function open(prep, w = 390, h = 844) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(URL);
    await page.evaluate(p => { localStorage.clear(); localStorage.setItem('colorpush.mute', 'true'); for (const k in p) localStorage.setItem('colorpush.' + k, typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k])); }, Object.assign({ intro: SEEN }, prep || {}));
    await page.reload();
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }
  const waitFor = async (page, fn, arg, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + fn.toString().slice(0, 100)); await sleep(25); } };
  const st = page => page.evaluate(() => window.__game.state());
  const idle = page => waitFor(page, () => { const s = window.__game.state(); return (s.status === 'play' || s.status === 'won') && !s.animating; });
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden') && e.getBoundingClientRect().width > 0; }, sel);
  async function touch(cdp, type, pts) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); }
  const pt = (x, y, id = 1) => ({ x, y, id });
  let lastSwipe = 0;
  async function tap(cdp, page, sel) {
    // a tap right after a swipe can be eaten as the end of that fling: let it settle first
    const since = Date.now() - lastSwipe; if (since < 350) await sleep(350 - since);
    await waitFor(page, s => { const e = document.querySelector(s); return e && !e.classList.contains('hidden') && !e.closest('.hidden') && !e.disabled; }, sel);
    await page.evaluate(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); }, sel);
    // overlays pop in (scale animation): tap only once the button has stopped moving
    let b, prev = '';
    for (let t0 = Date.now(); ; await sleep(30)) {
      b = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; }, sel);
      const k = [b.x, b.y, b.w].map(v => v.toFixed(1)).join(); if (k === prev || Date.now() - t0 > 2000) break; prev = k;
    }
    // wait for the click itself, so the next touch can't race it on a slow runner
    await page.evaluate(s => { window.__tapClick = false; document.querySelector(s).addEventListener('click', () => { window.__tapClick = true; }, { once: true, capture: true }); }, sel);
    await touch(cdp, 'touchStart', [pt(b.x, b.y)]); await sleep(40); await touch(cdp, 'touchEnd', []);
    await waitFor(page, () => window.__tapClick, null, 3000);
    await sleep(30);
  }
  const cellPt = (page, c) => page.evaluate(c => window.__game.cellCenter(c), c);
  async function tapCell(cdp, page, c) { const p = await cellPt(page, c); await touch(cdp, 'touchStart', [pt(p.x, p.y)]); await sleep(40); await touch(cdp, 'touchEnd', []); }
  const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // a finger swipe of 60 px from the board centre; `hold` keeps the finger down at the end
  async function swipe(cdp, page, d, hold = 0) {
    const B = await page.evaluate(() => window.__game.board()), x = B.x + B.w * B.s / 2, y = B.y + B.h * B.s / 2;
    await touch(cdp, 'touchStart', [pt(x, y)]);
    for (let i = 1; i <= 4; i++) { await sleep(16); await touch(cdp, 'touchMove', [pt(x + DV[d][0] * 15 * i, y + DV[d][1] * 15 * i)]); }
    if (hold) await sleep(hold);
    await touch(cdp, 'touchEnd', []);
    lastSwipe = Date.now();
  }
  // one move with a swipe, waiting until it has landed
  async function move(cdp, page, d) {
    const s0 = await st(page);
    await swipe(cdp, page, d);
    await waitFor(page, s0 => { const s = window.__game.state(); return (s.steps + s.pushes > s0.steps + s0.pushes || s.status === 'won') && !s.animating; }, s0);
  }
  async function startFromTitle(cdp, page) { await tap(cdp, page, '#tPlay'); await waitFor(page, () => window.__game.state().status === 'play'); await sleep(50); }
  const L1 = C.parseLevel(LEVELS[0]), CELL8 = 8; // level 1: from cell 8 a left push could go twice (block at 7 -> 6 -> 5)

  await t('holding after a push never pushes again by itself; holding after a walk keeps walking', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tapCell(cdp, page, CELL8);
    await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    eq(await page.evaluate(() => window.__game.stepInfo(3)), 'push', 'left from cell 8 pushes');
    await swipe(cdp, page, 3, 1200);
    await idle(page);
    const s = await st(page);
    eq([s.pushes, s.p], [1, 7], 'one push only');
    // from cell 24, hold a walk up: 19, 14, then a wall; no push
    await tapCell(cdp, page, 24); await waitFor(page, () => window.__game.state().p === 24 && !window.__game.state().animating);
    const s1 = await st(page);
    await swipe(cdp, page, 0, 900); await idle(page);
    const s2 = await st(page);
    eq([s2.p, s2.pushes, s2.steps - s1.steps], [14, 1, 2], 'walk repeat');
    await ctx.close();
  });

  await t('a tap during a push walks after the push lands (push kept, tap not dropped)', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tapCell(cdp, page, CELL8); await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    await swipe(cdp, page, 3); // push block 7 -> 6, pusher to 7
    await tapCell(cdp, page, 24);
    await waitFor(page, () => { const s = window.__game.state(); return s.p === 24 && !s.animating; });
    const s = await st(page); eq(s.pushes, 1);
    ok(s.key.split(',').map(Number).includes(6 * 8), 'block landed on cell 6: ' + s.key);
    await ctx.close();
  });

  await t('undo steps back one push (with the walk around it), and 重來 is undoable', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tapCell(cdp, page, CELL8); await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    const k0 = (await st(page)).key;
    await move(cdp, page, 3); await move(cdp, page, 0); await move(cdp, page, 1); // push, then walk up and right
    eq([(await st(page)).undo, (await st(page)).p], [1, 3]);
    await tap(cdp, page, '#bUndo');
    await waitFor(page, () => window.__game.state().undo === 0);
    const s = await st(page);
    eq([s.p, s.pushes, s.key], [CELL8, 0, k0], 'back before the push');
    ok(await page.evaluate(() => document.getElementById('bUndo').disabled), 'undo disabled');
    await move(cdp, page, 3);
    const k1 = (await st(page)).key;
    await tap(cdp, page, '#bRestart'); await waitFor(page, () => window.__game.state().pushes === 0);
    await tap(cdp, page, '#bUndo'); await waitFor(page, () => window.__game.state().pushes === 1);
    eq((await st(page)).key, k1, 'restart undone');
    await ctx.close();
  });

  await t('mid-level progress survives leaving the page and resumes from 繼續', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tapCell(cdp, page, CELL8); await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    await move(cdp, page, 3);
    await move(cdp, page, 1); // a walk after the push: banked by pagehide, not by the push
    const before = await st(page);
    await page.reload();
    await waitFor(page, () => document.getElementById('tPlay').textContent.indexOf('繼續第 1 關') >= 0);
    await startFromTitle(cdp, page);
    const s = await st(page);
    eq([s.level, s.pushes, s.key, s.p, s.undo], [1, 1, before.key, before.p, 1], 'resumed');
    await tap(cdp, page, '#bUndo'); await waitFor(page, () => window.__game.state().undo === 0);
    eq((await st(page)).p, CELL8, 'undo history resumed too');
    await ctx.close();
  });

  await t('a winning push cut short by the menu still wins and is saved; result card ignores an instant tap', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    const plan = await page.evaluate(() => window.__game.plan());
    for (let i = 0; i < plan.length - 1; i++) await move(cdp, page, plan[i].d);
    await swipe(cdp, page, plan[plan.length - 1].d);
    await tap(cdp, page, '#bPause'); // lands mid-push (or right after it)
    await waitFor(page, () => window.__game.state().won);
    // a tap landing the instant the result card appears must be ignored
    const instant = page.evaluate(() => new Promise(res => { const w = document.getElementById('win'); const mo = new MutationObserver(() => { if (!w.classList.contains('hidden')) { mo.disconnect(); document.getElementById('wNext').click(); res(window.__game.state().status); } }); mo.observe(w, { attributes: true }); }));
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('colorpush.progress'))), { 1: 4 });
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('colorpush.stars'))), { 1: 3 });
    ok(!(await visible(page, '#pause')), 'no menu over the win');
    eq(await instant, 'won', 'instant tap ignored');
    eq((await st(page)).level, 1);
    await waitFor(page, () => window.__game.state().cardReady);
    await tap(cdp, page, '#wNext');
    await waitFor(page, () => window.__game.state().level === 2);
    ok(await page.evaluate(() => localStorage.getItem('colorpush.cur') === 'null'), 'saved board cleared after the win');
    await ctx.close();
  });

  await t('finishing from a stopped solution demo clears the level without stars; 悔棋 brings the own board back', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tapCell(cdp, page, CELL8); await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    await move(cdp, page, 3);
    await tap(cdp, page, '#bPause'); await tap(cdp, page, '#pDemo');
    await waitFor(page, () => window.__game.state().pushes >= 1 && !window.__game.state().animating, null, 10000);
    await tap(cdp, page, '#demoBar');
    let s = await idle(page).then(() => st(page));
    ok(!s.demo && s.assisted, 'demo stopped, board marked assisted');
    // finish from here with swipes
    const rest = await page.evaluate(() => { const L = parseLevel(LEVELS[0]); const S = window.__game.snap(); const r = solve(L, { S }); return expandMoves(L, S, r.pushes).moves; });
    for (const m of rest) await move(cdp, page, m.d);
    await waitFor(page, () => window.__game.state().won);
    eq(await page.evaluate(() => [JSON.parse(localStorage.getItem('colorpush.progress')), localStorage.getItem('colorpush.stars')]), [{ 1: 0 }, null]);
    await waitFor(page, () => !document.getElementById('win').classList.contains('hidden'));
    ok(/不計星星/.test(await page.textContent('#wMsg')), 'message says no stars');
    await waitFor(page, () => window.__game.state().cardReady); // the card ignores taps for its first 450 ms
    await tap(cdp, page, '#wRetry'); await waitFor(page, () => window.__game.state().status === 'play' && window.__game.state().pushes === 0);
    // the demo kept the player's own board on the undo list
    await tap(cdp, page, '#bPause'); await tap(cdp, page, '#pResume');
    await tapCell(cdp, page, CELL8); await waitFor(page, c => window.__game.state().p === c && !window.__game.state().animating, CELL8);
    await move(cdp, page, 3);
    const own2 = await st(page);
    await tap(cdp, page, '#bPause'); await tap(cdp, page, '#pDemo');
    await waitFor(page, () => window.__game.state().demo);
    await tap(cdp, page, '#demoBar'); await idle(page);
    for (let i = 0; i < 20 && (await st(page)).assisted; i++) { const u = (await st(page)).undo; ok(u > 0, 'undo left'); await tap(cdp, page, '#bUndo'); await waitFor(page, u => window.__game.state().undo < u, u); }
    s = await st(page);
    eq([s.key, s.pushes, s.assisted], [own2.key, 1, false], 'own board back');
    await ctx.close();
  });

  await t('a second hint on the same board is free; hints left are kept per level', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    await tap(cdp, page, '#bHint'); await waitFor(page, () => window.__game.state().hint);
    eq((await st(page)).hintsLeft, 2);
    await move(cdp, page, 1); // walking keeps the arrow
    ok((await st(page)).hint, 'arrow kept while walking');
    await tap(cdp, page, '#bHint');
    eq((await st(page)).hintsLeft, 2, 'no extra hint used');
    await ctx.close();
  });

  await t('corrupt storage is ignored (no errors, sane defaults)', async () => {
    const n0 = errors.length;
    const { ctx, page, cdp } = await open({ progress: { 1: 'x', 2: 5, abc: 1, 999: 3 }, stars: { 2: 7, 1: 3 }, stats: '"oops"', hints: { 1: 99 }, cur: { n: 1, p: 0, pos: [1, 1], col: [0, 0], pushes: 2, steps: 0 }, intro: [1, 2] });
    eq(await page.textContent('#tPlay'), '開始遊戲', 'bad save not offered');
    await tap(cdp, page, '#tSelect');
    eq(await page.evaluate(() => [...document.querySelectorAll('.lt.done')].map(e => +e.dataset.n)), [2]);
    ok(/總推動 0 次/.test(await page.textContent('#selSum')), 'stats reset');
    await tap(cdp, page, '.lt[data-n="1"]');
    if (await visible(page, '#intro')) await tap(cdp, page, '#iOk');
    await waitFor(page, () => window.__game.state().status === 'play');
    const s = await st(page); eq([s.hintsLeft, s.pushes], [3, 0]);
    eq(errors.length, n0, 'errors: ' + errors.slice(n0).join(' | '));
    await ctx.close();
  });

  await t('app switch drops a held finger (no walking on by itself after coming back)', async () => {
    const { ctx, page, cdp } = await open();
    await startFromTitle(cdp, page);
    const p0 = await cellPt(page, 12); // the pusher; to the right are two open cells
    await touch(cdp, 'touchStart', [pt(p0.x, p0.y)]);
    for (let i = 1; i <= 4; i++) { await sleep(16); await touch(cdp, 'touchMove', [pt(p0.x + 15 * i, p0.y)]); }
    await waitFor(page, () => window.__game.state().steps >= 1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const a = (await st(page)).steps;
    await sleep(700);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await sleep(500);
    await touch(cdp, 'touchEnd', []);
    await idle(page);
    eq((await st(page)).steps, a, 'steps after the app switch');
    await ctx.close();
  });

  await t('rotating to landscape and back keeps the board clear of the controls', async () => {
    const { ctx, page, cdp } = await open({ unlockAll: true });
    await tap(cdp, page, '#tSelect'); await tap(cdp, page, '.lt[data-n="100"]');
    await waitFor(page, () => window.__game.state().status === 'play');
    for (const [w, h] of [[844, 390], [390, 844], [568, 320]]) {
      await page.setViewportSize({ width: w, height: h });
      await waitFor(page, w => innerWidth === w, w);
      await sleep(80);
      const r = await page.evaluate(() => { const B = window.__game.board(), hud = document.getElementById('hud').querySelector('.hmid').getBoundingClientRect(), bot = document.getElementById('bottom').getBoundingClientRect();
        const b = { l: B.x, t: B.y, r: B.x + B.w * B.s, b: B.y + B.h * B.s };
        const hit = (a, c) => a.l < c.right && a.r > c.left && a.t < c.bottom && a.b > c.top;
        return { b, s: B.s, hud: hit(b, hud), bot: [...document.querySelectorAll('#bottom .pill')].some(p => hit(b, p.getBoundingClientRect())), fits: b.l >= 0 && b.t >= 0 && b.r <= innerWidth && b.b <= innerHeight }; });
      ok(!r.hud && !r.bot && r.fits && r.s >= 18, w + 'x' + h + ' ' + JSON.stringify(r));
    }
    await ctx.close();
  });

  await browser.close();
  if (errors.length) { fail++; console.log('FAIL   page errors:', errors.slice(0, 5).join(' | ')); }
  console.log(`${fail ? 'FAIL' : 'PASS'} color-push tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
