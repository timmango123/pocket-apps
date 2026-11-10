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
// ---- 10. saved RNG state continues the same sequence (saved matches) ----
{ const a = LD.rng(4242); for (let i = 0; i < 7; i++) a(); const b = LD.rng(a.state()); eq([a(), a(), a()], [b(), b(), b()], 'rng(state) continues the sequence'); }

// ---- 11. difficulty: 新手 is beatable by a simple player, 一般 slips, 高手 does not ----
{
  const fresh = () => ({ bids: 0, bluffs: 0, cs: 0, cn: 0, rs: 0, rn: 0 });
  // seat 0: 1-step greedy player from its own dice (the skill-tier "普通" policy without its random moves)
  function greedy(g) {
    const l = LD.last(g); if (l && LD.probFor(g, 0, l, l.wild) < 0.4) return { act: 'call' };
    const cs = LD.candidates(LD.viewFor(g, 0), 0); if (!cs.length) return { act: 'call' };
    let best = null, bp = -1; for (const c of cs) { const p = LD.probFor(g, 0, c, LD.wildNow(g) && c.f !== 1); if (p > bp + 1e-9) { bp = p; best = c; } }
    if (l && 1 - LD.probFor(g, 0, l, l.wild) > bp) return { act: 'call' };
    return { act: 'bid', q: best.q, f: best.f };
  }
  function winRate(lvl, N) {
    let w = 0;
    for (let i = 0; i < N; i++) {
      const seed = 9100 + i * 37, rr = LD.rng(seed ^ 0x9e3779b9), g = LD.newGame({ n: 4, mode: 'lives', special: true, start: 'players', seed, first: Math.floor(rr() * 4) });
      while (g.phase !== 'over' && !g.P[0].out) {
        LD.startRound(g);
        for (let k = 0; k < 300; k++) {
          const p = g.turn, a = p === 0 ? greedy(g) : LD.think(LD.viewFor(g, p, { lvl, pers: LD.PERS[p % 3], seed: (rr() * 4294967295) >>> 0 }));
          if (a.act === 'call' && LD.canCall(g)) break;
          let b = { q: a.q, f: a.f }; if (a.act === 'call' || !LD.legal(g, b)) { b = LD.candidates(LD.viewFor(g, p), 0)[0]; if (!b) break; }
          LD.doBid(g, b);
        }
        LD.doCall(g); LD.settle(g);
      }
      if (!g.P[0].out && g.winner === 0) w++;
    }
    return w / N;
  }
  const wn = winRate(0, 150), wl = winRate(1, 150);
  console.log(`  greedy player vs 3 新手 ${(wn * 100).toFixed(1)}%, vs 3 一般 ${(wl * 100).toFixed(1)}% (fair share 25%)`);
  ok(wn >= 0.3, '新手 table is winnable for a simple greedy player (>=30%, got ' + wn + ')');
  ok(wl < wn, '一般 is harder than 新手');
}

// ---- 12. the real page: saved match, abandon, two-finger taps, confirms, layout fixes ----
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('  (playwright not found: page tests skipped)'); return; }
  const URL = 'http://ld.test/', T0 = Date.now();
  const browser = await chromium.launch();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: o.vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'dark' });
    await ctx.addInitScript(st => { try { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.clear(); for (const k in st) localStorage.setItem('liarsdice:' + k, JSON.stringify(st[k])); } } catch (e) {} },
      Object.assign({ settings: { ais: 3, lvl: 1, mode: 'lives', special: true, start: 'players', peek: 'hold', hint: true, sound: false, vib: false } }, o.store || {}));
    await ctx.route('**/*', r => r.request().url().split('#')[0] === URL ? r.fulfill({ status: 200, contentType: 'text/html', body: html }) : r.abort());
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL + (o.hash || ''));
    const cdp = await ctx.newCDPSession(page);
    const st = () => page.evaluate(() => window.__ld.state());
    const until = async (fn, what, ms = 25000) => { const t = Date.now(); for (;;) { const s = await st(); if (fn(s)) return s; if (Date.now() - t > ms) throw new Error('timeout waiting for ' + what + ' ' + JSON.stringify(s).slice(0, 200)); await sleep(40); } };
    const center = async sel => { await page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error(sel + ' not visible'); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (sel, id = 7) => { const c = typeof sel === 'string' ? await center(sel) : sel; await touch('touchStart', [{ x: c.x, y: c.y, id }]); await touch('touchEnd', []); };
    return { ctx, page, errors, st, until, center, touch, tap };
  }
  const myTurnWithBid = async P => { for (let i = 0; i < 6; i++) { const s = await P.until(s => s.myTurn || s.phase === 'result', 'my turn'); if (s.phase === 'result') { await P.tap('#bNext'); continue; } if (s.last) return s; await P.tap('#bBid'); await P.until(s => !s.myTurn, 'bid sent'); } throw new Error('no turn with a bid to answer'); };
  try {
    // a) a match is saved as it is played and survives a reload; the menu offers 繼續對局
    {
      const P = await open({ hash: '#seed=1004' });
      await P.tap('#sPlay');
      let s = await P.until(s => s.myTurn, 'first turn');
      ok(s.saved, 'match saved once the first round is dealt');
      const hand = s.hand, round = s.round;
      await P.tap('#qp'); await P.tap('#bBid');
      s = await P.until(s => !s.myTurn && s.bids > 0, 'bid applied');
      const bids = await P.page.evaluate(() => JSON.parse(localStorage.getItem('liarsdice:match')).g.bids.length);
      ok(bids >= 1, 'bid stored in liarsdice:match right away (' + bids + ')');
      await P.page.reload(); await P.page.waitForFunction(() => window.__ld);
      ok(await P.page.isVisible('#sCont'), 'reload shows 繼續對局 on the menu');
      await P.tap('#sCont');
      s = await P.until(s => s.round != null, 'resumed');
      eq([s.round, s.hand], [round, hand], 'resumed match keeps the round and my dice');
      ok(s.bids >= bids, 'resumed match keeps the bids');
      // reload while the cups are being opened: the call is applied on resume, not lost
      s = await myTurnWithBid(P);
      const lives0 = s.lives.reduce((a, b) => a + b, 0), cb = await P.center('#bCall');
      await P.touch('touchStart', [{ x: cb.x, y: cb.y, id: 3 }]);
      await P.until(s => s.phase === 'reveal', 'call made', 8000); await P.touch('touchEnd', []);
      ok(await P.page.evaluate(() => JSON.parse(localStorage.getItem('liarsdice:match')).g.phase === 'reveal'), 'call stored before the reveal animation');
      await P.page.reload(); await P.page.waitForFunction(() => window.__ld);
      await P.tap('#sCont');
      s = await P.until(s => s.phase === 'result' || s.overVisible || s.phase === 'over', 'resumed reveal judged');
      ok(s.lives.reduce((a, b) => a + b, 0) === lives0 - 1, 'reload during the reveal still costs the loser a life');
      // abandoning asks first and counts as a loss
      await P.tap('#bMenu'); await P.tap('#mNew');
      ok(await P.page.isVisible('#ovAsk'), '重新開局 during a match asks for confirmation');
      await P.tap('#askNo');
      ok(!(await P.page.isVisible('#ovAsk')) && (await P.st()).round === s.round, 'cancel keeps the match');
      await P.tap('#bMenu'); await P.tap('#mNew'); await P.tap('#askOk');
      await P.until(s => s.round >= 1, 'new match');
      const games = await P.page.evaluate(() => JSON.parse(localStorage.getItem('liarsdice:stats')).games);
      ok(games === 1, 'abandoned match recorded as a played game (' + games + ')');
      ok(!P.errors.length, 'no page errors (saved match) ' + P.errors.join(' | '));
      await P.ctx.close();
    }
    // b) second finger taps while the first holds the cup (hold-to-peek); single taps are not doubled; shake can be skipped
    {
      const P = await open({ hash: '#seed=2024' });
      await P.tap('#sPlay');
      let s = await P.until(s => s.phase === 'shake', 'shake');
      let tries = 0;
      while (true) { // tap the table during the shake; retry a round if the machine was too slow to land the tap in time
        await P.tap({ x: 195, y: 330 });
        s = await P.until(s => s.phase !== 'shake', 'shake over');
        if (s.shakeEndBy === 'tap' || ++tries >= 3) break;
        await P.page.evaluate(() => window.__ld.newMatch('normal', 77)); await P.until(s => s.phase === 'shake', 'shake');
      }
      ok(s.shakeEndBy === 'tap', 'tap on the table skips the shake');
      s = await P.until(s => s.myTurn, 'my turn');
      const qp = await P.center('#qp'), f6 = await P.center('.fb[data-f="6"]'), cup = s.cup;
      await P.touch('touchStart', [{ x: cup.x, y: cup.y, id: 1 }]);
      await P.until(s => s.ownLift > 0.5, 'peek');
      let q = (await P.st()).sel.q;
      for (let i = 0; i < 3; i++) { await P.touch('touchStart', [{ x: cup.x, y: cup.y, id: 1 }, { x: qp.x, y: qp.y, id: 2 }]); await P.touch('touchEnd', [{ x: qp.x, y: qp.y, id: 2 }]); }
      s = await P.st(); eq(s.sel.q, Math.min(s.total, q + 3), 'second finger on ＋ counts every tap while the cup is held');
      ok(s.ownLift > 0.5, 'cup stays open while the other finger taps');
      await P.touch('touchStart', [{ x: cup.x, y: cup.y, id: 1 }, { x: f6.x, y: f6.y, id: 2 }]); await P.touch('touchEnd', [{ x: f6.x, y: f6.y, id: 2 }]);
      eq((await P.st()).sel.f, 6, 'second finger picks a face');
      await P.touch('touchEnd', [{ x: cup.x, y: cup.y, id: 1 }]);
      await P.until(s => s.ownLift < 0.5, 'cup closes when the holding finger lifts');
      q = (await P.st()).sel.q;
      await P.tap('#qm'); await P.until(s => s.sel.q !== q, 'minus'); await sleep(150);
      eq((await P.st()).sel.q, q - 1, 'one tap on − moves exactly one step (no pointerup + click double)');
      ok(!P.errors.length, 'no page errors (touch) ' + P.errors.join(' | '));
      await P.ctx.close();
    }
    // c) confirms for 重設統計 / 清除, 44px setting buttons, daily replay is practice, coach key row, history strip at 360px
    {
      const today = (d => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2))(new Date());
      const stats = { games: 3, wins: 1, lvl: [[0, 0], [3, 1], [0, 0]], calls: 2, callsWon: 1, chal: 0, caught: 0, rounds: 9, ach: { day: 1 }, daily: { [today]: 2 } };
      const P = await open({ vp: { width: 360, height: 640 }, scheme: 'light', store: { stats, model: { bids: 12, bluffs: 3, cs: 1, cn: 2, rs: 1, rn: 2 } } });
      await P.tap('#sStats'); await P.tap('#statReset');
      ok(await P.page.isVisible('#ovAsk'), '重設統計 asks first');
      await P.tap('#askNo');
      ok(await P.page.evaluate(() => JSON.parse(localStorage.getItem('liarsdice:stats')).games) === 3, 'cancel keeps stats');
      await P.tap('#statOk'); await P.tap('#sSet');
      const hs = await P.page.evaluate(() => [...document.querySelectorAll('#ovSet .seg button')].map(b => b.getBoundingClientRect().height));
      ok(Math.min(...hs) >= 44, 'setting buttons at least 44px tall (' + Math.min(...hs) + ')');
      await P.tap('#clrModel');
      ok(await P.page.isVisible('#ovAsk'), '清除 asks first');
      await P.tap('#askOk');
      ok(await P.page.evaluate(() => JSON.parse(localStorage.getItem('liarsdice:model')).bids) === 0, 'confirmed 清除 resets the model');
      await P.tap('#setOk');
      await P.tap('#sDaily');
      let s = await P.until(s => s.round >= 1, 'daily started');
      ok(s.practice, 'second daily game of the day is practice');
      await P.page.evaluate(() => { const G = window.__ld.debug.G(); G.P.forEach((p, i) => { if (i) { p.out = true; p.lives = 0; } }); G.winner = 0; G.phase = 'over'; window.__ld.debug.recordEnd(); });
      eq(await P.page.evaluate(k => JSON.parse(localStorage.getItem('liarsdice:stats')).daily[k], today), 2, 'practice daily does not change today\'s score');
      // history strip: after many bids the leftmost visible chip is whole (not under the fade)
      const P2 = await open({ vp: { width: 360, height: 640 }, hash: '#seed=31' });
      await P2.tap('#sPlay'); await P2.until(s => s.myTurn || (s.bids > 0), 'started');
      const hv = await P2.page.evaluate(() => { const H = document.getElementById('hist'); for (let i = 0; i < 9; i++) window.__ld.debug.addHist({ p: i % 4, q: 10 + i, f: 1 + (i % 6) }); const r = H.getBoundingClientRect(); const vis = [...H.querySelectorAll('.chip')].map(c => c.getBoundingClientRect()).filter(c => c.right > r.left + 0.5 && c.left < r.right - 0.5); return { first: vis[0].left - r.left, last: r.right - vis[vis.length - 1].right }; });
      ok(hv.first >= 5.5 && hv.last >= 0, 'history chips clear of the left fade and fully shown (' + JSON.stringify(hv) + ')');
      // coach: the called bid is the first, highlighted row
      s = await myTurnWithBid(P2);
      const cb = await P2.center('#bCall'); await P2.touch('touchStart', [{ x: cb.x, y: cb.y, id: 3 }]); await P2.until(s => s.phase === 'reveal', 'call', 8000); await P2.touch('touchEnd', []);
      await P2.until(s => s.phase === 'result', 'result', 20000);
      const co = await P2.page.evaluate(() => { const c = document.getElementById('coach'), k = c.querySelector('.crow.key'), r = c.getBoundingClientRect(), kr = k && k.getBoundingClientRect(); return { key: !!k, second: c.children[1] === k, inView: kr && kr.bottom <= r.bottom + 1, q: k && +k.querySelector('b').textContent }; });
      ok(co.key && co.second && co.inView && co.q === s.last.q, 'coach shows the called bid first, highlighted and visible ' + JSON.stringify(co));
      ok(!P.errors.length && !P2.errors.length, 'no page errors (menus) ' + P.errors.concat(P2.errors).join(' | '));
      await P.ctx.close(); await P2.ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL page tests: ' + e.message + ' ' + (e.stack || '').split('\n').slice(1, 3).join(' ')); }
  await browser.close();
  console.log(`  page tests ${((Date.now() - T0) / 1000).toFixed(1)} s`);
})().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
