// 石碑翻滾：上架評分 toFix 的回歸測試（node tests.js，約 60–80 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const APP = path.resolve(__dirname, '../index.html');
let URL = 'file://' + APP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
// screen swipe vectors for N / E / S / W (the board is drawn at 45°)
const SWV = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
const OPP = [2, 3, 0, 1];
const INTRO = { switch: 1, frag: 1, mode: 1, split: 1, portal: 1, ice: 1, spring: 1, t_zoom: 1 };

// ---- 0. levels (Node, no browser): stored solutions, new mechanisms, shorter late levels, no wall at L40
{
  const html = fs.readFileSync(APP, 'utf8');
  const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, doMove, solve};')();
  const LV = JSON.parse('[' + html.match(/var LEVELS = \[\n([\s\S]*?)\n\];/)[1] + ']');
  let okSol = true, use = { 55: 0, 70: 0, 85: 0 }, maxLate = 0;
  for (let n = 1; n <= LV.length; n++) {
    const L = core.parseLevel(LV[n - 1]), sol = LV[n - 1].s.split('').map(Number); let S = core.initState(L), won = false;
    for (let i = 0; i < sol.length; i++) { const r = core.doMove(L, S, sol[i]); if (r.ev.fail) break; if (n === 55 && r.ev.port != null) use[55]++; if (n === 70 && r.ev.slide) use[70]++; if (n === 85 && r.ev.jump != null) use[85]++; if (r.ev.win) { won = i === sol.length - 1; break; } S = r.S; }
    if (!won || sol.length !== LV[n - 1].o) { okSol = false; console.log('  L' + n + ' stored solution does not win in o moves'); }
    if (n > 50) maxLate = Math.max(maxLate, LV[n - 1].o);
  }
  assert(okSol, '100 關的內建最短解都能照走過關，步數等於「最少」');
  assert(use[55] > 0 && use[70] > 0 && use[85] > 0, `新機關：L55 石門 ${use[55]} 次、L70 冰面滑行 ${use[70]} 次、L85 彈跳石 ${use[85]} 次（都在最短解上）`);
  assert(maxLate <= 80, `後段最短步數上限 ${maxLate}（≤ 80）`);
  const st = n => core.solve(core.parseLevel(LV[n - 1]), null, { limit: 3000000, trap: true }).states; // every position reachable from the start
  const s10 = st(10), s25 = st(25), s39 = st(39), s40 = st(40), s41 = st(41);
  assert(s10 >= 60 && s25 >= 400 && s39 >= 900, `前段有岔路：可走狀態 L10 ${s10}、L25 ${s25}、L39 ${s39}`);
  assert(s40 <= 4 * s39 && s41 <= 4 * s39, `L40 分裂關不是牆：L39 ${s39} → L40 ${s40} → L41 ${s41}（×${(s40 / s39).toFixed(1)}）`);
  const kinds = n => new Set(LV[n - 1].r.replace(/[\/.oSG]/g, '').split(''));
  assert([...kinds(40)].filter(c => 'wXB'.includes(c)).length <= 2 && LV[39].sw.length <= 1, 'L40 過渡關：只有 1 個開關，以分裂為主');
}

(async () => {
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, store = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(st => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in st) localStorage.setItem('blockroll.' + k, JSON.stringify(st[k])); } },
      Object.assign({ intro: INTRO, unlockAll: true }, store));
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const st = () => p.evaluate(() => Object.assign(__game.state(), __game.more()));
    const idle = () => p.waitForFunction(() => !__game.state().animating, null, { timeout: 10000 });
    const sol = n => p.evaluate(n => LEVELS[n - 1].s.split('').map(Number), n);
    const level = async n => { await p.click('#tSelect'); await p.click(`.lt[data-n="${n}"]`); await p.waitForFunction(n => __game.state().status === 'play' && __game.state().level === n, n); };
    const play = async mv => { const s = await st(); if (s.split && s.active !== (mv >> 2)) await p.keyboard.press(' '); await p.keyboard.press(KEYS[mv & 3]); await idle(); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (x, y, id = 1) => { await touch('touchStart', [[x, y, id]]); await touch('touchEnd', []); };
    const tapEl = async sel => { const c = await center(sel); await tapAt(c[0], c[1]); };
    // Chromium 141 follows a tap whose pointerdown was preventDefault-ed with a click of detail 0: replay one right after
    // the real tap, so each control is checked to act exactly once
    const echo = sel => p.$eval(sel, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    const tapEcho = async sel => { await tapEl(sel); await echo(sel); };
    const swipe = async (x, y, d, id = 1, len = 40) => { const v = SWV[d]; await touch('touchStart', [[x, y, id]]); await touch('touchMove', [[x + v[0] * len / 2, y + v[1] * len / 2, id]]); await touch('touchMove', [[x + v[0] * len, y + v[1] * len, id]]); await touch('touchEnd', []); };
    return { ctx, p, touch, st, idle, sol, level, play, center, tapAt, tapEl, tapEcho, echo, swipe, cdp };
  }

  // 1. 否決項：翻滾中的輸入排成先進先出佇列（至少 4 個），一個都不丟
  {
    const t = await open();
    await t.level(1); const s1 = await t.sol(1), d0 = s1[0];
    assert(/斜著滑/.test(await t.p.textContent('#toast')), '第 1 關開場提示寫明「斜著滑」');
    await t.p.evaluate(() => __game.setRoll(2.5)); // a slow roll: all three swipes surely land while the first is still rolling
    await t.swipe(120, 450, d0); await t.swipe(260, 500, OPP[d0]); await t.swipe(120, 450, d0);
    const mid = await t.st();
    assert(mid.queue === 2 && mid.anim === 'roll', `翻滾中連滑三下：第 1 下在翻、後 2 下排隊（佇列 ${mid.queue}）`);
    await t.p.evaluate(() => __game.setRoll(0.16)); await t.idle();
    eq((await t.st()).hist, [d0, OPP[d0], d0], '三連滑：3/3 步都翻了，順序不變');
    eq(await t.p.evaluate(() => __game.consts().QMAX >= 4 && __game.consts().FALL <= 0.3), true, '佇列上限 ≥ 4、掉落動畫 ≤ 0.3 秒');
    // 8 swipes a second, alternating two areas of the screen, 16 swipes: all 16 count
    await t.p.click('#bRestart'); await t.idle();
    const t0 = Date.now();
    for (let k = 0; k < 16; k++) { const due = t0 + k * 125; const w = due - Date.now(); if (w > 0) await t.p.waitForTimeout(w); await t.swipe(k % 2 ? 280 : 110, k % 2 ? 560 : 380, k % 2 ? OPP[d0] : d0, 1 + (k % 2)); }
    await t.idle();
    const h16 = await t.st();
    eq([h16.hist.length, h16.falls], [16, 0], `每秒 8 次交替兩區滑 16 下：收到 ${h16.hist.length} 步、掉落 ${h16.falls}`);

    // 2. 兩指：第二指落下時第一指還沒滑完，兩次滑動都要算
    await t.p.click('#bRestart'); await t.idle();
    const A = [120, 450], B = [280, 450], va = SWV[s1[0]], vb = SWV[s1[1]];
    await t.touch('touchStart', [[A[0], A[1], 1]]);
    await t.touch('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]);
    for (let k = 1; k <= 4; k++) await t.touch('touchMove', [[A[0] + va[0] * 10 * k, A[1] + va[1] * 10 * k, 1], [B[0], B[1], 2]]);
    for (let k = 1; k <= 4; k++) await t.touch('touchMove', [[A[0] + va[0] * 40, A[1] + va[1] * 40, 1], [B[0] + vb[0] * 10 * k, B[1] + vb[1] * 10 * k, 2]]);
    await t.touch('touchEnd', []); await t.idle();
    eq((await t.st()).hist, s1.slice(0, 2), '兩指重疊滑動：兩次翻滾都有算');

    // 3. 掉落：之前排隊的清掉，掉落中的新輸入保留，退回後立刻執行
    await t.p.click('#bRestart'); await t.idle();
    const fd = await t.p.evaluate(() => { const L = parseLevel(LEVELS[0]), S = initState(L); for (let d = 0; d < 4; d++) if (doMove(L, S, d).ev.fail) return d; return -1; });
    await t.p.keyboard.press(KEYS[fd]);
    await t.p.waitForFunction(() => /tumble|drop/.test(__game.more().anim));
    await t.p.keyboard.press(KEYS[d0]);
    await t.idle();
    const f = await t.st();
    eq([f.falls, f.hist], [1, [d0]], '掉落動畫中滑的那一步：退回後照樣執行，不被吃掉');

    // 4. 翻滾中點悔棋、提示：排進同一個佇列，落地後執行
    await t.p.click('#bRestart'); await t.idle();
    await t.p.evaluate(() => __game.setRoll(0.6));
    await t.p.keyboard.press(KEYS[s1[0]]); await t.tapEl('#bUndo');
    eq((await t.st()).anim, 'roll', '（悔棋點在翻滾動畫中）');
    await t.idle();
    eq((await t.st()).hist, [], '翻滾中點悔棋：剛滑的那步落地後被悔掉');
    await t.p.keyboard.press(KEYS[s1[0]]); await t.tapEl('#bHint');
    await t.p.waitForFunction(() => __game.more().hint >= 0, null, { timeout: 5000 });
    let h = await t.st();
    eq([h.hist.length, h.hints, h.hint], [1, 2, s1[1] & 3], '翻滾中按提示：落地後給下一步的箭頭，扣 1 次');
    await t.p.evaluate(() => __game.setRoll(0.16));
    await t.p.click('#bHint'); await t.p.waitForTimeout(150); h = await t.st();
    eq([h.hints, h.hint], [2, s1[1] & 3], '箭頭還在時再按提示：不再扣次數');

    // 5. 直上直下的滑動（離軸線 < 10°）不翻滾，提示要斜著滑；30° 的滑動照常
    await t.p.click('#bRestart'); await t.idle();
    await t.touch('touchStart', [[200, 500]]); await t.touch('touchMove', [[202, 470]]); await t.touch('touchMove', [[203, 440]]); await t.touch('touchEnd', []);
    await t.idle();
    const ax = await t.st();
    assert(ax.hist.length === 1 && /斜著滑/.test(await t.p.textContent('#toast')), '幾乎正上方的滑動（離軸 < 10°）：照常翻一步（不吃掉），第一次出現時提示「斜著滑」');
    await t.ctx.close();
  }

  // 6. 分裂後：翻滾中按「切換」或點另一顆方塊，落地後套用（不再被忽略）；小方塊點選範圍放大
  {
    const t = await open(390, 844, { settings: { zoom: false } });
    await t.level(40); const s = await t.sol(40);
    let i = 0; while (!(await t.st()).split && i < s.length) await t.play(s[i++]);
    let sp = await t.st();
    assert(sp.split, `第 40 關照解答走 ${i} 步後分裂成兩顆`);
    // a cube move that doesn't fall
    const mv = await t.p.evaluate(() => { const L = parseLevel(LEVELS[39]); let S = initState(L); for (const m of __game.more().hist) S = doMove(L, S, m).S; const w = __game.state().active; for (let d = 0; d < 4; d++) { const r = doMove(L, S, d + 4 * w); if (!r.ev.fail && !r.S.s) return d; } return -1; });
    await t.p.evaluate(() => __game.setRoll(0.6));
    for (let k = 0; k < 4; k++) {
      sp = await t.st(); const other = sp.cubes[1 - sp.active];
      await t.p.keyboard.press(KEYS[mv]);
      await t.tapEcho('#bSwap');
      await t.idle(); const a = await t.st();
      if (!a.split) break;
      eq(a.activeCell, other, `翻滾中點「切換」(${k + 1}/4)：落地後換成另一顆`);
      await t.p.evaluate(() => __game.setRoll(0.16)); await t.p.keyboard.press(' '); await t.p.keyboard.press(KEYS[OPP[mv]]); await t.idle(); await t.p.evaluate(() => __game.setRoll(0.6));
    }
    // tap 30 px away from the other cube's centre while the active one rolls
    sp = await t.st(); const other = sp.cubes[1 - sp.active], oc = await t.p.evaluate(c => __game.center(c), other), mc = await t.p.evaluate(c => __game.center(c), sp.cubes[sp.active]);
    const ux = oc.x - mc.x, uy = oc.y - mc.y, ul = Math.hypot(ux, uy) || 1;
    await t.p.keyboard.press(KEYS[mv]); await t.tapAt(oc.x + ux / ul * 30, oc.y + uy / ul * 30); await t.idle();
    eq((await t.st()).activeCell, other, '翻滾中點另一顆方塊（離中心 30 px）：落地後選到它');
    await t.p.evaluate(() => __game.setRoll(0.16));
    await t.ctx.close();
  }

  // 7. 存檔：走到一半重新整理，標題顯示「繼續第 N 關」並接回同一個局面；「繼續」回到上次在玩的關，不是第一個未過的關
  {
    const t = await open(390, 844, { progress: { 1: { s: 3, b: 8 } } });
    await t.level(30); const s = await t.sol(30);
    for (const mv of s.slice(0, 6)) await t.play(mv);
    await t.p.click('#bHint'); await t.p.waitForFunction(() => __game.more().hints === 2, null, { timeout: 8000 });
    const before = await t.st();
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq(await t.p.textContent('#tPlay'), '繼續第 30 關', '只過第 1 關、在玩第 30 關時重新整理：主按鈕是「繼續第 30 關」（不是第 2 關）');
    await t.p.click('#tPlay'); await t.p.waitForTimeout(80);
    const after = await t.st();
    eq([after.level, after.hist, after.falls, after.hints, after.key], [30, before.hist, before.falls, 2, before.key], '接回同一局面：步數、掉落、提示次數都一樣');
    await t.p.keyboard.press(KEYS[s[6] & 3]);
    await t.p.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); });
    await t.p.reload(); await t.p.waitForFunction(() => window.__game); await t.p.click('#tPlay'); await t.p.waitForTimeout(80);
    eq((await t.st()).hist, before.hist.concat([s[6]]), '翻滾動畫中 pagehide：那一步有存到');
    await t.ctx.close();
  }

  // 8. 看示範：回到原本局面；看過示範的這一局最多 1 星，下一局恢復
  {
    const t = await open();
    await t.level(2); const s = await t.sol(2);
    for (const mv of s.slice(0, 3)) await t.play(mv);
    const mine = await t.st();
    await t.p.keyboard.press('Escape'); await t.p.click('#pDemo');
    await t.p.waitForFunction(() => __game.more().demo && __game.more().hist.length >= 2, null, { timeout: 8000 });
    await t.tapAt(200, 450); await t.idle();
    let now = await t.st();
    eq([now.demo, now.hist, now.key, now.demoSeen], [false, mine.hist, mine.key, true], '點畫面停止示範：回到自己的局面，記下「看過示範」');
    await t.p.click('#bRestart'); for (const mv of s) await t.play(mv);
    await t.p.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'));
    eq([await t.p.$$eval('#wStars .on', e => e.length), /最多 1 星/.test(await t.p.textContent('#wMsg'))], [1, true], '看過示範後用最少步數過關：只給 1 星並說明原因');
    await t.p.click('#wRetry'); for (const mv of s) await t.play(mv);
    await t.p.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'));
    eq(await t.p.$$eval('#wStars .on', e => e.length), 3, '下一局沒看示範：三星');
    await t.ctx.close();
  }

  // 9. 按鈕觸控：放開時在按鈕外 14 px 仍算、拖到 60 px 外不算；長按 1 秒算一次；另一指按著畫面時點按鈕也算；
  //    換畫面的點擊不會點到新畫面同位置的控制項；點按鈕不會讓它取得焦點
  {
    const t = await open();
    const box = sel => t.p.$eval(sel, e => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
    let b = await box('#tSelect');
    await t.touch('touchStart', [[b.l + 6, (b.t + b.b) / 2]]); await t.touch('touchMove', [[b.l - 14, (b.t + b.b) / 2 + 4]]); await t.touch('touchEnd', []);
    await t.p.waitForTimeout(60);
    eq(await t.p.isVisible('#select'), true, '放開點在按鈕左緣外 14 px：仍算點到');
    // the trusted click of that tap must not open a level under the finger on the new screen
    eq((await t.st()).status, 'select', '換到選關畫面後，同一下點擊沒有點到底下的關卡');
    await t.tapEl('#sBack'); await t.p.waitForTimeout(60);
    b = await box('#tSelect');
    await t.touch('touchStart', [[(b.l + b.r) / 2, (b.t + b.b) / 2]]); await t.touch('touchMove', [[(b.l + b.r) / 2, b.t - 60]]); await t.touch('touchEnd', []);
    await t.p.waitForTimeout(60);
    eq(await t.p.isVisible('#select'), false, '拖到按鈕外 60 px 才放開：不算');
    await t.level(1);
    await t.p.evaluate(() => { window.__undo = 0; document.getElementById('bUndo').addEventListener('click', () => __undo++); });
    const s1 = await t.sol(1); await t.play(s1[0]); await t.play(OPP[s1[0]]);
    const u = await t.center('#bUndo');
    await t.touch('touchStart', [[u[0], u[1]]]); await t.p.waitForTimeout(1000); await t.touch('touchEnd', []); await t.echo('#bUndo'); await t.p.waitForTimeout(60);
    eq([await t.p.evaluate(() => __undo), (await t.st()).hist.length], [1, 1], '長按悔棋 1 秒：只悔 1 步');
    await t.touch('touchStart', [[150, 450, 1]]); await t.touch('touchStart', [[150, 450, 1], [u[0], u[1], 2]]);
    await t.touch('touchEnd', [[u[0], u[1], 2]]); await t.touch('touchEnd', []); await t.p.waitForTimeout(60);
    eq([await t.p.evaluate(() => __undo), (await t.st()).hist.length], [2, 0], '一指按著畫面時點悔棋：生效一次');
    eq(await t.p.evaluate(() => document.activeElement === document.body || document.activeElement === null), true, '點過按鈕後沒有元素被聚焦（沒有殘影焦點）');
    await t.play(s1[0]); await t.p.focus('#bRestart'); await t.p.keyboard.press('Enter'); await t.p.waitForTimeout(40);
    eq((await t.st()).hist, [], '鍵盤 Enter 仍可按按鈕（重來）');
    await t.ctx.close();
  }

  // 10. 直式大地圖：開局先看全圖，再拉近跟隨；放大鍵標示「跟隨／全圖」；橫式底邊留白；靜止時不全速重畫；鏡頭移動不重畫地板
  {
    const t = await open(390, 844);
    await t.level(75);
    let s = await t.st();
    assert(s.zoom && s.overview > 0 && Math.abs(s.cam.s - s.cam.fit) < 0.01, `第 75 關：開局先顯示全圖（格子 ${s.cam.fit.toFixed(1)}）`);
    await t.p.waitForFunction(() => { const m = __game.more(); return m.overview === 0 && m.cam.s > m.cam.fit * 1.6; }, null, { timeout: 5000 });
    s = await t.st();
    eq(await t.p.textContent('#zLbl'), '跟隨', `約 1 秒後拉近跟隨（${s.cam.fit.toFixed(1)} → ${s.cam.s.toFixed(1)}），按鈕標「跟隨」`);
    await t.tapEcho('#bZoom'); await t.p.waitForTimeout(50);
    eq(await t.p.textContent('#zLbl'), '全圖', '點一下：切到全圖，按鈕標「全圖」');
    await t.tapEcho('#bZoom'); eq(await t.p.textContent('#zLbl'), '跟隨', '再點一次（含 detail 0 的追加 click）：只切一次，回到「跟隨」');
    await t.p.waitForFunction(() => !__game.more().lively, null, { timeout: 8000 });
    const fd0 = (await t.st()).floorDraws, sol = await t.sol(75);
    await t.play(sol[0]); await t.p.waitForFunction(() => !__game.more().lively, null, { timeout: 8000 });
    const fd1 = (await t.st()).floorDraws;
    assert(fd1 - fd0 <= 1, `跟隨鏡頭移動時地板圖只重畫 ${fd1 - fd0} 次（平移用快取）`);
    const f0 = (await t.st()).frames; await t.p.waitForTimeout(1000); const f1 = (await t.st()).frames;
    assert(f1 - f0 <= 8, `靜止 1 秒只重畫 ${f1 - f0} 次（不是每幀）`);
    // hint off the stored path is computed in slices: frames keep coming
    const off = await t.p.evaluate(() => { const L = parseLevel(LEVELS[74]), sol = LEVELS[74].s.split('').map(Number); let S = initState(L); const h = __game.more().hist; for (const m of h) S = doMove(L, S, m).S;
      const out = []; for (let k = 0; k < 3; k++) { let ok = -1; for (let d = 0; d < 4; d++) { const r = doMove(L, S, d); if (!r.ev.fail && !r.ev.win && d !== sol[h.length + k] && d !== (out.length ? [2, 3, 0, 1][out[out.length - 1]] : -1)) { ok = d; S = r.S; break; } } if (ok < 0) break; out.push(ok); } return out; });
    for (const d of off) await t.play(d);
    await t.p.evaluate(() => { window.__gap = 0; let last = performance.now(); (function f(){ const n = performance.now(); __gap = Math.max(__gap, n - last); last = n; if (!window.__stop) requestAnimationFrame(f); })(); });
    await t.tapEl('#bHint'); await t.p.waitForFunction(() => __game.more().hint >= 0, null, { timeout: 15000 });
    const gap = await t.p.evaluate(() => { window.__stop = 1; return __gap; });
    assert(gap < 250, `偏離最短解時按提示：畫面最長停頓 ${gap.toFixed(0)} ms`);
    await t.ctx.close();
    const t2 = await open(844, 390);
    await t2.level(60);
    const b = await t2.p.evaluate(() => __game.board());
    assert(b.b + b.s * 0.32 <= 390 - 14, `844×390 第 60 關：地圖最下緣離底邊 ${(390 - b.b - b.s * 0.32).toFixed(0)} px（≥ 14）`);
    await t2.ctx.close();
  }

  // 11. 方向鍵盤不蓋住棋盤，點一次只翻一步
  for (const [w, h, n] of [[375, 500, 40], [844, 390, 85]]) {
    const t = await open(w, h, { settings: { pad: true, zoom: false } });
    await t.level(n);
    const b = await t.p.evaluate(() => __game.board()), pad = await t.p.$eval('#pad', e => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const hit = !(b.r <= pad.l || b.l >= pad.r || b.b <= pad.t || b.t >= pad.b);
    assert(!hit && b.l >= 0 && b.r <= w, `${w}×${h} 第 ${n} 關開方向鍵：棋盤在畫面內、不在方向鍵底下`);
    const s = await t.sol(n);
    await t.tapEcho('#pad ' + ['.pn', '.pe', '.ps', '.pw'][s[0] & 3]); await t.idle();
    eq((await t.st()).hist, [s[0]], `${w}×${h}：點方向鍵一次只翻一步`);
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
