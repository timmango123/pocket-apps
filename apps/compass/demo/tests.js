// Tests for 指南針 (compass): math unit tests against the tool's own core (CORE-START..CORE-END in index.html), then
// browser checks with synthetic DeviceOrientationEvents (Android absolute, iOS webkitCompassHeading + permission).
// Usage: node tests.js   (about 40 s)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {norm360,angleDiff,smoothAngle,smoothK,holdDeg,holdDir,sideTilt,parseDecl,screenAngle,headingFromAlpha,headingFromEuler,headingFromWebkit,toTrue,DIR16,dirIndex,dirName,turnHint,tiltOf,circStd,needsCalibration,fmtHeading};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const nearH = (a, b, e = 1e-6) => Math.abs(C.angleDiff(a, b)) <= e;

// --- wrap helpers ---
t('norm360(-30) = 330', near(C.norm360(-30), 330));
t('norm360(720) = 0', C.norm360(720) === 0);
t('angleDiff 355 -> 5 is +10', near(C.angleDiff(5, 355), 10));
t('angleDiff 5 -> 355 is -10', near(C.angleDiff(355, 5), -10));
t('angleDiff opposite = -180', near(C.angleDiff(180, 0), -180));
t('angleDiff of equal = 0', C.angleDiff(123, 123) === 0);

// --- smoothing across the 0/360 wrap ---
{ let cur = 355; const seen = [];
  for (let i = 0; i < 40; i++) { cur = C.smoothAngle(cur, 5, 0.2); seen.push(cur); }
  t('355 -> 5 moves up through 360, never down through 180', seen.every(v => v >= 355 && v <= 365));
  t('355 -> 5 converges to 5 (mod 360)', nearH(C.norm360(cur), 5, 0.01)); }
{ let cur = 2; for (let i = 0; i < 40; i++) cur = C.smoothAngle(cur, 350, 0.2);
  t('2 -> 350 goes backward through 0 (unwrapped to about -10)', near(cur, -10, 0.05)); }
t('smoothing first step is 20% of the short way', near(C.smoothAngle(350, 10, 0.2), 354));
t('smoothing seeds from the first reading', C.smoothAngle(null, 42) === 42);

// --- screen orientation ---
t('screenAngle uses screen.orientation.angle', C.screenAngle(270, 0) === 270);
t('screenAngle falls back to window.orientation', C.screenAngle(undefined, 90) === 90 && C.screenAngle(undefined, -90) === 270);

// --- heading from Android absolute alpha (counter-clockwise) ---
t('alpha 0 -> heading 0 (north)', C.headingFromAlpha(0) === 0);
t('alpha 90 -> heading 270 (west)', C.headingFromAlpha(90) === 270);
t('alpha 270 -> heading 90 (east)', C.headingFromAlpha(270) === 90);
t('alpha 233 -> heading 127', near(C.headingFromAlpha(233), 127));
t('landscape (+90) adds the screen angle', near(C.headingFromAlpha(233, 90), 217));

// --- tilt-compensated heading from alpha/beta/gamma ---
for (const a of [0, 45, 127, 233, 300]) t('flat: euler heading = 360 - alpha (' + a + ')', nearH(C.headingFromEuler(a, 0, 0, 0), C.headingFromAlpha(a)));
t('pitching the top up does not change the heading', nearH(C.headingFromEuler(233, 40, 0, 0), 127));
t('rolling sideways does not change the heading', nearH(C.headingFromEuler(233, 0, 35, 0), 127) && nearH(C.headingFromEuler(233, 0, -35, 0), 127));
t('held upright (beta 90) reads where the back camera points', nearH(C.headingFromEuler(233, 90, 0, 0), 127));
t('held at 75° still reads 127', nearH(C.headingFromEuler(233, 75, 0, 0), 127));
t('landscape flat: heading of screen-top = device left edge', nearH(C.headingFromEuler(233, 0, 0, 90), 217));
t('landscape 270', nearH(C.headingFromEuler(233, 0, 0, 270), 37));
t('landscape tilted up still matches flat landscape', nearH(C.headingFromEuler(233, 0, 50, 90), 217));

// --- iOS webkitCompassHeading (clockwise already) ---
t('webkitCompassHeading passes through', C.headingFromWebkit(127, 0) === 127);
t('webkitCompassHeading + landscape angle wraps', C.headingFromWebkit(300, 90) === 30);

// --- true north / declination ---
t('true = magnetic + declination (Taiwan -4.5)', near(C.toTrue(127, -4.5), 122.5));
t('true north wraps below 0', near(C.toTrue(2, -4.5), 357.5));
t('east declination wraps past 360', near(C.toTrue(359, 3), 2));
t('zero declination = magnetic', C.toTrue(90, 0) === 90);

// --- 16-point names ---
t('16 names', C.DIR16.length === 16 && new Set(C.DIR16).size === 16);
t('0 -> 北', C.dirName(0) === '北');
t('359 -> 北', C.dirName(359) === '北');
t('11.2 -> 北, 11.3 -> 東北偏北 (22.5° sectors)', C.dirName(11.2) === '北' && C.dirName(11.3) === '東北偏北');
t('45 -> 東北', C.dirName(45) === '東北');
t('67.5 -> 東北偏東', C.dirName(67.5) === '東北偏東');
t('90 -> 東', C.dirName(90) === '東');
t('127 -> 東南 (spec example)', C.dirName(127) === '東南');
t('157.5 -> 東南偏南', C.dirName(157.5) === '東南偏南');
t('180 -> 南', C.dirName(180) === '南');
t('202.5 -> 西南偏南', C.dirName(202.5) === '西南偏南');
t('247.5 -> 西南偏西', C.dirName(247.5) === '西南偏西');
t('270 -> 西', C.dirName(270) === '西');
t('292.5 -> 西北偏西', C.dirName(292.5) === '西北偏西');
t('315 -> 西北', C.dirName(315) === '西北');
t('337.5 -> 西北偏北', C.dirName(337.5) === '西北偏北');
t('negative input wraps (-90 -> 西)', C.dirName(-90) === '西');
t('index formula round(h/22.5) % 16', C.dirIndex(350) === 0 && C.dirIndex(348) === 15);

// --- target guidance ---
{ const h = C.turnHint(150, 127); t('target 150 from 127: turn right 23°', !h.ok && h.d > 0 && h.text === '向右轉 23°'); }
{ const h = C.turnHint(100, 127); t('target 100 from 127: turn left 27°', !h.ok && h.d < 0 && h.text === '向左轉 27°'); }
{ const h = C.turnHint(5, 355); t('target across north: turn right 10°', h.text === '向右轉 10°'); }
{ const h = C.turnHint(359, 1); t('within 3° (across 0) -> 方向正確', h.ok && h.text === '方向正確'); }
t('exactly 3° off is not yet correct', !C.turnHint(10, 7).ok);

// --- tilt / accuracy ---
t('flat tilt = 0', near(C.tiltOf(0, 0), 0));
t('upright tilt = 90', near(C.tiltOf(90, 0), 90));
t('combined tilt > each axis', C.tiltOf(35, 35) > 45);
t('circular std of steady headings ~ 0', C.circStd([10, 10, 10]) < 1e-3);
t('circular std handles the wrap (359, 1) as small', C.circStd([359, 1, 359, 1]) < 1.5);
t('circular std of scattered headings > 10', C.circStd([0, 30, -30, 20, -20, 40]) > 10);
t('iOS accuracy 25 needs calibration', C.needsCalibration(25, 0) === true);
t('iOS accuracy 10 is fine', C.needsCalibration(10, 50) === false);
t('iOS accuracy -1 (invalid) needs calibration', C.needsCalibration(-1, 0) === true);
t('no accuracy field: jitter 12 needs calibration', C.needsCalibration(null, 12) === true);
t('no accuracy field: jitter 3 is fine', C.needsCalibration(undefined, 3) === false);
t('fmtHeading rounds and wraps 359.6 -> 0°', C.fmtHeading(359.6) === '0°' && C.fmtHeading(127.4) === '127°');

// --- time-based adaptive smoothing ---
t('smoothK without a time step falls back to 0.2', C.smoothK(10, 0) === 0.2);
t('smoothK: same time, a big turn moves faster than jitter', C.smoothK(60, 1 / 60) > 2 * C.smoothK(1, 1 / 60));
{ // the same 0.5 s settles about equally at 20, 60 and 120 events a second
  const after = hz => { let cur = 0; for (let i = 0; i < hz / 2; i++) cur = C.smoothAngle(cur, 2, C.smoothK(C.angleDiff(2, cur), 1 / hz)); return cur; };
  const a = after(20), b = after(60), c = after(120);
  t('smoothing feel does not depend on the event rate (' + [a, b, c].map(x => x.toFixed(2)) + ')', Math.abs(a - c) < 0.15 && Math.abs(b - c) < 0.05 && c > 1.9); }
{ let cur = 355; const seen = [];
  for (let i = 0; i < 60; i++) { cur = C.smoothAngle(cur, 5, C.smoothK(C.angleDiff(5, cur), 1 / 60)); seen.push(cur); }
  t('adaptive smoothing 355 -> 5 still goes the short way', seen.every(v => v >= 355 && v <= 365.001) && nearH(C.norm360(cur), 5, 0.05)); }
t('a long gap is clamped (no overshoot)', C.smoothK(90, 10) < 1);

// --- display hysteresis ---
t('holdDeg seeds with the rounded heading', C.holdDeg(null, 127.4) === 127);
t('holdDeg keeps 127 while the reading hovers at 127.5', C.holdDeg(127, 127.6) === 127 && C.holdDeg(127, 127.5) === 127);
t('holdDeg moves once the reading is clearly past', C.holdDeg(127, 127.8) === 128 && C.holdDeg(127, 126.2) === 126);
t('holdDeg across north: 0 shown, 359.6 read -> stays 0', C.holdDeg(0, 359.6) === 0 && C.holdDeg(0, 359.2) === 359);
t('holdDir keeps 北 just past 11.25', C.holdDir(0, 11.8) === 0 && C.holdDir(0, 12.5) === 1);
t('holdDir keeps 西北偏北 just past north', C.holdDir(15, 349) === 15 && C.holdDir(15, 0) === 0);

// --- side tilt (only sideways roll makes the heading unreliable) ---
t('flat: side tilt 0', near(C.sideTilt(0, 0, 0), 0));
t('held upright: side tilt 0', near(C.sideTilt(90, 0, 0), 0, 1e-9));
t('rolled 70° sideways: side tilt 70', near(C.sideTilt(0, 70, 0), 70, 1e-9));
t('landscape: pitching the device top (now the screen side) counts as side tilt', near(C.sideTilt(70, 0, 90), 70, 1e-9) && near(C.sideTilt(0, 70, 90), 0, 1e-9));

// --- declination text ---
t('parseDecl accepts −4.5, -4.5, +3, 4,5, 2°', C.parseDecl('−4.5') === -4.5 && C.parseDecl('-4.5') === -4.5 && C.parseDecl('+3') === 3 && C.parseDecl('4,5') === 4.5 && C.parseDecl('2°') === 2);
t('parseDecl rejects junk', [ '', '-', 'abc', '4.5.1', '1e3', null ].every(v => Number.isNaN(C.parseDecl(v))));

// --- turn hint hysteresis ---
t('once on target, 4° off is still 方向正確', C.turnHint(100, 96, true).ok && !C.turnHint(100, 96, false).ok);
t('once on target, 6° off asks to turn again', C.turnHint(100, 94, true).text === '向右轉 6°');

console.log(`math: ${pass} passed, ${fail} failed`);

// ================= browser =================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const errors = [];
const ok = (c, m) => t(m, c) || (c && console.log('ok   ' + m));
// Feeds orientation events from inside the page every 16 ms; __fd.abs / __fd.rel set what is sent, null stops it.
const FEEDER = () => {
  window.__fd = { abs: null, rel: null, n: 0 };
  setInterval(() => {
    const f = window.__fd;
    if (f.abs) { dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { ...f.abs, absolute: true })); f.n++; }
    if (f.rel) {
      const e = new DeviceOrientationEvent('deviceorientation', f.rel);
      if (f.rel.webkitCompassHeading != null) { Object.defineProperty(e, 'webkitCompassHeading', { value: f.rel.webkitCompassHeading }); Object.defineProperty(e, 'webkitCompassAccuracy', { value: f.rel.webkitCompassAccuracy }); }
      dispatchEvent(e); f.n++;
    }
  }, 16);
};

(async () => {
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const W = { timeout: 10000 };
  async function open(w = 390, h = 844, init, ctxIn) {
    const ctx = ctxIn || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (init) await p.addInitScript(init);
    await p.goto(URL); await p.waitForFunction(() => window.__compass, null, W);
    await p.evaluate(FEEDER);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    // tap = a real touch, then wait until the click has arrived (counted by a capture listener)
    const tap = async sel => {
      const n0 = await p.evaluate(s => { const e = document.querySelector(s); if (!e.__tc) { e.__tc = 0; e.addEventListener('click', () => e.__tc++, true); } return e.__tc; }, sel);
      const q = await center(sel); await touch('touchStart', [q]); await touch('touchEnd', []);
      await p.waitForFunction(([s, n]) => document.querySelector(s).__tc > n, [sel, n0], W);
    };
    const set = (k, v) => p.evaluate(([k, v]) => { window.__fd[k] = v; }, [k, v]);
    const txt = sel => p.$eval(sel, e => e.textContent);
    const waitText = (sel, s) => p.waitForFunction(([sel, s]) => document.querySelector(sel).textContent === s, [sel, s], W);
    const waitHas = (sel, s) => p.waitForFunction(([sel, s]) => document.querySelector(sel).textContent.includes(s), [sel, s], W);
    return { ctx, p, tap, touch, center, set, txt, waitText, waitHas };
  }
  const abs = (alpha, beta = 0, gamma = 0) => ({ alpha, beta, gamma });
  try {
    // ---------- 1. Android: absolute heading, wrap, jitter, tilt, landscape, stall, hidden ----------
    {
      const T = await open(390, 844, () => {
        window.__wl = 0; window.__vis = 'visible';
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => window.__vis });
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: () => { window.__wl++; return Promise.resolve({ release() { window.__wlRel = (window.__wlRel || 0) + 1; return Promise.resolve(); } }); } } });
      });
      const { p } = T;
      await T.set('abs', abs(233));
      await p.waitForTimeout(150);
      ok(await T.txt('#hDeg') === '—°', 'nothing is read before tapping 啟用指南針');
      await T.tap('#goBtn');
      await T.waitText('#hDeg', '127°');
      ok(await T.txt('#hName') === '東南' && await p.isHidden('#gate') && await p.isVisible('#tgtBtn'), 'alpha 233 -> 127° 東南, gate gone, lock button shown');
      ok(await p.evaluate(() => window.__wl) === 1, 'screen wake lock requested on start');
      await p.waitForFunction(() => document.getElementById('readout').getAttribute('aria-label').includes('127° 東南'), null, W);
      ok(true, 'readout accessible name carries the heading (127° 東南)');
      await T.waitText('#accText', '精度良好');

      // the number does not flicker while the reading hovers at a rounding edge (127.4 / 127.6)
      const flick = await p.evaluate(() => new Promise(res => {
        let k = 0; const id = setInterval(() => { window.__fd.abs = { alpha: k++ % 2 ? 232.4 : 232.6, beta: 0, gamma: 0 }; }, 16);
        const el = document.getElementById('hDeg'), seen = new Set(); let changes = 0, last = el.textContent;
        const mo = new MutationObserver(() => { if (el.textContent !== last) { changes++; last = el.textContent; } seen.add(el.textContent); });
        mo.observe(el, { childList: true, characterData: true, subtree: true });
        setTimeout(() => { clearInterval(id); mo.disconnect(); res({ changes, final: el.textContent }); }, 1200);
      }));
      ok(flick.changes <= 1, `reading hovering at 127.5° does not flicker the number (${flick.changes} changes, now ${flick.final})`);

      // wrap: 355 -> 5 turns the dial ~10° the short way
      await T.set('abs', abs(5)); await T.waitText('#hDeg', '355°');
      await p.waitForFunction(() => Math.abs(window.__compass.R.cur % 360 + 360 - 355) % 360 < 0.3, null, W);
      const track = p.evaluate(() => new Promise(res => { const v = []; const t0 = performance.now(); const f = () => { v.push(parseFloat(document.getElementById('rose').getAttribute('transform').match(/rotate\(([-\d.]+)/)[1])); if (performance.now() - t0 < 1000) requestAnimationFrame(f); else res(v); }; requestAnimationFrame(f); }));
      await T.set('abs', abs(355));
      const path1 = await track, span = Math.max(...path1) - Math.min(...path1);
      ok(span < 11, `355° -> 5° turns the dial ~10°, not round the long way (span ${span.toFixed(1)}°)`);
      await T.waitText('#hDeg', '5°'); ok(await T.txt('#hName') === '北', 'then reads 5° 北');

      // a big real turn catches up quickly (adaptive smoothing): 90° in well under a second
      const t0 = Date.now(); await T.set('abs', abs(265)); await T.waitText('#hDeg', '95°');
      ok(Date.now() - t0 < 1500, `a 90° turn settles fast (${Date.now() - t0} ms incl. polling)`);

      // tilt: held upright or pitched is fine; only a sideways roll warns
      await T.set('abs', abs(233, 85, 0)); await T.waitText('#hDeg', '127°');
      await p.waitForTimeout(250);
      ok(await T.txt('#accText') === '精度良好', 'held upright (beta 85) still 127° and no tilt warning');
      await T.set('abs', abs(233, 0, 75)); await T.waitHas('#accText', '請拿正');
      ok(await T.txt('#hDeg') === '127°', 'rolled 75° sideways -> 請拿正手機 warning, heading unchanged');
      await T.set('abs', abs(233, 2, -1)); await T.waitText('#accText', '精度良好');

      // landscape compensation (and the tilt bubble follows the screen)
      await p.evaluate(() => __compass.setForceAngle(90));
      await T.waitText('#hDeg', '217°'); ok(true, 'landscape 90°: 127 + 90 = 217°');
      await T.set('abs', abs(233, 20, 0)); // device top raised = screen's right side raised in landscape
      await p.waitForFunction(() => /translate\(([-\d.]+) /.exec(document.getElementById('tiltDot').getAttribute('transform')) && parseFloat(/translate\(([-\d.]+) /.exec(document.getElementById('tiltDot').getAttribute('transform'))[1]) < -5, null, W);
      ok(true, 'landscape: tilt bubble moves along the screen axis, not the device axis');
      await p.evaluate(() => __compass.setForceAngle(null)); await T.set('abs', abs(233)); await T.waitText('#hDeg', '127°');

      // stall: no events for 3 s -> dimmed with 感測器沒有回應; events back -> live again
      await T.set('abs', null);
      await T.waitText('#accText', '感測器沒有回應');
      ok(await p.$eval('#readout', e => e.classList.contains('stale')), 'stalled sensor dims the reading');
      await T.set('abs', abs(233)); await T.waitText('#accText', '精度良好');
      ok(!await p.$eval('#readout', e => e.classList.contains('stale')), 'events back -> reading live again');

      // hidden: listeners off (events ignored); visible again: listening, wake lock re-requested, no false stall
      await p.evaluate(() => { window.__vis = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
      await T.set('abs', abs(323));
      await p.waitForTimeout(300);
      ok(await p.evaluate(() => Math.round(__compass.R.raw)) === 127, 'while hidden, orientation events are not processed');
      await p.evaluate(() => { window.__vis = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
      await T.waitText('#hDeg', '37°');
      ok(await p.evaluate(() => window.__wl) === 2, 'visible again: listening and wake lock re-requested');
      await T.set('abs', abs(233)); await T.waitText('#hDeg', '127°');

      // long press copies what is shown; a screen reader's activation (click with detail 0) copies too, a plain tap does not
      await p.evaluate(() => { document.getElementById('toast').hidden = true; document.getElementById('toast').textContent = ''; });
      const rq = await T.center('#readout');
      await T.touch('touchStart', [rq]); await T.waitHas('#toast', '127° 東南（磁北）'); await T.touch('touchEnd', []);
      ok(true, 'long press on the reading copies 127° 東南（磁北）');
      await p.evaluate(() => { document.getElementById('toast').textContent = ''; });
      await T.tap('#readout'); await p.waitForTimeout(300);
      ok(await T.txt('#toast') === '', 'a plain tap on the reading does not copy');
      await p.$eval('#readout', e => e.click()); await T.waitHas('#toast', '127° 東南');
      ok(true, 'screen-reader activation (click, detail 0) copies the heading');

      // target lock: turn hint, hysteresis, and screen-reader announcements that don't flood
      await T.tap('#tgtBtn');
      await p.waitForFunction(() => window.__compass.S.target != null, null, W);
      ok(Math.round(await p.evaluate(() => __compass.S.target)) === 127 && await p.isVisible('#tgt'), 'locked target 127° shows the green marker');
      ok(await p.$eval('#turn', e => !e.hasAttribute('aria-live')), 'the per-degree turn hint is not itself a live region');
      const said = await p.evaluate(() => new Promise(res => {
        const live = document.getElementById('live'), out = []; let a = 233;
        const mo = new MutationObserver(() => { if (live.textContent) out.push(live.textContent); }); mo.observe(live, { childList: true, characterData: true, subtree: true });
        // sweep the heading 127 -> 87 over ~1.6 s, one degree every 40 ms
        const id = setInterval(() => { a += 1; window.__fd.abs = { alpha: a, beta: 0, gamma: 0 }; if (a >= 273) { clearInterval(id); setTimeout(() => { mo.disconnect(); res(out); }, 400); } }, 40);
      }));
      ok(said.length <= 2, `turning through 40° speaks at most twice (${JSON.stringify(said)})`);
      await T.waitText('#turn', '向右轉 40°');
      await T.set('abs', abs(234)); await T.waitText('#turn', '方向正確');
      await p.waitForFunction(() => document.getElementById('live').textContent === '方向正確', null, W);
      ok(true, 'reaching the target is announced: 方向正確');
      await T.set('abs', abs(237)); await p.waitForFunction(() => document.getElementById('hDeg').textContent === '123°', null, W);
      await p.waitForTimeout(200);
      ok(await T.txt('#turn') === '方向正確', 'on target, drifting 4° off keeps 方向正確 (no flicker at the 3° edge)');
      await T.set('abs', abs(240)); await T.waitText('#turn', '向右轉 7°'); ok(true, '7° off asks to turn again');

      // touch targets
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input')].filter(e => e.offsetParent).map(e => { const b = e.getBoundingClientRect(); return [e.id || e.textContent, Math.round(b.width), Math.round(b.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      ok(small.length === 0, 'every visible control is at least 44×44 ' + JSON.stringify(small));
      await T.ctx.close();
    }

    // ---------- 2. settings: declination input, sign, persistence and validation ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      let T = await open(0, 0, null, ctx), p = T.p;
      await T.set('abs', abs(233)); await T.tap('#goBtn'); await T.waitText('#hDeg', '127°');
      await T.tap('#trueBtn'); await T.waitText('#hDeg', '123°');
      ok((await T.txt('#refChip')).startsWith('真北（-4.5°）'), 'true north with −4.5° -> 123° (122.5 rounded)');
      await p.fill('#declIn', '−3,5'); await p.$eval('#declIn', e => e.dispatchEvent(new Event('change')));
      await T.waitText('#hDeg', '124°');
      ok(await p.inputValue('#declIn') === '-3.5', 'typed "−3,5" (unicode minus, comma) -> −3.5°');
      await T.tap('#declSign'); await T.waitText('#hDeg', '131°');
      ok(await p.inputValue('#declIn') === '3.5' && (await T.txt('#toast')).includes('偏東'), '± flips the sign (iPhone decimal pad has no minus) -> +3.5 偏東');
      await T.tap('#declMinus'); await p.waitForFunction(() => document.getElementById('declIn').value === '3', null, W);
      ok(true, '− steps 0.5');
      await p.fill('#declIn', 'abc'); await p.$eval('#declIn', e => e.dispatchEvent(new Event('change')));
      await T.waitHas('#toast', '請輸入');
      ok(await p.inputValue('#declIn') === '3', 'junk input is refused and the old value restored');
      await T.tap('#hubBtn'); await p.waitForFunction(() => __compass.S.mode === '16pt', null, W);
      await T.tap('#themeBtn'); await p.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, W);
      await T.tap('#tgtBtn'); await p.waitForFunction(() => __compass.S.target != null, null, W);
      await p.reload(); await p.waitForFunction(() => window.__compass, null, W);
      const st = await p.evaluate(() => ({ ...__compass.S, alt: document.getElementById('readout').classList.contains('alt'), chip: document.getElementById('refChip').textContent, theme: document.documentElement.dataset.theme }));
      ok(st.trueNorth === true && st.declination === 3 && Math.round(st.target) === 127 && st.mode === '16pt' && st.alt && st.chip === '真北（+3°）' && st.theme === 'light', 'reference, declination, target, 16-point mode and theme survive a reload ' + JSON.stringify(st));
      // corrupt / wrongly typed storage is ignored field by field
      await p.evaluate(() => localStorage.setItem('compass.v1', JSON.stringify({ trueNorth: 'yes', declination: '12', target: true, mode: 'x', theme: 'neon' })));
      await p.reload(); await p.waitForFunction(() => window.__compass, null, W);
      const bad = await p.evaluate(() => __compass.S);
      ok(bad.trueNorth === false && bad.declination === -4.5 && bad.target === null && bad.mode === 'deg' && bad.theme === 'auto', 'wrongly typed saved values fall back to defaults ' + JSON.stringify(bad));
      await p.evaluate(() => localStorage.setItem('compass.v1', '{not json'));
      await p.reload(); await p.waitForFunction(() => window.__compass, null, W);
      ok(await p.evaluate(() => __compass.S.declination) === -4.5, 'unparsable storage -> defaults, no error');
      await ctx.close();
    }

    // ---------- 3. iOS: permission from the tap, webkitCompassHeading, uncalibrated, denied ----------
    {
      const T = await open(390, 844, () => { window.__asked = 0; DeviceOrientationEvent.requestPermission = () => { window.__asked++; return Promise.resolve('granted'); }; });
      const { p } = T;
      ok(await p.evaluate(() => window.__asked) === 0, 'iOS: no permission prompt on load');
      await T.tap('#goBtn');
      await p.waitForFunction(() => window.__asked === 1, null, W);
      await T.set('rel', { alpha: 10, beta: 5, gamma: 0, absolute: false, webkitCompassHeading: 291, webkitCompassAccuracy: 10 });
      await T.waitText('#hDeg', '291°');
      ok(await T.txt('#hName') === '西北偏西', 'iOS: permission asked from the tap; webkitCompassHeading 291 -> 291° 西北偏西');
      await T.set('rel', { alpha: 10, beta: 5, gamma: 0, absolute: false, webkitCompassHeading: -1, webkitCompassAccuracy: -1 });
      await T.waitHas('#accText', '需要校正');
      ok(await T.txt('#hDeg') === '291°' && !await p.$eval('#readout', e => e.classList.contains('stale')), 'iOS heading -1 mid-use -> 需要校正 (not a stall), last heading kept');
      await T.ctx.close();
    }
    {
      const T = await open(390, 844, () => { DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted'); });
      await T.set('rel', { alpha: 10, beta: 5, gamma: 0, absolute: false, webkitCompassHeading: -1, webkitCompassAccuracy: -1 });
      await T.tap('#goBtn');
      await T.waitHas('#gateMsg', '需要校正');
      ok(await T.txt('#goBtn') === '再試一次', 'iOS uncalibrated from the start -> 指南針需要校正 (not "no absolute heading"), retry offered');
      await T.ctx.close();
    }
    {
      const deny = () => { DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); };
      const ios = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
      let T = await open(0, 0, deny, ios);
      await T.tap('#goBtn'); await T.waitHas('#gateMsg', '被拒絕');
      ok((await T.txt('#gateMsg')).includes('設定 > Safari') && !await T.p.isDisabled('#goBtn'), 'iOS denied -> Safari settings instructions, button usable again');
      await ios.close();
      T = await open(390, 844, deny);
      await T.tap('#goBtn'); await T.waitHas('#gateMsg', '被拒絕');
      ok((await T.txt('#gateMsg')).includes('動作感應器') && !(await T.txt('#gateMsg')).includes('Safari'), 'Android Chrome denied -> site-settings instructions, not iPhone ones');
      await T.ctx.close();
    }

    // ---------- 4. no sensor / relative only / insecure ----------
    {
      const T = await open(390, 844);
      await T.tap('#goBtn'); await T.waitHas('#gateMsg', '沒有感測器');
      ok(await T.txt('#goBtn') === '再試一次' && await T.p.isHidden('#tgtBtn'), 'desktop without a sensor -> message after 3 s, retry offered');
      await T.set('rel', { alpha: 40, beta: 1, gamma: 1, absolute: false });
      await T.tap('#goBtn'); await T.waitHas('#gateMsg', '不提供絕對方位');
      ok(true, 'relative-only alpha -> 此裝置不提供絕對方位');
      await T.ctx.close();
    }
    {
      const T = await open(390, 844, () => { Object.defineProperty(window, 'isSecureContext', { value: false }); window.__asked = 0; DeviceOrientationEvent.requestPermission = () => { window.__asked++; return Promise.resolve('granted'); }; });
      await T.tap('#goBtn'); await T.waitHas('#gateMsg', 'HTTPS');
      ok(await T.p.evaluate(() => window.__asked) === 0, 'insecure page -> HTTPS message at once, no futile permission prompt');
      await T.ctx.close();
    }

    // ---------- 5. layout: readout and dial together on short and landscape screens ----------
    for (const [w, h] of [[375, 500], [844, 390], [667, 375]]) {
      const T = await open(w, h);
      await T.set('abs', abs(233)); await T.tap('#goBtn');
      await T.p.waitForFunction(() => window.__compass.R.got, null, W);
      const L = await T.p.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { big: r('.big'), dial: r('#dialbox'), btn: r('#tgtBtn'), sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight }; });
      const inView = b => b.top >= 0 && b.bottom <= L.ih + 0.5;
      ok(L.sw <= L.iw && inView(L.big) && inView(L.dial) && (w > h || inView(L.btn)), `${w}×${h}: heading number, whole dial${w > h ? '' : ' and lock button'} visible without scrolling (dial ${Math.round(L.dial.width)}px)`);
      await T.ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception: ' + (e && e.stack || e)); }
  await browser.close();
  ok(errors.length === 0, 'no page or console errors ' + JSON.stringify(errors.slice(0, 3)));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

