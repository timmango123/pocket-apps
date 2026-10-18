// Core tests for 彈幕射擊 (bullet-hell): pools, bullet physics, scoring, difficulty, every boss pattern, stage timelines.
// Usage: node tests.js
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
  ok(!C.nextExtend(999999, 0) && C.nextExtend(1000000, 0) && !C.nextExtend(1000000, 1) && C.nextExtend(3000000, 1) && !C.nextExtend(9e9, 2), 'extends at 1M and 3M, only once each');
  ok(Math.abs(C.aimAt(0, 0, 0, 10) - Math.PI / 2) < 1e-9, 'aimAt points straight down for a target below');
}
// --- difficulty table ---
{
  for (let i = 1; i < C.DIFFS.length; i++) ok(C.DIFFS[i].dens > C.DIFFS[i - 1].dens && C.DIFFS[i].spd > C.DIFFS[i - 1].spd && C.DIFFS[i].hp > C.DIFFS[i - 1].hp, 'difficulty ' + i + ' is harder than ' + (i - 1));
  ok(C.DIFFS.length === 4 && C.DIFFS.every(d => d.lives >= 2 && d.bombs >= 3), 'four difficulties, each with lives and bombs');
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
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
