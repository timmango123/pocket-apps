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

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.goto(URL); await page.waitForTimeout(300);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    assert((await page.locator('#txt').inputValue()).length > 0, 'sample text present on open');
    await page.screenshot({ path: OUT + '/390x844.png' });

    // preview canvas actually draws lit pixels
    const lit = await page.evaluate(() => { const c = document.querySelector('#pvc'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++; return n; });
    assert(lit > 50, 'preview has lit LED pixels (' + lit + ')');

    // LED matrix sampling: "I" is a vertical bar -> lit cells in a column
    const m = await page.evaluate(() => { const c = document.createElement('canvas'); c.style.cssText = 'width:800px;height:200px;position:fixed;left:-9999px'; document.body.appendChild(c); const b = new __led.Banner(c); __led.cfg = Object.assign({}, __led.cfg, { text: 'HI', led: true, rows: 16 }); b.resize(false); b.build(); const { data, cols, R } = b.mat; let n = 0; for (const v of data) n += v; c.remove(); return { cols, R, n }; });
    assert(m.R === 16 && m.cols > 4 && m.n > 20, `LED matrix built (cols ${m.cols}, lit ${m.n})`);

    // speed formula + frame-rate independence (60 Hz vs 120 Hz)
    const sp = await page.evaluate(() => {
      __led.cfg = Object.assign({}, __led.cfg, { text: '測試', speed: 5, dir: 'left' });
      const c = document.createElement('canvas'); c.style.cssText = 'width:844px;height:390px;position:fixed;left:-9999px'; document.body.appendChild(c);
      const a = new __led.Banner(c); a.resize(false); const b = new __led.Banner(c); b.resize(false);
      for (let i = 0; i < 60; i++) a.advance(1 / 60); for (let i = 0; i < 120; i++) b.advance(1 / 120);
      c.remove(); return { a: a.off, b: b.off, pps: a.pxPerSec() };
    });
    assert(Math.abs(sp.pps - 5 * 844 * 0.08) < 0.01, 'speed 5 on 844px = 337.6 px/s');
    assert(Math.abs(sp.a - sp.b) / sp.a < 0.001 && Math.abs(sp.a - 337.6) < 0.5, '60 Hz and 120 Hz move the same distance in 1 s');

    // share code round trip with Chinese text + emoji
    const rt = await page.evaluate(() => { const c = Object.assign({}, __led.cfg, { text: '接機：王小明 🎉', fg: '#00e5ff', blink: 'off', rows: 32 }); const d = __led.decode(__led.encode(c)); return d.text === c.text && d.fg === c.fg && d.rows === 32; });
    assert(rt, 'share code round trip (UTF-8 + emoji)');
    const bad = await page.evaluate(() => { try { __led.decode('%%%notvalid'); return 'no-throw'; } catch (e) { return 'throw'; } });
    assert(bad === 'throw', 'invalid share code rejected');

    // UI: template, color, LED off, direction
    await page.locator('#tpls [data-t="我愛你"]').click();
    assert((await page.locator('#txt').inputValue()) === '我愛你', 'template fills text');
    await page.locator('#fgColors [data-fg="#ff3df2"]').click();
    await page.locator('#led').uncheck();
    await page.locator('#segDir [data-v="static"]').click();
    assert(await page.evaluate(() => __led.cfg.fg === '#ff3df2' && !__led.cfg.led && __led.cfg.dir === 'static'), 'style controls update config');
    await page.screenshot({ path: OUT + '/390x844-plain.png' });

    // flash warning
    await page.locator('#segBlink [data-v="fast"]').click();
    assert(await page.locator('#dlgFlash').isVisible(), 'blink shows photosensitivity warning first');
    await page.screenshot({ path: OUT + '/390x844-flash.png' });
    await page.locator('#fYes').click();
    assert(await page.evaluate(() => __led.cfg.blink) === 'fast', 'blink on after confirm');
    await page.locator('#segBlink [data-v="off"]').click();
    await page.locator('#segBlink [data-v="slow"]').click();
    assert(await page.locator('#dlgFlash').isHidden() && await page.evaluate(() => __led.cfg.blink) === 'slow', 'no second warning (ack stored)');
    await page.locator('#segBlink [data-v="off"]').click();

    // empty text disables play
    await page.locator('#txt').fill('');
    assert(await page.locator('#btnPlay').isDisabled(), 'empty text: play disabled');
    await page.locator('#txt').fill('安可！安可！');

    // save boards
    await page.locator('#btnSave').click();
    await page.locator('#tpls [data-t="生日快樂"]').click();
    await page.locator('#led').check();
    await page.locator('#segDir [data-v="left"]').click();
    await page.locator('#btnSave').click();
    await page.reload(); await page.waitForTimeout(200);
    assert((await page.locator('#txt').inputValue()) === '生日快樂', 'current board persisted');
    await page.locator('#btnBoards').click();
    assert(await page.locator('#blist li').count() === 2, '2 saved boards');
    await page.screenshot({ path: OUT + '/390x844-boards.png' });
    await page.locator('#blist [data-load="0"]').click();
    assert((await page.locator('#txt').inputValue()) === '安可！安可！', 'load saved board');

    // play in portrait -> rotated rendering, tap shows controls, double tap exits
    await page.locator('#btnPlay').click(); await page.waitForTimeout(400);
    assert(await page.locator('#player').isVisible(), 'player opened');
    assert(await page.evaluate(() => __led.pl.rot), 'portrait: rendering rotated along long edge');
    const W = await page.evaluate(() => __led.pl.W);
    assert(W === 844, 'rotated logical width = screen height');
    await page.screenshot({ path: OUT + '/390x844-play-portrait.png' });
    await page.mouse.click(195, 300); await page.waitForTimeout(120); await page.mouse.click(195, 300); await page.waitForTimeout(100);
    assert(await page.locator('#player').isHidden(), 'double tap exits');

    // share dialog + import
    await page.locator('#btnShare').click();
    const code = await page.locator('#shareCode').inputValue();
    assert(code.length > 20 && /^[A-Za-z0-9_-]+$/.test(code), 'share code is base64url');
    await page.locator('#dlgShare [data-close]').click();
    await page.locator('#txt').fill('暫時改掉');
    await page.locator('#btnImport').click();
    await page.locator('#importCode').fill('https://example.invalid/x#t=' + code);
    await page.locator('#btnDoImport').click();
    assert((await page.locator('#txt').inputValue()) === '安可！安可！', 'import from #t= link restores board');
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }

  // landscape play + screenshots
  const shots = [
    ['360x780', { viewport: { width: 360, height: 780 }, ...mobile }],
    ['844x390', { viewport: { width: 844, height: 390 }, ...mobile }],
    ['390x844-dark', { viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' }],
    ['desktop', { viewport: { width: 1280, height: 800 } }],
  ];
  for (const [name, opts] of shots) {
    const { ctx, page } = await mk(opts);
    await page.goto(URL); await page.waitForTimeout(300);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw > iw || iw !== opts.viewport.width) { console.error('width problem', name, sw, iw); process.exitCode = 1; }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '844x390') {
      await page.locator('#btnPlay').click(); await page.waitForTimeout(1200);
      const rot = await page.evaluate(() => __led.pl.rot);
      if (rot) { console.error('landscape should not rotate'); process.exitCode = 1; } else console.log('ok - landscape: no rotation');
      await page.screenshot({ path: `${OUT}/844x390-play-led.png` });
      await page.evaluate(() => { __led.cfg = Object.assign({}, __led.cfg, { led: false, rainbow: true, text: '安可 ENCORE' }); __led.pl.resize(true); });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${OUT}/844x390-play-rainbow.png` });
    }
    await ctx.close();
  }
  if (errors.length) { console.error('errors', errors); process.exitCode = 1; } else console.log('ok - no console/page errors');
  await browser.close();
  fs.unlinkSync(WRAP);
})().catch(e => { console.error(e); process.exit(1); });
