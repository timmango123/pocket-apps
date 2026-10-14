// Offline level generator for 石碑翻滾 (block-roll). Core logic is read from the game file (CORE markers).
// node gen.js <outdir> <levels...>   (levels as numbers or ranges a-b); env SECS = time budget per level
const fs = require('fs'), path = require('path');
const SRC = process.env.CORE || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');
const core = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, doMove, solve, stateKey};')();

const { fastSolve } = require('./fast.js');
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function cfg(n) {
  const A = Math.round(30 * Math.pow(1.02, n));
  const side = Math.min(17, Math.ceil(Math.sqrt(A / 0.62)));
  const M = Math.round(8 * Math.pow(1.03, n)) + Math.floor(n / 10);
  return {
    n, A, W: side + (n % 2), H: side,
    M,
    sw: n >= 8 ? Math.min(6, Math.floor((n - 8) / 12) + 1) : 0,
    frag: n >= 15 ? 0.15 * (n - 15) / 85 + 0.02 : 0,
    split: n >= 80 ? 2 : n >= 40 ? 1 : 0,
    trapLo: n < 20 ? 0 : n <= 30 ? 0.10 + (n - 20) * 0.015 : 0.25 + (n - 30) * 0.005,
    trapHi: n < 20 ? 0 : n <= 30 ? 0.10 + (n - 20) * 0.015 + 0.012 : 0.25 + (n - 30) * 0.005 + 0.02,
    trapMin: n >= 8 ? 1 : 0,
  };
}

// genome: arrays over cells
function G(c) { return { W: c.W, H: c.H, t: new Array(c.W * c.H).fill('.'), g: new Array(c.W * c.H).fill(-1), md: new Array(c.W * c.H).fill(0), sp: {}, m: 0 }; }
function clone(x) { return { W: x.W, H: x.H, t: x.t.slice(), g: x.g.slice(), md: x.md.slice(), sp: JSON.parse(JSON.stringify(x.sp)), m: x.m }; }
function toDef(x) {
  const rows = [], sw = [], br = [], sp = [];
  for (let y = 0; y < x.H; y++) {
    let r = '';
    for (let xx = 0; xx < x.W; xx++) {
      const c = y * x.W + xx, ch = x.t[c]; r += ch;
      if (ch === 'w' || ch === 'X') sw.push([x.g[c], x.md[c]]);
      else if (ch === 'B') br.push(x.g[c]);
      else if (ch === 'T') sp.push(x.sp[c]);
    }
    rows.push(r);
  }
  return { r: rows.join('/'), sw, br, m: x.m, sp };
}
// crop to bounding box of non-void cells (re-index split destinations)
function crop(def) {
  const rows = def.r.split('/'), H = rows.length, W = rows[0].length;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nw = x1 - x0 + 1, nr = [];
  for (let y = y0; y <= y1; y++) nr.push(rows[y].slice(x0, x1 + 1));
  const re = c => ((c / W | 0) - y0) * nw + (c % W - x0);
  return { r: nr.join('/'), sw: def.sw, br: def.br, m: def.m, sp: def.sp.map(p => [re(p[0]), re(p[1])]) };
}
const plain = ch => ch === 'o';
function cellsWhere(x, f) { const r = []; for (let i = 0; i < x.t.length; i++) if (f(x.t[i], i)) r.push(i); return r; }
function pick(a, rnd) { return a[Math.floor(rnd() * a.length)]; }
function nbrs(x, c) { const r = [], cx = c % x.W, cy = c / x.W | 0; if (cx > 0) r.push(c - 1); if (cx < x.W - 1) r.push(c + 1); if (cy > 0) r.push(c - x.W); if (cy < x.H - 1) r.push(c + x.W); return r; }

function initial(c, rnd) {
  const x = G(c), N = c.W * c.H;
  // maze of corridors: spanning tree over odd lattice points, then widen randomly toward area A
  const cw = (c.W - 1) >> 1, ch = (c.H - 1) >> 1, seen = new Uint8Array(cw * ch);
  const at = (i, j) => (2 * j + 1) * c.W + 2 * i + 1;
  const stack = [[Math.floor(rnd() * cw), Math.floor(rnd() * ch)]]; seen[stack[0][1] * cw + stack[0][0]] = 1; x.t[at(stack[0][0], stack[0][1])] = 'o';
  let cnt = 1;
  while (stack.length && cnt < c.A * 0.75) {
    const k = rnd() < 0.7 ? stack.length - 1 : Math.floor(rnd() * stack.length), [i, j] = stack[k];
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => i + a >= 0 && j + b >= 0 && i + a < cw && j + b < ch && !seen[(j + b) * cw + i + a]);
    if (!opts.length) { stack.splice(k, 1); continue; }
    const [a, b] = pick(opts, rnd); seen[(j + b) * cw + i + a] = 1; stack.push([i + a, j + b]);
    x.t[at(i, j) + a + b * c.W] = 'o'; x.t[at(i + a, j + b)] = 'o'; cnt += 2;
  }
  while (cnt < c.A) {
    const i = Math.floor(rnd() * N);
    if (x.t[i] === '.' && nbrs(x, i).some(j => x.t[j] !== '.')) { x.t[i] = 'o'; cnt++; }
  }
  const fl = () => cellsWhere(x, plain);
  x.t[pick(fl(), rnd)] = 'S'; x.t[pick(fl(), rnd)] = 'G';
  for (let i = 0; i < c.sw; i++) {
    const s = pick(fl(), rnd); x.t[s] = rnd() < 0.5 ? 'w' : 'X'; x.g[s] = i; x.md[s] = c.n < 20 || rnd() < 0.7 ? 0 : 1 + (rnd() < 0.5 ? 1 : 0);
    const nb = 1 + Math.floor(rnd() * 2);
    for (let j = 0; j < nb; j++) { const cands = cellsWhere(x, ch => ch === '.' || ch === 'o'); const b = pick(cands, rnd); x.t[b] = 'B'; x.g[b] = i; }
    if (rnd() < 0.5) x.m |= 1 << i;
  }
  const nf = Math.round(c.A * c.frag);
  for (let i = 0; i < nf; i++) { const f = fl(); if (f.length) x.t[pick(f, rnd)] = 'c'; }
  for (let i = 0; i < c.split; i++) {
    const p = pick(fl(), rnd); x.t[p] = 'T';
    const a = pick(fl(), rnd); let b = pick(fl(), rnd); let k = 0; while ((b === a || adj(x, a, b)) && k++ < 50) b = pick(fl(), rnd);
    x.sp[p] = [a, b];
  }
  return x;
}
function adj(x, a, b) { return nbrs(x, a).includes(b); }

function mutate(x, c, rnd) {
  const y = clone(x), N = c.W * c.H, r = rnd();
  const fl = () => cellsWhere(y, plain);
  const destUsed = new Set(); for (const k in y.sp) { destUsed.add(y.sp[k][0]); destUsed.add(y.sp[k][1]); }
  if (r < 0.45) { // toggle a void/floor cell next to the map
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(rnd() * N);
      if (destUsed.has(i)) continue;
      if (y.t[i] === 'o') { y.t[i] = '.'; break; }
      if (y.t[i] === '.' && nbrs(y, i).some(j => y.t[j] !== '.')) { y.t[i] = 'o'; break; }
    }
  } else if (r < 0.55) { // move start or goal
    const ch = rnd() < 0.5 ? 'S' : 'G', f = fl().filter(i => !destUsed.has(i)); if (!f.length) return y;
    const old = y.t.indexOf(ch); y.t[old] = 'o'; y.t[pick(f, rnd)] = ch;
  } else if (r < 0.63 && c.frag > 0) { // fragile <-> floor
    const fr = cellsWhere(y, ch => ch === 'c'), f = fl().filter(i => !destUsed.has(i));
    if (fr.length && rnd() < 0.5) y.t[pick(fr, rnd)] = 'o'; else if (f.length) y.t[pick(f, rnd)] = 'c';
    if (fr.length && f.length && rnd() < 0.5) { y.t[pick(fr, rnd)] = 'o'; y.t[pick(f, rnd)] = 'c'; }
  } else if (r < 0.75 && c.sw > 0) { // move switch / change type or mode
    const s = pick(cellsWhere(y, ch => ch === 'w' || ch === 'X'), rnd), q = rnd();
    if (q < 0.5) { const f = fl().filter(i => !destUsed.has(i)); if (f.length) { const t = pick(f, rnd); y.t[t] = y.t[s]; y.g[t] = y.g[s]; y.md[t] = y.md[s]; y.t[s] = 'o'; y.g[s] = -1; } }
    else if (q < 0.75) y.t[s] = y.t[s] === 'w' ? 'X' : 'w';
    else if (q < 0.9) y.md[s] = c.n >= 20 ? Math.floor(rnd() * 3) : 0;
    else y.m ^= 1 << y.g[s];
  } else if (r < 0.9 && c.sw > 0) { // move / add / remove bridge cell
    const g = Math.floor(rnd() * c.sw), bs = cellsWhere(y, (ch, i) => ch === 'B' && y.g[i] === g), q = rnd();
    const cands = cellsWhere(y, (ch, i) => (ch === '.' || ch === 'o') && !destUsed.has(i));
    if (q < 0.6 && bs.length) { const b = pick(bs, rnd); y.t[b] = rnd() < 0.5 ? 'o' : '.'; y.g[b] = -1; const t = pick(cands, rnd); y.t[t] = 'B'; y.g[t] = g; }
    else if (q < 0.8 && bs.length < 4) { const t = pick(cands, rnd); y.t[t] = 'B'; y.g[t] = g; }
    else if (bs.length > 1) { const b = pick(bs, rnd); y.t[b] = '.'; y.g[b] = -1; }
  } else if (c.split > 0) { // move split pad or destination
    const pads = Object.keys(y.sp).map(Number), p = pick(pads, rnd), q = rnd(), f = fl().filter(i => !destUsed.has(i));
    if (!f.length) return y;
    if (q < 0.34) { const t = pick(f, rnd); y.t[t] = 'T'; y.sp[t] = y.sp[p]; delete y.sp[p]; y.t[p] = 'o'; }
    else { const k = q < 0.67 ? 0 : 1, t = pick(f, rnd); const o = y.sp[p][1 - k]; if (t !== o && !adj(y, t, o)) y.sp[p][k] = t; }
  }
  return y;
}

function evaluate(x, c) {
  const def = toDef(x);
  const fc = x.t.filter(ch => ch !== '.').length;
  const L = core.parseLevel(def);
  if (L.start < 0 || L.goal < 0) return null;
  const r = fastSolve(L, c.limit || 600000, c.trapMin > 0);
  if (r.len < 0) return { len: r.len, score: 1e6 };
  // mechanic usage along the optimal solution
  let S = core.initState(L), usedSw = 0, usedSp = 0;
  for (const mv of r.sol) { const q = core.doMove(L, S, mv); if (q.ev.fired.some(f => f.changed)) usedSw++; if (q.ev.split) usedSp++; S = q.S; }
  let pen = 0;
  if (c.sw > 0 && usedSw === 0) pen += 6;
  if (c.split > 0 && usedSp === 0) pen += 6;
  if (c.trapMin > 0) { if (r.trap < c.trapLo - 1e-9) pen += Math.ceil((c.trapLo - r.trap) * 100); else if (r.trap > c.trapHi + 1e-9) pen += Math.ceil((r.trap - c.trapHi) * 100); }
  const nfr = x.t.filter(ch => ch === 'c').length, frMax = Math.round(fc * c.frag * 1.15) + 1;
  if (c.frag > 0 && nfr > frMax) pen += nfr - frMax;
  if (fc < c.A * 0.8) pen += Math.ceil((c.A * 0.8 - fc) / 3);
  if (fc > c.A * 1.25) pen += Math.ceil((fc - c.A * 1.25) / 3);
  if (r.states > 500000) pen += Math.ceil((r.states - 500000) / 50000);
  const score = Math.abs(c.target - r.len) + pen;
  return { len: r.len, trap: r.trap || 0, score, pen, usedSw, usedSp, states: r.states, fc, def };
}

function T(n) { return 7 + n + Math.round(0.12 * Math.pow(Math.max(0, n - 40), 1.3)); }
// embed a previous genome into this level's grid and top up mechanics
function embed(prev, c, rnd) {
  const W = Math.max(c.W, prev.W), H = Math.max(c.H, prev.H), x = G({ W, H });
  const ox = (W - prev.W) >> 1, oy = (H - prev.H) >> 1, re = i => (((i / prev.W) | 0) + oy) * W + (i % prev.W) + ox;
  for (let i = 0; i < prev.t.length; i++) { const j = re(i); x.t[j] = prev.t[i]; x.g[j] = prev.g[i]; x.md[j] = prev.md[i]; }
  for (const k in prev.sp) x.sp[re(+k)] = prev.sp[k].map(re);
  x.m = prev.m;
  const fl = () => cellsWhere(x, plain);
  let ng = 0; for (let i = 0; i < x.g.length; i++) if (x.g[i] >= ng) ng = x.g[i] + 1;
  for (let g = ng; g < c.sw; g++) {
    const s = pick(fl(), rnd); x.t[s] = rnd() < 0.5 ? 'w' : 'X'; x.g[s] = g; x.md[s] = c.n < 20 || rnd() < 0.6 ? 0 : 1 + (rnd() < 0.5 ? 1 : 0);
    const cands = cellsWhere(x, ch => ch === '.' || ch === 'o'); const b = pick(cands, rnd); x.t[b] = 'B'; x.g[b] = g;
    if (rnd() < 0.5) x.m |= 1 << g;
  }
  let np = Object.keys(x.sp).length;
  for (; np < c.split; np++) {
    const p = pick(fl(), rnd); x.t[p] = 'T';
    const a = pick(fl(), rnd); let b = pick(fl(), rnd), k = 0; while ((b === a || adj(x, a, b)) && k++ < 50) b = pick(fl(), rnd);
    x.sp[p] = [a, b];
  }
  const fc = x.t.filter(ch => ch !== '.').length, want = Math.round(c.A * c.frag);
  let have = x.t.filter(ch => ch === 'c').length;
  while (have < want) { x.t[pick(fl(), rnd)] = 'c'; have++; }
  // grow toward this level's area
  let cnt = fc;
  while (cnt < c.A * 0.9) { const i = Math.floor(rnd() * W * H); if (x.t[i] === '.' && nbrs(x, i).some(j => x.t[j] !== '.')) { x.t[i] = 'o'; cnt++; } }
  return x;
}
function gen(n, secs, prev, self) {
  const c = cfg(n); c.target = T(n); c.limit = 1500000;
  const t0 = Date.now(); let best = null, bestX = null;
  for (let attempt = 0; Date.now() - t0 < secs * 1000; attempt++) {
    const rnd = mulberry32((n * 2654435761 >>> 0) + attempt * 7919);
    let x, cur, k = 0;
    do { x = self && attempt < 2 ? embed(self, c, rnd) : prev && attempt < 4 ? embed(prev, c, rnd) : initial(c, rnd); cur = evaluate(x, c); } while ((!cur || cur.len < 0) && k++ < 300);
    if (!cur || cur.len < 0) continue;
    const ta = Date.now(), budget = Math.max(20000, secs * 1000 / 3);
    let stale = 0, it = 0, drift = 0;
    while (Date.now() - ta < budget && Date.now() - t0 < secs * 1000) {
      const y = mutate(x, c, rnd), e = evaluate(y, c);
      if (e && e.len > 0 && e.score <= cur.score) { if (e.score < cur.score) stale = 0; x = y; cur = e; if (cur.score === 0) drift++; } else stale++;
      if (cur.score === 0 && (drift >= 120 || stale > 1500)) break; // drift a while at target for variety
      if (stale > 5000) break;
      it++; if (process.env.DBG && it % 500 === 0) console.error(n, it, cur.len, cur.score, cur.pen, cur.states, ((Date.now() - ta) / 1000).toFixed(0) + "s");
    }
    if (!best || cur.score < best.score) { best = cur; bestX = x; }
    if (best.score === 0) break;
  }
  best.genome = bestX; best.T = c.target; best.n = n;
  return best;
}
module.exports = { T, embed, gen, cfg, crop, core, initial, mutate, toDef, evaluate, mulberry32 };
if (require.main === module) {
  // chain mode: node gen.js chain <j> <outdir> [secs]  -> levels j, j+4, ... each seeded from level n-4
  const [, , mode, j, outdir, secsArg] = process.argv;
  if (mode === 'redo') { // node gen.js redo <n> <outdir> [secs]: re-climb one level from its own genome until exact
    const n = +j, f = path.join(outdir, 'L' + n + '.json'), cur = JSON.parse(fs.readFileSync(f, 'utf8'));
    const pf = path.join(outdir, 'L' + (n - (+process.env.PREVOFF || 4)) + '.json'), prev = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, 'utf8')).genome : null;
    const t0 = Date.now(), b = gen(n, +(secsArg || 300), prev, process.env.NOSELF ? null : cur.genome);
    if (b.score < cur.score) fs.writeFileSync(f, JSON.stringify({ n, T: b.T, len: b.len, trap: b.trap, pen: b.pen, score: b.score, usedSw: b.usedSw, usedSp: b.usedSp, states: b.states, fc: b.fc, def: crop(b.def), genome: b.genome, secs: (Date.now() - t0) / 1000 }));
    console.log('redo L' + n, 'old score', cur.score, 'new score', b.score, 'len', b.len, 'trap', (b.trap || 0).toFixed(3));
    return;
  }
  const secs = +(secsArg || 120);
  fs.mkdirSync(outdir, { recursive: true });
  let prev = null;
  for (let n = +j; n <= 100; n += 4) {
    const f = path.join(outdir, 'L' + n + '.json');
    if (fs.existsSync(f)) { prev = JSON.parse(fs.readFileSync(f, 'utf8')).genome; continue; }
    const of = path.join(outdir + '_old', 'L' + n + '.json'), self = fs.existsSync(of) ? JSON.parse(fs.readFileSync(of, 'utf8')).genome : null;
    const t0 = Date.now(), b = gen(n, n >= 80 ? Math.max(secs, 300) : secs, prev, self);
    const out = { n, T: b.T, len: b.len, trap: b.trap, pen: b.pen, score: b.score, usedSw: b.usedSw, usedSp: b.usedSp, states: b.states, fc: b.fc, def: crop(b.def), genome: b.genome, secs: (Date.now() - t0) / 1000 };
    fs.writeFileSync(f, JSON.stringify(out));
    console.log('L' + n, 'T', b.T, 'len', b.len, 'score', b.score, 'pen', b.pen, 'trap', (b.trap || 0).toFixed(2), 'states', b.states, 'fc', b.fc, out.secs.toFixed(0) + 's');
    prev = b.genome;
  }
}
