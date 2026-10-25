// How often the human actually has a choice (>1 legal move) and how many human rolls a game takes (default 4-plane game vs three Lv3).
const fs = require('fs');
const AP = new Function(fs.readFileSync('' + require('path').resolve(__dirname, '../../../apps/aeroplane-chess/index.html') + '', 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return AP;')();
for (const five of [false, true]) for (const np of [4, 2]) { let rolls = 0, choice = 0, none = 0, one = 0, cpuRolls = 0, firstMoveRoll = [], G = 200;
for (let g = 0; g < G; g++) { const st = AP.newGame({ seed: 333 + g, np, rules: { five } }); let first = 0; const r0 = rolls;
  while (!st.over) { const me = st.turn === 0 && st.done.indexOf(0) < 0; const r = AP.roll(st); if (me) rolls++; else cpuRolls++;
    const n = r.moves ? r.moves.length : 0; if (me) { if (!n) none++; else if (n === 1) one++; else choice++; if (n && !first) { first = 1; firstMoveRoll.push(rolls - r0); } }
    if (!n) continue; AP.play(st, AP.think(st, 3, st.turn === 0 ? 0 : st.turn % 3, g).i); } }
firstMoveRoll.sort((a, b) => a - b);
console.log(JSON.stringify({ five, np, humanRollsPerGame: +(rolls / G).toFixed(1), cpuRollsPerGame: +(cpuRolls / G).toFixed(1), noMove: +(none / rolls).toFixed(2), forced: +(one / rolls).toFixed(2), realChoice: +(choice / rolls).toFixed(2), rollsUntilFirstMove_median: firstMoveRoll[G >> 1], p90: firstMoveRoll[Math.floor(G * .9)] })); }
