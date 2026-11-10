// Re-solve one hole after a hand edit (same solver settings as apps/mini-golf/demo/gen.js) and write it back into
// apps/mini-golf/index.html if it still needs exactly the same best stroke count (so par and the difficulty metric stay).
// node retune.js <hole> '<json patch of level fields>' [--write]
const fs = require('fs'), L = require('./lib.js'), C = L.C;
const n = +process.argv[2], patch = JSON.parse(process.argv[3] || '{}'), write = process.argv.includes('--write');
const d = Object.assign(JSON.parse(JSON.stringify(L.LEVELS[n - 1])), patch);
const Lv = C.buildLevel(d);
const o = Lv.dyn ? { angStep: 4, pows: [0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.85, 1], beam: 8, phases: 6, refine: 10 } : { angStep: 3, beam: 10, refine: 12 };
o.maxDepth = 5; const t0 = Date.now();
const r = C.solveLevel(Lv, o);
if (!r) { console.log('no solution'); process.exit(1); }
const rp = C.replay(Lv, r.shots);
console.log('hole', n, 'best', r.strokes, '(was', L.LEVELS[n - 1].best + ')', 'replay', rp.holed, rp.strokes, ((Date.now() - t0) / 1000).toFixed(0) + 's');
const force = process.argv.includes('--force');
if (!rp.holed || rp.strokes !== r.strokes || (r.strokes !== L.LEVELS[n - 1].best && !force)) { console.log('not written: stroke count changed (use --force to accept; par follows best, num is kept)'); process.exit(2); }
d.sol = r.shots;
if (r.strokes !== d.best) { d.best = r.strokes; d.par = r.strokes + 1; d.rt = 1; } // retuned: par = best+1, displayed difficulty (num) kept
if (write) {
  let html = fs.readFileSync(L.APP, 'utf8');
  const m = html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//); const lines = m[1].split('\n');
  const i = lines.findIndex(s => s.startsWith('{"n":' + n + ','));
  lines[i] = JSON.stringify(d) + (lines[i].endsWith(',') ? ',' : (lines[i].endsWith(']') ? ']' : ''));
  html = html.replace(m[1], lines.join('\n')); fs.writeFileSync(L.APP, html); console.log('written');
}
