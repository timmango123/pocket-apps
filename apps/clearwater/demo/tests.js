// Tests for 清淺水灣 (clearwater), the 9.5 release re-review fixes, in Chromium (SwiftShader WebGL) with real CDP touch:
// taps ripple over (nearly) all the visible water, one ripple per tap; stale fingers can't swallow taps; pinch with a
// third finger doesn't jump; a toolbar resize keeps the player's zoom; the view is saved (pagehide too) and storage is
// validated; hidden tab pauses; 20-144 Hz advance the same; a 30 Hz-capped display keeps its resolution; keyboard
// shortcuts ignore browser chords and key repeat; a lost GL context offers a reload and reloads on restore.
// R1 re-review: buttons act from a per-pointer tap layer (resting finger, edge taps, detail-0 replay, keyboard); no
// external requests; sound with a saved mute; light-ring goal with a saved best, fish, day cycle; wide rain drops;
// the 轉視角 message; a stronger tap splash.
// Usage: node tests.js   (about 90 s)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const FILE = path.resolve(__dirname, '..', 'index.html');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0;
const T0 = Date.now();
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// reduced motion: no ambient drops, so every counted drop comes from the test
const QUIET = () => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /reduced-motion/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q);
};

(async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SKELETON + fs.readFileSync(FILE, 'utf8')); });
  await new Promise(r => srv.listen(0, r)); srv.unref();
  const URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], external = [];
  async function open(w = 390, h = 844, opts = {}) {
    const ctx = opts.ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    if (!opts.ctx) await ctx.addInitScript(QUIET);
    if (opts.init) await ctx.addInitScript(opts.init);
    const p = await ctx.newPage();
    // poll on a timer: SwiftShader frames are slow, and rAF polling would wait a frame per check
    const wff = p.waitForFunction.bind(p);
    p.waitForFunction = (f, a, o) => wff(f, a, { polling: 20, timeout: 15000, ...(o || {}) });
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    p.on('request', r => { if (!r.url().startsWith(URL)) external.push(r.url()); });
    await p.goto(URL); await p.waitForFunction(() => window.__clearwater && window.__clearwater.steps > 0);
    // SwiftShader draws on the CPU: render tiny so the shared cores stay free (nothing here depends on pixels)
    if (!opts.fullRes) await p.evaluate(() => { const g = window.__clearwater; g.perf.noUp = true; g.setScale(0.15); });
    const cdp = await ctx.newCDPSession(p);
    const ev = (f, a) => p.evaluate(f, a);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] || i + 1 })) });
    const fingers = n => p.waitForFunction(n => window.__clearwater.pointers === n, n, { timeout: 5000 });
    // a tap = finger down (wait until the page has it), finger up (wait until it is released)
    const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await fingers(1); await touch('touchEnd', []); await fingers(0); };
    const cw = () => ev(() => { const g = window.__clearwater; return { added: g.added, cam: { ...g.cam }, orbit: g.orbit, rain: g.rain, running: g.running, pointers: g.pointers, scale: g.scale }; });
    return { ctx, p, cdp, ev, touch, fingers, tap, cw };
  }

  // 1. taps ripple across the visible water, exactly one ripple per tap, at the in-lobby and full-screen sizes
  for (const [w, h, need] of [[390, 610, 0.97], [375, 500, 0.97], [844, 390, 0.97], [390, 844, 0.8]]) {
    const t = await open(w, h);
    const bar = await t.ev(() => document.querySelector('.bar').getBoundingClientRect().top);
    let landed = 0, total = 0, wrong = [];
    for (let y = 90; y < bar - 10; y += Math.floor((bar - 100) / 5)) for (let x = 30; x < w; x += Math.floor((w - 40) / 3)) {
      const on = await t.ev(([x, y]) => { const g = window.__clearwater, q = g.toWater(x, y); return !!q && Math.abs(q[0]) <= g.WS && Math.abs(q[1]) <= g.WS; }, [x, y]);
      const a0 = (await t.cw()).added;
      await t.tap(x, y);
      const d = (await t.cw()).added - a0;
      total++; if (on) landed++;
      if (d !== (on ? 1 : 0)) wrong.push(`${x},${y}:${d}`);
    }
    ok(!wrong.length, `${w}×${h}: each tap makes exactly one ripple where it lands on the pool (${wrong.join(' ') || 'all ok'})`);
    ok(landed / total >= need, `${w}×${h}: ${landed}/${total} of tap points across the water reach the pool (need ${need * 100}%; before the fix about a quarter did)`);
    await t.ctx.close();
  }

  // 2. a finger whose end was lost (app switch, notification shade) must not turn the next tap into a pinch
  {
    const t = await open(390, 610);
    await t.ev(() => document.getElementById('c').dispatchEvent(new PointerEvent('pointerdown', { pointerId: 99, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 300, bubbles: true, cancelable: true })));
    ok((await t.cw()).pointers === 1, 'setup: a finger is down and its pointerup will never arrive');
    let a0 = (await t.cw()).added;
    await t.tap(200, 350);
    ok((await t.cw()).added - a0 === 1, 'the next real tap still ripples (stale finger dropped)');
    await t.touch('touchStart', [[150, 300]]); await t.fingers(1);
    await t.ev(() => dispatchEvent(new Event('blur')));
    ok((await t.cw()).pointers === 0, 'window blur forgets fingers that are down');
    await t.touch('touchEnd', []);
    a0 = (await t.cw()).added;
    await t.tap(220, 380);
    ok((await t.cw()).added - a0 === 1, 'and the tap after it ripples');
    await t.ctx.close();
  }

  // 3. pinch: spreading zooms in; a third finger lifting doesn't make the zoom jump; after the pinch the remaining finger orbits
  {
    const t = await open(390, 610);
    const d0 = (await t.cw()).cam.tDist;
    await t.touch('touchStart', [[150, 300, 1], [240, 300, 2]]); await t.fingers(2);
    // 90 px apart → 150 px apart: the zoom distance scales by 90/150
    for (let i = 1; i <= 4; i++) { await t.touch('touchMove', [[150 - i * 7.5, 300, 1], [240 + i * 7.5, 300, 2]]); }
    const want = d0 * 90 / 150;
    await t.p.waitForFunction(w => Math.abs(window.__clearwater.cam.tDist - w) < 0.01, want).catch(() => {});
    const d1 = (await t.cw()).cam.tDist;
    ok(Math.abs(d1 - want) < 0.01, `spreading two fingers zooms in by the spread (${d0.toFixed(2)} → ${d1.toFixed(3)}, want ${want.toFixed(3)})`);
    await t.touch('touchStart', [[120, 300, 1], [270, 300, 2], [200, 450, 3]]); await t.fingers(3);
    await t.touch('touchEnd', [[200, 450, 3]]); await t.fingers(2);
    // a 1 px move must not jump the zoom; wait until that move has been seen (the pinch centre moves the yaw a hair)
    const yb = (await t.cw()).cam.tYaw;
    await t.touch('touchMove', [[121, 300, 1], [270, 300, 2]]);
    await t.p.waitForFunction(yb => window.__clearwater.cam.tYaw !== yb, yb).catch(() => {});
    const d2 = (await t.cw()).cam.tDist;
    ok(Math.abs(d2 - d1) < 0.03, `lifting a third finger doesn't jump the zoom (${d1.toFixed(3)} → ${d2.toFixed(3)})`);
    const a0 = (await t.cw()).added, y0 = (await t.cw()).cam.tYaw;
    await t.touch('touchEnd', [[270, 300, 2]]); await t.fingers(1);
    await t.touch('touchMove', [[170, 300, 1]]);
    await t.p.waitForFunction(y0 => window.__clearwater.cam.tYaw !== y0, y0, { timeout: 5000 }).catch(() => {});
    const s = await t.cw();
    ok(s.added === a0 && s.cam.tYaw !== y0, 'the finger left after a pinch turns the view instead of splashing');
    await t.touch('touchEnd', []); await t.fingers(0);
    await t.ctx.close();
  }

  // 4. a toolbar-style height change keeps the player's zoom; turning to landscape and back reframes for portrait
  {
    const t = await open(390, 760);
    await t.ev(() => { window.__clearwater.cam.tDist = 2.0; });
    await t.p.setViewportSize({ width: 390, height: 700 });
    await t.p.waitForFunction(() => document.getElementById('c').height === Math.round(700 * 0.15));
    ok(Math.abs((await t.cw()).cam.tDist - 2.0) < 1e-9, 'a height-only resize (Safari toolbar) keeps the zoom');
    // wait for the page's own resize handler (the canvas changes shape), not just the viewport
    const wide = w => t.p.waitForFunction(w => { const c = document.getElementById('c'); return (c.width > c.height) === w; }, w);
    await t.p.setViewportSize({ width: 760, height: 390 }); await wide(true);
    await t.p.setViewportSize({ width: 390, height: 760 }); await wide(false);
    ok((await t.cw()).cam.tDist >= 3 - 1e-9, 'rotating back to portrait steps back to the portrait framing');
    await t.ctx.close();
  }

  // 5. the view and the 轉視角 toggle survive a reload; pagehide saves; broken storage falls back cleanly
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 610 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(QUIET);
    let t = await open(0, 0, { ctx });
    const btn = await t.ev(() => { const b = document.getElementById('bOrbit').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width, b.height]; });
    ok(btn[2] >= 44 && btn[3] >= 44, `轉視角 is a 44px+ target (${btn[2]}×${btn[3]})`);
    await t.touch('touchStart', [[btn[0], btn[1]]]); await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => window.__clearwater.orbit === true);
    await t.p.waitForTimeout(150);
    ok((await t.cw()).orbit === true, 'one tap on 轉視角 turns it on once (not toggled twice)');
    // in orbit mode a one-finger drag turns the view and makes no ripple
    const a0 = (await t.cw()).added, y0 = (await t.cw()).cam.tYaw;
    await t.touch('touchStart', [[200, 300]]); await t.fingers(1);
    await t.touch('touchMove', [[150, 280]]); await t.touch('touchMove', [[100, 260]]);
    await t.p.waitForFunction(y0 => window.__clearwater.cam.tYaw > y0 + 0.5, y0, { timeout: 5000 }).catch(() => {});
    await t.touch('touchEnd', []); await t.fingers(0);
    const v = await t.cw();
    ok(v.added === a0 && v.cam.tYaw > y0 + 0.5, 'in 轉視角 mode a drag turns the view without splashing');
    const saved = await t.ev(() => JSON.parse(localStorage.getItem('clearwater:view')));
    ok(saved && Math.abs(saved.pitch - v.cam.tPitch) < 1e-3 && saved.orbit === true, 'lifting the finger saves the view');
    // a change with no gesture end (camera still easing when the page goes away) is saved by pagehide
    await t.ev(() => { const c = window.__clearwater.cam; c.tDist = 1.75; c.tPitch = 0.6; dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); });
    ok(await t.ev(() => JSON.parse(localStorage.getItem('clearwater:view')).dist) === 1.75, 'pagehide saves the view');
    await t.p.close();
    t = await open(0, 0, { ctx });
    let s = await t.cw();
    ok(Math.abs(s.cam.dist - 1.75) < 1e-6 && Math.abs(s.cam.pitch - 0.6) < 1e-6 && s.orbit === true && await t.ev(() => document.getElementById('bOrbit').getAttribute('aria-pressed')) === 'true',
      'after a reload the view (zoom, tilt) and 轉視角 are as they were left');
    await t.p.close();
    for (const bad of ['{"yaw":"x","pitch":99,"dist":null,"orbit":"yes"}', 'not json', '[1,2]', 'null']) {
      await ctx.addInitScript(b => { if (!sessionStorage.getItem('seeded:' + b)) { sessionStorage.setItem('seeded:' + b, 1); localStorage.setItem('clearwater:view', b); } }, bad);
      t = await open(0, 0, { ctx });
      s = await t.cw();
      const sane = s.cam.pitch >= 0.32 && s.cam.pitch <= 1.45 && s.cam.dist >= 1.4 && s.cam.dist <= 4.0 && isFinite(s.cam.yaw) && s.orbit === false;
      ok(sane, `corrupt saved view ${bad} loads a sane view (${JSON.stringify(s.cam)} orbit=${s.orbit})`);
      await t.p.close();
    }
    await ctx.close();
  }

  // 6. a hidden tab stops simulating and rendering, and picks up again when shown
  {
    const t = await open(390, 610);
    const hide = h => t.ev(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, h);
    await hide(true);
    const s0 = await t.ev(() => window.__clearwater.steps);
    await t.p.waitForTimeout(400);
    const s1 = await t.ev(() => window.__clearwater.steps);
    ok(!(await t.cw()).running && s1 === s0, 'hidden: the water stops');
    await hide(false);
    await t.p.waitForFunction(s1 => window.__clearwater.steps > s1 + 5, s1, { timeout: 5000 }).catch(() => {});
    ok((await t.cw()).running && await t.ev(() => window.__clearwater.steps) > s1 + 5, 'shown again: the water moves again');
    await t.ctx.close();
  }

  // 7. frame-rate independence, adaptive resolution, keyboard, lost GL context
  {
    const t = await open(390, 610);
    const r = await t.ev(() => {
      const g = window.__clearwater, out = {};
      for (const hz of [20, 30, 60, 120, 144]) out[hz] = g.simulate(1 / hz, hz).steps;
      // camera easing: same distance covered in the same time
      const ease = hz => { const c = g.cam; c.yaw = 0; c.tYaw = 1; g.simulate(1 / hz, hz / 2); return c.yaw; };
      out.ease = [30, 60, 120, 144].map(ease);
      // rain: same number of drops in the same time
      document.getElementById('bRain').click();
      out.rain = [30, 60, 120].map(hz => g.simulate(1 / hz, hz).drops);
      document.getElementById('bRain').click();
      return out;
    });
    const st = [20, 30, 60, 120, 144].map(h => r[h]);
    ok(Math.max(...st) - Math.min(...st) <= 1, '1 s of water takes the same number of wave steps at 20/30/60/120/144 Hz (' + st.join('/') + ')');
    ok(Math.max(...r.ease) - Math.min(...r.ease) < 1e-9, 'the camera eases the same at 30/60/120/144 Hz');
    ok(Math.max(...r.rain) - Math.min(...r.rain) <= 1, 'rain drops as many drops at 30/60/120 Hz (' + r.rain.join('/') + ')');

    const sc = await t.ev(() => {
      const g = window.__clearwater, out = {};
      g.setScale(1.35); Object.assign(g.perf, { acc: 0, frames: 0, sq: 0, cool: 0, seenFast: false, upAt: -1e9, noUp: false });
      for (let i = 0; i < 300; i++) g.perfTick(1 / 30);
      out.capped = g.scale;
      for (let i = 0; i < 200; i++) g.perfTick(i % 2 ? 0.017 : 0.05);
      out.slow = g.scale;
      g.perf.cool = 0;
      for (let i = 0; i < 300; i++) g.perfTick(1 / 60);
      out.back = g.scale;
      g.perf.noUp = true; g.setScale(0.15);
      return out;
    });
    ok(sc.capped === 1.35, 'a steady 30 Hz (Low Power Mode cap) keeps full resolution');
    ok(sc.slow < 1.35, `uneven slow frames lower the resolution (${sc.slow.toFixed(3)})`);
    ok(sc.back > sc.slow, `headroom brings the resolution back (${sc.back.toFixed(3)})`);

    const rain0 = (await t.cw()).rain;
    await t.p.keyboard.down('Control'); await t.p.keyboard.press('r'); await t.p.keyboard.up('Control');
    ok((await t.cw()).rain === rain0, 'Ctrl+R does not toggle the rain');
    await t.p.keyboard.down('r');
    await t.ev(() => { for (let i = 0; i < 5; i++) dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true })); });
    await t.p.keyboard.up('r');
    ok((await t.cw()).rain === !rain0, 'holding R toggles the rain once');

    const hasExt = await t.ev(() => !!document.getElementById('c').getContext('webgl2') || true);
    const lost = await t.ev(() => { const gl = document.getElementById('c').getContext('webgl2') || document.getElementById('c').getContext('webgl'); const x = gl && gl.getExtension('WEBGL_lose_context'); if (!x) return false; window.__lc = x; x.loseContext(); return true; });
    if (hasExt && lost) {
      await t.p.waitForFunction(() => !document.getElementById('fail').hidden);
      const b = await t.ev(() => { const e = document.getElementById('bReload'); const r = e.getBoundingClientRect(); return { shown: !e.hidden && r.height >= 44, running: window.__clearwater.running }; });
      ok(b.shown && !b.running, 'a lost GL context stops the loop and shows a 44px 重新載入 button');
      const nav = t.p.waitForEvent('framenavigated', { timeout: 10000 }).then(() => true, () => false);
      await t.ev(() => window.__lc.restoreContext());
      ok(await nav, 'when the context comes back the page reloads itself');
      await t.p.waitForFunction(() => window.__clearwater && window.__clearwater.steps > 0, null, { timeout: 15000 }).catch(() => {});
      ok(await t.ev(() => document.getElementById('fail').hidden && window.__clearwater.running), 'and the water is back');
    } else console.log('(skipped context-loss check: no WEBGL_lose_context)');
    await t.ctx.close();
  }

  console.log(`(sections 1-7: ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  // 8. R1 re-review fixes: tap layer (resting finger, edge taps, detail-0 replay, keyboard), no fonts, sound + mute,
  //    goal ring with a saved best, fish, day cycle, wider rain drops, 轉視角 message, a stronger tap splash
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await ctx.addInitScript(QUIET);
    await ctx.addInitScript(() => { window.__pu = 0; document.addEventListener('pointerup', () => window.__pu++, true); });
    let t = await open(0, 0, { ctx });
    const box = id => t.ev(id => { const r = document.getElementById(id).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, id);
    const st = () => t.ev(() => { const g = window.__clearwater; return { acts: g.acts, added: g.added, rip: g.tapRipples, rain: g.rain, orbit: g.orbit, pu: window.__pu }; });
    const settle = () => t.p.waitForTimeout(80);
    // a finger lifted at (x,y) while `rest` fingers stay down; waits until the page has seen the pointerup
    const tap2 = async (x, y, rest = [], radius) => {
      const pu = (await st()).pu;
      const pt = { x, y, id: 9 }; if (radius) { pt.radiusX = pt.radiusY = radius; }
      const restPts = rest.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 }));
      await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...restPts, pt] });
      await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pt] });
      await t.p.waitForFunction(pu => window.__pu > pu, pu, { timeout: 5000 });
      await settle();
    };
    const rain = await box('bRain'), orbit = await box('bOrbit'), calmB = await box('bCalm');

    // (a) a finger resting on the water / on 平靜 / near the title: 下雨 and 轉視角 still toggle exactly once
    for (const [label, rest] of [['水面', [200, 300]], ['平靜', [calmB.cx, calmB.cy]], ['標題旁水面', [200, 40]]]) {
      await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rest[0], y: rest[1], id: 1 }] });
      await settle();
      const s0 = await st();
      await tap2(rain.cx, rain.cy, [rest]);
      const s1 = await st();
      ok(s1.rain === !s0.rain && s1.acts === s0.acts + 1, `finger resting on ${label}: a tap on 下雨 toggles it once (acts +${s1.acts - s0.acts})`);
      await tap2(orbit.cx, orbit.cy, [rest]);
      const s2 = await st();
      ok(s2.orbit === !s1.orbit && s2.acts === s1.acts + 1, `finger resting on ${label}: a tap on 轉視角 toggles it once`);
      await tap2(orbit.cx, orbit.cy, [rest]);
      await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await settle();
    }
    if ((await st()).rain) await tap2(rain.cx, rain.cy);

    // (b) the click Chromium sends after a handled tap (detail 0) must not act a second time; later, a click with no
    //     pointer behind it (Enter/Space, assistive tech) still acts once; Enter on a focused button toggles once
    {
      const s0 = await st();
      await tap2(rain.cx, rain.cy);
      await t.ev(() => document.getElementById('bRain').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      const s1 = await st();
      ok(s1.rain === !s0.rain && s1.acts === s0.acts + 1, 'a tap then a replayed detail-0 click toggles 下雨 once');
      await t.p.waitForTimeout(850);
      await t.ev(() => document.getElementById('bRain').click());
      const s2 = await st();
      ok(s2.rain === s0.rain && s2.acts === s1.acts + 1, 'a click with no tap behind it (assistive tech) still acts');
      await t.ev(() => document.getElementById('bRain').focus());
      await t.p.keyboard.press('Enter');
      await settle();
      const s3 = await st();
      ok(s3.rain === !s2.rain && s3.acts === s2.acts + 1, 'Enter on a focused 下雨 toggles it once');
      await t.p.keyboard.press('Space'); await settle();
      ok((await st()).rain === s2.rain && (await st()).acts === s3.acts + 1, 'Space on a focused 下雨 toggles it once');
      await t.ev(() => document.activeElement.blur());
    }

    // (c) touches 1-8 px outside each button edge: either the button acts once or the water ripples once, never neither or both
    {
      const bad = [];
      let n = 0;
      for (const [id, b] of [['bRain', rain], ['bOrbit', orbit], ['bCalm', calmB]]) {
        const pts = [];
        for (const d of [1, 6]) pts.push([b.l - d, b.cy], [b.r + d, b.cy], [b.cx, b.t - d], [b.cx, b.b + d]);
        for (const [x, y] of pts) for (const radius of [1, 12]) {
          const s0 = await st();
          await tap2(x, y, [], radius);
          const s1 = await st();
          const a = s1.acts - s0.acts, r = s1.rip - s0.rip;
          n++;
          if (a + r !== 1) bad.push(`${id}@${x.toFixed(1)},${y.toFixed(1)}r${radius}:act${a}/rip${r}`);
          if (s1.rain !== s0.rain && a) await tap2(rain.cx, rain.cy);
          if (s1.orbit) await tap2(orbit.cx, orbit.cy);
        }
      }
      ok(!bad.length, `${n} edge touches round the buttons: each does exactly one thing (${bad.slice(0, 6).join(' ') || 'all ok'})`);
      const s0 = await st();
      await tap2(calmB.l - 1, calmB.cy, [], 12);
      ok((await st()).acts === s0.acts + 1, `the R1 case: a touch 1 px left of 平靜 (${(calmB.l - 1).toFixed(1)}, ${calmB.cy.toFixed(0)}) runs 平靜`);
      // a 0.6 s and a 1 s hold on 下雨 each toggle once; a finger dragged far off the button does nothing
      for (const ms of [600, 1000]) {
        const s0 = await st();
        await t.touch('touchStart', [[rain.cx, rain.cy]]); await t.p.waitForTimeout(ms); await t.touch('touchEnd', []);
        await t.p.waitForFunction(pu => window.__pu > pu, s0.pu); await settle();
        const s1 = await st();
        ok(s1.acts === s0.acts + 1 && s1.rain === !s0.rain, `a ${ms / 1000} s hold on 下雨 toggles it once`);
      }
      const s2 = await st();
      await t.touch('touchStart', [[rain.cx, rain.cy]]); await t.touch('touchMove', [[rain.cx, rain.cy - 80]]); await t.touch('touchEnd', []);
      await t.p.waitForFunction(pu => window.__pu > pu, s2.pu); await settle();
      ok((await st()).acts === s2.acts, 'a finger slid 80 px off 下雨 before lifting does not toggle it');
    }

    // (d) 轉視角: turning it on explains itself, and a tap on the water while it is on says why there is no ripple
    {
      await tap2(orbit.cx, orbit.cy);
      let h = await t.ev(() => window.__clearwater.hint);
      ok((await st()).orbit && h.shown && /單指拖曳轉動視角/.test(h.text), 'turning 轉視角 on shows how it works: ' + h.text.replace(/\n/g, ' / '));
      await t.ev(() => document.getElementById('hint').classList.add('gone'));
      const s0 = await st(), o0 = await t.ev(() => window.__clearwater.orbitTaps);
      await t.tap(200, 400);
      h = await t.ev(() => window.__clearwater.hint);
      ok((await st()).added === s0.added && await t.ev(() => window.__clearwater.orbitTaps) === o0 + 1 && h.shown && /再按一次「轉視角」回到點水/.test(h.text),
        'a tap on the water with 轉視角 on makes no ripple but shows the reason');
      await tap2(orbit.cx, orbit.cy);
      ok(!(await st()).orbit, '轉視角 off again');
    }

    // (e) sound: synthesized, starts after a tap, the mute button stops the AudioContext and is saved
    {
      const snd = () => t.ev(() => window.__clearwater.sound);
      await t.tap(200, 450);
      await t.p.waitForFunction(() => window.__clearwater.sound.state === 'running', null, { timeout: 5000 }).catch(() => {});
      ok((await snd()).on && (await snd()).state === 'running', 'sound is on by default and the AudioContext runs after a tap: ' + JSON.stringify(await snd()));
      const sb = await box('bSound');
      ok(sb.b - sb.t >= 44 && sb.r - sb.l >= 44, '聲音 button is a 44px+ target');
      await tap2(sb.cx, sb.cy);
      await t.p.waitForFunction(() => window.__clearwater.sound.state !== 'running', null, { timeout: 5000 }).catch(() => {});
      const m = await snd();
      ok(!m.on && m.state === 'suspended' && await t.ev(() => localStorage.getItem('clearwater:sound')) === '0' && await t.ev(() => document.getElementById('bSound').getAttribute('aria-pressed')) === 'false',
        'tapping 聲音 mutes: AudioContext suspended, saved, button shows off ' + JSON.stringify(m));
    }

    // (f) light ring goal: a leaf nudged into the ring scores, the best is saved and survives a reload
    {
      const r = await t.ev(() => {
        const g = window.__clearwater, l = g.leaves[0];
        g.ring.x = l.x; g.ring.z = l.z; g.ring.a = 1; g.ring.show = true;
        g.simulate(1 / 60, 3);
        const after = { ...g.goal, ringShow: g.ring.show, score: document.getElementById('sNow').textContent, best: document.getElementById('sBest').textContent };
        g.simulate(1 / 30, 150);   // fades out, comes back somewhere away from the leaves
        after.back = g.ring.show && g.leaves.every(l => Math.hypot(l.x - g.ring.x, l.z - g.ring.z) > g.ring.r);
        return after;
      });
      ok(r.now === 1 && r.best >= 1 && !r.ringShow && r.score === '1', `a leaf in the light ring scores 1 and the ring moves on (${JSON.stringify(r)})`);
      ok(r.back, 'the ring comes back somewhere else, clear of the leaves');
      const saved = await t.ev(() => JSON.parse(localStorage.getItem('clearwater:stats')));
      ok(saved && saved.best >= 1 && saved.total >= 1, 'the best and the total are saved');
      // fish dart away from a splash near them
      const f = await t.ev(() => {
        const g = window.__clearwater, f = g.fish[0], s0 = g.scares;
        const rw = g.toWater(195, 500); f.x = rw[0] + 0.15; f.z = rw[1]; f.burst = 0;
        return { s0, x: f.x, z: f.z };
      });
      await t.tap(195, 500);
      const f2 = await t.ev(() => { const g = window.__clearwater, f = g.fish[0]; return { scares: g.scares, burst: f.burst }; });
      ok(f2.scares > f.s0 && f2.burst > 0.3, `a tap next to a fish makes it dart away (burst ${f2.burst.toFixed(2)})`);
      // day cycle: dusk and a glowing night come round, with a short note
      const d = await t.ev(() => { const g = window.__clearwater, o = {}; g.setDay(0.3); o.day = [g.phase, g.night, g.dusk]; g.setDay(0.58); o.dusk = [g.phase, g.night, g.dusk, g.hint.text]; g.setDay(0.78); o.night = [g.phase, g.night, g.dusk, g.hint.text]; g.setDay(0.1); return o; });
      ok(d.day[0] === '白晝' && d.day[1] === 0 && d.day[2] === 0, 'day: no dusk or night tint');
      ok(d.dusk[0] === '黃昏' && d.dusk[2] > 0.5 && /黃昏/.test(d.dusk[3]), 'dusk comes round with a note: ' + d.dusk[3]);
      ok(d.night[0] === '夜' && d.night[1] > 0.99 && /微光/.test(d.night[3]), 'night: the water glows, with a note: ' + d.night[3]);
      // rain drops are 2.5+ cells wide (no checkerboard); the tap splash is bigger than before
      const w = await t.ev(() => ({ rainR: window.__clearwater.rainR, tap: window.__clearwater.tapDrop }));
      ok(w.rainR >= 2.5, `rain drops are ${w.rainR.toFixed(1)} cells in radius (were about 1)`);
      ok(w.tap.r >= 0.1 && w.tap.s >= 0.04, 'a tap splash is wider and stronger than R1 (0.08 / 0.028)');
      await t.p.close();
      // reload: best, mute and the rest are as they were; corrupt stats load cleanly
      t = await open(0, 0, { ctx });
      const g2 = await t.ev(() => ({ goal: window.__clearwater.goal, sound: window.__clearwater.sound, best: document.getElementById('sBest').textContent, pressed: document.getElementById('bSound').getAttribute('aria-pressed') }));
      ok(g2.goal.best >= 1 && g2.goal.now === 0 && g2.best === String(g2.goal.best), 'after a reload the best ring count is still there ' + JSON.stringify(g2.goal));
      ok(!g2.sound.on && g2.pressed === 'false', 'after a reload the sound stays muted');
      await t.p.close();
      for (const bad of ['{"best":"x","total":-3}', 'nope', '{"best":1e999}']) {
        await ctx.addInitScript(b => { if (!sessionStorage.getItem('seedS:' + b)) { sessionStorage.setItem('seedS:' + b, 1); localStorage.setItem('clearwater:stats', b); } }, bad);
        t = await open(0, 0, { ctx });
        const g = await t.ev(() => window.__clearwater.goal);
        ok(g.best === 0 && g.total === 0, `corrupt saved stats ${bad} load as 0`);
        await t.p.close();
      }
    }
    await ctx.close();
  }

  ok(!external.length, 'no requests leave the page (no web fonts): ' + external.join(' '));

  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed (${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
