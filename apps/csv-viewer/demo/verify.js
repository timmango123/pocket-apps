// Playwright verification for csv-viewer. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);
// "台北,咖啡" encoded as Big5 (generated with Python: '名稱,城市\r\n台北咖啡,台北市\r\n'.encode('big5'))
const BIG5 = [166, 87, 186, 217, 44, 171, 176, 165, 171, 13, 10, 165, 120, 165, 95, 169, 64, 176, 216, 44, 165, 120, 165, 95, 165, 171, 13, 10];

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(s); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__cvReady); await page.waitForTimeout(150);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal page scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], 'all visible buttons >= 44px');
      // sticky first column + header after scrolling
      const st = await page.evaluate(async () => { const sc = document.getElementById('sc'); sc.scrollLeft = 400; sc.scrollTop = 200; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const scr = sc.getBoundingClientRect(), fx = document.querySelector('#rows .r .fx').getBoundingClientRect(), hd = document.getElementById('hd').getBoundingClientRect();
        return [Math.round(fx.left - scr.left), Math.round(hd.top - scr.top)]; });
      eq(st, [0, 0], 'first column and header stay fixed while scrolling');
      await page.screenshot({ path: `${OUT}/flow-scrolled.png` });
      await page.evaluate(() => { const sc = document.getElementById('sc'); sc.scrollLeft = 0; sc.scrollTop = 0; });
      await page.click('#filterBtn'); await page.click('#addCond'); await page.selectOption('#cond-col-0', { label: '金額' }); await page.selectOption('#cond-op-0', 'ge'); await page.fill('#cond-a-0', '500'); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/flow-filter.png` });
    }
    if (s.name === 'desktop-1280x800') { await page.click('#filterBtn'); await page.click('#addCond'); await page.waitForTimeout(100); await page.screenshot({ path: `${OUT}/desktop-filter.png` }); const sw2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); assert(sw2, 'desktop docked filter no page overflow'); }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__cvReady);

  // parser
  const p = await page.evaluate(() => window.__cv.parseCSV('a,b\n"x, y","he said ""hi"""\n"multi\nline",3\r\nlast,\n\n', ','));
  eq(p, [['a', 'b'], ['x, y', 'he said "hi"'], ['multi\nline', '3'], ['last', '']], 'RFC 4180: quotes, escaped quotes, embedded newline, CRLF, trailing empty field');
  eq(await page.evaluate(() => window.__cv.parseCSV('a;b\rc;d', ';')), [['a', 'b'], ['c', 'd']], 'CR-only line endings');
  eq(await page.evaluate(() => [window.__cv.detectDelim('a;b;c\n1;2;3\n"x;y";2;3'), window.__cv.detectDelim('a\tb\n1\t2'), window.__cv.detectDelim('n,v\n"1,000",2\n3,4'), window.__cv.detectDelim('a|b|c\n1|2|3')]), [';', '\t', ',', '|'], 'delimiter detection ; tab , |');
  // sample model
  eq(await page.evaluate(() => [window.__cv.rows.length, window.__cv.columns.length, window.__cv.columns.map(c => c.type).join(',')]), [20, 10, 'text,date,text,text,text,number,number,number,text,text'], 'sample: 20 rows × 10 cols, types inferred');
  eq(await page.evaluate(() => window.__cv.rows[2][9]), '重複下單\n已退款', 'sample embedded newline cell');
  // sort amount desc
  await page.evaluate(() => { window.__cv.cycleSort(7); window.__cv.cycleSort(7); });
  eq(await page.evaluate(() => [window.__cv.rows[window.__cv.view[0]][0], window.__cv.rows[window.__cv.view[1]][0]]), ['A-24007', 'A-24004'], 'sort 金額 descending (12,800 then 3,840)');
  await page.evaluate(() => window.__cv.cycleSort(7));
  eq(await page.evaluate(() => window.__cv.rows[window.__cv.view[0]][0]), 'A-24001', 'third click restores original order');
  // stats on 金額: 280+220+570+3840+140+640+12800+190+240+320+420+1360+1140+160+440+1280+700+380+480+960 = 26560
  await page.selectOption('#statCol', '7');
  const stats = await page.textContent('#statVals');
  assert(stats.includes('總和 26,560') && stats.includes('平均 1,328') && stats.includes('最小 140') && stats.includes('最大 12,800'), 'stats for 金額: ' + stats);
  // global search + column filter
  await page.fill('#q', '台北市'); await page.waitForTimeout(300);
  eq(await page.evaluate(() => window.__cv.view.length), 5, 'global search 台北市 -> 5 rows');
  await page.fill('#q', '');
  await page.evaluate(() => window.__cv.setConds([{ col: 8, op: 'eq', a: '已出貨', b: '' }, { col: 5, op: 'between', a: '2', b: '4', }]));
  const fv = await page.evaluate(() => Array.from(window.__cv.view, r => window.__cv.rows[r][0]));
  eq(fv, ['A-24001', 'A-24004', 'A-24006', 'A-24008', 'A-24010', 'A-24011', 'A-24012', 'A-24015', 'A-24018', 'A-24019'], 'filter 狀態=已出貨 AND 數量 介於 2–4');
  const js = JSON.parse(await page.evaluate(() => window.__cv.toJSON()));
  eq([js.length, js[1]['金額'], typeof js[1]['數量'], js[1]['客戶']], [10, 3840, 'number', '黃雅婷'], 'JSON export only filtered rows, numbers typed');
  const md = await page.evaluate(() => { window.__cv.setConds([]); window.__cv.loadText('名稱,價格\n"a|b",1\n"c\nd",2', { name: 't.csv' }); return new Promise(r => setTimeout(() => r(window.__cv.toMarkdown()), 100)); });
  eq(md, '| 名稱 | 價格 |\n| --- | ---: |\n| a\\|b | 1 |\n| c<br>d | 2 |\n', 'Markdown export: escaped pipe, right-aligned number column');
  const csv = await page.evaluate(() => window.__cv.toCSV()); eq(csv, '名稱,價格\r\na|b,1\r\n"c\nd",2\r\n', 'CSV export re-quotes newline cell');
  // inconsistent rows
  await page.evaluate(() => window.__cv.loadText('a,b,c\n1,2\n1,2,3,4\n5,6,7', { name: 'bad.csv' })); await page.waitForTimeout(100);
  assert((await page.textContent('#warnChip')).includes('2 列欄數不一致'), 'inconsistent column count warning');
  // Big5
  await page.evaluate(b => window.__cv.loadBytes(new Uint8Array(b).buffer, 'big5.csv'), BIG5); await page.waitForTimeout(150);
  eq(await page.evaluate(() => [window.__cv.columns.map(c => c.name), window.__cv.rows[0]]), [['名稱', '城市'], ['台北咖啡', '台北市']], 'Big5 CSV decoded automatically');
  assert((await page.textContent('#encSel')).includes('Big5'), 'encoding shows Big5');
  // empty / header-only
  await page.evaluate(() => window.__cv.loadText('只有,標題', { name: 'h.csv' })); await page.waitForTimeout(100);
  assert((await page.textContent('#rows')).includes('只有標題列'), 'header-only file message');
  // 100k × 20 performance
  const perf = await page.evaluate(async () => {
    const cols = Array.from({ length: 20 }, (_, i) => 'col' + i), lines = [cols.join(',')];
    for (let r = 0; r < 100000; r++) { const a = []; for (let c = 0; c < 20; c++) a.push(c === 0 ? 'ID' + r : c % 3 === 0 ? String((r * 7919 + c) % 100000) : c % 3 === 1 ? '"品項 ' + (r % 977) + ', 規格"' : '2026-' + String(1 + r % 12).padStart(2, '0') + '-' + String(1 + r % 28).padStart(2, '0')); lines.push(a.join(',')); }
    const t = lines.join('\n'); const t0 = performance.now(); await window.__cv.loadText(t, { name: 'big.csv' }); const load = performance.now() - t0;
    const t1 = performance.now(); window.__cv.cycleSort(3); const sortNum = performance.now() - t1;
    const t2 = performance.now(); window.__cv.cycleSort(1); const sortText = performance.now() - t2;
    const sc = document.getElementById('sc'); let maxFrame = 0;
    for (let i = 0; i < 30; i++) { const f0 = performance.now(); sc.scrollTop += 900; sc.scrollLeft = (i % 5) * 300; sc.dispatchEvent(new Event('scroll')); await new Promise(r => requestAnimationFrame(r)); maxFrame = Math.max(maxFrame, performance.now() - f0); }
    return { len: t.length, rows: window.__cv.rows.length, load: Math.round(load), sortNum: Math.round(sortNum), sortText: Math.round(sortText), dom: document.querySelectorAll('#rows .c').length, maxFrame: Math.round(maxFrame) };
  });
  console.log('perf', perf);
  eq(perf.rows, 100000, '100k rows loaded');
  assert(perf.sortNum < 1000 && perf.sortText < 1000, `sort 100k under 1s (number ${perf.sortNum}ms, text ${perf.sortText}ms)`);
  assert(perf.dom < 800, `virtualized cells in DOM: ${perf.dom}`);
  assert(perf.maxFrame < 100, `scroll frame time max ${perf.maxFrame}ms`);
  await page.screenshot({ path: `${OUT}/flow-100k.png` });
  // persistence of last file (IndexedDB) + prefs
  await page.evaluate(() => window.__cv.loadText('x,y\n1,2', { name: 'keep.csv' })); await page.waitForTimeout(300);
  await page.reload(); await page.waitForFunction(() => window.__cvReady);
  eq(await page.textContent('#fname'), 'keep.csv', 'last file restored from IndexedDB');
  await ctx.close();
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASS');
  process.exit(errors.length ? 1 : 0);
})();
