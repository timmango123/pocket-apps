// 深海螢光：上架評分修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// served from an http origin (page.reload() and localStorage behave as on the real site, unlike file://)
const URL = 'http://chain-burst.test/', HTML = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEEN = '{"basic":1,"big":1,"arm":1,"dark":1,"split":1,"abs":1}';

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    await ctx.route('**/*', r => r.request().url() === URL ? r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }) : r.abort());
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    const seed = Object.assign({ 'chainburst.intro': SEEN }, opt.storage || {});
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, seed);
    if (opt.css) await p.addInitScript(css => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }), opt.css);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const st = () => p.evaluate(() => window.__game.state());
    const box = sel => p.locator(sel).boundingBox();
    const tapAt = async (x, y, hold = 40) => { await touch('touchStart', [[x, y]]); await sleep(hold); await touch('touchEnd', []); await sleep(80); };
    const tap = async (sel, hold) => { await p.locator(sel).waitFor({ state: 'visible', timeout: 5000 }); const b = await box(sel); await tapAt(b.x + b.width / 2, b.y + b.height / 2, hold); };
    // screen position of jelly i right now (logical -> screen)
    const jellyAt = i => p.evaluate(i => { const j = window.__game.jelly(i); return window.__game.toScreen(j.x, j.y); }, i);
    // screen -> logical sea coordinates
    const toSea = async (x, y) => { const f = (await st()).field, i = await p.evaluate(() => window.__game.info()); return { x: (x - f.x) / i.fs, y: (y - f.y) / i.fs }; };
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('chainburst.' + k)), k);
    const waitStatus = (s, ms = 30000) => p.waitForFunction(s => window.__game.state().status === s, s, { timeout: ms });
    const visible = id => p.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
    const waitCard = () => p.waitForFunction(() => ['win', 'fail'].some(id => !document.getElementById(id).classList.contains('hidden')), null, { timeout: 30000 });
    const gotoLevel = async n => { await tap('#tSelect'); await sleep(250); await p.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(150); await tap('.lt[data-n="' + n + '"]'); await waitStatus('aim', 5000); };
    return { ctx, p, cdp, touch, st, toSea, box, tap, tapAt, jellyAt, ls, waitStatus, visible, waitCard, gotoLevel };
  }
  // the count this tap must reach, computed independently with the game's own core
  const expected = (t, s) => t.p.evaluate(s => runTap(genLevel(s.level), s.tapFrame, s.tapX, s.tapY), s);

  // 1. 壞掉的存檔不會讓頁面掛掉，也不會讓星星變成字串相加
  {
    const t = await open(390, 844, { storage: {
      'chainburst.stars': '{"1":"3","2":3,"3":99,"abc":2,"500":1,"4":-1}', 'chainburst.progress': '[5,6]',
      'chainburst.settings': '{"snd":"yes","vib":false,"theme":"neon"}', 'chainburst.stats': '{"best":"lots","pops":-4,"taps":12.7}',
      'chainburst.daily': '{"20261029":"x","20261028":30,"oops":4}', 'chainburst.ach': '[1]', 'chainburst.wipes': '{"1":1,"2":"y"}', 'chainburst.unlockAll': '"true"' } });
    await sleep(300);
    await t.tap('#tSelect'); await sleep(300);
    eq(await t.p.textContent('#selSum'), '已通過 2 / 100 關・星星 6 / 300・光點越多越難', '只承認合法星數（2→3、3→99 夾成 3），字串與越界的丟掉');
    eq(await t.p.getAttribute('#unlockSw', 'aria-checked'), 'false', '字串 "true" 不會打開解鎖全部');
    eq(await t.p.evaluate(() => [...document.querySelectorAll('.lt.lock')].length), 96, '第 5 關以後仍上鎖');
    await t.tap('#sBack'); await sleep(200);
    eq(await t.p.textContent('#tPlay'), '繼續第 1 關', '開始按鈕顯示要繼續的關卡');
    await t.tap('#tSet'); await sleep(450);
    eq(await t.p.$$eval('#settings [aria-checked], #sTheme [aria-pressed="true"]', bs => bs.map(b => b.getAttribute('aria-checked') || b.textContent)), ['true', 'false', 'true', '自動'], '不合法設定回預設，合法的（震動關）保留');
    const hs = await t.p.$$eval('#settings button', bs => bs.map(b => b.getBoundingClientRect().height));
    assert(Math.min(...hs) >= 44, `設定按鈕（含主題分段）高度 ≥ 44px（最小 ${Math.min(...hs)}）`);
    await t.tap('#setOk'); await t.tap('#tStats'); await sleep(300);
    const sb = await t.p.textContent('#statsBody');
    assert(/最長連鎖0/.test(sb) && /總引爆數0/.test(sb) && /全滅關卡1/.test(sb), '紀錄頁數字都是合法數值');
    await t.ctx.close();
  }
  // 1b. 每個存檔鍵放 null、字串、數字、陣列、缺欄位或錯型別的物件、壞 JSON：都能開、能玩、能進每個畫面
  {
    const KEYS = ['progress', 'stars', 'unlockAll', 'settings', 'stats', 'wipes', 'ach', 'intro', 'daily'];
    const BAD = ['null', '"hello"', '42', '[1,2]', '{', '{"snd":null,"theme":7,"pops":"x","1":{"a":1},"__proto__":{"x":1}}', 'true', '{}'];
    const t = await open();
    let ok = 0;
    for (const v of BAD) {
      await t.p.evaluate(([keys, v]) => keys.forEach(k => localStorage.setItem('chainburst.' + k, v)), [KEYS, v]);
      const before = errors.length;
      try {
        await t.p.reload(); await t.p.waitForFunction(() => window.__game);
        for (const [o, back] of [['#tStats', '#stOk'], ['#tSet', '#setOk'], ['#tSelect', '#sBack']]) { await t.tap(o); await t.tap(back); }
        await t.tap('#tPlay'); await t.p.waitForFunction(() => ['aim', 'intro'].includes(window.__game.state().status), null, { timeout: 5000 });
        if (errors.length === before) ok++; else console.log('  bad value', v, errors.slice(before).join(' | '));
      } catch (e) { console.log('  bad value', v, String(e).slice(0, 120)); }
    }
    await t.ctx.close();
    eq(ok, BAD.length, '壞存檔（null／字串／數字／陣列／壞 JSON／錯型別欄位）不會讓頁面出錯，每個畫面都能開');
  }

  // 2. 真實觸控：按住瞄準、後按下海域的手指接手瞄準（先按的手指抬起不再引爆）、放開才引爆一次；放在海域外取消；按下就收起提示
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    eq(await t.visible('hint'), true, '第 1 關開局有提示');
    const f = (await t.st()).field;
    await t.touch('touchStart', [[f.x + 30, f.y + 40]]); await sleep(60);
    eq(await t.visible('hint'), false, '手指一按下提示膠囊就收起，不擋海域');
    await t.touch('touchMove', [[f.x - 20, f.y + 40]]); await sleep(40);
    await t.touch('touchEnd', []); await sleep(120);
    let s = await t.st(); eq([s.status, s.tapped], ['aim', false], '放開在海域外：取消，不引爆');
    const a = await t.jellyAt(0), q2 = [f.x + f.w - 30, f.y + f.h - 30, 2];
    await t.touch('touchStart', [[f.x + 30, f.y + 30, 1]]); await sleep(60);
    await t.touch('touchStart', [[f.x + 30, f.y + 30, 1], [a.x, a.y, 2]]); await sleep(60);
    await t.touch('touchMove', [[f.x + 30, f.y + 30, 1], [a.x, a.y, 2]]); await sleep(30);
    s = await t.st(); eq([s.tapped, s.aiming], [false, true], '第二指按下海域：接手瞄準，還沒引爆');
    const want = await t.toSea(a.x, a.y);
    await t.touch('touchEnd', [[a.x, a.y, 2]]); await sleep(80); // CDP touchEnd lists the points that lift
    s = await t.st(); eq([s.status, s.tapped], ['chain', true], '後按的手指放開就引爆（不被先按的手指吞掉）');
    assert(Math.hypot(s.tapX - want.x, s.tapY - want.y) < 3, `引爆點在後按手指的位置（${s.tapX.toFixed(0)},${s.tapY.toFixed(0)}）`);
    const tx = s.tapX;
    await t.touch('touchEnd', []); await sleep(100);
    s = await t.st(); eq([s.tapped, s.tapX], [true, tx], '先按的手指抬起：不再引爆，也不改引爆點');
    // 3. 連鎖中按重試：這一擊的結果照樣記下（用核心獨立重算比對）
    const exp = await expected(t, s);
    await t.tap('#bRetry'); await sleep(100);
    const st1 = await t.ls('stars'), sts = await t.ls('stats');
    eq([sts.taps, sts.pops], [1, exp], '連鎖中重試：引爆數照最終結果記一次');
    eq(!!(st1 && st1[1] > 0), exp >= 4, '過關與否照最終結果存下');
    eq((await t.st()).status, 'aim', '重試後立刻可以瞄準');
    await t.ctx.close();
  }

  // 2b. 另一指放在海域外（下方空白、側邊、HUD 背景）或海域邊上不放，點水母照樣在點的位置引爆；放著的手指抬起不改任何事
  {
    const t = await open(390, 844, { storage: { 'chainburst.unlockAll': 'true' } });
    await t.gotoLevel(2);
    const f = (await t.st()).field, hud = await t.box('#hud');
    const rests = { '海域下方空白': [195, 835], '下方中間': [195, Math.min(843, (f.y + f.h + 844) / 2)], '左側邊緣外': [Math.max(1, f.x - 30), f.y + f.h * 0.9], '海域內左緣': [f.x + 4, f.y + f.h * 0.9], 'HUD 背景': [200, hud.y + hud.height / 2] };
    for (const [name, r] of Object.entries(rests)) {
      await t.tap('#bRetry'); await t.waitStatus('aim');
      const a = await t.jellyAt(0), want = await t.toSea(a.x, a.y);
      await t.touch('touchStart', [[r[0], r[1], 2]]); await sleep(150);
      await t.touch('touchStart', [[r[0], r[1], 2], [a.x, a.y, 1]]); await sleep(60);
      await t.touch('touchEnd', [[a.x, a.y, 1]]); await sleep(120);
      const mid = await t.st();
      await t.touch('touchEnd', []); await sleep(120);
      const end = await t.st();
      assert(mid.tapped && Math.hypot(mid.tapX - want.x, mid.tapY - want.y) < 3 && end.tapX === mid.tapX, `另一指放在${name}：點水母照樣引爆在點的位置`);
    }
    await t.ctx.close();
  }

  // 4. 連鎖中 App 被關（pagehide）：結果先存好；回來看完連鎖也不會重複計算
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const a = await t.jellyAt(0);
    await t.touch('touchStart', [[a.x, a.y]]); await sleep(50); await t.touch('touchEnd', []); await sleep(80);
    const s = await t.st(); eq(s.status, 'chain', '引爆開始連鎖');
    const exp = await expected(t, s);
    await t.p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    eq((await t.ls('stats')).pops, exp, 'pagehide 時就存下這一擊的最終引爆數');
    eq((await t.st()).banked, exp, '存下的數字＝核心重算的結果');
    await t.waitStatus('result');
    const s2 = await t.st(); eq(s2.count, exp, '畫面上的連鎖跑完也是同一個數字');
    eq((await t.ls('stats')).pops, exp, '連鎖結束不會再加一次');
    await t.waitCard();
    const won = await t.visible('win'), main = won ? '#wNext' : '#fRetry';
    // 5. 慢動作重播中，在結果卡按鈕的位置點一下跳過：只會回到結果卡，不會按到「下一關／再試一次」（3 次）
    let ghost = 0;
    for (let i = 0; i < 3; i++) {
      const b = await t.box(main), bx = b.x + b.width / 2, by = b.y + b.height / 2;
      await t.tap(won ? '#wReplay' : '#fReplay'); await sleep(250);
      eq((await t.st()).status, 'replay', `重播開始（第 ${i + 1} 次）`);
      await t.tapAt(bx, by, 70); await sleep(350);
      const q = await t.st();
      if (q.status !== 'result' || q.level !== 1 || !(await t.visible(won ? 'win' : 'fail'))) ghost++;
    }
    eq(ghost, 0, '重播中點畫面跳過：3/3 停在結果卡，沒有誤觸卡片按鈕');
    // 5b. 「下一關」連點兩下（間隔約 120ms）：第二下不會變成下一關的那一擊
    if (won) {
      const b = await t.box('#wNext'), x = b.x + b.width / 2, y = b.y + b.height / 2;
      await t.touch('touchStart', [[x, y]]); await sleep(50); await t.touch('touchEnd', []); await sleep(70);
      await t.touch('touchStart', [[x, y]]); await sleep(50); await t.touch('touchEnd', []); await sleep(150);
      const q = await t.st(); eq([q.level, q.status, q.tapped], [2, 'aim', false], '連點兩下下一關：只進第 2 關，這關的一擊還在');
    } else { await t.tap('#fRetry'); await sleep(100); }
    // 6. 切到背景時瞄準中自動暫停
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    eq((await t.st()).status, 'paused', '切到背景時暫停');
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await t.tap('#pResume'); eq((await t.st()).status, 'aim', '按繼續回到瞄準');
    await t.ctx.close();
  }

  // 7. 按鈕的觸控規則：按住 0.6 / 1 秒、邊緣外幾 px、另一指按著時，都剛好觸發一次；按下後滑走不觸發；不留焦點；鍵盤可用
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    let n = 0;
    for (const hold of [40, 600, 1000]) { await t.tap('#bMenu', hold); if ((await t.st()).status === 'paused') n++; await t.tap('#pResume', hold); if ((await t.st()).status === 'aim') n++; }
    eq(n, 6, '單點、按住 0.6 秒、按住 1 秒：選單／繼續各觸發一次');
    let b = await t.box('#bMenu');
    // pressed just inside the edge, the finger rolls 14px out before lifting: still the same button
    await t.touch('touchStart', [[b.x + b.width - 3, b.y + b.height / 2]]); await sleep(40);
    await t.touch('touchMove', [[b.x + b.width + 11, b.y + b.height / 2 + 4]]); await sleep(40); await t.touch('touchEnd', []); await sleep(80);
    eq((await t.st()).status, 'paused', '在按鈕邊緣按下、放開時已滑出邊緣 11px：仍算按到');
    eq(await t.p.evaluate(() => document.activeElement === document.body), true, '觸控按鈕後沒有元素拿到焦點');
    await t.tap('#pResume');
    b = await t.box('#bRetry'); await sleep(300);
    const fr0 = (await t.st()).frame;
    await t.touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2]]); await sleep(40);
    await t.touch('touchMove', [[b.x + b.width / 2 - 60, b.y + b.height + 60]]); await sleep(40); await t.touch('touchEnd', []); await sleep(100);
    eq((await t.st()).frame > fr0, true, '在重試鈕按下、滑到別處放開：不觸發（關卡沒有重來）');
    // another finger is already holding the aim; a tap on the menu button still fires once and drops the aim
    const f = (await t.st()).field, mb = await t.box('#bMenu');
    await t.touch('touchStart', [[f.x + f.w / 2, f.y + f.h / 2, 1]]); await sleep(60);
    await t.touch('touchStart', [[f.x + f.w / 2, f.y + f.h / 2, 1], [mb.x + 22, mb.y + 22, 2]]); await sleep(60);
    await t.touch('touchEnd', [[mb.x + 22, mb.y + 22, 2]]); await sleep(80);
    eq((await t.st()).status, 'paused', '一指按著海域時，另一指點選單：觸發一次');
    await t.touch('touchEnd', []); await sleep(80);
    let s = await t.st(); eq([s.status, s.tapped], ['paused', false], '暫停後第一指放開不會引爆');
    await t.p.focus('#pResume'); await t.p.keyboard.press('Enter'); await sleep(80);
    eq((await t.st()).status, 'aim', '鍵盤 Enter 仍可按按鈕');
    await t.ctx.close();
  }

  // 4b. 連鎖中直接重新整理（沒有 pagehide 的機會也一樣）：重開後那一擊照樣記一次，再重整不會重複
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const a = await t.jellyAt(0);
    await t.touch('touchStart', [[a.x, a.y]]); await sleep(50); await t.touch('touchEnd', []); await sleep(60);
    const s = await t.st(); eq(s.status, 'chain', '引爆開始連鎖');
    const exp = await expected(t, s);
    // simulate a killed tab: wipe what pagehide banked, keep only what was written at the moment of the shot
    const pend = await t.ls('pending');
    assert(pend && pend.f === s.tapFrame && pend.m === 'level' && pend.L === 1, '一引爆就先記下這一擊（關卡、幀、位置）');
    // simulate a killed tab: drop what was saved so far except the shot itself, and let nothing be written while it unloads
    await t.p.evaluate(() => { localStorage.removeItem('chainburst.stats'); localStorage.removeItem('chainburst.stars'); Storage.prototype.setItem = function () {}; Storage.prototype.removeItem = function () {}; });
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    const sts = await t.ls('stats'), stars = await t.ls('stars');
    eq([sts && sts.taps, sts && sts.pops], [1, exp], '重新整理後：這一擊照最終結果記一次');
    eq(!!(stars && stars[1] > 0), exp >= 4, '重新整理後：過關與星星照結果存下');
    eq(await t.ls('pending'), null, '記完就清掉暫存');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq((await t.ls('stats')).pops, exp, '再重新整理一次也不會重複計算');
    await t.ctx.close();
  }

  // 8. 兩群並排的關卡：點中其中一群只亮一群（失敗訊息說原因）；點在兩群中間兩群都亮；HUD 有二星、三星刻度（第 20 關）
  {
    const t = await open(390, 844, { storage: { 'chainburst.unlockAll': 'true' } });
    await t.gotoLevel(20);
    const info = await t.p.evaluate(() => window.__game.info()), s0 = await t.st();
    eq(info.built, 'twin', '第 20 關是兩群並排的海域');
    const ticks = await t.p.$$eval('#hMark2, #hMark3', es => es.map(e => !e.classList.contains('hidden') && e.getBoundingClientRect().left));
    assert(ticks.every(Boolean) && ticks[0] < ticks[1], 'HUD 目標條上看得到二星、三星刻度');
    const a = await t.jellyAt(0);
    await t.tapAt(a.x, a.y, 40); await t.waitCard();
    eq(await t.visible('fail'), true, '只點中一群：引爆數不到目標');
    assert(/其中一群/.test(await t.p.textContent('#fMsg')), '失敗訊息說明「光只點亮了其中一群」');
    // the best tap at frame 0 per the core is between the two schools and lights both
    await t.tap('#fRetry'); await t.waitStatus('aim');
    const best = await t.p.evaluate(() => { const lv = genLevel(20), r = gridSearch(lv, 0); let i = r.grid.indexOf(r.best); return { c: r.best, x: (i % 24 + 0.5) * FW / 24, y: (Math.floor(i / 24) + 0.5) * FH / 40, T: lv.P.T, a: lv.jellies.filter(j => j.g === 0).length, b: lv.jellies.filter(j => j.g === 1).length }; });
    assert(best.a < best.T && best.b < best.T && best.c >= best.T, `兩群各自都不到目標（${best.a}、${best.b} < ${best.T}），中間點一下可得 ${best.c}`);
    eq(s0.T, best.T, '畫面上的目標與核心一致');
    await t.ctx.close();
  }

  // 8b. 後段（65 關以後）也是需要瞄準的兩群排列，失敗訊息說明原因
  {
    const t = await open(390, 844, { storage: { 'chainburst.unlockAll': 'true' } });
    await t.gotoLevel(42);
    assert(/分開/.test(await t.p.textContent('#hint')), '第 42 關（兩排開始漂開）開局提示：' + await t.p.textContent('#hint'));
    await t.tap('#bMenu'); await t.tap('#pHome'); await sleep(200);
    eq(await t.p.evaluate(() => [80, 90, 95, 100].map(L => genLevel(L).built)), ['twin', 'twin', 'twin', 'twin'], '第 80／90／95／100 關也是兩群並排的海域');
    for (const L of [70]) {
      await t.gotoLevel(L);
      eq((await t.p.evaluate(() => window.__game.info())).built, 'twin', `第 ${L} 關是兩群並排的海域`);
      if (L === 70) {
        const one = await t.p.evaluate(() => { const lv = genLevel(70), j = lv.jellies.findIndex(o => o.g === 0 && o.k === 0); return j; });
        const a = await t.jellyAt(one);
        await t.tapAt(a.x, a.y, 40); await t.waitCard();
        eq(await t.visible('fail'), true, '第 70 關只點中一群：引爆數不到目標');
        assert(/其中一群.*最靠近/.test(await t.p.textContent('#fMsg')), '第 70 關失敗訊息說明「只點亮其中一群」，並提示深海兩群會分開、點最靠近的那一頭');
        await t.tap('#fRetry'); await t.waitStatus('aim');
        await t.tap('#bMenu'); await t.tap('#pHome'); await sleep(200);
      }
    }
    await t.ctx.close();
  }

  // 9. 按住瞄準時旋轉螢幕：瞄準取消，放開不會在轉過的海域上亂引爆
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const a = await t.jellyAt(0);
    await t.touch('touchStart', [[a.x, a.y]]); await sleep(60);
    await t.p.setViewportSize({ width: 844, height: 390 }); await sleep(200);
    await t.touch('touchEnd', []); await sleep(100);
    const s = await t.st(); eq([s.land, s.tapped, s.status], [true, false, 'aim'], '旋轉後放開不引爆，仍在瞄準');
    await t.ctx.close();
  }

  // 10. 安全區：橫向瀏海與底部 home 條不會蓋住海域
  {
    const t = await open(844, 390, { css: '#sap{padding:0 47px 21px 47px !important}' });
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const f = (await t.st()).field;
    assert(f.x >= 47 && f.x + f.w <= 844 - 47 && f.y + f.h <= 390 - 21, `海域在安全區內（x ${f.x.toFixed(1)}–${(f.x + f.w).toFixed(1)}，底 ${(f.y + f.h).toFixed(1)}）`);
    await t.ctx.close();
  }

  // 11. 窄螢幕與大廳尺寸：水母畫出來至少約 15px 寬，但放大不超過 1.3 倍（看起來相碰卻連不到的錯覺）
  for (const [w, h] of [[360, 640], [375, 500]]) {
    const t = await open(w, h);
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const i = await t.p.evaluate(() => window.__game.info());
    const d = 2 * 10.5 * i.fs * i.jsc;
    assert(d >= 15 && i.jsc <= 1.3, `${w}×${h}：水母直徑 ${d.toFixed(1)}px，放大 ${i.jsc.toFixed(2)} 倍`);
    await t.ctx.close();
  }

  // 12. 真實觸控點一下按鈕後，瀏覽器（如 CI 的 Chromium 141）再送一個 detail 0 的 click：動作只跑一次；單獨的 detail 0 click（無障礙、鍵盤式）仍跑一次
  {
    const t = await open(390, 844, { storage: { 'chainburst.unlockAll': 'true' } });
    const install = () => t.p.evaluate(() => { window.__runs = 0; document.querySelectorAll('button').forEach(b => { if (!b.__cnt) { b.__cnt = 1; b.addEventListener('click', () => { window.__runs++; }); } }); });
    const d0 = id => t.p.evaluate(id => document.getElementById(id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), id);
    const toResult = async win => {
      await t.waitStatus('aim');
      let q;
      if (win) { const b = await t.p.evaluate(() => { const s = window.__game.state(), f = s.frame + 20, lv = genLevel(s.level), r = gridSearch(lv, f), i = r.grid.indexOf(r.best); return { f, x: (i % 24 + 0.5) * FW / 24, y: (Math.floor(i / 24) + 0.5) * FH / 40 }; }); await t.p.waitForFunction(f => window.__game.state().frame >= f, b.f); q = await t.p.evaluate(b => window.__game.toScreen(b.x, b.y), b); }
      else q = await t.p.evaluate(() => window.__game.toScreen(3, 3));
      await t.tapAt(q.x, q.y, 40); await t.waitCard(); await sleep(400);
    };
    const cases = {
      tPlay: async () => {}, tSelect: async () => {},
      bMenu: async () => { await t.gotoLevel(3); }, pResume: async () => { await t.gotoLevel(3); await t.tap('#bMenu'); },
      bRetry: async () => { await t.gotoLevel(3); await sleep(500); }, pHome: async () => { await t.gotoLevel(3); await t.tap('#bMenu'); },
      fRetry: async () => { await t.gotoLevel(3); await toResult(false); }, wReplay: async () => { await t.gotoLevel(3); await toResult(true); },
      // straight after 慢動作重播: skip it with a tap on the sea and use the same result card
      wNext: async () => { await sleep(300); await t.tapAt(195, 420, 40); await t.waitCard(); await sleep(400); }
    };
    const bad = [];
    for (const [id, setup] of Object.entries(cases)) {
      if (id !== 'wNext') { await t.p.evaluate(() => window.__game.home()); await sleep(150); } await setup(); await sleep(200); await install();
      await t.tap('#' + id); await d0(id); await sleep(350);
      const n = await t.p.evaluate(() => window.__runs), q = await t.st();
      if (n !== 1) bad.push(id + '×' + n);
      if (id === 'wNext') eq([q.level, q.status], [4, 'aim'], '點「下一關」後再來一個 detail 0 click：只到第 4 關');
    }
    eq(bad, [], '9 個按鈕真實點一下＋detail 0 click：每個都只執行一次');
    await t.p.evaluate(() => window.__game.home()); await sleep(900); await install();
    await d0('tSelect'); await sleep(300);
    eq([await t.p.evaluate(() => window.__runs), (await t.st()).status], [1, 'select'], '沒有觸控時單獨的 detail 0 click 仍執行一次');
    await t.ctx.close();
  }

  await browser.close();
  assert(errors.length === 0, '沒有頁面錯誤' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
