// 石碑翻滾：上架評分 toFix 的回歸測試（node tests.js，約 30 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
// screen swipe vectors for N / E / S / W (the board is drawn at 45°)
const SWV = [[1, -1], [1, 1], [-1, 1], [-1, -1]];

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, store = {}, ctxIn = null) {
    const ctx = ctxIn || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (!ctxIn) await p.addInitScript(st => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in st) localStorage.setItem('blockroll.' + k, JSON.stringify(st[k])); } },
      Object.assign({ intro: { switch: 1, frag: 1, mode: 1, split: 1 }, unlockAll: true }, store));
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const st = () => p.evaluate(() => Object.assign(__game.state(), __game.more()));
    const idle = () => p.waitForFunction(() => !__game.state().animating);
    const sol = n => p.evaluate(n => solve(parseLevel(LEVELS[n - 1]), null, {}).sol, n);
    const level = async n => { await p.click('#tSelect'); await p.click(`.lt[data-n="${n}"]`); await p.waitForTimeout(80); };
    // play one solver move with the keyboard (selecting the right cube first when split)
    const play = async mv => { const s = await st(); if (s.split && s.active !== (mv >> 2)) await p.keyboard.press(' '); await p.keyboard.press(KEYS[mv & 3]); await idle(); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapEl = async sel => { const c = await center(sel); await touch('touchStart', [c]); await touch('touchEnd', []); };
    return { ctx, p, touch, st, idle, sol, level, play, center, tapEl };
  }

  // 1. 兩指：第二指落下時第一指還沒滑完，兩次滑動都要算（以前只記一個 pointer，第一指被吃掉）
  {
    const t = await open();
    await t.level(1); const s1 = await t.sol(1);
    const A = [120, 450], B = [280, 450], va = SWV[s1[0]], vb = SWV[s1[1]];
    await t.touch('touchStart', [[A[0], A[1], 1]]);
    await t.touch('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]);
    for (let k = 1; k <= 4; k++) await t.touch('touchMove', [[A[0] + va[0] * 10 * k, A[1] + va[1] * 10 * k, 1], [B[0], B[1], 2]]);
    for (let k = 1; k <= 4; k++) await t.touch('touchMove', [[A[0] + va[0] * 40, A[1] + va[1] * 40, 1], [B[0] + vb[0] * 10 * k, B[1] + vb[1] * 10 * k, 2]]);
    await t.touch('touchEnd', []); await t.idle(); await t.idle();
    eq((await t.st()).hist, s1.slice(0, 2), '兩指重疊滑動：兩次翻滾都有算（第二次排隊在第一次之後）');

    // 2. 排隊的「北」(0) 不會被第三次輸入蓋掉
    let n = 0, sol = null;
    for (let k = 1; k <= 30 && !n; k++) { const s = await t.sol(k); if (s[1] === 0 && s[0] !== 0) { n = k; sol = s; } }
    await t.p.keyboard.press('Escape'); await t.p.click('#pSelect'); await t.p.click(`.lt[data-n="${n}"]`); await t.p.waitForTimeout(80);
    await t.p.click('#bRestart'); // the level may hold the save from the swipes above
    await t.p.keyboard.press(KEYS[sol[0]]); await t.p.keyboard.press(KEYS[0]); await t.p.keyboard.press(KEYS[2]); await t.idle(); await t.idle();
    eq((await t.st()).hist, [sol[0], 0], `第 ${n} 關：翻滾中按「北」再按「南」，排隊的仍是北`);

    // 3. 翻滾中點悔棋：不會被吃掉（先把這一步落地再悔棋）
    await t.p.click('#bRestart'); await t.idle();
    await t.p.keyboard.press(KEYS[sol[0]]); await t.idle();
    // record whether the roll was still running when the button's click arrived
    await t.p.evaluate(() => { window.__clickAnim = []; document.addEventListener('click', e => { if (e.target.closest('.tb')) __clickAnim.push(__game.state().animating); }, true); });
    await t.p.keyboard.press(KEYS[sol[1]]); await t.tapEl('#bUndo'); await t.idle();
    const u = await t.st();
    eq(await t.p.evaluate(() => __clickAnim), [true], '（悔棋的點擊確實落在翻滾動畫中）');
    eq(u.hist, [sol[0]], '翻滾動畫中點悔棋：剛滑的那步被悔掉，不是被忽略');
    assert(!u.animating && u.status === 'play', '悔棋後沒有卡在動畫或別的畫面');

    // 4. 翻滾中按提示也會作用；同一局面再按一次不另外扣提示
    await t.p.keyboard.press(KEYS[sol[1]]); await t.tapEl('#bHint'); await t.p.waitForFunction(() => __game.more().hint >= 0, null, { timeout: 5000 });
    let h = await t.st();
    eq([h.hist.length, h.hints, h.hint], [2, 2, sol[2] & 3], '翻滾中按提示：落地後給下一步的箭頭，扣 1 次');
    eq(await t.p.evaluate(() => __clickAnim), [true, true], '（提示的點擊確實落在翻滾動畫中）');
    await t.p.click('#bHint'); await t.p.waitForTimeout(150); h = await t.st();
    eq([h.hints, h.hint], [2, sol[2] & 3], '箭頭還在時再按提示：不再扣次數');
    await t.play(sol[2]); h = await t.st();
    eq([h.hint, h.hints], [-1, 2], '照箭頭走一步後箭頭消失');
    await t.ctx.close();
  }

  // 5. 存檔：走到一半重新整理，標題顯示「繼續第 N 關」並接回同一個局面（含掉落次數與提示次數）
  {
    const t = await open();
    await t.level(12); const s = await t.sol(12);
    for (const mv of s.slice(0, 5)) await t.play(mv);
    await t.p.click('#bHint'); await t.p.waitForFunction(() => __game.more().hints === 2, null, { timeout: 8000 });
    // one fall: find a direction that falls from here
    const fallDir = await t.p.evaluate(() => { const L = parseLevel(LEVELS[11]); let S = initState(L); for (const mv of __game.more().hist) S = doMove(L, S, mv).S; for (let d = 0; d < 4; d++) if (doMove(L, S, d).ev.fail) return d; return -1; });
    if (fallDir >= 0) { await t.p.keyboard.press(KEYS[fallDir]); await t.p.waitForFunction(() => __game.more().falls === 1 && !__game.state().animating, null, { timeout: 4000 }); }
    const before = await t.st();
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq(await t.p.textContent('#tPlay'), '繼續第 12 關', '重新整理後：標題主按鈕是「繼續第 12 關」');
    await t.p.click('#tPlay'); await t.p.waitForTimeout(80);
    const after = await t.st();
    eq([after.level, after.hist, after.falls, after.moves, after.hints, after.key], [12, before.hist, before.falls, before.moves, 2, before.key], '接回同一局面：步數、掉落、提示次數都一樣');
    // from the level grid too
    await t.p.keyboard.press('Escape'); await t.p.click('#pSelect'); await t.p.click('.lt[data-n="12"]'); await t.p.waitForTimeout(80);
    eq((await t.st()).hist, before.hist, '從選關畫面點同一關也是接續');
    // 6. 翻滾還在半空中就切到背景（pagehide）：那一步也有存下來
    await t.p.keyboard.press(KEYS[s[5] & 3]);
    await t.p.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); });
    await t.p.reload(); await t.p.waitForFunction(() => window.__game); await t.p.click('#tPlay'); await t.p.waitForTimeout(80);
    eq((await t.st()).hist, before.hist.concat([s[5]]), '翻滾動畫中 pagehide：那一步有存到');
    // 7. 過關後存檔清掉；重來後也清掉
    await t.p.click('#bRestart'); await t.p.waitForTimeout(50);
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    assert(!/繼續第/.test(await t.p.textContent('#tPlay')), '按重來回到起點後：不再顯示「繼續第 N 關」');
    await t.p.click('#tSelect'); await t.p.click('.lt[data-n="12"]'); await t.p.waitForTimeout(80);
    for (const mv of s) await t.play(mv);
    await t.p.waitForFunction(() => __game.state().status === 'won', null, { timeout: 5000 });
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('blockroll.saves') || '{}')[12]), undefined, '過關後這關的存檔被清掉');
    await t.ctx.close();
  }

  // 8. 壞掉的存檔與紀錄：不接續、不出現 NaN，也不報錯
  {
    const t = await open(390, 844, {
      saves: { 3: { mv: [0, 0, 0, 0, 0, 0], f: 0, hl: 3, act: 0, t: 1 }, 4: { mv: ['x'], f: -1, hl: 9, act: 0, t: 2 }, 5: 'junk' },
      progress: { 1: { s: 3, b: 8 }, 2: { s: 'x', b: 3 }, 999: { s: 3, b: 1 }, 6: { s: 2, b: 2 } }, last: 3, settings: { sound: 'no', pad: 1 } });
    await t.p.click('#tSelect');
    eq(await t.p.textContent('#selSum'), '已通過 2/100・星星 5/300', '壞掉的過關紀錄被略過（不出現 NaN）');
    await t.p.click('.lt[data-n="3"]'); await t.p.waitForTimeout(80);
    eq([(await t.st()).hist.length, (await t.st()).moves], [0, 0], '走不通的存檔（會掉下去的步）不接續，從頭開始');
    await t.p.keyboard.press('Escape'); await t.p.click('#pSet');
    eq([await t.p.getAttribute('#oSound', 'aria-checked'), await t.p.getAttribute('#oPad', 'aria-checked'), await t.p.isVisible('#pad')], ['true', 'false', false], '型別錯的設定還原成預設值');
    await t.ctx.close();
  }

  // 9. 暫停→看示範：示範結束或被點掉後回到玩家原本的位置，不能把示範走完的局面拿來過關
  {
    const t = await open();
    await t.level(2); const s = await t.sol(2);
    for (const mv of s.slice(0, 3)) await t.play(mv);
    const mine = await t.st();
    await t.p.keyboard.press('Escape'); await t.p.click('#pDemo');
    await t.p.waitForFunction(() => __game.more().demo && __game.more().hist.length >= 2, null, { timeout: 8000 });
    await t.touch('touchStart', [[200, 450]]); await t.touch('touchEnd', []); await t.idle();
    let now = await t.st();
    eq([now.demo, now.hist, now.key], [false, mine.hist, mine.key], '點畫面停止示範：回到自己的局面，石碑沒被那一下推動');
    await t.p.keyboard.press('Escape'); await t.p.click('#pDemo');
    await t.p.waitForFunction(() => __game.more().demo && __game.more().hist.length >= 4, null, { timeout: 8000 });
    await t.p.keyboard.press('Escape'); await t.p.click('#pResume'); await t.p.waitForTimeout(50);
    now = await t.st();
    eq([now.demo, now.hist], [false, mine.hist], '示範中按暫停再繼續：也是回到自己的局面');
    await t.p.keyboard.press('Escape'); await t.p.click('#pDemo');
    await t.p.waitForFunction(() => !__game.more().demo && /示範完成/.test(document.getElementById('toast').textContent), null, { timeout: 30000 });
    now = await t.st();
    eq([now.status, now.hist], ['play', mine.hist], '示範看完：沒有算成過關，回到自己的局面');
    await t.ctx.close();
  }

  // 10. 方向鍵盤不蓋住棋盤（直向矮螢幕、直向、橫向）
  for (const [w, h, n] of [[375, 500, 40], [390, 844, 85], [844, 390, 85], [360, 640, 100]]) {
    const t = await open(w, h, { settings: { pad: true, zoom: false } });
    await t.level(n);
    const b = await t.p.evaluate(() => __game.board()), pad = await t.p.$eval('#pad', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const hit = !(b.r <= pad.l || b.l >= pad.r || b.b <= pad.t || b.t >= pad.b);
    assert(!hit, `${w}×${h} 第 ${n} 關開方向鍵：棋盤 (${b.l | 0}–${b.r | 0}, ${b.t | 0}–${b.b | 0}) 不在方向鍵 (${pad.l | 0}–${pad.r | 0}, ${pad.t | 0}–${pad.b | 0}) 底下`);
    assert(b.l >= 0 && b.r <= w && b.s >= 6, `${w}×${h} 第 ${n} 關：整個棋盤在畫面內（格子 ${b.s.toFixed(1)}px）`);
    // pad taps move once each
    const s = await t.sol(n);
    const sel = ['.pn', '.pe', '.ps', '.pw'][s[0] & 3];
    await t.tapEl('#pad ' + sel); await t.idle();
    eq((await t.st()).hist, [s[0]], `${w}×${h}：點方向鍵一次只翻一步`);
    await t.ctx.close();
  }

  // 11. 分裂後的提示箭頭跟著它要指的小方塊，切換後不會跑到另一顆上
  {
    const t = await open();
    await t.level(40); const s = await t.sol(40);
    let i = 0; while (!(await t.st()).split && i < s.length) await t.play(s[i++]);
    const sp = await t.st();
    assert(sp.split, `第 40 關照解答走 ${i} 步後分裂成兩顆`);
    await t.p.click('#bHint'); await t.p.waitForFunction(() => __game.more().hint >= 0, null, { timeout: 8000 });
    const h1 = await t.st();
    await t.p.click('#bSwap'); await t.p.waitForTimeout(50);
    const h2 = await t.st();
    assert(h1.hintCube >= 0 && h2.hintCube === h1.hintCube && h2.activeCell !== h1.activeCell, '切換方塊後：箭頭仍在原本那顆');
    await t.p.click('#bHint'); await t.p.waitForTimeout(100);
    const h3 = await t.st();
    eq([h3.hints, h3.activeCell], [h1.hints, h1.hintCube], '再按提示：不扣次數，並切回箭頭那顆');
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
