// 數回 (slitherlink) — browser verification with real touch input (CDP Input.dispatchTouchEvent).
// Checks every phone size (390x844 and the lobby iframe sizes 375x500 / 390x610 / 430x740) in light and dark:
// no page/console errors, no horizontal overflow, controls inside the screen and at least 44 px; plays level 1 from the
// title screen (intro -> guided first moves -> drag the whole loop) to the win card; progress survives a reload;
// tap cycling, undo/redo, 檢查 marks a wrong line, 提示 explains and applies a step, a 假設法 hint shows its ghost chain,
// pinch zoom on a big board, landscape 844x390. Writes screenshots and demo/cover-390x520.png.
// Usage: node verify.js
const path = require('path'), fs = require('fs');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0, failed = 0;
function ok(c, name) { if (c) passed++; else { failed++; console.log('FAIL ' + name); } }

async function open(browser, w, h, dark, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errors.push('network request ' + r.url()); });
  await page.goto(APP); await sleep(600);
  if (opts.seen) { await page.evaluate(() => localStorage.setItem('slitherlink:v1:seen', JSON.stringify({ i1: 1, i4: 1, i10: 1, i37: 1, i61: 1, coach: 1, zoomTip: 1 }))); }
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tapXY = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await sleep(40); await touch('touchEnd', []); await sleep(60); };
  const tap = async sel => { const b = await page.locator(sel).first().boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  const st = () => page.evaluate(() => window.__game.state());
  const dragPath = async pts => { await touch('touchStart', [{ x: pts[0][0], y: pts[0][1], id: 1 }]); for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { await sleep(8); await touch('touchMove', [{ x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3, id: 1 }]); } await touch('touchEnd', []); await sleep(80); };
  return { ctx, page, errors, cdp, touch, tap, tapXY, st, dragPath };
}
// the solution loop as a vertex walk
async function loopVerts(page) {
  return page.evaluate(() => {
    const g = window.__game, pz = g.puzzle(), sol = g.sol(), W = pz.W, H = pz.H, NH = W * (H + 1), W1 = W + 1;
    const ends = e => e < NH ? [Math.floor(e / W) * W1 + e % W, Math.floor(e / W) * W1 + e % W + 1] : [Math.floor((e - NH) / W1) * W1 + (e - NH) % W1, Math.floor((e - NH) / W1) * W1 + (e - NH) % W1 + W1];
    const adj = {}; sol.forEach((v, e) => { if (!v) return; const [a, b] = ends(e); (adj[a] = adj[a] || []).push(b); (adj[b] = adj[b] || []).push(a); });
    const start = +Object.keys(adj)[0], out = [start]; let prev = -1, cur = start;
    for (;;) { const nx = adj[cur].find(x => x !== prev); if (nx === start || nx === undefined) { out.push(start); break; } out.push(nx); prev = cur; cur = nx; if (out.length > 5000) break; }
    return out.map(v => g.vertexXY(v));
  });
}
async function layoutCheck(S, label) {
  const r = await S.page.evaluate(() => {
    const vis = el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && el.offsetParent !== null; };
    const bad = [];
    document.querySelectorAll('button').forEach(b => { if (!vis(b)) return; const r = b.getBoundingClientRect(); let sc = b.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement; if (sc) { const q = sc.getBoundingClientRect(); if (r.top >= q.bottom - 1 || r.bottom <= q.top + 1) return; if (r.bottom > q.bottom + 1 || r.top < q.top - 1) return; } if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) bad.push('outside ' + (b.id || b.className) + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); if (r.width < 43.5 || r.height < 43.5) bad.push('small ' + (b.id || b.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
    return { bad, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  ok(r.overflow <= 1, label + ' no horizontal overflow (' + r.overflow + ')');
  ok(!r.bad.length, label + ' buttons on screen and >= 44 px ' + r.bad.slice(0, 3).join('; '));
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  // ---------- every size, light and dark: first-run flow through level 1 ----------
  for (const [w, h] of [[390, 844], [375, 500], [390, 610], [430, 740]]) for (const dark of [false, true]) {
    const label = w + 'x' + h + (dark ? ' dark' : ' light'), S = await open(browser, w, h, dark);
    await layoutCheck(S, label + ' title');
    if (w === 375 || w === 390 && h === 844) await S.page.screenshot({ path: path.join(OUT, 'title-' + w + 'x' + h + (dark ? '-dark' : '') + '.png') });
    await S.tap('#tSelect'); await sleep(350);
    ok(await S.page.isVisible('#grid .lt[data-n="1"]'), label + ' level select shows level 1');
    await layoutCheck(S, label + ' select');
    await S.tap('.lt[data-n="1"]'); await sleep(500);
    ok((await S.st()).overlay === 'intro', label + ' level 1 opens with the rules card');
    await S.tap('#iOk'); await sleep(600);
    const s1 = await S.st();
    ok(s1.coach > 0 && s1.hint && !(await S.page.isHidden('#hintBox')), label + ' guided first moves show a hint card');
    await layoutCheck(S, label + ' play');
    if (w === 375 && !dark) await S.page.screenshot({ path: path.join(OUT, 'play-coach-375x500.png') });
    const pts = await loopVerts(S.page);
    await S.dragPath(pts); await sleep(400);
    const s2 = await S.st();
    ok(s2.won, label + ' one drag along the loop solves level 1 (' + s2.lines + '/' + s2.solLines + ')');
    await sleep(2100);
    ok(await S.page.isVisible('#win'), label + ' win card appears');
    await layoutCheck(S, label + ' win');
    if (w === 375 || (w === 390 && h === 844)) await S.page.screenshot({ path: path.join(OUT, 'win-' + w + 'x' + h + (dark ? '-dark' : '') + '.png') });
    await S.page.reload(); await sleep(600);
    const prog = await S.page.evaluate(() => window.__game.progress());
    ok(prog[1] && prog[1].s >= 2, label + ' progress survives reload (' + JSON.stringify(prog[1]) + ')');
    ok(/第 2 關/.test(await S.page.textContent('#tPlay')), label + ' title offers level 2 next');
    ok(!S.errors.length, label + ' no errors ' + S.errors.slice(0, 2).join(' | '));
    await S.ctx.close();
  }
  // ---------- controls at 390x844 ----------
  {
    const S = await open(browser, 390, 844, false, { seen: true });
    await S.page.evaluate(() => window.__game.start(20, true)); await sleep(400);
    const E = () => S.page.evaluate(() => window.__game.E());
    const xy = e => S.page.evaluate(e => window.__game.edgeXY(e), e);
    const sol = await S.page.evaluate(() => window.__game.sol());
    const eLine = sol.findIndex(v => v), eNo = sol.findIndex(v => !v);
    let p = await xy(eNo);
    await S.tapXY(p[0], p[1]); ok((await E())[eNo] === 1, 'tap draws a line');
    await S.tapXY(p[0], p[1]); ok((await E())[eNo] === 2, 'second tap makes a cross');
    await S.tapXY(p[0], p[1]); ok((await E())[eNo] === 0, 'third tap clears');
    await S.tapXY(p[0], p[1]); // wrong line again
    await S.tap('#bUndo'); await sleep(80); ok((await E())[eNo] === 0, 'undo removes it');
    await S.tap('#bRedo'); await sleep(80); ok((await E())[eNo] === 1, 'redo brings it back');
    await S.tap('#bCheck'); await sleep(150);
    const fl = await S.page.evaluate(() => window.__game.flash());
    ok(fl.includes(eNo), '檢查 marks the wrong line in red');
    await S.page.screenshot({ path: path.join(OUT, 'check-390x844.png') });
    const m0 = await S.page.evaluate(() => window.__game.marksLeft());
    ok(m0 === 4 + Math.floor(7 * 8 / 10) - 1, 'L20 (7x8) has 4 + cells/10 error-finding uses; one is spent (' + m0 + ' left)');
    ok(+(await S.page.textContent('#ckLeft')) === m0 && m0 >= 2, '檢查 badge shows the error-finding uses left (' + m0 + ')');
    await S.tap('#bHint'); await sleep(250);
    ok((await S.st()).hint === '有地方畫錯了', 'hint first points out the mistake');
    await S.tap('#hintDo'); await sleep(150); ok((await E())[eNo] === 0, '「幫我清掉」 removes the wrong mark');
    { // spend the remaining error-finding uses, then 檢查 only counts and 提示 offers no auto-clear
      await S.tapXY(p[0], p[1]); await sleep(60);
      let left = await S.page.evaluate(() => window.__game.marksLeft());
      ok(left === m0 - 1, 'the 提示 that pointed out the mistake used one error-finding too (' + left + ')');
      for (let i = 0; i < left; i++) { await S.tap('#bCheck'); await sleep(100); }
      ok(+(await S.page.textContent('#ckLeft')) === 0, 'badge reaches 0');
      await sleep(2700); await S.tap('#bCheck'); await sleep(150);
      const lc = await S.page.evaluate(() => window.__game.lastCheck());
      ok(lc && lc.wrong === 1 && !lc.located && (await S.page.evaluate(() => window.__game.flash())).length === 0, 'then 檢查 only counts the errors: ' + JSON.stringify(lc));
      const h0 = (await S.st()).hints; await S.tap('#bHint'); await sleep(250);
      ok(!(await S.page.isVisible('#hintDo')) && (await S.st()).hints === h0, '提示 explains the limit, offers no clear button and is not counted');
      await S.tap('#hintX'); await sleep(100); await S.tap('#bUndo'); await sleep(100);
      ok((await E())[eNo] === 0, '復原 still removes the mistake');
    }
    await S.tap('#bHint'); await sleep(250);
    const h1 = await S.st(); const txt = await S.page.textContent('#hintTxt');
    ok(h1.hint && txt.length > 12, 'hint explains a deduction: ' + h1.hint + ' — ' + txt.slice(0, 40));
    const before = (await E()).filter(v => v).length;
    await S.tap('#hintDo'); await sleep(150);
    ok((await E()).filter(v => v).length > before, '「幫我畫上」 applies the step');
    // ✕ mode
    await S.tap('#bMode'); await sleep(80);
    { const Ec = await E(); const eb = sol.findIndex((v, i) => !v && Ec[i] === 0); p = await xy(eb); await S.tapXY(p[0], p[1]); ok((await E())[eb] === 2, '打叉模式: one tap places a cross'); }
    await S.tap('#bMode'); await sleep(80);
    // drag draws several edges and dragging back takes them back
    const V = v => S.page.evaluate(v => window.__game.vertexXY(v), v);
    await S.page.evaluate(() => window.__game.start(12, true)); await sleep(300);
    const W1 = (await S.st()).W + 1;
    ok(!(await S.page.isVisible('#ckLeft')), 'levels 1-15 have unlimited error finding (badge hidden)');
    const pts = [await V(0), await V(1), await V(2), await V(2 + W1)];
    await S.dragPath(pts); let s = await S.st();
    ok(s.lines === 3 && s.undo === 1, 'one drag draws 3 edges as a single undo step (' + s.lines + ', ' + s.undo + ')');
    await S.dragPath([await V(2 + W1), await V(2), await V(1), await V(0)]); s = await S.st();
    ok(s.lines === 0, 'dragging back over the same edges erases them');
    // rapid taps: 8 per second, alternating edges
    const a = await xy(40), b = await xy(41);
    for (let i = 0; i < 16; i++) { const q = i % 2 ? b : a; await S.touch('touchStart', [{ x: q[0], y: q[1], id: 1 }]); await sleep(45); await S.touch('touchEnd', []); await sleep(80); }
    await sleep(100); s = await S.st(); const E2 = await E();
    ok(s.undo === 16 + 2 && E2[40] === 2 && E2[41] === 2, 'rapid taps at 8/s: every tap counted once (8 taps each: line,✕,clear cycle → ✕) (' + s.undo + ' steps, states ' + E2[40] + ',' + E2[41] + ')');
    // trial hint on a later level: apply hints until a 假設法 step comes up
    await S.page.evaluate(() => window.__game.start(45, true)); await sleep(300);
    let sawTrial = false, ghost = false;
    for (let k = 0; k < 260 && !sawTrial; k++) {
      await S.page.click('#bHint'); await sleep(30);
      const hh = await S.st();
      if (hh.hint === '假設法') { sawTrial = true; ghost = /虛線/.test(await S.page.textContent('#hintTxt')); await sleep(300); await S.page.screenshot({ path: path.join(OUT, 'hint-trial-390x844.png') }); break; }
      if (hh.won || !hh.hint) break;
      await S.page.click('#hintDo'); await sleep(20);
    }
    ok(sawTrial && ghost, 'a 假設法 hint appears with its dashed ghost chain');
    // pinch zoom on a big board does not draw anything
    await S.page.evaluate(() => window.__game.start(95, true)); await sleep(300);
    const c = [195, 430];
    await S.touch('touchStart', [{ x: c[0] - 40, y: c[1], id: 1 }, { x: c[0] + 40, y: c[1], id: 2 }]);
    for (let k = 1; k <= 10; k++) { await sleep(16); await S.touch('touchMove', [{ x: c[0] - 40 - 7 * k, y: c[1], id: 1 }, { x: c[0] + 40 + 7 * k, y: c[1], id: 2 }]); }
    await S.touch('touchEnd', []); await sleep(200); s = await S.st();
    ok(s.zoom > 1.5 && s.lines === 0 && s.crosses === 0, 'pinch zooms (' + s.zoom.toFixed(2) + 'x) without drawing');
    ok(await S.page.isVisible('#bFit'), 'zoomed view shows the fit button');
    await S.page.screenshot({ path: path.join(OUT, 'zoom-390x844.png') });
    await S.tap('#bFit'); await sleep(150); ok((await S.st()).zoom === 1, 'fit button zooms back out');
    // pause on hide, theme toggle
    await S.tap('#bPause'); await sleep(200); ok((await S.st()).overlay === 'pause', 'menu button pauses');
    await S.tap('#pSet'); await sleep(200); await S.tap('#segTheme button[data-v="dark"]'); await sleep(100);
    ok(await S.page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'theme switch to dark');
    await S.page.reload(); await sleep(500);
    ok(await S.page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'theme choice survives reload');
    ok(!S.errors.length, 'controls: no errors ' + S.errors.slice(0, 2).join(' | '));
    await S.ctx.close();
  }
  // ---------- landscape ----------
  {
    const S = await open(browser, 844, 390, false, { seen: true });
    await S.page.evaluate(() => window.__game.start(60, true)); await sleep(400);
    await layoutCheck(S, '844x390 play');
    const pts = await loopVerts(S.page);
    await S.dragPath(pts.slice(0, Math.floor(pts.length * 0.6)));
    await S.page.screenshot({ path: path.join(OUT, 'play-844x390.png') });
    await S.dragPath(pts.slice(Math.floor(pts.length * 0.6) - 1));
    await sleep(2300);
    ok((await S.st()).won && await S.page.isVisible('#win'), '844x390: drag-solve level 60 and see the win card');
    await layoutCheck(S, '844x390 win');
    await S.page.screenshot({ path: path.join(OUT, 'win-844x390.png') });
    ok(!S.errors.length, 'landscape: no errors ' + S.errors.slice(0, 2).join(' | '));
    await S.ctx.close();
  }
  // ---------- release-review fixes: tap precision, hint card squeeze, toast position (L100 at 360x640) ----------
  {
    const S = await open(browser, 360, 640, false, { seen: true });
    const G = (f, a) => S.page.evaluate(f, a);
    await G(() => window.__game.start(100, true)); await sleep(400);
    const c0 = await G(() => window.__game.cellSize());
    // 1a. pinch zoom reaches 80-90 px per cell
    const ar = await G(() => window.__game.area()), cx = ar.x + ar.w / 2, cy = ar.y + ar.h / 2;
    await S.touch('touchStart', [{ x: cx - 20, y: cy, id: 1 }, { x: cx + 20, y: cy, id: 2 }]);
    for (let k = 1; k <= 12; k++) { await sleep(16); await S.touch('touchMove', [{ x: cx - 20 - 12 * k, y: cy, id: 1 }, { x: cx + 20 + 12 * k, y: cy, id: 2 }]); }
    await S.touch('touchEnd', []); await sleep(150);
    const cz = await G(() => window.__game.cellSize());
    ok(cz >= 80 && cz <= 90, 'max pinch zoom gives 80-90 px cells (' + c0.toFixed(1) + ' -> ' + cz.toFixed(1) + ')');
    await S.tap('#bFit'); await sleep(150);
    // 1b. press highlights the edge under the finger, sliding moves the highlight, release marks the highlighted edge
    const E0 = await G(() => window.__game.E()), st0 = await S.st(), W = st0.W, NH = W * (st0.H + 1);
    // A = horizontal edge h(x,y), B = vertical edge v(x,y): they meet at a dot, the classic near-miss pair
    const x0 = 5, y0 = 9, eA = y0 * W + x0, eB = NH + y0 * (W + 1) + x0;
    const pa = await G(e => window.__game.edgeXY(e), eA), pb = await G(e => window.__game.edgeXY(e), eB);
    const at = t => [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t];
    const q0 = at(0.3), q1 = at(0.66);
    await S.touch('touchStart', [{ x: q0[0], y: q0[1], id: 1 }]); await sleep(60);
    ok(E0[eA] === 0 && E0[eB] === 0 && (await G(() => window.__game.pressEdge())) === eA, 'finger down highlights the edge under it (' + eA + ')');
    for (let k = 1; k <= 3; k++) { await sleep(16); const q = at(0.3 + 0.36 * k / 3); await S.touch('touchMove', [{ x: q[0], y: q[1], id: 1 }]); }
    await sleep(40);
    const hl = await G(() => window.__game.pressEdge());
    ok(hl === eB, 'sliding a few px toward the other edge moves the highlight there (' + hl + ' vs ' + eB + ', slid ' + Math.hypot(q1[0] - q0[0], q1[1] - q0[1]).toFixed(1) + ' px)');
    let E1 = await G(() => window.__game.E());
    ok(E1[eA] === 0 && E1[eB] === 0, 'nothing is marked while the finger is still down');
    await S.page.screenshot({ path: path.join(OUT, 'press-highlight-360x640.png') });
    await S.touch('touchEnd', []); await sleep(80);
    E1 = await G(() => window.__game.E());
    ok(E1[eB] === 1 && E1[eA] === 0, 'release marks the corrected edge, not the one first touched');
    // 2. the hint card does not squeeze the cells below 24 px, and the hinted edges stay visible above it
    await S.tap('#bUndo'); await sleep(80);
    await S.tap('#bHint'); await sleep(350);
    const ch = await G(() => window.__game.cellSize());
    ok(ch >= 24 && c0 - ch < 3.5, 'hint card keeps cells >= 24 px (' + c0.toFixed(1) + ' -> ' + ch.toFixed(1) + ')');
    const hb = await S.page.evaluate(() => { const r = document.getElementById('hintBox').getBoundingClientRect(); return { top: r.top }; });
    const hintEdges = await G(() => { const g = window.__game; return (g.state().hint ? 1 : 0); });
    const tgt = await S.page.evaluate(() => { const g = window.__game; const h = g.hintEdges ? g.hintEdges() : []; return h.map(e => g.edgeXY(e)); });
    ok(tgt.length > 0 && tgt.every(p => p[1] < hb.top - 4 && p[1] > ar.y - 4), 'hinted edges are on screen above the hint card (' + tgt.length + ' edges)');
    await S.page.screenshot({ path: path.join(OUT, 'hint-L100-360x640.png') });
    await S.tap('#hintX'); await sleep(250);
    ok(Math.abs((await G(() => window.__game.cellSize())) - c0) < 0.5, 'closing the hint card restores the cell size');
    // 3. the toast after 檢查 stays clear of the board
    await S.tap('#bCheck'); await sleep(250);
    const tr = await S.page.evaluate(() => { const r = document.getElementById('toast').getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const br = await G(() => window.__game.boardRect());
    ok(tr.bottom <= br.y - 1, 'portrait toast sits in the HUD row, above the board (toast ' + Math.round(tr.top) + '-' + Math.round(tr.bottom) + ', board top ' + Math.round(br.y) + ')');
    await S.page.screenshot({ path: path.join(OUT, 'toast-360x640.png') });
    ok(!S.errors.length, '360x640 review fixes: no errors ' + S.errors.slice(0, 2).join(' | '));
    await S.ctx.close();
  }
  { // landscape: the hint card must not squeeze L100 below 24 px cells either
    const S = await open(browser, 844, 390, true, { seen: true });
    await S.page.evaluate(() => window.__game.start(100, true)); await sleep(400);
    const c0 = await S.page.evaluate(() => window.__game.cellSize());
    await S.tap('#bHint'); await sleep(350);
    const ch = await S.page.evaluate(() => window.__game.cellSize());
    const hb = await S.page.evaluate(() => document.getElementById('hintBox').getBoundingClientRect().right);
    const tgt = await S.page.evaluate(() => { const g = window.__game; return g.hintEdges().map(e => g.edgeXY(e)); });
    ok(ch >= Math.min(24, c0) - 0.01 && tgt.length && tgt.every(p => p[0] > hb + 2 && p[0] < 844), '844x390 L100: hint card keeps cells >= 24 px (' + c0.toFixed(1) + ' -> ' + ch.toFixed(1) + ') and the hinted edges beside it');
    await S.page.screenshot({ path: path.join(OUT, 'hint-L100-844x390.png') });
    await S.ctx.close();
  }
  // ---------- cover ----------
  {
    const S = await open(browser, 390, 520, false, { seen: true });
    await S.page.evaluate(() => window.__game.start(26, true)); await sleep(400);
    const pts = await loopVerts(S.page);
    await S.dragPath(pts.slice(0, Math.floor(pts.length * 0.7)));
    const sol = await S.page.evaluate(() => window.__game.sol()), E = await S.page.evaluate(() => window.__game.E());
    // a few crosses next to the drawn part, the way a player marks them
    let n = 0;
    for (let e = 0; e < sol.length && n < 14; e += 3) if (!sol[e] && !E[e]) { const p = await S.page.evaluate(e => window.__game.edgeXY(e), e); if (p[1] < 300) { await S.tapXY(p[0], p[1]); await S.tapXY(p[0], p[1]); n++; } }
    await sleep(500);
    await S.page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover written');
    await S.ctx.close();
  }
  await browser.close();
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
