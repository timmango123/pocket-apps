// Verify palette-lab: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const OUT = __dirname;
// Mimic the Artifact publish wrapper (doctype + viewport meta) so isMobile contexts lay out at device width.
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { const u = new Uint8Array(await data.arrayBuffer()); window.__saved.push({ filename, size: u.length, sig: Array.from(u.slice(0, 4)), w: new DataView(u.buffer).getUint32(16), h: new DataView(u.buffer).getUint32(20) }); } } : null }; };

async function canvasFile(page, spec) { // build an image in page canvas, return base64
  return page.evaluate(async (s) => {
    const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; const x = c.getContext('2d');
    if (s.kind === 'blocks') { s.colors.forEach((col, i) => { x.fillStyle = col; x.fillRect(Math.round(i * s.w / s.colors.length), 0, Math.ceil(s.w / s.colors.length), s.h); }); }
    if (s.kind === 'fill') { x.fillStyle = s.color; x.fillRect(0, 0, s.w, s.h); }
    // 'clear' leaves it transparent
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let str = ''; for (let i = 0; i < u.length; i += 8192) str += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(str);
  }, spec);
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_);
  await page.waitForFunction(() => window.__pl && window.__pl.strip.length === 5);
  assert((await page.textContent('#heroTag')) === '範例主色', 'opens with labelled sample base colour');
  await page.screenshot({ path: path.join(OUT, '390x844-initial.png') });

  // --- colour math ---
  const m = await page.evaluate(() => { const P = window.__pl; const pc = P.parseColor; const T = P.toHex;
    return { names: P.names, a: T(pc('#000')), b: T(pc('rgb(30, 58, 95)')), c: T(pc('hsl(213, 52%, 25%)')), d: T(pc('tomato')), e: pc('#1E3A5F80').a, f: pc('nope'), g: T(pc('rgba(255 0 0 / 50%)')),
      r1: P.ratioStr(P.contrast(pc('#000'), pc('#fff'))), r2: P.ratioStr(P.contrast(pc('#777'), pc('#fff'))), r3: P.ratioStr(P.contrast(pc('#1E3A5F'), pc('#fff'))),
      ok: P.rgbToOklch(pc('#ff0000')).map(v => +v.toFixed(3)), back: T(P.oklchToRgb(0.628, 0.2577, 29.23)),
      mat: P.generate(pc('#1E6091'), 'material').length, mono: P.generate(pc('#1E6091'), 'mono').length,
      analog: P.generate(pc('#ff0000'), 'analog').map(T), tetrad: P.generate(pc('#ff0000'), 'tetrad').map(T) }; });
  console.log(m);
  assert(m.names === 148, '148 CSS colour names');
  assert(m.a === '#000000' && m.b === '#1E3A5F' && m.d === '#FF6347' && m.f === null, 'parse hex / rgb / names / invalid');
  assert(m.c === '#1F3C61', 'parse hsl(213,52%,25%) → #1F3C61 (hand-computed)');
  assert(Math.abs(m.e - 0.502) < 0.002 && m.g === '#FF000080', '#RRGGBBAA alpha + rgba()');
  assert(m.r1 === '21.00' && m.r2 === '4.48', '#000/#fff = 21.00, #777/#fff = 4.48');
  assert(Math.abs(m.ok[0] - 0.628) < 0.002 && Math.abs(m.ok[1] - 0.258) < 0.002 && Math.abs(m.ok[2] - 29.23) < 0.1, 'OKLCH of #FF0000 = ' + m.ok);
  assert(m.back === '#FF0000', 'OKLCH round-trip to #FF0000');
  assert(m.mat === 10 && m.mono === 6, 'material 10 steps / mono 6 steps');
  assert(JSON.stringify(m.analog) === JSON.stringify(['#FF0080', '#FF0040', '#FF0000', '#FF4000', '#FF8000']), 'analogous of red ' + m.analog);
  assert(m.tetrad[1] === '#80FF00' && m.tetrad[2] === '#00FFFF', 'tetrad of red');

  // --- base input UI ---
  await page.fill('#hexIn', '#1E3A5F');
  assert((await page.textContent('#heroHex')) === '#1E3A5F' && (await page.textContent('#heroTag')) === '主色', 'HEX input updates hero');
  await page.fill('#hexIn', 'zzz');
  assert(await page.$eval('#hexIn', e => e.classList.contains('bad')) && (await page.textContent('#heroHex')) === '#1E3A5F', 'invalid input → red border, keeps last valid');
  await page.fill('#hexIn', 'rebeccapurple'); await page.fill('#hexIn', '#1E6091');
  await page.selectOption('#rule', 'analog');

  // --- contrast UI: #777 on #fff ---
  await page.fill('#fgHex', '#777'); await page.fill('#bgHex', '#fff'); await page.click('h1');
  assert((await page.textContent('#ratio')) === '4.48:1', 'UI shows 4.48:1');
  const badges = await page.$$eval('#badges .bd', bs => bs.map(b => b.className.includes('pass')));
  assert(JSON.stringify(badges) === '[false,true,false,false]', 'AA normal fail, AA large pass, AAA fail ×2');
  assert(await page.isVisible('#applyFix'), 'suggest-fix offered');
  await page.click('#applyFix');
  const after = await page.textContent('#ratio');
  assert(parseFloat(after) >= 4.5, 'after fix ratio ' + after);
  await page.fill('#fgHex', '#000'); await page.fill('#bgHex', '#fff'); await page.click('h1');
  assert((await page.textContent('#ratio')) === '21.00:1', 'UI shows 21.00:1');
  await page.fill('#fgHex', '#00000080'); await page.click('h1');
  const semi = await page.textContent('#ratio');
  assert(semi === '4.00:1', 'semi-transparent black on white composited → ' + semi);

  // --- strip: detail, lock (long press), rule switch keeps locks, drag reorder ---
  const sw = i => page.locator('#strip .sw').nth(i);
  await sw(1).click();
  assert(await page.isVisible('#detail'), 'tap swatch opens detail');
  const det = await page.textContent('#detail');
  assert(/HEX/.test(det) && /OKLCH/.test(det) && /oklch\(/.test(det), 'detail lists HEX/RGB/HSL/OKLCH');
  async function longPress(i) { const b = await sw(i).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + 30); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); }
  await longPress(0); await longPress(3);
  const lockedBefore = await page.evaluate(() => window.__pl.strip.map(s => s.locked ? window.__pl.toHex(s.c) : null));
  assert(lockedBefore.filter(Boolean).length === 2, 'long-press locked 2 swatches');
  await page.selectOption('#rule', 'triad');
  await page.selectOption('#rule', 'material');
  const lockedAfter = await page.evaluate(() => window.__pl.strip.map(s => s.locked ? window.__pl.toHex(s.c) : null));
  assert(lockedAfter[0] === lockedBefore[0] && lockedAfter[3] === lockedBefore[3], 'locked colours keep value & position after rule change');
  assert((await page.evaluate(() => window.__pl.strip.length)) === 10, 'material gives 10 swatches');
  await page.screenshot({ path: path.join(OUT, '390x844-material.png') });
  await page.selectOption('#rule', 'comp');
  const order0 = await page.evaluate(() => window.__pl.strip.map(s => window.__pl.toHex(s.c)));
  { const a = await sw(1).boundingBox(), b = await sw(3).boundingBox(); await page.mouse.move(a.x + a.width / 2, a.y + 40); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(a.x + a.width / 2 + (b.x - a.x) * k / 8, a.y + 40); await page.mouse.up(); }
  const order1 = await page.evaluate(() => window.__pl.strip.map(s => window.__pl.toHex(s.c)));
  assert(order1[3] === order0[1] && order1.length === order0.length, 'drag reorders swatch 2 → 4');

  // --- export ---
  await page.click('#copyCss');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(/^:root\{\n  --c1: #[0-9A-F]{6};/.test(clip), 'CSS variables copied');
  await page.click('#copyJson');
  const js = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  assert(js.length === 5 && js[0].hex && js[0].rgb.length === 3 && js[0].hsl.length === 3, 'JSON copied');
  await page.click('#pngBtn');
  await page.waitForFunction(() => window.__saved.length === 1);
  const png = await page.evaluate(() => window.__saved[0]);
  assert(png.sig.join() === '137,80,78,71' && png.w === 1200 && png.h === 630 && /^palette-\d{8}-\d{4}\.png$/.test(png.filename), 'PNG card 1200×630 saved as ' + png.filename);

  // --- saved palettes ---
  await page.click('#saveBtn');
  await page.reload(); await page.waitForFunction(() => window.__pl && window.__pl.strip.length > 0);
  assert((await page.inputValue('#hexIn')) === '#1E6091' && (await page.inputValue('#rule')) === 'comp', 'last base & rule restored');
  await page.click('#drawerBtn');
  assert((await page.locator('.sv').count()) === 1, 'saved palette persists after reload');
  const nameId = await page.locator('.sv input').getAttribute('id');
  await page.fill('#' + nameId, '品牌提案 A'); await page.press('#' + nameId, 'Enter'); await page.click('#drawer header h3');
  await page.screenshot({ path: path.join(OUT, '390x844-drawer.png') });
  await page.click('.sv [data-act="del"]'); await page.click('.sv [data-act="del"]');
  assert((await page.locator('.sv').count()) === 0, 'two-step delete');
  await page.click('#drawerClose');

  // --- photo ---
  await page.click('#tab-photo');
  await page.waitForFunction(() => window.__pl.strip.length === 5 && !document.querySelector('#photoBadge').hidden);
  await page.screenshot({ path: path.join(OUT, '390x844-photo.png') });
  const known = ['#1B2A41', '#E63946', '#F1FAEE', '#A8DADC', '#F4A261'];
  const b64 = await canvasFile(page, { kind: 'blocks', w: 1000, h: 400, colors: known });
  await page.setInputFiles('#photoIn', { name: 'blocks.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => document.querySelector('#photoBadge').hidden && window.__pl.strip.length === 5);
  const ex = await page.evaluate(() => window.__pl.strip.map(s => window.__pl.toHex(s.c)));
  console.log('extracted', ex);
  const near = (a, b) => { const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const x = p(a), y = p(b); return Math.max(...x.map((v, i) => Math.abs(v - y[i]))) <= 6; };
  assert(known.every(k => ex.some(e => near(e, k))), 'median cut recovers the 5 known block colours');
  // tap-pick: centre of the 2nd block (#E63946)
  const cb = await page.locator('#photoCv').boundingBox();
  await page.mouse.click(cb.x + cb.width * 0.3, cb.y + cb.height / 2);
  assert(near(await page.textContent('#pickedHex'), '#E63946'), 'tap pick reads #E63946 → ' + await page.textContent('#pickedHex'));
  await page.click('#n8');
  // white / transparent / large images
  await page.setInputFiles('#photoIn', { name: 'white.png', mimeType: 'image/png', buffer: Buffer.from(await canvasFile(page, { kind: 'fill', w: 300, h: 300, color: '#fff' }), 'base64') });
  await page.waitForFunction(() => window.__pl.strip.some(s => window.__pl.toHex(s.c) === '#FFFFFF'));
  assert(/只找到 1 種/.test(await page.textContent('#photoErr')), 'pure white image → 1 colour + note');
  await page.setInputFiles('#photoIn', { name: 'clear.png', mimeType: 'image/png', buffer: Buffer.from(await canvasFile(page, { kind: 'clear', w: 300, h: 300 }), 'base64') });
  await page.waitForFunction(() => /全透明/.test(document.querySelector('#photoErr').textContent));
  assert(true, 'transparent PNG → clear message, no crash');
  await page.setInputFiles('#photoIn', { name: 'big.png', mimeType: 'image/png', buffer: Buffer.from(await canvasFile(page, { kind: 'blocks', w: 5000, h: 5000, colors: ['#123456', '#abcdef', '#fedcba'] }), 'base64') });
  await page.waitForFunction(() => window.__pl.strip.some(s => window.__pl.toHex(s.c) === '#ABCDEF'), null, { timeout: 30000 });
  assert(true, '5000×5000 image handled');
  await page.setInputFiles('#photoIn', { name: 'bad.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image') });
  await page.waitForFunction(() => /無法讀取/.test(document.querySelector('#photoErr').textContent));
  assert(true, 'undecodable file → message');
  const sw390 = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  assert(sw390[0] <= sw390[1] && sw390[1] === 390, 'no horizontal scroll at 390');
  await ctx.close();

  // --- screenshots ---
  const shots = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: '1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of shots) {
    const c = await browser.newContext(s); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForFunction(() => window.__pl && window.__pl.strip.length === 5);
    if (s.name === '360x780') { await p.selectOption('#rule', 'material'); await p.selectOption('#rule', 'mono'); }
    if (s.name === '390x844-dark') { await p.locator('#strip .sw').nth(2).click(); }
    const w = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[0] <= w[1] && w[1] === s.viewport.width, `${s.name} no horizontal scroll (${w})`);
    if (s.name === '360x780') { const mw = await p.$$eval('#strip .sw', a => Math.min(...a.map(e => e.getBoundingClientRect().width))); assert(mw >= 40, '6 swatches ≥40px wide at 360 (' + mw.toFixed(1) + ')'); }
    await p.screenshot({ path: path.join(OUT, s.name + '.png') });
    await c.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
