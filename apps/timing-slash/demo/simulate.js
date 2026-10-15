// Human-model verification for 月下居合 (timing-slash), using the game's own core code (CORE-START..CORE-END).
// Model (spec §五): predictive player taps at the predicted moment the blade reaches a talisman's centre, with N(0, 15 ms)
// timing error; after a reversal / speed change / new talisman it needs 150 ms before it can re-predict; taps are >=150 ms apart.
// For every level: 1000 simulated runs -> success rate (must be >= 50 %), plus checks of the spec's parameter rules.
// Usage: node simulate.js [runs]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {NL, params, simulate, diffN, rawDiff, newGame, tap, peak, angd, tc, ptrA, TAU};')();
const N = +process.argv[2] || 1000, SIG = 0.015;
let ok = true, minRate = 1, minRateL = 0, prevD = 0, monotone = true, minPass = 1, minGapT = 9;
const rows = [];
for (let L = 1; L <= C.NL; L++) {
  const p = C.params(L);
  let win = 0, time = 0, miss = 0, perf = 0, cut = 0;
  for (let s = 0; s < N; s++) { const r = C.simulate(p, L * 100003 + s, SIG); win += r.win; time += r.time; miss += r.miss; perf += r.perfect; cut += r.cut; }
  const rate = win / N, D = C.rawDiff(p), pass = p.w / p.om;
  if (D <= prevD) monotone = false; prevD = D;
  minPass = Math.min(minPass, pass);
  // spacing rule: real talismans on a ring must be >= 250 ms of blade travel apart (at the ring's peak speed) at level start
  const G = C.newGame(p, {}, 0);
  for (const r of G.rings) { const re = r.tg.filter(g => !g.fake); for (let i = 0; i < re.length; i++) for (let j = i + 1; j < re.length; j++) minGapT = Math.min(minGapT, C.angd(re[i].c0, re[j].c0) / C.peak(G, r)); }
  if (rate < 0.5) ok = false;
  if (rate < minRate) { minRate = rate; minRateL = L; }
  rows.push({ L, rate, t: time / N, miss: miss / N, perf: cut ? perf / cut : 0, D: C.diffN(L), om: p.om, w: p.w, K: p.K, lives: p.lives, pass });
}
console.log('月下居合 human-model simulation: ' + N + ' runs/level, timing sigma 15 ms, 150 ms re-predict delay');
console.log(' lvl  win%   avg-s  miss  perfect%  diff   omega   w(deg)  K  lives  pass-ms');
for (const r of rows) if (r.L <= 3 || r.L % 5 === 0 || r.L >= 98 || [16, 36, 46, 56, 66, 81, 91].includes(r.L))
  console.log(String(r.L).padStart(4), (r.rate * 100).toFixed(1).padStart(6), r.t.toFixed(1).padStart(7), r.miss.toFixed(2).padStart(5), (r.perf * 100).toFixed(0).padStart(8), String(r.D).padStart(6),
    r.om.toFixed(2).padStart(7), (r.w * 180 / Math.PI).toFixed(1).padStart(8), String(r.K).padStart(3), String(r.lives).padStart(5), (r.pass * 1000).toFixed(0).padStart(8));
console.log('All levels success >= 50%:', ok, '| lowest', (minRate * 100).toFixed(1) + '% at level ' + minRateL);
console.log('Combined difficulty (omega/w * sqrt(K) * mechanics) strictly increasing every level:', monotone);
console.log('Min blade pass time over a talisman (w/omega):', (minPass * 1000).toFixed(1), 'ms (spec >= 40 ms)');
console.log('Min gap between real talismans at peak blade speed:', (minGapT * 1000).toFixed(0), 'ms (spec >= 250 ms)');
process.exitCode = ok && monotone && minPass >= 0.04 && minGapT >= 0.25 ? 0 : 1;
