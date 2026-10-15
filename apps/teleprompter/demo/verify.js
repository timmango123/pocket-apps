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
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    return { ctx, page };
  };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.clock.install({ time: new Date('2026-10-12T10:00:00') });
    await page.goto(URL); await page.waitForTimeout(150);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    assert((await page.locator('#title').inputValue()).includes('範例'), 'sample script loaded');
    // word counting
    const wc = await page.evaluate(() => [__tp.countWords('大家好，歡迎收看'), __tp.countWords('Hello world, it\'s me'), __tp.countWords('我們支援 Dark Mode 了[停頓]**重點**')]);
    assert(wc[0] === 7 && wc[1] === 4 && wc[2] === 9, 'count: 7 CJK; 4 English words; mixed 9 (' + wc + ')');
    await page.screenshot({ path: OUT + '/390x844.png' });

    // spec case: 900 chars @ 180 wpm = 5:00
    const body = '我們今天要談的是如何準備一場好的簡報'.repeat(50); // 18 * 50 = 900
    await page.evaluate((b) => { __tp.setBody(b); __tp.setCfg('cd', 0); __tp.setCfg('wpm', 180); __tp.setCfg('mode', 'wpm'); }, body);
    assert((await page.locator('#stCount').textContent()) === '900', '900 chars counted');
    assert((await page.locator('#stTime').textContent()) === '5:00', 'estimated time 5:00 at 180 wpm');
    await page.locator('#btnGo').click();
    await page.waitForTimeout(50);
    assert(await page.locator('#player').isVisible(), 'player opened');
    const H = await page.evaluate(() => __tp.P.H);
    await page.clock.runFor(150000);
    let y = await page.evaluate(() => __tp.P.y);
    assert(Math.abs(y / H - 0.5) < 0.02, `halfway after 150 s (y/H=${(y / H).toFixed(3)})`);
    await page.screenshot({ path: OUT + '/390x844-playing.png' });
    await page.clock.runFor(145000);
    assert(!(await page.evaluate(() => __tp.P.ended)), 'not ended at 295 s');
    await page.clock.runFor(10000);
    assert(await page.evaluate(() => __tp.P.ended) && await page.locator('#endcard').isVisible(), 'ended by 305 s (5:00 ±10 s)');
    await page.screenshot({ path: OUT + '/390x844-end.png' });
    await page.locator('#eEdit').click();
    assert(await page.locator('#player').isHidden(), 'back to editor');

    // sample script with pause marker, countdown, tap pause, mirror, keyboard
    await page.evaluate(() => { __tp.setBody(`第一段開場白，大家好。[停頓]\n\n第二段**重點**內容在這裡。\n\n第三段結尾，謝謝大家。`); __tp.setCfg('cd', 3); __tp.setCfg('mx', true); });
    await page.locator('#btnGo').click();
    await page.clock.runFor(1000);
    assert(await page.locator('#cd').isVisible() && (await page.locator('#cd').textContent()) === '2', 'countdown 3-2-1 showing 2 at 1 s');
    await page.clock.runFor(2100);
    assert(await page.locator('#cd').isHidden(), 'countdown done');
    const tf = await page.evaluate(() => document.querySelector('#stage').style.transform);
    assert(tf.includes('scale(-1, 1)'), 'horizontal mirror applied to stage only');
    // pause marker hold
    const m0 = await page.evaluate(() => __tp.P.marks[0]);
    const v = await page.evaluate(() => __tp.P.v);
    await page.clock.runFor(Math.ceil(m0 / v * 1000) + 200);
    const y1 = await page.evaluate(() => __tp.P.y);
    await page.clock.runFor(1500);
    const y2 = await page.evaluate(() => __tp.P.y);
    assert(Math.abs(y2 - y1) < 0.5 && Math.abs(y1 - m0) < 1, '[停頓] holds position at guide line');
    await page.clock.runFor(1000);
    assert((await page.evaluate(() => __tp.P.y)) > y2, 'continues after 2 s');
    // tap to pause
    await page.mouse.click(200, 200);
    assert(!(await page.evaluate(() => __tp.P.playing)), 'tap pauses');
    await page.screenshot({ path: OUT + '/390x844-paused-mirror.png' });
    // keyboard: PageDown jumps paragraph, ArrowUp speeds up
    const paras = await page.evaluate(() => __tp.P.paras);
    await page.keyboard.press('PageDown');
    const yp = await page.evaluate(() => __tp.P.y);
    assert(paras.includes(yp) && yp > y2, 'PageDown jumps to next paragraph');
    const w0 = await page.evaluate(() => __tp.P.cfg.wpm);
    await page.keyboard.press('ArrowUp');
    assert(await page.evaluate(() => __tp.P.cfg.wpm) === w0 + 10, 'ArrowUp +10 wpm');
    // vertical drag repositions
    await page.mouse.move(200, 400); await page.mouse.down(); await page.mouse.move(200, 300, { steps: 5 }); await page.mouse.up();
    const yd = await page.evaluate(() => __tp.P.y);
    assert(Math.abs(yd - (yp + 100)) < 3, 'drag up 100px advances 100px');
    await page.keyboard.press('Escape');
    assert(await page.locator('#player').isHidden(), 'Esc exits player');

    // scripts list: new, persist, delete with in-page confirm
    await page.locator('#btnList').click();
    await page.locator('#btnNew').click();
    await page.locator('#title').fill('第二份'); await page.locator('#body').fill('Hello teleprompter world');
    assert((await page.locator('#stCount').textContent()) === '3', 'english words counted');
    await page.reload(); await page.waitForTimeout(100);
    assert((await page.locator('#title').inputValue()) === '第二份', 'current script persisted');
    await page.locator('#btnList').click();
    assert(await page.locator('#slist li').count() === 2, '2 scripts listed');
    await page.screenshot({ path: OUT + '/390x844-list.png' });
    await page.locator('#slist li').first().locator('[data-del]').click();
    await page.locator('#delYes').click();
    assert(await page.locator('#slist li').count() === 1, 'delete after confirm');
    // empty -> start disabled
    await page.locator('[data-close]').first().click();
    await page.locator('#body').fill('');
    assert(await page.locator('#btnGo').isDisabled(), 'empty script: start disabled');
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }

  const shots = [
    ['360x780', { viewport: { width: 360, height: 780 }, ...mobile }],
    ['844x390', { viewport: { width: 844, height: 390 }, ...mobile }],
    ['390x844-dark', { viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' }],
    ['desktop', { viewport: { width: 1280, height: 800 } }],
  ];
  for (const [name, opts] of shots) {
    const { ctx, page } = await mk(opts);
    await page.clock.install({ time: new Date('2026-10-12T10:00:00') });
    await page.goto(URL); await page.waitForTimeout(150);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw > iw || iw !== opts.viewport.width) { console.error('width problem', name, sw, iw); process.exitCode = 1; }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '844x390' || name === 'desktop') {
      await page.locator('#btnGo').click(); await page.clock.runFor(5000);
      await page.mouse.move(300, 200); await page.mouse.move(310, 200);
      await page.screenshot({ path: `${OUT}/${name}-playing.png` });
    }
    await ctx.close();
  }
  if (errors.length) { console.error('errors', errors); process.exitCode = 1; } else console.log('ok - no console/page errors');
  await browser.close();
  fs.unlinkSync(WRAP);
})().catch(e => { console.error(e); process.exit(1); });
