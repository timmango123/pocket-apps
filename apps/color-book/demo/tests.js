// Tests for 填色本 (color-book).
// Part 1: the pure core between CORE markers (region labelling, distance map, culling, owner map, codecs, view maths).
// Part 2: every one of the 100 pictures built in Chromium: region counts match the baked COUNTS, every region's number
// point lies inside that region and is big enough to tap, palettes are sane, categories and difficulty spread.
// Part 3: play with real touch input (CDP Input.dispatchTouchEvent) at 390×844: export leaves out the grey highlight,
// progress survives an immediate reload, zoomed-in outlines cover the fill edge, pinches never fill, a double tap
// fills one piece, free-colouring undo/redo, a tap skips the time-lapse, a full storage drops thumbnails before
// progress, bad saved numbers are ignored, a picture opened while another builds is not lost.
// Usage: node tests.js            (parts 2–3 need Playwright; set CORE_ONLY=1 to skip them; CB_HTML=file tests another copy)
const fs = require('fs'), path = require('path'), http = require('http');
const html = fs.readFileSync(process.env.CB_HTML || path.resolve(__dirname, '..', 'index.html'), 'utf8');
const CB = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return CB;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

// ---------- part 1: core ----------
function maskFrom(rows) { const H = rows.length, W = rows[0].length, m = new Uint8Array(W * H); rows.forEach((r, y) => [...r].forEach((ch, x) => { m[y * W + x] = ch === '#' ? 1 : 0; })); return { m, W, H }; }
{
  const { m, W, H } = maskFrom(['....#....', '....#....', '....#....', '#########', '....#....']);
  const { lab, n } = CB.label(m, W, H);
  ok(n === 4, 'a cross splits a grid into 4 regions: ' + n);
  ok(lab[0] === 1 && lab[8] === 2 && lab[4 * W] === 3 && lab[4 * W + 8] === 4, 'labels follow scan order');
  ok(lab[4] === 0 && lab[3 * W] === 0, 'line pixels are 0');
}
{ // diagonal touch does not connect (4-connectivity)
  const { m, W, H } = maskFrom(['.#', '#.']);
  ok(CB.label(m, W, H).n === 2, 'diagonal neighbours stay separate');
}
{ // U shape merges through union-find (two provisional labels joined later)
  const { m, W, H } = maskFrom(['.#.', '.#.', '...']);
  const { lab, n } = CB.label(m, W, H);
  ok(n === 1 && lab[0] === lab[2], 'U-shaped region gets one label');
}
{ // ring: inside and outside are separate
  const W = 60, H = 60, m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.hypot(x - 30, y - 30); if (d > 18 && d < 21) m[y * W + x] = 1; }
  ok(CB.label(m, W, H).n === 2, 'circle outline makes inside + outside');
}
{ // distance map
  const W = 41, H = 41, m = new Uint8Array(W * H);
  for (let i = 0; i < W; i++) { m[i] = m[(H - 1) * W + i] = m[i * W] = m[i * W + W - 1] = 1; }
  const { lab } = CB.label(m, W, H); const d = CB.distance(lab, W, H);
  ok(Math.abs(d[20 * W + 20] - 20) < 1.2, 'centre of a 41px box is ~20 from the border: ' + d[20 * W + 20].toFixed(2));
  ok(d[0] === 0 && Math.abs(d[W + 1] - 1) < 0.01, 'line pixel 0, next pixel 1');
}
{ // analyze: slivers are culled, poles inside, owner covers everything
  const W = 200, H = 120, m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { m[y * W + 100] = 1; m[y * W + 101] = 1; m[y * W + 104] = 1; } // a 2px-wide sliver between x=102..103
  for (let x = 0; x < 100; x++) m[60 * W + x] = 1;
  const R = CB.analyze(m, W, H);
  ok(R.n === 3, 'two halves on the left + the right side, sliver culled: ' + R.n);
  let inside = true; for (let k = 1; k <= R.n; k++) if (R.lab[R.py[k] * W + R.px[k]] !== k) inside = false;
  ok(inside, 'each pole lies in its own region');
  let cov = true; for (let i = 0; i < W * H; i++) if (R.own[i] < 1 || R.own[i] > R.n) cov = false;
  ok(cov, 'every pixel (lines and culled slivers too) has an owner region');
  ok(R.start[R.n + 1] === W * H, 'pixel lists cover the sheet');
  let csr = true; for (let k = 1; k <= R.n; k++) for (let j = R.start[k]; j < R.start[k + 1]; j++) { const p = R.list[j], x = p % W, y = (p / W) | 0; if (R.own[p] !== k || x < R.bx0[k] || x > R.bx1[k] || y < R.by0[k] || y > R.by1[k]) csr = false; }
  ok(csr, 'pixel lists and bounding boxes agree with the owner map');
  ok(R.own[60 * W + 50] > 0 && R.lab[60 * W + 50] === 0, 'line pixel belongs to a neighbouring region in the owner map');
  ok(CB.regionAt(R, 50, 30) === R.lab[30 * W + 50] && CB.regionAt(R, -5, 3) === 0 && CB.regionAt(R, 100, 5) === 0, 'regionAt: inside, outside, on a line');
  const right = R.lab[10 * W + 150];
  ok(CB.nearest(R, 101, 10, 8, l => l === right) === right, 'nearest finds the region across the line');
  ok(CB.nearest(R, 50, 30, 3, l => l === right) === 0, 'nearest respects its radius');
}
{ // codecs
  const pts = [[0, 0], [999, 999], [123, 456], [1000, 7], [-3, 1400]];
  const back = CB.decodePts(CB.encodePts(pts));
  ok(back.length === 5 && back[0][0] === 0 && back[1][1] === 999 && back[2][0] === 123 && back[2][1] === 456, 'point codec round trip');
  ok(back[3][0] === 1000 && back[4][0] === 0 && back[4][1] === 1295, 'point codec clamps out-of-range values');
  ok(CB.decodePts(null).length === 0 && CB.decodePts('').length === 0 && CB.decodePts('zz').length === 0 && CB.decodePts(42).length === 0, 'bad progress strings decode to nothing');
  ok(CB.decodePts('0a0b!!!!0c0d').length === 2, 'garbage chunk is skipped, not fatal: ' + CB.decodePts('0a0b!!!!0c0d').length);
  const fr = CB.decodeFree(CB.encodeFree([[10, 20, 3], [500, 999, 20], [7, 7, 0]]));
  ok(fr.length === 3 && fr[0][2] === 3 && fr[1][0] === 500 && fr[1][2] === 20 && fr[2][2] === 0, 'free-colour codec round trip');
  ok(CB.decodeFree('abc').length === 0, 'short free string decodes to nothing');
}
{ // palette order, tiers, time format
  const hx = ['#ff0000', '#00ff00', '#0000ff', '#808080', '#ffff00', '#ff8800', '#ffffff'];
  const o = CB.paletteOrder(hx.slice());
  ok(o.length === hx.length && hx.every(h => o.includes(h)), 'palette order is a permutation');
  ok(o.indexOf('#808080') > o.indexOf('#0000ff') && o.indexOf('#ffffff') > o.indexOf('#ff0000'), 'greys go last');
  ok(o.indexOf('#ff0000') < o.indexOf('#ffff00') && o.indexOf('#ffff00') < o.indexOf('#00ff00') && o.indexOf('#00ff00') < o.indexOf('#0000ff'), 'hues run warm to cool');
  ok(JSON.stringify(CB.paletteOrder(hx.slice().reverse())) === JSON.stringify(o), 'order does not depend on input order');
  ok(CB.tierOf(1) === 0 && CB.tierOf(50) === 0 && CB.tierOf(51) === 1 && CB.tierOf(100) === 1 && CB.tierOf(170) === 2 && CB.tierOf(171) === 3 && CB.tierOf(5000) === 3, 'tier thresholds');
  ok(CB.fmtTime(0) === '0:00' && CB.fmtTime(65) === '1:05' && CB.fmtTime(3725) === '1:02:05' && CB.fmtTime(-4) === '0:00', 'time format');
}
{ // view maths
  const v = CB.clampView({ s: 0.3, tx: -999, ty: 999 }, 390, 500, 0.37, 3.7);
  ok(Math.abs(v.s - 0.37) < 1e-9 && Math.abs(v.tx - (390 - 370) / 2) < 1e-6 && Math.abs(v.ty - (500 - 370) / 2) < 1e-6, 'zooming out past fit snaps back to the centred sheet');
  const z = CB.clampView({ s: 9, tx: 0, ty: 0 }, 390, 500, 0.37, 3.7);
  ok(z.s === 3.7, 'zoom capped at max');
  const p = CB.clampView({ s: 2, tx: 500, ty: -5000 }, 390, 500, 0.37, 3.7);
  ok(p.tx <= 60 && p.ty >= 500 - 2000 - 60, 'panning keeps the sheet on screen');
  const a = { s: 1, tx: 10, ty: 20 }, b = CB.zoomAt(a, 2, 100, 100);
  ok(Math.abs((100 - a.tx) / a.s - (100 - b.tx) / b.s) < 1e-9 && Math.abs((100 - a.ty) / a.s - (100 - b.ty) / b.s) < 1e-9, 'zoomAt keeps the point under the fingers fixed');
  // with a reserved zoom-button row, fitting and clamping agree on the centred position (no jump on the first touch)
  const f0 = CB.clampView({ s: 0.35, tx: 0, ty: 0 }, 390, 718, 0.35, 3.5, [0, 56]), f1 = CB.clampView(f0, 390, 718, 0.35, 3.5, [0, 56]);
  ok(Math.abs(f0.ty - (718 - 56 - 350) / 2) < 1e-6 && f1.tx === f0.tx && f1.ty === f0.ty, 'fit position is stable under clamping: ty ' + f0.ty + ' → ' + f1.ty);
}

// ---------- part 2: all 100 pictures in Chromium ----------
async function pictures() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://localhost:${srv.address().port}/`);
    await page.waitForFunction(() => window.__cb && __cb.ready(), null, { timeout: 30000 });
    const res = await page.evaluate(() => PICS.map((d, i) => {
      const R = buildPicture(i); let badPole = 0, minR = 1e9, badCol = 0, sum = 0;
      for (let k = 1; k <= R.n; k++) {
        if (R.lab[R.py[k] * 1000 + R.px[k]] !== k) badPole++;
        minR = Math.min(minR, R.pr[k]); if (!(R.col[k] >= 1 && R.col[k] <= R.pal.length)) badCol++; sum = (sum * 31 + R.px[k] * 1000 + R.py[k]) >>> 0;
      }
      const used = new Set(); for (let k = 1; k <= R.n; k++) used.add(R.col[k]);
      let minDE = 1e9; const L = R.pal.map(h => lab3(...ART.hex2rgb(h))); for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) minDE = Math.min(minDE, dE(L[a], L[b]));
      let detOwn = 0; for (let j = 0; j < R.det.length; j++) if (R.own[R.det[j]] !== 0) detOwn++;
      return { i, cat: d.cat, name: d.name, n: R.n, baked: COUNTS[i], pal: R.pal.length, used: used.size, badPole, minR, badCol, sum, minDE, nDet: R.nDet, detOwn };
    }));
    ok(res.length === 100, 'exactly 100 pictures: ' + res.length);
    ok(new Set(res.map(r => r.name)).size === res.length, 'picture names are unique (they key the saved progress)');
    const cats = {}; res.forEach(r => { cats[r.cat] = (cats[r.cat] || 0) + 1; });
    ok(['animal', 'flower', 'taiwan', 'mandala', 'pattern'].every(c => cats[c] === 20), 'five categories × 20: ' + JSON.stringify(cats));
    const mism = res.filter(r => r.n !== r.baked); ok(!mism.length, 'region counts match the baked COUNTS ' + mism.map(r => `${r.name}:${r.n}≠${r.baked}`).join(' '));
    ok(res.every(r => r.badPole === 0), 'every number point lies inside its own region ' + res.filter(r => r.badPole).map(r => r.name));
    ok(res.every(r => r.minR >= CB.RMIN), 'every region is at least ' + CB.RMIN + ' units from its edge (tappable when zoomed) ' + res.filter(r => r.minR < CB.RMIN).map(r => r.name));
    ok(res.every(r => r.badCol === 0 && r.used === r.pal), 'every region has a palette colour and every colour is used');
    ok(res.every(r => r.pal >= 3 && r.pal <= 24), 'palettes have 3–24 colours: ' + Math.min(...res.map(r => r.pal)) + '–' + Math.max(...res.map(r => r.pal)));
    ok(res.every(r => r.n >= 15 && r.n <= 340), 'region counts within 15–340: ' + Math.min(...res.map(r => r.n)) + '–' + Math.max(...res.map(r => r.n)));
    ok(res.every(r => r.minDE >= 5), 'no two numbers in a palette look alike (ΔE ≥ 5): min ' + Math.min(...res.map(r => r.minDE)).toFixed(1));
    ok(res.every(r => r.detOwn === 0), 'printed details are never painted over by a neighbouring region');
    const peng = res.find(r => r.name === '企鵝家族'); ok(peng && peng.nDet >= 4, 'penguin pupils are kept as printed details: ' + (peng && peng.nDet));
        const tiers = [0, 0, 0, 0]; res.forEach(r => tiers[CB.tierOf(r.n)]++);
    ok(tiers.every(t => t >= 10), 'each difficulty tier has at least 10 pictures: ' + tiers.join('/'));
    // determinism: rebuilding gives the same regions
    const again = await page.evaluate(ids => ids.map(i => { const R = buildPicture(i); let s = 0; for (let k = 1; k <= R.n; k++) s = (s * 31 + R.px[k] * 1000 + R.py[k]) >>> 0; return s; }), [0, 37, 88]);
    ok(again[0] === res[0].sum && again[1] === res[37].sum && again[2] === res[88].sum, 'pictures are deterministic');
    // gallery order: tiers ascend, categories take turns
    const ord = await page.evaluate(() => __cb.order());
    ok(ord.length === 100 && new Set(ord.map(o => o.i)).size === 100, 'gallery order lists every picture once');
    ok(ord.every((o, k) => k === 0 || CB.tierOf(o.n) >= CB.tierOf(ord[k - 1].n)), 'gallery order goes from easy to hard');
    ok(ord[0].cat !== ord[1].cat && ord[1].cat !== ord[2].cat, 'neighbouring pictures come from different categories');
    ok(!errors.length, 'no page errors while building: ' + errors.join(' | '));
  } finally { await browser.close(); srv.close(); }
}

// ---------- part 3: touch play ----------
async function touchPlay() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + html + '</body></html>';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, r)); srv.unref();
  const browser = await chromium.launch();
  const T = { timeout: 15000 };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (x, y) => { await touch('touchStart', [{ x, y }]); await page.waitForTimeout(30); await touch('touchEnd', []); };
    const st = () => page.evaluate(() => __cb.state());
    const regs = () => page.evaluate(() => __cb.regions());
    const scr = (x, y) => page.evaluate(([a, b]) => __cb.toScreen(a, b), [x, y]);
    const ready = i => page.waitForFunction(i => window.__cb && __cb.ready() && (i == null || __cb.state().i === i), i, T);
    // an element is tapped only once it is visible and its entrance animation (sheet rise, fade) is over
    const settled = sel => page.waitForFunction(sel => { const e = document.querySelector(sel); if (!e || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); if (!r.width) return false; let n = e; while (n) { if (n.getAnimations && n.getAnimations().some(a => a.playState === 'running')) return false; n = n.parentElement; } return true; }, sel, T);
    const tapEl = async sel => { await settled(sel); const b = await page.locator(sel).boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); };
    const pickColour = async c => {
      if ((await st()).sel === c) return;
      // the palette may still be smooth-scrolling to an auto-selected colour: let it come to rest before aiming
      await page.evaluate(c => document.querySelector(`.sw[data-c="${c}"]`).scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' }), c);
      await page.waitForFunction(() => new Promise(r => { const p = document.getElementById('pal'), a = p.scrollLeft; setTimeout(() => r(p.scrollLeft === a), 150); }), null, T);
      await tapEl(`.sw[data-c="${c}"]`);
      await page.waitForFunction(c => __cb.state().sel === c, c, T);
    };
    const viewStill = async () => { let a = JSON.stringify((await st()).view); for (;;) { await page.waitForTimeout(120); const b = JSON.stringify((await st()).view); if (a === b) return; a = b; } };
    await page.goto(`http://localhost:${srv.address().port}/`);
    await ready();
    let s0 = await st();
    ok(s0.name === '小刺蝟' && s0.filled === 0, 'first visit opens No.1 小刺蝟: ' + s0.name);

    // 1. export: the grey "this number" highlight is a play aid and stays out of the saved picture
    let R = await regs();
    const hlReg = R.find(r => r.c === s0.sel && !r.f);
    const scrPx = await page.evaluate(r => __cb.pixel(r.x, r.y), hlReg), expPx = await page.evaluate(r => __cb.composePixel(r.x, r.y), hlReg);
    ok(scrPx.join() !== expPx.join() && expPx[0] > 245 && expPx[1] > 245, 'export shows an unfilled highlighted piece as paper: screen ' + scrPx + ' export ' + expPx);
    // tap it (real touch) and the export shows its colour
    let [x, y] = await scr(hlReg.x, hlReg.y); await tap(x, y);
    await page.waitForFunction(k => __cb.regions()[k - 1].f, hlReg.k, T);
    const want = s0.pal[hlReg.c - 1], wrgb = [1, 3, 5].map(j => parseInt(want.slice(j, j + 2), 16));
    const exp2 = await page.evaluate(r => __cb.composePixel(r.x, r.y), hlReg);
    ok(exp2.every((v, j) => Math.abs(v - wrgb[j]) < 4), 'export shows a filled piece in its colour even while the fill animation runs: ' + exp2 + ' vs ' + wrgb);

    // 2. a fill survives a reload straight away (saved on pagehide, not only after the 500 ms debounce)
    await page.reload(); await ready();
    s0 = await st();
    ok(s0.filled === 1 && (await regs())[hlReg.k - 1].f === 1, 'fill survives an immediate reload: ' + s0.filled);

    // 3. zoomed all the way in, the outline covers the edge of the fill (no colour fringe outside the line)
    const E = await page.evaluate(r0 => { const c0 = __cb.pixel(r0.x, r0.y).join(); for (let x = r0.x; x < 1000; x++) if (__cb.pixel(x, r0.y).join() !== c0) return [x, r0.y]; }, hlReg);
    for (let i = 0; i < 6; i++) {
      const [cx, cy] = await scr(E[0], E[1]), pts = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
      await touch('touchStart', pts(40));
      for (let k = 1; k <= 8; k++) { await touch('touchMove', pts(40 + k * 14)); await page.waitForTimeout(16); }
      await touch('touchEnd', []); await viewStill();
    }
    s0 = await st();
    ok(s0.view.s > s0.sMax * 0.95, 'six pinches reach the zoom limit: ' + (s0.view.s / s0.sFit).toFixed(1) + '×');
    ok(s0.filled === 1, 'pinching never fills: ' + s0.filled);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // colour fringe = a pixel tinted toward the fill that touches bare paper: inside the outline red only meets ink
    const fr = await page.evaluate(E => {
      const cv = document.getElementById('cv'), b = cv.getBoundingClientRect(), k = cv.width / b.width, [sx, sy] = __cb.toScreen(E[0], E[1]);
      const N = 200, X = Math.round((sx - b.left) * k) - N / 2, Y = Math.round((sy - b.top) * k) - N / 2, d = cv.getContext('2d').getImageData(X, Y, N, N).data;
      const at = (x, y) => (y * N + x) * 4, red = j => d[j] - d[j + 1] > 24 && d[j] - d[j + 2] > 24, paper = j => d[j] > 240 && d[j + 1] > 238 && d[j + 2] > 232;
      let nRed = 0, nPaper = 0, fringe = 0;
      for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
        const j = at(x, y); if (paper(j)) nPaper++; if (!red(j)) continue; nRed++;
        let near = false; for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (paper(at(x + dx, y + dy))) { near = true; break; }
        if (near) fringe++;
      }
      return { nRed, nPaper, fringe };
    }, E);
    ok(fr.nRed > 2000 && fr.nPaper > 2000 && fr.fringe <= 12, `zoomed-in outline covers the fill edge: ${fr.fringe} fill-tinted px touch the paper outside the line (was ~100; a few remain where two lines meet at a sharp angle)`);

    // 4. two fingers: a pinch whose fingers rest on pieces of the selected colour fills nothing, also when they lift unmoved
    await tapEl('#zFit'); await viewStill();
    R = await regs(); s0 = await st();
    const open = R.filter(r => !r.f && r.c === s0.sel && r.r * s0.view.s > 10);
    const A = open[0] || R.find(r => !r.f && r.c === s0.sel);
    const [ax, ay] = await scr(A.x, A.y);
    await touch('touchStart', [{ x: ax, y: ay, id: 1 }]); await page.waitForTimeout(90);
    await touch('touchStart', [{ x: ax, y: ay, id: 1 }, { x: ax + 70, y: ay + 20, id: 2 }]); await page.waitForTimeout(150);
    await touch('touchEnd', [{ x: ax, y: ay, id: 1 }]); await page.waitForTimeout(60); await touch('touchEnd', []);
    await page.waitForTimeout(300);
    ok((await st()).filled === 1, 'two resting fingers that lift without moving fill nothing');
    await touch('touchStart', [{ x: ax, y: ay, id: 1 }]); await page.waitForTimeout(80);
    await touch('touchStart', [{ x: ax, y: ay, id: 1 }, { x: ax + 60, y: ay, id: 2 }]);
    for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: ax - k * 6, y: ay, id: 1 }, { x: ax + 60 + k * 6, y: ay, id: 2 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', [{ x: ax - 36, y: ay, id: 1 }]); await page.waitForTimeout(40); await touch('touchEnd', []);
    await viewStill();
    s0 = await st();
    ok(s0.filled === 1 && s0.view.s > s0.sFit * 1.05, 'a quick pinch zooms and fills nothing, not even from its second finger');
    await tapEl('#zFit'); await viewStill();

    // 5. a double tap fills the piece under the finger only, not also a same-colour neighbour within magnet reach
    await page.evaluate(() => __cb.open(98)); await ready(98);
    await pickColour(5);
    R = await regs();
    ok(R[8].c === 5 && R[12].c === 5 && !R[8].f && !R[12].f, 'No.3 has pieces 9 and 13 in colour 5, close together');
    [x, y] = await scr(R[8].x, R[8].y);
    await tap(x, y); await page.waitForTimeout(60); await tap(x, y);
    await page.waitForFunction(() => __cb.regions()[8].f, null, T); await page.waitForTimeout(350);
    ok(!(await regs())[12].f, 'the second tap of a double tap does not fill the neighbour');
    await page.waitForTimeout(300); await tap(x, y);
    await page.waitForFunction(() => __cb.regions()[12].f, null, T);
    ok(true, 'a later tap on the filled piece still snaps to the neighbour (magnet kept)');

    // 6. storage full: other pictures' thumbnails are dropped so the progress still saves
    await page.evaluate(() => {
      localStorage.setItem('color-book:v1:th:鬱金香', 'data:image/jpeg;base64,' + 'A'.repeat(64));
      const set0 = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (/:p:/.test(k) && Object.keys(localStorage).some(q => q.startsWith('color-book:v1:th:') && !q.endsWith(__cb.state().name))) throw new DOMException('full', 'QuotaExceededError'); return set0.call(this, k, v); };
    });
    s0 = await st(); R = await regs();
    const B = R.find(r => !r.f && r.c === s0.sel && r.r * s0.view.s > 8);
    [x, y] = await scr(B.x, B.y); await tap(x, y);
    await page.waitForFunction(n => { const r = JSON.parse(localStorage.getItem('color-book:v1:p:' + __cb.state().name) || '{}'); return r.f === n; }, s0.filled + 1, T);
    ok(!(await page.evaluate(() => localStorage.getItem('color-book:v1:th:鬱金香'))), 'a full storage drops other thumbnails and the progress is saved');

    // 7. bad saved numbers are ignored
    await page.evaluate(() => localStorage.setItem('color-book:v1:p:鬱金香', '{"o":42,"t":1e400,"f":-3,"m":"x","h":null,"b":"NaN"}'));
    await page.evaluate(() => __cb.open(41)); await ready(41);
    s0 = await st();
    ok(s0.filled === 0 && s0.rec.t === 0 && s0.rec.m === 0 && s0.rec.h === 0 && s0.rec.b === 0, 'corrupt saved record loads as a fresh picture: ' + JSON.stringify(s0.rec));

    // 8. a picture asked for while another is building is opened afterwards, not dropped
    await page.evaluate(() => { __cb.open(0); __cb.open(34); });
    await ready(34);
    ok((await st()).name === '迴旋格', 'picture requested during a build opens when the build finishes');

    // 9. free colouring: undo and redo (buttons and Ctrl+Z / Ctrl+Shift+Z)
    await tapEl('#bMenu'); await tapEl('#mFree');
    await page.waitForFunction(() => __cb.state().mode === 'free' && !document.getElementById('bRedo').hidden, null, T);
    const ui = await page.evaluate(() => ({ coach: document.getElementById('coach').classList.contains('gone'), tag: getComputedStyle(document.querySelector('.freeTag')).display, tagFg: getComputedStyle(document.querySelector('.freeTag')).color, fg: getComputedStyle(document.documentElement).getPropertyValue('--on-accent').trim() }));
    ok(ui.coach && ui.tag === 'inline-block' && ui.tagFg === 'rgb(255, 255, 255)', 'free mode: number tips hidden, 自由 tag sits beside the name in white: ' + JSON.stringify(ui));
    R = await regs(); s0 = await st();
    const F = R.filter(r => r.r * s0.view.s > 10).map(r => r).sort((a, b) => a.y - b.y)[0];
    [x, y] = await scr(F.x, F.y); await tap(x, y);
    await page.waitForFunction(k => __cb.regions()[k - 1].fc > 0, F.k, T);
    const fc = (await regs())[F.k - 1].fc;
    await tapEl('#bUndo'); await page.waitForFunction(k => __cb.regions()[k - 1].fc === 0 && __cb.hist().redo === 1, F.k, T);
    await tapEl('#bRedo'); await page.waitForFunction(([k, c]) => __cb.regions()[k - 1].fc === c && __cb.hist().redo === 0, [F.k, fc], T);
    ok(true, 'free colouring: undo clears the piece, redo puts it back');
    await page.keyboard.press('Control+z'); await page.waitForFunction(k => __cb.regions()[k - 1].fc === 0, F.k, T);
    await page.keyboard.press('Control+Shift+Z'); await page.waitForFunction(([k, c]) => __cb.regions()[k - 1].fc === c, [F.k, fc], T);
    await page.keyboard.press('Control+z'); await page.waitForFunction(() => __cb.hist().redo === 1, null, T);
    await tap(x, y); await page.waitForFunction(() => __cb.hist().redo === 0 && __cb.hist().undo === 1, null, T);
    ok(true, 'keyboard undo/redo works and a new stroke clears the redo stack');

    // 10. finish 小刺蝟 by touch, then a tap during the time-lapse jumps to the finished picture
    await page.evaluate(() => __cb.open(74, false)); await ready(74);
    for (let guard = 0; guard < 80; guard++) {
      s0 = await st(); if (s0.complete) break;
      const r = (await regs()).find(q => !q.f);
      await pickColour(r.c);
      [x, y] = await scr(r.x, r.y); await tap(x, y);
      await page.waitForFunction(k => __cb.regions()[k - 1].f, r.k, T);
      // finishing a colour auto-selects the next one 380 ms later: let that happen before aiming at the palette
      if (!(await st()).remain[r.c]) await page.waitForTimeout(500);
    }
    ok((await st()).complete, 'a whole picture can be finished by touch');
    await tapEl('#dReplay');
    await page.waitForFunction(() => __cb.fx().replay, null, T);
    await page.waitForTimeout(500);
    await tap(195, 400);
    await page.waitForFunction(() => !__cb.fx().replay, null, { timeout: 2500 });
    R = await regs(); s0 = await st();
    const px = await page.evaluate(r => __cb.pixel(r.x, r.y), R[0]), w0 = s0.pal[R[0].c - 1];
    ok(px.join() === [1, 3, 5].map(j => parseInt(w0.slice(j, j + 2), 16)).join() && Math.abs((await page.evaluate(() => __cb.fx().lineAlpha)) - 0.28) < 0.01, 'tapping skips the time-lapse to the finished picture');
    await page.reload(); await ready(74);
    ok((await st()).complete, 'the finished picture stays finished after a reload');
    // 11. the wrong-tap bubble's colour button is a full 44 px target
    await page.evaluate(() => __cb.open(98)); await ready(98);
    s0 = await st(); R = await regs();
    const W = R.find(r => !r.f && r.c !== s0.sel && r.r * s0.view.s > 14 && !R.some(q => !q.f && q.c === s0.sel && Math.hypot(q.x - r.x, q.y - r.y) * s0.view.s < 60));
    [x, y] = await scr(W.x, W.y); await tap(x, y);
    await page.waitForFunction(() => !document.getElementById('bubble').hidden, null, T);
    const bb = await page.locator('#bubble button').boundingBox();
    ok(bb.height >= 44 && bb.width >= 44, 'wrong-tap bubble button is at least 44×44: ' + bb.width + '×' + bb.height);
    ok(!errors.length, 'no page errors during touch play: ' + errors.join(' | '));
  } finally { await browser.close(); }
}

(async () => {
  if (!process.env.CORE_ONLY) {
    try { await pictures(); } catch (e) { fail++; console.log('FAIL picture build:', e.message); }
    try { await touchPlay(); } catch (e) { fail++; console.log('FAIL touch play:', e.message.split('\n')[0]); }
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
