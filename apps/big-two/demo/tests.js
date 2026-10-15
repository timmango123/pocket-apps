// Rule unit tests for 大老二 (big-two), run against the game's own core (CORE-START/CORE-END markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const B2 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return B2;')();
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const R = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 }, SU = { c: 0, d: 1, h: 2, s: 3 };
const c = s => { const m = s.match(/^(10|[2-9JQKA])([cdhs])$/); return R[m[1]] * 4 + SU[m[2]]; };
const cs = s => s.split(' ').map(c);
const TW = B2.mkRules({}), FL = B2.mkRules({ flush: true }), TR = B2.mkRules({ triple: true }), BO = B2.mkRules({ bomb: true }), HK = B2.mkRules(B2.PRESETS.hk.rules), LK = B2.mkRules({ passLock: true }), NO2 = B2.mkRules({ twoDouble: false });
const ev = (s, r) => B2.evaluate(cs(s), r || TW);
const type = (s, r) => { const e = ev(s, r); return e ? (e.n === 5 ? B2.CAT_NAMES[e.cat] : e.n) : null; };
const gt = (a, b, r) => B2.beats(ev(a, r), ev(b, r), r || TW);

// --- card order: rank then suit (♠ > ♥ > ♦ > ♣) ---
ok(gt('2c', 'As'), 'single 2 > A'); ok(gt('As', 'Ks'), 'A > K'); ok(gt('Kc', 'Qs'), 'K > Q'); ok(gt('4c', '3s'), '4 > 3');
ok(gt('3s', '3h'), '♠ > ♥'); ok(gt('3h', '3d'), '♥ > ♦'); ok(gt('3d', '3c'), '♦ > ♣'); ok(!gt('3c', '3d'), '♣ < ♦');
ok(gt('2s', '2h'), '♠2 is top'); ok(!gt('10s', 'Jc'), '10 < J');
// --- pairs ---
ok(type('7c 7d') === 2, 'pair'); ok(type('7c 8c') === null, 'non pair rejected');
ok(gt('7c 7s', '7d 7h'), 'pair compared by higher card (♠7)'); ok(!gt('7c 7h', '7d 7s'), 'pair ♥ high < ♠ high');
ok(gt('8c 8d', '7h 7s'), 'pair 8 > pair 7'); ok(gt('2c 2d', 'Ah As'), 'pair 2 > pair A');
// --- triple (option) ---
ok(type('9c 9d 9h') === null, 'triple not allowed by default'); ok(type('9c 9d 9h', TR) === 3, 'triple allowed with option');
ok(gt('10c 10d 10h', '9c 9d 9s', TR), 'triple compare by rank'); ok(type('9c 9d 8h', TR) === null, 'mixed triple rejected');
// --- straights ---
ok(type('3c 4d 5h 6s 7c') === '順子', '34567 straight'); ok(type('10c Jd Qh Ks Ac') === '順子', '10JQKA straight');
ok(type('Ac 2d 3h 4s 5c') === '順子', 'A2345 straight'); ok(type('2c 3d 4h 5s 6c') === '順子', '23456 straight');
ok(type('Jc Qd Kh As 2c') === null, 'JQKA2 illegal'); ok(type('Qc Kd Ah 2s 3c') === null, 'QKA23 illegal'); ok(type('Kc Ad 2h 3s 4c') === null, 'KA234 illegal');
ok(type('3c 4d 5h 6s 8c') === null, 'gap rejected'); ok(type('9c 10d Jh Qs Kc') === '順子', '9-K straight');
ok(gt('2c 3d 4h 5s 6c', 'Ac 2s 3h 4s 5c'), '23456 > A2345'); ok(gt('Ac 2c 3h 4s 5c', '10s Js Qs Ks Ah'), 'A2345 > 10JQKA');
ok(gt('10c Jd Qh Ks Ac', '9s 10s Jh Qs Ks'), '10JQKA > 9-K'); ok(gt('4c 5d 6h 7s 8c', '3s 4s 5h 6s 7s'.replace('7s', '7h')), '45678 > 34567');
ok(gt('3c 4d 5h 6s 7s', '3s 4s 5h 6d 7h'), 'same level: compare top card suit (♠7 > ♥7)');
ok(gt('2s 3c 4d 5h 6c', '2h 3s 4s 5s 6s'.replace('6s', '6d')), '23456: decided by the 2 (♠2 > ♥2)');
ok(gt('Ac 2s 3c 4d 5h', 'As 2h 3s 4s 5s'.replace('5s', '5d')), 'A2345: decided by the 2, not the A');
ok(!gt('3c 4d 5h 6s 7c', '3d 4c 5c 6c 7d'), '♣7 top < ♦7 top');
// --- full house / four / straight flush ---
ok(type('8c 8d 8h 3c 3d') === '葫蘆', 'full house'); ok(type('8c 8d 8h 8s 3d') === '鐵支', 'four of a kind');
ok(type('5h 6h 7h 8h 9h') === '同花順', 'straight flush'); ok(type('Ah 2h 3h 4h 5h') === '同花順', 'A2345 flush straight');
ok(type('Jh Qh Kh Ah 2h') === null, 'JQKA2 flush still illegal (no flush rule)');
ok(gt('9c 9d 9h 3c 3d', '8c 8d 8h As Ah'), 'FH compares triple'); ok(gt('3c 3d 3h 3s 4d', '2c 2d 2h Ac Ad'), 'four beats full house');
ok(gt('3c 4c 5c 6c 7c', '2c 2d 2h 2s Ad'), 'straight flush beats four'); ok(gt('8c 8d 8h 3c 3d', '10c Jd Qh Ks Ac'), 'full house beats straight');
ok(gt('4c 4d 4h 4s 3c', '3d 3h 3s 3c 4d'.replace('3c', '5c')), 'four compares quad rank');
ok(gt('3d 4d 5d 6d 7d', '3c 4c 5c 6c 7c'), 'SF same level: suit'); ok(gt('2c 3c 4c 5c 6c', '10s Js Qs Ks As'), 'SF 23456 > SF 10JQKA');
ok(gt('4c 5c 6c 7c 8c', '3s 4s 5s 6s 7s'), 'SF level before suit');
// --- flush option ---
ok(type('3h 7h 9h Jh Kh') === null, 'flush illegal by default'); ok(type('3h 7h 9h Jh Kh', FL) === '同花', 'flush with option');
ok(gt('3h 7h 9h Jh Kh', '10c Jd Qh Ks Ac', FL), 'flush > straight'); ok(gt('8c 8d 8h 3c 3d', '3h 7h 9h Jh Kh', FL), 'full house > flush');
ok(gt('3c 7c 9c Jc Ac', '3h 7h 9h Jh Kh', FL), 'flush rank first (TW)'); ok(gt('3h 7h 9h Jh Kh', '3c 7c 9c Jc Ac', HK), 'flush suit first (HK preset)');
ok(gt('4c 7c 9c Jc Kc', '3h 7h 9h Jh Kh', FL), 'flush: equal top cards -> lowest card decides (TW)');
// --- bomb option ---
ok(!gt('3c 3d 3h 3s 4d', '2s'), 'no bomb on single by default'); ok(gt('3c 3d 3h 3s 4d', '2s', BO), 'four bombs single with option');
ok(gt('3c 4c 5c 6c 7c', '2s 2h', BO), 'SF bombs pair'); ok(!gt('8c 8d 8h 3c 3d', '2s', BO), 'full house is not a bomb');
ok(!gt('2s', '3c 3d 3h 3s 4d', BO), 'single cannot answer five'); ok(!gt('3c 3d', '4c'), 'different count rejected');
// --- game flow ---
{ const g = new B2.Game({ seed: 42 }); const p = g.turn; ok(g.hands[p].includes(0), '♣3 holder starts');
  const non3 = g.hands[p].find(x => x !== 0); ok(g.play([non3]) && g.turn === p, 'first play must contain ♣3');
  ok(!!g.pass(), 'cannot pass while leading'); ok(g.play([0]) === null, 'play ♣3');
  const t1 = g.turn; g.pass(); g.pass(); g.pass(); ok(g.lead === null && g.turn === p, 'three passes -> control returns to last player');
  ok(g.turn !== t1, 'turn order advanced'); }
{ // passed players may re-enter the same trick by default
  const g = new B2.Game({ hands: [cs('3c 5c 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')] });
  g.play([c('3c')]); g.pass(); g.play([c('4d')]); g.play([c('4h')]); g.play([c('5c')]);
  ok(g.turn === 1 && !g.lead === false, 'default: player 1 who passed may play again');
  ok(g.play([c('6c')]) === null, 'player 1 re-enters after earlier pass'); }
{ // passLock: once passed, skipped for the rest of the trick
  const g = new B2.Game({ rules: LK, hands: [cs('3c 5c 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')] });
  g.play([c('3c')]); g.pass(); g.play([c('4d')]); g.play([c('4h')]); g.play([c('5c')]);
  ok(g.turn === 2, 'passLock: locked player 1 skipped'); g.pass(); g.pass(); ok(g.lead === null && g.turn === 0, 'passLock: trick ends when all others locked'); }
{ // game ends when a hand is empty; last player with 1 card keeps their turn
  const g = new B2.Game({ hands: [cs('3c 2s'), cs('4c 6c'), cs('4d 7c'), cs('4h 8c')] });
  g.play([c('3c')]); g.play([c('4c')]); g.play([c('4d')]); g.play([c('4h')]); g.play([c('2s')]); ok(g.winner === 0, 'empty hand wins'); }
{ const g = new B2.Game({ hands: [cs('3c 3d 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')], rules: TW });
  ok(!!g.play([c('3c'), c('3d'), c('9c')]), 'three random cards rejected'); ok(g.check(0, [c('3c'), c('3d')]) === null, 'pair with ♣3 accepted'); }
// --- scoring ---
const P = s => B2.penalty(cs(s), TW);
ok(P('3c') === 1, '1 card = 1'); ok(P('3c 4c 5c 6c 7c 8c 9c') === 7, '7 cards = 7'); ok(P('3c 4c 5c 6c 7c 8c 9c 10c') === 16, '8 cards ×2 = 16');
ok(P('3c 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac') === 24, '12 cards ×2'); ok(P('3c 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac 2c') === 13 * 3 * 2, '13 cards ×3 and one 2 ×2 = 78');
ok(P('2c 4c') === 4, 'one 2 doubles'); ok(P('2c 2d 4c') === 12, 'two 2s ×4'); ok(B2.penalty(cs('2c 2d 4c'), NO2) === 3, 'twoDouble off');
{ const d = B2.roundDeltas([[], cs('3c'), cs('3d 4d 5d 6d 7d 8d 9d 10d'), cs('2c 2d')], 0, TW); ok(d[0] === 1 + 16 + 8 && d[1] === -1 && d[2] === -16 && d[3] === -8, 'winner collects sum'); }
// --- deal / seeds ---
{ const a = B2.deal(7), b = B2.deal(7), all = a.flat().sort((x, y) => x - y);
  ok(JSON.stringify(a) === JSON.stringify(b), 'seeded deal reproducible'); ok(all.length === 52 && all.every((x, i) => x === i), '52 unique cards, 13 each') ; ok(a.every(h => h.length === 13), '13 per hand'); }
// --- move generation / hints ---
{ const h = cs('3c 3d 4h 5s 6c 7d 7s'); const m = B2.genMoves(h, TW, ev('3h'), false); ok(m.length && m.every(x => x.cards.length === 1 && x.cards[0] > c('3h')), 'hints beat a single');
  const f = B2.genMoves(cs('3c 4d 5h 6s 7c 8d'), TW, null, true); ok(f.every(x => x.cards.includes(0)), 'first-move hints include ♣3'); ok(f.some(x => x.ev.cat === 1), 'first-move straight found');
  const sorted = B2.genMoves(cs('3c 9d Kh 2s'), TW, ev('4c'), false).map(x => x.cards[0]); ok(sorted.join() === [c('9d'), c('Kh'), c('2s')].join(), 'hints sorted small to large'); }
// --- AI legality: 300 random rounds with every rule option on, mixed levels ---
{ let bad = 0; const rules = B2.mkRules({ flush: true, triple: true, bomb: true, passLock: true });
  for (let s = 0; s < 300; s++) { const g = new B2.Game({ seed: s + 1, rules }); let k = 0;
    while (g.winner < 0 && k++ < 400) { const r = B2.think({ view: B2.aiView(g, g.turn), level: k % 2, seed: s * 99 + k }); const e = r.cards ? g.play(r.cards) : g.pass(); if (e) { bad++; break; } }
    if (g.winner < 0) bad++; }
  ok(bad === 0, 'AI never makes illegal moves / stalls with all options'); }
console.log(`tests: ${pass} passed, ${fail} failed (${pass + fail} total)`);
process.exit(fail ? 1 : 0);
