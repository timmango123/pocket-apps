// Checks the game's own generator (extracted via CORE markers):
// ΔE correctness, quantization (8-bit) still differs, ΔE within [0.8,1.25]×target, odd position uniform, difficulty monotone.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {genQuestion, rgb8ToLab, deltaE, targetDE, kFor, mulberry32, rgbToLab, labToRgb, diffLevel, gradOff, hueRot};')();
let fail = 0;
// 1) Lab conversion sanity: white, black, known reference (sRGB red -> L 53.24 a 80.09 b 67.20)
const near = (a, b, e) => Math.abs(a - b) < e;
const red = C.rgbToLab([1, 0, 0]), white = C.rgbToLab([1, 1, 1]);
if (!(near(red[0], 53.24, 0.05) && near(red[1], 80.09, 0.1) && near(red[2], 67.20, 0.1))) { fail++; console.log('red lab wrong', red); }
if (!(near(white[0], 100, 0.01) && near(white[1], 0, 0.01) && near(white[2], 0, 0.01))) { fail++; console.log('white lab wrong', white); }
let rt = 0; for (let i = 0; i < 2000; i++) { const c = [Math.random(), Math.random(), Math.random()]; const b = C.labToRgb(C.rgbToLab(c)); rt = Math.max(rt, ...b.map((v, j) => Math.abs(v - c[j]))); }
console.log('Lab round-trip max error', rt.toExponential(2));
if (rt > 1e-5) fail++;
// 2) every question q=0..80 per mode, many seeds
const modes = ['classic', 'hue', 'gray'];
const stats = {};
for (const mode of modes) {
  let n = 0, minRatio = 9, maxRatio = 0, sameQuant = 0, deErr = 0, grayBad = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = C.mulberry32(seed * 7919);
    for (let q = 0; q <= 80; q++) {
      const Q = C.genQuestion(q, rng, { mode, kmax: 9 });
      n++;
      const ref = Q.grad ? Q.base : Q.cells[(Q.odd + 1) % Q.n];
      const de = C.deltaE(C.rgb8ToLab(Q.diff), C.rgb8ToLab(Q.base));
      if (Math.abs(de - Q.dE) > 1e-9) deErr++;
      if (!Q.grad && ref.join() !== Q.base.join()) deErr++;
      if (Q.diff.every((v, i) => v === Q.base[i])) sameQuant++;
      const r = de / Q.target; minRatio = Math.min(minRatio, r); maxRatio = Math.max(maxRatio, r);
      if (mode === 'gray' && (Q.diff[0] !== Q.diff[1] || Q.diff[1] !== Q.diff[2] || Q.base[0] !== Q.base[2])) grayBad++;
      if (mode === 'hue' && Math.abs(C.rgb8ToLab(Q.diff)[0] - C.rgb8ToLab(Q.base)[0]) > 0.5 * de + 0.6) grayBad++;
      // odd cell must be the unique outlier vs its local reference: all other cells differ from odd by more than... (non-grad: all identical)
      if (!Q.grad) { for (let i = 0; i < Q.n; i++) if (i !== Q.odd && Q.cells[i].join() !== Q.base.join()) deErr++; }
    }
  }
  stats[mode] = { questions: n, dE_err: deErr, quantSame: sameQuant, ratioMin: minRatio.toFixed(3), ratioMax: maxRatio.toFixed(3), modeViolations: grayBad };
  if (deErr || sameQuant || minRatio < 0.8 || maxRatio > 1.25 || grayBad) fail++;
}
console.table(stats);
// 3) odd position uniformity (chi-square) on k=6 boards (q=12..14)
const k = 6, cnt = new Array(36).fill(0), rng = C.mulberry32(42), N = 36000;
for (let i = 0; i < N; i++) { const Q = C.genQuestion(12, rng, { mode: 'classic', kmax: 9 }); cnt[Q.odd]++; }
const exp = N / 36, chi = cnt.reduce((s, c) => s + (c - exp) ** 2 / exp, 0);
console.log('odd-position chi-square (35 dof, 99.9% crit 66.6):', chi.toFixed(1), 'min/max count', Math.min(...cnt), Math.max(...cnt));
if (chi > 66.6) fail++;
// 4) difficulty curve
const rows = [];
for (const q of [0, 5, 10, 15, 20, 25, 30, 40, 50, 52, 60, 80]) rows.push({ q, k: C.kFor(q, 9), targetDE: C.targetDE(q).toFixed(2), 難度: C.diffLevel(q) });
console.table(rows);
for (let q = 1; q < 120; q++) if (C.targetDE(q) > C.targetDE(q - 1) || C.kFor(q, 9) < C.kFor(q - 1, 9)) fail++;
// 5) gradient interference present from q>=40
const g = C.genQuestion(45, C.mulberry32(5), { mode: 'classic', kmax: 9 });
const uniq = new Set(g.cells.map(c => c.join())).size;
console.log('q=45 gradient interference: distinct cell colours on board', uniq, 'of', g.n);
console.log(fail ? 'CORE CHECK FAILED (' + fail + ')' : 'CORE CHECK PASSED');
process.exit(fail ? 1 : 0);
