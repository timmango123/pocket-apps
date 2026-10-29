// Independent slitherlink solution counter (does not use the game's core): plain DFS with local propagation.
// countSolutions(W, H, clues[] (-1 = none), limit) -> { count, first (Uint8Array of line flags over edges in this file's own indexing) }
function countSolutions(W, H, clues, limit) {
  limit = limit || 2;
  // own indexing: vertices (W+1)*(H+1); edges listed as pairs of vertices
  const V = (W + 1) * (H + 1), edges = [], vEdges = Array.from({ length: V }, () => []), cEdges = [];
  const vid = (x, y) => y * (W + 1) + x;
  const hIdx = {}, vIdx = {};
  for (let y = 0; y <= H; y++) for (let x = 0; x < W; x++) { hIdx[x + ',' + y] = edges.length; edges.push([vid(x, y), vid(x + 1, y)]); }
  for (let y = 0; y < H; y++) for (let x = 0; x <= W; x++) { vIdx[x + ',' + y] = edges.length; edges.push([vid(x, y), vid(x, y + 1)]); }
  edges.forEach((e, i) => { vEdges[e[0]].push(i); vEdges[e[1]].push(i); });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cEdges.push([hIdx[x + ',' + y], hIdx[x + ',' + (y + 1)], vIdx[x + ',' + y], vIdx[(x + 1) + ',' + y]]);
  // parity lines: a horizontal line through row y crosses the vertical edges of that row; a closed loop crosses it an even number of times (same for columns)
  const parity = [];
  for (let y = 0; y < H; y++) { const r = []; for (let x = 0; x <= W; x++) r.push(vIdx[x + ',' + y]); parity.push(r); }
  for (let x = 0; x < W; x++) { const r = []; for (let y = 0; y <= H; y++) r.push(hIdx[x + ',' + y]); parity.push(r); }
  const cellsOfEdge = edges.map(() => []);
  cEdges.forEach((es, c) => es.forEach(e => cellsOfEdge[e].push(c)));
  const NE = edges.length;
  let count = 0, first = null;
  function propagate(st) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let c = 0; c < cEdges.length; c++) {
        const n = clues[c]; if (n < 0) continue;
        let on = 0, un = 0; for (const e of cEdges[c]) { if (st[e] === 1) on++; else if (st[e] === 0) un++; }
        if (on > n || on + un < n) return false;
        if (un && (on === n || on + un === n)) { const v = on === n ? 2 : 1; for (const e of cEdges[c]) if (st[e] === 0) st[e] = v; changed = true; }
      }
      for (let v = 0; v < V; v++) {
        let on = 0, un = 0, last = -1; for (const e of vEdges[v]) { if (st[e] === 1) on++; else if (st[e] === 0) { un++; last = e; } }
        if (on > 2 || (on === 1 && un === 0)) return false;
        if (!un) continue;
        if (on === 2) { for (const e of vEdges[v]) if (st[e] === 0) st[e] = 2; changed = true; }
        else if (on === 1 && un === 1) { st[last] = 1; changed = true; }
        else if (on === 0 && un === 1) { st[last] = 2; changed = true; }
      }
      for (const r of parity) {
        let on = 0, un = 0, last = -1; for (const e of r) { if (st[e] === 1) on++; else if (st[e] === 0) { un++; last = e; } }
        if (un === 0 && (on & 1)) return false;
        if (un === 1) { st[last] = (on & 1) ? 1 : 2; changed = true; }
      }
      if (!changed) { // no premature loop: an unknown edge joining both ends of one path is crossed
        const par = new Int32Array(V).map((_, i) => i), f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
        let lines = 0; const deg = new Int8Array(V);
        for (let e = 0; e < NE; e++) if (st[e] === 1) { lines++; deg[edges[e][0]]++; deg[edges[e][1]]++; const a = f(edges[e][0]), b = f(edges[e][1]); if (a !== b) par[a] = b; }
        const size = new Int32Array(V); for (let e = 0; e < NE; e++) if (st[e] === 1) size[f(edges[e][0])]++;
        for (let e = 0; e < NE; e++) {
          if (st[e] !== 0) continue; const a = edges[e][0], b = edges[e][1];
          if (deg[a] !== 1 || deg[b] !== 1 || f(a) !== f(b)) continue;
          if (size[f(a)] === lines) { // closing would end the puzzle: allowed only if every clue is met
            st[e] = 1; let good = true;
            for (let c = 0; c < cEdges.length && good; c++) { if (clues[c] < 0) continue; let on = 0; for (const x of cEdges[c]) if (st[x] === 1) on++; if (on !== clues[c]) good = false; }
            st[e] = 0; if (good) continue;
          }
          st[e] = 2; changed = true;
        }
      }
    }
    return true;
  }
  // returns 'bad' if a closed cycle exists that is not the whole solution, 'done' if lines form one valid loop covering all clues, else 'open'
  function cycles(st) {
    const par = new Int32Array(V).map((_, i) => i);
    const f = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    let closed = false, lines = 0;
    for (let e = 0; e < NE; e++) if (st[e] === 1) {
      lines++;
      const a = f(edges[e][0]), b = f(edges[e][1]);
      if (a === b) closed = true; else par[a] = b;
    }
    if (!closed) return 'open';
    // a cycle exists: it must contain every line, and every clue must be met with the unknowns left empty
    let root = -1;
    for (let e = 0; e < NE; e++) if (st[e] === 1) { const r = f(edges[e][0]); if (root < 0) root = r; else if (r !== root) return 'bad'; }
    for (let v = 0; v < V; v++) { let on = 0; for (const e of vEdges[v]) if (st[e] === 1) on++; if (on !== 0 && on !== 2) return 'bad'; }
    for (let c = 0; c < cEdges.length; c++) { if (clues[c] < 0) continue; let on = 0; for (const e of cEdges[c]) if (st[e] === 1) on++; if (on !== clues[c]) return 'bad'; }
    return 'done';
  }
  function pick(st) {
    // extend an open path end first
    let bu = 9, be = -1;
    for (let v = 0; v < V; v++) { let on = 0, un = 0, u = -1; for (const e of vEdges[v]) { if (st[e] === 1) on++; else if (st[e] === 0) { un++; if (u < 0) u = e; } } if (on === 1 && un > 0) return u; }
    if (be >= 0) return be;
    for (let c = 0; c < cEdges.length; c++) if (clues[c] === 3 || clues[c] === 2) for (const e of cEdges[c]) if (st[e] === 0) return e;
    for (let e = 0; e < NE; e++) if (st[e] === 0) return e;
    return -1;
  }
  function dfs(st) {
    if (count >= limit) return;
    if (!propagate(st)) return;
    const cy = cycles(st);
    if (cy === 'bad') return;
    if (cy === 'done') { count++; if (!first) first = st.map(s => s === 1 ? 1 : 0); return; }
    // failed-literal probing: an edge value that propagates into a contradiction is impossible
    for (let again = true; again;) {
      again = false;
      for (let e = 0; e < NE; e++) {
        if (st[e] !== 0) continue;
        const a = st.slice(); a[e] = 1; const okA = propagate(a) && cycles(a) !== 'bad';
        const b = st.slice(); b[e] = 2; const okB = propagate(b) && cycles(b) !== 'bad';
        if (!okA && !okB) return;
        if (!okA || !okB) { st[e] = okA ? 1 : 2; if (!propagate(st)) return; const c2 = cycles(st); if (c2 === 'bad') return; if (c2 === 'done') { count++; if (!first) first = st.map(s => s === 1 ? 1 : 0); return; } again = true; }
      }
    }
    const e = pick(st);
    if (e < 0) return; // nothing left, no loop: lines empty (a puzzle always needs a loop)
    for (const v of [1, 2]) { const s2 = st.slice(); s2[e] = v; dfs(s2); if (count >= limit) return; }
  }
  dfs(new Int8Array(NE));
  // map to "inside" cells for comparison: parity of crossings scanning each row from the left
  let inside = null;
  if (first) {
    inside = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let p = 0; for (let x = 0; x < W; x++) { if (first[vIdx[x + ',' + y]]) p ^= 1; inside[y * W + x] = p; } }
  }
  return { count, inside };
}
module.exports = { countSolutions };
