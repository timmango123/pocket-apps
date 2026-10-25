// Verification for 小店經營 (little-shop): opens the page at 390×844, the three in-lobby iframe sizes, 360×640 and
// landscape 844×390, light and dark; asserts no page errors, that every control is on screen and ≥ 44 px, and drives
// the main loop (title → market → buy/price with touch → open → serve/upsell → closing report → next morning).
// Writes screenshots and demo/cover-390x520.png (the lobby cover: a busy afternoon in the shop).
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const html = SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const srv = require('http').createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/app/little-shop/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [844, 390]];
  // every visible control inside the viewport, ≥ 44 px, and not covered by something else at its centre
  const controls = (page, scope) => page.evaluate(scope => {
    const out = [];
    for (const b of document.querySelectorAll(scope + ' button')) {
      if (b.closest('[hidden]') || !b.offsetParent) continue;
      const r = b.getBoundingClientRect(); if (!r.width) continue;
      let sc = b.parentElement; while (sc && !(getComputedStyle(sc).overflowY === 'auto' && sc.scrollHeight > sc.clientHeight)) sc = sc.parentElement;
      const inView = r.left >= -0.5 && r.right <= innerWidth + 0.5 && (sc ? true : (r.top >= -0.5 && r.bottom <= innerHeight + 0.5));
      let covered = false;
      if (!sc && inView) { const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); covered = !(e && (e === b || b.contains(e))); }
      out.push({ n: (b.id || b.getAttribute('aria-label') || b.textContent).trim().slice(0, 12), w: r.width, h: r.height, inView, covered });
    }
    return out;
  }, scope);
  const checkControls = async (page, scope, label) => {
    const cs = await controls(page, scope);
    const bad = cs.filter(c => !c.inView || c.covered || c.w < 43.5 || c.h < 43.5);
    ok(cs.length > 0 && bad.length === 0, `${label}: ${cs.length} controls on screen, ≥44px, uncovered ${bad.length ? JSON.stringify(bad) : ''}`);
  };
  const tapc = async (page, sel) => { const b = await page.$(sel); await b.scrollIntoViewIfNeeded(); await page.tap(sel); };
  for (const scheme of ['light', 'dark']) for (const [w, h] of sizes) {
    const L = `${w}x${h} ${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const t0 = Date.now();
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForSelector('#bStart', { state: 'visible' });
    const loadMs = Date.now() - t0;
    ok(loadMs < 3000, `${L}: playable within ${loadMs} ms`);
    await sleep(500);
    const ow = () => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(await ow() <= 1, `${L}: title has no horizontal overflow`);
    await checkControls(page, '#title', `${L} title`);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-title-${scheme}.png`) });
    // the shop must be visible above the title card
    const shopTop = await page.evaluate(() => { const s = __shop.Scene.toScreen(180, 222); return s.y; });
    const titleTop = await page.evaluate(() => document.querySelector('#title .logo').getBoundingClientRect().top);
    ok(w > h || shopTop <= titleTop + 30, `${L}: the shop floor sits above the title card (${Math.round(shopTop)} vs ${Math.round(titleTop)})`);
    await page.tap('#bStart'); await sleep(350);
    ok(await page.evaluate(() => __shop.view === 'market'), `${L}: 開始 opens the market`);
    ok(await ow() <= 1, `${L}: market has no horizontal overflow`);
    await checkControls(page, '#market .bar, #top', `${L} market bar`);
    await checkControls(page, '#itemList', `${L} item steppers`);
    // touch: order and price
    await tapc(page, '.item[data-id="noodle"] [data-a="b+"]'); await tapc(page, '.item[data-id="noodle"] [data-a="b+"]'); await tapc(page, '.item[data-id="noodle"] [data-a="p+"]');
    const st = await page.evaluate(() => ({ o: __shop.run.order.noodle, p: __shop.run.price.noodle, label: document.querySelector('.item[data-id="noodle"] [data-pr]').textContent }));
    ok(st.o === 2 && st.p === 16 && st.label === '$16', `${L}: steppers order and price (${JSON.stringify(st)})`);
    const vis = await page.evaluate(() => { const v = document.querySelector('.item[data-id="noodle"] .stepper.buy .val'), s = v.querySelector('small').getBoundingClientRect(), b = v.querySelector('b').getBoundingClientRect(); return s.bottom <= b.top + 1.5; });
    ok(vis, `${L}: stepper caption and number do not overlap`);
    await page.tap('#bSuggest'); await sleep(120);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-market-${scheme}.png`) });
    if (w === 375) await page.screenshot({ path: path.join(OUT, `shot-market-375-${scheme}.png`) });
    // upgrade sheet
    await page.tap('#bUpg'); await sleep(450);
    await checkControls(page, '#sheetUpg', `${L} upgrade sheet`);
    await page.tap('#sheetUpg [data-close]'); await sleep(400);
    await page.tap('#bOpen'); await sleep(400);
    ok(await page.evaluate(() => __shop.view === 'day'), `${L}: 開門營業 starts the day`);
    await checkControls(page, '#dayBar, #top', `${L} day bar`);
    // busy afternoon, then serve and upsell with real taps
    await page.evaluate(() => { __shop.lockstep(true); const r = __shop.run; while (r.ds.t < 900) SHOP.tick(r); });
    await page.evaluate(() => __shop.stepUntil(6000, 3));
    for (let k = 0; k < 6 && !(await page.evaluate(() => __shop.run.ds.q.length)); k++) await page.evaluate(() => __shop.stepUntil(4000, 1));
    const q0 = await page.evaluate(() => ({ q: __shop.run.ds.q.length, s: __shop.run.ds.served, p: __shop.paused, v: __shop.view, t: __shop.run.ds.t, hit: (() => { const b = document.getElementById('bServe').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return e && (e.id || e.className); })() }));
    await page.tap('#bServe'); await sleep(60);
    const q1 = await page.evaluate(() => __shop.run.ds.served);
    ok(q0.q > 0 && q1 === q0.s + 1, `${L}: 結帳 serves one customer per tap (${q0.s} → ${q1}; ${JSON.stringify(q0)})`);
    const up = await page.evaluate(() => __shop.stepUntil(6000, 0));
    if (up.why === 'up') {
      await page.evaluate(() => __shop.step(100));
      ok(await page.evaluate(() => document.getElementById('bUp').classList.contains('on')), `${L}: 推薦 lights up for an upsell offer`);
      const tr0 = await page.evaluate(() => __shop.run.ds.up.tried);
      await page.tap('#bUp'); await sleep(60);
      ok(await page.evaluate(() => __shop.run.ds.up.tried) === tr0 + 1, `${L}: tapping 推薦 makes the offer`);
    }
    await page.evaluate(() => { __shop.lockstep(false); });
    await sleep(700);
    ok(await ow() <= 1, `${L}: day view has no horizontal overflow`);
    const hudOk = await page.evaluate(() => { const a = document.querySelector('.clock').getBoundingClientRect(), b = document.querySelector('#tally').getBoundingClientRect(); return a.right <= b.left + 1 || a.bottom <= b.top; });
    ok(hudOk, `${L}: clock and tally do not overlap`);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-day-${scheme}.png`) });
    if ((w === 375 && h === 500) || (w === 360) || (w === 844) || (w === 430)) await page.screenshot({ path: path.join(OUT, `shot-day-${w}x${h}-${scheme}.png`) });
    // pause on hide
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await page.evaluate(() => __shop.paused), `${L}: hiding the page pauses the day`);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); });
    await page.tap('#pauseBox [data-r]'); await sleep(100);
    ok(await page.evaluate(() => !__shop.paused), `${L}: 繼續營業 resumes`);
    // close the day
    await page.evaluate(() => { const r = __shop.run; while (!SHOP.dayDone(r)) SHOP.tick(r); });
    for (let i = 0; i < 40 && await page.evaluate(() => __shop.view) !== 'report'; i++) await sleep(100);
    ok(await page.evaluate(() => __shop.view === 'report'), `${L}: closing shows the report`);
    await sleep(200);
    ok(await ow() <= 1, `${L}: report has no horizontal overflow`);
    await checkControls(page, '#report .bar', `${L} report bar`);
    const rep = await page.evaluate(() => { const r = __shop.run.last; return { txt: document.getElementById('repBody').innerText, net: r.net }; });
    ok(rep.txt.includes('打烊結算') && rep.txt.includes((rep.net >= 0 ? '+$' : '−$') + Math.abs(rep.net).toLocaleString('en-US')), `${L}: report shows today's balance`);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-report-${scheme}.png`) });
    if (w === 375 && h === 500) await page.screenshot({ path: path.join(OUT, `shot-report-375-${scheme}.png`) });
    await page.reload(); await sleep(400);
    ok(await page.evaluate(() => __shop.view === 'report'), `${L}: refresh keeps the report`);
    await page.tap('#bNext'); await sleep(250);
    ok(await page.evaluate(() => __shop.view === 'market' && __shop.run.day === 2), `${L}: next morning is day 2`);
    // jump to the season end through the game API and check the end screen
    await page.evaluate(() => { const S = SHOP, r = __shop.run; while (r.phase !== 'end') { if (r.phase === 'report') S.nextDay(r); if (r.phase === 'market') { S.applySuggest(r); S.openShop(r); } if (r.phase === 'day') { while (!S.dayDone(r)) S.tick(r); S.closeDay(r); } } __shop.save(); __shop.load(); });
    await sleep(700);
    ok(await page.evaluate(() => __shop.view === 'end'), `${L}: season end screen`);
    await checkControls(page, '#end .bar', `${L} end bar`);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-end-${scheme}.png`) });
    // menu sheet
    await page.tap('#bMenu'); await sleep(450);
    await page.waitForFunction(() => { const s = document.getElementById('sheetMenu'); const r = s.getBoundingClientRect(); return s.classList.contains('show') && r.bottom <= innerHeight + 1 && r.top >= 0 && getComputedStyle(s).transform.replace(/matrix\(1, 0, 0, 1, 0, 0\)|none/, '') === ''; }, null, { timeout: 4000 }).catch(() => {});
    await checkControls(page, '#sheetMenu', `${L} menu`);
    if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-menu-${scheme}.png`) });
    ok(errors.length === 0, `${L}: no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // theme toggle and sound toggle persist
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(URL); await sleep(300);
    await page.tap('#bTSound');
    await page.evaluate(() => document.getElementById('bMenu').click()).catch(() => {});
    await page.evaluate(() => document.getElementById('mTheme').click()); await sleep(100);
    await page.reload(); await sleep(300);
    const p = await page.evaluate(() => ({ s: __shop.prefs.sound, t: document.documentElement.dataset.theme }));
    ok(p.s === false && p.t === 'light', `sound and theme choices persist (${JSON.stringify(p)})`);
    await ctx.close();
  }
  // cover: a busy afternoon, 390×520
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(URL); await sleep(300);
    await page.evaluate(() => { __shop.prefs.tips = { mkt: 1, day: 1 }; __shop.unlockAll(); __shop.start(1, 4242); const r = __shop.run; r.cash = 6000; SHOP.buyUpgrade(r, 'sign'); SHOP.buyUpgrade(r, 'fridge'); r.rep = 78; r.cash = 3480; r.today = { base: 'hot', chance: 0, win: null }; SHOP.applySuggest(r); for (const id in r.order) SHOP.setOrder(r, id, r.order[id] + 12); document.getElementById('bOpen').click(); });
    await sleep(300);
    await page.evaluate(() => { __shop.lockstep(true); const r = __shop.run; while (r.ds.t < 945) SHOP.tick(r); });
    // let the walkers settle into place, then wait for a counter customer with a 推薦 offer
    for (let i = 0; i < 6; i++) { await page.evaluate(() => __shop.step(400)); await sleep(60); }
    await page.evaluate(() => __shop.stepUntil(15000, 0));
    // the morning shutter animates on real frames, which lockstep holds back: open it the way a played day would be
    await page.evaluate(() => { __shop.Scene.setShutter(0, true); __shop.step(120); }); await sleep(300);
    ok(await page.evaluate(() => __shop.Scene.shutterDone()), 'cover: the shutter is open');
    await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover written');
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
