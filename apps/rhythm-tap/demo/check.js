// Chart playability + difficulty check for 合成波節拍 (rhythm-tap), using the game's own core code (CORE-START/END).
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const RT = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn RT;')();
let ok = true, prevD = 0, minStep = 9, minStepAt = 0, firsts = {}, rows = [];
for (let L = 1; L <= 100; L++) {
  const C = RT.build(L), M = RT.measure(C), K = RT.check(C), P = C.P;
  const has = { hold: M.holds > 0, dbl: M.dblNotes > 0, swing: C.swingPhrases > 0, swipe: M.swipes > 0, shift: C.shiftT > 0, hidden: P.hidden };
  for (const k in has) if (has[k] && !firsts[k]) firsts[k] = L;
  const step = prevD ? M.D / prevD : 0;
  if (prevD && step < minStep) { minStep = step; minStepAt = L; }
  if (!K.ok) { ok = false; console.log('L' + L + ' FAILS playability', JSON.stringify(K)); }
  if (prevD && M.D <= prevD) { ok = false; console.log('L' + L + ' NOT harder than L' + (L - 1), M.D.toFixed(1), '<=', prevD.toFixed(1)); }
  // also verify practice-speed chart is the same chart slowed down
  if (L % 25 === 0) { const Cp = RT.build(L, { rate: 0.75 }); if (Cp.notes.length !== C.notes.length) { ok = false; console.log('practice chart mismatch L' + L); } }
  prevD = M.D;
  rows.push({ L, bpm: P.bpm + (C.bpm2 ? '->' + C.bpm2 : ''), notes: M.N, npb: M.npb.toFixed(2), designNpb: P.npb.toFixed(2), holds: M.holds, dbl: M.dblNotes, swipes: M.swipes, swingPh: C.swingPhrases, D: M.D.toFixed(0), diff: RT.diffOf(L), dur: C.dur.toFixed(0), minGap: (K.minLaneGap * 1000).toFixed(0), simul: K.maxSimul, dropped: C.dropped });
}
const pick = process.argv.includes('--all') ? rows : rows.filter(r => [1, 2, 15, 16, 30, 31, 45, 46, 55, 56, 61, 70, 71, 85, 86, 95, 99, 100].includes(r.L));
console.table(pick);
console.log('Mechanics first appear at:', JSON.stringify(firsts));
console.log('Smallest level-to-level difficulty increase: x' + minStep.toFixed(3) + ' (at L' + minStepAt + ')');
console.log('Difficulty L1 -> L100:', rows[0].D, '->', rows[99].D, ' (display 1-100:', rows[0].diff, '->', rows[99].diff + ')');
console.log(ok ? 'ALL 100 LEVELS PASS: lane gap >= 120ms, <= 2 simultaneous presses, no hold conflicts, doubles split across hands, strictly increasing difficulty.' : 'SOME CHECKS FAILED');
process.exitCode = ok ? 0 : 1;
