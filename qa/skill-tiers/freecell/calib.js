// Bot-measured difficulty of the 4-cell levels (L1-L50): clumsy/casual/skilled decision bots from tierlib.js
// (the release reviewer's tier logic), several seeds each, auto-collect on. Usage: node calib.js [seeds]
// Writes calib.json: per deal, wins per tier and the combined bot score used to order L1-L50.
const fs = require('fs'), path = require('path');
const { core, LEVELS, rng, TIERS, pick } = require('./tierlib');
const SEEDS = +(process.argv[2] || 8), CAP = 600;
function attempt(deal, cells, tierId, seed) {
  const tier = TIERS[tierId], R = rng(seed);
  let S = core.newState(core.msDeal(deal), cells); core.runAuto(S);
  const hist = [], visited = new Set([core.stateKey(S)]); let actions = 0, undos = 0;
  while (!core.isWon(S)) {
    if (actions > CAP) return false;
    const p = pick(S, tier, R, true, visited); const mv = p && p.m;
    if (!mv) {
      if (undos < (tier.undo || 0) && hist.length) { const k = 1 + Math.floor(R() * 3); for (let i = 0; i < k && hist.length; i++) S = hist.pop(); undos++; actions++; continue; }
      return false;
    }
    hist.push(core.cloneS(S)); core.applyMove(S, mv); core.runAuto(S); actions++; visited.add(core.stateKey(S));
  }
  return true;
}
const out = [];
const seen = new Set();
for (let n = 1; n <= 100; n++) {
  const [deal, cells] = LEVELS[n - 1]; if (cells !== 4) continue;
  const w = {};
  for (const t of ['clumsy', 'casual', 'skilled']) { let c = 0; for (let s = 0; s < SEEDS; s++) if (attempt(deal, 4, t, deal * 31 + s * 977 + t.length)) c++; w[t] = c; }
  const score = (w.clumsy * 1 + w.casual * 2 + w.skilled * 1) / (4 * SEEDS); // 0 = hardest, 1 = easiest
  out.push({ n, deal, S: LEVELS[n - 1][3], wins: w, score: +score.toFixed(3) });
  console.log('L' + n, 'deal', deal, JSON.stringify(w), score.toFixed(3));
}
fs.writeFileSync(path.join(__dirname, 'calib.json'), JSON.stringify({ seeds: SEEDS, levels: out }, null, 1));
