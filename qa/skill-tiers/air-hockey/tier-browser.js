// Browser spot-check of the tier sim: real page, real CDP touch, tier bot with wall-clock perception delay.
// Usage: node tier-browser.js tier:level[:seed] ...   -> appends to tier-browser.jsonl
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { makeTierBot } = require('./tierbot.js');
const OUT = __dirname, html = fs.readFileSync(path.resolve(__dirname, '../../../apps/air-hockey/index.html'), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tapSel(cdp, page, sel, after = 300) { const b = await page.locator(sel).boundingBox(); await T(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 7 }]); await sleep(50); await T(cdp, 'touchEnd', []); await sleep(after); }
(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r)); const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  for (const arg of process.argv.slice(2)) {
    const [tier, lv, sd] = arg.split(':'), n = +lv, seed = +(sd || 1);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(base); const cdp = await ctx.newCDPSession(page); await sleep(500);
    await tapSel(cdp, page, '#tSelect', 500);
    if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') await tapSel(cdp, page, '#unlockSw');
    await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(200);
    await tapSel(cdp, page, '.lt[data-n="' + n + '"]', 700); await tapSel(cdp, page, '#vGo', 200);
    const Ly = await page.evaluate(() => window.__game.layout()), bot = makeTierBot(tier, seed * 101 + n), hist = [];
    const t0 = Date.now(); let s = await page.evaluate(() => window.__game.state()), fx = s.mx, fy = s.my + Ly.offset, down = false, last = Date.now(), iters = 0, lagSum = 0;
    while (Date.now() - t0 < 6 * 60 * 1000) {
      const q0 = Date.now();
      s = (await cdp.send('Runtime.evaluate', { expression: 'window.__game.state()', returnByValue: true })).result.value; lagSum += Date.now() - q0; iters++;
      if (s.scene === 'result' || s.over) break;
      const now = Date.now(), tt = (now - t0) / 1000; hist.push(Object.assign({ at: now }, s));
      const D = bot.curDelay(tt) * 1000; while (hist.length > 2 && hist[1].at <= now - D) hist.shift();
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const seen = hist[0], tg = bot.plan(seen, tt, (now - seen.at) / 1000);
      const tx = tg.x, ty = tg.y + Ly.offset, dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy), stp = bot.T.fspd * dt;
      if (d <= stp) { fx = tx; fy = ty; } else { fx += dx / d * stp; fy += dy / d * stp; }
      fx = Math.max(-5, Math.min(365, fx)); fy = Math.min(652, Math.max(fy, 330));
      const p = { x: Ly.ox + fx * Ly.s, y: Ly.oy + fy * Ly.s };
      if (!down) await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); else cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }).catch(() => {});
      down = true; await sleep(8);
    }
    await T(cdp, 'touchEnd', []);
    const fin = await page.evaluate(() => window.__game.state());
    const r = { tier, level: n, seed, won: fin.winner === 1, score: fin.score[1] + '-' + fin.score[0], secs: Math.round((Date.now() - t0) / 1000), avgStateReadMs: +(lagSum / iters).toFixed(1), load: fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0], errors };
    console.log(JSON.stringify(r)); fs.appendFileSync(path.join(OUT, 'tier-browser.jsonl'), JSON.stringify(r) + '\n');
    await ctx.close();
  }
  await browser.close(); srv.close();
})();
