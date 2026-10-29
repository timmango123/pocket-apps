// Verify blur-brush: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size }); } } : null }; };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForFunction(() => window.__bb && window.__bb.img && window.__bb.histLen === 1);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.evaluate(() => window.__bb.img.sample && document.querySelector('#chips').textContent.includes('範例')), 'sample screenshot labelled 範例');
  const cells = await page.evaluate(() => [window.__bb.minCell(), window.__bb.effCell()]);
  assert(cells[0] === 9 && cells[1] === 16, 'min cell = max(8, 750*1.2%)=9, effective 16: ' + cells);
  // helpers in page
  await page.evaluate(() => {
    const q = window.__bb.sens()[0]; const x0 = Math.ceil(q.x / 16) * 16, y0 = Math.ceil(q.y / 16) * 16; window.__R = { x0, y0, w: Math.floor((q.x + q.w - x0) / 16) * 16, h: Math.floor((q.y + q.h - y0) / 16) * 16, cx: Math.round(q.x + q.w / 2), cy: Math.round(q.y + q.h / 2), q };
    window.__a = (x, y) => window.__bb.layers().mask.getContext('2d').getImageData(x, y, 1, 1).data[3];
    window.__cellUniform = (x0, y0, cell) => { const d = window.__bb.layers().comp.getContext('2d').getImageData(x0, y0, cell, cell).data; for (let i = 4; i < d.length; i += 4) for (let k = 0; k < 3; k++) if (Math.abs(d[i + k] - d[k]) > 1) return false; return true; };
    window.__diff = (x, y, w, h) => { const L = window.__bb.layers(); const a = L.comp.getContext('2d').getImageData(x, y, w, h).data, b = L.base.getContext('2d').getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
  });
  // premasked phone area is mosaic: cells aligned at multiples of 16 are uniform
  assert(await page.evaluate(() => window.__a(__R.cx, __R.cy) === 255 && window.__R.w >= 128 && window.__R.h >= 16 && [...Array(window.__R.w / 16)].every((_, i) => window.__cellUniform(__R.x0 + i * 16, __R.y0, 16))), 'pre-masked phone region is uniform 16px blocks');
  assert(await page.evaluate(() => window.__a(300, 900) === 0 && window.__diff(40, 860, 300, 60) === 0), 'unmasked area identical to original');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  // brush stroke via mouse
  const toScreen = async (ix, iy) => page.evaluate(([ix, iy]) => { const r = document.querySelector('#view').getBoundingClientRect(); const st = window.__bb; const L = st.layers(); return null; }, [ix, iy]);
  const bb = await page.locator('#view').boundingBox();
  const map = await page.evaluate(() => { const r = document.querySelector('#stage').getBoundingClientRect(); const img = window.__bb.img; const vs = Math.min(r.width / img.w, r.height / img.h) * 0.96; return { vs, tx: (r.width - img.w * vs) / 2, ty: (r.height - img.h * vs) / 2 }; });
  const sp = (ix, iy) => [bb.x + map.tx + ix * map.vs, bb.y + map.ty + iy * map.vs];
  let [x1, y1] = sp(60, 240), [x2, y2] = sp(420, 240);
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 12 }); await page.mouse.up();
  await page.evaluate(() => window.__bb.histDone());
  assert(await page.evaluate(() => window.__a(240, 240) === 255 && window.__bb.histLen === 2), 'brush stroke painted mask, history=2');
  assert(await page.evaluate(() => window.__diff(150, 225, 200, 30) > 5), 'stroked area replaced by mosaic');
  // switch to blur keeps mask
  await page.click('#eBlur'); await page.evaluate(() => window.__bb.histDone());
  assert(await page.evaluate(() => window.__a(240, 240) === 255 && window.__a(__R.cx, __R.cy) === 255 && window.__diff(150, 225, 200, 30) > 2), 'switch to blur keeps painted areas');
  await page.click('#eSolid'); await page.evaluate(() => window.__bb.histDone());
  const solid = await page.evaluate(() => Array.from(window.__bb.layers().comp.getContext('2d').getImageData(__R.cx, __R.cy, 1, 1).data));
  assert(solid[0] === 17 && solid[1] === 17 && solid[2] === 17, 'solid black fill ' + solid);
  await page.click('#eMosaic'); await page.evaluate(() => window.__bb.histDone());
  // rect
  await page.click('#tRect');
  [x1, y1] = sp(60, 1180); [x2, y2] = sp(300, 1240);
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); await page.evaluate(() => window.__bb.histDone());
  assert(await page.evaluate(() => window.__a(180, 1210) === 255 && window.__a(320, 1210) === 0), 'rect fills mask exactly');
  // eraser
  await page.click('#tErase');
  [x1, y1] = sp(150, 1210); [x2, y2] = sp(220, 1210);
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move(x2, y2, { steps: 6 }); await page.mouse.up(); await page.evaluate(() => window.__bb.histDone());
  assert(await page.evaluate(() => window.__a(185, 1210) === 0 && window.__a(80, 1200) === 255), 'eraser restores original under stroke');
  const hl = await page.evaluate(() => window.__bb.histLen);
  // undo / redo
  await page.click('#undoBtn'); await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__a(185, 1210) === 255), 'undo eraser');
  await page.click('#undoBtn'); await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__a(180, 1210) === 0), 'undo rect');
  await page.click('#redoBtn'); await page.waitForTimeout(150);
  assert(await page.evaluate(() => window.__a(180, 1210) === 255), 'redo rect');
  // undo many steps back to start, then back -> effect also restored
  for (let i = 0; i < hl; i++) await page.evaluate(() => window.__bb.undo());
  await page.evaluate(() => window.__bb.histDone());
  assert(await page.evaluate(() => window.__bb.hi === 0 && window.__a(240, 240) === 0 && window.__a(__R.cx, __R.cy) === 255), 'undo to initial state');
  // two-finger pinch cancels stroke and zooms
  await page.click('#tBrush');
  const pin = await page.evaluate(async () => {
    const v = document.querySelector('#view'), r = v.getBoundingClientRect(); const ev = (t, id, x, y) => v.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 11, button: 0 }));
    const before = window.__a(375, 500 * 0 + 667); const z0 = document.querySelector('#zoomTag').textContent;
    ev('pointerdown', 11, r.width / 2 - 20, r.height / 2); ev('pointermove', 11, r.width / 2 - 25, r.height / 2 + 5);
    const during = window.__bb.layers().mask.getContext('2d').getImageData(0, 0, 750, 1334).data.reduce((s, v, i) => i % 4 === 3 ? s + v : s, 0);
    ev('pointerdown', 12, r.width / 2 + 20, r.height / 2);
    await new Promise(r => setTimeout(r, 200));
    ev('pointermove', 11, r.width / 2 - 80, r.height / 2); ev('pointermove', 12, r.width / 2 + 80, r.height / 2);
    ev('pointerup', 11, r.width / 2 - 80, r.height / 2); ev('pointerup', 12, r.width / 2 + 80, r.height / 2);
    // wait on the condition (the cancelled stroke is restored from the history blob asynchronously; zoom tag updates on the next frame)
    const sumA = () => window.__bb.layers().mask.getContext('2d').getImageData(0, 0, 750, 1334).data.reduce((s, v, i) => i % 4 === 3 ? s + v : s, 0);
    for (let t0 = performance.now(); performance.now() - t0 < 5000 && (sumA() >= during || document.querySelector('#zoomTag').textContent === z0);) await new Promise(r => setTimeout(r, 50));
    const after = window.__bb.layers().mask.getContext('2d').getImageData(0, 0, 750, 1334).data.reduce((s, v, i) => i % 4 === 3 ? s + v : s, 0);
    return { during, after, zoom: document.querySelector('#zoomTag').textContent, hist: window.__bb.histLen };
  });
  assert(pin.after < pin.during && parseInt(pin.zoom) > Math.round(map.vs * 100) * 2.5, 'second finger cancels stroke and pinch zooms: ' + JSON.stringify(pin));
  // stroke outside image -> no error
  await page.evaluate(() => { const v = document.querySelector('#view'), r = v.getBoundingClientRect(); const ev = (t, x, y) => v.dispatchEvent(new PointerEvent(t, { pointerId: 21, pointerType: 'touch', clientX: r.left + x, clientY: r.top + y, bubbles: true, button: 0 })); document.querySelector('#tHand').click(); });
  await page.keyboard.press('0'); await page.click('#tBrush');
  await page.mouse.move(bb.x + 2, bb.y + 2); await page.mouse.down(); await page.mouse.move(bb.x + 8, bb.y + 4, { steps: 3 }); await page.mouse.up();
  await page.screenshot({ path: path.join(OUT, '390x844-edit.png') });
  // fallback box blur
  const fb = await page.evaluate(() => { window.__bb.setFilterOK(false); document.querySelector('#eBlur').click(); const e = window.__bb.layers().effect.getContext('2d').getImageData(__R.q.x, __R.q.y, __R.q.w, __R.q.h).data, b = window.__bb.layers().base.getContext('2d').getImageData(__R.q.x, __R.q.y, __R.q.w, __R.q.h).data; const v = d => { let m = 0, s = 0, n = 0; for (let i = 0; i < d.length; i += 4) { m += d[i]; n++; } m /= n; for (let i = 0; i < d.length; i += 4) s += (d[i] - m) ** 2; return s / n; }; return [v(b), v(e)]; });
  assert(fb[1] < fb[0] * 0.6, 'JS box-blur fallback reduces variance ' + fb.map(Math.round));
  await page.click('#eMosaic');
  // export
  await page.click('#exportBtn'); await page.waitForFunction(() => window.__saved.length === 1);
  const sv = await page.evaluate(() => window.__saved[0]);
  assert(sv.filename === '範例截圖-masked.png' && sv.size > 5000, 'export png ' + JSON.stringify(sv));
  const irr = await page.evaluate(async () => { const b = await createImageBitmap(window.__lastExport); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0); const L = window.__bb.layers(); const R = window.__R, RW = R.w, RH = R.h; const d = x.getImageData(R.x0, R.y0, RW, RH).data;
    let uniform = true; for (let by = 0; by < RH / 16; by++) for (let bx = 0; bx < RW / 16; bx++) { const i0 = ((by * 16) * RW + bx * 16) * 4; for (let yy = 0; yy < 16; yy++) for (let xx = 0; xx < 16; xx++) { const i = ((by * 16 + yy) * RW + bx * 16 + xx) * 4; if (Math.abs(d[i] - d[i0]) > 1) uniform = false; } }
    const q = R.q, o = L.base.getContext('2d').getImageData(q.x, q.y, q.w, q.h).data, d2 = x.getImageData(q.x, q.y, q.w, q.h).data; let same = 0; for (let i = 0; i < o.length; i += 4) if (o[i] === d2[i] && o[i + 1] === d2[i + 1] && o[i + 2] === d2[i + 2] && o[i] < 120) same++; return { w: b.width, h: b.height, uniform, darkTextPixelsSurviving: same }; });
  assert(irr.w === 750 && irr.h === 1334 && irr.uniform && irr.darkTextPixelsSurviving === 0, 'exported phone region fully blocky, no original text pixels: ' + JSON.stringify(irr));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll 390');
  await ctx.close();
  for (const [w, h, name, extra] of [[360, 780, '360x780.png', { isMobile: true, hasTouch: true }], [844, 390, '844x390.png', { isMobile: true, hasTouch: true }], [390, 844, '390x844-dark.png', { isMobile: true, hasTouch: true, colorScheme: 'dark' }], [1280, 800, '1280x800.png', {}]]) {
    const c = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }, extra)); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForFunction(() => window.__bb && window.__bb.img); await p.waitForTimeout(300);
    assert(await p.evaluate(() => innerWidth) === w, 'innerWidth ' + w);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth <= innerWidth, sh: document.documentElement.scrollHeight <= innerHeight, stage: document.querySelector('#stage').getBoundingClientRect().height, small: [...document.querySelectorAll('button')].filter(b => b.offsetParent && (b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44)).map(b => b.id || b.textContent) }));
    assert(m.sw && m.sh && m.stage > 150 && m.small.length === 0, name + ' fits, stage ' + Math.round(m.stage) + 'px, small buttons: ' + m.small);
    if (name === '360x780.png') { assert(!(await p.evaluate(() => !!window.claude)), 'no downloads env'); await p.click('#exportBtn'); await p.waitForSelector('#ov:not([hidden])'); await p.screenshot({ path: path.join(OUT, '360x780-fallback.png') }); await p.click('#ovClose'); }
    await p.screenshot({ path: path.join(OUT, name) }); await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
