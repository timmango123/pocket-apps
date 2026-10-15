// 一筆繪境 auto-player: clears levels by dragging the solver's path with real touch events (CDP) at human pace,
// records mp4 + result screenshot into this folder.  node bot.js [levels...]
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { solve, decode } = require('./solver');
const DIR = __dirname;
const URL = 'file://' + path.join(DIR, '..', 'index.html');
const levels = process.argv.slice(2).map(Number);
if (!levels.length) levels.push(50, 75, 99, 100);
const html = fs.readFileSync(path.join(DIR, '..', 'index.html'), 'utf8');
const LEVELS = JSON.parse(html.match(/const LEVELS = (\[[\s\S]*?\n\]);/)[1]);

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const L of levels) {
    // independently solve the level (do not trust the embedded solution)
    const lv = decode(LEVELS[L - 1]);
    const r = solve(lv, 1, 5e7, 1);
    if (!r.sols.length) { results.push({ L, cleared: false, reason: 'solver found no solution' }); continue; }
    const sol = r.sols[0];
    const vdir = path.join(DIR, 'tmpvid-' + L);
    fs.rmSync(vdir, { recursive: true, force: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
      recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL);
    await page.waitForTimeout(700);
    // go through real UI: open level select, enable unlock-all, tap the tile
    await page.tap('#tSel');
    await page.waitForTimeout(400);
    const on = await page.getAttribute('#unlockSw', 'aria-checked');
    if (on !== 'true') await page.tap('#unlockSw');
    await page.waitForTimeout(300);
    const tile = page.locator(`.tile[data-l="${L}"]`);
    await tile.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await tile.tap();
    await page.waitForTimeout(900);
    const cdp = await ctx.newCDPSession(page);
    const centers = await page.evaluate(n => Array.from({ length: n }, (_, c) => __game.cellCenter(c)), lv.W * lv.H);
    const pt = async c => centers[c];
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    const t0 = Date.now();
    let p = await pt(sol[0]);
    await touch('touchStart', p.x, p.y);
    await page.waitForTimeout(250);
    for (let i = 1; i < sol.length; i++) {
      const q = await pt(sol[i]);
      const steps = 3, dur = 260 + Math.random() * 100, ts = Date.now(); // ~260-360 ms per cell
      for (let s = 1; s <= steps; s++) {
        const f = s / steps, e = f < .5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
        await touch('touchMove', p.x + (q.x - p.x) * e + (Math.random() - .5) * 2, p.y + (q.y - p.y) * e + (Math.random() - .5) * 2);
        const wait = ts + dur * s / steps - Date.now();
        if (wait > 4) await new Promise(r => setTimeout(r, wait));
      }
      p = q;
    }
    await touch('touchEnd', 0, 0);
    const playMs = Date.now() - t0;
    await page.waitForTimeout(2600);
    const st = await page.evaluate(() => __game.state());
    await page.screenshot({ path: path.join(DIR, `level-${L}-result.png`) });
    await ctx.close();
    const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
    const mp4 = path.join(DIR, `level-${L}.mp4`);
    execSync(`/usr/bin/ffmpeg -y -loglevel error -i "${path.join(vdir, webm)}" -c:v libx264 -pix_fmt yuv420p -crf 28 -movflags +faststart "${mp4}"`);
    fs.rmSync(vdir, { recursive: true, force: true });
    const res = { L, size: st.W + 'x' + st.H, cells: st.total, moves: sol.length - 1, cleared: st.won && st.path.length === st.total, resultShown: st.resultShown,
      gameTime: (st.time / 1000).toFixed(1) + 's', playMs, errors: errs, mp4MB: (fs.statSync(mp4).size / 1e6).toFixed(2) };
    console.log(JSON.stringify(res));
    results.push(res);
  }
  await browser.close();
  fs.writeFileSync(path.join(DIR, 'bot-results.json'), JSON.stringify(results, null, 1));
})();
