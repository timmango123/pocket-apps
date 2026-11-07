// Regression tests for 果園快刀 (fruit-slash), one per release-review finding (qa/release/fruit-slash/score.json).
// Real headless Chromium, real CDP touch events. Waits on conditions, never on wall-clock frame deltas: every swipe
// carries its own planned event timestamps (like touch hardware), so a busy machine cannot change the speeds or the
// gaps the game measures.   Usage: node tests.js
const path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = process.env.APP_URL || 'file://' + path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  (' + extra + ')' : '')); };

// ---------- core curve (no browser) ----------
{
  const fs = require('fs');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  const C = new Function(src + '\nreturn {mulberry32,makeWave,waveInterval,waveCount,nutProb,gravity,diffLevel,baseR,DIFF_MAX_T,WARMUP_T,cutBonus};')();
  let burst = 0;
  for (let seed = 1; seed <= 60; seed++) { const rng = C.mulberry32(seed); for (let t = 0; t < 20; t += 0.25) { const w = C.makeWave(rng, t, 390, 844, C.baseR(390, 844)); if (w.items.length > C.waveCount(t)) burst++; } }
  check('no 5-8 fruit burst waves before t=20 s', burst === 0, burst + ' bursts');
  check('lower gravity / longer hang time early (t=0 vs t=30)', C.gravity(0, 844) < C.gravity(30, 844) * 0.85, C.gravity(0, 844).toFixed(0) + ' vs ' + C.gravity(30, 844).toFixed(0));
  check('extra fruit cut tolerance early, none from 30 s', C.cutBonus(0) >= 10 && C.cutBonus(30) === 0);
  check('difficulty still ramps after 120 s (no early wall)', C.waveInterval(120) >= 0.68 && C.waveInterval(180) < C.waveInterval(120) && C.nutProb(120) <= 0.2 && C.nutProb(170) > C.nutProb(120),
    `interval 120s ${C.waveInterval(120).toFixed(2)}, 180s ${C.waveInterval(180).toFixed(2)}; nut 120s ${C.nutProb(120).toFixed(2)}`);
  const T = C.DIFF_MAX_T, same = ['waveInterval', 'waveCount', 'nutProb'].every(f => C[f](T) === C[f](T + 300)) && C.gravity(T, 844) === C.gravity(T + 300, 844);
  check('HUD level stops exactly where the curve stops', same && C.diffLevel(T) === C.diffLevel(T + 500) && C.diffLevel(T - 15) < C.diffLevel(T), 'max level ' + C.diffLevel(T));
  // every generated formation path can still be cut as ONE combo: walking it in 24 px chunks never trips the
  // turn-back rule (chunk vs previous chunk, chunk vs first-cut direction, both must stay above -0.85)
  let worst = 1, splits = 0, paths = 0;
  for (const [W, H] of [[390, 844], [844, 390]]) for (let seed = 1; seed <= 30; seed++) { const rng = C.mulberry32(seed * 31); for (let t = 20; t <= 300; t += 2) {
    const w = C.makeWave(rng, t, W, H, C.baseR(W, H)), L = w.line; if (L.length < 4) continue; paths++;
    const d0 = [L[1][0] - L[0][0], L[1][1] - L[0][1]], l0 = Math.hypot(d0[0], d0[1]); d0[0] /= l0; d0[1] /= l0;
    for (const off of [0, 8, 16]) {
      const pts = []; for (let i = 0; i + 1 < L.length; i++) { const sl = Math.hypot(L[i + 1][0] - L[i][0], L[i + 1][1] - L[i][1]); for (let d = (i ? 0 : off); d < sl; d += 4) pts.push([L[i][0] + (L[i + 1][0] - L[i][0]) * d / sl, L[i][1] + (L[i + 1][1] - L[i][1]) * d / sl]); }
      let a = pts[0], prev = null;
      for (const q of pts) { const dx = q[0] - a[0], dy = q[1] - a[1], dl = Math.hypot(dx, dy); if (dl < 24) continue; const u = [dx / dl, dy / dl];
        const m = Math.min(u[0] * d0[0] + u[1] * d0[1], prev ? u[0] * prev[0] + u[1] * prev[1] : 1); worst = Math.min(worst, m); if (m < -0.85) splits++; prev = u; a = q; }
    } } }
  check('formation paths are never split by the turn-back rule', splits === 0, `${paths} paths, worst dot ${worst.toFixed(2)}`);
  const out = execFileSync(process.execPath, [path.join(__dirname, 'check-waves.js')]).toString();
  check('wave generator guarantees incl. cross-wave chestnut check (check-waves.js)', /ALL WAVE CHECKS PASSED/.test(out) && /one-stroke line hits an older chestnut: 0;/.test(out), (out.match(/Cross-wave[^\n]*/) || [''])[0].slice(0, 160));
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, clear = true) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); if (process.env.DBG) page.on('console', m => console.log('  page:', m.text())); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(APP); if (clear) { await page.evaluate(() => localStorage.clear()); await page.reload(); }
    await page.waitForFunction(() => window.__game && __game.snap().items.some(i => i.kind === 'start'));
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }
  const T = (P, type, pts, ts) => P.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: (ts || Date.now()) / 1000 });
  // polyline swipe with planned timestamps; pts = [[x,y],...], ms = total duration
  async function swipe(P, pts, ms, id = 1) {
    const L = []; let tot = 0; for (let i = 1; i < pts.length; i++) { tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); L.push(tot); }
    const n = Math.max(6, Math.ceil(tot / 14)), t0 = Date.now();
    const at = d => { for (let i = 1; i < pts.length; i++) if (d <= L[i - 1] + 1e-9) { const a = L[i - 2] || 0, f = (d - a) / Math.max(1e-9, L[i - 1] - a); return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f }; } const p = pts[pts.length - 1]; return { x: p[0], y: p[1] }; };
    await T(P, 'touchStart', [{ x: pts[0][0], y: pts[0][1], id }], t0);
    for (let k = 1; k <= n; k++) { const tg = t0 + ms * k / n, d = tg - Date.now(); if (d > 1) await sleep(d); await T(P, 'touchMove', [Object.assign({ id }, at(tot * k / n))], tg); }
    const e = at(tot); await T(P, 'touchEnd', [{ x: e.x, y: e.y, id }], t0 + ms + 5);
  }
  const box = (P, sel) => P.page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);
  async function tap(P, sel, id = 9) { const b = await box(P, sel); await T(P, 'touchStart', [{ x: b.x, y: b.y, id }]); await sleep(30); await T(P, 'touchEnd', [{ x: b.x, y: b.y, id }]); }
  const st = P => P.page.evaluate(() => __game.state());
  const until = (P, fn, arg, timeout = 5000) => P.page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
  const visible = (P, id) => P.page.evaluate(i => !document.getElementById(i).classList.contains('hidden'), id);
  async function startClassic(P) {
    const m = await P.page.evaluate(() => __game.snap().items.find(i => i.kind === 'start'));
    await swipe(P, [[m.x - m.r * 1.4, m.y], [m.x + m.r * 1.4, m.y]], 100);
    await until(P, () => __game.state().state === 'play');
    await P.page.evaluate(() => { __game.hold(); __game.clear(); });
  }
  const reset = P => P.page.evaluate(() => { __game.clear(); __game.set({ score: 0, slices: 0, maxCombo: 0, lives: 3, nextLife: 1e9, misses: 0 }); });

  try {
    // ================= 390 x 844 =================
    let P = await open(390, 844);
    await startClassic(P);
    check('slicing 「開始」 starts classic', (await st(P)).state === 'play');

    // [veto] second finger taps pause while finger 1 is down on the board
    let ok = 0, okRes = 0, cutWhilePaused = 0;
    const pb = await box(P, '#bPause');
    for (let i = 0; i < 4; i++) {
      await reset(P);
      await T(P, 'touchStart', [{ x: 60, y: 600, id: 1 }]); await sleep(40);
      await T(P, 'touchStart', [{ x: 60, y: 600, id: 1 }, { x: pb.x, y: pb.y, id: 2 }]); await sleep(30);
      await T(P, 'touchEnd', [{ x: pb.x, y: pb.y, id: 2 }]);
      if (await until(P, () => __game.state().paused, null, 2000)) ok++; else continue;
      // finger 1 keeps sliding over a fruit while paused: must not cut
      await P.page.evaluate(() => __game.place('apple', 195, 640));
      const t0 = Date.now(); for (let k = 1; k <= 10; k++) await T(P, 'touchMove', [{ x: 60 + k * 30, y: 640, id: 1 }], t0 + k * 12);
      await sleep(80);
      if ((await st(P)).slices > 0) cutWhilePaused++;
      const rb = await box(P, '#pResume');
      await T(P, 'touchStart', [{ x: 360, y: 640, id: 1 }, { x: rb.x, y: rb.y, id: 3 }]); await sleep(30);
      await T(P, 'touchEnd', [{ x: rb.x, y: rb.y, id: 3 }]);
      if (await until(P, () => !__game.state().paused, null, 2000)) okRes++;
      await T(P, 'touchEnd', [{ x: 360, y: 640, id: 1 }]); await sleep(50);
      if ((await st(P)).paused) await P.page.keyboard.press('p');
    }
    check('second finger on 暫停 pauses while finger 1 holds the board', ok === 4, ok + '/4');
    check('finger still on the board cannot cut while paused', cutWhilePaused === 0, cutWhilePaused + '/' + ok);
    check('second finger on 繼續 resumes', okRes === ok && ok > 0, okRes + '/' + ok);

    // one tap = one action (pointerup + click must not double fire); sound toggle in the pause card
    await tap(P, '#bPause'); await until(P, () => __game.state().paused);
    const mb = await P.page.evaluate(() => { const e = document.getElementById('pMute'); return { w: e.offsetWidth, h: e.offsetHeight }; }); // layout size (the card pops in with a scale animation)
    check('pause card has a sound toggle ≥ 44×44', await visible(P, 'pauseOv') && mb.w >= 44 && mb.h >= 44, Math.round(mb.w) + '×' + Math.round(mb.h));
    await tap(P, '#pMute'); await sleep(300);
    let muted = await P.page.evaluate(() => JSON.parse(localStorage.getItem('fruitslash.settings')).muted);
    const txt = await P.page.textContent('#pMuteTxt');
    await P.page.click('#pMute'); await sleep(100); // mouse click path also works, exactly once
    const muted2 = await P.page.evaluate(() => JSON.parse(localStorage.getItem('fruitslash.settings')).muted);
    check('one tap toggles sound exactly once (touch, then mouse)', muted === true && txt.includes('關') && muted2 === false, `${muted} ${txt} ${muted2}`);
    await tap(P, '#pResume'); await until(P, () => !__game.state().paused);
    check('one tap on 繼續 resumes and stays resumed', !(await st(P)).paused && !(await visible(P, 'pauseOv')));

    // combo exploit 1: separate quick swipes never merge into one combo
    await reset(P);
    for (let i = 0; i < 8; i++) {
      await P.page.evaluate(() => __game.place('kiwi', 195, 420));
      await swipe(P, [[110, 410], [280, 430]], 50);
    }
    await sleep(200);
    let g = await st(P);
    check('8 separate quick swipes = 8 single cuts, no combo bonus', g.slices === 8 && g.maxCombo <= 1 && g.score === 8, `slices ${g.slices}, maxCombo ${g.maxCombo}, score ${g.score}`);

    // combo exploit 2: one finger scribbling back and forth
    await reset(P);
    await P.page.evaluate(() => { for (let k = 0; k < 9; k++) __game.place('apple', 195, 150 + k * 75); });
    const zz = []; for (let k = 0; k < 9; k++) { const y = 150 + k * 75; zz.push(k % 2 ? [350, y] : [40, y], k % 2 ? [40, y] : [350, y]); }
    await swipe(P, zz, 1400);
    await sleep(200); g = await st(P);
    check('scribbling with one finger does not chain a combo', g.slices >= 7 && g.maxCombo <= 2 && g.score === g.slices, `slices ${g.slices}, maxCombo ${g.maxCombo}, score ${g.score}`);

    // a real combo with a sharp bend (formation paths can bend up to ~145°) still counts
    await reset(P);
    await P.page.evaluate(() => { __game.place('orange', 100, 200); __game.place('lemon', 130, 290); __game.place('apple', 160, 200); });
    await swipe(P, [[75, 125], [100, 200], [130, 290], [160, 200], [185, 125]], 110);
    await sleep(200); g = await st(P);
    check('3 fruits in one bent stroke = 3 + 3 combo bonus', g.score === 6 && g.maxCombo === 3, `score ${g.score}, maxCombo ${g.maxCombo}`);

    // combo window: cuts more than 0.5 s apart in one long stroke are not one combo
    await reset(P);
    await P.page.evaluate(() => { const a = [5, 100], b = [385, 800]; for (const f of [0.1, 0.5, 0.9]) __game.place('melon', a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f); });
    await swipe(P, [[5, 100], [385, 800]], 800);
    await sleep(200); g = await st(P);
    check('a combo closes 0.5 s after its first cut', g.slices === 3 && g.maxCombo === 2 && g.score === 3, `slices ${g.slices}, maxCombo ${g.maxCombo}, score ${g.score}`);

    // warm-up: misses in the first 20 s are free, later they cost a leaf
    await reset(P);
    await P.page.evaluate(() => { __game.jump(5); __game.place('apple', 195, 820, 300); });
    await until(P, () => __game.state().misses >= 1);
    g = await st(P);
    check('warm-up (t<20 s): a missed fruit costs no leaf', g.lives === 3 && g.misses === 1, `lives ${g.lives}, misses ${g.misses}`);
    // the end of the warm-up is announced 3 s ahead and when it happens
    await P.page.evaluate(() => { __game.jump(16.9); __game.set({ warnWarm: false, endWarm: false }); }); // earlier tests already played past 17 s
    const warn = await until(P, () => document.getElementById('toast').textContent.includes('暖身 3 秒後結束'), null, 3000);
    await P.page.evaluate(() => __game.jump(19.95));
    const over = await until(P, () => document.getElementById('toast').textContent.includes('暖身結束'), null, 3000);
    check('toasts 「暖身 3 秒後結束」 and 「暖身結束」', warn && over);
    // after the warm-up the first two misses cost half a leaf each, then whole leaves
    await P.page.evaluate(() => { __game.jump(25); __game.place('apple', 195, 820, 300); });
    await until(P, () => __game.state().misses >= 2);
    g = await st(P); const halfCls = await P.page.evaluate(() => document.querySelectorAll('#hLives svg.half').length);
    check('first miss after warm-up costs half a leaf', g.lives === 3 && g.half && halfCls === 1, `lives ${g.lives}, half ${g.half}`);
    await P.page.evaluate(() => __game.place('apple', 195, 820, 300));
    await until(P, () => __game.state().misses >= 3);
    g = await st(P);
    check('second miss completes the leaf', g.lives === 2 && !g.half, `lives ${g.lives}, half ${g.half}`);
    await P.page.evaluate(() => __game.place('apple', 195, 820, 300));
    await until(P, () => __game.state().misses >= 4);
    g = await st(P);
    check('later misses cost a whole leaf', g.lives === 1, 'lives ' + g.lives);

    // extra leaves get harder to earn: 100, 250, 450...
    await P.page.evaluate(() => { __game.clear(); __game.set({ score: 99, nextLife: 100, lifeStep: 100, lives: 1 }); __game.place('apple', 195, 400); });
    await swipe(P, [[120, 400], [270, 400]], 80); await until(P, () => __game.state().score >= 100);
    const l1 = await st(P);
    await P.page.evaluate(() => { __game.set({ score: 249 }); __game.place('apple', 195, 400); });
    await swipe(P, [[120, 400], [270, 400]], 80); await until(P, () => __game.state().score >= 250);
    const l2 = await st(P);
    check('leaf refills at 100 then 250, next at 450', l1.lives === 2 && l1.nextLife === 250 && l2.lives === 3 && l2.nextLife === 450, `${l1.lives}/${l1.nextLife} ${l2.lives}/${l2.nextLife}`);
    await reset(P);

    // first-time hint for special fruit
    await P.page.evaluate(() => __game.place('ice', 195, 300));
    const tip = await P.page.textContent('#toast');
    check('first 冰梨 shows what it does', tip.includes('冰梨') && tip.includes('慢動作'), tip);
    await P.page.evaluate(() => __game.clear());

    // HUD level stops at the cap, no more 難度提升 toasts
    await P.page.evaluate(() => __game.jump(400)); await sleep(150);
    const d1 = await P.page.textContent('#hDiff');
    await P.page.evaluate(() => __game.jump(600)); await sleep(150);
    const d2 = await P.page.textContent('#hDiff'), t2 = await P.page.textContent('#toast');
    check('HUD 難度 stays at the real cap', d1 === d2 && !/難度提升 → (1[5-9]|[2-9]\d)/.test(t2), `${d1} / ${d2} / ${t2}`);
    await P.page.evaluate(() => __game.jump(25));

    // unfinished run's stats survive a reload
    await P.page.keyboard.press('p'); await until(P, () => __game.state().paused); // pausing writes pending stats
    const s0 = await P.page.evaluate(() => (JSON.parse(localStorage.getItem('fruitslash.stats') || '{}').slices) || 0);
    await P.page.keyboard.press('p'); await until(P, () => !__game.state().paused);
    await reset(P);
    await P.page.evaluate(() => { __game.place('mango', 120, 400); __game.place('lemon', 290, 400); });
    await swipe(P, [[60, 380], [180, 420]], 60); await swipe(P, [[230, 380], [350, 420]], 60, 2);
    await until(P, () => __game.state().slices >= 2);
    await P.page.reload(); await P.page.waitForFunction(() => window.__game);
    const s1 = await P.page.evaluate(() => JSON.parse(localStorage.getItem('fruitslash.stats')).slices);
    check('cuts of an unfinished run are kept after reload', s1 === s0 + 2, `${s0} -> ${s1}`);

    // best is saved the moment the run ends (before the slow-motion outro and result screen)
    await P.page.waitForFunction(() => __game.snap().items.some(i => i.kind === 'start'));
    await startClassic(P);
    await P.page.evaluate(() => { __game.jump(25); __game.set({ score: 41, lives: 1, grace: 0 }); __game.place('apple', 195, 820, 300); });
    const atEnd = await P.page.waitForFunction(() => { const s = __game.state().state; return s === 'ending' ? (localStorage.getItem('fruitslash.best') || 'none') : s === 'over' ? 'late' : false; }, null, { polling: 'raf', timeout: 6000 }).then(h => h.jsonValue(), () => 'timeout');
    check('best score is saved as soon as the run ends', atEnd === '41', atEnd);
    await until(P, () => __game.state().state === 'over');

    // more achievements; stats overlay closes from the backdrop
    await tap(P, '#oMenu'); await until(P, () => __game.state().state === 'title');
    await tap(P, '#bStats'); await sleep(200);
    const nAch = await P.page.evaluate(() => document.querySelectorAll('#statsBody .ach').length);
    check('at least 12 achievements', nAch >= 12, nAch);
    await T(P, 'touchStart', [{ x: 8, y: 8, id: 4 }]); await sleep(30); await T(P, 'touchEnd', [{ x: 8, y: 8, id: 4 }]); await sleep(200);
    check('tapping the backdrop closes the stats card', !(await visible(P, 'statsOv')));
    check('no mode was changed by a ghost click', (await st(P)).mode === 'classic');
    await P.ctx.close();

    // ================= rotation / resize mid-game =================
    P = await open(390, 844);
    await startClassic(P);
    await P.page.evaluate(() => { __game.jump(40); for (const [x, y] of [[60, 300], [330, 420], [200, 620], [350, 760]]) __game.place('orange', x, y); __game.place('apple', 300, 700, -900); });
    await P.page.setViewportSize({ width: 844, height: 390 });
    const paused = await until(P, () => __game.state().paused, null, 3000);
    await until(P, () => __game.snap().W === 844, null, 3000);
    let sn = await P.page.evaluate(() => __game.snap()); g = await st(P);
    const inside = sn.items.every(i => i.x > 0 && i.x < sn.W && i.y < sn.H + i.r);
    check('rotating mid-game pauses and keeps every fruit on screen', paused && inside && g.lives === 3 && g.misses === 0, `paused ${paused}, lives ${g.lives}, misses ${g.misses}, items ${sn.items.map(i => Math.round(i.x) + ',' + Math.round(i.y)).join(' ')}`);
    await tap(P, '#pResume'); await until(P, () => !__game.state().paused);
    await sleep(300); g = await st(P);
    check('…and resuming in landscape costs no leaf', g.lives === 3 && g.misses === 0, `lives ${g.lives}, misses ${g.misses}`);
    await P.page.setViewportSize({ width: 390, height: 844 });
    await until(P, () => __game.snap().W === 390, null, 3000);
    sn = await P.page.evaluate(() => __game.snap());
    check('rotating back keeps fruit inside the narrow screen', sn.items.filter(i => i.kind === 'orange').length === 4 && sn.items.every(i => i.x > 0 && i.x < 390), sn.items.map(i => Math.round(i.x)).join(' '));
    if ((await st(P)).paused) { await tap(P, '#pResume'); await until(P, () => !__game.state().paused); }

    // share card in landscape: 關閉 visible without scrolling, backdrop closes it
    await P.page.setViewportSize({ width: 844, height: 390 });
    await until(P, () => __game.snap().W === 844, null, 3000);
    if ((await st(P)).paused) { await tap(P, '#pResume'); await until(P, () => !__game.state().paused); }
    await P.page.evaluate(() => { __game.clear(); __game.jump(25); __game.set({ lives: 1, score: 12, grace: 0 }); __game.place('apple', 420, 380, 300); });
    await until(P, () => __game.state().state === 'over', null, 8000);
    await tap(P, '#oShare');
    await until(P, () => !document.getElementById('shareOv').classList.contains('hidden') && document.getElementById('shareImg').complete && document.getElementById('shareImg').naturalWidth > 0, null, 5000);
    const sc = await box(P, '#shClose');
    check('844×390 share card: 關閉 fully on screen', sc.b <= 390 && sc.t >= 0, `bottom ${Math.round(sc.b)}`);
    const im = await box(P, '#shareImg');
    check('844×390 share card: image sits beside the text, readable size', im.w >= 180 && im.r <= sc.l + 1 && im.b <= 390, `${Math.round(im.w)}×${Math.round(im.h)}`);
    await T(P, 'touchStart', [{ x: 10, y: 200, id: 5 }]); await sleep(30); await T(P, 'touchEnd', [{ x: 10, y: 200, id: 5 }]); await sleep(200);
    check('tapping outside the share card closes it', !(await visible(P, 'shareOv')));
    await P.ctx.close();

    // ================= 320 x 568 HUD =================
    P = await open(320, 568);
    await startClassic(P);
    await P.page.evaluate(() => __game.jump(300)); await sleep(150);
    const hb = await P.page.evaluate(() => [...document.querySelectorAll('.scard,.dpill,.lives,#bPause')].map(e => e.getBoundingClientRect()).map(b => [b.left, b.right]));
    let ov = false; for (let i = 0; i + 1 < hb.length; i++) if (hb[i][1] > hb[i + 1][0] + 0.5) ov = true;
    await P.page.evaluate(() => __game.place('peach', 160, 300)); await sleep(50);
    const tb = await P.page.evaluate(() => { const e = document.getElementById('toast'), b = e.getBoundingClientRect(); return { h: e.offsetHeight, l: b.left, r: b.right, t: e.textContent }; });
    await P.page.evaluate(() => __game.place('ice', 160, 300)); await sleep(50);
    const tb2 = await P.page.evaluate(() => document.getElementById('toast').offsetHeight);
    check('320 wide: first-time tips fit on one line', tb.h < 44 && tb2 < 44 && tb.l >= 0 && tb.r <= 320, `${tb.t} h ${tb.h}/${tb2}`);
    check('320 wide: HUD boxes do not overlap', !ov && hb[hb.length - 1][1] <= 320, JSON.stringify(hb.map(b => b.map(Math.round))));
    await P.ctx.close();

    // saved data under the old keys still loads
    P = await open(390, 844);
    await P.page.evaluate(() => { localStorage.setItem('fruitslash.best', '77'); localStorage.setItem('fruitslash.stats', JSON.stringify({ games: 3, slices: 50, per: { melon: 5 }, maxCombo: 4, nuts: 1, misses: 2, bestTimed: 30, bestZen: 20, daily: { date: '', best: 0 }, ach: { six: 1 }, playSec: 100 })); localStorage.setItem('fruitslash.settings', JSON.stringify({ blade: 'spark', board: 'marble', muted: true, mode: 'timed' })); });
    await P.page.reload(); await P.page.waitForFunction(() => window.__game);
    const desc = await P.page.textContent('#mDesc'), md = (await st(P)).mode;
    await tap(P, '#bStats'); await sleep(150);
    const body = await P.page.textContent('#statsBody');
    check('old saved data (best, stats, settings) still loads', md === 'timed' && desc.includes('30') && body.includes('77') && body.includes('50'), md + ' / ' + desc);
    await P.ctx.close();
  } catch (e) { check('test run', false, String(e && e.stack || e).slice(0, 400)); }
  check('no page / console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
