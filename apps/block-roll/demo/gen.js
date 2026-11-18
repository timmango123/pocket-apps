// Offline level generator for 石碑翻滾 (block-roll). Core logic is read from the game file (CORE markers).
// node gen.js <outdir> <levels...>   (levels as numbers or ranges a-b); env SECS = time budget per level
const fs = require('fs'), path = require('path');
const SRC = process.env.CORE || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(SRC, 'utf8');
const core = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, doMove, solve, stateKey};')();

const { fastSolve } = require('./fast.js');
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function cfg(n) {
  // area stops growing at ~150 cells (L81+) so late boards stay readable on a phone; difficulty comes from traps and order
  // early boards are a little roomier than before (34 + 1.5n cells) so they can hold side branches, not one corridor
  const A = n < 40 ? Math.round(34 + 1.5 * n) : Math.min(150, Math.round(30 * Math.pow(1.02, n)));
  const side = Math.min(17, Math.ceil(Math.sqrt(A / 0.62)));
  const M = Math.round(8 * Math.pow(1.03, n)) + Math.floor(n / 10);
  const bridge = n >= 40 && n <= 42; // L40-42: the split pad is introduced on small boards with few other mechanisms
  // before one-way switches (L20) every move can be undone, so dead ends there are branches you must back out of
  // (counted by statesLo below), not unrecoverable traps
  const trapLo = n < 20 ? 0 : n <= 30 ? 0.10 + (n - 20) * 0.015 : 0.25 + (n - 30) * 0.005;
  return {
    n, A: bridge ? Math.round(A * 0.8) : A, W: side + (n % 2), H: side,
    M,
    sw: bridge ? (n === 42 ? 2 : 1) : n >= 8 ? Math.min(6, Math.floor((n - 8) / 12) + 1) : 0,
    frag: n >= 15 ? (0.15 * (n - 15) / 85 + 0.02) * (bridge ? 0.3 : 1) : 0,
    split: n >= 80 ? 2 : n >= 40 ? 1 : 0,
    portal: n >= 55 ? 1 : 0,
    ice: n >= 70 ? Math.round(A * 0.1) : 0,
    spring: n >= 85 ? 2 : 0,
    trapLo, trapHi: n < 20 ? 0.15 : trapLo + (n <= 30 ? 0.012 : 0.02) + (n >= 60 ? 0.02 : 0),
    trapMin: n >= 8 ? 1 : 0,
    // reachable-state floor for the early chapter (branches and dead ends instead of a single corridor), ceiling at L40-42
    statesLo: n >= 3 && n < 40 ? Math.round(Math.min(25 * Math.pow(1.1, n), 1.5 * (34 + 1.5 * n) * Math.pow(2, n >= 8 ? Math.min(6, Math.floor((n - 8) / 12) + 1) : 0)))
      : n >= 43 ? Math.round(1500 * Math.pow(1.06, n - 40)) : 0, // late levels: a smooth band of board sizes in moves, no
    statesHi: bridge ? [3500, 4500, 6000][n - 40] : n >= 43 ? Math.round(6000 * Math.pow(1.06, n - 40)) : 500000, // narrow 'easy' board between two wide ones
    sym: n >= 26 ? ['h', 'v', 'r'][n % 3] : null,
  };
}

// genome: arrays over cells
function G(c) { return { W: c.W, H: c.H, t: new Array(c.W * c.H).fill('.'), g: new Array(c.W * c.H).fill(-1), md: new Array(c.W * c.H).fill(0), sp: {}, pp: {}, m: 0, sym: c.sym || null }; }
function clone(x) { return { W: x.W, H: x.H, t: x.t.slice(), g: x.g.slice(), md: x.md.slice(), sp: JSON.parse(JSON.stringify(x.sp)), pp: Object.assign({}, x.pp), m: x.m, sym: x.sym }; }
function toDef(x) {
  const rows = [], sw = [], br = [], sp = [], pp = [];
  for (let y = 0; y < x.H; y++) {
    let r = '';
    for (let xx = 0; xx < x.W; xx++) {
      const c = y * x.W + xx, ch = x.t[c]; r += ch;
      if (ch === 'w' || ch === 'X') sw.push([x.g[c], x.md[c]]);
      else if (ch === 'B') br.push(x.g[c]);
      else if (ch === 'T') sp.push(x.sp[c]);
      else if (ch === 'P') pp.push(x.pp[c]);
    }
    rows.push(r);
  }
  const d = { r: rows.join('/'), sw, br, m: x.m, sp }; if (pp.length) d.pp = pp; return d;
}
// crop to bounding box of non-void cells (re-index split destinations)
function crop(def) {
  const rows = def.r.split('/'), H = rows.length, W = rows[0].length;
  let x0 = W, x1 = -1, y0 = H, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (rows[y][x] !== '.') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nw = x1 - x0 + 1, nr = [];
  for (let y = y0; y <= y1; y++) nr.push(rows[y].slice(x0, x1 + 1));
  const re = c => ((c / W | 0) - y0) * nw + (c % W - x0);
  const o = { r: nr.join('/'), sw: def.sw, br: def.br, m: def.m, sp: def.sp.map(p => [re(p[0]), re(p[1])]) };
  if (def.pp) o.pp = def.pp.map(re);
  return o;
}
const plain = ch => ch === 'o';
function cellsWhere(x, f) { const r = []; for (let i = 0; i < x.t.length; i++) if (f(x.t[i], i)) r.push(i); return r; }
function pick(a, rnd) { return a[Math.floor(rnd() * a.length)]; }
function nbrs(x, c) { const r = [], cx = c % x.W, cy = c / x.W | 0; if (cx > 0) r.push(c - 1); if (cx < x.W - 1) r.push(c + 1); if (cy > 0) r.push(c - x.W); if (cy < x.H - 1) r.push(c + x.W); return r; }

function mir(x, i) {
  if (!x.sym) return -1;
  const cx = i % x.W, cy = (i / x.W) | 0;
  return x.sym === 'h' ? cy * x.W + (x.W - 1 - cx) : x.sym === 'v' ? (x.H - 1 - cy) * x.W + cx : (x.H - 1 - cy) * x.W + (x.W - 1 - cx);
}
// new mechanisms (portal pair, ice patches, spring stones) on plain floor
function placeNew(x, c, rnd) {
  const fl = () => cellsWhere(x, plain);
  let have = cellsWhere(x, ch => ch === 'P').length / 2;
  for (; have < c.portal; have++) { const a = pick(fl(), rnd); x.t[a] = 'P'; let b = pick(fl(), rnd), k = 0; while ((b === a || adj(x, a, b)) && k++ < 50) b = pick(fl(), rnd); x.t[b] = 'P'; x.pp[a] = b; x.pp[b] = a; }
  let ice = cellsWhere(x, ch => ch === 'I').length;
  while (ice < c.ice) { // grow patches of 2-4 in a row
    const s0 = pick(fl(), rnd), d = rnd() < 0.5 ? 1 : x.W, len = 2 + Math.floor(rnd() * 3);
    for (let k = 0, q = s0; k < len && ice < c.ice; k++, q += d) { if (q >= x.t.length || (d === 1 && (q % x.W) < (s0 % x.W)) || x.t[q] !== 'o') break; x.t[q] = 'I'; ice++; }
  }
  let sp = cellsWhere(x, ch => ch === 'J').length;
  for (; sp < c.spring; sp++) x.t[pick(fl(), rnd)] = 'J';
}
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
  if (x.sym) { // mirror the floor so the board has a shape you can read (and remember)
    for (let i = 0; i < N; i++) if (x.t[i] === 'o') x.t[mir(x, i)] = 'o';
    let fc = x.t.filter(ch => ch !== '.').length;
    for (let k = 0; k < N * 4 && fc > c.A * 1.15; k++) { const i = Math.floor(rnd() * N), j = mir(x, i); if (x.t[i] === 'o' && x.t[j] === 'o') { x.t[i] = '.'; x.t[j] = '.'; fc -= i === j ? 1 : 2; } }
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
  placeNew(x, c, rnd);
  return x;
}
function adj(x, a, b) { return nbrs(x, a).includes(b); }

function mutate(x, c, rnd) {
  const y = clone(x), N = c.W * c.H, r = rnd();
  const fl = () => cellsWhere(y, plain);
  const destUsed = new Set(); for (const k in y.sp) { destUsed.add(y.sp[k][0]); destUsed.add(y.sp[k][1]); }
  const newMech = c.portal || c.ice || c.spring;
  if (r < 0.45 || (newMech && r >= 0.9 && rnd() < 0.5)) {
    if (newMech && r >= 0.9) { // move a portal end / an ice cell / a spring
      const kinds = [c.portal && 'P', c.ice && 'I', c.spring && 'J'].filter(Boolean), ch = pick(kinds, rnd);
      const cs = cellsWhere(y, q => q === ch), f = fl().filter(i => !destUsed.has(i));
      if (!cs.length || !f.length) return y;
      const a = pick(cs, rnd), t = pick(f, rnd);
      y.t[t] = ch; y.t[a] = 'o';
      if (ch === 'P') { const b = y.pp[a]; delete y.pp[a]; if (t === b || adj(y, t, b)) { y.t[t] = 'o'; y.t[a] = 'P'; y.pp[a] = b; return y; } y.pp[t] = b; y.pp[b] = t; }
      return y;
    }
    // toggle a void/floor cell next to the map (and its mirror image on symmetric boards)
    for (let k = 0; k < 20; k++) {
      const i = Math.floor(rnd() * N), j = mir(y, i);
      if (destUsed.has(i) || (j >= 0 && destUsed.has(j))) continue;
      if (y.t[i] === 'o' && (j < 0 || y.t[j] === 'o')) { y.t[i] = '.'; if (j >= 0) y.t[j] = '.'; break; }
      if (y.t[i] === '.' && (j < 0 || y.t[j] === '.') && nbrs(y, i).some(q => y.t[q] !== '.')) { y.t[i] = 'o'; if (j >= 0) y.t[j] = 'o'; break; }
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
  let S = core.initState(L), usedSw = 0, usedSp = 0, usedPt = 0, usedIce = 0, usedJ = 0;
  for (const mv of r.sol) { const q = core.doMove(L, S, mv); if (q.ev.fired.some(f => f.changed)) usedSw++; if (q.ev.split) usedSp++; if (q.ev.port != null) usedPt++; if (q.ev.slide) usedIce++; if (q.ev.jump != null) usedJ++; S = q.S; }
  let pen = 0;
  if (c.sw > 0 && usedSw === 0) pen += 6;
  // the newest mechanism must be on the shortest path; older ones only should be (they stay as traps and detours)
  const must = (lo) => c.n >= lo && c.n < lo + 3 ? 6 : 2;
  if (c.split > 0 && usedSp === 0) pen += must(40);
  if (c.portal > 0 && usedPt === 0) pen += must(55);
  if (c.ice > 0 && usedIce === 0) pen += must(70);
  if (c.spring > 0 && usedJ === 0) pen += must(85);
  if (c.statesLo && r.states < c.statesLo) pen += Math.ceil((c.statesLo - r.states) / c.statesLo * 10);
  if (r.states > c.statesHi && c.statesHi < 500000) pen += Math.min(10, Math.ceil((r.states - c.statesHi) / c.statesHi * 4));
  if (c.trapMin > 0) { if (r.trap < c.trapLo - 1e-9) pen += Math.ceil((c.trapLo - r.trap) * 100); else if (r.trap > c.trapHi + 1e-9) pen += Math.ceil((r.trap - c.trapHi) * 100); }
  const nfr = x.t.filter(ch => ch === 'c').length, frMax = Math.round(fc * c.frag * 1.15) + 1;
  if (c.frag > 0 && nfr > frMax) pen += nfr - frMax;
  if (fc < c.A * 0.8) pen += Math.ceil((c.A * 0.8 - fc) / 3);
  if (fc > c.A * 1.25) pen += Math.ceil((fc - c.A * 1.25) / 3);
  if (r.states > 500000) pen += Math.ceil((r.states - 500000) / 50000);
  const score = Math.abs(c.target - r.len) + pen;
  return { len: r.len, trap: r.trap || 0, score, pen, usedSw, usedSp, usedPt, usedIce, usedJ, states: r.states, fc, def, sol: r.sol };
}

// shortest solution: +1 a level to L40 (47), then slowly to 80 at L100 (longer stopped being harder, it got tedious)
function T(n) { return n < 40 ? 7 + n : 47 + Math.round((n - 40) * 33 / 60); }
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
  const c = cfg(n); c.target = T(n); c.limit = n >= 43 && !process.env.BIGLIM ? Math.min(1500000, Math.max(400000, c.statesHi * 3)) : 1500000; // a board far over the band is rejected early
  const t0 = Date.now(); let best = null, bestX = null;
  for (let attempt = 0; Date.now() - t0 < secs * 1000; attempt++) {
    const rnd = mulberry32((n * 2654435761 >>> 0) + attempt * 7919 + (+process.env.SEEDOFF || 0) * 104729);
    let x, cur, k = 0;
    do { x = self && attempt < 2 ? (self.pp ? clone(self) : embed(self, c, rnd)) : prev && attempt < 4 ? embed(prev, c, rnd) : initial(c, rnd); cur = evaluate(x, c); } while ((!cur || cur.len < 0) && k++ < 300);
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
  if (!best) return { score: 1e9, T: c.target, n };
  best.genome = bestX; best.T = c.target; best.n = n;
  return best;
}
module.exports = { T, embed, gen, cfg, crop, core, initial, mutate, toDef, evaluate, mulberry32 };
if (require.main === module) {
  // chain mode: node gen.js chain <j> <outdir> [secs]  -> levels j, j+4, ... each seeded from level n-4
  const [, , mode, j, outdir, secsArg] = process.argv;
  if (mode === 'embed') { // node gen.js embed <dir>: L1-L2 kept, L3-L100 from <dir>/L<n>.json; writes LEVELS (with each shortest solution s) into index.html
    const APP = path.join(__dirname, '..', 'index.html'), html = fs.readFileSync(APP, 'utf8');
    const m = html.match(/var LEVELS = \[\n([\s\S]*?)\n\];/), cur = JSON.parse('[' + m[1] + ']'), out = [];
    let prevD = 0;
    for (let n = 1; n <= 100; n++) {
      const def = n <= 2 ? cur[n - 1] : JSON.parse(fs.readFileSync(path.join(j, 'L' + n + '.json'), 'utf8')).def;
      const d0 = { r: def.r, sw: def.sw, br: def.br, m: def.m || 0, sp: def.sp }; if (def.pp && def.pp.length) d0.pp = def.pp;
      const L = core.parseLevel(d0), r = core.solve(L, null, { limit: 3000000, trap: true });
      if (!(r.len > 0)) throw new Error('L' + n + ' unsolvable');
      const k = [...L.kind], has = v => k.includes(v) ? 1 : 0;
      let d = r.len / 2 + (L.nSw ? 3 + 0.5 * (L.nSw - 1) : 0) + 3 * has(7) + 2 * has(8) + 2 * has(9) + 2 * has(10) + 15 * r.trap;
      d = Math.max(Math.round(d * 100) / 100, Math.round((prevD + 0.05) * 100) / 100); prevD = d;
      out.push(JSON.stringify(Object.assign(d0, { o: r.len, d, t: Math.round(r.trap * 1000) / 1000, s: r.sol.join('') })));
      console.log('L' + n, 'o', r.len, 'd', d, 'trap', r.trap.toFixed(3), 'states', r.states);
    }
    fs.writeFileSync(APP, html.replace(m[0], 'var LEVELS = [\n' + out.join(',\n') + '\n];'));
    return;
  }
  if (mode === 'redo2') { // node gen.js redo2 <dir> <secs> n...: rescore the saved level under the current rules, try fresh, keep the better
    const od = j, secs = +outdir;
    for (const n of process.argv.slice(5).map(Number)) {
      const f = path.join(od, 'L' + n + '.json'), old = JSON.parse(fs.readFileSync(f, 'utf8')), c = cfg(n); c.target = T(n); c.limit = 1500000;
      c.limit = process.env.BIGLIM ? 1500000 : Math.min(1500000, Math.max(400000, c.statesHi * 3));
      const oe = evaluate(old.genome, c) || { score: 1e9, states: 0 }, t0 = Date.now(), b = gen(n, secs, null, old.genome);
      if (b.score < oe.score) fs.writeFileSync(f, JSON.stringify({ n, T: b.T, len: b.len, trap: b.trap, pen: b.pen, score: b.score, usedSw: b.usedSw, usedSp: b.usedSp, usedPt: b.usedPt, usedIce: b.usedIce, usedJ: b.usedJ, states: b.states, fc: b.fc, def: crop(b.def), genome: b.genome, secs: (Date.now() - t0) / 1000 }));
      console.log('L' + n, 'old', oe.score, oe.states, 'new', b.score, b.states, 'len', b.len, 'trap', (b.trap || 0).toFixed(2), b.score < oe.score ? 'KEPT NEW' : 'kept old');
    }
    return;
  }
  if (mode === 'list') { // node gen.js list <outdir> <secs> n1 n2 ...: generate these levels independently
    const od = j, secs = +outdir; fs.mkdirSync(od, { recursive: true });
    for (const n of process.argv.slice(5).map(Number)) {
      const f = path.join(od, 'L' + n + '.json'); if (fs.existsSync(f)) continue;
      const t0 = Date.now(), b = gen(n, secs, null, null);
      const out = { n, T: b.T, len: b.len, trap: b.trap, pen: b.pen, score: b.score, usedSw: b.usedSw, usedSp: b.usedSp, usedPt: b.usedPt, usedIce: b.usedIce, usedJ: b.usedJ, states: b.states, fc: b.fc, def: crop(b.def), genome: b.genome, secs: (Date.now() - t0) / 1000 };
      fs.writeFileSync(f, JSON.stringify(out));
      console.log('L' + n, 'T', b.T, 'len', b.len, 'score', b.score, 'pen', b.pen, 'trap', (b.trap || 0).toFixed(2), 'states', b.states, 'fc', b.fc, 'pt/ice/j', b.usedPt, b.usedIce, b.usedJ, out.secs.toFixed(0) + 's');
    }
    return;
  }
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
