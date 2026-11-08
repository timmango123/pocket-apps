// Rule tests for 抽鬼牌 (old-maid). Extracts the engine between the CORE markers of ../index.html,
// checks every rule in the spec, then auto-plays 10000 rounds (all variants, all AI levels) checking
// card conservation, exactly one loser (two only in split double-joker), and no stalls.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const OM = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return OM;')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const C = s => { if (s === 'JK') return 52; if (s === 'JK2') return 53; const m = s.match(/^(10|[2-9AJQK])([SHDC])$/); return 'SHDC'.indexOf(m[2]) * 13 + OM.RK.indexOf(m[1]); };
const cs = s => s.split(' ').filter(Boolean).map(C);
const sorted = a => a.slice().sort((x, y) => x - y).join(',');
function mk(hands, o, turn) { // a state built from explicit hands
  const S = OM.newRound(1, o || {}, 0);
  S.hands = hands.map(cs); S.active = S.hands.map(h => h.length ? 1 : 0); S.out = []; S.losers = []; S.over = false; S.raised = [-1, -1, -1, -1]; S.turn = turn || 0; S.pile = [];
  return S;
}

// --- deck & deal ---
{
  const S = OM.newRound(42, {}, 0);
  ok(S.dealt.reduce((a, h) => a + h.length, 0) === 53, '53 cards dealt');
  ok(new Set([].concat(...S.dealt)).size === 53, 'all 53 distinct (52 + 1 joker)');
  ok(sorted(S.dealt.map(h => h.length)) === '13,13,13,14' && S.dealt[1].length === 14, 'dealt clockwise from dealer+1: that seat has 14, others 13');
  const S2 = OM.newRound(42, {}, 2); ok(S2.dealt[3].length === 14, 'dealer 2 → seat 3 gets 14');
  ok(JSON.stringify(OM.newRound(42, {}, 0).hands) === JSON.stringify(S.hands) && JSON.stringify(OM.newRound(43, {}, 0).hands) !== JSON.stringify(S.hands), 'seeded shuffle reproducible');
  ok(OM.deck({ double: true }).length === 54, 'double joker: 54 cards');
  ok(OM.deck({ quick: true }).length === 25 && OM.deck({ quick: true }).every(c => c === 52 || c % 13 < 6), 'quick: A–6 ×4 + joker = 25');
  // after the initial discard, every hand has at most one card of each rank and the joker is somewhere
  let okk = true; for (let s = 0; s < 300; s++) { const R = OM.newRound(s, {}, s % 4); R.hands.forEach(h => { const r = h.filter(c => c < 52).map(OM.rank); if (new Set(r).size !== r.length) okk = false; });
    if (R.hands.reduce((a, h) => a + h.length, 0) + R.pile.length * 2 !== 53) okk = false; if (!R.hands.some(h => h.includes(52))) okk = false; }
  ok(okk, 'initial discard: no pairs left in any hand, counts conserved, joker still in play (300 deals)');
}
// --- pair stripping ---
{
  let r = OM.strip(cs('5S 5H 5D 9C'), {}); ok(r.pairs.length === 1 && sorted(r.hand) === sorted(cs('5D 9C')), 'three of a kind: discard one pair, keep one');
  r = OM.strip(cs('7S 7H 7D 7C 2S'), {}); ok(r.pairs.length === 2 && sorted(r.hand) === sorted(cs('2S')), 'four of a kind: discard two pairs');
  r = OM.strip(cs('QS QH JK'), {}); ok(r.pairs.length === 1 && sorted(r.hand) === '52', 'pairs ignore suit colour by default; single joker never pairs');
  r = OM.strip(cs('QS QH'), { color: true }); ok(r.pairs.length === 0, 'colour variant: black Q and red Q do not pair');
  r = OM.strip(cs('QS QC QH QD'), { color: true }); ok(r.pairs.length === 2, 'colour variant: ♠♣ pair and ♥♦ pair');
  r = OM.strip(cs('3S 3H 3C'), { color: true }); ok(r.pairs.length === 1 && sorted(r.hand) === sorted(cs('3H')), 'colour variant: 3♠3♣ pair, 3♥ stays');
  r = OM.strip([52, 53], { double: true }); ok(r.pairs.length === 1, 'double joker: the two jokers pair');
  r = OM.strip([52, 53], {}); ok(r.pairs.length === 0, 'jokers do not pair outside double mode');
}
// --- draw target, pairing, going out, skipping ---
{
  let S = mk(['5S 9H', '5H KD', 'KS JK', '9D'], {}, 0);
  ok(OM.nextActive(S, 0) === 1 && OM.nextActive(S, 3) === 0, 'target = next seat clockwise');
  let ev = OM.draw(S, 0); // seat 0 draws 5H from seat 1
  ok(ev.t === 1 && ev.card === C('5H') && ev.pair && sorted(S.hands[0]) === sorted(cs('9H')), 'drawn card that matches is discarded at once');
  ok(S.turn === 1, 'turn passes to the player who was drawn from');
  S = mk(['5S', '', 'KS JK', '5H'], {}, 0);
  ok(OM.nextActive(S, 0) === 2 && OM.nextActive(S, 3) === 0, 'seats already out are skipped');
  S = mk(['5S 2D', '5H', 'KS JK', '2C KH'], {}, 0);
  ev = OM.draw(S, 0); ok(ev.outs.includes(1) && S.out[0] === 1 && !S.active[1], 'drawn down to 0 cards → safely out (target with 1 card is still drawn)');
  ok(S.turn === 2, 'next turn skips the seat that just went out');
  S = mk(['5S', '5H 9S', 'KS JK', '9C KH'], {}, 0);
  ev = OM.draw(S, 0); ok(ev.outs.includes(0) && S.out[0] === 0, 'emptying your hand by pairing → out');
  S = mk(['5S', '5H', 'JK 2S', '2H'], {}, 0);
  ev = OM.draw(S, 0); ok(sorted(ev.outs) === '0,1' && S.out[0] === 1 && S.out[1] === 0, 'both out on one draw: the drawn-from seat first');
  S = mk(['', '', 'JK', '5H'], {}, 2); S.active = [0, 0, 1, 1]; S.hands[3] = cs('5H'); S.hands[2] = cs('JK 5S');
  ev = OM.draw(S, 0); // seat 2 draws 5H from seat 3
  ok(ev.over && S.losers.length === 1 && S.losers[0] === 2 && sorted(S.hands[2]) === '52', 'end: the last one left holds the joker and loses');
  S = mk(['5S', '5H JK', '', ''], {}, 0); ev = OM.draw(S, 1);
  ok(ev.card === 52 && !ev.over && S.turn === 1, 'drawing the joker just keeps it');
  // scoring
  const T = mk(['', '', '', 'JK'], {}); T.out = [2, 0, 1]; T.losers = [3]; T.over = true;
  ok(JSON.stringify(OM.points(T)) === '[2,1,3,0]', 'points 3/2/1 by finishing order, joker holder 0');
  ok(JSON.stringify(OM.places(T)) === '[2,3,1,4]', 'places');
}
// --- double joker ending ---
{
  let S = mk(['JK 4S', 'JK2 4H', '', ''], { double: true }, 0); S.hands[1] = [53, C('4H')];
  let ev = OM.draw(S, 1); // 0 draws 4H → pairs 4S; only jokers remain, split
  ok(ev.over && sorted(S.losers) === '0,1', 'double joker split across two hands → both lose');
  ok(JSON.stringify(OM.points(S)) === '[0,0,0,0]', 'split losers both score 0');
  S = mk(['JK 4S', 'JK2', '4H', ''], { double: true }, 0); S.hands[1] = [53];
  ev = OM.draw(S, 0); ok(ev.pair && OM.isJ(ev.pair[0]) && ev.outs.includes(1), 'double joker: drawing the other joker pairs them');
}
// --- start rule ---
{
  let okk = true; for (let s = 0; s < 200; s++) { const R = OM.newRound(s, {}, s % 4); if (R.over) continue; let best = -1, bp = 0;
    for (let i = 1; i <= 4; i++) { const p = (R.dealer + i) % 4; if (R.hands[p].length > best) { best = R.hands[p].length; bp = p; } } if (R.turn !== OM.nextActive(R, bp)) okk = false; }
  ok(okk, 'default start: the seat after the player holding most cards');
  const st = new Set(); for (let s = 0; s < 200; s++) { const R = OM.newRound(s, { start: 'random' }, 0); if (!R.over) st.add(R.turn); }
  ok(st.size === 4, 'random start covers all seats');
}
// --- AI behaviours (hiding & picking are observable) ---
{
  const P = OM.blankProf(); P.z = [0, 0, 0, 0, 40];
  let fav = 0; for (let s = 0; s < 200; s++) { const A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 1, seed: s, prof: P }); if (OM.zone(A.order.indexOf(52), 10) === 4) fav++; }
  ok(fav === 200, '一般 hides the joker in the drawer\'s favourite zone');
  let z4 = 0; for (let s = 0; s < 2000; s++) { const A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 0, seed: s, prof: P }); if (OM.zone(A.order.indexOf(52), 10) === 4) z4++; if (A.raised >= 0) z4 = -1e9; }
  ok(z4 > 300 && z4 < 500, '新手 hides at random and never raises (' + z4 + '/2000 in zone 4)');
  const taker = OM.blankProf(); taker.rs = 30; taker.rt = 27;
  let A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S JK'), lvl: 2, seed: 1, prof: taker }); ok(A.how === 'raiseJ' && A.raised === 52, '高手 raises the joker for a drawer who takes raised cards');
  const avoider = OM.blankProf(); avoider.rs = 30; avoider.rt = 1; avoider.z = [2, 2, 30, 2, 2];
  A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 2, seed: 1, prof: avoider });
  ok(A.how === 'bait' && A.raised !== 52 && OM.zone(A.order.indexOf(52), 10) === 2, '高手 raises a decoy and hides the joker in the favourite zone for a drawer who avoids raised cards');
  let b = 0; for (let s = 0; s < 1000; s++) if (OM.pick({ n: 8, ri: 3, lvl: 0, seed: s }).idx === 3) b++;
  ok(b > 560 && b < 700, '新手 takes a raised card ~60%+ (' + b + '/1000)');
  b = 0; for (let s = 0; s < 1000; s++) if (OM.pick({ n: 8, ri: 3, lvl: 1, seed: s }).idx === 3) b++;
  ok(b > 200 && b < 300, '一般 takes a raised card ~25% (' + b + '/1000)');
  const liar = OM.blankProf(); liar.hr = 20; liar.hj = 15, honest = OM.blankProf(); honest.hr = 40; honest.hj = 0;
  ok(OM.pick({ n: 8, ri: 3, lvl: 2, seed: 5, hp: liar }).idx !== 3 && OM.pick({ n: 8, ri: 3, lvl: 2, seed: 5, hp: honest }).idx === 3, '高手 avoids a raised card from a holder whose raised cards were jokers, takes it otherwise');
  const own = OM.blankProf(); own.z = [9, 9, 0, 9, 9];
  ok(OM.zone(OM.pick({ n: 10, ri: -1, lvl: 2, seed: 3, own }).idx, 10) === 2, '高手 draws from its least used zone (unpredictable)');
  const f = l => { const c = { nervous: 0, calm: 0, smirk: 0 }; for (let s = 0; s < 1000; s++) c[OM.face({ lvl: l, hasJ: true, seed: s })]++; return c.nervous / 1000; };
  ok(f(0) === 1 && f(1) > 0.55 && f(1) < 0.75 && f(2) < 0.15, 'faces: 新手 honest, 一般 half honest, 高手 reversed (nervous with joker: ' + [f(0), f(1), f(2)].join(' / ') + ')');
}
// --- joker tracking & the 高手 holder's model of balancing drawers (release review 2026-11-08: levels barely mattered) ---
{
  // seat 0 draws the joker from seat 1: it lands at the end of seat 0's hand and every seat knows where it is
  const M = OM.newMatch(7, {}, 3); OM.startRound(M);
  let S = mk(['5S 9H', 'JK KD 2C', 'KS 4D', '9D 4C'], {}, 0);
  let ev = OM.draw(S, 0); OM.observe(M, ev);
  ok(ev.card === 52 && M.prof[0].jx === 2, 'drawn joker is tracked at the end of the drawer\'s hand (jx=' + M.prof[0].jx + ')');
  S.turn = 3; ev = OM.draw(S, 0); OM.observe(M, ev); // seat 3 draws index 0 (5S) from seat 0: the joker shifts left
  ok(M.prof[0].jx === 1, 'tracking follows later draws from that hand (jx=' + M.prof[0].jx + ')');
  const H = OM.blankProf(); H.jx = 3; H.jh = 2; H.jm = 0;
  let hit = 0; for (let s = 0; s < 300; s++) if (OM.pick({ n: 6, ri: -1, lvl: 2, seed: s, hp: H }).idx === 3) hit++;
  ok(hit < 300 * 0.25, '高手 mostly avoids the tracked joker (' + hit + '/300 draws took it)');
  let hit1 = 0; for (let s = 0; s < 300; s++) if (OM.pick({ n: 6, ri: -1, lvl: 1, seed: s, hp: H }).idx === 3) hit1++;
  let hit0 = 0; for (let s = 0; s < 300; s++) if (OM.pick({ n: 6, ri: -1, lvl: 0, seed: s, hp: H }).idx === 3) hit0++;
  ok(hit < hit1 && hit1 < hit0, 'tracking strength grows with level (新手 ' + hit0 + ' > 一般 ' + hit1 + ' > 高手 ' + hit + ')');
  const Hs = OM.blankProf(); Hs.jx = 3; Hs.jh = 0; Hs.jm = 6;   // a holder who re-sorts (洗混) breaks the tracking
  let hs = 0; for (let s = 0; s < 300; s++) if (OM.pick({ n: 6, ri: -1, lvl: 2, seed: s, hp: Hs }).idx === 3) hs++;
  ok(hs > 20, 'a holder whose order keeps changing is not tracked (' + hs + '/300)');
  const M2 = OM.newMatch(8, {}, 3); M2.prof[0].jx = 2; OM.startRound(M2); ok(M2.prof[0].jx === -1, 'tracking resets every deal');
  const B = OM.blankProf(); B.z = [3, 3, 0, 3, 3]; B.am = 6; B.fm = 0;
  let a = 0; for (let s = 0; s < 100; s++) { const A = OM.arrange({ hand: cs('2S 3S 4S 5S 6S 7S 8S 9S 10S JK'), lvl: 2, seed: s, prof: B }); if (A.how === 'anti' && OM.zone(A.order.indexOf(52), 10) === 2) a++; }
  ok(a === 100, '高手 holder waits in the least used zone of a drawer who balances its zones (' + a + '/100)');
  // level gradient: a habitual player (likes the right end, never re-sorts) against each level, 400 five-round matches
  const habit = { arrange: m => ({ order: m.hand.slice(), raised: -1 }), pick: m => { const r = OM.rng(m.seed); return { idx: r() < 0.6 ? m.n - 1 : (r() * m.n) | 0 }; } };
  const rate = lv => { let w = 0; for (let i = 0; i < 400; i++) { const M = OM.newMatch(OM.hash('grad', lv, i), {}, 5); while (!M.over) OM.simRound(M, [habit, lv, lv, lv]); if (M.winners.includes(0)) w++; } return w / 4; };
  const g = [0, 1, 2].map(rate);
  console.log('  level gradient (habitual player wins): ' + g.join('% → ') + '%');
  ok(g[0] > g[1] + 3 && g[1] > g[2] + 3, 'champion rate of a habitual player falls with level: ' + g.join('% → ') + '%');
}
// --- 10000 auto-played rounds over all variants and levels ---
{
  const variants = [{}, { double: true }, { color: true }, { quick: true }, { double: true, color: true, quick: true }, { start: 'random' }];
  let rounds = 0, bad = 0, split = 0, paired = 0, maxDraws = 0, draws = 0;
  for (let m = 0; rounds < 10000; m++) {
    const o = variants[m % variants.length], M = OM.newMatch(OM.hash('t', m), o, 5), lv = [m % 3, (m + 1) % 3, (m + 2) % 3, m % 3];
    while (!M.over) {
      const S = OM.simRound(M, lv); rounds++; draws += S.n; maxDraws = Math.max(maxDraws, S.n);
      const total = OM.deck(o).length, inHands = S.hands.reduce((a, h) => a + h.length, 0);
      if (inHands + S.pile.length * 2 !== total) bad++;
      const nl = S.losers.length;
      if (!o.double && (nl !== 1 || !S.hands[S.losers[0]].includes(52) || S.hands[S.losers[0]].length !== 1)) bad++;
      if (o.double) { if (nl === 2) split++; else if (nl === 0) paired++; else bad++; }
      if (S.out.length + nl !== 4) bad++;
      const pts = OM.points(S); if (pts.reduce((a, b) => a + b) !== [0, 3, 5, 6, 6][S.out.length]) bad++;
    }
  }
  ok(bad === 0, `10000 rounds: cards conserved, exactly one loser holding only the joker (split double-joker: 2), points 3/2/1 — ${bad} violations`);
  console.log(`  auto-play: ${rounds} rounds, avg ${(draws / rounds).toFixed(1)} draws, max ${maxDraws} (no stall); double-joker rounds: ${split} split (2 losers), ${paired} jokers paired (no loser)`);
}
// --- the real page (release review 2026-11-08): two fingers, pointerup buttons, saved match, layout ---
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('  (playwright not found: page tests skipped)'); return; }
  const URL = 'http://om.test/', T0 = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: o.vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', timezoneId: 'Asia/Taipei' });
    await ctx.addInitScript(st => { try { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.clear(); for (const k in st) localStorage.setItem('oldmaid:' + k, JSON.stringify(st[k])); } } catch (e) {} },
      Object.assign({ settings: { lvl: 2, rounds: 3, speed: 1.8, quick: true, draw: 'slide', start: 'most', sound: false, vib: false, theme: 'auto' }, stats: { rounds: 3 } }, o.store || {}));
    await ctx.addInitScript(() => { window.__clicks = []; document.addEventListener('click', e => window.__clicks.push((e.target.closest('[id]') || e.target).id), true); });
    await ctx.route('**/*', r => r.request().url().split('#')[0] === URL ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__om);
    const cdp = await ctx.newCDPSession(page);
    const st = () => page.evaluate(() => Object.assign(window.__om.info(), { paused: window.__om.paused(), fast: window.__om.fast(), stage: window.__om.stage() }));
    const until = async (fn, what, ms = 40000) => { const t = Date.now(); for (;;) { const s = await st(); if (fn(s)) return s; if (Date.now() - t > ms) throw new Error('timeout waiting for ' + what + ' ' + JSON.stringify(s).slice(0, 300)); await sleep(30); } };
    const center = async sel => { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error(sel + ' not visible'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (sel, hold = 40, id = 7) => { const c = typeof sel === 'string' ? await center(sel) : sel; await touch('touchStart', [{ x: c.x, y: c.y, id }]); await sleep(hold); await touch('touchEnd', [{ x: c.x, y: c.y, id }]); };
    const fan = i => page.evaluate(i => window.__om.fanPt(i), i), hand = i => page.evaluate(i => window.__om.handPt(i), i);
    // play on until it is my turn to draw (speeding through the computers' turns, answering round results)
    const toPick = async () => { for (let k = 0; k < 400; k++) { const s = await st();
      if (s.phase === 'pick' && !s.paused) return s;
      if (s.ov.includes('ovRound')) { await tap('#bNext'); await sleep(150); continue; }
      if (!s.fast && ['ai', 'aiPick', 'idle'].includes(s.phase) && !s.ov.length) { await tap('#bSkip'); await sleep(60); continue; }
      await sleep(50); } throw new Error('never my turn'); };
    return { ctx, page, errors, st, until, center, touch, tap, fan, hand, toPick };
  }
  try {
    // a) layout: every fan / hand card keeps a >=44px strip, the raised fan card stays below the 總分 labels
    const P0 = await open({ vp: { width: 390, height: 844 } });
    for (const vp of [{ width: 360, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const P = P0; await P.page.setViewportSize(vp); await P.page.waitForFunction(w => window.__om.layout().land === (w > 600), vp.width);
      const g = await P.page.evaluate(() => [2, 4, 6, 7, 8, 10, 12, 14].map(n => window.__om.geo(n)));
      ok(g.every(x => x.fan >= 44 && x.hand >= 44), `${vp.width}x${vp.height}: fan and hand touch strips >= 44px for 2–14 cards (min fan ${Math.min(...g.map(x => x.fan)).toFixed(1)}, hand ${Math.min(...g.map(x => x.hand)).toFixed(1)})`);
      ok(g.every(x => x.fanTop > x.label), `${vp.width}x${vp.height}: a raised + highlighted fan card stays below the opponents' 總分 labels`);
    }
    await P0.ctx.close();
    const P = await open({ vp: { width: 360, height: 640 } });
    // b) menu row fits the first screen at 360x640; start; tap the table to skip the deal; 洗混 is disabled while dealing
    const rowB = await P.page.locator('#bSet').boundingBox();
    ok(rowB.y + rowB.height <= 640, '360x640 menu: 每日／統計／設定 visible without scrolling');
    await P.tap('#bStart');
    let s = await P.until(s => s.phase === 'deal', 'dealing');
    ok(await P.page.evaluate(() => document.getElementById('bShuffle').disabled), '洗混 is disabled during the deal');
    const tDeal = Date.now(); await P.tap({ x: 30, y: 330 });
    s = await P.until(s => s.phase !== 'deal', 'deal skipped', 8000);
    ok(Date.now() - tDeal < 4000, 'tapping the table skips the deal (' + (Date.now() - tDeal) + 'ms)');
    ok(await P.page.evaluate(() => !!window.__om.saved()), 'match saved as soon as the round is dealt');
    const E = await P.page.evaluate(() => ({ x: 14, y: Math.round(window.__om.layout().pileY + 20) }));   // empty table, away from the fan and my cards
    // c) finger 1 on a fan card, finger 2 on my own card: finger 1's release draws
    s = await P.toPick();
    let f = await P.fan(0), h = await P.hand(0);
    await P.touch('touchStart', [{ x: f.x, y: f.y, id: 1 }]); await sleep(80);
    await P.touch('touchStart', [{ x: f.x, y: f.y, id: 1 }, { x: h.x, y: h.y, id: 2 }]); await sleep(60);
    await P.touch('touchEnd', [{ x: f.x, y: f.y, id: 1 }]); await sleep(120);
    s = await P.st(); ok(s.phase !== 'pick', 'two fingers: releasing the fan finger draws while another finger holds my card (' + s.phase + ')');
    await P.touch('touchEnd', [{ x: h.x, y: h.y, id: 2 }]);
    // d) finger 1 on the fan, finger 2 taps the table: nothing is drawn until finger 1 lifts
    s = await P.toPick(); f = await P.fan(0);
    await P.touch('touchStart', [{ x: f.x, y: f.y, id: 1 }]); await sleep(80);
    await P.touch('touchStart', [{ x: f.x, y: f.y, id: 1 }, { x: E.x, y: E.y, id: 2 }]); await sleep(60);
    await P.touch('touchEnd', [{ x: E.x, y: E.y, id: 2 }]); await sleep(150);
    s = await P.st(); ok(s.phase === 'pick', 'two fingers: another finger\'s release does not draw the held card');
    await P.touch('touchEnd', [{ x: f.x, y: f.y, id: 1 }]); await sleep(120);
    s = await P.st(); ok(s.phase !== 'pick', '…and the fan finger\'s own release does');
    // e) buttons fire for a second finger (no click from the browser) and exactly once for single / slow taps
    const snd = () => P.page.evaluate(() => JSON.parse(localStorage.getItem('oldmaid:settings')).sound);
    const two = async sel => { const c = await P.center(sel); await P.touch('touchStart', [{ x: E.x, y: E.y, id: 1 }]); await sleep(60);
      await P.touch('touchStart', [{ x: E.x, y: E.y, id: 1 }, { x: c.x, y: c.y, id: 2 }]); await sleep(60); await P.touch('touchEnd', [{ x: c.x, y: c.y, id: 2 }]); await sleep(100);
      await P.touch('touchEnd', [{ x: E.x, y: E.y, id: 1 }]); await sleep(120); };
    let v0 = await snd(); await two('#bMute'); ok(await snd() === !v0, 'second finger: 音效 toggles');
    for (const hold of [40, 600, 1000]) { v0 = await snd(); await P.tap('#bMute', hold); await sleep(250); ok(await snd() === !v0, '音效 tap held ' + hold + 'ms toggles exactly once'); }
    await two('#bMenu'); s = await P.st(); ok(s.ov.includes('ovPause') && s.paused, 'second finger: 選單 opens the pause menu');
    await two('#bResume'); s = await P.st(); ok(!s.ov.length && !s.paused, 'second finger: 繼續 resumes');
    for (const hold of [600, 1000]) { await P.tap('#bMenu', hold); await sleep(200); await P.tap('#bResume', hold); await sleep(250); s = await P.st(); ok(!s.ov.length && !s.paused, '選單 → 繼續 with ' + hold + 'ms taps'); }
    if ((await P.st()).hand >= 2) { let changed = false;
      for (let k = 0; k < 6 && !changed; k++) { await P.until(s => s.phase !== 'deal' && s.phase !== 'aiPull', 'shuffle ok'); const h0 = await P.page.evaluate(() => window.__om.hand().join());
        await two('#bShuffle'); changed = await P.page.evaluate(() => window.__om.hand().join()) !== h0; }
      ok(changed, 'second finger: 洗混 shuffles'); }
    // f) a reload mid-match comes back to the same table (my turn: same hand, same fan, same scores)
    s = await P.toPick();
    const before = await P.page.evaluate(() => ({ hand: window.__om.hand().join(), round: window.__om.match().round, totals: window.__om.match().totals.join(), fan: window.__om.state().hands[window.__om.info().target].join() }));
    await P.page.reload(); await P.page.waitForFunction(() => window.__om);
    ok(await P.page.isVisible('#bCont'), 'reload: the menu offers 繼續比賽');
    await P.tap('#bCont'); s = await P.until(s => s.phase === 'pick', 'resumed to my turn', 15000);
    const after = await P.page.evaluate(() => ({ hand: window.__om.hand().join(), round: window.__om.match().round, totals: window.__om.match().totals.join(), fan: window.__om.state().hands[window.__om.info().target].join() }));
    ok(JSON.stringify(after) === JSON.stringify(before), 'resumed at my turn with the same hand, fan order, round and scores');
    // g) reload while the computers are drawing
    await P.tap(await P.fan(0)); await P.until(s => s.phase !== 'pick' && s.phase !== 'anim', 'computers playing');
    const nA = await P.page.evaluate(() => window.__om.state().n);
    await P.page.reload(); await P.page.waitForFunction(() => window.__om); await P.tap('#bCont');
    ok(await P.page.evaluate(() => window.__om.state().n) >= nA, 'reload during the computers\' turns resumes the same round (draw ' + nA + ')');
    // h) reload on the round result: same result shown, stats counted once; then the next round deals
    let roundsCounted = -1;
    for (const tR = Date.now(); Date.now() - tR < 60000;) { s = await P.st(); if (s.ov.includes('ovRound')) break; if (s.phase === 'pick' && !s.paused) { await P.tap(await P.fan(0)); await sleep(80); continue; } if (!s.fast && ['ai', 'aiPick', 'idle'].includes(s.phase)) await P.tap('#bSkip'); await sleep(60); }
    ok((await P.st()).ov.includes('ovRound'), 'played a round to its result');
    const nb = await P.page.locator('#bNext').boundingBox();
    ok(nb.y >= 0 && nb.y + nb.height <= 640, '360x640: 下一局 is on the first screen of the result panel');
    roundsCounted = await P.page.evaluate(() => window.__om.stats().rounds);
    const title = await P.page.textContent('#rTitle');
    await P.page.reload(); await P.page.waitForFunction(() => window.__om); await P.tap('#bCont');
    s = await P.until(s => s.ov.includes('ovRound'), 'result again', 8000);
    ok(await P.page.textContent('#rTitle') === title && await P.page.evaluate(() => window.__om.stats().rounds) === roundsCounted, 'reload on the result shows it again without counting the round twice');
    await P.page.evaluate(() => window.__clicks.length = 0);
    await P.tap('#bNext'); s = await P.until(s => !s.ov.includes('ovRound'), 'next round');
    await sleep(300);
    ok((await P.page.evaluate(() => window.__clicks)).every(id => id !== 'bNext' && id !== 'ovMenu'), 'the click after 下一局 is swallowed (no ghost)');
    // i) starting a new match over a save asks first; 取消 keeps it
    await P.page.reload(); await P.page.waitForFunction(() => window.__om);
    await P.tap('#bStart'); s = await P.st(); ok(s.ov.includes('ovAsk'), 'new match over a saved one asks first');
    await P.tap('#bAskNo'); ok(await P.page.evaluate(() => !!window.__om.saved()), '取消 keeps the saved match');
    // j) local date (not UTC) for the daily deal / 今天
    ok(await P.page.evaluate(() => window.__om.ymd(new Date(2026, 10, 8, 7, 30)) === '2026-11-08' && window.__om.today() === window.__om.ymd(new Date())), 'daily date is the local calendar day (07:30 in Taipei is still today)');
    ok(!P.errors.length, 'no page / console errors' + (P.errors.length ? ': ' + P.errors.join(' | ') : ''));
    await P.ctx.close();
  } catch (e) { ok(false, 'page test: ' + e.message); }
  await browser.close();
  console.log('  page tests ' + ((Date.now() - T0) / 1000).toFixed(1) + 's');
})().then(() => { console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }, e => { console.log('FAIL', e); process.exit(1); });
