// Verify zh-convert in a browser: run with `node verify.js`
// Opens the page at 390×844 and the three lobby iframe sizes (375×500, 390×610, 430×740), light and dark,
// asserts no page errors / horizontal overflow, drives the main flows, and writes cover-390x520.png.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'zh-convert-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
    { name: '375x500', viewport: { width: 375, height: 500 }, mobile: true },
    { name: '390x610', viewport: { width: 390, height: 610 }, mobile: true },
    { name: '430x740', viewport: { width: 430, height: 740 }, mobile: true },
    { name: '375x500-dark', viewport: { width: 375, height: 500 }, mobile: true, dark: true },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, mobile: true, dark: true },
    { name: '844x390', viewport: { width: 844, height: 390 }, mobile: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: s.viewport, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, colorScheme: s.dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL);
    await page.waitForTimeout(250);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    // sample content visible with the 範例 chip and highlighted marks
    const marks = await page.locator('#out .m').count();
    ok(marks > 10, `${s.name} sample converted with ${marks} marks`);
    ok(await page.locator('#sample-chip').isVisible(), `${s.name} 範例 chip shown on first open`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });

    if (s.name === '390x844') {
      const outText = () => page.evaluate(() => document.getElementById('out').textContent);
      ok(/頭髮/.test(await outText()) && /麵條/.test(await outText()) && /一隻貓/.test(await outText()), 'sample: 头发→頭髮, 面条→麵條, 一只→一隻');
      ok(!/軟體/.test(await outText()), '台灣用語 off by default (软件 stays 軟件)');
      // toggle 台灣用語
      await page.click('label[for="opt-tw"], #opt-tw + .sw');
      ok(/軟體/.test(await outText()) && /品質/.test(await outText()) && /計程車/.test(await outText()), '台灣用語 on: 軟體 / 品質 / 計程車');
      ok((await page.locator('#out .m.tw').count()) >= 3, 'vocabulary marks use the tw style');
      // type own text: chip disappears, counts update
      await page.fill('#src', '他的头发很干净');
      await page.waitForTimeout(150);
      ok((await outText()) === '他的頭髮很乾淨', 'typed text converts: ' + (await outText()));
      ok(!(await page.locator('#sample-chip').isVisible()), '範例 chip hidden after typing');
      ok(/7 字/.test(await page.textContent('#in-meta')), 'character count shows 7 字: ' + (await page.textContent('#in-meta')));
      ok(/處變更/.test(await page.textContent('#out-meta')), 'change count shown: ' + (await page.textContent('#out-meta')));
      // tap a mark -> sheet with alternatives, pick one
      await page.click('#out .m:has-text("頭髮")');
      await page.waitForTimeout(250);
      ok(await page.locator('#sheet.on').isVisible(), 'alternatives sheet opens');
      const alts = await page.locator('#sheet-alts button').allTextContents();
      ok(alts[0] === '頭髮' && alts.includes('頭發'), 'alternatives listed: ' + alts.join('/'));
      await page.click('#sheet-alts button:has-text("頭發")');
      ok((await outText()) === '他的頭發很乾淨', 'picking an alternative updates the result');
      // add to custom dictionary from the sheet
      await page.click('#sheet-dict');
      await page.waitForTimeout(250);
      ok(!(await page.locator('#sheet.on').isVisible()), 'sheet closes after adding to dictionary');
      ok(/1 筆/.test(await page.textContent('#dict-n')), 'dictionary has 1 entry');
      ok((await page.locator('#out .m.cus').count()) === 1, 'custom entry is highlighted in the cus style');
      // persisted
      await page.reload(); await page.waitForTimeout(250);
      ok((await page.inputValue('#src')) === '他的头发很干净' && (await outText()) === '他的頭發很乾淨' && (await page.isChecked('#opt-tw')), 'text, dictionary and toggle persist after reload');
      // delete the entry
      await page.click('#dict summary');
      await page.click('#dict-list .del');
      await page.waitForTimeout(100);
      ok((await outText()) === '他的頭髮很乾淨', 'deleting the entry restores the built-in conversion');
      // add via the form
      await page.fill('#dict-from', '土豆'); await page.fill('#dict-to', '洋芋'); await page.click('#dict-add');
      await page.fill('#src', '土豆和软件');
      await page.waitForTimeout(150);
      ok((await outText()) === '洋芋和軟體', 'form entry applies with vocabulary: ' + (await outText()));
      // swap direction moves the result into the input
      await page.click('#swap');
      await page.waitForTimeout(150);
      ok((await page.inputValue('#src')) === '洋芋和軟體' && (await page.getAttribute('#dir-t2s', 'aria-pressed')) === 'true', 'swap puts result into input and flips direction');
      ok((await outText()) === '洋芋和软件', 't2s with vocabulary: ' + (await outText()));
      ok(!(await page.locator('#opt-tai-wrap').isVisible()), '臺/台 option hidden in t2s');
      // clear and copy
      await page.click('#clear');
      ok((await page.inputValue('#src')) === '' && (await outText()) === '', 'clear empties both panes');
      await page.fill('#src', '乾淨');
      await page.waitForTimeout(150);
      await page.click('#copy');
      await page.waitForTimeout(100);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      ok(clip === '干净', 'copy writes the result to the clipboard: ' + clip);
      ok(/已複製/.test(await page.textContent('#toast')), 'toast confirms copy');
      // theme toggle
      await page.click('#theme-btn');
      ok((await page.getAttribute('html', 'data-theme')) === 'light', 'theme button cycles to light');
      await page.click('#theme-btn');
      ok((await page.getAttribute('html', 'data-theme')) === 'dark', 'theme button cycles to dark');
      // back to a sample state for the cover: reset storage and reload
      await page.evaluate(() => localStorage.clear());
    }
    if (s.name === '375x500') {
      // everything important reachable in the small lobby frame
      const dirBox = await page.locator('#dir-s2t').boundingBox();
      ok(dirBox && dirBox.height >= 44 && dirBox.y >= 0, 'direction buttons at least 44px tall');
      const btns = await page.evaluate(() => [...document.querySelectorAll('button:not(.m)')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.textContent.trim(), r.width, r.height]; }).filter(x => x[1] < 44 || x[2] < 36));
      ok(btns.length === 0, 'no tiny tap targets: ' + JSON.stringify(btns));
    }
    ok(errors.length === 0, `${s.name} no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // cover: 390x520, sample with 台灣用語 on so all three mark styles show
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForTimeout(250);
    await page.click('#opt-tw + .sw');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/cover-390x520.png` });
    ok(fs.existsSync(`${OUT}/cover-390x520.png`), 'cover-390x520.png written');
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
