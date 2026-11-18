// Regression tests for 十字繡坊 (nonogram): one check per release-review toFix item (2026-11-08), in mobile Chromium
// with real CDP touch. Usage: node tests.js
// Long-press-to-cross is switched off except in its own test: on a loaded machine CDP can stretch a tap past 0.55 s.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message.split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(w = 390, h = 844, init = '') {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => r.request().url().startsWith('http://ng.test/') ? r.fulfill({ body: fs.readFileSync(APP, 'utf8'), contentType: 'text/html' }) : r.abort());
    await ctx.addInitScript(`try{if(!localStorage.getItem('nonogram.helped')){localStorage.setItem('nonogram.helped','true');localStorage.setItem('nonogram.unlockAll','true');localStorage.setItem('nonogram.settings','{"sound":false,"lp":false}');}${init}}catch(e){}`);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h}: ${e}`)); page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h}: ${m.text()}`); });
    await page.goto('http://ng.test/');
    await page.waitForFunction(() => window.__game && document.getElementById('tPlay').getBoundingClientRect().height > 40);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ev = (f, a) => page.evaluate(f, a);
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 15000, polling: 30 });
    const ctr = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
    const fires = () => ev(() => window.__game.fires());
    const st = () => ev(() => window.__game.state());
    const cell = i => ev(i => { const v = __game.view(), s = __game.state(), x = i % s.w, y = (i - x) / s.w; return { x: Math.round(v.ox + (x + 0.5) * v.c), y: Math.round(v.oy + (y + 0.5) * v.c) }; }, i);
    const tapAt = async (p, hold = 40, id = 5) => { await T('touchStart', [{ ...p, id }]); await sleep(hold); await T('touchEnd', [{ ...p, id }]); await sleep(30); };
    const tap = async (sel, hold = 50) => tapAt(await ctr(sel), hold, 9);
    const level = async n => { await ev(n => { document.getElementById('tSelect').click(); document.querySelector('.lt[data-n="' + n + '"]').click(); }, n); await until(n => __game.state().level === n && __game.state().status === 'play', n); await sleep(80); };
    // solve the board with real taps, one per solution cell (multi-colour levels not used here)
    const solve = async (skipLast) => { const sol = await ev(() => __game.solution()); const idx = sol.map((v, i) => v ? i : -1).filter(i => i >= 0); if (skipLast) idx.pop();
      for (const i of idx) { const b = await ev(() => __game.board()); if (b[i] > 0) continue; await tapAt(await cell(i)); } return idx; };
    return { ctx, page, T, ev, until, ctr, fires, st, cell, tapAt, tap, level, solve };
  }

  console.log('1 穩定：橫式過關');
  for (const [w, h] of [[844, 390], [667, 375]]) {
    await t(`${w}x${h} landscape win: no page/console errors, hoop on the left, result card on the right`, async () => {
      const P = await open(w, h); const e0 = errors.length;
      await P.level(1); await P.solve();
      await P.until(() => __game.state().hoop && !document.getElementById('win').classList.contains('hidden'));
      await P.until(() => __game.dbg().hoopCached, null, 5000); await sleep(400);
      const card = await P.ev(() => document.querySelector('#win .card').getBoundingClientRect().toJSON());
      ok(errors.length === e0, errors.slice(e0).join(' | ').slice(0, 200));
      ok(card.left > w * 0.4 && card.right <= w && card.top >= 0 && card.bottom <= h, 'card ' + JSON.stringify(card));
      await P.ctx.close();
    });
  }

  console.log('2 操控');
  const P = await open();
  await t('second finger on buttons (rest finger on the clue column): undo / cross / sound / zoom fire exactly once at 60 ms, 0.6 s, 1 s', async () => {
    await P.level(46);
    const rest = { x: 20, y: 300, id: 0 }, bad = [];
    for (const hold of [60, 600, 1000]) for (const sel of ['#bUndo', '#mCross', '#bSound', '#bZoom']) {
      if (sel === '#bUndo') { await P.ev(() => document.getElementById('mFill').click()); const sol = await P.ev(() => __game.solution()); await P.tapAt(await P.cell(sol.findIndex(v => v))); await sleep(50); }
      const c = await P.ctr(sel), f0 = await P.fires();
      await P.T('touchStart', [rest]); await sleep(80);
      await P.T('touchStart', [rest, { ...c, id: 1 }]); await sleep(hold); await P.T('touchEnd', [{ ...c, id: 1 }]); await sleep(80);
      await P.T('touchEnd', [rest]); await sleep(60);
      const f1 = await P.fires(), id = sel.slice(1), n = (f1[id] || 0) - (f0[id] || 0);
      if (n !== 1) bad.push(`${hold}/${sel}: ${n}`);
    }
    ok(!bad.length, bad.join('; '));
    await P.ev(() => document.getElementById('mFill').click());
  });
  await t('8/s alternation cross/fill buttons with a finger resting on the board: 16 sent, 16 received, mode matches the last tap', async () => {
    const rest = { x: 20, y: 300, id: 0 }, a = await P.ctr('#mCross'), b = await P.ctr('#mFill'), f0 = await P.fires();
    await P.T('touchStart', [rest]); const t0 = Date.now();
    for (let k = 0; k < 16; k++) { const c = k % 2 ? b : a; await P.T('touchStart', [rest, { ...c, id: 1 }]); await sleep(35); await P.T('touchEnd', [{ ...c, id: 1 }]); await sleep(Math.max(0, 125 * (k + 1) - (Date.now() - t0))); }
    await P.T('touchEnd', [rest]); await sleep(80);
    const f1 = await P.fires(), n = (f1.mCross - (f0.mCross || 0)) + (f1.mFill - (f0.mFill || 0));
    ok(n === 16, 'received ' + n); ok(await P.ev(() => document.getElementById('mFill').classList.contains('on')), 'mode should be fill');
  });
  await t('keyboard activation still works (Enter on focused menu button opens pause)', async () => {
    await P.ev(() => document.getElementById('bMenu').focus()); await P.page.keyboard.press('Enter');
    await P.until(() => !document.getElementById('pause').classList.contains('hidden'), null, 3000);
    await P.ev(() => document.getElementById('pResume').click());
  });
  await t('long press: 0.4 s on a cell to stitch stitches it; 1 s shows a pending cross, judged only on release; a second finger cancels it', async () => {
    await P.level(26);
    const sol = await P.ev(() => __game.solution()), fills = sol.map((v, i) => v ? i : -1).filter(i => i >= 0);
    await P.ev(() => document.querySelector('#settings .tog[data-k="lp"]').click()); ok(await P.ev(() => JSON.parse(localStorage.getItem('nonogram.settings')).lp), 'lp on');
    for (let k = 0; k < 4; k++) { const e0 = (await P.st()).errors; const c0 = await P.cell(fills[0]), t0 = Date.now(); await P.T('touchStart', [{ ...c0, id: 3 }]); await sleep(400); await P.T('touchEnd', [{ ...c0, id: 3 }]); const dt = Date.now() - t0; await sleep(60);
      if (dt < 540) { ok((await P.st()).errors === e0, 'a 0.4 s hold must not cost a heart'); break; } await P.ev(i => { if (__game.board()[i]) { document.getElementById('bUndo').click(); } }, fills[0]); } // CDP was too slow: retry
    ok((await P.ev(() => __game.board()))[fills[0]] === 1, '0.4 s hold should stitch'); const h0 = (await P.st()).hearts;
    const c = await P.cell(fills[1]);
    await P.T('touchStart', [{ ...c, id: 3 }]); await sleep(900);
    ok((await P.ev(() => __game.dbg().lpPending)), 'pending cross after 0.9 s'); ok((await P.st()).hearts === h0, 'no heart lost while held');
    await P.T('touchStart', [{ ...c, id: 3 }, { x: c.x + 90, y: c.y + 90, id: 4 }]); await sleep(60);
    await P.T('touchEnd', [{ ...c, id: 3 }, { x: c.x + 90, y: c.y + 90, id: 4 }]); await sleep(80);
    ok((await P.ev(() => __game.board()))[fills[1]] === 0 && (await P.st()).hearts === h0, 'second finger cancels the long-press');
    await P.ev(() => document.querySelector('#settings .tog[data-k="lp"]').click());
    await P.tapAt(c, 1000); await sleep(60);
    ok((await P.ev(() => __game.board()))[fills[1]] === 1 && (await P.st()).hearts === h0, 'with long-press off a 1 s hold stitches');
  });
  await t('wrong guess only marks red: the cell is not turned into the answer, a heart is lost', async () => {
    const sol = await P.ev(() => __game.solution()), i = sol.findIndex((v, k) => !v && k > 0);
    const s0 = await P.st(); await P.tapAt(await P.cell(i)); await sleep(60);
    const s1 = await P.st(), b = await P.ev(() => __game.board());
    ok(b[i] === 0, 'cell became ' + b[i]); ok(s1.errors === s0.errors + 1 && s1.hearts === s0.hearts - 1, 'error/heart');
  });
  await t('hints: three hints point at three different cells with three different messages', async () => {
    await P.level(30); const msgs = [], cells = [];
    for (let k = 0; k < 3; k++) { const b0 = await P.ev(() => __game.board()); await P.ev(() => document.getElementById('bHint').click()); await sleep(60);
      msgs.push(await P.ev(() => document.getElementById('toast').textContent)); const b1 = await P.ev(() => __game.board()); cells.push(b1.findIndex((v, i) => v !== b0[i])); }
    ok(new Set(msgs).size === 3, msgs.join(' / ')); ok(new Set(cells).size === 3 && !cells.includes(-1), 'cells ' + cells);
  });
  await t('diagonal two-finger drag on L100 (fingers 80 px apart, (-60,-60)) moves the board (-60,-60) without zoom jitter', async () => {
    await P.level(100); const v0 = await P.ev(() => __game.view());
    let a = { x: 175, y: 520, id: 1 }, b = { x: 255, y: 520, id: 2 };
    await P.T('touchStart', [a]); await P.T('touchStart', [a, b]); await sleep(40);
    for (let k = 1; k <= 12; k++) { a = { ...a, x: 175 - 5 * k, y: 520 - 5 * k }; b = { ...b, x: 255 - 5 * k, y: 520 - 5 * k }; await P.T('touchMove', [a, b]); await sleep(20); }
    await sleep(60); await P.T('touchEnd', [a, b]); await sleep(60);
    const v1 = await P.ev(() => __game.view());
    ok(Math.abs(v1.ox - v0.ox + 60) < 3 && Math.abs(v1.oy - v0.oy + 60) < 3, `moved ${(v1.ox - v0.ox).toFixed(1)},${(v1.oy - v0.oy).toFixed(1)}`);
    ok(Math.abs(v1.z - v0.z) < 1e-6, 'zoom changed');
  });
  await t('default cell size: 15x15 and 20x20 open at >= 36 px (and zoom can reach 60 px)', async () => {
    for (const n of [66, 100]) { await P.level(n); const v = await P.ev(() => __game.view()), d = await P.ev(() => __game.dbg());
      ok(v.c >= 36, `L${n} ${v.c}`); ok(v.c / v.z * d.maxZ >= 59.9, `L${n} max ${v.c / v.z * d.maxZ}`); }
  });
  await t('hearts scale with board size: 5x5 3, 12x12 4, 15x15 4, 20x20 5 (HUD shows them)', async () => {
    for (const [n, want] of [[1, 3], [46, 4], [66, 4], [91, 5]]) { await P.level(n); await P.ev(() => document.getElementById('pRestart').click()); const s = await P.st(), shown = await P.ev(() => document.getElementById('hHearts').textContent.length);
      ok(s.hearts === want && shown === want, `L${n}: ${s.hearts}/${shown}`); }
  });
  await t('3-star reference time is 0.6 s per cell; after the win undo is disabled; a tap on the old 叉 spot 0.8 s and 1.4 s after the win hits nothing', async () => {
    await P.level(1); const x = await P.ctr('#mCross'), f0 = await P.fires();
    await P.solve(); const t0 = Date.now();
    await sleep(Math.max(0, 800 - (Date.now() - t0))); await P.tapAt(x, 40, 6);
    await sleep(Math.max(0, 1400 - (Date.now() - t0))); await P.tapAt(x, 40, 6);
    await P.until(() => !document.getElementById('win').classList.contains('hidden'));
    const f1 = await P.fires();
    ok(!(f1.wShare > (f0.wShare || 0)) && !(f1.wNext > (f0.wNext || 0)) && !(f1.wSelect > (f0.wSelect || 0)), 'result card button fired');
    ok(await P.ev(() => document.getElementById('wRef').textContent === '00:15'), 'ref ' + await P.ev(() => document.getElementById('wRef').textContent));
    ok(await P.ev(() => document.getElementById('bUndo').disabled), 'undo still enabled after win');
    await sleep(500); await P.tap('#wNext'); await P.until(() => __game.state().level === 2);
  });

  console.log('3/4 每日一繡、成就');
  await t('daily puzzle is a mirrored picture from the levels and solves by line logic alone', async () => {
    const d = await P.ev(() => __game.daily());
    ok(d.daily && d.src >= 26 && d.src <= 90 && d.lineSolvable && d.pic !== d.srcPic, JSON.stringify(d).slice(0, 160));
    await P.ev(() => { document.getElementById('bMenu').click(); document.getElementById('pHome').click(); document.getElementById('tDaily').click(); });
    await P.until(() => document.getElementById('hLv').textContent === '每日一繡');
  });
  await t('零失誤 counts each level once (L1 twice perfect -> 1)', async () => {
    const Q = await open();
    for (let k = 0; k < 2; k++) { await Q.level(1); await Q.solve(); try { await Q.until(() => __game.state().status === 'won'); } catch (e) { throw new Error('round ' + k + ' ' + JSON.stringify(await Q.st()) + ' ' + (await Q.ev(() => __game.board().join('') + '/' + __game.solution().join('')))); } }
    const s = await Q.ev(() => JSON.parse(localStorage.getItem('nonogram.stats')));
    ok(s.perfect === 1, 'perfect ' + s.perfect); await Q.ctx.close();
  });

  console.log('1/7 細節：復原、小地圖、版面');
  await t('undo survives a reload', async () => {
    await P.level(30); const sol = await P.ev(() => __game.solution()), i = sol.findIndex(v => v);
    await P.tapAt(await P.cell(i)); await sleep(700);
    await P.page.reload(); await P.page.waitForFunction(() => window.__game); await P.ev(() => document.getElementById('tPlay').click());
    await P.until(() => __game.state().level === 30); ok(!(await P.ev(() => document.getElementById('bUndo').disabled)), 'undo disabled after reload');
    await P.tap('#bUndo'); ok((await P.ev(() => __game.board()))[i] === 0, 'undo did not revert');
  });
  await t('HUD sound toggle: one tap mutes (settings saved), another unmutes', async () => {
    const s0 = await P.ev(() => JSON.parse(localStorage.getItem('nonogram.settings')).sound);
    await P.tap('#bSound'); const s1 = await P.ev(() => JSON.parse(localStorage.getItem('nonogram.settings')).sound);
    await P.tap('#bSound'); const s2 = await P.ev(() => JSON.parse(localStorage.getItem('nonogram.settings')).sound);
    ok(s1 === !s0 && s2 === s0, `${s0} ${s1} ${s2}`);
  });
  await t('multi-colour swatches carry a distinct texture per colour', async () => {
    await P.level(81); const bg = await P.ev(() => [...document.querySelectorAll('#palette .sw')].map(b => getComputedStyle(b).backgroundImage));
    ok(bg.length >= 2 && new Set(bg).size === bg.length, bg.join(' | ').slice(0, 160));
  });
  await P.ctx.close();
  await t('360x640 L100: minimap in the clue corner; tapping its bottom-right jumps the view there', async () => {
    const Q = await open(360, 640); await Q.level(100);
    const m = await Q.ev(() => __game.dbg().map); ok(m && m.s >= 2, 'no minimap');
    const v0 = await Q.ev(() => __game.view());
    await Q.tapAt({ x: Math.round(m.x + 19 * m.s), y: Math.round(m.y + 19 * m.s) }); await sleep(60);
    const v1 = await Q.ev(() => __game.view()); ok(v1.ox < v0.ox - 20 && v1.oy < v0.oy - 20, `view ${v0.ox},${v0.oy} -> ${v1.ox},${v1.oy}`);
    await Q.ctx.close();
  });
  await t('844x390: zoom is not capped at 3x (60 px reachable); swatches 44x44 on L81', async () => {
    const Q = await open(844, 390); await Q.level(100); const v = await Q.ev(() => __game.view()), d = await Q.ev(() => __game.dbg());
    ok(v.c / v.z * d.maxZ >= 59.9, 'max cell ' + v.c / v.z * d.maxZ);
    await Q.level(81); const r = await Q.ev(() => document.querySelector('#palette .sw').getBoundingClientRect().toJSON()); ok(r.width >= 44 && r.height >= 44, 'swatch ' + r.width);
    await Q.ctx.close();
  });
  await t('932x430 L60: the whole board fits (no rows cut off)', async () => {
    const Q = await open(932, 430); await Q.level(60); const v = await Q.ev(() => __game.view()), s = await Q.st();
    ok(v.oy + s.h * v.c <= v.ay1 + 0.5 && v.ox + s.w * v.c <= v.ax1 + 0.5, `bottom ${v.oy + s.h * v.c} > ${v.ay1}`);
    await Q.ctx.close();
  });

  ok(true);
  await t('no page or console errors in any run', async () => ok(!errors.length, errors.slice(0, 3).join(' | ')));
  await browser.close();
  console.log(`${fail ? 'FAIL' : 'PASS'}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack); process.exit(1); });
