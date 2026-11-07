// Regression tests for 星環迷宮 (gravity-maze). Usage: node tests.js
// Node part: every level solvable with its embedded optimum, difficulty monotonic, early single-ball levels cannot be
// cleared by a fixed tapping rhythm, daily maze ramps over the week.
// Browser part (Chromium, 390x844 phone, real CDP touch events): taps during animations are queued (none dropped),
// an arc / twist of 90° turns once, restart can be undone, the menu opens after a running turn, the level in progress
// survives a reload, watching the shortest solution caps the level at two stars, a repeated hint on the same position
// is free, clears are saved the moment the winning turn is made, the canvas slows down under cards, board sizes.
// All waits are on conditions (no fixed sleeps for results), so it stays stable on a loaded 2-core runner.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(core + '\nreturn {parseLevel, initState, rotate, solve, isWin, stateKey};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const T0 = Date.now();

// ---------- node: levels ----------
{
  // (demo/verify.js --solve-only re-solves all 100; here the levels reworked in the 2026-11 fix plus a spread)
  let bad = [];
  for (let n = 1; n <= LEVELS.length; n++) if (n > 1 && !(LEVELS[n - 1][2] > LEVELS[n - 2][2])) bad.push(n + ':D');
  for (const n of [1, 2, 4, 7, 8, 9, 14, 15, 20, 23, 26, 29, 30, 33, 34, 35, 36, 40, 43, 44, 45, 46, 48, 49, 50, 63, 64, 65, 68, 75]) {
    const [s, M] = LEVELS[n - 1], L = C.parseLevel(s), r = C.solve(L, C.initState(L), 3000000, false);
    if (!r || r.len !== M) bad.push(n + ':' + (r && r.len) + '!=' + M);
  }
  ok(LEVELS.length === 100 && !bad.length, 'levels solvable with exact embedded optimum, D increasing ' + bad.join(' '));
}
// fixed rhythms (CW only, CCW only, CW CW CCW, CCW CCW CW, CW CCW) never clear the early single-ball levels
function mashWins(L, pat) {
  let S = C.initState(L); const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const key = C.stateKey(S) + '|' + (i % pat.length); if (seen.has(key)) return 0; seen.add(key);
    const r = C.rotate(L, S, pat[i % pat.length]); if (r.dead.length) return 0; S = r.S; if (C.isWin(S)) return i + 1;
  }
  return 0;
}
const PATS = [[1], [-1], [1, 1, -1], [-1, -1, 1], [1, -1]];
{
  const mashable = [];
  for (let n = 2; n <= 49; n++) { const L = C.parseLevel(LEVELS[n - 1][0]); PATS.forEach(p => { const w = mashWins(L, p); if (w) mashable.push(n + ':' + p.join(',') + 'x' + w); }); }
  ok(!mashable.length, 'levels 2-49 resist fixed tapping rhythms ' + mashable.join(' '));
  const glue = []; for (let n = 31; n <= 49; n++) if (LEVELS[n - 1][0].includes('g')) glue.push(n);
  ok(glue.length >= 2 && /lv:(\d+), key:'glue'/.exec(html)[1] <= glue[0], 'glue appears in the two-ball middle levels (' + glue.join(',') + ') with its intro card first');
}
// daily maze: same date -> same maze, Monday short, Sunday long with three balls
{
  const src = html.match(/function mulberry32[\s\S]*?dailyInfo = day;\n}\n/)[0];
  let Dmin = Infinity, Dmax = -Infinity; LEVELS.forEach(e => { Dmin = Math.min(Dmin, e[2]); Dmax = Math.max(Dmax, e[2]); });
  const mk = new Function('LEVELS', 'Dmin', 'Dmax', 'FIXED', core + '\nvar dailyKey,dailyLevel;var Date=function(){return FIXED;};\n' + src + '\nmakeDaily();return {key:dailyKey,L:dailyLevel};');
  const day = d => mk(LEVELS, Dmin, Dmax, d);
  const mon = day(new Date(2026, 10, 2)), sun = day(new Date(2026, 10, 8)), mon2 = day(new Date(2026, 10, 2));
  ok(mon.L.str === mon2.L.str, 'daily maze deterministic per date');
  ok(mon.L.opt <= 11 && sun.L.opt >= 17 && sun.L.cols.length === 3 && mon.L.cols.length === 2, 'daily ramps Monday ' + mon.L.opt + ' -> Sunday ' + sun.L.opt + ' (3 balls)');
}

// ---------- browser ----------
let chromium; try { chromium = require('/opt/node22/lib/node_modules/playwright').chromium; } catch (e) { chromium = require('playwright').chromium; }
const URL = 'http://gravity-maze.test/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(page, fn, arg, ms = 20000) { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 30 }); return true; } catch (e) { return false; } }
async function open(browser, vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'dark', storageState: o.storage });
  await ctx.addInitScript(() => { try { localStorage.setItem('gravmaze.unlockAll', 'true'); localStorage.setItem('gravmaze.intro', JSON.stringify({ basic: 1, spike: 1, two: 1, door: 1, glue: 1, box: 1, three: 1, portal: 1 })); } catch (e) {} });
  await ctx.addInitScript(() => { window.__ev = []; ['pointerdown', 'pointerup', 'pointercancel', 'click', 'contextmenu'].forEach(t => document.addEventListener(t, e => { const b = e.target.closest && e.target.closest('button'); window.__ev.push(t + ':' + (b ? b.id : e.target.id || e.target.tagName) + '@' + Math.round(performance.now())); if (window.__ev.length > 40) window.__ev.shift(); }, true)); });
  await ctx.route('**/*', r => r.request().url() === URL ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }) : r.abort());
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e)); page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL); await page.waitForFunction(() => window.__game);
  return { ctx, page, cdp, errors };
}
const st = T => T.page.evaluate(() => window.__game.state());
const vis = (T, id) => T.page.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);
async function center(T, sel) { const b = await T.page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
async function tdown(T, p) { await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] }); }
async function tup(T) { await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
// cards pop in with a scale animation: measure a button only once its card has stopped moving
const still = T => waitFor(T.page, () => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.ov')), null, 5000);
async function tap(T, sel) { await still(T); const p = await center(T, sel); await tdown(T, p); await sleep(30); await tup(T); }
const settled = (T, moves, ms) => waitFor(T.page, m => { const s = window.__game.state(); return !s.animating && (m == null || s.moves === m); }, moves, ms);
async function level(T, n, reload) {
  if (reload) { await T.page.reload(); await T.page.waitForFunction(() => window.__game); }
  await tap(T, '#tSelect'); await waitFor(T.page, () => document.querySelector('.lt[data-n="1"]'));
  await T.page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded();
  await tap(T, '.lt[data-n="' + n + '"]'); await waitFor(T.page, x => window.__game.state().status === 'play' && window.__game.state().level === x, n);
}
// schedule taps without awaiting each one, so CDP round-trips do not slow the tap rate
async function rapid(T, pts, gap) {
  const ps = [];
  pts.forEach((p, i) => { ps.push(new Promise(r => setTimeout(() => tdown(T, p).then(r, r), i * gap))); ps.push(new Promise(r => setTimeout(() => tup(T).then(r, r), i * gap + Math.min(50, gap / 2)))); });
  await Promise.all(ps);
}
async function arc(T, cx, cy, rad, deg, dir) {
  const a0 = -Math.PI / 2 - dir * deg / 2 * Math.PI / 180, steps = Math.max(6, Math.round(deg / 6)), pt = a => ({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
  await tdown(T, pt(a0));
  for (let i = 1; i <= steps; i++) await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(a0 + dir * deg * Math.PI / 180 * i / steps)] });
  await tup(T);
}

(async () => {
  const browser = await chromium.launch();
  try {
    const T = await open(browser, { width: 390, height: 844 });
    await level(T, 15);
    const cw = await center(T, '#bCW'), ccw = await center(T, '#bCCW');
    // 1) 16 alternating taps at 8/s: every tap becomes a turn
    await rapid(T, Array.from({ length: 16 }, (_, i) => i % 2 ? ccw : cw), 125);
    ok(await settled(T, 16), 'rapid 8/s alternating: 16/16 turns (got ' + (await st(T)).moves + ')');
    // 2) burst of 3 on one button within 200 ms
    await tap(T, '#bRestart'); await settled(T, 0);
    await rapid(T, [cw, cw, cw], 90);
    ok(await settled(T, 3), 'burst of 3 taps: 3 turns (got ' + (await st(T)).moves + ')');
    // 3) restart can be undone
    await tap(T, '#bRestart'); await settled(T, 0);
    ok((await T.page.evaluate(() => document.getElementById('bUndo').disabled)) === false, 'undo enabled right after restart');
    await tap(T, '#bUndo'); ok(await settled(T, 3), 'undo after restart restores the 3 turns');
    // 4) undo during a running turn is not ignored
    await tap(T, '#bCW'); await tap(T, '#bUndo'); ok(await settled(T, 3), 'undo pressed mid-animation applies (4 -> 3)');
    // 4b) undo taps queue behind turns (FIFO): CW CCW CW undo x4 at 8/s = 8 net turns
    await tap(T, '#bRestart'); await settled(T, 0);
    { const u = await center(T, '#bUndo'), seq = []; for (let k = 0; k < 4; k++) seq.push(cw, ccw, cw, u);
      await rapid(T, seq, 125); ok(await settled(T, 8) && (await st(T)).moves === 8, 'CW,CCW,CW,undo x4 at 8/s: 8 net turns (got ' + (await st(T)).moves + ')'); }
    // 4c) the restart can only be undone until the next turn
    await tap(T, '#bRestart'); await settled(T, 0);
    await tap(T, '#bCW'); await settled(T, 1); await tap(T, '#bUndo'); await settled(T, 0);
    ok((await T.page.evaluate(() => document.getElementById('bUndo').disabled)) === true, 'after a new turn the old game is no longer brought back by undo');
    // 5) gestures: a 90° and a 120° arc and a two-finger 90° twist each turn once; 200° turns twice
    const g = await T.page.evaluate(() => window.__game.geom());
    for (const [deg, want] of [[90, 1], [120, 1], [200, 2]]) {
      await tap(T, '#bRestart'); if (!(await settled(T, 0, 5000))) console.log('DEBUG restart missed', await T.page.evaluate(() => window.__ev.slice(-12).join(' ')));
      await arc(T, g.cx, g.cy, Math.min(140, g.side * 0.45), deg, 1);
      ok(await settled(T, want) && (await st(T)).moves === want, 'arc ' + deg + '° turns ' + want + ' (got ' + (await st(T)).moves + ') ' + await T.page.evaluate(() => window.__game.trace()));
    }
    await tap(T, '#bRestart'); if (!(await settled(T, 0, 5000))) console.log('DEBUG restart missed', (await st(T)).moves, await T.page.evaluate(() => window.__ev.slice(-12).join(' ')));
    { const r = 80, pts = a => [{ x: g.cx + Math.cos(a) * r, y: g.cy + Math.sin(a) * r, id: 1 }, { x: g.cx - Math.cos(a) * r, y: g.cy - Math.sin(a) * r, id: 2 }];
      await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) });
      for (let i = 1; i <= 15; i++) await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(i / 15 * Math.PI / 2) });
      await tup(T);
      ok(await settled(T, 1) && (await st(T)).moves === 1, 'two-finger twist 90° turns once (got ' + (await st(T)).moves + ') ' + await T.page.evaluate(() => window.__game.trace())); }
    // 6) menu pressed during a turn opens once the turn lands
    await tap(T, '#bRestart'); await settled(T, 0);
    { const pb = await center(T, '#bPause'); await rapid(T, [cw, ccw, cw, pb], 100); }
    ok(await waitFor(T.page, () => !document.getElementById('pause').classList.contains('hidden') && window.__game.state().status === 'paused'), 'menu tapped behind queued turns opens the pause card');
    ok((await st(T)).moves === 3, 'all 3 queued turns run before the menu opens (got ' + (await st(T)).moves + ')');
    // 7) canvas redraws slowly while a card covers it
    { const d0 = (await T.page.evaluate(() => window.__game.geom())).draws; const t0 = Date.now(); await sleep(1000);
      const d1 = (await T.page.evaluate(() => window.__game.geom())).draws, fps = (d1 - d0) / ((Date.now() - t0) / 1000);
      ok(fps <= 15, 'pause card: canvas redraw ~10 fps (' + fps.toFixed(1) + ')'); }
    await tap(T, '#pResume'); await waitFor(T.page, () => window.__game.state().status === 'play');
    // 8) hint on an unchanged position is free
    await tap(T, '#bHint'); await tap(T, '#bHint'); await tap(T, '#bHint');
    ok((await st(T)).hints === 2, 'three hint taps on the same position use one hint (left ' + (await st(T)).hints + ')');
    // 9) the level in progress survives a reload and the title offers to continue it
    const before = (await st(T)).moves;
    await T.page.reload(); await T.page.waitForFunction(() => window.__game);
    ok(await waitFor(T.page, () => document.getElementById('tPlay').textContent.includes('第 15 關')), 'title button offers to continue level 15');
    await tap(T, '#tHelp'); await waitFor(T.page, () => !document.getElementById('help').classList.contains('hidden'));
    ok(/40°/.test(await T.page.textContent('#helpBody')), 'help explains the arc gesture (40°, then every 90°)');
    await tap(T, '#hOk'); ok(await waitFor(T.page, () => !document.getElementById('title').classList.contains('hidden'), null, 5000), 'help closes back to the title ' + await T.page.evaluate(() => [...document.querySelectorAll('.ov')].filter(o => !o.classList.contains('hidden')).map(o => o.id) + ' ' + window.__game.state().status + ' ' + window.__ev.slice(-8).join(' ')));
    await tap(T, '#tPlay'); await waitFor(T.page, () => window.__game.state().status === 'play');
    ok((await st(T)).moves === before && (await st(T)).level === 15 && (await st(T)).hints === 2, 'reload resumes level 15 with ' + before + ' turns and 2 hints');
    // 10) a clear is stored when the winning turn is made, not after the roll animation; then 看最少解 caps at ★★
    await level(T, 1, true);
    const sol = await T.page.evaluate(() => window.__game.solution());
    for (let i = 0; i < sol.length - 1; i++) { await tap(T, sol[i] > 0 ? '#bCW' : '#bCCW'); await settled(T, i + 1); }
    await tap(T, sol[sol.length - 1] > 0 ? '#bCW' : '#bCCW');
    const saved = await T.page.evaluate(() => ({ p: JSON.parse(localStorage.getItem('gravmaze.progress') || '{}')[1], anim: window.__game.state().animating }));
    ok(saved.anim && saved.p && saved.p.s === 3, 'L1 three-star clear saved while the last turn is still animating');
    ok(await waitFor(T.page, () => !document.getElementById('win').classList.contains('hidden')), 'win card shown');
    await tap(T, '#wReplay'); ok(await waitFor(T.page, () => !document.getElementById('win').classList.contains('hidden') && document.getElementById('wTitle').textContent === '最少解示範'), 'shortest-solution replay finishes');
    await T.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('gravmaze.progress')); delete p[1]; localStorage.setItem('gravmaze.progress', JSON.stringify(p)); });
    await level(T, 1, true);   // reload so the in-memory record of the first clear is gone too
    for (let i = 0; i < sol.length; i++) { await tap(T, sol[i] > 0 ? '#bCW' : '#bCCW'); if (i < sol.length - 1) await settled(T, i + 1); }
    ok(await waitFor(T.page, () => !document.getElementById('win').classList.contains('hidden')), 'replayed clear shows the win card');
    { const r = await T.page.evaluate(() => ({ on: document.querySelectorAll('#wStars .on').length, p: (JSON.parse(localStorage.getItem('gravmaze.progress'))[1] || {}).s, msg: document.getElementById('wMsg').textContent, t: document.getElementById('wTitle').textContent }));
      ok(r.on === 2 && r.p === 2, 'after watching the solution the level gives at most ★★ ' + JSON.stringify(r)); }
    ok(!T.errors.length, 'no page/console errors (390x844) ' + T.errors.join(' | '));
    await T.ctx.close();

    // 11) board sizes: landscape and short lobby frames get a big board; the ring stays off the tools on 430x740
    for (const [w, h, min, scheme] of [[844, 390, 245, 'light'], [740, 360, 220, 'dark'], [375, 500, 220, 'dark'], [430, 740, 300, 'dark'], [360, 640, 250, 'light']]) {
      const V = await open(browser, { width: w, height: h }, { scheme });
      await level(V, 50);
      const geo = await V.page.evaluate(() => { const g = window.__game.geom(), t = document.getElementById('tools').getBoundingClientRect(), r = document.getElementById('bCW').getBoundingClientRect(); return Object.assign(g, { toolsTop: t.top, toolsBottom: t.bottom, rotTop: r.top, sw: document.documentElement.scrollWidth }); });
      ok(geo.side >= min, w + 'x' + h + ' board ' + Math.round(geo.side) + 'px >= ' + min);
      ok(geo.sw <= w, w + 'x' + h + ' no horizontal scroll');
      if (w === 430) ok(geo.cy + geo.ringOuter <= geo.toolsTop + 0.5, '430x740 ring stays above the tools (' + Math.round(geo.cy + geo.ringOuter) + ' <= ' + Math.round(geo.toolsTop) + ')');
      if (h > w) ok(geo.rotTop - geo.toolsBottom >= 10, w + 'x' + h + ' tools clear of the rotate buttons');
      if (h > w) ok(geo.cy + 0.7071 * geo.side <= geo.toolsTop + 0.5, w + 'x' + h + ' board corners stay above the tools mid-turn');
      if (w > h) { const barB = await V.page.evaluate(() => Math.max(document.getElementById('bMute').getBoundingClientRect().bottom, document.getElementById('tools').getBoundingClientRect().bottom));
        ok(geo.cy - geo.ringOuter >= barB - 0.5, w + 'x' + h + ' ring stays below the top bar (' + Math.round(geo.cy - geo.ringOuter) + ' >= ' + Math.round(barB) + ')');
        await tap(V, '#bPause'); await waitFor(V.page, () => window.__game.state().status === 'paused');
        const fit = await V.page.evaluate(() => [...document.querySelectorAll('#pause button')].every(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
        ok(fit, w + 'x' + h + ' pause card fits without scrolling'); }
      if (scheme === 'light') { await V.page.evaluate(() => { const t = document.getElementById('toast'); t.classList.remove('hidden'); });
        const bg = await V.page.evaluate(() => getComputedStyle(document.getElementById('toast')).backgroundColor); ok(/255, 255, 255/.test(bg), 'light-mode toast is light (' + bg + ')'); }
      ok(!V.errors.length, w + 'x' + h + ' no errors ' + V.errors.join(' | '));
      await V.ctx.close();
    }
  } finally { await browser.close(); }
  console.log((fail ? 'FAIL ' : '') + 'gravity-maze tests: ' + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - T0) / 1000).toFixed(1) + 's)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e && e.stack || e); process.exit(1); });
