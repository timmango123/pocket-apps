// Bot for 雙軌疾行: perceives game state with a fixed reaction delay and steers via real keyboard events.
// Usage: node bot.js [reactionMs=150] [maxGameSeconds=240] [runs=3]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const REACT = +(process.argv[2] || 150), MAXT = +(process.argv[3] || 240), RUNS = +(process.argv[4] || 3);
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

function target(snap, side) {
  const os = snap.objs.filter(o => o.side === side && o.p < 1).sort((a, b) => b.p - a.p);
  if (!os.length) return null;
  const first = os[0];
  const row = os.filter(o => Math.abs(o.p - first.p) < 0.005);
  const c = row.find(o => o.kind !== 's');
  if (c) return c.lane;
  return 1 - first.lane;
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (let run = 0; run < RUNS; run++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL);
    await page.keyboard.press('Space');
    const hist = [];
    const lastPress = [0, 0];
    const trace = [];
    let s;
    while (true) {
      const now = Date.now();
      s = await page.evaluate(() => window.__game.getState());
      hist.push({ now, s });
      while (hist.length > 2 && hist[1].now <= now - REACT) hist.shift();
      trace.push({t: +s.t.toFixed(3), lanes: s.lanes.join(''), near: s.objs.filter(o=>o.p>0.55).map(o=>o.side+':'+o.kind+o.lane+'@'+o.p.toFixed(2)).join(' ')});
      if (trace.length > 30) trace.shift();
      if (s.state !== 'play' || s.deathT >= 0 || s.t > MAXT) break;
      const seen = hist[0].now <= now - REACT ? hist[0].s : null;
      if (seen) {
        for (const side of [0, 1]) {
          const tl = target(seen, side);
          if (tl != null && tl !== s.lanes[side] && now - lastPress[side] > 70) {
            lastPress[side] = now;
            await page.keyboard.press(side ? 'KeyJ' : 'KeyF');
          }
        }
      }
    }
    await page.waitForTimeout(100);
    const fin = await page.evaluate(() => window.__game.getState());
    results.push({ run, gameSeconds: +s.t.toFixed(1), score: fin.score, death: fin.deathInfo, errors });
    if (fin.deathInfo && process.env.TRACE) trace.slice(-14).forEach(x => console.log('   ', JSON.stringify(x)));
    console.log(JSON.stringify(results[results.length - 1]));
    await ctx.close();
  }
  await browser.close();
})();
