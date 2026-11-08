// Regression tests for 馬賽克數和 (kakuro). Usage: node tests.js [--node-only]
// Part 1 (node): the game's own core (CORE-START/CORE-END), level table, daily table.
// Part 2 (browser, one Chromium, real CDP touch events): fixes from the 2026-11-07 release review —
// number keys / tools fire per finger on pointerdown (overlapping taps are not swallowed, no double count),
// error-highlight toggle cannot reveal answers for free, master badge needs the whole level without dimming,
// "continue" resumes the last played level, undo survives a reload, old saves still load (incl. replaced levels),
// short screens (lobby 375x500) get the compact two-row pad and start zoomed, combo "+N" marker and full list,
// sloppier taps when not zoomed, restart needs a second tap, daily streak/history, L20 block-sum picture.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {decodeLevel, humanSolve, countSolutions, genLevel, mkRng, SGL, COMBOS};')();
const LEVELS = JSON.parse('[' + html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + ']');
const LEGACY = new Function('return {' + html.match(/var LEGACY = \{\/\*LEGACY\*\/([\s\S]*?)\};/)[1] + '};')();
const DAILY_CFG = new Function(html.match(/var DAILY_CFG = (\[[\s\S]*?\n\]);/)[0] + '\nreturn DAILY_CFG;')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t3frac = P => { const h = C.humanSolve(P, { maxTier: 3 }); return h.ok ? 1 : P.white.filter(c => C.SGL[h.cand[c]]).length / P.white.length; };

(async () => {
  const T0 = Date.now();
  console.log('Core and levels');
  await t('all 100 levels: unique, human-solvable within their techniques, embedded score reproduced, strictly rising', () => {
    let prev = 0;
    for (let n = 1; n <= LEVELS.length; n++) {
      const P = C.decodeLevel(LEVELS[n - 1]), [score, top] = P.meta[0].split(',').map(Number);
      const hs = C.humanSolve(P, { maxTier: n < 20 ? 3 : n < 80 ? 4 : 5 });
      ok(hs.ok && hs.score === score && hs.top === top, 'L' + n + ' human ' + hs.ok + ' ' + hs.score + '/' + score);
      ok(P.white.every(c => C.SGL[hs.cand[c]] === P.sol[c]), 'L' + n + ' solution');
      ok(score > prev, 'L' + n + ' not harder'); prev = score;
    }
  });
  await t('L19->L20 transition: L20, L22, L25 need block-sum exactly once and a T3 player gets at least half the board', () => {
    for (const n of [20, 22, 25]) {
      const P = C.decodeLevel(LEVELS[n - 1]), hs = C.humanSolve(P, { maxTier: 4 });
      ok(C.countSolutions(P, 2, 2000000).count === 1, 'L' + n + ' unique');
      ok(hs.top === 4 && hs.used[4] === 1, 'L' + n + ' block-sum uses ' + hs.used[4]);
      const f = t3frac(P); ok(f >= 0.5, 'L' + n + ' T3 share ' + f.toFixed(2));
    }
    const P20 = C.decodeLevel(LEVELS[19]); ok(C.humanSolve(P20, { maxTier: 4 }).score / C.decodeLevel(LEVELS[18]).meta[0].split(',')[0] < 1.6, 'L19->L20 jump');
  });
  await t('replaced levels keep their old puzzle for old saves (LEGACY table)', () => {
    const ks = Object.keys(LEGACY).map(Number);
    ok(ks.length >= 1, 'no legacy entries');
    for (const n of ks) { ok(LEGACY[n] !== LEVELS[n - 1], 'L' + n + ' same'); const P = C.decodeLevel(LEGACY[n]); ok(C.humanSolve(P, { maxTier: 4 }).ok, 'legacy L' + n); }
  });
  await t('daily puzzle changes with the weekday (sizes and techniques) and every weekday generates', () => {
    ok(DAILY_CFG.length === 7, 'table');
    ok(new Set(DAILY_CFG.map(c => c.R + 'x' + c.C)).size >= 3, 'sizes'); ok(new Set(DAILY_CFG.map(c => c.maxTier)).size >= 2, 'techniques');
    for (let w = 0; w < 7; w++) {
      const key = 20261108 + w, rnd = C.mkRng(key * 31 + 7); let P = null;
      for (let k = 0; k < 400 && !P; k++) P = C.genLevel(DAILY_CFG[w], rnd);
      ok(P && P.R === DAILY_CFG[w].R, 'weekday ' + w);
    }
  });
  await t('static: theme buttons 44 px, darker dark-mode run tint, offscreen win mosaic, title at ~30 fps, clue font floor', () => {
    ok(/\.seg button\{min-height:44px/.test(html), 'seg');
    ok(/tint: 'rgba\(224,180,80,0\.24\)'/.test(html), 'tint');
    ok(/M\.off = document\.createElement\('canvas'\)/.test(html) && /tris\.sort/.test(html), 'mosaic');
    ok(/now - tLast < 30/.test(html), 'title fps');
    ok(/cfs = Math\.max\(10\.5 \/ z/.test(html) && /cfs2 = w2 > lim/.test(html), 'clue font');
  });
  if (process.argv.includes('--node-only')) return done(T0);

  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const br = await chromium.launch({ args: ['--disable-gpu'] });
  const errors = [];
  async function open(w, h) {
    const ctx = await br.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'x' + h + ' ' + e)); page.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' ' + m.text()); });
    await page.goto('file://' + APP);
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }
  async function waitFor(page, fn, arg, ms = 8000) {
    const t0 = Date.now();
    for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + String(fn).slice(0, 80)); await sleep(40); }
  }
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p[0], y: p[1], id: p[2] || 0, radiusX: 3, radiusY: 3 })) });
  async function tap(cdp, x, y) { await touch(cdp, 'touchStart', [[x, y, 1]]); await sleep(30); await touch(cdp, 'touchEnd', []); await sleep(20); }
  async function center(page, sel) { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
  async function setup(page, store) {
    // leave the page first: a reload saves the running game on visibilitychange and would overwrite injected saves
    await page.goto('about:blank'); await page.goto('file://' + APP);
    await page.evaluate(s => { localStorage.clear(); for (const k in s) localStorage.setItem('kakuro.' + k, JSON.stringify(s[k])); }, store || {});
    await page.reload(); await waitFor(page, () => !document.getElementById('title').classList.contains('hidden'));
  }
  async function startLv(page, n) {
    await page.evaluate(() => document.getElementById('tSelect').click());
    await page.evaluate(n => document.querySelector('.lt[data-n="' + n + '"]').click(), n);
    await waitFor(page, n => { const s = window.__game.state(); return s && s.level === n; }, n);
    if (await page.isVisible('#info')) await page.evaluate(() => document.getElementById('iOk').click());
  }
  const st = page => page.evaluate(() => window.__game.state());
  const key = (page, k) => page.evaluate(k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })), k);
  async function fill(page, cells) { for (const [c, d] of cells) { await page.evaluate(c => window.__game.pick(c), c); await key(page, String(d)); } }
  async function toggleSetting(page, k) {
    await page.evaluate(() => document.getElementById('bPause').click()); await page.evaluate(() => document.getElementById('pSet').click());
    await page.evaluate(k => document.querySelector('#settings .sw[data-k="' + k + '"]').click(), k);
    await page.evaluate(() => document.getElementById('setOk').click());
  }
  const sol = n => { const P = C.decodeLevel(LEVELS[n - 1]); return P.white.map(c => [c, P.sol[c]]); };

  try {
    console.log('Browser 390x844');
    let { ctx, page, cdp } = await open(390, 844);
    await setup(page, { unlockAll: true });

    await t('overlapping touches on number keys: finger 2 while finger 1 holds, 16 fast overlapping taps, all counted once', async () => {
      await startLv(page, 10);
      const P = C.decodeLevel(LEVELS[9]); await page.evaluate(c => window.__game.pick(c), P.white[0]);
      const k3 = await center(page, '.k[data-d="3"]'), k4 = await center(page, '.k[data-d="4"]');
      const m0 = (await st(page)).moves;
      await touch(cdp, 'touchStart', [[...k3, 1]]); await sleep(40);
      await touch(cdp, 'touchStart', [[...k3, 1], [...k4, 2]]); await sleep(40);
      await touch(cdp, 'touchEnd', [[...k3, 1]]); await sleep(30); await touch(cdp, 'touchEnd', []);
      await waitFor(page, m => window.__game.state().moves >= m + 2, m0);
      await sleep(150); ok((await st(page)).moves === m0 + 2, 'two-finger: ' + ((await st(page)).moves - m0) + '/2');
      // rapid overlap: each finger lands before the previous one lifts
      const m1 = (await st(page)).moves; let held = null;
      for (let i = 0; i < 16; i++) {
        const p = i % 2 ? k4 : k3, id = 10 + i, now = [...p, id];
        await touch(cdp, 'touchStart', held ? [held, now] : [now]); await sleep(25);
        if (held) await touch(cdp, 'touchEnd', [now]); held = now; await sleep(25);
      }
      await touch(cdp, 'touchEnd', []);
      await waitFor(page, m => window.__game.state().moves >= m + 16, m1);
      await sleep(200); ok((await st(page)).moves === m1 + 16, 'overlap ' + ((await st(page)).moves - m1) + '/16');
    });
    await t('holding a board cell with one finger while the other taps a number key fills the cell', async () => {
      const P = C.decodeLevel(LEVELS[9]), c = P.white[1];
      await page.evaluate(c => window.__game.pick(c), c);
      const cc = await page.evaluate(c => window.__game.cellCenter(c), c), k5 = await center(page, '.k[data-d="5"]');
      await touch(cdp, 'touchStart', [[cc.x, cc.y, 1]]); await sleep(60);
      await touch(cdp, 'touchStart', [[cc.x, cc.y, 1], [...k5, 2]]); await sleep(60);
      await touch(cdp, 'touchEnd', [[cc.x, cc.y, 1]]); await sleep(30); await touch(cdp, 'touchEnd', []);
      await waitFor(page, c => window.__game.vals()[c] === 5, c);
    });
    await t('single touch / mouse click / keyboard Enter on a key and on undo each count exactly once', async () => {
      const P = C.decodeLevel(LEVELS[9]), c = P.white[2]; await page.evaluate(c => window.__game.pick(c), c);
      let m = (await st(page)).moves;
      await tap(cdp, ...(await center(page, '.k[data-d="1"]'))); await sleep(250); ok((await st(page)).moves === m + 1, 'touch');
      await page.click('.k[data-d="2"]'); await sleep(250); ok((await st(page)).moves === m + 2, 'mouse');
      await page.focus('.k[data-d="6"]'); await page.keyboard.press('Enter'); await sleep(250); ok((await st(page)).moves === m + 3, 'keyboard');
      await tap(cdp, ...(await center(page, '#tUndo'))); await sleep(250); ok((await st(page)).moves === m + 2, 'undo once');
    });
    await t('a tap that drifts 12 px still selects the cell when the board is not zoomed', async () => {
      const P = C.decodeLevel(LEVELS[9]), c = P.white[P.white.length - 1];
      ok((await st(page)).zoom === 1, 'zoomed');
      const p = await page.evaluate(c => window.__game.cellCenter(c), c);
      await touch(cdp, 'touchStart', [[p.x - 6, p.y, 1]]); await sleep(20);
      await touch(cdp, 'touchMove', [[p.x + 6, p.y, 1]]); await sleep(20); await touch(cdp, 'touchEnd', []);
      await waitFor(page, c => window.__game.sel() === c, c);
    });

    await t('error highlight off -> guess -> on: every revealed wrong digit counts once (also after toggling again and reload)', async () => {
      await setup(page, { unlockAll: true, settings: { err: false } });
      await startLv(page, 30);
      const P = C.decodeLevel(LEVELS[29]), used = new Set(), pick = [];
      for (const c of P.white) { const a = P.cellRun[c * 2], b = P.cellRun[c * 2 + 1]; if (used.has(a) || used.has(b)) continue; used.add(a); used.add(b); pick.push([c, P.sol[c] % 9 + 1]); if (pick.length === 3) break; }
      await fill(page, pick); ok((await st(page)).errors === 0, 'errors before ' + (await st(page)).errors);
      await toggleSetting(page, 'err');
      ok((await st(page)).errors === 3, 'after on ' + (await st(page)).errors); ok(/計入錯誤/.test(await page.textContent('#toast')), 'toast');
      await toggleSetting(page, 'err'); await toggleSetting(page, 'err');
      ok((await st(page)).errors === 3, 'after off/on ' + (await st(page)).errors);
      await page.reload(); await waitFor(page, () => !document.getElementById('title').classList.contains('hidden'));
      await startLv(page, 30); ok((await st(page)).errors === 3, 'after reload ' + (await st(page)).errors);
    });

    await t('master badge: dimming switched off mid-level gives no badge; a level played without dimming does', async () => {
      await setup(page, { unlockAll: true, seen: { 1: 1, 2: 1, 3: 1 } });
      await startLv(page, 1); ok((await st(page)).usedDim === true, 'ud');
      await toggleSetting(page, 'dim');
      await fill(page, sol(1)); await waitFor(page, () => !document.getElementById('win').classList.contains('hidden'), null, 10000);
      ok(!/大師/.test(await page.textContent('#wBadges')), 'badge without full no-dim');
      ok((await page.evaluate(() => JSON.parse(localStorage.getItem('kakuro.progress'))[1].m)) === 0, 'progress m');
      await startLv(page, 2); ok((await st(page)).usedDim === false, 'ud L2');
      await fill(page, sol(2)); await waitFor(page, () => !document.getElementById('win').classList.contains('hidden'), null, 10000);
      ok(/大師/.test(await page.textContent('#wBadges')), 'badge');
    });

    await t('title "continue" resumes the last played level with a save; undo history survives reload', async () => {
      await setup(page, { unlockAll: true });
      await startLv(page, 12);
      const P = C.decodeLevel(LEVELS[11]);
      await fill(page, [[P.white[0], P.sol[P.white[0]]], [P.white[3], P.sol[P.white[3]]]]);
      await page.reload(); await waitFor(page, () => !document.getElementById('title').classList.contains('hidden'));
      ok(/繼續第 12 關/.test(await page.textContent('#tPlay')), 'title: ' + await page.textContent('#tPlay'));
      await page.evaluate(() => document.getElementById('tPlay').click());
      await waitFor(page, () => window.__game.state() && window.__game.state().level === 12);
      ok((await st(page)).moves === 2 && (await st(page)).filled === 2, 'restored ' + JSON.stringify(await st(page)));
      ok(!(await page.isDisabled('#tUndo')), 'undo disabled');
      await tap(cdp, ...(await center(page, '#tUndo'))); await sleep(250);
      const s = await st(page); ok(s.filled === 1 && s.redos === 1, 'undo after reload ' + JSON.stringify(s));
    });
    await t('restart with progress needs a second tap', async () => {
      await page.evaluate(() => document.getElementById('bPause').click());
      await page.evaluate(() => document.getElementById('pRestart').click());
      ok((await st(page)).filled === 1, 'reset on first tap'); ok(/再按一次/.test(await page.textContent('#pRestart')), 'label');
      await page.evaluate(() => document.getElementById('pRestart').click());
      await waitFor(page, () => window.__game.state().filled === 0);
    });
    await t('old-format saves load: plain board (no undo/charged fields) and a replaced level keeps its old puzzle', async () => {
      const n = +Object.keys(LEGACY)[0], LP = C.decodeLevel(LEGACY[n]);
      let v = ''; for (let i = 0; i < LP.N; i++) v += i === LP.white[0] ? LP.sol[i] : '0';
      const P12 = C.decodeLevel(LEVELS[11]); let v12 = ''; for (let i = 0; i < P12.N; i++) v12 += i === P12.white[1] ? P12.sol[i] : '0';
      const cur = {}; cur['cur.' + n] = { v, nt: '', t: 42, e: 1, h: 0, a: 0 }; cur['cur.12'] = { v: v12, nt: '', t: 30, e: 2, h: 1, a: 0 };
      await setup(page, Object.assign({ unlockAll: true, seen: { 20: 1 } }, cur));
      await startLv(page, n);
      ok((await page.evaluate(() => window.__game.code())) === LEGACY[n], 'old puzzle not kept');
      let s = await st(page); ok(s.filled === 1 && s.errors === 1, 'legacy state ' + JSON.stringify(s));
      await page.evaluate(() => document.getElementById('bPause').click());
      await page.evaluate(() => document.getElementById('pRestart').click()); await page.evaluate(() => document.getElementById('pRestart').click());
      await waitFor(page, l => window.__game.code() !== l, LEGACY[n]);
      ok((await page.evaluate(() => window.__game.code())) === LEVELS[n - 1], 'restart gives new puzzle');
      await startLv(page, 12); s = await st(page); ok(s.filled === 1 && s.errors === 2 && s.hints === 1, 'L12 old save ' + JSON.stringify(s));
    });
    await t('combo row shows "+N" when combos are cut off and a tap opens the full list', async () => {
      await setup(page, { unlockAll: true });
      await startLv(page, 100);
      const P = C.decodeLevel(LEVELS[99]); let cell = -1, d = 0, cnt = 0;
      for (const r of P.runs) if (!r.hid && C.COMBOS[r.len][r.sum].length > cnt) { cnt = C.COMBOS[r.len][r.sum].length; cell = r.cells[0]; d = r.d; }
      await page.evaluate(c => window.__game.pick(c), cell);
      await waitFor(page, d => document.getElementById('cr' + d).classList.contains('ovf'), d);
      ok(/^\+\d+/.test(await page.textContent('#cm' + d)), 'marker ' + await page.textContent('#cm' + d));
      await tap(cdp, ...(await center(page, '#cl' + d)));
      await waitFor(page, () => !document.getElementById('cpop').classList.contains('hidden'));
      ok((await page.locator('#cpopC .chip').count()) === cnt, 'chips ' + cnt);
      await tap(cdp, ...(await center(page, '#cpopX'))); await waitFor(page, () => document.getElementById('cpop').classList.contains('hidden'));
    });
    await t('settings: theme buttons at least 44 px tall', async () => {
      await page.evaluate(() => document.getElementById('bPause').click()); await page.evaluate(() => document.getElementById('pSet').click());
      await waitFor(page, () => document.querySelector('#settings .card').getAnimations().every(a => a.playState === 'finished'));
      for (const b of await page.locator('#themeSeg button').all()) { const bb = await b.boundingBox(); ok(bb.height >= 44 && bb.width >= 44, 'theme ' + bb.width + 'x' + bb.height); }
      await page.evaluate(() => document.getElementById('setOk').click());
    });
    await t('daily streak and history appear in stats', async () => {
      const k = d => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(), a = new Date(), b = new Date(); b.setDate(b.getDate() - 1);
      const daily = {}; daily[k(a)] = 300; daily[k(b)] = 400;
      await setup(page, { stats: { solved: 0, time: 0, best: {}, master: 0, daily } });
      await page.evaluate(() => document.getElementById('tStats').click());
      ok((await page.textContent('#stStreak')).trim() === '2 天', 'streak ' + await page.textContent('#stStreak'));
      ok((await page.locator('#stHist b').count()) === 2, 'history');
      await page.evaluate(() => document.getElementById('iOk').click());
    });
    await t('L20 intro card draws the block-sum example board with a dashed frame', async () => {
      await setup(page, { unlockAll: true });
      await page.evaluate(() => document.getElementById('tSelect').click()); await page.evaluate(() => document.querySelector('.lt[data-n="20"]').click());
      await waitFor(page, () => !document.getElementById('info').classList.contains('hidden'));
      ok(await page.locator('#iBody .mini.blk .box').count() === 1 && await page.locator('#iBody .mini .tg').count() === 1, 'mini');
    });
    await ctx.close();

    console.log('Browser 375x500 (lobby) and 360x640');
    ({ ctx, page, cdp } = await open(375, 500));
    await t('375x500: compact two-row pad, combo panel folded, L100 cells >= 24 px and started zoomed in, keys >= 44 px', async () => {
      await setup(page, { unlockAll: true });
      await startLv(page, 100);
      const s = await st(page); ok(s.compact && !s.panel, 'compact ' + s.compact + ' panel ' + s.panel); ok(s.cs >= 24, 'cs ' + s.cs); ok(s.zoom >= 1.6, 'zoom ' + s.zoom);
      const boxes = []; for (const b of await page.locator('.k, .tb').all()) boxes.push(await b.boundingBox());
      for (const b of boxes) ok(b.width >= 44 && b.height >= 44 && b.y + b.height <= 500 && b.x >= 0 && b.x + b.width <= 375, 'key ' + JSON.stringify(b));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'overlap'); }
      await tap(cdp, ...(await center(page, '#bCombo'))); await waitFor(page, () => window.__game.state().panel);
      await tap(cdp, ...(await center(page, '#bCombo'))); await waitFor(page, () => !window.__game.state().panel);
    });
    await ctx.close();
    ({ ctx, page, cdp } = await open(360, 640));
    await t('360x640: L100 starts zoomed; after the player zooms out the next big level starts unzoomed', async () => {
      await setup(page, { unlockAll: true });
      await startLv(page, 100); ok((await st(page)).zoom >= 1.6, 'zoom ' + (await st(page)).zoom);
      await tap(cdp, ...(await center(page, '#bZoom'))); await waitFor(page, () => window.__game.state().zoom === 1);
      await page.evaluate(() => document.getElementById('bPause').click()); await page.evaluate(() => document.getElementById('pSelect').click());
      await page.evaluate(() => document.querySelector('.lt[data-n="99"]').click());
      await waitFor(page, () => { const s = window.__game.state(); return s && s.level === 99; });
      ok((await st(page)).zoom === 1, 'zoom after opt-out ' + (await st(page)).zoom);
    });
    await ctx.close();
    await t('no page or console errors', () => { ok(!errors.length, errors.join(' | ')); });
  } finally { await br.close(); }
  done(T0);
})();
function done(T0) { console.log(((Date.now() - T0) / 1000).toFixed(1) + 's'); console.log(fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'all ' + pass + ' tests passed'); process.exitCode = fail ? 1 : 0; }
