// Verify watermark: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => {
  const buf = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : data; let s = ''; for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  window.__saved.push({ filename, b64: btoa(s), size: buf.length }); } } : null }; };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(500);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleBanner'), 'sample banner visible');
  assert(await page.evaluate(() => window.__wm.items.length === 2 && window.__wm.items.every(i => i.sample)), '2 sample images');
  // relative size consistency 1000 vs 6000
  const r = await page.evaluate(() => { const S = window.__wm.S; const a = window.__wm.makeMark(S, 1000, null), b = window.__wm.makeMark(S, 6000, null); return [a.width, b.width, a.height, b.height]; });
  assert(Math.abs(r[1] / r[0] / 6 - 1) < 0.02 && Math.abs(r[3] / r[2] / 6 - 1) < 0.02, 'mark scales with short side: ' + r.join(','));
  // grid bottom-right position
  const g = await page.evaluate(() => { const S = Object.assign({}, window.__wm.S, { place: 'grid', cell: 8, margin: 3, rot: 0 }); const c = document.createElement('canvas'); c.width = 1000; c.height = 800; const i = window.__wm.applyWatermark(c.getContext('2d'), 1000, 800, S, null); return [i.cx + i.mw / 2, i.cy + i.mh / 2]; });
  assert(Math.abs(g[0] - 976) < 0.01 && Math.abs(g[1] - 776) < 0.01, 'bottom-right edge at W-m, H-m (m=24): ' + g.join(','));
  // tile coverage at 45 and 30 deg
  for (const deg of [45, 30, -45]) {
    const cov = await page.evaluate(d => { const S = Object.assign({}, window.__wm.S, { mode: 'text', text: '僅供範例使用', place: 'tile', rot: d, opacity: 100, gapX: 130, gapY: 250, size: 4, strokeOn: false, color: '#000000' });
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1000; const x = c.getContext('2d'); window.__wm.applyWatermark(x, 1600, 1000, S, null);
      const box = (x0, y0) => { const d = x.getImageData(x0, y0, 160, 160).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; };
      return [box(0, 0), box(1440, 0), box(0, 840), box(1440, 840)]; }, deg);
    assert(cov.every(v => v > 50), 'tile ' + deg + '° covers all four corners ' + cov.join(','));
  }
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  // template
  await page.click('#tplBtn'); await page.waitForTimeout(200);
  const t = await page.evaluate(() => ({ s: window.__wm.S, sel: [document.activeElement.id, document.activeElement.selectionStart, document.activeElement.selectionEnd] }));
  assert(t.s.text === '僅供＿＿＿使用，他用無效' && t.s.place === 'tile' && t.s.rot === -45 && t.s.opacity === 25, 'ID-copy template applied');
  assert(t.sel[0] === 'wmText' && t.sel[1] === 2 && t.sel[2] === 5, 'cursor selects blanks');
  await page.keyboard.type('房屋租賃');
  assert(await page.evaluate(() => window.__wm.S.text) === '僅供房屋租賃使用，他用無效', 'typing replaces blanks');
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '390x844-template.png') });
  // empty text disables export
  await page.fill('#wmText', '   ');
  assert(await page.isDisabled('#dlOne') && await page.isDisabled('#dlAll') && await page.isVisible('#emptyWarn'), 'empty text -> export disabled with notice');
  await page.fill('#wmText', '範例 © 測試');
  assert(!(await page.isDisabled('#dlOne')), 're-enabled');
  // grid click + drag -> custom
  await page.click('#tileBtn'); await page.click('#cell4');
  assert(await page.evaluate(() => window.__wm.S.place === 'grid' && window.__wm.S.cell === 4), 'grid center selected');
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(100);
  const bb = await page.locator('#preview').boundingBox();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 20, { steps: 5 }); await page.mouse.up();
  const cs = await page.evaluate(() => window.__wm.S);
  assert(cs.place === 'custom' && cs.cx > 0.55, 'drag -> custom position cx=' + cs.cx.toFixed(3));
  // logo mode mono white
  await page.click('#modeLogo'); await page.selectOption('#mono', 'white');
  const px = await page.evaluate(() => { const m = window.__wm.makeMark(window.__wm.S, 1000, (() => { const c = document.createElement('canvas'); c.width = 100; c.height = 50; const x = c.getContext('2d'); x.fillStyle = '#c00'; x.fillRect(20, 10, 60, 30); return c; })()); const d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let white = 0, transp = 0, other = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] === 0) transp++; else if (d[i] === 255 && d[i + 1] === 255 && d[i + 2] === 255) white++; else other++; } return [white, transp, other]; });
  assert(px[0] > 0 && px[1] > 0 && px[2] < px[0] * 0.05, 'mono white keeps transparency: ' + px.join(','));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, '390x844-logo.png') });
  // export one
  await page.click('#dlOne'); await page.waitForFunction(() => window.__saved.length === 1, null, { timeout: 20000 });
  const one = await page.evaluate(() => window.__saved[0]);
  assert(one.filename === '範例-風景-wm.jpg' && one.size > 10000, 'single export ' + one.filename + ' ' + one.size + 'B');
  const dim = await page.evaluate(async b64 => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); const b = await createImageBitmap(new Blob([u])); return [b.width, b.height]; }, one.b64);
  assert(dim[0] === 1600 && dim[1] === 1067, 'export keeps original resolution ' + dim);
  // export all zip
  await page.click('#dlAll'); await page.waitForFunction(() => window.__saved.length === 2, null, { timeout: 30000 });
  const z = await page.evaluate(() => window.__saved[1]);
  const zp = path.join(OUT, 'test.zip'); fs.writeFileSync(zp, Buffer.from(z.b64, 'base64'));
  const zl = execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print('|'.join(z.namelist()))" ${zp}`).toString();
  fs.unlinkSync(zp);
  assert(zl.startsWith('None') && zl.includes('範例-風景-wm.jpg') && zl.includes('範例-會員證-wm.png'), 'zip valid: ' + zl.trim().split('\n')[1]);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  assert(sw, 'no horizontal scroll 390');
  await ctx.close();
  // other sizes
  for (const [w, h, name, extra] of [[360, 780, '360x780.png', { isMobile: true, hasTouch: true }], [844, 390, '844x390.png', { isMobile: true, hasTouch: true }], [390, 844, '390x844-dark.png', { isMobile: true, hasTouch: true, colorScheme: 'dark' }], [1280, 800, '1280x800.png', {}]]) {
    const c = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2 }, extra)); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(() => innerWidth) === w, 'innerWidth ' + w);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll ' + name);
    if (!extra.colorScheme) assert(await p.evaluate(() => !window.claude) && await p.isHidden('#dlAll') && (await p.textContent('#dlOne')) === '產生這張圖片', 'no downloads -> fallback button');
    if (name === '360x780.png') { await p.click('#dlOne'); await p.waitForSelector('#ov:not([hidden])'); await p.screenshot({ path: path.join(OUT, '360x780-fallback.png') }); await p.click('#ovClose'); }
    await p.screenshot({ path: path.join(OUT, name) }); await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  if (errors.length) { console.log('ERRORS', errors); process.exit(1); }
  console.log('ALL PASS');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
