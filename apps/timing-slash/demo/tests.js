// 月下居合：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) 按鈕在 pointerup 依 pointerId 動作：另一指放著、兩指重疊、按住、點按後的 detail 0 click、換畫面、鍵盤、設定列文字
// 2) 壞掉的存檔不會讓遊戲當掉；舊存檔照常載入
// 3) 點在 HUD 按鈕旁邊不會印 console error（斬擊改用 pointerdown）
// 4) HUD 中間資訊條上的點擊也會出手
// 5) 無盡模式每輪 seed 不同；每日挑戰每天規則不同、難度相近
// 6) 標題、選關、設定頁都能靜音
// 7) 360x640 雙環＋練習的底部提示不會在字中間斷行
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

// ---------- core (the page's own rules) ----------
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn { dailyParams, diffOf, endlessParams, newGame, simulate, DAILY_BASE };')();

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const SCR = ['title', 'select', 'pause', 'win', 'fail', 'intro', 'help', 'set', 'cal', 'shareOv'];

(async () => {
  // 5. 無盡／每日（核心）
  {
    const a = C.newGame(C.endlessParams(0, 12345), {}, 0), b = C.newGame(C.endlessParams(0, 67890), {}, 0);
    assert(a.rings[0].tg.map(g => g.c0.toFixed(3)).join() !== b.rings[0].tg.map(g => g.c0.toFixed(3)).join(), '無盡模式不同 seed 的符紙位置不同');
    const keys = new Set(), diffs = [];
    for (let d = 20261101; d <= 20261130; d++) { const p = C.dailyParams(d); keys.add([p.om, p.K, p.rev, p.acc, p.fake, p.move, p.vari, p.blink].join('/')); diffs.push(C.diffOf(p)); }
    assert(keys.size >= 25, `每日挑戰 30 天有 ${keys.size} 種不同規則（速度、數量、機關）`);
    assert(Math.min(...diffs) >= 48 && Math.max(...diffs) <= 62, `每日挑戰難度相近（${Math.min(...diffs)}–${Math.max(...diffs)}）`);
    eq(C.dailyParams(20261116), C.dailyParams(20261116), '同一天的每日挑戰規則相同');
  }

  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error' || /Ignored attempt/.test(m.text())) errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    // CDP touchStart lists every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const scr = () => p.evaluate(S => S.filter(k => !document.getElementById(k).classList.contains('hidden')).join(',') || 'play', SCR);
    const settled = sel => p.waitForFunction(s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return false; const c = e.closest('.cd'); return !(c && c.getAnimations().some(a => a.playState === 'running')); }, sel);
    const tapXY = async (x, y, hold = 50, id = 1) => { await T('touchStart', [[x, y, id]]); await sleep(hold); await T('touchEnd', [[x, y, id]]); };
    const tap = async (sel, hold = 50, id = 1) => { await settled(sel); const b = await box(sel); await tapXY(b.cx, b.cy, hold, id); };
    const st = () => p.evaluate(() => window.__game.state());
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('slash.' + k)), k);
    const waitScr = (s, timeout = 5000) => p.waitForFunction(([s, S]) => (S.filter(k => !document.getElementById(k).classList.contains('hidden')).join(',') || 'play') === s, [s, SCR], { timeout });
    const attr = (sel, a) => p.getAttribute(sel, a);
    return { ctx, p, cdp, T, box, scr, tap, tapXY, st, ls, waitScr, settled, attr };
  }
  // plays the current level to the end with touches timed by the page's own plan()
  async function clear(t) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const r = await t.p.evaluate(() => ({ p: window.__game.plan(), s: window.__game.state() }));
      if (r.s.status !== 'play') return r.s.status;
      if (!r.p) { await sleep(20); continue; }
      if (r.p.ms > 60) { await sleep(Math.min(300, r.p.ms - 40)); continue; }
      await sleep(Math.max(0, r.p.ms - 8));
      await t.tapXY(r.s.dual ? (r.p.ring === 0 ? 100 : 290) : 195, 600, 30); await sleep(160);
    }
    return 'timeout';
  }
  const unlockAndOpen = async (t, n) => {
    await t.tap('#tSel'); await t.waitScr('select');
    if ((await t.attr('#unlockSw', 'aria-checked')) !== 'true') { await t.tap('#unlockSw'); await t.p.waitForSelector('#unlockSw[aria-checked="true"]'); }
    await t.tap(`#lt${n}`); await t.p.waitForFunction(() => window.__game.state().scene !== 'select');
    if ((await t.scr()) === 'intro') { await t.tap('#iOk'); }
    await t.waitScr('play');
  };

  // 2. 壞掉的存檔
  {
    for (const v of ['5', '"x"', '[1]', 'null']) {
      const t = await open(390, 844, { 'slash.stats': v, 'slash.ach': v });
      await t.tap('#tSet'); await t.waitScr('set');
      assert((await t.p.textContent('#hSum')) === '還沒有出手紀錄。', `slash.stats=${v}：標題按鈕照常、設定頁打開`);
      await t.ctx.close();
    }
    const seenAll = JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 1])));
    const t = await open(390, 844, { 'slash.stars': '7', 'slash.progress': '-5', 'slash.seen': '3', 'slash.stats': '{"errs":"abc","cuts":"zz"}', 'slash.offset': '"q"', 'slash.endless': '{}' });
    await t.tap('#tPlay'); await t.waitScr('intro'); await t.tap('#iOk'); await t.waitScr('play');
    const s0 = await t.st();
    eq([s0.L, await t.p.textContent('#hDn')], [1, '1'], 'progress=-5、seen=3：「開始」進第 1 關，難度 1');
    eq(await clear(t), 'win', 'stars=7、stats.errs="abc"：每一刀照常計算，第 1 關能過');
    await t.waitScr('win', 4000);
    const stars = await t.ls('stars'), stats = await t.ls('stats');
    assert(stars && stars['1'] >= 1 && Array.isArray(stats.errs) && stats.errs.length >= 3 && (await t.ls('progress')) === 1, `過關後結算卡出現，星數 ${JSON.stringify(stars)}、出手紀錄 ${stats.errs.length} 筆、進度 1`);
    await t.ctx.close();
    for (const v of ['"s"', '[3]']) {
      const u = await open(390, 844, { 'slash.seen': v, 'slash.progress': '"abc"' });
      await u.tap('#tPlay'); await u.waitScr('intro'); await u.tap('#iOk'); await u.waitScr('play');
      eq((await u.st()).L, 1, `seen=${v}：「開始」照常進第 1 關`);
      await u.ctx.close();
    }
    const big = await open(390, 844, { 'slash.progress': '250', 'slash.seen': seenAll });
    await big.tap('#tPlay'); await big.waitScr('play'); eq((await big.st()).L, 100, 'progress=250 夾到 100');
    await big.ctx.close();
    // legacy save loads unchanged
    const old = await open(390, 844, { 'slash.progress': '7', 'slash.stars': '{"1":3,"2":2,"5":1}', 'slash.seen': '{"1":1}', 'slash.stats': '{"cuts":10,"perfect":3,"errs":[12,-20,5],"streak":2}', 'slash.ach': '{"c50":1}', 'slash.endless': '14', 'slash.offset': '12', 'slash.mute': 'true', 'slash.vib': 'false', 'slash.practice': 'false' });
    await old.tap('#tSel'); await old.waitScr('select');
    eq([await old.p.textContent('#selSum'), await old.p.$eval('#lt1 .s', e => e.querySelectorAll('.on').length), await old.p.$eval('#lt2 .s', e => e.querySelectorAll('.on').length)], ['已通過 7 / 100 關・★ 6 / 300', 3, 2], '舊存檔：進度與星數照常載入');
    await old.tap('#sBack'); await old.waitScr('title'); await old.tap('#tSet'); await old.waitScr('set');
    const sum = await old.p.textContent('#hSum'), off = await old.p.textContent('#offT');
    assert(/累計 10 刀，完美 3 次/.test(sum) && /\+12 ms/.test(off), `舊存檔：戰績與偏移照常載入（${sum}／${off}）`);
    eq([await old.attr('#swVb', 'aria-checked'), await old.attr('#swMu', 'aria-checked'), await old.p.$$eval('.ac.on', a => a.length)], ['false', 'false', 1], '舊存檔：震動、靜音、成就照常載入');
    await old.ctx.close();
  }

  // 1. 觸控：另一指放著、兩指重疊、按住、detail 0、換畫面、鍵盤
  {
    const t = await open();
    for (const ms of [50, 600, 1000]) { await t.tap('#tHelp', ms); await t.waitScr('help'); await t.tap('#hOk'); await t.waitScr('title'); }
    assert(true, '單擊、按住 0.6 秒、1 秒都切換畫面一次');
    await t.tap('#tSet'); await t.waitScr('set'); await t.settled('#swVb');
    const vb = await t.box('#swVb'), pr = await t.box('#swPr'), ttl = await t.box('#set h2');
    let flips = 0, prev = await t.attr('#swVb', 'aria-checked');
    await t.T('touchStart', [[ttl.cx, ttl.cy, 7]]); await sleep(150);
    for (let i = 0; i < 5; i++) {
      await t.T('touchStart', [[ttl.cx, ttl.cy, 7], [vb.cx, vb.cy, 20 + i]]); await sleep(50); await t.T('touchEnd', [[vb.cx, vb.cy, 20 + i]]); await sleep(120);
      const v = await t.attr('#swVb', 'aria-checked'); if (v !== prev) flips++; prev = v;
    }
    await t.T('touchEnd', [[ttl.cx, ttl.cy, 7]]); await sleep(100);
    eq(flips, 5, '一指按在標題上時，點「震動回饋」5 下切 5 次');
    for (const first of [1, 2]) {
      const a0 = await t.attr('#swPr', 'aria-checked'), b0 = await t.attr('#swVb', 'aria-checked');
      await t.T('touchStart', [[pr.cx, pr.cy, 1]]); await sleep(50);
      await t.T('touchStart', [[pr.cx, pr.cy, 1], [vb.cx, vb.cy, 2]]); await sleep(60);
      if (first === 1) { await t.T('touchEnd', [[pr.cx, pr.cy, 1]]); await sleep(30); await t.T('touchEnd', [[vb.cx, vb.cy, 2]]); }
      else { await t.T('touchEnd', [[vb.cx, vb.cy, 2]]); await sleep(30); await t.T('touchEnd', [[pr.cx, pr.cy, 1]]); }
      await sleep(150);
      eq([(await t.attr('#swPr', 'aria-checked')) !== a0, (await t.attr('#swVb', 'aria-checked')) !== b0], [true, true], `兩指重疊點「練習模式」和「震動回饋」（先放第 ${first} 指）兩個都切換`);
    }
    // the row's text belongs to its switch
    const lab = await t.box('#swVb'), row = await t.p.evaluate(() => { const r = document.getElementById('swVb').closest('.rw').firstElementChild.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
    const r0 = await t.attr('#swVb', 'aria-checked'); await t.tapXY(row.x, row.y); await sleep(150);
    assert((await t.attr('#swVb', 'aria-checked')) !== r0 && lab.w > 0, '點設定列的文字「震動回饋」也會切換開關');
    // tap then the browser's detail-0 click on the control, its edge and whatever is under the finger: acts once
    await sleep(850);
    const before = await t.attr('#swVb', 'aria-checked');
    await t.tapXY(vb.cx, vb.cy, 40, 30);
    await t.p.evaluate(b => { const c = (el, x, y) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('swVb'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); }, vb);
    await sleep(150);
    assert((await t.attr('#swVb', 'aria-checked')) !== before && (await t.ls('vib')) === (before !== 'true'), '點按後補上的 detail 0 click（本身、邊緣、手指下）不會再切一次');
    await sleep(850);
    const b2 = await t.attr('#swVb', 'aria-checked');
    await t.p.evaluate(() => document.getElementById('swVb').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    assert((await t.attr('#swVb', 'aria-checked')) !== b2, '沒有點按時，單獨的 detail 0 click 照常動作一次');
    // screen change: tap 完成, then a detail-0 click lands on whatever is now under the finger: nothing runs
    const ok = await t.box('#setOk');
    await t.tapXY(ok.cx, ok.cy, 40, 40);
    await t.p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, ok);
    await sleep(200); eq(await t.scr(), 'title', '換畫面後補上的 click 不會按到新畫面的按鈕');
    await t.tap('#tHelp'); await t.waitScr('help');
    await t.p.focus('#hOk'); await t.p.keyboard.press('Enter'); await sleep(150);
    eq(await t.scr(), 'title', '鍵盤 Enter 在點按後 800ms 內也照常動作');
    // level tile while another finger rests on the header
    await t.tap('#tSel'); await t.waitScr('select');
    await t.tap('#unlockSw'); await t.p.waitForSelector('#unlockSw[aria-checked="true"]');
    const hd = await t.box('#select h2'), lt = await t.box('#lt5');
    await t.T('touchStart', [[hd.cx, hd.cy, 7]]); await sleep(200);
    await t.T('touchStart', [[hd.cx, hd.cy, 7], [lt.cx, lt.cy, 8]]); await sleep(50); await t.T('touchEnd', [[lt.cx, lt.cy, 8]]); await sleep(200);
    await t.T('touchEnd', [[hd.cx, hd.cy, 7]]); await sleep(100);
    const s5 = await t.st();
    eq([s5.scene, s5.L], ['play', 5], '一指按在標題列上時，點第 5 關照常進入');
    // pause while a finger rests on the canvas; that finger's slash counts once
    await sleep(1200);
    const g0 = await t.st(), pb = await t.box('#bPause');
    await t.T('touchStart', [[195, 600, 7]]); await sleep(200);
    await t.T('touchStart', [[195, 600, 7], [pb.cx, pb.cy, 8]]); await sleep(50); await t.T('touchEnd', [[pb.cx, pb.cy, 8]]); await sleep(150);
    const g1 = await t.st();
    eq([g1.scene, g1.miss + g1.cut - g0.miss - g0.cut], ['pause', 1], '一指放在畫布上時點暫停鈕照常暫停（那一指的斬擊算 1 次）');
    // the pause card appeared under the resting finger: lifting it does not press 繼續
    await t.T('touchEnd', [[195, 600, 7]]); await sleep(200);
    eq(await t.scr(), 'pause', '暫停卡出現在手指下時，放開不會按到「繼續」');
    await t.tap('#pRes'); await t.waitScr('play'); await sleep(200);
    // mute in game: tap + detail-0 click toggles once
    const m0 = await t.ls('mute'), mb = await t.box('#bMute');
    await t.tapXY(mb.cx, mb.cy, 40, 9);
    await t.p.evaluate(b => { const v = document.getElementById('bMute'); v.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: b.cx, clientY: b.cy })); }, mb);
    await sleep(150);
    eq(await t.ls('mute'), !m0, '音效鈕：點按＋detail 0 click 只切一次');
    // canvas: two overlapping fingers slash twice, judged per touch
    const c0 = await t.st();
    await t.T('touchStart', [[100, 600, 11]]); await sleep(120); await t.T('touchStart', [[100, 600, 11], [290, 650, 12]]); await sleep(40);
    await t.T('touchEnd', [[100, 600, 11], [290, 650, 12]]); await sleep(150);
    const c1 = await t.st();
    eq(c1.miss + c1.cut - c0.miss - c0.cut, 2, '畫布：兩指重疊（間隔 120 ms）各出手一次');
    await t.ctx.close();
  }

  // 3 + 4. 第 100 關（練習）：點在 HUD 按鈕外 1–2 px 沒有 console error；資訊條上的點擊會出手
  {
    const seenAll = JSON.stringify(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, 1])));
    const t = await open(390, 844, { 'slash.seen': seenAll, 'slash.practice': 'true', 'slash.progress': '99' });
    await t.tap('#tPlay'); await t.waitScr('play'); await sleep(1300);
    const n0 = errors.length, mb = await t.box('#bMute'), pb = await t.box('#bPause'), hm = await t.box('.hm');
    let cnt = 0;
    for (const [x, y] of [[200, 30], [hm.cx, hm.cy], [hm.x + 8, hm.y + 8]]) { const a = await t.st(); await t.tapXY(x, y); await sleep(250); const b = await t.st(); cnt += b.miss + b.cut - a.miss - a.cut; }
    eq([cnt, await t.scr()], [3, 'play'], 'HUD 中間資訊條上的 3 次點擊都出手');
    const m0 = await t.ls('mute'); await t.tap('#bMute'); await sleep(150);
    eq(await t.ls('mute'), !m0, '資訊條旁的音效鈕照常可點');
    // taps 1-2 px outside the HUD buttons (the browser may target them to the button, or they slash): never a console error
    for (const [x, y] of [[mb.cx, mb.y - 2], [mb.cx, mb.y + mb.h + 2], [mb.x - 2, mb.cy], [358, 6], [pb.x + pb.w + 2, pb.cy]]) { await t.tapXY(x, y); await sleep(250); }
    eq(errors.slice(n0), [], '點在 HUD 按鈕外 1–2 px：沒有「Ignored attempt to cancel a touchstart」之類的 console error');
    await t.ctx.close();
  }

  // 5 + 6. 無盡每輪 seed 不同；標題／選關／設定頁都能靜音
  {
    const t = await open();
    await t.tap('#tEnd'); await t.waitScr('play'); const e1 = (await t.st()).seed;
    await t.tap('#bPause'); await t.waitScr('pause'); await t.tap('#pRe'); await t.waitScr('play'); const e2 = (await t.st()).seed;
    await t.tap('#bPause'); await t.waitScr('pause'); await t.tap('#pQuit'); await t.waitScr('title');
    await t.tap('#tEnd'); await t.waitScr('play'); const e3 = (await t.st()).seed;
    assert(new Set([e1, e2, e3]).size === 3 && ![e1, e2, e3].includes(9001), `無盡模式每輪 seed 不同（${e1}, ${e2}, ${e3}）`);
    await t.tap('#bPause'); await t.waitScr('pause'); await t.tap('#pQuit'); await t.waitScr('title');
    await t.tap('#tDay'); await t.waitScr('play');
    const dn = +(await t.p.textContent('#hDn')); assert(dn >= 40 && dn <= 70, `每日挑戰 HUD 顯示當天規則算出的難度（${dn}）`);
    await t.tap('#bPause'); await t.waitScr('pause'); await t.tap('#pQuit'); await t.waitScr('title');
    await t.tap('#tMute'); await sleep(120);
    eq([await t.ls('mute'), await t.attr('#tMute', 'aria-pressed'), await t.attr('#bMute', 'aria-pressed')], [true, 'true', 'true'], '標題的音效鈕一下就靜音並保存（遊戲中的鈕同步）');
    await t.tap('#tSel'); await t.waitScr('select'); await t.tap('#sMute'); await sleep(120);
    eq([await t.ls('mute'), await t.attr('#sMute', 'aria-pressed')], [false, 'false'], '選關頁的音效鈕恢復聲音');
    await t.tap('#sBack'); await t.waitScr('title'); await t.tap('#tSet'); await t.waitScr('set'); await t.tap('#swMu'); await sleep(120);
    eq([await t.ls('mute'), await t.attr('#swMu', 'aria-checked')], [true, 'false'], '設定頁的音效開關可以靜音');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    eq(await t.attr('#tMute', 'aria-pressed'), 'true', '重新整理後仍是靜音');
    await t.ctx.close();
  }

  // 7. 360x640 雙環＋練習：提示不斷行、不溢出
  {
    const t = await open(360, 640, { 'slash.practice': 'true', 'slash.seen': '{"91":1,"100":1}' });
    for (const n of [91, 100]) {
      await unlockAndOpen(t, n);
      const r = await t.p.evaluate(() => { const sp = [...document.querySelectorAll('#hint span')]; return { lines: sp.map(s => Math.round(s.getBoundingClientRect().height)), right: Math.max(...sp.map(s => s.getBoundingClientRect().right)), left: Math.min(...sp.map(s => s.getBoundingClientRect().left)), txt: sp.map(s => s.textContent) }; });
      assert(r.lines.length === 3 && r.lines.every(h => h < 40) && r.right <= 360 && r.left >= 0, `第 ${n} 關 360x640 提示 ${r.txt.join('｜')} 每段都在一行內（高 ${r.lines.join('/')}）`);
      await t.tap('#bPause'); await t.waitScr('pause'); await t.tap('#pQuit'); await t.waitScr('select'); await t.tap('#sBack'); await t.waitScr('title');
    }
    await t.ctx.close();
  }

  eq(errors, [], '整輪沒有 page error／console error');
  await browser.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
