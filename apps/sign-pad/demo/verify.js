// Playwright verification for sign-pad. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const PREV = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(PREV, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREV, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);

// touch drag via CDP so touch-action / page scrolling is exercised for real
async function touchDraw(page, cdp, pts, delay = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], radiusX: 4, radiusY: 4 }] });
  for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1], radiusX: 4, radiusY: 4 }] }); if (delay) await page.waitForTimeout(delay); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function drawSig(page, cdp, box) {
  const loop = []; for (let i = 0; i <= 50; i++) { const u = i / 50, th = u * Math.PI * 6; loop.push([box.x + box.width * (0.15 + 0.6 * u + 0.04 * Math.cos(th)), box.y + box.height * (0.55 - 0.15 * Math.sin(th))]); }
  await touchDraw(page, cdp, loop, 6);
  const line = []; for (let i = 0; i <= 12; i++) line.push([box.x + box.width * (0.15 + 0.065 * i), box.y + box.height * 0.74]);
  await touchDraw(page, cdp, line, 4);
  await touchDraw(page, cdp, [[box.x + box.width * 0.82, box.y + box.height * 0.42]]);
}

(async () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert(!src.includes('�'), 'no literal U+FFFD in source');
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(s); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__spReady); await page.waitForTimeout(100);
    if (s.hasTouch) { const cdp = await ctx.newCDPSession(page); await drawSig(page, cdp, await page.locator('#sheet').boundingBox()); }
    else { await page.evaluate(() => window.__sp.commit(window.__sp.sampleSig())); }
    await page.waitForTimeout(100);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button,.sw', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], 'touch targets >= 44px');
      await page.screenshot({ path: `${OUT}/${s.name}-full.png`, fullPage: true });
    }
    await ctx.close();
  }

  // ---------- flow ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__spReady);
  eq(await page.evaluate(() => ['pngBtn', 'showBtn', 'saveBtn', 'clearBtn'].map(id => document.getElementById(id).disabled)), [true, true, true, true], 'outputs disabled with no strokes');
  const box = await page.locator('#sheet').boundingBox();
  const y0 = await page.evaluate(() => scrollY);
  // fast stroke vs slow stroke: speed model must make the fast one thinner
  const fast = [], slow = []; for (let i = 0; i <= 20; i++) { fast.push([box.x + 30 + i * 15, box.y + 60]); slow.push([box.x + 30 + i * 4, box.y + 120]); }
  await touchDraw(page, cdp, fast, 1); await touchDraw(page, cdp, slow, 40);
  const ws = await page.evaluate(() => window.__sp.strokes.map(s => { const w = s.points.slice(3).map(p => p.w); return w.reduce((a, b) => a + b, 0) / w.length; }));
  console.log('     mean widths fast / slow', ws.map(x => x.toFixed(2)).join(' / '));
  assert(ws.length === 2 && ws[0] < ws[1], 'fast stroke thinner than slow stroke (velocity width model)');
  const steps = await page.evaluate(() => { let worst = 0; for (const s of window.__sp.strokes) for (let i = 1; i < s.points.length; i++) worst = Math.max(worst, Math.abs(s.points[i].w / s.points[i - 1].w - 1)); return worst; });
  assert(steps <= 0.102, `width change per point limited to ±10% (max ${(steps * 100).toFixed(1)}%)`);
  eq(await page.evaluate(() => scrollY), y0, 'page does not scroll while writing');
  // dot
  await touchDraw(page, cdp, [[box.x + 300, box.y + 150]]);
  eq(await page.evaluate(() => window.__sp.strokes.length), 3, 'tap adds a dot stroke');
  const inkAtDot = await page.evaluate(([x, y]) => { const c = document.getElementById('cv'), r = c.getBoundingClientRect(), d = c.getContext('2d').getImageData(Math.round((x - r.left) * c.width / r.width), Math.round((y - r.top) * c.height / r.height), 1, 1).data; return d[3]; }, [box.x + 300, box.y + 150]);
  assert(inkAtDot > 200, 'dot is painted as a filled circle');
  // undo / redo
  await page.click('#undoBtn'); eq(await page.evaluate(() => window.__sp.strokes.length), 2, 'undo removes one stroke');
  await page.click('#redoBtn'); eq(await page.evaluate(() => window.__sp.strokes.length), 3, 'redo restores it');
  await page.click('#clearBtn'); eq(await page.evaluate(() => window.__sp.strokes.length), 0, 'clear');
  await page.click('#undoBtn'); eq(await page.evaluate(() => window.__sp.strokes.length), 3, 'clear is undoable');
  // PNG: transparent, cropped to content + 16px margin at 2x
  const png = await page.evaluate(() => {
    const sp = window.__sp, c = sp.renderPNG(), b = sp.bounds(sp.strokes), f = sp.frame();
    const g = c.getContext('2d'), corner = g.getImageData(0, 0, 1, 1).data[3];
    let minX = c.width, minY = c.height, maxX = 0, maxY = 0; const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    return { W: c.width, H: c.height, corner, expectW: Math.round((b.x1 - b.x0) * 1.2 + 32), left: minX, top: minY, right: c.width - 1 - maxX, bottom: c.height - 1 - maxY };
  });
  console.log('     png', JSON.stringify(png));
  eq(png.corner, 0, 'PNG background transparent');
  assert(Math.abs(png.W - png.expectW) <= 1, 'PNG width = content bounds × 1.2 px/unit (2×) + 2×16 margin');
  assert([png.left, png.top, png.right, png.bottom].every(m => m >= 12 && m <= 22), 'auto-crop leaves ~16px margin on every side');
  // SVG
  const svg = await page.evaluate(() => { const s = window.__sp.renderSVG(); const doc = new DOMParser().parseFromString(s, 'image/svg+xml'); return { paths: doc.querySelectorAll('path').length, err: !!doc.querySelector('parsererror'), vb: doc.documentElement.getAttribute('viewBox') }; });
  assert(!svg.err && svg.paths === 3, `SVG parses with one filled outline path per stroke (${svg.paths}, viewBox ${svg.vb})`);
  // resize keeps proportions (normalised coordinates)
  const before = await page.evaluate(() => JSON.stringify(window.__sp.strokes));
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(200);
  eq(await page.evaluate(() => JSON.stringify(window.__sp.strokes)) === before, true, 'stroke data unchanged on rotation');
  const ink = await page.evaluate(() => { const sp = window.__sp, p = sp.strokes[2].points[0], c = document.getElementById('cv'); return c.getContext('2d').getImageData(Math.round(p.x * c.width), Math.round(p.y * c.height), 1, 1).data[3]; });
  assert(ink > 200, 'after resize the dot is redrawn at the same relative position');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  // recolor + save + reload
  await page.click('#c-red'); await page.click('#recolorBtn');
  eq(await page.evaluate(() => [...new Set(window.__sp.strokes.map(s => s.color))]), ['#c62828'], 'recolour all strokes');
  await page.click('#saveBtn');
  await page.reload(); await page.waitForFunction(() => window.__spReady);
  eq(await page.evaluate(() => window.__sp.saved.map(s => s.name)), ['簽名 1', '範例簽名'], 'saved signature persists (with sample)');
  eq(await page.evaluate(() => window.__sp.prefs.color), '#c62828', 'pen prefs persist');
  await page.click('#savedBtn'); await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/flow-drawer.png` });
  await page.locator('.item .btn.pri').nth(1).click();
  eq(await page.evaluate(() => window.__sp.strokes.length), 3, 'load sample signature from drawer');
  // big canvas
  await page.click('#bigBtn'); await page.waitForTimeout(150);
  const bigBox = await page.locator('#sheet').boundingBox();
  assert(bigBox.height >= 500 && bigBox.width >= 300, `portrait big canvas is turned 90° and fills the screen (${Math.round(bigBox.width)}x${Math.round(bigBox.height)})`);
  await page.screenshot({ path: `${OUT}/flow-big.png` });
  await page.click('#bDone');
  await page.click('#showBtn'); await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/flow-preview.png` });
  assert(await page.isVisible('#pvImg'), 'PNG preview (no downloads capability fallback)');
  await ctx.close(); await browser.close();
  fs.unlinkSync(PREV);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
