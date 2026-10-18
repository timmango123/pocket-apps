// Offline curve check with the game's own CPU brain (skill 2 = the 熟練 tier without reaction delay): every stage,
// a few seeds each, straight in the engine (no browser). Prints wins per stage and per block of ten.
// node brain-sweep.js [from=1] [to=100] [seeds=3] [workers=3]      (APP=path/to/index.html to test another build)
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/bomb-maze/index.html');
const BM = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BM;')();
function play(n, sd) {
  const L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [true], seed: sd * 977 + n, skill: 2, lives: BM.stageParams(n).lives });
  let t = 0, why = '';
  while (s.status === 'play' && t < L.time + 1) { BM.tick(s, 1 / 60); t += 1 / 60; for (const e of s.events) if (e.t === 'lose') why = e.why; s.events.length = 0; }
  return { won: s.status === 'won', t: Math.round(s.time), why, deaths: s.deaths, left: s.enemies.filter(e => e.alive).length };
}
if (process.argv[2] === '--child') {
  process.on('message', ({ levels, seeds }) => {
    const out = []; for (const n of levels) { const r = []; for (let sd = 1; sd <= seeds; sd++) r.push(play(n, sd)); out.push({ n, r }); }
    process.send(out); process.exit(0);
  });
} else {
  const [from = 1, to = 100, seeds = 3, workers = 3] = process.argv.slice(2).map(Number);
  const levels = []; for (let n = from; n <= to; n++) levels.push(n);
  const t0 = Date.now(), parts = Array.from({ length: workers }, (_, i) => levels.filter((_, k) => k % workers === i));
  Promise.all(parts.map(lv => new Promise(res => { const c = fork(__filename, ['--child'], { env: process.env }); c.on('message', res); c.send({ levels: lv, seeds }); }))).then(all => {
    const rows = all.flat().sort((a, b) => a.n - b.n); let tot = 0; const blocks = {};
    for (const { n, r } of rows) {
      const w = r.filter(x => x.won).length; tot += w; const b = Math.floor((n - 1) / 10); blocks[b] = (blocks[b] || 0) + w;
      console.log(`${n}${BM.stageParams(n).boss ? 'B' : BM.stageParams(n).special === 'crates' ? 'C' : ' '} ${w}/${seeds} ` + r.map(x => x.won ? 'W' + x.t : x.why[0] + x.left).join(' '));
    }
    console.log('blocks', Object.keys(blocks).map(b => blocks[b]).join(' '), 'total', tot, '/', levels.length * seeds, 'zero:', rows.filter(x => !x.r.some(y => y.won)).map(x => x.n).join(','), 'wall', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });
}
