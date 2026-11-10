// Regression tests for 鏡湖雙影 (mirror-walk), run by qa/smoke/run.js. Usage: node tests.js
// Core (Node): tutorial level 1, breather levels. Browser (real CDP touch, 390x844 mobile): rapid 8 taps/s on the
// 十字鍵 with no dropped input, ghost click after skipping the 最少解 demo, buttons with another finger down,
// two fingers on the 十字鍵, slow taps (0.6 s / 1 s), unfinished board saved across reload, hint star cap,
// win saved before the animation ends, lake toast not covering the board, landscape HUD, idle redraw throttle.
// Every wait polls a condition (no fixed sleeps for timing-sensitive values).
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {parseLevel, initState, step, analyze, diffScore, levelKinds};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn LEVELS;')();
let pass = 0, fail = 0; const T0 = Date.now();
function ok(cond, name, extra) { name += ' [' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'; if (cond) { pass++; console.log('  ok', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const sol = n => core.analyze(core.parseLevel(LEVELS[n - 1]), null, 3000000, false).sol;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- core ----------
{
  const L = core.parseLevel(LEVELS[0]), r = core.analyze(L, null, 1e6, true);
  ok(LEVELS.length === 100, '100 levels');
  ok(r.len === 3 && r.E === 0 && LEVELS[0][4] === 3, 'level 1 is a 3-step tutorial with no 錯位 (left/right opposite only)', [r.len, r.E]);
  const L2 = core.analyze(core.parseLevel(LEVELS[1]), null, 1e6, true);
  ok(L2.E > 0, 'level 2 introduces 錯位');
  for (const n of [70, 80, 90, 95]) {
    const e = LEVELS[n - 1], q = core.analyze(core.parseLevel(e), null, 3000000, true);
    ok(q.len === e[4] && q.E === e[5] && q.len <= 0.65 * LEVELS[n - 2][4] && q.len <= 0.65 * LEVELS[n][4] && q.E <= 0.5 * q.len && core.levelKinds(core.parseLevel(e)) >= core.levelKinds(core.parseLevel(LEVELS[n - 2])) - 1,
      'breather level ' + n + ' is short (opt ' + q.len + ' vs ' + LEVELS[n - 2][4] + '/' + LEVELS[n][4] + ', 錯位 ' + q.E + ') with the same mechanics', [q.len, q.E]);
  }
}

(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: o.vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('' + e)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const init = Object.assign({ 'mirrorwalk.intro': JSON.stringify({ rule1: 1, rule40: 1, rule75: 1, spike: 1, door: 1, ice: 1, tele: 1, guard: 1, frag: 1 }) }, o.storage || {});
    await page.goto('file://' + APP);
    await page.evaluate(s => { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }, init);
    await page.reload();
    await page.waitForFunction(() => window.__game && document.getElementById('tPlay'));
    const cdp = await ctx.newCDPSession(page);
    const T = {
      ctx, page, cdp,
      st: () => page.evaluate(() => window.__game.state()),
      until: async (fn, arg, ms = 20000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 30 }); } catch (e) { throw new Error('timeout waiting for ' + String(fn).slice(0, 120) + ' state ' + JSON.stringify(await page.evaluate(() => window.__game.state()))); } },
      settle: () => page.waitForFunction(() => { const s = window.__game.state(); return !s.animating && !s.queue; }, null, { timeout: 20000, polling: 30 }),
      level: async n => { await page.evaluate(n => window.__game.startLevel(n), n); await T.until(() => window.__game.state().status === 'play'); },
      center: sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel),
      down: (id, p, others = []) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...others, { x: p.x, y: p.y, id }] }),
      up: (id, p) => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }),
      tapXY: async (p, hold = 50) => { await T.down(1, p); await sleep(hold); await T.up(1, p); },
      tap: async (sel, hold = 50) => T.tapXY(await T.center(sel), hold),
      vis: sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden') && e.getBoundingClientRect().height > 0; }, sel),
    };
    return T;
  }
  const PAD = { 'mirrorwalk.settings': JSON.stringify({ dpad: true }) };

  // 1. rapid 8 taps/s on the 十字鍵 along the optimal solution: nothing dropped, level won
  {
    const T = await open({ storage: PAD });
    for (const n of [50, 52]) {
      await T.level(n);
      const seq = sol(n), pts = {};
      for (const d of [0, 1, 2, 3]) pts[d] = await T.center('.dpad [data-d="' + d + '"]');
      const t0 = Date.now();
      for (let i = 0; i < seq.length; i++) {
        const w = t0 + i * 125 - Date.now(); if (w > 0) await sleep(w);
        await T.down(1, pts[seq[i]]); await sleep(35); await T.up(1, pts[seq[i]]);
      }
      await T.until(() => window.__game.state().status === 'won' || window.__game.state().status === 'dead' || (!window.__game.state().animating && !window.__game.state().queue));
      const s = await T.st();
      ok(s.status === 'won' && s.moves === seq.length, 'L' + n + ': ' + seq.length + ' 十字鍵 taps at 8/s -> ' + s.moves + ' moves, ' + s.status, s);
    }
    await T.ctx.close();
  }

  // 2. skipping the 最少解 demo with a canvas tap where a win-card button will appear: no ghost click (60 ms, 0.6 s, 1 s)
  {
    const T = await open({ storage: PAD });
    for (const [sel, hold] of [['#wNext', 60], ['#wNext', 600], ['#wNext', 1000], ['#wReplay', 60]]) {
      await T.level(3);
      await T.page.evaluate(s => s.forEach(d => window.__game.move(d)), sol(3));
      await T.until(() => !document.getElementById('win').classList.contains('hidden'));
      await T.tap('#wReplay', 50);
      await T.until(() => window.__game.state().status === 'replay' && window.__game.state().animating);
      const p = await T.page.evaluate(s => { const ov = document.getElementById('win'); ov.classList.remove('hidden'); const r = document.querySelector(s).getBoundingClientRect(); ov.classList.add('hidden'); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
      await T.down(1, p); await sleep(hold);
      const mid = await T.st();
      await T.up(1, p);
      await T.until(() => window.__game.state().status !== 'replay');
      await sleep(400); // let any follow-up click land
      const s = await T.st();
      ok(mid.status === 'replay' && s.status === 'won' && s.level === 3 && await T.vis('#win') && !(await T.vis('#banner')), 'skip demo at ' + sel + ' spot, hold ' + hold + ' ms: win card stays, no ghost click', { mid: mid.status, s });
    }
    // dpad winning move held 1 s, then the card: still on the win card of the same level
    await T.level(3); const s3 = sol(3);
    await T.page.evaluate(s => s.slice(0, -1).forEach(d => window.__game.move(d)), s3); await T.settle();
    await T.tap('.dpad [data-d="' + s3[s3.length - 1] + '"]', 1600);
    await T.until(() => !document.getElementById('win').classList.contains('hidden'));
    await sleep(300);
    ok((await T.st()).level === 3 && await T.vis('#win'), 'dpad winning move held 1.6 s: no ghost click on the win card');
    // win card 關卡選擇 tapped: the select grid that appears under the finger ignores the follow-up click
    await T.tap('#wSelect', 60); await sleep(400);
    ok((await T.st()).status === 'select', 'tap 關卡選擇: the level grid does not open a level from the ghost click');
    await T.tap('.lt[data-n="3"]', 60); await T.until(() => window.__game.state().status === 'play');
    ok((await T.st()).level === 3, 'tap a level tile opens it');
    await T.ctx.close();
  }

  // 3. buttons with another finger already down; 4. two fingers on the 十字鍵; 5. slow taps
  {
    const T = await open({ storage: PAD });
    const board = await T.page.evaluate(() => { const g = window.__game.geo(); return { x: g.A.x + 5, y: g.A.y + 5 }; });
    const withFinger = async (sel, fn) => {
      const p2 = await T.center(sel);
      await T.down(1, board); await sleep(60);
      await T.down(2, p2, [{ x: board.x, y: board.y, id: 1 }]); await sleep(70);
      await T.up(2, p2); await sleep(150);
      const r = await fn();
      await T.up(1, board); await sleep(100);
      return r;
    };
    await T.level(2); await T.page.evaluate(() => { window.__game.move(3); window.__game.move(1); }); await T.settle();
    const m0 = (await T.st()).moves;
    ok(await withFinger('#bUndo', async () => (await T.st()).moves) === m0 - 1, 'second finger: 悔棋 works while a finger is on the board');
    await withFinger('#bHint', async () => 0);
    ok(/提示/.test(await T.page.textContent('#toast')), 'second finger: 提示 works');
    const muted0 = await T.page.evaluate(() => JSON.parse(localStorage.getItem('mirrorwalk.settings') || '{}').mute || false);
    await withFinger('#bMute', async () => 0);
    ok(await T.page.evaluate(() => JSON.parse(localStorage.getItem('mirrorwalk.settings')).mute) === !muted0, 'second finger: 靜音 works');
    await withFinger('#bMute', async () => 0);
    await withFinger('#bRestart', async () => 0);
    ok((await T.st()).moves === 0, 'second finger: 重來 works');
    await withFinger('#bPause', async () => 0);
    ok((await T.st()).status === 'paused', 'second finger: 暫停 works');
    await T.tap('#pResume', 60); await T.until(() => window.__game.state().status === 'play');
    // two fingers on the 十字鍵: hold 上, tap 右, release 上 -> exactly two moves and no key stuck down
    await T.level(2);
    const up = await T.center('.dpad [data-d="0"]'), rt = await T.center('.dpad [data-d="1"]');
    const exp = (() => { const L = core.parseLevel(LEVELS[1]); let S = core.initState(L), m = 0; for (const d of [0, 1]) { const r = core.step(L, S, d); if (r) { S = r.S; m++; } } return m; })();
    await T.down(1, up); await sleep(80);
    await T.down(2, rt, [{ x: up.x, y: up.y, id: 1 }]); await sleep(60); await T.up(2, rt); await sleep(120);
    await T.up(1, up); await T.settle(); await sleep(100);
    const s4 = await T.st(), stuck = await T.page.evaluate(() => document.querySelectorAll('.dpad .down').length);
    ok(s4.moves === exp && stuck === 0, 'two fingers on 十字鍵: hold 上 + tap 右 = ' + exp + ' moves, no key stuck', { moves: s4.moves, stuck });
    // slow taps
    for (const hold of [600, 1000]) {
      await T.level(2); await T.page.evaluate(() => { window.__game.move(3); window.__game.move(1); }); await T.settle();
      const a = (await T.st()).moves;
      await T.tap('#bUndo', hold); await sleep(150);
      const b = (await T.st()).moves;
      await T.tap('.dpad [data-d="3"]', hold); await T.settle();
      const c = (await T.st()).moves;
      await T.tap('#bPause', hold); await sleep(150); const paused = (await T.st()).status === 'paused';
      await T.tap('#pResume', hold); await sleep(150); const resumed = (await T.st()).status === 'play';
      ok(b === a - 1 && c === b + 1 && paused && resumed, 'slow taps held ' + hold + ' ms: 悔棋, 十字鍵 (one move), 暫停, 繼續', { a, b, c, paused, resumed });
    }
    // keyboard / element.click() still work (detail 0)
    await T.page.evaluate(() => { window.__game.move(3); }); await T.settle();
    await sleep(900); const k0 = (await T.st()).moves; await T.page.evaluate(() => document.getElementById('bUndo').click());
    ok((await T.st()).moves === k0 - 1, 'keyboard-style click (detail 0) on 悔棋 still works');
    await T.ctx.close();
  }

  // 6. unfinished board survives a reload; 7. hint caps stars at 2; 8. win saved before the animation ends
  {
    const T = await open({ storage: { 'mirrorwalk.unlockAll': 'true' } });
    await T.tap('#tSelect'); await T.until(() => window.__game.state().status === 'select');
    await T.tap('.lt[data-n="2"]'); await T.until(() => window.__game.state().status === 'play');
    const s2 = sol(2);
    for (const d of s2.slice(0, 2)) { await T.page.evaluate(d => window.__game.move(d), d); await T.settle(); }
    const saved = await T.page.evaluate(d => { window.__game.move(d); return JSON.parse(localStorage.getItem('mirrorwalk.inprog') || '{}').L2; }, s2[2]);
    ok(saved && saved.length === 3, 'moves saved immediately (not after the animation)', saved);
    const before = await T.st(); await T.settle();
    await T.page.reload(); await T.page.waitForFunction(() => window.__game);
    const label = await T.page.textContent('#tPlay');
    ok(/繼續第 2 關（3 步）/.test(label), 'title shows 繼續第 2 關（3 步）', label);
    await T.tap('#tPlay'); await T.until(() => window.__game.state().status === 'play');
    const after = await T.st();
    ok(after.level === 2 && after.moves === 3 && after.a === (await T.st()).a, 'reload resumes the board', { before, after });
    await T.tap('#bRestart'); await T.settle();
    ok((await T.st()).moves === 0 && !(await T.page.evaluate(() => JSON.parse(localStorage.getItem('mirrorwalk.inprog')).L2)), '重來 clears the saved board');
    // hint cap
    await T.level(1); await T.tap('#bHint'); await sleep(100);
    const q1 = sol(1);
    for (const d of q1.slice(0, -1)) { await T.page.evaluate(d => window.__game.move(d), d); await T.settle(); }
    const p1 = await T.page.evaluate(d => { window.__game.move(d); return (JSON.parse(localStorage.getItem('mirrorwalk.progress')) || {})[1]; }, q1[q1.length - 1]);
    ok(p1 && p1.s === 2 && p1.nh === 0, 'optimal win with a hint is saved as 2 stars, immediately', p1);
    await T.until(() => !document.getElementById('win').classList.contains('hidden'));
    ok(/提示/.test(await T.page.textContent('#wMsg')) && (await T.page.$$eval('#wStars .on', e => e.length)) === 2, 'win card says a hint was used and shows 2 stars');
    await T.level(1); await T.page.evaluate(s => s.forEach(d => window.__game.move(d)), sol(1));
    await T.until(() => window.__game.state().status === 'won');
    ok((await T.page.evaluate(() => JSON.parse(localStorage.getItem('mirrorwalk.progress'))[1])).s === 3, 'optimal win without hints upgrades to 3 stars');
    // hiding the page during the final animation still shows the win card later (was stuck with no card)
    await T.until(() => !document.getElementById('win').classList.contains('hidden'));
    await T.level(1); const s1 = sol(1);
    await T.page.evaluate(s => { s.forEach(d => window.__game.move(d)); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }, s1);
    await T.until(() => !document.getElementById('win').classList.contains('hidden'), null, 5000).catch(() => {});
    ok(await T.vis('#win'), 'page hidden during the winning animation: win card still appears');
    await T.ctx.close();
  }

  // 9. level-start toast sits in the lake gap (does not cover board rows); 10. landscape HUD; 11. idle throttle
  {
    const T = await open({ vp: { width: 360, height: 640 }, storage: { 'mirrorwalk.unlockAll': 'true' } });
    await T.tap('#tSelect'); await T.until(() => window.__game.state().status === 'select');
    await T.page.evaluate(() => document.querySelector('.lt[data-n="100"]').scrollIntoView({ block: 'center' }));
    await T.tap('.lt[data-n="100"]'); await T.until(() => window.__game.state().status === 'play');
    const r = await T.page.evaluate(() => { const g = window.__game.geo(), L = window.__game.state(), t = document.getElementById('toast').getBoundingClientRect(); return { aBot: g.A.y + 8 * g.s, bTop: g.B.y, t: { top: t.top, bottom: t.bottom }, vis: !document.getElementById('toast').classList.contains('hidden') }; });
    ok(r.vis && r.t.top >= r.aBot - 0.5 && r.t.bottom <= r.bTop + 0.5, '360x640 L100: level toast fits inside the lake gap', r);
    // idle redraw throttle: count frames that draw vs rAF callbacks over ~1 s of idle play
    const ratio = await T.page.evaluate(() => new Promise(res => {
      const ctx = document.getElementById('cv').getContext('2d'), orig = ctx.setTransform; let draws = 0, frames = 0;
      ctx.setTransform = function () { draws++; return orig.apply(this, arguments); };
      setTimeout(() => {
        draws = 0; let n = 0; const tick = () => { frames++; if (++n < 60) requestAnimationFrame(tick); else { ctx.setTransform = orig; res(draws / frames); } }; requestAnimationFrame(tick);
      }, 3000); // after the toast and ripples are gone
    }));
    ok(ratio <= 0.5, 'idle: board redrawn on at most every 2nd frame (ratio ' + ratio.toFixed(2) + ')');
    await T.page.setViewportSize({ width: 844, height: 390 });
    await T.page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
    await T.page.evaluate(() => { if (!document.body.classList.contains('pad')) document.getElementById('bPad').click(); });
    await T.level(99);
    const land = await T.page.evaluate(() => { const h = document.querySelector('.hmid').getBoundingClientRect(); return { w: h.width, s: window.__game.geo().s }; });
    ok(land.w <= 470 && land.s >= 30, '844x390 L99 with 十字鍵: compact HUD and cells >= 30 px', land);
    await T.ctx.close();
  }

  ok(errors.length === 0, 'no page or console errors', errors.slice(0, 5));
  await browser.close();
  console.log((fail ? 'FAIL ' : '') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
