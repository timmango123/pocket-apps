// Offline level generator for 積木推推樂 (reverse generation + forward A* verification).
// Core rules are read from the CORE block of the page (or core.js while developing).
// node gen.js <from> <to> [outfile]      seed = L*2333 (+ attempt)
const fs = require('fs'), path = require('path');
const coreFile = process.env.CORE || path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(coreFile, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {parseLevel, initState, step, solve, isWon, expandMoves, heur, stateKey, reach, occOf, cloneState};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// spec curve 4*1.032^(L-1) while exact search can follow it; from L36 a gentler slope (exact/near-exact search stays feasible)
function targetM(L) { return L <= 35 ? Math.round(4 * Math.pow(1.032, L - 1)) : L <= 60 ? Math.round(11.7 + (L - 35) * 0.25) : Math.round(18 + (L - 60) * 0.15); }
function params(L) {
  const size = L <= 15 ? [5, 5] : L <= 30 ? [6, 6] : L <= 45 ? [7, 7] : L <= 60 ? [8, 8] : L <= 75 ? [9, 9] : L <= 90 ? [9, 10] : [9, 11];
  const n = process.env.NB ? +process.env.NB : Math.min(10, 2 + Math.floor(L / 12));
  const colors = L <= 10 ? 1 : Math.min(6, 2 + Math.floor(L / 20), n);
  return {
    L, w: size[0], h: size[1], n, colors, target: targetM(L),
    split: L >= 21, ice: (L >= 31 && L <= 40) ? 2 + (L >= 36) : L >= 91 ? 2 : 0,
    P: L >= 41 ? 3 : 0, glue: L >= 51 ? (L >= 91 ? 2 : 1) : 0, paint: L >= 66 ? (L >= 91 ? 2 : 1) : 0, door: L >= 81 ? 2 : 0,
    walls: Math.round(size[0] * size[1] * (0.10 + 0.08 * (L / 100))),
  };
}
// mechanisms on the board in each chapter: multicolour, split rows, ice (31-40 and 91+), push limit, glue, paint, doors
function mechCount(L) { return (L >= 11) + (L >= 21) + ((L >= 31 && L <= 40) || L >= 91) + (L >= 41) + (L >= 51) + (L >= 66) + (L >= 81); }

function toDef(c) {
  const t = [], o = [];
  for (let y = 0; y < c.h; y++) { let tr = '', or = ''; for (let x = 0; x < c.w; x++) { const i = y * c.w + x; tr += c.ter[i]; or += c.obj[i]; } t.push(tr); o.push(or); }
  return { t: t.join('/'), o: o.join('/'), g: c.glue.map(p => p.slice()), P: c.P };
}
const NB = (c, i, d) => { const x = i % c.w + [0, 1, 0, -1][d], y = ((i / c.w) | 0) + [-1, 0, 1, 0][d]; return (x < 0 || y < 0 || x >= c.w || y >= c.h) ? -1 : y * c.w + x; };
function connected(c) {
  const N = c.w * c.h; let start = -1, cnt = 0;
  for (let i = 0; i < N; i++) if (c.ter[i] !== '#') { cnt++; if (start < 0) start = i; }
  const seen = new Uint8Array(N), q = [start]; seen[start] = 1;
  for (let h = 0; h < q.length; h++) for (let d = 0; d < 4; d++) { const j = NB(c, q[h], d); if (j >= 0 && !seen[j] && c.ter[j] !== '#') { seen[j] = 1; q.push(j); } }
  return q.length === cnt;
}
function pick(a, rnd) { return a[Math.floor(rnd() * a.length)]; }
function clone(c) { return { w: c.w, h: c.h, ter: c.ter.slice(), obj: c.obj.slice(), glue: c.glue.map(g => g.slice()), P: c.P }; }

// solved room: walls, a compact cluster of targets with blocks sitting on them, special cells, pusher
function buildSolved(p, rnd) {
  const N = p.w * p.h;
  for (let tries = 0; tries < 400; tries++) {
    const c = { w: p.w, h: p.h, ter: new Array(N).fill('.'), obj: new Array(N).fill('.'), glue: [], P: p.P };
    for (let k = 0; k < p.walls; k++) c.ter[Math.floor(rnd() * N)] = '#';
    if (!connected(c)) continue;
    // grow a blob of target cells
    const blob = [];
    let seed = Math.floor(rnd() * N); if (c.ter[seed] !== '.') continue;
    blob.push(seed);
    let guard = 0;
    while (blob.length < p.n && guard++ < 400) {
      const b = pick(blob, rnd), a = NB(c, b, Math.floor(rnd() * 4));
      if (a >= 0 && c.ter[a] === '.' && !blob.includes(a)) blob.push(a);
    }
    if (blob.length < p.n) continue;
    const tcol = []; for (let i = 0; i < p.n; i++) tcol.push(i < p.colors ? i : Math.floor(rnd() * p.colors));
    for (let i = tcol.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = tcol[i]; tcol[i] = tcol[j]; tcol[j] = t; }
    blob.forEach((b, i) => { c.ter[b] = 'ABCDEF'[tcol[i]]; c.obj[b] = 'abcdef'[tcol[i]]; });
    // glued pairs among adjacent blob cells
    const used = new Set();
    for (let g = 0; g < p.glue; g++) {
      const pairs = [];
      for (const a of blob) for (const d of [1, 2]) { const b = NB(c, a, d); if (b >= 0 && blob.includes(b) && !used.has(a) && !used.has(b)) pairs.push([a, b]); }
      if (!pairs.length) break;
      const pr = pick(pairs, rnd); used.add(pr[0]); used.add(pr[1]); c.glue.push(pr);
    }
    if (c.glue.length < p.glue) continue;
    const free = () => { const r = []; for (let i = 0; i < N; i++) if (c.ter[i] === '.' && c.obj[i] === '.') r.push(i); return r; };
    // doors and paint cells sit next to the target area so the way home runs through them
    const rim = () => { const r = []; for (const b of blob) for (let d = 0; d < 4; d++) { const a = NB(c, b, d); if (a >= 0 && c.ter[a] === '.' && c.obj[a] === '.') r.push([a, b, (d + 2) % 4]); } return r; };
    for (let k = 0; k < p.ice; k++) { const r = rim(); if (r.length && rnd() < 0.6) { const [a, , dir] = pick(r, rnd); c.ter[a] = '~'; const a2 = NB(c, a, (dir + 2) % 4); if (a2 >= 0 && c.ter[a2] === '.' && c.obj[a2] === '.' && rnd() < 0.5) c.ter[a2] = '~'; } else c.ter[pick(free(), rnd)] = '~'; }
    for (let k = 0; k < p.door; k++) { const r = rim(); if (!r.length) break; const [a, , dir] = pick(r, rnd); c.ter[a] = '^>v<'[dir]; }
    for (let k = 0; k < p.paint; k++) { const r = rim(); if (!r.length) break; const [a, b] = pick(r, rnd); c.ter[a] = '123456'['ABCDEF'.indexOf(c.ter[b])]; }
    c.obj[pick(free(), rnd)] = '@';
    return c;
  }
  return null;
}
// random walk of the pusher that sometimes pulls the block behind it (the reverse of a single push)
function scramble(c0, p, rnd, K) {
  const c = clone(c0); let pi = c.obj.indexOf('@'), pulls = 0, last = 0;
  for (let stepN = 0; stepN < K * 40 && pulls < K; stepN++) {
    const d = rnd() < 0.55 ? last : Math.floor(rnd() * 4); last = d;
    const a = NB(c, pi, d); if (a < 0 || c.ter[a] === '#' || c.obj[a] !== '.') continue;
    const b = NB(c, pi, (d + 2) % 4);
    if (b >= 0 && 'abcdef'.includes(c.obj[b]) && rnd() < 0.65) {
      const pk = '123456'.indexOf(c.ter[b]);
      if (pk >= 0 && 'abcdef'.indexOf(c.obj[b]) !== pk) { c.obj[a] = '@'; c.obj[pi] = '.'; pi = a; continue; }
      const g = c.glue.find(g => g.includes(b));
      if (g) {
        const o = g[0] === b ? g[1] : g[0], od = NB(c, o, d);
        if (od < 0 || c.ter[od] === '#' || (c.obj[od] !== '.' && od !== b)) continue;
        const pko = '123456'.indexOf(c.ter[o]); if (pko >= 0 && 'abcdef'.indexOf(c.obj[o]) !== pko) continue;
        const bo = c.obj[b], oo = c.obj[o];
        c.obj[pi] = '.'; c.obj[a] = '@'; c.obj[b] = '.'; c.obj[o] = '.'; c.obj[pi] = bo; c.obj[od] = oo;
        if (g[0] === b) { g[0] = pi; g[1] = od; } else { g[1] = pi; g[0] = od; }
        if (pko >= 0 && rnd() < 0.7) c.obj[od] = 'abcdef'[Math.floor(rnd() * p.colors)];
      } else {
        c.obj[a] = '@'; c.obj[pi] = c.obj[b]; c.obj[b] = '.';
        if (pk >= 0 && rnd() < 0.7) c.obj[pi] = 'abcdef'[Math.floor(rnd() * p.colors)];
      }
      pi = a; pulls++;
    } else { c.obj[a] = '@'; c.obj[pi] = '.'; pi = a; }
  }
  return c;
}
// biased reverse search: repeatedly pull a block (reverse push) chosen to push the total push-distance up
function scramble2(c0, p, rnd, K, temp) {
  const c = clone(c0), Lp = C.parseLevel(toDef(c)), N = c.w * c.h;
  let pi = c.obj.indexOf('@'), lastB = -1, lastD = -1;
  const dist = (i, col, glued) => (glued ? Lp.dL : Lp.dS)[i * 6 + col];
  // forced first pull onto a paint cell beside the target area (so a colour change is needed on the way home)
  for (let a = 0; a < N; a++) {
    const pk = '123456'.indexOf(c.ter[a]); if (pk < 0 || c.obj[a] !== '.') continue;
    for (let d = 0; d < 4; d++) {
      const b = NB(c, a, (d + 2) % 4), e = NB(c, a, d);
      if (b < 0 || e < 0 || c.ter[e] === '#' || (c.obj[e] !== '.' && c.obj[e] !== '@') || c.obj[b] !== 'abcdef'[pk] || c.glue.some(g => g.includes(b))) continue;
      c.obj[pi] = '.'; c.obj[a] = c.obj[b]; c.obj[b] = '.'; c.obj[e] = '@'; pi = e; d = 4; a = N;
    }
  }
  for (let k = 0; k < K; k++) {
    // reachable cells
    const seen = new Uint8Array(N), q = [pi]; seen[pi] = 1;
    const dr = (cell, dir) => { const k = '^>v<'.indexOf(c.ter[cell]); return k < 0 || k === dir; };
    for (let h = 0; h < q.length; h++) for (let d = 0; d < 4; d++) { const a = NB(c, q[h], d); if (a >= 0 && !seen[a] && c.ter[a] !== '#' && (c.obj[a] === '.' || c.obj[a] === '@') && dr(q[h], (d + 2) % 4)) { seen[a] = 1; q.push(a); } }
    const opts = [];
    for (const r of q) for (let d = 0; d < 4; d++) {
      const a = NB(c, r, d), b = NB(c, r, (d + 2) % 4);
      if (a < 0 || b < 0 || c.ter[a] === '#' || (c.obj[a] !== '.' && c.obj[a] !== '@') || !'abcdef'.includes(c.obj[b])) continue;
      const col = 'abcdef'.indexOf(c.obj[b]), pk = '123456'.indexOf(c.ter[b]);
      if (pk >= 0 && pk !== col) continue;
      const fd = (d + 2) % 4; if (!dr(r, fd) || !dr(b, fd)) continue;
      const g = c.glue.find(g => g.includes(b));
      let delta;
      if (g) {
        const o = g[0] === b ? g[1] : g[0], od = NB(c, o, d);
        if (od < 0 || c.ter[od] === '#' || (c.obj[od] !== '.' && c.obj[od] !== '@' && od !== b) || od === r) continue;
        const pko = '123456'.indexOf(c.ter[o]); if (pko >= 0 && pko !== 'abcdef'.indexOf(c.obj[o])) continue;
        if (!dr(o, fd)) continue;
        const ocol = 'abcdef'.indexOf(c.obj[o]);
        const d1 = dist(r, col, true), d2 = dist(od, ocol, true); if (d1 === 255 || d2 === 255) continue;
        delta = d1 + d2 - dist(b, col, true) - dist(o, ocol, true) + 1;
        opts.push({ r, d, b, a, g, o, od, delta });
      } else {
        const d1 = dist(r, col, false); if (d1 === 255) continue;
        delta = d1 - dist(b, col, false) + (pk >= 0 ? 1.5 : 0) + ('^>v<'.includes(c.ter[b]) || '^>v<'.includes(c.ter[r]) ? 1 : 0);
        if (b === lastB && d === (lastD + 2) % 4) delta -= 3;
        opts.push({ r, d, b, a, delta });
      }
    }
    if (!opts.length) break;
    let tot = 0; for (const o of opts) { o.w = Math.exp(o.delta / temp); tot += o.w; }
    let x = rnd() * tot, ch = opts[opts.length - 1]; for (const o of opts) { x -= o.w; if (x <= 0) { ch = o; break; } }
    // apply: pusher walks to r, then steps to a pulling block b into r
    c.obj[pi] = '.';
    const bo = c.obj[ch.b];
    if (ch.g) {
      const oo = c.obj[ch.o]; c.obj[ch.b] = '.'; c.obj[ch.o] = '.'; c.obj[ch.r] = bo; c.obj[ch.od] = oo;
      if (ch.g[0] === ch.b) { ch.g[0] = ch.r; ch.g[1] = ch.od; } else { ch.g[1] = ch.r; ch.g[0] = ch.od; }
      if ('123456'.includes(c.ter[ch.o]) && rnd() < 0.6) c.obj[ch.od] = 'abcdef'[Math.floor(rnd() * p.colors)];
    } else {
      c.obj[ch.b] = '.'; c.obj[ch.r] = bo;
      if ('123456'.includes(c.ter[ch.b]) && rnd() < 0.9) c.obj[ch.r] = 'abcdef'[(('abcdef'.indexOf(bo)) + 1 + Math.floor(rnd() * Math.max(1, p.colors - 1))) % p.colors];
    }
    c.obj[ch.a] = '@'; pi = ch.a; lastB = ch.r; lastD = ch.d;
  }
  // finally let the pusher wander a little
  for (let k = 0; k < 6; k++) { const d = Math.floor(rnd() * 4), a = NB(c, pi, d); if (a >= 0 && c.ter[a] !== '#' && c.obj[a] === '.') { c.obj[a] = '@'; c.obj[pi] = '.'; pi = a; } }
  return c;
}
function features(def, sol) {
  const L = C.parseLevel(def);
  let S = C.initState(L), slid = false, painted = false, door = false, maxRow = 0, glueMoved = false;
  const ex = C.expandMoves(L, S, sol.pushes);
  if (!ex) return null;
  for (const mv of ex.moves) {
    const r = C.step(L, S, mv.d);
    if (r.push) {
      if (r.slid) slid = true; if (r.paint.length) painted = true; maxRow = Math.max(maxRow, r.set.length);
      for (const id of r.set) { if (L.mate[id] >= 0) glueMoved = true; for (const cc of r.paths[id]) if (L.ter[cc] >= 10 && L.ter[cc] <= 13) door = true; }
    }
    if (L.ter[r.S.p] >= 10 && L.ter[r.S.p] <= 13) door = true;
    S = r.S;
  }
  let split = false; const S0 = C.initState(L);
  for (let i = 0; i < S0.pos.length; i++) for (let j = 0; j < S0.pos.length; j++) if (S0.col[i] !== S0.col[j] && L.mate[i] !== j) {
    const df = Math.abs(S0.pos[i] - S0.pos[j]); if ((df === 1 && ((S0.pos[i] / L.w) | 0) === ((S0.pos[j] / L.w) | 0)) || df === L.w) split = true;
  }
  return { slid, painted, door, maxRow, split, glueMoved, moves: ex.moves.length };
}
// each chapter's new mechanic must be used by the optimal solution; the final chapter has every element on the board
// and its solution must use at least three of ice / paint / door / glue
function okFeatures(p, f, sol) {
  if (!f) return false;
  if (p.split && !f.split) return false;
  const L = p.L;
  if (L >= 91) return [f.slid, f.painted, f.door, f.glueMoved].filter(Boolean).length >= 3;
  if (L >= 31 && L <= 40 && !f.slid) return false;
  if (L >= 41 && L <= 50 && !sol.heavySeen) return false;
  if (L >= 51 && L <= 65 && !f.glueMoved) return false;
  if (L >= 66 && L <= 80 && !f.painted) return false;
  if (L >= 81 && !f.door) return false;
  return true;
}
// number of distinct push-states within `depth` pushes of the start (state-space size measure)
function countStates(L, depth, cap) {
  const S0 = C.initState(L), seen = new Set([C.stateKey(L, S0, C.occOf(L, S0))]);
  let front = [S0];
  for (let k = 0; k < depth && front.length && seen.size < cap; k++) {
    const nf = [];
    for (const S of front) {
      const occ = new Int16Array(L.N).fill(-1); S.pos.forEach((p, i) => occ[p] = i);
      const cells = C.reach(L, S, occ).slice();
      for (const c of cells) for (let d = 0; d < 4; d++) {
        const a = L.nb[c * 4 + d]; if (a < 0 || occ[a] < 0) continue;
        const r = C.step(L, { p: c, pos: S.pos, col: S.col }, d, true); if (!r) continue;
        const key = C.stateKey(L, r.S, C.occOf(L, r.S)); if (seen.has(key)) continue;
        seen.add(key); nf.push(r.S);
      }
    }
    front = nf;
  }
  return seen.size;
}
function evaluate(c, limit) {
  const def = toDef(c), L = C.parseLevel(def);
  if (C.isWon(L, C.initState(L))) return null;
  let sol = C.solve(L, { limit }), proven = true;
  if (sol.len === -2) {
    proven = false; let bestS = null;
    for (const w of [2, 3]) { const r = C.solve(L, { limit, w }); if (r.len > 0 && (!bestS || r.len < bestS.len)) bestS = r; }
    if (!bestS) return { len: -2 };
    sol = bestS;
  }
  return { c, def, len: sol.len, states: sol.states, sol, proven, L };
}
function diffOf(m, n4, L) { return m * Math.log10(Math.max(10, n4)) * (1 + 0.1 * mechCount(L)); }
// collect several valid candidates for level Lv (independent of other levels)
function pool(Lv, opts) {
  const p = params(Lv), limit = opts.limit || 120000, T = targetM(Lv) + (+process.env.TPLUS || 0), want = opts.want || 5, tEnd = Date.now() + (opts.ms || 120000);
  const lo = Math.max(2, T - 1), hi = T + (Lv < 20 ? 2 : 4);
  const out = [], seenDefs = new Set();
  let evals = 0;
  for (let attempt = 0; out.length < want && Date.now() < tEnd && attempt < 5000; attempt++) {
    const rnd = mulberry32(Lv * 2333 + attempt * 7919 + (opts.salt || 0));
    const base = buildSolved(p, rnd); if (!base) continue;
    let K = Math.max(2, Math.round(T * (Lv < 30 ? 0.9 : 1.4)));
    for (let tries = 0; tries < 12 && out.length < want && Date.now() < tEnd; tries++) {
      const cand = scramble2(base, p, rnd, K, Lv < 20 ? 0.6 : 0.3);
      const e = evaluate(cand, limit); evals++;
      if (!e || e.len === -1) continue;
      if (e.len === -2) { K = Math.max(2, K - 2); continue; }
      if (e.len < lo) { K += Math.max(1, Math.round((lo - e.len) * 0.8)); continue; }
      if (e.len > hi) { K = Math.max(2, K - 2); continue; }
      if (seenDefs.has(e.def.t + e.def.o)) continue;
      const f = features(e.def, e.sol);
      if (!okFeatures(p, f, e.sol)) { K += 1; continue; }
      seenDefs.add(e.def.t + e.def.o);
      const n4 = countStates(e.L, 4, 2e5);
      out.push({ L: Lv, t: e.def.t, o: e.def.o, g: e.def.g, P: e.def.P, m: e.len, proven: e.proven, n4, d: +diffOf(e.len, n4, Lv).toFixed(2), searched: e.states, s: e.sol.pushes.map(q => q.c * 4 + q.d), row: f.maxRow });
      K += (rnd() < 0.5 ? 1 : -1);
    }
  }
  return { cands: out, evals };
}
module.exports = { params, mechCount, C, toDef, buildSolved, scramble, scramble2, evaluate, features, diffOf, pool, countStates, targetM };
if (require.main === module) {
  // node gen.js pool <from> <to> <step> <outdir> [ms] [want] [salt]
  const [, , mode, a, b, st, dir, ms, want, salt] = process.argv;
  fs.mkdirSync(dir, { recursive: true });
  for (let Lv = +a; Lv <= +b; Lv += +st) {
    const f = path.join(dir, 'L' + Lv + '.json');
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
    if (prev.length >= (+want || 5) && !salt) continue;
    const t0 = Date.now();
    const r = pool(Lv, { ms: +ms || 120000, want: +want || 5, salt: +salt || 0 });
    const all = prev.concat(r.cands.filter(c => !prev.some(q => q.t === c.t && q.o === c.o)));
    fs.writeFileSync(f, JSON.stringify(all));
    console.log('L' + Lv, 'T', targetM(Lv), 'cands', r.cands.map(c => c.m + (c.proven ? '' : '?') + '/' + c.d).join(' '), 'evals', r.evals, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
