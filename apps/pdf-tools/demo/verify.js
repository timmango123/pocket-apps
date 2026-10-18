// PDF 工具箱驗證腳本：node verify.js
// 在 390×844 與大廳三種 iframe 尺寸（375×500、390×610、430×740）淺色／深色各開一次，確認沒有錯誤、主要流程可用，
// 並輸出 cover-390x520.png 作為大廳封面。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok  ' + m); };

// tiny 2×2 PNG (RGB) and a JPEG made by Chromium canvas inside the page
const PNG_RGB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBFBAyMPwHAABjKQX9AGh6AAAAAElFTkSuQmCC', 'base64');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const sizes = [
    { name: '390x844', w: 390, h: 844, mobile: true },
    { name: '375x500', w: 375, h: 500, mobile: true },
    { name: '390x610', w: 390, h: 610, mobile: true },
    { name: '430x740', w: 430, h: 740, mobile: true },
    { name: '844x390', w: 844, h: 390, mobile: true },
    { name: '1280x800', w: 1280, h: 800, mobile: false },
  ];
  for (const scheme of ['light', 'dark']) {
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, colorScheme: scheme });
      const p = await ctx.newPage();
      p.on('console', m => { if (m.type() === 'error') errors.push(s.name + ': ' + m.text()); });
      p.on('pageerror', e => errors.push(s.name + ': ' + e.message));
      await p.goto(URL);
      await p.waitForTimeout(250);
      const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(sw[0] <= sw[1], `${scheme} ${s.name} 無水平捲動 (${sw[0]} <= ${sw[1]})`);
      const n = await p.$$eval('.card', c => c.length);
      assert(n === 5, `${scheme} ${s.name} 範例 5 頁卡片`);
      if (scheme === 'light' || s.name === '390x844' || s.name === '375x500') await p.screenshot({ path: `${OUT}/${s.name}${scheme === 'dark' ? '-dark' : ''}.png`, fullPage: false });
      await ctx.close();
    }
  }

  // cover 390×520
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('cover: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(250);
    await p.evaluate(() => { const c = document.querySelectorAll('.card'); c[1].classList.add('sel'); c[3].classList.add('sel'); });
    await p.screenshot({ path: `${OUT}/cover-390x520.png` });
    await ctx.close();
  }

  // flows at 390×844
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push('flow: ' + m.text()); });
  p.on('pageerror', e => errors.push('flow: ' + e.message));
  await p.goto(URL); await p.waitForTimeout(250);
  const T = () => p.evaluate(() => window.__pdfTools.items.map(i => (i.kind === 'pdf' ? i.docId + ':' + i.pageNo : 'img') + (i.rot ? '@' + i.rot : '')).join(' '));
  const order0 = await T(); console.log('    ', order0);
  assert(/^(\d+):1 \1:2 \1:3 (\d+):1 \2:2$/.test(order0), '範例順序：3 頁 + 2 頁');
  // select by tap, rotate, move
  await p.click('.card:nth-child(2) .sheetwrap');
  assert((await p.$$eval('.card.sel', c => c.length)) === 1 && !(await p.isHidden('#selBar')), '點卡片選取並出現選取列');
  await p.click('#selRotate');
  assert(/:2@90/.test(await T()), '旋轉所選 +90°');
  await p.click('#selClear');
  await p.click('.card:nth-child(1) [data-act="down"]');
  const o1 = await T(); assert(/^(\d+):2@90 \1:1/.test(o1), '往後移 ' + o1);
  await p.click('.card:nth-child(5) [data-act="up"]');
  assert((await p.$$eval('.card', c => c.map(x => x.querySelector('.pno').textContent).join(''))) === '21321', '往前移後順序 21321');
  // drag card 1 to the end (pointer events on the handle)
  const h = await p.$('.card:nth-child(1) .handle'); const hb = await h.boundingBox();
  const last = await p.$('.card:nth-child(5)'); const lb = await last.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(hb.x + (lb.x + lb.width / 2 - hb.x) * i / 8, hb.y + (lb.y + lb.height / 2 - hb.y) * i / 8);
  await p.waitForTimeout(50);
  await p.screenshot({ path: `${OUT}/flow-drag.png` });
  await p.mouse.up(); await p.waitForTimeout(100);
  const afterDrag = await p.$$eval('.card', c => c.map(x => x.querySelector('.pno').textContent).join(''));
  assert(afterDrag === '13212', '拖曳第 1 張到最後 ' + afterDrag);
  assert((await p.$$('.ghost')).length === 0, '拖曳結束後沒有殘留的幽靈卡片');
  // add an image and a PDF (sample removed automatically)
  await p.setInputFiles('#fileInput', [{ name: 'photo.png', mimeType: 'image/png', buffer: PNG_RGB }]);
  await p.waitForTimeout(300);
  assert((await p.$$eval('.card', c => c.length)) === 1 && await p.isHidden('#sampleBar'), '加入自己的圖片後範例移除，剩 1 張');
  const jpegB64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#c84'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#fff'; x.fillRect(40, 40, 220, 120); return c.toDataURL('image/jpeg', .8).split(',')[1]; });
  await p.setInputFiles('#fileInput', [{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegB64, 'base64') }]);
  await p.waitForTimeout(300);
  // RGBA PNG goes through the canvas path (decode → RGB + SMask)
  const rgbaB64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 96; const x = c.getContext('2d'); x.fillStyle = 'rgba(30,120,200,.5)'; x.fillRect(0, 0, 64, 96); x.fillStyle = '#fff'; x.fillRect(16, 16, 32, 32); return c.toDataURL('image/png').split(',')[1]; });
  await p.setInputFiles('#fileInput', [{ name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from(rgbaB64, 'base64') }]);
  await p.waitForTimeout(400);
  const alphaOk = await p.evaluate(() => { const it = window.__pdfTools.items[2]; return it && it.kind === 'image' && !!it.img.smask && it.img.width === 64; });
  assert(alphaOk, '透明 PNG 經 canvas 解碼並附 SMask');
  await p.evaluate(() => { window.__pdfTools.items.splice(2, 1); window.__pdfTools.render(); });
  await p.evaluate(() => window.__pdfTools.loadSamples()); await p.evaluate(() => window.__pdfTools.render());
  assert((await p.$$eval('.card', c => c.length)) === 7, '圖片 2 + 範例 5 = 7 頁');
  // page size setting changes the card label of image pages
  await p.click('#setCard summary');
  await p.click('#sizeSeg [data-v="letter"]');
  const lbl = await p.$eval('.card:nth-child(2) .size', e => e.textContent);
  assert(/Letter 橫式/.test(lbl), '圖片頁依設定顯示 Letter 橫式：' + lbl);
  await p.click('#sizeSeg [data-v="a4"]');
  await p.screenshot({ path: `${OUT}/flow-mixed.png`, fullPage: true });
  // keep only selected: select 3 cards
  await p.click('.card:nth-child(1) .sheetwrap'); await p.click('.card:nth-child(2) .sheetwrap'); await p.click('.card:nth-child(4) .sheetwrap');
  await p.click('#selKeep');
  assert((await p.$$eval('.card', c => c.length)) === 3, '只留所選 → 3 頁');
  await p.click('#toast button');
  assert((await p.$$eval('.card', c => c.length)) === 7, '復原回到 7 頁');
  await p.click('.card:nth-child(3) .sheetwrap'); await p.click('#selDelete');
  assert((await p.$$eval('.card', c => c.length)) === 6, '刪除所選 → 6 頁');
  // export + verify by re-parsing
  const res = await p.evaluate(async () => { const r = await window.__pdfTools.exportPdf(); const c = window.__pdfTools.PDF.check(r.bytes); return { name: r.name, size: r.bytes.length, pages: c.pages.length, rot: c.pages.map(x => x.rotate), issues: c.issues }; });
  console.log('    ', res);
  assert(res.pages === 6 && res.issues.length === 0, '匯出 6 頁且重新解析無問題');
  await p.click('#exportBtn');
  await p.waitForSelector('#exportSheet:not([hidden])');
  await p.screenshot({ path: `${OUT}/flow-export.png` });
  const [dlEv] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#exDownload')]);
  const dlToast = await p.$eval('#toast', e => e.textContent).catch(() => '');
  assert(dlEv || /已開始下載|已送出儲存/.test(dlToast), '下載觸發：' + (dlEv ? dlEv.suggestedFilename() : dlToast));
  await p.click('#exClose');
  // encrypted-looking PDF: polite message
  await p.setInputFiles('#fileInput', [{ name: 'secret.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O<00>/U<00>/P -1>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R>>\n%%EOF') }]);
  await p.waitForTimeout(300);
  const tt = await p.$eval('#toast', e => e.textContent).catch(() => '');
  assert(/加密/.test(tt), '加密 PDF 顯示提示：' + tt);
  // theme toggle persists
  await p.click('#themeBtn');
  assert((await p.evaluate(() => localStorage.getItem('pdf-tools:v1:theme'))) === '"light"', '主題儲存');
  await p.click('#clearBtn');
  assert(await p.isVisible('#empty'), '清空後顯示空狀態');
  await p.reload(); await p.waitForTimeout(250);
  assert((await p.$$eval('.card', c => c.length)) === 0 && await p.isVisible('#empty'), '看過範例後重新開啟不再塞入範例');
  await p.evaluate(() => localStorage.clear());
  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  try { fs.unlinkSync(WRAP); } catch (e) { }
  console.log('verify 完成');
})().catch(e => { console.error(e); process.exit(1); });
