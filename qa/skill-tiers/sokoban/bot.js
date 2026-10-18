// 推箱子 (sokoban) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...] [--out=raw-results.json]
// Reads state via window.__game.state()/snap() (what a player sees on screen); acts only through CDP touch input:
// tap a floor cell (tap-to-walk), tap the D-pad or swipe the board to push, tap 復原 / 重來.
// Decisions are made in "push space" (walk to the far side of a crate, push it one cell), the way people play Sokoban.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/sokoban/index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return {DX,DY,DCH,parseLevel,initState,nb,tryMove,isWon,reach,pathTo,replay,deadSquares};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + ';return LEVELS;')();

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const outArg = args.find(a => a.startsWith('--out='));
const OUT = path.join(__dirname, outArg ? outArg.slice(6) : 'raw-results.json');
const SERIAL = args.includes('--serial');

/* ---------------- model ---------------- */
const LVC = {};
function LV(n) {
  if (LVC[n]) return LVC[n];
  const L = C.parseLevel(LEVELS[n - 1].m); L.dead = C.deadSquares(L); L.gd = goalDist(L); L.optPushes = LEVELS[n - 1].p; L.par = LEVELS[n - 1].s.length;
  return (LVC[n] = L);
}
function goalDist(L) { // pushes needed to bring a box from each cell to the nearest goal, ignoring other boxes
  const d = new Int16Array(L.n).fill(-1), q = []; for (let i = 0; i < L.n; i++) if (L.goal[i]) { d[i] = 0; q.push(i); }
  for (let qi = 0; qi < q.length; qi++) { const b = q[qi]; for (let k = 0; k < 4; k++) { const from = C.nb(L, b, k), pl = from < 0 ? -1 : C.nb(L, from, k); if (from < 0 || pl < 0 || L.wall[from] || L.wall[pl] || d[from] >= 0) continue; d[from] = d[b] + 1; q.push(from); } }
  return d;
}
function frozen(L, box, b, vis) {
  vis = vis || new Set(); vis.add(b);
  const axis = (d1, d2) => { const a = C.nb(L, b, d1), c = C.nb(L, b, d2);
    if (a < 0 || c < 0 || L.wall[a] || L.wall[c]) return true; if (L.dead[a] && L.dead[c]) return true;
    if (box[a] && (vis.has(a) || frozen(L, box, a, vis))) return true; if (box[c] && (vis.has(c) || frozen(L, box, c, vis))) return true; return false; };
  return axis(0, 2) && axis(1, 3);
}
function stuck(L, box) { for (let i = 0; i < L.n; i++) if (box[i] && !L.goal[i] && (L.dead[i] || frozen(L, box, i))) return true; return false; }
const key = (L, p, box) => { const R = C.reach(L, { p, box }); let m = p; for (let i = 0; i < L.n; i++) if (R.dist[i] >= 0 && i < m) m = i; let s = m + ':'; for (let i = 0; i < L.n; i++) if (box[i]) s += i + ','; return s; };
function hval(L, box) { let s = 0; for (let i = 0; i < L.n; i++) if (box[i]) { if (L.gd[i] < 0) return 1e6; s += L.gd[i]; } return s; }
function legalPushes(L, S) { // [{b,d,from,to,box}]
  const R = C.reach(L, S), out = [];
  for (let b = 0; b < L.n; b++) if (S.box[b]) for (let d = 0; d < 4; d++) {
    const from = C.nb(L, b, (d + 2) % 4), to = C.nb(L, b, d);
    if (from < 0 || to < 0 || R.dist[from] < 0 || L.wall[to] || S.box[to]) continue;
    const box = new Uint8Array(S.box); box[b] = 0; box[to] = 1;
    out.push({ b, d, from, to, box, walk: R.dist[from] });
  }
  return out;
}
// Full solver (push space, weighted A*, dead-square + freeze pruning): world-class and superhuman
function solve(L, S0, limit) {
  const h = box => hval(L, box);
  const kOf = (box, p) => { const S = { p, box }; const R = C.reach(L, S); let m = p; for (let i = 0; i < L.n; i++) if (R.dist[i] >= 0 && i < m) m = i; let s = m + ':'; for (let i = 0; i < L.n; i++) if (box[i]) s += i + ','; return s; };
  const start = { box: new Uint8Array(S0.box), p: S0.p, par: null, mv: null, g: 0 };
  if (C.isWon(L, start)) return [];
  const seen = new Set([kOf(start.box, start.p)]);
  const heap = [{ f: 2 * h(start.box), n: start }];
  const push = x => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p].f <= heap[i].f) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l].f < heap[m].f) m = l; if (r < heap.length && heap[r].f < heap[m].f) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  let nodes = 0;
  while (heap.length) {
    const cur = pop().n; if (++nodes > limit) return null;
    for (const mv of legalPushes(L, cur)) {
      if (L.dead[mv.to] || (!L.goal[mv.to] && frozen(L, mv.box, mv.to))) continue;
      const k = kOf(mv.box, mv.b); if (seen.has(k)) continue; seen.add(k);
      const nn = { box: mv.box, p: mv.b, par: cur, mv: { b: mv.b, d: mv.d }, g: cur.g + 1 };
      if (C.isWon(L, nn)) { const sol = []; for (let x = nn; x.par; x = x.par) sol.push(x.mv); return sol.reverse(); }
      push({ f: nn.g + 2 * h(mv.box), n: nn });
    }
  }
  return null;
}
// pushes of a stored move string (superhuman fallback)
function pushesOf(L, str) { const S = C.initState(L), out = []; for (const ch of str) { const d = C.DCH.indexOf(ch), r = C.tryMove(L, S, d); if (r && r.push) out.push({ b: r.bFrom, d }); } return out; }

function decide(P, L, S, visits, plan) {
  const legal = legalPushes(L, S);
  if (!legal.length) return null;
  const tier = P.tierId;
  if (tier === 'world' || tier === 'superhuman') {
    if (tier === 'superhuman' && !plan.list && S.moves === 0) { plan.list = pushesOf(L, LEVELS[plan.n - 1].s); plan.i = 0; } // knows the reference solution
    if (plan.list && plan.i < plan.list.length) { const m = plan.list[plan.i]; const ok = legal.find(x => x.b === m.b && x.d === m.d); if (ok) { plan.i++; return ok; } }
    let sol = solve(L, S, tier === 'superhuman' ? 600000 : 250000);
    if (sol && sol.length) { plan.list = sol; plan.i = 1; return legal.find(x => x.b === sol[0].b && x.d === sol[0].d) || null; }
    plan.list = null; return null;
  }
  const nov = mv => 4 * (visits.get(key(L, mv.b, mv.box)) || 0);
  const live = legal.filter(x => !L.dead[x.to] && (L.goal[x.to] || !frozen(L, x.box, x.to)));
  const pool = (tier === 'clumsy' ? legal : live).length ? (tier === 'clumsy' ? legal : live) : legal;
  const s1 = x => hval(L, x.box) + nov(x) + 0.02 * x.walk + P.rng() * 0.6;
  if (tier === 'clumsy') { if (P.rng() < 0.5) return P.rng.pick(legal); return pool.reduce((a, b) => (s1(b) < s1(a) ? b : a)); }
  if (tier === 'casual') { if (P.rng() < 0.15) return P.rng.pick(pool); return pool.reduce((a, b) => (s1(b) < s1(a) ? b : a)); }
  // skilled: 2-push lookahead, avoids dead squares and frozen crates
  let best = null, bs = 1e18;
  for (const x of pool) {
    let s = s1(x);
    const S2 = { p: x.b, box: x.box };
    if (!C.isWon(L, S2)) {
      let m2 = 1e18;
      for (const y of legalPushes(L, S2)) { if (L.dead[y.to] || (!L.goal[y.to] && frozen(L, y.box, y.to))) continue; m2 = Math.min(m2, hval(L, y.box) + nov(y)); }
      s = Math.min(s, m2 + 0.5);
    } else s = -1e6;
    if (s < bs) { bs = s; best = x; }
  }
  return best;
}

/* ---------------- page I/O ---------------- */
const getState = page => page.evaluate(() => window.__game.state());
async function waitIdle(page, maxMs = 8000) { const t0 = Date.now(); let st; for (;;) { st = await getState(page); if (!st.animating) return st; if (Date.now() - t0 > maxMs) return st; await H.sleep(16); } }
async function snapS(page, L) { const sn = await page.evaluate(() => window.__game.snap()); const box = new Uint8Array(L.n); for (const b of sn.box) box[b] = 1; return { p: sn.p, box }; }
const PAD = d => `.dk[data-d="${d}"]`;

async function pushVia(P, L, d, cellPx) { // push in direction d: D-pad tap, or a swipe on the board
  if (P.superhuman || P.rng() < 0.5) { await P.tapSelector(PAD(d)); return 'pad'; }
  const c = await P.page.evaluate(() => { const L = window.__game.level(); return window.__game.cellCenter(Math.floor(L.n / 2)); });
  await P.swipe(c.x, c.y, C.DX[d] * Math.max(60, cellPx * 1.5), C.DY[d] * Math.max(60, cellPx * 1.5));
  return 'swipe';
}

async function playAttempt(P, n) {
  const page = P.page, L = LV(n);
  const optP = L.optPushes, CAP_ACTIONS = 4 * optP + 20, TIME_CAP = 120000 + 6000 * optP;
  await page.evaluate(n => window.__game.go(n), n);
  await H.sleep(350);
  const cellPx = await page.evaluate(() => { const a = window.__game.cellCenter(0), b = window.__game.cellCenter(1); return b.x - a.x; });
  const visits = new Map(), plan = { n, list: null, i: 0 };
  const t0 = Date.now();
  let actions = 0, pushes = 0, walkTaps = 0, missWalks = 0, undos = 0, stuckSeen = 0, dropped = 0, extra = 0, gaveUp = '';
  let st = await getState(page);
  while (Date.now() - t0 < TIME_CAP && actions < CAP_ACTIONS) {
    if (st.status === 'won') break;
    let S = await snapS(page, L); S.moves = st.moves;
    // a crate is stuck: the game paints it red and shows a toast; better players notice and undo
    if (stuck(L, S.box)) {
      stuckSeen++;
      const notice = { clumsy: 0.45, casual: 0.85, skilled: 1, world: 1, superhuman: 1 }[P.tierId];
      if (P.rng() < notice) {
        await H.sleep(P.reactMs() + P.thinkMs(0.5));
        if (P.tierId === 'clumsy' || (P.tierId === 'casual' && P.rng() < 0.3)) { gaveUp = 'restart-after-stuck'; break; }
        await P.tapSelector('#bUndo'); undos++; actions++; plan.list = null;
        st = await waitIdle(page); continue;
      }
    }
    { const kk = key(L, S.p, S.box); visits.set(kk, (visits.get(kk) || 0) + 1); }
    await H.sleep(P.reactMs() + P.thinkMs());
    let mv = decide(P, L, S, visits, plan);
    if (!mv) { gaveUp = 'no-plan'; break; }
    let d = mv.d;
    // walk to the push position by tapping that floor cell
    if (S.p !== mv.from) {
      const c = await page.evaluate(k => window.__game.cellCenter(k), mv.from);
      await P.tap(c.x, c.y); walkTaps++; actions++;
      if (cellPx < 36) { await H.sleep(Math.max(60, P.reactMs() * 0.5)); await P.tap(c.x, c.y); } // small cells: first tap aims (ring), second confirms
      st = await waitIdle(page); await H.sleep(30);
      const S2 = await snapS(page, L);
      if (S2.p !== mv.from) { missWalks++; plan.list = null; st = await getState(page); continue; } // mis-tap: re-plan from what is on screen
      await H.sleep(P.reactMs() * 0.6);
    }
    if (P.mistake()) d = P.rng.pick([0, 1, 2, 3].filter(x => x !== d));
    const before = await getState(page);
    await pushVia(P, L, d, cellPx); actions++;
    st = await waitIdle(page); await H.sleep(20); st = await getState(page);
    const legalStep = !!C.tryMove(L, { ...S, p: mv.from, box: new Uint8Array(S.box), hist: [], moves: 0, pushes: 0 }, d);
    if (legalStep && st.moves === before.moves && st.status !== 'won') dropped++;
    if (st.moves > before.moves + 1) extra++;
    if (st.pushes > before.pushes) pushes++;
    if (d !== mv.d) plan.list = null;
  }
  st = await waitIdle(page);
  const cleared = st.status === 'won';
  if (cleared) await H.sleep(1300);
  const winVisible = cleared ? await page.isVisible('#win') : false;
  const stars = cleared ? await page.locator('#wStars .on').count() : 0;
  return { cleared, moves: st.moves, pushes: st.pushes, par: L.par, optPushes: optP, actions, walkTaps, missWalks, undos, stuckSeen, dropped, doubleCounted: extra, gaveUp: cleared ? '' : (gaveUp || (actions >= CAP_ACTIONS ? 'action-cap' : 'time-cap')), ms: Date.now() - t0, winOverlay: winVisible, stars };
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP, () => { try { localStorage.setItem('sokoban:v1:help', 'true'); localStorage.setItem('sokoban:v1:unlockAll', 'true'); } catch (e) {} });
  const P = new H.Player(sess, tierId, 4000 + idx * 7919);
  await H.sleep(800);
  await P.tapSelector('#tPlay'); await H.sleep(500);
  const runs = [];
  for (const n of TEST_LEVELS) {
    const run = { level: n, par: LV(n).par, optPushes: LV(n).optPushes, boxes: LV(n).nBoxes, attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, n);
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, moves: last.moves, pushes: last.pushes, stars: last.stars, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run);
    try { fs.writeFileSync(path.join(__dirname, 'partial-' + tierId + '.json'), JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) {}
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} moves=${run.moves}/${run.par} pushes=${run.pushes}/${run.optPushes} stars=${run.stars} ${(run.ms / 1000).toFixed(1)}s ${run.cleared ? '' : last.gaveUp}`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  const sumA = k => runs.reduce((a, r) => a + r.attempts.reduce((b, x) => b + x[k], 0), 0);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, droppedPushes: sumA('dropped'), doubleCounted: sumA('doubleCounted'), missWalks: sumA('missWalks'), undos: sumA('undos') } };
}

// rapid input: 16 alternating D-pad taps at 8/s, then 16 alternating swipes; every one must register exactly once
async function rapidInputProbe(browser) {
  const sess = await H.newSession(browser, 'file://' + APP, () => { try { localStorage.setItem('sokoban:v1:help', 'true'); } catch (e) {} });
  const P = new H.Player(sess, 'superhuman', 42);
  await H.sleep(800); await P.tapSelector('#tPlay'); await H.sleep(400);
  const n = 50, L = LV(n);
  await sess.page.evaluate(n => window.__game.go(n), n); await H.sleep(400);
  const S = C.initState(L); let d = -1;
  for (let k = 0; k < 4 && d < 0; k++) { const t = C.nb(L, S.p, k); if (t >= 0 && !L.wall[t] && !S.box[t]) d = k; }
  const res = {};
  for (const mode of ['pad', 'swipe']) {
    const m0 = (await getState(sess.page)).moves;
    for (let i = 0; i < 16; i++) {
      const dd = i % 2 ? (d + 2) % 4 : d, t1 = Date.now();
      if (mode === 'pad') await P.tapSelector(PAD(dd));
      else { const c = await sess.page.evaluate(() => ({ x: innerWidth / 2, y: innerHeight * 0.4 })); await P.swipe(c.x, c.y, C.DX[dd] * 70, C.DY[dd] * 70, { exact: true, steps: 3 }); }
      await H.sleep(Math.max(0, 125 - (Date.now() - t1)));
    }
    await waitIdle(sess.page); await H.sleep(200);
    res[mode] = { sent: 16, registered: (await getState(sess.page)).moves - m0 };
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  return { level: n, dir: d, ...res, errors };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'sokoban', testedLevels: TEST_LEVELS, method: 'push-space bots; walk = tap the floor cell, push = D-pad tap or board swipe; caps per attempt: 4 x optimal pushes + 20 actions, 120 s + 6 s x optimal pushes', tiers: {} };
  const t0 = Date.now();
  if (args.includes('--probe-only')) { out.probe = await rapidInputProbe(browser); await browser.close(); fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log('probe', JSON.stringify(out.probe)); return; }
  if (SERIAL) { for (let i = 0; i < TIER_LIST.length; i++) out.tiers[TIER_LIST[i]] = await runTier(browser, TIER_LIST[i], i); }
  else { const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i))); TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; }); }
  if (!args.includes('--no-probe')) out.probe = await rapidInputProbe(browser);
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('probe', JSON.stringify(out.probe), 'wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
