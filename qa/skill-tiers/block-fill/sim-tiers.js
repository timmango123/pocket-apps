// Fast Node simulation of the five tiers on the game's own core (same rules, same deal RNG), many seeds.
// node sim-tiers.js [games=40] [cap=3000] [tiers...]  -> sim-tiers.json
const fs = require('fs'), path = require('path');
const { C, TIERS, rng, decide, motor } = require('./tierlib');
const games = +process.argv[2] || 40, CAP = +process.argv[3] || 3000;
const only = process.argv.slice(4), tiers = only.length ? only : Object.keys(TIERS);
const CELL = 39; // cell size at 390x844
const OUTF = path.join(__dirname, process.env.OUT || 'sim-tiers.json');
const out = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : {};
for (const t of tiers) {
  const t0 = Date.now(), runs = [];
  for (let g = 0; g < games; g++) {
    const seed = 5000 + g * 7919, G = C.newGame('normal', seed), R = rng(seed ^ 0xabc), ev = { mistakes: 0, slips: 0, retries: 0, deathDealUnsolvable: false, scoreAt5min: null };
    let n = 0, lastDealSolvable = true, thinkMs = 0;
    while (!G.over && n < CAP) {
      let m = decide(t, G, R); if (!m) break;
      if (m.kind === 'mistake') ev.mistakes++;
      let act = motor(t, G, m, CELL, R), tries = 0;
      while (!act && tries < 5) { ev.retries++; tries++; act = motor(t, G, m, CELL, R); }
      if (!act) act = m;
      if (act.slipped) ev.slips++;
      const e = C.step(G, act.slot, act.r, act.c); if (!e) throw new Error('illegal move');
      n++; thinkMs += Math.max(300, TIERS[t].think[0]) + 600;
      if (ev.scoreAt5min == null && thinkMs >= 300000) ev.scoreAt5min = G.score;
      if (e.dealt) lastDealSolvable = C.solvable(G.b, G.hand.map(p => p.id));
    }
    ev.deathDealUnsolvable = G.over && !lastDealSolvable;
    runs.push({ seed, score: G.score, placed: n, capped: n >= CAP, lines: G.lines, maxCombo: G.maxCombo, boardClears: G.boardClears, minutes: +(thinkMs / 60000).toFixed(1), ...ev });
  }
  const sc = runs.map(r => r.score).sort((a, b) => a - b), q = p => sc[Math.floor(p * (sc.length - 1))];
  const pl = runs.map(r => r.placed).sort((a, b) => a - b);
  out[t] = { games, cap: CAP, secs: +((Date.now() - t0) / 1000).toFixed(1), summary: { median: q(0.5), p10: q(0.1), p90: q(0.9), max: sc[sc.length - 1], medianPlaced: pl[pl.length >> 1], capped: runs.filter(r => r.capped).length, reach1000: runs.filter(r => r.score >= 1000).length, reach3000: runs.filter(r => r.score >= 3000).length, reach5000: runs.filter(r => r.score >= 5000).length, reach10000: runs.filter(r => r.score >= 10000).length, deathDealUnsolvable: runs.filter(r => r.deathDealUnsolvable).length, survive5min: runs.filter(r => r.minutes >= 5 || r.capped).length }, runs };
  console.log(t, JSON.stringify(out[t].summary), out[t].secs + 's');
  fs.writeFileSync(OUTF, JSON.stringify(out, null, 1));
}
