// Skill-tier bots (qa/skill-tiers/SPEC.md) for 飛行棋, engine part: the human seat (red, seat 0, moves first as in the app's default)
// plays N full games per tier against three opponent sets using the game's own CORE (rules + AI). Usage: node tier-sim.js [N]
const fs = require('fs'), path = require('path');
const AP = new Function(fs.readFileSync('' + require('path').resolve(__dirname, '../../../apps/aeroplane-chess/index.html') + '', 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return AP;')();
const N = +process.argv[2] || 300;
const OPP = { easy: { lv: [1, 1, 1], pe: [1, 2, 0] }, default: { lv: [3, 3, 3], pe: [1, 2, 0] }, hard: { lv: [5, 5, 5], pe: [0, 0, 0] }, lv4: { lv: [4, 4, 4], pe: [0, 0, 0] } };
// oracle: knows the future dice (they are fixed by seed+roll index, and undo shows them). Rolls the true dice 2 turns ahead with Lv3 replies.
function oracle(st, seed) {
  const c = st.turn, L = AP.legal(st, c, st.d); if (L.length <= 1) return 0;
  let bi = 0, bv = -1e18;
  for (let i = 0; i < L.length; i++) {
    const s = AP.clone(st); AP.play(s, L[i]); let n = 0, turnsSeen = 0, lastTurn = s.turn;
    while (!s.over && turnsSeen < 5 && n < 40) { n++; const r = AP.roll(s); if (s.turn !== lastTurn) { turnsSeen++; lastTurn = s.turn; } if (!r || !r.moves || !r.moves.length) continue; const t = AP.think(s, s.turn === c ? 4 : 3, 0, seed + n); AP.play(s, t.i); if (s.turn !== lastTurn) { turnsSeen++; lastTurn = s.turn; } }
    let v = s.over ? (s.over.ranking[0] === c ? 1e9 : -1e6 * s.over.ranking.indexOf(c)) : AP.util(s, c, AP.PERS[0]);
    if (AP.finished(s, c)) v += 1e8;
    if (v > bv) { bv = v; bi = i; }
  }
  return bi;
}
const TIERS = {
  clumsy: (st, R, s) => { const n = AP.legal(st, 0, st.d).length; if (R() < .15 || R() < .5) return Math.floor(R() * n); return AP.think(st, 2, 0, s).i; },
  casual: (st, R, s) => { const n = AP.legal(st, 0, st.d).length; if (R() < .06 || R() < .15) return Math.floor(R() * n); return AP.think(st, 2, 0, s).i; },
  skilled: (st, R, s) => { const n = AP.legal(st, 0, st.d).length; if (R() < .02) return Math.floor(R() * n); return AP.think(st, 3, 0, s).i; },
  world: (st, R, s) => { const n = AP.legal(st, 0, st.d).length; if (R() < .003) return Math.floor(R() * n); return AP.think(st, 4, 0, s).i; },
  superhuman: (st, R, s) => oracle(st, s),
  superhuman_fair: (st, R, s) => AP.think(st, 4, 0, s).i,  // no dice knowledge: the strongest fair policy (Lv4 expectimax)
  app_lv5: (st, R, s) => AP.think(st, 5, 0, s).i           // the app's Lv5 王牌飛行員 (looks at the upcoming dice, stated in its description)
};
const out = { N, tiers: {} }, t0 = Date.now();
for (const [tier, pol] of Object.entries(TIERS)) {
  out.tiers[tier] = {};
  for (const [on, o] of Object.entries(OPP)) {
    const n = /superhuman|lv5/.test(tier) ? Math.ceil(N / 2) : N;
    let first = 0, rankSum = 0, turns = 0, stall = 0, caps = 0, hit = 0; const R = AP.rng(777 + tier.length * 31 + on.length);
    for (let g = 0; g < n; g++) {
      const seed = 50000 + g * 7919, st = AP.newGame({ seed }); let k = 0;
      while (!st.over) {
        if (++k > 20000) { stall++; break; }
        const r = AP.roll(st); if (!r.moves || !r.moves.length) continue;
        const i = st.turn === 0 ? pol(st, R, seed + k) : AP.think(st, o.lv[st.turn - 1], o.pe[st.turn - 1], seed * 3 + k).i;
        AP.play(st, i);
      }
      if (!st.over) continue;
      const rk = st.over.ranking.indexOf(0); if (rk === 0) first++; rankSum += rk + 1; turns += st.turnNo; caps += st.caps[0]; hit += st.hit[0];
    }
    const p = first / n, ci = 1.96 * Math.sqrt(p * (1 - p) / n);
    out.tiers[tier][on] = { games: n, firstRate: +p.toFixed(3), ci95: +ci.toFixed(3), avgRank: +(rankSum / n).toFixed(2), avgTurns: Math.round(turns / n), capsPerGame: +(caps / n).toFixed(2), hitPerGame: +(hit / n).toFixed(2), stalls: stall };
    console.log(tier.padEnd(16), on.padEnd(8), JSON.stringify(out.tiers[tier][on]), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
// dice-sequence independence: does the roll sequence depend on the player's choices? (if not, undo-scouting reveals every future roll)
let same = 0; const M = 200;
for (let g = 0; g < M; g++) { const seq = []; for (const pick of [0, 1]) { const st = AP.newGame({ seed: 9000 + g }), d = []; let k = 0; while (!st.over && d.length < 120 && ++k < 5000) { const r = AP.roll(st); d.push(r.d); if (!r.moves || !r.moves.length) continue; AP.play(st, st.turn === 0 ? Math.min(pick, r.moves.length - 1) * (r.moves.length - 1) : 0); } seq.push(d.join('')); } if (seq[0] === seq[1]) same++; }
out.diceIndependentOfChoices = same + '/' + M;
console.log('dice sequence identical whatever the human picks:', out.diceIndependentOfChoices);
fs.writeFileSync(path.join(__dirname, 'tier-sim.json'), JSON.stringify(out, null, 1));
