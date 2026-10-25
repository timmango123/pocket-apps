// Tests for 填色本 (color-book).
// Part 1: the pure core between CORE markers (region labelling, distance map, culling, owner map, codecs, view maths).
// Part 2: every one of the 100 pictures built in Chromium: region counts match the baked COUNTS, every region's number
// point lies inside that region and is big enough to tap, palettes are sane, categories and difficulty spread.
// Usage: node tests.js            (part 2 needs Playwright; set CORE_ONLY=1 to skip it)
const fs = require('fs'), path = require('path'), http = require('http');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
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

(async () => {
  if (!process.env.CORE_ONLY) {
    try { await pictures(); } catch (e) { fail++; console.log('FAIL picture build:', e.message); }
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
