// 安提基特拉 (antikythera) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...]
// Reads state via window.__antikythera getters (level / placement / ev / pegScreen); acts only via CDP touch
// (tap tray token -> tap peg, tap placed gear to flip, drag gear off the board to remove, tap 復原 to undo the last move).
// 2026-10-25 game changes it copes with: a tap between crowded pegs magnifies instead of placing (tap again), the clock
// runs from load, every third level from 21 has a fixed (locked) gear, and 3 free undos per attempt.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const { K, candidates, solveDFS } = require('./solver');
const APP = path.resolve(__dirname, '../../../apps/antikythera/index.html');

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const SOFT_CAP = 120000;

// precompute world-tier plans (offline "thinking" so the shared Node thread doesn't stall live tiers)
const LV = {}, PLAN = {};
const CACHE = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'plan-cache.json'), 'utf8')); } catch (e) { return {}; } })();
// start position as a player who has read the board sees it: fixed gears on, the rusted gear on its right side
const lockedMap = L => { const m = new Map(); for (const k of [...(L.locked || []), ...(L.rusted || [])]) m.set(k.peg, { piece: L.pieces.find(p => p.id === k.piece), orient: k.orient }); return m; };
const LOCKED = {}, FIXED = {}, RUSTED = {}; // LOCKED: can't be taken off (fixed + rusted); FIXED: can't be touched at all
// planning time a human spends after closing the hint card, before the first gear, per required move (s);
// the clock is already running then. Superhuman sees the answer at once.
const PLAN_S = { clumsy: 1.0, casual: 1.2, skilled: 2.0, world: 1.5, superhuman: 0 };
// skilled = SPEC heuristic: greedy with a real 2-step lookahead (no whole-board search); world plans the whole
// train (plan-cache.json, DFS) but pays PLAN_S time for it against the clock.
for (const n of TEST_LEVELS) {
  LV[n] = K.getLevel(n);
  FIXED[n] = new Set((LV[n].locked || []).map(k => k.peg)); RUSTED[n] = new Set((LV[n].rusted || []).map(k => k.peg));
  LOCKED[n] = new Set([...FIXED[n], ...RUSTED[n]]);
  PLAN[n] = CACHE[n] && (CACHE[n].k ?? null) === (LV[n].k ?? null) ? CACHE[n].plan : solveDFS(LV[n], lockedMap(LV[n]), 300000).plan;
}

async function obs(page) {
  return page.evaluate(() => {
    const A = window.__antikythera, L = A.level;
    const pl = [...A.placement.entries()].map(([k, v]) => [k, v.piece.id, v.orient]);
    const hid = id => document.getElementById(id).hidden;
    return { pegs: L.pegs.length, name: L.name, pl, win: !!(A.ev && A.ev.win), jammed: !!(A.ev && A.ev.jammed), failed: !hid('failOv'), winOv: !hid('winOv'),
      moves: document.getElementById('movesTxt').textContent, time: document.getElementById('timeTxt').textContent,
      sel: (document.querySelector('.token[aria-pressed="true"]') || {}).dataset?.id ?? null,
      zoom: A.view.zoom, undoOk: !document.getElementById('undoBtn').disabled };
  });
}
function toMap(L, pl) { const m = new Map(); for (const [peg, id, o] of pl) m.set(peg, { piece: L.pieces.find(p => p.id === id), orient: o }); return m; }

async function ensureTokenVisible(P, id) {
  for (let i = 0; i < 8; i++) {
    const r = await P.page.evaluate(id => {
      const t = document.querySelector(`.token[data-id="${id}"]`), tr = document.getElementById('tray');
      if (!t) return null; const a = t.getBoundingClientRect(), b = tr.getBoundingClientRect();
      return { x: a.left + a.width / 2, y: a.top + a.height / 2, w: a.width, l: b.left, r: b.right, cy: b.top + b.height / 2 };
    }, id);
    if (!r) return null;
    if (r.x - r.w / 2 >= r.l - 2 && r.x + r.w / 2 <= r.r + 2) {
      // after a fling the tray keeps gliding: look again until the gear stops moving
      await H.sleep(P.superhuman ? 50 : 120);
      const r2 = await P.page.evaluate(id => { const t = document.querySelector(`.token[data-id="${id}"]`); const a = t.getBoundingClientRect(); return a.left + a.width / 2; }, id);
      if (Math.abs(r2 - r.x) < 1) return r;
      continue;
    }
    // swipe the tray sideways (starting on whatever token is in the middle)
    const dir = r.x > (r.l + r.r) / 2 ? -1 : 1, dist = Math.max(60, Math.min(220, Math.abs(r.x - (r.l + r.r) / 2))) * dir;
    await P.swipe((r.l + r.r) / 2, r.cy, dist, 0, { exact: P.tierId !== 'clumsy', steps: 8 });
    P.scrolls = (P.scrolls || 0) + 1;
    await H.sleep(P.superhuman ? 250 : 450);
  }
  return null;
}

// skilled repair heuristic (one step deep, no search): when a dial reads wrong or nothing more meshes, try
// exchanging ONE placed gear for one from the box and keep the exchange that fixes the most dials
const pkey = pm => [...pm].map(([k, v]) => k + ':' + v.piece.id + ':' + v.orient).sort().join(',');
const stateScore = (L, ev) => L.outputs.reduce((s, o, i) => s + (ev.outs[i].ok ? 3 : ev.outs[i].ratio ? -4 : 0), 0);
function swapRepair(L, pm, lk, seen) {
  const base = stateScore(L, K.evaluate(L, pm)) + (candidates(L, pm).length ? 1 : 0);
  const used = new Set([...pm.values()].map(v => v.piece.id)); let best = null, bs = base;
  for (const [peg] of pm) {
    if (lk.has(peg)) continue;
    for (const q of L.pieces) {
      if (used.has(q.id)) continue;
      for (const o of [0, 1]) {
        const p2 = new Map(pm); p2.set(peg, { piece: q, orient: o });
        if (seen.has(pkey(p2))) continue;
        const e = K.evaluate(L, p2); if (e.jammed) continue;
        let sc = stateScore(L, e); if (sc + 1 <= bs) continue;
        sc += candidates(L, p2).length ? 1 : 0;
        if (sc > bs) { bs = sc; best = { peg, pieceId: q.id, orient: o }; }
      }
    }
  }
  return best;
}
function decide(P, n, L, pm, ctx) {
  const evv = K.evaluate(L, pm);
  ctx.seen.add(pkey(pm));
  // the game picked the other layer for the gear just placed: flip it to the side that was meant (before judging jams)
  if (ctx.intended) { const it = ctx.intended; ctx.intended = null; const v = pm.get(it.peg); if (v && v.piece.id === it.pieceId && v.orient !== it.orient) return { type: 'flip', peg: it.peg, why: 'layer' }; }
  // second half of a swap: the old gear is off, put the new one on
  if (ctx.pendingPlace) { const pp = ctx.pendingPlace; ctx.pendingPlace = null; if (!pm.has(pp.peg)) return { type: 'place', ...pp, why: 'swap' }; }
  // repair first: jammed, or an output dial showing a wrong ratio -> remove the most recent offending gear
  const badOut = L.outputs.some((o, i) => evv.outs[i].ratio && !evv.outs[i].ok);
  const lk = LOCKED[n];
  // the hint card says the rusted gear sits on the wrong layer: flip it first
  for (const k of L.rusted || []) { const v = pm.get(k.peg); if (v && v.orient === k.wrong && !ctx.rustFlipped) { ctx.rustFlipped = true; return { type: 'flip', peg: k.peg, why: 'rust' }; } }
  // later on: flip it again only if that makes it turn (or clears a jam / a wrong dial)
  for (const rp of RUSTED[n]) {
    const v = pm.get(rp); if (!v) continue;
    const p2 = new Map(pm); p2.set(rp, { piece: v.piece, orient: v.orient ? 0 : 1 });
    const e1 = evv, e2 = K.evaluate(L, p2);
    const val = e => (e.jammed ? -10 : 0) + (e.pegInfo.get(rp) && e.pegInfo.get(rp).ratio ? 2 : 0) + L.outputs.reduce((a, o, i) => a + (e.outs[i].ok ? 3 : e.outs[i].ratio ? -3 : 0), 0);
    if (val(e2) > val(e1)) return { type: 'flip', peg: rp, why: 'rust' };
  }
  if (badOut && P.tierId === 'skilled') {
    const sw = swapRepair(L, pm, lk, ctx.seen);
    if (sw) { ctx.pendingPlace = sw; ctx.swaps++; return { type: 'remove', peg: sw.peg, why: 'swap' }; }
  }
  if (evv.jammed || badOut) {
    // the move just made caused it and an undo is left: undo it (a free take-back), else drag the latest gear off
    if (ctx.lastPlace != null && pm.has(ctx.lastPlace) && ctx.undoOk && (P.tierId !== 'clumsy' || P.rng() < 0.5)) return { type: 'undo', why: evv.jammed ? 'jam' : 'badOut' };
    const recent = ctx.order.slice().reverse().find(p => pm.has(p) && !lk.has(p)) ?? [...pm.keys()].filter(p => !lk.has(p)).pop();
    return { type: 'remove', peg: recent, why: evv.jammed ? 'jam' : 'badOut' };
  }
  const t = P.tierId;
  if (t === 'superhuman' || (t === 'world' && PLAN[n])) {
    const plan = t === 'superhuman' ? L.solution.map(s => ({ peg: s.peg, pieceId: s.piece, orient: s.orient })) : PLAN[n];
    for (const [peg, v] of pm) { if (lk.has(peg)) continue; const s = plan.find(x => x.peg === peg); if (!s || s.pieceId !== v.piece.id) return { type: 'remove', peg, why: 'offplan' }; }
    for (const s of plan) {
      if (FIXED[n].has(s.peg)) continue;
      const cur = pm.get(s.peg);
      if (!cur) return { type: 'place', peg: s.peg, pieceId: s.pieceId, orient: s.orient };
      if (cur.orient !== s.orient) return { type: 'flip', peg: s.peg };
    }
    return null;
  }
  const used = new Set([...pm.values()].map(v => v.piece.id));
  const randomMove = () => {
    const pegs = L.pegs.map((p, i) => i).filter(i => L.pegs[i].kind !== 'crank' && !pm.has(i));
    const pcs = L.pieces.filter(p => !used.has(p.id));
    if (!pegs.length || !pcs.length) return null;
    return { type: 'place', peg: P.rng.pick(pegs), pieceId: P.rng.pick(pcs).id, orient: 0, random: true };
  };
  if ((t === 'clumsy' && P.rng() < 0.5) || (t === 'casual' && P.rng() < 0.15)) { const m = randomMove(); if (m) return m; }
  let cands = candidates(L, pm).filter(c => !ctx.tabu.has(c.peg + ':' + c.piece.id + ':' + c.orient));
  if (!cands.length && t === 'skilled') {
    const sw = swapRepair(L, pm, lk, ctx.seen);
    if (sw) { ctx.pendingPlace = sw; ctx.swaps++; return { type: 'remove', peg: sw.peg, why: 'swap' }; }
  }
  if (!cands.length) {
    // stuck: take back a gear that is not driving anything (random leftovers first), else the latest driven gear
    const ev = K.evaluate(L, pm);
    const idle = [...pm.keys()].filter(p => !lk.has(p) && !(ev.pegInfo.get(p) || {}).ratio);
    const peg = idle.length ? idle[idle.length - 1] : ctx.order.slice().reverse().find(p => pm.has(p) && !lk.has(p));
    if (peg == null) return randomMove();
    const v = pm.get(peg); ctx.tabu.add(peg + ':' + v.piece.id + ':' + v.orient);
    return { type: 'remove', peg, why: 'stuck' };
  }
  // keep a compound gear for where both wheels are needed: a single gear meshing the same way at that peg is preferred
  const sameSingle = c => c.piece.t.length === 2 && cands.some(d => d.peg === c.peg && d.piece.t.length === 1 && (() => { const a = K.pieceWheels(c.piece, c.orient), b = K.pieceWheels(d.piece, d.orient); return (b.A && b.A === a.A) || (b.B && b.B === a.B); })());
  const scoreOf = c => {
    let s = c.outScore * 10 + P.rng() * 0.5;
    if (t === 'skilled' || t === 'world') { // 2-step lookahead: the best follow-up's dial progress; dead ends lose
      const p2 = new Map(pm); p2.set(c.peg, { piece: c.piece, orient: c.orient });
      if (!c.ev.win) { const c2 = candidates(L, p2); s += c2.length ? 3 + Math.max(...c2.map(x => x.outScore)) * 4 : -6; }
      if (sameSingle(c)) s -= 2;
    }
    return s;
  };
  let best = cands[0], bs = -1e9;
  for (const c of cands) { const s = scoreOf(c); if (s > bs) { bs = s; best = c; } }
  return { type: 'place', peg: best.peg, pieceId: best.piece.id, orient: best.orient };
}

async function pegXY(page, peg) { return page.evaluate(i => window.__antikythera.pegScreen(i), peg); }
// a magnified board may have panned the wanted peg out of view: zoom back out first (zoom button)
async function pegInView(P, peg) {
  let [x, y] = await pegXY(P.page, peg);
  const st = await P.page.locator('#stage').boundingBox();
  if (x < st.x + 4 || x > st.x + st.width - 4 || y < st.y + 4 || y > st.y + st.height - 4) {
    if (await P.page.isVisible('#zoomBtn')) { await H.sleep(P.reactMs()); await P.tapSelector('#zoomBtn'); await H.sleep(120); [x, y] = await pegXY(P.page, peg); }
  }
  return [x, y];
}

async function act(P, a, ctx) {
  const page = P.page;
  if (a.type === 'place') {
    const tok = await ensureTokenVisible(P, a.pieceId);
    if (!tok) { ctx.lost++; return; }
    let o = await obs(page);
    if (String(o.sel) !== String(a.pieceId)) { // (already selected after a missed peg tap -> go straight to the peg)
      await H.sleep(P.reactMs() + P.thinkMs(1.4)); // find the gear in the tray
      await P.tap(tok.x, tok.y);
      await H.sleep(40);
      o = await obs(page);
    }
    if (String(o.sel) !== String(a.pieceId)) {
      ctx.selectFail++;
      if (o.sel == null) { // retry once, deliberately
        await H.sleep(P.reactMs());
        await P.tap(tok.x, tok.y, { exact: true }); await H.sleep(40); o = await obs(page);
        if (String(o.sel) === String(a.pieceId)) ctx.droppedTokenTaps++;
      }
      if (String(o.sel) !== String(a.pieceId)) return;
    }
    const [x, y] = await pegInView(P, a.peg);
    await H.sleep(P.reactMs() + P.thinkMs(0.6));
    const z0 = o.zoom;
    await P.tap(x, y);
    await H.sleep(40);
    const o2 = await obs(page);
    if (o2.zoom > z0 + 0.01 && o2.pl.length === o.pl.length) { ctx.zoomTaps++; return; } // magnified: tap again next turn
    ctx.order.push(a.peg); ctx.lastPlace = a.peg;
    if (!a.random) ctx.intended = { peg: a.peg, pieceId: a.pieceId, orient: a.orient };
  } else if (a.type === 'undo') {
    await H.sleep(P.reactMs() + P.thinkMs(0.3));
    await P.tapSelector('#undoBtn');
    ctx.undos++; ctx.lastPlace = null;
  } else if (a.type === 'flip') {
    const [x, y] = await pegInView(P, a.peg);
    await H.sleep(P.reactMs() + P.thinkMs(0.3));
    await P.tap(x, y);
    ctx.lastPlace = a.peg;
  } else if (a.type === 'remove') {
    const [x, y] = await pegInView(P, a.peg);
    ctx.lastPlace = null;
    await H.sleep(P.reactMs() + P.thinkMs(0.5));
    const tray = await page.locator('#tray').boundingBox();
    await P.swipe(x, y, (tray.x + tray.width / 2) - x, (tray.y + tray.height / 2 + 44) - y, { steps: 10 });
    ctx.removes++;
  }
  await H.sleep(60);
}

async function playAttempt(P, n) {
  const page = P.page, L = LV[n];
  // close the previous result card like a player would (loadLevel() itself does not hide #winOv)
  for (const b of ['#stayBtn', '#failRetry']) if (await page.isVisible(b)) { await P.tapSelector(b); await H.sleep(300); }
  await page.evaluate(n => window.__antikythera.loadLevel(n), n);
  for (let i = 0; i < 200; i++) { const nm = await page.evaluate(() => window.__antikythera.level.name); if (nm === L.name) break; await H.sleep(50); }
  await H.sleep(300);
  const chk = await page.evaluate(() => ({ pegs: window.__antikythera.level.pegs.length, pieces: window.__antikythera.level.pieces.map(p => p.t.join('/')).join(',') }));
  if (chk.pegs !== L.pegs.length || chk.pieces !== L.pieces.map(p => p.t.join('/')).join(',')) throw new Error('level mismatch ' + n);
  // dismiss the hint toast like a player would
  if (await page.isVisible('#toastClose')) { await H.sleep(P.reactMs()); await P.tapSelector('#toastClose'); }
  const ctx = { order: [], tabu: new Set(), lost: 0, selectFail: 0, droppedTokenTaps: 0, removes: 0, undos: 0, zoomTaps: 0, strayOverlays: 0, swaps: 0, seen: new Set(), pendingPlace: null, intended: null, rustFlipped: false, lastPlace: null, undoOk: false, plan: null };
  const cap = L.timeLimit ? (L.timeLimit + 8) * 1000 : SOFT_CAP;
  const t0 = Date.now(); let o = await obs(page), actions = 0;
  // the clock starts when the hint card closes: work the train out now, on the clock
  await H.sleep(P.thinkMs(3) + PLAN_S[P.tierId] * 1000 * L.minMoves);
  let tFirst = 0;
  while (!o.win && !o.failed && (!tFirst || Date.now() - tFirst < cap) && Date.now() - t0 < cap + 120000 && actions < 80) {
    // a stray tap opened the help or level-select card (they pause the clock): close it like a player would
    for (const [ov, btn] of [['#helpOv', '#helpClose'], ['#selOv', '#selClose']]) if (await page.isVisible(ov)) { ctx.strayOverlays++; await H.sleep(P.reactMs()); await P.tapSelector(btn); await H.sleep(150); o = await obs(page); }
    const pm = toMap(L, o.pl);
    ctx.undoOk = o.undoOk;
    let a = decide(P, n, L, pm, ctx);
    if (!a) break;
    if (a.type === 'place' && P.mistake()) { // wrong gear of a similar size
      const used = new Set(o.pl.map(x => x[1]));
      const others = L.pieces.filter(p => !used.has(p.id) && p.id !== a.pieceId);
      if (others.length) a = { ...a, pieceId: P.rng.pick(others).id };
    }
    if (process.env.DBG) console.log(P.tierId, n, JSON.stringify(a), JSON.stringify(o.pl), o.sel, o.moves);
    if (!tFirst) tFirst = Date.now();
    await act(P, a, ctx); actions++;
    o = await obs(page);
  }
  if (o.win) for (let i = 0; i < 40 && !o.winOv; i++) { await H.sleep(100); o = await obs(page); }
  const mv = (o.moves.match(/(\d+)/) || [])[1];
  const toS = t => { const m = String(t).match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };
  const left = toS(o.time);
  return { timeUsedPct: L.timeLimit && left != null ? Math.round(100 * (L.timeLimit - left) / L.timeLimit) : null, cleared: o.win, failedBy: o.win ? null : o.failed ? (await page.textContent('#failMsg')).replace(/^第 \d+ 關：/, '') : 'cap', moves: +mv, minMoves: L.minMoves, moveLimit: L.moveLimit, timeLimit: L.timeLimit,
    ms: Date.now() - t0, actions, removes: ctx.removes, undos: ctx.undos, zoomTaps: ctx.zoomTaps, strayOverlays: ctx.strayOverlays, swaps: ctx.swaps, selectFail: ctx.selectFail, droppedTokenTaps: ctx.droppedTokenTaps, winOverlay: o.winOv };
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 4000 + idx * 7919);
  await H.sleep(1000);
  const runs = [];
  const ov = args.find(a => a.startsWith('--' + tierId + '-levels='));
  for (const n of ov ? ov.split('=')[1].split(',').map(Number) : TEST_LEVELS) {
    const run = { level: n, attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, n);
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, moves: last.moves, minMoves: last.minMoves, moveLimit: last.moveLimit, timeLimit: last.timeLimit, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run); try { const pf = require("path").join(__dirname, "partial-" + tierId + ".json"); require("fs").writeFileSync(pf, JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) {}
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail(' + last.failedBy + ')'} tries=${run.tries} moves=${run.moves} min=${run.minMoves} lim=${run.moveLimit} t=${run.timeLimit}s sel-fail=${last.selectFail} ${(run.ms / 1000).toFixed(1)}s`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  return { runs, errors, stats: { ...P.stats, trayScrolls: P.scrolls || 0 }, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0) } };
}

// probe: does a tap on a tray gear still select it after that gear was used to swipe-scroll the tray?
async function trayProbe(browser) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, 'superhuman', 7);
  await H.sleep(1000);
  await sess.page.evaluate(() => window.__antikythera.loadLevel(50));
  await H.sleep(800);
  const r = await sess.page.evaluate(() => { const t = document.querySelector('.token'), a = t.getBoundingClientRect(); return { id: t.dataset.id, x: a.left + a.width / 2, y: a.top + a.height / 2 }; });
  await P.swipe(r.x, r.y, 60, 0, { exact: true, steps: 8 }); // sideways swipe that starts on this token (scrolls tray)
  await H.sleep(900);
  const r2 = await sess.page.evaluate(id => { const t = document.querySelector(`.token[data-id="${id}"]`), a = t.getBoundingClientRect(); return { x: a.left + a.width / 2, y: a.top + a.height / 2 }; }, r.id);
  await P.tap(r2.x, r2.y, { exact: true }); await H.sleep(100);
  const sel1 = await sess.page.evaluate(() => (document.querySelector('.token[aria-pressed="true"]') || {}).dataset?.id ?? null);
  await P.tap(r2.x, r2.y, { exact: true }); await H.sleep(100);
  const sel2 = await sess.page.evaluate(() => (document.querySelector('.token[aria-pressed="true"]') || {}).dataset?.id ?? null);
  const errors = sess.errors.slice();
  await sess.ctx.close();
  return { token: r.id, selectedAfterFirstTap: sel1, selectedAfterSecondTap: sel2, errors };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'antikythera', testedLevels: TEST_LEVELS, planSecondsPerMove: PLAN_S, levelVariant: Object.fromEntries(TEST_LEVELS.map(n => [n, LV[n].k ?? null])), worldPlanLengths: Object.fromEntries(TEST_LEVELS.map(n => [n, PLAN[n] ? PLAN[n].length : null])), tiers: {} };
  const t0 = Date.now();
  out.trayProbe = await trayProbe(browser);
  console.log('trayProbe', JSON.stringify(out.trayProbe));
  if (!args.includes('--probe-only')) {
    const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i)));
    TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  }
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(process.env.OUT || path.join(__dirname, 'raw-results.json'), JSON.stringify(out, null, 1));
  console.log('wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
