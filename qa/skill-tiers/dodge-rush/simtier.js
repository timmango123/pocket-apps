// Fast Node replica of tiers.js (same tier params, latency, motor noise, mistakes, decision cadence, finger speed,
// one move per 2 frames at 60 fps) against the game's own core (CORE markers). Used to tune the curve before the real
// browser runs in tiers.js; not evidence on its own.
// node simtier.js <tier> [runs] [cap] [normal|daily|casual]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../../apps/dodge-rush/index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {makeSim, dailyOrder: typeof dailyOrder === "function" ? dailyOrder : null};')();
const { decide, TIERS, mulberry, gauss } = require('./botlib.js');
function snapOf(sim) { const b = [], m = sim.mult(), n = sim.count(); for (let i = 0; i < n; i++) if (sim.harmful(i)) b.push(Math.round(sim.X[i]), Math.round(sim.Y[i]), Math.round(sim.VX[i] * m), Math.round(sim.VY[i] * m), sim.R[i] * 0.8); return { t: sim.t, px: sim.px, py: sim.py, L: sim.L, R: sim.Rr, T: sim.T, B: sim.Bt, glow: sim.glow, bt: sim.bt, b }; }
const tierId = process.argv[2] || 'casual', runs = +(process.argv[3] || 10), cap = +(process.argv[4] || 240), mode = process.argv[5] || 'normal';
const P = TIERS[tierId], out = [];
for (let r = 0; r < runs; r++) {
  const rnd = mulberry(7919 * (r + 1) + tierId.length * 31 + (mode === 'daily' ? 5 : mode === 'casual' ? 11 : 0));
  const seed = 4242 + r * 977;
  const o = { w: 390, h: 844, left: 10, right: 380, top: 64, bottom: 832, seed, mode: mode === 'casual' ? 'casual' : mode === 'daily' ? 'daily' : 'normal', limit: mode === 'daily' ? 60 : 0 };
  if (mode === 'daily' && core.dailyOrder) o.order = core.dailyOrder(seed);
  const sim = core.makeSim(o);
  const F = 2, dt = F / 60, hist = []; let target = [sim.px, sim.py], nextDec = 0;
  while (!sim.dead && !sim.done && sim.t < cap) {
    for (let k = 0; k < F; k++) sim.step(1 / 60);
    if (sim.dead || sim.done) break;
    const sn = snapOf(sim); hist.push(sn); if (hist.length > 200) hist.shift();
    if (sn.t >= nextDec) {
      nextDec = sn.t + Math.max(0.016, (P.dec + gauss(rnd) * P.tim) / 1000);
      const lat = Math.max(0.016, (P.lat[0] + gauss(rnd) * P.lat[1]) / 1000);
      let view = hist[0]; for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= sn.t - lat + 1e-6) { view = hist[i]; break; }
      if (tierId === 'superhuman') view = sn;
      const sc = decide(view, sn.px, sn.py, (sn.t - view.t) * P.comp, P);
      let pick = sc[0]; const x = rnd();
      if (x < P.mistake) pick = sc[Math.floor(rnd() * sc.length)];
      else if (x < P.mistake + P.randomFrac) { const small = sc.filter(s => s.c[2] <= 52); pick = small[Math.floor(rnd() * small.length)] || pick; }
      target = [pick.c[0] + gauss(rnd) * P.pos * 0.5, pick.c[1] + gauss(rnd) * P.pos * 0.5];
      if (P.bt && sim.glow >= 100 && sim.bt <= 0 && sc[0].cost > 2500 && rnd() < P.bt) sim.trigger();
    }
    const dx = target[0] - sim.px, dy = target[1] - sim.py, l = Math.hypot(dx, dy), mv = Math.min(l, P.V * dt);
    if (l > 0.5) { sim.px += dx / l * mv; sim.py += dy / l * mv; sim.clamp(); }
  }
  out.push(+sim.t.toFixed(1) + (sim.dead ? ':' + sim.dieBy : sim.done ? ':done' : ''));
}
console.log(tierId, mode, out.join(' '));
