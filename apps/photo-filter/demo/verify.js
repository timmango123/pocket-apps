// Verify photo-filter: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };
const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...mobile });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(600);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleTag'), 'sample photo labelled 範例照片');
  assert(await page.evaluate(() => document.querySelectorAll('#strip .fthumb').length) === 12, '12 filter thumbnails');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // pure pipeline maths on 1-pixel images
  const px = (rgb, params, filter = 'none', strength = 100) => page.evaluate(([rgb, params, filter, strength]) => {
    const { prep, processRows, PARAMS } = window.__pf; const p = Object.fromEntries(PARAMS.map(q => [q.key, q.def])); Object.assign(p, params);
    const src = new Uint8ClampedArray([...rgb, 255]), dst = new Uint8ClampedArray(4);
    processRows(src, 1, 0, 1, dst, 0, 1, 1, 1, prep(p, filter, strength)); return Array.from(dst.slice(0, 3));
  }, [rgb, params, filter, strength]);
  let r = await px([64, 64, 64], { exposure: 1 }); assert(r.every(v => v === 128), 'exposure +1 EV: 64 -> ' + r);
  r = await px([191, 191, 191], { contrast: 100 }); assert(r.every(v => v === 223), 'contrast +100 (k=1.5): 191 -> ' + r);
  r = await px([128, 128, 128], { temp: 100 }); assert(r[0] === 141 && r[1] === 128 && r[2] === 115, 'temp +100 on gray 128 -> ' + r);
  r = await px([200, 60, 40], {}, 'mono'); assert(r[0] === r[1] && r[1] === r[2], 'mono filter makes gray ' + r);
  r = await px([200, 60, 40], {}, 'mono', 0); assert(r[0] === 200 && r[1] === 60 && r[2] === 40, 'filter strength 0 = original');
  r = await px([200, 60, 40], { saturation: -100 }); assert(Math.abs(r[0] - r[1]) <= 1 && Math.abs(r[1] - r[2]) <= 1, 'saturation -100 -> gray ' + r);
  // extreme combos: no NaN black dots
  r = await px([0, 0, 0], { exposure: 2, brightness: 100, contrast: 100, highlights: 100, shadows: 100, saturation: 100, vibrance: 100, temp: 100, tint: 100, sharpen: 100, vignette: 100, grain: 100 }, 'night');
  assert(r.every(v => Number.isFinite(v)), 'extreme params finite ' + r);

  // UI: filter click → preview is monochrome
  await page.click('#f-mono'); await page.waitForTimeout(200);
  const mono = await page.evaluate(() => { const d = document.getElementById('pv').getContext('2d').getImageData(0, 0, 50, 50).data; for (let i = 0; i < d.length; i += 4) if (d[i] !== d[i + 1] || d[i + 1] !== d[i + 2]) return false; return true; });
  assert(mono, 'clicking 黑白 renders gray preview');
  assert((await page.textContent('#metaState')).includes('黑白'), 'meta shows filter name');
  await page.fill('#strength', '40'); await page.dispatchEvent('#strength', 'input');
  assert((await page.textContent('#strOut')) === '40%', 'strength 40%');
  // swipe to next filter
  const st = await page.locator('#stage').boundingBox();
  await page.mouse.move(st.x + 300, st.y + 150); await page.mouse.down(); await page.mouse.move(st.x + 120, st.y + 150, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(150);
  assert(await page.evaluate(() => __pf.S.filter) === 'mono-hc', 'swipe left -> next filter 高反差黑白');
  // long press shows original
  await page.mouse.move(st.x + 200, st.y + 150); await page.mouse.down(); await page.waitForTimeout(550);
  assert(await page.isVisible('#origTag'), 'long press shows 原圖');
  await page.mouse.up(); await page.waitForTimeout(80);
  assert(!(await page.isVisible('#origTag')), 'release returns to edited');

  // adjust tab
  await page.click('#tab-adjust');
  assert(await page.isVisible('#p-exposure'), 'adjust tab shows sliders');
  const h = await page.evaluate(() => document.getElementById('p-exposure').getBoundingClientRect().height);
  assert(h >= 44, 'slider touch height ' + h);
  await page.fill('#p-contrast', '30'); await page.dispatchEvent('#p-contrast', 'input');
  await page.dblclick('#p-contrast'); assert(await page.inputValue('#p-contrast') === '0', 'double click resets slider');
  await page.screenshot({ path: path.join(OUT, '390x844-adjust.png') });
  // compare tab
  await page.click('#tab-compare'); await page.waitForTimeout(100);
  assert(await page.isVisible('#split'), 'compare split line visible');
  await page.screenshot({ path: path.join(OUT, '390x844-compare.png') });
  await page.click('#tab-filter');

  // custom preset saved + persisted
  await page.click('#saveCustom');
  assert(await page.evaluate(() => document.querySelectorAll('#strip .fthumb').length) === 13, 'custom preset added to strip');

  // load a 4000x3000 (12MP) flat gray file, exposure +1, export full resolution
  const b64 = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d'); x.fillStyle = 'rgb(64,64,64)'; x.fillRect(0, 0, 4000, 3000);
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  await page.setInputFiles('#fileInput', { name: 'gray-12mp.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => __pf.S.iw === 4000 && !__pf.S.sample);
  assert(!(await page.isVisible('#sampleTag')), 'sample tag hidden after opening file');
  await page.click('#resetBtn');
  await page.click('#tab-adjust'); await page.fill('#p-exposure', '1'); await page.dispatchEvent('#p-exposure', 'input');
  await page.click('#exportBtn'); await page.click('#exGo');
  await page.waitForFunction(() => window.__saved.length > 0, null, { timeout: 60000 });
  const ex = await page.evaluate(async () => { const s = window.__saved[0]; const b = await createImageBitmap(s.data); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0);
    return { name: s.filename, w: b.width, h: b.height, type: s.data.type, p: Array.from(x.getImageData(2000, 1500, 1, 1).data.slice(0, 3)), q: Array.from(x.getImageData(3999, 2999, 1, 1).data.slice(0, 3)) }; });
  assert(ex.w === 4000 && ex.h === 3000 && ex.name === 'gray-12mp-filtered.jpg' && ex.type === 'image/jpeg', '12MP export ' + ex.w + 'x' + ex.h + ' ' + ex.name);
  assert(ex.p.every(v => Math.abs(v - 128) <= 2) && ex.q.every(v => Math.abs(v - 128) <= 2), 'exported pixels 64 -> ~128 after +1 EV: ' + ex.p + ' / ' + ex.q);
  await page.click('#exClose');

  // reload: custom + last params persisted
  await page.reload(); await page.waitForTimeout(500);
  assert(await page.evaluate(() => document.querySelectorAll('#strip .fthumb').length) === 13, 'custom preset persists after reload');
  assert(await page.evaluate(() => __pf.S.params.exposure) === 1, 'last params restored');
  await page.evaluate(() => { localStorage.clear(); }); await page.reload(); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  await ctx.close();

  // no downloads capability → shows image
  const ctxN = await browser.newContext({ viewport: { width: 390, height: 844 }, ...mobile });
  const pN = await ctxN.newPage(); watch(pN); await pN.goto(URL_); await pN.waitForTimeout(500);
  await pN.click('#exportBtn'); assert((await pN.textContent('#exGo')) === '產生圖片', 'no downloads: button says 產生圖片');
  await pN.click('#exGo'); await pN.waitForSelector('#exResult:not([hidden])', { timeout: 30000 });
  assert(await pN.isVisible('#exImg'), 'no downloads: result image shown for long-press save');
  await ctxN.close();

  for (const [w, h, name, extra] of [[360, 780, '360x780', mobile], [844, 390, '844x390', { isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], [1280, 800, '1280x800', {}]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, ...extra }); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth ' + w);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal scroll');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const cd = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await pd.waitForTimeout(500); await pd.click('#tab-adjust'); await pd.screenshot({ path: path.join(OUT, '390x844-dark.png') }); await cd.close();

  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  await browser.close(); fs.unlinkSync(WRAP); console.log('ALL PASS');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
