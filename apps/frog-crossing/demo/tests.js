// Regression tests for 小蛙過河 (frog-crossing). Usage: node tests.js
// One check (or more) per finding of the 2026-11-02 release review. Core rules run in Node on the game's own
// CORE-START..CORE-END; the rest runs in Chromium with real CDP touch events. Timing-sensitive checks use the
// game's deterministic replay (inputs applied at exact world times) or wait on conditions, never on frame deltas.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const URL = 'file://' + APP;
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {params, genLevel, needOf};')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

// ---------- difficulty: frogs needed rise one at a time, D includes it and rises every level ----------
{
  const need = n => C.params(n).need;
  ok([1, 10, 11, 20, 21, 30, 31, 40, 41, 100].map(need).join() === '1,1,2,2,3,3,4,4,5,5', 'need ramps 1→5 one frog per ten levels (was a 1→3→5 jump), got ' + [1, 10, 11, 20, 21, 30, 31, 40, 41, 100].map(need).join());
  let mono = true, maxStep = 0;
  for (let n = 2; n <= 100; n++) { const d = C.params(n).D - C.params(n - 1).D; if (d <= 0) mono = false; maxStep = Math.max(maxStep, d); }
  ok(mono, 'difficulty D strictly increases 1..100 with the breather levels');
  ok(C.params(11).v < C.params(10).v && C.params(14).v > C.params(10).v, 'the first levels with an extra frog are slower (breather), then speed resumes');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    if (init) await ctx.addInitScript(init.fn, init.arg);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'x' + h + ' ' + e));
    page.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' ' + m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__game && window.G && G.mode === 'title');
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    return { ctx, page, T };
  }
  const settingsInit = s => ({ fn: v => localStorage.setItem('frogx.settings', v), arg: JSON.stringify(s) });
  // start level n and dismiss its intro card with a real tap
  async function play(page, T, n) {
    await page.evaluate(n => window.__game.start(n), n);
    if (await page.isVisible('#iOk')) { const b = await page.locator('#iOk').boundingBox(); await T('touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]); await T('touchEnd', []); }
    await page.waitForFunction(() => G.mode === 'play' && !G.paused && G.status === 'play');
  }
  const count = page => page.evaluate(() => window.__game.inputs().count);

  try {
    // ---------- two thumbs: a second finger going down must not cancel the first finger's tap ----------
    {
      const { ctx, page, T } = await open(390, 844);
      await play(page, T, 1);
      const c0 = await count(page);
      // 16 taps alternating thumbs, each pressed before the other is lifted (the reviewer's overlap pattern)
      const A = { x: 90, y: 640, id: 1 }, B = { x: 300, y: 640, id: 2 };
      await T('touchStart', [A]);
      for (let i = 1; i < 16; i++) { const down = i % 2 ? B : A, up = i % 2 ? A : B; await T('touchStart', [up, down]); await T('touchEnd', [down]); }
      await T('touchEnd', []);
      await page.waitForFunction(c => window.__game.inputs().count >= c + 16, c0, { timeout: 5000 }).catch(() => {});
      ok((await count(page)) - c0 === 16, 'overlapping two-thumb taps: 16 sent → 16 received (was 2), got ' + ((await count(page)) - c0));
      await ctx.close();
    }
    // ---------- a tap held long (no movement) still hops; a swipe still turns ----------
    {
      const { ctx, page, T } = await open(390, 844);
      await play(page, T, 1);
      const x0 = await page.evaluate(() => G.F.x); // start row is grass: a sideways hop is always safe
      await T('touchStart', [{ x: 150, y: 600, id: 1 }]); await T('touchMove', [{ x: 190, y: 602, id: 1 }]); await T('touchEnd', []);
      await page.waitForFunction(x => G.F.x > x + 0.5 && G.F.jt < 0, x0, { timeout: 3000 }).catch(() => {});
      ok((await page.evaluate(() => G.F.x)) === x0 + 1, 'a swipe right hops right');
      const n0 = await page.evaluate(() => window.__game.fullLog().length);
      await T('touchStart', [{ x: 200, y: 600, id: 1 }]);
      await page.waitForFunction(() => (window.__hold = (window.__hold || performance.now())) && performance.now() - window.__hold > 450);
      await T('touchEnd', []);
      await page.waitForFunction(n => window.__game.fullLog().length > n, n0, { timeout: 3000 }).catch(() => {});
      const lg = await page.evaluate(() => window.__game.fullLog());
      ok(lg.length === n0 + 1 && lg[lg.length - 1][1] === 0, 'a tap held 450 ms counts as one hop up (was ignored above ~200 ms)');
      await ctx.close();
    }
    // ---------- input queue: taps during a hop are queued, not overwritten, and stale ones dropped ----------
    {
      const { ctx, page } = await open(390, 844);
      const t0 = await page.evaluate(() => { window.__game.replay(1, []); return G.t; });
      // deterministic replay: 4 alternating inputs inside one 120 ms hop → 4 hops; 6 inputs → 1 + 3 queued
      const run = log => page.evaluate(async log => {
        window.__game.replay(1, log);
        const end = log[log.length - 1][0] + 1.2;
        await new Promise(r => { const f = () => (G.t >= end || G.status !== 'play') ? r() : requestAnimationFrame(f); f(); });
        return window.__game.trace().filter(e => typeof e[1] === 'number').length;
      }, log);
      const s = t0 + 0.5;
      const three = await run([[s, 1], [s + 0.02, 3], [s + 0.04, 1]]);
      ok(three === 3, 'three inputs inside one hop give three hops (old 1-slot buffer: 2), got ' + three);
      const fx = await page.evaluate(() => G.F.x);
      ok(fx === 6, 'queued hops run in order (R L R from x=5 ends at 6), x=' + fx);
      // a burst delivered at once (stalled frame): 4 taps in the same instant still give 4 hops
      const bunch = await run([[s, 1], [s, 3], [s, 1], [s, 3]]);
      ok(bunch === 4, 'four taps arriving in one stalled frame give four hops, got ' + bunch);
      await ctx.close();
    }
    // ---------- a hop pressed just before the next frog appears (after a nest) is not swallowed ----------
    {
      const { ctx, page, T } = await open(390, 844);
      await play(page, T, 1);
      const r = await page.evaluate(async () => {
        G.status = 'respawn'; G.respawnAt = G.t + 0.6; applyInput(0); const early = G.pre; // 0.6 s before: ignored
        G.respawnAt = G.t + 0.2; applyInput(0); const kept = G.pre;
        await new Promise(r => { const f = () => G.status === 'play' ? r() : requestAnimationFrame(f); f(); });
        return { early, kept, jt: G.F.jt, toRow: G.F.toRow };
      });
      ok(r.early === -1 && r.kept === 0 && r.toRow === 13, 'a tap in the last 0.3 s of the after-nest pause hops as the new frog appears ' + JSON.stringify(r));
      await ctx.close();
    }
    // ---------- mashing guard: 10 real d-pad taps at ~30/s, then stop → hops stop within ~0.45 s ----------
    {
      const { ctx, page, T } = await open(390, 844, settingsInit({ dpad: true }));
      await play(page, T, 1);
      const bx = s => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
      const L = await bx('#dL'), R = await bx('#dR'), c0 = await count(page), t0 = Date.now();
      for (let i = 0; i < 10; i++) { const q = i % 2 ? R : L; await T('touchStart', [{ x: q[0], y: q[1], id: 1 }]); await T('touchEnd', []); const w = 33 * (i + 1) - (Date.now() - t0); if (w > 0) await sleep(w); }
      await page.waitForFunction(c => window.__game.inputs().count >= c + 10, c0, { timeout: 5000 }).catch(() => {});
      await page.waitForFunction(() => G.F.jt < 0 && !G.buf.length, null, { timeout: 5000 }).catch(() => {});
      const r = await page.evaluate(() => { const lastIn = window.__game.inputs().log.slice(-1)[0][0], l = window.__game.trace().filter(e => typeof e[1] === 'number').map(e => e[0]); return { after: l[l.length - 1] - lastIn, hops: l.length, dropped: G.dropped || 0 }; });
      ok(r.after <= 0.45 && r.hops >= 3, 'mashing at 30/s then stopping: last hop lands ' + r.after.toFixed(3) + ' s after the last tap (was 0.75 s; ' + r.hops + ' hops, ' + r.dropped + ' dropped)');
      ok((await page.evaluate(() => window.__game.fullLog().length)) === r.hops, 'dropped taps are left out of the replay log (log length = hops)');
      await ctx.close();
    }
    // ---------- RUBRIC tap test: d-pad left/right alternating at 8/s, 40 real touches → 40 hops ----------
    {
      const { ctx, page, T } = await open(390, 844, settingsInit({ dpad: true }));
      await play(page, T, 1);
      const bx = s => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, s);
      const L = await bx('#dL'), R = await bx('#dR');
      const t0 = Date.now();
      for (let i = 0; i < 40; i++) {
        const q = i % 2 ? R : L;
        await T('touchStart', [{ x: q[0], y: q[1], id: 1 }]); await T('touchEnd', []);
        const wait = 125 * (i + 1) - (Date.now() - t0); if (wait > 0) await sleep(wait);
      }
      await page.waitForFunction(() => window.__game.trace().filter(e => typeof e[1] === 'number').length >= 40 || G.status !== 'play', null, { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => G.F.jt < 0 && !G.buf.length, null, { timeout: 3000 }).catch(() => {});
      const hops = await page.evaluate(() => window.__game.trace().filter(e => typeof e[1] === 'number').length);
      const dbg = hops === 40 ? '' : JSON.stringify(await page.evaluate(() => ({ dropped: G.dropped || 0, inputs: window.__game.inputs().count, st: G.status, buf: G.buf.length })));
      ok(hops === 40, 'd-pad L/R at 8 taps/s: 40 touches → 40 hops (was 37–39), got ' + hops + ' ' + dbg);
      await ctx.close();
    }
    // ---------- damaged saved stats do not break the records panel; old keys still load ----------
    {
      const init = { fn: () => { localStorage.setItem('frogx.stats', '{"perfect":null,"jumps":"x","flies":12}'); localStorage.setItem('frogx.settings', '{"skin":7,"sound":"no"}'); localStorage.setItem('frogx.progress', '23'); localStorage.setItem('frogx.stars', '{"1":3}'); } };
      const { ctx, page } = await open(390, 844, init);
      const before = errors.length;
      await page.click('#tRec');
      await page.waitForSelector('#records:not(.hidden)');
      const txt = await page.textContent('#recBody');
      ok(errors.length === before && /無傷高手/.test(txt) && /12/.test(txt), 'records open with stats.perfect = null (was TypeError) and keep valid fields');
      ok(await page.evaluate(() => settings.skin === 0 && settings.sound === true && progress === 23 && starsMap[1] === 3), 'bad settings fields fall back to defaults; progress and stars load');
      await ctx.close();
    }
    // ---------- intro card only the first time a level is played in a visit; help shows the clear bonus ----------
    {
      const { ctx, page, T } = await open(390, 844);
      await page.evaluate(() => window.__game.start(6));
      ok(await page.isVisible('#intro'), 'intro card shows the first time (level 6, 潛水龜)');
      await page.click('#iOk');
      await page.waitForFunction(() => !G.paused);
      await page.click('#bPause'); await page.click('#pRestart');
      await page.waitForFunction(() => G.mode === 'play' && document.getElementById('pause').classList.contains('hidden'));
      ok(!(await page.isVisible('#intro')) && (await page.evaluate(() => !G.paused)), 'retrying the same level (暫停 → 重來) does not show the intro again');
      await page.evaluate(() => { goTitle(); document.getElementById('tHelp').click(); });
      ok(/1000/.test(await page.textContent('#helpBody')), 'help explains the clear bonus 1000 + lives × 300');
      // level select is opaque: the board is not redrawn underneath
      await page.evaluate(() => { document.getElementById('hOk').click(); document.getElementById('tSelect').click(); });
      await page.waitForFunction(() => G.drawn === 0);
      const d0 = await page.evaluate(() => [G.t, G.drawn]);
      await page.waitForFunction(t => G.t > t + 0.3, d0[0]);
      ok((await page.evaluate(() => G.drawn)) === 0, 'no canvas redraw while the level list is open');
      await page.click('#sBack');
      await page.waitForFunction(() => G.drawn > 2);
      ok(true, 'drawing resumes after leaving the level list');
      await ctx.close();
    }
    // ---------- 隨機變化 setting: a new verified layout on each start, replay keeps its layout ----------
    {
      const { ctx, page } = await open(390, 844, settingsInit({ vary: true }));
      const salts = await page.evaluate(() => { const s = []; for (let i = 0; i < 3; i++) { window.__game.start(8); s.push(window.__game.level().salt); } return s; });
      ok(salts.every(s => s > 0) && new Set(salts).size === 3, '隨機變化 gives a different layout every start (salts ' + salts.join(',') + ')');
      await page.evaluate(() => { settings.vary = false; window.__game.start(8); });
      ok((await page.evaluate(() => window.__game.level().salt)) === 0, 'with the setting off the level is the fixed, verified one');
      await ctx.close();
    }
    // ---------- layout: landscape board uses the height, short phones with the d-pad keep a bigger board ----------
    {
      const { ctx, page, T } = await open(844, 390, settingsInit({ dpad: true }));
      await play(page, T, 2);
      const r = await page.evaluate(() => { const h = document.getElementById('hud').getBoundingClientRect(), p = document.getElementById('dpad').getBoundingClientRect(); return { S, OX, OY, hudR: h.right, padL: p.left, padT: p.top }; });
      ok(r.S >= 24, '844x390: cell ≥ 24 px (was 20.8), got ' + r.S.toFixed(1));
      ok(r.hudR <= r.OX && r.OX + 11 * r.S <= r.padL && r.OY + 15 * r.S <= 390, '844x390: HUD left of the board, d-pad right of it, board fully on screen');
      // lanes outside the board fade toward the verge colour (no hard cut where cars vanish)
      const px = await page.evaluate(() => { const L = G.L; let r = 0; while (L.rows[r].t !== 'road') r++; const x = Math.round((OX - S * 2.5) * DPR), y = Math.round((rowY(r) + S / 2) * DPR); const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; const s = PAL.sky; return [d[0], d[1], d[2], parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)]; });
      ok(Math.abs(px[0] - px[3]) + Math.abs(px[1] - px[4]) + Math.abs(px[2] - px[5]) < 60, 'road lane outside the board fades to the verge colour ' + px.join(','));
      await ctx.close();
    }
    {
      const { ctx, page, T } = await open(375, 500, settingsInit({ dpad: true }));
      await play(page, T, 2);
      const r = await page.evaluate(() => { const p = document.getElementById('dpad').getBoundingClientRect(); return { S, OY, padT: p.top, bw: document.getElementById('dU').getBoundingClientRect().width }; });
      ok(r.S >= 19.5 && r.bw >= 44, '375x500 with d-pad: cell ≥ 19.5 px (was 18) with ≥ 44 px keys, got ' + r.S.toFixed(1) + ' / ' + r.bw);
      ok(r.OY + 15 * r.S <= r.padT, '375x500: d-pad below the board');
      await ctx.close();
    }
    {
      const { ctx, page, T } = await open(568, 320);
      await play(page, T, 3);
      await page.evaluate(() => { G.stars = 3; G.status = 'won'; showWin(); });
      const b1 = await page.evaluate(() => Math.max(...['wNext', 'wRetry', 'wSelect', 'wReplay'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.height ? r.bottom : 0; })));
      ok(b1 <= 320, '568x320: result buttons fit without scrolling (bottom ' + Math.round(b1) + ')');
      await page.evaluate(() => { hideAll(); showSettings('title'); });
      const b2 = await page.evaluate(() => document.getElementById('setOk').getBoundingClientRect().bottom);
      ok(b2 <= 320, '568x320: settings 完成 visible without scrolling (bottom ' + Math.round(b2) + ')');
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack || e); }
  ok(errors.length === 0, 'no page or console errors: ' + errors.join(' | '));
  await browser.close();
  console.log((fail ? 'FAIL ' : 'PASS ') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
