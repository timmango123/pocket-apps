// Verify water-log: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = __dirname;
const PREVIEW = path.join(OUT, 'preview.html');
fs.writeFileSync(PREVIEW, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREVIEW;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXED = new Date('2026-10-13T14:30:00+08:00');

(async () => {
  const browser = await chromium.launch();
  const opts = (vp, mobile, dark) => ({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', timezoneId: 'Asia/Taipei', locale: 'zh-TW', reducedMotion: 'reduce' });
  const shots = [
    ['390x844', { width: 390, height: 844 }, true],
    ['360x780', { width: 360, height: 780 }, true],
    ['844x390', { width: 844, height: 390 }, true],
    ['390x844-dark', { width: 390, height: 844 }, true, true],
    ['1280x800', { width: 1280, height: 800 }, false],
  ];
  for (const [name, vp, mobile, dark] of shots) {
    const ctx = await browser.newContext(opts(vp, mobile, dark));
    const page = await ctx.newPage();
    await page.clock.setFixedTime(FIXED);
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(700);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[1] === vp.width, `${name} innerWidth = ${vp.width} (${sw[1]})`);
    ok(sw[0] <= sw[1], `${name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    const qb = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.qb')].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
    ok(qb >= 58, `${name} quick buttons size (${qb.toFixed(1)})`);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: name === '390x844' });
    if (name === '390x844') {
      await page.click('#openSet');
      await page.screenshot({ path: path.join(OUT, '390x844-settings.png') });
    }
    ok(errs.length === 0, `${name} no console errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // ---- flows ----
  const ctx = await browser.newContext(opts({ width: 390, height: 844 }, true));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await page.clock.install({ time: FIXED });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  ok(await page.$('#sampleBanner') !== null, 'sample data banner shown on first open');
  const sampleTot = await page.evaluate(() => __wl.total(new Date().toLocaleDateString('sv-SE')));
  ok(sampleTot === 850, `sample today total 850 (${sampleTot})`);
  // first add clears sample
  await page.click('#q1'); // 250
  await page.click('#q1');
  await page.click('#q3'); // 500
  let amt = await page.textContent('#amt');
  ok(amt.startsWith('1,000 '), `after 250+250+500 = 1,000 ml (${amt})`);
  ok(await page.$('#sampleBanner') === null, 'sample cleared on first add');
  await page.waitForTimeout(700);
  const ty = await page.evaluate(() => getComputedStyle(document.getElementById('waterG')).transform);
  // levelY(1000) = 228 - 0.5*204 = 126
  ok(/,\s*126\)$/.test(ty), `water level at y=126 for 50% (${ty})`);
  // undo
  await page.click('#undoBtn');
  amt = await page.textContent('#amt');
  ok(amt.startsWith('500 '), `undo last add -> 500 (${amt})`);
  // custom: rejects 5, accepts 1200
  await page.click('#qCustom'); await page.fill('#customIn', '5'); await page.click('#customAdd');
  ok((await page.textContent('#addErr')).includes('10'), 'custom 5 ml rejected');
  await page.fill('#customIn', '2001'); await page.click('#customAdd');
  ok((await page.textContent('#addErr')).includes('2,000'), 'custom 2001 ml rejected');
  await page.fill('#customIn', '1800'); await page.click('#customAdd');
  amt = await page.textContent('#amt');
  ok(amt.startsWith('2,300 '), `500 + 1800 = 2,300 (${amt})`);
  const over = await page.textContent('#over');
  ok(over.includes('+300 ml') && await page.isVisible('#over'), `over goal label: ${over}`);
  const tyFull = await page.evaluate(() => __wl.levelY(2300));
  ok(tyFull === 24, `level clamped at cup top (24) when over (${tyFull})`);
  await page.waitForTimeout(700); await page.screenshot({ path: path.join(OUT, '390x844-over.png') });
  // oz conversion round trip
  await page.click('#openSet'); await page.click('#unit-oz');
  ok(await page.inputValue('#goalIn') === '68', 'goal 2000 ml shows 68 oz');
  await page.click('#setSave');
  amt = await page.textContent('#amt');
  ok(amt.startsWith('78 ') && amt.includes('/ 68 oz'), `2,300 ml = 78 oz / 68 oz (${amt})`);
  await page.click('#openSet'); await page.click('#unit-ml'); await page.click('#setSave');
  const goal = await page.evaluate(() => __wl.data.settings.goal);
  ok(goal === 2000, `switch back to ml keeps goal 2000 (${goal})`);
  // weight-based goal: 65 kg -> 1950 ; 63.3 -> 1899 -> 1900
  await page.click('#openSet'); await page.fill('#kgIn', '65'); await page.click('#kgApply');
  ok(await page.inputValue('#goalIn') === '1950', '65 kg -> 1950 ml');
  await page.fill('#kgIn', '63.3'); await page.click('#kgApply');
  ok(await page.inputValue('#goalIn') === '1900', '63.3 kg -> 1900 ml');
  await page.fill('#kgIn', '250'); await page.click('#kgApply');
  ok(await page.inputValue('#goalIn') === '6000', '250 kg capped to 6000 ml');
  await page.click('#setDlg [data-close]');
  // persistence
  await page.reload();
  amt = await page.textContent('#amt');
  ok(amt.startsWith('2,300 '), `reload keeps 2,300 (${amt})`);
  // delete via button
  await page.click('#log li .del');
  amt = await page.textContent('#amt');
  ok(amt.startsWith('500 '), `delete newest entry -> 500 (${amt})`);
  // reminder: enable, every 30, window 09:00-21:00; last drink at 14:30 -> after 31 min banner
  await page.click('#openSet'); await page.check('#remOn'); await page.selectOption('#remEvery', '30'); await page.click('#setSave');
  ok(await page.$('#remindBanner') === null, 'no reminder right after drinking');
  await page.clock.fastForward('31:00');
  await page.waitForTimeout(100);
  ok(await page.$('#remindBanner') !== null, 'in-page reminder banner after 31 min');
  await page.screenshot({ path: path.join(OUT, '390x844-remind.png') });
  await page.click('#remindBanner button');
  ok(await page.$('#remindBanner') === null, 'banner cleared after logging a drink');
  ok(errs.length === 0, 'flow no console errors ' + errs.join(' | '));
  await browser.close();
  fs.unlinkSync(PREVIEW);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
