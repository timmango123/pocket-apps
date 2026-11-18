// 頻率產生器：上架重審 r1 的回歸測試（node tests.js，約 60 秒）。
// 觸控（放開時觸發、另一指放著、兩指重疊、detail 0 重播）、數字拖曳、頻率精度、輸入解析、
// 未離開欄位就重整不遺失、橫式播放鍵可見、掃頻欄位提示與存檔夾限、說明換行、深色待機示波器。
// 頁面用本機 http 伺服器載入（重整要靠 localStorage）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const W = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  async function open(w, h, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: opt.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(w + 'x' + h + ' ' + e.message));
    await p.addInitScript((seed) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('tone-gen:v1:warned', '1');
      if (seed) localStorage.setItem('tone-gen:v1:settings', seed);
    }, opt.seed || null);
    await p.goto(URL);
    await p.waitForFunction(() => window.__tone);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const box = s => p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, s);
    const center = async s => { await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), s); const b = await box(s); return [b.x + b.w / 2, b.y + b.h / 2]; };
    const tap = async (s, hold = 40) => { const c = await center(s); await T('touchStart', [c]); await W(hold); await T('touchEnd', [c]); await W(30); };
    const st = () => p.evaluate(() => ({ f: __tone.state.freq, play: __tone.playing, type: __tone.state.type }));
    const setF = async v => { await W(850); await p.evaluate(v => { const i = document.getElementById('freq-input'); document.getElementById('freq-display').click(); i.value = String(v); i.blur(); }, v); await W(900); };
    const toast = () => p.evaluate(() => document.getElementById('toast').textContent);
    return { ctx, p, T, box, center, tap, st, setF, toast };
  }

  // ---------- 1. touch: release-to-act, resting finger, overlap, detail-0 replay ----------
  {
    const o = await open(390, 844); const { p, T, tap, st, center } = o;
    let b = await st();
    for (const h of [40, 600, 1000]) await tap('#plus1', h);
    eq((await st()).f - b.f, 3, 'single tap and 0.6 s / 1 s holds each add 1 Hz once');
    // a finger resting at (200,20) while tapping +1 five times
    await o.setF(1000);
    const c = await center('#plus1');
    await T('touchStart', [[200, 20, 2]]); await W(150);
    for (let i = 0; i < 5; i++) { await T('touchStart', [[200, 20, 2], [c[0], c[1], 1]]); await W(50); await T('touchEnd', [[c[0], c[1], 1]]); await W(60); }
    const cp = await center('#play');
    await T('touchStart', [[200, 20, 2], [cp[0], cp[1], 1]]); await W(50); await T('touchEnd', [[cp[0], cp[1], 1]]); await W(60);
    const cw = await center('#wave-square');
    await T('touchStart', [[200, 20, 2], [cw[0], cw[1], 1]]); await W(50); await T('touchEnd', [[cw[0], cw[1], 1]]); await W(60);
    await T('touchEnd', [[200, 20, 2]]);
    let a = await st();
    eq(a.f, 1005, 'resting finger: 5 taps on +1 register 5');
    eq(a.play, true, 'resting finger: Play starts');
    eq(a.type, 'square', 'resting finger: waveform button acts');
    await W(900); await p.evaluate(() => document.getElementById('play').click()); await W(100);
    eq((await st()).play, false, 'lone detail-0 click (keyboard/AT) stops playback once');
    // two overlapping fingers on +1 and ×½, both lift orders
    for (const first of [1, 2]) {
      await o.setF(1000);
      const A = await center('#plus1'), B = await center('#oct-down');
      await T('touchStart', [[A[0], A[1], 1]]); await W(50); await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await W(60);
      if (first === 1) { await T('touchEnd', [[A[0], A[1], 1]]); await W(30); await T('touchEnd', [[B[0], B[1], 2]]); }
      else { await T('touchEnd', [[B[0], B[1], 2]]); await W(30); await T('touchEnd', [[A[0], A[1], 1]]); }
      await W(60);
      eq((await st()).f, first === 1 ? 500.5 : 501, 'overlapping +1 and ×½ both act (lift ' + (first === 1 ? '+1' : '×½') + ' first)');
    }
    // detail-0 replay after a real tap: on the button, its edge point, and elementFromPoint
    const replay = (s) => p.evaluate((s) => {
      const el = document.querySelector(s), r = el.getBoundingClientRect();
      const ev = (t, x, y) => t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
      ev(el, r.left + r.width / 2, r.top + r.height / 2);
      ev(el, r.left + 1, r.top + 1);
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (t) ev(t, r.left + r.width / 2, r.top + r.height / 2);
    }, s);
    await o.setF(1000);
    await tap('#plus1'); await replay('#plus1'); await W(100);
    eq((await st()).f, 1001, 'tap +1 then detail-0 clicks: +1 only');
    await tap('#oct-up'); await replay('#oct-up'); await W(100);
    eq((await st()).f, 2002, 'tap ×2 then detail-0 clicks: doubles once');
    await tap('#play'); await replay('#play'); await W(100);
    eq((await st()).play, true, 'tap Play then detail-0 clicks: starts once (not toggled back)');
    await tap('#play'); await W(100);
    eq((await st()).play, false, 'tap Play again stops');
    // a tap that opens a dialog must not press the dialog button under the finger
    await tap('#safety-btn'); await W(100);
    assert(await p.evaluate(() => !document.getElementById('dlg-safety').hidden), 'safety dialog opens on tap');
    await tap('#dlg-safety-ok'); await W(100);
    assert(await p.evaluate(() => document.getElementById('dlg-safety').hidden), 'dialog closes on tap of 知道了');
    // keyboard activation still works
    await W(900);
    await p.focus('#plus1'); const k0 = (await st()).f; await p.keyboard.press('Enter'); await W(50);
    eq((await st()).f - k0, 1, 'Enter on +1 acts once');
    // tapping the number opens the input
    await tap('#freq-display'); await W(100);
    assert(await p.evaluate(() => document.activeElement === document.getElementById('freq-input')), 'tap on the number opens the frequency box');
    await p.evaluate(() => document.getElementById('freq-input').blur()); await W(900);

    // ---------- 2. vertical drag on the number ----------
    await o.setF(1000);
    await p.evaluate(() => { document.body.style.paddingBottom = '1200px'; document.getElementById('freq-display').scrollIntoView({ block: 'center' }); });
    await p.evaluate(() => scrollBy(0, 60)); await W(100);
    const sy = await p.evaluate(() => scrollY);
    const d = await o.box('#freq-display'); const x = d.x + d.w / 2; let y = d.y + d.h / 2;
    await T('touchStart', [[x, y]]);
    for (let i = 0; i < 10; i++) { y -= 8; await T('touchMove', [[x, y]]); await W(16); }
    await T('touchEnd', [[x, y]]); await W(100);
    eq((await st()).f, 1100, '80 px upward drag on the number adds 10 steps of 10 Hz');
    eq(await p.evaluate(() => scrollY), sy, 'drag on the number does not scroll the page');
    assert(await p.evaluate(() => document.getElementById('freq-input').hidden), 'a drag does not open the input box');
    eq(await p.evaluate(() => getComputedStyle(document.getElementById('freq-display')).display), 'inline-block', '#freq-display is inline-block so touch-action applies');
    await p.evaluate(() => { document.body.style.paddingBottom = ''; });
    await W(900);

    // ---------- 3. sub-Hz precision ----------
    await o.setF(441); await p.evaluate(() => document.getElementById('oct-down').click()); await W(50);
    eq((await st()).f, 220.5, '441 ×½ = 220.5');
    await o.setF(1001); await p.evaluate(() => { document.getElementById('oct-down').click(); document.getElementById('oct-up').click(); }); await W(50);
    eq((await st()).f, 1001, '1001 ×½ ×2 = 1001');
    await o.setF(261.63);
    eq((await st()).f, 261.63, '261.63 kept');
    eq(await p.textContent('#freq-display'), '261.63', '261.63 shown');
    eq(await p.textContent('#note'), 'C4 ±0 cents', '261.63 is C4');
    await o.setF(99.5); await p.evaluate(() => document.getElementById('plus1').click()); await W(50);
    eq((await st()).f, 100.5, '99.5 +1 = 100.5');
    await o.setF(99.999);
    eq(await p.textContent('#freq-display'), '100', '99.999 Hz shows as 100, not 100.00');
    await o.setF(99.95);
    eq(await p.textContent('#freq-display'), '99.95', '99.95 Hz shows as 99.95');
    await o.setF(1000);
    eq(await p.textContent('#freq-display'), '1,000', 'whole numbers still shown as 1,000');

    // ---------- 4. parsing ----------
    await o.setF('1.2.3');
    eq((await st()).f, 1000, "'1.2.3' rejected");
    await o.setF('-5');
    assert(/1–22,000/.test(await o.toast()), "'-5' message states the 1–22,000 range: " + await o.toast());
    await o.setF('１０００．５');
    eq((await st()).f, 1000.5, 'full-width １０００．５ accepted');
    await o.setF('2,500');
    eq((await st()).f, 2500, '2,500 with a thousands comma accepted');

    // ---------- 7a. sweep field message ----------
    await p.evaluate(() => { document.getElementById('sweep-panel').open = true; });
    await p.fill('#sw-from', 'abc'); await p.evaluate(() => document.getElementById('sw-from').blur()); await W(50);
    assert(/起始頻率/.test(await o.toast()), 'non-number in a sweep field shows a message');
    eq(await p.inputValue('#sw-from'), '100', 'and reverts to the previous value');

    // ---------- 5. typed values survive a reload before blur ----------
    await p.click('#freq-display'); await W(100);
    await p.keyboard.type('1234');
    eq(JSON.parse(await p.evaluate(() => localStorage.getItem('tone-gen:v1:settings'))).freq, 1234, 'typed frequency saved on input');
    await p.reload(); await p.waitForFunction(() => window.__tone);
    eq((await st()).f, 1234, 'frequency typed but not committed survives a reload');
    await p.evaluate(() => { document.getElementById('sweep-panel').open = true; });
    await p.fill('#sw-to', '5555');
    await p.reload(); await p.waitForFunction(() => window.__tone);
    eq(await p.inputValue('#sw-to'), '5555', 'sweep field typed but not committed survives a reload');
    await o.ctx.close();
  }

  // ---------- 6. landscape: Play fully visible ----------
  for (const [w, h] of [[844, 390], [740, 360], [667, 375]]) {
    const o = await open(w, h);
    const b = await o.box('#play');
    assert(b.y + b.h <= h && b.y >= 0, `${w}x${h}: Play button fully on the first screen (bottom ${Math.round(b.y + b.h)})`);
    await o.ctx.close();
  }

  // ---------- 7b. saved sweep values clamped on load; old keys still load ----------
  {
    const o = await open(390, 844, { seed: JSON.stringify({ freq: 523.25, type: 'triangle', volume: 0.3, channel: -1, sweep: { from: null, to: 99999, sec: 1, mode: 'lin' } }) });
    eq([await o.p.inputValue('#sw-from'), await o.p.inputValue('#sw-to'), await o.p.inputValue('#sw-sec')], ['100', '22000', '5'], 'bad saved sweep values: null ignored, others clamped');
    const s = await o.p.evaluate(() => ({ f: __tone.state.freq, t: __tone.state.type, c: __tone.state.channel, m: __tone.state.sweep.mode }));
    eq(s, { f: 523.25, t: 'triangle', c: -1, m: 'lin' }, 'existing settings key loads unchanged');
    await o.ctx.close();
  }

  // ---------- 7c. caption wrapping and dark idle trace ----------
  for (const w of [360, 390]) {
    const o = await open(w, 800);
    const n = await o.p.evaluate(() => { const s = document.querySelector('#tstate .nw'); return s ? s.getClientRects().length : 0; });
    eq(n, 1, `${w}: "聲音會在 0.3 秒內漸入" stays on one line (no lone 入)`);
    await o.ctx.close();
  }
  {
    const o = await open(390, 844, { dark: true });
    const a = await o.p.evaluate(() => +getComputedStyle(document.documentElement).getPropertyValue('--idle-a'));
    assert(a >= 0.8, 'dark mode idle scope trace alpha ' + a + ' >= 0.8');
    await o.ctx.close();
  }

  // ---------- r2. ghost click after collapsing a panel; label / checkbox / text box taps ----------
  for (const w of [360, 390, 430]) {
    const o = await open(w, w === 360 ? 640 : 844); const { p, T } = o;
    await p.evaluate(() => { window.__acts = []; ['input', 'change'].forEach(t => document.addEventListener(t, e => __acts.push(t + ':' + e.target.id), true)); });
    for (const sel of ['#ht-panel > summary', '#sweep-panel > summary']) for (const pos of ['start', 'center', 'end']) {
      await p.evaluate(() => { document.querySelector('#sweep-panel').open = true; document.querySelector('#ht-panel').open = true; document.querySelector('#ht-result').hidden = false; document.querySelector('#unlock').checked = false; __acts.length = 0; document.activeElement.blur(); });
      await p.evaluate(([s, pos]) => document.querySelector(s).scrollIntoView({ block: pos }), [sel, pos]); await W(80);
      const b0 = await o.st();
      const bx = await o.box(sel); const c = [bx.x + bx.w / 2, bx.y + bx.h / 2];
      await T('touchStart', [c]); await W(40); await T('touchEnd', [c]); await W(850);
      const r = await p.evaluate((s) => ({ open: document.querySelector(s).parentElement.open, unlock: document.querySelector('#unlock').checked, acts: __acts.join(','), ae: document.activeElement.tagName === 'INPUT' ? document.activeElement.id : '', ht: !!__tone.state && document.getElementById('ht-go').disabled }), sel);
      const b1 = await o.st();
      const ok = !r.open && !r.unlock && !r.acts && !r.ae && b1.f === b0.f && b1.play === b0.play && b1.type === b0.type && r.ht;
      assert(ok, `${w}: tap on ${sel.slice(1, 3)} header (${pos}) collapses it and nothing under the finger acts ${JSON.stringify(r)}`);
    }
    if (w === 390) {
      await p.evaluate(() => { document.querySelector('#sweep-panel').open = true; window.scrollTo(0, 0); }); await W(900);
      // tap on the label text toggles the unlock box once and lifts the cap
      await p.evaluate(() => document.querySelector('label[for=unlock]').scrollIntoView({ block: 'center' })); await W(80);
      const lb2 = await o.box('label[for=unlock]'); const lp = [lb2.x + lb2.w - 30, lb2.y + lb2.h / 2];
      await T('touchStart', [lp]); await W(40); await T('touchEnd', [lp]); await W(300);
      eq(await p.evaluate(() => [document.getElementById('unlock').checked, document.getElementById('cap-tag').textContent]), [true, '上限已解除'], 'tap on the unlock label ticks it once');
      await W(600);
      const cb = await o.box('#unlock'); const cc = [cb.x + cb.w / 2, cb.y + cb.h / 2];
      await T('touchStart', [cc]); await W(40); await T('touchEnd', [cc]); await W(300);
      eq(await p.evaluate(() => [document.getElementById('unlock').checked, document.getElementById('cap-tag').textContent]), [false, '上限 70%'], 'tap directly on the checkbox unticks it once');
      await W(600);
      await p.focus('#unlock'); await p.keyboard.press('Space'); await W(50);
      eq(await p.evaluate(() => document.getElementById('unlock').checked), true, 'Space on the checkbox still toggles it');
      await p.keyboard.press('Space'); await W(50);
      // a direct tap on a text box focuses it (from pointerdown default), even right after a button tap
      await o.tap('#plus1');
      const ib = await o.center('#sw-from');
      await T('touchStart', [ib]); await W(40); await T('touchEnd', [ib]); await W(200);
      eq(await p.evaluate(() => document.activeElement.id), 'sw-from', 'direct tap on a sweep field focuses it');
    }
    await o.ctx.close();
  }

  eq(errors, [], 'no page errors');
  await browser.close(); server.close();
  console.log(`tone-gen: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
