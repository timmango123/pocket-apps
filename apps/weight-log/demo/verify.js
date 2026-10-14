// Verify weight-log: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = __dirname;
const PREVIEW = path.join(OUT, 'preview.html');
fs.writeFileSync(PREVIEW, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREVIEW;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXED = new Date('2026-10-13T07:30:00+08:00');

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
    const st = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.step')].map(b => b.getBoundingClientRect().height)));
    ok(st >= 48, `${name} ±0.1 buttons >= 48px (${st})`);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: name === '390x844' });
    if (name === '390x844') {
      const box = await page.locator('#chart').boundingBox();
      await page.mouse.move(box.x + box.width * .6, box.y + 100); await page.mouse.down();
      await page.mouse.move(box.x + box.width * .7, box.y + 120);
      await page.screenshot({ path: path.join(OUT, '390x844-cursor.png'), clip: { x: 0, y: box.y - 60, width: 390, height: box.height + 100 } });
      await page.mouse.up();
      await page.click('#openSet');
      await page.screenshot({ path: path.join(OUT, '390x844-settings.png') });
    }
    ok(errs.length === 0, `${name} no console errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  const ctx = await browser.newContext(opts({ width: 390, height: 844 }, true));
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await page.clock.install({ time: FIXED });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('dialog', d => { errs.push('native dialog'); d.dismiss(); });
  await page.goto(URL);

  // ---- algorithms (fixed 10 entries) ----
  const r = await page.evaluate(() => {
    const { insertEntry, movingAvg, regression, predict, bmiOf, bmiClass, parseInput, niceStep } = __wt;
    const L = [];
    [['2026-10-05', 794], ['2026-10-01', 800], ['2026-10-03', 802], ['2026-10-02', 796], ['2026-10-06', 790], ['2026-10-07', 798], ['2026-10-09', 788], ['2026-10-08', 792], ['2026-10-10', 790], ['2026-10-20', 780], ['2026-10-06', 790]]
      .forEach(([date, w10]) => insertEntry(L, { date, w10 }));
    const sma = movingAvg(L, 'sma').map(v => v == null ? null : +v.toFixed(4));
    const ema = movingAvg(L, 'ema').slice(0, 3).map(v => +v.toFixed(4));
    const lin = []; for (let i = 0; i < 20; i++) lin.push({ date: new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10), w10: 800 - i });
    const reg = regression(lin, movingAvg(lin, 'sma'));
    const p1 = predict(reg, 75, reg.y), p2 = predict(reg, 85, reg.y);
    const flat = Array.from({ length: 14 }, (_, i) => ({ date: new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10), w10: 700 }));
    const rf = regression(flat, movingAvg(flat, 'sma'));
    return { order: L.map(e => e.date), n: L.length, sma, ema, perWeek: +reg.perWeek.toFixed(4), y: +reg.y.toFixed(4), p1, p2: p2.msg, pf: predict(rf, 65, rf.y).msg,
      bmi: +bmiOf(70, 172).toFixed(1), c1: bmiClass(bmiOf(70, 172)), c2: bmiClass(24), c3: bmiClass(18.4), c4: bmiClass(27),
      in1: parseInput('19.9').err, in2: parseInput('300.1').err, in3: parseInput('20.0').w10, in4: parseInput('70,5').w10, lb1: parseInput('43', 'lb').err, lb2: parseInput('154.3', 'lb').w10,
      ns: [niceStep(2.5), niceStep(4), niceStep(9), niceStep(22)] };
  });
  ok(r.n === 10 && r.order.join() === [...r.order].sort().join(), `binary insert keeps order, same-day overwrite (n=${r.n})`);
  const expSma = [null, null, 79.9333, 79.8, 79.64, 79.6667, 79.5333, 79.4, 79.2, null];
  ok(JSON.stringify(r.sma) === JSON.stringify(expSma), `7-day SMA matches hand calc ${JSON.stringify(r.sma)}`);
  ok(JSON.stringify(r.ema) === JSON.stringify([80, 79.96, 79.984]), `EMA α=0.1: 80, 79.96, 79.984 (${r.ema})`);
  ok(r.perWeek === -0.7 && r.y === 78.4, `regression on linear −0.1/day: −0.7 kg/週, MA 78.4 (${r.perWeek}, ${r.y})`);
  ok(r.p1.ok && r.p1.days === 34 && r.p1.date === '2026-11-16', `goal 75 reached in 34 days -> 2026-11-16 (${JSON.stringify(r.p1)})`);
  ok(r.p2 === '趨勢持平，無法預估', `goal in opposite direction -> 無法預估 (${r.p2})`);
  ok(r.pf === '趨勢持平，無法預估', `flat trend -> 無法預估 (${r.pf})`);
  ok(r.bmi === 23.7 && r.c1 === '正常' && r.c2 === '過重' && r.c3 === '過輕' && r.c4 === '肥胖', `BMI 70kg/172cm = 23.7 正常; 24 過重; 18.4 過輕; 27 肥胖`);
  ok(r.in1 && r.in2 && r.in3 === 200 && r.in4 === 705 && r.lb1 && r.lb2 === 700, 'input validation: 19.9/300.1 rejected, 20.0 ok, "70,5" ok, 43 lb rejected, 154.3 lb = 70.0 kg');
  ok(JSON.stringify(r.ns) === '[0.5,1,2,5]', `y tick step gives 4–6 ticks (${r.ns})`);

  // ---- UI flow ----
  ok(await page.$('#sampleBanner') !== null, 'sample banner shown');
  ok((await page.textContent('#eta')).length > 0, 'trend/ETA text present with sample');
  await page.fill('#wIn', '19.9');
  ok(await page.isDisabled('#recBtn') && (await page.textContent('#why')).includes('20.0～300.0'), '19.9 disables record with range hint');
  await page.fill('#wIn', '300.1');
  ok(await page.isDisabled('#recBtn'), '300.1 disables record');
  await page.fill('#wIn', '70.0'); await page.click('#plus'); await page.click('#plus'); await page.click('#minus');
  ok(await page.inputValue('#wIn') === '70.1', '±0.1 nudges: 70.0 +0.1 +0.1 −0.1 = 70.1');
  await page.click('#recBtn');
  ok(await page.$('#sampleBanner') === null, 'sample cleared on first record');
  ok((await page.textContent('#curVal')).startsWith('70.1'), 'latest shows 70.1');
  // past entries + 5 kg jump confirmation
  await page.fill('#dIn', '2026-10-12'); await page.fill('#wIn', '76.0'); await page.click('#recBtn');
  ok(await page.isVisible('#cfmDlg'), 'diff > 5 kg asks for confirmation (in-page dialog)');
  await page.click('#cfmDlg [data-close]');
  ok(await page.evaluate(() => __wt.data.entries.length) === 1, 'cancelled entry not saved');
  await page.fill('#wIn', '70.6'); await page.click('#recBtn');
  await page.fill('#dIn', '2026-10-11'); await page.fill('#wIn', '70.9'); await page.click('#recBtn');
  ok(await page.evaluate(() => __wt.data.entries.map(e => e.date).join()) === '2026-10-11,2026-10-12,2026-10-13', 'entries sorted by date');
  // overwrite same day
  await page.fill('#dIn', '2026-10-13'); await page.fill('#wIn', '70.3');
  ok((await page.textContent('#why')).includes('覆寫'), 'same-day overwrite hint');
  await page.click('#recBtn');
  ok(await page.evaluate(() => __wt.data.entries.length) === 3 && (await page.textContent('#curVal')).startsWith('70.3'), 'same day overwritten (3 entries, latest 70.3)');
  // SMA with 3 entries = (70.9+70.6+70.3)/3 = 70.6 ; BMI at 172 = 23.8
  ok((await page.textContent('#bmiVal')).startsWith('23.8 正常'), `BMI shown: ${await page.textContent('#bmiVal')}`);
  ok((await page.textContent('#remainVal')).startsWith('-') === false && (await page.textContent('#remainVal')).includes('kg'), `remaining shown ${await page.textContent('#remainVal')}`);
  // delete + undo
  await page.click('#list li:first-child .del');
  ok(await page.evaluate(() => __wt.data.entries.length) === 2, 'delete removes entry');
  await page.click('#undoBtn');
  ok(await page.evaluate(() => __wt.data.entries.length) === 3, 'undo restores entry');
  // lb
  await page.click('#openSet'); await page.click('#unit-lb'); await page.click('#setSave');
  ok((await page.textContent('#curVal')).startsWith('155.0'), `70.3 kg = 155.0 lb (${await page.textContent('#curVal')})`);
  await page.click('#openSet'); await page.click('#unit-kg'); await page.click('#setSave');
  ok((await page.textContent('#curVal')).startsWith('70.3'), 'back to kg keeps 70.3');
  // canvas touch-action
  ok(await page.$eval('#chart', c => getComputedStyle(c).touchAction) === 'none' && await page.evaluate(() => getComputedStyle(document.body).touchAction) !== 'none', 'touch-action none only on canvas');
  // CSV import (semicolon, comma decimals, header)
  const csv = path.join(OUT, '_import.csv');
  fs.writeFileSync(csv, 'Datum;Gewicht\n2026/10/01;71,8\n2026-10-02;71,5\nbad;line\n2026-10-03;19\n');
  await page.click('#openSet'); await page.setInputFiles('#impFile', csv);
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => __wt.data.entries.length) === 5, 'CSV import adds 2 valid rows, skips bad ones');
  fs.unlinkSync(csv);
  // persistence
  await page.reload();
  ok(await page.evaluate(() => __wt.data.entries.length) === 5, 'data persists after reload');
  // performance: 1100 entries
  const ms = await page.evaluate(() => {
    const L = []; for (let i = 0; i < 1100; i++) L.push({ date: new Date(Date.UTC(2023, 9, 10 + i)).toISOString().slice(0, 10), w10: 800 + Math.round(Math.sin(i / 20) * 30) });
    __wt.data = { entries: L, settings: __wt.data.settings };
    document.getElementById('rall').click();
    const t = []; for (let k = 0; k < 5; k++) t.push(__wt.draw()); return Math.max(...t);
  });
  ok(ms < 50, `draw 1100 entries in ${ms.toFixed(1)} ms (< 50)`);
  await page.screenshot({ path: path.join(OUT, '390x844-3years.png') });
  ok(errs.length === 0, 'flow no console errors ' + errs.join(' | '));
  await browser.close();
  fs.unlinkSync(PREVIEW);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
