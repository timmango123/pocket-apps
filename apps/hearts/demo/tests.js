// Rule tests for 紅心大戰 (hearts). Extracts the engine between the CORE markers of ../index.html
// and checks every rule in the spec, then runs 3000 AI-vs-AI rounds checking legality and point totals.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const { card, suit, rank, QS, JD, C2 } = HE;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const C = s => { const m = s.match(/^(10|[2-9JQKA])([CDSH])$/); return card('CDSH'.indexOf(m[2]), HE.RANKS.indexOf(m[1])); };
const cs = str => str.split(' ').filter(Boolean).map(C);
const same = (a, b) => JSON.stringify(a.slice().sort((x, y) => x - y)) === JSON.stringify(b.slice().sort((x, y) => x - y));
// build a play-phase state from explicit hands
function st(hands, o) {
  o = o || {};
  const S = HE.newRound(1, 3, o.opts || {});
  S.hm.fill(0); S.n = [0, 0, 0, 0];
  hands.forEach((h, p) => cs(h).forEach(c => { S.hm[p * 4 + suit(c)] |= 1 << rank(c); S.n[p]++; }));
  S.tno = o.tno || 0; S.broken = o.broken ? 1 : 0; S.turn = o.turn || 0; S.phase = 'play';
  (o.played || []).forEach(c => S.played[suit(c)] |= 1 << rank(c));
  return S;
}
const lg = (S, p) => HE.legal(S, p).map(HE.name).join(' ');

// --- deck & deal ---
{
  const hm = HE.deal(42), all = new Set(); let each = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (hm[p * 4 + s] & (1 << r)) { all.add(card(s, r)); each[p]++; }
  ok(all.size === 52 && each.every(x => x === 13), '52 distinct cards, 13 per player');
  ok(JSON.stringify(HE.deal(42)) === JSON.stringify(hm) && JSON.stringify(HE.deal(43)) !== JSON.stringify(hm), 'seeded shuffle is reproducible');
  ok(rank(card(0, 12)) > rank(card(0, 11)) && HE.name(card(0, 12)) === '♣A' && HE.name(C2) === '♣2', 'A high, 2 low');
}
// --- first trick ---
{
  const S = HE.newRound(7, 3, {});
  const p = HE.holderOf(S, C2);
  ok(S.phase === 'play' && S.turn === p, 'no-pass round: the 2♣ holder leads');
  ok(same(HE.legal(S, p), [C2]), '2♣ is the only legal first lead');
  // void in clubs on trick 1: no hearts and no Q♠
  const A = st(['2C 3C', '4H 5H QS 3D', 'AC', 'KC']); HE.play(A, C('2C'));
  ok(lg(A, 1) === '♦3', 'trick 1 discard: hearts and Q♠ forbidden when another card exists');
  const B = st(['2C 3C', '4H 5H QS', 'AC', 'KC']); HE.play(B, C('2C'));
  ok(same(HE.legal(B, 1), cs('4H 5H QS')), 'trick 1: holding only hearts and Q♠ (no clubs) → any card');
  const B2 = st(['2C 3C', 'KS AS 4H', 'AC', 'KC']); HE.play(B2, C('2C'));
  ok(same(HE.legal(B2, 1), cs('KS AS')), 'trick 1: non-point spades are fine to discard');
  const D = st(['2C 3C', '9C 4H QS', 'AC', 'KC']); HE.play(D, C('2C'));
  ok(lg(D, 1) === '♣9', 'trick 1: must follow clubs if possible');
}
// --- following suit & discards ---
{
  const S = st(['5D 9S', '3D KD 2H', 'AS', 'QH'], { tno: 3, broken: 1 }); HE.play(S, C('5D'));
  ok(same(HE.legal(S, 1), cs('3D KD')), 'must follow the led suit');
  HE.play(S, C('3D'));
  ok(same(HE.legal(S, 2), cs('AS')), 'void: may discard anything (later tricks)');
  const S2 = st(['5D', 'QS 2H', '6D', '7D'], { tno: 2 }); HE.play(S2, C('5D'));
  ok(same(HE.legal(S2, 1), cs('QS 2H')), 'after trick 1, points may be discarded');
  HE.play(S2, C('2H')); ok(S2.broken === 1, 'discarding a heart breaks hearts');
  ok(S2.voids[1] === (1 << 1), 'showing out marks the player void in that suit');
}
// --- breaking hearts ---
{
  const S = st(['2H 9H 4S', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S, 0), cs('4S')), 'cannot lead hearts before they are broken');
  const S1 = st(['2H 9H', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S1, 0), cs('2H 9H')), 'may lead hearts when holding only hearts');
  const S2 = st(['2H 9H 4S', '', '', ''], { tno: 2, broken: 1 });
  ok(same(HE.legal(S2, 0), cs('2H 9H 4S')), 'hearts may be led once broken');
  const S3 = st(['2H QS 4S', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S3, 0), cs('QS 4S')), 'hearts + Q♠ only, unbroken: Q♠ may be led, hearts not');
  // Q♠ breaks hearts only with the option
  const a = st(['3S', 'QS', '4S', '5S 2H 7C'], { tno: 2 }); a.turn = 0; HE.play(a, C('3S')); HE.play(a, C('QS')); HE.play(a, C('4S')); HE.play(a, C('5S'));
  ok(a.broken === 0 && !HE.legal(a, 3).includes(C('2H')), 'default: Q♠ does not break hearts');
  const b = st(['3S', 'QS', '4S', '5S 2H 7C'], { tno: 2, opts: { qsb: true } }); HE.play(b, C('3S')); HE.play(b, C('QS')); HE.play(b, C('4S')); HE.play(b, C('5S'));
  ok(b.broken === 1 && HE.legal(b, 3).includes(C('2H')), 'option: Q♠ breaks hearts');
}
// --- trick winner, next leader, points ---
{
  const S = st(['5D', 'AH', 'KD', '2D'], { tno: 4, broken: 1 });
  HE.play(S, C('5D')); HE.play(S, C('AH')); HE.play(S, C('KD')); const w = HE.play(S, C('2D'));
  ok(w === 2 && S.turn === 2, 'highest card of the led suit wins (off-suit A♥ ignored); winner leads next');
  ok(S.pts[2] === 1 && S.hc[2] === 1, 'a heart counts 1 point');
  const T = st(['3S', 'QS', '9S', 'KS'], { tno: 4 }); [ '3S', 'QS', '9S', 'KS' ].forEach(x => HE.play(T, C(x)));
  ok(T.pts[3] === 13 && T.qsBy === 3, 'Q♠ counts 13 points');
}
// helper: play a full round with given players' captured sets by brute assignment
function finishedRound(opts, ptsTo) {
  // ptsTo: function card->player who captured it
  const S = HE.newRound(5, 3, opts); S.phase = 'done'; S.tno = 13;
  for (let c = 0; c < 52; c++) { const p = ptsTo(c); if (suit(c) === 3) { S.hc[p]++; S.pts[p]++; } else if (c === QS) { S.qsBy = p; S.pts[p] += 13; } else if (c === JD) S.jdBy = p; }
  return S;
}
{
  const r = HE.roundScore(finishedRound({}, c => c % 4));
  ok(r.d.reduce((a, b) => a + b) === 26 && r.shooter < 0, 'normal round: 26 points in total');
  const m = HE.roundScore(finishedRound({}, c => 2));
  ok(m.shooter === 2 && JSON.stringify(m.d) === '[26,26,0,26]', 'shoot the moon: others +26, shooter 0 (total 78)');
  const m2 = HE.roundScore(finishedRound({ moonMinus: true }, c => 1));
  ok(m2.shooter === 1 && JSON.stringify(m2.d) === '[0,-26,0,0]', 'moon option: shooter −26 instead');
  const n = HE.roundScore(finishedRound({}, c => suit(c) === 3 && rank(c) === 0 ? 0 : 2));
  ok(n.shooter < 0 && n.d[2] === 25 && n.d[0] === 1, 'missing one heart is not a moon');
  const j = HE.roundScore(finishedRound({ jd: true }, c => c === JD ? 3 : c % 4));
  ok(j.d[3] === HE.roundScore(finishedRound({}, c => c === JD ? 3 : c % 4)).d[3] - 10, 'J♦ option: −10 to whoever takes it');
  const j0 = HE.roundScore(finishedRound({}, c => c === JD ? 3 : c % 4));
  ok(j0.d.reduce((a, b) => a + b) === 26, 'J♦ has no value without the option');
}
// --- passing ---
{
  ok([0, 1, 2, 3, 4, 5, 6, 7].map(r => HE.passDirFor(r, {})).join('') === '01230123', 'pass direction cycles left, right, across, none');
  ok([0, 1, 2, 3].every(r => HE.passDirFor(r, { passFixed: true }) === 0), 'fixed-direction option always passes left');
  ok(HE.passTarget(0, 0) === 1 && HE.passTarget(0, 1) === 3 && HE.passTarget(0, 2) === 2 && HE.passTarget(1, 0) === 2 && HE.passTarget(3, 0) === 0, 'pass targets (left=next seat clockwise)');
  for (const dir of [0, 1, 2]) {
    const S = HE.newRound(99 + dir, dir, {}); ok(S.phase === 'pass' && S.turn === -1, 'pass round starts in pass phase dir ' + dir);
    const passes = [0, 1, 2, 3].map(p => HE.hand(S, p).slice(0, 3));
    HE.applyPass(S, passes);
    let good = true;
    for (let p = 0; p < 4; p++) { const t = HE.passTarget(p, dir); for (const c of passes[p]) if (!HE.has(S, t, c) || HE.has(S, p, c)) good = false; if (HE.hand(S, p).length !== 13) good = false; }
    ok(good, 'applyPass moves exactly 3 cards to the right seat, everyone keeps 13 (dir ' + dir + ')');
    ok(S.phase === 'play' && HE.has(S, S.turn, C2), 'after passing, whoever now holds 2♣ leads');
  }
  let threw = false; try { const S = HE.newRound(3, 0, {}); HE.applyPass(S, [[0, 1], [], [], []]); } catch (e) { threw = true; }
  ok(threw, 'a pass must be exactly 3 owned cards');
}
// --- match end and tiebreak ---
{
  const M = HE.newMatch(1, {});
  HE.finishRound(M, { d: [20, 30, 40, 50], shooter: -1 }); ok(!M.over, 'no one at 100 → continue');
  HE.finishRound(M, { d: [30, 26, 26, 50], shooter: -1 }); ok(M.over && M.winner === 0, '≥100 reached → lowest total wins');
  const T = HE.newMatch(1, {});
  HE.finishRound(T, { d: [50, 50, 60, 99], shooter: -1 }); HE.finishRound(T, { d: [10, 10, 0, 1], shooter: -1 });
  ok(!T.over && T.tiebreak, 'tie for lowest after ≥100 → another round');
  HE.finishRound(T, { d: [0, 3, 1, 0], shooter: -1 }); ok(T.over && T.winner === 0, 'tiebreak round decides the winner');
  ok(HE.roundSeed(HE.newMatch(5, {})) === HE.roundSeed(HE.newMatch(5, {})), 'round deals are seeded by match seed');
}
// --- AI view hides hands; sampler honours voids and passed cards ---
{
  const S = HE.newRound(11, 0, {}); const passes = [0, 1, 2, 3].map(p => HE.choosePass(S, p, 1, HE.rng(p))); HE.applyPass(S, passes);
  const V = HE.viewFor(S, 1);
  ok([0, 2, 3].every(q => [0, 1, 2, 3].every(s => V.hm[q * 4 + s] === 0)) && V.n.every(x => x === 13), 'viewFor hides other hands but keeps counts');
  ok(V.known && V.known.to === 2 && same(V.known.cards, passes[1]), 'AI remembers the 3 cards it passed and to whom');
  V.voids[3] = 1 << 0; // pretend seat 3 is void in clubs
  let good = true, kn = true; const rnd = HE.rng(3);
  for (let i = 0; i < 300; i++) { const W = HE.sampleWorld(V, 1, rnd); if (!W) { good = false; break; }
    if (W.hm[3 * 4 + 0]) good = false; for (let q = 0; q < 4; q++) if (HE.hand(W, q).length !== 13) good = false;
    for (const c of passes[1]) if (!HE.has(W, 2, c)) kn = false;
    const seen = new Set(); for (let q = 0; q < 4; q++) for (const c of HE.hand(W, q)) seen.add(c); if (seen.size !== 52) good = false; }
  ok(good, 'sampled worlds respect counts and void constraints'); ok(kn, 'sampled worlds keep passed cards with their receiver');
}
// --- 3000 AI rounds: legality, card conservation, 26/78 totals ---
{
  let rounds = 0, bad = 0, moons = 0, illegal = 0, perLevel = [[0, 0], [0, 0], [0, 0]];
  const combos = [[0, 0, 0, 0], [1, 1, 1, 1], [0, 1, 0, 1], [1, 0, 1, 0], [0, 0, 1, 1]];
  const opts = [{}, { qsb: true }, { jd: true }, { moonMinus: true }];
  for (let i = 0; i < 3000; i++) {
    const lv = i < 2950 ? combos[i % combos.length] : [2, 1, 0, 1], o = opts[(i >> 2) % 4];
    const S = HE.newRound(HE.hash('t', i), i % 4, o);
    if (S.phase === 'pass') HE.applyPass(S, [0, 1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, lv[p], i * 4 + p).move));
    let n = 0;
    while (S.phase === 'play') {
      const p = S.turn, r = HE.think(HE.viewFor(S, p), p, lv[p], i * 977 + n, { ms: 20, minS: 10, maxS: 30 });
      if (!HE.isLegal(S, r.move)) { illegal++; break; }
      HE.play(S, r.move); n++;
    }
    const res = HE.roundScore(S), raw = S.pts.reduce((a, b) => a + b);
    const tot = res.d.reduce((a, b) => a + b) + (o.jd && S.jdBy >= 0 ? 10 : 0);
    const want = res.shooter < 0 ? 26 : o.moonMinus ? -26 : 78;
    if (n !== 52 || raw !== 26 || tot !== want || S.hist.length !== 13) bad++;
    if (res.shooter >= 0) moons++;
    rounds++;
  }
  ok(illegal === 0, '3000 rounds: AI never played an illegal card');
  ok(bad === 0, '3000 rounds: 52 plays, 13 tricks, 26 raw points, total 26 or 78 (−26 / J♦ adjusted)');
  console.log('self-play: ' + rounds + ' rounds, ' + moons + ' moons, illegal ' + illegal + ', bad totals ' + bad);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
