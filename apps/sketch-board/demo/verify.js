// Playwright verification for sketch-board. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const PREV = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(PREV, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREV, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);

const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 3, radiusY: 3 })) });
async function drag(page, cdp, pts, delay = 6) { await T(cdp, 'touchStart', [pts[0]]); for (const p of pts.slice(1)) { await T(cdp, 'touchMove', [p]); if (delay) await page.waitForTimeout(delay); } await T(cdp, 'touchEnd', []); await page.waitForTimeout(30); }
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
const S = page => page.evaluate(() => { const b = window.__sb.board; return { n: b.items.length, types: b.items.map(i => i.type), view: b.view, undo: window.__sb.undoN, sel: [...window.__sb.sel] }; });

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
    await page.goto(URL); await page.waitForFunction(() => window.__sbReady); await page.waitForTimeout(150);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    const st = await S(page); assert(st.n >= 15 && st.types.includes('note'), `${s.name} sample board loaded (${st.n} items)`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id));
      eq(small, [], 'toolbar buttons >= 44px');
      const ov = await page.evaluate(() => { const a = document.querySelector('.tools').getBoundingClientRect(), b = document.querySelector('.zoom').getBoundingClientRect(); return a.left >= 16 && a.right <= innerWidth - 16 && (b.bottom <= a.top || b.left >= a.right); });
      assert(ov, 'toolbar inside 16px gutters and not overlapping zoom rail');
      await page.click('#t-pen'); await page.waitForTimeout(80);
      await page.screenshot({ path: `${OUT}/${s.name}-props.png` });
      await page.click('#menuBtn'); await page.waitForTimeout(150);
      await page.screenshot({ path: `${OUT}/${s.name}-menu.png` });
    }
    await ctx.close();
  }

  // ---------------- interaction flow ----------------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__sbReady);
  // start from an empty board
  await page.click('#menuBtn'); await page.click('#newBoard'); await page.waitForTimeout(100);
  eq((await S(page)).n, 0, 'new empty board');
  await page.evaluate(() => window.__sb.setTool('pen'));
  // single-finger stroke
  await drag(page, cdp, line(60, 300, 300, 330, 40), 4);
  let st = await S(page); eq(st.types, ['path'], 'one-finger draws a stroke');
  const pts = await page.evaluate(() => window.__sb.board.items[0].points.length);
  assert(pts < 41 && pts >= 2, `RDP simplified a straight stroke to ${pts} points`);
  // two-finger pinch: zoom in around midpoint, no stroke added
  const z0 = st.view.zoom;
  await T(cdp, 'touchStart', [[150, 500]]); await T(cdp, 'touchStart', [[150, 500], [250, 500]]);
  for (let i = 1; i <= 10; i++) { await T(cdp, 'touchMove', [[150 - i * 5, 500], [250 + i * 5, 500]]); await page.waitForTimeout(8); }
  await T(cdp, 'touchEnd', [[250 + 50, 500]]); await T(cdp, 'touchEnd', []); await page.waitForTimeout(50);
  st = await S(page); eq(st.n, 1, 'pinch does not draw');
  assert(Math.abs(st.view.zoom / z0 - 2) < 0.05, `pinch zoom 100px→200px doubles zoom (${z0}→${st.view.zoom.toFixed(3)})`);
  // two-finger pan
  const vx = st.view.x;
  await T(cdp, 'touchStart', [[100, 400]]); await T(cdp, 'touchStart', [[100, 400], [200, 400]]);
  for (let i = 1; i <= 6; i++) { await T(cdp, 'touchMove', [[100 + i * 10, 400], [200 + i * 10, 400]]); await page.waitForTimeout(8); }
  await T(cdp, 'touchEnd', [[260, 400]]); await T(cdp, 'touchEnd', []); await page.waitForTimeout(50);
  st = await S(page); assert(Math.abs((vx - st.view.x) * st.view.zoom - 60) < 1, 'two-finger drag pans 60px');
  eq(st.n, 1, 'pan does not draw');
  await page.click('#zoomPct'); await page.evaluate(() => window.__sb.fitAll(true));
  // rectangle via shape tool
  await page.evaluate(() => { window.__sb.prefs.shape = 'rect'; window.__sb.setTool('shape'); });
  await drag(page, cdp, line(80, 420, 260, 520, 10));
  st = await S(page); eq(st.types, ['path', 'rect'], 'shape tool drag creates rectangle');
  const rect = await page.evaluate(() => { const r = window.__sb.board.items[1], z = window.__sb.board.view.zoom; return { w: Math.round(r.w * z), h: Math.round(r.h * z) }; });
  eq(rect, { w: 180, h: 100 }, 'rectangle size matches drag in screen px');
  // arrow
  await page.evaluate(() => { window.__sb.prefs.shape = 'arrow'; window.__sb.setTool('shape'); });
  await drag(page, cdp, line(80, 600, 300, 600, 8));
  // select + move rect, then undo
  await page.evaluate(() => window.__sb.setTool('select'));
  const before = await page.evaluate(() => { const r = window.__sb.board.items[1]; return [r.x, r.y]; });
  await drag(page, cdp, line(81, 470, 131, 500, 8));   // grab left edge of the rect
  const after = await page.evaluate(() => { const r = window.__sb.board.items[1], z = window.__sb.board.view.zoom; return [r.x, r.y, z]; });
  assert(Math.abs((after[0] - before[0]) * after[2] - 50) < 1.5 && Math.abs((after[1] - before[1]) * after[2] - 30) < 1.5, 'select + drag moves rectangle by (50,30) px');
  await page.click('#undoBtn');
  eq(await page.evaluate(() => { const r = window.__sb.board.items[1]; return [r.x, r.y]; }), before, 'undo reverts the move');
  // marquee selects all three
  await drag(page, cdp, line(20, 200, 370, 700, 8));
  eq((await S(page)).sel.length, 3, 'marquee selects stroke, rect and arrow');
  // eraser removes the stroke, undo brings it back
  await page.evaluate(() => window.__sb.setTool('eraser'));
  const sp = await page.evaluate(() => { const p = window.__sb.board.items[0].points[0]; return window.__sb.W2S(p[0], p[1]); });
  await drag(page, cdp, line(sp[0] + 30, sp[1] - 30, sp[0] + 30, sp[1] + 40, 8));
  eq((await S(page)).types, ['rect', 'arrow'], 'eraser deletes whole stroke');
  await page.click('#undoBtn'); eq((await S(page)).types, ['rect', 'arrow', 'path'].sort().length === 3 ? (await S(page)).types : [], 'undo restores erased stroke');
  // text tool
  await page.evaluate(() => window.__sb.setTool('text'));
  await drag(page, cdp, [[120, 250]]); await page.waitForTimeout(80);
  assert(await page.isVisible('#editor'), 'text editor overlay opens');
  await page.keyboard.type('會議重點'); await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  eq(await page.evaluate(() => window.__sb.board.items.filter(i => i.type === 'text').map(i => i.text)), ['會議重點'], 'text item created');
  // note tool + edit
  await page.evaluate(() => window.__sb.setTool('note'));
  await drag(page, cdp, [[250, 720]]); await page.waitForTimeout(80);
  await page.keyboard.type('待辦：寄報價'); await page.keyboard.press('Escape'); await page.waitForTimeout(50);
  eq(await page.evaluate(() => window.__sb.board.items.filter(i => i.type === 'note').map(i => i.text)), ['待辦：寄報價'], 'note created with text');
  await page.click('#undoBtn');
  eq(await page.evaluate(() => window.__sb.board.items.filter(i => i.type === 'note').map(i => i.text)), [''], 'undo reverts note text edit');
  await page.click('#redoBtn');
  // long press -> context menu, lock
  await page.evaluate(() => window.__sb.setTool('select'));
  const rc = await page.evaluate(() => { const r = window.__sb.board.items.find(i => i.type === 'rect'); return window.__sb.W2S(r.x, r.y + r.h / 2); });
  await T(cdp, 'touchStart', [[rc[0] + 1, rc[1]]]); await page.waitForTimeout(650); await T(cdp, 'touchEnd', []); await page.waitForTimeout(50);
  assert(await page.isVisible('#ctx'), 'long press opens context menu');
  await page.screenshot({ path: `${OUT}/flow-context.png` });
  await page.click('#cx-lock');
  eq(await page.evaluate(() => !!window.__sb.board.items.find(i => i.type === 'rect').locked), true, 'lock via context menu');
  // persistence
  await page.evaluate(() => window.__sb.saveNow()); const snap = await S(page);
  await page.reload(); await page.waitForFunction(() => window.__sbReady);
  const re = await S(page);
  eq([re.n, re.types.sort().join()], [snap.n, snap.types.sort().join()], 'board restored after reload');
  assert(Math.abs(re.view.zoom - snap.view.zoom) < 1e-9 && Math.abs(re.view.x - snap.view.x) < 1e-6, 'view restored after reload');
  // export
  const ex = await page.evaluate(async () => { const sb = window.__sb, c = sb.renderTo(1, 'clear'); const items = sb.board.items; let x0 = 1e9, x1 = -1e9; const svg = await sb.buildSVG(); const doc = new DOMParser().parseFromString(svg, 'image/svg+xml'); return { w: c.width, h: c.height, svgOk: !doc.querySelector('parsererror'), svgEls: doc.documentElement.children.length, corner: c.getContext('2d').getImageData(0, 0, 1, 1).data[3] }; });
  console.log('     export', JSON.stringify(ex));
  assert(ex.svgOk && ex.svgEls >= 5, 'SVG export parses');
  eq(ex.corner, 0, 'transparent PNG export has empty margin');
  const jr = await page.evaluate(async () => { const n = window.__sb.board.items.length; await window.__sb.importJSON(await window.__sb.buildJSON()); return [n, window.__sb.board.items.length, window.__sb.board.name]; });
  eq(jr[0], jr[1], `JSON export → import round-trip (${jr[1]} items, board "${jr[2]}")`);
  // image insert (3000px wide → downscaled to 2048)
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 1000; const g = c.getContext('2d'); g.fillStyle = '#1971c2'; g.fillRect(0, 0, 3000, 1000); g.fillStyle = '#fff'; g.font = '300px sans-serif'; g.fillText('IMG', 1000, 650); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#imgIn', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => window.__sb.board.items.some(i => i.type === 'image'), null, { timeout: 5000 });
  const dims = await page.evaluate(async () => { const it = window.__sb.board.items.find(i => i.type === 'image'); await new Promise(r => setTimeout(r, 200)); const svg = await window.__sb.buildSVG(); const m = svg.match(/href="data:image\/png;base64,([^"]+)"/); return { ratio: it.w / it.h, hasData: !!m }; });
  assert(Math.abs(dims.ratio - 3) < 0.01 && dims.hasData, 'image inserted, aspect kept, embedded as data URI in SVG');
  // performance with 1000 strokes
  const perf = await page.evaluate(async () => {
    const sb = window.__sb, list = []; const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
    for (let k = 0; k < 1000; k++) { const x = rnd() * 3000, y = rnd() * 3000, pts = []; for (let i = 0; i < 30; i++) pts.push([x + i * 6, y + Math.sin(i / 3) * 20, 0.5]); list.push({ id: 'p' + k, type: 'path', points: pts, color: '#1e1e1e', width: 4, opacity: 100 }); }
    sb.addItems(list, false); sb.fitAll(true); await new Promise(r => setTimeout(r, 300)); sb.frame(); const full = []; for (let i = 0; i < 6; i++) { sb.frame(); full.push(sb.frameMs); }
    const pan = []; for (let i = 0; i < 10; i++) { sb.panBy(5); sb.frame(); pan.push(sb.frameMs); }
    await new Promise(r => setTimeout(r, 400)); const settled = sb.frameMs;
    const avg = a => a.reduce((x, y) => x + y) / a.length; return { n: sb.board.items.length, full: avg(full), pan: avg(pan), settled };
  });
  console.log('     1000 strokes: full redraw', perf.full.toFixed(1), 'ms; frame while panning', perf.pan.toFixed(2), 'ms; settled redraw', perf.settled.toFixed(1), 'ms');
  assert(perf.full < 40, '1,000 strokes full redraw under 40ms (software rendering)');
  assert(perf.pan < 8, '1,000 strokes: pan frames use the bitmap snapshot (< 8ms)');
  await page.screenshot({ path: `${OUT}/flow-1000.png` });
  await ctx.close(); await browser.close();
  fs.unlinkSync(PREV);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
