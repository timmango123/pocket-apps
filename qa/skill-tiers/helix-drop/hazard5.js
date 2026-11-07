// Per-layer hazard in 5-layer bands (died in band / entered band) for casual (150 runs) and skilled (60 runs).
const M = require('./sim.js'); const fs = require('fs');
const out = {};
for (const [t, n, cap] of [['casual', 150, 200], ['skilled', 60, 300]]) {
  const deaths = [], reached = [];
  for (let k = 1; k <= n; k++) { const r = M.play(t, 9000 + k * 53, 'endless', false, cap); reached.push(r.layersReached); if (r.dead) deaths.push(r.death.layer); }
  const rows = []; for (let a = 1; a < 100; a += 5) { const b = a + 4, e = reached.filter(x => x >= a).length; if (!e) break; const d = deaths.filter(x => x >= a && x <= b).length; rows.push({ band: a + '-' + b, entered: e, died: d, perLayer: +(1 - Math.pow(1 - d / e, 1 / 5)).toFixed(3) }); }
  out[t] = rows; console.log(t.padEnd(8), rows.map(x => `${x.band}:${x.died}/${x.entered}`).join(' '));
}
fs.writeFileSync(__dirname + '/hazard5.json', JSON.stringify(out, null, 1));
