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
    await page.clock.install({ time: new Date('2026-10-12T21:00:00') });
    await page.goto(URL); await page.waitForTimeout(150);
    await page.clock.pauseAt(new Date('2026-10-12T21:00:05')); // freeze so screenshots don't let real time drift in
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    // rhythm math
    const L = await page.evaluate(() => ({ a: __breath.cycleLen(__breath.phasesOf('478')), b: __breath.cycleLen(__breath.phasesOf('box')), c: __breath.cycleLen(__breath.phasesOf('res')), d: __breath.cycleLen(__breath.phasesOf('relax')) }));
    assert(L.a === 19 && L.b === 16 && L.c === 11 && L.d === 10, '4-7-8 = 19 s, box = 16 s, resonance = 11 s, 4-6 = 10 s');
    assert((await page.locator('#desc').textContent()).includes('一循環 19 秒'), 'desc shows 19 s cycle');
    assert((await page.locator('#btnStart').textContent()).includes('4 循環'), '4-7-8 defaults to 4 cycles');
    await page.screenshot({ path: OUT + '/390x844.png' });

    // run 4-7-8
    await page.locator('#btnStart').click();
    await page.clock.runFor(1000);
    let st = await page.evaluate(() => __breath.state());
    assert(st.type === 'inhale' && (await page.locator('#label .ph').textContent()) === '吸氣', 't=1s inhale');
    assert((await page.locator('#label .sec').textContent()) === '3', 'countdown shows 3 at t=1s');
    await page.clock.runFor(4000); // t=5
    st = await page.evaluate(() => __breath.state());
    assert(st.type === 'hold', 't=5s hold');
    await page.screenshot({ path: OUT + '/390x844-hold.png' });
    await page.clock.runFor(7000); // t=12
    st = await page.evaluate(() => __breath.state());
    assert(st.type === 'exhale' && st.cycle === 0, 't=12s exhale');
    await page.clock.runFor(7900); // t=19.9
    st = await page.evaluate(() => __breath.state());
    assert(st.cycle === 1 && st.type === 'inhale', 't≈19.9s second cycle inhale');
    const sc = await page.evaluate(() => getComputedStyle(document.querySelector('#orb')).transform);
    assert(/matrix\(0\.4/.test(sc) || /matrix\(0\.[45]/.test(sc), 'orb near 0.4 scale at start of inhale (' + sc + ')');
    // controls auto-hide after 3 s; tap stage to reveal, then pause keeps time frozen
    assert(await page.evaluate(() => document.body.classList.contains('calm')), 'run controls auto-hidden after 3 s');
    await page.locator('#tapcatch').click();
    await page.locator('#btnPause').click();
    const e1 = (await page.evaluate(() => __breath.state())).el;
    await page.clock.runFor(10000);
    const e2 = (await page.evaluate(() => __breath.state())).el;
    assert(Math.abs(e2 - e1) < 0.05, 'paused: elapsed frozen');
    await page.screenshot({ path: OUT + '/390x844-paused.png' });
    await page.locator('#btnPause').click();
    await page.clock.runFor(57200); // 4 cycles = 76 s total
    assert(await page.locator('#dlgDone').isVisible(), 'end screen after 4 × 19 s');
    assert((await page.locator('#dTime').textContent()) === '1:16' && (await page.locator('#dCyc').textContent()) === '4', 'end: 1:16, 4 cycles');
    await page.screenshot({ path: OUT + '/390x844-done.png' });
    await page.locator('#btnClose').click();
    assert((await page.locator('#foot').textContent()).includes('本週已練習 1 天'), 'log: week count 1 day');

    // duration mode: relax 4-6, 1 min -> 6 cycles; 4-7-8 with 10 cycles -> warning
    await page.locator('[data-mode="relax"]').click();
    await page.locator('#durSeg [data-min="1"]').click();
    assert(await page.evaluate(() => __breath.planCycles(__breath.phasesOf('relax'))) === 6, 'relax 1 min = 6 cycles');
    await page.locator('[data-mode="res"]').click();
    assert(await page.evaluate(() => __breath.planCycles(__breath.phasesOf('res'))) === 6, 'resonance 1 min -> 6 cycles (finishes cycle)');
    await page.locator('[data-mode="478"]').click();
    for (let i = 0; i < 6; i++) await page.locator('#cycPlus').click();
    assert(await page.locator('#warn').isVisible() && (await page.locator('#warn').textContent()).includes('初學者'), '4-7-8 at 10 cycles shows beginner warning');

    // custom all zero cannot start
    await page.locator('[data-mode="custom"]').click();
    for (const id of ['#cIn', '#cHold', '#cOut', '#cHold2']) { await page.locator(id).fill('0'); await page.locator(id).dispatchEvent('change'); }
    assert(await page.locator('#btnStart').isDisabled() && (await page.locator('#warn').textContent()).includes('至少 2 秒'), 'custom all-zero: start disabled with hint');
    await page.locator('#cIn').fill('3.5'); await page.locator('#cIn').dispatchEvent('change');
    await page.locator('#cOut').fill('5'); await page.locator('#cOut').dispatchEvent('change');
    assert(!(await page.locator('#btnStart').isDisabled()), 'custom 3.5/0/5/0 can start');
    await page.screenshot({ path: OUT + '/390x844-custom.png' });

    // box mode dot visible
    await page.locator('[data-mode="box"]').click();
    await page.locator('#btnStart').click();
    await page.clock.runFor(6000);
    assert(await page.locator('#square').isVisible(), 'box mode shows square path');
    await page.screenshot({ path: OUT + '/390x844-box.png' });
    await page.locator('#tapcatch').click();
    await page.locator('#btnStop').click();
    // settings sheet
    await page.locator('#dlgDone').isVisible() && await page.locator('#btnClose').click();
    await page.locator('#btnSet').click();
    await page.locator('#sceneSeg [data-v="forest"]').click();
    await page.screenshot({ path: OUT + '/390x844-settings.png' });
    assert(await page.evaluate(() => document.documentElement.dataset.scene) === 'forest', 'scene switch');
    await ctx.close();
  } catch (e) { console.error(e); process.exitCode = 1; }

  // reduced motion: orb does not scale
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-10-12T21:00:00') });
    await page.goto(URL); await page.locator('#btnStart').click(); await page.clock.runFor(2000);
    const tr = await page.evaluate(() => document.querySelector('#orb').style.transform);
    try { assert(tr === 'scale(0.8)', 'reduced motion: fixed scale, brightness varies'); } catch (e) { console.error(e); process.exitCode = 1; }
    await ctx.close();
  }

  const shots = [
    ['360x780', { viewport: { width: 360, height: 780 }, ...mobile }],
    ['844x390', { viewport: { width: 844, height: 390 }, ...mobile }],
    ['390x844-dark', { viewport: { width: 390, height: 844 }, ...mobile, colorScheme: 'dark' }],
    ['desktop', { viewport: { width: 1280, height: 800 } }],
  ];
  for (const [name, opts] of shots) {
    const { ctx, page } = await mk(opts);
    await page.clock.install({ time: new Date('2026-10-12T21:00:00') });
    await page.goto(URL); await page.waitForTimeout(150);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    if (sw > iw || iw !== opts.viewport.width) { console.error('width problem', name, sw, iw); process.exitCode = 1; }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844-dark' || name === '844x390') {
      await page.locator('#btnStart').click(); await page.clock.runFor(2500);
      await page.screenshot({ path: `${OUT}/${name}-running.png` });
    }
    await ctx.close();
  }
  if (errors.length) { console.error('errors', errors); process.exitCode = 1; } else console.log('ok - no console/page errors');
  await browser.close();
  fs.unlinkSync(WRAP);
})().catch(e => { console.error(e); process.exit(1); });
