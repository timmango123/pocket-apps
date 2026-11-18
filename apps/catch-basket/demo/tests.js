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
  async function open(w = 390, h = 844, init, arg) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (init) await ctx.addInitScript(init, arg);
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
    ok(Math.abs(s3.tx - (s2.tx - 30 / s.sc)) < 0.5, 'a finger held through pause/resume steers again, from its first move (' + ((s3.tx - s2.tx) * s.sc).toFixed(1) + ' px of -30)');
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
    const hud = await t.p.$eval('#hud', e => { const b = e.querySelector('.hp').getBoundingClientRect(), m = e.querySelector('#bMute').getBoundingClientRect(); return { b: b.bottom, r: Math.max(b.right, m.right), land: e.classList.contains('land') }; });
    if (hud.land) ok(hud.r <= x(0) + 0.5, tag + ': landscape HUD sits beside the field (' + hud.r.toFixed(0) + ' ≤ ' + x(0).toFixed(0) + ')');
    else ok(y(C.SPAWN_Y - 12) >= hud.b, tag + ': fruit appears below the HUD (' + y(C.SPAWN_Y - 12).toFixed(0) + ' ≥ ' + hud.b.toFixed(0) + ')');
    if (w > h) ok(v.sc * 26 >= 18, tag + ': landscape fruit is at least 18 px (was 15.7–16.8 with the HUD on top) (' + (v.sc * 26).toFixed(1) + ')');
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

  // ---------------- round-1 review (8.4) fixes ----------------
  // multi-finger CDP helper: touchStart/Move list every finger down, touchEnd lists only the fingers lifted
  const hands = t => { const f = {}, cdp = t.cdp, pts = () => Object.entries(f).map(([id, q]) => ({ x: q[0], y: q[1], id: +id }));
    const H = { async down(id, x, y) { f[id] = [x, y]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); await t.frames(); },
      async move(id, x, y) { f[id] = [x, y]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); await t.frames(); },
      async up(id) { const q = f[id]; delete f[id]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: q[0], y: q[1], id: +id }] }); await t.frames(); },
      async tap(x, y, id = 9, hold = 0) { await H.down(id, x, y); if (hold) await t.p.waitForTimeout(hold); await H.up(id); },
      async tapSel(sel, id = 9, hold = 0, dx = 0, dy = 0) { const c = await t.ev(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width, b.height]; }, sel); await H.tap(c[0] + dx * (c[2] / 2), c[1] + dy * (c[3] / 2), id, hold); return c; } };
    return H; };
  const openT = async (w, h, init, arg) => { const t = await open(w, h, init, arg); t.cdp = await t.ctx.newCDPSession(t.p); return t; };
  const count = () => window.__n = { mute: 0, pause: 0 };

  // R1. [veto] a second finger on HUD / overlay buttons while one finger drags: each fires exactly once
  {
    const t = await openT(); const H = hands(t);
    await t.play(); await t.ev(() => { window.__game.hold(false); });
    const sound0 = (await t.ev(() => window.__game.data())).set.sound;
    await H.down(1, 120, 640); await H.move(1, 140, 640);
    await H.tapSel('#bMute', 2);
    ok((await t.ev(() => window.__game.data())).set.sound === !sound0, 'R1: second-finger tap on 音效 while dragging toggles it once');
    await H.tapSel('#bPause', 3, 600);
    ok(await t.ev(() => window.__game.mode) === 'pause', 'R1: second-finger 0.6 s hold on 暫停 while dragging pauses');
    await H.tapSel('#pResume', 4, 1000);
    ok(await t.ev(() => window.__game.mode) === 'play', 'R1: second-finger 1 s hold on 繼續 while a finger is still down resumes');
    await H.up(1);
    // the game-over buttons with a finger still on the field
    await t.ev(() => window.__game.skipCountdown()); await H.down(1, 120, 640);
    await t.ev(killFn); await t.p.waitForFunction(() => window.__game.mode === 'over', null, { timeout: 4000 }); await t.p.waitForTimeout(500);
    await H.tapSel('#oRetry', 5);
    ok(await t.ev(() => window.__game.mode) === 'play', 'R1: 再收一次 with another finger down starts a new run');
    await H.up(1);
    // every overlay button, single finger, exactly once (switches toggle once, not twice)
    await t.ev(() => window.__game.pause()); await H.tapSel('#pSet');
    ok(await t.p.isVisible('#settings'), 'R1: 設定 from pause opens settings');
    const vib0 = (await t.ev(() => window.__game.data())).set.vib;
    await H.tapSel('#sVib'); ok((await t.ev(() => window.__game.data())).set.vib === !vib0, 'R1: one tap on 震動 toggles exactly once');
    // CI's Chromium 141 delivers the tap's own click with detail 0 (it looked like a keyboard press and toggled again): replay that click
    await H.tapSel('#sVib'); await t.ev(() => document.getElementById('sVib').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    ok((await t.ev(() => window.__game.data())).set.vib === vib0, 'R1: a tap whose click arrives with detail 0 (Chromium 141) still toggles exactly once');
    await H.tapSel('#sSkin button[data-v="1"]'); ok((await t.ev(() => window.__game.data())).set.skin === 1, 'R1: a 籃子造型 segment tap selects it');
    // edge tap: 12 px outside the right edge of 完成 still counts (browser targets it); a slide off the control does not
    const c = await t.ev(() => { const b = document.getElementById('sOk').getBoundingClientRect(); return [b.right - 4, b.top + b.height / 2]; });
    await H.down(6, c[0], c[1]); await H.move(6, c[0] + 60, c[1] + 70); await H.up(6);
    ok(await t.p.isVisible('#settings'), 'R1: sliding 60+ px off 完成 before lifting does nothing');
    await H.down(6, c[0], c[1]); await H.move(6, c[0] + 14, c[1]); await H.up(6);
    ok(await t.p.isVisible('#pause'), 'R1: releasing 12 px outside 完成\'s edge after a slide still fires it');
    // a tap that changes the screen does not fire the control under the finger on the next screen (回主選單 → title)
    await H.tapSel('#pMenu', 7, 300);
    ok(await t.ev(() => window.__game.mode) === 'title' && await t.p.isVisible('#title'), 'R1: 回主選單 lands on the title and nothing under the finger fires');
    ok(await t.ev(() => document.activeElement === document.body), 'R1: no control on the new screen got focus');
    // keyboard activation still works
    await t.ev(() => document.getElementById('tHelp').focus()); await t.p.keyboard.press('Enter');
    ok(await t.p.isVisible('#help'), 'R1: Enter on a focused button activates it');
    await t.ev(() => document.getElementById('hOk').focus()); await t.p.keyboard.press('Enter');
    // a focused slider loses focus when a button is tapped
    await H.tapSel('#tSet'); await t.ev(() => document.getElementById('sSens').focus()); await H.tapSel('#sOk');
    ok(await t.ev(() => document.activeElement === document.body) && await t.p.isVisible('#title'), 'R1: tapping a button blurs a focused field');
    await t.ctx.close();
  }

  // R2. [veto] the HUD never clips at 360 px (5 lives, 5- and 6-digit scores, 1100 s, 最高 difficulty) — also with wider glyphs than
  // this machine's fonts (CI's Ubuntu fonts measured 239 > 234 at 360 px), emulated with extra letter spacing
  for (const [w, h] of [[360, 640], [390, 844], [375, 500]]) {
    const t = await openT(w, h);
    for (const wide of [0, 1.5, 3]) for (const [score, tt] of [[99999, 120], [120000, 1100], [999999, 900]]) {
      await t.play(); await t.ev(([sc, tt, wide]) => { let st = document.getElementById('wide'); if (!st) { st = document.createElement('style'); st.id = 'wide'; document.head.appendChild(st); }
        st.textContent = wide ? '.hud .hs,.hud .brow{letter-spacing:' + wide + 'px}' : ''; dispatchEvent(new Event('resize'));
        const S = window.__game.sim; S.lives = 5; S.score = sc; S.t = tt; S.lvl = Math.min(21, 1 + Math.floor(tt / 15)); for (let i = 0; i < 19; i++) S.basket.push({ k: 'grape', v: 50 }); }, [score, tt, wide]);
      await t.p.waitForFunction(s => document.getElementById('hS').textContent === String(s), score, { timeout: 5000 }); await t.frames();
      const r = await t.ev(() => { const row = document.querySelector('.hrow'), b = document.querySelector('.brow'); return [row.scrollWidth, row.clientWidth, b.scrollWidth, b.clientWidth, document.getElementById('hD').textContent, document.getElementById('hL').textContent]; });
      ok(r[0] <= r[1] && r[2] <= r[3], 'R2: ' + w + '×' + h + (wide ? ' (+' + wide + ' px glyphs)' : '') + ' HUD fits with 5 lives, ' + score + ', ' + tt + ' s (' + r[0] + '≤' + r[1] + ', ' + r[2] + '≤' + r[3] + ', 難度 ' + r[4] + ')');
    }
    await t.ctx.close();
  }

  // R5. a finger that lands on 倒籃 and slides steers instead of dumping; a tap still dumps once, also with a finger already down
  {
    const t = await openT(); const H = hands(t);
    await t.play();
    const fill = () => t.ev(() => { const S = window.__game.sim; S.basket = [{ k: 'apple', v: 10 }, { k: 'pear', v: 15 }]; });
    await fill(); const s0 = await t.snap();
    const d = await t.ev(() => { const b = document.getElementById('bDump').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    await H.down(1, d[0], d[1]); for (let i = 1; i <= 6; i++) await H.move(1, d[0] - i * 15, d[1]); await H.up(1);
    let s = await t.snap();
    ok(s.n === 2 && s.score === 0, 'R5: dragging from the 倒籃 button does not dump');
    ok(s.tx < s0.tx - 60 / s.sc, 'R5: …and the basket follows that finger (' + (s.tx - s0.tx).toFixed(0) + ')');
    await t.p.waitForTimeout(350);
    await H.tap(d[0], d[1], 2); s = await t.snap(); ok(s.n === 0 && s.score === 25 + 4, 'R5: a tap on 倒籃 dumps once (' + s.score + ')');
    await fill(); await H.down(1, 120, 640); await H.tap(d[0] + 3, d[1] + 2, 3, 600); s = await t.snap();
    ok(s.n === 0 && s.score === 58, 'R5: a 0.6 s press on 倒籃 with another finger down dumps once (' + s.score + ')');
    await H.up(1);
    await t.ctx.close();
  }

  // R7. a run survives a reload: 繼續收成 picks it up exactly where it was; starting fresh counts it as played
  {
    const t = await openT(); const H = hands(t);
    await t.play('timed');
    await t.ev(() => { const g = window.__game, S = g.sim; g.hold(false); S.nextSpawn = S.t + 0.3; });
    await t.p.waitForFunction(() => window.__game.sim.t > 4, null, { timeout: 8000 });
    const before = await t.ev(() => { const S = window.__game.sim; window.__game.hold(true); S.basket.push({ k: 'chest', v: 50 }, { k: 'apple', v: 10 }); S.score += 300; dispatchEvent(new Event('pagehide'));
      return { t: S.t, score: S.score, n: S.basket.length, items: S.items.length, lives: S.lives }; });
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    ok(await t.p.isVisible('#tCont') && /繼續限時收成/.test(await t.p.textContent('#tCont')), 'R7: after a reload the title offers 繼續限時收成');
    await H.tapSel('#tCont');
    const after = await t.ev(() => { const S = window.__game.sim, g = window.__game; return { t: S.t, score: S.score, n: S.basket.length, items: S.items.length, lives: S.lives, mode: g.mode, limit: S.limit }; });
    ok(after.mode === 'play' && Math.abs(after.t - before.t) < 0.01 && after.score === before.score && after.n === before.n && after.items === before.items && after.lives === before.lives && after.limit === 90,
      'R7: the run continues where it was ' + JSON.stringify(after));
    await t.ev(() => { window.__game.skipCountdown(); window.__game.hold(true); }); await t.ev(killFn);
    const st = await t.ls('stats');
    ok(st.games === 1 && (await t.ls('best')).timed >= before.score, 'R7: the continued run is booked once when it ends (games ' + st.games + ')');
    ok(await t.ls('run') === null, 'R7: a finished run leaves nothing to continue');
    // abandon a saved run by starting a new one: it counts as a game
    await t.p.waitForFunction(() => window.__game.mode === 'over', null, { timeout: 4000 });
    await t.ev(() => { window.__game.start('endless'); window.__game.skipCountdown(); window.__game.hold(true); window.__game.advance(0.5); window.__game.sim.score = 40; dispatchEvent(new Event('pagehide')); });
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    await H.tapSel('#tPlay');
    ok((await t.ls('stats')).games === 2 && await t.ev(() => window.__game.sim.score) === 0, 'R7: starting fresh instead counts the left run as played');
    await t.ctx.close();
    // junk in the saved run is ignored
    const t2 = await openT(390, 844, () => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('basket.run', '{"v":1,"mode":"endless","day":1,"d":{"o":{"t":5,"items":"x"},"r":1}}'); } });
    ok(!(await t2.p.isVisible('#tCont')) && await t2.ls('run') === null, 'R8: a damaged saved run is dropped, the title works');
    await t2.ctx.close();
    // wrong types inside an otherwise valid saved run (review round 2: caught:null threw on every catch) are replaced by defaults
    const bad = { v: 1, mode: 'endless', day: 1, d: { r: 1, evN: 'x', spT: null, o: { t: 5, W: 360, score: 10, lives: 3, x: 180, tx: 180, nextSpawn: 6, seed: 1, basket: [], items: [], caught: null,
      streak: 'x', maxStreak: null, harvest: 'yes', freeze: 'a', shake: {}, rainOn: 1, maxLives: 'q', cm: 5, prevBest: 'x', lvl: [], limit: 'x', mode: 7, endBy: 3, rainBest: NaN } } };
    const t3 = await openT(390, 844, b => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', 1); localStorage.setItem('basket.run', b); } }, JSON.stringify(bad));
    const H3 = hands(t3); await H3.tapSel('#tCont');
    await t3.ev(() => { const g = window.__game, S = g.sim; g.skipCountdown(); g.hold(true);
      for (const k of ['apple', 'grape', 'stone']) { S.items.push({ k, good: k !== 'stone' ? 1 : 0, r: 13, x0: S.x, y0: 540, vx: 0, vy: 300, t0: S.t, W: S.W, ta: S.t + 0.05, alive: true, passed: false, rot: 0, spin: 0, ph: 0 }); g.advance(0.2); }
      S.basket.push({ k: 'apple', v: 10 }); g.advance(1); });
    const s3 = await t3.ev(() => { const S = window.__game.sim; return { caught: S.caught, streak: S.streak, lives: S.lives, score: S.score, mode: window.__game.mode, limit: S.limit }; });
    ok(s3.mode === 'play' && s3.caught.apple === 1 && s3.caught.grape === 1 && s3.lives === 2 && s3.limit === 0 && Number.isFinite(s3.score), 'R8: a saved run with wrong field types continues and plays normally ' + JSON.stringify(s3));
    await t3.ev(() => { const S = window.__game.sim; S.lives = 1; S.items.push({ k: 'rotten', good: 0, r: 13, x0: S.x, y0: 540, vx: 0, vy: 300, t0: S.t, W: S.W, ta: S.t + 0.05, alive: true, passed: false, rot: 0, spin: 0, ph: 0 }); window.__game.advance(0.1); });
    await t3.p.waitForFunction(() => window.__game.mode === 'over', null, { timeout: 4000 });
    ok((await t3.ls('stats')).games === 1, 'R8: …and is booked when it ends');
    await t3.ctx.close();
  }

  // R9/R10. difficulty keeps building after 190 s up to 最高 (21); 限時 runs the hazard curve slower
  {
    const slant = (a, b, mode) => { let n = 0, s = 0, bad = 0; for (let seed = 1; seed <= 6; seed++) { const S = C.makeSim({ W: 360, seed, mode, noDie: true }); S.t = a - 0.01; S.nextSpawn = a; S.lvl = 0;
      while (S.t < b) { S.advance(1 / 60); for (const it of S.items) if (!it.seen && it.t0 >= a) { it.seen = 1; n++; if (it.vx) s++; if (!it.good) bad++; } } } return { slant: s / n, bad: bad / n }; };
    const mid = slant(150, 180), lat = slant(280, 310);
    ok(lat.slant > mid.slant + 0.1, 'R9: more slanted fruit after 190 s (' + mid.slant.toFixed(2) + ' → ' + lat.slant.toFixed(2) + ')');
    const S = C.makeSim({ W: 360, seed: 3, noDie: true }); S.t = 299.9; S.nextSpawn = 1e9; S.advance(0.2); const L = S.lvl; S.t = 600; S.advance(0.1);
    ok(L === 21 && S.lvl === 21, 'R9: difficulty tops out at 21 at 300 s (' + L + ', ' + S.lvl + ')');
    const te = slant(70, 88, 'timed'), en = slant(70, 88, 'endless');
    ok(te.bad < en.bad - 0.04, 'R10: 限時 has fewer bad drops at 70–88 s (' + te.bad.toFixed(2) + ' vs ' + en.bad.toFixed(2) + ')');
    const t = await openT(); await t.play(); await t.ev(() => { const S = window.__game.sim; S.t = 330; window.__game.advance(1 / 60); }); await t.frames();
    ok(await t.p.textContent('#hD') === '最高', 'R9: the HUD shows 難度 最高 instead of a number that no longer means anything');
    await t.ctx.close();
  }

  // R11. first-run hints (never blocking), each shown once
  {
    const t = await openT();
    await t.ev(() => { const g = window.__game; g.start('endless'); g.skipCountdown(); });
    await t.p.waitForFunction(() => document.getElementById('tip').classList.contains('show'), null, { timeout: 3000 });
    ok(/拖曳/.test(await t.p.textContent('#tip')), 'R11: the first game opens with the drag hint');
    ok(await t.ev(() => getComputedStyle(document.getElementById('tip')).pointerEvents) === 'none', 'R11: the hint does not take touches');
    await t.ev(() => { const S = window.__game.sim; for (let i = 0; i < 8; i++) S.basket.push({ k: 'apple', v: 10 }); });
    await t.p.waitForFunction(() => /連點兩下/.test(document.getElementById('tip').textContent), null, { timeout: 12000 });
    ok(true, 'R11: 8 items in the basket brings the dump hint');
    ok((await t.ls('tips')).dump === 1, 'R11: hints are remembered');
    await t.ctx.close();
  }

  // R12. details: why the run ended, the result line breaks only between parts, achievement progress, 320 ms double tap
  {
    const t = await openT(); const H = hands(t);
    await t.play();
    await t.ev(() => { const g = window.__game, S = g.sim; S.lives = 1; S.maxStreak = 25; S.score = 12345; S.settle = 0;
      S.items.push({ k: 'stone', good: 0, r: 14, x0: S.x, y0: 540, vx: 0, vy: 300, t0: S.t, W: S.W, ta: S.t + 0.05, alive: true, passed: false, rot: 0, spin: 0, ph: 0 }); g.advance(0.1); });
    await t.p.waitForFunction(() => window.__game.mode === 'over', null, { timeout: 4000 });
    ok(/石頭/.test(await t.p.textContent('#oWhy')), 'R12: the result says what took the last life (' + await t.p.textContent('#oWhy') + ')');
    ok(await t.ev(() => [...document.querySelectorAll('#oMsg span')].every(s => s.getClientRects().length === 1)), 'R12: no part of the result line is split across lines at 390 px');
    await t.p.waitForTimeout(500); await H.tapSel('#oMenu'); await H.tapSel('#tRec');
    ok(/25\/50/.test(await t.p.textContent('#rAch')), 'R12: achievements show progress (豐收五十連 25/50)');
    await H.tapSel('#rOk'); await t.play(); await t.ev(() => { window.__game.sim.basket = [{ k: 'apple', v: 10 }]; });
    await t.ev(() => { window.__ups = []; document.getElementById('cv').addEventListener('pointerup', () => window.__ups.push(performance.now())); });
    await H.tap(200, 400, 2); await t.p.waitForTimeout(200); await H.tap(203, 402, 2);
    const gap = await t.ev(() => window.__ups[1] - window.__ups[0]);
    ok((await t.snap()).n === 0 || gap >= 320, 'R12: a double tap ' + gap.toFixed(0) + ' ms apart (old window 280 ms) dumps');
    await t.ev(() => { window.__game.sim.basket = [{ k: 'apple', v: 10 }]; }); await t.p.waitForTimeout(400);
    for (let k = 0; k < 2; k++) { await H.down(1, 200, 640); await H.move(1, 209, 640); await H.up(1); }
    ok((await t.snap()).n === 1, 'R12: re-gripping the drag twice in a row (lift after a 9 px slide) is not a double tap');
    await t.ctx.close();
  }

  ok(errors.length === 0, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
