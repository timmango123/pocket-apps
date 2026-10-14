// Verify noise-mixer: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// Serve the page wrapped the way the Artifact host does (doctype + viewport meta), so mobile emulation is realistic.
const URL = 'http://artifact.local/index.html';
const SRC = () => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const route = ctx => ctx.route('http://artifact.local/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SRC() }));
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const shots = [
    { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
    { name: '360x780', viewport: { width: 360, height: 780 }, mobile: true },
    { name: '844x390', viewport: { width: 844, height: 390 }, mobile: true },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, mobile: true, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: s.viewport, isMobile: !!s.mobile, hasTouch: !!s.mobile, deviceScaleFactor: s.mobile ? 2 : 1, colorScheme: s.dark ? 'dark' : 'light' });
    await route(ctx);
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL);
    await page.waitForTimeout(300);
    if (s.name === '390x844' || s.name === '390x844-dark') { await page.click('#play-btn'); await page.waitForTimeout(800); }
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    await page.screenshot({ path: path.join(OUT, `${s.name}.png`) });
    if (s.name === '390x844') {
      // Expand rain advanced controls, screenshot timer sheet
      await page.click('#more-rain');
      await page.screenshot({ path: path.join(OUT, '390x844-advanced.png'), fullPage: true });
      await page.click('#timer-btn'); await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(OUT, '390x844-timer.png') });
      await page.keyboard.press('Escape');
    }
    ok(errs.length === 0, `${s.name} no console errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // Functional flow
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await route(ctx);
    const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  ok(await page.locator('#presets .chip.active').innerText() === '雨夜', 'example preset 雨夜 active on load');
  ok(await page.evaluate(() => ['rain', 'thunder', 'brown'].every(k => __nm.mix()[k].on)), 'example mix tracks on');
  await page.click('#play-btn');
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => __nm.ctx.state) === 'running', 'AudioContext running after click');
  const lvl = await page.evaluate(() => window.__level || 0);
  ok(lvl > 0.01, `audible output level ${lvl.toFixed(3)}`);
  ok(await page.evaluate(() => Object.keys(__nm.inst).sort().join()) === 'brown,rain,thunder', 'instances = brown,rain,thunder');

  // toggle every track on (11 tracks) to ensure all builders work
  for (const id of ['white', 'pink', 'ocean', 'wind', 'fan', 'fire', 'stream', 'heart']) await page.click('#tog-' + id);
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => Object.keys(__nm.inst).length) === 11, 'all 11 tracks instantiated');
  ok(await page.locator('#on-count').innerText() === '已開 11 / 11', 'count shows 11/11');
  ok(await page.locator('#presets .chip.active').count() === 0, 'preset deselected after manual change');
  // turn off rain -> torn down after 1s fade
  await page.click('#tog-rain');
  await page.waitForTimeout(1400);
  ok(await page.evaluate(() => !('rain' in __nm.inst)), 'rain torn down after 1s fade-out');
  // volume slider
  await page.fill('#vol-ocean', '20').catch(() => {});
  await page.evaluate(() => { const r = document.querySelector('#vol-ocean'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
  ok(await page.evaluate(() => __nm.mix().ocean.vol) === 20, 'ocean volume set to 20');
  // param slider for heart -> bpm label
  await page.click('#more-heart');
  await page.evaluate(() => { const r = document.querySelector('#param-heart'); r.value = 50; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok((await page.locator('#card-heart .nm small').innerText()).includes('70'), 'heart param 0.5 -> 70 bpm');

  // Sleep timer: 15 min, 30s fade
  await page.click('#timer-btn');
  await page.click('#tm-15'); await page.click('#fade-30'); await page.click('#timer-start');
  const lab = await page.locator('#timer-label').innerText();
  ok(/^1[45]:\d\d$/.test(lab), `timer label shows ~15:00 (${lab})`);
  await page.evaluate(() => __nm.setTimerEnd(15000)); // 15s left, inside 30s fade
  await page.waitForTimeout(1200);
  const sg = await page.evaluate(() => __nm.sleepGain());
  ok(sg < 0.6 && sg > 0.2, `sleep gain fading (~0.5) = ${sg.toFixed(2)}`);
  ok((await page.locator('#timer-label').innerText()).includes('淡出中'), 'label shows 淡出中');
  await page.evaluate(() => __nm.setTimerEnd(300));
  await page.waitForTimeout(1500);
  ok(await page.evaluate(() => __nm.playing) === false, 'auto-paused when timer ends');
  ok(await page.evaluate(() => __nm.ctx.state) === 'suspended', 'AudioContext suspended');
  ok((await page.locator('#status').innerText()).includes('睡眠定時結束'), 'status reports timer end');
  // custom timer validation
  await page.click('#timer-btn'); await page.fill('#timer-custom', '0'); await page.click('#timer-start');
  ok((await page.locator('#timer-msg').innerText()).includes('1–600'), 'custom 0 min rejected');
  await page.keyboard.press('Escape');

  // Save preset, reload, restore
  await page.click('#save-preset');
  await page.fill('#preset-name', '測試組合');
  await page.click('#save-ok');
  const onOnly = () => JSON.stringify(Object.entries(__nm.mix()).filter(([k, v]) => v.on));
  const snap = await page.evaluate(onOnly);
  await page.reload();
  ok(await page.locator('#presets .chip', { hasText: '測試組合' }).count() === 1, 'user preset persisted after reload');
  await page.click('#presets .chip >> text=海邊');
  ok(await page.evaluate(() => __nm.mix().ocean.on && !__nm.mix().fire.on), 'built-in 海邊 applied');
  await page.click('#presets .chip >> text=測試組合');
  await page.waitForTimeout(300);
  const after = await page.evaluate(onOnly);
  ok(after === snap, 'user preset restores all tracks/volumes exactly');
  // delete + undo
  await page.click('[data-del="0"]');
  ok(await page.locator('#presets .chip', { hasText: '測試組合' }).count() === 0, 'preset deleted');
  await page.click('#toast-undo');
  ok(await page.locator('#presets .chip', { hasText: '測試組合' }).count() === 1, 'preset delete undone');
  ok(errs.length === 0, 'functional flow no errors ' + errs.join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
