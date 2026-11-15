// CSV 表格檢視：上架重審的回歸測試（node tests.js，約 30–60 秒）
// 解析表（RFC 4180）、分隔符與編碼偵測、錯誤檔、欄數不齊、標題列切換、排序（數字／中文／穩定）、
// 搜尋篩選、CSV/TSV 原樣往返與公式防護、下載、複製整列、欄寬拖曳、保存與還原、觸控尺寸、大檔不卡。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-viewer-'));
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
// served over http, not file://: Chromium can drop storage writes across a reload of a file:// page
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
let URL, fails = 0;
const errors = [];
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const J = JSON.stringify;
// Python: '品名,城市,金額\r\n燕麥拿鐵,臺北市,140\r\n…'.encode('big5') / the simplified text .encode('gb2312')
const BIG5 = Buffer.from('ab7ea6572cabb0a5ab2caaf7c3420d0abf50b3c1aeb3c54b2cbb4fa55fa5ab2c3134300d0aa4e2a852a940b0d82cb0aab6afa5ab2c3232300d0ac2a7b2b0b2d52cb773a6cbbfa42c313238300d0a', 'hex');
const GB = Buffer.from('c6b7c3fb2cb3c7cad02cbdf0b6ee0d0ad1e0c2f3c4c3ccfa2cb1b1bea9cad02c3134300d0acad6b3e5bfa7b7c82cc9cfbaa3cad02c3232300d0ac0f1bad0d7e92cb9e3d6ddcad02c313238300d0a', 'hex');

(async () => {
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  // clipboard writes are captured in window.__clip (headless has no real clipboard)
  const CLIP = () => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__clip.push(t); }, readText: async () => '' } }); };
  async function open(opt = {}, ctx0) {
    const ctx = ctx0 || await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (!ctx0) await ctx.addInitScript(CLIP);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__cvReady, null, { timeout: 15000 });
    return { ctx, p };
  }
  const tap = async (p, sel) => {
    const b = await p.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  const waitToast = (p, re, ms = 8000) => p.waitForFunction(s => new RegExp(s).test(document.getElementById('toastHost').textContent), re.source, { timeout: ms }).then(() => true, () => false);
  const file = (name, buf, mimeType = 'text/csv') => ({ name, mimeType, buffer: Buffer.isBuffer(buf) ? buf : Buffer.from(buf) });
  const openFile = async (p, f) => { await p.evaluate(() => { window.__opened = null; }); await p.setInputFiles('#fileIn', f); };
  const fname = p => p.textContent('#fname');

  // 1. 解析表
  {
    const { ctx, p } = await open();
    const cases = [
      ['基本', 'a,b\n1,2', ',', [['a', 'b'], ['1', '2']]],
      ['引號內逗號', '"a,b",c', ',', [['a,b', 'c']]],
      ['雙引號跳脫', '"he said ""hi""",x', ',', [['he said "hi"', 'x']]],
      ['欄內換行 LF', '"l1\nl2",x\n3,4', ',', [['l1\nl2', 'x'], ['3', '4']]],
      ['欄內 CRLF 原樣保留', '"l1\r\nl2",x\r\n3,4\r\n', ',', [['l1\r\nl2', 'x'], ['3', '4']]],
      ['CRLF 列尾', 'a,b\r\n1,2\r\n', ',', [['a', 'b'], ['1', '2']]],
      ['只有 CR', 'a,b\r1,2', ',', [['a', 'b'], ['1', '2']]],
      ['空欄位', ',,\n1,,3', ',', [['', '', ''], ['1', '', '3']]],
      ['結尾多個空行', 'a\n\n\nb\n\n', ',', [['a'], ['b']]],
      ['列尾分隔符', 'a,b,\n', ',', [['a', 'b', '']]],
      ['單欄空字串 "" 是一列', '""\nx', ',', [[''], ['x']]],
      ['欄數不齊原樣', 'a,b,c\n1\n1,2,3,4', ',', [['a', 'b', 'c'], ['1'], ['1', '2', '3', '4']]],
      ['引號後的文字保留', '"ab"c,d', ',', [['abc', 'd']]],
      ['空白保留', ' a , b ', ',', [[' a ', ' b ']]],
      ['引號內分隔符（分號）', 'x;"1;2";y', ';', [['x', '1;2', 'y']]],
      ['Tab', 'a\tb\n"c\td"\te', '\t', [['a', 'b'], ['c\td', 'e']]],
      ['直線', 'a|b|c', '|', [['a', 'b', 'c']]],
      ['中文與 emoji', '名稱,備註\n咖啡,"好喝😀, 再來"', ',', [['名稱', '備註'], ['咖啡', '好喝😀, 再來']]],
      ['沒有結尾換行的空欄', 'a,', ',', [['a', '']]],
      ['只有引號欄', '"",""', ',', [['', '']]],
    ];
    const got = await p.evaluate(cs => cs.map(([, t, d]) => window.__cv.E.parseCSV(t, d).rows), cases);
    cases.forEach(([n, , , want], i) => assert(J(got[i]) === J(want), `解析：${n} → ${J(got[i])}`));
    const open1 = await p.evaluate(() => window.__cv.E.parseCSV('a,b\n1,"x\n2,3', ',').open);
    assert(open1 === 1, '沒關的引號回報在第 2 列（索引 1）');
    const dl = await p.evaluate(() => {
      const d = window.__cv.detectDelim;
      return [d('a,b,c\n1,2,3\n4,5,6'), d('名稱;價格;備註\n咖啡;1,5;"a,b,c"\n茶;2,25;x'), d('a\tb\tc\n1\t2,5\t3'), d('a|b|c\n1|2|3'), d('"x;y",b\n"1;2;3",c')];
    });
    assert(J(dl) === J([',', ';', '\t', '|', ',']), '分隔符偵測：逗號、分號（小數逗號）、Tab、直線、引號內的分號不算 ' + J(dl));
    await ctx.close();
  }

  // 2. 編碼：BOM、UTF-16、Big5／GB 自動判斷與手動覆寫；錯誤檔不覆蓋目前表格
  {
    const { ctx, p } = await open();
    const dec = await p.evaluate(([b5, gb]) => {
      const D = (a, pref = 'auto') => { const r = window.__cv.decodeBytes(new Uint8Array(a).buffer, pref); return r.error ? 'E:' + r.error : r.enc + ':' + r.text.slice(0, 6); };
      const u16 = (s, be, bom) => { const a = bom ? [be ? 0xFE : 0xFF, be ? 0xFF : 0xFE] : []; for (const ch of s) { const c = ch.charCodeAt(0); a.push(...(be ? [c >> 8, c & 255] : [c & 255, c >> 8])); } return a; };
      const enc = s => [...new TextEncoder().encode(s)];
      return [D([0xEF, 0xBB, 0xBF, ...enc('名稱,值\n')]), D(enc('名稱,值\n')), D(u16('名稱,值\n1,2\n', false, true)), D(u16('名稱,值\n1,2\n', true, true)), D(u16('name,value\n1,2\n', false, false)),
        D(b5), D(gb), D(b5, 'gb18030').startsWith('gb18030'), D([]), D([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]), D([0x50, 0x4B, 3, 4, 20, 0, 6, 0]), D([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1])];
    }, [[...BIG5], [...GB]]);
    const want = ['utf-8:名稱,值\n', 'utf-8:名稱,值\n', 'utf-16le:名稱,值\n1', 'utf-16be:名稱,值\n1', 'utf-16le:name,v', 'big5:品名,城市,', 'gb18030:品名,城市,', true, 'E:empty', 'E:bin', 'E:zip', 'E:xls'];
    want.forEach((w, i) => assert(dec[i] === w, `解碼 ${i}：${J(dec[i])}`));
    // via the file picker
    await openFile(p, file('big5.csv', BIG5));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'big5.csv');
    assert((await p.evaluate(() => window.__cv.rows[0][1])) === '臺北市' && (await p.textContent('#encSel option[value=auto]')).includes('Big5'), 'Big5 檔自動解碼，編碼選單寫「自動（Big5）」');
    await p.selectOption('#encSel', 'gb18030');
    await p.waitForFunction(() => window.__cv.rows[0][1] !== '臺北市');
    await p.selectOption('#encSel', 'big5');
    await p.waitForFunction(() => window.__cv.rows[0][1] === '臺北市');
    assert(true, '手動改編碼 GB18030 → Big5 會重新解碼');
    await openFile(p, file('photo.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13, 73, 72, 68, 82]), 'image/png'));
    assert(await waitToast(p, /photo\.png」不是文字檔/), '圖片檔：提示「不是文字檔」');
    assert((await fname(p)) === 'big5.csv', '…目前的表格保留');
    await openFile(p, file('book.xlsx', Buffer.from([0x50, 0x4B, 3, 4, 20, 0, 6, 0, 8, 0]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    assert(await waitToast(p, /另存新檔 → CSV UTF-8/), 'xlsx：教使用者另存 CSV');
    await openFile(p, file('empty.csv', Buffer.alloc(0)));
    assert(await waitToast(p, /empty\.csv」是空的/), '空檔：提示是空的');
    await openFile(p, file('blank.csv', '\r\n\r\n  \n'));
    assert(await waitToast(p, /blank\.csv」是空的/), '只有空白行：提示是空的');
    await openFile(p, file('utf16.csv', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('名稱\t數量\r\n咖啡\t3\r\n', 'utf16le')])));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'utf16.csv');
    assert(J(await p.evaluate(() => [window.__cv.columns.map(c => c.name), window.__cv.rows[0]])) === J([['名稱', '數量'], ['咖啡', '3']]) && (await p.textContent('#delimSel option[value=auto]')).includes('Tab'), 'Excel「Unicode 文字」（UTF-16 LE + Tab）可開，分隔符顯示自動（Tab）');
    assert((await p.evaluate(() => document.getElementById('encSel').value)) === 'auto', '開新檔時編碼回到「自動」');
    await ctx.close();
  }

  // 3. 欄數不齊不丟資料、沒關的引號、標題列切換、匯出往返
  {
    const { ctx, p } = await open();
    await openFile(p, file('ragged.csv', 'a,b\n1,2,3\n4\n5,6\n'));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'ragged.csv');
    const r = await p.evaluate(() => [window.__cv.columns.map(c => c.name), window.__cv.rows, document.getElementById('warnChip').textContent]);
    assert(J(r[0]) === J(['a', 'b', '欄 3']) && J(r[1]) === J([['1', '2', '3'], ['4', '', ''], ['5', '6', '']]), '多出來的欄位變成「欄 3」，不截斷 ' + J(r[1]));
    assert(/2 列欄數與標題不同/.test(r[2]), '提示 2 列欄數不同：' + r[2]);
    await openFile(p, file('openq.csv', 'a,b\n1,2\n3,"oops\n4,5\n'));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'openq.csv');
    assert(/第 2 列的引號沒有成對/.test(await p.textContent('#warnChip')), '沒關的引號：提示第 2 列');
    const tricky = 'id,"na,me",note\r\n1,"He said ""hi""","line1\r\nline2"\r\n2,,"  padded  "\r\n3,=SUM(A1),-5\r\n4,@cmd,+1+2\r\n5,tab\there,|\r\n';
    await openFile(p, file('tricky.csv', tricky));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'tricky.csv');
    const rt = await p.evaluate(src => {
      const P = (t, d) => window.__cv.E.parseCSV(t, d).rows, orig = P(src, ',');
      const csv = window.__cv.toCSV(false), tsv = window.__cv.toTSV(false), g = window.__cv.toCSV(true), gt = window.__cv.toTSV(true);
      return [J(P(csv, ',')) === J(orig), J(P(tsv, '\t')) === J(orig), P(g, ',').map(r => r[1]), P(g, ',')[3][2], P(gt, '\t')[4][2], csv === src];
      function J(x) { return JSON.stringify(x); }
    }, tricky);
    assert(rt[0] && rt[1], 'CSV 與 TSV 匯出（公式防護關）解析回來與原檔逐格相同');
    assert(rt[5], 'CSV 匯出與原檔逐字相同（CRLF、引號規則一致）');
    assert(J(rt[2]) === J(['na,me', 'He said "hi"', '', "'=SUM(A1)", "'@cmd", 'tab\there']) && rt[3] === '-5' && rt[4] === "'+1+2", '公式防護：= @ + 開頭加 \'，-5 這種數字不動 ' + J(rt[2]));
    // header toggle: off → header becomes data and export has no header row
    await tap(p, '#hdrChk');
    await p.waitForFunction(() => window.__cv.columns[0] && window.__cv.columns[0].name === '欄 1');
    const h = await p.evaluate(src => [window.__cv.rows.length, window.__cv.toCSV(false) === src], tricky);
    assert(h[0] === 6 && h[1], '關閉「首列為標題」：標題變第 1 列，匯出不多一列標題、仍逐字相同');
    await tap(p, '#hdrChk');
    await p.waitForFunction(() => window.__cv.columns[0] && window.__cv.columns[0].name === 'id');
    // download falls back to <a download> (no Claude runtime here) and carries a BOM for Excel
    await p.click('#exportBtn');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exp-dl-csv')]);
    const body = fs.readFileSync(await dl.path(), 'utf8');
    assert(dl.suggestedFilename() === 'tricky.csv' && body.charCodeAt(0) === 0xFEFF && body.includes("'=SUM(A1)"), '下載 tricky.csv：UTF-8 BOM、預設公式防護開 ' + dl.suggestedFilename());
    await p.click('#guardChk');
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('#exp-dl-tsv')]);
    const body2 = fs.readFileSync(await dl2.path(), 'utf8');
    assert(dl2.suggestedFilename() === 'tricky.tsv' && body2.includes('\t=SUM(A1)\t'), '關掉公式防護後 TSV 逐字輸出');
    await p.click('#exportBg [data-close]');
    await ctx.close();
  }

  // 4. 排序：數字、中文筆畫、數字感知、穩定、空白永遠在最後；搜尋、篩選；複製整列
  {
    const { ctx, p } = await open();
    const csv = 'k,n,t\nA,10,三\nB,9,一\nC,,item10\nD,100,二\nE,9,item2\nF, ,\nG,-1,一\n';
    await openFile(p, file('sort.csv', csv));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'sort.csv');
    const keys = () => p.evaluate(() => Array.from(window.__cv.view, r => window.__cv.rows[r][0]).join(''));
    await tap(p, '#hd .c[data-col="1"]');
    await p.waitForFunction(() => window.__cv.sort.col === 1 && window.__cv.sort.dir === 1);
    await waitToast(p, /依「n」遞增/);
    assert((await keys()) === 'GBEADCF', '數字欄遞增：-1,9,9,10,100，同值照原順序，空白與非數字在最後 ' + await keys());
    await tap(p, '#hd .c[data-col="1"]');
    await p.waitForFunction(() => window.__cv.sort.dir === -1);
    assert((await keys()) === 'DABEGCF', '數字欄遞減：同值仍照原順序，空白仍在最後 ' + await keys());
    await tap(p, '#hd .c[data-col="1"]');
    await p.waitForFunction(() => window.__cv.sort.col === -1);
    assert((await keys()) === 'ABCDEFG', '第三次點恢復原始順序');
    await p.evaluate(() => window.__cv.cycleSort(2));
    assert((await keys()) === 'BGDAECF', '文字欄：一 < 二 < 三（筆畫，中文在前），item2 < item10（數字感知），空白最後 ' + await keys());
    const types = await p.evaluate(() => window.__cv.columns.map(c => c.type).join());
    assert(types === 'text,number,text', '欄型別：n 是數字（只有空白不算）' + types);
    await p.fill('#q', '一');
    await p.waitForFunction(() => window.__cv.view.length === 2);
    assert((await p.textContent('#dims')).startsWith('2 / 7'), '搜尋「一」：2 / 7 列');
    await p.fill('#q', '');
    await p.waitForFunction(() => window.__cv.view.length === 7);
    await p.evaluate(() => window.__cv.setConds([{ col: 1, op: 'ge', a: '9', b: '' }]));
    assert((await keys()) === 'BDAE', '條件 n ≥ 9 且照 t 排序 ' + await keys());
    await p.evaluate(() => window.__cv.setConds([]));
    // tap a cell → copy the whole row
    await tap(p, '#rows .r:first-child .c[data-col="2"]');
    await p.waitForSelector('#cellBg:not([hidden])');
    await tap(p, '#rowCopy');
    await p.waitForFunction(() => window.__clip.length > 0);
    assert((await p.evaluate(() => window.__clip.pop())) === 'B\t9\t一', '複製整列：Tab 分隔的可見欄位');
    await tap(p, '#cellBg [data-close]');
    await p.waitForSelector('#cellBg', { state: 'hidden' });
    // resize a column by dragging the header edge (mouse); the drag doesn't sort
    const g = await p.locator('#hd .c[data-col="1"] .grip').boundingBox();
    const w0 = await p.evaluate(() => window.__cv.columns[1].w), s0 = await p.evaluate(() => JSON.stringify(window.__cv.sort));
    await p.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await p.mouse.down(); await p.mouse.move(g.x + 80, g.y + g.height / 2, { steps: 5 }); await p.mouse.up();
    await p.waitForTimeout(100);
    const w1 = await p.evaluate(() => window.__cv.columns[1].w), s1 = await p.evaluate(() => JSON.stringify(window.__cv.sort));
    assert(w1 > w0 + 60 && s1 === s0, `拖曳欄標題右緣調寬 ${Math.round(w0)} → ${Math.round(w1)}，且沒有觸發排序`);
    await ctx.close();
  }

  // 5. 保存與還原：最後的檔案、手動分隔符、排序、搜尋、隱藏欄、欄寬；壞資料不壞頁面；pagehide 也會存
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(CLIP);
    let { p } = await open({}, ctx);
    await openFile(p, file('semi.txt', 'a;b;c\n1,5;x;3\n2,5;y;1\n'));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'semi.txt');
    await p.selectOption('#delimSel', ',');
    await p.waitForFunction(() => window.__cv.columns.length === 2);
    await p.selectOption('#delimSel', ';');
    await p.waitForFunction(() => window.__cv.columns.length === 3);
    await p.evaluate(() => window.__cv.cycleSort(2));
    await p.fill('#q', 'y'); await p.waitForFunction(() => window.__cv.view.length === 1);
    await p.evaluate(() => { window.__cv.columns[1].w = 222; });
    await p.click('#colsBtn'); await p.click('#colvis-0'); await p.click('#colsBg [data-close]');
    await p.evaluate(() => window.__cv.saved());
    await p.close(); // pagehide flushes the view state
    ({ p } = await open({}, ctx));
    const st = await p.evaluate(() => ({ n: document.getElementById('fname').textContent, d: document.getElementById('delimSel').value, s: window.__cv.sort, q: document.getElementById('q').value, v: window.__cv.view.length, vis: window.__cv.columns.map(c => c.visible), w: Math.round(window.__cv.columns[1].w) }));
    assert(st.n === 'semi.txt' && st.d === ';' && st.s.col === 2 && st.q === 'y' && st.v === 1 && J(st.vis) === J([false, true, true]) && st.w === 222, '重開後還原檔案、分號、排序、搜尋、隱藏欄、欄寬 ' + J(st));
    // sample replaces the remembered file
    await p.click('#sampleBtn'); await p.waitForFunction(() => document.getElementById('fname').textContent.startsWith('範例'));
    await p.evaluate(() => window.__cv.saved()); await p.close();
    ({ p } = await open({}, ctx));
    assert((await fname(p)).startsWith('範例'), '載入範例後重開是範例，不會跳回舊檔');
    // corrupt storage
    await p.evaluate(() => { localStorage.setItem('csv-viewer:v1:prefs', '{"fs":"huge","header":"x"}'); localStorage.setItem('csv-viewer:v1:view', '{"sig":1,"order":[9,9]'); });
    await p.close(); ({ p } = await open({}, ctx));
    const sane = await p.evaluate(() => [getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(), window.__cv.rows.length]);
    assert(sane[0] === '14px' && sane[1] === 20, '壞掉的設定不影響：字級回 14px，範例 20 列 ' + J(sane));
    // a file too big to keep says so after reopening instead of showing an older file
    await p.evaluate(async () => { const line = '1234567890,abcdefghij,ABCDEFGHIJ,中文欄位內容測試\n'; await window.__cv.loadText(line.repeat(Math.ceil(10.6e6 / line.length)), { name: '很大的貼上' }); await window.__cv.saved(); });
    await p.close(); ({ p } = await open({}, ctx));
    assert(/很大的貼上.*超過 20 MB.*重新選擇/.test(await p.textContent('#rows')), '超過 20MB 沒存：重開時說明要重新開啟');
    await ctx.close();
  }

  // 6. 觸控尺寸、列高、不擋頁面上下捲動、橫向不溢出
  {
    const { ctx, p } = await open();
    const small = await p.$$eval('button, select, input:not([type=file]), [role=columnheader]', els => els.filter(e => e.offsetParent && !e.closest('[hidden]')).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8) || e.tagName, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => h < 44 && !(w >= 18 && h >= 18 && w <= 24)));
    assert(small.length === 0, '390×844：按鈕、選單、輸入框、欄標題都 ≥ 44px 高 ' + J(small));
    const rh = await p.evaluate(() => document.querySelector('#rows .r').getBoundingClientRect().height);
    assert(rh >= 44, '資料列高 ≥ 44px（點一下開啟儲存格）' + rh);
    const ob = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('sc')); return [s.overscrollBehaviorX, s.overscrollBehaviorY]; });
    assert(ob[0] === 'contain' && ob[1] === 'auto', '表格左右滑到底不會觸發返回，上下滑到底會接著捲頁面 ' + J(ob));
    const ow = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert(ow <= 0, '頁面沒有水平溢出');
    // paste anywhere (outside inputs) loads the clipboard text
    await p.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'x,y\n1,2\n3,4\n'); document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); });
    await p.waitForFunction(() => document.getElementById('fname').textContent === '貼上的資料' && window.__cv.rows.length === 2);
    assert(true, '在頁面上直接貼上（Ctrl+V）就載入表格');
    await ctx.close();
  }

  // 7. 大檔：15 萬列（約 10MB）開啟、排序文字欄、搜尋都不卡住主執行緒
  {
    const { ctx, p } = await open();
    const N = 150000, names = ['王小明', '陳美玲', '林志豪', '黃雅婷', '張家豪', '李佩珊'], city = ['台北市', '新北市', '台中市', '高雄市'];
    const parts = ['id,name,city,qty,price,date,note\n'];
    for (let i = 0; i < N; i++) parts.push(`${i},${names[i % 6]}${i % 997},${city[i % 4]},${i % 50},"${(i * 7 % 10000).toLocaleString('en')}",2026/0${1 + i % 9}/${10 + i % 18},"note, ""q"" ${i}"\n`);
    const big = Buffer.from(parts.join('')), bigPath = path.join(TMP, 'big.csv'); fs.writeFileSync(bigPath, big);
    await p.evaluate(() => {
      window.__long = []; window.__gap = 0; let last = performance.now();
      new PerformanceObserver(l => l.getEntries().forEach(e => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ['longtask'] });
      const tick = () => { const t = performance.now(); window.__gap = Math.max(window.__gap, t - last); last = t; window.__raf = requestAnimationFrame(tick); }; tick();
    });
    const t0 = Date.now();
    await openFile(p, bigPath); // a real path: a Buffer payload would be decoded by Playwright on the page's main thread
    await p.waitForFunction(n => window.__cv.rows.length === n && document.getElementById('fname').textContent === 'big.csv', N, { timeout: 60000 });
    const tl = Date.now() - t0;
    await p.evaluate(() => window.__cv.cycleSort(1));
    await p.fill('#q', '台中');
    await p.waitForFunction(n => window.__cv.view.length === n / 4, N, { timeout: 30000 });
    const st = await p.evaluate(() => { cancelAnimationFrame(window.__raf); return { long: window.__long, gap: Math.round(window.__gap), first: window.__cv.rows[window.__cv.view[0]][1], sorted: (() => { const v = window.__cv.view, R = window.__cv.rows, c = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' }); for (let i = 1; i < v.length; i++) if (c.compare(R[v[i - 1]][1], R[v[i]][1]) > 0) return false; return true; })() }; });
    const worst = Math.max(0, ...st.long);
    console.log(`     ${(big.length / 1048576).toFixed(1)}MB 開啟 ${tl}ms；最長主執行緒工作 ${worst}ms；最大畫格間隔 ${st.gap}ms；long tasks ${J(st.long)}`);
    assert(tl < 30000, `15 萬列開啟完成（${tl}ms）`);
    assert(st.sorted, '依 name 排序後搜尋「台中」：結果仍照中文排序');
    assert(worst < 400 && st.gap < 1000, `開啟、排序、搜尋時主執行緒沒有長時間卡住（最長 ${worst}ms，畫格間隔 ${st.gap}ms）`);
    await ctx.close();
  }

  // 8. 上架重審 R1 toFix 回歸
  // CDP touch: touchEnd releases only the points it lists, so a resting finger stays down
  const touchKit = async p => {
    const cdp = await p.context().newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2], radiusX: 1, radiusY: 1, force: 1 })) });
    const ctr = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    let id = 10;
    const tapAt = async (q, hold = 40, rest) => {
      const f = [q[0], q[1], ++id];
      if (rest) { const r = [rest[0], rest[1], ++id]; await T('touchStart', [r]); await p.waitForTimeout(300); await T('touchStart', [r, f]); if (hold > 40) await p.waitForTimeout(hold); await T('touchEnd', [f]); await p.waitForTimeout(60); await T('touchEnd', [r]); }
      else { await T('touchStart', [f]); if (hold > 40) await p.waitForTimeout(hold); await T('touchEnd', [f]); }
    };
    return { T, ctr, tapAt, tap: async (sel, hold, rest) => tapAt(await ctr(sel), hold, rest) };
  };
  {
    const { ctx, p } = await open();
    const k = await touchKit(p);
    const settle = () => p.waitForTimeout(900); // past the 800 ms tap window, so the next step starts clean
    // 8a. JSON keeps unsafe integers and percentages as text
    await p.evaluate(() => window.__cv.loadText('id,name,qty,rate,amt\n12345678901234567,a,1,12%,"1,280"\n12345678901234568,b,2,5%,-3\n12345678901234566,c,3,0.5%,0.10\n', { name: 'ids.csv' }));
    const js = JSON.parse(await p.evaluate(() => window.__cv.toJSON()));
    assert(js[0].id === '12345678901234567' && js[1].id === '12345678901234568' && js[2].id === '12345678901234566', 'JSON：17 位整數 ID 保留原字串，不被改成別的數字 ' + J(js.map(o => o.id)));
    assert(js[0].rate === '12%' && js[2].rate === '0.5%', 'JSON：12% 保留成 "12%"');
    assert(js[0].qty === 1 && js[0].amt === 1280 && js[1].amt === -3 && js[2].amt === 0.1, 'JSON：一般數字（含千分位、小數）仍是數字 ' + J(js[2]));
    await p.evaluate(() => window.__cv.loadText('n\n9007199254740993\n1\n', { name: 'n.csv' }));
    assert(JSON.parse(await p.evaluate(() => window.__cv.toJSON()))[0].n === '9007199254740993', 'JSON：超過安全整數的值不轉成 number');
    // 8b. delimiter tie prefers Tab, and warns with a one-tap switch
    await p.evaluate(() => window.__cv.loadText('a\tb, c\n1\t2, 3\n4\t5, 6\n', { name: 'tie.tsv' }));
    const tie = await p.evaluate(() => ({ r: window.__cv.rows[0], w: document.getElementById('warnChip').textContent, fix: !document.getElementById('delimFix').hidden }));
    assert(J(tie.r) === J(['1', '2, 3']) && /分隔符可能不對/.test(tie.w) && tie.fix, 'Tab 與逗號同分：選 Tab，並提示可改用逗號 ' + J(tie));
    await k.tap('#delimFix'); await p.waitForFunction(() => window.__cv.rows[0] && window.__cv.rows[0][0] === '1\t2');
    assert(true, '按「改用逗號」就用逗號重新解析');
    await settle();
    // 8c. short GB18030 / Big5 files
    await openFile(p, file('gb.csv', Buffer.from('c3fbb3c62cb3c7cad00d0ad5c5c8fd2cb1b1bea90d0a', 'hex')));
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'gb.csv');
    const gb = await p.evaluate(() => [window.__cv.columns.map(c => c.name).join(), window.__cv.rows[0].join(), document.getElementById('encSel').options[0].textContent]);
    assert(gb[0] === '名称,城市' && gb[1] === '张三,北京', '很短的 GB18030 檔（4 個字）認成 GB18030 ' + J(gb));
    await openFile(p, file('b5.csv', Buffer.from('a6572cad c80d0aac4f2c310d0a'.replace(' ', ''), 'hex'))); // '名,值\r\n是,1' in Big5
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'b5.csv');
    const b5 = await p.evaluate(() => [window.__cv.columns.map(c => c.name).join(), document.getElementById('encSel').options[0].textContent]);
    assert(b5[0] === '名,值' && /Big5/.test(b5[1]), '很短的 Big5 檔仍是 Big5 ' + J(b5));
    // two characters only: a close call is shown with a switch button
    await openFile(p, file('two.csv', Buffer.from('bcd72cd2d20d0a312c320d0a', 'hex'))); // '甲,乙\r\n1,2' in GB2312
    await p.waitForFunction(() => document.getElementById('fname').textContent === 'two.csv');
    const two = await p.evaluate(() => ({ w: document.getElementById('warnChip').textContent, fix: document.getElementById('encFix').hidden ? '' : document.getElementById('encFix').textContent, h: window.__cv.columns.map(c => c.name).join() }));
    assert(/編碼可能不對/.test(two.w) && /^改用 (Big5|GB18030)$/.test(two.fix), '分不出 Big5／GB18030 時顯示提示和切換按鈕 ' + J(two));
    const before = two.h; await k.tap('#encFix');
    await p.waitForFunction(b => window.__cv.columns.map(c => c.name).join() !== b, before);
    assert(await p.evaluate(() => document.getElementById('encSel').value !== 'auto'), '按切換按鈕後改用另一種編碼');
    await settle();
    await ctx.close();
  }
  {
    // 8d. touch: taps with another finger resting, holds, detail-0 replay after a tap
    const { ctx, p } = await open();
    const k = await touchKit(p);
    const st = () => p.evaluate(() => ({ clip: window.__clip.length, fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(), sort: JSON.stringify(window.__cv.sort), fo: !document.getElementById('filterBg').hidden,
      sheets: [...document.querySelectorAll('.sheet-bg:not(#filterBg)')].filter(s => !s.hidden).map(s => s.id).join(','), hdr: document.getElementById('hdrChk').checked, stat: document.getElementById('statCol').value }));
    const reset = async () => { await p.evaluate(() => { document.querySelectorAll('.sheet-bg').forEach(s => { s.hidden = true; }); document.getElementById('filterBtn').classList.remove('on'); }); };
    const T = [
      ['複製', '#copyBtn', s => s.clip, (a, b) => b === a + 1],
      ['欄標題排序', '#hd .c[data-col="1"]', s => s.sort, (a, b) => { const o = JSON.parse(a), nx = o.col !== 1 ? { col: 1, dir: 1 } : o.dir === 1 ? { col: 1, dir: -1 } : { col: -1, dir: 0 }; return b === J(nx); }],
      ['首列為標題', 'label.tog', s => s.hdr, (a, b) => a !== b],
      ['儲存格', '#rows .r:nth-child(3) .c[data-col="2"]', s => s.sheets, (a, b) => b === 'cellBg'],
      ['匯出', '#exportBtn', s => s.sheets, (a, b) => b === 'exportBg'],
    ];
    const rest = await k.ctr('h1');
    for (const [name, sel, val, ok] of T) {
      for (const mode of ['single', 'resting', 'hold600', 'hold1000']) {
        const a = await st();
        await k.tap(sel, mode === 'hold600' ? 600 : mode === 'hold1000' ? 1000 : 40, mode === 'resting' ? rest : null);
        await p.waitForTimeout(450); // lets the browser's own click (if any) arrive
        const b = await st();
        // a long press on a header picks the stats column instead of sorting (by design)
        const good = sel.startsWith('#hd') && mode.startsWith('hold') ? b.sort === a.sort && b.stat === '1' : ok(val(a), val(b));
        assert(good, `${name}：${mode === 'resting' ? '另一指按著時點' : mode === 'single' ? '單點' : '按住 ' + mode.slice(4) + 'ms'} 剛好一次 ${J([val(a), val(b)])}`);
        if (b.hdr !== true) { await k.tap('label.tog'); await p.waitForFunction(() => document.getElementById('hdrChk').checked && window.__cv.columns[0].name === '訂單編號'); }
        await reset();
      }
    }
    // detail-0 click right after a tap (Chromium 141): on the control, on its edge, and on whatever is under the finger now
    const d0 = (x, y, sel) => p.evaluate(([x, y, sel]) => { const e = sel ? document.querySelector(sel) : document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window, clientX: x, clientY: y })); }, [x, y, sel]);
    for (const [name, sel, val, ok, prep] of [...T, ['字級＋', '#fsUp', s => s.fs, (a, b) => parseInt(b) === parseInt(a) + 1, async () => { await p.evaluate(() => document.getElementById('colsBtn').click()); await p.waitForTimeout(900); }],
      ['欄位篩選', '#filterBtn', s => s.fo, (a, b) => b === true]]) {
      if (prep) await prep();
      const box = await p.$eval(sel, e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      const a = await st();
      await k.tap(sel); await p.waitForTimeout(30);
      await d0(0, 0, sel); await d0(box[0] + 1, box[1] + box[3] / 2, null); await d0(box[0] + box[2] / 2, box[1] + box[3] / 2, null);
      await p.waitForTimeout(400); const b = await st();
      assert(ok(val(a), val(b)) && (b.sheets === a.sheets || ok(a.sheets, b.sheets) || (prep && b.sheets === 'colsBg')), `${name}：點一下後再來 detail-0 click（控制項、邊緣、手指下的新畫面）只執行一次 ${J([val(a), val(b), b.sheets])}`);
      if (sel === '#filterBtn') { await p.waitForTimeout(900); await d0(0, 0, sel); await p.waitForTimeout(200); assert(!(await st()).fo, '沒有點擊在前的單獨 detail-0 click（鍵盤）執行一次'); }
      if (b.hdr !== true) { await p.waitForTimeout(900); await k.tap('label.tog'); await p.waitForFunction(() => document.getElementById('hdrChk').checked && window.__cv.columns[0].name === '訂單編號'); }
      await reset();
    }
    // Enter on a focused button right after a tap still works (keyboard is never blocked by an older tap)
    await k.tap('#copyBtn'); await p.waitForTimeout(100); const c0 = (await st()).clip;
    await p.focus('#copyBtn'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    assert((await st()).clip === c0 + 1, 'Enter 在點擊後 800ms 內仍然有效');
    // a tap on 開啟 doesn't hand focus to the search box under the sheet etc.; a tap on the search box still focuses it
    await p.waitForTimeout(900); await k.tap('#q'); await p.waitForTimeout(200);
    assert(await p.evaluate(() => document.activeElement.id === 'q'), '直接點搜尋框仍會聚焦');
    await ctx.close();
  }
  {
    // 8e. paste draft survives reload; dismissing keeps it; loading clears it; 範例 over pasted data can be undone
    const { ctx, p } = await open();
    const k = await touchKit(p);
    await k.tap('#pasteBtn'); await p.waitForFunction(() => !document.getElementById('pasteBg').hidden);
    await p.fill('#pasteIn', 'x,y\n9,9\n8,7');
    await p.reload(); await p.waitForFunction(() => window.__cvReady);
    await p.waitForTimeout(900); await k.tap('#pasteBtn'); await p.waitForFunction(() => !document.getElementById('pasteBg').hidden);
    assert(await p.inputValue('#pasteIn') === 'x,y\n9,9\n8,7', '貼上面板的草稿重新整理後還在');
    await p.waitForTimeout(900); await k.tap('#pasteBg [data-close]'); await p.waitForTimeout(300);
    assert(/草稿已保留/.test(await p.textContent('#toastHost')), '取消貼上面板：提示草稿已保留');
    await p.waitForTimeout(900); await k.tapAt([195, 60]); // nothing
    await k.tap('#pasteBtn'); await p.waitForFunction(() => !document.getElementById('pasteBg').hidden);
    assert(await p.inputValue('#pasteIn') === 'x,y\n9,9\n8,7', '取消後再開，草稿還在');
    await p.waitForTimeout(900); await k.tap('#pasteGo');
    await p.waitForFunction(() => document.getElementById('fname').textContent === '貼上的資料' && window.__cv.rows.length === 2);
    assert(await p.evaluate(() => !localStorage.getItem('csv-viewer:v1:pasteDraft')), '載入表格後才清掉草稿');
    await p.waitForTimeout(900); await k.tap('#sampleBtn');
    await p.waitForFunction(() => !document.getElementById('sampleChip').hidden);
    assert(await p.isVisible('#toastAct'), '範例蓋掉貼上的資料時，吐司有「復原」');
    await p.waitForTimeout(900); await k.tap('#toastAct');
    await p.waitForFunction(() => document.getElementById('fname').textContent === '貼上的資料' && window.__cv.rows.length === 2);
    await p.evaluate(() => window.__cv.saved());
    await p.reload(); await p.waitForFunction(() => window.__cvReady);
    assert(await p.textContent('#fname') === '貼上的資料', '按復原後拿回貼上的資料，重新整理後也還在');
    // encoding select explains why it is disabled for pasted text
    assert(await p.evaluate(() => document.getElementById('encSel').disabled && /不需要選編碼/.test(document.getElementById('encLab').title) && document.getElementById('encSel').options[0].textContent === '文字免選'), '編碼停用時說明原因');
    await p.waitForTimeout(900); await k.tap('#encLab'); await p.waitForTimeout(200);
    assert(/不需要選編碼/.test(await p.textContent('#toastHost')), '點停用的編碼選單會說明原因');
    // big export shows progress
    await p.evaluate(() => { const a = ['id,name,v']; for (let i = 0; i < 60000; i++) a.push(i + ',n' + i + ',' + (i % 97)); return window.__cv.loadText(a.join('\n'), { name: 'big.csv' }); });
    await p.waitForTimeout(900); await k.tap('#exportBtn'); await p.waitForFunction(() => !document.getElementById('exportBg').hidden);
    await p.evaluate(() => { window.__prog = []; new MutationObserver(() => { const t = document.getElementById('eBusyTxt').textContent; if (t) window.__prog.push(t); }).observe(document.getElementById('eBusy'), { subtree: true, childList: true, characterData: true }); });
    await p.$eval('#exp-copy-json', e => e.scrollIntoView({ block: 'center' }));
    await p.waitForTimeout(900); await k.tap('#exp-copy-json');
    await p.waitForFunction(() => window.__clip.length && window.__clip[window.__clip.length - 1].length > 1e6, null, { timeout: 20000 });
    const prog = await p.evaluate(() => window.__prog);
    assert(prog.length >= 1 && /正在產生 JSON/.test(prog[0]), '6 萬列匯出時顯示進度 ' + J(prog.slice(0, 3)));
    await ctx.close();
  }
  {
    // 8f. layout: title not covered at 320/360; controls in one row; more rows at 360×640
    for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) {
      const { ctx, p } = await open({ viewport: { width: w, height: h } });
      const r = await p.evaluate(() => { const h1 = document.querySelector('h1'), o = document.getElementById('openBtn').getBoundingClientRect(), b = h1.getBoundingClientRect();
        const tops = [...document.querySelectorAll('.ctl > *')].map(e => Math.round(e.getBoundingClientRect().top));
        return { gap: o.left - b.right, cut: h1.scrollWidth > h1.clientWidth, oneRow: new Set(tops).size === 1, sc: document.getElementById('sc').clientHeight, rh: document.querySelector('#rows .r').getBoundingClientRect().height }; });
      assert(r.gap >= 0 && !r.cut, `${w}px：標題沒有被按鈕蓋住，也沒被截斷 ${J(r)}`);
      assert(r.oneRow, `${w}px：分隔符、編碼、首列為標題在同一行`);
      if (w === 360) assert(Math.floor((r.sc - 44) / r.rh) >= 6, '360×640：表格一次至少看到 6 列 ' + r.sc);
      await ctx.close();
    }
  }

  // 9. 上架重審 R2 toFix 回歸
  {
    // 9a. a finger resting on the table (row, row number, header) does not swallow a second finger's tap; real pinch still zooms
    const { ctx, p } = await open();
    const k = await touchKit(p);
    const st = () => p.evaluate(() => ({ sort: JSON.stringify(window.__cv.sort), sheets: [...document.querySelectorAll('.sheet-bg')].filter(s => !s.hidden).map(s => s.id).join(','), fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() }));
    for (const [rn, rsel] of [['第 7 列儲存格', '#rows .r:nth-child(7) .c[data-col="0"]'], ['第 7 列列號', '#rows .r:nth-child(7) .rn'], ['標題列 #', '#hd .rn']]) {
      const rest = await k.ctr(rsel);
      const a = await st();
      await k.tap('#hd .c[data-col="1"]', 40, rest); await p.waitForTimeout(450);
      const b = await st();
      assert(b.sort !== a.sort && JSON.parse(b.sort).col === 1 && b.sheets === '', `一指放在${rn}，另一指點「下單日期」會排序，放開的那指不算點擊 ${b.sort}`);
      await p.evaluate(() => window.__cv.cycleSort(1)); await p.evaluate(() => window.__cv.sort.col >= 0 && window.__cv.cycleSort(1));
      await k.tap('#rows .r:nth-child(2) .c[data-col="2"]', 40, rest); await p.waitForTimeout(450);
      const c = await st();
      assert(c.sheets === 'cellBg', `一指放在${rn}，另一指點第 2 列儲存格會打開儲存格面板 ${c.sheets}`);
      await p.evaluate(() => { document.getElementById('cellBg').hidden = true; });
    }
    const box = await p.$eval('#sc', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const a = await st();
    await k.T('touchStart', [[box[0] - 30, box[1], 91], [box[0] + 30, box[1], 92]]);
    for (let i = 1; i <= 10; i++) { await k.T('touchMove', [[box[0] - 30 - i * 8, box[1], 91], [box[0] + 30 + i * 8, box[1], 92]]); await p.waitForTimeout(16); }
    await k.T('touchEnd', [[box[0] - 110, box[1], 91], [box[0] + 110, box[1], 92]]); await p.waitForTimeout(400);
    const b = await st();
    assert(parseInt(b.fs) > parseInt(a.fs) && b.sheets === '', `兩指拉開仍會放大字級，且不會打開儲存格 ${a.fs}→${b.fs}`);
    await ctx.close();
  }
  {
    // 9b. 復原 still works after a reload (previous data kept in IndexedDB)
    const { ctx, p } = await open();
    const k = await touchKit(p);
    await p.evaluate(() => window.__cv.loadText('p,q\n1,2\n3,4\n5,6\n', { name: '貼上的資料' }));
    await k.tap('#sampleBtn'); await p.waitForFunction(() => !document.getElementById('sampleChip').hidden);
    await p.evaluate(() => window.__cv.saved());
    await p.reload(); await p.waitForFunction(() => window.__cvReady);
    assert(await p.isVisible('#undoBtn'), '重新整理後仍有「復原上一份」');
    await k.tap('#undoBtn');
    await p.waitForFunction(() => document.getElementById('fname').textContent === '貼上的資料' && window.__cv.rows.length === 3);
    await p.evaluate(() => window.__cv.saved());
    assert(await p.isHidden('#undoBtn'), '重新整理後按復原拿回貼上的資料，按鈕收起');
    // 9c. big exports are built in chunks: a download is a Blob of parts, no single giant join
    await p.evaluate(() => { const a = ['id,name,v']; for (let i = 0; i < 60000; i++) a.push(i + ',n' + i + ',' + (i % 97)); return window.__cv.loadText(a.join('\n'), { name: 'big.csv' }); });
    await p.waitForTimeout(900); await k.tap('#exportBtn'); await p.waitForFunction(() => !document.getElementById('exportBg').hidden);
    await p.$eval('#exp-dl-json', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(900);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), k.tap('#exp-dl-json')]);
    const arr = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    assert(arr.length === 60000 && arr[59999].id === 59999 && arr[123].name === 'n123', '6 萬列 JSON 分段組成檔案，下載內容完整');
    await ctx.close();
  }
  {
    // 9d. narrow menus carry a visible label; stats bar hints that it scrolls; desktop toolbar does not cover the stats bar
    const { ctx, p } = await open({ viewport: { width: 360, height: 640 } });
    const r = await p.evaluate(() => [...document.querySelectorAll('.info .pick .lb')].map(l => { const b = l.getBoundingClientRect(); return [l.textContent, b.width > 10 && b.height > 6]; }));
    assert(/^分隔符/.test(r[0][0]) && r[0][1] && /^編碼/.test(r[1][0]) && r[1][1], '360 寬：分隔符、編碼選單上有看得到的標籤 ' + J(r));
    assert(await p.evaluate(() => document.getElementById('statVals').classList.contains('more')), '360 寬：統計值超出時右邊有漸層提示');
    await ctx.close();
    const d = await open({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
    const g = await d.p.evaluate(() => document.querySelector('.dock').getBoundingClientRect().top - document.getElementById('stats').getBoundingClientRect().bottom);
    assert(g >= 0, '1280×800：工具列沒有蓋住統計列 ' + g);
    await d.ctx.close();
  }

  // 10. 上架重審 R3 toFix 回歸
  {
    const { ctx, p } = await open();
    const cons = []; p.on('console', m => cons.push(m.type() + ': ' + m.text()));
    const k = await touchKit(p);
    await p.evaluate(() => { window.__toasts = []; new MutationObserver(() => { const t = document.getElementById('toastHost').textContent; if (t) window.__toasts.push(t); }).observe(document.getElementById('toastHost'), { childList: true, subtree: true }); });
    const st = () => p.evaluate(() => ({ clip: window.__clip.length, sort: JSON.stringify(window.__cv.sort), sheets: [...document.querySelectorAll('.sheet-bg')].filter(s => !s.hidden).map(s => s.id).join(','), fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim() }));
    const clean = async () => { await p.evaluate(async () => { document.querySelectorAll('.sheet-bg').forEach(s => s.hidden = true); while (window.__cv.sort.col >= 0) await window.__cv.cycleSort(window.__cv.sort.col); window.__toasts = []; }); };
    // 10a. two overlapping quick taps (A down, B down 50 ms later, each ~100 ms): both fire, in either release order
    const pair = async (selA, selB, aFirst) => {
      const A = await k.ctr(selA), B = await k.ctr(selB), a = [A[0], A[1], 201], b = [B[0], B[1], 202];
      await k.T('touchStart', [a]); await p.waitForTimeout(50); await k.T('touchStart', [a, b]); await p.waitForTimeout(60);
      if (aFirst) { await k.T('touchEnd', [a]); await p.waitForTimeout(40); await k.T('touchEnd', [b]); }
      else { await k.T('touchEnd', [b]); await p.waitForTimeout(40); await k.T('touchEnd', [a]); }
      await p.waitForTimeout(450);
    };
    for (const aFirst of [true, false]) {
      const ord = aFirst ? 'A 先放開' : 'B 先放開';
      await clean();
      await pair('#hd .c[data-col="0"]', '#hd .c[data-col="1"]', aFirst);
      const t = await p.evaluate(() => window.__toasts.join('|'));
      assert(/訂單編號/.test(t) && /下單日期/.test(t), `兩指快點兩個欄標題（${ord}）：兩個都排序 ${t}`);
      await clean(); let a = await st();
      await pair('#copyBtn', '#rows .r:nth-child(2) .c[data-col="2"]', aFirst); let b = await st();
      assert(b.clip === a.clip + 1 && b.sheets === 'cellBg', `兩指快點複製＋儲存格（${ord}）：都執行 ${J([a.clip, b.clip, b.sheets])}`);
      await clean(); a = await st();
      await pair('#copyBtn', '#hd .c[data-col="1"]', aFirst); b = await st();
      assert(b.clip === a.clip + 1 && JSON.parse(b.sort).col === 1, `兩指快點複製＋欄標題（${ord}）：都執行 ${J([b.clip - a.clip, b.sort])}`);
    }
    // a finger that rested on a row while another tapped is not a tap when it lifts (held 150 ms before the other finger)
    await clean(); { const R = await k.ctr('#rows .r:nth-child(7) .c[data-col="0"]'), H = await k.ctr('#hd .c[data-col="1"]'), r = [R[0], R[1], 211], h = [H[0], H[1], 212];
      await k.T('touchStart', [r]); await p.waitForTimeout(150); await k.T('touchStart', [r, h]); await p.waitForTimeout(60); await k.T('touchEnd', [h]); await p.waitForTimeout(300); await k.T('touchEnd', [r]); await p.waitForTimeout(450);
      const s2 = await st(); assert(JSON.parse(s2.sort).col === 1 && s2.sheets === '', '一指放在第 7 列 150ms 後另一指點欄標題：排序，放開的那指不打開儲存格 ' + J(s2)); }
    // 10b. pinch: spread 50→150 reaches 20, squeeze back reaches 12, no console messages at all
    await clean(); cons.length = 0;
    const sc = await p.$eval('#sc', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const pinch = async (from, to) => {
      const seq = []; await k.T('touchStart', [[sc[0] - from / 2, sc[1], 301], [sc[0] + from / 2, sc[1], 302]]);
      for (let i = 1; i <= 20; i++) { const d = from + (to - from) * i / 20; await k.T('touchMove', [[sc[0] - d / 2, sc[1], 301], [sc[0] + d / 2, sc[1], 302]]); await p.waitForTimeout(16); seq.push((await st()).fs); }
      await k.T('touchEnd', [[sc[0] - to / 2, sc[1], 301]]); await p.waitForTimeout(30); await k.T('touchEnd', [[sc[0] + to / 2, sc[1], 302]]); await p.waitForTimeout(300);
      return seq;
    };
    const up = await pinch(50, 150), down = await pinch(150, 50);
    assert(up[up.length - 1] === '20px' && new Set(up).size >= 4, '兩指 50→150px：字級連續放大到 20 ' + up.join(','));
    assert(down[down.length - 1] === '12px', '兩指 150→50px：字級縮回 12 ' + down.slice(-3).join(','));
    assert(cons.length === 0 && (await st()).sheets === '', '縮放時主控台沒有任何訊息，也沒誤開面板 ' + cons.slice(0, 2).join(' | '));
    assert(await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('csv-viewer:v1:prefs')); return v.fs === 12; }), '縮放後的字級有存起來');
    // 10c. ↶ swaps: back to the previous data, and the current one can be swapped back
    await p.evaluate(async () => { await window.__cv.loadText('p\n1\n', { name: '資料A.csv' }); await window.__cv.loadText('q\n2\n3\n', { name: '資料B.csv' }); });
    assert(/資料A/.test(await p.textContent('#undoBtn')), '換回按鈕上顯示上一份的檔名 ' + await p.textContent('#undoBtn'));
    await p.waitForTimeout(900); await k.tap('#undoBtn');
    await p.waitForFunction(() => document.getElementById('fname').textContent === '資料A.csv');
    assert(/資料B/.test(await p.textContent('#undoBtn')), '換回 A 之後，按鈕變成可以換回 B');
    await p.evaluate(() => window.__cv.saved()); await p.reload(); await p.waitForFunction(() => window.__cvReady);
    await p.waitForTimeout(300); await k.tap('#undoBtn');
    await p.waitForFunction(() => document.getElementById('fname').textContent === '資料B.csv' && window.__cv.rows.length === 2);
    assert(true, '重新整理後再按一次換回 B');
    await ctx.close();
    // 10d. a long file name and the swap button stay on one line at 320–430
    for (const w of [320, 390, 430]) {
      const o = await open({ viewport: { width: w, height: 700 } });
      await o.p.evaluate(async () => { await window.__cv.loadText('a\n1\n', { name: '一個名字很長很長的銷售報表2026年第三季.csv' }); await window.__cv.loadText('b\n2\n', { name: '另一份也很長的檔案名稱.csv' }); });
      const h = await o.p.evaluate(() => [document.querySelector('.irow').getBoundingClientRect().height, document.documentElement.scrollWidth - innerWidth]);
      assert(h[0] <= 46 && h[1] <= 0, `${w}px：長檔名加換回按鈕仍在同一行 ${J(h)}`);
      await o.ctx.close();
    }
  }

  // 11. 上架重審 R4：窄螢幕選單值完整、↶ 檔名、title 正確、標題列不換行、重疊點按門檻
  {
    const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('名稱\t值\r\n甲\t1\r\n', 'utf16le')]);
    const files = [['a.tsv', u16], ['gb.csv', Buffer.from('c3fbb3c62cb3c7cad00d0ad5c5c8fd2cb1b1bea90d0a', 'hex')], ['b5.txt', Buffer.from('a6572cadc80d0aac4f2c310d0a', 'hex')], ['s.csv', Buffer.from('a;b\n1;2\n')]];
    for (const w of [320, 360, 390]) {
      const { ctx, p } = await open({ viewport: { width: w, height: 700 } });
      const bad = [];
      for (const [n, b] of files) {
        await openFile(p, file(n, b)); await p.waitForFunction(n => document.getElementById('fname').textContent === n, n);
        bad.push(...await p.evaluate(() => {
          const out = [], cv = document.createElement('canvas').getContext('2d');
          for (const id of ['delimSel', 'encSel']) {
            const s = document.getElementById(id), cs = getComputedStyle(s), keep = s.selectedIndex;
            cv.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const avail = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            for (let i = 0; i < s.options.length; i++) { s.selectedIndex = i; const t = s.options[i].textContent, tw = cv.measureText(t).width; if (tw > avail + 0.5) out.push(`${id}:${t} ${Math.round(tw)}>${Math.round(avail)}`); }
            s.selectedIndex = keep;
          }
          const tog = document.querySelector('.info .tog').getBoundingClientRect().height;
          if (tog > 46) out.push('標題列換行 ' + tog);
          return out;
        }));
      }
      const lbs = await p.evaluate(() => [...document.querySelectorAll('.info .lb')].map(l => l.textContent).join(','));
      assert(!bad.length, `${w}px：分隔符／編碼每個選項的值都完整顯示，標題列不換行 ${J(bad.slice(0, 4))}`);
      assert(w > 479 || lbs === '分隔符・自動,編碼・自動', `${w}px：自動偵測時標籤寫「・自動」 ${lbs}`);
      // the swap button: a readable name, and its title names the right current file
      await p.evaluate(async () => { await window.__cv.loadText('a\n1\n', { name: 'report_2026.csv' }); await window.__cv.loadText('b\n2\n', { name: '2026年10月銷售明細.csv' }); });
      const ub = await p.evaluate(() => { const b = document.getElementById('undoBtn'); return { t: b.textContent, cut: b.scrollWidth > b.clientWidth + 1, title: b.title, row: document.querySelector('.irow').getBoundingClientRect().height }; });
      assert(ub.t === '↶ report_2…' && !ub.cut && /換回「report_2026\.csv」.*目前的「2026年10月銷售明細\.csv」/.test(ub.title) && ub.row <= 46, `${w}px：↶ 按鈕顯示可辨認的檔名，title 寫對目前的檔案 ${J(ub)}`);
      await ctx.close();
    }
  }
  {
    // a finger that landed 60 ms before another and is held 300 ms is still a tap (quick overlap), one resting 150 ms is not
    const { ctx, p } = await open();
    const k = await touchKit(p);
    const C = await k.ctr('#rows .r:nth-child(5) .c[data-col="2"]'), H = await k.ctr('#hd .c[data-col="1"]');
    await k.T('touchStart', [[C[0], C[1], 401]]); await p.waitForTimeout(60); await k.T('touchStart', [[C[0], C[1], 401], [H[0], H[1], 402]]); await p.waitForTimeout(60);
    await k.T('touchEnd', [[H[0], H[1], 402]]); await p.waitForTimeout(150); await k.T('touchEnd', [[C[0], C[1], 401]]); await p.waitForTimeout(450);
    const r = await p.evaluate(() => [JSON.parse(JSON.stringify(window.__cv.sort)).col, document.getElementById('cellBg').hidden]);
    assert(r[0] === 1 && r[1] === false, '先按 60ms 的手指按了約 300ms 才放開：仍算點擊（排序和儲存格都執行） ' + J(r));
    await ctx.close();
  }

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  assert(errors.length === 0, '沒有頁面或主控台錯誤 ' + errors.slice(0, 3).join(' | '));
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
