// 一筆繪境 level generator: node gen.js [from] [to] > levels.json
'use strict';
const { solve, buildGraph, mulberry32, encode } = require('./solver');
// After generating, build.js re-orders levels of the same board size by `effort` so difficulty rises monotonically.

function dims(L) {
  // target area grows ~1.76%/level from 16 to 90, stepping board dims
  const A = 16 + 74 * Math.pow((L - 1) / 99, 0.75);
  let best = null;
  for (let W = 4; W <= 9; W++) for (let H = W; H <= Math.min(W + 2, 10); H++) {
    const a = W * H;
    if (a > A + 0.01) continue;
    if (!best || a > best.a || (a === best.a && H - W < best.H - best.W)) best = { W, H, a };
  }
  return best;
}

function params(L) {
  const t = (L - 1) / 99;
  return {
    holes: L < 12 ? 0 : Math.min(7, Math.floor((L - 4) / 14)),
    preWalls: L < 8 ? 0 : Math.round(1 + (L - 8) * 0.09),
    pWall: L < 6 ? 0 : 0.2 + 0.3 * t,
    extraFrac: Math.max(0, 0.32 * (1 - (L - 1) / 64)),
  };
}

function hamPath(W, H, open, rng) {
  const p = { W, H, open, walls: [] };
  const nb = buildGraph(p);
  const N = W * H;
  const cells = [];
  for (let c = 0; c < N; c++) if (open[c]) cells.push(c);
  // randomized DFS w/ Warnsdorff + connectivity, free end
  const vis = new Uint8Array(N);
  const total = cells.length;
  let nodes = 0;
  const path = [];
  function conn(rem, h) {
    let seed = -1;
    for (const n of nb[h]) if (!vis[n]) { seed = n; break; }
    if (seed < 0) return rem === 0;
    const seen = new Uint8Array(N); const st = [seed]; seen[seed] = 1; let k = 1;
    while (st.length) { const c = st.pop(); for (const n of nb[c]) if (!vis[n] && !seen[n]) { seen[n] = 1; k++; st.push(n); } }
    if (k !== rem) return false;
    // at most one dead end (deg<=1 among unvisited, excluding head-adjacent counting)
    let dead = 0;
    for (const c of cells) {
      if (vis[c]) continue;
      let d = 0; for (const n of nb[c]) if (!vis[n] || n === h) d++;
      if (d < 2) { dead++; if (dead > 1) return false; }
    }
    return true;
  }
  function dfs(h) {
    if (++nodes > 200000) return false;
    path.push(h); vis[h] = 1;
    if (path.length === total) return true;
    if (conn(total - path.length, h)) {
      const mv = nb[h].filter(n => !vis[n]).map(n => ({ n, d: nb[n].filter(m => !vis[m]).length + rng() * 0.9 }));
      mv.sort((a, b) => a.d - b.d);
      for (const { n } of mv) if (dfs(n)) return true;
    }
    path.pop(); vis[h] = 0;
    return false;
  }
  for (let tries = 0; tries < 30; tries++) {
    const s = cells[Math.floor(rng() * cells.length)];
    nodes = 0; path.length = 0; vis.fill(0);
    if (dfs(s)) break;
  }
  if (path.length !== total) return null;
  // backbite randomization
  let P = path.slice();
  const iters = total * 60;
  for (let i = 0; i < iters; i++) {
    const head = rng() < 0.5;
    if (head) {
      const e = P[0];
      const u = nb[e][Math.floor(rng() * nb[e].length)];
      const j = P.indexOf(u);
      if (j <= 1) continue;
      P = P.slice(0, j).reverse().concat(P.slice(j));
    } else {
      const e = P[P.length - 1];
      const u = nb[e][Math.floor(rng() * nb[e].length)];
      const j = P.indexOf(u);
      if (j >= P.length - 2) continue;
      P = P.slice(0, j + 1).concat(P.slice(j + 1).reverse());
    }
  }
  return P;
}

// Human-style search effort: nodes a player's DFS (forced moves, dead ends, connectivity, parity) needs to find
// the first solution, median over 5 tie-break orders. Used to keep the late-game difficulty curve smooth.
function effort(lv) {
  const { W, H, open } = lv; const N = W * H;
  const nb = buildGraph({ W, H, open, walls: lv.walls });
  const cps = lv.cps, cpNum = new Int16Array(N); cps.forEach((c, i) => cpNum[c] = i + 1);
  const start = cps[0], end = cps[cps.length - 1];
  const color = c => ((c % W) + ((c / W) | 0)) & 1;
  const runs = [];
  for (let seed = 1; seed <= 5; seed++) {
    const rnd = mulberry32(seed);
    const vis = new Uint8Array(N), deg = new Int16Array(N), cnt = [0, 0]; let total = 0;
    for (let c = 0; c < N; c++) if (open[c]) { total++; deg[c] = nb[c].length; cnt[color(c)]++; }
    const visit = c => { vis[c] = 1; cnt[color(c)]--; for (const n of nb[c]) deg[n]--; };
    const unvisit = c => { vis[c] = 0; cnt[color(c)]++; for (const n of nb[c]) deg[n]++; };
    const mark = new Int32Array(N); let stamp = 1, nodes = 0, len = 1, done = false;
    const feasible = (h, rem) => {
      let forced = 0;
      for (const n of nb[h]) { if (vis[n] || n === end) continue; if (deg[n] === 0) return false; if (deg[n] === 1 && ++forced > 1) return false; }
      const ch = color(h); if (cnt[1 - ch] !== (rem + 1) >> 1 || cnt[ch] !== rem >> 1) return false;
      let sd = -1; for (const n of nb[h]) if (!vis[n]) { sd = n; break; } if (sd < 0) return false;
      stamp++; const st = [sd]; mark[sd] = stamp; let seen = 1;
      while (st.length) { const c = st.pop(); for (const n of nb[c]) if (!vis[n] && mark[n] !== stamp) { mark[n] = stamp; seen++; st.push(n); } }
      return seen === rem;
    };
    const dfs = (h, nextCp) => {
      if (done || ++nodes > 2e6) { done = true; return; }
      const rem = total - len;
      if (rem === 0) { if (h === end) done = true; return; }
      if (h === end || !feasible(h, rem)) return;
      let fN = -1; for (const n of nb[h]) if (!vis[n] && n !== end && deg[n] === 1) { fN = n; break; }
      const mv = [];
      for (const n of nb[h]) { if (vis[n] || (fN >= 0 && n !== fN)) continue; const k = cpNum[n]; if (k && k !== nextCp) continue; if (n === end && rem !== 1) continue; mv.push(n); }
      mv.sort((a, b) => (deg[a] - deg[b]) || (rnd() - 0.5));
      for (const n of mv) { visit(n); len++; dfs(n, cpNum[n] ? nextCp + 1 : nextCp); len--; unvisit(n); if (done) return; }
    };
    visit(start); dfs(start, 2); runs.push(nodes);
  }
  runs.sort((a, b) => a - b);
  return runs[2];
}
// target effort for the late game: ~300 nodes at L45 rising ~6.4%/level to ~9000 at L100
const targetEffort = L => 300 * Math.pow(1.064, L - 45);

function makeLevel(L, k = 0) {
  const { W, H } = dims(L);
  const pr = params(L);
  const rng = mulberry32(L * 7919 + 12345 + k * 104729);
  const N = W * H;
  let open, sol;
  for (let attempt = 0; attempt < 200; attempt++) {
    open = new Uint8Array(N).fill(1);
    let holes = 0, guard = 0;
    while (holes < pr.holes && guard++ < 500) {
      const c = Math.floor(rng() * N);
      if (!open[c]) continue;
      // avoid adjacent holes clumping too much
      open[c] = 0; holes++;
    }
    // bipartite balance
    let cnt = [0, 0];
    for (let c = 0; c < N; c++) if (open[c]) cnt[((c % W) + ((c / W) | 0)) & 1]++;
    if (Math.abs(cnt[0] - cnt[1]) > 1) continue;
    sol = hamPath(W, H, open, rng);
    if (sol) break;
  }
  if (!sol) throw new Error('no path for level ' + L);
  const idx = new Int32Array(N).fill(-1);
  sol.forEach((c, i) => (idx[c] = i));
  const solEdge = new Set();
  for (let i = 1; i < sol.length; i++) { const a = Math.min(sol[i - 1], sol[i]), b = Math.max(sol[i - 1], sol[i]); solEdge.add(a * 1024 + b); }
  // candidate wall edges: interior edges between open cells not on solution
  const cand = [];
  for (let c = 0; c < N; c++) {
    if (!open[c]) continue;
    const x = c % W;
    if (x < W - 1 && open[c + 1] && !solEdge.has(c * 1024 + c + 1)) cand.push([c, c + 1]);
    if (c + W < N && open[c + W] && !solEdge.has(c * 1024 + c + W)) cand.push([c, c + W]);
  }
  const walls = [];
  const wallKey = new Set();
  function addWall(e) { const k = e[0] * 1024 + e[1]; if (wallKey.has(k)) return false; wallKey.add(k); walls.push(e); return true; }
  for (let i = 0; i < pr.preWalls && cand.length; i++) addWall(cand[Math.floor(rng() * cand.length)]);
  let cps = new Set([sol[0], sol[sol.length - 1]]);
  const ordered = () => [...cps].sort((a, b) => idx[a] - idx[b]);
  const BUD = 3e6;
  // resolve ambiguity
  for (let it = 0; it < 400; it++) {
    const p = { W, H, open, walls, cps: ordered() };
    const r = solve(p, 2, BUD, 4);
    if (r.count === 1 && !r.exceeded) break;
    const alt = r.sols.find(s => s.some((c, i) => c !== sol[i]));
    if (!alt) {
      // budget exceeded w/o alt: add checkpoint in biggest gap
      const o = ordered(); let gi = 0, gl = 0;
      for (let i = 1; i < o.length; i++) { const g = idx[o[i]] - idx[o[i - 1]]; if (g > gl) { gl = g; gi = i; } }
      cps.add(sol[Math.floor((idx[o[gi - 1]] + idx[o[gi]]) / 2)]);
      continue;
    }
    const aidx = new Int32Array(N);
    alt.forEach((c, i) => (aidx[c] = i));
    if (rng() < pr.pWall) {
      const ae = [];
      for (let i = 1; i < alt.length; i++) {
        const a = Math.min(alt[i - 1], alt[i]), b = Math.max(alt[i - 1], alt[i]);
        if (!solEdge.has(a * 1024 + b) && !wallKey.has(a * 1024 + b)) ae.push([a, b]);
      }
      if (ae.length) { addWall(ae[Math.floor(rng() * ae.length)]); continue; }
    }
    const o = ordered();
    const killers = [];
    for (let c = 0; c < N; c++) {
      if (!open[c] || cps.has(c)) continue;
      if (o.some(x => Math.sign(idx[c] - idx[x]) !== Math.sign(aidx[c] - aidx[x]))) killers.push(c);
    }
    if (killers.length) { cps.add(killers[Math.floor(rng() * killers.length)]); continue; }
    // pair inversion
    let done = false;
    for (let a = 0; a < sol.length && !done; a++) for (let b = a + 1; b < sol.length && !done; b++)
      if (aidx[sol[a]] > aidx[sol[b]]) { cps.add(sol[a]); cps.add(sol[b]); done = true; }
  }
  // minimize checkpoints
  const removable = ordered().slice(1, -1);
  for (let i = removable.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [removable[i], removable[j]] = [removable[j], removable[i]]; }
  for (const c of removable) {
    cps.delete(c);
    const r = solve({ W, H, open, walls, cps: ordered() }, 2, BUD, 0);
    if (!(r.count === 1 && !r.exceeded)) cps.add(c);
  }
  const minimal = cps.size;
  // add easy extra hints
  const total = sol.length;
  let extra = Math.round(total * pr.extraFrac);
  let guard = 0;
  while (extra > 0 && guard++ < 1000) {
    const o = ordered(); let gi = 1, gl = 0;
    for (let i = 1; i < o.length; i++) { const g = idx[o[i]] - idx[o[i - 1]]; if (g > gl) { gl = g; gi = i; } }
    if (gl < 2) break;
    const lo = idx[o[gi - 1]], hi = idx[o[gi]];
    cps.add(sol[lo + 1 + Math.floor(rng() * (hi - lo - 1))]);
    extra--;
  }
  const final = { W, H, open, walls, cps: ordered(), sol };
  const v = solve(final, 2, 2e7, 0);
  return { L, W, H, holes: pr.holes, walls: walls.length, hints: final.cps.length, minimal, unique: v.count === 1 && !v.exceeded, nodes: v.nodes, effort: effort(final), enc: encode(final) };
}

module.exports = { effort, targetEffort, makeLevel };
if (require.main === module) {
const from = +(process.argv[2] || 1), to = +(process.argv[3] || 100);
const out = [];
for (let L = from; L <= to; L++) {
  const t0 = Date.now();
  const C = L < 20 ? 2 : L < 50 ? 4 : L < 70 ? 8 : 5;
  let r = null;
  if (L < 45) {
    for (let k = 0; k < C; k++) {
      const c = makeLevel(L, k);
      const score = c.nodes * (c.unique ? 1 : 0.001) / Math.sqrt(c.hints);
      c.score = score;
      if (!r || score > r.score) r = c;
    }
  } else {
    // late game: pick the unique candidate whose search effort is closest to the target curve
    // (the old "hardest candidate" rule produced walls such as L99 = 50k nodes next to L98 = 79);
    // try a few extra candidates while none lands within a factor 2.5 of the target
    const T = targetEffort(L);
    for (let k = 0; k < C + 6; k++) {
      if (k >= C && r && r.score < Math.log(2.5)) break;
      const c = makeLevel(L, k);
      c.score = c.unique ? Math.abs(Math.log(c.effort / T)) : 1e9;
      if (!r || c.score < r.score) r = c;
    }
  }
  r.ms = Date.now() - t0;
  process.stderr.write(`L${L} ${r.W}x${r.H} holes${r.holes} walls${r.walls} hints${r.hints}(min${r.minimal}) unique=${r.unique} nodes=${r.nodes} effort=${r.effort} ${r.ms}ms\n`);
  out.push(r);
  if (process.env.JSONL) require('fs').appendFileSync(process.env.JSONL, JSON.stringify(r) + '\n');
}
process.stdout.write(JSON.stringify(out));
}
