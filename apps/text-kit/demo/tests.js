// 文字工具箱：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
// 頁面用本機 http 伺服器提供（重新整理後 localStorage / IndexedDB 要留著）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = path.resolve(__dirname, '../index.html');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const KEY = 'text-kit:v1:';
const LT = () => { window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {} };

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  async function open(w = 390, h = 844, init, initArg) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(LT);
    if (init) await ctx.addInitScript(init, initArg);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__tkReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const ev = (fn, a) => p.evaluate(fn, a);
    const center = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
    const show = async sel => { await ev(s => { const e = document.querySelector(s), r = e.getBoundingClientRect(); if (r.top < 70 || r.bottom > innerHeight - 140) e.scrollIntoView({ block: 'center' }); }, sel); await sleep(120); };
    const tap = async (sel, hold = 40) => { await show(sel); const c = await center(sel); await touch('touchStart', [c]); await sleep(hold); await touch('touchEnd', [c]); await sleep(60); return c; };
    const waitFor = (fn, a, ms = 5000) => p.waitForFunction(fn, a, { timeout: ms }).then(() => true, () => false);
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.__tkReady); };
    const st = () => ev(() => ({ steps: steps.length, theme: document.documentElement.dataset.theme || 'auto', more: !document.getElementById('statsMore').hidden, fr: !document.getElementById('frPanel').hidden }));
    const setText = t => ev(t => { const i = document.getElementById('input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); steps = []; recompute(); }, t);
    return { ctx, p, touch, ev, center, show, tap, waitFor, reload, st, setText };
  }

  // ---------- 1. [嚴重] 觸控：另一指放著、兩指重疊、按住 ----------
  {
    const o = await open();
    await o.setText('hello world\nfoo bar\nfoo bar\n后来'); await sleep(200);
    for (const sel of ['.op[data-op="upper"]', '.op[data-op="trim"]', '#themeBtn', '#stats']) {
      await o.ev(() => { steps = []; recompute(); }); await o.show(sel);
      const a = await o.st(); const q = [...await o.center(sel), 1], R = [20, 400, 2];
      await o.touch('touchStart', [R]); await sleep(100); await o.touch('touchStart', [R, q]); await sleep(60); await o.touch('touchEnd', [q]); await sleep(150); await o.touch('touchEnd', [R]); await sleep(300);
      const b = await o.st();
      const want = sel.includes('upper') || sel.includes('trim') ? b.steps === a.steps + 1 && b.more === a.more : sel === '#themeBtn' ? b.theme !== a.theme : b.more !== a.more;
      assert(want, `另一指放在 (20,400) 時點 ${sel} 只執行一次，放著的手指不觸發 ${JSON.stringify([a, b])}`);
      if (sel === '#stats' && b.more) await o.ev(() => document.getElementById('stats').click());
      await sleep(850);
    }
    for (const order of ['firstUpFirst', 'secondUpFirst']) {
      await o.ev(() => { steps = []; recompute(); }); await o.show('.op[data-op="upper"]');
      const F1 = [...await o.center('.op[data-op="upper"]'), 1], F2 = [...await o.center('.op[data-op="trim"]'), 2];
      await o.touch('touchStart', [F1]); await sleep(50); await o.touch('touchStart', [F1, F2]); await sleep(60);
      if (order === 'firstUpFirst') { await o.touch('touchEnd', [F1]); await sleep(40); await o.touch('touchEnd', [F2]); } else { await o.touch('touchEnd', [F2]); await sleep(40); await o.touch('touchEnd', [F1]); }
      await sleep(300);
      const ops = await o.ev(() => steps.map(s => s.op).sort().join(','));
      assert(ops === 'trim,upper', `相隔 50ms 兩指點「英文大寫」「去行首尾空白」（${order}）兩個都加入：${ops}`);
      await sleep(850);
    }
    for (const hold of [40, 600, 1000]) {
      await o.ev(() => { steps = []; recompute(); });
      await o.tap('.op[data-op="lower"]', hold); await sleep(900);
      assert((await o.st()).steps === 1, `按住 ${hold}ms 點「英文小寫」只加一步`);
    }
    // a tap that opens the history dialog does not fire anything in it; the backdrop tap over the textarea does not focus it
    await o.ev(() => { steps = []; recompute(); scrollTo(0, 0); }); await sleep(200);
    await o.tap('#histBtn'); await sleep(900);
    assert(await o.ev(() => !!document.querySelector('.dlg')), '點「歷史」開啟對話框，下面的項目沒有被同一下點到');
    const ib = await o.center('#input'); await o.touch('touchStart', [ib]); await sleep(40); await o.touch('touchEnd', [ib]); await sleep(400);
    assert(await o.ev(() => !document.querySelector('.dlg') && document.activeElement.id !== 'input'), '點對話框外關閉，不會順便聚焦底下的輸入框');
    await o.ctx.close();
  }

  // ---------- 2. [嚴重] 真實點擊後補 detail-0 click 不重複執行 ----------
  {
    const o = await open();
    await o.setText('hello world'); await sleep(200);
    const d0 = (sel, where) => o.ev(([sel, where]) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      const x = where === 'edge' ? r.right - 1 : r.left + r.width / 2, y = where === 'edge' ? r.bottom - 1 : r.top + r.height / 2;
      const t = where === 'point' ? document.elementFromPoint(x, y) : el;
      t && t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window, clientX: x, clientY: y }));
    }, [sel, where]);
    for (const sel of ['.op[data-op="upper"]', '#themeBtn', '#stats']) {
      await o.ev(() => { steps = []; recompute(); }); await sleep(100);
      const a = await o.st(); await o.tap(sel); await sleep(150);
      for (const w of ['self', 'edge', 'point']) await d0(sel, w);
      await sleep(200); const b = await o.st();
      const ok = sel.includes('upper') ? b.steps === a.steps + 1 : sel === '#themeBtn' ? b.theme !== a.theme : b.more !== a.more;
      assert(ok, `點 ${sel} 後再 dispatch detail-0 click（控制項、邊緣、手指下）只執行一次 ${JSON.stringify([a, b])}`);
      await sleep(900);
      if (sel === '#stats') { await d0(sel, 'self'); await sleep(100); assert((await o.st()).more === a.more, '沒有點擊在前的單獨 detail-0 click（鍵盤）執行一次'); }
    }
    await o.ctx.close();
  }

  // ---------- 3. [嚴重] 壞掉的存檔不會讓操作失效 ----------
  {
    const bad = ['{}', '123', '"str"', '[null]', '[{"t":"x"}]', '[{"text":5}]', 'not json', '[{"t":1,"text":"ok"},7]'];
    for (const h of bad) {
      const o = await open(390, 844, ([K, h]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem(K + 'history', h); localStorage.setItem(K + 'prefs', h); localStorage.setItem(K + 'theme', h); localStorage.setItem(K + 'chain', h); localStorage.setItem(K + 'input', h === '"str"' ? h : '5'); localStorage.setItem(K + 'inputBig', h); } }, [KEY, h]);
      const n0 = errors.length;
      await o.setText('abc def'); await sleep(100);
      await o.tap('.op[data-op="upper"]'); await sleep(200);
      await o.tap('#histBtn'); await sleep(300);
      const r = await o.ev(() => ({ steps: steps.length, out: __out(), items: document.querySelectorAll('#hList li button').length }));
      assert(errors.length === n0 && r.steps === 1 && r.out === 'ABC DEF', `history/prefs/theme/chain=${h}：沒有錯誤，操作照常 ${JSON.stringify(r)}`);
      await o.ctx.close();
    }
  }

  // ---------- 4. [嚴重] 超過 1MB 的輸入重新整理後還在（IndexedDB） ----------
  {
    const o = await open();
    const big = await o.ev(() => { let s = ''; const b = '這是一段很長的測試文字 with some English 123。\n'; while (s.length < 1.44e6) s += b; return s.length; });
    await o.ev(() => { let s = ''; const b = '這是一段很長的測試文字 with some English 123。\n'; while (s.length < 1.44e6) s += b; const i = document.getElementById('input'); i.value = s; i.dispatchEvent(new Event('input', { bubbles: true })); });
    assert(await o.waitFor(K => !!localStorage.getItem(K + 'inputBig'), KEY), '1.44MB 輸入存進 IndexedDB');
    await o.reload();
    const r = await o.ev(() => ({ n: document.getElementById('input').value.length, sample: document.getElementById('input').value.startsWith('【範例') }));
    assert(r.n === big && !r.sample, `重新整理後 1.44MB 輸入還在、不是範例 ${JSON.stringify(r)}`);
    // back to a small text: localStorage again, IndexedDB copy dropped
    await o.setText('small'); await sleep(700); await o.reload();
    assert(await o.ev(K => document.getElementById('input').value === 'small' && !localStorage.getItem(K + 'inputBig'), KEY), '改回小段文字後重新整理是小段文字');
    await o.ctx.close();
    // IndexedDB missing: a clear notice, and never the sample
    const o2 = await open(390, 844, K => { try { Object.defineProperty(window, 'indexedDB', { value: undefined }); } catch (e) {} if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem(K + 'input', '"previous"'); } }, KEY);
    await o2.ev(() => { const i = document.getElementById('input'); i.value = 'x'.repeat(1.2e6); i.dispatchEvent(new Event('input', { bubbles: true })); });
    assert(await o2.waitFor(() => !document.getElementById('saveHint').hidden && /不會保留/.test(document.getElementById('saveHint').textContent)), '無法存檔時明確提示「重新整理後不會保留」');
    await o2.reload();
    assert(await o2.ev(() => !document.getElementById('input').value.startsWith('【範例')), '無法存檔的大段文字重新整理後不會變成範例');
    await o2.ctx.close();
  }

  // ---------- 5–11. 純函式：Unicode 字母、英文詞、正規 m 旗標與 \- ----------
  {
    const o = await open();
    const r = await o.ev(() => {
      const K = __K, O = K.OPS;
      return {
        title: O.title('élan vital ÉCOLE naïve', {}), sent: O.sentence('hello. élan est là. i am', {}),
        w1: K.stats('café naïve').words, w2: K.stats('123 4,5 2026').words, w3: K.stats('iPhone 15 用iPhone拍').words,
        m1: O.replace('a\nb\nc', { find: '^', repl: '> ', regex: true, ml: true }), m0: O.replace('a\nb', { find: '^', repl: '> ', regex: true, ml: false }),
        dash: O.replace('a-b', { find: 'a\\-b', repl: 'X', regex: true }), emoji: O.replace('😀a😀', { find: '.', repl: '*', regex: true, cs: true }),
        lit: O.replace('a.b.c', { find: '.', repl: '-', regex: false }),
        s2t: K.s2t('后来发现这个软件很好用，头发也不再那么干燥', true), s2tP: K.s2t('软件', false), t2s: K.t2s('頭髮'),
      };
    });
    assert(r.title === 'Élan Vital École Naïve', '每字首大寫認得重音字母：' + r.title);
    assert(r.sent === 'Hello. Élan est là. I am', '句首大寫認得重音字母：' + r.sent);
    assert(r.w1 === 2, 'café naïve 算 2 個英文詞：' + r.w1);
    assert(r.w2 === 0, '數字不算英文詞：' + r.w2);
    assert(r.w3 === 2, 'iPhone 15 用iPhone拍 算 2 個英文詞：' + r.w3);
    assert(r.m1 === '> a\n> b\n> c' && r.m0 === '> a\nb', '正規模式的多行（m）選項：' + JSON.stringify([r.m1, r.m0]));
    assert(r.dash === 'X', '正規模式接受 \\-');
    assert(r.emoji === '***', '正規模式仍以 Unicode 字元比對（emoji 是一個字）');
    assert(r.lit === 'a-b-c', '一般模式照字面取代');
    assert(r.s2t === '後來發現這個軟體很好用，頭髮也不再那麼乾燥' && r.s2tP === '軟件' && r.t2s === '头发', '繁簡轉換（最長詞組比對）結果不變');
    await o.ctx.close();
  }

  // ---------- 6. 改選項會更新處理鏈中的步驟並說明 ----------
  {
    const o = await open();
    await o.setText('这个软件'); await sleep(100);
    await o.tap('.op[data-op="s2t"]'); await sleep(200);
    const a = await o.ev(() => [__out(), document.getElementById('chain').textContent]);
    await o.tap('label:has(#optTw)'); await sleep(300);
    const b = await o.ev(() => [__out(), document.getElementById('chain').textContent, document.getElementById('optTw').checked, document.getElementById('toastHost').textContent]);
    assert(a[0] === '這個軟體' && /台灣用語/.test(a[1]), '步驟標示自己的選項（台灣用語）：' + a[1]);
    assert(b[0] === '這個軟件' && /不換用語/.test(b[1]) && !b[2] && /已更新處理鏈/.test(b[3]), '取消「台灣用語」後既有的簡→繁步驟跟著更新並提示：' + JSON.stringify(b));
    await o.setText('b\na\n筆\n中'); await o.tap('.op[data-op="sortAsc"]'); await sleep(200);
    await o.p.selectOption('#optColl', 'zh'); await sleep(300);
    assert(await o.ev(() => /拼音/.test(document.getElementById('chain').textContent) && steps[0].o.coll === 'zh'), '改「排序依」後既有排序步驟改用新排序並標示');
    await o.ctx.close();
  }

  // ---------- 7. 手機上點操作後不用捲動就看得到結果 ----------
  {
    const o = await open();
    await o.setText('hello world\nsecond line'); await sleep(100);
    await o.tap('.op[data-op="upper"]'); await sleep(300);
    const r = await o.ev(() => { const j = document.getElementById('jump'), b = j.getBoundingClientRect(); return { shown: !j.hidden, inView: b.top >= 0 && b.bottom <= innerHeight, prev: document.getElementById('jumpPrev').textContent }; });
    assert(r.shown && r.inView && r.prev === 'HELLO WORLD\nSECOND LINE', '點操作後畫面底部固定顯示結果預覽：' + JSON.stringify(r));
    await o.tap('#jumpBtn'); await sleep(900);
    assert(await o.ev(() => { const t = document.querySelector('.res').getBoundingClientRect().top; return t >= -2 && t < innerHeight / 2; }), '點「看結果」捲到結果區');
    await o.ctx.close();
    // landscape: the bar never covers the stats strip
    const l = await open(844, 390);
    for (const y of [0, 60, 120, 200]) {
      await l.ev(y => scrollTo(0, y), y); await sleep(200);
      const cov = await l.ev(() => { const j = document.getElementById('jump'); if (j.hidden) return false; const a = j.getBoundingClientRect(), b = document.getElementById('stats').getBoundingClientRect(); return a.top < b.bottom && a.bottom > b.top; });
      assert(!cov, `844x390 捲到 ${y}px：結果浮條不蓋住統計列`);
    }
    await l.ctx.close();
  }

  // ---------- 8 + 11. 處理鏈與結果重新整理後還在；清空後重新整理不回範例；舊存檔照常載入 ----------
  {
    const o = await open(390, 844, K => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem(K + 'input', JSON.stringify('Old Draft  ')); localStorage.setItem(K + 'prefs', JSON.stringify({ tw: false, alnum: true, dCase: true, dTrim: false, coll: 'zh' })); localStorage.setItem(K + 'theme', '"dark"'); localStorage.setItem(K + 'history', JSON.stringify([{ t: 1, text: 'old one' }])); } }, KEY);
    const legacy = await o.ev(() => ({ v: document.getElementById('input').value, tw: document.getElementById('optTw').checked, al: document.getElementById('optAlnum').checked, coll: document.getElementById('optColl').value, th: document.documentElement.dataset.theme, steps: steps.length }));
    assert(legacy.v === 'Old Draft  ' && !legacy.tw && legacy.al && legacy.coll === 'zh' && legacy.th === 'dark' && legacy.steps === 0, '舊版存檔（input/prefs/theme）照常載入 ' + JSON.stringify(legacy));
    await o.tap('.op[data-op="upper"]'); await o.tap('.op[data-op="trim"]'); await o.tap('.op[data-op="shuffle"]'); await sleep(200);
    const a = await o.ev(() => [steps.map(s => s.op).join(), __out(), document.getElementById('output').value]);
    await o.reload();
    const b = await o.ev(() => [steps.map(s => s.op).join(), __out(), document.getElementById('output').value]);
    assert(a[0] === 'upper,trim,shuffle' && JSON.stringify(a) === JSON.stringify(b), '處理鏈與結果重新整理後還在 ' + JSON.stringify(b));
    await o.tap('#clearBtn'); await sleep(300);
    assert(await o.ev(() => document.activeElement.id !== 'input'), '用手指點「清空」不會聚焦輸入框（不跳鍵盤）');
    await o.reload();
    assert(await o.ev(() => document.getElementById('input').value === '' && steps.length === 0), '清空後重新整理仍是空白，不會跑回範例');
    await o.ctx.close();
    const n = await open();
    assert(await n.ev(() => document.getElementById('input').value.startsWith('【範例') && steps.length === 1), '第一次開啟仍顯示範例並套用簡→繁');
    await n.ctx.close();
  }

  // ---------- 9 + 11. 觸控尺寸、符號字級、尋找與取代不跳鍵盤 ----------
  {
    const o = await open();
    const r = await o.ev(() => ({
      labs: [...document.querySelectorAll('.opts label, .fr .frow label')].map(e => Math.round(e.getBoundingClientRect().height)),
      sel: Math.round(document.getElementById('optColl').getBoundingClientRect().height),
      sig: Math.min(...[...document.querySelectorAll('.op .sig')].map(e => parseFloat(getComputedStyle(e).fontSize))),
    }));
    assert(r.labs.filter(h => h > 0).every(h => h >= 44) && r.sel >= 44, '勾選框與排序選單高度 ≥ 44px ' + JSON.stringify(r));
    assert(r.sig >= 13, '操作按鈕上的符號字級 ≥ 13px：' + r.sig);
    await o.tap('#frToggle'); await sleep(300);
    assert(await o.ev(() => !document.getElementById('frPanel').hidden && document.activeElement.id !== 'frFind'), '用手指點「尋找與取代」展開但不聚焦（不跳鍵盤）');
    await o.ctx.close();
  }

  // ---------- 10. 大段文字不卡主執行緒，有忙碌提示 ----------
  {
    const o = await open();
    await o.ev(() => { let s = ''; const b = '后来发现这个软件很好用，头发也不再那么干燥。用iPhone拍了3张照片\n'; while (s.length < 6e5) s += b; const i = document.getElementById('input'); i.value = s; i.dispatchEvent(new Event('input', { bubbles: true })); steps = []; recompute(); });
    await sleep(1500);
    await o.ev(() => { __lt.length = 0; });
    await o.show('.op[data-op="s2t"]');
    const c = await o.center('.op[data-op="s2t"]'); await o.touch('touchStart', [c]); await sleep(40); await o.touch('touchEnd', [c]);
    const busy = await o.waitFor(() => !document.getElementById('busy').hidden || !/處理中/.test(document.getElementById('jumpTxt').textContent) && steps.length === 1 && __out().length > 0, null, 2000);
    const sawBusy = await o.ev(() => !document.getElementById('busy').hidden);
    assert(await o.waitFor(() => steps.length === 1 && __out().startsWith('後來發現這個軟體'), null, 15000), '60 萬字簡→繁完成');
    await sleep(300);
    const lt = await o.ev(() => Math.max(0, ...__lt));
    assert(busy && lt < 160, `60 萬字簡→繁在背景執行（處理中提示 ${sawBusy}），主執行緒最長卡 ${lt}ms`);
    // 2M+ characters: the phrase scan stops early, so the worker finishes quickly
    const t = await o.ev(() => { let s = ''; const b = '后来发现这个软件很好用，头发也不再那么干燥。用iPhone拍了3张照片\n'; while (s.length < 1e6) s += b; const t0 = performance.now(); __K.s2t(s, true); return performance.now() - t0; });
    assert(t < 2500, `100 萬字簡→繁 ${Math.round(t)}ms`);
    await o.ctx.close();
  }

  assert(errors.length === 0, '整個測試沒有 page error / console error ' + errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(`${fails ? 'FAIL' : '通過'}：${fails} 項失敗（${Math.round((Date.now() - T0) / 1000)} 秒）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
