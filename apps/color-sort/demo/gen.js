// Offline level generator for 鍊金藥劑室 (color-sort). Core logic + schedule are read from ../index.html (CORE-START/END).
// Usage: node gen.js <outdir> <from> <to>      -> writes <outdir>/<L>.json for each level
//        node gen.js --inject <outdir>         -> writes the 100 levels into ../index.html (LEVELS-START/END)
// Deterministic per level: seed = L*6151. Random deal (no 3 same-colour layers in a row), then hill-climb by
// swapping layers until the exact A* optimum equals round(csTarget(L)). Unsolvable deals are rejected.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {csParams, csTarget, csDiffRaw, csInit, csSolve, csWon};')();

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const has3 = t => { for (let j = 2; j < t.length; j++) if (t[j] === t[j - 1] && t[j] === t[j - 2]) return true; return false; };

function deal(P, rnd) {
  for (;;) {
    const L = []; for (let c = 0; c < P.K; c++) for (let j = 0; j < P.n; j++) L.push(c);
    for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; }
    const caps = P.colCaps.slice();
    for (let i = caps.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [caps[i], caps[j]] = [caps[j], caps[i]]; }
    const amt = caps.slice(); let slack = caps.reduce((a, b) => a + b, 0) - L.length;
    while (slack > 0) { const i = Math.floor(rnd() * caps.length); if (amt[i] > Math.max(3, caps[i] - 2)) { amt[i]--; slack--; } }
    const tubes = []; let p = 0; for (const a of amt) { tubes.push(L.slice(p, p + a)); p += a; }
    if (tubes.some(has3)) continue;
    const fz = caps.map(() => 0);
    const idx = caps.map((_, i) => i).filter(i => tubes[i].length >= 3);
    P.fz.forEach(v => { const k = Math.floor(rnd() * idx.length); fz[idx.splice(k, 1)[0]] = v; });
    return { tubes, caps, fz };
  }
}
function toLevel(P, d) {
  return {
    tubes: d.tubes.map(t => t.map(c => String.fromCharCode(97 + c)).join('')).concat(P.empCaps.map(() => '')),
    caps: d.caps.concat(P.empCaps), fz: d.fz.concat(P.empCaps.map(() => 0)), hid: []
  };
}
function evaluate(P, d, limit) {
  const D = toLevel(P, d);
  const r = core.csSolve(core.csInit(D), { limit });
  if (!r) return { len: -1 };
  return r;
}
function mutate(d, rnd) {
  for (let tries = 0; tries < 50; tries++) {
    const nd = { tubes: d.tubes.map(t => t.slice()), caps: d.caps, fz: d.fz };
    const ta = Math.floor(rnd() * nd.tubes.length), tb = Math.floor(rnd() * nd.tubes.length);
    const A = nd.tubes[ta], B = nd.tubes[tb]; if (!A.length || !B.length) continue;
    const ia = Math.floor(rnd() * A.length), ib = Math.floor(rnd() * B.length);
    if (A[ia] === B[ib]) continue;
    const t = A[ia]; A[ia] = B[ib]; B[ib] = t;
    if (has3(A) || has3(B)) continue;
    return nd;
  }
  return null;
}
function gen(L) {
  const P = core.csParams(L), T = Math.round(core.csTarget(L));
  const limit = L >= 71 ? 900000 : L >= 41 ? 600000 : 300000;
  const t0 = Date.now(); let evals = 0, best = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const rnd = mulberry32(L * 6151 + attempt * 7919);
    let d = deal(P, rnd), cur = evaluate(P, d, limit); evals++;
    let tries = 0;
    while (cur.len < 0 && tries++ < 40) { d = deal(P, rnd); cur = evaluate(P, d, limit); evals++; }
    if (cur.len < 0) continue;
    const dist = r => r.len < 0 ? 1e9 : Math.abs(r.len - T);
    for (let it = 0; it < 120 && dist(cur) > 0; it++) {
      const nd = mutate(d, rnd); if (!nd) break;
      const r = evaluate(P, nd, limit); evals++;
      if (dist(r) <= dist(cur)) { d = nd; cur = r; }
    }
    if (!best || dist(cur) < dist(best.r)) best = { d, r: cur, attempt };
    if (dist(cur) === 0) break;
  }
  const { d, r } = best;
  const D = toLevel(P, d);
  // hidden layers: a fraction of the non-top layers of the coloured tubes
  const rnd = mulberry32(L * 6151 + 99991);
  const slots = []; d.tubes.forEach((t, i) => { for (let j = 0; j < t.length - 1; j++) slots.push([i, j]); });
  const nh = Math.round(P.hid * slots.length);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  const hid = D.caps.map(() => 0); slots.slice(0, nh).forEach(([i, j]) => { hid[i] |= 1 << j; });
  return {
    L, t: D.tubes.join('/'), c: D.caps.join(''), h: hid.map(x => x.toString(36)).join(','), f: D.fz.join(''), p: r.len,
    target: T, hidden: nh, attempt: best.attempt, evals, ms: Date.now() - t0
  };
}

const args = process.argv.slice(2);
if (args[0] === '--inject') {
  const dir = args[1], out = [];
  for (let L = 1; L <= 100; L++) { const o = JSON.parse(fs.readFileSync(path.join(dir, L + '.json'), 'utf8')); out.push({ t: o.t, c: o.c, h: o.h, f: o.f, p: o.p }); }
  const js = '[\n' + out.map(o => JSON.stringify(o)).join(',\n') + '\n]';
  const nh = html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, '/*LEVELS-START*/' + js + '/*LEVELS-END*/');
  fs.writeFileSync(APP, nh); console.log('injected', out.length, 'levels,', nh.length, 'bytes');
} else {
  const dir = args[0], from = +args[1], to = +args[2];
  fs.mkdirSync(dir, { recursive: true });
  for (let L = from; L <= to; L++) {
    const o = gen(L);
    fs.writeFileSync(path.join(dir, L + '.json'), JSON.stringify(o));
    console.log('L' + L, 'opt', o.p, 'target', o.target, o.p === o.target ? 'OK' : 'MISS', 'evals', o.evals, (o.ms / 1000).toFixed(1) + 's');
  }
}
