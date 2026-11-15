// 辨色眼力：上架複審修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) core-check.js：CIEDE2000、8-bit 量化、紅綠色弱仍看得出、漸層盤面上單一離群格、曲線單調
// 2) 頁面：存檔驗證、觸控判定（換題中的第二下不算、答案格邊緣寬容）、換題時計時停止、切 App 暫停並存檔、
//    新紀錄只算一次、結算卡防誤觸、旋轉暫停、盤面固定 7×7
// 3) 複審 toFix：另一指放著時按鈕照樣有反應、按鈕框內邊緣的點按、不同格快速連點、點按後的 detail 0 click 不重複執行、
//    提示用過即停用、紀錄曲線文字不矛盾也不擠、360×640 標題畫面不用捲動
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), { spawnSync } = require('child_process');
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
  const core = spawnSync(process.execPath, [path.join(__dirname, 'core-check.js')], { encoding: 'utf8', timeout: 120000 });
  assert(core.status === 0 && /CORE CHECK PASSED/.test(core.stdout), '題目產生器：CIEDE2000 色差、量化、色弱、離群格、曲線（core-check.js）');
  if (core.status !== 0) console.log(core.stdout.split('\n').slice(-25).join('\n'));

  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, storage = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in s) localStorage.setItem(k, s[k]); } }, storage);
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = async (x, y, hold = 40) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(hold);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const st = () => p.evaluate(() => window.__game.state());
    // several fingers: CDP touchStart/touchMove list every finger that is down; touchEnd releases only the ones it lists
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const box = sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
    const shown = () => p.evaluate(() => ['title', 'help', 'statsOv', 'pause', 'over', 'shareOv'].filter(x => !document.getElementById(x).classList.contains('hidden')));
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem('coloreye.' + k)), k);
    // a button that is on screen and no longer animating in
    const tap = async sel => {
      await p.waitForFunction(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && !e.closest('.hidden') && !e.getAnimations({ subtree: false }).length && !(e.closest('.card') && e.closest('.card').getAnimations().some(a => a.playState === 'running')); }, sel);
      const b = await p.locator(sel).boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2);
    };
    // the board is settled (input open) and shows question token tok
    const ready = (tok) => p.waitForFunction(t => { const s = window.__game.state(); return s.status === 'playing' && !s.animating && (t == null || s.token === t); }, tok, { timeout: 15000 });
    // geometry of the current board, from the grid itself (not from cells that might still be scaling in)
    const geo = () => p.evaluate(() => {
      const b = document.getElementById('board'), r = b.getBoundingClientRect(), cells = [...b.children], k = Math.round(Math.sqrt(cells.length));
      const gap = parseFloat(getComputedStyle(b).columnGap) || 0, cs = (r.width - gap * (k - 1)) / k;
      const bg = cells.map(c => c.style.background), cnt = {}; bg.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
      const odd = bg.findIndex(x => cnt[x] === 1);
      const rect = i => ({ x: r.left + (i % k) * (cs + gap), y: r.top + Math.floor(i / k) * (cs + gap), w: cs });
      return { k, gap, cs, odd, oddR: rect(odd), wrongR: rect(odd === 0 ? 1 : 0), wrongIdx: odd === 0 ? 1 : 0, board: { x: r.left, y: r.top, w: r.width, h: r.height } };
    });
    const center = R => [R.x + R.w / 2, R.y + R.w / 2];
    const answer = async () => { await ready(); const s = await st(); const g = await geo(); await touch(...center(g.oddR)); await p.waitForFunction(c => window.__game.state().correct > c, s.correct); };
    const start = async mode => { await tap(`.mode[data-m="${mode}"]`); await ready(); };
    // settled = on screen and its card no longer popping in
    const settled = sel => p.waitForFunction(s => { const e = document.querySelector(s); if (!e || e.closest('.hidden')) return false; const r = e.getBoundingClientRect(); if (!r.width) return false; const c = e.closest('.card'); return !(c && c.getAnimations().some(a => a.playState === 'running')); }, sel);
    return { ctx, p, cdp, touch, st, ls, tap, ready, geo, center, answer, start, T, box, shown, settled };
  }

  // 1. 壞掉的存檔不會讓頁面出錯或顯示怪數字
  {
    const t = await open(390, 844, { 'coloreye.best': '"lots"', 'coloreye.best.zen': '-5', 'coloreye.best.hue': '42.7', 'coloreye.daily': '{"2026-10-30":"x","oops":3,"2026-10-01":55.55}',
      'coloreye.minDE': '"tiny"', 'coloreye.hist': '{"a":1}', 'coloreye.ach': '[1,2]', 'coloreye.mute': '"no"' });
    eq(await t.p.$$eval('.mode em', es => es.map(e => e.textContent)), ['尚無紀錄', '尚無紀錄', '最高 42 分', '尚無紀錄', '今日尚未挑戰'], '模式卡片只顯示合法紀錄');
    eq(await t.p.getAttribute('#bMute', 'aria-label'), '關閉音效', '字串 "no" 不會被當成靜音');
    await t.tap('#tStats'); await t.p.waitForSelector('#statsOv:not(.hidden)');
    eq(await t.p.$$eval('#bests b', bs => bs.map(b => b.textContent)), ['–', '–', '42', '–', '1 天', '–'], '紀錄頁只算合法資料');
    eq(await t.p.textContent('#achN'), '0 / 10', '成就存檔是陣列時當作沒有成就');
    await t.ctx.close();
  }

  // 2. 真實觸控：答對、答錯、換題中的第二下、答案格邊緣寬容、換題時計時停止
  {
    const t = await open();
    await t.start('classic');
    let s = await t.st(), g = await t.geo();
    eq([s.status, s.time > 59 && s.time <= 60, g.k], ['playing', true, 2], '經典模式開局 60 秒、2×2');
    await t.touch(...t.center(g.wrongR));
    await t.p.waitForFunction(() => window.__game.state().wrong === 1);
    s = await t.st(); assert(s.time < 57.2 && s.time > 56, `答錯扣 3 秒（剩 ${s.time.toFixed(2)}）`);
    await t.p.waitForTimeout(200); // past the 150 ms double-tap guard
    // fast double tap: the second finger goes down while the board is changing and lifts on the next board
    const tok0 = s.token;
    await t.touch(...t.center(g.oddR));
    await t.p.waitForFunction(() => window.__game.state().correct === 1);
    // record the clock every frame while the next board comes in
    const frozen = t.p.evaluate(() => new Promise(res => { const v = []; (function f(){ const s = window.__game.state(); if (s.animating){ v.push(s.time); requestAnimationFrame(f); } else res(v); })(); }));
    await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: t.center(g.wrongR)[0], y: t.center(g.wrongR)[1] }] });
    await t.ready(tok0 + 1);
    await t.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const v = await frozen;
    await t.p.waitForTimeout(100);
    s = await t.st();
    eq([s.correct, s.wrong, s.token], [1, 1, tok0 + 1], '換題中按下、新題才放開的第二下不算（不會被判答錯）');
    assert(v.length >= 3 && Math.max(...v) - Math.min(...v) < 1e-9, `換題動畫期間計時停住（${v.length} 幀都是 ${v[0].toFixed(2)}）`);
    // tap in the gap just outside the answer cell, on the side facing a neighbour: counts as the answer
    await t.ready(); g = await t.geo();
    const col = g.odd % g.k;
    const x = col < g.k - 1 ? g.oddR.x + g.oddR.w + g.gap + 2 : g.oddR.x - g.gap - 2; // inside the neighbouring cell by a couple of px
    const y = g.oddR.y + g.oddR.w / 2;
    await t.touch(x, y);
    await t.p.waitForFunction(() => window.__game.state().correct === 2 || window.__game.state().wrong === 2);
    s = await t.st(); eq([s.correct, s.wrong], [2, 1], '答案格外緣幾 px 也算點中答案');
    await t.ctx.close();
  }

  // 3. 切到別的 App：暫停並先存最高分；回來結束本局只記一次、仍顯示新紀錄；結算卡出現時的連點不會直接重開
  {
    const t = await open(390, 844, { 'coloreye.best': '5' });
    await t.start('classic');
    for (let i = 0; i < 3; i++) await t.answer();
    const s1 = await t.st();
    await t.p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const s2 = await t.st();
    eq(s2.status, 'paused', '切到背景時暫停');
    eq(await t.ls('best'), s1.score, `切到背景時先存下最高分（${s1.score}）`);
    eq((await t.ls('hist')).length, 1, '經典紀錄曲線先記一筆');
    await t.p.waitForTimeout(400);
    eq((await t.st()).time, s2.time, '暫停時時間不動');
    await t.p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await t.tap('#pEnd');
    await t.p.waitForSelector('#over:not(.hidden)');
    eq(await t.p.textContent('#oRec'), '新紀錄！', '已提前存檔的分數結算時仍算新紀錄');
    eq([await t.ls('best'), (await t.ls('hist')).length], [s1.score, 1], '結算後最高分不變、紀錄曲線不重複記');
    await t.ctx.close();
  }
  {
    const t = await open();
    await t.start('zen');
    for (let i = 0; i < 3; i++) {
      await t.ready(); const s = await t.st(); const g = await t.geo();
      await t.touch(...t.center(g.wrongR)); await t.p.waitForFunction(w => window.__game.state().wrong > w, s.wrong);
      await t.p.waitForTimeout(200);
    }
    const st0 = await t.p.waitForFunction(() => { if (document.getElementById('over').classList.contains('hidden')) return false; document.getElementById('oAgain').click(); return window.__game.state().status; });
    eq(await st0.jsonValue(), 'over', '結算卡剛出現時的點擊不會重開一局');
    await t.p.waitForTimeout(600);
    await t.tap('#oAgain');
    await t.p.waitForFunction(() => window.__game.state().status === 'playing');
    assert(true, '稍後再按「再玩一次」就能重開');
    await t.ctx.close();
  }

  // 4. 旋轉：遊戲中轉成橫向會暫停；盤面最大格數每支手機都是 7×7（分數、每日題組可以互比），格子夠大、盤面在畫面內
  for (const [w, h] of [[390, 844], [360, 640], [430, 932], [375, 500], [844, 390], [320, 568]]) {
    const t = await open(w, h);
    await t.start('classic');
    const s = await t.st(), g = await t.geo(), cs = (g.board.w - g.gap * (s.kmax - 1)) / s.kmax, minCs = w >= 360 && h >= 600 ? 40 : 34;
    assert(s.kmax === 7 && cs >= minCs - 1e-6, `${w}×${h}：最大盤面 ${s.kmax}×${s.kmax}，每格 ${cs.toFixed(1)} px（≥ ${minCs}）`);
    assert(g.board.x >= 0 && g.board.y >= 0 && g.board.x + g.board.w <= w && g.board.y + g.board.h <= h, `${w}×${h}：盤面完整在畫面內`);
    if (w === 390 && h === 844) {
      await t.p.setViewportSize({ width: 844, height: 390 });
      await t.p.waitForFunction(() => window.__game.state().status === 'paused');
      assert(true, '遊戲中轉向會暫停');
      await t.tap('#pResume'); await t.ready();
      const g2 = await t.geo();
      assert(g2.board.x + g2.board.w <= 844 && g2.board.y + g2.board.h <= 390, '轉向後盤面重新排在畫面內');
      await t.touch(...t.center(g2.oddR));
      await t.p.waitForFunction(() => window.__game.state().correct === 1);
      assert(true, '轉向後點答案仍正確判定');
    }
    await t.ctx.close();
  }

  // 5. [否決] 另一指放著時：聲音、提示、暫停、繼續、模式卡、玩法說明都照常執行，且只執行一次
  {
    const t = await open();
    await t.start('classic');
    const foot = await t.box('.foot'), rest = [20, foot.cy, 7];
    const restTap = async (sel, order) => {
      await t.settled(sel); const b = await t.box(sel);
      await t.T('touchStart', [rest]); await sleep(60);
      await t.T('touchStart', [rest, [b.cx, b.cy, 1]]); await sleep(50);
      if (order === 'tapUpFirst') { await t.T('touchEnd', [[b.cx, b.cy, 1]]); await sleep(60); await t.T('touchEnd', [rest]); }
      else { await t.T('touchEnd', [rest]); await sleep(60); await t.T('touchEnd', [[b.cx, b.cy, 1]]); }
      await sleep(120);
    };
    for (const order of ['tapUpFirst', 'restUpFirst']) {
      const m0 = (await t.st()).muted;
      await restTap('#bMute', order);
      eq((await t.st()).muted, !m0, `另一指放著（${order}）點聲音：切換一次`);
    }
    await t.ready();
    await restTap('#bHint', 'tapUpFirst');
    let s = await t.st(); eq([s.hints, s.hintedQ], [2, true], '另一指放著點提示：用掉一次');
    await restTap('#bPause', 'tapUpFirst');
    eq((await t.st()).status, 'paused', '另一指放著點暫停：暫停');
    await restTap('#pResume', 'restUpFirst');
    eq((await t.st()).status, 'playing', '另一指放著點繼續：繼續');
    await restTap('#bPause', 'restUpFirst');
    await restTap('#pMenu', 'tapUpFirst');
    eq((await t.st()).status, 'title', '另一指放著點主選單：回標題');
    // title: one finger in the top-left corner, the other taps a mode card / help
    const rest2 = [6, 6, 7];
    const restTap2 = async sel => { await t.settled(sel); const b = await t.box(sel); await t.T('touchStart', [rest2]); await sleep(60); await t.T('touchStart', [rest2, [b.cx, b.cy, 1]]); await sleep(50); await t.T('touchEnd', [[b.cx, b.cy, 1]]); await sleep(60); await t.T('touchEnd', [rest2]); await sleep(120); };
    await restTap2('#tHelp');
    eq(await t.shown(), ['help'], '標題畫面另一指放著點玩法說明：打開說明');
    await restTap2('#helpOk');
    eq(await t.shown(), ['title'], '另一指放著點知道了：回標題');
    const t0 = (await t.st()).t0;
    await restTap2('.mode[data-m="zen"]');
    s = await t.st(); eq([s.status, s.mode, s.t0 !== t0], ['playing', 'zen', true], '標題畫面另一指放著點模式卡：開一局');
    await t.ctx.close();
  }

  // 6. [否決] 按鈕框內邊緣 1–2 px 的點按（按下效果不再移動或縮小按鈕）
  {
    const t = await open();
    await t.settled('#tHelp');
    let b = await t.box('#tHelp');
    await t.touch(b.cx, b.y + 1, 80);
    await t.p.waitForTimeout(100);
    eq(await t.shown(), ['help'], '玩法說明上緣往內 1 px：打開說明');
    await t.settled('#helpOk'); b = await t.box('#helpOk');
    await t.touch(b.cx, b.y + 1, 80); await t.p.waitForTimeout(100);
    eq(await t.shown(), ['title'], '知道了上緣往內 1 px：關閉');
    await t.settled('.mode[data-m="classic"]'); b = await t.box('.mode[data-m="classic"]');
    await t.touch(b.x + 1, b.cy, 80);
    await t.ready();
    eq((await t.st()).status, 'playing', '經典卡左緣往內 1 px：開局');
    b = await t.box('#bHint');
    await t.touch(b.x + 2, b.cy, 80); await t.p.waitForTimeout(100);
    eq((await t.st()).hints, 2, '提示鈕左緣往內 2 px：用掉提示');
    b = await t.box('#bPause');
    await t.touch(b.cx, b.y + 1, 80); await t.p.waitForTimeout(100);
    eq((await t.st()).status, 'paused', '暫停鈕上緣往內 1 px：暫停');
    await t.settled('#pResume'); b = await t.box('#pResume');
    await t.touch(b.cx, b.y + 1, 600); await t.p.waitForTimeout(100);
    eq((await t.st()).status, 'playing', '繼續上緣往內 1 px、按住 0.6 秒：繼續');
    // bottom edge sits on a half pixel next to the 重新開始/結束本局 row: 0.5 px inside still counts
    b = await t.box('#bPause'); await t.touch(b.cx, b.cy, 40); await t.p.waitForFunction(() => window.__game.state().status === 'paused');
    await t.settled('#pResume'); b = await t.box('#pResume');
    await t.touch(b.cx, b.y + b.h - 0.5, 1000); await t.p.waitForTimeout(100);
    eq((await t.st()).status, 'playing', '繼續下緣往內 0.5 px、按住 1 秒：繼續');
    const tf = await t.p.evaluate(() => { const css = [...document.styleSheets].flatMap(s => [...s.cssRules]).filter(r => r.selectorText && /:active/.test(r.selectorText)); return css.filter(r => r.style.transform).map(r => r.selectorText); });
    eq(tf, [], '按下效果（:active）不用 transform，按鈕的點擊範圍不會在放開前移走');
    await t.ctx.close();
  }

  // 7. [否決] 同一盤不同格快速連點：錯格後 125 ms 點答案照算；兩個錯格每 125 ms 交替都算
  {
    const t = await open();
    await t.start('classic');
    let g = await t.geo();
    const wrongs = [0, 1, 2, 3].filter(i => i !== g.odd), rect = i => ({ x: g.board.x + (i % 2) * (g.cs + g.gap), y: g.board.y + Math.floor(i / 2) * (g.cs + g.gap), w: g.cs });
    const quick = async (i, period = 125) => { const t1 = Date.now(); await t.touch(...t.center(rect(i)), 30); const left = period - (Date.now() - t1); if (left > 0) await sleep(left); };
    for (let n = 0; n < 6; n++) await quick(wrongs[n % 2]);
    await t.p.waitForTimeout(100);
    let s = await t.st(); eq([s.wrong, s.correct], [6, 0], '兩個錯格每 125 ms 交替 6 下：6 下都算');
    await quick(wrongs[2]);
    await t.touch(...t.center(rect(g.odd)), 30);
    await t.p.waitForFunction(() => window.__game.state().correct === 1, null, { timeout: 2000 }).catch(() => {});
    s = await t.st(); eq([s.wrong, s.correct], [7, 1], '錯格後 125 ms 點答案格：答案照算');
    await t.ctx.close();
  }

  // 8. 點按後的 detail 0 click（CI 的 Chromium 141 會送）不會讓動作再跑一次，也不會點到新畫面；沒有點按時的 detail 0 照常執行
  {
    const t = await open();
    const click0 = (sel, where) => t.p.evaluate(([s, w]) => {
      const e = document.querySelector(s), r = e.getBoundingClientRect();
      const pt = w === 'edge' ? [r.left + 1, r.top + 1] : [r.left + r.width / 2, r.top + r.height / 2];
      const tgt = w === 'fromPoint' ? (document.elementFromPoint(pt[0], pt[1]) || document.body) : e;
      tgt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: pt[0], clientY: pt[1] }));
    }, [sel, where]);
    // mode card: tap, then the follow-up clicks on the (now hidden) card, its edge and whatever is under the finger
    await t.settled('.mode[data-m="classic"]');
    await t.tap('.mode[data-m="classic"]');
    const s0 = await t.st();
    for (const w of ['self', 'edge', 'fromPoint']) await click0('.mode[data-m="classic"]', w);
    await t.p.waitForTimeout(50);
    let s = await t.st(); eq([s.status, s.t0, s.token], ['playing', s0.t0, s0.token], '點模式卡後的 detail 0 click（本身、邊緣、手指下的元素）：只開一局');
    // mute
    for (const gap of [0, 30, 300]) {
      const m0 = (await t.st()).muted;
      await t.tap('#bMute'); await sleep(gap);
      for (const w of ['self', 'edge', 'fromPoint']) await click0('#bMute', w);
      eq((await t.st()).muted, !m0, `點聲音後 ${gap} ms 的 detail 0 click：只切換一次`);
    }
    // a lone detail-0 click (assistive tech, no tap in the last 800 ms) acts once
    await sleep(900);
    let m0 = (await t.st()).muted; await click0('#bMute', 'self');
    eq((await t.st()).muted, !m0, '沒有點按時單獨的 detail 0 click：照常切換一次');
    // keyboard right after a tap still works (Enter after the tap opens a keyboard window)
    await t.tap('#bMute'); m0 = (await t.st()).muted;
    await t.p.focus('#bMute'); await t.p.keyboard.press('Enter');
    eq((await t.st()).muted, !m0, '點按後立刻用鍵盤 Enter：照樣執行');
    // 重新開始 / 主選單: one run each, nothing on the new screen fires
    await t.tap('#bPause'); await t.p.waitForFunction(() => window.__game.state().status === 'paused');
    const s1 = await t.st();
    await t.tap('#pRestart');
    for (const w of ['self', 'edge', 'fromPoint']) await click0('#pRestart', w);
    await t.p.waitForTimeout(50);
    s = await t.st(); assert(s.status === 'playing' && s.t0 !== s1.t0 && s.token === s1.token + 1, `重新開始後的 detail 0 click：只開一局（題目序號 +${s.token - s1.token}）`);
    await t.tap('#bPause'); await t.p.waitForFunction(() => window.__game.state().status === 'paused');
    await t.tap('#pMenu');
    for (const w of ['self', 'edge', 'fromPoint']) await click0('#pMenu', w);
    await t.p.waitForTimeout(50);
    eq([(await t.st()).status, await t.shown()], ['title', ['title']], '主選單後的 detail 0 click：停在標題，沒有點到標題畫面的模式卡');
    await t.ctx.close();
  }
  // 結算卡：再玩一次、主選單、分享眼力各只執行一次
  {
    const t = await open();
    await t.start('zen');
    await t.answer();
    for (let i = 0; i < 3; i++) { await t.ready(); const s = await t.st(), g = await t.geo(); await t.touch(...t.center(g.wrongR)); await t.p.waitForFunction(w => window.__game.state().wrong > w, s.wrong); await t.p.waitForTimeout(200); }
    await t.p.waitForSelector('#over:not(.hidden)'); await t.p.waitForTimeout(600);
    await t.p.evaluate(() => { window.__shares = 0; const o = window.HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function(cb, ty){ window.__shares++; return o.call(this, cb, ty); }; });
    await t.tap('#oShare');
    await t.p.evaluate(() => document.getElementById('oShare').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await t.p.waitForSelector('#shareOv:not(.hidden)');
    eq(await t.p.evaluate(() => window.__shares), 1, '分享眼力後的 detail 0 click：只產生一次分享圖');
    await t.tap('#shareOk'); await t.settled('#oAgain');
    const { t0, token: tk0 } = await t.st();
    await t.tap('#oAgain');
    await t.p.evaluate(() => document.getElementById('oAgain').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await t.p.waitForTimeout(50);
    let s = await t.st(); eq([s.status, s.t0 !== t0, s.token - tk0], ['playing', true, 1], '再玩一次後的 detail 0 click：只開一局');
    await t.ctx.close();
  }

  // 9. 提示：同一題用過就停用並寫明，下一題恢復
  {
    const t = await open();
    await t.start('classic');
    await t.tap('#bHint');
    let h = await t.p.evaluate(() => ({ dis: document.getElementById('bHint').disabled, txt: document.getElementById('hHintTxt').textContent }));
    eq(h, { dis: true, txt: '本題已用' }, '用過提示後按鈕停用、顯示「本題已用」');
    await t.answer(); await t.ready();
    h = await t.p.evaluate(() => ({ dis: document.getElementById('bHint').disabled, txt: document.getElementById('hHintTxt').textContent }));
    eq(h, { dis: false, txt: '提示' }, '下一題提示鈕恢復');
    await t.ctx.close();
  }

  // 10. 紀錄頁曲線：標題和圖內說法一致，文字不和刻度擠在一起
  {
    const hist = JSON.stringify([{ t: 1, s: 100, m: 6.2 }, { t: 2, s: 300, m: 3.1 }, { t: 3, s: 500, m: 1.4 }, { t: 4, s: 200, m: 4.4 }]);
    const t = await open(390, 844, { 'coloreye.hist': hist });
    await t.p.evaluate(() => { window.__txt = []; const o = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(s, x, y){ if (this.canvas.id === 'chart'){ const m = this.measureText(s), a = this.textAlign; const x0 = a === 'right' ? x - m.width : a === 'center' ? x - m.width / 2 : x; window.__txt.push({ s, x0, x1: x0 + m.width, y0: y - 10, y1: y + 2 }); } return o.call(this, s, x, y); }; });
    await t.tap('#tStats'); await t.p.waitForSelector('#statsOv:not(.hidden)'); await t.p.waitForTimeout(300);
    const r = await t.p.evaluate(() => ({ title: [...document.querySelectorAll('#statsOv h3, #chartNote')].map(h => h.textContent).join('|'), txt: window.__txt, w: document.getElementById('chart').clientWidth, h: document.getElementById('chart').clientHeight }));
    const all = r.title + r.txt.map(x => x.s).join('|');
    assert(!/越低越好/.test(all) && !/越高越好/.test(all) && /越上面，ΔE 越小＝眼力越好/.test(all), '曲線說明一致：越上面 ΔE 越小＝眼力越好（刻度 ' + r.txt.map(x => x.s).join('、') + '）');
    let overlap = 0; for (let i = 0; i < r.txt.length; i++) for (let j = i + 1; j < r.txt.length; j++) { const a = r.txt[i], b = r.txt[j]; if (a.x0 < b.x1 + 4 && b.x0 < a.x1 + 4 && a.y0 < b.y1 && b.y0 < a.y1) overlap++; }
    const inside = r.txt.every(x => x.x0 >= 0 && x.x1 <= r.w && x.y0 >= -1 && x.y1 <= r.h + 1);
    assert(r.txt.length >= 3 && overlap === 0 && inside, `曲線上 ${r.txt.length} 個刻度互不重疊、都在圖內`);
    await t.ctx.close();
  }

  // 11. 360×640（和 320×568）標題畫面不用捲動就看得到最下面的色準說明
  for (const [w, h] of [[360, 640], [320, 568], [375, 667], [390, 844]]) {
    const t = await open(w, h);
    const r = await t.p.evaluate(() => { const o = document.getElementById('title'), n = document.querySelector('.note').getBoundingClientRect(); return { sh: o.scrollHeight, ch: o.clientHeight, nb: n.bottom, ih: innerHeight }; });
    assert(r.sh <= r.ch && r.nb <= r.ih, `${w}×${h} 標題畫面不用捲動，色準說明在畫面內（底 ${r.nb.toFixed(0)} / ${r.ih}）`);
    await t.ctx.close();
  }

  await browser.close();
  eq(errors, [], '沒有頁面錯誤');
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
