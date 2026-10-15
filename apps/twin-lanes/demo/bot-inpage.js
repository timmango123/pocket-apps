// In-page bot for 雙軌疾行: runs inside the page each animation frame so Node<->browser latency
// spikes don't distort the reaction delay. Perception is delayed by REACT ms of *game time*;
// inputs go through the game's real keydown handler (KeyboardEvent on window).
// Usage: node bot-inpage.js [reactionMs=150] [maxGameSeconds=300] [parallelRuns=4]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const REACT = +(process.argv[2] || 150), MAXT = +(process.argv[3] || 300), RUNS = +(process.argv[4] || 4);
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

function botMain({ REACT, MAXT }) {
  const G = window.__game, hist = [], lastPress = [-1, -1];
  window.__bot = { done: false };
  const target = (snap, side) => {
    const os = snap.objs.filter(o => o.side === side && o.p < 1).sort((a, b) => b.p - a.p);
    if (!os.length) return null;
    const row = os.filter(o => Math.abs(o.p - os[0].p) < 0.005);
    const c = row.find(o => o.kind !== 's');
    return c ? c.lane : 1 - os[0].lane;
  };
  const key = code => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  key('Space');
  const tick = () => {
    const s = G.getState();
    if (s.state !== 'play' || s.deathT >= 0 || s.t > MAXT) {
      window.__bot = { done: true, t: s.t, score: s.score, death: s.deathInfo };
      return;
    }
    hist.push(s);
    while (hist.length > 2 && hist[1].t <= s.t - REACT / 1000) hist.shift();
    const seen = hist[0].t <= s.t - REACT / 1000 ? hist[0] : null;
    if (seen) for (const side of [0, 1]) {
      const tl = target(seen, side);
      if (tl != null && tl !== s.lanes[side] && s.t - lastPress[side] > 0.06) { lastPress[side] = s.t; key(side ? 'KeyJ' : 'KeyF'); }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

(async () => {
  const browser = await chromium.launch();
  const runs = await Promise.all(Array.from({ length: RUNS }, async (_, i) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL);
    await page.evaluate(botMain, { REACT, MAXT });
    const w0 = Date.now();
    while (!(await page.evaluate(() => window.__bot && window.__bot.done))) {
      await page.waitForTimeout(5000);
      if (process.env.PROGRESS) console.log(i, ((Date.now() - w0) / 1000).toFixed(0) + 's wall', JSON.stringify(await page.evaluate(() => { const s = window.__game.getState(); return [s.state, +s.t.toFixed(1), s.score]; })));
    }
    const r = await page.evaluate(() => window.__bot);
    await ctx.close();
    const out = { run: i, gameSeconds: +r.t.toFixed(1), score: r.score, death: r.death, errors };
    console.log(JSON.stringify(out));
    return out;
  }));
  const ts = runs.map(r => r.gameSeconds);
  console.log(`reaction ${REACT}ms: survived ${ts.join(', ')} s (min ${Math.min(...ts)}, median ${ts.sort((a, b) => a - b)[Math.floor(ts.length / 2)]})`);
  await browser.close();
})();
