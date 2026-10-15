// Rule unit tests for 撿紅點, run against the game's own core (extracted between the CORE markers of index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PR = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PR;')();
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const C = (r, s) => s * 13 + (r - 1); // s: 0♠ 1♥ 2♣ 3♦
const SP = 0, HE = 1, CL = 2, DI = 3;

// --- deck, deal, redeal ---
for (let seed = 1; seed <= 2000; seed++) {
  const g = PR.newRound({ seed, n: 4, dealer: seed % 4 });
  const all = [].concat(...g.hands, g.table, g.deck);
  if (seed === 1) ok(g.hands.every(h => h.length === 6) && g.table.length === 4 && g.deck.length === 24, 'deal 6x4 + 4 + 24');
  ok(all.length === 52 && new Set(all).size === 52 && all.every(c => c >= 0 && c < 52), 'deal uses all 52 distinct cards (seed ' + seed + ')');
  ok(!PR.badTable(g.table), 'no 3-of-a-rank on the starting table');
}
let redealt = 0; for (let seed = 1; seed <= 2000; seed++) redealt += PR.newRound({ seed }).redeals > 0;
ok(redealt > 0, 'redeal path exercised');
const exact = (13 * 4 * 48 + 13) / (52 * 51 * 50 * 49 / 24);
console.log(`deal: 2000 seeded deals valid, ${redealt} needed a redeal (${(redealt / 20).toFixed(2)}%; exact P(3+ same rank among 4 table cards) = ${(exact * 100).toFixed(2)}%)`);
ok(PR.badTable([C(5, 0), C(5, 1), C(5, 2), C(9, 3)]) && PR.badTable([C(12, 0), C(12, 1), C(12, 2), C(12, 3)]) && !PR.badTable([C(5, 0), C(5, 1), C(9, 2), C(9, 3)]), 'badTable: 3+ same rank only');
const g2 = PR.newRound({ seed: 9, n: 2 });
ok(g2.hands.length === 2 && g2.hands.every(h => h.length === 12) && g2.table.length === 4 && g2.deck.length === 24, 'two-player deal 12x2 + 4 + 24');
const a = PR.newRound({ seed: 42 }), b = PR.newRound({ seed: 42 });
ok(JSON.stringify(a) === JSON.stringify(b), 'seeded shuffle is reproducible');
ok(JSON.stringify(PR.newRound({ seed: 43 }).hands) !== JSON.stringify(a.hands), 'different seed, different deal');

// --- pairing ---
const sums = [[1, 9], [2, 8], [3, 7], [4, 6], [5, 5]];
for (const [x, y] of sums) ok(PR.pairs(C(x, SP), C(y, HE)) && PR.pairs(C(y, CL), C(x, DI)), `${x}+${y}=10 pairs`);
for (const r of [10, 11, 12, 13]) { ok(PR.pairs(C(r, SP), C(r, HE)), `${r} pairs same rank`); for (const o of [1, 5, 9, 10, 11, 12, 13]) if (o !== r) ok(!PR.pairs(C(r, SP), C(o, HE)), `${r} does not pair ${o}`); }
ok(!PR.pairs(C(10, SP), C(1, HE)) && !PR.pairs(C(10, SP), C(9, HE)), '10 never "sums" to 10 with anything');
ok(!PR.pairs(C(2, SP), C(2, HE)) && !PR.pairs(C(1, SP), C(1, HE)) && !PR.pairs(C(4, SP), C(5, HE)), 'non-ten sums do not pair');
let pc = 0; for (let x = 0; x < 52; x++) for (let y = 0; y < 52; y++) if (x !== y && PR.pairs(x, y)) { pc++; if (!PR.pairs(y, x)) ok(false, 'symmetry'); }
ok(pc === 2 * (4 * 16 + 6 + 4 * 6), 'pair relation count: A/9,2/8,3/7,4/6 16 each + 5s 6 + 10-K 6 each');
ok(JSON.stringify(PR.targets(C(5, HE), [C(5, SP), C(9, CL), C(5, DI), C(10, HE)])) === JSON.stringify([C(5, SP), C(5, DI)]), 'targets lists every pairing table card (multiple targets)');

// --- scoring ---
ok(PR.pts(C(1, HE)) === 20 && PR.pts(C(1, DI)) === 20, 'red A = 20');
for (let r = 2; r <= 9; r++) ok(PR.pts(C(r, HE)) === r && PR.pts(C(r, DI)) === r, `red ${r} = face`);
for (let r = 10; r <= 13; r++) ok(PR.pts(C(r, HE)) === 10 && PR.pts(C(r, DI)) === 10, `red ${r} = 10`);
for (let r = 1; r <= 13; r++) ok(PR.pts(C(r, SP)) === 0 && PR.pts(C(r, CL)) === 0, `black ${r} = 0`);
ok(PR.pts(C(1, SP), { spadeA30: true }) === 30 && PR.pts(C(1, CL), { spadeA30: true }) === 0, 'option: ♠A = 30, ♣A still 0');
ok(PR.totalPts() === 208 && PR.totalPts({ spadeA30: true }) === 238, 'deck totals 208 / 238 (recomputed: 2x(20+44)+8x10=208)');

// --- turn flow with a hand-built position ---
function fixed(table, hand0, deckTop) {
  const g = PR.newRound({ seed: 5 }); g.table = table.slice(); g.hands[0] = hand0.slice(); g.turn = 0; g.phase = 'play';
  const used = new Set([...table, ...hand0, deckTop]); let pool = []; for (let c = 0; c < 52; c++) if (!used.has(c)) pool.push(c);
  g.hands[1] = pool.splice(0, hand0.length); g.hands[2] = pool.splice(0, hand0.length); g.hands[3] = pool.splice(0, hand0.length);
  g.deck = pool.concat([deckTop]); g.cap = [[], [], [], []]; return g;
}
let g = fixed([C(9, HE), C(9, SP), C(4, CL)], [C(1, DI), C(7, SP)], C(6, DI));
ok(PR.play(g, C(1, DI), -1) === 'must capture', 'a card that can pair must capture');
ok(PR.play(g, C(1, DI), C(4, CL)) === 'must capture', 'capture target must be a pairing card');
ok(PR.play(g, C(7, SP), C(9, HE)) === 'no target', 'a non-pairing card cannot capture');
let ev = PR.play(g, C(1, DI), C(9, SP));
ok(ev.k === 'cap' && ev.pts === 20 && g.cap[0].length === 2 && g.table.indexOf(C(9, SP)) < 0 && g.table.indexOf(C(9, HE)) >= 0, 'player chooses among multiple targets; red A + black 9 = 20');
ok(g.phase === 'flip' && g.flip === C(6, DI) && JSON.stringify(g.flipT) === JSON.stringify([C(4, CL)]), 'flip step draws the stock top and lists its targets');
ok(PR.flip(g, -1) === 'must capture', 'flipped card that pairs must capture');
ev = PR.flip(g, C(4, CL));
ok(ev.k === 'cap' && ev.pts === 6 && g.turn === 1 && g.phase === 'play', 'flip captures, turn passes to next seat');
g = fixed([C(9, HE)], [C(3, SP)], C(12, DI));
ev = PR.play(g, C(3, SP), -1); ok(ev.k === 'place' && g.table.includes(C(3, SP)), 'no pair: card goes to the table');
ok(g.flipT.length === 0, 'flipped Q with no Q on table has no target');
ev = PR.flip(g, -1); ok(ev.k === 'place' && g.table.includes(C(12, DI)), 'unpaired flip stays on the table');
g = fixed([C(5, SP), C(5, CL)], [C(8, SP)], C(5, HE));
PR.play(g, C(8, SP), -1); ok(g.flipT.length === 2, 'flipped 5 with two 5s on table offers both');
ev = PR.flip(g, C(5, CL)); ok(ev.k === 'cap' && g.table.includes(C(5, SP)) && ev.pts === 5, 'flip chooses one of two same-rank targets');
g = fixed([], [C(4, HE)], C(6, SP));
ev = PR.play(g, C(4, HE), -1); ok(ev.k === 'place', 'empty table: card is simply placed');
ok(g.flipT.length === 1 && g.flipT[0] === C(4, HE), 'flip may capture the card just placed');
g = fixed([C(10, SP)], [C(10, HE)], C(2, SP)); ev = PR.play(g, C(10, HE), C(10, SP)); ok(ev.k === 'cap' && ev.pts === 10, '10 captures 10');

// --- whole rounds: invariants, AI legality, match rotation ---
let bad = 0, rounds = 0; const tms = [];
for (let i = 0; i < 1200; i++) {
  const n = i % 3 === 0 ? 2 : 4, rules = { spadeA30: i % 2 === 1 };
  const s = PR.newRound({ seed: 1000 + i, n, dealer: i % n, rules }); let k = 0;
  while (s.phase !== 'done' && k < 200) {
    const p = s.turn, lv = (i + p) % 3;
    let r = PR.think({ view: PR.aiView(s, p), level: lv, seed: k }); if (lv === 2) tms.push(r.ms);
    if (typeof PR.play(s, r.card, r.tgt) === 'string') bad++;
    r = PR.think({ view: PR.aiView(s, p), level: lv, seed: k + 1 }); if (typeof PR.flip(s, r.tgt) === 'string') bad++; k++;
  }
  const sc = PR.scores(s), tot = sc.reduce((x, y) => x + y, 0);
  if (s.phase !== 'done' || s.table.length || s.deck.length || s.hands.some(h => h.length) || tot !== (rules.spadeA30 ? 238 : 208) || k !== (n === 4 ? 24 : 24)) bad++;
  rounds++;
}
ok(bad === 0, 'AI rounds: no illegal move, table empty, stock and hands run out together, red total 208/238');
console.log(`rounds: ${rounds} mixed AI rounds (4p/2p, both scoring options): ${bad} problems; 高手 think max ${Math.max(...tms)} ms`);
const dealers = []; for (let r = 0; r < 4; r++) dealers.push(r % 4); ok(dealers.join() === '0,1,2,3', 'four-round match: each seat deals once (dealer = round mod n, dealer leads)');
const gd = PR.newRound({ seed: 3, dealer: 2 }); ok(gd.turn === 2, 'dealer plays first');
// view hides hidden information
const v = PR.aiView(gd, 1); ok(!('deck' in v) && !('hands' in v) && v.opp.join() === '6,6,6' && PR.unknown(v).length === 52 - 6 - 4, 'AI view: own hand + public cards only');

console.log(`tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
