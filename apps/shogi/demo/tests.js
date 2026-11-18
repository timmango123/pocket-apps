// Rule unit tests for 日本將棋. Extracts the engine between the CORE markers of ../index.html and checks perft from the start
// position against the published values, every special rule of the spec (forced/optional promotion, drops and their three
// restrictions incl. 打步詰, self-check, 千日手 / 連續王手千日手, 入玉宣言 27-point rule, handicaps, SFEN/USI/KIF, notation),
// the opening book, and re-verifies all built-in 詰將棋 puzzles (mate length exact, first move unique).
// Part 2 (release review r1): the SPEC bots vs 十級/八級/五級, then the real page in mobile Chromium over http with CDP touch:
// the pointerup tap layer (resting finger, overlapping two-finger taps in both lift orders, detail-0 click replays, holds),
// first launch, corrupt storage, 詰將棋 vs a saved game, reload mid-puzzle, daily puzzle, toast/kifu/promo/landscape layout.
// Usage: node tests.js [--perft5] [--no-browser]
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
  for (let lv = 0; lv < SG.LEVELS.length; lv++) { const r = SG.think(p.clone(), lv, { time: 600 }); ok(U(r.move) === 'G*5b', `${SG.LEVELS[lv].name} finds the mate in 1 (${U(r.move)})`); }
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
  ok(!bad && TSUME.length === 60, TSUME.length + ' tsume puzzles: shortest mate exactly as labelled and unique first move');
  const seen = new Set(TSUME.map(z => z.sfen.split(' ')[0])); ok(seen.size === TSUME.length, 'no duplicate puzzle positions');
  console.log('tsume puzzles verified:', JSON.stringify(lens), bad ? bad + ' bad' : 'all OK');
}
/* ---- difficulty ladder (release review r1 item 5): SPEC bots vs the computer levels ---- */
{
  let seed = 4242; const R = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const greedy = p => { const ms = p.legalMoves(); let best = ms[0], bs = -1e9; for (const m of ms) { p.make(m); const v = p.legalMoves().length ? -SG.evaluate(p) + R() * 5 : 1e8; p.unmake(); if (v > bs) { bs = v; best = m; } } return best; };
  const POL = {
    clumsy: p => { const ms = p.legalMoves(); if (R() < 0.5 || R() < 0.15) return ms[Math.floor(R() * ms.length)]; return greedy(p); },
    casual: p => { const ms = p.legalMoves(); return R() < 0.15 ? ms[Math.floor(R() * ms.length)] : greedy(p); },
    casualQ: p => SG.think(p, { depth: 1, time: 100, mistake: 0.15, k: 4, temp: 150, mate: 0, book: false }).move };
  const series = (tier, lv, n, s0) => { let w = 0; for (let i = 0; i < n; i++) { SG.setSeed(s0 + i); const g = new SG.Game(); while (!g.result && g.moves.length < 300) { const m = g.pos.side === 0 ? POL[tier](g.pos) : SG.think(g.pos, lv).move; if (!m) break; g.play(m); } if (g.result && g.result.winner === 0) w++; } return w; };
  const t0 = Date.now();
  ok(SG.LEVELS.length === 7 && SG.ORDER.join() === '0,5,6,1,2,3,4' && SG.ORDER.map(i => SG.LEVELS[i].name).join('') === '十級八級六級五級初段三段五段', 'seven levels, weakest to strongest: ' + SG.ORDER.map(i => SG.LEVELS[i].name).join(' '));
  const cas = series('casual', 0, 16, 100), clu = series('clumsy', 0, 24, 200);
  ok(cas >= 5, `十級 is beatable by a casual (1-step greedy) bot: ${cas}/16`);
  ok(clu >= 1, `... and now and then by a clumsy (mostly random) bot: ${clu}/24`);
  const q8 = series('casualQ', 5, 8, 300), q5 = series('casualQ', 1, 8, 400);
  ok(q8 >= 2 && q8 <= 7 && q5 <= 3 && q8 > q5, `八級 sits between 十級 and 五級 for a trade-aware casual bot: 八級 ${q8}/8, 五級 ${q5}/8`);
  console.log(`ladder: casual vs 十級 ${cas}/16, clumsy vs 十級 ${clu}/24, casualQ vs 八級 ${q8}/8, vs 五級 ${q5}/8 (${Date.now() - t0} ms)`);
}

if (process.argv.includes('--no-browser')) { console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0; }
else uiTests(ok).then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0; }, e => { console.log('FAIL browser tests crashed: ' + (e && e.stack || e)); fail++; console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = 1; });

/* ================= Part 2: the real page (release review r1 toFix 1-9) ================= */
async function uiTests(ok) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [], T0 = Date.now();
  const BASE = { 'shogi.tutDone': '1', 'shogi.settings': JSON.stringify({ sound: false, level: 0, color: 'sente', mode: 'ai', hc: 0 }) };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function open(o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    if (!o.ctx) await ctx.addInitScript(ls => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.clear(); for (const k in ls) localStorage.setItem(k, ls[k]); }, o.ls || BASE);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__shogi);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await sleep(hold); await T('touchEnd', []); };
    const tap = async (sel, hold) => tapAt(await center(sel), hold);
    const st = () => p.evaluate(() => window.__shogi.state());
    const wait = (fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
    const d0 = (x, y) => p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window, clientX: x, clientY: y })); return e ? (e.id || e.tagName) : null; }, [x, y]);
    const d0sel = sel => p.$eval(sel, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window })));
    const sq = u => p.evaluate(u => window.__shogi.sqClient(u), u);
    const play = async u => {   // one USI move with taps (piece or piece-stand, then target, then 成/不成 if asked)
      const n0 = (await st()).moves.length;
      await tapAt(u[1] === '*' ? await p.evaluate(a => window.__shogi.handClient(window.__shogi.state().side, a), u[0]) : await sq(u.slice(0, 2)));
      await sleep(60); await tapAt(await sq(u.slice(2, 4))); await sleep(120);
      if ((await st()).promo) await tap(u.endsWith('+') ? '#pYes' : '#pNo');
      return wait(n => window.__shogi.state().moves.length > n, n0);
    };
    const playing = () => wait(() => { const s = window.__shogi.state(); return s.phase === 'play' && !s.overlays.length; });
    return { ctx, p, T, tap, tapAt, center, st, wait, d0, d0sel, sq, play, playing };
  }
  const quiet = () => sleep(850);   // let the 800 ms tap guard pass (for lone detail-0 clicks)

  /* ---- 1. [veto] the tap layer ---- */
  {
    const P = await open(); const { p, T, tap, center, st, wait, d0, d0sel } = P;
    await tap('#bStart'); ok(await P.playing(), 'menu 開始對局 by tap starts a game');
    let s0 = await st(), f0 = s0.flip, n0 = s0.tapFired;
    await tap('#bFlip'); await sleep(150); let s = await st();
    ok(s.flip !== f0 && s.tapFired === n0 + 1, 'single tap on 翻轉 flips once');
    for (const hold of [600, 1000]) { const a = (await st()).flip; await tap('#bFlip', hold); await sleep(150); ok((await st()).flip !== a, `held ${hold} ms: 翻轉 fires once`); }
    // a finger resting on the HUD, on the board, below the board: a second finger's tap still fires each button once
    const rests = [await center('#mvNo'), await P.sq('5e'), [195, (await p.$eval('#cv', e => e.getBoundingClientRect().bottom)) - 8]];
    let restOK = 0, restN = 0;
    for (const r of rests) for (const sel of ['#bFlip', '#bLabel']) {
      const a = await st(), q = await center(sel), rest = [r[0], r[1], 1];
      await T('touchStart', [rest]); await sleep(200);
      await T('touchStart', [rest, [q[0], q[1], 2]]); await sleep(50); await T('touchEnd', [[q[0], q[1], 2]]); await sleep(150);
      const b = await st(); await T('touchEnd', [rest]); await sleep(120);
      const c = await st(); restN++;
      if ((sel === '#bFlip' ? b.flip !== a.flip : b.label !== a.label) && b.tapFired === a.tapFired + 1 && c.tapFired === b.tapFired) restOK++;
    }
    ok(restOK === restN, `resting finger (HUD, board, below board): second-finger taps fire once each ${restOK}/${restN}`);
    { // resting finger + 選單 opens the menu
      const r = await center('#mvNo'), q = await center('#bMenu');
      await T('touchStart', [[r[0], r[1], 1]]); await sleep(200); await T('touchStart', [[r[0], r[1], 1], [q[0], q[1], 2]]); await sleep(50); await T('touchEnd', [[q[0], q[1], 2]]); await sleep(150); await T('touchEnd', [[r[0], r[1], 1]]);
      ok(await wait(() => window.__shogi.state().overlays.includes('menu')), 'resting finger: 選單 opens the menu');
      await quiet(); await tap('#menuX'); ok(await P.playing(), 'menu × back to the game');
    }
    // overlapping taps: finger 2 lands 50 ms after finger 1 on another button; both act, in both lift orders
    for (const order of ['first', 'second']) {
      const a = await st(), A = await center('#bFlip'), B = await center('#bLabel');
      await T('touchStart', [[A[0], A[1], 1]]); await sleep(50); await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await sleep(50);
      if (order === 'first') { await T('touchEnd', [[A[0], A[1], 1]]); await sleep(40); await T('touchEnd', [[B[0], B[1], 2]]); }
      else { await T('touchEnd', [[B[0], B[1], 2]]); await sleep(40); await T('touchEnd', [[A[0], A[1], 1]]); }
      await sleep(150); const b = await st();
      ok(b.flip !== a.flip && b.label !== a.label && b.tapFired === a.tapFired + 2, `overlapping taps 翻轉 + 標示, ${order} finger lifts first: both act once`);
    }
    // a tap then a detail-0 click on the same button, on its edge, and on elementFromPoint: the action runs once
    await quiet();
    { const a = await st(), bb = await p.$eval('#bFlip', e => { const r = e.getBoundingClientRect(); return [r.right - 1, r.top + r.height / 2, r.left + r.width / 2]; });
      await tap('#bFlip'); await d0sel('#bFlip'); await d0(bb[0], bb[1]); await d0(bb[2], bb[1]); await sleep(150);
      const b = await st(); ok(b.flip !== a.flip && b.tapFired === a.tapFired + 1, 'tap + detail-0 click replays (button, edge, elementFromPoint): 翻轉 flipped once'); }
    for (const dt of [120, 400]) { await quiet(); const a = await st(); await tap('#bFlip'); await sleep(dt); await d0sel('#bFlip'); await sleep(80); ok((await st()).flip !== a.flip, `detail-0 click ${dt} ms after a tap is swallowed`); }
    // a tap that opens the menu: the replayed click under the finger does nothing on the new screen
    await quiet();
    { const before = await p.evaluate(() => localStorage.getItem('shogi.settings')), q = await center('#bMenu');
      await tap('#bMenu'); await wait(() => window.__shogi.state().overlays.includes('menu')); const hit = await d0(q[0], q[1]); await sleep(150);
      ok((await st()).overlays.join() === 'menu' && await p.evaluate(() => localStorage.getItem('shogi.settings')) === before, `tap 選單 + detail-0 click on the new screen (${hit}): nothing there ran`);
      await quiet(); await tap('#menuX'); await P.playing(); }
    // a lone detail-0 click (screen reader / keyboard) acts once; Enter on a focused button acts once
    await quiet(); { const a = await st(); await d0sel('#bFlip'); await sleep(80); ok((await st()).flip !== a.flip, 'lone detail-0 click acts once'); }
    await quiet(); { const a = await st(); await p.focus('#bFlip'); await p.keyboard.press('Enter'); await sleep(80); ok((await st()).flip !== a.flip, 'Enter on a focused button acts once'); }
    // a pointer-made click with no tap-layer press (detail 1) never acts on its own
    await quiet(); { const a = await st(); await p.$eval('#bFlip', e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, view: window }))); await sleep(80); ok((await st()).flip === a.flip, 'stray pointer click (detail 1) without a press is ignored'); }
    // toast sits on the header, not the board (item 7); kifu bar is a 44 px target (item 8)
    await quiet(); await tap('#bLabel'); await sleep(250);
    const geo = await p.evaluate(() => { const r = e => document.getElementById(e).getBoundingClientRect(); return { t: r('toast'), bar: r('bar'), cv: r('cv'), main: r('main'), op: getComputedStyle(document.getElementById('toast')).opacity, kh: r('kifu').height }; });
    ok(+geo.op > 0.5 && geo.t.top >= geo.bar.top - 1 && geo.t.bottom <= geo.bar.bottom + 1 && geo.t.bottom <= geo.cv.top, `toast shows on the header, clear of the board (toast ${Math.round(geo.t.top)}-${Math.round(geo.t.bottom)}, board from ${Math.round(geo.cv.top)})`);
    ok(geo.kh >= 44, `#kifu tap target ${geo.kh} px >= 44`);
    ok(geo.cv.height >= geo.main.height * 0.8, `portrait 390x844: board + bigger piece stands use the space (${Math.round(geo.cv.height)} of ${Math.round(geo.main.height)} px)`);
    // play a real move by touch: board input unchanged
    ok(await P.play('7g7f'), 'board tap-tap move still works');
    await P.ctx.close();
  }

  /* ---- 1b/9. promotion box and resign confirm under a resting finger; the box closes only on a full tap ---- */
  {
    const P = await open(); const { p, T, tap, center, st, wait } = P;
    await tap('#bStart'); await P.playing();
    const loadPos = async sf => { await tap('#kifu'); await wait(() => window.__shogi.state().overlays.includes('kif')); await p.fill('#kifText', sf); await p.evaluate(() => document.activeElement && document.activeElement.blur()); await sleep(200); await tap('#kifLoad'); return wait(s => window.__shogi.state().sfen === s && window.__shogi.state().phase === 'play', sf + ' 1'); };
    const SF = 'k8/9/9/4S4/9/9/9/9/4K4 b -';
    ok(await loadPos(SF), 'SFEN position loaded through the 棋譜 card');
    const openPromo = async () => { await P.tapAt(await P.sq('5d')); await sleep(80); await P.tapAt(await P.sq('5c')); return wait(() => window.__shogi.state().promo); };
    ok(await openPromo(), 'silver into the zone asks 成／不成');
    { const a = await P.sq('1i'); await T('touchStart', [[a[0], a[1], 1]]); await sleep(30); await T('touchMove', [[a[0] - 30, a[1] - 30, 1]]); await sleep(30); await T('touchEnd', [[a[0] - 30, a[1] - 30, 1]]); await sleep(120);
      ok((await st()).promo, 'a swipe / brush on the board does not cancel the promotion box'); }
    { const r = await P.sq('1h'); await T('touchStart', [[r[0], r[1], 1]]); await sleep(200); ok((await st()).promo, 'a finger resting on the board does not cancel it');
      const q = await center('#pYes'); await T('touchStart', [[r[0], r[1], 1], [q[0], q[1], 2]]); await sleep(50); await T('touchEnd', [[q[0], q[1], 2]]); await sleep(150);
      const s = await st(); await T('touchEnd', [[r[0], r[1], 1]]); await sleep(150);
      ok(s.moves[0] === '5d5c+' && (await st()).moves.length === 1, 'resting finger + tap 成: promotes once (' + s.moves.join() + ')'); }
    await sleep(500);
    ok(await loadPos(SF), 'position reloaded'); ok(await openPromo(), 'promotion box again');
    await P.tapAt(await P.sq('1i')); await sleep(150); { const s = await st(); ok(!s.promo && s.moves.length === 0, 'a full tap outside closes the box without moving'); }
    // resign → confirm → 確定 with a finger resting on the HUD
    await sleep(200); await tap('#bResign'); ok(await wait(() => window.__shogi.state().overlays.includes('confirm')), 'resign asks to confirm');
    { const r = await center('#mvNo'), q = await center('#cfYes'); await sleep(300);
      await T('touchStart', [[r[0], r[1], 1]]); await sleep(200); await T('touchStart', [[r[0], r[1], 1], [q[0], q[1], 2]]); await sleep(50); await T('touchEnd', [[q[0], q[1], 2]]); await sleep(100); await T('touchEnd', [[r[0], r[1], 1]]);
      ok(await wait(() => window.__shogi.state().phase === 'over'), 'resting finger + 確定 resigns'); ok(await wait(() => window.__shogi.state().resultVisible, null, 4000), 'result card appears'); }
    await P.ctx.close();
  }

  /* ---- 2. first launch: closing the tutorial with × leaves a playable game ---- */
  {
    const P = await open({ ls: {} }); const { st, wait } = P;
    ok(await wait(() => window.__shogi.state().overlays.includes('tut')), 'first launch opens the tutorial');
    await P.tap('#tut .x'); ok(await P.playing(), 'tutorial × starts a game (phase play, no card)');
    ok(await P.play('7g7f'), 'and a piece can be moved right away');
    await P.ctx.close();
  }

  /* ---- 3. corrupt storage: defaults, no errors, the result card still appears ---- */
  {
    const START = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
    const cases = [
      ['stats lv null, settings level 7 / hc 99', { 'shogi.tutDone': '1', 'shogi.stats': '{"lv":null,"pvp":"x","ts":[5]}', 'shogi.settings': '{"level":7,"hc":99,"mode":"zz","label":5,"sound":false}' }],
      ['stats lv [1,2], ach array', { 'shogi.tutDone': '1', 'shogi.stats': '{"lv":[1,2]}', 'shogi.ach': '[1]', 'shogi.settings': '{"level":-1,"hc":"2","sound":false}' }],
      ['saved game level 9', { 'shogi.tutDone': '1', 'shogi.settings': '{"sound":false}', 'shogi.game': JSON.stringify({ sfen: START, moves: ['7g7f', '3c3d'], mode: 'ai', human: 0, level: 9, hc: 99, evals: [1], think: 'x' }) }],
      ['saved game level 9, sound on, computer to move (no vibrate before a tap)', { 'shogi.tutDone': '1', 'shogi.game': JSON.stringify({ sfen: START, moves: ['7g7f'], mode: 'ai', human: 0, level: 9 }) }],
      ['saved game junk', { 'shogi.tutDone': '1', 'shogi.settings': '{"sound":false}', 'shogi.game': '{"sfen":5,"moves":"7g7f","mode":"ai"}', 'shogi.tsCur': '{"i":999}' }]];
    for (const [name, ls] of cases) {
      const e0 = errors.length, P = await open({ ls }); const { st, wait } = P;
      await sleep(300); let s = await st();
      if (s.phase === 'idle' || s.overlays.includes('menu')) { await P.tap('#bStart'); await P.playing(); s = await st(); }
      const lvOK = s.level >= 0 && s.level <= 6;
      await sleep(200); await P.tap('#bResign'); await wait(() => window.__shogi.state().overlays.includes('confirm')); await sleep(300); await P.tap('#cfYes');
      const shown = await wait(() => window.__shogi.state().resultVisible, null, 4000);
      ok(shown && lvOK && errors.length === e0, `corrupt storage (${name}): game plays at a valid level, result card shows, 0 errors`);
      await P.ctx.close();
    }
  }

  /* ---- 4/6/9. 詰將棋 keeps a game in progress; solving keeps shogi.game; reload mid-puzzle; daily puzzle ---- */
  {
    const key = i => { const p = SG.fromSfen(TSUME[i].sfen); return U(SG.matingMoves(p, TSUME[i].n, 4000000).moves[0]); };
    const P = await open(); const { p, tap, st, wait } = P;
    await tap('#bStart'); await P.playing(); await P.play('7g7f');
    ok(await wait(() => { const s = window.__shogi.state(); return s.moves.length === 2 && s.phase === 'play'; }, null, 8000), 'computer replied');
    await sleep(200); await tap('#bMenu'); await wait(() => window.__shogi.state().overlays.includes('menu'));
    await sleep(200); await tap('#sgMode [data-v="tsume"]'); await sleep(200); await tap('#bStart');
    ok(await wait(() => window.__shogi.state().overlays.includes('tsumeList')), 'menu → 詰將棋 → puzzle list');
    ok(await p.$$eval('#ts1 button, #ts3 button, #ts5 button', b => b.length) === 60, 'puzzle list shows 60 puzzles');
    await sleep(200); await tap('#ts1 button');
    ok(await wait(() => window.__shogi.state().mode === 'tsume' && window.__shogi.state().tsume === 0), 'puzzle 1 open');
    const g = await p.evaluate(() => JSON.parse(localStorage.getItem('shogi.game') || 'null'));
    ok(g && g.moves.length === 2, 'the game in progress stays saved while a puzzle is open');
    ok(await P.play(key(0)), 'puzzle 1 key move played by touch');
    ok(await wait(() => window.__shogi.state().resultVisible, null, 5000), 'puzzle solved: result card');
    const g2 = await p.evaluate(() => JSON.parse(localStorage.getItem('shogi.game') || 'null'));
    ok(g2 && g2.moves.length === 2, 'solving a puzzle does not delete shogi.game');
    await p.reload(); await p.waitForFunction(() => window.__shogi);
    ok(await wait(() => { const s = window.__shogi.state(); return s.mode === 'ai' && s.moves.length === 2; }), 'after a reload the saved game is back');
    // reload in the middle of a 3-move puzzle returns to it
    await sleep(200); await tap('#bMenu'); await wait(() => window.__shogi.state().overlays.includes('menu'));
    await sleep(200); await tap('#bStart'); await wait(() => window.__shogi.state().overlays.includes('tsumeList'));
    await sleep(200); await tap('#ts3 button'); await wait(() => window.__shogi.state().tsume === 10);
    await P.play(key(10));
    ok(await wait(() => { const s = window.__shogi.state(); return s.moves.length === 2 && s.phase === 'play'; }, null, 8000), '3-move puzzle: defender replied');
    await p.reload(); await p.waitForFunction(() => window.__shogi);
    ok(await wait(() => { const s = window.__shogi.state(); return s.mode === 'tsume' && s.tsume === 10 && s.moves.length === 2 && s.phase === 'play'; }), 'reload mid-puzzle returns to the same puzzle and moves');
    // menu → 繼續對局 goes back to the saved game
    await sleep(200); await tap('#tsList'); await wait(() => window.__shogi.state().overlays.includes('tsumeList')); await sleep(200); await tap('#tsumeList .x');
    await sleep(200); await tap('#tsMenu'); ok(await wait(() => window.__shogi.state().overlays.includes('menu')), '詰將棋 toolbar 選單 opens the menu');
    ok(!(await p.$eval('#bContinue', b => b.disabled)), '繼續對局 is offered while a game is saved');
    await sleep(200); await tap('#bContinue');
    ok(await wait(() => { const s = window.__shogi.state(); return s.mode === 'ai' && s.moves.length === 2 && !s.overlays.length; }), '繼續對局 from a puzzle restores the game');
    // daily puzzle
    await sleep(200); await tap('#bMenu'); await wait(() => window.__shogi.state().overlays.includes('menu'));
    await sleep(200); await tap('#bStart'); await wait(() => window.__shogi.state().overlays.includes('tsumeList'));
    const di = await p.evaluate(() => { const d = new Date(), k = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); return (k * 7) % 60; });
    ok(/每日一題/.test(await p.textContent('#tsDaily')) && (await p.textContent('#tsDaily')).includes('第 ' + (di + 1) + ' 題'), 'daily puzzle button names today\'s puzzle');
    await sleep(200); await tap('#tsDaily');
    ok(await wait(t => window.__shogi.state().mode === 'tsume' && window.__shogi.state().tsume === t, di), 'daily puzzle opens');
    await P.ctx.close();
  }

  /* ---- 9. landscape: tutorial × is 44x44, HUD names are not cut ---- */
  {
    const P = await open({ w: 844, h: 390, ls: {} }); const { p, st, wait } = P;
    await wait(() => window.__shogi.state().overlays.includes('tut')); await sleep(400);
    const xb = await p.$eval('#tut .x', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
    ok(xb[0] >= 44 && xb[1] >= 44, `landscape tutorial × ${xb.join('x')} >= 44x44`);
    await P.tap('#tut .x'); await P.playing();
    const cut = () => p.evaluate(() => ['nmT', 'nmB', 'sbT', 'sbB'].filter(id => { const e = document.getElementById(id); return e.scrollWidth > e.clientWidth + 1; }));
    ok((await cut()).length === 0, 'landscape HUD names fit (game): ' + (await cut()).join());
    await sleep(200); await P.tap('#bMenu'); await wait(() => window.__shogi.state().overlays.includes('menu'));
    await sleep(200); await P.tap('#sgMode [data-v="tsume"]'); await sleep(200); await P.tap('#bStart'); await wait(() => window.__shogi.state().overlays.includes('tsumeList'));
    await sleep(200); await P.tap('#ts5 button'); await wait(() => window.__shogi.state().mode === 'tsume'); await sleep(200);
    ok((await cut()).length === 0, 'landscape HUD names fit (詰將棋): ' + (await cut()).join());
    await P.ctx.close();
  }
  ok(errors.length === 0, 'browser: 0 page/console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`browser checks done in ${Math.round((Date.now() - T0) / 1000)} s`);
  await browser.close();
}
