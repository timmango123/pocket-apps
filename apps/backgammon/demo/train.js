// TD(0) self-play refinement of the contact evaluator weights (0-ply greedy play, logistic output, cross-entropy gradient).
// How the embedded TRAINED weights were made: 20k games from hand weights (alpha .004), then 80k more (alpha .002).
// Usage: node train.js ../index.html <games> [alpha] [startWeights.json] [baselineWeights.json] > weights.json  (starts from the embedded weights)
const fs = require('fs');
const [file, games = 20000, alpha0 = 0.004, start, base] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const mk = w => new Function((w ? src.replace(/var TRAINED = \[[^\]]*\];/, () => 'var TRAINED = ' + w + ';') : src) + ';return BG;')();
const BG = mk(start ? fs.readFileSync(start, 'utf8').trim() : null);
const BASE = mk(base ? fs.readFileSync(base, 'utf8').trim() : null);
const NF = BG.NF, W = BG.W, F = new Float32Array(NF);
const R = BG.rng(12345);
const sig = x => 1 / (1 + Math.exp(-x));
const vOf = p => { BG.feats(p, F); let s = 0; for (let i = 0; i < NF; i++) s += W[i] * F[i]; return sig(s); };
function value(p) { // win prob for side on roll p
  return BG.contact(p) ? vOf(p) : BG.evalRace(p).w;
}
function selfPlay(alpha) {
  let q = BG.initial('std'); let first = true, d;
  do { d = [1 + Math.floor(R() * 6), 1 + Math.floor(R() * 6)]; } while (d[0] === d[1]);
  const G = new Float32Array(NF);
  for (let t = 0; t < 2000; t++) {
    if (!first) d = [1 + Math.floor(R() * 6), 1 + Math.floor(R() * 6)]; first = false;
    const ms = BG.genRoll(q, d[0], d[1]);
    let best = null, bv = -1;
    for (const m of ms) {
      let v; if (BG.onBoard(m.pos) === 0) v = 1; else v = 1 - value(BG.flip(m.pos));
      if (v > bv) { bv = v; best = m; }
    }
    // TD update for the position before moving (q, on roll) toward the value of the chosen continuation
    if (BG.contact(q)) {
      BG.feats(q, G); let s = 0; for (let i = 0; i < NF; i++) s += W[i] * G[i];
      const v = sig(s), delta = bv - v;
      for (let i = 0; i < NF; i++) if (G[i]) W[i] += alpha * delta * G[i];
    }
    if (BG.onBoard(best.pos) === 0) return t;
    q = BG.flip(best.pos);
  }
  return -1;
}
function bench(n) { // trained (side 0) vs hand weights (side 1), 0-ply greedy, alternating first move
  let won = 0, pts = 0; const RR = BG.rng(777);
  for (let g = 0; g < n; g++) {
    let side = g & 1, q = BG.initial('std'), first = true, d;
    do { d = [1 + Math.floor(RR() * 6), 1 + Math.floor(RR() * 6)]; } while (d[0] === d[1]);
    for (let t = 0; t < 3000; t++) {
      if (!first) d = [1 + Math.floor(RR() * 6), 1 + Math.floor(RR() * 6)]; first = false;
      const E = side === 0 ? BG : BASE;
      const r = E.think({ pos: Array.from(q), dice: d, level: 3, seed: 1, budget: 1e9 });
      // level 3 has err 0.05; neutralise by seed choice not possible -> use afterValue directly
      const ms = E.genRoll(q, d[0], d[1]); let best = null, bv = -9;
      for (const m of ms) { const v = E.afterValue(m.pos, E.evaluate, 1); if (v > bv) { bv = v; best = m; } }
      q = best.pos;
      if (E.onBoard(q) === 0) { const k = E.resultKind(q); if (side === 0) { won++; pts += k; } else pts -= k; break; }
      q = E.flip(q); side ^= 1;
    }
  }
  return [won / n, pts / n];
}
const t0 = Date.now();
console.error('start bench', bench(400));
for (let g = 1; g <= +games; g++) {
  const alpha = alpha0 * (g < games * 0.6 ? 1 : 0.4);
  selfPlay(alpha);
  if (g % 10000 === 0) console.error(g, ((Date.now() - t0) / 1000).toFixed(0) + 's', 'bench vs hand', bench(400).map(x => x.toFixed(3)).join(' '));
}
console.log(JSON.stringify(Array.from(W, x => +x.toFixed(4))));
