// 菇菇守城：上架評分 r1 toFix 的回歸測試（node tests.js，約 60 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指）；頁面由本機 http server 提供，重新整理後 localStorage 還在。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const FILE = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const W = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// ---------- 3. difficulty (Node, the game's own core) ----------
function difficulty() {
  const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn Core;')();
  const T = JSON.parse(html.match(/var LVTAB = (\[[^;]*\]);/)[1]);
  const lv = n => { const e = T[n - 1]; return C.levelFromTable(n, e[0], e[1], e[2]); };
  assert(T.length === 100 && T.every((e, i) => !i || e[1] > T[i - 1][1]), '難度 D 1→' + T[99][1] + ' 嚴格遞增');
  // random placement: random tower on a random free moss cell until the spores run out, every build phase
  const random = (L, seed) => { const R = C.rng(seed), s = C.newGame(L, {});
    while (s.phase !== 'won' && s.phase !== 'lost'){
      if (s.phase === 'build'){ for (let g = 0; g < 200; g++){ const cells = []; for (let c = 0; c < C.NC; c++) if (L.grid[c] === 2 && s.tmap[c] < 0) cells.push(c);
        const ts = L.towers.filter(t => C.TOWERS[t].cost <= s.spores); if (!cells.length || !ts.length) break; C.build(s, cells[Math.floor(R() * cells.length)], ts[Math.floor(R() * ts.length)]); }
        C.callWave(s, false); }
      C.step(s);
    } return s.phase === 'won'; };
  for (const n of [20, 30, 40, 50]){
    const L = lv(n); let wins = 0; for (let i = 1; i <= 6; i++) if (random(L, i * 977 + n)) wins++;
    const sol = C.botSolve(L, 12);
    assert(wins === 0 && sol.win, `第 ${n} 關：隨機放塔 6 次 ${wins} 勝；遊戲自帶解算器 ${sol.win ? '過關，剩 ' + sol.lives + ' 命' : '沒過'}`);
  }
  // level 1 stays friendly: random placement still usually clears it
  { const L = lv(1); let wins = 0; for (let i = 1; i <= 6; i++) if (random(L, i * 977 + 1)) wins++; assert(wins >= 4, `第 1 關仍是教學關：隨機放塔 6 次 ${wins} 勝`); }
  // HP at level 30 vs the old build (k = 0..5 bumps): enemies are now several times tougher at the same level
  assert(Math.pow(1.03, T[29][0]) > 5, '第 30 關敵人血量倍率 ' + Math.pow(1.03, T[29][0]).toFixed(1) + '×（舊版約 1.0×）');
}

(async () => {
  difficulty();
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  async function open(w, h, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__game && window.__tap);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
    const tapAt = async (q, hold = 50) => { await T('touchStart', [[q[0], q[1], 9]]); await W(hold); await T('touchEnd', [[q[0], q[1], 9]]); };
    const tap = async sel => tapAt(await center(sel));
    const st = () => p.evaluate(() => window.__game.state());
    const until = (fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
    const cells = () => p.evaluate(() => { const o = []; for (let c = 0; c < 126; c++) if (window.__game.cell(c).grid === 2) o.push(c); return o; });
    const cellPt = async c => { const q = await p.evaluate(c => window.__game.cellPoint(c), c); return [q.x, q.y]; };
    return { ctx, p, T, center, tapAt, tap, st, until, cells, cellPt };
  }
  const speedOf = p => p.evaluate(() => window.__game.state().speed);

  // ---------- 1 + 2. touch: resting finger, overlapping taps, detail-0 replays ----------
  {
    const o = await open(390, 844); const { p, T, center, tapAt, tap, st, until, cells, cellPt } = o;
    await tap('#tPlay'); await until(() => window.__game.state().screen === 'game');
    const hc = await center('.hcard'), sp = await center('#bSpeed'), pp = await center('#bPause');
    // resting finger on the HUD card, 4 taps on 速度 with a second finger
    await T('touchStart', [[hc[0], hc[1], 1]]); await W(150);
    let s0 = await speedOf(p), steps = 0;
    for (let i = 0; i < 4; i++){ await T('touchStart', [[hc[0], hc[1], 1], [sp[0], sp[1], 2]]); await W(50); await T('touchEnd', [[sp[0], sp[1], 2]]); await W(120); const s1 = await speedOf(p); if (s1 !== s0) steps++; s0 = s1; }
    assert(steps === 4, '一指放在 HUD 卡片上，另一指點速度 4 次 → 變了 ' + steps + ' 次');
    // resting finger, open the build menu and tap 針刺菇
    const free = await cells(), bc = free[Math.floor(free.length / 2)], bp = await cellPt(bc);
    await T('touchStart', [[hc[0], hc[1], 1], [bp[0], bp[1], 2]]); await W(50); await T('touchEnd', [[bp[0], bp[1], 2]]);
    await until(() => window.__game.state().menu === 'build');
    const nb = await center('#rb-needle'), t0 = (await st()).towers;
    await T('touchStart', [[hc[0], hc[1], 1], [nb[0], nb[1], 2]]); await W(50); await T('touchEnd', [[nb[0], nb[1], 2]]); await W(150);
    assert((await st()).towers === t0 + 1, '一指放著時開建塔圓盤再點針刺菇 → 蓋好 1 座');
    await T('touchEnd', [[hc[0], hc[1], 1]]); await W(100);
    if ((await st()).speed !== 1) for (let i = 0; i < 3 && (await st()).speed !== 1; i++){ await tap('#bSpeed'); await W(100); }
    // overlapping: finger 1 on 速度, finger 2 on 暫停 50 ms later, either lifting first
    for (const order of ['速度先放', '暫停先放']){
      const a = await speedOf(p);
      await T('touchStart', [[sp[0], sp[1], 1]]); await W(50);
      await T('touchStart', [[sp[0], sp[1], 1], [pp[0], pp[1], 2]]); await W(60);
      if (order === '速度先放'){ await T('touchEnd', [[sp[0], sp[1], 1]]); await W(40); await T('touchEnd', [[pp[0], pp[1], 2]]); }
      else { await T('touchEnd', [[pp[0], pp[1], 2]]); await W(40); await T('touchEnd', [[sp[0], sp[1], 1]]); }
      await W(150); const s = await st();
      assert(s.speed !== a && s.screen === 'paused', `兩指重疊點速度＋暫停（${order}）→ 速度 ${a}→${s.speed}、畫面 ${s.screen}`);
      await W(850); await tap('#pResume'); await until(() => window.__game.state().screen === 'game');
    }
    // detail-0 replays right after a real tap: on the control, on its edge, and on elementFromPoint
    await W(850);
    for (const where of ['按鈕本身', '按鈕邊緣', 'elementFromPoint']){
      const a = await speedOf(p); await tap('#bSpeed'); await W(80);
      await p.evaluate(w => { const b = document.getElementById('bSpeed'), r = b.getBoundingClientRect();
        const el = w === 'elementFromPoint' ? document.elementFromPoint(r.left + 2, r.top + r.height / 2) : b;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: w === '按鈕邊緣' ? r.right - 1 : r.left + r.width / 2, clientY: r.top + r.height / 2 })); }, where);
      await W(150); const b = await speedOf(p);
      assert(b === (a >= 3 ? 1 : a + 1), `點一次速度再送 detail 0 click（${where}）→ ${a}→${b}，只跳一格`);
      await W(850);
    }
    // 出售: one real tap only arms the confirm; a detail-0 click right after must not sell
    const tw = await p.evaluate(() => window.__game.state().towers);
    const tc = await p.evaluate(() => { for (let c = 0; c < 126; c++) if (window.__game.cell(c).tower) return c; return -1; });
    await tapAt(await cellPt(tc)); await until(() => window.__game.state().menu === 'tower');
    await tap('#rb-sell'); await W(80);
    await p.evaluate(() => document.getElementById('rb-sell').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await W(200);
    assert((await st()).towers === tw && (await p.evaluate(() => document.getElementById('rb-sell').textContent)).includes('確認'), '點一次出售（變成確認）再送 detail 0 click → 塔還在、停在確認');
    // nothing on a new screen runs: tap 暫停, then a detail-0 click on 繼續 (new screen) within 800 ms
    await W(850); await tap('#bPause'); await W(60);
    await p.evaluate(() => document.getElementById('pResume').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await W(200); assert((await st()).screen === 'paused', '點暫停後 detail 0 click 落在新畫面的「繼續」→ 沒有作用');
    // a lone detail-0 click (keyboard / script) with no tap in the last 800 ms acts once
    await W(900); await p.evaluate(() => document.getElementById('pResume').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await W(150); assert((await st()).screen === 'game', '沒有剛點過時，單獨的 detail 0 click（鍵盤）作用一次');
    // keyboard Enter on a focused button still works
    await W(900); const k0 = await speedOf(p); await p.focus('#bSpeed'); await p.keyboard.press('Enter'); await W(150);
    assert((await speedOf(p)) !== k0, '鍵盤 Enter 仍可操作按鈕');
    // no :active transform on any button
    const tf = await p.evaluate(() => { const bad = []; for (const sh of document.styleSheets) for (const r of sh.cssRules) if (r.selectorText && /:active/.test(r.selectorText) && /transform/.test(r.cssText)) bad.push(r.selectorText); return bad; });
    assert(!tf.length, '按鈕 :active 不用 transform ' + tf.join(','));
    await o.ctx.close();
  }

  // ---------- 4. tower menus stay inside the board area (360x640, level 30) ----------
  {
    const o = await open(360, 640, () => { if (!sessionStorage.x){ sessionStorage.x = 1; localStorage.setItem('mushtd.unlockAll', 'true'); } });
    const { p, tap, tapAt, st, until, cells, cellPt } = o;
    await tap('#tSelect'); await until(() => window.__game.state().screen === 'select');
    await p.evaluate(() => document.querySelector('.lt[data-n="30"]').scrollIntoView({ block: 'center' })); await W(200);
    await tap('.lt[data-n="30"]'); await W(400);
    if ((await st()).screen === 'intro'){ await W(850); await tap('#iOk'); }
    await until(() => window.__game.state().screen === 'game');
    const hits = () => p.evaluate(() => { const out = []; const R = s => [...document.querySelectorAll(s)].map(e => [e.id || e.className, e.getBoundingClientRect()]);
      for (const [n, a] of R('.rb')) for (const [m, b] of R('#bPause,#bSpeed,.hcard,#bNext,#prev')){ const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ox > 0 && oy > 0) out.push(n + '/' + m); }
      return out; });
    const free = await cells(); const rows = c => Math.floor(c / 9); const edge = free.filter(c => rows(c) <= 1 || rows(c) >= 12 || c === 0 || c === 124);
    let bad = [];
    for (const c of edge){ await tapAt(await cellPt(c)); await W(60); if ((await st()).menu === 'build'){ const h = await hits(); if (h.length) bad.push(c + ':' + h.join(',')); } await tapAt(await cellPt(c)); await W(40); }
    assert(edge.length > 4 && !bad.length, `360×640 第 30 關上下緣 ${edge.length} 格的建塔圓盤都不蓋 HUD／底列 ${bad.join(' ')}`);
    // tower menu (目標 / 升級 / 出售) on the top-most and bottom-most moss cells
    bad = [];
    for (const c of [edge[0], edge[edge.length - 1]]){
      await tapAt(await cellPt(c)); await W(60); await tap('#rb-needle'); await W(80);
      await tapAt(await cellPt(c)); await W(80);
      if ((await st()).menu === 'tower'){ const h = await hits(); if (h.length) bad.push(c + ':' + h.join(',')); } else bad.push(c + ':no menu');
      await tapAt(await cellPt(c)); await W(40);
    }
    assert(!bad.length, '塔選單（目標／升級／出售）不蓋 HUD／底列 ' + bad.join(' '));
    await o.ctx.close();
  }

  // ---------- 5 + 9. landscape: bigger cells, tower info does not break a word ----------
  {
    const o = await open(844, 390); const { p, tap, tapAt, st, until, cells, cellPt } = o;
    await tap('#tPlay'); await until(() => window.__game.state().screen === 'game');
    const b = await p.evaluate(() => window.__game.board());
    assert(b.cs >= 36 && b.transposed, '844×390 橫式棋盤格 ' + b.cs + ' px（舊版 26 px），小徑改成左右走向');
    const c = (await cells())[3]; await tapAt(await cellPt(c)); await W(80); await tap('#rb-needle'); await W(80); await tapAt(await cellPt(c)); await W(150);
    const nw = await p.evaluate(() => [...document.querySelectorAll('.tinfo .nw')].map(e => e.getClientRects().length));
    assert(nw.length === 3 && nw.every(n => n === 1), '橫式右欄塔資訊「傷害／射程／擊倒」各自不斷行 ' + JSON.stringify(nw));
    const bad = await p.evaluate(() => { const bd = window.__game.board(), out = []; for (const s of ['#bPause', '#bSpeed', '.hcard', '#prev', '#bNext']){ const r = document.querySelector(s).getBoundingClientRect(); if (r.right > bd.l + 1 && r.left < bd.r - 1 && r.bottom > bd.t + 1 && r.top < bd.b - 1) out.push(s); } return out; });
    assert(!bad.length, '橫式側欄不蓋棋盤 ' + bad.join(','));
    await o.ctx.close();
  }

  // ---------- 6. level 1 hint, 8. resume after reload, 9. intro icon / endless map / lose advice / long task ----------
  {
    const o = await open(390, 844, () => { window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); } catch (e) {} });
    const { p, tap, tapAt, st, until, cells, cellPt } = o;
    await W(500); await p.waitForFunction(() => document.readyState === 'complete'); await W(300); await p.evaluate(() => { window.__lt.length = 0; });
    await tap('#tPlay'); await until(() => window.__game.state().screen === 'game'); await W(300);
    const lt = await p.evaluate(() => window.__lt.slice());
    // (the smoke runner loads the machine, so allow some slack over the 50 ms long-task line; unloaded it is 0 long tasks)
    assert(!lt.some(d => d > 90), '開始第 1 關沒有長於 90 ms 的 long task（舊版生成關卡 63 ms＋繪製）' + JSON.stringify(lt));
    const h = await p.evaluate(() => window.__game.hint());
    const cd0 = (await st()).cd; await W(1200); const cd1 = (await st()).cd;
    assert(h >= 0 && (await p.evaluate(c => window.__game.cell(c).grid, h)) === 2 && cd1 === cd0, '第 1 關有「點這裡種塔」提示指向苔蘚格 ' + h + '，蓋第一座塔前倒數先停住');
    await tapAt(await cellPt(h)); await until(() => window.__game.state().menu === 'build'); await tap('#rb-needle'); await W(150);
    assert((await p.evaluate(() => window.__game.hint())) === -1, '蓋好第一座塔後提示消失');
    // play wave 1 to its end, then reload: 繼續 resumes at wave 2 with the tower
    await tap('#bNext'); await W(100); await tap('#bSpeed'); await W(100); await tap('#bSpeed');
    const done = await until(() => { const s = window.__game.state(); return s.phase === 'build' && s.wave === 1; }, null, 40000);
    const before = await st();
    await p.reload(); await p.waitForFunction(() => window.__game);
    const label = await p.evaluate(() => document.getElementById('tPlay').textContent);
    assert(done && /繼續/.test(label) && /第 2 波/.test(label), '第 1 波打完後重新整理，標題顯示「' + label + '」');
    await W(850); await tap('#tPlay'); await until(() => window.__game.state().screen === 'game');
    const after = await st();
    assert(after.wave === 1 && after.towers === before.towers && after.lives === before.lives && after.spores === Math.floor(before.spores), `續玩回到第 ${after.wave + 1} 波、${after.towers} 座塔、${after.lives} 命、${Math.floor(after.spores)} 孢子`);
    // lose advice depends on the cause
    const adv = await p.evaluate(() => ['moth', 'stealth', 'boss', 'ant'].map(k => window.__game.loseAdvice({ [k]: 5, beetle: 1 })));
    assert(new Set(adv).size === 4 && /飛蛾/.test(adv[0]) && /隱身/.test(adv[1]) && /首領/.test(adv[2]) && /螞蟻/.test(adv[3]), '失敗建議依漏怪原因不同（飛蛾／隱身／首領／螞蟻）');
    // endless: a different map each run
    await p.evaluate(() => { localStorage.removeItem('mushtd.cur'); });
    const seeds = [];
    for (let i = 0; i < 2; i++){ await p.reload(); await p.waitForFunction(() => window.__game); await W(850); await tap('#tEndless'); await until(() => window.__game.state().screen === 'game'); seeds.push(await p.evaluate(() => window.__game.seed())); }
    assert(seeds[0] !== seeds[1], '無盡模式每次地圖不同（seed ' + seeds.join(' / ') + '）');
    await o.ctx.close();
  }
  {
    // intro card: the lance icon is not cut at the top (level 30 intro)
    const o = await open(390, 844, () => { if (!sessionStorage.x){ sessionStorage.x = 1; localStorage.setItem('mushtd.unlockAll', 'true'); } });
    const { p, tap, st, until } = o;
    await tap('#tSelect'); await until(() => window.__game.state().screen === 'select');
    await p.evaluate(() => document.querySelector('.lt[data-n="30"]').scrollIntoView({ block: 'center' })); await W(200);
    await tap('.lt[data-n="30"]'); await until(() => window.__game.state().screen === 'intro');
    const edge = await p.evaluate(() => { const c = document.querySelector('#iBody canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data, w = c.width; let top = 0, side = 0;
      for (let x = 0; x < w; x++){ if (d[(x) * 4 + 3] > 8) top++; if (d[(x * w) * 4 + 3] > 8 || d[(x * w + w - 1) * 4 + 3] > 8) side++; } return { top, side }; });
    assert(edge.top === 0 && edge.side === 0, '介紹卡長槍菇圖示四周沒被裁切 ' + JSON.stringify(edge));
    await o.ctx.close();
  }

  // ---------- 7. corrupt saves are dropped, never shown ----------
  {
    const o = await open(390, 844, () => { if (!sessionStorage.x){ sessionStorage.x = 1;
      localStorage.setItem('mushtd.progress', JSON.stringify({ 1: 'x', 2: 3, 3: { stars: 3 }, 4: 99, 5: 2.5, 101: 3, abc: 2 }));
      localStorage.setItem('mushtd.endless', JSON.stringify('abc')); localStorage.setItem('mushtd.ach', JSON.stringify({ first: 'yes', max: {} }));
      localStorage.setItem('mushtd.life', JSON.stringify({ bosses: 'many' })); localStorage.setItem('mushtd.unlockAll', JSON.stringify('yes'));
      localStorage.setItem('mushtd.cur', JSON.stringify({ v: 1, mode: 'level', n: 'x', wave: 3 })); } });
    const { p, tap, until } = o;
    assert((await p.evaluate(() => document.getElementById('tPlay').textContent)) === '開始遊戲', '壞的續玩存檔被忽略，標題仍是「開始遊戲」');
    await tap('#tSelect'); await until(() => window.__game.state().screen === 'select');
    const sum = await p.evaluate(() => document.getElementById('selSum').textContent);
    const lock = await p.evaluate(() => [1, 2, 3, 4, 5].map(n => document.querySelector('.lt[data-n="' + n + '"]').classList.contains('lock')));
    assert(sum === '已完成 1 / 100 關・星星 3 / 300', '壞星等被丟掉：' + sum);
    assert(JSON.stringify(lock) === '[false,false,false,true,true]', '解鎖只依合法星等（第 2 關 3 星 → 第 3 關解鎖，第 4、5 關鎖住）' + JSON.stringify(lock));
    await W(850); await tap('#sBack'); await W(900); await tap('#tAch'); await W(300);
    const at = await p.evaluate(() => document.getElementById('achBody').textContent);
    assert(/無盡最佳 0 波/.test(at) && !/abc|object|NaN|undefined/.test(at) && !/已達成/.test(at), '成就頁不顯示亂碼（無盡最佳 0 波）');
    await W(850); await tap('#aOk'); await W(900); await tap('#tEndless'); await until(() => window.__game.state().screen === 'game');
    assert((await p.evaluate(() => document.getElementById('hDiff').textContent)) === '最佳 0 波', 'HUD 顯示「最佳 0 波」');
    await o.ctx.close();
  }

  assert(!errors.length, '沒有 page／console error ' + errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
