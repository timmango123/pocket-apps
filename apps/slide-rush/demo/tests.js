// 滑水衝刺：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http
// （和發布時一樣包上 doctype + viewport），所有對外請求都擋掉並記錄。
// 1) DOM 按鈕走 pointerup 觸控層：一指在畫布上轉向時點 ⏸ 會暫停、一指放著時點繼續鍵／🔊／繼續都有反應、兩指相隔 50 ms
//    點世界分頁和 🔊（兩種放開順序）都動作、點按後的 detail 0 click 不會重開倒數也不會讓 🔊 切兩次、單獨的 detail 0 click 動作一次、
//    按住 0.6／1 秒只開始一次、結算卡出現前就按下的手指不會按到「再滑一次」、鍵盤 Enter 照常
// 2) 不載入任何外部資源（Google Fonts 已移除），沒有 console error
// 3) 壞掉的 sr_prog2（null、5、"abc"、陣列、壞掉的項目）退回預設，選單和結算照常；合法的舊存檔照常載入
// 4) 完全不碰螢幕的玩家（鎖步模擬）在第 1、2、5、10、15 道都進不了前 3 名
// 5) 第 71 道起只要冠軍：選單、開局提示都有說；第 71–80 道對手不比第 61–70 道快（平滑）
// 6) 世界分頁 .wtab 至少 44 px 高
// 7) 直式畫面拇指放在玩家泳圈上時，拖曳圈畫在泳圈外面
// 8) 第 21 道以後每個世界有自己的機關（漩渦、冰面、間歇泉、漂移浮球），第一道開局提示會說明
// 9) 轉向的手指放開時，畫布上的另一指接手轉向
// 10) 第一次沒過關不寫「新紀錄！」；844×390 橫式開局提示不蓋住玩家附近；說明寫到拖曳圓圈會跟著手指移動
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [], external = [];
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
// lock-step clock for the no-input runs: rAF and performance.now are driven by the test, Math.random is seeded
const LOCK = `(() => { let q = [], fakeT = 1000; window.__errs = []; let s = 7; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; performance.now = () => fakeT;
  window.__step = n => { for (let i = 0; i < n; i++) { fakeT += 1000 / 60; const c = q; q = []; for (const cb of c) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e)); } } } }; })();`;

// canvas raster calls do nothing in the lock-step runs (all game code, including the projection, still runs every frame)
const DRAWLESS = `(() => { const P = CanvasRenderingContext2D.prototype; for (const m of ['fill', 'stroke', 'fillRect', 'fillText', 'strokeText', 'drawImage', 'clearRect']) P[m] = function () {}; })();`;

(async () => {
  const t0 = Date.now();
  const html = fs.readFileSync(APP, 'utf8');
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = null, init = null) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(URL)) return r.continue(); external.push(u); return r.abort(); });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (storage) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    if (init) await p.addInitScript(init);
    await p.goto(URL); await p.waitForFunction(() => window.__sr);
    const cdp = await ctx.newCDPSession(p);
    // CDP touchStart/touchMove list every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const tap = async (sel, hold = 50, id = 1, rest = null) => { const b = await box(sel); const base = rest ? [rest] : []; await T('touchStart', [...base, [b.cx, b.cy, id]]); await sleep(hold); await T('touchEnd', [[b.cx, b.cy, id]]); };
    const sr = expr => p.evaluate(`window.__sr.${expr}`);
    const waitState = (st, timeout = 8000) => p.waitForFunction(st => window.__sr.state === st, st, { timeout });
    return { ctx, p, cdp, T, box, tap, sr, waitState };
  }

  // ---------- 4. 不碰螢幕不會上頒獎台（鎖步模擬，和其他項目同時跑） ----------
  // the same runs scan every 6th frame for the camera problem at crests: the slide floor under the player must stay on
  // screen below the horizon, the camera must stay CAM_H (1150) above every bit of slide between it and the player, and no
  // nearer piece of slide may be drawn above the player's floor (that hid the rider and the ball ahead)
  const noInput = Promise.all([1, 2, 5, 10, 15, 21, 41, 50, 61, 75, 81, 100].map(async lv => {
    const t = await open(390, 844, { sr_unlockAll: 'true' }, LOCK + DRAWLESS);
    await t.p.evaluate(() => window.__step(3));
    await t.p.evaluate(i => { document.getElementById('wtab' + Math.floor(i / 20)).click(); }, lv - 1);
    await t.p.evaluate(() => window.__step(2));
    await t.p.evaluate(i => document.getElementById('tile' + i).click(), lv - 1);
    const r = await t.p.evaluate(() => { let v, n = 0, bad = 0, ex = null;
      for (let f = 0; f < 20000; f++) { window.__step(6); v = window.__sr.view(); if (v.fin >= 0) break; const F = window.__sr.floor(); if (v.state !== 'race' || !F) continue; n++;
        if (F.occl > 0 || F.fy > F.H || F.fy < F.horizon || F.clear < 1149) { bad++; if (!ex) ex = { t: +v.t.toFixed(1), fy: Math.round(F.fy), occl: F.occl, clear: Math.round(F.clear) }; } }
      return { rank: v.rank, need: v.need, fin: v.fin, n, bad, ex }; });
    const errs = await t.p.evaluate(() => window.__errs);
    await t.ctx.close();
    return { lv, ...r, errs: errs.length };
  }));


  // ---------- 1. 觸控層 ----------
  {
    const t = await open();
    // a finger resting on the how-to box; another finger taps the continue button: the race starts once
    const hb = await t.box('.howto');
    await t.T('touchStart', [[hb.cx, hb.cy, 9]]); await sleep(150);
    await t.tap('#contBtn', 50, 2, [hb.cx, hb.cy, 9]); await t.waitState('count');
    await t.T('touchEnd', [[hb.cx, hb.cy, 9]]); await sleep(100);
    eq(await t.sr('starts'), 1, '一指放在說明框上時，另一指點繼續鍵：開始一次');
    await t.waitState('race');
    // steering finger on the canvas (dragging right), another finger taps ⏸: pauses; 繼續 with the finger still down resumes
    await t.T('touchStart', [[195, 640, 11]]); await sleep(60); await t.T('touchMove', [[240, 640, 11]]);
    assert(await t.p.waitForFunction(() => window.__sr.steer > 0.3, null, { timeout: 3000 }).then(() => true, () => false), '一指在畫布上往右拖時正在轉向');
    await t.tap('#pauseBtn', 50, 12, [240, 640, 11]); await t.waitState('paused', 2000).catch(() => {});
    eq(await t.sr('state'), 'paused', '一指在畫布上轉向時，另一指點 ⏸ 會暫停');
    await t.tap('#resumeBtn', 50, 13, [240, 640, 11]); await t.waitState('race', 2000).catch(() => {});
    eq(await t.sr('state'), 'race', '一指還按著時，另一指點「繼續」會繼續');
    // 🔊 in the pause menu with a finger resting
    await t.tap('#pauseBtn', 50, 14, [240, 640, 11]); await t.waitState('paused');
    const m0 = await t.sr('muted');
    await t.tap('#muteBtn2', 50, 15, [240, 640, 11]); await sleep(100);
    eq(await t.sr('muted'), !m0, '一指按著時，另一指點暫停選單的音效：切換一次');
    await t.tap('#muteBtn2', 50, 16, [240, 640, 11]); await sleep(100);
    await t.tap('#resumeBtn', 50, 17, [240, 640, 11]); await t.waitState('race');
    await t.T('touchEnd', [[240, 640, 11]]); await sleep(100);
    // pause menu, overlapping fingers: 音效 first, 繼續 50 ms later; 繼續 lifts first (closing the menu), then 音效: both act
    for (const first of ['resume', 'mute']) {
      await t.tap('#pauseBtn'); await t.waitState('paused'); await sleep(150);
      const mu = await t.sr('muted'), mb = await t.box('#muteBtn2'), rb = await t.box('#resumeBtn');
      await t.T('touchStart', [[mb.cx, mb.cy, 61]]); await sleep(50);
      await t.T('touchStart', [[mb.cx, mb.cy, 61], [rb.cx, rb.cy, 62]]); await sleep(60);
      if (first === 'resume') { await t.T('touchEnd', [[rb.cx, rb.cy, 62]]); await sleep(30); await t.T('touchEnd', [[mb.cx, mb.cy, 61]]); }
      else { await t.T('touchEnd', [[mb.cx, mb.cy, 61]]); await sleep(30); await t.T('touchEnd', [[rb.cx, rb.cy, 62]]); }
      await sleep(150);
      eq([await t.sr('muted') !== mu, await t.sr('state')], [true, 'race'], `暫停選單兩指重疊點「音效」和「繼續」（${first === 'resume' ? '先放繼續' : '先放音效'}）：兩個都動作`);
      await sleep(850);
    }
    // tap ⏸, then the browser's detail-0 click on whatever is now under the finger (the pause card): nothing else runs
    const pb = await t.box('#pauseBtn');
    await t.tap('#pauseBtn'); await t.waitState('paused');
    await t.p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); document.getElementById('pauseBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, pb);
    await sleep(150);
    eq(await t.sr('state'), 'paused', '點 ⏸ 後補上的 detail 0 click 不會按到暫停卡上的按鈕');
    // keyboard: Enter on a focused button acts, even right after a tap
    await t.p.focus('#resumeBtn'); await t.p.keyboard.press('Enter'); await t.waitState('race', 2000).catch(() => {});
    eq(await t.sr('state'), 'race', '點 ⏸ 後立刻用鍵盤 Enter 按「繼續」照常動作');
    await t.ctx.close();
  }
  {
    const t = await open();
    // tap the continue button, then a detail-0 click on it, on its edge and on whatever is under the finger: the countdown is not restarted
    const b = await t.box('#contBtn');
    await t.tap('#contBtn'); await t.waitState('count');
    // the replayed clicks land right after the tap (as the browser's own would), on the same page turn as reading the countdown
    const c0 = await t.p.evaluate(b => { const c0 = window.__sr.countT; const c = (el, x, y) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('contBtn'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); return c0; }, b);
    await sleep(300);
    const c1 = await t.sr('countT');
    eq([await t.sr('starts'), c1 < c0], [1, true], `點繼續鍵後補上的 detail 0 click（本身、邊緣、手指下）不會重開倒數（${c0.toFixed(2)} → ${c1.toFixed(2)}）`);
    await t.ctx.close();
  }
  {
    const t = await open();
    // 🔊: a tap then the replayed detail-0 click toggles once; a lone detail-0 click long after acts once; a detail-1 click never acts on its own
    const m0 = await t.sr('muted');
    await t.tap('#muteBtn'); await sleep(60);
    await t.p.evaluate(() => document.getElementById('muteBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await sleep(100);
    eq(await t.sr('muted'), !m0, '點 🔊 後補上的 detail 0 click：只切換一次');
    await sleep(850);
    await t.p.evaluate(() => document.getElementById('muteBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await sleep(60);
    eq(await t.sr('muted'), m0, '沒有點按時，單獨的 detail 0 click（輔助工具）照常動作一次');
    await sleep(850);
    await t.p.evaluate(() => document.getElementById('muteBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
    await sleep(60);
    eq(await t.sr('muted'), m0, '單獨的 detail 1 click（指標造成的）不另外動作');
    // overlapping fingers on world tab 2 and 🔊 (second lands 50 ms after the first), both lift orders: both act
    for (const order of ['tabFirst', 'muteFirst']) {
      const mu = await t.sr('muted');
      const tb = await t.box('#wtab1'), mb = await t.box('#muteBtn');
      await t.p.evaluate(() => document.getElementById('wtab0') && document.getElementById('wtab0').click()); // back to world 1 (detail-0, no tap pending)
      await sleep(900);
      const tb2 = await t.box('#wtab1');
      await t.T('touchStart', [[tb2.cx, tb2.cy, 21]]); await sleep(50);
      await t.T('touchStart', [[tb2.cx, tb2.cy, 21], [mb.cx, mb.cy, 22]]); await sleep(60);
      if (order === 'tabFirst') { await t.T('touchEnd', [[tb2.cx, tb2.cy, 21]]); await sleep(20); await t.T('touchEnd', [[mb.cx, mb.cy, 22]]); }
      else { await t.T('touchEnd', [[mb.cx, mb.cy, 22]]); await sleep(20); await t.T('touchEnd', [[tb2.cx, tb2.cy, 21]]); }
      await sleep(150);
      const r = await t.p.evaluate(() => ({ tab: document.getElementById('wtab1').getAttribute('aria-pressed'), first: document.querySelector('#tracks .tile b').textContent }));
      eq([r.tab, r.first, await t.sr('muted') !== mu], ['true', '21', true], `兩指相隔 50 ms 點世界分頁 2 和 🔊（${order === 'tabFirst' ? '先放分頁' : '先放 🔊'}）：兩個都動作`);
      void tb;
    }
    await t.ctx.close();
  }
  await Promise.all([600, 1000].map(async hold => {
    const t = await open();
    await t.tap('#contBtn', hold); await t.waitState('count'); await sleep(200);
    eq(await t.sr('starts'), 1, `按住繼續鍵 ${hold / 1000} 秒：開始一次`);
    await t.ctx.close();
  }));
  {
    // result card: a finger that went down before the card appeared does not press 再滑一次; a fresh tap does
    const t = await open();
    await t.tap('#contBtn'); await t.waitState('race', 6000);
    await t.T('touchStart', [[120, 560, 31]]);
    await t.sr('warp(0.995, 0)');
    await t.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 8000 });
    await sleep(300);
    const ab = await t.box('#againBtn');
    await t.T('touchMove', [[ab.cx, ab.cy, 31]]); await t.T('touchEnd', [[ab.cx, ab.cy, 31]]); await sleep(200);
    eq([await t.sr('state'), await t.sr('starts')], ['done', 1], '結算卡出現前就按下的手指，在「再滑一次」上放開不會重開');
    await t.tap('#againBtn'); await t.waitState('count');
    eq(await t.sr('starts'), 2, '結算卡上新的一下「再滑一次」重開一次');
    await t.ctx.close();
  }

  // ---------- 3. 壞掉的存檔 ----------
  await Promise.all(['null', '5', '"abc"', '[1,2]', '{"0":null,"1":{"rank":"x","time":3},"2":{"rank":9,"time":1},"x":{"rank":1,"time":1}}'].map(async bad => {
    const t = await open(390, 844, { sr_prog2: bad });
    const m = await t.p.evaluate(() => ({ cont: document.getElementById('contBtn').textContent, stats: document.getElementById('menuStats').textContent, tiles: document.querySelectorAll('#tracks .tile').length, t1: document.querySelector('#tracks .tile small').textContent }));
    eq([m.cont.startsWith('開始'), /第 1 道/.test(m.cont), m.stats, m.tiles, m.t1], [true, true, '已完成 0 / 100 道・冠軍 0 次', 20, '未挑戰'], `sr_prog2 = ${bad.slice(0, 24)}：選單顯示預設（開始第 1 道）`);
    await t.tap('#contBtn'); await t.waitState('race', 6000);
    await t.sr('warp(0.995, 0)');
    const shown = await t.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 8000 }).then(() => true, () => false);
    const saved = await t.p.evaluate(() => JSON.parse(localStorage.getItem('sr_prog2')));
    assert(shown && saved && saved[0] && saved[0].rank >= 1, `sr_prog2 = ${bad.slice(0, 24)}：跑完一道後結算畫面出現，存檔寫回正常格式`);
    await t.ctx.close();
  }));
  {
    const t = await open(390, 844, { sr_prog2: '{"0":{"rank":1,"time":40.5},"1":{"rank":3,"time":44.2}}', sr_muted: 'true' });
    const m = await t.p.evaluate(() => ({ cont: document.getElementById('contBtn').textContent, stats: document.getElementById('menuStats').textContent, t: [...document.querySelectorAll('#tracks .tile small')].slice(0, 3).map(e => e.textContent), mute: document.getElementById('muteBtn2').textContent }));
    eq([/第 3 道/.test(m.cont), m.stats, m.t, m.mute], [true, '已完成 2 / 100 道・冠軍 1 次', ['冠軍', '季軍', '未挑戰'], '音效：關'], '合法的舊存檔與靜音設定照常載入');
    await t.ctx.close();
  }

  // ---------- 6 / 10. 版面與文字 ----------
  {
    const t = await open();
    const h = await t.p.evaluate(() => Math.min(...[...document.querySelectorAll('.wtab')].map(e => e.getBoundingClientRect().height)));
    assert(h >= 44, `世界分頁高度 ${h.toFixed(1)} px ≥ 44`);
    const how = await t.p.textContent('.howto');
    assert(/圓圈會跟著手指移動/.test(how), '說明寫到拖曳圓圈會跟著手指移動');
    assert(/漩渦/.test(how) && /冰面/.test(how) && /間歇泉/.test(how) && /漂移浮球/.test(how), '說明列出各世界的新機關');
    await t.ctx.close();
  }
  assert(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+stylesheet|@import|https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'index.html 沒有任何對外網址（字型改用系統字型）');
  {
    // first failed run: no 新紀錄; a later better failed run says it improved
    const t = await open(390, 844, { sr_unlockAll: 'true' });
    await t.tap('#contBtn'); await t.waitState('race', 6000);
    await t.sr('warp(0.995, 3000)');
    await t.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 10000 });
    const txt = await t.p.textContent('#resBest');
    assert(/^未過關/.test(txt) && !/新紀錄/.test(txt), `第一次沒過關：「${txt}」沒有寫新紀錄`);
    await t.ctx.close();
  }
  {
    // landscape: the opening hint sits clear of the player and the riders around them
    const t = await open(844, 390);
    await t.tap('#contBtn'); await t.waitState('race', 6000); await sleep(300);
    const r = await t.p.evaluate(() => { const h = document.getElementById('hint').getBoundingClientRect(), ps = window.__sr.playerScreen(); return { h: [h.left, h.top, h.right, h.bottom], op: getComputedStyle(document.getElementById('hint')).opacity, p: ps }; });
    const pTop = r.p.y - 380 * r.p.s; // top of the rider plus the name tags of riders level with the player
    assert(r.op === '1' && r.h[3] < pTop, `844×390 開局提示（下緣 ${r.h[3].toFixed(0)}）在玩家附近（上緣約 ${pTop.toFixed(0)}）的上方`);
    await t.ctx.close();
  }

  // ---------- 7. 拖曳圈不壓在泳圈上 ----------
  await Promise.all([[390, 844], [360, 640], [430, 932]].map(async ([w, h]) => {
    const t = await open(w, h);
    await t.tap('#contBtn'); await t.waitState('race', 6000); await sleep(200);
    const ps = await t.sr('playerScreen()');
    await t.T('touchStart', [[ps.x, ps.y, 41]]); await sleep(150);
    const r = await t.p.evaluate(() => ({ ring: window.__sr.ring(), p: window.__sr.playerScreen() }));
    await t.T('touchEnd', [[ps.x, ps.y, 41]]);
    const halfW = 210 * r.p.s, top = r.p.y - 340 * r.p.s, bot = r.p.y + 90 * r.p.s;
    const clear = r.ring && (r.ring.y - r.ring.r >= bot || r.ring.y + r.ring.r <= top || Math.abs(r.ring.x - r.p.x) >= halfW + r.ring.r);
    assert(clear && r.ring.y + r.ring.r <= h, `${w}×${h} 拇指放在泳圈上：拖曳圈（y ${r.ring && r.ring.y.toFixed(0)}、半徑 ${r.ring && r.ring.r}）在泳圈（${top.toFixed(0)}–${bot.toFixed(0)}）外、畫面內`);
    await t.ctx.close();
  }));

  // ---------- 9. 第二指接手轉向 ----------
  {
    const t = await open();
    await t.tap('#contBtn'); await t.waitState('race', 6000);
    await t.T('touchStart', [[120, 650, 51]]); await sleep(60);
    await t.T('touchMove', [[170, 650, 51]]); await sleep(150);
    await t.T('touchStart', [[170, 650, 51], [280, 700, 52]]); await sleep(150);
    await t.T('touchEnd', [[170, 650, 51]]); await sleep(80);
    for (let k = 1; k <= 5; k++) { await t.T('touchMove', [[280 - 15 * k, 700, 52]]); await sleep(30); }
    await sleep(250);
    const st = await t.sr('steer');
    assert(st < -0.4, `第一指放開後，第二指往左拖 75 px 接手轉向（steer ${st.toFixed(2)}）`);
    await t.T('touchEnd', [[205, 700, 52]]);
    await t.ctx.close();
  }

  // ---------- 5 / 8. 難度說明、各世界的機關 ----------
  {
    const t = await open(390, 844, { sr_unlockAll: 'true' });
    const info = await t.p.evaluate(() => { const o = {}; for (const i of [5, 20, 40, 60, 80, 99]) o[i + 1] = window.__sr.info(i); return o; });
    eq([info[6].twists, info[21].twist, info[41].twist, info[61].twist, info[81].twist], [0, 'swirl', 'ice', 'geyser', 'drift'], '第 21、41、61、81 道各有自己的機關（第 1 個世界沒有）');
    const mix = await t.p.evaluate(() => [45, 66, 90].map(i => window.__sr.info(i).kinds));
    assert(mix[0].includes('swirl') && mix[1].some(k => k === 'ice' || k === 'swirl') && mix[2].filter(k => k !== 'drift').length >= 1, `後面的世界混入前面世界的機關（第 46 道 ${mix[0].join('+')}、第 67 道 ${mix[1].join('+')}、第 91 道 ${mix[2].join('+')}）`);
    assert([21, 41, 61, 81, 100].every(n => info[n].twists >= 4), `每個世界的道上至少 4 處機關（${[21, 41, 61, 81, 100].map(n => info[n].twists).join('、')}）`);
    const sk = await t.p.evaluate(() => { const a = []; for (let i = 0; i < 100; i++) a.push(window.__sr.info(i).rivalSkill[1]); return a; });
    const mean = (a, b) => sk.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);
    assert(mean(70, 80) <= mean(60, 70) + 0.001, `第 71–80 道對手最快速度（${mean(70, 80).toFixed(3)}）不高於第 61–70 道（${mean(60, 70).toFixed(3)}）：冠軍門檻進來時先放慢對手`);
    // first track of a world explains its mechanic; track 71 says only 1st place clears
    await t.p.evaluate(() => document.getElementById('wtab1').click()); await sleep(900);
    await t.tap('#tile20'); await t.waitState('count');
    const h21 = await t.p.textContent('#hint');
    assert(/漩渦/.test(h21), `第 21 道開局提示介紹漩渦：「${h21}」`);
    await t.p.evaluate(() => { window.__sr.warp(0.995, 0); }); await t.p.waitForFunction(() => !document.getElementById('result').hidden, null, { timeout: 15000 });
    await sleep(900);
    await t.tap('#menuBtn'); await t.waitState('menu'); await sleep(900); // a programmatic click right after a tap is (correctly) swallowed
    await t.p.evaluate(() => document.getElementById('wtab3').click()); await sleep(300);
    const tile71 = await t.p.getAttribute('#tile70', 'aria-label');
    assert(/只有冠軍/.test(tile71), `第 71 道的格子寫明只有冠軍過關：「${tile71}」`);
    await t.tap('#tile70'); await t.waitState('count');
    const h71 = await t.p.textContent('#hint');
    assert(/只有冠軍/.test(h71), `第 71 道開局提示：「${h71}」`);
    await t.ctx.close();
  }

  const nir = await noInput;
  for (const r of nir.filter(r => r.lv <= 15)) assert(r.fin > 0 && r.rank > 3 && !r.errs, `完全不碰螢幕：第 ${r.lv} 道第 ${r.rank} 名（需要前 ${r.need} 名），沒過關也沒上頒獎台`);
  for (const r of nir) assert(r.n > 100 && r.bad === 0 && !r.errs, `第 ${r.lv} 道整場 ${r.n} 個取樣：坡頂滑道底面都在畫面內、攝影機不鑽進滑道、沒有近處滑道擋住玩家${r.ex ? ' 例：' + JSON.stringify(r.ex) : ''}`);

  await browser.close();
  eq(external, [], '沒有任何對外請求');
  eq(errors, [], '沒有 page error／console error');
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
