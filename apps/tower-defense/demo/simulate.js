// Headless verification for 菇菇守城 (tower-defense) using the game's own core (extracted between CORE-START/CORE-END).
// For every one of the 100 levels it:
//   1) regenerates the level and checks it matches the page's embedded LVTAB (bump steps + difficulty D),
//   2) checks difficulty D is strictly increasing,
//   3) runs the greedy + local-search bot (placement by path coverage x tower DPS, spending all spores before each wave)
//      through the full deterministic simulation and requires a win with >= 1 life,
//   4) checks the level is NOT winnable without building towers.
// Usage: node simulate.js [--jobs N] [levels...]
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const Core = new Function(coreSrc + '\nreturn Core;')();
const LVTAB = JSON.parse(html.match(/var LVTAB = (\[[^;]*\]);/)[1]);

function checkLevel(n){
  const L = Core.genAll()[n-1];
  const t0 = Date.now(); const r = Core.botSolve(L, 12);
  const s = Core.newGame(L, {}); while (s.phase !== 'won' && s.phase !== 'lost'){ if (s.phase === 'build') Core.callWave(s, false); Core.step(s); }
  const st = Core.levelStats(L);
  return {n, D:L.D, bk:L.bk, paths:L.paths.length, waves:L.waves.length, effHP:Math.round(st.effHP), spores:st.spores, win:r.win, lives:r.lives, towers:r.towers, kills:r.kills, strat:r.si, noTowers:s.phase, noTowerWave:s.wave, ms:Date.now()-t0};
}
if (process.argv[2] === '--child'){
  process.on('message', m => { for (const n of m.levels) process.send(checkLevel(n)); process.exit(0); });
  return;
}
(async () => {
  const args = process.argv.slice(2);
  let jobs = 4; const ji = args.indexOf('--jobs'); if (ji >= 0){ jobs = +args[ji+1]; args.splice(ji, 2); }
  const levels = args.length ? args.map(Number) : Array.from({length:100}, (_, i) => i+1);
  // 1+2: table + monotonic difficulty
  const all = Core.genAll(); let tableOK = true, mono = true;
  all.forEach((L, i) => { if (LVTAB[i][0] !== L.bk || LVTAB[i][1] !== L.D) tableOK = false; if (i && L.D <= all[i-1].D) mono = false; });
  console.log('Levels:', all.length, '| embedded LVTAB matches generator:', tableOK, '| difficulty D strictly increasing:', mono, '| D range', all[0].D, '->', all[99].D);
  const res = [];
  await new Promise(done => {
    let left = jobs;
    for (let j = 0; j < jobs; j++){
      const ch = fork(__filename, ['--child']);
      ch.on('message', r => res.push(r)); ch.on('exit', () => { if (--left === 0) done(); });
      ch.send({levels: levels.filter((n, i) => i % jobs === j)});
    }
  });
  res.sort((a, b) => a.n - b.n);
  for (const r of res) console.log(`L${String(r.n).padStart(3)}  D ${String(r.D).padStart(3)}  paths ${r.paths}  waves ${String(r.waves).padStart(2)}  effHP ${String(r.effHP).padStart(7)}  spores ${String(r.spores).padStart(5)}  bot ${r.win ? 'WIN ' : 'LOSS'} lives ${String(r.lives).padStart(2)}  towers ${String(r.towers).padStart(2)}  (strategy ${r.strat})  no-tower run: ${r.noTowers} at wave ${r.noTowerWave + 1}`);
  const wins = res.filter(r => r.win).length, needT = res.filter(r => r.noTowers === 'lost').length;
  const dist = {}; res.forEach(r => { const k = r.lives >= 20 ? '20' : r.lives >= 10 ? '10-19' : r.lives >= 1 ? '1-9' : '0'; dist[k] = (dist[k] || 0) + 1; });
  console.log('\nSUMMARY: bot cleared', wins, '/', res.length, 'levels | levels that need towers (lost with none):', needT, '/', res.length, '| remaining-lives distribution', JSON.stringify(dist));
  console.log('ALL OK:', tableOK && mono && wins === res.length && needT === res.length);
})();
