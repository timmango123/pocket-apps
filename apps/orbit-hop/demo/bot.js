// Reaction bot for 星軌跳躍 (orbit-hop).
// It only sees the game state as it was REACT ms ago, predicts the next launch window
// from that delayed snapshot, then taps through real touch input with gaussian motor jitter.
// usage: node bot.js [runs] [jitterMs] [react]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const RUNS = +(process.argv[2] || 5), JIT = +(process.argv[3] ?? 25), REACT = +(process.argv[4] || 150);
const URL = 'file://' + path.resolve(__dirname, '../index.html');
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL);
  const results = []; let comp = 0; const errsT = [];
  for (let run = 0; run < RUNS; run++) {
    await page.evaluate(s => __game.start(s), 1000 + run);
    const t0 = Date.now();
    while (true) {
      const st = await page.evaluate(() => __game.state());
      if (st.mode === 'over' || st.mode === 'dying') break;
      if (st.jumps >= 200 || Date.now() - t0 > 300000) break;
      // track continuously: re-plan from the (always REACT-ms-old) snapshot until the tap is close
      let plan = await page.evaluate(d => __game.botPlan(d), REACT);
      if (!plan) { await sleep(15); continue; }
      const tPlan = Date.now();
      while (plan && plan.wall - plan.now - comp > 70 && Date.now() - tPlan < 8000) {
        await sleep(Math.min(plan.wall - plan.now - comp - 50, 120));
        const p2 = await page.evaluate(d => __game.botPlan(d), REACT);
        if (!p2) break; plan = p2;
      }
      if (!plan) continue;
      const wait = plan.wall - plan.now - comp + gauss() * JIT;
      await sleep(wait);
      await page.touchscreen.tap(195, 640);
      // wait for the launch to resolve
      let s2;
      for (let k = 0; k < 400; k++) { await sleep(10); s2 = await page.evaluate(() => __game.state()); if (s2.mode !== 'play' || s2.astro.pi !== st.astro.pi || (s2.astro.st === 'orbit' && s2.astro.since > 0.2 && s2.lastLaunchT < plan.tg - 1)) break; }
      if (s2 && s2.lastLaunchT !== st.lastLaunchT && Math.abs(s2.lastLaunchT - plan.tg) < 0.4) { const e = (s2.lastLaunchT - plan.tg) * 1000; if (process.env.V) console.log("pi", st.astro.pi, "err", e.toFixed(0), "width", (plan.width*1000).toFixed(0), "wait", wait.toFixed(0), "mode", s2.mode); errsT.push(e); } if (process.env.V && s2) console.log('launch', st.astro.pi, 'tg', plan.tg.toFixed(3), 'got', s2.lastLaunchT.toFixed(3), 'w', plan.width.toFixed(3), s2.mode); if (s2 && s2.lastLaunchT !== st.lastLaunchT && Math.abs(s2.lastLaunchT - plan.tg) < 0.4) { const e = (s2.lastLaunchT - plan.tg) * 1000; if (errsT.length <= 40) comp = comp * 0.8 + e * 0.2; }
      if (s2 && s2.mode !== 'play') break;
    }
    await sleep(1300);
    const st = await page.evaluate(() => __game.state());
    results.push({ run, death: st.lastDeath, score: st.score, jumps: st.jumps, perfects: st.perfects, maxCombo: st.maxCombo, dust: st.dust });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  const m = errsT.reduce((a, b) => a + b, 0) / errsT.length, sd = Math.sqrt(errsT.reduce((a, b) => a + (b - m) ** 2, 0) / errsT.length);
  console.log('react', REACT, 'jitter', JIT, 'launch timing error vs plan: mean', m.toFixed(1), 'ms sd', sd.toFixed(1), 'ms');
  const sc = results.map(r => r.score), jp = results.map(r => r.jumps);
  console.log('scores', sc.join(','), 'jumps', jp.join(','), 'avg score', (sc.reduce((a, b) => a + b) / sc.length).toFixed(1));
  console.log('errors', errs);
  await b.close();
})();
