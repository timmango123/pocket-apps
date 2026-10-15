// Verify css-shadow: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const mob = (w, h, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });
  const ctx = await mob(390, 844); const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(300);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  const css0 = await page.textContent('#cssOut');
  assert(css0.includes('box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);'), 'default shadow output');
  assert(css0.includes('border-radius: 16px;'), 'default radius shortest syntax');
  assert(await page.isVisible('#sampleTag'), 'sample tag visible');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // import spec example
  await page.click('details summary');
  await page.click('#importBtn');
  let S = await page.evaluate(() => window.__cs.S);
  assert(S.layers.length === 2 && S.layers[0].y === 1 && S.layers[0].blur === 3 && Math.abs(S.layers[1].color.a - .24) < 1e-6, 'import "0 1px 3px rgba(0,0,0,.12), 0 1px 2px rgba(0,0,0,.24)" -> 2 layers');
  assert(await page.evaluate(() => window.__cs.shadowStr()) === '0 1px 3px 0 rgba(0, 0, 0, 0.12), 0 1px 2px 0 rgba(0, 0, 0, 0.24)', 'round-trip string');
  // import with a bad layer
  await page.fill('#importTxt', 'inset 0 2px 4px hsl(0 0% 0% / .3), 3px foo bar, 2px 2px 0 #f00');
  await page.click('#importBtn');
  assert(await page.locator('#importRes li.bad').count() === 1 && await page.locator('#importRes li').count() === 3, 'bad layer marked red, 2 parsed');
  S = await page.evaluate(() => window.__cs.S);
  assert(S.layers.length === 2 && S.layers[0].inset && S.layers[1].color.r === 255, 'inset + hex colors parsed');
  // computed style equals output (box-shadow applied)
  await page.waitForTimeout(60);
  const cs = await page.evaluate(() => getComputedStyle(document.getElementById('box')).boxShadow);
  assert(/inset/.test(cs) && /255, 0, 0/.test(cs), 'preview box uses same layers: ' + cs);

  // Material 3 preset
  await page.click('#preset6');
  assert(await page.evaluate(() => window.__cs.shadowStr()) === '0 6px 12px 0 rgba(0, 0, 0, 0.14), 0 3px 6px 0 rgba(0, 0, 0, 0.12)', 'Material 3 = key y6 blur12 .14 + ambient y3 blur6 .12');
  // lamp drag: move lamp 100px left/100px up of center -> base offset (15,15)
  await page.evaluate(() => scrollTo(0, 0)); const st = await page.locator('#stage').boundingBox();
  await page.waitForTimeout(60); const lb = await page.locator('#lamp').boundingBox();
  await page.mouse.move(lb.x + 22, lb.y + 22); await page.mouse.down();
  await page.mouse.move(st.x + st.width / 2 - 100, st.y + st.height / 2 - 100, { steps: 5 }); await page.mouse.up();
  S = await page.evaluate(() => window.__cs.S);
  assert(S.layers[0].x === 15 && S.layers[0].y === 15 && S.layers[0].blur === 42 && S.layers[1].x === 30 && S.layers[1].y === 30 && Math.abs(S.layers[1].color.a - .07) < 1e-6, 'lamp: layer1 (15,15) blur 42, layer2 doubled & alpha halved ' + JSON.stringify(S.layers.map(l => [l.x, l.y, l.blur, l.color.a])));
  // slider +/- button
  await page.click('#layer0 ');
  const before = await page.evaluate(() => window.__cs.S.layers[0].blur);
  await page.locator('#layerCtl .ctl').nth(2).locator('.pm').nth(1).dispatchEvent('pointerdown'); await page.locator('#layerCtl .ctl').nth(2).locator('.pm').nth(1).dispatchEvent('pointerup');
  assert(await page.evaluate(() => window.__cs.S.layers[0].blur) === before + 1, 'plus button bumps blur');
  // add layers to 6 -> add hidden
  for (let k = 0; k < 8 && await page.isVisible('#addLayer'); k++) { await page.click('#addLayer'); await page.waitForTimeout(40); }
  assert(await page.evaluate(() => window.__cs.S.layers.length) === 6, 'max 6 layers, add button hidden');
  // Neumorphism with dark bg warns
  await page.evaluate(() => { const s = window.__cs.S; s.bg = { type: 'solid', color: '#111111' }; window.__cs.S = s; });
  await page.click('#preset3'); await page.waitForTimeout(50);
  assert(await page.isVisible('#stageNote') && /太深/.test(await page.textContent('#stageNote')), 'neumorphism warns on dark bg');
  await page.evaluate(() => { const s = window.__cs.S; s.bg = { type: 'solid', color: '#e0e5ec' }; window.__cs.S = s; });
  await page.click('#preset3'); await page.waitForTimeout(50);
  S = await page.evaluate(() => window.__cs.S);
  assert(S.layers.length === 2 && S.boxBg === '#e0e5ec' && !await page.isVisible('#stageNote'), 'neumorphism ok on #e0e5ec: ' + await page.evaluate(() => window.__cs.shadowStr()));

  // radius mode
  await page.click('#mRadius');
  await page.fill('#radTxt', '30% 70% 70% 30% / 30% 30% 70% 70%'); await page.click('#radApply'); await page.waitForTimeout(60);
  assert(await page.evaluate(() => window.__cs.radiusStr()) === '30% 70% 70% 30% / 30% 30% 70% 70%', '8-value elliptical round-trip');
  assert(await page.locator('#radCtl input[type=range]').count() === 8, '8 sliders in advanced unlinked');
  await page.click('#uPx'); await page.waitForTimeout(60);
  assert(await page.evaluate(() => window.__cs.radiusStr()) === '48px 112px 112px 48px / 48px 48px 112px 112px', '% -> px conversion with 160 box');
  await page.check('#rLinked'); await page.uncheck('#rAdv'); await page.waitForTimeout(60);
  assert(await page.evaluate(() => window.__cs.radiusStr()) === '48px', 'linked shortest output');
  // drag handle 0 to 20px inside corner
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(60); const rb = await page.locator('#rh0').boundingBox(); const bb = await page.locator('#box').boundingBox();
  await page.mouse.move(rb.x + 22, rb.y + 22); await page.mouse.down(); await page.mouse.move(bb.x + 20, bb.y + 20, { steps: 4 }); await page.mouse.up();
  assert(await page.evaluate(() => window.__cs.radiusStr()) === '20px', 'drag corner handle -> 20px');
  await page.screenshot({ path: path.join(OUT, '390x844-radius.png') });

  // glass
  await page.click('#mGlass'); await page.waitForTimeout(50);
  let g = await page.textContent('#cssOut');
  assert(g.includes('background: rgba(255, 255, 255, 0.15);') && g.includes('backdrop-filter: blur(12px) saturate(160%);') && g.includes('border: 1px solid rgba(255, 255, 255, 0.3);'), 'glass output');
  await page.check('#optPrefix'); await page.waitForTimeout(60); g = await page.textContent('#cssOut');
  assert(g.includes('-webkit-backdrop-filter: blur(12px) saturate(160%);'), 'prefix option');
  await page.check('#optTw'); await page.waitForTimeout(60); g = await page.textContent('#cssOut');
  assert(g.includes('backdrop-blur-[12px]') && g.includes('rounded-[20px]') && /shadow-\[-?\d/.test(g), 'tailwind output: ' + g);
  await page.uncheck('#optTw'); await page.waitForTimeout(60); await page.uncheck('#optPrefix'); await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(OUT, '390x844-glass.png') });
  // save my style, reload keeps state
  await page.click('#saveMine'); await page.waitForTimeout(400);
  await page.reload(); await page.waitForTimeout(300);
  S = await page.evaluate(() => window.__cs.S);
  assert(S.mode === 'glass' && S.radius.h[0] === 20 && await page.locator('#mine .pre').count() === 1, 'state + my style persisted after reload');
  // copy
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('#copyBtn'); await page.waitForTimeout(100);
  assert(/已複製|選取/.test(await page.textContent('#toast')), 'copy feedback');
  // dblclick reset
  await page.click('#mShadow'); await page.dblclick('#box'); await page.waitForTimeout(60);
  assert((await page.textContent('#cssOut')).includes('0 4px 6px -1px'), 'double-click resets');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll after interaction');
  await ctx.close();

  for (const [w, h, name, extra] of [[360, 780, '360x780', {}], [844, 390, '844x390', {}], [390, 844, '390x844-dark', { colorScheme: 'dark' }]]) {
    const c = await mob(w, h, extra); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(300);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth');
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no h-scroll');
    if (name.includes('dark')) assert(/rgba\(0, 0, 0, 0\.6\)/.test(await p.textContent('#cssOut')), 'dark default shadow alpha .6');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const d = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const dp = await d.newPage(); watch(dp);
  await dp.goto(URL_); await dp.waitForTimeout(300); await dp.screenshot({ path: path.join(OUT, '1280x800.png') }); await d.close();
  assert(errors.length === 0, 'no console errors ' + errors.join('|'));
  await browser.close(); fs.unlinkSync(WRAP); console.log('ALL OK');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
