// Tests for 金字塔接龍: rule unit tests on the game's own core (CORE-START/CORE-END in index.html), level-table checks,
// then the page in mobile Chromium with real CDP touch (two fingers, holds, ghost clicks, layout, save/resume).
// Usage: node tests.js            (about 60 s)
const fs = require('fs'), path = require('path'), assert = require('assert');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {COVER,ROWOF,dealFromSeed,initState,isFree,availLocs,legalMoves,applyMove,wasteTops,canDraw,canRecycle,stockLeft,isWon,isStuck,solve};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[.*?\]);/)[1]);
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); } };
const ok = (c, msg) => { if (!c) throw new Error(msg); };
function deal(cards) { return { seed: 0, cards, rk: cards.map(c => c % 13 + 1) }; }
const base = C.dealFromSeed(12345);
const bit = (...ps) => ps.reduce((m, p) => (m | (1 << p)) >>> 0, 0);

console.log('Rules');
t('deal: 28 pyramid + 24 stock, all 52 distinct', () => { assert.strictEqual(new Set(base.cards).size, 52); assert.strictEqual(base.cards.length, 52); });
t('initially only the 7 bottom-row cards are free', () => { assert.deepStrictEqual(C.availLocs(C.initState()).filter(l => l < 28).sort((a, b) => a - b), [21, 22, 23, 24, 25, 26, 27]); });
t('half-covered card is NOT free (only one coverer removed)', () => {
  const s = { pm: bit(21), um: 0, p: 0, r: 0 };
  assert.deepStrictEqual(C.COVER[15], [21, 22]); assert.strictEqual(C.isFree(s, 15), false);
  assert.strictEqual(C.isFree({ pm: bit(21, 22), um: 0, p: 0, r: 0 }, 15), true);
});
t('K removes alone; other cards cannot pair with themselves', () => {
  const cards = base.cards.slice(); const k = cards.indexOf(12); const j = cards[27]; cards[27] = 12; cards[k] = j;
  const D = deal(cards), ms = C.legalMoves(D, C.initState(), 2);
  assert(ms.some(m => m.t === 'k' && m.a === 27)); assert(ms.every(m => m.t !== 'p' || m.a !== m.b));
});
t('pairs must sum to 13 and only free cards are offered', () => {
  const D = base, s = C.initState();
  for (const m of C.legalMoves(D, s, 2)) if (m.t === 'p') { assert.strictEqual(D.rk[m.a] + D.rk[m.b], 13); assert(C.availLocs(s).includes(m.a) && C.availLocs(s).includes(m.b)); }
});
t('recycle limits: 0 / 1 / 2 passes', () => {
  for (const R of [0, 1, 2]) {
    let s = C.initState(), rec = 0;
    for (let k = 0; k < 200; k++) { if (C.canDraw(s, R)) s = C.applyMove(base, s, { t: 'd' }); else if (C.canRecycle(s, R)) { s = C.applyMove(base, s, { t: 'r' }); rec++; } else break; }
    assert.strictEqual(rec, R); assert.strictEqual(C.stockLeft(s), 0);
  }
});
t('win = pyramid empty, regardless of stock', () => { assert(C.isWon({ pm: (1 << 28) - 1 >>> 0, um: 0, p: 3, r: 0 })); });

console.log('Levels');
t('100 levels: 1-30 recycle twice, 31-70 once, 71-100 never; distinct seeds', () => {
  ok(LEVELS.length === 100, 'count'); ok(new Set(LEVELS.map(l => l[0])).size === 100, 'distinct');
  LEVELS.forEach((l, i) => ok(l[1] === (i < 30 ? 2 : i < 70 ? 1 : 0), 'R of level ' + (i + 1)));
});
t('difficulty number (from simulated win rates) never goes down and spans 1-10', () => {
  for (let i = 1; i < 100; i++) ok(LEVELS[i][2] >= LEVELS[i - 1][2], 'level ' + (i + 1) + ' easier than ' + i);
  ok(LEVELS[0][2] === 1 && LEVELS[99][2] === 10, 'span ' + LEVELS[0][2] + '..' + LEVELS[99][2]);
});
t('熟練 (screen-only bot, no memory of the stock) clears at least 2 of levels 91-100 within its 3 tries', () => {
  const C2 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {ROWOF,dealFromSeed,initState,isFree,legalMoves,applyMove,isWon,solve,hopeless,nextStock,mulberry32};')();
  const B = require('./bots.js')(C2); let cleared = 0;
  for (let n = 91; n <= 100; n++) { const [seed, R] = LEVELS[n - 1], rnd = C2.mulberry32(n * 101 + 7); let w = 0; for (let k = 0; k < 12; k++) if (B.attempt(seed, R, B.TIERS.skilled, rnd).won) w++; if (1 - Math.pow(1 - w / 12, 3) >= 0.5) cleared++; }
  ok(cleared >= 2, 'levels 91-100 that 熟練 clears more often than not: ' + cleared);
});
t('every level 1-100 is solvable (proof by the game solver)', () => {
  for (let n = 1; n <= 100; n++) { const [seed, R] = LEVELS[n - 1], r = C.solve(C.dealFromSeed(seed), C.initState(), R, 400000); ok(r.ok, 'level ' + n + ' not proven'); }
});

// a no-recycle level and a position in it where drawing the next stock card leaves no move at all
function stuckSpot() {
  let r = 99;
  const rnd = () => (r = (r * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let n = 71; n <= 100; n++) {
    const D = C.dealFromSeed(LEVELS[n - 1][0]);
    for (let k = 0; k < 200; k++) {
      let s = C.initState(), prev = null, last = null;
      for (;;) { const ms = C.legalMoves(D, s, 0); if (!ms.length) break; last = ms[Math.floor(rnd() * ms.length)]; prev = s; s = C.applyMove(D, s, last); }
      if (!C.isWon(s) && last && last.t === 'd' && C.stockLeft(prev) >= 1) return { n, s: prev };
    }
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser, tid = 1;
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 60 s')), 60000); })]); clearTimeout(tm); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
async function open(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'light' });
  const seed = Object.assign({ 'pyramid:unlockAll': 'true', 'pyramid:settings': JSON.stringify({ seen: { 1: 1, 31: 1, 51: 1, 71: 1 } }) }, o.ls || {});
  await ctx.addInitScript(ls => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in ls) localStorage.setItem(k, ls[k]); } }, seed);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await page.waitForFunction(() => window.__game && window.__game.state().n);
  const cdp = await ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const down = async (x, y, id) => T('touchStart', [{ x, y, id }]);
  const tap = async (x, y, hold = 40) => { const id = tid++; await T('touchStart', [{ x, y, id }]); await sleep(hold); await T('touchEnd', []); };
  const box = async sel => { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const tapSel = async (sel, hold) => { await page.waitForFunction(sel => { const e = document.querySelector(sel), c = e && (e.closest('.card') || e); return e && e.offsetParent && c.getAnimations().every(a => a.playState !== 'running'); }, sel, { timeout: 5000 }); const p = await box(sel); await tap(p.x, p.y, hold); await sleep(60); };
  const st = () => page.evaluate(() => Object.assign(window.__game.state(), { hist: G.hist.length, undos: G.undos, plan: !!(G.plan && G.plan.length), ov: ['title', 'select', 'pause', 'win', 'fail', 'intro', 'settings'].filter(i => !document.getElementById(i).classList.contains('hidden')) }));
  const loc = async l => { const r = await page.evaluate(l => window.__game.rect(l), l); return { x: r.x + r.w / 2, y: r.y + Math.min(r.h * 0.3, 22) }; };
  const stock = async () => { const r = await page.evaluate(() => window.__game.stock()); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  const waitSt = (fn, arg, timeout = 8000) => page.waitForFunction(new Function('a', 'var s = window.__game.state(); return (' + fn + ')(s, a);'), arg, { timeout });
  // enter level n the way a player does: 選擇關卡 (all unlocked) -> tile
  const level = async n => {
    await tapSel('#tSelect'); await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(150);
    await tapSel('.lt[data-n="' + n + '"]'); await waitSt('s => s.status === "play"');
  };
  return { ctx, page, errors, T, down, tap, tapSel, box, st, loc, stock, waitSt, level, close: () => ctx.close() };
}
const D1 = C.dealFromSeed(LEVELS[0][0]);
const pairIn = (D, a) => { for (const b of [21, 22, 23, 24, 25, 26, 27]) if (b !== a && D.rk[a] + D.rk[b] === 13) return b; return -1; };
const firstPair = D => { for (const a of [21, 22, 23, 24, 25, 26, 27]) { const b = pairIn(D, a); if (b >= 0) return [a, b]; } return null; };
const noPair = D => { for (const a of [21, 22, 23, 24, 25, 26, 27]) for (const b of [21, 22, 23, 24, 25, 26, 27]) if (a < b && D.rk[a] + D.rk[b] !== 13 && D.rk[a] !== 13 && D.rk[b] !== 13) return [a, b]; return null; };

async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, CDP touch)');
  const P = firstPair(D1), NP = noPair(D1);
  try {
    await at('two fingers overlapping on a pair: both taps count and the pair is removed (4 timings)', async () => {
      const s = await open({ width: 390, height: 844 }); await s.level(1);
      for (const [d1, d2] of [[60, 60], [40, 120], [120, 40], [100, 100]]) {
        const a = await s.loc(P[0]), b = await s.loc(P[1]);
        await s.T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(d1);
        await s.T('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(d2);
        await s.T('touchEnd', [{ x: a.x, y: a.y, id: 1 }]); await sleep(40); await s.T('touchEnd', []); await sleep(120);
        const r = await s.st(); ok(((r.s.pm >>> P[0]) & 1) && ((r.s.pm >>> P[1]) & 1), 'pair not removed at ' + d1 + '/' + d2);
        await s.tapSel('#bUndo'); await s.waitSt('s => s.s.pm === 0');
      }
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    await at('a finger resting on the sky or a card: a second finger still works 悔棋 / 選單 / 音效 / 提示 / 重來 / 牌庫', async () => {
      const s = await open({ width: 390, height: 844 }); await s.level(1);
      for (const rest of ['sky', 'card']) {
        const R = rest === 'sky' ? { x: 30, y: 140 } : await s.loc(NP[0]);
        const second = async q => { await s.T('touchStart', [{ x: R.x, y: R.y, id: 1 }]); await sleep(60); await s.T('touchStart', [{ x: R.x, y: R.y, id: 1 }, { x: q.x, y: q.y, id: 2 }]); await sleep(60); await s.T('touchEnd', [{ x: q.x, y: q.y, id: 2 }]); await sleep(150); await s.T('touchEnd', []); await sleep(120); };
        const p0 = (await s.st()).s.p; await second(await s.stock()); ok((await s.st()).s.p === p0 + 1, rest + ': stock');
        await second((await s.box('#bUndo'))); ok((await s.st()).s.p === p0, rest + ': 悔棋');
        const snd = await s.page.evaluate(() => settings.sound); await second(await s.box('#bMute')); ok(await s.page.evaluate(() => settings.sound) === !snd, rest + ': 音效');
        await second(await s.box('#bMute'));
        await second(await s.box('#bHint')); const hinted = await s.page.waitForFunction(() => G.hints > 0, null, { timeout: 15000 }).then(() => true, () => false);
        ok(hinted, rest + ': 提示');
        await second(await s.box('#bPause')); ok((await s.st()).ov.includes('pause'), rest + ': 選單');
        await s.tapSel('#pResume'); await s.waitSt('s => s.status === "play"');
        await s.tap(...Object.values(await s.stock()).slice(0, 2)); await sleep(150);
        await second(await s.box('#bRestart')); const r = await s.st(); ok(r.hist === 0 && r.s.p === 0 && r.status === 'play', rest + ': 重來');
        await s.page.evaluate(() => { G.hints = 0; G.plan = null; });
      }
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    const SP = stuckSpot();
    await at('ghost clicks: a finger held through the last draw, or pressed just before the fail panel appears, fires nothing on it (375x500)', async () => {
      ok(SP, 'found a position where the next draw gets stuck');
      const s = await open({ width: 375, height: 500 }); await s.level(SP.n);
      // test-only: jump to that position (with one undo step behind it), the draw itself is a real touch
      await s.page.evaluate(x => { G.s = x; G.hist = [{ s: x, score: 0 }]; updateHud(); }, SP.s);
      const sp = await s.stock(), P0 = SP.s.p, P1 = P0 + 1;
      for (const hold of [750, 1000, 1200]) {
        await s.tap(sp.x, sp.y, hold); await sleep(800);
        const r = await s.st(); ok(r.status === 'lost' && r.ov.join() === 'fail', 'hold ' + hold + ': ' + r.status + ' ' + r.ov);
        await s.tapSel('#fUndo'); await s.waitSt('(s, p) => s.status === "play" && s.s.p === p', P0);
      }
      // the fail panel's buttons (measured once it is showing) pressed at +650 ms, released at +800 ms
      await s.tap(sp.x, sp.y); await s.waitSt('s => s.status === "lost"'); await sleep(400);
      const btns = {}; for (const id of ['fUndo', 'fRestart', 'fSelect']) btns[id] = await s.box('#' + id);
      await s.tapSel('#fUndo'); await s.waitSt('(s, p) => s.status === "play" && s.s.p === p', P0);
      for (const id of Object.keys(btns)) {
        // press while the 700 ms wait runs (panel not up yet), lift once the panel is showing
        await s.tap(sp.x, sp.y); await s.waitSt('s => s.status === "lostwait"'); await sleep(350);
        await s.down(btns[id].x, btns[id].y, tid++); const early = await s.page.evaluate(() => G.status === 'lostwait');
        await s.page.waitForSelector('#fail:not(.hidden)'); await sleep(100); await s.T('touchEnd', []); await sleep(300);
        const r = await s.st(); ok(early, 'press landed before the panel'); ok(r.status === 'lost' && r.ov.join() === 'fail' && r.s.p > P0, id + ' fired by the late press: ' + r.status + ' ' + r.ov);
        await s.tapSel('#fUndo'); await s.waitSt('(s, p) => s.status === "play" && s.s.p === p', P0);
      }
      // 重來 pressed 250 ms after the last draw (before the panel) restarts and no fail panel appears afterwards
      await s.tap(sp.x, sp.y); await sleep(250); await s.tapSel('#bRestart'); await sleep(900);
      const r = await s.st(); ok(r.status === 'play' && r.hist === 0 && r.s.p === 0 && !r.ov.length, '重來 during the 700 ms wait: ' + JSON.stringify([r.status, r.hist, r.ov]));
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    await at('a tap with 11-20 px of finger roll still selects the card; a 40 px drag onto nothing does not', async () => {
      const s = await open({ width: 390, height: 844 }); await s.level(1);
      for (const d of [11, 13, 16, 20]) {
        const a = await s.loc(NP[0]); await s.T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(30);
        await s.T('touchMove', [{ x: a.x + d / 2, y: a.y + d / 2, id: 1 }]); await sleep(30); await s.T('touchMove', [{ x: a.x + d / Math.SQRT2, y: a.y + d / Math.SQRT2, id: 1 }]); await sleep(30);
        await s.T('touchEnd', []); await sleep(120);
        ok((await s.st()).sel === NP[0], d + ' px roll lost the tap');
        await s.tap(a.x, a.y); await sleep(120); ok((await s.st()).sel === -1, 'deselect');
      }
      const a = await s.loc(NP[0]); await s.T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); for (let k = 1; k <= 4; k++) { await s.T('touchMove', [{ x: a.x, y: a.y - k * 10, id: 1 }]); await sleep(20); } await s.T('touchEnd', []); await sleep(120);
      ok((await s.st()).sel === -1, 'long drag selected');
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    await at('win panel: every button is on screen without scrolling (844x390, 667x375, 375x500)', async () => {
      const sol = C.solve(D1, C.initState(), LEVELS[0][1], 400000).sol, last = sol[sol.length - 1];
      for (const vp of [{ width: 844, height: 390 }, { width: 667, height: 375 }, { width: 375, height: 500 }]) {
        const s = await open(vp); await s.level(1);
        // jump to the position before the last move (test-only state write), then play the last move by touch
        let x = C.initState(); for (const m of sol.slice(0, -1)) x = C.applyMove(D1, x, m);
        await s.page.evaluate(x => { G.s = x; G.hist = [{ s: x, score: 0 }]; updateHud(); }, x);
        if (last.t === 'd' || last.t === 'r') { const q = await s.stock(); await s.tap(q.x, q.y); }
        else { const q = await s.loc(last.a); await s.tap(q.x, q.y); if (last.t === 'p') { await sleep(100); const q2 = await s.loc(last.b); await s.tap(q2.x, q2.y); } }
        await s.page.waitForSelector('#win:not(.hidden)', { timeout: 6000 }); await sleep(500);
        const off = await s.page.evaluate(() => ['wNext', 'wRetry', 'wSelect', 'wShare'].filter(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.bottom > innerHeight || r.top < 0; }));
        ok(!off.length, vp.width + 'x' + vp.height + ' off screen: ' + off);
        ok(!s.errors.length, s.errors.join(' | ')); await s.close();
      }
    });
    await at('a game in progress survives a reload: the title offers 繼續第 N 關 and restores cards, score, undo history', async () => {
      const s = await open({ width: 390, height: 844 }); await s.level(2);
      const D2 = C.dealFromSeed(LEVELS[1][0]), sp = await s.stock();
      for (let i = 0; i < 3; i++) { await s.tap(sp.x, sp.y); await sleep(120); }
      const pr = firstPair(D2); if (pr) { const a = await s.loc(pr[0]); await s.tap(a.x, a.y); await sleep(120); const b = await s.loc(pr[1]); await s.tap(b.x, b.y); await sleep(200); }
      const r0 = await s.st();
      await s.page.reload(); await s.page.waitForFunction(() => window.__game && window.__game.state().n);
      ok(/繼續第 2 關/.test(await s.page.textContent('#tPlay')), 'title button: ' + await s.page.textContent('#tPlay'));
      await s.tapSel('#tPlay'); await s.waitSt('s => s.status === "play"');
      const r1 = await s.st(); ok(r1.n === 2 && r1.s.pm === r0.s.pm && r1.s.p === r0.s.p && r1.score === r0.score && r1.hist === r0.hist, 'restored ' + JSON.stringify([r0.s, r1.s, r0.hist, r1.hist]));
      await s.tapSel('#bUndo'); ok((await s.st()).hist === r0.hist - 1, 'undo after resume');
      // 開始遊戲 without a saved game goes to the level played last, not the first unfinished one
      await s.tapSel('#bRestart'); await s.tapSel('#bPause'); await s.tapSel('#pHome');
      ok(await s.page.textContent('#tPlay') === '開始遊戲', 'no save after restart: ' + await s.page.textContent('#tPlay'));
      await s.tapSel('#tPlay'); await s.waitSt('s => s.status === "play"'); ok((await s.st()).n === 2, 'start goes to last level');
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    await at('title pyramid sits between heading and buttons; settings buttons are 44 px; blocked-card tap explains itself; random deal plays', async () => {
      for (const vp of [{ width: 360, height: 640 }, { width: 375, height: 500 }, { width: 390, height: 844 }]) {
        const s = await open(vp);
        const g = await s.page.evaluate(() => { const t = titleSpace(), a = document.querySelector('.ttl').getBoundingClientRect(), b = document.querySelector('.tbtns').getBoundingClientRect(); return { t, h: (6 * LAY.step + LAY.ch) * t.s, top: a.bottom, bot: b.top }; });
        ok(g.t.s === 0 || (g.t.y >= g.top && g.t.y + g.h <= g.bot), vp.width + 'x' + vp.height + ' title pyramid overlaps: ' + JSON.stringify(g));
        if (vp.height === 844) {
          await s.tapSel('#tSet'); const hs = await s.page.evaluate(() => [...document.querySelectorAll('#setBody .seg button')].map(b => b.offsetHeight));
          ok(hs.length >= 11 && hs.every(h => h >= 44), 'segment heights ' + hs); await s.tapSel('#setOk');
          await s.level(1); const q = await s.loc(5); const r = await s.page.evaluate(() => window.__game.rect(5)); await s.tap(r.x + r.w / 2, r.y + 4); await sleep(150);
          ok(/壓住/.test(await s.page.textContent('#toast')), 'blocked toast: ' + await s.page.textContent('#toast'));
          await s.tapSel('#bPause'); await s.tapSel('#pHome'); await s.tapSel('#tRand'); await s.tapSel('#rp1');
          if (await s.page.isVisible('#confirm')) await s.tapSel('#cfOk');
          await s.waitSt('s => s.n === "rand" && s.status === "play"', null, 20000);
          ok(await s.page.textContent('#hLevel') === '隨機金字塔', 'random HUD');
          const seed = await s.page.evaluate(() => G.D.seed); ok(C.solve(C.dealFromSeed(seed), C.initState(), 1, 400000).ok, 'random deal solvable');
        }
        ok(!s.errors.length, s.errors.join(' | ')); await s.close();
      }
    });
    await at('details: pause survives a background trip; 累計配對 is taken back by 悔棋; tile shows best score; level 100 first hint is instant', async () => {
      const s = await open({ width: 390, height: 844 }, { ls: { 'pyramid:progress': JSON.stringify({ done: { 1: { stars: 3, best: 1440 } }, last: 2 }) } });
      await s.tapSel('#tSelect'); ok(/1440/.test(await s.page.textContent('.lt[data-n="1"]')), 'best on tile');
      await s.tapSel('#sBack'); await s.level(1);
      const a = await s.loc(P[0]); await s.tap(a.x, a.y); await sleep(100); const b = await s.loc(P[1]); await s.tap(b.x, b.y); await sleep(150);
      const p1 = await s.page.evaluate(() => stats.pairs); await s.tapSel('#bUndo'); ok(await s.page.evaluate(() => stats.pairs) === p1 - 1, 'pairs after undo');
      await s.tapSel('#bPause');
      const lost = await s.page.evaluate(async () => { const t0 = G.t0; Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); await new Promise(r => setTimeout(r, 300)); Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); return { pausedAt: G.pausedAt, t0same: G.t0 === t0 }; });
      ok(lost.pausedAt > 0 && lost.t0same, 'pause kept through visibilitychange ' + JSON.stringify(lost));
      await s.tapSel('#pSelect'); await s.page.locator('.lt[data-n="100"]').scrollIntoViewIfNeeded(); await s.tapSel('.lt[data-n="100"]'); await s.waitSt('s => s.status === "play"');
      await s.page.waitForFunction(() => G.plan && G.plan.length, null, { timeout: 20000 });
      await s.page.evaluate(() => { document.addEventListener('pointerdown', () => { window.__down = performance.now(); }, true); new MutationObserver(() => { if (/提示/.test(document.getElementById('toast').textContent) && !window.__hintAt) window.__hintAt = performance.now() - window.__down; }).observe(document.getElementById('toast'), { childList: true, characterData: true, subtree: true }); });
      const hb = await s.box('#bHint'); await s.tap(hb.x, hb.y);
      const ms = await s.page.waitForFunction(() => G.hints === 1 && window.__hintAt, null, { timeout: 3000 }).then(h => h.jsonValue());
      ok(ms < 300, 'hint shown ' + Math.round(ms) + ' ms after the tap');
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
    });
    await at('taps 1-8 px past the edge of HUD / bottom buttons (where the browser still targets the button) fire it', async () => {
      for (const [vp, ds] of [[{ width: 390, height: 844 }, [2, 6]], [{ width: 360, height: 640 }, [4, 8]]]) {
        const s = await open(vp); await s.level(1);
        await s.page.evaluate(() => { window.__hit = []; window.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && e.detail === 0) window.__hit.push(b.id); }, true); window.__nat = []; window.addEventListener('pointerdown', e => { const b = e.target.closest && e.target.closest('button'); window.__nat.push(b ? b.id : ''); }, true); });
        let targeted = 0, fired = 0; const miss = [];
        for (const id of ['bPause', 'bMute', 'bHint', 'bRestart', 'bUndo']) for (const side of ['top', 'bottom', 'left', 'right']) for (const d of ds) {
          if (id === 'bUndo' && !(await s.st()).hist) { const sp = await s.stock(); await s.tap(sp.x, sp.y); await sleep(150); }
          const bb = (await s.box('#' + id)).b, cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
          const x = side === 'left' ? bb.x - d : side === 'right' ? bb.x + bb.width + d : cx, y = side === 'top' ? bb.y - d : side === 'bottom' ? bb.y + bb.height + d : cy;
          if (x < 0 || y < 0 || x >= vp.width || y >= vp.height) continue;
          await s.page.evaluate(() => { window.__hit.length = 0; window.__nat.length = 0; });
          await s.T('touchStart', [{ x, y, id: tid, radiusX: 10, radiusY: 10 }]); tid++; await sleep(40); await s.T('touchEnd', []); await sleep(60);
          const r = await s.page.evaluate(() => ({ hit: window.__hit.slice(), nat: window.__nat.slice() }));
          if (r.nat[0] === id) { targeted++; if (r.hit.includes(id)) fired++; else miss.push(id + ' ' + side + ' ' + d); }
          // put the game back: close the menu, unmute, drop hints
          await s.page.evaluate(() => { if (!document.getElementById('pause').classList.contains('hidden')) resume(); settings.sound = true; setMuteIcon(); G.hints = 0; G.plan = null; });
        }
        ok(targeted > 12 && !miss.length, vp.width + 'x' + vp.height + ': ' + fired + '/' + targeted + ' fired; dropped ' + miss.slice(0, 6).join(', '));
        ok(!s.errors.length, s.errors.join(' | ')); await s.close();
      }
    });
    await at('corrupt or wrong-type saved data never breaks the game (falls back to defaults)', async () => {
      const CASES = [
        { 'pyramid:progress': '{', 'pyramid:settings': '{x', 'pyramid:stats': 'nope', 'pyramid:game': '{"v":1', 'pyramid:unlockAll': 'tru' },
        { 'pyramid:progress': '5' }, { 'pyramid:progress': 'null' }, { 'pyramid:progress': '{"done":[1,2],"last":"x"}' },
        { 'pyramid:settings': '{"seen":null,"skin":"zzz","nums":7}' }, { 'pyramid:stats': '{"ach":null,"daily":null,"plays":"a"}' },
        { 'pyramid:game': '{"v":1,"n":1,"seed":' + LEVELS[0][0] + ',"R":2,"s":{"pm":0,"um":0,"p":3,"r":0},"score":0,"hist":[1,null],"hints":0,"undos":0}' },
        { 'pyramid:game': '{"v":1,"n":5,"seed":1,"R":2,"s":{"pm":0,"um":0,"p":3,"r":0},"score":0,"hist":[],"hints":0}' },
        { 'pyramid:game': '{"v":1,"n":1,"seed":' + LEVELS[0][0] + ',"R":2,"s":{"pm":0,"um":0,"p":"x","r":null},"score":0,"hist":[{"s":{"pm":0,"um":0,"p":0,"r":0},"score":0}]}' }];
      for (const ls of CASES) {
        const s = await open({ width: 390, height: 844 }, { ls: Object.assign({ 'pyramid:settings': null }, ls) });
        await s.page.waitForSelector('#title:not(.hidden)', { timeout: 3000 });
        await s.tapSel('#tPlay'); if (await s.page.isVisible('#intro')) await s.tapSel('#iOk');
        await s.waitSt('s => s.status === "play"');
        const p0 = (await s.st()).s.p, sp = await s.stock(); await s.tap(sp.x, sp.y); await sleep(150);
        const r = await s.st(); ok(typeof r.s.p === 'number' && r.s.p > p0, JSON.stringify(ls) + ': stock does not draw');
        ok(!s.errors.length, JSON.stringify(ls) + ': ' + s.errors.join(' | ')); await s.close();
      }
    });
    await at('random deal offers the three stock rules; starting another game asks before replacing the 繼續 save; landscape win buttons line up', async () => {
      const s = await open({ width: 390, height: 844 }); await s.level(2);
      const sp = await s.stock(); await s.tap(sp.x, sp.y); await sleep(150);
      await s.tapSel('#bPause'); await s.tapSel('#pSelect'); await s.page.locator('.lt[data-n="5"]').scrollIntoViewIfNeeded(); await s.tapSel('.lt[data-n="5"]');
      ok(await s.page.isVisible('#confirm') && /繼續第 2 關/.test(await s.page.textContent('#cfMsg')), 'confirm before replacing the save');
      await s.tapSel('#cfCancel'); ok(await s.page.isVisible('#select') && /"n":2/.test(await s.page.evaluate(() => localStorage.getItem('pyramid:game'))), 'cancel keeps the save');
      await s.page.locator('.lt[data-n="2"]').scrollIntoViewIfNeeded(); await s.tapSel('.lt[data-n="2"]');
      ok(await s.page.isVisible('#cfAlt'), 'tile of the saved level offers 繼續這局'); await s.tapSel('#cfAlt'); await s.waitSt('s => s.status === "play"');
      ok((await s.st()).hist === 1, '繼續這局 resumes it');
      await s.tapSel('#bPause'); await s.tapSel('#pHome'); await s.tapSel('#tRand');
      await s.tapSel('#rp0'); ok(await s.page.isVisible('#confirm'), 'confirm before the random deal'); await s.tapSel('#cfOk');
      await s.waitSt('s => s.n === "rand" && s.status === "play"', null, 20000);
      ok(await s.page.evaluate(() => G.maxR) === 0 && await s.page.textContent('#hRec') === '不可', 'random deal with no recycle');
      const seed = await s.page.evaluate(() => G.D.seed); ok(C.solve(C.dealFromSeed(seed), C.initState(), 0, 400000).ok, 'no-recycle random deal solvable');
      ok(!s.errors.length, s.errors.join(' | ')); await s.close();
      const L = await open({ width: 844, height: 390 });
      await L.page.evaluate(() => { hideAll(); enterLevel(1); G.s = { pm: FULL, um: 0, p: 0, r: 0 }; onWin(); });
      await L.page.waitForSelector('#win:not(.hidden)', { timeout: 5000 }); await sleep(600);
      const tops = await L.page.evaluate(() => ['wRetry', 'wSelect'].map(id => document.getElementById(id).offsetTop + document.getElementById(id).offsetHeight));
      ok(tops[0] === tops[1], '再玩一次 and 選關 bottoms ' + tops); await L.close();
      const P = await open({ width: 375, height: 500 }); await P.level(4); ok(await P.page.evaluate(() => LAY.cw) >= 40, '375x500 card width ' + await P.page.evaluate(() => LAY.cw)); await P.close();
    });
  } finally { await browser.close(); }
}
browserTests().then(() => { console.log((fail ? 'FAIL ' : '') + 'pyramid-solitaire tests: ' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); })
  .catch(e => { console.log('FAIL', e); process.exit(1); });
