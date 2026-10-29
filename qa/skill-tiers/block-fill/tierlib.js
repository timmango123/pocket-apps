// Skill-tier decision models for 榫卯木格 (block-fill), per qa/skill-tiers/SPEC.md. Pure functions over the game's own core.
// Turn-based with no timer: reaction time does not change outcomes, so tiers differ by decision quality, mistakes and motor error.
const { core } = require('./common');
const C = core();
const { SHAPES, canPlace, applyPlace, anyFit, aiEval, N } = C;

const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], posSd: 40, mistake: 0.15, think: [2500, 900] },
  casual:     { name: '普通', react: [400, 100], posSd: 20, mistake: 0.06, think: [1500, 500] },
  skilled:    { name: '熟練', react: [260, 50], posSd: 10, mistake: 0.02, think: [1000, 300] },
  world:      { name: '世界級', react: [180, 25], posSd: 4, mistake: 0.003, think: [700, 200] },
  superhuman: { name: '非人', react: [16, 0], posSd: 0, mistake: 0, think: [0, 0] },
};

function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss(R) { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

function legal(G) {
  const out = [];
  G.hand.forEach((p, s) => { if (p.used) return; const sh = SHAPES[p.id]; for (let r = 0; r + sh.h <= N; r++) for (let c = 0; c + sh.w <= N; c++) if (canPlace(G.b, sh, r, c)) out.push({ slot: s, r, c }); });
  return out;
}
function greedy1(G) {
  let best = null;
  for (const m of legal(G)) { const nb = G.b.slice(), res = applyPlace(nb, SHAPES[G.hand[m.slot].id], m.r, m.c, 1); const v = aiEval(nb, res.lines.length); if (!best || v > best.v) best = { ...m, v }; }
  return best;
}
// stronger board evaluation for the search tiers: holes, roughness, and how many of the 27 shapes still fit (big ones weigh more)
function quality(b) {
  let holes = 0, rough = 0, empty = 0;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    const i = r * N + c, f = b[i] ? 1 : 0;
    if (!f) { empty++; const u = r === 0 || b[i - N], d = r === N - 1 || b[i + N], l = c === 0 || b[i - 1], rr = c === N - 1 || b[i + 1]; if (u && d && l && rr) holes++; }
    if (c < N - 1 && f !== (b[i + 1] ? 1 : 0)) rough++;
    if (r < N - 1 && f !== (b[i + N] ? 1 : 0)) rough++;
  }
  let fit = 0; for (const sh of SHAPES) if (anyFit(b, sh)) fit += sh.cls === 2 ? 3 : sh.cls === 1 ? 1.5 : 0.5;
  return -holes * 4 - rough * 1 + fit * 2 + empty * 0.6;
}
// plan over the remaining pieces (all orders), beam-limited; returns first move of the best plan
function search(G, depth, beam) {
  const pieces = G.hand.map((p, s) => ({ s, p })).filter(x => !x.p.used);
  let best = null;
  function rec(b, left, d, gain, first) {
    if (!left.length || d === 0) {
      let v = quality(b) + gain * 0.8;
      for (const x of left) if (!anyFit(b, SHAPES[x.p.id])) v -= 80;
      if (!best || v > best.v) best = { ...first, v };
      return;
    }
    const seenId = {};
    for (let k = 0; k < left.length; k++) {
      const x = left[k], sh = SHAPES[x.p.id]; if (seenId[x.p.id]) continue; seenId[x.p.id] = 1;
      const rest = left.slice(0, k).concat(left.slice(k + 1)), cand = [];
      for (let r = 0; r + sh.h <= N; r++) for (let c = 0; c + sh.w <= N; c++) {
        if (!canPlace(b, sh, r, c)) continue;
        const nb = b.slice(), res = applyPlace(nb, sh, r, c, 1), n = res.lines.length;
        cand.push({ r, c, nb, g: sh.n + 10 * n * n, q: aiEval(nb, n) });
      }
      if (!cand.length) { if (!first) continue; let v = -1e6 + quality(b); if (!best || v > best.v) best = { ...first, v }; continue; }
      cand.sort((a, z) => z.q - a.q);
      for (const m of cand.slice(0, beam)) rec(m.nb, rest, d - 1, gain + m.g, first || { slot: x.s, r: m.r, c: m.c });
    }
  }
  rec(G.b, pieces, depth, 0, null);
  return best;
}
// one decision for a tier; returns {slot,r,c,kind}
function decide(tier, G, R) {
  const L = legal(G); if (!L.length) return null;
  const T = TIERS[tier];
  if (R() < T.mistake) return { ...L[Math.floor(R() * L.length)], kind: 'mistake' };
  if (tier === 'clumsy') { if (R() < 0.5) return { ...L[Math.floor(R() * L.length)], kind: 'random' }; return { ...greedy1(G), kind: 'greedy' }; }
  if (tier === 'casual') { if (R() < 0.15) return { ...L[Math.floor(R() * L.length)], kind: 'random' }; return { ...greedy1(G), kind: 'greedy' }; }
  if (tier === 'skilled') return { ...C.aiBest(G, true), kind: 'heur' };
  if (tier === 'world') return { ...search(G, 2, 8), kind: 'search2' };
  return { ...search(G, 3, 10), kind: 'search3' };
}
// motor error: a finger offset of sd px at cell size `cell` shifts the landing cell; returns the move that actually happens
// (null = the drop is invalid and the piece flies back, the player retries)
function motor(tier, G, m, cell, R) {
  const sd = TIERS[tier].posSd; if (!sd) return m;
  const dr = Math.round(gauss(R) * sd / cell), dc = Math.round(gauss(R) * sd / cell);
  if (!dr && !dc) return m;
  const sh = SHAPES[G.hand[m.slot].id], r = m.r + dr, c = m.c + dc;
  return canPlace(G.b, sh, r, c) ? { ...m, r, c, slipped: true } : null;
}
module.exports = { C, TIERS, rng, gauss, legal, greedy1, search, decide, motor, quality };
