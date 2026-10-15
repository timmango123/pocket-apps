// Rule tests for 德州撲克 (texas-holdem): extracts the engine between the CORE markers of ../index.html and checks
// every special rule in the spec (evaluator, action order, min-raise, short all-in, heads-up, side pots, odd chips,
// showdown order/mucking, blinds, elimination) plus a 5,000-hand AI self-play for chip conservation / legality.
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
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
