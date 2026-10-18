// Picks a layout variant for every stage so the built-in brain's clear rate follows a smooth falling curve
// (difficulty rises steadily instead of jumping around from one random layout to the next).
//  phase 1: every variant 0..V-1 of a stage on S1 seeds; phase 2: the K variants closest to the target again on S2
//  fresh seeds (this keeps lucky estimates from winning); the closest one in phase 2 is kept, ties to the lower variant.
// Seeds 21.. are used here; brain-sweep.js reports on seeds 1-20, which this never sees.
// node remix.js [V=10] [S1=40] [K=3] [S2=80] [workers=3]   -> prints the REMIX table for index.html
// LEVELS=21,32 node remix.js ...  re-tunes only those stages (the table printed then lists just their picks)
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/bomb-maze/index.html');
const BM = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BM;')();
const target = n => 1 - 0.42 * (n - 1) / 99;   // stage 1: always, stage 100: a bit over half the time
function wins(n, v, s0, seeds) {
  BM.REMIX[n - 1] = v; let w = 0;
  for (let sd = s0; sd < s0 + seeds; sd++) {
    const L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [true], seed: sd * 977 + n, skill: 2, lives: BM.stageParams(n).lives });
    let t = 0; while (s.status === 'play' && t < L.time + 1) { BM.tick(s, 1 / 60); t += 1 / 60; s.events.length = 0; }
    if (s.status === 'won') w++;
  }
  return w / seeds;
}
function tune(n, V, S1, K, S2) {
  const tg = target(n), p1 = Array.from({ length: V }, (_, v) => wins(n, v, 21, S1));
  const cand = p1.map((p, v) => ({ v, d: Math.abs(p - tg) })).sort((a, b) => a.d - b.d || a.v - b.v).slice(0, K);
  for (const c of cand) { c.p2 = wins(n, c.v, 21 + S1, S2); c.d2 = Math.abs(c.p2 - tg); }
  cand.sort((a, b) => a.d2 - b.d2 || a.v - b.v);
  return { n, tg, p1, cand, pick: cand[0].v };
}
if (process.argv[2] === '--child') {
  process.on('message', ({ levels, a }) => { process.send(levels.map(n => tune(n, ...a))); process.exit(0); });
} else {
  const [V = 10, S1 = 40, K = 3, S2 = 80, workers = 3] = process.argv.slice(2).map(Number);
  const levels = process.env.LEVELS ? process.env.LEVELS.split(',').map(Number) : Array.from({ length: 100 }, (_, i) => i + 1), parts = Array.from({ length: workers }, (_, i) => levels.filter((_, k) => k % workers === i));
  Promise.all(parts.map(lv => new Promise(res => { const c = fork(__filename, ['--child'], { env: process.env }); c.on('message', res); c.send({ levels: lv, a: [V, S1, K, S2] }); }))).then(all => {
    const rows = all.flat().sort((a, b) => a.n - b.n);
    for (const r of rows) console.log(r.n, 'target', r.tg.toFixed(2), 'p1', r.p1.map(p => p.toFixed(2)).join(' '), 'p2', r.cand.map(c => 'v' + c.v + ':' + c.p2.toFixed(2)).join(' '), '-> v' + r.pick);
    console.log('var REMIX = [' + rows.map(r => r.pick).join(',') + '];');
  });
}
