// Offline level generator for 霓虹夜停 (parking-escape).
// Random seeded boards -> explore whole state component -> multi-source BFS from solved states ->
// keep the deepest state (hardest puzzle in that component). Pools are written as JSON lines.
// Usage: node gen.js <phase> <seconds> <seed> <out.jsonl>
// Uses the game's own core logic (extracted from ../index.html between CORE markers, or core.js fallback).
const fs = require('fs'), path = require('path');
function loadCore() {
  const p = path.resolve(__dirname, '..', 'index.html');
  let src = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : fs.readFileSync(process.env.CORE_JS, 'utf8');
  src = src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  return new Function(src + '\nreturn {parseBoard, encodeBoard, gridOf, rangeOf, isWin, keyOf, solve, reachCount, encodeSol, decodeSol, rawDifficulty, mechFactor};')();
}
const C = loadCore();
module.exports = { loadCore };
if (require.main !== module) return;

const PHASES = {
  tut:    { W: 6, n: [2, 4],   truck: 0,   pil: [0, 0] },
  cars6:  { W: 6, n: [7, 11],  truck: 0,   pil: [0, 0] },
  truck6: { W: 6, n: [9, 14],  truck: 0.33, pil: [0, 0] },
  pil6:   { W: 6, n: [10, 14], truck: 0.33, pil: [1, 2] },
  big7:   { W: 7, n: [13, 18], truck: 0.33, pil: [1, 3] },
};
const [phase, secs, seedArg, out] = process.argv.slice(2);
const P = PHASES[phase];
let seed = (+seedArg) >>> 0;
function rnd() { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));

function randomBoard() {
  const W = P.W, E = W === 7 ? 3 : 2, g = new Array(W * W).fill('.');
  const rx = ri(0, W - 4); g[E * W + rx] = g[E * W + rx + 1] = 'A';
  const np = ri(P.pil[0], P.pil[1]);
  for (let k = 0, tries = 0; k < np && tries < 50; tries++) {
    const x = ri(0, W - 1), y = ri(0, W - 1); if (y === E || g[y * W + x] !== '.') continue; g[y * W + x] = 'x'; k++;
  }
  const n = ri(P.n[0], P.n[1]); let id = 1;
  for (let tries = 0; id < n && tries < 400; tries++) {
    const len = rnd() < P.truck ? 3 : 2, h = rnd() < 0.5;
    const x = h ? ri(0, W - len) : ri(0, W - 1), y = h ? ri(0, W - 1) : ri(0, W - len);
    if (h && y === E) continue;
    const cells = []; for (let t = 0; t < len; t++) cells.push(h ? y * W + x + t : (y + t) * W + x);
    if (cells.some(c => g[c] !== '.')) continue;
    const ch = String.fromCharCode(65 + id++); cells.forEach(c => g[c] = ch);
  }
  return g.join('');
}

// fast component analysis: numeric state keys (base-W positions), shared occupancy grid
function analyze(code, cap) {
  const B = C.parseBoard(code), n = B.cars.length, W = B.W, N = B.N, base = W;
  const cars = B.cars, mul = []; let m = 1; for (let i = 0; i < n; i++) { mul.push(m); m *= base; }
  const enc = s => { let k = 0; for (let i = 0; i < n; i++) k += s[i] * mul[i]; return k; };
  const g = new Int8Array(N);
  const fill = s => { for (let c = 0; c < N; c++) g[c] = B.walls[c] ? -2 : -1; for (let i = 0; i < n; i++) { const k = cars[i]; for (let t = 0; t < k.len; t++) g[k.h ? k.f * W + s[i] + t : (s[i] + t) * W + k.f] = i; } };
  const idx = new Map(), keys = [], st = []; const k0 = enc(B.start); idx.set(k0, 0); keys.push(k0); st.push(B.start);
  const nb = (s, k, cb) => { fill(s); for (let i = 0; i < n; i++) { const r = C.rangeOf(B, s, g, i), p = s[i]; for (let v = r[0]; v <= r[1]; v++) if (v !== p) cb(k + (v - p) * mul[i], i, v); } };
  for (let h = 0; h < st.length; h++) {
    const s = st[h];
    nb(s, keys[h], (k2, i, v) => { if (!idx.has(k2)) { idx.set(k2, st.length); keys.push(k2); const t = s.slice(); t[i] = v; st.push(t); } });
    if (st.length > cap) return null;
  }
  const dist = new Int16Array(st.length).fill(-1), q = [];
  for (let j = 0; j < st.length; j++) if (st[j][0] === W - 2) { dist[j] = 0; q.push(j); }
  if (!q.length) return null;
  for (let h = 0; h < q.length; h++) { const j = q[h]; nb(st[j], keys[j], k2 => { const o = idx.get(k2); if (dist[o] < 0) { dist[o] = dist[j] + 1; q.push(o); } }); }
  let best = 0; for (let j = 1; j < st.length; j++) if (dist[j] > dist[best]) best = j;
  return { code: C.encodeBoard(B, st[best]), m: dist[best], R: st.length };
}

function mutate(code) {
  const W = P.W, E = W === 7 ? 3 : 2; let g = code.split('|')[0].split('');
  const ids = [...new Set(g.filter(c => c !== '.' && c !== 'x' && c !== 'A'))];
  const ops = ri(1, 3);
  for (let o = 0; o < ops; o++) {
    const r = rnd();
    if (r < 0.35 && ids.length > P.n[0] - 1) { const id = ids.splice(ri(0, ids.length - 1), 1)[0]; g = g.map(c => c === id ? '.' : c); }
    else if (r < 0.85 && ids.length < P.n[1] - 1) {
      for (let tries = 0; tries < 60; tries++) {
        const len = rnd() < P.truck ? 3 : 2, h = rnd() < 0.5;
        const x = h ? ri(0, W - len) : ri(0, W - 1), y = h ? ri(0, W - 1) : ri(0, W - len);
        if (h && y === E) continue;
        const cells = []; for (let t = 0; t < len; t++) cells.push(h ? y * W + x + t : (y + t) * W + x);
        if (cells.some(c => g[c] !== '.')) continue;
        const nid = 'z' + o + '_' + ids.length; cells.forEach(c => g[c] = nid); ids.push(nid); break;
      }
    } else if (P.pil[1] > 0) {
      const pil = []; g.forEach((c, i) => { if (c === 'x') pil.push(i); });
      if (pil.length > P.pil[0] && rnd() < 0.5) g[pil[ri(0, pil.length - 1)]] = '.';
      else if (pil.length < P.pil[1]) { const c = ri(0, W * W - 1); if (g[c] === '.' && ((c / W) | 0) !== E) g[c] = 'x'; }
    }
  }
  const map = { A: 'A' }; let id = 1;
  return g.map(ch => { if (ch === '.' || ch === 'x') return ch; if (!map[ch]) map[ch] = String.fromCharCode(65 + id++); return map[ch]; }).join('');
}
const CAP = P.W === 7 ? +(process.env.CAP7 || 60000) : +(process.env.CAP6 || 20000);
const end = Date.now() + secs * 1000, seen = new Set(), fd = fs.openSync(out, 'a');
let tried = 0, kept = 0, hist = {};
function record(r) {
  if (!r || r.m < 2 || seen.has(r.code)) return;
  seen.add(r.code); kept++; hist[r.m] = (hist[r.m] || 0) + 1;
  fs.writeSync(fd, JSON.stringify(r) + '\n');
}
// optional: climb from the deepest existing candidates (SEEDS=file.jsonl, MINSEED=m)
const SEEDS = process.env.SEEDS ? fs.readFileSync(process.env.SEEDS, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.m >= +(process.env.MINSEED || 30)) : null;
const CLIMB = +(process.env.CLIMB || 300), THRESH = +(process.env.THRESH || 8);
while (Date.now() < end) {
  tried++;
  let cur = SEEDS ? SEEDS[Math.floor(rnd() * SEEDS.length)] : analyze(randomBoard(), CAP); if (!SEEDS) record(cur);
  if (!cur || cur.m < THRESH || phase === 'tut') continue;
  for (let it = 0; it < CLIMB && Date.now() < end; it++) {
    const r = analyze(mutate(cur.code), CAP); tried++;
    if (!r) continue;
    record(r);
    if (r.m >= cur.m) cur = r;
  }
}
console.log(phase, 'tried', tried, 'kept', kept, JSON.stringify(hist));
