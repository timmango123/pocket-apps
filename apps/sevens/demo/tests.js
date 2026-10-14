// Rule tests for 排七 (sevens). Extracts the engine between the CORE markers of ../index.html,
// checks every rule in the spec, then runs 5000 AI-vs-AI rounds checking legality, the forced-play rule
// and card / point conservation after every move.
// Usage: node tests.js [--rounds N]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SV = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SV;')();
const { card, suit, rank, COV } = SV;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
const C = s => { const m = s.match(/^(10|[2-9AJQK])([SHDC])$/); return card('SHDC'.indexOf(m[2]), SV.RANKS.indexOf(m[1])); };
const cs = str => str.split(' ').filter(Boolean).map(C);
const names = a => a.map(m => (m >= COV ? 'cover ' : '') + SV.name(m % COV)).sort().join(' ');
// state from explicit hands; rows = {S:[lo,hi]} sets a row from lo..hi (ranks as in RANKS)
function st(hands, rows, o) {
  o = o || {};
  const S = SV.newRound(1, o.opts || {});
  S.hm.fill(0); S.n = [0, 0, 0, 0];
  hands.forEach((h, p) => cs(h).forEach(c => { S.hm[p * 4 + suit(c)] |= 1 << rank(c); S.n[p]++; }));
  for (const k in rows || {}) {
    const s = 'SHDC'.indexOf(k), [a, b] = rows[k].map(x => SV.RANKS.indexOf(x));
    for (let r = a; r <= b; r++) S.played[s] |= 1 << r;
    S.lo[s] = a; S.up[s] = b - 6;
  }
  S.moves = o.moves == null ? 10 : o.moves; S.turn = o.turn || 0;
  return S;
}

// --- deck & deal ---
{
  const hm = SV.deal(42), all = new Set(), each = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (hm[p * 4 + s] & (1 << r)) { all.add(card(s, r)); each[p]++; }
  ok(all.size === 52 && each.every(x => x === 13), '52 distinct cards, 13 per player');
  ok(JSON.stringify(SV.deal(42)) === JSON.stringify(hm) && JSON.stringify(SV.deal(43)) !== JSON.stringify(hm), 'seeded shuffle is reproducible');
  let pts = 0; for (let c = 0; c < 52; c++) pts += SV.val(c);
  ok(pts === 364, 'deck penalty points total 4 × 91 = 364');
  ok(SV.val(C('AS')) === 1 && SV.val(C('10H')) === 10 && SV.val(C('JD')) === 11 && SV.val(C('QC')) === 12 && SV.val(C('KS')) === 13, 'A=1, 2–10 face, J=11, Q=12, K=13');
  // ♠7 holder frequency per seat ≈ 25% each (recomputed, not from memory)
  const seat = [0, 0, 0, 0]; for (let i = 0; i < 20000; i++) seat[SV.newRound(i).start]++;
  ok(seat.every(x => Math.abs(x / 20000 - .25) < .015), '♠7 holder is uniform over seats: ' + seat.join('/'));
}
// --- opening ---
{
  for (let seed = 0; seed < 200; seed++) {
    const S = SV.newRound(seed);
    if (!(S.turn === S.start && SV.has(S, S.turn, SV.S7))) { ok(false, 'holder of ♠7 starts, seed ' + seed); break; }
    if (names(SV.moves(S)) !== '♠7') { ok(false, 'first move must be ♠7 only, seed ' + seed); break; }
  }
  ok(true, 'holder of ♠7 starts and ♠7 is the only legal first move (200 deals)');
  const S = st(['7S 7H 7D 7C 2S', 'AS', 'KD', 'QH'], {}, { moves: 0 });
  ok(names(SV.moves(S, 0)) === '♠7', 'holding all four 7s, only ♠7 opens the round');
  ok(!SV.isLegal(S, C('7H')) && !SV.isLegal(S, C('2S') + COV), 'other 7s and covering are illegal on the first move');
  SV.apply(S, C('7S'));
  ok(S.lo[0] === 6 && S.up[0] === 0 && S.turn === 1 && S.moves === 1, 'after ♠7 the row opens and the turn passes on');
  const F = st(['7S 2C', 'AS', 'KD', 'QH'], {}, { moves: 0, opts: { free: true } });
  ok(names(SV.moves(F, 0)) === '♠7', 'free-cover variant still forces ♠7 as the first move');
}
// --- 7 opens a row, only ends extend ---
{
  const S = st(['6H 8H 7D 6S 8S 5S 9S', 'AS', 'KD', 'QH'], { S: ['7', '7'] });
  ok(names(SV.legal(S, 0)) === '♠6 ♠8 ♦7', 'closed suit: 6/8 not playable before its 7; any 7 opens; open row takes 6 and 8');
  ok(!SV.isLegal(S, C('5S')) && !SV.isLegal(S, C('9S')), 'cards not next to an end are illegal');
  SV.apply(S, C('6S'));
  ok(S.lo[0] === 5 && SV.endMask(S, 0) === ((1 << 4) | (1 << 7)), 'after ♠6 the ends are ♠5 and ♠8');
  const T = st(['AS KS', 'x'.slice(1), '', ''], { S: ['2', 'Q'] });
  ok(names(SV.legal(T, 0)) === '♠A ♠K', 'both ends: A below 2 and K above Q');
  SV.apply(T, C('KS'));
  ok(SV.endMask(T, 0) === 1, 'without the wrap option nothing goes above K');
}
// --- A after K option ---
{
  const S = st(['AS 2S', '', '', ''], { S: ['3', 'K'] }, { opts: { wrap: true } });
  ok(names(SV.legal(S, 0)) === '♠2 ♠A', 'wrap on: both the lower end (♠2) and A-after-K are playable');
  const T = st(['AS', '', '', ''], { S: ['5', 'K'] }, { opts: { wrap: true } });
  ok(names(SV.legal(T, 0)) === '♠A', 'wrap on: A can be attached after K');
  const U = st(['AS', '', '', ''], { S: ['5', 'K'] }, { opts: { wrap: false } });
  ok(SV.legal(U, 0).length === 0, 'wrap off (default): A cannot follow K');
  SV.apply(T, C('AS'));
  ok(SV.endMask(T, 0) === ((1 << 1) | (1 << 3)), 'after wrapping A the upper end continues with 2 (lower end still 4)');
}
// --- forced play & cover ---
{
  const S = st(['8S KD 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(S, 0)) === '♠8', 'with a playable card the only options are plays (no cover)');
  ok(!SV.isLegal(S, C('2C') + COV) && throws(() => SV.apply(S, C('2C') + COV)), 'covering while holding a playable card is rejected by the rule layer');
  const T = st(['9S KD 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(T, 0)) === 'cover ♠9 cover ♣2 cover ♦K', 'nothing playable: any hand card may be covered');
  SV.apply(T, C('KD') + COV);
  ok(T.pen[0] === 13 && T.cn[0] === 1 && T.cov[0][0] === C('KD') && T.n[0] === 2, 'cover adds face value to the penalty and keeps the card face down');
  ok(T.nh[0] === ((1 << 5) | (1 << 7)) && T.nh[1] === 64 && T.nh[2] === 64 && T.nh[3] === 64, 'covering reveals the player holds none of the current end cards (♠6, ♠8 and the unopened ♥7 ♦7 ♣7)');
  const F = st(['8S 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] }, { opts: { free: true } });
  ok(names(SV.moves(F, 0)) === 'cover ♠8 cover ♣2 ♠8', 'free-cover variant: may cover even with a playable card');
  SV.apply(F, C('2C') + COV);
  ok(F.nh[0] === 0, 'free-cover variant: a cover reveals nothing');
  const Last = st(['8S', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(Last, 0)) === '♠8', 'the last card in hand also obeys forced play');
  const LastC = st(['9S', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(LastC, 0)) === 'cover ♠9', 'a stuck last card must be covered');
}
// --- full round, scoring, match ---
{
  const S = SV.newRound(99), rnd = SV.rng(5);
  while (!S.done) SV.apply(S, SV.easyPlay(S, S.turn, rnd));
  ok(S.moves === 52 && S.n.every(x => x === 0) && S.hm.every(x => x === 0), 'round ends after 52 actions with every hand empty');
  ok(S.pen.every((x, p) => x === S.cov[p].reduce((a, c) => a + SV.val(c), 0)), 'penalty = sum of covered card values');
  let board = 0; for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (S.played[s] & (1 << r)) board += r + 1;
  ok(board + S.pen.reduce((a, b) => a + b) === 364, 'board points + penalties = 364');
  const M = SV.newMatch(7, {}, 5);
  ok(M.len === 5, 'default match is 5 rounds');
  const want = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const R = SV.startRound(M), rr = SV.rng(i);
    while (!R.done) SV.apply(R, SV.easyPlay(R, R.turn, rr));
    R.pen.forEach((x, p) => want[p] += x);
    ok(!M.over, 'match not over before the last round'); SV.finishRound(M, R);
  }
  ok(M.over && JSON.stringify(M.totals) === JSON.stringify(want), 'totals accumulate over 5 rounds');
  const mn = Math.min(...want);
  ok(JSON.stringify(M.winners) === JSON.stringify([0, 1, 2, 3].filter(p => want[p] === mn)), 'lowest total wins');
  const T = SV.newMatch(1, {}, 1), R = SV.startRound(T); R.done = true; R.pen = [5, 5, 9, 12];
  SV.finishRound(T, R);
  ok(JSON.stringify(T.winners) === '[0,1]', 'tied lowest totals share the win');
  ok(throws(() => SV.finishRound(SV.newMatch(1), SV.newRound(1))), 'an unfinished round cannot be scored');
}
// --- hidden information ---
{
  const S = SV.newRound(3), rnd = SV.rng(3);
  for (let i = 0; i < 20; i++) SV.apply(S, SV.easyPlay(S, S.turn, rnd));
  const V = SV.viewFor(S, 2);
  ok([0, 1, 3].every(q => [0, 1, 2, 3].every(s => V.hm[q * 4 + s] === 0) && V.cov[q].length === 0) && JSON.stringify(V.cov[2]) === JSON.stringify(S.cov[2]), 'viewFor hides the other hands and their face-down cards');
  let good = true;
  for (let k = 0; k < 200; k++) {
    const W = SV.sampleWorld(V, 2, SV.rng(k));
    for (let q = 0; q < 4; q++) { let n = 0; for (let s = 0; s < 4; s++) n += SV.pc(W.hm[q * 4 + s]); if (n !== S.n[q]) good = false; }
    for (let s = 0; s < 4; s++) { if (W.hm[2 * 4 + s] !== S.hm[2 * 4 + s]) good = false; let u = 0; for (let q = 0; q < 4; q++) { if (u & W.hm[q * 4 + s]) good = false; u |= W.hm[q * 4 + s]; } if (u & S.played[s]) good = false; }
    for (let q = 0; q < 4; q++) for (let s = 0; s < 4; s++) if (W.hm[q * 4 + s] & S.nh[q * 4 + s]) good = false;
  }
  ok(good, 'sampled deals keep hand sizes, my hand, unplayed cards only, and the known "has none" sets');
}
// --- 5000 AI-vs-AI rounds ---
{
  const args = process.argv.slice(2), N = +(args[args.indexOf('--rounds') + 1] || 5000) || 5000;
  const t0 = Date.now(); let moves = 0, covers = 0, forcedViol = 0, illegal = 0, conserve = 0, nhBad = 0, ex = [], optsSeen = { wrap: 0, free: 0 };
  const CFG = { ms: 15, minS: 6, maxS: 12 };
  for (let i = 0; i < N; i++) {
    const opts = { wrap: i % 7 === 3, free: i % 11 === 5 }; if (opts.wrap) optsSeen.wrap++; if (opts.free) optsSeen.free++;
    const S = SV.newRound(SV.hash('t', i), opts), lv = [0, 1, 2, 3].map(p => (i + p) % 3);
    while (!S.done) {
      const p = S.turn, r = SV.think(SV.viewFor(S, p), p, lv[p], SV.hash(i, S.moves), CFG), m = r.move;
      if (lv[p] === 2) ex.push(r.ms);
      if (!SV.isLegal(S, m)) { illegal++; break; }
      if (m >= COV && SV.canPlay(S, p) && !opts.free) forcedViol++;
      if (m >= COV) covers++;
      SV.step(S, m); moves++;
      let n = 0; for (let x = 0; x < 16; x++) n += SV.pc(S.hm[x]);
      let b = 0; for (let s = 0; s < 4; s++) b += SV.pc(S.played[s]);
      if (n + b + S.cn.reduce((a, c) => a + c) !== 52 || n !== S.n.reduce((a, c) => a + c)) conserve++;
      for (let q = 0; q < 4; q++) for (let s = 0; s < 4; s++) if (S.hm[q * 4 + s] & S.nh[q * 4 + s]) nhBad++;
    }
    if (!S.done || S.moves !== 52) conserve++;
  }
  ok(!illegal, 'AI never chose an illegal move (' + illegal + ')');
  ok(!forcedViol, 'nobody covered while holding a playable card (' + forcedViol + ')');
  ok(!conserve, 'hand + board + covered = 52 after every move (' + conserve + ' violations)');
  ok(!nhBad, '"has none of" inference is never contradicted by a real hand (' + nhBad + ')');
  console.log(`self-play: ${N} rounds (${optsSeen.wrap} with A-after-K, ${optsSeen.free} free-cover), ${moves} moves, ${covers} covers, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// --- AI strength probes ---
{
  const S = st(['7H 8S KS', 'QS', '6H 5H 4H', 'JD'], { S: ['7', '7'] });
  ok(SV.rulePlay(S, 0, SV.PERS[1]) === C('8S'), '一般: prefers the play that leads toward its own high cards (♠8 → ♠K) over opening ♥7 for others');
  const T = st(['9S KD 2C 5H', 'QS', 'QD', 'QC'], { S: ['7', '7'] });
  ok(SV.rulePlay(T, 0, SV.PERS[1]) === C('2C') + COV, '一般: covers its smallest card');
  // expert think time with the page's settings
  const times = [], CFG = { ms: 80, minS: 40, maxS: 100 }, smp = [];
  for (let i = 0; i < 60; i++) {
    const R = SV.newRound(SV.hash('time', i)), rnd = SV.rng(i);
    for (let k = 0; k < 4 + (i % 30); k++) SV.apply(R, SV.easyPlay(R, R.turn, rnd));
    const p = R.turn, r = SV.think(SV.viewFor(R, p), p, 2, i, CFG); times.push(r.ms); if (r.samples) smp.push(r.samples);
  }
  times.sort((a, b) => a - b); smp.sort((a, b) => a - b);
  console.log(`高手 think (page settings, 100 samples cap, 80 ms budget): median ${times[30]}ms, max ${times[59]}ms; samples median ${smp[smp.length >> 1]}, min ${smp[0]}`);
  ok(times[59] < 120, '高手 stays within its time budget');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
