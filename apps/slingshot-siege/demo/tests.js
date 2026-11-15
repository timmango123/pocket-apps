// 石砲攻城記：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http
// （和發布時一樣包上 doctype + viewport），所有對外請求都擋掉並記錄。
// 1) DOM 按鈕走 pointerup 觸控層：一指放著時點設定開關、攻城地圖、解鎖開關、暫停、繼續都有反應；兩指相隔 50 ms 點音效＋震動、
//    暫停＋重來（兩種放開順序）都動作；按住 0.6／1 秒只動作一次；點按後補上的 detail 0 click（本身、邊緣、手指下）不會再跑一次
//    （下一關從 1 → 2 不會跳到 3、解鎖開關與音效開關只切一次）；單獨的 detail 0 click 動作一次、detail 1 click 不動作；鍵盤 Enter 照常
// 2) 一指放在畫布上時，從彈弓拉弓照常發射（不會變成雙指縮放），兩次都發射；圈外單點會提示從哪裡拉
// 3) 直式 360／390／430 寬瞄準時彈弓離左緣至少 PULLMAX + 2 px：從石彈本身開始拉，所有最佳解的射擊都拉得到；390×844 第 1 關從石彈拉出最佳解會過關
// 4) 壞存檔（stats "abc"／7／陣列、ach／intro 5、progress {"1":null}／"x"）不會讓遊戲無法啟動，開設定、開始第 1 關都沒有錯誤；合法舊存檔照常載入
// 5) 360×640 設定卡在成就全開、統計數字很大時，「完成」不用捲動就看得到、點得到
// 6) 直式分享圖保持畫面比例
// 8) 每日挑戰（依日期從已解鎖關卡挑一關，無軌跡、分數 ×1.5）；直式瞄準時地精上方有標記；星數不是數字的進度不算過關
// 7) 備用彈：第 50–59 關 ≥ 3 發、第 60–79 關 ≥ max(2, 最佳解一半)、第 80 關起 ≥ max(4, 最佳解一半)；拉弓吸附到 1.5°／3 px 的瞄準格點（偏 1 px 多半還是同一發）；
//    所有最佳解射擊都在格點上、在決定性核心重播仍然過關
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [], external = [];
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const html = fs.readFileSync(APP, 'utf8');
const SOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions.json'), 'utf8')).levels;
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const PULLMAX = +html.match(/PULLMAX = (\d+)/)[1];

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const t0 = Date.now();
  // ---------- 7. 彈藥容錯與最佳解重播（Node，決定性核心） ----------
  {
    const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
    const C = new Function(src + '\nreturn {World, genLevel, buildWorld, levelCover, levelParams, pullToVel, snapPull, rng, TICK, DT, GRAV, SLING_X, SLING_Y};')();
    const S = require('./solver.js')(C);
    let spareBad = [], replayBad = [], starBad = [];
    for (let n = 1; n <= 100; n++) {
      const L = LEVELS[n - 1], sol = SOL[n - 1], spare = L[1] - sol.shots.length;
      if (spare < (n >= 50 ? (n < 60 ? 3 : Math.max(n >= 80 ? 4 : 2, Math.ceil(sol.shots.length / 2))) : 0)) spareBad.push(n);
      if (!(L[2] < L[3] && L[3] < L[4])) starBad.push(n);
      if (n >= 60 || n % 10 === 0) { const rp = S.replay(C.genLevel(n, L[0]), sol.shots, { delay: 90 }); if (rp.W.gobAlive !== 0) replayBad.push(n); }
    }
    // aim grid: every recorded best shot is a grid point, and most 1 px release errors snap back onto the same shot
    const shots = SOL.flatMap(l => l.shots); let fixed = 0, same = 0, tot = 0;
    for (const sh of shots) { const r = C.snapPull(sh.dx, sh.dy); if (r.dx === sh.dx && r.dy === sh.dy) fixed++;
      for (const [ex, ey] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) { const q = C.snapPull(sh.dx + ex, sh.dy + ey); tot++; if (q.dx === sh.dx && q.dy === sh.dy) same++; } }
    eq(fixed, shots.length, `瞄準格點：所有 ${shots.length} 發最佳解射擊都落在格點上（重播不變）`);
    assert(same / tot >= 0.5, `放手偏 1 px（8 個方向）仍是同一發的比例 ${(same / tot * 100).toFixed(0)}%（≥ 50%）`);
    eq(spareBad, [], '備用彈：第 50–59 關 ≥ 3 發、第 60–79 關 ≥ max(2, 最佳解一半)、第 80 關起 ≥ max(4, 最佳解一半)');
    eq(starBad, [], '每關星等門檻遞增');
    eq(replayBad, [], '第 60–100 關（與每 10 關）的最佳解在決定性核心重播仍然過關');
  }

  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = { 'slingsiege.intro': '{"basic":1}' }) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(URL)) return r.continue(); external.push(u); return r.abort(); });
    const p = await ctx.newPage();
    const errs = [];
    p.on('console', m => { if (m.type() === 'error') { errors.push(m.text()); errs.push(m.text()); } }); p.on('pageerror', e => { errors.push(e.message); errs.push(e.message); });
    if (storage) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL);
    const booted = await p.waitForFunction(() => window.__game, null, { timeout: 8000 }).then(() => true, () => false);
    const cdp = await ctx.newCDPSession(p);
    // CDP touchStart/touchMove list every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    // wait for the overlay's pop-in animation to finish so the measured box is where the button will stay
    const calm = () => p.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running'), null, { timeout: 3000 }).catch(() => {});
    const box = async sel => (await calm(), p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2, b: r.bottom }; }, sel));
    const tap = async (sel, hold = 50, id = 1, rest = null) => { const b = await box(sel); const base = rest ? [rest] : []; await T('touchStart', [...base, [b.cx, b.cy, id]]); await sleep(hold); await T('touchEnd', [[b.cx, b.cy, id]]); await sleep(60); };
    const st = () => p.evaluate(() => window.__game.state());
    const shown = id => p.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
    const waitShown = (id, timeout = 6000) => p.waitForFunction(id => !document.getElementById(id).classList.contains('hidden'), id, { timeout }).then(() => true, () => false);
    const sw = id => p.evaluate(id => document.getElementById(id).getAttribute('aria-checked'), id);
    // wait until the aim camera has settled (sling no longer moving)
    const settle = async () => { await p.waitForFunction(() => { const s = window.__game.state(); return s.phase === 'aim' && s.introT <= 0; }, null, { timeout: 8000 }); let a = await st(); for (let i = 0; i < 40; i++) { await sleep(120); const b = await st(); if (Math.abs(a.sling.x - b.sling.x) < 0.3 && Math.abs(a.sling.y - b.sling.y) < 0.3) return b; a = b; } return a; };
    // pull from (x0,y0) to (x1,y1) with finger id, other fingers in `rest` stay down
    const pull = async (x0, y0, x1, y1, id = 5, rest = []) => {
      await T('touchStart', [...rest, [x0, y0, id]]); await sleep(40);
      for (let k = 1; k <= 8; k++) { await T('touchMove', [...rest, [x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8, id]]); await sleep(25); }
      await sleep(120); await T('touchEnd', [[x1, y1, id]]); await sleep(80);
    };
    return { ctx, p, cdp, T, box, tap, st, shown, waitShown, sw, settle, pull, errs, booted };
  }
  const W1 = SOL[0].shots[0]; // level 1 best shot: {dx, dy}

  // ---------- 1. 觸控層：一指放著、兩指重疊、按住 ----------
  {
    const t = await open();
    // title: a finger resting on the title area, another taps 攻城地圖
    await t.T('touchStart', [[195, 200, 9]]); await sleep(150);
    await t.tap('#tSelect', 50, 2, [195, 200, 9]);
    assert(await t.waitShown('select', 2000), '一指放在標題畫面時，另一指點「攻城地圖」會打開');
    const u0 = await t.sw('unlockSw');
    await t.tap('#unlockSw', 50, 3, [195, 200, 9]); await sleep(100);
    assert(await t.sw('unlockSw') !== u0, '一指放著時點「解鎖全部關卡」開關：切換一次');
    await t.tap('#unlockSw', 50, 4, [195, 200, 9]); await sleep(100);
    await t.tap('#sBack', 50, 6, [195, 200, 9]); await t.waitShown('title', 2000);
    await t.T('touchEnd', [[195, 200, 9]]); await sleep(100);
    // settings: finger resting on the card's top-left corner, other finger taps 震動回饋
    await t.tap('#tSet'); await t.waitShown('settings', 2000);
    const cb = await t.box('#settings .card'); const rest = [cb.x + 12, cb.y + 12, 9];
    await t.T('touchStart', [rest]); await sleep(150);
    const v0 = await t.sw('swVib');
    await t.tap('#swVib', 50, 2, rest); await sleep(100);
    assert(await t.sw('swVib') !== v0, '一指放在設定卡左上角時，另一指點「震動回饋」：切換一次');
    await t.T('touchEnd', [rest]); await sleep(100);
    // overlapping taps on 音效 and 震動 (second lands 50 ms after the first), both lift orders: both switch
    for (const order of ['soundFirst', 'vibFirst']) {
      await sleep(850);
      const a = await t.box('#swSound'), b = await t.box('#swVib'), s0 = [await t.sw('swSound'), await t.sw('swVib')];
      await t.T('touchStart', [[a.cx, a.cy, 21]]); await sleep(50);
      await t.T('touchStart', [[a.cx, a.cy, 21], [b.cx, b.cy, 22]]); await sleep(60);
      if (order === 'soundFirst') { await t.T('touchEnd', [[a.cx, a.cy, 21]]); await sleep(20); await t.T('touchEnd', [[b.cx, b.cy, 22]]); }
      else { await t.T('touchEnd', [[b.cx, b.cy, 22]]); await sleep(20); await t.T('touchEnd', [[a.cx, a.cy, 21]]); }
      await sleep(150);
      const s1 = [await t.sw('swSound'), await t.sw('swVib')];
      assert(s1[0] !== s0[0] && s1[1] !== s0[1], `兩指相隔 50 ms 點音效和震動（${order === 'soundFirst' ? '先放音效' : '先放震動'}）：兩個都切換`);
    }
    // holds of 0.6 s and 1 s toggle exactly once
    for (const hold of [600, 1000]) { await sleep(850); const s0 = await t.sw('swSound'); await t.tap('#swSound', hold, 7); await sleep(100); assert(await t.sw('swSound') !== s0, `按住音效開關 ${hold / 1000} 秒：切換一次`); }
    // a tap then the browser's detail-0 click (itself, its edge, under the finger): switches once
    await sleep(850);
    const sb = await t.box('#swSound'), s0 = await t.sw('swSound');
    await t.tap('#swSound');
    await t.p.evaluate(b => { const c = (el, x, y) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('swSound'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); }, sb);
    await sleep(100);
    assert(await t.sw('swSound') !== s0, '點音效開關後補上的 detail 0 click（本身、邊緣、手指下）：只切換一次');
    // lone detail-0 click acts once; a detail-1 click never acts on its own
    await sleep(850);
    const s1 = await t.sw('swSound');
    await t.p.evaluate(() => document.getElementById('swSound').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))); await sleep(60);
    assert(await t.sw('swSound') !== s1, '沒有點按時，單獨的 detail 0 click（輔助工具）照常動作一次');
    await sleep(850);
    const s2 = await t.sw('swSound');
    await t.p.evaluate(() => document.getElementById('swSound').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }))); await sleep(60);
    eq(await t.sw('swSound'), s2, '單獨的 detail 1 click（指標造成的）不另外動作');
    // keyboard: Enter on a focused button acts right after a tap
    await t.tap('#swPrecise'); const pr = await t.sw('swPrecise');
    await t.p.focus('#swPrecise'); await t.p.keyboard.press('Enter'); await sleep(60);
    assert(await t.sw('swPrecise') !== pr, '點按後立刻用鍵盤 Enter 照常動作');
    await t.p.keyboard.press('Enter'); await sleep(60);
    if (await t.sw('swPrecise') === 'true') { await sleep(850); await t.tap('#swPrecise'); }
    await sleep(850);
    await t.tap('#setOk'); await t.waitShown('title', 2000);
    // unlock switch: tap then a detail-0 click on it flips once
    await t.tap('#tSelect'); await t.waitShown('select', 2000); await sleep(850);
    const ub = await t.box('#unlockSw'), u1 = await t.sw('unlockSw');
    await t.tap('#unlockSw');
    await t.p.evaluate(b => document.getElementById('unlockSw').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: b.cx, clientY: b.cy })), ub);
    await sleep(100);
    assert(await t.sw('unlockSw') !== u1, '點「解鎖全部關卡」後補上的 detail 0 click：只切換一次');
    await sleep(850); await t.tap('#unlockSw'); await sleep(850);
    await t.tap('#sBack'); await t.waitShown('title', 2000);
    // in game: a finger resting on the canvas, another taps pause, then 繼續
    await t.tap('#tPlay'); await t.settle();
    const restC = [300, 420, 9];
    await t.T('touchStart', [restC]); await sleep(150);
    const g0 = await t.st();
    await t.tap('#bPause', 50, 2, restC);
    assert((await t.st()).phase === 'paused' && await t.shown('pause'), '一指放在畫布上時，另一指點暫停：暫停');
    await t.tap('#pResume', 50, 3, restC);
    eq((await t.st()).phase, 'aim', '一指放著時，另一指點「繼續」：繼續');
    await t.T('touchEnd', [restC]); await sleep(100);
    // overlapping taps on pause and restart, both lift orders: both act
    for (const order of ['pauseFirst', 'restartFirst']) {
      await sleep(850);
      if ((await t.st()).phase === 'paused') { await t.tap('#pResume'); await sleep(850); }
      const a = await t.box('#bPause'), b = await t.box('#bRestart'), s0 = await t.st();
      await t.T('touchStart', [[a.cx, a.cy, 31]]); await sleep(50);
      await t.T('touchStart', [[a.cx, a.cy, 31], [b.cx, b.cy, 32]]); await sleep(60);
      if (order === 'pauseFirst') { await t.T('touchEnd', [[a.cx, a.cy, 31]]); await sleep(20); await t.T('touchEnd', [[b.cx, b.cy, 32]]); }
      else { await t.T('touchEnd', [[b.cx, b.cy, 32]]); await sleep(20); await t.T('touchEnd', [[a.cx, a.cy, 31]]); }
      await sleep(150);
      const s1 = await t.st();
      eq([s1.pauses - s0.pauses, s1.starts - s0.starts], [1, 1], `兩指相隔 50 ms 點暫停和重來（${order === 'pauseFirst' ? '先放暫停' : '先放重來'}）：兩個都動作`);
    }
    void g0;
    assert(!t.errs.length, '觸控層測試期間沒有錯誤' + (t.errs.length ? '：' + t.errs[0] : ''));
    await t.ctx.close();
  }

  // ---------- 1b. 下一關後補上的 detail 0 click 不會跳關；2. 一指放在畫布上拉弓 ----------
  {
    const t = await open();
    await t.tap('#tPlay'); let g = await t.settle();
    // a finger resting on the canvas away from the sling: a pull from the sling still fires (twice)
    const restC = [g.sling.x + 200 > 380 ? 360 : g.sling.x + 200, 300, 9];
    let fired = 0;
    for (let k = 0; k < 2; k++) {
      g = await t.settle();
      await t.T('touchStart', [restC]); await sleep(200);
      const a0 = g.ammoLeft;
      await t.pull(g.sling.x, g.sling.y, g.sling.x - 40 - k * 5, g.sling.y + 10, 5, [restC]);
      const g1 = await t.st();
      if (g1.ammoLeft === a0 - 1 && (g1.phase === 'flight' || g1.proj || g1.phase === 'aim' || g1.phase === 'won')) fired++;
      await t.T('touchEnd', [restC]); await sleep(100);
      await t.p.waitForFunction(() => window.__game.state().phase !== 'flight', null, { timeout: 15000 }).catch(() => {});
    }
    eq(fired, 2, '一指放在畫布上時，從彈弓拉弓照常發射（2/2，不會變成雙指縮放）');
    const gh = await t.st();
    assert(gh.ghost > 5, `上一發的飛行路徑留下虛點（${gh.ghost} 點）`);
    // a short tap away from the sling while aiming tells where to grab
    if ((await t.st()).phase === 'aim') {
      await t.T('touchStart', [[300, 300, 41]]); await sleep(60); await t.T('touchEnd', [[300, 300, 41]]); await sleep(150);
      const toast = await t.p.evaluate(() => { const e = document.getElementById('toast'); return e.classList.contains('hidden') ? '' : e.textContent; });
      assert(/圓圈內/.test(toast), '瞄準時在圈外單點會提示從彈弓旁的圓圈拉');
    }
    // restart level 1 and clear it with the best shot, pulled from the stone itself
    await t.tap('#bRestart'); g = await t.settle();
    await t.pull(g.sling.x, g.sling.y, g.sling.x - W1.dx, g.sling.y + W1.dy);
    assert(await t.waitShown('win', 15000), '390×844 第 1 關從石彈本身拉出最佳解：過關');
    await sleep(900);
    const nb = await t.box('#wNext');
    await t.tap('#wNext');
    await t.p.evaluate(b => { const c = (el, x, y) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('wNext'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); }, nb);
    await sleep(200);
    const s = await t.st();
    eq([s.level, s.phase], [2, 'aim'], '勝利畫面點「下一關」後 120 ms 內補上 detail 0 click（本身、邊緣、手指下）：到第 2 關，不會跳到第 3 關');
    assert(!t.errs.length, '拉弓與過關期間沒有錯誤' + (t.errs.length ? '：' + t.errs[0] : ''));
    await t.ctx.close();
  }

  // ---------- 3. 直式畫面從石彈開始拉，最佳解都拉得到 ----------
  const maxDx = Math.max(...SOL.flatMap(l => l.shots.map(s => s.dx)));
  await Promise.all([[360, 640], [390, 844], [430, 932], [844, 390]].map(async ([w, h]) => {
    const t = await open(w, h);
    await t.tap('#tPlay'); const g = await t.settle();
    // the farthest a finger can go left is x = 1: horizontal pull room from the stone is sling.x - 1
    const room = g.sling.x - 1;
    const reach = SOL.flatMap(l => l.shots).filter(s => s.dx <= room).length / SOL.flatMap(l => l.shots).length;
    assert(room >= PULLMAX + 2 || (w > h && room >= maxDx + 2), `${w}×${h} 瞄準時彈弓在 x=${g.sling.x.toFixed(0)}：從石彈往左可拉 ${room.toFixed(0)} px（最佳解最多要 ${maxDx}），可拉到的最佳解射擊 ${(reach * 100).toFixed(0)}%`);
    eq(reach, 1, `${w}×${h} 所有最佳解射擊從石彈開始都拉得到`);
    // drag from the stone straight to the left edge: full power, the shot is fired
    const a0 = g.ammoLeft;
    await t.pull(g.sling.x, g.sling.y, 1, g.sling.y + 20);
    eq((await t.st()).ammoLeft, a0 - 1, `${w}×${h} 從石彈拉到左緣會發射`);
    assert(!t.errs.length, `${w}×${h} 沒有錯誤` + (t.errs.length ? '：' + t.errs[0] : ''));
    await t.ctx.close();
  }));

  // ---------- 4. 壞存檔 ----------
  const bad = [
    { 'slingsiege.stats': '"abc"' }, { 'slingsiege.stats': '7' }, { 'slingsiege.stats': '[1,2]' }, { 'slingsiege.stats': '{"shots":"x","gobs":-3,"wins":null}' },
    { 'slingsiege.ach': '5' }, { 'slingsiege.ach': '"abc"' }, { 'slingsiege.intro': '5' }, { 'slingsiege.intro': '"x"' }, { 'slingsiege.intro': 'null' },
    { 'slingsiege.progress': '{"1":null}' }, { 'slingsiege.progress': '"x"' }, { 'slingsiege.progress': '[{"stars":3}]' }, { 'slingsiege.progress': '{"1":{"stars":"x","best":"y"},"999":{"stars":3,"best":1},"q":{"stars":1,"best":1}}' },
    { 'slingsiege.mute': '{oops' },
  ];
  for (let i = 0; i < bad.length; i += 5) await Promise.all(bad.slice(i, i + 5).map(async s => {
    const t = await open(390, 844, s);
    const k = Object.keys(s)[0].replace('slingsiege.', '') + ' = ' + Object.values(s)[0];
    let ok = t.booted, step = '啟動';
    if (ok) { step = '開設定'; await t.tap('#tSet'); ok = await t.waitShown('settings', 4000); }
    if (ok) { step = '開始第 1 關'; await t.tap('#setOk'); await t.waitShown('title', 4000); await sleep(850); await t.tap('#tPlay'); ok = await t.p.waitForFunction(() => window.__game.state().phase === 'aim', null, { timeout: 6000 }).then(() => true, () => false);  if (!ok) step += JSON.stringify(await t.p.evaluate(() => [window.__game.state().phase, [...document.querySelectorAll('.ov:not(.hidden)')].map(e => e.id)])); }
    if (ok && (await t.shown('intro'))) { await t.tap('#iOk'); }
    assert(ok && !t.errs.length, `${k}：能啟動、開設定、開始第 1 關，沒有錯誤` + (ok ? '' : `（卡在${step}）`) + (t.errs.length ? '：' + t.errs[0] : ''));
    await t.ctx.close();
  }));
  {
    const t = await open(390, 844, { 'slingsiege.progress': '{"1":{"stars":3,"best":35500},"2":{"stars":1,"best":22000}}', 'slingsiege.stats': '{"shots":12,"blocks":40,"gobs":3,"wins":2,"wood":30,"stone":8,"ice":2,"tnt":0}', 'slingsiege.mute': 'true', 'slingsiege.intro': '{"basic":1}' });
    await t.tap('#tSet'); await t.waitShown('settings');
    const m = await t.p.evaluate(() => ({ grid: document.getElementById('statGrid').textContent, snd: document.getElementById('swSound').getAttribute('aria-checked') }));
    assert(/總發射數12/.test(m.grid) && /攻陷關卡2 \/ 100/.test(m.grid) && m.snd === 'false', '合法的舊存檔（進度、統計、靜音）照常載入');
    await t.tap('#setOk'); await t.waitShown('title'); await t.tap('#tPlay');
    await t.p.waitForFunction(() => window.__game.state().phase === 'aim');
    eq((await t.st()).level, 3, '合法舊存檔：開始攻城從第 3 關開始');
    await t.ctx.close();
  }

  {
    // a progress entry whose stars are not a number is not a clear: level 2 stays locked, 開始攻城 starts level 1
    const t = await open(390, 844, { 'slingsiege.progress': '{"1":{"stars":"x","best":5000}}', 'slingsiege.intro': '{"basic":1}' });
    await t.tap('#tSelect'); await t.waitShown('select');
    const lk = await t.p.evaluate(() => document.getElementById('lt2').classList.contains('lock'));
    await t.tap('#sBack'); await t.waitShown('title'); await sleep(850); await t.tap('#tPlay');
    await t.p.waitForFunction(() => window.__game.state().phase === 'aim');
    eq([lk, (await t.st()).level], [true, 1], 'progress 星數不是數字：不算過關（第 2 關仍鎖住、從第 1 關開始）');
    await t.ctx.close();
  }

  // ---------- 8. 每日挑戰、直式目標標記 ----------
  {
    const t = await open(390, 844, { 'slingsiege.progress': '{"1":{"stars":3,"best":35500},"2":{"stars":2,"best":30000},"3":{"stars":1,"best":22000}}', 'slingsiege.intro': '{"basic":1}' });
    const want = (await t.st()).dailyLevel;
    await t.tap('#tDaily'); await t.p.waitForFunction(() => window.__game.state().phase === 'aim');
    let s = await t.st();
    const hud = await t.p.textContent('#hLevel');
    eq([s.daily, s.level, s.preview, hud.startsWith('每日')], [true, want, 0, true], `每日挑戰：開今天選的第 ${want} 關（1–4 關之一）、沒有軌跡預測、HUD 標示每日`);
    assert(want >= 1 && want <= 4, '每日挑戰只從已解鎖的關卡挑');
    await sleep(850); await t.tap('#bRestart'); s = await t.st();
    eq([s.daily, s.level], [true, want], '每日挑戰按重來仍是每日挑戰');
    await t.settle(); await sleep(200); s = await t.st();
    assert(s.marks >= 1, `直式瞄準時每隻地精上方有標記箭頭（${s.marks} 個）`);
    assert(!t.errs.length, '每日挑戰沒有錯誤' + (t.errs.length ? '：' + t.errs[0] : ''));
    await t.ctx.close();
  }

  // ---------- 5. 360×640 設定卡「完成」看得到 ----------
  {
    const t = await open(360, 640, { 'slingsiege.ach': '{"one":1,"chain3":1,"perfect":1,"boom":1,"all":1}', 'slingsiege.stats': '{"shots":123456,"blocks":9876543,"gobs":456789,"wins":3000,"wood":1234567,"stone":2345678,"ice":345678,"tnt":45678}' });
    await t.tap('#tSet'); await t.waitShown('settings');
    const r = await t.p.evaluate(() => { const b = document.getElementById('setOk').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { top: b.top, bottom: b.bottom, h: innerHeight, hit: e && e.id }; });
    assert(r.top >= 0 && r.bottom <= r.h && r.hit === 'setOk', `360×640 成就全開＋大數字時「完成」在畫面內（${r.top.toFixed(0)}–${r.bottom.toFixed(0)} / ${r.h}）且沒被蓋住`);
    await t.tap('#setOk');
    assert(await t.waitShown('title', 2000), '360×640 不捲動直接點「完成」回到標題');
    await t.ctx.close();
  }

  // ---------- 6. 直式分享圖保持比例 ----------
  {
    const t = await open(390, 844);
    await t.p.evaluate(() => { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) {} });
    await t.tap('#tPlay'); const g = await t.settle();
    await t.pull(g.sling.x, g.sling.y, g.sling.x - W1.dx, g.sling.y + W1.dy);
    await t.waitShown('win', 15000); await sleep(900);
    await t.tap('#wShare'); await t.waitShown('shareOv', 4000);
    await t.p.waitForFunction(() => document.getElementById('shareImg').naturalWidth > 0, null, { timeout: 4000 }).catch(() => {});
    const r = await t.p.evaluate(() => { const i = document.getElementById('shareImg'), b = i.getBoundingClientRect(); return { w: i.naturalWidth, h: i.naturalHeight, bw: b.width, bh: b.height }; });
    const want = 390 / 844, got = r.w / (r.h - 90);
    assert(Math.abs(got - want) < 0.02, `直式分享圖畫面部分比例 ${got.toFixed(3)}，螢幕 ${want.toFixed(3)}（沒有壓扁）`);
    assert(Math.abs(r.bw / r.bh - r.w / r.h) < 0.02, '分享卡上的圖片也照原比例顯示');
    await t.ctx.close();
  }

  await browser.close();
  eq(external, [], '沒有對外請求');
  eq(errors, [], '沒有 console error 或 page error');
  console.log(`\n${fails ? fails + ' 項失敗' : '全部通過'}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
