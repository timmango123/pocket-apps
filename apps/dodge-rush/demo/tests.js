// Regression tests for 螢火迴避 (dodge-rush): rule checks on the CORE block in Node, then the real page in mobile
// Chromium with CDP touch for each release-review finding (2026-11-01). Game-time checks run on a lock-step clock
// (requestAnimationFrame / performance.now virtualised, advanced by the test), so they do not depend on machine load.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {makeSim, speedMul, density, dailyOrder, openingOrder, rng32, PATS};')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const B390 = { w: 390, h: 844, left: 10, right: 380, top: 64, bottom: 832 };

(async () => {
  console.log('Core rules');
  await t('spiral: hugging the emitter is no longer safe (follow 55 px under it at 500 px/s -> hit, 5/5)', () => {
    for (let r = 0; r < 5; r++) {
      const sim = C.makeSim(Object.assign({}, B390, { seed: 77 + r * 1013, practice: 2 })), dt = 1 / 60;
      while (sim.t < 120 && !sim.dead) {
        const e = sim.em.find(x => x.id === 2);
        if (e) { const dx = e.ex - sim.px, dy = e.ey + 55 - sim.py, l = Math.hypot(dx, dy), mv = Math.min(l, 500 * dt); if (l > 0.5) { sim.px += dx / l * mv; sim.py += dy / l * mv; sim.clamp(); } }
        sim.step(dt);
      }
      ok(sim.dead && sim.dieBy === '螺旋', 'run ' + r + ' survived ' + sim.t.toFixed(1) + ' s next to the emitter');
    }
  });
  await t('opening ramp: slower, sparser waves for the first 30-45 s, same curve from 45 s', () => {
    ok(C.speedMul(0) < 0.65 && C.density(0) < 0.5, 'start ' + C.speedMul(0) + ' ' + C.density(0));
    for (let x = 0; x < 60; x += 0.5) { ok(C.speedMul(x + 0.5) >= C.speedMul(x) - 1e-9, 'speed drops at ' + x); ok(C.density(x + 0.5) >= C.density(x) - 1e-9, 'density drops at ' + x); }
    for (const x of [45, 60, 90, 180]) { ok(Math.abs(C.speedMul(x) - (1 + 0.9 * (1 - Math.exp(-x / 90)))) < 1e-9, 'speed ' + x); ok(Math.abs(C.density(x) - Math.min(4, 1 + 0.035 * x)) < 1e-9, 'density ' + x); }
  });
  await t('normal mode: rain first, then 放射環/螺旋/瞄準 in a per-run order, walls at 60 s', () => {
    const seen = new Set();
    for (let s = 1; s <= 40; s++) {
      const sim = C.makeSim(Object.assign({}, B390, { seed: s * 7919, ghost: true })), ids = [];
      while (sim.t < 61) { sim.step(0.05); if (ids[sim.k] == null && sim.k >= 0) ids[sim.k] = sim.ids[0]; }
      eq(ids[0], 0, 'opener'); eq(ids.slice(1, 4).sort(), [1, 2, 3], 'waves 2-4'); eq(ids[4], 4, 'walls at 60 s'); seen.add(ids.slice(1, 4).join(''));
    }
    ok(seen.size >= 4, 'only ' + seen.size + ' different orders in 40 runs');
  });
  await t('daily: own 4-pattern order from the date seed (deterministic, no walls, gentle opener), 3 lives', () => {
    const orders = new Set();
    for (let d = 0; d < 60; d++) {
      const seed = (d * 2654435761) >>> 0, o = C.dailyOrder(seed);
      eq(C.dailyOrder(seed), o, 'same seed same order'); eq(new Set(o).size, 4); ok(o.indexOf(4) < 0, 'walls in daily'); ok(o[0] === 0 || o[0] === 5, 'opener ' + o[0]);
      orders.add(o.join(''));
    }
    ok(orders.size > 20, 'only ' + orders.size + ' daily orders in 60 days');
    const o = C.dailyOrder(12345), sim = C.makeSim(Object.assign({}, B390, { seed: 12345, mode: 'daily', limit: 60, order: o, ghost: true })), ids = [];
    eq(sim.lives, 3); eq(sim.maxLives, 3);
    while (!sim.done) { sim.step(0.05); if (ids[sim.k] == null && sim.k >= 0) ids[sim.k] = sim.ids[0]; }
    eq(ids, o, 'daily phases follow the order');
  });
  await t('crossing walls: a new wall gap is reachable without crossing the other wall (no order-dependent trap)', () => {
    let cols = 0, rows = 0;
    for (let r = 0; r < 12; r++) {
      const sim = C.makeSim(Object.assign({}, B390, { seed: 500 + r * 31, practice: 4, ghost: true })), rr = C.rng32(r + 9);
      let lastC = null, lastR = null, rowY = null;
      while (sim.t < 90) {
        if (Math.floor(sim.t * 2) % 7 === 0) { sim.px = 60 + rr() * 270; sim.py = 200 + rr() * 560; } // wander
        const n = sim.count(); rowY = null;
        if (sim.wRow) for (let i = 0; i < n; i++) if (sim.Y[i] < sim.py + 10 && sim.VY[i] > 0 && sim.VX[i] === 0 && Math.abs(sim.VY[i]) > 1) { rowY = sim.Y[i]; break; }
        const prevC = sim.wCol, prevR = sim.wRow, px = sim.px, py = sim.py, hadRow = rowY != null;
        sim.step(1 / 120);
        if (sim.wCol && sim.wCol !== prevC && prevR) { cols++; if (hadRow) ok(sim.wCol.g >= Math.min(py - 31, sim.Bt - 48) - 0.01, 'column gap ' + sim.wCol.g.toFixed(0) + ' above player ' + py.toFixed(0) + ' while a row is still above'); }
        if (sim.wRow && sim.wRow !== prevR) rows++;
      }
    }
    ok(cols > 50 && rows > 50, cols + ' columns ' + rows + ' rows');
  });

  console.log('Page (390x844 touch, lock-step clock)');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  const LOCK = `(() => { let vt = 1000; const q = []; performance.now = () => vt;
    window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
    window.__adv = n => { for (let i = 0; i < n; i++) { vt += 1000 / 60; const c = q.splice(0); for (const f of c) f(vt); } }; })();`;
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'dark' });
    if (o.lock !== false) await ctx.addInitScript(LOCK);
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP);
    await page.waitForFunction(() => window.__game && document.getElementById('tPlay').getBoundingClientRect().height > 40, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p[0], y: p[1], id: p[2] })) });
    const ctr = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const tap = async sel => { const c = await ctr(sel); await touch('touchStart', [[c[0], c[1], 9]]); await touch('touchEnd', []); };
    const st = () => page.evaluate(() => window.__game.state());
    const adv = n => page.evaluate(k => window.__adv(k), n);
    const until = async (fn, arg, adv1 = 1) => { for (let i = 0; i < 600; i++) { if (await page.evaluate(fn, arg)) return; if (adv1) await adv(adv1); else await new Promise(r => setTimeout(r, 25)); } throw new Error('timeout waiting for ' + fn); };
    // start a mode and hold one finger on the firefly until play begins; returns the finger position
    const start = async sel => {
      await tap(sel); await until(() => window.__game.state().state === 'ready');
      const sn = await page.evaluate(() => window.__game.snap()); await touch('touchStart', [[sn.px, sn.py, 1]]);
      await until(() => window.__game.state().state === 'play'); return [sn.px, sn.py];
    };
    return { ctx, page, touch, ctr, tap, st, adv, until, start };
  }

  let P = await open();
  await t('pause button works while another finger is dragging (pointerdown, not click)', async () => {
    const f = await P.start('#tPlay');
    await P.touch('touchMove', [[f[0] + 20, f[1] - 10, 1]]); await P.adv(10);
    const b = await P.ctr('#bPause');
    await P.touch('touchStart', [[f[0] + 20, f[1] - 10, 1], [b[0], b[1], 2]]); await P.touch('touchEnd', [[b[0], b[1], 2]]);
    await P.until(() => window.__game.state().state === 'paused');
    ok(!(await P.page.evaluate(() => document.getElementById('pause').classList.contains('hidden'))), 'pause card visible');
    await P.touch('touchEnd', [[f[0] + 20, f[1] - 10, 1]]);
  });
  await t('quitting from the pause menu keeps the run: best score and stats are saved', async () => {
    await P.tap('#pMenu'); await P.until(() => window.__game.state().state === 'title'); // (that run is saved too)
    await P.page.evaluate(() => { localStorage.setItem('dodge.best', JSON.stringify({ n: 5, c: 0 })); localStorage.setItem('dodge.stats', JSON.stringify({ games: 0, time: 0, grazes: 0, longest: 0, deaths: {} })); });
    await P.page.reload(); await P.page.waitForFunction(() => window.__game && window.__game.state().state === 'title');
    const f = await P.start('#tPlay');
    await P.until(() => window.__game.state().t >= 6, null, 10);
    const b = await P.ctr('#bPause'); await P.touch('touchStart', [[f[0], f[1], 1], [b[0], b[1], 2]]); await P.touch('touchEnd', [[b[0], b[1], 2]]); await P.touch('touchEnd', []);
    await P.until(() => window.__game.state().state === 'paused');
    const sc = (await P.st()).score;
    await P.tap('#pMenu'); await P.until(() => window.__game.state().state === 'title');
    const best = await P.page.evaluate(() => JSON.parse(localStorage.getItem('dodge.best'))), stt = await P.page.evaluate(() => JSON.parse(localStorage.getItem('dodge.stats')));
    ok(best.n >= sc && sc >= 50, 'best ' + best.n + ' score ' + sc); eq(stt.games, 1); ok(stt.time >= 6, 'time ' + stt.time);
    ok(/最高分 \d+/.test(await P.page.evaluate(() => document.getElementById('tBest').textContent)), 'title shows the best');
    // restart from pause also counts the run, exactly once
    const f2 = await P.start('#tPlay'); await P.until(() => window.__game.state().t >= 2, null, 10);
    const b2 = await P.ctr('#bPause'); await P.touch('touchStart', [[f2[0], f2[1], 1], [b2[0], b2[1], 2]]); await P.touch('touchEnd', [[b2[0], b2[1], 2]]); await P.touch('touchEnd', []);
    await P.until(() => window.__game.state().state === 'paused');
    await P.tap('#pRestart'); await P.until(() => window.__game.state().state === 'ready');
    eq((await P.page.evaluate(() => JSON.parse(localStorage.getItem('dodge.stats')))).games, 2);
  });
  await t('single-finger double tap: bullet time starts and the game does not pause in between', async () => {
    await P.page.reload(); await P.page.waitForFunction(() => window.__game && window.__game.state().state === 'title');
    const f = await P.start('#tPlay'); await P.page.evaluate(() => window.__game.fillGlow());
    await P.touch('touchEnd', [[f[0], f[1], 1]]); await P.adv(3);
    for (let k = 0; k < 2; k++) { await P.touch('touchStart', [[f[0], f[1], 1]]); await P.adv(2); await P.touch('touchEnd', [[f[0], f[1], 1]]); await P.adv(3); }
    let s = await P.st(); eq(s.state, 'play', 'state right after the double tap'); ok(s.bt > 2, 'bullet time ' + s.bt);
    await P.touch('touchStart', [[f[0], f[1], 1]]); await P.adv(30); s = await P.st(); eq(s.state, 'play', 'finger back down: keeps playing');
    await P.touch('touchEnd', [[f[0], f[1], 1]]); await P.adv(30); eq((await P.st()).state, 'lifted', 'lift-to-pause still pauses after 0.3 s');
  });
  await t('daily challenge: 3 lives shown, today\'s pattern order is used', async () => {
    await P.page.reload(); await P.page.waitForFunction(() => window.__game && window.__game.state().state === 'title');
    await P.start('#tDaily'); const s = await P.st();
    eq(s.lives, 3); eq(await P.page.evaluate(() => document.getElementById('hL').textContent), '♥♥♥');
    ok(s.ids.length === 1 && (s.ids[0] === 0 || s.ids[0] === 5), 'daily opener ' + s.ids);
  });
  await P.ctx.close();

  P = await open({ init: `try{localStorage.setItem('dodge.settings','{"sens":"abc","theme":"zzz","lift":"x"}')}catch(e){}` });
  await t('damaged settings: sensitivity falls back to 1.0, firefly position stays a number', async () => {
    await P.tap('#tSet'); await P.until(() => !document.getElementById('settings').classList.contains('hidden'));
    eq(await P.page.evaluate(() => document.getElementById('sensV').textContent), '1.0 倍');
    eq(await P.page.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await P.tap('#sOk'); await P.until(() => document.getElementById('settings').classList.contains('hidden'));
    const f = await P.start('#tPlay');
    for (let k = 1; k <= 5; k++) { await P.touch('touchMove', [[f[0] - 8 * k, f[1] - 6 * k, 1]]); await P.adv(1); }
    const sn = await P.page.evaluate(() => window.__game.snap());
    ok(isFinite(sn.px) && isFinite(sn.py) && sn.px < f[0] - 20, 'firefly at ' + sn.px + ',' + sn.py);
  });
  await P.ctx.close();

  // old saves under the original keys still load
  P = await open({ init: `try{localStorage.setItem('dodge.best','{"n":4321,"c":99}');localStorage.setItem('dodge.stats','{"games":7,"time":300,"grazes":50,"longest":61.5,"deaths":{"螺旋":3}}')}catch(e){}` });
  await t('existing saves (dodge.best / dodge.stats) still load', async () => {
    ok(/最高分 4321/.test(await P.page.evaluate(() => document.getElementById('tBest').textContent)));
    await P.tap('#tRec'); await P.until(() => !document.getElementById('records').classList.contains('hidden'));
    ok(/4321/.test(await P.page.evaluate(() => document.getElementById('rStats').textContent)));
  });
  await P.ctx.close();

  for (const [w, h] of [[844, 390], [375, 500], [360, 640]]) {
    P = await open({ w, h, lock: false, init: `try{localStorage.setItem('dodge.stats','{"games":123,"time":4567,"grazes":9999,"longest":187.3,"deaths":{"交叉牆":12}}')}catch(e){}` });
    await t(`${w}x${h}: records, practice, settings and help fit without scrolling`, async () => {
      for (const [btn, ov, back] of [['#tRec', 'records', '#rOk'], ['#tPractice', 'practice', '#prBack'], ['#tSet', 'settings', '#sOk'], ['#tHelp', 'help', '#hOk']]) {
        await P.tap(btn); await P.until(id => !document.getElementById(id).classList.contains('hidden'), ov, 0);
        await P.until(id => getComputedStyle(document.getElementById(id).querySelector('.card')).animationPlayState !== 'x' && document.getElementById(id).getAnimations({ subtree: true }).every(a => a.playState !== 'running'), ov, 0);
        const r = await P.page.evaluate(id => { const o = document.getElementById(id), sc = o.querySelector('.scroll'), c = o.querySelector('.card').getBoundingClientRect(); return { o: o.scrollHeight - o.clientHeight, s: sc ? sc.scrollHeight - sc.clientHeight : 0, top: c.top, bottom: c.bottom, hx: document.documentElement.scrollWidth - innerWidth }; }, ov);
        ok(r.o <= 1 && r.s <= 1 && r.top >= 0 && r.bottom <= h && r.hx <= 0, ov + ' ' + JSON.stringify(r));
        await P.tap(back); await P.until(id => document.getElementById(id).classList.contains('hidden'), ov, 0);
      }
    });
    await P.ctx.close();
  }
  await browser.close();
  await t('no page or console errors', () => eq(errors, []));
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
