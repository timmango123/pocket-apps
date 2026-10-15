// Rule unit tests for 日本將棋. Extracts the engine between the CORE markers of ../index.html and checks perft from the start
// position against the published values, every special rule of the spec (forced/optional promotion, drops and their three
// restrictions incl. 打步詰, self-check, 千日手 / 連續王手千日手, 入玉宣言 27-point rule, handicaps, SFEN/USI/KIF, notation),
// the opening book, and re-verifies all built-in 詰將棋 puzzles (mate length exact, first move unique).
// Usage: node tests.js [--perft5]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SG = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SG;')();
const TSUME = JSON.parse(html.match(/var TSUME = (\[[\s\S]*?\]);/)[1]);
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const U = SG.toUSI, legalU = p => p.legalMoves().map(U);
function playU(g, list) { list.split(' ').forEach(u => { const m = SG.fromUSI(g.pos, u); if (!m) throw new Error('illegal ' + u + ' in ' + SG.toSfen(g.pos)); g.play(m); }); return g; }

/* ---- perft ---- */
{
  const p = SG.fromSfen(SG.START), want = [30, 900, 25470, 719731, 19861490], got = [];
  const D = process.argv.includes('--perft5') ? 5 : 4, t0 = Date.now();
  for (let d = 1; d <= D; d++) { const n = SG.perft(p, d); got.push(n); ok(n === want[d - 1], `perft(${d}) = ${n}, expected ${want[d - 1]}`); }
  console.log(`perft start position depth 1-${D}: ${got.join(' / ')} (published: ${want.slice(0, D).join(' / ')}) in ${Date.now() - t0} ms`);
  ok(SG.toSfen(p) === SG.START, 'perft leaves the position unchanged');
}
/* ---- SFEN / handicaps ---- */
{
  ok(SG.toSfen(SG.fromSfen(SG.START)) === SG.START, 'SFEN round-trip of the start position');
  const s = 'l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1';
  ok(SG.toSfen(SG.fromSfen(s)) === s, 'SFEN round-trip with promoted pieces and hands');
  const cnt = sf => { const p = SG.fromSfen(sf); let n = [0, 0]; for (const q of SG.SQ) { const pc = p.b[q]; if (pc) n[pc >> 4]++; } return n; };
  const removed = [0, 1, 1, 1, 2, 4, 6];
  SG.HANDICAPS.forEach((h, i) => { const n = cnt(h.sfen); ok(n[0] === 20 && n[1] === 20 - removed[i], `${h.n}: 上手 has ${n[1]} pieces`); ok(i === 0 ? SG.fromSfen(h.sfen).side === 0 : SG.fromSfen(h.sfen).side === 1, `${h.n}: correct side moves first (上手 in handicap games)`); });
  ok(SG.fromSfen(SG.HANDICAPS[2].sfen).legalMoves().every(m => SG.mDrop(m) === 0), 'handicap position has no drops');
}
/* ---- piece movement & promotion ---- */
{
  const q = SG.fromSfen('k8/9/9/9/9/9/9/4P4/4K4 b - 1');
  ok(legalU(q).includes('5h5g') && !legalU(q).includes('5h4g') && !legalU(q).includes('5h5f'), 'pawn moves one square straight forward only');
  const fp = SG.fromSfen('k8/4P4/9/9/9/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5b'));
  ok(fp.length === 1 && fp[0] === '5b5a+', 'pawn reaching the last rank must promote');
  const op = SG.fromSfen('k8/9/4P4/9/9/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5c'));
  ok(op.includes('5c5b') && op.includes('5c5b+'), 'pawn entering rank 2 may choose to promote');
  const kn = SG.fromSfen('k8/9/9/4N4/9/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5d'));
  ok(kn.sort().join() === '5d4b+,5d6b+', 'knight landing on rank 2 must promote (and jumps forward only)');
  const kn2 = SG.fromSfen('k8/9/9/9/4N4/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e'));
  ok(kn2.sort().join() === '5e4c,5e4c+,5e6c,5e6c+', 'knight landing on rank 3 may promote or not');
  const kj = SG.fromSfen('k8/9/9/9/9/3ppp3/9/4N4/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5h'));
  ok(kj.sort().join() === '5h4f,5h6f', 'knight jumps over pieces and captures');
  const la = SG.fromSfen('k8/9/9/9/9/9/9/4L4/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5h'));
  ok(la.includes('5h5a+') && !la.includes('5h5a') && la.includes('5h5b') && la.includes('5h5b+') && !la.includes('5h5i') && la.length === 9, 'lance slides forward; forced promotion on the last rank');
  const sv = SG.fromSfen('k8/9/9/9/4S4/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e')).sort();
  ok(sv.join() === ['5e4d', '5e4f', '5e5d', '5e6d', '5e6f'].join(), 'silver: forward and four diagonals');
  const gd = SG.fromSfen('k8/9/9/9/4G4/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e')).sort();
  ok(gd.join() === ['5e4d', '5e4e', '5e5d', '5e5f', '5e6d', '5e6e'].sort().join(), 'gold: no diagonal retreat');
  const g3 = SG.fromSfen('k8/9/4G4/9/9/9/9/9/4K4 b - 1').legalMoves().map(U).filter(u => u.startsWith('5c'));
  ok(g3.every(u => !u.endsWith('+')), 'gold never promotes');
  const rk = SG.fromSfen('k8/9/9/9/4R4/9/9/9/K8 b - 1').legalMoves().filter(m => U(m).startsWith('5e'));
  ok(rk.length === 8 + 8 + 3 /* promoting into zone: 5d? no: 5c 5b 5a get + variants */, 'rook slides orthogonally, optional promotion into the zone (' + rk.length + ' moves)');
  const dr = SG.fromSfen('k8/9/9/9/4+R4/9/9/9/K8 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e'));
  ok(dr.includes('5e4d') && dr.includes('5e6f') && !dr.includes('5e3c'), 'dragon = rook + one diagonal step');
  const hs = SG.fromSfen('k8/9/9/9/4+B4/9/9/9/K8 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e'));
  ok(hs.includes('5e5d') && hs.includes('5e4e') && hs.includes('5e1a') && !hs.includes('5e5c'), 'horse = bishop + one orthogonal step');
  const tk = SG.fromSfen('k8/9/9/9/4+P4/9/9/9/K8 b - 1').legalMoves().map(U).filter(u => u.startsWith('5e')).sort();
  ok(tk.join() === gd.join(), 'tokin moves like gold');
  const gp = SG.fromSfen('k8/9/9/9/9/9/9/4p4/K8 w - 1').legalMoves().map(U).filter(u => u.startsWith('5h'));
  ok(gp.length === 1 && gp[0] === '5h5i+', 'gote pawn moves downward and must promote on its last rank');
}
/* ---- drops ---- */
{
  const p = SG.fromSfen('4k4/9/9/9/4P4/9/9/9/4K4 b P 1'), d = legalU(p).filter(u => u.includes('*'));
  ok(!d.some(u => u[2] === '5'), '二步: no pawn drop on a file that already has an unpromoted own pawn');
  ok(d.includes('P*4e') && !d.some(u => u[3] === 'a'), 'pawn drops elsewhere allowed; never on the last rank');
  const p2 = SG.fromSfen('4k4/9/9/9/4+P4/9/9/9/4K4 b P 1');
  ok(legalU(p2).includes('P*5c'), 'a promoted pawn (と) does not count for 二步');
  const ln = legalU(SG.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b LN 1'));
  ok(!ln.some(u => u.startsWith('L*') && u[3] === 'a') && ln.some(u => u === 'L*5b'), 'lance cannot be dropped on the last rank');
  ok(!ln.some(u => u.startsWith('N*') && (u[3] === 'a' || u[3] === 'b')) && ln.includes('N*5c'), 'knight cannot be dropped on the last two ranks');
  const gl = legalU(SG.fromSfen('4k4/9/9/9/9/9/9/9/4K4 w ln 1'));
  ok(!gl.some(u => u.startsWith('L*') && u[3] === 'i') && !gl.some(u => u.startsWith('N*') && 'hi'.includes(u[3])), 'same restrictions mirrored for gote');
  // 打步詰: pawn drop that mates is illegal; pushing a pawn to mate is legal
  const uf = SG.fromSfen('7nk/7s1/9/8L/9/9/9/9/K8 b P 1');
  ok(!legalU(uf).includes('P*1b'), '打步詰: dropping a pawn to give mate is illegal');
  ok(legalU(SG.fromSfen('7nk/7s1/9/8L/9/9/9/9/K8 b G 1')).includes('G*1b'), '... while dropping another piece there is legal');
  const fm = SG.findMate(uf, 1); ok(!fm || U(fm.m) !== 'P*1b', 'mate search never uses a pawn-drop mate');
  const g = new SG.Game('7nk/7s1/8P/8L/9/9/9/9/K8 b - 1'); playU(g, '1c1b');
  ok(g.result && g.result.winner === 0 && g.result.reason === 'mate', '走步詰: pushing the pawn to mate is legal and wins');
  const ufc = SG.fromSfen('7nk/9/9/8L/9/9/9/9/K8 b P 1');
  ok(legalU(ufc).includes('P*1b'), 'pawn-drop check that is NOT mate (king can escape) is legal');
  const g2 = playU(new SG.Game(), '7g7f 3c3d 8h2b+ 3a2b');
  ok(g2.pos.h[SG.B] === 1 && g2.pos.h[8 + SG.B] === 1, 'captured pieces go to the capturer\'s hand, promoted ones revert (horse -> bishop)');
  ok(legalU(g2.pos).filter(u => u.startsWith('B*')).length === 81 - 38, 'bishop drop count = number of empty squares (43)');
}
/* ---- check, pins, mate ---- */
{
  const p = SG.fromSfen('4r4/9/9/9/9/9/9/4G4/4K4 b - 1'), u = legalU(p).filter(x => x.startsWith('5h'));
  ok(!u.includes('5h4h') && !u.includes('5h6h') && u.includes('5h5g'), 'pinned gold may only move along the pin line');
  const c = SG.fromSfen('4r4/9/9/9/9/9/9/9/4K4 b G 1');
  ok(c.inCheck() && legalU(c).every(x => ['5i4i', '5i6i', '5i4h', '5i6h'].includes(x) || /^G\*5[b-h]$/.test(x)), 'in check only evasions (king moves or interposing drops) are legal');
  const fool = playU(new SG.Game('4k4/9/4P4/9/9/9/9/9/4K4 b G 1'), 'G*5b');
  ok(fool.result && fool.result.reason === 'mate' && fool.result.winner === 0, 'head gold mate detected (詰み)');
  const st = SG.fromSfen('k8/9/9/9/9/9/9/9/8K w - 1');
  ok(st.legalMoves().length === 3, 'king alone: three moves from the corner');
}
/* ---- repetition ---- */
{
  const g = new SG.Game(); playU(g, '2h3h 8b7b 3h2h 7b8b 2h3h 8b7b 3h2h 7b8b 2h3h 8b7b 3h2h');
  ok(!g.result, 'third repetition is not yet sennichite');
  playU(g, '7b8b');
  ok(g.result && g.result.winner === -1 && g.result.reason === 'sennichite', '千日手: fourth occurrence of the same position (incl. hands & side) is a draw');
  const pc = new SG.Game('8k/9/4R4/9/9/9/9/9/K8 b - 1');
  playU(pc, '5c5a 1a1b 5a5b 1b1a 5b5a 1a1b 5a5b 1b1a 5b5a 1a1b 5a5b 1b1a');
  ok(!pc.result, 'perpetual check: not over before the fourth occurrence');
  playU(pc, '5b5a');
  ok(pc.result && pc.result.reason === 'perpetual' && pc.result.winner === 1, '連續王手千日手: the side giving continuous check loses');
  const h1 = new SG.Game(); playU(h1, '2h3h 8b7b 3h2h 7b8b');
  const h2 = new SG.Game('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1');
  ok(h1.pos.key() !== h2.pos.key(), 'position key includes side to move');
  const hA = SG.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b P 1'), hB = SG.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b 2P 1');
  ok(hA.key() !== hB.key(), 'position key includes pieces in hand (counts)');
}
/* ---- 入玉宣言 ---- */
{
  const okS = new SG.Game('RBGG5/SS2K4/NNLL5/9/9/9/9/9/4k4 b RB 1'), d = SG.declareInfo(okS.pos, 0);
  ok(d.kingIn && d.count === 10 && d.points === 28 && d.ok, `入玉宣言: sente with king in zone, 10 pieces, 28 points may declare (${d.points} pts)`);
  okS.declare(); ok(okS.result.winner === 0 && okS.result.reason === 'declare', 'valid declaration wins');
  const few = new SG.Game('RBGG5/SS2K4/NNL6/9/9/9/9/9/4k4 b RBL 1'), d2 = SG.declareInfo(few.pos, 0);
  ok(!d2.ok && d2.count === 9 && d2.points === 28, 'only 9 pieces in the zone: declaration not valid');
  few.declare(); ok(few.result.winner === 1 && few.result.reason === 'declarefail', 'invalid declaration loses');
  const pts27 = SG.declareInfo(SG.fromSfen('RBGG5/SS2K4/NNLL5/9/9/9/9/9/4k4 b R 1'), 0);
  ok(!pts27.ok && pts27.points === 23, 'sente needs 28 points');
  const gote = SG.declareInfo(SG.fromSfen('4K4/9/9/9/9/9/5llnn/4k2ss/5ggbr w r4p 1'), 1);
  ok(gote.ok && gote.points === 27, `gote needs only 27 points (${gote.points})`);
  const chk = SG.declareInfo(SG.fromSfen('RBGG5/SS2K4/NNLL5/9/9/9/9/9/4r4 b RB 1'), 0);
  ok(!chk.ok && chk.check, 'cannot declare while in check');
  const out = SG.declareInfo(SG.fromSfen('RBGG5/SS7/NNLL5/4K4/9/9/9/9/4k4 b RB 1'), 0);
  ok(!out.ok && !out.kingIn, 'king must be in the enemy zone');
}
/* ---- notation, USI, KIF, undo ---- */
{
  const g = playU(new SG.Game(), '7g7f 3c3d 8h2b+ 3a2b B*4e');
  ok(g.names.join(' ') === '▲７六歩 △３四歩 ▲２二角成 △同　銀 ▲４五角打', 'Japanese notation: ' + g.names.join(' '));
  ok(g.namesZh.join(' ') === '▲７六步 △３四步 ▲２二角升 △同銀 ▲４五角打', 'Chinese notation: ' + g.namesZh.join(' '));
  const k = SG.kif(g); ok(/1 ▲?７六歩\(77\)/.test(k.replace(/ +/g, ' ').replace('▲', '')) || k.includes('７六歩(77)'), 'KIF lines carry the source square');
  const nf = new SG.Game('k8/9/9/9/4S4/9/9/9/4K4 b - 1'); playU(nf, '5e5d 9a9b 5d5c');
  ok(nf.names[2].endsWith('不成'), '不成 written when promotion was possible but declined');
  const key = g.pos.key(); g.play(SG.fromUSI(g.pos, '4c4d')); g.undo(1);
  ok(g.pos.key() === key && g.moves.length === 5, 'undo restores the position');
  const r = SG.Game.replay(SG.START, g.usi()); ok(r.pos.key() === key, 'replay from USI list reproduces the position');
}
/* ---- engine sanity ---- */
{
  ok(SG.buildBook() === SG.BOOK_LINES.length, `opening book: all ${SG.BOOK_LINES.length} lines legal`);
  const p = SG.fromSfen('4k4/9/4P4/9/9/9/9/9/4K4 b G 1');
  for (let lv = 0; lv < 5; lv++) { const r = SG.think(p.clone(), lv, { time: 600 }); ok(U(r.move) === 'G*5b', `${SG.LEVELS[lv].name} finds the mate in 1 (${U(r.move)})`); }
  const hang = SG.fromSfen('4k4/9/9/9/7r1/9/9/4B4/4K4 b - 1'), r2 = SG.think(hang, 2, { time: 500 });
  ok(U(r2.move) === '5h2e', 'captures a hanging rook (' + U(r2.move) + ')');
}
/* ---- built-in 詰將棋 puzzles ---- */
{
  const lens = {}; let bad = 0;
  TSUME.forEach((pz, i) => {
    const p = SG.fromSfen(pz.sfen);
    const f = SG.findMate(p, pz.n, 2000000), mm = SG.matingMoves(p, pz.n, 4000000);
    const good = f && f.n === pz.n && mm.complete && mm.moves.length === 1 && !p.inCheck(1);
    if (!good) { bad++; console.log('  puzzle', i + 1, 'problem', f && f.n, mm.moves.map(U)); }
    lens[pz.n] = (lens[pz.n] || 0) + 1;
  });
  ok(!bad && TSUME.length === 30, '30 tsume puzzles: shortest mate exactly as labelled and unique first move');
  console.log('tsume puzzles verified:', JSON.stringify(lens), bad ? bad + ' bad' : 'all OK');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
