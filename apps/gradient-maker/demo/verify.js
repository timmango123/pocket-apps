// Verify gradient-maker: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size, text: data.type === 'image/svg+xml' ? await data.text() : null }); } } : null }; };
const L = o => Object.assign({ type: 'linear', angle: 135, shape: 'ellipse', size: 'farthest-corner', cx: 50, cy: 50, repeat: false, space: 'srgb' }, o);
const st = (...a) => a.map(([h, p, al]) => ({ c: { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: al == null ? 1 : al }, p }));
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(300);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleTag'), 'sample tag visible');
  const css0 = await page.textContent('#cssOut');
  assert(css0 === 'background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);', 'default CSS: ' + css0);
  const strs = await page.evaluate(([a, b, c]) => [window.__gm.layerCSS(a, 'in'), window.__gm.layerCSS(b, 'in'), window.__gm.layerCSS(c, 'in')],
    [L({ type: 'radial', shape: 'circle', size: 'closest-side', cx: 30, cy: 40, stops: st(['#FF6B6B', 0], ['#4ECDC4', 100, 0.5]) }), L({ type: 'conic', angle: 90, stops: st(['#000000', 0], ['#FFFFFF', 100]) }), L({ space: 'oklab', stops: st(['#FF0000', 0], ['#0000FF', 100]) })]);
  assert(strs[0] === 'radial-gradient(circle closest-side at 30% 40%, #FF6B6B 0%, rgba(78, 205, 196, 0.5) 100%)', strs[0]);
  assert(strs[1] === 'conic-gradient(from 90deg at 50% 50%, #000000 0%, #FFFFFF 100%)', strs[1]);
  assert(strs[2] === 'linear-gradient(135deg in oklab, #FF0000 0%, #0000FF 100%)', strs[2]);
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // canvas vs CSS pixel comparison (DPR1 page)
  const cctx = await browser.newContext({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 }); const cp = await cctx.newPage(); watch(cp);
  await cp.goto(URL_); await cp.waitForTimeout(200);
  const cases = {
    'linear 135': [L({ stops: st(['#FF6B6B', 0], ['#4ECDC4', 100]) })],
    'linear 30 three stops': [L({ angle: 30, stops: st(['#F7971E', 0], ['#2244AA', 40], ['#FFFFFF', 100]) })],
    'radial ellipse farthest-corner 30/40': [L({ type: 'radial', cx: 30, cy: 40, stops: st(['#FFFFFF', 0], ['#1D2671', 100]) })],
    'radial circle closest-side': [L({ type: 'radial', shape: 'circle', size: 'closest-side', cx: 60, cy: 50, stops: st(['#FFD200', 0], ['#C33764', 100]) })],
    'radial ellipse closest-corner': [L({ type: 'radial', size: 'closest-corner', cx: 35, cy: 30, stops: st(['#FFD200', 0], ['#2C7744', 100]) })],
    'conic from 90 at 40/60': [L({ type: 'conic', angle: 90, cx: 40, cy: 60, stops: st(['#FF0000', 0], ['#00FF00', 50], ['#0000FF', 100]) })],
    'repeating linear': [L({ angle: 45, repeat: true, stops: st(['#222222', 0], ['#EEEEEE', 10], ['#222222', 20]) })],
    'repeating radial': [L({ type: 'radial', shape: 'circle', size: 'closest-side', repeat: true, stops: st(['#AA0000', 0], ['#FFFFFF', 20]) })],
    'oklab linear': [L({ angle: 90, space: 'oklab', stops: st(['#FF0000', 0], ['#0000FF', 100]) })],
    'two layers alpha': [L({ type: 'radial', shape: 'circle', size: 'closest-side', cx: 30, cy: 30, stops: st(['#FFFFFF', 0, 0.6], ['#FFFFFF', 100, 0]) }), L({ angle: 180, stops: st(['#0C2D48', 0], ['#2E8BC0', 100]) })],
  };
  for (const [name, layers] of Object.entries(cases)) {
    await cp.evaluate(ls => { window.__gm.G = { layers: ls, sel: 0 }; let d = document.getElementById('cmp'); if (!d) { d = document.createElement('div'); d.id = 'cmp'; d.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;z-index:9999'; document.body.appendChild(d); } d.style.background = window.__gm.previewBg(); }, layers);
    const shot = await cp.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } });
    const diff = await cp.evaluate(async b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const bm = await createImageBitmap(new Blob([u], { type: 'image/png' })); const c1 = document.createElement('canvas'); c1.width = 300; c1.height = 200; const x1 = c1.getContext('2d'); x1.drawImage(bm, 0, 0);
      const a = x1.getImageData(0, 0, 300, 200).data, b = window.__gm.renderCanvas(300, 200).getContext('2d').getImageData(0, 0, 300, 200).data;
      let s = 0, n = 0, mx = 0; for (let y = 5; y < 200; y += 10) for (let x = 5; x < 300; x += 10) { const i = (y * 300 + x) * 4; const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; s += d; n++; if (d > mx) mx = d; } return { mean: s / n, max: mx }; }, shot.toString('base64'));
    assert(diff.mean < 6, 'PNG matches CSS: ' + name + ' mean ' + diff.mean.toFixed(2) + ' max ' + diff.max.toFixed(1));
  }
  // SVG matches canvas for linear + radial
  const svgDiff = await cp.evaluate(async () => { window.__gm.G = { layers: [{ type: 'radial', angle: 0, shape: 'ellipse', size: 'farthest-side', cx: 30, cy: 70, repeat: false, space: 'srgb', stops: [{ c: { r: 255, g: 220, b: 0, a: 1 }, p: 0 }, { c: { r: 20, g: 40, b: 120, a: 1 }, p: 100 }] }, { type: 'linear', angle: 60, shape: 'ellipse', size: 'farthest-corner', cx: 50, cy: 50, repeat: false, space: 'srgb', stops: [{ c: { r: 255, g: 0, b: 0, a: 1 }, p: 0 }, { c: { r: 0, g: 0, b: 255, a: 1 }, p: 100 }] }], sel: 0 };
    const { svg } = window.__gm.toSVG(300, 200); const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await im.decode(); const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const a = x.getImageData(0, 0, 300, 200).data, b = window.__gm.renderCanvas(300, 200).getContext('2d').getImageData(0, 0, 300, 200).data; let s = 0, n = 0; for (let i = 0; i < a.length; i += 40) { s += Math.abs(a[i] - b[i]); n++; } return s / n; });
  assert(svgDiff < 4, 'SVG render matches PNG, mean diff ' + svgDiff.toFixed(2));
  await cctx.close();

  // stop interactions (mobile page)
  const hb = await page.locator('#stop1').boundingBox(); const tb = await page.locator('#track').boundingBox();
  await page.click('#track', { position: { x: tb.width * 0.5, y: 20 } });
  let g = await page.evaluate(() => window.__gm.G.layers[0].stops.map(s => [Math.round(s.p), Math.round(s.c.r)]));
  assert(g.length === 3 && Math.abs(g[2][0] - 50) <= 1 && Math.abs(g[2][1] - Math.round((255 + 78) / 2)) <= 2, 'track click adds interpolated stop at 50%: ' + JSON.stringify(g));
  const h2 = await page.locator('#stop2').boundingBox();
  await page.mouse.move(h2.x + 22, h2.y + 22); await page.mouse.down(); await page.mouse.move(tb.x + tb.width * 0.25, h2.y + 22, { steps: 6 }); await page.mouse.up();
  g = await page.evaluate(() => window.__gm.G.layers[0].stops.map(s => Math.round(s.p)));
  assert(Math.abs(g[2] - 25) <= 1, 'drag stop to 25%: ' + g);
  const h2b = await page.locator('#stop2').boundingBox();
  await page.mouse.move(h2b.x + 22, h2b.y + 22); await page.mouse.down(); await page.mouse.move(h2b.x + 22, tb.y + tb.height + 90, { steps: 6 }); await page.mouse.up();
  assert(await page.evaluate(() => window.__gm.G.layers[0].stops.length) === 2, 'drag down 60px+ deletes stop');
  const h0 = await page.locator('#stop0').boundingBox();
  await page.mouse.move(h0.x + 22, h0.y + 22); await page.mouse.down(); await page.mouse.move(h0.x + 22, tb.y + tb.height + 90, { steps: 6 }); await page.mouse.up();
  assert(await page.evaluate(() => window.__gm.G.layers[0].stops.length) === 2 && await page.isDisabled('#stopDel'), 'cannot delete below 2 stops');
  // hard edge: two stops same position
  await page.evaluate(() => { const l = window.__gm.G.layers[0]; l.stops = [{ c: { r: 255, g: 0, b: 0, a: 1 }, p: 0 }, { c: { r: 255, g: 0, b: 0, a: 1 }, p: 50 }, { c: { r: 0, g: 0, b: 255, a: 1 }, p: 50 }, { c: { r: 0, g: 0, b: 255, a: 1 }, p: 100 }]; l.angle = 90; window.__gm.G = window.__gm.G; });
  const hard = await page.evaluate(() => { const d = window.__gm.renderCanvas(200, 10).getContext('2d').getImageData(0, 5, 200, 1).data; return [d[97 * 4], d[97 * 4 + 2], d[103 * 4], d[103 * 4 + 2]]; });
  assert(hard[0] === 255 && hard[1] === 0 && hard[2] === 0 && hard[3] === 255, 'same-position stops give hard edge ' + hard);
  // dial: click right side -> 90
  await page.click('#tLinear'); await page.uncheck('#snap').catch(() => {});
  const db = await page.locator('#dial').boundingBox(); await page.mouse.click(db.x + db.width - 6, db.y + db.height / 2);
  assert(await page.evaluate(() => window.__gm.G.layers[0].angle) === 90, 'dial right = 90deg');
  await page.mouse.click(db.x + db.width / 2, db.y + db.height - 5);
  assert(await page.evaluate(() => window.__gm.G.layers[0].angle) === 180, 'dial bottom = 180deg');
  // radial + drag centre in preview
  await page.click('#tRadial'); await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
  const pb = await page.locator('#preview').boundingBox();
  await page.mouse.move(pb.x + pb.width * 0.5, pb.y + pb.height * 0.5); await page.mouse.down(); await page.mouse.move(pb.x + pb.width * 0.2, pb.y + pb.height * 0.75, { steps: 5 }); await page.mouse.up();
  const c = await page.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
  assert(Math.abs(c[0] - 20) < 1.5 && Math.abs(c[1] - 75) < 1.5, 'drag centre in preview ' + c);
  assert((await page.textContent('#cssOut')).includes('radial-gradient(ellipse farthest-corner at 20% 75%'), 'CSS updated for radial');
  await page.screenshot({ path: path.join(OUT, '390x844-radial.png') });
  // layers & oklch
  await page.click('#addLayer'); await page.selectOption('#space', 'oklch');
  const css2 = await page.textContent('#cssOut');
  assert(css2.split('\nbackground:').length === 2 && css2.includes(' in oklch') && css2.includes('radial-gradient(circle closest-side at 30% 30%'), 'two layers + oklch two-line CSS');
  // copy CSS
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.click('#copyBtn'); await page.waitForTimeout(150);
  assert((await page.textContent('#toast')).includes('複製'), 'copy toast');
  // presets
  await page.click('#presetBtn'); await page.waitForSelector('#sheet:not([hidden])');
  assert(await page.locator('#presetList button').count() === 24, '24 built-in presets');
  await page.screenshot({ path: path.join(OUT, '390x844-presets.png') });
  await page.click('#saveMine'); assert(await page.locator('#mineList .mine').count() === 1, 'save my preset');
  await page.click('#preset19'); await page.waitForSelector('#sheet', { state: 'hidden' });
  assert((await page.textContent('#cssOut')).startsWith('background: conic-gradient(from 0deg at 50% 50%, #FF0000 0%'), 'apply conic preset 色環');
  // random uses crypto and 2-3 stops
  await page.click('#randBtn'); const rs = await page.evaluate(() => window.__gm.G.layers[0].stops.length); assert(rs >= 2 && rs <= 3, 'random 2-3 stops');
  // export PNG 1080x1920 and SVG
  await page.selectOption('#outSize', '1080x1920'); await page.click('#pngBtn'); await page.waitForFunction(() => window.__saved.length === 1);
  const pngDim = await page.evaluate(async () => { const b = await createImageBitmap(window.__lastPng); return [b.width, b.height, window.__saved[0].filename]; });
  assert(pngDim[0] === 1080 && pngDim[1] === 1920 && pngDim[2] === 'gradient-1080x1920.png', 'PNG 1080x1920 saved');
  await page.click('#svgBtn'); await page.waitForFunction(() => window.__saved.length === 2);
  const sv = await page.evaluate(() => window.__saved[1]); assert(sv.filename.endsWith('.svg') && sv.text.includes('<linearGradient') && sv.text.startsWith('<svg'), 'SVG saved');
  // custom size clamp
  await page.selectOption('#outSize', 'custom'); await page.fill('#outW', '9000'); await page.fill('#outH', '10');
  await page.click('#pngBtn'); await page.waitForFunction(() => window.__saved.length === 3);
  assert(await page.evaluate(() => document.querySelector('#outW').value + 'x' + document.querySelector('#outH').value) === '8192x16', 'custom size clamped to 16-8192');
  // persistence
  const before = await page.textContent('#cssOut'); await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(300);
  assert((await page.textContent('#cssOut')) === before && await page.isHidden('#sampleTag'), 'state restored after reload');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll 390');
  // theme toggle
  await page.click('#themeBtn'); await page.click('#themeBtn'); assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme toggle to dark');
  await ctx.close();
  for (const [w, h, name, extra] of [[360, 780, '360x780.png', { isMobile: true, hasTouch: true }], [844, 390, '844x390.png', { isMobile: true, hasTouch: true }], [390, 844, '390x844-dark.png', { isMobile: true, hasTouch: true, colorScheme: 'dark' }], [1280, 800, '1280x800.png', {}]]) {
    const c2 = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }, extra)); const p = await c2.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(300);
    assert(await p.evaluate(() => innerWidth) === w, 'innerWidth ' + w);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth <= innerWidth, small: [...document.querySelectorAll('button')].filter(b => b.offsetParent && (b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44)).map(b => b.id || b.textContent) }));
    assert(m.sw && m.small.length === 0, name + ' no h-scroll; small buttons: ' + m.small);
    if (name === '360x780.png') { assert((await p.textContent('#pngBtn')) === '產生 PNG', 'no downloads -> 產生 PNG'); await p.click('#pngBtn'); await p.waitForSelector('#ov:not([hidden])'); await p.screenshot({ path: path.join(OUT, '360x780-fallback.png') }); await p.click('#ovClose'); }
    await p.screenshot({ path: path.join(OUT, name) }); await c2.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
