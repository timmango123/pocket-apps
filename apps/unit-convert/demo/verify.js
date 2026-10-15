// Verify unit-convert: run with `node verify.js`
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs'), os = require('os');
// The artifact host wraps the page in a document with a viewport meta; reproduce that for testing.
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'unit-convert-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
    { name: '360x780', viewport: { width: 360, height: 780 }, mobile: true },
    { name: '844x390', viewport: { width: 844, height: 390 }, mobile: true },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, mobile: true, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: s.viewport, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, colorScheme: s.dark ? 'dark' : 'light' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });

    if (s.name === '390x844') {
      // Default: length, 1 m
      const ft = await page.inputValue('#val-length-ft');
      const cm = await page.inputValue('#val-length-cm');
      ok(cm === '100' && ft === '3.280839895', `1 m = 100 cm, ${ft} ft`);
      // area: 1 坪
      await page.click('#tab-area');
      ok((await page.inputValue('#val-area-m2')) === '3.305785124', '1 坪 = 3.305785124 m²');
      // weight 1 台斤 = 600 g
      await page.click('#tab-weight');
      ok((await page.inputValue('#val-weight-g')) === '600', '1 台斤 = 600 g');
      // temperature 100°F
      await page.click('#tab-temp');
      ok((await page.inputValue('#val-temp-C')) === '37.77777778', '100°F = 37.77777778 °C');
      await page.selectOption('#main-unit', 'C');
      await page.fill('#main-value', '-500');
      const msg = await page.textContent('#main-msg');
      ok(/絕對零度/.test(msg) && (await page.inputValue('#val-temp-K')) === '', '-500 °C shows error, no results');
      await page.fill('#main-value', '0');
      ok((await page.inputValue('#val-temp-K')) === '273.15', '0 °C = 273.15 K');
      // full-width + comma
      await page.click('#tab-length');
      await page.selectOption('#main-unit', 'm');
      await page.fill('#main-value', '１２，０００');
      ok((await page.inputValue('#val-length-km')) === '12', '１２，０００ m parses to 12000 (12 km)');
      // expression
      await page.fill('#main-value', '12*3.5');
      ok((await page.inputValue('#val-length-cm')) === '4,200' && /= 42/.test(await page.textContent('#main-msg')), '12*3.5 m = 4,200 cm, preview = 42');
      await page.fill('#main-value', 'abc');
      ok((await page.textContent('#main-msg')) === '請輸入數字' && (await page.inputValue('#val-length-cm')) === '', 'non-number shows 請輸入數字');
      // reverse: type in ft row
      await page.fill('#main-value', '1');
      await page.fill('#val-length-ft', '10');
      ok((await page.inputValue('#val-length-m')) === '3.048' && (await page.inputValue('#main-unit')) === 'ft', 'typing 10 in ft row -> 3.048 m, source = ft');
      // click label sets source keeping quantity
      await page.click('.r[data-unit="cm"] .lab');
      ok((await page.inputValue('#main-value')) === '304.8' && (await page.inputValue('#main-unit')) === 'cm', 'tap cm label: source cm, 304.8');
      // swap
      await page.click('#swap');
      ok((await page.inputValue('#main-unit')) === 'ft' && (await page.inputValue('#main-value')) === '10', 'swap back to ft = 10');
      // 12-digit fits
      await page.fill('#main-value', '123456789012');
      await page.selectOption('#main-unit', 'm');
      await page.fill('#main-value', '123456789.012');
      const clip = await page.evaluate(() => [...document.querySelectorAll('input.val')].filter(i => i.scrollWidth > i.clientWidth + 1).map(i => i.id + ':' + i.value));
      ok(clip.length === 0, '12-digit values not clipped ' + clip.join(','));
      // star favourite moves row to top
      await page.click('.r[data-unit="tchi"] .star');
      const first = await page.evaluate(() => document.querySelector('.r').dataset.unit);
      ok(first === 'tchi', 'starred 台尺 moves to top');
      // currency
      await page.click('#tab-fx');
      ok(!(await page.isHidden('#rate-banner')), 'sample-rate banner visible');
      await page.fill('#rate-USD', '');
      ok((await page.getAttribute('#val-fx-USD', 'placeholder')) === '未設定', 'cleared USD shows 未設定');
      await page.fill('#rate-USD', '200000');
      ok(await page.isVisible('.rate-row[data-code="USD"] .rerr'), 'rate 200000 out of range error');
      await page.fill('#rate-USD', '32');
      await page.fill('#main-value', '3200');
      ok((await page.inputValue('#val-fx-USD')) === '100', '3200 TWD = 100 USD at 32');
      await page.screenshot({ path: `${OUT}/390x844-fx.png` });
      // persistence
      await page.waitForTimeout(400);
      await page.reload();
      await page.waitForTimeout(200);
      ok((await page.inputValue('#rate-USD')) === '32' && (await page.inputValue('#val-fx-USD')) === '100', 'rates + last state persist after reload');
      await page.click('#tab-length');
      ok((await page.evaluate(() => document.querySelector('.r').dataset.unit)) === 'tchi', 'favourite persists');
      // clear
      await page.click('#clear');
      ok((await page.inputValue('#val-length-cm')) === '', 'clear empties results');
      // swipe category change via dispatched touch
      await page.evaluate(() => localStorage.clear());
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
