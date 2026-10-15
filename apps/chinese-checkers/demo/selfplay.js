// 500 automatic games (mixed 2/3/4/6 players, AI levels 1-4 with their real time budgets, normal and quick mode)
// with the game's own engine, to check that games always end (no deadlock) and how long they last.
// Usage: node selfplay.js [games]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const CC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return CC;')();
const games = +process.argv[2] || 500, rng = CC.rngOf(2026);
const by = {}, t0 = Date.now(); let limitHits = 0, maxMoves = 0, passes = 0;
for (let g = 0; g < games; g++) {
  const np = [2, 2, 3, 4, 6][g % 5], quick = g % 7 === 3;
  const levels = Array.from({ length: np }, () => 1 + Math.floor(rng() * 4));
  const st = CC.newGame({ np, quick });
  let moves = 0;
  while (!st.over) {
    const r = CC.think(st, st.turn, levels[st.turn], { seed: g * 1000 + moves });
    if (!r) { CC.pass(st); passes++; continue; }
    if (!CC.paths(st, st.turn, r.from)[r.to]) throw new Error('illegal AI move in game ' + g);
    CC.play(st, r.from, r.to); moves++;
    if (moves > 6 * 400) throw new Error('runaway game ' + g);
  }
  if (st.over.reason === 'limit') limitHits++;
  maxMoves = Math.max(maxMoves, moves);
  const k = np + 'p' + (quick ? '-quick' : '');
  const b = by[k] || (by[k] = { games: 0, rounds: 0, min: 1e9, max: 0, reasons: {} });
  b.games++; b.rounds += st.round; b.min = Math.min(b.min, st.round); b.max = Math.max(b.max, st.round); b.reasons[st.over.reason] = (b.reasons[st.over.reason] || 0) + 1;
  if ((g + 1) % 100 === 0) console.log('...', g + 1, 'games', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
console.log('self-play:', games, 'games finished, no deadlock; 300-round limit reached', limitHits, 'times; passes', passes, '; longest game', maxMoves, 'moves; time', ((Date.now() - t0) / 1000).toFixed(0) + 's');
for (const k of Object.keys(by).sort()) { const b = by[k]; console.log(' ', k.padEnd(9), 'games', String(b.games).padStart(3), ' avg rounds', (b.rounds / b.games).toFixed(1), ' min', b.min, ' max', b.max, ' end reasons', JSON.stringify(b.reasons)); }
