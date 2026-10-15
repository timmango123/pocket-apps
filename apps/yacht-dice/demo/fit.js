// Offline tool: run after solve.js. Fit the compact value tables U[upperMask][u] + L[lowerMask][y] to the exact DP, weighted by optimal-play visit frequency.
const fs = require('fs'), path = require('path');
const YC = new Function(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return YC;')();
const V = new Float32Array(fs.readFileSync(path.join(require('os').tmpdir(), 'yacht-vtable.bin')).buffer.slice(0));
const idx = (m, u, y) => m * 128 + u * 2 + y;
const Vexact = (m, u, y) => m === 8191 ? 0 : V[idx(m, u, y)];
const NG = +(process.argv[2] || 20000);
// 1) visit counts under optimal play + category averages
const visits = new Float64Array(8192 * 128), catSum = new Float64Array(13);
let tot = 0; const R = YC.rng(12345);
for (let g = 0; g < NG; g++) {
  const sh = YC.playSheet(2, R, Vexact, (s) => { const st = YC.stateOf(s); visits[idx(st.mask, st.u, st.y)]++; });
  tot += YC.total(sh); for (let c = 0; c < 13; c++) catSum[c] += sh.sc[c];
}
console.log(`optimal policy over ${NG} games: mean ${(tot / NG).toFixed(2)}`);
// reachable states
const reach = [];
for (let um = 0; um < 64; um++) { let s = new Set([0]); for (let i = 0; i < 6; i++) if (um >> i & 1) { const n = new Set(); for (const v of s) for (let k = 0; k <= 5; k++) n.add(Math.min(63, v + (i + 1) * k)); s = n; } reach.push([...s]); }
const S = []; for (let m = 0; m < 8191; m++) for (const u of reach[m & 63]) { S.push([m, u, 0]); if (m >> 11 & 1) S.push([m, u, 1]); }
const w = S.map(([m, u, y]) => visits[idx(m, u, y)] + 0.02);
const U = new Float64Array(4096), L = new Float64Array(256);
for (let it = 0; it < 60; it++) {
  const nu = new Float64Array(4096), du = new Float64Array(4096);
  S.forEach(([m, u, y], i) => { const k = (m & 63) * 64 + u; nu[k] += w[i] * (Vexact(m, u, y) - L[(m >> 6) * 2 + y]); du[k] += w[i]; });
  for (let k = 0; k < 4096; k++) if (du[k]) U[k] = nu[k] / du[k];
  const nl = new Float64Array(256), dl = new Float64Array(256);
  S.forEach(([m, u, y], i) => { const k = (m >> 6) * 2 + y; nl[k] += w[i] * (Vexact(m, u, y) - U[(m & 63) * 64 + u]); dl[k] += w[i]; });
  for (let k = 0; k < 256; k++) if (dl[k]) L[k] = nl[k] / dl[k];
}
// shift so all entries are >= 0 for uint16 storage: move constant from U to L
let minU = Infinity; for (let k = 0; k < 4096; k++) minU = Math.min(minU, U[k]);
for (let k = 0; k < 4096; k++) U[k] -= minU; for (let k = 0; k < 256; k++) L[k] += minU;
let minL = Infinity; for (let k = 0; k < 256; k++) minL = Math.min(minL, L[k]); console.log('minL', minL.toFixed(2), 'minU shift', minU.toFixed(2));
let err = 0, ws = 0; S.forEach(([m, u, y], i) => { const e = U[(m & 63) * 64 + u] + L[(m >> 6) * 2 + y] - Vexact(m, u, y); err += w[i] * e * e; ws += w[i]; });
console.log('weighted RMSE', Math.sqrt(err / ws).toFixed(3));
const enc = a => { const b = Buffer.alloc(a.length * 2); a.forEach((v, i) => b.writeUInt16LE(Math.max(0, Math.min(65535, Math.round((v + 300) * 100))), i * 2)); return b.toString('base64'); };
const Wc = [...catSum].map(s => +(s / NG).toFixed(2));
const Up = []; for (let um = 0; um < 64; um++) for (const u of reach[um].slice().sort((a, b) => a - b)) Up.push(U[um * 64 + u]); // only reachable (mask,u) pairs
const out = { U: enc(Up), L: enc(L), W: Wc };
fs.writeFileSync(path.join(require('os').tmpdir(), 'yacht-tables.json'), JSON.stringify(out)); // paste into index.html's YC.loadTables(...) call
console.log('category means', Wc.join(' '), 'U b64', out.U.length, 'L b64', out.L.length);
// 2) evaluate levels with the quantized tables
YC.loadTables(out.U, out.L, out.W);
for (const lv of [2, 1, 0]) {
  const R2 = YC.rng(999); let s = 0, n = 5000, yz = 0, bon = 0;
  const t0 = Date.now();
  for (let g = 0; g < n; g++) { const sh = YC.playSheet(lv, R2); s += YC.total(sh); if (YC.upper(sh) >= 63) bon++; if (sh.sc[11] === 50) yz++; }
  console.log(`level ${lv}: mean ${(s / n).toFixed(2)} over ${n}, bonus ${(100 * bon / n).toFixed(1)}%, yacht ${(100 * yz / n).toFixed(1)}%, ${((Date.now() - t0) / n).toFixed(1)} ms/game`);
}
