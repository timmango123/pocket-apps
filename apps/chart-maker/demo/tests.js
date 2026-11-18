// 簡易圖表產生器：上架評分 toFix 的回歸測試（node tests.js，約 25 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
// 用本機 http 開（file:// 的 localStorage 在重新整理時偶爾會遺失，測不準保存）
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
let URL_ = '';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const MOB = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); URL_ = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(opt = MOB, init) {
    const ctx = await browser.newContext(opt);
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL_); await p.waitForFunction(() => window.__cmReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tap = async q => { await touch('touchStart', [q]); await touch('touchEnd', []); await frames(); };
    const setData = async t => { await p.fill('#data-input', t); await p.evaluate(() => new Promise(r => setTimeout(r, 200))); };
    const type = t => p.click('#type-' + t);
    // 圖中所有文字與圖形都在 viewBox 內（容許 1px）
    const inside = () => p.evaluate(() => {
      const svg = document.getElementById('chart'), s = svg.getBoundingClientRect(), bad = [];
      for (const el of svg.querySelectorAll('text, path, circle')) { const b = el.getBoundingClientRect(); if (b.left < s.left - 1 || b.top < s.top - 1 || b.right > s.right + 1 || b.bottom > s.bottom + 1) bad.push((el.textContent || el.tagName) + ` ${(b.left - s.left).toFixed(0)},${(b.top - s.top).toFixed(0)},${(b.right - s.left).toFixed(0)}/${s.width.toFixed(0)}`); }
      return bad;
    });
    return { ctx, p, touch, tap, frames, setData, type, inside };
  }

  // 1. 刻度：小數與大數縮寫時每個刻度標籤都不同（以前 0.001～0.004 全顯示「0」，102.5 萬顯示成 103 萬）
  {
    const t = await open();
    const L = await t.p.evaluate(() => {
      const { tickLabels, niceTicks, fmt } = window.__cm, o = { format: 'auto', abbr: 'zh' };
      return {
        small: tickLabels(niceTicks(0.001, 0.004, true), o), mill: tickLabels(niceTicks(1000000, 1100000, false), o),
        mixed: tickLabels(niceTicks(0, 2500000, true), o), en: tickLabels(niceTicks(0, 25000, true), { format: 'auto', abbr: 'en' }),
        int: tickLabels(niceTicks(0, 2, true), { format: 'int', abbr: 'zh' }), neg: niceTicks(-50, -42, false),
        tiny: fmt(0.0034, o), negZero: fmt(-0.0001, { format: 'd2', abbr: 'zh' }), thou: fmt(12345678, { format: 'thousands', abbr: 'zh' }),
      };
    });
    for (const k of ['small', 'mill', 'mixed', 'en', 'int']) assert(new Set(L[k]).size === L[k].length, `${k} 刻度標籤互不相同：${L[k].join(' ')}`);
    eq(L.small.slice(-1)[0], '0.004', '0.004 顯示四位小數');
    assert(L.mixed.every(s => s === '0' || s.endsWith('萬')), '同一軸用同一個單位：' + L.mixed.join(' '));
    eq([L.neg.lo, L.neg.hi], [-50, -42], '全負值、不從 0 開始時不再硬拉到 0');
    eq(L.tiny, '0.0034', '很小的數值保留有效位數');
    eq(L.negZero, '0.00', '不會出現「−0.00」');
    eq(L.thou, '12,345,678', '「千分位」格式不縮寫');
    await t.ctx.close();
  }

  // 2. 手機輸入：全形數字、全形逗號、年份標籤、超出範圍
  {
    const t = await open();
    const P = await t.p.evaluate(() => {
      const { parseData, parseNum } = window.__cm;
      return {
        fw: parseNum('１２０').v, fwNeg: parseNum('－５').v, paren: parseNum('（３０）').v,
        comma: parseData('一月，１２０\n二月，９８\n三月，１５０'), dun: parseData('甲、3\n乙、5'),
        years: parseData('年\t銷量\n2019\t100\n2020\t120'), yearsNoHead: parseData('2019 100\n2020 120\n2021 90'),
        month: parseData('月\t值\n1\t5\n2\t6\n3\t7'), xy: parseData('x,y\n1,2\n2,4'), huge: parseData('k\tv\na\t1e200\nb\t3'),
        spaceThousands: parseData('一月 1，240\n二月 980'),
      };
    });
    eq([P.fw, P.fwNeg, P.paren], [120, -5, -30], '全形數字、全形負號、全形括號負數');
    eq([P.comma.labels, P.comma.series[0].values, P.comma.errors.length], [['一月', '二月', '三月'], [120, 98, 150], 0], '中文輸入法的全形逗號當分隔');
    eq(P.dun.series[0].values, [3, 5], '頓號也可以分隔');
    eq([P.years.labelCol, P.years.labels, P.years.series.length], [true, ['2019', '2020'], 1], '年份欄當標籤，不當成一個系列');
    eq([P.yearsNoHead.labelCol, P.yearsNoHead.series.length], [true, 1], '沒有標題列的年份也當標籤');
    eq([P.month.labelCol, P.month.series.length], [true, 1], '欄名「月」的數字欄當標籤');
    eq([P.xy.labelCol, P.xy.series.length], [false, 2], '一般 x,y 數值仍是兩個系列（散佈用）');
    assert(P.huge.errors[0] && P.huge.errors[0].includes('超出可畫的範圍'), '極大值給出明確錯誤：' + P.huge.errors[0]);
    eq(P.spaceThousands.series[0].values, [1240, 980], '空白分隔時全形逗號仍是千分位');
    // 年份散佈：X 刻度是整數年，不加千分位
    await t.setData('年 人數\n2019 100\n2020 120\n2021 90\n2022 130'); await t.type('scatter');
    const xl = await t.p.$$eval('#chart text', ts => ts.map(x => x.textContent));
    assert(xl.includes('2019') && xl.includes('2022') && !xl.some(s => /2,0|\.5/.test(s)), '年份當 X：刻度 2019…2022');
    eq(await t.p.locator('#chart circle[data-tip]').count(), 4, '年份散佈畫出 4 點');
    await t.ctx.close();
  }

  // 3. 版面：圓餅大量項目、橫條負值標籤、斜放長標籤都不超出圖面
  {
    const t = await open();
    const many = '項目\t數\n' + Array.from({ length: 30 }, (_, i) => `品項${i}\t${i > 3 ? (i % 7) + 1 : 200}`).join('\n');
    await t.setData(many); await t.type('pie');
    eq(await t.p.locator('#chart [data-leg]').count(), 5, '合併小項目後圖例只列 4 項＋其他');
    eq(await t.inside(), [], '圓餅（合併）全部在圖內');
    await t.p.locator('#chart [data-leg="other"]').click();
    assert(!(await t.p.$$eval('#chart path[data-tip]', ps => ps.some(p => p.dataset.tip.startsWith('其他')))), '點「其他」圖例可隱藏整組');
    await t.p.locator('#chart [data-leg="other"]').click();
    await t.p.click('#style-panel summary'); await t.p.click('#o-merge');
    const legN = await t.p.locator('#chart [data-leg]').count();
    assert(legN < 30 && (await t.p.textContent('#chart')).includes(`＋${30 - legN} 項`), `不合併：圖例 ${legN} 項＋「＋${30 - legN} 項」，不把圓擠掉`);
    const R = await t.p.evaluate(() => Math.max(...[...document.querySelectorAll('#chart path[data-tip]')].map(p => p.getBBox().width)));
    assert(R > 60, `圓餅仍有足夠大小（最大扇形寬 ${R.toFixed(0)}）`);
    eq(await t.inside(), [], '圓餅（30 項不合併）全部在圖內');
    await t.p.click('#o-merge');
    // 甜甜圈＋數值標籤：數字不被截成「1,2…」
    await t.setData('通路\t營收\n門市\t1240\n網路商店\t860\n批發\t320\n其他通路\t15\n快閃\t30'); await t.type('donut'); await t.p.click('#o-labels');
    const dt = await t.p.$$eval('#chart text', ts => ts.map(x => x.textContent));
    assert(dt.includes('1,240') && dt.includes('860') && !dt.some(s => /\d…/.test(s)), '甜甜圈數值標籤完整：' + dt.filter(s => /\d/.test(s)).join(' '));
    eq(await t.inside(), [], '甜甜圈＋數值標籤全部在圖內');
    // 橫條：負值標籤不壓到類別名，最右刻度與標籤不被切掉
    await t.setData('季\t損益\n第一季\t-30000\n第二季\t45000\n第三季\t80000\n第四季\t-12000'); await t.type('hbar');
    eq(await t.inside(), [], '橫條＋負值標籤全部在圖內');
    const ov = await t.p.evaluate(() => {
      const ts = [...document.querySelectorAll('#chart text')], cat = ts.find(x => x.textContent === '第一季').getBBox(), neg = ts.find(x => x.textContent === '−30,000').getBBox();
      return neg.x - (cat.x + cat.width);
    });
    assert(ov > 0, `負值標籤在類別名右邊（間距 ${ov.toFixed(1)}）`);
    // 直式長條：標籤畫在所有長條之後，不會被下一根蓋住；放不下時整組省略並說明
    await t.setData('地區\t數量\n' + Array.from({ length: 20 }, (_, i) => `非常長的地區名稱第${i}號\t${i * 3 - 20}`).join('\n')); await t.type('bar');
    eq(await t.inside(), [], '20 個斜放長標籤全部在圖內（第一個不超出左緣）');
    const labs = await t.p.$$eval('#chart text', ts => ts.filter(x => /^−?\d+$/.test(x.textContent) && x.getAttribute('text-anchor') === 'middle').length);
    assert(labs === 0 && (await t.p.textContent('#note')).includes('數值標籤已省略'), '太窄時數值標籤整組省略並提示');
    await t.setData('季\t損益\nQ1\t-30\nQ2\t45\nQ3\t80\nQ4\t-12');
    const order = await t.p.evaluate(() => { const k = [...document.getElementById('chart').children]; const lastBar = Math.max(...k.map((e, i) => e.matches('path[data-tip]') ? i : -1)); const firstLab = k.findIndex(e => e.tagName === 'text' && e.textContent === '45'); return [lastBar, firstLab]; });
    assert(order[1] > order[0], '數值標籤在長條之上一層');
    eq(await t.inside(), [], '負值長條＋數值標籤全部在圖內');
    // 折線：不從 0 開始時刻度貼近資料
    await t.setData('t\tv\na\t-50\nb\t-45\nc\t-42'); await t.type('line');
    await t.p.uncheck('#o-labels'); await t.p.uncheck('#o-zero');
    const yl = await t.p.$$eval('#chart text[text-anchor="end"]', ts => ts.map(x => x.textContent));
    assert(!yl.includes('0') && yl.includes('−50'), '全負值折線刻度：' + yl.join(' '));
    await t.ctx.close();
  }

  // 4. 只對目前圖表有作用的選項才能勾；圖表 aria-label 隨內容更新
  {
    const t = await open();
    await t.p.click('#style-panel summary');
    await t.type('bar'); assert(await t.p.isDisabled('#o-zero'), '長條圖：「Y 軸從 0 開始」停用（長條一律從 0）');
    await t.type('line'); assert(await t.p.isEnabled('#o-zero') && await t.p.isEnabled('#o-smooth'), '折線圖：從 0／平滑可勾');
    await t.type('scatter'); assert(await t.p.isDisabled('#o-legend') && await t.p.isEnabled('#o-zero'), '散佈圖：圖例停用、從 0 可勾');
    await t.type('pie'); assert(await t.p.isEnabled('#o-merge') && await t.p.isDisabled('#o-smooth'), '圓餅：合併可勾、平滑停用');
    const al = await t.p.getAttribute('#chart', 'aria-label');
    assert(al.includes('圓餅') && al.includes('6 個類別'), '圖表 aria-label：' + al);
    await t.ctx.close();
  }

  // 5. 保存：壞掉的設定回到預設；輸入後立刻離開也保存（pagehide 時寫入）
  {
    const t = await open(MOB, () => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('chart-maker:v1:opts', JSON.stringify({ type: 'xyz', aspect: '7:3', palette: 'nope', title: 5, legendPos: 'left', labels: 'yes', bg: 'dark' })); } });
    const o = await t.p.evaluate(() => window.__cm.opts);
    eq([o.type, o.aspect, o.palette, o.title, o.legendPos, o.labels, o.bg], ['bar', '4:3', 'default', '上半年營收（範例，單位千元）', 'top', false, 'dark'], '不合法的儲存值回到預設，合法的保留');
    assert(await t.p.getAttribute('#type-bar', 'aria-pressed') === 'true', '長條按鈕為選取狀態');
    await t.p.fill('#data-input', '甲\t1\n乙\t2');
    await t.p.reload(); await t.p.waitForFunction(() => window.__cmReady);
    eq(await t.p.inputValue('#data-input'), '甲\t1\n乙\t2', '輸入後 300ms 內重新整理，資料仍在');
    // 範例被改掉後，標題的「範例」也拿掉
    eq(await t.p.inputValue('#o-title'), '', '改掉範例資料後，範例標題清空（不會匯出寫著「範例」的圖）');
    await t.ctx.close();
  }

  // 6. 清除／範例可復原
  {
    const t = await open();
    await t.setData('甲\t1\n乙\t2'); await t.p.click('#style-panel summary'); await t.p.fill('#o-title', '我的圖');
    await t.p.click('#btn-clear');
    eq(await t.p.inputValue('#data-input'), '', '清除');
    assert(await t.p.isVisible('#toast-undo'), '提示上有「復原」');
    const tb = await t.p.$eval('#toast-undo', b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
    assert(tb[0] >= 44 && tb[1] >= 44, `「復原」至少 44px（${tb.join('×')}）`);
    await t.p.click('#toast-undo');
    eq([await t.p.inputValue('#data-input'), await t.p.inputValue('#o-title')], ['甲\t1\n乙\t2', '我的圖'], '復原資料與標題');
    await t.p.click('#btn-sample');
    assert((await t.p.textContent('#detect')).includes('範例'), '換成範例');
    await t.p.click('#toast-undo');
    eq(await t.p.inputValue('#data-input'), '甲\t1\n乙\t2', '「範例資料」也可復原');
    eq(await t.p.evaluate(() => localStorage.getItem('chart-maker:v1:data')), '甲\t1\n乙\t2', '復原後的資料已保存');
    await t.ctx.close();
  }

  // 7. 觸控：點偏一點也能切換圖例、看提示；點圖外收起提示
  {
    const t = await open();
    await t.type('line');
    await t.p.$eval('#pwrap', e => e.scrollIntoView({ block: 'center' })); await t.frames();
    const lg = await t.p.$eval('#chart [data-leg="s1"]', g => { const b = g.getBoundingClientRect(); return [b.left + b.width / 2, b.bottom + 8]; });
    await t.tap(lg);
    assert(await t.p.evaluate(() => window.__cm.hidden.has('s1')), '點在圖例下方 8px 仍切換「網路」');
    await t.tap(lg);
    assert(!(await t.p.evaluate(() => window.__cm.hidden.has('s1'))), '再點一次恢復（一次點擊只切換一次）');
    await t.type('bar');
    const bar = await t.p.$eval('#chart path[data-tip]', b => { const r = b.getBoundingClientRect(); return [r.left - 6, r.top + r.height / 2]; });
    await t.tap(bar);
    assert(await t.p.isVisible('#tip') && (await t.p.textContent('#tip')).includes('一月'), '點在長條左邊 6px 仍顯示提示：' + (await t.p.textContent('#tip')).replace(/\n/g, ' '));
    const hb = await t.p.$eval('header h1', e => { const r = e.getBoundingClientRect(); return [r.left + 10, r.top + 10]; });
    await t.p.evaluate(() => scrollTo(0, 0)); await t.frames();
    await t.tap(hb);
    assert(await t.p.isHidden('#tip'), '點圖表以外的地方收起提示');
    await t.ctx.close();
  }

  // 8. 匯出：沒有 Claude 下載服務時直接下載；連點只下載一次；有分享時顯示「分享圖片」
  {
    const t = await open(MOB, () => {
      window.__dl = [];
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); return orig.call(this); };
    });
    await t.p.click('#btn-sample');
    assert(await t.p.isVisible('#btn-png') && await t.p.isVisible('#btn-svg'), '下載 PNG／SVG 按鈕一直都在');
    await t.p.$eval('#btn-png', b => { b.click(); b.click(); });
    await t.p.waitForFunction(() => window.__dl.length > 0);
    await t.p.waitForTimeout(400);
    eq(await t.p.evaluate(() => window.__dl), ['上半年營收（範例，單位千元）.png'], '連點兩下只下載一次，檔名取自標題');
    assert(await t.p.isVisible('#png-img'), '下方顯示 PNG，可長按儲存');
    await t.p.click('#btn-svg'); await t.p.waitForTimeout(100);
    eq((await t.p.evaluate(() => window.__dl))[1], '上半年營收（範例，單位千元）.svg', 'SVG 直接下載');
    assert(await t.p.isHidden('#btn-share'), '瀏覽器不支援分享檔案時不顯示「分享圖片」');
    await t.p.click('#style-panel summary'); await t.p.fill('#o-title', '  / : 季報 ? ');
    await t.p.click('#btn-svg'); await t.p.waitForTimeout(100);
    eq((await t.p.evaluate(() => window.__dl))[2], '季報.svg', '檔名去掉不合法字元與前後的連字號');
    await t.ctx.close();
  }
  {
    const t = await open(MOB, () => {
      window.__shared = [];
      navigator.canShare = o => !!(o && o.files && o.files.length);
      navigator.share = async o => { window.__shared.push(o.files.map(f => [f.name, f.type, f.size > 1000])); };
    });
    assert(await t.p.isVisible('#btn-share'), '支援分享檔案時顯示「分享圖片」');
    await t.p.click('#btn-share'); await t.p.waitForFunction(() => window.__shared.length);
    eq(await t.p.evaluate(() => window.__shared[0]), [['上半年營收（範例，單位千元）.png', 'image/png', true]], '分享 PNG 檔');
    await t.ctx.close();
  }

  // 9. 橫向手機與矮螢幕：下載按鈕在第一屏看得到；不能左右捲動
  for (const vp of [{ width: 844, height: 390 }, { width: 375, height: 500 }, { width: 390, height: 844 }]) {
    const t = await open({ ...MOB, viewport: vp });
    await t.p.click('#aspect-9x16');
    const m = await t.p.evaluate(() => { document.querySelector('.right').scrollIntoView(); const c = document.getElementById('chart').getBoundingClientRect(), b = document.getElementById('btn-png').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, ch: c.height, btnGap: b.top - c.top, iw: innerWidth, ih: innerHeight }; });
    assert(m.sw <= m.iw, `${vp.width}×${vp.height} 無水平捲動`);
    assert(m.btnGap + 44 <= m.ih, `${vp.width}×${vp.height} 9:16 預覽（高 ${m.ch.toFixed(0)}）與下載鈕同在一屏`);
    await t.ctx.close();
  }

  // 10. 上架評分 r1：首列是年份的標題列、空白分隔的多字標籤、只有一列壞資料、修正建議
  {
    const t = await open();
    const P = await t.p.evaluate(() => {
      const { parseData } = window.__cm, pick = d => ({ h: d.hasHeader, labels: d.labels, names: d.series.map(s => s.name), vals: d.series.map(s => s.values), errs: d.errors.length, hints: d.hints });
      return {
        yt: pick(parseData('月份\t2023\t2024\n一月\t10\t12\n二月\t11\t14')),
        yc: pick(parseData('地區,2022,2023\n北部,5,6\n南部,7,8')),
        y1: pick(parseData('品項\t2024\na\t3\nb\t4')),
        yBlank: pick(parseData('\t2023\t2024\n一月\t1\t2\n二月\t3\t4')),
        yVals: pick(parseData('a\t2019\nb\t2020\nc\t2021')),
        yNo: pick(parseData('月份\t2023\n一月\t10', 'no')), tYes: pick(parseData('a\t1\nb\t2', 'yes')),
        ny: pick(parseData('New York 100\nLos Angeles 80\nTokyo 50')),
        nyHead: pick(parseData('城市 人口\nNew York 100\nLos Angeles 80\nTokyo 50')),
        ny2: pick(parseData('San Jose 1 2\nNew York 3 4\nTokyo 5 6')),
        big: pick(parseData('a\t1e400\nb\t2')), nan: pick(parseData('a\tNaN\nb\tInfinity\nc\t3')),
        spaceBad: pick(parseData('New York 100\nLos Angeles abc')), csvBad: pick(parseData('a,1\nb,x')),
      };
    });
    eq([P.yt.h, P.yt.labels, P.yt.names, P.yt.vals, P.yt.errs], [true, ['一月', '二月'], ['2023', '2024'], [[10, 11], [12, 14]], 0], '月份\\t2023\\t2024：首列是標題，系列是 2023／2024');
    eq([P.yc.h, P.yc.labels, P.yc.names], [true, ['北部', '南部'], ['2022', '2023']], '逗號版「地區,2022,2023」');
    eq([P.y1.h, P.y1.labels, P.y1.names], [true, ['a', 'b'], ['2024']], '單系列「品項\\t2024」');
    eq([P.yBlank.h, P.yBlank.labels, P.yBlank.names], [true, ['一月', '二月'], ['2023', '2024']], '首格空白、其餘是年份也當標題');
    eq([P.yVals.h, P.yVals.labels.length], [false, 3], '數值本身都是年份時，首列仍是資料');
    eq([P.yNo.h, P.yNo.labels], [false, ['月份', '一月']], '手動指定「首列不是標題」');
    eq([P.tYes.h, P.tYes.names, P.tYes.labels], [true, ['1'], ['b']], '手動指定「首列是標題」');
    eq([P.ny.labels, P.ny.vals, P.ny.errs], [['New York', 'Los Angeles', 'Tokyo'], [[100, 80, 50]], 0], '空白分隔、標籤有空白：New York 100…');
    eq([P.nyHead.h, P.nyHead.names, P.nyHead.labels.length], [true, ['人口'], 3], '空白分隔＋標題列');
    eq([P.ny2.labels, P.ny2.vals], [['San Jose', 'New York', 'Tokyo'], [[1, 3, 5], [2, 4, 6]]], '空白分隔、兩個數值欄');
    eq([P.big.h, P.big.labels, P.big.errs], [false, ['a', 'b'], 1], '只有首列 1e400 不合法：保留這列並報錯');
    eq([P.nan.h, P.nan.labels, P.nan.errs], [false, ['a', 'b', 'c'], 2], 'NaN／Infinity：保留並報錯');
    assert(P.spaceBad.hints.some(h => h.includes('Tab 或逗號')), '空白分隔有「不是數字」時建議改用 Tab 或逗號');
    assert(P.csvBad.hints.length && !P.csvBad.hints.some(h => h.includes('Tab 或逗號')), '其他分隔方式給一般修正建議：' + P.csvBad.hints[0]);
    await t.setData('New York 100\nLos Angeles abc');
    assert((await t.p.textContent('#errs')).includes('修正建議：標籤或數值本身有空白'), '錯誤清單附上修正建議');
    // 手動切換：觸控點「首列是標題」
    await t.setData('月份\t2023\t2024\n一月\t10\t12\n二月\t11\t14');
    assert(await t.p.isChecked('#o-header') && (await t.p.textContent('#detect')).includes('2 個類別 × 2 個系列・首列為標題'), '偵測列：2×2・首列為標題');
    const hb = await t.p.$eval('#hdr-row', e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; });
    await t.frames(); await t.tap(hb);
    assert(!(await t.p.isChecked('#o-header')) && (await t.p.textContent('#detect')).includes('3 個類別'), '取消勾選：首列改當資料');
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('chart-maker:v1:opts')).header), 'no', '手動指定有保存');
    await t.tap(hb);
    eq(await t.p.evaluate(() => window.__cm.opts.header), 'auto', '再點一次回到自動');
    await t.ctx.close();
  }

  // 11. 細節：封鎖儲存的提示、選項文字、「清除」不叫出鍵盤
  {
    const t = await open(MOB, () => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); }; });
    await t.p.click('#type-line');
    await t.p.waitForFunction(() => !document.getElementById('toast').hidden);
    assert((await t.p.textContent('#toast')).includes('無法保存（瀏覽器封鎖儲存空間）'), '封鎖儲存時的提示：' + await t.p.textContent('#toast'));
    await t.ctx.close();
  }
  for (const w of [390, 430]) {
    const t = await open({ ...MOB, viewport: { width: w, height: 900 } });
    await t.p.click('#style-panel summary');
    const m = await t.p.evaluate(() => {
      const sel = document.getElementById('o-abbr'), c = document.createElement('canvas').getContext('2d'), cs = getComputedStyle(sel);
      c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const avail = sel.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 20;
      const widest = Math.max(...[...sel.options].map(o => c.measureText(o.text).width));
      const nw = [...document.querySelectorAll('#o-zero ~ span small .nw')].map(s => s.getClientRects().length);
      return { avail, widest, nw };
    });
    assert(m.widest <= m.avail, `${w} 寬：「大數縮寫」選項完整（${m.widest.toFixed(0)} ≤ ${m.avail.toFixed(0)}）`);
    eq(m.nw, [1, 1], `${w} 寬：「長條一律從 0」不拆開`);
    await t.ctx.close();
  }

  // 12. 觸控：pointerup 觸發；另一指放著也點得到；按住 0.6／1 秒各一次；換畫面不打到新控制項；不搶焦點
  {
    const t = await open();
    const cdp = await t.ctx.newCDPSession(t.p);
    const pt = (q, id) => ({ x: q[0], y: q[1], id });
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const center = async sel => t.p.$eval(sel, e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await t.p.evaluate(() => { window.__n = 0; document.getElementById('types').addEventListener('click', () => window.__n++); });
    const n = () => t.p.evaluate(() => window.__n);
    const waitN = k => t.p.waitForFunction(k => window.__n >= k, k);
    // 單點
    let c = await center('#type-area'); await t.frames();
    await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]); await waitN(1); await t.frames();
    eq([await n(), await t.p.evaluate(() => window.__cm.opts.type)], [1, 'area'], '單點：觸發一次');
    // 按住 0.6、1 秒
    for (const [ms, k, ty] of [[600, 2, 'pie'], [1000, 3, 'donut']]) {
      c = await center('#type-' + ty);
      await send('touchStart', [pt(c, 1)]); await t.p.waitForTimeout(ms); await send('touchEnd', [pt(c, 1)]); await waitN(k); await t.frames(); await t.frames();
      eq([await n(), await t.p.evaluate(() => window.__cm.opts.type)], [k, ty], `按住 ${ms / 1000} 秒：觸發一次`);
    }
    // 另一指放在標題上，點「折線」
    c = await center('#type-line');
    const h1v = await t.p.$eval('header h1', e => { const r = e.getBoundingClientRect(); return [r.left + 20, r.top + 10]; });
    await send('touchStart', [pt(h1v, 1)]);
    await send('touchStart', [pt(h1v, 1), pt(c, 2)]);
    await send('touchEnd', [pt(c, 2)]); await waitN(4); await t.frames();
    await send('touchEnd', [pt(h1v, 1)]); await t.frames(); await t.frames();
    eq([await n(), await t.p.evaluate(() => window.__cm.opts.type)], [4, 'line'], '一指放著，另一指點「折線」：觸發一次');
    // 按鈕外 8px 也算
    const edge = await t.p.$eval('#type-bar', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom + 4]; });
    await send('touchStart', [pt(edge, 1)]); await send('touchEnd', [pt(edge, 1)]); await t.frames(); await t.frames();
    // 按鈕下方 4px 的點：瀏覽器把它算給最近的按鈕；不論打到哪個都只算一次
    assert(await n() <= 5, '按鈕邊緣附近的點擊不會重複：' + await n());
    // 換畫面：點下去時把新按鈕放到手指下，原生 click 不能打到它
    await t.p.evaluate(() => {
      const g = Object.assign(document.createElement('button'), { id: 'ghost', textContent: 'G' }); g.style.cssText = 'position:fixed;inset:0;z-index:99;display:none'; window.__g = 0; g.addEventListener('click', () => window.__g++); document.body.append(g);
      document.getElementById('type-scatter').addEventListener('click', () => { g.style.display = 'block'; }, { once: true });
    });
    c = await center('#type-scatter');
    await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]);
    await t.p.waitForFunction(() => window.__cm.opts.type === 'scatter'); await t.p.waitForTimeout(350);
    eq(await t.p.evaluate(() => window.__g), 0, '換畫面後手指下的新按鈕沒有被觸發');
    await t.p.evaluate(() => document.getElementById('ghost').remove());
    // 輸入框聚焦時點按鈕：收起鍵盤，焦點不留在輸入框
    await t.p.focus('#data-input');
    c = await center('#aspect-1x1'); await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]);
    await t.p.waitForFunction(() => window.__cm.opts.aspect === '1:1');
    eq(await t.p.evaluate(() => document.activeElement.tagName), 'BODY', '點按鈕後資料框失去焦點');
    // 「清除」不聚焦資料框（不跳出鍵盤）
    c = await center('#btn-clear'); await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]);
    await t.p.waitForFunction(() => document.getElementById('data-input').value === '');
    await t.frames();
    assert(await t.p.evaluate(() => document.activeElement.id !== 'data-input'), '「清除」不聚焦資料框');
    // 點「復原」只復原一次，也不會聚焦到下面的東西
    c = await t.p.$eval('#toast-undo', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]);
    await t.p.waitForFunction(() => document.getElementById('data-input').value !== '');
    await t.frames();
    assert(await t.p.evaluate(() => !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)), '點「復原」後沒有輸入框被聚焦');
    // 下載連點兩下（間隔 60ms）只下載一次
    await t.p.evaluate(() => { window.__dl = []; const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); return o.call(this); }; });
    c = await center('#btn-png');
    for (let i = 0; i < 2; i++) { await send('touchStart', [pt(c, 1)]); await send('touchEnd', [pt(c, 1)]); await t.p.waitForTimeout(60); }
    await t.p.waitForFunction(() => window.__dl.length > 0); await t.p.waitForTimeout(700);
    eq(await t.p.evaluate(() => window.__dl.length), 1, '下載鈕間隔 60ms 連點兩下只下載一次');
    // 鍵盤操作照常
    await t.p.focus('#type-hbar'); await t.p.keyboard.press('Enter');
    eq(await t.p.evaluate(() => window.__cm.opts.type), 'hbar', '鍵盤 Enter 仍可切換類型');
    await t.p.focus('#o-header'); const before = await t.p.isChecked('#o-header'); await t.p.keyboard.press('Space');
    assert(await t.p.isChecked('#o-header') !== before, '鍵盤空白鍵仍可勾選');
    await t.ctx.close();
  }

  // 13. CI 的 Chromium 141：觸控後瀏覽器補發的 click 是 detail 0、沒有 pointerType（看起來像鍵盤），不能再觸發一次。
  //     本機 Chromium 不會這樣，所以在真實 tap 之後立刻補發一個 detail 0 的 click 重現。
  {
    const t = await open();
    const cdp = await t.ctx.newCDPSession(t.p);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const center = async sel => t.p.$eval(sel, e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const echo = sel => t.p.$eval(sel, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window })));
    const tapEcho = async (q, sel) => { await send('touchStart', [{ x: q[0], y: q[1], id: 1 }]); await send('touchEnd', [{ x: q[0], y: q[1], id: 1 }]); await echo(sel); await t.frames(); };
    await t.p.evaluate(() => { window.__n = 0; document.getElementById('types').addEventListener('click', () => window.__n++); });
    let c = await center('#type-area'); await t.frames();
    await tapEcho(c, '#type-area');
    eq([await t.p.evaluate(() => window.__n), await t.p.evaluate(() => window.__cm.opts.type)], [1, 'area'], 'detail 0 補發 click：按鈕只觸發一次');
    // 換畫面：補發的 click 落在新按鈕上也不觸發
    await t.p.evaluate(() => {
      const g = Object.assign(document.createElement('button'), { id: 'ghost', textContent: 'G' }); g.style.cssText = 'position:fixed;inset:0;z-index:99;display:none'; window.__g = 0; g.addEventListener('click', () => window.__g++); document.body.append(g);
      document.getElementById('type-pie').addEventListener('click', () => { g.style.display = 'block'; }, { once: true });
    });
    c = await center('#type-pie'); await tapEcho(c, '#ghost');
    eq([await t.p.evaluate(() => window.__g), await t.p.evaluate(() => window.__cm.opts.type)], [0, 'pie'], 'detail 0 補發 click：換畫面後的新按鈕不觸發');
    await t.p.evaluate(() => document.getElementById('ghost').remove());
    // 勾選框：補發的 click 落在 label 或 input 上，都只切換一次（原生 change 也只一次）
    await t.setData('月份\t2023\t2024\n一月\t10\t12\n二月\t11\t14');
    await t.p.evaluate(() => { window.__ch = 0; document.getElementById('o-header').addEventListener('change', () => window.__ch++); });
    const hb = await t.p.$eval('#hdr-row', e => { e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + 30, r.top + r.height / 2]; });
    await t.frames();
    await t.p.waitForTimeout(850);
    await tapEcho(hb, '#hdr-row');
    eq([await t.p.isChecked('#o-header'), await t.p.evaluate(() => window.__ch), await t.p.evaluate(() => JSON.parse(localStorage.getItem('chart-maker:v1:opts')).header)], [false, 1, 'no'], 'detail 0 補發 click 在 label 上：只切換一次');
    await t.p.waitForTimeout(850);
    await tapEcho(hb, '#o-header');
    eq([await t.p.isChecked('#o-header'), await t.p.evaluate(() => window.__ch), await t.p.evaluate(() => window.__cm.opts.header)], [true, 2, 'auto'], 'detail 0 補發 click 在 input 上：只切換一次');
    // 樣式面板的勾選框（直接點在方框上）
    await t.p.evaluate(() => { document.getElementById('style-panel').open = true; });
    const lab0 = await t.p.isChecked('#o-legend');
    c = await center('#o-legend'); await t.frames(); await t.p.waitForTimeout(850);
    await tapEcho(c, '#o-legend');
    eq(await t.p.isChecked('#o-legend'), !lab0, 'detail 0 補發 click：點在方框上只切換一次');
    // 鍵盤 Enter／空白鍵照常（就算剛點過）
    await t.p.waitForTimeout(850);
    await t.p.focus('#type-hbar'); await t.p.keyboard.press('Enter');
    eq(await t.p.evaluate(() => window.__cm.opts.type), 'hbar', '鍵盤 Enter 仍可切換類型');
    await t.p.focus('#type-line'); await t.p.keyboard.press('Space');
    eq(await t.p.evaluate(() => window.__cm.opts.type), 'line', '鍵盤空白鍵仍可按按鈕');
    const lg = await t.p.isChecked('#o-legend');
    await t.p.focus('#o-legend'); await t.p.keyboard.press('Space');
    eq(await t.p.isChecked('#o-legend'), !lg, '鍵盤空白鍵仍可勾選');
    // 點過按鈕後馬上用鍵盤按另一個遠處的按鈕也照常
    c = await center('#type-bar'); await send('touchStart', [{ x: c[0], y: c[1], id: 1 }]); await send('touchEnd', [{ x: c[0], y: c[1], id: 1 }]);
    await t.p.waitForFunction(() => window.__cm.opts.type === 'bar');
    await t.p.focus('#btn-sample'); await t.p.evaluate(() => { window.__s = 0; document.getElementById('btn-sample').addEventListener('click', () => window.__s++); });
    await t.p.keyboard.press('Enter');
    eq(await t.p.evaluate(() => window.__s), 1, '點按鈕後立刻按 Enter：遠處的按鈕照常觸發一次');
    await t.ctx.close();
  }

  eq(errors, [], '沒有頁面錯誤或主控台錯誤');
  await browser.close(); srv.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
