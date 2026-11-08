// Regression tests for 極地探冰 (minesweeper): core checks in Node, then the page in Chromium with real CDP touch.
// Each block maps to a release-review finding (qa/release/minesweeper/score.json, 2026-11-08).
// Usage: node tests.js   (about 40-70 s; waits on conditions, no timing-based assertions)
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), URL = 'file://' + APP;
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {msDecode, msSolve, msGenDaily, msDailyGen, msTarget};')();
const LEVELS = new Function(html.match(/var LEVELS = \[[\s\S]*?\];/)[0] + '\nreturn LEVELS;')();
const TGT = JSON.parse(html.match(/var TGT = (\[[^\]]*\]);/)[1]);
let pass = 0, fail = 0;
async function t(name, fn) { const t1 = Date.now(); try { await fn(); pass++; console.log('  ok  ', name, '(' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)'); } catch (e) { fail++; console.log('FAIL  ', name, '-', String(e.message).split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const T0 = Date.now();
  console.log('Core');
  await t('3-star targets follow the reasoning each level needs (not just safe-cell count)', () => {
    ok(TGT.length === 100, 'TGT length');
    for (let n = 1; n <= 100; n++) {
      const R = C.msSolve(C.msDecode(LEVELS[n - 1].split('|')[0]));
      ok(C.msTarget(R.steps) === TGT[n - 1], 'L' + n + ' baked target ' + TGT[n - 1] + ' != ' + C.msTarget(R.steps));
    }
    ok(TGT[0] <= 35 && TGT[49] > 120 && TGT[99] > 300, 'L1 ' + TGT[0] + ' L50 ' + TGT[49] + ' L100 ' + TGT[99]);
  });
  await t('daily board: deterministic per date, different between dates, always solvable without guessing', () => {
    const a = C.msGenDaily(20261108), b = C.msGenDaily(20261108), c = C.msGenDaily(20261109);
    ok(a.mine.join('') === b.mine.join(''), 'same seed same board');
    ok(a.mine.join('') !== c.mine.join(''), 'next day differs');
    for (let d = 0; d < 12; d++) {
      const L = C.msGenDaily(20270101 + d * 37), R = C.msSolve(L);
      ok(L && R.solved && L.cnt8[L.start] === 0 && !L.mine[L.start], 'seed ' + d);
      ok(L.W === 11 && L.H === 14 && L.total === 30, 'size');
    }
  });
  await t('daily board is built in small steps (no long main-thread stall): every step() stays short', () => {
    let worst = 0;
    for (let d = 0; d < 8; d++) { const g = C.msDailyGen(20280301 + d * 11); let L; do { const t0 = process.hrtime.bigint(); L = g.step(); worst = Math.max(worst, Number(process.hrtime.bigint() - t0) / 1e6); } while (L === undefined); ok(L, 'seed ' + d); }
    ok(worst < 60, 'slowest step ' + worst.toFixed(1) + ' ms');
  });

  console.log('Page');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(w, h) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    // a navigation to ?reset starts from empty storage (one load instead of reload + clear + reload)
    await page.addInitScript(() => { if (location.search.indexOf('?reset') === 0) { try { localStorage.clear(); } catch (e) {} } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(URL);
    const cdp = await ctx.newCDPSession(page);
    const P = { ctx, page, cdp, w, h };
    await waitFor(P, () => !document.getElementById('title').classList.contains('hidden'));
    return P;
  }
  // ---- input helpers (explicit timestamps keep the human timing exact on a loaded machine) ----
  const ts = () => Date.now() / 1000;
  const touch = (P, type, pts, at) => P.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: at || ts() });
  async function tap(P, x, y, hold = 70) {
    const t0 = ts(); await touch(P, 'touchStart', [{ x, y, id: 1 }], t0); await sleep(hold);
    await touch(P, 'touchEnd', [{ x, y, id: 1 }], t0 + hold / 1000);
  }
  async function tapDrift(P, x, y, dx, dy, hold = 70) {
    const t0 = ts(); await touch(P, 'touchStart', [{ x, y, id: 1 }], t0); await sleep(hold / 2);
    await touch(P, 'touchMove', [{ x: x + dx, y: y + dy, id: 1 }], t0 + hold / 2000); await sleep(hold / 2);
    await touch(P, 'touchEnd', [{ x: x + dx, y: y + dy, id: 1 }], t0 + hold / 1000);
  }
  // second finger taps while finger 1 rests at rest {x,y}; touchEnd lists only the point it releases
  async function tapWithRest(P, rest, x, y, hold = 70, keep) {
    const r = { x: rest.x, y: rest.y, id: 1 };
    if (!keep) { await touch(P, 'touchStart', [r]); await sleep(120); }
    const t0 = ts(); await touch(P, 'touchStart', [r, { x, y, id: 2 }], t0); await sleep(hold);
    await touch(P, 'touchEnd', [{ x, y, id: 2 }], t0 + hold / 1000);
    if (!keep) { await sleep(60); await touch(P, 'touchEnd', [r]); }
  }
  async function waitFor(P, fn, arg, ms = 10000) {
    const end = Date.now() + ms;
    for (;;) { if (await P.page.evaluate(fn, arg)) return; if (Date.now() > end) throw new Error('timeout waiting for ' + String(fn).slice(0, 90)); await sleep(40); }
  }
  const G = (P, fn, arg) => P.page.evaluate(fn, arg);
  const S = P => G(P, () => window.__game.state());
  const vis = (P, id) => G(P, id => !document.getElementById(id).classList.contains('hidden') && !document.getElementById(id).closest('.hidden'), id);
  async function center(P, sel) { const b = await P.page.locator(sel).first().boundingBox(); ok(b, 'no box for ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
  async function press(P, sel, style = 'tap') {
    const c = await center(P, sel);
    if (style === 'finger') await tapWithRest(P, { x: 6, y: P.h * 0.45 }, c.x, c.y);
    else await tap(P, c.x, c.y, style === 'hold600' ? 600 : style === 'hold1000' ? 1000 : 70);
  }
  async function cellXY(P, c) { return G(P, c => window.__game.cell(c), c); }
  // wait two frames first so a heavy overlay-closing frame cannot stretch a 70 ms tap into a long press
  const settle = P => G(P, () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  async function tapCell(P, c, hold) { await settle(P); const p = await cellXY(P, c); await tap(P, p.x, p.y, hold); }
  // steady: the condition holds now and still holds a moment later (catches a trailing ghost click acting late)
  async function steady(P, fn, arg) { await waitFor(P, fn, arg); await sleep(150); ok(await G(P, fn, arg), 'state changed after the tap: ' + String(fn).slice(0, 80)); }
  let nav = 0;
  const titleUp = P => waitFor(P, () => !document.getElementById('title').classList.contains('hidden'));
  async function reset(P) { await P.page.goto(URL + '?reset' + (++nav)); await titleUp(P); }
  async function reload(P) { await P.page.goto(URL + '?k' + (++nav)); await titleUp(P); } // keeps storage
  async function gotoLevel(P, n) {
    if (!(await vis(P, 'title'))) await reload(P);
    await press(P, '#tSelect'); await waitFor(P, () => window.__game.state().status === 'select');
    if ((await P.page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await press(P, '#unlockSw'); await waitFor(P, () => document.getElementById('unlockSw').getAttribute('aria-checked') === 'true'); }
    await G(P, n => { const b = document.querySelector('.lt[data-n="' + n + '"]'); const g = document.getElementById('grid'); g.scrollTop = b.offsetTop - g.clientHeight / 2; }, n);
    await sleep(150);
    await press(P, '.lt[data-n="' + n + '"]');
    await waitFor(P, () => ['play', 'intro', 'paused'].includes(window.__game.state().status));
    if (await vis(P, 'intro')) { await press(P, '#iOk'); await waitFor(P, () => window.__game.state().status === 'play'); }
    if ((await S(P)).status === 'paused') { // an earlier test left a saved game here: start over through the UI
      await press(P, '#pRestart'); await sleep(150);
      if (await vis(P, 'confirm')) await press(P, '#cYes');
      await waitFor(P, () => window.__game.state().status === 'play' && !window.__game.state().started);
    }
  }
  async function startCell(P) { const s0 = await G(P, () => window.__game.nextMoves()[0].c); await tapCell(P, s0); await waitFor(P, () => window.__game.state().started); }
  async function safeMove(P) { const r = await coveredCells(P, 1, false); ok(r.length, 'no covered safe cell'); return r[0]; }
  async function coveredCells(P, n, wantMine) {
    return G(P, a => { const g = window.__game, v = g.view(), r = []; for (let c = 0; c < 600 && r.length < a.n; c++) { let k; try { k = g.cell(c); } catch (e) { break; } if (k.open === 0 && !k.flag && k.inView && k.x > v.x + 12 && k.x < v.x + v.w - 12 && k.y > v.y + 12 && k.y < v.y + v.h - 12 && (a.m == null || !!g.mine(c) === a.m)) r.push(c); } return r; }, { n, m: wantMine });
  }

  const A = await open(390, 844);

  // ---- [severe/mid] buttons: every tap style fires exactly once, and no trailing click lands on a new card ----
  // one level, every tap style: tap, a tap while another finger rests on the screen, 0.6 s and 1 s holds
  for (const style of ['tap', 'finger', 'hold600', 'hold1000']) {
    await t('buttons fire once on pointerup (' + style + '), no ghost click on the card that appears', async () => {
      if (style === 'tap') {
        await reset(A);
        await press(A, '#tPlay', style); await waitFor(A, () => window.__game.state().status === 'intro');
        await press(A, '#iOk', style); await steady(A, () => window.__game.state().status === 'play');
        await startCell(A);
      }
      await press(A, '#bMode', style); await steady(A, () => window.__game.state().mode === 1);
      await press(A, '#bMode', style); await steady(A, () => window.__game.state().mode === 0);
      if (style.startsWith('hold')) return; // slow presses: the mode button (and tiles, below) are enough
      await press(A, '#bPause', style); await steady(A, () => window.__game.state().status === 'paused' && !document.getElementById('pause').classList.contains('hidden'));
      if (style === 'tap') {
        const m = await safeMove(A); await press(A, '#pResume', style); await waitFor(A, () => window.__game.state().status === 'play');
        await tapCell(A, m); await waitFor(A, m => window.__game.cell(m).open === 1, m, 4000).catch(async e => { throw new Error('cell ' + m + ' ' + JSON.stringify(await cellXY(A, m)) + JSON.stringify(await S(A))); });
        await press(A, '#bPause', style); await waitFor(A, () => window.__game.state().status === 'paused');
        await press(A, '#pRestart', style); await steady(A, () => !document.getElementById('confirm').classList.contains('hidden'));
        await press(A, '#cNo', style); await steady(A, () => !document.getElementById('pause').classList.contains('hidden') && window.__game.state().opened > 0);
      }
      await press(A, '#pResume', style); await steady(A, () => window.__game.state().status === 'play');
    });
  }
  await t('level tiles, switches and theme buttons work on pointerup (tap and 0.6 s hold)', async () => {
    await reset(A);
    await press(A, '#tSelect'); await steady(A, () => window.__game.state().status === 'select');
    await press(A, '#unlockSw', 'hold600'); await steady(A, () => document.getElementById('unlockSw').getAttribute('aria-checked') === 'true');
    await press(A, '.lt[data-n="7"]', 'hold600'); await steady(A, () => window.__game.state().level === 7 && window.__game.state().status === 'play');
    await press(A, '#bPause'); await waitFor(A, () => window.__game.state().status === 'paused');
    await press(A, '#pSet'); await waitFor(A, () => !document.getElementById('settings').classList.contains('hidden'));
    await press(A, '#sTheme button[data-t="light"]'); await steady(A, () => document.documentElement.getAttribute('data-theme') === 'light');
    await press(A, '#sTheme button[data-t="dark"]', 'finger'); await steady(A, () => document.documentElement.getAttribute('data-theme') === 'dark');
    await press(A, '#setOk'); await steady(A, () => !document.getElementById('pause').classList.contains('hidden'));
  });

  // ---- [severe] tap slop: a tap that wobbles a few px still counts ----
  // L8: board fits the screen and the first tap leaves 54 covered safe cells for the next four tests
  await t('L8 (board fits): taps that drift 5/8/12/20 px all register; a 45 px swipe does nothing', async () => {
    await reset(A); await gotoLevel(A, 8); await startCell(A);
    ok(!(await G(A, () => window.__game.canPan())), 'L8 should fit');
    await press(A, '#bMode'); await waitFor(A, () => window.__game.state().mode === 1);
    const cells = await coveredCells(A, 5, false); // safe cells only, so crevasses stay for the later tests
    const drifts = [5, 8, 12, 20];
    for (let i = 0; i < drifts.length; i++) {
      const p = await cellXY(A, cells[i]);
      await tapDrift(A, p.x, p.y, drifts[i] * 0.6, drifts[i] * 0.8);
      await waitFor(A, c => window.__game.cell(c).flag === 1, cells[i], 3000).catch(() => { throw new Error('drift ' + drifts[i] + ' px dropped'); });
    }
    const p = await cellXY(A, cells[4]); await tapDrift(A, p.x, p.y, 27, 36); await sleep(300);
    ok((await cellXY(A, cells[4])).flag === 0, 'swipe should not flag');
  });
  // ---- [mid] another finger already on the canvas ----
  await t('finger resting on the canvas (off-board and on a cell): second-finger taps register; a real pinch still zooms', async () => {
    // continues on the L8 board of the previous test (flag mode)
    const v = await G(A, () => window.__game.view());
    const cells = await coveredCells(A, 6, false);
    const rest = { x: 12, y: v.y + v.h - 12 };
    await touch(A, 'touchStart', [{ x: rest.x, y: rest.y, id: 1 }]); await sleep(450);
    for (let i = 0; i < 3; i++) { const p = await cellXY(A, cells[i]); await tapWithRest(A, rest, p.x, p.y, 70, true); await waitFor(A, c => window.__game.cell(c).flag === 1, cells[i], 3000); }
    await touch(A, 'touchEnd', [{ x: rest.x, y: rest.y, id: 1 }]); await sleep(100);
    const r2 = await cellXY(A, cells[5]); const restCell = { x: r2.x, y: r2.y };
    await touch(A, 'touchStart', [{ x: restCell.x, y: restCell.y, id: 1 }]); await sleep(120);
    const p3 = await cellXY(A, cells[3]); await tapWithRest(A, restCell, p3.x, p3.y, 70, true);
    await waitFor(A, c => window.__game.cell(c).flag === 1, cells[3], 3000);
    await touch(A, 'touchEnd', [{ x: restCell.x, y: restCell.y, id: 1 }]); await sleep(100);
    const before = (await S(A)).cs, flags0 = (await S(A)).flags, cx = A.w / 2, cy = v.y + v.h / 2;
    const t0 = ts(); await touch(A, 'touchStart', [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }], t0);
    for (let i = 1; i <= 6; i++) { await sleep(20); await touch(A, 'touchMove', [{ x: cx - 40 - 10 * i, y: cy, id: 1 }, { x: cx + 40 + 10 * i, y: cy, id: 2 }], t0 + i * 0.03); }
    await touch(A, 'touchEnd', [{ x: cx - 100, y: cy, id: 1 }, { x: cx + 100, y: cy, id: 2 }], t0 + 0.3); await sleep(200);
    const s = await S(A); ok(s.cs > before * 1.3, 'pinch zoom ' + before + ' -> ' + s.cs); ok(s.flags === flags0, 'pinch flagged a cell');
    const t1 = ts(); await touch(A, 'touchStart', [{ x: cx - 100, y: cy, id: 1 }, { x: cx + 100, y: cy, id: 2 }], t1);
    for (let i = 1; i <= 6; i++) { await sleep(20); await touch(A, 'touchMove', [{ x: cx - 100 + 10 * i, y: cy, id: 1 }, { x: cx + 100 - 10 * i, y: cy, id: 2 }], t1 + i * 0.03); }
    await touch(A, 'touchEnd', [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }], t1 + 0.3); await sleep(200);
    const s2 = await S(A); ok(s2.cs < s.cs * 0.8 && s2.flags === flags0, 'pinch back ' + s.cs + ' -> ' + s2.cs);
  });

  // ---- [minor] long press in flag mode never digs ----
  await t('flag mode: holding 0.6 s on a crevasse / 1 s on a safe cell flags it, never digs; dig mode: 0.6 s hold flags', async () => {
    const [m] = await coveredCells(A, 1, true), [sf, sf2] = await coveredCells(A, 2, false);
    await tapCell(A, m, 600); await waitFor(A, c => window.__game.cell(c).flag === 1, m);
    await tapCell(A, sf, 1000); await waitFor(A, c => window.__game.cell(c).flag === 1, sf);
    const s = await S(A); ok(s.status === 'play' && s.mistakes === 0 && s.guard === 0, JSON.stringify(s));
    ok((await cellXY(A, sf)).open === 0, 'safe cell was dug');
    await press(A, '#bMode'); await waitFor(A, () => window.__game.state().mode === 0);
    await tapCell(A, sf2, 600); await waitFor(A, c => window.__game.cell(c).flag === 1 && window.__game.cell(c).open === 0, sf2);
  });

  // ---- [minor] beginner protection ----
  await t('L1-L10 beginner protection: hitting a crevasse flags it (no mistake); from L11 it breaks the ice', async () => {
    const [m] = await coveredCells(A, 1, true); // same L8 board, now in dig mode
    await tapCell(A, m); await waitFor(A, c => window.__game.cell(c).flag === 1, m);
    let s = await S(A); ok(s.status === 'play' && s.guard === 1 && s.mistakes === 0, JSON.stringify(s));
    await gotoLevel(A, 11); await startCell(A);
    const [m2] = await coveredCells(A, 1, true);
    await tapCell(A, m2); await waitFor(A, () => window.__game.state().status === 'lost');
    await waitFor(A, () => !document.getElementById('fail').classList.contains('hidden'));
    await press(A, '#fSelect'); await waitFor(A, () => window.__game.state().status === 'select');
  });

  // ---- [round 2 veto] overlapping taps from two thumbs: each finger is its own press ----
  // fingers alternate ids 1/2 at about 8 taps/s; each touch starts 40 ms before the previous one lifts
  async function overlapTaps(P, cells) {
    let prev = null;
    for (let k = 0; k < cells.length; k++) {
      const p = await cellXY(P, cells[k]), id = k % 2 + 1, me = { x: p.x, y: p.y, id };
      await touch(P, 'touchStart', prev ? [prev, me] : [me]);
      if (prev) { await sleep(40); await touch(P, 'touchEnd', [prev]); }
      await sleep(prev ? 85 : 125); prev = me;
    }
    await sleep(40); await touch(P, 'touchEnd', [prev]);
  }
  await t('two thumbs, overlapping taps (8/s, 40 ms overlap): every tap flags its own cell (L12)', async () => {
    await gotoLevel(A, 12); await startCell(A);
    await press(A, '#bMode'); await waitFor(A, () => window.__game.state().mode === 1);
    const cells = (await coveredCells(A, 40, false)).filter((_, i) => i % 3 === 0).slice(0, 12);
    ok(cells.length >= 10, 'cells ' + cells.length);
    await overlapTaps(A, cells);
    await waitFor(A, a => a.every(c => window.__game.cell(c).flag === 1), cells, 4000).catch(async () => {
      throw new Error('flagged ' + (await G(A, a => a.map(c => window.__game.cell(c).flag).join(''), cells)));
    });
    ok((await S(A)).flags === cells.length, 'extra flags ' + (await S(A)).flags);
  });
  await t('finger A held 150 ms on a cell, finger B taps a safe cell: B digs (not flags), A unaffected until its own long press', async () => {
    await press(A, '#bMode'); await waitFor(A, () => window.__game.state().mode === 0);
    for (const delay of [100, 200]) {
      const [a, b] = await coveredCells(A, 2, false), pa = await cellXY(A, a), pb = await cellXY(A, b);
      const A1 = { x: pa.x, y: pa.y, id: 1 }, B2 = { x: pb.x, y: pb.y, id: 2 };
      await touch(A, 'touchStart', [A1]); await sleep(delay);
      await touch(A, 'touchStart', [A1, B2]); await sleep(70); await touch(A, 'touchEnd', [B2]);
      await waitFor(A, b => window.__game.cell(b).open === 1, b, 3000).catch(async () => { throw new Error('delay ' + delay + ' B ' + JSON.stringify(await cellXY(A, b))); });
      ok((await cellXY(A, b)).flag === 0, 'B flagged');
      await touch(A, 'touchEnd', [A1]); await sleep(100);
      ok((await cellXY(A, a)).open === 1 || (await cellXY(A, a)).flag === 1, 'A tap/long press lost');
    }
  });
  await t('a tap on the outer edge of an opened number that cannot act goes to the covered neighbour (clumsy-finger snap)', async () => {
    const r = await G(A, () => {
      const g = window.__game, W = g.size().W;
      for (let c = 0; c < g.size().N; c++) { const k = g.cell(c); if (k.open !== 1 || !k.inView || g.flagsAround(c) === g.count(c)) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c % W + dx, y = Math.floor(c / W) + dy; if (x < 0 || y < 0 || x >= W) continue;
          const n = y * W + x, m = g.cell(n); if (m.open === 0 && !m.flag && m.inView && !g.mine(n)) return { c, n, x: k.x + dx * k.cs * 0.4, y: k.y + dy * k.cs * 0.4 }; } }
      return null; });
    ok(r, 'no opened number next to a covered safe cell');
    await settle(A); await tap(A, r.x, r.y);
    await waitFor(A, n => window.__game.cell(n).open === 1, r.n, 3000);
  });
  await t('L50 (board pans): 6 px drift taps without moving the board; quick 11 px wobble taps and snaps back; a drag pans', async () => {
    await gotoLevel(A, 50); await startCell(A);
    ok(await G(A, () => window.__game.canPan()), 'L50 should pan');
    ok((await S(A)).cs >= 36, 'cells at least 36 px, got ' + (await S(A)).cs);
    await press(A, '#bMode'); await waitFor(A, () => window.__game.state().mode === 1);
    const cells = await coveredCells(A, 3);
    let p = await cellXY(A, cells[0]); await tapDrift(A, p.x, p.y, 3.6, 4.8);
    await waitFor(A, c => window.__game.cell(c).flag === 1, cells[0], 3000);
    let q = await cellXY(A, cells[0]); ok(Math.hypot(q.x - p.x, q.y - p.y) < 1, 'board moved on a tap');
    p = await cellXY(A, cells[1]); await tapDrift(A, p.x, p.y, 6.6, 8.8, 120);
    await waitFor(A, c => window.__game.cell(c).flag === 1, cells[1], 3000);
    q = await cellXY(A, cells[1]); ok(Math.hypot(q.x - p.x, q.y - p.y) < 1, 'board did not snap back');
    p = await cellXY(A, cells[2]);
    const t0 = ts(); await touch(A, 'touchStart', [{ x: p.x, y: p.y, id: 1 }], t0);
    for (let i = 1; i <= 6; i++) { await sleep(20); await touch(A, 'touchMove', [{ x: p.x + 10 * i, y: p.y, id: 1 }], t0 + i * 0.03); }
    await touch(A, 'touchEnd', [{ x: p.x + 60, y: p.y, id: 1 }], t0 + 0.4); await sleep(200);
    q = await cellXY(A, cells[2]); ok(q.flag === 0 && Math.abs(q.x - p.x) > 20, 'drag should pan, not flag');
    const oc = (await coveredCells(A, 30, false)).filter((_, i) => i % 3 === 0).slice(0, 8);
    await overlapTaps(A, oc);
    await waitFor(A, a => a.every(c => window.__game.cell(c).flag === 1), oc, 4000).catch(async () => {
      throw new Error('overlap on L50 flagged ' + (await G(A, a => a.map(c => window.__game.cell(c).flag).join(''), oc)));
    });
  });

  // ---- [minor] mid-level save + [minor] restart confirm + target + render freeze ----
  await t('half-played level survives a reload: title offers 繼續第 N 關 and restores the board paused', async () => {
    await reset(A); await gotoLevel(A, 3); await startCell(A);
    const m = await safeMove(A); await tapCell(A, m); await waitFor(A, m => window.__game.cell(m).open === 1, m);
    const [f] = await coveredCells(A, 1, true); await tapCell(A, f, 600); await waitFor(A, c => window.__game.cell(c).flag === 1, f);
    const s0 = await S(A);
    await reload(A);
    ok((await A.page.textContent('#tPlay')) === '繼續第 3 關', 'title button: ' + await A.page.textContent('#tPlay'));
    await press(A, '#tPlay'); await waitFor(A, () => window.__game.state().status === 'paused');
    const s1 = await S(A); ok(s1.level === 3 && s1.opened === s0.opened && s1.flags === s0.flags && s1.started, JSON.stringify([s0, s1]));
    ok((await A.page.textContent('#pInfo')).includes('接續'), 'pause card says resumed');
    await press(A, '#pResume'); await waitFor(A, () => window.__game.state().status === 'play');
  });
  await t('restart pill asks first when there is progress; 取消 keeps the board, 重開 clears it', async () => {
    const o = (await S(A)).opened;
    await press(A, '#bRestart'); await steady(A, () => !document.getElementById('confirm').classList.contains('hidden') && window.__game.state().status === 'paused');
    await press(A, '#cNo'); await steady(A, o => window.__game.state().status === 'play' && window.__game.state().opened === o, o);
    await press(A, '#bRestart'); await waitFor(A, () => !document.getElementById('confirm').classList.contains('hidden'));
    await press(A, '#cYes'); await steady(A, () => window.__game.state().status === 'play' && window.__game.state().opened === 0);
    ok(!(await G(A, () => (JSON.parse(localStorage.getItem('minesweeper.saves') || '{}'))['3'])), 'save cleared on restart');
  });
  await t('win: target from reasoning steps (L3 0:37), save cleared, canvas stops redrawing behind the card', async () => {
    await startCell(A);
    const last = await G(A, () => window.__game.nearWin()); await tapCell(A, last);
    await waitFor(A, () => window.__game.state().status === 'won');
    const f0 = await G(A, () => window.__game.frames()); await sleep(400);
    ok((await G(A, () => window.__game.frames())) > f0, 'animating during the win effect');
    await waitFor(A, () => !document.getElementById('win').classList.contains('hidden'));
    ok((await A.page.textContent('#wTarget')) === '0:37', 'target ' + await A.page.textContent('#wTarget'));
    await sleep(200); const f1 = await G(A, () => window.__game.frames()); await sleep(600);
    ok((await G(A, () => window.__game.frames())) - f1 <= 1, 'still redrawing behind the win card');
    ok(!(await G(A, () => (JSON.parse(localStorage.getItem('minesweeper.saves') || '{}'))['3'])), 'save cleared on win');
    ok((await G(A, () => JSON.parse(localStorage.getItem('minesweeper.progress'))['3'].s)) >= 1, 'progress saved');
  });
  await t('last level win card: one way back (no duplicate level-select button)', async () => {
    await press(A, '#wSelect'); await waitFor(A, () => window.__game.state().status === 'select');
    await press(A, '#sBack'); await waitFor(A, () => window.__game.state().status === 'title');
    await gotoLevel(A, 100); await startCell(A);
    const last = await G(A, () => window.__game.nearWin()); await tapCell(A, last);
    await waitFor(A, () => !document.getElementById('win').classList.contains('hidden'));
    ok(await vis(A, 'wNext') && !(await vis(A, 'wSelect')), 'wSelect should be hidden on L100');
    ok((await A.page.textContent('#wNext')) === '回到關卡選擇');
  });
  await t('daily board: opens from the title, plays, resumes after reload', async () => {
    await reset(A);
    await press(A, '#tDaily'); await waitFor(A, () => window.__game.state().status === 'play' && window.__game.state().level === 0);
    ok((await A.page.textContent('#hLevel')).startsWith('每日'), 'hud label');
    await startCell(A);
    await reload(A);
    ok((await A.page.textContent('#tPlay')) === '繼續每日冰原', await A.page.textContent('#tPlay'));
    await press(A, '#tPlay'); await waitFor(A, () => window.__game.state().status === 'paused' && window.__game.state().level === 0);
    await press(A, '#pResume'); await waitFor(A, () => window.__game.state().status === 'play');
    const last = await G(A, () => window.__game.nearWin()); await tapCell(A, last);
    await waitFor(A, () => !document.getElementById('win').classList.contains('hidden'));
    ok((await A.page.textContent('#wNext')) === '回到標題' && await vis(A, 'wSelect'), 'daily win buttons');
    ok((await A.page.textContent('#wMsg')).includes('連續 1 天'), 'streak in win message');
    ok((await A.page.textContent('#wBadges')).includes('每日探勘'), 'daily achievement');
    await press(A, '#wNext'); await waitFor(A, () => window.__game.state().status === 'title');
    ok((await A.page.textContent('#tDaily')).includes('★'), 'title shows today\'s stars');
  });
  await A.ctx.close();

  // ---- [detail] small screens: short start toast, cards fit without scrolling (one page, resized) ----
  const B = await open(360, 640);
  await t('360x640: level-start toast fits on one line', async () => {
    await gotoLevel(B, 50);
    await waitFor(B, () => !document.getElementById('toast').classList.contains('hidden'));
    const r = await G(B, () => { const t = document.getElementById('toast'); return { h: t.getBoundingClientRect().height, txt: t.textContent }; });
    ok(r.h < 44 && !r.txt.includes('道'), JSON.stringify(r));
  });
  await t('844x390 and 375x500: intro card and win card buttons are all on screen without scrolling', async () => {
    const sizes = [[844, 390], [375, 500]];
    const allOn = async (ids, ov) => {
      for (const [w, h] of sizes) {
        await B.page.setViewportSize({ width: w, height: h }); B.w = w; B.h = h; await sleep(450); // resize + pop animation
        for (const id of ids) {
          const b = await B.page.locator('#' + id).boundingBox();
          ok(b && b.y >= 0 && b.y + b.height <= h + 0.5 && b.x >= 0 && b.x + b.width <= w + 0.5, w + 'x' + h + ' ' + id + ' ' + JSON.stringify(b));
        }
        ok(await G(B, ov => document.getElementById(ov).scrollHeight <= document.getElementById(ov).clientHeight + 1, ov), w + 'x' + h + ' ' + ov + ' scrolls');
      }
    };
    await reset(B);
    await press(B, '#tPlay'); await waitFor(B, () => window.__game.state().status === 'intro');
    await allOn(['iOk'], 'intro');
    await press(B, '#iOk'); await waitFor(B, () => window.__game.state().status === 'play');
    await startCell(B);
    const last = await G(B, () => window.__game.nearWin()); await tapCell(B, last);
    await waitFor(B, () => !document.getElementById('win').classList.contains('hidden'));
    await allOn(['wNext', 'wRetry', 'wShare', 'wSelect'], 'win');
  });
  await B.ctx.close();
  await browser.close();
  await t('no page or console errors', () => { ok(!errors.length, errors.slice(0, 3).join(' | ')); });
  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + '/' + (pass + fail) + ' minesweeper tests in ' + Math.round((Date.now() - T0) / 1000) + ' s');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e); process.exit(1); });
