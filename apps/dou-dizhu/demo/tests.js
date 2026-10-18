// Rule tests for 鬥地主 (dou-dizhu): combination detection, comparison, enumeration, game flow, scoring and AI sanity.
// Runs against the game's own core (CORE-START/CORE-END markers in ../index.html). Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const DZ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return DZ;')();
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const R = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 };
// "7c 7d" -> card ids; "x" = 小王, "X" = 大王; a bare rank takes successive suits ("7 7 7" = 7c 7d 7h)
function cs(s) { const used = {}; return s.trim().split(/\s+/).map(tok => { if (tok === 'x') return 52; if (tok === 'X') return 53; const m = tok.match(/^(10|[2-9JQKA])([cdhs])?$/); const r = R[m[1]]; let su; if (m[2]) su = 'cdhs'.indexOf(m[2]); else { su = used[r] || 0; used[r] = su + 1; } return r * 4 + su; }); }
const ev = s => DZ.evaluate(cs(s));
const type = s => { const e = ev(s); return e ? e.t : null; };
const gt = (a, b) => DZ.beats(ev(a), ev(b));

// --- card coding ---
ok(DZ.rk(0) === 0 && DZ.rk(51) === 12 && DZ.rk(52) === 13 && DZ.rk(53) === 14, 'rank index of 3, 2, jokers');
ok(DZ.cardName(53) === '大王' && DZ.cardName(52) === '小王' && DZ.cardName(0) === '♣3', 'card names');
// --- singles and pairs ---
ok(type('7c') === 'single', 'single'); ok(type('x') === 'single', 'joker single');
ok(type('7c 7d') === 'pair', 'pair'); ok(type('7c 8c') === null, 'non pair rejected');
ok(type('x X') === 'rocket', 'rocket'); ok(type('x x') === null, 'no joker pair');
ok(gt('X', 'x'), '大王 > 小王'); ok(gt('x', '2c'), '小王 > 2'); ok(gt('2c', 'As'), '2 > A'); ok(gt('As', 'Ks'), 'A > K'); ok(gt('4c', '3s'), '4 > 3');
ok(!gt('3s', '3h'), 'suit does not matter'); ok(!gt('3c', '4c'), '3 < 4');
ok(gt('8c 8d', '7h 7s'), 'pair 8 > pair 7'); ok(gt('2c 2d', 'Ah As'), 'pair 2 > pair A'); ok(!gt('7c 7d', '7h 7s'), 'equal pairs do not beat');
ok(!gt('8c 8d', '9s'), 'pair cannot answer single'); ok(!gt('2c', '3c 3d'), 'single cannot answer pair');
// --- triples ---
ok(type('9 9 9') === 'triple', 'triple'); ok(type('9 9 8') === null, 'mixed triple rejected');
ok(type('9 9 9 3') === 'triple1', 'triple + single'); ok(type('9 9 9 x') === 'triple1', 'triple + joker single');
ok(type('9 9 9 3 3') === 'triple2', 'triple + pair'); ok(type('9 9 9 3 4') === null, 'triple + two different singles rejected');
ok(type('9 9 9 x X') === null, 'triple + rocket is not a triple2');
ok(gt('10 10 10', '9 9 9'), 'triple compare'); ok(gt('10 10 10 3', '9 9 9 2'), 'triple1 compares the triple, not the kicker');
ok(gt('4 4 4 A A', '3 3 3 2 2'), 'triple2 compares the triple'); ok(!gt('9 9 9 3', '9 9 9 4 4'), 'triple1 cannot answer triple2');
// --- straights ---
ok(type('3 4 5 6 7') === 'straight', '34567'); ok(ev('3 4 5 6 7').len === 5, 'straight length');
ok(type('10 J Q K A') === 'straight', '10JQKA'); ok(type('J Q K A 2') === null, 'straight cannot contain 2');
ok(type('A 2 3 4 5') === null, 'no wrap-around straight'); ok(type('3 4 5 6') === null, 'straight needs 5');
ok(type('3 4 5 6 8') === null, 'gap rejected'); ok(type('3 4 5 6 7 8 9 10 J Q K A') === 'straight', '12-card straight');
ok(type('3 3 4 5 6') === null, 'duplicate in straight rejected');
ok(gt('4 5 6 7 8', '3 4 5 6 7'), 'straight compare by top card'); ok(!gt('3 4 5 6 7 8', '4 5 6 7 8'), 'different straight lengths do not compare');
ok(!gt('9 10 J Q K A', '3 4 5 6 7'), '6-straight cannot answer 5-straight');
// --- consecutive pairs ---
ok(type('3 3 4 4 5 5') === 'pairs', 'three pairs'); ok(type('3 3 4 4') === null, 'two pairs is not a play');
ok(type('3 3 4 4 6 6') === null, 'pairs gap rejected'); ok(type('K K A A 2 2') === null, 'pairs cannot include 2');
ok(type('3 3 4 4 5 5 6 6 7 7 8 8 9 9 10 10 J J Q Q') === 'pairs', 'ten pairs');
ok(gt('4 4 5 5 6 6', '3 3 4 4 5 5'), 'pairs compare'); ok(!gt('3 3 4 4 5 5 6 6', '3 3 4 4 5 5'), 'pairs length must match');
ok(type('3 3 3 4 4 4') === 'plane', '333444 is a plane, not pairs'); ok(ev('3 3 3 4 4 4').len === 2, 'plane length 2');
// --- airplanes ---
ok(type('3 3 3 4 4 4 5 5 5') === 'plane', 'plane 3'); ok(type('3 3 3 5 5 5') === null, 'plane gap rejected'); ok(type('A A A 2 2 2') === null, 'plane cannot include 2');
ok(type('3 3 3 4 4 4 5 6') === 'plane1', 'plane + 2 singles'); ok(type('3 3 3 4 4 4 5 5') === 'plane1', 'plane + two same-rank singles');
ok(type('3 3 3 4 4 4 x 7') === 'plane1', 'plane + joker single'); ok(type('3 3 3 4 4 4 x X') === null, 'plane cannot take rocket as wings');
ok(type('3 3 3 4 4 4 5 5 6 6') === 'plane2', 'plane + 2 pairs'); ok(type('3 3 3 4 4 4 5 5 6 7') === null, 'plane with mixed wings rejected');
ok(type('3 3 3 4 4 4 5 5 5 6 7 8') === 'plane1' && ev('3 3 3 4 4 4 5 5 5 6 7 8').len === 3, 'plane 3 + 3 singles');
ok(type('3 3 3 4 4 4 5 5 5 6 6 6') === 'plane' && ev('3 3 3 4 4 4 5 5 5 6 6 6').len === 4, 'four triples is a pure plane');
ok(type('Q Q Q K K K A A A 2 2 2') === 'plane1' && ev('Q Q Q K K K A A A 2 2 2').k === R.A, 'QKA plane with three 2s as wings');
ok(type('3 3 3 4 4 4 5 5 5 9 9 9') === 'plane1', 'plane + three same-rank singles');
ok(type('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 8') === 'plane1' && ev('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 8').k === R['7'], 'plane picks the highest window for wings');
ok(type('3 3 3 4 4 4 5 5 5 6 6 7 7 8 8') === 'plane2' && ev('3 3 3 4 4 4 5 5 5 6 6 7 7 8 8').len === 3, 'plane 3 + 3 pairs');
ok(type('3 3 3 4 4 4 5 5 5 5') === 'plane2' && ev('3 3 3 4 4 4 5 5 5 5').k === R['4'], '10 cards: plane 3-4 carrying 5555 as two pairs');
ok(type('3 3 3 4 4 4 5 5 5 6 6 6 7 7 7 7') === 'plane1', 'plane 4 + 7777 as four singles... wait: 16 = plane 4 + 4 wings');
ok(gt('4 4 4 5 5 5 3 6', '3 3 3 4 4 4 A 2'), 'plane1 compares triples'); ok(!gt('4 4 4 5 5 5', '3 3 3 4 4 4 7 8'), 'pure plane cannot answer plane1');
ok(!gt('5 5 5 6 6 6 7 7 7', '3 3 3 4 4 4'), 'plane lengths must match');
// --- four + two ---
ok(type('9 9 9 9 3 4') === 'four2', 'four + 2 singles'); ok(type('9 9 9 9 3 3') === 'four2', 'four + a pair counts as two singles');
ok(type('9 9 9 9 x X') === null, 'four cannot carry the rocket'); ok(type('9 9 9 9 x 3') === 'four2', 'four + joker + single');
ok(type('9 9 9 9 3 3 4 4') === 'four22', 'four + 2 pairs'); ok(type('9 9 9 9 3 3 4 5') === null, 'four + pair + 2 singles rejected');
ok(type('9 9 9 9 3 3 3 3') === 'four22' && ev('9 9 9 9 3 3 3 3').k === R['9'], 'two fours: higher is the quad');
ok(type('9 9 9 9 x x') === null, 'four cannot take two of the same joker');
ok(gt('10 10 10 10 3 4', '9 9 9 9 A 2'), 'four2 compares the quad'); ok(!gt('9 9 9 9 3 4', '3 3 3 3'), 'four2 does not beat a bomb');
ok(!gt('9 9 9 9 3 3 4 4', '9 9 9 9 5 6'), 'four22 cannot answer four2');
// --- bombs & rocket ---
ok(type('3 3 3 3') === 'bomb', 'bomb'); ok(DZ.isBomb(ev('3 3 3 3')) && DZ.isBomb(ev('x X')) && !DZ.isBomb(ev('9 9 9 9 3 4')), 'isBomb');
ok(gt('3 3 3 3', 'X'), 'bomb beats big joker single'); ok(gt('3 3 3 3', 'Q Q Q K K K A A A 2 2 2'), 'bomb beats a 12-card plane');
ok(gt('4 4 4 4', '3 3 3 3'), 'bigger bomb'); ok(!gt('3 3 3 3', '4 4 4 4'), 'smaller bomb loses'); ok(!gt('3 3 3 3', '3 3 3 3'), 'equal bombs');
ok(gt('x X', '2 2 2 2'), 'rocket beats bomb of 2s'); ok(!gt('2 2 2 2', 'x X'), 'nothing beats the rocket');
ok(gt('x X', '3'), 'rocket beats single'); ok(!gt('X', '3 3 3 3'), 'single cannot answer bomb');
ok(DZ.beats(ev('3'), null) && !DZ.beats(null, ev('3')), 'beats with empty lead');
// --- names ---
ok(ev('3 4 5 6 7').name === '順子 3～7' && ev('x X').name === '王炸' && ev('9 9 9 9').name === '炸彈 9' && ev('3 3 3 4 4 4 5 6').name === '飛機帶單 3～4', 'names');
// --- every evaluate() result round-trips through gen(): enumerate plays from random hands and re-evaluate ---
{
  const r = DZ.rng(99); let plays = 0, badEv = 0, badBeat = 0, dup = 0;
  for (let t = 0; t < 200; t++) {
    const d = DZ.deal(t + 1), hand = d.hands[0].concat(t % 2 ? d.bottom : []);
    const all = DZ.gen(hand, null), keys = new Set();
    all.forEach(o => { plays++; const e = DZ.evaluate(o.cards); if (!e || e.t !== o.ev.t || e.k !== o.ev.k || e.n !== o.ev.n) badEv++; if (!o.cards.every(c => hand.includes(c))) badEv++; const k = o.cards.slice().sort((a, b) => a - b).join(','); if (keys.has(k)) dup++; keys.add(k); });
    // following: everything gen(hand, lead) returns beats the lead, and nothing in gen(hand) that beats the lead is missing by type
    const lead = all[Math.floor(r() * all.length)].ev;
    const follow = DZ.gen(hand, lead);
    follow.forEach(o => { if (!DZ.beats(o.ev, lead)) badBeat++; });
    const fromAll = all.filter(o => DZ.beats(o.ev, lead)).length;
    if (fromAll > follow.length) badBeat++;
  }
  ok(plays > 2000, 'enumeration produced plays (' + plays + ')'); ok(badEv === 0, 'every enumerated play evaluates to its own type'); ok(dup === 0, 'no duplicate enumerated plays'); ok(badBeat === 0, 'gen(hand, lead) returns exactly the beating plays');
}
// --- gen enumerates the known plays of a fixed hand ---
{
  const hand = cs('3 3 3 4 4 4 5 6 7 8 9 9 9 9 x X 2 2 A A');
  const types = {}; DZ.gen(hand, null).forEach(o => { types[o.ev.t] = (types[o.ev.t] || 0) + 1; });
  ok(types.rocket === 1 && types.bomb === 1, 'rocket and bomb found'); ok(types.plane >= 1 && types.plane1 >= 1 && types.plane2 >= 1, 'planes with and without wings');
  ok(types.straight >= 1, 'straight 3-9 found'); ok(types.four2 >= 1 && types.four22 >= 1, 'four+2 variants'); ok(types.triple1 >= 1 && types.triple2 >= 1, 'triple with kickers');
  const h = DZ.hints(hand, null); ok(h[0].ev.t === 'single' && h[0].ev.k === 0, 'hints start with the lowest single'); ok(DZ.isBomb(h[h.length - 1].ev), 'hints end with bombs');
  const fol = DZ.hints(hand, ev('K K')); ok(fol.length === 4 && fol[0].ev.t === 'pair' && fol[0].ev.k === R.A && fol[1].ev.k === R['2'] && fol[2].ev.t === 'bomb' && fol[3].ev.t === 'rocket', 'answers to pair K: AA, 22, bomb, rocket in order');
  ok(DZ.hints(cs('3 4 5'), ev('2')).length === 0, 'no answer to a 2 from low singles');
  ok(DZ.hints(cs('3 3 3 3'), ev('x X')).length === 0, 'nothing answers the rocket');
}
// --- decomposition ---
ok(DZ.handsNeeded(cs('3 4 5 6 7 8 9')) === 1, 'a straight is one hand'); ok(DZ.handsNeeded(cs('3 3 3 4 4 4 5 6')) === 1, 'plane with wings is one hand');
ok(DZ.handsNeeded(cs('x X 2 2 2 2')) === 2, 'rocket + bomb = two hands'); ok(DZ.handsNeeded(cs('3 5 7 9 J')) === 5, 'five loose singles');
ok(DZ.bestSplit(cs('3 3 4 4 5 5 6 6 7 7')).length === 1, 'five consecutive pairs kept together');
// --- game flow / bidding ---
{
  const g = new DZ.Game({ seed: 42 });
  ok(g.hands.every(h => h.length === 17) && g.bottom.length === 3, '17 cards each + 3 bottom');
  const all = g.hands.flat().concat(g.bottom).sort((a, b) => a - b); ok(all.length === 54 && all.every((c, i) => c === i), 'all 54 cards dealt once');
  ok(g.phase === 'bid' && g.turn === g.first, 'bidding starts with the first player');
  const p0 = g.turn; ok(g.doBid((p0 + 1) % 3, 1) !== null, 'out of turn bid rejected'); ok(g.doBid(p0, 4) !== null, 'bid 4 rejected');
  ok(g.doBid(p0, 1) === null && g.bid === 1 && g.landlord === p0, 'bid 1'); const p1 = g.turn;
  ok(g.doBid(p1, 1) !== null, 'equal bid rejected'); ok(g.doBid(p1, 0) === null, 'pass'); const p2 = g.turn;
  ok(g.doBid(p2, 2) === null && g.phase === 'play' && g.landlord === p2 && g.bid === 2, 'highest bidder is landlord after three bids');
  ok(g.hands[p2].length === 20 && g.turn === p2, 'landlord has 20 cards and leads');
  ok(g.pass(p2) !== null, 'leader cannot pass');
  const low = g.hands[p2][0]; ok(g.play(p2, [low]) === null && g.lead.by === p2 && g.hands[p2].length === 19, 'landlord plays a single');
  const q = g.turn, big = g.hands[q].filter(c => DZ.rk(c) > DZ.rk(low)).sort((a, b) => DZ.rk(a) - DZ.rk(b))[0];
  ok(g.check(q, [g.hands[q].find(c => DZ.rk(c) <= DZ.rk(low)) || g.hands[q][0]]) !== null || big == null, 'lower single rejected');
  if (big != null) ok(g.play(q, [big]) === null && g.lead.by === q, 'farmer beats it');
  const q2 = g.turn; ok(g.pass(q2) === null, 'pass'); const q3 = g.turn; ok(g.pass(q3) === null, 'second pass');
  ok(g.lead === null && g.turn === (big != null ? q : p2), 'two passes return the lead');
}
{ // bid 3 ends bidding at once; all pass -> redeal
  const g = new DZ.Game({ seed: 5 }); const p = g.turn; g.doBid(p, 3); ok(g.phase === 'play' && g.landlord === p, '3 points ends bidding immediately');
  const h = new DZ.Game({ seed: 6 }); h.doBid(h.turn, 0); h.doBid(h.turn, 0); h.doBid(h.turn, 0); ok(h.phase === 'redeal' && h.landlord < 0, 'all pass -> redeal');
}
// --- scoring ---
function finished(setup) { // play out a scripted end: landlord L, bid, bombs, farmer plays, winner
  const g = new DZ.Game({ seed: 1 }); g.phase = 'end'; g.landlord = setup.L; g.bid = setup.bid; g.bombs = setup.bombs || 0; g.plays = setup.plays; g.winner = setup.winner; return g.result();
}
{
  let r = finished({ L: 0, bid: 2, plays: [5, 3, 2], winner: 0 }); ok(r.landlordWon && r.unit === 2 && r.deltas.join() === '4,-2,-2', 'landlord wins: +2 units from each farmer');
  r = finished({ L: 1, bid: 3, plays: [4, 5, 3], winner: 2 }); ok(!r.landlordWon && r.deltas.join() === '3,-6,3', 'farmers win: landlord pays both');
  r = finished({ L: 0, bid: 1, bombs: 2, plays: [5, 3, 2], winner: 0 }); ok(r.mult === 4 && r.deltas.join() === '8,-4,-4', 'two bombs ×4');
  r = finished({ L: 0, bid: 3, plays: [6, 0, 0], winner: 0 }); ok(r.spring && r.mult === 2 && r.deltas.join() === '12,-6,-6', '春天: farmers never played ×2');
  r = finished({ L: 0, bid: 3, plays: [6, 1, 0], winner: 0 }); ok(!r.spring, 'a farmer who played once cancels 春天');
  r = finished({ L: 2, bid: 1, plays: [4, 3, 1], winner: 0 }); ok(r.anti && r.mult === 2 && r.deltas.join() === '2,2,-4', '反春: landlord played once only ×2');
  r = finished({ L: 2, bid: 1, bombs: 1, plays: [4, 3, 1], winner: 1 }); ok(r.mult === 4 && r.tags.length === 2, 'bomb + 反春 stack');
  r = finished({ L: 1, bid: 2, plays: [4, 3, 2], winner: 1 }); ok(!r.spring && !r.anti && r.mult === 1, 'plain game ×1');
}
// --- bidding strength ---
ok(DZ.suggestBid(cs('x X 2 2 2 A A A K K K Q Q J 10 9 8'), 0, 1) === 3, 'rocket + three 2s + planes bids 3');
ok(DZ.suggestBid(cs('3 4 5 6 7 8 9 10 J Q K 3 4 5 6 7 8'), 0, 1) <= 1, 'weak hand bids little');
ok(DZ.suggestBid(cs('x X 2 2 2 A A A K K K Q Q J 10 9 8'), 3, 1) === 0, 'cannot outbid 3');
// --- AI: legal, never stalls, reasonable ---
{
  let illegal = 0, stall = 0, games = 0, lw = 0, bombsUsed = 0, passBid = 0, feed = 0, partnerOverride = 0, plies = 0;
  for (let s = 1; s <= 400; s++) {
    let g = new DZ.Game({ seed: s }), k = 0;
    while (g.phase === 'bid') { const r = DZ.think(DZ.aiView(g, g.turn), s * 7 + k); if (g.doBid(g.turn, r.bid)) { illegal++; break; } k++; }
    if (g.phase === 'redeal') { passBid++; continue; }
    while (g.phase === 'play' && k < 400) {
      const p = g.turn, v = DZ.aiView(g, p), r = DZ.think(v, s * 1000 + k);
      if (r.cards && g.lead && g.lead.by !== g.landlord && p !== g.landlord && g.lead.by !== p) { partnerOverride++; }
      const e = r.cards ? g.play(p, r.cards) : g.pass(p); if (e) { illegal++; break; } k++;
    }
    if (g.phase !== 'end') { stall++; continue; }
    games++; plies += k; if (g.result().landlordWon) lw++; bombsUsed += g.bombs;
  }
  ok(illegal === 0, 'AI never makes an illegal move (' + illegal + ')'); ok(stall === 0, 'AI never stalls'); ok(games >= 380, 'games finish (' + games + ', redeals ' + passBid + ')');
  ok(lw / games > 0.35 && lw / games < 0.8, 'landlord win rate plausible (' + (lw / games * 100).toFixed(0) + '%)');
  ok(bombsUsed > 0, 'bombs get used (' + bombsUsed + ')'); ok(partnerOverride / games < 1.5, 'farmers rarely beat their partner (' + (partnerOverride / games).toFixed(2) + ' per game)');
  ok(plies / games < 60, 'games are not absurdly long (' + (plies / games).toFixed(1) + ' plies)');
}
{ // AI specifics
  const g = new DZ.Game({ seed: 3 }); g.doBid(g.turn, 3); const L = g.landlord;
  // landlord with one hand left plays it all
  g.hands[L] = cs('3 4 5 6 7'); let r = DZ.think(DZ.aiView(g, L), 1); ok(r.cards && r.cards.length === 5, 'AI finishes with its last hand');
  // following with a bomb when the opponent is nearly out
  g.hands[L] = cs('9 9 9 9 3 4 5 6 7 8 10'); const f = (L + 1) % 3; g.hands[f] = cs('2'); g.lead = { by: f, cards: cs('2'), ev: ev('2') }; g.turn = L; g.passes = 0;
  r = DZ.think(DZ.aiView(g, L), 1); ok(r.cards && DZ.evaluate(r.cards).t === 'bomb', 'landlord bombs a lone farmer about to win');
  // farmer passes on partner's lead when the landlord is far away
  const f2 = (L + 2) % 3; g.hands[L] = cs('3 4 5 6 7 8 9 10 J Q K A 2 2 2 3 3 4'); g.hands[f] = cs('5 6 7 8 9 10 J Q K 3 3 4 4'); g.hands[f2] = cs('A A 2 K K K 5 6 7 8 9 9');
  g.lead = { by: f, cards: cs('5'), ev: ev('5') }; g.turn = f2; r = DZ.think(DZ.aiView(g, f2), 2); ok(r.cards === null, 'farmer lets partner keep a low lead');
  // farmer feeds a partner holding one card
  g.hands[f] = cs('K'); g.lead = null; g.turn = f2; g.hands[f2] = cs('3 4 7 7 9 9 9 J J'); r = DZ.think(DZ.aiView(g, f2), 2); ok(r.cards && r.cards.length === 1 && DZ.rk(r.cards[0]) === 0, 'farmer leads its lowest single to feed a partner with one card');
  // leading with 2 hands where one is unbeatable: play the unbeatable one first? either order wins; must not pass
  g.hands[f2] = cs('x X 3 4 5 6 7'); g.lead = null; g.turn = f2; r = DZ.think(DZ.aiView(g, f2), 2); ok(r.cards && (r.cards.length === 5 || r.cards.length === 2), 'two hands left: leads one of them');
}
// --- difficulty levels: only the opponents get weaker; levels are ordered ---
{
  const g = new DZ.Game({ seed: 21 }); ok(DZ.aiLevel(g, 1, 0) === 0, 'bidding uses the chosen level');
  while (g.phase === 'bid') g.doBid(g.turn, g.turn === 1 ? 3 : 0);
  ok(g.landlord === 1 && DZ.aiLevel(g, 1, 0) === 0 && DZ.aiLevel(g, 2, 0) === 2, 'human farmer: landlord AI at the chosen level, partner AI at full strength');
  const h = new DZ.Game({ seed: 22 }); while (h.phase === 'bid') h.doBid(h.turn, h.turn === 0 ? 3 : 0);
  ok(h.landlord === 0 && DZ.aiLevel(h, 1, 1) === 1 && DZ.aiLevel(h, 2, 1) === 1, 'human landlord: both AIs at the chosen level');
  // AI (strong, seat 0 stand-in) vs AIs of each level: the weaker the opponents, the more seat 0 wins
  const wins = [0, 1, 2].map(lv => { let w = 0, n = 0; for (let i = 0; i < 150; i++) { const q = new DZ.Game({ seed: 7000 + i }); let k = 0;
    while (q.phase === 'bid') { const p = q.turn; q.doBid(p, p === 0 ? 0 : DZ.think(DZ.aiView(q, p), k++, lv).bid); }
    if (q.phase !== 'play') continue;
    while (q.phase === 'play' && k < 600) { const p = q.turn; let c = DZ.think(DZ.aiView(q, p), (q.seed ^ (q.log.length * 2654435761)) >>> 0, p === 0 ? 2 : DZ.aiLevel(q, p, lv)).cards; if (!c && !q.lead) c = DZ.hints(q.hands[p], null)[0].cards; const e = c ? q.play(p, c) : q.pass(p); if (e) { ok(false, 'level ' + lv + ' illegal move: ' + e); break; } k++; }
    if (q.phase === 'end') { n++; if (q.result().deltas[0] > 0) w++; } } return w / n; });
  ok(wins[0] > wins[1] && wins[1] > wins[2], 'levels are ordered: seat 0 wins ' + wins.map(x => (x * 100).toFixed(0) + '%').join(' > '));
}
// --- snapshot round trip ---
{ const g = new DZ.Game({ seed: 11 }); g.doBid(g.turn, 2); g.doBid(g.turn, 0); g.doBid(g.turn, 0); const h = DZ.Game.restore(g.snapshot()); ok(h.phase === 'play' && h.landlord === g.landlord && h.hands[h.landlord].length === 20 && typeof h.play === 'function', 'snapshot/restore keeps state and methods'); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
