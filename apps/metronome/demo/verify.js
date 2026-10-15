// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// The artifact host wraps the page in a document skeleton (doctype + viewport meta); mimic that for file:// testing.
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const intervals = (log) => { const out = []; for (let i = 1; i < log.length; i++) out.push(log[i].time - log[i - 1].time); return out; };

  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.goto(URL); await sleep(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `no horizontal scroll 390 (${sw})`);
    assert(await page.locator('#bpm').textContent() === '96', 'opens with default 96 BPM');
    assert(await page.locator('#term').textContent() === 'Andante行板', 'tempo term for 96 = Andante');

    // touch target sizes
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input, [role=slider]')].filter(e => e.offsetParent && !e.classList.contains('switch')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
    assert(small.length === 0, 'all controls >= 44px (' + JSON.stringify(small) + ')');

    // play at 96 BPM: intervals exactly 60/96
    await page.locator('#play').click();
    await sleep(3300);
    let st = await page.evaluate(() => ({ worker: __metro.worker, state: __metro.ctx.state, log: __metro.scheduled.slice() }));
    assert(st.state === 'running', 'AudioContext running after click');
    assert(st.worker, 'lookahead ticks come from an inline Web Worker');
    let iv = intervals(st.log);
    assert(st.log.length >= 3 && iv.every(d => Math.abs(d - 0.625) < 1e-6), `96 BPM: ${st.log.length} notes, all intervals 0.625 s`);
    assert(st.log[0].kind === 'a' && st.log[1].kind === 'n' && st.log[4].kind === 'a', 'beat 1 accented, beat 2 normal, next bar accented');
    const lag = await page.evaluate(() => { const c = __metro.ctx.currentTime; const last = __metro.scheduled[__metro.scheduled.length - 1].time; return [last - c, last + 0.625 - c]; });
    assert(lag[0] <= 0.1 + 1e-3 && lag[1] > 0.1 - 0.05, `scheduler keeps a ~100 ms horizon (last scheduled ${lag[0].toFixed(3)} s, next due ${lag[1].toFixed(3)} s from now)`);
    await page.screenshot({ path: OUT + '/390x844.png' });

    // tempo change 60 -> 180 takes effect on the next note without restart
    await page.evaluate(() => __metro.setBpm(60));
    await sleep(1500);
    const n0 = await page.evaluate(() => __metro.scheduled.length);
    const before = await page.evaluate(() => __metro.scheduled[__metro.scheduled.length - 1]);
    await page.evaluate(() => __metro.setBpm(180));
    await sleep(1200);
    const after = await page.evaluate(n => __metro.scheduled.slice(n - 1), n0);
    const iv2 = intervals(after);
    assert(iv2[0] >= 1 / 3 - 0.01 && iv2[0] <= 1.0 && iv2.slice(1).every(d => Math.abs(d - 1 / 3) < 1e-6), `60→180: first new note after ${iv2[0].toFixed(3)} s (no later than the old 1.0 s beat; immediately if already overdue), then every 0.333 s`);
    assert(after[1].beat === (before.beat + 1) % 4, 'bar continues (beat index not reset)');

    // 300 BPM sixteenths: 50 ms grid, no gaps
    await page.locator('#sub4').click();
    await page.evaluate(() => __metro.setBpm(300));
    await sleep(300);
    const n1 = await page.evaluate(() => __metro.scheduled.length);
    await sleep(1500);
    const fast = await page.evaluate(n => __metro.scheduled.slice(n), n1);
    const iv3 = intervals(fast);
    assert(fast.length >= 28 && iv3.every(d => Math.abs(d - 0.05) < 1e-6), `300 BPM 16ths: ${fast.length} notes in 1.5 s, all 50 ms apart`);
    assert(fast.filter(n => n.kind === 's').length / fast.length > 0.7, 'subdivision notes scheduled (3 of 4 are sub)');
    await page.screenshot({ path: OUT + '/390x844-playing-16th.png' });
    await page.locator('#play').click();
    await page.locator('#sub1').click();

    // tap tempo
    const tapB = await page.evaluate(() => { let b; for (let i = 0; i < 6; i++) b = __metro.tapAt(10000 + i * 600); return b; });
    assert(tapB === 100, 'tapAt 6×600 ms → 100 BPM');
    const tapJ = await page.evaluate(() => { let b; const t = [0, 590, 1205, 1800, 2410, 3000]; for (const x of t) b = __metro.tapAt(50000 + x); return b; });
    assert(tapJ >= 98 && tapJ <= 102, 'jittery taps (590–615 ms) → ' + tapJ);
    await sleep(2100);
    // dispatch real pointerdown events in-page every 600 ms (Playwright click overhead would skew timing)
    await page.evaluate(() => new Promise(res => { let i = 0; const el = document.getElementById('tap'); const f = () => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); if (++i < 6) setTimeout(f, 600); else res(); }; f(); }));
    const real = +(await page.locator('#bpm').textContent());
    assert(real >= 96 && real <= 102, 'six pointerdown events ~600 ms apart → ' + real + ' BPM');
    const reset = await page.evaluate(() => __metro.tapAt(999999));
    assert(reset === null, 'gap > 2 s restarts tap sequence');

    // knob rotation: clockwise quarter turn = +6 BPM
    await page.evaluate(() => __metro.setBpm(120));
    const kb = await page.locator('#knob').boundingBox();
    const cx = kb.x + kb.width / 2, cy = kb.y + kb.height / 2, R = kb.width * 0.42;
    await page.mouse.move(cx, cy - R); await page.mouse.down();
    for (let a = 0; a <= 90; a += 5) { const r = a * Math.PI / 180; await page.mouse.move(cx + R * Math.sin(r), cy - R * Math.cos(r)); }
    await page.mouse.up();
    const kv = await page.locator('#bpm').textContent(); assert(kv === '126', 'knob +90° → 120+6 = 126 (got ' + kv + ')');

    // ±buttons and clamping
    await page.locator('#plus5').click(); await page.locator('#minus1').click();
    assert(await page.locator('#bpm').textContent() === '130', '+5 −1 → 130');
    await page.locator('#bpm').click();
    await page.fill('#bpmInput', '500'); await page.press('#bpmInput', 'Enter');
    assert(await page.locator('#bpm').textContent() === '300', 'typed 500 clamps to 300');
    assert((await page.locator('#term').textContent()).startsWith('Presto'), 'term Presto at 300');

    // accent cycle
    const d1 = page.locator('#beat-2');
    await d1.click(); assert(await d1.getAttribute('data-lv') === '0', 'beat 2: normal → mute');
    await d1.click(); assert(await d1.getAttribute('data-lv') === '2', 'beat 2: mute → accent');
    await d1.click(); assert(await d1.getAttribute('data-lv') === '1', 'beat 2: accent → normal');

    // time signature
    await page.selectOption('#sigNum', '7');
    assert(await page.locator('#beats .dot').count() === 7, '7/x shows 7 dots');

    // ramp: 1/4, 200 → 210, +5 every bar  (bar = 0.3 s)
    await page.selectOption('#sigNum', '1');
    await page.locator('#rampPanel summary').click();
    await page.fill('#rampFrom', '200'); await page.fill('#rampTo', '210'); await page.fill('#rampEvery', '1'); await page.fill('#rampStep', '5');
    await page.locator('#rampStep').blur();
    await page.locator('#rampOn').check();
    const nr = await page.evaluate(() => __metro.scheduled.length);
    await page.locator('#play').click();
    await sleep(1600);
    const rb = await page.evaluate(() => __metro.S.bpm);
    const rs = await page.locator('#rampStatus').textContent();
    assert(rb === 210 && rs.includes('已到達目標'), `ramp 200→210 reached (${rb}, “${rs}”)`);
    const rl = await page.evaluate(n => __metro.scheduled.slice(n).map(x => x.bpm), nr);
    assert(rl[0] === 200 && rl.includes(205), 'ramp stepped ' + [...new Set(rl)].join(' → '));
    await page.locator('#play').click();
    await page.locator('#rampOn').uncheck();

    // decelerate
    await page.fill('#rampFrom', '120'); await page.fill('#rampTo', '110'); await page.locator('#rampTo').blur();
    await page.locator('#rampOn').check();
    await page.locator('#play').click(); await sleep(1500);
    assert(await page.evaluate(() => __metro.S.bpm) === 110, 'ramp down 120 → 110 (漸慢)');
    await page.locator('#play').click(); await page.locator('#rampOn').uncheck();

    // presets: load example, save new, reload persists
    await page.locator('#presetBtn').click();
    await page.locator('#preset-1').click();
    assert(await page.locator('#bpm').textContent() === '90' && await page.locator('#beats .dot').count() === 3, 'load 範例：華爾滋 3/4 → 90 BPM, 3 dots');
    await page.locator('#presetBtn').click();
    await page.fill('#presetName', '測試組合');
    await page.locator('#presetSave').click();
    assert(await page.locator('#presetList li').count() === 4, 'saved 4th preset');
    await page.locator('#presetClose').click();
    await sleep(300);
    await page.reload(); await sleep(200);
    assert(await page.locator('#bpm').textContent() === '90', 'state persists after reload');
    assert(await page.evaluate(() => __metro.S.presets.length) === 4, 'presets persist after reload');

    // keyboard
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Shift+ArrowUp');
    assert(await page.locator('#bpm').textContent() === '96', 'keyboard ↑ +1, Shift+↑ +5 → 96');
    await page.keyboard.press('Space'); await sleep(400);
    assert(await page.evaluate(() => __metro.playing), 'space starts playback');
    await page.keyboard.press('Space');
    assert(!(await page.evaluate(() => __metro.playing)), 'space stops playback');
    await ctx.close();
  }

  for (const [w, h, name, extra, scheme] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, 'desktop', {}], [390, 844, '390x844-dark', mobile, 'dark'], [375, 667, '375x667', mobile]]) {
    const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...extra, colorScheme: scheme || 'light' });
    await page.goto(URL); await sleep(150);
    await page.locator('#sub2').click();
    await page.locator('#play').click(); await sleep(900);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `no horizontal scroll ${name} (${sw})`);
    if (name === '375x667') {
      const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input, [role=slider]')].filter(e => e.offsetParent && !e.classList.contains('switch')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, '375×667: all controls >= 44px');
    }
    if (name === 'desktop') { await page.locator('#rampPanel summary').click(); }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844-dark') { await page.locator('#presetBtn').click(); await page.screenshot({ path: `${OUT}/390x844-dark-presets.png` }); }
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  if (errors.length) { console.error('ERRORS:', errors); process.exit(1); }
  console.log('ALL PASSED, no console errors');
})().catch(e => { console.error(e); process.exit(1); });
