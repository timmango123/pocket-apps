// Clear rate per level 1..100 for each tier (one attempt = 3 lives), RUNS seeds per level, to look for difficulty walls.
// node tiers-curve.js [tier...]  -> tiers-curve.json
const fs = require('fs'), path = require('path');
const { runAttempt, TIERS } = require('./tiers-sim.js');
const RUNS = +(process.env.RUNS || 3), out = process.env.OUT || path.join(__dirname, 'tiers-curve.json');
const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : {};
const list = process.argv.slice(2).filter(a => TIERS[a]);
for (const tid of (list.length ? list : ['clumsy', 'casual', 'skilled', 'world'])) {
  const rows = [];
  for (let n = 1; n <= 100; n++) {
    let wins = 0, nests = 0, need = 0;
    for (let k = 0; k < RUNS; k++) { const r = runAttempt(n, tid, 7777 + n * 131 + k * 7, 600); if (r.cleared) wins++; nests += r.nests; need = r.need; }
    rows.push([n, wins, +(nests / RUNS).toFixed(2), need]);
  }
  res[tid] = { runs: RUNS, rows, clearRateByDecade: Array.from({ length: 10 }, (_, d) => +(rows.slice(d * 10, d * 10 + 10).reduce((a, r) => a + r[1], 0) / (10 * RUNS)).toFixed(2)) };
  console.log(tid, JSON.stringify(res[tid].clearRateByDecade), 'zero-clear levels:', rows.filter(r => !r[1]).map(r => r[0]).join(','));
  fs.writeFileSync(out, JSON.stringify(res));
}
