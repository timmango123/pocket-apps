// 科學計算機：上架重審 R1 的回歸測試（node tests.js，約 40 秒）。
// = 後保留完整數值、壞掉的設定、觸控層（放開才執行、另一指放著、detail 0、按住 1 秒）、兩拇指交疊快打、結果列縮字不切、
// ± 不留開括號、算式重新整理後還在、sin(1E−13)、錯誤訊息說明怎麼修、44 px 按鍵、連按 =、錯誤後輸入數字、清除歷史可復原、
// 按 = 後不重複顯示結果、觸控後沒有 focus 框、科學記號用「−」。
// 頁面用本機 http 伺服器載入（重新整理要靠 localStorage）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
    srv.listen(0, '127.0.0.1', () => { srv.unref(); res('http://127.0.0.1:' + srv.address().port + '/'); });
  });
}
const KEYS = { '0': 'key-0', '1': 'key-1', '2': 'key-2', '3': 'key-3', '4': 'key-4', '5': 'key-5', '6': 'key-6', '7': 'key-7', '8': 'key-8', '9': 'key-9',
  '+': 'key-add', '−': 'key-sub', '×': 'key-mul', '÷': 'key-div', '=': 'key-eq', '.': 'key-dot', '±': 'key-neg', 'C': 'key-ac', '⌫': 'key-bs',
  '√': 'key-sqrt', '²': 'key-sq', '^': 'key-pow', '!': 'key-fact', 'E': 'key-exp', '(': 'key-lp', ')': 'key-rp', 's': 'key-sin' };

(async () => {
  const URL = await serve();
  const browser = await chromium.launch();
  async function open({ w = 390, h = 844, init, ctx, clean = true } = {}) {
    ctx = ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'zh-TW' });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__sciCalc);
    if (clean) { await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForFunction(() => window.__sciCalc); }
    const cdp = await ctx.newCDPSession(p);
    const pt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async (sel, hold) => { const c = await center(sel); await pt('touchStart', [[c[0], c[1], 1]]); if (hold) await p.waitForTimeout(hold); await pt('touchEnd', [[c[0], c[1], 1]]); };
    // keys typed with real touches: "1÷3=" etc. (sci keys are opened on demand on short screens)
    const type = async s => {
      for (const ch of s) {
        const id = KEYS[ch]; if (!id) throw new Error('no key ' + ch);
        if (await p.$eval('#' + id, e => !e.getClientRects().length)) await tap('#btn-fx');   // short screen: open the scientific page first
        await tap('#' + id);
      }
    };
    const S = () => p.evaluate(() => ({ expr: __sciCalc.state.expr, res: document.querySelector('#res').textContent, line: document.querySelector('#expr').textContent, prev: document.querySelector('#prev').textContent }));
    const res = () => p.textContent('#res');
    return { ctx, p, pt, center, tap, type, S, res };
  }
  const cl = p => p.evaluate(() => { const l = window.__log; window.__log = []; return l; });

  // ---------- 1. = 後用完整數值 ----------
  {
    const t = await open();
    await t.type('C1÷3=×3=');
    eq(await t.res(), '1', '1÷3=×3= 得 1（不是 0.999999999999999）');
    await t.type('C√2=²=');
    eq(await t.res(), '2', '√2=x²= 得 2');
    const h = await t.p.evaluate(() => JSON.parse(localStorage.getItem('sci-calc:v1:history')).map(x => x.result));
    eq([h.includes('1'), h[h.length - 1]], [true, '2'], '歷史紀錄存 1 和 2');
    await t.type('C1÷3=±×3=');
    eq(await t.res(), '−1', '1÷3=±×3= 得 −1（± 後仍用完整數值）');
    // ---------- 12. 連按 = ----------
    await t.type('C2+3==');
    eq(await t.res(), '8', '2+3== 重複 +3 得 8');
    await t.type('=');
    eq(await t.res(), '11', '再按 = 得 11');
    await t.type('C1÷3==');
    eq(await t.res(), '0.111111111111111', '1÷3== 重複 ÷3 用完整數值');
    // ---------- 12. 按 = 後結果不重複出現 ----------
    await t.type('C1+2=');
    const s = await t.S();
    eq([s.line, s.res, s.prev], ['1+2 =', '3', ''], '按 = 後算式列顯示原算式、結果列顯示結果（不重複）');
    await t.ctx.close();
  }

  // ---------- 2. 壞掉的設定 ----------
  for (const bad of ['"x"', '5', 'true', 'null', '[1]', '{"angle":5,"sci":"no","vibrate":"x","theme":7}']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(v => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('sci-calc:v1:settings', v); localStorage.setItem('sci-calc:v1:expr', v); sessionStorage.setItem('seeded', 1); } } catch (e) {} }, bad);
    const before = errors.length;
    const t = await open({ ctx, clean: false });
    const n = await t.p.$$eval('#pad-basic .k', k => k.length);
    await t.type('2+3=');
    eq([n, await t.res(), errors.length - before], [20, '5', 0], `設定 ${bad}：正常開啟、能計算、沒有錯誤`);
    await t.p.reload(); await t.p.waitForFunction(() => window.__sciCalc);
    eq(await t.p.$$eval('#pad-basic .k', k => k.length), 20, `設定 ${bad}：重新整理後仍正常`);
    await ctx.close();
  }

  // ---------- 3 + 5. 觸控層 ----------
  {
    const t = await open();
    await t.p.evaluate(() => {
      window.__log = [];
      for (const id of ['btn-angle', 'btn-second', 'btn-fx', 'btn-history', 'btn-menu', 'hist-close', 'hist-clear', 'menu-theme', 'menu-vibrate', 'menu-copy', 'scrim'])
        document.getElementById(id).addEventListener('click', () => window.__log.push(id));
      document.getElementById('hist').addEventListener('click', e => { const b = e.target.closest('button'); if (b) window.__log.push(b.className); });
      document.getElementById('pads').addEventListener('pointerdown', e => { const k = e.target.closest('.k'); if (k) window.__log.push('key:' + k.dataset.act); });
    });
    // resting finger on the empty spacer in the top bar, the other finger taps
    const rest = await t.p.$eval('.spacer', e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    eq(await t.p.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest('button'), rest), true, '放著的手指不在按鈕上');
    const tapRest = async (sel, hold = 50, restAt = rest) => {
      const c = await t.center(sel);
      await t.pt('touchStart', [[restAt[0], restAt[1], 9]]); await t.p.waitForTimeout(30);
      await t.pt('touchStart', [[restAt[0], restAt[1], 9], [c[0], c[1], 1]]); await t.p.waitForTimeout(hold);
      await t.pt('touchEnd', [[c[0], c[1], 1]]); await t.p.waitForTimeout(150);
      await t.pt('touchEnd', [[restAt[0], restAt[1], 9]]); await t.p.waitForTimeout(150);
    };
    const g = () => t.p.evaluate(() => [__sciCalc.state.second, document.querySelector('#btn-angle').textContent, document.querySelector('#btn-fx').getAttribute('aria-pressed'), !document.querySelector('#menu').hidden, !document.querySelector('#drawer').hidden]);
    await cl(t.p);
    await tapRest('#btn-second'); await tapRest('#btn-angle'); await tapRest('#btn-fx');
    eq(await g(), [true, 'RAD', 'false', false, false], '另一指放著：2nd、DEG、fx 都切換');
    await tapRest('#btn-second'); await tapRest('#btn-angle'); await tapRest('#btn-fx');
    await tapRest('#btn-menu');
    eq((await g())[3], true, '另一指放著：⋯ 開啟選單');
    // while the menu is open the scrim covers the top bar: rest the finger on the menu's note instead
    const restM = await t.p.$eval('.menu .note', e => { const b = e.getBoundingClientRect(); return [b.left + 20, b.top + b.height / 2]; });
    const th0 = await t.p.evaluate(() => document.querySelector('#menu-theme').textContent);
    await tapRest('#menu-theme', 50, restM);
    eq((await t.p.evaluate(() => document.querySelector('#menu-theme').textContent)) !== th0, true, '另一指放著：選單項目執行');
    await tapRest('#menu-theme', 50, restM); await tapRest('#menu-theme', 50, restM);
    await tapRest('#btn-menu', 50, restM);
    eq((await g())[3], false, '另一指放著：再按 ⋯（遮罩）關閉選單');
    await t.type('7=');
    await tapRest('#btn-history');
    eq((await g())[4], true, '另一指放著：歷史開啟');
    const restD = await t.p.$eval('.drawer .hint', e => { const b = e.getBoundingClientRect(); return [b.left + 20, b.top + b.height / 2]; });
    await tapRest('#hist-close', 50, restD);
    eq((await g())[4], false, '另一指放著（在抽屜裡）：關閉');
    await tapRest('#btn-history');
    await tapRest('#hist .use', 50, restD);
    eq([(await g())[4], await t.p.evaluate(() => __sciCalc.state.expr)], [false, '7'], '另一指放著：點歷史項目帶回結果並關閉');
    const log = await cl(t.p);
    eq(log.filter(x => !x.startsWith('key:')), ['btn-second', 'btn-angle', 'btn-fx', 'btn-second', 'btn-angle', 'btn-fx', 'btn-menu', 'menu-theme', 'menu-theme', 'menu-theme', 'scrim', 'btn-history', 'hist-close', 'btn-history', 'use'], '每個按鈕都只執行一次');

    // held taps: 0.6 s, 1 s, 1.5 s on a key enter once; on a top-bar button toggle once
    await t.type('C');
    await t.tap('#key-5', 600); await t.tap('#key-6', 1000); await t.tap('#key-7', 1500);
    await t.p.waitForTimeout(300);
    eq(await t.p.evaluate(() => __sciCalc.state.expr), '567', '按住 0.6 秒、1 秒、1.5 秒各只輸入一次');
    await cl(t.p);
    await t.tap('#btn-angle', 1000); await t.p.waitForTimeout(300);
    eq([await cl(t.p), await t.p.textContent('#btn-angle')], [['btn-angle'], 'RAD'], '按住 DEG 1 秒只切換一次');
    await t.tap('#btn-angle'); await t.p.waitForTimeout(300); await cl(t.p);

    // tap X, then replay a detail-0 click on X, on X's edge and on whatever is under the finger now
    const replay = async (sel, settle = 60) => {
      const c = await t.center(sel);
      await t.tap(sel); await t.p.waitForTimeout(settle);
      await t.p.evaluate(([sel, x, y]) => {
        const fire = (el, cx, cy) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: cx, clientY: cy }));
        const el = document.querySelector(sel), b = el.getBoundingClientRect();
        fire(el, x, y); fire(el, b.left + 1, b.top + 1); fire(document.elementFromPoint(x, y), x, y);
      }, [sel, c[0], c[1]]);
      await t.p.waitForTimeout(100);
      return cl(t.p);
    };
    eq([await replay('#btn-angle'), await t.p.textContent('#btn-angle')], [['btn-angle'], 'RAD'], 'DEG：點按＋detail 0 click 只切換一次');
    await t.tap('#btn-angle'); await t.p.waitForTimeout(100); await cl(t.p);
    eq([await replay('#btn-history'), (await g())[4]], [['btn-history'], true], '歷史：點按＋detail 0 click（落在新畫面的遮罩上）抽屜仍開著');
    eq([await replay('#hist-close'), (await g())[4]], [['hist-close'], false], '關閉：點按＋detail 0 click 不會點到下面的按鍵');
    await t.type('C'); await t.p.waitForTimeout(100); await cl(t.p);
    eq([await replay('#key-4'), await t.p.evaluate(() => __sciCalc.state.expr)], [['key:4'], '4'], '數字鍵：點按＋detail 0 click 只輸入一次');
    // a lone detail-0 click (keyboard / screen reader) 900 ms after a tap still runs once
    await t.tap('#key-1'); await t.p.waitForTimeout(900);
    await t.p.evaluate(() => document.getElementById('key-2').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    eq(await t.p.evaluate(() => __sciCalc.state.expr), '412', '點按後 900 ms 的單獨 click 執行一次');
    await t.p.waitForTimeout(900);
    await t.p.evaluate(() => document.getElementById('btn-angle').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    eq(await t.p.textContent('#btn-angle'), 'RAD', '單獨的 detail 0 click 在上方列也執行');
    // Enter right after a tap is not swallowed
    await t.tap('#btn-angle'); await t.p.waitForTimeout(50);
    await t.p.focus('#btn-angle'); await t.p.keyboard.press('Enter'); await t.p.waitForTimeout(100);
    eq(await t.p.textContent('#btn-angle'), 'RAD', '點按後馬上按 Enter 也會執行');
    await t.p.keyboard.press('Enter');

    // ---------- 12. no focus ring after a touch ----------
    await t.p.evaluate(() => document.activeElement && document.activeElement.blur());
    await t.tap('#btn-history'); await t.p.waitForTimeout(150);
    const f1 = await t.p.evaluate(() => [document.activeElement.id, document.activeElement.matches(':focus-visible')]);
    await t.tap('#hist-close'); await t.p.waitForTimeout(150);
    const f2 = await t.p.evaluate(() => [document.activeElement.id, document.activeElement.matches(':focus-visible')]);
    eq([f1[1], f2[1]], [false, false], '觸控開關歷史後沒有 focus 框');
    await t.p.keyboard.press('Tab'); await t.p.focus('#btn-history'); await t.p.keyboard.press('Enter'); await t.p.waitForTimeout(100);
    eq(await t.p.evaluate(() => [document.activeElement.id, document.activeElement.matches(':focus-visible')]), ['hist-close', true], '用鍵盤開歷史：焦點移到「關閉」並有 focus 框');
    await t.p.keyboard.press('Escape');

    // ---------- 12. clear history can be undone ----------
    await t.tap('#btn-history'); await t.p.waitForTimeout(100);
    const n0 = await t.p.$$eval('#hist .use', b => b.length);
    await t.tap('#hist-clear'); await t.p.waitForTimeout(80); await t.tap('#hist-clear'); await t.p.waitForTimeout(150);
    const cleared = await t.p.evaluate(() => [document.querySelectorAll('#hist .use').length, document.getElementById('toast').classList.contains('show'), document.getElementById('toast').textContent]);
    eq([cleared[0], cleared[1], cleared[2].includes('復原')], [0, true, true], '清除歷史後顯示「復原」');
    await t.tap('#toast-act'); await t.p.waitForTimeout(150);
    eq([await t.p.$$eval('#hist .use', b => b.length), (await t.p.evaluate(() => JSON.parse(localStorage.getItem('sci-calc:v1:history')))).length], [n0, n0], '按「復原」歷史全部回來（也存回去）');
    await t.ctx.close();
  }

  // ---------- 4. 兩拇指交疊快打 ----------
  {
    const t = await open();
    const keysL = ['#key-1', '#key-4', '#key-7'], keysR = ['#key-3', '#key-6', '#key-9'];
    const centers = {}; for (const k of [...keysL, ...keysR]) centers[k] = await t.center(k);
    for (const rate of [8, 12]) {
      await t.type('C'); await t.p.waitForTimeout(100);
      const period = 1000 / rate, n = 48; let want = ''; const evts = [];
      for (let i = 0; i < n; i++) { const k = (i % 2 ? keysR : keysL)[Math.floor(i / 2) % 3]; want += k.slice(-1); const id = i % 2 ? 2 : 1; evts.push({ t: i * period, type: 'start', id, k }); evts.push({ t: i * period + period * 1.3, type: 'end', id }); }
      evts.sort((a, b) => a.t - b.t || (a.type === 'end' ? -1 : 1));
      const down = {}; const t0 = Date.now();
      for (const e of evts) {
        const w = t0 + e.t - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w));
        if (e.type === 'start') { down[e.id] = centers[e.k]; await t.pt('touchStart', Object.entries(down).map(([id, c]) => [c[0], c[1], +id])); }
        else { const c = down[e.id]; delete down[e.id]; await t.pt('touchEnd', [[c[0], c[1], e.id]]); }
      }
      await t.p.waitForTimeout(300);
      const got = await t.p.evaluate(() => __sciCalc.state.expr);
      eq([got.length, got === want], [48, true], `兩拇指交疊 ${rate} 次/秒：48/48 依序輸入`);
    }
    await t.ctx.close();
  }

  // ---------- 6. 結果列不被切掉 ----------
  const fit = p => p.evaluate(() => { const r = document.getElementById('res'); return { ok: r.scrollWidth <= r.clientWidth + 1, text: r.textContent, px: parseFloat(getComputedStyle(r).fontSize) }; });
  for (const [w, h] of [[390, 844], [360, 640], [430, 932], [320, 568]]) {
    const t = await open({ w, h });
    await t.type('C1÷3=');
    let f = await fit(t.p);
    eq([f.ok, f.text.startsWith('0.333'), f.px >= 20], [true, true, true], `${w}×${h}：1÷3 結果完整顯示（${f.text}，${f.px}px）`);
    await t.type('C±1÷3E17=');
    f = await fit(t.p);
    eq([f.ok, f.text.startsWith('−3.3'), /E−18$/.test(f.text), !f.text.includes('-')], [true, true, true, true], `${w}×${h}：−1÷3E17 負號與尾數都看得到，用「−」（${f.text}）`);
    await t.type('C170!=');
    f = await fit(t.p);
    eq([f.ok, f.text], [true, '7.25741561530799E+306'], `${w}×${h}：170! 完整顯示`);
    // CI fonts are wider: force a much wider result font, the line must still fit (smaller font or fewer digits)
    await t.p.addStyleTag({ content: '.lcd .res { letter-spacing: .35em !important; font-family: serif !important; }' });
    await t.p.evaluate(() => dispatchEvent(new Event('resize')));
    f = await fit(t.p);
    eq([f.ok, /^7\.\d*E\+306$/.test(f.text)], [true, true], `${w}×${h}：很寬的字型下 170! 仍不被切（${f.text}）`);
    await t.type('C1÷3=');
    f = await fit(t.p);
    eq([f.ok, /^(0\.3|3\.3)/.test(f.text)], [true, true], `${w}×${h}：很寬的字型下 1÷3 仍不被切（${f.text}）`);
    await t.ctx.close();
  }

  // ---------- 7. ± ----------
  {
    const t = await open();
    const run = async (keys, want, m) => { await t.type('C' + keys); eq(await t.res(), want, m); };
    await run('3×5±−2=', '−17', '3×5±−2= 得 −17');
    await run('2^5±+1=', '1.03125', '2xʸ5±+1= 得 1.03125');
    await run('3−5±=', '8', '3−5± 變成 3+5');
    await run('5±±=', '5', '± 兩次回到原數');
    await run('5±×2=', '−10', '−5×2 = −10');
    await t.type('C3×5±');
    eq(await t.p.evaluate(() => [__sciCalc.state.expr, document.querySelector('#expr .ghost') ? 1 : 0]), ['3×−5', 0], '± 不留下沒關的括號');
    await t.ctx.close();
  }

  // ---------- 8. 算到一半的算式重新整理後還在 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const t = await open({ ctx });
    await t.type('12+34=7×8');
    await t.p.reload(); await t.p.waitForFunction(() => window.__sciCalc);
    eq([await t.p.evaluate(() => __sciCalc.state.expr), await t.res()], ['7×8', '56'], '輸入 7×8 後重新整理：算式和結果還在');
    await t.type('C1÷3=');
    await t.p.reload(); await t.p.waitForFunction(() => window.__sciCalc);
    await t.type('×3=');
    eq(await t.res(), '1', '1÷3= 重新整理後 ×3= 仍得 1（完整數值也保存）');
    await ctx.close();
  }

  // ---------- 9. tidy ----------
  {
    const t = await open();
    const r = await t.p.evaluate(() => [__sciCalc.evaluate('sin(1E−13)', 'rad'), __sciCalc.evaluate('tan(1E−13)', 'rad'), __sciCalc.evaluate('sin(π)', 'rad'), __sciCalc.evaluate('sin(180)', 'deg'), __sciCalc.evaluate('cos(90)', 'deg'), __sciCalc.evaluate('tan(180)', 'deg'), __sciCalc.evaluate('sin(1E−13)', 'deg'), __sciCalc.selfTest().fails]);
    eq(r, ['1E−13', '1E−13', '0', '0', '0', '0', '1.74532925199433E−15', []], 'RAD sin(1E−13)=1E−13；sin(π)、sin(180°)、cos(90°) 仍為 0；自我測試全過');

    // ---------- 10. error messages say how to fix ----------
    const err = async (keys, re, m) => { await t.type('C' + keys); const x = await t.p.$eval('#res', e => [e.textContent, e.className, e.scrollWidth <= e.clientWidth + 1]); eq([re.test(x[0]), x[1].includes('err'), x[2]], [true, true, true], m + '（' + x[0] + '）'); };
    await err('√±1=', /負數不能開平方根.*≥ 0/, '√(−1) 說明 √ 裡要 ≥ 0');
    await err('2+=', /少了數字/, '2+ = 說明少了數字');
    await err('1÷0=', /除數改成/, '1÷0 說明要改除數');
    // ---------- 12. a digit after an error starts fresh; after "incomplete" it completes the expression ----------
    await t.type('5');
    eq(await t.p.evaluate(() => __sciCalc.state.expr), '5', '1÷0 錯誤後按 5 重新開始（不是 1÷05）');
    await t.type('C2+=3=');
    eq(await t.res(), '5', '「算式不完整」後按 3 補上數字：2+3 = 5');
    for (const m of ['log(0)', 'ln(−1)', 'sin⁻¹(2)', 'tan(90)', '(−3)!', '171!', '(−8)^(1÷3)', '10 mod 0', '0⁻¹']) {
      await t.p.evaluate(s => { __sciCalc.state.expr = s; __sciCalc.state.justEq = false; }, m);
      await t.type('=');
      const x = await t.p.$eval('#res', e => [e.textContent, e.className]);
      assert(x[1].includes('err') && /[：（要不只沒]/.test(x[0]) && x[0].length > 6, `${m} 的錯誤訊息說明原因與修法（${x[0]}）`);
    }
    await t.ctx.close();
  }

  // ---------- 11. 44 px controls at short sizes, fx on and off ----------
  for (const [w, h] of [[360, 640], [390, 610], [375, 500], [320, 568], [390, 844], [844, 390]]) {
    for (const fxOn of [false, true]) {
      const t = await open({ w, h });
      const cur = await t.p.$eval('#btn-fx', b => b.getAttribute('aria-pressed') === 'true');
      if (cur !== fxOn) await t.tap('#btn-fx');
      await t.p.waitForTimeout(50);
      const r = await t.p.evaluate(() => {
        const bad = [], rects = [];
        document.querySelectorAll('.app button').forEach(b => {
          const q = b.getBoundingClientRect(); if (!q.width) return;
          if (q.width < 43.5 || q.height < 43.5) bad.push(b.id + ' ' + Math.round(q.width) + '×' + Math.round(q.height));
          if (q.bottom > innerHeight + 0.5 || q.right > innerWidth + 0.5 || q.left < -0.5 || q.top < -0.5) bad.push(b.id + ' 超出畫面');
          rects.push([b.id, q]);
        });
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i][1], c = rects[j][1]; if (a.left < c.right - 0.5 && c.left < a.right - 0.5 && a.top < c.bottom - 0.5 && c.top < a.bottom - 0.5) bad.push(rects[i][0] + ' 疊在 ' + rects[j][0]); }
        return { bad, ow: document.documentElement.scrollWidth - innerWidth, keys: rects.length };
      });
      eq([r.bad, r.ow <= 0], [[], true], `${w}×${h} fx ${fxOn ? '開' : '關'}：所有按鈕 ≥ 44 px、不重疊、不超出、沒有橫向捲動（${r.keys} 個）`);
      if (fxOn && h < 600 && h > w) {
        // short screen: sci page; a sci key goes back to the digits
        await t.tap('#key-sin');
        eq([await t.p.$eval('#key-7', e => e.getClientRects().length > 0), await t.p.evaluate(() => __sciCalc.state.expr)], [true, 'sin('], `${w}×${h}：科學鍵頁按 sin 後回到數字鍵`);
        await t.type('30)='); eq(await t.res(), '0.5', `${w}×${h}：sin(30)= 0.5`);
      }
      await t.ctx.close();
    }
  }

  eq(errors, [], '整個測試沒有 page error / console error');
  await browser.close();
  console.log(`${fails ? 'FAIL' : 'ok'} sci-calc：${passes} 通過，${fails} 失敗`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
