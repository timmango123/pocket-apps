// Computes, for every level, how strong the wind may blow each way while a standard-shell direct hit
// (integer angle 0-150 deg, power 1-100 %) still exists from the player's tower, and writes WINDCAP into index.html.
// Usage: node gen-windcap.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
let html = fs.readFileSync(APP, 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {genWorld, simulate};')();
const ANG = []; for (let a = 60; a <= 150; a++) ANG.push(a); for (let a = 59; a >= 0; a--) ANG.push(a);
// clouds move, so a shot counts if it works at one of several launch times within a turn (the player can wait)
function hits(W, w) { const T0 = W.clouds.length ? [2, 4.5, 7] : [2]; for (const t0 of T0) for (const a of ANG) for (let p = 100; p >= 1; p--) { const r = C.simulate(W, 0, a, p, 'std', w, null, t0); if (r.ev === 'tower' && r.hit === 1) return true; } return false; }
const caps = [];
for (let n = 1; n <= 100; n++) {
  const W = C.genWorld(n), R = Math.round(W.P.wind), cap = [];
  for (const sg of [-1, 1]) {
    let a = 0;
    if (hits(W, sg * R)) a = R;
    else { let b = R; while (b - a > 2) { const m = Math.round((a + b) / 2); if (hits(W, sg * m)) a = m; else b = m; } }
    // make sure every wind inside the cap works (step 4); shrink if a gap is found
    for (let w = a; w > 0; w -= 4) if (!hits(W, sg * w)) a = w - 4;
    cap.push(Math.max(0, a));
  }
  caps.push(cap); process.stdout.write(n + ':' + cap.join('/') + ' ');
}
html = html.replace(/var WINDCAP = \[[^\n]*\];/, 'var WINDCAP = ' + JSON.stringify(caps) + ';');
fs.writeFileSync(APP, html);
console.log('\nwritten', caps.length, 'levels; min caps', Math.min(...caps.map(c => Math.min(...c))));
