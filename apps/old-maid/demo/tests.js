// Rule tests for 抽鬼牌 (old-maid). Extracts the engine between the CORE markers of ../index.html,
// checks every rule in the spec, then auto-plays 10000 rounds (all variants, all AI levels) checking
// card conservation, exactly one loser (two only in split double-joker), and no stalls.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const OM = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return OM;')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const C = s => { if (s === 'JK') return 52; if (s === 'JK2') return 53; const m = s.match(/^(10|[2-9AJQK])([SHDC])$/); return 'SHDC'.indexOf(m[2]) * 13 + OM.RK.indexOf(m[1]); };
const cs = s => s.split(' ').filter(Boolean).map(C);
const sorted = a => a.slice().sort((x, y) => x - y).join(',');
function mk(hands, o, turn) { // a state built from explicit hands
  const S = OM.newRound(1, o || {}, 0);
  S.hands = hands.map(cs); S.active = S.hands.map(h => h.length ? 1 : 0); S.out = []; S.losers = []; S.over = false; S.raised = [-1, -1, -1, -1]; S.turn = turn || 0; S.pile = [];
  return S;
}

// --- deck & deal ---
{
  const S = OM.newRound(42, {}, 0);
  ok(S.dealt.reduce((a, h) => a + h.length, 0) === 53, '53 cards dealt');
  ok(new Set([].concat(...S.dealt)).size === 53, 'all 53 distinct (52 + 1 joker)');
  ok(sorted(S.dealt.map(h => h.length)) === '13,13,13,14' && S.dealt[1].length === 14, 'dealt clockwise from dealer+1: that seat has 14, others 13');
  const S2 = OM.newRound(42, {}, 2); ok(S2.dealt[3].length === 14, 'dealer 2 → seat 3 gets 14');
  ok(JSON.stringify(OM.newRound(42, {}, 0).hands) === JSON.stringify(S.hands) && JSON.stringify(OM.newRound(43, {}, 0).hands) !== JSON.stringify(S.hands), 'seeded shuffle reproducible');
  ok(OM.deck({ double: true }).length === 54, 'double joker: 54 cards');
  ok(OM.deck({ quick: true }).length === 25 && OM.deck({ quick: true }).every(c => c === 52 || c % 13 < 6), 'quick: A–6 ×4 + joker = 25');
  // after the initial discard, every hand has at most one card of each rank and the joker is somewhere
  let okk = true; for (let s = 0; s < 300; s++) { const R = OM.newRound(s, {}, s % 4); R.hands.forEach(h => { const r = h.filter(c => c < 52).map(OM.rank); if (new Set(r).size !== r.length) okk = false; });
    if (R.hands.reduce((a, h) => a + h.length, 0) + R.pile.length * 2 !== 53) okk = false; if (!R.hands.some(h => h.includes(52))) okk = false; }
  ok(okk, 'initial discard: no pairs left in any hand, counts conserved, joker still in play (300 deals)');
}
// --- pair stripping ---
{
  let r = OM.strip(cs('5S 5H 5D 9C'), {}); ok(r.pairs.length === 1 && sorted(r.hand) === sorted(cs('5D 9C')), 'three of a kind: discard one pair, keep one');
  r = OM.strip(cs('7S 7H 7D 7C 2S'), {}); ok(r.pairs.length === 2 && sorted(r.hand) === sorted(cs('2S')), 'four of a kind: discard two pairs');
  r = OM.strip(cs('QS QH JK'), {}); ok(r.pairs.length === 1 && sorted(r.hand) === '52', 'pairs ignore suit colour by default; single joker never pairs');
  r = OM.strip(cs('QS QH'), { color: true }); ok(r.pairs.length === 0, 'colour variant: black Q and red Q do not pair');
  r = OM.strip(cs('QS QC QH QD'), { color: true }); ok(r.pairs.length === 2, 'colour variant: ♠♣ pair and ♥♦ pair');
  r = OM.strip(cs('3S 3H 3C'), { color: true }); ok(r.pairs.length === 1 && sorted(r.hand) === sorted(cs('3H')), 'colour variant: 3♠3♣ pair, 3♥ stays');
  r = OM.strip([52, 53], { double: true }); ok(r.pairs.length === 1, 'double joker: the two jokers pair');
  r = OM.strip([52, 53], {}); ok(r.pairs.length === 0, 'jokers do not pair outside double mode');
}
// --- draw target, pairing, going out, skipping ---
{
  let S = mk(['5S 9H', '5H KD', 'KS JK', '9D'], {}, 0);
  ok(OM.nextActive(S, 0) === 1 && OM.nextActive(S, 3) === 0, 'target = next seat clockwise');
  let ev = OM.draw(S, 0); // seat 0 draws 5H from seat 1
  ok(ev.t === 1 && ev.card === C('5H') && ev.pair && sorted(S.hands[0]) === sorted(cs('9H')), 'drawn card that matches is discarded at once');
  ok(S.turn === 1, 'turn passes to the player who was drawn from');
  S = mk(['5S', '', 'KS JK', '5H'], {}, 0);
  ok(OM.nextActive(S, 0) === 2 && OM.nextActive(S, 3) === 0, 'seats already out are skipped');
  S = mk(['5S 2D', '5H', 'KS JK', '2C KH'], {}, 0);
  ev = OM.draw(S, 0); ok(ev.outs.includes(1) && S.out[0] === 1 && !S.active[1], 'drawn down to 0 cards → safely out (target with 1 card is still drawn)');
  ok(S.turn === 2, 'next turn skips the seat that just went out');
  S = mk(['5S', '5H 9S', 'KS JK', '9C KH'], {}, 0);
  ev = OM.draw(S, 0); ok(ev.outs.includes(0) && S.out[0] === 0, 'emptying your hand by pairing → out');
  S = mk(['5S', '5H', 'JK 2S', '2H'], {}, 0);
  ev = OM.draw(S, 0); ok(sorted(ev.outs) === '0,1' && S.out[0] === 1 && S.out[1] === 0, 'both out on one draw: the drawn-from seat first');
  S = mk(['', '', 'JK', '5H'], {}, 2); S.active = [0, 0, 1, 1]; S.hands[3] = cs('5H'); S.hands[2] = cs('JK 5S');
  ev = OM.draw(S, 0); // seat 2 draws 5H from seat 3
  ok(ev.over && S.losers.length === 1 && S.losers[0] === 2 && sorted(S.hands[2]) === '52', 'end: the last one left holds the joker and loses');
  S = mk(['5S', '5H JK', '', ''], {}, 0); ev = OM.draw(S, 1);
  ok(ev.card === 52 && !ev.over && S.turn === 1, 'drawing the joker just keeps it');
  // scoring
  const T = mk(['', '', '', 'JK'], {}); T.out = [2, 0, 1]; T.losers = [3]; T.over = true;
  ok(JSON.stringify(OM.points(T)) === '[2,1,3,0]', 'points 3/2/1 by finishing order, joker holder 0');
  ok(JSON.stringify(OM.places(T)) === '[2,3,1,4]', 'places');
}
// --- double joker ending ---
{
  let S = mk(['JK 4S', 'JK2 4H', '', ''], { double: true }, 0); S.hands[1] = [53, C('4H')];
  let ev = OM.draw(S, 1); // 0 draws 4H → pairs 4S; only jokers remain, split
  ok(ev.over && sorted(S.losers) === '0,1', 'double joker split across two hands → both lose');
  ok(JSON.stringify(OM.points(S)) === '[0,0,0,0]', 'split losers both score 0');
  S = mk(['JK 4S', 'JK2', '4H', ''], { double: true }, 0); S.hands[1] = [53];
  ev = OM.draw(S, 0); ok(ev.pair && OM.isJ(ev.pair[0]) && ev.outs.includes(1), 'double joker: drawing the other joker pairs them');
}
// --- start rule ---
{
  let okk = true; for (let s = 0; s < 200; s++) { const R = OM.newRound(s, {}, s % 4); if (R.over) continue; let best = -1, bp = 0;
    for (let i = 1; i <= 4; i++) { const p = (R.dealer + i) % 4; if (R.hands[p].length > best) { best = R.hands[p].length; bp = p; } } if (R.turn !== OM.nextActive(R, bp)) okk = false; }
  ok(okk, 'default start: the seat after the player holding most cards');
  const st = new Set(); for (let s = 0; s < 200; s++) { const R = OM.newRound(s, { start: 'random' }, 0); if (!R.over) st.add(R.turn); }
  ok(st.size === 4, 'random start covers all seats');
}
// --- AI behaviours (hiding & picking are observable) ---
{
  const P = OM.blankProf(); P.z = [0, 0, 0, 0, 40];
  let fav = 0; for (let s = 0; s < 200; s++) { const A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 1, seed: s, prof: P }); if (OM.zone(A.order.indexOf(52), 10) === 4) fav++; }
  ok(fav === 200, '一般 hides the joker in the drawer\'s favourite zone');
  let z4 = 0; for (let s = 0; s < 2000; s++) { const A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 0, seed: s, prof: P }); if (OM.zone(A.order.indexOf(52), 10) === 4) z4++; if (A.raised >= 0) z4 = -1e9; }
  ok(z4 > 300 && z4 < 500, '新手 hides at random and never raises (' + z4 + '/2000 in zone 4)');
  const taker = OM.blankProf(); taker.rs = 30; taker.rt = 27;
  let A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S JK'), lvl: 2, seed: 1, prof: taker }); ok(A.how === 'raiseJ' && A.raised === 52, '高手 raises the joker for a drawer who takes raised cards');
  const avoider = OM.blankProf(); avoider.rs = 30; avoider.rt = 1; avoider.z = [2, 2, 30, 2, 2];
  A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 2, seed: 1, prof: avoider });
  ok(A.how === 'bait' && A.raised !== 52 && OM.zone(A.order.indexOf(52), 10) === 2, '高手 raises a decoy and hides the joker in the favourite zone for a drawer who avoids raised cards');
  let b = 0; for (let s = 0; s < 1000; s++) if (OM.pick({ n: 8, ri: 3, lvl: 0, seed: s }).idx === 3) b++;
  ok(b > 560 && b < 700, '新手 takes a raised card ~60%+ (' + b + '/1000)');
  b = 0; for (let s = 0; s < 1000; s++) if (OM.pick({ n: 8, ri: 3, lvl: 1, seed: s }).idx === 3) b++;
  ok(b > 200 && b < 300, '一般 takes a raised card ~25% (' + b + '/1000)');
  const liar = OM.blankProf(); liar.hr = 20; liar.hj = 15, honest = OM.blankProf(); honest.hr = 40; honest.hj = 0;
  ok(OM.pick({ n: 8, ri: 3, lvl: 2, seed: 5, hp: liar }).idx !== 3 && OM.pick({ n: 8, ri: 3, lvl: 2, seed: 5, hp: honest }).idx === 3, '高手 avoids a raised card from a holder whose raised cards were jokers, takes it otherwise');
  const own = OM.blankProf(); own.z = [9, 9, 0, 9, 9];
  ok(OM.zone(OM.pick({ n: 10, ri: -1, lvl: 2, seed: 3, own }).idx, 10) === 2, '高手 draws from its least used zone (unpredictable)');
  const f = l => { const c = { nervous: 0, calm: 0, smirk: 0 }; for (let s = 0; s < 1000; s++) c[OM.face({ lvl: l, hasJ: true, seed: s })]++; return c.nervous / 1000; };
  ok(f(0) === 1 && f(1) > 0.55 && f(1) < 0.75 && f(2) < 0.15, 'faces: 新手 honest, 一般 half honest, 高手 reversed (nervous with joker: ' + [f(0), f(1), f(2)].join(' / ') + ')');
}
// --- 10000 auto-played rounds over all variants and levels ---
{
  const variants = [{}, { double: true }, { color: true }, { quick: true }, { double: true, color: true, quick: true }, { start: 'random' }];
  let rounds = 0, bad = 0, split = 0, paired = 0, maxDraws = 0, draws = 0;
  for (let m = 0; rounds < 10000; m++) {
    const o = variants[m % variants.length], M = OM.newMatch(OM.hash('t', m), o, 5), lv = [m % 3, (m + 1) % 3, (m + 2) % 3, m % 3];
    while (!M.over) {
      const S = OM.simRound(M, lv); rounds++; draws += S.n; maxDraws = Math.max(maxDraws, S.n);
      const total = OM.deck(o).length, inHands = S.hands.reduce((a, h) => a + h.length, 0);
      if (inHands + S.pile.length * 2 !== total) bad++;
      const nl = S.losers.length;
      if (!o.double && (nl !== 1 || !S.hands[S.losers[0]].includes(52) || S.hands[S.losers[0]].length !== 1)) bad++;
      if (o.double) { if (nl === 2) split++; else if (nl === 0) paired++; else bad++; }
      if (S.out.length + nl !== 4) bad++;
      const pts = OM.points(S); if (pts.reduce((a, b) => a + b) !== [0, 3, 5, 6, 6][S.out.length]) bad++;
    }
  }
  ok(bad === 0, `10000 rounds: cards conserved, exactly one loser holding only the joker (split double-joker: 2), points 3/2/1 — ${bad} violations`);
  console.log(`  auto-play: ${rounds} rounds, avg ${(draws / rounds).toFixed(1)} draws, max ${maxDraws} (no stall); double-joker rounds: ${split} split (2 losers), ${paired} jokers paired (no loser)`);
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
