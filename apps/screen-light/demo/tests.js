// Regression tests for 螢幕補光 (screen-light): touch layer (pointerup per pointerId, resting fingers, detail-0 clicks),
// long-press warning ghost, light gestures per pointer, short-screen panel reach, gesture hint, stored brightness, chip size.
// Usage: node tests.js   (about 30 s). Served over http so localStorage survives reloads.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const KEY = 'screen-light:v1:settings';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok   ' + m); } else { fail++; console.log('FAIL ' + m); } };
const W = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  const TO = { timeout: 8000 };
  async function open(w, h, seed) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (seed !== undefined) await p.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [KEY, seed]);
    await p.goto(URL); await p.waitForFunction(() => window.__light, null, TO);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', []); };
    const tap = async (sel, hold) => tapAt(await center(sel), hold);
    const S = () => p.evaluate(() => ({ preset: __light.st.preset, mode: __light.st.mode, br: __light.st.brightness, off: document.getElementById('panel').classList.contains('off'), dlg: !document.getElementById('warn-dlg').hidden, ack: document.getElementById('warn-ack').checked }));
    const until = (fn, arg) => p.waitForFunction(fn, arg, TO).then(() => true, () => false);
    // reset state; if the panel was hidden, wait for its slide-in to finish so control positions are final
    const reset = async () => { const wasOff = await p.evaluate(() => { const s = __light.st; s.preset = 'kelvin'; s.mode = 'steady'; s.kelvin = 5500; s.brightness = 1; const o = document.getElementById('panel').classList.contains('off'); __light.setPanel(true); return o; }); if (wasOff) await W(320); };
    return { ctx, p, T, center, tapAt, tap, S, until, reset };
  }
  try {
    // ---------- 1. controls act on pointerup per pointerId; detail-0 follow-up click swallowed ----------
    {
      const { ctx, p, T, center, tapAt, tap, S, until, reset } = await open(390, 844);
      // count action runs per control (bubble listener sees only clicks the guard lets through)
      await p.evaluate(() => { window.__n = {}; document.querySelectorAll('button, #warn-ack, #custom-color').forEach(b => b.addEventListener('click', () => { __n[b.id] = (__n[b.id] || 0) + 1; })); });
      const n = id => p.evaluate(id => __n[id] || 0, id);
      const zero = () => p.evaluate(() => { __n = {}; });
      for (const [id, hold] of [['p-red', 40], ['p-blue', 600], ['p-green', 1000]]) {
        await reset(); await zero(); await tap('#' + id, hold);
        ok(await until(id => __light.st.preset === id.slice(2), id), `tap held ${hold} ms on #${id} selects it`);
        await W(250); ok(await n(id) === 1, `#${id} ran exactly once (hold ${hold} ms)`);
      }
      // resting finger on the light while tapping panel controls
      for (const [sel, check] of [['#p-red', s => s.preset === 'red'], ['#m-breath', s => s.mode === 'breath'], ['#p-warm', s => s.preset === 'warm']]) {
        await reset(); await W(50);
        const rest = [195, 100, 2], c = await center(sel);
        await T('touchStart', [rest]); await W(150);
        await T('touchStart', [rest, [...c, 1]]); await W(50); await T('touchEnd', [[...c, 1]]);
        await W(200); ok(check(await S()), `${sel} fires while another finger rests on the light`);
        await T('touchEnd', [rest]); await W(250);
        ok(!(await S()).off, `${sel}: the resting finger lifting off the light does not hide the panel (item 3)`);
      }
      // resting finger on the panel title: hide button works
      await reset(); await W(50);
      { const hd = await center('.head h1'), hb = await center('#hide-btn');
        await T('touchStart', [[...hd, 2]]); await W(100); await T('touchStart', [[...hd, 2], [...hb, 1]]); await W(50); await T('touchEnd', [[...hb, 1]]);
        ok(await until(() => document.getElementById('panel').classList.contains('off')), '#hide-btn fires while another finger rests on the panel');
        await T('touchEnd', [[...hd, 2]]); await W(100); }
      // detail-0 click replay after a tap: on the control, its edge point and elementFromPoint -> once
      for (const sel of ['#p-red', '#m-breath']) {
        await reset(); await W(50); await zero();
        await tap(sel); await until(s => (__n[s.slice(1)] || 0) >= 1, sel);
        await p.evaluate(sel => {
          const e = document.querySelector(sel), b = e.getBoundingClientRect();
          const fire = el => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
          fire(e); fire(document.elementFromPoint(b.left + 1, b.top + 1)); fire(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
        }, sel);
        await W(150);
        { const k = await n(sel.slice(1)); ok(k === 1, `${sel}: tap + detail-0 clicks run the action once (${k})`); }
      }
      // fullscreen: tap + detail-0 click must not toggle twice
      await reset(); await W(50); await zero();
      await tap('#fs-btn');
      ok(await until(() => !!document.fullscreenElement), '#fs-btn tap enters fullscreen');
      await p.evaluate(() => document.getElementById('fs-btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      await W(400);
      ok(await p.evaluate(() => !!document.fullscreenElement) && await n('fs-btn') === 1, 'tap + detail-0 click on #fs-btn toggles fullscreen only once');
      await p.evaluate(() => document.fullscreenElement && document.exitFullscreen()); await W(200);
      // a lone detail-0 click (no tap in the last 800 ms) acts once; keyboard Enter acts once
      await W(900); await zero();
      await p.evaluate(() => document.getElementById('p-blue').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      ok(await n('p-blue') === 1 && (await S()).preset === 'blue', 'a lone detail-0 click (no recent tap) acts once');
      await tap('#p-red'); await until(() => __light.st.preset === 'red');
      await p.focus('#p-warm'); await p.keyboard.press('Enter');
      ok(await until(() => __light.st.preset === 'warm'), 'keyboard Enter right after a tap still activates a control');
      // dialog controls with a resting finger: ack and start
      await reset(); await W(50);
      await tap('#m-strobe'); ok(await until(() => !document.getElementById('warn-dlg').hidden), 'strobe opens the photosensitivity warning');
      await W(100);
      { const rest = [20, 20, 2], a = await center('#warn-ack');
        await T('touchStart', [rest]); await W(100); await T('touchStart', [rest, [...a, 1]]); await W(40); await T('touchEnd', [[...a, 1]]);
        ok(await until(() => document.getElementById('warn-ack').checked), '#warn-ack ticks while another finger rests on the screen');
        await T('touchEnd', [rest]); await W(100); }
      ok(await n('warn-ack') === 1, '#warn-ack toggled once');
      await tap('#warn-ok');
      ok(await until(() => __light.st.mode === 'strobe' && document.getElementById('warn-dlg').hidden), '#warn-ok starts strobe');
      await tap('#m-steady'); await until(() => __light.st.mode === 'steady');
      // tapping the light where a chip will appear: panel shows, chip does not fire
      await reset(); const rc = await center('#p-red'); await p.evaluate(() => __light.setPanel(false)); await W(300);
      await tapAt(rc); ok(await until(() => !document.getElementById('panel').classList.contains('off')), 'tap on the light shows the panel');
      await W(300); ok((await S()).preset === 'kelvin', 'the chip that appears under the finger does not fire');
      await ctx.close();
    }
    // ---------- 2. long press opens the warning under the finger: lifting finger never ticks it ----------
    for (const [w, h] of [[390, 844], [360, 640], [844, 390]]) {
      const { ctx, p, tapAt, tap, S, until } = await open(w, h);
      const lb = await p.evaluate(() => { const d = document.getElementById('warn-dlg'); d.hidden = false; const b = document.querySelector('label.ack').getBoundingClientRect(); d.hidden = true; return [b.left + b.width / 2, b.top + b.height / 2]; });
      await p.evaluate(() => __light.setPanel(false)); await W(300);
      await tapAt(lb, 1150);
      ok(await until(() => !document.getElementById('warn-dlg').hidden), `${w}x${h}: long press opens the warning`);
      await W(300);
      const s = await S();
      ok(!s.ack && s.mode === 'steady', `${w}x${h}: the lifting finger does not tick 我已了解風險`);
      await tap('label.ack'); ok(await until(() => document.getElementById('warn-ack').checked), `${w}x${h}: a fresh tap on the label ticks it`);
      await ctx.close();
    }
    // ---------- 3. light gestures per pointerId ----------
    {
      const { ctx, p, T, S, until } = await open(390, 844);
      // finger A rests on the light, finger B taps the light: one toggle, A lifting is no tap, A's long press is cancelled
      await T('touchStart', [[100, 100, 2]]); await W(100);
      await T('touchStart', [[100, 100, 2], [300, 200, 1]]); await W(40); await T('touchEnd', [[300, 200, 1]]);
      ok(await until(() => document.getElementById('panel').classList.contains('off')), 'a second finger tapping the light toggles the panel');
      await W(1200);
      ok(!(await S()).dlg, 'the resting finger does not turn into a long press');
      await T('touchEnd', [[100, 100, 2]]); await W(350);
      ok((await S()).off, 'the resting finger lifting is not counted as a tap');
      // a light tap followed by a detail-0 click on the light does not toggle twice
      await p.evaluate(() => __light.setPanel(true)); await W(50);
      await T('touchStart', [[195, 150]]); await W(40); await T('touchEnd', []);
      await until(() => document.getElementById('panel').classList.contains('off'));
      await p.evaluate(() => document.getElementById('light').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      await W(400); ok((await S()).off, 'light tap + detail-0 click: panel toggled once');
      await ctx.close();
    }
    // ---------- 4 / 5 / 7. short screens: panel content reachable, new setting scrolled into view; hint; chip width ----------
    for (const [w, h] of [[360, 640], [320, 568], [844, 390]]) {
      const { ctx, p, tap, until } = await open(w, h);
      const geo = () => p.evaluate(() => { const sc = document.getElementById('pscroll').getBoundingClientRect(), r = q => document.querySelector(q).getBoundingClientRect();
        return { vb: sc.bottom, vt: sc.top, seg: r('.seg').bottom, chips: r('.chips').bottom, sos: r('#sos-ctl').bottom, strobe: r('#strobe-ctl').bottom, cue: !document.getElementById('more').hidden,
          chipW: Math.min(...[...document.querySelectorAll('.chip')].map(c => c.getBoundingClientRect().width)), hint: (() => { const e = document.getElementById('gesture-hint'), b = e.getBoundingClientRect(); return b.height > 0 && b.bottom <= sc.bottom ? e.textContent : ''; })() }; });
      let g = await geo();
      ok(g.seg <= g.vb + 0.5 || g.cue, `${w}x${h}: 恆亮/閃爍/SOS/呼吸 row is in view (or a scroll cue shows) — seg ${Math.round(g.seg)} / view ${Math.round(g.vb)}`);
      if (w < 640) ok(g.seg <= g.vb + 0.5 && g.chips <= g.vb + 0.5, `${w}x${h}: presets and mode row fully visible without scrolling`);
      ok(/上下滑/.test(g.hint) && /雙擊/.test(g.hint) && /長按/.test(g.hint), `${w}x${h}: visible gesture hint (${g.hint})`);
      ok(g.chipW >= 44, `${w}x${h}: preset chips at least 44 px wide (${g.chipW.toFixed(1)})`);
      await tap('#m-sos'); await until(() => !document.getElementById('warn-dlg').hidden); await W(80);
      await tap('#warn-ack'); await until(() => document.getElementById('warn-ack').checked);
      await tap('#warn-ok'); await until(() => __light.st.mode === 'sos'); await W(100);
      g = await geo(); ok(g.sos <= g.vb + 0.5 && g.sos > g.vt, `${w}x${h}: SOS setting scrolled into view (${Math.round(g.sos)} ≤ ${Math.round(g.vb)})`);
      await p.evaluate(() => { document.getElementById('pscroll').scrollTop = 0; }); await W(50);
      await tap('#m-strobe'); await until(() => __light.st.mode === 'strobe'); await W(100);
      g = await geo(); ok(g.strobe <= g.vb + 0.5 && g.strobe > g.vt, `${w}x${h}: strobe setting scrolled into view`);
      await ctx.close();
    }
    { // a short in-lobby size where the row does not fit shows the cue until scrolled
      const { ctx, p, until } = await open(375, 500);
      const g = await p.evaluate(() => { const sc = document.getElementById('pscroll'); return { over: sc.scrollHeight - sc.clientHeight, cue: !document.getElementById('more').hidden }; });
      ok(g.over <= 16 || g.cue, `375x500: scroll cue shown while settings sit below (${g.over} px)`);
      await p.evaluate(() => { const sc = document.getElementById('pscroll'); sc.scrollTop = sc.scrollHeight; });
      ok(await until(() => document.getElementById('more').hidden), '375x500: cue hides once scrolled to the end');
      await ctx.close();
    }
    // ---------- 6. stored brightness outside 0.05–1 falls back to 100%; existing key still loads ----------
    for (const [b, want] of [[-5, 1], [-0.1, 1], [0.01, 1], [7, 1], [0.4, 0.4], [0.05, 0.05]]) {
      const { ctx, p } = await open(390, 844, JSON.stringify({ kelvin: 3000, brightness: b, preset: 'warm', mode: 'breath', strobeHz: 2, unitMs: 250, custom: '#123abc' }));
      const s = await p.evaluate(() => ({ ...__light.st, out: document.getElementById('bright-out').textContent }));
      ok(s.brightness === want && s.out === Math.round(want * 100) + '%', `stored brightness ${b} -> ${want * 100}%`);
      if (b === 0.4) ok(s.kelvin === 3000 && s.preset === 'warm' && s.mode === 'breath' && s.unitMs === 250 && s.custom === '#123abc', 'existing settings key loads unchanged');
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
