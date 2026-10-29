// Tests for 籃接豐收 (catch-basket): the core at 30/60/120/144 Hz, then the page in Chromium with real CDP touch for the
// 9.5 release re-review fixes (finger-relative drag, lost-finger pickup, second-finger double tap, single-count dump
// button, rotation pause, safe-area fit, pagehide banking without double counting, storage validation, result-screen
// tap guard, mid-run record banner).
// Usage: node tests.js   (about 15 s)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn { makeSim, itemX, MOUTH, GROUND, SPAWN_Y, BW, maxSpeed };')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

// ---------------- core: frame-rate independence ----------------
{
  // same seed, same bot (decides every 0.2 s of game time), different display rates: the run must be the same run
  const run = (fps, fixed) => {
    const S = C.makeSim({ W: 360, seed: 42, fixed }), n = Math.round(fps * 90), every = Math.round(fps * 0.2);
    for (let i = 0; i < n && !S.dead; i++) {
      if (i % every === 0) {
        let b = null; for (const it of S.items) if (it.alive && it.good && !it.passed && it.ta - S.t > .1 && (!b || it.ta < b.ta)) b = it;
        if (b) S.setTarget(C.itemX(b, b.ta)); if (S.basket.length >= 12) S.dump(false);
      }
      S.advance(1 / fps);
    }
    return JSON.stringify([S.t.toFixed(3), S.score, S.lives, S.caught, S.dumps]);
  };
  for (const fixed of [false, true]) {
    const r = [30, 60, 120].map(f => run(f, fixed));
    ok(r[0] === r[1] && r[1] === r[2], (fixed ? 'daily' : 'endless') + ' run is identical at 30/60/120 Hz: ' + r.join(' | '));
  }
  // basket response: time to cover 200 units is the same at every rate
  const reach = fps => { const S = C.makeSim({ W: 360, seed: 1 }); S.nextSpawn = 1e9; S.setTarget(S.x + 140); const goal = S.x + 130; let t = 0; while (S.x < goal && t < 3) { S.advance(1 / fps); t += 1 / fps; } return t; };
  const rt = [30, 60, 120, 144].map(reach);
  ok(rt.every(t => Math.abs(t - rt[2]) <= 1 / 30 + 1e-9), 'basket reaches a target in the same time at 30/60/120/144 Hz (' + rt.map(t => t.toFixed(3)).join(' / ') + ' s)');
  // items spawn at their scheduled instant, not the frame that noticed it
  const t0s = fps => { const S = C.makeSim({ W: 360, seed: 9 }); for (let i = 0; i < fps * 10; i++) S.advance(1 / fps); return S.items.map(i => i.t0.toFixed(4)).join(); };
  ok(t0s(30) === t0s(120), 'spawn times do not depend on the frame rate');
}

// ---------------- the page, with real touch ----------------
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const errors = [];
  async function open(w = 390, h = 844, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    // pointer moves are delivered with the next frame, so wait one out after every touch event
    const touch = async (type, pts) => { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] || i + 1 })) }); await frames(); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async sel => { const c = await center(sel); await touch('touchStart', [c]); await touch('touchEnd', []); };
    const ev = (f, a) => p.evaluate(f, a);
    const play = async (mode = 'endless') => { await ev(m => { const g = window.__game; g.start(m); g.hold(true); g.skipCountdown(); g.sim.nextSpawn = 1e9; }, mode); await frames(); };
    const snap = () => ev(() => window.__game.snap());
    const ls = k => ev(k => JSON.parse(localStorage.getItem('basket.' + k)), k);
    return { ctx, p, touch, tap, frames, ev, play, snap, ls };
  }
  // make the run end: one rotten apple straight into the basket with one life left
  const killFn = () => { const g = window.__game, S = g.sim; S.lives = 1;
    S.items.push({ k: 'rotten', good: 0, r: 13, x0: S.x, y0: 540, vx: 0, vy: 300, t0: S.t, W: S.W, ta: S.t + 0.05, alive: true, passed: false, rot: 0, spin: 0, ph: 0 });
    g.advance(0.1); };

  // 1. drag follows the finger (relative, anywhere on screen); a lost finger is picked up again
  {
    const t = await open();
    await t.play();
    let s = await t.snap(); const tx0 = s.tx;
    await t.touch('touchStart', [[120, 400]]); await t.touch('touchMove', [[150, 400]]); await t.touch('touchMove', [[180, 405]]);
    s = await t.snap();
    ok(Math.abs(s.tx - (tx0 + 60 / s.sc * s.sens)) < 0.5, 'a 60 px drag moves the target 60 px worth (' + (s.tx - tx0).toFixed(1) + ' units at scale ' + s.sc.toFixed(3) + ')');
    await t.ev(() => dispatchEvent(new Event('blur')));
    await t.touch('touchMove', [[200, 405]]); await t.touch('touchMove', [[230, 405]]);
    const s2 = await t.snap();
    ok(Math.abs(s2.tx - (s.tx + 30 / s.sc)) < 0.5, 'after a window blur the same finger keeps steering (first move re-anchors, then +30 px → ' + (s2.tx - s.tx).toFixed(1) + ')');
    await t.touch('touchEnd', []);
    // pause mid-drag, resume, and the finger that never lifted still works
    await t.touch('touchStart', [[200, 400]]); await t.ev(() => { window.__game.pause(); window.__game.resume(); window.__game.skipCountdown(); });
    await t.touch('touchMove', [[210, 400]]); await t.touch('touchMove', [[170, 400]]);
    const s3 = await t.snap();
    ok(Math.abs(s3.tx - (s2.tx - 40 / s.sc)) < 0.5, 'a finger held through pause/resume steers again');
    await t.touch('touchEnd', []);
    // the basket actually moves at the play rate and stays in the field
    await t.touch('touchStart', [[200, 400]]); await t.touch('touchMove', [[390, 400]]); await t.touch('touchEnd', []);
    await t.ev(() => { for (let i = 0; i < 60; i++) window.__game.advance(1 / 60); });
    s = await t.snap();
    ok(Math.abs(s.x - (s.W - C.BW / 2)) < 0.5, 'dragging past the edge parks the basket at the edge (' + s.x.toFixed(1) + ')');
    await t.ctx.close();
  }

  // 2. dumping: double tap with a second finger while the first drags; the 倒籃 button counts once per press
  {
    const t = await open();
    await t.play();
    const fill = () => t.ev(() => { const S = window.__game.sim; S.basket = [{ k: 'apple', v: 10 }, { k: 'pear', v: 15 }, { k: 'grape', v: 25 }]; });
    await fill();
    await t.touch('touchStart', [[100, 450, 1]]); await t.touch('touchMove', [[130, 450, 1]]);
    // (CDP: touchStart lists every finger down, touchEnd lists the fingers lifted)
    await t.touch('touchStart', [[130, 450, 1], [300, 300, 2]]); await t.touch('touchEnd', [[300, 300, 2]]);
    let s = await t.snap();
    ok(s.n === 3 && s.score === 0, 'one tap does not dump');
    await t.touch('touchStart', [[130, 450, 1], [302, 303, 2]]); await t.touch('touchEnd', [[302, 303, 2]]);
    await t.touch('touchMove', [[160, 450, 1]]);
    ok((await t.snap()).tx > s.tx + 20, 'the first finger is still steering after the second finger\'s taps');
    s = await t.snap();
    ok(s.n === 0 && s.score === 50 + 9, 'a second-finger double tap while dragging dumps with the 件數² bonus (' + s.score + ')');
    await t.touch('touchEnd', []);
    await t.p.waitForTimeout(350);
    await fill(); await t.tap('#bDump');
    s = await t.snap();
    ok(s.n === 0 && s.score === 59 * 2, 'one press on 倒籃 dumps exactly once (' + s.score + ')');
    await t.tap('#bDump'); s = await t.snap();
    ok(s.score === 118, 'pressing 倒籃 with an empty basket scores nothing');
    await t.ctx.close();
  }

  // 3. rotation pauses, a toolbar height change does not
  {
    const t = await open();
    await t.play();
    await t.p.setViewportSize({ width: 390, height: 760 }); await t.frames();
    ok(await t.ev(() => window.__game.mode) === 'play', 'a height-only resize (Safari toolbar) keeps playing');
    await t.p.setViewportSize({ width: 844, height: 390 }); await t.frames();
    ok(await t.ev(() => window.__game.mode) === 'pause' && await t.p.isVisible('#pause'), 'turning the phone mid-run pauses');
    await t.tap('#pResume');
    ok(await t.ev(() => window.__game.mode) === 'play', '繼續 resumes in landscape');
    await t.ctx.close();
  }

  // 4. the field fits around the HUD, the notch, the home indicator and the 倒籃 button
  for (const [w, h, sat, sab] of [[390, 844, 0, 0], [390, 844, 47, 34], [390, 664, 0, 0], [375, 560, 20, 0], [844, 390, 0, 21], [360, 640, 24, 0]]) {
    const t = await open(w, h);
    if (sat || sab) await t.ev(([a, b]) => { document.documentElement.style.setProperty('--sat', a + 'px'); document.documentElement.style.setProperty('--sab', b + 'px'); dispatchEvent(new Event('resize')); }, [sat, sab]);
    await t.play(); await t.frames();
    const v = await t.ev(() => window.__game.view());
    const y = u => v.oy + u * v.sc, x = u => v.ox + u * v.sc, tag = w + '×' + h + (sat || sab ? ' (insets ' + sat + '/' + sab + ')' : '');
    const hudB = await t.p.$eval('.hp', e => e.getBoundingClientRect().bottom);
    ok(y(C.SPAWN_Y - 12) >= hudB, tag + ': fruit appears below the HUD (' + y(C.SPAWN_Y - 12).toFixed(0) + ' ≥ ' + hudB.toFixed(0) + ')');
    ok(y(C.GROUND + 10) <= h - sab + 0.5, tag + ': the ground stays above the home indicator');
    const under = x(v.W) > v.dump.left;
    ok(!under || y(C.GROUND) <= v.dump.top + 0.5, tag + ': the basket never goes under the 倒籃 button (' + (under ? y(C.GROUND).toFixed(0) + ' ≤ ' + v.dump.top.toFixed(0) : 'beside the field') + ')');
    const lbl = await t.p.$eval('.dumpb .lbl', e => e.getBoundingClientRect().bottom);
    ok(lbl <= h - sab, tag + ': the 倒籃 label is fully on screen (' + lbl.toFixed(0) + ')');
    ok(v.sc * C.BW >= 40, tag + ': the basket stays at least 40 px wide (' + (v.sc * C.BW).toFixed(0) + ')');
    await t.ctx.close();
  }

  // 5. pagehide banks the run; finishing it later does not count anything twice
  {
    const t = await open();
    await t.play();
    await t.ev(() => { const S = window.__game.sim; S.score = 1200; S.basket = [{ k: 'apple', v: 10 }, { k: 'grape', v: 25 }]; S.caught = { apple: 3, grape: 1 }; dispatchEvent(new Event('pagehide')); });
    let b = await t.ls('best'), st = await t.ls('stats');
    ok(b.endless === 1235, 'pagehide banks score + basket as the best (' + b.endless + ')');
    ok(st.total === 1235 && st.fruit.apple === 3 && st.games === 0, 'pagehide banks fruit totals but not a finished game');
    await t.ev(() => { const S = window.__game.sim; S.score += 100; S.caught.apple = 5; dispatchEvent(new Event('pagehide')); });
    await t.ev(killFn);
    st = await t.ls('stats'); b = await t.ls('best');
    ok(st.games === 1 && st.total === 1335 && st.fruit.apple === 5 && st.fruit.grape === 1 + 0 && b.endless === 1335, 'the finished run is booked once: ' + JSON.stringify({ g: st.games, total: st.total, fruit: st.fruit, best: b.endless }));
    // visibility hidden pauses and banks
    await t.p.waitForTimeout(1300); await t.p.waitForTimeout(500); await t.tap('#oRetry'); await t.ev(() => { window.__game.hold(true); window.__game.skipCountdown(); window.__game.sim.score = 2000; });
    await t.ev(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await t.ev(() => window.__game.mode) === 'pause' && (await t.ls('best')).endless === 2000, 'going to the background pauses and banks the best');
    await t.ctx.close();
  }

  // 6. damaged storage falls back to defaults and a full game still works
  {
    const t = await open(390, 844, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', 1);
      const S = (k, v) => localStorage.setItem('basket.' + k, v);
      S('settings', JSON.stringify({ sens: 'abc', skin: 9, theme: 'neon', sound: 'yes' })); S('best', '"x"');
      S('stats', JSON.stringify({ fruit: null, games: '5', total: -3, longest: 'long' })); S('ach', 'null'); S('daily', '[1,2]');
    });
    const d = await t.ev(() => window.__game.data());
    ok(d.set.sens === 1 && d.set.skin === 0 && d.set.theme === 'auto' && d.set.sound === true, 'junk settings fall back to defaults: ' + JSON.stringify(d.set));
    ok(d.best.endless === 0 && d.stats.games === 0 && d.stats.total === 0 && d.daily.best === 0 && d.achs.length === 0, 'junk best / stats / achievements / daily read as empty');
    await t.play('daily');
    await t.ev(() => { const S = window.__game.sim; S.score = 300; S.caught = { apple: 2 }; });
    await t.ev(killFn);
    const st = await t.ls('stats'), dl = await t.ls('daily');
    ok(st.games === 1 && st.fruit.apple === 2 && dl.best === 300 && dl.plays === 1, 'a daily game after junk storage records normally');
    await t.ctx.close();
    const t2 = await open(390, 844, () => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('basket.best', '777'); localStorage.setItem('basket.settings', '{"sens":1.4,"skin":2}'); } });
    const d2 = await t2.ev(() => window.__game.data());
    ok(d2.best.endless === 777 && d2.set.sens === 1.4 && d2.set.skin === 2, 'a legacy numeric best and valid settings are kept');
    ok(/777/.test(await t2.p.textContent('#tBest')), 'the title shows the kept best');
    await t2.ctx.close();
  }

  // 7. result screen: taps in the first instant are ignored; a mid-run record gets a banner
  {
    const t = await open(390, 844, () => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('basket.best', '{"endless":100,"timed":0}'); } });
    await t.play();
    await t.ev(() => { window.__game.sim.score = 150; window.__game.advance(1 / 60); });
    ok(/新紀錄/.test(await t.p.textContent('#banner')), 'passing the old best mid-run shows 新紀錄！');
    await t.ev(killFn);
    await t.p.waitForFunction(() => window.__game.mode === 'over', null, { timeout: 4000 });
    await t.tap('#oRetry');
    ok(await t.ev(() => window.__game.mode) === 'over', 'a tap in the first instant of the result screen does nothing');
    ok(await t.p.isVisible('#oNew'), 'the result screen marks the new record');
    await t.p.waitForTimeout(500); await t.tap('#oRetry');
    ok(await t.ev(() => window.__game.mode) === 'play', '再收一次 works after the guard');
    await t.ctx.close();
  }

  ok(errors.length === 0, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
