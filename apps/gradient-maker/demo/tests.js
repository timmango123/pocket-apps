// 漸層產生器：上架評分 toFix 的回歸測試（node tests.js，約 20–40 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gradient-maker-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, KEY = 'gradient-maker:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const S = (r, g, b, a, p) => ({ c: { r, g, b, a }, p });
const L = o => Object.assign({ type: 'linear', angle: 135, shape: 'ellipse', size: 'farthest-corner', cx: 50, cy: 50, repeat: false, space: 'srgb' }, o);

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL_); await p.waitForFunction(() => window.__gm);
    return { ctx, p };
  }
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);
  const css = p => p.textContent('#cssOut');

  // ---------- 1. 匯出結果正確：重複模式第一週期、透明＋不同顏色（PNG 與 SVG 對照 Chromium 原生 CSS） ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 400 }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); await p.goto(URL_); await p.waitForFunction(() => window.__gm);
    const W = 240, H = 160;
    const cases = {
      'repeating conic #000 0% / #FFF 25%': [L({ type: 'conic', angle: 0, repeat: true, stops: [S(0, 0, 0, 1, 0), S(255, 255, 255, 1, 25)] })],
      'repeating radial #A00 0% / #FFF 20%': [L({ type: 'radial', shape: 'circle', size: 'closest-side', repeat: true, stops: [S(170, 0, 0, 1, 0), S(255, 255, 255, 1, 20)] })],
      'repeating linear hard edges (preset 條紋)': [L({ angle: 45, repeat: true, stops: [S(242, 242, 242, 1, 0), S(242, 242, 242, 1, 10), S(218, 218, 218, 1, 10), S(218, 218, 218, 1, 20)] })],
      'repeating linear first stop not at 0': [L({ angle: 90, repeat: true, stops: [S(255, 0, 0, 1, 10), S(0, 0, 255, 1, 30)] })],
      'red -> transparent blue (premultiplied)': [L({ angle: 90, stops: [S(255, 0, 0, 1, 0), S(0, 0, 255, 0, 100)] })],
      'white 50% -> black 0% overlay on blue': [L({ type: 'radial', shape: 'circle', size: 'farthest-side', stops: [S(255, 255, 255, 0.5, 0), S(0, 0, 0, 0, 100)] }), L({ angle: 0, stops: [S(20, 60, 200, 1, 0), S(20, 160, 120, 1, 100)] })],
      'oklab red -> half-transparent blue': [L({ angle: 90, space: 'oklab', stops: [S(255, 0, 0, 1, 0), S(0, 0, 255, 0.4, 100)] })],
      'oklch red -> blue': [L({ angle: 90, space: 'oklch', stops: [S(255, 0, 0, 1, 0), S(0, 0, 255, 1, 100)] })],
    };
    for (const [name, layers] of Object.entries(cases)) {
      await p.evaluate(([ls, W, H]) => { window.__gm.G = { layers: ls, sel: 0 }; let d = document.getElementById('cmp'); if (!d) { d = document.createElement('div'); d.id = 'cmp'; document.body.appendChild(d); }
        d.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;z-index:9999;background-color:#fff`; d.style.backgroundImage = window.__gm.previewBg(); }, [layers, W, H]);
      await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const shot = (await p.screenshot({ clip: { x: 0, y: 0, width: W, height: H } })).toString('base64');
      const d = await p.evaluate(async ([b64, W, H]) => {
        const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); return x; };
        const x1 = mk(); x1.drawImage(await createImageBitmap(new Blob([u], { type: 'image/png' })), 0, 0); const a = x1.getImageData(0, 0, W, H).data;
        const x2 = mk(); x2.drawImage(window.__gm.renderCanvas(W, H), 0, 0); const b = x2.getImageData(0, 0, W, H).data;
        const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.__gm.toSVG(W, H).svg); await im.decode();
        const x3 = mk(); x3.drawImage(im, 0, 0); const s = x3.getImageData(0, 0, W, H).data;
        const cmp = (P, Q) => { let sum = 0, n = 0, mx = 0; for (let y = 3; y < H; y += 6) for (let x = 3; x < W; x += 6) { const i = (y * W + x) * 4, dd = (Math.abs(P[i] - Q[i]) + Math.abs(P[i + 1] - Q[i + 1]) + Math.abs(P[i + 2] - Q[i + 2])) / 3; sum += dd; n++; if (dd > mx) mx = dd; } return { mean: +(sum / n).toFixed(2), max: +mx.toFixed(1) }; };
        return { png: cmp(a, b), svg: cmp(a, s) };
      }, [shot, W, H]);
      // hard edges land on different pixels by sub-pixel amounts, so judge mostly by the mean
      assert(d.png.mean < 2 && d.svg.mean < 2 && d.png.max < 60, `PNG/SVG 與 CSS 相符：${name}（PNG ${JSON.stringify(d.png)}，SVG ${JSON.stringify(d.svg)}）`);
    }
    // canvasStops keeps a stop that sits exactly at 0 in repeating mode (first period not overwritten by the previous period's end)
    const st = await p.evaluate(() => window.__gm.canvasStops({ type: 'conic', repeat: true, space: 'srgb', stops: [{ c: { r: 0, g: 0, b: 0, a: 1 }, p: 0 }, { c: { r: 255, g: 255, b: 255, a: 1 }, p: 25 }] }).slice(0, 3).map(s => [s.p, s.c.r]));
    assert(st[0][0] === 0 && st.some(s => s[0] === 0 && s[1] === 0) && st[2][0] > 0.2, 'canvasStops：重複模式 0% 處先白後黑（硬邊），第一週期從黑色開始 ' + JSON.stringify(st));
    await ctx.close();
  }

  // ---------- 2. 復原：隨機、預設集、移除圖層、刪除色標、拖曳中心；toast 復原鈕與 Ctrl+Z ----------
  {
    const { ctx, p } = await open();
    const c0 = await css(p);
    await p.click('#randBtn');
    assert((await css(p)) !== c0 && (await toastText(p)).includes('復原'), '隨機後 toast 附「復原」');
    await p.click('#toastAct');
    assert((await css(p)) === c0, '按 toast「復原」回到隨機前的漸層');
    await p.click('#presetBtn'); await p.click('#preset3');
    assert((await css(p)).includes('#FFD3A5'), '套用預設集「桃子」');
    await p.keyboard.press('Control+z');
    assert((await css(p)) === c0, 'Ctrl+Z 復原套用預設集');
    await p.click('#addLayer'); const two = await css(p);
    await p.click('#rmLayer'); assert(!(await css(p)).includes('radial'), '移除圖層');
    await p.keyboard.press('Control+z'); assert((await css(p)) === two, 'Ctrl+Z 復原移除圖層');
    await p.click('#layer1'); await p.click('#track', { position: { x: 100, y: 22 } });
    const three = await css(p); await p.click('#stopDel');
    assert((await css(p)) !== three && (await toastText(p)).includes('已刪除色標'), '刪除色標有 toast');
    await p.click('#toastAct'); assert((await css(p)) === three, '復原刪除色標');
    // centre drag via the centre circle, then undo
    await p.click('#layer0'); await p.evaluate(() => scrollTo(0, 0));
    const before = await p.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
    const mb = await p.locator('#centerMark').boundingBox(), pb = await p.locator('#preview').boundingBox();
    await p.mouse.move(mb.x + 22, mb.y + 22); await p.mouse.down(); await p.mouse.move(pb.x + pb.width * 0.8, pb.y + pb.height * 0.6, { steps: 5 }); await p.mouse.up();
    const after = await p.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
    assert(Math.abs(after[0] - 80) < 2 && Math.abs(after[1] - 60) < 2, '拖曳中心圓圈移動中心 ' + after);
    await p.keyboard.press('Control+z');
    const back = await p.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
    assert(back[0] === before[0] && back[1] === before[1], 'Ctrl+Z 復原中心位置 ' + back);
    await ctx.close();
  }

  // ---------- 3. 版面：預覽固定在上方、CSS 框高度固定（色條不被推動）、觸控點色條每次都新增 ----------
  {
    const { ctx, p } = await open();
    const cdp = await ctx.newCDPSession(p);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const cs = await p.$eval('#cssOut', e => { const s = getComputedStyle(e); return { wb: s.wordBreak, ow: s.overflowWrap, h: e.getBoundingClientRect().height }; });
    assert(cs.wb === 'normal' && cs.ow === 'anywhere', 'CSS 程式碼不從色碼中間切斷（word-break:normal）');
    await p.evaluate(() => { const t = document.querySelector('#track').getBoundingClientRect().top + scrollY, h = document.querySelector('#pvwrap').offsetHeight; scrollTo(0, t - h - 40); });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const pv = await p.locator('#pvwrap').boundingBox(), tb = await p.locator('#track').boundingBox();
    assert(pv.y >= -1 && pv.y < 4 && pv.height > 150, '捲到色條時預覽固定在畫面上方 ' + Math.round(pv.y) + '/' + Math.round(pv.height));
    assert(tb.y >= pv.y + pv.height, '色條沒有被預覽擋住');
    const y0 = tb.y, n0 = await p.evaluate(() => window.__gm.G.layers[0].stops.length);
    for (let i = 0; i < 16; i++) await tap(tb.x + tb.width * (0.15 + 0.045 * i), tb.y + tb.height / 2);
    await p.waitForFunction(n => window.__gm.G.layers[0].stops.length >= n + 16, n0, { timeout: 5000 }).catch(() => {});
    const n1 = await p.evaluate(() => window.__gm.G.layers[0].stops.length), y1 = (await p.locator('#track').boundingBox()).y;
    assert(n1 - n0 === 16, '觸控連點色條 16 次新增 16 個色標（' + (n1 - n0) + '）');
    assert(Math.abs(y1 - y0) < 1, 'CSS 變長後色條沒有移動（' + (y1 - y0).toFixed(1) + 'px）');
    const ord = await p.evaluate(() => ({ css: document.querySelector('#cssPanel').getBoundingClientRect().top, out: document.querySelector('#pngBtn').getBoundingClientRect().bottom, mh: getComputedStyle(document.querySelector('#cssOut')).maxHeight, h: getComputedStyle(document.querySelector('#cssOut')).height }));
    assert(ord.css > ord.out && ord.mh !== 'none', '窄直式：CSS 面板在編輯面板之後，程式碼框用 max-height ' + JSON.stringify(ord));
    // the preview lets a finger scroll the page and does not move the centre
    await p.click('#tRadial'); await p.evaluate(() => scrollTo(0, 0)); await p.waitForFunction(() => scrollY === 0);
    assert(await p.$eval('#preview', e => getComputedStyle(e).touchAction) === 'pan-y', '預覽 touch-action: pan-y');
    const c0 = await p.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
    const pb = await p.locator('#preview').boundingBox(), sx = pb.x + pb.width * 0.25, sy = pb.y + pb.height * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - i * 18 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const scrolled = await p.waitForFunction(() => scrollY > 20, null, { timeout: 3000 }).then(() => true, () => false);
    const c1 = await p.evaluate(() => [window.__gm.G.layers[0].cx, window.__gm.G.layers[0].cy]);
    assert(scrolled, '在預覽上滑動可以捲動頁面');
    assert(c1[0] === c0[0] && c1[1] === c0[1], '在預覽上滑動不會移動中心點 ' + c1);
    await ctx.close();
  }

  // ---------- 4. 存檔：剛改完就重新整理不遺失；損毀資料不當機 ----------
  {
    const { ctx, p } = await open();
    await p.click('#tRadial'); await p.fill('#cx', '77');
    assert(await p.evaluate(() => window.__gm.saving), '修改後還在 300ms 存檔延遲內');
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.evaluate(() => window.__gm.G.layers[0].cx) === 77, '改中心 X 後立刻重新整理仍是 77（pagehide 立即寫入）');
    for (const [label, bad] of [['layer 沒有 stops', { layers: [{ type: 'linear', angle: 90 }], sel: 0 }], ['stop 的 c 為 null', { layers: [{ type: 'linear', angle: 90, stops: [{ c: null, p: 0 }, { c: { r: 1, g: 2, b: 3, a: 1 }, p: 100 }] }], sel: 0 }], ['不是 JSON', '{oops']]) {
      await p.evaluate(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)), [KEY + 'current', bad]);
      const n = errors.length; await p.reload(); await p.waitForFunction(() => window.__gm);
      assert(errors.length === n && (await css(p)) === 'background: linear-gradient(135deg, #FF6B6B 0%, #4ECDC4 100%);' && (await toastText(p)).includes('損毀'), '損毀的目前漸層（' + label + '）退回預設並提示');
    }
    // missing optional fields are filled in; old saved data keeps loading
    await p.evaluate(k => localStorage.setItem(k, JSON.stringify({ layers: [{ type: 'conic', angle: 30, cx: 40, cy: 60, stops: [{ c: { r: 255, g: 0, b: 0, a: 1 }, p: 0 }, { c: { r: 0, g: 0, b: 255, a: 0.5 }, p: 100 }] }], sel: 0, stop: 0 })), KEY + 'current');
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert((await css(p)) === 'background: conic-gradient(from 30deg at 40% 60%, #FF0000 0%, rgba(0, 0, 255, 0.5) 100%);', '舊格式存檔照常載入');
    // 我的漸層 with broken entries: valid ones still listed
    await p.evaluate(k => localStorage.setItem(k, JSON.stringify([{ name: '好的', g: { layers: [{ type: 'linear', angle: 90, stops: [{ c: { r: 0, g: 0, b: 0, a: 1 }, p: 0 }, { c: { r: 255, g: 255, b: 255, a: 1 }, p: 100 }] }] } }, { name: '壞的', g: { layers: [{}] } }, null])), KEY + 'presets');
    await p.click('#presetBtn');
    assert(await p.locator('#mineList .mine').count() === 1, '我的漸層略過格式不符的項目，不當機');
    await ctx.close();
  }

  // ---------- 5. 我的漸層：匯出／匯入備份 ----------
  {
    const { ctx, p } = await open();
    await p.click('#presetBtn');
    assert(await p.isDisabled('#exportMine'), '沒有存過時「匯出備份」停用');
    await p.click('#saveMine'); await p.click('#preset0'); await p.click('#presetBtn'); await p.click('#saveMine');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#exportMine')]);
    let data = null; if (dl) { try { data = JSON.parse(fs.readFileSync(await dl.path(), 'utf8')); } catch (e) { data = null; } }
    assert(dl && /^gradient-maker-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()) && data && data.presets.length === 2, '匯出備份下載 JSON（2 組）');
    const file = path.join(DIR, 'backup.json'); fs.writeFileSync(file, JSON.stringify(data));
    await p.evaluate(k => localStorage.removeItem(k), KEY + 'presets'); await p.click('#sheetClose'); await p.click('#presetBtn');
    assert(await p.locator('#mineList .mine').count() === 0, '清空我的漸層');
    await p.setInputFiles('#importFile', file);
    await p.waitForFunction(() => document.querySelectorAll('#mineList .mine').length === 2, null, { timeout: 5000 }).catch(() => {});
    assert(await p.locator('#mineList .mine').count() === 2 && (await toastText(p)).includes('已匯入 2 組'), '匯入備份還原 2 組');
    await p.setInputFiles('#importFile', file);
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('已存在'), null, { timeout: 5000 }).catch(() => {});
    assert(await p.locator('#mineList .mine').count() === 2, '重複匯入不會重複加入');
    const badFile = path.join(DIR, 'bad.json'); fs.writeFileSync(badFile, 'not json');
    await p.setInputFiles('#importFile', badFile);
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('無法匯入'), null, { timeout: 5000 }).catch(() => {});
    assert((await toastText(p)).includes('無法匯入'), '壞檔匯入顯示原因：' + await toastText(p));
    const mixed = path.join(DIR, 'mixed.json'); fs.writeFileSync(mixed, JSON.stringify({ presets: [{ name: 'x', g: { layers: [{ stops: [] }] } }, { name: '新的', g: { layers: [{ type: 'radial', stops: [{ c: { r: 9, g: 9, b: 9, a: 1 }, p: 0 }, { c: { r: 99, g: 9, b: 9, a: 1 }, p: 100 }] }] } }] }));
    await p.setInputFiles('#importFile', mixed);
    await p.waitForFunction(() => document.querySelectorAll('#mineList .mine').length === 3, null, { timeout: 5000 }).catch(() => {});
    assert(await p.locator('#mineList .mine').count() === 3 && (await toastText(p)).includes('略過 1 組'), '部分格式不符：匯入合法的並說明略過幾組');
    await ctx.close();
  }

  // ---------- 6. 欄位：數字改寫成實際值、HEX 錯誤提示、#RGBA、同位置色標切換 ----------
  {
    const { ctx, p } = await open();
    const typeBlur = async (sel, v) => { await p.fill(sel, ''); await p.type(sel, v); await p.locator(sel).blur(); return p.$eval(sel, e => e.value); };
    assert(await typeBlur('#stopPos', '-10') === '0' && await typeBlur('#stopPos', '150') === '100', '位置 -10 → 0、150 → 100（離開欄位後顯示實際值）');
    assert(await typeBlur('#angle', '-30') === '330' && await typeBlur('#angle', '720') === '0' && await typeBlur('#angle', '12.7') === '13', '角度 -30 → 330、720 → 0、12.7 → 13');
    await p.click('#tRadial');
    assert(await typeBlur('#cx', '150') === '100' && await typeBlur('#cy', '-5') === '0', '中心 X 150 → 100、Y -5 → 0');
    await p.click('#tLinear');
    await p.fill('#stopHex', ''); await p.type('#stopHex', '#ZZ');
    assert(await p.isVisible('#hexErr') && await p.$eval('#stopHex', e => e.getAttribute('aria-invalid')) === 'true', 'HEX 打入無效字元立刻紅框＋說明');
    await p.fill('#stopHex', ''); await p.type('#stopHex', '#12');
    assert(!(await p.isVisible('#hexErr')), '還在輸入中（#12）不提示');
    await p.locator('#stopHex').blur();
    assert(!(await p.isVisible('#hexErr')) && (await p.$eval('#stopHex', e => e.value)) === '#FF6B6B' && (await toastText(p)).includes('已還原'), '離開時格式不完整：還原原本色碼、錯誤框消失並以 toast 說明');
    await p.fill('#stopHex', '#1234567890');
    assert(await p.isVisible('#hexErr') && await p.$eval('#stopHex', e => e.value) === '#1234567890' && await p.evaluate(() => window.__gm.G.layers[0].stops[0].c.r) === 255, '貼上 10 碼以上 HEX 不被截斷套用，顯示錯誤');
    await p.fill('#stopHex', ''); await p.type('#stopHex', '#123456');
    const c0 = () => p.evaluate(() => JSON.stringify(window.__gm.G.layers[0].stops[0].c));
    assert(!(await p.isVisible('#hexErr')) && (await c0()) === '{"r":18,"g":52,"b":86,"a":1}', '逐字輸入 #123456 → 不透明 #123456（不被中途的 #1234 改透明度）');
    await p.fill('#stopHex', '#ABCD');
    assert((await c0()) === '{"r":170,"g":187,"b":204,"a":0.87}', '#RGBA 四碼套用透明度');
    // two stops at the same position: tapping the selected one switches to the other
    await p.click('#presetBtn'); await p.click('#preset21'); await p.click('#tLinear');
    const sel = () => p.evaluate(() => [...document.querySelectorAll('.handle')].findIndex(h => h.getAttribute('aria-pressed') === 'true'));
    await p.evaluate(() => document.querySelector('#handles').scrollIntoView({ block: 'center' }));
    const hb = await p.locator('#stop1').boundingBox();
    await p.mouse.click(hb.x + 22, hb.y + 22); const s1 = await sel();
    assert([1, 2].includes(s1) && (await toastText(p)).includes('再點一下切換'), '點到重疊色標時提示可再點切換（選中 ' + s1 + '）');
    await p.mouse.click(hb.x + 22, hb.y + 22); const s2 = await sel();
    await p.mouse.click(hb.x + 22, hb.y + 22); const s3 = await sel();
    assert([1, 2].includes(s2) && s2 !== s1 && s3 === s1, '再點一下在同位置的兩個色標之間切換 ' + [s1, s2, s3]);
    assert(await p.evaluate(() => window.__gm.G.layers[0].stops.map(s => s.p).join()) === '0,10,10,20', '點選不會改到色標位置');
    await ctx.close();
  }

  // ---------- 7. 細節：輸出尺寸記住、0 夾到 16、產生中狀態、主題圖示 ----------
  {
    const { ctx, p } = await open();
    await p.selectOption('#outSize', 'custom'); await p.fill('#outW', '0'); await p.locator('#outW').blur(); await p.fill('#outH', '720'); await p.locator('#outH').blur();
    assert(await p.$eval('#outW', e => e.value) === '16', '自訂寬度 0 → 16');
    await p.fill('#outW', '1600'); await p.locator('#outW').blur();
    await p.waitForFunction(k => { try { const o = JSON.parse(localStorage.getItem(k)); return o && o.size === 'custom' && o.w === 1600 && o.h === 720; } catch (e) { return false; } }, KEY + 'out', { timeout: 5000 }).catch(() => {});
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.$eval('#outSize', e => e.value) === 'custom' && await p.$eval('#outW', e => e.value) === '1600' && await p.$eval('#outH', e => e.value) === '720' && await p.isVisible('#customRow'), '重新整理後記得自訂 1600×720');
    await p.fill('#outW', '4000'); await p.fill('#outH', '4000');
    await p.evaluate(() => { window.__busySeen = null; new MutationObserver(() => { const b = document.querySelector('#pngBtn'); if (b.disabled && window.__busySeen == null) window.__busySeen = b.textContent; }).observe(document.querySelector('#pngBtn'), { attributes: true, childList: true, characterData: true, subtree: true }); });
    await p.click('#pngBtn');
    await p.waitForSelector('#ov:not([hidden])', { timeout: 30000 });
    assert(await p.evaluate(() => window.__busySeen) === '產生中…' && !(await p.isDisabled('#pngBtn')), '產生 PNG 時按鈕顯示「產生中…」並停用，完成後恢復');
    await p.click('#ovClose');
    const icons = [];
    for (let i = 0; i < 3; i++) { icons.push(await p.$eval('#themeBtn svg', s => s.innerHTML)); await p.click('#themeBtn'); }
    assert(new Set(icons).size === 3, '主題按鈕三種狀態圖示都不同');
    await ctx.close();
  }

  // ---------- 9. 色標數上限：點色條最多 64 個；1000 個色標的舊存檔重新整理後保留前 64 個 ----------
  {
    const { ctx, p } = await open();
    await p.evaluate(() => { const t = document.querySelector('#track'), r = t.getBoundingClientRect(); for (let i = 0; i < 1000; i++) t.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width * ((i % 97) + 1) / 99, clientY: r.top + 5 })); });
    assert(await p.evaluate(() => window.__gm.G.layers[0].stops.length) === 64 && (await toastText(p)).includes('最多 64'), '點色條 1000 次：停在 64 個色標並提示');
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.evaluate(() => window.__gm.G.layers[0].stops.length) === 64, '64 個色標重新整理後還在');
    const big = { layers: [{ type: 'linear', angle: 90, stops: Array.from({ length: 1000 }, (_, i) => ({ c: { r: i % 256, g: 0, b: 0, a: 1 }, p: i / 10 })) }], sel: 0 };
    await p.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [KEY + 'current', big]);
    await p.reload(); await p.waitForFunction(() => window.__gm);
    const r = await p.evaluate(() => [window.__gm.G.layers[0].angle, window.__gm.G.layers[0].stops.length, window.__gm.G.layers[0].stops[63].p]);
    assert(r[0] === 90 && r[1] === 64 && r[2] === 6.3 && (await toastText(p)).includes('最多 64'), '1000 個色標的存檔不被丟掉，保留前 64 個並提示 ' + r);
    const file = path.join(DIR, 'big.json'); fs.writeFileSync(file, JSON.stringify({ presets: [{ name: '大', g: big }] }));
    await p.click('#presetBtn'); await p.setInputFiles('#importFile', file);
    await p.waitForFunction(() => document.querySelectorAll('#mineList .mine').length === 1, null, { timeout: 5000 }).catch(() => {});
    assert(await p.evaluate(k => JSON.parse(localStorage.getItem(k))[0].g.layers[0].stops.length, KEY + 'presets') === 64 && (await toastText(p)).includes('最多 64'), '匯入 1000 個色標的備份：保留前 64 個並說明');
    await ctx.close();
  }

  // ---------- 10. 360×640：「復原」toast 在預覽下緣，不蓋住類型按鈕，只有按鈕可點 ----------
  {
    const { ctx, p } = await open(360, 640);
    for (const y of [0, 400]) {
      await p.evaluate(y => scrollTo(0, y), y); await p.click('#randBtn');
      const g = await p.evaluate(() => { const t = document.querySelector('#toast').getBoundingClientRect(), v = document.querySelector('#pvwrap').getBoundingClientRect();
        const hit = id => { const b = document.querySelector(id).getBoundingClientRect(); return !(b.right <= t.left || b.left >= t.right || b.bottom <= t.top || b.top >= t.bottom); };
        const under = document.elementFromPoint(t.left + 4, t.top + t.height / 2);
        return { inPv: t.top >= v.top - 1 && t.bottom <= v.bottom + 1, cover: ['#tLinear', '#tRadial', '#tConic', '#track', '#stopHex'].filter(hit), passThrough: !document.querySelector('#toast').contains(under), btn: getComputedStyle(document.querySelector('#toastAct')).pointerEvents }; });
      assert(g.inPv && !g.cover.length && g.passThrough && g.btn === 'auto', `捲動 ${y}：toast 在固定預覽下緣、不蓋控制項、空白處點擊穿透 ` + JSON.stringify(g));
      await p.click('#toastAct');
    }
    await ctx.close();
  }

  // ---------- 11. 輸入中就存輸出尺寸；預覽上的「複製 CSS」；HEX 無效時還原成聚焦前的完整顏色 ----------
  {
    const { ctx, p } = await open();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await p.selectOption('#outSize', 'custom'); await p.fill('#outW', '1600'); await p.fill('#outH', '720');
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.$eval('#outW', e => e.value) === '1600' && await p.$eval('#outH', e => e.value) === '720', '沒離開欄位就重新整理，仍記得 1600×720');
    await p.focus('#outH'); await p.keyboard.press('End'); await p.keyboard.press('Backspace'); await p.keyboard.type('5');
    await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert(await p.evaluate(k => JSON.parse(localStorage.getItem(k)).h, KEY + 'out') === 725, '切到背景時也寫入輸出尺寸（725）');
    await p.reload(); await p.waitForFunction(() => window.__gm);
    // copy button on the pinned preview (phones)
    await p.evaluate(() => scrollTo(0, 600));
    const cb = await p.evaluate(() => { const b = document.querySelector('#pvCopyBtn').getBoundingClientRect(), v = document.querySelector('#pvwrap').getBoundingClientRect(); return { inPv: b.top >= v.top && b.bottom <= v.bottom && b.left >= v.left && b.right <= v.right, top: v.top, w: b.width, h: b.height }; });
    assert(cb.inPv && Math.abs(cb.top) < 2 && cb.w >= 44 && cb.h >= 44, '手機：固定預覽上有「複製 CSS」按鈕（捲動後仍可按）' + JSON.stringify(cb));
    await p.click('#pvCopyBtn');
    await p.waitForFunction(() => document.querySelector('#toast').textContent.includes('複製'), null, { timeout: 5000 }).catch(() => {});
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
    assert((await toastText(p)).includes('已複製') && clip === await css(p), '預覽上的「複製 CSS」複製目前 CSS');
    // HEX: invalid entry restores the colour (with alpha) the stop had when the field was focused
    await p.evaluate(() => scrollTo(0, 0));
    await p.fill('#stopAlpha', '50');
    const orig = await p.evaluate(() => JSON.stringify(window.__gm.G.layers[0].stops[0].c));
    for (const typed of ['#1234Z', '#12345']) {
      await p.focus('#stopHex'); await p.fill('#stopHex', ''); await p.keyboard.type(typed);
      const mid = await p.evaluate(() => window.__gm.G.layers[0].stops[0].c.r);
      await p.locator('#stopHex').blur();
      const now = await p.evaluate(() => JSON.stringify(window.__gm.G.layers[0].stops[0].c));
      assert(mid === 0x11 && now === orig && (await p.$eval('#stopHex', e => e.value)) === '#FF6B6B', `HEX 打「${typed}」（中途套用了 #1234）離開後還原成原本的顏色與透明度 ${now}`);
    }
    await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.evaluate(() => JSON.stringify(window.__gm.G.layers[0].stops[0].c)) === orig, '還原後的顏色有存檔');
    await ctx.close();
    const d = await open(1280, 800, { isMobile: false, hasTouch: false });
    assert(!(await d.p.isVisible('#pvCopyBtn')) && await d.p.isVisible('#copyBtn'), '桌面兩欄：預覽上不重複顯示複製鈕');
    await d.ctx.close();
  }

  // ---------- 8. 版面：360 寬沒有橫向捲動、按鈕 ≥44 ----------
  for (const [w, h] of [[360, 640], [844, 390]]) {
    const { ctx, p } = await open(w, h);
    await p.click('#addLayer'); await p.click('#presetBtn');
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth <= innerWidth, small: [...document.querySelectorAll('button')].filter(b => b.offsetParent && (b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < 44)).map(b => b.id || b.textContent) }));
    assert(m.sw && !m.small.length, `${w}×${h} 沒有橫向捲動、按鈕都 ≥44（${m.small}）`);
    await ctx.close();
  }

  await browser.close(); fs.rmSync(DIR, { recursive: true, force: true });
  assert(!errors.length, '沒有 page error / console error ' + errors.slice(0, 3).join(' | '));
  console.log(fails ? `FAIL ${fails} 項失敗` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
