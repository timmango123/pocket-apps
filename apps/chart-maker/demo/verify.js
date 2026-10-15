// 簡易圖表產生器驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async o => { const d = o.data; let info = { filename: o.filename, type: typeof d }; if (d instanceof Blob) { const bm = await createImageBitmap(d); info = { ...info, blob: true, w: bm.width, h: bm.height, size: d.size }; } else info.len = d.length; window.__saved.push(info); } } : null }; };
async function open(browser, opt, mock = true) {
  const ctx = await browser.newContext(opt); if (mock) await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(400);
  return { ctx, page, errors };
}
const setData = async (page, t) => { await page.fill('#data-input', t); await page.waitForTimeout(250); };
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  ok((await page.textContent('#detect')).includes('6 個類別 × 2 個系列'), '範例：' + (await page.textContent('#detect')).trim());
  ok(await page.locator('#chart path[data-tip]').count() === 12, '範例長條圖 12 根');

  // 1. 純邏輯
  const L = await page.evaluate(() => ({
    t1: niceTicks(0, 1690, true), t2: niceTicks(-30, 80, true), t3: niceTicks(3.2, 3.9, false),
    f1: fmt(1e12, { format: 'auto', abbr: 'zh' }), f2: fmt(1e12, { format: 'auto', abbr: 'en' }), f3: fmt(1234567, { format: 'thousands', abbr: 'none' }),
    f4: fmt(45.678, { format: 'd1', abbr: 'zh' }), f5: fmt(12, { format: 'pct', abbr: 'zh' }), f6: fmt(-2500, { format: 'int', abbr: 'zh' }),
    p1: parseData('一月\t1,200\n二月\t$980\n三月\tNT$1,050\n四月\t12%\n五月\t￥300\n六月\tabc'),
    p2: parseData('x,y,size\n1,2,3\n2,4,1\n3,5,9'),
    p3: parseData('5\n8\n13'),
    p4: parseData('"台北, 大安",100\n"新竹",80'),
  }));
  ok(L.t1.step === 500 && L.t1.ticks.join() === '0,500,1000,1500,2000', `nice ticks 0–1690 → 步距 ${L.t1.step}：${L.t1.ticks}`);
  ok(L.t2.step === 20 && L.t2.lo === -40 && L.t2.ticks.includes(0), `nice ticks −30–80 → 步距 ${L.t2.step}：${L.t2.ticks}`);
  ok(L.t3.step === 0.1 || L.t3.step === 0.2, `nice ticks 3.2–3.9（不從 0）→ ${L.t3.ticks}`);
  ok(L.f1 === '1.0 兆' && L.f2 === '1.0T', `1e12 → ${L.f1}／${L.f2}`);
  ok(L.f3 === '1,234,567' && L.f4 === '45.7' && L.f5 === '12%' && L.f6 === '−2,500', `格式：${L.f3}、${L.f4}、${L.f5}、${L.f6}`);
  ok(JSON.stringify(L.p1.series[0].values) === '[1200,980,1050,12,300,null]' && L.p1.errors[0] === '第 6 列第 2 欄「abc」不是數字', `剝除千分位與貨幣、% ；錯誤：${L.p1.errors[0]}`);
  ok(L.p2.hasHeader && !L.p2.labelCol && L.p2.series.length === 3 && L.p2.delim === '逗號', 'CSV 三欄數值 + 標題列');
  ok(L.p3.labels.join() === '1,2,3' && L.p3.series.length === 1, '單欄數字以 1、2、3 為標籤');
  ok(L.p4.labels[0] === '台北, 大安', 'CSV 引號欄位');

  // 2. Excel 兩欄 Tab 貼上 → 長條
  await setData(page, '品項\t銷量\n咖啡\t320\n紅茶\t210\n綠茶\t180\n果汁\t95');
  ok((await page.textContent('#detect')).includes('4 個類別 × 1 個系列'), 'Tab 兩欄偵測');
  ok(await page.locator('#chart path[data-tip]').count() === 4, '畫出 4 根長條');
  // 3. 負值的 0 軸
  await setData(page, '季\t損益\nQ1\t-30\nQ2\t45\nQ3\t80\nQ4\t-12');
  const zero = await page.evaluate(() => {
    const svg = document.getElementById('chart');
    const bars = [...svg.querySelectorAll('path[data-tip]')].map(p => p.getBBox());
    const lines = [...svg.querySelectorAll('line')].filter(l => l.getAttribute('stroke-width') === '1.2');
    const zy = lines.length ? +lines[0].getAttribute('y1') : null;
    // 正值長條底邊 = 0 軸；負值長條頂邊 = 0 軸
    return { zy, pos: bars.filter((b, i) => [1, 2].includes(i)).map(b => b.y + b.height), neg: bars.filter((b, i) => [0, 3].includes(i)).map(b => b.y) };
  });
  ok(zero.zy != null && [...zero.pos, ...zero.neg].every(v => Math.abs(v - zero.zy) < 0.6), `負值 0 軸位置正確 y=${zero.zy}，長條基線 ${[...zero.pos, ...zero.neg].map(v => v.toFixed(1))}`);
  await page.screenshot({ path: path.join(OUT, '390x844-negative.png') });

  // 4. 各圖表類型
  await page.click('#btn-sample');
  for (const t of ['hbar', 'stacked', 'line', 'area', 'pie', 'donut', 'scatter', 'bar']) {
    await page.click('#type-' + t); await page.waitForTimeout(80);
    const n = await page.locator('#chart [data-tip]').count();
    ok(n > 0, `${t}：${n} 個可點標記`);
  }
  // 圓餅：合併小扇形、負值排除
  await setData(page, 'A\t50\nB\t30\nC\t15\nD\t2\nE\t1.5\nF\t-4');
  await page.click('#type-pie');
  const pie = await page.evaluate(() => ({ slices: document.querySelectorAll('#chart path[data-tip]').length, note: document.getElementById('note').textContent, other: [...document.querySelectorAll('#chart path[data-tip]')].some(p => p.dataset.tip.startsWith('其他')) }));
  ok(pie.slices === 4 && pie.other && pie.note.includes('排除 1 個'), `圓餅：4 扇形（含其他），${pie.note}`);
  await setData(page, 'A\t0\nB\t0');
  ok((await page.textContent('#chart')).includes('無法繪製'), '全為 0 的圓餅提示無法繪製');
  await setData(page, '');
  ok((await page.textContent('#chart')).includes('請貼上資料'), '空資料占位');
  await page.click('#btn-sample'); await page.click('#type-line');
  // 圖例切換
  const cnt = () => page.locator('#chart path[stroke-linejoin="round"][fill="none"]').count();
  const before = await cnt();
  await page.locator('#chart [data-leg="s1"]').click();
  const after = await cnt();
  ok(before === 2 && after === 1, `點圖例隱藏系列：線 ${before} → ${after}`);
  await page.locator('#chart [data-leg="s1"]').click();
  // 提示泡泡
  await page.locator('#chart rect[data-tip]').nth(2).click();
  const tip = await page.textContent('#tip');
  ok(!(await page.locator('#tip').isHidden()) && tip.includes('三月') && tip.includes('門市：1,420') && tip.includes('網路：1,210'), '提示泡泡：' + tip.replace(/\n/g, ' / '));
  // 下載 PNG 2x
  await page.click('#type-bar'); await page.click('#btn-png'); await page.waitForTimeout(800);
  await page.click('#btn-svg'); await page.waitForTimeout(200);
  const saved = await page.evaluate(() => window.__saved);
  ok(saved[0] && saved[0].blob && saved[0].w === 1920 && saved[0].h === 1440, `PNG 2x：${JSON.stringify(saved[0])}`);
  ok(saved[1] && saved[1].filename.endsWith('.svg') && saved[1].len > 1000, `SVG：${saved[1] && saved[1].filename}`);
  // PNG 中文標籤：在 canvas 上把匯出的 SVG 畫出後檢查標題列有深色像素
  const ink = await page.evaluate(async () => {
    const [w, h] = exportSize(); const b = await svgToPngBlob(exportSVG(), w, h); const bm = await createImageBitmap(b);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, c.width, 120).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 100) dark++; return dark;
  });
  ok(ink > 2000, `PNG 標題區有文字像素 ${ink}`);
  // SVG 無外部參照
  const svgSrc = await page.evaluate(() => exportSVG());
  ok(!/href=|url\(|<image/.test(svgSrc) && svgSrc.startsWith('<svg xmlns'), 'SVG 自含，無外部參照');
  ok(await page.evaluate(() => localStorage.getItem('chart-maker:v1:opts') !== null), '設定存於 chart-maker:v1:opts');
  // 樣式面板
  await page.click('#style-panel summary');
  await page.check('#o-labels'); await page.fill('#o-ytitle', '千元');
  await page.click('#btn-sample');
  ok(errors.length === 0, 'no console errors ' + errors.join(' | '));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(sw <= 390, '390 無水平捲動');
  await page.uncheck('#o-labels'); await page.fill('#o-ytitle', '');
  await page.evaluate(() => { document.getElementById('style-panel').open = false; document.getElementById('toast').hidden = true; scrollTo(0, 0); });
  await page.screenshot({ path: path.join(OUT, '390x844.png') });
  await page.evaluate(() => document.querySelector('.right').scrollIntoView());
  await page.screenshot({ path: path.join(OUT, '390x844-preview.png') });
  for (const t of ['pie', 'stacked', 'scatter']) { await page.click('#type-' + t); if (t === 'scatter') await setData(page, '城市,面積,人口,密度\n台北,272,2.5,9.2\n新北,2053,4,1.9\n桃園,1221,2.3,1.9\n台中,2215,2.8,1.3\n台南,2192,1.9,0.9\n高雄,2952,2.7,0.9'); await page.evaluate(() => { document.getElementById('toast').hidden = true; document.querySelector('.right').scrollIntoView(); }); await page.screenshot({ path: path.join(OUT, `390x844-${t}.png`) }); }
  await ctx.close();

  // 無 downloads 能力
  { const r = await open(browser, mob, false);
    ok(await r.page.isHidden('#btn-png') && await r.page.isVisible('#btn-show-png'), '無 downloads：隱藏下載、顯示「產生 PNG 圖片」');
    await r.page.click('#btn-show-png'); await r.page.waitForTimeout(600);
    ok(await r.page.isVisible('#png-img'), '產生可長按儲存的 PNG');
    await r.ctx.close(); }

  for (const [name, o] of [['360x780', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['390x844-dark', { ...mob, colorScheme: 'dark' }], ['1280x860-desktop', { viewport: { width: 1280, height: 860 } }]]) {
    const r = await open(browser, o);
    if (name.includes('dark')) { await r.page.click('#style-panel summary'); await r.page.selectOption('#o-bg', 'transparent'); await r.page.click('#style-panel summary'); await r.page.click('#type-line'); }
    const m = await r.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(m.sw <= m.iw && m.iw === o.viewport.width, `${name} 無水平捲動（${m.sw}/${m.iw}）`);
    ok(r.errors.length === 0, `${name} 無錯誤 ${r.errors.join('|')}`);
    if (name.includes('dark')) {
      const fill = await r.page.evaluate(() => document.querySelector('#chart text').getAttribute('fill'));
      ok(fill === '#eceff2', '深色頁面＋透明背景：預覽文字用淺色 ' + fill);
      const ex = await r.page.evaluate(() => exportSVG().match(/<text[^>]*fill="([^"]+)"/)[1]);
      ok(ex === '#16202a', '匯出依背景設定（透明→深色文字）' + ex);
      await r.page.evaluate(() => document.querySelector('.right').scrollIntoView());
    }
    await r.page.screenshot({ path: path.join(OUT, name + '.png') });
    await r.ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
