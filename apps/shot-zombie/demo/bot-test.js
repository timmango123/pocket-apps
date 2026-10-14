// Bot / smoke test for 射擊殭屍. Usage: node bot-test.js [outDir]
// The bot only "sees" zombies on screen (feet past VIS), picks the closest one,
// waits REACT ms (human-like reaction), then presses the lane key via a real keyboard event.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = process.argv[2] || __dirname;

const BOT = (react, noise) => `(() => {
  const g = window.__game; const keys = ['1','2','3','4'];
  let pending = false, lastSig = '';
  window.__bot = { presses: 0 }; window.__marks = {};
  function gauss(){ let u=Math.random()||1e-9, v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
  function tick(){
    const s = g.state();
    for (const m of [15,30,45]) if (s.kills >= m && !window.__marks[m]) window.__marks[m] = +s.time.toFixed(1);
    if (s.phase === 'play' && !pending) {
      let best = null, by = -1;
      for (const e of s.ents) { if (e.type !== 'z' || e.y <= g.VIS) continue;
        const py = e.y + ${noise} * gauss(); if (py > by) { by = py; best = e; } }
      if (best) {
        const sig = best.id + ':' + best.hp;
        if (sig !== lastSig) {
          lastSig = sig; pending = true;
          setTimeout(() => { pending = false;
            const k = keys[best.lane];
            window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
            window.__bot.presses++; }, ${react});
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})()`;

async function run(browser, mode, react, noise, maxMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(String(e))); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(300);
  if (process.env.TUNE) await page.evaluate(t => Object.assign(window.__game.TUNE, JSON.parse(t)), process.env.TUNE);
  await page.evaluate(m => window.__game.start(m), mode);
  await page.evaluate(BOT(react, noise));
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(500);
    const ph = await page.evaluate(() => window.__game.state().phase);
    if (ph === 'over' || ph === 'ending') break;
  }
  await page.waitForTimeout(1500);
  const s = await page.evaluate(() => window.__game.state());
  const marks = await page.evaluate(() => window.__marks || {});
  await ctx.close();
  return { mode, react, noise, phase: s.phase, kills: s.kills, score: s.score, wrong: s.wrong, time: +s.time.toFixed(2), penalty: s.penalty, rescued: s.rescued, lanes: s.lanes, marks, errs };
}

(async () => {
  const browser = await chromium.launch();
  const jobs = [];
  for (let i = 0; i < 3; i++) jobs.push(run(browser, 'surv', 150, 0, 400000));
  if (!process.env.QUICK) for (let i = 0; i < 2; i++) jobs.push(run(browser, 'surv', 150, 0.02, 400000));
  for (let i = 0; i < 2; i++) jobs.push(run(browser, 'surv', 300, 0, 400000));
  if (!process.env.QUICK) for (let i = 0; i < 1; i++) jobs.push(run(browser, 'ta', 150, 0, 60000));
  const res = await Promise.all(jobs);
  for (const r of res) console.log(JSON.stringify(r));
  await browser.close();
})();
