// 雙軌疾行：上架複審 R1 修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指），頁面走本機 http。
// 1) 按鈕在 pointerup 依 pointerId 動作：另一指放在畫布／標題字上、兩指重疊（兩種放開順序）、換道＋暫停重疊、按住 0.6／1 秒
// 2) 點按後補上的 detail 0 click 不會重複（靜音、開始、重新開始）；單獨的 detail 0 click 與鍵盤照常動作一次
// 3) 橫式 844x390／667x375／740x360 標題「開始」看得到也點得到，結算頁不切字
// 4) 撞車後連點不會跳過結算畫面（約 700 ms 鎖定，且只接受結算出現後才按下的手指）
// 5) 暖身：前幾排只有圓圈、漏接不結束
// 6) 目標與統計：存活 30 秒等目標、局數／平均／最長，型別檢查後保存
// 7) 壞存檔 best 夾到合理範圍；HUD「最佳」有深色底；舊的 best／muted 照常載入
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(APP)); });
  srv.unref();
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
// counts startGame() runs (it rewrites the HUD best line) and returns to the title (title best rewritten)
const INST = () => {
  window.__ev = { start: 0, menu: 0 };
  new MutationObserver(() => __ev.start++).observe(document.getElementById('hudbest'), { childList: true });
  new MutationObserver(() => __ev.menu++).observe(document.getElementById('titleBest'), { childList: true });
};

(async () => {
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = { 'twin-lanes:muted': '0' }) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    await p.evaluate(INST);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const tapXY = async (x, y, hold = 40, id = 1) => { await T('touchStart', [[x, y, id]]); await sleep(hold); await T('touchEnd', [[x, y, id]]); };
    const tap = async (sel, hold = 40, id = 1) => { const b = await box(sel); await tapXY(b.cx, b.cy, hold, id); };
    const st = () => p.evaluate(() => { const s = window.__game.getState(); return { state: s.state, lanes: s.lanes, deathT: s.deathT, muted: localStorage.getItem('twin-lanes:muted') }; });
    const ev = () => p.evaluate(() => { const e = { ...__ev }; __ev.start = 0; __ev.menu = 0; return e; });
    const waitState = (s, timeout = 4000) => p.waitForFunction(s => window.__game.getState().state === s, s, { timeout }).then(() => true, () => false);
    // let the browser's own follow-up click (if any) arrive before counting
    const settle = () => sleep(250);
    const fresh = async () => { await p.evaluate(() => window.__game.start()); await sleep(60); await ev(); };
    return { ctx, p, cdp, T, box, tap, tapXY, st, ev, waitState, settle, fresh };
  }

  // ---------- 1. touch: pointerup per pointerId ----------
  {
    const t = await open();
    const { p, T, box, tap, st, ev, waitState, settle, fresh } = t;
    const L = [90, 600], R = [300, 600];
    // title: a finger resting on the logo, tap 開始 with another finger
    const lg = await box('.logo'), sb = await box('#startBtn');
    await ev();
    await T('touchStart', [[lg.cx, lg.cy, 9]]); await sleep(150);
    await T('touchStart', [[lg.cx, lg.cy, 9], [sb.cx, sb.cy, 2]]); await sleep(50);
    await T('touchEnd', [[sb.cx, sb.cy, 2]]);
    assert(await waitState('play'), '一指放在標題字上，另一指點「開始」→ 開始');
    await T('touchEnd', [[lg.cx, lg.cy, 9]]); await settle();
    assert((await ev()).start === 1, '…且只開始一次');
    // play: finger resting on the canvas at (90,600), tap 暫停
    await fresh();
    const pb = await box('#pauseBtn'), mb = await box('#muteBtn');
    await T('touchStart', [[...L, 9]]); await sleep(150);
    await T('touchStart', [[...L, 9], [pb.cx, pb.cy, 2]]); await sleep(50);
    await T('touchEnd', [[pb.cx, pb.cy, 2]]);
    assert(await waitState('paused'), '一指放在畫布 (90,600)，另一指點「暫停」→ 暫停（touchEnd 只列第二指）');
    await T('touchEnd', [[...L, 9]]); await settle();
    // resume with a finger resting on the pause title
    const ovt = await box('#pauseOv .ovt'), rb = await box('#resumeBtn');
    await T('touchStart', [[ovt.cx, ovt.cy, 9]]); await sleep(150);
    await T('touchStart', [[ovt.cx, ovt.cy, 9], [rb.cx, rb.cy, 2]]); await sleep(50);
    await T('touchEnd', [[rb.cx, rb.cy, 2]]);
    assert(await waitState('play'), '一指放在「暫停中」字上，另一指點「繼續」→ 繼續');
    await T('touchEnd', [[ovt.cx, ovt.cy, 9]]); await settle();
    // mute with a resting finger, three times
    await fresh();
    const m0 = (await st()).muted;
    await T('touchStart', [[...L, 9]]); await sleep(150);
    for (let i = 0; i < 3; i++) { await T('touchStart', [[...L, 9], [mb.cx, mb.cy, 2]]); await sleep(50); await T('touchEnd', [[mb.cx, mb.cy, 2]]); await sleep(150); }
    await T('touchEnd', [[...L, 9]]); await settle();
    assert((await st()).muted !== m0, '另一指放著時連點靜音 3 次 → 切換 3 次（最後與開始相反）');
    // overlapping 暫停 + 靜音, both release orders
    for (const first of ['mute', 'pause']) {
      await fresh(); if ((await st()).state !== 'play') await fresh();
      const before = (await st()).muted;
      await T('touchStart', [[mb.cx, mb.cy, 1]]); await sleep(50);
      await T('touchStart', [[mb.cx, mb.cy, 1], [pb.cx, pb.cy, 2]]); await sleep(60);
      if (first === 'mute') { await T('touchEnd', [[mb.cx, mb.cy, 1]]); await sleep(30); await T('touchEnd', [[pb.cx, pb.cy, 2]]); }
      else { await T('touchEnd', [[pb.cx, pb.cy, 2]]); await sleep(30); await T('touchEnd', [[mb.cx, mb.cy, 1]]); }
      await settle();
      const s = await st();
      assert(s.state === 'paused' && s.muted !== before, `靜音＋暫停兩指重疊（先放${first === 'mute' ? '靜音' : '暫停'}）→ 兩個都作用`);
    }
    // steering finger + 暫停 overlapping
    await fresh();
    const lanes0 = (await st()).lanes;
    await T('touchStart', [[...R, 1]]); await sleep(50);
    await T('touchStart', [[...R, 1], [pb.cx, pb.cy, 2]]); await sleep(60);
    await T('touchEnd', [[...R, 1]]); await sleep(30); await T('touchEnd', [[pb.cx, pb.cy, 2]]); await settle();
    { const s = await st(); assert(s.state === 'paused' && s.lanes[1] !== lanes0[1], '一指換道＋一指按暫停重疊 → 換道也暫停'); }
    // holds 0.6 s / 1 s on mute: once each
    for (const hold of [600, 1000]) {
      await fresh(); const b = (await st()).muted;
      await tap('#muteBtn', hold); await settle();
      assert((await st()).muted !== b, `按住靜音 ${hold} ms 放開 → 切換一次`);
    }
    // canvas steering still on pointerdown
    await fresh();
    { const l0 = (await st()).lanes[0]; await T('touchStart', [[...L, 5]]); const l1 = (await st()).lanes[0]; await T('touchEnd', [[...L, 5]]); assert(l1 !== l0, '畫布換道仍在按下時就作用'); }
    // ---------- 2. detail-0 click after a real tap ----------
    const d0 = (sel, pt) => p.evaluate(([sel, pt]) => {
      const el = document.querySelector(sel), r = el.getBoundingClientRect();
      const c = (e, x, y) => e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y }));
      c(el, r.left + r.width / 2, r.top + r.height / 2); c(el, r.left + 1, r.top + 1);
      c(document.elementFromPoint(pt.cx, pt.cy), pt.cx, pt.cy);
    }, [sel, pt]);
    await fresh();
    { const b = (await st()).muted; await tap('#muteBtn'); await sleep(30); await d0('#muteBtn', mb); await settle();
      assert((await st()).muted !== b, '點靜音後補上 detail 0 click（本身、邊緣、手指下）→ 只切一次'); }
    await sleep(900);
    { const b = (await st()).muted; await p.evaluate(() => document.getElementById('muteBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      assert((await st()).muted !== b, '沒有點按時，單獨的 detail 0 click 照常切一次'); }
    // 重新開始 from pause
    await p.keyboard.press('KeyP'); await waitState('paused'); await ev();
    { const rs = await box('#restartBtn'); await tap('#restartBtn'); await sleep(30); await d0('#restartBtn', rs); await settle();
      const e = await ev(); assert(e.start === 1 && (await st()).state === 'play', `點「重新開始」後補 detail 0 click → 只開始 1 次（${e.start}）`); }
    // 主選單 then 開始
    await p.keyboard.press('KeyP'); await waitState('paused'); await tap('#menuBtn'); await waitState('title'); await sleep(900); await ev();
    { const b = await box('#startBtn'); await tap('#startBtn'); await sleep(30); await d0('#startBtn', b); await settle();
      const e = await ev(); assert(e.start === 1 && (await st()).state === 'play', `點「開始」後補 detail 0 click → 只開始 1 次，新畫面上也沒有東西被觸發（${e.start}）`); }
    // keyboard on a focused button acts once
    // (a scripted click within 800 ms of the last tap would be swallowed as its ghost, so wait that out first)
    await sleep(850); await p.keyboard.press('KeyP'); await waitState('paused'); await p.evaluate(() => document.getElementById('menuBtn').click()); await waitState('title'); await sleep(900); await ev();
    await p.focus('#startBtn'); await p.keyboard.press('Enter'); await settle();
    { const e = await ev(); assert(e.start === 1, `鍵盤：焦點在「開始」按 Enter → 開始 1 次（${e.start}，${(await st()).state}）`); }
    await t.ctx.close();
  }

  // ---------- 1b. the speaker works on every screen (title, pause, result), alone and with another finger resting ----------
  for (const [w, h] of [[360, 640], [844, 390]]) {
    const t = await open(w, h);
    const { p, T, box, st, ev, waitState, fresh } = t;
    const screens = [
      ['標題', async () => { await sleep(100); }, 'title'],
      ['暫停', async () => { await fresh(); await p.keyboard.press('KeyP'); await waitState('paused'); }, 'paused'],
      ['結算', async () => { await fresh(); await p.evaluate(() => window.__game.crash()); await waitState('over'); await sleep(800); }, 'over']
    ];
    for (const [name, go, want] of screens) for (const resting of [false, true]) {
      await go(); await sleep(850); await ev();
      const mb = await box('#muteBtn');
      const top = await p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); return !!(e && e.closest('#muteBtn')); }, mb);
      const before = (await st()).muted;
      // the resting finger sits on the screen's title text (a tap there could only mean retry on the result card,
      // so it is lifted with touchCancel after the check)
      const tb = await box(want === 'title' ? '.logo' : want === 'paused' ? '#pauseOv .ovt' : '#overTitle');
      const rx = tb.cx, ry = tb.cy;
      if (resting) { await T('touchStart', [[rx, ry, 9]]); await sleep(150); await T('touchStart', [[rx, ry, 9], [mb.cx, mb.cy, 2]]); }
      else await T('touchStart', [[mb.cx, mb.cy, 2]]);
      await sleep(50); await T('touchEnd', [[mb.cx, mb.cy, 2]]);
      await sleep(300);
      const s = await st(), e = await ev();
      if (resting) { await T('touchCancel', []); await sleep(50); }
      assert(top && s.muted !== before && s.state === want && e.start === 0,
        `${w}x${h} ${name}畫面點喇叭${resting ? '（另一指放著）' : ''} → 靜音切一次，畫面不變（${s.state}）`);
    }
    await t.ctx.close();
  }

  // ---------- 3. landscape layouts ----------
  for (const [w, h] of [[844, 390], [667, 375], [740, 360]]) {
    const t = await open(w, h, { 'twin-lanes:best': '1234', 'twin-lanes:stats': '{"games":12,"total":4321,"longest10":4567}' });
    const { p, box, tap, waitState } = t;
    const inView = r => r.x >= -0.5 && r.y >= -0.5 && r.r <= w + 0.5 && r.b <= h + 0.5;
    const sb = await box('#startBtn'), lg = await box('.logo');
    const hit = await p.evaluate(b => { const e = document.elementFromPoint(b.cx, b.cy); return !!(e && e.closest('#startBtn')); }, sb);
    assert(inView(sb) && inView(lg) && hit, `${w}x${h} 標題：「開始」與標題字都在畫面內，按鈕中心點得到`);
    await tap('#startBtn');
    assert(await waitState('play'), `${w}x${h} 觸控點「開始」→ 開始`);
    await p.evaluate(() => window.__game.crash()); await waitState('over'); await sleep(200);
    const cut = await p.evaluate(([w, h]) => [...document.querySelectorAll('#overOv .ovt, #overOv .lbl, #overOv .final, #overOv .stats, #overOv .goals, #overOv button, #overOv .hint')]
      .filter(e => e.getClientRects().length).filter(e => { const r = e.getBoundingClientRect(); return r.top < -0.5 || r.left < -0.5 || r.bottom > h + 0.5 || r.right > w + 0.5; }).map(e => e.id || e.className), [w, h]);
    assert(!cut.length, `${w}x${h} 結算頁沒有被切掉的字或按鈕 ${cut.join(',')}`);
    await t.ctx.close();
  }

  // ---------- 4. frantic tapping after a crash ----------
  {
    const t = await open();
    const { p, T, tapXY, st, waitState, fresh } = t;
    await fresh();
    // a finger that went down before the result appeared and lifts after it: no restart
    await T('touchStart', [[195, 600, 7]]);
    await p.evaluate(() => window.__game.crash());
    await waitState('over'); await sleep(900);
    await T('touchEnd', [[195, 600, 7]]); await sleep(300);
    assert((await st()).state === 'over', '撞車前按下、結算出現後才放開的手指不會重來');
    // frantic tapping across the crash: the card stays up for the lock, then a fresh tap restarts
    await fresh();
    const log = [];
    let shown = 0;
    const end = Date.now() + 4000;
    let crashed = false;
    while (Date.now() < end) {
      if (!crashed) { await p.evaluate(() => window.__game.crash()); crashed = true; }
      await tapXY(90, 600, 30);
      const s = await p.evaluate(() => ({ state: window.__game.getState().state, now: performance.now() }));
      if (s.state === 'over' && !shown) shown = s.now;
      log.push([s.state, s.now]);
      if (shown && s.state === 'play') break;
      await sleep(70);
    }
    shown = await p.evaluate(() => document.getElementById('overOv')._shownAt);
    const restartAt = (log.find(([s, n]) => n > shown && s === 'play') || [])[1];
    assert(shown > 0 && restartAt && restartAt - shown >= 700, `每 100 ms 連點：結算畫面停留 ${restartAt ? Math.round(restartAt - shown) : '?'} ms 才重來（≥ 約 700 ms）`);
    await t.ctx.close();
  }

  // ---------- 5. warm-up ----------
  {
    const t = await open();
    const { p, st, fresh } = t;
    await fresh();
    const seen = new Map();
    const end = Date.now() + 12000;
    let s;
    while (Date.now() < end) {
      s = await p.evaluate(() => window.__game.getState());
      for (const o of s.objs) if (!seen.has(o.id)) seen.set(o.id, o);
      const warm = [...seen.values()].filter(o => o.warm);
      if (warm.length >= 6 && s.objs.every(o => !o.warm)) break;
      await sleep(100);
    }
    const first = [0, 1].map(side => [...seen.values()].filter(o => o.side === side).sort((a, b) => a.id - b.id).slice(0, 3));
    assert(first.every(rows => rows.length === 3 && rows.every(o => o.kind === 'c' && o.warm && o.swapAt < 0)), '暖身：每邊前 3 排只有圓圈，不會換道');
    assert(s.state === 'play' && s.deathT < 0, '完全不點，暖身的 6 個圓圈漏接了也還活著');
    await t.ctx.close();
  }

  // ---------- 6. goals and statistics ----------
  {
    const t = await open(390, 844, { 'twin-lanes:goals': 'bogus,s30x,__proto__', 'twin-lanes:stats': '{"games":-3,"total":"abc","longest10":1e300}' });
    const { p, waitState, fresh } = t;
    let g = await p.evaluate(() => ({ goals: window.__game.goals().filter(x => x.done).length, stats: window.__game.stats(), text: document.getElementById('titleGoals').textContent }));
    assert(g.goals === 0 && g.stats.games === 0 && g.stats.total === 0 && g.stats.longest10 === 0 && /目標 0\/6/.test(g.text), `壞掉的目標／統計存檔變成 0：${g.text}`);
    await fresh();
    await p.evaluate(() => window.__game.skipTo(30.5)); await sleep(150);
    g = await p.evaluate(() => ({ done: window.__game.goals().filter(x => x.done).map(x => x.id), ls: localStorage.getItem('twin-lanes:goals') }));
    assert(g.done.includes('s30') && /s30/.test(g.ls), '存活 30 秒 → 目標達成並立刻保存');
    await p.evaluate(() => window.__game.crash()); await waitState('over'); await sleep(100);
    const og = await p.evaluate(() => document.getElementById('overGoals').textContent);
    assert(/達成：存活 30 秒/.test(og), `結算頁列出本局達成的目標：${og}`);
    await p.reload(); await p.waitForFunction(() => window.__game);
    g = await p.evaluate(() => ({ stats: window.__game.stats(), text: document.getElementById('titleGoals').textContent }));
    assert(g.stats.games === 1 && g.stats.longest10 >= 300 && /目標 1\/6/.test(g.text) && /已玩 1 局/.test(g.text), `重新整理後目標與統計還在：${g.text}`);
    await t.ctx.close();
  }

  // ---------- 7. details ----------
  for (const [v, want] of [['-5', '0'], ['99999999999999999999', '0'], ['3.7', '0'], ['0x1F', '0'], ['abc', '0'], ['1234', '1234'], ['  12  ', '12']]) {
    const t = await open(390, 844, { 'twin-lanes:best': v, 'twin-lanes:muted': '1' });
    const r = await t.p.evaluate(() => ({ tb: document.getElementById('titleBest').textContent, best: window.__game.getState().best, muted: document.getElementById('muteBtn').getAttribute('aria-pressed') }));
    assert(r.tb === want && String(r.best) === want && r.muted === 'true', `best='${v}' → 顯示 ${r.tb}（舊的 muted 照常載入）`);
    await t.ctx.close();
  }
  {
    const t = await open(360, 640, { 'twin-lanes:best': '1234' });
    await t.fresh();
    const bg = await t.p.evaluate(() => { const c = getComputedStyle(document.getElementById('hudbest')); return { bg: c.backgroundColor, color: c.color, text: document.getElementById('hudbest').textContent }; });
    const a = +((bg.bg.match(/rgba?\(([^)]+)\)/) || [])[1] || '0,0,0,0').split(',')[3];
    assert(bg.text === '最佳 1234' && a >= 0.6 && /255, 255, 255/.test(bg.color), `HUD「最佳」白字加深色底（${bg.bg}）`);
    // first seconds of a run: longest frame (informational on a shared CI machine, asserted loosely)
    const maxF = await t.p.evaluate(() => new Promise(res => { window.__game.start(); let last = 0, mx = 0, n = 0; const f = ts => { if (last) mx = Math.max(mx, ts - last); last = ts; if (++n < 150) requestAnimationFrame(f); else res(mx); }; requestAnimationFrame(f); }));
    assert(maxF < 120, `開局前 150 幀最長一幀 ${Math.round(maxF)} ms`);
    await t.ctx.close();
  }

  assert(!errors.length, '全程沒有 page／console error ' + errors.slice(0, 3).join(' | '));
  await browser.close(); srv.close();
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
