// Fast node-only simulation of the same brains (no browser): node sim.js [tiers] [levels] [reps]
// Uses the game's own core from index.html; useful for wider seed sweeps than the browser bot.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../../apps/platform-jump/index.html'), 'utf8');
const PJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PJ;')();
const { TIERS, Brain } = require('./brain.js');
function simLevel(L, tier, seed, cap) {
  const B = new Brain(PJ, L, tier, seed), s = PJ.newRun(L), T = TIERS[tier]; let held = false, deadT = 0;
  for (let now = 1; now <= cap; now++) {
    if (s.dead) { if (s.deaths + 1 >= T.attempts) return { cleared: false, deaths: s.deaths + 1, x: +s.x.toFixed(1) }; if (++deadT >= 34) { PJ.respawn(L, s); deadT = 0; } B.act(s, now); continue; }
    const a = B.act(s, now); PJ.step(L, s, { h: a.h, j: a.j, jp: a.j && !held }, null); held = a.j;
    if (s.won) return { cleared: true, deaths: s.deaths, x: +s.x.toFixed(1) };
  }
  return { cleared: false, deaths: s.deaths, x: +s.x.toFixed(1), why: 'time' };
}
const tiers = (process.argv[2] || 'clumsy,casual,skilled,world').split(','), levels = (process.argv[3] || '1,10,25,50,75,99,100').split(',').map(Number), reps = +(process.argv[4] || 3);
for (const t of tiers) { const row = []; for (const n of levels) { const L = PJ.genLevel(n); let ok = 0; for (let r = 0; r < reps; r++) if (simLevel(L, t, 1000 + r * 77 + n, 60 * 240).cleared) ok++; row.push(`L${n} ${ok}/${reps}`); } console.log(TIERS[t].name, row.join('  ')); }
