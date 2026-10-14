// Offline level generator for 森林糖果樹屋 (rope-cut). Uses the game's own physics core (CORE-START/END in ../index.html).
// Constructive "template x parameters" generator: lay out the starting rig, then play a random sequence of events
// (cuts, bubble pops, blower puffs, gravity flips) and drop passive gadgets (bubbles, auto-ropes, pads, hats) onto the
// candy's future path; the fox goes where the candy ends up, stars on the path. Every candidate is then re-simulated
// from scratch, every op must be necessary, and each op's feasible timing window is measured (others fixed).
// Usage:
//   node gen.js work <from> <to> <outfile> [secondsPerLevel] [stride]   -> candidates JSON
//   node gen.js select <candfile...>                          -> picks a strictly increasing difficulty chain, writes LEVELS into ../index.html
const fs = require('fs'), path = require('path');
const SRC = process.env.CORE || path.join(__dirname, '..', 'index.html');
const coreSrc = fs.readFileSync(SRC, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {normLevel,newWorld,cloneWorld,stepWorld,applyOp,simulate,solved3,ropeAttached,anchorAt,segDist,nRopes,hatPos,DT,CR,BUB_R,FOX_R,PAD_D,SPIKE_D,HAT_D};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const R = (rnd, a, b) => a + (b - a) * rnd();
const RI = (rnd, a, b) => Math.floor(a + (b - a + 1) * rnd());
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ORDER = ['rope', 'bubble', 'blower', 'spike', 'auto', 'pad', 'moving', 'gravity', 'hat'];

function plan(n) {
  const ops = 1 + Math.floor(n / 12);
  const win = Math.max(0.25, 1.2 * Math.pow(0.985, n - 1));
  const dec = Math.floor((n - 1) / 10);
  const avail = ORDER.slice(0, Math.min(9, dec + 1));
  const kc = n < 11 ? 1 : n >= 91 ? 9 : Math.min(avail.length, 2 + Math.floor((n - 11) / 14));
  const spikes = n >= 31 ? 1 + Math.floor((n - 31) / 15) : 0;
  return { n, ops, win, avail, kc, spikes, newKind: n >= 91 ? null : ORDER[dec] };
}
function targetD(p) { return p.ops / p.win * Math.sqrt(p.kc) * Math.pow(p.spikes + 1, 0.3); }

const AREA = [20, 22, 370, 690];
const inArea = (x, y) => x > AREA[0] && x < AREA[2] && y > AREA[1] && y < AREA[3];

function chooseKinds(p, rnd) {
  const set = new Set(['rope']);
  if (p.n >= 91) return new Set(ORDER);
  if (p.newKind) set.add(p.newKind);
  if (p.n >= 31) set.add('spike');
  const pool = p.avail.filter(k => !set.has(k));
  while (set.size < p.kc && pool.length) set.add(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return set;
}

// true when the path lk never came within rad of Q before its final approach to lk[i]
function noRevisit(lk, i, Q, rad) {
  let j0 = i; while (j0 > 0 && Math.hypot(lk[j0][0] - Q[0], lk[j0][1] - Q[1]) < rad + 12) j0--;
  for (let j = 0; j < j0; j++) if (Math.hypot(lk[j][0] - Q[0], lk[j][1] - Q[1]) < rad) return false;
  return true;
}
// ---------- candidate construction ----------
function construct(n, seed) {
  const p = plan(n), rnd = mulberry32(seed);
  const kinds = chooseKinds(p, rnd);
  const N = p.ops;
  let flips = kinds.has('gravity') ? (N >= 6 && rnd() < 0.5 ? 2 : 1) : 0;
  let nBlow = kinds.has('blower') ? (N >= 7 && rnd() < 0.4 ? 2 : 1) : 0;
  let nBub = kinds.has('bubble') ? (N >= 6 && rnd() < 0.4 ? 2 : 1) : 0;
  let nAuto = kinds.has('auto') ? (N >= 6 && rnd() < 0.4 ? 2 : 1) : 0;
  let nPad = kinds.has('pad') ? (rnd() < 0.3 ? 2 : 1) : 0;
  let nHat = kinds.has('hat') ? 1 : 0;
  let pops = nBub > 0 && N >= 2 ? (rnd() < 0.85 ? nBub : nBub - 1) : 0;
  // fit the op budget (at least one cut)
  while (flips + nBlow + pops > N - 1) {
    if (pops > 0 && (pops > 1 || rnd() < 0.5)) pops--; else if (nBlow > 1) nBlow--; else if (flips > 1) flips--; else if (pops > 0) pops--; else if (flips + nBlow > N - 1) return null; else break;
  }
  let cuts = N - flips - nBlow - pops;
  let autoCuts = nAuto ? Math.min(nAuto, RI(rnd, 0, Math.min(nAuto, cuts - 1))) : 0;
  let initCuts = cuts - autoCuts;
  if (initCuts > 4) { const extra = initCuts - 4; initCuts = 4; if (nAuto + extra <= 3) { nAuto += extra; autoCuts += extra; } else return null; }
  if (n <= 3) initCuts = 1;
  let R0 = initCuts + (n >= 4 && initCuts < 4 && (n < 12 ? true : rnd() < 0.3) ? 1 : 0);
  if (n >= 4 && n < 12 && R0 < 2) R0 = 2;

  // ---- starting rig ----
  const L = { c: [RI(rnd, 120, 270), RI(rnd, 170, 330)], v: [0, 0], r: [], s: [], f: [-999, -999], b: [], w: [], k: [], a: [], p: [], g: null, h: [], sol: [] };
  const swing = Math.min(1, n / 60);
  const maxAng = Math.min(1.25, 0.12 + n * 0.03);
  for (let i = 0; i < R0; i++) {
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) {
      let ang;
      if (R0 === 1) ang = -Math.PI / 2 + R(rnd, -maxAng, maxAng);
      else ang = -Math.PI / 2 + R(rnd, -1.3, 1.3);
      const len = R(rnd, 70, n < 10 ? 160 : 210);
      const ax = Math.round(L.c[0] + Math.cos(ang) * len), ay = Math.round(L.c[1] + Math.sin(ang) * len);
      if (ax < 24 || ax > 366 || ay < 28 || ay > L.c[1] - 30) continue;
      if (L.r.some(r => Math.hypot(r[0] - ax, r[1] - ay) < 70)) continue;
      const l = Math.round(Math.hypot(L.c[0] - ax, L.c[1] - ay) * 10) / 10;
      L.r.push([ax, ay, l]); ok = true;
    }
    if (!ok) return null;
  }
  if (kinds.has('moving')) {
    const i = RI(rnd, 0, L.r.length - 1), r = L.r[i];
    const dx = (rnd() < 0.5 ? -1 : 1) * RI(rnd, 60, 140);
    let bx = r[0] + dx; if (bx < 24 || bx > 366) bx = r[0] - dx;
    if (bx < 24 || bx > 366) return null;
    r.push(bx, r[1], Math.round(R(rnd, 2.0, 3.6) * 10) / 10);
  }
  const vmax = 20 + 440 * swing;
  if (rnd() < 0.85) { const v = R(rnd, 0, vmax) * (rnd() < 0.5 ? -1 : 1); L.v = [Math.round(v), 0]; }
  if (kinds.has('gravity')) L.g = [0, 0];
  C.normLevel(L);

  // ---- play events ----
  const W = C.newWorld(L); W.ev = [];
  const hist = []; // positions
  const ops = [];
  let lastOp = 0;
  const left = { init: initCuts, auto: autoCuts, pop: pops, blow: nBlow, flip: flips, pBub: nBub, pAuto: nAuto, pPad: nPad, pHat: nHat };
  const valid = w => !w.status && inArea(w.x, w.y);
  function advance(steps) { for (let i = 0; i < steps; i++) { hist.push([W.x, W.y]); C.stepWorld(L, W); if (!valid(W)) return false; } return true; }
  function look(steps) { const w = C.cloneWorld(W), out = []; for (let i = 0; i < steps; i++) { C.stepWorld(L, w); if (!valid(w)) break; out.push([w.x, w.y, w.vx, w.vy]); } return out; }
  const minHist = (P, upto) => { let m = 1e9; const e = upto === undefined ? hist.length : upto; for (let i = 0; i < e; i++) { const d = Math.hypot(hist[i][0] - P[0], hist[i][1] - P[1]); if (d < m) m = d; } return m; };
  function objs() { // every placed thing: [x,y]
    const o = [];
    L.r.forEach(r => { o.push([r[0], r[1]]); if (r.length > 3) o.push([r[3], r[4]]); });
    L.b.forEach(b => o.push(b)); L.w.forEach(w => o.push(w)); L.a.forEach(a => o.push(a));
    L.p.forEach(q => o.push([(q[0] + q[2]) / 2, (q[1] + q[3]) / 2])); L.h.forEach(h => { o.push([h[0], h[1]]); o.push([h[2], h[3]]); });
    return o;
  }
  const clearOf = (P, d) => objs().every(o => dist(o, P) >= d);
  function attachedInit() { const a = []; for (let i = 0; i < L.r.length; i++) if (C.ropeAttached(L, W, i)) a.push(i); return a; }
  function attachedAuto() { const a = []; for (let i = L.r.length; i < C.nRopes(L); i++) if (C.ropeAttached(L, W, i)) a.push(i); return a; }
  function cuttable(i) { // a point on rope i far from the other ropes (so a swipe can isolate it)
    const an = C.anchorAt(L, i, W.t, [0, 0]);
    for (let f = 0.2; f <= 0.75; f += 0.11) {
      const P = [an[0] + (W.x - an[0]) * f, an[1] + (W.y - an[1]) * f];
      let ok = true;
      for (let j = 0; j < C.nRopes(L) && ok; j++) {
        if (j === i || !C.ropeAttached(L, W, j)) continue;
        const b = C.anchorAt(L, j, W.t, [0, 0]);
        if (C.segDist(P[0], P[1], b[0], b[1], W.x, W.y) < 30) ok = false;
      }
      if (ok && Math.hypot(P[0] - W.x, P[1] - W.y) > 30) return true;
    }
    return false;
  }
  const events = ['init', 'auto', 'pop', 'blow', 'flip', 'pBub', 'pAuto', 'pPad', 'pHat'];
  let guard = 0;
  while (events.some(e => left[e] > 0)) {
    if (++guard > 40) return null;
    const lk = look(150);
    const moving = lk.length > 30 && Math.hypot(lk[30][0] - W.x, lk[30][1] - W.y) > 40;
    const feas = events.filter(e => {
      if (!left[e]) return false;
      if (e === 'init') return attachedInit().length > (left.init > 1 ? 0 : 0);
      if (e === 'auto') return attachedAuto().length > 0;
      if (e === 'pop') return W.ib >= 0;
      if (e[0] === 'p') {
        if (!moving) return false;
        if (e === 'pHat' && (attachedInit().length + attachedAuto().length > 0 || left.init + left.auto > 0)) return false;
        const minSp = e === 'pPad' ? 220 : e === 'pAuto' ? 120 : e === 'pHat' ? 100 : 0;
        for (let j = 12; j < Math.min(lk.length, 150); j += 3) if (Math.hypot(lk[j][2], lk[j][3]) >= minSp && minHist(lk[j]) > (e === 'pAuto' ? 70 : 55)) return true;
        return false;
      }
      return true;
    });
    if (!feas.length) return null;
    // keep the last initial rope for later when other things still need to happen while hanging
    const held = attachedInit().length + attachedAuto().length > 0 || W.ib >= 0;
    const wts = feas.map(e => {
      if (e === 'pop') return 1.5;
      if (e[0] === 'p') return held ? 0.6 : 4;
      if (e === 'init' || e === 'auto') {
        const sup = attachedInit().length + attachedAuto().length + (W.ib >= 0 ? 1 : 0);
        const remaining = events.reduce((a, k) => a + left[k], 0);
        return sup <= 1 && remaining > 3 ? 0.12 : 1.2;
      }
      return held ? 1 : 0.8;
    });
    let pick = rnd() * wts.reduce((a, b) => a + b, 0), ei = 0;
    while (ei < feas.length - 1 && (pick -= wts[ei]) > 0) ei++;
    const e = feas[ei];
    if (e[0] === 'p' && e !== 'pop') {
      // ---- passive placement onto the future path ----
      let placed = false;
      const minSp = e === 'pPad' ? 220 : e === 'pAuto' ? 120 : e === 'pHat' ? 100 : 0;
      const elig = [];
      for (let j = 12; j < Math.min(lk.length, 150); j++) if (Math.hypot(lk[j][2], lk[j][3]) >= minSp && Math.hypot(lk[j][0] - W.x, lk[j][1] - W.y) > 50) elig.push(j);
      for (let tr = 0; tr < 40 && !placed && elig.length; tr++) {
        const i = elig[Math.floor(rnd() * elig.length)];
        const P = [lk[i][0], lk[i][1]], V = [lk[i][2], lk[i][3]], sp = Math.hypot(V[0], V[1]);
        const futureMin = (Q, rad) => noRevisit(lk, i, Q, rad);
        if (e === 'pBub') {
          const B = [Math.round(P[0]), Math.round(P[1])];
          if (B[1] > 640 || minHist(B) < 50 || !clearOf(B, 46) || Math.hypot(W.x - B[0], W.y - B[1]) < 50) continue;
          L.b.push(B); placed = 'bubble';
        } else if (e === 'pAuto') {
          if (sp < 120) continue;
          const side = rnd() < 0.5 ? 1 : -1;
          let ux = -V[1] / sp * side, uy = V[0] / sp * side - 0.7; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
          const Rr = RI(rnd, 75, 110);
          const A = [Math.round(P[0] + ux * (Rr - 6)), Math.round(P[1] + uy * (Rr - 6)), Rr];
          if (!inArea(A[0], A[1]) || A[1] > 600 || minHist(A) < Rr + 6 || Math.hypot(W.x - A[0], W.y - A[1]) < Rr + 4 || !clearOf(A, 50)) continue;
          if (!futureMin(A, Rr)) continue;
          L.a.push(A); placed = 'auto';
        } else if (e === 'pPad') {
          if (sp < 220) continue;
          const vx = V[0] / sp, vy = V[1] / sp;
          const M = [P[0] + vx * (C.PAD_D + 3), P[1] + vy * (C.PAD_D + 3)];
          const tilt = R(rnd, -0.45, 0.45), cs = Math.cos(tilt), sn = Math.sin(tilt);
          const tx = -vy * cs - vx * sn, ty = vx * cs - vy * sn, hl = 32;
          const Pd = [Math.round(M[0] - tx * hl), Math.round(M[1] - ty * hl), Math.round(M[0] + tx * hl), Math.round(M[1] + ty * hl)];
          if (!inArea(Pd[0], Pd[1]) || !inArea(Pd[2], Pd[3])) continue;
          let mh = 1e9; for (const q of hist) mh = Math.min(mh, C.segDist(q[0], q[1], Pd[0], Pd[1], Pd[2], Pd[3]));
          if (mh < C.PAD_D + 8 || !clearOf(M, 46)) continue;
          let okf = true; for (let j = 0; j < i - 8; j++) if (C.segDist(lk[j][0], lk[j][1], Pd[0], Pd[1], Pd[2], Pd[3]) < C.PAD_D + 2) { okf = false; break; }
          if (!okf) continue;
          L.p.push(Pd); placed = 'pad';
        } else if (e === 'pHat') {
          if (sp < 100) continue;
          const A = [Math.round(P[0]), Math.round(P[1])];
          if (minHist(A) < 50 || !clearOf(A, 50) || !futureMin(A, C.HAT_D + 2)) continue;
          let B = null;
          for (let t2 = 0; t2 < 30 && !B; t2++) {
            const Q = [RI(rnd, 50, 340), RI(rnd, 90, 560)];
            if (dist(Q, A) < 150 || minHist(Q) < 60 || !clearOf(Q, 60)) continue;
            let okq = true; for (let j = 0; j <= i; j++) if (Math.hypot(lk[j][0] - Q[0], lk[j][1] - Q[1]) < 60) { okq = false; break; }
            if (okq) B = Q;
          }
          if (!B) continue;
          L.h.push([A[0], A[1], B[0], B[1]]); placed = 'hat';
        }
        if (placed) {
          // advance until it triggers
          const evBefore = W.ev.length;
          let trig = false;
          for (let s = 0; s < i + 14; s++) {
            hist.push([W.x, W.y]); C.stepWorld(L, W);
            if (!valid(W)) return null;
            if (W.ev.slice(evBefore).some(ev => ev[0] === placed)) { trig = true; break; }
          }
          if (!trig) return null;
          left[e]--;
        }
      }
      if (!placed) return null;
      continue;
    }
    // ---- an op ----
    const minT = Math.max(lastOp + 42, ops.length ? 0 : (n < 12 ? 120 : 84));
    let done = false;
    const alive = look(330).length;
    for (let tr = 0; tr < 12 && !done; tr++) {
      const gapMax = n < 30 ? 230 : 190;
      const t0 = Math.ceil(Math.max(minT, W.t + 6) / 6) * 6, t1 = Math.min(t0 + gapMax - 42, W.t + alive - 30);
      if (t1 < t0) return null;
      let tgt = t0 + 6 * RI(rnd, 0, Math.floor((t1 - t0) / 6));
      const steps = tgt - W.t;
      if (steps < 1) continue;
      // commit
      const saved = C.cloneWorld(W), savedEv = W.ev.length, savedH = hist.length, savedW = L.w.length;
      const revert = () => { const ev = W.ev; Object.assign(W, saved); W.ev = ev; ev.length = savedEv; hist.length = savedH; L.w.length = savedW; };
      if (!advance(steps)) { revert(); continue; }
      let type, idx;
      if (e === 'init') {
        const at = attachedInit();
        // when other events still need a hanging candy, prefer to keep one rope (unless it's the last op)
        const opts = at.filter(i => cuttable(i));
        if (!opts.length) { revert(); continue; }
        idx = opts[Math.floor(rnd() * opts.length)]; type = 0;
      } else if (e === 'auto') {
        const at = attachedAuto().filter(i => cuttable(i)); if (!at.length) { revert(); continue; } idx = at[0]; type = 0;
      } else if (e === 'pop') { idx = W.ib; type = 1; }
      else if (e === 'flip') { idx = 0; type = 3; }
      else if (e === 'blow') {
        let B = null;
        for (let t2 = 0; t2 < 40 && !B; t2++) {
          const ang = R(rnd, 0, Math.PI * 2), d = R(rnd, 80, 170);
          const Q = [Math.round(W.x + Math.cos(ang) * d), Math.round(W.y + Math.sin(ang) * d)];
          if (Q[0] < 30 || Q[0] > 360 || Q[1] < 60 || Q[1] > 670) continue;
          if (minHist(Q) < 45 || !clearOf(Q, 50)) continue;
          const deg = Math.round(Math.atan2(W.y - Q[1], W.x - Q[0]) * 180 / Math.PI);
          B = [Q[0], Q[1], deg];
        }
        if (!B) { revert(); continue; }
        L.w.push(B); idx = L.w.length - 1; type = 2;
      }
      if (!C.applyOp(L, W, type, idx)) return null;
      const remaining = events.reduce((a, k) => a + left[k], 0) - 1;
      const needLife = remaining <= 0 ? 0 : (left.pBub + left.pAuto + left.pPad + left.pHat > 0 ? 36 : 70);
      if (needLife && look(needLife).length < needLife) { revert(); continue; }
      ops.push([W.t, type, idx]); lastOp = W.t; done = true;
    }
    if (!done) return null;
    left[e]--;
  }
  // ---- fox at the end of the path ----
  const settle = Math.max(lastOp + 36, W.t + 6);
  if (!advance(settle - W.t)) return null;
  const lk = look(220);
  let fi = -1;
  const cands = [];
  for (let i = 0; i < lk.length; i++) {
    const P = lk[i];
    if (P[0] < 45 || P[0] > 345 || P[1] < 150 || P[1] > 630) continue;
    cands.push(i);
  }
  for (let tr = 0; tr < 20 && cands.length; tr++) {
    const i = cands[Math.floor(Math.sqrt(rnd()) * cands.length)];
    const F = [Math.round(lk[i][0]), Math.round(lk[i][1])];
    let ok = minHist(F) > C.FOX_R + 10 && clearOf(F, 60);
    if (ok && !noRevisit(lk, i, F, C.FOX_R + 2)) ok = false;
    // fox body sits below the mouth: keep anchors / gadgets out of it
    if (ok && !objs().every(o => !(Math.abs(o[0] - F[0]) < 50 && o[1] > F[1] - 20 && o[1] < F[1] + 70))) ok = false;
    if (ok) { fi = i; L.f = F; break; }
  }
  if (fi < 0) return null;
  for (let i = 0; i <= fi; i++) hist.push([lk[i][0], lk[i][1]]);
  // ---- stars on the path ----
  const firstOp = ops[0][0];
  const startHist = hist.slice(0, firstOp);
  const pathIdx = []; for (let i = firstOp + 8; i < hist.length - 14; i++) pathIdx.push(i);
  if (pathIdx.length < 10) return null;
  for (let tr = 0; tr < 200 && L.s.length < 3; tr++) {
    const i = pathIdx[Math.floor(rnd() * pathIdx.length)];
    const S = [Math.round(hist[i][0]), Math.round(hist[i][1])];
    if (S[1] < 60 || S[1] > 680 || S[0] < 25 || S[0] > 365) continue;
    if (dist(S, L.f) < 52 || L.s.some(q => dist(q, S) < 50)) continue;
    if (!clearOf(S, 40)) continue;
    let near = false; for (const q of startHist) if (Math.hypot(q[0] - S[0], q[1] - S[1]) < 42) { near = true; break; }
    if (near) continue;
    L.s.push(S);
  }
  if (L.s.length < 3) return null;
  // gravity switch
  if (L.g) {
    let G = null;
    for (let tr = 0; tr < 60 && !G; tr++) {
      const Q = [RI(rnd, 40, 350), RI(rnd, 70, 660)];
      if (minHist(Q) < 60 || !clearOf(Q, 56) || dist(Q, L.f) < 80 || L.s.some(s => dist(s, Q) < 50)) continue;
      G = Q;
    }
    if (!G) return null;
    L.g = G;
  }
  // spikes near the path but off it
  for (let sN = 0; sN < p.spikes; sN++) {
    let ok = false;
    for (let tr = 0; tr < 150 && !ok; tr++) {
      const h = hist[Math.floor(rnd() * hist.length)];
      const ang = R(rnd, 0, Math.PI * 2), off = R(rnd, 45, 110);
      const M = [h[0] + Math.cos(ang) * off, h[1] + Math.sin(ang) * off];
      const ta = R(rnd, 0, Math.PI), hl = R(rnd, 22, 42);
      const K = [Math.round(M[0] - Math.cos(ta) * hl), Math.round(M[1] - Math.sin(ta) * hl), Math.round(M[0] + Math.cos(ta) * hl), Math.round(M[1] + Math.sin(ta) * hl)];
      if (!inArea(K[0], K[1]) || !inArea(K[2], K[3])) continue;
      let mh = 1e9; for (const q of hist) { mh = Math.min(mh, C.segDist(q[0], q[1], K[0], K[1], K[2], K[3])); if (mh < C.SPIKE_D + 14) break; }
      if (mh < C.SPIKE_D + 14) continue;
      const pts = objs().concat(L.s, [L.f]); if (L.g) pts.push(L.g);
      if (pts.some(o => C.segDist(o[0], o[1], K[0], K[1], K[2], K[3]) < 40)) continue;
      if (Math.abs(M[0] - L.f[0]) < 55 && M[1] > L.f[1] - 30 && M[1] < L.f[1] + 75) continue;
      if (L.k.some(k2 => C.segDist(M[0], M[1], k2[0], k2[1], k2[2], k2[3]) < 40)) continue;
      L.k.push(K); ok = true;
    }
    if (!ok) return null;
  }
  L.sol = ops;
  return { L, kinds: [...kinds] };
}

const MAXS = 2600;
function verify(L, ops) { return C.solved3(L, ops, MAXS); }
function measure(L, ops, k) {
  const s0 = ops[k][0];
  const lo = k > 0 ? ops[k - 1][0] + 12 : 48, hi = k < ops.length - 1 ? ops[k + 1][0] - 12 : s0 + 400;
  const test = s => { if (s < lo || s > hi) return false; const o = ops.map(x => x.slice()); o[k][0] = s; return verify(L, o); };
  let a = 0, b = 0;
  while (a < 78 && test(s0 - a - 6)) a += 6;
  while (b < 78 && test(s0 + b + 6)) b += 6;
  // refine edges to single steps
  let l = s0 - a, r = s0 + b;
  if (a < 78) { let x = l; for (let d = 1; d < 6; d++) { if (test(l - d)) x = l - d; else break; } l = x; }
  if (b < 78) { let x = r; for (let d = 1; d < 6; d++) { if (test(r + d)) x = r + d; else break; } r = x; }
  return { lo: l, hi: r, coarse: 1 + a / 6 + b / 6, win: (r - l + 1) * C.DT };
}
function evaluate(cand) {
  const L = cand.L; let ops = L.sol;
  if (!verify(L, ops)) return null;
  // every op is needed
  for (let k = 0; k < ops.length; k++) if (verify(L, ops.filter((_, j) => j !== k))) return null;
  // nothing at all must not win
  // recenter each op inside its window, then measure
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < ops.length; k++) {
      const m = measure(L, ops, k);
      const c = Math.round((m.lo + m.hi) / 2);
      if (c !== ops[k][0]) { const o = ops.map(x => x.slice()); o[k][0] = c; if (verify(L, o)) ops = o; }
    }
  }
  const wins = ops.map((_, k) => measure(L, ops, k));
  if (wins.some(w => w.coarse < 3 || w.win < 0.15)) return null;
  // ops must stay at human pace: >= 0.3 s apart, first >= 0.5 s
  if (ops[0][0] < 60) return null;
  for (let k = 1; k < ops.length; k++) if (ops[k][0] - ops[k - 1][0] < 36) return null;
  for (let k = 0; k < ops.length; k++) if (verify(L, ops.filter((_, j) => j !== k))) return null;
  L.sol = ops;
  const W = C.simulate(L, ops, MAXS);
  const minWin = Math.min(...wins.map(w => w.win));
  const kinds = new Set(['rope']);
  if (L.b.length) kinds.add('bubble'); if (L.w.length) kinds.add('blower'); if (L.k.length) kinds.add('spike'); if (L.a.length) kinds.add('auto');
  if (L.p.length) kinds.add('pad'); if (L.r.some(r => r.length > 3)) kinds.add('moving'); if (L.g) kinds.add('gravity'); if (L.h.length) kinds.add('hat');
  const D = ops.length / minWin * Math.sqrt(kinds.size) * Math.pow(L.k.length + 1, 0.3);
  return { L, D, minWin, wins: wins.map(w => +w.win.toFixed(3)), kinds: [...kinds], ops: ops.length, spikes: L.k.length, endT: +(W.t * C.DT).toFixed(2) };
}

function compact(L) {
  const o = { c: L.c };
  if (L.v[0] || L.v[1]) o.v = L.v;
  o.r = L.r; o.s = L.s; o.f = L.f;
  for (const k of ['b', 'w', 'k', 'a', 'p', 'h']) if (L[k].length) o[k] = L[k];
  if (L.g) o.g = L.g;
  o.sol = L.sol;
  return o;
}

function work(levels, outFile, secsFn) {
  const res = {};
  for (const n of levels) {
    const secs = secsFn(n);
    const p = plan(n), T = targetD(p), t0 = Date.now();
    const list = []; let tries = 0, built = 0;
    while (Date.now() - t0 < secs * 1000) {
      tries++;
      const c = construct(n, n * 100003 + tries * 7919 + (+process.env.SEEDOFF || 0));
      if (!c) continue;
      built++;
      const e = evaluate(c);
      if (!e) continue;
      // keep candidates whose window is near the planned window
      e.ratio = e.minWin / p.win;
      list.push({ D: +e.D.toFixed(4), minWin: +e.minWin.toFixed(3), wins: e.wins, kinds: e.kinds, ops: e.ops, spikes: e.spikes, endT: e.endT, L: compact(e.L) });
      if (n > 11 && !process.env.KEEPALL && list.filter(x => x.D > T * 0.85 && x.D < T * 1.2).length >= 8 && Date.now() - t0 > secs * 300) break;
    }
    list.sort((a, b) => Math.abs(Math.log(a.D / T)) - Math.abs(Math.log(b.D / T)));
    res[n] = list.slice(0, n <= 11 || process.env.KEEPALL ? 400 : 40);
    console.log('L' + n, 'target D', T.toFixed(2), 'win', p.win.toFixed(2), 'tries', tries, 'built', built, 'valid', list.length, 'best', list[0] ? list[0].D + ' win ' + list[0].minWin + ' kinds ' + list[0].kinds.length : '-');
    fs.writeFileSync(outFile, JSON.stringify(res));
  }
}

function select(files) {
  const all = {};
  for (const f of files) { const o = JSON.parse(fs.readFileSync(f, 'utf8')); for (const k in o) all[k] = (all[k] || []).concat(o[k]); }
  // dynamic programming: strictly rising D (>= 1.5 % per level), as close as possible to the planned curve
  const lists = [], cost = [], from = [], STEP = +(process.env.STEP || 1.01);
  for (let n = 1; n <= 100; n++) {
    const T = targetD(plan(n));
    const seen = new Set();
    const l = (all[n] || []).filter(c => { const k = c.D.toFixed(4); if (seen.has(k)) return false; seen.add(k); return true; }).filter(c => {
      const L = C.normLevel(JSON.parse(JSON.stringify(c.L)));
      return verify(L, L.sol) && L.sol.every((_, k) => !verify(L, L.sol.filter((__, j) => j !== k)));
    }).sort((a, b) => a.D - b.D);
    lists.push(l);
    const cs = [], fs2 = [];
    for (let i = 0; i < l.length; i++) {
      const own = Math.abs(Math.log(l[i].D / T));
      if (n === 1) { cs.push(own); fs2.push(-1); continue; }
      let best = Infinity, bj = -1;
      const pl = lists[n - 2], pc = cost[n - 2];
      for (let j = 0; j < pl.length; j++) if (pl[j].D * STEP < l[i].D && pc[j] < best) { best = pc[j]; bj = j; }
      cs.push(best + own); fs2.push(bj);
    }
    cost.push(cs); from.push(fs2);
    if (!cs.some(isFinite)) console.log('NO CHAIN reaching level', n);
  }
  let bi = -1, bc = Infinity;
  cost[99].forEach((c, i) => { if (c < bc) { bc = c; bi = i; } });
  const chosen = new Array(100).fill(null);
  for (let n = 100; n >= 1 && bi >= 0; n--) { chosen[n - 1] = lists[n - 1][bi]; bi = from[n - 1][bi]; }
  if (chosen.some(c => !c)) { console.log('missing:', chosen.map((c, i) => c ? null : i + 1).filter(Boolean).join(',')); return; }
  const lnA = Math.log(chosen[0].D), lnB = Math.log(chosen[99].D);
  const out = chosen.map((c, i) => {
    const L = c.L; L.d = +(1 + 99 * (Math.log(c.D) - lnA) / (lnB - lnA)).toFixed(1); L.wn = Math.round(c.minWin * 1000); return L;
  });
  const html = fs.readFileSync(SRC, 'utf8');
  const txt = 'var LEVELS = [\n' + out.map(l => JSON.stringify(l)).join(',\n') + '\n];';
  fs.writeFileSync(SRC, html.replace(/var LEVELS = \[[\s\S]*?\n\];/, txt));
  console.log('wrote', out.length, 'levels; D', chosen[0].D, '->', chosen[99].D);
  for (const n of [1, 10, 25, 50, 75, 99, 100]) { const c = chosen[n - 1]; console.log('  L' + n, 'diff', out[n - 1].d, 'ops', c.ops, 'minWin', c.minWin, 'kinds', c.kinds.join('+'), 'spikes', c.spikes, 'end', c.endT + 's'); }
}

if (require.main === module) {
  const a = process.argv.slice(2);
  if (a[0] === 'work') { const lv = []; for (let n = +a[1]; n <= +a[2]; n += +(a[5] || 1)) lv.push(n); work(lv, a[3], n => a[4] ? +a[4] : 6 + n * 0.5); }
  else if (a[0] === 'select') select(a.slice(1));
}
module.exports = { plan, targetD, construct, evaluate, measure, verify, C };
