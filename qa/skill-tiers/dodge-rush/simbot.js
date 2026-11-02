// Fast Node check of the tier bots' decision code against the game's own core (CORE markers). Used to tune the bots
// before the real-browser runs in tiers.js; not evidence on its own.
const fs = require('fs');
const html = fs.readFileSync('' + require('path').resolve(__dirname, '../../../apps/dodge-rush/index.html') + '', 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {makeSim};')();
const { decide, TIERS } = require('./botlib.js');
function snapOf(sim) { const b = [], m = sim.mult(), n = sim.count(); for (let i = 0; i < n; i++) if (sim.harmful(i)) b.push(sim.X[i], sim.Y[i], sim.VX[i] * m, sim.VY[i] * m, sim.R[i] * 0.8); return { t: sim.t, px: sim.px, py: sim.py, L: sim.L, R: sim.Rr, T: sim.T, B: sim.Bt, glow: sim.glow, bt: sim.bt, b }; }
const tier = process.argv[2] || 'superhuman', runs = +(process.argv[3] || 10), cap = +(process.argv[4] || 240);
const P = TIERS[tier]; const out = [];
for (let r = 0; r < runs; r++) {
  const sim = core.makeSim({ w: 390, h: 844, left: 10, right: 380, top: 64, bottom: 832, seed: 1234 + r * 977 });
  let target = [sim.px, sim.py]; const F = 2, dt = F / 60;
  while (!sim.dead && sim.t < cap) {
    const sn = snapOf(sim); const sc = decide(sn, sim.px, sim.py, 0, P); target = sc[0].c;
    if (sim.glow >= 100 && sc[0].cost > 2500) sim.trigger();
    const dx = target[0] - sim.px, dy = target[1] - sim.py, l = Math.hypot(dx, dy), mv = Math.min(l, P.V * dt);
    if (l > 0.5) { sim.px += dx / l * mv; sim.py += dy / l * mv; sim.clamp(); }
    sim.step(dt);
  }
  out.push(+sim.t.toFixed(1) + (sim.dead ? ':' + sim.dieBy : ''));
}
console.log(tier, out.join(' '));
