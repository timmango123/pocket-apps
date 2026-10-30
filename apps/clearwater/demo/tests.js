// Tests for 清淺水灣 (clearwater), the 9.5 release re-review fixes, in Chromium (SwiftShader WebGL) with real CDP touch:
// taps ripple over (nearly) all the visible water, one ripple per tap; stale fingers can't swallow taps; pinch with a
// third finger doesn't jump; a toolbar resize keeps the player's zoom; the view is saved (pagehide too) and storage is
// validated; hidden tab pauses; 20-144 Hz advance the same; a 30 Hz-capped display keeps its resolution; keyboard
// shortcuts ignore browser chords and key repeat; a lost GL context offers a reload and reloads on restore.
// Usage: node tests.js   (about 45 s)
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const FILE = path.resolve(__dirname, '..', 'index.html');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0;
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
  const errors = [];
  async function open(w = 390, h = 844, opts = {}) {
    const ctx = opts.ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    if (!opts.ctx) await ctx.addInitScript(QUIET);
    if (opts.init) await ctx.addInitScript(opts.init);
    const p = await ctx.newPage();
    // poll on a timer: SwiftShader frames are slow, and rAF polling would wait a frame per check
    const wff = p.waitForFunction.bind(p);
    p.waitForFunction = (f, a, o) => wff(f, a, { polling: 20, timeout: 15000, ...(o || {}) });
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/ERR_|fonts\.g/.test(m.text())) errors.push(m.text()); });
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

  ok(!errors.length, 'no page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
