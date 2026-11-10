// Regression tests for 螺旋墜落 (helix-drop): one check per release-review finding (2026-11-02).
// Part 1 runs the game's own CORE (tower generator) in Node. Part 2 opens the real page in mobile Chromium with real
// CDP touch; the page is served from memory at a fake https origin (localStorage survives reloads) with a test hook
// appended inside the game closure (served copy only, the file on disk is untouched); every other request is aborted
// (= offline) and counted. Waits poll for conditions; no timing value is derived from frame deltas. Usage: node tests.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const HD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn HD;')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HOOK = `
window.__hd = { HD: HD, get run() { return run; }, get screen() { return screen; }, get settings() { return settings; }, get best() { return best; }, get stats() { return stats; },
  get drv() { return drv; }, get nptr() { return ptrs.size; }, ACH: ACH, pal: pal, die: die, endRun: endRun,
  safe: function () { var g = run.tower.get; run.tower.get = function (n) { var L = g(n); L.lavas = []; return L; }; },   // lava-free tower for input tests
  set: function (o) { Object.assign(run, o); hudDirty = true; } };
`;
const marker = '\n})();\n</script>';
ok(html.lastIndexOf(marker) > 0, 'hook marker present');
const served = html.slice(0, html.lastIndexOf(marker)) + HOOK + html.slice(html.lastIndexOf(marker));
const ORIGIN = 'https://helix.test/';
const today = (() => { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); })();

(async () => {
  console.log('Core (Node)');
  await t('no lava on layers 1-3 (a first-layer death is impossible); lava from layer 4', () => {
    let lava4 = 0;
    for (let s = 1; s <= 60; s++) { const T = HD.makeTower(s * 7919, false); for (let n = 1; n <= 3; n++) eq(T.get(n).lavas.length, 0, 'seed ' + s + ' layer ' + n); if (T.get(4).lavas.length) lava4++; }
    eq(HD.lavaFrac(3), 0); ok(lava4 > 50, 'layer 4 lava in ' + lava4 + '/60');
  });
  await t('15-24: lava share eased (15-20 = layer 11, 21-24 = layer 14), flow starts at 5 deg/s and reaches the old curve at 30', () => {
    for (let n = 15; n <= 24; n++) eq(HD.lavaFrac(n), HD.lavaFrac(n <= 20 ? 11 : 14), 'n=' + n);
    eq(HD.flowSpeed(15), 5); ok(Math.abs(HD.flowSpeed(30) - 19) < 1e-9 && HD.flowSpeed(29) < 19, 'flow 30');
    for (let n = 25; n < 80; n++) ok(HD.lavaFrac(n) >= HD.lavaFrac(n - 1) - 1e-12 && HD.lavaFrac(n) - HD.lavaFrac(n - 1) < 0.03, 'smooth at ' + n);
  });
  await t('15-29: moving lava never reaches the slab under the gap above (blind drops stay safe)', () => {
    let checked = 0;
    for (let s = 1; s <= 40; s++) {
      const T = HD.makeTower(s * 104729, false);
      for (let n = 15; n <= 29; n++) {
        const P = T.get(n - 1), L = T.get(n); if (P.bonus || L.bonus) continue;
        ok(L.lavas.every(v => v.sw > 0 && v.sp === 0), 'swinging only, layer ' + n);
        if (n <= 20) ok(L.lavas.every(v => v.sw === 6 && v.sw * v.om <= HD.flowSpeed(n) / 2 + 1e-9), 'small, slow swing on 15-20, layer ' + n);
        for (let tt = 0; tt < 20; tt += 0.1) for (let d = -P.gw / 2; d <= P.gw / 2; d += 2) { checked++; ok(HD.typeAt(L, P.g + d, tt) !== HD.LAVA, 'lava under gap s' + s + ' n' + n + ' t' + tt.toFixed(1)); }
      }
    }
    ok(checked > 100000, 'samples ' + checked);
  });
  await t('content keeps changing after 80: faster blink at 100, drifting gap at 150 (wider at 200); 難度 stops at 21', () => {
    const T = HD.makeTower(4242, false);
    ok(T.get(99).osc === 0.4 && T.get(101).osc === 0.5, 'fast blink at 100');
    let drift150 = 0, drift200 = 0, plain = 0;
    for (let n = 151; n < 260; n++) { const L = T.get(n); if (L.bonus || L.trapC != null || T.get(n - 1).trapC != null) continue; plain++; if (L.dA === (n >= 200 ? 30 : 20)) n >= 200 ? drift200++ : drift150++; }
    ok(drift150 + drift200 === plain && drift200 > 0, 'drift on every plain layer ' + drift150 + '+' + drift200 + '/' + plain);
    for (let n = 151; n < 260; n++) { const L = T.get(n); if (!L.dA) continue; const cs = []; for (let tt = 0; tt < 5; tt += 0.1) cs.push(HD.gapC(L, 0, tt) - L.gaps[0].c);
      ok(Math.max(...cs) - Math.min(...cs) > L.dA, 'gap centre drifts on layer ' + n); }
    eq([HD.difficulty(1), HD.difficulty(199), HD.difficulty(200), HD.difficulty(400)], [1, 20, 21, 21]);
  });
  await t('every real gap stays passable with the new mechanics (8 seeds x 260 layers: safe drop within 4 s)', () => {
    let worst = 0;
    for (let s = 1; s <= 8; s++) {
      const T = HD.makeTower(s * 7919 + 3, false);
      for (let n = 1; n <= 260; n++) {
        const L = T.get(n), M = T.get(n + 1); if (L.bonus) continue;
        let blocked = 0, longest = 0;
        for (let tt = 0; tt < 20; tt += 0.1) {
          const w = HD.gapW(L, tt), c = HD.gapC(L, 0, tt) + L.spin * tt; let good = false;
          for (let d = -w / 2 + 3; d <= w / 2 - 3 && !good; d += 2) { const a = c + d; if (HD.typeAt(L, a, tt) === HD.GAP && (M.bonus || [0.15, 0.3].every(e => HD.typeAt(M, a, tt + e) !== HD.LAVA))) good = true; }
          if (good) blocked = 0; else { blocked += 0.1; longest = Math.max(longest, blocked); }
        }
        worst = Math.max(worst, longest); ok(longest <= 4, 'seed ' + s + ' layer ' + n + ' blocked ' + longest.toFixed(1) + 's');
      }
    }
  });

  console.log('Page (390x844, real CDP touch)');
  const browser = await chromium.launch();
  const errors = [], external = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.split('#')[0] === ORIGIN) r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: served }); else if (/^(data|blob):/.test(u)) r.continue(); else { external.push(u); r.abort(); } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(ORIGIN);
    const ev = (fn, a) => page.evaluate(fn, a);
    const until = (fn, a, ms) => page.waitForFunction(fn, a, { timeout: ms || 20000, polling: 25 });
    await until(() => window.__hd && document.getElementById('bStart').getBoundingClientRect().height > 40);
    const cdp = await ctx.newCDPSession(page), f = {};
    const pts = () => Object.entries(f).map(([id, p]) => ({ x: p.x, y: p.y, id: +id }));
    const H = {
      down: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); },
      move: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); },
      up: async id => { const p = f[id]; delete f[id]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: +id }] }); },
    };
    H.tap = async (x, y, id = 9, hold = 40) => { await H.down(id, x, y); await sleep(hold); await H.up(id); };
    const ctr = sel => ev(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, l: b.left, r: b.right, t: b.top, b: b.bottom }; }, sel);
    // wait for the card's entrance pop (scale .85 -> 1) to finish so the measured centre is where the button stays
    const settle = sel => ev(s => { const c = document.querySelector(s).closest('.card'); return c ? Promise.all(c.getAnimations().map(a => a.finished)).then(() => 1) : 1; }, sel);
    const tapSel = async (sel, id) => { await settle(sel); const c = await ctr(sel); await H.tap(c.x, c.y, id); };
    const start = async (sel = '#bStart') => { await tapSel(sel); await until(() => __hd.screen === 'play'); await ev(() => __hd.safe()); };
    return { ctx, page, H, ev, until, ctr, tapSel, start };
  }

  let A = await open({ init: [() => { try { localStorage.setItem('helixdrop.settings', JSON.stringify({ sound: false })); } catch (e) {} }] });
  await A.start();
  await t('[veto] thumb holding/dragging the canvas + 2nd finger taps 暫停: pauses 10/10, 繼續 by 2nd finger 10/10', async () => {
    let paused = 0, resumed = 0;
    for (let k = 0; k < 10; k++) {
      await A.H.down(1, 180, 640); await A.H.move(1, 186, 640);
      const p = await A.ctr('#bPause'); await A.H.tap(p.x, p.y, 2, 50);
      try { await A.until(() => __hd.screen === 'paused', null, 3000); paused++; } catch (e) {}
      const r = await A.ctr('#pResume'); await A.H.tap(r.x, r.y, 3, 50);
      try { await A.until(() => __hd.screen === 'play', null, 3000); resumed++; } catch (e) {}
      await A.H.move(1, 180, 640); await A.H.up(1);
    }
    eq([paused, resumed], [10, 10]);
  });
  await t('[veto] thumb on the canvas + 2nd finger taps 音效: toggles exactly once per tap 10/10', async () => {
    let n = 0;
    for (let k = 0; k < 10; k++) {
      const s0 = await A.ev(() => __hd.settings.sound);
      await A.H.down(1, 180, 640); await A.H.move(1, 184, 640);
      const m = await A.ctr('#bMute'); await A.H.tap(m.x, m.y, 2, 50);
      await A.until(s => __hd.settings.sound !== s, s0, 3000).catch(() => {});
      await A.H.up(1); await sleep(60);   // a late duplicate would flip it back within this window
      if ((await A.ev(() => __hd.settings.sound)) !== s0) n++;
    }
    eq(n, 10);
  });
  await t('single-finger taps at 8/s: 音效 10 taps -> 10 toggles; 暫停/繼續 alternate P,G x5 (no double fire)', async () => {
    const m = await A.ctr('#bMute'), s0 = await A.ev(() => __hd.settings.sound); const seen = [];
    for (let i = 0; i < 10; i++) { await A.H.tap(m.x, m.y, 4, 40); await sleep(85); seen.push(await A.ev(() => __hd.settings.sound)); }
    eq(seen, seen.map((_, i) => i % 2 ? s0 : !s0), 'toggle sequence');
    const seq = [];
    for (let i = 0; i < 5; i++) {
      await A.tapSel('#bPause', 5); await A.until(() => __hd.screen === 'paused', null, 3000).catch(() => {}); seq.push((await A.ev(() => __hd.screen))[0]);
      await A.tapSel('#pResume', 6); await A.until(() => __hd.screen === 'play', null, 3000).catch(() => {}); seq.push((await A.ev(() => __hd.screen))[1]);
    }
    eq(seq.join(''), 'plplplplpl', 'pause/play');   // 'p' = paused, 'l' = pLay
  });
  await t('a finger that slides off a button does not fire it; keyboard Enter on a focused button fires once', async () => {
    const m = await A.ctr('#bMute'), s0 = await A.ev(() => __hd.settings.sound);
    await A.H.down(7, m.x, m.y); await A.H.move(7, m.x - 120, m.y + 200); await A.H.up(7); await sleep(120);
    eq(await A.ev(() => __hd.settings.sound), s0, 'slid off');
    await A.ev(() => document.getElementById('bMute').focus()); await A.page.keyboard.press('Enter');
    await A.until(s => __hd.settings.sound !== s, s0, 3000); await sleep(80); eq(await A.ev(() => __hd.settings.sound), !s0, 'Enter once');
    await A.page.keyboard.press('Enter'); await A.until(s => __hd.settings.sound === s, s0, 3000);
    await A.ev(() => document.activeElement.blur());
  });
  await t('2nd finger touches the canvas and lifts: the thumb keeps steering (40 px -> -22 deg) 5/5', async () => {
    const got = [];
    for (let k = 0; k < 5; k++) {
      await A.ev(() => __hd.settings.inertia = false);
      await A.H.down(1, 150, 640); await A.H.down(2, 300, 560); await A.H.up(2);
      await A.until(() => __hd.nptr === 1);
      const r0 = await A.ev(() => __hd.run.rot);
      for (let i = 1; i <= 5; i++) await A.H.move(1, 150 + i * 8, 640);
      await A.until(() => true); const r1 = await A.ev(() => __hd.run.rot);
      await A.H.up(1);
      got.push(+(((r1 - r0 + 540) % 360) - 180).toFixed(1));
    }
    ok(got.every(d => Math.abs(d + 22) < 0.6), 'rotations ' + got.join(','));
  });
  await t('two fingers on the canvas: the newest steers, the other takes over when it lifts; all released -> none tracked', async () => {
    await A.H.down(1, 120, 640); await A.H.down(2, 280, 640);
    let r0 = await A.ev(() => __hd.run.rot); await A.H.move(2, 300, 640); let r1 = await A.ev(() => __hd.run.rot);
    ok(Math.abs(((r1 - r0 + 540) % 360) - 180 + 11) < 0.6, 'newest finger steers');
    await A.H.up(2); r0 = await A.ev(() => __hd.run.rot); await A.H.move(1, 100, 640); r1 = await A.ev(() => __hd.run.rot);
    ok(Math.abs(((r1 - r0 + 540) % 360) - 180 - 11) < 0.6, 'thumb took over');
    await A.H.up(1); await A.until(() => __hd.nptr === 0 && __hd.drv === null);
  });
  await t('death writes best + stats at once (before the 1 s shatter ends); title names the cause', async () => {
    await A.ev(() => { __hd.set({ score: 41, layers: 9, pierces: 2, bonuses: 0 }); __hd.run.why = 'lava'; __hd.die(); });
    const b = await A.ev(() => ({ screen: __hd.screen, best: JSON.parse(localStorage.getItem('helixdrop.best')), stats: JSON.parse(localStorage.getItem('helixdrop.stats')) }));
    eq(b.screen, 'dying'); eq(b.best.endless, 41); eq(b.stats.runs, 1); eq(b.stats.pierces, 2);
    await A.until(() => __hd.screen === 'over');
    eq(await A.ev(() => document.getElementById('oTitle').textContent), '碰到辣椒熔漿！');
    eq(await A.ev(() => JSON.parse(localStorage.getItem('helixdrop.stats')).runs), 1, 'counted once');
  });
  await t('death cause: trap lava and time-up have their own titles', async () => {
    await A.start('#oRetry'); await A.ev(() => { __hd.run.why = 'trap'; __hd.die(); }); await A.until(() => __hd.screen === 'over');
    eq(await A.ev(() => document.getElementById('oTitle').textContent), '掉進陷阱缺口下的熔漿！');
    await A.tapSel('#oHome'); await A.until(() => __hd.screen === 'title'); await A.start('#bTimed');
    await A.ev(() => __hd.set({ timeLeft: 0.01 })); await A.until(() => __hd.screen === 'over');
    eq(await A.ev(() => document.getElementById('oTitle').textContent), '時間到！');
  });
  await t('mid-run reload keeps the run: best + stats counted after reload, exactly once', async () => {
    await A.tapSel('#oHome'); await A.until(() => __hd.screen === 'title'); await A.start();
    const runs0 = await A.ev(() => __hd.stats.runs);
    await A.ev(() => __hd.set({ score: 77, layers: 12 }));
    await A.page.reload(); await A.until(() => window.__hd && document.getElementById('bStart').getBoundingClientRect().height > 40);
    const s = await A.ev(() => ({ best: __hd.best.endless, runs: __hd.stats.runs, pending: localStorage.getItem('helixdrop.pending'), title: document.getElementById('tBest').textContent }));
    eq([s.best, s.runs - runs0, s.pending], [77, 1, null]); ok(s.title.includes('77'), s.title);
    await A.page.reload(); await A.until(() => window.__hd);
    eq(await A.ev(() => __hd.stats.runs) - runs0, 1, 'not counted again');
  });
  await t('quitting from pause keeps the record (主選單 / 重新開始)', async () => {
    await A.start(); await A.ev(() => __hd.set({ score: 90, layers: 15 }));
    await A.tapSel('#bPause'); await A.until(() => __hd.screen === 'paused'); await A.tapSel('#pHome'); await A.until(() => __hd.screen === 'title');
    eq(await A.ev(() => __hd.best.endless), 90);
  });
  await t('one-time shield: record kept apart (endless_s), labelled （護盾） in result, HUD and records', async () => {
    await A.ev(() => { __hd.settings.shield = true; }); await A.start();
    ok((await A.ev(() => document.getElementById('hBest').textContent)) === '0', 'HUD best is the shield record');
    await A.ev(() => { __hd.set({ score: 120, layers: 20 }); __hd.run.why = 'lava'; __hd.die(); }); await A.until(() => __hd.screen === 'over');
    const r = await A.ev(() => ({ b: __hd.best, sub: document.getElementById('oSub').textContent }));
    eq([r.b.endless, r.b.endless_s], [90, 120]); ok(r.sub.includes('（護盾）'), r.sub);
    await A.tapSel('#oHome'); await A.until(() => __hd.screen === 'title');
    ok((await A.ev(() => document.getElementById('tBest').textContent)).includes('（護盾）'), 'title label');
    await A.tapSel('#bStats'); await A.until(() => !document.getElementById('stats').classList.contains('hidden'));
    const rows = await A.ev(() => [...document.querySelectorAll('.btab tr')].map(r => r.textContent));
    ok(rows.some(x => x.startsWith('護盾') && x.includes('120')), rows.join(' / '));
    await A.tapSel('#stDone'); await A.ev(() => { __hd.settings.shield = false; });
  });
  await t('daily tower: 1-3 stars by layers (25/50/100) saved per day; 3-day streak achievement', async () => {
    await A.ev(y => { __hd.stats.dLast = y; __hd.stats.dStreak = 2; }, yesterday);
    await A.start('#bDaily'); await A.ev(() => { __hd.set({ score: 300, layers: 55 }); __hd.run.why = 'lava'; __hd.die(); }); await A.until(() => __hd.screen === 'over');
    const r = await A.ev(() => ({ sub: document.getElementById('oSub').textContent, st: __hd.best.stars_daily, s: __hd.stats }));
    ok(r.sub.includes('★★☆'), r.sub); eq(r.st, { d: today, n: 2 }); eq([r.s.dStreak, r.s.dLast, r.s.ach.d3], [3, today, 1]);
    await A.tapSel('#oHome'); await A.until(() => __hd.screen === 'title');
    ok((await A.ev(() => document.getElementById('tBest').textContent)).includes('★★☆'), 'title stars');
  });
  await t('12 achievements incl. tiered ones (連穿 5, 50/100/150/200 層徽章, 限時 50 層, 彩蛋 10); 50-layer milestone pops', async () => {
    const ids = await A.ev(() => __hd.ACH.map(a => a.id));
    ok(ids.length >= 9 && ['c5', 'c8', 'l50', 'l100', 't50', 'b10', 'd3'].every(x => ids.includes(x)), ids.join(','));
    await A.start();
    // put the ball just above layer 50 (a golden bonus layer) with 49 layers done: landing on it is the 50th layer
    await A.ev(() => { const r = __hd.run; __hd.set({ maxCombo: 5, layers: 49, next: 50, by: 50 * 150 - 30, vy: 900, combo: 0, camY: 50 * 150 - 400 }); });
    await A.until(() => __hd.run.layers >= 50);
    await A.until(() => __hd.stats.ach.c5 === 1 && __hd.stats.ach.l50 === 1);
    ok(await A.ev(() => __hd.run.bonuses === 1), 'bonus counted');
    await A.ev(() => { __hd.run.why = 'lava'; __hd.die(); }); await A.until(() => __hd.screen === 'over');
    eq(await A.ev(() => [__hd.stats.maxLayers >= 50, __hd.stats.bonuses >= 1]), [true, true]);
    await A.tapSel('#oHome'); await A.until(() => __hd.screen === 'title');
  });
  await t('records panel lists assist timed + daily (輔助 row) and achievement progress', async () => {
    await A.ev(t => { __hd.best.timed_a = 11; __hd.best.daily_a = { d: t, s: 5 }; }, today);
    await A.tapSel('#bStats'); await A.until(() => !document.getElementById('stats').classList.contains('hidden'));
    const rows = await A.ev(() => [...document.querySelectorAll('.btab tr')].map(r => [...r.children].map(c => c.firstChild ? c.firstChild.textContent : '')));
    const a = rows.find(r => r[0] === '輔助'); ok(a && a[2] === '11' && a[3] === '5', JSON.stringify(rows));
    ok((await A.ev(() => document.querySelector('.achh').textContent)).match(/成就 \d+ \/ 12/), 'progress header');
    await A.tapSel('#stDone');
  });
  await t('render: gradients are cached (not rebuilt every frame) during steady play', async () => {
    await A.start();
    await A.ev(() => { window.__gc = 0; const C = CanvasRenderingContext2D.prototype; ['createLinearGradient', 'createRadialGradient'].forEach(k => { const o = C[k]; C[k] = function () { window.__gc++; return o.apply(this, arguments); }; }); });
    const t0 = await A.ev(() => __hd.run.t); await A.until(t => __hd.run.t > t + 1, t0);
    const n = await A.ev(() => window.__gc); ok(n <= 6, 'gradients created in 1 s of play: ' + n);
  });
  await t('strawberry palette: lava is a deeper red with a light outline (contrast vs pink slabs)', async () => {
    const p = await A.ev(() => __hd.pal(0)); ok(p.lava !== '#e63946' && p.lavaEdge, JSON.stringify(p));
  });
  await t('saved data under the old keys still loads (best / stats / achievements)', async () => {
    const B = await open({ init: [t => { localStorage.setItem('helixdrop.best', JSON.stringify({ endless: 123, timed: 45, endless_a: 9, timed_a: 0, daily: { d: t, s: 7 }, daily_a: { d: '', s: 0 } }));
      localStorage.setItem('helixdrop.stats', JSON.stringify({ runs: 3, layers: 40, maxCombo: 4, pierces: 2, maxLayers: 20, ach: { c10: 1 } })); }, today] });   // c10 = the old 連穿 10
    const r = await B.ev(() => ({ t: document.getElementById('tBest').textContent, s: __hd.stats, b: __hd.best }));
    ok(r.t.includes('123') && r.t.includes('7'), r.t); eq([r.s.runs, r.s.layers, r.s.ach.c10, r.s.ach.c8, r.b.timed], [3, 40, 1, 1, 45]);
    await B.tapSel('#bStats'); await B.until(() => !document.getElementById('stats').classList.contains('hidden'));
    ok((await B.ev(() => document.querySelector('.btab').textContent)).includes('123'), 'records table');
    await B.ctx.close();
  });
  await A.ctx.close();

  console.log('Ghost clicks (7 sizes, one-finger taps ending with an empty touchEnd)');
  // Every button that closes a panel or switches screens must do exactly one thing: the browser's own click from the
  // tap, hit-tested after the panel closed, must not reach the button underneath (round-2 veto).
  // two sizes at a time (separate contexts) to stay inside the CI time budget
  const SIZES = [[360, 640], [390, 844], [430, 932], [375, 500], [390, 610], [430, 740], [844, 390]];
  const ghost = ([w, h]) => t('ghost click ' + w + 'x' + h + ': each panel / screen button does exactly one thing', async () => {
      const B = await open({ w, h, init: [() => { try { localStorage.setItem('helixdrop.settings', JSON.stringify({ sound: false })); } catch (e) {} }] });
      await B.ev(() => { window.__acts = 0; const o = window.__hd; ['bStart','bDaily','bTimed','bSet','bStats','bHelp','hOk','sDone','stDone','pResume','pRestart','pHome','pSet','oRetry','oHome','bPause','bMute'].forEach(id => { const el = document.getElementById(id), f = el._onTap; el._onTap = function () { window.__acts++; return f.apply(this, arguments); }; }); });
      // entrance pops / fades off (test speed only: the ghost click does not depend on them, it follows the touchEnd)
      await B.page.addStyleTag({ content: '.ov,.card,.badge{animation:none !important}' });
      const cdp = await B.ctx.newCDPSession(B.page);
      const st = () => B.ev(() => ({ s: __hd.screen, ov: [...document.querySelectorAll('.ov')].filter(o => !o.classList.contains('hidden')).map(o => o.id).join(','), a: window.__acts }));
      const step = async (sel, want) => {
        const c = await B.ctr(sel), a0 = (await st()).a;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 1 }] }); await sleep(40);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await B.until(w => { const ov = [...document.querySelectorAll('.ov')].filter(o => !o.classList.contains('hidden')).map(o => o.id).join(','); return __hd.screen === w.s && ov === w.ov; }, want, 4000).catch(() => {});
        await sleep(60);   // a ghost click follows the touchEnd within a frame or two
        const r = await st(); eq([r.s, r.ov, r.a - a0], [want.s, want.ov, 1], sel);
      };
      const T = { s: 'title', ov: 'title' }, P = { s: 'play', ov: '' };
      await step('#bHelp', { s: 'title', ov: 'help' }); await step('#hOk', T);
      await step('#bSet', { s: 'title', ov: 'settings' }); await step('#sDone', T);
      await step('#bStats', { s: 'title', ov: 'stats' }); await step('#stDone', T);
      await step('#bStart', P); await B.ev(() => __hd.safe());
      await step('#bPause', { s: 'paused', ov: 'pause' }); await step('#pResume', P);
      await step('#bPause', { s: 'paused', ov: 'pause' }); await step('#pSet', { s: 'paused', ov: 'settings' }); await step('#sDone', { s: 'paused', ov: 'pause' });
      await step('#pRestart', P); await B.ev(() => __hd.safe());
      await step('#bPause', { s: 'paused', ov: 'pause' }); await step('#pHome', T);
      const kill = () => B.ev(() => { __hd.run.why = 'lava'; __hd.die(); __hd.endRun('dead'); });   // skip the 1 s shatter here
      await step('#bTimed', P); await kill(); await B.until(() => __hd.screen === 'over');
      const retry = await B.ctr('#oRetry');
      await step('#oRetry', P); await kill(); await B.until(() => __hd.screen === 'over');
      await step('#oHome', T);
      // a finger on the canvas while the ball shatters, lifted just after the result card appears under it: no action
      await step('#bStart', P); await B.ev(() => { __hd.run.why = 'lava'; __hd.die(); }); await B.until(() => __hd.screen === 'dying');
      const a0 = (await st()).a;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: retry.x, y: retry.y, id: 2 }] });
      await B.until(() => __hd.screen === 'over', null, 4000); await sleep(30);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150);
      const r = await st(); eq([r.s, r.a - a0], ['over', 0], 'stray tap after death');
      await B.ctx.close();
    });
  for (let i = 0; i < SIZES.length; i += 2) await Promise.all(SIZES.slice(i, i + 2).map(ghost));

  console.log('Layout');
  await t('lobby 375x500 title: stacked, title on one line (with a backing), subtitle one line, solid best card, buttons inside', async () => {
    for (const [w, h] of [[375, 500], [390, 610], [360, 640]]) {
      const B = await open({ w, h });
      const bk = await B.ev(() => [getComputedStyle(document.querySelector('.ttl h1')).backgroundColor, getComputedStyle(document.getElementById('tBest')).backgroundColor]);
      ok(!/rgba\(0, 0, 0, 0\)/.test(bk[0]) && /^rgb\(/.test(bk[1]), 'backings ' + bk.join(' / '));
      const r = await B.ev(() => { const q = s => document.querySelector(s).getBoundingClientRect(), fs = s => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
        return { h1: q('.ttl h1'), h1f: fs('.ttl h1'), sub: q('.ttl .sub'), subf: fs('.ttl .sub'), btns: q('.tbtns'), trow: q('.trow'), dir: getComputedStyle(document.getElementById('title')).flexDirection }; });
      eq(r.dir, 'column', w + 'x' + h); ok(r.h1.height < r.h1f * 1.6 && r.h1.width > 150, 'h1 one line ' + JSON.stringify([r.h1.width, r.h1.height, r.h1f]));
      ok(r.sub.height < r.subf * 1.6 + 12, 'sub one line ' + r.sub.height);
      ok(r.trow.bottom <= h && r.h1.bottom <= r.btns.top, 'fits ' + JSON.stringify([r.trow.bottom, r.h1.bottom, r.btns.top]));
      await B.ctx.close();
    }
  });
  await t('settings 360x640: scroll area fades at the bottom while more is below, fade goes away at the end', async () => {
    const B = await open({ w: 360, h: 640, scheme: 'dark' });
    await B.tapSel('#bSet'); await B.until(() => !document.getElementById('settings').classList.contains('hidden'));
    ok(await B.ev(() => document.querySelector('#settings .scroll').classList.contains('more')), 'fade shown');
    await B.ev(() => { const s = document.querySelector('#settings .scroll'); s.scrollTop = s.scrollHeight; });
    await B.until(() => !document.querySelector('#settings .scroll').classList.contains('more'));
    await B.ctx.close();
  });
  await t('landscape 844x390: the gesture hint sits beside the tower, not over the slab', async () => {
    const B = await open({ w: 844, h: 390, scheme: 'dark' }); await B.start();
    const r = await B.ev(() => { const b = document.getElementById('hint').getBoundingClientRect(); return { l: b.left, r: b.right, vis: !document.getElementById('hint').classList.contains('hidden') }; });
    const towerRight = 422 + 150 * Math.min(844 / 400, 390 / 560);
    ok(r.vis && r.l > towerRight && r.r <= 844, JSON.stringify(r) + ' tower right ' + towerRight.toFixed(0));
    await B.ctx.close();
  });

  await t('whole run: zero page/console errors, zero external requests (offline)', () => { eq(errors, [], 'errors'); eq(external, [], 'external'); });
  await browser.close();
  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail) + ' helix-drop checks');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crash', e && e.stack || e); process.exit(1); });
