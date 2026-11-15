// 記分板：上架評分 9.5 重審（第 1 輪）的回歸測試（node tests.js，約 40 秒）。
// 觸控用真實 CDP Input.dispatchTouchEvent（touchEnd 只放開沒列出的手指）；頁面用本機 http 提供，跨分頁與重新整理時 localStorage 才可靠。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const APP = path.resolve(__dirname, '../index.html');
const K = 'score-board:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();

  async function open({ w = 390, h = 844, seed = null, ctx = null } = {}) {
    ctx = ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    if (seed) await ctx.addInitScript(([K, seed]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); for (const k in seed) localStorage.setItem(K + k, seed[k]);
    }, [K, seed]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__sb);
    // no wake-lock toast in the way
    await p.evaluate(() => { document.querySelector('#toast').hidden = true; });
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 30) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', []); };
    const tap = async (sel, hold) => { await p.$eval(sel, e => { const b = e.getBoundingClientRect(); if (b.top < 0 || b.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); }); return tapAt(await center(sel), hold); };
    const S = () => p.evaluate(() => { const s = __sb.st; return { sc: s.players.map(x => x.score), step: s.step, log: s.log.length, redo: s.redo.length, sheets: [...document.querySelectorAll('.scrim')].filter(x => !x.hidden).map(x => x.id), win: !document.querySelector('#win').hidden, sets: s.sets.slice(), ae: document.activeElement && (document.activeElement.id || document.activeElement.tagName), toast: document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent }; });
    const d0 = target => p.evaluate(t => {
      const el = Array.isArray(t) ? document.elementFromPoint(t[0], t[1]) : document.querySelector(t);
      if (!el) return 'none'; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); return el.id || el.className;
    }, target);
    const edge = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + 2, b.top + 2]; });
    return { ctx, p, T, tap, tapAt, center, S, d0, edge };
  }
  const quiet = p => p.waitForFunction(() => performance.now() > 0).then(() => W(850)); // past the 800 ms tap window

  // 1. 一指放著時，另一指點 +2、撤銷、重做、選單、輸入都只執行一次
  {
    const { ctx, p, T, center, S } = await open();
    const rest = [195, 820, 1];
    const two = async sel => { const c = await center(sel); await T('touchStart', [rest]); await T('touchStart', [rest, [c[0], c[1], 2]]); await W(40); await T('touchEnd', [rest]); await T('touchEnd', []); };
    await two('#step-2'); eq((await S()).step, 2, '1 一指放在狀態列時點 +2 有反應');
    await two('#p1-plus'); eq((await S()).sc, [0, 2], '1 一指放著時點加分只加一次');
    await two('#undo'); eq((await S()).sc, [0, 0], '1 一指放著時點撤銷有反應（一次）');
    await two('#redo'); eq((await S()).sc, [0, 2], '1 一指放著時點重做有反應（一次）');
    await two('#menu-btn'); eq((await S()).sheets, ['menu'], '1 一指放著時點選單有反應');
    await p.evaluate(() => document.querySelector('#menu').hidden = true);
    await two('#input-btn'); eq((await S()).sheets, ['num'], '1 一指放著時點輸入有反應');
    await ctx.close();
  }

  // 2. 兩隊同時點（手指重疊按下），兩種放開順序都各算一分
  for (const order of ['A', 'B']) {
    const { ctx, T, center, S } = await open();
    const a = await center('#p0-plus'), b = await center('#p1-plus');
    const A = [a[0], a[1], 1], B = [b[0], b[1], 2];
    await T('touchStart', [A]); await T('touchStart', [A, B]); await W(40);
    if (order === 'A') { await T('touchEnd', [B]); await T('touchEnd', []); } else { await T('touchEnd', [A]); await T('touchEnd', []); }
    eq((await S()).sc, [1, 1], `2 兩隊同時點、${order} 先放開 → 各 +1`);
    await ctx.close();
  }

  // 3. 點按後補送 detail 0 click（CI Chromium 141）：同一顆、邊緣點、elementFromPoint 都不重複；單獨的 detail 0 click 執行一次
  {
    const { ctx, p, tap, center, S, d0, edge } = await open();
    for (const sel of ['#p1-plus', '#p1-minus']) {
      const before = (await S()).sc[1];
      await tap(sel); const c = await center(sel);
      await d0(sel); await d0(await edge(sel)); await d0(c);
      eq((await S()).sc[1] - before, sel.endsWith('plus') ? 1 : -1, `3 點 ${sel} 後補送 detail 0 click（同鈕、邊緣、指下）只算一次`);
    }
    await p.evaluate(() => { const s = __sb.st; s.log.forEach(e => e.t = 0); });
    await tap('#p0-plus'); await tap('#p0-plus'); await quiet(p);
    const s0 = await S();
    await tap('#undo'); await d0('#undo'); await d0(await center('#undo'));
    eq((await S()).log, s0.log - 1, '3 點撤銷後補送 detail 0 click 只撤銷一次');
    await tap('#redo'); await d0('#redo'); await d0(await center('#redo'));
    eq((await S()).log, s0.log, '3 點重做後補送 detail 0 click 只重做一次');
    await tap('#step-5'); await d0('#step-10');
    eq((await S()).step, 5, '3 點 +5 後 800 ms 內別顆的 detail 0 click 被吞');
    // a tap that opens the menu: the click replay lands on the new sheet and must not run anything there
    const mc = await center('#menu-btn'); await tap('#menu-btn'); const hit = await d0(mc); await d0('#m-new');
    eq((await S()).sheets, ['menu'], `3 點選單後補送的 click 不會按到新畫面（${hit}）`);
    await p.evaluate(() => document.querySelector('#menu').hidden = true);
    await quiet(p);
    const b = (await S()).sc[1]; await d0('#p1-plus');
    eq((await S()).sc[1], b + 5, '3 沒有點按在前的單獨 detail 0 click（鍵盤）執行一次');
    await quiet(p);
    await p.focus('#step-3'); await p.keyboard.press('Enter');
    eq((await S()).step, 3, '3 鍵盤 Enter 仍可按按鈕');
    await ctx.close();
  }

  // 4. 長按開輸入視窗後放開手指不會關掉視窗或按到裡面；得勝那一分的放開不會按到勝利畫面
  for (const [w, h] of [[390, 844], [360, 640], [844, 390]]) {
    for (const sel of ['#p0-plus', '#p1-minus']) {
      const { ctx, p, tap, S, center, d0 } = await open({ w, h });
      const c = await center(sel);
      await tap(sel, 750); await d0(c);
      const s = await S();
      const pl = await p.$eval('#num-player', e => e.value);
      eq([s.sheets, s.sc, pl, s.ae], [['num'], [0, 0], sel.slice(2, 3), 'num-value'], `4 ${w}×${h} 長按 ${sel} 放開：輸入視窗還在、沒加分、選手沒被改`);
      await ctx.close();
    }
  }
  for (const [w, h] of [[390, 844], [360, 640]]) {
    const { ctx, p, tapAt, S, d0 } = await open({ w, h });
    await p.evaluate(() => { const s = __sb.st; s.rule = 'badminton'; s.players[1].score = 20; s.players[0].score = 15; });
    for (const f of [0.2, 0.5, 0.8]) {
      await p.evaluate(() => { const s = __sb.st; document.querySelector('#win').hidden = true; s.players[1].score = 20; s.players[0].score = 15; s.log = []; s.sets = [0, 0]; s.setLog = []; });
      const b = await p.$eval('#p1-plus', e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
      const pt = [b[0] + b[2] * f, b[1] + b[3] * f];
      await tapAt(pt); await d0(pt);
      const s = await S();
      eq([s.win, s.sets, s.sc], [true, [0, 0], [15, 21]], `4 ${w}×${h} 點得勝那一分（${f}）：勝利畫面留著、沒有直接下一局`);
    }
    // a finger that was already down when the win screen appeared does nothing on it
    await p.evaluate(() => { const s = __sb.st; document.querySelector('#win').hidden = true; s.players[1].score = 20; s.players[0].score = 15; s.log = []; });
    await tapAt(await p.$eval('#p1-plus', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
    eq((await S()).win, true, '4 勝利畫面出現');
    await W(100);
    const nx = await p.$eval('#win-next', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tapAt(nx); await W(50);
    eq((await S()).sets, [0, 1], '4 勝利畫面出現後才按下的點按可以按「下一局」');
    await ctx.close();
  }

  // 5. localStorage 形狀不完整也能打開；壞的歷史不讓紀錄打不開
  {
    const base = { name: 'x', players: [{ name: 'a', color: 1, init: 0, score: 3 }, { name: 'b', color: 0, init: 0, score: 1 }] };
    const variants = {
      playersEmptyObjs: { current: '{"players":[{},{}]}' },
      missingLogTimer: { current: JSON.stringify(base) },
      badRule: { current: JSON.stringify(Object.assign({}, base, { rule: 'zzz', log: 5, timer: null, sets: 'x', step: -3 })) },
      badLogEntries: { current: JSON.stringify(Object.assign({}, base, { log: [null, 5, { k: 's', p: 9, d: 1 }, { k: 's', p: 0, d: 2, r: 99 }], redo: [{}], round: 0 })) },
      stringScores: { current: JSON.stringify({ players: [{ name: 'a', score: '3' }, { name: 5, score: 1e9 }] }) },
      onePlayer: { current: JSON.stringify({ players: [{ name: 'solo', score: 4 }] }) },
      historyBad: { history: '[{"at":1},5,null,{"players":[{"name":"p","score":2}]}]' },
      oldKeysOk: { current: JSON.stringify({ name: '舊存檔', count: 2, players: [{ name: '甲', color: 2, init: 0, score: 7 }, { name: '乙', color: 3, init: 0, score: 4 }], log: [{ k: 's', p: 0, d: 7, r: 1, t: 1 }, { k: 's', p: 1, d: 4, r: 1, t: 2 }], redo: [], round: 1, rule: 'free', target: 21, rotate: true, rounds: false, timer: { on: false, run: false, acc: 0, since: 0 }, sets: [0, 0], setLog: [], step: 1, locked: false, sample: false }) },
    };
    for (const [name, seed] of Object.entries(variants)) {
      const before = errors.length;
      const { ctx, p, tap, S } = await open({ seed });
      const s0 = await S();
      await tap('#p1-plus'); await tap('#menu-btn'); await tap('#m-log');
      const s = await S();
      eq([errors.length - before, s.sheets, s.sc[1] - s0.sc[1]], [0, ['log'], 1], `5 存檔「${name}」：正常打開、可加分、紀錄打得開`);
      if (name === 'oldKeysOk') eq([s0.sc, await p.$eval('#title-text', e => e.textContent)], [[7, 4], '舊存檔'], '5 舊格式存檔照常載入');
      await ctx.close();
    }
  }

  // 6. 兩個分頁：A 加 7、B 加 3，先關 B 再關 A，重開是 [7,3]
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = (await open({ ctx })).p, b = (await open({ ctx })).p;
    await a.evaluate(() => __sb.apply(0, 7, false));
    await b.waitForFunction(() => __sb.st.players[0].score === 7);
    await b.evaluate(() => __sb.apply(1, 3, false));
    await a.waitForFunction(() => __sb.st.players[1].score === 3);
    await b.close({ runBeforeUnload: true }); await a.close({ runBeforeUnload: true });
    const c = (await open({ ctx })).p;
    eq(await c.evaluate(() => __sb.st.players.map(x => x.score)), [7, 3], '6 兩個分頁的分數都保留，關閉分頁不會用舊狀態覆寫');
    await ctx.close();
  }

  // 7. 360×640 回合制＋計時器＋長隊名：輸入鈕和計時器都在畫面內
  for (const [w, h, n] of [[360, 640, 2], [360, 640, 8], [390, 844, 8]]) {
    const { ctx, p } = await open({ w, h });
    const r = await p.evaluate(n => {
      const s = __sb.st; while (s.players.length < n) s.players.push({ name: 'x', color: s.players.length % 10, init: 0, score: 0 });
      s.sets = s.players.map(() => 0); s.players[0].name = '一二三四五六七八九十一二'; s.rounds = true; s.timer.on = true; __sb.apply(0, 12, false);
      const R = q => document.querySelector(q).getBoundingClientRect().right;
      return [R('#input-btn'), R('#timer-btn'), R('#next-round'), document.documentElement.scrollWidth].map(Math.round);
    }, n);
    assert(r.every(x => x <= w), `7 ${w}×${h} ${n} 人 回合制＋計時器：按鈕都在畫面內 ${JSON.stringify(r)}`);
    await ctx.close();
  }

  // 8. 桌球發球：每 2 分換發，10:10 後每分換發；羽球最後得分方發球
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => {
      const sb = __sb, s = sb.st; Object.assign(s, { rule: 'tt', log: [], redo: [], setLog: [], sets: [0, 0], step: 1 }); s.players.forEach(x => { x.score = 0; x.init = 0; });
      const srv = () => [...document.querySelectorAll('.team')].findIndex(t => !t.querySelector('.serve').hidden);
      const out = []; for (const w of [0, 0, 1, 0, 1, 1, 0]) { s.log.forEach(e => e.t = 0); sb.apply(w, 1); out.push(srv()); }
      s.players[0].score = 10; s.players[1].score = 9; s.log = []; const deuce = []; for (const w of [1, 0, 1, 0]) { sb.apply(w, 1, false); deuce.push(srv()); }
      return { out, deuce };
    });
    eq(r.out, [0, 1, 1, 0, 0, 1, 1], '8 桌球每 2 分換發');
    eq(r.deuce, [0, 1, 0, 1], '8 桌球 10:10 後每分換發');
    const b = await p.evaluate(() => { const sb = __sb, s = sb.st; document.querySelector('#win').hidden = true; Object.assign(s, { rule: 'badminton', log: [], setLog: [] }); s.players.forEach(x => x.score = 0);
      const srv = () => [...document.querySelectorAll('.team')].findIndex(t => !t.querySelector('.serve').hidden); const o = []; for (const w of [1, 1, 0]) { s.log.forEach(e => e.t = 0); sb.apply(w, 1); o.push(srv()); } return o; });
    eq(b, [1, 1, 0], '8 羽球由得分方發球');
    await ctx.close();
  }

  // 9. 矮螢幕、多人時勝利畫面可捲動，「下一局」和「撤銷」都按得到
  for (const [w, h, n] of [[667, 375, 6], [844, 390, 8], [360, 640, 8]]) {
    const { ctx, p, tap, S } = await open({ w, h });
    await p.evaluate(n => { const s = __sb.st; while (s.players.length < n) s.players.push({ name: '一二三四五六七八九十一二', color: s.players.length % 10, init: 0, score: 0 });
      s.players.forEach(x => x.name = '一二三四五六七八九十一二'); s.sets = s.players.map(() => 0); s.rule = 'target'; s.target = 1000; __sb.apply(0, 1000, false); }, n);
    const r = await p.evaluate(() => { const win = document.querySelector('#win'), b = document.querySelector('#win-undo'); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(), x = document.querySelector('#win-next').getBoundingClientRect(); return [r.bottom <= innerHeight + 0.5 && r.top >= 0, x.bottom <= innerHeight + 0.5 && x.top >= -0.5 || win.scrollHeight > win.clientHeight]; });
    eq(r, [true, true], `9 ${w}×${h} ${n} 人勝利畫面：按鈕捲得到`);
    await W(100); await tap('#win-undo');
    eq((await S()).win, false, `9 ${w}×${h} 捲動後可以按撤銷`);
    await ctx.close();
  }

  // 10. 撤銷最後一分只退 1 分；目標分數拒絕 1e3 和 21.5
  {
    const { ctx, p, tap, S } = await open();
    await p.evaluate(() => { const s = __sb.st; Object.assign(s, { rule: 'target', target: 21, step: 1 }); s.players[0].score = 19; });
    await tap('#p0-plus'); await tap('#p0-plus');
    eq((await S()).win, true, '10 19→20→21 快速點兩下到勝利');
    eq(await p.$eval('#win-undo', e => e.textContent), '撤銷最後一分', '10 勝利畫面按鈕文字');
    await W(100); await tap('#win-undo');
    eq((await S()).sc[0], 20, '10 撤銷最後一分 → 20（不是整段合併的 19）');
    for (const v of ['1e3', '21.5', '0', 'abc']) {
      await quiet(p);
      await tap('#menu-btn'); await tap('#m-settings');
      await p.selectOption('#s-rule', 'target'); await p.fill('#s-target', v); await quiet(p); await tap('#s-save');
      const r = await p.evaluate(() => [!document.querySelector('#settings').hidden, document.querySelector('#s-err').textContent, __sb.st.target]);
      eq([r[0], !!r[1], r[2]], [true, true, 21], `10 目標分數「${v}」被擋下並說明`);
      await p.evaluate(() => document.querySelector('#settings').hidden = true);
    }
    await quiet(p);
    await tap('#menu-btn'); await tap('#m-settings'); await p.selectOption('#s-rule', 'target'); await p.fill('#s-target', '３０'); await quiet(p); await tap('#s-save');
    eq(await p.evaluate(() => __sb.st.target), 30, '10 目標分數接受全形 ３０');
    await ctx.close();
  }

  // 11. 預設不旋轉上方隊伍；提示不依賴上下
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => [__sb.st.rotate, document.querySelector('.team').classList.contains('rot'), document.querySelector('#st-lead').textContent]);
    eq([r[0], r[1]], [false, false], '11 預設上方隊伍不旋轉');
    assert(!/上半部|下半部/.test(r[2]) && /＋/.test(r[2]), '11 提示用 ＋／− 那一半說明：' + r[2]);
    // rotated: the plus half of the top team is the half that shows ＋ and its name
    await p.evaluate(() => { __sb.st.rotate = true; __sb.swapSides(); __sb.swapSides(); });
    const g = await p.evaluate(() => { const t = document.querySelector('.team'), pl = t.querySelector('.plus').getBoundingClientRect(), nm = t.querySelector('.nm').getBoundingClientRect(), gl = t.querySelector('.plus span').getBoundingClientRect(); const inP = r => r.top >= pl.top - 1 && r.bottom <= pl.bottom + 1; return [t.classList.contains('rot'), inP(nm), inP(gl)]; });
    eq(g, [true, true, true], '11 旋轉時隊名和 ＋ 都在加分那一半');
    await ctx.close();
  }

  // 12. 細節：名字以字元計、初始分接受 + 與全形、鎖定擋輸入／新局／設定、＋／− 清楚、提示不蓋住隊伍、換邊
  {
    const { ctx, p, tap, S } = await open();
    await tap('#menu-btn'); await tap('#m-settings');
    const emoji = '🎉'.repeat(12);
    await p.fill('#pn-0', emoji + '多'); await p.fill('#pi-0', '+5'); await p.fill('#pi-1', '５'); await quiet(p); await tap('#s-save');
    const r = await p.evaluate(() => __sb.st.players.map(x => [x.name, x.init, x.score]));
    eq(r, [[emoji, 5, 5], ['橘隊', 5, 5]], '12 名字 12 個表情符號都留著、初始分 +5 與 ５ 接受');
    await quiet(p);
    await tap('#menu-btn'); await tap('#m-lock'); await quiet(p);
    await tap('#input-btn'); let s = await S();
    eq([s.sheets, /鎖定/.test(s.toast)], [[], true], '12 鎖定時按輸入：不開視窗並提示');
    await quiet(p); await tap('#menu-btn'); await tap('#m-new'); s = await S();
    eq([s.sheets, /解鎖/.test(s.toast)], [[], true], '12 鎖定時按新局：不開確認並說明');
    await quiet(p); await tap('#menu-btn'); await tap('#m-settings'); s = await S();
    eq([s.sheets, /解鎖/.test(s.toast)], [[], true], '12 鎖定時按設定：不開設定並說明');
    await quiet(p); await tap('#p1-plus'); s = await S();
    eq([s.sc, /鎖定/.test(s.toast)], [[5, 5], true], '12 鎖定時點分數：不加分並提示');
    const lock = await p.$eval('#unlock', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await p.evaluate(() => document.querySelector('#toast').hidden = true);
    await (async () => { const cdp = await ctx.newCDPSession(p); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: lock[0], y: lock[1], id: 1 }] }); await p.waitForFunction(() => !__sb.st.locked, null, { timeout: 3000 }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); })();
    eq((await S()).sc, [5, 5], '12 長按 1 秒解鎖');
    const glyph = await p.$eval('#p1-plus', e => { const cs = getComputedStyle(e), sp = getComputedStyle(e.querySelector('span')); return [parseFloat(cs.opacity), parseFloat(cs.fontSize), sp.backgroundColor !== 'rgba(0, 0, 0, 0)']; });
    assert(glyph[0] === 1 && glyph[1] >= 30 && glyph[2], '12 ＋／− 符號不透明、夠大、有底 ' + JSON.stringify(glyph));
    await quiet(p); await tap('#p1-plus');
    const tb = await p.evaluate(() => { const t = document.querySelector('#toast'); t.textContent = '測試提示訊息'; t.hidden = false; const a = t.getBoundingClientRect(), b = document.querySelector('#arena').getBoundingClientRect(); return [Math.round(a.bottom), Math.round(b.top)]; });
    assert(tb[0] <= tb[1], `12 提示訊息不蓋住上方隊伍 ${JSON.stringify(tb)}`);
    await quiet(p); await p.evaluate(() => { __sb.st.rule = 'badminton'; __sb.st.log.forEach(e => e.t = 0); });
    await tap('#p1-plus');
    const before = await p.evaluate(() => [__sb.st.players.map(x => x.name), __sb.server()]);
    await quiet(p); await tap('#menu-btn'); await tap('#m-swap');
    const after = await p.evaluate(() => [__sb.st.players.map(x => x.name), __sb.st.players.map(x => x.score), __sb.server(), document.querySelector('.team .nm').textContent]);
    eq([after[0], after[1], after[2]], [before[0].slice().reverse(), [7, 5], 1 - before[1]], '12 換邊：兩隊交換位置，分數和發球方跟著隊伍');
    await ctx.close();
  }

  await browser.close();
  eq(errors, [], '沒有頁面錯誤');
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
