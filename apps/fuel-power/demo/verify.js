// 油錢與電費計算驗證腳本：node verify.js
// 390×844 與大廳 iframe 三種尺寸、淺色／深色，檢查無錯誤、主要流程可用，並輸出 cover-390x520.png。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(require('os').tmpdir(), 'fuel-power-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const sizes = [
    { name: '390x844', w: 390, h: 844 }, { name: '375x500', w: 375, h: 500 }, { name: '390x610', w: 390, h: 610 }, { name: '430x740', w: 430, h: 740 },
    { name: '844x390', w: 844, h: 390 }, { name: '1280x800', w: 1280, h: 800, desktop: true }
  ];
  for (const scheme of ['light', 'dark']) for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: !s.desktop, hasTouch: !s.desktop, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(`${s.name}/${scheme}: ${m.text()}`); });
    p.on('pageerror', e => errors.push(`${s.name}/${scheme}: ${e.message}`));
    await p.goto(URL); await p.waitForTimeout(200);
    for (const tab of ['fuel', 'power']) {
      await p.click('#tab-' + tab); await p.waitForTimeout(100);
      const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(sw[0] <= sw[1], `${s.name} ${scheme} ${tab} 無水平捲動 (${sw[0]} <= ${sw[1]})`);
      if (scheme === 'light' || s.name === '390x844') await p.screenshot({ path: `${OUT}/${s.name}-${tab}${scheme === 'dark' ? '-dark' : ''}.png` });
    }
    await ctx.close();
  }

  // cover
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('cover: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(250);
    await p.evaluate(() => { document.querySelector('#fuel-result').scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/cover-390x520.png` });
    await ctx.close();
  }

  // flows
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push('flow: ' + m.text()); });
  p.on('pageerror', e => errors.push('flow: ' + e.message));
  await p.goto(URL); await p.waitForTimeout(200);
  const txt = s => p.textContent(s).then(t => t.replace(/\s+/g, ' ').trim());

  // 範例
  assert(await p.isVisible('#ex-fuel'), '首次開啟顯示範例標記');
  assert((await txt('#total')).includes('$699'), '範例總花費 $699 ' + await txt('#total'));
  assert((await txt('#per-person')) === '$174.7', '範例每人 $174.7');
  // 單程
  await p.click('#way-one');
  assert((await txt('#trip-tag')) === '單程 112 km', '切單程距離變 112 km');
  assert((await txt('#litres')).startsWith('7.7'), '單程油量 7.7 L');
  assert(await p.isHidden('#ex-fuel'), '修改後範例標記消失');
  await p.click('#way-round');
  // 油種切換帶出該油種價格
  await p.click('.fuel[data-f="98"]');
  assert((await p.inputValue('#price')) === '33', '切 98 帶出 33 元');
  await p.fill('#price', '35');
  await p.click('.fuel[data-f="92"]'); await p.click('.fuel[data-f="98"]');
  assert((await p.inputValue('#price')) === '35', '每種油價分開記住');
  // 車輛 chip
  await p.click('.chip[data-id="c2"]');
  assert((await p.inputValue('#kpl')) === '42', '點通勤機車帶入 42 km/L');
  assert((await p.getAttribute('.fuel[data-f="92"]', 'aria-pressed')) === 'true', '並切成 92');
  // 分攤
  await p.fill('#people', '0');
  assert((await txt('#per-k')) === '每人分攤（1 人）', '0 人視為 1 人');
  await p.fill('#people', '3');
  assert((await txt('#per-k')) === '每人分攤（3 人）', '3 人分攤');
  // 錯誤提示
  await p.fill('#km', '');
  assert(await p.isVisible('#fuel-err') && (await txt('#fuel-err')).includes('距離'), '距離空白顯示提示');
  await p.fill('#km', '80');
  assert(await p.isHidden('#fuel-err'), '填回距離提示消失');
  // 存車
  await p.click('#car-add');
  await p.click('#car-save');
  assert((await txt('#car-err')) === '請輸入車名', '車名空白擋下');
  await p.fill('#car-name', '新車'); await p.fill('#car-kpl', '18');
  await p.click('#car-fuel button[data-f="95"]');
  await p.click('#car-save');
  assert((await p.$$('#cars .chip:not(.add)')).length === 4, '存車後有 4 台');
  assert((await p.inputValue('#kpl')) === '18', '新車套用 18 km/L');
  await p.reload(); await p.waitForTimeout(200);
  assert((await p.$$('#cars .chip:not(.add)')).length === 4 && (await p.inputValue('#kpl')) === '18', '重新整理後車輛與設定仍在');
  await p.click('#car-add');
  await p.click('#car-list [data-del]'); // 刪第一台
  assert((await p.$$('#car-list .carrow')).length === 3, '刪除一台剩 3');
  await p.keyboard.press('Escape');
  assert((await p.$$('.scrim')).length === 0, 'Esc 關閉表單');
  // EV
  await p.fill('#ev-kwh', '16'); await p.fill('#ev-price', '5');
  assert((await txt('#ev-save')).includes('省'), '電動車比較顯示省多少');
  await p.fill('#ev-price', '60');
  assert((await txt('#ev-save')).includes('反而多'), '電價太高時顯示反而多');
  await p.screenshot({ path: `${OUT}/flow-fuel.png`, fullPage: true });

  // 電費
  await p.click('#tab-power'); await p.waitForTimeout(100);
  assert(await p.isVisible('#panel-power') && await p.isHidden('#panel-fuel'), '切到電費分頁');
  assert((await p.evaluate(() => document.body.dataset.tab)) === 'power', '分頁狀態寫到 body');
  assert((await txt('#bill')) === '$1,802', '範例 760 度 7–8 月 = $1,802 ' + await txt('#bill'));
  assert((await txt('#season-tag')) === '夏月費率', '7–8 月為夏月');
  await p.selectOption('#period', '1');
  assert((await txt('#bill')) === '$1,613', '1–2 月非夏月 = $1,613 ' + await txt('#bill'));
  await p.selectOption('#period', '5');
  assert((await txt('#season-tag')).includes('跨季'), '5–6 月顯示跨季');
  const mix = +(await txt('#bill')).replace(/[$,]/g, '');
  assert(mix > 1613 && mix < 1802, '跨季金額介於兩季之間 ' + mix);
  const rows = await p.$$eval('#tier-rows tr', trs => trs.map(t => t.className));
  assert(rows.join() === 'on,on,on,off,off,off', '760 度用到三段');
  await p.fill('#kwh', '240');
  assert((await txt('#bill')) === '$403', '240 度 = $403');
  await p.fill('#kwh', '760');
  // 電器
  const margBefore = await txt('#marg-cost');
  assert(margBefore !== '$0', '範例電器有邊際成本 ' + margBefore);
  await p.click('#presets .chip[data-n="電熱水器"]');
  assert((await p.$$('#apps .app')).length === 4, '加入預設電器變 4 個');
  assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.k === 'h'), '焦點跳到新電器的每天小時');
  await p.fill('#apps .app:last-child input[data-k="h"]', '1');
  const kwhTxt = await txt('#apps .app:last-child .kwh');
  assert(kwhTxt.startsWith('120'), '2000W × 1 時 × 60 天 = 120 度 ' + kwhTxt);
  await p.click('#apps .app:last-child [data-del]');
  assert((await p.$$('#apps .app')).length === 3, '刪除後剩 3');
  await p.fill('#base-kwh', '620');
  const plus = await txt('#base-plus');
  assert(plus.startsWith('1,212'), '620 + 432 + 115.2 + 45 = 1212.2 ' + plus);
  // 費率設定
  await p.click('#rates-link');
  assert(await p.isVisible('#rt-rows'), '費率表單開啟');
  await p.fill('#rt-rows input[data-i="0"][data-s="summer"]', 'abc');
  await p.click('#rt-save');
  assert(await p.isVisible('#rt-err'), '非數字擋下');
  await p.fill('#rt-rows input[data-i="0"][data-s="summer"]', '2'); await p.fill('#rt-rows input[data-i="0"][data-s="winter"]', '2');
  await p.fill('#rt-eff', '2026-01-01');
  await p.click('#rt-save');
  await p.selectOption('#period', '7');
  assert((await txt('#bill')) === '$1,879', '自訂第一段 2 元：760 度 = 480 + 1029 + 370 = $1,879 ' + await txt('#bill'));
  assert((await txt('#rates-note')).includes('2026-01-01') && (await txt('#rates-note')).includes('已自訂'), '註記顯示自訂生效日');
  await p.reload(); await p.waitForTimeout(200);
  assert((await txt('#bill')) === '$1,879' && (await p.evaluate(() => document.body.dataset.tab)) === 'power', '重新整理後自訂費率與分頁仍在');
  await p.click('#rates-btn'); await p.click('#rt-reset');
  assert((await txt('#bill')) === '$1,802', '還原預設');
  await p.screenshot({ path: `${OUT}/flow-power.png`, fullPage: true });
  // 主題
  await p.click('#theme');
  assert((await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '手動切深色');
  await p.reload(); await p.waitForTimeout(100);
  assert((await p.evaluate(() => document.documentElement.dataset.theme)) === 'dark', '主題記住');
  // 損壞資料
  await p.evaluate(() => { localStorage.setItem('fuel-power:v1:trip', '{bad'); localStorage.setItem('fuel-power:v1:cars', '"x"'); localStorage.setItem('fuel-power:v1:rates', JSON.stringify({ tiers: [1, 2] })); localStorage.setItem('fuel-power:v1:apps', '[null,{"name":5}]'); });
  await p.reload(); await p.waitForTimeout(200);
  assert(await p.isVisible('#tab-fuel') && (await txt('#bill')) === '$1,802', '儲存內容損壞仍正常（回到預設費率）');

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  console.log('verify.js 全部通過');
})().catch(e => { console.error(e); process.exit(1); });
