// Regression tests for 榫卯木格 (block-fill): core rules in Node, then the page in Chromium with real CDP touch.
// Each block maps to a release-review finding (qa/release/block-fill/score.json, 2026-10-25).
// Usage: node tests.js   (about 30-60 s; waits on conditions, no timing-based assertions)
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {newGame, step, solvable, dealHand, dealTries, mercyChance, diffLevel, hardWeight, SHAPES, SOLVE_BUDGET, applyPlace, canPlace, anyFit, aiBest};')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ID = k => C.SHAPES.findIndex(s => s.key === k);

(async () => {
  console.log('Core');
  await t('combo multiplier matches the help text: k-th combo scores x(1+0.5*(k-1))', () => {
    const G = C.newGame('normal', 1); G.b.fill(0); G.b[40] = 1; // a lone block keeps the board from being cleared
    G.hand = [0, 1, 2].map(() => ({ id: ID('dot'), col: 1, used: false }));
    for (let c = 0; c < 8; c++) { G.b[c] = 1; G.b[9 + c] = 1; }
    const e1 = C.step(G, 0, 0, 8), e2 = C.step(G, 1, 1, 8);
    eq([e1.combo, e1.gain], [1, 1 + 10], 'first clear');
    eq([e2.combo, e2.gain], [2, 1 + Math.round(10 * (1 + 0.5 * (2 - 1)))], 'second clear (shown as x2)');
    ok(/1\+0\.5×\(k−1\)/.test(html), 'help text formula');
  });
  await t('deal guarantee fades smoothly: no cliff at 3000, lamp moves at most one step per 50 pts', () => {
    let prevT = C.dealTries(0), prevD = C.diffLevel(0);
    for (let s = 50; s <= 40000; s += 50) {
      const tr = C.dealTries(s), d = C.diffLevel(s);
      ok(tr <= prevT + 1e-9 && prevT - tr < 0.12, 'tries step at ' + s + ': ' + prevT + ' -> ' + tr);
      ok(d >= prevD && d - prevD <= 1, 'lamp step at ' + s);
      prevT = tr; prevD = d;
    }
    ok(C.dealTries(1999) === 8 && C.dealTries(3000) > 5 && C.dealTries(40000) < 1.01, 'tries curve ' + C.dealTries(3000));
    ok(C.mercyChance(1000) === 1 && C.mercyChance(3000) > 0.8 && C.mercyChance(40000) < 0.51, 'mercy curve');
    eq([C.diffLevel(0), C.diffLevel(40000)], [1, 5]);
  });
  await t('fewer big pieces before 2000 pts, same ceiling later', () => {
    ok(C.hardWeight(500) < 0.13 && C.hardWeight(2000) < 0.23 && Math.abs(C.hardWeight(1e6) - 0.30) < 1e-9, 'hard weight');
  });
  await t('solvable() search is capped (no 80-160 ms deal stalls)', () => {
    let maxUsed = 0;
    for (let g = 0; g < 25; g++) {
      const G = C.newGame('normal', 11 + g * 977); let n = 0;
      while (!G.over && n < 400) {
        const m = C.aiBest(G, true); if (!m) break; C.step(G, m.slot, m.r, m.c); n++;
        if (n % 4) continue;
        for (let k = 0; k < 4; k++) {
          const ids = [0, 1, 2].map(i => (g * 7 + n * 3 + k * 5 + i * 11) % C.SHAPES.length), bud = { n: C.SOLVE_BUDGET };
          C.solvable(G.b, ids, bud); maxUsed = Math.max(maxUsed, C.SOLVE_BUDGET - bud.n);
        }
      }
    }
    ok(maxUsed <= C.SOLVE_BUDGET + 1, 'used ' + maxUsed);
  });
  await t('daily deals stay deterministic for a seed', () => {
    const a = C.newGame('daily', 20261025), b = C.newGame('daily', 20261025);
    eq(a.hand.map(p => p.id), b.hand.map(p => p.id));
  });

  console.log('Page');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  const URL = 'file://' + APP;
  async function open(w, h, scheme, prep) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme || 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.addInitScript(() => { addEventListener('DOMContentLoaded', () => { window.__cap = 0; const cv = document.getElementById('cv'), o = cv.setPointerCapture.bind(cv); cv.setPointerCapture = id => { window.__cap++; return o(id); }; }); });
    await page.goto(URL + '?seed=42');
    await page.evaluate(p => { localStorage.clear(); localStorage.setItem('blockfill.settings', JSON.stringify({ sound: false, vib: false, theme: 'auto' })); for (const k in p) localStorage.setItem('blockfill.' + k, typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k])); }, prep || {});
    await page.reload();
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }
  const waitFor = async (page, fn, arg, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + fn.toString().slice(0, 90)); await sleep(25); } };
  const waitVis = (page, sel) => waitFor(page, s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden') && e.getBoundingClientRect().width > 0; }, sel, 5000).then(() => true, () => false);
  const st = page => page.evaluate(() => window.__game.state());
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden') && e.getBoundingClientRect().width > 0; }, sel);
  async function touch(cdp, type, x, y) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] }); }
  async function tap(cdp, page, sel) {
    await waitFor(page, s => { const e = document.querySelector(s); return e && !e.classList.contains('hidden') && !e.closest('.hidden'); }, sel);
    const b = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await touch(cdp, 'touchStart', b.x, b.y); await sleep(40); await touch(cdp, 'touchEnd'); await sleep(60);
  }
  const settled = (page, sel) => waitFor(page, s => !document.querySelector(s).getAnimations({ subtree: true }).length, sel); // card pop-in done
  const geo = page => page.evaluate(() => window.__game.layout());
  const slotPt = (L, i) => ({ x: L.tray.x + L.tray.w / 3 * (i + 0.5), y: L.tray.y + L.tray.h / 2 });
  // finger position that drops shape `key` with its top-left cell on (r, c)
  const fingerAt = (L, key, r, c) => { const s = C.SHAPES[ID(key)]; return { x: L.bx + c * L.cell + s.w * L.cell / 2, y: L.by + r * L.cell + s.h * L.cell + L.lift }; };
  async function drag(cdp, a, b, steps = 8) {
    await touch(cdp, 'touchStart', a.x, a.y);
    for (let i = 1; i <= steps; i++) { await sleep(20); await touch(cdp, 'touchMove', a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps); }
    await sleep(20); await touch(cdp, 'touchEnd');
  }
  async function placeAi(page, cdp) { const n = (await st(page)).placed, m = await page.evaluate(() => window.__game.aiMove()); await drag(cdp, m.from, m.to); await waitFor(page, n => window.__game.state().placed > n && !window.__game.state().flying, n); }
  // a save with a hand of [a, b, c] on a board given as a list of filled cells
  function mkSave(filled, keys, extra) {
    const b = new Array(81).fill(0); filled.forEach(i => { b[i] = 4; });
    return Object.assign({ b, hand: keys.map((k, i) => ({ id: ID(k), col: i + 1, used: false })), score: 50, streak: 0, since: 0, round: 3, R: { s: 7 }, mode: 'normal', seed: 7, revived: false, undone: false, lines: 0, maxCombo: 0, placed: 5, boardClears: 0, maxLines: 0, over: false, counted: 0 }, extra || {});
  }
  // two holes per row/column, never a 3x3 gap: a dot fits, a 3x3 block never does, and nothing clears
  const holes = []; for (let r = 0; r < 9; r++) { holes.push(r * 9 + r); holes.push(r * 9 + (r + 4) % 9); }
  const STUCK = mkSave([...Array(81).keys()].filter(i => !holes.includes(i)), ['dot', 'o3', 'o3']);

  await t('VETO: presses while a piece flies back/in are never swallowed (8 presses/s alternating slots)', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1 });
    await tap(cdp, page, '#tNew'); await waitFor(page, () => window.__game.state().mode === 'play');
    const L = await geo(page), OFF = { x: L.W / 2, y: 6 }; // dropping here is never legal -> 180 ms fly-back
    const c0 = await page.evaluate(() => window.__cap), p0 = (await st(page)).placed;
    for (let i = 0; i < 24; i++) {
      const t0 = Date.now(), p = slotPt(L, i % 2 ? 2 : 0);
      await touch(cdp, 'touchStart', p.x, p.y); await sleep(40); await touch(cdp, 'touchMove', OFF.x, OFF.y); await sleep(10); await touch(cdp, 'touchEnd');
      await sleep(Math.max(0, 125 - (Date.now() - t0)));
    }
    const picked = (await page.evaluate(() => window.__cap)) - c0;
    eq((await st(page)).placed, p0, 'nothing placed by accident');
    eq(picked, 24, 'presses that started a drag');
    // right after a valid drop (90 ms fly-in) another piece is picked up at once, and the drop is committed
    for (let rep = 0; rep < 3; rep++) {
      const s0 = await st(page), m = await page.evaluate(() => window.__game.aiMove()), other = [0, 1, 2].find(i => i !== m.slot && s0.hand[i]);
      if (other == null) { await placeAi(page, cdp); continue; }
      await drag(cdp, m.from, m.to);
      eq((await st(page)).placed, s0.placed + 1, 'committed on release, before the slide-in finishes');
      const q = slotPt(L, other);
      await touch(cdp, 'touchStart', q.x, q.y);
      const s1 = await st(page);
      eq([s1.dragging, s1.placed], [other, s0.placed + 1], 'press right after a drop');
      await touch(cdp, 'touchMove', OFF.x, OFF.y); await touch(cdp, 'touchEnd'); await sleep(30);
    }
    // the pause button works during a fly-back too
    const p = slotPt(L, 0); await drag(cdp, p, OFF, 2); await tap(cdp, page, '#bMenu');
    ok(await waitVis(page, '#pause'), 'pause opened');
    await ctx.close();
  });

  await t('daily challenge and normal game keep separate saves; new game asks before overwriting', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1 });
    await tap(cdp, page, '#tNew'); await waitFor(page, () => window.__game.state().mode === 'play');
    await placeAi(page, cdp); await placeAi(page, cdp);
    const normal = (await st(page)).score;
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pHome');
    await tap(cdp, page, '#tDaily'); await waitFor(page, () => window.__game.state().gmode === 'daily');
    await placeAi(page, cdp);
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pHome');
    const info = await page.textContent('#tContInfo');
    ok(info.startsWith(normal.toLocaleString('en-US') + ' 分'), 'continue still shows the normal game: ' + info);
    ok(/繼續/.test(await page.textContent('#tDailyInfo')), 'daily button offers to continue');
    await tap(cdp, page, '#tCont'); await waitFor(page, () => window.__game.state().mode === 'play');
    eq([(await st(page)).gmode, (await st(page)).score], ['normal', normal]);
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pHome');
    await tap(cdp, page, '#tNew'); ok(await waitVis(page, '#confirm'), 'confirm before overwriting');
    await tap(cdp, page, '#cNo'); ok(await waitVis(page, '#title'), 'cancel returns to title');
    eq((await page.evaluate(() => JSON.parse(localStorage.getItem('blockfill.save')))).score, normal, 'save untouched');
    await tap(cdp, page, '#tNew'); await tap(cdp, page, '#cBtns .btn'); await waitFor(page, () => window.__game.state().mode === 'play');
    eq((await st(page)).score, 0, 'new game after confirm');
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pRestart'); ok(await waitVis(page, '#confirm'), 'restart asks too');
    await tap(cdp, page, '#cNo'); ok(await waitVis(page, '#pause'), 'cancel returns to pause');
    await ctx.close();
  });

  await t('old single-slot save holding a daily game moves to its own slot', async () => {
    const day = 20200101, { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1, save: mkSave([1, 2, 3], ['dot', 'i2h', 'o2'], { mode: 'daily', seed: day, score: 77 }) });
    const ls = await page.evaluate(() => [localStorage.getItem('blockfill.save'), JSON.parse(localStorage.getItem('blockfill.saveDaily') || 'null')]);
    ok(ls[0] === null && ls[1] && ls[1].score === 77, 'migrated');
    await tap(cdp, page, '#tDaily'); ok(await waitVis(page, '#confirm'), 'asks before replacing an unfinished older daily');
    await tap(cdp, page, '#cBtns .btn.sec'); await waitFor(page, () => window.__game.state().mode === 'play');
    eq((await st(page)).score, 77, 'continued the older daily');
    await ctx.close();
  });

  await t('broken saved data does not stop the app from opening', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { save: '[]', saveDaily: '{"b":[1,2],"mode":"daily"}', stats: '{"shapes":null,"ach":5,"games":"x"}', daily: '[3]', dhist: '"?"', best: '"abc"' });
    ok(await waitVis(page, '#title'), 'title shown');
    await tap(cdp, page, '#tStats'); ok(await waitVis(page, '#stats'), 'stats open');
    await tap(cdp, page, '#stOk'); ok(await waitVis(page, '#title'), 'back on title');
    await page.evaluate(() => localStorage.setItem('blockfill.save', JSON.stringify({ b: new Array(81).fill(0), hand: [{ id: 0, col: 1 }, { id: 0, col: 1 }, { id: 0, col: 1 }] })));
    await page.reload(); ok(await waitVis(page, '#title'), 'save missing score: title shown');
    ok(!(await visible(page, '#tCont')), 'bad save dropped');
    await ctx.close();
  });

  await t('revive survives a refresh; undo cannot cross a game over or hand back the revive', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1, save: STUCK, stats: { games: 19, total: 1000 } });
    await tap(cdp, page, '#tCont'); await waitFor(page, () => window.__game.state().mode === 'play');
    const L = await geo(page);
    await drag(cdp, slotPt(L, 0), fingerAt(L, 'dot', 0, 0));
    await waitFor(page, () => !document.getElementById('over').classList.contains('hidden'));
    eq((await st(page)).games, 20, 'counted once');
    ok(/常客/.test(await page.textContent('#oAch')) && await waitVis(page, '#oAch'), 'achievement listed on the result card');
    await sleep(1200); ok(!(await visible(page, '#toast')), 'no toast over the result card');
    await page.reload();
    ok(/可復活/.test(await page.textContent('#tContInfo')), 'title offers the revive after refresh');
    await tap(cdp, page, '#tCont'); await waitFor(page, () => !document.getElementById('over').classList.contains('hidden'));
    ok(await waitVis(page, '#oRevive'), 'revive button still there');
    eq((await st(page)).games, 20, 'not counted twice');
    await tap(cdp, page, '#oRevive');
    await touch(cdp, 'touchStart', L.bx + 4.5 * L.cell, L.by + 4.5 * L.cell); await touch(cdp, 'touchEnd');
    await waitFor(page, () => window.__game.state().mode === 'play');
    let s = await st(page); eq([s.revived, s.undoable], [true, false], 'after revive');
    ok(await page.evaluate(() => document.getElementById('bUndo').disabled && document.getElementById('undoN').classList.contains('hidden')), 'undo button disabled, badge hidden after revive');
    await drag(cdp, slotPt(L, 1), fingerAt(L, 'o3', 3, 3));
    await waitFor(page, () => window.__game.state().undoable);
    await tap(cdp, page, '#bUndo'); s = await st(page);
    eq([s.revived, s.undoable, s.games], [true, false, 20], 'undo after revive keeps the revive used');
    await ctx.close();
  });

  await t('undo survives a refresh and rolls back best score', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1 });
    await tap(cdp, page, '#tNew'); await waitFor(page, () => window.__game.state().mode === 'play');
    await placeAi(page, cdp);
    ok((await st(page)).best > 0, 'best rose');
    await page.reload(); await tap(cdp, page, '#tCont'); await waitFor(page, () => window.__game.state().mode === 'play');
    ok(!(await page.evaluate(() => document.getElementById('bUndo').disabled)), 'undo still available after refresh');
    await tap(cdp, page, '#bUndo');
    const s = await st(page); eq([s.score, s.best, s.placed], [0, 0, 0]);
    eq(await page.evaluate(() => [localStorage.getItem('blockfill.best'), JSON.parse(localStorage.getItem('blockfill.stats')).shapes]), ['0', {}], 'stored best/stats rolled back');
    await ctx.close();
  });

  await t('HUD: dots for the placements left after a clear, the combo word from x2', async () => {
    const row = [0, 1, 2, 3, 4, 5, 6, 7], { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1, save: mkSave(row.concat(row.map(i => i + 9), [40]), ['dot', 'dot', 'dot']) });
    await tap(cdp, page, '#tCont'); await waitFor(page, () => window.__game.state().mode === 'play');
    const L = await geo(page);
    await drag(cdp, slotPt(L, 0), fingerAt(L, 'dot', 0, 8));
    await waitFor(page, () => window.__game.state().streak === 1 && !window.__game.state().flying);
    const lab = () => page.evaluate(() => [document.getElementById('hLabel').textContent, document.querySelectorAll('#hLabel .cd i.on').length]);
    eq(await lab(), ['分數', 3], 'after the first clear');
    await drag(cdp, slotPt(L, 1), fingerAt(L, 'dot', 8, 8));
    await waitFor(page, () => window.__game.state().since === 1);
    eq(await lab(), ['分數', 2], 'one placement used');
    await drag(cdp, slotPt(L, 2), fingerAt(L, 'dot', 1, 8));
    await waitFor(page, () => window.__game.state().streak === 2);
    eq(await lab(), ['連擊×2', 3], 'second clear');
    await ctx.close();
  });

  await t('daily streak, history on the result card and 18 tiered achievements', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1 });
    await page.evaluate(() => { const d = new Date(Date.now() - 864e5), y = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); const o = {}; o[y] = 120; localStorage.setItem('blockfill.dhist', JSON.stringify({ days: o, streak: 2, maxStreak: 2, last: y })); });
    await page.reload(); await tap(cdp, page, '#tDaily'); await waitFor(page, () => window.__game.state().gmode === 'daily');
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pHome');
    ok(/連續 3 天/.test(await page.textContent('#tDailyInfo')), 'streak on title: ' + await page.textContent('#tDailyInfo'));
    await tap(cdp, page, '#tStats');
    eq(await page.evaluate(() => document.querySelectorAll('#stAch .ach').length), 18);
    ok(await page.evaluate(() => document.querySelector('#stAch .ach.on') && /三日不輟/.test(document.querySelector('#stAch .ach.on').textContent)), 'd3 unlocked');
    await ctx.close();
  });

  await t('first game shows a drag hint until the first drop', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', {});
    await tap(cdp, page, '#tNew'); await waitFor(page, () => window.__game.state().mode === 'play');
    ok((await st(page)).hint, 'hint on');
    await placeAi(page, cdp);
    eq([(await st(page)).hint, await page.evaluate(() => localStorage.getItem('blockfill.hinted'))], [false, '1']);
    await ctx.close();
  });

  await t('dark mode lifts the dark walnut piece; theme buttons are 44 px tall', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'dark', { hinted: 1 });
    ok((await page.evaluate(() => window.__game.blockColor(4))) !== '#6b4a3a', 'dark colour 4');
    await tap(cdp, page, '#tSet'); await settled(page, '#settings');
    const hs = await page.evaluate(() => [...document.querySelectorAll('#sTheme button')].map(b => b.getBoundingClientRect().height));
    ok(hs.every(h => h >= 44), 'heights ' + hs);
    await ctx.close();
    const l = await open(390, 844, 'light', { hinted: 1 });
    eq(await l.page.evaluate(() => window.__game.blockColor(4)), '#6b4a3a', 'light colour 4 unchanged');
    await l.ctx.close();
  });

  await t('wood themes unlock with achievements and stay locked otherwise', async () => {
    const { ctx, page, cdp } = await open(390, 844, 'light', { hinted: 1, stats: { ach: { s1k: 1 } } });
    await tap(cdp, page, '#tSet'); await settled(page, '#settings');
    eq(await page.evaluate(() => [...document.querySelectorAll('#sWood button')].map(b => b.classList.contains('lk'))), [false, false, true, true]);
    ok(await page.evaluate(() => [...document.querySelectorAll('#sWood button')].every(b => b.getBoundingClientRect().height >= 44)), '44 px');
    await tap(cdp, page, '#sWood [data-v=cherry]');
    eq([await page.evaluate(() => window.__game.blockColor(1)), await page.evaluate(() => JSON.parse(localStorage.getItem('blockfill.settings')).wood)], ['#e39a7a', 'cherry']);
    await tap(cdp, page, '#sWood [data-v=ebony]');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('blockfill.settings')).wood), 'cherry', 'locked wood not applied');
    await page.evaluate(() => localStorage.setItem('blockfill.settings', JSON.stringify({ sound: false, wood: 'ebony' })));
    await page.reload(); eq(await page.evaluate(() => window.__game.blockColor(1)), '#e8c07d', 'locked wood in storage falls back to walnut');
    await ctx.close();
  });

  await t('360 px daily result: phrases do not break, no toast over the title', async () => {
    const now = new Date(), ds = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const sv = Object.assign({}, STUCK, { mode: 'daily', seed: ds, score: 12345 });
    const { ctx, page, cdp } = await open(360, 640, 'light', { hinted: 1, saveDaily: sv, daily: { seed: ds, best: 12345, plays: 3 } });
    await tap(cdp, page, '#tDaily'); await waitFor(page, () => window.__game.state().mode === 'play');
    const L = await geo(page);
    await drag(cdp, slotPt(L, 0), fingerAt(L, 'dot', 0, 0));
    await waitFor(page, () => !document.getElementById('over').classList.contains('hidden'));
    ok(await page.evaluate(() => [...document.querySelectorAll('#over .nw')].length >= 5 && [...document.querySelectorAll('#over .nw')].every(e => e.getClientRects().length === 1)), 'each phrase on one line');
    await ctx.close();
  });

  await t('landscape 844x390: bigger board, help card fits without scrolling', async () => {
    const { ctx, page, cdp } = await open(844, 390, 'light', { hinted: 1 });
    await tap(cdp, page, '#tNew'); await waitFor(page, () => window.__game.state().mode === 'play');
    const L = await geo(page);
    ok(L.cell >= 37, 'cell ' + L.cell);
    ok(L.tc >= 25, 'tray cell ' + L.tc);
    const hud = await page.evaluate(() => document.getElementById('hud').getBoundingClientRect().toJSON());
    ok(hud.left >= L.bx + 9 * L.cell, 'HUD sits beside the board');
    await tap(cdp, page, '#bMenu'); await tap(cdp, page, '#pHelp'); await settled(page, '#help');
    const r = await page.evaluate(() => [document.getElementById('hOk').getBoundingClientRect().bottom, innerHeight, document.getElementById('help').scrollHeight - document.getElementById('help').clientHeight]);
    ok(r[0] <= r[1] && r[2] <= 0, 'help card ' + r);
    await tap(cdp, page, '#hOk'); await tap(cdp, page, '#pSet'); await settled(page, '#settings');
    const q = await page.evaluate(() => document.getElementById('settings').scrollHeight - document.getElementById('settings').clientHeight);
    ok(q <= 0, 'settings card fits: ' + q);
    await ctx.close();
  });

  await browser.close();
  await t('no page or console errors', () => eq(errors, []));
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.stack); process.exit(1); });
