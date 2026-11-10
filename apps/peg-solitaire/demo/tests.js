// Regression tests for 玉珠孤棋 (peg-solitaire), run by qa/smoke/run.js. Every tap / drag is a real CDP touch
// (Input.dispatchTouchEvent). Covers the 2026-11-08 review findings:
//  multi-touch on the board, buttons firing on pointerup while another finger is down (no ghost / double clicks,
//  single / 0.6 s / 1 s taps), hint never ends empty-handed late in the game, in-progress save + 「繼續」, toast never
//  over the board, landscape cards fit, light-theme landing spots visible, late-level board variety, corrupt
//  pegsol.intro, daily done/streak on the title, HUD「標準」label, 44 px controls.
// node apps/peg-solitaire/demo/tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const URL = 'http://peg.test/apps/peg-solitaire/';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('ok   - ' + m); } else { fails++; console.log('FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();

// ---------- 1. core: levels ----------
const C = new Function(SRC.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {decLevel, applyMove, legal, goalOf, isGoal, handsOf};')();
const LEVELS = JSON.parse(SRC.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
{
  let good = 0, prevD = -1, incr = true;
  LEVELS.forEach((e, k) => {
    const v = C.decLevel(e), G = C.goalOf(v.B, v.goal, v.goalCells); let s = v.s, legal = true;
    for (const m of v.sol) { if (m < 0 || !C.legal(v.B, s[0], s[1], m)) legal = false; else s = C.applyMove(v.B, s, m); }
    if (v.L === k + 1 && legal && C.isGoal(G, s) && C.handsOf(v.B, v.sol) === v.hands) good++;
    if (v.D <= prevD) incr = false; prevD = v.D;
  });
  ok(LEVELS.length === 100 && good === 100, `all 100 levels: stored solution legal and reaches the goal (${good}/100)`);
  ok(incr, 'difficulty D strictly increases L1..L100');
  const late = LEVELS.filter(e => e[0] >= 71 && e[0] <= 99), sq7 = late.filter(e => e[1] === 'sq7').length, kinds = new Set(late.map(e => e[1]));
  ok(sq7 <= 12 && kinds.size >= 4, `late levels 71-99 vary: ${sq7}/29 on the 7x7 square, boards ${[...kinds].join(',')}`);
  let run = 0, maxRun = 0; late.forEach(e => { run = e[1] === 'sq7' ? run + 1 : 0; maxRun = Math.max(maxRun, run); });
  ok(maxRun <= 2, 'no more than 2 consecutive 7x7 square levels in 71-99 (' + maxRun + ')');
  const first = f => (LEVELS.find(f) || [0])[0];
  ok(first(e => e[2]) === 70 && first(e => e[3]) === 85 && first(e => e[4] === 'p') === 60, 'mechanics still first appear at L60 pattern, L70 diagonal, L85 rocks');
}

// ---------- browser helpers ----------
async function open(browser, w, h, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [], requests = [];
  await ctx.route('**/*', r => { if (r.request().url().startsWith('http://peg.test/')) return r.fulfill({ body: SRC, contentType: 'text/html; charset=utf-8' }); requests.push(r.request().url()); return r.abort(); });
  // every native click reaching the window (capture, before the app) is logged, so a ghost / double click is visible
  await ctx.addInitScript(() => { window.__clicks = []; addEventListener('click', e => { if (e.detail > 0) __clicks.push((e.target.closest && e.target.closest('button') || e.target).id || e.target.tagName); }, true); });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id || 1, radiusX: 2, radiusY: 2, force: 1 })) });
  const st = () => page.evaluate(() => __game.state());
  const until = (fn, arg, t = 4000) => page.waitForFunction(fn, arg, { timeout: t, polling: 30 }).then(() => true, () => false);
  const at = async sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height, b: b.bottom, r: b.right, t: b.top, l: b.left }; }, sel);
  const cellAt = i => page.evaluate(i => __game.cellXY(i), i);
  const tap = async (p, hold = 40, id = 1) => { await touch('touchStart', [{ ...p, id }]); if (hold) await sleep(hold); await touch('touchEnd', [{ ...p, id }]); };
  const visible = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
  const load = async () => { await page.goto(URL); await page.waitForFunction(() => window.__game); };
  const level = async n => { await page.evaluate(n => __game.startLevel(n), n); await until(() => __game.state().status === 'play'); };
  // finish the current animation so the next step reads a settled board (the game also does this on input)
  const settle = () => until(() => !__game.state().animating, null, 3000);
  return { ctx, page, cdp, errors, requests, touch, st, until, at, cellAt, tap, visible, load, level, settle };
}

(async () => {
  const browser = await chromium.launch();
  const allErr = [], allReq = [];
  try {
    // ================= 390x844 portrait =================
    {
      // corrupt saved values must not throw (pegsol.intro = 5 used to crash on level 1)
      const m = await open(browser, 390, 844, () => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('pegsol.intro', '5'); localStorage.setItem('pegsol.cur', '"x"'); localStorage.setItem('pegsol.daily', '7'); } });
      const { page, st, until, at, cellAt, tap, touch, visible } = m;
      await m.load();
      ok((await page.textContent('#tPlay')).trim() === '開始遊戲', 'fresh title shows 開始遊戲');
      // ---- title buttons: single taps at three hold lengths, each fires exactly once, no click passes through ----
      for (const hold of [40, 600, 1000]) {
        await page.evaluate(() => { __clicks.length = 0; });
        await tap(await at('#tSelect'), hold);
        const okSel = await until(() => !document.getElementById('select').classList.contains('hidden'), null, 2000);
        await sleep(150);
        const cl = await page.evaluate(() => __clicks.slice());
        const sw = await page.getAttribute('#unlockSw', 'aria-checked');
        ok(okSel && sw === 'false' && (await st()).status === 'select', `hold ${hold}ms: 選擇關卡 opens the grid once, no ghost click on the switch below (clicks ${cl.join(',') || 'none'} swallowed)`);
        await tap(await at('#sBack'), hold);
        ok(await until(() => !document.getElementById('title').classList.contains('hidden'), null, 2000), `hold ${hold}ms: 返回 goes back to the title`);
      }
      // mute toggles exactly once per tap
      await m.level(1);
      for (const hold of [40, 600]) {
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('pegsol.settings') || '{}').snd !== false);
        await tap(await at('#bMute'), hold); await sleep(120);
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('pegsol.settings') || '{}').snd !== false);
        ok(before !== after, `hold ${hold}ms: mute button toggles exactly once`);
      }
      ok(!m.errors.length, 'pegsol.intro = 5 (and other corrupt keys): level 1 starts without a page error ' + m.errors.join(' | '));

      // ---- ghost click: pause -> 關卡選擇 must not start the level that appears under the finger ----
      for (const hold of [40, 600, 1000]) {
        await m.level(3);
        await tap(await at('#bMenu')); await until(() => __game.state().status === 'paused');
        await tap(await at('#pSelect'), hold);
        await until(() => __game.state().status === 'select'); await sleep(250);
        ok((await st()).status === 'select', `hold ${hold}ms: 關卡選擇 shows the grid and no ghost tap starts a level under the finger`);
      }

      // ---- another finger already on the screen: every kind of button still fires ----
      const rest = { x: 30, y: 420, id: 7 };
      const twoFinger = async (sel, hold = 60) => { const p = await at(sel); await touch('touchStart', [rest]); await sleep(40);
        await touch('touchStart', [rest, { ...p, id: 2 }]); await sleep(hold); await touch('touchEnd', [{ ...p, id: 2 }]); await sleep(40); await touch('touchEnd', [rest]); };
      await page.evaluate(() => { document.getElementById('sBack').click(); });
      await m.until(() => __game.state().status === 'title');
      await twoFinger('#tSelect'); ok(await until(() => __game.state().status === 'select', null, 2000), 'finger resting on the screen: 選擇關卡 still opens');
      await page.evaluate(() => { const b = document.getElementById('sBack'); b.click(); });
      await until(() => __game.state().status === 'title');
      await m.level(4);
      let sol = await page.evaluate(() => __game.solution(4));
      let A = await cellAt(sol[0][0]), T = await cellAt(sol[0][1]);
      await tap(A); await tap(T); await m.settle();
      const pegs1 = (await st()).pegs;
      await twoFinger('#bUndo', 600);
      ok(await until(p => __game.state().pegs === p + 1, pegs1, 2000), 'finger resting on the screen: 悔棋 (held 0.6 s) undoes one move');
      await twoFinger('#bHint');
      ok(await until(() => !!__game.state().hint, null, 2000), 'finger resting on the screen: 提示 shows a hint');
      await twoFinger('#bMenu');
      ok(await until(() => __game.state().status === 'paused', null, 2000), 'finger resting on the screen: menu opens the pause card');
      await twoFinger('#pResume');
      ok(await until(() => __game.state().status === 'play', null, 2000), 'finger resting on the screen: 繼續 resumes');

      // ---- board: hold the peg with one finger, tap the landing spot with another ----
      await m.level(2); sol = await page.evaluate(() => __game.solution(2));
      A = await cellAt(sol[0][0]); T = await cellAt(sol[0][1]);
      let p0 = (await st()).pegs;
      await touch('touchStart', [{ ...A, id: 1 }]); await sleep(60);
      await touch('touchStart', [{ ...A, id: 1 }, { ...T, id: 2 }]); await sleep(60);
      await touch('touchEnd', [{ ...T, id: 2 }]); await sleep(60); await touch('touchEnd', [{ ...A, id: 1 }]);
      await m.settle();
      let s = await st();
      ok(s.pegs === p0 - 1 && s.hist === 1 && s.sel === -1, `hold peg + tap landing spot with a second finger jumps once (pegs ${p0} -> ${s.pegs}, moves ${s.hist})`);

      // ---- fast two-thumb tapping: each next finger lands before the previous one lifts (whole level 6) ----
      await m.level(6); sol = await page.evaluate(() => __game.solution(6));
      p0 = (await st()).pegs; let held = null, id = 10;
      for (const [a, t] of sol) {
        const pa = { ...(await cellAt(a)), id: id++ }, pt = { ...(await cellAt(t)), id: id++ };
        const down = held ? [held] : [];
        await touch('touchStart', [...down, pa]); if (held) { await touch('touchEnd', [held]); }
        await sleep(30); await touch('touchStart', [pa, pt]); await sleep(20); await touch('touchEnd', [pa]); held = pt; await sleep(30);
      }
      await touch('touchEnd', [held]);
      ok(await until(() => ['won'].includes(__game.state().status), null, 4000), `two-thumb overlapping taps: all ${sol.length} moves land and level 6 is cleared`);

      // ---- hold a peg, tap 悔棋 with the other finger: undo fires, the held peg does nothing after ----
      await m.level(5); sol = await page.evaluate(() => __game.solution(5));
      await tap(await cellAt(sol[0][0])); await tap(await cellAt(sol[0][1])); await m.settle();
      p0 = (await st()).pegs; const B = await cellAt(sol[1][0]), U = await at('#bUndo');
      await touch('touchStart', [{ ...B, id: 1 }]); await sleep(60);
      await touch('touchStart', [{ ...B, id: 1 }, { ...U, id: 2 }]); await sleep(60);
      await touch('touchEnd', [{ ...U, id: 2 }]); await sleep(60); await touch('touchEnd', [{ ...B, id: 1 }]); await sleep(120);
      s = await st();
      ok(s.pegs === p0 + 1 && s.hist === 0 && s.sel === -1, `hold a peg + tap 悔棋: undo fires (pegs ${p0} -> ${s.pegs}), no peg left selected`);

      // ---- single finger: tap-tap, drag, 8 taps per second on undo ----
      await m.level(7); sol = await page.evaluate(() => __game.solution(7));
      await tap(await cellAt(sol[0][0])); await tap(await cellAt(sol[0][1])); await m.settle();
      A = await cellAt(sol[1][0]); T = await cellAt(sol[1][1]);
      await touch('touchStart', [A]); for (let k = 1; k <= 6; k++) { await touch('touchMove', [{ x: A.x + (T.x - A.x) * k / 6, y: A.y + (T.y - A.y) * k / 6 }]); await sleep(16); } await touch('touchEnd', [T]);
      await m.settle();
      ok((await st()).hist === 2, 'single finger: tap-tap move and drag move both land');
      for (let k = 0; k < 2; k++) { await tap(await at('#bUndo'), 30); await sleep(95); }
      ok(await until(() => __game.state().hist === 0, null, 1500), 'undo tapped twice at 8/s: exactly two undos');
      ok((await page.textContent('#hParW')).includes('標準') && !(await page.textContent('#hParW')).includes('目標'), 'HUD says 手數 x／標準 y (no second 「目標」)');

      // ---- in-progress save: every move saved at once, title offers 「繼續第 N 關」, undo history restored ----
      await m.level(12); sol = await page.evaluate(() => __game.solution(12));
      for (const [a, t] of sol.slice(0, 3)) { await tap(await cellAt(a)); await tap(await cellAt(t)); }
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pegsol.cur'))); // read right away, before the jump animation ends
      ok(saved && saved.L12 && saved.L12.m.length === 3 && saved.last === 'L12', 'each move is saved immediately (pegsol.cur L12 has 3 moves)');
      const before = await st();
      await m.load();
      ok((await page.textContent('#tPlay')).trim() === '繼續第 12 關', 'after reload the title says 繼續第 12 關');
      await tap(await at('#tPlay')); await until(() => __game.state().status === 'play');
      s = await st();
      ok(s.level === 12 && s.pegs === before.pegs && s.hist === 3 && s.hands === before.hands, `繼續 restores level 12 board (${s.pegs} pegs, ${s.hist} moves, ${s.hands} hands)`);
      await tap(await at('#bUndo')); ok(await until(p => __game.state().pegs === p + 1, s.pegs, 1500), 'restored game can be undone');
      // 重來 by mistake is recoverable: 悔棋 right after it brings the game back
      const mid = await st();
      await tap(await at('#bRestart')); await until(() => __game.state().hist === 0, null, 1500);
      await tap(await at('#bUndo'));
      ok(await until(h => __game.state().hist === h, mid.hist, 1500) && (await st()).pegs === mid.pegs, '重來 then 悔棋 restores the abandoned game');
      for (const [a, t] of sol.slice(2)) { await tap(await cellAt(a)); await tap(await cellAt(t)); }
      await until(() => __game.state().status === 'won', null, 4000);
      ok(!(await page.evaluate(() => (JSON.parse(localStorage.getItem('pegsol.cur')) || {}).L12)), 'clearing the level removes its in-progress save');

      // ---- hint late in the game, off the solution line: never "nothing" after a long wait ----
      await m.level(99);
      const rnd = (() => { let a = 99; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
      const solKey = new Set();
      for (let k = 0; k < 4; k++) {
        const L = await page.evaluate(() => __game.legal()), sl = await page.evaluate(() => __game.solution(99));
        const mv = L.find(x => !(x[0] === sl[k][0] && x[1] === sl[k][1]) && rnd() < 0.5) || L[L.length - 1];
        await tap(await cellAt(mv[0])); await tap(await cellAt(mv[1])); await m.settle();
      }
      const histBefore = (await st()).hist;
      await tap(await at('#bHint'));
      const got = await until(() => { const s = __game.state(); return !!s.hint || s.rewind > 0; }, null, 9000);
      s = await st();
      const toastTxt = await page.textContent('#toast');
      ok(got && (s.hint || /悔棋 \d+ 步/.test(toastTxt)), `L99 after 4 off-line moves: 提示 gives a move or 「悔棋 N 步」 (${s.hint ? 'hint' : toastTxt})`);
      if (!s.hint) {
        await tap(await at('#bHint'));
        ok(await until(() => !!__game.state().hint, null, 2000) && (await st()).hist < histBefore, 'second 提示 press rewinds to the known-solvable position and shows the move');
      }

      // ---- daily: done today + streak on the title ----
      await page.evaluate(() => { const k = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), d = new Date(), y = new Date(); y.setDate(y.getDate() - 1); const o = {}; o[k(d)] = 3; o[k(y)] = 2; localStorage.setItem('pegsol.daily', JSON.stringify(o)); });
      await m.load();
      const dl = await page.textContent('#tDaily');
      ok(/✓/.test(dl) && /連續 2 天/.test(dl), '每日盤 button shows today ✓ and the streak: ' + dl);
      const tb = await page.evaluate(() => [...document.querySelectorAll('#tbtns button')].map(b => b.getBoundingClientRect()).every(r => r.height >= 44 && r.width >= 44));
      ok(tb, 'title buttons are at least 44x44');
      // light theme: landing spots clearly differ from empty holes
      await page.evaluate(() => { localStorage.setItem('pegsol.settings', JSON.stringify({ theme: 'light' })); });
      await m.load(); await m.level(20);
      const lv = await page.evaluate(() => { const L = __game.legal(); return L[0]; });
      await tap(await cellAt(lv[0])); await sleep(80);
      const contrast = await page.evaluate(([a, t]) => {
        const cv = document.getElementById('cv'), g = cv.getContext('2d'), px = (x, y) => g.getImageData(Math.round(x), Math.round(y), 1, 1).data;
        const T = __game.cellXY(t), land = new Set(__game.legal().filter(m => m[0] === a).map(m => m[1])), bd = __game.board();
        let H = null; for (let i = 0; i < bd.length && !H; i++) if (bd[i] === 0 && !land.has(i)) { const c = __game.cellXY(i); H = px(c.x, c.y); }
        const P = px(T.x, T.y); if (!H) return -1;
        return Math.abs(P[0] - H[0]) + Math.abs(P[1] - H[1]) + Math.abs(P[2] - H[2]);
      }, lv);
      ok(contrast > 90, 'light theme: a landing spot stands out from an empty hole (RGB distance ' + contrast + ')');
      allErr.push(...m.errors); allReq.push(...m.requests);
      await m.ctx.close();
    }

    // ================= toast placement at 360x640 and 844x390, landscape cards =================
    for (const [w, h] of [[360, 640], [844, 390]]) {
      const m = await open(browser, w, h, () => localStorage.setItem('pegsol.intro', JSON.stringify({ basic: 1, eng: 1, target: 1, tri: 1, classic: 1, pattern: 1, diag: 1, rock: 1, final: 1 })));
      const { page } = m; await m.load();
      const bad = await page.evaluate(() => {
        const out = [];
        for (let n = 1; n <= 100; n++) {
          __game.startLevel(n);
          const t = document.getElementById('toast').getBoundingClientRect(), s = __game.state();
          for (let i = 0; i < s.N; i++) { const c = __game.cellXY(i), r = c.s * 0.45; if (c.x + r > t.left && c.x - r < t.right && c.y + r > t.top && c.y - r < t.bottom) { out.push(n); break; } }
          if (t.top < 0 || t.bottom > innerHeight || t.right > innerWidth || t.left < 0) out.push('off' + n);
        }
        return out;
      });
      ok(!bad.length, `${w}x${h}: the level-start toast never covers a board cell (100 levels) ${bad.slice(0, 8).join(',')}`);
      if (w > h) {
        await m.level(75); const s = await page.evaluate(() => __game.cellXY(0).s);
        ok(s >= 44, `844x390: 7x7 board cell pitch ${s.toFixed(1)} px (>= 44)`);
        const ctl = await page.evaluate(() => ['bMenu', 'bMute', 'bUndo', 'bHint', 'bRestart'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.right <= innerWidth && r.bottom <= innerHeight; }).every(Boolean));
        ok(ctl, '844x390: HUD and bottom buttons are 44 px and on screen');
        // win card: every button visible without scrolling
        await m.level(1); const sol = await page.evaluate(() => __game.solution(1));
        for (const [a, t] of sol) { await m.tap(await m.cellAt(a)); await m.tap(await m.cellAt(t)); }
        await m.until(() => !document.getElementById('win').classList.contains('hidden'), null, 5000);
        // wait for the card's pop-in animation (it starts scaled to 0.86) before measuring
        const fit = async sel => { await m.until(sel => { const c = document.querySelector(sel.split(' ')[0] + ' .card'); return c && c.getAnimations().every(a => a.playState !== 'running'); }, sel, 3000); return page.evaluate(sel => [...document.querySelectorAll(sel)].filter(b => b.offsetParent).every(b => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height >= 44; }), sel); };
        ok(await fit('#win button'), '844x390: every button on the level-clear card is fully on screen');
        await page.evaluate(() => document.getElementById('wSelect').click()); await page.evaluate(() => document.getElementById('sBack').click());
        await page.evaluate(() => document.getElementById('tStats').click()); await sleep(100);
        ok(await fit('#stats button'), '844x390: statistics 關閉 is on screen');
        await page.evaluate(() => document.getElementById('stOk').click()); await page.evaluate(() => document.getElementById('tSet').click()); await sleep(100);
        ok(await fit('#settings button'), '844x390: every settings control (theme buttons 44 px high) is on screen');
      }
      allErr.push(...m.errors); allReq.push(...m.requests); await m.ctx.close();
    }
  } catch (e) { fails++; console.log('FAIL - exception: ' + (e && e.stack || e)); }
  await browser.close();
  ok(!allErr.length, 'no page / console errors ' + allErr.slice(0, 3).join(' | '));
  ok(!allReq.length, 'no outside network requests ' + allReq.slice(0, 3).join(' | '));
  console.log(`${fails ? 'FAIL' : 'PASS'}: ${passes} passed, ${fails} failed (${((Date.now() - T0) / 1000).toFixed(1)}s)`);
  process.exit(fails ? 1 : 0);
})();
