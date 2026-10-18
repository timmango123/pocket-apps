// 發票對獎驗證腳本：node verify.js
// 在 390×844 與大廳三種 iframe 尺寸、淺色與深色下開啟，檢查無錯誤、主要流程可用，並輸出 cover-390x520.png。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const assert = (c, m) => { if (!c) { throw new Error('FAIL: ' + m); } console.log('ok  ' + m); };
const errors = [];
const hook = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const sizes = [
    { name: '390x844', w: 390, h: 844 }, { name: '375x500', w: 375, h: 500 }, { name: '390x610', w: 390, h: 610 }, { name: '430x740', w: 430, h: 740 },
    { name: '844x390', w: 844, h: 390 }, { name: '1280x800', w: 1280, h: 800, desktop: true },
  ];
  for (const s of sizes) for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: !s.desktop, hasTouch: !s.desktop, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await ctx.newPage(); hook(p, s.name + '-' + scheme);
    await p.goto(URL); await p.waitForTimeout(150);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} ${scheme} 無水平捲動 (${sw[0]} <= ${sw[1]})`);
    // keypad fully inside the viewport without scrolling
    const pad = await p.$eval('#pad', e => { const b = e.getBoundingClientRect(); const bs = [...e.querySelectorAll('button')].map(x => x.getBoundingClientRect().bottom); return { top: b.top, bottom: Math.max(b.bottom, ...bs), h: innerHeight }; });
    assert(pad.bottom <= pad.h + 1 && pad.top >= 0, `${s.name} ${scheme} 鍵盤完整在畫面內 (${Math.round(pad.bottom)} <= ${pad.h})`);
    const minBtn = await p.$$eval('#pad button', bs => Math.min(...bs.map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))));
    assert(minBtn >= 44, `${s.name} ${scheme} 鍵盤按鍵 ≥ 44px (${Math.round(minBtn)})`);
    // flow: miss, then possible → win
    await p.click('[data-k="5"]'); await p.click('[data-k="5"]'); await p.click('[data-k="5"]');
    assert((await p.textContent('#result')).includes('沒中'), `${s.name} ${scheme} 555 沒中`);
    await p.click('[data-k="1"]'); await p.click('[data-k="1"]'); await p.click('[data-k="1"]');
    assert((await p.textContent('#result')).includes('可能中獎'), `${s.name} ${scheme} 111 可能中獎`);
    for (const k of '11111') await p.click(`[data-k="${k}"]`);
    assert((await p.textContent('#result')).includes('頭獎') && (await p.textContent('#result')).includes('NT$200,000'), `${s.name} ${scheme} 11111111 頭獎 20 萬`);
    const pad2 = await p.$eval('#pad', e => [...e.querySelectorAll('button')].every(x => x.getBoundingClientRect().bottom <= innerHeight + 1));
    assert(pad2, `${s.name} ${scheme} 顯示結果後鍵盤仍在畫面內`);
    if (scheme === 'light') await p.screenshot({ path: `${OUT}/${s.name}.png` }); else if (s.name === '390x844') await p.screenshot({ path: `${OUT}/${s.name}-dark.png` });
    // other tabs render
    await p.click('[data-tab="nums"]'); assert(await p.isVisible('#editBtn'), `${s.name} ${scheme} 號碼頁`);
    if (scheme === 'light') await p.screenshot({ path: `${OUT}/${s.name}-nums.png` });
    await p.click('[data-tab="hist"]'); assert((await p.$$('.hrow')).length === 2, `${s.name} ${scheme} 紀錄頁 2 筆`);
    await ctx.close();
  }

  // ---- full flow at 390x844 ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); hook(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(150);
  assert((await p.textContent('#periodSel')).includes('範例'), '首次開啟載入範例期別');
  assert(!(await p.$eval('#sampleNote', e => e.hidden)), '對獎頁顯示範例提示');
  assert((await p.textContent('#result')).includes('本期末 3 碼'), '閒置時列出本期尾 3 碼');
  // keyboard input
  await p.keyboard.type('999');
  assert((await p.textContent('#result')).includes('可能中獎') && (await p.textContent('#result')).includes('增開六獎'), '實體鍵盤輸入 999 → 增開六獎可能');
  await p.keyboard.type('12345');
  assert((await p.textContent('#result')).includes('增開六獎') && (await p.textContent('#result')).includes('NT$200'), '12345999 → 增開六獎 200');
  // special tail only → full miss
  await p.keyboard.type('678');
  assert((await p.textContent('#result')).includes('需 8 碼全中'), '678 只符合特別獎，提示需全中');
  await p.keyboard.type('00000');
  assert((await p.textContent('#result')).includes('沒中') && (await p.textContent('#result')).includes('前碼不符'), '00000678 → 沒中（前碼不符）');
  // backspace returns from full stage to tail
  await p.keyboard.type('222');
  await p.keyboard.press('Backspace');
  let st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.stage === 'tail' && st.buf === '222', '可能中獎時倒退 → 回到末 3 碼輸入');
  await p.keyboard.press('Backspace');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.buf === '22', '倒退刪一碼');
  await p.keyboard.type('2'); await p.click('#skipBtn');
  assert((await p.$eval('#tally', e => e.textContent)).includes('待核對'), '先記下 → 待核對計數');
  // special prize
  await p.keyboard.type('678'); await p.keyboard.type('12345');
  assert((await p.textContent('#result')).includes('特別獎') && (await p.textContent('#result')).includes('NT$10,000,000'), '12345678 → 特別獎 1,000 萬');
  await p.screenshot({ path: `${OUT}/flow-special.png` });
  // clear
  await p.click('[data-k="clr"]');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.stage === 'tail' && st.buf === '' && st.tail === '', '清除後回到初始');
  const tally = await p.textContent('#tally');
  assert(tally.includes('已對 4') && tally.includes('中 2') && tally.includes('NT$10,000,200'), '統計：已對 4、中 2、共 10,000,200 ' + tally);
  // persistence
  await p.reload(); await p.waitForTimeout(150);
  assert((await p.textContent('#tally')).includes('已對 4'), '重新整理後紀錄保留');
  // history tab & clear
  await p.click('[data-tab="hist"]');
  assert((await p.$$('.hrow')).length === 4, '紀錄 4 筆');
  await p.screenshot({ path: `${OUT}/flow-hist.png` });
  await p.click('#clearHist'); await p.click('#cYes');
  assert((await p.$$('.hrow')).length === 0 && await p.isVisible('.empty'), '清除紀錄');
  // new period via sheet, with validation
  await p.click('[data-tab="nums"]');
  await p.click('#newBtn');
  await p.fill('#fSp', '1234');
  await p.click('#fSave');
  assert((await p.textContent('#fErr')).includes('8 碼'), '7 碼以下擋下');
  await p.fill('#fSp', '00000001'); await p.fill('#fGr', ''); await p.fill('#fF1', '00000777'); await p.fill('#fEx', '12, 345');
  await p.click('#fSave');
  assert((await p.textContent('#fErr')).includes('3 碼'), '增開六獎非 3 碼擋下');
  await p.fill('#fEx', '345');
  await p.click('#fSave'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 2 && !(await p.textContent('#periodSel option:checked')).includes('範例'), '新增期別並切換');
  await p.click('[data-tab="check"]');
  assert(await p.$eval('#sampleNote', e => e.hidden), '非範例期別不顯示範例提示');
  await p.keyboard.type('777'); await p.keyboard.type('10000');
  assert((await p.textContent('#result')).includes('二獎') && (await p.textContent('#result')).includes('NT$40,000'), '10000777 → 二獎 4 萬');
  // duplicate period blocked
  await p.click('[data-tab="nums"]'); await p.click('#newBtn');
  const curYear = await p.$eval('#fYear', e => e.value), curM = await p.$eval('#fM', e => e.value);
  const sample = st.periods.find(x => x.sample);
  await p.fill('#fYear', String(sample.year - 1911)); await p.selectOption('#fM', String(sample.m));
  await p.click('#fSave');
  assert((await p.textContent('#fErr')).includes('已經存在'), '重複期別擋下 (' + curYear + '/' + curM + ')');
  await p.click('#fCancel');
  // export → import round trip
  await p.click('#exportBtn');
  const txt = await p.$eval('#exTxt', e => e.value);
  assert(txt.includes('特別獎 00000001') && txt.includes('增開六獎 345'), '匯出文字');
  await p.click('#exCopy'); await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip) assert(clip === txt, '剪貼簿內容一致');
  if (await p.$('#exClose')) await p.click('#exClose');
  await p.click('#importBtn');
  await p.fill('#imTxt', 'garbage'); await p.click('#imOk');
  assert((await p.textContent('#imErr')).length > 0, '匯入亂碼顯示錯誤');
  await p.fill('#imTxt', '統一發票 112年1–2月\n特別獎 99999999\n頭獎 12121212'); await p.click('#imOk'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 3 && st.periods.some(x => x.year === 2023 && x.m === 1 && x.special === '99999999'), '匯入新期別');
  assert((await p.textContent('#tab-nums')).includes('已截止'), '112 年期別顯示已截止');
  // import overwrite
  await p.click('#importBtn'); await p.fill('#imTxt', '112年1-2月\n特別獎 88888888'); await p.click('#imOk');
  await p.click('#cYes'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 3 && st.periods.some(x => x.year === 2023 && x.special === '88888888'), '匯入覆蓋既有期別');
  // delete period
  await p.click('#delBtn'); await p.click('#cYes'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 2, '刪除期別');
  // theme + sound toggles
  await p.click('#themeBtn');
  assert((await p.getAttribute('html', 'data-theme')) === 'light', '主題切換 light');
  await p.click('#themeBtn');
  assert((await p.getAttribute('html', 'data-theme')) === 'dark', '主題切換 dark');
  await p.click('#sndBtn');
  assert((await p.getAttribute('#sndBtn', 'aria-pressed')) === 'false', '音效關閉');
  // corrupt storage
  await p.evaluate(() => { localStorage.setItem('invoice-lottery:v1:periods', '{oops'); localStorage.setItem('invoice-lottery:v1:history', '[1,2'); });
  await p.reload(); await p.waitForTimeout(150);
  assert((await p.textContent('#periodSel')).includes('範例'), '儲存損壞時重建範例');
  await p.evaluate(() => { localStorage.setItem('invoice-lottery:v1:periods', JSON.stringify([{ id: 'x', year: 'bad', first: 'nope', extra: 5 }])); });
  await p.reload(); await p.waitForTimeout(150);
  assert(await p.isVisible('#pad'), '部分損壞資料不白畫面');
  await ctx.close();

  // ---- cover 390x520 ----
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' });
    const q = await c.newPage(); hook(q, 'cover');
    await q.goto(URL); await q.waitForTimeout(150);
    await q.evaluate(() => { localStorage.clear(); }); await q.reload(); await q.waitForTimeout(150);
    for (const k of '555') await q.click(`[data-k="${k}"]`);
    for (const k of '000') await q.click(`[data-k="${k}"]`);
    for (const k of '12345') await q.click(`[data-k="${k}"]`);
    for (const k of '222') await q.click(`[data-k="${k}"]`);
    for (const k of '22222') await q.click(`[data-k="${k}"]`);
    await q.waitForTimeout(400);
    await q.screenshot({ path: `${OUT}/cover-390x520.png` });
    await c.close();
  }
  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  console.log('verify.js 全部通過');
})().catch(e => { console.error(e); process.exit(1); });
