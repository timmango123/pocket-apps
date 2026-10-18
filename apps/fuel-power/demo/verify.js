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
  assert((await p.inputValue('#people')) === '1' && (await p.inputValue('#tolls')) === '' && (await p.inputValue('#parking')) === '', '第一次修改就清掉範例的人數、過路費、停車費');
  assert((await txt('#toast-layer')).includes('範例'), '清掉範例值有提示可復原');
  await p.click('#undo-btn');
  assert((await p.inputValue('#people')) === '4' && (await p.inputValue('#tolls')) === '120', '復原範例值');
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
  assert((await txt('#fuel-err')).includes('分攤人數要大於 0') && (await txt('#total')) === '$—', '0 人：擋下並說明');
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
  await p.click('#undo-btn');
  assert((await p.$$('#car-list .carrow')).length === 4, '復原刪除的車');
  await p.click('#car-list [data-del]');
  await p.keyboard.press('Escape');
  assert((await p.$$('.scrim')).length === 0, 'Esc 關閉表單');
  // 寬鬆輸入與錯誤說明
  await p.fill('#km', '１２０公里');
  assert(await p.isHidden('#fuel-err') && (await txt('#trip-tag')) === '來回 240 km', '全形與單位「１２０公里」照算');
  await p.locator('#km').blur();
  assert((await p.inputValue('#km')) === '120', '離開欄位後整理成 120');
  await p.fill('#km', 'abc');
  assert((await txt('#fuel-err')).includes('看不懂') && (await txt('#total')) === '$—' && (await p.getAttribute('#km', 'aria-invalid')) === 'true', '看不懂的距離：說明、標紅、結果顯示 —');
  await p.fill('#km', '-3');
  assert((await txt('#fuel-err')).includes('負數'), '負數距離說明');
  await p.fill('#km', '80');
  assert(await p.isHidden('#fuel-err') && (await p.getAttribute('#km', 'aria-invalid')) === null, '改回正常數字');
  // 複製明細
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await p.click('#fuel-copy'); await p.waitForTimeout(200);
  assert((await txt('#toast-layer')).includes('複製'), '複製明細有提示 ' + await txt('#toast-layer'));
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(!clip || (clip.includes('油錢試算') && clip.includes('總花費')), '剪貼簿內容是明細');
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
  await p.fill('#kwh', 'abc');
  assert((await txt('#power-err')).includes('看不懂') && (await txt('#bill')) === '$—', '度數看不懂：說明＋結果 —');
  await p.fill('#kwh', '1,000');
  assert((await txt('#bill')) === '$2,513', '千分位 1,000 度 5–6 月 = 2340.6 + 349.6 × 30/61 = $2,513 ' + await txt('#bill'));
  await p.fill('#kwh', '240');
  assert((await txt('#bill')) === '$403', '240 度 = $403');
  await p.fill('#kwh', '760');
  // 電器
  const margBefore = await txt('#marg-cost');
  assert(margBefore !== '$0', '範例電器有邊際成本 ' + margBefore);
  await p.locator('#presets .chip[data-n="電熱水器"]').scrollIntoViewIfNeeded();
  const pre0 = await p.locator('#presets .chip[data-n="電熱水器"]').boundingBox();
  await p.click('#presets .chip[data-n="電熱水器"]');
  assert((await p.$$('#apps .app')).length === 4, '加入預設電器變 4 個');
  const pre1 = await p.locator('#presets .chip[data-n="電熱水器"]').boundingBox();
  assert(Math.abs(pre0.y - pre1.y) < 1 && await p.evaluate(() => !document.activeElement || !document.activeElement.closest('#apps')), '加入電器不捲動、不搶焦點（連點不會點到新列）');
  assert(await p.$('#apps .app.new:last-child') && (await p.inputValue('#apps .app:last-child input[data-k="d"]')) === '61', '新列亮起；天數預設為本期天數 61');
  await p.fill('#apps .app:last-child input[data-k="h"]', '1');
  const kwhTxt = await txt('#apps .app:last-child .kwh');
  assert(kwhTxt.startsWith('122'), '2000W × 1 時 × 61 天 = 122 度 ' + kwhTxt);
  await p.fill('#apps .app:last-child input[data-k="d"]', '62');
  assert((await txt('#apps .app:last-child .aerr')).includes('以 61 天計') && (await txt('#apps .app:last-child .kwh')).startsWith('122'), '天數超過本期天數：以本期天數計並說明');
  await p.fill('#apps .app:last-child input[data-k="d"]', '400');
  assert((await txt('#apps .app:last-child .aerr')).includes('最多 366'), '天數不合理：擋下');
  await p.fill('#apps .app:last-child input[data-k="d"]', '61');
  await p.evaluate(() => { window.__row = document.querySelector('#apps .app:last-child input[data-k="name"]'); });
  await p.type('#apps .app:last-child input[data-k="name"]', '浴室');
  assert(await p.evaluate(() => window.__row === document.querySelector('#apps .app:last-child input[data-k="name"]')), '打電器名稱時不重畫（輸入法不中斷）');
  await p.fill('#apps .app:last-child input[data-k="h"]', '30');
  assert((await txt('#apps .app:last-child .aerr')).includes('最多 24'), '每天超過 24 小時有說明');
  await p.fill('#apps .app:last-child input[data-k="h"]', '1');
  await p.click('#apps .app:last-child [data-del]');
  assert((await p.$$('#apps .app')).length === 3, '刪除後剩 3');
  await p.click('#undo-btn');
  assert((await p.$$('#apps .app')).length === 4, '復原刪除的電器');
  await p.click('#apps .app:last-child [data-del]');
  assert((await p.$$('#apps .app')).length === 3, '刪除後剩 3');
  await p.fill('#base-kwh', '620');
  const plus = await txt('#base-plus');
  assert(plus.startsWith('1,212'), '620 + 432 + 115.2 + 45 = 1212.2 ' + plus);
  // 錯誤列不會讓摘要說「還沒有電器」
  await p.fill('#apps .app:first-child input[data-k="w"]', 'abc');
  assert((await txt('#marg-sub')).includes('要修正'), '有錯的電器列：摘要提示要修正 ' + await txt('#marg-sub'));
  await p.fill('#apps .app:first-child input[data-k="w"]', '900');
  const lb = await p.$$eval('.linkbtn', bs => bs.filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height));
  assert(lb.length >= 2 && lb.every(h => h >= 44), '文字按鈕高度 ≥ 44 ' + lb.join());
  // 費率設定
  await p.click('#rates-link'); await p.waitForTimeout(120);
  assert(await p.evaluate(() => document.activeElement && document.activeElement.id === 'rt-t'), '費率表單不直接聚焦輸入框（不彈鍵盤）');
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
  await p.click('#rates-btn');
  assert((await txt('.sheet .src')).includes('2024 年') && (await txt('.sheet .src')).includes('8.46'), '費率表單寫明預設出處與年份');
  await p.fill('#rt-rows input[data-i="1"][data-s="upTo"]', '50'); await p.click('#rt-save');
  assert((await txt('#rt-err')).includes('第 2 段') && (await p.getAttribute('#rt-rows input[data-i="1"][data-s="upTo"]', 'aria-invalid')) === 'true', '門檻未遞增：指出哪一段');
  await p.keyboard.press('Escape');
  await p.click('#tab-power');
  await p.click('#rates-btn'); await p.click('#rt-reset');
  assert((await txt('#toast-layer')).includes('還原'), '還原預設可復原');
  await p.click('#undo-btn');
  assert((await txt('#bill')) === '$1,879', '復原自訂費率');
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

  // ---- 第二輪審查修正：獨立情境 ----
  {
    const c2 = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
    const q = await c2.newPage();
    q.on('pageerror', e => errors.push('r2: ' + e.message)); q.on('console', m => { if (m.type() === 'error') errors.push('r2: ' + m.text()); });
    q.on('dialog', d => { errors.push('r2 dialog: ' + d.message()); d.dismiss(); });
    await q.goto(URL); await q.waitForTimeout(200);
    const t2 = s => q.textContent(s).then(t => t.replace(/\s+/g, ' ').trim());
    // 範例陷阱：清空後只填 30 km
    await q.fill('#km', '30');
    assert((await t2('#total')) === '$128' && (await t2('#per-person')) === '$128' && (await t2('#per-k')) === '每人分攤（1 人）', '只改距離 30 km：一個人 $128（不再帶範例的過路費與 4 人）');
    // 360 寬：第三台車完整可見
    const third = await q.locator('#cars .chip[data-id="c3"]').boundingBox();
    assert(third && third.x >= 0 && third.x + third.width <= 360, '360 寬第三台車完整可見');
    // 極端數字不被切掉
    await q.fill('#km', '20000'); await q.fill('#kpl', '0.1'); await q.fill('#price', '300'); await q.fill('#tolls', '100000'); await q.fill('#parking', '100000');
    const cut = await q.evaluate(() => ['#total', '#per-person', '#litres', '#fuel-cost', '#per-km', '#vs-gas', '#sum-v'].filter(s => { const e = document.querySelector(s); return e.offsetParent && e.scrollWidth > e.clientWidth + 1; }));
    assert(cut.length === 0, '極端數字在 360 寬縮小字級、不切掉 ' + cut.join());
    await q.fill('#km', '30'); await q.fill('#kpl', '14.5'); await q.fill('#price', '31'); await q.fill('#tolls', ''); await q.fill('#parking', '');
    // 匯出備份
    await q.click('#car-add');
    const [dl] = await Promise.all([q.waitForEvent('download'), q.click('[data-bk="export"]')]);
    const exp = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert(exp.app === 'fuel-power' && exp.cars.length === 3 && exp.rates === null && exp.prices['95'] === '31', '匯出備份含 3 台車與油價');
    // 匯入：壞檔
    await q.setInputFiles('.sheet [data-bk-file]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await q.waitForTimeout(100);
    assert((await t2('#toast-layer')).includes('看不懂') && (await q.$$('#car-list .carrow')).length === 3, '壞檔匯入：說明、資料不變');
    // 匯入：新車＋自訂費率
    const rr = JSON.parse(JSON.stringify(await q.evaluate(() => window.__fuelPower.FP.DEFAULT_RATES))); rr.tiers[0].summer = 2; rr.tiers[0].winter = 2; rr.effective = '2026-01-01';
    const good = { app: 'fuel-power', version: 1, cars: [{ name: '公司車', kpl: 12, fuel: '98' }, { name: '家用房車', kpl: 14.5, fuel: '95' }, { name: '<b>x</b>', kpl: 'abc' }], rates: rr };
    await q.setInputFiles('.sheet [data-bk-file]', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(good)) });
    await q.waitForTimeout(150);
    assert((await q.$$('#cars .chip:not(.add)')).length === 4 && (await t2('#toast-layer')).includes('已匯入 1 台車、自訂費率'), '匯入：新增 1 台（重複略過）＋自訂費率 ' + await t2('#toast-layer'));
    await q.click('#tab-power');
    assert((await t2('#bill')) === '$1,879', '匯入的費率生效');
    await q.click('#undo-btn');
    assert((await t2('#bill')) === '$1,802' && (await q.$$('#cars .chip:not(.add)')).length === 3, '匯入可復原');
    // 計費期改短：電器天數自動調整並說明
    await q.selectOption('#period', '1');
    assert((await q.inputValue('#apps .app:first-child input[data-k="d"]')) === '60' && (await t2('#apps .app:first-child .aerr')).includes('以 59 天計') && (await t2('#apps .app:first-child .kwh')).startsWith('424.8'), '1–2 月只有 59 天：冷氣 60 天以 59 天計（900W×8h×59=424.8），輸入不被改掉');
    // 用本期度數推算平常用量
    await q.fill('#kwh', '1000'); await q.click('#base-from-bill');
    const apk = await q.evaluate(() => window.__fuelPower.state.apps.reduce((t, a) => t + a.w * a.h * Math.min(59, a.d) / 1000, 0));
    assert(Math.abs(+(await q.inputValue('#base-kwh')) - Math.round((1000 - apk) * 10) / 10) < 1e-9, '用本期度數扣掉電器 = ' + await q.inputValue('#base-kwh'));
    // 跨季單價兩位小數
    await q.selectOption('#period', '5');
    const rates2 = await q.$$eval('#tier-rows tr td:nth-child(3)', ts => ts.map(t => t.textContent));
    assert(rates2.every(r => /^\d+\.\d\d$/.test(r)), '跨季單價兩位小數 ' + rates2.join());
    // 存檔 id 被竄改：不注入、仍可操作
    await q.evaluate(() => {
      localStorage.setItem('fuel-power:v1:cars', JSON.stringify([{ id: '"><img src=x onerror=alert(1)>', name: '測試', kpl: 10, fuel: '95' }, { id: 'a"]b', name: '測試2', kpl: 11, fuel: '95' }]));
      localStorage.setItem('fuel-power:v1:apps', JSON.stringify([{ id: 'x"] , #total {', name: 'n', w: '100', h: '1', d: '10' }]));
    });
    await q.reload(); await q.waitForTimeout(200);
    const ids = await q.evaluate(() => [...window.__fuelPower.state.cars, ...window.__fuelPower.state.apps].map(x => x.id));
    assert(ids.length === 3 && ids.every(i => /^[a-z0-9]{1,16}$/.test(i)) && !(await q.$('img[src="x"]')), '不安全的 id 換成英數、沒有注入');
    await q.click('#tab-power'); await q.click('#apps .app [data-del]');
    assert((await q.$$('#apps .app')).length === 0, '換過 id 的電器仍可刪除');
    await c2.close();
  }

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  console.log('verify.js 全部通過');
})().catch(e => { console.error(e); process.exit(1); });
