// End-to-end check of 禪意沙畫 (zen-sand) in Chromium: real touch strokes rake the sand, stones get placed, moved and
// lifted, smoothing + undo, sound toggle, snapshot download, persistence across reload, multi-touch, light/dark at
// 390×844 and the three in-lobby iframe sizes. Writes demo/cover-390x520.png (gitignored) for the lobby cover.
// Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname;
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); passed++; console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
async function open(browser, url, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme || 'light', acceptDownloads: true });
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await sleep(400);
  return { ctx, page, errors };
}
// real touch gestures through CDP so pointer events, capture and multi-touch all take the same path a finger does
async function drag(cdp, pts, steps = 12) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (let i = 1; i < pts.length; i++) for (let s = 1; s <= steps; s++) {
    const t = s / steps, x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await sleep(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(60);
}
// `until` (optional) is checked in the page after the tap; a tap that a browser gesture heuristic swallowed is retried
async function tapEl(cdp, page, sel, until) {
  for (let n = 0; n < 3; n++) {
    await sleep(120);
    try { await page.locator(sel).tap({ timeout: 3000 }); }
    catch (e) { const b = await page.locator(sel).boundingBox(); if (b) await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
    await sleep(120);
    if (!until || await page.evaluate(until)) return;
  }
}
const Z = (page, fn, arg) => page.evaluate(fn, arg);

(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- 1. main flows at 390×844, light ----
    {
      const { ctx, page, errors } = await open(browser, URL, { width: 390, height: 844 });
      const cdp = await ctx.newCDPSession(page);
      assert(await Z(page, () => __zen.sample()), 'first open builds the sample garden');
      const n0 = await Z(page, () => __zen.items().length);
      assert(n0 === 9 && (await Z(page, () => __zen.maxAbs())) > 0.5, `sample garden has ${n0} items and raked sand`);
      const w = await Z(page, () => [document.documentElement.scrollWidth, innerWidth]);
      assert(w[0] <= w[1], 'no horizontal scroll at 390');
      const small = await Z(page, () => [...document.querySelectorAll('button, a')].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').filter(e => !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'all tap targets >= 44px ' + JSON.stringify(small));
      await page.screenshot({ path: path.join(OUT, 'sample-390x844.png') });

      // rake a fresh patch: flat sand becomes grooved along the stroke
      await tapEl(cdp, page, '#mSmooth'); await sleep(1200);
      assert((await Z(page, () => __zen.maxAbs())) < 0.02, 'smooth-all flattens the sand');
      await tapEl(cdp, page, '#toastBtn'); await sleep(200);
      assert((await Z(page, () => __zen.maxAbs())) > 0.5, 'undo brings the raked sand back');
      await tapEl(cdp, page, '#mSmooth'); await sleep(1200);
      await drag(cdp, [[60, 200], [330, 200]]);
      await sleep(100);
      const prof = await Z(page, () => { const o = []; for (let y = 170; y <= 230; y += 2) o.push(__zen.heightAt(200, y)); return o; });
      const groove = Math.min(...prof), ridge = Math.max(...prof);
      assert(groove < -0.6 && ridge > 0.2, `a horizontal stroke leaves grooves (${groove.toFixed(2)}) and ridges (${ridge.toFixed(2)})`);
      assert(Math.abs(await Z(page, () => __zen.heightAt(200, 120))) < 0.01, 'sand away from the stroke stays flat');
      await tapEl(cdp, page, '[data-rake="1"]', () => __zen.rake() === 1);
      assert((await Z(page, () => __zen.rake())) === 1, 'single-tine rake selected');
      await drag(cdp, [[60, 500], [330, 500]]); await sleep(60);
      const prof1 = await Z(page, () => { let n = 0; for (let y = 470; y <= 530; y += 2) if (__zen.heightAt(200, y) < -0.5) n++; return n; });
      const prof5 = prof.filter(v => v < -0.5).length;
      assert(prof1 > 0 && prof1 < prof5, `single tine cuts one groove (${prof1} deep samples) vs five tines (${prof5})`);

      // clear the garden (menu), then stones: place, lines flow around, move, lift
      await tapEl(cdp, page, '#bMenu', () => !document.getElementById('menu').hidden); await sleep(150); await tapEl(cdp, page, '#aClear'); await sleep(1200);
      assert((await Z(page, () => __zen.items().length)) === 0 && (await Z(page, () => __zen.maxAbs())) < 0.02, 'clear garden removes items and flattens');
      await tapEl(cdp, page, '#mPlace', () => __zen.mode() === 'place');
      assert((await Z(page, () => __zen.mode())) === 'place', 'place mode on');
      await tap(cdp, 200, 650); await sleep(100);
      const items1 = await Z(page, () => __zen.items().map(i => i.t));
      assert(items1.length === 1 && items1[0] === 'stone', 'tap on empty sand places a stone');
      await tapEl(cdp, page, '#mRake', () => __zen.mode() === 'rake'); await tapEl(cdp, page, '[data-rake="5"]', () => __zen.rake() === 5);
      await drag(cdp, [[40, 650], [350, 650]]); await sleep(100);
      const under = await Z(page, () => Math.abs(__zen.heightAt(200, 650)));
      const beside = await Z(page, () => { let m = 0; for (let x = 60; x < 120; x += 2) m = Math.max(m, Math.abs(__zen.heightAt(x, 650))); return m; });
      assert(under < 0.05 && beside > 0.5, `raking across a stone: flat under it (${under.toFixed(2)}), grooved beside it (${beside.toFixed(2)})`);
      await tapEl(cdp, page, '#mPlace', () => __zen.mode() === 'place');
      await drag(cdp, [[200, 650], [120, 580]]); await sleep(100);
      const moved = await Z(page, () => { const i = __zen.items()[0]; return [Math.round(i.u * 390), Math.round(i.v * 844)]; });
      assert(Math.abs(moved[0] - 120) < 6 && Math.abs(moved[1] - 580) < 6, `drag moves the stone to ${moved}`);
      await tap(cdp, 120, 580); await sleep(100);
      assert((await Z(page, () => __zen.items().length)) === 0, 'tapping a stone lifts it off');
      for (const [sel, t, x, y] of [['[data-item="moss"]', 'moss', 90, 420], ['[data-item="lantern"]', 'lantern', 300, 440], ['[data-item="leaf"]', 'leaf', 200, 500]]) {
        await tapEl(cdp, page, sel); await tap(cdp, x, y); await sleep(60);
        assert((await Z(page, () => __zen.items()[__zen.items().length - 1].t)) === t, `placed ${t}`);
      }

      // rapid cross-region taps: 8 per second, every tap must place exactly one item (no swallowed or doubled touches)
      await tapEl(cdp, page, '#mPlace', () => __zen.mode() === 'place'); await tapEl(cdp, page, '[data-item="leaf"]');
      const n8 = await Z(page, () => __zen.items().length);
      for (let i = 0; i < 8; i++) { const x = (i % 2 ? 330 : 60) + (i >> 2) * 40, y = i % 4 < 2 ? 300 : 560; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(85); }
      await sleep(150);
      assert((await Z(page, () => __zen.items().length)) === n8 + 8, '8 taps/s across regions place exactly 8 leaves');
      await tapEl(cdp, page, '#mRake', () => __zen.mode() === 'rake'); await tapEl(cdp, page, '[data-rake="5"]', () => __zen.rake() === 5);
      await Z(page, () => { __zen.perfReset && __zen.perfReset(); });
      await drag(cdp, [[40, 640], [350, 640], [40, 600]], 20);
      const perf = await Z(page, () => __zen.perf().slice().sort((a, b) => a - b));
      assert(perf.length > 10 && perf[Math.floor(perf.length * 0.95)] < 12, `render cost while raking: p95 ${perf[Math.floor(perf.length * 0.95)].toFixed(1)} ms over ${perf.length} frames`);

      // a tool tap right after a rake stroke must land every time (Chromium used to drop ~1 in 7 of these clicks)
      {
        const box = async s => Z(page, s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
        const pP = await box('#mPlace'), pR = await box('#mRake');
        let landed = 0, handlerRuns = 0;
        await Z(page, () => { window.__modeClicks = 0; ['mPlace', 'mRake'].forEach(id => document.getElementById(id).addEventListener('click', () => window.__modeClicks++)); });
        for (let i = 0; i < 12; i++) {
          await drag(cdp, [[40, 300 + i * 20], [340, 300 + i * 20]], 4);
          await tap(cdp, pP[0], pP[1]); await sleep(120); if ((await Z(page, () => __zen.mode())) === 'place') landed++;
          await tap(cdp, pR[0], pR[1]); await sleep(120); if ((await Z(page, () => __zen.mode())) === 'rake') landed++;
        }
        handlerRuns = await Z(page, () => window.__modeClicks);
        assert(landed === 24 && handlerRuns === 24, `24 tool taps right after strokes: ${landed} landed, ${handlerRuns} activations (none dropped or doubled)`);
      }

      // multi-touch: two fingers rake two grooves at once
      await tapEl(cdp, page, '#mRake', () => __zen.mode() === 'rake'); await tapEl(cdp, page, '#mSmooth', () => __zen.smoothing()); await sleep(1200);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 250, id: 1 }, { x: 80, y: 350, id: 2 }] });
      for (let s = 1; s <= 15; s++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80 + s * 15, y: 250, id: 1 }, { x: 80 + s * 15, y: 350, id: 2 }] }); await sleep(12); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(100);
      const two = await Z(page, () => [__zen.heightAt(200, 250), __zen.heightAt(200, 350), __zen.heightAt(200, 300)]);
      assert(two[0] < -0.6 && two[1] < -0.6 && Math.abs(two[2]) < 0.05, `two fingers rake two separate grooves ${two.map(v => v.toFixed(2))}`);

      // sound
      await tapEl(cdp, page, '#bSound'); await sleep(300);
      assert((await Z(page, () => __zen.audio.on && !!__zen.audio.ctx && __zen.audio.ctx.state === 'running')) === true, 'sound toggle builds a running AudioContext');
      assert((await page.getAttribute('#bSound', 'aria-pressed')) === 'true', 'sound button pressed');
      await tapEl(cdp, page, '#bSound'); await sleep(100);
      assert((await Z(page, () => __zen.audio.on)) === false, 'sound toggles off');

      // snapshot download
      await tapEl(cdp, page, '#bMenu', () => !document.getElementById('menu').hidden); await sleep(150);
      assert(!(await page.locator('#menu').isHidden()), 'menu opens');
      await tapEl(cdp, page, '#aSave'); await sleep(600);
      assert(!(await page.locator('#snap').isHidden()) && (await Z(page, () => __zenLastSnapshot && __zenLastSnapshot.size > 5000)), 'snapshot PNG generated');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#snapDl').click()]);
      assert(/^zen-sand-.*\.png$/.test(dl.suggestedFilename()), 'download named ' + dl.suggestedFilename());
      await tapEl(cdp, page, '#snapClose');

      // theme toggle + persistence across reload
      await tapEl(cdp, page, '#bTheme'); await sleep(100);
      assert((await Z(page, () => __zen.isDark())) === true, 'theme toggles to dark');
      const before = await Z(page, () => ({ n: __zen.items().length, h: __zen.heightAt(200, 250) }));
      await Z(page, () => __zen.saveNow());
      await page.reload(); await sleep(500);
      const after = await Z(page, () => ({ n: __zen.items().length, h: __zen.heightAt(200, 250), dark: __zen.isDark(), sample: __zen.sample() }));
      assert(!after.sample && after.n === before.n && Math.abs(after.h - before.h) < 0.03 && after.dark, `garden, items and theme restored after reload (${after.n} items, h ${after.h.toFixed(2)})`);
      await page.screenshot({ path: path.join(OUT, 'dark-390x844.png') });
      // rotate with a stone right above the tray: in landscape it must move out from under the tray, and come back after
      await tapEl(cdp, page, '#mPlace', () => __zen.mode() === 'place');
      const tTop = await Z(page, () => document.querySelector('.tray').getBoundingClientRect().top);
      await tap(cdp, 330, tTop - 14); await sleep(150);
      const home = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1]; return [i.u * innerWidth, i.v * innerHeight]; });
      await page.setViewportSize({ width: 844, height: 390 }); await sleep(400);
      const land = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1], tr = document.querySelector('.tray').getBoundingClientRect(); return { y: i.v * innerHeight, trayTop: tr.top }; });
      assert(land.y <= land.trayTop - 10, `landscape keeps the stone above the tray (${land.y.toFixed(0)} vs tray ${land.trayTop.toFixed(0)})`);
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
      const back = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1]; return [i.u * innerWidth, i.v * innerHeight]; });
      assert(Math.abs(back[0] - home[0]) < 1 && Math.abs(back[1] - home[1]) < 1, `back in portrait the stone returns to its spot (${back.map(Math.round)})`);
      // two hands, two stones: both follow their own finger
      await tap(cdp, 90, 160); await sleep(120); await tap(cdp, 300, 160); await sleep(120);
      {
        const a = { x: 90, y: 160, id: 41 }, b = { x: 300, y: 160, id: 42 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await sleep(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
        for (let s = 1; s <= 16; s++) { a.y = b.y = 160 + 10 * s; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b] }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150);
      }
      const both = await Z(page, () => __zen.items().slice(-2).map(i => Math.round(i.v * innerHeight)));
      assert(both.every(y => Math.abs(y - 320) < 4), `two fingers drag two stones at once (${both})`);
      assert(errors.length === 0, 'no page errors: ' + errors.join(' | '));
      await ctx.close();
    }
    // ---- 2. the three in-lobby iframe sizes, light and dark: a stroke works, controls fit ----
    for (const vp of [[375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390]]) for (const scheme of (vp[0] === 375 || vp[0] === 390 ? ['light', 'dark'] : ['light'])) {
      const { ctx, page, errors } = await open(browser, URL, { width: vp[0], height: vp[1] }, scheme);
      const cdp = await ctx.newCDPSession(page);
      const fit = await Z(page, () => { const bs = [...document.querySelectorAll('.tray button, .tr button, .brand')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect()); const inside = bs.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight); const big = bs.slice(0, -1).every(r => r.width >= 44 && r.height >= 44); let overlap = false; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], c = bs[j]; if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 2 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 2) overlap = true; } return inside && big && !overlap && document.documentElement.scrollWidth <= innerWidth; });
      assert(fit, `${vp.join('x')} ${scheme}: every control on screen, >= 44px, none overlapping, no horizontal scroll`);
      await tapEl(cdp, page, '#mSmooth'); await sleep(1100);
      await drag(cdp, [[30, vp[1] * 0.6], [vp[0] - 30, vp[1] * 0.6]]); await sleep(80);
      assert((await Z(page, y => __zen.heightAt(innerWidth * 0.15, y), vp[1] * 0.6)) < -0.6, `${vp.join('x')} ${scheme}: stroke rakes`);
      assert((await Z(page, () => __zen.isDark())) === (scheme === 'dark'), `${vp.join('x')} ${scheme}: follows prefers-color-scheme`);
      if (vp[0] === 375 || vp[0] === 360 || vp[0] === 844) await page.screenshot({ path: path.join(OUT, `${scheme}-${vp.join('x')}.png`) });
      assert(errors.length === 0, `${vp.join('x')} ${scheme}: no page errors ` + errors.join(' | '));
      await ctx.close();
    }
    // ---- 3. cover: sample garden at 390×520 with the hint already gone ----
    {
      const { ctx, page, errors } = await open(browser, URL, { width: 390, height: 520 });
      await Z(page, () => { document.getElementById('hint').classList.add('gone'); });
      await sleep(1200);
      await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
      assert(fs.statSync(path.join(OUT, 'cover-390x520.png')).size > 20000 && errors.length === 0, 'cover-390x520.png written');
      await ctx.close();
    }
    console.log(`${passed} passed, 0 failed`);
  } catch (e) {
    console.log('FAIL', e.message); console.log(`${passed} passed, 1 failed`); process.exitCode = 1;
  } finally { await browser.close(); srv.close(); }
})();
