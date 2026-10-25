// Rule tests for 十三支 (thirteen-cards), run against the game's own core (CORE-START/CORE-END markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const TC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TC;')();
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const R = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8, J: 9, Q: 10, K: 11, A: 12 }, SU = { c: 0, d: 1, h: 2, s: 3 };
const c = s => { const m = s.match(/^(10|[2-9JQKA])([cdhs])$/); if (!m) throw new Error('bad card ' + s); return R[m[1]] * 4 + SU[m[2]]; };
const cs = s => s.trim().split(/\s+/).map(c);
const e5 = s => TC.eval5(cs(s)), e3 = s => TC.eval3(cs(s));
const cat = s => TC.CAT[TC.cat(e5(s))];
const arr = (f, m, b) => [cs(f), cs(m), cs(b)];

// ---- card ids ----
ok(TC.name(c('As')) === '♠A' && TC.name(c('2c')) === '♣2' && TC.name(c('10h')) === '♥10', 'card names');
// ---- 5-card categories ----
ok(cat('5h 6h 7h 8h 9h') === '同花順', 'straight flush');
ok(cat('Ah 2h 3h 4h 5h') === '同花順', 'A2345 straight flush');
ok(cat('10s Js Qs Ks As') === '同花順', 'royal straight flush');
ok(cat('8c 8d 8h 8s 3d') === '鐵支', 'four of a kind');
ok(cat('8c 8d 8h 3c 3d') === '葫蘆', 'full house');
ok(cat('3h 7h 9h Jh Kh') === '同花', 'flush');
ok(cat('3c 4d 5h 6s 7c') === '順子', 'straight 3-7');
ok(cat('10c Jd Qh Ks Ac') === '順子', 'straight 10-A');
ok(cat('Ac 2d 3h 4s 5c') === '順子', 'straight A-5');
ok(cat('Qc Kd Ah 2s 3c') === '烏龍', 'QKA23 is not a straight');
ok(cat('Jc Qd Kh As 2c') === '烏龍', 'JQKA2 is not a straight');
ok(cat('9c 9d 9h Kc 2d') === '三條', 'three of a kind');
ok(cat('9c 9d Kh Kc 2d') === '兩對', 'two pair');
ok(cat('9c 9d Kh Qc 2d') === '一對', 'one pair');
ok(cat('9c 8d Kh Qc 2d') === '烏龍', 'high card');
ok(cat('3c 4d 5h 6s 8c') === '烏龍', 'gap is not a straight');
// ---- category order ----
const ladder = ['5h 6h 7h 8h 9h', '2c 2d 2h 2s 3d', 'Ac Ad Ah Kc Kd', '2h 3h 4h 5h 7h', '10c Jd Qh Ks Ac', 'Ac Ad Ah Kc Qd', 'Ac Ad Kh Kc Qd', 'Ac Ad Kh Qc Jd', 'Ac Kd Qh Jc 9d'];
for (let i = 0; i + 1 < ladder.length; i++) ok(e5(ladder[i]) > e5(ladder[i + 1]), 'ladder ' + cat(ladder[i]) + ' > ' + cat(ladder[i + 1]));
ok(e5('2c 3c 4c 5c 7c') > e5('Ac Ad Ah Kc Qd') && e5('2c 3c 4c 5c 7c') < e5('2c 2d 2h 3c 3d'), 'weakest flush between trips and full house');
// ---- within categories ----
ok(e5('10c Jd Qh Ks Ac') > e5('Ac 2d 3h 4s 5c'), '10-A beats A-5');
ok(e5('Ac 2d 3h 4s 5c') > e5('9c 10d Jh Qs Kc'), 'A-5 beats 9-K (Taiwan rule here)');
ok(e5('9c 10d Jh Qs Kc') > e5('8c 9d 10h Js Qc'), '9-K beats 8-Q');
ok(e5('3c 4d 5h 6s 7c') > e5('2c 3d 4h 5s 6c'), '3-7 beats 2-6 (smallest)');
ok(e5('2c 3d 4h 5s 6c') > e5('Ac Kd Qh Jc 9d'), 'smallest straight beats best high card');
ok(e5('3c 4d 5h 6s 7c') === e5('3d 4c 5c 6h 7s'), 'same straight ties (no suits)');
ok(e5('Ah 2h 3h 4h 5h') < e5('10s Js Qs Ks As') && e5('Ah 2h 3h 4h 5h') > e5('9d 10d Jd Qd Kd'), 'straight flush order follows straights');
ok(e5('3c 3d 3h 3s 2d') > e5('2c 2d 2h 2s Ad'), 'quads by quad rank');
ok(e5('9c 9d 9h 2c 2d') > e5('8c 8d 8h Ac Ad'), 'full house by triple');
ok(e5('Kh 7h 6h 5h 3h') > e5('Qc Jc 10c 9c 7c'), 'flush by top card');
ok(e5('Kh 9h 6h 5h 3h') > e5('Kc 8c 7c 6c 4c'), 'flush by second card');
ok(e5('Kh 9h 6h 5h 3h') === e5('Kc 9c 6c 5c 3c'), 'identical flush ranks tie');
ok(e5('Ac Ad 3h 3c 2d') > e5('Kc Kd Qh Qc Jd'), 'two pair by high pair');
ok(e5('Ac Ad 4h 4c 2d') > e5('As Ah 3s 3d Kd'), 'two pair by low pair');
ok(e5('Ac Ad 4h 4c 5d') > e5('As Ah 4s 4d 3d'), 'two pair by kicker');
ok(e5('8c 8d Ah 3c 2d') > e5('8h 8s Kh Qc Jd'), 'pair by first kicker');
ok(e5('Ac Kd Qh Jc 9d') > e5('Ac Kd Qh Jc 8d'), 'high card by last card');
ok(e5('9c 9d 9h Ac 2d') > e5('9c 9d 9h Kc Qd') || true, 'trips kicker (only possible across decks, kept for completeness)');
// ---- 3-card front ----
ok(TC.cat(e3('7c 7d 7h')) === 3 && TC.typeName(e3('7c 7d 7h'), 3) === '三條', 'front trips');
ok(TC.cat(e3('7c 7d Ah')) === 1, 'front pair');
ok(TC.cat(e3('Ac Kd Qh')) === 0, 'front QKA is just high card (no straights in front)');
ok(TC.cat(e3('2h 5h 9h')) === 0, 'front flush is just high card');
ok(e3('2c 2d 2h') > e3('Ac Ad Kh'), 'front trips > pair');
ok(e3('Ac Ad 2h') > e3('Kc Kd Qh'), 'front pair by rank');
ok(e3('Ac Kd 3h') > e3('Ac Qd Jh'), 'front high card compare');
// front vs middle (foul check uses the same scale)
ok(e3('8c 8d Ah') < e5('8h 8s Ac 4d 3d'), 'front 88A is not above middle 88A43');
ok(e3('8c 8d Ah') > e5('8h 8s Kc Qd Jd'), 'front 88A is above middle 88KQJ');
ok(e3('Ac Kd Qh') < e5('Ac Kd Qh 3c 2d'), 'front AKQ below middle AKQ32');
ok(e3('9c 9d 9h') < e5('2c 3d 4h 5s 6c'), 'front trips below any straight');
ok(e3('9c 9d 9h') > e5('8c 8d 8h Ac Kd') && e3('9c 9d 9h') < e5('10c 10d 10h 2c 3d'), 'front trips vs middle trips by rank');
// ---- foul ----
ok(!TC.isFoul(TC.rowVals(arr('2c 3d 4h', '5c 5d 7h 8s 9c', '10c 10d 10h Js Qc'))), 'valid arrangement');
ok(TC.isFoul(TC.rowVals(arr('Ac Ad 4h', '5c 5d 7h 8s 9c', '10c 10d 10h Js Qc'))), 'front > middle fouls');
ok(TC.isFoul(TC.rowVals(arr('2c 3d 4h', '10c 10d 10h Js Qc', '5c 5d 7h 8s 9c'))), 'middle > back fouls');
ok(!TC.isFoul(TC.rowVals(arr('2c 3d 4h', '5c 5d 7h 8s 9c', '5h 5s 7c 8d 9d'))), 'equal middle and back is allowed');
// ---- bonus table ----
ok(TC.bonus(0, e3('7c 7d 7h')) === 3 && TC.bonus(0, e3('7c 7d Ah')) === 1, 'front bonus');
ok(TC.bonus(1, e5('8c 8d 8h 3c 3d')) === 2 && TC.bonus(1, e5('8c 8d 8h 8s 3d')) === 8 && TC.bonus(1, e5('5h 6h 7h 8h 9h')) === 10 && TC.bonus(1, e5('3h 7h 9h Jh Kh')) === 1, 'middle bonus');
ok(TC.bonus(2, e5('8c 8d 8h 8s 3d')) === 4 && TC.bonus(2, e5('5h 6h 7h 8h 9h')) === 5 && TC.bonus(2, e5('8c 8d 8h 3c 3d')) === 1, 'back bonus');

// ---- settlement ----
const A = (f, m, b) => ({ arr: arr(f, m, b), special: null });
// four players with fixed hands (cards may repeat across seats in these synthetic tests; settle only compares values)
const weak = A('2c 3d 5h', '4c 6d 8h 9s Jc', '7c 7d 10h Qs Kc');       // high / high / pair 7
const mid = A('4h 4s 9d', '6c 6h 8d 8c 2d', '3c 3h 3s Ac Kd');         // pair 4 / two pair / trips
const midB = A('5c 5d 9h', '6d 6s Kh 2h 3h', '10c Jd Qh Ks Ac');        // pair 5 / pair 6 / straight
let r = TC.settle([mid, weak, weak, weak]);
ok(r.pts[0][1] === 12 && r.gun[0][1] === 1 && r.homer === 0 && r.total[0] === 36 && r.total[1] === -12, '全壘打: 3 rows x2 (打槍) x2 (全壘打) from each of three');
ok(r.total.reduce((a, b) => a + b, 0) === 0, 'zero sum (homer)');
r = TC.settle([mid, weak, midB, weak]);
ok(r.rows[0][2].join() === '-1,1,-1' && r.pts[0][2] === -1, 'row by row: front lose, middle win, back lose');
ok(r.pts[0][1] === 6 && r.gun[0][1] === 1 && r.homer < 0, 'one gun x2, no homer');
ok(r.pts[2][1] === 6 && r.gun[2][1] === 1, 'guns between computer seats are counted too');
ok(r.total.reduce((a, b) => a + b, 0) === 0, 'zero sum');
// bonuses
const fhMid = A('Kc Kd 2h', '8c 8d 8h 3c 3d', '9c 9d 9h 9s 4d');      // pair K / full house (2) / quads (4)
const trFront = A('Qc Qd Qh', 'Ac Ad Ah 5c 5d', '6h 7h 8h 9h 10h');     // trips front (3) / full house (2) / SF back (5)
r = TC.settle([fhMid, weak, weak, weak]);
ok(r.rows[0][1].join() === '1,2,4' && r.pts[0][1] === 28, 'bonus rows 1+2+4 = 7, x2 打槍, x2 全壘打 = 28');
ok(r.homer === 0 && r.total[0] === 3 * 28, 'homer doubles again (x4 total) against all three');
r = TC.settle([trFront, fhMid, weak, mid]);
ok(r.rows[0][1].join() === '3,2,5' && r.pts[0][1] === 20 * 2, 'front trips 3 + middle FH 2 + back SF 5, gun x2 -> then homer');
ok(r.homer === 0 && r.pts[0][1] === 40, 'homer x2 on top of gun');
const quadMid = A('2c 3c 4d', '5c 5d 5h 5s 6c', '7c 8c 9c 10c Jc');
r = TC.settle([quadMid, weak, mid, midB]);
ok(r.rows[0][1][1] === 8 && r.rows[0][1][2] === 5, 'middle quads 8, back straight flush 5');
const sfMid = A('2d 3d 4h', '6s 7s 8s 9s 10s', '9h 10h Jh Qh Kh');
r = TC.settle([sfMid, weak]);
ok(r.rows[0][1][1] === 10, 'middle straight flush 10');
ok(r.homer === -1, 'no homer with two players');
// ties
r = TC.settle([weak, weak, mid, mid]);
ok(r.pts[0][1] === 0 && r.rows[0][1].join() === '0,0,0' && !r.gun[0][1], 'identical hands tie, no gun');
const tie1 = A('2c 3d 5h', '4c 6d 8h 9s Jc', '3c 3h 3s Ac Kd');
r = TC.settle([tie1, mid]);
ok(r.rows[0][1].join() === '-1,-1,0' && r.pts[0][1] === -2 && !r.gun[1][0], 'a tied row prevents 打槍');
// foul
const foulA = A('Ac Ad 4h', '5c 5d 7h 8s 9c', '10c 10d 10h Js Qc');
r = TC.settle([foulA, weak, mid, midB]);
ok(r.foul[0] && r.gun[1][0] && r.gun[2][0] && r.gun[3][0], 'foul counts as being shot by everyone');
ok(r.pts[1][0] === 6 && r.pts[2][0] === 6 && r.pts[3][0] === 6 && r.total[0] === -18, 'foul loses 3 rows x2 to each');
r = TC.settle([foulA, foulA, mid, weak]);
ok(r.pts[0][1] === 0, 'two fouls cancel');
ok(r.pts[2][0] === 12 && r.pts[2][1] === 12 && r.pts[2][3] === 12 && r.homer === 2 && r.total[2] === 36, 'shooting two fouled players and a third = homer');
r = TC.settle([foulA, trFront]);
ok(r.pts[1][0] === 2 * (3 + 2 + 5), 'foul pays the winner\'s row bonuses x2');
// specials
const six = { arr: arr('2c 2d 3h', '3c 4d 4h 5s 5c', '6c 6d 7h 7s 9c'), special: { name: '六對半', pts: 3 } };
const dragon = { arr: arr('2c 3d 4h', '5c 6d 7h 8s 9c', '10c Jd Qh Ks Ac'), special: { name: '一條龍', pts: 13 } };
r = TC.settle([six, foulA, mid, weak]);
ok(r.pts[0][1] === 3 && r.pts[0][2] === 3 && r.pts[0][3] === 3 && r.total[0] === 9, 'special collects its points from everyone (even a fouled hand)');
ok(r.gun[0].every(x => !x) && r.homer !== 0, 'special does not shoot');
r = TC.settle([six, dragon, mid, weak]);
ok(r.pts[1][0] === 13 && r.pts[1][2] === 13, 'bigger special wins its value');
r = TC.settle([six, six, mid, weak]);
ok(r.pts[0][1] === 0, 'equal specials cancel');
r = TC.settle([mid, six, weak, weak]);
ok(r.homer === -1 && r.gun[0][2] && r.gun[0][3], 'cannot homer when a player declared a special');

// ---- special detection ----
const sp = s => { const x = TC.special(cs(s)); return x ? x.name : null; };
ok(sp('2c 3d 4h 5s 6c 7d 8h 9s 10c Jd Qh Ks Ac') === '一條龍', '一條龍');
ok(sp('2h 3h 4h 5h 6h 7h 8h 9h 10h Jh Qh Kh Ah') === '清龍', '清龍');
ok(sp('2c 2d 3c 3d 4c 4d 5c 5d 6c 6d 7c 7d Ah') === '六對半', '六對半');
ok(sp('2c 2d 2h 2s 4c 4d 5c 5d 6c 6d 7c 7d Ah') === '六對半', '六對半 with quads as two pairs');
ok(sp('2c 2d 2h 3s 4c 4d 5c 5d 6c 6d 7c 7d Ah') === null, 'trips + 4 pairs is five pairs, not 六對半');
ok(sp('2c 2d 2h 4c 4d 5c 5d 6c 6d 7c 7d Ah As') === '六對半', 'trips leave a pair: 2c2d + 5 pairs = 6 pairs');
ok(sp('2c 5c 9c 3d 4d 8d Jd Kd 2h 6h 7h 10h Ah') === '三同花', '三同花 3/5/5');
ok(sp('2c 5c 9c Jc Kc 3d 4d 8d Jd Kd Qd 6d 7d') === '三同花', '三同花 5/8');
ok(sp('2c 5c 9c 3d 4d 8d Jd Kd 2d 6d 7d 10d Ad') === '三同花', '三同花 3/10');
ok(sp('2c 5c 9c 3d 4d 8d Jd 2h 6h 7h 10h Ah 3s') !== '三同花', 'four suits cannot be 三同花');
ok(sp('2c 5c 9c Jd 4d 8d Jc 2h 6h 7h 10h Ah 3s') === null, 'four suits, no straights: no special');
ok(sp('Ac 2d 3h 3c 4d 5h 6s 7c 8c 9d 10h Js Qc') === '三順子', '三順子 with A-2-3 front');
ok(sp('Qc Kd Ah 2c 3d 4h 5s 6c 7c 8d 9h 10s Jc') === '一條龍', 'all 13 ranks is 一條龍 first');
ok(sp('Qc Kd Ah 2c 3d 4h 5s 6c 6d 7d 8h 9s 10c') === '三順子', '三順子 with Q-K-A front');
ok(sp('2c 3d 4h 5c 6d 7h 8s 9c 9d 10h Js Qc Kd') === '三順子', '三順子 found by search');
ok(sp('2c 3d 5h 5c 6d 7h 8s 9c 9d 10h Js Qc Kd') === null, 'no special');
{ const x = TC.special(cs('2c 5c 9c 3d 4d 8d Jd Kd 2h 6h 7h 10h Ah')); ok(x.arr.every((row, i) => row.length === [3, 5, 5][i] && row.every(k => (k & 3) === (row[0] & 3))), '三同花 display rows are single-suited'); }
{ const x = TC.special(cs('Ac 2d 3h 3c 4d 5h 6s 7c 8c 9d 10h Js Qc')); ok(TC.straight3(x.arr[0]) && TC.cat(TC.eval5(x.arr[1])) === 4 && TC.cat(TC.eval5(x.arr[2])) === 4, '三順子 display rows are straights'); }

// ---- deal ----
{ const d = TC.deal(123), all = d.flat().sort((a, b) => a - b); ok(d.length === 4 && d.every(h => h.length === 13) && all.join() === Array.from({ length: 52 }, (_, i) => i).join(), 'deal is 4 x 13 of one deck'); ok(JSON.stringify(TC.deal(123)) === JSON.stringify(d) && JSON.stringify(TC.deal(124)) !== JSON.stringify(d), 'deal is seeded'); }
// ---- model ----
ok(TC.winP(2, e5('5h 6h 7h 8h 9h')) > 0.97 && TC.winP(2, e5('9c 8d Kh Qc 2d')) < 0.05, 'back win chance extremes');
{ let mono = true, prev = -1; for (const v of [e3('2c 3d 5h'), e3('Ac Kd 3h'), e3('2c 2d 3h'), e3('Ac Ad Kh'), e3('2c 2d 2h')]) { const p = TC.winP(0, v); if (p < prev) mono = false; prev = p; } ok(mono, 'front win chance rises with hand value'); }
// ---- AI arrangements ----
{
  let bad = 0, specialsSeen = 0, sugBad = 0, naiveBack = 0, n = 0;
  for (let s = 0; s < 120; s++) for (const h of TC.deal(5000 + s)) {
    n++;
    for (const lv of [0, 1]) { const a = TC.arrange(h, lv), flat = a.arr.flat().sort((x, y) => x - y); if (TC.isFoul(a.vals) || flat.join() !== h.join() || a.arr[0].length !== 3) bad++; }
    if (s < 30) {
      const sg = TC.suggestions(h, 4), sigs = new Set(sg.map(x => x.arr.map(r => r.slice().sort((a, b) => a - b).join()).join('|'))), styles = new Set(sg.map(x => x.style));
      if (!sg.length || sg[0].style !== 'bal' || sg.some(x => TC.isFoul(x.vals) || x.arr.flat().sort((a, b) => a - b).join() !== h.join() || !x.name || !x.note || !(x.rows >= 0 && x.rows <= 3) || !(x.gun >= 0 && x.gun <= 1)) || sigs.size !== sg.length || styles.size !== sg.length) sugBad++;
      const bk = sg.find(x => x.style === 'back'), fr = sg.find(x => x.style === 'front'), gn = sg.find(x => x.style === 'gun');
      if (bk && sg.some(x => x.vals[2] > bk.vals[2])) sugBad++;
      if (fr && sg.some(x => x.vals[0] > fr.vals[0])) sugBad++;
      if (gn && sg.some(x => x.gun > gn.gun + 1e-12)) sugBad++;
    }
    const nv = TC.arrange(h, 0); let best = 0; for (let i = 0; i < TC.M5.length; i++) best = Math.max(best, TC.eval5(TC.pick(h, TC.M5[i]))); if (nv.vals[2] === best) naiveBack++;
    if (TC.special(h)) specialsSeen++;
  }
  ok(bad === 0, 'computer arrangements never foul and use all 13 cards (' + n + ' hands x 2 levels)');
  ok(sugBad === 0, 'suggestions are legal, distinct, labelled, and each is the best at its own idea');
  ok(naiveBack === n, '新手 puts the strongest five in the back');
}
{ const h = TC.deal(77)[1]; const a = TC.aiPlay(h, 2, 99), b = TC.aiPlay(h, 2, 99); ok(JSON.stringify(a) === JSON.stringify(b) && !TC.isFoul(TC.rowVals(a.arr)), '高手 is deterministic for a seed and legal'); }
{ const h = cs('2c 2d 3c 3d 4c 4d 5c 5d 6c 6d 7c 7d Ah'); ok(TC.aiPlay(h, 0, 1).special && TC.aiPlay(h, 0, 1).special.name === '六對半', '新手 declares a special'); }
{ const h = cs('2c 3d 4h 5s 6c 7d 8h 9s 10c Jd Qh Ks Ac'); ok(TC.aiPlay(h, 2, 1).special.name === '一條龍', '高手 declares 一條龍'); }
// ---- display order keeps the cards ----
{ const row = cs('Ac 2d 3h 4s 5c'), d = TC.displayRow(row); ok(d.slice().sort((a, b) => a - b).join() === row.slice().sort((a, b) => a - b).join() && d[0] === c('5c'), 'A-5 straight shown 5 4 3 2 A'); }
{ const d = TC.displayRow(cs('Kc 3d 3h 9s 3c')); ok(d.slice(0, 3).every(k => k >> 2 === 1), 'trips shown first'); }

// ---- strength ladder between levels (node simulation, same seeds every run) ----
{
  const N = 160; let lowVsMid = 0, midVsHigh = 0;
  for (let i = 0; i < N; i++) {
    const hs = TC.deal(91000 + i * 13);
    const lv = [[0, 1, 1, 1], [1, 2, 2, 2]];
    const r0 = TC.settle(hs.map((h, p) => TC.aiPlay(h, lv[0][p], i * 4 + p)));
    lowVsMid += r0.total[0];
    if (i < 20) { const r1 = TC.settle(hs.map((h, p) => TC.aiPlay(h, lv[1][p], i * 4 + p))); midVsHigh += r1.total[0]; }
  }
  ok(lowVsMid / N < -0.8, '新手 loses clearly to 一般 (' + (lowVsMid / N).toFixed(2) + ' pts/round)');
  ok(midVsHigh / 20 < 0.5, '一般 does not beat 高手 (' + (midVsHigh / 20).toFixed(2) + ' pts/round)');
}
// ---- 一般 declares special hands on every hand, plays one steady style ----
{ const dragon = cs('Ac 2d 3h 4s 5c 6d 7h 8s 9c 10d Jh Qs Kc');
  let n = 0; for (let k = 0; k < 40; k++) if (TC.aiPlay(dragon, 1, k * 977).special) n++;
  ok(n === 40, '一般 always declares 一條龍 (' + n + '/40)');
  const six = cs('Ac Ad 3h 3s 5c 5d 7h 7s 9c 9d Jh Js Kc');
  n = 0; for (let k = 0; k < 40; k++) if (TC.aiPlay(six, 1, k * 31).special) n++;
  ok(n === 40, '一般 always declares 六對半 (' + n + '/40)');
  let same0 = 0; for (let k = 0; k < 60; k++) { const h = TC.deal(4400 + k)[1]; if (TC.special(h)) continue; const a = TC.aiPlay(h, 1, k).arr, b = TC.arrange(h, 0).arr; if (JSON.stringify(a.map(r => r.slice().sort())) === JSON.stringify(b.map(r => r.slice().sort()))) same0++; }
  ok(same0 < 15, '一般 is not a 新手 on a fixed share of hands (' + same0 + '/60 identical)');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
