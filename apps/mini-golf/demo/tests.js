// Regression tests for 果嶺彈珠 (mini-golf). Usage: node tests.js [--core]
// 1) Core (Node, the game's own CORE-START..CORE-END): stored solutions, cup speed, hole 50 dry lane, sliced solver.
// 2) Browser (Chromium, real CDP touch): ghost taps on the win / fail cards, buttons with a second finger down, slow
//    taps, one coin per hint and no long freeze, saving at once on holing, per-stroke stats, resuming a half-played
//    hole, old save keys, hole 61 intro, daily hole and 10-hole round totals, landscape cards that fit, no errors.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {buildLevel, initState, cloneState, simShot, solveLevel, solveIter, replay, PULLMAX, HOLE_VMAX: HOLE_VMAX};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

// ---------- core ----------
{
  let bad = [];
  LEVELS.forEach(d => { const r = C.replay(C.buildLevel(d), d.sol); if (!r.holed || r.strokes !== d.best || d.par !== d.best + 1) bad.push(d.n); });
  ok(!bad.length, 'every stored solution still holes in exactly `best` strokes with par = best+1 (' + bad.join(',') + ')');
  ok(C.HOLE_VMAX >= 480, 'the cup accepts balls up to at least 480 px/s (was 420)');
  // hole 50 used to need a 7 px lane between the water and the corridor wall right where the ball leaves the ice
  const d50 = LEVELS[49], w = d50.z.find(z => z[0] === 3), ice = d50.z.find(z => z[0] === 2);
  const top = Math.max(...d50.f.filter(f => f[0] < w[1] + w[3] && f[0] + f[2] > w[1] && f[1] < w[2] && f[1] + f[3] > w[2]).map(f => f[1]));
  ok(w[2] - (top + 5) >= 15, 'hole 50: dry lane past the pond is at least 15 px for the ball centre (' + (w[2] - top - 5) + ', was 7)');
  ok(ice && ice[1] + ice[3] <= 60, 'hole 50: the ice covers only the left part of the room, so the ball leaves it slowly');
  // hole 100 was a wall right after a smooth hole 99 (world-class 0/7): retuned to a fixed cup, no door and no windmill,
  // and a smaller ice field; the moving board, pond and ice stay (Node sim: world-class 4 of 6 seeds)
  const d100 = LEVELS[99];
  ok(!d100.hm && !(d100.o || []).length && !(d100.w || []).length && d100.par === 4 && d100.num > LEVELS[98].num, 'hole 100: fixed cup, no door, no windmill, par 4, still the highest difficulty number');
  // sliced solver (used by the in-game hint) yields often and returns the same answer as the blocking one
  const L21 = C.buildLevel(LEVELS[59]), S0 = C.initState(L21); S0.t = 77;
  const o = { S0, maxDepth: 1, beam: 4, angStep: 6, pows: [0.25, 0.5, 0.75, 1], phases: 1, refine: 3, minWait: 0, partial: true };
  const a = C.solveLevel(L21, o), it = C.solveIter(L21, Object.assign({ slice: 4 }, o)); let y = 0, r;
  while (!(r = it.next()).done) y++;
  ok(y >= 3 && JSON.stringify(r.value.shots) === JSON.stringify(a.shots), 'sliced hint search yields ' + y + ' times and finds the same shot');
  // the in-game hint on hole 100 (switch, mover, mill, moving cup) after one stroke: count physics ticks between yields
  // (deterministic, no wall clock): the old hint ran ~1 s of search in one task; now no slice may exceed ~2 shots' worth
  const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1].replace('function stepTick(L, S, fx) {', 'function stepTick(L, S, fx) { __n++;');
  const K = new Function('var __n = 0;' + src + '\nreturn {buildLevel, initState, simShot, solveIter, n: function () { return __n; }};')();
  const L100 = K.buildLevel(LEVELS[99]), S1 = K.initState(L100); S1.t = LEVELS[99].sol[0][2]; K.simShot(L100, S1, LEVELS[99].sol[0][0], LEVELS[99].sol[0][1], null);
  const it2 = K.solveIter(L100, { S0: S1, maxDepth: 3, beam: 5, angStep: 4, pows: [0.15, 0.25, 0.36, 0.48, 0.6, 0.74, 0.88, 1], phases: 1, refine: 6, minWait: 0, partial: true, slice: 1 });
  let worst = 0, total = 0, steps = 0, prev = K.n(), r2;
  do { r2 = it2.next(); const d = K.n() - prev; prev = K.n(); worst = Math.max(worst, d); total += d; steps++; } while (!r2.done);
  ok(r2.value && worst <= 130 && steps > 100, 'hole 100 hint search: ' + total + ' ticks in ' + steps + ' slices, at most ' + worst + ' ticks per slice');
}
{
  const withPlanks = LEVELS.filter(d => d.a && d.a.length);
  ok(withPlanks.length >= 5 && withPlanks.every(d => d.n >= 56), 'angled planks appear in ' + withPlanks.length + ' mid/late holes (' + withPlanks.map(d => d.n).join(',') + ')');
  // a ball rolled straight at a plank bounces off it (it is a real wall, not decoration)
  if (withPlanks.length) { const d = withPlanks[0], Lp = C.buildLevel(d), a = d.a[0], mx = (a[0] + a[2]) / 2, my = (a[1] + a[3]) / 2, nx = -(a[3] - a[1]), ny = a[2] - a[0], nl = Math.hypot(nx, ny);
  const S = C.initState(Lp); S.x = mx + nx / nl * 14; S.y = my + ny / nl * 14; S.t = 0;
  const ang = Math.atan2(-ny, -nx); let bounced = false; C.simShot(Lp, S, ang, 0.3, null);
  bounced = ((S.x - mx) * nx + (S.y - my) * ny) > 0;
  ok(bounced, 'hole ' + d.n + ': a ball rolled at the plank stays on its side'); }
  ok(/meadow: '#2a3127'/.test(html), 'dark meadow is the darker grey-green #2a3127 (fairway #2f5d3a)');
}
if (process.argv.includes('--core')) { console.log((fail ? 'FAIL ' : 'OK ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

// ---------- browser ----------
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = (T, ms) => sleep(ms);
async function until(page, fn, arg, ms = 15000) { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(25); } }
const st = page => page.evaluate(() => window.__game.state());
async function open(browser, W, H, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (o.init) await page.addInitScript(o.init);
  // frame callback durations (the game does all its work in requestAnimationFrame, including the sliced hint search)
  await page.addInitScript(() => { window.__rf = []; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raf(ts => { const a = performance.now(); cb(ts); window.__rf.push(performance.now() - a); if (window.__rf.length > 5000) window.__rf.shift(); }); });
  // deviceScaleFactor 1: the canvas is redrawn every frame and several pages run at once; no check depends on DPR
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p[0], y: p[1], id: p[2] || 0 })) });
  return { ctx, page, cdp, touch, errors, W, H };
}
async function center(page, sel) { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function tap(T, sel, hold = 60) { const c = await center(T.page, sel); await T.touch('touchStart', [c]); await wait(T, hold); await T.touch('touchEnd', []); await wait(T, 60); }
// play one shot (world angle/power) with a real touch drag
async function shot(T, ang, pow) {
  const rot = (await T.page.evaluate(() => window.__game.view())).rot, len = pow * C.PULLMAX;
  const wx = Math.cos(ang) * len, wy = Math.sin(ang) * len, ex = rot ? -wy : wx, ey = rot ? wx : wy;
  const sx = T.W / 2 + ex / 2, sy = T.H / 2 + ey / 2;
  await T.touch('touchStart', [[sx, sy]]);
  for (let i = 1; i <= 4; i++) await T.touch('touchMove', [[sx - ex * i / 4, sy - ey * i / 4]]);
  await wait(T, 30); await T.touch('touchEnd', []);
}
async function startHole(T, n) { await T.page.evaluate(n => window.__game.start(n), n); await until(T.page, () => window.__game.state().status === 'play'); }
// hole 1 in one stroke (stored solution); returns when the ball has dropped
async function aceHole1(T) {
  await startHole(T, 1);
  for (let k = 0; k < 4; k++) {
    await shot(T, LEVELS[0].sol[0][0], LEVELS[0].sol[0][1]);
    const s = await until(T.page, () => { const s = window.__game.state(); return s.status !== 'play' || (s.mv === 0 && s.strokes > 0) ? s : null; });
    if (s.status === 'sinking' || s.status === 'won') return true;
    await T.page.evaluate(() => window.__game.start(1));
  }
  return false;
}

// The checks run as independent groups, each in its own browser context (own storage), all at the same time.
// Note: CDP touchEnd lists only the released point.
const GROUPS = {
  // result-card ghost taps (win and fail), saving on the drop
  cardsA(browser, all) { return ghostCards(browser, all, [['next', 400, 1000], ['retry', 400, 1000]], true); },
  cardsB(browser, all) { return ghostCards(browser, all, [['next', 350, 600], ['retry', 600, 60]], false); },
  async failCard(browser, all) {
      const T = await open(browser, 390, 844), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      // fail card ghost: run out of strokes with tiny shots, press during the 0.6 s before the card
      await startHole(T, 1);
      const fBox = [195, 422];
      for (let k = 0; k < 6; k++) {
        const before = (await st(page)).strokes;
        await shot(T, k % 2 ? Math.PI : 0, 0.12);
        await until(page, b => { const s = window.__game.state(); return s.strokes > b && !s.mv; }, before);
        if (process.env.DBG) console.log('fail loop', k, JSON.stringify(await st(page)));
      }
      ok((await st(page)).status === 'failed', 'six strokes on hole 1 (limit par+4) fails the hole');
      await T.touch('touchStart', [fBox]);
      await until(page, () => !document.getElementById('fail').classList.contains('hidden'));
      const fr = await center(page, '#fRetry'); await T.touch('touchMove', [fr]); await wait(T, 900); await T.touch('touchEnd', []); await wait(T, 200);
      ok((await st(page)).status === 'failed' && await page.isVisible('#fail'), 'a finger that was down before the fail card appeared does not press 再試一次');
      await tap(T, '#fRetry', 1000); ok(await until(page, () => window.__game.state().status === 'play'), 'a 1 s tap on 再試一次 works');
  },
  // second finger already down on the course: HUD buttons, pause card; slow taps; hint coins and frames
  async fingers(browser, all) {
      const T = await open(browser, 390, 844), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      { const dl = await page.textContent('#tDaily'), dn = +dl.match(/第 (\d+) 洞/)[1];
        const want = await page.evaluate(() => { const t = new Date(), k = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0; return 1 + h % 10; });
        ok(dn === want, 'a new player\'s daily hole is drawn from holes 1-10, not always hole 1 (' + dn + ')'); }
      await startHole(T, 2);
      await T.touch('touchStart', [[120, 520, 1]]); await T.touch('touchMove', [[120, 560, 1]]);
      const pz = await center(page, '#bPause');
      await T.touch('touchStart', [[120, 560, 1], [pz[0], pz[1], 2]]); await sleep(80); await T.touch('touchEnd', [[pz[0], pz[1], 2]]);
      ok(await until(page, () => window.__game.state().status === 'paused', null, 2000), 'pause works while another finger is on the course');
      const pr = await center(page, '#pResume');
      await T.touch('touchStart', [[120, 560, 1], [pr[0], pr[1], 3]]); await sleep(80); await T.touch('touchEnd', [[pr[0], pr[1], 3]]);
      ok(await until(page, () => window.__game.state().status === 'play', null, 2000), '繼續 on the pause card works while another finger is down');
      for (const sel of ['#bLook', '#bMute']) {
        const before = await page.evaluate(s => document.querySelector(s).outerHTML, sel), c = await center(page, sel);
        await T.touch('touchStart', [[120, 560, 1], [c[0], c[1], 4]]); await sleep(80); await T.touch('touchEnd', [[c[0], c[1], 4]]); await sleep(80);
        ok(before !== await page.evaluate(s => document.querySelector(s).outerHTML, sel), sel + ' toggles while another finger is down');
        await T.touch('touchStart', [[120, 560, 1], [c[0], c[1], 5]]); await sleep(60); await T.touch('touchEnd', [[c[0], c[1], 5]]); await sleep(60); // back
      }
      await T.touch('touchEnd', [[120, 560, 1]]); await sleep(100);
      ok((await st(page)).strokes === 0, 'the held course finger did not fire a shot after the buttons were used');
      // slow taps
      for (const hold of [600, 1000]) {
        const b = await page.getAttribute('#bLook', 'aria-pressed'); await tap(T, '#bLook', hold);
        ok(b !== await page.getAttribute('#bLook', 'aria-pressed'), 'a ' + hold + ' ms tap on 觀察 toggles it');
      }
      if ((await page.getAttribute('#bLook', 'aria-pressed')) === 'true') await tap(T, '#bLook');
      // no double action: one tap = one toggle
      { const b = await page.getAttribute('#bLook', 'aria-pressed'); await tap(T, '#bLook'); await sleep(250);
        ok(b !== await page.getAttribute('#bLook', 'aria-pressed'), 'one tap toggles 觀察 exactly once'); await tap(T, '#bLook'); }

      // hints: double tap at the tee costs one coin; on a hole with moving parts, three taps while thinking cost one coin
      await page.evaluate(() => { localStorage.setItem('minigolf.coins', '3'); });
      await page.reload(); await until(page, () => !!window.__game);
      await startHole(T, 4);
      await tap(T, '#bHint', 40); await sleep(65); await tap(T, '#bHint', 40);
      await sleep(300);
      ok(await page.textContent('#hCoins') === '2', 'double tap on 提示 at the tee of hole 4 costs one coin (coins ' + await page.textContent('#hCoins') + ')');
      await startHole(T, 21);
      await shot(T, LEVELS[20].sol[0][0], LEVELS[20].sol[0][1] * 0.6);
      await until(page, () => { const s = window.__game.state(); return s.mv === 0 && s.strokes > 0 && s.status === 'play'; });
      await page.evaluate(() => { window.__rf.length = 0; });
      await tap(T, '#bHint'); await tap(T, '#bHint'); await tap(T, '#bHint');
      await until(page, () => !document.getElementById('bHint').classList.contains('busy'), null, 30000);
      const rf = await page.evaluate(() => window.__rf.slice());
      ok(await page.textContent('#hCoins') === '1', 'three taps on 提示 while it is thinking cost one coin (coins ' + await page.textContent('#hCoins') + ')');
      const worst = Math.max(...rf), slow = rf.filter(d => d > 4).length;
      ok(rf.length >= 5, 'the page keeps drawing frames while the hint is worked out (' + rf.length + ' frames, ' + slow + ' with search work)');
  },
  // stats saved per stroke; a half-played hole resumes after reload; HUD banner; hole 61 intro and help; 44x44
  async resume(browser, all) {
      const T = await open(browser, 390, 844), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      await startHole(T, 3);
      const s0 = JSON.parse(await page.evaluate(() => localStorage.getItem('minigolf.stats') || '{"strokes":0}')).strokes;
      await shot(T, -1.57, 0.35);
      await until(page, () => { const s = window.__game.state(); return s.mv === 0 && s.strokes === 1; });
      const pos = await st(page);
      ok(JSON.parse(await page.evaluate(() => localStorage.getItem('minigolf.stats'))).strokes === s0 + 1, 'total strokes are saved after each stroke, not only on holing');
      await page.reload(); await wait(T, 300); await until(page, () => !!window.__game);
      ok(/繼續第 3 洞/.test(await page.textContent('#tPlay')), 'after a reload the title offers to continue hole 3 (' + await page.textContent('#tPlay') + ')');
      await tap(T, '#tPlay');
      await until(page, () => window.__game.state().status === 'play' || !document.getElementById('intro').classList.contains('hidden'));
      if (await page.isVisible('#intro')) await tap(T, '#iOk');
      const r1 = await st(page);
      ok(r1.level === 3 && r1.strokes === 1 && Math.abs(r1.x - pos.x) < 1e-6 && Math.abs(r1.y - pos.y) < 1e-6, 'the hole resumes with 1 stroke at the same ball position');
      await tap(T, '#bRestart'); ok((await st(page)).strokes === 0, '重來 starts the hole from the tee');
      // reload while a shot is still rolling: the shot counts and the ball resumes where it stops (no mulligan)
      await startHole(T, 36);
      await shot(T, -1.57, 0.3); await until(page, () => { const s = window.__game.state(); return s.mv === 0 && s.strokes >= 1; });
      const k1 = (await st(page)).strokes;
      await shot(T, -1.2, 1); await until(page, () => window.__game.state().mv === 1, null, 3000); await sleep(120);
      const pre = await st(page);
      await page.reload(); await until(page, () => !!window.__game);
      const tp = await page.textContent('#tPlay'), km = +((tp.match(/已打 (\d+) 桿/) || [])[1] || 0);
      await tap(T, '#tPlay'); await until(page, () => window.__game.state().status === 'play' || !document.getElementById('intro').classList.contains('hidden'));
      if (await page.isVisible('#intro')) await tap(T, '#iOk');
      const r36 = await st(page);
      ok(km >= k1 + 1 && r36.strokes === km && (Math.hypot(r36.x - pre.sx, r36.y - pre.sy) > 1 || km >= k1 + 2),
        'reloading 120 ms into a full-power shot on hole 36 keeps that stroke (' + tp + ', ball ' + Math.round(r36.x) + ',' + Math.round(r36.y) + ' vs shot start ' + Math.round(pre.sx) + ',' + Math.round(pre.sy) + ')');
      await tap(T, '#bRestart');
      ok(!JSON.parse(await page.evaluate(() => localStorage.getItem('minigolf.cur')))[3], '重來 clears the saved half-played hole');
      // the hole-start banner is in the HUD now (no toast over the course top)
      ok(await page.evaluate(() => document.querySelector('.hmid').classList.contains('flash') && !/^第 \d+ 洞・標準桿/.test(document.getElementById('toast').textContent)),
        'starting a hole highlights the HUD instead of a toast over the course');
      // help explains the short aim line; hole 61 introduces it
      await page.evaluate(() => { localStorage.setItem('minigolf.unlockAll', 'true'); localStorage.removeItem('minigolf.intro'); });
      await page.reload(); await wait(T, 300); await until(page, () => !!window.__game);
      await tap(T, '#tSelect'); await page.evaluate(() => document.querySelector('.lt[data-n="61"]').scrollIntoView({ block: 'center' })); await wait(T, 200);
      await tap(T, '.lt[data-n="61"]');
      ok(await until(page, () => !document.getElementById('intro').classList.contains('hidden') && /瞄準線/.test(document.getElementById('iTitle').textContent), null, 3000), 'hole 61 opens with an intro card about the short aim line');
      await tap(T, '#iOk');
      await tap(T, '#bPause'); await tap(T, '#pHelp');
      ok(/第 61 洞起/.test(await page.textContent('#helpBody')), 'the help explains the aim line is short from hole 61');
      ok((await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.getClientRects().length).every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }))), 'visible buttons are at least 44x44');
  },
  // old save keys, daily hole, round totals (360x640 dark)
  async saves(browser, all) {
      const T = await open(browser, 360, 640, { dark: true, init: () => { if (!localStorage.getItem('minigolf.progress')) { const p = {}, s = {}; for (let n = 1; n <= 10; n++) { p[n] = 1; s[n] = 3; } localStorage.setItem('minigolf.progress', JSON.stringify(p)); localStorage.setItem('minigolf.stars', JSON.stringify(s)); localStorage.setItem('minigolf.coins', '5'); localStorage.setItem('minigolf.stats', JSON.stringify({ strokes: 10, holes: 10, ace: 10, diff: -12, portal3: 0, water: 0 })); } } }), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      const dl = await page.textContent('#tDaily');
      ok(/每日一洞・第 \d+ 洞/.test(dl), 'the title shows today\'s daily hole (' + dl + ')');
      const dn = +dl.match(/第 (\d+) 洞/)[1];
      ok(dn >= 1 && dn <= 11, 'the daily hole is one you have unlocked (' + dn + ')');
      // a new player's daily hole comes from holes 1-10 (same date hash as the game)
      const want = await page.evaluate(() => { const t = new Date(), k = t.getFullYear() + '-' + (t.getMonth() + 1) + '-' + t.getDate(); let h = 2166136261; for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0; return [1 + h % 10, 1 + h % 11]; });
      ok(dn === want[1], 'with 10 holes done the daily hole is drawn from holes 1-11 (' + dn + ')');
      // holes that would be drawn below 0.85x at 360x640 are drawn larger and the camera keeps the ball on screen
      for (const n of [12, 24, 31, 83, 92]) {
        await page.evaluate(n => window.__game.start(n), n);
        // the camera eases toward the ball, so give it time on a slow machine instead of a fixed wait
        let v; for (let t = 0; t < 30; t++) { await sleep(100); v = await page.evaluate(() => { const v = window.__game.view(), s = window.__game.state(); return { s: v.s, scroll: v.scroll, bx: v.a * s.x + v.c * s.y + v.e, by: v.b * s.x + v.d * s.y + v.f }; }); if (t >= 2 && v.bx > 10 && v.bx < 350 && v.by > 60 && v.by < 580) break; }
        ok(v.s >= 0.85 && v.bx > 10 && v.bx < 350 && v.by > 60 && v.by < 580, `hole ${n} at 360x640: scale ${v.s.toFixed(2)}${v.scroll ? ' with scrolling camera' : ''}, ball on screen at ${Math.round(v.bx)},${Math.round(v.by)}`);
      }
      await page.reload(); await until(page, () => !!window.__game);
      await tap(T, '#tSelect');
      ok(/一輪最佳合計 10 桿・標準 \d+/.test(await page.textContent('#grid')), 'a finished 10-hole round shows its total strokes vs par');
      ok(/已完成 10 \/ 100/.test(await page.textContent('#selSum')), 'old saves load (10 holes done)');
      await tap(T, '#sBack'); await tap(T, '#tStats');
      ok(/低於標準一輪/.test(await page.textContent('#statsBody')) && /達成/.test(await page.textContent('#statsBody')), 'stats list the new achievements');
      const sc = await page.evaluate(() => window.__game.start(100) || window.__game.view().s);
      ok(sc > 0, 'dark mode hole 100 renders');
  },
  // landscape: result and menu cards fit without scrolling
  land844(browser, all) { return landscape(browser, all, 844, 390); },
  land667(browser, all) { return landscape(browser, all, 667, 375); },
};
async function ghostCards(browser, all, cases, first) {
      const T = await open(browser, 390, 844), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      // the result card positions (measured from a first normal win)
      ok(await aceHole1(T), 'hole 1 can be holed with a real touch drag');
      if (first) ok(await until(page, () => JSON.parse(localStorage.getItem('minigolf.progress') || '{}')[1] === 1 && window.__game.state().status === 'sinking'),
        'progress is saved the moment the ball drops, before the result card');
      if (first) ok(await until(page, () => window.__game.prepared(2)), 'hole 2 (map, meadow, scenery) is prepared in the background while the result card is up');
      await until(page, () => !document.getElementById('win').classList.contains('hidden'));
      const boxes = { next: await center(page, '#wNext'), retry: await center(page, '#wRetry') };
      // ghost taps: finger goes down on the course while the ball sinks, lifts after the card is up
      // (a press only counts as "before the card" when the page itself saw the card still hidden at pointerdown; under
      //  heavy load the wall-clock delay can overshoot, then the case is played again)
      await page.evaluate(() => addEventListener('pointerdown', () => { window.__downHidden = document.getElementById('win').classList.contains('hidden'); }, true));
      for (const [which, downAt, hold] of cases) {
        let valid = false, s = null;
        for (let tries = 0; tries < 4 && !valid; tries++) {
          ok(await aceHole1(T), 'ace again');
          const t0 = Date.now(); while (Date.now() - t0 < downAt) await sleep(10);
          await T.touch('touchStart', [boxes[which]]);
          if (hold > 300) await until(page, () => !document.getElementById('win').classList.contains('hidden'));
          await sleep(hold > 300 ? Math.max(0, hold - (Date.now() - t0 - downAt)) : hold);
          await T.touch('touchEnd', []);
          valid = await page.evaluate(() => window.__downHidden);
          await until(page, () => !document.getElementById('win').classList.contains('hidden') || window.__game.state().status === 'play');
          await wait(T, 150);
          s = await st(page);
          if (!valid && s.status === 'play') await page.evaluate(() => window.__game.start(1));
        }
        ok(valid && s.status === 'won' && s.level === 1 && await page.isVisible('#win'),
          `finger down ${downAt} ms after holing on "${which}" (before the card), held ${hold} ms: stays on the result card (${s.status}, hole ${s.level})`);
      }
      // a fresh tap on the card still works, also a slow one
      await tap(T, '#wRetry', 600); ok((await until(page, () => window.__game.state().status === 'play' && window.__game.state().strokes === 0)), 'a 0.6 s tap on 再打一次 restarts the hole');
}
async function landscape(browser, all, W, H) {
      const T = await open(browser, W, H), { page } = T; all.push(T);
      await until(page, () => !!window.__game);
      ok(await aceHole1(T), 'landscape ace ' + W + 'x' + H);
      await until(page, () => !document.getElementById('win').classList.contains('hidden'));
      for (const ov of ['win', 'pause', 'help', 'stats', 'skinOv']) {
        if (ov !== 'win') await page.evaluate(o => { const m = { pause: '#wSelect', help: null }; document.querySelectorAll('.ov').forEach(e => e.classList.add('hidden')); document.getElementById(o).classList.remove('hidden'); }, ov);
        const r = await page.evaluate(o => { const c = document.querySelector('#' + o + ' .card').getBoundingClientRect(); const bs = [...document.querySelectorAll('#' + o + ' button')].map(b => b.getBoundingClientRect()); return { top: c.top, bottom: c.bottom, h: c.height, low: Math.max(...bs.map(b => b.bottom)) }; }, ov);
        ok(r.top >= 0 && r.bottom <= H + 0.5 && r.low <= H, `${W}x${H}: the ${ov} card fits on screen (top ${Math.round(r.top)}, bottom ${Math.round(r.bottom)}, height ${Math.round(r.h)})`);
      }
}

(async () => {
  const browser = await chromium.launch();
  const all = [], t0 = Date.now();
  try {
    await Promise.all(Object.keys(GROUPS).map(async k => {
      const t = Date.now();
      try { await GROUPS[k](browser, all); } catch (e) { fail++; console.log('FAIL exception in ' + k, e && e.stack || e); }
      if (process.env.TIMES) console.log('  group', k, ((Date.now() - t) / 1000).toFixed(1) + 's');
    }));
    for (const T of all) ok(!T.errors.length, T.W + 'x' + T.H + ': no page or console errors ' + T.errors.slice(0, 3).join(' | '));
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack || e); }
  await browser.close();
  if (process.env.TIMES) console.log('  browser part', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log((fail ? 'FAIL ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
