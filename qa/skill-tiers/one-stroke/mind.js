// Mental search model for one-stroke tiers (copied pruning ideas from apps/one-stroke/demo/solver.js).
'use strict';
const { buildGraph } = require('./solver');
// level: {W,H,open,walls,cps}; prune: 'weak' (forced + dead-end) | 'full' (+ connectivity + parity)
function mentalSolve(lv, prune, budget, rnd) {
  const { W, H, open } = lv; const N = W * H;
  const nb = buildGraph({ W, H, open, walls: lv.walls });
  const cps = lv.cps, K = cps.length, cpNum = new Int16Array(N); cps.forEach((c, i) => cpNum[c] = i + 1);
  const start = cps[0], end = cps[K - 1];
  const vis = new Uint8Array(N), deg = new Int16Array(N); let total = 0;
  for (let c = 0; c < N; c++) if (open[c]) { total++; deg[c] = nb[c].length; }
  const color = c => ((c % W) + ((c / W) | 0)) & 1; const cnt = [0, 0];
  for (let c = 0; c < N; c++) if (open[c]) cnt[color(c)]++;
  const visit = c => { vis[c] = 1; cnt[color(c)]--; for (const n of nb[c]) deg[n]--; };
  const unvisit = c => { vis[c] = 0; cnt[color(c)]++; for (const n of nb[c]) deg[n]++; };
  const path = [start]; let nodes = 0, found = null, out = false;
  const mark = new Int32Array(N); let stamp = 1;
  function feasible(h, rem) {
    if (rem === 0) return true;
    let forced = 0;
    for (const n of nb[h]) { if (vis[n] || n === end) continue; if (deg[n] === 0) return false; if (deg[n] === 1 && ++forced > 1) return false; }
    if (prune !== 'full') return true;
    const ch = color(h); if (cnt[1 - ch] !== (rem + 1) >> 1 || cnt[ch] !== rem >> 1) return false;
    let seed = -1; for (const n of nb[h]) if (!vis[n]) { seed = n; break; } if (seed < 0) return false;
    stamp++; const st = [seed]; mark[seed] = stamp; let seen = 1;
    while (st.length) { const c = st.pop(); for (const n of nb[c]) if (!vis[n] && mark[n] !== stamp) { mark[n] = stamp; seen++; st.push(n); } }
    return seen === rem;
  }
  function dfs(h, nextCp) {
    if (found || out) return; if (++nodes > budget) { out = true; return; }
    const rem = total - path.length;
    if (rem === 0) { if (h === end) found = path.slice(); return; }
    if (h === end || !feasible(h, rem)) return;
    let forcedN = -1; for (const n of nb[h]) if (!vis[n] && n !== end && deg[n] === 1) { forcedN = n; break; }
    const mv = [];
    for (const n of nb[h]) { if (vis[n]) continue; if (forcedN >= 0 && n !== forcedN) continue; const k = cpNum[n]; if (k && k !== nextCp) continue; if (n === end && rem !== 1) continue; mv.push(n); }
    // Warnsdorff with a little human noise in tie-breaking
    mv.sort((a, b) => (deg[a] - deg[b]) || (rnd() - 0.5));
    for (const n of mv) { visit(n); path.push(n); dfs(n, cpNum[n] ? nextCp + 1 : nextCp); path.pop(); unvisit(n); if (found || out) return; }
  }
  visit(start); dfs(start, 2);
  return { path: found, nodes, exceeded: out };
}
module.exports = { mentalSolve };
