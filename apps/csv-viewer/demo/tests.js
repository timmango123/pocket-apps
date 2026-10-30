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

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  assert(errors.length === 0, '沒有頁面或主控台錯誤 ' + errors.slice(0, 3).join(' | '));
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
