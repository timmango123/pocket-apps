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
  const browser = await chromium.launch();
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
  const bg = (page) => page.evaluate(() => document.getElementById('light').style.backgroundColor);
  try {
    {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
      // color temperature math
      const k = await page.evaluate(() => [2000, 6500, 10000].map(__light.kelvinToRGB));
      assert(JSON.stringify(k[0]) === '[255,137,14]', '2000 K -> warm orange ' + k[0]);
      assert(k[1][0] === 255 && k[1][1] >= 250 && k[1][2] >= 245, '6500 K -> near white ' + k[1]);
      assert(k[2][2] === 255 && k[2][0] < 210, '10000 K -> bluish ' + k[2]);
      assert(await bg(page) === 'rgb(255, 237, 222)', 'opens lit at 5500 K, 100%: ' + await bg(page));
      const ph = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().height / innerHeight);
      assert(ph <= 0.45 + 1e-3, `panel covers ${(ph * 100).toFixed(1)}% of screen (<= 45%)`);
      const small = await page.evaluate(() => [...document.querySelectorAll('#panel button, #panel input, #panel label.chip')].filter(e => e.offsetParent && e.type !== 'color').map(e => { const r = e.getBoundingClientRect(); return [e.id, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'controls >= 44px ' + JSON.stringify(small));
      await page.screenshot({ path: OUT + '/390x844.png' });

      // SOS timing
      const sos = await page.evaluate(() => ({ total: __light.SOS_TOTAL * __light.st.unitMs, on: [100, 300, 500, 900, 1100, 1700, 2900, 6700].map(t => __light.sosOn(t)) }));
      assert(sos.total === 6800, 'SOS cycle at 200 ms unit = 6.8 s');
      assert(JSON.stringify(sos.on) === '[1,0,1,1,0,1,1,0]', 'SOS schedule dot/gap/dash/gap pattern ' + sos.on);

      // presets and sliders
      await page.locator('#p-red').click();
      assert(await bg(page) === 'rgb(255, 0, 0)', 'red preset');
      await page.locator('#bright').evaluate(el => { el.value = 50; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert(await bg(page) === 'rgb(128, 0, 0)', 'brightness 50% scales RGB');
      await page.locator('#kelvin').evaluate(el => { el.value = 2000; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert(await bg(page) === 'rgb(128, 69, 7)', '2000 K at 50% (kelvin slider switches back from red)');
      await page.locator('#p-white').click();
      await page.locator('#bright').evaluate(el => { el.value = 100; el.dispatchEvent(new Event('input', { bubbles: true })); });

      // strobe requires warning confirmation
      await page.locator('#m-strobe').click();
      assert(await page.locator('#warn-dlg').isVisible(), 'photosensitivity warning before strobe');
      assert(await page.evaluate(() => __light.st.mode) === 'steady', 'mode unchanged until confirmed');
      assert(await page.locator('#warn-ok').isDisabled(), 'start disabled until acknowledged');
      await page.screenshot({ path: OUT + '/390x844-warning.png' });
      await page.locator('#warn-ack').check();
      await page.locator('#warn-ok').click();
      assert(await page.evaluate(() => __light.st.mode) === 'strobe', 'strobe starts after confirmation');
      assert(await page.evaluate(() => document.getElementById('strobe-hz').max) === '3', 'strobe slider max 3 Hz');
      await page.locator('#strobe-hz').evaluate(el => { el.value = 10; el.dispatchEvent(new Event('input', { bubbles: true })); });
      assert(await page.evaluate(() => __light.st.strobeHz) <= 3, 'strobe cannot exceed 3 Hz');
      // sample real flashes for 2 s at 3 Hz
      const flashes = await page.evaluate(() => new Promise(res => { let n = 0, prev = null; const t0 = performance.now(); const f = () => { const c = document.getElementById('light').style.backgroundColor; const on = c !== 'rgb(0, 0, 0)'; if (prev === false && on) n++; prev = on; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); }));
      assert(flashes >= 5 && flashes <= 6, `measured ${flashes} flashes in 2 s at 3 Hz`);
      // SOS: no second warning in the same session
      await page.locator('#m-sos').click();
      assert(!(await page.locator('#warn-dlg').isVisible()) && await page.evaluate(() => __light.st.mode) === 'sos', 'SOS starts (already acknowledged)');
      await page.screenshot({ path: OUT + '/390x844-sos.png' });
      await page.locator('#m-breath').click(); await sleep(300);
      await page.locator('#m-steady').click();

      // tap the light: panel hides, nothing else visible
      await page.touchscreen.tap(195, 150); await sleep(400);
      const vis = await page.evaluate(() => [...document.body.querySelectorAll('*')].filter(e => { if (e.id === 'light' || ['SCRIPT', 'STYLE', 'TITLE', 'META'].includes(e.tagName)) return false; const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.01 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }).map(e => e.id || e.tagName));
      assert(vis.length === 0, 'panel hidden -> no UI elements visible ' + JSON.stringify(vis));
      await page.screenshot({ path: OUT + '/390x844-panel-off.png' });

      // vertical swipe changes brightness, horizontal changes kelvin
      const swipe = async (x0, y0, x1, y1) => {
        const cdp = await ctx.newCDPSession(page);
        const pt = (x, y) => [{ x, y, id: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
        for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + (x1 - x0) * i / 10, y0 + (y1 - y0) * i / 10) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      await swipe(195, 600, 195, 400); // up 200px from 100% -> stays 100% (cap)
      await swipe(195, 300, 195, 550); // down 250px -> lower
      const b = await page.evaluate(() => __light.st.brightness);
      assert(b < 0.6 && b > 0.4, 'swipe down lowers brightness to ' + b.toFixed(2));
      await swipe(100, 400, 300, 400);
      const kk = await page.evaluate(() => __light.st.kelvin);
      assert(kk > 6500 + 3000, 'swipe right raises kelvin to ' + kk);
      assert(await page.evaluate(() => document.getElementById('panel').classList.contains('off')), 'swipes do not toggle the panel');
      await page.touchscreen.tap(195, 150); await sleep(300);
      assert(!(await page.evaluate(() => document.getElementById('panel').classList.contains('off'))), 'tap shows panel again');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('screen-light:v1:settings')));
      assert(saved && saved.kelvin === kk, 'settings persisted');
      const meta = await page.evaluate(() => document.querySelector('meta[name=theme-color]').content);
      assert(meta === await bg(page), 'theme-color follows light ' + meta);
      await ctx.close();
    }
    {
      // reload with saved strobe mode -> starts steady; reduced motion caps at 2 Hz
      const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile, reducedMotion: 'reduce' });
      await page.evaluate(() => localStorage.setItem('screen-light:v1:settings', JSON.stringify({ kelvin: 3000, brightness: 1, preset: 'kelvin', mode: 'strobe', strobeHz: 3, unitMs: 200 })));
      await page.reload(); await sleep(200);
      const s = await page.evaluate(() => [__light.st.mode, __light.st.strobeHz, __light.MAX_HZ, __light.st.unitMs]);
      assert(s[0] === 'steady', 'flashing mode never auto-starts on reload');
      assert(s[1] === 2 && s[2] === 2 && s[3] === 250, 'reduced motion: max 2 Hz, SOS unit >= 250 ms ' + s);
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 360, height: 780 }, ...mobile });
      const ph = await page.evaluate(() => document.getElementById('panel').getBoundingClientRect().height / innerHeight);
      assert(ph <= 0.451, `360: panel ${(ph * 100).toFixed(1)}%`);
      await page.screenshot({ path: OUT + '/360x780.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 844, height: 390 }, ...mobile });
      await page.screenshot({ path: OUT + '/844x390.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' });
      await page.locator('#p-warm').click();
      await page.screenshot({ path: OUT + '/390x844-dark.png' }); await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 1280, height: 800 } });
      await page.screenshot({ path: OUT + '/desktop.png' }); await ctx.close();
    }
    assert(errors.length === 0, 'no console/page errors ' + JSON.stringify(errors));
  } finally {
    await browser.close();
    fs.unlinkSync(WRAP);
  }
})().catch(e => { console.error(e); process.exit(1); });
