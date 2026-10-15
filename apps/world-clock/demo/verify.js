// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext({ timezoneId: 'Asia/Taipei', locale: 'zh-TW', ...opts });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.clock.install({ time: new Date('2026-10-12T14:00:00+08:00') });
    await page.goto(URL); await page.waitForTimeout(200);
    const iw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw[1] === 390, 'innerWidth equals device width');
    assert(iw[0] <= iw[1], 'no horizontal scroll 390');
    assert(await page.locator('#list .row').count() === 4, '4 sample cities shown on first open');
    assert(await page.locator('#sampleTag').isVisible(), 'sample tag visible');

    // offsets vs known values on 2026-10-12 (NY EDT -4, London BST +1, Kathmandu +5:45)
    const t = Date.parse('2026-10-12T06:00:00Z');
    const o = await page.evaluate((t) => ['Asia/Taipei', 'America/New_York', 'Europe/London', 'Asia/Kathmandu', 'Pacific/Chatham'].map(z => __worldClock.offsetMin(z, t)), t);
    assert(o[0] === 480 && o[1] === -240 && o[2] === 60 && o[3] === 345 && o[4] === 825, 'offsets TPE+8 NY-4 LON+1 KTM+5:45 CHA+13:45 (' + o + ')');
    // Winter (DST off): NY -5, London 0
    const w = await page.evaluate(() => { const t = Date.parse('2026-12-15T00:00:00Z'); return ['America/New_York', 'Europe/London', 'Australia/Sydney'].map(z => __worldClock.offsetMin(z, t)); });
    assert(w[0] === -300 && w[1] === 0 && w[2] === 660, 'winter offsets NY-5 LON+0 SYD+11 (' + w + ')');
    const ktm = await page.evaluate((t) => __worldClock.partsAt('Asia/Kathmandu', t), t);
    assert(ktm.h === 11 && ktm.mi === 45, 'Kathmandu at 14:00 TPE is 11:45');

    // list text: NY row shows −12 小時 and 02:00
    const ny = page.locator('#list .row').nth(0);
    const nyTxt = await ny.textContent();
    assert(nyTxt.includes('−12 小時') && nyTxt.includes('02:00'), 'NY row: −12 小時, 02:00 (' + nyTxt.replace(/\s+/g, ' ') + ')');
    assert((await page.locator('#list .row').nth(3).textContent()).includes('−2 小時 15 分'), 'Kathmandu diff −2 小時 15 分');
    await page.screenshot({ path: OUT + '/390x844.png', fullPage: false });

    // scrub to Taipei 22:00 => slot 88, NY 10:00 same day ("今天")
    await page.evaluate(() => __worldClock.setScrub(88));
    const ny2 = (await ny.textContent()).replace(/\s+/g, ' ');
    assert(ny2.includes('10:00') && ny2.includes('今天') && ny2.includes('−12 小時'), 'scrub 22:00 TPE => NY 10:00 today, −12 h');
    assert(await page.locator('#btnNow').isVisible(), 'back-to-now button visible while scrubbing');
    // scrub to 08:00 TPE => NY previous day 20:00 "昨天"
    await page.locator('#scrub').fill('32');
    const ny3 = (await ny.textContent()).replace(/\s+/g, ' ');
    assert(ny3.includes('20:00') && ny3.includes('昨天'), 'TPE 08:00 => NY 20:00 昨天');
    await page.screenshot({ path: OUT + '/390x844-scrub.png', fullPage: true });
    await page.locator('#btnNow').click();
    assert((await ny.textContent()).includes('02:00'), 'back to now restores live time');

    // drag on timeline band
    const band = await page.locator('#tl .band').first().boundingBox();
    await page.mouse.move(band.x + band.width * 0.5 + 1, band.y + 5);
    await page.mouse.down(); await page.mouse.move(band.x + band.width * 0.75 + 1, band.y + 5, { steps: 4 }); await page.mouse.up();
    const sv = +(await page.locator('#scrub').inputValue());
    assert(sv >= 70 && sv <= 73, 'dragging timeline moves scrub to ~18:00 (' + sv + ')');
    await page.locator('#btnNow').click();

    // meeting suggestions: Taipei(local)+London+SF => no overlap -> fallback
    await page.evaluate(() => __worldClock.setCities([{ tz: 'Europe/London', name: '倫敦' }, { tz: 'America/Los_Angeles', name: '舊金山' }]));
    let s = await page.evaluate(() => __worldClock.suggestions());
    assert(s.type === 'fallback' && s.runs.length > 0, 'TPE+LON+SF: no overlap, fallback suggestions listed');
    assert((await page.locator('#sugg').textContent()).includes('沒有所有人都在上班'), 'fallback note shown');
    // Taipei + Tokyo => overlap 09:00-17:00 local (Tokyo 10-18)
    await page.evaluate(() => __worldClock.setCities([{ tz: 'Asia/Tokyo', name: '東京' }]));
    s = await page.evaluate(() => __worldClock.suggestions());
    assert(s.type === 'overlap' && s.runs[0][0] === 36 && s.runs[0][1] === 68, 'TPE+TYO overlap 09:00–17:00 local');
    // Taipei + London: 16:00-18:00 TPE (London 9-11 BST)
    await page.evaluate(() => __worldClock.setCities([{ tz: 'Europe/London', name: '倫敦' }]));
    s = await page.evaluate(() => __worldClock.suggestions());
    assert(s.type === 'overlap' && s.runs[0][0] === 64 && s.runs[0][1] === 72, 'TPE+LON overlap 16:00–18:00 local');

    // add city via dialog + duplicate check
    await page.locator('#btnAdd').click();
    await page.locator('#search').fill('kathmandu');
    await page.locator('#results button').first().click();
    assert(await page.locator('#list .row').count() === 2, 'added Kathmandu via search');
    await page.locator('#btnAdd').click();
    await page.locator('#search').fill('加德滿都');
    await page.locator('#results button').first().click();
    assert((await page.locator('#toast').textContent()).includes('已在清單中'), 'duplicate city rejected');
    await page.locator('#dlgAdd [data-close]').click();
    // rename + persistence
    await page.locator('#list .row .main').first().click();
    await page.locator('#editLabel').fill('客戶 A');
    await page.locator('#editSave').click();
    await page.reload(); await page.waitForTimeout(150);
    const names = await page.locator('#list .row .name').allTextContents();
    assert(names[0].includes('客戶 A') && names.length === 2, 'label + list persisted after reload');
    // 12h format
    await page.locator('#btnSettings').click();
    await page.locator('#segFmt button[data-v="12"]').click();
    await page.locator('#dlgSet [data-close]').click();
    assert((await page.locator('#hereTime').textContent()).includes('下午'), '12-hour format shows 下午');
    // delete with in-page confirm
    await page.locator('#list .row .main').nth(1).click();
    await page.locator('#editDel').click(); await page.locator('#delYes').click();
    assert(await page.locator('#list .row').count() === 1, 'delete via in-page confirm');
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }

  // screenshots of sample state
  const shots = [
    ['390x844', { viewport: { width: 390, height: 844 }, ...mobile }],
    ['360x780', { viewport: { width: 360, height: 780 }, ...mobile }],
    ['844x390', { viewport: { width: 844, height: 390 }, ...mobile }],
    ['390x844-dark', { viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' }],
    ['desktop', { viewport: { width: 1280, height: 800 } }],
  ];
  for (const [name, opts] of shots) {
    const { ctx, page } = await mk(opts);
    await page.clock.install({ time: new Date('2026-10-12T14:00:00+08:00') });
    await page.goto(URL); await page.waitForTimeout(200);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw > iw) { console.error('horizontal overflow at', name, sw, iw); process.exitCode = 1; }
    if (iw !== opts.viewport.width) { console.error('innerWidth mismatch', name, iw); process.exitCode = 1; }
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: name !== '844x390' });
    if (name === '390x844') { await page.locator('#btnAdd').click(); await page.locator('#search').fill('美國'); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/390x844-add.png` }); }
    await ctx.close();
  }
  assert(errors.length === 0, 'no console/page errors ' + JSON.stringify(errors));
  await browser.close();
  fs.unlinkSync(WRAP);
})().catch(e => { console.error(e); process.exit(1); });
