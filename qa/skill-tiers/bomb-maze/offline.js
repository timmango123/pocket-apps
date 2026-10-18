// Offline (no browser) curve check: the look-ahead planner plays stages directly in the engine. node offline.js [from] [to] [step] [seeds] [every] [samples] [react]
const fs = require('fs'), path = require('path');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/bomb-maze/index.html');
const html = fs.readFileSync(APP, 'utf8');
const BM = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BM;')();
const PL = require('./planner')(BM);
const [from = 1, to = 100, stp = 1, seeds = 1, every = 6, samples = 3, react = 0] = process.argv.slice(2).map(Number);
function play(n, seed) {
  const L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [false], seed: n * 31 + 7 + seed * 1000, lives: BM.stageParams(n).lives });
  let f = 0, plan = null, hist = [], dec = 0;
  const b = s.bombers[0];
  while (s.status === 'play' && f < (L.time + 2) * 60) {
    hist.push(PL.cloneSim(s, 1)); if (hist.length > 30) hist.shift();
    if (b.alive && f % every === 0) {
      const view = react ? hist[Math.max(0, hist.length - 1 - react)] : s;
      const v = react ? Object.assign(view, {}) : s;
      if (react) { v.bombers[0].x = b.x; v.bombers[0].y = b.y; v.bombers[0].placed = b.placed; v.bombers[0].onBomb = b.onBomb; }
      plan = PL.decide(v, 0, { samples, seed: f + seed }); dec++;
    }
    let dir = -1, bomb = false;
    if (plan && b.alive) {
      while (plan.path.length && PL.dirTo(b, plan.path[0], s.w, 0.07) < 0) plan.path.shift();
      if (plan.path.length) dir = PL.dirTo(b, plan.path[0], s.w, 0.03);
      if (plan.bomb) { bomb = true; plan.bomb = false; }
    }
    BM.setInput(s, 0, dir, bomb);
    BM.stepOnce(s, 1 / 60); s.events.length = 0; f++;
  }
  return { n, won: s.status === 'won', t: Math.round(s.time), deaths: s.deaths, kills: s.kills, left: s.enemies.filter(e => e.alive).length, types: s.enemies.filter(e => e.alive).map(e => 'rcwdL'[e.t]).join(''), dec };
}
let won = 0, tot = 0; const t0 = Date.now(); const rows = [];
for (let n = from; n <= to; n += stp) for (let sd = 0; sd < seeds; sd++) {
  const r = play(n, sd); tot++; if (r.won) won++;
  rows.push(`${n}${r.won ? '✔' : '✘'}t${r.t}d${r.deaths}${r.won ? '' : 'L' + r.left + r.types}`);
}
console.log(rows.join(' '));
console.log('won', won, '/', tot, 'wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
