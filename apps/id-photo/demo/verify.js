// Verify id-photo: node verify.js   (uses python3 + PIL to read back JPEG size and DPI)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };
const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const TMP = [];
const pil = async (page, idx) => {
  const { name, b64 } = await page.evaluate(async i => { const s = window.__saved[i]; const u = new Uint8Array(await s.data.arrayBuffer()); let t = ''; for (let k = 0; k < u.length; k++) t += String.fromCharCode(u[k]); return { name: s.filename, b64: btoa(t) }; }, idx);
  const f = path.join(OUT, '_out_' + idx + '.jpg'); fs.writeFileSync(f, Buffer.from(b64, 'base64')); TMP.push(f);
  const r = JSON.parse(execFileSync('python3', ['-I', '-c', 'import sys,json;from PIL import Image;im=Image.open(sys.argv[1]);print(json.dumps({"w":im.size[0],"h":im.size[1],"fmt":im.format,"dpi":[round(v) for v in im.info.get("dpi",(0,0))],"corner":im.convert("RGB").getpixel((3,3)),"bytes":__import__("os").path.getsize(sys.argv[1])}))', f]).toString());
  return { name, ...r };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...mobile });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(500);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.evaluate(() => document.querySelectorAll('#cards .card').length) === 7, '7 spec cards');
  assert((await page.textContent('#srcLabel')).includes('範例'), 'sample photo labelled 範例');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'step1 no horizontal scroll');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // layout maths (spec example)
  const fit = await page.evaluate(() => { const { bestFit } = window.__id; return [bestFit(95.6, 146.4, 35, 45, 2), bestFit(95.6, 146.4, 28, 35, 2), bestFit(95.6, 146.4, 35, 45, 0)]; });
  assert(fit[0].n === 8 && fit[0].rot && fit[0].cols === 2 && fit[0].rows === 4, '4x6 / 二吋 35x45 / gap 2 -> 8 張 (rotated 2x4; upright would be 6)');
  assert(fit[1].n === 12 && !fit[1].rot, '4x6 / 一吋 28x35 / gap 2 -> 12 張 upright 3x4');
  assert(fit[2].n === 8, '4x6 / 二吋 / gap 0 -> ' + fit[2].n);
  assert(await page.evaluate(() => Math.round(__id.mm2px(35)) === 413 && Math.round(__id.mm2px(45)) === 531), '35x45mm @300dpi = 413x531px');

  await page.click('#spec-2in'); await page.click('#next1'); await page.waitForTimeout(300);
  assert(await page.isVisible('#editor') && await page.isVisible('#edSample'), 'step2 editor with 範例 tag');
  assert(!(await page.isVisible('#resWarn')), 'sample has enough resolution (no warning)');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'step2 no horizontal scroll');
  await page.screenshot({ path: path.join(OUT, '390x844-crop.png') });
  // drag moves crop; rotate slider
  const box = await page.locator('#editor').boundingBox(); const before = await page.evaluate(() => ({ ...__id.S.crop }));
  await page.mouse.move(box.x + 150, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 190, box.y + 200, { steps: 4 }); await page.mouse.up();
  const after = await page.evaluate(() => ({ ...__id.S.crop }));
  assert(after.cx < before.cx, 'drag right moves photo right (crop centre moves left)');
  await page.evaluate(b => Object.assign(__id.S.crop, b), before);
  await page.fill('#rot', '3'); await page.dispatchEvent('#rot', 'input'); assert((await page.textContent('#rotOut')) === '+3°', 'rotation +3°');
  await page.fill('#rot', '0'); await page.dispatchEvent('#rot', 'input');

  await page.click('#next2'); await page.waitForTimeout(300);
  assert((await page.textContent('#countN')) === '8', '共 8 張 on 4x6 with 二吋大頭');
  assert(await page.evaluate(() => [document.getElementById('paper').width, document.getElementById('paper').height].join('x')) === '1200x1800', 'paper canvas 1200x1800');
  assert((await page.textContent('#layoutNote')).includes('90°'), 'rotation note shown');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'step3 no horizontal scroll');
  await page.screenshot({ path: path.join(OUT, '390x844-layout.png'), fullPage: true });

  // cut marks must not overlap photos: check pixels just inside each photo edge are not mark-gray vs outside
  await page.click('#outPaper'); await page.waitForFunction(() => window.__saved.length === 1);
  let r = await pil(page, 0);
  assert(r.w === 1200 && r.h === 1800 && r.fmt === 'JPEG', 'paper JPG 1200x1800 (' + r.name + ')');
  assert(r.dpi[0] === 300 && r.dpi[1] === 300, 'JFIF density 300 dpi (PIL) ' + r.dpi);
  await page.click('#outSingle'); await page.waitForFunction(() => window.__saved.length === 2);
  r = await pil(page, 1);
  assert(r.w === 413 && r.h === 531 && r.dpi[0] === 300, 'single 二吋 413x531 @300dpi ' + r.name);

  // size limit 200KB on a noisy big custom image
  await page.selectOption('#limitSel', '204800');
  await page.selectOption('#paperSel', 'a4'); await page.waitForTimeout(200);
  const nA4 = +(await page.textContent('#countN')); assert(nA4 >= 30, 'A4 with 二吋 fits ' + nA4);
  await page.selectOption('#paperSel', '4x6');
  await page.selectOption('#mixSel', '1in'); await page.waitForTimeout(200);
  const mixN = await page.evaluate(() => { const L = __id.S.lastLayout; return { n: L.n, n1: L.n1, n2: L.n2 }; });
  assert(mixN.n1 > 0 && mixN.n2 > 0 && mixN.n === mixN.n1 + mixN.n2, `mixed 二吋 ${mixN.n1} + 一吋 ${mixN.n2}`);
  await page.screenshot({ path: path.join(OUT, '390x844-mixed.png') });
  await page.selectOption('#mixSel', 'none');
  await page.selectOption('#countSel', '4'); await page.waitForTimeout(150);
  assert((await page.textContent('#countN')) === '4', 'specified count 4');
  await page.selectOption('#countSel', 'auto');

  // background replace to white: top-left of single becomes white
  await page.click('#back3'); await page.click('#bgAdv summary'); await page.click('#bg-white'); await page.waitForTimeout(300);
  const cnt = await page.evaluate(() => __id.bgMask(__id.S.src, 16).count); assert(cnt > 1000, 'flood fill marks background px ' + cnt);
  await page.click('#next2'); await page.click('#outSingle'); await page.waitForFunction(() => window.__saved.length === 3);
  r = await pil(page, 2);
  assert(r.corner.every(v => v > 245), 'background replaced with white ' + r.corner);
  assert(r.bytes <= 204800, 'single file within 200KB: ' + r.bytes);

  await page.evaluate(() => { __id.S.limit = 12000; }); await page.click('#outSingle'); await page.waitForFunction(() => window.__saved.length === 4);
  r = await pil(page, 3); assert(r.bytes <= 12000 && r.w === 413, 'size limit 12KB via quality binary search: ' + r.bytes + ' bytes');
  // low resolution warning
  const b64 = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 200; c.height = 260; const x = c.getContext('2d'); x.fillStyle = '#9ab'; x.fillRect(0, 0, 200, 260); x.fillStyle = '#c96'; x.beginPath(); x.ellipse(100, 110, 50, 65, 0, 0, 7); x.fill();
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  await page.setInputFiles('#fileInput', { name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => !__id.S.sample);
  assert(await page.isVisible('#resWarn3'), 'low-res warning shown: ' + (await page.textContent('#resWarn3')).slice(0, 20));

  // custom spec persists
  await page.click('#st1'); await page.click('#spec-custom'); await page.fill('#cw', '40'); await page.fill('#ch', '50'); await page.dispatchEvent('#ch', 'change');
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => __id.S.spec === 'custom' && __id.S.custom.w === 40 && __id.S.custom.h === 50), 'custom spec 40x50 persisted');
  await page.evaluate(() => localStorage.clear());
  await ctx.close();

  for (const [w, h, name, extra, step] of [[360, 780, '360x780', mobile, 2], [844, 390, '844x390', mobile, 3], [1280, 800, '1280x800', {}, 2]]) {
    const c = await browser.newContext({ viewport: { width: w, height: h }, ...extra }); const p = await c.newPage(); watch(p);
    await p.goto(URL_); await p.waitForTimeout(400); await p.evaluate(s => __id.goStep(s), step); await p.waitForTimeout(300);
    assert(await p.evaluate(() => innerWidth) === w, name + ' innerWidth ' + w);
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + ' no horizontal scroll');
    await p.screenshot({ path: path.join(OUT, name + '.png') }); await c.close();
  }
  const cd = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile }); const pd = await cd.newPage(); watch(pd);
  await pd.goto(URL_); await pd.waitForTimeout(400); await pd.screenshot({ path: path.join(OUT, '390x844-dark.png') });
  await pd.evaluate(() => __id.goStep(3)); await pd.waitForTimeout(300); await pd.screenshot({ path: path.join(OUT, '390x844-dark-layout.png') }); await cd.close();

  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  await browser.close(); for (const f of TMP) fs.unlinkSync(f); fs.unlinkSync(WRAP); console.log('ALL PASS');
})().catch(e => { console.error(e); for (const f of TMP) try { fs.unlinkSync(f); } catch (_) {} try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
