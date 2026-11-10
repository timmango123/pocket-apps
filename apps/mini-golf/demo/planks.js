// Angled planks (d.a = [[x1,y1,x2,y2], ...]): two-sided wooden boards at 30-60 degrees, so mid and late holes are not
// only right-angle corridors. Used by gen.js (GEN_PLANKS=1 when regenerating) and, run directly, to add planks to the
// already baked holes without changing them otherwise:
//   node planks.js [from] [to] [max]   -> tries holes from..to (default 56..98, skipping the tier test holes 75 and 99),
//   keeps a plank only if the hole stays connected and the solver still needs exactly the same number of strokes,
//   and writes the re-solved solution back into ../index.html (par, difficulty metric and everything else unchanged).
const fs = require('fs'), path = require('path');
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function connected(C, d) {
  const L = C.buildLevel(d), fo = C.distField(L, true, d.hole[0], d.hole[1]);
  if (C.fieldAt(fo, d.tee[0], d.tee[1]) >= 1e8) return false;
  if (d.s && d.s.length) { const f2 = C.distField(L, false, d.s[0][0], d.s[0][1]); if (C.fieldAt(f2, d.tee[0], d.tee[1]) >= 1e8) return false; }
  return true;
}
// a 45-degree board across the outer corner of a turn (a square cell open on exactly two neighbouring sides)
function cornerPlank(C, d, rnd) {
  const L = C.buildLevel(d), cells = d.f.filter(f => f[2] === f[3] && f[2] >= 24);
  const pts = [d.tee, d.hole].concat(d.s || [], (d.b || []).map(b => [b[0], b[1]]), (d.w || []).map(w => [w[0], w[1]]), (d.m || []).map(m => [m[0], m[1]]), (d.p || []).map(p => [p[0], p[1]]), (d.p || []).map(p => [p[2], p[3]]));
  const order = cells.map(c => [rnd(), c]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  for (const c of order) {
    const x0 = c[0], y0 = c[1], w = c[2], cx = x0 + w / 2, cy = y0 + w / 2;
    if ((d.z || []).some(z => z[1] < x0 + w && z[1] + z[3] > x0 && z[2] < y0 + w && z[2] + z[4] > y0)) continue;
    const open = { l: !C.isSolidAt(L, x0 - 3, cy), r: !C.isSolidAt(L, x0 + w + 3, cy), u: !C.isSolidAt(L, cx, y0 - 3), d: !C.isSolidAt(L, cx, y0 + w + 3) };
    if ((open.l === open.r) || (open.u === open.d)) continue; // need exactly one horizontal and one vertical opening
    const kx = open.r ? x0 : x0 + w, ky = open.d ? y0 : y0 + w, sx = open.r ? 1 : -1, sy = open.d ? 1 : -1, len = Math.round(w * 0.42);
    const a = [kx + sx * len, ky + sy * 1, kx + sx * 1, ky + sy * len];
    const mx = (a[0] + a[2]) / 2, my = (a[1] + a[3]) / 2;
    if (pts.some(p => Math.hypot(p[0] - mx, p[1] - my) < 18)) continue;
    const d2 = Object.assign({}, d, { a: (d.a || []).concat([a]) });
    if (connected(C, d2)) return d2;
  }
  return null;
}
// try to place one plank: across the outer corner of a turn, else inside a room cell (a fairway square of 40 px or
// more), clear of every feature
function placePlanks(C, d, n, rnd) {
  const cp = cornerPlank(C, d, rnd); if (cp) return cp;
  const rooms = d.f.filter(f => f[2] === f[3] && f[2] >= 40);
  const pts = [d.tee, d.hole].concat((d.p || []).map(p => [p[0], p[1]]), (d.p || []).map(p => [p[2], p[3]]), d.s || [], (d.w || []).map(w => [w[0], w[1]]), (d.m || []).map(m => [m[0], m[1]]), (d.b || []).map(b => [b[0], b[1]]), (d.q || []).map(q => [q[0] + q[2] / 2, q[1] + q[3] / 2]));
  for (let t = 0; t < 40 && rooms.length; t++) {
    const r = rooms[Math.floor(rnd() * rooms.length)], cx = Math.round(r[0] + r[2] * (0.3 + 0.4 * rnd())), cy = Math.round(r[1] + r[3] * (0.3 + 0.4 * rnd()));
    if (pts.some(p => Math.hypot(p[0] - cx, p[1] - cy) < 24)) continue;
    if ((d.z || []).some(z => cx > z[1] - 10 && cx < z[1] + z[3] + 10 && cy > z[2] - 10 && cy < z[2] + z[4] + 10)) continue;
    const ang = (rnd() < 0.5 ? 1 : -1) * (Math.PI / 6 + rnd() * Math.PI / 6) + (rnd() < 0.5 ? 0 : Math.PI / 2), half = 9 + Math.round(rnd() * 4);
    const a = [cx - Math.cos(ang) * half, cy - Math.sin(ang) * half, cx + Math.cos(ang) * half, cy + Math.sin(ang) * half].map(v => Math.round(v * 2) / 2);
    const L = C.buildLevel(d); let clear = true;
    for (let k = 0; k <= 8 && clear; k++) { const x = a[0] + (a[2] - a[0]) * k / 8, y = a[1] + (a[3] - a[1]) * k / 8; for (const [ox, oy] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]]) if (C.isSolidAt(L, x + ox, y + oy)) clear = false; }
    if (!clear) continue;
    const d2 = Object.assign({}, d, { a: (d.a || []).concat([a]) });
    if (!connected(C, d2)) continue;
    return d2;
  }
  return null;
}
module.exports = { placePlanks };

if (require.main === module) {
  const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
  let html = fs.readFileSync(APP, 'utf8');
  const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {buildLevel,initState,simShot,solveLevel,replay,makeHeur,distField,fieldAt,isSolidAt,cloneState};')();
  const from = +(process.argv[2] || 56), to = +(process.argv[3] || 98), max = +(process.argv[4] || 8), skip = [75, 99, 100, 50];
  const m = html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//); const lines = m[1].split('\n'); let done = 0;
  for (let n = from; n <= to && done < max; n++) {
    if (skip.includes(n)) continue;
    const i = lines.findIndex(s => s.replace(/^\[/, '').startsWith('{"n":' + n + ',')); const pre = lines[i].startsWith('[') ? '[' : '', post = lines[i].endsWith(',') ? ',' : (lines[i].endsWith(']') ? ']' : '');
    const d = JSON.parse(lines[i].slice(pre.length, lines[i].length - post.length)); if (d.a) continue;
    const d2 = placePlanks(C, d, n, mulberry32(n * 7919 + 17)); if (!d2) { console.log('hole', n, 'no room for a plank'); continue; }
    const L = C.buildLevel(d2), o = L.dyn ? { angStep: 4, pows: [0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.85, 1], beam: 8, phases: 6, refine: 10 } : { angStep: 3, beam: 10, refine: 12 };
    o.maxDepth = d.best; const t0 = Date.now(); const r = C.solveLevel(L, o);
    if (!r || r.strokes !== d.best) { console.log('hole', n, 'plank changes the stroke count (' + (r ? r.strokes : 'none') + ' vs ' + d.best + '), skipped'); continue; }
    const rp = C.replay(L, r.shots); if (!rp.holed || rp.strokes !== d.best) { console.log('hole', n, 'replay mismatch'); continue; }
    // the plank must matter: the old solution no longer works as it was
    d2.sol = r.shots; lines[i] = pre + JSON.stringify(d2) + post; done++;
    console.log('hole', n, 'plank', JSON.stringify(d2.a), 'best', r.strokes, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  html = html.replace(m[1], lines.join('\n')); fs.writeFileSync(APP, html); console.log('planks added to', done, 'holes');
}
