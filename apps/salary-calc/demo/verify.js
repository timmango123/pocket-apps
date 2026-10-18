// End-to-end check of 薪資與勞健保試算 in Chromium at 390×844 and the three lobby iframe sizes, light and dark.
// Run: node verify.js   (writes demo/*.png incl. cover-390x520.png; all gitignored)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
async function open(browser, url, opts = mobile) {
  const ctx = await browser.newContext(opts), page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.goto(url); await sleep(250);
  return { ctx, page, errors };
}
// the hero number counts up for ~260 ms; wait until it settles
const num = async (page, sel) => { await sleep(330); return +((await page.locator(sel).textContent()).replace(/[^\d-]/g, '')); };

(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  try {
    // 1. main flow at 390×844
    {
      const { ctx, page, errors } = await open(browser, URL);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(w[0] <= w[1], `no horizontal scroll at 390 (${w})`);
      assert(await page.locator('#sampleBar').isVisible(), 'sample banner shown on first open');
      assert(await num(page, '#netBig') === 39687, 'sample net 39,687 shown');
      assert((await page.locator('#yearLine').textContent()).includes('2026'), 'data year shown in header');
      const small = await page.evaluate(() => [...document.querySelectorAll('button, input')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 40));
      assert(small.length === 0, 'tap targets large enough ' + JSON.stringify(small));
      await page.screenshot({ path: OUT + '/390x844.png', fullPage: true });
      // edit salary
      await page.fill('#salary', '50000'); await page.locator('#salary').blur();
      assert(!(await page.locator('#sampleBar').isVisible()), 'editing hides the sample banner');
      assert(await page.locator('#salary').inputValue() === '50,000', 'salary formatted with thousands on blur');
      await page.fill('#allow', ''); await page.click('#dep button[data-v="0"]'); await page.click('#selfRate button[data-v="0"]');
      // 50,000: 勞保 45,800×12.5%×20% = 1,145; 健保 50,600×5.17%×30% = 785 → net 48,070
      assert(await num(page, '#netBig') === 50000 - 1145 - 785, 'net for 50,000 / 0 dep / 0% = 48,070');
      await page.click('#dep button[data-v="3"]');
      assert(await num(page, '#netBig') === 50000 - 1145 - 785 * 4, '3 dependents → 健保 ×4');
      await page.click('#selfRate button[data-v="6"]');
      assert(await num(page, '#netBig') === 50000 - 1145 - 785 * 4 - 3036, '自提 6% of 50,600 = 3,036');
      // tabs
      await page.click('#tabYear');
      assert(await page.locator('#panYear').isVisible() && !(await page.locator('#panEmp').isVisible()), 'year tab switches panel');
      await page.fill('#bonusM', '2'); await page.locator('#bonusM').blur();
      assert((await page.locator('#panYear').textContent()).includes('年終 100,000'), 'bonus 2 months = 100,000 in year panel');
      await page.click('#tabEr');
      assert((await page.locator('#panEr').textContent()).includes('勞退雇主提繳 6%'), 'employer panel lists 勞退 6%');
      const er = await page.evaluate(() => __salaryCalc.last.erTotal);
      assert(er === 50000 + 4008 + 101 + 11 + 2449 + 3036, 'employer total 59,605 (職災 on 50,600, 墊償 11): ' + er);
      assert((await page.locator('#panEr').textContent()).includes('工資墊償基金'), 'employer panel lists 工資墊償基金');
      // under-insured
      await page.click('#insMode button[data-v="custom"]');
      assert(await page.locator('#insured').isVisible(), 'custom insured input appears');
      await page.fill('#insured', '30000');
      assert(await page.locator('#insDiff').isVisible() && (await page.locator('#insDiff').textContent()).includes('少 20,000'), 'under-insured warning with difference');
      assert(await page.evaluate(() => __salaryCalc.last.liG) === 30300, 'grade follows override');
      await page.click('#insMode button[data-v="auto"]');
      assert(!(await page.locator('#insDiff').isVisible()), 'back to auto hides warning');
      // persistence
      await page.reload(); await sleep(200);
      assert(await page.locator('#salary').inputValue() === '50,000' && await page.locator('#dep button[aria-pressed="true"]').textContent() === '3+', 'inputs restored after reload');
      // settings: edit 勞保 rate
      const before = await num(page, '#netBig');
      await page.click('#setBtn');
      assert(await page.locator('#cfg-liRate').isVisible(), 'settings sheet opens');
      await page.fill('#cfg-liRate', '13');
      const after = await num(page, '#netBig');
      assert(after < before, `raising 勞保 rate lowers net (${before} → ${after})`);
      assert((await page.locator('#yearLine').textContent()).includes('已自訂費率'), 'header notes custom rates');
      await page.click('#cfgDone');
      assert(!(await page.locator('#scrim').count()), 'sheet closes');
      assert(JSON.parse(await page.evaluate(() => localStorage.getItem('salary-calc:v1:rates'))).liRate === 13, 'rate saved to localStorage');
      await page.reload(); await sleep(200);
      assert(await num(page, '#netBig') === after, 'custom rate survives reload');
      await page.click('#setBtn');
      assert((await page.locator('.sheet').textContent()).includes('依 2026 年（民國 115 年）資料，如有調整可自行修改'), 'settings note about 2026 data');
      for (const k of ['minWage', 'liRate', 'eiRate', 'hiRate', 'avgDep', 'oiRate', 'wfRate', 'pensionEr', 'suppRate', 'liEmpShare', 'hiEmpShare', 'liTop', 'oiTop', 'hiTop', 'pensionTop', 'grades', 'penLow']) assert(await page.locator('#cfg-' + k).count() === 1, 'editable: ' + k);
      await page.fill('#cfg-hiRate', 'x'); assert(await page.locator('#err-cfg-hiRate').isVisible(), 'bad rate explained');
      await page.fill('#cfg-hiRate', '5.17');
      await page.fill('#cfg-grades', '300, 200'); assert((await page.locator('#err-cfg-grades').textContent()).includes('由小到大'), 'bad grade table explained');
      assert(await num(page, '#netBig') === after, 'bad grade table not applied');
      await page.screenshot({ path: OUT + '/settings-390x844.png' });
      await page.click('#cfgReset');
      assert(await num(page, '#netBig') === before, 'reset restores defaults');
      await page.click('#toastAct'); assert(await num(page, '#netBig') === after, 'reset can be undone');
      await page.click('#cfgReset');
      await page.keyboard.press('Escape');
      assert(!(await page.locator('#scrim').count()), 'Escape closes sheet');
      // copy
      await page.click('#tabEmp'); await page.click('#copyBtn'); await sleep(150);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => null));
      if (clip) assert(clip.startsWith('【薪資試算】依 2026 年') && clip.includes('每月實領（稅前）'), 'clipboard text');
      assert((await page.locator('#toastLayer').textContent()).includes('複製'), 'copy toast shown');
      // forgiving input + errors
      await page.fill('#salary', '4.2萬');
      assert(await num(page, '#netBig') === 42000 - 1050 - 651 * 4 - 2520, '4.2萬 parsed as 42,000');
      await page.fill('#salary', 'abc');
      assert(await page.locator('#err-salary').isVisible() && (await page.locator('#err-salary').textContent()).includes('看不懂'), 'letters → inline error with reason');
      assert((await page.locator('#netBig').textContent()) === '—' && await page.locator('#salary').getAttribute('aria-invalid') === 'true', 'invalid input blanks the result instead of showing a wrong number');
      await page.click('#copyBtn', { force: true }); assert((await page.locator('#toastLayer').textContent()).includes('修正'), 'copy blocked while invalid');
      await page.fill('#salary', '-3000'); assert((await page.locator('#err-salary').textContent()).includes('負數'), 'negative explained');
      await page.fill('#bonusM', '30'); assert((await page.locator('#err-bonusM').textContent()).includes('0～24'), 'bonus months range explained');
      await page.fill('#bonusM', '2'); await page.fill('#salary', '50,000'); await page.locator('#salary').blur();
      assert(!(await page.locator('#err-salary').isVisible()) && await num(page, '#netBig') === 50000 - 1145 - 785 * 4 - 3036, 'fixing input restores result');
      // part-time
      await page.fill('#salary', '20000'); await page.locator('#salary').blur();
      assert(await page.locator('#minWarn').isVisible() && (await page.locator('#minWarn').textContent()).includes('基本工資'), 'full-time below min wage warning');
      assert(await page.evaluate(() => __salaryCalc.last.liG) === 29500, 'full-time insured at min wage');
      await page.click('#work button[data-v="part"]');
      assert(await page.evaluate(() => __salaryCalc.last.liG) === 20008 && await page.locator('#hiInField').isVisible(), 'part-time uses 20,008 and shows 健保 choice');
      await page.click('#hiIn button[data-v="0"]');
      assert(await page.evaluate(() => __salaryCalc.last.hiEmp) === 0, '健保 not insured here → 0');
      await page.screenshot({ path: OUT + '/parttime-390x844.png', fullPage: true });
      await page.click('#work button[data-v="full"]'); await page.fill('#salary', '50000'); await page.locator('#salary').blur();
      // rapid taps: 16 taps alternating across two segmented controls in 2 s, every one counted once
      const seq = [];
      for (let i = 0; i < 16; i++) { const v = i % 7; seq.push(v); await page.locator(`#selfRate button[data-v="${v}"]`).tap(); await page.locator(`#dep button[data-v="${i % 4}"]`).tap(); }
      assert(await page.evaluate(() => [__salaryCalc.state.selfRate, __salaryCalc.state.dep].join()) === [15 % 7, 15 % 4].join(), 'rapid alternating taps all land');
      await page.click('#dep button[data-v="3"]'); await page.click('#selfRate button[data-v="6"]');
      // theme toggle
      await page.click('#themeBtn');
      assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'theme toggle → light');
      await page.click('#themeBtn');
      assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme toggle → dark');
      await page.screenshot({ path: OUT + '/dark-390x844.png', fullPage: true });
      assert((await page.locator('#foot').textContent()).includes('依 2026 年資料，如有調整可自行修改'), 'main screen note about 2026 data');
      // clear + undo
      await page.evaluate(() => { localStorage.removeItem('salary-calc:v1:input'); }); await page.reload(); await sleep(200);
      await page.click('#sampleClear'); assert((await page.locator('#netBig').textContent()) === '—', 'cleared → empty state');
      await page.screenshot({ path: OUT + '/empty-390x844.png' });
      await page.click('#toastAct'); assert(await num(page, '#netBig') === 39687, 'clear can be undone');
      // corrupt storage
      await page.evaluate(() => { localStorage.setItem('salary-calc:v1:input', '{oops'); localStorage.setItem('salary-calc:v1:rates', '[1,2'); });
      await page.reload(); await sleep(200);
      assert(await num(page, '#netBig') === 39687, 'corrupt storage → sample again, no crash');
      assert(!(await page.evaluate(() => /NaN|undefined/.test(document.body.innerText))), 'no NaN/undefined on screen');
      assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
      await ctx.close();
    }
    // 2. three iframe sizes, light and dark: no overflow, no errors, hero + inputs usable
    for (const [w, h] of [[360, 640], [375, 500], [390, 610], [430, 740], [430, 932], [844, 390], [1200, 800]]) for (const scheme of ['light', 'dark']) {
      const { ctx, page, errors } = await open(browser, URL, { ...mobile, viewport: { width: w, height: h }, colorScheme: scheme });
      const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(ow <= 0, `${w}×${h} ${scheme}: no horizontal overflow (${ow})`);
      await page.click('#sampleClear'); await page.fill('#salary', '38000'); await page.locator('#salary').blur();
      assert(await num(page, '#netBig') === 38000 - 955 - 592, `${w}×${h}: 38,000 → net 36,453`);
      if (scheme === 'dark' && w === 390) await page.screenshot({ path: `${OUT}/dark-${w}x${h}.png` });
      const clipped = await page.evaluate(() => { const r = document.getElementById('netBig').getBoundingClientRect(); return r.right > innerWidth || r.width < 10; });
      assert(!clipped, `${w}×${h}: hero number fits`);
      if (scheme === 'light') await page.screenshot({ path: `${OUT}/${w}x${h}.png` });
      await page.click('#setBtn'); await sleep(350);
      assert(await page.locator('#cfgDone').isVisible(), `${w}×${h}: settings sheet usable`);
      if (scheme === 'dark' && w === 375) await page.screenshot({ path: `${OUT}/settings-dark-${w}x${h}.png` });
      await page.click('#cfgDone');
      assert(errors.length === 0, `${w}×${h} ${scheme}: no console errors ` + errors.join(' | '));
      await ctx.close();
    }
    // 3. cover 390×520 with sample content
    {
      const { ctx, page } = await open(browser, URL, { ...mobile, viewport: { width: 390, height: 520 }, colorScheme: 'light' });
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); scrollTo(0, 0); }); await sleep(200);
      await page.screenshot({ path: OUT + '/cover-390x520.png' });
      await ctx.close();
    }
    console.log('all checks passed');
  } finally { await browser.close(); srv.close(); }
})().catch(e => { console.error(e.message || e); process.exit(1); });
