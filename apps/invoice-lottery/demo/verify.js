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
  assert((await p.$$('#result .chip')).length === 7, '閒置時列出本期尾 3 碼（7 組）');
  // keyboard input; 999 only matches 增開六獎, so 3 digits already decide it
  await p.keyboard.type('999');
  assert((await p.textContent('#result')).includes('增開六獎') && (await p.textContent('#result')).includes('NT$200') && (await p.textContent('#result')).includes('不必再對前碼'), '實體鍵盤 999 → 直接確定增開六獎 200（3 次按鍵）');
  // special tail only → full miss
  await p.keyboard.type('678');
  assert((await p.textContent('#result')).includes('要 8 碼全中'), '678 只符合特別獎，提示需全中');
  await p.keyboard.type('00000');
  assert((await p.textContent('#result')).includes('沒中') && (await p.textContent('#result')).includes('其他碼不符'), '00000678 → 沒中（其他碼不符）');
  // backspace returns from full stage to tail
  await p.keyboard.type('222');
  await p.keyboard.press('Backspace');
  let st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.stage === 'tail' && st.buf === '22', '可能中獎時倒退 → 回到末 3 碼並刪掉最後一碼');
  await p.keyboard.type('2');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.stage === 'maybe' && st.tail === '222', '補回一碼再次判斷');
  await p.click('[data-act="later"]');
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
  // resume the pending tail from history
  await p.click('.resume');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.stage === 'maybe' && st.tail === '222' && await p.isVisible('#tab-check'), '待核對 → 繼續核對回到對獎頁');
  await p.keyboard.type('22222');
  assert((await p.textContent('#result')).includes('頭獎') && (await p.textContent('#result')).includes('8 碼全中'), '繼續核對 22222222 → 頭獎');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.hist[st.curId].length === 4 && !st.hist[st.curId].some(h => h.s === 'maybe'), '待核對被結果取代，不重複記錄');
  await p.click('[data-tab="hist"]');
  // delete one row + undo
  await p.click('.hrow .del'); await p.waitForTimeout(260);
  assert((await p.$$('.hrow')).length === 3, '刪除單筆');
  await p.click('#toast button'); await p.waitForTimeout(50);
  assert((await p.$$('.hrow')).length === 4, '刪除單筆可復原');
  await p.click('#clearHist'); await p.click('#cYes');
  assert((await p.$$('.hrow')).length === 0 && await p.isVisible('.empty'), '清除紀錄');
  await p.click('#toast button'); await p.waitForTimeout(50);
  assert((await p.$$('.hrow')).length === 4, '清除紀錄可復原');
  await p.click('#clearHist'); await p.click('#cYes');
  // rapid touch taps: 8+/s alternating keys, nothing swallowed or doubled
  await p.click('[data-tab="check"]');
  const keyPos = await p.$$eval('#pad button', bs => Object.fromEntries(bs.map(b => { const r = b.getBoundingClientRect(); return [b.dataset.k, [r.x + r.width / 2, r.y + r.height / 2]]; })));
  for (let i = 0; i < 10; i++) for (const k of '546') { await p.touchscreen.tap(...keyPos[k]); await p.waitForTimeout(55); }
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.hist[st.curId].length === 10 && st.hist[st.curId].every(h => h.n === '546'), '連打 30 下（約 9 次/秒，跨鍵）→ 剛好 10 筆，無遺漏無重複');
  // paste a full number on the check screen
  await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'AB-12345678'); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
  assert((await p.textContent('#result')).includes('特別獎'), '在對獎頁貼上 AB-12345678 → 直接對獎');
  await p.click('[data-tab="hist"]'); await p.click('#clearHist'); await p.click('#cYes');
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
  assert(st.periods.length === 1 && !st.periods.some(x => x.sample) && !(await p.textContent('#periodSel')).includes('範例'), '新增真實期別後範例自動移除');
  await p.click('[data-tab="check"]');
  assert(await p.$eval('#sampleNote', e => e.hidden), '非範例期別不顯示範例提示');
  await p.keyboard.type('777'); await p.keyboard.type('10000');
  assert((await p.textContent('#result')).includes('二獎') && (await p.textContent('#result')).includes('NT$40,000'), '10000777 → 二獎 4 萬');
  // duplicate period asks before overwriting; duplicate numbers are blocked; 西元年 accepted
  await p.click('[data-tab="nums"]'); await p.click('#newBtn');
  const real = st.periods[0];
  await p.fill('#fYear', String(real.year)); await p.selectOption('#fM', String(real.m));
  await p.fill('#fSp', '12121212'); await p.fill('#fGr', '12121212');
  await p.click('#fSave');
  assert((await p.textContent('#fErr')).includes('重複'), '特別獎與特獎相同 → 擋下並說明');
  await p.fill('#fGr', '');
  await p.click('#fSave');
  assert((await p.textContent('.dlgmsg')).includes('覆蓋'), '同一期再新增 → 先確認是否覆蓋（西元年 ' + real.year + ' 也接受）');
  await p.click('#cNo');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods[0].special === '00000001', '取消覆蓋 → 號碼不變');
  // export → import round trip
  await p.click('#exportBtn');
  const txt = await p.$eval('#exTxt', e => e.value);
  assert(txt.includes('特別獎 00000001') && txt.includes('增開六獎 345'), '匯出文字');
  await p.click('#exCopy'); await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => null));
  if (clip) assert(clip === txt, '剪貼簿內容一致');
  if (await p.$('#exClose')) await p.click('#exClose');
  await p.click('#importBtn');
  await p.fill('#fPaste', 'garbage 12 abc');
  assert(await p.$eval('#pMsg', e => e.classList.contains('bad')), '貼上沒有號碼的文字 → 說明讀不到');
  await p.fill('#fPaste', '財政部公告 112年01、02月統一發票中獎號碼\n特別獎\n99999999\n同期統一發票收執聯8位數號碼與特別獎號碼相同者獎金1,000萬元\n頭獎\n12121212\n開獎日期 112年3月25日');
  assert((await p.$eval('#fYear', e => e.value)) === '112' && (await p.$eval('#fM', e => e.value)) === '1' && (await p.$eval('#fSp', e => e.value)) === '99999999' && (await p.$eval('#fF1', e => e.value)) === '12121212', '貼上公告 → 自動填入期別與號碼');
  await p.screenshot({ path: `${OUT}/flow-paste.png` });
  await p.click('#fSave'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 2 && st.periods.some(x => x.year === 2023 && x.m === 1 && x.special === '99999999'), '匯入新期別');
  assert((await p.textContent('#tab-nums')).includes('已截止'), '112 年期別顯示已截止');
  await p.click('[data-tab="check"]');
  await p.keyboard.type('999'); await p.keyboard.type('99999');
  assert((await p.textContent('#result')).includes('已超過領獎期限'), '過期的中獎提醒已超過領獎期限');
  await p.click('[data-tab="nums"]');
  // paste overwrite of an existing period
  await p.click('#importBtn'); await p.fill('#fPaste', '112年1-2月\n特別獎 88888888'); await p.click('#fSave');
  await p.click('#cYes'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 2 && st.periods.some(x => x.year === 2023 && x.special === '88888888') && st.hist[st.curId].length === 1, '貼上覆蓋既有期別，紀錄保留');
  // a whole announcement pasted into one field fills every field
  await p.click('#editBtn');
  await p.focus('#fGr'); await p.evaluate(() => { const el = document.querySelector('#fGr'); el.value = '特別獎 11223344 特獎 55667788 頭獎 10203040'; el.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true })); });
  assert((await p.$eval('#fSp', e => e.value)) === '11223344' && (await p.$eval('#fGr', e => e.value)) === '55667788' && (await p.$eval('#fF1', e => e.value)) === '10203040', '整段貼進單一欄位也會分到各欄');
  await p.click('#fCancel');
  // delete period + undo
  await p.click('#delBtn'); await p.click('#cYes'); await p.waitForTimeout(100);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 1, '刪除期別');
  await p.click('#toast button'); await p.waitForTimeout(50);
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(st.periods.length === 2 && st.hist[st.curId] && st.hist[st.curId].length === 1, '刪除期別可復原（含紀錄）');
  // theme + sound toggles
  await p.click('#themeBtn');
  assert((await p.getAttribute('html', 'data-theme')) === 'light', '主題切換 light');
  await p.click('#themeBtn');
  assert((await p.getAttribute('html', 'data-theme')) === 'dark', '主題切換 dark');
  await p.click('#sndBtn');
  assert((await p.getAttribute('#sndBtn', 'aria-pressed')) === 'false', '音效關閉');
  // corrupt storage
  // the app flushes its own state on pagehide, so inject after that
  await p.evaluate(() => addEventListener('pagehide', () => { localStorage.setItem('invoice-lottery:v1:periods', '{oops'); localStorage.setItem('invoice-lottery:v1:history', '[1,2'); }));
  await p.reload(); await p.waitForTimeout(150);
  assert((await p.textContent('#periodSel')).includes('範例'), '儲存損壞時重建範例');
  // the app flushes its own state on pagehide, so inject after that
  await p.evaluate(() => addEventListener('pagehide', () => { localStorage.setItem('invoice-lottery:v1:periods', JSON.stringify([{ id: 'x', year: 'bad', first: 'nope', extra: 5 }])); }));
  await p.reload(); await p.waitForTimeout(150);
  assert(await p.isVisible('#pad'), '部分損壞資料不白畫面');
  // a period without numbers never says 沒中
  // the app flushes its own state on pagehide, so inject after that
  await p.evaluate(() => addEventListener('pagehide', () => { localStorage.setItem('invoice-lottery:v1:periods', JSON.stringify([{ id: 'e', year: 2026, m: 7 }])); localStorage.setItem('invoice-lottery:v1:history', '{}'); }));
  await p.reload(); await p.waitForTimeout(150);
  await p.keyboard.type('123');
  const er = await p.textContent('#result');
  assert(er.includes('還沒有中獎號碼') && !er.includes('沒中'), '沒有號碼的期別：不判定沒中，引導輸入號碼');
  st = await p.evaluate(() => window.__invoiceLottery.state);
  assert(!(st.hist.e || []).length, '沒有號碼時不記錄');
  await ctx.close();

  // ---- cover 390x520 ----
  {
    const c = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' });
    const q = await c.newPage(); hook(q, 'cover');
    await q.goto(URL); await q.waitForTimeout(150);
    await q.evaluate(() => { localStorage.clear(); }); await q.reload(); await q.waitForTimeout(150);
    for (const k of '555') await q.click(`[data-k="${k}"]`);
    for (const k of '000') await q.click(`[data-k="${k}"]`);
    for (const k of '222') await q.click(`[data-k="${k}"]`);
    for (const k of '90222') await q.click(`[data-k="${k}"]`);
    await q.waitForTimeout(1400);
    await q.screenshot({ path: `${OUT}/cover-390x520.png` });
    await c.close();
  }
  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  console.log('verify.js 全部通過');
})().catch(e => { console.error(e); process.exit(1); });
