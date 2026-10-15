// 日期計算機驗證：node verify.js
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
  const sizes = [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]];
  for (const [name, w, h, mob] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(URL); await p.waitForTimeout(150);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    assert(sw <= iw, `${name} 無水平捲動 (${sw} <= ${iw})`);
    for (const t of ['diff', 'add', 'work', 'anni', 'lunar']) {
      await p.click('#tab-' + t); await p.waitForTimeout(50);
      const s2 = await p.evaluate(() => document.documentElement.scrollWidth);
      if (s2 > iw) assert(false, `${name} ${t} 分頁水平溢出 ${s2}`);
    }
    await p.click('#tab-diff');
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      for (const t of ['add', 'work', 'anni', 'lunar']) { await p.click('#tab-' + t); await p.waitForTimeout(80); await p.screenshot({ path: `${OUT}/${name}-${t}.png`, fullPage: true }); }
      // touch target check
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, select, summary')].filter(e => e.offsetParent && e.type !== 'radio').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
    }
    await ctx.close();
  }
  { // dark
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await p.click('#tab-lunar'); await p.waitForTimeout(80);
    await p.screenshot({ path: `${OUT}/390x844-dark-lunar.png`, fullPage: true });
    await ctx.close();
  }
  // 邏輯與流程（以美東時區執行，確認夏令時不影響）
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'America/New_York' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(150);
  const fill = async (sel, v) => { await p.fill(sel, v); await p.dispatchEvent(sel, 'input'); };
  await p.click('#tab-diff');
  assert((await p.textContent('#diff-days')) === '79', '範例 2026-10-07 → 2026-12-25 = 79 天');
  assert((await p.textContent('#diff-sentence')) === '2026-10-07（三）→ 2026-12-25（五）相差 79 天（不含首日）', '複製格式與規格範例一致');
  await fill('#diff-start', '2024-02-28'); await fill('#diff-end', '2024-03-01');
  assert((await p.textContent('#diff-days')) === '2', '2024-02-28 到 2024-03-01 = 2 天');
  await fill('#diff-start', '2026-03-07'); await fill('#diff-end', '2026-03-09');
  assert((await p.textContent('#diff-days')) === '2', '跨美東夏令時 2026-03-07 → 03-09 = 2 天');
  await p.check('#diff-incl');
  assert((await p.textContent('#diff-days')) === '3', '含首日 = 3 天');
  await p.uncheck('#diff-incl');
  await fill('#diff-start', '2026-12-25'); await fill('#diff-end', '2026-10-07');
  assert((await p.textContent('#diff-out')).includes('迄日早於起日') && (await p.textContent('#diff-days')) === '−79', '迄日早於起日顯示負數');
  await fill('#diff-start', '2024-01-31'); await fill('#diff-end', '2025-03-15');
  assert((await p.textContent('#diff-out')).includes('1 年 1 個月 15 天'), '2024-01-31 → 2025-03-15 = 1 年 1 個月 15 天（月底對齊）');
  await p.click('#diff-copy'); await p.waitForTimeout(100);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip.includes('2024-01-31（三）→ 2025-03-15（六）相差 409 天（不含首日）'), '複製結果進剪貼簿: ' + clip);

  await p.click('#tab-add');
  await fill('#add-base', '2024-01-31'); await fill('#add-n', '1'); await p.click('#add-unit-m');
  assert((await p.textContent('#add-result')) === '2024-02-29' && await p.isVisible('#add-clamp'), '2024-01-31 加 1 個月 = 2024-02-29 並註明調整');
  await fill('#add-n', '100'); await p.click('#add-unit-d'); await p.click('#add-sign-minus');
  assert((await p.textContent('#add-result')) === '2023-10-23', '2024-01-31 減 100 天 = 2023-10-23');

  await p.click('#tab-work');
  await fill('#work-start', '2026-10-12'); await fill('#work-n', '10');
  assert((await p.textContent('#work-result')) === '2026-10-27', '2026-10-12 起 10 個工作天（排除週末與範例假日 10/26）= 2026-10-27');
  await fill('#work-n', '3651');
  assert((await p.textContent('#work-out')).includes('上限'), '超過 3650 天顯示錯誤');
  await p.click('#work-mode-end'); await fill('#work-end', '2026-10-31');
  assert((await p.textContent('#work-count')) === '14', '2026-10-12 到 10-31 共 14 個工作天（扣 10/26）');
  await fill('#hol-date', '2026-10-30'); await p.click('#hol-add');
  assert((await p.textContent('#work-count')) === '13', '新增假日 10/30 後變 13 天');

  await p.click('#tab-anni');
  const before = await p.locator('.anni').count();
  await fill('#anni-title', '開始存錢'); await fill('#anni-date', '2026-01-01'); await p.click('#anni-add');
  assert((await p.locator('.anni').count()) === before + 1, '新增紀念日');
  const t = await p.textContent('.anni:first-child .count');
  const expect = await p.evaluate(() => { const d = new Date(); const D = window.__dateCalc; return D.toDayNumber(d.getFullYear(), d.getMonth() + 1, d.getDate()) - D.toDayNumber(2026, 1, 1) + 1; });
  assert(t.replace(/\D/g, '') === String(expect), '紀念日第 N 天 = ' + expect);
  await p.click('.anni:first-child .del'); await p.click('.anni:first-child .del');
  assert((await p.locator('.anni').count()) === before, '兩段式刪除紀念日');

  await p.click('#tab-lunar');
  await fill('#lunar-date', '2026-10-07');
  assert((await p.textContent('#lunar-result')) === '八月廿七' && (await p.textContent('#lunar-out')).includes('丙午年'), '2026-10-07 = 農曆丙午年八月廿七');
  await fill('#lunar-date', '2026-10-08');
  assert((await p.textContent('#lunar-term')).includes('寒露'), '2026-10-08 寒露');
  await fill('#lunar-date', '2025-07-25');
  assert((await p.textContent('#lunar-result')) === '閏六月初一', '2025-07-25 = 閏六月初一');
  await fill('#lunar-date', '2101-01-01');
  assert((await p.textContent('#lunar-out')).includes('超出支援範圍（1900–2100）'), '2101 年顯示範圍提示');
  const cny = await p.evaluate(() => [['2024-02-10'], ['2000-02-05'], ['1950-02-17'], ['2100-02-09'], ['2033-12-22']].map(([s]) => { const [y, m, d] = s.split('-').map(Number); const l = window.__dateCalc.solarToLunar(y, m, d); return s + ':' + l.month + '/' + l.day + (l.isLeap ? 'L' : ''); }).join(' '));
  assert(cny === '2024-02-10:1/1 2000-02-05:1/1 1950-02-17:1/1 2100-02-09:1/1 2033-12-22:11/1L', '春節與 2033 閏十一月抽查 ' + cny);
  await p.reload(); await p.waitForTimeout(100);
  assert(await p.isVisible('#p-lunar'), '重新整理後記得分頁');
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? fails + ' 項失敗' : '全部通過');
  process.exit(fails ? 1 : 0);
})();
