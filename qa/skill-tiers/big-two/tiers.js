// 大老二 skill tiers per qa/skill-tiers/SPEC.md (written by the reviewer; no qa/skill-tiers/big-two existed).
// Node simulation on the game's own core (CORE markers), page AI reproduced exactly: same per-round deal seed
// ((matchSeed + round*7919)>>>0), same AI seed formula ((matchSeed ^ log.length*2654435761)>>>0), same personas, same levels.
// Seat 0 is played by a tier bot. Matches are 8 rounds (default) and end early at -100, like the page.
// Usage: node tiers.js --level=1 --matches=20 [--tiers=clumsy,casual] [--out=tiers-L1.json]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(process.env.APP || path.resolve(__dirname, '../../../apps/big-two/index.html'), 'utf8');
const B2 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return B2;')();
const args = process.argv.slice(2), opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const LEVEL = +opt('level', 1), MATCHES = +opt('matches', 20), ROUNDS = 8, TIERS = opt('tiers', 'clumsy,casual,skilled,world,superhuman').split(',');
const OUTF = path.join(__dirname, opt('out', `tiers-L${LEVEL}.json`));
const PERS = [null, { aggr: 0.3, keep: 0.85 }, { aggr: 0.9, keep: 0.15 }, { aggr: 0.55, keep: 0.5 }];
const NEUTRAL = { aggr: 0.5, keep: 0.5 };
function mulberry(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const restore = snap => B2.Game.restore(JSON.parse(JSON.stringify(snap))); // Game.restore keeps references into the snapshot
const legal = g => B2.hints(g.hands[g.turn], g);
const aiSeed = (mseed, g) => (mseed ^ (g.log.length * 2654435761)) >>> 0;
function aiMove(g, p, mseed, level) { return B2.think({ view: B2.aiView(g, p), level, seed: aiSeed(mseed, g), persona: PERS[p], ms: 110 }).cards; }
function greedy(g) { const L = legal(g); if (!g.lead) { // lead: smallest card's best combo, prefer multi-card plays containing it
    const low = g.hands[g.turn][0]; const m = L.filter(x => x.cards[0] === low).sort((a, b) => b.cards.length - a.cards.length); return (m[0] || L[0]).cards; }
  const fin = L.find(x => x.cards.length === g.hands[g.turn].length); if (fin) return fin.cards; return L.length ? L[0].cards : null; }
function randomLegal(g, r) { const L = legal(g); const opts = L.map(x => x.cards); if (g.lead) opts.push(null); return opts[Math.floor(r() * opts.length)] || (L[0] && L[0].cards); }
const TIER = {
  clumsy: { mistake: 0.15, move(g, r) { if (r() < 0.5) return randomLegal(g, r); return greedy(g); } },
  casual: { mistake: 0.06, move(g, r) { if (r() < 0.15) return randomLegal(g, r); return greedy(g); } },
  skilled: { mistake: 0.02, move(g, r) { return B2.think({ view: B2.aiView(g, 0), level: 1, seed: (r() * 1e9) >>> 0, persona: NEUTRAL }).cards; } },
  world: { mistake: 0.003, move(g, r) { return B2.think({ view: B2.aiView(g, 0), level: 2, seed: (r() * 1e9) >>> 0, persona: NEUTRAL, ms: 400 }).cards; } },
  superhuman: { mistake: 0, move(g, r, ctx) { return perfectMove(g, ctx); } },
};
// superhuman: sees all hands and knows the AI seed formula, so each candidate is played out exactly against the page AI
// (levels 0/1 are deterministic given the seed; level 2 is time-budgeted Monte Carlo, modelled as level 1 = not exact).
function playoutScore(snap, ctx, myPol) {
  const g = restore(snap); let k = 0;
  while (g.winner < 0 && k++ < 300) {
    const p = g.turn; let c = p === 0 ? myPol(g) : aiMove(g, p, ctx.mseed, ctx.level === 2 ? 1 : ctx.level);
    const e = c ? g.play(c) : g.pass(); if (e) { if (g.lead) g.pass(); else g.play([g.hands[p][0]]); }
  }
  if (g.winner < 0) return -999;
  return B2.roundDeltas(g.hands, g.winner, g.rules)[0];
}
function perfectMove(g, ctx) {
  const snap = g.snapshot(); let L = legal(g).map(x => x.cards);
  if (L.length > 24) L = L.slice(0, 16).concat(L.slice(-8));
  const opts = g.lead ? [null].concat(L) : L;
  const pols = [NEUTRAL, { aggr: 0.1, keep: 0.9 }, { aggr: 0.9, keep: 0.1 }].map(pe => gg => B2.think({ view: B2.aiView(gg, 0), level: 1, seed: 1, persona: pe }).cards).concat([greedy]);
  let best = opts[0], bv = -1e9;
  for (const mv of opts) {
    let v = -1e9;
    for (const pol of pols) { if (v > 0) break; const g2 = restore(snap); const e = mv ? g2.play(mv) : g2.pass(); if (e) break; v = Math.max(v, g2.winner === 0 ? B2.roundDeltas(g2.hands, 0, g2.rules)[0] : playoutScore(g2.snapshot(), ctx, pol)); }
    if (v > bv) { bv = v; best = mv; }
  }
  if (process.env.DBG) console.log('pm', g.hands[0].length, opts.length, bv);
  return best;
}
function playMatch(tier, mi) {
  const mseed = (90001 + mi * 104729) >>> 0, rules = B2.mkRules(B2.PRESETS.tw.rules), totals = [0, 0, 0, 0], rounds = [];
  const r = mulberry(mseed ^ 0x5bd1e995), T = TIER[tier];
  for (let rn = 1; rn <= ROUNDS; rn++) {
    const g = new B2.Game({ seed: (mseed + rn * 7919) >>> 0, rules }); let k = 0, mistakes = 0; const ctx = { mseed, level: LEVEL };
    while (g.winner < 0 && k++ < 600) {
      const p = g.turn; let c;
      if (p === 0) { c = T.move(g, r, ctx); if (r() < T.mistake) { mistakes++; c = randomLegal(g, r); } }
      else c = aiMove(g, p, mseed, LEVEL);
      const e = c ? g.play(c) : g.pass();
      if (e) { if (g.lead) g.pass(); else g.play([g.hands[p][0]]); }
    }
    const d = B2.roundDeltas(g.hands, g.winner, rules); for (let i = 0; i < 4; i++) totals[i] += d[i];
    rounds.push({ win: g.winner === 0, d0: d[0], left0: g.hands[0].length, mistakes });
    if (totals.some(t => t <= -100)) break;
  }
  const order = [0, 1, 2, 3].sort((a, b) => totals[b] - totals[a] || a - b);
  return { tier, match: mi, place: order.indexOf(0) + 1, totals, rounds };
}
const out = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : { level: LEVEL, tiers: {} };
for (const tier of TIERS) {
  const t0 = Date.now(), n = tier === 'superhuman' ? Math.min(MATCHES, +opt('shMatches', 6)) : tier === 'world' ? Math.min(MATCHES, +opt('wMatches', 10)) : MATCHES;
  const runs = []; for (let i = 0; i < n; i++) runs.push(playMatch(tier, i));
  const rs = runs.flatMap(m => m.rounds), wins = rs.filter(x => x.win).length;
  const summary = { matches: n, rounds: rs.length, roundWinPct: +(wins / rs.length * 100).toFixed(1), avgPtsPerRound: +(rs.reduce((a, x) => a + x.d0, 0) / rs.length).toFixed(2), matchFirstPct: +(runs.filter(m => m.place === 1).length / n * 100).toFixed(1), avgPlace: +(runs.reduce((a, m) => a + m.place, 0) / n).toFixed(2), endedEarly: runs.filter(m => m.rounds.length < ROUNDS).length, mistakes: rs.reduce((a, x) => a + x.mistakes, 0), sec: Math.round((Date.now() - t0) / 1000) };
  out.tiers[tier] = { summary, runs: runs.map(m => ({ match: m.match, place: m.place, totals: m.totals, wins: m.rounds.filter(x => x.win).length, rounds: m.rounds.length })) };
  console.log(`L${LEVEL} ${tier}: ${JSON.stringify(summary)}`);
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
}
