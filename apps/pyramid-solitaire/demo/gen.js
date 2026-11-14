// Level generator for 金字塔接龍 (pyramid-solitaire).
// Uses the game's own rules + DFS solver extracted from index.html (CORE-START/CORE-END) and the skill-tier bots in bots.js.
// 1) candidate pool: seeds 1..3000 under 2 and 1 recycles, seeds 1..12000 with no recycle; each one is solved (cap 60000),
//    so every level is proven clearable.
// 2) every candidate is played by four bots that only see what the screen shows (bots.js): 手殘, 普通 and 熟練 (12 single
//    attempts each) and 世界級 on its first attempt (no memory of the stock order, 2 runs). From the single-attempt rates:
//    clear rates with the tiers' retries (手殘 5, 普通 3, 熟練 3) and a composite difficulty = 4 − sum of the four clear rates.
// 3) picks 100 levels (1–30: 2 recycles, 31–70: 1, 71–100: none) along a smooth composite curve, also fitting a target
//    clear rate per tier (手殘 drops out by ~60, 普通 by 100, 熟練 and 世界級 first try keep clearing a share of 81–100),
//    refines the shortlisted candidates with 48 more runs per tier, sorts each block by composite and stores the displayed difficulty 1.0–10.0 (running max of the composite, scaled).
//    then mixes three 熟練-friendly no-recycle deals into 91-100 (see the block after the pick).
// Usage: node gen.js            → writes levels.json and prints the LEVELS line to paste into index.html (takes ~20 min)
const fs = require('fs'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html');
function core() {
  const html = fs.readFileSync(APP, 'utf8');
  return new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {ROWOF,dealFromSeed,initState,isFree,legalMoves,applyMove,isWon,solve,hopeless,nextStock,mulberry32};')();
}
const K = 12, KW = 2;
// curve: composite target TOP·((n−1)/99)^E, tier-fit weight WT (熟練 ×WS, 世界級 ×WW)
const PARAMS = { E: 1.3, TOP: 3.1, WT: 2, WS: 4, WW: 1.5 }, SHORT = 45, K2 = 48, KW2 = 4;
if (!isMainThread) {
  const C = core(), B = require('./bots.js')(C), out = [];
  const refine = workerData.refine, k1 = refine ? K2 : K, kw = refine ? KW2 : KW;
  for (const job of workerData.jobs) {
    let nodes = job.nodes;
    if (!refine) { const r = C.solve(C.dealFromSeed(job.seed), C.initState(), job.R, 60000); if (!r.ok) continue; nodes = r.nodes; }
    const rnd = refine ? C.mulberry32(job.seed * 977 + job.R * 13 + 999) : C.mulberry32(job.seed * 131 + job.R * 7 + 12345), c = { seed: job.seed, R: job.R, nodes };
    for (const t of ['clumsy', 'casual', 'skilled']) { let w = 0; for (let k = 0; k < k1; k++) if (B.attempt(job.seed, job.R, B.TIERS[t], rnd).won) w++; c[t] = w / k1; }
    let w = 0; for (let k = 0; k < kw; k++) if (B.attempt(job.seed, job.R, B.TIERS.world, rnd).won) w++; c.world1 = w / kw;
    out.push(c);
  }
  parentPort.postMessage(out);
  return;
}
(async () => {
  const t0 = Date.now(), jobs = [];
  for (let s = 1; s <= 12000; s++) { if (s <= 3000) jobs.push({ seed: s, R: 2 }, { seed: s, R: 1 }); jobs.push({ seed: s, R: 0 }); }
  const W = 3, run = (list, refine) => Promise.all(Array.from({ length: W }, (_, i) => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { jobs: list.filter((_, j) => j % W === i), refine } }); w.on('message', res); w.on('error', rej);
  }))).then(p => [].concat(...p));
  let all = await run(jobs, false);
  const lin = (n, a, b, va, vb) => n <= a ? va : n >= b ? vb : va + (vb - va) * (n - a) / (b - a);
  const target = n => ({ c: lin(n, 6, 62, 1, 0), a: lin(n, 12, 100, 1, 0.06), s: lin(n, 26, 100, 1, 0.35), w: lin(n, 40, 100, 1, 0.6) });
  const rate = x => {
    x.P = { c: 1 - Math.pow(1 - x.clumsy, 5), a: 1 - Math.pow(1 - x.casual, 3), s: 1 - Math.pow(1 - x.skilled, 3), w: x.world1 };
    x.comp = 4 - (x.P.c + x.P.a + x.P.s + x.P.w);
  };
  const cost = (x, n) => { const t = target(n), tc = PARAMS.TOP * Math.pow((n - 1) / 99, PARAMS.E), P = x.P; return (x.comp - tc) ** 2 * 4 + PARAMS.WT * ((P.c - t.c) ** 2 + (P.a - t.a) ** 2 + (P.s - t.s) ** 2 * PARAMS.WS + (P.w - t.w) ** 2 * PARAMS.WW); };
  const BLOCKS = [[1, 30, 2], [31, 70, 1], [71, 100, 0]];
  all.forEach(rate);
  // refine: the best SHORT candidates of every level slot get K2 more runs per tier (picking among noisy 12-run estimates
  // would favour lucky zeros), then levels are picked from that shortlist only
  const short = new Map();
  for (const [a, b, R] of BLOCKS) for (let n = a; n <= b; n++) all.filter(x => x.R === R).map(x => [cost(x, n), x]).sort((p, q) => p[0] - q[0]).slice(0, SHORT).forEach(([, x]) => short.set(x.seed + ':' + x.R, x));
  const more = new Map((await run([...short.values()].map(x => ({ seed: x.seed, R: x.R, nodes: x.nodes })), true)).map(x => [x.seed + ':' + x.R, x]));
  all = [...short.values()].map(x => { const y = more.get(x.seed + ':' + x.R), r = { seed: x.seed, R: x.R, nodes: x.nodes };
    for (const t of ['clumsy', 'casual', 'skilled']) r[t] = (x[t] * K + y[t] * K2) / (K + K2); r.world1 = (x.world1 * KW + y.world1 * KW2) / (KW + KW2); rate(r); return r; });
  const used = new Set(), lv = [];
  for (const [a, b, R] of BLOCKS) {
    const sel = [];
    for (let n = a; n <= b; n++) {
      let best = null, bc = 1e9;
      for (const x of all) { if (x.R !== R || used.has(x.seed)) continue; const c = cost(x, n); if (c < bc) { bc = c; best = x; } }
      used.add(best.seed); sel.push(best);
    }
    sel.sort((x, y) => x.comp - y.comp); lv.push(...sel);
  }
  // 熟練 needs a chance in 91-100: no-recycle deals are either fine for a good player or need the stock order, so sorting by
  // composite would leave 91-100 all of the second kind. Move the three most 熟練-friendly deals of 71-80 to 92/95/98,
  // refill 71-80 with three unused 熟練-friendly deals and drop levels 97-99 (keeps 100 the hardest). The displayed number
  // is the running max, so it still never goes down.
  {
    const blk = lv.splice(70), easy = blk.slice(0, 10).sort((x, y) => y.P.s - x.P.s).slice(0, 3), dropped = blk.slice(26, 29);
    const fresh = all.filter(x => x.R === 0 && !used.has(x.seed) && x.P.s >= 0.8 && x.P.w >= 0.75).sort((x, y) => y.P.s - x.P.s).slice(0, 3);
    const rest = blk.filter(x => !easy.includes(x) && !dropped.includes(x)).concat(fresh).sort((x, y) => x.comp - y.comp);
    [21, 24, 27].forEach((i, k) => rest.splice(i, 0, easy[k]));
    lv.push(...rest);
  }
  let m = -1e9; const iso = lv.map(x => m = Math.max(m, x.comp)), lo = iso[0], hi = iso[99];
  let prev = 0; const D = iso.map(v => { let d = Math.round((1 + 9 * (v - lo) / (hi - lo)) * 10) / 10; if (d < prev) d = prev; prev = d; return d; });
  const levels = lv.map((x, i) => ({ n: i + 1, seed: x.seed, R: x.R, diff: D[i], nodes: x.nodes, clumsy: x.clumsy, casual: x.casual, skilled: x.skilled, world1: x.world1, comp: +x.comp.toFixed(3) }));
  fs.writeFileSync(path.join(__dirname, 'levels.json'), JSON.stringify(levels, null, 1));
  const dec = k => Array.from({ length: 10 }, (_, b) => lv.slice(b * 10, b * 10 + 10).reduce((s, x) => s + x.P[k], 0).toFixed(1)).join(' ');
  console.log('candidates', all.length, 'in', ((Date.now() - t0) / 1000).toFixed(0) + 's; expected clears per 10 levels:');
  for (const [k, name] of [['c', '手殘'], ['a', '普通'], ['s', '熟練'], ['w', '世界級第一次']]) console.log(' ', name, dec(k));
  console.log('var LEVELS = [' + levels.map(L => '[' + L.seed + ',' + L.R + ',' + L.diff + ']').join(',') + '];');
})();
