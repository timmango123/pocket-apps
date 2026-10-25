// Rule unit tests for 大老二 (big-two), run against the game's own core (CORE-START/CORE-END markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const B2 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return B2;')();
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const R = { '3': 0, '4': 1, '5': 2, '6': 3, '7': 4, '8': 5, '9': 6, '10': 7, J: 8, Q: 9, K: 10, A: 11, '2': 12 }, SU = { c: 0, d: 1, h: 2, s: 3 };
const c = s => { const m = s.match(/^(10|[2-9JQKA])([cdhs])$/); return R[m[1]] * 4 + SU[m[2]]; };
const cs = s => s.split(' ').map(c);
const TW = B2.mkRules({}), FL = B2.mkRules({ flush: true }), TR = B2.mkRules({ triple: true }), BO = B2.mkRules({ bomb: true }), HK = B2.mkRules(B2.PRESETS.hk.rules), LK = B2.mkRules({ passLock: true }), NO2 = B2.mkRules({ twoDouble: false });
const ev = (s, r) => B2.evaluate(cs(s), r || TW);
const type = (s, r) => { const e = ev(s, r); return e ? (e.n === 5 ? B2.CAT_NAMES[e.cat] : e.n) : null; };
const gt = (a, b, r) => B2.beats(ev(a, r), ev(b, r), r || TW);

// --- card order: rank then suit (♠ > ♥ > ♦ > ♣) ---
ok(gt('2c', 'As'), 'single 2 > A'); ok(gt('As', 'Ks'), 'A > K'); ok(gt('Kc', 'Qs'), 'K > Q'); ok(gt('4c', '3s'), '4 > 3');
ok(gt('3s', '3h'), '♠ > ♥'); ok(gt('3h', '3d'), '♥ > ♦'); ok(gt('3d', '3c'), '♦ > ♣'); ok(!gt('3c', '3d'), '♣ < ♦');
ok(gt('2s', '2h'), '♠2 is top'); ok(!gt('10s', 'Jc'), '10 < J');
// --- pairs ---
ok(type('7c 7d') === 2, 'pair'); ok(type('7c 8c') === null, 'non pair rejected');
ok(gt('7c 7s', '7d 7h'), 'pair compared by higher card (♠7)'); ok(!gt('7c 7h', '7d 7s'), 'pair ♥ high < ♠ high');
ok(gt('8c 8d', '7h 7s'), 'pair 8 > pair 7'); ok(gt('2c 2d', 'Ah As'), 'pair 2 > pair A');
// --- triple (option) ---
ok(type('9c 9d 9h') === null, 'triple not allowed by default'); ok(type('9c 9d 9h', TR) === 3, 'triple allowed with option');
ok(gt('10c 10d 10h', '9c 9d 9s', TR), 'triple compare by rank'); ok(type('9c 9d 8h', TR) === null, 'mixed triple rejected');
// --- straights ---
ok(type('3c 4d 5h 6s 7c') === '順子', '34567 straight'); ok(type('10c Jd Qh Ks Ac') === '順子', '10JQKA straight');
ok(type('Ac 2d 3h 4s 5c') === '順子', 'A2345 straight'); ok(type('2c 3d 4h 5s 6c') === '順子', '23456 straight');
ok(type('Jc Qd Kh As 2c') === null, 'JQKA2 illegal'); ok(type('Qc Kd Ah 2s 3c') === null, 'QKA23 illegal'); ok(type('Kc Ad 2h 3s 4c') === null, 'KA234 illegal');
ok(type('3c 4d 5h 6s 8c') === null, 'gap rejected'); ok(type('9c 10d Jh Qs Kc') === '順子', '9-K straight');
ok(gt('2c 3d 4h 5s 6c', 'Ac 2s 3h 4s 5c'), '23456 > A2345'); ok(gt('Ac 2c 3h 4s 5c', '10s Js Qs Ks Ah'), 'A2345 > 10JQKA');
ok(gt('10c Jd Qh Ks Ac', '9s 10s Jh Qs Ks'), '10JQKA > 9-K'); ok(gt('4c 5d 6h 7s 8c', '3s 4s 5h 6s 7s'.replace('7s', '7h')), '45678 > 34567');
ok(gt('3c 4d 5h 6s 7s', '3s 4s 5h 6d 7h'), 'same level: compare top card suit (♠7 > ♥7)');
ok(gt('2s 3c 4d 5h 6c', '2h 3s 4s 5s 6s'.replace('6s', '6d')), '23456: decided by the 2 (♠2 > ♥2)');
ok(gt('Ac 2s 3c 4d 5h', 'As 2h 3s 4s 5s'.replace('5s', '5d')), 'A2345: decided by the 2, not the A');
ok(!gt('3c 4d 5h 6s 7c', '3d 4c 5c 6c 7d'), '♣7 top < ♦7 top');
// --- full house / four / straight flush ---
ok(type('8c 8d 8h 3c 3d') === '葫蘆', 'full house'); ok(type('8c 8d 8h 8s 3d') === '鐵支', 'four of a kind');
ok(type('5h 6h 7h 8h 9h') === '同花順', 'straight flush'); ok(type('Ah 2h 3h 4h 5h') === '同花順', 'A2345 flush straight');
ok(type('Jh Qh Kh Ah 2h') === null, 'JQKA2 flush still illegal (no flush rule)');
ok(gt('9c 9d 9h 3c 3d', '8c 8d 8h As Ah'), 'FH compares triple'); ok(gt('3c 3d 3h 3s 4d', '2c 2d 2h Ac Ad'), 'four beats full house');
ok(gt('3c 4c 5c 6c 7c', '2c 2d 2h 2s Ad'), 'straight flush beats four'); ok(gt('8c 8d 8h 3c 3d', '10c Jd Qh Ks Ac'), 'full house beats straight');
ok(gt('4c 4d 4h 4s 3c', '3d 3h 3s 3c 4d'.replace('3c', '5c')), 'four compares quad rank');
ok(gt('3d 4d 5d 6d 7d', '3c 4c 5c 6c 7c'), 'SF same level: suit'); ok(gt('2c 3c 4c 5c 6c', '10s Js Qs Ks As'), 'SF 23456 > SF 10JQKA');
ok(gt('4c 5c 6c 7c 8c', '3s 4s 5s 6s 7s'), 'SF level before suit');
// --- flush option ---
ok(type('3h 7h 9h Jh Kh') === null, 'flush illegal by default'); ok(type('3h 7h 9h Jh Kh', FL) === '同花', 'flush with option');
ok(gt('3h 7h 9h Jh Kh', '10c Jd Qh Ks Ac', FL), 'flush > straight'); ok(gt('8c 8d 8h 3c 3d', '3h 7h 9h Jh Kh', FL), 'full house > flush');
ok(gt('3c 7c 9c Jc Ac', '3h 7h 9h Jh Kh', FL), 'flush rank first (TW)'); ok(gt('3h 7h 9h Jh Kh', '3c 7c 9c Jc Ac', HK), 'flush suit first (HK preset)');
ok(gt('4c 7c 9c Jc Kc', '3h 7h 9h Jh Kh', FL), 'flush: equal top cards -> lowest card decides (TW)');
// --- bomb option ---
ok(!gt('3c 3d 3h 3s 4d', '2s'), 'no bomb on single by default'); ok(gt('3c 3d 3h 3s 4d', '2s', BO), 'four bombs single with option');
ok(gt('3c 4c 5c 6c 7c', '2s 2h', BO), 'SF bombs pair'); ok(!gt('8c 8d 8h 3c 3d', '2s', BO), 'full house is not a bomb');
ok(!gt('2s', '3c 3d 3h 3s 4d', BO), 'single cannot answer five'); ok(!gt('3c 3d', '4c'), 'different count rejected');
// --- game flow ---
{ const g = new B2.Game({ seed: 42 }); const p = g.turn; ok(g.hands[p].includes(0), '♣3 holder starts');
  const non3 = g.hands[p].find(x => x !== 0); ok(g.play([non3]) && g.turn === p, 'first play must contain ♣3');
  ok(!!g.pass(), 'cannot pass while leading'); ok(g.play([0]) === null, 'play ♣3');
  const t1 = g.turn; g.pass(); g.pass(); g.pass(); ok(g.lead === null && g.turn === p, 'three passes -> control returns to last player');
  ok(g.turn !== t1, 'turn order advanced'); }
{ // passed players may re-enter the same trick by default
  const g = new B2.Game({ hands: [cs('3c 5c 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')] });
  g.play([c('3c')]); g.pass(); g.play([c('4d')]); g.play([c('4h')]); g.play([c('5c')]);
  ok(g.turn === 1 && !g.lead === false, 'default: player 1 who passed may play again');
  ok(g.play([c('6c')]) === null, 'player 1 re-enters after earlier pass'); }
{ // passLock: once passed, skipped for the rest of the trick
  const g = new B2.Game({ rules: LK, hands: [cs('3c 5c 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')] });
  g.play([c('3c')]); g.pass(); g.play([c('4d')]); g.play([c('4h')]); g.play([c('5c')]);
  ok(g.turn === 2, 'passLock: locked player 1 skipped'); g.pass(); g.pass(); ok(g.lead === null && g.turn === 0, 'passLock: trick ends when all others locked'); }
{ // game ends when a hand is empty; last player with 1 card keeps their turn
  const g = new B2.Game({ hands: [cs('3c 2s'), cs('4c 6c'), cs('4d 7c'), cs('4h 8c')] });
  g.play([c('3c')]); g.play([c('4c')]); g.play([c('4d')]); g.play([c('4h')]); g.play([c('2s')]); ok(g.winner === 0, 'empty hand wins'); }
{ const g = new B2.Game({ hands: [cs('3c 3d 9c'), cs('4c 6c 10c'), cs('4d 7c Jc'), cs('4h 8c Qc')], rules: TW });
  ok(!!g.play([c('3c'), c('3d'), c('9c')]), 'three random cards rejected'); ok(g.check(0, [c('3c'), c('3d')]) === null, 'pair with ♣3 accepted'); }
// --- scoring ---
const P = s => B2.penalty(cs(s), TW);
ok(P('3c') === 1, '1 card = 1'); ok(P('3c 4c 5c 6c 7c 8c 9c') === 7, '7 cards = 7'); ok(P('3c 4c 5c 6c 7c 8c 9c 10c') === 16, '8 cards ×2 = 16');
ok(P('3c 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac') === 24, '12 cards ×2'); ok(P('3c 4c 5c 6c 7c 8c 9c 10c Jc Qc Kc Ac 2c') === 13 * 3 * 2, '13 cards ×3 and one 2 ×2 = 78');
ok(P('2c 4c') === 4, 'one 2 doubles'); ok(P('2c 2d 4c') === 12, 'two 2s ×4'); ok(B2.penalty(cs('2c 2d 4c'), NO2) === 3, 'twoDouble off');
{ const d = B2.roundDeltas([[], cs('3c'), cs('3d 4d 5d 6d 7d 8d 9d 10d'), cs('2c 2d')], 0, TW); ok(d[0] === 1 + 16 + 8 && d[1] === -1 && d[2] === -16 && d[3] === -8, 'winner collects sum'); }
// --- deal / seeds ---
{ const a = B2.deal(7), b = B2.deal(7), all = a.flat().sort((x, y) => x - y);
  ok(JSON.stringify(a) === JSON.stringify(b), 'seeded deal reproducible'); ok(all.length === 52 && all.every((x, i) => x === i), '52 unique cards, 13 each') ; ok(a.every(h => h.length === 13), '13 per hand'); }
// --- move generation / hints ---
{ const h = cs('3c 3d 4h 5s 6c 7d 7s'); const m = B2.genMoves(h, TW, ev('3h'), false); ok(m.length && m.every(x => x.cards.length === 1 && x.cards[0] > c('3h')), 'hints beat a single');
  const f = B2.genMoves(cs('3c 4d 5h 6s 7c 8d'), TW, null, true); ok(f.every(x => x.cards.includes(0)), 'first-move hints include ♣3'); ok(f.some(x => x.ev.cat === 1), 'first-move straight found');
  const sorted = B2.genMoves(cs('3c 9d Kh 2s'), TW, ev('4c'), false).map(x => x.cards[0]); ok(sorted.join() === [c('9d'), c('Kh'), c('2s')].join(), 'hints sorted small to large'); }
// --- AI legality: 150 random rounds (verify.js soaks 1000) with every rule option on, mixed levels ---
{ let bad = 0; const rules = B2.mkRules({ flush: true, triple: true, bomb: true, passLock: true });
  for (let s = 0; s < 150; s++) { const g = new B2.Game({ seed: s + 1, rules }); let k = 0;
    while (g.winner < 0 && k++ < 400) { const r = B2.think({ view: B2.aiView(g, g.turn), level: k % 2, seed: s * 99 + k }); const e = r.cards ? g.play(r.cards) : g.pass(); if (e) { bad++; break; } }
    if (g.winner < 0) bad++; }
  ok(bad === 0, 'AI never makes illegal moves / stalls with all options'); }

// ---------------- page regression tests (mobile Chromium, real CDP touch) ----------------
const APP = path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser = null, tid = 1;
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
const SET = o => JSON.stringify(Object.assign({ seenTable: true, speed: 'fast', rounds: 4, level: 1 }, o || {}));
async function open(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
  const ls = Object.assign({ 'bigtwo:settings': SET(o.settings) }, o.ls || {});
  await ctx.addInitScript(ls => { if (!localStorage.getItem('__seeded')) { localStorage.setItem('__seeded', 1); for (const k in ls) if (ls[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, ls[k]); } }, ls);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP + '?seed=' + (o.seed || 4242)); await page.waitForFunction(() => window.__b2 && window.__b2.info());
  const cdp = await ctx.newCDPSession(page);
  const down = async (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid++ }] });
  const up = async () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const tap = async (x, y, hold = 40) => { await down(x, y); await sleep(hold); await up(); };
  const info = () => page.evaluate(() => window.__b2.info());
  const tapSel = async sel => {
    await page.waitForFunction(sel => { const e = document.querySelector(sel); if (!e || !e.offsetParent) return false; const ov = e.closest('.ov'), pn = e.closest('.pnl'); return [ov, pn].every(x => !x || x.getAnimations().every(a => a.playState !== 'running')); }, sel, { timeout: 15000 });
    const b = await page.locator(sel).first().boundingBox(); await tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(60);
  };
  const waitInfo = (fn, arg, ms = 20000) => page.waitForFunction(([fn, arg]) => new Function('i', 'a', 'return (' + fn + ')(i, a)')(window.__b2.info(), arg), [String(fn), arg], { timeout: ms, polling: 50 });
  const stats = () => page.evaluate(() => JSON.parse(localStorage.getItem('bigtwo:stats') || '{}'));
  // play on until `n` more moves (plays or passes) have been made, acting for the human with 提示 + 出牌 / 過 taps
  const advance = async (n, ms = 25000) => {
    const m0 = (await info()).moves, t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = await info();
      if (i.moves >= m0 + n) return i;
      if (i.overlay === 'roundEnd' || i.overlay === 'matchEnd') return i;
      if (i.phase === 'play' && i.turn === 0 && !i.busy && !i.paused && !i.overlay) {
        await tapSel('#bHint'); const s = (await info()).sel;
        await tapSel(s.length ? '#bPlay' : '#bPass');
        await page.waitForFunction(m => window.__b2.info().moves > m || window.__b2.info().overlay, i.moves, { timeout: 8000 });
      } else await sleep(60);
    }
    throw new Error('game did not move (paused=' + (await info()).paused + ')');
  };
  // start a match and skip the deal animation with a tap on the table
  const start = async (sel, then) => {
    await tapSel(sel); if (then) await tapSel(then);
    await page.waitForFunction(() => window.__b2.info().phase === 'deal' || window.__b2.info().phase === 'play', null, { timeout: 10000 });
    if ((await info()).phase === 'deal') await tap(page.viewportSize().width / 2, page.viewportSize().height / 2);
    await waitInfo(i => i.phase === 'play');
  };
  return { ctx, page, cdp, errors, tap, down, up, tapSel, info, waitInfo, stats, advance, start, close: () => ctx.close() };
}
// a finished-able save: last round of a 4-round match, the human holds only ♠2 and leads
function lastRoundSave(o = {}) {
  const g = new B2.Game({ hands: [[51], [0, 1, 2], [4, 5, 6], [8, 9, 10]] }); g.first = false; g.turn = 0; g.starter = 1;
  if (o.finish) g.play([51]);
  const M = { rules: B2.mkRules({}), level: 1, rounds: 4, roundNo: 4, totals: [10, 0, -5, -5], daily: null, seed: 1, preset: 'tw' };
  if (o.finish) { const d = B2.roundDeltas(g.hands, g.winner, M.rules); M.totals = M.totals.map((t, i) => t + d[i]); M.over = true; }
  return JSON.stringify({ M, G: g.snapshot(), hand: g.hands[0].slice(), phase: o.finish ? 'roundEnd' : 'play' });
}
// a mid-round save with a dealt deck where a computer seat (1) is to move: restoring it needs no deal animation
function midSave(o = {}) {
  const g = new B2.Game({ seed: 777 }); let k = 0;
  while (g.turn !== 1 || g.first) { const r = B2.think({ view: B2.aiView(g, g.turn), level: 1, seed: k++ }); if (r.cards) g.play(r.cards); else g.pass(); }
  const M = Object.assign({ rules: B2.mkRules({}), level: 1, rounds: 4, roundNo: 1, totals: [0, 0, 0, 0], daily: null, seed: 777, preset: 'tw', counted: true }, o);
  return JSON.stringify({ M, G: g.snapshot(), hand: g.hands[0].slice(), phase: 'play' });
}
// rotation mid-game keeps the table cards on the table; landscape hand cards >=40px; lanterns clear of buttons / top seat
async function rotationChecks(s) {
  await s.page.waitForFunction(() => { const i = window.__b2.info(); return i.table.length > 0 && !i.busy; }, null, { timeout: 15000 });
  for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await s.page.setViewportSize(vp); await s.page.waitForFunction(w => innerWidth === w, vp.width); await sleep(100);
    const i = await s.info(), L2 = i.layout, top = i.table[i.table.length - 1];
    ok(top && top.every(q => q.y < L2.handY - 10 && q.x > 0 && q.x < vp.width), `${vp.width}×${vp.height}: table cards above the hand (${top && Math.round(top[0].y)} < ${Math.round(L2.handY)})`);
    if (vp.width === 844) {
      const w = (await s.page.evaluate(h => h.map(c => window.__b2.cardCenter(c).w), i.hand)); ok(Math.min(...w) >= 40, 'landscape card width ' + Math.round(Math.min(...w)));
      const boxes = await s.page.evaluate(() => ['bMenu', 'bLog', 'bMute', 'iRound', 'iSub'].map(id => { const e = document.getElementById(id), rg = document.createRange(); rg.selectNodeContents(e); const r = e.tagName === 'BUTTON' ? e.getBoundingClientRect() : rg.getBoundingClientRect(); return [r.left, r.right, r.bottom]; }));
      const hit = L2.lanterns.filter(l => boxes.some(b => l.x > b[0] - 20 && l.x < b[1] + 20 && l.y - 20 < b[2]) || Math.abs(l.x - L2.seats[2].x) < 24 + 90);
      ok(L2.lanterns.length > 0 && hit.length === 0, 'lanterns clear: ' + JSON.stringify(hit));
    }
  }
}
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch)');
  try {
    await at('no softlock after 回主畫面→繼續 / 回主畫面→開新 / 設定→開新; abandoning counts a round; counted once dealt; 回主畫面 mid-move leaves no timers', async () => {
      const s = await open({ width: 390, height: 844 }, { ls: { 'bigtwo:match': midSave(), 'bigtwo:stats': JSON.stringify({ rounds: 3, wins: 1, matches: 1, matchWins: 0, types: {}, ach: {}, daily: {} }) } });
      const moved = async what => { const m = (await s.info()).moves; await s.page.waitForFunction(m => { const i = window.__b2.info(); return i.moves > m || (i.turn === 0 && !i.busy && !document.getElementById('bHint').disabled); }, m, { timeout: 15000 }).catch(() => {}); const i = await s.info(); ok(!i.paused && (i.moves > m || (i.turn === 0 && !i.busy)), what + ': game moves (paused=' + i.paused + ')'); };
      // 1. menu → home → continue (the computer is to move in the save)
      await s.tapSel('#tCont'); await s.tapSel('#bMenu'); ok((await s.info()).paused, 'menu pauses');
      await s.tapSel('#mHome'); await s.tapSel('#tCont'); await moved('回主畫面→繼續');
      // 2. menu → home → 開新牌局 asks first; cancel keeps the save, accept counts the abandoned round
      await s.tapSel('#bMenu'); await s.tapSel('#mHome'); await s.tapSel('#tNew');
      ok(await s.page.evaluate(() => !document.getElementById('confirm').classList.contains('hidden')), 'new match over a saved one asks first');
      await s.tapSel('#cfNo'); ok(await s.page.evaluate(() => document.getElementById('confirm').classList.contains('hidden')), 'cancel closes the question');
      await s.start('#tNew', '#cfYes');
      let st = await s.stats(); ok(st.rounds === 4, 'abandoned round counted as a played round: ' + st.rounds); ok(st.matches === 2, 'new match counted once dealt: ' + st.matches);
      await moved('回主畫面→開新');
      // 3. menu → settings → 開新牌局
      await s.tapSel('#bMenu'); await s.tapSel('#mSet'); await s.start('#sNew', '#cfYes'); await moved('設定→開新');
      // 回主畫面 while a played hand is still flying: no page error, no timers or flying cards left
      for (let k = 0; k < 1; k++) {
        await s.page.waitForFunction(() => { const i = window.__b2.info(), f = window.__b2.flow(); return i.phase === 'play' && f.flying > 0 && !f.dealing; }, null, { timeout: 20000, polling: 'raf' });
        await s.page.evaluate(() => { document.getElementById('bMenu').click(); document.getElementById('mHome').click(); });
        await sleep(1300);
        const f = await s.page.evaluate(() => window.__b2.flow());
        ok(f.timers === 0 && f.flying === 0 && !f.pendingAI, 'flow cleared after going home: ' + JSON.stringify(f));
        await s.tapSel('#tCont'); await s.waitInfo(i => i.phase === 'play');
        if ((await s.info()).turn === 0) await s.advance(1);
      }
      ok(s.errors.length === 0, 'no page errors: ' + s.errors.join(' | '));
      await s.close();
    });
    await at('first visit: rules before the deal (nothing counted yet); tap skips the deal; daily: only the first dealt try is ranked; no keyboard letters on touch', async () => {
      const s = await open({ width: 390, height: 844 }, { settings: { seenTable: false } });
      await s.tapSel('#tDaily'); let i = await s.info(); ok(i.overlay === 'help' && i.phase === 'intro', 'help first, no cards yet: ' + i.phase);
      let st = await s.stats(); ok(!st.matches && !(st.dailyTried && Object.keys(st.dailyTried).length), 'nothing counted while the rules are open');
      ok(i.ranked === true, 'first daily attempt ranked');
      await s.tapSel('#hOk'); await s.waitInfo(i => i.busy && i.phase === 'deal');
      await s.tap(195, 400); await s.waitInfo(i => i.phase === 'play' && !i.busy, null, 3000);
      ok((await s.info()).hand.length === 13, 'deal skipped with all 13 cards in hand');
      st = await s.stats(); ok(st.matches === 1 && Object.keys(st.dailyTried || {}).length === 1, 'counted once dealt');
      await s.tapSel('#bMenu'); await s.tapSel('#mHome'); await s.start('#tDaily', '#cfYes'); ok((await s.info()).ranked === false, 'replay is practice');
      ok(await s.page.evaluate(() => getComputedStyle(document.querySelector('#bPass .kb')).display === 'none' && getComputedStyle(document.querySelector('li.kb')).display === 'none'), 'H/P and the keyboard line hidden on touch');
      await s.tapSel('#bMenu'); await s.tapSel('#mSet'); await s.tapSel('#segSpeed button[data-v="normal"]');
      ok(await s.page.evaluate(() => JSON.parse(localStorage.getItem('bigtwo:settings')).speed === 'normal'), 'speed setting saved');
      ok(s.errors.length === 0, 'no page errors: ' + s.errors.join(' | '));
      await s.close();
    });
    for (const vp of [{ width: 390, height: 844 }, { width: 375, height: 500 }]) await at(`hand: targets ≥40px, touch-down select, two overlapping fingers, vertical swipe; ${vp.height > 600 ? 'rotation keeps the table' : 'label clear of the counter'} (${vp.width}×${vp.height})`, async () => {
      const s = await open(vp, { ls: { 'bigtwo:match': midSave() } });
      await s.tapSel('#tCont'); await s.waitInfo(i => i.phase === 'play' && i.turn === 0 && !i.busy);
      const i = await s.info(); let bad = 0; const why = [];
      const boxes = await s.page.evaluate(h => h.map(c => window.__b2.cardCenter(c)), i.hand), small = boxes.filter(p => p.w < 40 || p.h < 40).length;
      // the selection is read inside the page right after the app's own pointerdown handler ran
      await s.page.evaluate(() => document.getElementById('cv').addEventListener('pointerdown', () => { window.__selAtDown = window.__b2.info().sel; }));
      const clear = async () => { for (let t = 0; t < 3; t++) { const sl = (await s.info()).sel; if (!sl.length) return; for (const x of sl) { const q = await s.page.evaluate(x => window.__b2.cardCenter(x), x); await s.tap(q.x, q.y); await sleep(30); } } };
      const n = i.hand.length, h2 = Math.ceil(n / 2);
      for (const k of vp.height > 600 ? [0, h2 - 1, h2, n - 1] : [h2 - 1, n - 1]) {
        const c = i.hand[k], p = boxes[k];
        await s.down(p.x, p.y); await sleep(30); await s.up(); await sleep(30);
        const sel = await s.page.evaluate(() => window.__selAtDown); if (sel.length !== 1 || sel[0] !== c) { bad++; why.push(k + ':' + JSON.stringify(sel)); }
        await clear();
      }
      ok(small === 0, small + ' cards narrower than 40px'); ok(bad === 0, bad + ' cards not selected on touch-down: ' + why.join(' '));
      // two thumbs: finger 2 lands 80 ms after finger 1, finger 1 lifts 30 ms later, finger 2 70 ms after that
      const T = (type, pts) => s.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
      let both = 0;
      const pairs = vp.height > 600 ? [[1, n - 2], [3, 4]] : [[2, h2 + 1], [0, n - 1]];
      for (const [a, z] of pairs) for (let attempt = 0; attempt < 2; attempt++) {
        await clear(); const A = boxes[a], Z = boxes[z], s0 = (await s.info()).sel;
        await T('touchStart', [{ x: A.x, y: A.y, id: 91 }]); await sleep(80);
        await T('touchStart', [{ x: A.x, y: A.y, id: 91 }, { x: Z.x, y: Z.y, id: 92 }]); await sleep(30);
        await T('touchEnd', [{ x: A.x, y: A.y, id: 91 }]); await sleep(70); await T('touchEnd', []); await sleep(80);
        // (a retry only covers a busy test machine stretching the 80 ms overlap into a 500 ms long press)
        const sl = (await s.info()).sel, tog = c => s0.includes(c) !== sl.includes(c); if (tog(i.hand[a]) && tog(i.hand[z])) { both++; break; }
        await clear();
      }
      ok(both === pairs.length, 'both fingers counted ' + both + '/' + pairs.length);
      // a vertical swipe starting on a card is not a tap
      await clear();
      const p = boxes[n - 3]; await s.down(p.x, p.y); await sleep(20);
      for (let d = 1; d <= 3; d++) { await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y - d * 12, id: tid - 1 }] }); await sleep(20); }
      await s.up(); await sleep(40); ok((await s.info()).sel.length === 0, 'vertical swipe left no card selected');
      if (vp.height > 600) await rotationChecks(s);
      else {
        const L = (await s.info()).layout; ok(L.cy + L.tH / 2 + 18 + 12 <= L.cntY - 4, 'play label clear of the counter: ' + (L.cy + L.tH / 2 + 30) + ' vs ' + L.cntY);
        // a raised front-row card must not take taps meant for the back-row card above it
        let covered = 0; await clear();
        for (let j = h2; j < n; j++) {
          const q = boxes[j]; await s.tap(q.x, q.y); await sleep(40);
          for (let k = 0; k < h2; k++) { const hh = await s.page.evaluate(([x, y]) => window.__b2.hitAt(x, y), [boxes[k].x, boxes[k].y]); if (hh !== i.hand[k]) covered++; }
          await clear();
        }
        ok(covered === 0, 'back-row tap points covered by a raised front card: ' + covered);
        if (L.ghostTop != null) ok(L.ghostTop >= L.topSeatBottom, 'older plays stay below the top player');
      }
      ok(s.errors.length === 0, 'no page errors: ' + s.errors.join(' | '));
      await s.close();
    });
    await at('final round: result is recorded at round end and survives a reload; 看總結 shows real scores', async () => {
      let s = await open({ width: 390, height: 844 }, { ls: { 'bigtwo:match': lastRoundSave(), 'bigtwo:stats': null } });
      await s.tapSel('#tCont'); await s.waitInfo(i => i.phase === 'play' && i.turn === 0);
      const c = await s.page.evaluate(() => window.__b2.cardCenter(51)); await s.tap(c.x, c.y); await s.tapSel('#bPlay');
      await s.waitInfo(i => i.phase === 'roundEnd');
      let st = await s.stats(); ok(st.matchWins === 1 && st.ach && st.ach.match, 'match win + 夜市牌王 saved before the summary: ' + st.matchWins);
      ok(st.bestTotal === 19, 'best match score recorded: ' + st.bestTotal);
      // "reload": a fresh page opened on exactly what this page saved (a real reload can race Chromium's own
      // localStorage commit on a loaded test machine, which is not what is being tested here)
      const saved = await s.page.evaluate(() => ({ 'bigtwo:match': localStorage.getItem('bigtwo:match'), 'bigtwo:stats': localStorage.getItem('bigtwo:stats'), 'bigtwo:settings': localStorage.getItem('bigtwo:settings') }));
      ok(s.errors.length === 0, 'no page errors: ' + s.errors.join(' | ')); await s.close();
      s = await open({ width: 390, height: 844 }, { ls: saved });
      ok(await s.page.evaluate(() => !document.getElementById('tCont').classList.contains('hidden') && document.getElementById('tCont').textContent === '看總結'), 'title offers 看總結 after reload');
      await s.tapSel('#tCont'); await s.waitInfo(i => i.overlay === 'roundEnd');
      const tbl = await s.page.textContent('#reTbl'); ok(/\+9/.test(tbl) && /-3/.test(tbl), 'restored round end shows the real deltas: ' + tbl.slice(0, 80));
      await s.tapSel('#reNext'); await s.waitInfo(i => i.overlay === 'matchEnd');
      st = await s.stats(); ok(st.matchWins === 1, 'not counted twice: ' + st.matchWins);
      ok(/段位升到「夜市常客」/.test(await s.page.textContent('#meSub')), 'rank-up shown on the summary');
      ok(s.errors.length === 0, 'no page errors: ' + s.errors.join(' | '));
      await s.close();
      // a save written by the old version (match over, result never recorded) is recorded when it is opened
      const s2 = await open({ width: 390, height: 844 }, { ls: { 'bigtwo:match': lastRoundSave({ finish: true }), 'bigtwo:stats': JSON.stringify({ rounds: 5, wins: 2, matches: 1, matchWins: 0, types: {}, ach: {}, daily: {} }) } });
      await s2.tapSel('#tCont'); await s2.waitInfo(i => i.overlay === 'roundEnd');
      ok((await s2.stats()).matchWins === 1, 'old finished save: result recorded on open');
      await s2.tapSel('#reNext'); await s2.waitInfo(i => i.overlay === 'matchEnd'); ok((await s2.stats()).matchWins === 1, 'old save: once');
      await s2.close();
    });
  } finally { await browser.close(); }
}
(async () => {
  let pw = true; try { require.resolve('/opt/node22/lib/node_modules/playwright'); } catch (e) { pw = false; }
  if (pw && !process.argv.includes('--node-only')) await browserTests(); else console.log('(page tests skipped: no Playwright)');
  console.log(`tests: ${pass} passed, ${fail} failed (${pass + fail} total)`);
  process.exit(fail ? 1 : 0);
})();
