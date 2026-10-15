// Verify screen-ruler: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n) });
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const mob = (w, h, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });
  const noHScroll = async (p, label) => assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': no horizontal scroll');

  const ctx = await mob(390, 844); const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(300);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  await noHScroll(page, '390 ruler');
  assert((await page.textContent('#calBadge')).includes('未校準'), 'uncalibrated warning shown');
  assert(Math.abs(await page.evaluate(() => window.__sr.ppm()) - 96 / 25.4) < 1e-9, 'default 96 dpi = 3.7795 px/mm');

  // drag lines: 189 px apart -> 50.0 mm at 3.7795 px/mm
  const wsBox = await page.locator('#ws').boundingBox();
  const dragTo = async (sel, x, y) => { const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(x, y, { steps: 4 }); await page.mouse.up(); };
  await dragTo('#lineA', wsBox.x + 100, wsBox.y + 300);
  await dragTo('#lineB', wsBox.x + 289, wsBox.y + 300);
  let L = await page.evaluate(() => window.__sr.lines);
  assert(Math.round(L.a) === 100 && Math.round(L.b) === 289, 'lines dragged to 100 / 289 px');
  assert((await page.textContent('#dist')).startsWith('50.0 mm'), '189 px -> "50.0 mm": ' + await page.textContent('#dist'));
  assert(await page.isHidden('#mag'), 'magnifier hidden after drag');
  await shot(page, '390x844.png');
  await page.click('#uIn'); await page.waitForTimeout(50);
  assert((await page.textContent('#dist')).startsWith('1.97 in'), 'inch mode: 50 mm -> 1.97 in');
  await page.click('#uMm');
  // keyboard nudge
  await page.focus('#lineB'); await page.keyboard.press('Shift+ArrowRight');
  assert(Math.round((await page.evaluate(() => window.__sr.lines)).b) === 299, 'Shift+Arrow moves line 10 px');
  await page.click('#oV'); await page.waitForTimeout(50);
  assert(await page.locator('#lineA.v').count() === 1, 'vertical orientation switches lines');
  await page.click('#oH');

  // protractor
  await page.click('#mProt'); await page.waitForTimeout(100);
  await page.check('#snapChk');
  const geo = async () => page.evaluate(() => { const c = document.querySelector('#prot .ctr'); return { cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy') }; });
  let g = await geo(); const ws2 = await page.locator('#ws').boundingBox();
  const armTo = async (k, deg, R = 110) => { const h = await page.locator(`#arm-${k} .hit`).boundingBox(); await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    await page.mouse.move(ws2.x + g.cx + R * Math.cos(deg * Math.PI / 180), ws2.y + g.cy - R * Math.sin(deg * Math.PI / 180), { steps: 5 }); await page.mouse.up(); };
  await armTo('a2', 45);
  assert(await page.getAttribute('#angleOut', 'data-deg') === '45', 'semicircle' + await page.getAttribute('#angleOut','data-deg') + ': arm to 45 deg with snap -> 45.0°');
  await armTo('a1', 150); await armTo('a2', 20);
  assert(await page.getAttribute('#angleOut', 'data-deg') === '130', 'arms 150 and 20 -> 130.0°');
  await page.uncheck('#snapChk'); await armTo('a2', 33.3);
  const d33 = +await page.getAttribute('#angleOut', 'data-deg');
  assert(Math.abs(d33 - (150 - 33.3)) < 0.6 && String(d33).split('.')[1]?.length <= 1, '0.1° precision without snap: ' + d33);
  await page.check('#snapChk');
  await page.click('#pFull'); await page.waitForTimeout(80); g = await geo();
  await page.click('#pReset'); await armTo('a2', 270, 90);
  assert(await page.getAttribute('#angleOut', 'data-deg') === '270', 'full circle: 0 -> 270 = 270.0°');
  await noHScroll(page, '390 protractor');
  await page.click('#pHalf');

  // grid
  await page.click('#mGrid'); await page.waitForTimeout(80);
  assert(Math.abs(+await page.getAttribute('#grid', 'data-step') - 37.795) < 0.01, 'grid 1 cm = 37.80 px');
  await page.selectOption('#gStep', '5mm');
  assert(Math.abs(+await page.getAttribute('#grid', 'data-step') - 18.898) < 0.01, 'grid 5 mm = 18.90 px');
  await page.selectOption('#gStep', 'px'); await page.fill('#gPx', '25');
  assert(+await page.getAttribute('#grid', 'data-step') === 25, 'custom grid 25 px');
  await page.check('#gGold');
  assert(await page.locator('#guides .guide').count() === 8, 'thirds + golden guides = 8 lines');
  await noHScroll(page, '390 grid');

  // calibration: manual 6.1" 1170x2532 @3x -> 6.001 px/mm
  await page.click('#mSet'); await page.waitForTimeout(80);
  await page.click('#cmManual');
  await page.fill('#mDiag', '0.01'); await page.fill('#mW', '1170'); await page.fill('#mH', '2532'); await page.fill('#mDpr', '3');
  await page.click('#mApply');
  assert((await page.textContent('#calErr')).includes('異常') && await page.evaluate(() => window.__sr.calib) === null, 'absurd value (>40 px/mm) rejected');
  await page.fill('#mDiag', '6.1');
  assert((await page.textContent('#mOut')).includes('PPI 457.3') && (await page.textContent('#mOut')).includes('6.001'), 'manual: PPI 457.3 -> 6.001 px/mm');
  await page.click('#mApply');
  assert(Math.abs(await page.evaluate(() => window.__sr.ppm()) - 6.0009) < 0.001, 'calibration applied');
  assert((await page.textContent('#calBadge')).includes('已校準'), 'badge shows calibrated');
  await noHScroll(page, '390 settings');
  await shot(page, '390x844-settings.png');
  await page.click('#mRuler'); await page.waitForTimeout(100);
  await dragTo('#lineA', wsBox.x + 100, wsBox.y + 300); await dragTo('#lineB', wsBox.x + 299, wsBox.y + 300);
  // lines at 100 / 299 -> 199 px / 6.0009 = 33.16 -> 33.0 mm
  assert((await page.textContent('#dist')).startsWith('33.0 mm'), 'after calibration 199 px -> 33.0 mm: ' + await page.textContent('#dist'));
  // card calibration via slider
  await page.click('#mSet'); await page.click('#cmCard');
  await page.evaluate(() => { const r = document.getElementById('calRange'); r.value = '5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  const cw = (await page.locator('#cardF').boundingBox()).width;
  assert(Math.abs(cw - 428) < 1, 'card frame at 5 px/mm = 428 px wide (85.6 mm)');
  await page.click('#calApply');
  assert(await page.evaluate(() => window.__sr.calib.method) === 'card' && await page.evaluate(() => window.__sr.ppm()) === 5, 'card calibration 5 px/mm saved');
  await noHScroll(page, '390 card calibration');

  // colour from image
  await page.click('#mColor'); await page.waitForTimeout(80);
  const hasED = await page.evaluate(() => 'EyeDropper' in window);
  assert(await page.isVisible('#edBtn') === hasED, 'EyeDropper button matches support (' + hasED + ')');
  assert((await page.textContent('#edNote')).length > 20, 'support note shown');
  const ib = await page.locator('#imgCv').boundingBox();
  await page.mouse.click(ib.x + ib.width * (60 / 480), ib.y + ib.height * (50 / 300));
  assert(await page.inputValue('#vHex') === '#E63946', 'picked #E63946 from sample');
  assert(await page.inputValue('#vRgb') === 'rgb(230, 57, 70)' && await page.inputValue('#vHsl') === 'hsl(355, 78%, 56%)', 'RGB / HSL conversions');
  await page.mouse.click(ib.x + ib.width * (420 / 480), ib.y + ib.height * (150 / 300));
  assert(await page.inputValue('#vHex') === '#FFFFFF', 'picked white block');
  assert((await page.evaluate(() => window.__sr.colors)).join() === '#FFFFFF,#E63946', 'history newest first');
  // drag shows magnifier
  await page.mouse.move(ib.x + 30, ib.y + 30); await page.mouse.down(); await page.mouse.move(ib.x + 200, ib.y + 40, { steps: 3 });
  assert(await page.isVisible('#mag'), 'magnifier visible while dragging on image'); await page.mouse.up();
  assert(await page.isHidden('#mag'), 'magnifier hidden after release');
  await noHScroll(page, '390 color');
  await shot(page, '390x844-color.png');
  const nHist = (await page.evaluate(() => window.__sr.colors)).length;

  // persistence
  await page.reload(); await page.waitForTimeout(300);
  assert(await page.evaluate(() => window.__sr.ppm()) === 5 && (await page.evaluate(() => window.__sr.colors)).length === nHist, 'calibration + history persist after reload');
  assert(await page.isVisible('#colorSheet'), 'last mode restored');
  await page.click('#mRuler'); await page.waitForTimeout(100);
  await page.click('#mSet'); await page.click('#calReset'); await page.click('#mRuler'); await page.waitForTimeout(80);
  await ctx.close();

  // other sizes
  const sizes = [[360, 780, 'mProt', '360x780.png'], [844, 390, 'mRuler', '844x390.png']];
  for (const [w, h, mode, name] of sizes) {
    const c = await mob(w, h); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(200); await p.click('#' + mode); await p.waitForTimeout(150);
    assert(await p.evaluate(() => innerWidth) === w, `innerWidth ${w}`);
    await noHScroll(p, name);
    if (mode === 'mRuler') { const tb = await p.locator('.bar').boundingBox(); assert(tb.width <= 80 && tb.height > 300, 'landscape: toolbar on the left'); }
    await shot(p, name);
    for (const m of ['mGrid', 'mColor', 'mSet']) { await p.click('#' + m); await p.waitForTimeout(80); await noHScroll(p, name + ' ' + m); }
    await c.close();
  }
  const cd = await mob(390, 844, { colorScheme: 'dark' }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await pd.waitForTimeout(250);
  assert(await pd.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(11, 16, 18)', 'dark theme background');
  await shot(pd, '390x844-dark.png');
  await pd.click('#mProt'); await pd.waitForTimeout(100); await shot(pd, '390x844-dark-protractor.png');
  await cd.close();
  const cdesk = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pk = await cdesk.newPage(); watch(pk);
  await pk.goto(URL_); await pk.waitForTimeout(250); await noHScroll(pk, '1280');
  await shot(pk, '1280x800.png');
  await pk.click('#mColor'); await pk.waitForTimeout(100); await shot(pk, '1280x800-color.png');
  await cdesk.close();

  assert(errors.length === 0, 'no console errors / page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log('ALL PASSED');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
