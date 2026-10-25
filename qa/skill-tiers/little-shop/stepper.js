// Stepper input check for 小店經營 (release review item 1): real CDP touch.
//  - a press on a stepper that turns into a scroll (drag up 120 px) must not change the value
//  - 20 quick taps (8/s) on ＋ = exactly +20, even when the page is slow to see the lift
//  - holding ＋ for ~1.2 s repeats; holding then dragging away undoes the hold
//   node stepper.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '../../../apps/little-shop/index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const SK = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
  const html = SK + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
  const out = {}; let fails = 0;
  const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:' + srv.address().port + '/'); await sleep(400);
    await page.evaluate(() => { __shop.prefs.tips = { mkt: 1, day: 1 }; __shop.start(0, 77); __shop.run.cash = 99999; });
    await sleep(300);
    const L = `${w}x${h}`, R = out[L] = {};
    const center = sel => page.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    const state = () => page.evaluate(() => ({ o: __shop.run.order.egg, p: __shop.run.price.egg, on: __shop.run.order.noodle }));
    const scTop = () => page.evaluate(() => document.querySelector('#market .scroll').scrollTop);
    // 1) drag from the price − button
    let [x, y] = await center('.item[data-id="egg"] [data-a="p-"]');
    const s0 = await state(), t0 = await scTop();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - k * 10 }] }); await sleep(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
    const s1 = await state(), t1 = await scTop();
    R.drag = { before: s0, after: s1, scrolledBy: t1 - t0 };
    ok(s1.p === s0.p && s1.o === s0.o, `${L}: dragging from 茶葉蛋 售價「−」 scrolls (${t1 - t0} px) without changing the price ($${s0.p} → $${s1.p})`);
    // 2) 20 quick taps at 8/s on 王子麵 進貨 ＋, each held 60 ms
    [x, y] = await center('.item[data-id="noodle"] [data-a="b+"]');
    await page.evaluate(() => { window.__pr = []; let d = 0; addEventListener('pointerdown', e => { d = e.timeStamp; }, true); addEventListener('pointerup', e => { __pr.push([Math.round(e.timeStamp - d), Math.round(performance.now() - e.timeStamp)]); }, true); });
    const n0 = (await state()).on, ts = Date.now();
    for (let i = 0; i < 20; i++) {
      const due = ts + i * 125, wt = due - Date.now(); if (wt > 0) await sleep(wt);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await sleep(600);
    const n1 = (await state()).on;
    R.taps = { sent: 20, got: n1 - n0, msPerTap: Math.round((Date.now() - ts - 600) / 20), pressMs: await page.evaluate(() => __pr.map(x => x[0])) };
    ok(n1 - n0 === 20 || n1 - n0 - 20 === R.taps.pressMs.filter(x => x >= 420).length, `${L}: 20 quick taps on ＋ add exactly 20, or only the presses the browser itself timed as ≥ 420 ms holds count extra (got ${n1 - n0}, ${R.taps.msPerTap} ms per tap, presses ${R.taps.pressMs.join(',')} ms)`);
    // 3) a real hold repeats
    const h0 = (await state()).on;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(1300);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
    const h1 = (await state()).on;
    R.hold = { ms: 1300, added: h1 - h0 };
    ok(h1 - h0 >= 3, `${L}: holding ＋ 1.3 s repeats (+${h1 - h0})`);
    // 4) hold, then slide away: nothing changes
    const d0 = (await state()).on;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(900);
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - k * 12 }] }); await sleep(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
    const d1 = (await state()).on;
    R.holdThenDrag = { before: d0, after: d1 };
    ok(d1 === d0, `${L}: hold then drag away leaves 王子麵 unchanged (${d0} → ${d1})`);
    R.errors = errors; ok(!errors.length, `${L}: no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'stepper.json'), JSON.stringify(out, null, 1));
  console.log(fails ? `${fails} failed` : 'all passed');
})();
