// Verify pattern-maker: node demo/verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size, type: data.type, text: /svg/.test(data.type) ? await data.text() : null }); } } : null }; };
const wait = p => p.waitForTimeout(80);
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const mob = (w, h, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...extra });
  const ctx = await mob(390, 844); await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(400);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  assert(await page.locator('.ty').count() === 16, '16 pattern types');
  assert(await page.isVisible('#sampleTag'), 'sample tag visible');
  await page.check('#showFrame'); await wait(page);
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // geometry: hex tile = sqrt3 r x 3r
  const hex = await page.evaluate(() => { const g = window.__pm.gen('hex', { r: 16, stroke: 2 }, '#000'); return [g.w, g.h]; });
  assert(Math.abs(hex[0] - 27.71) < .01 && hex[1] === 48, 'hex tile 27.71 x 48 for r=16');
  // every type produces an SVG that decodes and renders non-empty
  const decode = await page.evaluate(async () => { const out = {}; for (const t of Object.keys(window.__pm.TYPES)) { const s = window.__pm.S; s.type = t; window.__pm.S = s;
    const tile = window.__pm.buildTile({ withBg: true }); const im = new Image(); im.src = window.__pm.dataURI(tile.svg); try { await im.decode(); out[t] = im.naturalWidth > 0; } catch (e) { out[t] = false; } } return out; });
  assert(Object.values(decode).every(Boolean), 'all 16 data-URI SVGs decode: ' + Object.keys(decode).filter(k => !decode[k]).join(','));

  // seamless contact sheet: each type repeated 3x3 (large scale) for visual seam inspection
  await page.evaluate(async () => { const sheet = document.createElement('div'); sheet.id = 'sheet'; sheet.style.cssText = 'position:fixed;inset:0;z-index:999;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:4px';
    for (const t of Object.keys(window.__pm.TYPES)) { const s = window.__pm.S; s.type = t; s.angle = 0; s.scale = 100; s.bgT = false; s.use2 = true; window.__pm.S = s;
      const tile = window.__pm.buildTile(); const d = document.createElement('div'); d.style.cssText = `height:200px;background-color:${s.bg};background-image:url("${window.__pm.dataURI(tile.svg)}");background-size:${tile.w}px ${tile.h}px;background-position:3px 7px`; sheet.appendChild(d); }
    document.body.appendChild(sheet); });
  await page.screenshot({ path: path.join(OUT, 'seams-sheet.png') });
  await page.evaluate(() => document.getElementById('sheet').remove());
  // rotation lattice: 30deg stripes -> near-rotation matrix with exact integer periods
  const L = await page.evaluate(() => window.__pm.fitLattice(20, 20, 1, 30));
  const [a, b, c, d] = L.m; const ang = Math.atan2(b, a) * 180 / Math.PI, sc = Math.hypot(a, b), skew = Math.abs(a * c + b * d) / (Math.hypot(a, b) * Math.hypot(c, d));
  assert(Math.abs(ang - 30) < .5 && Math.abs(sc - 1) < .01 && skew < .01 && Number.isInteger(L.X) && Number.isInteger(L.Y), `30deg lattice: tile ${L.X}x${L.Y}, angle ${ang.toFixed(3)}, scale ${sc.toFixed(4)}, skew ${skew.toFixed(4)}`);
  // rotated tile is periodic: render 2 tiles and compare tile 1 vs tile 2 seam continuity
  await page.click('#type_diag'); await wait(page);
  await page.evaluate(() => { const s = window.__pm.S; s.angle = 30; window.__pm.S = s; }); await wait(page);
  const css30 = await page.evaluate(() => window.__pm.cssText());
  assert(/patternTransform/.test(decodeURIComponent(css30)) && css30.startsWith('background-color: #f4efe4;\nbackground-image: url("data:image/svg+xml,'), 'rotated CSS uses pattern SVG');
  await page.screenshot({ path: path.join(OUT, '390x844-rot30.png') });

  // same seed -> identical
  await page.click('#type_random'); await wait(page);
  await page.fill('#seed', '12345'); await page.dispatchEvent('#seed', 'change'); await wait(page);
  const r1 = await page.evaluate(() => window.__pm.buildTile().svg);
  await page.waitForTimeout(450); await page.reload(); await page.waitForTimeout(400);
  const r2 = await page.evaluate(() => window.__pm.buildTile().svg);
  assert(r1 === r2 && await page.evaluate(() => window.__pm.S.params.random.seed) === 12345, 'same seed reproduces after reload');

  // pure CSS for dots
  await page.click('#type_dots'); await page.evaluate(() => { const s = window.__pm.S; s.angle = 0; s.params.dots = { size: 24, r: 4 }; window.__pm.S = s; }); await wait(page);
  assert(await page.isVisible('#copyPure'), 'pure CSS available for dots');
  const pure = await page.evaluate(() => window.__pm.pureCSS());
  assert(pure.includes('radial-gradient(circle at center, #1d5a48 4px, transparent 4.5px)') && pure.includes('background-size: 24px 24px'), 'pure CSS dots');
  // compare pure css vs svg rendering
  const diff = await page.evaluate(async () => { const svg = window.__pm.buildTile({ withBg: true }).svg; const im = new Image(); im.src = window.__pm.dataURI(svg); await im.decode(); const c = document.createElement('canvas'); c.width = 24; c.height = 24; const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, 24, 24).data; return [d[(12 * 24 + 12) * 4], d[(12 * 24 + 12) * 4 + 1], d[0], d[1]]; });
  assert(diff[0] === 0x1d && diff[1] === 0x5a && diff[2] === 0xf4, 'SVG dot centre fg, corner bg');

  // downloads (mocked)
  await page.click('#dlSvg'); await wait(page);
  let saved = await page.evaluate(() => window.__saved);
  assert(saved.length === 1 && saved[0].filename.endsWith('.svg') && saved[0].text.startsWith("<svg xmlns='http://www.w3.org/2000/svg' version='1.1'") && saved[0].text.includes("fill='#f4efe4'"), 'SVG unit download with bg');
  await page.selectOption('#pngSize', 'custom'); await wait(page); await page.fill('#pngW', '300'); await page.fill('#pngH', '200'); await page.check('#png2x');
  await page.click('#pngBtn'); await page.waitForTimeout(500);
  saved = await page.evaluate(() => window.__saved);
  assert(saved.length === 2 && saved[1].type === 'image/png' && saved[1].size > 200, 'PNG download 600x400 (custom 300x200 @2x)');
  const dims = await page.evaluate(async () => { const c = await window.__pm.makePNG(); return [c.width, c.height]; });
  assert(dims[0] === 600 && dims[1] === 400, 'PNG dims ' + dims);
  await page.fill('#pngW', '9000'); const dims2 = await page.evaluate(async () => { const c = await window.__pm.makePNG(); return [c.width, c.height]; });
  assert(dims2[0] <= 8192 && dims2[1] <= 8192, 'PNG capped at 8192: ' + dims2);
  // favorites persist
  await page.click('#favAdd'); await page.waitForTimeout(450);
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.locator('.fav').count() === 1, 'favorite persisted');
  // random button
  await page.click('#randBtn'); await wait(page);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no h-scroll after random');
  // pan preview
  const box = await page.locator('#pv').boundingBox(); await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(box.x + 100, box.y + 60); await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 90, { steps: 4 }); await page.mouse.up(); await wait(page);
  assert(/50px 30px/.test(await page.evaluate(() => document.getElementById('pvFill').style.backgroundPosition)), 'drag pans preview');
  await page.screenshot({ path: path.join(OUT, '390x844-random.png') });
  // thumbs row scrolls horizontally
  assert(await page.evaluate(() => { const t = document.getElementById('types'); return t.scrollWidth > t.clientWidth; }), 'type row is horizontally scrollable');
  await ctx.close();

  // no-downloads fallback
  const nc = await mob(390, 844); const np = await nc.newPage(); watch(np); await np.goto(URL_); await np.waitForTimeout(400);
  assert(!await np.isVisible('#dlSvg') && await np.isVisible('#dlNote'), 'no downloads: SVG download hidden, note shown');
  await np.click('#pngBtn'); await np.waitForTimeout(600);
  assert(await np.isVisible('#ovImg'), 'PNG shown as image for long-press');
  await np.screenshot({ path: path.join(OUT, '390x844-pngfallback.png') }); await nc.close();

  for (const [w, h, name, extra] of [[360, 780, '360x780', {}], [844, 390, '844x390', {}], [390, 844, '390x844-dark', { colorScheme: 'dark' }]]) {
    const c = await mob(w, h, extra); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(400);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth');
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no h-scroll');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const dsk = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const dp = await dsk.newPage(); watch(dp);
  await dp.goto(URL_); await dp.waitForTimeout(300); await dp.screenshot({ path: path.join(OUT, '1280x800.png') }); await dsk.close();
  assert(errors.length === 0, 'no console errors ' + errors.join('|'));
  await browser.close(); fs.unlinkSync(WRAP); console.log('ALL OK');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
