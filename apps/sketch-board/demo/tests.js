// 白板畫布：上架評分 r1 toFix 的回歸測試（node tests.js，約 40–70 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
// 會重新整理、開第二個分頁，所以用本機 http 伺服器（file:// 是不透明來源，儲存可能消失）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  // a UTF-8 locale so Chromium keeps the Chinese download file names (with LANG unset it falls back to "download")
  const browser = await chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } });
  const newCtx = () => browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
  const ready = p => p.waitForFunction(() => window.__sbReady);
  async function page(ctx) {
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await ready(p);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', [q]); };
    const tap = async (sel, hold) => tapAt(await center(sel), hold);
    const S = () => p.evaluate(() => { const s = __sb; return { tool: s.prefs.tool, n: s.board.items.length, undo: s.undoN, sel: [...s.sel].sort().join(), props: !document.getElementById('props').hidden, menu: !document.getElementById('menu').hidden, ctx: !document.getElementById('ctx').hidden }; });
    // after a tap, wait out the 800 ms ghost-click window so the next check starts clean
    const settle = () => W(850);
    const reset = async (tool = 'select') => { await settle(); await p.evaluate(t => { __sb.setTool(t); for (const id of ['menu', 'ctx', 'props', 'pv']) document.getElementById(id).hidden = true; }, tool); };
    const addStrokes = n => p.evaluate(n => { for (let i = 0; i < n; i++) __sb.addItems([{ id: 'z' + Math.random(), type: 'path', points: [[0, i * 10, .5], [50, i * 10, .5]], color: '#1e1e1e', width: 4, opacity: 100 }], false); }, n);
    return { p, T, tap, tapAt, center, S, reset, settle, addStrokes };
  }
  const waitFor = (p, fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const reload = async (p, ms = 10000) => { await p.reload(); await p.waitForFunction(() => window.__sbReady, null, { timeout: ms }); };

  // ---------- 1. [否決] 按鈕在放開時依 pointerId 動作 ----------
  {
    const ctx = await newCtx(); const o = await page(ctx); const { p, T, tap, center, S, reset, addStrokes } = o;
    const rest = [195, 420, 2];
    for (const [sel, check] of [['#t-hl', s => s.tool === 'hl'], ['#undoBtn', (s, s0) => s.undo === s0.undo - 1], ['#menuBtn', s => s.menu]]) {
      await reset('pen'); await addStrokes(2); const s0 = await S();
      await T('touchStart', [rest]); await W(160); const c = await center(sel);
      await T('touchStart', [rest, [...c, 1]]); await W(50); await T('touchEnd', [[...c, 1]]); await W(200);
      const s1 = await S(); await T('touchEnd', [rest]); await W(200); const s2 = await S();
      assert(check(s1, s0), `一指放在畫布上，另一指點 ${sel} 有動作`);
      assert(s2.n === s1.n, `放著的那一指放開後沒有多畫一點（${sel}）`);
      await p.evaluate(() => document.getElementById('menu').hidden = true);
    }
    // a canvas finger down only 40 ms before another finger taps a button leaves no dot either
    await reset('pen'); { const s0 = await S(), c = await center('#t-hl');
      await T('touchStart', [rest]); await W(40); await T('touchStart', [rest, [...c, 1]]); await W(50); await T('touchEnd', [[...c, 1]]); await W(100); await T('touchEnd', [rest]); await W(200);
      const s1 = await S(); assert(s1.tool === 'hl' && s1.n === s0.n, '畫布手指放下 40 ms 就點按鈕：按鈕動作，畫布不留點'); }
    // a real stroke from the first finger is kept even when another finger taps a button meanwhile
    await reset('pen'); { const s0 = await S();
      await T('touchStart', [[100, 400, 2]]); for (let i = 1; i <= 8; i++) { await T('touchMove', [[100 + i * 12, 400 + i * 5, 2]]); await W(10); }
      const c = await center('#t-hl'); await T('touchStart', [[196, 440, 2], [...c, 1]]); await W(50); await T('touchEnd', [[...c, 1]]); await W(50);
      await T('touchMove', [[220, 450, 2]]); await T('touchEnd', [[220, 450, 2]]); await W(200);
      const s1 = await S(); assert(s1.n === s0.n + 1 && s1.tool === 'hl', '正在畫的線（有移動）在另一指點工具時仍保留，工具也換了'); }
    // resting finger on the toolbar rail itself
    await reset('pen'); { const r = await p.$eval('.tools', e => { const b = e.getBoundingClientRect(); return [b.left + 3, b.top + 3, 2]; }), c = await center('#t-eraser');
      await T('touchStart', [r]); await W(160); await T('touchStart', [r, [...c, 1]]); await W(50); await T('touchEnd', [[...c, 1]]); await W(200);
      assert((await S()).tool === 'eraser', '一指放在工具列空白處，另一指點橡皮擦有動作'); await T('touchEnd', [r]); }
    // overlapping taps: undo, then 50 ms later highlighter; both lift orders
    for (const order of ['先按先放', '後按先放']) {
      await reset('pen'); await addStrokes(3); const s0 = await S(); const c1 = await center('#undoBtn'), c2 = await center('#t-hl');
      await T('touchStart', [[...c1, 1]]); await W(50); await T('touchStart', [[...c1, 1], [...c2, 2]]); await W(40);
      if (order === '先按先放') { await T('touchEnd', [[...c1, 1]]); await W(30); await T('touchEnd', [[...c2, 2]]); } else { await T('touchEnd', [[...c2, 2]]); await W(30); await T('touchEnd', [[...c1, 1]]); }
      await W(200); const s1 = await S();
      assert(s0.undo - s1.undo === 1 && s1.tool === 'hl', `兩指重疊點復原與螢光筆（${order}）兩個都動作一次`);
    }
    // detail-0 click replayed after a real tap: on the button, its edge point and elementFromPoint — undo runs once
    for (const where of ['按鈕', '邊緣', 'elementFromPoint']) {
      await reset('pen'); await addStrokes(4); const s0 = await S(); await tap('#undoBtn'); await W(120);
      await p.evaluate(w => { const b = document.getElementById('undoBtn'), r = b.getBoundingClientRect();
        const t = w === '按鈕' ? b : w === '邊緣' ? (document.elementFromPoint(r.right - 1, r.bottom - 1) || b) : document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: r.right - 1, clientY: r.bottom - 1 })); }, where);
      await W(200); assert(s0.undo - (await S()).undo === 1, `點復原後再送 detail 0 click（${where}）只復原一次`);
    }
    await reset('select'); await tap('#t-pen'); await W(120); await p.evaluate(() => document.getElementById('t-pen').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))); await W(200);
    { const s = await S(); assert(s.tool === 'pen' && !s.props, '從選取點手繪筆（含補發的 detail 0 click）只換工具，不打開屬性面板'); }
    // a lone detail-0 click (keyboard / screen reader) still acts once; Enter on a focused button acts once
    await reset('pen'); await addStrokes(2); { const s0 = await S(); await p.evaluate(() => document.getElementById('undoBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))); await W(100);
      assert(s0.undo - (await S()).undo === 1, '沒有點按在前的 detail 0 click 動作一次'); }
    await reset('pen'); await addStrokes(2); { const s0 = await S(); await p.focus('#undoBtn'); await p.keyboard.press('Enter'); await W(100);
      assert(s0.undo - (await S()).undo === 1, '鍵盤 Enter 復原一次'); }
    // ---------- 2. [否決] 長按後沒有 click 也不會吞掉下一次點按 ----------
    await reset('select'); { const c = await center('#t-hl');
      await T('touchStart', [rest]); await W(120); await T('touchStart', [rest, [...c, 1]]); await W(700); await T('touchEnd', [[...c, 1]]); await W(200); await T('touchEnd', [rest]); await W(200);
      const s1 = await S(); assert(s1.tool === 'hl' && s1.props, '另一指放著時長按螢光筆 0.7 秒：換工具並打開面板');
      await reset('select'); await tap('#t-hl'); await W(150); assert((await S()).tool === 'hl', '長按之後下一次點同一個工具有動作'); }
    for (const h of [600, 1000]) { await reset('select'); await tap('#t-pen', h); await W(150); const a = await S(); await o.settle(); await tap('#t-pen'); await W(150); const b = await S();
      assert(a.tool === 'pen' && a.props && !b.props, `按住 ${h} ms 打開面板一次，之後點一下關閉`); }
    // ---------- 10b. 點畫布關閉右鍵選單，不改選取 ----------
    await reset('select'); await p.evaluate(() => __sb.fitAll(true)); await W(100);
    { const pt = await p.evaluate(() => { const n = __sb.board.items.find(i => i.type === 'note'); return __sb.W2S(n.x + n.w / 2, n.y + n.h / 2); });
      await T('touchStart', [pt]); await W(750); await T('touchEnd', [pt]); await W(200); const s1 = await S();
      assert(s1.ctx && s1.sel.length > 0, '長按物件打開選單');
      await o.settle(); await o.tapAt([30, 780]); await W(200); const s2 = await S();
      assert(!s2.ctx && s2.sel === s1.sel, '點畫布空白處只關閉選單，選取不變'); }
    // ---------- 11. 分段鈕 ≥ 44 px ----------
    await reset('shape'); await tap('#t-shape'); await W(200);
    { const hs = await p.$$eval('#props .seg button', L => L.filter(b => b.offsetParent).map(b => Math.round(b.getBoundingClientRect().height)));
      assert(hs.length >= 8 && hs.every(h => h >= 44), '屬性面板形狀／粗細分段鈕高度 ≥ 44 px ' + hs.join(',')); }
    await ctx.close();
  }

  // ---------- 3, 4. [否決] 輸入中的文字、500 ms 內的筆畫與名稱在重新整理後仍在 ----------
  {
    const ctx = await newCtx(); const o = await page(ctx); const { p, tapAt, reset } = o;
    const texts = () => p.evaluate(() => __sb.board.items.filter(i => i.type === 'note' || i.type === 'text').map(i => i.text));
    await reset('note'); await tapAt([200, 600]); await waitFor(p, () => document.activeElement.id === 'editor'); await p.keyboard.type('重要會議紀錄'); await W(1500);
    await reload(p); assert((await texts()).includes('重要會議紀錄'), '便利貼輸入後 1.5 秒重新整理（沒有離開輸入框），文字仍在');
    await reset('text'); await tapAt([150, 700]); await waitFor(p, () => document.activeElement.id === 'editor'); await p.keyboard.type('待辦事項'); await W(1500);
    await reload(p); assert((await texts()).includes('待辦事項'), '文字工具輸入後 1.5 秒重新整理，文字仍在');
    await reset('note'); await tapAt([200, 250]); await waitFor(p, () => document.activeElement.id === 'editor'); await p.keyboard.type('關閉前'); await W(50);
    await reload(p); assert((await texts()).includes('關閉前'), '輸入後 50 ms 就重新整理（pagehide 時寫入），文字仍在');
    await reset('pen'); { const n0 = await p.evaluate(() => __sb.board.items.length);
      await o.T('touchStart', [[60, 300]]); for (const q of [[100, 320], [150, 330], [200, 300]]) { await o.T('touchMove', [q]); await W(8); } await o.T('touchEnd', [[200, 300]]); await W(300);
      await reload(p); assert(await p.evaluate(() => __sb.board.items.length) === n0 + 1, '畫一筆後 300 ms 重新整理，那一筆仍在'); }
    await p.fill('#boardName', '我的白板'); await W(100); await reload(p);
    assert(await p.inputValue('#boardName') === '我的白板', '改名稱 100 ms 後重新整理，名稱仍在');
    // ---------- 5. [否決] 兩個分頁同一畫板不互相覆蓋 ----------
    const o2 = await page(ctx), t2 = o2.p;
    await p.evaluate(() => __sb.addItems([{ id: 'tab1', type: 'rect', x: 0, y: 0, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false)); await W(800);
    await t2.evaluate(() => __sb.addItems([{ id: 'tab2', type: 'rect', x: 90, y: 0, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false)); await W(800);
    const has = q => q.evaluate(() => ['tab1', 'tab2'].map(id => __sb.board.items.some(i => i.id === id)).join());
    assert(await has(t2) === 'true,true', '分頁 2 收到分頁 1 加的物件');
    await waitFor(p, () => __sb.board.items.some(i => i.id === 'tab2')); assert(await has(p) === 'true,true', '分頁 1 收到分頁 2 加的物件');
    // a delete in one tab is not undone by the other tab's next save
    await t2.evaluate(() => { const it = __sb.board.items.find(i => i.id === 'tab1'); __sb.board.items.splice(__sb.board.items.indexOf(it), 1); __sb.addItems([{ id: 'tab2b', type: 'rect', x: 180, y: 0, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false); }); await W(800);
    await p.evaluate(() => __sb.addItems([{ id: 'tab1b', type: 'rect', x: 0, y: 90, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false)); await W(800);
    const o3 = await page(ctx); const ids = await o3.p.evaluate(() => ['tab1', 'tab2', 'tab2b', 'tab1b'].map(id => __sb.board.items.some(i => i.id === id)).join());
    assert(ids === 'false,true,true,true', '重新開啟：兩個分頁加的都在，分頁 2 刪掉的沒有復活 ' + ids);
    await ctx.close();
  }

  // ---------- r2-1. [否決] 12,000 筆的大畫板：新增／改名／刪除後馬上重新整理或關閉，變更仍在 ----------
  {
    const ctx = await newCtx(); const o = await page(ctx); let { p } = o;
    await p.evaluate(() => { const L = []; for (let i = 0; i < 12000; i++) { const pts = []; for (let k = 0; k < 20; k++) pts.push([(i % 100) * 30 + k * 2.123456, Math.floor(i / 100) * 30 + Math.sin(k) * 8.123456, .5]); L.push({ id: 'big' + i, type: 'path', points: pts, color: '#1e1e1e', width: 4, opacity: 100 }); } __sb.addItems(L, false); });
    await p.evaluate(() => __sb.saveNow());
    const add = (id, y) => p.evaluate(([id, y]) => __sb.addItems([{ id, type: 'rect', x: 0, y, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false), [id, y]);
    const has = (q, ids) => q.evaluate(ids => ids.map(id => __sb.board.items.some(i => i.id === id)).join(), ids);
    for (const d of [30, 150, 400]) {
      await add('probe' + d, -200); await p.fill('#boardName', '大畫板' + d); await W(d);
      await reload(p, 30000); assert(await has(p, ['probe' + d]) === 'true' && await p.inputValue('#boardName') === '大畫板' + d, `12,000 筆：新增物件並改名後 ${d} ms 重新整理，兩者都在`);
    }
    await p.evaluate(() => { __sb.setTool('select'); for (const id of ['big5', 'probe30']) __sb.sel.add(id); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); });
    await add('vis', -300); const nExp = await p.evaluate(() => __sb.board.items.length); await W(30); await p.close({ runBeforeUnload: true }); await W(100);
    const q = (await page(ctx)).p; await q.waitForFunction(() => window.__sbReady, null, { timeout: 30000 });
    const got = await has(q, ['vis', 'big5', 'probe30', 'big6']) + ' n=' + await q.evaluate(() => __sb.board.items.length); assert(got === 'true,false,false,true n=' + nExp, got + ' 12,000 筆：刪除兩個、新增一個後 30 ms 關閉分頁，重新開啟三項變更都在');
    assert(await q.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('sketch-board:v1:journal')).every(k => localStorage.getItem(k).length < 5000)), '關閉前寫的是小的變更紀錄，不是整個畫板');
    await ctx.close();
  }

  // ---------- r3-1, r3-2. [否決] 兩個分頁 + journal：合併後 journal 只記自己的變更；關閉的分頁留下的 journal 不會被另一分頁的存檔蓋掉 ----------
  {
    const ctx = await newCtx(); const dialogs = [];
    const A = (await page(ctx)).p; A.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
    await A.evaluate(() => { __sb.board.items.splice(0); const L = []; for (let i = 0; i < 1000; i++) { const pts = []; for (let k = 0; k < 20; k++) pts.push([(i % 100) * 30 + k * 2.1, Math.floor(i / 100) * 30 + Math.sin(k) * 8.1, .5]); L.push({ id: 'big' + i, type: 'path', points: pts, color: '#1e1e1e', width: 4, opacity: 100 }); } __sb.addItems(L, false); return __sb.saveNow(); });
    const B = (await page(ctx)).p; B.on('dialog', d => { dialogs.push(d.type()); d.accept(); });
    const add = (q, id) => q.evaluate(id => __sb.addItems([{ id, type: 'rect', x: 0, y: -200, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false), id);
    const has = (q, ids) => q.evaluate(ids => ids.map(id => __sb.board.items.some(i => i.id === id)).join(), ids);
    await add(B, 'b1'); await B.evaluate(() => __sb.saveNow()); await waitFor(A, () => __sb.board.items.some(i => i.id === 'b1'));
    await add(A, 'a1'); const j = await A.evaluate(() => { const ok = __sb.flushNow(); return { ok, len: Object.keys(localStorage).filter(k => k.startsWith('sketch-board:v1:journal')).reduce((n, k) => n + localStorage.getItem(k).length, 0) }; });
    assert(j.ok && j.len > 0 && j.len < 3000, `合併另一分頁的存檔後，journal 只記本分頁的變更（${j.len} 字元）`);
    await add(A, 'a2'); await W(30); await reload(A);
    assert(await has(A, ['a1', 'a2', 'b1']) === 'true,true,true' && !dialogs.length, '合併後新增物件、30 ms 重新整理：物件都在，沒有離開確認');
    await W(1200); await add(A, 'a3'); await W(30); await A.close({ runBeforeUnload: true }); await W(20);
    await add(B, 'b2'); await B.evaluate(() => __sb.saveNow());
    assert(await has(B, ['a3', 'b2']) === 'true,true', '分頁 A 新增後 30 ms 關閉、分頁 B 20 ms 後存檔：B 收進 A 的物件');
    const C = (await page(ctx)).p; assert(await has(C, ['a1', 'a2', 'a3', 'b1', 'b2']) === 'true,true,true,true,true', '重新開啟：兩個分頁的物件都在');
    await ctx.close();
  }

  // ---------- r4. [否決] 兩個分頁同時關閉／同時重新整理（第三個分頁開著）：兩邊新增的物件都在 ----------
  for (const N of [0, 1000]) {
    const ctx = await newCtx(); const has = (q, ids) => q.evaluate(ids => ids.map(id => __sb.board.items.some(i => i.id === id)).join(), ids);
    const add = (q, id, x) => q.evaluate(([id, x]) => __sb.addItems([{ id, type: 'rect', x, y: -200, w: 50, h: 50, color: '#000000', width: 2, opacity: 100, rot: 0 }], false), [id, x]);
    const C = (await page(ctx)).p;
    if (N) await C.evaluate(N => { const L = []; for (let i = 0; i < N; i++) L.push({ id: 'big' + i, type: 'path', points: [[i % 100 * 30, Math.floor(i / 100) * 30, .5], [i % 100 * 30 + 20, Math.floor(i / 100) * 30 + 9, .5]], color: '#1e1e1e', width: 4, opacity: 100 }); __sb.addItems(L, false); return __sb.saveNow(); }, N);
    const ids = [];
    for (let t = 0; t < 3; t++) {
      const A = (await page(ctx)).p, B = (await page(ctx)).p; await W(300);
      await add(A, `x${t}A`, 0); await add(B, `x${t}B`, 90); ids.push(`x${t}A`, `x${t}B`); await W(30);
      await Promise.all([A.close({ runBeforeUnload: true }), B.close({ runBeforeUnload: true })]); await W(50);
    }
    const D = (await page(ctx)).p; assert(await has(D, ids) === ids.map(() => true).join(), `${N ? N + ' 筆畫板，' : ''}兩個分頁新增後 30 ms 同時關閉（3 次）：重新開啟 6 個物件都在`);
    const E = (await page(ctx)).p; await W(300);
    await add(D, 'rD', 180); await add(E, 'rE', 270); await W(30); await Promise.all([reload(D), reload(E)]); await W(300);
    const F = (await page(ctx)).p;
    assert(await has(F, ['rD', 'rE']) === 'true,true' && await has(D, ['rD', 'rE']) === 'true,true', `${N ? N + ' 筆畫板，' : ''}兩個分頁新增後 30 ms 同時重新整理：兩個物件都在`);
    await ctx.close();
  }

  // ---------- r2-2. 640×360 橫式：屬性面板不超出畫面，「形狀」標題看得到，內部可捲動 ----------
  for (const [w, h] of [[640, 360], [844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const o = await page(ctx);
    await o.reset('shape'); await o.tap('#t-shape'); await W(250);
    const r = await o.p.evaluate(() => { const P = document.getElementById('props'), b = P.getBoundingClientRect(), lab = P.querySelector('#shapeRow .plab').getBoundingClientRect(), top = document.querySelector('.rail.top').getBoundingClientRect(), op = document.getElementById('opRange').getBoundingClientRect();
      return { ok: b.top >= top.bottom && b.bottom <= innerHeight && lab.top >= b.top && lab.bottom <= b.bottom, scroll: getComputedStyle(P).overflowY, opIn: op.bottom <= b.bottom }; });
    assert(r.ok && r.scroll === 'auto', `${w}×${h} 屬性面板在頂列與畫面底之間，「形狀」標題可見，可內部捲動`);
    assert(r.opIn, `${w}×${h} 透明度滑桿不用捲動面板就看得到`);
    await ctx.close();
  }

  // ---------- 6, 8. [否決] 匯入與儲存的物件逐項驗證 ----------
  {
    const ctx = await newCtx(); const o = await page(ctx); const { p } = o;
    const name0 = await p.evaluate(() => __sb.board.name);
    await p.setInputFiles('#jsonIn', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"sketch-board","name":"壞檔","items":[{"type":"path","color":"#000","width":4}]}') });
    await waitFor(p, () => !document.getElementById('toast').hidden);
    assert(await p.evaluate(() => __sb.board.name) === name0 && /格式都不正確/.test(await p.textContent('#toast')), '全部壞掉的檔案：不載入，畫板不變，提示說明原因');
    await p.setInputFiles('#jsonIn', { name: 'mixed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ app: 'sketch-board', name: '混合', items: [
      { type: 'path', color: '#000', width: 4 }, { type: 'path', points: [], color: '#000' }, { type: 'text', x: 0, y: 0, size: 20 }, { type: 'note', x: 0, y: 0, w: 200, h: 100, text: 5, color: '#fff' },
      { type: 'rect', x: 0, y: 0, w: 10, h: 10, color: '#000" onload="alert(1)', width: 2 }, null, { type: 'line', x1: 0, y1: 0, x2: 'a', y2: 3 }] })) });
    await waitFor(p, () => /已匯入/.test(document.getElementById('toast').textContent));
    assert(/已匯入 2 個物件，略過 5 個/.test(await p.textContent('#toast')), '部分壞掉：提示寫出匯入與略過的數量 ' + await p.textContent('#toast'));
    const svg = await p.evaluate(() => __sb.buildSVG());
    assert(!/onload|alert/.test(svg) && /fill="#ffffff"/.test(svg), 'SVG 不含注入的屬性，便利貼顏色正規化');
    assert(await p.evaluate(() => __sb.board.items.find(i => i.type === 'note').text) === '5', '便利貼數字文字修成字串');
    // a broken board already in IndexedDB loads cleaned, with no page errors, and drawing still works
    const e0 = errors.length; await W(1500); // let the import's saves finish, so the reload's pagehide has nothing to write
    await p.evaluate(() => new Promise(res => { const rq = indexedDB.open('sketch-board', 1); rq.onsuccess = () => { const t = rq.result.transaction('boards', 'readwrite'); t.objectStore('boards').put({ id: 'broken', name: '壞', updated: Date.now() + 5000, view: { x: 0, y: 0, zoom: 1 }, items: [{ id: 'a', type: 'path' }, { id: 'b', type: 'text', x: 0, y: 0 }, { id: 'c', type: 'rect', x: 0, y: 0, w: 20, h: 20, color: 'red;x', width: 2 }] }); t.oncomplete = () => { localStorage.setItem('sketch-board:v1:last', '"broken"'); res(); }; }; }));
    await reload(p);
    assert(await p.evaluate(() => __sb.board.id === 'broken' && __sb.board.items.length === 1 && __sb.board.items[0].color === '#1e1e1e'), '儲存中的壞畫板載入時清理（剩 1 個有效物件）');
    await p.evaluate(() => { __sb.setTool('pen'); __sb.frame(); }); await W(100);
    assert(errors.length === e0, '載入壞畫板後沒有 page error');
    await ctx.close();
  }

  // ---------- 7, 9, 10a. 下載檔案、刪除畫板可復原、剪貼簿失敗有替代做法 ----------
  {
    const ctx = await newCtx(); const o = await page(ctx); const { p, tap, reset, settle } = o;
    await reset('select'); await tap('#menuBtn'); await waitFor(p, () => !document.getElementById('menu').hidden); await settle();
    let dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null); await tap('#exSvg'); let d = await dl;
    assert(d && /\.svg$/.test(d.suggestedFilename()) && /^<svg/.test(fs.readFileSync(await d.path(), 'utf8')), 'SVG 匯出是檔案下載 ' + (d && d.suggestedFilename()));
    await settle(); dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null); await tap('#exJson'); d = await dl;
    assert(d && /\.json$/.test(d.suggestedFilename()) && JSON.parse(fs.readFileSync(await d.path(), 'utf8')).app === 'sketch-board', 'JSON 匯出是檔案下載');
    assert(/已下載/.test(await p.textContent('#toast')) && await p.isVisible('#toastAct'), '下載後提示，並附「複製」作為額外選項');
    await p.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); });
    await settle(); await tap('#toastAct'); await waitFor(p, () => /剪貼簿/.test(document.getElementById('toast').textContent));
    assert(/改用下載的檔案/.test(await p.textContent('#toast')) && (await p.textContent('#toastAct')) === '再下載', '剪貼簿失敗時提示改用下載，並提供「再下載」');
    await settle(); dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null); await tap('#toastAct'); assert(!!(await dl), '「再下載」真的下載');
    // PNG preview offers a download button
    await settle(); await p.evaluate(() => { for (const id of ['menu', 'pv']) document.getElementById(id).hidden = true; }); await tap('#menuBtn'); await settle(); await tap('#exPng');
    await waitFor(p, () => !document.getElementById('pv').hidden); await W(300); await settle();
    dl = p.waitForEvent('download', { timeout: 4000 }).catch(() => null); await tap('#pvDl'); d = await dl; assert(d && /\.png$/.test(d.suggestedFilename()), 'PNG 預覽可以下載檔案');
    await settle(); await tap('#pvClose');
    // delete board, then 復原
    await settle(); await tap('#menuBtn'); await settle();
    const before = await p.evaluate(() => ({ id: __sb.board.id, n: __sb.board.items.length }));
    await tap('#delBoard'); await settle(); await tap('#delBoard'); await waitFor(p, () => /已刪除/.test(document.getElementById('toast').textContent));
    assert(await p.evaluate(id => __sb.board.id !== id, before.id) && await p.isVisible('#toastAct'), '刪除畫板後提示附「復原」');
    await settle(); await tap('#toastAct'); await waitFor(p, id => __sb.board.id === id, before.id);
    assert(await p.evaluate(() => ({ id: __sb.board.id, n: __sb.board.items.length })).then(a => a.id === before.id && a.n === before.n), '按「復原」找回整個畫板');
    await W(600); await reload(p);
    assert(await p.evaluate(id => __sb.board.id === id && __sb.board.items.length > 10, before.id), '復原的畫板重新整理後仍在');
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 page error／console error ' + errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? `FAIL ${fails} 項` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
