// EXIF 檢視與清除驗證腳本：node verify.js
// 在 390×844 與三個大廳 iframe 尺寸（375×500、390×610、430×740）的淺色／深色模式開啟，確認沒有錯誤、主要流程可用，
// 並輸出 cover-390x520.png 當大廳封面。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, '_wrapped.html');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const { buildHeif } = require('./heif-fixture.js');
const EX = new Function(SRC.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return EX;')();
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const sizes = [{ w: 390, h: 844 }, { w: 375, h: 500 }, { w: 390, h: 610 }, { w: 430, h: 740 }];
  const open = async (w, h, scheme) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, acceptDownloads: true });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${w}x${h} ${scheme}: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} ${scheme} console: ${m.text()}`); });
    await p.goto(URL); await p.waitForSelector('.card .sum', { timeout: 10000 });
    return { ctx, p };
  };

  // every size, both schemes: sample loaded, no overflow, dock visible
  for (const s of sizes) for (const scheme of ['light', 'dark']) {
    const { ctx, p } = await open(s.w, s.h, scheme);
    const ow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(ow <= 0, `${s.w}x${s.h} ${scheme}: 無水平溢出`);
    assert(await p.isVisible('#stripAllBtn') && await p.isVisible('.card .risk.high'), `${s.w}x${s.h} ${scheme}: 範例卡片與底部按鈕可見`);
    await p.screenshot({ path: `${OUT}/shot-${s.w}x${s.h}-${scheme}.png` });
    await ctx.close();
  }

  // main flow at 390x844 light
  const { ctx, p } = await open(390, 844, 'light');
  const sampleFields = await p.$$eval('.card .sum .row dt', ds => ds.map(d => d.textContent));
  assert(sampleFields.includes('GPS 位置') && sampleFields.includes('機身序號') && sampleFields.includes('拍攝時間'), '範例顯示 GPS／序號／拍攝時間 ' + sampleFields.join(','));
  assert(await p.isVisible('#sampleBanner'), '範例橫幅顯示');
  const mapHref = await p.getAttribute('.maplinks a', 'href');
  assert(/^https:\/\/www\.google\.com\/maps\?q=25\.109680,121\.844870$/.test(mapHref), '地圖連結 ' + mapHref);
  await p.click('details.tags summary');
  const tagRows = await p.$$eval('table.tagt td.n', t => t.length);
  assert(tagRows > 40, `完整標籤表有 ${tagRows} 列`);
  await p.click('details.tags summary');
  // strip the sample
  await p.click('.card [data-act="strip"]');
  await p.waitForSelector('.card .result');
  const resTxt = await p.textContent('.card .result');
  assert(/已無損清除 \d+ 個標籤/.test(resTxt) && /沒有任何中繼資料/.test(resTxt) && /GPS 位置/.test(resTxt) && /XMP/.test(resTxt) && /影像資料逐位元相同/.test(resTxt), '清除結果：' + resTxt.replace(/\s+/g, ' '));
  assert(await p.isVisible('.card .risk.done') && await p.isVisible('#dlAllBtn') && !(await p.isVisible('#stripAllBtn')), '清除後：卡片標示已清除，底部改成下載');
  assert(!(await p.isVisible('.card .sum')) && await p.isVisible('details.before summary'), '清除前的資料收進摺疊區');
  // copy GPS before stripping is covered below; tap targets in the card and dock are at least 44 px
  const small = await p.$$eval('button, a, summary, .drop', els => els.filter(e => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => e.textContent.trim().slice(0, 20)));
  assert(small.length === 0, '所有可點元件 ≥ 44px ' + small.join('|'));
  const out = await p.evaluate(async () => { const it = window.__exif.items[0]; const u = new Uint8Array(await it.out.blob.arrayBuffer()); return { n: u.length, name: it.out.name, meta: window.__exif.EX.parse(u).meta.map(m => m.kind) }; });
  assert(out.name === 'IMG_7731-clean.jpg' && out.meta.join(',') === 'icc', '輸出檔名與殘留區塊（只剩 ICC）' + JSON.stringify(out));
  // download
  const [dlEv] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('.card [data-act="dl"]')]);
  if (dlEv) { assert(dlEv.suggestedFilename() === 'IMG_7731-clean.jpg', '下載檔名 ' + dlEv.suggestedFilename()); const dp = await dlEv.path(); const b = fs.readFileSync(dp); assert(EX.parse(new Uint8Array(b)).tiff === null, '下載檔案不含 EXIF'); }
  else console.log('    （此環境未觸發下載事件，略過）');
  await p.screenshot({ path: `${OUT}/flow-stripped.png`, fullPage: true });

  // undo: remove the card, then 復原 brings it back with its result
  await p.click('.card [data-act="rm"]');
  assert(await p.isVisible('#empty') && /已移除/.test(await p.textContent('#toast')), '移除後顯示空狀態與復原提示');
  await p.click('#toastAct');
  assert((await p.$$('.card .result')).length === 1, '按「復原」後卡片與清除結果都回來');
  // add own files: rotated JPEG (orientation 6) + PNG with text + HEIC with GPS → sample auto removed
  const fx = await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 80; c.height = 40; const g = c.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 80, 40); g.fillStyle = '#fff'; g.fillRect(0, 0, 20, 20);
    const o = {}; for (const t of ['image/jpeg', 'image/png']) { const bl = await new Promise(r => c.toBlob(r, t)); o[t] = Array.from(new Uint8Array(await bl.arrayBuffer())); } return o;
  });
  const tiff6 = EX.buildTiff({ ifd0: { 0x0110: { t: 2, v: 'Pixel 9' }, 0x0112: { t: 3, v: 6 }, 0x0131: { t: 2, v: 'HDR+' } }, gps: { 1: { t: 2, v: 'N' }, 2: { t: 5, v: EX.gpsDms(24.15) }, 3: { t: 2, v: 'E' }, 4: { t: 5, v: EX.gpsDms(120.67) } } }, true);
  const jpgRot = EX.jpegInsertExif(Uint8Array.from(fx['image/jpeg']), tiff6);
  const pngTxt = EX.pngInsert(Uint8Array.from(fx['image/png']), [EX.pngChunk('tEXt', EX.concat([EX.encStr('Author'), new Uint8Array([0]), EX.encStr('someone')]))]);
  const heic = buildHeif({ items: [{ id: 1, type: 'hvc1', data: new Uint8Array(200).fill(7) }, { id: 2, type: 'Exif', data: EX.concat([Uint8Array.from([0, 0, 0, 6]), EX.encStr('Exif\0\0'), EX.buildTiff({ ifd0: { 0x010F: { t: 2, v: 'Apple' }, 0x0110: { t: 2, v: 'iPhone 15 Pro' }, 0x0112: { t: 3, v: 6 } }, gps: { 1: { t: 2, v: 'N' }, 2: { t: 5, v: EX.gpsDms(25.0339) }, 3: { t: 2, v: 'E' }, 4: { t: 5, v: EX.gpsDms(121.5645) } } }, false)]), cdsc: 1 }] });
  await p.setInputFiles('#fileInput', [
    { name: 'rotated.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpgRot) },
    { name: 'shot.png', mimeType: 'image/png', buffer: Buffer.from(pngTxt) },
    { name: 'phone.heic', mimeType: 'image/heic', buffer: Buffer.from(heic) }
  ]);
  await p.waitForFunction(() => document.querySelectorAll('.card .sum, .card .unsupported').length === 3);
  await p.screenshot({ path: `${OUT}/flow-files-before.png`, fullPage: true });
  assert(!(await p.isVisible('#sampleBanner')) && (await p.$$('.card')).length === 3, '加入自己的檔案後範例自動移除，共 3 張');
  const heicTxt = await p.textContent('.card:nth-child(3) .sum');
  assert(/Apple iPhone 15 Pro/.test(heicTxt) && /25\.0339° N/.test(heicTxt) && await p.isVisible('.card:nth-child(3) .risk.high'), 'HEIC 讀得到相機與 GPS');
  const oriTxt = await p.textContent('.card:nth-child(1) .sum');
  assert(/順時針旋轉 90°/.test(oriTxt) && /GPS 位置/.test(oriTxt) && /Pixel 9/.test(oriTxt), '旋轉照片摘要：方向、GPS、相機');
  assert(/Author：someone/.test(await p.textContent('.card:nth-child(2) .sum')), 'PNG 文字區塊顯示');
  // batch strip in keep-orientation mode
  await p.click('#stripAllBtn');
  await p.waitForFunction(() => document.querySelectorAll('.card .result').length === 3);
  const r1 = await p.textContent('.card:nth-child(1) .result');
  assert(/只剩方向標記/.test(r1), '保留方向標記模式：' + r1.replace(/\s+/g, ' '));
  const keepOut = await p.evaluate(async () => { const it = window.__exif.items[0]; const i = window.__exif.EX.parse(new Uint8Array(await it.out.blob.arrayBuffer())); return { ori: i.summary.orientation, count: i.summary.count, gps: !!i.summary.gps }; });
  assert(keepOut.ori === 6 && keepOut.count === 1 && !keepOut.gps, '輸出只含 Orientation=6，GPS 已清除');
  const heicOut = await p.evaluate(async () => { const it = window.__exif.items[2]; const u = new Uint8Array(await it.out.blob.arrayBuffer()); const i = window.__exif.EX.parse(u); return { n: u.length, size: it.size, gps: !!i.summary.gps, name: it.out.name, cam: i.summary.fields.some(f => f.key === 'camera') }; });
  assert(heicOut.n === heicOut.size && !heicOut.gps && !heicOut.cam && heicOut.name === 'phone-clean.heic', 'HEIC 原地清除：大小不變、GPS 與相機已清 ' + JSON.stringify(heicOut));
  assert(/原地抹除/.test(await p.textContent('.card:nth-child(3) .result')), 'HEIC 結果說明原地抹除');
  assert(await p.isVisible('#dlAllBtn') && /全部下載（3）/.test(await p.textContent('#dlAllBtn')), '全部下載按鈕顯示 3 張');
  // switch to bake mode → results cleared, re-strip re-encodes
  await p.click('#opts summary');
  await p.click('#oriSeg button[data-ori="bake"]');
  await p.waitForFunction(() => document.querySelectorAll('.card .result').length === 0);
  assert(/轉正並清除/.test(await p.textContent('.card:nth-child(1) [data-act="strip"]')), '切換轉正模式後按鈕文字改變，結果作廢');
  await p.click('.card:nth-child(1) [data-act="strip"]');
  await p.waitForSelector('.card:nth-child(1) .result');
  const bake = await p.evaluate(async () => { const it = window.__exif.items[0]; const u = new Uint8Array(await it.out.blob.arrayBuffer()); const i = window.__exif.EX.parse(u); const bm = await createImageBitmap(new Blob([u])); return { w: bm.width, h: bm.height, count: i.summary.count, re: it.out.reencoded, meta: i.meta.filter(m => m.kind !== 'icc').length }; });
  assert(bake.re && bake.w === 40 && bake.h === 80 && bake.count === 0 && bake.meta === 0, '轉正輸出：40×80 像素、無中繼資料 ' + JSON.stringify(bake));
  assert(/已轉正並重新編碼/.test(await p.textContent('.card:nth-child(1) .result')), '結果標示重新編碼');
  // keepIcc off
  await p.click('#keepIcc');
  await p.waitForFunction(() => document.querySelectorAll('.card .result').length === 0);
  await p.click('.card:nth-child(2) [data-act="strip"]');
  await p.waitForSelector('.card:nth-child(2) .result');
  assert(/沒有任何中繼資料/.test(await p.textContent('.card:nth-child(2) .result')), 'PNG 清除結果乾淨');
  await p.screenshot({ path: `${OUT}/flow-files.png`, fullPage: true });
  // options persisted; photos are deliberately not kept, and the sample stays off once you used your own
  await p.reload(); await p.waitForSelector('#empty:not([hidden])');
  assert((await p.$$('.card')).length === 0, '重新整理後不保存照片（標示於頁首）');
  assert(/不保存照片/.test(await p.textContent('header')), '頁首寫明不保存照片');
  await p.click('#showSample'); await p.waitForSelector('.card .sum');
  const persisted = await p.evaluate(() => JSON.parse(localStorage.getItem('exif-tool:v1:opts')));
  assert(persisted.ori === 'bake' && persisted.keepIcc === false, '設定已存入 localStorage');
  assert(/移除 ICC・轉正輸出/.test(await p.textContent('#optSummary')), '設定摘要列顯示正確');
  // clear list with undo
  await p.click('#clearBtn');
  assert(await p.isVisible('#empty') && (await p.$$('.card')).length === 0, '清空後顯示空狀態');
  await p.click('#toastAct'); assert((await p.$$('.card')).length === 1, '清空可以復原');
  // copy coordinates
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await p.click('.maplinks [data-act="copygps"]');
  await p.waitForFunction(() => /複製/.test(document.querySelector('#toast').textContent));
  assert(/已複製座標 25\.109680,121\.844870/.test(await p.textContent('#toast')) && await p.evaluate(() => navigator.clipboard.readText().catch(() => '')) === '25.109680,121.844870', '複製座標 ' + await p.textContent('#toast'));
  await p.click('.card [data-act="rm"]');
  assert(await p.isVisible('#empty'), '移除範例後顯示空狀態');
  await p.evaluate(() => { localStorage.setItem('exif-tool:v1:opts', '{bad json'); localStorage.removeItem('exif-tool:v1:sampleOff'); });
  await p.reload(); await p.waitForSelector('.card .sum');
  assert(await p.isVisible('.card') && /保留 ICC・保留方向/.test(await p.textContent('#optSummary')), '設定損壞時回到預設並正常載入');
  await p.evaluate(() => localStorage.clear());
  await ctx.close();

  // cover 390x520: sample card scrolled to the top so the risk badge, chips and GPS row are in view
  const c = await open(390, 520, 'light');
  await c.p.evaluate(() => window.scrollTo(0, document.querySelector('.card').getBoundingClientRect().top + scrollY - 10));
  await c.p.waitForTimeout(150);
  await c.p.screenshot({ path: `${OUT}/cover-390x520.png` });
  await c.ctx.close();

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  console.log('verify: all ok');
})().catch(e => { console.error(e); process.exit(1); });
