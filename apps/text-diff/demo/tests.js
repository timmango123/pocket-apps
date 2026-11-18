// 文字比對：上架評分 r1 toFix 的回歸測試（node tests.js，約 40 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const HTML = () => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
// served over http, not file://: reload tests need localStorage to survive
const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML()); });
const K = 'text-diff:v1:';
let fails = 0, URL;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: URL.replace(/\/$/, '') });
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__tdReady);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    // scrolls the control into view first if it is off screen (the diff nav only floats once the result is in view)
    const center = sel => p.$eval(sel, e => { let b = e.getBoundingClientRect(); if (b.top < 0 || b.bottom > innerHeight) { e.scrollIntoView({ block: 'center' }); b = e.getBoundingClientRect(); } return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', []); };
    const tap = async (sel, hold) => tapAt(await center(sel), hold);
    // a finger rests on `rest`, another taps `sel` and only that finger lifts
    const restTap = async (rest, sel) => {
      // `rest` is a selector, or null for a point in the empty left gutter (always on screen)
      const R = [...(rest ? await center(rest) : [6, 420]), 2], q = [...await center(sel), 1];
      await T('touchStart', [R]); await W(150); await T('touchStart', [R, q]); await W(60); await T('touchEnd', [q]); await W(120); await T('touchEnd', [R]);
    };
    return { ctx, p, T, center, tap, tapAt, restTap };
  }
  const ev = (p, fn, a) => p.evaluate(fn, a);
  const waitFor = (p, fn, a, ms = 4000) => p.waitForFunction(fn, a, { timeout: ms }).then(() => true, () => false);
  const settle = () => W(850); // past the 800 ms ghost-click window
  const st = p => ev(p, () => ({ cur: __td.cur, theme: document.documentElement.dataset.theme || 'auto', gran: document.querySelector('[data-g][aria-pressed=true]')?.dataset.g, view: document.querySelector('[data-v][aria-pressed=true]')?.dataset.v, ws: document.getElementById('optWs').checked, l: document.getElementById('left').value, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent, ae: document.activeElement.id || document.activeElement.tagName }));
  const MANY = () => { const a = [], b = []; for (let i = 0; i < 60; i++) { a.push('line ' + i + ' alpha'); b.push(i % 2 ? 'line ' + i + ' alpha' : 'line ' + i + ' beta'); } document.getElementById('left').value = a.join('\n'); document.getElementById('right').value = b.join('\n'); __td.run(); scrollTo(0, 0); };

  // ---------- 1. [嚴重] 另一指放在畫面上時，每個按鈕都要在 pointerup 觸發 ----------
  {
    const { ctx, p, restTap, tap } = await open();
    await ev(p, MANY);
    let a = await st(p); await restTap('.brand h1', '#nextBtn');
    assert(await waitFor(p, c => __td.cur !== c, a.cur), '一指放在標題，另一指點「下一段」只放開這指 → 計數改變');
    await ev(p, () => scrollTo(0, 0)); await settle();
    for (const [rest, sel, check, name] of [
      [null, '#themeBtn', s => s.theme !== 'auto', '深淺色'],
      [null, '#granWord', s => s.gran === 'word', '粒度「詞」'],
      [null, 'label.ck:nth-of-type(1)', s => s.ws, '勾選「忽略空白」'],
      [null, '#viewSide', s => s.view === 'side', '並排'],
      [null, '#viewInline', s => s.view === 'inline', '整合'],
    ]) {
      await ev(p, s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
      await restTap(rest, sel); await W(250);
      const ok = check(await st(p));
      assert(ok, `另一指放著時點${name}有作用`);
      await settle();
    }
    // header swap, 比對, copy, paste (clipboard granted), clear + toast 復原
    await ev(p, () => scrollTo(0, 0));
    a = await st(p); await restTap('.brand h1', '#swapBtn');
    assert(await waitFor(p, l => document.getElementById('left').value !== l, a.l), '另一指放著時點「交換」有作用');
    await settle();
    await ev(p, () => { window.__ran = 0; document.getElementById('runBtn').addEventListener('click', () => window.__ran++); });
    await restTap('.brand h1', '#runBtn'); assert(await waitFor(p, () => window.__ran === 1), '另一指放著時點「比對」有作用'); await settle();
    await ev(p, () => document.getElementById('copyBtn').scrollIntoView({ block: 'center' }));
    await restTap(null, '#copyBtn');
    assert(await waitFor(p, () => /已複製/.test(document.getElementById('toast').textContent)), '另一指放著時點「複製差異」有作用');
    const clip = await ev(p, () => navigator.clipboard.readText()); assert(/^--- 原文\n\+\+\+ 修改後\n@@/.test(clip), '複製的是統一 diff');
    await settle(); await ev(p, () => scrollTo(0, 0));
    await ev(p, () => navigator.clipboard.writeText('貼上測試'));
    await restTap('.brand h1', '#pasteL');
    assert(await waitFor(p, () => document.getElementById('left').value === '貼上測試'), '另一指放著時點「貼上」有作用');
    await settle();
    await restTap('.brand h1', '#clearBtn');
    assert(await waitFor(p, () => document.getElementById('left').value === '' && !document.getElementById('toast').hidden), '另一指放著時點「清空」有作用');
    const ae = (await st(p)).ae; assert(ae !== 'left' && ae !== 'right', '清空後焦點不在輸入框（不跳鍵盤） ' + ae);
    await settle();
    await restTap('.brand h1', '#toast button');
    assert(await waitFor(p, () => document.getElementById('left').value === '貼上測試'), '另一指放著時點 toast「復原」有作用');
    await settle();
    // fold expand
    await ev(p, () => { const a = [], b = []; for (let i = 0; i < 40; i++) { a.push('row ' + i); b.push(i === 2 || i === 30 ? 'ROW ' + i : 'row ' + i); } document.getElementById('left').value = a.join('\n'); document.getElementById('right').value = b.join('\n'); __td.run(); document.querySelector('.fold').scrollIntoView({ block: 'center' }); });
    const folds = await ev(p, () => document.querySelectorAll('.fold').length);
    await restTap(null, '.fold');
    assert(await waitFor(p, n => document.querySelectorAll('.fold').length === n - 1, folds), '另一指放著時點「展開未變更」有作用');
    await settle();
    // open file (Big5) and re-read as Big5 with a resting finger
    await ev(p, () => scrollTo(0, 0));
    const fc = p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await restTap('.brand h1', '#openL');
    const chooser = await fc; assert(!!chooser, '另一指放著時點「開啟檔案」會開檔案選擇');
    if (chooser) {
      await chooser.setFiles({ name: 'big5.txt', mimeType: 'text/plain', buffer: Buffer.from([0xa4, 0xa4, 0xa4, 0xe5, 0x0a]) });
      assert(await waitFor(p, () => !document.getElementById('encL').hidden), 'Big5 檔顯示編碼提示');
      await settle();
      await restTap('.brand h1', '#encL button');
      assert(await waitFor(p, () => document.getElementById('left').value === '中文\n'), '另一指放著時點「以 Big5 重新讀取」有作用');
    }
    // a direct tap on a text box still focuses it right after a button tap
    await settle(); await tap('#themeBtn'); await W(200); await tap('#right');
    assert(await waitFor(p, () => document.activeElement.id === 'right'), '點按鈕後直接點輸入框仍可取得焦點');
    await ctx.close();
  }

  // ---------- 2. [嚴重] 兩指重疊：兩個都要有作用（兩種放開順序） ----------
  // 下一段 + 深淺色 on a phone tall enough to show both at once; 下一段 + 並排 at 390x844
  for (const [h, sel2] of [[1150, '#themeBtn'], [844, '#viewSide']]) for (const order of ['first', 'second']) {
    const { ctx, p, T, center } = await open({ h });
    await ev(p, MANY); if (h === 844) await ev(p, () => scrollTo(0, 400));
    const a = await st(p); const F1 = [...await center('#nextBtn'), 1], F2 = [...await center(sel2), 2];
    await T('touchStart', [F1]); await W(50); await T('touchStart', [F1, F2]); await W(60);
    if (order === 'first') { await T('touchEnd', [F1]); await W(40); await T('touchEnd', [F2]); } else { await T('touchEnd', [F2]); await W(40); await T('touchEnd', [F1]); }
    await W(300); const b = await st(p);
    const other = sel2 === '#themeBtn' ? b.theme !== a.theme : b.view === 'side';
    assert(b.cur === a.cur + 1 && other, `390x${h} 兩指重疊（${order === 'first' ? '先按的先放' : '後按的先放'}）：下一段與${sel2 === '#themeBtn' ? '深淺色' : '並排'}都作用 cur ${a.cur}→${b.cur}`);
    await ctx.close();
  }

  // ---------- 3. [嚴重] 點擊後 300 ms 補送 detail 0 click：只作用一次 ----------
  {
    const { ctx, p, tap, center } = await open();
    await ev(p, MANY);
    const replay = (sel, mode) => ev(p, ([sel, mode]) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      const x = mode === 'edge' ? r.right - 1 : r.left + r.width / 2, y = mode === 'edge' ? r.bottom - 1 : r.top + r.height / 2;
      const t = mode === 'el' ? el : document.elementFromPoint(x, y) || el;
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
    }, [sel, mode]);
    for (const mode of ['el', 'edge', 'point']) {
      let a = await st(p); await tap('#nextBtn'); await W(300); await replay('#nextBtn', mode); await W(150);
      let b = await st(p); assert(b.cur === a.cur + 1, `下一段：點一下＋detail 0 click（${mode}）只前進 1 段 ${a.cur}→${b.cur}`); await settle();
      a = await st(p); await tap('#themeBtn'); await W(300); await replay('#themeBtn', mode); await W(150);
      b = await st(p); assert(b.theme !== a.theme, `深淺色：點一下＋detail 0 click（${mode}）只切換一次`); await settle();
      a = await st(p); await tap('label.ck:nth-of-type(1)'); await W(300); await replay(mode === 'el' ? '#optWs' : 'label.ck:nth-of-type(1)', mode); await W(150);
      b = await st(p); assert(b.ws !== a.ws, `忽略空白：點一下＋detail 0 click（${mode}）只切換一次`); await settle();
    }
    // the replay may not run something that sits under the finger on the new screen: clear then replay at 復原's spot
    await ev(p, () => scrollTo(0, 0));
    const before = (await st(p)).l; await tap('#clearBtn'); await W(300);
    await ev(p, () => { const b = document.querySelector('#toast button').getBoundingClientRect(); document.elementFromPoint(b.left + 5, b.top + 5).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); });
    await W(150); assert((await st(p)).l === '', '清空後的 detail 0 click 不會按到新出現的「復原」');
    await settle(); await tap('#toast button'); assert(await waitFor(p, l => document.getElementById('left').value === l, before), '「復原」單點仍可用');
    // a lone detail-0 click (keyboard / screen reader) acts once; Enter right after a tap acts too
    await settle();
    let a = await st(p); await ev(p, () => document.getElementById('nextBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await st(p)).cur === (a.cur + 1) % 30, '單獨的 detail 0 click（鍵盤）作用一次');
    await tap('#nextBtn'); await W(100); a = await st(p);
    await p.focus('#nextBtn'); await p.keyboard.press('Enter'); await W(150);
    assert((await st(p)).cur === (a.cur + 1) % 30, '點擊後馬上按 Enter 仍作用一次');
    await ctx.close();
  }

  // ---------- 4. 有變更時相似度不顯示 100% ----------
  {
    const { ctx, p } = await open();
    for (const [l, r] of [['a\nb', 'a\nb\n'], ['\tx\n\n\ny', '\tx\n\ny'], ['a', 'a\n\n']]) {
      const o = await ev(p, ([l, r]) => { document.getElementById('left').value = l; document.getElementById('right').value = r; __td.run(); return { add: +document.getElementById('sAdd').textContent, del: +document.getElementById('sDel').textContent, sim: document.getElementById('sSim').textContent }; }, [l, r]);
      assert(o.add + o.del > 0 && o.sim !== '100.0%', `${JSON.stringify(l)} 對 ${JSON.stringify(r)}：新增 ${o.add} 刪除 ${o.del} 相似度 ${o.sim}`);
    }
    const same = await ev(p, () => { document.getElementById('left').value = 'x\ny'; document.getElementById('right').value = 'x\ny'; __td.run(); return document.getElementById('sSim').textContent; });
    assert(same === '100.0%', '完全相同仍是 100.0%');
    await ctx.close();
  }

  // ---------- 5. 超過 500KB 不儲存時，不留下那一側的舊存檔 ----------
  {
    const { ctx, p } = await open();
    await ev(p, () => { const l = document.getElementById('left'), r = document.getElementById('right'); l.value = 'OLD 原文'; r.value = '右邊'; l.dispatchEvent(new Event('input')); });
    await waitFor(p, k => localStorage.getItem(k + 'left') === JSON.stringify('OLD 原文'), K);
    await ev(p, () => { const l = document.getElementById('left'); l.value = 'x'.repeat(600 * 1024); l.dispatchEvent(new Event('input')); });
    assert(await waitFor(p, k => localStorage.getItem(k + 'left') === null, K), '超過 500KB 時清掉原文的舊存檔');
    await p.reload(); await p.waitForFunction(() => window.__tdReady);
    const s = await st(p);
    assert(s.l === '' && await ev(p, () => document.getElementById('right').value) === '右邊', '重新整理後原文不是舊文字，修改後還在');
    assert(await waitFor(p, () => /超過 500KB/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').hidden), '重新整理後告知原文太大沒有儲存');
    await ev(p, () => { const l = document.getElementById('left'); l.value = '新的'; l.dispatchEvent(new Event('input')); });
    assert(await waitFor(p, k => localStorage.getItem(k + 'left') === JSON.stringify('新的') && localStorage.getItem(k + 'big') === null, K), '改回小文字後正常儲存並清掉標記');
    await ctx.close();
  }

  // ---------- 6. 淺色行號與頁尾對比 ≥ 4.5 ----------
  for (const dark of [false, true]) {
    const { ctx, p } = await open({ dark });
    const r = await ev(p, () => {
      const rgb = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = c => { const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const cr = (a, b) => { const x = lum(rgb(a)), y = lum(rgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const n = document.querySelector('.r .n'), f = document.querySelector('footer');
      return { n: cr(getComputedStyle(n).color, getComputedStyle(n).backgroundColor), f: cr(getComputedStyle(f).color, getComputedStyle(document.body).backgroundColor) };
    });
    assert(r.n >= 4.5 && r.f >= 4.5, `${dark ? '深' : '淺'}色：行號 ${r.n.toFixed(2)}:1、頁尾 ${r.f.toFixed(2)}:1 ≥ 4.5`);
    await ctx.close();
  }

  // ---------- 7. 360x640：第一屏看得到結果摘要；固定導覽列不蓋住選項與「比對」 ----------
  {
    const { ctx, p, tap } = await open({ w: 360, h: 640 });
    await W(200);
    const r = await ev(p, () => {
      const s = document.getElementById('sum').getBoundingClientRect();
      const covered = [...document.querySelectorAll('.opts button, .opts label')].filter(el => { const b = el.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !h || !el.contains(h); }).map(el => el.textContent);
      return { sumBottom: s.bottom, H: innerHeight, covered };
    });
    assert(r.sumBottom <= r.H, `捲到頂端時結果摘要在第一屏內（底 ${Math.round(r.sumBottom)} ≤ ${r.H}）`);
    assert(r.covered.length === 0, '捲到頂端時選項和「比對」沒被蓋住 ' + JSON.stringify(r.covered));
    await tap('#runBtn');
    assert(await waitFor(p, () => { const s = document.getElementById('sum').getBoundingClientRect(); return s.top >= 0 && s.top < innerHeight * 0.3; }), '點「比對」後結果捲到畫面上方');
    assert(await waitFor(p, () => { const n = document.querySelector('.nav').getBoundingClientRect(); return n.top >= 0 && n.bottom <= innerHeight; }), '捲到結果後導覽列浮在畫面下方');
    await ctx.close();
  }

  // ---------- 8. 驗證存檔的 opts 與文字 ----------
  {
    const bad = await open({ init: [k => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem(k + 'opts', '{"gran":"zzz","view":5,"ws":"yes"}'); localStorage.setItem(k + 'left', '{"a":1}'); localStorage.setItem(k + 'right', '"右"'); } }, K] });
    const s = await st(bad.p);
    assert(s.gran === 'char' && s.view === 'inline' && s.ws === false, '壞 opts 改用預設（字元、整合）');
    assert(!/object Object/.test(s.l) && s.l === '', '壞的原文存檔不顯示 [object Object]');
    await bad.ctx.close();
    const good = await open({ init: [k => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem(k + 'opts', '{"gran":"word","ws":true,"cs":false,"punct":true,"view":"side"}'); localStorage.setItem(k + 'left', '"舊原文"'); localStorage.setItem(k + 'right', '"舊修改"'); localStorage.setItem(k + 'theme', '"dark"'); } }, K] });
    const g = await st(good.p);
    assert(g.gran === 'word' && g.view === 'side' && g.ws === true && g.l === '舊原文' && g.theme === 'dark', '既有的 localStorage 鍵照常載入');
    await good.ctx.close();
  }

  // ---------- 9. 開啟忽略選項時，統一 diff 的未變更行取自原文 ----------
  {
    const { ctx, p } = await open();
    const u = await ev(p, () => { document.getElementById('left').value = 'a  b\nx\n'; document.getElementById('right').value = 'a b\ny\n'; if (!document.getElementById('optWs').checked) document.getElementById('optWs').click(); __td.run(); return __td.unified(); });
    assert(u.includes('\n a  b\n') && !u.includes('\n a b\n') && u.includes('\n-x\n+y\n'), '忽略空白時上下文用原文的「a  b」');
    await ctx.close();
  }

  // ---------- 10. 導覽列和摘要的單位有標示 ----------
  {
    const { ctx, p, tap } = await open();
    const t = await ev(p, () => ({ cnt: document.getElementById('navCnt').textContent, next: document.getElementById('nextBtn').textContent, prev: document.getElementById('prevBtn').textContent, add: document.querySelector('.sum .ad span').textContent }));
    assert(/段$/.test(t.cnt) && /段/.test(t.next) && /段/.test(t.prev) && /處/.test(t.add), `導覽列以「段」計（${t.cnt}／${t.next}），摘要以「處」計（${t.add}）`);
    await tap('#nextBtn'); assert(await waitFor(p, () => /^1 \/ \d+ 段$/.test(document.getElementById('navCnt').textContent)), '點下一段後顯示「1 / N 段」');
    await ctx.close();
  }

  // ---------- r2-1. 一段變更超過 4 萬字也照字元／詞比對，相似度與處數正確 ----------
  {
    const { ctx, p } = await open();
    const cases = {
      'a×19999+b 對 a×20000': ['a'.repeat(19999) + 'b', 'a'.repeat(20000), ['char']],
      '300 行×70 字各改 1 字': (() => { const a = [], b = []; for (let i = 0; i < 300; i++) { const s = ('第' + i + '行 ').padEnd(70, '文'); a.push(s); b.push(s.slice(0, 69) + '字'); } return [a.join('\n'), b.join('\n'), ['char', 'word']]; })(),
      '2.5 萬字中文段落改 1 字': (() => { const s = '我們在這裡測試一段很長的中文段落沒有換行'.repeat(1250); return [s, s.slice(0, 12000) + '改' + s.slice(12001), ['char', 'word']]; })(),
    };
    for (const [n, [l, r, grans]] of Object.entries(cases)) for (const gran of grans) {
      await ev(p, ([l, r, gran]) => { document.getElementById('left').value = l; document.getElementById('right').value = r; document.querySelector(`[data-g="${gran}"]`).click(); __td.run(); }, [l, r, gran]);
      await waitFor(p, () => document.getElementById('busy').hidden, null, 30000);
      const o = await ev(p, () => ({ sim: document.getElementById('sSim').textContent, add: __td.R.adds, del: __td.R.dels, notes: document.getElementById('notes').textContent, marks: document.querySelectorAll('#result del, #result ins').length, segs: __td.R.blocks.filter(b => b.segs).length }));
      const lines = n.startsWith('300') ? 300 : 1;
      assert(o.segs === 1 && parseFloat(o.sim) >= 98 && o.add === lines && o.del === lines && o.notes === '' && o.marks === 2 * lines, `${n}（${gran}）：相似度 ${o.sim}、新增 ${o.add}／刪除 ${o.del}、標記 ${o.marks}`);
    }
    // an honest fallback: totally different 49k-char lines say so and show the similarity as a lower bound
    await ev(p, () => { let a = '', b = ''; for (let i = 0; i < 49000; i++) { a += String.fromCharCode(97 + (i * 7 % 26)); b += String.fromCharCode(97 + (i * 11 % 23)); } document.getElementById('left').value = a; document.getElementById('right').value = b; document.querySelector('[data-g="char"]').click(); __td.run(); });
    await waitFor(p, () => document.getElementById('busy').hidden, null, 60000);
    const f = await ev(p, () => ({ sim: document.getElementById('sSim').textContent, notes: document.getElementById('notes').textContent }));
    assert(/^≥/.test(f.sim) && /太大/.test(f.notes), `無法細比時畫面說明（${f.notes}）且相似度標為下限 ${f.sim}`);
    await ctx.close();
  }

  // ---------- r2-2. 主執行緒比對長段落在 100 ms 內 ----------
  {
    const { ctx, p } = await open();
    for (const [n, src] of [['1.9 萬字中文段落改 1 字', () => { const s = '我們在這裡測試一段很長的中文段落沒有換行'.repeat(950); return [s, s.slice(0, 9000) + '改' + s.slice(9001)]; }], ['19999 個 a', () => ['a'.repeat(19998) + 'b', 'a'.repeat(19999)]]]) {
      const ms = await ev(p, src2 => { const [l, r] = eval('(' + src2 + ')')(); document.getElementById('left').value = l; document.getElementById('right').value = r; let best = 1e9; for (let i = 0; i < 3; i++) { const t = performance.now(); __td.run(); best = Math.min(best, performance.now() - t); } return Math.round(best); }, src.toString());
      assert(ms < 100, `${n}：run() 在主執行緒 ${ms} ms < 100`);
    }
    await ctx.close();
  }

  // ---------- r2-3. 導覽列不蓋住摘要與任何按鈕 ----------
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const { ctx, p } = await open({ w, h });
    await ev(p, MANY);
    const bad = [];
    const maxY = await ev(p, () => document.documentElement.scrollHeight - innerHeight);
    for (let y = 0; y <= maxY; y += y < 400 ? 20 : 120) {
      const hit = await ev(p, y => {
        scrollTo(0, y);
        const n = document.querySelector('.nav').getBoundingClientRect();
        if (n.bottom <= 0 || n.top >= innerHeight) return [];
        const over = el => { const b = el.getBoundingClientRect(); return b.width && b.right > n.left && b.left < n.right && b.bottom > n.top && b.top < n.bottom; };
        return [...document.querySelectorAll('#sum, header button, .io-head button, .opts button, .opts label, .rbar button, textarea')].filter(over).map(el => el.id || el.textContent.trim().slice(0, 8));
      }, y);
      if (hit.length) bad.push(y + ':' + hit.join('/'));
    }
    assert(bad.length === 0, `${w}x${h} 任何捲動位置導覽列都不蓋住摘要或按鈕 ${bad.slice(0, 4).join(' ')}`);
    await ctx.close();
  }

  // ---------- r2-4. 粒度有說明 ----------
  {
    const { ctx, p, tap } = await open();
    const titles = await ev(p, () => [...document.querySelectorAll('[data-g]')].map(b => b.title));
    assert(titles.every(t => t.length > 4), '字元／詞／行按鈕有說明 ' + titles.join('｜'));
    await tap('#granWord'); assert(await waitFor(p, () => /^詞：/.test(document.getElementById('toast').textContent)), '點「詞」顯示簡短說明');
    await ctx.close();
  }

  // ---------- r2-5. 連續開兩個檔案只比對一次 ----------
  {
    const { ctx, p, tap } = await open();
    await W(500); const n0 = await ev(p, () => __td.runs);
    for (const [btn, txt] of [['#openL', '左邊檔案\n一\n'], ['#openR', '右邊檔案\n二\n']]) {
      const fc = p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await tap(btn); const ch = await fc;
      if (ch) await ch.setFiles({ name: 'f.txt', mimeType: 'text/plain', buffer: Buffer.from(txt) });
      await W(120);
    }
    await waitFor(p, () => document.getElementById('right').value.startsWith('右邊'));
    await W(900);
    const runs = (await ev(p, () => __td.runs)) - n0;
    assert(runs === 1 && await ev(p, () => __td.R.right.startsWith('右邊') && __td.R.left.startsWith('左邊')), `連續開兩個檔案只比對 1 次（${runs}）且結果是兩個新檔`);
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 page/console error ' + errors.slice(0, 3).join(' | '));
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
