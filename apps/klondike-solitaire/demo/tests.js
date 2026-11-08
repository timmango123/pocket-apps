// Rule unit tests for 經典接龍, run against the game's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {mulberry32,deal,cloneSt,fits,canTab,canFound,runOk,doDraw,doMove,legalMove,isWon,canDraw,talonReach,safeFound,genMoves,solve,moveScore,recycleScore,timeBonus,diffScore,levelMode,cRank,cSuit,cRed};')();
let pass = 0, fail = 0;
function t(name, cond) { if (process.env.KV) console.log(cond ? 'ok  ' : 'FAIL', name); if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const card = (rank, suit) => suit * 13 + rank - 1; // suits: 0♠ 1♥ 2♣ 3♦
const S = 0, Hh = 1, Cc = 2, D = 3;
function empty(draw = 1, limit = -1) { return { t: [[], [], [], [], [], [], []], d: [0, 0, 0, 0, 0, 0, 0], s: [], w: [], f: [0, 0, 0, 0], draw, limit, passes: 0 }; }

// --- deal ---
const d0 = C.deal(12345, 1, -1);
t('7 columns with 1..7 cards', d0.t.every((c, i) => c.length === i + 1));
t('only top card face up', d0.d.every((n, i) => n === i));
t('24 cards in stock, waste empty', d0.s.length === 24 && d0.w.length === 0);
t('52 distinct cards', new Set([].concat(...d0.t, d0.s)).size === 52);
t('same seed -> same deal', JSON.stringify(C.deal(12345, 1, -1)) === JSON.stringify(d0));
t('different seed -> different deal', JSON.stringify(C.deal(12346, 1, -1).t) !== JSON.stringify(d0.t));

// --- tableau stacking ---
t('red 6 on black 7', C.fits(card(6, Hh), card(7, S)));
t('black 6 on black 7 illegal', !C.fits(card(6, Cc), card(7, S)));
t('red 5 on black 7 illegal', !C.fits(card(5, Hh), card(7, S)));
let st = empty(); st.t[0] = [card(7, S)];
t('canTab onto face-up top', C.canTab(st, card(6, D), 0));
st.d[0] = 1; t('cannot stack onto face-down card', !C.canTab(st, card(6, D), 0));
st = empty();
t('empty column accepts K', C.canTab(st, card(13, Hh), 0));
t('empty column rejects Q', !C.canTab(st, card(12, Hh), 0));

// --- run moves ---
st = empty(); st.t[0] = [card(9, S), card(8, Hh), card(7, Cc), card(6, D)]; st.t[1] = [card(9, Hh)];
t('valid run detected', C.runOk(st, 0, 1));
t('move whole run 8-7-6 onto red 9 illegal (8♥ on 9♥ same colour)', !C.legalMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 }));
st.t[1] = [card(9, Cc)];
t('move run onto black 9', !!C.doMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 }) && st.t[1].length === 4 && st.t[0].length === 1);
st = empty(); st.t[0] = [card(9, S), card(5, Hh)]; t('broken sequence is not a run', !C.runOk(st, 0, 0));
st = empty(); st.t[0] = [card(13, S), card(12, Hh)];
t('K-led run to empty column', !!C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 't', tc: 3 }));
st.t[0] = [card(12, Hh), card(11, S)]; t('Q-led run to empty column illegal', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 't', tc: 3 }));

// --- reveal ---
st = empty(); st.t[0] = [card(2, S), card(5, Hh)]; st.d[0] = 1; st.t[1] = [card(6, Cc)];
let r = C.doMove(st, { from: 't', fc: 0, idx: 1, to: 't', tc: 1 });
t('moving last face-up card reveals the next', r.revealed && st.d[0] === 0);

// --- foundations ---
st = empty(); st.t[0] = [card(1, Hh)];
t('ace to empty foundation', !!C.doMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }) && st.f[Hh] === 1);
st.t[0] = [card(3, Hh)]; t('3 on A illegal', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st.t[0] = [card(2, D)]; t('2♦ on A♥ illegal (wrong suit)', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st.t[0] = [card(2, Hh)]; C.doMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }); t('2♥ on A♥', st.f[Hh] === 2);
st = empty(); st.t[0] = [card(9, S), card(8, Hh)]; t('only single cards go to foundation', !C.legalMove(st, { from: 't', fc: 0, idx: 0, to: 'f' }));
st = empty(); st.f[Hh] = 5; st.t[2] = [card(6, S)];
t('foundation top back to tableau', !!C.doMove(st, { from: 'f', fc: Hh, to: 't', tc: 2 }) && st.f[Hh] === 4 && st.t[2].length === 2);
t('foundation to foundation not allowed', !C.legalMove(st, { from: 'f', fc: Hh, to: 'f' }));

// --- stock / waste: draw-1, draw-3, recycle limits ---
st = empty(1, -1); st.s = [card(1, S), card(2, S), card(3, S)];
C.doDraw(st); t('draw-1 moves one card', st.w.length === 1 && st.w[0] === card(3, S));
st = empty(3, -1); st.s = [card(1, S), card(2, S), card(3, S), card(4, S), card(5, S)];
C.doDraw(st); t('draw-3 moves three cards, last drawn on top', st.w.length === 3 && st.w[2] === card(3, S));
C.doDraw(st); t('draw-3 with fewer than three left draws the rest', st.w.length === 5 && st.s.length === 0);
st.t[0] = [card(2, Hh)];
t('only the waste top is playable', JSON.stringify(C.legalMove(st, { from: 'w', to: 'f' })) === JSON.stringify([card(1, S)]));
const order = st.w.slice();
r = C.doDraw(st); t('recycle when stock empty', r.recycle && st.s.length === 5 && st.w.length === 0 && st.passes === 1);
C.doDraw(st); C.doDraw(st); t('recycled stock is dealt in the same order', JSON.stringify(st.w) === JSON.stringify(order));
st = empty(1, 1); st.s = [card(1, S)]; C.doDraw(st); C.doDraw(st); C.doDraw(st);
t('recycle limit reached -> cannot draw', st.passes === 1 && st.s.length === 0 && !C.canDraw(st) && C.doDraw(st) === null);
st = empty(1, -1); t('nothing to draw when stock and waste empty', !C.canDraw(st));

// --- talon reachability (used by solver, hints and stuck detection) ---
st = empty(3, -1); st.s = [1, 2, 3, 4, 5, 6, 7].map(r => card(r, Cc)).reverse(); // top = A♣
let tr = C.talonReach(st); const reach = tr.list.map(e => C.cRank(e.card)).sort((a, b) => a - b);
t('draw-3 reachable cards are every third plus the last', JSON.stringify(reach) === '[3,6,7]');
st = empty(1, 0); st.s = [card(5, Cc)]; st.w = [card(8, Cc), card(7, Cc)];
tr = C.talonReach(st); t('with no recycles left the waste below the top is unreachable', JSON.stringify(tr.list.map(e => C.cRank(e.card))) === '[7,5]');

// --- win / auto-finish precondition ---
st = empty(); st.f = [13, 13, 13, 13]; t('52 on foundations is a win', C.isWon(st));
st.f = [13, 13, 13, 12]; t('51 is not', !C.isWon(st));

// --- safe auto-foundation rule (solver pruning) ---
st = empty(); t('aces and twos always safe', C.safeFound(st, card(2, Hh)));
st.f = [3, 0, 3, 0]; t('red 4 safe when both black 3s are up', C.safeFound(st, card(4, Hh)));
st.f = [3, 0, 2, 0]; t('red 4 not safe while a black 3 is out', !C.safeFound(st, card(4, Hh)));

// --- scoring ---
t('waste->tableau +5', C.moveScore({ from: 'w', to: 't' }, false) === 5);
t('to foundation +10', C.moveScore({ from: 't', to: 'f' }, false) === 10);
t('reveal +5', C.moveScore({ from: 't', to: 't' }, true) === 5);
t('foundation->tableau -15', C.moveScore({ from: 'f', to: 't' }, false) === -15);
t('draw-1 recycle -100', C.recycleScore(1, 1) === -100);
t('draw-3 recycles 1-3 free, 4th -20', C.recycleScore(3, 3) === 0 && C.recycleScore(3, 4) === -20);
t('time bonus only from 30 s', C.timeBonus(29) === 0 && C.timeBonus(140) === 5000);

// --- level modes ---
const m = n => C.levelMode(n);
t('1-40 draw-1 unlimited', m(1).draw === 1 && m(40).limit === -1);
t('41-60 draw-1 limit 3', m(41).draw === 1 && m(60).limit === 3);
t('61-85 draw-3 unlimited', m(61).draw === 3 && m(85).limit === -1);
t('86-100 draw-3 limit 3', m(86).draw === 3 && m(100).limit === 3);

// --- solver: solution replays to a win; unsolvable position reported as such ---
const sd = C.deal(100001, 1, -1), sr = C.solve(sd, 200000);
let rep = C.cloneSt(sd), okRep = sr.ok;
if (okRep) for (const a of sr.path) { if (a === 'D') C.doDraw(rep); else if (!C.doMove(rep, a)) { okRep = false; break; } }
t('solver path replays to a win', okRep && C.isWon(rep));
st = empty(1, 0); st.t[0] = [card(1, S), card(2, S)]; st.d[0] = 1; st.f = [0, 13, 13, 13]; // A♠ buried under 2♠, no moves
// fill remaining spades nowhere -> not winnable
t('blocked position is unsolvable', !C.solve(st, 10000).ok && C.genMoves(st, false).length === 0);


// --- levels: every deal solvable by the game's search within 20000 nodes, shown difficulty strictly rising ---
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
t('100 levels', LEVELS.length === 100);
t('difficulty rises every level', LEVELS.every((l, i) => !i || l[1] > LEVELS[i - 1][1]));
t('every level within 20000 solver nodes (embedded N)', LEVELS.every(l => l[2] <= 20000));
for (const n of [59, 85, 86, 95, 97, 100]) { const m = C.levelMode(n), r = C.solve(C.deal(LEVELS[n - 1][0], m.draw, m.limit), 20000); t('level ' + n + ' solved within 20000 nodes', r.ok && r.nodes === LEVELS[n - 1][2]); }

// ================= browser regression tests (real CDP touch) =================
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
// served over a local http origin (file:// localStorage was unreliable across quick reloads under load)
const http = require('http');
const server = http.createServer((q, r) => { if (q.url.split('?')[0] === '/' || q.url.startsWith('/index.html')) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); } else { r.writeHead(404); r.end(); } });
let URL0 = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const lvSol = n => { const m = C.levelMode(n), st0 = C.deal(LEVELS[n - 1][0], m.draw, m.limit); return { st0, path: C.solve(st0, 600000).path }; };
function replay(st0, acts) { const s = C.cloneSt(st0); for (const a of acts) { if (a === 'D') C.doDraw(s); else C.doMove(s, a); } return s; }
function collectable(st) { const s = C.cloneSt(st); let k = 0; for (;;) { let mv = null; for (let c = 0; c < 7 && !mv; c++) { const cc = s.t[c]; if (cc.length > s.d[c] && C.canFound(s, cc[cc.length - 1])) mv = { from: 't', fc: c, idx: cc.length - 1, to: 'f' }; } if (!mv && s.w.length && C.canFound(s, s.w[s.w.length - 1])) mv = { from: 'w', to: 'f' }; if (!mv) return k; C.doMove(s, mv); k++; } }
const saveOf = (n, st, extra) => JSON.stringify(Object.assign({ mode: 'level', n, seed: LEVELS[n - 1][0], draw: st.draw, limit: st.limit, dateKey: null, st, score: 0, undoPen: 0, undos: 0, moves: 10, hints: 0, timeMs: 60000, started: true }, extra || {}));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); URL0 = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch(), errors = [];
  async function open(vp, ls) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (ls) await ctx.addInitScript(o => { if (location.protocol === 'http:' && window.name !== '__seeded') { window.name = '__seeded'; localStorage.clear(); for (const k in o) localStorage.setItem(k, o[k]); } }, ls);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL0);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (x, y, hold = 50) => { await T('touchStart', [{ x, y, id: 1 }]); await sleep(hold); await T('touchEnd', []); };
    const box = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tapSel = async sel => { const p = await box(sel); await tap(p.x, p.y); };
    const st = () => page.evaluate(() => window.__game.state());
    const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(25); } return null; };
    const settle = () => until(async () => { const s = await st(); return s.screen === 'game' && !s.anim && s; });
    return { ctx, page, T, tap, box, tapSel, st, until, settle };
  }
  async function startLevel(o, n) {
    await o.until(() => o.page.isVisible('#tLevels')); await o.tapSel('#tLevels'); await o.until(() => o.page.isVisible('#unlockSw'));
    if ((await o.page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await o.tapSel('#unlockSw'); await o.until(async () => (await o.page.getAttribute('#unlockSw', 'aria-checked')) === 'true'); }
    await o.page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await o.tapSel('.lt[data-n="' + n + '"]');
    await o.until(async () => (await o.st()).screen === 'game');
    if (await o.until(() => o.page.isVisible('#intro'), 600)) { await o.tapSel('#iOk'); await o.until(async () => !(await o.page.isVisible('#intro'))); }
    return o.settle();
  }
  // the page saves its own game on pagehide, so a planted save is written after that (listener added later runs later)
  // plant a saved game and reopen the page: the save is written by an init script inside the new document (no race with the
  // old page's own pagehide save or with localStorage commit timing), once per call
  let injN = 0;
  const inject = async (o, v) => {
    const tok = 'inj' + (++injN) + '_' + Date.now();
    await o.ctx.addInitScript(([v, tok]) => { if (location.protocol !== 'http:') return; if (!localStorage.getItem('__' + tok)) { localStorage.setItem('__' + tok, '1'); localStorage.setItem('klondike:current', v); } }, [v, tok]);
    await o.page.goto('about:blank'); await o.page.goto(URL0);
  };
  async function resume(o) { await o.until(() => o.page.isVisible('#tResume')); await o.tapSel('#tResume'); return o.settle(); }
  const L3 = lvSol(3), first3 = L3.path.find(a => a !== 'D' && a.from === 't');
  const s3 = replay(L3.st0, L3.path.slice(0, L3.path.indexOf(first3)));
  // position on level 3 just before its first tableau move (a tap moves it)
  const o = await open(undefined, { 'klondike:current': saveOf(3, s3), 'klondike:progress': JSON.stringify({ best: {}, cur: 1, seen: { 1: 1, 41: 1, 61: 1, 86: 1 }, lv: 4 }) });
  await resume(o);
  // 1) second finger while the first is still down is never swallowed (stock + card, 4 timings)
  for (const [d1, d2, d3] of [[80, 30, 70], [40, 20, 60], [120, 60, 40], [60, 100, 40]]) {
    await o.page.evaluate(() => localStorage.setItem('klondike:x', '1'));
    const s0 = await o.settle(); const A = await o.page.evaluate(() => window.__game.stockPt()); const B = await o.page.evaluate(a => window.__game.srcPt('t', a.fc, a.idx), first3);
    await o.T('touchStart', [{ x: A.x, y: A.y, id: 11 }]); await sleep(d1);
    await o.T('touchStart', [{ x: A.x, y: A.y, id: 11 }, { x: B.x, y: B.y, id: 12 }]); await sleep(d2);
    await o.T('touchEnd', [{ x: B.x, y: B.y, id: 12 }]); await sleep(d3); await o.T('touchEnd', []);
    const s1 = await o.until(async () => { const s = await o.st(); return s.moves >= s0.moves + 2 && s; }, 3000);
    t('two-finger overlap ' + [d1, d2, d3] + ': both taps count', !!s1 && s1.moves === s0.moves + 2);
    const u = await o.box('#bUndo'); for (let k = 0; k < 2; k++) { const m = (await o.st()).moves; await o.tap(u.x, u.y); await o.until(async () => (await o.st()).moves < m, 2000); }
  }
  // 2) a shaky tap (finger slides 9-15 px) still plays the card
  for (const wob of [9, 12, 15]) {
    const s0 = await o.settle(); const p = await o.page.evaluate(a => window.__game.srcPt('t', a.fc, a.idx), first3);
    await o.T('touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(40); await o.T('touchMove', [{ x: p.x + wob * 0.6, y: p.y + wob * 0.8, id: 1 }]); await sleep(40); await o.T('touchEnd', []);
    const ok = await o.until(async () => (await o.st()).moves > s0.moves, 5000);
    t('wobble ' + wob + 'px counts as a tap', !!ok);
    if (ok) { const u = await o.box('#bUndo'); await o.tap(u.x, u.y); await o.until(async () => (await o.st()).moves === s0.moves, 2000); }
  }
  // 2b) a toolbar button pressed with a second finger while the other finger is on the table still acts (pointerup-driven)
  for (const btn of ['#bUndo', '#bHint']) for (const ord of [['Ad', 'Bd', 'Bu', 'Au'], ['Ad', 'Bd', 'Au', 'Bu'], ['Bd', 'Ad', 'Bu', 'Au'], ['Bd', 'Ad', 'Au', 'Bu']]) {
    await o.settle();
    if (btn === '#bUndo') { const sp0 = await o.page.evaluate(() => window.__game.stockPt()); const m = (await o.st()).moves; await o.tap(sp0.x, sp0.y); await o.until(async () => (await o.st()).moves > m, 3000); await o.settle(); }
    const s0 = await o.st(); const A = await o.box(btn); const B = await o.page.evaluate(a => window.__game.srcPt('t', a.fc, a.idx), first3);
    const down = new Set(); const pts = () => [...down].map(k => k === 'A' ? { ...A, id: 21 } : { ...B, id: 22 });
    for (const e of ord) { const who = e[0]; if (e[1] === 'd') { down.add(who); await o.T('touchStart', pts()); } else { down.delete(who); await o.T('touchEnd', [who === 'A' ? { ...A, id: 21 } : { ...B, id: 22 }]); } await sleep(50); }
    const key = btn === '#bUndo' ? 'undos' : 'hints';
    const acted = await o.until(async () => (await o.st())[key] > s0[key], 4000);
    await sleep(300); const s1 = await o.st();
    t(btn + ' with a second finger ' + ord.join('') + ' acts exactly once', !!acted && s1[key] === s0[key] + 1);
    // put the card back if it moved
    for (let k = 0; k < 4 && (await o.st()).undoable > 0; k++) { const u = await o.box('#bUndo'); const m = (await o.st()).undoable; await o.tap(u.x, u.y); await o.until(async () => (await o.st()).undoable < m, 3000); }
  }
  // 2c) 選單 opens on pointerup; its follow-up click does not press the panel, and a quick real tap on the panel still works
  { await o.settle(); await o.tapSel('#bMenu'); await o.until(() => o.page.isVisible('#menu'), 3000); await sleep(700);
    t('menu tap opens the menu and nothing in it is pressed', await o.page.isVisible('#menu')); }
  { await o.page.evaluate(() => document.getElementById('menu').classList.add('hidden')); await o.settle();
    await o.tapSel('#bMenu'); await o.until(() => o.page.isVisible('#menu'), 3000); await sleep(350);
    await o.tapSel('#mResume'); t('a quick tap on 繼續 right after opening the menu works', !!(await o.until(async () => !(await o.page.isVisible('#menu')), 3000))); }
  // 3) undo history survives a reload
  { const s0 = await o.settle(); const p = await o.page.evaluate(() => window.__game.stockPt());
    for (let k = 0; k < 3; k++) { const m = (await o.st()).moves; await o.tap(p.x, p.y); await o.until(async () => (await o.st()).moves > m, 2000); }
    const before = await o.st(); await sleep(400); // let the browser commit localStorage before reloading
    await o.page.reload(); const r = await resume(o);
    t('after reload the game resumes with undo history ' + JSON.stringify([before.moves, before.undoable, r && r.moves, r && r.undoable]), r.undoable >= 3 && r.moves === before.moves && !(await o.page.isDisabled('#bUndo')));
    const u = await o.box('#bUndo'); await o.tap(u.x, u.y); t('undo works after reload', !!(await o.until(async () => (await o.st()).moves === before.moves - 1, 2000)));
    t('saved history is capped at 100', await o.page.evaluate(() => JSON.parse(localStorage.getItem('klondike:current')).hist.length <= 100)); }
  // 4) 悔棋 during a 收牌 chain stops the chain
  { const L2 = lvSol(2); let k = Math.floor(L2.path.length * 0.6), sp;
    for (; k < L2.path.length; k++) { sp = replay(L2.st0, L2.path.slice(0, k)); if (collectable(sp) >= 4 && (sp.s.length || sp.w.length || sp.d.some(x => x))) break; }
    await inject(o, saveOf(2, sp)); await resume(o);
    const f0 = (await o.st()).f.reduce((a, b) => a + b); const a = await o.box('#bAuto'), u = await o.box('#bUndo');
    await o.tap(a.x, a.y, 30);
    await o.until(async () => (await o.st()).f.reduce((x, y) => x + y) >= f0 + 2, 3000);
    await o.tap(u.x, u.y, 30);
    const fU = await o.until(async () => { const s = await o.st(); const f = s.f.reduce((x, y) => x + y); return s.undoable !== undefined && f; }, 500);
    await sleep(600); const fEnd = (await o.st()).f.reduce((x, y) => x + y);
    t('收牌 chain stops after 悔棋 (found ' + f0 + '->' + fU + '->' + fEnd + ')', fEnd <= fU && fEnd < f0 + collectable(sp)); }
  // 5) hint on the hardest levels: instant known-solution hint, never "走不通" at the start
  for (const n of [100, 97]) {
    await o.page.evaluate(() => { const rm = () => localStorage.removeItem('klondike:current'); addEventListener('pagehide', rm); document.addEventListener('visibilitychange', rm); });
    await o.page.reload(); await startLevel(o, n);
    await o.page.evaluate(() => { window.__toasts = []; const t = document.getElementById('toast'); new MutationObserver(() => window.__toasts.push(t.textContent)).observe(t, { childList: true, characterData: true, subtree: true }); });
    await o.tapSel('#bHint'); const shown = await o.until(async () => (await o.st()).hl, 9000);
    const toasts = await o.page.evaluate(() => window.__toasts);
    t('level ' + n + ' opening hint is shown without a dead-end warning', !!shown && !toasts.some(x => /走不通|想不出/.test(x)));
  }
  // 6) draw-3 waste fan: playable top card is the rightmost, the cards below peek out on its left
  { const p = await o.page.evaluate(() => window.__game.stockPt()); const m = (await o.st()).moves; await o.tap(p.x, p.y); await o.until(async () => (await o.st()).moves > m, 2000); await o.settle();
    const xs = await o.page.evaluate(() => window.__game.wasteXs());
    t('draw-3 fan: top card rightmost, lower ones step left', xs.length === 3 && xs[0] < xs[1] && xs[1] < xs[2]); }
  // 7) after a win, 選擇關卡 -> 返回 goes to the title, not to the empty table
  { const L1 = lvSol(1); let k = 0, sp;
    for (; k < L1.path.length; k++) { sp = replay(L1.st0, L1.path.slice(0, k)); if (!sp.s.length && !sp.w.length && sp.d.every(x => !x) && collectable(sp) >= 1) break; }
    await inject(o, saveOf(1, sp)); await resume(o);
    let col = 0; for (; col < 7; col++) { const cc = sp.t[col]; if (cc.length && C.canFound(sp, cc[cc.length - 1])) break; }
    const q = await o.page.evaluate(([c, i]) => window.__game.srcPt('t', c, i), [col, sp.t[col].length - 1]);
    await o.tap(q.x, q.y);
    await o.until(async () => (await o.st()).status === 'won', 15000);
    t('win overlay shown', await o.until(() => o.page.isVisible('#win'), 20000));
    await sleep(400); // the win card ignores taps for its first 300 ms (ghost-click guard)
    await o.tapSel('#wBack'); await o.until(() => o.page.isVisible('#sBack'));
    await o.tapSel('#sBack');
    t('after a win, back from level select returns to the title', !!(await o.until(() => o.page.isVisible('#tLevels'), 3000)));
    t('level 1 tile shows the best time', /\d:\d\d/.test(await o.page.evaluate(() => { const e = document.querySelector('.lt[data-n="1"] .bt'); return e ? e.textContent : ''; }))); }
  // 8) daily: last 7 days can be played
  { await o.tapSel('#tDaily'); await o.until(() => o.page.isVisible('#dailyPick'));
    t('daily picker lists 7 days', (await o.page.locator('#days .dayb').count()) === 7);
    await o.page.locator('#days .dayb').nth(3).click();
    const s = await o.until(async () => { const v = await o.st(); return v.mode === 'daily' && v; }, 40000);
    t('a past day can be played', !!s); }
  // 8b) draw-3 daily
  { await o.tapSel('#bMenu'); await o.until(() => o.page.isVisible('#mHome')); await o.tapSel('#mHome'); await o.until(() => o.page.isVisible('#tDaily'));
    await o.tapSel('#tDaily'); await o.until(() => o.page.isVisible('#dailyPick'));
    await o.until(() => o.page.evaluate(() => !document.getAnimations().some(a => a.playState === 'running' && a.animationName !== 'sp'))); // card pop-in done
    await o.tapSel('#dDraw button[data-d="3"]');
    await o.until(async () => (await o.page.getAttribute('#dDraw button[data-d="3"]', 'aria-pressed')) === 'true');
    await o.page.locator('#days .dayb').nth(0).click();
    const s = await o.until(async () => { const v = await o.st(); return v.mode === 'daily' && v.draw === 3 && v; }, 40000);
    t('draw-3 daily can be played', !!s); }
  // 8c) ghost clicks: a canvas tap that reveals the win card or the stuck banner must not also press their buttons
  { const card = (r, su) => su * 13 + r - 1;
    const nearWon = () => { const st = C.deal(1, 1, -1); st.t = [[], [], [], [], [], [], []]; st.d = [0, 0, 0, 0, 0, 0, 0]; st.s = []; st.w = [51]; st.f = [13, 13, 13, 12]; return saveOf(1, st, { moves: 50 }); };
    // first find where 下一關 / 選擇關卡 sit on the win card
    await inject(o, nearWon()); await resume(o);
    let p = await o.page.evaluate(() => window.__game.srcPt('w')); await o.tap(p.x, p.y);
    await o.until(() => o.page.isVisible('#win'), 20000);
    const boxes = { wNext: await o.box('#wNext'), wBack: await o.box('#wBack') };
    for (const id of ['wNext', 'wBack']) {
      await inject(o, nearWon()); await resume(o);
      p = await o.page.evaluate(() => window.__game.srcPt('w')); await o.tap(p.x, p.y);
      await o.until(async () => (await o.st()).fx, 8000); // the bouncing-card finale is running
      await o.tap(boxes[id].x, boxes[id].y);
      await o.until(() => o.page.isVisible('#win'), 3000); await sleep(500);
      const s = await o.st();
      t('tap to skip the finale over ' + id + ' keeps the win card', (await o.page.isVisible('#win')) && !(await o.page.isVisible('#select')) && s.n === 1 && s.status === 'won');
    }
    t('win card buttons still work after the guard', await (async () => { await sleep(500); await o.tapSel('#wBack'); return !!(await o.until(() => o.page.isVisible('#select'), 3000)); })());
    // stuck banner popping up under the finger (reviewer's r2/stuck2 position: long K..A run in column 3)
    const run = []; for (let r = 13; r >= 1; r--) run.push(card(r, r % 2 ? 0 : 1));
    const tops = [card(12, 2), card(12, 3), card(10, 2), card(10, 3), card(8, 2), card(8, 3)];
    const rest = []; for (let c = 0; c < 52; c++) if (!run.includes(c) && !tops.includes(c)) rest.push(c);
    const tt = [rest.splice(0, 6).concat(run)], dd = [6]; for (let i = 0; i < 6; i++) { const col = rest.splice(0, i < 3 ? 6 : 5); tt.push(col.concat([tops[i]])); dd.push(col.length); }
    tt[6] = rest.splice(0).concat(tt[6]); dd[6] = tt[6].length - 1; [tt[0], tt[3]] = [tt[3], tt[0]]; [dd[0], dd[3]] = [dd[3], dd[0]];
    const sv = JSON.stringify({ mode: 'endless', n: 0, seed: 1, draw: 1, limit: 0, dateKey: null, st: { t: tt, d: dd, s: [], w: [], f: [0, 0, 0, 0], draw: 1, limit: 0, passes: 0 }, hist: [], score: 0, undoPen: 0, undos: 0, moves: 5, hints: 0, timeMs: 30000, started: true });
    for (const vp of [{ width: 375, height: 500 }, { width: 390, height: 610 }, { width: 667, height: 375 }]) {
      await o.page.setViewportSize(vp); await inject(o, sv); await resume(o);
      const q = await o.page.evaluate(() => window.__game.srcPt('t', 3, 18)); await o.tap(q.x, q.y);
      await o.until(() => o.page.isVisible('#stuck'), 3000); await sleep(600);
      const s = await o.st();
      t('stuck banner under the finger is not pressed at ' + vp.width + 'x' + vp.height + ' (moves ' + s.moves + ')', s.moves === 6 && s.f.join() === '1,0,0,0');
    }
    await o.page.setViewportSize({ width: 390, height: 844 }); }
  // 8d) reload in the middle of auto-finish: the game finishes by itself after 繼續牌局
  { const st = C.deal(1, 1, -1); st.t = [[51, 50], [38], [25], [12], [], [], []]; st.d = [0, 0, 0, 0, 0, 0, 0]; st.s = []; st.w = []; st.f = [12, 12, 12, 11];
    // ♦: f=11 means J♦ played; Q♦(50) under K♦(51)? keep legal order: K♦ on bottom, Q♦ on top
    st.t[0] = [51, 50];
    await inject(o, saveOf(1, st)); await resume(o).catch(() => null);
    t('auto-finish resumes after a reload', !!(await o.until(async () => (await o.st()).status === 'won', 15000))); }
  await o.ctx.close();
  // 9) landscape settings fit on screen
  { const p = await open({ width: 844, height: 390 }); await p.until(() => p.page.isVisible('#tSettings')); await p.tapSel('#tSettings');
    const h = await p.page.evaluate(() => document.querySelector('#settings .card').getBoundingClientRect().height);
    t('landscape settings card fits 390px (' + Math.round(h) + ')', h <= 362);
    await p.ctx.close(); }
  // 10) saved stars from the old level order follow their deal
  { const p = await open(undefined, { 'klondike:progress': JSON.stringify({ best: { 1: { s: 3, sc: 900, t: 100 }, 2: { s: 2, sc: 800, t: 200 }, 95: { s: 1, sc: 100, t: 900 } }, cur: 3, seen: {} }) });
    await p.until(() => p.page.isVisible('#tLevels'));
    const pr = await p.page.evaluate(() => JSON.parse(localStorage.getItem('klondike:progress')));
    const at = seed => LEVELS.findIndex(l => l[0] === seed) + 1;
    t('old progress migrated by seed', pr.lv === 4 && pr.best[at(100491)] && pr.best[at(100491)].s === 3 && pr.best[at(100156)] && pr.best[at(100156)].s === 2 && Object.keys(pr.best).length === 3);
    await p.ctx.close(); }
  // 11) round-2 order (lv 2) also follows its deals
  { const V2 = JSON.parse(html.match(/var V2_SEEDS = (\[[^\]]*\])/)[1]);
    const p = await open(undefined, { 'klondike:progress': JSON.stringify({ best: { 1: { s: 3, sc: 900, t: 100 }, 59: { s: 2, sc: 800, t: 200 } }, cur: 60, seen: {}, lv: 2 }) });
    await p.until(() => p.page.isVisible('#tLevels'));
    const pr = await p.page.evaluate(() => JSON.parse(localStorage.getItem('klondike:progress')));
    const at = seed => LEVELS.findIndex(l => l[0] === seed) + 1;
    t('lv2 progress migrated to lv4 without losing records', pr.lv === 4 && pr.best[at(V2[0])] && pr.best[at(V2[0])].s === 3 && Object.keys(pr.best).length === 2);
    await p.ctx.close(); }
  await browser.close(); server.close();
  t('no page/console errors (' + errors.slice(0, 3).join(' | ') + ')', errors.length === 0);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); process.exit(1); });
