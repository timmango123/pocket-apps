// Headless beatability check for all 100 levels of 螢火迷宮, using the game's own core (from index.html)
// and the same auto-player as verify.js, with a human-like latency model (input lands 10-15 ticks = 170-250 ms, as measured in the real page
// after the observed frame, >=150 ms between swipes). Up to 3 runs per level; prints a summary.
// Usage: node sim-all.js [from] [to]
const B = require('./bot.js');
const C = B.loadCore();
const from = +process.argv[2] || 1, to = +process.argv[3] || 100;
let cleared = 0, firstTry = 0, deaths = 0;
const fails = [];
for (let n = from; n <= to; n++) {
  let r, k;
  for (k = 1; k <= 3; k++) { r = B.simLevel(C, n, { seed: k, lat: 10, jit: 6 }); if (r.won) break; }
  if (r.won) { cleared++; if (k === 1) firstTry++; deaths += r.deaths; } else fails.push(n);
  console.log(`L${n} D=${C.params(n).D} ${r.won ? 'CLEARED' : 'FAILED'} run ${k} deaths ${r.deaths} score ${r.score} game-time ${r.secs}s`);
}
console.log(`SUMMARY levels ${from}-${to}: cleared ${cleared}/${to - from + 1} (first run ${firstTry}), lives lost on clearing runs ${deaths}${fails.length ? ', failed: ' + fails.join(',') : ''}`);
