// Skill-tier simulation (qa/skill-tiers/SPEC.md) for mahjong-solitaire, using the app's own CORE (rules, deal, solver).
// Every level 1..100 x 5 tiers. Rules replicated from the app: free tile, match by group, shuffle = genDeal on remaining
// tiles (limited count), undo (limited from level 31 on, levelParams().un), stars: 3 = 0 aids & t<=2N s, 2 = aids<=2 & t<=4N s, else 1.
// Human time model: per pair think time + 2 taps x reaction + motor misses (from on-screen tile size at 390x844) + mistakes.
const fs = require('fs'), path = require('path');
const APPF = path.resolve(__dirname, '../../../apps/mahjong-solitaire/index.html'), APP = fs.readFileSync(APPF, 'utf8');
const core = new Function(APP.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {TPL,makeLevel,levelParams,solve,mulberry32,newCounts,cntRemove,freeOf,groupOf,freeGroups,genDeal,shuf};')();
const LEVELS = JSON.parse(APP.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
function level(n) { const [ti, seed, mode] = LEVELS[n - 1]; return core.makeLevel(n, ti, seed, mode); }
const C = core;
const scan = null; // on-screen tile width: 44 px assumed for every level
const TIERS = {
  clumsy: { react: [650, 200], sigma: 40, mistake: 0.15, think: 2.6, rand: 0.5, policy: 'greedy', attempts: 5, undoBack: 1, failsPerAttempt: 3 },
  casual: { react: [400, 100], sigma: 20, mistake: 0.06, think: 1.6, rand: 0.15, policy: 'greedy', attempts: 3, undoBack: 2, failsPerAttempt: 4 },
  skilled: { react: [260, 50], sigma: 10, mistake: 0.02, think: 1.0, rand: 0, policy: 'look2', attempts: 3, undoBack: 3, failsPerAttempt: 6 },
  world: { react: [180, 25], sigma: 4, mistake: 0.003, think: 0.6, rand: 0, policy: 'search', attempts: 3, undoBack: 5, failsPerAttempt: 10 },
  superhuman: { react: [16, 0], sigma: 0, mistake: 0, think: 0.016, rand: 0, policy: 'solver', attempts: 1, undoBack: 0, failsPerAttempt: 0 },
};
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
const Phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
function Game(L) {
  const lay = L.lay, n = lay.n; const g = { lay, faces: Int8Array.from(L.faces), present: new Uint8Array(n).fill(1), rem: n, hist: [], shuf: L.p.sh, shufUsed: 0, undos: 0, undoLeft: L.p.un == null ? Infinity : L.p.un };
  g.c = C.newCounts(lay, g.present);
  g.free = i => C.freeOf(g.c, g.present, i);
  g.pairs = () => { const gs = C.freeGroups(lay, g.present, g.faces, g.c), out = []; for (const f of gs) for (let a = 0; a < f.length; a++) for (let b = a + 1; b < f.length; b++) out.push([f[a], f[b]]); return out; };
  g.match = (a, b) => { g.hist.push([a, b]); for (const i of [a, b]) { g.present[i] = 0; C.cntRemove(lay, g.c, i, 1); } g.rem -= 2; };
  g.undo = () => { if (!(g.undoLeft > 0) || !g.hist.length) return false; g.undoLeft--; const p = g.hist.pop(); for (const i of p) { g.present[i] = 1; C.cntRemove(lay, g.c, i, -1); } g.rem += 2; g.undos++; return true; };
  g.shuffle = r => { const byG = {}, keys = []; for (let i = 0; i < n; i++) if (g.present[i]) { const q = C.groupOf(g.faces[i]); if (!byG[q]) { byG[q] = []; keys.push(q); } byG[q].push(g.faces[i]); }
    const rr = C.mulberry32((r() * 1e9) | 0), pairs = []; for (const k of keys) { const a = C.shuf(byG[k], rr); for (let j = 0; j + 1 < a.length; j += 2) pairs.push([a[j], a[j + 1]]); } C.shuf(pairs, rr);
    const d = C.genDeal(lay, pairs, rr, g.present); if (!d) return false; for (let i = 0; i < n; i++) if (g.present[i]) g.faces[i] = d.faces[i]; g.shuf--; g.shufUsed++; return true; };
  return g;
}
function gain(g, a, b) { // tiles newly freed by removing a,b (what a player can see)
  const lay = g.lay, nb = new Set([...lay.below[a], ...lay.below[b], ...lay.left[a], ...lay.right[a], ...lay.left[b], ...lay.right[b]]);
  const before = [...nb].filter(q => g.present[q] && g.free(q)).length; g.match(a, b);
  const after = [...nb].filter(q => g.present[q] && g.free(q)).length; g.hist.pop(); for (const i of [a, b]) { g.present[i] = 1; C.cntRemove(lay, g.c, i, -1); } g.rem += 2;
  return after - before;
}
function look2(g, a, b) { // skilled: safe-move rule, freeing, avoid burying the other pair of the face, 2-step lookahead on pair count
  const lay = g.lay, grp = C.groupOf(g.faces[a]);
  const same = []; for (let i = 0; i < lay.n; i++) if (g.present[i] && C.groupOf(g.faces[i]) === grp) same.push(i);
  if (same.every(i => g.free(i))) return 1000;
  let s = gain(g, a, b) * 4 + lay.t[a][2] + lay.t[b][2];
  g.match(a, b); const p1 = g.pairs(); let best2 = 0; for (const [c, d] of p1.slice(0, 40)) best2 = Math.max(best2, gain(g, c, d));
  const np = p1.length; g.hist.pop(); for (const i of [a, b]) { g.present[i] = 1; C.cntRemove(lay, g.c, i, -1); } g.rem += 2;
  if (np === 0 && g.rem > 2) s -= 50; s += Math.min(np, 6) + best2 * 2;
  return s;
}
function choose(g, tier, r, solCache) {
  const P = g.pairs(); if (!P.length) return null;
  if (tier.policy === 'solver' || tier.policy === 'search') {
    const lim = tier.policy === 'solver' ? 400000 : 3000;
    const res = C.solve(g.lay, g.present, g.faces, lim);
    if (res.ok && res.sol.length) return res.sol[0];
    if (tier.policy === 'solver') return P[0];
  }
  if (r() < tier.rand) return P[Math.floor(r() * P.length)];
  let best = null, bs = -1e9;
  for (const [a, b] of P) { const s = (tier.policy === 'greedy' ? gain(g, a, b) * 4 + g.lay.t[a][2] + g.lay.t[b][2] : look2(g, a, b)) + r() * 0.5; if (s > bs) { bs = s; best = [a, b]; } }
  return best;
}
function playLevel(n, tierId, seed, TWpx) {
  const tier = TIERS[tierId], r = C.mulberry32(seed), L = level(n), N = L.lay.n;
  const TH = TWpx * 1.3, sig = tier.sigma;
  const pMiss = sig ? 1 - (2 * Phi(TWpx / 2 / sig) - 1) * (2 * Phi(TH / 2 / sig) - 1) : 0;
  const pMiss2 = sig ? 1 - (2 * Phi(TWpx / sig) - 1) * (2 * Phi(TH / sig) - 1) : 0; // a re-aim after a miss is careful (sigma/2)
  const attempts = [];
  for (let at = 0; at < tier.attempts; at++) {
    const g = Game(L); let t = 0, fails = 0, moves = 0, misTaps = 0, mistakes = 0, ok = false;
    for (let guard = 0; guard < 2000; guard++) {
      if (g.rem === 0) { ok = true; break; }
      let mv = choose(g, tier, r);
      if (!mv) {
        if (g.shuf > 0) { g.shuffle(r); t += 2.0 + tier.react[0] / 1000; continue; }
        fails++; t += 3 + tier.react[0] / 1000;
        if (fails > tier.failsPerAttempt || tier.undoBack === 0) break;
        let undone = 0; for (let k = 0; k < tier.undoBack + Math.floor(r() * 2); k++) { if (!g.undo()) break; undone++; t += 0.5; }
        if (!undone) break; // out of undos: this attempt is lost
        // after undo, force a different first choice by taking a random legal pair
        const P = g.pairs(); if (P.length) { const q = P[Math.floor(r() * P.length)]; g.match(q[0], q[1]); moves++; }
        continue;
      }
      const free = []; for (let i = 0; i < N; i++) if (g.present[i] && g.free(i)) free.push(i);
      t += tier.think * (0.6 + 0.4 * free.length / 12) + Math.max(0.12, (tier.react[0] + gauss(r) * tier.react[1]) / 1000) * 2;
      for (let k = 0; k < 2; k++) { let pm = pMiss; while (r() < pm) { misTaps++; t += Math.max(0.12, tier.react[0] / 1000) + 0.3; pm = pMiss2; } }
      if (r() < tier.mistake) { mistakes++; t += 1.0 + tier.react[0] / 1000; }
      g.match(mv[0], mv[1]); moves++;
    }
    const aids = g.shufUsed + g.undos, stars = !ok ? 0 : (aids === 0 && t <= 2 * N) ? 3 : (aids <= 2 && t <= 4 * N) ? 2 : 1;
    attempts.push({ ok, t: +t.toFixed(0), shuf: g.shufUsed, undos: g.undos, fails, stars, misTaps, mistakes });
    if (ok) break;
  }
  const last = attempts[attempts.length - 1];
  return { n, tier: tierId, cleared: last.ok, attempts: attempts.length, ...last, tiles: N, pMiss: +pMiss.toFixed(3) };
}
if (require.main !== module) { module.exports = { TIERS, Game, choose, gauss }; return; }
const levels = process.argv[2] ? process.argv[2].split(',').map(Number) : Array.from({ length: 100 }, (_, i) => i + 1);
const tiers = process.argv[3] ? process.argv[3].split(',') : Object.keys(TIERS);
const out = { game: 'mahjong-solitaire', model: TIERS, tiers: {} };
const t0 = Date.now();
for (const tid of tiers) {
  const runs = [];
  for (const n of levels) { const TWpx = 44; runs.push(playLevel(n, tid, 1000 * n + tid.length, TWpx)); }
  const band = (a, b) => { const rs = runs.filter(x => x.n >= a && x.n <= b); return rs.length ? { levels: rs.length, cleared: rs.filter(x => x.cleared).length, firstTry: rs.filter(x => x.cleared && x.attempts === 1).length, star3: rs.filter(x => x.stars === 3).length, star2p: rs.filter(x => x.stars >= 2).length, avgShuf: +(rs.reduce((s, x) => s + x.shuf, 0) / rs.length).toFixed(2), avgUndo: +(rs.reduce((s, x) => s + x.undos, 0) / rs.length).toFixed(2), avgTime: Math.round(rs.reduce((s, x) => s + x.t, 0) / rs.length) } : null; };
  out.tiers[tid] = { runs, summary: { all: band(1, 100), '1-25': band(1, 25), '26-50': band(26, 50), '51-75': band(51, 75), '76-100': band(76, 100) } };
  console.log(tid, JSON.stringify(out.tiers[tid].summary), ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
fs.writeFileSync(path.join(__dirname, process.argv[4] || 'tier-sim.json'), JSON.stringify(out, null, 1));
