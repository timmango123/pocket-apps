// Pure-sim tier sweep (same core physics + same decision layer as the reviewer's real-page bot).
// node sim.js <tier> <holes,comma> [attempts] [seed]
const K = require('./tiers-core.js');
const tier = process.argv[2], holes = process.argv[3].split(',').map(Number), att = +(process.argv[4] || K.TIERS[tier].attempts), seed0 = +(process.argv[5] || 1);
for (const n of holes) {
  const res = []; const t0 = Date.now();
  for (let a = 0; a < att; a++) { const r = K.simAttempt(tier, n, seed0 * 1000 + n * 7 + a); res.push(r.cleared ? r.strokes + 'W' : r.strokes + 'F'); }
  console.log(tier, 'hole', n, res.join(','), ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
