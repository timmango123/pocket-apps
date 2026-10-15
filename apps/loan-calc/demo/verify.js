// 貸款試算驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };
  for (const [name, w, h, mob] of [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(URL); await p.waitForTimeout(200);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`); assert(sw <= iw, `${name} 無水平捲動 (${sw})`);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      await p.click('#adv-box summary'); await p.click('#seg-add'); await p.fill('#seg-rate-0', '2.1'); await p.click('#pre-add'); await p.fill('#pre-wan-0', '100');
      await p.waitForTimeout(100);
      const sw2 = await p.evaluate(() => document.documentElement.scrollWidth); assert(sw2 <= iw, '進階欄位展開後無水平捲動');
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, summary')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className || e.textContent.slice(0, 6), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
      await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
      await p.evaluate(() => localStorage.clear());
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    const col = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--principal').trim());
    assert(col === '#5cc391', '深色模式圖表色取自深色 token ' + col);
    await p.screenshot({ path: `${OUT}/390x844-dark-full.png`, fullPage: true });
    await ctx.close();
  }
  // 邏輯
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(200);
  const C = (inp) => p.evaluate(i => { const r = window.__loanCalc.compute(Object.assign({ amount: '1000', rate: '2', years: 30, grace: 0, method: 'equal', segments: [], prepays: [], preMode: 'reduce' }, i)); if (r.error) return { error: r.error }; const s = r.schedule; return { first: r.summary.first, n: s.length, last: s[s.length - 1], sumP: s.reduce((a, x) => a + x.principal + x.extra, 0), ti: r.summary.totalInterest, nan: s.some(x => [x.payment, x.principal, x.interest, x.balance].some(v => !Number.isFinite(v))), pay: s.map(x => x.payment) }; }, inp);
  assert((await p.textContent('#monthly')) === '36,962', '1000 萬、2%、30 年本息平均月付 36,962');
  let r = await C({});
  assert(r.last.balance === 0 && r.sumP === 10000000 && r.n === 360, '最後一期剩餘本金 0，本金合計 1000 萬');
  assert(r.ti === r.pay.reduce((a, b) => a + b, 0) - 10000000, '總利息 = 總月付 − 本金 (' + r.ti + ')');
  r = await C({ rate: '0' });
  assert(!r.nan && r.first === 27778 && r.last.balance === 0, '利率 0% 無 NaN，月付 = 本金/期數 ≈ 27,778');
  r = await C({ method: 'principal' });
  assert(r.first === 44445 && r.pay[359] < r.pay[0] && r.last.balance === 0, '本金平均首期 44,445（27,778 + 16,667），逐期遞減');
  r = await C({ grace: 2 });
  assert(r.pay[0] === 16667 && r.pay[23] === 16667 && r.pay[24] > 36962 && r.last.balance === 0, '寬限 2 年：前 24 期只繳息 16,667，之後 ' + r.pay[24]);
  r = await C({ amount: '600', rate: '1.775', years: 20, segments: [{ from: 13, rate: '2.1' }] });
  assert(r.pay[12] > r.pay[0] && r.last.balance === 0, '分段利率：第 13 期起月付由 ' + r.pay[0] + ' 調整為 ' + r.pay[12]);
  const red = await C({ prepays: [{ n: 60, wan: '200' }] }), sh = await C({ prepays: [{ n: 60, wan: '200' }], preMode: 'shorten' });
  assert(red.n === 360 && red.pay[60] < red.pay[59] && sh.n < 360 && sh.pay[60] === sh.pay[59] && sh.last.balance === 0, `提前還 200 萬：降月付 ${red.pay[60]}／縮短為 ${sh.n} 期`);
  for (const [k, v] of [['amount', '0'], ['amount', '100001'], ['rate', '31'], ['years', '41']]) {
    await p.fill('#' + k, v); assert((await p.textContent('#err')).length > 0, `${k}=${v} 顯示錯誤`);
  }
  await p.fill('#amount', '1000'); await p.fill('#rate', '2'); await p.fill('#years', '40');
  await p.click('#view-month');
  const t0 = Date.now(); await p.fill('#years', '40'); const rows = await p.locator('#tbody tr').count();
  assert(rows === 480, '40 年按月攤還表 480 列（' + (Date.now() - t0) + 'ms）');
  const lastRow = await p.textContent('#tbody tr:last-child td:last-child');
  assert(lastRow === '0', '攤還表最後一列剩餘本金 0');
  await p.click('#view-year'); assert((await p.locator('#tbody tr').count()) === 40, '按年彙總 40 列');
  await p.fill('#years', '30');
  // 圖表拖曳
  const box = await p.locator('#chart').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + 100);
  assert(await p.isVisible('#tip') && (await p.textContent('#tip')).includes('第'), '圖表提示框顯示：' + (await p.textContent('#tip')).slice(0, 20));
  // 比較
  await p.click('#cmp-save'); await p.fill('#rate', '2.5'); await p.click('#cmp-save');
  assert(await p.isVisible('#cmp-card') && (await p.locator('#cmp-table td.best').count()) === 1 && (await p.textContent('#cmp-table')).includes('多 '), '方案比較：總利息最低者加粗並顯示差額');
  // CSV 複製（無 downloads 能力）
  await p.click('#csv-btn'); await p.waitForTimeout(100);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip.startsWith('期數,月付,本金,利息') && clip.trim().split('\n').length === 361, '無下載能力時複製 CSV（361 行）');
  await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(200);
  assert((await p.inputValue('#rate')) === '2.5' && await p.isVisible('#cmp-card'), '重新整理後保留輸入與方案');
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  await ctx.close();
  // downloads 能力模擬
  {
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx2.addInitScript(() => { window.__saved = null; window.claude = { use: async n => n === 'downloads' ? { save: async o => { window.__saved = o; } } : null }; });
    const p2 = await ctx2.newPage(); watch(p2, 'dl');
    await p2.goto(URL); await p2.waitForTimeout(200);
    assert((await p2.textContent('#csv-btn')) === '匯出 CSV', '有 downloads 能力時顯示「匯出 CSV」');
    await p2.click('#csv-btn'); await p2.waitForTimeout(100);
    const sv = await p2.evaluate(() => window.__saved && [window.__saved.filename, window.__saved.data.charCodeAt(0)]);
    assert(sv && /\.csv$/.test(sv[0]) && sv[1] === 0xfeff, 'dl.save 收到 CSV 檔名與 UTF-8 BOM ' + JSON.stringify(sv));
    await ctx2.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? fails + ' 項失敗' : '全部通過'); process.exit(fails ? 1 : 0);
})();
