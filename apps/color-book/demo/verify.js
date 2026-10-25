// End-to-end check of 填色本 (color-book) in Chromium with real touch input (CDP Input.dispatchTouchEvent):
// colour a whole picture by tapping, wrong taps, line taps that snap to the nearest region, pinch zoom and pan, hints,
// completion card, time-lapse, PNG export, free colouring with undo, reset with undo, gallery, persistence across reload,
// rapid tapping (8 taps/s), light/dark at 390×844, the three in-lobby iframe sizes, 360×640, 430×932 and 844×390.
// Writes demo/cover-390x520.png (gitignored) for the lobby cover. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>\n' + SRC + '\n</body></html>';
const OUT = __dirname;
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); passed++; console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const external = [];

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  return new Promise(r => srv.listen(0, () => r(srv)));
}
async function open(browser, url, vp, scheme, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme || 'light', acceptDownloads: true });
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  page.on('request', r => { if (!r.url().startsWith(url) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });
  await page.goto(url);
  await page.waitForFunction(() => window.__cb && __cb.ready(), null, { timeout: 30000 });
  await sleep(200);
  return { ctx, page, errors, cdp: await ctx.newCDPSession(page) };
}
async function tap(cdp, x, y, hold = 40) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(30);
}
async function tapEl(cdp, page, sel) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); await sleep(120);
}
async function pinch(cdp, cx, cy, d0, d1, steps = 10) {
  const pts = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / steps) }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
}
async function drag(cdp, x0, y0, x1, y1, steps = 10) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); await sleep(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
}
const S = page => page.evaluate(() => __cb.state());
// visible on the canvas (not under a button) and big enough to hit
async function hittable(page, r, minPx) {
  return page.evaluate(([r, minPx]) => { const s = __cb.state(), [x, y] = __cb.toScreen(r.x, r.y), e = document.elementFromPoint(x, y); return r.r * s.view.s >= minPx && e && e.id === 'cv' ? [x, y] : null; }, [r, minPx]);
}
// colour by tapping: pick the selected colour's regions, use the hint button when nothing is hittable
async function colourBy(page, cdp, upto, minPx = 6) {
  let guard = 0;
  while (guard++ < 2000) {
    const s = await S(page); if (s.complete || s.filled >= upto) return s;
    let c = s.sel; if (!s.remain[c]) { await sleep(450); continue; }
    const regs = (await page.evaluate(c => __cb.regions().filter(r => !r.f && r.c === c), c)).sort((a, b) => b.r - a.r);
    let hit = null; for (const r of regs.slice(0, 12)) { hit = await hittable(page, r, minPx); if (hit) break; }
    if (!hit) { await tapEl(cdp, page, '#bHint'); await sleep(550); for (const r of regs) { hit = await hittable(page, r, minPx); if (hit) break; } }
    if (!hit) { await tapEl(cdp, page, '#bHint'); await sleep(550); continue; }
    await tap(cdp, hit[0], hit[1]); await sleep(15);
  }
  throw new Error('colouring did not finish');
}
async function noOverflow(page) { return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); }
async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('button')].filter(e => { if (e.closest('[hidden]') || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; })
    .map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 6) || e.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
}

(async () => {
  const srv = await serve(), URL = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---------- 1. full flow at 390×844 ----------
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
    let { page, errors, cdp } = await open(browser, URL, null, null, ctx);
    let s = await S(page);
    assert(s.no === 1 && s.filled === 0 && s.n >= 15, `first open shows picture No.1 ${s.name} (${s.n} regions, ${s.pal.length} colours)`);
    assert(await noOverflow(page), 'no horizontal scroll at 390');
    const small = await smallTargets(page); assert(small.length === 0, 'tap targets >= 44px ' + JSON.stringify(small));
    assert(await page.evaluate(() => !document.getElementById('coach').classList.contains('gone')), 'first-time coach tip is shown');
    // the selected colour's regions are highlighted grey
    const r1 = (await page.evaluate(() => __cb.regions().filter(r => r.c === __cb.state().sel)))[0];
    const px = await page.evaluate(r => __cb.pixel(r.x, r.y), r1);
    assert(px[0] < 235 && Math.abs(px[0] - px[1]) < 20, 'regions of the selected colour are shaded grey ' + px);
    // wrong tap: a region of another colour
    const other = (await page.evaluate(() => __cb.regions().filter(r => r.c !== __cb.state().sel).sort((a, b) => b.r - a.r)))[0];
    const op = await page.evaluate(r => __cb.toScreen(r.x, r.y), other);
    await tap(cdp, op[0], op[1]); await sleep(150);
    s = await S(page);
    assert(s.filled === 0 && s.rec.m === 1 && !(await page.locator('#bubble').isHidden()), 'a wrong tap fills nothing, counts a miss and shows which number it is');
    await page.locator('#bubble button').tap(); await sleep(150);
    assert((await S(page)).sel === other.c, 'tapping the number in the bubble switches to that colour');
    // correct tap
    await tap(cdp, op[0], op[1]); await sleep(600);
    s = await S(page);
    assert(s.filled === 1 && (await page.evaluate(r => __cb.regions()[r.k - 1].f, other)) === 1, 'tapping a region of the selected colour fills it');
    const want = await page.evaluate(([r]) => __cb.state().pal[r.c - 1], [other]);
    const got = await page.evaluate(r => __cb.pixel(r.x, r.y), other);
    assert('#' + got.map(v => v.toString(16).padStart(2, '0')).join('') === want, 'filled region shows its palette colour ' + want);
    await tap(cdp, op[0], op[1]); await sleep(200);
    assert((await S(page)).filled === 1 && (await S(page)).rec.m === 1, 'tapping an already filled region does nothing (no double count)');
    // colour the rest by touch
    s = await colourBy(page, cdp, 1e9);
    assert(s.complete && s.filled === s.n, `whole picture coloured by touch (${s.n} regions)`);
    await sleep(1800);
    assert(!(await page.locator('#done').isHidden()), 'completion card appears');
    assert((await page.evaluate(() => __cb.fx().lineAlpha)) < 0.5, 'outlines fade back for the reveal');
    s = await S(page);
    assert(s.rec.d === 1 && s.rec.b > 0 && s.rec.f === s.n, 'completion and best time recorded');
    await page.screenshot({ path: path.join(OUT, 'done-390x844.png') });
    // export
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await page.locator('#dSave').tap();
    const d = await dl; const fpath = await d.path(); const buf = fs.readFileSync(fpath);
    assert(d.suggestedFilename().endsWith('.png') && buf.slice(1, 4).toString() === 'PNG' && buf.length > 50000, `saves a PNG (${d.suggestedFilename()}, ${Math.round(buf.length / 1024)} KB)`);
    // time-lapse
    await page.locator('#dReplay').tap(); await sleep(400);
    assert((await page.evaluate(() => __cb.fx().replay)), 'time-lapse replay runs');
    await page.waitForFunction(() => !__cb.fx().replay, null, { timeout: 15000 }); await sleep(1900);
    assert(!(await page.locator('#done').isHidden()), 'card comes back after the replay');
    await page.locator('#done [data-close]').tap(); await sleep(200);
    assert(await page.locator('.pal .act').count() === 4, 'finished picture offers replay / save / free colouring / next');
    assert(await page.locator('#bHint').isHidden(), 'no hint button on a finished picture');
    // next picture
    await page.locator('.pal .act.main').tap(); await page.waitForFunction(() => __cb.ready() && __cb.state().no === 2, null, { timeout: 20000 });
    s = await S(page); assert(s.no === 2 && !s.complete, 'next goes to No.2 ' + s.name);
    // magnet: tap on a line next to a region of the selected colour
    const reg = (await page.evaluate(() => __cb.regions().filter(r => r.c === __cb.state().sel).sort((a, b) => b.r - a.r)))[0];
    const edge = await page.evaluate(r => { for (let d = 1; d < 200; d++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = r.x + dx * d, y = r.y + dy * d; if (__cb.regionAt(x, y) === 0) return __cb.toScreen(x + dx * 1, y + dy * 1); } return null; }, reg);
    await tap(cdp, edge[0], edge[1]); await sleep(500);
    assert((await S(page)).filled === 1, 'a tap on the outline fills the nearby region of the selected colour');
    // pinch zoom, pan, fit
    const v0 = (await S(page)).view;
    await pinch(cdp, 195, 400, 80, 240);
    const v1 = (await S(page)).view;
    assert(v1.s > v0.s * 2.2, `pinch zooms in (${v0.s.toFixed(2)} → ${v1.s.toFixed(2)})`);
    await drag(cdp, 200, 400, 120, 330);
    const v2 = (await S(page)).view;
    assert(Math.abs(v2.tx - v1.tx + 80) < 6 && Math.abs(v2.ty - v1.ty + 70) < 6, 'one-finger drag pans while zoomed');
    assert((await S(page)).filled === 1, 'pinch and pan do not fill anything');
    await page.locator('#zFit').tap(); await sleep(500);
    assert(Math.abs((await S(page)).view.s - v0.s) < 1e-6, 'fit button returns to the whole sheet');
    // hint
    await page.locator('#bHint').tap(); await sleep(700);
    s = await S(page);
    assert(s.view.s >= v0.s && (await page.evaluate(() => __cb.fx().pulse)), 'hint centres a remaining region and pulses it');
    // rapid taps: 8 per second alternating between different regions
    await page.locator('#zFit').tap().catch(() => {}); await sleep(500);
    const cand = (await page.evaluate(() => { const s = __cb.state(); return __cb.regions().filter(r => !r.f && r.c === s.sel && r.r * s.view.s >= 9).map(r => ({ ...r, p: __cb.toScreen(r.x, r.y) })); })).filter(r => r.p[1] > 70);
    const decoys = await page.evaluate(() => { const s = __cb.state(); return __cb.regions().filter(r => r.f).map(r => __cb.toScreen(r.x, r.y)); });
    const before = (await S(page)).filled, n8 = Math.min(6, cand.length);
    const t0 = Date.now();
    for (let i = 0; i < n8; i++) { await tap(cdp, cand[i].p[0], cand[i].p[1], 35); await sleep(50); if (decoys[0]) { await tap(cdp, decoys[0][0], decoys[0][1], 35); await sleep(5); } }
    const rate = (n8 * 2) / ((Date.now() - t0) / 1000);
    await sleep(700);
    assert((await S(page)).filled === before + n8, `rapid taps (${rate.toFixed(1)}/s, alternating) fill each target exactly once: ${n8}`);
    // free colouring
    await page.locator('#bMenu').tap(); await sleep(200); await page.locator('#mFree').tap(); await sleep(300);
    s = await S(page); assert(s.mode === 'free' && await page.locator('.sw').count() === 21, 'free colouring mode with its own palette + eraser');
    const fr = (await page.evaluate(() => __cb.regions().sort((a, b) => b.r - a.r)))[0];
    await page.locator('.sw[data-c="9"]').tap(); await sleep(100);
    const fp = await page.evaluate(r => __cb.toScreen(r.x, r.y), fr);
    await tap(cdp, fp[0], fp[1]); await sleep(500);
    assert((await page.evaluate(k => __cb.regions()[k - 1].fc, fr.k)) === 9, 'free mode paints any region with any colour');
    await page.locator('.sw[data-c="3"]').tap(); await sleep(100); await tap(cdp, fp[0], fp[1]); await sleep(500);
    await page.locator('#bUndo').tap(); await sleep(200);
    assert((await page.evaluate(k => __cb.regions()[k - 1].fc, fr.k)) === 9, 'undo restores the previous colour');
    assert((await S(page)).filled === before + n8, 'free colouring leaves the number progress alone');
    // persistence across reload
    await page.reload(); await page.waitForFunction(() => __cb.ready(), null, { timeout: 30000 }); await sleep(300);
    s = await S(page);
    assert(s.no === 2 && s.filled === before + n8, 'reload resumes the same picture with its progress');
    await page.evaluate(() => __cb.open(__cb.state().i, true)); await page.waitForFunction(() => __cb.ready()); await sleep(200);
    assert((await page.evaluate(k => __cb.regions()[k - 1].fc, fr.k)) === 9, 'free colouring survives reload');
    await page.evaluate(() => __cb.open(__cb.state().i)); await page.waitForFunction(() => __cb.ready()); await sleep(200);
    // reset with undo
    await page.locator('#bMenu').tap(); await sleep(200); await page.locator('#mReset').tap(); await sleep(200);
    await page.locator('#cfOk').tap(); await page.waitForFunction(() => __cb.ready()); await sleep(300);
    assert((await S(page)).filled === 0, 'reset clears the picture after confirming');
    await page.locator('#toast button').tap(); await page.waitForFunction(() => __cb.ready()); await sleep(300);
    assert((await S(page)).filled === before + n8, 'reset can be undone from the toast');
    // gallery
    await page.locator('#bBook').tap(); await sleep(500);
    assert(await page.locator('.card').count() === 100, 'gallery lists 100 pictures');
    assert(await page.locator('.card .ok').count() === 1, 'the finished picture is ticked');
    await page.screenshot({ path: path.join(OUT, 'book-390x844.png') });
    await page.locator('#chips button[data-cat="wip"]').tap(); await sleep(300);
    assert(await page.locator('.card').count() === 1, '進行中 filter shows the half-done picture');
    await page.locator('#chips button[data-cat="taiwan"]').tap(); await sleep(300);
    assert(await page.locator('.card').count() === 20, '台灣 filter shows 20');
    await page.locator('.card').nth(3).tap(); await page.waitForFunction(() => __cb.ready() && __cb.state().cat === 'taiwan', null, { timeout: 20000 });
    assert((await S(page)).cat === 'taiwan', 'tapping a card opens that picture');
    // theme toggle
    await page.locator('#bMenu').tap(); await sleep(200); await page.locator('#mTheme').tap(); await sleep(100); await page.locator('#mTheme').tap(); await sleep(150);
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme can be switched to dark');
    await page.locator('#menu [data-close]').tap(); await sleep(150);
    assert(errors.length === 0, 'no page errors in the full flow ' + errors.join(' | '));
    await ctx.close();

    // ---------- 2. sizes and themes ----------
    for (const [w, h] of [[375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [1280, 800]]) for (const scheme of ['light', 'dark']) {
      const o = await open(browser, URL, { width: w, height: h }, scheme);
      await o.page.evaluate(() => __cb.open(__cb.order()[30].i)); await o.page.waitForFunction(() => __cb.ready()); await sleep(250);
      await colourBy(o.page, o.cdp, 6, 8);
      assert(await noOverflow(o.page), `${w}×${h} ${scheme}: no horizontal scroll`);
      const sm = await smallTargets(o.page); assert(sm.length === 0, `${w}×${h} ${scheme}: targets >= 44px ${JSON.stringify(sm)}`);
      const geo = await o.page.evaluate(() => { const s = __cb.state(), st = document.getElementById('stage').getBoundingClientRect(), pal = document.getElementById('pal').getBoundingClientRect(); return { side: 1000 * s.view.s, st: [st.width, st.height], pal: [pal.width, pal.height, pal.bottom] }; });
      assert(geo.side >= Math.min(geo.st[0], geo.st[1]) * 0.85 && geo.pal[2] <= h + 1 && geo.pal[1] >= 56, `${w}×${h} ${scheme}: sheet fills the stage (${Math.round(geo.side)}px), palette on screen`);
      await o.page.screenshot({ path: path.join(OUT, `play-${w}x${h}-${scheme}.png`) });
      assert(o.errors.length === 0, `${w}×${h} ${scheme}: no page errors ` + o.errors.join(' | '));
      await o.ctx.close();
    }
    // rotation: portrait → landscape keeps the sheet whole
    {
      const o = await open(browser, URL, { width: 390, height: 844 });
      await o.page.setViewportSize({ width: 844, height: 390 }); await sleep(400);
      const g = await o.page.evaluate(() => { const s = __cb.state(), st = document.getElementById('stage').getBoundingClientRect(); return [s.view.tx, s.view.ty, 1000 * s.view.s, st.width, st.height]; });
      assert(g[0] >= 0 && g[1] >= 0 && g[0] + g[2] <= g[3] + 1 && g[1] + g[2] <= g[4] + 1, 'rotating to landscape refits the sheet');
      await o.ctx.close();
    }

    // ---------- 2b. review fixes: no sheet jump, two-finger rest, free mode across reload, landscape menu & tips ----------
    {
      const o = await open(browser, URL, { width: 390, height: 844 });
      await o.page.evaluate(() => __cb.open(__cb.order()[19].i)); await o.page.waitForFunction(() => __cb.ready()); await sleep(300);
      const v0 = (await S(o.page)).view;
      const r = (await o.page.evaluate(() => __cb.regions().filter(q => q.c === __cb.state().sel).sort((a, b) => b.r - a.r)))[0];
      const pt = await o.page.evaluate(q => __cb.toScreen(q.x, q.y), r); await tap(o.cdp, pt[0], pt[1]); await sleep(600);
      const v1 = (await S(o.page)).view;
      assert(Math.abs(v1.tx - v0.tx) < 0.5 && Math.abs(v1.ty - v0.ty) < 0.5, `the sheet stays put after the first touch (Δy ${(v1.ty - v0.ty).toFixed(1)})`);
      // two fingers resting on two grey regions, then lifted: nothing is filled and nothing counts as a miss
      const two = await o.page.evaluate(() => { const s = __cb.state(); return __cb.regions().filter(q => !q.f && q.c === s.sel).slice(0, 2).map(q => __cb.toScreen(q.x, q.y)); });
      const b0 = await S(o.page);
      if (two.length === 2) {
        await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: two[0][0], y: two[0][1], id: 1 }, { x: two[1][0], y: two[1][1], id: 2 }] }); await sleep(80);
        await o.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(500);
        const b1 = await S(o.page); assert(b1.filled === b0.filled && b1.rec.m === b0.rec.m, 'a two-finger rest is not two taps');
      }
      // free colouring survives a reload
      await o.page.evaluate(() => __cb.open(__cb.state().i, true)); await o.page.waitForFunction(() => __cb.ready()); await sleep(200);
      await o.page.reload(); await o.page.waitForFunction(() => window.__cb && __cb.ready(), null, { timeout: 30000 }); await sleep(300);
      assert((await S(o.page)).mode === 'free', 'free colouring mode comes back after a reload');
      await o.page.evaluate(() => __cb.open(__cb.state().i)); await o.page.waitForFunction(() => __cb.ready()); await sleep(200);
      await o.ctx.close();
      const L = await open(browser, URL, { width: 844, height: 390 });
      await L.page.evaluate(() => { localStorage.removeItem('color-book:v1:set'); }); await L.page.reload(); await L.page.waitForFunction(() => window.__cb && __cb.ready(), null, { timeout: 30000 }); await sleep(400);
      // every coach step must read in full at 844×390 (not clipped) and stay off the sheet
      const tipBox = () => L.page.evaluate(() => {
        const t = document.getElementById('tipW'), r = t.getBoundingClientRect(), st = document.getElementById('stage').getBoundingClientRect();
        return { gone: document.getElementById('coach').classList.contains('gone'), shown: !t.hidden && r.width > 0, text: t.textContent,
          clipped: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1, inView: r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
          offSheet: r.left >= st.right - 1, w: Math.round(r.width) };
      });
      const tp1 = await tipBox();
      assert(tp1.gone && tp1.shown && tp1.text === '選好顏色，點畫裡的灰色區塊' && !tp1.clipped && tp1.inView && tp1.offSheet, `landscape: coach step 1 reads in full beside the sheet (${JSON.stringify(tp1)})`);
      await colourBy(L.page, L.cdp, 3); await sleep(300);
      const tp2 = await tipBox();
      assert(tp2.shown && tp2.text === '小區塊用兩指放大，找不到就按燈泡' && !tp2.clipped && tp2.inView && tp2.offSheet, `landscape: coach step 2 reads in full beside the sheet (${JSON.stringify(tp2)})`);
      assert(/%/.test(await L.page.evaluate(() => document.getElementById('tSub').textContent)), 'landscape: the title line keeps the progress while a tip shows');
      await L.page.locator('#bMenu').tap(); await sleep(400);
      const cb = await L.page.evaluate(() => document.querySelector('#menu [data-close]').getBoundingClientRect().bottom);
      assert(cb <= 390, `landscape: the menu's 關閉 is on screen (bottom ${Math.round(cb)})`);
      await L.ctx.close();
    }

    // ---------- 3. cover ----------
    {
      const o = await open(browser, URL, { width: 390, height: 520 });
      const fox = await o.page.evaluate(() => __cb.order().find(p => p.name === '紅狐狸').i);
      await o.page.evaluate(i => __cb.open(i), fox); await o.page.waitForFunction(() => __cb.ready()); await sleep(200);
      const n = (await S(o.page)).n; await colourBy(o.page, o.cdp, Math.round(n * 0.72), 8);
      if (!(await o.page.locator('#zFit').isHidden())) { await o.page.locator('#zFit').tap(); await sleep(500); }
      await o.page.evaluate(() => { document.getElementById('coach').classList.add('gone'); }); await sleep(900);
      await o.page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
      assert(fs.statSync(path.join(OUT, 'cover-390x520.png')).size > 20000, 'cover written (mid-colouring)');
      await o.ctx.close();
    }
    assert(external.length === 0, 'no requests leave the page ' + external.slice(0, 3).join(' '));
    console.log(`\n${passed} checks passed`);
  } catch (e) {
    console.log('FAIL', e.message); process.exitCode = 1;
  } finally { await browser.close(); srv.close(); }
})();
