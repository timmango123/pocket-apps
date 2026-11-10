// Higher-sample clear rates around the suspected steps (need 1->3 at 11, bikes at 12, need 3->5 at 31). -> tiers-wall.json
const fs = require('fs'); const { runAttempt } = require('./tiers-sim.js');
const out = {}, N = 12;
for (const [tid, lv] of [['clumsy', [8, 9, 10, 11, 12, 13, 14, 15]], ['casual', [28, 29, 30, 31, 32, 33, 34]]]) {
  out[tid] = {};
  for (const n of lv) { let w = 0, ne = 0; for (let k = 0; k < N; k++) { const r = runAttempt(n, tid, 99 + n * 7919 + k * 13, 600); w += r.cleared; ne += r.nests; } out[tid][n] = { clearRate: +(w / N).toFixed(2), avgNests: +(ne / N).toFixed(2) }; }
  console.log(tid, JSON.stringify(out[tid]));
}
fs.writeFileSync(__dirname + '/tiers-wall.json', JSON.stringify(out, null, 1));
