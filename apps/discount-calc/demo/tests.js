// 折扣計算回歸測試（CI 會跑）：node tests.js
// 每一項對應 2026-11-01 上架審查的 toFix；只等條件、不用固定延遲。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const HTML = SKELETON + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const mobile = (w, h, extra = {}) => Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, extra);

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/apps/discount-calc/`;
  const browser = await chromium.launch();
  const errors = [];
  const open = async (ctxOpt, tag, init) => {
    const ctx = await browser.newContext(ctxOpt); const p = await ctx.newPage();
    if (init) await p.addInitScript(init);
    p.on('pageerror', e => errors.push(tag + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(tag + ' console: ' + m.text()); });
    await p.goto(URL); await p.waitForFunction(() => window.__discountCalc);
    return { ctx, p };
  };
  const txt = (p, s) => p.$eval(s, e => e.textContent.replace(/\s+/g, ''));
  try {
    // ---------- 1. 折數標籤（2 折以下的半折）----------
    {
      const { ctx, p } = await open(mobile(390, 844, { permissions: ['clipboard-read', 'clipboard-write'] }), 'rate');
      const labels = await p.evaluate(() => [0.05, 0.15, 0.765, 0.85, 0.9, 0.3, 1, 0.0425, 0.12].map(r => window.__discountCalc.rateLabel(r)).join('|'));
      ok(labels === '0.5 折|1.5 折|76.5 折|85 折|9 折|3 折|10 折|0.43 折|1.2 折', 'rateLabel ' + labels);
      await p.uncheck('#d-stack'); await p.fill('#d-rate1', '0.5');
      ok(await txt(p, '#d-final') === '$50' && await txt(p, '#d-eq') === '相當於0.5折', '1000 元 0.5 折 = $50，相當於 0.5 折');
      ok((await txt(p, '#d-out .lines')).includes('第一層0.5折'), '明細寫「第一層 0.5 折」');
      await p.click('#copy-btn'); await p.waitForFunction(() => document.querySelector('#toast-msg').textContent === '已複製結果');
      ok((await p.evaluate(() => navigator.clipboard.readText())).startsWith('原價 $1,000 → 0.5 折 → $50'), '複製文字寫 0.5 折');
      await p.check('#d-stack'); await p.fill('#d-rate1', '3'); await p.fill('#d-rate2', '5');
      ok(await txt(p, '#d-final') === '$150' && await txt(p, '#d-eq') === '相當於1.5折', '3 折再 5 折 = $150，相當於 1.5 折');
      await p.fill('#d-rate1', '85'); await p.fill('#d-rate2', '9');
      ok(await txt(p, '#d-eq') === '相當於76.5折', '85 再 9 → 相當於 76.5 折');
      // 全形數字
      await p.fill('#d-rate1', '８５'); await p.fill('#d-price', '１０００');
      ok(await txt(p, '#d-final') === '$765' && await txt(p, '#d-rate1-msg') === '', '全形「８５」「１０００」轉半形計算');
      // 2. inputmode + % off 切換
      const modes = await p.evaluate(() => ['d-rate1', 'd-rate2', 'n-rate'].map(id => document.getElementById(id).getAttribute('inputmode')).join(','));
      ok(modes === 'decimal,decimal,decimal', '折數欄叫出數字鍵盤 ' + modes);
      await p.fill('#d-rate1', '15');
      ok((await p.textContent('#d-rate1-msg')).includes('「% off」'), '15 的錯誤提示指向「% off」');
      await p.click('#d-rate1-pct');
      ok(await p.inputValue('#d-rate1') === '15% off' && await p.getAttribute('#d-rate1-pct', 'aria-pressed') === 'true' && await txt(p, '#d-final') === '$765', '按「% off」→ 15% off，再 9 折 = $765');
      await p.click('#d-rate1-pct');
      ok(await p.inputValue('#d-rate1') === '15' && await p.getAttribute('#d-rate1-pct', 'aria-pressed') === 'false', '再按一次改回 15');
      await p.fill('#n-rate', '40'); await p.click('#n-rate-pct');
      ok(await p.inputValue('#n-rate') === '40% off' && await txt(p, '#n-total') === '$1,120', '第 N 件欄也能切 % off（40% off = 6 折）');
      await ctx.close();
    }
    // ---------- 3. 窄螢幕第一屏就看到結果 ----------
    for (const [w, h] of [[375, 500], [390, 610], [360, 640], [430, 740]]) {
      const { ctx, p } = await open(mobile(w, h), 'fold' + w);
      for (const [t, id] of [['disc', '#d-final'], ['spend', '#s-final'], ['tip', '#t-main']]) {
        await p.click('#tab-' + t); await p.evaluate(() => scrollTo(0, 0));
        const r = await p.evaluate(id => { const e = document.querySelector(id).getBoundingClientRect(), bar = document.querySelector('.bar').getBoundingClientRect(); return { b: Math.round(e.bottom), bar: Math.round(bar.top) }; }, id);
        ok(r.b <= r.bar, `${w}×${h} ${t} 結果 ${id} 在第一屏（底 ${r.b} ≤ 底部列 ${r.bar}）`);
      }
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      ok(sw <= w, `${w}×${h} 無橫向捲動 (${sw})`);
      await ctx.close();
    }
    // ---------- 4. 鍵盤高度：焦點欄位不被底部列蓋住；頂端小價籤 ----------
    {
      const { ctx, p } = await open(mobile(390, 470), 'kbd');
      const cov = [];
      for (const t of ['disc', 'spend', 'tip', 'cmp']) {
        await p.click('#tab-' + t);
        const ids = await p.evaluate(() => [...document.querySelectorAll('main input:not([type=checkbox])')].filter(e => e.offsetParent).map(e => e.id));
        for (const id of ids) {
          const r = await p.evaluate(id => { scrollTo(0, 0); const e = document.getElementById(id); e.focus(); const r = e.getBoundingClientRect(), bar = document.querySelector('.bar').getBoundingClientRect(), m = document.querySelector('#mini'); return { id, covered: r.bottom > bar.top || (!m.hidden && r.top < m.getBoundingClientRect().bottom) }; }, id);
          if (r.covered) cov.push(r.id);
        }
      }
      ok(cov.length === 0, '390×470 每個輸入框 focus 後都看得見 ' + cov.join(','));
      await p.click('#tab-disc');
      await p.evaluate(() => { scrollTo(0, 0); document.getElementById('d-rate2').focus(); });
      await p.waitForFunction(() => !document.querySelector('#mini').hidden);
      ok((await txt(p, '#mini')).includes('$765'), '結果捲出畫面時頂端小價籤顯示 $765');
      ok(await p.evaluate(() => { const r = document.querySelector('#d-rate2').getBoundingClientRect(); return document.elementFromPoint(r.x + 10, r.y + r.height / 2).id === 'd-rate2'; }), '小價籤不攔截觸控');
      await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); });
      await p.waitForFunction(() => document.querySelector('#mini').hidden);
      ok(true, '捲回頂端小價籤隱藏');
      await ctx.close();
    }
    // ---------- 5. 複製備援不留隱形層 ----------
    {
      const { ctx, p } = await open(mobile(390, 844), 'copy');
      const hits = () => p.evaluate(() => ['#theme-btn', '#tab-disc', '#tab-cmp'].every(s => { const r = document.querySelector(s).getBoundingClientRect(); const h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return h && h.closest(s); }));
      await p.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
      await p.click('#copy-btn'); await p.waitForFunction(() => document.querySelector('#toast').classList.contains('show'));
      ok(await hits(), 'clipboard 被拒、舊式複製成功後頁首按鈕仍點得到');
      await p.evaluate(() => { document.execCommand = () => false; });
      await p.click('#copy-btn'); await p.waitForFunction(() => !document.querySelector('#copy-sheet').hidden);
      ok((await p.inputValue('#copy-text')).startsWith('原價 $1,000'), '都失敗時顯示可見的唯讀文字框讓使用者長按複製');
      ok(await hits(), '文字框打開時頁首主題按鈕與分頁仍點得到');
      ok(await p.evaluate(() => document.querySelector('#copy-src').getBoundingClientRect().right < 0), '#copy-src 留在畫面外');
      const th0 = await p.textContent('#theme-label');
      const cdp = await ctx.newCDPSession(p);
      const c = await p.evaluate(() => { const r = document.querySelector('#theme-btn').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c[0], y: c[1] }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForFunction(t => document.querySelector('#theme-label').textContent !== t, th0);
      ok(true, '真實觸控點主題按鈕有效');
      await p.click('#copy-close');
      ok(await p.isHidden('#copy-sheet'), '關閉文字框');
      await ctx.close();
    }
    // ---------- 6. 逐欄錯誤；7. 比價細節、顏色；8. 復原 ----------
    {
      const { ctx, p } = await open(mobile(390, 844), 'flow');
      const bad = s => p.$eval(s, e => e.classList.contains('bad'));
      await p.fill('#n-price', '');
      ok(await bad('#n-price') && (await txt(p, '#n-msg')).includes('「單價」請輸入金額'), '第 N 件：單價空白標紅並寫出欄名');
      await p.fill('#n-price', '350'); await p.fill('#n-from', '');
      ok(await bad('#n-from') && !(await bad('#n-price')) && (await txt(p, '#n-msg')).includes('「第幾件起打折」'), '第 N 件：起折件數標紅');
      await p.fill('#n-from', '2');
      await p.click('#tab-spend'); await p.fill('#s-x', '');
      ok(await bad('#s-x') && (await txt(p, '#s-msg')).includes('「滿」請輸入金額'), '滿額：「滿」空白標紅並寫出欄名');
      await p.fill('#s-x', '1000'); await p.fill('#s-y', '2000');
      ok(await bad('#s-y') && (await txt(p, '#s-msg')).includes('「折」需小於「滿」'), '滿額：折 ≥ 滿 標在「折」');
      await p.fill('#s-y', '100');
      await p.click('#tab-tip'); await p.fill('#t-pct', '');
      ok(await bad('#t-pct') && (await txt(p, '#t-msg')).includes('「比例%」'), '小費：比例空白標紅');
      await p.fill('#t-pct', '１０'); await p.fill('#t-people', '');
      ok(await bad('#t-people') && !(await bad('#t-pct')) && (await txt(p, '#t-msg')).includes('「人數」'), '小費：全形比例可用，人數空白標紅');
      await p.fill('#t-people', '1'); await p.fill('#t-amount', '99.99');
      const foot = await p.$eval('#t-out .foot span', e => e.textContent);
      ok(await txt(p, '#t-main') === '$109.99' && foot === '1 人', '小費 1 人頁腳不寫進位方式：' + foot);

      await p.click('#tab-cmp');
      const col = await p.evaluate(() => { const c = getComputedStyle(document.querySelector('.c-price')).color, ink = getComputedStyle(document.body).color; return c === ink; });
      ok(col, '比價輸入值用主文字色，不繼承 label 灰色');
      await p.fill('#cmp-price-1', '100'); await p.fill('#cmp-qty-1', '1000'); await p.fill('#cmp-price-2', '100.4'); await p.fill('#cmp-qty-2', '1000'); await p.selectOption('#cmp-unit-2', 'g');
      const badges = await p.$$eval('.pcard .badge', bs => bs.map(b => b.textContent).join('/'));
      ok(badges === '最划算/貴 <1%', '差 0.4% 顯示「貴 <1%」 ' + badges);
      await p.fill('#cmp-price-2', 'abc');
      ok(await txt(p, '#cmp-list .pcard:nth-child(2) .unit') === '價格格式不正確' && await bad('#cmp-price-2'), '比價價格打 abc 顯示「價格格式不正確」');
      await p.fill('#cmp-price-2', '');
      ok(await txt(p, '#cmp-list .pcard:nth-child(2) .unit') === '價格或數量未填', '空白仍顯示「價格或數量未填」');
      await p.fill('#cmp-price-2', '１５０');
      ok(await txt(p, '#cmp-list .pcard:nth-child(2) .unit') === '每100g$15.00', '全形價格可比價');
      // 刪除後復原
      await p.click('#cmp-del-1'); await p.click('#cmp-del-1');
      ok(await p.locator('.pcard').count() === 1, '兩段式刪除');
      await p.waitForFunction(() => !document.querySelector('#toast-undo').hidden);
      const ub = await p.$eval('#toast-undo', e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; });
      ok(ub, '「復原」按鈕 ≥44px');
      await p.tap('#toast-undo');
      ok(await p.locator('.pcard').count() === 2 && await p.inputValue('#cmp-price-1') === '100', '刪除後可復原');
      await p.reload(); await p.waitForFunction(() => window.__discountCalc);
      ok(await p.locator('.pcard').count() === 2 && await p.inputValue('#cmp-price-2') === '１５０', '復原後重新整理資料還在');
      // 重設後復原
      await p.click('#tab-disc'); await p.fill('#d-price', '2000');
      await p.click('#reset-btn'); await p.click('#reset-btn');
      ok(await p.inputValue('#d-price') === '1000', '重設回範例');
      await p.waitForFunction(() => !document.querySelector('#toast-undo').hidden);
      await p.click('#toast-undo');
      ok(await p.inputValue('#d-price') === '2000' && await txt(p, '#d-final') === '$1,530', '重設後可復原');
      await p.reload(); await p.waitForFunction(() => window.__discountCalc);
      ok(await p.inputValue('#d-price') === '2000', '復原後重新整理資料還在');
      // 復原之後再編輯，就不再提供舊的復原
      await p.click('#reset-btn'); await p.click('#reset-btn');
      await p.waitForFunction(() => !document.querySelector('#toast-undo').hidden);
      await p.fill('#d-price', '500');
      ok(await p.isHidden('#toast-undo'), '重設後再編輯，復原按鈕收起，不會覆蓋新輸入');
      await ctx.close();
    }
    // ---------- 10. 結果卡在輸入上方：高度固定，控制項不在手指下移動（第二輪否決） ----------
    for (const [w, h] of [[390, 844], [375, 500], [360, 640]]) {
      const { ctx, p } = await open(mobile(w, h), 'shift' + w);
      await p.addStyleTag({ content: '*{overflow-anchor:none!important}' }); // iOS Safari 沒有捲動錨定
      const H = id => p.$eval(id, e => Math.round(e.closest('.card').getBoundingClientRect().height * 10) / 10);
      const states = async (tab, id, steps) => { await p.click('#tab-' + tab); const hs = [await H(id)]; for (const f of steps) { await f(); hs.push(await H(id)); } return hs; };
      const same = (hs, m) => ok(hs.every(x => x === hs[0]), `${w}×${h} ${m} 結果卡高度固定 ` + hs.join(','));
      same(await states('disc', '#d-out', [() => p.fill('#d-price', ''), () => p.fill('#d-price', '8'), () => p.fill('#d-rate1', 'abc'), () => p.fill('#d-rate1', '85'),
        () => p.setChecked('#d-stack', false), () => p.fill('#d-price', '99999999.99'), () => p.setChecked('#d-stack', true), () => p.fill('#d-price', '1000')]), '折扣');
      same(await states('spend', '#s-out', [() => p.click('#s-mode-once'), () => p.fill('#s-amount', ''), () => p.fill('#s-amount', '5'), () => p.click('#s-mode-each'), () => p.fill('#s-y', '5000'), () => p.fill('#s-y', '100'), () => p.fill('#s-amount', '99999999.99'), () => p.fill('#s-amount', '2350')]), '滿額');
      same(await states('tip', '#t-out', [() => p.fill('#t-people', '1'), () => p.fill('#t-people', ''), () => p.fill('#t-people', '12'), () => p.fill('#t-amount', ''), () => p.fill('#t-amount', '99999999.99'), () => p.fill('#t-pct', '150'), () => p.fill('#t-pct', '10'), () => p.fill('#t-amount', '1280'), () => p.fill('#t-people', '4')]), '小費');
      if (w === 390 && h === 844) {
        // 明細展開狀態下也一樣固定
        await p.click('#tab-tip'); await p.click('#t-out .more-btn');
        ok(await p.$eval('#t-out .lines', e => e.offsetHeight > 0) && await p.getAttribute('#t-out .more-btn', 'aria-expanded') === 'true', '「明細」展開');
        same(await states('tip', '#t-out', [() => p.fill('#t-people', '1'), () => p.fill('#t-amount', ''), () => p.fill('#t-amount', '1280'), () => p.fill('#t-people', '4')]), '小費（明細展開）');
        await p.click('#t-out .more-btn');
        ok(await p.$eval('#t-out .lines', e => e.offsetHeight === 0), '「明細」收合');
      }
      // 真實觸控連按：人數 + 從 1 按 40 次得 41；滿額規則交替 40/40（只量一次位置，手指不動）
      if (w === 360) { await ctx.close(); continue; } // 連按與打字只在 390×844、375×500 量，控制 CI 時間
      const cdp = await ctx.newCDPSession(p);
      const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
      const center = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await p.click('#tab-tip'); await p.fill('#t-people', '1'); await p.evaluate(() => document.querySelector('#t-plus').scrollIntoView({ block: 'center' }));
      const plus = await center('#t-plus');
      for (let i = 2; i <= 41; i++) { await tap(...plus); await p.waitForFunction(n => document.querySelector('#t-people').value === String(n), i, { timeout: 1500 }).catch(() => {}); }
      ok(await p.inputValue('#t-people') === '41', `${w}×${h} 人數 1 起連按 + 40 次 = ` + await p.inputValue('#t-people'));
      await p.fill('#t-people', '4');
      await p.click('#tab-spend'); await p.click('#s-mode-each'); await p.evaluate(() => document.querySelector('#s-mode-each').scrollIntoView({ block: 'center' }));
      const pe = await center('#s-mode-each'), po = await center('#s-mode-once'); let good = 0;
      for (let i = 0; i < 40; i++) {
        const v = i % 2 ? 'each' : 'once'; await tap(...(v === 'each' ? pe : po));
        if (await p.waitForFunction(v => document.querySelector('#s-mode-' + v).getAttribute('aria-pressed') === 'true', v, { timeout: 1500 }).then(() => true, () => false)) good++;
      }
      ok(good === 40, `${w}×${h} 滿額規則交替 ${good}/40`);
      // 打字時欄位不跳（shift2）
      const moves = [];
      for (const [tab, sel, vals, back] of [['disc', '#d-price', ['', '8', '89'], '1000'], ['spend', '#s-amount', ['', '5', '500'], '2350'], ['tip', '#t-amount', ['', '1'], '1280'], ['tip', '#t-people', ['', '1', '12'], '4']]) {
        await p.click('#tab-' + tab); await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel); await p.focus(sel);
        let y0 = await p.$eval(sel, e => e.getBoundingClientRect().top);
        for (const v of vals) { await p.fill(sel, v); const y = await p.$eval(sel, e => e.getBoundingClientRect().top); if (Math.abs(y - y0) > 0.5) moves.push(`${sel}="${v}" dy=${Math.round(y - y0)}`); y0 = y; }
        await p.fill(sel, back);
      }
      ok(moves.length === 0, `${w}×${h} 打字時欄位不移動 ` + moves.join(' '));
      await ctx.close();
    }
    // ---------- 11. 錯誤時頂端小價籤只寫短句 ----------
    {
      const { ctx, p } = await open(mobile(390, 470), 'mini-err');
      await p.fill('#d-rate2', 'abc'); await p.evaluate(() => { document.activeElement.blur(); scrollTo(0, 0); document.getElementById('d-rate2').focus(); });
      await p.waitForFunction(() => !document.querySelector('#mini').hidden);
      ok(await p.textContent('#mini b') === '「第二層折數」有誤', '小價籤錯誤短句：' + await p.textContent('#mini b'));
      ok((await p.textContent('#d-rate2-msg')).length > 4, '完整說明留在欄位下方');
      await ctx.close();
    }
    // ---------- 9. 舊版資料仍能載入 ----------
    {
      const { ctx, p } = await open(mobile(390, 844), 'legacy', () => {
        localStorage.setItem('discount-calc:v1:inputs', JSON.stringify({ disc: { price: '500', r1: '8', stack: false, r2: '9' }, nth: { price: '100', qty: 3, from: 3, rate: '5', cycle: false }, spend: { amount: '999', x: '500', y: '50', mode: 'once' }, tip: { amount: '300', pct: '15', people: 2, round: '10' } }));
        localStorage.setItem('discount-calc:v1:compare', JSON.stringify([{ id: 'a', name: '甲', price: '50', qty: '2', unit: '個' }]));
        localStorage.setItem('discount-calc:v1:tab', JSON.stringify('disc'));
      });
      ok(await txt(p, '#d-final') === '$400' && await txt(p, '#n-total') === '$250' && await p.locator('.pcard').count() === 1, '舊 localStorage 鍵資料照常載入');
      await ctx.close();
    }
    ok(errors.length === 0, '無 page error / console error ' + errors.join(' | '));
  } catch (e) { ok(false, '例外：' + (e && e.message || e)); }
  await browser.close(); srv.close();
  console.log(fails ? fails + ' 項失敗' : '全部通過'); process.exit(fails ? 1 : 0);
})();
