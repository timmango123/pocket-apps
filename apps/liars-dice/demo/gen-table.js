// Precomputes the 高手 AI's heads-up table (近似均衡策略表) for small dice states, using the game's own core.
// For each heads-up state (my dice a, opponent dice b, 1..5 each) the 高手 AI picks a bluff rate and a continuation value
// (how much a raise that is not called is worth). We play single rounds between every pair of candidate strategies
// (common random dice), solve the resulting zero-sum matrix game by fictitious play, and keep the equilibrium-weighted
// mean of each side's parameters. Prints a JS literal that is pasted into the core as HU.
// Usage: node gen-table.js [rounds-per-pair]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const LD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn LD;')();
LD.warm();
const M = +process.argv[2] || 300;
const BR = [0.1, 0.25, 0.4], VC = [0.5, 0.62, 0.75], STR = [];
BR.forEach(br => VC.forEach(vc => STR.push({ br, vch: vc })));
function round(a, b, sx, sy, seed) { // returns 1 if the a-dice player (strategy sx) wins the round
  const g = LD.newGame({ n: 2, mode: 'dice', special: true, start: 'players', seed, first: seed & 1 });
  g.P[0].dice = a; g.P[1].dice = b; g.P[0].palDone = g.P[1].palDone = true;
  LD.startRound(g); const R = LD.rng(seed ^ 0xabcdef);
  for (let k = 0; k < 60; k++) {
    const p = g.turn, v = LD.viewFor(g, p, { lvl: 2, pers: { bold: 0.5, bluff: 1, grudge: 0 }, seed: (R() * 4294967295) >>> 0, x: Object.assign({ cm: -0.25, vc4: 0.85 }, p === 0 ? sx : sy) });
    const act = LD.think(v);
    if (act.act === 'call') { const r = LD.doCall(g); return r.loser === 1 ? 1 : 0; }
    LD.doBid(g, { q: act.q, f: act.f });
  }
  return 0.5;
}
function solve(A) { // fictitious play on payoff matrix A (row maximises)
  const n = A.length, m = A[0].length, rc = new Array(n).fill(0), cc = new Array(m).fill(0), rs = new Array(n).fill(0), cs = new Array(m).fill(0);
  let r = 0, c = 0;
  for (let it = 0; it < 20000; it++) {
    rc[r]++; cc[c]++;
    for (let i = 0; i < n; i++) rs[i] += A[i][c];
    for (let j = 0; j < m; j++) cs[j] += A[r][j];
    r = rs.indexOf(Math.max(...rs)); c = cs.indexOf(Math.min(...cs));
  }
  const T = rc.reduce((x, y) => x + y);
  return { row: rc.map(x => x / T), col: cc.map(x => x / T) };
}
const HU = {}, t0 = Date.now();
for (let a = 1; a <= 5; a++) for (let b = a; b <= 5; b++) {
  const A = STR.map((sx, i) => STR.map((sy, j) => { let w = 0; for (let k = 0; k < M; k++) w += round(a, b, sx, sy, 7919 * k + 13); return w / M; }));
  const eq = solve(A);
  const mean = (w) => [STR.reduce((s, x, i) => s + w[i] * x.br, 0), STR.reduce((s, x, i) => s + w[i] * x.vch, 0)].map(v => Math.round(v * 100) / 100);
  (HU[a] = HU[a] || {})[b] = mean(eq.row);
  (HU[b] = HU[b] || {})[a] = mean(eq.col);
  const val = eq.row.reduce((s, p, i) => s + p * eq.col.reduce((t, q, j) => t + q * A[i][j], 0), 0);
  console.error(`state ${a}v${b}: value for the ${a}-dice side ${(val * 100).toFixed(1)}%  table ${JSON.stringify(HU[a][b])} / ${JSON.stringify(HU[b][a])}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
console.log(JSON.stringify(HU));
