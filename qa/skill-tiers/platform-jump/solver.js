// A* solver over held-input macro steps. Works on the pure core (PJ).
// solveSegment(PJ, L, s, prevHeld, goalFn, opts) -> { inputs:[codes per tick], state, held } | null
// code = (h+1)*2 + (j?1:0)
function Heap() { this.a = []; }
Heap.prototype.push = function (p, v) { var a = this.a; a.push([p, v]); var i = a.length - 1; while (i > 0) { var j = (i - 1) >> 1; if (a[j][0] <= a[i][0]) break; var t = a[i]; a[i] = a[j]; a[j] = t; i = j; } };
Heap.prototype.pop = function () { var a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; var i = 0; for (;;) { var l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; var t = a[i]; a[i] = a[m]; a[m] = t; i = m; } } return top; };
Object.defineProperty(Heap.prototype, 'size', { get: function () { return this.a.length; } });

const ACTS = [];
for (const h of [1, 0, -1]) for (const j of [0, 1]) ACTS.push({ h, j, code: (h + 1) * 2 + j });

function keyOf(s, held, per) {
  const xi = Math.round(s.x * 6) + 64, yi = Math.round(s.y * 6) + 64, vx = Math.round(s.vx) + 16, vy = Math.round(s.vy / 3) + 8;
  const fl = (s.ground ? 1 : 0) | (held ? 2 : 0) | (s.cut ? 4 : 0) | ((s.wall + 1) << 3);
  let k = ((((xi * 256 + yi) * 32 + vx) * 16 + vy) * 32 + fl);
  if (per > 1) k = k * 256 + Math.floor((s.t % per) / 4);
  if (s.cr.length) { let c = ''; for (let i = 0; i < s.cr.length; i++) if (s.cr[i]) c += i + ':' + (s.cr[i] > 0 ? Math.ceil(s.cr[i] / 6) : 'x'); if (c) return k + '|' + c; }
  return k;
}

function solveSegment(PJ, L, s0, held0, goal, opts) {
  opts = opts || {};
  const cutPen = opts.cutPen != null ? opts.cutPen : 0, chgPen = opts.chgPen || 0, human = !!opts.human, MS = opts.macro || 3, cap = opts.cap || 250000, W = opts.weight || 2, margin = opts.margin || 0;
  const RUN = PJ.C.RUN, per = localPeriod(PJ, L, s0.x - 4, goal.x + 4);
  const startKey = keyOf(s0, held0, per);
  const nodes = [{ s: s0, held: held0, parent: -1, act: -1, g: 0 }];
  const seen = new Map(); seen.set(startKey, 0);
  const heap = new Heap();
  const hfun = s => Math.max(0, goal.x - (s.x + PJ.C.PW / 2)) / RUN * 60 / MS;
  heap.push(hfun(s0) * W, 0);
  let expanded = 0, best = -1, bestH = 1e9;
  while (heap.size) {
    const [, id] = heap.pop();
    const n = nodes[id];
    if (goal.done(n.s)) { best = id; break; }
    if (++expanded > cap) break;
    for (const a of ACTS) {
      if (human) {
        const p = n.s;
        // press jump only when a jump (or wall jump) can actually start, or to ride a spring higher
        if (a.j && !n.held && !(p.ground || p.coyote > 0 || p.wall || p.wallCoy > 0 || (p.spring && p.vy < 0))) continue;
        // let go after landing; never hold the button while standing
        if (a.j && n.held && p.ground && n.parent >= 0) continue;
        // a jump is held at least a few frames once started
        if (!a.j && n.held && p.jumping && p.jt < 3 && p.vy < 0) continue;
      }
      const s = PJ.cloneRun(n.s);
      let held = n.held, dead = false;
      for (let k = 0; k < MS; k++) {
        const inp = { h: a.h, j: !!a.j, jp: !!a.j && !held };
        PJ.step(L, s, inp, null);
        held = !!a.j;
        if (s.dead) { dead = true; break; }
        if (goal.done(s)) break;
      }
      if (dead) continue;
      if (margin && (nearDanger(PJ, L, s, margin) || onEdge(PJ, L, s, margin))) continue;
      const key = keyOf(s, held, per);
      if (seen.has(key)) continue;
      const nid = nodes.length;
      // people prefer full jumps; only cut a jump short when it is needed
      const cost = 1 + (cutPen && s.cut && !n.s.cut ? cutPen : 0) + (chgPen && n.act >= 0 && n.act !== a.code ? chgPen : 0);
      nodes.push({ s, held, parent: id, act: a.code, g: n.g + cost });
      seen.set(key, nid);
      const hv = hfun(s);
      if (hv < bestH) bestH = hv;
      heap.push(n.g + cost + hv * W, nid);
    }
  }
  if (best < 0) return { fail: true, expanded, bestH };
  const acts = [];
  for (let i = best; nodes[i].parent >= 0; i = nodes[i].parent) acts.push(nodes[i].act);
  acts.reverse();
  // replay to produce exact per-tick inputs (stop at goal)
  const s = PJ.cloneRun(s0); let held = held0; const inputs = [];
  outer: for (const c of acts) {
    const h = (c >> 1) - 1, j = c & 1;
    for (let k = 0; k < MS; k++) {
      PJ.step(L, s, { h, j: !!j, jp: !!j && !held }, null); held = !!j; inputs.push(c);
      if (goal.done(s)) break outer;
    }
  }
  return { inputs, state: s, held, expanded };
}

// Waiting is what people do at moving platforms, but plain search drowns in (position x phase) states before it
// finds a long wait. So also try: stand still for w ticks (w = step, 2*step, ... one period), then search a little.
function solveWait(PJ, L, s0, held0, goal, opts, capEach, step) {
  step = step || 6;
  const per = Math.max(60, localPeriod(PJ, L, s0.x - 4, goal.x + 4)), o = Object.assign({}, opts, { cap: capEach });
  const s = PJ.cloneRun(s0); let held = held0, waited = 0;
  while (waited < per + step) {
    for (let k = 0; k < step; k++) { PJ.step(L, s, { h: 0, j: false, jp: false }, null); held = false; waited++; if (s.dead) return { fail: true, expanded: 0 }; }
    if (opts.margin && (nearDanger(PJ, L, s, opts.margin))) continue;
    const r = solveSegment(PJ, L, s, held, goal, o);
    if (!r.fail) { const pre = new Array(waited).fill(2); return { inputs: pre.concat(r.inputs), state: r.state, held: r.held, expanded: r.expanded, waited }; }
  }
  return { fail: true, expanded: 0 };
}

function localPeriod(PJ, L, x0, x1) {
  let per = 1;
  const gcd = (u, v) => v ? gcd(v, u % v) : u, lcm = (a, c) => a / gcd(a, c) * c;
  for (const m of L.movers) if (Math.max(m.x0, m.x1) + m.w >= x0 && Math.min(m.x0, m.x1) <= x1) per = lcm(per, m.per);
  for (const z of L.saws) if (z.cx + z.ax + 1 >= x0 && z.cx - z.ax - 1 <= x1) per = lcm(per, z.per);
  const T = PJ.T;
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(L.w - 1, Math.ceil(x1)); x++) for (let y = 0; y < L.h; y++) {
    const k = L.tiles[x * L.h + y];
    if (k === T.TA || k === T.TB) per = lcm(per, PJ.C.TOG); else if (k === T.TS || k === T.TS2) per = lcm(per, PJ.C.TSP);
  }
  return per;
}
// standing so close to a ledge that a slightly late jump would fall
function onEdge(PJ, L, s, m) {
  if (!s.ground || s.mover >= 0) return false;
  const cx = s.x + PJ.C.PW / 2, ry = Math.round(s.y + PJ.C.PH);
  const sup = x => { const k = PJ.tileAt(L, Math.floor(x), ry); return k !== 0 && k !== PJ.T.SP && k !== PJ.T.SD && k !== PJ.T.TS && k !== PJ.T.TS2; };
  return !(sup(cx - m * 1.6) && sup(cx + m * 1.6));
}
// is the player within `m` tiles of a hazard (used to make safer plans)
function nearDanger(PJ, L, s, m) {
  const ox = s.x, oy = s.y;
  for (const [dx, dy] of [[m, 0], [-m, 0], [0, m * 0.6], [0, -m * 0.6]]) {
    s.x = ox + dx; s.y = oy + dy;
    const hz = PJ.hazard(L, s);
    s.x = ox; s.y = oy;
    if (hz) return true;
  }
  return false;
}

function segGoal(PJ, L, i) {
  const wp = L.wps[i], last = i === L.wps.length - 1;
  return { x: wp[0] + 0.5, done: last ? (s => s.won) : (s => s.ground && s.x + PJ.C.PW / 2 >= wp[0] + 0.2 && s.y + PJ.C.PH <= wp[1] + 0.05 && s.y + PJ.C.PH > wp[1] - 0.2) };
}

// solve the whole level; returns per-tick codes
function solveLevel(PJ, L, opts) {
  opts = opts || {};
  const trySeg = (s, held, g, big) => {
    let r = solveSegment(PJ, L, s, held, g, Object.assign({ cap: 60000 }, opts));
    if (r.fail) r = solveWait(PJ, L, s, held, g, opts, 5000);
    if (r.fail) r = solveWait(PJ, L, s, held, g, opts, 25000, 4);
    if (r.fail && big) r = solveSegment(PJ, L, s, held, g, Object.assign({}, opts, { macro: 2, cap: 300000 }));
    return r;
  };
  let s = PJ.newRun(L), held = false, all = [];
  const hist = []; // state before each solved segment, so a dead end can be undone
  for (let i = 0; i < L.wps.length; i++) {
    const g = segGoal(PJ, L, i);
    let r = trySeg(s, held, g, false);
    if (r.fail && hist.length) {
      // the previous waypoint may have been reached in a doomed state: solve from before it straight to this one
      const h = hist[hist.length - 1];
      const r2 = trySeg(h.s, h.held, g, true);
      if (!r2.fail) { all = all.slice(0, h.len); s = h.s; held = h.held; hist.pop(); r = r2; }
    }
    if (r.fail) r = trySeg(s, held, g, true);
    if (r.fail) return { fail: true, seg: i, wp: L.wps[i], at: [s.x, s.y], expanded: r.expanded };
    hist.push({ s, held, len: all.length });
    all.push(...r.inputs); s = r.state; held = r.held;
  }
  return { inputs: all, ticks: all.length, state: s };
}

function rle(codes) { let out = '', i = 0; while (i < codes.length) { let j = i; while (j < codes.length && codes[j] === codes[i]) j++; out += codes[i] + (j - i).toString(36) + '.'; i = j; } return out; }
function unrle(str) { const out = []; for (const p of str.split('.')) { if (!p) continue; const c = +p[0], n = parseInt(p.slice(1), 36); for (let k = 0; k < n; k++) out.push(c); } return out; }
function replay(PJ, L, codes) {
  const s = PJ.newRun(L); let held = false;
  for (const c of codes) { const h = (c >> 1) - 1, j = c & 1; PJ.step(L, s, { h, j: !!j, jp: !!j && !held }, null); held = !!j; if (s.dead || s.won) break; }
  return s;
}
module.exports = { solveSegment, solveWait, solveLevel, segGoal, rle, unrle, replay, keyOf, ACTS };
