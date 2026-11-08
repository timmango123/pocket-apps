// 照片濾鏡：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-filter-')), WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [], warnings = [];
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, { downloads = true, ...opt } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (downloads) await ctx.addInitScript(mockDl);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning' && /willReadFrequently/.test(m.text())) warnings.push(m.text()); });
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL_); await idle(p);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // one finger: press, optionally hold, release (touchEnd releases the points it lists)
    const tap = async (q, hold = 0) => { await touch('touchStart', [q]); if (hold) await p.waitForTimeout(hold); await touch('touchEnd', [q]); await frames(); };
    const center = sel => p.$eval(sel, e => { e.scrollIntoView({ block: 'nearest', inline: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapSel = async (sel, hold) => tap(await center(sel), hold);
    const S = expr => p.evaluate(new Function('return (' + expr + ')'));
    return { ctx, p, cdp, touch, tap, tapSel, center, frames, S };
  }
  const idle = p => p.waitForFunction(() => window.__pf && __pf.idle(), null, { timeout: 30000 });
  // build an image file in the page (canvas → blob) and open it through the real file input
  async function loadImg(p, name, spec, mime = 'image/png', cut = 0) {
    const b64 = await p.evaluate(async ([s, mime, cut]) => {
      const c = document.createElement('canvas'); c.width = s.w; c.height = s.h; const x = c.getContext('2d');
      if (s.noise) { const d = x.createImageData(s.w, s.h); for (let i = 0; i < d.data.length; i++) d.data[i] = i % 4 === 3 ? 255 : (i * 2654435761 >>> 24) & 255; x.putImageData(d, 0, 0); }
      else if (s.alpha) { x.fillStyle = s.fill; x.fillRect(s.w / 2, 0, s.w / 2, s.h); }
      else { x.fillStyle = s.fill || '#c84'; x.fillRect(0, 0, s.w, s.h); x.fillStyle = '#248'; x.fillRect(0, 0, s.w / 3, s.h / 2); }
      const b = await new Promise(r => c.toBlob(r, mime, 0.9)); let u = new Uint8Array(await b.arrayBuffer()); if (cut) u = u.slice(0, Math.floor(u.length * cut));
      let str = ''; for (let i = 0; i < u.length; i += 8192) str += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(str);
    }, [spec, mime, cut]);
    await p.setInputFiles('#fileInput', { name, mimeType: mime, buffer: Buffer.from(b64, 'base64') });
    await p.waitForFunction(n => __pf.S.name === n, name); await idle(p);
  }
  const toastText = p => p.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : document.getElementById('toastMsg').textContent; });
  const exportNow = async (t, fmt) => {
    await t.tapSel('#exportBtn'); await t.tapSel('label:has(#fmt-' + fmt + ')'); assert(await t.p.isChecked('#fmt-' + fmt), '觸控點格式 ' + fmt);
    const n = await t.S('window.__saved.length'); await t.tapSel('#exGo');
    await t.p.waitForFunction(n => window.__saved.length > n, n, { timeout: 30000 });
    const r = await t.p.evaluate(async () => { const s = window.__saved[window.__saved.length - 1]; const b = await createImageBitmap(s.data); const c = document.createElement('canvas'); c.width = b.width; c.height = b.height; const x = c.getContext('2d'); x.drawImage(b, 0, 0);
      return { name: s.filename, w: b.width, h: b.height, type: s.data.type, left: Array.from(x.getImageData(1, Math.floor(b.height / 2), 1, 1).data), info: document.getElementById('exInfo').textContent }; });
    await t.tapSel('#exClose'); return r;
  };

  // ---------- 1. 否決：開啟的照片重新整理後還在（IndexedDB） ----------
  {
    const t = await open();
    await loadImg(t.p, 'trip.png', { w: 300, h: 200 });
    await t.p.evaluate(() => __pf.persisted());
    assert(await t.S('JSON.parse(localStorage.getItem("photo-filter:v1:photo")||"null")?.name') === 'trip.png', '照片寫入 IndexedDB 後，指標才指向它');
    await t.tapSel('#f-warm'); await t.tapSel('#tab-adjust');
    await t.p.fill('#p-contrast', '30'); await t.p.dispatchEvent('#p-contrast', 'input'); await t.p.dispatchEvent('#p-contrast', 'change');
    await t.p.reload(); await idle(t.p);
    const st = await t.S('({name:__pf.S.name,sample:__pf.S.sample,iw:__pf.S.iw,ih:__pf.S.ih,f:__pf.S.filter,c:__pf.S.params.contrast,tag:document.getElementById("sampleTag").hidden,meta:document.getElementById("metaName").textContent})');
    assert(st.name === 'trip.png' && !st.sample && st.iw === 300 && st.ih === 200 && st.tag && st.meta === 'trip.png', '重新整理後還是同一張照片：' + JSON.stringify(st));
    assert(st.f === 'warm' && st.c === 30, '濾鏡與調整也還在');
    await loadImg(t.p, 'second.png', { w: 120, h: 160, fill: '#3a6' }); await t.p.evaluate(() => __pf.persisted());
    const keys = await t.p.evaluate(() => new Promise(r => { const q = indexedDB.open('photo-filter', 1); q.onsuccess = () => { const g = q.result.transaction('photos').objectStore('photos').getAllKeys(); g.onsuccess = () => { r(g.result.length); q.result.close(); }; }; }));
    assert(keys === 1, '換照片後舊的那張從 IndexedDB 刪掉（剩 ' + keys + ' 筆）');
    await t.p.reload(); await idle(t.p);
    assert(await t.S('__pf.S.name') === 'second.png' && await t.S('__pf.S.iw') === 120, '重新整理後是最後開啟的照片');
    // pointer to a photo that is gone → sample + explanation, pointer cleared
    await t.p.evaluate(() => localStorage.setItem('photo-filter:v1:photo', JSON.stringify({ id: 'gone', name: 'x.jpg' })));
    await t.p.reload(); await idle(t.p);
    assert(await t.S('__pf.S.sample') && /找不到上次/.test(await toastText(t.p)) && await t.S('localStorage.getItem("photo-filter:v1:photo")') === null, '找不到上次的照片：退回範例並說明');

    // ---------- 2. 觸控：pointerup 觸發、每次一下、慢點、另一指按著時也有效、沒有鬼點擊 ----------
    await t.tapSel('#tab-filter');
    await t.tapSel('#f-cool'); assert(await t.S('__pf.S.filter') === 'cool', 'CDP 觸控點縮圖：冷調');
    const seq = []; for (let i = 0; i < 8; i++) { await t.tapSel(i % 2 ? '#f-cool' : '#f-vivid'); seq.push(await t.S('__pf.S.filter')); }
    assert(seq.join() === 'vivid,cool,vivid,cool,vivid,cool,vivid,cool', '交替點兩個縮圖 8 次，每次都對：' + seq.join());
    await t.tapSel('#f-mono', 600); assert(await t.S('__pf.S.filter') === 'mono', '按住 0.6 秒的慢點有效');
    await t.tapSel('#f-sepia', 1000); assert(await t.S('__pf.S.filter') === 'sepia', '按住 1 秒的慢點有效');
    const stage = await t.center('#stage'), warm = await t.center('#f-warm'), tabA = await t.center('#tab-adjust');
    await t.touch('touchStart', [[...stage, 1]]); await t.p.waitForFunction(() => !document.getElementById('origTag').hidden);
    await t.touch('touchStart', [[...stage, 1], [...warm, 2]]); await t.touch('touchEnd', [[...warm, 2]]); await t.frames();
    assert(await t.S('__pf.S.filter') === 'warm', '一指按著預覽（看原圖）時，另一指點縮圖有效');
    await t.touch('touchStart', [[...stage, 1], [...tabA, 3]]); await t.touch('touchEnd', [[...tabA, 3]]); await t.frames();
    assert(await t.p.isVisible('#panelAdjust'), '一指按著預覽時，另一指點分頁有效');
    await t.touch('touchEnd', [[...stage, 1]]); await t.frames();
    assert(!(await t.p.isVisible('#origTag')), '放開後回到調整後的畫面');
    await t.tapSel('#tab-filter');
    // ghost clicks: the sheet that opens under the finger must not get the click; nor what is under 關閉
    await t.tapSel('#exportBtn'); await t.p.waitForTimeout(350); await t.frames();
    assert(await t.p.isVisible('#exSheet'), '點「匯出」開出的視窗不會被同一下點擊關掉');
    const before = await t.S('[__pf.S.filter,__pf.customs.length,__pf.S.tab].join()');
    await t.tapSel('#exClose'); await t.p.waitForTimeout(350); await t.frames();
    assert(!(await t.p.isVisible('#exSheet')) && await t.S('[__pf.S.filter,__pf.customs.length,__pf.S.tab].join()') === before, '點「關閉」後，手指下的控制項沒有被誤觸');
    // keyboard still works (click with detail 0)
    await t.p.focus('#f-vivid'); await t.p.keyboard.press('Enter'); assert(await t.S('__pf.S.filter') === 'vivid', '鍵盤 Enter 仍可選濾鏡');

    // ---------- 3. 自訂濾鏡：刪除兩段確認＋復原、改名、選取在重新整理後保留 ----------
    await t.tapSel('#saveCustom'); const n0 = await t.S('__pf.customs.length');
    assert(n0 === 1 && await t.S('__pf.S.customIdx') === 0 && await t.p.isVisible('#cName'), '存成自訂濾鏡，出現名稱欄');
    await t.tapSel('#delCustom'); assert(await t.S('__pf.customs.length') === 1 && await t.p.textContent('#delCustom') === '再按一次確認刪除', '刪除第一下只是確認（一下不會算兩次）');
    await t.tapSel('#delCustom'); assert(await t.S('__pf.customs.length') === 0, '第二下才刪除');
    const pe = await t.p.evaluate(() => [getComputedStyle(document.getElementById('toast')).pointerEvents, getComputedStyle(document.getElementById('toastBtn')).pointerEvents, document.getElementById('toastBtn').hidden]);
    assert(pe[0] === 'none' && pe[1] === 'auto' && !pe[2], 'toast 本身不接觸控，只有「復原」可點');
    await t.tapSel('#toastBtn'); assert(await t.S('__pf.customs.length') === 1 && await t.S('__pf.customs[0].name') === '自訂 1', '刪除自訂可以復原');
    await t.tapSel('#c-0'); await t.p.fill('#cName', '夕陽 🌅'); await t.p.dispatchEvent('#cName', 'change');
    assert(await t.p.textContent('#c-0 .nm') === '夕陽 🌅' && (await t.p.textContent('#metaState')).startsWith('夕陽 🌅'), '自訂濾鏡可改名');
    await t.p.reload(); await idle(t.p);
    assert(await t.S('__pf.customs[0].name') === '夕陽 🌅' && await t.S('__pf.S.customIdx') === 0 && await t.p.getAttribute('#c-0', 'aria-pressed') === 'true', '重新整理後名稱與選取的自訂濾鏡都保留');

    // ---------- 4. 重設可以復原 ----------
    await t.tapSel('#f-film'); await t.p.fill('#strength', '60'); await t.p.dispatchEvent('#strength', 'input');
    await t.p.evaluate(() => { const i = document.getElementById('p-exposure'); i.value = '0.5'; i.dispatchEvent(new Event('input')); });
    await t.tapSel('#resetBtn');
    assert(await t.S('__pf.S.filter') === 'none' && await t.S('__pf.S.params.exposure') === 0 && await t.p.isVisible('#toastBtn'), '重設後出現「復原」');
    await t.tapSel('#toastBtn');
    assert(await t.S('[__pf.S.filter,__pf.S.strength,__pf.S.params.exposure].join()') === 'film,60,0.5', '按「復原」恢復濾鏡、強度與調整');
    await t.p.reload(); await idle(t.p);
    assert(await t.S('[__pf.S.filter,__pf.S.strength,__pf.S.params.exposure].join()') === 'film,60,0.5', '復原的狀態有存檔');

    // ---------- 5. 點數值歸零（取代觸控連點兩下） ----------
    await t.tapSel('#tab-adjust');
    assert((await t.p.textContent('#panelAdjust .subhead')).includes('點右側數值'), '說明改成點數值歸零');
    await t.p.fill('#p-contrast', '30'); await t.p.dispatchEvent('#p-contrast', 'input');
    const ob = await t.p.$eval('#o-contrast', e => { const b = e.getBoundingClientRect(); return [b.width, b.height]; });
    assert(ob[0] >= 44 && ob[1] >= 44, '數值按鈕 ≥44×44：' + ob);
    await t.tapSel('#o-contrast');
    assert(await t.S('__pf.S.params.contrast') === 0 && await t.p.inputValue('#p-contrast') === '0', '觸控點對比的數值 → 歸零');
    await t.p.fill('#p-shadows', '40'); await t.p.dispatchEvent('#p-shadows', 'input'); await t.p.dblclick('#p-shadows');
    assert(await t.S('__pf.S.params.shadows') === 0, '滑鼠雙擊滑桿仍可歸零');

    // ---------- 6. 效能：拖動時只算小預覽，放開後才算 1080 px 全量 ----------
    await idle(t.p);
    // pixel counts instead of wall-clock timing (the machine may be loaded): the drag preview does ≤ 1/3.5 of the work
    const cost = await t.S('({q:__pf.S.qw*__pf.S.qh, f:__pf.S.ww*__pf.S.wh, qw:Math.max(__pf.S.qw,__pf.S.qh)})');
    assert(cost.qw <= 540 && cost.q * 3.5 <= cost.f, `拖動時的預覽 ${cost.q} 像素，全量 ${cost.f} 像素`);
    const sl = await t.p.$eval('#p-saturation', e => { e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return [b.left, b.top + b.height / 2, b.width]; });
    const s0 = await t.S('({...__pf.stats})');
    const x0 = sl[0] + sl[2] / 2;
    await t.touch('touchStart', [[x0, sl[1]]]);
    for (let i = 1; i <= 12; i++) { await t.touch('touchMove', [[x0 + i * 8, sl[1]]]); await t.frames(); }
    const s1 = await t.S('({...__pf.stats})');
    assert(s1.quick > s0.quick && s1.full === s0.full, `拖動中：小預覽 ${s1.quick - s0.quick} 次，全量 0 次`);
    await t.touch('touchEnd', [[x0 + 96, sl[1]]]); await idle(t.p);
    const s2 = await t.S('({...__pf.stats})');
    const same = await t.p.evaluate(() => { const { S, prep, renderImageData } = __pf; const ref = renderImageData(S.workData, prep(S.params, S.filter, S.strength, 1)).data;
      const pv = document.getElementById('pv').getContext('2d').getImageData(0, 0, S.ww, S.wh).data; let m = 0; for (let i = 0; i < ref.length; i++) m = Math.max(m, Math.abs(ref[i] - pv[i])); return m; });
    assert(s2.full === s1.full + 1 && same <= 1 && await t.S('__pf.S.params.saturation') > 0, `放開後算一次全量，預覽與全量結果相同（差 ${same}）`);
    await t.ctx.close();
  }

  // ---------- 7. 匯出：透明 PNG→JPG 白底、極端長寬比、縮小提示、檔名、截斷 JPEG ----------
  {
    const t = await open();
    await loadImg(t.p, 'alpha.png', { w: 200, h: 100, alpha: true, fill: '#2050c0' });
    let r = await exportNow(t, 'jpg');
    assert(r.left[0] > 245 && r.left[1] > 245 && r.left[2] > 245, '透明 PNG 匯出 JPG：透明處是白色 ' + r.left.slice(0, 3));
    r = await exportNow(t, 'png'); assert(r.left[3] === 0, '匯出 PNG 保留透明');
    await loadImg(t.p, '.png', { w: 40, h: 30 }); r = await exportNow(t, 'jpg');
    assert(r.name === 'photo-filtered.jpg', '檔名只有「.png」→ ' + r.name);
    await loadImg(t.p, '1x20000.png', { w: 1, h: 20000, fill: '#888' });
    const msg = await toastText(t.p);
    assert(await t.S('[__pf.S.iw,__pf.S.ih].join()') === '1,8192' && /1×20000.*已縮小至 1×8192/.test(msg), '1×20000 正常開啟並縮小，提示寫明：' + msg);
    r = await exportNow(t, 'jpg');
    assert(r.w === 1 && r.h === 8192 && /輸出 1×8192（原圖 1×20000 已縮小）/.test(r.info), '1×20000 匯出 1×8192，匯出資訊寫明已縮小：' + r.info);
    await loadImg(t.p, 'cut.jpg', { w: 400, h: 300, noise: true }, 'image/jpeg', 0.6);
    assert(/不完整/.test(await toastText(t.p)), '截斷的 JPEG 有提示');
    await loadImg(t.p, 'ok.jpg', { w: 400, h: 300, noise: true }, 'image/jpeg');
    assert(!/不完整/.test(await toastText(t.p)), '完整的 JPEG 沒有誤報');
    // preview/export consistency: grain cell and sharpen radius scale with the export/preview size ratio
    const pipe = await t.p.evaluate(() => { const { prep, processRows, PARAMS } = __pf; const p0 = Object.fromEntries(PARAMS.map(q => [q.key, q.def]));
      const run = (w, h, fill, params, gs) => { const src = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { const v = fill(i % w); src.set([v, v, v, 255], i * 4); } const dst = new Uint8ClampedArray(src.length); processRows(src, w, 0, h, dst, 0, h, w, h, prep({ ...p0, ...params }, 'none', 100, gs)); return { src, dst }; };
      const g = run(16, 16, () => 128, { grain: 100 }, 4).dst; let blocks = true; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (g[(y * 16 + x) * 4] !== g[((y & ~3) * 16 + (x & ~3)) * 4]) blocks = false;
      const ch = gs => { const { src, dst } = run(40, 5, x => x < 20 ? 60 : 180, { sharpen: 100 }, gs); let n = 0; for (let x = 0; x < 40; x++) if (dst[(2 * 40 + x) * 4] !== src[(2 * 40 + x) * 4]) n++; return n; };
      return { blocks, e1: ch(1), e3: ch(3) }; });
    assert(pipe.blocks, '顆粒在 4 倍解析度輸出時是 4×4 的顆粒（與預覽一致）');
    assert(pipe.e1 === 2 && pipe.e3 === 6, `銳利化半徑隨解析度放大：預覽 ${pipe.e1} px、3 倍輸出 ${pipe.e3} px`);
    await t.ctx.close();
  }

  // ---------- 8. Pages（沒有 downloads）：產生後有「儲存圖片」 ----------
  {
    const t = await open(390, 844, { downloads: false });
    await t.tapSel('#exportBtn'); assert(await t.p.textContent('#exGo') === '產生圖片', '沒有 downloads 時按鈕是「產生圖片」');
    const r0 = await t.p.$eval('#exGo', e => JSON.stringify(e.getBoundingClientRect()));
    await t.tapSel('#exGo'); await t.p.waitForSelector('#exResult:not([hidden])', { timeout: 30000 });
    assert(await t.p.textContent('#exGo') === '儲存圖片' && await t.p.$eval('#exGo', e => JSON.stringify(e.getBoundingClientRect())) === r0, '產生後同一個按鈕變成「儲存圖片」，位置不變');
    assert(/^blob:/.test(await t.p.getAttribute('#exDl', 'href')) && await t.p.getAttribute('#exDl', 'download') === 'sample-filtered.jpg', '「儲存圖片」用 <a download> 下載');
    const dlP = t.p.waitForEvent('download', { timeout: 15000 });
    await t.tapSel('#exGo'); const d = await dlP;
    assert(d.suggestedFilename() === 'sample-filtered.jpg', '觸控點「儲存圖片」會下載 ' + d.suggestedFilename());
    await t.tapSel('label:has(#fmt-png)'); assert(await t.p.textContent('#exGo') === '產生圖片' && !(await t.p.isVisible('#exResult')), '換格式後要重新產生');
    await t.ctx.close();
  }

  // ---------- 9. 壞掉的自訂濾鏡資料不會讓頁面出錯 ----------
  {
    const t = await open();
    await t.p.evaluate(() => localStorage.setItem('photo-filter:v1:custom', JSON.stringify([null, { name: '好的', filter: 'warm', strength: 50, params: { contrast: 20 } }, { filter: 'bogus' }, 5, 'x', { name: 7, filter: 'mono', strength: 900, params: { exposure: 99 } }])));
    const e0 = errors.length; await t.p.reload(); await idle(t.p);
    const cs = await t.S('__pf.customs.map(c=>[c.name,c.filter,c.strength,c.params.exposure].join("/")).join()');
    assert(errors.length === e0 && await t.p.$$eval('#strip .fthumb', b => b.length) === 14 && cs === '好的/warm/50/0,自訂 1/mono/100/2', '壞項目被丟掉或修正，濾鏡列正常：' + cs);
    await t.ctx.close();
  }

  // ---------- 10. 版面：濾鏡列露出下一個、矮螢幕第一屏看得到、高螢幕兩列、提示文字有底色 ----------
  for (const [w, h] of [[360, 640], [390, 700], [375, 500], [390, 844], [430, 932]]) {
    const t = await open(w, h);
    const m = await t.p.evaluate(() => { const s = document.getElementById('strip'), r = s.getBoundingClientRect(), b = [...s.children].map(e => e.getBoundingClientRect());
      const cut = b.find(q => q.right > r.right + 1); return { peek: cut ? Math.min(r.right, cut.right) - cut.left : -1, w: cut ? cut.width : 0, rows: new Set(b.map(q => Math.round(q.top))).size, top: b[0].bottom,
        hint: getComputedStyle(document.getElementById('hint')).backgroundColor, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    assert(m.peek >= m.w * 0.2 && m.peek <= m.w * 0.8, `${w}×${h} 濾鏡列下一個縮圖露出 ${Math.round(m.peek)}/${Math.round(m.w)} px`);
    if (h >= 760) assert(m.rows === 2, `${w}×${h} 高螢幕顯示兩列縮圖`);
    assert(m.top <= h, `${w}×${h} 第一排縮圖在第一屏內（底 ${Math.round(m.top)}）`);
    assert(m.sw <= m.iw && m.hint !== 'rgba(0, 0, 0, 0)', `${w}×${h} 無橫向捲動、提示文字有底色`);
    await t.ctx.close();
  }

  assert(errors.length === 0, '沒有 page／console error ' + JSON.stringify(errors.slice(0, 3)));
  assert(warnings.length === 0, '沒有 willReadFrequently 警告');
  await browser.close(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} console.log('FAIL ' + e.message); process.exit(1); });
