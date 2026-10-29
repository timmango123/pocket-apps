// 進位轉換：上架評分 toFix 的回歸測試（node tests.js，約 20 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'base-convert-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
// the toast carries 復原 only where it covers no control; otherwise the 復原 in the 數值 panel
const undoTap = async p => (await p.$('.toast button')) ? p.click('.toast button') : p.click('#undo');

// the HEX field's visual lines, measured with a mirror div of the same width, padding and font
const fieldLines = (p, id) => p.$eval(id, t => {
  const cs = getComputedStyle(t), d = document.createElement('div');
  for (const k of ['width', 'paddingLeft', 'paddingRight', 'font', 'letterSpacing', 'boxSizing', 'borderLeftWidth', 'borderRightWidth', 'borderStyle']) d.style[k] = cs[k];
  d.style.whiteSpace = 'pre-wrap'; d.style.overflowWrap = 'break-word'; d.style.position = 'absolute'; d.style.visibility = 'hidden';
  document.body.appendChild(d); const lines = []; let cur = '', top = null;
  for (const ch of t.value) { const sp = document.createElement('span'); sp.textContent = ch; d.appendChild(sp); }
  for (const sp of d.children) { const y = sp.getBoundingClientRect().top; if (top !== null && y > top + 2) { lines.push(cur); cur = ''; } top = y; cur += sp.textContent; }
  lines.push(cur); d.remove(); return lines;
});
(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__bcReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // wait until the page has stopped scrolling (a fling from a swipe keeps going after touchEnd)
    const settle = () => p.evaluate(() => new Promise(r => { let last = scrollY, same = 0; const f = () => { if (scrollY === last) same++; else { same = 0; last = scrollY; } same >= 10 ? r() : requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    const tap = async q => { await touch('touchStart', [q]); await touch('touchEnd', []); await frames(); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const val = () => p.evaluate(() => window.__bc.S.value.toString());
    const setDec = async v => { await p.fill('#f-dec', v); await p.locator('#f-dec').blur(); };
    return { ctx, p, touch, tap, center, val, setDec, frames, settle, cdp };
  }

  // the twelve displacement sweeps (第 3 輪, below) run alongside the other checks: they mostly wait on frames
  const sweepDone = Promise.all([[360, 640], [390, 844], [430, 932], [844, 390]].flatMap(([w, h]) => [8, 64, 0].map(m => sweep(w, h, m))));
  // 1. 一票否決：觸控點同一個位元格只切換一次（以前 pointerdown + click(detail=0) 各切一次）
  {
    const t = await open();
    await t.p.click('#w-16'); await t.setDec('0'); await t.p.evaluate(() => scrollTo(0, 0));
    const b = await t.center('#bit-3'), s = await t.center('#sign-u');
    const seq = []; for (let i = 0; i < 10; i++) { await t.tap(b); seq.push(await t.val()); }
    eq(seq.join(','), '8,0,8,0,8,0,8,0,8,0', 'CDP 觸控連點 bit-3 十次：每次剛好切換一次');
    const alt = []; for (let i = 0; i < 8; i++) { await t.tap(i % 2 ? s : b); alt.push(await t.val()); }
    eq(alt.join(','), '8,8,0,0,8,8,0,0', '位元格與「無號」交替點：位元每次切換一次');
    const pw = []; for (let i = 0; i < 4; i++) { await t.p.tap('#bit-3'); await t.frames(); pw.push(await t.val()); }
    eq(pw.join(','), '8,0,8,0', 'Playwright tap 也只切換一次');
    await t.p.click('#bit-0'); eq(await t.val(), '1', '滑鼠點擊切換一次');
    await t.p.focus('#bit-1'); await t.p.keyboard.press('Enter'); eq(await t.val(), '3', '鍵盤 Enter 切換一次');
    await t.p.keyboard.press('Space'); eq(await t.val(), '1', '鍵盤 Space 切換一次');

    // 2. 從位元格開始往上滑捲動頁面，不翻轉位元
    await t.p.click('#w-64'); await t.setDec('0'); await t.p.evaluate(() => scrollTo(0, 0));
    const q = await t.center('#bit-40');
    await t.touch('touchStart', [q]); for (let k = 1; k <= 12; k++) await t.touch('touchMove', [[q[0] + 1, q[1] - k * 18]]);
    await t.touch('touchEnd', []); await t.frames();
    await t.settle();
    const sy = await t.p.evaluate(() => scrollY);
    assert(sy > 50, `往上滑有捲動頁面（scrollY=${sy}）`);
    eq(await t.val(), '0', '從 bit-40 往上滑：數值不變');
    // 左右拖曳仍可連續設定（窄螢幕每列 4 個位元：bit-7 → bit-4）
    await t.p.click('#w-16'); await t.setDec('0'); await t.p.$eval('#bit-7', e => e.scrollIntoView({ block: 'center' })); await t.settle();
    const a = await t.center('#bit-7'), z = await t.center('#bit-4');
    await t.touch('touchStart', [a]); for (let k = 1; k <= 8; k++) await t.touch('touchMove', [[a[0] + (z[0] - a[0]) * k / 8, a[1]]]);
    await t.touch('touchEnd', []); await t.frames();
    eq(await t.val(), '240', '水平拖曳 bit-7→bit-4 設成 1（0xF0）');
    await t.tap(await t.center('#bit-0')); eq(await t.val(), '241', '拖曳後下一次點擊照常切換');
    // 8. 復原位元變更（拖曳算一步）
    await t.p.click('#undo'); eq(await t.val(), '240', '「復原」還原上一次點擊');
    await t.p.click('#undo'); eq(await t.val(), '0', '「復原」把整次拖曳還原');

    // 12. 位數沒變時就地更新位元按鈕，不重建
    await t.p.evaluate(() => { window.__b5 = document.getElementById('bit-5'); });
    await t.setDec('32');
    assert(await t.p.evaluate(() => window.__b5 === document.getElementById('bit-5') && window.__b5.textContent === '1' && window.__b5.getAttribute('aria-pressed') === 'true'), '輸入數值後位元按鈕就地更新，不重建');
    await t.ctx.close();
  }

  // 3. 色碼、運算子、B 值、浮點輸入會保存；4. 套用/送出可復原
  {
    const t = await open();
    assert(!(await t.p.$eval('#sampleTag', e => e.hidden)), '第一次開啟顯示「範例」');
    await t.setDec('1'); await t.setDec('255');
    assert(await t.p.$eval('#sampleTag', e => e.hidden), '使用者自己輸入 255 後「範例」不再出現');
    await t.p.click('#w-32'); await t.p.fill('#color', '#336699'); await t.p.selectOption('#op', 'xor'); await t.p.fill('#opB', '0x1234'); await t.p.fill('#floatIn', '2.5');
    await t.p.reload(); await t.p.waitForFunction(() => window.__bcReady);
    eq(await t.p.evaluate(() => ['color', 'op', 'opB', 'floatIn'].map(id => document.getElementById(id).value)), ['#336699', 'xor', '0x1234', '2.5'], '重新整理後色碼／運算子／B／浮點輸入都還在');
    eq(await t.p.inputValue('#cr'), '51', '還原的色碼也更新 RGB 欄');
    await t.p.click('#w-16'); await t.setDec('255');
    await t.p.click('#opApply'); eq(await t.val(), String(255 ^ 0x1234), '結果設為目前值');
    await undoTap(t.p); eq(await t.val(), '255', '「復原」（提示上的，或它會蓋住控制項時數值區的）還原套用前的值');
    await t.p.click('#colorToValue'); eq(await t.val(), String(0x336699), '整數值送到上方');
    await undoTap(t.p); eq([await t.val(), await t.p.getAttribute('#w-16', 'aria-pressed')], ['255', 'true'], '「復原」也還原位寬');
    await t.ctx.close();
  }

  // 5. 任意寬度時只有選 >>> 才提示無法使用
  {
    const t = await open();
    await t.p.click('#w-0');
    for (const op of ['and', 'mul']) { await t.p.selectOption('#op', op); assert(await t.p.$eval('#opNote', e => getComputedStyle(e).visibility === 'hidden'), `任意寬度選 ${op} 不顯示 >>> 警告`); }
    // 6. 鍵盤與 ± 按鈕
    eq(await t.p.getAttribute('#f-dec', 'inputmode'), 'numeric', 'DEC 欄 inputmode=numeric');
    await t.p.click('#w-16'); await t.p.click('#sign-s'); await t.setDec('255');
    await t.p.click('#pm-dec'); eq(await t.p.inputValue('#f-dec'), '-255', 'DEC ± 切換成負數');
    await t.p.click('#pm-dec'); eq(await t.p.inputValue('#f-dec'), '255', 'DEC ± 再按切回正數');
    await t.p.click('#w-32'); await t.p.fill('#floatIn', '0.5'); await t.p.click('#floatNeg');
    eq([await t.p.inputValue('#floatIn'), await t.val()], ['-0.5', String(-1090519040)], '浮點 ± 加上負號並寫入（-0.5 = 0xBF000000）');
    await t.p.fill('#floatIn', '3.14'); await t.p.click('#floatGo'); eq(await t.val(), '1078523331', '「寫入」按鈕寫入 3.14');
    // 8. 全形數字與全形負號
    await t.p.click('#sign-s'); await t.p.fill('#f-dec', '－１２３'); eq(await t.p.inputValue('#f-hex'), 'FF FF FF 85', '全形「－１２３」視同 -123');
    await t.p.fill('#f-hex', 'ＦＦ'); eq(await t.p.inputValue('#f-dec'), '255', '全形 ＦＦ 視同 FF');
    await t.p.locator('#f-hex').blur();
    // 有號 32 位元送入帶 alpha 的色碼：說明二補數而不是溢位
    await t.p.fill('#color', '#FF880080'); await t.p.click('#colorToValue');
    const st = await t.p.textContent('#status');
    assert(st.includes('二補數') && !st.includes('溢位'), '有號 32 位元送入 #FF880080：說明已視為二補數');
    eq(await t.p.inputValue('#f-hex'), 'FF 88 00 80', '位元完全保留');
    // R 欄超出範圍顯示夾住後的值
    await t.p.fill('#color', '#336699'); await t.p.fill('#cr', '300');
    eq([await t.p.inputValue('#cr'), await t.p.inputValue('#color')], ['255', '#FF6699'], 'R=300 欄位改成 255，與色碼一致');
    // 色碼無效時清空色塊與 RGBA
    await t.p.fill('#color', 'zzz');
    eq(await t.p.evaluate(() => [getComputedStyle(document.getElementById('swatch')).backgroundColor, ...['cr', 'cg', 'cb', 'ca'].map(i => document.getElementById(i).value), document.getElementById('colorToValue').disabled]),
      ['rgba(0, 0, 0, 0)', '', '', '', '', true], '無效色碼：色塊與 RGBA 欄清空、不能送出');
    // 10. 指數位標 .e
    await t.p.click('#w-32');
    eq(await t.p.evaluate(() => [31, 30, 23, 22].map(i => document.getElementById('bit-' + i).className)), ['bit s', 'bit e', 'bit e', 'bit'], '32 位元：符號位 .s、指數位 30–23 .e');
    await t.p.click('#w-64');
    eq(await t.p.evaluate(() => [62, 52, 51].map(i => document.getElementById('bit-' + i).className)), ['bit e', 'bit e', 'bit'], '64 位元：指數位 62–52 .e');
    // 11. HEX 以 2 個位元組為單位換行
    await t.p.click('#sign-u'); await t.setDec('255');
    eq(await t.p.inputValue('#f-hex'), '00 00 00 00 00 00 00 FF', '64 位元 HEX 仍以一般空格分組（複製、貼上不帶特殊字元）');
    eq(await fieldLines(t.p, '#f-hex'), ['00 00 00 00 00 00 ', '00 FF'], '390 寬 64 位元 HEX 換行時最後一行是 2 個位元組，不是單獨的 FF');
    // 9. 窄螢幕跳轉到位元運算
    await t.p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, 0); });
    await t.p.click('.jump [data-to="opsPanel"]');
    await t.p.waitForFunction(() => Math.abs(document.getElementById('opsPanel').getBoundingClientRect().top) < 4);
    assert(true, '「位元運算」跳轉到位元運算面板');
    await t.ctx.close();
  }

  // 7. 觸控範圍：每格位元 ≥ 44px；位寬按鈕 ≥ 44px；11. 欄位文字對齊、選項排成一列
  for (const [w, h] of [[320, 568], [360, 640], [390, 844], [430, 932], [844, 390], [1280, 800]]) {
    const t = await open(w, h);
    const align16 = await t.p.evaluate(() => ['f-oct', 'f-cus'].map(id => { const c = getComputedStyle(document.getElementById(id)); return [c.paddingTop, c.lineHeight]; }));
    await t.p.click('#w-64');
    const r = await t.p.evaluate(() => ({
      bit: Math.min(...[...document.querySelectorAll('.bit')].map(b => b.getBoundingClientRect().width)),
      seg: Math.min(...[...document.querySelectorAll('.seg button')].map(b => b.getBoundingClientRect().width)),
      sw: document.documentElement.scrollWidth - innerWidth,
      octPad: (() => { const e = document.getElementById('f-oct'), c = getComputedStyle(e); return [parseFloat(c.paddingTop), (e.offsetHeight - 2 - 24) / 2]; })(),
      opts: new Set([...document.querySelectorAll('.opts .check')].map(e => Math.round(e.getBoundingClientRect().top))).size,
    }));
    assert(r.bit >= 44, `${w}×${h} 位元格最窄 ${r.bit.toFixed(1)}px ≥ 44`);
    assert(r.seg >= 44, `${w}×${h} 位寬按鈕最窄 ${r.seg.toFixed(1)}px ≥ 44`);
    assert(r.sw <= 0, `${w}×${h} 沒有橫向捲動`);
    eq(align16[0], align16[1], `${w}×${h} textarea 與自訂進位欄文字位置一致`);
    assert(Math.abs(r.octPad[0] - r.octPad[1]) < 1, `${w}×${h} 64 位元 OCT 短值在預留高度中垂直置中（${r.octPad}）`);
    if (w <= 430) eq(r.opts, 1, `${w}×${h} 三個格式選項排成一列`);
    await t.setDec('255'); const hl = await fieldLines(t.p, '#f-hex');
    assert(hl[hl.length - 1].trim().length !== 2, `${w}×${h} 64 位元 HEX 最後一行不是單獨一個位元組（${JSON.stringify(hl)}）`);
    await t.ctx.close();
  }

  // 第 3 輪：位移掃描。每個可操作的控制項，在第一次點擊時的螢幕位置原地連點 3 下：
  // 每一下都要點在同一個控制項上，而且它的位置移動 < 2 px（每位評分者都找到的那一類問題）。
  // 下拉選單（原生選擇器）和跳轉列（本來就會捲動頁面）不在掃描內。
  async function sweep(w, h, mode) {
    const t = await open(w, h, { deviceScaleFactor: 1 }); // 1× paints less; positions are in CSS px anyway
    // page-side helpers, so each step is one round trip
    await t.p.evaluate(m => {
      const frame = n => new Promise(r => { const f = () => (--n > 0 ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); });
      const $ = id => document.getElementById(id);
      // states whose actions grow or shrink content: 8-bit ×3, 64-bit signed overflow on the 2nd +1, 2^200−1 >> 64
      const reset = () => {
        const S = window.__bc.S; S.width = m; S.signed = m === 64;
        S.value = m === 8 ? 90n : m === 64 ? (1n << 63n) - 2n : (1n << 200n) - 1n;
        $('op').value = m === 8 ? 'mul' : m === 64 ? 'add' : 'shr'; $('opB').value = m === 8 ? '3' : m === 64 ? '1' : '64';
        $('color').value = '#336699'; $('color').dispatchEvent(new Event('input'));
        $('floatIn').value = '1.5';
        if (document.activeElement) document.activeElement.blur();
        window.__bc.render(); $('toastHost').innerHTML = '';
      };
      const look = (sel, P) => {
        const e = document.querySelector(sel); if (!e) return null;
        const b = e.getBoundingClientRect(), x = P ? P[0] : b.left + b.width / 2, y = P ? P[1] : b.top + b.height / 2, u = document.elementFromPoint(x, y);
        return { top: b.top, P: [x, y], vis: b.top >= 0 && b.bottom <= innerHeight, under: !!(u && u.closest(sel)) || (u && (u.closest('.toast') ? 'toast 的「' + u.textContent + '」' : u.id || u.className || u.tagName)) };
      };
      const place = (e, pos) => {
        if (pos === 'top') scrollTo(0, 0);
        else if (pos === 'bottom') scrollTo(0, document.documentElement.scrollHeight);
        else if (pos === 'band') { const b = e.getBoundingClientRect(); scrollBy(0, b.top + b.height / 2 - (innerHeight - 42)); } // where the undo toast shows
        else e.scrollIntoView({ block: 'center' });
      };
      window.__sw = {
        reset,
        // which starts each control gets: page top and page bottom where it is visible there, else the middle;
        // controls that show an undo toast also from the toast's band at the bottom of the screen
        plan: sels => sels.map(sel => {
          const pos = [];
          for (const p of ['top', 'bottom']) { reset(); const e = document.querySelector(sel); place(e, p); const b = e.getBoundingClientRect(); if (b.top >= 0 && b.bottom <= innerHeight) pos.push(p); }
          if (!pos.length) pos.push('center');
          if (/opApply|colorToValue|floatGo|floatNeg|cp-|opRes|colorRes/.test(sel)) pos.push('band');
          return pos;
        }),
        prep: async (sel, pos) => { reset(); const e = document.querySelector(sel); if (!e) return null; place(e, pos); await frame(2); return look(sel); },
        after: async (sel, P, n) => { await frame(n); return look(sel, P); },
      };
    }, mode);
    const reset = () => t.p.evaluate(() => window.__sw.reset());
    await reset();
    // one selector per control; look-alike controls (bits, copy buttons, result rows, RGBA) are sampled
    const sels = await t.p.evaluate(() => {
      const out = [], vis = sel => [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length);
      const bits = vis('.bit');
      if (bits.length) for (const e of [bits[0], bits[bits.length >> 1], bits[bits.length - 1]]) out.push('#' + e.id);
      for (const e of vis('[data-set]').slice(0, 2)) out.push(`[data-set="${e.dataset.set}"][data-b="${e.dataset.b}"]`);
      for (const e of vis('button[id], input[id]:not([type=checkbox]), textarea[id]')) if (!e.classList.contains('bit') && !e.closest('.jump') && !/^(cp-(oct|hex|cus)|f-(oct|hex)|cg|cb|ca)$/.test(e.id)) out.push('#' + e.id);
      for (const id of ['fmtBin', 'fmtHex', 'fmtDec']) out.push(`label.check:has(#${id})`);
      out.push('#opRes button:nth-child(3)', '#colorRes button:nth-child(1)');
      return out;
    });
    const plan = await t.p.evaluate(sels => window.__sw.plan(sels), sels);
    const bad = []; let runs = 0;
    for (let k = 0; k < sels.length; k++) for (const pos of plan[k]) {
      const sel = sels[k], tag = `${sel}（${pos}）`, first = await t.p.evaluate(([sel, pos]) => window.__sw.prep(sel, pos), [sel, pos]);
      if (!first) { bad.push(tag + ': 不見了'); continue; }
      if (pos === 'band' && !first.vis) continue; // page too short to bring it there
      runs++;
      let cur = first;
      for (let i = 0; i < 3; i++) {
        if (cur.under !== true) { bad.push(`${tag} 第 ${i + 1} 下點到 ${cur.under}`); break; }
        await t.touch('touchStart', [first.P]); await t.touch('touchEnd', []);
        // input is handled before the next frame's callbacks; the last tap gets an extra frame
        cur = await t.p.evaluate(([sel, P, n]) => window.__sw.after(sel, P, n), [sel, first.P, i === 2 ? 2 : 1]);
        if (!cur || Math.abs(cur.top - first.top) >= 2) { bad.push(`${tag} 第 ${i + 1} 下後移動 ${!cur ? '（被移除）' : (cur.top - first.top).toFixed(1) + 'px'}`); break; }
      }
    }
    await t.ctx.close();
    assert(!bad.length, `位移掃描 ${w}×${h} ${mode ? mode + ' 位元' : '任意寬度'}：${sels.length} 個控制項、${runs} 組起點（頁首／頁尾／中間／toast 帶）各連點 3 下都在原處、沒點到 toast` + (bad.length ? '：' + bad.join('；') : ''));
  }
  await sweepDone;

  // 第 5 輪
  {
    const t = await open();
    // (1) 只增不減的保持很短：2^128−1 AND 0、2^1000−1 AND 0 之後 2 秒內 BIN 回到 ≤ 2 行，按鈕不移動
    for (const bits of [128n, 1000n]) {
      await t.p.click('#w-0'); await t.setDec(String((1n << bits) - 1n));
      await t.p.selectOption('#op', 'and'); await t.p.fill('#opB', '0'); await t.p.locator('#opB').blur();
      await t.p.$eval('#opApply', e => e.scrollIntoView({ block: 'center' })); await t.settle();
      const top0 = await t.p.$eval('#opApply', e => e.getBoundingClientRect().top);
      await t.tap(await t.center('#opApply'));
      const shrunk = await t.p.waitForFunction(() => document.getElementById('f-bin').offsetHeight <= 68, null, { timeout: 2500 }).then(() => true, () => false);
      assert(shrunk, `2^${bits}−1 AND 0 後 2 秒內 BIN 欄回到 ≤ 2 行（${await t.p.$eval('#f-bin', e => e.offsetHeight)} px）`);
      eq(Math.round((await t.p.$eval('#opApply', e => e.getBoundingClientRect().top)) - top0), 0, `2^${bits}−1 AND 0 欄位縮回時「結果設為目前值」不移動`);
      await t.p.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
    }
    await t.ctx.close();
    // (2) toast 的「復原」永遠不在任何可點的控制項上（toast 帶的按鈕、改放上方時、頁面捲動後）
    const covered = p => p.evaluate(() => {
      const d = document.querySelector('.toast'), b = d && d.querySelector('button'); if (!b) return [];
      const q = b.getBoundingClientRect();
      return [...document.querySelectorAll('button, input, select, textarea, label.check')].filter(e => !d.contains(e) && e.getClientRects().length)
        .filter(e => { const r = e.getBoundingClientRect(); return r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; }).map(e => e.id || e.textContent.trim().slice(0, 10));
    });
    for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
      const u = await open(w, h);
      await u.p.click('#w-64'); await u.setDec('1'); await u.p.selectOption('#op', 'shl'); await u.p.fill('#opB', '1'); await u.p.fill('#floatIn', '1.5'); await u.p.locator('#floatIn').blur();
      await u.p.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
      const res = [];
      for (const trig of ['#opApply', '#floatNeg', '#colorToValue', '#floatGo']) {
        await u.p.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(); scrollBy(0, b.top + b.height / 2 - (innerHeight - 42)); }, trig); await u.frames();
        await u.tap(await u.center(trig));
        const c1 = await covered(u.p);
        await u.p.evaluate(() => scrollBy(0, -150)); await u.frames(); await u.frames();
        const c2 = await covered(u.p);
        if (c1.length || c2.length) res.push(`${trig}: ${c1.concat(c2).join(',')}`);
        await u.p.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
      }
      eq(res, [], `${w}×${h} toast 的「復原」不蓋住任何控制項（含捲動後）`);
      await u.ctx.close();
    }
  }

  // 第 2 輪
  // R2-1 一票否決：64 位元點亮最高位元時欄位變高，位元格在手指下移動。依點擊前讀到的位置連點 bit-63…60
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const t = await open(w, h);
    await t.p.click('#w-64'); await t.setDec('0'); await t.p.$eval('#bit-63', e => e.scrollIntoView({ block: 'center' })); await t.settle();
    const heights = () => t.p.$$eval('#f-bin,#f-oct,#f-dec,#f-hex', els => els.map(e => e.offsetHeight));
    const h0 = await heights();
    const P = await t.p.$$eval('#bit-63,#bit-62,#bit-61,#bit-60', els => els.map(e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }));
    const top0 = await t.p.$eval('#bit-63', e => e.getBoundingClientRect().top);
    for (const q of P) await t.tap(q);
    eq(await t.val(), String(0xFn << 60n), `${w}×${h} 依原位置連點 bit-63…60 四格都設定`);
    eq((await t.p.$eval('#bit-63', e => e.getBoundingClientRect().top)) - top0, 0, `${w}×${h} 位元格沒有移動`);
    eq(await heights(), h0, `${w}×${h} 數值欄高度不隨數值改變（預留該位寬最長值的高度）`);
    // 程式直接改值也一樣（r2b shift64）
    await t.p.evaluate(() => { window.__bc.S.value = -1n; window.__bc.render(); }); eq(await heights(), h0, `${w}×${h} 全 1 時欄高不變`);
    await t.p.evaluate(() => { window.__bc.S.value = 0n; window.__bc.render(); });
    // 拖曳 bit-63 → bit-60
    const a = await t.center('#bit-63'), z = await t.center('#bit-60');
    await t.touch('touchStart', [a]); for (let k = 1; k <= 10; k++) await t.touch('touchMove', [[a[0] + (z[0] - a[0]) * k / 10, a[1]]]);
    await t.touch('touchEnd', []); await t.frames();
    eq(await t.val(), String(0xFn << 60n), `${w}×${h} 從 bit-63 拖到 bit-60 設定 4 格`);
    await t.ctx.close();
  }
  {
    const t = await open();
    // 任意寬度：位元格使用中清掉最高位元，格子數不縮、位置不動
    await t.p.click('#w-0'); await t.setDec(String(1n << 40n)); await t.p.$eval('#bit-40', e => e.scrollIntoView({ block: 'center' })); await t.settle();
    const top0 = await t.p.$eval('#bit-0', e => e.getBoundingClientRect().top);
    await t.tap(await t.center('#bit-40'));
    eq([await t.val(), await t.p.$$eval('.bit', b => b.length), (await t.p.$eval('#bit-0', e => e.getBoundingClientRect().top)) - top0], ['0', 48, 0], '任意寬度清掉最高位元：位元格不縮、不移動');
    await t.tap(await t.center('#bit-40')); eq(await t.val(), String(1n << 40n), '同一位置再點一次又設回來');
    // R2-2 多指：A 按下、B 按下、B 放開、A 放開 → 兩個位元都切換
    await t.p.click('#w-16'); await t.setDec('0'); await t.p.$eval('#bit-7', e => e.scrollIntoView({ block: 'center' })); await t.settle();
    const q1 = await t.center('#bit-2'), q2 = await t.center('#bit-7');
    const cdpPts = (type, pts) => t.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await cdpPts('touchStart', [{ x: q1[0], y: q1[1], id: 1 }]);
    await cdpPts('touchStart', [{ x: q1[0], y: q1[1], id: 1 }, { x: q2[0], y: q2[1], id: 2 }]);
    await cdpPts('touchEnd', [{ x: q1[0], y: q1[1], id: 1 }]);
    await cdpPts('touchEnd', []); await t.frames();
    eq(await t.val(), '132', '兩指交錯點 bit-2、bit-7：兩格都切換（132）');
    // 位元組 00/FF 按鈕（32/64 位元直式）
    await t.p.click('#w-32'); await t.setDec('0');
    await t.p.click('[data-set="1"][data-b="2"]'); eq(await t.val(), String(0xFF0000), '位元組 2 設為 FF');
    await t.p.click('[data-set="0"][data-b="2"]'); eq(await t.val(), '0', '位元組 2 設為 00');
    // R2-3 復原紀錄存在 sessionStorage：重新整理後仍可復原
    await t.setDec('77'); await t.p.reload(); await t.p.waitForFunction(() => window.__bcReady);
    assert(!(await t.p.$eval('#undo', e => e.disabled)), '重新整理後「復原」仍可按');
    await t.p.click('#undo'); eq(await t.val(), '0', '重新整理後復原到上一步');
    // 色碼送到上方把 8 位元切到 32 位元時說明原因
    await t.p.click('#w-8'); await t.p.click('#sign-u'); await t.p.fill('#color', '#FF8800'); await t.p.click('#colorToValue');
    assert((await t.p.textContent('#status')).includes('已切換到 32 位元以容納色碼'), '8 位元送入色碼：狀態列說明已切換到 32 位元');
    // BIN 以整個位元組換行
    await t.p.click('#w-32'); await t.setDec('255');
    const bl = await fieldLines(t.p, '#f-bin');
    assert(bl.every(l => l.trim().split(' ').length % 2 === 0), `390 寬 32 位元 BIN 每行都是整個位元組（${JSON.stringify(bl)}）`);
    // 超長輸入延後更新其他欄位
    await t.p.click('#w-0');
    const big = '7'.repeat(5000);
    await t.p.fill('#f-dec', big);
    await t.p.waitForFunction(n => window.__bc.S.value.toString().length === n, big.length);
    assert(true, '5,000 位數輸入：停止輸入後更新數值');
    await t.p.fill('#f-dec', big.slice(0, 4000)); await t.p.locator('#f-dec').blur();
    eq((await t.val()).length, 4000, '離開欄位時立刻套用尚未更新的長輸入');
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有 page/console error' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
