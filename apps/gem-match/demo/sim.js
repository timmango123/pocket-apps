// Level simulator for 深海珍珠 (gem-match): uses the game's own core (extracted from ../index.html between
// CORE markers) and its greedy AI (goal contribution > special gems > score, 1-move lookahead, no peeking at
// refills) to play every one of the 100 levels RUNS times (default 500) with different attempt seeds.
// Prints pass rate P per level, the 難度 shown in game, solvability (at least one AI win) and monotonicity checks.
// Usage: node sim.js [runs] [workers]
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const core = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const TUNE = JSON.parse(html.match(/var TUNE = (\[[\s\S]*?\]);/)[1]);
if (isMainThread) {
  const RUNS = +(process.argv[2] || 500), NW = +(process.argv[3] || 3), res = [];
  let next = 1, active = 0; const t0 = Date.now();
  const done = () => {
    res.sort((a, b) => a.n - b.n);
    console.log('lvl  goals                         moves   P(pass)  難度  avgScore');
    for (const r of res) console.log(String(r.n).padStart(3), ' ', r.goals.padEnd(30), String(r.moves).padStart(4), '  ', (r.P * 100).toFixed(1).padStart(5) + '%', '  ', String(TUNE[r.n - 1][2]).padStart(2), '  ', r.avg);
    const P = res.map(r => r.P), unsolved = res.filter(r => r.wins === 0).map(r => r.n);
    const inRange = res.filter(r => r.P >= 0.15 && r.P <= 0.95).length;
    const blocks = []; for (let b = 0; b < 10; b++) blocks.push(P.slice(b * 10, b * 10 + 10).reduce((a, x) => a + x, 0) / 10);
    let blockDec = true; for (let b = 1; b < 10; b++) if (blocks[b] >= blocks[b - 1]) blockDec = false;
    let Dmono = true; for (let i = 1; i < 100; i++) if (TUNE[i][2] < TUNE[i - 1][2]) Dmono = false;
    // Spearman-like check: correlation between level number and P
    const mean = P.reduce((a, x) => a + x, 0) / 100, mn = 50.5; let sxy = 0, sxx = 0, syy = 0;
    P.forEach((p, i) => { sxy += (i + 1 - mn) * (p - mean); sxx += (i + 1 - mn) ** 2; syy += (p - mean) ** 2; });
    console.log('\nSUMMARY (' + RUNS + ' AI games per level, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
    console.log('  levels with >=1 AI win (solvable):', 100 - unsolved.length, '/ 100', unsolved.length ? 'UNSOLVED: ' + unsolved.join(',') : '');
    console.log('  pass rate within [15%, 95%]:', inRange, '/ 100   min', (Math.min(...P) * 100).toFixed(1) + '%', 'max', (Math.max(...P) * 100).toFixed(1) + '%');
    console.log('  level 1 P', (P[0] * 100).toFixed(1) + '%', ' level 50 P', (P[49] * 100).toFixed(1) + '%', ' level 100 P', (P[99] * 100).toFixed(1) + '%');
    console.log('  10-level block average P:', blocks.map(x => (x * 100).toFixed(0) + '%').join(' > '), blockDec ? '(strictly decreasing)' : '(NOT strictly decreasing)');
    console.log('  correlation(level, P):', (sxy / Math.sqrt(sxx * syy)).toFixed(3));
    console.log('  in-game 難度 non-decreasing over levels:', Dmono, ' 難度 range', TUNE[0][2], '->', TUNE[99][2]);
    fs.writeFileSync(path.join(__dirname, 'sim-results.json'), JSON.stringify(res.map(r => ({ n: r.n, P: r.P, moves: r.moves, goals: r.goals, D: TUNE[r.n - 1][2] }))));
  };
  for (let i = 0; i < NW; i++) {
    const w = new Worker(__filename, { workerData: { RUNS } }); active++;
    w.on('message', m => { res.push(m); if (next <= 100) w.postMessage(next++); else { w.terminate(); if (--active === 0) done(); } });
    w.postMessage(next++);
  }
} else {
  const C = new Function(core + '\nreturn {levelDef, simulate};')();
  parentPort.on('message', n => {
    const t = TUNE[n - 1], L = C.levelDef(n, t[0] / 100, t[1], t[3]); let wins = 0, sc = 0;
    for (let s = 0; s < workerData.RUNS; s++) { const r = C.simulate(L, 0x51ed27 + s * 104729 + n * 31); if (r.win) wins++; sc += r.score; }
    parentPort.postMessage({ n, P: wins / workerData.RUNS, wins, moves: L.moves, avg: Math.round(sc / workerData.RUNS), goals: L.goals.map(g => g.t + (g.t === 'collect' ? '#' + g.c : '') + ':' + g.q).join(' + ') });
  });
}
