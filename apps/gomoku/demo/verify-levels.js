// Verifies all 100 殘局 levels of 五子棋 (apps/gomoku) with the game's own engine (core extracted between CORE markers).
// For every level: the attacker wins within N of its own moves against every defence (threat-space proof: each attacker move
// is a four or creates an open-four/double-four point; the defender's forced blocks, counter-fours and every point that can
// touch the threat are all searched), there is NO win within N-1, the first move is unique (reported), the category rules hold
// (N ranges, VCF vs VCT, block-first from level 20, renju forbidden levels from 76), and the difficulty metric recomputed from
// the proof (N*12 + 15 if VCT + 10 if the first move is not a four + 3*log2(defender branches) + decoys/stones tie-breakers) is strictly increasing and
// matches the embedded value. Tie-breakers added to the spec formula so every level is strictly harder: + 0.5 per decoy
// (attacking move at the start that does NOT win, max 24) + 0.05 per stone on the board. Prints solution lines (attacker + best defence) for levels 50, 75, 99 and 100.
// Usage: node verify-levels.js [--verbose]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + ';return {threatMoves,setup,play,unplay,B,legal,isFive,fivePts,wPts,tsMinN,tsAllWins,tsReset,tsFind,proofBranches,bestDefence,setNoFb,isForbidden,winLine};')();
const PZ = new Function(html.match(/var PUZZLES = \[[\s\S]*?\n\];/)[0] + ';return PUZZLES;')();
const dec = s => { const o = []; for (let i = 0; i + 1 < s.length; i += 2) o.push((s.charCodeAt(i + 1) - 97) * 15 + (s.charCodeAt(i) - 97)); return o; };
const nm = p => String.fromCharCode(97 + p % 15) + (15 - Math.floor(p / 15));
const VERB = process.argv.includes('--verbose');
function load(P) { C.setup(15, P[4]); dec(P[0]).forEach(q => C.play(q, 1)); dec(P[1]).forEach(q => C.play(q, 2)); }
function mainLine(P) { // attacker plays a shortest winning move, defender the longest-resisting reply
  load(P); const a = P[2], d = 3 - a; let left = P[3]; const line = [];
  for (let k = 0; k < 20; k++) {
    let mv = -1; for (let n = 1; n <= left && mv < 0; n++) mv = C.tsFind(a, n, false, 0, 0);
    if (mv < 0) return line.concat(['(lost)']);
    C.play(mv, a); line.push(nm(mv)); left--;
    if (C.winLine(mv)) { line.push('五連'); break; }
    const bd = C.bestDefence(a, left, 0); if (bd.move < 0) { line.push('(no reply)'); break; }
    C.play(bd.move, d); line.push('[' + nm(bd.move) + ']');
  }
  return line;
}
const t0 = Date.now(); let ok = true, prev = -Infinity, firstBlock = 0, firstVct = 0, firstRenju = 0; const byN = {}; let uniq = 0;
for (let i = 0; i < PZ.length; i++) {
  const P = PZ[i], n = i + 1, [, , a, N, rule, diff, flags] = P; const t1 = Date.now(); const prob = [];
  load(P);
  const block = C.fivePts(3 - a).length === 1; if (block && !firstBlock) firstBlock = n;
  const minN = C.tsMinN(a, N, false, 0);
  if (minN !== N) prob.push('minN ' + minN + ' != N ' + N);
  const vcfN = C.tsMinN(a, N, true, 0); const vct = vcfN === 0; if (vct && !firstVct) firstVct = n;
  const wins = C.tsAllWins(a, N, false, 0); if (wins.length === 1) uniq++;
  C.tsReset(a, false, 0, 0); const br = C.proofBranches(N);
  C.play(wins[0], a); const four0 = C.fivePts(a).length > 0; C.unplay(wins[0]);
  const T = C.threatMoves(a, false); const decoys = [...new Set(T.fours.concat(T.threes))].filter(q => !wins.includes(q)).length;
  const stones = dec(P[0]).length + dec(P[1]).length;
  const metric = N * 12 + (vct ? 15 : 0) + (four0 ? 0 : 10) + Math.log2(Math.max(1, br)) * 3 + 0.5 * Math.min(decoys, 24) + 0.05 * stones;
  if (Math.abs(metric - diff) > 0.051) prob.push('metric ' + metric.toFixed(2) + ' != ' + diff);
  if (!(diff > prev)) prob.push('difficulty not increasing ' + prev + ' -> ' + diff);
  prev = diff;
  // category rules
  const cat = n <= 15 ? [2, 2, 0] : n <= 35 ? [3, 3, 0] : n <= 55 ? [4, 5, 0] : n <= 75 ? [5, 6, 0] : n <= 90 ? [6, 7, 2] : [7, 7, 2];
  if (N < cat[0] || N > cat[1] || rule !== cat[2]) prob.push('category N/rule ' + N + '/' + rule);
  if (n >= 36 && n <= 55 && vct) prob.push('expected VCF');
  if (n >= 56 && n <= 75 && !vct) prob.push('expected VCT (no VCF)');
  if (rule === 2 && !firstRenju) firstRenju = n;
  let fbNote = '';
  if (rule === 2) {
    C.setNoFb(true); const nf = C.tsMinN(a, 8, false, 0); C.setNoFb(false);
    if (n <= 90) { if (a !== 1 || !(nf > 0 && nf < N)) prob.push('expected black attacker tempted by a forbidden shortcut (free-rule win in ' + nf + ')'); fbNote = 'without forbidden: win in ' + nf; }
    else { if (a !== 2 || (nf > 0 && nf <= N)) prob.push('expected white win relying on black forbidden (no-forbidden win in ' + nf + ')'); fbNote = 'without black forbidden: ' + (nf ? 'win in ' + nf : 'no win within 8'); }
  }
  byN[N] = (byN[N] || 0) + 1;
  if (prob.length) { ok = false; console.log('LEVEL', n, 'PROBLEM', prob.join('; ')); }
  if (VERB || [1, 15, 16, 20, 35, 36, 55, 56, 75, 76, 90, 91, 100].includes(n))
    console.log('level', String(n).padStart(3), (a === 1 ? 'black' : 'white') + ' wins in', N, vct ? 'VCT' : 'VCF', 'first-moves', wins.length, 'branches', br, 'diff', diff.toFixed(1), block ? '[block first]' : '', fbNote, '(' + (Date.now() - t1) + 'ms)');
}
if (firstBlock !== 20) { ok = false; console.log('first block-first level is', firstBlock, '(expected 20)'); }
if (firstVct !== 56) { ok = false; console.log('first VCT level is', firstVct, '(expected 56)'); }
if (firstRenju !== 76) { ok = false; console.log('first renju level is', firstRenju, '(expected 76)'); }
console.log('levels', PZ.length, 'by N', JSON.stringify(byN), 'unique first move', uniq + '/' + PZ.length);
for (const n of [50, 75, 99, 100]) console.log('solution', n, mainLine(PZ[n - 1]).join(' '));
console.log(ok && PZ.length === 100 ? 'ALL 100 LEVELS VERIFIED' : 'VERIFICATION FAILED', '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
process.exit(ok ? 0 : 1);
