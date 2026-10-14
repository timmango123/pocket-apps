// AI tuning simulation for 榫卯木格 (block-fill), using the game's own core code (CORE-START/CORE-END in index.html).
// Greedy AI: evaluation = lines*10 - holes*3 - edge roughness (+ a penalty if a remaining hand piece would no longer fit).
// Usage: node sim.js [games=1000] [file]
const fs = require('fs'), path = require('path');
const games = +process.argv[2] || 1000;
const file = process.argv[3] || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {newGame, step, aiBest, hardWeight, solvable, SHAPES};')();

const SEC_PER_MOVE = 4;          // a relaxed human: ~4 s per placement (look, pick, drag, drop)
const FIVE_MIN = 300 / SEC_PER_MOVE;
const CAP = 4000;                // safety cap on placements per game
let scores = [], moves = [], survive5 = 0, capped = 0, maxS = 0, dealMs = 0, deals = 0;
const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const G = C.newGame('normal', 1000 + g * 7919);
  let n = 0;
  while (!G.over && n < CAP) {
    const m = C.aiBest(G); if (!m) break;
    const t = performance.now();
    const ev = C.step(G, m.slot, m.r, m.c);
    if (ev.dealt) { dealMs += performance.now() - t; deals++; }
    n++;
  }
  if (n >= CAP) capped++;
  if (n >= FIVE_MIN) survive5++;
  scores.push(G.score); moves.push(n); maxS = Math.max(maxS, G.score);
}
scores.sort((a, b) => a - b);
const avg = scores.reduce((a, b) => a + b, 0) / games;
const pct = q => scores[Math.floor(q * (games - 1))];
console.log(`games ${games}  time ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`average score ${avg.toFixed(0)}  median ${pct(0.5)}  p10 ${pct(0.1)}  p90 ${pct(0.9)}  max ${maxS}`);
console.log(`average placements ${(moves.reduce((a, b) => a + b, 0) / games).toFixed(1)}  survive 5 min (>=${FIVE_MIN} placements @${SEC_PER_MOVE}s) ${(100 * survive5 / games).toFixed(1)}%  capped ${capped}`);
console.log(`deal step (incl. exhaustive check) avg ${(dealMs / Math.max(1, deals)).toFixed(2)} ms over ${deals} deals`);
console.log('hard-shape weight by score: ' + [0, 1000, 2000, 3000, 5000, 8000].map(s => s + ':' + (C.hardWeight(s) * 100).toFixed(1) + '%').join('  '));
