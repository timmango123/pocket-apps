// 手指輪盤：手機回報的 maxTouchPoints 只是參考，實際送進來的觸點都要算（回報 5 的手機放 8 指也要 8 個）。
// Usage: node tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await p.goto('file://' + path.resolve(__dirname, '..', 'index.html')); await p.waitForTimeout(300);
  ok(await p.evaluate(() => navigator.maxTouchPoints) === 5, 'device reports 5 touch points');
  const r = await p.locator('#stage').boundingBox();
  const pts = Array.from({ length: 8 }, (_, i) => ({ x: r.x + r.width * (0.15 + 0.1 * i), y: r.y + r.height * (0.3 + 0.05 * (i % 3)), id: i + 1, radiusX: 8, radiusY: 8 }));
  for (let n = 1; n <= 8; n++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts.slice(0, n) });
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__fp.touches.size) === 8, '8 fingers all counted: ' + await p.evaluate(() => window.__fp.touches.size));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(100);
  ok(await p.evaluate(() => window.__fp.touches.size) === 0, 'all released');
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
