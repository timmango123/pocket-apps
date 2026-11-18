// 和紙數獨：上架複審 R1 修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) 觸控：另一指放在 HUD／畫面左緣時數字鍵、筆記照常；兩指重疊點「筆記」和「連填」兩種放開順序都各算一次；
//    點按後補送 detail 0 click（按鈕本身、邊緣、elementFromPoint）只算一次，數字不會被擦掉；換畫面的那一下不會點到新按鈕；
//    單獨的 detail 0 click 與 Enter 照常；棋盤格（pointerdown）與鍵盤數字照常
// 2) 壞存檔：progress／daily 有 null、cur 的 s 超出範圍、hl 不是數字、每日題目快取 0 個給定數字 → 沒有 page error，畫面照常
// 3) 直式提示條不蓋住盤面（360×640 第 91 關填錯第 1 列第 5 行後按提示）；橫式直接開和旋轉後盤面一樣大
// 4) 限錯挑戰：錯 3 次失敗、重新整理後仍是失敗、可改用一般模式繼續；預設一般模式不限錯
// 5) 連填／筆記和數字鍵分開（連填不在數字鍵盤內、工具列和數字鍵間距 ≥ 20px）；重新整理後還能悔棋；每日題目在 worker 生成（沒有長任務）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const BASE = { unlockAll: true, seen: [1, 16, 36, 56, 76, 91], settings: { sound: false, vib: false } };

(async () => {
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, store = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(st => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      for (const k in st) localStorage.setItem('sudoku.' + k, typeof st[k] === 'string' ? st[k] : JSON.stringify(st[k]));
    }, Object.assign({}, BASE, store));
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tapXY = async (x, y, hold = 40) => { await T('touchStart', [{ x, y, id: 9 }]); await sleep(hold); await T('touchEnd', [{ x, y, id: 9 }]); };
    const until = (fn, arg, timeout = 8000) => p.waitForFunction(fn, arg, { timeout });
    const load = async () => {
      await p.goto(URL); await until(() => window.__game);
      await p.evaluate(() => { window.__clicks = {}; document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); const k = b && (b.id || b.dataset.d); if (k) __clicks[k] = (__clicks[k] || 0) + 1; }, true); });
    };
    await load();
    const center = async sel => { const b = await p.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const visible = sel => until(s => { const e = document.querySelector(s); if (!e || e.disabled || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); if (!r.width) return false;
      const c = e.closest('.card'); return !(c && c.getAnimations().some(a => a.playState === 'running')); }, sel);
    const tap = async sel => { await visible(sel); const [x, y] = await center(sel); await tapXY(x, y); };
    const st = () => p.evaluate(() => Object.assign({}, __game.state(), __game.more()));
    const cellXY = async c => { const r = await p.evaluate(() => __game.geom()); const cs = r.size / 9; return [r.x + (c % 9 + 0.5) * cs, r.y + (Math.floor(c / 9) + 0.5) * cs]; };
    const tapCell = async c => { const [x, y] = await cellXY(c); await tapXY(x, y); await until(c => __game.state().sel === c, c); };
    const level = async n => { await p.evaluate(n => __game.start(n), n); await until(n => __game.screen() === 'game' && __game.state().n === n, n); };
    const empties = async () => { const s = await st(); return [...s.val].map((v, i) => v === '.' ? i : -1).filter(i => i >= 0); };
    const d0 = (x, y, sel) => p.evaluate(([x, y, sel]) => { const e = sel ? document.querySelector(sel) : document.elementFromPoint(x, y);
      if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); }, [x, y, sel]);
    const vis = id => p.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
    return { ctx, p, T, tapXY, until, load, center, tap, st, cellXY, tapCell, level, empties, d0, vis };
  }

  // ---------- 1. touch: resting finger, overlapping taps, detail-0 replay ----------
  {
    const t = await open();
    await t.level(1);
    let e = await t.empties(), s = await t.st();
    const [hx, hy] = await t.center('#hLevel');
    // finger 1 rests on the level name; finger 2 taps a cell, then the right number key
    const c1 = e[0], d1 = +s.sol[c1];
    await t.T('touchStart', [{ x: hx, y: hy, id: 1 }]); await sleep(150);
    const [cx, cy] = await t.cellXY(c1);
    await t.T('touchStart', [{ x: hx, y: hy, id: 1 }, { x: cx, y: cy, id: 2 }]); await sleep(50); await t.T('touchEnd', [{ x: cx, y: cy, id: 2 }]);
    await t.until(c => __game.state().sel === c, c1);
    const [kx, ky] = await t.center(`.key[data-d="${d1}"]`);
    await t.T('touchStart', [{ x: hx, y: hy, id: 1 }, { x: kx, y: ky, id: 3 }]); await sleep(50); await t.T('touchEnd', [{ x: kx, y: ky, id: 3 }]);
    await t.until(([c, d]) => __game.state().val[c] === String(d), [c1, d1]);
    const [nx, ny] = await t.center('#tNotes');
    await t.T('touchStart', [{ x: hx, y: hy, id: 1 }, { x: nx, y: ny, id: 4 }]); await sleep(50); await t.T('touchEnd', [{ x: nx, y: ny, id: 4 }]);
    await t.until(() => __game.more().notes === true);
    await t.T('touchEnd', [{ x: hx, y: hy, id: 1 }]);
    assert(true, '一指按住 #hLevel：另一指點格子、數字鍵填入正確數字、筆記切換，都照常');
    await t.tap('#tNotes'); await t.until(() => __game.more().notes === false);
    // finger resting on the left edge of the screen, 4 number-key taps
    let ok = 0;
    for (let k = 1; k <= 4; k++) {
      const c = e[k], d = +s.sol[c]; await t.tapCell(c);
      await t.T('touchStart', [{ x: 4, y: 600, id: 1 }]); await sleep(130);
      const [x, y] = await t.center(`.key[data-d="${d}"]`);
      await t.T('touchStart', [{ x: 4, y: 600, id: 1 }, { x, y, id: 2 }]); await sleep(50); await t.T('touchEnd', [{ x, y, id: 2 }]);
      try { await t.until(([c, d]) => __game.state().val[c] === String(d), [c, d], 2000); ok++; } catch (err) { }
      await t.T('touchEnd', [{ x: 4, y: 600, id: 1 }]);
    }
    eq(ok, 4, '一指放在畫面左緣：數字鍵 4/4 都填入');

    // overlapping taps on 筆記 and 連填, both lift orders: both act once
    for (const order of ['先按先放', '後按先放']) {
      const m0 = await t.st(); const [ax, ay] = await t.center('#tNotes'), [bx, by] = await t.center('#kLock');
      await t.T('touchStart', [{ x: ax, y: ay, id: 1 }]); await sleep(50);
      await t.T('touchStart', [{ x: ax, y: ay, id: 1 }, { x: bx, y: by, id: 2 }]); await sleep(60);
      if (order === '先按先放') { await t.T('touchEnd', [{ x: ax, y: ay, id: 1 }]); await sleep(30); await t.T('touchEnd', [{ x: bx, y: by, id: 2 }]); }
      else { await t.T('touchEnd', [{ x: bx, y: by, id: 2 }]); await sleep(30); await t.T('touchEnd', [{ x: ax, y: ay, id: 1 }]); }
      await t.until(([n, l]) => __game.more().notes === !n && __game.more().lock === !l, [m0.notes, m0.lock]);
      await sleep(250);
      const m1 = await t.st();
      eq([m1.notes !== m0.notes, m1.lock !== m0.lock], [true, true], `兩指重疊點「筆記」和「連填」（${order}）：兩個都切換一次`);
      await sleep(850);
    }
    // back to notes off, lock off
    if ((await t.st()).notes) { await t.tap('#tNotes'); await t.until(() => !__game.more().notes); await sleep(850); }
    if ((await t.st()).lock) { await t.tap('#kLock'); await t.until(() => !__game.more().lock); await sleep(850); }

    // detail-0 replay after a real tap on 筆記: the button itself, its edge point and elementFromPoint
    for (const [how, delay] of [['按鈕本身', 0], ['邊緣點', 30], ['elementFromPoint', 300]]) {
      const n0 = (await t.st()).notes, [x, y] = await t.center('#tNotes'), b = await t.p.locator('#tNotes').boundingBox();
      await t.tapXY(x, y); await t.until(n => __game.more().notes === !n, n0);
      await sleep(delay);
      if (how === '按鈕本身') await t.d0(x, y, '#tNotes'); else if (how === '邊緣點') await t.d0(b.x + 1, b.y + b.height - 1); else await t.d0(x, y);
      await sleep(200);
      eq((await t.st()).notes, !n0, `點「筆記」後補送 detail 0 click（${how}，${delay} ms 後）：只切換一次`);
      await sleep(850);
    }
    if ((await t.st()).notes) { await t.tap('#tNotes'); await t.until(() => !__game.more().notes); await sleep(850); }
    // number key + detail-0 replay: the digit stays
    e = await t.empties(); s = await t.st();
    const c2 = e[0], d2 = +s.sol[c2]; await t.tapCell(c2);
    const [k2x, k2y] = await t.center(`.key[data-d="${d2}"]`);
    await t.tapXY(k2x, k2y); await t.until(([c, d]) => __game.state().val[c] === String(d), [c2, d2]);
    await sleep(30); await t.d0(k2x, k2y, `.key[data-d="${d2}"]`); await sleep(30); await t.d0(k2x, k2y); await sleep(250);
    eq([(await t.st()).val[c2], (await t.st()).err], [String(d2), s.err], '點數字鍵後補送 detail 0 click：數字留著，沒有被擦掉或計錯');
    await sleep(850);
    // a lone detail-0 click (assistive tech) acts once; Enter on a focused button acts once
    const n1 = (await t.st()).notes; await t.d0(0, 0, '#tNotes'); await sleep(200);
    eq((await t.st()).notes, !n1, '單獨的 detail 0 click（前面沒有點按）：照常切換一次');
    await t.p.focus('#tNotes'); await t.p.keyboard.press('Enter'); await sleep(200);
    eq((await t.st()).notes, n1, '鍵盤 Enter：照常切換一次');
    await t.p.evaluate(() => document.activeElement.blur());
    // keyboard digits still work
    e = await t.empties(); s = await t.st(); await t.tapCell(e[0]); await t.p.keyboard.press(s.sol[e[0]]);
    await t.until(([c, d]) => __game.state().val[c] === d, [e[0], s.sol[e[0]]]);
    assert(true, '鍵盤數字鍵照常填入');
    await sleep(850);
    // a tap that opens the pause card: the follow-up click on the same point / on 繼續 does not act on the card
    const [mx, my] = await t.center('#bMenu');
    await t.tapXY(mx, my); await t.until(() => !document.getElementById('pause').classList.contains('hidden'));
    await t.d0(mx, my); await t.d0(mx, my, '#pResume'); await sleep(250);
    eq(await t.vis('pause'), true, '點選單打開暫停卡：補送的 click（同一點、#pResume）不會把卡片關掉');
    // a finger that went down before the card appeared does not press its buttons
    const [rx, ry] = await t.center('#pResume');
    await sleep(850); await t.tap('#pResume'); await t.until(() => document.getElementById('pause').classList.contains('hidden')); await sleep(850);
    await t.T('touchStart', [{ x: rx, y: ry, id: 5 }]); await sleep(40);
    await t.p.keyboard.press('Escape'); await t.until(() => !document.getElementById('pause').classList.contains('hidden'));
    await sleep(60); await t.T('touchEnd', [{ x: rx, y: ry, id: 5 }]); await sleep(250);
    eq(await t.vis('pause'), true, '手指在暫停卡出現前就按下：放開時不會按到卡片上的「繼續」');
    await sleep(850);
    await t.tap('#pResume'); await t.until(() => document.getElementById('pause').classList.contains('hidden'));
    // :active never moves or shrinks a button
    const tr = await t.p.evaluate(() => [...document.styleSheets].flatMap(ss => [...ss.cssRules]).filter(r => r.selectorText && /:active|\.press/.test(r.selectorText) && /transform/.test(r.cssText)).map(r => r.selectorText));
    eq(tr, [], '按下效果沒有 transform（不會縮小或移動按鈕的判定區）');
    // spacing: 連填 is not in the number pad and the tools row is ≥ 20 px from the keys; a tap just above a key hits nothing
    const geo = await t.p.evaluate(() => { const tb = document.querySelector('.tools').getBoundingClientRect(), k = document.querySelector('.key[data-d="1"]').getBoundingClientRect(), n = document.getElementById('tNotes').getBoundingClientRect();
      return { inPad: !!document.querySelector('#pad #kLock'), gap: k.top - n.bottom, keys: document.querySelectorAll('#pad .key').length }; });
    assert(!geo.inPad && geo.keys === 9 && geo.gap >= 20, `連填移到工具列，數字鍵盤只有 9 個數字；筆記鍵和數字鍵相距 ${geo.gap.toFixed(0)}px`);
    const m2 = await t.st(), k4 = await t.p.locator('.key[data-d="4"]').boundingBox();
    await t.tapXY(k4.x + k4.width / 2, k4.y - 8); await sleep(250);
    const m3 = await t.st(); eq([m3.notes, m3.lock], [m2.notes, m2.lock], '點在數字鍵上緣外 8px：不會誤觸筆記或連填');
    await t.tap('#kLock'); await t.until(() => __game.more().lock);
    const lk = await t.p.evaluate(() => ({ st: document.getElementById('lockSt').textContent, pad: document.getElementById('pad').classList.contains('lock'), toast: document.getElementById('toast').textContent }));
    assert(lk.st === '開' && lk.pad && /再按「連填」關閉/.test(lk.toast), '連填開啟時：按鍵寫「連填 開」、數字鍵加紅框、提示怎麼關閉');
    await sleep(850); await t.tap('#kLock'); await t.until(() => !__game.more().lock);
    await t.ctx.close();
  }

  // ---------- 2. corrupt storage ----------
  {
    const e0 = errors.length;
    const t = await open(390, 844, { progress: '{"1":null,"2":5,"3":{"s":"x","t":null},"abc":{"s":3}}', daily: '{"20250101":null}' });
    await t.tap('#tSelect'); await t.until(() => __game.screen() === 'select' && document.querySelectorAll('.lt').length === 100);
    const sum = await t.p.textContent('#selSum');
    await t.tap('#sBack'); await t.until(() => __game.screen() === 'title');
    await t.tap('#tStats'); await t.until(() => !document.getElementById('stats').classList.contains('hidden') && document.getElementById('statsBody').innerHTML.length > 50);
    eq(errors.length - e0, 0, `progress 有 null／非物件／壞欄位：選擇關卡（${sum}）和統計成就都打得開，沒有 page error`);
    await t.ctx.close();
  }
  {
    const e0 = errors.length;
    const t = await open(390, 844, { 'cur.L1': { v: '.'.repeat(81), s: 500, hl: 'q', hu: null, e: 'x', t: 'NaN', u: [[999999999]] } });
    await t.level(1);
    const s = await t.st(); const e = await t.empties();
    eq([s.sel, s.hintsLeft, s.err, s.undo], [-1, 3, 0, 0], 'cur.L1 的 s=500、hl/e/t 不是數字、悔棋紀錄壞掉：選取格重設為 -1，其他回預設');
    await t.tapCell(e[0]); await t.tap(`.key[data-d="${s.sol[e[0]]}"]`);
    await t.until(([c, d]) => __game.state().val[c] === d, [e[0], s.sol[e[0]]]);
    eq(errors.length - e0, 0, '接著點格子、點數字：正常填入，沒有 page error');
    // the old R1 repro: s=500 left selected, then a digit key with no cell tap
    await t.p.evaluate(() => localStorage.setItem('sudoku.cur.L2', JSON.stringify({ v: '.'.repeat(81), s: 500 })));
    await t.level(2); await t.tap('.key[data-d="5"]'); await sleep(300);
    eq(errors.length - e0, 0, '第 2 關存檔 s=500 直接點數字鍵：只提示先選格子，沒有 page error');
    // cached daily puzzle with no givens (and with a wrong solution) is not used
    const dk = await t.p.evaluate(() => { const d = new Date(); return '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); });
    await t.p.evaluate(dk => localStorage.setItem('sudoku.dailyPuz', JSON.stringify({ date: dk, puzzle: '.'.repeat(81), sol: '1'.repeat(81), D: 50, tier: 1 })), dk);
    await sleep(850); await t.p.evaluate(() => { document.getElementById('pHome').click(); });
    await t.until(() => __game.screen() === 'title');
    await sleep(900); await t.tap('#tDaily'); await t.until(() => __game.screen() === 'game' && __game.more().daily, null, 15000);
    const ds = await t.st(), giv = [...ds.puz].filter(c => c !== '.').length, cache = await t.p.evaluate(() => JSON.parse(localStorage.getItem('sudoku.dailyPuz')));
    assert(giv >= 17 && cache.puzzle === ds.puz && cache.sol === ds.sol && ds.hintsLeft === 3 && errors.length === e0,
      `每日題目快取是 0 個給定數字的壞題：不採用，重新生成（${giv} 個給定數字，提示 ${ds.hintsLeft} 次）`);
    await t.ctx.close();
  }

  // ---------- 3. hint bar does not cover the board; landscape size ----------
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    const t = await open(w, h);
    await t.level(91);
    const s = await t.st(); const wrong = s.sol[4] === '9' ? 1 : +s.sol[4] + 1;
    assert(s.val[4] === '.', '（第 91 關第 1 列第 5 行是空格）');
    await t.tapCell(4); await t.tap(`.key[data-d="${wrong}"]`); await t.until(() => __game.state().err === 1);
    await t.tap('#tHint'); await t.until(() => !document.getElementById('hintBar').classList.contains('hidden'));
    await sleep(400);
    const r = await t.p.evaluate(() => { const b = document.getElementById('board').getBoundingClientRect(), hb = document.getElementById('hintBar').getBoundingClientRect(),
      k = document.querySelector('.key[data-d="5"]').getBoundingClientRect();
      const ov = !(hb.bottom <= b.top || hb.top >= b.bottom || hb.right <= b.left || hb.left >= b.right);
      return { ov, inView: hb.bottom <= innerHeight && hb.top >= 0, board: b.width, text: document.getElementById('hintText').textContent }; });
    assert(!r.ov && r.inView && r.board >= 250 && /填錯/.test(r.text), `${w}×${h} 第 91 關填錯第 1 列第 5 行後按提示：提示條完整顯示且不蓋住盤面（盤面 ${r.board}px）`);
    await t.tap('#hintX'); await t.until(() => document.getElementById('hintBar').classList.contains('hidden'));
    await t.ctx.close();
  }
  {
    const a = await open(844, 390); await a.level(5); const sa = (await a.p.evaluate(() => __game.geom())).size; await a.ctx.close();
    const b = await open(390, 844); await b.level(5); const sp = (await b.p.evaluate(() => __game.geom())).size;
    await b.p.setViewportSize({ width: 844, height: 390 }); await b.until(s => Math.abs(__game.geom().size - s) < 1, sa, 3000).catch(() => {});
    await sleep(300); const sr = (await b.p.evaluate(() => __game.geom())).size;
    await b.p.setViewportSize({ width: 390, height: 844 }); await sleep(400); const sb = (await b.p.evaluate(() => __game.geom())).size;
    eq([sr, sb], [sa, sp], `橫式盤面：直接用 844×390 開（${sa}px）和從直式旋轉過去一樣大；轉回直式也回到 ${sp}px`);
    await b.ctx.close();
  }

  // ---------- 4. 限錯挑戰 ----------
  {
    const t = await open();
    await t.level(3);
    const e = await t.empties(), s = await t.st(), bad = c => s.sol[c] === '9' ? 1 : +s.sol[c] + 1;
    for (let k = 0; k < 3; k++) { await t.tapCell(e[k]); await t.tap(`.key[data-d="${bad(e[k])}"]`); await t.until(n => __game.state().err === n, k + 1); await sleep(100); }
    await sleep(700);
    eq([await t.vis('fail'), await t.p.textContent('#hErr')], [false, '3'], '預設一般模式：錯 3 次也不會失敗，錯誤只顯示次數');
    await t.p.evaluate(() => __game.start(4)); await t.until(() => __game.state().n === 4);
    await t.tap('#bMenu'); await t.tap('#pSettings'); await t.tap('#settings .sw[data-k="strict"]');
    await t.until(() => document.querySelector('#settings .sw[data-k="strict"]').getAttribute('aria-checked') === 'true');
    await t.tap('#setOk'); await t.tap('#pResume'); await t.until(() => !document.getElementById('pause').classList.contains('hidden') === false);
    eq([(await t.st()).strict, await t.p.textContent('#hErr')], [true, '0/3'], '設定開啟「限錯挑戰」：這一局改為限錯，HUD 顯示「錯誤 0/3」');
    const e4 = await t.empties(), s4 = await t.st(), bad4 = c => s4.sol[c] === '9' ? 1 : +s4.sol[c] + 1;
    for (let k = 0; k < 3; k++) { await t.tapCell(e4[k]); await t.tap(`.key[data-d="${bad4(e4[k])}"]`); await t.until(n => __game.state().err === n, k + 1); await sleep(100); }
    await t.until(() => !document.getElementById('fail').classList.contains('hidden'));
    const v0 = (await t.st()).val; await t.p.keyboard.press(s4.sol[e4[5]]); await sleep(100);
    eq((await t.st()).val, v0, '錯第 3 次：出現「挑戰失敗」，盤面不能再改');
    await t.p.reload(); await t.until(() => window.__game); await t.p.evaluate(() => __game.start(4));
    await t.until(() => !document.getElementById('fail').classList.contains('hidden'));
    assert(true, '重新整理再進同一關：仍是「挑戰失敗」（不能靠重新整理跳過）');
    await t.load(); await t.p.evaluate(() => __game.start(4)); await t.until(() => !document.getElementById('fail').classList.contains('hidden'));
    await t.tap('#fRelax'); await t.until(() => document.getElementById('fail').classList.contains('hidden'));
    await t.tapCell(e4[5]); await t.tap(`.key[data-d="${s4.sol[e4[5]]}"]`); await t.until(([c, d]) => __game.state().val[c] === d, [e4[5], s4.sol[e4[5]]]);
    eq([(await t.st()).strict, await t.p.textContent('#hErr')], [false, '3'], '「改用一般模式繼續」：可以繼續填，HUD 回到一般顯示');
    await t.tap('#bMenu'); await t.tap('#pRestart'); await t.until(() => __game.state().err === 0);
    eq((await t.st()).strict, true, '重新開始：設定仍是限錯挑戰，新的一局是限錯');
    await t.ctx.close();
  }

  // ---------- 5. undo after reload; daily generated off the main thread ----------
  {
    const t = await open();
    await t.level(6);
    const e = await t.empties(), s = await t.st();
    for (let k = 0; k < 3; k++) { await t.tapCell(e[k]); await t.tap(`.key[data-d="${s.sol[e[k]]}"]`); await t.until(([c, d]) => __game.state().val[c] === d, [e[k], s.sol[e[k]]]); await sleep(60); }
    await t.tap('#tNotes'); await t.until(() => __game.more().notes); await t.tapCell(e[4]); await t.tap('.key[data-d="7"]'); await t.until(() => __game.more().undo === 4);
    await t.tap('#tUndo'); await t.until(() => __game.more().redo === 1);
    const before = await t.st();
    await t.p.reload(); await t.until(() => window.__game); await t.load(); await t.p.evaluate(() => __game.start(6)); await t.until(() => __game.state().n === 6);
    const after = await t.st();
    eq([after.val, after.undo, after.redo], [before.val, 3, 1], '重新整理後：盤面一樣，悔棋 3 步、重做 1 步都還在');
    await t.tap('#tRedo'); await t.until(() => __game.more().undo === 4);
    for (let k = 0; k < 4; k++) { await t.tap('#tUndo'); await t.until(n => __game.more().undo === n, 3 - k); }
    const u = await t.st();
    eq([u.val, u.redo], [s.val, 4], '接著重做 1 步、再悔棋 4 步：回到開局盤面（重做 4 步）');
    // daily generation: no long task on the main thread
    await t.p.evaluate(() => { localStorage.removeItem('sudoku.dailyPuz'); window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(x => __lt.push(Math.round(x.duration)))).observe({ type: 'longtask' }); __game.start(1); });
    await sleep(850); await t.p.evaluate(() => document.getElementById('pHome').click()); await t.until(() => __game.screen() === 'title');
    await t.tap('#tDaily'); await t.until(() => __game.screen() === 'game' && __game.more().daily, null, 15000);
    await sleep(300);
    const lt = await t.p.evaluate(() => __lt);
    assert(!lt.some(x => x >= 120), `沒有快取時點每日數獨：題目在 worker 生成，主執行緒沒有 ≥120 ms 的長任務（${JSON.stringify(lt)}）`);
    await t.ctx.close();
  }

  eq(errors, [], '全程沒有 page error／console error');
  await browser.close(); srv.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
