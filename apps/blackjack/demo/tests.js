// Rule unit tests for 二十一點 (blackjack), run against the game's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {RULES,MINBET,MAXBET,START,rng,newShoe,rank,cval,hval,isBJ,newGame,deal,insure,legal,act,advise,strat,canBet,simulate};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
// card code: rank 1=A..13=K, suit 0..3  ->  suit*13 + rank-1
const c = (r, s = 0) => s * 13 + r - 1;
const A = 1, J = 11, Q = 12, K = 13;
// rigged game: cards are dealt in order P1, D-up, P2, D-hole, then hits
function rig(rk, cards, bank = 1000) { const G = C.newGame(rk, 1, bank); G.shoe = { c: cards.map(x => c(x)), pos: 0, cut: 9999 }; return G; }
const net = G => G.net;

// --- hand values ---
const hv = a => C.hval(a.map(x => c(x)));
t('A+6 = soft 17', hv([A, 6]).t === 17 && hv([A, 6]).soft);
t('A+6+10 = hard 17', hv([A, 6, 10]).t === 17 && !hv([A, 6, 10]).soft);
t('A+A = soft 12', hv([A, A]).t === 12 && hv([A, A]).soft);
t('A+A+9 = 21', hv([A, A, 9]).t === 21);
t('K+Q+2 = 22 bust', hv([K, Q, 2]).t === 22);
t('J/Q/K count 10', C.cval(c(J)) === 10 && C.cval(c(Q)) === 10 && C.cval(c(K)) === 10);
t('A+K is blackjack', C.isBJ([c(A), c(K)], false));
t('A+K after split is not blackjack', !C.isBJ([c(A), c(K)], true));
t('5+6+K = 21 not blackjack', !C.isBJ([c(5), c(6), c(K)], false));

// --- shoe ---
for (const [rk, n] of [['easy', 4], ['std', 6], ['strict', 8]]) {
  const s = C.newGame(rk, 42).shoe;
  t(rk + ' shoe has ' + n * 52 + ' cards', s.c.length === n * 52);
  t(rk + ' cut card at 75%', s.cut === Math.floor(n * 52 * 0.75));
  const cnt = new Array(52).fill(0); s.c.forEach(x => cnt[x]++);
  t(rk + ' each card appears ' + n + ' times', cnt.every(k => k === n));
}
t('6 decks = 312 cards, cut at 234', C.newGame('std', 1).shoe.c.length === 312 && C.newGame('std', 1).shoe.cut === 234);
t('same seed -> same shoe', JSON.stringify(C.newGame('std', 7).shoe.c) === JSON.stringify(C.newGame('std', 7).shoe.c));
t('different seed -> different shoe', JSON.stringify(C.newGame('std', 7).shoe.c) !== JSON.stringify(C.newGame('std', 8).shoe.c));
{ const G = C.newGame('std', 5); G.shoe.pos = G.shoe.cut; C.deal(G, 10);
  t('reaching the cut card reshuffles before the next round', G.ev.some(e => e.t === 'shuffle') && G.shoe.pos < 20); }
{ const G = C.newGame('std', 5); G.shoe.pos = G.shoe.cut - 1; C.deal(G, 10);
  t('round started before cut card is dealt from the same shoe', !G.ev.some(e => e.t === 'shuffle')); }

// --- bets ---
{ const G = C.newGame('std', 1, 300);
  t('min bet 10', !C.canBet(G, 5) && C.canBet(G, 10));
  t('max bet 500', !C.canBet(C.newGame('std', 1, 5000), 510) && C.canBet(C.newGame('std', 1, 5000), 500));
  t('cannot bet more than points', !C.canBet(G, 310) && C.canBet(G, 300)); }

// --- blackjack, peek, insurance ---
{ const G = rig('std', [A, 9, K, 7]); C.deal(G, 10);
  t('player blackjack settles immediately', G.phase === 'done' && G.hands[0].res === 'bj');
  t('blackjack pays 3:2 (+15 on 10)', G.bank === 1015 && net(G) === 15); }
{ const G = rig('std', [A, 9, K, 7]); C.deal(G, 25);
  t('3:2 on odd bet rounds down (25 -> +37)', G.bank === 1037); }
{ const G = rig('std', [9, K, 8, A]); C.deal(G, 10);
  t('dealer 10 up with blackjack: peek ends round before player acts', G.phase === 'done' && G.hands[0].res === 'lose' && G.bank === 990); }
{ const G = rig('std', [9, K, 8, 7]); C.deal(G, 10);
  t('dealer 10 up without blackjack: player acts', G.phase === 'play' && G.ev.some(e => e.t === 'peek' && !e.bj)); }
{ const G = rig('std', [9, 5, 8, A]); C.deal(G, 10);
  t('dealer 5 up: no peek', G.phase === 'play' && !G.ev.some(e => e.t === 'peek')); }
{ const G = rig('std', [9, A, 8, K]); C.deal(G, 10);
  t('dealer ace up offers insurance', G.phase === 'ins');
  C.insure(G, true);
  t('insurance pays 2:1 when dealer has blackjack (net 0)', G.phase === 'done' && G.bank === 1000 && net(G) === 0); }
{ const G = rig('std', [9, A, 8, 7, 2]); C.deal(G, 10); C.insure(G, true);
  t('insurance lost when dealer has no blackjack, play continues', G.phase === 'play' && G.bank === 985); }
{ const G = rig('std', [9, A, 8, 7]); C.deal(G, 10); C.insure(G, false);
  t('declined insurance costs nothing', G.phase === 'play' && G.bank === 990); }
{ const G = rig('std', [A, A, K, K]); C.deal(G, 10); C.insure(G, false);
  t('player and dealer blackjack push', G.hands[0].res === 'push' && G.bank === 1000); }

// --- hit / stand / bust ---
{ const G = rig('std', [10, 6, 6, 10, 9]); C.deal(G, 10); C.act(G, 'hit');
  t('player bust loses immediately; dealer does not draw', G.phase === 'done' && G.hands[0].res === 'bust' && G.dealer.length === 2 && G.bank === 990); }
{ const G = rig('std', [10, 6, 6, 10, K, K]); C.deal(G, 10); C.act(G, 'hit');
  t('player busts first and loses even though dealer would bust', G.hands[0].res === 'bust'); }
{ const G = rig('std', [10, 6, 7, 10, K]); C.deal(G, 10); C.act(G, 'stand');
  t('dealer hits 16 and busts -> player wins 1:1', G.hands[0].res === 'win' && G.bank === 1010 && G.dealer.length === 3); }
{ const G = rig('std', [10, 10, 8, 8]); C.deal(G, 10); C.act(G, 'stand');
  t('18 vs 18 pushes', G.hands[0].res === 'push' && G.bank === 1000); }
{ const G = rig('std', [5, 5, 6, 6, 10]); C.deal(G, 10); C.act(G, 'hit');
  t('reaching 21 by hitting auto-stands', G.phase === 'done'); }

// --- dealer S17 / H17 ---
{ const G = rig('std', [10, A, 8, 6, 5]); C.deal(G, 10); C.insure(G, false); C.act(G, 'stand');
  t('S17: dealer stands on soft 17', G.dealer.length === 2 && G.hands[0].res === 'win'); }
{ const G = rig('strict', [10, A, 8, 6, 3]); C.deal(G, 10); C.insure(G, false); C.act(G, 'stand');
  t('H17: dealer hits soft 17', G.dealer.length === 3 && C.hval(G.dealer).t === 20 && G.hands[0].res === 'lose'); }
{ const G = rig('strict', [10, 10, 8, 7, 5]); C.deal(G, 10); C.act(G, 'stand');
  t('H17: dealer stands on hard 17', G.dealer.length === 2); }

// --- double ---
{ const G = rig('std', [6, 6, 5, 10, 10, 10]); C.deal(G, 10); C.act(G, 'dbl');
  t('double: one card only, bet doubled, pays 2x', G.hands[0].c.length === 3 && G.hands[0].bet === 20 && G.bank === 1020); }
{ const G = rig('std', [2, 6, 3, 10, 4]); C.deal(G, 10); C.act(G, 'hit');
  t('double only on first two cards', !C.legal(G).dbl); }
{ const G = rig('std', [6, 6, 5, 10], 15); C.deal(G, 10); const L = C.legal(G);
  t('cannot double without enough points (reason shown)', !L.dbl && L.why.dbl === '點數不足'); }

// --- split ---
{ const G = rig('std', [8, 6, 8, 10, 3, 10, 2]); C.deal(G, 10);
  t('8,8 can split', C.legal(G).split);
  C.act(G, 'split');
  t('split makes two hands, each 10', G.hands.length === 2 && G.hands.every(h => h.bet === 10) && G.bank === 980);
  t('first split hand receives its second card', G.hands[0].c.length === 2 && G.hands[1].c.length === 1);
  t('DAS allowed in standard rules', C.legal(G).dbl); }
{ const G = rig('std', [K, 6, Q, 10]); C.deal(G, 10); t('K,Q (both 10 points) can split', C.legal(G).split); }
{ const G = rig('std', [9, 6, 8, 10]); C.deal(G, 10); t('9,8 cannot split', !C.legal(G).split && !C.legal(G).pair); }
{ const G = rig('strict', [8, 6, 8, 10, 3]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G); t('strict: no double after split', !L.dbl && L.why.dbl === '分牌後不可加倍'); }
{ const G = rig('std', [8, 6, 8, 10, 8, 8, 8, 2, 2, 2, 2, 2, 2]); C.deal(G, 10);
  C.act(G, 'split'); C.act(G, 'split'); C.act(G, 'split');
  t('standard: split up to 4 hands', G.hands.length === 4);
  const L = C.legal(G); t('no 5th hand (reason shown)', !L.split && L.why.split === '已達 4 手上限'); }
{ const G = rig('strict', [8, 6, 8, 10, 8]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G); t('strict: split only once', G.hands.length === 2 && !L.split && L.why.split === '只能分一次'); }
{ const G = rig('std', [8, 6, 8, 10], 15); C.deal(G, 10); const L = C.legal(G);
  t('cannot split without enough points (reason shown)', !L.split && L.why.split === '點數不足'); }
{ // split hands are played in order; dealer plays once
  const G = rig('std', [8, 6, 8, 10, 10, 9, 10]); C.deal(G, 10); C.act(G, 'split');
  t('current hand pointer starts at hand 0', G.cur === 0);
  C.act(G, 'stand'); t('after standing, hand 1 receives its card and becomes current', G.cur === 1 && G.hands[1].c.length === 2);
  C.act(G, 'stand'); t('dealer stands on 16? no: dealer hits 16 to 26 and busts, both hands win', G.phase === 'done' && G.hands.every(h => h.res === 'win') && G.bank === 1020); }

// --- split aces ---
{ const G = rig('std', [A, 6, A, 10, K, 5, 10]); C.deal(G, 10); C.act(G, 'split');
  t('split aces: each hand gets one card and is finished', G.phase === 'done' && G.hands.every(h => h.c.length === 2));
  t('split A + K = 21 pays 1:1, not 3:2', G.hands[0].res === 'win' && G.hands[0].pay === 20); }
{ const G = rig('std', [A, 6, A, 10, A, 5, 10]); C.deal(G, 10); C.act(G, 'split');
  t('standard: no resplit of aces', G.hands.length === 2 && G.phase === 'done'); }
{ const G = rig('easy', [A, 6, A, 10, A, 5, 9, 4, 10]); C.deal(G, 10); C.act(G, 'split');
  const L = C.legal(G);
  t('easy: may resplit aces, no hit/double on split aces', G.phase === 'play' && L.split && !L.hit && !L.dbl);
  C.act(G, 'split'); t('resplit aces makes 3 hands', G.hands.length === 3); }

// --- surrender ---
{ const G = rig('easy', [10, 10, 6, 7]); C.deal(G, 10);
  t('easy: late surrender available on first two cards', C.legal(G).sur);
  C.act(G, 'sur'); t('surrender returns half the bet', G.phase === 'done' && G.hands[0].res === 'sur' && G.bank === 995); }
{ const G = rig('std', [10, 10, 6, 7]); C.deal(G, 10); t('standard: no surrender', !C.legal(G).sur); }
{ const G = rig('easy', [10, 10, 6, A]); C.deal(G, 10);
  t('late surrender: dealer blackjack settles before surrender is possible', G.phase === 'done' && G.bank === 990); }
{ const G = rig('easy', [4, 10, 2, 7, 2]); C.deal(G, 10); C.act(G, 'hit'); t('no surrender after hitting', !C.legal(G).sur); }

// --- basic strategy tables vs an independently written chart (dealer 2..10,A) ---
const CH = {
  std: {
    hard: { 8: 'HHHHHHHHHH', 9: 'HDDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDH', 12: 'HHSSSHHHHH', 13: 'SSSSSHHHHH', 14: 'SSSSSHHHHH', 15: 'SSSSSHHHHH', 16: 'SSSSSHHHHH', 17: 'SSSSSSSSSS' },
    soft: { 2: 'HHHDDHHHHH', 3: 'HHHDDHHHHH', 4: 'HHDDDHHHHH', 5: 'HHDDDHHHHH', 6: 'HDDDDHHHHH', 7: 'SDDDDSSHHH', 8: 'SSSSSSSSSS', 9: 'SSSSSSSSSS' },
    pair: { 2: 'PPPPPPHHHH', 3: 'PPPPPPHHHH', 4: 'HHHPPHHHHH', 5: 'DDDDDDDDHH', 6: 'PPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPSPPSS', 10: 'SSSSSSSSSS', 1: 'PPPPPPPPPP' } },
  strict: {
    hard: { 8: 'HHHHHHHHHH', 9: 'HDDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDD', 12: 'HHSSSHHHHH', 13: 'SSSSSHHHHH', 16: 'SSSSSHHHHH', 17: 'SSSSSSSSSS' },
    soft: { 2: 'HHHDDHHHHH', 6: 'HDDDDHHHHH', 7: 'DDDDDSSHHH', 8: 'SSSSDSSSSS', 9: 'SSSSSSSSSS' },
    pair: { 2: 'HHPPPPHHHH', 3: 'HHPPPPHHHH', 4: 'HHHHHHHHHH', 6: 'HPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPP', 9: 'PPPPPSPPSS', 1: 'PPPPPPPPPP' } },
  easy: { // like std plus late surrender
    hard: { 14: 'SSSSSHHHHH', 15: 'SSSSSHHHRH', 16: 'SSSSSHHRRR', 17: 'SSSSSSSSSS' },
    pair: { 8: 'PPPPPPPPPP' } } };
const UPS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
function hardCards(t) { return t <= 11 ? [2, t - 2] : t <= 19 ? [10, t - 10] : [10, 9, t - 19]; }
let chartN = 0;
for (const rk of Object.keys(CH)) {
  const R = C.RULES[rk];
  for (const [kind, rows] of Object.entries(CH[rk])) for (const [k, row] of Object.entries(rows)) UPS.forEach((u, i) => {
    let cs; if (kind === 'hard') { cs = hardCards(+k); if (cs[0] === cs[1]) cs = [cs[0] - 1, cs[1] + 1]; } else if (kind === 'soft') cs = [A, +k]; else cs = [+k, +k];
    const pair = kind === 'pair', got = C.strat(R, cs.map(x => c(x)), u, true, pair, R.sur);
    chartN++; t(`${rk} ${kind} ${k} vs ${u === 1 ? 'A' : u}: chart ${row[i]} got ${got}`, got === row[i]);
  });
}
t('3-card hard 11 hits (cannot double)', C.strat(C.RULES.std, [c(2), c(4), c(5)], 6, false, false, false) === 'H');
t('3-card soft 18 vs 4 stands (Ds -> S)', C.strat(C.RULES.std, [c(A), c(3), c(4)], 4, false, false, false) === 'S');
t('8,8 vs A in H17 with surrender -> R', C.strat(Object.assign({}, C.RULES.strict, { sur: true }), [c(8), c(8)], 1, true, true, true) === 'R');
t('8,8 at split cap plays as hard 16', C.strat(C.RULES.std, [c(8), c(8)], 10, true, false, false) === 'H');
// coach (advise) on live states
{ const G = rig('std', [10, 6, 6, 10]); C.deal(G, 10); t('coach: hard 16 vs 6 -> stand', C.advise(G) === 'stand'); }
{ const G = rig('std', [10, 10, 6, 7]); C.deal(G, 10); t('coach: hard 16 vs 10 -> hit (no surrender in std)', C.advise(G) === 'hit'); }
{ const G = rig('easy', [10, 10, 6, 7]); C.deal(G, 10); t('coach: hard 16 vs 10 -> surrender in easy', C.advise(G) === 'sur'); }
{ const G = rig('std', [8, 10, 8, 7]); C.deal(G, 10); t('coach: 8,8 vs 10 -> split', C.advise(G) === 'split'); }
{ const G = rig('std', [8, 10, 8, 7], 15); C.deal(G, 10); t('coach: 8,8 without points to split -> hit', C.advise(G) === 'hit'); }
{ const G = rig('std', [6, 6, 5, 10], 15); C.deal(G, 10); t('coach: 11 vs 6 without points to double -> hit', C.advise(G) === 'hit'); }

// --- endless scoring: payouts conserve points ---
{ const G = C.newGame('std', 2024, 1e9); let ok = true;
  for (let i = 0; i < 20000; i++) { const b0 = G.bank; C.deal(G, 10 + (i % 50) * 10); if (G.phase === 'ins') C.insure(G, i % 3 === 0); while (G.phase === 'play') C.act(G, C.advise(G));
    if (G.bank - b0 !== G.net) ok = false; G.ev.length = 0; }
  t('20,000 random rounds: bank change equals round net', ok); }
t('simulate is deterministic for a seed', JSON.stringify(C.simulate('std', 2000, 3)) === JSON.stringify(C.simulate('std', 2000, 3)));

// ---------------- browser regressions (real page, mobile context) ----------------
// seeds for window.__game.seed(n) (standard rules; the shoe depends on the seed only)
function findSeed(pred) { for (let s = 1; s < 50000; s++) { const G = C.newGame('std', s, 1e6); C.deal(G, 10); if (pred(G)) return s; } throw new Error('no seed'); }
const SEED = {
  win: 15, bust: 8, ins: 14, split4: 63,
  // three hits in a row stay below 21 (for the rapid-tap queue test)
  hit3: findSeed(G => { if (G.phase !== 'play' || C.cval(G.dealer[0]) === 1) return false; const H = structuredClone(G); for (let i = 0; i < 3; i++) { if (H.phase !== 'play') return false; C.act(H, 'hit'); } return H.phase === 'play' && C.hval(H.hands[0].c).t < 21; }),
  // the coach would hit, so standing is a deviation (coach note shown)
  dev: findSeed(G => G.phase === 'play' && C.advise(G) === 'hit' && C.cval(G.dealer[0]) !== 1),
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: o.scheme || 'dark' });
    if (o.settings !== null) await ctx.addInitScript(s => { if (!localStorage.getItem('test:init')) { localStorage.clear(); localStorage.setItem('blackjack:settings', JSON.stringify(s)); localStorage.setItem('test:init', '1'); } }, Object.assign({ snd: false, vib: false, quick: true, toast: true }, o.settings || {}));
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'x' + h + ' pageerror ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' console ' + m.text()); });
    await page.goto(APP); await page.waitForFunction(() => window.__game && !document.querySelector('#ovTitle').hidden);
    return { ctx, page, cdp: await ctx.newCDPSession(page) };
  }
  const st = P => P.page.evaluate(() => window.__game.state());
  const idle = (P, cond = 'true') => P.page.waitForFunction(new Function('const s=window.__game.state();return !!s&&!s.busy&&(' + cond + ')'), null, { timeout: 30000, polling: 30 });
  const click = (P, sel) => P.page.evaluate(s => { const e = document.querySelector(s); if (!e) throw new Error('missing ' + s); e.click(); }, sel);
  const ls = (P, k) => P.page.evaluate(k => JSON.parse(localStorage.getItem('blackjack:' + k) || 'null'), k);
  // Reload only after the page's localStorage has reached the browser's storage backend (seen from a second page of
  // the same file:// origin). Without this, a reload right after a write can, under heavy load, lose the write in
  // Chromium itself (DOM storage commits are batched): the app has already saved, the test just must not race it.
  const snap = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); };
  const reload = async P => {
    if (!P.peer) { P.peer = await P.ctx.newPage(); await P.peer.goto('file://' + __filename); }
    // poll until the backend (peer page) shows the same storage as the page itself
    for (let i = 0, t0 = Date.now(); ; i++) { const [x, y] = [await P.page.evaluate(snap), await P.peer.evaluate(snap)]; if (x === y) break; if (Date.now() - t0 > 30000) throw new Error('localStorage never reached the peer page'); await sleep(20); }
    await P.page.reload(); await P.page.waitForFunction(() => window.__game && !document.querySelector('#ovTitle').hidden, null, { timeout: 30000 }); };
  // each browser section runs on its own: an exception (e.g. a wait timing out) is a failed check, not a crash
  async function section(name, fn) { const ctxs = []; try { await fn(ctxs); } catch (e) { t(name + ' (threw: ' + String(e && e.message || e).split('\n')[0] + ')', false); } finally { for (const c of ctxs) await c.close().catch(() => {}); } }
  const ACT = a => `#pAct .btn[data-a="${a}"]`;
  async function bet(P, amt) { for (const d of [500, 100, 25, 10]) while (amt >= d) { await P.page.evaluate(v => { const b = document.querySelector('.chip[data-v="' + v + '"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); }, d); amt -= d; } }
  async function dealSeed(P, seed, amt) { await idle(P); await P.page.evaluate(n => window.__game.seed(n), seed); await bet(P, amt); await click(P, '#bDeal'); await idle(P); return st(P); }
  async function playOut(P) { let s = await st(P); while (s.phase !== 'done' && s.phase !== 'bet') { await click(P, s.phase === 'ins' ? '#bInsN' : ACT(s.advice)); await idle(P); s = await st(P); } return s; }
  async function tapXY(P, x, y, hold = 50) { await P.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(hold); await P.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  async function tap(P, sel, hold) { const b = await P.page.locator(sel).first().boundingBox(); await tapXY(P, b.x + b.width / 2, b.y + b.height / 2, hold); }
  const rect = (P, sel) => P.page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
  const hit = (a, b) => a && b && a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;

  // 1. a settled round is saved at once: reload during the result animation keeps the win / the loss
  await section('main flow', async ctxs => { const P = await open(390, 844); ctxs.push(P.ctx); await click(P, '#tGo'); await idle(P);
    let s = await dealSeed(P, SEED.win, 100); const statsBefore = (await ls(P, 'stats') || {}).hands || 0;
    // the save is checked in the same task as the tap, so it is known to happen before the result animation (no timing)
    const core = await P.page.evaluate(sel => { document.querySelector(sel).click(); const s = window.__game.state(), ss = JSON.parse(localStorage.getItem('blackjack:session')), st = JSON.parse(localStorage.getItem('blackjack:stats'));
      return Object.assign(s, { savedBank: ss && ss.bank, savedHands: st && st.hands }); }, ACT('stand'));
    t('seed 15 stand wins in the core', core.hands[0].res === 'win');
    t('result and stats are saved at the tap, while the result animation is still running', core.busy && core.savedBank === core.bank && core.savedHands === statsBefore + 1);
    // reload while the result is (normally) still animating
    await reload(P);
    t('title offers to continue with the won points', (await P.page.textContent('#tGo')).includes((core.bank).toLocaleString('en-US')));
    await click(P, '#tGo'); await idle(P); s = await st(P);
    t('reload right after a win keeps the win (no void, no refund)', s.bank === core.bank && s.phase === 'bet');
    t('stats were saved before the result animation', ((await ls(P, 'stats')) || {}).hands === statsBefore + 1);
    // bust then reload: the lost bet stays lost
    s = await dealSeed(P, SEED.bust, 100); const b0 = s.bank + 100;
    const c2 = await P.page.evaluate(sel => { document.querySelector(sel).click(); return window.__game.state(); }, ACT('hit'));
    await reload(P); await click(P, '#tGo'); await idle(P); s = await st(P);
    t('reload right after a bust does not refund the bet', c2.hands[0].res === 'bust' && s.bank === b0 - 100);
    // mid-hand reload resumes the same round
    s = await dealSeed(P, SEED.bust, 100); const mid = s;
    await reload(P);
    t('title says a round is in progress', (await P.page.textContent('#tGo')).includes('這手未完'));
    await click(P, '#tGo'); await idle(P); s = await st(P);
    t('mid-hand reload resumes the same round with the bet still on the table', s.phase === 'play' && s.bank === mid.bank && JSON.stringify(s.hands) === JSON.stringify(mid.hands) && JSON.stringify(s.dealer) === JSON.stringify(mid.dealer));
    t('resumed round shows its cards', await P.page.evaluate(() => document.querySelectorAll('#pz .card').length === 2 && document.querySelectorAll('#dh .card').length === 2));
    await click(P, ACT('hit')); await idle(P); s = await st(P);
    t('resumed round can be finished (bust loses the bet)', s.phase === 'done' && s.bank === mid.bank);
    // insurance prompt survives a reload
    s = await dealSeed(P, SEED.ins, 100); t('seed 14 offers insurance', s.phase === 'ins');
    await reload(P);
    // record, at the moment the bubble appears, whether the arc is dimmed (no dependence on how long the bubble stays)
    await P.page.evaluate(() => { window.__bubLog = []; const b = document.querySelector('#bub'); new MutationObserver(() => { if (b.classList.contains('on')) window.__bubLog.push(document.querySelector('#table').classList.contains('bub')); }).observe(b, { attributes: true, attributeFilter: ['class'] }); });
    await click(P, '#tGo'); await idle(P); s = await st(P);
    t('insurance prompt is restored after reload', s.phase === 'ins' && !(await P.page.isHidden('#pIns')));
    // r2 #4: the conductor's bubble dims the rules arc instead of sitting on top of it
    t('bubble dims the rules arc', await P.page.evaluate(() => window.__bubLog.length > 0 && window.__bubLog.every(Boolean)));
    await playOut(P);
    // 4. records per rule set
    const best = await ls(P, 'best');
    t('records are kept per rule set', best.by && best.by.std && best.by.std.bank >= 1000 && !(best.by.easy && best.by.easy.bank > 1000));
    t('HUD shows the current rule set record', (await P.page.textContent('#hBL')) === '標準紀錄');
    // 7. one tap re-deals the same bet
    s = await st(P);
    t('deal button offers the same bet again', (await P.page.textContent('#bDealT')) === '同注發牌' && s.betAmt === 0);
    await click(P, '#bDeal'); await idle(P); s = await st(P);
    t('one tap re-deals the last bet', s.phase !== 'bet' && s.hands[0].bet === s.lastBet);
    // 12. menu during a hand explains why
    if (s.phase === 'play' || s.phase === 'ins') { await click(P, '#bMenu'); t('menu during a hand shows a hint', /等這手結束/.test(await P.page.textContent('#toast')) && await P.page.isHidden('#ovTitle')); }
    await playOut(P);
    // 11. split to 4 hands: bet circle shows the total, each hand shows its own bet
    s = await dealSeed(P, SEED.split4, 10);
    while (s.phase === 'play') { await click(P, ACT(s.legal.split ? 'split' : 'stand')); await idle(P); s = await st(P); if (s.hands.length === 4) break; }
    t('seed 63 splits to 4 hands', s.hands.length === 4);
    t('bet circle shows the total of all hands', (await P.page.textContent('#bAmt')) === '押分 40');
    t('each hand shows its own bet', await P.page.evaluate(() => [...document.querySelectorAll('#pz .tag')].every(e => e.textContent === '押 10')));
    await playOut(P);
    // 6. taps during the card animation are queued, not dropped (default speed)
    await P.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('blackjack:settings')); s.quick = false; localStorage.setItem('blackjack:settings', JSON.stringify(s)); });
    await reload(P); await click(P, '#tGo'); await idle(P);
    s = await dealSeed(P, SEED.hit3, 10);
    for (let i = 0; i < 3; i++) { await tap(P, ACT('hit')); await sleep(125); }
    await idle(P); s = await st(P);
    t('3 hit taps at 8/s give 3 cards', s.hands[0].c.length === 5);
    s = await playOut(P);
    // r2 #1: after splitting to 4 hands, stand taps at 8/s while the next hand is being dealt are queued, one per hand
    s = await dealSeed(P, SEED.split4, 10);
    while (s.phase === 'play' && s.hands.length < 4) { await tap(P, ACT(s.legal.split ? 'split' : 'stand')); await idle(P); s = await st(P); }
    { const left = s.hands.length - s.cur, curs = [];
      for (let i = 0; i < left; i++) { curs.push((await st(P)).cur); await tap(P, ACT('stand'), 40); await sleep(85); }
      await idle(P); s = await st(P);
      t(`${left} stand taps at 8/s on split hands stand every hand (some taps during a hand change: ${curs.join(',')})`, left >= 3 && s.phase === 'done' && s.hands.every(h => h.c.length === 2)); }
    // 13. coach note does not cover the bet circle or the buttons
    s = await playOut(P); s = await dealSeed(P, SEED.dev, 10);
    // r2 #5: while the dealer plays out the round, the (disabled) action buttons stay; the chips come back after the result
    const hold = await P.page.evaluate(sel => { document.querySelector(sel).click(); const s = window.__game.state(), q = x => document.querySelector(x);
      return { done: s.phase === 'done' && s.busy, act: !q('#pAct').hidden, bet: !q('#pBet').hidden, dis: [...document.querySelectorAll('#pAct .btn')].every(b => b.disabled) }; }, ACT('stand'));
    t('action row stays (disabled) while the dealer plays, chips hidden', hold.done && hold.act && !hold.bet && hold.dis);
    // (the coach note is written in the same task as the tap; no wait needed)
    // r2 #3: the coach note sits in the hint row under the action buttons, not over the HUD
    const cr = await rect(P, '#actHint');
    t('coach note is shown after a deviation', /教練/.test(await P.page.textContent('#actHint')) && !(await P.page.evaluate(() => document.querySelector('#toast').classList.contains('on'))));
    t('coach note covers neither the HUD, the bet circle nor the cards', !hit(cr, await rect(P, '.hud')) && !hit(cr, await rect(P, '#bc')) && !hit(cr, await rect(P, '#pz')) && !hit(cr, await rect(P, '#pAct .row')));
    await idle(P);
    t('chips come back once the result has been shown', !(await P.page.isHidden('#pBet')) && await P.page.isHidden('#pAct'));
    // 8. chip: a short press adds once; holding repeats
    await click(P, '#bClr');
    const pd = (type) => P.page.evaluate(ty => document.querySelector('.chip[data-v="10"]').dispatchEvent(new PointerEvent(ty, { bubbles: true })), type);
    await P.page.evaluate(() => { const c = document.querySelector('.chip[data-v="10"]'); c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); });
    t('short chip press adds one chip', (await st(P)).betAmt === 10);
    await pd('pointerdown'); await P.page.waitForFunction(() => window.__game.state().betAmt > 30, null, { timeout: 30000 }); await pd('pointerup');
    const held = (await st(P)).betAmt; await sleep(300);
    t('holding a chip repeats and stops on release', held > 30 && (await st(P)).betAmt === held);
    t('chip repeat starts after about half a second', /,\s*550\)/.test(html.match(/pointerdown',function\(e\)\{[^\n]*/)[0]));
    // 3. confirmations
    await P.page.evaluate(() => document.querySelector('#bMenu').click()); await P.page.waitForFunction(() => !document.querySelector('#ovTitle').hidden);
    await click(P, '#tStats'); const h0 = (await ls(P, 'stats')).hands;
    await click(P, '#stReset'); t('clear stats asks first', !(await P.page.isHidden('#ovAsk')) && (await ls(P, 'stats')).hands === h0 && h0 > 0);
    await click(P, '#aNo'); t('cancel keeps stats', (await ls(P, 'stats')).hands === h0);
    await click(P, '#stReset'); await click(P, '#aYes'); t('confirm clears stats, keeps achievements', (await ls(P, 'stats')).hands === 0 && (await ls(P, 'stats')).ach);
    t('stats list at least 10 achievements', await P.page.evaluate(() => document.querySelectorAll('#achL .ach').length >= 10));
    await P.page.evaluate(() => document.querySelector('#ovStats [data-close]').click());
    const bank0 = (await ls(P, 'session')).bank;
    await click(P, '#tNew'); t('restart asks first', !(await P.page.isHidden('#ovAsk')) && (await ls(P, 'session')).bank === bank0);
    await click(P, '#aNo'); t('cancel keeps the run', (await ls(P, 'session')).bank === bank0 && !(await P.page.isHidden('#ovTitle')));
    // 10. quick mode from the title
    const q0 = (await ls(P, 'settings')).quick; await click(P, '#tQuick');
    t('quick mode can be switched on the title screen', (await ls(P, 'settings')).quick === !q0);
    // 12. practice score label
    await click(P, '#tPrac'); t('practice score says 累計 (all-time)', /^累計：/.test(await P.page.textContent('#pqScore')));
    await P.page.evaluate(() => document.querySelector('#ovPrac [data-close]').click());
    // 9. 長途旅客 needs meaningful bets
    for (const [wag, want] of [[99 * 10, false], [99 * 60, true]]) {
      await P.page.evaluate(w => { const s = JSON.parse(localStorage.getItem('blackjack:session')); s.hands = 99; s.wag = w; s.un = 99; s.u = w > 1000 ? 30 : -50; s.g = null; s.bank = 5000; localStorage.setItem('blackjack:session', JSON.stringify(s)); const st = JSON.parse(localStorage.getItem('blackjack:stats')); delete st.ach.h100; localStorage.setItem('blackjack:stats', JSON.stringify(st)); }, wag);
      await reload(P); await click(P, '#tGo'); await idle(P); await dealSeed(P, SEED.win, 10); await playOut(P);
      t(`長途旅客 after 100 hands with ${wag / 99} average: ${want ? 'granted' : 'not granted'}`, !!(await ls(P, 'stats')).ach.h100 === want);
      t('百手後 points still saved (old key)', (await ls(P, 'best')).by.std.h100 > 0);
    }
    // r2 #2: the 100-hand record is the average return per hand (independent of bet size), best kept per rule set
    { const roi = (await ls(P, 'best')).by.std.roi;
      t('百手投報率 record = best average return per hand over 100 hands', typeof roi === 'number' && roi > 25 && roi < 35);
      await P.page.evaluate(() => document.querySelector('#bMenu').click()); await P.page.waitForFunction(() => !document.querySelector('#ovTitle').hidden);
      t('title shows the 百手投報率 record', (await P.page.textContent('#rsRec')).includes('百手投報率 +' + roi.toFixed(1) + '%'));
      t('longest by-the-book streak is recorded', (await ls(P, 'stats')).cfBest > 0); }
    // 2 + 5. daily challenge progress is saved; only the first attempt of the day counts
    await P.page.evaluate(() => document.querySelector('#bMenu').click()); await P.page.waitForFunction(() => !document.querySelector('#ovTitle').hidden);
    await click(P, '#tDaily'); await idle(P);
    for (let i = 0; i < 3; i++) { await bet(P, 25); await click(P, '#bDeal'); await idle(P); await playOut(P); }
    s = await st(P); await reload(P);
    t('title offers to continue the daily challenge', (await P.page.textContent('#tDaily')).includes('繼續每日挑戰（3 / 50）'));
    t('the daily challenge comes first on the title after playing it', await P.page.evaluate(() => document.querySelector('.menu').firstElementChild.id === 'tDaily'));
    await click(P, '#tDaily'); await idle(P); let d = await st(P);
    t('daily progress survives reload', d.mode === 'daily' && d.played === 3 && d.bank === s.bank);
    await P.page.evaluate(() => document.querySelector('#bMenu').click()); await P.page.waitForFunction(() => !document.querySelector('#ovTitle').hidden);
    t('daily progress survives going back to the menu', (await P.page.textContent('#tDaily')).includes('3 / 50'));
    // jump to the last hand, finish: the day's score is recorded
    await P.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('blackjack:daily')); s.played = 49; localStorage.setItem('blackjack:daily', JSON.stringify(s)); });
    await click(P, '#tDaily'); await idle(P); await bet(P, 25); await click(P, '#bDeal'); await idle(P); d = await playOut(P);
    await P.page.waitForFunction(() => !document.querySelector('#ovEnd').hidden);
    const today = await P.page.evaluate(() => { const d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); });
    const rec = (await ls(P, 'stats')).daily[today];
    t('first daily attempt records the score', rec === d.bank && (await ls(P, 'daily')) === null);
    await click(P, '#eGo'); await idle(P);
    t('replay is marked as practice', (await P.page.textContent('#hHL')) === '練習');
    await P.page.evaluate(() => { const s = JSON.parse(localStorage.getItem('blackjack:daily')); s.played = 49; s.bank = 99999; localStorage.setItem('blackjack:daily', JSON.stringify(s)); });
    await reload(P); await click(P, '#tDaily'); await idle(P); await bet(P, 25); await click(P, '#bDeal'); await idle(P); await playOut(P);
    await P.page.waitForFunction(() => !document.querySelector('#ovEnd').hidden);
    t('practice does not change the day\'s score', (await ls(P, 'stats')).daily[today] === rec);
    // a saved challenge from another day is dropped
    await P.page.evaluate(() => localStorage.setItem('blackjack:daily', JSON.stringify({ day: '2000-1-1', rk: 'std', bank: 900, seed: 1, played: 7 })));
    await click(P, '#eMenu');
    t('daily save from another day is cleared', !(await P.page.textContent('#tDaily')).includes('繼續') && (await ls(P, 'daily')) === null);
    // r2 #6: last 7 days of daily scores in the stats
    await click(P, '#tStats');
    t('stats list the last 7 daily challenges with today\'s score', await P.page.evaluate(() => document.querySelectorAll('#stD .dl').length === 7) && (await P.page.textContent('#stD .dl')).includes(rec.toLocaleString('en-US')));
    await P.page.evaluate(() => document.querySelector('#ovStats [data-close]').click());
    // old-format session (no table state) still loads
    await P.page.evaluate(() => localStorage.setItem('blackjack:session', JSON.stringify({ rk: 'std', bank: 1234, seed: 5, shoeN: 0, pos: 40, hands: 12, peak: 1500, last: 25 })));
    await reload(P); await click(P, '#tGo'); await idle(P); s = await st(P);
    t('old-format session loads', s.bank === 1234 && s.lastBet === 25 && (await P.page.textContent('#hHands')) === '12');
  });

  // 14. theme follows the system by default
  await section('theme', async ctxs => { const P = await open(390, 844, { scheme: 'light', settings: null }); ctxs.push(P.ctx);
    t('default theme follows the system (light)', await P.page.evaluate(() => document.documentElement.dataset.theme) === 'light'); });

  // 15-17. layout: 4 split hands and long hands fit at every size; the arc never sits under the cards
  // one page resized between sizes (also checks that a resize / rotation re-lays the table out)
  await section('layout', async ctxs => { const P = await open(375, 500); ctxs.push(P.ctx); await click(P, '#tGo'); await idle(P);
  for (const [w, h, scens] of [[375, 500, ['long', 'split4']], [360, 640, ['split4']], [640, 360, ['split4']], [844, 390, ['split4']]]) {
    await P.page.setViewportSize({ width: w, height: h }); await sleep(250);
    for (const scen of scens) {
      let s = await dealSeed(P, scen === 'split4' ? SEED.split4 : SEED.hit3, 10);
      if (scen === 'split4') while (s.phase === 'play' && s.hands.length < 4) { await click(P, ACT(s.legal.split ? 'split' : 'stand')); await idle(P); s = await st(P); }
      else { for (let i = 0; i < 3; i++) { await click(P, ACT('hit')); await idle(P); } s = await st(P); }
      await P.page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('#table') && a.effect.getTiming().iterations !== Infinity), null, { timeout: 30000, polling: 50 }); // layout transitions settled
      const g = await P.page.evaluate(() => {
        const R = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width }; };
        const T = R(document.querySelector('#table')), arc = document.querySelector('#arc'), A = arc.style.display === 'none' ? null : R(arc);
        const hands = [...document.querySelectorAll('#pz .hw')].map(e => ({ box: R(e.querySelector('.hand')), pill: R(e.querySelector('.pill')), tag: R(e.querySelector('.tag')), cards: [...e.querySelectorAll('.card')].map(R) }));
        return { T, A, hands, bc: R(document.querySelector('#bc')), dz: R(document.querySelector('#dh')) };
      });
      const inT = r => r.l >= g.T.l - 1 && r.r <= g.T.r + 1 && r.t >= g.T.t - 1 && r.b <= g.T.b + 1;
      const tag = `${w}x${h} ${scen}`;
      t(`${tag}: all cards and points labels inside the table`, g.hands.every(x => x.cards.every(inT) && inT(x.pill)));
      t(`${tag}: hands do not overlap each other`, g.hands.every((a, i) => g.hands.every((b, j) => i >= j || !hit(a.box, b.box))));
      t(`${tag}: player cards and labels clear of the rules arc, dealer cards and bet circle`, g.hands.every(x => [x.box, x.pill, x.tag].every(r => !hit(r, g.A) && !hit(r, g.dz) && !hit(r, g.bc))));
      if (w === 375 && scen === 'long') t(`${tag}: long hand cards at least 44px wide`, g.hands.every(x => x.cards.length >= 5 && x.cards.every(c => c.w >= 44)));
      if (w === 844 && scen === 'split4') t(`${tag}: split cards at least 44px wide`, g.hands.every(x => x.cards.every(c => c.w >= 44)));
      await playOut(P);
    }
  }
  });
  await browser.close();
  t('no page or console errors in the browser tests', !errors.length); if (errors.length) console.log(errors.join('\n'));
}

(async () => {
  let pw = true; try { require.resolve('/opt/node22/lib/node_modules/playwright'); } catch (e) { pw = false; }
  if (pw && !process.argv.includes('--core')) await browserTests(); else console.log('(browser tests skipped)');
  console.log(`${pass} passed, ${fail} failed  (incl. ${chartN} strategy-chart cells)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL browser tests crashed: ' + (e && e.stack || e)); process.exit(1); });
