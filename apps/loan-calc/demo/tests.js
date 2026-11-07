// 貸款試算：上架評分 toFix 的回歸測試（node tests.js，約 15 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
// 用本機 http 伺服：file:// 在高負載下重新整理時，新頁面偶爾讀到舊的 localStorage（瀏覽器端的問題，http 不會）
const srv = http.createServer((q, r) => { if (q.url === '/') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); } else { r.writeHead(204); r.end(); } });
let URL = '';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const BASE = { amount: '1000', rate: '2', years: 30, grace: 0, method: 'equal', segments: [], prepays: [], preMode: 'reduce' };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opt });
    if (init) await ctx.addInitScript(init.fn, init.arg);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForSelector('#monthly');
    return { ctx, p };
  }
  const tap = async (p, cdp, sel) => {
    const b = await p.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const run = (p, inp) => p.evaluate(([b, i]) => { const r = window.__loanCalc.compute(Object.assign({}, b, i)); if (r.error) return { error: r.error, field: r.field, row: r.row }; const s = r.schedule; return { n: s.length, ti: r.summary.totalInterest, lastB: s[s.length - 1].balance, sumP: s.reduce((a, x) => a + x.principal + x.extra, 0), pay: s.map(x => x.payment), max: r.summary.max }; }, [BASE, inp]);

  // ---- 1. 縮短模式＋之後利率變動（D4、D7）：保留縮短後的到期日 ----
  {
    const { ctx, p } = await open();
    let r = await run(p, { prepays: [{ n: 60, wan: '200' }], preMode: 'shorten', segments: [{ from: 120, rate: '2.1' }] });
    assert(r.n === 277 && r.ti === 2268699 && r.lastB === 0 && r.sumP === 10000000, `D4 縮短＋第 120 期升息：${r.n} 期、總利息 ${r.ti}（應 277、2,268,699）`);
    assert(r.pay[119] > r.pay[118], `D4 升息後月付上升 ${r.pay[118]} → ${r.pay[119]}`);
    r = await run(p, { method: 'principal', prepays: [{ n: 60, wan: '300' }], preMode: 'shorten', segments: [{ from: 100, rate: '2.5' }] });
    assert(r.n === 252 && r.ti === 1912173 && r.lastB === 0, `D7 本金平均縮短＋升息：${r.n} 期、總利息 ${r.ti}（應 252、1,912,173）`);
    r = await run(p, { prepays: [{ n: 60, wan: '200' }], preMode: 'shorten' });
    assert(r.n === 277 && r.ti === 2230755, `D2 縮短（無利率變動）不變：${r.n} 期、${r.ti}`);
    r = await run(p, { method: 'principal', prepays: [{ n: 60, wan: '200' }], preMode: 'shorten' });
    assert(r.n === 288 && r.ti === 2126651, `D5 本金平均縮短不變：${r.n} 期、${r.ti}`);
    r = await run(p, { rate: '0', prepays: [{ n: 12, wan: '100' }], preMode: 'shorten', segments: [{ from: 24, rate: '1' }] });
    assert(r.n < 360 && r.lastB === 0 && r.sumP === 10000000, `0% 縮短＋之後利率變動仍提早結清（${r.n} 期）`);
    r = await run(p, { grace: 2, prepays: [{ n: 12, wan: '100' }], preMode: 'shorten' });
    assert(r.n === 360 && r.lastB === 0, `寬限期內提前還款照原規則重算月付（${r.n} 期）`);
    // UI 也顯示縮短後的期數
    await p.click('#adv-box summary'); await p.click('#pre-mode-shorten');
    await p.click('#pre-add'); await p.fill('#pre-wan-0', '200');
    await p.click('#seg-add'); await p.fill('#seg-from-0', '120'); await p.fill('#seg-rate-0', '2.1');
    assert((await p.textContent('#total-interest')).startsWith('2,268,699') && (await p.textContent('#summary')).includes('277 期'), 'UI：縮短＋升息顯示 277 期、總利息 2,268,699');
    await ctx.close();
  }

  // ---- 2. 本金平均＋升息：摘要用實際最高／最低 ----
  {
    const { ctx, p, } = await open(390, 844, {}, { fn: b => { if (localStorage.getItem('test:seeded')) return; localStorage.setItem('test:seeded', 1); localStorage.setItem('loan-calc:v1:inputs', JSON.stringify(Object.assign({}, b, { method: 'principal', segments: [{ from: 13, rate: '5' }] }))); }, arg: BASE });
    const [k, sub] = await p.evaluate(() => [document.querySelector('#summary .k').textContent, document.querySelector('.subline').textContent]);
    assert(!k.includes('最高') && sub.includes('最高 68,056'), `C2 本金平均＋升息：標籤「${k}」、${sub}`);
    await p.click('#adv-box summary'); await p.click('[data-rm="seg"][data-i="0"]');
    const k2 = await p.textContent('#summary .k');
    assert(k2.includes('首期最高月付') && (await p.textContent('.subline')).includes('最低'), '本金平均（遞減）仍寫「首期最高月付」');
    await ctx.close();
  }

  // ---- 3. 短畫面：結果靠近輸入 ----
  for (const [w, h] of [[844, 390], [375, 500], [390, 470]]) {
    const { ctx, p } = await open(w, h);
    const t = await p.evaluate(() => { const vis = el => el && el.offsetParent && el.getBoundingClientRect().bottom <= innerHeight; return [vis(document.querySelector('#monthly')), vis(document.querySelector('#live')), document.querySelector('#live').textContent, document.documentElement.scrollWidth <= innerWidth]; });
    assert((t[0] || (t[1] && t[2].includes('36,962'))) && t[3], `${w}×${h}：月付在第一屏內（摘要 ${t[0]}／即時列 ${t[1]}），無橫向捲動`);
    if (w === 375) {
      await p.fill('#amount', '600');
      assert((await p.textContent('#live')).includes('22,177'), '改金額時即時列跟著更新：' + (await p.textContent('#live')));
    }
    await ctx.close();
  }

  // ---- 4. 刪除可復原 ＋ 5. 壞資料 ＋ 6. 輸入格式 ＋ 7. 列錯誤 ----
  {
    let { ctx, p } = await open(390, 844, {}, { fn: () => { if (!localStorage.getItem('test:seeded')) { localStorage.setItem('test:seeded', 1); localStorage.setItem('loan-calc:v1:inputs', JSON.stringify({ amount: '800', rate: '2.2', years: 20, segments: [null, { from: 13, rate: '2.5' }, 3, 'x'], prepays: [null, [1], { n: 24, wan: '50' }] })); localStorage.setItem('loan-calc:v1:scenarios', JSON.stringify([null, { inputs: { amount: '500', rate: '2', years: 20, segments: [null], prepays: [null] } }])); } } });
    const st = await p.evaluate(() => [document.querySelector('#amount').value, document.querySelectorAll('#seg-list .rrow').length, document.querySelector('#seg-rate-0').value, document.querySelectorAll('#pre-list .rrow').length, document.querySelector('#monthly').textContent, document.querySelectorAll('[data-rm-scn]').length]);
    assert(st[0] === '800' && st[1] === 1 && st[2] === '2.5' && st[3] === 1 && /\d/.test(st[4]) && st[5] === 1, '舊鍵含 null／非物件列時仍載入並略過壞列 ' + JSON.stringify(st));
    // 刪除利率段 → 復原
    await p.click('#adv-box summary');
    await p.click('#seg-add'); await p.fill('#seg-rate-1', '3');
    const before = await p.textContent('#monthly');
    await p.click('[data-rm="seg"][data-i="0"]');
    assert((await p.locator('#seg-list .rrow').count()) === 1 && await p.isVisible('#undo-btn'), '刪除利率段後出現「復原」');
    const ub = await p.locator('#undo-btn').boundingBox();
    assert(ub.width >= 44 && ub.height >= 44, `復原按鈕 ≥44px（${Math.round(ub.width)}×${Math.round(ub.height)}）`);
    await p.click('#undo-btn');
    assert((await p.inputValue('#seg-rate-0')) === '2.5' && (await p.inputValue('#seg-rate-1')) === '3' && (await p.textContent('#monthly')) === before, '復原後利率段回到原位置、月付不變');
    // 提前還款
    await p.click('[data-rm="pre"][data-i="0"]'); assert((await p.locator('#pre-list .rrow').count()) === 0, '刪除提前還款');
    await p.click('#undo-btn'); assert((await p.inputValue('#pre-wan-0')) === '50', '復原提前還款');
    // 方案
    await p.click('#cmp-save'); await p.click('[data-rm-scn="0"]');
    assert((await p.locator('[data-rm-scn]').count()) === 1, '移除方案 A');
    await p.click('#undo-btn');
    assert((await p.locator('[data-rm-scn]').count()) === 2 && (await p.textContent('#cmp-table thead')).includes('方案 A'), '復原方案');
    await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('loan-calc:v1:inputs')).segments.length === 2 && JSON.parse(localStorage.getItem('loan-calc:v1:scenarios')).length === 2; } catch (e) { return false; } });
    await p.reload(); await p.waitForSelector('#monthly');
    { const c = [await p.locator('#seg-list .rrow').count(), await p.locator('[data-rm-scn]').count()]; assert(c[0] === 2 && c[1] === 2, '復原後的資料重新整理仍在 ' + c); }

    // 輸入格式
    const cases = [['１０００', '36,962'], ['1000萬', '36,962'], ['1,000', '36,962']];
    await ctx.close(); ({ ctx, p } = await open());
    for (const [v, want] of cases) { await p.fill('#amount', v); assert((await p.textContent('#err')) === '' && (await p.textContent('#monthly')) === want, `金額「${v}」→ 月付 ${want}`); }
    await p.fill('#amount', '1000'); await p.fill('#rate', '2%'); assert((await p.textContent('#monthly')) === '36,962', '利率「2%」可接受');
    await p.fill('#rate', '２．０'); assert((await p.textContent('#monthly')) === '36,962', '全形「２．０」可接受');
    await p.fill('#rate', '2');
    for (const v of ['0x10', 'abc', '1e3', '10元']) { await p.fill('#amount', v); const e = await p.textContent('#err'); assert(e.includes('請輸入數字') && await p.$eval('#amount', el => el.classList.contains('bad')), `金額「${v}」→ ${e}`); }
    await p.fill('#amount', ''); assert((await p.textContent('#err')).includes('請輸入貸款金額'), '空白金額 → 請輸入貸款金額');
    await p.fill('#amount', '0'); assert((await p.textContent('#err')).includes('1～100,000'), '金額 0 → 範圍說明');
    await p.fill('#amount', '1000');
    // 列錯誤：第 N 列＋該欄標紅
    await p.click('#adv-box summary'); await p.click('#seg-add'); await p.click('#seg-add');
    await p.fill('#seg-rate-0', '2.1'); await p.fill('#seg-rate-1', '2.3'); await p.fill('#seg-from-1', '1');
    let e = await p.textContent('#err'), bad = await p.evaluate(() => [...document.querySelectorAll('#adv-box input.bad')].map(x => x.id));
    assert(e.includes('第 2 列') && JSON.stringify(bad) === '["seg-from-1"]', `分段利率列錯誤：${e} ${bad}`);
    await p.fill('#seg-from-1', '25'); await p.fill('#seg-rate-1', '40');
    bad = await p.evaluate(() => [...document.querySelectorAll('#adv-box input.bad')].map(x => x.id));
    assert(JSON.stringify(bad) === '["seg-rate-1"]', '利率超範圍標紅該列利率欄 ' + bad);
    await p.fill('#seg-rate-1', '2.3');
    await p.click('#pre-add'); await p.fill('#pre-wan-0', '0');
    e = await p.textContent('#err'); bad = await p.evaluate(() => [...document.querySelectorAll('#adv-box input.bad')].map(x => x.id));
    assert(e.includes('提前還款第 1 列') && JSON.stringify(bad) === '["pre-wan-0"]', `提前還款列錯誤：${e} ${bad}`);
    await p.fill('#pre-wan-0', '100'); assert((await p.textContent('#err')) === '' && (await p.locator('#adv-box input.bad').count()) === 0, '修正後錯誤與紅框消失');
    await ctx.close();
  }

  // ---- 8. 攤還表可橫向捲動時有提示 ----
  {
    const { ctx, p } = await open(360, 640);
    await p.fill('#amount', '100000'); await p.fill('#rate', '30'); await p.fill('#years', '40');
    await p.click('#view-month'); await p.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 480);
    const h = await p.evaluate(() => { const w = document.querySelector('#tbl-wrap'); return [w.scrollWidth > w.clientWidth + 2, !document.querySelector('#scroll-hint').hidden, document.querySelector('#tbl-outer').classList.contains('more')]; });
    assert(h[0] ? h[1] && h[2] : !h[1], '360 寬大金額：表格溢出時顯示「可左右滑動」與右側漸層 ' + JSON.stringify(h));
    if (h[0]) { await p.$eval('#tbl-wrap', w => { w.scrollLeft = w.scrollWidth; }); await p.waitForFunction(() => !document.querySelector('#tbl-outer').classList.contains('more')); assert(true, '捲到最右時漸層消失'); }
    // 13. 極大金額：數字與「元」同一行
    const lines = await p.evaluate(() => ['#total-interest', '#total-paid'].map(s => { const b = document.querySelector(s), lh = parseFloat(getComputedStyle(b).lineHeight) || 20; return b.getBoundingClientRect().height < lh * 1.5; }));
    assert(lines.every(Boolean), '極大金額時摘要「…元」不換行 ' + lines);
    const hero = await p.evaluate(() => { const v = document.querySelector('#monthly').getBoundingClientRect(), u = document.querySelector('.hero .u').getBoundingClientRect(); return Math.abs(v.bottom - u.bottom) < 12 && u.right <= innerWidth; });
    assert(hero, '極大月付時「元／月」與數字同一行');
    await p.fill('#amount', '1000'); await p.fill('#rate', '2'); await p.fill('#years', '30');
    const h2 = await p.evaluate(() => { const w = document.querySelector('#tbl-wrap'); return [w.scrollWidth > w.clientWidth + 2, !document.querySelector('#scroll-hint').hidden]; });
    assert(h2[0] === h2[1], '提示只在真的溢出時顯示 ' + h2);
    await ctx.close();
  }

  // ---- 9. 圖表刻度 ＋ 10. 按月表格分批 ＋ 11. 提示計時器 ＋ 12. 剪貼簿退路 ----
  {
    const { ctx, p } = await open(390, 844, {}, { fn: () => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')), readText: () => Promise.resolve('') }, configurable: true }); } });
    const ticks = await p.evaluate(() => { const L = window.__loanCalc, out = []; for (let v = 1000; v < 2e10; v *= 1.37) { const m = L.niceMax(v), st = m / 4, p = Math.pow(10, Math.floor(Math.log10(st))), mant = +(st / p).toFixed(6); out.push([v, m, mant, m >= v]); } return out; });
    assert(ticks.every(t => [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].includes(t[2]) && t[3]), '圖表刻度：上限 ≥ 資料，四等分都是整齊步長 ' + JSON.stringify(ticks.filter(t => ![1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].includes(t[2]) || !t[3]).slice(0, 3)));
    const sh = await p.evaluate(() => [window.__loanCalc.short(125000000), window.__loanCalc.short(375000000), window.__loanCalc.short(2500000), window.__loanCalc.niceMax(10000000)]);
    assert(sh[0] === '1.25億' && sh[1] === '3.75億' && sh[2] === '250萬' && sh[3] === 10000000, '刻度文字不四捨五入：' + sh.join('、'));
    // 按月檢視：輸入時同步只畫前 60 列，其餘隨後補齊
    await p.fill('#years', '40'); await p.click('#view-month');
    await p.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 480);
    const sync = await p.evaluate(() => { const el = document.querySelector('#amount'); el.value = '1200'; const t0 = performance.now(); el.dispatchEvent(new Event('input', { bubbles: true })); return [document.querySelectorAll('#tbody tr').length, performance.now() - t0]; });
    assert(sync[0] <= 60, `按月 480 列：輸入當下只重建 ${sync[0]} 列（${sync[1].toFixed(1)} ms）`);
    await p.waitForFunction(() => document.querySelectorAll('#tbody tr').length === 480 && document.querySelector('#tbody tr:last-child td:last-child').textContent === '0');
    assert(true, '其餘列隨後補齊，最後一列剩餘本金 0');
    await p.click('#view-year'); await p.waitForTimeout(50);
    assert((await p.locator('#tbody tr').count()) === 40, '切回按年不被延後的按月補列污染');
    await p.fill('#years', '30'); await p.fill('#amount', '1000');
    // 剪貼簿被拒：顯示可見、已全選的文字框
    await p.click('#copy-sum');
    await p.waitForSelector('#copy-sheet:not([hidden])');
    const cs = await p.evaluate(() => { const t = document.querySelector('#copy-ta'), r = t.getBoundingClientRect(); return [t.value.includes('36,962'), t.selectionStart === 0 && t.selectionEnd === t.value.length, r.height > 60 && r.width > 200, document.activeElement === t]; });
    assert(cs.every(Boolean), '剪貼簿被拒時顯示可見且全選的文字框 ' + cs);
    const cb = await p.locator('#copy-close').boundingBox();
    assert(cb.height >= 44 && cb.width >= 44, '「關閉」按鈕 ≥44px');
    await p.click('#copy-close'); assert(await p.isHidden('#copy-sheet'), '按「關閉」收起');
    await ctx.close();
  }
  {
    // 圖表提示：第一次點的 1.6 秒計時器不會收掉第二次點的提示（用假時鐘，與機器負載無關）
    const { ctx, p } = await open(390, 844);
    await p.clock.install(); await p.reload(); await p.waitForSelector('#monthly');
    const cdp = await ctx.newCDPSession(p);
    await p.locator('#chart').scrollIntoViewIfNeeded();
    const b = await p.locator('#chart').boundingBox();
    const tapAt = async x => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: b.y + 100 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    await tapAt(b.x + b.width * 0.3);
    assert(await p.isVisible('#tip'), '點圖表顯示提示');
    await p.clock.runFor(1000);
    await tapAt(b.x + b.width * 0.7);
    const t2 = await p.textContent('#tip');
    await p.clock.runFor(700);
    assert(await p.isVisible('#tip') && (await p.textContent('#tip')) === t2, '1 秒內再點另一年，0.7 秒後提示仍在');
    await p.clock.runFor(1000);
    assert(await p.isHidden('#tip'), '放開 1.6 秒後提示收起');
    // 觸控切換還款方式：不重複、不遺漏
    let wrong = 0;
    await p.locator('#method-equal').scrollIntoViewIfNeeded();
    for (let i = 0; i < 10; i++) { const id = i % 2 ? '#method-equal' : '#method-principal'; await tap(p, cdp, id); if ((await p.getAttribute(id, 'aria-pressed')) !== 'true') wrong++; }
    assert(wrong === 0, '觸控交替切換還款方式 10 次無遺漏');
    await ctx.close();
  }

  await browser.close(); srv.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.slice(0, 3).join(' | '));
  console.log(fails ? fails + ' 項失敗' : '全部通過'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
