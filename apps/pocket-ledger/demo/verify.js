// 記帳本驗證腳本：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// 模擬發佈時的頁面骨架（doctype + viewport meta），再以 file:// 開啟
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ' + m); };
const ready = p => p.waitForSelector('html[data-ready="1"]');

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };
  const sizes = [
    { name: '390x844', w: 390, h: 844, mobile: true },
    { name: '360x780', w: 360, h: 780, mobile: true },
    { name: '844x390', w: 844, h: 390, mobile: true },
    { name: '1280x800', w: 1280, h: 800, mobile: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, s.name);
    await p.goto(URL); await ready(p); await p.waitForTimeout(150);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} 無水平捲動 (${sw[0]} <= ${sw[1]})`);
    await p.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      await p.click('#tabChart'); await p.waitForTimeout(150);
      await p.evaluate(() => document.querySelector('#paneChart').scrollIntoView());
      await p.screenshot({ path: `${OUT}/390x844-chart.png` });
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await ready(p); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await p.click('#tabChart'); await p.waitForTimeout(150);
    await p.evaluate(() => document.querySelector('#paneChart').scrollIntoView());
    await p.screenshot({ path: `${OUT}/390x844-dark-chart.png` });
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await ready(p);
  const mode = await p.evaluate(() => window.__ledger.store.mode);
  console.log('    storage mode:', mode);

  // parser
  const ex = await p.evaluate(() => ['0.1+0.2', '120+45', '100-30.5', '0', '', '1.234', '5-10', '12+', '99999999', '100000000', 'abc'].map(s => { const r = window.__ledger.parseExpr(s); return r.cents ?? (r.empty ? 'empty' : 'E'); }));
  console.log('    ', ex.join(' | '));
  assert(ex.join(',') === '30,16500,6950,E,empty,E,E,E,9999999900,E,E', '算式解析：0.1+0.2=30 分、120+45=165、驗證邊界');

  // 3-tap entry: clear sample first for clean numbers
  await p.click('#clearSample'); await p.click('#cfOk'); await p.waitForTimeout(100);
  assert(await p.isVisible('#firstEntry'), '空月份顯示「記下第一筆」');
  assert(await p.isDisabled('#cats .cat >> nth=0'), '空金額時分類按鈕停用');
  await p.fill('#amount', '0.1+0.2');
  assert((await p.textContent('#amountHint')).includes('0.3'), '提示顯示 = 0.3');
  await p.click('#cats .cat >> nth=0'); await p.waitForTimeout(80);
  let e1 = await p.evaluate(() => window.__ledger.entries.map(e => e.cents));
  assert(e1.length === 1 && e1[0] === 30, '0.1+0.2 存成 30 分');
    assert((await p.textContent('#sumOut')).includes('0.3'), '摘要顯示 0.3');
  await p.fill('#amount', '120+45'); await p.click('#cats .cat >> nth=1'); await p.waitForTimeout(80);
  await p.fill('#amount', '1,000'); await p.click('#cats .cat >> nth=0'); await p.waitForTimeout(80);
  await p.click('#typeIn'); await p.fill('#amount', '5000'); await p.click('#cats .cat >> nth=0'); await p.waitForTimeout(80); await p.click('#typeOut');
  const sums = await p.evaluate(() => [document.querySelector('#sumOut').textContent, document.querySelector('#sumIn').textContent, document.querySelector('#sumBal').textContent]);
  console.log('    ', sums);
  assert(sums[0].includes('1,165.3') && sums[1].includes('5,000') && sums[2].includes('3,834.7'), '月支出 1165.3／收入 5000／結餘 3834.7');
  // note with comma + future date
  await p.click('#moreBox summary');
  await p.fill('#note', '晚餐, 含"小費"');
  const fut = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 3); return d.toISOString().slice(0, 10); });
  await p.fill('#date', fut); await p.fill('#amount', '300'); await p.click('#cats .cat >> nth=0'); await p.waitForTimeout(80);
  // CSV
  const csv = await p.evaluate(() => window.__ledger.toCSV(window.__ledger.entries));
  console.log(csv.replace(/^﻿/, '').split('\r\n').slice(0, 7).map(l => '      ' + l).join('\n'));
  assert(csv.startsWith('﻿日期,類型,分類,金額,備註'), 'CSV 有 BOM 與標題');
  assert(csv.includes('"晚餐, 含""小費"""'), 'CSV 備註逗號／引號依 RFC 4180 包裹');
  const rt = await p.evaluate(c => { const r = window.__ledger.parseCSV(c); return r.map(x => x.length); }, csv);
  assert(rt.every(n => n === 5), 'CSV 重新解析每列 5 欄不錯位');
  const imp = await p.evaluate(() => { const r = window.__ledger.importCSV('日期,類型,分類,金額,備註\n2026-09-01,支出,餐飲,120.50,午餐\nbad,row\n2026/9/2,收入,薪資,30000,\n2026-09-03,支出,餐飲,-5,x\n2026-09-04,支出,新分類,88,"a,b"\n'); return { n: r.add.length, sk: r.skipped, note: r.add[2] && r.add[2].note }; });
  assert(imp.n === 3 && imp.sk.join(',') === '3,5' && imp.note === 'a,b', `CSV 匯入 3 筆、略過第 3、5 列`);
  // swipe delete + undo
  const row = await p.$('.entry'); const bb = await row.boundingBox();
  await row.dispatchEvent('pointerdown', { clientX: bb.x + bb.width - 20, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  for (let i = 1; i <= 6; i++) await p.dispatchEvent('.entry >> nth=0', 'pointermove', { clientX: bb.x + bb.width - 20 - i * 20, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  await p.dispatchEvent('.entry >> nth=0', 'pointerup', { clientX: bb.x + bb.width - 140, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/flow-swipe.png` });
  const before = await p.$$eval('.entry', x => x.length);
  await p.click('.erow .del >> nth=0'); await p.waitForTimeout(100);
  assert((await p.$$eval('.entry', x => x.length)) === before - 1, '左滑刪除');
  await p.click('#undoBtn'); await p.waitForTimeout(150);
  assert((await p.textContent('#ledger')).includes('預定'), '未來日期標示「預定」');
  assert((await p.$$eval('.entry', x => x.length)) === before, '復原');
  // edit
  await p.click('.entry >> nth=1'); await p.fill('#eAmount', '450'); await p.click('#eSave');
  await p.waitForTimeout(100);
  // budget
  await p.click('#openSettings'); await p.fill('#sBudget', '1500'); await p.click('#sDone');
  const bud = await p.evaluate(() => [document.querySelector('#budgetFill').className, document.querySelector('#budgetText').textContent]);
  console.log('    ', bud);
  assert(!(await p.isHidden('#budgetBox')), '預算進度條顯示');
  // category delete with merge
  await p.click('#openSettings'); await p.click('#sCats');
  await p.click('.lrow >> nth=0'); // 餐飲
  await p.click('#cDel');
  assert(await p.isVisible('#cMerge'), '刪除有紀錄分類要求選合併目標');
  const cnt0 = await p.evaluate(() => window.__ledger.entries.length);
  await p.click('#cDel'); await p.waitForTimeout(100);
  const after = await p.evaluate(() => ({ n: window.__ledger.entries.length, orphan: window.__ledger.entries.filter(e => !window.__ledger.cats.some(c => c.id === e.catId)).length, cats: window.__ledger.cats.length }));
  assert(after.n === cnt0 && after.orphan === 0, '合併後紀錄不遺失');
  await p.click('#cBack'); await p.click('#sDone');
  // chart with single category -> full ring; legend click filters
  await p.click('#tabChart'); await p.waitForTimeout(150);
  await p.screenshot({ path: `${OUT}/flow-chart.png` });
  await p.click('#legend button >> nth=0'); await p.waitForTimeout(100);
  assert(await p.isVisible('#clearFilter'), '點圖例篩選明細並切回明細');
  await p.screenshot({ path: `${OUT}/flow-filter.png` });
  await p.click('#clearFilter');
  // empty month
  await p.click('#prevMonth'); await p.click('#prevMonth'); await p.click('#prevMonth');
  await p.click('#tabChart'); await p.waitForTimeout(100);
  assert((await p.textContent('#donutTotal')).length > 0, '空月份圓餅不出錯');
  await p.click('#monthLabel');
  // perf: 1000 entries
  const perf = await p.evaluate(async () => {
    const L = window.__ledger, cats = L.cats.filter(c => c.type === 'out'), list = [];
    const now = new Date();
    for (let i = 0; i < 1000; i++) { const d = new Date(now.getFullYear(), now.getMonth() - (i % 12), 1 + (i % 27)); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); list.push({ id: 'p' + i, date: ds, month: ds.slice(0, 7), type: 'out', catId: cats[i % cats.length].id, cents: 100 + i * 7, note: 'perf ' + i, sample: false, createdAt: i }); }
    await L.addEntries(list);
    const t0 = performance.now(); document.querySelector('#prevMonth').click(); const t1 = performance.now();
    document.querySelector('#nextMonth').click();
    return t1 - t0;
  });
  assert(perf < 100, `1,000 筆時切月 ${perf.toFixed(1)}ms < 100ms`);
  // persistence
  await p.reload(); await ready(p);
  const persisted = await p.evaluate(() => window.__ledger.entries.length);
  assert(persisted > 1000, `重新整理後資料仍在（${persisted} 筆，${mode}）`);
  // export fallback (no downloads capability here)
  await p.click('#openSettings'); await p.click('#csvMonth'); await p.waitForTimeout(150);
  assert(await p.isVisible('#expOut') || (await p.textContent('#toastLayer')).includes('複製'), 'downloads 不可用時改為複製 CSV');
  await p.click('#sDone');
  // corrupt storage
  await p.evaluate(() => { localStorage.setItem('pocket-ledger:v1:categories', '{x'); localStorage.setItem('pocket-ledger:v1:settings', 'null'); });
  await p.reload(); await ready(p);
  assert(await p.isVisible('#cats .cat'), '設定被改壞後仍正常顯示');
  await ctx.close();

  // localStorage fallback when IndexedDB is missing
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await c2.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined }); } catch (e) {} });
    const q = await c2.newPage(); watch(q, 'nodb');
    await q.goto(URL); await ready(q);
    const m = await q.evaluate(() => window.__ledger.store.mode);
    await q.fill('#amount', '88'); await q.click('#cats .cat >> nth=0'); await q.waitForTimeout(150);
    await q.reload(); await ready(q);
    const has = await q.evaluate(() => window.__ledger.entries.some(e => e.cents === 8800));
    assert(m === 'ls' && has, 'IndexedDB 不可用時退回 localStorage 並保存');
    await c2.close();
  }

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
