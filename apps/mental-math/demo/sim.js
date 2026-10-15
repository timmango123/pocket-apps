// Node verification for 粉筆心算 using the game's own core (CORE-START/CORE-END in ../index.html).
// 1) 10,000 problems per tier (and practice kinds): answer is an integer, text evaluates to the answer, division exact,
//    no negatives where not allowed, options distinct, exactly one correct option.
// 2) Difficulty curve check: T >= simultaneous * 0.55 s for every score up to 10000.
// 3) 1000 auto-played games: bot reacts 150 ms + 400 ms compute per problem (always correct) -> must reach 10000 points.
//    Plus 1000 games with a 4% error rate to show the score distribution.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {mulberry32,genProblem,genOptions,newGame,step,answer,simulFor,tierFor,fallTime,optsFor,negFor,curT,hardSimul,hardFall};')();
const evalText = t => Function('return (' + t.replace(/−/g, '-').replace(/×/g, '*').replace(/÷/g, '/') + ')')();

let bad = 0, total = 0;
const r = C.mulberry32(12345);
const cases = [];
for (let t = 1; t <= 6; t++) cases.push([t, false, null], [t, true, null]);
cases.push([7, true, null], [7, false, null]);
cases.push([3, false, 'mul'], [5, false, 'mul'], [4, false, 'div'], [5, false, 'div']);
for (const [tier, neg0, kind] of cases) {
  const neg = neg0 || tier >= 6; // tier 6 only exists at score >= 6000 where negatives are on
  for (let i = 0; i < 10000; i++) {
    const p = C.genProblem(tier, r, neg, kind);
    for (const n of [4, 6]) {
      const o = C.genOptions(p, n, r, neg); total++;
      const v = evalText(p.text), errs = [];
      if (!Number.isInteger(p.ans) || v !== p.ans) errs.push('eval ' + v);
      if (/÷/.test(p.text)) { const m = p.text.match(/(\d+)÷(\d+)/); if (+m[1] % +m[2]) errs.push('not exact'); }
      if (!neg && p.ans < 0) errs.push('negative');
      if (new Set(o).size !== n) errs.push('dup options');
      if (o.filter(x => x === p.ans).length !== 1) errs.push('not unique');
      if (!neg && p.ans >= 0 && o.some(x => x < 0)) errs.push('neg option');
      if (errs.length) { bad++; if (bad < 10) console.log('BAD', p.text, p.ans, o, errs); }
    }
  }
}
console.log(`Generator: ${total} problem+option sets checked (${cases.length} tier/kind cases x 10000 x 4/6 options), failures: ${bad}`);

let curveOk = true;
for (let s = 0; s <= 10000; s += 10) for (let n = 0; n <= 400; n++) {
  const T = C.fallTime(n), N = C.simulFor(s); if (T < N * 0.55 - 1e-9) curveOk = false;
}
console.log('Curve: T >= simultaneous x 0.55 s for all scores <= 10000:', curveOk, '(min T', C.fallTime(1000).toFixed(2), 's, max simultaneous 4 -> 2.20 s)');

function play(seed, errRate, cap) {
  const g = C.newGame({ mode: 'classic', seed });
  const dt = 1 / 60, er = C.mulberry32(seed ^ 777);
  let wait = 0, curId = -1, t10 = null;
  const tierAt = {};
  while (!g.over && g.t < 1800) {
    C.step(g, dt);
    if (g.cur && g.cur.id !== curId) { curId = g.cur.id; wait = 0.55; }
    if (g.cur && (wait -= dt) <= 0) {
      let idx = g.cur.opts.indexOf(g.cur.prob.ans);
      if (er() < errRate) idx = (idx + 1) % g.cur.opts.length;
      const res = C.answer(g, idx);
      if (res === 'ok') curId = -1; else wait = 0.55;
    }
    if (!tierAt[g.tier]) tierAt[g.tier] = { t: g.t, answered: g.answered };
    if (g.score >= 10000 && t10 === null) t10 = { t: g.t, answered: g.answered, T: g.T, sim: C.simulFor(g.score) };
    if (cap && g.score >= cap) break;
  }
  return { g, t10, tierAt };
}
let reached = 0, deaths = 0, ans10 = [], times10 = [];
for (let s = 1; s <= 1000; s++) {
  const { g, t10 } = play(s, 0, 12000);
  if (t10) { reached++; ans10.push(t10.answered); times10.push(t10.t); }
  if (g.over) deaths++;
}
const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
console.log(`Perfect bot (150ms react + 400ms compute): ${reached}/1000 games reached 10000 points, ${deaths} died; avg ${avg(ans10).toFixed(0)} answers / ${avg(times10).toFixed(0)} s to 10000`);
const sample = play(1, 0, 12000);
console.log('  sample run tier reached at (seconds, answers):', Object.entries(sample.tierAt).map(([k, v]) => `t${k}@${v.t.toFixed(0)}s/${v.answered}`).join(' '));
const scores = [];
for (let s = 1; s <= 1000; s++) { const { g } = play(5000 + s, 0.04, 0); scores.push(g.score); }
scores.sort((a, b) => a - b);
console.log(`Bot with 4% wrong answers, 1000 games: median score ${scores[500]}, p10 ${scores[100]}, p90 ${scores[900]}, max ${scores[999]}`);

// 4) 高難度挑戰: bots that need `think` seconds per problem (plus 150 ms reaction), 4% wrong answers.
function playHard(seed, think, errRate) {
  const g = C.newGame({ mode: 'classic', hard: true, seed });
  const dt = 1 / 60, er = C.mulberry32(seed ^ 991);
  let wait = 0, curId = -1;
  while (!g.over && g.t < 1800) {
    C.step(g, dt);
    if (g.cur && g.cur.id !== curId) { curId = g.cur.id; wait = 0.15 + think; }
    if (g.cur && (wait -= dt) <= 0) {
      let idx = g.cur.opts.indexOf(g.cur.prob.ans);
      if (er() < errRate) idx = (idx + 1) % g.cur.opts.length;
      const res = C.answer(g, idx);
      if (res === 'ok') curId = -1; else wait = 0.55;
    }
  }
  return g;
}
let hardCurve = true;
for (let s = 0; s <= 20000; s += 10) for (let n = 0; n <= 400; n++) if (C.hardFall(n) < C.hardSimul(s) * 0.55) hardCurve = false;
console.log('Hard curve: T >= simultaneous x 0.55 s:', hardCurve, '(start', C.hardFall(0), 's, floor', C.hardFall(1000), 's, max simultaneous', C.hardSimul(1e9) + ')');
for (const think of [0.8, 1.2, 1.8, 2.5]) {
  const sc = [], an = [];
  for (let s = 1; s <= 300; s++) { const g = playHard(9000 + s, think, 0.04); sc.push(g.score); an.push(g.answered); }
  sc.sort((a, b) => a - b); an.sort((a, b) => a - b);
  console.log(`Hard mode, bot thinking ${think}s per problem, 4% wrong, 300 games: median ${sc[150]} pts / ${an[150]} answers, p10 ${sc[30]}, p90 ${sc[270]}`);
}
