// skill-tier bots (same model as the reviewer's tier-sim: screen-visible info only, PIMC for world)
module.exports = function (C) {
  const TIERS = {
    clumsy: { attempts: 5, mistake: 0.15, random: 0.5, look: 0, dead: false },
    casual: { attempts: 3, mistake: 0.06, random: 0.15, look: 0, dead: false },
    skilled: { attempts: 3, mistake: 0.02, random: 0, look: 2, dead: true },
    world: { attempts: 3, mistake: 0.003, random: 0, look: 2, dead: true, pimc: 10, pimcCap: 4000, memory: true }
  };
  function freed(D, s, m) { const n = C.applyMove(D, s, m); let k = 0; for (let p = 0; p < 28; p++) if (!C.isFree(s, p) && C.isFree(n, p)) k++; return k; }
  function evalMove(D, s, m, R, tier) {
    if (m.t === 'k') return 1000 + (m.a < 28 ? 50 : 0); if (m.t === 'd') return 0; if (m.t === 'r') return -1;
    let v = 0; for (const l of [m.a, m.b]) if (l < 28) v += 30 + C.ROWOF[l]; else v += 5;
    v += freed(D, s, m) * 12; if (tier.dead && C.hopeless(D, C.applyMove(D, s, m))) v -= 5000; return v;
  }
  function lookahead(D, s, m, R, tier, depth) {
    let v = evalMove(D, s, m, R, tier); if (depth <= 1 || m.t === 'd' || m.t === 'r') return v;
    const n = C.applyMove(D, s, m), ms = C.legalMoves(D, n, R).filter(x => x.t !== 'd' && x.t !== 'r');
    let best = 0; for (const x of ms) best = Math.max(best, evalMove(D, n, x, R, tier)); return v + best * 0.6;
  }
  function pimc(D, s, R, tier, seen, rnd) {
    const ms = C.legalMoves(D, s, R); if (ms.length === 1) return ms[0];
    const un = []; for (let i = 0; i < 24; i++) if (!seen.has(i) && !((s.um >>> i) & 1)) un.push(i);
    if (!un.length) { const r = C.solve(D, s, R, 60000); return r.ok ? r.sol[0] : null; }
    const score = new Map();
    for (let k = 0; k < tier.pimc; k++) {
      const cards = D.cards.slice(), pool = un.map(i => cards[28 + i]);
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      un.forEach((i, t) => cards[28 + i] = pool[t]);
      const r = C.solve({ seed: 0, cards, rk: cards.map(c => c % 13 + 1) }, s, R, tier.pimcCap);
      if (r.ok) { const key = JSON.stringify(r.sol[0]); score.set(key, (score.get(key) || 0) + 1); }
    }
    if (!score.size) return null;
    const best = [...score.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return ms.find(m => JSON.stringify(m) === best) || null;
  }
  function attempt(seed, R, tier, rnd, memory) {
    const D = C.dealFromSeed(seed); let s = C.initState(), plan = null, steps = 0; const seen = new Set(memory || []);
    while (!C.isWon(s) && steps++ < 400) {
      const ms = C.legalMoves(D, s, R); if (!ms.length) break; let m = null;
      if (tier.memory && seen.size >= 24 && !plan) { const r = C.solve(D, s, R, 200000); if (r.ok) plan = r.sol.slice(); }
      if (plan && plan.length) m = plan.shift(); else if (tier.pimc) m = pimc(D, s, R, tier, seen, rnd);
      if (!m) { if (rnd() < tier.random) m = ms[Math.floor(rnd() * ms.length)]; else { let bv = -1e9; for (const x of ms) { const v = lookahead(D, s, x, R, tier, tier.look) + rnd() * 0.5; if (v > bv) { bv = v; m = x; } } } }
      if (rnd() < tier.mistake && ms.length > 1) { const o = ms.filter(x => x !== m); m = o[Math.floor(rnd() * o.length)]; plan = null; }
      if (m.t === 'd') seen.add(C.nextStock(s));
      s = C.applyMove(D, s, m);
    }
    return { won: C.isWon(s), seen: [...seen] };
  }
  return { TIERS, attempt };
};
