// Rule tests for 大富翁 (monopoly), run against the game's own core (CORE-START/CORE-END in ../index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const MP = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MP;')();
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log('FAIL', n); } };
const SQ = MP.SQ, idx = n => SQ.findIndex(s => s.n === n);
const fresh = o => MP.newGame(Object.assign({ seed: 1, rounds: 20, diff: 1 }, o));
// force the next dice: find a dice-stream state that rolls (a,b)
function rig(st, a, b) {
  for (let s = 1; s < 2e6; s++) { const t = { ds: s }; const x = 1 + Math.floor(MP.rnd(t, 'ds') * 6), y = 1 + Math.floor(MP.rnd(t, 'ds') * 6); if (x === a && y === b) { st.ds = s; return; } }
  throw new Error('no seed');
}
const rollTo = (st, a, b) => { rig(st, a, b); return MP.act(st, { a: 'roll' }); };

// --- board ---
ok(SQ.length === 32, '32 squares');
ok(SQ.filter(s => s.t === 'prop').length === 20, '20 lots');
ok(MP.GROUP_SQ.every(g => g.length >= 2 && g.length <= 3), 'colour groups of 2-3');
ok(SQ[0].t === 'go' && SQ[8].t === 'jail' && SQ[16].t === 'park' && SQ[24].t === 'gojail', 'corners');
ok(SQ.filter(s => s.t === 'chance').length === 2 && SQ.filter(s => s.t === 'fate').length === 2, '2 chance + 2 fate');
ok(SQ.filter(s => s.t === 'prop').every(s => s.rent.length === 6 && s.rent.every((r, k) => !k || r > s.rent[k - 1])), 'rents rise with each building');
ok(new Set(SQ.map(s => s.n).filter(n => !['機會', '命運'].includes(n))).size === 28, 'unique Taiwan place names');
// --- start ---
{ const st = fresh(); ok(st.P.every((p, i) => p.cash === (i ? 15000 : 15000)), 'normal: everyone starts with 15,000'); ok(st.phase === 'roll' && st.actor === 0, 'human starts');
  const h = fresh({ diff: 2 }); ok(h.P[0].cash === 15000 && h.P[1].cash === 17000, 'hard: computers start with +2,000');
  ok(MP.legal(st).map(a => a.a).join() === 'roll,roll1', 'only roll (two dice or one) at start'); ok(MP.act(st, { a: 'buy' }) === null, 'illegal action rejected'); }
// --- moving, buying, GO ---
{ const st = fresh(); const ev = rollTo(st, 1, 2); ok(st.P[0].pos === 3 && st.phase === 'buy' && st.pend.sq === 3, 'move 3 → 蘭嶼, offered to buy');
  ok(ev.some(e => e.t === 'move' && e.path.join() === '1,2,3'), 'move path recorded');
  MP.act(st, { a: 'buy' }); ok(st.own[3] === 0 && st.P[0].cash === 14400, 'bought for 600'); ok(st.turn === 1 && st.phase === 'roll', 'turn passes');
  st.turn = 0; st.actor = 0; st.P[0].pos = 30; const e2 = rollTo(st, 1, 2); ok(st.P[0].pos === 1, 'wraps around'); ok(e2.some(e => e.t === 'cash' && e.why === 'go' && e.v === 2000), 'passing GO pays 2,000'); }
{ const st = fresh(); st.P[0].pos = 28; rollTo(st, 1, 3); ok(st.P[0].pos === 0, 'land on GO'); ok(st.P[0].cash === 17000, 'landing on GO pays once'); }
// --- rent ---
{ const st = fresh(); st.own[1] = 1; st.P[0].pos = 30; rollTo(st, 1, 2); ok(st.P[0].cash === 15000 + 2000 - 40 && st.P[1].cash === 15040, 'base rent 40 on 綠島');
  const s2 = fresh(); s2.own[1] = 1; s2.own[3] = 1; s2.P[0].pos = 30; rollTo(s2, 1, 2); ok(s2.P[1].cash === 15080, 'full set doubles bare rent');
  const s3 = fresh(); s3.own[1] = 1; s3.lvl[1] = 3; s3.P[0].pos = 30; rollTo(s3, 1, 2); ok(s3.P[1].cash === 15000 + 1800, '3 houses rent 1,800');
  const s4 = fresh(); s4.own[1] = 1; s4.mort[1] = 1; s4.P[0].pos = 30; rollTo(s4, 1, 2); ok(s4.P[1].cash === 15000 && s4.P[0].cash === 17000, 'no rent on mortgaged lot');
  const s5 = fresh(); s5.own[20] = 2; s5.P[0].pos = 17; rollTo(s5, 1, 2); ok(s5.P[2].cash === 15400, 'one station 400');
  const s6 = fresh(); s6.own[20] = 2; s6.own[28] = 2; s6.P[0].pos = 17; rollTo(s6, 1, 2); ok(s6.P[2].cash === 16000, 'two stations 1,000');
  const s7 = fresh(); s7.own[1] = 0; s7.P[0].pos = 30; rollTo(s7, 1, 2); ok(s7.phase === 'build', 'own lot → build offer'); MP.act(s7, { a: 'build' }); ok(s7.lvl[1] === 1 && s7.P[0].cash === 17000 - 500, 'build costs house price');
  const s8 = fresh(); s8.own[1] = 0; s8.lvl[1] = 5; s8.P[0].pos = 30; rollTo(s8, 1, 2); ok(s8.phase !== 'build', 'tower is the top level'); }
// --- one die ---
{ const st = fresh(); rig(st, 4, 4); const ev = MP.act(st, { a: 'roll1' }); ok(st.P[0].pos === 4 && ev[0].d.length === 1, 'one die moves by the first die only');
  ok(!st.again && st.turn === 1, 'one die never gives doubles');
  const a = fresh(), b = fresh(); rig(a, 2, 5); rig(b, 2, 5); MP.act(a, { a: 'roll1' }); MP.act(b, { a: 'roll' }); ok(a.ds === b.ds, 'one or two dice use the same dice stream (no re-roll trick)');
  const j = fresh(); j.P[0].pos = 8; j.P[0].jail = 1; ok(!MP.legal(j).some(x => x.a === 'roll1'), 'no single die in jail');
  const d = fresh(); d.own[5] = 1; d.lvl[5] = 5; d.own[6] = 1; d.lvl[6] = 5; d.own[7] = 1; d.lvl[7] = 5; d.own[9] = 1; d.lvl[9] = 5; d.own[10] = 1; d.lvl[10] = 5; d.own[12] = 1; d.lvl[12] = 5; d.own[13] = 1; d.lvl[13] = 5; d.own[14] = 1; d.lvl[14] = 5; d.own[15] = 1; d.lvl[15] = 5;
  ok(MP.think(d, 2).a === 'roll1', 'careful player creeps with one die in front of towers'); }
// --- doubles & jail ---
{ const st = fresh(); rollTo(st, 2, 2); ok(st.P[0].pos === 4, 'doubles move'); ok(st.turn === 0 && st.phase === 'roll' && st.again, 'doubles: roll again');
  rollTo(st, 3, 3); ok(st.phase === 'buy' && st.P[0].pos === 10, 'second doubles lands on 花蓮'); MP.act(st, { a: 'skip' }); ok(st.turn === 0 && st.phase === 'roll', 'second doubles: again');
  if (st.phase === 'roll') { rollTo(st, 1, 1); ok(st.P[0].jail === 1 && st.P[0].pos === 8, 'third doubles → jail'); ok(st.turn === 1, 'jail ends turn'); } }
{ const st = fresh(); st.P[0].pos = 22; rollTo(st, 1, 1); ok(st.P[0].pos === 8 && st.P[0].jail === 1 && st.turn === 1, '警察局 sends to jail, no extra roll');
  st.turn = 0; st.actor = 0; st.phase = 'roll'; ok(MP.legal(st).some(a => a.a === 'bail'), 'bail offered in jail');
  rollTo(st, 1, 2); ok(st.P[0].jail === 2 && st.P[0].pos === 8, 'no doubles: stay');
  st.turn = 0; st.actor = 0; st.phase = 'roll'; rollTo(st, 2, 2); MP.act(st, { a: 'skip' }); ok(st.P[0].jail === 0 && st.P[0].pos === 12 && st.turn === 1, 'doubles leave jail and move, no extra roll');
  const j = fresh(); j.P[0].pos = 8; j.P[0].jail = 3; rollTo(j, 1, 3); ok(j.P[0].jail === 0 && j.P[0].pos === 12, 'third failed try: pay and move'); MP.act(j, { a: 'skip' }); ok(j.P[0].cash === 15000 - 500, 'forced bail 500');
  const b = fresh(); b.P[0].pos = 8; b.P[0].jail = 1; MP.act(b, { a: 'bail' }); ok(b.P[0].jail === 0 && b.P[0].cash === 14500 && b.phase === 'roll', 'pay bail then roll'); }
// --- cards ---
{ const st = fresh(); st.deck.chance = [7, ...st.deck.chance.filter(x => x !== 7)]; st.P[0].pos = 0; rollTo(st, 1, 1); ok(st.P[0].cash === 16000, 'chance: 發票 +1,000');
  ok(st.deck.chance[st.deck.chance.length - 1] === 7, 'used card goes to bottom');
  const s2 = fresh(); s2.deck.fate = [1, ...s2.deck.fate.filter(x => x !== 1)]; s2.P[0].pos = 9; rollTo(s2, 1, 1); ok(s2.P[0].cash === 15900 && s2.P[1].cash === 14700, 'fate: birthday 300 from each');
  const s3 = fresh(); s3.deck.chance = [5, ...s3.deck.chance.filter(x => x !== 5)]; s3.P[0].pos = 0; rollTo(s3, 1, 1); ok(s3.P[0].jail === 1 && s3.P[0].pos === 8 && s3.turn === 1, 'chance: go to jail');
  const s4 = fresh(); s4.deck.chance = [6, ...s4.deck.chance.filter(x => x !== 6)]; s4.P[0].pos = 0; rollTo(s4, 1, 1); ok(s4.P[0].card === 1 && !s4.deck.chance.includes(6), 'get out of jail card kept');
  s4.P[0].pos = 8; s4.P[0].jail = 1; s4.turn = 0; s4.actor = 0; s4.phase = 'roll'; MP.act(s4, { a: 'card' }); ok(s4.P[0].jail === 0 && s4.P[0].card === 0 && s4.deck.chance.includes(6), 'card used and returned');
  const s5 = fresh(); s5.deck.chance = [2, ...s5.deck.chance.filter(x => x !== 2)]; s5.P[0].pos = 16; rollTo(s5, 1, 1); ok(s5.P[0].pos === 31 && s5.phase === 'buy' && s5.pend.sq === 31, 'advance to 信義 then buy offer');
  const s6 = fresh(); s6.deck.chance = [0, ...s6.deck.chance.filter(x => x !== 0)]; s6.P[0].pos = 16; rollTo(s6, 1, 1); ok(s6.P[0].pos === 0 && s6.P[0].cash === 17000, 'advance to GO pays 2,000 once');
  const s7 = fresh(); s7.deck.chance = [4, ...s7.deck.chance.filter(x => x !== 4)]; s7.P[0].pos = 16; rollTo(s7, 1, 1); ok(s7.P[0].pos === 15 && s7.phase === 'buy', 'back 3 from 18 → 15 (南投)');
  const s8 = fresh(); s8.deck.fate = [4, ...s8.deck.fate.filter(x => x !== 4)]; s8.own[1] = 0; s8.lvl[1] = 2; s8.own[3] = 0; s8.lvl[3] = 5; s8.P[0].pos = 9; rollTo(s8, 1, 1); ok(s8.P[0].cash === 15000 - 800 - 1150, 'typhoon repairs: 2×400 + 1×1,150'); }
// --- takeover ---
{ const st = fresh(); st.own[5] = 1; st.P[0].pos = 3; rollTo(st, 1, 1); ok(st.phase === 'take' && st.pend.cost === 1500, 'takeover offered at 1.5× after rent');
  MP.act(st, { a: 'take' }); ok(st.own[5] === 0 && st.P[0].cash === 15000 - 60 - 1500 && st.P[1].cash === 15000 + 60 + 1500, 'takeover moves lot and money');
  const s2 = fresh(); s2.own[5] = 1; s2.lvl[5] = 1; s2.P[0].pos = 3; rollTo(s2, 1, 1); ok(s2.phase !== 'take', 'no takeover of built lot');
  const s3 = fresh(); s3.own[1] = 1; s3.own[3] = 1; s3.P[0].pos = 30; rollTo(s3, 1, 2); ok(s3.phase !== 'take', 'no takeover inside an owner\'s full set'); }
// --- takeover price and cash ---
{ ok(MP.takeCost(idx('大安')) === 5250, '大安 takeover is exactly 1.5× = 5,250');
  ok(SQ.every((q, i) => !MP.buyable(i) || MP.takeCost(i) === q.price * 1.5), 'every takeover price is exactly 1.5×');
  const st = fresh(); st.own[5] = 1; st.own[1] = 0; st.mort[1] = 1; st.P[0].pos = 3; rollTo(st, 1, 1);
  ok(st.phase === 'take', 'takeover offered'); st.P[0].cash = 1400; // as if a mortgage had just been redeemed
  ok(!MP.legal(st).some(a => a.a === 'take') && MP.act(st, { a: 'take' }) === null, 'no 收購 when cash is short (no negative cash)');
  MP.act(st, { a: 'skip' }); ok(st.P[0].cash === 1400 && st.own[5] === 1, 'skip leaves cash and owner');
  const s2 = fresh(); s2.own[5] = 1; s2.own[31] = 0; s2.P[0].cash = 1200; s2.P[0].pos = 3; rollTo(s2, 1, 1);
  ok(s2.phase === 'take' && !MP.isLegal(s2, { a: 'take' }), 'offered when a mortgage could fund it, button off until then');
  MP.act(s2, { a: 'mortgage', sq: 31 }); ok(MP.isLegal(s2, { a: 'take' }), 'after mortgaging, 收購 is allowed'); MP.act(s2, { a: 'take' }); ok(s2.P[0].cash >= 0 && s2.own[5] === 0, 'take after mortgage keeps cash ≥ 0'); }
// --- expert brain: legal everywhere, funds houses by mortgaging loose lots ---
{ const st = fresh(); st.own[1] = 0; st.own[3] = 0; st.own[25] = 0; st.P[0].cash = 400; st.round = 6;
  const a = MP.think(st, 3); ok(a.a === 'mortgage' && a.sq === 25, 'expert mortgages a loose lot to build on its set');
  MP.act(st, a); const b = MP.think(st, 3); ok(b.a === 'up', 'then builds'); }
// --- set building ---
{ const st = fresh(); st.own[1] = 0; st.own[3] = 0; ok(MP.legal(st).filter(a => a.a === 'up').length === 2, 'full set: build anywhere before rolling');
  MP.act(st, { a: 'up', sq: 3 }); ok(st.lvl[3] === 1 && st.P[0].cash === 14500 && st.phase === 'roll', 'build before roll keeps the turn');
  st.mort[1] = 1; ok(!MP.legal(st).some(a => a.a === 'up'), 'no set building while a lot is mortgaged'); }
// --- debt & bankruptcy ---
{ const st = fresh(); st.own[1] = 1; st.lvl[1] = 5; st.own[5] = 0; st.P[0].cash = 1000; st.P[0].pos = 30; rollTo(st, 1, 2);
  ok(st.P[0].cash === 3000 && st.phase === 'debt' && st.pend.amt === 4500, 'debt phase when cash short');
  ok(MP.legal(st).some(a => a.a === 'mortgage' && a.sq === 5) && MP.legal(st).some(a => a.a === 'bankrupt'), 'can mortgage; bankrupt only when even selling everything is short');
  MP.act(st, { a: 'mortgage', sq: 5 }); ok(st.P[0].cash === 3500 && st.mort[5], 'mortgage gives half price');
  MP.act(st, { a: 'bankrupt' }); ok(st.P[0].out && st.phase === 'over' && st.over.reason === 'bankrupt', 'human bankrupt ends game');
  ok(st.own[5] === 1 && st.P[1].cash === 15000 + 3500, 'assets go to creditor');
  const s2 = fresh(); s2.own[1] = 1; s2.lvl[1] = 5; s2.own[31] = 0; s2.P[0].cash = 600; s2.P[0].pos = 30; rollTo(s2, 1, 2);
  ok(s2.phase === 'debt' && MP.legal(s2).some(a => a.a === 'auto'), 'auto-sell offered when assets can cover');
  MP.act(s2, { a: 'auto' }); ok(MP.legal(s2).some(a => a.a === 'pay'), 'after auto-sell, can pay'); MP.act(s2, { a: 'pay' }); ok(s2.P[0].cash >= 0 && s2.phase !== 'debt', 'debt paid');
  const s3 = fresh(); s3.P[1].cash = 10; s3.own[1] = 0; s3.lvl[1] = 5; s3.turn = 1; s3.actor = 1; s3.P[1].pos = 30; rollTo(s3, 1, 2); ok(s3.P[1].out && s3.P[0].cash > 15000, 'cpu goes bankrupt to human'); ok(s3.turn === 2, 'turn skips to next player');
  ok(MP.ranking(s3)[3] === 1, 'bankrupt player ranked last'); }
// --- redeem ---
{ const st = fresh(); st.own[1] = 0; st.mort[1] = 1; ok(MP.redeemCost(1) === 330, 'redeem 55%'); MP.act(st, { a: 'redeem', sq: 1 }); ok(!st.mort[1] && st.P[0].cash === 14670, 'redeemed'); }
// --- net worth ---
{ const st = fresh(); st.own[1] = 0; st.lvl[1] = 2; st.own[3] = 0; st.mort[3] = 1; ok(MP.netWorth(st, 0) === 15000 + 600 + 1000 + 300, 'net worth = cash + land (half if mortgaged) + houses'); }
// --- round limit ---
{ const st = fresh({ rounds: 2 }); let n = 0; while (st.phase !== 'over' && n++ < 2000) MP.act(st, MP.think(st, 2));
  ok(st.phase === 'over' && st.over.reason === 'rounds' && st.round === 3, 'game ends after round limit'); ok(st.over.rank.length === 4, 'ranking of 4'); }
// --- whole games: no stalls, money conserved by the rules, all levels ---
{ let stalls = 0, bad = 0, n = 0; const t0 = Date.now();
  for (let g = 0; g < 160; g++) {
    const rounds = [12, 20, 30, 0][g % 4], diff = g % 3, me = (g >> 2) % 4;
    const st = MP.newGame({ seed: 900 + g, rounds, diff }); let k = 0;
    while (st.phase !== 'over') {
      if (++k > 30000) { stalls++; break; }
      const lv = st.actor === 0 ? me : MP.cpuLevel(st, st.actor), a = MP.think(st, lv);
      if (!a || !MP.act(st, a)) { bad++; break; }
      if (st.P.some(p => !p.out && p.cash < 0)) { bad++; console.log('negative cash', g); break; }
    }
    n++;
  }
  ok(!stalls, 'no stalled games'); ok(!bad, 'no illegal/negative states'); console.log(`  ${n} full games in ${((Date.now() - t0) / 1000).toFixed(1)}s`); }
// --- difficulty matters (heuristic player vs each level) ---
{ const res = [0, 1, 2].map(diff => { let w = 0; const M = 120; for (let g = 0; g < M; g++) { const st = MP.newGame({ seed: 4000 + g, rounds: 20, diff }); while (st.phase !== 'over') MP.act(st, MP.think(st, st.actor === 0 ? 2 : MP.cpuLevel(st, st.actor))); if (st.over.rank[0] === 0) w++; } return w / M; });
  console.log('  heuristic player win rate vs 新手/普通/高手:', res.map(x => (x * 100).toFixed(0) + '%').join(' / '));
  ok(res[0] > res[1] && res[1] >= res[2] - 0.03, 'harder computers win more'); }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
