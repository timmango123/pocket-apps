// Fast typed-array BFS equivalent of core.solve (for generation only; final results are re-verified with core.solve)
let STAMP = null, PAR = null, PMV = null, Q = null, stampV = 0, CAP = 0;
function ensure(n) { if (n > CAP) { CAP = n; STAMP = new Int32Array(n); PAR = new Int32Array(n); PMV = new Int8Array(n); stampV = 0; } }
function fastSolve(L, limit, wantTrap) {
  const w = L.w, h = L.h, N = L.N, kind = L.kind, grp = L.grp, mode = L.mode, spA = L.spA, spB = L.spB, goal = L.goal;
  const MB = 1 << L.nG, K = (3 * N + N * N) * MB;
  ensure(K); stampV++;
  if (stampV > 2e9) { STAMP.fill(0); stampV = 1; }
  if (!Q || Q.length < limit + 10) Q = new Int32Array(limit + 10);
  const solid = (c, m) => { const k = kind[c]; return k !== 0 && (k !== 4 || ((m >> grp[c]) & 1) === 1); };
  const fire1 = (c, standing, m) => { const k = kind[c]; if (k === 5 || (k === 6 && standing)) { const g = grp[c], md = mode[c]; if (md === 0) m ^= 1 << g; else if (md === 1) m |= 1 << g; else m &= ~(1 << g); } return m; };
  const fromE = wantTrap ? [] : null, toE = wantTrap ? [] : null, winners = [];
  const k0 = (L.start * 3) * MB + L.m0;
  let qn = 0; Q[qn++] = k0; STAMP[k0] = stampV; PAR[k0] = -1; PMV[k0] = -1;
  let winKey = -1, winMv = -1, head = 0;
  const visit = (from, nk, mv) => {
    if (STAMP[nk] !== stampV) { STAMP[nk] = stampV; PAR[nk] = from; PMV[nk] = mv; Q[qn++] = nk; if (qn > limit) return false; }
    if (wantTrap) { fromE.push(from); toE.push(nk); }
    return true;
  };
  const mergeKey = (a, b, m) => { // a<b
    const ax = a % w, ay = (a / w) | 0, bx = b % w, by = (b / w) | 0;
    if (ay === by && bx - ax === 1) return (a * 3 + 1) * MB + m;
    if (ax === bx && by - ay === 1) return (a * 3 + 2) * MB + m;
    return (3 * N + a * N + b) * MB + m;
  };
  while (head < qn) {
    const key = Q[head++], m = key % MB, code = (key - m) / MB;
    if (code < 3 * N) {
      const p = (code / 3) | 0, o = code % 3, x = p % w, y = (p / w) | 0;
      for (let d = 0; d < 4; d++) {
        let nx = x, ny = y, no = o;
        if (o === 0) { no = d & 1 ? 1 : 2; nx = d === 1 ? x + 1 : d === 3 ? x - 2 : x; ny = d === 2 ? y + 1 : d === 0 ? y - 2 : y; }
        else if (o === 1) { if (d & 1) { no = 0; nx = d === 1 ? x + 2 : x - 1; } else ny = y + (d === 2 ? 1 : -1); }
        else { if (d & 1) nx = x + (d === 1 ? 1 : -1); else { no = 0; ny = d === 2 ? y + 2 : y - 1; } }
        const ex = nx + (no === 1 ? 1 : 0), ey = ny + (no === 2 ? 1 : 0);
        if (nx < 0 || ny < 0 || ex >= w || ey >= h) continue;
        const c1 = ny * w + nx, c2 = no === 0 ? -1 : no === 1 ? c1 + 1 : c1 + w;
        if (!solid(c1, m) || (c2 >= 0 && !solid(c2, m))) continue;
        if (no === 0 && kind[c1] === 2) continue;
        let m2 = fire1(c1, no === 0, m); if (c2 >= 0) m2 = fire1(c2, false, m2);
        if (!solid(c1, m2) || (c2 >= 0 && !solid(c2, m2))) continue;
        if (no === 0 && c1 === goal) { if (winKey < 0) { winKey = key; winMv = d; } winners.push(key); if (!wantTrap) break; continue; }
        let nk;
        if (no === 0 && kind[c1] === 7) {
          const a = spA[c1], b = spB[c1];
          if (!solid(a, m2) || !solid(b, m2)) continue;
          nk = mergeKey(Math.min(a, b), Math.max(a, b), m2);
        } else nk = (c1 * 3 + no) * MB + m2;
        if (!visit(key, nk, d)) return { len: -2, states: qn };
      }
    } else {
      const ab = code - 3 * N, A = (ab / N) | 0, B = ab % N;
      for (let mv = 0; mv < 8; mv++) {
        const d = mv & 3, me = mv >> 2 ? B : A, other = mv >> 2 ? A : B;
        const cx = me % w + (d === 1 ? 1 : d === 3 ? -1 : 0), cy = ((me / w) | 0) + (d === 2 ? 1 : d === 0 ? -1 : 0);
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const nc = cy * w + cx;
        if (!solid(nc, m)) continue;
        const m2 = fire1(nc, false, m);
        if (!solid(nc, m2) || !solid(other, m2)) continue;
        const nk = mergeKey(Math.min(nc, other), Math.max(nc, other), m2);
        if (!visit(key, nk, mv)) return { len: -2, states: qn };
      }
    }
    if (winKey >= 0 && !wantTrap) break;
  }
  if (winKey < 0) return { len: -1, states: qn };
  const sol = [winMv]; let c = winKey;
  while (PAR[c] >= 0) { sol.push(PMV[c]); c = PAR[c]; }
  sol.reverse();
  const res = { len: sol.length, sol, states: qn };
  if (wantTrap) {
    const idx = new Map(); for (let i = 0; i < qn; i++) idx.set(Q[i], i);
    const n = qn, good = new Uint8Array(n), cnt = new Int32Array(n + 1);
    const E = fromE.length, f = new Int32Array(E), t = new Int32Array(E);
    for (let e = 0; e < E; e++) { f[e] = idx.get(fromE[e]); t[e] = idx.get(toE[e]); cnt[t[e] + 1]++; }
    for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
    const adj = new Int32Array(E), pos = cnt.slice(0, n);
    for (let e = 0; e < E; e++) adj[pos[t[e]]++] = f[e];
    const q = [];
    for (const wk of winners) { const i = idx.get(wk); if (!good[i]) { good[i] = 1; q.push(i); } }
    for (let qi = 0; qi < q.length; qi++) { const v = q[qi]; for (let e = cnt[v]; e < cnt[v + 1]; e++) { const u = adj[e]; if (!good[u]) { good[u] = 1; q.push(u); } } }
    res.trap = 1 - q.length / n;
  }
  return res;
}
module.exports = { fastSolve };
