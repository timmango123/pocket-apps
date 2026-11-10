// Regression tests for 螢火迷宮 (firefly-maze). Usage: node tests.js [--core]
// 1) Core (Node, the game's own CORE-START..CORE-END): all 100 mazes valid, difficulty curve (moth speed / chase /
//    panic / lives spread from L1 to L100, displayed difficulty strictly rising), daily maze follows progress and
//    rotates mechanics.
// 2) Browser (Chromium, real CDP touch): level-select tiles never overlap (5 sizes), HUD lives never run under the
//    mute button (360/375 wide, 5-digit and 6-digit scores), first-run swipe hint, mid-level resume after reload,
//    confirm before a fresh level throws an unfinished one away, death-cause message, daily maze level, darkness mask
//    (warm in light theme, no per-frame gradients), old saved data still loads, no page/console errors.
// Waits are on conditions (waitForFunction), never on frame timing.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {params, buildLevel, checkMaze, newState, step, dailyN, dailySpec, MECHS, NLEV};')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

// ---------- core ----------
{
  let prev = 0, mazeBad = [];
  for (let n = 1; n <= 100; n++) {
    const L = C.buildLevel(n), P = L.P;
    if (C.checkMaze(L, 0) || C.checkMaze(L, 1)) mazeBad.push(n);
    if (!(P.D > prev)) mazeBad.push('D' + n);
    prev = P.D;
  }
  ok(mazeBad.length === 0, 'all 100 mazes connected without dead ends and displayed difficulty strictly rising: ' + mazeBad.join(','));
  const P1 = C.params(1), P25 = C.params(25), P50 = C.params(50), P100 = C.params(100);
  // reviewer: "L1 and L100 play the same" — moth speed 0.75→1.05 was capped from L35 on; now the whole range is used
  ok(P1.r < 0.5 && P100.r >= 1.05 && P50.r < 0.8, 'moth speed spreads over all 100 levels (L1 ' + P1.r.toFixed(2) + ', L50 ' + P50.r.toFixed(2) + ', L100 ' + P100.r.toFixed(2) + ')');
  let mono = true; for (let n = 2; n <= 100; n++) { const a = C.params(n - 1), b = C.params(n); if (b.r < a.r || b.tired < a.tired || b.loop > a.loop || b.iq < a.iq || (b.w0 || 0) > (a.w0 || 0) || b.T > a.T || b.sc > a.sc || b.ch < a.ch || b.lives > a.lives || b.k < a.k) mono = false; }
  ok(mono, 'every knob gets monotonically harder level to level (no easier level after a harder one)');
  ok(P1.k === 1 && C.params(5).k === 2 && P1.T >= 9.9 && P1.ch <= 6 && P1.sc >= 13 && P1.iq < 0.5 && P1.w0 >= 3, 'L1 is gentle: 1 moth (2 from L4), 10 s panic, short chase / long scatter, moths often wander, first moth waits 3 s');
  ok(P1.tired <= 0.6 && C.params(31).tired === 1, 'early levels: moths slow down in the last 15% of dots (L1 x' + P1.tired + ', none from L31)');
  ok(C.params(25).loop > C.params(75).loop && C.params(9).loop >= 0.4, 'early generated mazes have more loops (escape routes) than late ones');
  ok(P1.lives === 5 && P25.lives === 5 && C.params(40).lives === 4 && P100.lives === 3, 'lives 5 (L1-30), 4 (L31-50), 3 (L51+)');
  const S1 = C.newState(C.buildLevel(1)); ok(S1.lives === 5, 'level 1 starts with 5 lives');
  // chase timer uses the level's chase length
  {
    const L = C.buildLevel(1), S = C.newState(L); let flips = [];
    for (let i = 0; i < 60 * 40 && S.status !== 'lost'; i++) { const ev = C.step(L, S, -1); for (const e of ev) if (e[0] === 'phase') flips.push(S.tick); }
    ok(flips.length >= 2 && Math.abs((flips[1] - flips[0]) - Math.round(P1.ch * 60)) <= 1, 'chase phase on L1 lasts ' + P1.ch + ' s (' + (flips[1] - flips[0]) + ' ticks)');
  }
  // daily maze: from progress, varies by day, never stuck on level 30 parameters
  ok(C.dailyN(4994, 0) === 25 && C.dailyN(4999, 0) === 30 && C.dailyN(5004, 0) === 35, 'daily level for a new player is 25-35 (seed-dependent)');
  ok(C.dailyN(4999, 79) === 80 && C.dailyN(5004, 99) === 100 && C.dailyN(4994, 99) === 95, 'daily level follows progress (progress 79 -> L80 ±5, capped at 100)');
  const masks = new Set(); let maskOk = true;
  for (let sd = 5000; sd < 5030; sd++) {
    const sp = C.dailySpec(sd, 90); masks.add(sp.on.join(','));
    if (!sp.on.length) maskOk = false;
    if (sd < 5004) { const L = C.buildLevel(90, sd, sp.mask); if (C.checkMaze(L, 0) || C.checkMaze(L, 1)) maskOk = false;
      if (sp.mask.flower === false && L.flw.some(v => v >= 0)) maskOk = false; if (sp.mask.gate === false && L.gate.some(v => v >= 0)) maskOk = false;
      if (L.P.mech.dark !== (sp.mask.dark !== false)) maskOk = false; if (L.pw.length !== (L.P.mech.twoPow ? 2 : 4)) maskOk = false; }
  }
  ok(maskOk && masks.size >= 8, 'daily mechanics rotate (' + masks.size + ' different sets over 30 days), switched-off ones are really absent');
}
if (process.argv.includes('--core')) { console.log('firefly-maze tests:', pass, 'passed,', fail, 'failed'); process.exit(fail ? 1 : 0); }

// ---------- browser ----------
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = 'http://fm.test/';
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, opt) {
    opt = opt || {};
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: opt.scheme || 'dark' });
    await ctx.route('**/*', r => r.request().url() === URL ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
    if (opt.init) await ctx.addInitScript(opt.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'x' + h + ' ' + String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' ' + m.text()); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__game && window.__game.info().screen === 'title');
    return { ctx, page, cdp: await ctx.newCDPSession(page) };
  }
  async function tap(T, sel) {
    const b = await T.page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function swipe(T, x, y, dx, dy) {
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 4; i++) await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 4, y: y + dy * i / 4 }] });
    await T.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const visible = (T, sel) => T.page.isVisible(sel);
  const waitVis = (T, sel) => T.page.waitForSelector(sel, { state: 'visible', timeout: 15000 });
  async function openLevel(T, n) {
    await tap(T, '#tSelect'); await waitVis(T, '#grid .lt');
    if ((await T.page.getAttribute('#unlockSw', 'aria-checked')) !== 'true' && n > 1) { await tap(T, '#unlockSw'); await T.page.waitForFunction(() => document.getElementById('unlockSw').getAttribute('aria-checked') === 'true'); }
    await T.page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded();
    await tap(T, '.lt[data-n="' + n + '"]');
    await T.page.waitForFunction(() => __game.info().screen === 'play' || !document.getElementById('confirm').classList.contains('hidden'));
    if (await visible(T, '#iOk')) await tap(T, '#iOk');
  }
  try {
    // ---- level select: tiles in neighbouring rows never overlap; the bottom edge of a tile opens that tile ----
    for (const [w, h] of [[360, 640], [375, 500], [390, 844], [430, 932], [844, 390]]) {
      const T = await open(w, h);
      await tap(T, '#tSelect'); await waitVis(T, '#grid .lt');
      const r = await T.page.evaluate(() => {
        const ts = [...document.querySelectorAll('.lt')], cols = Math.round(document.getElementById('grid').clientWidth / (ts[1].getBoundingClientRect().left - ts[0].getBoundingClientRect().left));
        const a = ts[0].getBoundingClientRect(), b = ts[cols].getBoundingClientRect(), t2 = ts[1].getBoundingClientRect();
        const hit = document.elementFromPoint(t2.left + t2.width / 2, t2.bottom - 2), dn = ts[0].querySelector('.dn').getBoundingClientRect();
        return { gap: b.top - a.bottom, hit: hit && hit.closest('.lt') && hit.closest('.lt').dataset.n, inside: dn.bottom <= a.bottom + 0.5, w: a.width, h: a.height };
      });
      ok(r.gap >= 8, w + 'x' + h + ': level tiles in neighbouring rows keep a gap (got ' + r.gap.toFixed(1) + ' px, tile ' + r.w.toFixed(0) + 'x' + r.h.toFixed(0) + ')');
      ok(r.hit === '2', w + 'x' + h + ': tapping the bottom edge of tile 2 hits tile 2 (got ' + r.hit + ')');
      ok(r.inside, w + 'x' + h + ': the "難度" label stays inside its tile');
      await T.ctx.close();
    }

    // ---- HUD: lives never slide under the mute button ----
    for (const [w, h] of [[360, 640], [375, 500], [390, 844]]) {
      const T = await open(w, h);
      await openLevel(T, 100);
      for (const sc of ['7,240', '15,360', '123,456']) {
        const r = await T.page.evaluate(sc => {
          document.getElementById('hScore').textContent = sc;
          const lv = document.getElementById('hLives').getBoundingClientRect(), hm = document.querySelector('.hmid').getBoundingClientRect(), mu = document.getElementById('bMute').getBoundingClientRect(), s = document.getElementById('hScore').getBoundingClientRect();
          return { lr: lv.right, hr: hm.right, ml: mu.left, sr: s.right, n: document.querySelectorAll('#hLives i').length };
        }, sc);
        ok(r.lr <= r.hr - 4 && r.hr <= r.ml && r.sr <= r.hr, w + 'x' + h + ' score ' + sc + ': lives (' + Math.round(r.lr) + ') and score (' + Math.round(r.sr) + ') stay inside the HUD card (' + Math.round(r.hr) + ') left of mute (' + Math.round(r.ml) + ')');
      }
      await T.ctx.close();
    }
    {
      const T = await open(360, 640); await tap(T, '#tPlay'); await T.page.waitForFunction(() => __game.info().screen === 'play');
      const r = await T.page.evaluate(() => { const l = document.querySelectorAll('#hLives i'), hm = document.querySelector('.hmid').getBoundingClientRect(); return { n: l.length, right: l[l.length - 1].getBoundingClientRect().right, hr: hm.right }; });
      ok(r.n === 5 && r.right <= r.hr, '360x640 L1: 5 life markers shown inside the HUD');
      await T.ctx.close();
    }

    // ---- first-run swipe hint, mid-level resume, confirm before discarding ----
    {
      const T = await open(390, 844);
      await tap(T, '#tPlay'); await T.page.waitForFunction(() => __game.info().screen === 'play');
      ok(await visible(T, '#shint'), 'first level start shows the swipe hint');
      const hb = await T.page.locator('#shint').boundingBox(), mz = await T.page.evaluate(() => __game.info().maze);
      const pl = await T.page.evaluate(() => { const g = __game.live(), m = __game.info().maze, t = g.S.pl.t; return { x: m.ox + (t % g.L.w + 0.5) * m.ts, y: m.oy + (((t / g.L.w) | 0) + 0.5) * m.ts, r: m.ts }; });
      ok(hb && hb.y > mz.oy && !(pl.x > hb.x - pl.r && pl.x < hb.x + hb.width + pl.r && pl.y > hb.y - pl.r && pl.y < hb.y + hb.height + pl.r), 'swipe hint does not cover the firefly at its start');
      await T.page.waitForFunction(() => __game.info().status === 'play');
      await swipe(T, 195, 600, -60, 0);
      await T.page.waitForFunction(() => document.getElementById('shint').classList.contains('hidden'));
      ok(await T.page.evaluate(() => localStorage.getItem('firefly.seenSwipeHint') === 'true'), 'first real swipe hides the hint and remembers it');
      await T.page.waitForFunction(() => __game.info().tick > 200);
      const before = await T.page.evaluate(() => { const s = __game.snap(); return { tick: s.tick, left: s.left, score: s.score, t: s.pl.t }; });
      // reload with no pause first: pagehide saves the latest state, so the restored one is at least as far along
      await T.page.reload(); await T.page.waitForFunction(() => window.__game && __game.info().screen === 'title');
      const lbl = await T.page.textContent('#tPlay');
      ok(/接續第 1 關/.test(lbl) && /%/.test(lbl), 'after a reload mid-level the title offers to continue it (' + lbl + ')');
      await tap(T, '#tPlay'); await T.page.waitForFunction(() => __game.info().screen === 'play');
      const after = await T.page.evaluate(() => { const s = __game.snap(), i = __game.info(); return { tick: s.tick, left: s.left, score: s.score, paused: i.paused, pause: !document.getElementById('pause').classList.contains('hidden') }; });
      ok(after.paused && after.pause, 'resumed level opens paused');
      ok(after.left <= before.left && after.score >= before.score && after.tick >= before.tick && after.tick - before.tick <= 30 && after.left < 130, 'resumed level keeps dots/score/time (before ' + JSON.stringify(before) + ' after ' + JSON.stringify(after) + ')');
      ok(!(await visible(T, '#shint')), 'swipe hint does not come back once seen');
      // leave to the select screen, pick another level: confirm first; cancel keeps the unfinished level
      await tap(T, '#pSelect'); await waitVis(T, '#grid .lt');
      await tap(T, '#unlockSw'); await T.page.waitForFunction(() => document.getElementById('unlockSw').getAttribute('aria-checked') === 'true');
      await tap(T, '.lt[data-n="2"]'); await waitVis(T, '#confirm');
      ok(/第 1 關/.test(await T.page.textContent('#cMsg')), 'starting level 2 while level 1 is unfinished asks first');
      await tap(T, '#cNo'); await waitVis(T, '#select');
      ok(await T.page.evaluate(() => !!localStorage.getItem('firefly.resume')), 'cancel keeps the unfinished level');
      await tap(T, '.lt[data-n="1"]'); await T.page.waitForFunction(() => __game.info().screen === 'play');
      ok(await T.page.evaluate(() => __game.info().paused && __game.snap().left) === after.left, 'tapping the unfinished level itself picks it up where it was');
      await tap(T, '#pRestart'); await waitVis(T, '#confirm');
      await tap(T, '#cOk'); await T.page.waitForFunction(() => __game.info().screen === 'play' && !__game.info().paused);
      ok(await T.page.evaluate(() => __game.snap().left === __game.live().L.total), 'restart after confirm starts the level fresh');
      // final death: resume is dropped at once (a reload cannot undo it), lose card names the moth and the progress
      await T.page.waitForFunction(() => __game.info().status === 'play');
      await T.page.evaluate(() => { const g = __game.live(), S = g.S; S.lives = 1; const m = S.ms[0]; m.mode = 'norm'; m.panic = 0; S.pT = 0; m.t = S.pl.t; m.p = S.pl.p; m.d = S.pl.d; });
      await T.page.waitForFunction(() => __game.info().status === 'dying' || __game.info().status === 'lost');
      ok(await T.page.evaluate(() => localStorage.getItem('firefly.resume') === null), 'last life lost: the saved level is cleared straight away');
      await waitVis(T, '#lose');
      const lm = await T.page.textContent('#lMsg');
      ok(/赤影/.test(lm) && /收集 \d+% 光點/.test(lm), 'lose card says which moth got you and how far you got (' + lm + ')');
      await T.page.reload(); await T.page.waitForFunction(() => window.__game && __game.info().screen === 'title');
      ok(!/接續/.test(await T.page.textContent('#tPlay')), 'after a loss there is nothing to continue');
      await T.ctx.close();
    }

    // ---- daily maze follows progress; old saves still load ----
    {
      const T = await open(390, 844, { init: () => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); localStorage.setItem('firefly.progress', '79'); localStorage.setItem('firefly.stars', '{"1":3,"2":2}'); localStorage.setItem('firefly.best', '{"1":1500}'); localStorage.setItem('firefly.settings', '{"sound":false,"vib":true,"pad":false,"assist":false,"skin":1}'); localStorage.setItem('firefly.seenSwipeHint', 'true'); } } });
      ok(/繼續 第 80 關/.test(await T.page.textContent('#tPlay')), 'old save (progress 79) still loads: title offers level 80');
      await tap(T, '#tSelect'); await waitVis(T, '#grid .lt');
      ok((await T.page.locator('.lt[data-n="1"] .st .on').count()) === 3 && (await T.page.locator('.lt[data-n="2"] .st .on').count()) === 2, 'old stars still shown');
      await tap(T, '#sBack'); await waitVis(T, '#title');
      ok(/難度 \d+/.test(await T.page.textContent('#tDailyInfo')), 'daily button shows the day\'s difficulty');
      await tap(T, '#tDaily'); await T.page.waitForFunction(() => __game.info().screen === 'play');
      const i = await T.page.evaluate(() => __game.info());
      ok(i.daily && i.n >= 75 && i.n <= 85, 'daily maze for a player at level 80 uses level ' + i.n + ' parameters (was always 30)');
      await T.ctx.close();
    }

    // ---- darkness mask: warm in the light theme, no gradients built per frame ----
    for (const scheme of ['light', 'dark']) {
      const T = await open(390, 844, { scheme, init: () => {
        localStorage.setItem('firefly.seenSwipeHint', 'true'); localStorage.setItem('firefly.seenMech', '{"slow":1,"gate":1,"big":1,"dark":1,"flower":1,"hedge":1,"predict":1,"twoPow":1}');
        const o = CanvasRenderingContext2D.prototype.createRadialGradient; window.__rg = 0; CanvasRenderingContext2D.prototype.createRadialGradient = function () { window.__rg++; return o.apply(this, arguments); };
      } });
      await openLevel(T, 45);
      await T.page.waitForFunction(() => __game.info().status === 'play');
      const f0 = await T.page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(window.__rg))));
      const f1 = await T.page.evaluate(() => new Promise(r => { let k = 0; const go = () => (++k < 30 ? requestAnimationFrame(go) : r(window.__rg)); requestAnimationFrame(go); }));
      ok(f1 - f0 <= 2, scheme + ' L45 (dark + flowers): ' + (f1 - f0) + ' radial gradients over 30 frames (was 5 per frame)');
      if (scheme === 'light') {
        const px = await T.page.evaluate(() => { const g = __game.info().maze, c = document.getElementById('cv'), x = c.getContext('2d'); const d = x.getImageData(Math.round((g.ox + g.ts * 1.5) * 2), Math.round((g.oy + g.ts * 1.5) * 2), 1, 1).data; return [d[0], d[1], d[2]]; });
        ok(px[0] >= px[2] + 10, 'light theme darkness is warm brown, not purple (pixel ' + px.join(',') + ')');
      }
      await T.ctx.close();
    }
    ok(errors.length === 0, 'no page or console errors: ' + errors.join(' | '));
  } finally { await browser.close(); }
  console.log('firefly-maze tests:', pass, 'passed,', fail, 'failed');
  if (fail) process.exit(1);
})();
