// 倒數日看板驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const NOW = new Date('2026-10-13T10:00:00');
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };
  const sizes = [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]];
  for (const [name, w, h, mob] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const p = await ctx.newPage(); watch(p, name);
    await p.clock.setFixedTime(NOW);
    await p.goto(URL); await p.waitForTimeout(150);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    assert(sw <= iw, `${name} 無水平捲動 (${sw} <= ${iw})`);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, label.btn')].filter(e => e.offsetParent && e.type !== 'file').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 42));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
      await p.click('#add'); await p.waitForTimeout(100);
      await p.screenshot({ path: `${OUT}/${name}-sheet.png` });
      const s2 = await p.evaluate(() => [...document.querySelectorAll('#sheet button, #sheet input')].filter(e => e.offsetParent && e.type !== 'checkbox').map(e => { const r = e.getBoundingClientRect(); return [e.id, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 42));
      assert(s2.length === 0, '抽屜觸控目標 ≥44px ' + JSON.stringify(s2));
      await p.click('#f-cancel');
      await p.click('#pinned .tile'); await p.waitForTimeout(100);
      await p.screenshot({ path: `${OUT}/${name}-detail.png` });
    }
    if (name === '844x390') { await p.click('#pinned .tile'); await p.waitForTimeout(100); await p.screenshot({ path: `${OUT}/${name}-detail.png` }); }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.clock.setFixedTime(NOW);
    await p.goto(URL); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await ctx.close();
  }
  // ---------- 邏輯 ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.clock.install({ time: NOW });
  await p.goto(URL); await p.waitForTimeout(100);
  const occ = (it, t) => p.evaluate(([it, t]) => window.__cd.occurrence(it, t), [it, t]);
  assert(await occ({ date: '2024-02-29', repeat: 'yearly' }, '2027-01-10') === '2027-02-28', '每年重複 2/29 在 2027 年為 2/28');
  assert(await occ({ date: '2024-02-29', repeat: 'yearly' }, '2028-01-10') === '2028-02-29', '2028 閏年回到 2/29');
  assert(await occ({ date: '2026-01-31', repeat: 'monthly' }, '2026-11-05') === '2026-11-30', '每月 31 日在 11 月取月底 30 日');
  assert(await occ({ date: '2026-01-31', repeat: 'monthly' }, '2027-02-01') === '2027-02-28', '每月 31 日在 2 月取 28 日');
  assert(await occ({ date: '2026-12-25', repeat: 'yearly' }, '2026-12-26') === '2027-12-25', '每年：今年已過取明年');
  const fg = await p.evaluate(() => ['c:#fff3b0', 'c:#f9d64a', 'c:#1f3a93', 'c:#2b2d33', 'g:1'].map(b => window.__cd.bgInfo(b).fg));
  assert(fg[0] === 'light' && fg[1] === 'light' && fg[2] === 'dark' && fg[3] === 'dark', '淺黃用黑字、深藍用白字 ' + fg);
  const di = await p.evaluate(() => [window.__cd.dayInfo({ date: '2026-10-03', repeat: 'none' }, '2026-10-13', 'diff').num, window.__cd.dayInfo({ date: '2026-10-03', repeat: 'none' }, '2026-10-13', 'nth').num]);
  assert(di[0] === 10 && di[1] === 11, '已過 10 天／第 11 天計法');
  // 範例資料、已過去群組
  assert(await p.isVisible('#exbar') && (await p.$$('#list .tile')).length >= 4, '開啟即有範例資料');
  assert((await p.textContent('#past-h')).includes('已過去（2）'), '已過且不重複的項目移到已過去群組');
  await p.click('#clear-ex');
  assert((await p.$$('#app .tile[data-id]')).length === 0 && await p.isVisible('#empty'), '清除範例後顯示空白提示');
  // 新增明天
  await p.click('#add'); await p.fill('#f-title', '明天的約會'); await p.fill('#f-date', '2026-10-14');
  await p.click('#emoji-10'); await p.click('#bg-c0'); await p.click('#f-save');
  let txt = await p.textContent('#list .tile');
  assert(txt.includes('還有') && txt.includes('1天'), '今天新增明天 → 還有 1 天：' + txt);
  await p.clock.runFor(14 * 3600 * 1000 + 60 * 1000); await p.waitForTimeout(50);
  txt = await p.textContent('#list .tile');
  assert(txt.includes('就是今天'), '跨過午夜自動變「就是今天」：' + txt);
  assert((await p.textContent('#today-line')).includes('2026/10/14'), '今天日期更新');
  // 第二筆帶時間、詳情秒級更新
  await p.click('#add'); await p.fill('#f-title', '演唱會'); await p.fill('#f-date', '2026-12-20'); await p.fill('#f-time', '19:30'); await p.click('#rep-none'); await p.click('#bg-g1'); await p.check('#f-pinned'); await p.click('#f-save');
  assert((await p.textContent('#pinned')).includes('演唱會'), '置頂大卡');
  await p.click('#pinned .tile');
  const c1 = await p.textContent('#d-clock'); await p.clock.runFor(1100); const c2 = await p.textContent('#d-clock');
  assert(c1 !== c2 && /秒/.test(c2), '詳情秒數跳動 ' + c1 + ' → ' + c2);
  // 分享圖片（無 downloads 能力 → 顯示圖片）
  await p.click('#d-share'); await p.waitForTimeout(300);
  const img = await p.$eval('#d-img', i => [i.naturalWidth, i.naturalHeight]).catch(() => null);
  assert(img && img[0] === 1080 && img[1] === 1350, '分享圖片 1080×1350 ' + img);
  await p.click('#d-close');
  // 自訂順序拖曳
  for (const t of ['A 項', 'B 項']) { await p.click('#add'); await p.fill('#f-title', t); await p.fill('#f-date', '2027-03-01'); await p.click('#f-save'); }
  await p.click('#sort-custom');
  const order1 = await p.$$eval('#list .tile .ttl', e => e.map(x => x.textContent));
  const tiles = await p.$$('#list .tile');
  const b0 = await tiles[0].boundingBox(), b2 = await tiles[2].boundingBox();
  await p.mouse.move(b0.x + 30, b0.y + 30); await p.mouse.down(); await p.clock.runFor(500);
  await p.mouse.move(b2.x + 40, b2.y + 40, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(50);
  const order2 = await p.$$eval('#list .tile .ttl', e => e.map(x => x.textContent));
  assert(order2[2] === order1[0] && order2[0] === order1[1], '長按拖曳排序 ' + order1 + ' → ' + order2);
  // 左滑刪除（touch pointer）
  const before = (await p.$$('#app .tile[data-id]')).length;
  await p.evaluate(() => {
    const t = document.querySelector('#list .tile'), r = t.getBoundingClientRect(), y = r.top + 40;
    const ev = (type, x) => (type === 'pointerdown' ? t : window).dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, isPrimary: true }));
    ev('pointerdown', r.right - 10); for (let i = 1; i <= 8; i++) ev('pointermove', r.right - 10 - i * 20); ev('pointerup', r.right - 170);
  });
  await p.clock.runFor(300); await p.waitForTimeout(50);
  assert((await p.$$('#app .tile[data-id]')).length === before - 1 && await p.isVisible('#toast-undo'), '左滑刪除並提供復原');
  await p.click('#toast-undo');
  assert((await p.$$('#app .tile[data-id]')).length === before, '復原刪除');
  // 編輯驗證
  await p.click('#add'); await p.fill('#f-title', ''); await p.click('#f-save');
  assert((await p.textContent('#f-err')).includes('1～30'), '名稱空白提示');
  await p.fill('#f-title', 'x'); await p.fill('#f-date', '1899-12-31'); await p.click('#f-save');
  assert((await p.textContent('#f-err')).includes('1900'), '日期範圍檢查');
  await p.click('#f-cancel');
  await p.reload(); await p.waitForTimeout(100);
  assert((await p.$$('#app .tile[data-id]')).length === before && await p.getAttribute('#sort-custom', 'aria-pressed') === 'true', '重新整理後資料與排序保留 ' + before + ' / ' + (await p.$$('#app .tile[data-id]')).length + ' ' + await p.getAttribute('#sort-custom', 'aria-pressed'));
  // 100 筆
  const ms = await p.evaluate(() => {
    const arr = []; for (let i = 0; i < 100; i++) arr.push({ id: 'i' + i, title: '項目 ' + i, date: '2027-' + String(1 + i % 12).padStart(2, '0') + '-10', time: null, repeat: ['none', 'yearly', 'monthly'][i % 3], emoji: '⭐', bg: 'c:#4a6cf7', pinned: false, note: '', order: i, createdAt: 0 });
    localStorage.setItem('countdown-board:v1:items', JSON.stringify(arr)); return 0;
  });
  await p.reload(); await p.waitForTimeout(100);
  const rt = await p.evaluate(() => { const t = performance.now(); document.querySelector('#sort-soon').click(); return performance.now() - t; });
  assert((await p.$$('#app .tile[data-id]')).length === 100 && rt < 100, '100 筆渲染 ' + rt.toFixed(1) + 'ms');
  assert(await p.isDisabled('#add'), '達 100 筆停用新增');
  await ctx.close();
  // downloads 能力模擬
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(() => { window.claude = { use: async n => n === 'downloads' ? { save: async o => { window.__saved = { filename: o.filename, type: o.data && o.data.type, size: o.data && (o.data.size || o.data.length) }; } } : null }; });
    const p = await ctx.newPage(); watch(p, 'dl');
    await p.clock.setFixedTime(NOW);
    await p.goto(URL); await p.waitForTimeout(150);
    assert((await p.textContent('#export')) === '匯出 JSON', '有 downloads 時顯示匯出');
    await p.click('#pinned .tile'); await p.click('#d-share'); await p.waitForTimeout(300);
    const sv = await p.evaluate(() => window.__saved);
    assert(sv && /\.png$/.test(sv.filename) && sv.type === 'image/png' && sv.size > 10000, 'downloads.save 收到 PNG ' + JSON.stringify(sv));
    await p.click('#d-close'); await p.click('#export'); await p.waitForTimeout(100);
    const sj = await p.evaluate(() => window.__saved);
    assert(sj && /\.json$/.test(sj.filename), '匯出 JSON ' + JSON.stringify(sj));
    await ctx.close();
  }
  await browser.close();
  assert(errors.length === 0, '無 console error ' + JSON.stringify(errors));
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
