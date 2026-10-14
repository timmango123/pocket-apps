// Offline level generator for 極地探冰 (minesweeper).
// Uses the game's own core (extracted from index.html between CORE markers).
// Every level: spec formulas for size/density, seeded PRNG (seed = L*104729), logic-only solvable from the
// fixed start (no guessing), repaired by hill-climbing when the solver gets stuck. A global
// selection makes every level clearly harder than the previous one. Writes the LEVELS array back into index.html.
//   Phase 1: a pool of 20-60 no-guess candidates per level (different seeds).
//   Phase 2: dynamic programming picks one candidate per level so that the composite difficulty
//            C = mines + 0.2 * (basic + 2*subset + 3*enum deduction steps) rises by >= 0.5 every level, the
//            displayed 1-10 difficulty (spec D = advanced share*50 + mines*0.3) never drops, each mechanic is
//            present from its introduction level, and D stays closest to a smooth target curve.
// Usage: POOLS=/path/cache.json node gen.js   (full run takes ~1-2 h on one core; levels.json records the result)
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
let html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const M = new Function(coreSrc + '\nreturn {msMakeLevel, msCompute, msSolve, msDiffRaw, msDiffShow, msParams, msEncode, msDecode};')();

function rng(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; var t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function makeMask(W, H, r, n) {
  const N = W * H;
  for (let tries = 0; tries < 200; tries++) {
    const m = new Uint8Array(N).fill(1);
    const cut = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) m[y * W + x] = 0; };
    const style = (n + tries) % 4;
    if (style === 0 || style === 2) { // stair-cut corners
      const k = 2 + Math.floor(r() * 3);
      for (const [cx, cy, sx, sy] of [[0, 0, 1, 1], [W - 1, 0, -1, 1], [0, H - 1, 1, -1], [W - 1, H - 1, -1, -1]])
        for (let i = 0; i < k; i++) for (let j = 0; j < k - i; j++) cut(cx + sx * i, cy + sy * j);
    }
    if (style === 1 || style === 2) { // hollow centre
      const hw = 2 + Math.floor(r() * 2), hh = 3 + Math.floor(r() * 4);
      const x0 = Math.floor((W - hw) / 2), y0 = Math.floor((H - hh) / 2);
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) cut(x0 + x, y0 + y);
    }
    if (style === 3) { // notches on the sides + two small ponds
      for (let s = 0; s < 4; s++) { const y = 2 + Math.floor(r() * (H - 5)), d = 1 + Math.floor(r() * 2); for (let i = 0; i < d; i++) { cut(s % 2 ? W - 1 - i : i, y); cut(s % 2 ? W - 1 - i : i, y + 1); } }
      for (let p = 0; p < 2; p++) { const x = 3 + Math.floor(r() * (W - 7)), y = 3 + Math.floor(r() * (H - 7)); cut(x, y); cut(x + 1, y); cut(x, y + 1); cut(x + 1, y + 1); }
    }
    // connectivity check (4-connected)
    let first = -1, cnt = 0; for (let c = 0; c < N; c++) if (m[c]) { cnt++; if (first < 0) first = c; }
    const seen = new Uint8Array(N), q = [first]; seen[first] = 1;
    while (q.length) { const c = q.pop(), x = c % W, y = (c / W) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const nc = ny * W + nx; if (m[nc] && !seen[nc]) { seen[nc] = 1; q.push(nc); } } }
    let reach = 0; for (let c = 0; c < N; c++) reach += seen[c];
    if (reach === cnt && cnt < N) return m;
  }
  throw new Error('mask');
}

function candidate(n, seed, minesWanted, shapeSeed) {
  const P = M.msParams(n), W = P.W, H = P.H, N = W * H, r = rng(seed);
  const mask = P.shaped ? makeMask(W, H, rng(shapeSeed), n) : new Uint8Array(N).fill(1);
  // start cell: random interior cell whose 3x3 is fully playable
  let start;
  for (;;) {
    const x = 1 + Math.floor(r() * (W - 2)), y = 1 + Math.floor(r() * (H - 2));
    let ok = true; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[(y + dy) * W + x + dx]) ok = false;
    if (ok) { start = y * W + x; break; }
  }
  const sx = start % W, sy = (start / W) | 0;
  const zone = c => Math.abs(c % W - sx) <= 1 && Math.abs(((c / W) | 0) - sy) <= 1;
  const mine = new Uint8Array(N), kind = new Uint8Array(N);
  const cells = []; for (let c = 0; c < N; c++) if (mask[c] && !zone(c)) cells.push(c);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  for (let i = 0; i < minesWanted; i++) mine[cells[i]] = 1;
  for (const c of cells) { const v = r(); if (v < P.dark) kind[c] = 1; else if (v < P.dark + P.parity) kind[c] = 2; else if (v < P.dark + P.parity + P.four) kind[c] = 3; }
  const L = M.msMakeLevel(W, H, mask, mine, kind, start);
  let best = M.msSolve(L), iters = 0, repairs = 0;
  const MAXIT = 6000;
  while (!best.solved && iters < MAXIT) {
    iters++;
    const st = best.st, F = [], I = [];
    for (let c = 0; c < N; c++) {
      if (!mask[c] || st[c] !== 0 || zone(c)) continue;
      let fr = false; for (const x of L.n8[c]) if (st[x]) { fr = true; break; }
      (fr ? F : I).push(c);
    }
    if (!F.length) break;
    // occasionally soften a revealed special cell on the frontier
    if (r() < 0.06) {
      const sp = []; for (let c = 0; c < N; c++) if (st[c] === 1 && kind[c] && L.cnt8[c]) { for (const x of L.n8[c]) if (st[x] === 0) { sp.push(c); break; } }
      if (sp.length) { const c = sp[Math.floor(r() * sp.length)]; kind[c] = 0; M.msCompute(L); best = M.msSolve(L); repairs++; continue; }
    }
    const f = F[Math.floor(r() * F.length)];
    const pool = (I.length ? I : F).filter(c => c !== f && mine[c] !== mine[f]);
    if (!pool.length) continue;
    const g = pool[Math.floor(r() * pool.length)];
    mine[f] ^= 1; mine[g] ^= 1; M.msCompute(L);
    const R = M.msSolve(L);
    if (R.known >= best.known || r() < 0.02) best = R; else { mine[f] ^= 1; mine[g] ^= 1; M.msCompute(L); }
  }
  if (!best.solved) return null;
  let sp = [0, 0, 0, 0], numCells = 0;
  for (let c = 0; c < N; c++) if (mask[c] && !mine[c] && L.cnt8[c]) { numCells++; sp[kind[c]]++; }
  return { L, steps: best.steps, D: M.msDiffRaw(L, best.steps), iters, repairs, sp, numCells };
}

module.exports = { M, rng, makeMask, candidate };
function minesFor(n) { // spec: round(cells * rho), never fewer than the previous level
  let m = 0;
  for (let k = 1; k <= n; k++) {
    const P = M.msParams(k); let playable = P.W * P.H;
    if (P.shaped) playable = makeMask(P.W, P.H, rng(k * 104729 + 1), k).reduce((a, b) => a + b, 0);
    m = Math.max(m, Math.round(playable * P.rho));
  }
  return m;
}
const STEP = 0.5; // minimum increase of the composite C per level
const work = c => c.steps.basic + 2 * c.steps.subset + 3 * c.steps.enum; // weighted reasoning steps
const comp = c => c.mines + 0.2 * work(c); // composite difficulty C
const target = (n, mines) => mines * 0.3 + 50 * 0.2 * (n - 1) / 99;
function main() {
  // candidate cache (large, kept out of the app folder); rerunning reuses it and only extends pools
  const poolFile = process.env.POOLS || path.join(require('os').tmpdir(), 'minesweeper-pools.json');
  const pools = fs.existsSync(poolFile) ? JSON.parse(fs.readFileSync(poolFile, 'utf8')) : {};
  const from = +(process.argv[2] || 1), to = +(process.argv[3] || 100);
  // phase 1: candidate pools
  for (let n = from; n <= to; n++) {
    const t0 = Date.now(), P = M.msParams(n), mines = minesFor(n), cells = P.W * P.H;
    const K = cells <= 150 ? 60 : cells <= 250 ? 30 : 20, list = pools[n] || [];
    if (list.length >= K) continue;
    const tried = new Set(list.map(c => c.seedJ));
    for (let j = 0; list.length < K && j < K * 3; j++) {
      if (tried.has(j) || (list.length && list[0].seedJ === undefined && j < list.length)) continue;
      const c = candidate(n, n * 104729 + j * 7919, mines, n * 104729 + 1);
      if (c) list.push({ seedJ: j, code: M.msEncode(c.L), D: +c.D.toFixed(3), steps: c.steps, sp: c.sp, numCells: c.numCells, mines: c.L.total, safe: c.L.safe });
    }
    pools[n] = list;
    fs.writeFileSync(poolFile, JSON.stringify(pools));
    const Ds = list.map(c => c.D).sort((a, b) => a - b);
    console.log('pool L' + n, P.W + 'x' + P.H, 'mines', mines, 'n', list.length, 'D', Ds[0], '..', Ds[Ds.length - 1], (Date.now() - t0) + 'ms');
  }
  for (let n = 1; n <= 100; n++) if (!pools[n]) return console.log('pools incomplete; stop before selection');
  // phase 2: DP — strictly increasing D (>= STEP per level), minimal total deviation from the target curve
  const cost = [], back = [];
  for (let n = 1; n <= 100; n++) {
    const P = pools[n]; cost.push([]); back.push([]);
    P.forEach((c, i) => {
      // every mechanic must actually appear from its introduction level on
      if ((n >= 25 && !c.sp[1]) || (n >= 45 && !c.sp[2]) || (n >= 80 && !c.sp[3])) { cost[n - 1][i] = Infinity; back[n - 1][i] = -1; return; }
      const dev = Math.abs(c.D - target(n, c.mines));
      if (n === 1) { cost[0][i] = dev; back[0][i] = -1; return; }
      let best = Infinity, bi = -1;
      pools[n - 1].forEach((p, k) => { if (isFinite(cost[n - 2][k]) && comp(c) >= comp(p) + STEP && M.msDiffShow(c.D) >= M.msDiffShow(p.D) && cost[n - 2][k] < best) { best = cost[n - 2][k]; bi = k; } });
      cost[n - 1][i] = best + dev; back[n - 1][i] = bi;
    });
  }
  let bi = -1, bc = Infinity; cost[99].forEach((v, i) => { if (v < bc) { bc = v; bi = i; } });
  if (!isFinite(bc)) return console.log('NO strictly increasing chain exists — enlarge pools');
  const chosen = [];
  for (let n = 100; n >= 1; n--) { chosen[n - 1] = pools[n][bi]; bi = back[n - 1][bi]; }
  const out = chosen.map((c, i) => ({ n: i + 1, ...c, C: +comp(c).toFixed(1), show: M.msDiffShow(c.D), target: +target(i + 1, c.mines).toFixed(2) }));
  fs.writeFileSync(path.join(__dirname, 'levels.json'), JSON.stringify(out, null, 0));
  out.forEach(o => console.log('L' + o.n, o.code.split(',').slice(0, 2).join('x'), 'mines', o.mines, 'C', o.C, 'D', o.D, 'target', o.target, 'show', o.show, 'sp', o.sp.slice(1).join('/')));
  const arr = 'var LEVELS = [\n' + out.map(o => JSON.stringify(o.code + '|' + o.D)).join(',\n') + '\n];';
  const h = fs.readFileSync(APP, 'utf8').replace(/var LEVELS = \[[\s\S]*?\];/, arr);
  fs.writeFileSync(APP, h);
  console.log('wrote LEVELS into index.html, total deviation', bc.toFixed(1));
}
if (require.main === module) main();
