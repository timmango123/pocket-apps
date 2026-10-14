// Verify image-squeeze: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
// Mimic the Artifact publish wrapper (doctype + viewport meta) so isMobile contexts lay out at device width.
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) { throw new Error('ASSERT: ' + m); } console.log('  ok -', m); };

const mockDl = () => {
  window.__saved = [];
  window.claude = { use: async (n) => n === 'downloads' ? { save: async ({ filename, data }) => {
    const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data;
    let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    window.__saved.push({ filename, b64: btoa(s), size: buf.length });
  } } : null };
};

async function waitReady(page, n) {
  await page.waitForFunction(k => window.__sq && window.__sq.items.length === k && window.__sq.items.every(i => i.srcW > 0 && i.thumb), n, { timeout: 30000 });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };

  // ---- main functional run (with mocked downloads) ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_);
  await waitReady(page, 3);
  console.log('samples loaded');
  assert(await page.isVisible('#sampleBanner'), 'sample banner visible');
  const td = await page.evaluate(() => [
    window.__sq.targetDims(4000, 3000, { sizeMode: 'long', sizeVal: 1600 }),
    window.__sq.targetDims(500, 400, { sizeMode: 'width', sizeVal: 1000 }),
    window.__sq.targetDims(500, 400, { sizeMode: 'width', sizeVal: 1000, upscale: true }),
    window.__sq.targetDims(4000, 3000, { sizeMode: 'pct', sizeVal: 50 }),
  ]);
  assert(JSON.stringify(td) === '[[1600,1200],[500,400],[1000,800],[2000,1500]]', 'targetDims ' + JSON.stringify(td));
  const crc = await page.evaluate(() => window.__sq.crc32(new TextEncoder().encode('123456789')).toString(16));
  assert(crc === 'cbf43926', 'crc32("123456789") = cbf43926');
  const ex = await page.evaluate(() => window.__sq.items[0].exif.tags);
  assert(Math.abs(ex.lat - 25.033964) < 1e-3 && Math.abs(ex.lon - 121.564468) < 1e-3 && ex.model === 'Demo Cam X1', 'sample EXIF GPS parsed ' + ex.lat.toFixed(5) + ',' + ex.lon.toFixed(5));
  await page.screenshot({ path: path.join(OUT, '390x844-initial.png') });

  // compress samples: JPG 80, long edge 1600
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__sq.items.every(i => i.status === 'done' || i.status === 'warn' || i.status === 'err'), null, { timeout: 60000 });
  const r1 = await page.evaluate(() => window.__sq.items.map(i => ({ n: i.outName, w: i.outW, h: i.outH, s: i.srcSize, o: i.outBlob.size, t: i.outMime })));
  console.log(r1);
  assert(r1[0].w === 1600 && r1[0].h === 1067 && r1[0].t === 'image/jpeg', 'landscape 2400x1600 -> 1600x1067 jpeg');
  assert(r1[2].w === 1200 && r1[2].h === 1600, 'portrait 1500x2000 -> 1200x1600');
  assert(r1[1].n === '範例-透明標誌-sq.jpg', 'png -> jpg filename');
  // transparent PNG to JPG uses white fill
  const px = await page.evaluate(async () => { const it = window.__sq.items[1]; const b = await createImageBitmap(it.outBlob); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0); return Array.from(x.getImageData(3, 3, 1, 1).data); });
  assert(px[0] > 245 && px[1] > 245 && px[2] > 245, 'transparent corner filled white ' + px);
  const outExif = await page.evaluate(async () => window.__sq.readExif(await window.__sq.items[0].outBlob.arrayBuffer()).found);
  assert(outExif === false, 'output JPEG has no EXIF');
  // EXIF dialog
  await page.locator('li[data-id] [data-act="info"]').first().click();
  await page.waitForFunction(() => /無資料|仍含/.test(document.querySelector('#ovBody').textContent));
  const exText = await page.textContent('#ovBody');
  assert(exText.includes('25.03') && exText.includes('無資料'), 'EXIF dialog shows GPS and removed status');
  await page.screenshot({ path: path.join(OUT, '390x844-exif.png') });
  await page.click('#ovClose');
  await page.click('li[data-id] .thumb');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '390x844-compare.png') });
  await page.click('#ovClose');
  await page.screenshot({ path: path.join(OUT, '390x844-done.png') });

  // ZIP
  await page.click('#zipBtn');
  await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 20000 });
  const z = await page.evaluate(() => window.__saved[0]);
  fs.writeFileSync(path.join(OUT, 'test.zip'), Buffer.from(z.b64, 'base64'));
  assert(/^image-squeeze-\d{8}-\d{4}\.zip$/.test(z.filename), 'zip filename ' + z.filename);

  // feed own canvas-generated files -> samples replaced; target 200KB
  const gen = await page.evaluate(async () => {
    const mkf = async (w, h, type, alpha) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
      const d = x.createImageData(w, h); let s = 1; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const n = s & 255; d.data[i] = (i / 4 % w) * 255 / w; d.data[i + 1] = n; d.data[i + 2] = 255 - n; d.data[i + 3] = alpha && (i / 4 % w) < w / 3 ? 0 : 255; }
      x.putImageData(d, 0, 0); const b = await new Promise(r => c.toBlob(r, type, 0.95)); let str = ''; const u = new Uint8Array(await b.arrayBuffer()); for (let i = 0; i < u.length; i++) str += String.fromCharCode(u[i]); return btoa(str); };
    return [await mkf(3000, 2000, 'image/jpeg', false), await mkf(1200, 900, 'image/png', true)];
  });
  await page.setInputFiles('#fileInput', [
    { name: 'noise-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(gen[0], 'base64') },
    { name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from(gen[1], 'base64') },
    { name: 'readme.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') },
  ]);
  await waitReady(page, 2);
  assert(!(await page.isVisible('#sampleBanner')), 'samples removed after user import; txt skipped');
  await page.click('#setCard > summary');
  await page.check('#targetOn');
  await page.fill('#targetKB', '200'); await page.press('#targetKB', 'Tab');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__sq.items.every(i => ['done', 'warn', 'err'].includes(i.status)), null, { timeout: 90000 });
  const r2 = await page.evaluate(() => window.__sq.items.map(i => ({ n: i.outName, st: i.status, w: i.outW, h: i.outH, s: i.srcSize, o: i.outBlob && i.outBlob.size, note: i.note })));
  console.log(r2);
  for (const r of r2) assert(r.st === 'warn' || r.o <= 200 * 1024, `${r.n} ${r.o}B <= 200KB (or flagged)`);
  // impossible target -> flagged, no infinite loop
  await page.fill('#targetKB', '5'); await page.press('#targetKB', 'Tab');
  await page.click('#startBtn');
  await page.waitForFunction(() => window.__sq.items.every(i => ['done', 'warn', 'err'].includes(i.status)), null, { timeout: 90000 });
  const r3 = await page.evaluate(() => window.__sq.items.map(i => ({ st: i.status, o: i.outBlob.size, note: i.note })));
  console.log(r3);
  assert(r3.some(r => r.st === 'warn' && /無法達到/.test(r.note)) || r3.every(r => r.o <= 5120), '5KB target: flagged or achieved');
  // settings persisted
  await page.reload(); await page.waitForTimeout(500);
  assert(await page.isChecked('#targetOn') && (await page.inputValue('#targetKB')) === '5', 'settings persisted after reload');
  await page.fill('#targetKB', '300'); await page.press('#targetKB', 'Tab'); await page.uncheck('#targetOn');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && innerWidth === 390), 'no horizontal scroll 390');
  await ctx.close();

  // ---- screenshots in other sizes (no downloads capability -> view fallback) ----
  const shots = [
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: '1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of shots) {
    const c = await browser.newContext(s); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await waitReady(p, 3);
    await p.click('#startBtn');
    await p.waitForFunction(() => window.__sq.items.every(i => i.status === 'done' || i.status === 'warn'), null, { timeout: 60000 });
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1] && sw[1] === s.viewport.width, `${s.name} no horizontal scroll (${sw})`);
    if (s.name === '360x780') { assert(await p.isHidden('#zipBtn'), 'no downloads cap -> zip hidden'); assert(await p.isVisible('[data-act="view"]'), 'view fallback shown'); }
    await p.screenshot({ path: path.join(OUT, s.name + '.png') });
    await c.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
