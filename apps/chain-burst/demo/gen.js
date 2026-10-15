// 深海螢光 (chain-burst) level verifier.
// Uses the game's own core (between CORE-START / CORE-END in ../index.html) to grid-search every level:
// 24x40 tap points at tap time 0, full deterministic chain simulation (fixed 1/60 s steps).
// Requires: best count >= target T, and >= 2% of tap points reach T (no pixel-perfect taps).
// Extra fairness check: the level must also stay beatable if the player waits 1, 2 or 3 seconds before tapping
// (best >= T and >= 0.5% winning tap points at frames 60/120/180).
// Also checks the difficulty metric strictly increases level to level.
// Usage: node gen.js            -> verify and print summary
//        node gen.js --fix      -> search SEEDFIX offsets for failing levels and print the table to embed
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(src + '\nreturn {levelParams, difficulty, genLevel, gridSearch, SEEDFIX};')();
const FIX = process.argv.includes('--fix');
const t0 = Date.now(); let allOk = true, allLate = true, prevRaw = 0, mono = true; const rows = [];
for (let L = 1; L <= 100; L++) {
  let a = core.SEEDFIX[L] || 0, r, P, feas, late;
  for (;;) {
    core.SEEDFIX[L] = a;
    const lv = core.genLevel(L); P = lv.P; r = core.gridSearch(lv, 0);
    feas = r.grid.filter(c => c >= P.T).length / r.grid.length;
    late = [60, 120, 180].map(f => { const q = core.gridSearch(lv, f); return { best: q.best, feas: q.grid.filter(c => c >= P.T).length / q.grid.length }; });
    if ((r.best >= P.T && feas >= 0.02 && late.every(q => q.best >= P.T && q.feas >= 0.005)) || !FIX || a > 150) break;
    a++;
  }
  const ok = r.best >= P.T && feas >= 0.02, lateOk = late.every(q => q.best >= P.T && q.feas >= 0.005); if (!ok) allOk = false; if (!lateOk) { allLate = false; console.log('LEVEL', L, 'late-tap window check failed', JSON.stringify(late)); }
  if (P.raw <= prevRaw) mono = false; prevRaw = P.raw;
  const kinds = core.genLevel(L).jellies.reduce((m, j) => (m[j.k] = (m[j.k] || 0) + 1, m), {});
  rows.push({ L, N: P.N, T: P.T, R: P.R, v: P.v, best: r.best, feas, ok, a, kinds, raw: P.raw, lateMin: Math.min(...late.map(q => q.feas)) });
  if (!ok) console.log('LEVEL', L, 'FAILED best', r.best, 'T', P.T, 'feasible', (feas * 100).toFixed(1) + '%');
}
const KN = ['普通', '大型', '盔甲', '暗', '分裂', '吸光'];
console.log('Level  N   T  R(px) v(px/s) 難度  best  可行點擊%  特殊水母');
for (const r of rows) if (r.L <= 3 || r.L % 10 === 0 || [21, 41, 56, 71, 86, 99].includes(r.L))
  console.log(String(r.L).padStart(5), String(r.N).padStart(3), String(r.T).padStart(3), r.R.toFixed(1).padStart(6), r.v.toFixed(0).padStart(6),
    String(core.difficulty(r.L)).padStart(6), String(r.best).padStart(5), (r.feas * 100).toFixed(1).padStart(8),
    '  ' + [1, 2, 3, 4, 5].filter(k => r.kinds[k]).map(k => KN[k] + r.kinds[k]).join(' '));
const minFeas = rows.reduce((m, r) => Math.min(m, r.feas), 1);
console.log('All 100 levels reach target T with a 24x40 grid search:', allOk, '| min feasible tap share', (minFeas * 100).toFixed(1) + '%');
console.log('Still beatable when tapping after 1/2/3 s (frames 60/120/180):', allLate, '| min winning-tap share there', (rows.reduce((m, r) => Math.min(m, r.lateMin), 1) * 100).toFixed(1) + '%');
console.log('Difficulty metric strictly increasing L1..L100:', mono, '| new mechanics at 21/41/56/71/86:',
  [21, 41, 56, 71, 86].map((L, i) => rows[L - 1].kinds[i + 1] > 0 && !(rows[L - 2].kinds[i + 1] > 0)).every(Boolean));
if (FIX) { const fix = {}; rows.forEach(r => { if (r.a) fix[r.L] = r.a; }); console.log('SEEDFIX =', JSON.stringify(fix)); }
console.log('time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
