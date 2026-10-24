// End-to-end check of 禪意沙畫 (zen-sand) in Chromium: real touch strokes rake the sand, stones get placed, moved,
// selected, resized, turned and removed (with undo), undo of the last stroke, smoothing + undo, sound toggle and its
// muted icon, snapshot download, persistence across reload, multi-touch, rotation that never resamples the sand
// (3 round trips, groove depth unchanged; undo after rotation), the gallery, 今日臨摹 with stars, seasons, a v1 save
// migrating, the smoothing cost, and light/dark at the lobby iframe sizes plus 360×640, 430×932, 844×390 and 320×568.
// Writes demo/cover-390x520.png (gitignored) for the lobby cover. Run: node verify.js
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
async function open(browser, url, vp, scheme, opts = {}) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme || 'light', acceptDownloads: true, reducedMotion: opts.reducedMotion || 'no-preference' });
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
    try { await page.locator(sel).first().tap({ timeout: 3000 }); }
    catch (e) { const b = await page.locator(sel).first().boundingBox(); if (b) await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
    await sleep(120);
    if (!until || await page.evaluate(until)) return;
  }
}
const Z = (page, fn, arg) => page.evaluate(fn, arg);
const fieldSig = page => Z(page, () => { const f = __zen.field(); let s = 0, m = 0; for (let i = 0; i < f.h.length; i++) { s += f.h[i] * ((i % 97) + 1); m = Math.max(m, Math.abs(f.h[i])); } return { cols: f.cols, rows: f.rows, sum: s, max: m, copy: Array.from(f.h) }; });
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const rotate = async (page, w, h) => { await page.setViewportSize({ width: w, height: h }); await sleep(350); };
// min height along a short line across a groove, measured in the tray's own coordinates (gx, gy garden px)
const grooveAt = (page, gx, gy) => Z(page, ([gx, gy]) => { const z = __zen.size(), f = __zen.field(), c = z.GW / f.cols; let m = 0; for (let d = -8; d <= 8; d++) { const cx = Math.round(gx / c), cy = Math.round((gy + d) / c); m = Math.min(m, f.h[cy * f.cols + cx]); } return m; }, [gx, gy]);

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
      const small = await Z(page, () => [...document.querySelectorAll('button, a')].filter(e => e.getClientRects().length && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'all tap targets >= 44px ' + JSON.stringify(small));
      assert(await Z(page, () => !!document.querySelector('#bSound svg[data-muted]') && /關/.test(document.getElementById('bSound').getAttribute('aria-label'))), 'sound starts off and shows a muted speaker');
      assert(!(await page.locator('#menuDot').isHidden()), "menu shows a dot while today's pattern is untried");
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
      // undo the last stroke only: a second stroke goes, the first stays
      await drag(cdp, [[60, 130], [330, 130]]); await sleep(100);
      const u0 = await Z(page, () => __zen.undoCount());
      assert((await Z(page, () => __zen.heightAt(200, 130))) < -0.6, 'second stroke raked');
      await tapEl(cdp, page, '#mUndo'); await sleep(150);
      const afterUndo = await Z(page, () => [__zen.heightAt(200, 130), __zen.heightAt(200, 200), __zen.undoCount()]);
      assert(Math.abs(afterUndo[0]) < 0.02 && afterUndo[1] < -0.6 && afterUndo[2] === u0 - 1, `↶ removes only the last stroke (h ${afterUndo[0].toFixed(2)} there, ${afterUndo[1].toFixed(2)} on the first)`);
      await tapEl(cdp, page, '[data-rake="1"]', () => __zen.rake() === 1);
      assert((await Z(page, () => __zen.rake())) === 1, 'single-tine rake selected');
      await drag(cdp, [[60, 500], [330, 500]]); await sleep(60);
      const prof1 = await Z(page, () => { let n = 0; for (let y = 470; y <= 530; y += 2) if (__zen.heightAt(200, y) < -0.5) n++; return n; });
      const prof5 = prof.filter(v => v < -0.5).length;
      assert(prof1 > 0 && prof1 < prof5, `single tine cuts one groove (${prof1} deep samples) vs five tines (${prof5})`);

      // clear the garden (menu), then stones: place, lines flow around, move, select / resize / turn / remove / undo
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
      assert((await Z(page, () => __zen.selected())) === null, 'a drag does not select');
      await tap(cdp, 120, 580); await sleep(120);
      assert((await Z(page, () => __zen.items().length === 1 && __zen.selected() === __zen.items()[0])) && !(await page.locator('#subEdit').isHidden()) && (await page.locator('#subItem').isHidden()), 'a light tap selects the stone (nothing removed) and shows 放大／縮小／旋轉／移走');
      const s0 = await Z(page, () => __zen.items()[0].s);
      await tapEl(cdp, page, '#eBigger'); await tapEl(cdp, page, '#eBigger');
      const s1 = await Z(page, () => __zen.items()[0].s);
      assert(s1 > s0 * 1.3, `放大 twice grows the stone ${s0.toFixed(1)} -> ${s1.toFixed(1)}`);
      await tapEl(cdp, page, '#eSmaller'); assert((await Z(page, () => __zen.items()[0].s)) < s1, '縮小 shrinks it');
      const r0 = await Z(page, () => __zen.items()[0].rot);
      await tapEl(cdp, page, '#eRotate'); assert(Math.abs((await Z(page, () => __zen.items()[0].rot)) - r0) > 0.4, '旋轉 turns it');
      await tapEl(cdp, page, '#eRemove'); await sleep(100);
      assert((await Z(page, () => __zen.items().length)) === 0 && (await Z(page, () => document.getElementById('toastText').textContent)).includes('移走') && !(await page.locator('#toastBtn').isHidden()), '移走 removes it and offers 復原');
      await tapEl(cdp, page, '#toastBtn'); await sleep(100);
      const back1 = await Z(page, () => __zen.items().map(i => [i.t, Math.round(i.u * 390), Math.round(i.v * 844)]));
      assert(back1.length === 1 && back1[0][0] === 'stone' && Math.abs(back1[0][1] - 120) < 6, '復原 brings the stone back where it was');
      await tap(cdp, 120, 580); await sleep(100); await tapEl(cdp, page, '#eRemove'); await sleep(100);
      assert((await Z(page, () => __zen.items().length)) === 0 && (await page.locator('#subEdit').isHidden()), 'removed again; the tool tray is back to the item list');
      for (const [sel, t, x, y] of [['[data-item="moss"]', 'moss', 90, 420], ['[data-item="lantern"]', 'lantern', 300, 440], ['[data-item="leaf"]', 'leaf', 200, 520], ['[data-item="pebbles"]', 'pebbles', 90, 260], ['[data-item="pine"]', 'pine', 300, 250]]) {
        await tapEl(cdp, page, sel); await tap(cdp, x, y); await sleep(60);
        assert((await Z(page, () => __zen.items()[__zen.items().length - 1].t)) === t, `placed ${t}`);
      }
      // tapping empty sand while something is selected only lets go of it
      await tap(cdp, 90, 260); await sleep(80);
      const nSel = await Z(page, () => __zen.items().length);
      assert((await Z(page, () => __zen.selected() && __zen.selected().t)) === 'pebbles', 'tap selects the pebbles');
      await tap(cdp, 200, 360); await sleep(80);
      assert((await Z(page, () => __zen.selected())) === null && (await Z(page, () => __zen.items().length)) === nSel, 'a tap on empty sand deselects without placing');

      // rapid cross-region taps: 8 per second, every tap must place exactly one item (no swallowed or doubled touches)
      await tapEl(cdp, page, '#mPlace', () => __zen.mode() === 'place'); await tapEl(cdp, page, '[data-item="leaf"]');
      const n8 = await Z(page, () => __zen.items().length);
      for (let i = 0; i < 8; i++) { const x = (i % 2 ? 330 : 60) + (i >> 2) * 40, y = i % 4 < 2 ? 330 : 600; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(85); }
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

      // multi-touch: two fingers rake two grooves at once; the smoothing animation re-lights only a moving band
      await tapEl(cdp, page, '#mRake', () => __zen.mode() === 'rake');
      await Z(page, () => __zen.perfReset());
      await tapEl(cdp, page, '#mSmooth', () => __zen.smoothing()); await sleep(1200);
      const sp = await Z(page, () => __zen.smoothPerf());
      const spS = sp.ms.slice().sort((a, b) => a - b);
      assert(sp.ms.length > 4 && sp.avgRows <= sp.rows * 0.45, `smoothing re-lights ${sp.avgRows.toFixed(0)} of ${sp.rows} rows per frame on average (was all ${sp.rows}; max ${sp.maxRows}, median ${spS[Math.floor(spS.length / 2)].toFixed(1)} ms over ${sp.ms.length} frames)`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 80, y: 250, id: 1 }, { x: 80, y: 350, id: 2 }] });
      for (let s = 1; s <= 15; s++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 80 + s * 15, y: 250, id: 1 }, { x: 80 + s * 15, y: 350, id: 2 }] }); await sleep(12); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(100);
      const two = await Z(page, () => [__zen.heightAt(200, 250), __zen.heightAt(200, 350), __zen.heightAt(200, 300)]);
      assert(two[0] < -0.6 && two[1] < -0.6 && Math.abs(two[2]) < 0.05, `two fingers rake two separate grooves ${two.map(v => v.toFixed(2))}`);
      const uTwo = await Z(page, () => __zen.undoCount());
      await tapEl(cdp, page, '#mUndo'); await sleep(100);
      assert((await Z(page, () => Math.abs(__zen.heightAt(200, 250)) < 0.02 && Math.abs(__zen.heightAt(200, 350)) < 0.02 && __zen.undoCount())) === uTwo - 1, 'a two-finger stroke undoes as one step');

      // sound
      await tapEl(cdp, page, '#bSound'); await sleep(300);
      assert((await Z(page, () => __zen.audio.on && !!__zen.audio.ctx && __zen.audio.ctx.state === 'running')) === true, 'sound toggle builds a running AudioContext');
      assert((await page.getAttribute('#bSound', 'aria-pressed')) === 'true' && (await Z(page, () => !document.querySelector('#bSound svg[data-muted]'))), 'sound button pressed, speaker with sound waves');
      await tapEl(cdp, page, '#bSound'); await sleep(100);
      assert((await Z(page, () => __zen.audio.on)) === false && (await Z(page, () => !!document.querySelector('#bSound svg[data-muted]'))), 'sound toggles off, muted speaker again');

      // snapshot download
      await tapEl(cdp, page, '#bMenu', () => !document.getElementById('menu').hidden); await sleep(150);
      assert(!(await page.locator('#menu').isHidden()), 'menu opens');
      await tapEl(cdp, page, '#aSave', () => !document.getElementById('menu').hidden ? false : true);
      await page.waitForFunction(() => !document.getElementById('snap').hidden && window.__zenLastSnapshot, null, { timeout: 8000 }).catch(() => {});
      assert(!(await page.locator('#snap').isHidden()) && (await Z(page, () => __zenLastSnapshot && __zenLastSnapshot.size > 5000)), 'snapshot PNG generated');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#snapDl').click()]);
      assert(/^zen-sand-.*\.png$/.test(dl.suggestedFilename()), 'download named ' + dl.suggestedFilename());
      await tapEl(cdp, page, '#snapClose');

      // theme toggle + persistence across reload
      await tapEl(cdp, page, '#bTheme'); await sleep(100);
      assert((await Z(page, () => __zen.isDark())) === true, 'theme toggles to dark');
      await drag(cdp, [[60, 250], [330, 250]]); await sleep(80);
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
      const home = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1]; return __zen.screenOf(i); });
      await rotate(page, 844, 390);
      const land = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1], tr = document.querySelector('.tray').getBoundingClientRect(), p = __zen.screenOf(i); return { y: p[1], s: p[2], trayTop: tr.top }; });
      assert(land.y + land.s * 0.6 <= land.trayTop - 4, `landscape keeps the stone above the tray (${land.y.toFixed(0)} vs tray ${land.trayTop.toFixed(0)})`);
      await rotate(page, 390, 844);
      const back = await Z(page, () => { const i = __zen.items()[__zen.items().length - 1]; return __zen.screenOf(i); });
      assert(Math.abs(back[0] - home[0]) < 1 && Math.abs(back[1] - home[1]) < 1, `back in portrait the stone returns to its spot (${back.slice(0, 2).map(Math.round)})`);
      // two hands, two stones: both follow their own finger
      await tap(cdp, 90, 200); await sleep(120); await tap(cdp, 300, 200); await sleep(120);
      {
        const a = { x: 90, y: 200, id: 41 }, b = { x: 300, y: 200, id: 42 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] }); await sleep(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
        for (let s = 1; s <= 16; s++) { a.y = b.y = 200 + 10 * s; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b] }); await sleep(16); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(150);
      }
      const both = await Z(page, () => __zen.items().slice(-2).map(i => Math.round(i.v * innerHeight)));
      assert(both.every(y => Math.abs(y - 360) < 4), `two fingers drag two stones at once (${both})`);
      assert(errors.length === 0, 'no page errors: ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- 2. rotation keeps the sand: 3 portrait↔landscape round trips, groove depth unchanged; undo after rotating ----
    {
      const { ctx, page, errors } = await open(browser, URL, { width: 390, height: 844 });
      const cdp = await ctx.newCDPSession(page);
      await tapEl(cdp, page, '#mSmooth'); await sleep(1200);
      await drag(cdp, [[40, 300], [350, 300]]);
      const ring = []; for (let a = 0; a <= 48; a++) ring.push([200 + Math.cos(a / 48 * 6.283) * 90, 560 + Math.sin(a / 48 * 6.283) * 90]);
      await drag(cdp, ring, 2); await sleep(150);
      const sig0 = await fieldSig(page), d0 = await grooveAt(page, 200, 300), r0 = await grooveAt(page, 200, 650);
      assert(d0 < -0.9 && r0 < -0.6, `portrait: line groove ${d0.toFixed(2)}, ring groove ${r0.toFixed(2)}`);
      for (let k = 1; k <= 3; k++) {
        await rotate(page, 844, 390);
        const z = await Z(page, () => __zen.size());
        assert(z.rot === 1 && Math.abs(z.s - 1) < 1e-9 && z.cols === sig0.cols && z.rows === sig0.rows, `round trip ${k}: landscape shows the same ${z.cols}×${z.rows} tray turned a quarter, scale ${z.s}`);
        if (k === 1) {
          // the ring stays a circle on screen: its groove sits 90 px from the centre both across and along the screen
          const c = await Z(page, () => { const z = __zen.size(); return [z.ox + z.s * (z.GH - 560), z.oy + z.s * 200]; });
          const hx = await Z(page, ([x, y]) => { let m = 0; for (let d = -6; d <= 6; d++) m = Math.min(m, __zen.heightAt(x + 90 + d, y)); return m; }, c);
          const hy = await Z(page, ([x, y]) => { let m = 0; for (let d = -6; d <= 6; d++) m = Math.min(m, __zen.heightAt(x, y + 90 + d)); return m; }, c);
          assert(hx < -0.5 && hy < -0.5, `landscape: the ring is still round (groove 90 px out across ${hx.toFixed(2)} and down ${hy.toFixed(2)})`);
          await page.screenshot({ path: path.join(OUT, 'rotated-844x390.png') });
        }
        await rotate(page, 390, 844);
      }
      const sig1 = await fieldSig(page), d1 = await grooveAt(page, 200, 300), r1 = await grooveAt(page, 200, 650);
      assert(sig1.cols === sig0.cols && sig1.rows === sig0.rows && maxDiff(sig0.copy, sig1.copy) === 0, 'after 3 round trips the height map is bit-for-bit the same');
      assert(d1 === d0 && r1 === r0, `groove depth unchanged after 3 round trips: line ${d0.toFixed(3)} -> ${d1.toFixed(3)}, ring ${r0.toFixed(3)} -> ${r1.toFixed(3)}`);
      await Z(page, () => __zen.saveNow()); await page.reload(); await sleep(500);
      assert(Math.abs((await grooveAt(page, 200, 300)) - d0) < 0.01, 'and the saved garden keeps it after a reload');
      // smooth in portrait, rotate, press 復原: the sand comes back exactly, not scrambled
      const pre = await fieldSig(page);
      await tapEl(cdp, page, '#mSmooth'); await sleep(1200);
      await rotate(page, 844, 390);
      await tapEl(cdp, page, '#toastBtn'); await sleep(250);
      const post = await fieldSig(page);
      assert(maxDiff(pre.copy, post.copy) === 0, 'smooth → rotate → 復原 restores the sand exactly');
      await page.screenshot({ path: path.join(OUT, 'undo-after-rotate-844x390.png') });
      // a landscape garden opened on a portrait screen is turned, not stretched
      await tapEl(cdp, page, '#bMenu', () => !document.getElementById('menu').hidden); await tapEl(cdp, page, '#aGallery', () => !document.getElementById('gal').hidden);
      await tapEl(cdp, page, '#gNew', () => document.getElementById('gal').hidden);
      const lz = await Z(page, () => __zen.size());
      assert(lz.GW === 844 && lz.GH === 390 && lz.rot === 0, 'a new garden made in landscape is a landscape tray');
      await rotate(page, 390, 844);
      const pz = await Z(page, () => __zen.size());
      assert(pz.GW === 844 && pz.rot === 1 && Math.abs(pz.s - 1) < 1e-9, 'shown in portrait it is turned a quarter at full size');
      assert(errors.length === 0, 'rotation: no page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- 3. gallery, 今日臨摹, seasons, v1 migration ----
    {
      const { ctx, page, errors } = await open(browser, URL, { width: 390, height: 844 });
      const cdp = await ctx.newCDPSession(page);
      const openMenu = () => tapEl(cdp, page, '#bMenu', () => !document.getElementById('menu').hidden);
      // gallery: a second garden, switch back and forth, delete with undo, survives reload
      await openMenu(); await tapEl(cdp, page, '#aGallery', () => !document.getElementById('gal').hidden);
      assert((await page.locator('#tiles .tile').count()) === 1 && (await page.locator('#tiles .tile img').count()) === 1, 'gallery lists the sample garden with a thumbnail');
      await tapEl(cdp, page, '#gNew', () => document.getElementById('gal').hidden);
      assert((await Z(page, () => __zen.items().length)) === 0 && (await Z(page, () => __zen.maxAbs())) < 0.01 && (await Z(page, () => __zen.gallery().list.length)) === 2, 'new garden: flat sand, no items, two gardens');
      await drag(cdp, [[60, 400], [330, 400]]); await sleep(100);
      await openMenu(); await tapEl(cdp, page, '#aGallery', () => !document.getElementById('gal').hidden);
      assert((await page.locator('#tiles .tile img').count()) === 2, 'both tiles have thumbnails');
      await tapEl(cdp, page, '#tiles .tile:not(.cur) .open', () => document.getElementById('gal').hidden);
      assert((await Z(page, () => __zen.items().length)) === 9, 'switching back opens the sample garden (9 items)');
      await openMenu(); await tapEl(cdp, page, '#aGallery', () => !document.getElementById('gal').hidden);
      await tapEl(cdp, page, '#tiles .tile:not(.cur) .open', () => document.getElementById('gal').hidden);
      assert((await Z(page, () => __zen.heightAt(200, 400))) < -0.6 && (await Z(page, () => __zen.items().length)) === 0, 'and the second garden kept its stroke');
      await openMenu(); await tapEl(cdp, page, '#aGallery', () => !document.getElementById('gal').hidden);
      await tapEl(cdp, page, '#tiles .tile:not(.cur) .del', () => __zen.gallery().list.length === 1);
      assert((await Z(page, () => __zen.gallery().list.length)) === 1 && !(await page.locator('#toastBtn').isHidden()), 'delete removes a garden and offers 復原');
      await tapEl(cdp, page, '#toastBtn', () => __zen.gallery().list.length === 2);
      assert((await Z(page, () => __zen.gallery().list.length)) === 2 && (await Z(page, () => !!localStorage.getItem('zen-sand:v1:g:' + __zen.gallery().list.find(e => e.id !== __zen.gallery().cur).id))), '復原 brings the deleted garden back');
      await tapEl(cdp, page, '#galClose', () => document.getElementById('gal').hidden);

      // three older copy gardens: entering today's keeps only the two newest of them
      await Z(page, () => { const g = __zen.galRef(), raw = localStorage.getItem('zen-sand:v1:garden'); ['2026-01-01', '2026-01-03', '2026-01-02'].forEach((d, i) => { g.list.push({ id: 'old' + i, t: Date.now(), u: Date.now(), daily: d }); localStorage.setItem('zen-sand:v1:g:old' + i, raw); }); __zen.saveNow(); });
      // 今日臨摹: a new tray with the day's stones and a reference card; copying it well earns three stars
      await openMenu(); await tapEl(cdp, page, '#aDaily', () => !document.getElementById('daily').hidden);
      const plan = await Z(page, () => __zen.dailyPlan());
      assert(plan && plan.strokes.length >= 3 && (await Z(page, () => __zen.items().filter(i => i.t === 'stone').length)) === plan.stones.length && !!(await Z(page, () => __zen.daily())), `今日臨摹 opens 「${plan && plan.name}」 with ${plan && plan.stones.length} stones and ${plan && plan.strokes.length} strokes to copy`);
      const kept = await Z(page, () => __zen.gallery().list.filter(e => e.daily).map(e => e.daily).sort().join(','));
      assert(/^2026-01-02,2026-01-03,\d{4}-\d\d-\d\d$/.test(kept) && (await Z(page, () => !localStorage.getItem('zen-sand:v1:g:old0'))), 'copy gardens are kept for the last three days only: ' + kept);
      const cardBottom = await Z(page, () => document.getElementById('daily').getBoundingClientRect().bottom);
      const stoneY = await Z(page, () => Math.min(...__zen.items().map(i => __zen.screenOf(i)[1] - __zen.screenOf(i)[2])));
      assert(stoneY > cardBottom, 'the day\'s stones sit below the reference card');
      await tapEl(cdp, page, '#dRef', () => __zen.ghost());
      assert(await Z(page, () => __zen.ghost()), 'tapping the card lays the pattern over the sand');
      await page.screenshot({ path: path.join(OUT, 'daily-ghost-390x844.png') });
      await tapEl(cdp, page, '#dCheck', () => !document.getElementById('res').hidden);
      const empty = await Z(page, () => __zen.lastScore());
      assert(empty.stars === 0 && empty.score < 0.1, `untouched sand scores 0 stars (${(empty.score * 100).toFixed(0)}%)`);
      await tapEl(cdp, page, '#resClose', () => document.getElementById('res').hidden);
      const W = 390;
      for (const s of plan.strokes) await drag(cdp, s.pts.map(p => [Math.min(W - 2, Math.max(2, p[0])), p[1]]), s.pts.length > 10 ? 2 : 16);
      await sleep(150);
      await tapEl(cdp, page, '#dCheck', () => !document.getElementById('res').hidden);
      const good = await Z(page, () => __zen.lastScore());
      assert(good.stars === 3 && good.score > 0.82 && (await page.locator('#resStars .on').count()) === 3, `copying the pattern stroke by stroke earns ★★★ (${(good.score * 100).toFixed(0)}%)`);
      await page.screenshot({ path: path.join(OUT, 'daily-result-390x844.png') });
      await tapEl(cdp, page, '#resClose', () => document.getElementById('res').hidden);
      assert(await Z(page, () => { const r = JSON.parse(localStorage.getItem('zen-sand:v1:daily')); const k = Object.keys(r)[0]; return r[k].s === 3; }), 'the best stars are recorded for the day');
      await Z(page, () => __zen.saveNow()); await page.reload(); await sleep(500);
      assert((await Z(page, () => !!__zen.daily())) && (await page.locator('#dBest').textContent()).includes('★★★') && (await page.locator('#menuDot').isHidden()), 'after reload the daily garden is open, shows ★★★, and the menu dot is gone');
      // seasons: winter tints the sand, snow drifts, and the choice is saved with the garden
      await openMenu(); await tapEl(cdp, page, '[data-season="winter"]', () => __zen.season() === 'winter');
      await tapEl(cdp, page, '#menuClose'); await sleep(1500);
      assert((await Z(page, () => __zen.season())) === 'winter' && (await Z(page, () => __zen.fx().kind)) === 'snow' && (await page.locator('#brandSub').textContent()).length > 0, 'winter: snow drifts over the tray');
      await page.screenshot({ path: path.join(OUT, 'winter-390x844.png') });
      await Z(page, () => __zen.saveNow()); await page.reload(); await sleep(400);
      assert((await Z(page, () => __zen.season())) === 'winter', 'the season is saved with the garden');
      assert(errors.length === 0, 'gallery/daily: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // ---- 3b. a garden saved by the previous version (v1: W/H, no gallery) opens as it was and joins the gallery ----
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await ctx.addInitScript(core => {
        if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
        const ZS = new Function(core + ';return ZS;')(), f = ZS.makeField(180, 320); ZS.applyStroke(f, 5, [[10, 100], [170, 100]], [], null);
        const o = ZS.serialize(f); o.v = 1; o.W = 360; o.H = 640; o.items = [{ t: 'stone', u: 0.5, v: 0.6, s: 30, rot: 0.2, seed: 5 }];
        localStorage.setItem('zen-sand:v1:garden', JSON.stringify(o));
      }, SRC.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1]);
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(URL); await sleep(500);
      const mig = await Z(page, () => ({ z: __zen.size(), n: __zen.items().length, sample: __zen.sample(), h: __zen.field().h[100 * 180 + 90] }));
      assert(!mig.sample && mig.n === 1 && mig.z.GW === 360 && mig.z.GH === 640 && mig.z.cols === 180 && mig.h < -0.9, `a v1 save loads unchanged (tray 360×640, ${mig.z.cols}×${mig.z.rows}, groove ${mig.h.toFixed(2)}) shown at scale ${mig.z.s.toFixed(3)}`);
      await Z(page, () => __zen.saveNow());
      assert(await Z(page, () => { const g = JSON.parse(localStorage.getItem('zen-sand:v1:gallery')), o = JSON.parse(localStorage.getItem('zen-sand:v1:garden')); return g.list.length === 1 && o.v === 2 && o.W === 360 && o.GW === 360 && o.cols === 180; }), 'saving it writes v2 (W/H kept for older readers) and starts the gallery');
      await page.reload(); await sleep(400);
      assert((await Z(page, () => __zen.items().length === 1 && __zen.size().GW === 360 && !__zen.sample())), 'and it reloads the same way');
      assert(errors.length === 0, 'migration: no page errors ' + errors.join(' | '));
      await ctx.close();
    }

    // ---- 4. every size, light and dark: controls fit, a stroke works, nothing sits under the hint or the chips ----
    for (const vp of [[375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [320, 568]]) for (const scheme of (vp[0] === 375 || vp[0] === 390 ? ['light', 'dark'] : ['light'])) {
      const { ctx, page, errors } = await open(browser, URL, { width: vp[0], height: vp[1] }, scheme);
      const cdp = await ctx.newCDPSession(page);
      const fit = await Z(page, () => { const bs = [...document.querySelectorAll('.tray button, .tr button, .brand')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect()); const inside = bs.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight); const big = bs.slice(0, -1).every(r => r.width >= 44 && r.height >= 44); let overlap = false; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], c = bs[j]; if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 2 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 2) overlap = true; } return inside && big && !overlap && document.documentElement.scrollWidth <= innerWidth; });
      assert(fit, `${vp.join('x')} ${scheme}: every control on screen, >= 44px, none overlapping, no horizontal scroll`);
      // sample items: clear of the hint, and whole (a lantern's roof included) below the top chips
      const clash = await Z(page, () => {
        const h = document.getElementById('hint').getBoundingClientRect(), chips = [document.querySelector('.brand'), document.querySelector('.tr')].map(e => e.getBoundingClientRect()), out = [];
        for (const it of __zen.items()) {
          const [x, y, s] = __zen.screenOf(it), lan = it.t === 'lantern', box = { l: x - s * (lan ? 1.05 : 0.9), r: x + s * (lan ? 1.05 : 0.9), t: y - s * (lan ? 3.25 : 0.8), b: y + s * 0.6 };
          const hit = r => Math.min(box.r, r.right) - Math.max(box.l, r.left) > 0 && Math.min(box.b, r.bottom) - Math.max(box.t, r.top) > 0;
          if (hit(h)) out.push(it.t + ' under hint');
          chips.forEach(c => { if (hit(c)) out.push(it.t + ' under chips'); });
          if (lan) { const tr = chips[1]; if (box.r > tr.left && box.t < tr.bottom + 4) out.push('lantern roof at the buttons'); }
        }
        return out;
      });
      assert(clash.length === 0, `${vp.join('x')} ${scheme}: sample items clear of the hint, chips and buttons ${clash.join(', ')}`);
      if (vp[0] <= 360) {
        await Z(page, () => { document.getElementById('hint').classList.add('gone'); });
        await tapEl(cdp, page, '#mSmooth', () => !document.getElementById('toast').hidden);
        const gap = await Z(page, () => { const t = document.getElementById('toast').getBoundingClientRect(), b = document.querySelector('.brand').getBoundingClientRect(), tr = document.querySelector('.tray').getBoundingClientRect(); return { top: t.top - b.bottom, bottom: tr.top - t.bottom, fits: t.left >= 0 && t.right <= innerWidth }; });
        assert(gap.top > 100 && gap.bottom >= 8 && gap.fits, `${vp.join('x')}: the toast sits above the tool tray (${gap.bottom.toFixed(0)} px gap), far from the title card`);
        if (vp[0] === 360) await page.screenshot({ path: path.join(OUT, 'toast-360x640.png') });
        await sleep(1100);
      } else { await tapEl(cdp, page, '#mSmooth'); await sleep(1100); }
      await drag(cdp, [[30, vp[1] * 0.6], [vp[0] - 30, vp[1] * 0.6]]); await sleep(80);
      assert((await Z(page, y => __zen.heightAt(innerWidth * 0.15, y), vp[1] * 0.6)) < -0.6, `${vp.join('x')} ${scheme}: stroke rakes`);
      assert((await Z(page, () => __zen.isDark())) === (scheme === 'dark'), `${vp.join('x')} ${scheme}: follows prefers-color-scheme`);
      if (vp[0] === 375 || vp[0] === 360 || vp[0] === 844) await page.screenshot({ path: path.join(OUT, `${scheme}-${vp.join('x')}.png`) });
      assert(errors.length === 0, `${vp.join('x')} ${scheme}: no page errors ` + errors.join(' | '));
      await ctx.close();
    }
    // ---- 5. cover: sample garden at 390×520 with the hint already gone ----
    {
      const { ctx, page, errors } = await open(browser, URL, { width: 390, height: 520 }, 'light', { reducedMotion: 'reduce' });
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
