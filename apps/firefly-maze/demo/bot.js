// Auto-player for 螢火迷宮. Uses the game's own core (extracted from index.html via CORE markers).
// Strategy (spec 五): look ahead over the deterministic simulation — branch at each junction (depth-limited),
// follow a "nearest light dot, weighted by moth danger" rollout afterwards, score by dots/points, distance
// to danger, and death. Realised as human-like swipes: decide from a state predicted LAT ticks ahead
// (>=150 ms reaction), press only inside the game's 300 ms turn buffer, >=150 ms between swipes.
const fs = require('fs'), path = require('path');

function loadCore(htmlPath) {
  const html = fs.readFileSync(htmlPath || path.resolve(__dirname, '..', 'index.html'), 'utf8');
  const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  return new Function(src + '\nreturn {params, buildLevel, newState, cloneState, step, nb, canP, canM, posOf, opp, DX, DY, BASE, TPS, BUF_T, MECHS};')();
}

function makeBot(C, L0, opt) {
  opt = opt || {};
  // plan against a slightly larger moth hit radius: a safety margin for input-timing noise
  const L = Object.assign({}, L0, { hitR2: opt.hitR2 || 0.64 });
  const DEPTH = opt.depth || 4, HOR = opt.horizon || 180, DW = opt.dw != null ? opt.dw : 0.6;
  const N = L.w * L.h;
  // all-pairs BFS distances on the open graph (ignores gates/hedges; used as a heuristic only)
  const idx = new Int16Array(N).fill(-1), cells = [];
  for (let t = 0; t < N; t++) if (L.g[t] === 0) { idx[t] = cells.length; cells.push(t); }
  const M = cells.length, AD = new Uint16Array(M * M).fill(999);
  for (let i = 0; i < M; i++) {
    const q = [cells[i]]; AD[i * M + i] = 0; let qi = 0;
    while (qi < q.length) {
      const v = q[qi++], dv = AD[i * M + idx[v]];
      for (let d = 0; d < 4; d++) { const u = C.nb(L, v, d); if (u < 0 || idx[u] < 0) continue; const k = i * M + idx[u]; if (AD[k] !== 999) continue; AD[k] = dv + 1; q.push(u); }
    }
  }
  const dist = (a, b) => (idx[a] < 0 || idx[b] < 0) ? 99 : AD[idx[a] * M + idx[b]];
  function mothTile(m) { return m.p > 0.5 ? C.nb(L, m.t, m.d) : m.t; }
  function playerTile(S) { const P = S.pl; return P.mv && P.p > 0.5 ? C.nb(L, P.t, P.d) : P.t; }
  function danger(S, t) { // sum of threat from non-panicked active moths
    let s = 0, mn = 99;
    for (const m of S.ms) {
      if (m.mode !== 'norm' && m.mode !== 'leave') { continue; }
      if (m.panic && S.pT > 50) continue;
      const d = dist(t, mothTile(m)); if (d < mn) mn = d;
      if (d < 9) s += (9 - d) * (9 - d);
    }
    return { s, mn };
  }
  function nearestDot(S, t) {
    let best = 99;
    // BFS over open graph limited radius
    const seen = new Set([t]); let fr = [t], d = 0;
    while (fr.length && d < 90) {
      for (const v of fr) if (S.dots[v]) return d;
      const nf = [];
      for (const v of fr) for (let e = 0; e < 4; e++) { const u = C.nb(L, v, e); if (u < 0 || L.g[u] !== 0 || seen.has(u)) continue; seen.add(u); nf.push(u); }
      fr = nf; d++;
    }
    return best;
  }
  function exitsAt(S, t, from) { const r = []; for (let e = 0; e < 4; e++) if (e !== C.opp(from) && C.canP(L, S, C.nb(L, t, e), e)) r.push(e); return r; }
  // is the player approaching a tile where a choice is needed?
  function decisionPoint(S) {
    const P = S.pl;
    if (!P.mv) { if (S.status !== 'play' && !(S.status === 'ready' && S.st <= 14)) return null; if (P.des >= 0 && C.canP(L, S, C.nb(L, P.t, P.des), P.des) && S.tick - P.desT < 14) return null; const r = []; for (let e = 0; e < 4; e++) if (C.canP(L, S, C.nb(L, P.t, e), e)) r.push(e); return r.length ? { t: P.t, opts: r, stopped: true } : null; }
    if (S.status !== 'play') return null;
    const nx = C.nb(L, P.t, P.d);
    if (nx < 0 || L.flw[nx] >= 0) return null;
    if (P._dk === nx * 4 + P.d) return null;
    if (P.p < 0.2) return null;
    const ex = exitsAt(S, nx, P.d);
    if (ex.length < 2) return null;
    return { t: nx, opts: ex, stopped: false };
  }
  function greedyChoice(S, dp) {
    let best = dp.opts[0], bv = -1e9;
    for (const e of dp.opts) {
      const u = C.nb(L, dp.t, e);
      const nd = nearestDot(S, u), dg = danger(S, u);
      const v = -nd * 3 - dg.s * 2 - (dg.mn <= 1 ? 500 : 0) + (S.dots[u] ? 3 : 0);
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }
  function apply(S, dp, e) { const P = S.pl; P.des = e; P.desT = S.tick; P._dk = dp.stopped ? -1 : dp.t * 4 + P.d; }
  function leaf(S, S0) {
    if (S.status === 'won') return 1e6 - S.tick;
    if (S.status === 'dying' || S.status === 'lost' || S.lives < S0.lives) return -1e6 + (S.tick - S0.tick) * 200;
    const pt = playerTile(S);
    let v = (S.score - S0.score) - (S._pen || 0);
    v -= nearestDot(S, pt) * 4;
    const dg = danger(S, pt);
    v -= dg.s * DW;
    if (S.pT > 40) for (const m of S.ms) if (m.panic && m.mode === 'norm') v += 40 / (1 + dist(pt, mothTile(m)));
    if (!S.pl.mv) v -= 30;
    return v;
  }
  function stepTracked(S) {
    const pre = S.left;
    const ev = C.step(L, S, -1);
    for (const e of ev) if (e[0] === 'power' && S.left > 12) {
      const dg = danger(S, S.pl.t);
      if (dg.mn > 7) S._pen = (S._pen || 0) + 160;
    }
    return pre;
  }
  function search(S, depth, end, S0) {
    for (;;) {
      if (S.status === 'won' || S.status === 'dying' || S.status === 'lost' || S.lives < S0.lives || S.tick >= end) return leaf(S, S0);
      const dp = decisionPoint(S);
      if (dp) {
        if (depth > 0 && dp.opts.length > 1) {
          let best = -Infinity;
          for (const e of dp.opts) { const C2 = C.cloneState(S); C2.pl = Object.assign({}, S.pl); apply(C2, dp, e); const v = search(C2, depth - 1, end, S0); if (v > best) best = v; }
          return best;
        }
        apply(S, dp, dp.opts.length > 1 ? greedyChoice(S, dp) : dp.opts[0]);
      }
      stepTracked(S);
    }
  }
  // decide on root options for state Sp (already predicted forward by latency)
  function plan(Sp) {
    const S0 = Sp, end = Sp.tick + HOR, res = [];
    // advance to the first decision point, remembering how long it takes
    let S = C.cloneState(Sp); let k = 0; let dp = null;
    const P0 = Sp.pl;
    // reverse option
    if (P0.mv && Sp.status === 'play' && C.canP(L, Sp, P0.t, C.opp(P0.d))) {
      const R = C.cloneState(Sp); R.pl.des = C.opp(P0.d); R.pl.desT = R.tick; stepTracked(R);
      res.push({ kind: 'rev', dir: C.opp(P0.d), v: search(R, DEPTH - 1, end, S0) - (opt.revPen || 35) });
    }
    while (k < HOR) {
      if (S.status !== 'play' && S.status !== 'ready') break;
      dp = decisionPoint(S); if (dp) break;
      stepTracked(S); k++;
    }
    if (dp) {
      for (const e of dp.opts) { const C2 = C.cloneState(S); apply(C2, dp, e); res.push({ kind: 'turn', dir: e, at: dp.t, ticks: k, stopped: dp.stopped, v: search(C2, DEPTH - 1, end, S0) }); }
    } else res.push({ kind: 'none', v: leaf(S, S0) });
    res.sort((a, b) => b.v - a.v);
    return res;
  }
  return { plan, dist, danger, pressAt: opt.pressAt };
}

// Given an actual state S, decide what to press now (or -1). LAT = predicted ticks until a press registers.
function decide(C, L, bot, S, LAT, lastPressTick) {
  if (S.status !== 'play' && S.status !== 'ready') return { press: -1 };
  const Sp = C.cloneState(S);
  for (let i = 0; i < LAT; i++) { C.step(L, Sp, -1); if (Sp.status !== 'play' && Sp.status !== 'ready') return { press: -1 }; }
  const res = bot.plan(Sp), best = res[0];
  if (!best || best.kind === 'none') return { press: -1, best };
  if (best.kind === 'rev') return { press: best.dir, best };
  const P = Sp.pl;
  const staleWrong = P.des >= 0 && P.des !== best.dir;
  if (best.stopped) return { press: best.dir, best };
  if (best.ticks > (bot.pressAt != null ? bot.pressAt : 5)) return { press: -1, best };
  if (best.dir === P.d && !staleWrong) return { press: -1, best };
  if (P.des === best.dir && Sp.tick - P.desT + best.ticks < 16) return { press: -1, best };
  // confirm pressing now realises the turn (and is not consumed by an earlier corner)
  const T = C.cloneState(Sp); T.pl.des = best.dir; T.pl.desT = T.tick;
  for (let i = 0; i < best.ticks + 14; i++) {
    C.step(L, T, -1);
    if (T.pl.t === best.at && T.pl.d === best.dir) return { press: best.dir, best };
    if (T.status !== 'play') break;
  }
  if (best.dir === P.d) return { press: best.dir, best };
  return { press: -1, best, unconfirmed: true };
}

// Headless run of one level with the latency model. Returns result.
function simLevel(C, n, opts) {
  opts = opts || {};
  const L = C.buildLevel(n), S = C.newState(L), bot = makeBot(C, L, opts);
  const rng = (() => { let s = (opts.seed || 1) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
  const LAT = opts.lat || 10;
  let queue = [], lastPress = -99, nextThink = 0, presses = 0;
  while (S.status !== 'won' && S.status !== 'lost' && S.tick < 60 * 600) {
    let inp = -1;
    if (queue.length && queue[0].at <= S.tick) inp = queue.shift().dir;
    C.step(L, S, inp);
    if (S.tick >= nextThink && !queue.length) {
      const jit = opts.jit || 3, lat = LAT + ((rng() * jit) | 0);
      const r = decide(C, L, bot, S, Math.round(LAT + (jit - 1) / 2), lastPress);
      if (r.press >= 0 && S.tick + lat - lastPress >= 9) { queue.push({ at: S.tick + lat, dir: r.press }); lastPress = S.tick + lat; presses++; }
      nextThink = S.tick + 2 + ((rng() * 2) | 0);
    }
  }
  return { n, won: S.status === 'won', lives: S.lives, deaths: S.deaths, score: S.score, secs: +(S.tick / 60).toFixed(1), left: S.left, presses };
}

module.exports = { loadCore, makeBot, decide, simLevel };
