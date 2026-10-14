// Rule unit tests for 吹牛骰 (liars-dice), run against the game's own core code (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const LD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn LD;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
const near = (a, b, e) => Math.abs(a - b) < (e || 1e-9);
function game(n, o = {}) { const g = LD.newGame(Object.assign({ n, mode: 'lives', special: true, start: 'players', seed: 1, first: 0 }, o)); LD.startRound(g); return g; }
function setHands(g, hs) { hs.forEach((h, i) => { g.P[i].hand = h.slice(); g.P[i].dice = h.length; }); }

// ---- 1. face order and raising ----
eq([2, 3, 4, 5, 6, 1].map(LD.rank), [2, 3, 4, 5, 6, 7], 'rank order 2<3<4<5<6<1');
const H = (a, b) => LD.higher({ q: a[0], f: a[1] }, { q: b[0], f: b[1] });
[[[5, 3], [4, 6], true], [[4, 6], [4, 5], true], [[4, 5], [4, 6], false], [[4, 1], [4, 6], true], [[4, 6], [4, 1], false],
 [[5, 2], [4, 1], true], [[4, 4], [4, 4], false], [[3, 1], [4, 2], false], [[6, 2], [5, 1], true], [[5, 1], [5, 1], false]]
  .forEach(([a, b, r]) => ok(H(a, b) === r, `higher ${a} over ${b} = ${r}`));

// ---- 2. opening minimum, legality, upper limit ----
let g = game(4);
ok(!LD.legal(g, { q: 3, f: 6 }), '4 players: opening 3 illegal');
ok(LD.legal(g, { q: 4, f: 2 }), '4 players: opening 4 legal');
ok(LD.legal(g, { q: 4, f: 1 }), '4 players: opening 4 ones legal');
ok(!LD.legal(g, { q: 21, f: 2 }), 'cannot exceed total dice (20)');
ok(!LD.legal(g, { q: 4, f: 7 }) && !LD.legal(g, { q: 0, f: 3 }) && !LD.legal(g, { q: 4.5, f: 3 }), 'malformed bids rejected');
ok(!LD.canCall(g), 'opener cannot call');
ok(LD.doCall(g) === null, 'doCall on empty round refused');
g = game(2); ok(LD.minStart(g) === 2 && LD.legal(g, { q: 2, f: 3 }) && !LD.legal(g, { q: 1, f: 3 }), 'heads-up opening minimum 2');
g = game(4, { start: 'free' }); ok(LD.legal(g, { q: 1, f: 3 }), 'free opening rule allows 1');
g = game(4); LD.doBid(g, { q: 5, f: 4 });
ok(!LD.legal(g, { q: 5, f: 3 }) && LD.legal(g, { q: 5, f: 5 }) && LD.legal(g, { q: 5, f: 1 }) && LD.legal(g, { q: 6, f: 2 }), 'raise rules after 5x4');
ok(!LD.doBid(g, { q: 5, f: 4 }) && g.bids.length === 1, 'illegal bid not applied');
eq([1, 2, 3, 4, 5, 6].map(f => LD.minQ(LD.last(g), f, 20, 4)), [5, 6, 6, 6, 5, 5], 'minQ per face after 5x4');
g = game(4); LD.doBid(g, { q: 20, f: 6 }); ok(LD.canRaise(g), '20x6 can still be raised to 20x1');
LD.doBid(g, { q: 20, f: 1 }); ok(!LD.canRaise(g) && LD.canCall(g), 'at the ceiling only a call remains');

// ---- 3. counting: wild 1s, zhai, straight, leopard ----
const C = (h, f, w, s) => LD.handCount(h, f, w, s);
eq(C([1, 3, 3, 5, 6], 3, true, true), 3, 'wild 1 counts for 3');
eq(C([1, 3, 3, 5, 6], 3, false, true), 2, 'zhai: 1 not wild');
eq(C([1, 1, 3, 5, 6], 1, true, true), 2, 'counting 1s counts only 1s');
eq(C([1, 2, 3, 4, 5], 3, true, true), 0, 'straight 1-5 counts 0');
eq(C([2, 3, 4, 5, 6], 6, true, true), 0, 'straight 2-6 counts 0');
eq(C([5, 3, 2, 6, 4], 2, false, true), 0, 'unsorted straight counts 0');
eq(C([1, 2, 3, 4, 5], 3, true, false), 2, 'straight rule off: counted normally');
eq(C([4, 4, 4, 4, 4], 4, true, true), 6, 'leopard 4s = 5+1');
eq(C([4, 1, 4, 1, 4], 4, true, true), 6, 'leopard with wild 1s = 6');
eq(C([4, 1, 4, 1, 4], 4, false, true), 3, 'zhai breaks wild leopard');
eq(C([1, 1, 1, 1, 1], 5, true, true), 6, 'all 1s with wild: leopard for any face');
eq(C([1, 1, 1, 1, 1], 1, true, true), 6, 'all 1s: leopard of 1s');
eq(C([4, 4, 4, 4, 4], 4, true, false), 5, 'leopard rule off: 5');
eq(C([4, 4, 4, 4], 4, true, true), 4, '4-dice hand is never a leopard');
eq(C([2, 3, 4, 5], 3, true, true), 1, '4-dice hand is never a straight');
eq(LD.tag([1, 2, 3, 4, 5], true), 'straight', 'tag straight'); eq(LD.tag([6, 1, 6, 6, 1], true), 'leopard', 'tag leopard'); eq(LD.tag([6, 1, 6, 5, 1], true), '', 'tag none');
// exhaustive: face-count fast path == reference counter for all 7776 hands
{
  let bad = 0; const cnt = new Uint8Array(7), h = [0, 0, 0, 0, 0];
  for (let i = 0; i < 7776; i++) {
    let x = i; cnt.fill(0); for (let j = 0; j < 5; j++) { h[j] = x % 6 + 1; x = (x / 6) | 0; cnt[h[j]]++; }
    for (let f = 1; f <= 6; f++) for (const w of [true, false]) for (const s of [true, false]) if (LD.cntCount(cnt, 0, 5, f, w, s) !== LD.handCount(h, f, w, s)) bad++;
  }
  ok(bad === 0, 'cntCount == handCount over all 7776 hands x 6 faces x wild x special (' + bad + ' mismatches)');
}

// ---- 4. zhai switching inside a round ----
g = game(3); setHands(g, [[1, 1, 4, 4, 2], [1, 4, 6, 6, 3], [5, 5, 5, 2, 3]]);
ok(LD.wildNow(g), 'wild at round start');
LD.doBid(g, { q: 3, f: 4 }); ok(g.bids[0].wild === true, 'bid recorded as wild');
LD.doBid(g, { q: 3, f: 1 }); ok(!LD.wildNow(g) && g.zhai, 'bidding 1s turns on zhai');
LD.doBid(g, { q: 4, f: 4 }); ok(g.bids[2].wild === false, 'later bid recorded as non-wild');
let r = LD.doCall(g); // 4s without wild: 2 + 1 + 0 = 3 < 4
ok(r.count === 3 && !r.truth && r.loser === 2 && r.caller === 0 && r.bidder === 2, 'call under zhai counts 4s without wilds');
g = game(3); setHands(g, [[1, 1, 4, 4, 2], [1, 4, 6, 6, 3], [5, 5, 5, 2, 3]]); LD.doBid(g, { q: 4, f: 4 });
r = LD.doCall(g); ok(r.count === 6 && r.truth && r.loser === 1, 'same dice with wilds: 6 fours, caller loses');
g = game(2); LD.startRound(g); ok(LD.wildNow(g), 'zhai resets next round');

// ---- 5. call resolution, lives, elimination, next starter ----
g = game(3); setHands(g, [[2, 2, 3, 3, 6], [2, 5, 5, 6, 6], [3, 4, 4, 5, 6]]);
LD.doBid(g, { q: 3, f: 2 }); LD.doBid(g, { q: 3, f: 6 });
r = LD.doCall(g); ok(r.caller === 2 && r.bidder === 1 && r.count === 4 && r.truth && r.loser === 2, 'exact or more = bidder truthful, caller loses');
LD.settle(g); ok(g.P[2].lives === 2 && g.starter === 2 && g.phase === 'settled', 'loser loses a life and opens next round');
g = game(3); setHands(g, [[2, 2, 3, 3, 6], [2, 5, 5, 6, 6], [3, 4, 4, 5, 6]]);
LD.doBid(g, { q: 6, f: 6 }); r = LD.doCall(g); ok(!r.truth && r.loser === 0, 'fewer than bid = bidder loses');
g = game(3); g.P[1].lives = 1; LD.startRound(g); g.turn = 0; setHands(g, [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]]);
LD.doBid(g, { q: 9, f: 5 }); r = LD.doCall(g); LD.settle(g);
ok(r.loser === 0 && g.P[0].lives === 2, 'caller 1 judged');
g = game(3); g.P[1].lives = 1; LD.startRound(g); g.turn = 0; setHands(g, [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]]);
LD.doBid(g, { q: 3, f: 2 }); LD.doBid(g, { q: 9, f: 3 }); r = LD.doCall(g); LD.settle(g);
ok(r.loser === 1 && g.P[1].out && g.starter === 2, 'eliminated loser: next alive player opens');
LD.startRound(g); ok(g.turn === 2 && LD.minStart(g) === 2 && LD.totalDice(g) === 10, 'eliminated player skipped, 2 alive -> min 2');
LD.doBid(g, { q: 2, f: 4 }); ok(g.turn === 0, 'turn skips eliminated seat');
g = game(2); g.P[1].lives = 1; g.turn = 1; setHands(g, [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3]]); LD.doBid(g, { q: 9, f: 3 }); LD.doCall(g); LD.settle(g);
ok(g.phase === 'over' && g.winner === 0 && g.P[1].out, 'last survivor wins');

// ---- 6. dice-reduction (Perudo) variant and palifico ----
g = game(3, { mode: 'dice' }); g.P[1].dice = 2; LD.startRound(g); g.turn = 0;
setHands(g, [[2, 2, 2, 2, 2], [3, 3], [4, 4, 4, 4, 4]]);
ok(LD.totalDice(g) === 12, 'dice mode total');
LD.doBid(g, { q: 3, f: 2 }); LD.doBid(g, { q: 9, f: 3 }); LD.doCall(g); LD.settle(g);
ok(g.P[1].dice === 1 && g.palNext && !g.P[1].out, 'loser drops a die; reaching 1 die triggers palifico');
LD.startRound(g); ok(g.pal && !LD.wildNow(g) && g.P[1].hand.length === 1, 'palifico round: 1s not wild');
g.P.forEach(p => p.hand = p.hand.map(() => 1)); g.P[1].hand = [3];
LD.doBid(g, { q: 3, f: 3 }); r = LD.doCall(g); ok(r.count === 1 && !r.wild, 'palifico count ignores wild 1s');
LD.settle(g); ok(r.bidder === 1 && r.loser === 1 && g.P[1].out && g.P[1].dice === 0, 'palifico bidder loses last die and is eliminated');
g.P[1].palDone = true; LD.startRound(g); ok(!g.pal, 'palifico only once / not repeated');
g = game(2, { mode: 'dice' }); g.P[1].dice = 1; g.P[1].palDone = true; LD.startRound(g); g.turn = 0; setHands(g, [[2, 2, 2, 2, 2], [3]]);
LD.doBid(g, { q: 6, f: 3 }); LD.doCall(g); LD.settle(g); ok(g.P[0].dice === 4 && !g.P[1].out && g.phase === 'settled', 'false bid in dice mode: bidder drops one die');
g = game(2, { mode: 'dice' }); g.P[0].dice = 1; g.P[0].palDone = true; LD.startRound(g); g.turn = 1; setHands(g, [[3], [2, 2, 2, 2, 2]]);
LD.doBid(g, { q: 6, f: 2 }); LD.doCall(g); LD.settle(g); ok(g.P[0].out && g.winner === 1, 'losing the last die eliminates');

// ---- 7. probability tools vs reference formulas ----
ok(near(LD.binomTail(10, 1 / 3, 4), 0.4407357, 1e-6), 'binomTail(10,1/3,>=4)=0.4408');
let maxd = 0;
for (const u of [1, 5, 10, 15]) for (let k = 0; k <= u + 1; k++) for (const [f, w] of [[3, true], [3, false], [1, true]]) {
  const ns = []; for (let x = u; x > 0; x -= 5) ns.push(Math.min(5, x));
  maxd = Math.max(maxd, Math.abs(LD.tailP(ns, k, f, w, false) - LD.binomTail(u, f !== 1 && w ? 1 / 3 : 1 / 6, k)));
}
ok(maxd < 1e-9, 'exact distribution == Binomial when special shapes are off (max diff ' + maxd.toExponential(1) + ')');
for (const n of [1, 3, 5]) { const d = LD.handDist(n, 4, true, true); ok(near(d.reduce((a, b) => a + b, 0), 1, 1e-9), 'handDist sums to 1 (n=' + n + ')'); }
{ // recomputed reference numbers
  let st = 0, le = 0, pure = 0; const h = [0, 0, 0, 0, 0];
  for (let i = 0; i < 7776; i++) { let x = i; for (let j = 0; j < 5; j++) { h[j] = x % 6 + 1; x = (x / 6) | 0; } const t = LD.tag(h, true); if (t === 'straight') st++; if (t === 'leopard') le++; if (h.every(d => d === h[0])) pure++; }
  ok(st === 240 && le === 156 && pure === 6, `straight ${st}/7776, leopard(with wild) ${le}/7776, pure ${pure}/7776`);
  const e1 = LD.handDist(5, 3, true, true).reduce((a, p, i) => a + p * i, 0), e0 = LD.handDist(5, 3, true, false).reduce((a, p, i) => a + p * i, 0);
  console.log(`  ref: straight ${(st / 77.76).toFixed(2)}%  leopard ${(le / 77.76).toFixed(2)}%  E[count of 3s per 5-dice hand] wild ${e0.toFixed(4)} -> with special shapes ${e1.toFixed(4)}`);
  const pb = LD.binomTail(15, 1 / 3, 5), pe = LD.tailP([5, 5, 5], 5, 3, true, true);
  console.log(`  example P(>=5 of 3s among 15 hidden dice): Binomial ${(pb * 100).toFixed(2)}%  exact with shapes ${(pe * 100).toFixed(2)}%`);
}
// Monte Carlo cross-check of the exact distribution with shapes
{ const R = LD.rng(99); let hit = 0; const N = 200000; for (let i = 0; i < N; i++) { let t = 0; for (let j = 0; j < 3; j++) t += LD.handCount(LD.rollHand(5, R), 3, true, true); if (t >= 5) hit++; }
  ok(Math.abs(hit / N - LD.tailP([5, 5, 5], 5, 3, true, true)) < 0.005, 'exact tailP matches Monte Carlo (' + (hit / N).toFixed(4) + ')'); }

// ---- 8. seeding ----
eq(LD.rollHand(5, LD.rng(123)), LD.rollHand(5, LD.rng(123)), 'same seed same dice');
{ const a = game(4, { seed: 77 }), b = game(4, { seed: 77 }); eq(a.P.map(p => p.hand), b.P.map(p => p.hand), 'same seed same round'); }

// ---- 9. AI: legal actions, hidden information, think time ----
{
  let illegal = 0, opensCall = 0, n = 0, leaks = 0, t = [];
  for (let s = 0; s < 600; s++) {
    const gg = game(2 + s % 3, { seed: 1000 + s, mode: s % 5 === 0 ? 'dice' : 'lives', special: s % 2 === 0 });
    for (let k = 0; k < 12 && gg.phase === 'bid'; k++) {
      const lvl = (s + k) % 3, v = LD.viewFor(gg, gg.turn, { lvl, seed: s * 31 + k });
      if (JSON.stringify(v).includes('"hand":') && Object.keys(v).filter(x => x === 'hand').length !== 1) leaks++;
      if (v.others.some(o => o.hand)) leaks++;
      const t0 = process.hrtime.bigint(), a = LD.think(v); t.push(Number(process.hrtime.bigint() - t0) / 1e6); n++;
      if (a.act === 'call') { if (!gg.bids.length) opensCall++; LD.doCall(gg); break; }
      if (!LD.doBid(gg, { q: a.q, f: a.f })) illegal++;
    }
  }
  ok(illegal === 0, 'AI never makes an illegal bid (' + n + ' decisions)');
  ok(opensCall === 0, 'AI never calls with no bid');
  ok(leaks === 0, 'AI view carries no other hands');
  t.sort((a, b) => a - b);
  console.log(`  AI think time (Node, all levels): median ${t[t.length >> 1].toFixed(2)} ms, p99 ${t[Math.floor(t.length * 0.99)].toFixed(2)} ms, max ${t[t.length - 1].toFixed(1)} ms (first call builds tables)`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
