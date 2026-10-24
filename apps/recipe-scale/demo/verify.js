// 食譜換算驗證腳本：node verify.js
// 390×844 與大廳 iframe 三種尺寸、橫式、桌面，淺色／深色；檢查無錯誤、主要流程可用，並輸出 cover-390x520.png。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(os.tmpdir(), 'recipe-scale-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let n = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [], requests = [];
  const sizes = [
    { name: '390x844', w: 390, h: 844 }, { name: '375x500', w: 375, h: 500 }, { name: '390x610', w: 390, h: 610 }, { name: '430x740', w: 430, h: 740 },
    { name: '360x640', w: 360, h: 640 }, { name: '844x390', w: 844, h: 390 }, { name: '1280x800', w: 1280, h: 800, desktop: true }
  ];
  for (const scheme of ['light', 'dark']) for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: !s.desktop, hasTouch: !s.desktop, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(`${s.name}/${scheme}: ${m.text()}`); });
    p.on('pageerror', e => errors.push(`${s.name}/${scheme}: ${e.message}`));
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url()); });
    await p.goto(URL); await p.waitForTimeout(150);
    for (const by of ['serv', 'ing', 'pan', 'mult']) {
      await p.click(`#by [data-by="${by}"]`);
      for (const mode of ['orig', 'metric', 'spoon', 'tw']) {
        await p.click(`#units [data-mode="${mode}"]`);
        const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        if (sw > 0) throw new Error(`FAIL: ${s.name} ${scheme} ${by}/${mode} 水平溢出 ${sw}px`);
      }
    }
    await p.click('#units [data-mode="orig"]'); await p.click('#by [data-by="serv"]');
    assert(true, `${s.name} ${scheme} 四種換算方式 × 四種單位都沒有水平捲動`);
    if (scheme === 'light' || s.name === '390x844') await p.screenshot({ path: `${OUT}/${s.name}${scheme === 'dark' ? '-dark' : ''}.png` });
    if (s.w < 820) await p.click('#tab-edit');
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(sw <= 0, `${s.name} ${scheme} 原文頁無水平捲動`);
    if (s.name === '390x844' || s.name === '375x500') await p.screenshot({ path: `${OUT}/${s.name}-edit${scheme === 'dark' ? '-dark' : ''}.png` });
    await ctx.close();
  }

  // cover
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('cover: ' + e.message));
    await p.goto(URL); await p.waitForTimeout(200);
    await p.evaluate(() => { document.querySelector('#lcard').scrollIntoView({ block: 'start' }); window.scrollBy(0, -14); });
    await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/cover-390x520.png` });
    await ctx.close();
  }

  // flows
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push('flow: ' + m.text()); });
  p.on('pageerror', e => errors.push('flow: ' + e.message));
  await p.goto(URL); await p.waitForTimeout(200);
  const txt = s => p.textContent(s).then(t => t.replace(/\s+/g, ' ').trim());
  const row = name => p.evaluate(nm => { const b = Array.from(document.querySelectorAll('#ings button[data-i]')).find(x => x.querySelector('.nm').firstChild.textContent === nm); return b ? b.querySelector('.amt b').textContent.trim() : null; }, name);
  const sub = name => p.evaluate(nm => { const b = Array.from(document.querySelectorAll('#ings button[data-i]')).find(x => x.querySelector('.nm').firstChild.textContent === nm); const s = b && b.querySelector('.amt small'); return s ? s.textContent.trim() : ''; }, name);

  // 範例
  assert(await p.isVisible('#ex-badge'), '首次開啟是範例並標示「範例」');
  assert((await p.inputValue('#title')) === '古早味紅燒肉', '標題從原文帶出');
  assert((await txt('#factor-v')) === '×1.5', '範例 4 → 6 人份 ×1.5');
  assert((await row('五花肉')) === '1 斤 8 兩', '五花肉 1 斤 × 1.5 = 1 斤 8 兩');
  assert((await sub('五花肉')).includes('900 g'), '並附 900 g');
  assert((await row('醬油')) === '½ 杯', '醬油 ⅓ 杯 × 1.5 = ½ 杯');
  assert((await row('白胡椒粉')) === '少許', '少許原樣顯示');
  // 人數加減
  await p.click('#target-p');
  assert((await p.inputValue('#target')) === '7' && (await txt('#factor-v')) === '×1.75', '要做 7 人份 ×1.75');
  await p.click('#target-m'); await p.click('#target-m'); await p.click('#target-m');
  assert((await p.inputValue('#target')) === '4' && (await txt('#factor-v')) === '×1', '回到 4 人份 ×1');
  assert((await row('五花肉')) === '1 斤', '×1 時五花肉 1 斤');
  await p.fill('#target', '8');
  assert((await row('五花肉')) === '2 斤', '輸入 8 人份：五花肉 2 斤');
  await p.fill('#target', 'abc');
  assert((await txt('#ft-b')).includes('要做的人數'), '人數亂打顯示錯誤說明');
  assert((await txt('#factor-v')) === '—', '錯誤時倍數顯示 —');
  assert((await row('五花肉')) === '1 斤', '錯誤時材料顯示原本份量');
  await p.fill('#target', '０'); assert((await txt('#ft-b')).includes('大於 0'), '0 人份擋下');
  await p.fill('#target', '6');
  // 單位
  await p.click('#units [data-mode="metric"]');
  assert((await row('五花肉')) === '900 g', '公克模式五花肉 900 g');
  assert((await row('醬油')).replace('≈', '') === Math.round(120 * 1.18) + ' g', '公克模式醬油 ½ 杯 ≈ 142 g');
  await p.click('#units [data-mode="tw"]');
  assert((await row('五花肉')) === '1 斤 8 兩', '台斤兩模式');
  await p.click('#units [data-mode="orig"]');
  // 材料詳情
  await p.locator('#ings button[data-i]', { hasText: '醬油' }).first().click();
  await p.waitForTimeout(350);
  assert(await p.isVisible('#sheet-ing') && (await txt('#si-h')) === '醬油', '點醬油打開詳情');
  assert((await txt('#si-b')).includes('120 ml'), '詳情列出 120 ml');
  await p.click('#si-base'); await p.waitForTimeout(350);
  assert((await p.getAttribute('#by [data-by="ing"]', 'aria-pressed')) === 'true', '改成「以食材為準」');
  await p.fill('#have', '1/2');
  assert(Math.abs(parseFloat((await txt('#factor-v')).slice(1)) - 1.5) < 1e-9, '醬油 ⅓ 杯 → ½ 杯 = ×1.5');
  await p.selectOption('#have-u', 'g'); await p.fill('#have', '200');
  assert((await txt('#factor-v')) === '×' + (Math.round(200 / (80 * 1.18) * 100) / 100), '醬油改成 200 g（經密度）');
  // 倍數
  await p.click('#by [data-by="mult"]');
  await p.click('#mult-chips [data-v="1/2"]');
  assert((await txt('#factor-v')) === '×0.5' && (await row('五花肉')) === '8 兩', '×½：五花肉 8 兩');
  await p.fill('#mult', '2/3');
  assert((await txt('#factor-v')) === '×0.67', '自訂 2/3');
  await p.fill('#mult', '500');
  assert((await txt('#ft-b')).includes('100 倍'), '超過 100 倍擋下');
  await p.fill('#mult', '2');

  // 換成蜂蜜蛋糕：烤模
  await p.click('#lib-btn'); await p.waitForTimeout(300);
  await p.click('#reclist li:nth-child(2) .open'); await p.waitForTimeout(300);
  assert((await p.inputValue('#title')).startsWith('蜂蜜蛋糕'), '開啟蜂蜜蛋糕');
  assert((await p.getAttribute('#by [data-by="pan"]', 'aria-pressed')) === 'true', '蛋糕預設用烤模換算');
  assert((await txt('#factor-v')) === '×1.78', '6 吋 → 8 吋 = ×1.78');
  assert((await row('細砂糖')) === Math.round(60 * 64 / 36) + ' g', '細砂糖 60 g × 64/36 = 107 g');
  await p.fill('#pan-to [data-k="a"]', '7');
  assert((await txt('#factor-v')) === '×' + (Math.round(49 / 36 * 100) / 100), '7 吋 ×1.36');
  await p.click('#pan-to [data-shape="square"]'); await p.selectOption('#pan-to [data-k="unit"]', 'cm'); await p.fill('#pan-to [data-k="a"]', '20');
  assert((await txt('#factor-v')) === '×' + (Math.round(400 / (Math.PI * (6 * 2.54 / 2) ** 2) * 100) / 100), '20 cm 方模');

  // 新食譜：輸入與解析
  await p.click('#lib-btn'); await p.waitForTimeout(300);
  await p.click('#lib-new'); await p.waitForTimeout(300);
  assert(await p.isVisible('#ed') && (await p.inputValue('#ed')) === '', '新增食譜進入空白原文');
  await p.fill('#ed', '蔥油餅（2 人份）\n中筋麵粉 2 杯\n熱水 3/4 杯\n鹽 1 小匙\n蔥花 適量\n\n作法\n1. 揉麵 10 分鐘。');
  await p.waitForTimeout(200);
  assert((await txt('#parse-sum')).includes('4 項材料') && (await txt('#parse-sum')).includes('2 人份'), '辨識 4 項材料、2 人份');
  await p.click('#done-edit'); await p.waitForTimeout(100);
  await p.click('#by [data-by="serv"]');
  await p.fill('#target', '3');
  assert((await row('中筋麵粉')) === '3 杯', '2 杯 × 1.5 = 3 杯');
  assert((await sub('中筋麵粉')).includes(Math.round(3 * 240 * 0.53) + ' g'), '附 382 g');
  assert(!(await p.isVisible('#ex-badge')), '自己的食譜沒有範例標記');
  // 複製
  await p.click('#copy'); await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  assert(clip.startsWith('蔥油餅（3 人份）') && clip.includes('中筋麵粉 3 杯') && clip.includes('1. 揉麵 10 分鐘。'), '複製換算後的食譜文字');
  // 另存新食譜
  const before = await p.evaluate(() => __rs.recs().length);
  await p.click('#save-new'); await p.waitForTimeout(150);
  assert((await p.evaluate(() => __rs.recs().length)) === before + 1 && (await p.inputValue('#title')).startsWith('蔥油餅'), '另存成新食譜');
  assert((await row('中筋麵粉')) === '3 杯' && (await txt('#factor-v')) === '×1', '新食譜以 3 人份為原始份量');
  await p.click('#toast-undo');
  assert((await p.evaluate(() => __rs.recs().length)) === before, '另存可以復原');
  // 重新整理後保留
  await p.reload(); await p.waitForTimeout(250);
  assert((await p.inputValue('#title')) === '蔥油餅' && (await p.inputValue('#target')) === '3', '重新整理後食譜與人數都在');
  // 刪除與復原
  await p.click('#lib-btn'); await p.waitForTimeout(300);
  const cnt = await p.locator('#reclist li').count();
  await p.click('#reclist li:first-child .del');
  assert((await p.locator('#reclist li').count()) === cnt - 1, '刪除食譜');
  await p.click('#toast-undo');
  assert((await p.locator('#reclist li').count()) === cnt, '刪除可以復原');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 設定：量杯 200 ml
  await p.click('#set-btn'); await p.waitForTimeout(300);
  await p.click('#cups [data-ml="200"]');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.click('#units [data-mode="metric"]');
  assert((await row('中筋麵粉')).replace('≈', '') === Math.round(3 * 200 * 0.53) + ' g', '日本量杯：3 杯麵粉 ≈ 318 g');
  // 清空與復原
  await p.click('#tab-edit'); await p.click('#clear-text');
  assert((await p.inputValue('#ed')) === '', '清空原文');
  await p.click('#toast-undo');
  assert((await p.inputValue('#ed')).startsWith('蔥油餅'), '清空可以復原');
  // 匯入壞檔不當掉
  await p.click('#tab-scale'); await p.click('#lib-btn'); await p.waitForTimeout(300);
  await p.setInputFiles('#import-file', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"recipes":[{"text":5},null,"x"]}') });
  await p.waitForTimeout(200);
  assert((await txt('#toast-t')).includes('沒有可用的食譜'), '匯入壞檔顯示原因');
  const good = JSON.stringify({ app: 'recipe-scale', recipes: [{ text: '鬆餅\n牛奶 1 杯\n雞蛋 1 顆', id: 'zz' }] });
  await p.setInputFiles('#import-file', { name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(good) });
  await p.waitForTimeout(200);
  assert((await txt('#toast-t')).includes('匯入 1 個食譜'), '匯入備份');

  // 審查回饋：壞掉的 JSON 備份
  await p.setInputFiles('#import-file', { name: 'recipes-20261018.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"recipe-scale","recipes":[{"text":"鬆餅') });
  await p.waitForTimeout(200);
  assert((await txt('#toast-t')).includes('備份檔損壞'), '截斷的 JSON 備份顯示「備份檔損壞」，不當成文字食譜');
  // 超過 1000 個食譜：重新整理後一個都不少
  const many = JSON.stringify({ app: 'recipe-scale', recipes: Array.from({ length: 1001 }, (_, i) => ({ text: '食譜' + i + '\n糖 ' + (i + 1) + ' g' })) });
  await p.setInputFiles('#import-file', { name: 'many.json', mimeType: 'application/json', buffer: Buffer.from(many) });
  await p.waitForTimeout(400);
  const nBefore = await p.evaluate(() => __rs.recs().length);
  await p.reload(); await p.waitForTimeout(400);
  assert(nBefore > 1001 && (await p.evaluate(() => __rs.recs().length)) === nBefore, `匯入 1001 個後重新整理仍是 ${nBefore} 個`);
  await p.keyboard.press('Escape');
  // 2000 行食譜重畫時間
  await p.click('#lib-btn'); await p.waitForTimeout(300); await p.click('#lib-new'); await p.waitForTimeout(300);
  await p.fill('#ed', '大鍋菜（10 人份）\n' + Array.from({ length: 2000 }, (_, i) => '材料' + i + ' ' + (i % 9 + 1) + ' 大匙').join('\n'));
  await p.waitForTimeout(500);
  await p.click('#tab-scale');
  const redraw = await p.evaluate(() => { const ts = []; for (let i = 0; i < 5; i++) { const t = performance.now(); document.getElementById('target-p').click(); ts.push(performance.now() - t); } return ts.sort((a, b) => a - b)[2]; });
  assert(redraw < 100, '2000 行食譜每次重畫 < 100 ms（中位數 ' + redraw.toFixed(0) + ' ms）');
  assert((await p.locator('#ings li.ing').count()) === 300 && (await txt('#show-all')).includes('還有 1700 項'), '超長清單先顯示 300 項，並說明還有 1700 項');
  await p.click('#show-all');
  assert((await p.locator('#ings li.ing').count()) === 2000, '按「全部顯示」後 2000 項都在');
  await ctx.close();

  // 版面：360×640 的觸控尺寸、長方形模具、預覽、份量單位
  {
    const c2 = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const q = await c2.newPage();
    q.on('pageerror', e => errors.push('360: ' + e.message)); q.on('console', m => { if (m.type() === 'error') errors.push('360: ' + m.text()); });
    await q.goto(URL); await q.waitForTimeout(200);
    for (const sel of ['#base-m', '#base-p', '#target-m', '#target-p']) { const b = await q.locator(sel).boundingBox(); assert(b.width >= 44 && b.height >= 44, `${sel} ${Math.round(b.width)}×${Math.round(b.height)} ≥ 44`); }
    const pv = await q.locator('#preview').boundingBox();
    assert(pv && pv.y + pv.height <= 640, '360×640 第一個畫面就看得到材料預覽（底邊 ' + Math.round(pv.y + pv.height) + '）');
    const before = await q.textContent('#preview-t');
    await q.click('#target-p');
    const after = await q.textContent('#preview-t');
    assert(before.includes('1 斤 8 兩') && after.includes('1 斤 12 兩'), '按 + 後預覽立刻變成 7 人份的份量');
    await q.click('#by [data-by="pan"]'); await q.click('#pan-to [data-shape="rect"]');
    const ys = await q.evaluate(() => Array.from(document.querySelectorAll('#pan-to .dims > *')).filter(e => !e.hidden).map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.top + r.height / 2), Math.round(r.width)]; }));
    assert(ys.length === 4 && ys.every(y => Math.abs(y[0] - ys[0][0]) <= 2) && ys[2][1] >= 60, '長方形模具：長 × 寬 單位排在同一列，寬欄夠寬 ' + JSON.stringify(ys));
    for (const sel of ['#pan-to [data-shape="rect"]', '#pan-from [data-shape="round"]']) { const b = await q.locator(sel).boundingBox(); assert(b.height >= 44, sel + ' 高 ≥ 44'); }
    await q.click('#units [data-mode="metric"]'); await q.click('#units [data-mode="orig"]');
    await q.click('#lib-btn'); await q.waitForTimeout(300);
    await q.click('#reclist li:nth-child(1) .del'); await q.waitForTimeout(300);
    const ub = await q.locator('#toast-undo').boundingBox(); assert(ub.height >= 44 && ub.width >= 44, '復原鈕 ≥ 44');
    await q.click('#toast-undo');
    await q.click('#reclist li:nth-child(3) .open'); await q.waitForTimeout(300);
    assert((await q.textContent('#l-base')) === '原本幾份' && (await q.textContent('#list-title')) === '12 份的材料', 'Makes 24 cookies 用「份」不用「人份」');
    await c2.close();
  }

  assert(!requests.length, '沒有對外網路請求 ' + requests.slice(0, 3).join(' '));
  assert(!errors.length, '沒有 page error / console error ' + errors.slice(0, 5).join(' | '));
  await browser.close();
  console.log(`verify: ${n} checks passed, 0 failed`);
})().catch(e => { console.error(e.message); process.exit(1); });
