// Rule unit tests for 經典接龍, run against the game's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {mulberry32,deal,cloneSt,fits,canTab,canFound,runOk,doDraw,doMove,legalMove,isWon,canDraw,talonReach,safeFound,genMoves,solve,moveScore,recycleScore,timeBonus,diffScore,levelMode,cRank,cSuit,cRed};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const card = (rank, suit) => suit * 13 + rank - 1; // suits: 0♠ 1♥ 2♣ 3♦
const S = 0, Hh = 1, Cc = 2, D = 3;
function empty(draw = 1, limit = -1) { return { t: [[], [], [], [], [], [], []], d: [0, 0, 0, 0, 0, 0, 0], s: [], w: [], f: [0, 0, 0, 0], draw, limit, passes: 0 }; }

// --- deal ---
const d0 = C.deal(12345, 1, -1);
t('7 columns with 1..7 cards', d0.t.every((c, i) => c.length === i + 1));
t('only top card face up', d0.d.every((n, i) => n === i));
t('24 cards in stock, waste empty', d0.s.length === 24 && d0.w.length === 0);
t('52 distinct cards', new Set([].concat(...d0.t, d0.s)).size === 52);
t('same seed -> same deal', JSON.stringify(C.deal(12345, 1, -1)) === JSON.stringify(d0));
t('different seed -> different deal', JSON.stringify(C.deal(12346, 1, -1).t) !== JSON.stringify(d0.t));

// --- tableau stacking ---
t('red 6 on black 7', C.fits(card(6, Hh), card(7, S)));
t('black 6 on black 7 illegal', !C.fits(card(6, Cc), card(7, S)));
t('red 5 on black 7 illegal', !C.fits(card(5, Hh), card(7, S)));
let st = empty(); st.t[0] = [card(7, S)];
t('canTab onto face-up top', C.canTab(st, card(6, D), 0));
st.d[0] = 1; t('cannot stack onto face-down card', !C.canTab(st, card(6, D), 0));
st = empty();
t('empty column accepts K', C.canTab(st, card(13, Hh), 0));
t('empty column rejects Q', !C.canTab(st, card(12, Hh), 0));

// --- run moves ---
st = empty(); st.t[0] = [card(9, S), card(8, Hh), card(7, Cc), card(6, D)]; st.t[1] = [card(9, Hh)];
t('valid run detected', C.runOk(st, 0, 1));
t('move whole run 8-7-6 onto red 9 illegal (8♥ on 9♥ same colour)', !C.legalMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 }));
st.t[1] = [card(9, Cc)];
t('move run onto black 9', !!C.doMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 }) && st.t[1].length === 4 && st.t[0].length === 1);
st = empty(); st.t[0] = [card(9, S), card(5, Hh)]; t('broken sequence is not a run', !C.runOk(st, 0, 0));
st = empty(); st.t[0] = [card(13, S), card(12, Hh)];
t('K-led run to empty column', !!C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 't', tc: 3 }));
st.t[0] = [card(12, Hh), card(11, S)]; t('Q-led run to empty column illegal', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 't', tc: 3 }));

// --- reveal ---
st = empty(); st.t[0] = [card(2, S), card(5, Hh)]; st.d[0] = 1; st.t[1] = [card(6, Cc)];
let r = C.doMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 });
t('moving last face-up card reveals the next', r.revealed && st.d[0] === 0);

// --- foundations ---
st = empty(); st.t[0] = [card(1, Hh)];
t('ace to empty foundation', !!C.doMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }) && st.f[Hh] === 1);
st.t[0] = [card(3, Hh)]; t('3 on A illegal', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st.t[0] = [card(2, D)]; t('2♦ on A♥ illegal (wrong suit)', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st.t[0] = [card(2, Hh)]; C.doMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }); t('2♥ on A♥', st.f[Hh] === 2);
st = empty(); st.t[0] = [card(9, S), card(8, Hh)]; t('only single cards go to foundation', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st = empty(); st.f[Hh] = 5; st.t[2] = [card(6, S)];
t('foundation top back to tableau', !!C.doMove(st, { from: 'f', fc: Hh, to: 't', tc: 2 }) && st.f[Hh] === 4 && st.t[2].length === 2);
t('foundation to foundation not allowed', !C.legalMove(st, { from: 'f', fc: Hh, to: 'f' }));

// --- stock / waste: draw-1, draw-3, recycle limits ---
st = empty(1, -1); st.s = [card(1, S), card(2, S), card(3, S)];
C.doDraw(st); t('draw-1 moves one card', st.w.length === 1 && st.w[0] === card(3, S));
st = empty(3, -1); st.s = [card(1, S), card(2, S), card(3, S), card(4, S), card(5, S)];
C.doDraw(st); t('draw-3 moves three cards, last drawn on top', st.w.length === 3 && st.w[2] === card(3, S));
C.doDraw(st); t('draw-3 with fewer than three left draws the rest', st.w.length === 5 && st.s.length === 0);
st.t[0] = [card(2, Hh)];
t('only the waste top is playable', JSON.stringify(C.legalMove(st, { from: 'w', to: 'f' })) === JSON.stringify([card(1, S)]));
const order = st.w.slice();
r = C.doDraw(st); t('recycle when stock empty', r.recycle && st.s.length === 5 && st.w.length === 0 && st.passes === 1);
C.doDraw(st); C.doDraw(st); t('recycled stock is dealt in the same order', JSON.stringify(st.w) === JSON.stringify(order));
st = empty(1, 1); st.s = [card(1, S)]; C.doDraw(st); C.doDraw(st); C.doDraw(st);
t('recycle limit reached -> cannot draw', st.passes === 1 && st.s.length === 0 && !C.canDraw(st) && C.doDraw(st) === null);
st = empty(1, -1); t('nothing to draw when stock and waste empty', !C.canDraw(st));

// --- talon reachability (used by solver, hints and stuck detection) ---
st = empty(3, -1); st.s = [1, 2, 3, 4, 5, 6, 7].map(r => card(r, Cc)).reverse(); // top = A♣
let tr = C.talonReach(st); const reach = tr.list.map(e => C.cRank(e.card)).sort((a, b) => a - b);
t('draw-3 reachable cards are every third plus the last', JSON.stringify(reach) === '[3,6,7]');
st = empty(1, 0); st.s = [card(5, Cc)]; st.w = [card(8, Cc), card(7, Cc)];
tr = C.talonReach(st); t('with no recycles left the waste below the top is unreachable', JSON.stringify(tr.list.map(e => C.cRank(e.card))) === '[7,5]');

// --- win / auto-finish precondition ---
st = empty(); st.f = [13, 13, 13, 13]; t('52 on foundations is a win', C.isWon(st));
st.f = [13, 13, 13, 12]; t('51 is not', !C.isWon(st));

// --- safe auto-foundation rule (solver pruning) ---
st = empty(); t('aces and twos always safe', C.safeFound(st, card(2, Hh)));
st.f = [3, 0, 3, 0]; t('red 4 safe when both black 3s are up', C.safeFound(st, card(4, Hh)));
st.f = [3, 0, 2, 0]; t('red 4 not safe while a black 3 is out', !C.safeFound(st, card(4, Hh)));

// --- scoring ---
t('waste->tableau +5', C.moveScore({ from: 'w', to: 't' }, false) === 5);
t('to foundation +10', C.moveScore({ from: 't', to: 'f' }, false) === 10);
t('reveal +5', C.moveScore({ from: 't', to: 't' }, true) === 5);
t('foundation->tableau -15', C.moveScore({ from: 'f', to: 't' }, false) === -15);
t('draw-1 recycle -100', C.recycleScore(1, 1) === -100);
t('draw-3 recycles 1-3 free, 4th -20', C.recycleScore(3, 3) === 0 && C.recycleScore(3, 4) === -20);
t('time bonus only from 30 s', C.timeBonus(29) === 0 && C.timeBonus(140) === 5000);

// --- level modes ---
const m = n => C.levelMode(n);
t('1-40 draw-1 unlimited', m(1).draw === 1 && m(40).limit === -1);
t('41-60 draw-1 limit 3', m(41).draw === 1 && m(60).limit === 3);
t('61-85 draw-3 unlimited', m(61).draw === 3 && m(85).limit === -1);
t('86-100 draw-3 limit 3', m(86).draw === 3 && m(100).limit === 3);

// --- solver: solution replays to a win; unsolvable position reported as such ---
const sd = C.deal(100001, 1, -1), sr = C.solve(sd, 200000);
let rep = C.cloneSt(sd), okRep = sr.ok;
if (okRep) for (const a of sr.path) { if (a === 'D') C.doDraw(rep); else if (!C.doMove(rep, a)) { okRep = false; break; } }
t('solver path replays to a win', okRep && C.isWon(rep));
st = empty(1, 0); st.t[0] = [card(1, S), card(2, S)]; st.d[0] = 1; st.f = [0, 13, 13, 13]; // A♠ buried under 2♠, no moves
// fill remaining spades nowhere -> not winnable
t('blocked position is unsolvable', !C.solve(st, 10000).ok && C.genMoves(st, false).length === 0);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
