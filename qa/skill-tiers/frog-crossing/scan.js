// Clear rate per level for one tier: node scan.js <tier> <from> <to> [N]   (NEED, EASE env override needOf() and EASE)
const { runAttempt } = require('./tiers-sim.js');
const [tid, a, b, N0] = process.argv.slice(2), N = +(N0 || 12), out = {};
for (let n = +a; n <= +b; n++) { let w = 0; for (let k = 0; k < N; k++) w += runAttempt(n, tid, 99 + n * 7919 + k * 13, 600).cleared; out[n] = +(w / N).toFixed(2); console.log(tid, n, out[n]); }
console.log(tid, JSON.stringify(out));
