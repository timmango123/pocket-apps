// Offline level picker for 銅管水坊 (pipe-flow): node gen.js [--write]
// Uses the game's own core (between CORE-START/CORE-END in ../index.html). For each level L it tries seeds
// L*7919 + attempt*104729 (attempt = 0,1,2,...). par = the exact minimum number of turns (a counter-clockwise long-press
// counts as one) found by the core solver's exhaustive branch-and-bound over leak-free solutions. It keeps the attempt
// whose par is closest to a smooth target curve while being strictly larger than the previous level's par, so the
// difficulty metric (spec formula + par) rises every level. --write embeds [attempt, par, difficulty] into index.html.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(process.env.CORE || APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {generate, params, solve};')();

function target(L) {
  if (L <= 50) return Math.round(3 + 55 * Math.pow((L - 1) / 49, 1.35));
  return Math.round(58 + 50 * (L - 50) / 50); // 12x12 from L50: +1 rotation per level on average
}
const LIMIT = 3000000;
const out = []; let prevPar = 0, prevD = 0;
for (let L = 1; L <= 100; L++) {
  const T = target(L); let best = null, bestScore = 1e9;
  for (let a = 0; a < 3000; a++) {
    const Lv = core.generate(L, a); if (!Lv) continue;
    if (Lv.par <= prevPar) continue; // exact optimum can only be lower than the generator's own route
    const r = core.solve(Lv, LIMIT, true);
    if (!r.ok || !r.exhausted) continue;
    Lv.par = r.cost; Lv.diff = Math.round(Lv.P.base + r.cost);
    if (Lv.par <= prevPar || Lv.diff <= prevD) continue;
    const sc = Math.abs(Lv.par - Math.max(T, prevPar + 1));
    if (sc < bestScore) { bestScore = sc; best = Lv; if (sc === 0) break; }
  }
  if (!best) { console.error('no attempt for level', L); process.exit(1); }
  out.push([best.attempt, best.par, best.diff]); prevPar = best.par; prevD = best.diff;
}
console.log(out.map((e, i) => (i + 1) + ':' + e.join('/')).join(' '));
if (process.argv.includes('--write')) {
  const src = fs.readFileSync(APP, 'utf8');
  const json = 'var LEVELS = [\n' + out.map(e => JSON.stringify(e)).join(',\n') + '\n];';
  fs.writeFileSync(APP, src.replace(/var LEVELS = \[[\s\S]*?\n\];/, json));
  console.log('written', out.length, 'levels into index.html');
}
