// node trace.js <tier> <hole> [seed] : one sim attempt with per-stroke log (plan kind, noise, result, position)
const K = require('./tiers-core.js'), L = require('./lib.js'), C = L.C;
const tier = process.argv[2], n = +process.argv[3], seed = +(process.argv[4] || 1);
const d = L.LEVELS[n - 1], Lv = C.buildLevel(d), r = K.rng(seed); let S = C.initState(Lv), strokes = 0; const lim = d.par + 4;
const H = C.makeHeur(Lv);
while (strokes < lim) {
  const t0 = Date.now(); const sh = K.plan(tier, Lv, S, lim - strokes, r); const ns = K.noisy(tier, sh, r);
  if (ns.cancel) continue;
  // ideal outcome
  const I = C.cloneState(S); I.t = sh.t; const ri = C.simShot(Lv, I, sh.ang, sh.pow, null);
  if (Lv.dyn) { let t = ns.t; while (t < S.t) t += Lv.P; S.t = t; } else S.t += 60;
  strokes++; const res = C.simShot(Lv, S, ns.ang, ns.pow, null);
  console.log(strokes, sh.kind, 'dt', ns.t - sh.t, 'ideal', ri, Math.round(H(I)), '-> got', res, Math.round(S.x), Math.round(S.y), 'h', Math.round(H(S)), ((Date.now() - t0) / 1000).toFixed(1) + 's');
  if (res === 2) break;
  if (res === 3) strokes++;
}
