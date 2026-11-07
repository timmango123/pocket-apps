// Skill-tier simulation (Node) for helix-drop, per qa/skill-tiers/SPEC.md. Uses the game's own CORE (tower generator,
// typeAt, gap/lava motion) extracted from index.html, and replicates the page's physics loop (update/physStep/hitLayer)
// line for line. Bots see the state at observation time, decide, then act after a reaction delay with motor error and a
// finger rotation-speed limit. Usage: node sim.js [runsPerTier] [mode endless|timed] [assist 0|1]
const fs = require('fs');
const html = fs.readFileSync(require('path').resolve(__dirname, '../../../apps/helix-drop/index.html'), 'utf8');
const HD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn HD;')();
const TIERS = {
  clumsy:     { rt: [650, 200], pos: 22, tim: 120, mis: 0.15, rand: 0.5, vmax: 250, predict: false, below: false, aware: false, margin: 0 },
  casual:     { rt: [400, 100], pos: 11, tim: 60,  mis: 0.06, rand: 0.15, vmax: 350, predict: false, below: false, aware: false, margin: 2 },
  skilled:    { rt: [260, 50],  pos: 5.5, tim: 30, mis: 0.02, vmax: 450, search: true, depth: 1, margin: 8 },
  world:      { rt: [180, 25],  pos: 2.2, tim: 12, mis: 0.003, vmax: 600, search: true, depth: 2, margin: 4 },
  superhuman: { rt: [16, 0],    pos: 0, tim: 0, mis: 0, vmax: 1500, search: true, depth: 2, margin: 0, exact: true }
};   // pos = 40/20/10/4 px finger error at 0.55 deg/px
function mul(s) { return HD.mulberry(s); }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function newRun(seed, mode, assist) { return { mode, tower: HD.makeTower(seed, assist), t: 0, rot: 0, by: HD.LAYER_GAP - HD.BOUNCE_H, vy: 0, next: 1, combo: 0, score: 0, layers: 0, maxCombo: 0, pierces: 0, dead: false, timeLeft: 60, over: false }; }
function clone(r) { return Object.assign({}, r); }
// --- page physics, copied from index.html physStep/hitLayer (no shield) ---
function physStep(r, h) {
  r.vy = Math.min(HD.VMAX, r.vy + HD.G * h);
  const ny = r.by + r.vy * h, ly = r.next * HD.LAYER_GAP;
  if (r.vy > 0 && r.by < ly && ny >= ly) return hit(r, r.tower.get(r.next), ly);
  r.by = ny; return null;
}
function hit(r, L, ly) {
  const a = HD.norm(90 - r.rot), tp = HD.typeAt(L, a, r.t);
  if (L.bonus) { r.score += 10; r.combo = 0; r.by = ly + 1; r.vy = -300; r.next++; r.layers++; return 'bonus'; }
  if (r.combo >= 3 && tp !== HD.GAP) { r.score += r.combo; r.pierces++; r.combo = 0; r.by = ly + 1; r.vy = -440; r.next++; r.layers++; return 'smash'; }
  if (tp === HD.GAP) { r.combo++; r.score += r.combo; if (r.combo > r.maxCombo) r.maxCombo = r.combo; r.by = ly + 1; r.next++; r.layers++; return 'gap'; }
  if (tp === HD.LAVA) { r.dead = true; return 'lava'; }
  r.combo = 0; r.by = ly; r.vy = -HD.V0; return 'bounce';
}
function step(r, dt, rotDelta) {   // one frame of update(): rotation from input first (input events land before rAF)
  r.rot = HD.norm(r.rot + rotDelta);
  r.t += dt; const steps = Math.ceil(dt / 0.006), h = dt / steps; const ev = [];
  for (let i = 0; i < steps && !r.dead; i++) { const e = physStep(r, h); if (e) ev.push(e); }
  if (r.mode === 'timed' && !r.dead) { r.timeLeft -= dt; if (r.timeLeft <= 0) r.over = true; }
  return ev;
}
// time until the ball reaches the plane of r.next (with VMAX), approx
function tToNext(r) { return HD.timeToPlane(r.by, r.vy, r.next * HD.LAYER_GAP); }
const typ = (L, a, t) => HD.typeAt(L, a, t);
// ---------- heuristic planner (clumsy..world) ----------
function plan(r, P, rnd, delay) {
  const a0 = HD.norm(90 - r.rot), L1 = r.tower.get(r.next), L2 = r.tower.get(r.next + 1), L3 = r.tower.get(r.next + 2);
  const tHit = tToNext(r), tL = P.predict ? r.t + tHit : r.t;
  const vHit = Math.min(HD.VMAX, r.vy + HD.G * tHit);
  const tL2 = P.predict ? r.t + tHit + HD.timeToPlane(0, vHit, HD.LAYER_GAP) : r.t;
  const reach = P.vmax * Math.max(0, tHit - delay);
  const pierce = r.combo >= 3;
  const isLava = (L, a, t, m) => [0, -m, m].some(d => typ(L, a + d, t) === HD.LAVA);
  function value(s) {
    const aL = P.aware ? a0 + Math.max(-reach, Math.min(reach, s)) : a0 + s;
    const m = P.margin;
    const g = typ(L1, aL, tL) === HD.GAP && (!m || (typ(L1, aL - m, tL) === HD.GAP && typ(L1, aL + m, tL) === HD.GAP));
    if (g || (pierce && !isLava(L1, aL, tL, 0) && false)) {
      let v = 100 - Math.abs(s) * 0.05;
      if (P.below && !L2.bonus && isLava(L2, aL, tL2, 8)) v -= 300;
      if (P.chain && !L2.bonus && typ(L2, aL, tL2) === HD.GAP && L3 && !L3.bonus && r.combo + 2 < 3 && isLava(L3, aL, tL2 + 0.12, 6)) v -= 250;
      return v;
    }
    if (pierce) { let v = 90 - Math.abs(s) * 0.05; if (P.below && !L2.bonus && isLava(L2, aL, tL2, 8)) v -= 300; return v; }
    if (typ(L1, aL, tL) === HD.GAP) return 60;   // gap edge
    if (isLava(L1, aL, tL, P.aware ? 7 : 4)) return -1000;
    if (P.predict && isLava(L1, aL, tL + 0.55, 8)) return -50;  // lava flowing in by the next bounce
    // safe: prefer near the real gap so the next bounce can reach it
    let dg = 360; for (let d = 0; d <= 180; d += 3) { if (typ(L1, aL + d, tL) === HD.GAP || typ(L1, aL - d, tL) === HD.GAP) { dg = d; break; } }
    return 50 - dg * 0.15 - Math.abs(s) * 0.03;
  }
  const cands = []; for (let s = -180; s <= 180; s += 3) cands.push(s);
  if (P.rand && rnd() < P.rand) {   // random legal move: any target that is not lava on screen now
    const ok = cands.filter(s => !isLava(L1, a0 + s, r.t, 0)); return ok[Math.floor(rnd() * ok.length)] || 0;
  }
  let best = 0, bv = -1e9; for (const s of cands) { const v = value(s); if (v > bv) { bv = v; best = s; } }
  return best;
}
// ---------- search planner (skilled / world / superhuman): simulate candidates with the real physics ----------
// The finger keeps its current motion for `delay` s (reaction), then turns toward a0+s at vmax. Each candidate is
// scored by the worst of s-m, s, s+m (m = the tier's motor-error margin), so it prefers spots that survive a miss.
function simulateCand(r, s, P, delay, carry, horizon) {
  const q = clone(r), t0 = q.t; let a = HD.norm(90 - q.rot), tgt = carry == null ? a : carry, gained = 0, switched = false;
  const sTarget = a + s;
  while (q.t - t0 < horizon) {
    if (!switched && q.t - t0 >= delay) { tgt = sTarget; switched = true; }
    const want = tgt - a, mv = Math.max(-P.vmax / 60, Math.min(P.vmax / 60, want)); a += mv;
    const ev = step(q, 1 / 60, -mv);
    if (q.dead) return { v: -1e6 + (q.t - t0) * 1000, q, a };
    let b = false; for (const e of ev) { if (e === 'bounce') b = true; else gained++; }
    if (b && switched) break;
  }
  return { v: gained * 100, q, a };
}
function safety(q) {   // after a bounce: how far is the nearest lava on the slab below, and how far the real gap
  const L = q.tower.get(q.next), a = HD.norm(90 - q.rot), tL = q.t + 0.55; let dl = 60, dg = 180;
  for (let d = 0; d <= 60; d += 3) if (HD.typeAt(L, a + d, tL) === HD.LAVA || HD.typeAt(L, a - d, tL) === HD.LAVA) { dl = d; break; }
  for (let d = 0; d <= 180; d += 4) if (HD.typeAt(L, a + d, tL) === HD.GAP || HD.typeAt(L, a - d, tL) === HD.GAP) { dg = d; break; }
  return dl * 0.6 - dg * 0.15;
}
function planSearch(r, P, delay, carryAbs) {
  const m = P.margin || 0, res = [];
  const carry = carryAbs == null ? null : HD.norm(90 - r.rot) + HD.sdiff(HD.norm(90 - r.rot), HD.norm(carryAbs));
  const cache = new Map(); const ev = s => { if (!cache.has(s)) { const x = simulateCand(r, s, P, delay, carry, 2.6); cache.set(s, x); } return cache.get(s); };
  for (let s = -180; s <= 180; s += 4) {
    const xs = (m ? [s - m, s, s + m] : [s]).map(ev);
    let v = Math.min(...xs.map(x => x.v)); const mid = xs[m ? 1 : 0];
    if (v > -1e5) v += safety(mid.q);
    res.push({ s, v: v - Math.abs(s) * 0.02, q: mid.q });
  }
  res.sort((a, b) => b.v - a.v);
  if (P.depth > 1) {   // second step for the best few
    for (const c of res.slice(0, 6)) {
      if (c.v < -1e5) continue; let b2 = -1e9;
      for (let s2 = -180; s2 <= 180; s2 += 10) { const B = simulateCand(c.q, s2, P, delay, null, 2.6); const v = B.v + (B.v > -1e5 ? safety(B.q) : 0); if (v > b2) b2 = v; }
      c.v2 = c.v + 0.8 * b2;
    }
    const top = res.slice(0, 6).filter(c => c.v2 != null).sort((a, b) => b.v2 - a.v2);
    if (top.length) return top[0].s;
  }
  return res[0].s;
}
function play(tier, seed, mode = 'endless', assist = false, cap = 600) {
  const P = TIERS[tier], rnd = mul(seed * 31 + 7), r = newRun(seed, mode, assist);
  let pending = null, target = null, nextObs = 0, a = HD.norm(90 - r.rot);
  const dt = 1 / 60; let deathInfo = null;
  while (!r.dead && !r.over && r.t < cap && r.next < 1500) {
    if (r.t >= nextObs && !pending) {
      const rt = Math.max(16, P.rt[0] + gauss(rnd) * P.rt[1]) / 1000;
      const delay = rt + Math.abs(gauss(rnd)) * P.tim / 1000;
      let s;
      if (P.search) s = rnd() < P.mis ? (rnd() * 2 - 1) * 150 : planSearch(r, P, P.exact ? 0 : delay, target);
      else if (rnd() < P.mis) s = (rnd() * 2 - 1) * 150;   // mistake: wrong direction / wrong spot
      else s = plan(r, P, rnd, delay);
      s += gauss(rnd) * P.pos;
      pending = { at: r.t + (P.exact ? 0 : delay), target: HD.norm(90 - r.rot) + s };
      nextObs = r.t + (P.exact ? 1 / 30 : rt);   // next look after one reaction time
    }
    if (pending && r.t >= pending.at) { target = pending.target; a = HD.norm(90 - r.rot); target = a + HD.sdiff(a, target); pending = null; }
    let mv = 0;
    if (target != null) { const cur = HD.norm(90 - r.rot), want = HD.sdiff(cur, HD.norm(target)); mv = Math.max(-P.vmax * dt, Math.min(P.vmax * dt, want)); if (Math.abs(want) < 0.01) target = null; }
    const ev = step(r, dt, -mv);
    if (r.dead) deathInfo = { layer: r.next, t: +r.t.toFixed(1) };
  }
  return { tier, seed, mode, assist, dead: r.dead, layersReached: r.next, layers: r.layers, score: r.score, maxCombo: r.maxCombo, pierces: r.pierces, time: +r.t.toFixed(1), end: r.dead ? 'lava' : r.over ? 'time' : 'cap', death: deathInfo };
}
module.exports = { HD, TIERS, play, newRun, step, plan, planSearch };
if (require.main === module) {
  const N = +(process.argv[2] || 5), mode = process.argv[3] || 'endless', assist = process.argv[4] === '1', only = process.argv[5];
  const out = {};
  for (const tier of Object.keys(TIERS)) {
    if (only && only !== tier) continue;
    const runs = []; const t0 = Date.now();
    for (let k = 1; k <= N; k++) runs.push(play(tier, 1000 + k * 97, mode, assist, tier === 'superhuman' ? 300 : 600));
    const L = runs.map(x => x.layers).sort((a, b) => a - b), Sc = runs.map(x => x.score).sort((a, b) => a - b);
    out[tier] = { runs, summary: { median: L[L.length >> 1], min: L[0], max: L[L.length - 1], scoreMedian: Sc[Sc.length >> 1], deaths: runs.filter(x => x.dead).length, deathLayers: runs.filter(x => x.dead).map(x => x.death.layer) } };
    console.log(tier.padEnd(11), mode, assist ? 'assist' : '', 'layers', JSON.stringify(L), 'scores', JSON.stringify(Sc), 'ends', runs.map(x => x.end[0]).join(''), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  fs.writeFileSync(__dirname + `/sim-${mode}${assist ? '-assist' : ''}${only ? '-' + only : ''}.json`, JSON.stringify(out, null, 1));
}
