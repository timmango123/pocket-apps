// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (SRC.includes('�')) throw new Error('source contains U+FFFD');

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await sleep(250);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[1] === opts.viewport.width, `innerWidth ${w[1]} == ${opts.viewport.width}`);
    assert(w[0] <= w[1], `no horizontal scroll at ${opts.viewport.width} (${w})`);
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
      assert(await page.locator('#freq-display').textContent() === '1,000', 'opens at 1,000 Hz');
      assert(await page.locator('#note').textContent() === 'B5 +21 cents', '1000 Hz -> B5 +21 cents');
      const ends = await page.evaluate(() => [__tone.sliderToF(0), __tone.sliderToF(1000), __tone.noteOf(440), __tone.noteOf(261.63)]);
      assert(Math.abs(ends[0] - 20) < 1e-9 && Math.abs(ends[1] - 20000) < 1e-6, `log slider ends ${ends[0]} / ${ends[1]}`);
      assert(ends[2] === 'A4 ±0 cents' && ends[3] === 'C4 ±0 cents', `note names ${ends[2]}, ${ends[3]}`);
      assert(await page.locator('#vol-val').textContent() === '30%', 'volume starts at 30%');

      const small = await page.evaluate(() => [...document.querySelectorAll('button, input, summary')].filter(e => e.offsetParent && e.type !== 'checkbox' && e.id !== 'freq-display').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'touch targets >= 44px ' + JSON.stringify(small));
      await page.screenshot({ path: OUT + '/390x844.png', fullPage: false });

      // type 99999 -> clamp + toast
      await page.locator('#freq-display').click();
      await page.locator('#freq-input').fill('99999');
      await page.locator('#freq-input').press('Enter');
      let f = await page.evaluate(() => __tone.state.freq);
      assert(f === 22000, 'input 99999 clamped to 22000 (' + f + ')');
      assert(/頻率範圍/.test(await page.locator('#toast').textContent()), 'clamp toast shown');
      await page.locator('#freq-display').click();
      await page.locator('#freq-input').fill('abc');
      await page.locator('#freq-input').press('Enter');
      assert(await page.evaluate(() => __tone.state.freq) === 22000, 'non-number restores previous value');
      await page.locator('#freq-display').click();
      await page.locator('#freq-input').fill('440');
      await page.locator('#freq-input').press('Enter');
      assert(await page.locator('#note').textContent() === 'A4 ±0 cents', 'typed 440 -> A4');
      await page.locator('#oct-up').click();
      assert(await page.evaluate(() => __tone.state.freq) === 880, 'x2 -> 880');
      await page.locator('#oct-down').click(); await page.locator('#plus1').click(); await page.locator('#minus1').click();
      assert(await page.evaluate(() => __tone.state.freq) === 440, 'x1/2, +1, -1 -> 440');

      // first play shows the reminder dialog
      await page.locator('#play').click();
      assert(await page.locator('#dlg-first').isVisible(), 'first-play reminder dialog');
      await page.locator('#dlg-first-ok').click();
      await sleep(60);
      let g = await page.evaluate(() => [__tone.ctx.state, __tone.volGain.gain.value, __tone.osc.frequency.value]);
      assert(g[0] === 'running' && g[2] === 440, 'AudioContext running, osc at 440');
      assert(g[1] < 0.045 * 0.5, `gain fading in (${g[1].toFixed(4)} at ~60ms)`);
      await sleep(500);
      g = await page.evaluate(() => __tone.volGain.gain.value);
      assert(Math.abs(g - 0.045) < 1e-3, `gain reaches 30% target 0.045 (${g.toFixed(4)})`);
      // measure output frequency from analyser via interpolated zero crossings
      const est = await page.evaluate(() => {
        const a = __tone.analyser, b = new Float32Array(a.fftSize); a.getFloatTimeDomainData(b);
        const xs = []; for (let i = 1; i < b.length; i++) if (b[i - 1] < 0 && b[i] >= 0) xs.push(i - 1 + (-b[i - 1]) / (b[i] - b[i - 1]));
        return (xs.length - 1) / ((xs[xs.length - 1] - xs[0]) / __tone.ctx.sampleRate);
      });
      assert(Math.abs(est - 440) < 1, `measured output ${est.toFixed(2)} Hz (error < 1 Hz)`);
      await page.screenshot({ path: OUT + '/390x844-playing.png' });

      // volume cap
      await page.locator('#volume').evaluate(el => { el.value = 95; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert(await page.evaluate(() => __tone.state.volume) === 70, 'volume capped at 70% without unlock');
      await page.locator('#unlock').check();
      await page.locator('#volume').evaluate(el => { el.value = 90; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert(await page.evaluate(() => __tone.state.volume) === 90 && await page.locator('#vol-warn').isVisible(), 'unlocked to 90% shows yellow warning');
      await sleep(400);
      g = await page.evaluate(() => __tone.volGain.gain.value);
      assert(g <= 0.5 && Math.abs(g - 0.405) < 0.01, `gain at 90% = ${g.toFixed(3)} (ceiling 0.5)`);
      await page.locator('#unlock').uncheck();
      assert(await page.evaluate(() => __tone.state.volume) === 70, 're-locking drops to 70%');

      // channel
      await page.locator('#ch-left').click(); await sleep(200);
      assert(await page.evaluate(() => __tone.panner.pan.value) < -0.99, 'left channel -> pan -1');
      await page.locator('#ch-both').click();

      // stop with fade
      await page.locator('#play').click(); await sleep(80);
      assert(await page.evaluate(() => !__tone.playing && __tone.volGain.gain.value < 1e-4), 'stop fades to 0');

      // sweep: 100 -> 1000 linear 5 s
      await page.locator('#sweep-panel summary').click();
      await page.locator('#sw-from').fill('100'); await page.locator('#sw-to').fill('1000'); await page.locator('#sw-sec').fill('5');
      await page.locator('#sw-lin').click();
      await page.locator('#sw-start').click();
      await sleep(2500);
      let sw = await page.evaluate(() => [__tone.osc.frequency.value, __tone.state.freq, (__tone.ctx.currentTime - __tone.sweep.t0)]);
      const expect = 100 + 900 * sw[2] / 5;
      assert(Math.abs(sw[0] - expect) < 15 && Math.abs(sw[1] - expect) < 40, `linear sweep mid: osc ${sw[0].toFixed(0)} Hz, display ${sw[1]}, expected ~${expect.toFixed(0)}`);
      await page.screenshot({ path: OUT + '/390x844-sweep.png' });
      await page.locator('#sw-log').click();
      await page.locator('#sw-start').click(); // stop sweep
      await page.locator('#play').click();     // stop sound
      await page.locator('#sw-sec').fill('300'); await page.locator('#sw-sec').blur();
      assert(await page.locator('#sw-sec').inputValue() === '120', 'sweep seconds clamped to 120');
      await page.locator('#sweep-panel summary').click();

      // hearing test: press after ~3.2 s (level 2 = 9000 Hz) -> record 8500
      await page.locator('#ht-panel summary').click();
      await page.locator('#ht-start').click();
      await sleep(3200);
      assert(await page.evaluate(() => __tone.state.freq) === 9000, 'hearing test at 9000 Hz after 3 s');
      await page.locator('#ht-go').click();
      assert((await page.locator('#ht-val').textContent()).replace(/\s/g, '') === '8,500Hz', 'records previous step 8,500 Hz');
      assert(await page.locator('#ht-ref tr.me td').first().textContent() === '60 歲', 'closest age reference highlighted');
      await page.locator('#ht-result').scrollIntoViewIfNeeded();
      await page.screenshot({ path: OUT + '/390x844-hearing.png' });

      // persistence (volume not stored)
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tone-gen:v1:settings')));
      assert(saved.volume === 0.3 && saved.sweep.mode === 'log', 'settings saved, volume stored as 0.3');
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 360, height: 780 }, ...mobile });
      await page.screenshot({ path: OUT + '/360x780.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 844, height: 390 }, ...mobile });
      await page.screenshot({ path: OUT + '/844x390.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' });
      await page.screenshot({ path: OUT + '/390x844-dark.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 1280, height: 800 } });
      await page.keyboard.press('ArrowRight');
      assert(await page.evaluate(() => __tone.state.freq) === 1010, 'ArrowRight at 1000 -> 1010');
      await page.keyboard.press('Space');
      assert(await page.locator('#dlg-first').isVisible(), 'Space triggers play (reminder first)');
      await page.locator('#dlg-first-cancel').click();
      await page.screenshot({ path: OUT + '/desktop.png' }); await ctx.close();
    }
    assert(errors.length === 0, 'no console/page errors ' + JSON.stringify(errors));
  } finally {
    await browser.close();
    fs.unlinkSync(WRAP);
  }
})().catch(e => { console.error(e); process.exit(1); });
