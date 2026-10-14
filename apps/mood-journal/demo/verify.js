// Verify mood-journal: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = __dirname;
const PREVIEW = path.join(OUT, 'preview.html');
fs.writeFileSync(PREVIEW, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREVIEW;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXED = new Date('2026-10-13T21:30:00+08:00');

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
    const minCell = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.cell:not(.blank)')].map(c => Math.min(c.getBoundingClientRect().width, c.getBoundingClientRect().height))));
    ok(minCell >= 44 || (vp.width >= 800 && minCell >= 40), `${name} calendar cell >= 44px (${minCell.toFixed(1)})`);
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: name === '390x844' });
    if (name === '390x844') {
      await page.click('.cell[data-ds="2026-10-12"]');
      await page.locator('#drawer').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, '390x844-drawer.png') });
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
  page.on('dialog', d => { errs.push('native dialog: ' + d.message()); d.dismiss(); });
  await page.goto(URL);

  // ---- algorithms ----
  const r = await page.evaluate(() => {
    const { movingAvg, tagCorr } = __mj;
    const E = (date, mood, tags = []) => ({ date, mood, tags, note: '' });
    const es = { '2026-10-01': E('2026-10-01', 2), '2026-10-02': E('2026-10-02', 3), '2026-10-03': E('2026-10-03', 4), '2026-10-09': E('2026-10-09', 5) };
    const ma = movingAvg(es, ['2026-10-02', '2026-10-03', '2026-10-07', '2026-10-08', '2026-10-09']);
    const ce = { a: E('2026-09-01', 5, ['A']), b: E('2026-09-02', 5, ['A']), c: E('2026-09-03', 4, ['A', 'B']), d: E('2026-09-04', 1, ['B', 'C']), e: E('2026-09-05', 2, ['C']), f: E('2026-09-06', 1, ['C']), g: E('2026-09-07', 3, []) };
    const c = tagCorr(ce, [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }]);
    return { ma, avg: c.avg, pos: c.pos.map(x => [x.name, +x.avg.toFixed(3), +x.diff.toFixed(3)]), neg: c.neg.map(x => [x.name, +x.avg.toFixed(3), +x.diff.toFixed(3)]) };
  });
  ok(r.ma[0] === null, 'MA needs >= 3 entries in window (10-02 -> none)');
  ok(r.ma[1] === 3, `MA 10-03 = (2+3+4)/3 = 3 (${r.ma[1]})`);
  ok(r.ma[2] === 3, `MA 10-07 window 10-01..07 = 3 (${r.ma[2]})`);
  ok(r.ma[3] === null, `MA 10-08 window 10-02..08 has 2 -> none (${r.ma[3]})`);
  ok(r.ma[4] === null, `MA 10-09 window 10-03..09 has 2 -> none (${r.ma[4]})`);
  // overall avg = 21/7 = 3 ; A: 14/3=4.667 (+1.667) ; C: 4/3=1.333 (-1.667) ; B has 2 samples -> excluded
  ok(Math.abs(r.avg - 3) < 1e-9, `overall avg 3 (${r.avg})`);
  ok(r.pos.length === 1 && r.pos[0][0] === 'A' && r.pos[0][2] === 1.667, `positive tag A +1.667 (${JSON.stringify(r.pos)})`);
  ok(r.neg.length === 1 && r.neg[0][0] === 'C' && r.neg[0][2] === -1.667, `negative tag C −1.667, B (2 samples) excluded (${JSON.stringify(r.neg)})`);

  // ---- sample + stats ----
  ok(await page.$('#sampleBanner') !== null, 'sample banner visible');
  const avgTxt = await page.textContent('#avgVal');
  const avgExp = await page.evaluate(() => { const es = Object.values(__mj.data.entries).filter(e => e.date.startsWith('2026-10')); return (es.reduce((a, e) => a + e.mood, 0) / es.length).toFixed(1); });
  ok(avgTxt === avgExp, `month avg displayed ${avgTxt} = ${avgExp}`);
  ok(await page.$$eval('#corr li[data-tag]', l => l.length) > 0, 'tag correlation list shown for sample');

  // ---- save flow ----
  ok(await page.isDisabled('#saveBtn'), 'save disabled without mood');
  await page.click('#mood-4');
  ok(!(await page.isDisabled('#saveBtn')), 'save enabled after picking mood');
  await page.click('#mood-4');
  ok(await page.isDisabled('#saveBtn'), 'tapping same mood again unselects');
  await page.click('#mood-2');
  await page.click('#tag-t1');
  await page.fill('#note', '<script>alert(1)</script>');
  await page.click('#saveBtn');
  ok(await page.$('#sampleBanner') === null, 'sample cleared on first save');
  await page.click('#mood-5');
  await page.fill('#note', '第二次：<b>跑步</b>很開心');
  await page.click('#saveBtn');
  ok((await page.textContent('#saveMsg')).includes('已更新今日紀錄'), 'second save shows 已更新今日紀錄');
  const cnt = await page.evaluate(() => Object.keys(__mj.data.entries).length);
  const today = await page.evaluate(() => __mj.data.entries['2026-10-13']);
  ok(cnt === 1 && today.mood === 5 && today.note.startsWith('第二次'), `one entry, last content kept (${cnt}, ${today.mood})`);
  // note length cap
  await page.fill('#note', 'あ'.repeat(300));
  ok((await page.inputValue('#note')).length === 280, 'note capped at 280');
  // past date
  await page.click('.cell[data-ds="2026-10-10"]');
  await page.click('#editDay');
  ok((await page.textContent('#qTitle')).includes('10 月 10 日'), 'back-fill past date form');
  await page.click('#mood-1'); await page.fill('#note', '補寫：下雨天'); await page.click('#saveBtn');
  ok(await page.evaluate(() => __mj.data.entries['2026-10-10'].mood) === 1, 'past entry saved');
  // XSS check via a dedicated entry
  await page.click('.cell[data-ds="2026-10-11"]'); await page.click('#editDay');
  await page.click('#mood-3'); await page.fill('#note', '<script>alert(1)</script>'); await page.click('#saveBtn');
  await page.click('.cell[data-ds="2026-10-11"]');
  const nt = await page.textContent('#drawer .nt2');
  ok(nt === '<script>alert(1)</script>' && await page.$('#drawer script') === null, 'note with <script> shown as plain text');
  // future date blocked
  await page.click('.cell[data-ds="2026-10-20"]', { force: true });
  ok(await page.$('.cell.sel[data-ds="2026-10-20"]') === null, 'future date not selectable');
  // calendar colour
  const bg = await page.$eval('.cell[data-ds="2026-10-10"]', e => e.style.background);
  ok(bg.includes('--m1'), 'calendar cell coloured by mood 1');
  // search highlight
  await page.fill('#search', '跑步');
  const mk = await page.$$eval('#results mark', m => m.map(x => x.textContent));
  ok(mk.length === 1 && mk[0] === '跑步', `search highlights keyword (${mk})`);
  await page.screenshot({ path: path.join(OUT, '390x844-search.png') });
  // long-press delete
  await page.fill('#search', '');
  await page.locator('.cell[data-ds="2026-10-10"]').scrollIntoViewIfNeeded();
  const box = await page.locator('.cell[data-ds="2026-10-10"]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  ok(await page.isVisible('#cfmDlg'), 'long press opens delete confirm');
  await page.click('#cfmYes');
  ok(await page.evaluate(() => !__mj.data.entries['2026-10-10']), 'entry deleted after confirm');
  // PIN lock
  await page.click('#openSet'); await page.fill('#pinIn', '1234'); await page.click('#pinSet');
  await page.click('#setDlg [data-close]');
  await page.reload();
  ok(await page.isVisible('#lock'), 'lock screen after reload with PIN');
  await page.fill('#unlockIn', '0000'); await page.click('#unlockBtn');
  ok((await page.textContent('#unlockErr')).includes('不正確'), 'wrong PIN rejected');
  await page.fill('#unlockIn', '1234'); await page.click('#unlockBtn');
  ok(!(await page.isVisible('#lock')), 'correct PIN unlocks');
  ok(await page.evaluate(() => Object.keys(__mj.data.entries).length) === 2, 'data intact after reload');
  ok(errs.length === 0, 'flow no console errors ' + errs.join(' | '));
  await browser.close();
  fs.unlinkSync(PREVIEW);
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
