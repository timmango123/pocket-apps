// Tests for 新接龍: rule unit tests on the game's own core (CORE-START/END in ../index.html), then in-page
// regression tests in Chromium with real touch for the release-review fixes. Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {msDeal,newState,cloneS,capacity,checkMove,isSafe,runAuto,genMoves,solve,expandSolution,isWon,canStack,runLen,cRank,cSuit};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const C = (r, s) => (r - 1) * 4 + s; // s: 0♣ 1♦ 2♥ 3♠
const st = (cols, cells, f) => ({ c: cols.concat([[], [], [], [], [], [], [], []]).slice(0, 8), r: cells, f: f || [0, 0, 0, 0] });
// Microsoft deal #1 first row
const d1 = core.msDeal(1);
t('MS deal #1 row 1 = JD 2D 9H JC 5D 7H 7C 5H', JSON.stringify(d1.map(c => c[0])) === JSON.stringify([C(11, 1), C(2, 1), C(9, 2), C(11, 0), C(5, 1), C(7, 2), C(7, 0), C(5, 2)]));
t('deal: 4 columns of 7, 4 of 6, 52 distinct cards', d1.slice(0, 4).every(c => c.length === 7) && d1.slice(4).every(c => c.length === 6) && new Set(d1.flat()).size === 52);
// capacity = (free cells + 1) * 2^(empty columns), destination empty column not counted
const full = [[C(13, 3)], [C(13, 2)], [C(13, 1)], [C(13, 0)], [C(12, 3)], [C(12, 2)]]; // 6 non-empty, 2 empty
t('capacity 4 cells, 2 empty cols -> 20', core.capacity(st(full, [-1, -1, -1, -1]), false) === 20);
t('capacity to empty col with 2 empty -> 10', core.capacity(st(full, [-1, -1, -1, -1]), true) === 10);
t('capacity 2 free of 3, 0 empty -> 3', core.capacity(st(full.concat([[C(1, 0)], [C(1, 1)]]), [-1, -1, C(5, 0)]), false) === 3);
t('capacity 0 free cells, 1 empty, to empty -> 1', core.capacity(st(full.concat([[C(1, 0)]]), [C(2, 0), C(2, 1)]), true) === 1);
// supermove legality
const run5 = [C(9, 3), C(8, 2), C(7, 0), C(6, 1), C(5, 3)]; // 9♠ 8♥ 7♣ 6♦ 5♠
const S1 = st([run5, [C(10, 2)], [C(2, 0)], [C(2, 1)], [C(2, 2)], [C(2, 3)], [C(3, 0)], [C(3, 1)]], [-1, -1, -1, C(4, 0)]);
t('run length 5', core.runLen(run5) === 5);
t('5-card run onto 10♥ with 3 free cells, no empty col: rejected (cap 4)', core.checkMove(S1, { k: 'c', fr: 0, n: 5, to: 1 }) === '最多可移 4 張');
t('wrong-rank partial run rejected', core.checkMove(S1, { k: 'c', fr: 0, n: 4, to: 1 }) !== '');
const S2 = st([run5, [C(10, 2)], [C(2, 0)], [C(2, 1)], [C(2, 2)], [C(2, 3)], [C(3, 0)], []], [-1, -1, -1, C(4, 0)]);
t('5-card run onto 10♥ with 3 free + 1 empty col (cap 8): legal', core.checkMove(S2, { k: 'c', fr: 0, n: 5, to: 1 }) === '');
t('5-card run INTO the empty col (cap 4): illegal', core.checkMove(S2, { k: 'c', fr: 0, n: 5, to: 7 }) === '最多可移 4 張');
t('4-card run into the empty col: legal', core.checkMove(S2, { k: 'c', fr: 0, n: 4, to: 7 }) === '');
t('stack rule: same colour rejected', core.checkMove(st([[C(5, 1)], [C(6, 2)]], [-1]), { k: 'c', fr: 0, n: 1, to: 1 }) !== '');
t('stack rule: red 5 on black 6 accepted', core.checkMove(st([[C(5, 1)], [C(6, 3)]], [-1]), { k: 'c', fr: 0, n: 1, to: 1 }) === '');
t('cell holds one card', core.checkMove(st([[C(5, 1)]], [C(9, 0)]), { k: 'r', fr: 0, n: 1, to: 0 }) !== '');
t('foundation: same suit A->K only', core.checkMove(st([[C(2, 1)]], [-1], [1, 0, 0, 0]), { k: 'f', fr: 0, n: 1, to: 1 }) !== '' && core.checkMove(st([[C(2, 1)]], [-1], [0, 1, 0, 0]), { k: 'f', fr: 0, n: 1, to: 1 }) === '');
// safe auto-collect
t('ace always safe', core.isSafe(st([[C(1, 2)]], [-1]), C(1, 2)));
t('red 3 not safe while a black 2 is still out', !core.isSafe(st([[C(3, 1)]], [-1], [1, 2, 2, 2]), C(3, 1)));
t('red 3 safe when both black foundations >= 2', core.isSafe(st([[C(3, 1)]], [-1], [2, 2, 0, 2]), C(3, 1)));
let bad = 0;
// simpler, exhaustive check on the replayed solutions: every auto move at the time it happens satisfies the safe rule
let autos = 0;
for (let n = 1; n <= 20; n++) {
  const S = core.newState(core.msDeal(n), 4), r = core.solve(S, { limit: 20000 }); if (!r.ok) continue;
  const list = core.expandSolution(S, r.moves);
  const f = [0, 0, 0, 0];
  for (const m of list) { if (m.k === 'f') { if (m.auto) { autos++; const rk = core.cRank(m.card), red = (m.card & 3) === 1 || (m.card & 3) === 2; for (let s = 0; s < 4; s++) { const sr = s === 1 || s === 2; if (sr !== red && f[s] < rk - 1) bad++; } } f[m.card & 3]++; } }
}
t('auto-collect obeys the safe rule in ' + autos + ' auto moves', bad === 0);
// a solved solution replays to a win
const S3 = core.newState(core.msDeal(1), 4), r3 = core.solve(S3);
t('solver solves deal #1 and the move list replays to a win', r3.ok && !!core.expandSolution(S3, r3.moves));
t('deal #11982 is not solved with 1 free cell quickly (sanity: solver can fail)', !core.solve(core.newState(core.msDeal(11982), 1), { limit: 3000 }).ok);
// ---- in-page regression tests (Chromium, real CDP touch) for the release-review findings ----
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APPURL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(page, fn, arg, ms = 15000) { // wait on a page condition (no fixed sleeps)
  const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg).catch(() => null); if (v) return v; if (Date.now() - t0 > ms) return v; await sleep(25); }
}
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(vp, init) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(APPURL); await until(page, () => !!window.__game);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (p, hold = 40) => { await T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(hold); await T('touchEnd', []); };
    const tapSel = async sel => { const b = await page.locator(sel).boundingBox(); await tap({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); };
    const st = () => page.evaluate(() => window.__game.state());
    const settle = () => until(page, () => { const s = window.__game.state(); return s && !s.busy; });
    const pt = c => page.evaluate(c => window.__game.cardPoint(c), c);
    return { ctx, page, T, tap, tapSel, st, settle, pt };
  }
  async function fresh(o, deal) { await o.page.evaluate(d => window.startGame({ mode: 'free', deal: d, cells: 4, fresh: true }), deal); await o.settle(); }
  // top cards whose best move is not to a free cell (so a tap visibly sends them somewhere)
  const movable = o => o.page.evaluate(() => { const S = window.G.S, r = []; for (let i = 0; i < 8; i++) { const c = S.c[i][S.c[i].length - 1]; const m = window.bestTarget(c, 1); if (m && !m.err && m.k !== 'r') r.push(c); } return r; });
  const where = (S, c) => S.r.indexOf(c) >= 0 ? 'r' : S.f[c & 3] > (c >> 2) ? 'f' : 'c' + S.c.findIndex(col => col.includes(c));

  let o = await open();
  // 1. two thumbs overlapping on two different cards: both taps act (finger 2 lands 80ms after finger 1)
  { let ok = 0, runs = 0;
    for (let deal = 10; deal < 40 && runs < 3; deal++) {
      await fresh(o, deal); const mv = await movable(o); if (mv.length < 2) continue;
      // the two cards must not depend on each other (moving A must leave B's move legal)
      const a = mv[0], b = mv[mv.length - 1]; const A = await o.pt(a), B = await o.pt(b); const s0 = await o.st();
      await o.T('touchStart', [{ x: A.x, y: A.y, id: 11 }]); await sleep(80);
      await o.T('touchStart', [{ x: A.x, y: A.y, id: 11 }, { x: B.x, y: B.y, id: 12 }]); await sleep(30);
      await o.T('touchEnd', [{ x: A.x, y: A.y, id: 11 }]); await sleep(70); await o.T('touchEnd', []);
      await o.settle(); const s1 = await o.st(); runs++;
      if (where(s1.S, a) !== where(s0.S, a) && where(s1.S, b) !== where(s0.S, b) && s1.hist === 2) ok++;
    }
    t('two overlapping thumbs on two cards: both moves happen (' + ok + '/' + runs + ')', runs === 3 && ok === 3); }
  // 2. a still press held 800 ms (or a slow, delayed pointerup) is still a tap
  for (const [hold, wob] of [[800, 0], [700, 0], [80, 12], [140, 14]]) {
    await fresh(o, 21); const c = (await movable(o))[0], p = await o.pt(c);
    await o.T('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
    if (wob) { await sleep(hold / 2); await o.T('touchMove', [{ x: p.x + wob, y: p.y + 3, id: 1 }]); await sleep(hold / 2); } else await sleep(hold);
    await o.T('touchEnd', []); await o.settle();
    t('press ' + hold + 'ms with ' + wob + 'px wobble acts as a tap', (await o.st()).hist === 1);
  }
  // 3. drag released half a column beside a legal column (and over an illegal one) snaps to the legal column
  { let done = false;
    for (let deal = 1; deal < 60 && !done; deal++) {
      await fresh(o, deal);
      const pick = await o.page.evaluate(() => { const S = window.G.S; for (let i = 0; i < 8; i++) { const c = S.c[i][S.c[i].length - 1]; for (let j = 0; j < 8; j++) { if (j === i || !S.c[j].length) continue; if (window.checkMove(S, { k: 'c', fr: i, n: 1, to: j })) continue; const nb = j + (j > 0 ? -1 : 1); if (nb === i || window.checkMove(S, { k: 'c', fr: i, n: 1, to: nb }) === '') continue; return { c, to: j, nb }; } } return null; });
      if (!pick) continue;
      const a = await o.pt(pick.c), L = await o.page.evaluate(() => window.__game.layout());
      const dp = await o.page.evaluate(i => window.__game.dropPoint('c', i), pick.to);
      const b = { x: dp.x + (pick.nb - pick.to) * (L.cw + L.gap) * 0.62, y: dp.y };
      await o.T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(120);
      for (let i = 1; i <= 8; i++) { await o.T('touchMove', [{ x: a.x + (b.x - a.x) * i / 8, y: a.y + (b.y - a.y) * i / 8, id: 1 }]); await sleep(15); }
      await o.T('touchEnd', []); await o.settle();
      t('drag let go over an illegal column next to a legal one lands on the legal one', where((await o.st()).S, pick.c) === 'c' + pick.to); done = true;
    }
    t('found a deal for the drag-snap test', done); }
  // 4. hints: first press only warns, second shows; a level won with a hint gets at most two stars
  { await o.page.evaluate(() => window.startGame({ mode: 'level', level: 3, fresh: true })); await o.settle();
    const hb = await o.page.locator('#bHint').boundingBox(), H = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await o.tap(H); await sleep(50);
    t('first hint press in a level only warns (no hint, not counted)', (await o.st()).hints === 0 && !(await o.page.evaluate(() => !!window.hintHL)));
    await o.tap(H); await until(o.page, () => window.__game.state().hints === 1);
    t('second hint press shows the hint and counts it', (await o.st()).hints === 1 && await o.page.evaluate(() => !!window.hintHL));
    // finish the level with the embedded (3-star length) solution through the game's own move function
    await o.page.evaluate(() => { const full = window.expandSolution(window.G.S0, window.decodeSol(window.LEVELS[2][4])); for (const m of full) { if (m.auto && window.G.S.f[m.card & 3] > (m.card >> 2)) continue; const mm = window.locate(window.G.S, m.card, m); if (window.G.S.f[m.card & 3] > (m.card >> 2)) continue; window.doMove(mm); } });
    await until(o.page, () => !document.getElementById('win').classList.contains('hidden'), null, 20000);
    const rec = await o.page.evaluate(() => JSON.parse(localStorage.getItem('freecell:progress')).lv[3]);
    t('solver-length win with a hint is capped at two stars (' + JSON.stringify(rec) + ')', rec && rec[1] === 2 && (await o.page.textContent('#wMsg')).includes('提示'));
    t('win screen shows the play time', /^\d+:\d\d$/.test(await o.page.textContent('#wTime')) && rec[2] > 0); }
  // 5. a half-played level and a half-played daily survive a reload and resume (moves, undo history)
  { await o.page.evaluate(() => { localStorage.removeItem('freecell:saves'); window.startGame({ mode: 'level', level: 2, fresh: true }); }); await o.settle();
    for (let i = 0; i < 3; i++) { const c = (await movable(o))[0]; await o.tap(await o.pt(c)); await o.settle(); await sleep(350); }
    const before = await o.st();
    await o.page.reload(); await until(o.page, () => !!window.__game);
    await o.page.evaluate(() => { const p = JSON.parse(localStorage.getItem('freecell:progress')); p.cur = 2; p.u = Math.max(p.u, 2); localStorage.setItem('freecell:progress', JSON.stringify(p)); });
    await o.page.reload(); await until(o.page, () => !!window.__game);
    t('title offers to continue the saved level', (await o.page.textContent('#tPlay')).includes('繼續第 2 關'));
    await o.tapSel('#tPlay'); await o.settle(); const after = await o.st();
    t('reload + 繼續 resumes the level (' + before.moves + ' moves, ' + before.hist + ' undo steps)', after.level === 2 && after.moves === before.moves && after.moves > 0 && after.hist === before.hist && JSON.stringify(after.S) === JSON.stringify(before.S));
    await o.tapSel('#bUndo'); await o.settle();
    t('undo still works after resuming', (await o.st()).hist === before.hist - 1);
    await o.page.evaluate(() => window.toTitle()); await o.tapSel('#tDaily'); await o.settle();
    const c = (await movable(o))[0]; await o.tap(await o.pt(c)); await o.settle(); const d0 = await o.st();
    await o.page.reload(); await until(o.page, () => !!window.__game); await o.tapSel('#tDaily'); await o.settle(); const d1 = await o.st();
    t('reload resumes the daily challenge', d1.mode === 'daily' && d1.moves === d0.moves && d1.moves > 0 && JSON.stringify(d1.S) === JSON.stringify(d0.S)); }
  // 5b. double tap on the same spot sends the card to a free cell; fast taps down a column (A, then the card B it
  // uncovered, 125 ms later) are two normal taps. Presses are dispatched inside the page with fixed timing; a try whose
  // measured gap misses the window on a loaded machine is retried, and skipped (not failed) if none fits.
  { const press = (pts, gap) => o.page.evaluate(async ([pts, gap]) => {
      const cv = document.getElementById('cv'), ev = (type, p, id) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: p.x, clientY: p.y, bubbles: true, isPrimary: true, pointerType: 'touch' }));
      const t0 = performance.now(); ev('pointerdown', pts[0], 71); ev('pointerup', pts[0], 71);
      await new Promise(r => setTimeout(r, gap)); const t1 = performance.now(); ev('pointerdown', pts[1], 72); ev('pointerup', pts[1], 72);
      return t1 - t0; }, [pts, gap]);
    const jobOf = toCol => o.page.evaluate(toCol => {
      const S = window.G.S;
      for (let i = 0; i < 8; i++) { const col = S.c[i]; if (col.length < 2) continue; const A = col[col.length - 1], B = col[col.length - 2];
        const ma = window.bestTarget(A, 1); if (!ma || ma.err || ma.k === 'r' || (toCol && ma.k !== 'c')) continue;
        const T = window.cloneS(S); window.applyMove(T, ma); if (window.autoOn()) window.runAuto(T); if (T.c[i][T.c[i].length - 1] !== B) continue; const save = window.G.S; window.G.S = T; const mb = window.bestTarget(B, 1); window.G.S = save;
        if (!mb || mb.err) continue;
        const L = window.__game.layout(), off = window.colOff(col.length - 1), pA = window.__game.cardPoint(A);
        return { A, B, pA, pB: { x: L.cols[i].x + L.cw / 2, y: L.cols[i].y + off * (col.length - 2) + L.ch / 2 }, pB90: { x: L.cols[i].x + L.cw / 2, y: L.cols[i].y + off * (col.length - 2) + L.ch * 0.9 } }; }
      return null; }, toCol);
    for (const kind of ['double 40', 'double 90', 'sequential 125', 'sequential-low 125']) {
      const gap = +kind.split(' ')[1]; let res = null, measured = 0;
      for (let deal = 200, tries = 0; deal < 260 && tries < 8 && measured < 3; deal++) {
        await fresh(o, deal); const j = await jobOf(kind[0] === 'd'); if (!j) continue; tries++;
        const s0 = await o.st(); const dt = await press(kind[0] === 'd' ? [j.pA, j.pA] : [j.pA, kind.includes('low') ? j.pB90 : j.pB], gap); await o.settle(); const s1 = await o.st();
        if (!(dt < 300)) continue; measured++;
        const ok = kind[0] === 'd' ? s1.S.r.includes(j.A) && s1.moves === 1 && s1.hist === 1
          : !s1.S.r.includes(j.A) && where(s1.S, j.A) !== where(s0.S, j.A) && where(s1.S, j.B) !== where(s0.S, j.B) && s1.hist === 2;
        res = res !== false && ok;
      }
      if (res === null) console.log('SKIP ' + kind + ': machine too busy to keep the tap gap under 300 ms');
      else t(kind[0] === 's' ? 'fast taps down a column (A, then the uncovered B ' + (kind.includes('low') ? 'near its bottom ' : '') + '125ms later) move both cards (' + measured + ' tries)' : 'double tap on the same spot (' + gap + 'ms apart) puts the card in a free cell as one move (' + measured + ' tries)', res);
    } }
  // 5c. a hint in free play on a level's deal caps that level; 重來 after a hint says the cap still holds
  { const deal = await o.page.evaluate(() => window.LEVELS[4][0]);
    await o.page.evaluate(d => { window.startGame({ mode: 'free', deal: d, cells: 4, fresh: true }); }, deal); await o.settle();
    const hb = await o.page.locator('#bHint').boundingBox(), H = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    await o.tap(H); await sleep(50);
    t('free play on a level deal warns before the first hint', (await o.st()).hints === 0 && (await o.page.textContent('#toast')).includes('第 5 關'));
    await o.tap(H); await until(o.page, () => window.__game.state().hints === 1);
    await o.page.evaluate(() => window.startGame({ mode: 'level', level: 5, fresh: true })); await o.settle();
    t('the level with that deal starts with the hint counted (max two stars)', (await o.st()).hints === 1 && (await o.page.textContent('#hGoal')).includes('提示'));
    const c = (await movable(o))[0]; await o.tap(await o.pt(c)); await o.settle(); await sleep(350);
    await o.tapSel('#bRestart'); await until(o.page, () => document.getElementById('toast').textContent.includes('已重新開始'));
    t('重來 after a hint says the two-star cap stays', (await o.page.textContent('#toast')).includes('最多兩星'));
    const S = await o.page.evaluate(() => window.LEVELS.map(l => l[3]));
    t('shown difficulty column rises strictly over all 100 levels', S.every((v, i) => i === 0 || v > S[i - 1])); }
  // 6. phone layout: cards >= 44 px wide at 390, setting segments >= 44 high
  { const L = await o.page.evaluate(() => window.__game.layout());
    t('390-wide portrait cards are 44px wide (got ' + L.cw + ') with >= 30px of each covered card showing (' + L.baseOff + ')', L.cw >= 44 && L.baseOff >= 30);
    await o.page.evaluate(() => window.openSettings());
    const hs = await o.page.$$eval('.seg button', bs => bs.map(b => b.offsetHeight).filter(h => h > 0));
    t('setting segment buttons are >= 44 high', hs.length >= 6 && Math.min(...hs) >= 44); }
  // 7. achievements and the daily streak
  { await o.page.evaluate(() => { const d = new Date(), ds = k => { const x = new Date(d.getTime() - k * 864e5); return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }; window.stats.daily = {}; [0, 1, 2].forEach(k => window.stats.daily[ds(k)] = 40); window.renderStats(); });
    const n = await o.page.$$eval('.ach', a => a.length), on = await o.page.$$eval('.ach.on', a => a.map(x => x.textContent));
    t('at least 10 achievements, and a 3-day daily streak unlocks 三日連窯', n >= 10 && on.some(x => x.includes('三日連窯')) && (await o.page.textContent('#statG')).includes('3 天')); }
  await o.ctx.close();
  // 8. stars saved under the old level order follow their deal to the new level number
  { o = await open(null, () => { if (!sessionStorage.getItem('m')) { sessionStorage.setItem('m', 1); localStorage.setItem('freecell:progress', JSON.stringify({ u: 2, cur: 1, lv: { 1: [20, 3] } })); } });
    const p = await o.page.evaluate(() => ({ p: window.progress, n: window.LEVELS.findIndex(l => l[0] === 852) + 1 }));
    t('old progress migrates by deal (old L1 = deal 852 -> new L' + p.n + ')', p.p.v === 2 && JSON.stringify(p.p.lv[p.n]) === '[20,3]' && !p.p.lv[1] && p.p.cur === p.n);
    const open_ = await o.page.evaluate(n => [window.progress.u, window.isOpen(1), window.isOpen(2), window.isOpen(3), window.isOpen(n), window.isOpen(n - 1)], p.n);
    t('migration keeps the old frontier: L1-L2 and the recorded level open, nothing else (' + JSON.stringify(open_) + ')', JSON.stringify(open_) === '[2,true,true,false,true,false]');
    await o.ctx.close(); }
  // 9. landscape 640x360: tool buttons >= 44 wide and not over the board
  { o = await open({ width: 640, height: 360 }); await o.page.evaluate(() => window.startGame({ mode: 'free', deal: 3, cells: 4, fresh: true })); await o.settle();
    const ws = await o.page.$$eval('#tools .tb', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [r.width, r.right]; }));
    const L = await o.page.evaluate(() => window.__game.layout());
    t('640x360 tool buttons >= 44 wide and left of the board', Math.min(...ws.map(w => w[0])) >= 44 && Math.max(...ws.map(w => w[1])) <= L.cols[0].x);
    await o.ctx.close(); }
  await browser.close();
  t('no page or console errors (' + errors.slice(0, 3).join(' | ') + ')', errors.length === 0);
  console.log(`tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception', e && e.stack || e); process.exit(1); });

