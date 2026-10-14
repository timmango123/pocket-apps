// Level generator for 夜市花燈 (flip-lights).
// Uses the game's own core (between CORE-START/CORE-END in index.html, or a core file given as argv[2]).
// 1) Plans board + minimum-move count per level with a DP so the difficulty coefficient rises >= 2% every level
//    while the min-move count stays as close as possible to the spec curve m(L) = 3 * 1.033^(L-1).
// 2) Generates each level backwards from the all-target board (seed = L*9973 + attempt) and re-solves it with the
//    GF(p) solver (Gaussian elimination + null-space enumeration) to confirm the true minimum equals the plan.
// Prints the LEVELS array (JSON) to stdout; progress/summary to stderr.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = (src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//) || [, src])[1];
const C = new Function(coreSrc + '\nreturn {buildBoard, initCells, press, solve, solved, diffCoef, levelDef};')();
const R = 1.02;

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- configs ----------
// cap = largest min-move count we try to generate on that board
const rect = (w, h, p, kinds, cap) => ({ type: 'rect', w, h, p, kinds: kinds || '0', n: w * h, cap: cap || Math.floor((p === 3 ? 1.8 : 0.9) * w * h), nonstd: kinds === 'v', topo: false });
const hexN = (n, p) => ({ type: 'hex', w: 7, h: 8, p, n, cap: Math.floor((p === 3 ? 1.75 : 0.96) * n), nonstd: true, topo: true });
const mixN = n => ({ type: 'mix', w: 7, h: 7, p: 3, n, cap: Math.floor(1.6 * n), nonstd: true, topo: true });
const range = (a, b, f) => { const r = []; for (let n = a; n <= b; n++) r.push(f(n)); return r; };
const CH = [
  [1, 10, [rect(3, 3, 2, '0', 8), rect(3, 4, 2, '0', 10), rect(4, 4, 2, '0', 7), rect(4, 5, 2)]],
  [11, 25, [rect(5, 5, 2, '0', 13), rect(5, 6, 2)]],
  [26, 40, [rect(6, 6, 2), rect(6, 7, 2)]],
  [41, 55, [rect(5, 5, 3, '0', 20), rect(5, 6, 3), rect(6, 6, 3)]],
  [56, 70, [rect(6, 6, 3, 'v'), rect(6, 7, 3, 'v'), rect(7, 7, 3, 'v')]],
  [71, 85, range(38, 50, n => hexN(n, 2))],
  [86, 95, range(38, 46, n => hexN(n, 3))],
  [96, 100, range(39, 47, n => mixN(n))],
];
const f = c => Math.log2(c.n) * (c.p === 3 ? 1.5 : 1) * (c.nonstd ? 1.25 : 1) * (c.topo ? 2 : 1);
const specm = L => 3 * Math.pow(1.033, L - 1);

// ---------- DP plan ----------
function plan() {
  const lv = []; for (const [a, b, cfgs] of CH) for (let L = a; L <= b; L++) lv.push({ L, a, cfgs });
  let cur = new Map();
  for (let i = 0; i < lv.length; i++) {
    const { L, a, cfgs } = lv[i], nx = new Map(), cand = [];
    cfgs.forEach((c, k) => { for (let m = 2; m <= c.cap; m++) cand.push({ k, m, D: m * f(c), c }); });
    const nmax = Math.max(...cfgs.map(c => c.n));
    const local = c => Math.pow(Math.log(c.m / specm(L)), 2) + (c.c.topo ? 0.3 * (1 - c.c.n / nmax) : 0);
    if (i === 0) { for (const c of cand) if (c.m === 3 && c.k === 0) nx.set(c.k * 1000 + c.m, { cost: 0, prev: null, c }); }
    else for (const s of cur.values()) for (const c of cand) {
      if (c.D < R * s.c.D - 1e-9) continue;
      if (L !== a && c.k < s.c.k) continue; // board never shrinks inside a chapter
      const cost = s.cost + local(c) + (L !== a && c.k !== s.c.k ? 0.01 : 0);
      const key = c.k * 1000 + c.m, o = nx.get(key);
      if (!o || cost < o.cost) nx.set(key, { cost, prev: s, c });
    }
    if (!nx.size) throw new Error('plan infeasible at level ' + L);
    cur = nx;
  }
  let best = null; for (const s of cur.values()) if (!best || s.cost < best.cost) best = s;
  const out = []; for (let s = best; s; s = s.prev) out.unshift(s.c); return out;
}

// ---------- masks ----------
function hexBase() { let m = ''; for (let y = 0; y < 8; y++) for (let x = 0; x < 7; x++) m += (y & 1) && x === 6 ? '0' : '1'; return m; }
function mirror(x, y, hex) { return hex ? ((y & 1) ? 5 - x : 6 - x) : 6 - x; }
function connected(mask, hex) {
  const a = mask.split('').map(Number), start = a.indexOf(1), H = a.length / 7; if (start < 0) return false;
  const seen = new Uint8Array(a.length), st = [start]; seen[start] = 1; let cnt = 1;
  while (st.length) {
    const c = st.pop(), x = c % 7, y = (c / 7) | 0;
    const nb = hex ? ((y & 1) ? [[x - 1, y], [x + 1, y], [x, y - 1], [x + 1, y - 1], [x, y + 1], [x + 1, y + 1]] : [[x - 1, y], [x + 1, y], [x - 1, y - 1], [x, y - 1], [x - 1, y + 1], [x, y + 1]])
      : [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) { if (nx < 0 || ny < 0 || nx > 6 || ny >= H) continue; const t = ny * 7 + nx; if (a[t] && !seen[t]) { seen[t] = 1; cnt++; st.push(t); } }
  }
  return cnt === a.filter(v => v).length;
}
function makeMask(n, hex, rnd) {
  for (let tries = 0; tries < 500; tries++) {
    const a = (hex ? hexBase() : '1'.repeat(49)).split('').map(Number);
    let cnt = a.filter(v => v).length, guard = 0;
    while (cnt > n && guard++ < 400) {
      const c = Math.floor(rnd() * a.length), x = c % 7, y = (c / 7) | 0; if (!a[c]) continue;
      const mx = mirror(x, y, hex), mc = y * 7 + mx, single = mc === c;
      if (!single && cnt - 2 < n) continue;
      // keep the board's outline readable: prefer removing border-ish and inner holes, never the centre
      if (x === 3 && (y === 3 || y === 4)) continue;
      a[c] = 0; if (!single) a[mc] = 0;
      const m = a.join('');
      if (!connected(m, hex)) { a[c] = 1; a[mc] = 1; continue; }
      cnt -= single ? 1 : 2;
    }
    if (cnt === n) return a.join('');
  }
  return null;
}

// ---------- generate one level ----------
function genLevel(L, pl) {
  const c = pl.c, m = pl.m;
  for (let att = 0; att < 4000; att++) {
    const rnd = rng(L * 9973 + att * 7919);
    let def;
    if (c.type === 'rect') {
      let kinds = c.kinds; if (kinds === 'v') kinds = L % 2 === 0 ? '1' : '2'; // alternate X-shape / long-cross
      def = { w: c.w, h: c.h, p: c.p, shape: 'sq', kinds, mask: null };
    } else if (c.type === 'hex') {
      const mask = makeMask(c.n, true, rnd); if (!mask) continue;
      def = { w: 7, h: 8, p: c.p, shape: 'hex', kinds: '3', mask };
    } else {
      const mask = makeMask(c.n, false, rnd); if (!mask) continue;
      let ks = ''; for (let i = 0; i < 49; i++) { const x = i % 7, y = (i / 7) | 0, mx = 6 - x; ks += mx < x ? ks.charAt(y * 7 + mx) : String(Math.floor(rnd() * 3)); }
      def = { w: 7, h: 7, p: 3, shape: 'sq', kinds: ks, mask };
    }
    const B = C.buildBoard(def);
    if (B.n !== c.n) throw new Error('cell count mismatch L' + L);
    if (c.type !== 'rect' && C.solve(B, new Uint8Array(B.n).fill(B.target), 1).nullity > 0) continue; // irregular boards: insist on a unique solution
    // presses x with total weight m
    const x = new Uint8Array(B.n), order = [...Array(B.n).keys()].sort(() => rnd() - 0.5);
    if (c.p === 2) { if (m > B.n) continue; for (let i = 0; i < m; i++) x[order[i]] = 1; }
    else {
      const lo = Math.ceil(m / 2), hi = Math.min(B.n, m); if (lo > hi) continue;
      const cells = lo + Math.floor(rnd() * (hi - lo + 1)), twos = m - cells;
      for (let i = 0; i < cells; i++) x[order[i]] = i < twos ? 2 : 1;
    }
    const s = new Uint8Array(B.n).fill(B.target);
    for (let i = 0; i < B.n; i++) for (let k = 0; k < x[i] * (B.p - 1); k++) C.press(B, s, i); // s = target - A x
    const r = C.solve(B, s, 1e6);
    if (!r || r.nullity > 8 || r.moves !== m) continue;
    let lit = 0; for (let i = 0; i < B.n; i++) if (s[i] === B.target) lit++;
    if (lit > B.n * 0.6) continue; // avoid boards that already look almost solved
    const rec = [def.w, def.h, def.p, def.shape === 'hex' ? 'h' : 's', def.kinds, def.mask || '', Array.from(s).join(''), m];
    return { rec, B, nullity: r.nullity, att };
  }
  return null;
}

const P = plan();
const LEVELS = [];
let prevD = 0, ok = true;
for (let i = 0; i < P.length; i++) {
  const L = i + 1, g = genLevel(L, P[i]);
  if (!g) { console.error('FAILED to generate level', L, JSON.stringify({ n: P[i].c.n, p: P[i].c.p, type: P[i].c.type, m: P[i].m })); process.exit(1); }
  const D = C.diffCoef(g.B, g.rec[7]);
  if (D < prevD * R - 1e-9) ok = false;
  console.error('L' + L, P[i].c.type, g.rec[0] + 'x' + g.rec[1], 'p' + g.rec[2], 'cells', g.B.n, 'kinds', g.rec[4].length > 1 ? 'mixed' : g.rec[4], 'm', g.rec[7], 'D', D.toFixed(1), prevD ? '+' + ((D / prevD - 1) * 100).toFixed(1) + '%' : '', 'nullity', g.nullity);
  prevD = D; LEVELS.push(g.rec);
}
console.error('difficulty +' + Math.round((R - 1) * 100) + '% every level:', ok);
console.log('[\n' + LEVELS.map(r => JSON.stringify(r)).join(',\n') + '\n]');
