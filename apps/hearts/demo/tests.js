// Rule tests for 紅心大戰 (hearts). Extracts the engine between the CORE markers of ../index.html
// and checks every rule in the spec, then runs 3000 AI-vs-AI rounds checking legality and point totals.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const { card, suit, rank, QS, JD, C2 } = HE;
let pass = 0, fail = 0; const T0 = Date.now(); if (process.env.HT_TIME) { const o = console.log; console.log = (...a) => o(((Date.now() - T0) / 1000).toFixed(1) + 's', ...a); }
const ok = (c, msg) => { if (process.env.HT_TIME) console.log(msg); if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const C = s => { const m = s.match(/^(10|[2-9JQKA])([CDSH])$/); return card('CDSH'.indexOf(m[2]), HE.RANKS.indexOf(m[1])); };
const cs = str => str.split(' ').filter(Boolean).map(C);
const same = (a, b) => JSON.stringify(a.slice().sort((x, y) => x - y)) === JSON.stringify(b.slice().sort((x, y) => x - y));
// build a play-phase state from explicit hands
function st(hands, o) {
  o = o || {};
  const S = HE.newRound(1, 3, o.opts || {});
  S.hm.fill(0); S.n = [0, 0, 0, 0];
  hands.forEach((h, p) => cs(h).forEach(c => { S.hm[p * 4 + suit(c)] |= 1 << rank(c); S.n[p]++; }));
  S.tno = o.tno || 0; S.broken = o.broken ? 1 : 0; S.turn = o.turn || 0; S.phase = 'play';
  (o.played || []).forEach(c => S.played[suit(c)] |= 1 << rank(c));
  return S;
}
const lg = (S, p) => HE.legal(S, p).map(HE.name).join(' ');

// --- deck & deal ---
{
  const hm = HE.deal(42), all = new Set(); let each = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (hm[p * 4 + s] & (1 << r)) { all.add(card(s, r)); each[p]++; }
  ok(all.size === 52 && each.every(x => x === 13), '52 distinct cards, 13 per player');
  ok(JSON.stringify(HE.deal(42)) === JSON.stringify(hm) && JSON.stringify(HE.deal(43)) !== JSON.stringify(hm), 'seeded shuffle is reproducible');
  ok(rank(card(0, 12)) > rank(card(0, 11)) && HE.name(card(0, 12)) === '♣A' && HE.name(C2) === '♣2', 'A high, 2 low');
}
// --- first trick ---
{
  const S = HE.newRound(7, 3, {});
  const p = HE.holderOf(S, C2);
  ok(S.phase === 'play' && S.turn === p, 'no-pass round: the 2♣ holder leads');
  ok(same(HE.legal(S, p), [C2]), '2♣ is the only legal first lead');
  // void in clubs on trick 1: no hearts and no Q♠
  const A = st(['2C 3C', '4H 5H QS 3D', 'AC', 'KC']); HE.play(A, C('2C'));
  ok(lg(A, 1) === '♦3', 'trick 1 discard: hearts and Q♠ forbidden when another card exists');
  const B = st(['2C 3C', '4H 5H QS', 'AC', 'KC']); HE.play(B, C('2C'));
  ok(same(HE.legal(B, 1), cs('4H 5H QS')), 'trick 1: holding only hearts and Q♠ (no clubs) → any card');
  const B2 = st(['2C 3C', 'KS AS 4H', 'AC', 'KC']); HE.play(B2, C('2C'));
  ok(same(HE.legal(B2, 1), cs('KS AS')), 'trick 1: non-point spades are fine to discard');
  const D = st(['2C 3C', '9C 4H QS', 'AC', 'KC']); HE.play(D, C('2C'));
  ok(lg(D, 1) === '♣9', 'trick 1: must follow clubs if possible');
}
// --- following suit & discards ---
{
  const S = st(['5D 9S', '3D KD 2H', 'AS', 'QH'], { tno: 3, broken: 1 }); HE.play(S, C('5D'));
  ok(same(HE.legal(S, 1), cs('3D KD')), 'must follow the led suit');
  HE.play(S, C('3D'));
  ok(same(HE.legal(S, 2), cs('AS')), 'void: may discard anything (later tricks)');
  const S2 = st(['5D', 'QS 2H', '6D', '7D'], { tno: 2 }); HE.play(S2, C('5D'));
  ok(same(HE.legal(S2, 1), cs('QS 2H')), 'after trick 1, points may be discarded');
  HE.play(S2, C('2H')); ok(S2.broken === 1, 'discarding a heart breaks hearts');
  ok(S2.voids[1] === (1 << 1), 'showing out marks the player void in that suit');
}
// --- breaking hearts ---
{
  const S = st(['2H 9H 4S', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S, 0), cs('4S')), 'cannot lead hearts before they are broken');
  const S1 = st(['2H 9H', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S1, 0), cs('2H 9H')), 'may lead hearts when holding only hearts');
  const S2 = st(['2H 9H 4S', '', '', ''], { tno: 2, broken: 1 });
  ok(same(HE.legal(S2, 0), cs('2H 9H 4S')), 'hearts may be led once broken');
  const S3 = st(['2H QS 4S', '', '', ''], { tno: 2 });
  ok(same(HE.legal(S3, 0), cs('QS 4S')), 'hearts + Q♠ only, unbroken: Q♠ may be led, hearts not');
  // Q♠ breaks hearts only with the option
  const a = st(['3S', 'QS', '4S', '5S 2H 7C'], { tno: 2 }); a.turn = 0; HE.play(a, C('3S')); HE.play(a, C('QS')); HE.play(a, C('4S')); HE.play(a, C('5S'));
  ok(a.broken === 0 && !HE.legal(a, 3).includes(C('2H')), 'default: Q♠ does not break hearts');
  const b = st(['3S', 'QS', '4S', '5S 2H 7C'], { tno: 2, opts: { qsb: true } }); HE.play(b, C('3S')); HE.play(b, C('QS')); HE.play(b, C('4S')); HE.play(b, C('5S'));
  ok(b.broken === 1 && HE.legal(b, 3).includes(C('2H')), 'option: Q♠ breaks hearts');
}
// --- trick winner, next leader, points ---
{
  const S = st(['5D', 'AH', 'KD', '2D'], { tno: 4, broken: 1 });
  HE.play(S, C('5D')); HE.play(S, C('AH')); HE.play(S, C('KD')); const w = HE.play(S, C('2D'));
  ok(w === 2 && S.turn === 2, 'highest card of the led suit wins (off-suit A♥ ignored); winner leads next');
  ok(S.pts[2] === 1 && S.hc[2] === 1, 'a heart counts 1 point');
  const T = st(['3S', 'QS', '9S', 'KS'], { tno: 4 }); [ '3S', 'QS', '9S', 'KS' ].forEach(x => HE.play(T, C(x)));
  ok(T.pts[3] === 13 && T.qsBy === 3, 'Q♠ counts 13 points');
}
// helper: play a full round with given players' captured sets by brute assignment
function finishedRound(opts, ptsTo) {
  // ptsTo: function card->player who captured it
  const S = HE.newRound(5, 3, opts); S.phase = 'done'; S.tno = 13;
  for (let c = 0; c < 52; c++) { const p = ptsTo(c); if (suit(c) === 3) { S.hc[p]++; S.pts[p]++; } else if (c === QS) { S.qsBy = p; S.pts[p] += 13; } else if (c === JD) S.jdBy = p; }
  return S;
}
{
  const r = HE.roundScore(finishedRound({}, c => c % 4));
  ok(r.d.reduce((a, b) => a + b) === 26 && r.shooter < 0, 'normal round: 26 points in total');
  const m = HE.roundScore(finishedRound({}, c => 2));
  ok(m.shooter === 2 && JSON.stringify(m.d) === '[26,26,0,26]', 'shoot the moon: others +26, shooter 0 (total 78)');
  const m2 = HE.roundScore(finishedRound({ moonMinus: true }, c => 1));
  ok(m2.shooter === 1 && JSON.stringify(m2.d) === '[0,-26,0,0]', 'moon option: shooter −26 instead');
  const n = HE.roundScore(finishedRound({}, c => suit(c) === 3 && rank(c) === 0 ? 0 : 2));
  ok(n.shooter < 0 && n.d[2] === 25 && n.d[0] === 1, 'missing one heart is not a moon');
  const j = HE.roundScore(finishedRound({ jd: true }, c => c === JD ? 3 : c % 4));
  ok(j.d[3] === HE.roundScore(finishedRound({}, c => c === JD ? 3 : c % 4)).d[3] - 10, 'J♦ option: −10 to whoever takes it');
  const j0 = HE.roundScore(finishedRound({}, c => c === JD ? 3 : c % 4));
  ok(j0.d.reduce((a, b) => a + b) === 26, 'J♦ has no value without the option');
}
// --- passing ---
{
  ok([0, 1, 2, 3, 4, 5, 6, 7].map(r => HE.passDirFor(r, {})).join('') === '01230123', 'pass direction cycles left, right, across, none');
  ok([0, 1, 2, 3].every(r => HE.passDirFor(r, { passFixed: true }) === 0), 'fixed-direction option always passes left');
  ok(HE.passTarget(0, 0) === 1 && HE.passTarget(0, 1) === 3 && HE.passTarget(0, 2) === 2 && HE.passTarget(1, 0) === 2 && HE.passTarget(3, 0) === 0, 'pass targets (left=next seat clockwise)');
  for (const dir of [0, 1, 2]) {
    const S = HE.newRound(99 + dir, dir, {}); ok(S.phase === 'pass' && S.turn === -1, 'pass round starts in pass phase dir ' + dir);
    const passes = [0, 1, 2, 3].map(p => HE.hand(S, p).slice(0, 3));
    HE.applyPass(S, passes);
    let good = true;
    for (let p = 0; p < 4; p++) { const t = HE.passTarget(p, dir); for (const c of passes[p]) if (!HE.has(S, t, c) || HE.has(S, p, c)) good = false; if (HE.hand(S, p).length !== 13) good = false; }
    ok(good, 'applyPass moves exactly 3 cards to the right seat, everyone keeps 13 (dir ' + dir + ')');
    ok(S.phase === 'play' && HE.has(S, S.turn, C2), 'after passing, whoever now holds 2♣ leads');
  }
  let threw = false; try { const S = HE.newRound(3, 0, {}); HE.applyPass(S, [[0, 1], [], [], []]); } catch (e) { threw = true; }
  ok(threw, 'a pass must be exactly 3 owned cards');
}
// --- match end and tiebreak ---
{
  const M = HE.newMatch(1, {});
  HE.finishRound(M, { d: [20, 30, 40, 50], shooter: -1 }); ok(!M.over, 'no one at 100 → continue');
  HE.finishRound(M, { d: [30, 26, 26, 50], shooter: -1 }); ok(M.over && M.winner === 0, '≥100 reached → lowest total wins');
  const T = HE.newMatch(1, {});
  HE.finishRound(T, { d: [50, 50, 60, 99], shooter: -1 }); HE.finishRound(T, { d: [10, 10, 0, 1], shooter: -1 });
  ok(!T.over && T.tiebreak, 'tie for lowest after ≥100 → another round');
  HE.finishRound(T, { d: [0, 3, 1, 0], shooter: -1 }); ok(T.over && T.winner === 0, 'tiebreak round decides the winner');
  ok(HE.roundSeed(HE.newMatch(5, {})) === HE.roundSeed(HE.newMatch(5, {})), 'round deals are seeded by match seed');
}
// --- AI view hides hands; sampler honours voids and passed cards ---
{
  const S = HE.newRound(11, 0, {}); const passes = [0, 1, 2, 3].map(p => HE.choosePass(S, p, 1, HE.rng(p))); HE.applyPass(S, passes);
  const V = HE.viewFor(S, 1);
  ok([0, 2, 3].every(q => [0, 1, 2, 3].every(s => V.hm[q * 4 + s] === 0)) && V.n.every(x => x === 13), 'viewFor hides other hands but keeps counts');
  ok(V.known && V.known.to === 2 && same(V.known.cards, passes[1]), 'AI remembers the 3 cards it passed and to whom');
  V.voids[3] = 1 << 0; // pretend seat 3 is void in clubs
  let good = true, kn = true; const rnd = HE.rng(3);
  for (let i = 0; i < 300; i++) { const W = HE.sampleWorld(V, 1, rnd); if (!W) { good = false; break; }
    if (W.hm[3 * 4 + 0]) good = false; for (let q = 0; q < 4; q++) if (HE.hand(W, q).length !== 13) good = false;
    for (const c of passes[1]) if (!HE.has(W, 2, c)) kn = false;
    const seen = new Set(); for (let q = 0; q < 4; q++) for (const c of HE.hand(W, q)) seen.add(c); if (seen.size !== 52) good = false; }
  ok(good, 'sampled worlds respect counts and void constraints'); ok(kn, 'sampled worlds keep passed cards with their receiver');
}
// --- 3000 AI rounds: legality, card conservation, 26/78 totals ---
{
  let rounds = 0, bad = 0, moons = 0, illegal = 0, perLevel = [[0, 0], [0, 0], [0, 0]];
  const combos = [[0, 0, 0, 0], [1, 1, 1, 1], [0, 1, 0, 1], [1, 0, 1, 0], [0, 0, 1, 1]];
  const opts = [{}, { qsb: true }, { jd: true }, { moonMinus: true }];
  for (let i = 0; i < 3000; i++) {
    const lv = i < 2950 ? combos[i % combos.length] : [2, 1, 0, 1], o = opts[(i >> 2) % 4];
    const S = HE.newRound(HE.hash('t', i), i % 4, o);
    if (S.phase === 'pass') HE.applyPass(S, [0, 1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, lv[p], i * 4 + p).move));
    let n = 0;
    while (S.phase === 'play') {
      const p = S.turn, r = HE.think(HE.viewFor(S, p), p, lv[p], i * 977 + n, { ms: 20, minS: 10, maxS: 30 });
      if (!HE.isLegal(S, r.move)) { illegal++; break; }
      HE.play(S, r.move); n++;
    }
    const res = HE.roundScore(S), raw = S.pts.reduce((a, b) => a + b);
    const tot = res.d.reduce((a, b) => a + b) + (o.jd && S.jdBy >= 0 ? 10 : 0);
    const want = res.shooter < 0 ? 26 : o.moonMinus ? -26 : 78;
    if (n !== 52 || raw !== 26 || tot !== want || S.hist.length !== 13) bad++;
    if (res.shooter >= 0) moons++;
    rounds++;
  }
  ok(illegal === 0, '3000 rounds: AI never played an illegal card');
  ok(bad === 0, '3000 rounds: 52 plays, 13 tricks, 26 raw points, total 26 or 78 (−26 / J♦ adjusted)');
  console.log('self-play: ' + rounds + ' rounds, ' + moons + ' moons, illegal ' + illegal + ', bad totals ' + bad);
}
// --- match length option, 一般 difficulty (release review 2026-11-02) ---
{
  const M = HE.newMatch(1, { target: 50 });
  HE.finishRound(M, { d: [10, 20, 30, 49], shooter: -1 }); ok(!M.over, 'target 50: 49 points does not end the match');
  HE.finishRound(M, { d: [0, 0, 0, 1], shooter: -1 }); ok(M.over && M.winner === 0, 'target 50: reaching 50 ends it');
  const O = HE.newMatch(1, { jd: false }); delete O.opts.target; HE.finishRound(O, { d: [10, 20, 30, 99], shooter: -1 });
  ok(!O.over, 'old saved match without target still plays to 100');
  // a 1-step greedy player (the skill-tier "casual" bot without slips) must win some matches at the default level
  const greedy = S => { const L = HE.legal(S, 0); if (L.length === 1 || S.tc === 0) return L.slice().sort((a, b) => rank(a) - rank(b))[0];
    const Ls = suit(S.trick[S.lead]); let wr = -1; for (let q = 0; q < 4; q++) { const c = S.trick[q]; if (c >= 0 && suit(c) === Ls && rank(c) > wr) wr = rank(c); }
    const f = L.filter(c => suit(c) === Ls); if (f.length) { const u = f.filter(c => rank(c) < wr && c !== QS); return (u.length ? u : f).sort((a, b) => rank(b) - rank(a))[0]; }
    if (L.includes(QS)) return QS; return L.sort((a, b) => (suit(b) === 3) - (suit(a) === 3) || rank(b) - rank(a))[0]; };
  let wins = 0; const N = 60;
  for (let i = 0; i < N; i++) {
    const M = HE.newMatch(HE.hash('lv1', i), {});
    while (!M.over && M.round < 60) {
      const S = HE.startRound(M); S.log = false;
      if (S.phase === 'pass') HE.applyPass(S, [0, 1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, p ? 1 : 0, HE.hash(M.seed, M.round, 'pass', p)).move));
      while (S.phase === 'play') { const p = S.turn; HE.play(S, p ? HE.think(HE.viewFor(S, p), p, 1, HE.hash(M.seed, M.round, S.tno, S.tc, p)).move : greedy(S)); }
      HE.finishRound(M, HE.roundScore(S));
    }
    if (M.winner === 0) wins++;
  }
  console.log('greedy player vs 一般: ' + wins + '/' + N + ' wins');
  ok(wins >= N * .1 && wins <= N * .6, '一般 is beatable by a simple greedy player (10–60% wins; was ~2%)');
}
// --- static checks on the page ---
ok(!/扣 1 分/.test(html) && /\+1 分/.test(html), 'help text says hearts are +1 penalty points, not 扣');
ok(/#tip button\{[^}]*min-height:44px/.test(html), 'tutorial tip button is 44px tall');

// --- browser checks (real CDP touch, phone contexts) ---
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('playwright missing: browser checks skipped'); return; }
  const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
  const browser = await chromium.launch();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function open(w, h, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    // storage is prepared once, then the page is reloaded (no init script, so later reloads keep what the game saved)
    await page.goto(URL); await page.waitForFunction(() => window.__hearts);
    await page.evaluate(match => { localStorage.clear(); localStorage.setItem('hearts:settings', JSON.stringify({ level: 1, tutDone: true, snd: false, vib: false })); if (match) localStorage.setItem('hearts:match', match); }, init || null);
    await page.reload(); await page.waitForFunction(() => window.__hearts);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const tapSel = async sel => { const b = await page.locator(sel).boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2); };
    const info = () => page.evaluate(() => window.__hearts.info());
    return { ctx, page, errors, touch, tapSel, info };
  }
  try {
    // 1) deal can be skipped with one tap; hand strips ≥44px; every card is hit where cardPt says; subtitle fits
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
      const T = await open(w, h);
      await T.tapSel('#bNew');
      await T.page.waitForFunction(() => window.__hearts.info().hand.length === 13);
      await T.touch(w / 2, h / 2);
      const st = await T.info();
      ok(st.passReady || (st.wait && st.turn === 0) || st.turn > 0, w + ': a tap during the deal finishes it at once');
      await T.page.waitForFunction(() => { const i = window.__hearts.info(); return i.passReady || i.wait; }, null, { timeout: 30000 });
      const I = await T.info();
      if (I.passReady) {
        const pts = await T.page.evaluate(h => h.map(c => window.__hearts.cardPt(c)), I.hand);
        let wrong = 0; // each card once (alternating cardPt and 20px lower), so every tap adds a new card to the pass selection
        for (let i = 0; i < (w < 400 ? 13 : 0); i++) {
          const c = I.hand[i], p = await T.page.evaluate(c => window.__hearts.cardPt(c), c);
          await T.touch(p.x, p.y + (i % 2 ? 20 : 0)); if (!(await T.info()).passSel.includes(c)) wrong++;
        }
        if (w < 400) ok(wrong === 0, w + 'x' + h + ': tapping each of the 13 cards selects that card (wrong ' + wrong + ')');
        const minW = await T.page.evaluate(() => Math.min(...window.__hearts.fan().map(f => f.rgt - f.l)));
        ok(minW >= 44, w + 'x' + h + ': each hand card has a ≥44px wide tap strip (min ' + minW.toFixed(1) + ')');
        const minL = await T.page.evaluate(() => Math.min(...window.__hearts.fan().map(f => f.l)));
        ok(minL >= 8, w + ': leftmost card is inset from the screen edge (' + minL.toFixed(1) + 'px)');
      } else ok(true, 'no-pass round');
      const sub = await T.page.evaluate(() => { const e = document.getElementById('tSub'); return { fit: e.scrollWidth <= e.clientWidth + 1, t: e.textContent }; });
      ok(sub.fit && /破心|紅心/.test(sub.t), w + ': top subtitle fits without ellipsis and keeps the hearts-broken state ("' + sub.t + '")');
      ok(!T.errors.length, w + ': no page errors ' + T.errors.join(' | '));
      await T.ctx.close();
    }
    // 2) final round: result is recorded before the result sheet; reload keeps it and shows it once
    {
      const ctxS = HE.newMatch(4242, {}); delete ctxS.opts.target; ctxS.round = 6; ctxS.totals = [0, 40, 60, 100 - 1];
      for (let i = 0; i < 6; i++) ctxS.rounds.push({ d: [0, 0, 0, 0], shooter: -1 });
      // the last round with 1 trick left (old save format, no target), so the page finishes it on its own
      const S = HE.newRound(HE.hash('final'), 3, ctxS.opts);
      while (S.tno < 12) HE.play(S, HE.legal(S)[0]);
      ctxS.totals[3] = 100; // anyone ≥100 after this round ends the match; seat 0 stays lowest
      const save = JSON.stringify({ v: 1, M: ctxS, S, level: 1, daily: null, mf: { worst: false, qs: 0 } });
      const T = await open(390, 844, save);
      await T.page.evaluate(() => { window.__msgs = []; new MutationObserver(() => window.__msgs.push(document.getElementById('msg').textContent)).observe(document.getElementById('msg'), { childList: true, characterData: true, subtree: true }); });
      await T.tapSel('#bResume');
      await T.page.waitForFunction(() => window.__hearts.info().ov.includes('ovRound'), null, { timeout: 30000 });
      const r = await T.page.evaluate(() => ({ stats: JSON.parse(localStorage.getItem('hearts:stats')), match: JSON.parse(localStorage.getItem('hearts:match')), btn: document.getElementById('bNext').textContent, msg: document.getElementById('msg'), msgs: window.__msgs }));
      ok(r.stats && r.stats.games === 1 && r.stats.wins === 1 && r.stats.lv[1][0] === 1 && r.stats.ach.first, 'final round: win and achievement are saved as soon as the round is scored');
      ok(r.match && r.match.M.over && r.match.M.recorded, 'final round: finished match kept (marked recorded) until the result is shown');
      ok(r.btn === '查看最終結果', 'final round: button leads to the final result');
      const m = await T.page.evaluate(() => { const e = document.getElementById('msg'); return { hidden: e.hidden, t: e.textContent }; });
      ok(m.hidden || !m.t, 'final round: the message pill is cleared at the round result (was "X 思考中…")');
      ok(r.msgs.some(t => /出了/.test(t)) && r.msgs.some(t => /吃下這墩/.test(t)), 'message pill reports the card played and who took the trick');
      await T.page.reload(); await T.page.waitForFunction(() => window.__hearts);
      const a = await T.page.evaluate(() => ({ stats: JSON.parse(localStorage.getItem('hearts:stats')), resume: !document.getElementById('bResume').hidden && document.getElementById('bResume').textContent }));
      ok(a.stats.games === 1 && a.stats.wins === 1 && /最終結果/.test(a.resume), 'reload on the result sheet: stats kept, menu offers the final result');
      await T.tapSel('#bResume');
      await T.page.waitForFunction(() => window.__hearts.info().ov.includes('ovEnd'));
      const e = await T.page.evaluate(() => ({ stats: JSON.parse(localStorage.getItem('hearts:stats')), match: localStorage.getItem('hearts:match'), t: document.getElementById('eTitle').textContent }));
      ok(e.stats.games === 1 && !e.match && e.t === '你贏了！', 'final result shown after reload, counted once, save cleared');
      ok(!T.errors.length, 'final round: no page errors ' + T.errors.join(' | '));
      await T.ctx.close();
    }
    // 3) a running match is not overwritten by 每日牌局 without a confirm; illegal taps explain themselves
    {
      const T = await open(390, 844);
      await T.tapSel('#bNew');
      await T.page.waitForFunction(() => window.__hearts.info().hand.length === 13); await T.touch(195, 300);
      await T.page.waitForFunction(() => { const i = window.__hearts.info(); return i.passReady || i.wait; }, null, { timeout: 30000 });
      let I = await T.info();
      if (I.passReady) { for (const c of I.hand.slice(-3)) { const p = await T.page.evaluate(c => window.__hearts.cardPt(c), c); await T.touch(p.x, p.y); } await T.tapSel('#act'); }
      await T.page.waitForFunction(() => { const i = window.__hearts.info(); return i.wait && i.turn === 0; }, null, { timeout: 60000 });
      I = await T.info();
      const bad = I.hand.find(c => !I.legal.includes(c));
      if (bad !== undefined) {
        const p = await T.page.evaluate(c => window.__hearts.cardPt(c), bad); await T.touch(p.x, p.y);
        const t = await T.page.evaluate(() => ({ n: window.__hearts.info().hand.length, toast: document.getElementById('toast').textContent, sel: window.__hearts.info().sel }));
        ok(t.n === I.hand.length && /不能出這張/.test(t.toast) && t.sel === -1, 'tapping a dimmed card plays nothing and says why');
      } else ok(true, 'all cards legal');
      const seed0 = await T.page.evaluate(() => JSON.parse(localStorage.getItem('hearts:match')).M.seed);
      await T.tapSel('#bMenu'); await T.tapSel('#bDaily');
      const c = await T.page.evaluate(() => ({ ov: window.__hearts.info().ov, seed: JSON.parse(localStorage.getItem('hearts:match')).M.seed }));
      ok(c.ov.includes('ovConfirm') && c.seed === seed0, '每日牌局 asks before replacing a running match');
      await T.page.locator('#ovConfirm [data-close]').click();
      // options: match length
      await T.tapSel('#bOpts'); await T.tapSel('#segLen [data-v="50"]');
      ok(await T.page.evaluate(() => JSON.parse(localStorage.getItem('hearts:settings')).target === 50), 'match length 50 can be chosen and is saved');
      ok(!T.errors.length, 'no page errors ' + T.errors.join(' | '));
      await T.ctx.close();
    }
  } catch (e) { ok(false, 'browser checks threw: ' + e.message); }
  await browser.close();
})().then(() => {
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
