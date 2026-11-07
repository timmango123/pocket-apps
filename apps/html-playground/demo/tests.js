// HTML 即時預覽：上架評分 toFix 的回歸測試（node tests.js，約 40–60 秒）
// 每項都是等條件成立，不用固定等待；預覽的錯誤（about:srcdoc）是使用者程式的輸出，不算工具錯誤。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const SKEL = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const PRE = 'html-playground:v1:';

(async () => {
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/hub')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><meta charset="utf-8"><body></body>'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SKEL + APP + '</body></html>');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL_ = 'http://127.0.0.1:' + srv.address().port + '/app/';
  const browser = await chromium.launch();
  const watch = p => {
    p.on('console', m => { if (m.type() === 'error' && !/srcdoc/.test((m.location() || {}).url || '')) errors.push(m.text()); });
    p.on('pageerror', e => errors.push(String(e.stack || e)));
  };
  const ctxOf = (w, h, extra = {}) => browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...extra });
  const ready = p => p.waitForFunction(() => window.__hp && window.__hp.ready, null, { timeout: 15000 });
  async function open(w = 390, h = 844, extra) { const ctx = await ctxOf(w, h, extra); const p = await ctx.newPage(); watch(p); await p.goto(URL_); await ready(p); return { ctx, p }; }
  const logs = p => p.$$eval('#logs .log:not(.empty)', ns => ns.map(n => n.textContent));
  const waitLog = (p, re, ms = 10000) => p.waitForFunction(src => [...document.querySelectorAll('#logs .log')].some(n => new RegExp(src).test(n.textContent)), re.source, { timeout: ms }).then(() => true, () => false);
  const setJs = (p, code) => p.evaluate(c => { edHtml.value = ''; edCss.value = ''; edJs.value = c; edJs.dispatchEvent(new Event('input')); window.__hp.run(true); }, code);
  const pv = p => p.frames().find(f => f.url() === 'about:srcdoc');
  const toastText = p => p.textContent('#toast');

  // 1. 安全模式：無大括號的迴圈也會中止，錯誤指向使用者的行號；主控台輸入的迴圈也有保護
  {
    const { ctx, p } = await open();
    await p.click('#conToggle');
    await setJs(p, 'let i = 0, j = 0;\nsetTimeout(() => { while (true) i++; });\nsetTimeout(() => { for (;;) j++; });\nsetTimeout(() => { do i++; while (true); });\nsetTimeout(() => { for (;;)\n  j++; });\nsetTimeout(() => { const t = `x${(() => { while (true) {} })()}`; });\n(async () => { while (true) { await 0 } })();\n');
    const ok = await p.waitForFunction(() => [...document.querySelectorAll('#logs .log.error')].filter(n => /迴圈超過 2 秒/.test(n.textContent)).length >= 6, null, { timeout: 40000 }).then(() => true, () => false);
    const l = await logs(p);
    assert(ok, '六種無窮迴圈都被中止（無大括號 while/for(;;)/do…while/換行 for、樣板字串 ${} 裡的迴圈、await 0 迴圈）');
    assert(['JS 第 2 行', 'JS 第 3 行', 'JS 第 4 行', 'JS 第 5 行', 'JS 第 7 行'].every(s => l.some(x => x.startsWith(s) && /迴圈超過/.test(x))), '中止訊息指向使用者的行號（第 2–5、7 行）：' + l.filter(x => /迴圈/.test(x)).map(x => x.slice(0, 9)).join(','));
    assert(l.some(x => /Promise 拒絕：迴圈超過 2 秒/.test(x)), 'await 迴圈（只跑微任務）也在 2 秒後中止');
    const t0 = Date.now(); await p.evaluate(() => 1); assert(Date.now() - t0 < 1500, '中止後工具可以操作');
    const g = await p.evaluate(() => [window.__hp.guardLoops('for (const a of xs) f(a);'), window.__hp.guardLoops("const s = 'while(1){}'; x.while(1); Symbol.for('k');"), window.__hp.guardLoops('for (let i = 0; i < 3; i++) s += i;')]);
    assert(/__gi\(1, xs\)/.test(g[0]) && g[1] === "const s = 'while(1){}'; x.while(1); Symbol.for('k');" && /;\s*__g\(1\), i < 3;/.test(g[2]), 'guardLoops：for…of 包裝、字串與 .while/.for 方法不動、for 條件加保護');
    await p.evaluate(() => { conIn.value = 'let k = 0; while (true) k++;'; }); await p.click('#conForm button');
    assert(await waitLog(p, /主控台.*迴圈超過 2 秒/), '主控台輸入的無窮迴圈也被中止（標示「主控台」）');
    // 正常的長迴圈不被誤殺、Canvas 範本 rAF 迴圈不誤殺
    await setJs(p, 'let s = 0;\nfor (let i = 0; i < 3e6; i++) s += i;\nconsole.log("sum", s);\n');
    assert(await waitLog(p, /^sum 4499998500000$/), '合法的大迴圈正常完成');
    // 無限遞迴：指向函式所在的 JS 行，而不是「文件第 N 行」
    await setJs(p, 'let a = 1;\n\nfunction f(n) { return f(n + 1) }\nf(0)\n');
    assert(await waitLog(p, /^JS 第 3 行（f）.*Maximum call stack/), '無限遞迴的錯誤指向 JS 第 3 行（f）：' + (await logs(p)).join(' | ').slice(0, 80));
    await setJs(p, 'let a = 1;\nlet b = ;\n');
    assert(await waitLog(p, /^JS 第 2 行.*SyntaxError/), '語法錯誤仍指向 JS 第 2 行');
    await ctx.close();
  }

  // 2. 上次執行沒結束（凍結）→ 下次開啟不自動執行；正常執行會清掉標記
  {
    const { ctx, p } = await open();
    const id = await p.evaluate(() => window.__hp.P.id);
    assert(await p.waitForFunction(k => localStorage.getItem(k) === null, PRE + 'running', { timeout: 8000 }).then(() => true, () => false), '正常執行後預覽回報，清除執行中標記');
    const flagNow = await p.evaluate(k => { window.__hp.run(true); return localStorage.getItem(k); }, PRE + 'running');
    assert(flagNow && JSON.parse(flagNow).id === id, '執行前先同步寫入執行中標記');
    await p.waitForFunction(k => localStorage.getItem(k) === null, PRE + 'running', { timeout: 8000 }).catch(() => {});
    // 模擬凍結：標記留著（凍結時頁面無法清除），重新開啟
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [PRE + 'running', JSON.stringify({ id, tok: 'x', t: Date.now() })]);
    const p2 = await ctx.newPage(); watch(p2); await p.close({ runBeforeUnload: false });
    await p2.evaluate(([k, v]) => localStorage.setItem(k, v), [PRE + 'running', JSON.stringify({ id, tok: 'x', t: Date.now() })]).catch(() => {});
    await p2.goto(URL_); await ready(p2);
    assert(await p2.evaluate(() => window.__hp.paused), '開啟時看到標記 → 暫停自動執行');
    const f = pv(p2); await f.waitForSelector('p');
    assert(/上次執行沒有結束/.test(await f.textContent('body')) && !(await f.$('#plus')), '預覽顯示「上次執行沒有結束」而不是執行程式');
    assert(/上次執行沒有結束/.test((await logs(p2)).join('\n')), '主控台也有說明');
    await p2.click('#runBtn');
    await pv(p2).waitForSelector('#plus');
    assert(!(await p2.evaluate(() => window.__hp.paused)), '按「執行」後恢復');
    assert(await p2.waitForFunction(k => localStorage.getItem(k) === null, PRE + 'running', { timeout: 8000 }).then(() => true, () => false), '執行成功後標記清除，下次正常自動執行');
    await ctx.close();
  }

  // 3. 打字後馬上回大廳（iframe 被移除）或關頁，最後的輸入仍在
  {
    const ctx = await ctxOf(390, 844); const h = await ctx.newPage(); watch(h);
    await h.goto(URL_.replace('/app/', '/hub/'));
    await h.evaluate(u => { const f = document.createElement('iframe'); f.id = 'f'; f.src = u; f.style.cssText = 'width:390px;height:700px;border:0'; document.body.appendChild(f); }, URL_);
    let fr; await h.waitForFunction(() => true); for (let i = 0; i < 100 && !fr; i++) { fr = h.frames().find(x => x.url() === URL_); if (!fr) await h.waitForTimeout(50); }
    await fr.waitForFunction(() => window.__hp && window.__hp.ready);
    await fr.focus('#edHtml'); await h.keyboard.type('LOBBY1');
    await h.evaluate(() => document.getElementById('f').remove());
    const q = await ctx.newPage(); watch(q); await q.goto(URL_); await ready(q);
    assert((await q.inputValue('#edHtml')).includes('LOBBY1'), '大廳中打字後立刻返回（iframe 移除），重開內容還在');
    await q.focus('#edCss'); await q.click('#tabCss'); await q.keyboard.type('/*CLOSE2*/');
    await q.close({ runBeforeUnload: false });
    const r = await ctx.newPage(); watch(r); await r.goto(URL_); await ready(r);
    assert((await r.inputValue('#edCss')).includes('/*CLOSE2*/'), '打字後立刻關閉頁面，重開內容還在');
    assert(await r.evaluate(() => window.__hp.allProjects().then(l => l[0].css.includes('/*CLOSE2*/'))), '草稿已寫回 IndexedDB');
    await ctx.close();
  }

  // 4. 主控台展開時輸入列不被切掉、預覽不被擠成細條（矮畫面改成和預覽切換）；小橫式並排；快捷鍵與主控台輸入框 44px
  for (const [w, hh] of [[360, 640], [375, 500], [390, 610], [390, 844], [430, 932], [667, 375], [360, 450]]) {
    const { ctx, p } = await open(w, hh);
    await p.click('#conToggle');
    await p.waitForFunction(() => !conBody.hidden);
    const r = await p.evaluate(() => { const pane = pvPane.getBoundingClientRect(), i = conIn.getBoundingClientRect(), b = document.querySelector('#conForm button').getBoundingClientRect(); return { ok: i.bottom <= pane.bottom + 0.5 && b.bottom <= pane.bottom + 0.5 && i.top >= pane.top, ih: i.height, sw: document.documentElement.scrollWidth, contab: pvPane.classList.contains('contab'), pv: pvWrap.clientHeight, split: split.clientHeight, ed: edHtml.clientHeight, lh: parseFloat(getComputedStyle(edHtml).lineHeight), side: pane.left > edPane.getBoundingClientRect().right - 2 }; });
    assert(r.ok && r.sw <= w, `${w}×${hh} 主控台展開：輸入列完整在面板內、無橫向捲動`);
    assert(r.contab ? r.pv === 0 : r.pv >= Math.max(120, (r.split - 14) * 0.25) - 1, `${w}×${hh} 預覽 ${r.contab ? '改用切換（主控台暫代預覽）' : r.pv + ' px ≥ max(120, 25%) of ' + r.split}`);
    if (hh >= 480) assert(r.ed >= r.lh * 3 - 1, `${w}×${hh} 編輯器至少 3 行（${(r.ed / r.lh).toFixed(1)} 行）`);
    if (w === 667) assert(r.side, '667×375 小橫式改成左右並排');
    if (r.contab) {
      await p.click('#conToggle');
      assert(await p.waitForFunction(() => pvWrap.clientHeight > 60 && !pvPane.classList.contains('contab')).then(() => true, () => false), `${w}×${hh} 點主控台標題回到預覽`);
    }
    if (w === 360) {
      assert(r.ih >= 44, '主控台輸入框高 ≥ 44：' + r.ih);
      const k = await p.$$eval('#keys button', bs => bs.map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      assert(Math.min(...k) >= 44, '快捷符號鍵 ≥ 44×44');
      assert(!(await p.evaluate(() => keysWrap.classList.contains('end'))), '快捷列右側有可捲動的漸層提示');
      await p.evaluate(() => { keys.scrollLeft = 9999; keys.dispatchEvent(new Event('scroll')); });
      assert(await p.waitForFunction(() => keysWrap.classList.contains('end')).then(() => true, () => false), '捲到最右邊後提示消失');
    }
    await ctx.close();
  }

  // 5. 鍵盤彈出（矮視窗）時編輯器至少 8 行，預覽收成一條工具列；離開編輯器後恢復
  {
    const { ctx, p } = await open(390, 450);
    await p.click('#conToggle');
    await p.tap('#edHtml');
    await p.waitForFunction(() => app.classList.contains('kb'));
    const r = await p.evaluate(() => ({ lines: edHtml.clientHeight / parseFloat(getComputedStyle(edHtml).lineHeight), bar: document.querySelector('.pvbar').getBoundingClientRect().bottom, H: innerHeight }));
    assert(r.lines >= 8 && r.bar <= r.H, '390×450 編輯中：編輯器 ' + r.lines.toFixed(1) + ' 行、預覽工具列仍可按');
    const before = await p.evaluate(() => edHtml.getBoundingClientRect().top);
    await p.tap('#reloadBtn');
    await p.waitForFunction(() => !app.classList.contains('kb'));
    assert(await p.evaluate(() => edHtml.getBoundingClientRect().top) === before, '離開編輯器後預覽回來，編輯器位置不跳動');
    await ctx.close();
    // 沒有螢幕鍵盤（桌面矮視窗、滑鼠）時不收起預覽
    const c2 = await browser.newContext({ viewport: { width: 700, height: 450 } }); const p2 = await c2.newPage(); watch(p2); await p2.goto(URL_); await ready(p2);
    await p2.click('#edHtml'); await p2.waitForTimeout(50);
    assert(await p2.evaluate(() => document.activeElement === edHtml && !app.classList.contains('kb') && pvWrap.clientHeight > 0), '矮的桌面視窗（滑鼠）打字時預覽不收起');
    await c2.close();
  }

  // 6. 刪除可復原；匯出全部作品備份並匯入
  {
    const { ctx, p } = await open();
    await p.click('#moreBtn'); await p.click('#mTpl'); await p.click('#tpl-flex');
    await p.waitForFunction(() => projName.value === 'Flex 版面');
    await p.evaluate(() => { edHtml.value += '<!--mine-->'; edHtml.dispatchEvent(new Event('input')); });
    await p.click('#worksBtn'); await p.waitForSelector('#wlist li:nth-child(2)');
    await p.click('#del0'); await p.click('#cfYes');
    await p.waitForFunction(() => !undoBar.hidden && document.querySelectorAll('#wlist li').length === 1);
    const ub = await p.locator('#undoBtn').boundingBox();
    assert(ub && ub.height >= 44 && await p.evaluate(() => undoBar.closest('dialog') === dlgWorks && getComputedStyle(undoBar).position !== 'fixed'), '刪除後「復原」條在作品清單對話框底部（不蓋住主控台）');
    await p.click('#undoBtn');
    await p.waitForFunction(() => document.querySelectorAll('#wlist li').length === 2 && projName.value === 'Flex 版面');
    assert((await p.inputValue('#edHtml')).includes('<!--mine-->'), '復原後作品回來，連未存的最後修改都在');
    await p.click('#dlgWorks [data-close]');
    // 備份
    await p.click('#moreBtn');
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#mBackup')]);
    const bk = JSON.parse(fs.readFileSync(await d.path(), 'utf8'));
    assert(/\.json$/.test(d.suggestedFilename()) && bk.app === 'html-playground' && bk.projects.length === 2 && bk.projects.some(x => x.html.includes('<!--mine-->')), '匯出全部作品：' + d.suggestedFilename() + '，' + bk.projects.length + ' 個');
    const buf = Buffer.from(JSON.stringify(bk));
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: buf });
    await p.waitForFunction(() => /匯入/.test(toast.textContent));
    assert(/匯入 0 個.*2 個已存在/.test(await toastText(p)), '同一份備份再匯入：不重複、不覆蓋（' + await toastText(p) + '）');
    bk.projects[0].id = 'other-device'; bk.projects[0].name = '別台的作品';
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bk)) });
    await p.waitForFunction(() => /匯入 1 個/.test(toast.textContent));
    assert((await p.evaluate(() => window.__hp.allProjects().then(l => l.map(x => x.name)))).includes('別台的作品'), '備份裡的新作品被加入');
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"projects": [1, ') });
    await p.waitForFunction(() => /不是有效的 JSON/.test(toast.textContent));
    assert(true, '壞掉的備份檔被擋下並說明');
    await ctx.close();
  }

  // 7. 大檔：不自動執行、行號只畫可見範圍、匯入有進度提示
  {
    const { ctx, p } = await open();
    const big = Array.from({ length: 30000 }, (_, i) => `<p>段落 ${i} lorem ipsum dolor sit amet</p>`).join('\n');
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'big.html', mimeType: 'text/html', buffer: Buffer.from('<!doctype html><title>大檔</title><body>' + big + '</body>') });
    await p.waitForFunction(() => projName.value === '大檔', null, { timeout: 60000 });
    const f = pv(p); await f.waitForSelector('p');
    assert(/作品很大/.test(await f.textContent('body')), '超過 100 萬字的作品不自動執行，預覽提示按「執行」');
    const g = await p.evaluate(() => gutIn.textContent.trim().split('\n').length);
    assert(g < 120, '行號只畫可見範圍（' + g + ' 行，而不是 30000 行）');
    await p.evaluate(() => { edHtml.scrollTop = 21 * 1000 * 1.2; edHtml.dispatchEvent(new Event('scroll')); });
    const first = await p.evaluate(() => { const lh = parseFloat(getComputedStyle(edHtml).lineHeight); return { want: Math.floor(edHtml.scrollTop / lh) + 1, have: +gutIn.textContent.trim().split('\n')[1] }; });
    assert(Math.abs(first.want - first.have) <= 1, '捲動後行號跟著（第 ' + first.have + ' 行附近）');
    assert(/超過 100 萬字/.test(await p.textContent('#bigWarn')), '大檔橫幅說明已停用自動執行');
    assert(fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8').includes("toast('匯入中…"), '大檔匯入期間顯示「匯入中…」');
    // 每鍵不做全量工作：5 個連續輸入只在停 300 ms 後整理一次；打字時行數增量更新
    const e0 = await p.evaluate(() => { const lc = window.__hp.lineCount, e = window.__hp.edits; edHtml.focus(); for (let i = 0; i < 5; i++) { edHtml.setRangeText(i === 2 ? '\n' : 'x', edHtml.value.length, edHtml.value.length, 'end'); edHtml.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: i === 2 ? '\n' : 'x' })); } return { e, now: window.__hp.edits, lc, lc2: window.__hp.lineCount }; });
    assert(e0.now === e0.e && e0.lc2 === e0.lc + 1, '大作品打字：輸入當下不重算（行數 +1 增量更新）');
    await p.waitForFunction(n => window.__hp.edits === n + 1, e0.e);
    assert(await p.evaluate(() => window.__hp.P.html.endsWith('xx\nxx')), '停 300 ms 後整理一次並記錄修改');
    // 大作品的草稿：只存改動的片段（不受 localStorage 容量限制），重新整理後還原
    await p.evaluate(() => window.__hp.flushSave());
    await p.evaluate(() => { edHtml.setRangeText('ZQ', 10, 10, 'end'); edHtml.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: 'ZQ' })); });
    const dr = await p.evaluate(k => { dispatchEvent(new Event('pagehide')); return localStorage.getItem(k); }, PRE + 'draft');
    assert(dr && dr.length < 2000 && /"alts"/.test(dr), '大作品離開時寫入差異草稿（' + (dr ? dr.length : 0) + ' 字元）');
    // 模擬 IndexedDB 還沒寫完頁面就關了：資料庫留在舊版，只有差異草稿，下次開啟要補回
    await p.close({ runBeforeUnload: false });
    const h = await ctx.newPage(); watch(h); await h.goto(URL_.replace('/app/', '/hub/'));
    await h.evaluate(async dr => {
      const d = JSON.parse(dr), a = d.alts[0];
      const db = await new Promise(r => { const q = indexedDB.open('html-playground', 1); q.onsuccess = () => r(q.result); });
      const cur = await new Promise(r => { const g = db.transaction('projects').objectStore('projects').get(d.id); g.onsuccess = () => r(g.result); });
      if (cur.html.slice(10, 12) === 'ZQ') cur.html = cur.html.slice(0, 10) + cur.html.slice(12); // undo the newer save, if it landed
      cur.updatedAt = a.base;
      await new Promise(r => { const t = db.transaction('projects', 'readwrite'); t.objectStore('projects').put(cur); t.oncomplete = r; });
      db.close(); localStorage.setItem('html-playground:v1:draft', dr);
    }, dr);
    const p3 = await ctx.newPage(); watch(p3); await p3.goto(URL_); await ready(p3);
    assert(await p3.evaluate(() => edHtml.value.slice(8, 14).includes('ZQ') && edHtml.value.endsWith('xx\nxx')), '資料庫還是舊版時，開啟後由差異草稿補回最後的輸入');
    await ctx.close();
  }

  // 8. 主控台：格式字串、-0、let/const 保留到下一行、↑ 歷史
  {
    const { ctx, p } = await open();
    await p.click('#conToggle');
    await setJs(p, "console.log('%s 有 %d 個', '我', 3.7);\nconsole.log('%c紅字', 'color:red');\nconsole.log('%o|%f|100%%', {a:1}, '2.5x');\nconsole.log(-0, [-0]);\n");
    assert(await waitLog(p, /^我 有 3 個$/), "console.log('%s 有 %d 個', '我', 3.7) → 我 有 3 個");
    assert(await waitLog(p, /^紅字$/), '%c 的樣式參數不顯示');
    assert(await waitLog(p, /^\{a: 1\}\|2\.5\|100%$/), '%o %f %% 正確');
    assert(await waitLog(p, /^-0 \[-0\]$/), '-0 顯示為 -0');
    for (const c of ['let z = 5', 'const w = z * 2', 'z + w']) { await p.fill('#conIn', c); await p.press('#conIn', 'Enter'); }
    assert(await waitLog(p, /^← 15$/), '主控台 let/const 在下一行仍可用（z + w = 15）');
    await p.focus('#conIn'); await p.press('#conIn', 'ArrowUp');
    assert(await p.inputValue('#conIn') === 'z + w', '↑ 叫回上一個指令');
    await p.press('#conIn', 'ArrowUp'); assert(await p.inputValue('#conIn') === 'const w = z * 2', '再按 ↑ 更早的指令');
    await p.press('#conIn', 'ArrowDown'); await p.press('#conIn', 'ArrowDown'); assert(await p.inputValue('#conIn') === '', '↓ 回到空白輸入');
    await ctx.close();
  }

  // 9. 匯入：保留 body 屬性、module 保持 module、擋下二進位與非 HTML；匯出→匯入名稱與 </script> 不變；下載 .html
  {
    const { ctx, p } = await open();
    await p.click('#conToggle');
    const src = '<!doctype html><html><head><title>B</title><script type="importmap">{"imports":{}}</script></head><body class="dark" style="margin:0"><p id="t">x</p><script type="module">window.__mod = typeof import.meta; console.log("mod", typeof import.meta)</script><script>console.log("classic")</script></body></html>';
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'b.html', mimeType: 'text/html', buffer: Buffer.from(src) });
    await p.waitForFunction(() => projName.value === 'B');
    const h = await p.inputValue('#edHtml');
    assert(/<body class="dark" style="margin:0">/.test(h) && /<script type="module">/.test(h) && /type="importmap"/.test(h), '匯入保留 <body> 屬性、module 與 importmap 留在 HTML 分頁');
    assert(await p.inputValue('#edJs') === 'console.log("classic")\n', '一般 script 放到 JS 分頁');
    assert(await waitLog(p, /^mod object$/), 'module script 以 module 執行（import.meta 可用）');
    assert(await pv(p).evaluate(() => document.body.className === 'dark' && document.body.style.margin === '0px'), '預覽的 body 帶有原本的 class 與 style');
    const bin = Buffer.alloc(4096); for (let i = 0; i < bin.length; i++) bin[i] = (i * 37) & 255;
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'bin.html', mimeType: 'text/html', buffer: bin });
    await p.waitForFunction(() => /不是文字/.test(toast.textContent));
    assert(await p.inputValue('#projName') === 'B', '二進位檔被擋下，沒有建立亂碼作品');
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'plain.html', mimeType: 'text/html', buffer: Buffer.from('只是一段文字') });
    await p.waitForFunction(() => /找不到任何 HTML 標籤/.test(toast.textContent));
    assert(true, '沒有任何標籤的檔案被擋下並說明');
    // 往返
    await p.fill('#projName', '往返 <測試> & 1');
    await p.evaluate(() => { edJs.value = "console.log('</script>');\n"; edJs.dispatchEvent(new Event('input')); edHtml.value = '<h1>標題 😀</h1>\n'; edHtml.dispatchEvent(new Event('input')); });
    await p.click('#moreBtn');
    await p.evaluate(() => { const o = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { window.__dlName = this.download; return o.call(this); }; });
    const [d] = await Promise.all([p.waitForEvent('download'), p.click('#mDl')]);
    const exp = fs.readFileSync(await d.path(), 'utf8'), dn = await p.evaluate(() => window.__dlName);
    // headless Chromium reports non-ASCII download names as "download"; the anchor's own name is checked instead
    assert(dn === '往返-測試-&-1.html' && exp.includes('<title>往返 &lt;測試&gt; &amp; 1</title>'), '沒有 downloads 能力時用 <a download> 下載 .html：' + dn);
    await p.click('#moreBtn'); await p.setInputFiles('#importFile', { name: 'rt.html', mimeType: 'text/html', buffer: Buffer.from(exp) });
    await p.waitForFunction(() => /已匯入/.test(toast.textContent) && projName.value.startsWith('往返'));
    assert(await p.inputValue('#projName') === '往返 <測試> & 1' && await p.inputValue('#edJs') === "console.log('</script>');\n", '匯出→匯入後名稱的 <>& 與 JS 裡的 </script> 都不變');
    await ctx.close();
  }

  // 10. 深色模式的空白預覽、分隔線握把對比
  {
    const { ctx, p } = await open(390, 844, { colorScheme: 'dark' });
    await p.evaluate(() => { edHtml.value = edCss.value = edJs.value = ''; window.__hp.run(true); });
    const f = pv(p); await f.waitForSelector('p');
    const bg = await f.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg === 'rgb(20, 22, 26)', '深色模式的空白預覽是深色底：' + bg);
    const grip = await p.evaluate(() => { const s = getComputedStyle(divider, '::before'); return s.backgroundColor + ' ' + s.opacity; });
    assert(!/rgb\(45, 50, 58\)/.test(grip), '分隔線握把不再用與背景相近的線條色：' + grip);
    await ctx.close();
  }

  assert(errors.length === 0, '工具本身沒有 console / page error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
