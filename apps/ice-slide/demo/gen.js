// Offline level generator (core logic read from ../index.html): node gen.js 0 0 <outdir> <comma-separated levels>
// Deterministic: seeded mulberry32(level*7919 + attempt) hill-climb, BFS solver for exact optimum.
const fs = require('fs'), path = require('path');
const coreSrc = fs.readFileSync(process.env.CORE || path.join(__dirname, '..', 'index.html'), 'utf8');
const m = coreSrc.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//);
const core = new Function(m[1] + '\nreturn {parseLevel, initState, doMove, solve, stateKey};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function comp(n) {
  const f = (n - 1) / 99;
  const w = 6 + Math.round(f * 5), h = 6 + Math.round(f * 7);
  return {
    w, h,
    // up to L50 the original exponential curve; after that a gentler quadratic (11 → 17 at L75 → 28 at L100),
    // so the optimum grows steadily instead of doubling between L50 and L75
    target: n <= 50 ? Math.max(3, Math.ceil(3 * Math.pow(1.026, n - 1))) : Math.round(11 + 0.14 * (n - 50) + 0.004 * (n - 50) * (n - 50)),
    rocks: Math.round(w * h * (0.14 + 0.06 * f)),
    fish: Math.min(9, 1 + Math.floor((n - 1) / 11)),
    snow: n >= 6 ? Math.min(5, 1 + Math.floor((n - 6) / 18)) : 0,
    crack: n >= 16 ? Math.min(7, 1 + Math.floor((n - 16) / 13)) : 0,
    arrow: n >= 26 ? Math.min(5, 1 + Math.floor((n - 26) / 15)) : 0,
    block: n >= 36 ? Math.min(3, 1 + Math.floor((n - 36) / 25)) : 0,
    warp: n >= 51 ? (n >= 81 ? 2 : 1) : 0,
  };
}

function build(c, rnd) {
  const N = c.w * c.h, cells = new Array(N).fill('.');
  const put = (ch, k) => { let placed = 0; while (placed < k) { const i = Math.floor(rnd() * N); if (cells[i] === '.') { cells[i] = ch; placed++; } } };
  put('P', 1); put('G', 1); put('f', c.fish); put('#', c.rocks); put('s', c.snow); put('c', c.crack); put('B', c.block);
  for (let i = 0; i < c.arrow; i++) put('^>v<'[Math.floor(rnd() * 4)], 1);
  for (let i = 0; i < c.warp; i++) put(String(i + 1), 2);
  return cells;
}
function rowsOf(cells, c) { const r = []; for (let y = 0; y < c.h; y++) r.push(cells.slice(y * c.w, y * c.w + c.w).join('')); return r; }
function evalCells(cells, c, limit) {
  const L = core.parseLevel(rowsOf(cells, c));
  const r = core.solve(L, limit);
  if (!r || r.len < 0) return { len: -1 };
  return r;
}
function gen(n) {
  const c = comp(n);
  const limit = 250000;
  for (let attempt = 0; attempt < 60; attempt++) {
    const rnd = mulberry32(n * 7919 + attempt * 104729 + 1);
    let cells = build(c, rnd), cur = evalCells(cells, c, limit);
    let tries = 0;
    while (cur.len < 0 && tries++ < 200) { cells = build(c, rnd); cur = evalCells(cells, c, limit); }
    if (cur.len < 0) continue;
    const iters = 400 + n * 40;
    const dist = r => r.len < 0 ? 1e9 : r.len < c.target ? c.target - r.len : r.len > c.target ? r.len - c.target : 0;
    for (let it = 0; it < iters && dist(cur) > 0; it++) {
      const nc = cells.slice();
      const swaps = 1 + (rnd() < 0.3 ? 1 : 0);
      for (let s = 0; s < swaps; s++) {
        const a = Math.floor(rnd() * nc.length), b = Math.floor(rnd() * nc.length);
        const t = nc[a]; nc[a] = nc[b]; nc[b] = t;
        if (rnd() < 0.15) { const i = Math.floor(rnd() * nc.length); if ('^>v<'.includes(nc[i])) nc[i] = '^>v<'[Math.floor(rnd() * 4)]; }
      }
      const r = evalCells(nc, c, limit);
      if (r.len >= 0 && dist(r) <= dist(cur)) { cells = nc; cur = r; }
    }
    if (dist(cur) === 0) {
      return { n, rows: rowsOf(cells, c), opt: cur.len, sol: cur.sol.join(''), states: cur.states, target: c.target, attempt };
    }
  }
  return null;
}
if (require.main === module) {
  const [from, to, out] = [+process.argv[2], +process.argv[3], process.argv[4]];
  const list = process.argv[5] ? process.argv[5].split(',').map(Number) : null;
  const levels = list || Array.from({ length: to - from + 1 }, (_, i) => from + i);
  for (const n of levels) {
    const t0 = Date.now();
    const r = gen(n);
    if (!r) { console.log('FAIL', n); continue; }
    fs.writeFileSync(path.join(out, 'L' + n + '.json'), JSON.stringify(r));
    console.log(n, 'opt', r.opt, 'target', r.target, 'states', r.states, 'att', r.attempt, (Date.now() - t0) + 'ms');
  }
}
module.exports = { comp, gen, core };
