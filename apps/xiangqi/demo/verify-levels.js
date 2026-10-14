// Verifies all 100 殘局 levels (and the daily-puzzle pool) of 中國象棋 using the game's own engine code
// (extracted from index.html between CORE-START/CORE-END).
// For every level: legal position (kings, palace, counts, no flying general, black not in check), red to move,
// red forces mate within the stated number of moves against every black defence (exhaustive AND/OR proof),
// the stated number is the shortest forced mate (checking-move search exactly n; full-width search confirms no
// mate in fewer moves up to 3), and the difficulty metric strictly increases with the level number.
// Usage: node verify-levels.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const XQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return XQ;')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const DAILY = JSON.parse(html.match(/var DAILY = (\[[\s\S]*?\n\]);/)[1]);

function analyse(fen, n) {
  const p = XQ.fromFen(fen), r = { fen, n, errs: [] };
  const v = XQ.validate(p); if (v.length) r.errs.push('invalid: ' + v.join(','));
  if (p.side !== 0) r.errs.push('not red to move');
  const ms = new XQ.MateSolver(false);
  if (!ms.att(p, n)) r.errs.push('no forced mate in ' + n);
  if (n > 1 && ms.att(p, n - 1)) r.errs.push('mate in fewer (checks)');
  const lim = Math.min(n - 1, 3);
  if (lim >= 1) { const fw = new XQ.MateSolver(true); if (fw.dist(p, lim)) r.errs.push('full-width mate in <= ' + lim); }
  let winners = 0;
  for (const [m, rep] of ms.attackMoves(p)) {
    let good = rep === 0;
    if (!good && n > 1) { XQ.makeMove(p, m); good = ms.def(p, n - 1); XQ.unmakeMove(p); }
    if (good) winners++;
  }
  const q = XQ.fromFen(fen), line = []; let left = n, sacs = 0, last = 0;
  for (;;) { const a = ms.bestAttack(q, left); if (!a) { r.errs.push('line'); break; } line.push(XQ.moveName(q, a.move)); last = Math.abs(q.b[a.move & 127]); XQ.makeMove(q, a.move); left--;
    if (!XQ.hasLegal(q)) break; const d = ms.bestDefence(q, left); if (q.b[d.move >> 7]) sacs++; line.push(XQ.moveName(q, d.move)); XQ.makeMove(q, d.move); }
  r.cand = XQ.legalMoves(p).length; r.unique = winners === 1; r.sacs = sacs; r.line = line; r.pawnMate = last === XQ.P;
  r.ic = XQ.inCheck(p, 0); r.threat = !r.ic && XQ.hasMateIn1(XQ.fromFen(fen.replace(/ w$/, ' b')));
  r.metric = n * 10 + r.cand / 2 + (r.unique ? 15 : 0) + sacs * 8;
  r.nodes = ms.nodes;
  return r;
}
const t0 = Date.now(); let ok = true, prevM = -1, prevD = 0; const res = [];
for (let i = 0; i < LEVELS.length; i++) {
  const [fen, n, diff] = LEVELS[i], r = analyse(fen, n); res.push(r);
  if (r.metric <= prevM) r.errs.push('metric not increasing ' + prevM + ' -> ' + r.metric);
  if (diff < prevD) r.errs.push('displayed difficulty decreases');
  prevM = r.metric; prevD = diff;
  if (r.errs.length) { ok = false; console.log('LEVEL', i + 1, 'PROBLEM', r.errs.join('; ')); }
}
const bands = {}; res.forEach((r, i) => { bands[r.n] = (bands[r.n] || 0) + 1; });
console.log('Levels:', LEVELS.length, '| all verified forced mates with exact shortest length:', ok && LEVELS.length === 100);
console.log('Mate length distribution (moves: count):', JSON.stringify(bands));
console.log('Metric (n*10 + candidates/2 + 15*unique-first-move + 8*sacrifices) strictly increasing:', res.every((r, i) => !i || r.metric > res[i - 1].metric),
  '| range', res[0].metric.toFixed(1), '->', res[99].metric.toFixed(1), '| displayed 難度', LEVELS[0][2], '->', LEVELS[99][2]);
console.log('Unique first move:', res.filter(r => r.unique).length, '/100 | levels with sacrifices:', res.filter(r => r.sacs).length,
  '| black counter-mate threat:', res.filter(r => r.threat).length, '(level 30:', res[29].threat + ')',
  '| red starts in check:', res.filter(r => r.ic).length, '(level 60:', res[59].ic + ')', '| pawn-delivered mates:', res.filter(r => r.pawnMate).length, '(level 80:', res[79].pawnMate + ')');
for (const n of [1, 30, 50, 60, 75, 80, 99, 100]) { const r = res[n - 1]; console.log('Level', n, '| mate in', r.n, '| 難度', LEVELS[n - 1][2], '| metric', r.metric.toFixed(1), '| fen', r.fen, '\n   main line:', r.line.join(' ')); }
let dok = true; DAILY.forEach((d, i) => { const r = analyse(d[0], d[1]); if (r.errs.length) { dok = false; console.log('DAILY', i, r.errs.join('; ')); } if (LEVELS.some(l => l[0] === d[0])) { dok = false; console.log('DAILY dup', i); } });
console.log('Daily pool:', DAILY.length, 'extra puzzles, all verified and distinct from the 100 levels:', dok);
console.log('Time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exitCode = ok && dok ? 0 : 1;
