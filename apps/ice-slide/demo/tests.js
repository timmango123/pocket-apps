// Regression tests for 冰原企鵝 (ice-slide). Run: node tests.js   (from any directory)
// One headless Chromium; every wait is on a page condition, never a fixed sleep for game timing.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const URL = 'file://' + APP;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, doMove, solve, stateKey};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const LV = n => core.parseLevel(LEVELS[n - 1][0].split('/'));

let fails = 0, passes = 0; const T0 = Date.now();
const ok = (c, msg) => { if (c) { passes++; console.log('ok   ' + msg + '  [' + ((Date.now() - T0) / 1000).toFixed(1) + 's]'); } else { fails++; console.log('FAIL ' + msg); } };

// apply a sequence of directions the way the game does (null moves ignored, stop at fall/win)
function simulate(n, seq) {
  const L = LV(n); let S = core.initState(L), moves = 0, end = 'move';
  for (const d of seq) { const r = core.doMove(L, S, d); if (!r) continue; S = r.S; moves++; if (r.ev.result !== 'move') { end = r.ev.result; break; } }
  return { p: S.p, moves, end };
}
function solveFrom(L, S0, limit) {
  const seen = new Set([core.stateKey(S0)]), q = [S0]; let h = 0;
  while (h < q.length) { const S = q[h++]; for (let d = 0; d < 4; d++) { const r = core.doMove(L, S, d); if (!r || r.ev.result === 'fall') continue; if (r.ev.result === 'win') return true; const k = core.stateKey(r.S); if (seen.has(k)) continue; seen.add(k); q.push(r.S); if (q.length > limit) return null; } }
  return false;
}
// shortest move sequence (no falls, no wins) that leads to a position with no way home
function findDeadPath(n) {
  const L = LV(n), S0 = core.initState(L), prev = new Map([[core.stateKey(S0), null]]), q = [[S0, []]];
  for (let h = 0; h < q.length && h < 3000; h++) {
    const [S, p] = q[h];
    for (let d = 0; d < 4; d++) {
      const r = core.doMove(L, S, d); if (!r || r.ev.result !== 'move') continue;
      const k = core.stateKey(r.S); if (prev.has(k)) continue; prev.set(k, 1);
      if (solveFrom(L, r.S, 50000) === false) return p.concat(d);
      q.push([r.S, p.concat(d)]);
    }
  }
  return null;
}

async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * 40, y: y + DY * 40 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const settled = page => page.waitForFunction(() => { const s = window.__game.state(); return !s.animating && s.queued === 0 && s.status !== 'anim'; }, null, { timeout: 30000 });
const st = page => page.evaluate(() => window.__game.state());

(async () => {
  const t0 = Date.now();
  // ---- pure data checks (no browser) ----
  const opts = LEVELS.slice(0, 12).map(e => e[1]);
  ok(opts.filter(x => x === 4).length <= 5 && opts[11] >= 5, 'L1–L12 curve climbs to 5 (opts ' + opts.join(',') + ')');
  let solvable = true;
  for (let n = 1; n <= 12; n++) { const r = core.solve(LV(n), 200000); if (!r || r.len !== LEVELS[n - 1][1]) solvable = false; }
  ok(solvable, 'L1–L12 solvable with the embedded optimum');

  const browser = await chromium.launch();
  const errors = [];
  async function open(opts = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, opts));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__game);
    return { ctx, page };
  }
  try {
    // ---- 1. FIFO queue: swipes during a slide are all played, in order ----
    {
      const { ctx, page } = await open({ deviceScaleFactor: 1 });
      await page.evaluate(() => { localStorage.clear(); window.__game.startLevel(1); });
      await page.waitForFunction(() => window.__game.status === 'play' || window.__game.status === 'paused');
      await page.evaluate(() => { if (document.getElementById('iOk').offsetParent) document.getElementById('iOk').click(); });
      // right, down, left inside one slide (queue-probe): must end where the simulation ends
      await page.evaluate(() => { window.__game.move(1); window.__game.move(2); window.__game.move(3); });
      await settled(page);
      let s = await st(page), sim = simulate(1, [1, 2, 3]);
      ok(s.p === sim.p && s.moves === sim.moves, `L1 right-down-left during one slide → cell ${s.p}/${sim.p}, moves ${s.moves}/${sim.moves}`);

      // real CDP touch: 16 alternating swipes as fast as CDP allows (≥ 8/s), L2 left/right and L3 up/down
      const cdp = await ctx.newCDPSession(page);
      for (const [n, pair] of [[2, [3, 1]], [3, [0, 2]]]) {
        await page.evaluate(n => window.__game.startLevel(n), n);
        await settled(page);
        const seq = []; for (let i = 0; i < 16; i++) seq.push(pair[i % 2]);
        for (const d of seq) await swipe(cdp, 195, 420, d);
        await settled(page);
        s = await st(page); const want = simulate(n, seq);
        ok(s.moves === want.moves && s.p === want.p, `L${n} 16 rapid touch swipes → game ${s.moves} moves at ${s.p}, simulation ${want.moves} at ${want.p}`);
      }
      // queue is emptied by undo / restart
      await page.evaluate(() => window.__game.startLevel(2));
      await page.click('#bRestart'); await settled(page);
      await page.evaluate(() => { window.__game.move(3); window.__game.move(1); window.__game.move(3); window.__game.undo(); });
      await settled(page);
      s = await st(page);
      ok(s.queued === 0 && s.moves === 0, 'undo during a slide drops queued swipes and undoes the slide (moves ' + s.moves + ')');
      await ctx.close();
    }

    // ---- 2. resume an unfinished level after reload; progress saved when the winning slide starts ----
    {
      const { ctx, page } = await open();
      const sol = core.solve(LV(60), 2000000).sol;
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ice-slide:unlockAll', 'true'); localStorage.setItem('ice-slide:intro', JSON.stringify({ basic: 1, snow: 1, crack: 1, arrow: 1, block: 1, warp: 1 })); });
      await page.evaluate(() => window.__game.startLevel(60));
      for (const d of sol.slice(0, 6)) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      await page.reload(); await page.waitForFunction(() => window.__game);
      const label = await page.textContent('#tPlay');
      ok(/繼續第 60 關/.test(label), 'title offers to continue: "' + label + '"');
      await page.click('#tPlay');
      await page.waitForFunction(() => window.__game.status === 'play');
      let s = await st(page);
      ok(s.level === 60 && s.moves === 6, `continue → level ${s.level}, ${s.moves} moves restored`);
      for (const d of sol.slice(6)) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      await page.waitForFunction(() => window.__game.status === 'won');
      // win saved immediately: L1 final move, read storage in the same tick
      await page.evaluate(() => window.__game.startLevel(1));
      const sol1 = core.solve(LV(1)).sol;
      for (const d of sol1.slice(0, -1)) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      const saved = await page.evaluate(d => { window.__game.move(d); const st = window.__game.state(); return { anim: st.animating || st.queued > 0, prog: (JSON.parse(localStorage.getItem('ice-slide:progress')) || {})[1] }; }, sol1[sol1.length - 1]);
      ok(saved.prog && saved.prog.s === 3, 'progress written before the win animation finishes (animating=' + saved.anim + ')');
      await page.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'));
      ok(await page.isVisible('#wBadge'), 'clean optimal win shows the 一次到位 badge');
      const nu = await page.evaluate(() => JSON.parse(localStorage.getItem('ice-slide:progress'))[1].nu);
      ok(nu === 1, 'badge stored with progress');
      await ctx.close();
    }

    // ---- 3. old saved data still loads; stale best below a changed level's optimum is dropped ----
    {
      const { ctx, page } = await open();
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ice-slide:progress', JSON.stringify({ 1: { s: 3, b: 3 }, 5: { s: 3, b: 4 } })); localStorage.setItem('ice-slide:mute', 'true'); });
      await page.reload(); await page.waitForFunction(() => window.__game);
      await page.click('#tSelect');
      const t = await page.evaluate(() => ({ done: document.querySelectorAll('.lt.done').length, chap: document.querySelectorAll('.chap').length, sum: document.getElementById('selSum').textContent }));
      ok(t.done === 2 && /星星 6/.test(t.sum), 'old progress shown in level select: ' + t.sum);
      ok(t.chap === 10, 'level select grouped into 10 chapters with star totals');
      await page.click('.lt[data-n="5"]');
      await page.waitForFunction(() => window.__game.level === 5);
      const sub = await page.textContent('#hSub');
      ok(!/最佳 4/.test(sub), 'stale best (4 < new optimum 5) not shown: "' + sub + '"');
      const hudTxt = await page.textContent('#hud');
      ok(!/難度/.test(hudTxt), 'HUD no longer repeats the level number as 難度');
      await ctx.close();
    }

    // ---- 4. hint, undo/hint stars, dead-end warning, fail card ----
    {
      const { ctx, page } = await open();
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ice-slide:unlockAll', 'true'); localStorage.setItem('ice-slide:intro', JSON.stringify({ basic: 1, snow: 1, crack: 1, arrow: 1, block: 1, warp: 1 })); });
      await page.evaluate(() => window.__game.startLevel(1));
      await page.click('#bHint');
      await page.waitForFunction(() => window.__game.state().hint >= 0, null, { timeout: 20000 });
      let s = await st(page); const sol1 = core.solve(LV(1)).sol;
      const L1 = LV(1), r1 = core.doMove(L1, core.initState(L1), s.hint);
      ok(r1 && solveFrom(L1, r1.S, 1000) === true && (s.flags & 4), 'hint arrow points along a winning path (dir ' + s.hint + ', optimal first ' + sol1[0] + ')');
      for (const d of sol1) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      await page.waitForFunction(() => window.__game.status === 'won');
      await page.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'));
      const stars = await page.evaluate(() => document.querySelectorAll('#wStars .on').length);
      ok(stars === 2 && !(await page.isVisible('#wBadge')), 'hinted optimal win → 2 stars, no badge (' + stars + ')');

      // a run that used undo gets 3 stars but no badge
      await page.evaluate(() => window.__game.startLevel(2));
      const sol2 = core.solve(LV(2)).sol;
      await page.evaluate(d => window.__game.move(d), sol2[0]); await settled(page);
      await page.evaluate(() => window.__game.undo());
      for (const d of sol2) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      await page.waitForFunction(() => !document.getElementById('win').classList.contains('hidden'));
      ok(!(await page.isVisible('#wBadge')) && (await page.evaluate(() => document.querySelectorAll('#wStars .on').length)) === 3, 'win after undo: 3 stars, no 一次到位 badge');

      // dead end → toast telling the player to undo
      let deadLv = 0, deadSeq = null;
      for (const n of [16, 17, 18, 19, 20, 21, 22]) { deadSeq = findDeadPath(n); if (deadSeq) { deadLv = n; break; } }
      ok(!!deadSeq, 'found a dead-end position to test (L' + deadLv + ' ' + (deadSeq || []).join('') + ')');
      if (deadSeq) {
        await page.evaluate(n => window.__game.startLevel(n), deadLv);
        for (const d of deadSeq) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
        await page.waitForFunction(() => /回不了家/.test(document.getElementById('toast').textContent) && !document.getElementById('toast').classList.contains('hidden'), null, { timeout: 20000 });
        ok(true, 'dead-end toast shown');
      }

      // fall: small card without blur, hole stays visible (L16 left-down-up)
      await page.evaluate(() => window.__game.startLevel(16));
      for (const d of [3, 2, 0]) { await page.evaluate(d => window.__game.move(d), d); await settled(page); }
      await page.waitForFunction(() => window.__game.status === 'fail');
      const f = await page.evaluate(() => {
        const g = window.__game, b = g.board(), s = g.state(), w = g.boardRect().w;
        const hole = { x: b.x + (s.p % w) * b.s, y: b.y + Math.floor(s.p / w) * b.s, s: b.s };
        const c = document.querySelector('#fail .card').getBoundingClientRect(), ov = getComputedStyle(document.getElementById('fail'));
        const overlap = !(hole.x + hole.s <= c.left || hole.x >= c.right || hole.y + hole.s <= c.top || hole.y >= c.bottom);
        return { overlap, blur: ov.backdropFilter, bg: ov.backgroundColor };
      });
      ok(!f.overlap && (f.blur === 'none' || f.blur === '') && /rgba\(0, 0, 0, 0\)|transparent/.test(f.bg), 'fall card leaves the hole visible, no blur (' + JSON.stringify(f) + ')');
      await page.click('#fUndo');
      s = await st(page);
      ok(s.status === 'play' && s.moves === 2, 'undo from the fall card returns to 2 moves');
      await ctx.close();
    }

    // ---- 5. idle: the draw loop stops; input restarts it ----
    {
      const { ctx, page } = await open();
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ice-slide:intro', JSON.stringify({ basic: 1 })); window.__game.startLevel(1); });
      await page.waitForFunction(() => !window.__game.state().looping, null, { timeout: 30000 });
      const f0 = (await st(page)).frames;
      await page.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 600)));
      const f1 = (await st(page)).frames;
      ok(f1 === f0, `idle board: no frames drawn while still (${f0} → ${f1})`);
      await page.evaluate(() => window.__game.move(1));
      await page.waitForFunction(f => window.__game.state().frames > f + 3, f1);
      ok(true, 'a move restarts the loop');
      // only one draw chain: game frames ≈ browser frames while busy (a second chain would double them)
      const ratio = await page.evaluate(() => new Promise(res => {
        const g = window.__game; let n = 0, f0 = g.state().frames;
        const tick = () => { n++; if (n < 40) { if (n % 8 === 0) g.move(n % 16 ? 3 : 1); requestAnimationFrame(tick); } else res((g.state().frames - f0) / n); };
        requestAnimationFrame(tick);
      }));
      ok(ratio <= 1.15, 'single animation loop while moving (game/browser frames ' + ratio.toFixed(2) + ')');
      await ctx.close();
    }

    // ---- 6. landscape 844×390: side columns, bigger board; title penguin clear of the text ----
    {
      const { ctx, page } = await open({ viewport: { width: 844, height: 390 } });
      await page.evaluate(() => localStorage.clear());
      // title: no dark penguin pixels under the subtitle or the buttons
      await page.waitForFunction(() => window.__game.state().frames > 5);
      const dark = await page.evaluate(() => {
        const cv = document.getElementById('cv'), g = cv.getContext('2d'), dpr = cv.width / innerWidth;
        let n = 0;
        for (const sel of ['.ttl .sub', '#tPlay', '#tSelect', '#tHelp']) {
          const r = document.querySelector(sel).getBoundingClientRect();
          const d = g.getImageData(Math.round(r.left * dpr), Math.round(r.top * dpr), Math.round(r.width * dpr), Math.round(r.height * dpr)).data;
          for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] < 330) n++;
        }
        return n;
      });
      ok(dark === 0, 'landscape title: penguin/fish not drawn behind subtitle or buttons (' + dark + ' dark px)');
      await page.evaluate(() => { localStorage.setItem('ice-slide:intro', JSON.stringify({ basic: 1, snow: 1, crack: 1, arrow: 1, block: 1, warp: 1 })); window.__game.startLevel(100); });
      const lay = await page.evaluate(() => {
        const b = window.__game.board(), R = window.__game.boardRect(), box = { l: b.x - 8, t: b.y - 8, r: b.x + b.s * R.w + 8, b: b.y + b.s * R.h + 8 };
        const hit = [...document.querySelectorAll('#hud button, #hud .hmid, #bottom > *')].filter(e => { const r = e.getBoundingClientRect(); return !(r.right <= box.l || r.left >= box.r || r.bottom <= box.t || r.top >= box.b); }).map(e => e.id || e.className);
        return { s: b.s, hit, fits: box.t >= 0 && box.b <= innerHeight };
      });
      ok(lay.s >= 26 && lay.hit.length === 0 && lay.fits, `landscape L100: cell ${lay.s}px, overlaps ${JSON.stringify(lay.hit)}`);
      const small = await page.evaluate(() => [...document.querySelectorAll('#hud button, #bottom button')].filter(e => { const r = e.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length);
      ok(small === 0, 'landscape: all HUD/bottom buttons ≥ 44×44');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => window.__game.board().s >= 30);
      const hb = await page.evaluate(() => [...document.querySelectorAll('#hud button, #bottom button')].map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
      ok(hb.every(x => x >= 44), 'portrait after rotation: buttons ≥ 44 (' + hb.join(',') + ')');
      await ctx.close();
    }

    // ---- 7. dark mode ----
    {
      const { ctx, page } = await open({ colorScheme: 'dark' });
      await page.evaluate(() => { localStorage.clear(); localStorage.setItem('ice-slide:intro', JSON.stringify({ basic: 1 })); window.__game.startLevel(1); });
      await page.waitForFunction(() => window.__game.state().frames > 3);
      const px = await page.evaluate(() => { const cv = document.getElementById('cv'), d = cv.getContext('2d').getImageData(4, 4, 1, 1).data; return d[0] + d[1] + d[2]; });
      const card = await page.evaluate(() => getComputedStyle(document.querySelector('.hmid')).backgroundColor);
      ok(px < 200 && !/255, 255, 255/.test(card), `dark mode: night background (sum ${px}), HUD card ${card}`);
      await ctx.close();
    }
  } catch (e) { fails++; console.log('FAIL exception: ' + (e && e.stack || e)); }
  await browser.close();
  ok(errors.length === 0, 'no page/console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log((fails ? 'FAIL' : 'PASS') + ` ice-slide: ${passes} passed, ${fails} failed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(fails ? 1 : 0);
})();
