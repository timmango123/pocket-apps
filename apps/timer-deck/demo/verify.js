// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// The artifact host wraps the page in a document skeleton (doctype + viewport meta); mimic that for file:// testing.
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts) => {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

  // ---- main flow on 390x844 with a fake clock ----
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.clock.install({ time: new Date('2026-10-12T14:00:00') });
    await page.goto(URL);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `no horizontal scroll 390 (${sw})`);
    assert(await page.locator('.slot').count() === 4, '4 sample timers on first open');
    await page.screenshot({ path: OUT + '/390x844.png' });

    // spec math: Tabata 20/10 x8 + prep 10 = 250 s
    const total = await page.evaluate(() => __timerDeck.phasesOf({ prep: 10, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60 }).total);
    assert(total === 250000, 'Tabata 20/10x8 + 10s prep = 250 s (4:10)');
    const t2 = await page.evaluate(() => __timerDeck.phasesOf({ prep: 0, work: 30, rest: 15, rounds: 4, sets: 3, setRest: 60 }).total);
    assert(t2 === (3 * 4 * 45 + 2 * 60) * 1000, '30/15 x4 x3 sets + 60s set rest = 660 s');
    assert(await page.evaluate(() => __timerDeck.fmtCountdown(3723000)) === '1:02:03', 'format >=1h as H:MM:SS');
    assert(await page.evaluate(() => __timerDeck.fmtCountdown(59000)) === '00:59', 'format <1h as MM:SS');

    // quick preset 1 min -> runs, counts down, finishes
    await page.locator('.chip[data-min="1"]').click();
    let first = page.locator('.slot').first();
    assert((await first.locator('.name').textContent()).includes('1 分鐘'), 'quick 1-min created at top');
    await page.clock.runFor(30000); await page.waitForTimeout(120);
    let txt = await first.locator('.time').textContent();
    assert(txt === '00:30' || txt === '00:29', 'after 30 s shows 00:30 (got ' + txt + ')');
    // reload: still running
    await page.reload(); await page.waitForTimeout(100);
    first = page.locator('.slot').first();
    const st = await page.evaluate(() => __timerDeck.timers[0].status);
    assert(st === 'running', 'still running after reload');
    await page.clock.runFor(31000);
    assert(await page.evaluate(() => __timerDeck.timers[0].status) === 'done', 'countdown done after 60 s');
    assert(await first.locator('.stop-btn').isVisible(), 'big stop button visible when done');
    assert((await first.locator('.sub').textContent()).includes('已於 14:01 結束'), 'shows finished-at time 14:01');
    await page.screenshot({ path: OUT + '/390x844-done.png' });
    await first.locator('.stop-btn').click();
    assert(await page.evaluate(() => __timerDeck.timers[0].ack) === true, 'stop acknowledges alarm');

    // Interval sample: start and locate phases
    const iv = page.locator('.slot', { hasText: '範例：Tabata' });
    await iv.locator('.play').click();
    await page.clock.runFor(5000);
    assert((await iv.locator('.sub').textContent()).includes('準備'), 'interval at 5 s is prep');
    await page.clock.runFor(10000);
    let sub = await iv.locator('.sub').textContent();
    assert(sub.includes('運動') && sub.includes('回合 1/8'), 'interval at 15 s is work round 1 (' + sub + ')');
    assert(await iv.locator('.card').getAttribute('data-phase') === 'work', 'card colored as work');
    await page.clock.runFor(20000);
    sub = await iv.locator('.sub').textContent();
    assert(sub.includes('休息') && sub.includes('回合 1/8'), 'interval at 35 s is rest round 1');
    await page.screenshot({ path: OUT + '/390x844-interval.png' });
    await page.clock.runFor(215000);
    assert(await page.evaluate(() => __timerDeck.timers.find(t => t.type === 'interval').status) === 'done', 'interval done at 250 s');

    // Stopwatch laps
    const swc = page.locator('.slot', { hasText: '範例：簡報計時' });
    await swc.locator('.play').click();
    await page.clock.runFor(1500);
    await swc.locator('.foot button', { hasText: '計圈' }).click();
    await page.clock.runFor(2250);
    await swc.locator('.foot button', { hasText: '計圈' }).click();
    const laps = await page.evaluate(() => __timerDeck.timers.find(t => t.type === 'stopwatch').laps);
    assert(laps.length === 2 && Math.abs(laps[0].split - 1500) < 200 && Math.abs(laps[1].split - 2250) < 200 && Math.abs(laps[1].total - laps[0].split - laps[1].split) < 1, 'laps split ~1.50 / ~2.25 (' + laps.map(l=>l.split).join(',') + ' ms), total = sum');
    await swc.locator('summary').click();
    assert(await swc.locator('li.fast').count() === 1 && await swc.locator('li.slow').count() === 1, 'fastest/slowest marked');

    // Validation: 0 s and 100 h rejected
    await page.locator('#addBtn').click();
    await page.fill('#hInput', '0'); await page.fill('#mInput', '0'); await page.fill('#sInput', '0');
    await page.locator('#addStart').click();
    assert((await page.locator('#addErr').textContent()).includes('至少'), '0 s rejected with message');
    await page.fill('#hInput', '100');
    await page.locator('#addStart').click();
    assert((await page.locator('#addErr').textContent()).includes('99:59:59'), '100 h rejected with message');
    await page.fill('#hInput', '0'); await page.fill('#mInput', '2'); await page.fill('#sInput', '30');
    await page.locator('#addStart').click();
    assert(await page.locator('#addScrim').isHidden(), 'valid 2:30 accepted');
    const nt = await page.locator('.slot').first().locator('.time').textContent();
    assert(nt === '02:30' || nt === '02:29', 'new countdown shows 02:30 (' + nt + ')');

    // Fullscreen
    await page.locator('.slot').first().locator('.foot button', { hasText: '全螢幕' }).click();
    await page.clock.runFor(1000);
    assert(await page.locator('#fs').isVisible(), 'fullscreen overlay visible');
    const fsw = await page.evaluate(() => { const r = document.getElementById('fsTime').getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
    assert(fsw, 'fullscreen digits fit width');
    await page.screenshot({ path: OUT + '/390x844-fullscreen.png' });
    await page.locator('#fsExit').click();

    // swipe-left delete via pointer events
    const before = await page.locator('.slot').count();
    await page.locator('.slot').last().scrollIntoViewIfNeeded();
    const box = await page.locator('.slot').last().locator('.card-head .tag').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x - i * 25, box.y + box.height / 2);
    await page.mouse.up();
    await page.clock.runFor(400);
    assert(await page.locator('.slot').count() === before - 1, 'swipe-left deletes a card');
    assert(await page.locator('#toastUndo').isVisible(), 'undo toast shown');
    await page.locator('#toastUndo').click();
    assert(await page.locator('.slot').count() === before, 'undo restores');
    await ctx.close();
  }

  // ---- screenshots at other sizes ----
  for (const [w, h, name, extra] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, 'desktop', {}]]) {
    const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...extra });
    await page.goto(URL); await page.waitForTimeout(150);
    // put one interval running for visual variety
    await page.locator('.slot', { hasText: '範例：Tabata' }).locator('.play').click();
    await page.waitForTimeout(1200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `no horizontal scroll ${name} (${sw})`);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '844x390') {
      await page.locator('.slot', { hasText: '範例：Tabata' }).locator('.foot button', { hasText: '全螢幕' }).click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/844x390-fullscreen.png` });
    }
    await ctx.close();
  }
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' });
    await page.goto(URL); await page.waitForTimeout(150);
    await page.locator('.slot', { hasText: '範例：Tabata' }).locator('.play').click();
    await page.locator('.slot', { hasText: '範例：簡報計時' }).locator('.play').click();
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${OUT}/390x844-dark.png` });
    await page.locator('#addBtn').click(); await page.locator('#typeInterval').click();
    await page.screenshot({ path: `${OUT}/390x844-dark-add.png` });
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  if (errors.length) { console.error('ERRORS:', errors); process.exit(1); }
  console.log('ALL PASSED, no console errors');
})().catch(e => { console.error(e); process.exit(1); });
