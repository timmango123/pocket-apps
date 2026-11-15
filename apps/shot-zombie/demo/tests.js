// 射擊殭屍：上架複審 R1 修正的回歸測試（node tests.js，約 60 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) DOM 按鈕走 pointerup 觸控層：另一指按著時照樣有反應、兩指重疊點 🔊／⏸ 都動作、點按後的 detail 0 click 不重開局、
//    單獨的 detail 0 click 照常動作一次、按住 0.6／1 秒只動作一次、結算卡出現前就按下的手指不會按到「再來一次」、鍵盤 Enter
// 2) 主選單在 360×640、375×667、320×568 標題不被切掉，內容超出時可以捲到最下面
// 3) 壞掉的最佳紀錄（"abc"、{}、[1,2]、-5）退回「尚無紀錄」，30 隻計時完成後結算照常出現；舊的合法紀錄照常載入
// 4) 開局橫幅與說明文字跟實際規則一致
// 5) 生存：保護期後扣心後 2 秒內不再扣、少心時每擊倒 10 隻回一顆心
// 6) 速射：每秒最多 20 槍（連點程式灌不了分），人手的快速連點與兩指幾乎同時落下都不會掉
// 7) 速射開局橫幅不蓋住隊伍第 2–4 隻；車道輸入照舊（8 下／秒 0 漏 0 重）
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

(async () => {
  const t0 = Date.now();
  const html = fs.readFileSync(APP, 'utf8');
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = null) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    if (storage) await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    // CDP touchStart/touchMove list every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const st = () => p.evaluate(() => window.__game.state());
    const runs = () => p.evaluate(() => window.__game.runs());
    const tap = async (sel, hold = 50, id = 1, rest = null) => { const b = await box(sel); const base = rest ? [rest] : []; await T('touchStart', [...base, [b.cx, b.cy, id]]); await sleep(hold); await T('touchEnd', [[b.cx, b.cy, id]]); };
    const lane = async l => { const L = await p.evaluate(() => window.__game.layout()); return [L.playX + L.laneW * (l + 0.5), L.btnTop + L.btnH / 2]; };
    const waitPhase = (ph, timeout = 5000) => p.waitForFunction(ph => window.__game.state().phase === ph, ph, { timeout });
    return { ctx, p, cdp, T, box, st, runs, tap, lane, waitPhase };
  }

  // ---------- 1. 觸控層 ----------
  {
    const t = await open();
    // a finger resting on the empty title background: tapping 速射模式 with another finger still starts once
    await t.T('touchStart', [[12, 12, 9]]); await sleep(150);
    await t.tap('#mRapid', 50, 2, [12, 12, 9]); await t.waitPhase('play');
    await t.T('touchEnd', [[12, 12, 9]]); await sleep(100);
    eq([(await t.st()).mode, await t.runs()], ['rapid', 1], '一指放在主選單空白處時，另一指點「速射模式」開局一次');
    // in game: one finger holds a lane, another taps ⏸ -> pauses; resume with a finger resting
    const [lx, ly] = await t.lane(0);
    await t.T('touchStart', [[lx, ly, 11]]); await sleep(150);
    await t.tap('#btnPause', 50, 12, [lx, ly, 11]); await t.waitPhase('pause');
    assert(true, '一指按著車道時，另一指點 ⏸ 會暫停');
    await t.tap('#pResume', 50, 13, [lx, ly, 11]); await t.waitPhase('play');
    await t.T('touchEnd', [[lx, ly, 11]]); await sleep(100);
    assert(true, '一指按著畫面時，另一指點「繼續」會繼續');
    // overlapping fingers on 🔊 and ⏸ (second lands 50 ms after the first), both lift orders: both act
    for (const order of ['muteFirst', 'pauseFirst']) {
      const m0 = await t.p.textContent('#btnMute'), mb = await t.box('#btnMute'), pb = await t.box('#btnPause');
      await t.T('touchStart', [[mb.cx, mb.cy, 21]]); await sleep(50);
      await t.T('touchStart', [[mb.cx, mb.cy, 21], [pb.cx, pb.cy, 22]]); await sleep(60);
      if (order === 'muteFirst') { await t.T('touchEnd', [[mb.cx, mb.cy, 21]]); await sleep(20); await t.T('touchEnd', [[pb.cx, pb.cy, 22]]); }
      else { await t.T('touchEnd', [[pb.cx, pb.cy, 22]]); await sleep(20); await t.T('touchEnd', [[mb.cx, mb.cy, 21]]); }
      await sleep(150);
      eq([(await t.p.textContent('#btnMute')) !== m0, (await t.st()).phase], [true, 'pause'], `兩指相隔 50 ms 點 🔊 和 ⏸（${order === 'muteFirst' ? '先放 🔊' : '先放 ⏸'}）：兩個都動作`);
      await t.tap('#pResume'); await t.waitPhase('play'); await sleep(900);
    }
    // keyboard: Enter on a focused button acts, even right after a tap
    await t.tap('#btnPause'); await t.waitPhase('pause');
    await t.p.focus('#pResume'); await t.p.keyboard.press('Enter'); await t.waitPhase('play');
    assert(true, '點 ⏸ 後立刻用鍵盤 Enter 按「繼續」照常動作');
    await t.ctx.close();
  }
  {
    const t = await open();
    // tap 生存, then the browser's own detail-0 click on the button, on its edge and on whatever is under the finger: starts once
    const b = await t.box('#mSurv');
    await t.tap('#mSurv'); await t.waitPhase('play'); await sleep(120);
    const time0 = (await t.st()).time;
    await t.p.evaluate(b => { const c = (el, x, y) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); const v = document.getElementById('mSurv'); c(v, b.cx, b.cy); c(v, b.x + 1, b.y + 1); c(document.elementFromPoint(b.cx, b.cy), b.cx, b.cy); }, b);
    await sleep(100);
    const s = await t.st();
    eq([await t.runs(), s.mode, s.time >= time0], [1, 'surv', true], '點「生存」後補上的 detail 0 click（本身、邊緣、手指下）不會重開局');
    // tap ⏸ then a detail-0 click on whatever is now under the finger (the pause card): nothing else runs
    const pb = await t.box('#btnPause');
    await t.tap('#btnPause'); await t.waitPhase('pause');
    await t.p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); document.getElementById('btnPause').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, pb);
    await sleep(150);
    eq((await t.st()).phase, 'pause', '點 ⏸ 後補上的 click 不會按到暫停卡上的按鈕');
    // a lone detail-0 click long after any tap (assistive tech) acts once
    await sleep(850);
    await t.p.evaluate(() => document.getElementById('pResume').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await sleep(80);
    eq((await t.st()).phase, 'play', '沒有點按時，單獨的 detail 0 click 照常動作一次');
    // a pointer-made click (detail 1) never acts on its own (the tap layer already ran it on pointerup)
    await sleep(850);
    await t.p.evaluate(() => document.getElementById('btnPause').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
    await sleep(80);
    eq((await t.st()).phase, 'play', '單獨的 detail 1 click（指標造成的）不另外動作');
    await t.ctx.close();
  }
  {
    // holds of 0.6 s and 1 s on a mode button start exactly once
    for (const hold of [600, 1000]) {
      const t = await open();
      await t.tap('#mTA', hold); await t.waitPhase('play'); await sleep(200);
      eq([await t.runs(), (await t.st()).mode], [1, 'ta'], `按住「30 隻計時」${hold / 1000} 秒：開局一次`);
      await t.ctx.close();
    }
  }
  {
    // result card: a finger that went down before the card appeared does not press 再來一次; a fresh tap does
    const t = await open();
    await t.tap('#mTA'); await t.waitPhase('play');
    const rb0 = { cx: 130, cy: 500 };
    await t.T('touchStart', [[rb0.cx, rb0.cy, 31]]);
    await t.p.evaluate(() => window.__game.warp(0));
    // wrong taps on purpose until the barricade falls (the closest zombie lurches forward)
    await t.p.waitForFunction(() => { const g = window.__game, s = g.state(); if (s.phase !== 'play') return true; const z = s.ents.filter(e => e.type === 'z' && e.y > g.VIS).sort((a, b) => b.y - a.y)[0]; g.press(z ? (z.lane + 1) % s.lanes : 0); return false; }, null, { timeout: 20000, polling: 30 });
    await t.waitPhase('over', 5000); await sleep(800);
    const rb = await t.box('#rRetry');
    await t.T('touchMove', [[rb.cx, rb.cy, 31]]); await t.T('touchEnd', [[rb.cx, rb.cy, 31]]); await sleep(150);
    eq([(await t.st()).phase, await t.runs()], ['over', 1], '結算卡出現前就按下的手指，在「再來一次」上放開不會重開');
    await t.tap('#rRetry'); await t.waitPhase('play');
    eq(await t.runs(), 2, '結算卡上新的一下「再來一次」重開一次');
    await t.ctx.close();
  }

  // ---------- 2. 主選單標題不被切掉 ----------
  for (const [w, h] of [[360, 640], [375, 667], [320, 568], [390, 844], [844, 390]]) {
    const t = await open(w, h);
    const r = await t.p.evaluate(() => { const o = document.getElementById('title'), l = document.querySelector('.logo').getBoundingClientRect(); const top = l.top; o.scrollTop = 1e6; const m = document.getElementById('btnMute2').getBoundingClientRect(); return { top, mb: m.bottom, h: innerHeight }; });
    assert(r.top >= 0 && r.mb <= r.h, `${w}×${h} 主選單：標題上緣 ${r.top.toFixed(1)} px ≥ 0，捲到底時靜音鈕在畫面內`);
    await t.ctx.close();
  }

  // ---------- 3. 壞掉的最佳紀錄 ----------
  for (const bad of ['"abc"', '{}', '[1,2]', '-5', 'NaN']) {
    const keys = ['bestTime', 'bestScore', 'bestKills', 'bestRapid'], seed = {};
    for (const k of keys) seed['shot-zombie:' + k] = bad;
    const t = await open(390, 844, seed);
    const txt = await t.p.evaluate(() => ['bestRapid', 'bestSurv', 'bestTA'].map(id => document.getElementById(id).textContent));
    eq(txt, ['30 秒內能射倒幾隻？', '撐到被突破為止', '最快擊倒 30 隻'], `最佳紀錄是 ${bad}：主選單顯示「尚無紀錄」的文字`);
    await t.tap('#mTA'); await t.waitPhase('play');
    // clear all 30 by shooting the closest zombie each time
    await t.p.waitForFunction(() => { const g = window.__game, s = g.state(); if (s.phase !== 'play') return true; const z = s.ents.filter(e => e.type === 'z' && e.y > g.VIS).sort((a, b) => b.y - a.y)[0]; if (z) g.press(z.lane); return false; }, null, { timeout: 30000, polling: 20 });
    await t.waitPhase('over', 5000);
    const res = await t.p.evaluate(() => ({ shown: !document.getElementById('result').hidden, text: document.getElementById('resCard').textContent, best: JSON.parse(localStorage.getItem('shot-zombie:bestTime')) }));
    assert(res.shown && /30 隻全滅/.test(res.text) && /新紀錄/.test(res.text) && typeof res.best === 'number' && res.best > 0, `最佳紀錄是 ${bad}：完成 30 隻後結算照常出現、寫入新紀錄 ${res.best}`);
    await t.ctx.close();
  }
  {
    const t = await open(390, 844, { 'shot-zombie:bestTime': '12.34', 'shot-zombie:bestScore': '320', 'shot-zombie:bestKills': '31', 'shot-zombie:bestRapid': '55', 'shot-zombie:mute': 'true' });
    const txt = await t.p.evaluate(() => ['bestRapid', 'bestSurv', 'bestTA', 'btnMute2'].map(id => document.getElementById(id).textContent));
    eq(txt, ['最佳 55 隻・30 秒', '最佳 320 分・31 隻', '最佳 12.34 秒', '🔇'], '舊的合法紀錄與靜音設定照常載入');
    await t.ctx.close();
  }

  // ---------- 4. 文字與規則一致 ----------
  assert(/'先打最近的！'[^;]*'點錯扣心・前 15 秒不扣'/.test(html) && !/點錯扣 0\.5 秒/.test(html), '生存開局橫幅寫「點錯扣心・前 15 秒不扣」（不再寫扣 0.5 秒）');
  assert(/打錯<b>扣 0\.5 秒<\/b>時間/.test(html) && !/暈 0\.5 秒/.test(html), '說明：速射打錯扣 0.5 秒時間（不是暈 0.5 秒）');
  assert(/扣心後 2 秒內不再扣，少心時每擊倒 10 隻回一顆）/.test(html), '說明：生存扣心後 2 秒保護、少心時每擊倒 10 隻回一顆心');

  // ---------- 5. 生存：扣心後 2 秒保護、少心時每擊倒 10 隻回一顆心 ----------
  {
    const t = await open();
    await t.tap('#mSurv'); await t.waitPhase('play');
    const wrong = () => t.p.evaluate(() => { const g = window.__game, s = g.state(); const z = s.ents.filter(e => e.type === 'z' && e.y > g.VIS).sort((a, b) => b.y - a.y)[0]; g.press(z ? (z.lane + 1) % s.lanes : 0); return g.state().hearts; });
    eq(await wrong(), 3, '開局 15 秒內點錯不扣心');
    await t.p.evaluate(() => window.__game.warp(20));
    const h1 = await wrong(), h2 = await wrong();
    eq([h1, h2], [2, 2], '保護期後點錯扣一顆心，接下來 2 秒內再點錯不扣');
    await t.p.evaluate(() => window.__game.warp(window.__game.safeT() + 0.01));
    eq(await wrong(), 1, '2 秒保護過後點錯再扣一顆心');
    await t.p.waitForFunction(() => { const g = window.__game, s = g.state(); if (s.phase !== 'play' || s.hearts > 1) return true; const z = s.ents.filter(e => e.type === 'z' && e.y > g.VIS).sort((a, b) => b.y - a.y)[0]; if (z) g.press(z.lane); return false; }, null, { timeout: 20000, polling: 30 });
    const s = await t.st();
    eq([s.phase, s.hearts], ['play', 2], `少一顆以上心時擊倒 10 隻回一顆心（擊倒 ${s.kills}）`);
    await t.ctx.close();
  }

  // ---------- 6 + 7. 速射 ----------
  for (const [w, h] of [[390, 844], [375, 667], [360, 640]]) {
    const t = await open(w, h);
    await t.tap('#mRapid'); await t.waitPhase('play');
    const v = await t.p.evaluate(() => window.__game.rapidView());
    const clear = v.zombies.every(([top]) => top >= v.banner[1]);
    assert(clear, `${w}×${h} 速射開局橫幅（${v.banner.map(Math.round).join('–')}）不蓋住隊伍第 2–4 隻（頭頂 ${v.zombies.map(z => Math.round(z[0])).join('、')}）`);
    await t.ctx.close();
  }
  {
    const t = await open();
    await t.tap('#mRapid'); await t.waitPhase('play');
    // real touches, one thumb per lane, 8 taps a second: every one counts
    for (let i = 0; i < 24; i++) {
      const s = await t.st(); const [x, y] = await t.lane(s.slots[0]);
      await t.T('touchStart', [[x, y, 100 + i]]); await sleep(40); await t.T('touchEnd', [[x, y, 100 + i]]); await sleep(85);
    }
    await sleep(150);
    let s = await t.st();
    eq([s.kills, s.wrong], [24, 0], '速射：8 下／秒連點 24 下，24 下都擊倒、0 打錯');
    // two thumbs landing almost together (second 20 ms after the first, both correct): both count
    let pairs = 0;
    for (let i = 0; i < 6; i++) {
      s = await t.st(); const k0 = s.kills; const [ax, ay] = await t.lane(s.slots[0]), [bx, by] = await t.lane(s.slots[1]);
      await t.T('touchStart', [[ax, ay, 200 + i]]); await sleep(20);
      await t.T('touchStart', [[ax, ay, 200 + i], [bx + 2, by, 300 + i]]); await sleep(50);
      await t.T('touchEnd', [[ax, ay, 200 + i]]); await t.T('touchEnd', [[bx + 2, by, 300 + i]]);
      await sleep(150);
      if ((await t.st()).kills - k0 === 2) pairs++;
    }
    eq([pairs, (await t.st()).wrong], [6, 0], '速射：兩指相隔 20 ms 落下 6 次，12 下都擊倒');
    // an auto-clicker hitting the right lane on every frame for 3 s: capped at 20 shots a second
    const r = await t.p.evaluate(() => new Promise(res => { const g = window.__game, k0 = g.state().kills, t0 = performance.now();
      const f = () => { const s = g.state(); if (performance.now() - t0 >= 3000) return res({ kills: s.kills - k0, secs: (performance.now() - t0) / 1000 }); g.press(s.slots[0]); requestAnimationFrame(f); }; requestAnimationFrame(f); }));
    assert(r.kills <= Math.ceil(r.secs * 20) + 2 && r.kills >= r.secs * 10, `速射：每幀連點 ${r.secs.toFixed(1)} 秒只擊倒 ${r.kills} 隻（上限每秒 20 槍）`);
    await t.ctx.close();
  }

  await browser.close();
  eq(errors, [], '沒有 page error／console error');
  console.log(`(${Math.round((Date.now() - t0) / 1000)} s)`);
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
