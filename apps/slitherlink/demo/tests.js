// 數回 (slitherlink) — logic tests. Node only, no browser.
// 1) Rule engine unit tests (cell / vertex / loop / corner / trial rules, codec, soundness fuzz against known solutions).
// 2) All 100 embedded levels: board size follows the level plan, the game's own logic solver (limited to the level's
//    techniques) solves it, an INDEPENDENT backtracking counter (written separately below) finds exactly one solution,
//    and that solution is the embedded answer. Difficulty scores rise strictly; the new technique of each band is required.
// Usage: node tests.js            (prints "N passed, 0 failed")
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {makeTopo,parseLevel,encodeLevel,solFromInside,cluesFromSol,newState,loadState,setEdge,cellDed,vertDed,loopDed,cornerPass,propagate,trialDed,fastSolve,gradeSolve,stepFind,genInside,mulberry,levelParams,BANDS,edgeBetween};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
let passed = 0, failed = 0;
function ok(cond, name) { if (cond) passed++; else { failed++; console.log('FAIL ' + name); } }
const t0 = Date.now();

// ---------- independent solution counter (own indexing, plain DFS + local propagation) ----------
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

// ---------- 1. rule unit tests ----------
{
  // codec round trip
  const P = C.makeTopo(4, 3), inside = new Uint8Array([0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0]), clue = new Int8Array(12).fill(-1);
  clue[0] = 1; clue[5] = 3; clue[11] = 0;
  const code = C.encodeLevel(4, 3, clue, inside), Q = C.parseLevel(code);
  ok(Q.W === 4 && Q.H === 3 && Array.from(Q.clue).join() === Array.from(clue).join() && Array.from(Q.inside).join() === Array.from(inside).join(), 'codec round trip ' + code);
  // topology: every edge has 2 endpoints, 4 edges per cell, vertex degree 2..4
  ok(P.NE === 4 * 4 + 5 * 3 && P.NVX === 20, 'edge and vertex counts');
  let badT = 0; for (let c = 0; c < P.NC; c++) for (let k = 0; k < 4; k++) { const e = P.ce[4 * c + k]; if (P.ec[2 * e] !== c && P.ec[2 * e + 1] !== c) badT++; }
  ok(!badT, 'cell edges point back to their cells');
}
{
  // 0 clue -> four crosses
  const P = C.makeTopo(3, 3); P.clue = new Int8Array(9).fill(-1); P.clue[4] = 0;
  const S = C.newState(P), d = C.cellDed(P, S, 4);
  ok(d && d.t === 'zero' && d.set.length === 4 && d.set.every(s => s[1] === 2), 'zero rule');
  // 3 with one cross -> other three lines
  P.clue[4] = 3; S.E[P.ce[16]] = 2;
  const d2 = C.cellDed(P, S, 4);
  ok(d2 && d2.t === 'cellL' && d2.set.length === 3 && d2.set.every(s => s[1] === 1), 'cell needs all remaining edges');
  // over-full cell is a contradiction
  const S3 = C.newState(P); P.clue[4] = 1; C.setEdge(P, S3, P.ce[16], 1); C.setEdge(P, S3, P.ce[18], 1);
  ok(C.cellDed(P, S3, 4).contra === true, 'cell over-count is a contradiction');
}
{
  // vertex rules
  const P = C.makeTopo(3, 3); P.clue = new Int8Array(9).fill(-1);
  const S = C.newState(P), v = 5; // interior vertex (1,1)
  C.setEdge(P, S, P.ve[v * 4 + 0], 1); C.setEdge(P, S, P.ve[v * 4 + 1], 1);
  const d = C.vertDed(P, S, v);
  ok(d && d.t === 'vFull' && d.set.length === 2 && d.set.every(s => s[1] === 2), 'vertex with two lines crosses the rest');
  const S2 = C.newState(P); C.setEdge(P, S2, P.ve[v * 4 + 0], 1); S2.E[P.ve[v * 4 + 1]] = 2; S2.E[P.ve[v * 4 + 2]] = 2;
  const d2 = C.vertDed(P, S2, v);
  ok(d2 && d2.t === 'vExt' && d2.set[0][0] === P.ve[v * 4 + 3] && d2.set[0][1] === 1, 'line must continue through the only exit');
  const S3 = C.newState(P); // corner vertex 0 has edges right and down; cross one -> other is dead end
  S3.E[P.ve[0 * 4 + 1]] = 2;
  const d3 = C.vertDed(P, S3, 0);
  ok(d3 && d3.t === 'vDead' && d3.set[0][1] === 2, 'dead-end rule at a corner');
  const S4 = C.newState(P); C.setEdge(P, S4, P.ve[v * 4 + 0], 1); C.setEdge(P, S4, P.ve[v * 4 + 1], 1);
  ok(!C.setEdge(P, S4, P.ve[v * 4 + 2], 1) && S4.contra.t === 'branch', 'third line at a vertex is a branch contradiction');
}
{
  // loop rule: a U-shaped path whose ends are adjacent must not be closed while a clue elsewhere is unmet
  const P = C.makeTopo(3, 3); P.clue = new Int8Array(9).fill(-1); P.clue[8] = 2;
  const S = C.newState(P), W1 = 4, vid = (x, y) => y * W1 + x;
  [[0, 0, 1, 0], [1, 0, 1, 1], [0, 0, 0, 1]].forEach(q => C.setEdge(P, S, C.edgeBetween(P, vid(q[0], q[1]), vid(q[2], q[3])), 1));
  const e = C.edgeBetween(P, vid(0, 1), vid(1, 1)), d = C.loopDed(P, S, e);
  ok(d && d.t === 'loop' && d.set[0][1] === 2, 'premature loop closure is crossed');
  const T = C.newState(P); [[0, 0, 1, 0], [1, 0, 1, 1], [0, 0, 0, 1]].forEach(q => C.setEdge(P, T, C.edgeBetween(P, vid(q[0], q[1]), vid(q[2], q[3])), 1));
  ok(!C.setEdge(P, T, e, 1) && T.contra.t === 'loop', 'closing a small loop is a contradiction');
  // the same closure is fine when it completes the puzzle
  const P2 = C.makeTopo(3, 3); P2.clue = new Int8Array(9).fill(-1); P2.clue[1] = 1;
  const S2 = C.newState(P2); [[0, 0, 1, 0], [1, 0, 1, 1], [0, 0, 0, 1]].forEach(q => C.setEdge(P2, S2, C.edgeBetween(P2, vid(q[0], q[1]), vid(q[2], q[3])), 1));
  ok(C.loopDed(P2, S2, e) === null && C.setEdge(P2, S2, e, 1) && S2.solved, 'closing the loop that satisfies every clue solves the puzzle');
}
{
  // corner pairs: 3 in the board corner -> both outer edges are lines; 1 in the corner -> both crossed
  const P = C.makeTopo(4, 4); P.clue = new Int8Array(16).fill(-1); P.clue[0] = 3;
  const d = C.cornerPass(P, C.newState(P), false);
  ok(d && d.t === 'corner' && d.set.length === 2 && d.set.every(s => s[1] === 1) && d.set.every(s => s[0] === P.ce[0] || s[0] === P.ce[3]), '3 in the corner draws both corner edges');
  P.clue[0] = 1; const d1 = C.cornerPass(P, C.newState(P), false);
  ok(d1 && d1.set.every(s => s[1] === 2) && d1.set.every(s => s[0] === P.ce[0] || s[0] === P.ce[3]), '1 in the corner crosses both corner edges');
  // adjacent 3s: all three parallel edges are lines (needs trial or corner+loop)
  const Q = C.makeTopo(5, 3); Q.clue = new Int8Array(15).fill(-1); Q.clue[6] = 3; Q.clue[7] = 3; Q.clue[4] = 3; // a corner 3 elsewhere rules out the lone rectangle
  const S = C.newState(Q); C.propagate(Q, S, 7);
  let d3 = null, T = S; for (let g = 0; g < 6; g++) { const dd = C.trialDed(Q, T, 7, null, 30); if (!dd) break; C.setEdge(Q, T, dd.set[0][0], dd.set[0][1]); C.propagate(Q, T, 7); d3 = dd; }
  const mids = [Q.ce[6 * 4 + 3], Q.ce[6 * 4 + 1], Q.ce[7 * 4 + 1]];
  ok(d3 && mids.every(e => T.E[e] === 1), 'adjacent 3s: the three parallel edges are lines');
}
{
  // soundness fuzz: from random partial states of known solutions, no rule (any level) may contradict the solution
  const rng = C.mulberry(99); let wrong = 0, checked = 0;
  for (let t = 0; t < 160; t++) {
    const W = 4 + (t % 5), H = 4 + ((t >> 2) % 5), P = C.makeTopo(W, H), inside = C.genInside(W, H, rng, 0.5, 2), sol = C.solFromInside(P, inside);
    P.clue = C.cluesFromSol(P, sol); for (let c = 0; c < P.NC; c++) if (rng() < 0.5) P.clue[c] = -1;
    const E = new Int8Array(P.NE); for (let e = 0; e < P.NE; e++) if (rng() < 0.3) E[e] = sol[e] ? 1 : 2;
    const S = C.loadState(P, E); if (!S) { wrong++; continue; }
    for (let lv = 1; lv <= 4; lv++) {
      const d = C.stepFind(P, S, lv, null, 12); if (!d) continue; checked++;
      if (d.contra) { wrong++; continue; }
      for (const [e, v] of d.set) if ((v === 1) !== (sol[e] === 1)) wrong++;
    }
  }
  ok(wrong === 0 && checked > 300, 'soundness fuzz: ' + checked + ' deductions, ' + wrong + ' wrong');
}

// ---------- 2. the 100 levels ----------
ok(LEVELS.length === 100, 'exactly 100 levels (' + LEVELS.length + ')');
let prev = 0, minStep = 9, maxStep = 0, slowest = 0, uniq = 0, logic = 0, sizeOK = 0, needOK = 0, needN = 0;
const seen = new Set();
const regrade = new Set([1, 4, 10, 25, 37, 50, 75, 99]);
for (let n = 1; n <= LEVELS.length; n++) {
  const [code, score] = LEVELS[n - 1], P = C.parseLevel(code), pr = C.levelParams(n);
  ok(!seen.has(code), 'level ' + n + ' is not a duplicate'); seen.add(code);
  if (P.W === pr.W && P.H === pr.H) sizeOK++; else console.log('FAIL level ' + n + ' size ' + P.W + 'x' + P.H + ' != plan ' + pr.W + 'x' + pr.H);
  // the game's own logic, limited to the level's techniques
  const tech = pr.maxLevel === 1 ? 1 : pr.maxLevel === 2 ? 3 : 7, trial = pr.maxLevel >= 4 ? pr.maxChain : false;
  const r = C.fastSolve(P, tech, trial);
  const lg = r.status === 'solved' && Array.from(P.sol).every((v, e) => (r.S.E[e] === 1) === (v === 1));
  if (lg) logic++; else console.log('FAIL level ' + n + ' logic solver: ' + r.status);
  // independent uniqueness
  const t1 = Date.now(), u = countSolutions(P.W, P.H, Array.from(P.clue), 2); slowest = Math.max(slowest, Date.now() - t1);
  const same = u.count === 1 && u.inside.every((v, i) => v === P.inside[i]);
  if (same) uniq++; else console.log('FAIL level ' + n + ' independent search found ' + u.count + ' solution(s)' + (u.count === 1 ? ' (different from embedded)' : ''));
  // the band's newest technique is really needed
  if (pr.maxLevel >= 2 && !pr.keep) { needN++; const tech0 = pr.maxLevel === 2 ? 1 : pr.maxLevel === 3 ? 3 : 7; if (C.fastSolve(P, tech0, false).status !== 'solved') needOK++; else console.log('FAIL level ' + n + ' solvable without its new technique'); }
  if (regrade.has(n)) { const g = C.gradeSolve(P, pr.maxLevel, pr.maxChain || 30); ok(g.status === 'solved' && Math.abs(g.score - score) < 0.05, 'level ' + n + ' graded score ' + g.score + ' matches embedded ' + score); }
  if (n > 1) { const st = score / prev - 1; minStep = Math.min(minStep, st); maxStep = Math.max(maxStep, st); ok(score > prev, 'level ' + n + ' score ' + score + ' above previous ' + prev); }
  prev = score;
}
ok(sizeOK === 100, 'board sizes follow the level plan (' + sizeOK + '/100)');
ok(logic === 100, 'logic solver clears every level with only its techniques (' + logic + '/100)');
ok(uniq === 100, 'independent search: exactly one solution, equal to the embedded one (' + uniq + '/100)');
ok(needOK === needN, 'each band\'s new technique is required (' + needOK + '/' + needN + ')');
ok(maxStep < 0.3, 'no difficulty wall: largest level-to-level score step +' + (maxStep * 100).toFixed(1) + '%');
console.log('levels: smallest step +' + (minStep * 100).toFixed(1) + '%, largest +' + (maxStep * 100).toFixed(1) + '%, slowest independent check ' + slowest + ' ms, total ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
