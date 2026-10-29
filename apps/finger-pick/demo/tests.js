// 手指輪盤 regression tests (real CDP touch). Usage: node tests.js
// 1. maxTouchPoints is only a hint: every touch point that arrives counts (a phone reporting 5 still takes 8).
// 2. Release-review fixes (2026-10-25): re-roll after a result without lifting all at once, ring size vs
//    neighbours, label contrast, result pill, default timing + progress during "stable", glow without
//    shadowBlur, idle rAF stop + wake lock release, settings sheet scroll on short screens, row 2 collapse,
//    sanitised localStorage settings.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '..', 'index.html');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const mk = async (o = {}) => {
    const vp = o.viewport || { width: 390, height: 844 };
    const ctx = await b.newContext({ viewport: vp, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light' });
    if (o.init) await ctx.addInitScript(o.init);
    const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p), errors = [];
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('pageerror', e => errors.push(String(e)));
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: o.mtp || 10 });
    await p.goto('file://' + SRC); await p.waitForTimeout(250);
    const r = await p.locator('#stage').boundingBox();
    const pts = list => list.map(([id, x, y]) => ({ id, x: r.x + x, y: r.y + y, radiusX: 8, radiusY: 8 }));
    const touch = (type, list) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts(list || []) });
    const st = () => p.evaluate(() => ({ phase: window.__fp.phase, n: window.__fp.touches.size, late: [...window.__fp.touches.values()].filter(t => t.late).length }));
    return { ctx, p, cdp, r, touch, st, errors };
  };
  ok(!/\.shadowBlur\s*=/.test(fs.readFileSync(SRC, 'utf8')), 'no per-frame shadowBlur glow (perf)');

  // --- 1. 8 fingers on a phone reporting 5
  {
    const { ctx, p, cdp, r } = await mk({ mtp: 5 });
    ok(await p.evaluate(() => navigator.maxTouchPoints) === 5, 'device reports 5 touch points');
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: r.x + r.width * (0.15 + 0.1 * i), y: r.y + r.height * (0.3 + 0.05 * (i % 3)), id: i + 1, radiusX: 8, radiusY: 8 }));
    for (let n = 1; n <= 8; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.slice(0, n) });
    await p.waitForTimeout(100);
    ok(await p.evaluate(() => window.__fp.touches.size) === 8, '8 fingers all counted');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(100);
    ok(await p.evaluate(() => window.__fp.touches.size) === 0, 'all released');
    await ctx.close();
  }

  // --- 2. defaults, progress during stable, re-roll (veto fix), result pill, idle loop + wake lock
  {
    const init = () => { window.__wl = { req: 0, rel: 0 }; Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wl.req++; const l = new EventTarget(); l.release = async () => { window.__wl.rel++; l.dispatchEvent(new Event('release')); }; return l; } } }); };
    const { ctx, p, touch, st, errors, r } = await mk({ init });
    const S = await p.evaluate(() => window.__fp.S);
    ok(S.stableSec === 1 && S.countdownSec === 2, `default timing 1 s stable + 2 s countdown (${S.stableSec}/${S.countdownSec})`);
    await sleep(200);
    ok(await p.evaluate(() => window.__fp.looping) === false, 'idle: rAF loop stopped with no fingers');
    const A = [1, 80, 200], B = [2, 290, 260], C = [3, 180, 480];
    await touch('touchStart', [A]); await touch('touchStart', [A, B]); await touch('touchStart', [A, B, C]);
    const t0 = Date.now();
    await sleep(500);
    const pr = await p.evaluate(() => [window.__fp.phase, window.__fp.progress]);
    ok(pr[0] === 'stable' && pr[1] > 0.08, `progress ring moves during stable (${pr})`);
    while ((await st()).phase !== 'result' && Date.now() - t0 < 6000) await sleep(50);
    const dt = Date.now() - t0;
    ok(dt < 3600, `result after ${dt} ms with defaults`);
    ok(await p.evaluate(() => window.__wl.req) >= 1, 'wake lock requested while fingers down');
    // reviewer's reroll.js: A lifts and comes back, then B and C lift and come back (never zero fingers)
    await touch('touchEnd', [A]); await sleep(300);               // A lifts (listed points are released)
    await touch('touchStart', [B, C, A]); await sleep(200);       // A back (late)
    let s1 = await st();
    ok(s1.late === 1 && s1.phase === 'result', 'A put back during result is late, result kept');
    await touch('touchEnd', [B, C]); await sleep(300);            // B, C lift
    s1 = await st();
    ok(s1.phase === 'wait' && s1.late === 0 && s1.n === 1, `all participants lifted -> new round with A (${JSON.stringify(s1)})`);
    await touch('touchStart', [A, B]); await touch('touchStart', [A, B, C]);
    await sleep(3500);
    s1 = await st();
    const ch = await p.evaluate(() => [...window.__fp.touches.values()].filter(t => t.chosen).length);
    ok(s1.phase === 'result' && s1.late === 0 && ch === 1, `staggered re-place gives a new result (${JSON.stringify(s1)}, chosen ${ch})`);
    // all lift and re-place within 500 ms -> new round (not late)
    await touch('touchEnd', []); await sleep(150);
    ok((await st()).phase === 'result', 'result lingers right after everyone lifts');
    await touch('touchStart', [A]); await touch('touchStart', [A, B]); await touch('touchStart', [A, B, C]);
    await sleep(100);
    s1 = await st();
    ok(s1.phase === 'stable' && s1.late === 0, `quick re-place within 500 ms starts a new round (${JSON.stringify(s1)})`);
    await sleep(3400);
    ok((await st()).phase === 'result', 'quick re-place round reaches a result');
    // result pill: solid background, moves away from a finger at the top
    const pill = await p.evaluate(() => getComputedStyle(document.querySelector('#msg')).backgroundColor);
    ok(/rgb\(255, 255, 255\)/.test(pill), `result text sits on a solid pill (${pill})`);
    await touch('touchEnd', []); await sleep(700);
    await touch('touchStart', [[1, r.width / 2, 40]]); await touch('touchStart', [[1, r.width / 2, 40], [2, 100, 300]]);
    await sleep(3500);
    const pill2 = await p.evaluate(() => { const m = document.querySelector('#msg').getBoundingClientRect(); const s = document.querySelector('#stage').getBoundingClientRect(); return { top: m.top - s.top, R: window.__fp.R }; });
    ok(pill2.top > 40 + pill2.R + 20, `pill moved clear of a finger at the top (${JSON.stringify(pill2)})`);
    await touch('touchEnd', []); await sleep(700);
    ok(await p.evaluate(() => window.__fp.phase === 'wait' && !window.__fp.looping), 'loop stops again after reset');
    ok(await p.evaluate(() => window.__wl.rel >= 1 && !window.__fp.wake), 'wake lock released when nobody is touching');
    ok(errors.length === 0, 'no console errors (flow) ' + errors.join(' | '));
    await ctx.close();
  }

  // --- 3. ring size: 4 fingers in a row across a 360 px phone don't overlap
  {
    const { ctx, p, touch, r } = await mk({ viewport: { width: 360, height: 640 } });
    const xs = [0.15, 0.383, 0.617, 0.85].map(f => f * r.width), y = r.height / 2;
    const pts = xs.map((x, i) => [i + 1, x, y]);
    for (let i = 1; i <= 4; i++) await touch('touchStart', pts.slice(0, i));
    await sleep(600);
    const R = await p.evaluate(() => window.__fp.R), lw = Math.max(6, Math.round(R * 0.22));
    const outer = R + Math.min(3, R * 0.07) + lw / 2 + 5 + 1.5, gap = xs[1] - xs[0];
    ok(2 * outer <= gap + 0.5, `4 rings across 360 px: outer radius ${outer.toFixed(1)}, spacing ${gap.toFixed(1)}`);
    await touch('touchEnd', []); await sleep(700);
    await touch('touchStart', [[1, 80, 200]]); await touch('touchStart', [[1, 80, 200], [2, 260, 360]]);
    await sleep(600);
    ok(await p.evaluate(() => window.__fp.R) > 40, 'far-apart fingers keep the big ring');
    await touch('touchEnd', []); await ctx.close();
  }

  // --- 4. label contrast on every finger colour, both themes
  for (const dark of [false, true]) {
    const { ctx, p } = await mk({ dark });
    const worst = await p.evaluate(() => {
      const cs = getComputedStyle(document.documentElement), F = window.__fp;
      let w = 99, at = '';
      for (let i = 0; i < 10; i++) { const c = cs.getPropertyValue('--f' + i).trim(), ink = F.inkOn(c), a = F.lum(c), b = F.lum(ink); const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); if (cr < w) { w = cr; at = c + ' / ' + ink; } }
      return [w, at];
    });
    ok(worst[0] >= 3, `${dark ? 'dark' : 'light'}: label contrast >= 3:1 on every colour (worst ${worst[0].toFixed(2)} ${worst[1]})`);
    await ctx.close();
  }

  // --- 5. layout: row 2 only when K is needed; settings sheet opens at the top on a short screen
  {
    const { ctx, p } = await mk({ viewport: { width: 375, height: 500 } });
    const h1 = (await p.locator('#stage').boundingBox()).height;
    ok(await p.isHidden('#krow'), 'pick1: K row collapsed');
    await p.click('#mode-pickk');
    ok(await p.isVisible('#kbox'), 'pickk: K row shown');
    const h2 = (await p.locator('#stage').boundingBox()).height;
    ok(h1 - h2 >= 44, `collapsed row gives the stage ${Math.round(h1 - h2)} px`);
    await p.click('#mode-order'); ok(await p.isHidden('#krow'), 'order: K row collapsed');
    await p.click('#settings-btn'); await sleep(100);
    const t = await p.evaluate(() => { const a = document.querySelector('#set-title').getBoundingClientRect(), x = document.querySelector('#set-close').getBoundingClientRect(); return [a.top, x.top, x.bottom, innerHeight, document.activeElement.id]; });
    ok(t[0] >= 0 && t[1] >= 0 && t[2] <= t[3], `375x500 settings: title and close visible (${t})`);
    ok(t[4] === 'set-close', 'focus starts on the close button');
    await ctx.close();
  }

  // --- 6. saved settings: out-of-range values are clamped; valid old data still loads
  {
    const bad = () => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('finger-pick:v1:settings', JSON.stringify({ mode: 'zzz', k: 99, countdownSec: -5, stableSec: 'a', sound: 'yes' })); localStorage.setItem('finger-pick:v1:theme', '"neon"'); } };
    const { ctx, p, errors } = await mk({ init: bad });
    const S = await p.evaluate(() => [window.__fp.S, document.documentElement.dataset.theme || 'auto', document.querySelector('#k-val').textContent]);
    ok(S[0].mode === 'pick1' && S[0].k === 9 && S[0].countdownSec === 1 && S[0].stableSec === 1 && S[0].sound === true && S[1] === 'auto', `corrupt settings sanitised ${JSON.stringify(S)}`);
    const t = await p.evaluate(() => [window.__fp.sanitize({ mode: 'teams', k: 9 }).k, window.__fp.sanitize({ mode: 'order', k: 3, countdownSec: 3, stableSec: 2, sound: false, vibrate: false })]);
    ok(t[0] === 5 && t[1].mode === 'order' && t[1].k === 3 && t[1].countdownSec === 3 && t[1].stableSec === 2 && t[1].sound === false, `teams k clamps to 5; old valid settings kept ${JSON.stringify(t)}`);
    await p.evaluate(() => localStorage.setItem('finger-pick:v1:settings', JSON.stringify({ mode: 'teams', k: 3, countdownSec: 4, stableSec: 2, sound: true, vibrate: false })));
    await p.reload(); await sleep(200);
    const S2 = await p.evaluate(() => window.__fp.S);
    ok(S2.mode === 'teams' && S2.k === 3 && S2.countdownSec === 4 && S2.vibrate === false, 'existing saved settings load unchanged');
    ok(errors.length === 0, 'no console errors (storage) ' + errors.join(' | '));
    await ctx.close();
  }

  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
