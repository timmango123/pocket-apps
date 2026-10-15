// Rule unit tests for 金字塔接龍 using the game's own core (CORE-START/CORE-END in index.html).
const fs = require('fs'), path = require('path'), assert = require('assert');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {COVER,ROWOF,dealFromSeed,initState,isFree,availLocs,legalMoves,applyMove,wasteTops,canDraw,canRecycle,stockLeft,isWon,isStuck,solve};')();
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('  ok', name); };
// a hand-built deal: cards are 0..51, rank = c%13+1
function deal(cards) { return { seed: 0, cards, rk: cards.map(c => c % 13 + 1) }; }
const base = C.dealFromSeed(12345);
const bit = (...ps) => ps.reduce((m, p) => (m | (1 << p)) >>> 0, 0);

t('deal: 28 pyramid + 24 stock, all 52 distinct', () => { assert.strictEqual(new Set(base.cards).size, 52); assert.strictEqual(base.cards.length, 52); });
t('initially only the 7 bottom-row cards are free', () => { assert.deepStrictEqual(C.availLocs(C.initState()).filter(l => l < 28).sort((a, b) => a - b), [21, 22, 23, 24, 25, 26, 27]); });
t('half-covered card is NOT free (only one coverer removed)', () => {
  const s = { pm: bit(21), um: 0, p: 0, r: 0 }; // pos 15 is covered by 21 and 22
  assert.deepStrictEqual(C.COVER[15], [21, 22]); assert.strictEqual(C.isFree(s, 15), false);
  assert.strictEqual(C.isFree({ pm: bit(21, 22), um: 0, p: 0, r: 0 }, 15), true);
});
t('K removes alone; other cards cannot pair with themselves', () => {
  const cards = base.cards.slice(); const k = cards.indexOf(12); const j = cards[27]; cards[27] = 12; cards[k] = j; // put K♠ at pos 27
  const D = deal(cards), ms = C.legalMoves(D, C.initState(), 2);
  assert(ms.some(m => m.t === 'k' && m.a === 27));
  assert(ms.every(m => m.t !== 'p' || m.a !== m.b));
  const s = C.applyMove(D, C.initState(), { t: 'k', a: 27 }); assert.strictEqual((s.pm >>> 27) & 1, 1);
});
t('pairs must sum to 13 and only free cards are offered', () => {
  const D = base, s = C.initState();
  for (const m of C.legalMoves(D, s, 2)) if (m.t === 'p') { assert.strictEqual(D.rk[m.a] + D.rk[m.b], 13); assert(C.availLocs(s).includes(m.a) && C.availLocs(s).includes(m.b)); }
});
t('drawn card and waste top are both available and may pair with each other', () => {
  // stock order: A (rank1) then Q (rank12)
  const cards = base.cards.slice(); const iA = cards.indexOf(0), iQ = cards.indexOf(11);
  [cards[28], cards[iA]] = [cards[iA], cards[28]]; const iQ2 = cards.indexOf(11); [cards[29], cards[iQ2]] = [cards[iQ2], cards[29]];
  const D = deal(cards); let s = C.initState(); s = C.applyMove(D, s, { t: 'd' }); s = C.applyMove(D, s, { t: 'd' });
  assert.deepStrictEqual(C.wasteTops(s), [1, 0]);
  assert(C.legalMoves(D, s, 0).some(m => m.t === 'p' && ((m.a === 29 && m.b === 28) || (m.a === 28 && m.b === 29))));
});
t('recycle limits: 0 / 1 / 2 passes', () => {
  for (const R of [0, 1, 2]) {
    let s = C.initState(), rec = 0;
    for (let k = 0; k < 200; k++) { if (C.canDraw(s, R)) s = C.applyMove(base, s, { t: 'd' }); else if (C.canRecycle(s, R)) { s = C.applyMove(base, s, { t: 'r' }); rec++; } else break; }
    assert.strictEqual(rec, R); assert.strictEqual(C.stockLeft(s), 0);
  }
});
t('recycle keeps the original order of unused cards', () => {
  let s = C.initState(); for (let i = 0; i < 24; i++) s = C.applyMove(base, s, { t: 'd' });
  s = { ...s, um: bit(0, 2) }; s = C.applyMove(base, s, { t: 'r' }); s = C.applyMove(base, s, { t: 'd' });
  assert.deepStrictEqual(C.wasteTops(s), [1, -1]);
});
t('win = pyramid empty, regardless of stock', () => { assert(C.isWon({ pm: (1 << 28) - 1 >>> 0, um: 0, p: 3, r: 0 })); });
t('stuck when no pair, no K, no stock and no recycles left', () => {
  let s = C.initState(); for (let i = 0; i < 24; i++) s = C.applyMove(base, s, { t: 'd' });
  const ms = C.legalMoves(base, s, 0); assert(ms.every(m => m.t !== 'd' && m.t !== 'r'));
  assert.strictEqual(C.isStuck(base, s, 0), ms.length === 0);
});
t('solver solutions replay legally to a cleared pyramid', () => {
  for (const seed of [1, 2, 3, 5, 8]) { const D = C.dealFromSeed(seed), r = C.solve(D, C.initState(), 2, 60000); if (!r.ok) continue; let s = C.initState(); for (const m of r.sol) s = C.applyMove(D, s, m); assert(C.isWon(s)); }
});
console.log('rules tests passed:', pass);
