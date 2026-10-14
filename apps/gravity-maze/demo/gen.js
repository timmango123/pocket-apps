// Offline level generator (seeded PRNG L*40503 + BFS hill-climb on M and trap ratio T). Core logic read from ../index.html via CORE markers.
// node gen.js <levels e.g. 61-70> <k-from> <k-to> <out.json>   |   node gen.js --repair <L> <level> <Dlo> <Mlo> <Mhi> <seed> <out.json> [Dhi]
const fs = require('fs'), path = require('path');
const corePath = process.env.CORE || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(corePath, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {parseLevel,initState,fall,rotate,solve,stateKey,isWin};')();
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function params(L) {
  return {
    n: L <= 15 ? 6 : L <= 35 ? 7 : L <= 60 ? 8 : L <= 85 ? 9 : 10,
    M: Math.min(40, Math.round(3 * Math.pow(1.027, L))),
    T: Math.min(0.8, 0.1 * Math.pow(1.03, L)),
    balls: L < 30 ? 1 : L < 70 ? 2 : 3,
    spike: L >= 20 ? Math.min(4, 1 + Math.floor((L - 20) / 20)) : 0,
    door: L >= 35 ? Math.min(3, 1 + Math.floor((L - 35) / 22)) : 0,
    glue: L >= 50 ? Math.min(3, 1 + Math.floor((L - 50) / 20)) : 0,
    box: L >= 65 ? (L >= 90 ? 2 : 1) : 0,
    portal: L >= 80 ? 1 : 0,
  };
}
function kinds(p) { return (p.spike > 0) + (p.door > 0) + (p.glue > 0) + (p.box > 0) + (p.portal > 0); }
function Draw(M, b, T, K) { return 0.4 * M + 8 * (b - 1) + 10 * T + 2 * K; }
function build(p, rnd) {
  const n = p.n, N = n * n, cells = new Array(N).fill('.');
  const free = () => { for (;;) { const i = Math.floor(rnd() * N); if (cells[i] === '.') return i; } };
  const dens = 0.25 + rnd() * 0.15;
  for (let i = 0; i < Math.round(N * dens); i++) cells[free()] = '#';
  for (let b = 0; b < p.balls; b++) { cells[free()] = 'abc'[b]; cells[free()] = 'ABC'[b]; }
  for (let i = 0; i < p.spike; i++) cells[free()] = 'x';
  for (let i = 0; i < p.door; i++) cells[free()] = '^>v<'[Math.floor(rnd() * 4)];
  for (let i = 0; i < p.glue; i++) cells[free()] = 'g';
  for (let i = 0; i < p.box; i++) cells[free()] = 'O';
  for (let i = 0; i < p.portal; i++) { cells[free()] = String(i + 1); cells[free()] = String(i + 1); }
  return cells;
}
const str = (cells, n) => { const r = []; for (let y = 0; y < n; y++) r.push(cells.slice(y * n, y * n + n).join('')); return r.join('/'); };
// settle: drop once with gravity down; write resulting positions back. null if something sinks/dies.
function settle(cells, n) {
  const L = C.parseLevel(str(cells, n)), S = C.initState(L), r = C.fall(L, S, 2);
  if (r.dead.length || r.S.b.some(b => b < 0)) return null;
  const out = cells.map(ch => 'abcO'.includes(ch) ? '.' : ch);
  r.S.b.forEach((p, i) => out[p] = 'abc'[L.cols[i]]);
  r.S.x.forEach(p => out[p] = 'O');
  return out;
}
function evaluate(cells, n, Mt) {
  const s = settle(cells, n); if (!s) return null;
  const L = C.parseLevel(str(s, n));
  let r = C.solve(L, C.initState(L), 150000, false);
  if (!r || r.len < 1) return null;
  if (Math.abs(r.len - Mt) > 1) return { cells: s, M: r.len, T: null, states: r.states };
  r = C.solve(L, C.initState(L), 400000, true);
  if (!r) return null;
  return { cells: s, M: r.len, T: r.trap, states: r.states };
}
function Mcont(L) { return Math.min(40, 3 * Math.pow(1.027, L)); }
function Dtarget(L) { const p = params(L); const T = L >= 98 ? 0.8 + 0.02 * (L - 97) : p.T; return Draw(Mcont(L), p.balls, T, kinds(p)); }
function mutate(cells, n, rnd) {
  const c = cells.slice(), N = n * n, k = 1 + (rnd() < 0.35 ? 1 : 0);
  for (let j = 0; j < k; j++) {
    const a = Math.floor(rnd() * N), u = rnd();
    if (u < 0.45) { const b = Math.floor(rnd() * N); const t = c[a]; c[a] = c[b]; c[b] = t; }
    else if (u < 0.9) { if (c[a] === '#') c[a] = '.'; else if (c[a] === '.') c[a] = '#'; }
    else if ('^>v<'.includes(c[a])) c[a] = '^>v<'[Math.floor(rnd() * 4)];
  }
  const w = c.filter(ch => ch === '#').length / N;
  if (w < 0.25 || w > 0.40) return null;
  return c;
}
function genOne(L, k) {
  const p = params(L), rnd = mulberry32(L * 40503 + k * 7777 + 1);
  const early = k >= 100 && L < 20; // early ramp: M slightly above the spec curve, T rising slowly, so both M and D climb
  const ET = [null,[3,0],[4,0],[5,0],[6,0],[6,0.17],[6,0.19],[6,0.2],[6,0.22],[6,0.23],[6,0.25],[7,0.22],[7,0.23],[7,0.25],[7,0.27],[7,0.28],[8,0.26],[8,0.28],[8,0.3],[8,0.32]];
  if (early) { p.M = ET[L][0]; p.Tt = ET[L][1] + (k % 3) * 0.01; }
  else if (k >= 40) p.M = Math.min(40, p.M + 3 + ((k - 40) % 4));
  else if (k >= 28) p.M = Math.min(40, p.M + 2 + ((k - 28) % 4));
  else if (k >= 8) p.M = Math.max(3, Math.min(40, p.M + ((k - 8) % 5) - 1));
  else if (k % 4 === 3 && p.M < 40) p.M += 1;
  const K = kinds(p), Dt = Dtarget(L);
  const tneed = M => early ? p.Tt : k >= 40 ? 0.2 : Math.max(0, Math.min(0.95, (Dt - Draw(M, p.balls, 0, K)) / 10));
  const score = e => Math.abs(e.M - p.M) + (e.T == null ? 1.5 : 3 * Math.abs(e.T - tneed(e.M)));
  let cur = null;
  for (let t = 0; t < 3000 && !cur; t++) cur = evaluate(build(p, rnd), p.n, p.M);
  if (!cur) return null;
  let best = cur, sc = score(cur), bsc = sc;
  const iters = 1500 + L * 25;
  const tStart = Date.now();
  for (let it = 0; it < iters && Date.now() - tStart < (+process.env.TCAP || 300000); it++) {
    const m = mutate(cur.cells, p.n, rnd); if (!m) continue;
    const e = evaluate(m, p.n, p.M); if (!e) continue;
    const s2 = score(e);
    if (s2 <= sc || rnd() < 0.02) { cur = e; sc = s2; if (s2 < bsc) { best = e; bsc = s2; } }
    if (bsc < 0.03 || (L > 60 && bsc < 0.12)) break;
  }
  if (best.T == null) { const L2 = C.parseLevel(str(best.cells, p.n)); best.T = C.solve(L2, C.initState(L2), 400000, true).trap; }
  return { L, k, Dt: +Dt.toFixed(3), s: str(best.cells, p.n), M: best.M, T: +best.T.toFixed(3), b: p.balls, K, D: +Draw(best.M, p.balls, best.T, K).toFixed(3), Mt: p.M, Tt: +p.T.toFixed(3), states: best.states };
}
if (require.main === module && process.argv[2] !== '--repair') {
  // node gen.js <levels a-b or comma list> <k-from> <k-to> <outfile>
  const lv = []; process.argv[2].split(',').forEach(t => { const m = t.split('-'); for (let i = +m[0]; i <= +(m[1] || m[0]); i++) lv.push(i); });
  const [k0, k1, out] = [+process.argv[3], +process.argv[4], process.argv[5]];
  const res = [];
  for (const L of lv) for (let k = k0; k <= k1; k++) {
    const t0 = Date.now(); const r = genOne(L, k); res.push(r);
    console.log(JSON.stringify(r && { L, k, M: r.M, Mt: r.Mt, T: r.T, D: r.D, Dt: r.Dt, st: r.states, ms: Date.now() - t0 }));
    fs.writeFileSync(out, JSON.stringify(res));
  }
}
module.exports = { params, Draw, kinds, Dtarget };
// repair mode: node gen.js --repair <L> <levelString> <Dlo> <Mlo> <Mhi> <seed> <outfile>
// hill-climbs from an existing board until D >= Dlo with M in [Mlo, Mhi]
if (require.main === module && process.argv[2] === '--repair') {
  const [L, s0, Dlo, Mlo, Mhi, seed, out] = [+process.argv[3], process.argv[4], +process.argv[5], +process.argv[6], +process.argv[7], +process.argv[8], process.argv[9]];
  const Dhi = process.argv[10] ? +process.argv[10] : Infinity;
  const p = params(L), K = kinds(p), n = p.n, rnd = mulberry32(seed * 7919 + L);
  const full = cells => { const st = settle(cells, n); if (!st) return null; const Lv = C.parseLevel(str(st, n)); const q = C.solve(Lv, C.initState(Lv), 150000, false); if (!q) return null;
    if (q.len < Mlo - 1 || q.len > Mhi + 1) return { cells: st, M: q.len, T: 0, D: 0 };
    const r = C.solve(Lv, C.initState(Lv), 400000, true); if (!r) return null; return { cells: st, M: r.len, T: r.trap, D: Draw(r.len, p.balls, r.trap, K), states: r.states }; };
  const score = e => (e.M < Mlo ? Mlo - e.M : e.M > Mhi ? e.M - Mhi : 0) * 2 + Math.max(0, Dlo - e.D) / 4 + (e.D > 0 ? Math.max(0, e.D - Dhi) / 4 : 0);
  let cur = full(s0.split('/').join('').split('')), best = cur, t0 = Date.now(), it = 0;
  while (score(best) > 0 && Date.now() - t0 < (+process.env.TCAP || 240000)) {
    it++; const m = mutate(cur.cells, n, rnd); if (!m) continue; const e = full(m); if (!e) continue;
    if (score(e) <= score(cur) || rnd() < 0.01) { cur = e; if (score(e) < score(best)) best = e; }
  }
  const r = { L, k: 900 + seed, s: str(best.cells, n), M: best.M, T: +best.T.toFixed(3), b: p.balls, K, D: +best.D.toFixed(3), Mt: p.M, Dt: +Dtarget(L).toFixed(3), states: best.states, ok: score(best) === 0, it };
  let arr = []; try { arr = JSON.parse(fs.readFileSync(out)); } catch (e) {}
  arr.push(r); fs.writeFileSync(out, JSON.stringify(arr));
  console.log(JSON.stringify({ L, M: r.M, D: r.D, T: r.T, ok: r.ok, it, ms: Date.now() - t0 }));
}
