// SVG 動畫工坊：上架評分重審的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
// 頁面由本機 http 伺服器提供（file:// 重新載入時 Chromium 可能丟掉 localStorage 寫入）。期望值都在這裡獨立算出，不讀 app 的函式。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>';
const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(HTML); });
const KEY = 'svg-anim-studio';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const W = ms => new Promise(r => setTimeout(r, ms));
const errors = [], external = [];

(async () => {
  srv.listen(0); srv.unref();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: opt.scheme || 'dark', acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL.slice(0, -1) });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => { const u = r.url(); if (!u.startsWith(URL) && !/^(data|blob|about):/.test(u)) external.push(u); });
    await p.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { sessionStorage.setItem('__seeded', 1); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } }, [KEY, opt.store === undefined ? null : opt.store]);
    await p.goto(URL); await p.waitForFunction(() => window.__sa);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const box = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const center = async sel => { const b = await box(sel); return [b.x + b.w / 2, b.y + b.h / 2]; };
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', []); await frames(); };
    // bring the control out from under the pinned preview / off-screen first, then tap its centre
    const reveal = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(), hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (!(hit && (hit === e || e.contains(hit)))) e.scrollIntoView({ block: 'center', behavior: 'instant' }); });
    const tap = async (sel, hold) => { await reveal(sel); await frames(); await tapAt(await center(sel), hold); };
    const d0 = sel => p.evaluate(sel => document.querySelector(sel).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), sel);
    const d0At = q => p.evaluate(q => document.elementFromPoint(q[0], q[1]).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), q);
    const S = () => p.evaluate(() => ({ paused: document.getElementById('pause').getAttribute('aria-pressed') === 'true', cur: document.querySelector('.tpl[aria-selected=true]').dataset.k, ae: document.activeElement && (document.activeElement.id || document.activeElement.tagName), toast: document.getElementById('toast').className }));
    const fieldId = label => p.evaluate(l => { const x = [...document.querySelectorAll('#controls label')].find(x => x.textContent.trim().startsWith(l)); return x && x.htmlFor; }, label);
    const setText = async (label, v) => { await p.fill('#' + await fieldId(label), v); await frames(); };
    const setRange = async (label, v) => { const id = await fieldId(label); await p.evaluate(([id, v]) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]); await frames(); };
    const setLoop = async v => { await p.evaluate(v => { const c = document.querySelector('#controls input[type=checkbox]'); if (c.checked !== v) { c.checked = v; c.dispatchEvent(new Event('change', { bubbles: true })); } }, v); await frames(); };
    const tab = async k => { await p.evaluate(() => scrollTo(0, 0)); await frames(); await tap('#tab-' + k); };
    const stage = () => p.evaluate(() => { const s = document.querySelector('#stage svg'); return { bars: [...s.querySelectorAll('.sa-bar')].map(r => +r.getAttribute('height')), ax: [...s.querySelectorAll('.sa-ax')].map(t => t.textContent), vals: [...s.querySelectorAll('.sa-v')].map(t => t.textContent), labs: [...s.querySelectorAll('.sa-lb')].map(t => t.textContent), letters: [...s.querySelectorAll('.sa-l')].map(t => t.textContent) }; });
    const realEnd = () => p.evaluate(() => { let m = 0; document.getElementById('stage').getAnimations({ subtree: true }).forEach(a => { const t = a.effect.getComputedTiming(); if (isFinite(t.endTime)) m = Math.max(m, t.endTime / 1000); }); return Math.round(m * 100) / 100; });
    const renders = () => p.evaluate(() => window.__r || 0);
    await p.evaluate(() => { window.__r = 0; new MutationObserver(() => window.__r++).observe(document.getElementById('stage'), { childList: true }); });
    return { ctx, p, T, frames, box, center, tapAt, tap, d0, d0At, S, setText, setRange, setLoop, tab, stage, realEnd, renders, fieldId };
  }

  // ---------- 1. 觸控：pointerup 觸發、另一指放著、兩指重疊、detail 0 click 不重複 ----------
  {
    const t = await open();
    let n = 0; for (let i = 0; i < 4; i++) { const a = (await t.S()).paused; await t.tap('#pause'); if ((await t.S()).paused !== a) n++; await W(120); }
    eq(n, 4, '單擊暫停 4/4 每次切換一次');
    for (const h of [600, 1000]) { const a = (await t.S()).paused; await t.tap('#pause', h); assert((await t.S()).paused !== a, `按住 ${h} ms 暫停只切換一次`); }
    const R = await t.center('.hint'); R[2] = 9;
    const withRest = async sel => { const q = await t.center(sel); q[2] = 2; await t.T('touchStart', [R]); await W(150); await t.T('touchStart', [R, q]); await W(60); await t.T('touchEnd', [q]); await W(80); await t.T('touchEnd', [R]); await t.frames(); };
    n = 0; for (let i = 0; i < 5; i++) { const a = (await t.S()).paused; await withRest('#pause'); if ((await t.S()).paused !== a) n++; }
    eq(n, 5, '一指放在說明文字上，點暫停 5/5 有作用');
    n = 0; for (const k of ['bars', 'wave', 'logo', 'bounce']) { await withRest('#tab-' + k); if ((await t.S()).cur === k) n++; }
    eq(n, 4, '一指放著，點四個範本分頁 4/4 有作用');
    let r0 = await t.renders(); await withRest('#replay'); eq(await t.renders() - r0, 1, '一指放著，重播重繪一次');
    await t.p.evaluate(() => navigator.clipboard.writeText('x'));
    await withRest('#copyTop'); await t.p.waitForFunction(() => document.getElementById('toast').classList.contains('on'));
    eq(await t.p.evaluate(() => navigator.clipboard.readText()), await t.p.$eval('#code', e => e.value), '一指放著，上方複製把完整程式碼放進剪貼簿');
    await t.p.evaluate(() => document.getElementById('toast').className = '');
    await withRest('#reset'); assert((await t.S()).toast.includes('on'), '一指放著，重設範本有作用（出現提示）');
    for (const order of ['first', 'second']) {
      const a = await t.S(); const P = await t.center('#pause'), Q = await t.center(a.cur === 'bars' ? '#tab-wave' : '#tab-bars'); Q[2] = 2;
      await t.T('touchStart', [P]); await W(50); await t.T('touchStart', [P, Q]); await W(60);
      if (order === 'first') { await t.T('touchEnd', [P]); await W(40); await t.T('touchEnd', [Q]); } else { await t.T('touchEnd', [Q]); await W(40); await t.T('touchEnd', [P]); }
      await t.frames(); const b = await t.S();
      assert(a.paused !== b.paused && a.cur !== b.cur, `兩指重疊（${order === 'first' ? '先按的先放' : '後按的先放'}）：暫停和分頁都有作用`);
    }
    await W(850);
    // tap then the browser's own detail-0 click (CI Chromium 141), on the button, on its edge and at elementFromPoint
    const pb = await t.box('#pause'), pc = [pb.x + pb.w / 2, pb.y + pb.h / 2];
    let a = (await t.S()).paused; await t.tap('#pause'); await t.d0('#pause'); await t.d0At([pb.x + 1, pb.y + pb.h / 2]); await t.d0At(pc); await t.frames();
    assert((await t.S()).paused !== a, '點暫停後再送 detail 0 click（按鈕、邊緣、elementFromPoint）：只切換一次');
    await W(850);
    r0 = await t.renders(); await t.tap('#replay'); await t.d0('#replay'); await t.d0At(await t.center('#replay')); await t.frames();
    eq(await t.renders() - r0, 1, '點重播後再送 detail 0 click：只重繪一次');
    await W(850);
    await t.tab('logo'); await W(850); await t.setLoop(false); await W(850);
    const togQ = await t.center('#tab-wave');
    await t.tap('#tab-wave'); const loop0 = await t.p.evaluate(() => document.querySelector('#controls input[type=checkbox]').checked);
    await t.d0At(togQ); await t.d0('#controls label.tog'); await t.frames();
    eq([(await t.S()).cur, await t.p.evaluate(() => document.querySelector('#controls input[type=checkbox]').checked)], ['wave', loop0], '換分頁後的 detail 0 click 不會按到新面板的開關');
    assert(!/^(INPUT|TEXTAREA|SELECT)$/.test((await t.S()).ae), '換分頁後沒有輸入框拿到焦點：' + (await t.S()).ae);
    await W(850);
    a = (await t.S()).paused; await t.d0('#pause'); await t.frames(); assert((await t.S()).paused !== a, '沒有觸控時單獨的 detail 0 click（鍵盤／讀屏）動作一次');
    a = (await t.S()).paused; await t.p.focus('#pause'); await t.p.keyboard.press('Enter'); await t.frames(); assert((await t.S()).paused !== a, 'Enter 鍵仍可操作暫停（一次）');
    await W(850);
    let edge = 0; for (const q of [[pb.x - 2, pb.y + pb.h / 2], [pb.x + pb.w / 2, pb.y + pb.h + 6], [pb.x + pb.w / 2, pb.y - 6]]) { a = (await t.S()).paused; await t.tapAt(q); if ((await t.S()).paused !== a) edge++; await W(100); }
    eq(edge, 3, '點在暫停鈕外緣（左 2 px、上下 6 px）仍有作用');
    const act = await t.p.evaluate(() => [...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.selectorText && /:active/.test(r.selectorText) && /transform/.test(r.cssText)).map(r => r.selectorText));
    eq(act, [], '按鈕 :active 沒有 transform（不縮小觸控範圍）');
    // reset can be undone from the toast
    await t.tab('bars'); await t.setText('圖表標題', '我的標題'); await W(850);
    await t.tap('#reset'); eq(await t.p.$eval('#' + await t.fieldId('圖表標題'), e => e.value), '每月營收（萬元）', '重設範本回到範例');
    await t.tap('#toastAct'); eq(await t.p.$eval('#' + await t.fieldId('圖表標題'), e => e.value), '我的標題', '提示裡的「復原」把重設前的內容拿回來');
    await t.ctx.close();
  }

  // ---------- 2 + 13. 標題列：320/360 寬副標不在按鈕底下、文字不被切，按鈕 44 px ----------
  for (const w of [320, 360, 390]) {
    const t = await open(w, 700);
    const r = await t.p.evaluate(() => {
      const h = document.querySelector('.logo h1'), s = h.querySelector('small'), acts = document.querySelector('.acts').getBoundingClientRect();
      const rg = document.createRange(); rg.selectNodeContents(h); const tb = rg.getBoundingClientRect();
      const subShown = getComputedStyle(s).display !== 'none';
      let subRight = 0; if (subShown) { const r2 = document.createRange(); r2.selectNodeContents(s); subRight = r2.getBoundingClientRect().right; }
      return { textRight: tb.right, subRight, actsLeft: acts.left, clipped: h.scrollWidth > h.clientWidth + 1, chips: [...document.querySelectorAll('.chip')].map(c => [c.offsetWidth, c.offsetHeight]), sw: document.documentElement.scrollWidth - innerWidth };
    });
    assert(r.textRight <= r.actsLeft - 2 && r.subRight <= r.actsLeft - 2 && !r.clipped && r.sw <= 0, `${w} 寬：標題與副標不壓到右上按鈕、沒被切（文字右緣 ${Math.round(r.textRight)} / ${Math.round(r.subRight)}，按鈕左緣 ${Math.round(r.actsLeft)}）`);
    assert(r.chips.every(c => c[0] >= 44 && c[1] >= 44), `${w} 寬：頂部按鈕至少 44×44：${JSON.stringify(r.chips)}`);
    await t.ctx.close();
  }

  // ---------- 3. 壞存檔：驗證每個欄位，不注入、不當機 ----------
  {
    const hexes = p => p.$$eval('#controls .hex', e => e.map(x => x.textContent));
    const cases = [
      ['cur 為 __proto__', '{"cur":"__proto__","params":{}}', async t => eq([(await t.S()).cur, await t.p.$$eval('#controls .f', e => e.length)], ['logo', 7], 'cur 為 __proto__ → 描邊 Logo，7 個控制項')],
      ['cur 為 constructor', '{"cur":"constructor","params":{"constructor":{}}}', async t => eq((await t.S()).cur, 'logo', 'cur 為 constructor → 描邊 Logo')],
      ['顏色 null', '{"cur":"logo","params":{"logo":{"c1":null}}}', async t => eq(await hexes(t.p), ['#FF5B36', '#1D2340', '#FBF5EA'], '顏色 null → 預設顏色')],
      ['顏色是數字', '{"cur":"bars","params":{"bars":{"bg":5}}}', async t => eq(await hexes(t.p), ['#15A37F', '#1F2A33', '#F2F6F3'], '顏色為數字 5 → 預設顏色')],
      ['顏色注入', '{"cur":"logo","params":{"logo":{"bg":"red;}</style><img src=x onerror=window.__pwn=1>","c2":"#12345g"}}}', async t => {
        await W(200); eq([await t.p.evaluate(() => !!window.__pwn), await t.p.$$eval('#controls img, #stage img', e => e.length), await hexes(t.p)], [false, 0, ['#FF5B36', '#1D2340', '#FBF5EA']], '存檔裡的顏色字串不能注入 HTML，改用預設');
        assert(!(await t.p.$eval('#code', e => e.value)).includes('onerror'), '輸出程式碼不含注入字串');
      }],
      ['數字超出範圍', '{"cur":"logo","params":{"logo":{"dur":999,"stag":-3,"ease":"evil","loop":"yes"}}}', async t => eq(await t.p.evaluate(() => [...document.querySelectorAll('#controls input[type=range]')].map(i => +i.value).concat(document.querySelector('#controls select').value, document.querySelector('#controls input[type=checkbox]').checked)), [5, 0, 'cubic-bezier(.65,0,.35,1)', false], '時間 999 夾到 5、間隔 -3 夾到 0、非法緩動與開關改用預設')],
      ['數字是字串', '{"cur":"logo","params":{"logo":{"dur":"abc","stag":null}}}', async t => eq(await t.p.$$eval('#controls input[type=range]', e => e.map(i => +i.value)), [2.2, 0.3], '時間 "abc"、間隔 null → 預設 2.2 / 0.3')],
      ['文字 null', '{"cur":"bars","params":{"bars":{"data":null,"labels":7,"title":{"a":1}}}}', async t => eq(await t.stage().then(s => s.vals), ['32', '58', '44', '81', '67'], '數值 null → 預設數值')],
      ['params 是陣列', '{"cur":"wave","params":[1,2]}', async t => eq((await t.S()).cur, 'wave', 'params 為陣列時仍打開揮手角色')],
      ['範本是 null', '{"cur":"wave","params":{"wave":null}}', async t => eq(await t.p.$eval('#' + await t.fieldId('對話框'), e => e.value), '嗨！歡迎光臨～', '範本參數 null → 預設文字')],
      ['不是 JSON', '{oops', async t => eq((await t.S()).cur, 'logo', '存檔不是 JSON → 預設')],
      ['正常舊存檔', '{"cur":"bars","params":{"bars":{"title":"我的圖","data":"1, 2, 3","labels":"甲, 乙, 丙","c1":"#123456","dur":2,"loop":true},"logo":{"text":"ACME"}}}', async t => {
        eq([(await t.S()).cur, await t.p.$eval('#' + await t.fieldId('圖表標題'), e => e.value), (await hexes(t.p))[0], await t.p.$eval('#' + await t.fieldId('成長時間'), e => +e.value), await t.p.$eval('#controls input[type=checkbox]', e => e.checked), (await t.stage()).labs],
          ['bars', '我的圖', '#123456', 2, true, ['甲', '乙', '丙']], '正常的舊存檔原樣載入');
        await t.tab('logo'); eq(await t.p.$eval('#' + await t.fieldId('品牌文字'), e => e.value), 'ACME', '其他範本的存檔也還在');
      }]
    ];
    for (const [name, store, check] of cases) {
      const e0 = errors.length; const t = await open(390, 844, { store });
      await check(t);
      await t.tap('#reset'); const n = await t.p.$$eval('#controls .f', e => e.length);
      assert(errors.length === e0 && n >= 5, `${name}：沒有錯誤，重設範本正常（${n} 個控制項）${errors.length > e0 ? ' ' + errors.slice(e0).join(' | ') : ''}`);
      await t.ctx.close();
    }
    const t = await open(); await t.tab('bars'); await t.setText('圖表標題', '重新整理後'); await t.p.reload(); await t.p.waitForFunction(() => window.__sa);
    eq([(await t.S()).cur, await t.p.$eval('#' + await t.fieldId('圖表標題'), e => e.value)], ['bars', '重新整理後'], '輸入後立刻重新整理，內容還在');
    await t.ctx.close();
  }

  // ---------- 4. 沒有外部請求、沒有網路字型 ----------
  assert(!/<link\b/i.test(SRC) && !/fonts\.(googleapis|gstatic)/.test(SRC) && !/@import|url\(\s*['"]?https?:/i.test(SRC), '原始碼沒有 <link>、Google Fonts、@import 或外部 url()');

  // ---------- 5, 7, 8, 9, 10, 12. 結果正確 ----------
  {
    const t = await open();
    await t.tab('bars');
    const errText = () => t.p.evaluate(() => { const e = document.getElementById('dataErr'); return e && !e.hidden && e.offsetHeight > 0 ? e.textContent : ''; });
    const before = await t.stage();
    await t.setText('數值', '-5, 10'); let s = await t.stage(), m = await errText();
    assert(/負數/.test(m) && m.includes('-5'), '"-5, 10" → 看得到錯誤訊息：' + m);
    eq([s.vals, s.labs], [before.vals, before.labs], '"-5, 10" → 圖表沒有偷偷丟掉 -5，也沒有把一月標到 10 上');
    eq(await t.p.$eval('#' + await t.fieldId('數值'), e => e.getAttribute('aria-invalid')), 'true', '欄位標成無效');
    await t.setText('數值', 'abc'); s = await t.stage(); m = await errText();
    assert(/不是數字/.test(m) && m.includes('abc'), '"abc" → 看得到錯誤訊息：' + m);
    eq(s.vals, before.vals, '"abc" → 沒有憑空畫出一根 10');
    await t.setText('數值', ''); assert(/至少一個數字/.test(await errText()), '空白 → 請輸入至少一個數字');
    await t.setText('數值', '3, 4'); s = await t.stage(); eq([await errText(), s.vals, s.labs.slice(0, 2)], ['', ['3', '4'], ['一月', '二月']], '改回合法數值：訊息消失，2 根長條');
    await t.setText('數值', '１２, ３.5'); eq((await t.stage()).vals, ['12', '3.5'], '全形數字也接受');
    await t.setText('數值', '1,2,3,4,5,6,7,8,9'); s = await t.stage();
    assert(s.vals.length === 8 && /8 筆/.test(await t.p.$eval('#dataNote', e => e.hidden ? '' : e.textContent)), '9 筆 → 畫 8 根並說明只畫前 8 筆');
    // 8. ticks and value labels keep the digits the step needs
    const tick = [['0.001, 0.004', ['0', '0.001', '0.002', '0.003', '0.004'], ['0.001', '0.004']], ['0.5, 1.25', ['0', '0.5', '1', '1.5', '2'], ['0.5', '1.25']],
      ['0.0003', ['0', '0.0001', '0.0002', '0.0003', '0.0004'], ['0.0003']], ['1000000, 2000000', ['0', '500000', '1000000', '1500000', '2000000'], ['1000000', '2000000']], ['5', ['0', '2', '4', '6', '8'], ['5']], ['0, 0', ['0', '0.25', '0.5', '0.75', '1'], ['0', '0']]];
    for (const [inp, ax, vals] of tick) { await t.setText('數值', inp); s = await t.stage(); eq([s.ax, s.vals], [ax, vals], `刻度與數值標籤 "${inp}"`); }
    // 7. 時長 equals the real end of the last animation (expected values worked out by hand from the CSS formulas)
    await t.tap('#reset'); await t.setRange('成長時間', 4);
    eq(await t.p.$eval('#metaR', e => e.textContent), '時長 4.6 秒', '長條圖成長 4 秒：最後一根長條 0.6 + 4 = 4.6 秒');
    eq(await t.realEnd(), 4.6, '長條圖成長 4 秒：實際動畫結束 4.6 秒');
    await t.tab('logo'); await t.tap('#reset');
    // logo: s = 0.3, d = 2.2 → underline starts 5·0.3 + 2.2·0.5 = 2.6 s and runs 2.2 s
    eq(await t.p.$eval('#metaR', e => e.textContent), '時長 4.8 秒', '描邊 Logo 預設顯示 4.8 秒');
    eq(await t.realEnd(), 4.8, '描邊 Logo 預設實際結束 4.8 秒');
    await t.tab('bounce'); await t.setLoop(false); await t.setText('文字', 'HELLO');
    eq([await t.p.$eval('#metaR', e => e.textContent), await t.realEnd()], ['時長 2.12 秒', 2.12], '彈跳文字 HELLO 不循環：0.9·2 + 4·0.08 = 2.12 秒');
    await t.setLoop(true); assert(/^循環播放/.test(await t.p.$eval('#metaR', e => e.textContent)), '循環時標示「循環播放」而不是總長度');
    // 9. grapheme split
    for (const [txt, exp] of [['👋🏻嗨', ['👋🏻', '嗨']], ['👨‍👩‍👧家', ['👨‍👩‍👧', '家']], ['🇹🇼台', ['🇹🇼', '台']], ['AB C', ['A', 'B', 'C']]]) { await t.setText('文字', txt); eq((await t.stage()).letters, exp, `彈跳文字依字素切字 "${txt}"`); }
    await t.tap('#reset');
    // 10. speech bubble fits its text
    await t.tab('wave');
    for (const txt of ['WWWWWWWWWWWWWW', '一二三四五六七八九十一二三四', '嗨！歡迎光臨～', 'Hi']) {
      await t.setText('對話框', txt); await t.frames();
      const r = await t.p.evaluate(() => { const g = document.querySelector('#stage .sa-bubble'), a = g.querySelector('rect').getBBox(), b = g.querySelector('text').getBBox(); return [a.x, a.x + a.width, b.x, b.x + b.width]; });
      assert(r[2] >= r[0] + 4 && r[3] <= r[1] - 4 && r[0] >= 0 && r[1] <= 400, `對話框裝得下 "${txt}"：框 ${r[0].toFixed(1)}–${r[1].toFixed(1)}，字 ${r[2].toFixed(1)}–${r[3].toFixed(1)}`);
    }
    await t.tap('#reset');
    // 12. pause survives setting changes and keeps the frame
    await t.tab('logo'); await t.tap('#replay'); await W(700); await t.tap('#pause');
    const t0 = await t.p.evaluate(() => document.getElementById('stage').getAnimations({ subtree: true })[0].currentTime);
    await W(300); await t.setRange('描繪時間', 3); await t.setText('品牌文字', 'PAUSE'); await W(300);
    const st = await t.p.evaluate(() => { const a = document.getElementById('stage').getAnimations({ subtree: true }); return { paused: document.getElementById('pause').getAttribute('aria-pressed'), cls: document.getElementById('stage').classList.contains('paused'), states: [...new Set(a.map(x => x.playState))], t: a[0].currentTime }; });
    assert(st.paused === 'true' && st.cls && st.states.join() === 'paused' && Math.abs(st.t - t0) < 40, `暫停中改參數仍停著，停在同一幀（${Math.round(t0)} → ${Math.round(st.t)} ms，${st.states}）`);
    await t.tap('#tab-bars'); assert((await t.S()).paused && await t.p.evaluate(() => document.getElementById('stage').getAnimations({ subtree: true }).every(a => a.playState === 'paused')), '暫停中換範本也維持暫停');
    await t.tap('#replay'); assert(!(await t.S()).paused && await t.p.evaluate(() => document.getElementById('stage').getAnimations({ subtree: true }).some(a => a.playState === 'running')), '按重播才重新播放');
    // 11. download .html
    const [dl] = await Promise.all([t.p.waitForEvent('download'), (async () => { await t.p.$eval('#download', e => e.scrollIntoView({ block: 'center' })); await W(100); await t.tap('#download'); })()]);
    const body = fs.readFileSync(await dl.path(), 'utf8');
    assert(/\.html$/.test(dl.suggestedFilename()) && body === await t.p.$eval('#code', e => e.value), `下載 ${dl.suggestedFilename()}，內容就是輸出的程式碼`);
    // standalone export for every template
    for (const k of ['logo', 'bounce', 'bars', 'wave']) {
      await t.tab(k); const doc = await t.p.$eval('#code', e => e.value), n2 = await t.p.evaluate(() => document.querySelectorAll('#stage #sa-anim *').length);
      const q = await browser.newPage(), errs = [], net = [];
      q.on('pageerror', x => errs.push(x.message)); q.on('console', m => m.type() === 'error' && errs.push(m.text())); q.on('request', r => !/^(data|about):/.test(r.url()) && net.push(r.url()));
      await q.setContent(doc); await q.waitForFunction(() => document.getAnimations().length > 0);
      const n1 = await q.evaluate(() => document.querySelectorAll('#sa-anim *').length);
      assert(!errs.length && !net.length && n1 === n2, `匯出的 ${k} 單獨開啟：0 錯誤、0 網路請求、元素數相同（${n1}/${n2}）`);
      await q.close();
    }
    await t.ctx.close();
  }

  // ---------- 6. 手機上調參數時看得到預覽（直式與橫式） ----------
  for (const [w, h] of [[390, 844], [375, 500], [844, 390]]) {
    const t = await open(w, h);
    const ids = await t.p.$$eval('#controls input[type=range], #controls select, #controls .sw', e => e.map((x, i) => (x.id || (x.dataset.i = 'q' + i, '[data-i=' + 'q' + i + ']'))));
    let ok = 0, worst = '';
    for (const id of ids) {
      const r = await t.p.evaluate(id => {
        const c = id.startsWith('[') ? document.querySelector(id) : document.getElementById(id); c.scrollIntoView({ block: 'center', behavior: 'instant' });
        const s = document.getElementById('stage').getBoundingClientRect(), f = document.querySelector('.frame').getBoundingClientRect(), cb = c.getBoundingClientRect();
        const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2);
        return { inView: s.top >= document.getElementById('bar').getBoundingClientRect().bottom - 1 && f.bottom <= innerHeight + 1 && s.height >= 100, onTop: !!hit && document.getElementById('stage').contains(hit), ctrlVisible: (cb.top + cb.bottom) / 2 >= f.bottom || cb.left >= f.right - 1, s: [Math.round(s.top), Math.round(s.bottom), Math.round(s.height)], c: Math.round(cb.top) };
      }, id);
      await t.frames();
      if (r.inView && r.onTop && r.ctrlVisible) ok++; else worst = JSON.stringify(r);
    }
    eq(ok + (worst ? ' ' + worst : ''), String(ids.length), `${w}×${h}：捲到每個參數時，預覽完整留在畫面上、不擋住該參數（${ids.length} 個）`);
    await t.ctx.close();
  }

  // ---------- round 2 ----------
  // R2-1 a touch on the pinned header / tabs / preview never reaches a control scrolled underneath it
  {
    const snap = t => t.p.evaluate(() => JSON.stringify({ cur: __sa.cur, paused: __sa.paused, toast: document.getElementById('toastMsg').textContent, params: __sa.params, ae: document.activeElement && document.activeElement.tagName }));
    let found = 0;
    for (const [w, h] of [[390, 844], [360, 640], [375, 500]]) {
      const t = await open(w, h);
      // just under the title, while the page is scrolled (tabs pass under the header on short screens)
      for (const sy of [20, 40, 60, 80, 100]) {
        await t.p.evaluate(y => scrollTo(0, y), sy); await t.frames(); await W(850);
        const pts = await t.p.evaluate(() => { const b = document.getElementById('bar').getBoundingClientRect(), h1 = document.querySelector('.logo h1').getBoundingClientRect(); return [[h1.left + h1.width / 2, b.bottom - 3], [h1.left + 4, b.bottom - 2], [h1.right - 4, b.bottom - 4]]; });
        for (const q of pts) { const a = await snap(t); await t.tapAt(q); await W(60); eq(await snap(t), a, `${w}×${h} 捲動 ${sy}px，點標題列下緣 (${q.map(Math.round)})：沒有按到底下的東西`); }
      }
      // over the pinned preview (and tabs), on every control that has scrolled underneath
      for (const sy of [80, 160, 240, 320, 420, 520, 700]) {
        await t.p.evaluate(y => scrollTo(0, y), sy); await t.frames(); await W(850);
        const hid = await t.p.evaluate(() => { const farFromOwn = (top, x, y) => { const z = top.closest('#bar, .tpls, .frame'); return !z || [...z.querySelectorAll('button')].every(b => { const r = b.getBoundingClientRect(); return Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom)) > 10; }); }; const zs = [...document.querySelectorAll('.frame, .tpls, #bar')].map(z => z.getBoundingClientRect()); const o = []; document.querySelectorAll('#controls button, .panel button, .codecol button, label.tog, label.sw').forEach(b => { const r = b.getBoundingClientRect(); if (!r.width) return; for (const [cx, cy] of [[r.left + r.width / 2, r.top + r.height / 2], [r.left + r.width / 2, r.top + 3], [r.left + r.width / 2, r.bottom - 3]]) { const top = document.elementFromPoint(cx, cy); if (top && !b.contains(top) && !top.closest('button, label, input, select, textarea') && farFromOwn(top, cx, cy) && zs.some(z => cy > z.top && cy < z.bottom && cx > z.left && cx < z.right)) { o.push([cx, cy, b.id || b.className]); break; } } }); return o; });
        for (const q of hid) { found++; const a = await snap(t); await t.tapAt([q[0], q[1]]); await W(60); eq(await snap(t), a, `${w}×${h} 捲動 ${sy}px，點在蓋住「${q[2]}」的固定區塊上：什麼都沒觸發`); }
      }
      await t.ctx.close();
    }
    assert(found >= 3, `確實測到被固定區塊蓋住的控制項（${found} 次）`);
  }
  // R2-4 tapping a field's label focuses the field; R2-5 tabs reachable after scrolling down (portrait)
  {
    const t = await open(390, 844);
    const id = await t.fieldId('品牌文字');
    await t.tap(`label[for="${id}"]`); await t.p.waitForFunction(id => document.activeElement && document.activeElement.id === id, id, { timeout: 3000 }).catch(() => {});
    eq((await t.S()).ae, id, '點「品牌文字」標籤，輸入框取得焦點');
    await t.p.evaluate(() => document.activeElement.blur());
    await t.p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await t.frames(); await W(850);
    const vis = await t.p.evaluate(() => { const b = document.getElementById('tab-wave').getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return b.top >= 0 && b.bottom <= innerHeight && !!h && document.getElementById('tab-wave').contains(h); });
    const sy = await t.p.evaluate(() => scrollY);
    await t.tapAt(await t.center('#tab-wave'));
    assert(vis && (await t.S()).cur === 'wave', `直式捲到底（${sy}px）時範本分頁仍在畫面上，不用捲回去就能換範本`);
    await t.ctx.close();
  }
  // R2-2 wide numbers: axis labels inside the canvas, value labels never overlap; R2-3 a single 1e-7
  {
    const t = await open(); await t.tab('bars');
    const geo = () => t.p.evaluate(() => { const ax = [...document.querySelectorAll('#stage .sa-ax')].map(e => e.getBBox()), v = [...document.querySelectorAll('#stage .sa-v')].map(e => e.getBBox()); let ov = 0; for (let i = 1; i < v.length; i++) if (v[i].x < v[i - 1].x + v[i - 1].width + 1) ov++; return { axMin: Math.min(...ax.map(b => b.x)), vMin: Math.min(...v.map(b => b.x)), vMax: Math.max(...v.map(b => b.x + b.width)), ov, vfs: parseFloat(getComputedStyle(document.querySelector('#stage .sa-v')).fontSize) }; });
    for (const d of ['99999', '9999999', '99999999', '123456789, 5', '999999999999999', '12.5, 1234567.25, 9, 10, 11, 12, 13, 14', '1234567, 2345678, 3456789, 4567890, 5678901, 6789012, 7890123, 8901234']) {
      await t.setText('數值', d); await t.frames(); const g = await geo();
      assert(g.axMin >= 0 && g.vMin >= 0 && g.vMax <= 400 && g.ov === 0 && g.vfs >= 8, `大數字 "${d}"：座標軸左緣 ${g.axMin.toFixed(1)} ≥ 0、數值標籤在畫布內且不重疊（字 ${g.vfs}px）`);
    }
    await t.setText('數值', '12.5, 1234567.25, 9, 10, 11, 12, 13, 14');
    eq((await t.stage()).vals.slice(0, 3), ['12.5', '123萬', '9'], '8 筆擠不下時 1234567.25 縮寫成 123萬（1234567.25 ÷ 10000 取 3 位有效數字）');
    await t.setText('數值', '1e-7'); const s = await t.stage();
    // max 1e-7 → step ≥ 2.5e-8 from {1,2,2.5,5,10}×10^-8 → 2.5e-8
    eq([s.ax, s.vals], [['0', '0.000000025', '0.00000005', '0.000000075', '0.0000001'], ['0.0000001']], '單一值 1e-7：刻度不是全部 0');
    await t.ctx.close();
  }
  // R2-6 light mode: slider fill and selected-tab border stand out from white (≥ 3:1)
  {
    const t = await open(390, 844, { scheme: 'light' }); await W(400);
    const r = await t.p.evaluate(() => {
      const rgb = c => { const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const m = getComputedStyle(d).color.match(/[\d.]+/g).map(Number); d.remove(); return m; };
      const L = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cr = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const panel = rgb(getComputedStyle(document.querySelector('.panel')).backgroundColor), fill = rgb(getComputedStyle(document.documentElement).getPropertyValue('--fill').trim());
      const tabB = rgb(getComputedStyle(document.querySelector('.tpl[aria-selected=true]')).borderTopColor);
      return { fill: cr(fill, panel), tab: cr(tabB, [255, 255, 255]) };
    });
    assert(r.fill >= 3 && r.tab >= 3, `淺色模式：滑桿填色對比 ${r.fill.toFixed(2)}、選中分頁框線對比 ${r.tab.toFixed(2)}（都要 ≥ 3）`);
    await t.ctx.close();
  }

  // ---------- 14. 淺色主題跟著系統 ----------
  for (const scheme of ['light', 'dark']) {
    const t = await open(390, 844, { scheme });
    const lum = await t.p.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; });
    const ink = await t.p.evaluate(() => { const [r, g, b] = getComputedStyle(document.body).color.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; });
    assert(scheme === 'light' ? lum > 0.85 && ink < 0.2 : lum < 0.15 && ink > 0.8, `系統${scheme === 'light' ? '淺' : '深'}色：背景亮度 ${lum.toFixed(2)}，文字 ${ink.toFixed(2)}`);
    await t.ctx.close();
  }

  eq(external, [], '整個測試期間沒有任何對外網路請求');
  eq(errors, [], '整個測試期間沒有 page error / console error');
  await browser.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
