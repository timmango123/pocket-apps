// Rapid-tap input test for 小店經營 (rubric 操控與手感): real CDP touch at 8 taps/s, alternating between two
// targets, comparing taps sent with what the game counted. Market steppers, then 結帳 + speed on the day bar.
//   node rapidtap.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '../../../apps/little-shop/index.html');
(async () => {
  const SK = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
  const html = SK + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader'] });
  const out = {};
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://localhost:' + srv.address().port + '/'); await page.waitForTimeout(400);
    await page.evaluate(() => { __shop.prefs.tips = { mkt: 1, day: 1 }; __shop.start(0, 77); __shop.run.cash = 99999; });
    await page.evaluate(() => { const box = document.querySelector('#market .scroll'); box.scrollTop = document.querySelector('.item[data-id="noodle"]').offsetTop - 10; });
    await page.waitForTimeout(200);
    const center = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
    const touch = async ([x, y]) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const at8 = async (targets, n) => { const t0 = Date.now(); for (let i = 0; i < n; i++) { const due = t0 + i * 125; const wait = due - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); await touch(targets[i % targets.length]); } return (Date.now() - t0) / n; };
    // market: noodle ＋ and egg ＋ alternately
    const a = await center('.item[data-id="noodle"] [data-a="b+"]'), b = await center('.item[data-id="egg"] [data-a="b+"]');
    await page.evaluate(() => { window.__press = []; let t0 = 0; addEventListener('pointerdown', () => { t0 = performance.now(); }, true); addEventListener('pointerup', () => { __press.push(Math.round(performance.now() - t0)); }, true); });
    const m0 = await page.evaluate(() => ({ ...__shop.run.order }));
    const gap1 = await at8([a, b], 40); await page.waitForTimeout(300);
    const m1 = await page.evaluate(() => ({ ...__shop.run.order }));
    const press = await page.evaluate(() => __press.splice(0));
    // a press held past 420 ms is a hold (auto-repeat), by design; count only presses shorter than that as taps
    const market = { sent: { noodle: 20, egg: 20 }, got: { noodle: m1.noodle - m0.noodle, egg: m1.egg - m0.egg }, msPerTap: Math.round(gap1), pressMs: { max: Math.max(...press), heldOver420: press.filter(x => x >= 420).length } };
    // day: build a long queue on the virtual clock, then alternate 結帳 and the speed button
    await page.evaluate(() => { document.getElementById('bOpen').click(); });
    await page.waitForTimeout(300);
    await page.evaluate(() => { __shop.lockstep(true); const r = __shop.run; for (const id in r.stock) r.stock[id] = 40; r.ds.t = 780; let g = 0; while (r.ds.q.length < 24 && g++ < 400) { for (const c of r.ds.cs) c.pat = 1e9; if (r.ds.svc) r.ds.svc.until = 1e9; SHOP.tick(r); } });
    // stop auto-serving during the burst: the clock is locked, so only taps change the queue
    const s0 = await page.evaluate(() => ({ served: __shop.run.ds.served, taps: __shop.run.ds.taps, q: __shop.run.ds.q.length, speed: __shop.prefs.speed }));
    const sv = await center('#bServe'), sp = await center('#bSpeed');
    const gap2 = await at8([sv, sp], 40); await page.waitForTimeout(300);
    const s1 = await page.evaluate(() => ({ served: __shop.run.ds.served, taps: __shop.run.ds.taps, q: __shop.run.ds.q.length, speed: __shop.prefs.speed }));
    const cyc = [1, 2, 4], expSpeed = cyc[(cyc.indexOf(s0.speed) + 20) % 3];
    const day = { queue: s0.q, sentServe: 20, served: s1.served - s0.served, expectedServed: Math.min(20, s0.q), counted: s1.taps - s0.taps, sentSpeed: 20, speedFrom: s0.speed, speedTo: s1.speed, speedExpected: expSpeed, msPerTap: Math.round(gap2) };
    out[`${w}x${h}`] = { market, day, errors };
    console.log(`${w}x${h}`, JSON.stringify(out[`${w}x${h}`]));
    await ctx.close();
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'rapidtap.json'), JSON.stringify(out, null, 1));
})();
