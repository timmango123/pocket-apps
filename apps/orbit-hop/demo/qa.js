// QA: mobile + desktop smoke test, screenshots, storage-throwing mode, cover image.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
const OUT = process.argv[2] || __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function playUntil(page, jumps, tapX, tapY, useTouch) {
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => __game.state());
    if (st.mode !== 'play' || st.jumps >= jumps) return st;
    const plan = await page.evaluate(() => __game.botPlan(0));
    if (!plan) { await sleep(20); continue; }
    await sleep(plan.wall - plan.now - 20);
    if (useTouch) await page.touchscreen.tap(tapX, tapY); else await page.mouse.click(tapX, tapY);
    await sleep(250);
  }
}
(async () => {
  const b = await chromium.launch();
  const report = [];
  for (const cfg of [
    { name: 'mobile', o: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'desktop', o: { viewport: { width: 1280, height: 800 } } },
    { name: 'nostorage', o: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, throwStorage: true },
  ]) {
    const ctx = await b.newContext(cfg.o);
    if (cfg.throwStorage) await ctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL); await sleep(600);
    const touch = !!cfg.o.hasTouch;
    if (cfg.name !== 'nostorage') await page.screenshot({ path: `${OUT}/${cfg.name}-title.png` });
    if (touch) await page.tap('#startBtn'); else await page.click('#startBtn');
    await sleep(500);
    if (cfg.name === 'mobile') await page.screenshot({ path: `${OUT}/${cfg.name}-start.png` });
    const W = cfg.o.viewport.width, H = cfg.o.viewport.height;
    let st = await playUntil(page, 6, W / 2, H * 0.75, touch);
    await sleep(300);
    if (cfg.name !== 'nostorage') await page.screenshot({ path: `${OUT}/${cfg.name}-play.png` });
    // pause / resume via keyboard
    await page.keyboard.press('KeyP'); await sleep(250);
    const paused = await page.evaluate(() => __game.state().mode);
    if (cfg.name === 'mobile') await page.screenshot({ path: `${OUT}/${cfg.name}-pause.png` });
    await page.keyboard.press('KeyP'); await sleep(200);
    // deliberately miss: tap at arbitrary moments until drifting away
    for (let i = 0; i < 12; i++) { const s = await page.evaluate(() => __game.state()); if (s.mode !== 'play') break;
      if (touch) await page.touchscreen.tap(W / 2, H * 0.75); else await page.mouse.click(W / 2, H * 0.75);
      await sleep(900);
    }
    await sleep(1400);
    st = await page.evaluate(() => __game.state());
    if (cfg.name !== 'nostorage') await page.screenshot({ path: `${OUT}/${cfg.name}-over.png` });
    const overVisible = await page.evaluate(() => document.getElementById('over').classList.contains('on'));
    // one-tap retry
    if (touch) await page.tap('#againBtn'); else await page.click('#againBtn');
    await sleep(400);
    const st2 = await page.evaluate(() => __game.state());
    const stored = cfg.throwStorage ? null : await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('orbit-hop:')).map(k => k + '=' + localStorage.getItem(k)));
    report.push({ cfg: cfg.name, paused, overMode: st.mode, overVisible, scoreAtOver: st.score, retryMode: st2.mode, retryScore: st2.score, stored, errs });
    await ctx.close();
  }
  console.log(JSON.stringify(report, null, 1));
  // cover: 300x400 mid-game
  const ctx = await b.newContext({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); await page.goto(URL); await sleep(300);
  await page.evaluate(() => { __game.start(77); __game.warp(66, 159); });
  await sleep(900);
  // capture mid-flight
  for (let i = 0; i < 60; i++) { const pl = await page.evaluate(() => __game.botPlan(0)); if (pl) { await sleep(pl.wall - pl.now - 20); await page.touchscreen.tap(150, 330); await sleep(300); break; } await sleep(30); }
  await page.screenshot({ path: process.argv[3] || `${OUT}/cover.jpg`, type: 'jpeg', quality: 80 });
  await b.close();
})();
