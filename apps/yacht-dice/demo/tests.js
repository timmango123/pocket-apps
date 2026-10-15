// Rule unit tests for 快艇骰子, using the game's own core (CORE-START/CORE-END in ../index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const YC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return YC;')();
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  FAIL:', name); } }
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }
const C = d => YC.counts(d), R = (cat, d) => YC.raw(cat, C(d));
const UP = 0, TK = 6, FK = 7, FH = 8, SS = 9, LS = 10, Y = 11, CH = 12;
function sheet(fill) { const s = YC.newSheet(); for (const k in fill) s.sc[k] = fill[k]; return s; }
const opt = (sh, d) => { const m = {}; YC.options(sh.sc, C(d)).forEach(o => m[o.cat] = o); return m; };

console.log('1. Upper section');
eq(R(0, [1, 1, 1, 4, 5]), 3, 'ones = 3'); eq(R(1, [2, 2, 3, 4, 5]), 4, 'twos = 4'); eq(R(2, [1, 2, 4, 5, 6]), 0, 'threes none = 0');
eq(R(3, [4, 4, 4, 4, 1]), 16, 'fours = 16'); eq(R(4, [5, 5, 5, 5, 5]), 25, 'fives yacht = 25'); eq(R(5, [6, 1, 6, 2, 6]), 18, 'sixes = 18');
console.log('2. Three / four of a kind, chance');
eq(R(TK, [3, 3, 3, 4, 5]), 18, '3K 33345 = 18'); eq(R(TK, [3, 3, 4, 4, 5]), 0, '3K two pair = 0'); eq(R(TK, [2, 2, 2, 2, 6]), 14, '3K with four = 14');
eq(R(FK, [4, 4, 4, 4, 5]), 21, '4K 44445 = 21'); eq(R(FK, [4, 4, 4, 5, 5]), 0, '4K full house = 0'); eq(R(FK, [6, 6, 6, 6, 6]), 30, '4K yacht = 30');
eq(R(CH, [1, 3, 5, 6, 6]), 21, 'chance = sum');
console.log('3. Full house');
eq(R(FH, [2, 2, 3, 3, 3]), 25, 'FH 22333 = 25'); eq(R(FH, [3, 3, 3, 3, 3]), 25, 'FH yacht counts = 25'); eq(R(FH, [2, 2, 3, 3, 4]), 0, 'FH two pair = 0'); eq(R(FH, [2, 2, 2, 2, 3]), 0, 'FH four+one = 0');
console.log('4. Straights');
eq(R(SS, [1, 2, 3, 4, 6]), 30, 'SS 1234 = 30'); eq(R(SS, [2, 3, 4, 5, 2]), 30, 'SS 2345 with dup = 30'); eq(R(SS, [3, 4, 5, 6, 6]), 30, 'SS 3456 = 30');
eq(R(SS, [1, 2, 3, 5, 6]), 0, 'SS 12356 = 0'); eq(R(SS, [1, 2, 3, 4, 5]), 30, 'SS from large straight = 30');
eq(R(LS, [1, 2, 3, 4, 5]), 40, 'LS 12345 = 40'); eq(R(LS, [6, 5, 4, 3, 2]), 40, 'LS 23456 = 40'); eq(R(LS, [1, 3, 4, 5, 6]), 0, 'LS 13456 = 0'); eq(R(SS, [1, 3, 4, 5, 6]), 30, 'SS 13456 = 30');
console.log('5. Yacht');
eq(R(Y, [5, 5, 5, 5, 5]), 50, 'yacht = 50'); eq(R(Y, [5, 5, 5, 5, 4]), 0, 'no yacht = 0');
console.log('6. Upper bonus');
{ const s = sheet({ 0: 3, 1: 6, 2: 9, 3: 12, 4: 15 }); const g = YC.apply(s, { cat: 5, pts: 18, bonus: 0 }); eq(YC.upper(s), 63, 'upper exactly 63'); eq(g, 18 + 35, 'crossing 63 gains +35'); eq(YC.total(s), 98, 'total includes bonus'); }
{ const s = sheet({ 0: 3, 1: 6, 2: 9, 3: 12, 4: 15, 5: 12 }); eq(YC.total(s), 57, 'upper 57 no bonus'); }
{ const s = sheet({ 0: 2, 1: 6, 2: 9, 3: 12, 4: 15, 5: 18 }); eq(YC.total(s), 62, 'upper 62 no bonus'); }
console.log('7. Extra yacht and joker rules');
{ const s = sheet({ 11: 50 }); const o = YC.options(s.sc, C([4, 4, 4, 4, 4])); eq(o.length, 1, 'joker: matching upper open is forced'); eq([o[0].cat, o[0].pts, o[0].bonus], [3, 20, 100], 'forced fours 20 + bonus 100'); }
{ const s = sheet({ 11: 50, 3: 12 }); const m = opt(s, [4, 4, 4, 4, 4]);
  eq(Object.keys(m).map(Number), [6, 7, 8, 9, 10, 12], 'joker: any open lower box allowed');
  eq([m[FH].pts, m[SS].pts, m[LS].pts, m[TK].pts, m[FK].pts, m[CH].pts], [25, 30, 40, 20, 20, 20], 'joker lower full points');
  ok(Object.values(m).every(o => o.bonus === 100), 'every joker option carries +100'); }
{ const s = sheet({ 11: 50, 3: 12, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 12: 1 }); const m = opt(s, [4, 4, 4, 4, 4]);
  eq(Object.keys(m).map(Number), [0, 1, 2, 4, 5], 'joker: lower full -> any open upper'); ok(Object.values(m).every(o => o.pts === 0 && o.bonus === 100), 'upper scored 0 with bonus'); }
{ const s = sheet({ 11: 0, 3: 12 }); const m = opt(s, [4, 4, 4, 4, 4]); ok(Object.values(m).every(o => o.bonus === 0), 'yacht box scratched (0): no +100'); eq(m[LS].pts, 40, 'yacht box 0: joker still scores LS 40'); }
{ const s = sheet({}); const m = opt(s, [2, 2, 2, 2, 2]); eq(m[Y].pts, 50, 'yacht box open: scores 50'); eq(m[LS].pts, 0, 'yacht box open: no joker for LS'); ok(m[1].bonus === 0, 'no bonus on first yacht'); }
{ const s = sheet({ 11: 50 }); const g = YC.apply(s, YC.options(s.sc, C([6, 6, 6, 6, 6]))[0]); eq(g, 130, 'apply extra yacht: 30 + 100'); eq(s.yb, 1, 'bonus counter'); }
{ const s = sheet({}); const m = opt(s, [1, 2, 3, 4, 6]); ok(!(Y in m) || m[Y].pts === 0, 'filled boxes excluded / zero allowed'); s.sc[CH] = 16; ok(!(CH in opt(s, [1, 2, 3, 4, 6])), 'filled box not offered again'); }
console.log('8. Theoretical maximum 1575');
{ const s = YC.newSheet(); const order = [11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12]; let tot = 0;
  for (const c of order) { const f = c < 6 ? c + 1 : 6; const o = opt(s, [f, f, f, f, f]); const pick = o[c] || Object.values(o).sort((a, b) => b.pts - a.pts)[0]; tot += YC.apply(s, pick); }
  eq(YC.total(s), 1575, 'thirteen yachts = 1575'); eq(tot, 1575, 'apply gains sum to total'); }
console.log('9. Rolls, holds and deterministic dice');
ok(YC.canRoll(0, 0, [false, false, false, false, false]), 'can roll at start'); ok(YC.canRoll(2, 0, [true, false, true, true, true]), 'third roll allowed');
ok(!YC.canRoll(3, 0, [false, false, false, false, false]), 'no fourth roll'); ok(YC.canRoll(3, 1, [false, false, false, false, false]), 'ticket allows a fourth roll');
ok(!YC.canRoll(4, 1, [false, false, false, false, false]), 'ticket: no fifth roll'); ok(!YC.canRoll(1, 0, [true, true, true, true, true]), 'all held: cannot roll');
{ const g = { seed: 12345, k: 1, player: 0, turn: 4, roll: 1, undo: 0, dice: [6, 6, 2, 3, 6] }, h = [true, true, false, false, true];
  const a = YC.rollTurn(g, h), b = YC.rollTurn(g, h); eq(a, b, 'same state -> same dice (refresh cannot re-roll)'); eq([a[0], a[1], a[4]], [6, 6, 6], 'held dice unchanged');
  const c = YC.rollTurn(g, [true, true, true, false, true]); eq(c[3], a[3], 'slot value independent of other holds'); }
{ const cnt = [0, 0, 0, 0, 0, 0, 0]; let n = 0; for (let t = 0; t < 13; t++) for (let r = 0; r < 3; r++) for (let s = 0; s < 5; s++) for (let seed = 0; seed < 400; seed++) { cnt[YC.die(seed, 1, 0, t, r, s)]++; n++; }
  const e = n / 6, chi = cnt.slice(1).reduce((a, c) => a + (c - e) * (c - e) / e, 0); ok(chi < 20.5, 'dice uniform: chi2 = ' + chi.toFixed(2) + ' (df 5, p>0.001)'); }
console.log('10. Probability tables (recomputed)');
eq(YC.NR, 252, '252 five-dice multisets'); eq(YC.KEEPS.length, 462, '462 keep multisets'); ok(Math.abs(YC.P0sum() - 1) < 1e-12, 'first-roll probabilities sum to 1');
{ let worst = 0; for (let k = 0; k < YC.KEEPS.length; k++) { let s = 0; for (let t = YC.TS[k]; t < YC.TS[k + 1]; t++) s += YC.TP[t]; worst = Math.max(worst, Math.abs(s - 1)); } ok(worst < 1e-12, 'every keep: reroll outcome probabilities sum to 1'); }
{ const r = YC.rollOf([0, 0, 0, 0, 0, 0, 5]); ok(Math.abs(YC.P0[r] - 1 / 7776) < 1e-15, 'P(66666 in one roll) = 1/7776'); }
{ let maxSub = 0; for (const s of YC.SUB) maxSub = Math.max(maxSub, s.length); eq(maxSub, 32, 'at most 32 keep choices per roll'); }
console.log('11. Voyage thresholds and tickets');
eq([1, 9, 10, 15, 16, 20].map(YC.threshold), [150, 270, 285, 360, 370, 410], 'T(k): 150, 270, 285, 360, then +10');
{ let v = { k: 1, cum: 0, tickets: 0 }; const got = []; for (let i = 0; i < 15; i++) { v = YC.voyageAdvance(v, 999); if (v.ticket) got.push(v.k - 1); } eq(got, [5, 10], 'tickets after sheets 5 and 10 only (max 2)'); eq(v.tickets, 2, 'ticket cap 2'); eq(v.k, 16, 'advanced 15 sheets'); }
{ const v = YC.voyageAdvance({ k: 3, cum: 400, tickets: 0 }, 179); ok(!v.passed && v.cum === 579 && v.k === 3, 'below T(3)=180 ends voyage, score still accumulates'); }
{ const v = YC.voyageAdvance({ k: 3, cum: 400, tickets: 0 }, 180); ok(v.passed && v.k === 4, 'exactly threshold passes'); }
console.log('12. AI levels');
{ const s = YC.newSheet(); const d = YC.decide(s, [3, 3, 3, 1, 5], 2, 0); eq(d.hold, [true, true, true, false, false], 'novice keeps the most common face'); }
{ const s = sheet({ 6: 20 }); const d = YC.decide(s, [1, 2, 3, 4, 6], 0, 0); eq(d.cat, SS, 'novice fills highest immediate score'); }
{ const s = YC.newSheet(); const d = YC.decide(s, [6, 6, 6, 6, 6], 2, 2); ok(d.type === 'fill' && d.cat === Y, 'expert banks a yacht immediately'); }
{ const s = YC.newSheet(); const d = YC.decide(s, [1, 2, 3, 4, 5], 2, 2); ok(d.type === 'fill' && d.cat === LS, 'expert banks a large straight'); }
{ const s = YC.newSheet(); const d = YC.decide(s, [2, 3, 4, 5, 5], 2, 2); ok(d.type === 'keep' && d.hold.filter(Boolean).length === 4, 'expert rolls for the large straight from 2345'); }
{ const s = YC.newSheet(); let mx = 0; const t0 = Date.now(); for (let i = 0; i < 200; i++) { const a = Date.now(); YC.decide(s, [1, 3, 3, 5, 6], 2, 2); mx = Math.max(mx, Date.now() - a); } ok(mx < 30, 'expert decision < 30 ms (max ' + mx + ' ms)'); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
