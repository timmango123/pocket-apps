// Skill-tier policies for 吹牛骰 (liars-dice) per qa/skill-tiers/SPEC.md, written by the independent reviewer.
// A policy sees what a human at seat 0 sees (own hand, bid history, dice counts); superhuman also sees every hand.
// decide(tier, ctx, R) -> {act:'call'} | {act:'bid', q, f}
//   ctx: { LD, g (core game state), view (LD.viewFor(g,0)), model, grudge }
const TIERS = {
  clumsy: { react: [650, 200], pos: 40, time: 120, mistake: 0.15 },
  casual: { react: [400, 100], pos: 20, time: 60, mistake: 0.06 },
  skilled: { react: [260, 50], pos: 10, time: 30, mistake: 0.02 },
  world: { react: [180, 25], pos: 4, time: 12, mistake: 0.003 },
  superhuman: { react: [16, 0], pos: 0, time: 0, mistake: 0 }
};
function randomMove(LD, g, R) {
  const v = LD.viewFor(g, 0), cs = LD.candidates(v, 1);
  if (LD.last(g) && (R() < 0.35 || !cs.length)) return { act: 'call' };
  if (!cs.length) return { act: 'call' };
  const c = cs[Math.floor(R() * cs.length)]; return { act: 'bid', q: c.q, f: c.f };
}
// 1-step greedy from own dice only (exact tail probability of the hidden dice)
function greedy(LD, g, thr) {
  const l = LD.last(g), v = LD.viewFor(g, 0);
  if (l && LD.probFor(g, 0, l, l.wild) < thr) return { act: 'call' };
  const cs = LD.candidates(v, 0); if (!cs.length) return { act: 'call' };
  let best = null, bp = -1;
  for (const c of cs) { const w = LD.wildNow(g) && c.f !== 1; const p = LD.probFor(g, 0, c, w); if (p > bp + 1e-9 || (Math.abs(p - bp) < 1e-9 && c.q < best.q)) { bp = p; best = c; } }
  if (l && 1 - LD.probFor(g, 0, l, l.wild) > bp) return { act: 'call' };
  return { act: 'bid', q: best.q, f: best.f };
}
function perfect(LD, g) {
  const l = LD.last(g), sp = g.o.special;
  const count = (f, w) => LD.countAll(g, f, w).total;
  if (l && count(l.f, l.wild && l.f !== 1) < l.q) return { act: 'call' };
  const v = LD.viewFor(g, 0), cs = LD.candidates(v, 30);
  let best = null;
  for (const c of cs) { const w = LD.wildNow(g) && c.f !== 1; if (count(c.f, w) >= c.q && (!best || c.q > best.q || (c.q === best.q && LD.rank(c.f) > LD.rank(best.f)))) best = c; }
  if (best) return { act: 'bid', q: best.q, f: best.f };
  if (!cs.length) return { act: 'call' };
  // nothing true left: smallest deficit bluff
  let b2 = null, d2 = 99;
  for (const c of cs) { const w = LD.wildNow(g) && c.f !== 1, d = c.q - count(c.f, w); if (d < d2) { d2 = d; b2 = c; } }
  return { act: 'bid', q: b2.q, f: b2.f };
}
function decide(tier, ctx, R) {
  const { LD, g } = ctx, T = TIERS[tier];
  if (tier === 'superhuman') return perfect(LD, g);
  if (R() < T.mistake) return randomMove(LD, g, R);
  if (tier === 'clumsy') return R() < 0.5 ? randomMove(LD, g, R) : greedy(LD, g, 0.35);
  if (tier === 'casual') return R() < 0.15 ? randomMove(LD, g, R) : greedy(LD, g, 0.4);
  const lvl = tier === 'skilled' ? 1 : 2;
  const v = LD.viewFor(g, 0, { lvl, pers: LD.PERS[0], model: ctx.model || {}, grudge: {}, seed: (R() * 4294967295) >>> 0 });
  const a = LD.think(v);
  return a.act === 'call' ? { act: 'call' } : { act: 'bid', q: a.q, f: a.f };
}
module.exports = { TIERS, decide };
