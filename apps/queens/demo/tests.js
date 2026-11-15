// 花園女王：上架評分 toFix 的回歸測試（node tests.js，約 40–70 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
// 頁面用本機 http 伺服器提供（重新整理後 localStorage 要留著）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();
const LEVELS = JSON.parse(fs.readFileSync(APP, 'utf8').match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const decodeSol = s => { const o = []; for (let i = 0; i < s.length; i += 2) o.push(parseInt(s.substr(i, 2), 36)); return o; };

// counts how often each button's onclick runs (the actions stay on onclick; the tap layer calls el.click())
const COUNT = () => {
  window.__runs = {};
  const wrap = () => document.querySelectorAll('button[id]').forEach(el => {
    if (el.__w || !el.onclick) return; const f = el.onclick; el.__w = 1;
    el.onclick = function (e) { __runs[el.id] = (__runs[el.id] || 0) + 1; return f.call(this, e); };
  });
  addEventListener('load', () => setTimeout(wrap, 0));
  window.__wrap = wrap;
  window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => __lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {}
};

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(fs.readFileSync(APP)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  async function open(w = 390, h = 844, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.addInitScript(COUNT);
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__game && window.__tap);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tapXY = async (x, y, hold = 60, id = 1) => { await touch('touchStart', [{ x, y, id }]); await sleep(hold); await touch('touchEnd', [{ x, y, id }]); };
    const box = sel => p.locator(sel).first().boundingBox();
    const tap = async (sel, hold = 60) => { const b = await box(sel); await tapXY(b.x + b.width / 2, b.y + b.height / 2, hold); await sleep(80); };
    const ev = (fn, a) => p.evaluate(fn, a);
    const st = () => ev(() => __game.state());
    const vis = id => ev(id => !document.getElementById(id).classList.contains('hidden'), id);
    const runs = () => ev(() => Object.assign({}, __runs));
    const reset = () => ev(() => { __wrap(); __runs = {}; });
    const waitFor = (fn, a, ms = 5000) => p.waitForFunction(fn, a, { timeout: ms }).then(() => true, () => false);
    const cellXY = async c => { const r = await ev(() => __game.rect()); return [r.x + (c % r.n + 0.5) * r.cs, r.y + (Math.floor(c / r.n) + 0.5) * r.cs]; };
    const tapCell = async (c, hold = 40) => { const [x, y] = await cellXY(c); await tapXY(x, y, hold); await sleep(30); };
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.__game && window.__tap); await sleep(50); };
    return { ctx, p, touch, tapXY, tap, box, ev, st, vis, runs, reset, waitFor, cellXY, tapCell, reload };
  }
  const gotoLevel = async (o, n) => {
    await o.ev(() => localStorage.setItem('queens.unlockAll', 'true')); await o.reload();
    await o.tap('#tSelect'); await o.waitFor(() => !document.getElementById('select').classList.contains('hidden'));
    await o.p.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(150);
    await o.tap('.lt[data-n="' + n + '"]'); await o.waitFor(n => __game.state().level === n, n);
    if (await o.vis('intro')) { await o.tap('#iOk'); await sleep(150); }
  };
  const d0 = (o, target) => o.ev(t => { const el = typeof t === 'string' ? document.querySelector(t) : document.elementFromPoint(t[0], t[1]); if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); return el ? el.id || el.className : null; }, target);

  // ---------- 1. [嚴重] detail-0 click after a real tap must not run the button twice ----------
  {
    const o = await open(); await o.reset();
    await o.tap('#tSet'); await o.waitFor(() => !document.getElementById('settings').classList.contains('hidden'));
    for (const delay of [0, 30, 300]) {
      const v0 = await o.ev(() => (JSON.parse(localStorage.getItem('queens.settings') || '{}').vib !== false));
      await o.reset();
      const b = await o.box('#sVib'), x = b.x + b.width / 2, y = b.y + b.height / 2;
      await o.tapXY(x, y, 50); await sleep(delay);
      await d0(o, '#sVib'); await d0(o, [b.x + 1, b.y + 1]); await d0(o, [x, y]); await sleep(100);
      const v1 = await o.ev(() => (JSON.parse(localStorage.getItem('queens.settings') || '{}').vib !== false));
      const r = await o.runs();
      assert(r.sVib === 1 && v0 !== v1, `點「震動」後 ${delay} ms 再送 detail 0 click（按鈕、邊緣、elementFromPoint）：只跑 1 次（${r.sVib}），開關確實翻轉`);
    }
    await sleep(900); await o.reset();
    { const v0 = await o.ev(() => (JSON.parse(localStorage.getItem('queens.settings') || '{}').vib !== false)); await d0(o, '#sVib'); await sleep(50); const v1 = await o.ev(() => (JSON.parse(localStorage.getItem('queens.settings') || '{}').vib !== false));
      assert((await o.runs()).sVib === 1 && v0 !== v1, '沒有點按時，單獨的 detail 0 click（鍵盤）照常作用 1 次'); }
    await o.tap('#setOk'); await sleep(900);
    // a tap that opens a new screen: the following detail-0 click at the same point must not press what is now under the finger
    await o.reset();
    const hb = await o.box('#tHelp'); const hp = [hb.x + hb.width / 2, hb.y + hb.height / 2];
    await o.tapXY(hp[0], hp[1], 50); await sleep(20); await d0(o, '#tHelp'); await d0(o, hp); await sleep(100);
    const r = await o.runs();
    assert(r.tHelp === 1 && !r.hOk && await o.vis('help'), `點「玩法說明」後的 detail 0 click：說明只開 1 次、新畫面的按鈕沒有被按（${JSON.stringify(r)}）`);
    await o.tap('#hOk'); await sleep(200);
    // keyboard: Enter on a focused button after a tap still works (lastKey > lastTapUp)
    await sleep(100); await o.reset(); await o.ev(() => document.getElementById('tHelp').focus()); await o.p.keyboard.press('Enter'); await sleep(100);
    assert((await o.runs()).tHelp === 1, '鍵盤 Enter 仍可按按鈕');
    await o.tap('#hOk');
    // holds: 0.6 s and 1 s on a button fire exactly once
    for (const hold of [600, 1000]) { await sleep(850); await o.reset(); await o.tap('#tHelp', hold); await sleep(100); const rr = await o.runs(); assert(rr.tHelp === 1, `按住 ${hold} ms 放開：觸發 1 次`); await o.tap('#hOk'); }
    // no :active transform on buttons
    const tf = await o.ev(() => { const out = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText && /:active/.test(r.selectorText) && /transform/.test(r.cssText)) out.push(r.selectorText); return out; });
    assert(tf.length === 0, '按鈕的 :active 不用 transform（不會縮小點擊範圍）' + (tf.length ? ' ' + tf.join(',') : ''));

    // ---------- 2. [嚴重] a tap while another finger rests on the screen ----------
    await sleep(900); await o.reset();
    const tt = await o.box('.ttl h1'); const rx = tt.x + 10, ry = tt.y + 10;
    await o.touch('touchStart', [{ x: rx, y: ry, id: 1 }]); await sleep(100);
    await o.touch('touchStart', [{ x: rx, y: ry, id: 1 }, { x: hp[0], y: hp[1], id: 2 }]); await sleep(60);
    await o.touch('touchEnd', [{ x: hp[0], y: hp[1], id: 2 }]); await sleep(80);
    await o.touch('touchEnd', [{ x: rx, y: ry, id: 1 }]); await sleep(150);
    assert(await o.vis('help') && (await o.runs()).tHelp === 1, '手指 1 按著標題，手指 2 點「玩法說明」：說明打開 1 次');
    await o.tap('#hOk'); await sleep(900);
    await o.tap('#tPlay'); await o.waitFor(() => __game.state().screen === 'game'); await sleep(200); await o.reset();
    await o.tapCell(0); await o.tapCell(6); await sleep(100);
    const g0 = await o.ev(() => __game.grid());
    const hl = await o.box('#hLevel'), ub = await o.box('#bUndo'), ux = ub.x + ub.width / 2, uy = ub.y + ub.height / 2;
    await o.touch('touchStart', [{ x: hl.x + 5, y: hl.y + 5, id: 1 }]); await sleep(100);
    await o.touch('touchStart', [{ x: hl.x + 5, y: hl.y + 5, id: 1 }, { x: ux, y: uy, id: 2 }]); await sleep(60);
    await o.touch('touchEnd', [{ x: ux, y: uy, id: 2 }]); await sleep(100);
    // still holding finger 1: a cell tap with finger 3 counts too
    const [cx, cy] = await o.cellXY(12);
    await o.touch('touchStart', [{ x: hl.x + 5, y: hl.y + 5, id: 1 }, { x: cx, y: cy, id: 3 }]); await sleep(60);
    await o.touch('touchEnd', [{ x: cx, y: cy, id: 3 }]); await sleep(80);
    await o.touch('touchEnd', [{ x: hl.x + 5, y: hl.y + 5, id: 1 }]); await sleep(150);
    const g1 = await o.ev(() => __game.grid());
    assert((await o.runs()).bUndo === 1 && g0[6] === 1 && g1[6] === 0 && g1[0] === 1 && g1[12] === 1, '手指 1 按著 HUD：手指 2 點「悔棋」跑 1 次、手指 3 點格子也有效');
    await o.ctx.close();
  }

  // ---------- 3. [中] the board in progress survives a reload ----------
  {
    const o = await open();
    await o.ev(() => { localStorage.setItem('queens.progress', JSON.stringify({ 1: { s: 3, t: 20 } })); }); await o.reload();
    await o.tap('#tPlay'); await o.waitFor(() => __game.state().screen === 'game');
    assert((await o.st()).level === 2, '開始遊戲進入第 2 關');
    for (const c of [0, 1, 7, 7]) await o.tapCell(c);
    await o.tap('#bHint'); await sleep(1300);
    const before = await o.ev(() => ({ g: __game.grid(), s: __game.state() }));
    await o.reload();
    assert(/繼續第 2 關/.test(await o.ev(() => document.getElementById('tPlay').textContent)), '重新整理後標題按鈕顯示「繼續第 2 關」');
    await o.tap('#tPlay'); await o.waitFor(() => __game.state().screen === 'game');
    const after = await o.ev(() => ({ g: __game.grid(), s: __game.state() }));
    assert(JSON.stringify(after.g) === JSON.stringify(before.g) && after.s.level === 2, '盤面（× 與女王）完整還原');
    assert(after.s.hints === before.s.hints && after.s.moves === before.s.moves && after.s.time >= before.s.time - 0.2 && after.s.time > 1, `提示次數、步數、時間都還原（時間 ${after.s.time.toFixed(1)} s）`);
    await o.tap('#bUndo'); await sleep(100);
    assert((await o.ev(() => __game.grid()))[7] === 1, '還原後悔棋紀錄也在');
    // restart clears the save
    await o.tap('#bMenu'); await o.tap('#pRestart'); await sleep(200); await o.reload();
    assert(/開始遊戲/.test(await o.ev(() => document.getElementById('tPlay').textContent)), '重新開始後不再提示接續');
    // random garden in progress: resumes from the 隨機花園 card
    await sleep(900); await o.tap('#tCustom'); await sleep(150); await o.tap('[data-n="6"]'); await o.waitFor(() => __game.state().screen === 'game');
    await o.tapCell(3); await o.tapCell(3); const cg = await o.ev(() => __game.grid());
    await o.reload(); await o.tap('#tCustom'); await sleep(150);
    assert(await o.vis('cResume'), '隨機花園卡片出現「繼續上一座」');
    await o.tap('#cResume'); await o.waitFor(() => __game.state().screen === 'game');
    assert(JSON.stringify(await o.ev(() => __game.grid())) === JSON.stringify(cg) && (await o.st()).mode === 'custom', '隨機花園盤面還原');
    // corrupt saves never break the page
    for (const bad of ['{', '[]', '{"level":{"mode":"level","level":"x"}}', '{"level":{"mode":"level","level":3,"st":"9"}}', '{"custom":{"mode":"custom","N":6,"K":1,"reg":"zz","sol":[1],"st":""}}']) {
      await o.ev(b => localStorage.setItem('queens.game', b), bad); await o.reload(); await o.tap('#tPlay'); const ok = await o.waitFor(() => __game.state().screen === 'game', null, 2000);
      assert(ok, '壞的 queens.game ' + bad.slice(0, 40) + ' → 開始遊戲照常');
    }
    await o.ctx.close();
  }

  // ---------- 4. [小] corrupt queens.last ----------
  {
    const o = await open();
    for (const bad of ['"x"', '3.5', '[1,2]', '{}', '0', '101', '-4', 'null', '"7"']) {
      await o.ev(b => { localStorage.setItem('queens.last', b); localStorage.removeItem('queens.game'); }, bad); await o.reload();
      await o.tap('#tPlay'); const ok = await o.waitFor(() => __game.state().screen === 'game', null, 2000);
      assert(ok && (await o.st()).level === 1, `queens.last = ${bad}：開始遊戲進入第 1 關`);
    }
    await o.ev(() => { localStorage.setItem('queens.last', '5'); localStorage.removeItem('queens.game'); }); await o.reload();
    await o.tap('#tPlay'); await o.waitFor(() => __game.state().screen === 'game');
    assert((await o.st()).level === 5, '合法的 queens.last = 5 照舊進第 5 關');
    await o.ctx.close();
  }

  // ---------- 5. [小] 12×12 cells: bigger fit, pinch zoom ----------
  // ---------- 6. [細節] landscape hint toast beside the board; 7. flower names with colours ----------
  {
    const o = await open(390, 844);
    await gotoLevel(o, 100);
    const r = await o.ev(() => __game.rect());
    assert(r.cs >= 30, `390×844 第 100 關格子 ${r.cs} px（原 29）`);
    // pinch: two fingers spread over the board
    const mx = r.x + r.cs * 6, my = r.y + r.cs * 6;
    await o.touch('touchStart', [{ x: mx - 30, y: my, id: 1 }]); await sleep(30);
    await o.touch('touchStart', [{ x: mx - 30, y: my, id: 1 }, { x: mx + 30, y: my, id: 2 }]); await sleep(30);
    for (let k = 1; k <= 8; k++) { await o.touch('touchMove', [{ x: mx - 30 - k * 10, y: my, id: 1 }, { x: mx + 30 + k * 10, y: my, id: 2 }]); await sleep(20); }
    await o.touch('touchEnd', [{ x: mx + 110, y: my, id: 2 }]); await sleep(30); await o.touch('touchEnd', [{ x: mx - 110, y: my, id: 1 }]); await sleep(120);
    const z = await o.ev(() => ({ r: __game.rect(), z: __game.zoom(), g: __game.grid() }));
    assert(z.z >= 2 && z.r.cs >= 60 && z.g.every(v => v === 0), `雙指捏開放大到 ${z.z.toFixed(2)} 倍（格子 ${z.r.cs} px），放大過程沒有誤打格子`);
    const target = 6 * 12 + 6; await o.tapCell(target); await sleep(80);
    assert((await o.ev(() => __game.grid()))[target] === 1, '放大後點格子，落在正確的格子');
    const r2 = z.r, m2x = r2.x + r2.cs * 6, m2y = r2.y + r2.cs * 6;
    await o.touch('touchStart', [{ x: m2x - 110, y: m2y, id: 1 }, { x: m2x + 110, y: m2y, id: 2 }]); await sleep(30);
    for (let k = 1; k <= 8; k++) { await o.touch('touchMove', [{ x: m2x - 110 + k * 11, y: m2y, id: 1 }, { x: m2x + 110 - k * 11, y: m2y, id: 2 }]); await sleep(20); }
    await o.touch('touchEnd', []); await sleep(120);
    assert((await o.ev(() => __game.zoom())) === 1 && (await o.ev(() => __game.rect())).cs === r.cs, '捏回去恢復原大小');
    // pause card shows every flower bed's colour and name
    await o.tap('#bMenu'); await sleep(150);
    const leg = await o.ev(() => ({ n: document.querySelectorAll('#pLegend .sws').length, t: document.getElementById('pLegend').textContent }));
    assert(leg.n === 12 && leg.t.length >= 24, `暫停選單列出 12 塊花圃的顏色與花名（${leg.t.slice(0, 24)}…）`);
    await o.ctx.close();
  }
  {
    const o = await open(844, 390);
    await gotoLevel(o, 100);
    const r = await o.ev(() => __game.rect());
    assert(r.cs >= 28, `844×390 第 100 關格子 ${r.cs} px（原 22）`);
    let overlap = 0;
    for (let k = 0; k < 3; k++) {
      await o.tap('#bHint'); await sleep(250);
      const t = await o.ev(() => { const b = document.getElementById('toast').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, sws: !!document.querySelector('#toast .sws'), txt: document.getElementById('toast').textContent }; });
      const pad = 6;
      if (!(t.x + t.w <= r.x - pad || t.x >= r.x + r.cs * 12 + pad || t.y + t.h <= r.y - pad || t.y >= r.y + r.cs * 12 + pad)) overlap++;
    }
    assert(overlap === 0, '橫式 844×390：提示框在棋盤旁邊，不蓋住棋盤');
    await o.ctx.close();
  }

  // ---------- 7b. hint names: a hint about a region shows that region's colour ----------
  {
    const o = await open(390, 844);
    // walk early levels: hint, then play one solution queen, until a hint names a flower bed
    let found = '';
    for (let n = 4; n <= 12 && !found; n++) {
      await gotoLevel(o, n);
      for (let k = 0; k < 3 && !found; k++) {
        await o.tap('#bHint'); await sleep(120);
        found = await o.ev(() => { const el = document.getElementById('toast'); const s = el.querySelector('.sws'); return s ? el.textContent + '|' + s.style.background : ''; });
        const sol = await o.ev(() => __game.sol()), g = await o.ev(() => __game.grid());
        const c = sol.find(i => g[i] !== 2); if (c == null) break;
        for (let t = 0; t < 2 && (await o.ev(() => __game.grid()))[c] !== 2; t++) await o.tapCell(c);
      }
    }
    assert(/花圃/.test(found) && /rgb/.test(found), '提示提到花圃時，花名旁有那塊花圃的顏色：' + found.slice(0, 50));
    await o.ctx.close();
  }

  // ---------- 8. [細節] 每日花園 streak and past days ----------
  {
    const day = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const o = await open();
    const rec = {}; for (const back of [1, 2, 4]) { const d = new Date(); d.setDate(d.getDate() - back); rec[day(d)] = 100 + back; }
    await o.ev(r => localStorage.setItem('queens.daily', JSON.stringify(r)), rec); await o.reload();
    assert(/連續 2 天/.test(await o.ev(() => document.getElementById('tDaily').textContent)), '標題「每日花園」顯示連續 2 天');
    await o.tap('#tDaily'); await o.waitFor(() => __game.state().screen === 'game' && __game.state().mode === 'daily', null, 8000);
    await o.tap('#bMenu'); await sleep(150);
    assert(await o.ev(() => !document.getElementById('pDays').classList.contains('hidden') && document.querySelectorAll('#pDays div').length === 7), '暫停選單列出最近 7 天的紀錄');
    await o.tap('#pResume'); await sleep(100);
    const sol = await o.ev(() => __game.sol());
    for (const c of sol) { await o.tapCell(c); await o.tapCell(c); }
    await o.waitFor(() => !document.getElementById('win').classList.contains('hidden'), null, 5000);
    const w = await o.ev(() => ({ msg: document.getElementById('wMsg').textContent, ok: document.querySelectorAll('#wDays div.ok').length, today: !!document.querySelector('#wDays div.today.ok') }));
    assert(/連續 3 天/.test(w.msg) && /最長 3 天/.test(w.msg) && w.ok === 4 && w.today, `過關卡顯示連續 3 天、最近 7 天 4 天有紀錄（${w.msg}）`);
    const kept = await o.ev(() => JSON.parse(localStorage.getItem('queens.daily')));
    assert(Object.keys(kept).length === 4 && Object.values(kept).every(v => typeof v === 'number'), 'queens.daily 格式不變（日期 → 最佳秒數），舊紀錄保留');
    await o.ctx.close();
  }

  // ---------- 9. [細節] difficulty claim ----------
  {
    const html = fs.readFileSync(APP, 'utf8');
    assert(!/每關都比上一關更難/.test(html), '說明不再宣稱「每關都比上一關更難」');
  }

  // ---------- 10. [細節] 10×10 random garden generation and the L100 win animation ----------
  {
    const o = await open();
    const gens = [];
    for (let k = 0; k < 2; k++) {
      await o.ev(() => { __lt.length = 0; });
      await o.tap('#tCustom'); await sleep(200);
      const t0 = Date.now(); await o.tap('[data-n="10"]');
      await o.waitFor(() => __game.state().screen === 'game', null, 30000);
      gens.push({ ms: Date.now() - t0, lt: await o.ev(() => __lt.slice()) });
      await o.tap('#bMenu'); await sleep(150); await o.tap('#pHome'); await sleep(200);
    }
    const worst = Math.max(0, ...gens.flatMap(g => g.lt));
    assert(worst <= 120, `隨機 10×10 雙星生成分段進行，最長卡頓 ${worst} ms（原 184–516 ms）；${gens.map(g => g.ms + ' ms').join('、')}`);
    await gotoLevel(o, 100);
    const sol = decodeSol(LEVELS[99][3]);
    for (const c of sol.slice(0, -1)) { await o.tapCell(c, 20); await o.tapCell(c, 20); }
    const last = sol[sol.length - 1]; await o.tapCell(last, 20);
    await o.ev(() => { window.__fts = []; const f = t => { __fts.push(t); if (__fts.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await o.tapCell(last, 20); await sleep(2500);
    const fps = await o.ev(() => { const a = __fts; return (a.length - 1) / ((a[a.length - 1] - a[0]) / 1000); });
    assert((await o.st()).status === 'won' && fps >= 40, `第 100 關過關花雨 ${fps.toFixed(1)} fps`);
    await o.ctx.close();
  }

  assert(errors.length === 0, '整個過程沒有 page error / console error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`${fails ? 'FAIL' : '全部通過'}：${fails} 項失敗（${Math.round((Date.now() - T0) / 1000)} s）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
