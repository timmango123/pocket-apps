// PDF 工具箱驗證腳本：node verify.js
// 在 390×844、360×640、430×932、大廳三種 iframe 尺寸（375×500、390×610、430×740）、844×390 橫式與桌面，淺色／深色各開一次：
// 無錯誤、無水平捲動；再跑完整流程（預覽、選取、頁碼選取、旋轉、拖曳、刪除與復原、匯出、拆分 ZIP、壞檔、重新整理保留、大檔效能），
// 匯出的位元組都重新解析檢查（自家解析器，有 pypdf 時再交叉檢查），並輸出 cover-390x520.png 作為大廳封面。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-verify-'));
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok  ' + m); };
const hasPypdf = spawnSync('python3', ['-I', '-c', 'import pypdf']).status === 0;
function pypdf(bytes) {
  if (!hasPypdf) return null; const f = path.join(TMP, 'o' + Date.now() + '.pdf'); fs.writeFileSync(f, bytes);
  const r = spawnSync('python3', ['-I', '-c', 'import pypdf,json,sys\nr=pypdf.PdfReader(sys.argv[1],strict=True)\nprint(json.dumps({"n":len(r.pages),"rot":[p.get("/Rotate") or 0 for p in r.pages],"t":[(p.extract_text() or "")[:80] for p in r.pages]}))', f], { encoding: 'utf8' });
  if (r.status) throw new Error('pypdf: ' + r.stderr.slice(-300)); return JSON.parse(r.stdout);
}
const PNG_RGB = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DwHwyBFBAyMPwHAABjKQX9AGh6AAAAAElFTkSuQmCC', 'base64');
const ENCRYPTED = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n3 0 obj<</Filter/Standard/V 1/R 2/O<00>/U<00>/P -1>>endobj\ntrailer<</Root 1 0 R/Encrypt 3 0 R>>\n%%EOF');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };
  // a 60-page PDF from Chromium (real-world structure: CID fonts, object streams off, many pages)
  const gen = await browser.newPage();
  await gen.setContent('<style>section{page-break-after:always;font:16px sans-serif}h1{color:#b3301c}</style>' + Array.from({ length: 60 }, (_, i) => `<section><h1>第 ${i + 1} 章 Chapter ${i + 1}</h1>${'<p>這是測試內容 lorem ipsum dolor sit amet.</p>'.repeat(18)}</section>`).join(''));
  const BIG = await gen.pdf({ format: 'A4' }); await gen.close();

  const sizes = [
    { name: '390x844', w: 390, h: 844, mobile: true }, { name: '360x640', w: 360, h: 640, mobile: true }, { name: '430x932', w: 430, h: 932, mobile: true },
    { name: '375x500', w: 375, h: 500, mobile: true }, { name: '390x610', w: 390, h: 610, mobile: true }, { name: '430x740', w: 430, h: 740, mobile: true },
    { name: '844x390', w: 844, h: 390, mobile: true }, { name: '1280x800', w: 1280, h: 800, mobile: false },
  ];
  for (const scheme of ['light', 'dark']) {
    for (const s of sizes) {
      const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, colorScheme: scheme });
      const p = await ctx.newPage(); watch(p, scheme + ' ' + s.name);
      await p.goto(URL); await p.evaluate(() => window.__pdfTools.ready);
      await p.waitForTimeout(550);
      assert(await p.isVisible('#hero') && await p.isHidden('#bar'), `${scheme} ${s.name} 第一次開啟顯示加入檔案的引導畫面`);
      let sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(sw[0] <= sw[1], `${scheme} ${s.name} 空白狀態無水平捲動 (${sw[0]} <= ${sw[1]})`);
      if (scheme === 'light' || s.name === '390x844') await p.screenshot({ path: `${OUT}/empty-${s.name}${scheme === 'dark' ? '-dark' : ''}.png` });
      await p.click('#trySample'); await p.evaluate(() => window.__pdfTools.thumbsIdle()); await p.waitForTimeout(150);
      assert(await p.$$eval('.card', c => c.length) === 5, `${scheme} ${s.name} 範例 5 頁卡片`);
      sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(sw[0] <= sw[1], `${scheme} ${s.name} 有頁面時無水平捲動`);
      const small = await p.$$eval('button, label[role=button], .card', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && (r.width < 43.5 || r.height < 43.5) && getComputedStyle(e).visibility !== 'hidden'; }).map(e => e.id || e.className));
      assert(!small.length, `${scheme} ${s.name} 所有按鈕至少 44×44 ${small.join(',')}`);
      await p.screenshot({ path: `${OUT}/${s.name}${scheme === 'dark' ? '-dark' : ''}.png` });
      await ctx.close();
    }
  }

  // cover 390×520
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, 'cover');
    await p.goto(URL); await p.evaluate(() => window.__pdfTools.ready);
    await p.click('#trySample'); await p.evaluate(() => window.__pdfTools.thumbsIdle());
    await p.addStyleTag({ content: '#notes{display:none}' });
    await p.click('.card:nth-child(2) .check'); await p.click('.card:nth-child(4) .check'); await p.click('.card:nth-child(4) .rot');
    await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(500);
    await p.screenshot({ path: `${OUT}/cover-390x520.png` });
    await ctx.close();
  }

  // flows at 390×844
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.evaluate(() => window.__pdfTools.ready);
  const T = () => p.evaluate(() => window.__pdfTools.items.map(i => (i.kind === 'pdf' ? i.docId + ':' + i.pageNo : 'img') + (i.rot ? '@' + i.rot : '')).join(' '));
  const nos = () => p.$$eval('.card .lab b', b => b.map(x => x.textContent.replace('p.', '')).join(''));
  const exp = (sel, mode) => p.evaluate(async ([s, m]) => { const r = await window.__pdfTools.exportPdf(s, m); const c = r.kind === 'pdf' ? window.__pdfTools.PDF.check(r.bytes) : null; return { name: r.name, kind: r.kind, b64: btoa(Array.from(r.bytes, x => String.fromCharCode(x)).join('')), pages: c && c.pages.length, rot: c && c.pages.map(x => x.rotate), issues: c && c.issues }; }, [sel, mode]);
  await p.click('#trySample'); await p.evaluate(() => window.__pdfTools.thumbsIdle());
  const order0 = await T(); console.log('    ', order0);
  assert(/^(\d+):1 \1:2 \1:3 (\d+):1 \2:2$/.test(order0), '範例順序：3 頁 + 2 頁');
  // the renderer drew the sample's blue title bar into the first thumbnail
  const px = await p.evaluate(async () => { const im = document.querySelector('.card .pg img'); await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d'); x.drawImage(im, 0, 0); const top = x.getImageData(c.width / 2, 8, 1, 1).data, mid = x.getImageData(4, c.height / 2, 1, 1).data; return { top: [...top].slice(0, 3), mid: [...mid].slice(0, 3) }; });
  assert(Math.abs(px.top[0] - 31) < 25 && Math.abs(px.top[1] - 84) < 25 && Math.abs(px.top[2] - 140) < 25 && px.mid.every(v => v > 235), '縮圖真的畫出頁面內容（藍色標題列、白底）' + JSON.stringify(px));
  // tap a page → preview; next / prev / select / close
  await p.click('.card:nth-child(2) .thumb');
  await p.waitForSelector('#pv:not([hidden]) canvas', { timeout: 5000 });
  assert(/第 2／5 頁/.test(await p.textContent('#pvTitle')) && /A4 直式/.test(await p.textContent('#pvSub')), '點頁面開啟預覽：' + await p.textContent('#pvSub'));
  await p.screenshot({ path: `${OUT}/flow-preview.png` });
  await p.click('#pvNext'); assert(/第 3／5 頁/.test(await p.textContent('#pvTitle')), '預覽下一頁');
  await p.click('#pvSel'); await p.click('#pvClose');
  assert(await p.isHidden('#pv') && await p.$$eval('.card.sel', c => c.length) === 1 && await p.isVisible('#selBar'), '預覽中選取 → 關閉後出現選取列');
  // once something is selected, tapping a page adds it to the selection
  await p.click('.card:nth-child(1) .thumb');
  assert(await p.$$eval('.card.sel', c => c.length) === 2 && await p.isHidden('#pv'), '選取模式下點頁面＝加選');
  await p.click('#selClear');
  // rapid taps on the select circle: 16 taps at 8/s → even count, no lost or doubled taps
  for (let i = 0; i < 16; i++) { await p.tap('.card:nth-child(3) .check'); await p.waitForTimeout(125); }
  assert(await p.$$eval('.card.sel', c => c.length) === 0, '連點 16 次（每秒 8 次）選取圈：沒有遺漏或重複');
  for (let i = 0; i < 9; i++) { await p.tap('.card:nth-child(3) .rot'); await p.waitForTimeout(125); }
  assert(/:3@90/.test(await T()), '連點旋轉 9 次 → 90°（' + await T() + '）');
  await p.click('.card:nth-child(3) .rot'); await p.click('.card:nth-child(3) .rot'); await p.click('.card:nth-child(3) .rot');
  // page-number input (forgiving)
  await p.fill('#range', '２、4'); await p.press('#range', 'Enter');
  assert(await p.$$eval('.card.sel', c => c.length) === 2 && /已選 2 頁/.test(await p.textContent('#rmsg')), '頁碼「２、4」選到 2 頁：' + await p.textContent('#rmsg'));
  await p.fill('#range', '2, 9'); await p.press('#range', 'Enter');
  assert(/沒有第 9 頁/.test(await p.textContent('#rmsg')), '頁碼超出範圍有說明：' + await p.textContent('#rmsg'));
  await p.click('#rangeClr');
  await p.click('.card:nth-child(2) .check');
  await p.click('#selRotate');
  assert(/:2@90/.test(await T()), '旋轉所選 +90°');
  // export only the selection
  const sel1 = await exp(true);
  assert(sel1.pages === 1 && sel1.rot[0] === 90 && !sel1.issues.length && /-第2頁\.pdf$/.test(sel1.name), '匯出所選：1 頁、90°、檔名 ' + sel1.name);
  await p.click('#selClear');
  // drag card 1 to the end (pointer events on the handle)
  const h = await (await p.$('.card:nth-child(1) .handle')).boundingBox(), lb = await (await p.$('.card:nth-child(5)')).boundingBox();
  await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await p.mouse.down();
  for (let i = 1; i <= 10; i++) await p.mouse.move(h.x + (lb.x + lb.width * .7 - h.x) * i / 10, h.y + (lb.y + lb.height / 2 - h.y) * i / 10);
  await p.waitForTimeout(80); await p.screenshot({ path: `${OUT}/flow-drag.png` });
  await p.mouse.up(); await p.waitForTimeout(250);
  assert(await nos() === '23121', '拖曳第 1 張到最後 ' + await nos());
  assert((await p.$$('.ghost')).length === 0, '拖曳結束後沒有殘留的幽靈卡片');
  // delete + undo
  await p.click('.card:nth-child(1) .check'); await p.click('.card:nth-child(2) .check'); await p.click('#selDelete');
  assert(await p.$$eval('.card', c => c.length) === 3, '刪除所選 → 3 頁');
  await p.click('#toast button');
  assert(await p.$$eval('.card', c => c.length) === 5 && await nos() === '23121', '復原回到 5 頁、順序不變');
  // full export, checked by our parser and pypdf
  const all = await exp(false);
  assert(all.pages === 5 && !all.issues.length, '匯出全部 5 頁、重新解析無問題');
  const py = pypdf(Buffer.from(all.b64, 'base64'));
  if (py) assert(py.n === 5 && /Packing List/.test(py.t[0]) && /Budget/.test(py.t[1]) && /Taipei Weekend/.test(py.t[4]) && py.rot.join() === '90,0,0,90,0', 'pypdf：頁序與旋轉正確 ' + py.rot.join());
  // export sheet: split to ZIP + rename + download
  await p.click('#exportBtn'); await p.waitForSelector('#exportSheet:not([hidden])');
  await p.screenshot({ path: `${OUT}/flow-export.png` });
  await p.click('#modeSeg [data-v="split"]'); await p.waitForTimeout(150);
  assert(/\.zip/.test(await p.textContent('#exExt')) && /5 個 PDF/.test(await p.textContent('#exInfoL')), '改成每頁一個檔（ZIP）');
  await p.fill('#exName', '我的/文件:*?');
  const [dlEv] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#exDownload')]);
  const dlName = await p.evaluate(() => document.querySelector('#toast') && document.querySelector('#toast').textContent);
  assert(dlEv && /我的文件\.zip$/.test(dlName), '下載 ZIP，檔名去掉不合法字元：' + dlName);
  if (dlEv && hasPypdf) { const f = path.join(TMP, 'd.zip'); await dlEv.saveAs(f); const r = spawnSync('python3', ['-I', '-c', 'import zipfile,sys,io,pypdf\nz=zipfile.ZipFile(sys.argv[1])\nprint(z.testzip(), [len(pypdf.PdfReader(io.BytesIO(z.read(n))).pages) for n in z.namelist()])', f], { encoding: 'utf8' }); assert(r.stdout.trim() === 'None [1, 1, 1, 1, 1]', 'ZIP 內 5 個 PDF 各 1 頁：' + r.stdout.trim()); }
  await p.click('#modeSeg [data-v="one"]'); await p.click('#exClose');
  // add own images: samples disappear, photo pages appear
  await p.setInputFiles('#fileInput', [{ name: 'photo.png', mimeType: 'image/png', buffer: PNG_RGB }]);
  await p.waitForFunction(() => window.__pdfTools.items.length === 1);
  assert(await p.$$eval('.note', n => n.length) === 0 || !(await p.textContent('#notes')).includes('範例'), '加入自己的檔案後範例移除');
  const jpegB64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#c84'; x.fillRect(0, 0, 300, 200); x.fillStyle = '#fff'; x.fillRect(40, 40, 220, 120); return c.toDataURL('image/jpeg', .8).split(',')[1]; });
  const rgbaB64 = await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 96; const x = c.getContext('2d'); x.fillStyle = 'rgba(30,120,200,.5)'; x.fillRect(0, 0, 64, 96); return c.toDataURL('image/png').split(',')[1]; });
  await p.setInputFiles('#fileInput', [{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpegB64, 'base64') }, { name: 'alpha.png', mimeType: 'image/png', buffer: Buffer.from(rgbaB64, 'base64') }]);
  await p.waitForFunction(() => window.__pdfTools.items.length === 3);
  assert(await p.evaluate(() => { const it = window.__pdfTools.items[2]; return it.kind === 'image' && !!it.img.smask && it.img.width === 64; }), '透明 PNG 經 canvas 解碼並附 SMask');
  assert(await p.isVisible('#setCard'), '有照片時才出現照片頁面設定');
  await p.click('#setCard summary'); await p.click('#sizeSeg [data-v="letter"]');
  const imgOut = await exp(false);
  assert(imgOut.pages === 3 && !imgOut.issues.length && /照片合併\.pdf$/.test(imgOut.name), '照片轉 PDF：3 頁、檔名 ' + imgOut.name);
  const imgDims = await p.evaluate(b64 => { const c = window.__pdfTools.PDF.check(Uint8Array.from(atob(b64), x => x.charCodeAt(0))); return c.pages.map(x => Math.round(x.width) + 'x' + Math.round(x.height)).join(' '); }, imgOut.b64);
  assert(imgDims === '612x792 792x612 612x792', 'Letter：直圖直式、橫圖橫式 ' + imgDims);
  await p.click('#sizeSeg [data-v="a4"]');
  // bad files: clear notices, nothing crashes
  await p.setInputFiles('#fileInput', [{ name: 'secret.pdf', mimeType: 'application/pdf', buffer: ENCRYPTED }, { name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) }, { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') }, { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]) }]);
  await p.waitForTimeout(400);
  const notes = await p.$$eval('.note.bad', n => n.map(x => x.textContent));
  assert(notes.length === 1 && /4 個檔案無法加入/.test(notes[0]) && /secret\.pdf：有密碼保護/.test(notes[0]) && /empty\.pdf：檔案是空的/.test(notes[0]) && /note\.txt：不支援的檔案類型/.test(notes[0]) && /broken\.jpg：無法讀取圖片/.test(notes[0]), '壞檔合併成一則提示、各有原因：' + notes.join('／'));
  await p.setInputFiles('#fileInput', [{ name: 'secret2.pdf', mimeType: 'application/pdf', buffer: ENCRYPTED }]); await p.waitForTimeout(300);
  const one = await p.$$eval('.note.bad', n => n.map(x => x.textContent));
  assert(one.length === 2 && /移除密碼/.test(one[1]), '單一壞檔有怎麼修正的說明：' + one[1]);
  await p.screenshot({ path: `${OUT}/flow-errors.png` });
  assert(await p.$$eval('.card', c => c.length) === 3, '壞檔不影響已加入的頁面');
  // persistence across reload (files live in IndexedDB)
  const before = await T();
  await p.evaluate(() => window.__pdfTools.persistNow()); await p.waitForTimeout(300);
  await p.reload(); await p.evaluate(() => window.__pdfTools.ready);
  assert(await T() === before && await p.$$eval('.card', c => c.length) === 3, '重新整理後工作區（檔案、順序、旋轉）都還在');
  const again = await exp(false); assert(again.pages === 3 && !again.issues.length, '重新整理後仍可匯出');
  // large file: 60 pages, UI stays responsive while thumbnails render
  await p.click('#clearBtn'); await p.waitForTimeout(100);
  await p.click('#toast button'); assert(await p.$$eval('.card', c => c.length) === 3, '清空可以復原'); await p.click('#clearBtn');
  const t0 = Date.now();
  await p.setInputFiles('#fileInput', [{ name: 'book.pdf', mimeType: 'application/pdf', buffer: BIG }]);
  await p.waitForFunction(() => window.__pdfTools.items.length === 60, null, { timeout: 15000 });
  const loadMs = Date.now() - t0;
  const perf = await p.evaluate(async () => { const longs = []; const po = new PerformanceObserver(l => l.getEntries().forEach(e => longs.push(e.duration))); po.observe({ entryTypes: ['longtask'] }); await window.__pdfTools.thumbsIdle(); scrollTo(0, 99999); await new Promise(r => setTimeout(r, 300)); await window.__pdfTools.thumbsIdle(); po.disconnect(); return { max: Math.round(Math.max(0, ...longs)), n: window.__pdfTools.thumbs.size }; });
  console.log('     60 頁讀取', loadMs, 'ms；縮圖', perf);
  assert(loadMs < 5000 && perf.max < 400, `60 頁 PDF：讀取 ${loadMs} ms，縮圖期間最長卡頓 ${perf.max} ms（< 400）`);
  const bigOut = await exp(false);
  assert(bigOut.pages === 60 && !bigOut.issues.length, '60 頁全部匯出、重新解析無問題');
  const pyb = pypdf(Buffer.from(bigOut.b64, 'base64')); if (pyb) assert(pyb.n === 60 && /Chapter 60/.test(pyb.t[59]), 'pypdf：第 60 頁內容正確');
  await p.screenshot({ path: `${OUT}/flow-large.png` });
  // theme toggle persists
  await p.click('#themeBtn');
  assert((await p.evaluate(() => localStorage.getItem('pdf-tools:v1:theme'))) === '"light"', '主題儲存');
  await p.click('#clearBtn'); await p.waitForTimeout(100);
  assert(await p.isVisible('#hero'), '清空後顯示引導畫面');
  await p.evaluate(() => { window.__pdfTools.persistNow(); localStorage.clear(); indexedDB.deleteDatabase('pdf-tools'); });
  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  try { fs.unlinkSync(WRAP); fs.rmSync(TMP, { recursive: true }); } catch (e) { }
  console.log('verify 完成');
})().catch(e => { console.error(e); process.exit(1); });
