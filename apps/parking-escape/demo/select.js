// Picks the 100 levels (+ daily-challenge pool) from generator pools and embeds them into ../index.html.
// Every chosen level is re-solved with the game's own BFS (core extracted from index.html);
// min moves are non-decreasing and the difficulty index strictly increases level by level.
// Usage: node select.js <poolDir>
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const C = require('./gen.js').loadCore();
const dir = process.argv[2];
const load = f => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
const uniq = a => { const s = new Set(); return a.filter(r => !s.has(r.code) && s.add(r.code)); };
const pools = {
  tut: uniq(load('tut.jsonl')), cars6: uniq(load('cars6.jsonl')), truck6: uniq(load('truck6.jsonl')),
  pil6: uniq(load('pil6.jsonl')), big7: uniq(fs.readdirSync(dir).filter(f => /^big7.*\.jsonl$/.test(f)).flatMap(f => load(f))),
};
function info(r) {
  const B = C.parseBoard(r.code);
  r.cars = B.cars.length; r.trucks = B.cars.filter(k => k.len === 3).length; r.pil = B.walls.reduce((a, b) => a + b, 0);
  return r;
}
Object.values(pools).forEach(p => p.forEach(info));
// target minimum moves: piecewise-linear anchors (non-decreasing)
const ANCH = JSON.parse(process.env.ANCH || '[[1,2],[2,3],[3,4],[4,4],[10,10],[11,10],[40,24],[41,24],[70,33],[71,34],[80,38],[81,38],[90,42],[91,42],[100,46]]');
function target(L) { for (let i = 1; i < ANCH.length; i++) { const [a, ma] = ANCH[i - 1], [b, mb] = ANCH[i]; if (L <= b) return Math.round(ma + (mb - ma) * (L - a) / Math.max(1, b - a)); } return ANCH[ANCH.length - 1][1]; }
const carTarget = L => L <= 3 ? 3 : Math.min(L > 70 ? 18 : 14, 8 + Math.floor(L / 10));
const PH = [[1, 3, 'tut'], [4, 10, 'cars6'], [11, 40, 'truck6'], [41, 70, 'pil6'], [71, 80, 'big7'], [81, 90, 'big7ow'], [91, 100, 'big7all']];
const used = new Set();
function withOneWay(r, needDistinct) {
  const B = C.parseBoard(r.code), sol = C.solve(B, B.start);
  if (!sol || sol.len !== r.m) return null;
  const s = B.start.slice(), dirs = {}, moved = {};
  for (const [i, v] of sol.path) { const d = Math.sign(v - s[i]); (dirs[i] = dirs[i] || new Set()).add(d); moved[i] = (moved[i] || 0) + 1; s[i] = v; }
  const distinct = Object.keys(moved).length;
  if (needDistinct && distinct < 6) return null;
  const mono = Object.keys(dirs).map(Number).filter(i => i > 0 && dirs[i].size === 1).sort((a, b) => moved[b] - moved[a]);
  if (mono.length < 2) return null;
  const pick = mono.slice(0, Math.min(3, mono.length));
  pick.forEach(i => { B.cars[i].ow = [...dirs[i]][0]; });
  const code = C.encodeBoard(B, B.start), B2 = C.parseBoard(code), s2 = C.solve(B2, B2.start);
  if (!s2 || s2.len !== r.m) return null;
  return Object.assign({}, r, { code, R: C.reachCount(B2, B2.start), ow: pick.length, distinct });
}
function D(r) { return C.rawDifficulty(C.parseBoard(r.code), r.m, r.R); }
const levels = []; let prevD = 0, prevM = 0;
for (const [a, b, ph] of PH) {
  const base = ph.startsWith('big7') ? pools.big7 : pools[ph];
  let cands = base.filter(r => !used.has(r.code));
  if (ph === 'truck6') cands = cands.filter(r => r.trucks >= (a >= 21 ? 2 : 1));
  if (ph === 'pil6') cands = cands.filter(r => r.pil >= 1 && r.trucks >= 1);
  if (ph === 'big7all') cands = cands.filter(r => r.pil >= 1 && r.trucks >= 1);
  for (let L = a; L <= b; L++) {
    const t = target(L), tc = carTarget(L);
    let pool = cands.filter(r => !used.has(r.code) && r.m >= Math.max(prevM, t - 1) && r.m <= t + 1);
    if (L <= 3) pool = cands.filter(r => !used.has(r.code) && r.cars === L + 1 && r.m === t);
    pool.sort((x, y) => (Math.abs(x.m - t) - Math.abs(y.m - t)) || (Math.abs(x.cars - tc) - Math.abs(y.cars - tc)) || (x.R - y.R));
    let pick = null;
    for (const r0 of pool) {
      let r = r0;
      if (ph === 'big7ow' || ph === 'big7all') { r = withOneWay(r0, ph === 'big7all'); if (!r) { used.add(r0.code); continue; } }
      const d = D(r);
      if (d <= prevD + 0.06) continue;
      if (!pick || Math.abs(r.m - t) < Math.abs(pick.r.m - t) || (Math.abs(r.m - t) === Math.abs(pick.r.m - t) && d < pick.d)) pick = { r, d };
      if (pool.length > 400 && pick && Math.abs(pick.r.m - t) === 0) break;
    }
    if (!pick) { // relax: anything harder
      const more = cands.filter(r => !used.has(r.code) && r.m >= prevM).sort((x, y) => x.m - y.m || x.R - y.R);
      for (const r0 of more) { let r = r0; if (ph === 'big7ow' || ph === 'big7all') { r = withOneWay(r0, ph === 'big7all'); if (!r) continue; } const d = D(r); if (d > prevD + 0.06) { pick = { r, d }; break; } }
    }
    if (!pick) { console.log('NO CANDIDATE for level', L, 'target', t); process.exit(1); }
    used.add(pick.r.code); used.add(pick.r.code.split('|')[0]);
    const B = C.parseBoard(pick.r.code), sol = C.solve(B, B.start);
    if (!sol || sol.len !== pick.r.m) { console.log('SOLVE MISMATCH', L); process.exit(1); }
    const R = C.reachCount(B, B.start), d = C.rawDifficulty(B, sol.len, R);
    if (d <= prevD) { console.log('not increasing', L); process.exit(1); }
    levels.push({ L, code: pick.r.code, m: sol.len, sol: C.encodeSol(sol.path), R, D: d, cars: B.cars.length, t });
    prevD = d; prevM = sol.len;
  }
}
// daily pool: deep 6x6 puzzles (25+ moves) not used as levels
const daily = pools.pil6.concat(pools.truck6).filter(r => r.m >= 25 && r.m <= 34 && !used.has(r.code)).sort((a, b) => a.code < b.code ? -1 : 1);
const dsel = []; for (let i = 0; i < daily.length && dsel.length < 40; i += Math.max(1, Math.floor(daily.length / 40))) dsel.push(daily[i]);
const D1 = levels[0].D, D100 = levels[levels.length - 1].D;
const norm = d => Math.round((1 + 99 * (d - D1) / (D100 - D1)) * 10) / 10;
let prevN = 0; levels.forEach(l => { l.diff = norm(l.D); if (l.diff <= prevN) { console.log('rounded difficulty not increasing at', l.L); process.exit(1); } prevN = l.diff; });
const dailyOut = dsel.map(r => { const B = C.parseBoard(r.code), s = C.solve(B, B.start); return [r.code, s.len, C.encodeSol(s.path), r.R, Math.min(100, norm(C.rawDifficulty(B, s.len, r.R)))]; });
const out = 'var LEVELS = [\n' + levels.map(l => JSON.stringify([l.code, l.m, l.sol, l.R, l.diff])).join(',\n') + '\n];\nvar DAILY = [\n' + dailyOut.map(x => JSON.stringify(x)).join(',\n') + '\n];\n';
let html = fs.readFileSync(APP, 'utf8');
html = html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, () => '/*LEVELS-START*/\n' + out + '/*LEVELS-END*/');
fs.writeFileSync(APP, html);
console.log(levels.map(l => `L${l.L}:m${l.m}(t${l.t}) c${l.cars} d${l.diff}`).join('  '));
console.log('daily pool', dailyOut.length);
