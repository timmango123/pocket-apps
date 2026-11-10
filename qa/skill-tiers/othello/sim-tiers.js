// Node match runner: tier bot vs the game's own AI level (think(), same code the page's worker runs).
// usage: node sim-tiers.js <tier> <level> <games> <seed>   -> appends a JSON line to sim-tiers.jsonl
const fs = require('fs');
const { mkCore, makeBrain, decide, motor, TIERS, rng } = require('./bots');
const [tier, lvS, nS, seedS] = process.argv.slice(2); const lv = +lvS, N = +nS, seed = +seedS;
const R = rng(seed); Math.random = rng(seed * 7 + 1); // seeds the AI's own mistakes too
const C = mkCore(), B = makeBrain(C);
if (process.env.LV) Object.assign(C.LEVELS[lv], JSON.parse(process.env.LV)); // tuning: override this level's params
const CELL = 45; // 390x844 on-screen cell
let w = 0, l = 0, d = 0, diffs = [], wrongTaps = 0, wrongMoves = 0, taps = 0; const t0 = Date.now();
for (let g = 0; g < N; g++) {
  const me = g % 2; let p = C.initialPos(), moves = 0;
  while (!C.isOver(p)) {
    if (!C.legalOf(p).length) { p = C.passPos(p); continue; }
    let m;
    if (p.turn === me) {
      const tgt = decide(C, B, tier, p, R), L = C.legalOf(p);
      for (let a = 0; a < 20; a++) { const hit = motor(tgt, TIERS[tier].pos, CELL, R); taps++; if (L.indexOf(hit) >= 0) { m = hit; if (hit !== tgt) wrongMoves++; break; } wrongTaps++; }
      if (m == null) m = tgt;
    } else m = C.think(C.sides(p), lv).move;
    p = C.playPos(p, m); moves++;
  }
  const fc = C.finalCounts(p), df = fc[me] - fc[me ^ 1]; diffs.push(df); if (df > 0) w++; else if (df < 0) l++; else d++;
}
const out = { tier, params: C.LEVELS[lv], level: lv, games: N, seed, w, l, d, winPct: Math.round(w / N * 100), avgDiff: +(diffs.reduce((a, b) => a + b, 0) / N).toFixed(1), diffs, taps, missTaps: wrongTaps, wrongMoves, sec: Math.round((Date.now() - t0) / 1000) };
if (!process.env.NOSAVE) fs.appendFileSync(__dirname + '/sim-tiers.jsonl', JSON.stringify(out) + '\n'); console.log(JSON.stringify(out));
