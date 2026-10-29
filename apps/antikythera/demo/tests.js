// Regression tests for 天機齒輪 (run by qa/smoke/run.js): real headless Chromium, phone contexts, CDP touch input.
// One check per release-review finding (2026-10-25): no web fonts, 44 px buttons, crowded-peg taps, late-level time /
// move budgets, clock from load, zoom-back button after a pinch, half-built level survives a reload, undo,
// level notes readable, stars / best records, peg contrast, short hub frames, Greek title, fixed-gear levels;
// round 2: ghost click, load race, smooth solver budget, late mechanisms; round 3: post-win taps, 重置 confirm + gap,
// spare moves, dial-name overlap, whole level name.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
const URL0 = 'http://antikythera.test/';
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

async function open(browser, w, h, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(init || (() => {}));
  const page = await ctx.newPage(), errs = [], external = [];
  page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u === URL0) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: SKEL + HTML + '</body></html>' });
    if (/^https?:/.test(u)) { external.push(u); return r.abort(); }
    return r.continue();
  });
  await page.goto(URL0);
  await page.waitForFunction(() => window.__antikythera && window.__antikythera.level);
  const cdp = await ctx.newCDPSession(page);
  const T = {
    async tap(x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await page.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(60); },
    async tapSel(sel) { const b = await page.locator(sel).first().boundingBox(); await T.tap(b.x + b.width / 2, b.y + b.height / 2); },
    async tapToken(id) { await page.evaluate(id => document.querySelector(`.token[data-id="${id}"]`).scrollIntoView({ inline: 'center' }), id); await page.waitForTimeout(50); await T.tapSel(`.token[data-id="${id}"]`); },
    async tapPeg(i) { const [x, y] = await page.evaluate(i => window.__antikythera.pegScreen(i), i); await T.tap(x, y); },
    async drag(x0, y0, x1, y1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
      for (let k = 1; k <= 10; k++) { await page.waitForTimeout(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * k / 10, y: y0 + (y1 - y0) * k / 10, id: 1 }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(80);
    },
    async pinch(cx, cy, d0, d1) {
      const pts = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
      for (let k = 1; k <= 8; k++) { await page.waitForTimeout(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * k / 8) }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(80);
    },
    async load(n) {
      await page.evaluate(n => window.__antikythera.loadLevel(n), n);
      await page.waitForFunction(n => document.getElementById('lvNum').textContent.includes(' ' + n + ' '), n, { timeout: 60000 });
      await page.waitForTimeout(150);
    },
    st: () => page.evaluate(() => { const A = window.__antikythera; return { pl: [...A.placement.values()].filter(v => !v.locked && !v.rusted).length, moves: +((document.getElementById('movesTxt').textContent.match(/\d+/) || [0])[0]), zoom: A.view.zoom, win: !!A.ev.win, failed: !document.getElementById('failOv').hidden }; }),
  };
  return { ctx, page, errs, external, T };
}
const unlock = () => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('antikythera.unlockAll', 'true'); sessionStorage.setItem('seeded', '1'); } } catch (e) {} };

(async () => {
  const browser = await chromium.launch();
  const allErrs = [], allExt = [];
  const done = s => { allErrs.push(...s.errs); allExt.push(...s.external); return s.ctx.close(); };

  // 1. no web fonts or other outside requests
  ok(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+https?:/i.test(HTML), 'index.html links no web fonts or outside stylesheets');

  // 2. buttons are at least 44x44 in portrait, short portrait and landscape
  for (const [w, h] of [[390, 844], [360, 640], [844, 390]]) {
    const s = await open(browser, w, h, unlock);
    await s.T.load(50);
    const small = await s.page.evaluate(() => [...document.querySelectorAll('#selBtn, #helpBtn, #muteBtn, #zoomBtn, #resetBtn, #undoBtn, #spinBtn, #lvNum, #prevLv, #nextLv')]
      .filter(e => e.offsetParent).map(e => [e.id, e.getBoundingClientRect()]).filter(([, r]) => r.width < 43.5 || r.height < 43.5).map(([id, r]) => `${id} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`));
    ok(!small.length, `${w}x${h}: buttons >= 44x44 (${small.join(', ')})`);
    // 13. the Greek subtitle is never cut off
    const gr = await s.page.evaluate(() => [...document.querySelectorAll('.brand .gr')].filter(e => e.offsetParent).map(e => e.scrollWidth - e.clientWidth));
    ok(gr.every(d => d <= 1), `${w}x${h}: Greek title fits (${gr})`);
    await done(s);
  }

  // 3. crowded pegs: a tap between two close pegs magnifies instead of guessing; the second tap places; view returns
  {
    const s = await open(browser, 360, 640, unlock), { page, T } = s;
    await T.load(50);
    const pr = await page.evaluate(() => {
      const A = window.__antikythera, L = A.level; let best = null;
      for (let i = 0; i < L.pegs.length; i++) for (let j = i + 1; j < L.pegs.length; j++) {
        if (L.pegs[i].kind === 'crank' || L.pegs[j].kind === 'crank') continue;
        const d = Math.hypot(L.pegs[i].x - L.pegs[j].x, L.pegs[i].y - L.pegs[j].y); if (!best || d < best.d) best = { i, j, d };
      }
      return { ...best, px: best.d * A.view.sc };
    });
    const sol = await page.evaluate(i => { const L = window.__antikythera.level; const s = L.solution.find(x => x.peg === i); return s ? s.piece : L.pieces[0].id; }, pr.i);
    await T.tapToken(sol);
    const [ax, ay] = await page.evaluate(i => window.__antikythera.pegScreen(i), pr.i), [bx, by] = await page.evaluate(i => window.__antikythera.pegScreen(i), pr.j);
    await T.tap((ax + bx) / 2, (ay + by) / 2);
    let st = await T.st();
    ok(st.pl === 0 && st.moves === 0 && st.zoom > 1.5, `L50 360x640: tap between pegs ${pr.px.toFixed(1)} px apart magnifies (zoom ${st.zoom.toFixed(2)}, placed ${st.pl}, moves ${st.moves})`);
    const gap = await page.evaluate(({ i, j }) => { const A = window.__antikythera; const a = A.pegScreen(i), b = A.pegScreen(j); return Math.hypot(a[0] - b[0], a[1] - b[1]); }, pr);
    ok(gap >= 40, `L50 360x640: after zooming the two pegs are ${gap.toFixed(0)} px apart`);
    await T.tapPeg(pr.i);
    st = await T.st();
    const on = await page.evaluate(i => window.__antikythera.placement.has(i), pr.i);
    ok(on && st.moves === 1 && st.zoom <= 1.01, `L50 360x640: second tap places on the intended peg and zooms back (on ${on}, moves ${st.moves}, zoom ${st.zoom.toFixed(2)})`);
    // 11. studs have a dark halo: the pixel just outside a free stud is darker than the plate around it
    const halo = await page.evaluate(j => {
      const A = window.__antikythera, c = document.getElementById('board'), g = c.getContext('2d'), r = c.getBoundingClientRect();
      const [x, y] = A.pegScreen(j), k = c.width / r.width, v = A.view;
      const sr = Math.max(2.5, Math.min(4, 8 * v.sc), 5 * v.sc);
      const px = (dx) => { const d = g.getImageData(Math.round((x - r.left + dx) * k), Math.round((y - r.top) * k), 1, 1).data; return d[0] + d[1] + d[2]; };
      return { ring: px(sr + 1.6), halo: px(sr + 2.6) };
    }, pr.j);
    ok(halo.ring > 200, `free studs have a light rim (${halo.ring})`);
    await done(s);
  }

  // 4. late levels give time to think: >= 10 s per required move, >= 5 spare moves; the clock waits for the hint card
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    const tl = await page.evaluate(() => [10, 50, 75, 99, 100].map(n => { const L = window.__antikythera.getLevel(n); return [n, L.timeLimit, L.minMoves, L.moveLimit]; }));
    for (const [n, t, m, lim] of tl) { ok(t >= 10 * m, `L${n}: time ${t}s >= 10 s x ${m} moves`); ok(lim - m >= 5, `L${n}: ${lim - m} spare moves`); }
    await T.load(10);
    const t0 = await page.textContent('#timeTxt');
    await page.waitForTimeout(1600);
    const t0b = await page.textContent('#timeTxt');
    ok(t0 === t0b, `L10: the clock waits while the hint card is up (${t0} / ${t0b})`);
    await T.tapSel('#toastClose');
    await page.waitForTimeout(2300);
    const t1 = await page.textContent('#timeTxt');
    ok(t0 !== t1, `L10: closing the hint card starts the clock (${t0} -> ${t1})`);
    await T.load(10);
    const x10 = await page.evaluate(() => window.__antikythera.level.solution[0]);
    await T.tapToken(x10.piece); await T.tapPeg(x10.peg); await page.waitForTimeout(2300);
    ok((await page.textContent('#timeTxt')) !== t0, 'L10: the first move starts the clock too');
    // help open pauses it
    await T.tapSel('#helpBtn'); const h0 = await page.textContent('#timeTxt'); await page.waitForTimeout(1600); const h1 = await page.textContent('#timeTxt'); await T.tapSel('#helpClose');
    ok(h0 === h1, `L10: clock pauses while help is open (${h0} / ${h1})`);
    // 6. pinch-zoom on a board that fits: the zoom button appears and brings the view back
    await T.load(10);
    const v0 = await page.evaluate(() => ({ sc0: window.__antikythera.view.sc0, hidden: document.getElementById('zoomBtn').hidden }));
    const sb = await page.locator('#stage').boundingBox();
    await T.pinch(sb.x + sb.width / 2, sb.y + sb.height / 2, 60, 220);
    const z1 = await page.evaluate(() => ({ zoom: window.__antikythera.view.zoom, hidden: document.getElementById('zoomBtn').hidden }));
    ok(z1.zoom > 1.5 && !z1.hidden, `L10 (sc0 ${v0.sc0.toFixed(2)}, button hidden before ${v0.hidden}): after a pinch zoom ${z1.zoom.toFixed(2)} the zoom button shows`);
    await T.tapSel('#zoomBtn');
    const z2 = await page.evaluate(() => window.__antikythera.view.zoom);
    ok(z2 <= 1.01, `zoom button brings the view back (${z2.toFixed(2)})`);
    // 9. what is new on this level is readable (in the hint card, not an ellipsised bar)
    await T.load(50);
    const note = await page.evaluate(() => { const p = document.getElementById('toastTxt'); return { txt: p.textContent, cut: p.scrollWidth - p.clientWidth, vis: !document.getElementById('toast').hidden, bar: !!document.getElementById('evTxt') }; });
    ok(note.vis && /^本關：/.test(note.txt) && note.cut <= 1 && !note.bar, `L50: level note in the hint card (${note.txt.slice(0, 16)}…)`);
    await done(s);
  }

  // 7 + 8. undo (touch), fail-by-moves undo, and a half-built level surviving a reload
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(10);
    const L = await page.evaluate(() => { const L = window.__antikythera.level; return { sol: L.solution, lim: L.moveLimit }; });
    await T.tapToken(L.sol[0].piece); await T.tapPeg(L.sol[0].peg);
    const o0 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, L.sol[0].peg);
    await T.tapPeg(L.sol[0].peg); // accidental tap: flips and costs a move
    let st = await T.st();
    const o1 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, L.sol[0].peg);
    ok(st.moves === 2 && o1 !== o0, `tap on placed gear flips it (moves ${st.moves})`);
    await T.tapSel('#undoBtn');
    st = await T.st();
    const o2 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, L.sol[0].peg);
    ok(st.moves === 1 && o2 === o0 && st.pl === 1, `undo restores the flip and refunds the move (moves ${st.moves})`);
    ok((await page.textContent('#undoN')).trim() === '2', 'undo counter drops to 2');
    // reload keeps the placed gear, the moves and roughly the time left
    const tBefore = await page.textContent('#timeTxt');
    await page.reload(); await page.waitForFunction(() => window.__antikythera && window.__antikythera.level && document.getElementById('lvNum').textContent.includes(' 10 '));
    await page.waitForTimeout(200);
    st = await T.st();
    const tAfter = await page.textContent('#timeTxt');
    ok(st.pl === 1 && st.moves === 1, `reload keeps the half-built level (gears ${st.pl}, moves ${st.moves})`);
    ok(Math.abs(toS(tBefore) - toS(tAfter)) <= 3, `reload keeps the time left (${tBefore} -> ${tAfter})`);
    ok((await page.textContent('#undoN')).trim() === '2', 'reload keeps the undo count');
    // burn the move budget with flips -> fail card offers undo, which revives the attempt
    for (let i = st.moves; i < L.lim; i++) await T.tapPeg(L.sol[0].peg);
    st = await T.st();
    ok(st.failed, `running out of moves fails (moves ${st.moves}/${L.lim})`);
    ok(await page.isVisible('#failUndo'), 'fail card offers 復原上一步');
    await page.waitForTimeout(500); // the card ignores taps for its first 450 ms (ghost-click guard)
    await T.tapSel('#failUndo');
    st = await T.st();
    ok(!st.failed && st.moves === L.lim - 1, `undo from the fail card revives the attempt (moves ${st.moves})`);
    await done(s);
  }

  // 10. stars and best record (touch play of level 1), shown in the level grid
  {
    const s = await open(browser, 390, 844), { page, T } = s;
    await T.load(1);
    const sol = await page.evaluate(() => window.__antikythera.level.solution);
    for (const x of sol) { await T.tapToken(x.piece); await T.tapPeg(x.peg); }
    await page.waitForSelector('#winOv:not([hidden])', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const w = await page.evaluate(() => ({ stars: document.getElementById('winStars').textContent, rec: JSON.parse(localStorage.getItem('antikythera.v1')).rec }));
    ok(w.stars === '★★★' && w.rec && w.rec[1] && w.rec[1].s === 3 && w.rec[1].m === 1, `L1 in fewest moves: ★★★ and a best record (${w.stars} ${JSON.stringify(w.rec)})`);
    ok(await page.evaluate(() => !localStorage.getItem('antikythera.attempt')), 'a won level clears the saved attempt');
    await T.tapSel('#stayBtn'); await T.tapSel('#selBtn');
    const cell = await page.evaluate(() => document.querySelector('.lvcell').textContent);
    ok(/★★★/.test(cell), `level grid shows the stars (${cell})`);
    // old saves (no rec field) still load
    await page.evaluate(() => localStorage.setItem('antikythera.v1', JSON.stringify({ unlocked: 5, best: 4, level: 3, solved: [1, 2, 3, 4] })));
    await page.reload(); await page.waitForFunction(() => window.__antikythera && window.__antikythera.level);
    ok((await page.textContent('#lvNum')).includes(' 3 '), 'an old save without records still loads at its level');
    await done(s);
  }

  // 12. small phone inside the hub (375x500 with the hub's 53 px bar = a 375x447 frame): the board keeps >= 250 px,
  //     the buttons stay 44 px, and the dial names stay on the plate
  {
    const s = await open(browser, 375, 447, unlock), { page, T } = s;
    for (const n of [1, 25, 50, 100]) {
      await T.load(n);
      await page.waitForTimeout(100);
      const r = await page.evaluate(() => ({ h: document.getElementById('stage').getBoundingClientRect().height,
        small: [...document.querySelectorAll('button')].filter(e => e.offsetParent && !e.closest('.overlay') && !e.closest('.toast')).map(e => [e.id || e.className, e.getBoundingClientRect()]).filter(([, b]) => b.width < 43.5 || b.height < 43.5).map(([i]) => i),
        labels: (window.__antikythera.layout.dialLabels || []).filter(l => l.bottom > l.plateBottom + 0.5 || l.top < 0).map(l => l.key) }));
      ok(r.h >= 250, `375x447 L${n}: board stage ${r.h.toFixed(0)} px tall`);
      ok(!r.small.length, `375x447 L${n}: buttons >= 44 px (${r.small})`);
      ok(!r.labels.length, `375x447 L${n}: dial names inside the plate (${r.labels})`);
      ok(!(await page.evaluate(() => { const e = document.getElementById('lvName'); return e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1; })), `375x447 L${n}: level name shown whole`);
    }
    await done(s);
  }

  // ghost click (round-2 veto): the tap that uses the last move must not also press a button on the fail card
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(12);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; });
    const lim = await page.evaluate(() => window.__antikythera.level.moveLimit);
    // a free peg whose spot is under the fail card's button row
    const btnRow = await page.evaluate(() => { const o = document.getElementById('failOv'); o.hidden = false; const r = document.getElementById('failRetry').getBoundingClientRect(); o.hidden = true; return [r.top, r.bottom]; });
    const tok = await page.evaluate(() => document.querySelector('.token').dataset.id);
    await T.tapToken(tok);
    const peg = await page.evaluate(([y0, y1]) => { const A = window.__antikythera; let best = null; A.level.pegs.forEach((q, i) => { if (q.kind === 'crank' || A.placement.has(i)) return; const [x, y] = A.pegScreen(i); const d = y < y0 ? y0 - y : y > y1 ? y - y1 : 0; if (!best || d < best.d) best = { i, x, y, d }; }); return best; }, btnRow);
    await T.tap(peg.x, peg.y);
    let placed = await page.evaluate(i => window.__antikythera.placement.has(i), peg.i);
    if (!placed) { await T.tapPeg(peg.i); placed = await page.evaluate(i => window.__antikythera.placement.has(i), peg.i); }
    const [px, py] = await page.evaluate(i => window.__antikythera.pegScreen(i), peg.i);
    for (let i = 0; i < lim + 2; i++) { if (await page.isVisible('#failOv')) break; await T.tap(px, py); await page.waitForTimeout(80); }
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => ({ failed: !document.getElementById('failOv').hidden, undos: document.getElementById('undoN').textContent.trim(), sel: !document.getElementById('selOv').hidden, lv: document.getElementById('lvNum').textContent }));
    ok(placed && r.failed && r.undos === '3' && !r.sel && /12/.test(r.lv), `L12: the last-move tap leaves the fail card up, untouched (failed ${r.failed}, undos ${r.undos}, select ${r.sel}, peg y ${peg.y.toFixed(0)} vs buttons ${btnRow.map(Math.round)})`);
    await page.waitForTimeout(200);
    await T.tapSel('#failRetry');
    ok(!(await page.isVisible('#failOv')), 'a deliberate tap on 重試 after the guard still works');
    // level-load race: an older, slower request must not land on top of the newer choice
    await page.evaluate(() => { window.__antikythera.loadLevel(90); setTimeout(() => window.__antikythera.loadLevel(13), 50); });
    await page.waitForTimeout(6000);
    ok((await page.textContent('#lvNum')).includes(' 13 '), `picking L90 then L13 quickly ends on L13 (${await page.textContent('#lvNum')})`);
    await done(s);
  }

  // late mechanisms: a direction-only dial (L31) and a rusted gear (L41)
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(31);
    const d = await page.evaluate(() => ({ dir: window.__antikythera.level.outputs.some(o => o.dirOnly), txt: document.getElementById('targets').textContent, note: document.getElementById('toastTxt').textContent }));
    ok(d.dir && /速比不限/.test(d.txt) && /速比不限/.test(d.note), 'L31: one dial only needs the direction, and says so');
    await page.evaluate(() => window.__antikythera.solve());
    ok((await T.st()).win, 'L31 solution wins');
    await T.load(41);
    const k = await page.evaluate(() => { const L = window.__antikythera.level; return L.rusted && L.rusted[0]; });
    ok(!!k, 'L41 has a rusted gear');
    const o0 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, k.peg);
    ok(o0 === k.wrong, 'the rusted gear starts on the wrong layer');
    await page.evaluate(() => { document.getElementById('toast').hidden = true; });
    const [rx, ry] = await page.evaluate(i => window.__antikythera.pegScreen(i), k.peg), tb = await page.locator('#tray').boundingBox();
    await T.drag(rx, ry, tb.x + tb.width / 2, tb.y + tb.height / 2);
    let st = await T.st();
    ok((await page.evaluate(p => window.__antikythera.placement.has(p), k.peg)) && st.moves === 0, `dragging the rusted gear does not take it off (moves ${st.moves})`);
    await T.tapPeg(k.peg);
    st = await T.st();
    const o1 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, k.peg);
    ok(o1 === k.orient && st.moves === 1, `a tap flips the rusted gear (moves ${st.moves})`);
    await page.evaluate(() => window.__antikythera.solve());
    ok((await T.st()).win, 'L41 solution wins');
    await page.reload(); await page.waitForFunction(() => window.__antikythera && window.__antikythera.level && document.getElementById('lvNum').textContent.includes(' 41 '));
    await done(s);
  }

  // neighbouring levels stay within a smooth solver budget (round-2: L55 / L100 needed > 200k search nodes)
  {
    const S = require(path.resolve(__dirname, '../../../qa/skill-tiers/antikythera/solver.js'));
    for (const n of [50, 55, 60, 80, 99, 100]) {
      const L = S.K.getLevel(n), m = new Map();
      for (const k of [...(L.locked || []), ...(L.rusted || [])]) m.set(k.peg, { piece: L.pieces.find(p => p.id === k.piece), orient: k.orient });
      const r = S.solveDFS(L, m, 3000);
      ok(!!r.plan, `L${n}: solvable within 3000 search nodes (${r.nodes})`);
    }
  }

  // taking a gear off (drag back to the gear box) is free, and can be undone
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(12);
    const x = await page.evaluate(() => window.__antikythera.level.solution[0]);
    await T.tapToken(x.piece); await T.tapPeg(x.peg);
    const [px, py] = await page.evaluate(i => window.__antikythera.pegScreen(i), x.peg), tb = await page.locator('#tray').boundingBox();
    await T.drag(px, py, tb.x + tb.width / 2, tb.y + tb.height / 2 + 44);
    let st = await T.st();
    ok(st.pl === 0 && st.moves === 1, `dragging a gear back to the box removes it without a move (gears ${st.pl}, moves ${st.moves})`);
    await T.tapSel('#undoBtn');
    st = await T.st();
    ok(st.pl === 1 && st.moves === 1, `undo puts a removed gear back (gears ${st.pl}, moves ${st.moves})`);
    await done(s);
  }

  // fixed (riveted) gear levels: not in the tray, can't be moved or flipped, the level still solves
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(21);
    const k = await page.evaluate(() => { const L = window.__antikythera.level; return L.locked && L.locked[0]; });
    ok(!!k, 'L21 has a fixed gear');
    const inTray = await page.evaluate(id => !!document.querySelector(`.token[data-id="${id}"]`), k.piece);
    ok(!inTray, 'the fixed gear is not in the gear box');
    const o0 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, k.peg);
    await T.tapPeg(k.peg);
    const st = await T.st();
    const o1 = await page.evaluate(p => window.__antikythera.placement.get(p).orient, k.peg);
    ok(st.moves === 0 && o0 === o1, 'tapping the fixed gear changes nothing and costs no move');
    await page.evaluate(() => window.__antikythera.solve());
    ok((await T.st()).win, 'L21 solution wins with the fixed gear');
    await done(s);
  }

  // round-3 polish: board frozen between the win and its card; 重置 needs a second tap and sits >= 16 px below the
  // gear box; late levels keep max(5, 60% of the minimum) spare moves; dial names never overlap; the level name stays whole
  const nameCut = () => document.getElementById('lvName').scrollWidth > document.getElementById('lvName').clientWidth + 1 || document.getElementById('lvName').scrollHeight > document.getElementById('lvName').clientHeight + 1;
  const labelClash = () => { const li = window.__antikythera.layout, dl = (li.dialLabels || []).map(d => d.box), h = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; let n = 0; for (let i = 0; i < dl.length; i++) { for (let j = i + 1; j < dl.length; j++) if (h(dl[i], dl[j])) n++; for (const l of li.labels) if (h(dl[i], l.box)) n++; } return n; };
  {
    const s = await open(browser, 390, 844, unlock), { page, T } = s;
    await T.load(12);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; });
    const sol = await page.evaluate(() => window.__antikythera.level.solution);
    for (const x of sol) { await T.tapToken(x.piece); await T.tapPeg(x.peg); }
    let st = await T.st();
    const m0 = st.moves;
    for (let i = 0; i < 3; i++) await T.tapPeg(sol[sol.length - 1].peg);
    st = await T.st();
    ok(st.win && st.moves === m0 && !st.failed, `taps after the win, before its card, change nothing (win ${st.win}, moves ${m0} -> ${st.moves})`);
    await page.waitForSelector('#winOv:not([hidden])', { timeout: 5000 }).catch(() => {});
    ok(new RegExp(`${m0} 步`).test(await page.textContent('#winMsg')), 'the win card counts the same moves as the board');
    await T.load(12);
    await page.evaluate(() => { document.getElementById('toast').hidden = true; });
    const g = await page.evaluate(() => { const t = document.querySelector('.token').getBoundingClientRect(), r = document.getElementById('resetBtn').getBoundingClientRect(); return r.top - t.bottom; });
    ok(g >= 16, `390x844: 重置 is ${g.toFixed(0)} px below the gear box (>= 16)`);
    await T.tapToken(sol[0].piece); await T.tapPeg(sol[0].peg);
    await T.tapSel('#resetBtn');
    st = await T.st();
    ok(st.pl === 1 && st.moves === 1 && /確認/.test(await page.textContent('#resetBtn')), `one tap on 重置 only asks for confirmation (gears ${st.pl}, moves ${st.moves})`);
    await page.waitForTimeout(300);
    await T.tapSel('#resetBtn');
    st = await T.st();
    ok(st.pl === 0 && st.moves === 0 && (await page.textContent('#resetBtn')).trim() === '重置', `a second tap resets the board (gears ${st.pl}, moves ${st.moves})`);
    await T.tapToken(sol[0].piece); await T.tapPeg(sol[0].peg);
    await T.tapSel('#resetBtn'); await page.waitForTimeout(2600);
    await T.tapSel('#resetBtn');
    st = await T.st();
    ok(st.pl === 1, `the confirmation lapses after 2.5 s (gears ${st.pl})`);
    const sl = await page.evaluate(() => [50, 75, 99, 100].map(n => { const L = window.__antikythera.getLevel(n); return [n, L.minMoves, L.moveLimit - L.minMoves]; }));
    for (const [n, mm, sp] of sl) ok(sp >= Math.max(5, Math.ceil(0.6 * mm)), `L${n}: ${sp} spare moves over the minimum ${mm} (>= max(5, 60%))`);
    await done(s);
  }
  for (const [w, h, lv] of [[844, 390, [50]], [360, 640, [50, 13]], [320, 568, [13]]]) {
    const s = await open(browser, w, h, unlock), { page, T } = s;
    for (const n of lv) { // L13 has the longest name (刻文 ΚΑΛΛΙΠΠΟΣ ΙΓ)
      await T.load(n);
      await page.waitForTimeout(150);
      const r = await page.evaluate(([a, b]) => ({ cut: eval(a)(), clash: eval(b)(), name: document.getElementById('lvName').textContent, gap: (() => { const t = document.querySelector('.token').getBoundingClientRect(), r = document.getElementById('resetBtn').getBoundingClientRect(); return r.top >= t.bottom - 1 ? r.top - t.bottom : null; })() }), [String(nameCut), String(labelClash)]);
      ok(!r.cut, `${w}x${h} L${n}: level name shown whole (${r.name})`);
      ok(!r.clash, `${w}x${h} L${n}: dial names overlap no other label (${r.clash})`);
      if (r.gap != null) ok(r.gap >= 16, `${w}x${h} L${n}: 重置 ${r.gap.toFixed(0)} px below the gear box`);
    }
    await done(s);
  }

  ok(!allErrs.length, 'no page or console errors: ' + allErrs.slice(0, 3).join(' | '));
  ok(!allExt.length, 'no outside requests: ' + allExt.slice(0, 3).join(' '));
  await browser.close();
  console.log(`${fail ? 'FAIL' : 'OK'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
function toS(t) { const m = String(t).match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : NaN; }
