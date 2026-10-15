// Offline level generator for 鏡湖雙影 (mirror-walk). Core logic is read from ../index.html (or $CORE).
// Usage: node gen.js <outdir> <levels: comma list and/or a-b ranges> [bands.json {"L":[Dlo,Dhi]}]   env: BUDGET=ms per level, ATT0=first attempt seed
// Levels 11,85,94,95,99,100 were re-run with explicit D bands (11:[14.95,15.45] 85:[94.95,96.3] 94:[102.35,103.05] 95:[103.1,104.05] 99:[105.55,106.6] 100:[106.65,109]; ATT0=40, L94 ATT0=120)
// Deterministic: PRNG seeded with L*69069 (+attempt), DFS maze carving + holes, element placement,
// then hill-climb with full BFS (optimum, min 錯位 steps, trap ratio) toward the spec curves.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.env.CORE || path.join(__dirname, '..', 'index.html'), 'utf8');
const core = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {parseLevel, initState, step, analyze, diffScore, levelKinds, guardPos, T_DOOR, T_TELE, T_ICE};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Target difficulty curve (strictly increasing); each level's D must land in [Dt(L), Dt(L+1)) so D rises every level.
const DT = [[1, 10], [20, 19], [40, 33], [60, 60], [78, 90], [100, 107], [101, 107.8]];
function Dt(L) { for (let i = 1; i < DT.length; i++) if (L <= DT[i][0]) { const [a, da] = DT[i - 1], [b, db] = DT[i]; return da + (db - da) * (L - a) / (b - a); } return 108; }
function spec(L) {
  const size = L <= 12 ? [5, 5] : L <= 30 ? [6, 6] : L <= 55 ? [7, 7] : L <= 80 ? [8, 7] : [9, 8];
  return {
    w: size[0], h: size[1],
    M: Math.min(60, Math.round(6 * Math.pow(1.03, L))),
    E: Math.floor(1 + L / 8),
    trap: Math.min(0.75, 0.05 * Math.pow(1.035, L)),
    mode: L < 40 ? 0 : L < 75 ? (L % 2 === 0 ? 1 : 0) : 2,
    spikes: L >= 10 ? Math.min(4, 1 + Math.floor((L - 10) / 18)) : 0,
    doors: L >= 20 ? (L >= 70 ? 2 : 1) : 0,
    ice: L >= 35 ? Math.min(6, 2 + Math.floor((L - 35) / 15)) : 0,
    tele: L >= 50 ? (L >= 80 ? 2 : 1) : 0,
    guards: L >= 65 ? (L >= 90 ? 2 : 1) : 0,
    Dlo: Dt(L), Dhi: Dt(L + 1) - 0.04,
    frag: L >= 85 ? Math.min(3, 2 + Math.floor((L - 85) / 8)) : 0,
  };
}

// world grid: array of chars
function maze(w, h, rnd, density) {
  const g = new Array(w * h).fill('#');
  const rooms = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) rooms.push([x, y]);
  const seen = new Set(), stack = [rooms[Math.floor(rnd() * rooms.length)]];
  seen.add(stack[0].join()); g[stack[0][1] * w + stack[0][0]] = '.';
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < w && ny < h && !seen.has(nx + ',' + ny); });
    if (!opts.length) { stack.pop(); continue; }
    const [dx, dy] = opts[Math.floor(rnd() * opts.length)];
    const nx = x + dx, ny = y + dy;
    g[(y + dy / 2) * w + x + dx / 2] = '.'; g[ny * w + nx] = '.';
    seen.add(nx + ',' + ny); stack.push([nx, ny]);
  }
  // punch holes until density reached
  let walls = g.filter(c => c === '#').length, target = Math.round(w * h * density), guard = 0;
  while (walls > target && guard++ < 500) { const i = Math.floor(rnd() * g.length); if (g[i] === '#') { g[i] = '.'; walls--; } }
  return g;
}

function emptyCells(g, avoid) { const r = []; for (let i = 0; i < g.length; i++) if (g[i] === '.' && !(avoid && avoid.has(i))) r.push(i); return r; }
function pick(arr, rnd) { return arr.length ? arr[Math.floor(rnd() * arr.length)] : -1; }

function build(L, sp, rnd) {
  const W = [maze(sp.w, sp.h, rnd, 0.2 + rnd() * 0.15), maze(sp.w, sp.h, rnd, 0.2 + rnd() * 0.15)];
  const put = (wo, ch) => { const c = pick(emptyCells(W[wo]), rnd); if (c >= 0) W[wo][c] = ch; return c; };
  put(0, 'S'); put(1, 'S'); put(0, 'G'); put(1, 'G');
  for (let i = 0; i < sp.spikes; i++) put(i % 2 ? 0 : 1, '*');
  for (let i = 0; i < sp.doors; i++) { const bw = (i + L) % 2; put(bw, 'o'); put(1 - bw, 'D'); }
  for (let i = 0; i < sp.ice; i++) put(rnd() < 0.5 ? 0 : 1, '~');
  for (let i = 0; i < sp.tele; i++) put(i % 2 ? 0 : 1, 'T');
  for (let i = 0; i < sp.frag; i++) put(i % 2, 'x');
  const guards = [];
  for (let i = 0; i < sp.guards; i++) guards.push(makeGuard(W, sp, rnd, (i + L) % 2));
  return { W, guards };
}
function makeGuard(W, sp, rnd, wo) {
  const g = W[wo];
  for (let t = 0; t < 60; t++) {
    const c = pick(emptyCells(g), rnd); if (c < 0) break;
    const len = 2 + Math.floor(rnd() * 2); // 2..3 -> period 2,4
    const d = Math.floor(rnd() * 4), dx = [0, 1, 0, -1][d], dy = [-1, 0, 1, 0][d];
    const path = [c]; let x = c % sp.w, y = (c / sp.w) | 0;
    while (path.length < len) { x += dx; y += dy; if (x < 0 || y < 0 || x >= sp.w || y >= sp.h || g[y * sp.w + x] !== '.') break; path.push(y * sp.w + x); }
    if (path.length >= 2) return { wo, path };
  }
  return null;
}
function lcmOK(guards) {
  let P = 1; const gcd = (a, b) => b ? gcd(b, a % b) : a;
  for (const g of guards) { if (!g) return false; const per = 2 * (g.path.length - 1); P = P * per / gcd(P, per); }
  return P <= 12;
}
function entry(sp, B) {
  const rows = g => { const r = []; for (let y = 0; y < sp.h; y++) r.push(g.slice(y * sp.w, y * sp.w + sp.w).join('')); return r.join('/'); };
  const gs = B.guards.filter(Boolean).map(g => (g.wo ? 'B' : 'A') + ':' + g.path.join(',')).join(';');
  return [sp.mode, rows(B.W[0]), rows(B.W[1]), gs, 0, 0, 0];
}
function valid(sp, B) {
  for (const g of B.W) { if (g.indexOf('S') < 0 || g.indexOf('G') < 0) return false; }
  if (B.guards.some(g => !g) || !lcmOK(B.guards)) return false;
  // guards must stay on plain floor and not start on the player
  for (const g of B.guards) for (const c of g.path) if (B.W[g.wo][c] !== '.') return false;
  return true;
}
function usage(Lv, sol) {
  let S = core.initState(Lv); const u = { door: false, swap: false, slide: false };
  for (const d of sol) {
    const r = core.step(Lv, S, d);
    if (r.ev.pa.some(c => Lv.A.t[c] === core.T_DOOR) || r.ev.pb.some(c => Lv.B.t[c] === core.T_DOOR)) u.door = true;
    if (r.ev.swap) u.swap = true;
    if (r.ev.slid) u.slide = true;
    S = r.S;
  }
  return u;
}
function evaluate(sp, B, limit) {
  if (!valid(sp, B)) return null;
  const e = entry(sp, B), Lv = core.parseLevel(e);
  const r = core.analyze(Lv, null, limit, true);
  if (r.len < 0) return null;
  const u = usage(Lv, r.sol);
  const kinds = core.levelKinds(Lv);
  return { e, opt: r.len, E: r.E, trap: r.trap, states: r.states, sol: r.sol, u, kinds, D: core.diffScore(r.len, r.E, r.trap, kinds) };
}
function cost(sp, r) {
  if (!r) return 1e9;
  let c = 0;
  if (r.opt < sp.M) c += 4 * (sp.M - r.opt); else if (r.opt > sp.M + 2) c += 2 * (r.opt - sp.M - 2);
  if (r.E < sp.E) c += 3 * (sp.E - r.E);
  const tlo = sp.trap - 0.08, thi = sp.trap >= 0.75 ? 1 : sp.trap + 0.12;
  if (r.trap < tlo) c += 40 * (tlo - r.trap); else if (r.trap > thi) c += 25 * (r.trap - thi);
  if (sp.doors && !r.u.door) c += 6;
  if (sp.tele && !r.u.swap) c += 6;
  if (sp.ice && !r.u.slide) c += 4;
  if (r.D < sp.Dlo) c += 2 * (sp.Dlo - r.D) + 0.5; else if (r.D > sp.Dhi) c += 2 * (r.D - sp.Dhi) + 0.5;
  return c;
}
function mutate(sp, B, rnd) {
  const N = sp.w * sp.h;
  const nb = { W: [B.W[0].slice(), B.W[1].slice()], guards: B.guards.map(g => g && { wo: g.wo, path: g.path.slice() }) };
  const k = rnd();
  const wo = rnd() < 0.5 ? 0 : 1, g = nb.W[wo];
  if (k < 0.55) { // toggle a wall
    const i = Math.floor(rnd() * N);
    if (g[i] === '#') g[i] = '.'; else if (g[i] === '.') { if (!nb.guards.some(q => q && q.wo === wo && q.path.includes(i))) g[i] = '#'; }
  } else if (k < 0.85) { // move a special cell
    const specials = []; for (let i = 0; i < N; i++) if (g[i] !== '.' && g[i] !== '#') specials.push(i);
    const a = pick(specials, rnd), b = pick(emptyCells(g), rnd);
    if (a >= 0 && b >= 0 && !nb.guards.some(q => q && q.wo === wo && q.path.includes(b))) { g[b] = g[a]; g[a] = '.'; }
  } else if (k < 0.93 && nb.guards.length) { // re-route a guard
    const gi = Math.floor(rnd() * nb.guards.length); const q = makeGuard(nb.W, sp, rnd, nb.guards[gi].wo); if (q) nb.guards[gi] = q;
  } else { // swap wall and floor positions
    const a = Math.floor(rnd() * N), b = Math.floor(rnd() * N);
    if ((g[a] === '#') !== (g[b] === '#') && (g[a] === '#' || g[a] === '.') && (g[b] === '#' || g[b] === '.')) {
      if (!nb.guards.some(q => q && q.wo === wo && (q.path.includes(a) || q.path.includes(b)))) { const t = g[a]; g[a] = g[b]; g[b] = t; }
    }
  }
  return nb;
}
function gen(L, band, budget) {
  const sp = spec(L);
  if (band) { sp.Dlo = band[0]; sp.Dhi = band[1]; }
  const limit = 600000;
  let bestAll = null, bestCost = 1e9;
  const t0 = Date.now();
  const a0 = +process.env.ATT0 || 0;
  for (let attempt = a0; attempt < a0 + 40; attempt++) {
    const rnd = mulberry32(L * 69069 + attempt * 7919);
    let B = build(L, sp, rnd), r = evaluate(sp, B, limit), tries = 0;
    while (!r && tries++ < 300) { B = build(L, sp, rnd); r = evaluate(sp, B, limit); }
    if (!r) continue;
    let c = cost(sp, r);
    const iters = 800 + L * 15;
    let stale = 0;
    for (let it = 0; it < iters && c > 0; it++) {
      const nb = mutate(sp, B, rnd), nr = evaluate(sp, nb, limit), nc = cost(sp, nr);
      if (nc <= c) { if (nc < c) stale = 0; B = nb; r = nr; c = nc; } else stale++;
      if (stale > 250) break;
      if (budget && Date.now() - t0 > budget) break;
    }
    if (c < bestCost) { bestCost = c; bestAll = { L, attempt, r, sp }; }
    if (c === 0) break;
    if (budget && Date.now() - t0 > budget) break;
  }
  return bestAll && Object.assign({ cost: bestCost }, bestAll);
}
if (require.main === module) {
  const out = process.argv[2];
  const spec2 = process.argv[3];
  let levels = [];
  for (const part of spec2.split(',')) { const m = part.split('-').map(Number); if (m.length === 2) for (let i = m[0]; i <= m[1]; i++) levels.push(i); else levels.push(m[0]); }
  const minDs = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : {};
  const budget = +process.env.BUDGET || 0;
  fs.mkdirSync(out, { recursive: true });
  for (const L of levels) {
    const t0 = Date.now();
    const g = gen(L, minDs[L], budget);
    if (!g) { console.log('FAIL', L); continue; }
    const r = g.r; r.e[4] = r.opt; r.e[5] = r.E; r.e[6] = Math.round(r.trap * 100);
    fs.writeFileSync(path.join(out, 'L' + L + '.json'), JSON.stringify({ L, e: r.e, opt: r.opt, E: r.E, trap: r.trap, D: r.D, kinds: r.kinds, states: r.states, sol: r.sol.join(''), cost: g.cost, attempt: g.attempt, M: g.sp.M, En: g.sp.E, Tt: g.sp.trap, u: r.u }));
    console.log(L, 'opt', r.opt, '/', g.sp.M, 'E', r.E, '/', g.sp.E, 'trap', r.trap.toFixed(2), '/', g.sp.trap.toFixed(2), 'D', r.D.toFixed(1), 'cost', g.cost.toFixed(2), 'band', g.sp.Dlo.toFixed(1) + '-' + g.sp.Dhi.toFixed(1), 'states', r.states, 'att', g.attempt, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
module.exports = { spec, gen, core };
