// Rule unit tests for 二十一點 (blackjack), run against the game's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {RULES,MINBET,MAXBET,START,rng,newShoe,rank,cval,hval,isBJ,newGame,deal,insure,legal,act,advise,strat,canBet,simulate};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
// card code: rank 1=A..13=K, suit 0..3  ->  suit*13 + rank-1
const c = (r, s = 0) => s * 13 + r - 1;
const A = 1, J = 11, Q = 12, K = 13;
// rigged game: cards are dealt in order P1, D-up, P2, D-hole, then hits
function rig(rk, cards, bank = 1000) { const G = C.newGame(rk, 1, bank); G.shoe = { c: cards.map(x => c(x)), pos: 0, cut: 9999 }; return G; }
const net = G => G.net;

// --- hand values ---
const hv = a => C.hval(a.map(x => c(x)));
t('A+6 = soft 17', hv([A, 6]).t === 17 && hv([A, 6]).soft);
t('A+6+10 = hard 17', hv([A, 6, 10]).t === 17 && !hv([A, 6, 10]).soft);
t('A+A = soft 12', hv([A, A]).t === 12 && hv([A, A]).soft);
t('A+A+9 = 21', hv([A, A, 9]).t === 21);
t('K+Q+2 = 22 bust', hv([K, Q, 2]).t === 22);
t('J/Q/K count 10', C.cval(c(J)) === 10 && C.cval(c(Q)) === 10 && C.cval(c(K)) === 10);
t('A+K is blackjack', C.isBJ([c(A), c(K)], false));
t('A+K after split is not blackjack', !C.isBJ([c(A), c(K)], true));
t('5+6+K = 21 not blackjack', !C.isBJ([c(5), c(6), c(K)], false));

// --- shoe ---
for (const [rk, n] of [['easy', 4], ['std', 6], ['strict', 8]]) {
  const s = C.newGame(rk, 42).shoe;
  t(rk + ' shoe has ' + n * 52 + ' cards', s.c.length === n * 52);
  t(rk + ' cut card at 75%', s.cut === Math.floor(n * 52 * 0.75));
  const cnt = new Array(52).fill(0); s.c.forEach(x => cnt[x]++);
  t(rk + ' each card appears ' + n + ' times', cnt.every(k => k === n));
}
t('6 decks = 312 cards, cut at 234', C.newGame('std', 1).shoe.c.length === 312 && C.newGame('std', 1).shoe.cut === 234);
t('same seed -> same shoe', JSON.stringify(C.newGame('std', 7).shoe.c) === JSON.stringify(C.newGame('std', 7).shoe.c));
t('different seed -> different shoe', JSON.stringify(C.newGame('std', 7).shoe.c) !== JSON.stringify(C.newGame('std', 8).shoe.c));
{ const G = C.newGame('std', 5); G.shoe.pos = G.shoe.cut; C.deal(G, 10);
  t('reaching the cut card reshuffles before the next round', G.ev.some(e => e.t === 'shuffle') && G.shoe.pos < 20); }
{ const G = C.newGame('std', 5); G.shoe.pos = G.shoe.cut - 1; C.deal(G, 10);
  t('round started before cut card is dealt from the same shoe', !G.ev.some(e => e.t === 'shuffle')); }

// --- bets ---
{ const G = C.newGame('std', 1, 300);
  t('min bet 10', !C.canBet(G, 5) && C.canBet(G, 10));
  t('max bet 500', !C.canBet(C.newGame('std', 1, 5000), 510) && C.canBet(C.newGame('std', 1, 5000), 500));
  t('cannot bet more than points', !C.canBet(G, 310) && C.canBet(G, 300)); }

// --- blackjack, peek, insurance ---
{ const G = rig('std', [A, 9, K, 7]); C.deal(G, 10);
  t('player blackjack settles immediately', G.phase === 'done' && G.hands[0].res === 'bj');
  t('blackjack pays 3:2 (+15 on 10)', G.bank === 1015 && net(G) === 15); }
{ const G = rig('std', [A, 9, K, 7]); C.deal(G, 25);
  t('3:2 on odd bet rounds down (25 -> +37)', G.bank === 1037); }
{ const G = rig('std', [9, K, 8, A]); C.deal(G, 10);
  t('dealer 10 up with blackjack: peek ends round before player acts', G.phase === 'done' && G.hands[0].res === 'lose' && G.bank === 990); }
{ const G = rig('std', [9, K, 8, 7]); C.deal(G, 10);
  t('dealer 10 up without blackjack: player acts', G.phase === 'play' && G.ev.some(e => e.t === 'peek' && !e.bj)); }
{ const G = rig('std', [9, 5, 8, A]); C.deal(G, 10);
  t('dealer 5 up: no peek', G.phase === 'play' && !G.ev.some(e => e.t === 'peek')); }
{ const G = rig('std', [9, A, 8, K]); C.deal(G, 10);
  t('dealer ace up offers insurance', G.phase === 'ins');
  C.insure(G, true);
  t('insurance pays 2:1 when dealer has blackjack (net 0)', G.phase === 'done' && G.bank === 1000 && net(G) === 0); }
{ const G = rig('std', [9, A, 8, 7, 2]); C.deal(G, 10); C.insure(G, true);
  t('insurance lost when dealer has no blackjack, play continues', G.phase === 'play' && G.bank === 985); }
{ const G = rig('std', [9, A, 8, 7]); C.deal(G, 10); C.insure(G, false);
  t('declined insurance costs nothing', G.phase === 'play' && G.bank === 990); }
{ const G = rig('std', [A, A, K, K]); C.deal(G, 10); C.insure(G, false);
  t('player and dealer blackjack push', G.hands[0].res === 'push' && G.bank === 1000); }

// --- hit / stand / bust ---
{ const G = rig('std', [10, 6, 6, 10, 9]); C.deal(G, 10); C.act(G, 'hit');
  t('player bust loses immediately; dealer does not draw', G.phase === 'done' && G.hands[0].res === 'bust' && G.dealer.length === 2 && G.bank === 990); }
{ const G = rig('std', [10, 6, 6, 10, K, K]); C.deal(G, 10); C.act(G, 'hit');
  t('player busts first and loses even though dealer would bust', G.hands[0].res === 'bust'); }
{ const G = rig('std', [10, 6, 7, 10, K]); C.deal(G, 10); C.act(G, 'stand');
  t('dealer hits 16 and busts -> player wins 1:1', G.hands[0].res === 'win' && G.bank === 1010 && G.dealer.length === 3); }
{ const G = rig('std', [10, 10, 8, 8]); C.deal(G, 10); C.act(G, 'stand');
  t('18 vs 18 pushes', G.hands[0].res === 'push' && G.bank === 1000); }
{ const G = rig('std', [5, 5, 6, 6, 10]); C.deal(G, 10); C.act(G, 'hit');
  t('reaching 21 by hitting auto-stands', G.phase === 'done'); }

// --- dealer S17 / H17 ---
{ const G = rig('std', [10, A, 8, 6, 5]); C.deal(G, 10); C.insure(G, false); C.act(G, 'stand');
  t('S17: dealer stands on soft 17', G.dealer.length === 2 && G.hands[0].res === 'win'); }
{ const G = rig('strict', [10, A, 8, 6, 3]); C.deal(G, 10); C.insure(G, false); C.act(G, 'stand');
  t('H17: dealer hits soft 17', G.dealer.length === 3 && C.hval(G.dealer).t === 20 && G.hands[0].res === 'lose'); }
{ const G = rig('strict', [10, 10, 8, 7, 5]); C.deal(G, 10); C.act(G, 'stand');
  t('H17: dealer stands on hard 17', G.dealer.length === 2); }

// --- double ---
{ const G = rig('std', [6, 6, 5, 10, 10, 10]); C.deal(G, 10); C.act(G, 'dbl');
  t('double: one card only, bet doubled, pays 2x', G.hands[0].c.length === 3 && G.hands[0].bet === 20 && G.bank === 1020); }
{ const G = rig('std', [2, 6, 3, 10, 4]); C.deal(G, 10); C.act(G, 'hit');
  t('double only on first two cards', !C.legal(G).dbl); }
{ const G = rig('std', [6, 6, 5, 10], 15); C.deal(G, 10); const L = C.legal(G);
  t('cannot double without enough points (reason shown)', !L.dbl && L.why.dbl === '點數不足'); }

// --- split ---
{ const G = rig('std', [8, 6, 8, 10, 3, 10, 2]); C.deal(G, 10);
  t('8,8 can split', C.legal(G).split);
  C.act(G, 'split');
  t('split makes two hands, each 10', G.hands.length === 2 && G.hands.every(h => h.bet === 10) && G.bank === 980);
  t('first split hand receives its second card', G.hands[0].c.length === 2 && G.hands[1].c.length === 1);
  t('DAS allowed in standard rules', C.legal(G).dbl); }
{ const G = rig('std', [K, 6, Q, 10]); C.deal(G, 10); t('K,Q (both 10 points) can split', C.legal(G).split); }
{ const G = rig('std', [9, 6, 8, 10]); C.deal(G, 10); t('9,8 cannot split', !C.legal(G).split && !C.legal(G).pair); }
{ const G = rig('strict', [8, 6, 8, 10, 3]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G); t('strict: no double after split', !L.dbl && L.why.dbl === '分牌後不可加倍'); }
{ const G = rig('std', [8, 6, 8, 10, 8, 8, 8, 2, 2, 2, 2, 2, 2]); C.deal(G, 10);
  C.act(G, 'split'); C.act(G, 'split'); C.act(G, 'split');
  t('standard: split up to 4 hands', G.hands.length === 4);
  const L = C.legal(G); t('no 5th hand (reason shown)', !L.split && L.why.split === '已達 4 手上限'); }
{ const G = rig('strict', [8, 6, 8, 10, 8]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G); t('strict: split only once', G.hands.length === 2 && !L.split && L.why.split === '只能分一次'); }
{ const G = rig('std', [8, 6, 8, 10], 15); C.deal(G, 10); const L = C.legal(G);
  t('cannot split without enough points (reason shown)', !L.split && L.why.split === '點數不足'); }
{ // split hands are played in order; dealer plays once
  const G = rig('std', [8, 6, 8, 10, 10, 9, 10]); C.deal(G, 10); C.act(G, 'split');
  t('current hand pointer starts at hand 0', G.cur === 0);
  C.act(G, 'stand'); t('after standing, hand 1 receives its card and becomes current', G.cur === 1 && G.hands[1].c.length === 2);
  C.act(G, 'stand'); t('dealer stands on 16? no: dealer hits 16 to 26 and busts, both hands win', G.phase === 'done' && G.hands.every(h => h.res === 'win') && G.bank === 1020); }

// --- split aces ---
{ const G = rig('std', [A, 6, A, 10, K, 5, 10]); C.deal(G, 10); C.act(G, 'split');
  t('split aces: each hand gets one card and is finished', G.phase === 'done' && G.hands.every(h => h.c.length === 2));
  t('split A + K = 21 pays 1:1, not 3:2', G.hands[0].res === 'win' && G.hands[0].pay === 20); }
{ const G = rig('std', [A, 6, A, 10, A, 5, 10]); C.deal(G, 10); C.act(G, 'split');
  t('standard: no resplit of aces', G.hands.length === 2 && G.phase === 'done'); }
{ const G = rig('easy', [A, 6, A, 10, A, 5, 9, 4, 10]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G);
  t('easy: may resplit aces, no hit/double on split aces', G.phase === 'play' && L.split && !L.hit && !L.dbl);
  C.act(G, 'split'); t('resplit aces makes 3 hands', G.hands.length === 3); }

// --- surrender ---
{ const G = rig('easy', [10, 10, 6, 7]); C.deal(G, 10);
  t('easy: late surrender available on first two cards', C.legal(G).sur);
  C.act(G, 'sur'); t('surrender returns half the bet', G.phase === 'done' && G.hands[0].res === 'sur' && G.bank === 995); }
{ const G = rig('std', [10, 10, 6, 7]); C.deal(G, 10); t('standard: no surrender', !C.legal(G).sur); }
{ const G = rig('easy', [10, 10, 6, A]); C.deal(G, 10);
  t('late surrender: dealer blackjack settles before surrender is possible', G.phase === 'done' && G.bank === 990); }
{ const G = rig('easy', [4, 10, 2, 7, 2]); C.deal(G, 10); C.act(G, 'hit'); t('no surrender after hitting', !C.legal(G).sur); }

// --- basic strategy tables vs an independently written chart (dealer 2..10,A) ---
const CH = {
  std: {
    hard: { 8: 'HHHHHHHHHH', 9: 'HDDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDH', 12: 'HHSSSHHHHH', 13: 'SSSSSHHHHH', 14: 'SSSSSHHHHH', 15: 'SSSSSHHHHH', 16: 'SSSSSHHHHH', 17: 'SSSSSSSSSS' },
    soft: { 2: 'HHHDDHHHHH', 3: 'HHHDDHHHHH', 4: 'HHDDDHHHHH', 5: 'HHDDDHHHHH', 6: 'HDDDDHHHHH', 7: 'SDDDDSSHHH', 8: 'SSSSSSSSSS', 9: 'SSSSSSSSSS' },
    pair: { 2: 'PPPPPPHHHH', 3: 'PPPPPPHHHH', 4: 'HHHPPHHHHH', 5: 'DDDDDDDDHH', 6: 'PPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPSPPSS', 10: 'SSSSSSSSSS', 1: 'PPPPPPPPPP' } },
  strict: {
    hard: { 8: 'HHHHHHHHHH', 9: 'HDDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDD', 12: 'HHSSSHHHHH', 13: 'SSSSSHHHHH', 16: 'SSSSSHHHHH', 17: 'SSSSSSSSSS' },
    soft: { 2: 'HHHDDHHHHH', 6: 'HDDDDHHHHH', 7: 'DDDDDSSHHH', 8: 'SSSSDSSSSS', 9: 'SSSSSSSSSS' },
    pair: { 2: 'HHPPPPHHHH', 3: 'HHPPPPHHHH', 4: 'HHHHHHHHHH', 6: 'HPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPSPPSS', 1: 'PPPPPPPPPP' } },
  easy: { // like std plus late surrender
    hard: { 14: 'SSSSSHHHHH', 15: 'SSSSSHHHRH', 16: 'SSSSSHHRRR', 17: 'SSSSSSSSSS' },
    pair: { 8: 'PPPPPPPPPP' } } };
const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
function hardCards(t) { return t <= 11 ? [2, t - 2] : t <= 19 ? [10, t - 10] : [10, 9, t - 19]; }
let chartN = 0;
for (const rk of Object.keys(CH)) {
  const R = C.RULES[rk];
  for (const [kind, rows] of Object.entries(CH[rk])) for (const [k, row] of Object.entries(rows)) UPS.forEach((u, i) => {
    let cs; if (kind === 'hard') { cs = hardCards(+k); if (cs[0] === cs[1]) cs = [cs[0] - 1, cs[1] + 1]; } else if (kind === 'soft') cs = [A, +k]; else cs = [+k, +k];
    const pair = kind === 'pair', got = C.strat(R, cs.map(x => c(x)), u, true, pair, R.sur);
    chartN++; t(`${rk} ${kind} ${k} vs ${u === 1 ? 'A' : u}: chart ${row[i]} got ${got}`, got === row[i]);
  });
}
t('3-card hard 11 hits (cannot double)', C.strat(C.RULES.std, [c(2), c(4), c(5)], 6, false, false, false) === 'H');
t('3-card soft 18 vs 4 stands (Ds -> S)', C.strat(C.RULES.std, [c(A), c(3), c(4)], 4, false, false, false) === 'S');
t('8,8 vs A in H17 with surrender -> R', C.strat(Object.assign({}, C.RULES.strict, { sur: true }), [c(8), c(8)], 1, true, true, true) === 'R');
t('8,8 at split cap plays as hard 16', C.strat(C.RULES.std, [c(8), c(8)], 10, true, false, false) === 'H');
// coach (advise) on live states
{ const G = rig('std', [10, 6, 6, 10]); C.deal(G, 10); t('coach: hard 16 vs 6 -> stand', C.advise(G) === 'stand'); }
{ const G = rig('std', [10, 10, 6, 7]); C.deal(G, 10); t('coach: hard 16 vs 10 -> hit (no surrender in std)', C.advise(G) === 'hit'); }
{ const G = rig('easy', [10, 10, 6, 7]); C.deal(G, 10); t('coach: hard 16 vs 10 -> surrender in easy', C.advise(G) === 'sur'); }
{ const G = rig('std', [8, 10, 8, 7]); C.deal(G, 10); t('coach: 8,8 vs 10 -> split', C.advise(G) === 'split'); }
{ const G = rig('std', [8, 10, 8, 7], 15); C.deal(G, 10); t('coach: 8,8 without points to split -> hit', C.advise(G) === 'hit'); }
{ const G = rig('std', [6, 6, 5, 10], 15); C.deal(G, 10); t('coach: 11 vs 6 without points to double -> hit', C.advise(G) === 'hit'); }

// --- endless scoring: payouts conserve points ---
{ const G = C.newGame('std', 2024, 1e9); let ok = true;
  for (let i = 0; i < 20000; i++) { const b0 = G.bank; C.deal(G, 10 + (i % 50) * 10); if (G.phase === 'ins') C.insure(G, i % 3 === 0); while (G.phase === 'play') C.act(G, C.advise(G));
    if (G.bank - b0 !== G.net) ok = false; G.ev.length = 0; }
  t('20,000 random rounds: bank change equals round net', ok); }
t('simulate is deterministic for a seed', JSON.stringify(C.simulate('std', 2000, 3)) === JSON.stringify(C.simulate('std', 2000, 3)));

console.log(`${pass} passed, ${fail} failed  (incl. ${chartN} strategy-chart cells)`);
process.exit(fail ? 1 : 0);
