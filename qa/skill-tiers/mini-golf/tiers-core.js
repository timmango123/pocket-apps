// Skill-tier decision layer for mini-golf (per qa/skill-tiers/SPEC.md), shared by the sim sweep and the real-page bots.
const L = require('./lib.js'); const C = L.C;
const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, random: 0.5, plan: 'greedy', attempts: 5 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, random: 0.15, plan: 'greedy', attempts: 3 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, random: 0, plan: 'look2', attempts: 3 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, random: 0, plan: 'search3', attempts: 3 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, random: 0, plan: 'search4', attempts: 3 },
};
// The game draws the predicted path while you drag (full path to hole 60, first 40% after), so a human corrects the
// pull while aiming: the SPEC position sigma is applied as release jitter at 1/4 of the tap sigma (documented in limits).
const POS_SCALE = 0.25;
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// returns {ang,pow,t} (t = intended start tick, for moving parts), or null
function plan(tier, Lv, S, left, r) {
  const T = TIERS[tier];
  if (r() < T.mistake || r() < T.random) return { ang: r() * 2 * Math.PI - Math.PI, pow: 0.15 + r() * 0.85, t: S.t + 30, kind: 'random' };
  const dyn = Lv.dyn; let p = null;
  if (T.plan === 'greedy') p = C.solveLevel(Lv, { S0: S, maxDepth: 1, beam: 4, angStep: 5, phases: dyn ? 3 : 1, refine: 6, minWait: dyn ? 60 : 0, partial: true, pows: [0.15, 0.25, 0.36, 0.48, 0.6, 0.74, 0.88, 1] });
  else if (T.plan === 'look2') p = C.solveLevel(Lv, { S0: S, maxDepth: Math.min(2, left), beam: 6, angStep: 4, phases: dyn ? 4 : 1, refine: 8, minWait: dyn ? 60 : 0, partial: true });
  else {
    const maxD = T.plan === 'search3' ? 3 : 4;
    for (let d = 1; d <= Math.min(maxD, left) && !p; d++) p = C.solveLevel(Lv, { S0: S, maxDepth: d, robust: dyn, minWait: dyn ? 60 : 0, beam: dyn ? 8 : 10, angStep: dyn ? 4 : 3, phases: 6, refine: 16, pows: dyn ? [0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.85, 1] : undefined });
    if (!p) p = C.solveLevel(Lv, { S0: S, maxDepth: Math.min(2, left), beam: 6, angStep: 4, phases: dyn ? 4 : 1, refine: 8, minWait: dyn ? 60 : 0, partial: true });
  }
  if (!p) return { ang: r() * 2 * Math.PI - Math.PI, pow: 0.3 + r() * 0.5, t: S.t + 30, kind: 'noplan' };
  const s = p.shots[0]; return { ang: s[0], pow: s[1], t: s[2], kind: p.partial ? 'partial' : 'line' + p.strokes };
}
// apply motor noise to the pull (screen px) and timing (ticks at 120 Hz)
function noisy(tier, sh, r) {
  const T = TIERS[tier]; const len = sh.pow * C.PULLMAX; let ex = Math.cos(sh.ang) * len, ey = Math.sin(sh.ang) * len;
  const sp = T.pos * POS_SCALE; ex += gauss(r) * sp; ey += gauss(r) * sp; ex = Math.round(ex); ey = Math.round(ey);
  const d = C.dragToShot(ex, ey); const dt = T.tim ? Math.round(gauss(r) * T.tim * 0.12) : 0;
  return { ang: d.ang, pow: d.pow, t: sh.t + dt, cancel: d.cancel, ex, ey };
}
// one attempt in the pure sim (same core physics as the page)
function simAttempt(tier, n, seed) {
  const d = L.LEVELS[n - 1], Lv = C.buildLevel(d), r = rng(seed); let S = C.initState(Lv), strokes = 0; const lim = d.par + 4;
  while (strokes < lim) {
    const sh = plan(tier, Lv, S, lim - strokes, r); const ns = noisy(tier, sh, r);
    if (ns.cancel) continue;
    if (Lv.dyn) { let t = ns.t; while (t < S.t) t += Lv.P; S.t = t; } else S.t += 60;
    strokes++; const res = C.simShot(Lv, S, ns.ang, ns.pow, null);
    if (res === 2) return { cleared: true, strokes, par: d.par };
    if (res === 3) { strokes++; S.x = S.sx; S.y = S.sy; S.vx = S.vy = 0; }
  }
  return { cleared: false, strokes, par: d.par };
}
module.exports = { TIERS, plan, noisy, rng, gauss, simAttempt, POS_SCALE };
