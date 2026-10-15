// 摺線 (foldline) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...]
// Reads tiles via window.__foldline (read-only accessors); acts only through CDP touch taps on the board canvas.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/foldline/index.html');

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const SOFT_CAP = 90000; // for levels without a game timer

const N = 1, E = 2, S = 4, W = 8, OPP = { 1: 4, 2: 8, 4: 1, 8: 2 }, DR = { 1: -1, 2: 0, 4: 1, 8: 0 }, DC = { 1: 0, 2: 1, 4: 0, 8: -1 };
const rotCW = m => m === 15 ? 15 : (((m << 1) | (m >> 3)) & 15);
const mirH = m => (m & (N | S)) | ((m & E) ? W : 0) | ((m & W) ? E : 0);
const mirV = m => (m & (E | W)) | ((m & N) ? S : 0) | ((m & S) ? N : 0);
const step = t => t.kind === 'rot' ? { ...t, mask: rotCW(t.mask) } : t.kind === 'fold' ? { ...t, mask: t.axis ? mirV(t.mask) : mirH(t.mask), axis: t.axis ^ 1 } : t;

function trace(G) {
  let r = G.s, c = 0, from = W; const list = [];
  for (let n = 0; n < G.rows * G.cols * 2; n++) {
    const t = G.at(r, c);
    if (!t) return { list, ok: false, next: null };
    if (!(t.mask & from)) return { list, ok: false, next: { r, c, from } };
    const exit = t.mask === 15 ? OPP[from] : (t.mask & ~from);
    list.push({ t, from, exit });
    r += DR[exit]; c += DC[exit];
    if (r === G.e && c === G.cols && exit === E) return { list, ok: true };
    if (!G.at(r, c)) return { list, ok: false, next: { r, c, from: OPP[exit], out: true } };
    from = OPP[exit];
  }
  return { list, ok: false, next: null };
}
function mkGrid(st) {
  const G = { rows: st.rows, cols: st.cols, s: st.s, e: st.e, tiles: st.tiles };
  G.at = (r, c) => (r < 0 || c < 0 || r >= G.rows || c >= G.cols) ? null : G.tiles[r * G.cols + c];
  return G;
}
// orientation options for tile t entering from `from`: [{k taps, exit}]
function options(t, from) {
  const out = []; let u = t;
  for (let k = 0; k < 4; k++) {
    if (u.mask & from) out.push({ k, exit: u.mask === 15 ? OPP[from] : (u.mask & ~from), mask: u.mask });
    if (t.kind !== 'rot' && t.kind !== 'fold') break;
    u = step(u);
  }
  return out;
}

// Decide the next tile to tap (index) and how many taps in a burst.
function decide(P, G, mem) {
  const tr = trace(G);
  const tier = P.tierId;
  const movable = G.tiles.filter(t => t.kind !== 'lock');
  if (tier === 'superhuman' || tier === 'world') {
    // perfect / near-perfect: rotate every intended-path tile to its solution state
    const t = G.tiles.find(t => t.path && t.kind !== 'lock' && t.mask !== t.sol);
    if (t) { let u = t, k = 0; while (u.mask !== t.sol && k < 4) { u = step(u); k++; } return { idx: t.r * G.cols + t.c, taps: k }; }
    return null;
  }
  const randomTap = () => ({ idx: P.rng.pick(movable).r * G.cols + P.rng.pick(movable).c, taps: 1 });
  if (tier === 'clumsy' && P.rng() < 0.5) { const t = P.rng.pick(movable); return { idx: t.r * G.cols + t.c, taps: 1 }; }
  if (tier === 'casual' && P.rng() < 0.15) { const t = P.rng.pick(movable); return { idx: t.r * G.cols + t.c, taps: 1 }; }
  const used = new Set(tr.list.map(x => x.t.r * G.cols + x.t.c));
  const nx = tr.next;
  const goodExit = (r, c, exit) => { const rr = r + DR[exit], cc = c + DC[exit]; if (rr === G.e && cc === G.cols && exit === E) return 2; const t2 = G.at(rr, cc); return t2 && !used.has(rr * G.cols + cc) ? 1 : 0; };
  const nextAccepts = (r, c, exit) => { const rr = r + DR[exit], cc = c + DC[exit]; if (rr === G.e && cc === G.cols) return true; const t2 = G.at(rr, cc); return t2 && options(t2, OPP[exit]).length > 0; };
  // Target tile: the frontier tile that does not accept, or the last tile if it points out of bounds.
  let target = null, from = null;
  if (nx && !nx.out) { target = G.at(nx.r, nx.c); from = nx.from; }
  if (!target || target.kind === 'lock' || (mem.dead.has(target.r * G.cols + target.c))) {
    // backtrack: rotate the last tile of the trace (or the one before)
    const back = tr.list.slice().reverse().find(x => x.t.kind !== 'lock' && !mem.dead.has(x.t.r * G.cols + x.t.c));
    if (!back) { mem.dead.clear(); const t = P.rng.pick(movable); return { idx: t.r * G.cols + t.c, taps: 1 }; }
    target = back.t; from = back.from;
    // its current orientation is a dead end; try next valid orientation (skip k=0)
    const opts = options(target, from).filter(o => o.k > 0);
    const key = target.r * G.cols + target.c;
    mem.tries[key] = (mem.tries[key] || 0) + 1;
    if (mem.tries[key] > 3) { mem.dead.add(key); mem.tries[key] = 0; }
    const pickO = opts.find(o => goodExit(target.r, target.c, o.exit)) || opts[0];
    return { idx: key, taps: pickO ? pickO.k : 1 };
  }
  const key = target.r * G.cols + target.c;
  let opts = options(target, from);
  if (!opts.length) { mem.dead.add(key); return { idx: key, taps: 1 }; }
  if (tier === 'skilled') {
    const scored = opts.map(o => ({ o, s: goodExit(target.r, target.c, o.exit) * 10 + (nextAccepts(target.r, target.c, o.exit) ? 5 : 0) + (o.exit === E ? 1 : 0) - o.k * 0.5 }));
    scored.sort((a, b) => b.s - a.s);
    return { idx: key, taps: scored[0].o.k || 1 };
  }
  // greedy (casual / clumsy): first orientation that accepts and leads somewhere on the board
  const g = opts.find(o => goodExit(target.r, target.c, o.exit)) || opts[0];
  return { idx: key, taps: g.k || 1 };
}

// ---- human-like planner for clumsy / casual / skilled (added with the game's undo button) ----
// Follows the path from the flag: at the frontier tile it picks an orientation by looking a few tiles ahead
// (clumsy 1, casual 2, skilled 4); at a dead end it backs out its latest decision with 復原 (which gives the
// moves back) and tries the next orientation, i.e. a depth-first search a person does on paper.
const LOOK = { clumsy: 1, casual: 2, skilled: 4 }, RANDOM = { clumsy: 0.5, casual: 0.15, skilled: 0 }, UNDO_BACKTRACK = { clumsy: 0.3, casual: 0.9, skilled: 1 };
function frontierOf(G, tr, mem) {
  if (tr.ok) return null;
  if (mem) for (let i = 0; i < tr.list.length; i++) { const x = tr.list[i], tb = mem.tabu[i]; if (tb && tb.has((x.t.r * G.cols + x.t.c) + ':' + x.t.mask)) return { t: x.t, from: x.from, depth: i, bad: true }; }
  if (tr.next && !tr.next.out) { const t = G.at(tr.next.r, tr.next.c); if (t) return { t, from: tr.next.from, depth: tr.list.length, bad: false }; }
  const last = tr.list[tr.list.length - 1];
  return last ? { t: last.t, from: last.from, depth: tr.list.length - 1, bad: true } : null;
}
function withTurns(G, t, k) {
  let u = t; for (let i = 0; i < k; i++) u = step(u);
  const tiles = G.tiles.slice(); tiles[t.r * G.cols + t.c] = u;
  const G2 = { ...G, tiles }; G2.at = (r, c) => (r < 0 || c < 0 || r >= G2.rows || c >= G2.cols) ? null : G2.tiles[r * G2.cols + c];
  return G2;
}
function lookScore(G, left) {
  const tr = trace(G);
  if (tr.ok) return 1e6;
  const last = tr.list[tr.list.length - 1];
  const prog = tr.list.length * 3 - (last ? (Math.abs(last.t.r + DR[last.exit] - G.e) + Math.abs(last.t.c + DC[last.exit] - G.cols)) * 2 : 0);
  const f = frontierOf(G, tr);
  if (!f || f.t.kind === 'lock') return prog - 500;
  if (left <= 0) return prog;
  const opts = options(f.t, f.from).filter(o => o.k > 0);
  if (!opts.length) return prog - 500;
  let best = -1e9;
  for (const o of opts) best = Math.max(best, lookScore(withTurns(G, f.t, o.k), left - 1) - o.k * 0.3);
  return best;
}
const keyOf = (G, t) => (t.r * G.cols + t.c);
function altOptions(G, x, depth, mem) { // orientations of trace tile x (entered from x.from) not tried yet at this depth
  if (x.t.kind === 'lock') return [];
  const tb = mem.tabu[depth];
  return options(x.t, x.from).filter(o => o.k > 0 && o.mask !== x.t.mask && !(tb && tb.has(keyOf(G, x.t) + ':' + o.mask)));
}
function choose(P, G, t, opts) {
  if (P.rng() < RANDOM[P.tierId]) return P.rng.pick(opts);
  let pick = opts[0], bs = -1e18;
  for (const o of opts) { const sc = lookScore(withTurns(G, t, o.k), LOOK[P.tierId] - 1) - o.k * 0.3 + P.rng() * 0.5; if (sc > bs) { bs = sc; pick = o; } }
  return pick;
}
function planStep(P, G, mem) {
  const tr = trace(G);
  if (tr.ok) return null;
  const f = frontierOf(G, tr, mem);
  if (!f) return null;
  const idx = keyOf(G, f.t);
  if (!mem.tabu[f.depth]) mem.tabu[f.depth] = new Set();
  if (f.bad) mem.tabu[f.depth].add(idx + ':' + f.t.mask);
  const opts = f.t.kind === 'lock' ? [] : options(f.t, f.from).filter(o => o.k > 0 && !mem.tabu[f.depth].has(idx + ':' + o.mask));
  let at = f, list = opts;
  if (!opts.length) {
    // dead end: go back to the deepest tile on the path that still has an untried orientation
    at = null;
    for (let d = Math.min(f.depth, tr.list.length) - 1; d >= 0; d--) { const x = tr.list[d], a = altOptions(G, x, d, mem); if (a.length) { at = { t: x.t, from: x.from, depth: d }; list = a; break; } }
    if (!at) { mem.tabu = {}; mem.stack = []; const t = P.rng.pick(G.tiles.filter(t => t.kind !== 'lock')); return { type: 'tap', idx: keyOf(G, t), taps: 1, depth: -1 }; }
    (mem.tabu[at.depth] || (mem.tabu[at.depth] = new Set())).add(keyOf(G, at.t) + ':' + at.t.mask);
    for (const k of Object.keys(mem.tabu)) if (+k > at.depth) delete mem.tabu[k];
  }
  // our own decisions at or beyond this depth are abandoned: take them back with 復原 (moves come back)
  let undoTo = null;
  while (mem.stack.length && mem.stack[mem.stack.length - 1].depth >= at.depth) undoTo = mem.stack.pop().hist;
  if (undoTo != null && P.rng() < UNDO_BACKTRACK[P.tierId]) return { type: 'undo', toHist: undoTo };
  const o = choose(P, G, at.t, list);
  return { type: 'tap', idx: keyOf(G, at.t), taps: o.k, depth: at.depth, mask: o.mask };
}

// casual / skilled read the whole board and plan a route to the house in their head (a noisy shortest-route
// search: per-tile misjudged cost, and fold tiles sometimes mistaken for plain rotating ones), then tap it out,
// re-planning from wherever the path really ends when the plan turns out wrong.
const ROUTE = { casual: { noise: 3, mis: 0.25 }, skilled: { noise: 1.2, mis: 0.08 }, world: { noise: 0.3, mis: 0 }, superhuman: { noise: 0, mis: 0 } };
function perceivedStates(t, asRot) {
  const out = []; let u = t;
  for (let k = 0; k < 4; k++) { out.push(u.mask); if (t.kind === 'lock') break; u = asRot ? { ...u, kind: 'rot', mask: rotCW(u.mask) } : step(u); }
  return out;
}
function routePlan(P, G, tr, mem) {
  const cfg = ROUTE[P.tierId];
  // plan the whole route from the flag: tiles already lined up cost nothing, so a good start is kept
  const start = { r: G.s, c: 0, from: W }, used = new Set();
  const noise = new Map(), misp = new Set();
  G.tiles.forEach((t, i) => { noise.set(i, P.rng() * cfg.noise); if (t.kind === 'fold' && P.rng() < cfg.mis && !(mem.learned && mem.learned.has(i))) misp.add(i); });
  const K = (r, c, f) => (r * G.cols + c) * 16 + f, dist = new Map([[K(start.r, start.c, start.from), 0]]), prev = new Map(), q = [[0, start.r, start.c, start.from]];
  let goal = null;
  while (q.length) {
    let bi = 0; for (let i = 1; i < q.length; i++) if (q[i][0] < q[bi][0]) bi = i;
    const [d, r, c, from] = q.splice(bi, 1)[0];
    if (d > dist.get(K(r, c, from))) continue;
    const i = r * G.cols + c, t = G.tiles[i];
    if (used.has(i) && t.mask !== 15) continue;
    perceivedStates(t, misp.has(i)).forEach((m, k) => {
      if (!(m & from)) return;
      const exit = m === 15 ? OPP[from] : (m & ~from), nd = d + k + noise.get(i), nr = r + DR[exit], nc = c + DC[exit];
      const node = { i, k, m, r, c, from };
      if (nr === G.e && nc === G.cols && exit === E) { if (!goal || nd < goal.d) goal = { d: nd, node }; return; }
      if (!G.at(nr, nc)) return;
      const kk = K(nr, nc, OPP[exit]);
      if (dist.has(kk) && dist.get(kk) <= nd) return;
      if (G.at(nr, nc).mask !== 15 && (used.has(nr * G.cols + nc) || (nr === r && nc === c))) return;
      if (G.at(nr, nc).mask !== 15) { let p = node, g = 0; while (p && g++ < 400) { if (p.r === nr && p.c === nc) return; p = prev.get(K(p.r, p.c, p.from)); } }
      dist.set(kk, nd); prev.set(kk, node); q.push([nd, nr, nc, OPP[exit]]);
    });
  }
  if (!goal) return [];
  const route = []; let cur = goal.node, guard = 0;
  while (cur && guard++ < 400) { route.unshift({ idx: cur.i, k: cur.k, m: cur.m }); cur = prev.get(K(cur.r, cur.c, cur.from)); }
  return route.filter(x => x.k > 0);
}
function routeStep(P, G, mem) {
  const tr = trace(G);
  if (tr.ok) return null;
  let think = 0;
  if (!mem.plan || !mem.plan.length) { mem.plan = routePlan(P, G, tr, mem); think = P.thinkMs(mem.replans ? 1 : 1 + Math.min(12, mem.plan.length) / 4); mem.replans = (mem.replans || 0) + 1; }
  if (!mem.plan.length) {
    // no simple route found (the planner never re-uses a tile, which can miss long winding solutions):
    // world / superhuman fall back to solving the whole board, the others explore from the frontier
    if (P.tierId === 'world' || P.tierId === 'superhuman') { const d = decide(P, G, mem); return d ? { type: 'tap', idx: d.idx, taps: d.taps, depth: -1, think } : null; }
    const d = planStep(P, G, mem); if (d) d.think = think; return d;
  }
  const nx = mem.plan.shift();
  return { type: 'tap', idx: nx.idx, taps: nx.k, depth: -1, think, expect: nx.m };
}

async function readState(page) {
  return page.evaluate(() => {
    const F = window.__foldline, s = F.state(), inf = F.info(), L = F.levels[s.lvIdx], g = F.geom();
    const tl = F.tiles().map(t => ({ r: t.r, c: t.c, mask: t.mask, sol: t.sol, kind: t.kind, axis: t.axis, path: t.path }));
    const b = document.getElementById('board').getBoundingClientRect();
    return { ...s, ...inf, s: L.s, e: L.e, rows: L.g.length, cols: L.g[0].length, tiles: tl, T: g.T, bx: b.left + g.ox, by: b.top + g.oy, winVisible: !document.getElementById('winOv').hidden };
  });
}

async function playAttempt(P, n) {
  const page = P.page;
  await page.evaluate(i => window.__foldline.load(i), n - 1);
  await H.sleep(400);
  let st = await readState(page);
  const info = { par: st.par, limit: st.limit, timeMax: st.timeMax };
  const t0 = Date.now(); const mem = { dead: new Set(), tries: {} };
  let taps = 0, misTaps = 0, undos = 0;
  const cap = st.timeMax ? (st.timeMax + 10) * 1000 : SOFT_CAP;
  // look at the board first
  await H.sleep(P.thinkMs(2));
  const canUndo = !!(await page.$('#undoBtn')); // the original build had no undo button
  const planner = !!(LOOK[P.tierId] || ROUTE[P.tierId]); mem.stack = []; mem.tabu = {}; mem.learned = new Set();
  while (planner && !st.solved && !st.failed && Date.now() - t0 < cap) {
    const d = ROUTE[P.tierId] ? routeStep(P, mkGrid(st), mem) : planStep(P, mkGrid(st), mem);
    if (!d) break;
    if (d.type === 'undo') {
      await H.sleep(P.reactMs() + P.thinkMs(0.5));
      while (st.moves > d.toHist && !st.failed) { if (!canUndo || !(await P.tapSelector('#undoBtn'))) break; undos++; await H.sleep(P.superhuman ? 16 : Math.max(90, P.reactMs() * 0.55)); st = await readState(page); }
      continue;
    }
    let idx = d.idx;
    const mistaken = P.mistake();
    if (mistaken) { const mv = st.tiles.filter(t => t.kind !== 'lock'); const t = P.rng.pick(mv); idx = t.r * st.cols + t.c; }
    if (d.depth >= 0 && !mistaken) mem.stack.push({ idx, depth: d.depth, mask: d.mask, hist: st.moves });
    if (mistaken) mem.plan = null;
    let missed = false;
    const r = Math.floor(idx / st.cols), c = idx % st.cols;
    await H.sleep(P.reactMs() + P.thinkMs() + (d.think || 0));
    for (let k = 0; k < Math.max(1, d.taps); k++) {
      if (k) await H.sleep(P.superhuman ? 16 : Math.max(90, P.reactMs() * 0.55));
      const x = st.bx + (c + 0.5) * st.T, y = st.by + (r + 0.5) * st.T, before = st.moves;
      const [jx, jy] = await P.tap(x, y); taps++;
      const hc = Math.floor((jx - st.bx) / st.T), hr = Math.floor((jy - st.by) / st.T);
      st = await readState(page);
      if (st.solved || st.failed) break;
      if (hc !== c || hr !== r) {
        misTaps++;
        const notice = { clumsy: 0.2, casual: 0.6, skilled: 0.9, world: 1, superhuman: 1 }[P.tierId];
        if (st.moves > before && P.rng() < notice && canUndo) { await H.sleep(P.reactMs()); await P.tapSelector('#undoBtn'); undos++; await H.sleep(30); st = await readState(page); k--; continue; }
        mem.plan = null; missed = true; break; // unnoticed: the board no longer matches the plan, look again
      }
    }
    if (d.expect != null && !mistaken && !missed && !st.solved && !st.failed && st.tiles[idx].mask !== d.expect) {
      // a fold tile did not end up the way the plan assumed: now it is understood; take the taps back and re-plan
      mem.learned.add(idx); mem.plan = null;
      const back = st.moves - Math.max(1, d.taps);
      if (P.rng() < ({ casual: 0.6, skilled: 0.9 }[P.tierId] || 1)) { await H.sleep(P.reactMs()); while (st.moves > back && !st.failed) { if (!canUndo || !(await P.tapSelector('#undoBtn'))) break; undos++; await H.sleep(Math.max(90, P.reactMs() * 0.55)); st = await readState(page); } }
    }
  }
  while (!planner && !st.solved && !st.failed && Date.now() - t0 < cap) {
    const G = mkGrid(st);
    const d = decide(P, G, mem);
    if (!d) break;
    let idx = d.idx;
    if (P.mistake()) { const mv = st.tiles.filter(t => t.kind !== 'lock'); const t = P.rng.pick(mv); idx = t.r * st.cols + t.c; }
    const r = Math.floor(idx / st.cols), c = idx % st.cols;
    await H.sleep(P.reactMs() + P.thinkMs());
    for (let k = 0; k < Math.max(1, d.taps); k++) {
      if (k) await H.sleep(P.superhuman ? 16 : Math.max(90, P.reactMs() * 0.55));
      const x = st.bx + (c + 0.5) * st.T, y = st.by + (r + 0.5) * st.T;
      const before = st.moves;
      const [jx, jy] = await P.tap(x, y); taps++;
      const hc = Math.floor((jx - st.bx) / st.T), hr = Math.floor((jy - st.by) / st.T);
      if (hc !== c || hr !== r) misTaps++;
      st = await readState(page);
      if (st.solved || st.failed) break;
      if (hc !== c || hr !== r) {
        // the game now has an undo that gives the move back: tiers that notice the wrong tile turning use it
        const notice = { clumsy: 0.2, casual: 0.6, skilled: 0.9, world: 1, superhuman: 1 }[P.tierId];
        if (st.moves > before && P.rng() < notice && canUndo) {
          await H.sleep(P.reactMs()); await P.tapSelector('#undoBtn'); undos++;
          await H.sleep(30); st = await readState(page);
        }
        break; // re-plan after a miss
      }
    }
  }
  const cleared = st.solved;
  if (cleared) { for (let i = 0; i < 60 && !st.winVisible; i++) { await H.sleep(200); st = await readState(page); } }
  const ms = Date.now() - t0;
  const stars = cleared ? (st.moves <= info.par + 2 ? 3 : st.moves <= Math.ceil(info.par * 1.6) + 3 ? 2 : 1) : 0;
  return { cleared, failedBy: cleared ? null : st.failed ? (st.moves >= info.limit ? 'moves' : 'time') : 'cap', moves: st.moves, ...info, taps, misTaps, undos, ms, stars, winOverlay: st.winVisible };
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 3000 + idx * 7919);
  await H.sleep(900);
  const runs = [];
  const ov = args.find(a => a.startsWith('--' + tierId + '-levels='));
  for (const n of ov ? ov.split('=')[1].split(',').map(Number) : TEST_LEVELS) {
    const run = { level: n, attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, n);
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, par: last.par, limit: last.limit, timeMax: last.timeMax, moves: last.moves, stars: last.stars, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run); try { const pf = require("path").join(__dirname, "partial-" + tierId + ".json"); require("fs").writeFileSync(pf, JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) {}
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail(' + last.failedBy + ')'} tries=${run.tries} moves=${run.moves} par=${run.par} lim=${run.limit} t=${run.timeMax} stars=${run.stars} mis=${last.misTaps} ${(run.ms / 1000).toFixed(1)}s`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0 } };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'foldline', testedLevels: TEST_LEVELS, tiers: {} };
  const t0 = Date.now();
  const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i)));
  TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(path.join(__dirname, process.env.OUT || 'raw-results.json'), JSON.stringify(out, null, 1));
  console.log('wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
