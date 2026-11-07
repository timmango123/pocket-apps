// 證件照排版：上架評分 toFix 的回歸測試（node tests.js，約 30 秒；只用 Chromium，不需要 PIL）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = path.resolve(__dirname, '../index.html');
const HTML = () => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
// downloads shim like the site's (window.claude.use('downloads')); ?noshim leaves it out so the result sheet is used
const SHIM = () => { if (location.search.includes('noshim')) return; window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, size: data.size }); } } : null }; };
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const mobile = (w, h, o = {}) => ({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...o });

// person photo drawn like the reviewer's fixtures (independent of the app's own sample)
async function photo(p, W, H, top, chin, type = 'image/jpeg') {
  const b64 = await p.evaluate(async ([W, H, top, chin, type]) => {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const d = c.getContext('2d');
    d.fillStyle = 'rgb(205,220,235)'; d.fillRect(0, 0, W, H); const cx = W / 2, hh = chin - top, hw = hh * 0.68;
    const ell = (x0, y0, x1, y1, col) => { d.fillStyle = col; d.beginPath(); d.ellipse((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, 7); d.fill(); };
    ell(cx - hw / 2 - hw / 8, top + hh * .35, cx + hw / 2 + hw / 8, top + hh * .65, 'rgb(215,168,136)');
    ell(cx - hw / 2, top, cx + hw / 2, chin, 'rgb(230,185,152)');
    d.fillStyle = 'rgb(35,26,20)'; d.beginPath(); d.ellipse(cx, top - 6 + (hh * .7 + 6) / 2, hw / 2 + 4, (hh * .7 + 6) / 2, 0, Math.PI, 2 * Math.PI); d.fill();
    d.fillStyle = 'rgb(220,174,142)'; d.fillRect(cx - hw / 5, chin - hh * .05, hw * 2 / 5, hh * .3);
    ell(cx - hw * 1.4, chin + hh * .15, cx + hw * 1.4, chin + hh * 1.6, 'rgb(36,50,74)');
    const b = await new Promise(r => c.toBlob(r, type, .9)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s);
  }, [W, H, top, chin, type]);
  return Buffer.from(b64, 'base64');
}
const openPhoto = async (p, name, buf, type = 'image/jpeg') => {
  await p.setInputFiles('#fileInput', { name, mimeType: type, buffer: buf });
  await p.waitForFunction(n => __id.S.srcName === n && __id.S.photoSaved !== null, name, { timeout: 20000 });
};

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML()); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const URL = `http://127.0.0.1:${srv.address().port}/apps/id-photo/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, q = '') {
    const ctx = await browser.newContext(mobile(w, h, opt)); await ctx.addInitScript(SHIM); const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { const u = r.url(); if (!u.startsWith('http://127.0.0.1') && !u.startsWith('data:') && !u.startsWith('blob:')) errors.push('external ' + u); });
    await p.goto(URL + q); await p.evaluate(() => __id.ready); return { ctx, p };
  }
  const toastNow = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);

  // 1. 否決：重新整理後照片、裁切、旋轉、張數、步驟都還在
  {
    const { ctx, p } = await open();
    const buf = await photo(p, 1500, 2000, 450, 1200);
    await p.click('#spec-us'); await openPhoto(p, 'PXL_20261107_063512123.jpg', buf);
    assert(await p.evaluate(() => __id.S.step === 2 && __id.S.photoSaved === true), '開啟照片後跳到裁切，照片已存到本機（IndexedDB）');
    await p.evaluate(() => { const S = __id.S; S.crop.cx -= 60; S.crop.fh *= 0.9; const r = document.querySelector('#rot'); r.value = 4; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
    await p.click('#next2'); await p.selectOption('#countSel', '1');
    const before = await p.evaluate(() => ({ ...__id.S.crop, w: __id.S.src.width, h: __id.S.src.height }));
    await p.reload(); await p.evaluate(() => __id.ready);
    const after = await p.evaluate(() => ({ ...__id.S.crop, w: __id.S.src.width, h: __id.S.src.height, sample: __id.S.sample, step: __id.S.step, count: __id.S.count, sel: document.querySelector('#countSel').value, n: __id.S.lastLayout && __id.S.lastLayout.n, name: document.querySelector('#srcLabel').textContent, info: document.querySelector('#srcInfo').textContent }));
    await p.waitForFunction(() => __id.S.lastLayout && __id.S.lastLayout.n === 1);
    const rel = (a, b) => Math.abs(a - b) < 0.003;
    assert(!after.sample && after.name === 'PXL_20261107_063512123.jpg' && after.w === before.w && after.h === before.h, `重新整理後還是自己的照片 ${after.name} ${after.w}×${after.h}`);
    assert(rel(after.cx / after.w, before.cx / before.w) && rel(after.cy / after.h, before.cy / before.h) && rel(after.fh / after.h, before.fh / before.h) && after.rot === 4, `裁切位置／縮放／旋轉 +4° 還原 ${JSON.stringify([after.cx, after.cy, after.fh, after.rot].map(Math.round))}`);
    assert(after.step === 3 && after.count === '1' && after.sel === '1', `回到第 3 步、張數 1（step ${after.step} count ${after.count}）`);
    assert(after.info.includes('已存在本機'), '照片列標示「已存在本機」：' + after.info);
    // 2. 換規格再換回來，裁切不會被重設
    await p.click('#st1'); const c0 = await p.evaluate(() => ({ ...__id.S.crop }));
    await p.click('#spec-1in'); await p.evaluate(() => { __id.S.crop.cx += 40; }); await p.click('#spec-cn'); await p.click('#spec-us');
    const c1 = await p.evaluate(() => ({ ...__id.S.crop }));
    assert(Math.abs(c1.cx - c0.cx) < 0.5 && Math.abs(c1.fh - c0.fh) < 0.5 && c1.rot === c0.rot, '換別的規格再換回來，原本的裁切還在');
    await p.click('#spec-1in'); await p.waitForTimeout(20);
    assert(await p.evaluate(() => Math.abs(__id.S.crop.cx - __id.S.crops['1in'].x * __id.S.src.width) < 0.5), '一吋也記住自己的裁切');
    // 3. 自訂寬高打完沒離開欄位就重新整理也不會遺失；壞的自訂尺寸被擋下
    await p.click('#spec-custom'); await p.fill('#cw', '44'); await p.reload(); await p.evaluate(() => __id.ready);
    assert(await p.evaluate(() => __id.S.spec === 'custom' && __id.S.custom.w === 44), '自訂寬 44 未離開欄位就重新整理仍保留');
    await p.evaluate(() => { __id.S.src = null; /* no save on pagehide */ localStorage.setItem('id-photo:v1:custom-specs', '[{"w":-5,"h":1e9}]'); localStorage.setItem('id-photo:v1:session', '{"step":9,"count":"zz","crops":{"2in":{"x":"a"}}}'); });
    await p.reload(); await p.evaluate(() => __id.ready);
    assert((await p.textContent('#spec-custom .mm')) === '30×40mm' && await p.evaluate(() => __id.S.step === 1 && __id.S.count === 'auto'), '壞掉的自訂尺寸／session 改用預設 30×40mm、第 1 步');
    // 舊版只有 settings 的使用者照常載入
    await p.evaluate(() => { __id.S.src = null; localStorage.clear(); localStorage.setItem('id-photo:v1:settings', '{"spec":"jp","paper":"5x7","gap":1,"cut":false}'); localStorage.setItem('id-photo:v1:custom-specs', '[{"w":40,"h":50}]'); });
    await p.reload(); await p.evaluate(() => __id.ready);
    assert(await p.evaluate(() => __id.S.spec === 'jp' && __id.S.paper === '5x7' && __id.S.gap === 1 && !__id.S.cut && __id.S.custom.w === 40 && __id.S.sample && __id.S.step === 1), '舊版存檔（settings、custom-specs）照常讀取');
    await ctx.close();
  }

  // 4. 否決：360 寬照片列的檔名不重疊、不橫向捲動，範例提示不被截斷
  for (const w of [360, 390]) {
    const { ctx, p } = await open(w, 640);
    const m = () => p.evaluate(() => { const l = document.querySelector('#srcLabel').getBoundingClientRect(), b = document.querySelector('#openBtn2').getBoundingClientRect(), i = document.querySelector('#srcInfo');
      return { overlap: l.right > b.left + 1, sw: document.documentElement.scrollWidth, infoClip: i.scrollWidth > i.clientWidth + 1 || i.getBoundingClientRect().right > b.left + 1 }; });
    const s0 = await m(); assert(!s0.overlap && !s0.infoClip && s0.sw <= w, `${w} 寬範例提示完整顯示 ${JSON.stringify(s0)}`);
    const buf = await photo(p, 300, 400, 80, 260);
    for (const name of ['PXL_20261107_063512123.jpg', 'PXL_20261107_063512123.MP.jpg', 'IMG_20261107_143512_HDR_portrait_final_version2.jpg', '王小明 大學畢業照 二吋 最終版 請用這張.jpg']) {
      await openPhoto(p, name, buf); await p.click('#st1');
      const r = await m(); assert(!r.overlap && !r.infoClip && r.sw <= w, `${w} 寬檔名 ${name.slice(0, 18)}… 不壓到「換照片」、無橫向捲動 ${JSON.stringify(r)}`);
    }
    await ctx.close();
  }

  // 5. 自動排滿可混合直放與橫放；每張都在相紙邊界內且互不重疊
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => { const { pack } = __id, W = (P, s, g) => pack(P[0] - 6, P[1] - 6, s[0], s[1], g).n;
      return { cn4x6: W([101.6, 152.4], [33, 48], 2), in5x7: W([127, 177.8], [28, 35], 2), two5x7: W([127, 177.8], [35, 45], 2), twoA4: W([210, 297], [35, 45], 2), two4x6: W([101.6, 152.4], [35, 45], 2), one4x6: W([101.6, 152.4], [28, 35], 2) }; });
    assert(r.cn4x6 === 6 && r.in5x7 === 18 && r.two5x7 === 10 && r.twoA4 >= 31, `混合方向：中國簽證 4×6 ${r.cn4x6}（原 4）、一吋 5×7 ${r.in5x7}（原 16）、二吋 5×7 ${r.two5x7}（原 9）、二吋 A4 ${r.twoA4}（原 30）`);
    assert(r.two4x6 === 8 && r.one4x6 === 12, `原本的結果不變：二吋 4×6 ${r.two4x6}、一吋 4×6 ${r.one4x6}`);
    const bad = await p.evaluate(() => { const { S, SPECS, PAPERS, computeLayout } = __id, out = [];
      for (const sp of SPECS) for (const pa of PAPERS) for (const g of [0, 2, 5]) for (const cnt of ['auto', '1', '5']) { S.spec = sp.id; S.paper = pa.id; S.gap = g; S.count = cnt; S.mix = 'none'; const L = computeLayout();
        if (cnt !== 'auto' && L.n > +cnt) out.push('count ' + sp.id + pa.id);
        for (const a of L.items) { if (a.x < 3 - 1e-6 || a.y < 3 - 1e-6 || a.x + a.w > pa.wMM - 3 + 1e-6 || a.y + a.h > pa.hMM - 3 + 1e-6) out.push('out ' + sp.id + pa.id + g);
          const [ww, hh] = a.rot ? [sp.id === 'custom' ? S.custom.h : sp.hMM, sp.id === 'custom' ? S.custom.w : sp.wMM] : [sp.id === 'custom' ? S.custom.w : sp.wMM, sp.id === 'custom' ? S.custom.h : sp.hMM];
          if (Math.abs(a.w - ww) > 1e-6 || Math.abs(a.h - hh) > 1e-6) out.push('size ' + sp.id);
          for (const b of L.items) if (a !== b && a.x < b.x + b.w + g - 1e-6 && b.x < a.x + a.w + g - 1e-6 && a.y < b.y + b.h + g - 1e-6 && b.y < a.y + a.h + g - 1e-6) out.push('gap ' + sp.id + pa.id + g); } }
      S.spec = '2in'; S.paper = '4x6'; S.gap = 2; S.count = 'auto'; return out; });
    assert(bad.length === 0, '7 規格 × 4 相紙 × 3 間距 × 3 張數：每張在 3mm 邊界內、間距足夠、尺寸正確 ' + bad.slice(0, 3));
    await p.click('#spec-cn'); await p.click('#next1'); await p.click('#next2'); await p.waitForFunction(() => __id.S.lastLayout && __id.S.spec === 'cn');
    assert((await p.textContent('#countN')) === '6' && (await p.textContent('#layoutNote')).includes('轉 90°'), '中國簽證 4×6 畫面顯示 6 張，並說明部分轉 90°：' + await p.textContent('#layoutNote'));
    assert(await p.evaluate(() => document.querySelectorAll('#countSel option').length === 7), '張數選單最多到 6 張');
    // 6. 下載按鈕在預覽上方，第一屏就看得到
    const ob = await p.evaluate(() => { const r = document.querySelector('#outPaper').getBoundingClientRect(), q = document.querySelector('#paper').getBoundingClientRect(); return { b: r.bottom + scrollY, pv: q.top + scrollY }; });
    assert(ob.b <= 844 && ob.b < ob.pv, `390×844 下載相紙按鈕在第一屏（底 ${Math.round(ob.b)}px）且在預覽上方`);
    await ctx.close();
  }
  {
    const { ctx, p } = await open(360, 640); await p.evaluate(() => __id.goStep(3)); await p.waitForTimeout(50);
    const b = await p.evaluate(() => document.querySelector('#outSingle').getBoundingClientRect().bottom + scrollY);
    assert(b <= 640, `360×640 兩個下載按鈕都在第一屏（底 ${Math.round(b)}px）`);
    await ctx.close();
  }

  // 7. 單張上限達不到時，警告不會被「已儲存」蓋掉，並寫出實際大小
  {
    const { ctx, p } = await open();
    await p.evaluate(() => { __id.S.limit = 1500; __id.goStep(3); });
    await p.click('#outSingle'); await p.waitForFunction(() => window.__saved.length === 1);
    const t = await toastNow(p); assert(/已儲存 .*仍超過.*實際 \d+KB/.test(t), '達不到上限時提示仍超過與實際大小：' + t);
    await p.evaluate(() => { __id.S.limit = 1048576; }); await p.click('#outSingle'); await p.waitForFunction(() => window.__saved.length === 2);
    assert(!(await toastNow(p)).includes('超過'), '達得到上限時只顯示已儲存');
    await ctx.close();
  }

  // 8. 自己的照片預設裁切就讓頭頂與下巴落在綠色帶內（二吋 3–5mm、頭高 32–36mm）
  {
    const { ctx, p } = await open();
    for (const [W, H, top, chin] of [[3000, 4000, 900, 2400], [1200, 1600, 200, 900], [2000, 2000, 500, 1300], [900, 1600, 300, 800]]) {
      await openPhoto(p, `p${W}x${H}.jpg`, await photo(p, W, H, top, chin));
      const r = await p.evaluate(([top, chin]) => { const S = __id.S, s = __id.SPECS.find(x => x.id === S.spec), c = S.crop, k = c.fh / s.hMM, y0 = c.cy - c.fh / 2; return { spec: S.spec, topMM: (top - 6 - y0) / k, headMM: (chin - top + 6) / k, cov: __id.cropCovered() }; }, [top, chin]);
      assert(r.spec === '2in' && r.topMM >= 2.5 && r.topMM <= 5.5 && r.headMM >= 31.5 && r.headMM <= 36.5, `${W}×${H} 頭 ${top}–${chin}：預設頭頂 ${r.topMM.toFixed(1)}mm、頭高 ${r.headMM.toFixed(1)}mm`);
    }
    // 9. 裁切框超出照片：編輯器裡畫白色（和輸出一致），並顯示白邊警告；警告不會推動下方控制項
    const y0 = await p.evaluate(() => document.querySelector('#zoom').getBoundingClientRect().top);
    await p.evaluate(() => { __id.S.crop.cx = 0; document.querySelector('#zoom').dispatchEvent(new Event('input')); });
    const e = await p.evaluate(() => { const c = document.querySelector('#ed'), x = c.getContext('2d'), w = document.querySelector('#editor'), dpr = c.width / w.clientWidth;
      const fw = (w.clientHeight - 56) * 35 / 45; const d = x.getImageData(Math.round((w.clientWidth / 2 - fw / 2 + 6) * dpr), Math.round(w.clientHeight / 2 * dpr), 1, 1).data;
      return { px: [...d].slice(0, 3), warn: !document.querySelector('#edgeWarn').hidden, y: document.querySelector('#zoom').getBoundingClientRect().top }; });
    assert(e.px.every(v => v > 245) && e.warn, `框內沒照片的地方畫白色 ${e.px}，並顯示「${await p.textContent('#edgeWarn')}」`);
    assert(Math.abs(e.y - y0) < 0.5, '白邊警告疊在裁切畫面上，縮放滑桿位置不變');
    await p.evaluate(() => { __id.S.crop.cx = __id.S.src.width / 2; document.querySelector('#zoom').dispatchEvent(new Event('input')); });
    assert(await p.isHidden('#edgeWarn'), '框回到照片內，警告消失');
    await ctx.close();
  }

  // 10. 觸控：在裁切框外的空白處上下滑可以捲頁；框內拖曳移動照片；雙指縮放以手指中點為準；toast 不擋按鈕
  {
    const { ctx, p } = await open(360, 640); const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i, radiusX: 3, radiusY: 3, force: 1 })) });
    await p.click('#next1'); await p.waitForFunction(() => document.querySelector('#edHit').style.width !== '');
    const g = await p.evaluate(() => { const e = document.querySelector('#editor').getBoundingClientRect(), h = document.querySelector('#edHit').getBoundingClientRect(); return { el: e.left, et: e.top, eb: e.bottom, hl: h.left, hr: h.right, ht: h.top, hb: h.bottom, H: innerHeight }; });
    assert(await p.evaluate(() => getComputedStyle(document.querySelector('#editor')).touchAction === 'pan-y' && getComputedStyle(document.querySelector('#edHit')).touchAction === 'none'), '裁切畫面 touch-action:pan-y，只有框附近是 none');
    assert(g.eb - g.et <= 0.53 * 640 + 1, `360×640 裁切畫面高 ${Math.round(g.eb - g.et)}px（原 384）`);
    const x = (g.el + g.hl) / 2, y = Math.min(g.eb, g.H) - 30;
    const c0 = await p.evaluate(() => ({ ...__id.S.crop }));
    await T('touchStart', [[x, y]]); for (let i = 1; i <= 8; i++) await T('touchMove', [[x, y - i * 15]]); await T('touchEnd', []);
    await p.waitForFunction(() => scrollY > 20, null, { timeout: 3000 }).catch(() => {});
    const sy = await p.evaluate(() => scrollY), c1 = await p.evaluate(() => ({ ...__id.S.crop }));
    assert(sy > 20 && Math.abs(c1.cy - c0.cy) < 1, `在框外空白處往上滑捲動了 ${Math.round(sy)}px，照片不動`);
    await p.evaluate(() => new Promise(r => { let n = 0; const f = () => { scrollTo(0, 0); n = scrollY === 0 ? n + 1 : 0; n >= 5 ? r() : requestAnimationFrame(f); }; f(); }));
    const cx = (g.hl + g.hr) / 2, cy = (g.ht + g.hb) / 2;
    await T('touchStart', [[cx, cy]]); for (let i = 1; i <= 5; i++) await T('touchMove', [[cx, cy + i * 8]]); await T('touchEnd', []);
    const c2 = await p.evaluate(() => ({ ...__id.S.crop, sy: scrollY }));
    assert(c2.cy < c0.cy - 5 && c2.sy === 0, `框內拖曳移動照片（cy ${Math.round(c0.cy)}→${Math.round(c2.cy)}），頁面不捲`);
    // pinch out around a point left of centre: the photo point under the fingers stays there
    const toSrc = (X, Y) => p.evaluate(([X, Y]) => { const S = __id.S, w = document.querySelector('#editor').getBoundingClientRect(), H = w.height - 56, a = 35 / 45; let fh = H, fw = fh * a; if (fw > w.width - 56) { fw = w.width - 56; fh = fw / a; }
      const k = fh / S.crop.fh, r = -S.crop.rot * Math.PI / 180, dx = (X - w.left - w.width / 2) / k, dy = (Y - w.top - w.height / 2) / k; return { x: S.crop.cx + dx * Math.cos(r) - dy * Math.sin(r), y: S.crop.cy + dx * Math.sin(r) + dy * Math.cos(r) }; }, [X, Y]);
    const mx = cx - 50, my = cy - 40, P0 = await toSrc(mx, my), f0 = c2.fh;
    await T('touchStart', [[mx - 20, my], [mx + 20, my]]); for (let i = 1; i <= 6; i++) await T('touchMove', [[mx - 20 - i * 6, my], [mx + 20 + i * 6, my]]); await T('touchEnd', []);
    const P1 = await toSrc(mx, my), f1 = await p.evaluate(() => __id.S.crop.fh);
    assert(Math.abs(f1 / f0 - 40 / 112) < 0.03 && Math.hypot(P1.x - P0.x, P1.y - P0.y) < 4, `雙指放大 ${(f0 / f1).toFixed(2)} 倍，手指中點下的位置偏移 ${Math.hypot(P1.x - P0.x, P1.y - P0.y).toFixed(1)}px`);
    assert(await p.evaluate(() => getComputedStyle(document.querySelector('#toast')).pointerEvents === 'none'), 'toast 不攔截點擊（pointer-events:none）');
    // 11. 換白底：按下立刻有反應，處理在下一幀之後才做
    await p.evaluate(() => { document.querySelector('#bgAdv').open = true; });
    const ms = await p.evaluate(() => { __id.S.bgCache = null; const t = performance.now(); document.querySelector('#bg-white').click(); return { ms: performance.now() - t, pressed: document.querySelector('#bg-white').getAttribute('aria-pressed'), toast: document.querySelector('#toast').textContent }; });
    assert(ms.ms < 30 && ms.pressed === 'true' && ms.toast === '處理中…', `換白底按下處理 ${ms.ms.toFixed(1)}ms，先顯示「處理中…」`);
    await p.waitForFunction(() => __id.S.bgCache && __id.S.bgCache.prev || (__id.S.bgCache && __id.S.bgCache.full), null, { timeout: 15000 });
    await p.waitForFunction(() => document.querySelector('#toast').hidden || document.querySelector('#toast').textContent !== '處理中…');
    assert(true, '背景處理完成後「處理中…」消失');
    await ctx.close();
  }

  // 12. 細節：大圖縮小與「已開啟照片」同一則；結果視窗點背景或 Esc 關閉；橫式裁切框完整；↻ 標記夠大
  {
    const { ctx, p } = await open(390, 844, {}, '?noshim');
    const big = await p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 8400; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#abc'; x.fillRect(0, 0, 8400, 300);
      const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); });
    await p.setInputFiles('#fileInput', { name: 'wide.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') });
    await p.waitForFunction(() => __id.S.srcName === 'wide.png');
    const t = await toastNow(p); assert(t.includes('已開啟照片') && t.includes('已縮小至 8192×'), '大圖縮小訊息和「已開啟照片」合併：' + t);
    await p.evaluate(() => __id.goStep(3)); await p.click('#outSingle'); await p.waitForSelector('#resSheet:not([hidden])');
    await p.mouse.click(8, 8); assert(await p.isHidden('#resSheet'), '結果視窗點背景關閉');
    await p.click('#outSingle'); await p.waitForSelector('#resSheet:not([hidden])'); await p.keyboard.press('Escape'); assert(await p.isHidden('#resSheet'), '結果視窗按 Esc 關閉');
    await p.click('#outSingle'); await p.waitForSelector('#resSheet:not([hidden])'); await p.click('#resImg'); assert(await p.isVisible('#resSheet'), '點圖片本身不會關閉');
    await p.click('#resClose');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(844, 390); await p.click('#next1'); await p.waitForTimeout(80);
    const e = await p.evaluate(() => { const r = document.querySelector('#editor').getBoundingClientRect(); return { b: r.bottom, H: innerHeight, sw: document.documentElement.scrollWidth }; });
    assert(e.b <= e.H && e.sw <= 844, `844×390 裁切畫面不必捲動就完整（底 ${Math.round(e.b)} ≤ ${e.H}）`);
    await ctx.close();
  }
  {
    const { ctx, p } = await open(390, 844); await p.evaluate(() => __id.goStep(3)); await p.waitForFunction(() => __id.S.lastLayout && __id.S.lastLayout.rot);
    const it = await p.evaluate(() => __id.S.lastLayout.items.find(i => i.rot));
    const r = await p.evaluate(it => { const c = document.querySelector('#paper'), x = c.getContext('2d'), s = c.width / c.clientWidth, X0 = Math.round(it.x / 25.4 * 300), Y0 = Math.round(it.y / 25.4 * 300);
      let n = 0; for (let k = 0; k < 120; k++) { const d = x.getImageData(X0 + k, Y0 + k, 1, 1).data; if (d[2] > 120 && d[0] < 80) n++; } return n / s; }, it);
    assert(r * Math.SQRT2 >= 12, `↻ 標記在預覽上約 ${(r * Math.SQRT2).toFixed(0)}px（原約 6px）`);
    await ctx.close();
  }

  assert(errors.length === 0, '全程沒有 console／page error、沒有對外請求 ' + JSON.stringify(errors.slice(0, 3)));
  await browser.close(); srv.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
