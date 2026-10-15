// 手寫簽名板：手指觸控（接觸面積大）一定要能寫；用過觸控筆之後，大面積觸控才當成手掌忽略。
// Usage: node tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const strokes = () => p.evaluate(() => !document.getElementById('clearBtn').disabled);
  async function finger(rad) {
    const r = await p.locator('#cv').boundingBox(); let x = r.x + 40, y = r.y + r.height / 2;
    const tp = () => [{ x, y, radiusX: rad, radiusY: rad, force: 1, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp() });
    for (let i = 0; i < 15; i++) { x += 12; y += i % 2 ? 8 : -8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp() }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(80);
  }
  for (const rad of [2, 12, 25]) {
    await p.goto(url); await p.waitForTimeout(200);
    await finger(rad);
    ok(await strokes(), `finger touch radius ${rad} draws a stroke`);
  }
  // after a stylus stroke, a wide touch (palm) is ignored
  await p.goto(url); await p.waitForTimeout(200);
  await p.evaluate(() => {
    const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
    const ev = (t, x) => new PointerEvent(t, { pointerId: 7, pointerType: 'pen', isPrimary: true, pressure: 0.6, clientX: r.left + x, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
    cv.dispatchEvent(ev('pointerdown', 30)); cv.dispatchEvent(ev('pointermove', 80)); cv.dispatchEvent(ev('pointerup', 120));
    document.getElementById('clearBtn').click();
  });
  ok(!(await strokes()), 'cleared after pen stroke');
  await finger(25);
  ok(!(await strokes()), 'wide touch after pen use is ignored as a palm');
  await b.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
