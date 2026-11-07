// 紅心大戰 skill tiers per qa/skill-tiers/SPEC.md (from the release reviewer's tiers.js, pointed at apps/hearts/index.html).
// Node simulation on the game's own core (CORE markers). The page AI is reproduced exactly: same match/round seeds,
// pass seed hash(M.seed, M.round, 'pass', p), play seed hash(M.seed, M.round, tno, tc, p), AICFG {ms:150,minS:60,maxS:120}.
// Seat 0 is a tier bot. Full matches to 100 (tiebreak rounds like the page). Default rules.
// Usage: node tiers.js --level=1 --matches=40 [--tiers=clumsy,...] [--par=3] [--out=tiers-L1.json]
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const html = fs.readFileSync(process.env.APP || path.join(__dirname, '..', '..', '..', 'apps', 'hearts', 'index.html'), 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const args = process.argv.slice(2), opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const AICFG = { ms: 150, minS: 60, maxS: 120 };
const { suit, rank, card, QS } = HE;

function aiMove(S, M, p, level) { return HE.think(HE.viewFor(S, p), p, level, HE.hash(M.seed, M.round, S.tno, S.tc, p), AICFG).move; }
function randomLegal(S, r) { const L = HE.legal(S, 0); return L[Math.floor(r() * L.length)]; }
// 1-step greedy: dodge the trick if possible with the highest safe card; else dump the highest; lead lowest; discard Q♠ / highest heart / highest.
function greedy(S) {
  const L = HE.legal(S, 0); if (L.length === 1) return L[0];
  if (S.tc === 0) return L.slice().sort((a, b) => rank(a) - rank(b) + (suit(a) === 3 ? .5 : 0) - (suit(b) === 3 ? .5 : 0))[0];
  const Ls = suit(S.trick[S.lead]); let wr = -1; for (let q = 0; q < 4; q++) { const c = S.trick[q]; if (c >= 0 && suit(c) === Ls && rank(c) > wr) wr = rank(c); }
  const follow = L.filter(c => suit(c) === Ls);
  if (follow.length) { const under = follow.filter(c => rank(c) < wr && c !== QS); if (under.length) return under.sort((a, b) => rank(b) - rank(a))[0]; return follow.filter(c => c !== QS).sort((a, b) => rank(b) - rank(a))[0] || follow[0]; }
  if (L.includes(QS)) return QS;
  const h = L.filter(c => suit(c) === 3); if (h.length) return h.sort((a, b) => rank(b) - rank(a))[0];
  return L.sort((a, b) => rank(b) - rank(a))[0];
}
const SHOOT = { moonThr: 0, blockThr: 10, risky: 1 };
// perfect information + exact prediction of the page AI (levels 0/1 are deterministic given the seed formula; level 2 is
// time-budgeted Monte Carlo and is modelled with level 1, i.e. not exact). Each legal card is played out to the end of the
// round with two self policies (rule play / moon-shooting rule play); best own utility wins.
function rollout(S0, M, level, selfP) {
  const S = HE.cloneState(S0); S.log = false; S.hist = null;
  while (S.tno < 13) { const p = S.turn; HE.play(S, p === 0 ? HE.rulePlay(S, 0, selfP) : aiMove(S, M, p, level === 2 ? 1 : level)); }
  const d = HE.roundScore(S).d; return (d[1] + d[2] + d[3]) / 3 - d[0];
}
function perfect(S, M, level) {
  const L = HE.legal(S, 0); if (L.length === 1) return L[0];
  let best = L[0], bv = -1e9;
  for (const c of L) { const X = HE.cloneState(S); X.log = false; X.hist = null; HE.play(X, c); const v = Math.max(rollout(X, M, level, HE.PERS[0]), rollout(X, M, level, SHOOT)); if (v > bv + 1e-9) { bv = v; best = c; } }
  return best;
}
function perfectPass(S, M, level) {
  const cand = [HE.choosePass(S, 0, 1, HE.rng(1)), HE.choosePass(S, 0, 0, HE.rng(1))];
  const risky = HE.hand(S, 0).sort((a, b) => (rank(b) + (suit(b) === 3 ? 2 : 0) + (b === QS ? 6 : 0)) - (rank(a) + (suit(a) === 3 ? 2 : 0) + (a === QS ? 6 : 0))).slice(0, 6);
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) for (let k = j + 1; k < 6; k++) cand.push([risky[i], risky[j], risky[k]]);
  const ai = [1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, level, HE.hash(M.seed, M.round, 'pass', p)).move);
  let best = cand[0], bv = -1e9;
  for (const ps of cand) { const X = HE.cloneState(S); X.log = false; X.hist = null; X.passed = [null, null, null, null]; HE.applyPass(X, [ps].concat(ai)); const v = Math.max(rollout(X, M, level, HE.PERS[0]), rollout(X, M, level, SHOOT)); if (v > bv) { bv = v; best = ps; } }
  return best;
}
const TIER = {
  clumsy: { mistake: .15, pass: (S, r) => r() < .5 ? HE.hand(S, 0).sort(() => r() - .5).slice(0, 3) : HE.choosePass(S, 0, 0, r), move: (S, r) => r() < .5 ? randomLegal(S, r) : greedy(S) },
  casual: { mistake: .06, pass: (S, r) => r() < .15 ? HE.hand(S, 0).sort(() => r() - .5).slice(0, 3) : HE.choosePass(S, 0, 0, r), move: (S, r) => r() < .15 ? randomLegal(S, r) : greedy(S) },
  skilled: { mistake: .02, pass: (S, r) => HE.choosePass(HE.viewFor(S, 0), 0, 1, r), move: S => HE.rulePlay(HE.viewFor(S, 0), 0, HE.PERS[0]) },
  world: { mistake: .003, pass: (S, r) => HE.choosePass(HE.viewFor(S, 0), 0, 1, r), move: (S, r) => HE.pimc(HE.viewFor(S, 0), 0, { ms: 250, minS: 120, maxS: 300 }, r).card },
  superhuman: { mistake: 0, pass: (S, r, M, lv) => perfectPass(S, M, lv), move: (S, r, M, lv) => perfect(S, M, lv) }
};
function playMatch(tier, level, seed) {
  const T = TIER[tier], r = HE.rng(seed ^ 0x5bd1e995), M = HE.newMatch(seed, {});
  const st = { rounds: 0, pts: 0, moons: 0, qs: 0, illegal: 0, decisions: 0, ms: 0 };
  while (!M.over && M.round < 80) {
    const S = HE.startRound(M); S.log = false;
    if (S.phase === 'pass') {
      const mine = T.pass(S, r, M, level);
      const ai = [1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, level, HE.hash(M.seed, M.round, 'pass', p)).move);
      HE.applyPass(S, [mine].concat(ai));
    }
    while (S.phase === 'play') {
      const p = S.turn; let c;
      if (p === 0) { const t0 = Date.now(); c = r() < T.mistake ? randomLegal(S, r) : T.move(S, r, M, level); st.ms += Date.now() - t0; st.decisions++; if (!HE.isLegal(S, c)) { st.illegal++; c = HE.legal(S, 0)[0]; } }
      else c = aiMove(S, M, p, level);
      HE.play(S, c);
    }
    const res = HE.roundScore(S); st.rounds++; st.pts += res.d[0]; if (res.shooter === 0) st.moons++; if (S.qsBy === 0) st.qs++;
    HE.finishRound(M, res);
  }
  const ord = [0, 1, 2, 3].sort((a, b) => M.totals[a] - M.totals[b]);
  return Object.assign(st, { seed, win: M.winner === 0, place: ord.indexOf(0) + 1, totals: M.totals.slice(), over: M.over });
}
if (process.env.HT_CHILD) { process.on('message', j => process.send(playMatch(j.tier, j.level, j.seed))); return; }
(async () => {
  const LEVEL = +opt('level', 1), N = +opt('matches', 40), PAR = +opt('par', 3), TIERS = opt('tiers', 'clumsy,casual,skilled,world,superhuman').split(',');
  const OUT = path.resolve(__dirname, opt('out', `tiers-L${LEVEL}.json`));
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'hearts', level: LEVEL, aiLevel: HE.LEVELS[LEVEL].name, tiers: {} };
  for (const tier of TIERS) {
    const jobs = []; for (let i = 0; i < N; i++) jobs.push({ tier, level: LEVEL, seed: HE.hash('tier', LEVEL, i) });
    const runs = []; let next = 0; const t0 = Date.now();
    await new Promise(done => { let live = 0; const spawn = () => { if (next >= jobs.length) { if (!live) done(); return; } const j = jobs[next++]; live++;
      const ch = fork(__filename, [], { env: Object.assign({}, process.env, { HT_CHILD: '1' }) }); ch.on('message', m => { runs.push(m); ch.kill(); live--; spawn(); }); ch.send(j); };
      for (let i = 0; i < PAR; i++) spawn(); });
    const n = runs.length, wins = runs.filter(x => x.win).length, rounds = runs.reduce((a, x) => a + x.rounds, 0);
    const summary = { matches: n, winRate: +(wins / n).toFixed(3), avgPlace: +(runs.reduce((a, x) => a + x.place, 0) / n).toFixed(2),
      ptsPerRound: +(runs.reduce((a, x) => a + x.pts, 0) / rounds).toFixed(2), moonsPerRound: +(runs.reduce((a, x) => a + x.moons, 0) / rounds).toFixed(3),
      qsPerRound: +(runs.reduce((a, x) => a + x.qs, 0) / rounds).toFixed(3), illegal: runs.reduce((a, x) => a + x.illegal, 0), unfinished: runs.filter(x => !x.over).length,
      places: [1, 2, 3, 4].map(k => runs.filter(x => x.place === k).length), wallSec: Math.round((Date.now() - t0) / 1000) };
    out.tiers[tier] = { runs, summary };
    console.log(`L${LEVEL} ${tier}: ${JSON.stringify(summary)}`);
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
})();
