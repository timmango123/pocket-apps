// 一筆繪境 — Hamiltonian-path-with-checkpoints solver (shared by generator & verifier)
'use strict';

// Puzzle: {W,H, open:Uint8Array(W*H), walls:Set of "a-b" (a<b), cps:[cellIdx...] in order}
function buildGraph(p) {
  const { W, H, open } = p;
  const N = W * H;
  const nb = [];
  const wallSet = p.wallSet || new Set((p.walls || []).map(([a, b]) => a < b ? a * 1024 + b : b * 1024 + a));
  for (let c = 0; c < N; c++) {
    const l = [];
    if (open[c]) {
      const x = c % W, y = (c / W) | 0;
      const cand = [];
      if (y > 0) cand.push(c - W);
      if (x < W - 1) cand.push(c + 1);
      if (y < H - 1) cand.push(c + W);
      if (x > 0) cand.push(c - 1);
      for (const d of cand) {
        if (!open[d]) continue;
        const k = c < d ? c * 1024 + d : d * 1024 + c;
        if (wallSet.has(k)) continue;
        l.push(d);
      }
    }
    nb.push(l);
  }
  return nb;
}

// Count solutions up to `limit`. Returns {count, nodes, exceeded, sols:[paths]}
function solve(p, limit = 2, budget = 2e6, wantSols = 2) {
  const { W, H, open } = p;
  const N = W * H;
  const nb = buildGraph(p);
  const cps = p.cps;
  const K = cps.length;
  const cpNum = new Int16Array(N);
  cps.forEach((c, i) => (cpNum[c] = i + 1));
  const start = cps[0], end = cps[K - 1];
  const vis = new Uint8Array(N);
  const deg = new Int16Array(N);
  let total = 0;
  for (let c = 0; c < N; c++) if (open[c]) { total++; deg[c] = nb[c].length; }
  const color = c => ((c % W) + ((c / W) | 0)) & 1;
  let cnt = [0, 0]; // unvisited counts by color
  for (let c = 0; c < N; c++) if (open[c]) cnt[color(c)]++;
  const path = new Int32Array(total);
  const res = { count: 0, nodes: 0, exceeded: false, sols: [] };
  const stack = new Int32Array(N);
  const mark = new Int32Array(N);
  let stamp = 1;

  function visit(c) { vis[c] = 1; cnt[color(c)]--; for (const n of nb[c]) deg[n]--; }
  function unvisit(c) { vis[c] = 0; cnt[color(c)]++; for (const n of nb[c]) deg[n]++; }

  function feasible(h, rem) {
    // rem = unvisited count (h already visited)
    if (rem === 0) return true;
    // parity
    const ch = color(h);
    const needOther = (rem + 1) >> 1, needSame = rem >> 1;
    if (cnt[1 - ch] !== needOther || cnt[ch] !== needSame) return false;
    // local dead-ends around head
    let forced = 0;
    for (const n of nb[h]) {
      if (vis[n]) continue;
      if (n === end) { continue; }
      if (deg[n] === 0) return false; // only head left
      if (deg[n] === 1) { forced++; if (forced > 1) return false; }
    }
    // connectivity of unvisited cells
    let seed = -1;
    for (const n of nb[h]) if (!vis[n]) { seed = n; break; }
    if (seed < 0) return false;
    stamp++;
    let sp = 0, seen = 1;
    stack[sp++] = seed; mark[seed] = stamp;
    while (sp) {
      const c = stack[--sp];
      for (const n of nb[c]) if (!vis[n] && mark[n] !== stamp) { mark[n] = stamp; seen++; stack[sp++] = n; }
    }
    if (seen !== rem) return false;
    // global dead-end: unvisited non-end cells with deg<2 not adjacent to head
    // (cheap enough: only check end reachability already done via connectivity)
    if (end !== h && deg[end] === 0 && rem > 1) return false;
    return true;
  }

  function dfs(h, depth, nextCp) {
    if (res.count >= limit || res.exceeded) return;
    if (++res.nodes > budget) { res.exceeded = true; return; }
    const rem = total - depth - 1;
    if (rem === 0) {
      if (h === end) {
        res.count++;
        if (res.sols.length < wantSols) res.sols.push(Array.from(path.subarray(0, depth + 1)));
      }
      return;
    }
    if (h === end) return;
    // check previous-head neighbors handled implicitly via deg checks below
    if (!feasible(h, rem)) return;
    // forced move?
    let forcedN = -1;
    for (const n of nb[h]) if (!vis[n] && n !== end && deg[n] === 1) { forcedN = n; break; }
    // ordering: Warnsdorff
    const moves = [];
    for (const n of nb[h]) {
      if (vis[n]) continue;
      if (forcedN >= 0 && n !== forcedN) continue;
      const k = cpNum[n];
      if (k && k !== nextCp) continue;
      if (n === end && rem !== 1) continue;
      moves.push(n);
    }
    if (moves.length > 1) moves.sort((a, b) => deg[a] - deg[b]);
    for (const n of moves) {
      // after moving to n, the old head h loses adjacency for its other unvisited neighbors
      let ok = true;
      for (const m of nb[h]) {
        if (m === n || vis[m]) continue;
        // m loses h as option; m's options: deg[m] (unvisited nbrs, includes n before visit) ...
        // after visiting n, deg[m] decreases if m adj n; m will be adj to head n then
        const adjN = nb[n].includes(m);
        const opts = deg[m] - (adjN ? 1 : 0) + (adjN ? 1 : 0); // unvisited excluding n + head n
        const need = m === end ? 1 : 2;
        if (opts < need) { ok = false; break; }
      }
      if (!ok) continue;
      visit(n);
      path[depth + 1] = n;
      dfs(n, depth + 1, cpNum[n] ? nextCp + 1 : nextCp);
      unvisit(n);
      if (res.count >= limit || res.exceeded) return;
    }
  }

  path[0] = start;
  visit(start);
  dfs(start, 0, 2);
  return res;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// compact level encoding
// "W,H|holes(cell idx base36 joined by .)|walls(a:b pairs base36, '.' sep)|cps(base36 '.')|sol(dirs UDLR)"
const B = n => n.toString(36);
function encode(lv) {
  const holes = [];
  for (let c = 0; c < lv.W * lv.H; c++) if (!lv.open[c]) holes.push(B(c));
  const walls = lv.walls.map(([a, b]) => B(a) + ':' + B(b));
  const cps = lv.cps.map(B);
  let dirs = '';
  for (let i = 1; i < lv.sol.length; i++) {
    const d = lv.sol[i] - lv.sol[i - 1];
    dirs += d === -lv.W ? 'U' : d === lv.W ? 'D' : d === 1 ? 'R' : 'L';
  }
  return [lv.W + ',' + lv.H, holes.join('.'), walls.join('.'), cps.join('.'), dirs].join('|');
}
function decode(s) {
  const [wh, holes, walls, cps, dirs] = s.split('|');
  const [W, H] = wh.split(',').map(Number);
  const open = new Uint8Array(W * H).fill(1);
  if (holes) holes.split('.').forEach(h => (open[parseInt(h, 36)] = 0));
  const wl = walls ? walls.split('.').map(p => p.split(':').map(v => parseInt(v, 36))) : [];
  const cp = cps.split('.').map(v => parseInt(v, 36));
  const sol = [cp[0]];
  for (const ch of dirs) {
    const c = sol[sol.length - 1];
    sol.push(ch === 'U' ? c - W : ch === 'D' ? c + W : ch === 'R' ? c + 1 : c - 1);
  }
  return { W, H, open, walls: wl, cps: cp, sol };
}

module.exports = { solve, buildGraph, mulberry32, encode, decode };
