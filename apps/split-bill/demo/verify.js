// 分帳小幫手驗證腳本：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// 模擬發佈時的頁面骨架（doctype + viewport meta），再以 file:// 開啟
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const sizes = [
    { name: '390x844', w: 390, h: 844, mobile: true },
    { name: '360x780', w: 360, h: 780, mobile: true },
    { name: '844x390', w: 844, h: 390, mobile: true },
    { name: '1280x800', w: 1280, h: 800, mobile: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(s.name + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(s.name + ': ' + e.message));
    await p.goto(URL);
    await p.waitForTimeout(200);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} 無水平捲動 (${sw[0]} <= ${sw[1]})`);
    await p.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: false });
    await ctx.close();
  }

  // dark
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('dark: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await p.evaluate(() => scrollTo(0, 9999)); await p.waitForTimeout(100);
    await p.screenshot({ path: `${OUT}/390x844-dark-result.png` });
    await ctx.close();
  }

  // logic + flow
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push('flow: ' + m.text()); });
  p.on('pageerror', e => errors.push('flow: ' + e.message));
  await p.goto(URL); await p.waitForTimeout(200);

  // sample event check: nets a -180, b +2280, c -900, d -1200
  const sampleNets = await p.evaluate(() => { const ev = JSON.parse(localStorage.getItem('split-bill:v1:events'))[0]; return window.__splitBill.computeNets(ev).map(r => r.name + ':' + r.net); });
  assert(sampleNets.join(',') === '小明:-18000,小華:228000,小美:-90000,阿傑:-120000', '範例淨額與手算一致 ' + sampleNets.join(','));

  // 100 元 3 人均分
  const eq = await p.evaluate(() => { const m = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; return window.__splitBill.allocate({ amountCents: 10000, mode: 'equal', shares: { a: 1, b: 1, c: 1 } }, m); });
  assert(eq.a === 3334 && eq.b === 3333 && eq.c === 3333, '100 元 3 人均分 = 33.34/33.33/33.33');
  // ratio 2:1:1 of 1001
  const ra = await p.evaluate(() => { const m = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; return window.__splitBill.allocate({ amountCents: 100100, mode: 'ratio', shares: { a: 2, b: 1, c: 1 } }, m); });
  assert(ra.a + ra.b + ra.c === 100100 && ra.a === 50050, '比例 2:1:1 分 1001 元，加總正確 ' + JSON.stringify(ra));
  // 4 人複雜案例
  const four = await p.evaluate(() => {
    const rows = [{ id: 'A', net: 5000 }, { id: 'B', net: -2000 }, { id: 'C', net: -3500 }, { id: 'D', net: 500 }];
    const xs = window.__splitBill.settle(rows);
    const bal = { A: 5000, B: -2000, C: -3500, D: 500 };
    xs.forEach(x => { bal[x.from] += x.c; bal[x.to] -= x.c; });
    return { n: xs.length, zero: Object.values(bal).every(v => v === 0) };
  });
  assert(four.n <= 3 && four.zero, `4 人案例轉帳 ${four.n} 次且淨額歸零`);
  // exact matching
  const ex = await p.evaluate(() => window.__splitBill.settle([{ id: 'A', net: 300 }, { id: 'B', net: 700 }, { id: 'C', net: -300 }, { id: 'D', net: -700 }]));
  assert(ex.length === 2, '完全相等配對 2 筆');
  // parse validation
  const pv = await p.evaluate(() => ['0', '-5', '', '1.234', '10000000', '9999999', '0.01'].map(s => { const r = window.__splitBill.parseAmount(s); return r.err ? 'E' : r.cents; }));
  assert(pv.join(',') === 'E,E,E,E,E,999999900,1', '金額驗證 ' + pv.join(','));

  // UI flow: new event, add 3 members, add 100 expense equal
  await p.click('#menuBtn'); await p.click('#mNew');
  for (const n of ['阿德', '小玉', '老王']) {
    await p.click('#addMember'); await p.fill('#mName', n); await p.click('#mSave');
  }
  // duplicate name
  await p.click('#addMember'); await p.fill('#mName', ' 小玉 '); await p.click('#mSave');
  assert((await p.textContent('#mErr')) === '已有同名成員', '重複名稱擋下');
  await p.click('#mCancel');
  await p.fill('#eventName', '測試晚餐');
  await p.click('#addExp');
  await p.fill('#xTitle', '晚餐');
  await p.fill('#xAmount', '0');
  assert(await p.isDisabled('#xSave'), '金額 0 時無法儲存');
  assert((await p.textContent('#xAmtErr')).length > 0, '金額 0 顯示錯誤');
  await p.fill('#xAmount', '100');
  await p.click('#xSave');
  let res = await p.$$eval('#receipt tbody tr', trs => trs.map(t => t.textContent.replace(/\s+/g, ' ').trim()));
  console.log('    ', res);
  assert(res[0].includes('$33.34') && res[1].includes('$33.33'), '介面顯示 33.34／33.33');
  // custom amount mismatch
  await p.click('#addExp');
  await p.fill('#xAmount', '300');
  await p.click('#payer-' + (await p.$eval('#xPayer button:nth-child(2)', b => b.dataset.p)));
  await p.click('#modeAmount');
  const amtInputs = await p.$$('#xRows input');
  await amtInputs[0].fill('100'); await amtInputs[1].fill('100');
  assert((await p.textContent('#xSumMsg')).includes('尚差 $100'), '自訂金額尚差提示');
  assert(await p.isDisabled('#xSave'), '加總不符禁止儲存');
  await amtInputs[2].fill('100');
  assert(!(await p.isDisabled('#xSave')), '加總相符可儲存');
  await p.click('#xSave');
  const xf = await p.$$eval('.xf', x => x.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  console.log('    ', xf);
  // copy text
  await p.click('#copyBtn');
  await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
  console.log('    clipboard:\n' + clip);
  if (clip) assert(clip.startsWith('【測試晚餐】分帳結果（共 $400，3 人）'), '複製文字格式正確');
  // swipe delete + undo
  const card = await p.$('.card');
  const bb = await card.boundingBox();
  await p.evaluate(() => {});
  await card.dispatchEvent('pointerdown', { clientX: bb.x + bb.width - 20, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  for (let i = 1; i <= 6; i++) await p.dispatchEvent('.card', 'pointermove', { clientX: bb.x + bb.width - 20 - i * 20, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  await p.dispatchEvent('.card', 'pointerup', { clientX: bb.x + bb.width - 140, clientY: bb.y + 20, pointerId: 1, bubbles: true });
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/flow-swipe.png` });
  await p.click('.item .del');
  assert((await p.$$('.card')).length === 1, '左滑刪除後剩 1 筆');
  await p.click('#undoBtn');
  assert((await p.$$('.card')).length === 2, '復原後回到 2 筆');
  await p.screenshot({ path: `${OUT}/flow-result.png`, fullPage: true });
  // open sheet screenshot
  await p.click('#addExp'); await p.fill('#xAmount', '1001'); await p.click('#modeRatio');
  const rIn = await p.$$('#xRows input'); await rIn[0].fill('2');
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/flow-sheet.png` });
  await p.click('#xCancel');

  // corrupt storage
  await p.evaluate(() => { localStorage.setItem('split-bill:v1:events', '{oops'); });
  await p.reload(); await p.waitForTimeout(200);
  assert((await p.$$('.chip')).length > 1, '儲存內容損壞時仍正常顯示（重建範例）');
  await p.evaluate(() => { localStorage.setItem('split-bill:v1:events', JSON.stringify([{ id: 'x', members: [{ id: 1 }], expenses: 'bad' }])); });
  await p.reload(); await p.waitForTimeout(200);
  assert(await p.isVisible('#addExp'), '部分損壞資料不白畫面');

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
})().catch(e => { console.error(e); process.exit(1); });
