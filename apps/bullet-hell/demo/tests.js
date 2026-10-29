// Tests for 彈幕射擊 (bullet-hell): pools, bullet physics, scoring, difficulty, every boss pattern, stage timelines,
// then the page in Chromium with real CDP touch for the 9.5 release re-review fixes (run checkpoints + resume,
// pagehide flush, storage validation, rotation pause, safe-area HUD, lost-finger pickup, result-screen tap guard,
// frame-rate independent stepping).
// Usage: node tests.js   (about 20 s)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  ';return {FW,TAU,DIFFS,EXTENDS,PLAYER,Pool,every,clampPos,aimAt,pointValue,captureBonus,nextExtend,setBullet,stepBullet,hitTest,grazeTest,ring,fan,BOSSES,stageWaves,STAGE_NAMES};')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const mkB = () => ({ x: 0, y: 0, vx: 0, vy: 0, a: 0, sp: 0, r: 4, c: 0, kind: 0, p1: 0, p2: 0, p3: 0, t: 0, grazed: false, ph: 0, bx: 0, by: 0, ax: 0 });
const FH = 480;

// --- object pool ---
{
  const p = new C.Pool(3, () => ({ id: 0 }));
  p.items.forEach((o, i) => o.id = i);
  const a = p.get(), b = p.get(), c = p.get();
  ok(a && b && c && p.get() === null && p.n === 3, 'pool hands out exactly its capacity, then null');
  p.kill(0);
  ok(p.n === 2 && p.items[0] === c && p.items[2] === a, 'kill swaps the last live object into the freed slot');
  ok(p.get() === a && p.n === 3, 'freed object is reused (no allocation)');
  p.clear(); ok(p.n === 0 && p.get() === c, 'clear frees everything');
}
// --- every() ---
{
  const ps = {};
  ok(C.every(ps, 'k', 0.2, 1 / 60) === 1, 'first call of an interval fires immediately');
  let n = 0; for (let i = 0; i < 40; i++) n += C.every(ps, 'k', 0.2, 0.05);
  ok(n >= 9 && n <= 11, 'about ten more triggers over two seconds at 0.2 s, got ' + n);
  const ps2 = {}; C.every(ps2, 'x', 0.01, 0.01); ok(C.every(ps2, 'x', 0.01, 0.1) >= 9, 'a long step yields several triggers');
}
// --- movement clamp, scoring ---
{
  ok(C.clampPos(-50, -50, FH)[0] === 8 && C.clampPos(-50, -50, FH)[1] === 12, 'clamp top-left');
  ok(C.clampPos(999, 999, FH)[0] === C.FW - 8 && C.clampPos(999, 999, FH)[1] === FH - 12, 'clamp bottom-right');
  ok(C.pointValue(0) === 1000 && C.pointValue(100) === 2000 && C.pointValue(10000) === 5000, 'point item value grows with graze and caps at 5000');
  const full = C.captureBonus(0, 30, 30), half = C.captureBonus(0, 15, 30), none = C.captureBonus(0, 0, 30);
  ok(full > half && half > none && none > 0 && full % 100 === 0, 'capture bonus rewards remaining time, rounded to 100');
  ok(C.captureBonus(2, 30, 30) > C.captureBonus(0, 30, 30), 'later stages pay more');
  ok(!C.nextExtend(499999, 0) && C.nextExtend(500000, 0) && !C.nextExtend(500000, 1) && C.nextExtend(1200000, 1) && !C.nextExtend(9e9, 2), 'extends at 500k and 1.2M, only once each');
ok(C.PLAYER.save >= 0.2 && C.PLAYER.save <= 0.25, 'the save-yourself window after a hit is 0.2–0.25 s (human reaction time)');
ok(C.DIFFS[0].autoBomb === true && !C.DIFFS[1].autoBomb && !C.DIFFS[2].autoBomb && !C.DIFFS[3].autoBomb, 'only 簡單 has the auto-bomb guard');
ok(C.DIFFS.every(d => d.blurb && d.blurb.indexOf((d.lives + 1) + ' 條命') === 0 && d.blurb.indexOf('炸彈 ' + d.bombs) > 0), 'difficulty blurbs state the real lives and bombs');
  ok(Math.abs(C.aimAt(0, 0, 0, 10) - Math.PI / 2) < 1e-9, 'aimAt points straight down for a target below');
}
// --- difficulty table ---
{
  for (let i = 1; i < C.DIFFS.length; i++) ok(C.DIFFS[i].dens > C.DIFFS[i - 1].dens && C.DIFFS[i].spd > C.DIFFS[i - 1].spd && C.DIFFS[i].hp > C.DIFFS[i - 1].hp, 'difficulty ' + i + ' is harder than ' + (i - 1));
  ok(C.DIFFS.length === 4 && C.DIFFS.every(d => d.lives >= 2 && d.bombs >= 2) && C.DIFFS[3].bombs < C.DIFFS[2].bombs && C.DIFFS[3].dens > C.DIFFS[2].dens, 'four difficulties with lives and bombs; 地獄 has fewer bombs and denser patterns than 困難');
}
// --- bullet physics ---
{
  const b = C.setBullet(mkB(), 100, 100, 0, 60, 4, 1, 0);
  C.stepBullet(b, 0.5, 0, 0, FH);
  ok(Math.abs(b.x - 130) < 1e-9 && Math.abs(b.y - 100) < 1e-9, 'straight bullet moves at its speed');
  ok(C.stepBullet(C.setBullet(mkB(), 100, FH + 30, 0, 0, 4, 1, 0), 0.016, 0, 0, FH) === false, 'bullet below the field is dropped');
  ok(C.stepBullet(C.setBullet(mkB(), 100, -30, Math.PI / 2, 10, 4, 1, 0), 0.016, 0, 0, FH) === true, 'bullet just above the field (spawning) is kept');
  const g = C.setBullet(mkB(), 100, 0, Math.PI / 2, 20, 6, 3, 1, 100);
  for (let i = 0; i < 60; i++) C.stepBullet(g, 1 / 60, 0, 0, FH);
  ok(Math.abs(g.vy - 120) < 1e-6 && g.y > 60 && g.y < 80, 'gravity bullet accelerates downward');
  const cv = C.setBullet(mkB(), 180, 100, 0, 80, 4, 2, 2, 1.0);
  for (let i = 0; i < 60; i++) C.stepBullet(cv, 1 / 60, 0, 0, FH);
  ok(Math.abs(cv.a - 1.0) < 1e-6 && Math.abs(Math.hypot(cv.vx, cv.vy) - 80) < 1e-6, 'curving bullet turns at its angular velocity, keeps speed');
  // stop & re-aim
  const sg = C.setBullet(mkB(), 180, 100, 0, 150, 5, 2, 3, 0.5, 0.6, 120);
  for (let i = 0; i < 30; i++) C.stepBullet(sg, 1 / 60, 180, 400, FH);
  const xAfterMove = sg.x; ok(xAfterMove > 250, 'stop-go bullet moves first');
  for (let i = 0; i < 30; i++) C.stepBullet(sg, 1 / 60, 180, 400, FH);
  ok(Math.abs(sg.x - xAfterMove) < 3 && sg.vx === 0, 'then it freezes');
  for (let i = 0; i < 8; i++) C.stepBullet(sg, 1 / 60, 180, 400, FH);
  const want = C.aimAt(sg.x, sg.y, 180, 400);
  ok(sg.kind === 0 && Math.abs(sg.a - want) < 1e-6 && Math.abs(sg.sp - 120) < 1e-9, 'then relaunches aimed at the player at the new speed');
  const sg2 = C.setBullet(mkB(), 180, 100, 0, 150, 5, 2, 3, 0.1, 0.1, 120); sg2.ax = 0.4;
  for (let i = 0; i < 30; i++) C.stepBullet(sg2, 1 / 60, 180, 400, FH);
  ok(Math.abs(sg2.a - (C.aimAt(sg2.x, sg2.y, 180, 400) + 0.4)) < 0.05, 'ax offsets the re-aim angle');
  const sw = C.setBullet(mkB(), 100, 0, Math.PI / 2, 60, 4, 1, 4, 20, 2);
  let maxDx = 0; for (let i = 0; i < 120; i++) { C.stepBullet(sw, 1 / 60, 0, 0, FH); maxDx = Math.max(maxDx, Math.abs(sw.x - 100)); }
  ok(Math.abs(sw.by - 120) < 1e-6 && maxDx > 15 && maxDx <= 20.0001, 'sway bullet oscillates sideways around its path');
  ok(C.setBullet(mkB(), 0, 0, 0, 1, 1, 1, 0).ax === 0, 'setBullet resets the re-aim offset of a reused bullet');
}
// --- collision ---
{
  const b = C.setBullet(mkB(), 100, 100, 0, 0, 5, 1, 0);
  ok(C.hitTest(b, 100, 105, 2.6) && !C.hitTest(b, 100, 108, 2.6), 'hit uses a forgiving bullet radius plus the hitbox');
  ok(C.grazeTest(b, 100, 118, 15) && !C.grazeTest(b, 100, 121, 15), 'graze ring is bullet radius plus graze radius');
}
// --- boss patterns: every pattern on every difficulty emits sane, fair bullets and fits the pool ---
{
  let total = 0;
  const pl = { x: 180, y: 420 };
  for (const [bi, boss] of C.BOSSES.entries()) for (const [pi, pat] of boss.patterns.entries()) for (const D of [C.DIFFS[0], C.DIFFS[3]]) {
    const label = boss.name + '/' + pat.name + '/' + D.key;
    const live = [], ps = {}, perSec = []; let emitted = 0, bad = 0, nearSpawn = 0, peak = 0, badSpeed = 0;
    const E = (x, y, a, sp, r, c, kind, p1, p2, p3) => {
      const b = C.setBullet(mkB(), x, y, a, sp, r, c, kind, p1, p2, p3); live.push(b); emitted++;
      if (![x, y, a, sp, r].every(Number.isFinite) || r < 3 || r > 8 || c < 0 || c > 7 || kind < 0 || kind > 4) bad++;
      if (sp < 18 || sp > 420) badSpeed++;
      if (Math.hypot(x - pl.x, y - pl.y) < 60) nearSpawn++;
      return b;
    };
    const b = { x: 180, y: 96 };
    const T = Math.min(pat.time, 24), dt = 1 / 60; let sec = 0;
    for (let t = 0; t < T; t += dt) {
      b.x = 180 + Math.sin(t * 0.55) * 90;
      const before = emitted; pat.fn(b, t, dt, ps, D, pl, E); sec += emitted - before;
      for (let i = live.length - 1; i >= 0; i--) if (!C.stepBullet(live[i], dt, pl.x, pl.y, FH)) { live[i] = live[live.length - 1]; live.pop(); }
      peak = Math.max(peak, live.length);
      if (Math.floor(t) !== Math.floor(t + dt)) { perSec.push(sec); sec = 0; }
    }
    total += emitted;
    ok(emitted > 20, label + ' emits bullets (' + emitted + ')');
    ok(bad === 0, label + ' all bullets have sane radius/colour/kind');
    ok(badSpeed === 0, label + ' bullet speeds within 18..420 (' + badSpeed + ' outside)');
    ok(nearSpawn === 0, label + ' never spawns a bullet within 60 units of the player');
    ok(peak < 1100, label + ' peak concurrent bullets ' + peak + ' fits the 1600 pool with headroom');
    ok(Math.max(...perSec) <= 320, label + ' bullets per second capped (' + Math.max(...perSec) + ')');
  }
  ok(total > 5000, 'patterns produced plenty of bullets overall: ' + total);
  const spells = C.BOSSES.reduce((n, b) => n + b.patterns.filter(p => p.spell).length, 0);
  ok(C.BOSSES.length === 3 && spells === 7 && C.BOSSES[2].patterns.length === 4, 'three bosses, seven spell cards, final boss has four patterns');
  ok(C.BOSSES.every(b => b.patterns.every(p => p.hp > 0 && p.time >= 30 && ['sway', 'hop'].includes(p.move))), 'every pattern has hp, a time limit and a movement style');
}
// --- stage timelines ---
{
  for (let s = 0; s < 3; s++) {
    const st = C.stageWaves(s);
    ok(st.waves.every((w, i) => i === 0 || w.t >= st.waves[i - 1].t), 'stage ' + (s + 1) + ' waves are in time order');
    ok(st.waves.every(w => w.t < st.bossAt - 3) && st.waves.every(w => ['wisp', 'swarm', 'lantern'].includes(w.kind)), 'stage ' + (s + 1) + ' waves end before the boss and use known kinds');
    ok(st.waves.every(w => w.m === 1 + s * 0.5), 'stage ' + (s + 1) + ' enemies scale with the stage');
  }
  ok(C.stageWaves(2).waves.length > C.stageWaves(1).waves.length && C.stageWaves(1).waves.length > C.stageWaves(0).waves.length, 'later stages have more waves');
  ok(C.STAGE_NAMES.length === C.BOSSES.length, 'one name per stage');
}

// ---------------- the page, with real touch ----------------
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const errors = [];
  const KEY = 'bullet-hell:v1:';
  async function open(w = 390, h = 844, ctx) {
    ctx = ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL); await p.waitForFunction(() => window.__game);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: q[2] || i + 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async sel => { const c = await center(sel); await touch('touchStart', [c]); await touch('touchEnd', []); await frames(); };
    const st = () => p.evaluate(() => window.__game.state());
    const ls = k => p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY + k);
    const vis = sel => p.$eval(sel, e => !e.classList.contains('hidden') && !e.closest('.hidden'));
    return { ctx, p, touch, tap, frames, center, st, ls, vis };
  }

  // 1. checkpoints: saved at stage and pattern starts, flushed on pagehide without handing back lives, resumed from the title
  {
    const t = await open();
    ok(!(await t.vis('#bLoad')), 'no 繼續上次 button without a saved run');
    await t.p.evaluate(() => window.__game.start(2));
    let ck = await t.ls('run');
    ok(ck && ck.d === 2 && ck.stage === 0 && ck.pat === -1 && ck.score === 0 && ck.lives === 3, 'starting a run saves a stage-1 checkpoint: ' + JSON.stringify(ck));
    await t.p.evaluate(() => { window.__game.hold(true); window.__game.god(true); window.__game.skipToBoss(); window.__game.tick(200); window.__game.skipPattern(); window.__game.tick(400); });
    let s = await t.st();
    ck = await t.ls('run');
    ok(s.boss && s.boss.idx === 1 && ck.pat === 1 && ck.spells === 0 && ck.score > 0 && ck.score <= s.score, 'a boss pattern start saves a checkpoint (pattern 1, score ' + (ck && ck.score) + ', spells counted before it)');
    const ckScore = ck.score;
    await t.p.evaluate(() => { window.__game.god(false); window.__game.die(); window.__game.tick(5); window.dispatchEvent(new Event('pagehide')); });
    s = await t.st(); ck = await t.ls('run');
    ok(s.lives === 2 && ck.lives === 2 && ck.score === ckScore, 'pagehide after losing a life saves the lower lives, keeps the checkpoint score');
    ok((await t.ls('hi')).hard === s.score, 'pagehide banks the run score as the 困難 high score');
    await t.p.reload(); await t.p.waitForFunction(() => window.__game);
    ok(await t.vis('#bLoad'), 'after a reload the title offers 繼續上次');
    const label = await t.p.textContent('#loadInfo');
    ok(/困難/.test(label) && /第一面/.test(label) && /妖符「迴旋狐尾」/.test(label) && label.includes(ckScore.toLocaleString('en-US')), 'the button names difficulty, stage, spell and score: ' + label);
    ok(await t.p.$eval('#bStart', e => e.classList.contains('sec')), '開始遊戲 steps back to a secondary button while a save exists');
    await t.tap('#bLoad');
    s = await t.st();
    ok(s.st === 'boss' && s.stage === 0 && s.score === ckScore && s.lives === 2 && !s.practice, 'tapping it resumes stage 1 boss with the saved score and lives');
    await t.p.evaluate(() => { window.__game.hold(true); window.__game.god(true); window.__game.tick(150); });
    s = await t.st();
    ok(s.boss.idx === 1 && s.boss.name === '妖符「迴旋狐尾」' && s.spells === 1, 'the saved spell starts again (attempt counted once)');
    ok((await t.ls('diff')) === 2, 'the resumed run brings its difficulty back to the title');

    // 回主選單 keeps the save; a spell practice never overwrites it
    await t.p.evaluate(() => window.__game.pause()); await t.tap('#bMenu');
    ok(await t.vis('#bLoad') && (await t.ls('run')).pat === 1, '回主選單 keeps the run for 繼續上次');
    await t.tap('#bPrac'); await t.tap('#pList .prow:not([disabled])');
    s = await t.st();
    ok(s.practice && s.st === 'boss' && (await t.ls('run')).pat === 1 && (await t.ls('run')).stage === 0, 'a spell practice leaves the saved run alone');

    // game over clears the save, 續關 writes it back, a new game replaces it
    await t.p.evaluate(() => window.__game.pause()); await t.tap('#bMenu'); await t.tap('#bLoad');
    await t.p.evaluate(() => { window.__game.hold(true); window.__game.lives(0); window.__game.die(); window.__game.tick(120); });
    ok((await t.st()).st === 'over' && (await t.ls('run')) === null, 'game over clears the saved run');
    // the result screen ignores taps for a moment (a finger still hammering bomb/field must not choose for you)
    await t.tap('#bAgain');
    ok((await t.st()).st === 'over', 'a tap in the first instant of the result screen does nothing');
    await t.p.waitForTimeout(500);
    await t.tap('#bContinue');
    s = await t.st(); ck = await t.ls('run');
    ok(s.st === 'boss' && s.conts === 1 && ck && ck.conts === 1 && ck.score === 1 && ck.lives === 3 && ck.pat === 1, '續關 saves the continued run again: ' + JSON.stringify(ck));
    await t.p.evaluate(() => window.__game.pause()); await t.tap('#bRestart');
    ck = await t.ls('run');
    ok(ck.stage === 0 && ck.pat === -1 && ck.conts === 0 && ck.score === 0, '重新開始 replaces the save with the new run');
    await t.ctx.close();
  }

  // 2. damaged storage never breaks the title
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(K => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', 1);
      localStorage.setItem(K + 'hi', JSON.stringify({ normal: 'abc', hard: -5, easy: 1234.7 }));
      localStorage.setItem(K + 'run', JSON.stringify({ v: 1, d: 1, stage: 5, pat: 0, score: 10 }));
      localStorage.setItem(K + 'clears', '"lots"'); localStorage.setItem(K + 'diff', '1.5');
    }, KEY);
    const t = await open(390, 844, ctx);
    ok(await t.p.textContent('#tBest') === '0' && await t.p.textContent('#tClears') === '0', 'junk high score / clears show 0');
    ok(!(await t.vis('#bLoad')) && (await t.ls('run')) === null, 'an invalid saved run is dropped, no 繼續上次');
    ok(await t.p.$eval('#diffs [aria-checked="true"]', e => e.textContent) === '普通', 'a fractional difficulty falls back to 普通');
    await t.p.click('.diff:nth-child(1)');
    ok(await t.p.textContent('#tBest') === '1,234', 'a valid entry next to junk survives (簡單 1,234)');
    await ctx.close();
  }

  // 3. rotation pauses, a toolbar height change does not; the HUD follows the top safe area
  {
    const t = await open();
    await t.p.evaluate(() => window.__game.start(1)); await t.frames();
    await t.p.setViewportSize({ width: 390, height: 760 }); await t.frames();
    ok((await t.st()).st === 'stage', 'a height-only resize (Safari toolbar) keeps playing');
    await t.p.setViewportSize({ width: 844, height: 390 }); await t.frames();
    let s = await t.st();
    ok(s.st === 'paused' && await t.vis('#pause'), 'turning the phone mid-run pauses');
    ok(s.pl.x >= 8 && s.pl.x <= 352 && s.pl.y >= 12 && s.pl.y <= s.FH - 12, 'the crane stays inside the reshaped field');
    await t.tap('#bResume'); ok((await t.st()).st === 'stage', '繼續 resumes in landscape');
    await t.p.setViewportSize({ width: 390, height: 844 }); await t.frames();
    await t.p.evaluate(() => { document.documentElement.style.setProperty('--sat', '47px'); dispatchEvent(new Event('resize')); });
    s = await t.st();
    ok(Math.abs(s.hudTop - (8 + 47 / s.S)) < 0.01, 'HUD moves below a 47 px top safe area (top ' + s.hudTop.toFixed(1) + ' field units)');
    const pb = await t.p.$eval('#bPause', e => e.getBoundingClientRect().top);
    ok(Math.abs(s.hudTop * s.S - pb) < 1, 'HUD top lines up with the pause button (' + (s.hudTop * s.S).toFixed(1) + ' vs ' + pb + ')');
    await t.ctx.close();
  }

  // 4. a finger the page lost track of (window blur mid-drag) is picked up again on its next move
  {
    const t = await open();
    await t.p.evaluate(() => { window.__game.start(1); window.__game.god(true); }); await t.frames();
    await t.p.evaluate(() => window.__game.hold(true));
    let s = await t.st(); const y0 = s.pl.y;
    await t.touch('touchStart', [[200, 600]]); await t.touch('touchMove', [[200, 560]]); await t.frames();
    s = await t.st(); const y1 = s.pl.y;
    ok(y1 < y0 - 30, 'a drag moves the crane (' + y0.toFixed(0) + ' → ' + y1.toFixed(0) + ')');
    await t.p.evaluate(() => dispatchEvent(new Event('blur')));
    await t.touch('touchMove', [[200, 540]]); await t.touch('touchMove', [[200, 500]]); await t.frames();
    s = await t.st();
    ok(s.pl.y < y1 - 30, 'after a window blur the same finger keeps steering (' + y1.toFixed(0) + ' → ' + s.pl.y.toFixed(0) + ')');
    await t.touch('touchEnd', []); await t.frames();
    await t.touch('touchStart', [[100, 600]]); await t.touch('touchMove', [[140, 600]]); await t.frames();
    s = await t.st();
    ok(!s.focus, 'the re-adopted finger was released on lift (a new finger is not counted as two)');
    await t.touch('touchEnd', []);
    await t.ctx.close();
  }

  // 5. frame-rate independence: the same second of play at 24, 60 and 144 Hz
  {
    const t = await open();
    await t.p.evaluate(() => { window.__game.start(1); window.__game.god(true); window.__game.hold(true); });
    const run = fps => t.p.evaluate(fps => {
      const g = window.__game; g.start(1); g.god(true); g.hold(true);
      g.item(60, 120, 1, 60);
      const n = Math.round(fps), t0 = g.state();
      for (let i = 0; i < n; i++) g.advance(1 / fps);
      const s = g.state(), it = s.items[s.items.length - 1];
      return { x: it[0], y: it[1], t: s.t - t0.t };
    }, fps);
    const r24 = await run(24), r60 = await run(60), r144 = await run(144);
    ok(Math.abs(r24.x - r60.x) < 0.6 && Math.abs(r144.x - r60.x) < 0.6, 'item drift is the same at 24/60/144 Hz (x ' + [r24, r60, r144].map(r => r.x.toFixed(2)).join(' / ') + ')');
    ok(Math.abs(r24.y - r60.y) < 1.5 && Math.abs(r144.y - r60.y) < 1.5, 'item fall is the same at 24/60/144 Hz (y ' + [r24, r60, r144].map(r => r.y.toFixed(2)).join(' / ') + ')');
    ok([r24, r60, r144].every(r => Math.abs(r.t - 1) < 0.01), 'a second of frames advances the stage clock by one second at every rate');
    // a 24 Hz frame runs as three 1/72 s updates: a shot (900 units/s) moves 12.5 units per update, so it can't skip
    // over a swarmer 21 units across (one 1/48 s step would move it 18.75, two 1/24 s halves used to allow 22.5 at 20 Hz)
    const steps = await t.p.evaluate(() => { const g = window.__game, a = g.updates(); g.advance(1 / 24); const b = g.updates(); g.advance(1 / 144); return [b - a, g.updates() - b]; });
    ok(steps[0] === 3 && steps[1] === 1, 'frames are split into ≤1/60 s updates: 24 Hz → 3, 144 Hz → 1 (' + steps + ')');
    await t.ctx.close();
  }

  ok(/自動存檔/.test(html) && /繼續上次/.test(html), 'help explains the autosave and 繼續上次');
  ok(errors.length === 0, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
