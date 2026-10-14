// Offline level generator for 群島橋匠 (hashi). Uses the game's own core (CORE-START/CORE-END in ../index.html,
// or a file given with --core). For each level it builds many seeded candidates (random bridge tree + extra bridges),
// keeps only those the logic solver finishes on its own (=> unique solution), then picks the candidate closest to the
// target score S(L) = 15 x 1.035^L while forcing every level to score clearly higher than the one before.
// Usage: node gen.js [--core file] [--out levels.json] [--cache dir]  (candidate pools are cached per level in --cache)
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const args = process.argv.slice(2);
const coreFile = args.includes('--core') ? args[args.indexOf('--core') + 1] : path.join(__dirname, '..', 'index.html');
const outFile = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(__dirname, 'levels.json');
const src = fs.readFileSync(coreFile, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {makeCandidate, levelParams};')();
const cacheDir = args.includes('--cache') ? args[args.indexOf('--cache') + 1] : path.join(require('os').tmpdir(), 'hashi-pools');
fs.mkdirSync(cacheDir, { recursive: true });
const nCand = L => L < 40 ? 600 : L < 60 ? 1500 : L < 85 ? 3000 : 5000;

if (process.env.HASHI_WORKER) {
  process.on('message', ({ levels }) => {
    const out = {};
    for (const L of levels) {
      const cf = path.join(cacheDir, L + '.json');
      if (fs.existsSync(cf)) { out[L] = JSON.parse(fs.readFileSync(cf, 'utf8')); continue; }
      const pr = C.levelParams(L), list = [];
      for (let s = 1; s <= nCand(L); s++) {
        const c = C.makeCandidate(L, L * 1000003 + s * 7919);
        if (!c) continue;
        if (pr.needIso && !c.used.iso) continue;
        if (pr.needTrial && !c.used.trial) continue;
        if (pr.dense && !c.n78) continue;
        list.push(c);
      }
      out[L] = list.map(c => ({ s: c.s, score: c.score, islands: c.islands, used: c.used, n78: c.n78 }));
      fs.writeFileSync(cf, JSON.stringify(out[L]));
    }
    process.send(out, () => process.exit(0));
  });
} else {
  (async () => {
    const t0 = Date.now(), W = 4, buckets = [...Array(W)].map(() => []);
    // interleave heavy levels across workers
    for (let L = 100; L >= 1; L--) buckets[(100 - L) % W].push(L);
    const pools = {};
    await Promise.all(buckets.map(levels => new Promise(res => {
      const ch = fork(__filename, process.argv.slice(2), { env: { ...process.env, HASHI_WORKER: '1' } });
      ch.on('message', m => { Object.assign(pools, m); res(); });
      ch.send({ levels });
    })));
    console.log('pools built in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
    // backward pass: highest score each level may take so that a strictly rising chain to level 100 still exists
    const step = s => Math.max(s + 1, s * 1.02), cap = {};
    cap[100] = Math.max(...pools[100].map(c => c.score));
    for (let L = 99; L >= 1; L--) cap[L] = Math.max(-1, ...pools[L].map(c => c.score).filter(s => step(s) <= cap[L + 1]));
    const picked = []; let prev = 0;
    for (let L = 1; L <= 100; L++) {
      const pr = C.levelParams(L);
      const min = Math.max(prev + 1, prev * 1.02);
      let ok = pools[L].filter(c => c.score >= min && c.score <= cap[L]);
      if (!ok.length) { console.log('LEVEL', L, 'no candidate above', min.toFixed(1), 'pool', pools[L].length, 'max', Math.max(...pools[L].map(c => c.score))); process.exit(1); }
      ok.sort((a, b) => Math.abs(a.score - pr.target) - Math.abs(b.score - pr.target));
      const c = ok[0]; prev = c.score;
      picked.push({ L, s: c.s, score: c.score, target: Math.round(pr.target), islands: c.islands, used: c.used, n78: c.n78, pool: pools[L].length });
    }
    fs.writeFileSync(outFile, JSON.stringify(picked));
    for (const p of picked) if (p.L % 10 === 0 || p.L <= 3 || [20, 40, 60, 85].includes(p.L)) console.log('L' + p.L, 'islands', p.islands, 'score', p.score, 'target', p.target, 'trial', p.used.trial, 'iso', p.used.iso, 'n78', p.n78, 'pool', p.pool);
    console.log('done in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  })();
}
