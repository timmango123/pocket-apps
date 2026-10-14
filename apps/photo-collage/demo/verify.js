// Verify photo-collage: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };

// make solid / striped images inside the page, return base64
async function genImages(page, specs) {
  return page.evaluate(async specs => {
    const out = [];
    for (const [w, h, col] of specs) {
      const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      x.fillStyle = col; x.fillRect(0, 0, w, h);
      const b = await new Promise(r => c.toBlob(r, 'image/png'));
      const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); out.push(btoa(s));
    }
    return out;
  }, specs);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(400);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleBar'), 'sample banner visible');
  const s0 = await page.evaluate(() => ({ n: __pc.st.photos.length, lay: __pc.st.layoutId, filled: __pc.st.cells.filter(c => c.pid != null).length }));
  assert(s0.n === 4 && s0.lay === '4a' && s0.filled === 4, 'opens with 4 sample photos in 2x2 layout');
  const counts = await page.evaluate(() => { const m = {}; __pc.LAYOUTS.forEach(l => m[l.cells.length] = (m[l.cells.length] || 0) + 1); return m; });
  console.log('  layouts per count', counts);
  // every layout tiles the unit square
  const tile = await page.evaluate(() => __pc.LAYOUTS.every(l => Math.abs(l.cells.reduce((a, c) => a + c.w * c.h, 0) - 1) < 1e-9));
  assert(tile, 'all built-in layouts cover area exactly 1');
  // preview vs 2160 output: cell boundaries within 1px
  const diff = await page.evaluate(() => {
    let worst = 0; for (const L of __pc.LAYOUTS) { const r = __pc.ratioOf(); const pw = 717, a = __pc.cellRects(pw, pw * r, L.cells), b = __pc.cellRects(2160, 2160 * r, L.cells), k = 2160 / pw;
      a.forEach((q, i) => { for (const key of ['x', 'y', 'w', 'h']) worst = Math.max(worst, Math.abs(q[key] * k - b[i][key])); }); } return worst; });
  assert(diff <= 1, 'preview vs 2160 output cell edge error ' + diff.toFixed(4) + 'px <= 1');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // feed 3 canvas-generated files -> replaces samples, picks first 3-photo layout
  const imgs = await genImages(page, [[1200, 800, '#ff0000'], [800, 1200, '#00ff00'], [1000, 1000, '#0000ff']]);
  await page.setInputFiles('#fileInput', imgs.map((b, i) => ({ name: `c${i}.png`, mimeType: 'image/png', buffer: Buffer.from(b, 'base64') })));
  await page.waitForFunction(() => __pc.st.photos.length === 3 && !__pc.st.photos.some(p => p.sample));
  const s1 = await page.evaluate(() => ({ lay: __pc.st.layoutId, cells: __pc.st.cells.map(c => c.pid) }));
  assert(s1.lay === '3a' && s1.cells.every(v => v != null), '3 photos -> layout 3a, all cells filled');
  assert(!(await page.isVisible('#sampleBar')), 'sample banner hidden after import');

  // frame sliders: border 40, gap 20 (relative to 1080)
  await page.click('#tab-frame');
  await page.fill('#border', '40'); await page.dispatchEvent('#border', 'input');
  await page.fill('#gap', '20'); await page.dispatchEvent('#gap', 'input');
  // export 2160 PNG and probe pixels
  await page.click('#exportBtn'); await page.click('#fmt-png'); await page.click('#outw-2160');
  assert((await page.textContent('#exInfo')).includes('2160 × 2700'), 'export info 2160 x 2700 for 4:5');
  await page.click('#exGo');
  await page.waitForFunction(() => window.__saved.length === 1);
  const probe = await page.evaluate(async () => {
    const s = window.__saved[0]; const bmp = await createImageBitmap(s.data); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.drawImage(bmp, 0, 0);
    const px = (a, b) => Array.from(x.getImageData(Math.round(a), Math.round(b), 1, 1).data.slice(0, 3));
    const W = bmp.width, H = bmp.height, B = 80, cw = (W - 2 * B) / 3;
    return { name: s.filename, W, H, border: px(40, H / 2), c0: px(B + cw / 2, H / 2), c1: px(B + cw * 1.5, H / 2), c2: px(B + cw * 2.5, H / 2),
      gap: px(B + cw, H / 2), justIn: px(B + 1, B + 1), justOut: px(B - 2, B + 10), lastIn: px(B + cw - 20 - 2, H / 2) };
  });
  console.log('  ', JSON.stringify(probe));
  assert(/^collage-\d{8}-\d{4}\.png$/.test(probe.name), 'filename ' + probe.name);
  assert(probe.W === 2160 && probe.H === 2700, 'output 2160x2700');
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 6);
  assert(near(probe.border, [255, 255, 255]) && near(probe.gap, [255, 255, 255]) && near(probe.justOut, [255, 255, 255]), 'border & gap are background white');
  assert(near(probe.c0, [255, 0, 0]) && near(probe.c1, [0, 255, 0]) && near(probe.c2, [0, 0, 255]), 'cells show red / green / blue in order');
  assert(near(probe.justIn, [255, 0, 0]) && near(probe.lastIn, [255, 0, 0]), 'cell 1 edges exact (B+1 inside, gap/2 inset)');
  await page.click('#exClose');

  // pan within cell: red 3:2 photo in tall cell can move horizontally only within bounds
  const box = await page.locator('#cv').boundingBox();
  const c0x = box.x + box.width * (0.5 / 3), cy = box.y + box.height / 2;
  await page.mouse.move(c0x, cy); await page.mouse.down(); await page.mouse.move(c0x + 400, cy, { steps: 6 }); await page.mouse.up();
  const pan = await page.evaluate(() => { const c = __pc.st.cells[0]; return { ox: c.ox, oy: c.oy }; });
  assert(pan.ox > 0 && pan.oy === 0, 'pan clamped: ox ' + pan.ox.toFixed(3) + ' > 0, oy stays 0');
  // tap selects cell -> toolbar; rotate & flip
  await page.mouse.click(c0x, cy);
  assert(await page.isVisible('#cellBar'), 'tap shows cell toolbar');
  await page.click('#cRotate'); await page.click('#cFlip');
  assert(await page.evaluate(() => __pc.st.cells[0].rot === 1 && __pc.st.cells[0].flip), 'rotate 90 + flip applied');
  // long-press swap cell 0 -> cell 2
  const before = await page.evaluate(() => __pc.st.cells.map(c => c.pid));
  await page.mouse.move(c0x, cy); await page.mouse.down(); await page.waitForTimeout(520);
  await page.mouse.move(box.x + box.width * (2.5 / 3), cy, { steps: 5 }); await page.mouse.up();
  const after = await page.evaluate(() => __pc.st.cells.map(c => c.pid));
  assert(after[0] === before[2] && after[2] === before[0], 'long-press drag swaps cell 1 and cell 3');
  // clear cell -> fewer photos than cells; then layout with more cells -> empty "+" cells
  await page.click('#cClear');
  assert(await page.evaluate(() => __pc.st.cells[2].pid === null), 'clear empties the cell');
  await page.click('#tab-layout'); await page.click('#cnt-5'); await page.click('#lay-5a');
  const s2 = await page.evaluate(() => ({ n: __pc.st.cells.length, filled: __pc.st.cells.filter(c => c.pid != null).length }));
  assert(s2.n === 5 && s2.filled === 3, '5-cell layout with 3 photos: 3 filled, 2 empty');
  // more photos than cells -> pool
  await page.click('#cnt-2'); await page.click('#lay-2a');
  await page.click('#tab-photos');
  assert((await page.textContent('#photoCount')).includes('1 張待用'), 'extra photo listed as pool');
  // ratio 1:1
  await page.click('#ratio-1x1');
  const ar = await page.evaluate(() => { const c = document.querySelector('#cv'); return c.width / c.height; });
  assert(Math.abs(ar - 1) < 0.01, 'ratio 1:1 canvas square');
  // background swatch + blur
  await page.click('#tab-bg'); await page.click('#sw-3'); await page.check('#blurBg');
  assert(await page.evaluate(() => __pc.st.blurBg && __pc.st.bg === '#1b1b1f'), 'background colour + blur set');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll 390');
  await page.screenshot({ path: path.join(OUT, '390x844-edited.png') });
  // 0 photos state
  await page.click('#tab-photos');
  for (let i = 0; i < 3; i++) await page.locator('#photoList [data-rm]').first().click();
  await page.waitForTimeout(150);
  assert(await page.isVisible('#emptyHint'), '0 photos shows 先加入照片');
  // settings persisted
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => __pc.st.border === 40 && __pc.st.gap === 20 && __pc.st.ratio === '1:1' && __pc.st.fmt === 'png'), 'settings persisted after reload');
  await page.evaluate(() => { localStorage.clear(); });
  await ctx.close();

  // screenshots: no downloads capability -> image fallback
  const shots = [
    ['360x780', { width: 360, height: 780 }, 'light', true],
    ['844x390', { width: 844, height: 390 }, 'light', true],
    ['390x844-dark', { width: 390, height: 844 }, 'dark', true],
    ['1280x800', { width: 1280, height: 800 }, 'light', false],
  ];
  for (const [name, vp, scheme, mobile] of shots) {
    const c = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await c.newPage(); watch(p); await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(w => innerWidth === w && document.documentElement.scrollWidth <= innerWidth, vp.width), name + ' width ok, no h-scroll');
    if (name === '390x844-dark') {
      await p.click('#exportBtn'); await p.click('#exGo'); await p.waitForSelector('#outImg:not([hidden])');
      assert(await p.isVisible('#outImgHint'), 'no downloads -> shows image for long-press save');
      await p.screenshot({ path: path.join(OUT, '390x844-dark-export.png') });
      await p.click('#exClose');
    }
    if (name === '360x780') { await p.click('#tab-frame'); }
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  console.log('ALL PASSED');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
