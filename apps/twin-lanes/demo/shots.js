// Screenshots + cover for 雙軌疾行. Uses a perfect in-page steering helper to reach mid-game.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const autoplay = () => {
  const G = window.__game;
  const tick = () => { const s = G.getState(); if (s.state !== 'play') return;
    for (const side of [0, 1]) { const os = s.objs.filter(o => o.side === side && o.p < 1).sort((a, b) => b.p - a.p); if (!os.length) continue;
      const row = os.filter(o => Math.abs(o.p - os[0].p) < 0.005); const c = row.find(o => o.kind !== 's'); const tl = c ? c.lane : 1 - os[0].lane;
      if (tl !== s.lanes[side] && os[0].p > 0.75) G.press(side); }
    requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};
(async () => {
  const b = await chromium.launch();
  let ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  let p = await ctx.newPage();
  await p.goto(URL); await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + '/title.png' });
  await p.tap('#startBtn'); await p.evaluate(autoplay);
  await p.waitForFunction(() => window.__game.getState().t > 45, null, { timeout: 120000, polling: 200 });
  await p.screenshot({ path: OUT + '/gameplay.png' });
  await ctx.close();
  ctx = await b.newContext({ viewport: { width: 300, height: 400 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  p = await ctx.newPage();
  await p.goto(URL); await p.waitForTimeout(300);
  await p.tap('#startBtn'); await p.evaluate(autoplay);
  await p.waitForFunction(() => { const s = window.__game.getState(); return s.t > 40 && s.objs.filter(o => o.p > 0.3 && o.p < 0.95).length >= 4 && s.combo > 20; }, null, { timeout: 120000, polling: 50 });
  await p.evaluate(() => { document.getElementById('pauseBtn').style.visibility = 'hidden'; document.getElementById('muteBtn').style.visibility = 'hidden'; });
  await p.screenshot({ path: '/mnt/project-files/apps/game-hub/covers/twin-lanes.jpg', type: 'jpeg', quality: 80 });
  await ctx.close();
  await b.close();
})();
