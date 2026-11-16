// Rule tests for 德州撲克 (texas-holdem): extracts the engine between the CORE markers of ../index.html and checks
// every special rule in the spec (evaluator, action order, min-raise, short all-in, heads-up, side pots, odd chips,
// showdown order/mucking, blinds, elimination) plus a 5,000-hand AI self-play for chip conservation / legality.
// Then release-review regressions in Chromium (real CDP touch, corrupt storage, layout, daily replays, hand-ranking reference).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const P = HE.parse, ev = s => HE.evalN(P(s), P(s).length), nm = s => HE.hname(ev(s));
function throws(f) { try { f(); return false; } catch (e) { return true; } }

// ---------- 1. evaluator: 50 cases ----------
const cats = [
  ['As Ks Qs Js Ts 2d 3c', '皇家同花順'], ['9h 8h 7h 6h 5h Ad Ac', '同花順'], ['5d 4d 3d 2d Ad Kc Kh', '同花順'], ['Ac Ad Ah As Kd 2c 3c', '四條'],
  ['Kc Kd Kh 2s 2d 9c 8c', '葫蘆'], ['Kc Kd Kh 2s 2d 2c 8c', '葫蘆'], ['Ah 9h 7h 4h 2h Kc Qd', '同花'], ['Ah 2c 3d 4s 5h Kc Kd', '順子'],
  ['Th Jc Qd Ks Ah 2c 2d', '順子'], ['7c 7d 7h Ks 2d 9c 4h', '三條'], ['7c 7d Kh Ks 2d 9c 4h', '兩對'], ['7c 7d Kh Ks 2d 2c 4h', '兩對'],
  ['7c 7d Kh 5s 2d 9c 4h', '一對'], ['Ac Jd 9h 7s 5d 3c 2h', '高牌'], ['Qs Js Ts 9s 8s 7s 6s', '同花順'], ['2c 3c 4c 5c 6c 7d 8d', '同花順'],
  ['Ac Kc Qc Jc 9c Th 8d', '同花'], ['As Ks Qs Js Ts', '皇家同花順'], ['Ac Ad As Kc Kd', '葫蘆'], ['2c 2d 3h 3s 4c 4d 5h', '兩對'], ['Td Jd Qd Kd 9d 8c 2c', '同花順']];
cats.forEach(([h, n]) => ok(nm(h) === n, 'category ' + h + ' -> ' + nm(h) + ' (want ' + n + ')'));
const order = [ // each strictly beats the next
  ['As Ks Qs Js Ts 2d 3c', '9h 8h 7h 6h 5h Ad Ac'], ['6d 5d 4d 3d 2d Ac Kh', '5h 4h 3h 2h Ah Kd Qc'], ['Ac Ad Ah As 2d 3c 4h', 'Kc Kd Kh Ks Ad 3c 4h'],
  ['2c 2d 2h 2s Ad 3c 4h', 'Ac Ad Ah Kd Ks 3c 4h'], ['Ac Ad Ah Kd Ks 3c 4h', 'Ac Ad Ah Qd Qs 3c 4h'], ['Kc Kd Kh Ad As 3c 4h', 'Qc Qd Qh Ad As 3c 4h'],
  ['Ah 9h 7h 4h 2h', '6c 5d 4s 3h 2c'], ['Ah Kh 7h 4h 3h', 'Ah Qh Jh Th 8h'], ['Ah Kh 7h 4h 3h', 'Ah Kh 7h 4h 2h'], ['6c 5d 4s 3h 2c', 'Ah 2c 3d 4s 5h'],
  ['Ah 2c 3d 4s 5h 9c Kd', 'Kc Kd Kh 7s 2d'], ['Th Jc Qd Ks Ah', 'Kh Qc Jd Ts 9h'], ['7c 7d 7h Ks 2d', '6c 6d 6h As Kd'], ['7c 7d 7h As 2d', '7c 7d 7h Ks Qd'],
  ['7c 7d Kh Ks 2d', '7c 7d Qh Qs Ad'], ['7c 7d Kh Ks 9d', '7c 7d Kh Ks 8d'], ['Kc Kd 2h 2s 3d', 'Qc Qd Jh Js Ad'], ['7c 7d Kh 5s 2d', '6c 6d Ah Ks Qd'],
  ['7c 7d Ah 5s 2d', '7c 7d Kh Qs Jd'], ['7c 7d Ah 5s 3d', '7c 7d Ah 5s 2d'], ['Ac Jd 9h 7s 5d', 'Ac Jd 9h 7s 4d'], ['Ac 2d 3h 4s 6d', 'Kc Qd Jh 9s 8d'],
  ['2c 2d 3h 3s 5c 5d Th', '2c 2d 3h 3s 5c 5d 4h'], ['Ac Kc Qc Jc 9c', 'Ac Kc Qc Jc 8c']];
order.forEach(([a, b]) => ok(ev(a) > ev(b), 'order ' + a + ' > ' + b));
ok(ev('Ah Kd 9c 7s 4h 3c 2d') === ev('As Kc 9d 7h 4d 3s 2h'), 'suits never break ties');
ok(ev('As Ks Qs Js Ts 2h 2c') === ev('Ah Kh Qh Jh Th 3c 2s'), 'two royal flushes tie');
ok(ev('Ad 2c 3h 4s 5d Kc 6h') > ev('Ad 2c 3h 4s 5d Kc 9h'), '6-high straight beats wheel');
ok(ev('Ac Kd Qh Js Ts') === ev('Ah Kc Qd Jc Th'), 'equal broadway tie');
ok(HE.best5(P('Ah 2c 3d 4s 5h Kc Kd')).map(HE.cardStr).sort().join() === ['Ah', '2c', '3d', '4s', '5h'].sort().join(), 'best5 picks the A-5 wheel');
console.log('evaluator cases:', cats.length + order.length + 5);
{ const hs = []; for (let i = 0; i < 100000; i++) hs.push(HE.shuffled(i).slice(0, 7)); let t = Date.now(), s = 0; for (let k = 0; k < 10; k++) for (const h of hs) s += HE.evalN(h, 7); const r = 1e6 * 1000 / (Date.now() - t);
  console.log('evaluator speed:', Math.round(r).toLocaleString(), '7-card evals/s'); ok(r > 2e6, 'evaluator > 2M evals/s'); }
// exhaustive category frequencies over all C(52,5) five-card hands (reference values recomputed, not from memory)
{ const cnt = new Array(10).fill(0), h = [0, 0, 0, 0, 0];
  for (h[0] = 0; h[0] < 52; h[0]++) for (h[1] = h[0] + 1; h[1] < 52; h[1]++) for (h[2] = h[1] + 1; h[2] < 52; h[2]++) for (h[3] = h[2] + 1; h[3] < 52; h[3]++) for (h[4] = h[3] + 1; h[4] < 52; h[4]++) cnt[HE.cat(HE.evalN(h, 5))]++;
  const want = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
  ok(want.every((w, i) => cnt[i] === w), 'all 2,598,960 five-card hands fall into the textbook category counts ' + cnt.join(','));
}
// equity table
ok(Math.abs(HE.EQ[0] - 0.852) < 0.003 && Math.abs(HE.EQ[1] - 0.670) < 0.004, 'AA 85.2%, AKs ~67% vs random hand');
ok(HE.clsName(HE.cls(P('As Ks')[0], P('As Ks')[1])) === 'AKs' && HE.clsName(HE.cls(P('7d')[0], P('2c')[0])) === '72o', '169 classes named');
ok(HE.PCT[0] < 0.01 && HE.PCT[HE.cls(P('7d')[0], P('2c')[0])] > 0.95 && HE.PCT[HE.cls(P('3d')[0], P('2c')[0])] > 0.99, 'AA is top, 72o/32o are bottom of the percentile table');
ok(Math.abs(HE.equity(P('Ah Ad'), [], [1], 40000, HE.rng(3)) - 0.852) < 0.01, 'Monte Carlo agrees with table for AA');
{ const e = HE.equity(P('Ah Kh'), P('Qh Jh 2c'), [1], 20000, HE.rng(5)); ok(e > 0.65 && e < 0.85, 'MC handles draws (AKh on QJh2c = ' + (e * 100).toFixed(1) + '%)'); }

// ---------- helpers to rig tables ----------
function table(chips, opts) { opts = opts || {}; return HE.newTable(Object.assign({ seed: 9, players: chips.map((c, i) => ({ name: 'P' + i })), chips: 2000 }, opts)); }
function setChips(T, chips) { T.p.forEach((p, i) => p.chips = chips[i]); T.total = chips.reduce((a, b) => a + b, 0); }
function rig(T, holes, board) { // call right after startHand
  holes.forEach((h, i) => { if (h) T.p[i].hole = P(h); });
  const b = P(board || '2c 3d 4h 8s 9c'), used = new Set(T.p.flatMap(p => p.hole).concat(b));
  const rest = []; for (let c = 0; c < 52; c++) if (!used.has(c)) rest.push(c);
  T.deck = T.deck.slice(0, T.dk).concat([rest.pop(), b[0], b[1], b[2], rest.pop(), b[3], rest.pop(), b[4]], rest);
}
function start(T, dealer) { T.dealer = dealer === undefined ? -1 : (dealer - 1 + T.p.length) % T.p.length; if (dealer !== undefined) { const save = T.dealer; } HE.startHand(T); return T; }
// startHand moves the button to the next live seat, so pre-set dealer to the seat before
function hand(chips, dealer, opts) { const T = table(chips, opts); setChips(T, chips); T.dealer = (dealer - 1 + chips.length) % chips.length; HE.startHand(T); return T; }
const A = (T, i, a, to) => HE.act(T, i, a, to);

// ---------- 2. action order, blinds ----------
{ const T = hand([2000, 2000, 2000, 2000, 2000, 2000], 0);
  ok(T.dealer === 0 && T.sbI === 1 && T.bbI === 2 && T.p[1].bet === 10 && T.p[2].bet === 20, '6-max: SB/BB left of the button');
  ok(T.toAct === 3, 'preflop: first to act is left of the big blind (UTG)');
  [3, 4, 5, 0, 1].forEach(i => A(T, i, 'call')); ok(T.toAct === 2, 'big blind gets the option after limps');
  ok(HE.legal(T, 2).canCheck && HE.legal(T, 2).canRaise, 'BB option: may check or raise'); A(T, 2, 'check');
  ok(T.street === 1 && T.board.length === 3 && T.toAct === 1, 'flop: first live seat left of the button acts first');
  A(T, 1, 'check'); A(T, 2, 'fold'); A(T, 3, 'check'); A(T, 4, 'check'); A(T, 5, 'check'); A(T, 0, 'check');
  ok(T.street === 2 && T.board.length === 4 && T.toAct === 1, 'turn deals one card, order skips folded seats');
  ok(throws(() => A(T, 3, 'check')), 'acting out of turn is rejected'); }
{ const T = hand([2000, 2000], 0);
  ok(T.sbI === 0 && T.bbI === 1 && T.toAct === 0, 'heads-up: button is the small blind and acts first preflop');
  A(T, 0, 'call'); A(T, 1, 'check'); ok(T.toAct === 1, 'heads-up: button acts last after the flop'); }
{ const T = hand([2000, 2000, 2000], 2); ok(T.dealer === 2 && T.sbI === 0 && T.bbI === 1 && T.toAct === 2, '3-handed: button acts first preflop'); }
{ const T = table([2000, 2000, 2000, 2000]); T.dealer = 3; HE.startHand(T); const d1 = T.dealer;
  while (!T.done) A(T, T.toAct, 'fold'); HE.startHand(T); ok(T.dealer === (d1 + 1) % 4, 'button moves clockwise each hand'); }
{ const T = table([2000, 2000, 2000]); setChips(T, [2000, 0, 2000]); T.p[1].out = true; T.dealer = 2; HE.startHand(T); ok(T.dealer === 0 && T.sbI === 0 && T.bbI === 2, 'eliminated seats are skipped; heads-up blinds after a bust'); }

// ---------- 3. betting rules ----------
{ const T = hand([2000, 2000, 2000, 2000], 0); // dealer 0, SB1, BB2, UTG3
  let L = HE.legal(T, 3); ok(L.minTo === 40 && L.toCall === 20, 'min open raise = 2 BB');
  ok(throws(() => A(T, 3, 'raise', 30)), 'raise below the minimum is rejected');
  A(T, 3, 'raise', 70); L = HE.legal(T, 0); ok(L.minTo === 120, 'min re-raise = last raise increment (70+50)');
  A(T, 0, 'raise', 200); ok(HE.legal(T, 1).minTo === 330, 'increment grows with each full raise (200+130)');
  A(T, 1, 'fold'); A(T, 2, 'fold'); A(T, 3, 'call');
  ok(T.street === 1 && HE.legal(T, 3).minTo === 20, 'postflop minimum bet is one big blind');
  A(T, 3, 'raise', 20); ok(HE.legal(T, 0).minTo === 40, 'min raise over a 1-BB bet is 2 BB'); }
{ // short all-in does not reopen the betting
  const T = hand([2000, 2000, 2000, 2000], 0); setChips(T, [2000, 1990, 1980, 2000]); // after blinds
  A(T, 3, 'call'); A(T, 0, 'call'); A(T, 1, 'call'); A(T, 2, 'check'); // flop, all 20 in
  T.p[2].chips = 130; T.total = T.p.reduce((a, p) => a + p.chips + p.tot, 0);
  A(T, 1, 'raise', 100); // bet 100
  A(T, 2, 'allin'); ok(T.cur === 130 && T.minR === 100, 'short all-in (130 < min raise 200) leaves min raise unchanged');
  A(T, 3, 'call');
  ok(T.toAct === 0 && HE.legal(T, 0).canRaise, 'a player who has not acted may still raise');
  A(T, 0, 'call'); ok(T.toAct === 1, 'original bettor must act again'); ok(!HE.legal(T, 1).canRaise, 'short all-in does NOT reopen raising to the original bettor');
  ok(throws(() => A(T, 1, 'raise', 400)), 'raise attempt is rejected'); A(T, 1, 'call'); ok(T.street === 2, 'round closes after the call'); }
{ // a full-size all-in does reopen
  const T = hand([2000, 2000, 2000], 0); // D0 SB1 BB2, UTG = 0
  T.p[2].chips = 300; T.total = T.p.reduce((a, p) => a + p.chips + p.tot, 0);
  A(T, 0, 'raise', 60); A(T, 1, 'call'); A(T, 2, 'allin'); // 320 total: increment 260 >= 40
  ok(HE.legal(T, 0).canRaise, 'full all-in raise reopens the action'); }
{ // all-in for less than a call
  const T = hand([2000, 2000, 2000], 0); T.p[1].chips = 5; T.total = T.p.reduce((a, p) => a + p.chips + p.tot, 0);
  A(T, 0, 'raise', 100); A(T, 1, 'call'); ok(T.p[1].allin && T.p[1].tot === 15, 'calling with too few chips puts the player all-in for less'); }

// ---------- 4. pots ----------
{ // three different all-in amounts + a covering player
  const T = hand([2000, 2000, 2000, 2000], 0);
  setChips(T, [100, 290, 580, 2000]); T.p[1].chips = 290; T.p[2].chips = 580; // blinds already posted 10/20
  T.total = T.p.reduce((a, p) => a + p.chips + p.tot, 0);
  rig(T, ['Ah Ad', 'Kh Kd', 'Qh Qd', 'Jh Jd'], '2c 3d 7h 8s 9c');
  A(T, 3, 'allin'); A(T, 0, 'allin'); A(T, 1, 'allin'); A(T, 2, 'allin');
  const evs = T.ev.filter(e => e.t === 'win');
  const tot = {}; evs.forEach(e => e.winners.forEach(w => tot[w.p] = (tot[w.p] || 0) + w.amt));
  ok(tot[0] === 400 && tot[1] === 3 * 200 && tot[2] === 2 * 300 && !tot[3], 'main + 2 side pots go to the best eligible hand each ' + JSON.stringify(tot));
  ok(T.ev.some(e => e.t === 'refund' && e.p === 3 && e.amt === 1400), 'uncalled excess is returned');
  ok(T.ev.some(e => e.t === 'reveal'), 'hands are turned up when everyone is all-in');
  ok(T.p.reduce((a, p) => a + p.chips, 0) === T.total, 'chips conserved'); }
{ // side pot won by a shorter stack's worse hand when the best hand is only in the main pot
  const T = hand([2000, 2000, 2000], 0); setChips(T, [200, 990, 980]); T.total = 200 + 1000 + 1000;
  rig(T, ['Ah Ad', 'Kh Kd', 'Qh Qd'], '2c 3d 7h 8s 9c');
  A(T, 0, 'allin'); A(T, 1, 'allin'); A(T, 2, 'call');
  ok(T.p[0].chips === 600 && T.p[1].chips === 1600 && T.p[2].chips === 0, 'short stack wins main pot only; second best wins the side pot'); }
{ const T = hand([2000, 2000, 2000], 0); rig(T, ['2h 3d', 'Ah Kd', 'As Kc'], 'Qc Jd Th 4s 5c');
  A(T, 0, 'fold'); A(T, 1, 'call'); A(T, 2, 'check'); while (!T.done) A(T, T.toAct, 'check');
  ok(T.p[1].chips === T.p[2].chips && T.p[1].chips === 2000, 'equal hands split the pot evenly'); }
{ const T = hand([2000, 2000, 2000, 2000], 0); // D0 SB1 BB2 UTG3
  rig(T, ['2h 3d', 'Ah Kd', 'As Kc', '7c 2s'], 'Qc Jd Th 4s 5c');
  A(T, 3, 'call'); A(T, 0, 'fold'); A(T, 1, 'call'); A(T, 2, 'check'); // 60 in pot
  A(T, 1, 'raise', 25); A(T, 2, 'call'); A(T, 3, 'fold'); // pot 110 -> 55 each
  while (!T.done) A(T, T.toAct, 'check');
  const w = T.res.wins; ok(w.length === 2 && w[0].amt + w[1].amt === 110, 'split');
  const T2 = hand([2000, 2000, 2000, 2000], 0); rig(T2, ['2h 3d', 'Ah Kd', 'As Kc', '7c 2s'], 'Qc Jd Th 4s 5c');
  A(T2, 3, 'raise', 45); A(T2, 0, 'fold'); A(T2, 1, 'call'); A(T2, 2, 'call'); A(T2, 1, 'check'); A(T2, 2, 'check'); A(T2, 3, 'raise', 20); A(T2, 1, 'call'); A(T2, 2, 'call');
  // pot = 45*3 + 20*3 = 195 -> 97 + 98, odd chip to seat 1 (first left of the button)
  while (!T2.done) A(T2, T2.toAct, 'check');
  const m = {}; T2.res.wins.forEach(x => m[x.p] = x.amt);
  ok(m[1] === 98 && m[2] === 97, 'odd chip goes to the first winner left of the button ' + JSON.stringify(m)); }

// ---------- 5. showdown order and mucking ----------
{ const T = hand([2000, 2000, 2000], 0, { muck: true });
  rig(T, ['Ah Ad', '7c 2s', 'Kh Kd'], '2c 3d 9h Js 4c');
  A(T, 0, 'call'); A(T, 1, 'call'); A(T, 2, 'check');
  while (T.street < 3) A(T, T.toAct, 'check');
  A(T, 1, 'check'); A(T, 2, 'raise', 40); A(T, 0, 'call'); A(T, 1, 'call');
  const sd = T.ev.filter(e => e.t === 'show' || e.t === 'muck').map(e => e.t + e.p);
  ok(sd[0] === 'show2', 'last aggressor on the river shows first ' + sd.join(','));
  ok(sd.indexOf('show0') > 0 && sd.indexOf('muck1') > 0, 'later players show if better, losing hands are mucked ' + sd.join(',')); }
{ const T = hand([2000, 2000, 2000], 0); rig(T, ['Ah Ad', '7c 2s', 'Kh Kd']);
  A(T, 0, 'call'); A(T, 1, 'call'); A(T, 2, 'check'); while (!T.done) A(T, T.toAct, 'check');
  ok(T.ev.find(e => e.t === 'show').p === 1, 'checked down: first live seat left of the button shows first'); }
{ const T = hand([2000, 2000], 0); A(T, 0, 'raise', 60); A(T, 1, 'fold');
  ok(T.p[0].chips === 2020 && !T.ev.some(e => e.t === 'show'), 'uncontested pot: no cards shown, winner collects'); }

// ---------- 6. blinds, elimination ----------
ok(JSON.stringify(HE.BL.slice(0, 8)) === JSON.stringify([[10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200], [150, 300], [200, 400]]), 'blind schedule matches the spec');
{ const T = table([2000, 2000, 2000]); for (let h = 0; h < 11; h++) { HE.startHand(T); while (!T.done) A(T, T.toAct, 'fold'); } ok(T.bb === 30 && T.hand === 11, 'blinds go up every 10 hands');
  const F = table([2000, 2000, 2000], { fixed: true }); for (let h = 0; h < 25; h++) { HE.startHand(F); while (!F.done) A(F, F.toAct, 'fold'); } ok(F.bb === 20, 'fixed-blind mode never raises blinds'); }
{ const T = hand([2000, 2000, 2000], 0); setChips(T, [500, 290, 980]); T.total = 500 + 300 + 1000; rig(T, ['Ah Ad', 'Kh Kd', '7c 2s'], '2c 3d 9h Js 4c');
  A(T, 0, 'allin'); A(T, 1, 'allin'); A(T, 2, 'call');
  ok(T.p[1].out && T.p[1].place === 3 && !T.over, 'busted player is out with place 3'); }
{ const T = hand([2000, 2000], 0); T.p[0].human = true; rig(T, ['7c 2s', 'Ah Ad'], '2c 3d 9h Js 4c'); A(T, 0, 'allin'); A(T, 1, 'call');
  ok(T.over && T.p[1].place === 1 && T.p[0].place === 2, 'game ends with places when the human busts / one player is left'); }
{ const T = table([2000, 2000, 2000], { maxHands: 3 }); for (let h = 0; h < 3; h++) { HE.startHand(T); while (!T.done) A(T, T.toAct, 'fold'); } ok(T.over && T.p.every(p => p.place > 0), 'daily mode ends after its hand limit with places by chips'); }
{ const a = HE.shuffled(5), b = HE.shuffled(5); ok(a.join() === b.join() && new Set(a).size === 52 && HE.shuffled(6).join() !== a.join(), 'seeded shuffle is reproducible and a permutation'); }

// ---------- 7. AI legality and self-play ----------
{ let hands = 0, tables = 0, illegal = 0, decisions = 0; const t0 = Date.now(), byLv = [{}, {}, {}];
  while (hands < 5000) {
    const T = HE.newTable({ seed: 31 * tables + 7, players: [0, 1, 2, 3, 4, 5].map(i => ({ name: 'P' + i, lv: (i + tables) % 3, pers: i % 5 })), chips: 2000 }); tables++;
    while (!T.over) {
      HE.startHand(T); hands++; let k = 0;
      while (!T.done) { const i = T.toAct, p = T.p[i], v = HE.view(T, i); const d = HE.decide(v, { lv: p.lv, pers: p.pers, seed: hands * 101 + k++, iters: 200 }); decisions++;
        const b = byLv[p.lv]; b[d.a] = (b[d.a] || 0) + 1; if (v.street > 0 && d.a === 'raise' && !v.canCheck) b.pr = (b.pr || 0) + 1;
        try { HE.act(T, i, d.a, d.to); } catch (e) { illegal++; throw e; } }
      const sum = T.p.reduce((a, p) => a + p.chips, 0); if (sum !== T.total) throw new Error('chips');
    }
  }
  ok(illegal === 0, 'AI never makes an illegal action');
  console.log('self-play:', hands, 'hands on', tables, 'tables,', decisions, 'decisions, chips conserved every hand,', Date.now() - t0, 'ms');
  byLv.forEach((b, l) => { const n = Object.values(b).reduce((x, y) => x + y, 0); console.log('  ' + HE.LV[l].n + ' action mix:', ['fold', 'check', 'call', 'raise'].map(a => a + ' ' + ((b[a] || 0) / n * 100).toFixed(1) + '%').join(', ')); }); }
{ // personality VPIP/PFR at a mixed table
  const agg = HE.PERS.map(() => ({ h: 0, vp: 0, pr: 0 }));
  for (let t = 0; t < 40; t++) { const T = HE.newTable({ seed: 999 + t, players: [0, 1, 2, 3, 4].map(i => ({ name: 'P' + i, lv: 1, pers: i })), chips: 2000 });
    while (!T.over) { HE.startHand(T); let k = 0; while (!T.done) { const i = T.toAct, p = T.p[i]; const d = HE.decide(HE.view(T, i), { lv: 1, pers: p.pers, seed: t * 7777 + T.hand * 50 + k++, iters: 150 }); HE.act(T, i, d.a, d.to); } }
    T.p.forEach(p => { const a = agg[p.pers]; a.h += p.st.h; a.vp += p.st.vp; a.pr += p.st.pr; }); }
  console.log('personalities (一般桌):', agg.map((a, i) => HE.PERS[i].n + ' VPIP ' + (a.vp / a.h * 100).toFixed(0) + '% PFR ' + (a.pr / a.h * 100).toFixed(0) + '%').join(' | '));
  ok(agg[3].vp / agg[3].h > agg[1].vp / agg[1].h && agg[1].vp / agg[1].h > agg[0].vp / agg[0].h && agg[1].pr / agg[1].h > agg[2].pr / agg[2].h * 2, 'personalities differ: station loosest, LAG looser than TAG, LAG raises far more than tight-weak'); }
browserTests().catch(e => { fail++; console.log('FAIL browser tests crashed: ' + (e && e.stack || e)); }).then(() => {
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});

// ======================= browser regressions (release review r1) =======================
// Served over a local http server so reloads keep localStorage. CDP touchEnd releases only the points it lists.
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const http = require('http');
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const W = ms => new Promise(r => setTimeout(r, ms));
  const t0 = Date.now();
  try {
    async function open(w, h, o = {}) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light' });
      const errors = [];
      // counts every 音效 change written to settings and every open/close of the raise panel, so a double action is visible
      await ctx.addInitScript(() => {
        window.__n = { snd: 0, raise: 0 }; let last = null; const si = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) { if (k === 'holdem:settings') { try { const x = JSON.parse(v).snd; if (last !== null && x !== last) window.__n.snd++; last = x; } catch (e) {} } return si.apply(this, arguments); };
        document.addEventListener('DOMContentLoaded', () => { try { last = JSON.parse(localStorage.getItem('holdem:settings') || '{}').snd; } catch (e) {} if (last === undefined || last === null) last = true;
          const r = document.getElementById('raise'); if (r) new MutationObserver(() => window.__n.raise++).observe(r, { attributes: true, attributeFilter: ['hidden'] }); });
      });
      if (!o.noTest) await ctx.addInitScript(() => localStorage.setItem('holdem:test', '1')); // unlocks the test-only hooks
      // the app's own pacing (AI think pauses, deal gaps) runs 4x faster here; touch timing is untouched
      await ctx.addInitScript(() => { const st = window.setTimeout; window.setTimeout = function (f, d, ...a) { return st(f, (d || 0) / 4, ...a); }; });
      if (o.store) await ctx.addInitScript(kv => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in kv) localStorage.setItem(k, kv[k]); } }, o.store);
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
      await p.goto(URL); await p.waitForFunction(() => window.__holdem && !document.getElementById('ovMenu').hidden, null, { timeout: 5000 }).catch(() => {});
      const cdp = await ctx.newCDPSession(p);
      const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
      const box = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
      const center = async sel => { const b = await box(sel); return [b.x + b.w / 2, b.y + b.h / 2]; };
      const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await W(hold); await T('touchEnd', []); };
      const tap = async (sel, hold) => tapAt(await center(sel), hold);
      const info = () => p.evaluate(() => window.__holdem.info());
      const until = (fn, arg, ms = 8000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
      const myTurn = (ms = 30000) => until(() => { const f = window.__holdem.info(); if (f.done && !f.busy && !f.myTurn) document.getElementById('cv').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 })); return f.myTurn && !f.busy; }, null, ms);
      const snd = () => p.evaluate(() => window.__holdem.settings().snd);
      const raiseOpen = () => p.evaluate(() => !document.getElementById('raise').hidden);
      await p.evaluate(() => window.__holdem.setFast(1));
      return { ctx, p, T, box, center, tapAt, tap, info, until, myTurn, snd, raiseOpen, errors };
    }
    const cnt = o => o.p.evaluate(() => Object.assign({}, window.__n));
    const flips = async (o, fn) => { const a = await cnt(o); await fn(); await W(250); const b = await cnt(o); return { snd: b.snd - a.snd, raise: b.raise - a.raise, raiseNow: await o.raiseOpen() }; };

    // ---------- 1. touch: pointerup per pointerId, resting fingers, overlapping taps, detail-0 replays ----------
    {
      const o = await open(390, 844);
      await o.tap('#mStart'); await o.until(() => !window.__holdem.info().menu);
      ok(await o.myTurn(), 'browser: reached my turn after tapping 開始六人桌');
      const mute = await o.center('#bMute'), rz = await o.center('#bRaise'), table = [195, 300];
      let r = await flips(o, () => o.tapAt(mute)); ok(r.snd === 1, 'single tap 音效 toggles once');
      r = await flips(o, () => o.tapAt(mute, 600)); ok(r.snd === 1, 'hold 0.6 s on 音效 toggles once');
      r = await flips(o, () => o.tapAt(mute, 1000)); ok(r.snd === 1, 'hold 1 s on 音效 toggles once');
      let rest = 0;
      for (let k = 0; k < 3; k++) { r = await flips(o, async () => { await o.T('touchStart', [[...table, 1]]); await W(150); await o.T('touchStart', [[...table, 1], [...mute, 2]]); await W(50); await o.T('touchEnd', [[...mute, 2]]); await W(120); await o.T('touchEnd', [[...table, 1]]); }); rest += r.snd; }
      ok(rest === 3, 'finger resting on the table: taps on 音效 still act (' + rest + '/3)');
      r = await flips(o, async () => { await o.T('touchStart', [[...table, 1]]); await W(150); await o.T('touchStart', [[...table, 1], [...rz, 2]]); await W(50); await o.T('touchEnd', [[...rz, 2]]); await W(120); await o.T('touchEnd', [[...table, 1]]); });
      ok(r.raise === 1 && r.raiseNow, 'finger resting on the table: tap on 加注 opens the panel');
      await o.tapAt(rz); await W(250);
      for (const order of ['first lifts first', 'second lifts first']) {
        r = await flips(o, async () => { await o.T('touchStart', [[...mute, 1]]); await W(50); await o.T('touchStart', [[...mute, 1], [...rz, 2]]); await W(60);
          if (order === 'first lifts first') { await o.T('touchEnd', [[...mute, 1]]); await W(30); await o.T('touchEnd', [[...rz, 2]]); } else { await o.T('touchEnd', [[...rz, 2]]); await W(30); await o.T('touchEnd', [[...mute, 1]]); } });
        ok(r.snd === 1 && r.raise === 1, 'overlapping taps 音效 + 加注 (' + order + '): both act once ' + JSON.stringify(r));
        if (await o.raiseOpen()) { await o.tapAt(rz); await W(250); }
      }
      // detail-0 replays after a real tap: on the control, on its edge point and on elementFromPoint
      r = await flips(o, async () => { await o.tapAt(mute); await W(60); await o.p.evaluate(([x, y]) => {
        const b = document.getElementById('bMute'), q = b.getBoundingClientRect(), ev = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y });
        b.dispatchEvent(ev()); document.elementFromPoint(q.left + 1, q.top + 1).dispatchEvent(ev()); document.elementFromPoint(x, y).dispatchEvent(ev()); }, mute); });
      ok(r.snd === 1, 'tap 音效 then detail-0 clicks (control, edge point, elementFromPoint): toggles once');
      r = await flips(o, async () => { await o.tapAt(rz); await W(60); await o.p.evaluate(() => document.getElementById('bRaise').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))); });
      ok(r.raise === 1 && r.raiseNow, 'tap 加注 then detail-0 click: panel opens and stays open');
      await W(900); r = await flips(o, () => o.p.evaluate(() => document.getElementById('bMute').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }))));
      ok(r.snd === 1, 'a lone detail-0 click (keyboard / script) acts once');
      await o.tapAt(rz); await W(250);
      ok(!(await o.raiseOpen()), 'tap 加注 again closes the panel');
      // resting finger + 跟注: the game moves on
      const h0 = await o.info(), call = await o.center('#bCall');
      await o.T('touchStart', [[...table, 1]]); await W(150); await o.T('touchStart', [[...table, 1], [...call, 2]]); await W(50); await o.T('touchEnd', [[...call, 2]]);
      ok(await o.until(() => !window.__holdem.info().myTurn, null, 2000), 'finger resting on the table: tap on 跟注/過牌 acts (hand ' + h0.hand + ')');
      await o.T('touchEnd', [[...table, 1]]);
      ok(await o.p.evaluate(() => !/INPUT/.test((document.activeElement || {}).tagName || '') && document.getElementById('pCF').getAttribute('aria-pressed') === 'false' && document.getElementById('pCA').getAttribute('aria-pressed') === 'false'),
        'after 跟注 the pre-action button now under the finger was not toggled and no input has focus');
      // nothing new on a new screen: tap 選單 (pause opens) then a detail-0 click at the same point does not press what is there now
      const menuB = await o.center('#bMenu'); await o.tapAt(menuB); await W(60);
      await o.p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, menuB);
      await W(200); ok(await o.p.evaluate(() => !document.getElementById('ovPause').hidden), 'tap 選單 + replayed click: pause stays open, nothing under the finger ran');
      ok(await o.p.evaluate(() => [...document.styleSheets].every(ss => [...ss.cssRules].every(r => !(r.selectorText && /:active/.test(r.selectorText) && /transform/.test(r.style.cssText))))), 'no :active rule moves or scales a button');
      ok(!o.errors.length, 'no page errors during touch tests ' + o.errors.join(' | '));
      await o.ctx.close();
    }
    // ---------- 2. edge taps 1–2 px inside a button act ----------
    {
      const o = await open(390, 844);
      const b = await o.box('#mStart'); await o.tapAt([b.x + b.w / 2, b.y + 1]);
      ok(await o.until(() => !window.__holdem.info().menu && window.__holdem.info().hand >= 0 && document.getElementById('ovMenu').hidden, null, 3000), 'tap 1 px inside the top edge of 開始六人桌 starts the game');
      ok(await o.myTurn(), 'my turn (edge test)');
      let got = 0;
      for (const dx of [1, 2]) { const r = await o.box('#bRaise'); const a = await o.raiseOpen(); await o.tapAt([r.x + dx, r.y + r.h / 2]); await W(250); if ((await o.raiseOpen()) !== a) got++; }
      ok(got === 2, 'taps 1 and 2 px inside the left edge of 加注 act (' + got + '/2)');
      await o.ctx.close();
    }
    // ---------- 3. corrupt storage never breaks the app; valid old-format saves still resume ----------
    {
      const cases = {
        'stats daily null': { 'holdem:stats': '{"daily":null}' }, 'stats ach null': { 'holdem:stats': '{"ach":null}' }, 'stats string': { 'holdem:stats': '"x"' },
        'stats bad json': { 'holdem:stats': '{"hands":' }, 'stats bestCards null': { 'holdem:stats': '{"best":5000000,"bestCards":null}' },
        'stats daily array of junk': { 'holdem:stats': '{"daily":[1,2],"ach":{"x":"y"},"hands":-4}' },
        'session T {}': { 'holdem:session': '{"T":{}}' }, 'session T.p empty': { 'holdem:session': '{"T":{"p":[],"hand":3},"mode":"six","lv":1,"ids":[0,1]}' },
        'session no ids': { 'holdem:session': '{"T":{"p":[{"chips":5}],"hand":3},"mode":"six","lv":1}' },
        'session lv 9': { 'holdem:session': '{"T":{"p":[{"chips":5}],"hand":3},"mode":"six","lv":9,"ids":[0,1]}' },
        'session null': { 'holdem:session': 'null' }, 'session array': { 'holdem:session': '[1,2]' }, 'session bad json': { 'holdem:session': '{"T":' },
        'settings lv 7': { 'holdem:settings': '{"lv":7}' }, 'settings lv "a"': { 'holdem:settings': '{"lv":"a"}' }, 'settings skin 99': { 'holdem:settings': '{"skin":99}' },
        'settings bad json': { 'holdem:settings': '{bad' }, 'settings skin -1 fast 5': { 'holdem:settings': '{"skin":-1,"fast":5,"snd":"no"}' },
      };
      // a real mid-hand save, then broken variants of it (wrong ids, lv out of range, chips not adding up, a duplicated card)
      const o = await open(390, 844); await o.tap('#mStart'); await o.myTurn();
      const good = await o.p.evaluate(() => localStorage.getItem('holdem:session')); const g = JSON.parse(good);
      const before = await o.info(); await o.ctx.close();
      ok(typeof g.T.x === 'string' && g.T.deck === undefined && g.T.seed === undefined && g.T.p.slice(1).every(p => p.hole.length === 0) && g.T.p[0].hole.length === 2,
        'saved session keeps the deck, seed and opponents\' hole cards out of plain text');
      const mut = f => { const c = JSON.parse(good); f(c); return { 'holdem:session': JSON.stringify(c) }; };
      Object.assign(cases, {
        'session ids missing': mut(c => delete c.ids), 'session ids wrong length': mut(c => c.ids = [0, 1]), 'session lv 9 (real save)': mut(c => c.lv = 9),
        'session chips do not add up': mut(c => c.T.p[2].chips += 500), 'session blob broken': mut(c => c.T.x = 'abc'), 'session toAct out of range': mut(c => c.T.toAct = 9),
        'session player not an object': mut(c => c.T.p[3] = 5), 'session mode bogus': mut(c => c.mode = 'x'), 'session hist junk': mut(c => c.hist = [{ n: 'a' }, null, 5]),
      });
      // the same save in the old plain format (deck, seed and every hole card in the clear, no "first" flag) must still resume
      const unscr = str => { const r = HE.rng(0x5eed1e55); let out = ''; for (let i = 0; i < str.length; i++) out += String.fromCharCode(str.charCodeAt(i) ^ ((r() * 256) | 0)); return out; };
      const x = JSON.parse(unscr(Buffer.from(g.T.x, 'base64').toString('latin1')));
      const old = JSON.parse(good); delete old.T.x; delete old.first; old.T.seed = x.s; old.T.deck = x.d; old.T.p.forEach((p, i) => { if (i) p.hole = x.h[i]; });
      ok(x.d.length === 52 && x.h[1].length === 2, 'scrambled blob decodes to the deck and the hole cards');
      for (const [name, kv] of Object.entries(cases)) {
        const c = await open(390, 844, { store: kv });
        const menu = await c.p.evaluate(() => !document.getElementById('ovMenu').hidden);
        const cont = await c.p.evaluate(() => !document.getElementById('mContinue').hidden);
        let started = false;
        if (cont) { await c.tap('#mContinue'); started = await c.until(() => document.getElementById('ovMenu').hidden && window.__holdem.info().hand >= 1, null, 4000); }
        else { await c.tap('#mStart'); started = await c.until(() => window.__holdem.info().hand >= 1, null, 4000); }
        await W(150);
        const s = await c.p.evaluate(() => window.__holdem.settings());
        ok(menu && started && !c.errors.length && s.lv >= 0 && s.lv <= 2 && s.skin >= 0 && s.skin <= 3, 'corrupt storage "' + name + '": menu shows, play starts, no errors ' + c.errors.join(' | '));
        await c.ctx.close();
      }
      {
        const c = await open(390, 844, { store: { 'holdem:session': JSON.stringify(old) } });
        ok(await c.p.evaluate(() => !document.getElementById('mContinue').hidden), 'old-format save: 繼續牌局 is offered');
        await c.tap('#mContinue'); await c.until(() => document.getElementById('ovMenu').hidden, null, 3000); await W(200);
        const f = await c.info();
        ok(f.hand === before.hand && JSON.stringify(f.chips) === JSON.stringify(before.chips) && !c.errors.length, 'old-format save resumes the same hand with the same chips');
        await W(600); const s2 = await c.p.evaluate(() => JSON.parse(localStorage.getItem('holdem:session')));
        ok(!s2 || (typeof s2.T.x === 'string' && s2.T.deck === undefined), 'old save is rewritten in the scrambled format');
        await c.ctx.close();
      }
      {
        const c = await open(390, 844, { store: { 'holdem:session': good } });
        await c.tap('#mContinue'); await c.until(() => document.getElementById('ovMenu').hidden, null, 3000); await W(200);
        const f = await c.info(); ok(f.hand === before.hand && JSON.stringify(f.chips) === JSON.stringify(before.chips) && !c.errors.length, 'new-format save resumes after reload');
        await c.ctx.close();
      }
    }
    // ---------- 4. 360x640: your hand / win-rate labels never sit on an opponent's seat (light and dark) ----------
    {
      for (const dark of [false, true]) {
        const o = await open(360, 640, { dark }); await o.tap('#mStart');
        let checked = 0, bad = [], plate = 0;
        for (let k = 0; k < 4; k++) {
          if (!(await o.myTurn())) break;
          await W(500);
          const r = await o.p.evaluate(() => {
            const h = window.__holdem.hint(), L = window.__holdem.layout(); if (!h) return null;
            const b = h.at.box, bad = [], hit = q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1];
            L.seat.forEach((sq, i) => { if (!i) return; if (L.L.seatBox[sq].some(hit) || hit([L.L.bet[sq].x - 29, L.L.bet[sq].y - 25, L.L.bet[sq].x + 29, L.L.bet[sq].y + 27])) bad.push(i); });
            if (L.L.boardBox.some(hit) || hit(L.L.myBox)) bad.push('board/cards');
            return { bad, cost: h.at.cost, txt: h.at.txt, box: b, plate: h.at.plate };
          });
          if (r) { checked++; if (r.bad.length || r.cost) bad.push(r); if (r.plate) plate++; }
          const c = await o.center('#bCall'); await o.tapAt(c); await W(300);
        }
        ok(checked >= 3 && !bad.length, '360x640 ' + (dark ? 'dark' : 'light') + ': hand pill clear of every opponent seat on ' + checked + ' turns ' + JSON.stringify(bad));
        ok(plate === checked, '360x640: win rate shown in your nameplate (' + plate + '/' + checked + ')');
        ok(!o.errors.length, 'no errors at 360x640');
        await o.ctx.close();
      }
    }
    // ---------- 5. 844x390: the raise panel leaves your nameplate and hole cards visible ----------
    {
      const o = await open(844, 390); await o.tap('#mStart');
      let done = false;
      for (let k = 0; k < 8 && !done; k++) {
        if (!(await o.myTurn())) break;
        if ((await o.info()).view.canRaise) {
          await o.tap('#bRaise'); await W(300);
          const r = await o.p.evaluate(() => {
            const L = window.__holdem.layout(), st = document.getElementById('stage').getBoundingClientRect(), pn = document.getElementById('raise').getBoundingClientRect();
            const s0 = L.L.seat[0], R = L.L.R, my = L.L.my;
            const plate = [st.left + s0.x - R - 3, st.top + s0.y - R - 3, st.left + s0.x + R + 88, st.top + s0.y + R + 3];
            const cards = [st.left + my.x, st.top + my.y, st.left + my.x + 2 * L.L.mw + 6, st.top + my.y + L.L.mh];
            const hit = b => pn.left < b[2] && pn.right > b[0] && pn.top < b[3] && pn.bottom > b[1];
            const btns = [...document.querySelectorAll('#raise button, #bRaise')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect());
            return { plate: hit(plate), cards: hit(cards), small: btns.filter(b => b.width < 44 || b.height < 44).length, inView: pn.top >= 0 && pn.bottom <= innerHeight && pn.right <= innerWidth };
          });
          ok(!r.plate && !r.cards && !r.small && r.inView, '844x390: open raise panel covers neither your nameplate nor your hole cards, controls ≥44 px ' + JSON.stringify(r));
          const vis = await o.p.evaluate(() => ['bFold', 'bCall', 'bRaise'].map(id => { const e = document.getElementById(id), b = e.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return b.width >= 44 && b.height >= 44 && b.bottom <= innerHeight && !!t && e.contains(t); }));
          ok(vis.every(Boolean), '844x390: with the raise panel open 棄牌, 跟注 and 加注 stay visible and uncovered ' + JSON.stringify(vis));
          await o.tap('#bCall');
          ok(await o.until(() => !window.__holdem.info().myTurn && document.getElementById('raise').hidden, null, 2000), '844x390: tapping 跟注 while the panel is open calls and closes the panel');
          done = true;
        } else { await o.tap('#bCall'); await W(300); }
      }
      ok(done, '844x390 raise panel was checked');
      await o.ctx.close();
    }
    // ---------- 4b. (r2) bets and nameplates never touch the board, pot or your cards, at every size ----------
    {
      const sizes = [[360, 640], [360, 740], [375, 667], [390, 844], [430, 932], [844, 390], [667, 375]];
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await ctx.addInitScript(() => localStorage.setItem('holdem:test', '1'));
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.goto(URL); await p.waitForFunction(() => window.__holdem);
      await p.evaluate(() => document.getElementById('mStart').click()); await p.waitForFunction(() => window.__holdem.info().myTurn, null, { timeout: 30000 }).catch(() => {});
      for (const [w, h] of sizes) {
        await p.setViewportSize({ width: w, height: h }); await W(150);
        const r = await p.evaluate(() => {
          const L = window.__holdem.layout(), Lo = L.L, hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1], bb = b => [b.x - 29, b.y - 25, b.x + 29, b.y + 27];
          const bad = [], inside = q => q[0] >= 0 && q[1] >= 0 && q[2] <= L.W && q[3] <= L.H;
          Lo.seatBox.forEach((bs, i) => bs.forEach(q => {
            if (Lo.boardBox.some(o => hit(q, o))) bad.push('seat' + i + '×board');
            if (i && hit(q, Lo.myBox)) bad.push('seat' + i + '×my cards');
            Lo.seatBox.forEach((bs2, j) => { if (j > i && bs2.some(o => hit(q, o))) bad.push('seat' + i + '×seat' + j); });
            if (i && !inside(q)) bad.push('seat' + i + ' off canvas'); }));
          Lo.bet.forEach((b, i) => { const q = bb(b);
            if (Lo.boardBox.some(o => hit(q, o))) bad.push('bet' + i + '×board');
            if (hit(q, Lo.myBox)) bad.push('bet' + i + '×my cards');
            Lo.seatBox.forEach((bs, j) => { if (bs.some(o => hit(q, o))) bad.push('bet' + i + '×seat' + j); });
            Lo.bet.forEach((c, j) => { if (j > i && hit(q, bb(c))) bad.push('bet' + i + '×bet' + j); });
            if (!inside(q)) bad.push('bet' + i + ' off canvas'); });
          if (!inside(Lo.myBox.map((v, k) => k === 3 ? v - 4 : v))) bad.push('my cards off canvas');
          return { bad, land: L.land };
        });
        ok(!r.bad.length, w + 'x' + h + ': no bet or nameplate touches the board row, pot, banner line, your cards, another seat or another bet ' + JSON.stringify(r.bad));
      }
      // drawn worst case: every seat betting 12,000 with a full board and a side pot, at 360x640
      await p.setViewportSize({ width: 360, height: 640 }); await W(150);
      await p.evaluate(() => window.__holdem.fillTable(12000)); await W(200);
      const hb = await p.evaluate(() => { const h = window.__holdem.hint(), L = window.__holdem.layout().L; if (!h || !h.at) return 'none';
        const b = h.at.box, hit = q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1];
        return L.seatBox.slice(1).some(bs => bs.some(hit)) || L.bet.some(x => hit([x.x - 29, x.y - 25, x.x + 29, x.y + 27])) || L.boardBox.some(hit) || hit(L.myBox) ? 'overlap ' + JSON.stringify(b) : 'clear'; });
      ok(hb === 'clear', '360x640 all six betting: your hand pill stays clear of every bet, seat, the board and your cards (' + hb + ')');
      ok(!errs.length, 'no errors while resizing through every size ' + errs.join(' | '));
      await ctx.close();
    }
    // ---------- 4c. (r2) test hooks are absent without the test flag; no long task at load or game start ----------
    {
      const o = await open(390, 844, { noTest: true });
      ok(await o.p.evaluate(() => typeof window.__holdem.session === 'undefined' && typeof window.__holdem.endNow === 'undefined' && typeof window.__holdem.fillTable === 'undefined'), 'session()/endNow() are not exposed without the test flag');
      await o.ctx.close();
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const p = await ctx.newPage(); await p.goto(URL); await W(500);
      await p.evaluate(() => document.getElementById('mStart').click()); await W(1500);
      const lts = await p.evaluate(() => new Promise(res => { const a = []; new PerformanceObserver(l => l.getEntries().forEach(e => a.push(Math.round(e.duration)))).observe({ type: 'longtask', buffered: true }); setTimeout(() => res(a), 200); }));
      ok(!lts.length, 'no long task from page load through game start (buffered) ' + JSON.stringify(lts));
      await ctx.close();
    }
    // ---------- 4d. (r2) long-term goal: career points, rank and top-three streak ----------
    {
      const o = await open(390, 844, { store: { 'holdem:stats': JSON.stringify({ career: 75, streak: 1, bestStreak: 1 }) } });
      ok(/段位 白銀/.test(await o.p.textContent('#mCareer')) && /距黃金 5 分/.test(await o.p.textContent('#mCareer')), 'menu shows rank 白銀 and points to the next rank');
      await o.tap('#mStart'); await o.myTurn();
      await o.p.evaluate(() => window.__holdem.endNow()); await W(300);
      const st = await o.p.evaluate(() => window.__holdem.stats()), place = (await o.info()).place;
      const want = 75 + Math.round([0, 12, 7, 4, 2, 1, 0][place] * 1.5);
      ok(st.career === want && st.streak === (place <= 3 ? 2 : 0) && st.bestStreak === Math.max(1, st.streak), 'finishing a 一般桌 game in place ' + place + ' adds career points and updates the streak ' + JSON.stringify([st.career, st.streak, st.bestStreak]));
      ok(/生涯積分 \+/.test(await o.p.textContent('#rCareer')), 'result screen shows the points gained');
      await o.tap('#rMenu'); await W(300); await o.tap('#mStats'); await W(300);
      ok(/段位/.test(await o.p.textContent('#sGrid')) && /最佳連續前三/.test(await o.p.textContent('#sGrid')), 'stats show rank, career points and best streak');
      await o.ctx.close();
      const c = await open(390, 844, { store: { 'holdem:stats': '{"career":"x","streak":-3,"bestStreak":null}' } });
      const s2 = await c.p.evaluate(() => window.__holdem.stats());
      ok(s2.career === 0 && s2.streak === 0 && s2.bestStreak === 0 && !c.errors.length, 'corrupt career fields fall back to 0');
      await c.ctx.close();
    }
    // ---------- 6. daily: only the first attempt is recorded, replays are practice ----------
    {
      const o = await open(390, 844);
      await o.tap('#mDaily'); await o.myTurn();
      const h1 = (await o.info()).hand;
      await o.tap('#bMenu'); await W(300); await o.tap('#pQuit'); await W(300);
      await o.tap('#mDaily'); await o.until(() => document.getElementById('ovMenu').hidden, null, 3000); await W(300);
      ok((await o.info()).hand === h1, 'tapping 每日牌局 again continues the unfinished first attempt instead of restarting it');
      await o.p.evaluate(() => window.__holdem.endNow()); await W(300);
      const st1 = await o.p.evaluate(() => window.__holdem.stats()), day = Object.keys(st1.daily)[0], first = st1.daily[day];
      ok(first !== undefined && /已記為今日成績/.test(await o.p.textContent('#rSub')), 'first daily attempt is recorded as today\'s result');
      await o.tap('#rMenu'); await W(300);
      ok(/今日/.test(await o.p.textContent('#mDaily')), 'menu shows today\'s result on 每日牌局');
      await o.tap('#mDaily'); await o.myTurn();
      ok(/練習/.test(await o.p.textContent('#iSub')), 'a replay is labelled practice in the header');
      await o.p.evaluate(() => { window.__holdem.endNow(); }); await W(300);
      const st2 = await o.p.evaluate(() => window.__holdem.stats());
      ok(st2.daily[day] === first && st2.dprac[day] !== undefined && /練習/.test(await o.p.textContent('#rSub')), 'replay does not change today\'s result (kept separately as practice)');
      ok(!o.errors.length, 'no errors in daily flow ' + o.errors.join(' | '));
      await o.ctx.close();
    }
    // ---------- 7. hand-ranking reference in game ----------
    {
      const o = await open(390, 844); await o.tap('#mStart'); await o.myTurn(); await W(400);
      const hb = await o.p.evaluate(() => { const h = window.__holdem.hint(), s = document.getElementById('stage').getBoundingClientRect(); return h && [s.left + (h.box[0] + h.box[2]) / 2, s.top + (h.box[1] + h.box[3]) / 2]; });
      ok(!!hb, 'hand pill is drawn on my turn');
      await o.tapAt(hb); await W(300);
      const r = await o.p.evaluate(() => ({ open: !document.getElementById('ovRank').hidden, rows: document.querySelectorAll('#rank .rk').length, on: (document.querySelector('#rank .rk.on .n') || {}).textContent || '' }));
      ok(r.open && r.rows === 10 && /一對|高牌/.test(r.on), 'tapping the hand pill opens the ranking (10 rows, current hand highlighted: ' + r.on + ')');
      await o.p.evaluate(() => document.querySelector('#ovRank [data-close]').scrollIntoView()); await W(100);
      await o.tap('#ovRank [data-close]'); await W(300);
      ok(await o.p.evaluate(() => document.getElementById('ovRank').hidden) && (await o.info()).myTurn, 'closing it returns to the hand');
      await o.tap('#bMenu'); await W(300); await o.tap('#pRank'); await W(300);
      ok(await o.p.evaluate(() => !document.getElementById('ovRank').hidden), '暫停選單「牌型大小」 opens the ranking too');
      ok(!o.errors.length, 'no errors in ranking flow');
      await o.ctx.close();
    }
    // ---------- 8. details: best-hand order, dealer button clear of your cards, no long task at game start ----------
    {
      for (const [cards, want] of [['Jh Js Qc 3d 3s', 'J J 3 3 Q'], ['Ah 2c 3d 4s 5h', '5 4 3 2 A'], ['Kc 4d Kh 4s Ks', 'K K K 4 4']]) {
        const st = { best: HE.evalN(P(cards), 5), bestCards: P(cards), hands: 3 };
        const o = await open(390, 844, { store: { 'holdem:stats': JSON.stringify(st) } });
        await o.tap('#mStats'); await W(300);
        const txt = await o.p.evaluate(() => [...document.querySelectorAll('#sGrid .mc')].map(e => e.firstChild.textContent).join(' '));
        ok(txt === want, '最佳牌型 ' + cards + ' shows ' + want + ' (got ' + txt + ')');
        await o.ctx.close();
      }
      const lt = await open(390, 844);
      await lt.p.evaluate(() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(Math.round(e.duration)))).observe({ type: 'longtask' }); });
      await lt.tap('#mStart'); await W(2500);
      const lts = await lt.p.evaluate(() => window.__lt); ok(!lts.length, 'no long task when a game starts ' + JSON.stringify(lts));
      for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
        await lt.p.setViewportSize({ width: w, height: h }); await W(200);
        const r = await lt.p.evaluate(() => { const L = window.__holdem.layout().L, d = window.__holdem.dPos(0), my = L.my;
          return d.x + 10 < my.x || d.x - 10 > my.x + 2 * L.mw + 6 || d.y - 10 > my.y + L.mh || d.y + 10 < my.y; });
        ok(r, w + 'x' + h + ': dealer button on your seat is clear of your hole cards');
      }
      ok(!lt.errors.length, 'no errors (details)');
      await lt.ctx.close();
    }
  } finally {
    await browser.close(); srv.close();
    console.log('browser regressions:', ((Date.now() - t0) / 1000).toFixed(1), 's');
  }
}
