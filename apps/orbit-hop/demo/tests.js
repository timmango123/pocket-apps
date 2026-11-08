// Regression tests for 星軌跳躍 (orbit-hop), one per release-review finding (2026-11-08).
// Real page in mobile Chromium, touch through CDP Input.dispatchTouchEvent. Waits on game state, not wall time.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let pass = 0, fail = 0;
async function t(name, fn) { const t0 = Date.now(); try { await fn(); pass++; console.log('  ok  ', name, process.env.TT ? (Date.now() - t0) + 'ms' : ''); } catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  let nid = 1;
  async function open(o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP);
    await page.waitForFunction(() => window.__game && __game.state().mode === 'title', null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ev = (f, a) => page.evaluate(f, a);
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 30000, polling: 30 });
    const ctr = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    // CDP touchEnd releases exactly the points it lists
    const press = async (at, others = []) => { const p = { ...(typeof at === 'string' ? await ctr(at) : at), id: nid++ }; await T('touchStart', [...others, p]); return p; };
    const lift = p => T('touchEnd', [p]);
    const tap = async (at, hold = 40, others = []) => { const p = await press(at, others); await sleep(hold); await lift(p); await sleep(60); };
    const mode = () => ev(() => __game.state().mode);
    // card buttons accept presses that begin after the card's guard; wait it out on the page's clock
    const settled = id => until(i => { const o = document.getElementById(i); return o.classList.contains('on') && performance.now() - (o.shownAt || 0) > (o.guard || 0) + 60; }, id);
    return { ctx, page, T, ev, until, ctr, press, lift, tap, mode, settled };
  }

  console.log('Generator');
  {
    const P = await open();
    const g = await P.ev(() => __game.genStats(90, 3).out);
    await t('every planet keeps its guaranteed launch window; no fallback planets', () => {
      ok(g.every(p => p.win >= p.need - 1e-9), 'window below need'); eq(g.filter(p => p.tries >= 22).length, 0, 'fallback planets');
    });
    await t('first planets have larger capture zones (early-game grace)', () => {
      ok(g[0].tol >= 40 && g[3].tol >= 34 && g[7].tol >= 24 && g[7].tol > g[9].tol, 'tol ' + g.slice(0, 10).map(p => p.tol));
    });
    await t('late sectors add new hazards: twin black holes from 50', () => {
      ok(g.some(p => p.n >= 50 && p.hole === 2), 'no twin holes'); ok(g.every(p => p.n >= 50 || p.hole < 2), 'twin hole before 50');
      ok(/第 3 星區：雙黑洞出沒/.test(html) && /第 4 星區：小行星風暴/.test(html), 'sector toasts');
    });
    await t('per-frame generation budget is 2.5 ms; astronaut gradients are cached', () => {
      ok(/genPlanet\(world,2\.5\)/.test(html), 'budget');
      const da = html.slice(html.indexOf('function drawAstro'), html.indexOf('/* ---------- loop'));
      eq((da.match(/createLinearGradient/g) || []).length, 2); ok(/if\(!flameG\)/.test(da), 'gradients built once');
    });
    await P.ctx.close();
  }

  console.log('Touch (390x844)');
  const P = await open();
  const start = async () => { await P.settled('title'); await P.tap('#startBtn'); await P.until(() => __game.state().mode === 'play'); };
  const ensurePlay = async () => {   // a canvas press launches the astronaut; recover from any crash it caused
    await P.until(() => { const s = __game.state(); return s.mode === 'over' || (s.mode === 'play' && s.astro.st === 'orbit'); });
    if (await P.mode() === 'over') { await P.settled('over'); await P.tap('#againBtn'); await P.until(() => __game.state().mode === 'play'); }
  };
  const kill = async (k, slow) => { await P.ev(([k, f]) => __game.die(k, f), [k, !slow]); };   // fast: skip most of the 1 s crash animation
  const toOver = async k => { await kill(k); await P.until(() => __game.state().mode === 'over'); };
  // under heavy load a tap can reach the page later than the 450 ms guard; hold the guard open while checking it is honoured
  const holdGuard = id => P.ev(id => { const o = document.getElementById(id), g = o.guard; o.guard = 1e7; return g; }, id);
  const dropGuard = (id, g) => P.ev(([id, g]) => { document.getElementById(id).guard = g; }, [id, g]);
  let again, menuB;
  await t('single tap: 開始 starts, a canvas tap launches, 再玩一次 restarts', async () => {
    await start();
    await P.until(() => __game.state().astro.since > 0.2);
    await P.tap({ x: 195, y: 700 });
    await P.until(() => __game.state().astro.st !== 'orbit');
    await toOver(4); await P.settled('over');
    again = await P.ctr('#againBtn'); menuB = await P.ctr('#overMenuBtn');
    await P.tap(again); await P.until(() => __game.state().mode === 'play');
  });
  await t('touch begun before the result card appears does not hit 再玩一次 (held 80 ms / 1 s past the card)', async () => {
    for (const extra of [80, 1000]) {
      await kill(4, true);
      const p = await P.press(again);
      await P.until(() => __game.state().mode === 'over');
      await sleep(extra); await P.lift(p); await sleep(150);
      eq(await P.mode(), 'over', 'hold ' + extra);
      await P.settled('over'); await P.tap(again); await P.until(() => __game.state().mode === 'play');
    }
  });
  await t('taps right after the card appears are ignored; a later 0.6 s tap works', async () => {
    await toOver(4);
    const g = await holdGuard('over'); ok(g >= 450, 'result-card guard ' + g);
    await P.tap(again, 30); eq(await P.mode(), 'over', 'tap inside guard');
    await dropGuard('over', g); await P.settled('over'); await P.tap(again, 600); await P.until(() => __game.state().mode === 'play');
  });
  await t('repeated taps after death: 主選單 not hit early, then title 開始 not hit by the same rhythm', async () => {
    await toOver(4);
    const g = await holdGuard('over');
    await P.tap(menuB, 30); eq(await P.mode(), 'over');
    await dropGuard('over', g); await P.settled('over'); await P.tap(menuB, 1000); await P.until(() => __game.state().mode === 'title');
    const g2 = await holdGuard('title'); ok(g2 >= 350, 'title guard ' + g2);
    const sb = await P.ctr('#startBtn');
    await P.tap(sb, 30); eq(await P.mode(), 'title', 'start inside guard');
    await dropGuard('title', g2); await start();
  });
  await t('death cause is shown: asteroid / black hole / drifting', async () => {
    const seen = [];
    for (const k of [3, 2, 4]) {
      if (k !== 3) { await P.settled('over'); await P.tap(again); await P.until(() => __game.state().mode === 'play'); }
      await toOver(k); seen.push(await P.ev(() => document.getElementById('oTitle').textContent));
    }
    eq(seen, ['撞上小行星', '被黑洞吞噬', '漂流太空…']);
    await P.settled('over'); await P.tap(again); await P.until(() => __game.state().mode === 'play');
  });
  await t('second finger works while one is held on the canvas: 暫停, 繼續, 靜音 (each once)', async () => {
    const hold = await P.press({ x: 80, y: 760 });
    await P.tap('#pauseBtn', 40, [hold]); await P.until(() => __game.state().mode === 'paused');
    await P.settled('pause');
    await P.tap('#resumeBtn', 40, [hold]); await P.until(() => __game.state().mode === 'play');
    const m0 = await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-label'));
    await P.tap('#muteBtn', 40, [hold]); await sleep(100);
    ok(await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-label')) !== m0, 'mute toggled');
    await P.tap('#muteBtn', 40, [hold]); await sleep(100);
    eq(await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-label')), m0, 'mute toggled back');
    await P.lift(hold);
  });
  await t('slow 1 s press on 暫停 pauses exactly once; 0.6 s 繼續 resumes', async () => {
    await ensurePlay();
    await P.tap('#pauseBtn', 1000); await sleep(150); eq(await P.mode(), 'paused');
    await P.settled('pause'); await P.tap('#resumeBtn', 600); await P.until(() => __game.state().mode === 'play');
  });
  await t('再玩一次 works with another finger still down', async () => {
    await toOver(4); await P.settled('over');
    const hold = await P.press({ x: 60, y: 120 });
    await P.tap(again, 40, [hold]); await P.until(() => __game.state().mode === 'play');
    await P.lift(hold);
  });
  await t('mute is reachable (not covered) on title, pause and result screens', async () => {
    const top = () => P.ev(() => { const b = document.getElementById('muteBtn').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).closest('#muteBtn') ? 'mute' : 'covered'; });
    const res = [];
    await P.tap('#pauseBtn'); await P.until(() => __game.state().mode === 'paused'); res.push(await top());
    const m0 = await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-label'));
    await P.tap('#muteBtn'); await sleep(100);
    ok(await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-label')) !== m0, 'mute works while paused');
    await P.tap('#muteBtn'); await sleep(80);
    await P.settled('pause'); await P.tap('#resumeBtn'); await P.until(() => __game.state().mode === 'play');
    await toOver(4); res.push(await top());
    await P.settled('over'); await P.tap(menuB); await P.until(() => __game.state().mode === 'title'); res.push(await top());
    eq(res, ['mute', 'mute', 'mute']);
  });
  await t('mouse click on a card button fires once (no pointerup + click double)', async () => {
    await P.settled('title');
    const sb = await P.ctr('#startBtn');
    await P.page.mouse.click(sb.x, sb.y); await P.until(() => __game.state().mode === 'play');
    await P.page.mouse.click(30 + 4, 30); // pause button area (top-left)
    await P.until(() => __game.state().mode === 'paused'); await sleep(150); eq(await P.mode(), 'paused');
    await P.settled('pause'); await P.tap('#resumeBtn'); await P.until(() => __game.state().mode === 'play');
  });
  await t('a new best is saved the moment it is reached (before game over) and survives reload', async () => {
    await P.ev(() => __game.warp(3, 500));
    eq(await P.ev(() => +localStorage.getItem('orbit-hop:best')), 500);
    eq(await P.mode(), 'play');
    const Q = await open({ ctx: P.ctx });
    eq(await Q.ev(() => document.getElementById('tBest').textContent), '最佳紀錄 500');
    await Q.page.close();
  });
  await t('per-run mission: progress in HUD, completion saved at once, result card shows it', async () => {
    await P.ev(() => __game.start()); await P.until(() => __game.state().mode === 'play' && __game.state().score === 0);
    const d0 = await P.ev(() => __game.state().missionsDone);
    await P.ev(() => __game.setMission('score'));
    ok(/^任務：單局得到 \d+ 分/.test(await P.ev(() => document.getElementById('mission').textContent)), 'HUD line');
    await P.ev(() => __game.warp(4, 520));
    const s = await P.ev(() => __game.state());
    ok(s.mission.done && s.missionsDone === d0 + 1, 'mission done');
    eq(await P.ev(() => +localStorage.getItem('orbit-hop:missions')), d0 + 1);
    await toOver(4);
    ok(/任務達成/.test(await P.ev(() => document.getElementById('oMis').textContent)), 'result card');
  });
  await P.ctx.close();

  console.log('Saved data and layout');
  await t('old saved keys still load (orbit-hop:best, orbit-hop:muted)', async () => {
    const Q = await open({ init: () => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('orbit-hop:best', '42'); localStorage.setItem('orbit-hop:muted', '1'); } } });
    eq(await Q.ev(() => [document.getElementById('tBest').textContent, document.getElementById('muteBtn').getAttribute('aria-label')]), ['最佳紀錄 42', '開啟聲音']);
    await Q.ctx.close();
  });
  const fits = (Q, ov, btn) => Q.ev(([ov, btn]) => { const o = document.getElementById(ov), b = document.getElementById(btn).getBoundingClientRect(); return { scroll: o.scrollHeight - o.clientHeight, bottom: Math.round(b.bottom), H: innerHeight }; }, [ov, btn]);
  for (const [w, h] of [[844, 390], [375, 500], [360, 640]]) {
    await t(`${w}x${h}: 開始 and 再玩一次 on the first screen, no scrolling`, async () => {
      const Q = await open({ w, h });
      const a = await fits(Q, 'title', 'startBtn'); ok(a.scroll <= 0 && a.bottom <= a.H, 'title ' + JSON.stringify(a));
      await Q.ev(() => __game.start(7)); await Q.until(() => __game.state().mode === 'play');
      await Q.ev(() => __game.die(4, true)); await Q.until(() => __game.state().mode === 'over');
      await Q.ev(() => new Promise(r => setTimeout(r, 350)));
      const b = await fits(Q, 'over', 'againBtn'); ok(b.scroll <= 0 && b.bottom <= b.H, 'over ' + JSON.stringify(b));
      await Q.ctx.close();
    });
  }
  await t('landscape: world scale ≥ 0.7, score small and moved to the left corner', async () => {
    const Q = await open({ w: 844, h: 390 });
    await Q.ev(() => __game.start(7)); await Q.until(() => __game.state().mode === 'play');
    const s = await Q.ev(() => { const r = document.getElementById('scoreBox').getBoundingClientRect(); return { S0: __game.state().S0, right: r.right, fs: parseFloat(getComputedStyle(document.getElementById('score')).fontSize) }; });
    ok(s.S0 >= 0.7, 'S0 ' + s.S0); ok(s.right < 300 && s.fs <= 36, JSON.stringify(s));
    await Q.ctx.close();
  });
  await t('short portrait: score backdrop, smaller score, camera focus lower', async () => {
    const Q = await open({ w: 360, h: 640 });
    const s = await Q.ev(() => ({ FY: __game.state().FY, fs: parseFloat(getComputedStyle(document.getElementById('score')).fontSize), bg: getComputedStyle(document.getElementById('scoreBox')).backgroundImage }));
    ok(s.FY >= 0.6 && s.fs <= 44 && /gradient/.test(s.bg), JSON.stringify(s));
    await Q.ctx.close();
  });
  await t('keyboard help hidden on touch phones', async () => {
    const Q = await open();
    const r = await Q.ev(() => ({ coarse: matchMedia('(hover:none) and (pointer:coarse)').matches, shown: getComputedStyle(document.querySelector('.kbd')).display !== 'none' }));
    ok(r.coarse ? !r.shown : r.shown, JSON.stringify(r));
    await Q.ctx.close();
  });
  await t('no page or console errors', () => eq(errors, []));
  await browser.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} orbit-hop tests`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
