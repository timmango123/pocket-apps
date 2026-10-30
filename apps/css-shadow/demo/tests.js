// 陰影與圓角：上架評分 9.5 重審的回歸測試（node tests.js，約 30 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
// 頁面由本機 http 伺服器提供（file:// 重新載入時 Chromium 可能丟掉 localStorage 寫入）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(HTML); });
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];

// in the page: apply the copied CSS text to a fresh 160×160 element and compare computed styles with the preview card
const SAME = () => {
  const box = document.getElementById('box'), txt = window.__cs.cssText(), bad = [];
  const el = document.createElement('div'); el.style.cssText = 'position:absolute;left:-9999px;top:0;width:160px;height:160px;box-sizing:border-box';
  for (const line of txt.split('\n')) {
    const m = line.match(/^(-?[a-z-]+): (.+);$/); if (!m) { bad.push('bad line ' + line); continue; }
    el.style.setProperty(m[1], m[2]); if (!el.style.getPropertyValue(m[1]) && !/^-webkit-/.test(m[1])) bad.push('invalid ' + line);   // a -webkit- alias this engine lacks is just ignored
    if (/box-shadow$/.test(m[1]) && (/,\s*$|,,|^\s*,/.test(m[2]) || !CSS.supports('box-shadow', m[2]))) bad.push('shadow ' + m[2]);
  }
  document.body.appendChild(el);
  const a = getComputedStyle(el), b = getComputedStyle(box);
  for (const k of ['boxShadow', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius', 'backgroundColor', 'backdropFilter', 'borderTopWidth', 'borderTopStyle', 'borderTopColor'])
    if (a[k] !== b[k] && !(k === 'borderTopColor' && a.borderTopStyle === 'none')) bad.push(`${k}: css=${a[k]} preview=${b[k]}`);   // no border: its colour is just the text colour
  el.remove(); return bad;
};

(async () => {
  srv.listen(0); srv.unref();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, fresh = true) {
    const ctx = opt.ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...(opt.ctxOpt || {}) });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (opt.init) await p.addInitScript(opt.init);
    await p.goto(URL); await p.waitForFunction(() => window.__csReady);
    if (fresh) await p.evaluate(() => { localStorage.clear(); });
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const settle = () => p.evaluate(() => new Promise(r => { let last = scrollY, same = 0; const f = () => { if (scrollY === last) same++; else { same = 0; last = scrollY; } same >= 10 ? r() : requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const show = async sel => { await p.$eval(sel, e => e.scrollIntoView({ block: 'end' })); await settle(); };
    // tap and wait until the click has arrived (not a fixed sleep)
    const tap = async sel => {
      await show(sel);
      await p.$eval(sel, e => { window.__clk = 0; e.addEventListener('click', () => { window.__clk = 1; }, { once: true }); });
      const q = await center(sel); await touch('touchStart', [q]); await touch('touchEnd', []);
      await p.waitForFunction(() => window.__clk === 1); await frames();
    };
    const S = () => p.evaluate(() => window.__cs.S);
    const css = () => p.evaluate(() => window.__cs.cssText());
    const setS = async s => { await p.evaluate(s => { window.__cs.S = s; }, s); await frames(); await p.evaluate(() => window.__cs.commit()); };
    return { ctx, p, touch, frames, settle, center, show, tap, S, css, setS };
  }

  // 1. 輸出的 CSS 套到測試元素上，computed style 與預覽方塊完全相同（多層、inset、擴散、負位移、小數、透明度、單位、橢圓 %、玻璃）
  {
    const t = await open();
    eq(await t.p.evaluate(SAME), [], '預設：輸出 CSS 與預覽 computed style 相同');
    const base = await t.S();
    const L = (x, y, blur, spread, c, inset, visible = true) => ({ x, y, blur, spread, color: c, inset, visible });
    await t.setS({ ...base, layers: [L(-3.5, -12, 0, 4, { r: 10, g: 20, b: 30, a: .333 }, true), L(10, 20.25, 30, -8, { r: 12, g: 34, b: 56, a: 1 }, false), L(5, 5, 5, 5, { r: 0, g: 0, b: 0, a: .5 }, false, false), L(0, 0, 0, 0, { r: 255, g: 0, b: 0, a: 0 }, false)] });
    let out = await t.css();
    assert(out.includes('box-shadow: inset -3.5px -12px 0 4px rgba(10, 20, 30, 0.333), 10px 20.25px 30px -8px #0c2238, 0 0 0 0 rgba(255, 0, 0, 0);'), '多層 + inset + 負位移 + 小數 + 透明度 0，隱藏層不輸出：' + out.split('\n').pop());
    eq(await t.p.evaluate(SAME), [], '多層：輸出 CSS 與預覽相同');
    // import with hex alpha, rem, negative fractions
    await t.p.click('details summary');
    await t.p.fill('#importTxt', 'box-shadow: inset 0 0 0 1px #ff000080, -2px -.5px 3px rgba(0,0,255,.25), 0 .25rem 1rem hsl(200 50% 40% / .4);');
    await t.p.click('#importBtn'); await t.frames();
    out = await t.css();
    assert(/box-shadow: inset 0 0 0 1px rgba\(255, 0, 0, 0\.50?2?\), -2px -0\.5px 3px 0 rgba\(0, 0, 255, 0\.25\), 0 4px 16px 0 rgba\(51, 119, 153, 0\.4\);/.test(out), '匯入 #rrggbbaa、rem、負小數：' + out.split('\n').pop());
    eq(await t.p.evaluate(SAME), [], '匯入後：輸出 CSS 與預覽相同');
    // radius: % with decimals, 8 values
    await t.p.click('#mRadius');
    await t.p.fill('#radTxt', '10.7% 30% 0 45% / 5% 50% 33.3% 0'); await t.p.click('#radApply'); await t.frames();
    eq(await t.p.evaluate(() => window.__cs.radiusStr()), '10.7% 30% 0 45% / 5% 50% 33.3% 0', '橢圓 8 值 % 含小數 round-trip');
    eq(await t.p.evaluate(SAME), [], '圓角 %：輸出 CSS 與預覽相同（以前預覽用 px、輸出用 % 會有誤差）');
    await t.p.click('#uPx'); await t.frames();
    eq(await t.p.evaluate(SAME), [], '圓角 px：輸出 CSS 與預覽相同');
    // radius over half the box
    await t.p.fill('#radTxt', '120px'); await t.p.click('#radApply'); await t.frames();
    eq(await t.p.evaluate(SAME), [], '圓角大於方塊一半：輸出 CSS 與預覽相同');
    // glass + prefix
    await t.p.click('#mGlass'); await t.p.check('#optPrefix'); await t.frames();
    out = await t.css();
    assert(out.includes('-webkit-backdrop-filter: blur(12px) saturate(160%);') && out.includes('-webkit-box-shadow:'), '前綴選項輸出 -webkit-');
    eq(await t.p.evaluate(SAME), [], '玻璃：背景、backdrop-filter、邊框、陰影與預覽相同');
    // all hidden -> none
    await t.p.click('#mShadow'); await t.p.uncheck('#optPrefix');
    const s2 = await t.S(); s2.layers.forEach(l => { l.visible = false; }); await t.setS(s2);
    assert((await t.css()).includes('box-shadow: none;'), '全部隱藏輸出 box-shadow: none');
    eq(await t.p.evaluate(SAME), [], '全部隱藏：輸出與預覽相同');
    await t.ctx.close();
  }

  // 2. 數值框：可輸入負數、小數、全形數字、超出滑桿範圍；iOS 用有負號的鍵盤
  {
    const t = await open();
    eq(await t.p.$eval('#lxn', e => [e.type, e.inputMode]), ['number', ''], 'X 偏移（可為負）用 type=number：iOS 出現有負號的鍵盤');
    eq(await t.p.$eval('#lbn', e => [e.type, e.inputMode]), ['text', 'decimal'], '模糊（不為負）用小數鍵盤');
    await t.p.fill('#lxn', '-12.5'); await t.frames();
    eq((await t.S()).layers[0].x, -12.5, '輸入 -12.5 → X = -12.5');
    assert((await t.css()).includes('box-shadow: -12.5px 4px'), '輸出含 -12.5px');
    await t.p.fill('#lxn', '150'); await t.frames();
    eq([(await t.S()).layers[0].x, await t.p.$eval('#lx', e => e.value)], [150, '100'], '輸入超出滑桿範圍 150：值照用，滑桿停在 100');
    await t.p.fill('#lbn', '１２．５'); await t.frames();
    eq((await t.S()).layers[0].blur, 12.5, '全形「１２．５」→ 12.5');
    await t.p.fill('#lbn', '-7'); await t.frames();
    eq((await t.S()).layers[0].blur, 0, '模糊輸入負數 → 0');
    await t.p.fill('#lbn', '9'); await t.p.fill('#lbn', 'abc'); await t.p.locator('#lbn').blur(); await t.frames();
    eq([(await t.S()).layers[0].blur, await t.p.$eval('#lbn', e => e.value)], [9, '9'], '輸入無效文字：數值不變，離開時框內還原');
    await t.p.fill('#lan', '33.3'); await t.p.locator('#lan').blur(); await t.frames();
    assert((await t.css()).includes('rgba(0, 0, 0, 0.333)'), '透明度 33.3% → 0.333');

    // 3. ± 按鈕：點一下剛好一步；按住連續；從按鈕開始捲動不改值
    await t.p.fill('#lbn', '6'); await t.p.locator('#lbn').blur(); await t.frames();
    const plus = '#layerCtl .ctl:nth-child(3) .pm:nth-of-type(2)';
    for (let i = 0; i < 5; i++) await t.tap(plus);
    eq((await t.S()).layers[0].blur, 11, 'CDP 觸控點 ＋ 五次：每次剛好 +1');
    await t.show(plus); let q = await t.center(plus);
    await t.touch('touchStart', [q]); await t.p.waitForFunction(() => window.__cs.S.layers[0].blur >= 15); await t.touch('touchEnd', []);
    await t.frames(); const held = (await t.S()).layers[0].blur; await t.p.waitForTimeout(300);
    assert(held >= 15 && (await t.S()).layers[0].blur === held, `按住 ＋ 連續增加，放開即停（${held}）`);
    await t.show(plus); q = await t.center(plus); const y0 = await t.p.evaluate(() => scrollY), b0 = (await t.S()).layers[0].blur;
    await t.touch('touchStart', [q]); for (let k = 1; k <= 12; k++) await t.touch('touchMove', [[q[0] + 1, q[1] - k * 16]]);
    await t.touch('touchEnd', []); await t.settle();
    const y1 = await t.p.evaluate(() => scrollY);
    assert(y1 > y0 + 40, `從 ＋ 按鈕往上滑會捲動頁面（${y0}→${y1}）`);
    eq((await t.S()).layers[0].blur, b0, '從 ＋ 按鈕往上滑：數值不變');

    // 4. 從滑桿軌道往上滑捲動頁面，數值不跳
    await t.show('#lb'); const r = await t.p.$eval('#lb', e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
    const sq = [r[0] + r[2] * .85, r[1] + r[3] / 2], sy0 = await t.p.evaluate(() => scrollY), sb = (await t.S()).layers[0].blur;
    await t.touch('touchStart', [sq]); for (let k = 1; k <= 12; k++) await t.touch('touchMove', [[sq[0] + 1, sq[1] - k * 16]]);
    await t.touch('touchEnd', []); await t.settle(); await t.frames();
    assert(await t.p.evaluate(() => scrollY) > sy0 + 40, '從滑桿往上滑會捲動頁面');
    eq((await t.S()).layers[0].blur, sb, '從滑桿往上滑：數值沒有跳到手指位置');
    // horizontal drag still works and is one undo step
    const before = (await t.S()).layers[0].blur;
    await t.show('#lb'); const r2 = await t.p.$eval('#lb', e => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
    const x0 = r2[0] + 8 + (r2[2] - 16) * before / 150, yy = r2[1] + r2[3] / 2;
    await t.touch('touchStart', [[x0, yy]]); for (let k = 1; k <= 8; k++) await t.touch('touchMove', [[x0 + k * 6, yy]]);
    await t.touch('touchEnd', []); await t.frames();
    const after = (await t.S()).layers[0].blur;
    assert(after > before + 10, `水平拖曳滑桿照常調整（${before}→${after}）`);
    await t.p.waitForFunction(() => window.__cs.hist.past > 0);
    await t.tap('#undoBtn'); eq((await t.S()).layers[0].blur, before, '「復原」把整次滑桿拖曳還原成一步');
    await t.tap('#redoBtn'); eq((await t.S()).layers[0].blur, after, '「重做」再套用');
    await t.ctx.close();
  }

  // 5. 圖層：刪除／上移／下移／複製／預設風格／雙擊重設都可復原
  {
    const t = await open();
    const s0 = await t.S(), out0 = await t.css();
    await t.tap('#l0del');
    eq((await t.S()).layers.length, 1, '刪除第 1 層');
    assert(/已刪除第 1 層/.test(await t.p.textContent('#toast')), '刪除提示可復原');
    await t.tap('#undoBtn'); eq([(await t.S()).layers, await t.css()], [s0.layers, out0], '復原刪除：圖層與輸出完全還原');
    await t.tap('#layer1'); await t.tap('#layUp');
    let s = await t.S();
    eq([s.sel, s.layers[0].y, s.layers[1].y], [0, 2, 4], '選第 2 層按「上移」：順序對調、仍選著它');
    assert((await t.css()).includes('box-shadow: 0 2px 4px -2px rgba(0, 0, 0, 0.1), 0 4px 6px -1px'), '輸出順序跟著改');
    assert(await t.p.$eval('#layUp', e => e.disabled) && !await t.p.$eval('#layDown', e => e.disabled), '第一層時「上移」停用、「下移」可用');
    await t.tap('#layDown'); eq((await t.S()).layers.map(l => l.y), [4, 2], '「下移」換回來');
    await t.tap('#layDup'); s = await t.S();
    eq([s.layers.length, s.sel, s.layers[2].y], [3, 2, 2], '「複製此層」插在後面並選取');
    await t.tap('#undoBtn'); await t.tap('#undoBtn'); await t.tap('#undoBtn');
    eq((await t.S()).layers, s0.layers, '連按三次復原回到最初');
    await t.tap('#preset0'); assert((await t.css()).includes('box-shadow: 0 10px 30px -12px'), '套用「柔和」');
    await t.tap('#undoBtn'); eq((await t.S()).layers, s0.layers, '復原預設風格');
    for (let i = 0; i < 6; i++) if (!await t.p.$eval('#addLayer', e => e.disabled)) await t.tap('#addLayer');
    eq([(await t.S()).layers.length, await t.p.$eval('#addLayer', e => e.disabled), await t.p.$eval('#layDup', e => e.disabled)], [6, true, true], '最多 6 層：新增與複製停用');
    // double tap on card resets, undoable
    await t.p.evaluate(() => scrollTo(0, 0)); await t.settle();
    const bq = await t.center('#box');
    await t.touch('touchStart', [bq]); await t.touch('touchEnd', []); await t.touch('touchStart', [bq]); await t.touch('touchEnd', []);
    await t.p.waitForFunction(() => /已重設/.test(document.getElementById('toast').textContent));
    eq((await t.S()).layers.length, 2, '觸控雙擊方塊：重設為預設');
    await t.tap('#undoBtn'); eq((await t.S()).layers.length, 6, '復原重設');
    // keyboard
    await t.p.mouse.click(5, 5); await t.p.keyboard.press('Control+z'); await t.frames();
    eq((await t.S()).layers.length, 5, 'Ctrl+Z 復原');
    await t.p.keyboard.press('Control+Shift+z'); await t.frames();
    eq((await t.S()).layers.length, 6, 'Ctrl+Shift+Z 重做');
    await t.ctx.close();
  }

  // 6. 光源拖曳：保留各層透明度、距離比例與模糊比例
  {
    const t = await open();
    await t.p.click('#preset6'); await t.frames();   // Material 3: 0 6px 12px .14, 0 3px 6px .12
    await t.p.evaluate(() => scrollTo(0, 0)); await t.settle();
    const st = await t.p.locator('#stage').boundingBox(), lb = await t.p.locator('#lamp').boundingBox();
    await t.p.mouse.move(lb.x + 22, lb.y + 22); await t.p.mouse.down();
    await t.p.mouse.move(st.x + st.width / 2 - 100, st.y + st.height / 2 - 100, { steps: 5 }); await t.p.mouse.up(); await t.frames();
    const s = await t.S();
    eq(s.layers.map(l => [l.x, l.y, l.blur, l.color.a]), [[15, 15, 42, .14], [8, 8, 23, .12]], '光源拖到左上：第 1 層 (15,15)、第 2 層保持一半距離，模糊按比例、透明度不變');
    eq(await t.p.evaluate(SAME), [], '拖曳後輸出與預覽相同');
    await t.ctx.close();
  }

  // 7. 複製：Clipboard API、execCommand 備援、都被擋時選取文字
  {
    const t = await open(390, 844, { ctxOpt: { permissions: ['clipboard-read', 'clipboard-write'] } });
    await t.tap('#copyBtn');
    await t.p.waitForFunction(() => document.getElementById('copyBtn').textContent === '已複製 ✓');
    eq(await t.p.evaluate(() => navigator.clipboard.readText()), await t.css(), 'Clipboard API：剪貼簿內容 = 輸出 CSS，按鈕顯示「已複製 ✓」');
    await t.p.evaluate(() => { navigator.clipboard.writeText = () => new Promise(() => {}); window.__ex = 0; document.execCommand = c => { window.__ex++; return c === 'copy'; }; document.getElementById('copyBtn').textContent = '複製'; });
    await t.tap('#copyBtn');
    await t.p.waitForFunction(() => document.getElementById('copyBtn').textContent === '已複製 ✓', null, { timeout: 5000 });
    eq(await t.p.evaluate(() => window.__ex), 1, 'Clipboard API 卡住：1.5 秒後改用 execCommand 複製');
    await t.p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('blocked')); document.execCommand = () => false; });
    await t.tap('#copyBtn');
    await t.p.waitForFunction(() => /已選取文字/.test(document.getElementById('toast').textContent));
    eq(await t.p.evaluate(() => getSelection().toString()), await t.css(), '兩種都被擋：選取整段 CSS 並提示手動拷貝');
    await t.p.check('#optTw'); await t.frames();
    const tw = await t.css();
    assert(/^bg-\[#ffffff\] rounded-\[16px\] shadow-\[0_4px_6px_-1px_rgba\(0,0,0,0\.1\),0_2px_4px_-2px_rgba\(0,0,0,0\.1\)\]$/.test(tw), 'Tailwind 任意值輸出：' + tw);
    await t.ctx.close();
  }

  // 8. 儲存：馬上重新整理也不遺失（pagehide 寫入）；損壞的資料被驗證
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let t = await open(390, 844, { ctx });
    await t.p.fill('#lyn', '-33'); await t.p.reload(); await t.p.waitForFunction(() => window.__csReady);
    eq((await t.S()).layers[0].y, -33, '輸入後立刻重新整理：數值已存（pagehide 寫入）');
    await t.p.close();
    // corrupt values are written before the app script runs (only on the first load of that page)
    const plant = (state, mine) => `if (!sessionStorage.planted) { sessionStorage.planted = 1; localStorage.setItem('css-shadow:v1:state', ${JSON.stringify(state)}); ${mine ? `localStorage.setItem('css-shadow:v1:mine', ${JSON.stringify(mine)});` : ''} }`;
    t = await open(390, 844, { ctx, init: plant(JSON.stringify({ mode: 'x', sel: 9, boxBg: 'red;background:url(x)', layers: [{ x: '1e9', y: null, blur: -5, spread: 'a', color: { r: 999, g: -4, b: 3.6, a: 7 } }, 5, null, { x: 1, y: 2, inset: 'yes' }], radius: { h: [1, 2], unit: 'em', linked: true, adv: true, v: [1, 2, 3, 4] }, glass: { blur: 'NaN', sat: 1e6, color: '#12' }, bg: { type: 'video', color: 'blue' }, opts: { tw: 1 } }),
      JSON.stringify([{ name: '<img src=x onerror=window.__xss=1>', s: { layers: 'x' } }, 7, { s: null }])) }, false);
    const s = await t.S();
    eq([s.mode, s.sel, s.boxBg, s.layers.length, s.layers[0], s.layers[1].inset, s.radius.h, s.radius.v, s.radius.linked, s.glass.blur, s.glass.sat, s.glass.color, s.bg.type, s.opts.tw],
      ['shadow', 1, '#ffffff', 2, { x: 500, y: 0, blur: 0, spread: 0, color: { r: 255, g: 0, b: 4, a: 1 }, inset: false, visible: true }, false, [16, 16, 16, 16], [1, 2, 3, 4], false, 12, 300, '#ffffff', 'solid', false], '損壞的儲存值逐欄驗證、夾到範圍內');
    eq([await t.p.locator('#mine .pre').count(), await t.p.locator('#mine img').count(), await t.p.evaluate(() => window.__xss || 0)], [1, 0, 0], '我的樣式：無效項目略過，名稱以文字顯示');
    eq(await t.p.evaluate(SAME), [], '驗證後輸出與預覽相同');
    await t.p.close();
    t = await open(390, 844, { ctx, init: plant('{not json') }, false);
    assert((await t.css()).includes('0 4px 6px -1px'), '無法解析的儲存值：回到預設');
    await ctx.close();
  }

  // 9. 版面：直向時預覽固定在上方、橫向時預覽與控制項並排；觸控目標 ≥ 44px；淺色深色文字對比
  for (const [w, h, scheme] of [[390, 844, 'light'], [390, 664, 'dark'], [844, 390, 'light'], [667, 375, 'dark']]) {
    const t = await open(w, h, { ctxOpt: { colorScheme: scheme } });
    await t.p.$eval('#la', e => e.scrollIntoView({ block: 'center' })); await t.settle(); await t.frames();
    const v = await t.p.evaluate(() => {
      const st = document.getElementById('stage').getBoundingClientRect(), la = document.getElementById('la').getBoundingClientRect(), box = document.getElementById('box').getBoundingClientRect();
      const hit = document.elementFromPoint(la.left + la.width / 2, la.top + la.height / 2);
      return { stTop: st.top, stBot: st.bottom, boxIn: box.top >= Math.max(0, st.top) - 1 && box.bottom <= Math.min(innerHeight, st.bottom) + 1, laOk: hit === document.getElementById('la'), laIn: la.top >= 0 && la.bottom <= innerHeight, ov: document.documentElement.scrollWidth - innerWidth };
    });
    assert(v.stTop >= -1 && v.stBot <= h + 1 && v.boxIn && v.laOk && v.laIn && v.ov <= 0, `${w}×${h}：捲到「透明度」時預覽方塊仍完整可見，滑桿沒被蓋住 ${JSON.stringify(v)}`);
    const small = await t.p.evaluate(() => [...document.querySelectorAll('button, input[type=range], input[type=color], .nv, label.chk, summary')].filter(e => {
      if (!e.offsetParent && getComputedStyle(e).position !== 'fixed') return false; const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 43.5 || r.height < 43.5);
    }).map(e => e.id || e.className || e.tagName));
    eq(small, [], `${w}×${h}：可見的觸控目標都 ≥ 44px`);
    const low = await t.p.evaluate(() => {
      const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      const bgOf = e => { for (; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > .9)) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
      return [...document.querySelectorAll('.small, .ctl label, .nv i, .nv input, .ph h2, .lrow .pick span, .seg button, .btn, pre.code')].filter(e => e.offsetParent && e.textContent.trim() || e.value).map(e => {
        const c = rgb(getComputedStyle(e).color), b = bgOf(e), l1 = lum(c), l2 = lum(b), r = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
        return [e.className || e.tagName, Math.round(r * 10) / 10];
      }).filter(x => x[1] < 4.5);
    });
    eq(low, [], `${w}×${h} ${scheme}：文字對比 ≥ 4.5`);
    await t.ctx.close();
  }

  await browser.close();
  assert(errors.length === 0, '沒有頁面或主控台錯誤 ' + errors.join(' | '));
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
