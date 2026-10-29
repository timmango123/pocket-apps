// Rule tests for 象棋暗棋 (banqi). Extracts the engine between CORE markers of ../index.html and checks every rule in the spec.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const BQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BQ;')();
const { mk, MOVE, CAP, FLIP, END, HID } = BQ;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
// code helpers: R(t) red, K(t) black; types 1兵 2炮 3馬 4車 5相 6仕 7帥
const R = t => t, K = t => 8 + t;
const sq = (r, c) => r * 4 + c;
// Build a state: pieces = {sq: code}, hidden = {sq: code-for-pool}, turn
function pos(pieces, turn, v, hidden) {
  const st = BQ.newState(v || {});
  st.b.fill(0); st.pool.fill(0); st.cnt.fill(0); st.alive = [0, 0]; st.hidden = 0; st.turn = turn;
  for (const s in pieces) { const c = pieces[s]; st.b[s] = c; st.cnt[c]++; st.alive[c >> 3]++; }
  for (const s in (hidden || {})) { const c = hidden[s]; st.b[s] = HID; st.pool[c]++; st.cnt[c]++; st.alive[c >> 3]++; st.hidden++; }
  return st;
}
const moves = st => BQ.gen(st, [], false, false);
const has = (st, f, t, k) => moves(st).indexOf(mk(f, t, k)) >= 0;
function gameAt(st, pcol) { const g = new BQ.Game({ seed: 1, v: st.v }); g.st = st; g.pcol = pcol || [0, 1]; g.keys = [BQ.posKey(st)]; return g; }

// --- setup / dealing ---
{
  const d = BQ.newDeal(42), cnt = {};
  d.forEach(c => cnt[c] = (cnt[c] || 0) + 1);
  ok(d.length === 32 && cnt[1] === 5 && cnt[9] === 5 && cnt[7] === 1 && cnt[15] === 1 && cnt[2] === 2 && cnt[14] === 2, '32 pieces: 5 soldiers, 2 of each, 1 general per side');
  ok(JSON.stringify(BQ.newDeal(42)) === JSON.stringify(d) && JSON.stringify(BQ.newDeal(43)) !== JSON.stringify(d), 'seeded shuffle reproducible');
  const st = BQ.newState({}), m = moves(st);
  ok(m.length === 32 && m.every(x => (x >> 10) === FLIP), 'opening: exactly 32 legal actions, all flips');
  let distinct = 0; for (let c = 1; c < 16; c++) if (st.pool[c]) distinct++;
  ok(distinct === 14, 'opening chance node has 14 distinct outcomes');
}
// --- rank captures ---
{
  const t = (a, b) => has(pos({ [sq(3, 1)]: R(a), [sq(3, 2)]: K(b) }, 0), sq(3, 1), sq(3, 2), CAP);
  ok(t(7, 6) && !t(6, 7), '帥 eats 仕; 仕 cannot eat 將');
  ok(t(6, 6) && t(4, 4) && t(3, 3) && t(1, 1), 'equal ranks can capture each other');
  ok(t(5, 4) && t(4, 3) && t(3, 2) && !t(3, 4) && !t(2, 3), 'higher eats lower, lower cannot eat higher (non-cannon)');
  ok(t(1, 7), '兵 eats 將 (exception)');
  ok(!t(7, 1), '帥 cannot eat 卒 (exception)');
  ok(!t(1, 2) && !t(1, 6), '兵 cannot eat other higher pieces');
  ok(!has(pos({ [sq(3, 1)]: R(7), [sq(4, 2)]: K(1) }, 0), sq(3, 1), sq(4, 2), CAP), 'no diagonal capture');
  const s2 = pos({ [sq(3, 1)]: R(7) }, 0, {}, { [sq(3, 2)]: K(1) });
  ok(!moves(s2).some(m => (m >> 10) === CAP), 'cannot capture a hidden piece');
  ok(!has(pos({ [sq(3, 1)]: R(6), [sq(3, 2)]: R(1) }, 0), sq(3, 1), sq(3, 2), CAP), 'cannot capture own piece');
  const s3 = pos({ [sq(3, 1)]: R(4) }, 0);
  ok(moves(s3).length === 4 && !has(s3, sq(3, 1), sq(5, 1), MOVE), 'normal pieces move exactly one step orthogonally');
}
// --- cannon ---
{
  const C = sq(0, 0);
  ok(has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7) }, 0), C, sq(2, 0), CAP), '炮 jumps one screen and eats 將');
  ok(has(pos({ [C]: R(2), [sq(5, 0)]: K(6) }, 0, {}, { [sq(2, 0)]: K(1) }), C, sq(5, 0), CAP), 'hidden piece works as screen, empty squares around are skipped');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(6) }, 0), C, sq(1, 0), CAP), '炮 cannot eat an adjacent piece');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(3), [sq(3, 0)]: K(7) }, 0), C, sq(3, 0), CAP), '炮 cannot jump two screens');
  const s4 = pos({ [C]: R(2), [sq(1, 0)]: K(3) }, 0, {}, { [sq(2, 0)]: K(6) });
  ok(!moves(s4).some(m => (m >> 10) === CAP), '炮 cannot capture a hidden piece');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: R(6) }, 0), C, sq(2, 0), CAP), '炮 cannot capture own piece');
  ok(has(pos({ [C]: R(2), [sq(0, 1)]: R(3), [sq(0, 3)]: K(1) }, 0), C, sq(0, 3), CAP), '炮 captures along a row, own piece as screen');
  const s5 = pos({ [sq(3, 1)]: R(2) }, 0);
  ok(moves(s5).filter(m => (m >> 10) === MOVE).length === 4 && !has(s5, sq(3, 1), sq(5, 1), MOVE), '炮 moves only one step');
  ok(has(pos({ [sq(3, 1)]: R(3), [sq(3, 2)]: K(2) }, 0), sq(3, 1), sq(3, 2), CAP) && !has(pos({ [sq(3, 1)]: R(1), [sq(3, 2)]: K(2) }, 0), sq(3, 1), sq(3, 2), CAP), '炮 is captured by rank>=2 adjacent pieces, not by 兵');
}
// --- variants ---
{
  const v = { noKing: true };
  ok(!has(pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7) }, 0, v), sq(0, 0), sq(2, 0), CAP), 'variant 炮不可吃帥 forbids cannon on general');
  ok(has(pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(6) }, 0, v), sq(0, 0), sq(2, 0), CAP), '…but cannon still eats others');
  const rush = pos({ [sq(0, 0)]: R(4), [sq(4, 0)]: K(3), [sq(6, 0)]: K(1) }, 0, { rush: true });
  ok(has(rush, sq(0, 0), sq(3, 0), MOVE) && has(rush, sq(0, 0), sq(4, 0), CAP) && !has(rush, sq(0, 0), sq(6, 0), CAP), 'variant 車直衝: slides over empties, captures first piece only');
  ok(!has(pos({ [sq(0, 0)]: R(4), [sq(4, 0)]: K(3) }, 0), sq(0, 0), sq(4, 0), CAP), 'without 車直衝 the rook moves one step');
  // chain capture
  const ch = pos({ [sq(2, 1)]: R(4), [sq(2, 2)]: K(3), [sq(2, 3)]: K(2), [sq(7, 3)]: K(1) }, 0, { chain: true });
  BQ.make(ch, mk(sq(2, 1), sq(2, 2), CAP), 0);
  const cm = moves(ch);
  ok(ch.turn === 0 && ch.chain === sq(2, 2) && cm.length === 2 && cm.indexOf(mk(sq(2, 2), sq(2, 3), CAP)) >= 0 && cm.indexOf(mk(sq(2, 2), sq(2, 2), END)) >= 0, 'variant 連吃: same piece may continue capturing or end');
  BQ.make(ch, mk(sq(2, 2), sq(2, 2), END), 0);
  ok(ch.turn === 1 && ch.chain === -1, '結束連吃 passes the turn');
  const nc = pos({ [sq(2, 1)]: R(4), [sq(2, 2)]: K(3), [sq(2, 3)]: K(2), [sq(7, 3)]: K(1) }, 0, {});
  BQ.make(nc, mk(sq(2, 1), sq(2, 2), CAP), 0);
  ok(nc.turn === 1 && nc.chain === -1, 'without 連吃 the turn passes after a capture');
}
// --- color from first flip, turn order ---
{
  for (const first of [0, 1]) {
    const g = new BQ.Game({ seed: 777, v: {}, first });
    ok(g.player() === first, 'first player ' + first + ' moves first');
    const rec = g.play(mk(13, 13, FLIP));
    const col = g.deal[13] >> 3;
    ok(rec && g.pcol[first] === col && g.pcol[1 - first] === 1 - col && g.st.turn === 1 - col && g.player() === 1 - first, 'first flipped piece decides flipper color (first=' + first + ')');
  }
}
// --- win / loss / draw ---
{
  const st = pos({ [sq(0, 0)]: R(7), [sq(0, 1)]: K(3) }, 0);
  const g = gameAt(st); g.play(mk(sq(0, 0), sq(0, 1), CAP));
  ok(g.result && g.result.winner === 0 && g.result.reason === 'all', 'capturing the last enemy piece wins');
  // stuck: black to move, black soldier boxed by red horses, no hidden pieces
  const st2 = pos({ [sq(0, 0)]: K(1), [sq(0, 1)]: R(3), [sq(1, 0)]: R(3), [sq(7, 3)]: R(5), [sq(6, 3)]: R(6) }, 0);
  const g2 = gameAt(st2); g2.play(mk(sq(6, 3), sq(5, 3), MOVE));
  ok(g2.result && g2.result.winner === 0 && g2.result.reason === 'stuck', 'side to move with no legal action loses');
  // not stuck while a hidden piece remains (flip is always possible)
  const st3 = pos({ [sq(0, 0)]: K(1), [sq(0, 1)]: R(3), [sq(1, 0)]: R(3), [sq(7, 3)]: R(5), [sq(6, 3)]: R(6) }, 0, {}, { [sq(4, 2)]: R(2) });
  const g3 = gameAt(st3); g3.play(mk(sq(6, 3), sq(5, 3), MOVE));
  ok(!g3.result, 'a boxed side can still flip, so it is not lost');
  // 50 rounds (100 plies) without flip/capture
  const st4 = pos({ [sq(0, 0)]: R(5), [sq(7, 3)]: K(5) }, 0); st4.np = 99;
  const g4 = gameAt(st4); g4.play(mk(sq(0, 0), sq(1, 0), MOVE));
  ok(g4.result && g4.result.draw && g4.result.reason === 'np', '50 rounds without flip or capture is a draw');
  const st5 = pos({ [sq(0, 0)]: R(5), [sq(7, 3)]: K(5) }, 0, {}, { [sq(4, 1)]: R(1) }); st5.np = 99;
  const g5 = gameAt(st5); g5.play(mk(sq(4, 1), sq(4, 1), FLIP));
  ok(!g5.result && g5.st.np === 0, 'a flip resets the 50-round counter');
  const st6 = pos({ [sq(0, 0)]: R(5), [sq(0, 1)]: K(4), [sq(7, 3)]: K(5) }, 0); st6.np = 99;
  const g6 = gameAt(st6); g6.play(mk(sq(0, 0), sq(0, 1), CAP));
  ok(!g6.result && g6.st.np === 0, 'a capture resets the 50-round counter');
}
// --- long chase (長追) ---
{
  const build = v => gameAt(pos({ [sq(2, 0)]: R(4), [sq(0, 0)]: K(3), [sq(7, 3)]: K(5), [sq(7, 0)]: R(5) }, 0, v));
  const seq = [[8, 4], [0, 1], [4, 5], [1, 0], [5, 4], [0, 1], [4, 5], [1, 0], [5, 4], [0, 1], [4, 5], [1, 0]];
  const g = build({ longChase: true });
  let okSeq = true;
  for (const [f, t] of seq) if (!g.play(mk(f, t, MOVE))) okSeq = false;
  ok(okSeq && g.chase[0].c === 6 && !g.result, 'rook chased the horse 6 times, position repeating, no draw (one-sided chase)');
  ok(g.isForbidden(mk(5, 4, MOVE)) && g.legal().indexOf(mk(5, 4, MOVE)) < 0, '7th repeating chase move is forbidden (長追須變著)');
  ok(g.legal().indexOf(mk(5, 6, MOVE)) >= 0, 'other moves stay legal');
  const g2 = build({ longChase: false });
  for (const [f, t] of seq) g2.play(mk(f, t, MOVE));
  ok(!g2.isForbidden(mk(5, 4, MOVE)), 'with 長追 off the chase continues (50-round rule handles it)');
  // only-forbidden moves -> loss
  const g3 = build({ longChase: true }); for (const [f, t] of seq) g3.play(mk(f, t, MOVE));
  g3.isForbidden = () => true; const r3 = g3.judge();
  ok(r3 && r3.winner === 1 && r3.reason === 'chase', 'if every move is a forbidden chase, the chaser loses');
  // mutual chase threefold -> draw: two rooks chase each other
  const gm = gameAt(pos({ [sq(0, 0)]: R(4), [sq(0, 2)]: K(4), [sq(7, 3)]: K(5), [sq(7, 0)]: R(5) }, 0, { longChase: true }));
  const ms = [[0, 4], [2, 6], [4, 0], [6, 2], [0, 4], [2, 6], [4, 0], [6, 2]];
  let rr = null; for (const [f, t] of ms) { gm.play(mk(f, t, MOVE)); if (gm.result) { rr = gm.result; break; } }
  ok(!rr, 'non-chasing repetition is not a draw by itself');
  // same repetition, but with both sides recorded as chasing (each side's last move attacked an enemy piece) -> draw
  gm.chase = [{ c: 2, t: 1 }, { c: 2, t: 2 }]; const dr = gm.judge();
  ok(dr && dr.draw && dr.reason === 'rep', 'both sides only chasing + 3-fold repetition is a draw');
}
// --- 悔棋 cannot take back a flip (review round 2: undoing a flip re-dealt the hidden pieces, so 翻開→悔棋→再翻 re-rolled the piece) ---
{
  const g = new BQ.Game({ seed: 99, v: {}, first: 0 });
  g.play(mk(10, 10, FLIP)); const c1 = g.st.b[10], d0 = g.deal.join();
  ok(!g.canUndo() && g.undo() === false && g.st.b[10] === c1 && g.log.length === 1 && g.deal.join() === d0, 'a flip cannot be undone: the piece stays revealed and the deal is unchanged');
  // over many games, flipping a square and pressing 悔棋 never changes what is under any square
  let rerolled = 0; for (let i = 0; i < 40; i++) { const h = new BQ.Game({ seed: 1000 + i, v: {}, first: 0 }); const dd = h.deal.join(); h.play(mk(10, 10, FLIP)); h.undo(); h.play(mk(10, 10, FLIP)); if (h.deal.join() !== dd || h.log.length !== 1) rerolled++; }
  ok(rerolled === 0, 'flip + 悔棋 + flip again never re-rolls the piece (' + rerolled + ' of 40 changed)');
  // a plain move can be undone and keeps the deal
  const n = new BQ.Game({ seed: 5, v: {}, first: 0 }); let mv = 0;
  for (let i = 0; i < 60 && !n.result && !mv; i++) { const L = n.legal(); mv = L.find(m => (m >> 10) === MOVE) || 0; if (!mv) n.play(L[(i * 11) % L.length]); }
  const dn = n.deal.join(), kn = BQ.posKey(n.st), ln = n.log.length; n.play(mv);
  ok(mv && n.canUndo() && n.undo() === true && BQ.posKey(n.st) === kn && n.log.length === ln && n.deal.join() === dn, 'a plain move can be undone and keeps the deal');
  // saved games carry the deal (older saves from a version whose 悔棋 re-dealt still load with their deal)
  const r = new BQ.Game({ seed: 5, v: {}, first: 0 }); for (let i = 0; i < 26 && !r.result; i++) { const L = r.legal(); r.play(L[(i * 11) % L.length]); }
  const o1 = r.serialize(), perm = o1.deal.slice(); const hq = []; for (let q = 0; q < 32; q++) if (r.st.b[q] === HID) hq.push(q);
  if (hq.length > 1) { const a = perm[hq[0]]; perm[hq[0]] = perm[hq[1]]; perm[hq[1]] = a; }
  const r2 = BQ.Game.load(JSON.parse(JSON.stringify(Object.assign({}, o1, { deal: perm }))));
  ok(r2 && BQ.posKey(r2.st) === BQ.posKey(r.st) && r2.deal.join() === perm.join(), 'a save with its own (re-dealt) deal reloads to the identical position and deal');
  // an old save (no deal field) still loads from its seed
  const g0 = new BQ.Game({ seed: 99, v: {}, first: 0 }); g0.play(mk(10, 10, FLIP)); g0.play(g0.legal()[0]); const s0 = g0.serialize(); delete s0.deal;
  const g1 = BQ.Game.load(s0); ok(g1 && BQ.posKey(g1.st) === BQ.posKey(g0.st), 'old saves without a deal still load');
  // replay from serialized moves
  for (let i = 0; i < 30 && !g.result; i++) { const L = g.legal(); g.play(L[(i * 7) % L.length]); }
  const g2 = BQ.Game.load(JSON.parse(JSON.stringify(g.serialize())));
  ok(g2 && BQ.posKey(g2.st) === BQ.posKey(g.st) && g2.st.np === g.st.np, 'saved game replays to the identical position');
}
// --- engine fairness: decision depends only on the public state ---
{
  const sq0 = 5; let a = null, b = null;
  for (let s = 1; s < 5000 && !b; s++) { const d = BQ.newDeal(s); if (!a) { a = { s, d }; continue; } if (d[sq0] === a.d[sq0] && d.join() !== a.d.join()) b = { s, d }; }
  const gA = new BQ.Game({ seed: a.s, v: {} }), gB = new BQ.Game({ seed: b.s, v: {} });
  gA.play(mk(sq0, sq0, FLIP)); gB.play(mk(sq0, sq0, FLIP));
  const pA = gA.publicState(), pB = gB.publicState();
  ok(!('deal' in pA) && pA.b.filter(x => x === HID).length === 31, 'public state handed to the engine has no deal, hidden squares are opaque');
  const o = { depth: 3, ms: 100000, seed: 5, fk: 6 };
  const rA = BQ.think(pA, o), rB = BQ.think(pB, o);
  ok(gA.deal.join() !== gB.deal.join() && rA.move === rB.move && rA.score === rB.score, 'engine picks the same move for two different hidden deals with the same public view');
}
// --- engine sanity: takes a free general, levels answer within budget ---
{
  const st = pos({ [sq(3, 1)]: R(1), [sq(3, 2)]: K(7), [sq(7, 3)]: K(1), [sq(0, 0)]: R(1) }, 0);
  ok(BQ.think(st, { depth: 3, ms: 2000 }).move === mk(sq(3, 1), sq(3, 2), CAP), 'engine has the soldier take the general');
  const st2 = pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7), [sq(7, 3)]: K(1), [sq(6, 3)]: R(5) }, 0);
  ok(BQ.think(st2, { depth: 3, ms: 2000 }).move === mk(sq(0, 0), sq(2, 0), CAP), 'engine finds the cannon jump onto the general');
  // a midgame position from a real game
  const g = new BQ.Game({ seed: 2026, v: {} });
  for (let i = 0; i < 24 && !g.result; i++) { const r = BQ.think(g.publicState(), { depth: 2, ms: 200, seed: i }); g.play(r.move); }
  const times = [];
  for (let L = 1; L <= 5; L++) {
    const lv = Object.assign({}, BQ.LEVELS[L], { seed: 1 });
    const r = BQ.think(g.publicState(), lv);
    times.push('Lv' + L + ' ' + r.ms + 'ms d' + r.depth);
    // generous margin (x1.5) so a loaded CI machine does not fail it; the search itself stops at lv.ms
    ok(r.ms <= lv.ms * 1.5 + 50, 'Lv' + L + ' answers within its time budget (' + r.ms + 'ms of ' + lv.ms + ')');
  }
  console.log('think times on a midgame position:', times.join(', '));
}
// --- levels: each level is at least as strong as the one below (fixed by the 2026-10-25 review: re-tuned to remove difficulty walls) ---
{
  const L = BQ.LEVELS; let mono = true;
  for (let i = 2; i <= 5; i++) if (L[i].depth < L[i - 1].depth || (L[i].mistake || 0) > (L[i - 1].mistake || 0) && L[i].depth === L[i - 1].depth) mono = false;
  ok(L.length === 6 && mono && L[5].depth >= 40 && !L[5].wild && L[5].mistake <= 0.2 && L[5].ms <= 2000, 'five levels, strength never drops from one level to the next, Lv5 searches to its time limit and never plays a random move (softened in round 2: 2 s, second-best 16%)');
  ok(!/scale\(0\.45/.test(html), 'menu logo pieces are not squashed (no 0.45 x-scale)');
}

// ---------------- in the real page (mobile Chromium, real CDP touch): one regression check per review finding ----------------
const APP = path.resolve(__dirname, '..', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let browser = null, tid = 1;
async function at(name, fn) {
  const t0 = Date.now(); let tm;
  try { await Promise.race([fn(), new Promise((_, no) => { tm = setTimeout(() => no(new Error('no result after 45 s')), 45000); })]); clearTimeout(tm); console.log('  ok  ', name, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)'); }
  catch (e) { clearTimeout(tm); fail++; console.log('FAIL', name, '-', String(e.message || e).split('\n')[0]); }
}
async function open(vp, o = {}) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
  if (o.ls) await ctx.addInitScript(ls => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', 1); for (const k in ls) localStorage.setItem(k, ls[k]); } }, o.ls);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await page.waitForFunction(() => window.__banqi && window.__banqi.info());
  const cdp = await ctx.newCDPSession(page);
  const tap = async (x, y, hold = 40) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid++ }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  // wait for the panel's pop-in animation to end first (a box measured mid-scale is off by up to ~35px at the card's edge)
  const settle = sel => page.waitForFunction(sel => { const e = document.querySelector(sel), c = e && e.closest('.card'); return !c || c.getAnimations().every(a => a.playState !== 'running'); }, sel, { timeout: 5000 }).catch(() => {});
  const tapSel = async sel => { await settle(sel); const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('not visible: ' + sel); await tap(b.x + b.width / 2, b.y + b.height / 2); await sleep(120); };
  const info = () => page.evaluate(() => window.__banqi.info());
  const tapSq = async q => { const c = await page.evaluate(q => window.__banqi.center(q), q); await tap(c.x, c.y); };
  const waitHuman = () => page.waitForFunction(() => { const i = window.__banqi.info(); return i.human && !i.busy; }, null, { timeout: 30000 });
  const vis = id => page.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
  const ls = k => page.evaluate(k => JSON.parse(localStorage.getItem('banqi.' + k) || 'null'), k);
  return { ctx, page, cdp, errors, tap, tapSel, info, tapSq, waitHuman, vis, ls, close: () => ctx.close() };
}
const hiddenSq = (i, not = []) => { for (const q of [13, 18, 22, 9, 26, 5, 1, 30, 2, 17, 21, 10, 6, 25, 14, 29]) if (i.st.b[q] === HID && not.indexOf(q) < 0) return q; return i.st.b.indexOf(HID); };
// a saved, unfinished game (human = seat 0, the computer flipped first) found by quick engine self-play; pick(g) says when to stop
function findSave(pick, seed0) {
  for (let seed = seed0; seed < seed0 + 400; seed++) {
    const g = new BQ.Game({ seed, v: { chain: false, noKing: false, rush: false, longChase: true }, first: 1 });
    for (let ply = 0; ply < 400 && !g.result; ply++) {
      if (g.player() === 0 && g.st.turn >= 0) { const r = pick(g); if (r) return Object.assign({ save: JSON.stringify({ s: g.serialize(), mode: 'ai', level: 1, daily: null, hints: 0, t0: Date.now() }) }, r); }
      const t = BQ.think(g.publicState(), { depth: 1, ms: 50, seed: seed * 1000 + ply, mistake: 0.3, wild: true, rep: g.repKeys(), forbid: g.forbidden() });
      g.play(t.move);
    }
  }
  return null;
}
async function browserTests() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  browser = await chromium.launch();
  console.log('Page (mobile Chromium, touch)');
  try {
    await at('save is written as soon as a move is played (before its animation ends); 悔棋 cannot take back a flip and is off while the computer thinks', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#lvBtns button[data-l="1"]'); await s.tapSel('#segFirst button[data-v="me"]'); await s.tapSel('#bStart'); await s.waitHuman();
      await s.tapSq(13); await sleep(20);
      const sv = await s.ls('game'); ok(sv && sv.s.moves.length === 1 && sv.s.deal && sv.s.deal.length === 32 && sv.moved === true, 'saved (with moved) during the flip animation: ' + (sv && [sv.s.moves.length, sv.moved]));
      // the computer's reply: 悔棋 is disabled for the whole time it thinks
      const th = await s.page.waitForFunction(() => { const i = window.__banqi.info(); return i.thinking || (i.human && !i.busy) ? i : false; }, null, { polling: 'raf', timeout: 30000 }).then(x => x.jsonValue());
      ok(!th.thinking || th.undoOff, '悔棋 disabled while the computer thinks: ' + JSON.stringify([th.thinking, th.undoOff]));
      await s.waitHuman();
      const i0 = await s.info(), d0 = await s.page.evaluate(() => window.__banqi.deal());
      await s.tapSel('#bUndo'); await sleep(100);
      const i1 = await s.info(), d1 = await s.page.evaluate(() => window.__banqi.deal());
      ok(i1.plies === i0.plies && i1.st.b[13] === i0.st.b[13] && i1.st.b[13] !== HID && d1.join() === d0.join() && i1.undos === 0, 'a flip is not taken back and nothing is re-dealt');
      ok(/翻開的棋不能收回/.test(await s.page.textContent('#toast')), 'toast explains: ' + await s.page.textContent('#toast'));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    const nf = findSave(g => g.st.hidden === 0 && g.st.alive[0] > 2 && g.st.alive[1] > 2 ? (m => m ? { m } : null)(g.legal().find(m => (m >> 10) === MOVE)) : null, 300);
    await at('悔棋 takes back a move and the computer\'s reply (no face-down pieces left, so nothing to re-roll)', async () => {
      ok(!!nf, 'found a position with every piece revealed'); if (!nf) return;
      const s = await open({ width: 390, height: 844 }, { ls: { 'banqi.game': nf.save } });
      await s.tapSel('#bResume'); await s.waitHuman();
      const i0 = await s.info(), f = nf.m & 31, t = (nf.m >> 5) & 31;
      await s.tapSq(f); await sleep(120); await s.tapSq(t);
      const th = await s.page.waitForFunction(p => { const i = window.__banqi.info(); return i.plies > p && (i.thinking || (i.human && !i.busy) || i.result) ? i : false; }, i0.plies, { polling: 'raf', timeout: 30000 }).then(x => x.jsonValue());
      ok(!th.thinking || th.undoOff, '悔棋 disabled while the computer thinks');
      await s.waitHuman().catch(() => {});
      const i1 = await s.info();
      if (!i1.result) { await s.tapSel('#bUndo'); await s.waitHuman(); }
      const i2 = await s.info();
      ok(i1.result || (i2.plies === i0.plies && JSON.stringify(i2.st.b) === JSON.stringify(i0.st.b) && i2.undos === 1), '悔棋 restored the position before your move: ' + [i0.plies, i1.plies, i2.plies]);
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('two players on one phone: a tap during your own move is not played as the other player\'s move', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#segMode button[data-v="pvp"]'); await s.tapSel('#bStart');
      await s.page.waitForFunction(() => { const i = window.__banqi.info(); return i.mode === 'pvp' && i.human && !i.busy; });
      let caught = false, carried = 0;
      for (let k = 0; k < 8 && !caught; k++) {
        const i0 = await s.info(), a = hiddenSq(i0), b = hiddenSq(i0, [a]), ca = await s.page.evaluate(q => window.__banqi.center(q), a), cb = await s.page.evaluate(q => window.__banqi.center(q), b);
        // flip a, and tap b straight after (inside the 260 ms flip animation unless the machine stalls; retried if it lands later)
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ca.x, y: ca.y, id: tid++ }] });
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cb.x, y: cb.y, id: tid++ }] });
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const i1 = await s.info();
        await s.page.waitForFunction(() => { const i = window.__banqi.info(); return !i.busy; }, null, { timeout: 10000 }); await sleep(150);
        const i2 = await s.info();
        if (i1.queuedTaps > i0.queuedTaps) { caught = true; if (i2.st.b[b] !== HID || i2.plies !== i0.plies + 1) carried++; }
        else if (i2.st.b[b] !== HID) { /* the second tap came after the animation: a normal move by the other player */ }
      }
      ok(caught, 'a tap landed during the flip animation');
      ok(carried === 0, 'that tap was not played for the other player');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('leaving a game you moved in counts as a loss even when the history is empty (persisted moved flag)', async () => {
      const g = new BQ.Game({ seed: 4242, v: { chain: false, noKing: false, rush: false, longChase: true }, first: 0 });
      const save = JSON.stringify({ s: g.serialize(), mode: 'ai', level: 2, daily: null, hints: 0, undos: 3, moved: true, t0: Date.now() });
      const s = await open({ width: 390, height: 844 }, { ls: { 'banqi.game': save } });
      ok(await s.vis('home') && !(await s.page.evaluate(() => document.getElementById('bResume').classList.contains('hidden'))), '繼續上一局 offered');
      await s.tapSel('#bStart'); ok(await s.vis('confirm') && /敗局/.test(await s.page.textContent('#cfP')), '開始對局 warns it counts as a loss');
      await s.tapSel('#cfOk'); await sleep(200);
      const st = await s.ls('stats'); ok(st && st.l === 1 && st.lv[2].l === 1, 'recorded as a loss: ' + JSON.stringify(st && [st.l, st.lv]));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('a tap made while the computer\'s piece is still moving is kept and played when it lands', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#lvBtns button[data-l="1"]'); await s.tapSel('#segFirst button[data-v="me"]'); await s.tapSel('#bStart'); await s.waitHuman();
      // the finger goes down while the computer is thinking and lifts while its piece is moving (a tap acts on pointerup), so only one
      // input event has to land inside the 150-450 ms animation even on a loaded machine
      let done = false;
      for (let k = 0; k < 10 && !done; k++) {
        const i0 = await s.info(); if (i0.result) break;
        await s.tapSq(hiddenSq(i0)); await s.page.waitForFunction(p => window.__banqi.info().plies > p, i0.plies);
        const th = await s.page.waitForFunction(() => { const i = window.__banqi.info(); return i.thinking || i.result || (i.human && !i.busy) ? i : false; }, null, { polling: 'raf', timeout: 30000 }).then(x => x.jsonValue());
        if (!th.thinking) { await s.waitHuman().catch(() => {}); continue; }
        const q = hiddenSq(th, [13]), c = await s.page.evaluate(q => window.__banqi.center(q), q), q0 = th.queuedTaps;
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y, id: 900 + k }] });
        const h = await s.page.waitForFunction(p => { const i = window.__banqi.info(); return (i.plies > p && !i.thinking) || i.result ? i : false; }, th.plies, { polling: 'raf', timeout: 30000 }).then(x => x.jsonValue());
        await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const after = await s.info();
        if (h.result || after.queuedTaps === q0 || h.st.b[q] !== HID) { await s.waitHuman().catch(() => {}); continue; } // lifted after the move landed: try again
        await s.page.waitForFunction(p => window.__banqi.info().plies > p, h.plies, { timeout: 5000 });
        ok((await s.info()).st.b[q] !== HID, 'the queued tap flipped square ' + q);
        done = true;
      }
      ok(done, 'caught the computer\'s move animation and queued a tap');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('menu: 繼續上一局 is the main button; 開始對局 and 新局 ask first, and abandoning a game you moved in counts as a loss', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#lvBtns button[data-l="1"]'); await s.tapSel('#segFirst button[data-v="me"]'); await s.tapSel('#bStart'); await s.waitHuman();
      await s.tapSq(13); await s.waitHuman();
      await s.page.reload(); await s.page.waitForFunction(() => window.__banqi && window.__banqi.info());
      const h = await s.page.evaluate(() => { const r = document.getElementById('bResume'), st = document.getElementById('bStart'); return { vis: !r.classList.contains('hidden'), above: r.getBoundingClientRect().top < st.getBoundingClientRect().top, sec: st.classList.contains('sec') && !r.classList.contains('sec') }; });
      ok(h.vis && h.above && h.sec, 'resume primary and on top: ' + JSON.stringify(h));
      const st0 = (await s.ls('stats')) || {};
      await s.tapSel('#bStart'); ok(await s.vis('confirm'), '開始對局 asks before replacing the game');
      ok(/敗局/.test(await s.page.textContent('#cfP')), 'confirm says it counts as a loss');
      await s.tapSel('#confirm [data-close]'); ok(await s.vis('home'), 'cancel goes back to the menu'); ok(((await s.ls('game')) || { s: { moves: [] } }).s.moves.length >= 2, 'game kept');
      await s.tapSel('#bResume'); await s.waitHuman();
      await s.tapSel('#bNew'); ok(await s.vis('confirm') && /敗局/.test(await s.page.textContent('#cfP')), '新局 confirm says 敗局');
      await s.tapSel('#cfOk'); await sleep(200);
      const st1 = await s.ls('stats');
      ok(st1.games === (st0.games || 0) + 1 && st1.l === (st0.l || 0) + 1 && st1.lv[1].l === 1 && st1.streak === 0, 'abandon recorded as a loss: ' + JSON.stringify([st1.games, st1.l, st1.lv]));
      // a fresh game with no move of yours is not counted
      await s.tapSel('#bNew'); await sleep(150); ok(!(await s.vis('confirm')), 'no confirm for an untouched game');
      ok((await s.ls('stats')).games === st1.games, 'untouched game not counted');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    const nw = findSave(g => { if (g.st.alive[1 - g.st.turn] !== 1) return null; const m = g.legal().find(m => (m >> 10) === CAP); if (!m) return null;
      const aiFirst = g.log[0].code & 7, mine = g.log.find(r => r.player === 0 && (r.m >> 10) === FLIP); if (!mine || (mine.code & 7) === aiFirst) return null; return { m, mineFirst: mine.code & 7, aiFirst, took: g.log.filter(r => r.victim && r.player === 0).length }; }, 100);
    await at('winning: reason from the loser\'s side, first-flip stat counts only your flip, streak and level achievements, captured pieces readable', async () => {
      ok(!!nw, 'found a near-win position'); if (!nw) return;
      const s = await open({ width: 360, height: 640 }, { ls: { 'banqi.game': nw.save } });
      await s.tapSel('#bResume'); await s.waitHuman();
      // captured pieces: no piece covers more than 4px of its neighbour in the same row
      const ov = await s.page.$$eval('#k0 i', is => { let worst = 0; const r = is.map(i => i.getBoundingClientRect()); for (let a = 0; a < r.length; a++) for (let b = 0; b < r.length; b++) if (a !== b && Math.abs(r[a].top - r[b].top) < 2) { const o = Math.min(r[a].right, r[b].right) - Math.max(r[a].left, r[b].left); if (o > worst) worst = o; } return [is.length, worst]; });
      ok(ov[0] === nw.took && ov[1] <= 4.5, 'captured pieces overlap ' + ov[1] + 'px (' + ov[0] + ' pieces)');
      const fit = await s.page.evaluate(() => ['bSet', 'k0', 'k1', 'bSnd'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().right)).concat(innerWidth));
      ok(fit.slice(0, 4).every(r => r <= fit[4]), 'a long row of captured pieces does not push the bar off screen: ' + fit);
      const f = nw.m & 31, t = (nw.m >> 5) & 31; await s.tapSq(f); await sleep(120); await s.tapSq(t);
      await s.page.waitForFunction(() => !document.getElementById('result').classList.contains('hidden'), null, { timeout: 15000 });
      ok((await s.page.textContent('#rWhy')).startsWith('對方的棋子被吃光了'), 'why: ' + await s.page.textContent('#rWhy'));
      const st = await s.ls('stats');
      ok(st.w === 1 && st.first[nw.mineFirst] === 1 && !st.first[nw.aiFirst], 'first-flip stat counts only your own flip: ' + JSON.stringify(st.first));
      ok(st.streak === 1 && st.best === 1 && st.ach.win1, 'streak and 初出茅廬 recorded');
      ok(!(await s.ls('game')), 'finished game removed from the save');
      ok(await s.page.evaluate(() => window.__banqi.spriteCount()) <= 16, 'one cached sprite per piece (animations scale it)');
      const rs = await s.page.evaluate(() => [window.__banqi.reasonText({ winner: 1, reason: 'all' }, 0, 'ai'), window.__banqi.reasonText({ winner: 1, reason: 'stuck' }, 0, 'ai'), window.__banqi.reasonText({ winner: 1, reason: 'chase' }, 0, 'ai'), window.__banqi.reasonText({ winner: 0, reason: 'stuck' }, 1, 'ai'), window.__banqi.reasonText({ winner: 0, reason: 'all' }, 1, 'pvp')]);
      ok(rs.join('|') === '你的棋子被吃光了|你沒有棋可以動，判負|你長追不變著，判負|對方沒有棋可以動，判負|玩家二的棋子被吃光了', 'loss reasons: ' + rs.join('|'));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    const bl = findSave(g => { const b = g.st.b, me = g.st.turn;
      for (let f = 0; f < 32; f++) { if (b[f] === HID || !b[f] || (b[f] >> 3) !== me || (b[f] & 7) !== 1) continue;
        for (const t of BQ.ADJ[f]) { const q = b[t]; if (q && q !== HID && (q >> 3) !== me && (q & 7) !== 1 && (q & 7) !== 7) return { f, t }; } }
      return null; }, 500);
    await at('a capture that is not allowed explains why (兵 next to a bigger piece) and keeps the selection', async () => {
      ok(!!bl, 'found a soldier next to a bigger enemy piece'); if (!bl) return;
      const s = await open({ width: 390, height: 844 }, { ls: { 'banqi.game': bl.save } });
      await s.tapSel('#bResume'); await s.waitHuman();
      await s.tapSq(bl.f); await sleep(120); await s.tapSq(bl.t); await sleep(120);
      ok((await s.page.textContent('#toast')) === '兵卒只能吃兵卒和帥將', 'toast: ' + await s.page.textContent('#toast'));
      ok(await s.page.evaluate(() => window.__banqi.sel()) === bl.f, 'selection kept');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('layout: short frame turns the board to 8x4 with >=44px squares; menu fits without scrolling; landscape shows the level', async () => {
      for (const [w, h] of [[375, 500], [360, 640], [667, 375]]) {
        const s = await open({ width: w, height: h });
        const m = await s.page.evaluate(() => { const b = id => document.getElementById(id).getBoundingClientRect(); return { links: b('lRules').bottom, start: b('bStart').bottom, vh: innerHeight, sw: document.documentElement.scrollWidth }; });
        ok(m.links <= m.vh && m.start <= m.vh && m.sw <= w, w + 'x' + h + ' menu fits: ' + JSON.stringify(m));
        await s.tapSel('#bStart'); await sleep(150);
        const i = await s.info();
        if (w === 375) ok(i.rot && i.cell >= 44, '375x500 board ' + (i.rot ? '8x4' : '4x8') + ' cell ' + i.cell);
        if (w > h) { const c = await s.page.evaluate(() => document.getElementById('cnt').getBoundingClientRect().height); ok(c >= 44, w + 'x' + h + ' 和局倒數/暗子 button is ' + c + 'px high'); }
        if (w > h) { const t = await s.page.evaluate(() => { const e = document.querySelector('#ttl span'); return [e.textContent, e.scrollHeight <= e.clientHeight + 1, e.getBoundingClientRect().width]; }); ok(/Lv\d/.test(t[0]) && t[1] && t[2] > 100, w + 'x' + h + ' sidebar title readable: ' + JSON.stringify(t)); }
        ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
      }
    });
    await at('375x500 menu with a game to resume fits without scrolling; level texts use plain words', async () => {
      const s = await open({ width: 375, height: 500 }, { ls: { 'banqi.game': nw ? nw.save : bl.save } });
      const descs = [];
      for (const l of [1, 2, 3, 4, 5]) { await s.tapSel('#lvBtns button[data-l="' + l + '"]'); descs.push(await s.page.textContent('#lvDesc')); }
      await s.page.waitForFunction(() => document.querySelector('#home .card').getAnimations().every(a => a.playState !== 'running'));
      const m = await s.page.evaluate(() => { const h = document.getElementById('home'); return { resume: !document.getElementById('bResume').classList.contains('hidden'), links: document.getElementById('lRules').getBoundingClientRect().bottom, card: document.querySelector('#home .card').getBoundingClientRect().bottom, sh: h.scrollHeight, ch: h.clientHeight, vh: innerHeight }; });
      ok(m.resume && m.card <= m.vh && m.links <= m.vh && m.sh <= m.ch + 1, 'menu fits: ' + JSON.stringify(m));
      ok(descs.every(d => !/ms|每手約|迭代/.test(d)), 'level descriptions: ' + descs.join(' / '));
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('settings: theme switch (auto / light / dark) and a 看規則 entry that returns to settings', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#bStart'); await sleep(150); await s.tapSel('#bSet');
      await s.tapSel('#segTheme button[data-v="dark"]');
      const d = await s.page.evaluate(() => [document.documentElement.getAttribute('data-theme'), getComputedStyle(document.querySelector('#setp .card')).backgroundColor]);
      ok(d[0] === 'dark' && d[1] === 'rgb(42, 29, 20)', 'dark theme applied: ' + d);
      await s.tapSel('#setRules'); ok(await s.vis('rules'), 'rules opened from settings');
      await s.tapSel('#rules [data-close]'); ok(await s.vis('setp') && !(await s.vis('rules')), 'closing rules returns to settings');
      await s.page.reload(); await s.page.waitForFunction(() => window.__banqi && window.__banqi.info());
      ok(await s.page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'theme kept after reload');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
    await at('daily deal counts once: the first game is recorded (abandon = loss), replaying it the same day is practice', async () => {
      const s = await open({ width: 390, height: 844 });
      await s.tapSel('#lvBtns button[data-l="1"]'); await s.tapSel('#segFirst button[data-v="me"]'); await s.tapSel('#swDaily'); await s.tapSel('#bStart'); await s.waitHuman();
      await s.tapSq(13); await s.waitHuman();
      const sd = await s.ls('stats'); ok(sd && Object.values(sd.daily || {}).join() === 's', 'the daily deal is marked as started at your first move: ' + JSON.stringify(sd && sd.daily));
      await s.tapSel('#bHome'); await s.tapSel('#bStart'); await s.tapSel('#cfOk'); await sleep(250);
      const st = await s.ls('stats'), day = Object.keys(st.daily)[0];
      ok(st.l === 1 && day && st.daily[day] === 'l', 'first daily game abandoned = loss: ' + JSON.stringify(st.daily));
      const i = await s.info(); ok(i.practice, 'second daily game today is practice');
      ok(/練習/.test(await s.page.textContent('#toast')), 'toast says practice');
      await s.tapSq(13); await s.waitHuman(); await s.tapSel('#bNew'); ok(!/敗局/.test(await s.page.textContent('#cfP')), 'practice abandon is not a loss'); await s.tapSel('#cfOk'); await sleep(200);
      ok((await s.ls('stats')).games === 1, 'practice game not counted');
      ok(s.errors.length === 0, 'errors: ' + s.errors.join(' | ')); await s.close();
    });
  } finally { await browser.close(); }
}
(async () => {
  if (!process.env.NO_BROWSER) { const t0 = Date.now(); await browserTests(); console.log('page checks', ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
