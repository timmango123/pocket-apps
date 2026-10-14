// Verify habit-grid: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const OUT = __dirname;
// Serve wrapped like the Artifact host (doctype + viewport meta).
const URL = 'https://artifact.local/index.html';
const SRC = () => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const route = ctx => ctx.route('https://artifact.local/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SRC() }));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const FIXED = new Date('2026-10-12T21:00:00+08:00'); // a Monday evening in Taipei

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
    const ctx = await browser.newContext(opts(vp, mobile, dark)); await route(ctx);
    const page = await ctx.newPage();
    await page.clock.setFixedTime(FIXED);
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    await page.screenshot({ path: path.join(OUT, name + '.png') });
    if (name === '390x844') {
      await page.click('[data-body]'); // select first habit
      await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
      await page.screenshot({ path: path.join(OUT, '390x844-heatmap.png') });
      await page.click('#add-btn');
      await page.screenshot({ path: path.join(OUT, '390x844-dialog.png') });
      await page.keyboard.press('Escape');
      await page.click('#settings-btn');
      await page.screenshot({ path: path.join(OUT, '390x844-settings.png') });
    }
    ok(errs.length === 0, `${name} no console errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // ---- algorithm checks ----
  const ctx = await browser.newContext(opts({ width: 390, height: 844 }, true)); await route(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://artifact.local' });
  const page = await ctx.newPage();
  await page.clock.install({ time: FIXED });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  const r = await page.evaluate(() => {
    const { streakDaily: sd, streakWeekly: sw, longest, monthStats } = __hg; const S = a => new Set(a);
    return {
      todayUnchecked: sd(S(['2026-10-09', '2026-10-10', '2026-10-11']), '2026-10-12'),
      todayChecked: sd(S(['2026-10-10', '2026-10-11', '2026-10-12']), '2026-10-12'),
      gapMiddle: sd(S(['2026-10-08', '2026-10-10', '2026-10-11', '2026-10-12']), '2026-10-12'),
      yesterdayMissing: sd(S(['2026-10-09', '2026-10-10']), '2026-10-12'),
      monthBoundary: sd(S(['2026-09-29', '2026-09-30', '2026-10-01']), '2026-10-01'),
      longest: longest(['2026-09-05', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-06']),
      longestYear: longest(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']),
      // target 3/week; week of 10-12 (Mon) has 1 so far -> not yet, doesn't break; weeks 10-05 & 09-28 achieved, 09-21 only 2
      weekly: sw(S(['2026-10-12', '2026-10-05', '2026-10-07', '2026-10-09', '2026-09-28', '2026-09-30', '2026-10-02', '2026-09-22', '2026-09-24']), 3, '2026-10-12', '2026-08-01'),
      weeklyCur: sw(S(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-05', '2026-10-07', '2026-10-09']), 3, '2026-10-14', '2026-08-01'),
      month: monthStats({ createdAt: '2026-10-05' }, S(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-09-30']), '2026-10-12'),
    };
  });
  ok(r.todayUnchecked === 3, `today not yet checked keeps streak: 3 (${r.todayUnchecked})`);
  ok(r.todayChecked === 3, `today checked: 3 (${r.todayChecked})`);
  ok(r.gapMiddle === 3, `gap on 10-09 stops at 3 (${r.gapMiddle})`);
  ok(r.yesterdayMissing === 0, `yesterday missing -> 0 (${r.yesterdayMissing})`);
  ok(r.monthBoundary === 3, `streak across month boundary: 3 (${r.monthBoundary})`);
  ok(r.longest === 3, `longest of 1,2,3,5,6 Sep = 3 (${r.longest})`);
  ok(r.longestYear === 4, `longest across year end = 4 (${r.longestYear})`);
  ok(r.weekly === 2, `weekly target 3: 2 weeks (${r.weekly})`);
  ok(r.weeklyCur === 2, `weekly incl. current achieved week: 2 (${r.weeklyCur})`);
  ok(r.month.done === 4 && r.month.den === 8, `month stats created 10-05: 4/8 (${r.month.done}/${r.month.den})`);

  // ---- UI flow on sample data ----
  ok(!(await page.locator('#sample-banner').isHidden()), 'sample banner visible');
  ok(await page.locator('#today-label').innerText() === '10/12 週一', 'header date 10/12 週一');
  const water = page.locator('.card', { hasText: '喝水' });
  ok((await water.locator('small').innerText()).includes('連續 12 天'), 'sample water streak 12 while today unchecked');
  await water.locator('[data-check]').click();
  ok((await water.locator('small').innerText()).includes('連續 13 天'), 'after check-in: 13 days');
  ok(await water.locator('[data-check]').getAttribute('aria-pressed') === 'true', 'check button pressed');
  await water.locator('[data-check]').click();
  ok((await water.locator('small').innerText()).includes('連續 12 天'), 'uncheck back to 12');
  ok((await page.locator('.card', { hasText: '運動' }).locator('small').innerText()).includes('週達標'), 'weekly habit shows 週達標');

  // select water, back-fill day 13 ago (10-12 minus 13 = 09-29) -> streak jumps
  await water.locator('[data-body]').click();
  ok((await page.locator('#hm-title').innerText()).includes('喝水'), 'heatmap shows selected habit');
  const cells = await page.locator('#hgrid .c').count();
  ok(cells === 22 * 7, `mobile heatmap 22 weeks x 7 = ${cells}`);
  ok(await page.locator('#hgrid .c.fut').count() === 6, 'future cells after Monday = 6');
  ok(await page.locator('#hgrid .c[data-k="2026-10-13"]').isDisabled(), 'future cell disabled');
  await page.click('#hgrid .c[data-k="2026-09-29"]');
  ok((await page.locator('#hint').innerText()).includes('9/29（週二）已補打卡'), 'back-fill hint');
  const s = await water.locator('small').innerText();
  ok(/連續 \d+ 天/.test(s) && !s.includes('連續 12 天'), `streak extended after back-fill (${s})`);
  await page.click('#toast-undo');
  ok((await water.locator('small').innerText()).includes('連續 12 天'), 'undo back-fill');

  // add habit
  await page.click('#add-btn');
  await page.click('#edit-save');
  ok((await page.locator('#edit-msg').innerText()).includes('請輸入名稱'), 'empty name rejected');
  await page.fill('#habit-name', '早睡');
  await page.click('[data-e="😴"]');
  await page.click('label.sw:has(#color-4)');
  await page.check('#target-5');
  await page.click('#edit-save');
  const newCard = page.locator('.card', { hasText: '早睡' });
  ok(await newCard.count() === 1, 'new habit card added');
  ok((await newCard.locator('small').innerText()).includes('本週 0/5'), 'new weekly habit 本週 0/5');
  ok((await page.locator('#stats').innerText()).replace(/\s+/g, ' ').includes('本月完成 0/1'), 'new habit month stats 0/1 (created today)');
  ok(await page.locator('#hgrid .c.pre').count() > 100, 'cells before creation shown as pre');
  await newCard.locator('[data-check]').click();
  await page.reload();
  ok((await page.locator('.card', { hasText: '早睡' }).locator('small').innerText()).includes('本週 1/5'), 'persisted after reload');

  // reorder with keyboard on handle: move 早睡 (last) up
  await page.locator('.card', { hasText: '早睡' }).locator('[data-handle]').focus();
  await page.keyboard.press('ArrowUp');
  const order = await page.$$eval('#list .card b', bs => bs.map(b => b.textContent));
  ok(order[3] === '早睡', 'keyboard reorder moved habit up ' + order.join(','));
  // pointer drag: drag first card's handle down past second
  const h0 = page.locator('#list .card').nth(0).locator('[data-handle]');
  const box = await h0.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2, box.y + 130, { steps: 5 });
  await page.mouse.up();
  const order2 = await page.$$eval('#list .card b', bs => bs.map(b => b.textContent));
  ok(order2[1] === order[0], 'pointer drag moved first card down ' + order2.join(','));

  // export JSON via clipboard, wipe, import, compare
  await page.click('#settings-btn');
  await page.click('#copy-json');
  await page.waitForTimeout(200);
  const json = await page.evaluate(() => navigator.clipboard.readText());
  const before = await page.evaluate(() => JSON.stringify({ h: __hg.data.habits, c: __hg.data.checks, o: __hg.data.order }));
  await page.click('#copy-csv'); await page.waitForTimeout(150);
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  ok(csv.startsWith('﻿date,habit,done'), 'CSV has BOM + header');
  await page.click('#wipe-btn'); await page.click('#wipe-btn');
  ok(await page.locator('#list .empty').count() === 1, 'wiped');
  await page.click('#settings-btn');
  await page.fill('#import-text', '{"habits":[{"id":"x","name":""}]}');
  await page.click('#import-btn');
  ok((await page.locator('#import-msg').innerText()).includes('匯入失敗'), 'bad import rejected');
  await page.setInputFiles('#import-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.waitForTimeout(150);
  ok((await page.locator('#import-msg').innerText()).includes('backup.json'), 'file picker loads backup.json');
  await page.click('#import-btn');
  const after = await page.evaluate(() => JSON.stringify({ h: __hg.data.habits, c: __hg.data.checks, o: __hg.data.order }));
  ok(after === before, 'import restores all habits and checks exactly');
  await page.click('#set-close');

  // delete with confirm + undo
  await page.locator('.card', { hasText: '早睡' }).locator('[data-body]').click();
  await page.click('#edit-sel');
  await page.click('#edit-delete');
  ok(await page.locator('.card', { hasText: '早睡' }).count() === 1, 'first delete click only arms');
  await page.click('#edit-delete');
  ok(await page.locator('.card', { hasText: '早睡' }).count() === 0, 'deleted');
  await page.click('#toast-undo');
  ok(await page.locator('.card', { hasText: '早睡' }).count() === 1, 'delete undone');

  // long-press opens edit
  const body = page.locator('.card', { hasText: '閱讀' }).locator('[data-body]');
  const bb = await body.boundingBox();
  await page.mouse.move(bb.x + 20, bb.y + 20); await page.mouse.down();
  await page.clock.runFor(600);
  await page.mouse.up();
  ok(!(await page.locator('#edit-sheet').isHidden()), 'long-press opens edit dialog');
  ok(await page.inputValue('#habit-name') === '閱讀 20 分鐘', 'edit dialog prefilled');
  await page.keyboard.press('Escape');

  // midnight rollover without reload
  await page.clock.setFixedTime(new Date('2026-10-12T23:59:30+08:00'));
  await page.clock.runFor(1000);
  await page.clock.setSystemTime(new Date('2026-10-13T00:00:40+08:00'));
  await page.clock.runFor(61000);
  ok(await page.locator('#today-label').innerText() === '10/13 週二', 'rolled over to 10/13 週二 at midnight');
  ok(await page.locator('.card', { hasText: '閱讀' }).locator('[data-check]').getAttribute('aria-pressed') === 'false', 'today list reset for new day');
  ok(errs.length === 0, 'flow no errors ' + errs.join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
