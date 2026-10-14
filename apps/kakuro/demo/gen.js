// Offline level generator for 馬賽克數和 (kakuro). Uses the game's own core (CORE-START/END in ../index.html).
// Phase 1 (pool):   node gen.js pool <from> <to> <poolDir> [secondsPerLevel]
//   generates up to 150 candidate puzzles per level with the level's parameters.
// Phase 2 (select): node gen.js select <poolDir>
//   picks one candidate per level so the human-technique score strictly increases and stays closest to S(L)=20*1.035^L,
//   then writes the 100 encoded levels into ../index.html between LEVELS-START/END.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {genLevel, mkRng, encodeLevel};')();

function levelCfg(L) {
  const size = L <= 10 ? [6, 6] : L <= 25 ? [8, 8] : L <= 45 ? [9, 9] : L <= 65 ? [10, 10] : L <= 85 ? [12, 10] : [12, 12];
  const R = size[0], C = size[1], interior = (R - 1) * (C - 1);
  const W = Math.min(Math.round(16 * Math.pow(1.02, L)), Math.floor(interior * 0.72));
  return {
    L, R, C, W,
    maxRun: L < 40 ? Math.min(6, Math.max(R, C) - 1) : 9,
    minLong: L >= 40 ? 7 : 0,
    maxTier: L < 20 ? 3 : L < 80 ? 4 : 5,
    needTier: L === 20 ? 4 : L === 80 ? 5 : 0,
    preferTier: L < 20 ? 0 : L < 80 ? 4 : 5,
    hide: L < 60 ? 0 : L < 80 ? 2 : 3,
    fixIt: 120, nodeCap: 20000,
    target: 20 * Math.pow(1.035, L),
    ratioTarget: 0.05 + 0.30 * (L - 1) / 99,
  };
}

function pool(from, to, dir, secs) {
  fs.mkdirSync(dir, { recursive: true });
  for (let L = from; L <= to; L++) {
    const cfg = levelCfg(L), salt = +(process.env.SALT || 0), rnd = core.mkRng(L * 7919 + 17 + salt * 104729), t0 = Date.now(), file = path.join(dir, 'L' + L + '.json');
    const out = salt && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [], start = out.length;
    let att = 0;
    while (out.length - start < 150 && Date.now() - t0 < secs * 1000) {
      att++;
      cfg.bias = 0.2 + rnd() * 0.5;
      const P = core.genLevel(cfg, rnd);
      if (!P) continue;
      const lens = P.runs.map(r => r.len);
      out.push({ code: core.encodeLevel(P), score: P.score, top: P.top, used: P.used, white: P.white.length, runs: P.runs.length, longest: Math.max(...lens), ratio: lens.filter(x => x >= 6).length / lens.length, hidden: P.runs.filter(r => r.hid).length });
    }
    fs.writeFileSync(file, JSON.stringify(out));
    console.log('L' + L, cfg.R + 'x' + cfg.C, 'W' + cfg.W, 'attempts', att, 'candidates', out.length, 'scores', out.length ? Math.min(...out.map(o => o.score)) + '-' + Math.max(...out.map(o => o.score)) : '-', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}

function select(dir) {
  // Candidates generated for any level with identical rules (board size, techniques, hidden clues, long runs)
  // are valid for every level of that group, so each level draws from the whole group pool
  // (filtered to a white-cell count close to W(L)). Strictly increasing scores keep picks distinct.
  const raw = [];
  for (let L = 1; L <= 100; L++) raw.push(JSON.parse(fs.readFileSync(path.join(dir, 'L' + L + '.json'), 'utf8')));
  const groupKey = L => { const c = levelCfg(L); return [c.R, c.C, c.maxRun, c.minLong, c.maxTier, c.needTier, c.hide].join('/'); };
  const pools = [];
  for (let L = 1; L <= 100; L++) {
    const W = levelCfg(L).W, seen = new Set(), list = [];
    for (let K = 1; K <= 100; K++) if (groupKey(K) === groupKey(L)) raw[K - 1].forEach(c => { if (Math.abs(c.white - W) <= 5 && !seen.has(c.code)) { seen.add(c.code); list.push(c); } });
    pools.push(list);
  }
  const cost = (L, c) => { const cfg = levelCfg(L); return Math.abs(Math.log(c.score / cfg.target)) + 1.5 * Math.abs(c.ratio - cfg.ratioTarget) + (c.top < cfg.preferTier ? 0.6 : 0); };
  // DP: strictly increasing score (each level at least HARD-1 (default 2%) and 1 point harder than the previous one)
  const harder = (a, b) => b.score >= a.score * HARD && b.score >= a.score + 1;
  let prev = pools[0].map(c => ({ cost: cost(1, c), from: -1 }));
  const back = [prev];
  for (let L = 2; L <= 100; L++) {
    const cur = pools[L - 1].map(c => {
      let best = Infinity, from = -1;
      pools[L - 2].forEach((p, j) => { if (prev[j].cost < best && harder(p, c)) { best = prev[j].cost; from = j; } });
      return { cost: from < 0 ? Infinity : best + cost(L, c), from };
    });
    if (!cur.some(x => x.cost < Infinity)) throw new Error('no increasing chain at level ' + L);
    back.push(cur); prev = cur;
  }
  let k = prev.reduce((bi, x, i) => x.cost < prev[bi].cost ? i : bi, 0);
  const chosen = [];
  for (let L = 100; L >= 1; L--) { chosen[L - 1] = pools[L - 1][k]; k = back[L - 1][k].from; }
  const lines = chosen.map((c, i) => JSON.stringify(c.code + '|' + c.score + ',' + c.top));
  const out = html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, '/*LEVELS-START*/\n' + lines.join(',\n') + '\n/*LEVELS-END*/');
  fs.writeFileSync(APP, out);
  chosen.forEach((c, i) => { const cfg = levelCfg(i + 1); console.log('L' + (i + 1), cfg.R + 'x' + cfg.C, 'score', c.score, 'target', cfg.target.toFixed(0), 'top', c.top, 'white', c.white, 'longest', c.longest, 'ratio', c.ratio.toFixed(2), 'hidden', c.hidden, 'pool', pools[i].length); });
}

const [cmd, a, b, c, d] = process.argv.slice(2);
var HARD = +(process.env.HARD || 1.02);
if (cmd === 'pool') pool(+a, +b, c, +(d || 30));
else if (cmd === 'select') select(a);
module.exports = { levelCfg };
