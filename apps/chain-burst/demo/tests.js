// 深海螢光：上架評分修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    const seed = Object.assign({ 'chainburst.intro': '{"basic":1,"big":1,"arm":1,"dark":1,"split":1,"abs":1}' }, opt.storage || {});
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, seed);
    if (opt.css) await p.addInitScript(css => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }), opt.css);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const st = () => p.evaluate(() => window.__game.state());
    const tap = async sel => { const b = await p.locator(sel).boundingBox(); await touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2]]); await sleep(40); await touch('touchEnd', []); await sleep(80); };
    // screen position of jelly i right now (logical -> screen)
    const jellyAt = i => p.evaluate(i => { const j = window.__game.jelly(i); return window.__game.toScreen(j.x, j.y); }, i);
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('chainburst.' + k)), k);
    const waitStatus = (s, ms = 30000) => p.waitForFunction(s => window.__game.state().status === s, s, { timeout: ms });
    return { ctx, p, cdp, touch, st, tap, jellyAt, ls, waitStatus };
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
    assert(Math.min(...hs) >= 44, `設定按鈕高度 ≥ 44px（最小 ${Math.min(...hs)}）`);
    await t.tap('#setOk'); await t.tap('#tStats'); await sleep(300);
    const sb = await t.p.textContent('#statsBody');
    assert(/最長連鎖0/.test(sb) && /總引爆數0/.test(sb) && /全滅關卡1/.test(sb), '紀錄頁數字都是合法數值');
    await t.ctx.close();
  }

  // 2. 真實觸控：按住瞄準、第二指不會搶走或多引爆、放開才引爆一次；放在海域外取消
  {
    const t = await open();
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const f = (await t.st()).field;
    await t.touch('touchStart', [[f.x + 30, f.y + 40]]); await sleep(60);
    await t.touch('touchMove', [[f.x - 20, f.y + 40]]); await sleep(40);
    await t.touch('touchEnd', []); await sleep(120);
    let s = await t.st(); eq([s.status, s.tapped], ['aim', false], '放開在海域外：取消，不引爆');
    const a = await t.jellyAt(0);
    await t.touch('touchStart', [[a.x, a.y, 1]]); await sleep(60);
    await t.touch('touchStart', [[a.x, a.y, 1], [f.x + f.w - 30, f.y + f.h - 30, 2]]); await sleep(60);
    await t.touch('touchEnd', [[f.x + f.w - 30, f.y + f.h - 30, 2]]); await sleep(60); // CDP touchEnd lists the points that lift: the second finger lifts first
    s = await t.st(); eq([s.tapped, s.aiming], [false, true], '第二指放開不引爆，第一指仍在瞄準');
    await t.touch('touchEnd', []); await sleep(100);
    s = await t.st(); eq([s.status, s.tapped], ['chain', true], '第一指放開才引爆');
    const j0 = await t.p.evaluate(() => window.__game.jelly(0));
    assert(Math.hypot(s.tapX - j0.x, s.tapY - j0.y) < 20, '引爆點在第一指的位置（不是第二指）');
    // 3. 連鎖中按重試：這一擊的結果照樣記下（用核心獨立重算比對）
    const exp = await expected(t, s);
    await t.tap('#bRetry'); await sleep(100);
    const st1 = await t.ls('stars'), sts = await t.ls('stats');
    eq([sts.taps, sts.pops], [1, exp], '連鎖中重試：引爆數照最終結果記一次');
    eq(!!(st1 && st1[1] > 0), exp >= 4, '過關與否照最終結果存下');
    eq((await t.st()).status, 'aim', '重試後立刻可以瞄準');
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
    // 5. 結果卡剛跳出時的誤觸不會按到「下一關」
    await t.p.waitForFunction(() => !document.getElementById('win').classList.contains('hidden') || !document.getElementById('fail').classList.contains('hidden'));
    const won = await t.p.isVisible('#win'), btn = won ? '#wNext' : '#fRetry';
    await t.tap(btn);
    eq((await t.st()).status, 'result', '結果卡出現 0.45 秒內的點擊被擋下');
    await sleep(500); await t.tap(btn); await sleep(100);
    const s3 = await t.st(); eq([s3.status, s3.level], ['aim', won ? 2 : 1], '之後的點擊正常生效');
    // 6. 切到背景時瞄準中自動暫停
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    eq((await t.st()).status, 'paused', '切到背景時暫停');
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await t.tap('#pResume'); eq((await t.st()).status, 'aim', '按繼續回到瞄準');
    await t.ctx.close();
  }

  // 7. 按住瞄準時旋轉螢幕：瞄準取消，放開不會在轉過的海域上亂引爆
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

  // 8. 安全區：橫向瀏海與底部 home 條不會蓋住海域
  {
    const t = await open(844, 390, { css: '#sap{padding:0 47px 21px 47px !important}' });
    await t.tap('#tPlay'); await t.waitStatus('aim');
    const f = (await t.st()).field;
    assert(f.x >= 47 && f.x + f.w <= 844 - 47 && f.y + f.h <= 390 - 21, `海域在安全區內（x ${f.x.toFixed(1)}–${(f.x + f.w).toFixed(1)}，底 ${(f.y + f.h).toFixed(1)}）`);
    await t.ctx.close();
  }

  await browser.close();
  assert(errors.length === 0, '沒有頁面錯誤' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
