// 辨色眼力：上架複審修正的回歸測試（node tests.js，約 40 秒）。觸控用真實 CDP Input.dispatchTouchEvent，頁面走本機 http。
// 1) core-check.js：CIEDE2000、8-bit 量化、紅綠色弱仍看得出、漸層盤面上單一離群格、曲線單調
// 2) 頁面：存檔驗證、觸控判定（換題中的第二下不算、答案格邊緣寬容）、換題時計時停止、切 App 暫停並存檔、
//    新紀錄只算一次、結算卡防誤觸、旋轉暫停、格子 ≥ 40px
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
    return { ctx, p, cdp, touch, st, ls, tap, ready, geo, center, answer, start };
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

  // 4. 旋轉：遊戲中轉成橫向會暫停；各尺寸格子 ≥ 40 px、盤面在畫面內
  for (const [w, h] of [[390, 844], [375, 500], [844, 390], [320, 568]]) {
    const t = await open(w, h);
    await t.start('classic');
    const s = await t.st(), g = await t.geo(), cs = (g.board.w - g.gap * (s.kmax - 1)) / s.kmax;
    assert(cs >= 40 - 1e-6 || s.kmax === 4, `${w}×${h}：最大 ${s.kmax}×${s.kmax} 時每格 ${cs.toFixed(1)} px（≥ 40）`);
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

  await browser.close();
  eq(errors, [], '沒有頁面錯誤');
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
