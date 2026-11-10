// Regression tests for 三國華容道 (klotski) — one per release-review finding (qa/release/klotski, 2026-11-07).
// Real touch input via CDP Input.dispatchTouchEvent (multi-finger with ids). Waits on conditions, no frame timing.
// Usage: node apps/klotski/demo/tests.js   (prints PASS/FAIL lines; last line is the summary; exit 1 on failure)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const html = fs.readFileSync(process.env.KT_APP || path.resolve(__dirname, '..', 'index.html'), 'utf8');
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, keyOf, decode, reach, pathTo, occGrid, fits, DIRS, setCh};')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const T0 = Date.now();
const ok = (c, name, info) => { if (c) pass++; else fail++; console.log((c ? 'PASS ' : 'FAIL ') + (process.env.KT_TIME ? '[' + ((Date.now() - T0) / 1000).toFixed(1) + 's] ' : '') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); };

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); });
  await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const tStart = Date.now();

  async function open(vp, ls, opts = {}) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: opts.dark ? 'dark' : 'light' });
    if (opts.init) await ctx.addInitScript(opts.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base);
    await page.evaluate(ls => { localStorage.clear(); localStorage.setItem('klotski.seenHelp', 'true'); for (const k in ls) localStorage.setItem('klotski.' + k, JSON.stringify(ls[k])); }, ls || {});
    await page.reload(); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const cdp = await ctx.newCDPSession(page);
    const T = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const st = () => page.evaluate(() => window.__game.state());
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(25); } };
    const idle = () => until(async () => !(await st()).animating);
    const center = async sel => { let b = null; for (let k = 0; k < 200 && !(b = await page.locator(sel).boundingBox()); k++) await sleep(25); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async (pt, id = 0) => { await T('touchStart', [{ ...pt, id }]); await sleep(30); await T('touchEnd', []); };
    const tapSel = async sel => tap(await center(sel));
    const level = async n => { // start a main level through the UI (select screen, unlocked)
      await tapSel('#tSelect'); await until(() => page.isVisible('#grid .lt'));
      await page.locator(`.lt[data-n="${n}"]`).scrollIntoViewIfNeeded(); await tapSel(`.lt[data-n="${n}"]`);
      await until(async () => (await st()).idx === n && await page.isVisible('#hud')); await idle();
    };
    // a piece's screen centre and a drag along the solver path
    const ptOf = (s, p, c) => ({ x: s.ox + ((c % s.W) + p.w / 2) * s.cs, y: s.oy + (((c / s.W) | 0) + p.h / 2) * s.cs });
    const drag = async (pts, id = 0) => {
      await T('touchStart', [{ ...pts[0], id }]); await sleep(16);
      for (let j = 1; j < pts.length; j++) for (let q = 1; q <= 3; q++) { await T('touchMove', [{ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * q / 3, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * q / 3, id }]); await sleep(12); }
      await T('touchEnd', []);
    };
    const step = async (from, to) => { // play one solver step [fromCell, toCell] with a real drag
      const s = await st(), L = { W: s.W, H: s.H }, P = core.decode(L, s.key), i = P.findIndex(p => p.y * s.W + p.x === from);
      const cells = core.pathTo(core.reach(L, P, i), to); await drag(cells.map(c => ptOf(s, P[i], c)));
      await until(async () => (await st()).key !== s.key); await idle();
    };
    return { ctx, page, T, st, until, idle, center, tap, tapSel, level, ptOf, drag, step };
  }
  const singles = s => { // pieces with exactly one free direction (a tap moves them)
    const L = { W: s.W, H: s.H }, P = core.decode(L, s.key);
    return P.map((q, i) => { const o = core.occGrid(L, P, i), dirs = []; for (let d = 0; d < 4; d++) if (q.t !== 'X' && core.fits(L, o, q, q.x + core.DIRS[d][0], q.y + core.DIRS[d][1])) dirs.push(d); return { ...q, i, dirs }; }).filter(q => q.dirs.length === 1);
  };
  const UN = { unlockAll: true };

  // 1) second finger is not swallowed: two-thumb roll on two tap-movable pieces (L4)
  {
    const A = await open({ width: 390, height: 844 }, UN); await A.level(4);
    const s = await A.st(), sg = singles(s); const a = sg[0], b = sg.find(q => q.i !== a.i && (q.x !== a.x || q.y !== a.y));
    const pa = A.ptOf(s, a, a.y * s.W + a.x), pb = A.ptOf(s, b, b.y * s.W + b.x);
    await A.T('touchStart', [{ ...pa, id: 1 }]); await sleep(60);
    await A.T('touchStart', [{ ...pa, id: 1 }, { ...pb, id: 2 }]); await sleep(40);
    await A.T('touchEnd', [{ ...pa, id: 1 }]); await sleep(60); // finger 1 lifts, finger 2 still down
    await A.T('touchEnd', []); await A.idle();
    const s2 = await A.st();
    ok(s2.moves === 2, 'two-finger roll: both tapped pieces move', { moves: s2.moves });

    // 2) 悔棋 with a second finger while the first drags another piece: undo happens, drag is cancelled, no overlap
    const s3 = await A.st(), L = { W: s3.W, H: s3.H }, P = core.decode(L, s3.key);
    let pick = null; for (let i = 0; i < P.length && !pick; i++) { const R = core.reach(L, P, i); if (R.cells.length) pick = { i, to: R.cells[0] }; }
    const p = P[pick.i], path0 = core.pathTo(core.reach(L, P, pick.i), pick.to).map(c => A.ptOf(s3, p, c)), u = await A.center('#bUndo');
    await A.T('touchStart', [{ ...path0[0], id: 1 }]); await sleep(16);
    for (let q = 1; q <= 4; q++) { await A.T('touchMove', [{ x: path0[0].x + (path0[1].x - path0[0].x) * q / 4 * 0.8, y: path0[0].y + (path0[1].y - path0[0].y) * q / 4 * 0.8, id: 1 }]); await sleep(12); }
    const mid = { x: path0[0].x + (path0[1].x - path0[0].x) * 0.8, y: path0[0].y + (path0[1].y - path0[0].y) * 0.8 };
    await A.T('touchStart', [{ ...mid, id: 1 }, { ...u, id: 2 }]); await sleep(40);
    await A.T('touchEnd', [{ ...u, id: 2 }]); await sleep(30); // finger 2 lifts from 悔棋 while finger 1 still holds the piece
    const midDrag = (await A.st()).drag;
    await A.T('touchEnd', []); await A.idle();
    const s4 = await A.st(), P4 = core.decode(L, s4.key), occ = new Array(L.W * L.H).fill(0);
    P4.forEach(q => { for (let j = 0; j < q.h; j++) for (let k = 0; k < q.w; k++) occ[(q.y + j) * L.W + q.x + k]++; });
    ok(s4.moves === 1 && Math.max(...occ) === 1 && !midDrag, 'second finger on 悔棋 during a drag: drag cancelled, one undo, no stacked pieces', { moves: s4.moves, maxStack: Math.max(...occ), midDrag });

    // 3) second finger taps another piece while the first is dragging: the tap is queued and played
    const s5 = await A.st(), sg5 = singles(s5), L5 = { W: s5.W, H: s5.H }, P5 = core.decode(L5, s5.key);
    let dragI = -1; for (let i = 0; i < P5.length; i++) if (core.reach(L5, P5, i).cells.length && !sg5.some(q => q.i === i)) { dragI = i; break; }
    if (dragI < 0) dragI = P5.findIndex((q, i) => core.reach(L5, P5, i).cells.length && i !== sg5[0].i);
    const tapQ = sg5.find(q => q.i !== dragI), dp = P5[dragI], c0 = A.ptOf(s5, dp, dp.y * s5.W + dp.x);
    const nb = core.reach(L5, P5, dragI).cells[0], c1 = A.ptOf(s5, dp, nb), tp = A.ptOf(s5, tapQ, tapQ.y * s5.W + tapQ.x);
    await A.T('touchStart', [{ ...c0, id: 1 }]); await sleep(16);
    const half = { x: c0.x + (c1.x - c0.x) * 0.3, y: c0.y + (c1.y - c0.y) * 0.3 };
    for (let q = 1; q <= 3; q++) { await A.T('touchMove', [{ x: c0.x + (half.x - c0.x) * q / 3, y: c0.y + (half.y - c0.y) * q / 3, id: 1 }]); await sleep(12); }
    await A.T('touchStart', [{ ...half, id: 1 }, { ...tp, id: 2 }]); await sleep(40);
    await A.T('touchEnd', [{ ...tp, id: 2 }]); await sleep(20); // finger 2 lifts first: its tap is queued behind the drag
    const queued = (await A.st()).moves === s5.moves;
    await A.T('touchMove', [{ ...c0, id: 1 }]); await sleep(20); // drag back to where it started: no move of its own
    await A.T('touchEnd', []); await A.idle();
    const s6 = await A.st();
    ok(queued && Math.abs(s6.moves - s5.moves) === 1 && s6.key !== s5.key, // (moving the last-moved piece back pops history: ±1)
       'second-finger tap during a drag is queued, not lost', { before: s5.moves, after: s6.moves, queued });

    // 4) one tap on a game button fires exactly once (pointerup handler + swallowed click)
    if (!(await A.st()).moves) { const q = singles(await A.st())[0], s0 = await A.st(); await A.tap(A.ptOf(s0, q, q.y * s0.W + q.x)); await A.idle(); }
    const s7 = await A.st(); await A.tapSel('#bUndo'); await A.idle(); await sleep(150);
    ok((await A.st()).moves === s7.moves - 1, 'single tap on 悔棋 = exactly one undo', { before: s7.moves, after: (await A.st()).moves });
    await A.ctx.close();
  }

  // 5) unfinished game survives a reload, title offers to continue; old saves still load
  {
    const A = await open({ width: 390, height: 844 }, { unlockAll: true, progress: { cur: 3, best: { 1: 5, 2: 6 }, stars: { 1: 3, 2: 3 }, tot: 11, wins: 2, eff: 2 } });
    ok((await A.page.textContent('#tPlay')) === '開始遊戲', 'old progress save loads (no unfinished game yet)');
    await A.tapSel('#tPlay'); await A.until(async () => (await A.st()).idx === 3 && await A.page.isVisible('#hud')); await A.idle();
    const steps = await A.page.evaluate(() => window.__game.steps());
    await A.step(...steps[0]); await A.step(...steps[1]);
    const k = (await A.st()).key; await A.page.reload(); await A.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await A.until(() => A.page.isVisible('#tPlay'));
    ok((await A.page.textContent('#tPlay')) === '繼續第 3 關', 'title shows 繼續第 3 關 after reload', await A.page.textContent('#tPlay'));
    await A.tapSel('#tPlay'); await A.until(async () => (await A.st()).moves === 2 && await A.page.isVisible('#hud'));
    const s = await A.st(); ok(s.moves === 2 && s.key === k, 'mid-level board and move count restored', { moves: s.moves });
    await A.tapSel('#bUndo'); await A.idle(); ok((await A.st()).moves === 1, 'undo history survives the reload');

    // 6) 重來 with 5+ moves needs a second press
    for (const st of steps.slice(1, 6)) await A.step(...st);
    const m = (await A.st()).moves; await A.tapSel('#bRestart'); await sleep(200);
    const m1 = (await A.st()).moves; await A.tapSel('#bRestart'); await A.until(async () => (await A.st()).moves === 0);
    ok(m >= 5 && m1 === m && (await A.st()).moves === 0, '重來 asks for a second press before wiping 5+ moves', { m, m1 });
    await A.ctx.close();
  }

  // 7) clear is saved the moment 曹操 reaches the gate (reload during the exit animation keeps it)
  //    + pause pressed during the exit animation does not stick on top of the next game
  {
    const A = await open({ width: 390, height: 844 }, {});
    await A.tapSel('#tPlay'); await A.until(async () => (await A.st()).idx === 1 && await A.page.isVisible('#hud')); await A.idle();
    ok((await A.st()).guide === true, 'level 1 shows the on-board guide before the first move');
    const steps = await A.page.evaluate(() => window.__game.steps());
    for (const st of steps.slice(0, -1)) await A.step(...st);
    ok((await A.st()).guide === false, 'guide disappears after the first move');
    const s = await A.st(), L = { W: s.W, H: s.H }, P = core.decode(L, s.key), last = steps[steps.length - 1], i = P.findIndex(p => p.y * s.W + p.x === last[0]);
    await A.drag(core.pathTo(core.reach(L, P, i), last[1]).map(c => A.ptOf(s, P[i], c)));
    await A.until(async () => (await A.st()).won);
    await A.tapSel('#bPause');
    const pauseShown = await A.page.isVisible('#pause');
    const saved = await A.page.evaluate(() => JSON.parse(localStorage.getItem('klotski.progress')));
    ok(saved.best[1] === 5 && saved.stars[1] === 3 && !(await A.st()).winVisible, 'clear written before the exit animation ends', { best: saved.best[1], stars: saved.stars[1] });
    await A.until(() => A.page.isVisible('#win'));
    await A.tapSel('#wRetry'); await A.until(async () => !(await A.st()).won);
    ok(!pauseShown && !(await A.page.isVisible('#pause')) && !(await A.page.isVisible('#win')), 'pause during the exit animation is ignored; 再玩一次 leaves no card', { pauseShown });

    // 8) hints: count kept per level (restart does not refill), and a hinted game is capped at 2 stars
    await A.tapSel('#bHint'); await A.until(async () => (await A.st()).hints === 2);
    await A.tapSel('#bRestart'); await A.idle();
    ok((await A.st()).hints === 2, 'restart does not refill hints', (await A.st()).hints);
    await A.tapSel('#bHint'); await A.until(async () => (await A.st()).hints === 1);
    for (const st of steps) await A.step(...st);
    await A.until(() => A.page.isVisible('#win'));
    ok(await A.page.locator('#wStars .on').count() === 2, 'optimal clear with a hint = 2 stars', await A.page.locator('#wStars .on').count());
    await A.page.reload(); await A.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await A.until(() => A.page.isVisible('#tPlay'));
    ok(await A.page.evaluate(() => JSON.parse(localStorage.getItem('klotski.progress')).hu.m1) === 2, 'used hints persist across reload');

    // 9) replay pauses behind the pause card and resumes after 繼續; watched replay caps the level at 2 stars
    await A.tapSel('#tSelect'); await A.until(() => A.page.isVisible('#grid .lt'));
    await A.tapSel('.lt[data-n="2"]'); await A.until(async () => (await A.st()).idx === 2 && await A.page.isVisible('#hud'));
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pReplay')); await A.tapSel('#pReplay');
    await A.until(async () => ((await A.st()).replay || {}).j >= 2);
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pause'));
    const j0 = (await A.st()).replay.j; await sleep(1400); const j1 = (await A.st()).replay.j;
    await A.tapSel('#pResume'); const resumed = await A.until(async () => ((await A.st()).replay || { j: 99 }).j > j1, 3000);
    ok(j0 === j1 && !!resumed, 'replay waits while paused and resumes after 繼續', { j0, j1 });
    ok((await A.st()).assisted === true, 'watching the replay marks the level as assisted (max 2 stars)');
    await A.ctx.close();
  }

  // 10) layout: stop button 44x44; 360x640 title gap; landscape toast / replay bar off the board, 4x6 cells >= 46, pause card fits
  {
    const A = await open({ width: 390, height: 844 }, UN); await A.level(5);
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pReplay')); await A.tapSel('#pReplay');
    await A.until(() => A.page.isVisible('#replayStop'));
    const rb = await A.until(() => A.page.locator('#replayStop').boundingBox());
    ok(rb.width >= 44 && rb.height >= 44, 'replay stop button >= 44x44', rb);
    await A.tapSel('#replayStop'); await A.until(async () => !(await A.st()).replay);
    await A.page.setViewportSize({ width: 844, height: 390 }); await A.until(async () => (await A.st()).cs !== undefined); await sleep(100);
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pause'));
    const card = await A.page.locator('#pause .card').boundingBox(), sw = await A.page.locator('#setTap').boundingBox();
    ok(card.y >= 0 && card.y + card.height <= 390 && sw.y + sw.height <= 390, 'landscape pause card fits 390 px', { top: card.y, h: card.height });
    await A.tapSel('#pResume');
    const inter = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    const boardBox = s => ({ x: s.ox - s.fr, y: s.oy - s.fr, width: s.W * s.cs + 2 * s.fr, height: s.H * s.cs + 2 * s.fr });
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pSelect')); await A.tapSel('#pSelect');
    await A.until(() => A.page.isVisible('#grid .lt'));
    await A.page.locator('.lt[data-n="41"]').scrollIntoViewIfNeeded(); await A.tapSel('.lt[data-n="41"]');
    await A.until(async () => (await A.st()).idx === 41 && await A.page.isVisible('#toast'));
    const s44 = await A.st(), tb = await A.until(() => A.page.locator('#toast').boundingBox());
    ok(s44.W === 4 && s44.H === 6 && s44.cs >= 46, 'landscape 844x390 4x6 cells >= 46 px', { cs: s44.cs });
    ok(!inter(tb, boardBox(s44)), 'landscape toast does not cover the board', { toast: tb, board: boardBox(s44) });
    await A.tapSel('#bPause'); await A.until(() => A.page.isVisible('#pReplay')); await A.tapSel('#pReplay');
    await A.until(() => A.page.isVisible('#replayBar'));
    const bar = await A.until(() => A.page.locator('#replayBar').boundingBox()), s44b = await A.st();
    ok(!inter(bar, boardBox(s44b)) && bar.x + bar.width <= 844, 'landscape replay bar does not cover the board', { bar });
    await A.ctx.close();

    const B = await open({ width: 360, height: 640 }, {});
    const sub = await B.page.locator('#title .sub').boundingBox(), s = await B.st();
    ok(s.oy - s.fr - (sub.y + sub.height) >= 10, '360x640 title: box clears the subtitle by >= 10 px', { gap: s.oy - s.fr - (sub.y + sub.height) });
    await B.ctx.close();
  }

  // 11) performance: no per-frame shadowBlur on the main canvas; idle board redraws slowly, drags draw every frame
  {
    const init = () => {
      window.__cnt = { clear: 0, blur: 0 };
      const P = CanvasRenderingContext2D.prototype, cr = P.clearRect, d = Object.getOwnPropertyDescriptor(P, 'shadowBlur');
      P.clearRect = function (...a) { if (this.canvas.id === 'cv') window.__cnt.clear++; return cr.apply(this, a); };
      Object.defineProperty(P, 'shadowBlur', { get() { return d.get.call(this); }, set(v) { if (this.canvas.id === 'cv' && v) window.__cnt.blur++; d.set.call(this, v); } });
    };
    for (const dark of [false, true]) {
      const A = await open({ width: 430, height: 932 }, {}, { init, dark });
      await A.tapSel('#tPlay'); await A.until(() => A.page.isVisible('#hud')); await A.idle(); await sleep(300);
      const c0 = await A.page.evaluate(() => ({ ...window.__cnt }));
      const rafN = await A.page.evaluate(() => new Promise(r => { let n = 0; const f = () => { if (++n < 60) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
      const c1 = await A.page.evaluate(() => ({ ...window.__cnt }));
      ok(c1.clear - c0.clear <= rafN / 3, (dark ? 'dark' : 'light') + ': idle redraws throttled', { draws: c1.clear - c0.clear, frames: rafN });
      ok(c1.blur === 0, (dark ? 'dark' : 'light') + ': no shadowBlur on the main canvas', c1.blur);
      await A.ctx.close();
    }
  }

  // 12) level content: variants mixed into 30-69, M strictly increasing, level 100 has its own name
  {
    const mid = LEVELS.slice(29, 69).map(e => e[0]);
    ok(mid.some(s => s.startsWith('5x5')) && mid.some(s => s.startsWith('4x6')) && mid.some(s => s.includes('X')), 'levels 30-69 include 5x5, 4x6 and stone layouts');
    ok(LEVELS.every((e, i) => !i || e[1] > LEVELS[i - 1][1]), 'minimum moves strictly increase over 100 levels');
    const A = await open({ width: 390, height: 844 }, UN); await A.level(100);
    ok((await A.st()).name === '義釋華容', 'level 100 has its own name', (await A.st()).name);
    await A.ctx.close();
  }

  // 13) no ghost clicks (round-2 veto): single CDP taps on every pointerup button, landscape sizes included.
  //     A click whose target differs from the tapped button must not reach the page; stopping the replay must not spend a hint.
  for (const [w, h] of [[844, 390], [667, 375]]) { // portrait never stacks a control under the stop button
    const A = await open({ width: w, height: h }, UN); await A.level(20);
    await A.page.evaluate(() => { window.__clk = []; document.addEventListener('click', e => { const b = e.target.closest('button'); window.__clk.push(b ? b.id : e.target.id || e.target.tagName); }, false); });
    const steps = await A.page.evaluate(() => window.__game.steps());
    await A.step(...steps[0]);
    const tapHold = async (sel, ms) => { const c = await A.center(sel); await A.T('touchStart', [{ ...c, id: 1 }]); await sleep(ms); await A.T('touchEnd', []); await sleep(120); };
    const h0 = (await A.st()).hints;
    await tapHold('#bPause', 60); await A.until(() => A.page.isVisible('#pReplay'));
    await tapHold('#pReplay', 60); await A.until(async () => ((await A.st()).replay || {}).j >= 1);
    await tapHold('#replayStop', 60); await A.until(async () => !(await A.st()).replay); await sleep(500);
    const s1 = await A.st(), clk = await A.page.evaluate(() => window.__clk.splice(0));
    ok(s1.hints === h0 && !clk.includes('bHint') && !clk.includes('bUndo') && !clk.includes('bRestart'), `${w}x${h}: stopping the replay does not click the button that reappears under the finger`, { hints: [h0, s1.hints], clk });
    // slow taps (held 600 ms) still work, once
    const k0 = (await A.st()).moves; await A.step(...steps[k0]); await A.step(...steps[k0 + 1]);
    const m0 = (await A.st()).moves; await tapHold('#bUndo', 600); await A.idle();
    ok((await A.st()).moves === m0 - 1, `${w}x${h}: a slow (600 ms) tap on 悔棋 undoes exactly once`, { m0, m: (await A.st()).moves });
    if (w === 844) { await tapHold('#bMute', 60); await sleep(200); await tapHold('#bMute', 600); await sleep(200);
    ok(await A.page.evaluate(() => JSON.parse(localStorage.getItem('klotski.settings')).sound) === true, `${w}x${h}: mute toggles once per tap (fast + slow)`); }
    await A.ctx.close();
  }

  // 14) 重來 confirmation also holds right after the page opens (round 2: armR started at 0)
  {
    const A = await open({ width: 390, height: 844 }, UN); await A.level(10);
    const steps = await A.page.evaluate(() => window.__game.steps());
    for (const st of steps.slice(0, 5)) await A.step(...st);
    await A.page.reload(); await A.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); await A.until(() => A.page.isVisible('#tPlay'));
    await A.tapSel('#tPlay'); await A.until(async () => (await A.st()).moves === 5 && await A.page.isVisible('#hud'));
    await A.tapSel('#bRestart'); await sleep(200);
    const kept = (await A.st()).moves === 5 && await A.page.evaluate(() => !!JSON.parse(localStorage.getItem('klotski.games')).m10);
    ok(kept, '重來 right after reload still asks for a second press');
    await A.ctx.close();
  }

  ok(errors.length === 0, 'no page or console errors', errors.slice(0, 5));
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'OK'} klotski tests: ${pass} passed, ${fail} failed (${((Date.now() - tStart) / 1000).toFixed(1)}s)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception ' + String(e && e.stack || e).replace(/\n\s*/g, ' | ')); process.exit(1); });
