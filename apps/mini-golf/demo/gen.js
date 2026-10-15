// 果嶺彈珠 level generator: modular cells + seed (hole*7919), solved with the game's own core.
// node gen.js <out.json> [fromLevel] [toLevel]
const fs = require('fs'), path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const CORE = process.env.CORE || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(CORE, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {buildLevel,initState,simShot,solveLevel,replay,makeHeur,distField,fieldAt,isSolidAt,cloneState};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R4 = v => Math.round(v / 4) * 4, R2 = v => Math.round(v / 2) * 2;
const CX = c => 48 + 88 * c, CY = r => 56 + 88 * r;
const DIRV = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
const OPP = { u: 'd', d: 'u', l: 'r', r: 'l' };
const MECHS = [['slope', 6], ['sand', 11], ['water', 16], ['mill', 21], ['portal', 28], ['ice', 36], ['mover', 45], ['gate', 55], ['door', 65], ['ramp', 75], ['mhole', 85]];

function sched(n) {
  return {
    w: Math.max(28, R4(Math.max(26, 70 * Math.pow(0.985, n - 1)))),
    r: Math.max(7, 12 * Math.pow(0.995, n - 1)),
    v: Math.min(110, 40 * Math.pow(1.03, n - 1)),
    dens: Math.min(0.65, 0.15 * Math.pow(1.035, n - 1)),
    k0: Math.min(8, 6 + Math.floor(Math.max(0, n - 11) / 30)),
    c0: n < 6 ? 0 : n < 28 ? 1 : n < 50 ? 2 : n < 72 ? 3 : n < 95 ? 4 : 6,
  };
}
function dirBetween(a, b) { return b[0] > a[0] ? 'r' : b[0] < a[0] ? 'l' : b[1] > a[1] ? 'd' : 'u'; }

// plan: {cells:[[c,r]..], w (number), wl:{i:w}, rooms:{i:1}, cut:{i:1} (no band between i and i+1), alc:{cell:[c,r], from:i}, mech:[...], obst:[...] }
function buildFromPlan(n, plan, rnd) {
  const s = sched(n), cells = plan.cells, k = cells.length;
  const wl = cells.map((_, i) => (plan.wl && plan.wl[i]) || plan.w || s.w);
  const conn = cells.map(() => ({}));
  for (let i = 0; i + 1 < k; i++) { if (plan.cut && plan.cut[i]) continue; const d = dirBetween(cells[i], cells[i + 1]); conn[i][d] = 1; conn[i + 1][OPP[d]] = 1; }
  const f = [];
  for (let i = 0; i < k; i++) {
    const cx = CX(cells[i][0]), cy = CY(cells[i][1]), w0 = wl[i];
    if (plan.rooms && plan.rooms[i]) f.push([cx - 38, cy - 38, 76, 76]); else f.push([cx - w0 / 2, cy - w0 / 2, w0, w0]);
  }
  for (let i = 0; i + 1 < k; i++) {
    if (plan.cut && plan.cut[i]) continue;
    const w = Math.min(wl[i], wl[i + 1]), h = w / 2;
    const ax = CX(cells[i][0]), ay = CY(cells[i][1]), bx = CX(cells[i + 1][0]), by = CY(cells[i + 1][1]);
    if (ax === bx) f.push([ax - h, Math.min(ay, by), w, 88]); else f.push([Math.min(ax, bx), ay - h, 88, w]);
  }
  if (plan.alc) { // switch alcove
    const a = plan.alc, from = cells[a.from], d = dirBetween(from, a.cell), w = Math.min(wl[a.from], s.w + 4), h = w / 2, cx = CX(from[0]), cy = CY(from[1]);
    const ax = CX(a.cell[0]), ay = CY(a.cell[1]);
    if (d === 'u') f.push([cx - h, cy - 88, w, 88]); if (d === 'd') f.push([cx - h, cy, w, 88]);
    if (d === 'l') f.push([cx - 88, cy - h, 88, w]); if (d === 'r') f.push([cx, cy - h, 88, w]);
    f.push([ax - h - 4, ay - h - 4, w + 8, w + 8]);
  }
  const t0 = cells[0], tl = cells[k - 1];
  const d = { n, f, tee: [CX(t0[0]), CY(t0[1])], hole: [CX(tl[0]), CY(tl[1]), +s.r.toFixed(2)], z: [], b: [], q: [], w: [], m: [], p: [], g: [], o: [], s: [], mk: [] };
  if (plan.teeOff) { d.tee[0] += plan.teeOff[0]; d.tee[1] += plan.teeOff[1]; }
  if (plan.holeOff) { d.hole[0] += plan.holeOff[0]; d.hole[1] += plan.holeOff[1]; }
  const info = cells.map((cell, i) => ({ i, c: cell[0], r: cell[1], cx: CX(cell[0]), cy: CY(cell[1]), w: wl[i], inD: i > 0 ? dirBetween(cells[i - 1], cell) : null, outD: i < k - 1 ? dirBetween(cell, cells[i + 1]) : null }));
  let periodSec = 0;
  for (const m of plan.mech || []) {
    const ci = info[m.i];
    const u = ci.outD || ci.inD, U = DIRV[u], axisV = (u === 'u' || u === 'd');
    if (!d.mk.includes(m.t)) d.mk.push(m.t);
    if (m.t === 'slope') { const a = m.a || (60 + 120 * Math.min(1, Math.max(0, n - 6) / 90)); const V = DIRV[m.dir]; d.z.push([4, ci.cx - 44, ci.cy - 44, 88, 88, R2(V[0] * a), R2(V[1] * a)]); }
    else if (m.t === 'ice') { d.z.push([2, ci.cx - 44, ci.cy - 44, 88, 88]); if (m.two && info[m.i + 1]) { const c2 = info[m.i + 1]; d.z.push([2, c2.cx - 44, c2.cy - 44, 88, 88]); } }
    else if (m.t === 'sand') { const sw = m.sw || 40, sh = m.sh || 32, ox = m.ox || 0, oy = m.oy || 0; d.z.push([1, ci.cx - sw / 2 + ox, ci.cy - sh / 2 + oy, sw, sh]); }
    else if (m.t === 'water') {
      const w = ci.w, side = m.side || 1, len = m.len || 40;
      if (plan.rooms && plan.rooms[m.i]) d.z.push([3, ci.cx - 14 + (m.ox || 0), ci.cy - 14 + (m.oy || 0), 28, 28]);
      else if (axisV) { const pw = w - 18; d.z.push([3, side > 0 ? ci.cx - w / 2 : ci.cx + w / 2 - pw, ci.cy - len / 2 + (m.oy || 0), pw, len]); }
      else { const ph = w - 18; d.z.push([3, ci.cx - len / 2 + (m.ox || 0), side > 0 ? ci.cy - w / 2 : ci.cy + w / 2 - ph, len, ph]); }
    }
    else if (m.t === 'mill') { const len = ci.w / 2 - 3; d.w.push([ci.cx, ci.cy, len, +(m.ph || 0).toFixed(3), m.dir || 1]); periodSec = periodSec || Math.min(3, Math.max(1.1, len * Math.PI / s.v)); }
    else if (m.t === 'mover') {
      const w = ci.w, hw = R2(w * 0.3);
      const amp = w / 2;
      d.m.push(axisV ? [ci.cx, ci.cy + (m.off || 0), hw, 5, amp, 0, +(m.ph || 0).toFixed(3)] : [ci.cx + (m.off || 0), ci.cy, 5, hw, 0, amp, +(m.ph || 0).toFixed(3)]);
      periodSec = periodSec || Math.min(3, Math.max(1.3, 2 * Math.PI * amp / s.v));
    }
    else if (m.t === 'gate') { const h = ci.w / 2 + 1; d.g.push(axisV ? [ci.cx - h, ci.cy, ci.cx + h, ci.cy, 0, U[1]] : [ci.cx, ci.cy - h, ci.cx, ci.cy + h, U[0], 0]); }
    else if (m.t === 'door') { const h = ci.w / 2 + 1; d.o.push(axisV ? [ci.cx - h, ci.cy, ci.cx + h, ci.cy] : [ci.cx, ci.cy - h, ci.cx, ci.cy + h]); d.s.push([CX(plan.alc.cell[0]), CY(plan.alc.cell[1])]); }
    else if (m.t === 'ramp') {
      const a = m.a || 170, z1 = 30, z2 = 28;
      if (axisV) { const y0 = ci.cy - 44, s1 = U[1]; // u: travel direction
        d.z.push([5, ci.cx - 44, y0, 88, z1, 0, s1 > 0 ? -a : a]);
        d.z.push([6, ci.cx - 44, y0 + z1, 88, z2, 0, 0]);
        d.z.push([5, ci.cx - 44, y0 + z1 + z2, 88, 88 - z1 - z2, 0, s1 > 0 ? a : -a]);
      } else { const x0 = ci.cx - 44, s1 = U[0];
        d.z.push([5, x0, ci.cy - 44, z1, 88, s1 > 0 ? -a : a, 0]);
        d.z.push([6, x0 + z1, ci.cy - 44, z2, 88, 0, 0]);
        d.z.push([5, x0 + z1 + z2, ci.cy - 44, 88 - z1 - z2, 88, s1 > 0 ? a : -a, 0]);
      }
    }
    else if (m.t === 'portal') { const a = info[m.i], b = info[m.i + 1], ed = DIRV[b.outD]; d.p.push([a.cx, a.cy, b.cx, b.cy, ed[0], ed[1]]); }
    else if (m.t === 'mhole') { const hc = info[k - 1], ax = (hc.inD === 'u' || hc.inD === 'd'); const amp = Math.max(4, hc.w / 2 - s.r - 3); d.hole[0] = hc.cx; d.hole[1] = hc.cy; d.hm = ax ? [R2(amp), 0, +(m.ph || 0).toFixed(3)] : [0, R2(amp), +(m.ph || 0).toFixed(3)]; periodSec = periodSec || Math.min(4, Math.max(2, 2 * Math.PI * amp * 1.5 / s.v)); }
  }
  if (d.w.length || d.m.length || d.hm) d.P = Math.round(periodSec * 120);
  for (const ob of plan.obst || []) { if (ob.length === 3) d.b.push(ob); else d.q.push(ob); }
  // ramp zones type 6 (plateau) are visual only: physics treats unknown types as no-op slope with zero accel
  return d;
}
function emptyKeys(d) { for (const k of ['z', 'b', 'q', 'w', 'm', 'p', 'g', 'o', 's', 'mk']) if (d[k] && !d[k].length) delete d[k]; return d; }

function connected(d) {
  const L = C.buildLevel(d);
  const fo = C.distField(L, true, d.hole[0], d.hole[1]);
  if (C.fieldAt(fo, d.tee[0], d.tee[1]) >= 1e8) return false;
  if (d.s && d.s.length) {
    const fs2 = C.distField(L, false, d.s[0][0], d.s[0][1]);
    if (C.fieldAt(fs2, d.tee[0], d.tee[1]) >= 1e8) return false;
    // door must actually block: hole unreachable with door closed
    const fc = C.distField(L, false, d.hole[0], d.hole[1]);
    if (C.fieldAt(fc, d.tee[0], d.tee[1]) < 1e8) return false;
  }
  return true;
}
function insideFloor(L, x0, y0, x1, y1) { for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) if (C.isSolidAt(L, x, y)) return false; return true; }

// ---------- random plan ----------
function randomPath(k, rnd) {
  for (let tries = 0; tries < 400; tries++) {
    const start = [Math.floor(rnd() * 4), 6 - Math.floor(rnd() * 2)];
    const cells = [start], used = { [start + '']: 1 };
    let dir = 'u', ok = true;
    for (let i = 1; i < k; i++) {
      const opts = [];
      for (const d of ['u', 'd', 'l', 'r']) {
        if (i > 1 && d === OPP[dir]) continue;
        const c = cells[i - 1], nc = [c[0] + DIRV[d][0], c[1] + DIRV[d][1]];
        if (nc[0] < 0 || nc[0] > 3 || nc[1] < 0 || nc[1] > 6 || used[nc + '']) continue;
        let wgt = d === dir ? 2.2 : 1; if (d === 'u') wgt *= 1.6; if (d === 'd') wgt *= 0.5;
        opts.push([d, nc, wgt]);
      }
      if (!opts.length) { ok = false; break; }
      let tot = opts.reduce((a, o) => a + o[2], 0), x = rnd() * tot, pick = opts[0];
      for (const o of opts) { x -= o[2]; if (x <= 0) { pick = o; break; } }
      dir = pick[0]; cells.push(pick[1]); used[pick[1] + ''] = 1;
    }
    if (ok) return cells;
  }
  return null;
}
function pickMechs(n, c, rnd) {
  const unl = MECHS.filter(m => m[1] <= n).map(m => m[0]);
  const out = [];
  const newest = MECHS.filter(m => m[1] <= n && n - m[1] < 4).map(m => m[0]);
  for (const m of newest) if (out.length < c) out.push(m);
  const pool = unl.filter(m => !out.includes(m));
  while (out.length < c && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
function randomPlan(n, k, c, nb, rnd) {
  const s = sched(n);
  const cells = randomPath(k, rnd); if (!cells) return null;
  const plan = { cells, w: s.w, wl: {}, rooms: {}, cut: {}, mech: [], obst: [] };
  const info = cells.map((cell, i) => ({ i, inD: i > 0 ? dirBetween(cells[i - 1], cell) : null, outD: i < k - 1 ? dirBetween(cell, cells[i + 1]) : null }));
  const straight = i => i > 0 && i < k - 1 && info[i].inD === info[i].outD;
  const usedCell = {};
  const free = (pred) => { const c2 = []; for (let i = 1; i < k - 1; i++) if (!usedCell[i] && (!pred || pred(i))) c2.push(i); return c2.length ? c2[Math.floor(rnd() * c2.length)] : -1; };
  for (let i = 1; i < k - 1; i++) if (rnd() < 0.18 && !straight(i)) plan.rooms[i] = 1;
  const mechs = pickMechs(n, c, rnd);
  for (const mt of mechs) {
    let i;
    if (mt === 'slope') { i = free(); if (i < 0) return null; const dirs = ['u', 'd', 'l', 'r']; plan.mech.push({ t: mt, i, dir: dirs[Math.floor(rnd() * 4)] }); }
    else if (mt === 'sand') { i = free(); if (i < 0) i = 0; plan.mech.push({ t: mt, i, sw: 28 + 4 * Math.floor(rnd() * 5), sh: 24 + 4 * Math.floor(rnd() * 4), ox: R2((rnd() - 0.5) * 24), oy: R2((rnd() - 0.5) * 24) }); }
    else if (mt === 'water') { i = free(i => straight(i) || plan.rooms[i]); if (i < 0) return null; if (!plan.rooms[i]) plan.wl[i] = Math.max(s.w, 44); plan.mech.push({ t: mt, i, side: rnd() < 0.5 ? 1 : -1, len: 32 + 4 * Math.floor(rnd() * 5), ox: R2((rnd() - .5) * 20), oy: R2((rnd() - .5) * 20) }); }
    else if (mt === 'mill') { i = free(straight); if (i < 0) return null; plan.wl[i] = Math.max(s.w, 48); plan.mech.push({ t: mt, i, ph: rnd() * 3, dir: rnd() < 0.5 ? 1 : -1 }); }
    else if (mt === 'mover') { i = free(straight); if (i < 0) return null; plan.wl[i] = Math.max(s.w, 44); plan.mech.push({ t: mt, i, ph: rnd() * 6.28 }); }
    else if (mt === 'gate') { i = free(straight); if (i < 0) return null; plan.mech.push({ t: mt, i }); }
    else if (mt === 'ramp') { i = free(straight); if (i < 0) return null; plan.mech.push({ t: mt, i, a: Math.round(150 + 60 * Math.min(1, Math.max(0, n - 75) / 25)) }); }
    else if (mt === 'ice') { i = free(); if (i < 0) return null; plan.mech.push({ t: mt, i }); }
    else if (mt === 'mhole') { plan.wl[k - 1] = Math.max(s.w, 48); plan.mech.push({ t: mt, i: k - 1, ph: rnd() * 6.28 }); i = k - 1; }
    else if (mt === 'portal') {
      const cands = []; for (let j = 1; j + 1 < k - 1; j++) if (!usedCell[j] && !usedCell[j + 1] && !plan.rooms[j] && !plan.rooms[j + 1]) cands.push(j);
      if (!cands.length) return null; i = cands[Math.floor(rnd() * cands.length)];
      plan.cut[i] = 1; usedCell[i + 1] = 1; plan.mech.push({ t: mt, i });
    }
    else if (mt === 'door') {
      const occ = {}; cells.forEach(c2 => occ[c2 + ''] = 1);
      const opts = [];
      for (let j = 2; j < k - 1; j++) if (straight(j) && !usedCell[j]) for (let a = 0; a < j; a++) for (const d of ['u', 'd', 'l', 'r']) {
        const cc = [cells[a][0] + DIRV[d][0], cells[a][1] + DIRV[d][1]];
        if (cc[0] < 0 || cc[0] > 3 || cc[1] < 0 || cc[1] > 6 || occ[cc + '']) continue;
        opts.push([j, a, cc]);
      }
      if (!opts.length) return null;
      const o = opts[Math.floor(rnd() * opts.length)]; i = o[0];
      plan.alc = { cell: o[2], from: o[1] }; plan.mech.push({ t: mt, i });
    }
    usedCell[i] = 1;
  }
  plan.mech.sort((a, b) => (a.t === 'portal' ? -1 : 0) - (b.t === 'portal' ? -1 : 0));
  plan.nb = nb;
  return plan;
}
function placeObstacles(d, nb, rnd, n) {
  let placed = 0, tries = 0;
  const pts = [d.tee, d.hole].concat(d.p ? d.p.map(p => [p[0], p[1]]).concat(d.p.map(p => [p[2], p[3]])) : []).concat(d.s || []).concat((d.w || []).map(w => [w[0], w[1]])).concat((d.m || []).map(m => [m[0], m[1]]));
  while (placed < nb && tries++ < 400) {
    const L = C.buildLevel(d);
    const fr = d.f[Math.floor(rnd() * d.f.length)];
    const x = R2(fr[0] + rnd() * fr[2]), y = R2(fr[1] + rnd() * fr[3]);
    if (pts.some(p => Math.hypot(p[0] - x, p[1] - y) < 26)) continue;
    if ((d.z || []).some(z => z[0] >= 3 && x > z[1] - 12 && x < z[1] + z[3] + 12 && y > z[2] - 12 && y < z[2] + z[4] + 12)) continue;
    if ((d.g || []).concat(d.o || []).some(g => Math.hypot((g[0] + g[2]) / 2 - x, (g[1] + g[3]) / 2 - y) < 30)) continue;
    let ob;
    if (rnd() < 0.6) { const r = 5 + Math.floor(rnd() * 4); if (!insideFloor(L, x - r - 2, y - r - 2, x + r + 2, y + r + 2)) continue; ob = [x, y, r]; d.b.push(ob); }
    else { const w = 8 + 2 * Math.floor(rnd() * 4), h = 8 + 2 * Math.floor(rnd() * 4); if (!insideFloor(L, x - w / 2 - 2, y - h / 2 - 2, x + w / 2 + 2, y + h / 2 + 2)) continue; ob = [x - w / 2, y - h / 2, w, h]; d.q.push(ob); }
    if (!connected(d)) { if (ob.length === 3) d.b.pop(); else d.q.pop(); continue; }
    pts.push([x, y]); placed++;
  }
  return placed === nb;
}

function numOf(d) { return 8 * d.k + 12 * d.nb + 15 * (d.mk ? d.mk.length : 0) + 7 * d.par; }
function solveD(d, quick) {
  const L = C.buildLevel(d);
  const o = L.dyn ? { angStep: 4, pows: [0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.85, 1], beam: 8, phases: 6, refine: 10 } : { angStep: 3, beam: 10, refine: 12 };
  o.maxDepth = 5;
  const r = C.solveLevel(L, o);
  if (!r) return null;
  const rp = C.replay(L, r.shots);
  if (!rp.holed || rp.strokes !== r.strokes) return null;
  return r;
}
function finish(d, sol, k, nb) {
  d.k = k; d.nb = nb; d.best = sol.strokes; d.par = sol.strokes + 1;
  d.sol = sol.shots;
  d.num = numOf(d); d.D = +(d.num / 3).toFixed(1);
  return emptyKeys(d);
}
// one candidate attempt for level n with chosen parameters
function attempt(n, k, c, nb, seed) {
  const rnd = mulberry32(seed);
  for (let t = 0; t < 30; t++) {
    const plan = randomPlan(n, k, c, nb, rnd); if (!plan) continue;
    const d = buildFromPlan(n, plan, rnd);
    if (!connected(d)) continue;
    if (!placeObstacles(d, nb, rnd, n)) continue;
    const sol = solveD(d);
    if (!sol) continue;
    return finish(d, sol, k, nb);
  }
  return null;
}

// ---------- hand-made tutorial holes 1-10 ----------
const HAND = [
  { cells: [[1, 6], [1, 5], [1, 4]], w: 72, holeOff: [0, -10] },
  { cells: [[2, 6], [2, 5], [2, 4], [2, 3]], w: 68 },
  { cells: [[0, 6], [0, 5], [0, 4], [1, 4], [2, 4]], w: 64 },
  { cells: [[3, 6], [3, 5], [2, 5], [2, 4]], w: 64, obst: [[214, 452, 6]] },
  { cells: [[3, 6], [3, 5], [2, 5], [2, 4], [2, 3]], w: 64, obst: [[230, 452, 7]] },
  { cells: [[1, 6], [1, 5], [1, 4], [1, 3], [2, 3]], w: 60, mech: [{ t: 'slope', i: 2, dir: 'l', a: 70 }] },
  { cells: [[3, 6], [3, 5], [2, 5], [2, 4], [2, 3], [1, 3]], w: 60, mech: [{ t: 'slope', i: 3, dir: 'r', a: 90 }] },
  { cells: [[0, 6], [0, 5], [1, 5], [1, 4], [1, 3], [2, 3]], w: 56, rooms: { 3: 1 }, mech: [{ t: 'slope', i: 3, dir: 'u', a: 100 }], obst: [[150, 324, 7]] },
  { cells: [[2, 6], [2, 5], [2, 4], [1, 4], [1, 3], [1, 2], [2, 2]], w: 56, mech: [{ t: 'slope', i: 1, dir: 'l', a: 110 }], obst: [[226, 400, 7]] },
  { cells: [[3, 6], [2, 6], [2, 5], [2, 4], [3, 4], [3, 3]], w: 56, mech: [{ t: 'slope', i: 3, dir: 'd', a: 120 }], obst: [[268, 584, 7], [214, 470, 8, 8]] },
];
function handLevel(n) {
  const plan = Object.assign({}, HAND[n - 1]);
  const d = buildFromPlan(n, plan, mulberry32(n * 7919));
  if (!connected(d)) throw new Error('hand level ' + n + ' disconnected');
  const sol = solveD(d);
  if (!sol) throw new Error('hand level ' + n + ' unsolved');
  return finish(d, sol, plan.cells.length, (plan.obst || []).length);
}

// ---------- driver ----------
if (!isMainThread) {
  const w = workerData;
  let res;
  try { res = w.hand ? handLevel(w.n) : attempt(w.n, w.k, w.c, w.nb, w.seed); } catch (e) { res = { err: String(e.stack) }; }
  parentPort.postMessage(res);
} else {
  const out = process.argv[2] || path.join(__dirname, 'levels.json');
  const from = +(process.argv[3] || 1), to = +(process.argv[4] || 100);
  let levels = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : [];
  const run = (wd) => new Promise(res => { const wk = new Worker(__filename, { workerData: wd }); wk.on('message', m => { res(m); wk.terminate(); }); wk.on('error', e => res({ err: String(e) })); });
  (async () => {
    const t0 = Date.now();
    for (let n = from; n <= to; n++) {
      const prevNum = n > 1 && levels[n - 2] ? levels[n - 2].num : 0;
      let lv = null;
      if (n <= 10) { lv = await run({ hand: 1, n }); if (lv.err) { console.log(lv.err); process.exit(1); } if (lv.num <= prevNum) console.log('WARN hand level', n, 'num', lv.num, '<= prev', prevNum); }
      else {
        const s = sched(n);
        const pool = [];
        let round = 0;
        const pW = [[2, 1], [3, 2], [4, 1.5], [5, 0.6], [6, 0.2]];
        while (!lv && round < 14) {
          const lim = round < 4 ? 3 : round < 7 ? 6 : 12;
          // enumerate parameter combos whose expected metric lands just above the previous hole
          const combos = [];
          for (let k = 4; k <= 8; k++) for (let nb = 0; nb <= k * 2; nb++) for (const [p, wgt] of pW) {
            const num = 8 * k + 12 * nb + 15 * s.c0 + 7 * p;
            if (num > prevNum && num <= prevNum + lim) combos.push([k, nb, wgt * (1 - Math.abs(k - s.k0) * 0.25)]);
          }
          const jobs = [], rnd = mulberry32(n * 7919 + round);
          for (let j = 0; j < 4 && combos.length; j++) {
            let tot = combos.reduce((a, c) => a + Math.max(0.05, c[2]), 0), x = rnd() * tot, pick = combos[0];
            for (const c of combos) { x -= Math.max(0.05, c[2]); if (x <= 0) { pick = c; break; } }
            jobs.push(run({ n, k: pick[0], c: s.c0, nb: pick[1], seed: n * 7919 + round * 104729 + j * 15485863 }));
          }
          const rs = (await Promise.all(jobs)).filter(r => r && !r.err);
          pool.push(...rs);
          console.log('   round', round, 'prev', prevNum, 'got', rs.map(r => r.num + '(k' + r.k + ' b' + r.nb + ' p' + r.par + ')').join(' '));
          const ok = pool.filter(r => r.num > prevNum && r.num <= prevNum + lim);
          if (ok.length && round >= 1) { ok.sort((a, b) => a.num - b.num); lv = ok[0]; break; }
          round++;
        }
        const best = pool.filter(r => r.num > prevNum).sort((a, b) => a.num - b.num)[0];
        if (!lv && best) lv = best;
        if (!lv) { console.log('FAILED level', n); process.exit(1); }
      }
      levels[n - 1] = lv;
      fs.writeFileSync(out, JSON.stringify(levels));
      console.log('L' + n, 'k', lv.k, 'nb', lv.nb, 'mk', (lv.mk || []).join(','), 'best', lv.best, 'par', lv.par, 'num', lv.num, 'D', lv.D, ((Date.now() - t0) / 1000).toFixed(0) + 's');
    }
  })();
}
