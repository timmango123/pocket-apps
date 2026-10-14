// Verify image-crop: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(500);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleNote'), 'sample note visible');
  assert((await page.textContent('#sizeTag')).trim() === '2400 × 1600', 'sample full-image crop 2400 x 1600');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // export helper: returns {name,w,h,corners}
  const doExport = async () => {
    const n0 = await page.evaluate(() => window.__saved.length);
    await page.click('#doneBtn'); await page.click('#exGo');
    await page.waitForFunction(n => window.__saved.length > n, n0);
    const r = await page.evaluate(async () => { const s = window.__saved[window.__saved.length - 1]; const b = await createImageBitmap(s.data);
      const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0);
      const px = (a, y) => Array.from(x.getImageData(a, y, 1, 1).data.slice(0, 3));
      return { name: s.filename, w: b.width, h: b.height, corners: [px(0, 0), px(b.width - 1, 0), px(0, b.height - 1), px(b.width - 1, b.height - 1)], left: px(2, b.height >> 1), right: px(b.width - 3, b.height >> 1), top: px(b.width >> 1, 2) }; });
    await page.click('#exClose'); return r;
  };

  // feed 4000x3000 canvas file: left half red, right half blue, top strip green; no white anywhere
  const b64 = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d');
    x.fillStyle = '#e00000'; x.fillRect(0, 0, 2000, 3000); x.fillStyle = '#0000e0'; x.fillRect(2000, 0, 2000, 3000); x.fillStyle = '#00b000'; x.fillRect(0, 0, 4000, 300);
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  await page.setInputFiles('#fileInput', { name: 'test-4000.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => __ic.S.iw === 4000 && !__ic.S.sample);
  assert(!(await page.isVisible('#sampleNote')), 'sample note hidden after loading file');
  let r = await doExport();
  assert(r.w === 4000 && r.h === 3000 && r.name === 'test-4000-crop.jpg', 'free crop exports full 4000x3000 ' + r.name);

  // 1:1 -> 3000x3000
  await page.click('#ratio-1x1'); await page.waitForTimeout(400);
  r = await doExport();
  assert(r.w === 3000 && r.h === 3000, '4000x3000 at 1:1 -> ' + r.w + 'x' + r.h);

  // 4:5 then rotate right -> 5:4 label, output landscape 5:4
  await page.click('#ratio-4x5'); await page.waitForTimeout(400);
  r = await doExport();
  assert(Math.abs(r.w / r.h - 0.8) < 0.002 && r.h === 3000, '4:5 -> ' + r.w + 'x' + r.h);
  await page.click('#rotR'); await page.waitForTimeout(100);
  assert((await page.textContent('#ratio-4x5')).trim() === '5:4', 'rotate 90 swaps ratio label to 5:4');
  r = await doExport();
  assert(Math.abs(r.w / r.h - 1.25) < 0.002, 'after rotate output ' + r.w + 'x' + r.h + ' is 5:4');
  // after rotate right, the green top strip of the source should be on the right side
  assert(r.right[1] > 120 && r.right[0] < 60, 'rotated: green strip appears on right edge ' + r.right);

  // reset + flip horizontal: left side becomes blue
  await page.click('#resetBtn'); await page.waitForTimeout(100);
  await page.click('#flipH'); r = await doExport();
  assert(r.w === 4000 && r.left[2] > 180 && r.left[0] < 60 && r.right[0] > 180, 'flip H: left edge blue, right edge red');
  await page.click('#flipV'); r = await doExport();
  assert(r.top[1] < 60, 'flip V: green strip leaves top edge ' + r.top);
  await page.click('#resetBtn');

  // +17 deg via dial keyboard, then drag image hard in every direction: box always covered, no white corners
  await page.click('#ratio-1x1'); await page.waitForTimeout(400);
  await page.focus('#dial'); for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  assert((await page.textContent('#angleBtn')).trim() === '+17.0°', 'dial at +17.0°');
  const ed = await page.locator('#editor').boundingBox(); const cx = ed.x + ed.width / 2, cy = ed.y + ed.height / 2;
  for (const [dx, dy] of [[300, 0], [-600, 0], [0, 400], [0, -800], [500, 500]]) {
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + dx, cy + dy, { steps: 5 }); await page.mouse.up();
    assert(await page.evaluate(() => __ic.contains()), `after drag (${dx},${dy}) crop box fully inside image`);
  }
  r = await doExport();
  const white = p => p.every(v => v > 235);
  assert(r.corners.every(p => !white(p)), '+17° output corners not white ' + JSON.stringify(r.corners));
  const sm = await page.evaluate(() => ({ s: __ic.S.s, m: __ic.sMin(__ic.S.box) }));
  assert(sm.s >= sm.m * 0.9999, 'scale >= s_min for rotated box');
  // tap angle -> zero
  await page.click('#angleBtn'); await page.waitForTimeout(100); assert((await page.textContent('#angleBtn')).trim() === '0.0°', 'tap angle resets to 0');

  // handle drag with 1:1 lock: stays square; then auto re-fit after release
  const bx = await page.locator('#box').boundingBox();
  await page.mouse.move(bx.x + bx.width, bx.y + bx.height); await page.mouse.down();
  await page.mouse.move(bx.x + bx.width - 120, bx.y + bx.height - 40, { steps: 6 });
  const mid = await page.evaluate(() => ({ w: __ic.S.box.w, h: __ic.S.box.h }));
  await page.mouse.up();
  assert(Math.abs(mid.w - mid.h) < 0.5 && mid.w < bx.width - 30, 'locked corner drag keeps square ' + mid.w.toFixed(1) + 'x' + mid.h.toFixed(1));
  await page.waitForTimeout(800);
  const fit = await page.evaluate(() => ({ w: __ic.S.box.w, h: __ic.S.box.h, ok: __ic.contains() }));
  assert(fit.w > mid.w + 20 && Math.abs(fit.w - fit.h) < 0.5 && fit.ok, 'box zooms back to fill editor after release ' + fit.w.toFixed(1));
  // free handle drag
  await page.click('#ratio-free');
  const b2 = await page.locator('#box').boundingBox();
  await page.mouse.move(b2.x + b2.width / 2, b2.y + 1); await page.mouse.down(); await page.mouse.move(b2.x + b2.width / 2, b2.y + 90, { steps: 4 }); await page.mouse.up();
  const fr = await page.evaluate(() => __ic.S.box);
  assert(fr.h < b2.height - 60, 'free top-edge drag shrinks height');

  // custom ratio validation
  await page.click('#ratio-custom');
  for (const [w, h] of [['0', '1'], ['-2', '3'], ['abc', '2'], ['200', '1']]) {
    await page.fill('#cw', w); await page.fill('#ch', h); await page.click('#cApply');
    assert((await page.textContent('#cErr')).length > 0, `custom ${w}:${h} rejected: ${await page.textContent('#cErr')}`);
  }
  await page.fill('#cw', '3'); await page.fill('#ch', '2'); await page.click('#cApply'); await page.waitForTimeout(400);
  const o = await page.evaluate(() => __ic.outSize());
  assert((await page.textContent('#cErr')) === '' && Math.abs(o.w / o.h - 1.5) < 0.003, 'custom 3:2 accepted -> ' + o.w + 'x' + o.h);
  // specified width
  await page.click('#doneBtn'); await page.click('#size-width'); await page.fill('#outWidth', '1200'); await page.click('#fmt-png');
  assert((await page.textContent('#outInfo')).startsWith('1200 × 800'), 'width 1200 -> 1200 x 800');
  await page.click('#exClose');
  r = await doExport();
  assert(r.w === 1200 && r.h === 800 && r.name.endsWith('.png'), 'exported 1200x800 png');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll 390');
  await page.screenshot({ path: path.join(OUT, '390x844-edited.png') });
  // settings persisted
  await page.reload(); await page.waitForTimeout(400);
  assert(await page.evaluate(() => __ic.set.ratioId === 'custom' && __ic.set.fmt === 'png' && __ic.set.sizeMode === 'width'), 'settings persisted after reload');
  await page.evaluate(() => localStorage.clear());
  await ctx.close();

  const shots = [
    ['360x780', { width: 360, height: 780 }, 'light', true],
    ['844x390', { width: 844, height: 390 }, 'light', true],
    ['390x844-dark', { width: 390, height: 844 }, 'dark', true],
    ['1280x800', { width: 1280, height: 800 }, 'light', false],
  ];
  for (const [name, vp, scheme, mobile] of shots) {
    const c = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await c.newPage(); watch(p); await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(w => innerWidth === w && document.documentElement.scrollWidth <= innerWidth, vp.width), name + ' width ok, no h-scroll');
    if (name === '390x844-dark') {
      await p.focus('#dial'); for (let i = 0; i < 4; i++) await p.keyboard.press('ArrowLeft');
      await p.click('#doneBtn'); await p.click('#exGo'); await p.waitForSelector('#outImg:not([hidden])');
      assert(await p.isVisible('#outHint'), 'no downloads -> image shown for long-press save');
      await p.screenshot({ path: path.join(OUT, '390x844-dark-export.png') }); await p.click('#exClose');
    }
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  console.log('ALL PASSED');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
