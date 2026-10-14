// Verify shift-calendar: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = __dirname;
const PREVIEW = path.join(OUT, 'preview.html');
fs.writeFileSync(PREVIEW, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREVIEW;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXED = new Date('2026-10-13T10:00:00+08:00');

(async () => {
  const browser = await chromium.launch();
  const opts = (vp, mobile, dark) => ({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: dark ? 'dark' : 'light', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
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
    await page.goto(URL); await page.waitForTimeout(250);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[1] === vp.width, `${name} innerWidth = ${vp.width} (${sw[1]})`);
    ok(sw[0] <= sw[1], `${name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    const minCell = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.cell')].map(c => c.getBoundingClientRect().height)));
    ok(minCell >= 44, `${name} cell height >= 44 (${minCell})`);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: name === '390x844' });
    if (name === '390x844') {
      await page.click('.cell[data-ds="2026-10-15"]');
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(OUT, '390x844-day.png') });
      await page.click('#dayDlg [data-close]');
      await page.click('#openSettings');
      await page.screenshot({ path: path.join(OUT, '390x844-settings.png') });
      await page.click('#tab-p2'); await page.click('#p2-on'); await page.click('#setSave');
      await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUT, '390x844-two.png') });
    }
    ok(errs.length === 0, `${name} no console errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // ---- logic & flows ----
  const ctx = await browser.newContext(opts({ width: 390, height: 844 }, true));
  const page = await ctx.newPage();
  await page.clock.install({ time: FIXED });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  const r = await page.evaluate(() => {
    const { ruleShift, hoursOf } = __sc;
    const rules = [{ from: '2026-10-01', type: 'cycle', sequence: ['e', 'e', 'l', 'l', 'o', 'o', 'o', 'o'] }];
    const seg = [...rules, { from: '2026-11-01', type: 'cycle', sequence: ['n', 'o'] }];
    const wk = [{ from: '2026-10-01', type: 'weekly', sequence: ['e', 'e', 'e', 'e', 'e', 'o', 'o'] }];
    return {
      d1009: ruleShift(rules, '2026-10-09'), d1007: ruleShift(rules, '2026-10-07'), d1001: ruleShift(rules, '2026-10-01'),
      d0930: ruleShift(rules, '2026-09-30'), d0924: ruleShift(rules, '2026-09-24'), d0922: ruleShift(rules, '2026-09-22'), d0101: ruleShift(rules, '2025-01-01'),
      seg1031: ruleShift(seg, '2026-10-31'), seg1101: ruleShift(seg, '2026-11-01'), seg1102: ruleShift(seg, '2026-11-02'),
      wkSat: ruleShift(wk, '2026-10-17'), wkMon: ruleShift(wk, '2026-10-12'), wkSun: ruleShift(wk, '2026-10-18'),
      night: hoursOf({ start: '22:00', end: '06:00', brk: 0 }), late: hoursOf({ start: '19:00', end: '07:00', brk: 1 }), rest: hoursOf({ start: '', end: '' }),
    };
  });
  ok(r.d1009 === 'e' && r.d1007 === 'o' && r.d1001 === 'e', `10-09 早, 10-07 休, 10-01 早 (${r.d1009},${r.d1007},${r.d1001})`);
  // 2025-01-01 is 638 days before 2026-10-01; mod(-638, 8) = 2 -> 'l'
  ok(r.d0930 === 'o' && r.d0924 === 'e' && r.d0922 === 'o' && r.d0101 === 'l', `backward: 09-30 休, 09-24 早, 09-22 休, 2025-01-01 晚 (${r.d0930},${r.d0924},${r.d0922},${r.d0101})`);
  ok(r.seg1031 === 'o' && r.seg1101 === 'n' && r.seg1102 === 'o', `multi-segment: 10-31 old rule 休, 11-01 夜, 11-02 休 (${r.seg1031},${r.seg1101},${r.seg1102})`);
  ok(r.wkSat === 'o' && r.wkMon === 'e' && r.wkSun === 'o', `weekly rule Mon 早 / Sat,Sun 休`);
  ok(r.night === 8 && r.late === 11 && r.rest === 0, `cross-night 22–06 = 8h, 19–07 minus 1h = 11h, rest 0 (${r.night},${r.late},${r.rest})`);

  // sample month: October 2026 with sample rule + override on 10-15 (中, 8h)
  const tot = await page.textContent('#totHours');
  // Oct 2026 cycle from 10-01: days 1..31 idx 0..30. e at idx%8 in {0,1}, l in {2,3}. Count e: idx 0,1,8,9,16,17,24,25 = 8; l: 2,3,10,11,18,19,26,27 = 8.
  // 10-15 is idx 14 -> 休 overridden to 中 (8h). Hours = 8*8 + 8*11 + 8 = 160.
  ok(tot.trim() === '160 h', `October total hours 160 h (${tot})`);
  ok(await page.$eval('.cell[data-ds="2026-10-09"] .chip', e => e.textContent) === '早', 'calendar cell 10-09 shows 早');
  ok(await page.$eval('.cell[data-ds="2026-10-07"] .chip', e => e.textContent) === '休', 'calendar cell 10-07 shows 休');
  ok(!!(await page.$('.cell[data-ds="2026-10-15"] .ov')), 'override marker on 10-15');

  // manual override persists after reload, then restore
  await page.click('.cell[data-ds="2026-10-20"]');
  await page.click('#pick-n');
  await page.fill('#dayNote', '代班');
  await page.click('#daySave');
  await page.reload();
  ok(await page.$eval('.cell[data-ds="2026-10-20"] .chip', e => e.textContent) === '夜', 'override 10-20 夜 persists after reload');
  await page.click('.cell[data-ds="2026-10-20"]');
  await page.click('#dayRestore');
  const back = await page.$eval('.cell[data-ds="2026-10-20"] .chip', e => e.textContent);
  ok(back === '晚', `restore rule shift on 10-20 -> 晚 (idx 19 mod 8 = 3) (${back})`);
  // month nav + backward month
  await page.click('#prev'); await page.click('#prev');
  ok((await page.textContent('#ym')).includes('8 月'), 'navigate to August');
  ok(await page.$eval('.cell[data-ds="2026-08-31"] .chip', e => e.textContent) === '早', 'August 31 (31 days before start, mod 8 = 1) back-computed 早');
  await page.click('#today');
  // settings: apply template 做二休二, empty sequence rejected
  await page.click('#openSettings');
  await page.click('#seq-clear');
  await page.click('#setSave');
  ok((await page.textContent('#setErr')).includes('空'), 'empty sequence cannot be saved');
  await page.click('#tpl-1');
  await page.click('#setSave');
  ok(await page.$eval('.cell[data-ds="2026-10-03"] .chip', e => e.textContent) === '休', 'template 做二休二: 10-03 休');
  // export fallback (no downloads capability) shows image
  await page.click('#exportBtn');
  await page.waitForSelector('#expDlg[open]');
  const iw = await page.$eval('#expImg', i => i.naturalWidth);
  ok(iw === 1080, `export PNG width 1080 (${iw})`);
  await page.screenshot({ path: path.join(OUT, '390x844-export.png') });
  ok(errs.length === 0, 'flow no console errors ' + errs.join(' | '));
  await browser.close();
  fs.unlinkSync(PREVIEW);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
