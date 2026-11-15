// Rule tests for 排七 (sevens). Extracts the engine between the CORE markers of ../index.html,
// checks every rule in the spec, then runs 5000 AI-vs-AI rounds checking legality, the forced-play rule
// and card / point conservation after every move.
// Part 2 drives the real page in mobile Chromium with CDP touch, served over http: the tap layer (resting finger, holds,
// detail-0 click replays), per-finger canvas presses, damaged storage, the match result banked before its results sheet,
// 提示 / 改蓋牌 reachable by touch, and labels that fit (also with a wide fallback font).
// Usage: node tests.js [--rounds N] [--no-browser]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SV = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SV;')();
const { card, suit, rank, COV } = SV;
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const throws = fn => { try { fn(); return false; } catch (e) { return true; } };
const C = s => { const m = s.match(/^(10|[2-9AJQK])([SHDC])$/); return card('SHDC'.indexOf(m[2]), SV.RANKS.indexOf(m[1])); };
const cs = str => str.split(' ').filter(Boolean).map(C);
const names = a => a.map(m => (m >= COV ? 'cover ' : '') + SV.name(m % COV)).sort().join(' ');
// state from explicit hands; rows = {S:[lo,hi]} sets a row from lo..hi (ranks as in RANKS)
function st(hands, rows, o) {
  o = o || {};
  const S = SV.newRound(1, o.opts || {});
  S.hm.fill(0); S.n = [0, 0, 0, 0];
  hands.forEach((h, p) => cs(h).forEach(c => { S.hm[p * 4 + suit(c)] |= 1 << rank(c); S.n[p]++; }));
  for (const k in rows || {}) {
    const s = 'SHDC'.indexOf(k), [a, b] = rows[k].map(x => SV.RANKS.indexOf(x));
    for (let r = a; r <= b; r++) S.played[s] |= 1 << r;
    S.lo[s] = a; S.up[s] = b - 6;
  }
  S.moves = o.moves == null ? 10 : o.moves; S.turn = o.turn || 0;
  return S;
}

// --- deck & deal ---
{
  const hm = SV.deal(42), all = new Set(), each = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (hm[p * 4 + s] & (1 << r)) { all.add(card(s, r)); each[p]++; }
  ok(all.size === 52 && each.every(x => x === 13), '52 distinct cards, 13 per player');
  ok(JSON.stringify(SV.deal(42)) === JSON.stringify(hm) && JSON.stringify(SV.deal(43)) !== JSON.stringify(hm), 'seeded shuffle is reproducible');
  let pts = 0; for (let c = 0; c < 52; c++) pts += SV.val(c);
  ok(pts === 364, 'deck penalty points total 4 × 91 = 364');
  ok(SV.val(C('AS')) === 1 && SV.val(C('10H')) === 10 && SV.val(C('JD')) === 11 && SV.val(C('QC')) === 12 && SV.val(C('KS')) === 13, 'A=1, 2–10 face, J=11, Q=12, K=13');
  // ♠7 holder frequency per seat ≈ 25% each (recomputed, not from memory)
  const seat = [0, 0, 0, 0]; for (let i = 0; i < 20000; i++) seat[SV.newRound(i).start]++;
  ok(seat.every(x => Math.abs(x / 20000 - .25) < .015), '♠7 holder is uniform over seats: ' + seat.join('/'));
}
// --- opening ---
{
  for (let seed = 0; seed < 200; seed++) {
    const S = SV.newRound(seed);
    if (!(S.turn === S.start && SV.has(S, S.turn, SV.S7))) { ok(false, 'holder of ♠7 starts, seed ' + seed); break; }
    if (names(SV.moves(S)) !== '♠7') { ok(false, 'first move must be ♠7 only, seed ' + seed); break; }
  }
  ok(true, 'holder of ♠7 starts and ♠7 is the only legal first move (200 deals)');
  const S = st(['7S 7H 7D 7C 2S', 'AS', 'KD', 'QH'], {}, { moves: 0 });
  ok(names(SV.moves(S, 0)) === '♠7', 'holding all four 7s, only ♠7 opens the round');
  ok(!SV.isLegal(S, C('7H')) && !SV.isLegal(S, C('2S') + COV), 'other 7s and covering are illegal on the first move');
  SV.apply(S, C('7S'));
  ok(S.lo[0] === 6 && S.up[0] === 0 && S.turn === 1 && S.moves === 1, 'after ♠7 the row opens and the turn passes on');
  const F = st(['7S 2C', 'AS', 'KD', 'QH'], {}, { moves: 0, opts: { free: true } });
  ok(names(SV.moves(F, 0)) === '♠7', 'free-cover variant still forces ♠7 as the first move');
}
// --- 7 opens a row, only ends extend ---
{
  const S = st(['6H 8H 7D 6S 8S 5S 9S', 'AS', 'KD', 'QH'], { S: ['7', '7'] });
  ok(names(SV.legal(S, 0)) === '♠6 ♠8 ♦7', 'closed suit: 6/8 not playable before its 7; any 7 opens; open row takes 6 and 8');
  ok(!SV.isLegal(S, C('5S')) && !SV.isLegal(S, C('9S')), 'cards not next to an end are illegal');
  SV.apply(S, C('6S'));
  ok(S.lo[0] === 5 && SV.endMask(S, 0) === ((1 << 4) | (1 << 7)), 'after ♠6 the ends are ♠5 and ♠8');
  const T = st(['AS KS', 'x'.slice(1), '', ''], { S: ['2', 'Q'] });
  ok(names(SV.legal(T, 0)) === '♠A ♠K', 'both ends: A below 2 and K above Q');
  SV.apply(T, C('KS'));
  ok(SV.endMask(T, 0) === 1, 'without the wrap option nothing goes above K');
}
// --- A after K option ---
{
  const S = st(['AS 2S', '', '', ''], { S: ['3', 'K'] }, { opts: { wrap: true } });
  ok(names(SV.legal(S, 0)) === '♠2 ♠A', 'wrap on: both the lower end (♠2) and A-after-K are playable');
  const T = st(['AS', '', '', ''], { S: ['5', 'K'] }, { opts: { wrap: true } });
  ok(names(SV.legal(T, 0)) === '♠A', 'wrap on: A can be attached after K');
  const U = st(['AS', '', '', ''], { S: ['5', 'K'] }, { opts: { wrap: false } });
  ok(SV.legal(U, 0).length === 0, 'wrap off (default): A cannot follow K');
  SV.apply(T, C('AS'));
  ok(SV.endMask(T, 0) === ((1 << 1) | (1 << 3)), 'after wrapping A the upper end continues with 2 (lower end still 4)');
}
// --- forced play & cover ---
{
  const S = st(['8S KD 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(S, 0)) === '♠8', 'with a playable card the only options are plays (no cover)');
  ok(!SV.isLegal(S, C('2C') + COV) && throws(() => SV.apply(S, C('2C') + COV)), 'covering while holding a playable card is rejected by the rule layer');
  const T = st(['9S KD 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(T, 0)) === 'cover ♠9 cover ♣2 cover ♦K', 'nothing playable: any hand card may be covered');
  SV.apply(T, C('KD') + COV);
  ok(T.pen[0] === 13 && T.cn[0] === 1 && T.cov[0][0] === C('KD') && T.n[0] === 2, 'cover adds face value to the penalty and keeps the card face down');
  ok(T.nh[0] === ((1 << 5) | (1 << 7)) && T.nh[1] === 64 && T.nh[2] === 64 && T.nh[3] === 64, 'covering reveals the player holds none of the current end cards (♠6, ♠8 and the unopened ♥7 ♦7 ♣7)');
  const F = st(['8S 2C', 'QH', 'QD', 'QC'], { S: ['7', '7'] }, { opts: { free: true } });
  ok(names(SV.moves(F, 0)) === 'cover ♠8 cover ♣2 ♠8', 'free-cover variant: may cover even with a playable card');
  SV.apply(F, C('2C') + COV);
  ok(F.nh[0] === 0, 'free-cover variant: a cover reveals nothing');
  const Last = st(['8S', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(Last, 0)) === '♠8', 'the last card in hand also obeys forced play');
  const LastC = st(['9S', 'QH', 'QD', 'QC'], { S: ['7', '7'] });
  ok(names(SV.moves(LastC, 0)) === 'cover ♠9', 'a stuck last card must be covered');
}
// --- full round, scoring, match ---
{
  const S = SV.newRound(99), rnd = SV.rng(5);
  while (!S.done) SV.apply(S, SV.easyPlay(S, S.turn, rnd));
  ok(S.moves === 52 && S.n.every(x => x === 0) && S.hm.every(x => x === 0), 'round ends after 52 actions with every hand empty');
  ok(S.pen.every((x, p) => x === S.cov[p].reduce((a, c) => a + SV.val(c), 0)), 'penalty = sum of covered card values');
  let board = 0; for (let s = 0; s < 4; s++) for (let r = 0; r < 13; r++) if (S.played[s] & (1 << r)) board += r + 1;
  ok(board + S.pen.reduce((a, b) => a + b) === 364, 'board points + penalties = 364');
  const M = SV.newMatch(7, {}, 5);
  ok(M.len === 5, 'default match is 5 rounds');
  const want = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const R = SV.startRound(M), rr = SV.rng(i);
    while (!R.done) SV.apply(R, SV.easyPlay(R, R.turn, rr));
    R.pen.forEach((x, p) => want[p] += x);
    ok(!M.over, 'match not over before the last round'); SV.finishRound(M, R);
  }
  ok(M.over && JSON.stringify(M.totals) === JSON.stringify(want), 'totals accumulate over 5 rounds');
  const mn = Math.min(...want);
  ok(JSON.stringify(M.winners) === JSON.stringify([0, 1, 2, 3].filter(p => want[p] === mn)), 'lowest total wins');
  const T = SV.newMatch(1, {}, 1), R = SV.startRound(T); R.done = true; R.pen = [5, 5, 9, 12];
  SV.finishRound(T, R);
  ok(JSON.stringify(T.winners) === '[0,1]', 'tied lowest totals share the win');
  ok(throws(() => SV.finishRound(SV.newMatch(1), SV.newRound(1))), 'an unfinished round cannot be scored');
}
// --- hidden information ---
{
  const S = SV.newRound(3), rnd = SV.rng(3);
  for (let i = 0; i < 20; i++) SV.apply(S, SV.easyPlay(S, S.turn, rnd));
  const V = SV.viewFor(S, 2);
  ok([0, 1, 3].every(q => [0, 1, 2, 3].every(s => V.hm[q * 4 + s] === 0) && V.cov[q].length === 0) && JSON.stringify(V.cov[2]) === JSON.stringify(S.cov[2]), 'viewFor hides the other hands and their face-down cards');
  let good = true;
  for (let k = 0; k < 200; k++) {
    const W = SV.sampleWorld(V, 2, SV.rng(k));
    for (let q = 0; q < 4; q++) { let n = 0; for (let s = 0; s < 4; s++) n += SV.pc(W.hm[q * 4 + s]); if (n !== S.n[q]) good = false; }
    for (let s = 0; s < 4; s++) { if (W.hm[2 * 4 + s] !== S.hm[2 * 4 + s]) good = false; let u = 0; for (let q = 0; q < 4; q++) { if (u & W.hm[q * 4 + s]) good = false; u |= W.hm[q * 4 + s]; } if (u & S.played[s]) good = false; }
    for (let q = 0; q < 4; q++) for (let s = 0; s < 4; s++) if (W.hm[q * 4 + s] & S.nh[q * 4 + s]) good = false;
  }
  ok(good, 'sampled deals keep hand sizes, my hand, unplayed cards only, and the known "has none" sets');
}
// --- 5000 AI-vs-AI rounds ---
{
  const args = process.argv.slice(2), N = +(args[args.indexOf('--rounds') + 1] || 5000) || 5000;
  const t0 = Date.now(); let moves = 0, covers = 0, forcedViol = 0, illegal = 0, conserve = 0, nhBad = 0, ex = [], optsSeen = { wrap: 0, free: 0 };
  const CFG = { ms: 15, minS: 6, maxS: 12 };
  for (let i = 0; i < N; i++) {
    const opts = { wrap: i % 7 === 3, free: i % 11 === 5 }; if (opts.wrap) optsSeen.wrap++; if (opts.free) optsSeen.free++;
    const S = SV.newRound(SV.hash('t', i), opts), lv = [0, 1, 2, 3].map(p => (i + p) % 3);
    while (!S.done) {
      const p = S.turn, r = SV.think(SV.viewFor(S, p), p, lv[p], SV.hash(i, S.moves), CFG), m = r.move;
      if (lv[p] === 2) ex.push(r.ms);
      if (!SV.isLegal(S, m)) { illegal++; break; }
      if (m >= COV && SV.canPlay(S, p) && !opts.free) forcedViol++;
      if (m >= COV) covers++;
      SV.step(S, m); moves++;
      let n = 0; for (let x = 0; x < 16; x++) n += SV.pc(S.hm[x]);
      let b = 0; for (let s = 0; s < 4; s++) b += SV.pc(S.played[s]);
      if (n + b + S.cn.reduce((a, c) => a + c) !== 52 || n !== S.n.reduce((a, c) => a + c)) conserve++;
      for (let q = 0; q < 4; q++) for (let s = 0; s < 4; s++) if (S.hm[q * 4 + s] & S.nh[q * 4 + s]) nhBad++;
    }
    if (!S.done || S.moves !== 52) conserve++;
  }
  ok(!illegal, 'AI never chose an illegal move (' + illegal + ')');
  ok(!forcedViol, 'nobody covered while holding a playable card (' + forcedViol + ')');
  ok(!conserve, 'hand + board + covered = 52 after every move (' + conserve + ' violations)');
  ok(!nhBad, '"has none of" inference is never contradicted by a real hand (' + nhBad + ')');
  console.log(`self-play: ${N} rounds (${optsSeen.wrap} with A-after-K, ${optsSeen.free} free-cover), ${moves} moves, ${covers} covers, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
// --- AI strength probes ---
{
  const S = st(['7H 8S KS', 'QS', '6H 5H 4H', 'JD'], { S: ['7', '7'] });
  ok(SV.rulePlay(S, 0, SV.PERS[1]) === C('8S'), '一般: prefers the play that leads toward its own high cards (♠8 → ♠K) over opening ♥7 for others');
  const T = st(['9S KD 2C 5H', 'QS', 'QD', 'QC'], { S: ['7', '7'] });
  ok(SV.rulePlay(T, 0, SV.PERS[1]) === C('2C') + COV, '一般: covers its smallest card');
  // expert think time with the page's settings
  const times = [], CFG = { ms: 80, minS: 40, maxS: 100 }, smp = [];
  for (let i = 0; i < 60; i++) {
    const R = SV.newRound(SV.hash('time', i)), rnd = SV.rng(i);
    for (let k = 0; k < 4 + (i % 30); k++) SV.apply(R, SV.easyPlay(R, R.turn, rnd));
    const p = R.turn, r = SV.think(SV.viewFor(R, p), p, 2, i, CFG); times.push(r.ms); if (r.samples) smp.push(r.samples);
  }
  times.sort((a, b) => a - b); smp.sort((a, b) => a - b);
  console.log(`高手 think (page settings, 100 samples cap, 80 ms budget): median ${times[30]}ms, max ${times[59]}ms; samples median ${smp[smp.length >> 1]}, min ${smp[0]}`);
  ok(times[59] < 120, '高手 stays within its time budget');
}

// ================= real page in mobile Chromium (CDP touch), served over http =================
const http = require('http');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, server, base, tid = 1;
const WIDE = '*{font-family:"DejaVu Sans","WenQuanYi Zen Hei",sans-serif !important;letter-spacing:.12em !important}';
function serve() {
  return new Promise(res => {
    server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(path.resolve(__dirname, '..', 'index.html'))); });
    server.listen(0, '127.0.0.1', () => { server.unref(); base = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
  });
}
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 90 s')), 90000); })]); clearTimeout(tm); console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
// saved states built with the page's own engine, in the shape the page saves (old saves load the same way)
function roundTo(M, stop) { const S = SV.startRound(M); while (!S.done && !stop(S)) SV.step(S, SV.rulePlay(S, S.turn, SV.PERS[S.turn])); return S; }
const saveOf = (M, S, level = 1) => JSON.stringify({ v: 1, M, S, level, daily: null, flags: { rows: 0 } });
function findState(len, opts, want) { for (let seed = 1; seed < 3000; seed++) { const M = SV.newMatch(seed, opts, len), S = roundTo(M, want); if (!S.done) return { M, S }; } throw new Error('no state'); }
// one-round match where you (seat 0, who opens) have just played your 13th card: three computer moves end it
function nearEnd() {
  for (let seed = 1; ; seed++) { const M = SV.newMatch(seed, {}, 1), S = SV.startRound(M); if (S.start !== 0) continue; const T = roundTo(M, X => X.moves === 49); return { M, S: T }; }
}
const SETS = o => JSON.stringify(Object.assign({ fast: true, snd: false, vib: false, len: 1, level: 1 }, o));
async function open(vp, ls, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base); await page.waitForFunction(() => window.__sevens);
  if (ls) { await page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('sevens:' + k, ls[k]); }, ls); await page.reload(); await page.waitForFunction(() => window.__sevens); }
  if (o.wide) await page.addStyleTag({ content: WIDE });
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (x, y, hold = 40) => { const id = ++tid; await touch('touchStart', [{ x, y, id }]); await sleep(hold); await touch('touchEnd', [{ x, y, id }]); };
  const info = () => page.evaluate(() => window.__sevens.info());
  const mid = async sel => { const b = await page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel); return b; };
  const settle = () => page.waitForFunction(() => [...document.querySelectorAll('.ov:not([hidden]) .sheet')].every(c => c.getAnimations().every(a => a.playState !== 'running')), null, { timeout: 10000 }).catch(() => {});
  const tapSel = async (sel, hold) => { await settle(); const [x, y] = await mid(sel); await tap(x, y, hold); };
  const until = (fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms });
  const myTurn = () => until(() => { const i = window.__sevens.info(); return i.wait && !i.ov.length; });
  const resume = async () => { await tapSel('#bResume'); await until(() => !window.__sevens.info().ov.length); };
  const stats = () => page.evaluate(() => window.__sevens.stats());
  return { ctx, page, errors, touch, tap, tapSel, info, mid, until, myTurn, resume, stats, settle, close: () => ctx.close() };
}
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  await serve(); browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch, http)');
  try {
    await at('buttons fire from pointerup with a finger resting on the table; holds fire once; a detail-0 click after a tap adds nothing', async () => {
      const cov = findState(3, {}, S => S.turn === 0 && S.moves > 0 && !SV.canPlay(S, 0));
      const s = await open({ width: 390, height: 844 }, { settings: SETS({ len: 3 }), match: saveOf(cov.M, cov.S) });
      await s.resume(); await s.myTurn();
      const rest = ++tid, R = { x: 200, y: 330 };
      const restDown = () => s.touch('touchStart', [{ ...R, id: rest }]);
      const tap2 = async (sel, ms = 50) => { const [x, y] = await s.mid(sel), id = ++tid; await s.touch('touchStart', [{ ...R, id: rest }, { x, y, id }]); await sleep(ms); await s.touch('touchEnd', [{ x, y, id }]); await sleep(150); };
      await restDown(); await sleep(60);
      const snd0 = (await s.page.evaluate(() => window.__sevens.set())).snd;
      await tap2('#bSnd'); ok((await s.page.evaluate(() => window.__sevens.set())).snd === !snd0, '音效 toggles with another finger resting on the table');
      await tap2('#bSheet'); ok((await s.info()).ov.includes('ovSheet'), '計分表 opens with another finger resting on the table');
      await s.touch('touchEnd', [{ ...R, id: rest }]); await sleep(100);
      await s.tapSel('#ovSheet [data-close]'); await s.until(() => !window.__sevens.info().ov.length);
      // select a card to cover, then 蓋掉 with the resting finger down
      const c = SV.hand(cov.S, 0)[0], pt = await s.page.evaluate(c => window.__sevens.cardPt(c), c);
      await s.tap(pt.x, pt.y); await s.until(c => window.__sevens.info().sel === c, c, 5000);
      const m0 = (await s.info()).moves;
      await restDown(); await sleep(60); await tap2('#act');
      await s.until(m0 => window.__sevens.info().moves > m0, m0, 5000).catch(() => {});
      ok((await s.info()).moves === m0 + 1, '蓋掉 covers once with another finger resting on the table');
      await s.touch('touchEnd', [{ ...R, id: rest }]); await sleep(100);
      // holds of 0.6 s and 1 s on 音效 fire exactly once each
      let v = (await s.page.evaluate(() => window.__sevens.set())).snd, [x, y] = await s.mid('#bSnd');
      await s.tap(x, y, 600); await sleep(150); ok((await s.page.evaluate(() => window.__sevens.set())).snd === !v, '0.6 s hold on 音效 toggles once');
      await s.tap(x, y, 1000); await sleep(150); ok((await s.page.evaluate(() => window.__sevens.set())).snd === v, '1 s hold on 音效 toggles once');
      // a tap, then the detail-0 click Chromium 141 may send: on the control, on its edge and on whatever is under the finger
      const replay = sel => s.page.evaluate(sel => {
        const el = document.querySelector(sel), r = el.getBoundingClientRect(), mk = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
        el.dispatchEvent(mk()); (document.elementFromPoint(r.right - 2, r.bottom - 2) || el).dispatchEvent(mk());
        (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) || el).dispatchEvent(mk());
      }, sel);
      const f0 = (await s.page.evaluate(() => window.__sevens.tap())).fired;
      v = (await s.page.evaluate(() => window.__sevens.set())).snd; await s.tap(x, y); await replay('#bSnd'); await sleep(150);
      ok((await s.page.evaluate(() => window.__sevens.set())).snd === !v && (await s.page.evaluate(() => window.__sevens.tap())).fired === f0 + 1, '音效: tap + detail-0 clicks toggled once');
      // a tap that opens a sheet: the click that follows lands on the new screen and does nothing there
      [x, y] = await s.mid('#bSheet'); await s.tap(x, y);
      await s.page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, [x, y]);
      await sleep(150); ok((await s.info()).ov.includes('ovSheet'), 'the click after the tap that opened 計分表 did nothing on the sheet');
      await s.tapSel('#ovSheet [data-close]'); await s.until(() => !window.__sevens.info().ov.length);
      await sleep(900); v = (await s.page.evaluate(() => window.__sevens.set())).snd;
      await s.page.evaluate(() => document.querySelector('#bSnd').click()); await sleep(100);
      ok((await s.page.evaluate(() => window.__sevens.set())).snd === !v, 'a lone detail-0 click (no tap in the last 800 ms) acts once');
      await s.page.focus('#bSnd'); await s.page.keyboard.press('Enter'); await sleep(100);
      ok((await s.page.evaluate(() => window.__sevens.set())).snd === v, 'Enter on the focused 音效 key acts once');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });

    await at('two fingers on two cards: lifting the first plays the first finger\'s card, never the second\'s; 下一局 works with a resting finger', async () => {
      const st = findState(3, {}, S => S.turn === 0 && S.moves > 0 && SV.legal(S, 0).length >= 2);
      const s = await open({ width: 390, height: 844 }, { settings: SETS({ len: 3 }), match: saveOf(st.M, st.S) });
      await s.resume(); await s.myTurn(); await sleep(400);
      const [a, b] = SV.legal(st.S, 0), pa = await s.page.evaluate(c => window.__sevens.cardPt(c), a), pb = await s.page.evaluate(c => window.__sevens.cardPt(c), b);
      const A = { x: pa.x, y: pa.y, id: ++tid }, B = { x: pb.x, y: pb.y, id: ++tid };
      await s.touch('touchStart', [A]); await sleep(60); await s.touch('touchStart', [A, B]); await sleep(60);
      await s.touch('touchEnd', [A]); await sleep(300);
      let V = await s.page.evaluate(() => window.__sevens.view());
      const has = (V, c) => !!(V.played[SV.suit(c)] >> SV.rank(c) & 1);
      ok(has(V, a) && !has(V, b), 'finger 1 up: ' + SV.name(a) + ' played, ' + SV.name(b) + ' not');
      await s.touch('touchEnd', [B]); await sleep(300);
      V = await s.page.evaluate(() => window.__sevens.view());
      ok(!has(V, b), 'finger 2 up after the turn passed: ' + SV.name(b) + ' still in hand');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
      // 下一局 / 查看最終結果 with a finger resting on the sheet's backdrop
      const ne = nearEnd(), t = await open({ width: 390, height: 844 }, { settings: SETS(), match: saveOf(ne.M, ne.S) });
      await t.resume(); await t.until(() => window.__sevens.info().ov.includes('ovRound')); await t.settle();
      const [x, y] = await t.mid('#bNext'), rest = { x: 30, y: 300, id: ++tid }, f = { x, y, id: ++tid };
      await t.touch('touchStart', [rest]); await sleep(80); await t.touch('touchStart', [rest, f]); await sleep(50); await t.touch('touchEnd', [f]); await sleep(300);
      ok((await t.info()).ov.includes('ovEnd'), '查看最終結果 works with another finger down');
      await t.touch('touchEnd', [rest]);
      ok(!t.errors.length, 'no page errors ' + t.errors.join(' | ')); await t.close();
    });

    await at('damaged storage boots to the menu and rounds still finish, with no page error', async () => {
      const ne = nearEnd(), good = saveOf(ne.M, ne.S);
      const cases = [['settings', '{'], ['settings', 'null'], ['settings', '5'], ['settings', '[]'], ['settings', '{"level":9,"len":1}'], ['settings', '{"level":"2","len":1}'], ['settings', '{"skin":"zzz","len":1}'], ['settings', '{"len":"x"}'], ['settings', '{"len":0}'],
        ['stats', '{'], ['stats', '{"lv":5}'], ['stats', '{"lv":[[1],null,"x"]}'], ['stats', '{"suitCov":null}'], ['stats', '{"suitCov":[1,"a"]}'], ['stats', '{"ach":null}'], ['stats', '{"daily":null}'], ['stats', '{"daily":[3]}'], ['stats', '{"best":5,"games":"x"}'], ['stats', '[1,2]'],
        ['match', '{'], ['match', '{"v":1,"M":{}}'], ['match', '{"v":1,"M":{"over":false},"S":{}}'], ['match', '{"v":1,"M":{"seed":1,"len":5,"round":0,"totals":[0,0,0,0],"rounds":[],"over":false,"opts":{}},"S":{"hm":[1]}}'],
        ['match', '{"v":1,"M":{"seed":1,"len":5,"round":0,"totals":[0,0,0,0],"rounds":[],"over":false,"opts":{}},"S":null,"level":7}'], ['match', '{"v":1,"M":{"seed":1,"len":5,"round":2,"totals":[0,0,0,0],"rounds":[],"over":false,"opts":{}},"S":null}'],
        ['match', '{"v":1,"M":{"seed":1,"len":3,"round":0,"totals":[0,0,0,0],"rounds":[],"over":false,"opts":{}},"S":{"hist":[999,"x"]}}']];
      const lanes = await Promise.all([0, 1, 2, 3, 4].map(() => open({ width: 390, height: 844 })));
      const one = async (s, k, v) => {
        s.errors.length = 0;
        const ls = { settings: SETS(), [k]: v }; if (k !== 'match') ls.match = good;
        await s.page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('sevens:' + k, ls[k]); }, ls);
        await s.page.reload(); await s.page.waitForFunction(() => window.__sevens);
        const boot = await s.info(); s.last = boot;
        let done = false;
        if (k !== 'match') { // the saved near-finished match plays out: round results, then the final results
          await s.resume(); await s.until(() => window.__sevens.info().ov.includes('ovRound'));
          await s.tapSel('#bNext'); await s.until(() => window.__sevens.info().ov.includes('ovEnd'), null, 5000);
          done = (await s.stats()).games >= 1;
        } else { // the bad match is dropped: a new match deals and reaches your turn or a computer move
          await s.tapSel('#bNew'); await s.until(() => { const i = window.__sevens.info(); return !i.ov.length && (i.wait || i.moves >= 1); });
          done = true;
        }
        ok(boot.ov.includes('ovMenu') && done && !s.errors.length, `${k}=${v}: menu at boot, play went on (${done}) ` + s.errors.join(' | '));
      };
      await Promise.all(lanes.map(async (s, i) => { for (let j = i; j < cases.length; j += lanes.length) await one(s, ...cases[j]).catch(e => ok(false, cases[j].join('=') + ': ' + String(e.message).split('\n')[0] + ' ' + JSON.stringify(s.last))); }));
      const s = lanes[0]; await Promise.all(lanes.slice(1).map(x => x.close()));
      // old saves in the page's own shape still load exactly (hand, board, turn)
      const mid = findState(5, { wrap: true }, S => S.moves === 23 && S.turn === 0);
      await s.page.evaluate(ls => { localStorage.clear(); for (const k in ls) localStorage.setItem('sevens:' + k, ls[k]); }, { settings: SETS(), match: saveOf(mid.M, mid.S), stats: JSON.stringify({ games: 4, wins: 2, rounds: 9, pen: 80, zero: 1, suitCov: [1, 2, 3, 4], best: { v: 30, len: 3 }, lv: [[1, 1], [2, 1], [1, 0]], ach: { first: 5 }, daily: { '2026-11-01': 12 } }) });
      await s.page.reload(); await s.page.waitForFunction(() => window.__sevens);
      const V = await s.page.evaluate(() => window.__sevens.view()), st = await s.stats();
      ok(JSON.stringify(V.hm.slice(0, 4)) === JSON.stringify(mid.S.hm.slice(0, 4)) && JSON.stringify(V.played) === JSON.stringify(mid.S.played) && V.turn === 0 && V.opts.wrap === true, 'a valid saved round loads exactly');
      ok(st.games === 4 && st.wins === 2 && st.best.v === 30 && st.daily['2026-11-01'] === 12 && st.ach.first === 5 && st.lv[1][1] === 1, 'valid stats load unchanged');
      await s.close();
    });

    await at('the match result is banked when the last round is scored: a reload on its results sheet keeps it, and it counts once', async () => {
      const ne = nearEnd();
      const s = await open({ width: 390, height: 844 }, { settings: SETS(), match: saveOf(ne.M, ne.S) });
      await s.resume(); await s.until(() => window.__sevens.info().ov.includes('ovRound'));
      const st1 = await s.stats();
      ok(st1.games === 1 && st1.rounds === 1, 'stats hold the match as soon as the final round results show (games ' + st1.games + ')');
      await s.page.reload(); await s.page.waitForFunction(() => window.__sevens);
      const st2 = await s.stats(), i2 = await s.info(), resume = await s.page.evaluate(() => !document.getElementById('bResume').hidden);
      ok(st2.games === 1 && st2.rounds === 1 && i2.ov.includes('ovMenu') && !resume && !(await s.page.evaluate(() => localStorage.getItem('sevens:match'))), 'after a reload the result is still there, no stale match to resume');
      // the same match once more without a reload: 查看最終結果 does not count it again
      await s.page.evaluate(m => localStorage.setItem('sevens:match', m), saveOf(ne.M, ne.S)); await s.page.reload(); await s.page.waitForFunction(() => window.__sevens);
      await s.resume(); await s.until(() => window.__sevens.info().ov.includes('ovRound'));
      await s.tapSel('#bNext'); await s.until(() => window.__sevens.info().ov.includes('ovEnd'), null, 5000);
      ok((await s.stats()).games === 2, 'a second match counts once, showing its final results adds nothing (' + (await s.stats()).games + ')');
      // a reload in the moment between the last card and the round results scores the round on load
      const full = SV.newMatch(ne.M.seed, {}, 1), F = roundTo(full, () => false);
      await s.page.evaluate(m => { localStorage.setItem('sevens:match', m); }, saveOf(full, F)); await s.page.reload(); await s.page.waitForFunction(() => window.__sevens);
      await s.resume(); await s.until(() => window.__sevens.info().ov.includes('ovRound'));
      ok((await s.stats()).games === 3, 'a finished but unscored round is scored after a reload');
      ok(!s.errors.length, 'no page errors ' + s.errors.join(' | ')); await s.close();
    });

    await at('提示 and 改蓋牌 sit above the table and work by touch; labels fit (also with a wide font); the chosen card stays clear of 蓋掉', async () => {
      const st = findState(5, { free: true }, S => S.turn === 0 && S.moves > 0 && SV.canPlay(S, 0) && S.n[0] >= 9 && SV.hand(S, 0).some(c => SV.rank(c) === 9));
      for (const [w, h, wide] of [[360, 640, false], [390, 844, false], [844, 390, false], [360, 640, true], [844, 390, true]]) {
        const s = await open({ width: w, height: h }, { settings: SETS(), match: saveOf(st.M, st.S) }, { wide });
        const tag = `${w}x${h}${wide ? ' wide font' : ''}`;
        if (w === 360) { // the start menu fits a 360x640 screen without scrolling
          const m = await s.page.evaluate(() => { const o = document.getElementById('ovMenu'), b = o.querySelector('.sheet').getBoundingClientRect(); return { fit: o.scrollHeight <= o.clientHeight && b.top >= 0 && b.bottom <= innerHeight, h: Math.round(b.height) }; });
          ok(m.fit, tag + ': menu fits without scrolling (' + m.h + 'px)');
        }
        await s.resume(); await s.myTurn();
        const top = await s.page.evaluate(() => ['bHint', 'bMode'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { id, on: !!t && t.closest('button') === e, r: [r.left, r.top, r.right, r.bottom] }; }));
        const [hb, mb] = top.map(t => t.r), apart = hb[0] >= mb[2] || mb[0] >= hb[2] || hb[1] >= mb[3] || mb[1] >= hb[3];
        ok(top.every(t => t.on) && apart, tag + ': 提示 and 改蓋牌 are on top and apart ' + JSON.stringify(top));
        await s.tapSel('#bMode'); await s.until(() => window.__sevens.info().cover, null, 3000).catch(() => {});
        ok((await s.info()).cover, tag + ': 改蓋牌 by touch enters free cover');
        const c = SV.hand(st.S, 0).find(c => SV.rank(c) === 9), pt = await s.page.evaluate(c => window.__sevens.cardPt(c), c);
        await s.tap(pt.x, pt.y); await s.until(c => window.__sevens.info().sel === c, c, 3000); await sleep(500);
        const r = await s.page.evaluate(c => {
          const fit = id => { const e = document.getElementById(id); return e.scrollWidth <= e.clientWidth + 1 && parseFloat(getComputedStyle(e).fontSize) >= 9; };
          const a = document.getElementById('act').getBoundingClientRect();
          return { act: fit('act'), label: document.getElementById('act').textContent, sub: fit('tSub'), round: fit('tRound'), mode: fit('bMode'), gap: window.__sevens.cardTop(c) - a.bottom, land: innerWidth > innerHeight, sub2: document.getElementById('tSub').textContent };
        }, c);
        ok(r.act && r.mode && r.sub && r.round, tag + ': 蓋掉 label, 改出牌 and the title lines fit uncut ' + JSON.stringify(r));
        ok(r.land || r.gap >= 3, tag + ': the chosen card\'s corner stays below 蓋掉 (gap ' + r.gap.toFixed(1) + 'px)');
        const m0 = (await s.info()).moves; await s.tapSel('#act'); await s.until(m0 => window.__sevens.info().moves > m0, m0, 3000).catch(() => {});
        ok((await s.info()).moves === m0 + 1, tag + ': free cover played by touch');
        if (w === 390) { // 提示 by touch shows a suggestion instead of tapping the hand behind it
          await s.myTurn(); await s.tapSel('#bHint');
          await s.page.waitForFunction(() => /建議/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
          ok(/建議/.test(await s.page.textContent('#toast')), tag + ': 提示 by touch gives a suggestion');
        }
        ok(!s.errors.length, tag + ': no page errors ' + s.errors.join(' | ')); await s.close();
      }
    });
  } finally { await browser.close(); }
}
(async () => {
  if (!process.argv.includes('--no-browser')) await browserTests();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
