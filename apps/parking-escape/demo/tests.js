// 霓虹夜停 (parking-escape) regression tests: node checks on the game's own core + real-page checks with CDP touch.
// Covers the 2026-11-08 release review: second finger not swallowed (drags + every kind of button, single / slow / with a
// resting finger), title demo never counted as a clear, level grid rows not overlapping, unfinished game saved and
// restored, restart needs a second press, hint/solution caps stars at 2 (and the win is saved before the exit animation),
// date-seeded daily board + streak, one-way dead-end warning, landscape toast / replay bar / win card, 7x7 cells >= 44 px,
// exit label outside the frame, static cars cached (no repaint while idle).
// Usage: node tests.js   (prints PASS/FAIL lines; exit code 1 on failure)
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseBoard,gridOf,rangeOf,isWin,solve,decodeSol,dailyVariant};')();
const { LEVELS, DAILY } = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn {LEVELS,DAILY};')();
const T0 = Date.now();
let pass = 0, fail = 0;
function ok(c, name, extra) { if (c) { pass++; console.log('PASS', name, process.env.TT ? ((Date.now() - T0) / 1000).toFixed(1) : ''); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } }

// ---------- node: daily generator ----------
const POOL = DAILY.map(e => e[0]).concat(LEVELS.slice(40, 70).map(e => e[0]));
ok(POOL.length === 70 && POOL.every(c => !C.parseBoard(c).cars.some(k => k.ow)), 'daily base pool: 70 boards, no one-way cars');
{
  const codes = new Set(), bad = []; let mn = 99, mx = 0;
  for (let di = 20400; di < 20420; di++) {
    const r = C.dailyVariant(POOL[((di % 70) * 29) % 70], di * 2654435761, 60000);
    const B = C.parseBoard(r.code), so = C.solve(B, B.start), s = B.start.slice();
    let legal = true;
    for (const [i, v] of C.decodeSol(r.sol)) { const g = C.rangeOf(B, s, C.gridOf(B, s), i); if (v < g[0] || v > g[1] || v === s[i]) legal = false; s[i] = v; }
    if (!so || so.len !== r.m || !legal || !C.isWin(B, s) || POOL.includes(r.code)) bad.push(di);
    codes.add(r.code); mn = Math.min(mn, r.m); mx = Math.max(mx, r.m);
  }
  ok(!bad.length, 'daily boards: embedded solution legal and optimal (BFS), never a pool board itself', bad);
  ok(codes.size === 20 && mn >= 20, 'daily boards: 20 days -> 20 different boards, all >= 20 moves', { n: codes.size, mn, mx });
  const a = C.dailyVariant(POOL[5], 777, 60000), b = C.dailyVariant(POOL[5], 777, 60000);
  ok(a.code === b.code && a.sol === b.sol, 'daily generator is deterministic for a date');
}

// ---------- browser ----------
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SEEN = "try{if(!localStorage.getItem('parking.intro'))localStorage.setItem('parking.intro',JSON.stringify({basic:1,truck:1,pillar:1,big:1,oneway:1,all:1}))}catch(e){}";
let base;
function serve() {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${srv.address().port}/`; r(srv); }));
}
const errors = [];
async function mk(browser, w, h, opt = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: opt.dark ? 'dark' : 'light' });
  await ctx.addInitScript(SEEN + (opt.init || ''));
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${w}x${h} pageerror ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base); await page.waitForFunction(() => window.__game && window.__game.state().status === 'demo');
  return { ctx, page, cdp };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
const frames = (page, n = 2) => page.evaluate(n => new Promise(r => { let k = 0; (function f() { if (++k >= n) r(); else requestAnimationFrame(f); })(); }), n);
async function box(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no box ' + sel); return b; }
// tap = press + hold + release with finger `id`; `rest` = another finger already on the screen (pressed before, released after)
async function tapAt(page, cdp, x, y, hold = 50, rest = null) {
  if (rest) await touch(cdp, 'touchStart', [rest]);
  await touch(cdp, 'touchStart', (rest ? [rest] : []).concat([{ x, y, id: 1 }]));
  if (hold > 50) await page.waitForTimeout(hold); else await frames(page, 2);
  await touch(cdp, 'touchEnd', [{ x, y, id: 1 }]);
  if (rest) { await frames(page, 2); await touch(cdp, 'touchEnd', [rest]); }
  await frames(page, 2);
}
const settled = page => page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || !isFinite(a.effect.getComputedTiming().endTime)), null, { timeout: 3000, polling: 30 }).catch(() => {});
async function tap(page, cdp, sel, hold, rest) { await settled(page); const b = await box(page, sel); await tapAt(page, cdp, b.x + b.width / 2, b.y + b.height / 2, hold, rest); }
const G = page => page.evaluate(() => ({ st: window.__game.state(), g: window.__game.geom(), cars: window.__game.cars(), info: window.__game.info() }));
const cc = (g, car, pos) => ({ x: g.ox + (car.h ? pos + car.len / 2 : car.f + 0.5) * g.cs, y: g.oy + (car.h ? car.f + 0.5 : pos + car.len / 2) * g.cs });
const idle = page => page.waitForFunction(() => { const s = window.__game.state(); return !s.animating; }, null, { polling: 30, timeout: 8000 });
// drag car i to position `to`; `others` = fingers held down meanwhile (already pressed)
async function moveCar(page, cdp, i, to, id = 1, others = []) {
  const { st, g, cars } = await G(page), car = cars[i], a = cc(g, car, st.s[i]);
  const dx = car.h ? (to - st.s[i]) * g.cs : 0, dy = car.h ? 0 : (to - st.s[i]) * g.cs;
  await touch(cdp, 'touchStart', others.concat([{ x: a.x, y: a.y, id }]));
  for (let k = 1; k <= 6; k++) await touch(cdp, 'touchMove', others.concat([{ x: a.x + dx * k / 6, y: a.y + dy * k / 6, id }]));
  await touch(cdp, 'touchEnd', [{ x: a.x + dx, y: a.y + dy, id }]);
}
const vis = (page, id) => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
const waitVis = (page, id) => page.waitForFunction(id => !document.getElementById(id).classList.contains('hidden'), id, { timeout: 5000 });
const ls = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem('parking.' + k) || 'null'), k);
async function openLevel(page, cdp, n) {
  await page.evaluate(n => { localStorage.setItem('parking.unlockAll', 'true'); }, n);
  await tap(page, cdp, '#tSelect'); await waitVis(page, 'select');
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') await tap(page, cdp, '#unlockSw');
  await page.locator(`.lt[data-n="${n}"]`).scrollIntoViewIfNeeded();
  await tap(page, cdp, `.lt[data-n="${n}"]`);
  await page.waitForFunction(n => { const s = window.__game.state(); return s.status === 'play' && s.level === n; }, n, { timeout: 5000 });
  await idle(page);
}
async function toTitle(page, cdp) {
  if (await vis(page, 'win')) { await tap(page, cdp, '#wNext'); }
  if ((await G(page)).st.status === 'play') { await tap(page, cdp, '#bPause'); await waitVis(page, 'pause'); await tap(page, cdp, '#pSelect'); }
  await waitVis(page, 'title');
}
const fullSol = async page => C.decodeSol(await page.evaluate(() => window.__game.sol()));
async function solveRest(page, cdp, path) { for (const [i, v] of path) { await idle(page); await moveCar(page, cdp, i, v); } }

async function sections23(browser) {
    // ===== 2. one-way dead end, daily board + streak (360x640) =====
    {
      const day = n => { const d = new Date(Date.now() - n * 86400000); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
      const init = `if(!localStorage.getItem('parking.daily'))localStorage.setItem('parking.daily',JSON.stringify({'${day(1)}':30,'${day(2)}':28,'${day(3)}':31,'${day(5)}':40}));`;
      const { ctx, page, cdp } = await mk(browser, 360, 640, { init });
      await openLevel(page, cdp, 83);
      {
        const g = (await G(page)).g;
        ok(g.cs >= 44, '7x7 cells >= 44 px at 360x640', g.cs);
        ok(g.ox + 7 * g.cs + g.fm + g.lg <= g.vw + 0.5, 'exit label gutter fits right of the frame at 360x640', g);
        await moveCar(page, cdp, 5, 4); // dead move found offline: level 83, car F to 4
        await page.waitForFunction(() => /無解/.test(document.getElementById('toast').textContent) && document.getElementById('bUndo').classList.contains('glow'), null, { timeout: 6000 });
        ok(true, 'one-way dead end: toast 已經無解 and 悔棋 glows right after the move');
        await tap(page, cdp, '#bUndo'); await idle(page);
        ok(!(await page.evaluate(() => document.getElementById('bUndo').classList.contains('glow'))), 'glow clears after 悔棋');
      }
      // idle frames repaint no car (static cars cached)
      await page.waitForTimeout(400);
      const p0 = await page.evaluate(() => window.__game.paints()); await frames(page, 20);
      const p1 = await page.evaluate(() => window.__game.paints());
      ok(p1 - p0 === 0, 'idle play: cars are not repainted every frame', p1 - p0);
      await toTitle(page, cdp);
      // daily: board equals the node-side generator for today; stats show the streak and the last 7 days
      await tap(page, cdp, '#tDaily'); await page.waitForFunction(() => window.__game.state().status === 'play' && window.__game.info().daily);
      {
        const info = (await G(page)).info, di = await page.evaluate(() => { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000); });
        const r = C.dailyVariant(POOL[((di % 70) * 29) % 70], di * 2654435761, 60000);
        ok(info.code === r.code && info.m === r.m, 'daily board is the date-seeded generated board', { page: info.code, node: r.code });
      }
      await toTitle(page, cdp);
      await tap(page, cdp, '#tStats'); await waitVis(page, 'stats');
      const kv = await page.textContent('#statKv'), wk = await page.evaluate(() => document.querySelectorAll('#statKv .wk i.on').length);
      ok(/每日連續天數3 天/.test(kv) && wk === 4, 'stats: daily streak 3 days and 4 of the last 7 days ticked', { kv, wk });
      ok(!errors.length, 'no page/console errors (360x640)', errors);
      await ctx.close();
    }

    // ===== 3. landscape: toast / replay bar / win card / HUD off the board, 7x7 cells >= 44 =====
    for (const [w, h] of [[844, 390], [667, 375]]) {
      const { ctx, page, cdp } = await mk(browser, w, h, { dark: w === 844 });
      await openLevel(page, cdp, 85);
      const geo = async () => page.evaluate(() => { const g = window.__game.geom(), W = window.__game.state().W, r = e => document.getElementById(e).getBoundingClientRect();
        return { g, W, board: { l: g.ox - g.fm, t: g.oy - g.fm, r: g.ox + W * g.cs + g.fm, b: g.oy + W * g.cs + g.fm }, toast: r('toast'), hud: r('hud'), bottom: r('bottom'), rb: r('replayBar') }; });
      const hit = (a, b) => a.width > 0 && !(a.right <= b.l || a.left >= b.r || a.bottom <= b.t || a.top >= b.b);
      let q = await geo();
      ok(q.g.cs >= 44, `7x7 cells >= 44 px at ${w}x${h}`, q.g.cs);
      ok(!hit(q.toast, q.board) && !hit(q.hud, q.board) && !hit(q.bottom, q.board), `level toast, HUD and buttons stay off the board at ${w}x${h}`, q);
      ok(q.board.r + q.g.lg <= q.g.vw && q.board.b <= h && q.board.t >= 0, `board + exit label inside the screen at ${w}x${h}`, q.board);
      await tap(page, cdp, '#bPause'); await waitVis(page, 'pause'); await tap(page, cdp, '#pSolve');
      await page.waitForFunction(() => window.__game.state().status === 'replay'); await frames(page, 3);
      q = await geo();
      ok(!hit(q.rb, q.board), `停止播放解答 stays off the board at ${w}x${h}`, { rb: q.rb, board: q.board });
      await tap(page, cdp, '#bStopReplay'); await page.waitForFunction(() => window.__game.state().status === 'play');
      await toTitle(page, cdp);
      await openLevel(page, cdp, 1);
      await solveRest(page, cdp, await fullSol(page));
      await waitVis(page, 'win'); await page.waitForTimeout(450); // card pop animation
      const card = await page.evaluate(() => { const r = document.querySelector('#win .card').getBoundingClientRect(), s = document.getElementById('wSelect').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: r.height, sel: s.bottom }; });
      ok(card.h <= h - 16 && card.sel <= h, `win card fits the ${w}x${h} screen without scrolling`, card);
      ok(!errors.length, `no page/console errors (${w}x${h})`, errors);
      await ctx.close();
    }
}

// demo exit must not be counted as a clear: tap 選擇關卡 while the demo's red car drives out (own page, runs alongside the rest)
async function demoCheck(browser) {
  const { ctx, page, cdp } = await mk(browser, 390, 844);
  await page.waitForFunction(() => { const s = window.__game.state(); return s.status === 'demo' && s.s[0] === s.W - 2; }, null, { timeout: 60000, polling: 20 });
  await tap(page, cdp, '#tSelect');
  await waitVis(page, 'select');
  await frames(page, 150); // the exit animation lasts at most 2.2 s of game time at <= 0.05 s per frame: well over by now
  ok(!(await vis(page, 'win')) && (await ls(page, 'progress')) === null && !((await ls(page, 'stats')) || {}).clears, 'title demo reaching the exit while opening 選擇關卡 records nothing and shows no win card');
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  try {
    const demoP = demoCheck(browser).catch(e => { fail++; console.log('FAIL demo exception', String(e).slice(0, 300)); });
    await sections23(browser);
    await demoP;
    // ===== 1. 390x844: touch, buttons, grid, resume, restart, stars, demo =====
    {
      const { ctx, page, cdp } = await mk(browser, 390, 844, { dark: true, init: "window.__clicks=0;window.addEventListener('click',()=>window.__clicks++);" });
      const REST = { x: 386, y: 300, id: 0 }; // a finger resting on the empty right edge

      await tap(page, cdp, '#tSelect'); await waitVis(page, 'select');

      // level grid: rows do not overlap, 8 px gap; a tap 3 px above the bottom of tile 1 opens level 1
      const rows = await page.evaluate(() => { const a = [...document.querySelectorAll('.lt')].slice(0, 10).map(b => b.getBoundingClientRect()); return { b1: a[0].bottom, t6: a[5].top, h: a[0].height, w: a[0].width }; });
      ok(rows.t6 - rows.b1 >= 7.5, 'level grid rows keep an 8 px gap (no overlap)', rows);
      {
        const b = await box(page, '.lt[data-n="1"]');
        await tapAt(page, cdp, b.x + b.width / 2, b.y + b.height - 3);
        await page.waitForFunction(() => window.__game.state().status === 'play');
        ok((await G(page)).st.level === 1, 'tap near the bottom edge of tile 1 opens level 1 (not level 6)');
      }
      // L1 has no moves yet: pause -> back to title
      await toTitle(page, cdp);

      // buttons: single tap, slow taps (0.6 s, 1 s) and taps with another finger resting, each fires exactly once
      const HOLDS = [[50, null, 'tap'], [50, REST, 'second finger'], [600, null, 'hold 0.6 s'], [1000, null, 'hold 1 s'], [600, REST, 'second finger, hold 0.6 s']];
      await page.evaluate(() => { window.__clicks = 0; });
      for (const [hold, rest, label] of HOLDS) {
        const r = [];
        if (hold === 1000) { // 1 s holds: settings toggle round only
          await tap(page, cdp, '#tSet', hold, rest); r.push(await vis(page, 'settings'));
          const v1 = await page.getAttribute('#sVib', 'aria-checked');
          await tap(page, cdp, '#sVib', hold, rest); r.push((await page.getAttribute('#sVib', 'aria-checked')) !== v1);
          await tap(page, cdp, '#setOk', hold, rest); r.push(await vis(page, 'title'));
          const c3 = await page.evaluate(() => { const c = window.__clicks; window.__clicks = 0; return c; });
          ok(r.every(Boolean) && c3 === r.length, `buttons fire exactly once (${label})`, { r, clicks: c3 });
          continue;
        }
        if (hold > 50) { // slow taps: a shorter round (settings toggle + a level tile + pause)
          await tap(page, cdp, '#tSet', hold, rest); r.push(await vis(page, 'settings'));
          const v1 = await page.getAttribute('#sVib', 'aria-checked');
          await tap(page, cdp, '#sVib', hold, rest); r.push((await page.getAttribute('#sVib', 'aria-checked')) !== v1);
          await tap(page, cdp, '#setOk', hold, rest); r.push(await vis(page, 'title'));
          await tap(page, cdp, '#tSelect', 50, rest); await tap(page, cdp, '.lt[data-n="1"]', hold, rest); r.push((await G(page)).st.status === 'play');
          await tap(page, cdp, '#bPause', hold, rest); r.push(await vis(page, 'pause'));
          await tap(page, cdp, '#pSelect', 50, rest); r.push(await vis(page, 'title'));
          const c2 = await page.evaluate(() => { const c = window.__clicks; window.__clicks = 0; return c; });
          ok(r.every(Boolean) && c2 === r.length + 1, `buttons fire exactly once (${label})`, { r, clicks: c2 });
          continue;
        }
        await tap(page, cdp, '#tHelp', hold, rest); r.push(await vis(page, 'help'));
        await tap(page, cdp, '#hOk', hold, rest); r.push(await vis(page, 'title'));
        await tap(page, cdp, '#tSet', hold, rest); r.push(await vis(page, 'settings'));
        const v0 = await page.getAttribute('#sVib', 'aria-checked');
        await tap(page, cdp, '#sVib', hold, rest); r.push((await page.getAttribute('#sVib', 'aria-checked')) !== v0);
        await tap(page, cdp, '#setOk', hold, rest); r.push(await vis(page, 'title'));
        await tap(page, cdp, '#tSelect', hold, rest); r.push(await vis(page, 'select'));
        await page.locator('.lt[data-n="1"]').scrollIntoViewIfNeeded();
        await tap(page, cdp, '.lt[data-n="1"]', hold, rest); r.push((await G(page)).st.level === 1 && (await G(page)).st.status === 'play');
        const m0 = await page.getAttribute('#sSound', 'aria-checked');
        await tap(page, cdp, '#bMute', hold, rest); r.push((await page.getAttribute('#sSound', 'aria-checked')) !== m0);
        await tap(page, cdp, '#bMute', hold, rest); r.push((await page.getAttribute('#sSound', 'aria-checked')) === m0);
        const h0 = (await G(page)).info.hintsLeft;
        await tap(page, cdp, '#bHint', hold, rest); r.push((await G(page)).info.hintsLeft === h0 - 1 || h0 === 0);
        await tap(page, cdp, '#bPause', hold, rest); r.push(await vis(page, 'pause'));
        await tap(page, cdp, '#pResume', hold, rest); r.push((await G(page)).st.status === 'play');
        await tap(page, cdp, '#bPause', hold, rest); r.push(await vis(page, 'pause'));
        await tap(page, cdp, '#pSelect', hold, rest); r.push(await vis(page, 'title'));
        const clicks = await page.evaluate(() => { const c = window.__clicks; window.__clicks = 0; return c; });
        ok(r.every(Boolean) && clicks === r.length, `14 buttons fire exactly once (${label})`, { r, clicks });
      }

      // two fingers on the board (level 10): hold car A, drag car B with a second finger -> B moves
      await page.evaluate(() => { localStorage.removeItem('parking.resume'); });
      await openLevel(page, cdp, 10);
      {
        const { st, g, cars } = await G(page), path = await fullSol(page);
        const [bi, bv] = path[0];               // first solution move: car bi to bv
        const other = cars.findIndex((k, i) => i !== bi && i !== 0);
        const hold = cc(g, cars[other], st.s[other]);
        const F0 = { x: hold.x, y: hold.y, id: 0 };
        await touch(cdp, 'touchStart', [F0]);
        await moveCar(page, cdp, bi, bv, 1, [F0]);
        await touch(cdp, 'touchEnd', [F0]);
        await idle(page);
        const s2 = (await G(page)).st;
        ok(s2.s[bi] === bv && s2.moves === 1 && s2.s[other] === st.s[other], 'finger 1 holding a car, finger 2 drags another car -> it moves (1 move)', s2);
        // dragging a car while another finger taps 悔棋 -> undo happens and the dragged car snaps back (no overlap)
        const [ci, cv2] = path[1];
        const c = cc(g, cars[ci], s2.s[ci]), dx = cars[ci].h ? (cv2 - s2.s[ci]) * g.cs * 0.5 : 0, dy = cars[ci].h ? 0 : (cv2 - s2.s[ci]) * g.cs * 0.5;
        const F = { x: c.x, y: c.y, id: 0 };
        await touch(cdp, 'touchStart', [F]);
        for (let k = 1; k <= 4; k++) await touch(cdp, 'touchMove', [{ x: c.x + dx * k / 4, y: c.y + dy * k / 4, id: 0 }]);
        const ub = await box(page, '#bUndo');
        const F1 = { x: ub.x + ub.width / 2, y: ub.y + ub.height / 2, id: 1 };
        await touch(cdp, 'touchStart', [{ x: c.x + dx, y: c.y + dy, id: 0 }, F1]);
        await frames(page, 2);
        await touch(cdp, 'touchEnd', [F1]);
        await touch(cdp, 'touchMove', [{ x: c.x + dx * 2, y: c.y + dy * 2, id: 0 }]);
        await touch(cdp, 'touchEnd', [{ x: c.x + dx * 2, y: c.y + dy * 2, id: 0 }]);
        await idle(page);
        const s3 = (await G(page)).st;
        ok(s3.s[bi] === st.s[bi] && s3.s[ci] === s2.s[ci] && s3.moves === 1, '悔棋 tapped by a second finger mid-drag: undo applies, dragged car returns', s3);
      }

      // unfinished game: 2 moves on level 8, reload -> title offers 繼續第 8 關, board and move count restored
      await toTitle(page, cdp);
      await openLevel(page, cdp, 8);
      {
        const path = await fullSol(page);
        await solveRest(page, cdp, path.slice(0, 2)); await idle(page);
        const before = (await G(page)).st;
        await page.reload(); await page.waitForFunction(() => window.__game && window.__game.state().status === 'demo');
        const label = await page.textContent('#tPlay');
        await tap(page, cdp, '#tPlay'); await page.waitForFunction(() => window.__game.state().status === 'play'); await idle(page);
        const after = (await G(page)).st;
        ok(/繼續第 8 關/.test(label) && after.level === 8 && after.moves === 2 && JSON.stringify(after.s) === JSON.stringify(before.s), 'unfinished level 8 survives a reload (title: 繼續第 8 關)', { label, before: before.s, after: after.s });

        // restart: first press only arms (moves kept), second press restarts
        await tap(page, cdp, '#bRestart');
        const armed = (await G(page)).st.moves === 2 && await page.evaluate(() => document.getElementById('bRestart').classList.contains('armed'));
        await tap(page, cdp, '#bRestart');
        const s4 = (await G(page)).st;
        ok(armed && s4.moves === 0, '重來 needs a second press when there are moves', { armed, moves: s4.moves });
        ok(!((await ls(page, 'resume')) || {})['8'], 'restart clears the saved unfinished game');
      }

      // hint used -> at most 2 stars; the win is stored as soon as the red car reaches the exit
      await toTitle(page, cdp);
      await openLevel(page, cdp, 3);
      {
        await tap(page, cdp, '#bHint');
        const path = await fullSol(page);
        await solveRest(page, cdp, path.slice(0, -1)); await idle(page);
        const [i, v] = path[path.length - 1];
        await moveCar(page, cdp, i, v);
        await page.waitForFunction(() => window.__game.state().status === 'exiting', null, { polling: 10, timeout: 3000 });
        const stars = await ls(page, 'stars'), prog = await ls(page, 'progress');
        ok(stars && stars['3'] === 2 && prog && prog['3'] === path.length, 'optimal clear after a hint: saved during the exit animation, capped at ★★', { stars, prog });
        await waitVis(page, 'win');
        const msg = await page.textContent('#wMsg');
        ok(/最高 ★★/.test(msg), 'win card explains the ★★ cap', msg);
      }
      ok(!errors.length, 'no page/console errors (390x844)', errors);
      await ctx.close();
    }

  } catch (e) { fail++; console.log('FAIL exception', String(e && e.stack || e).slice(0, 600)); }
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'OK'} parking-escape tests: ${pass} passed, ${fail} failed (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
  process.exit(fail ? 1 : 0);
})();
