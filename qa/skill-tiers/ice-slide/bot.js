// 冰原企鵝 (ice-slide) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...]
// Reads state via window.__game.state(); acts only via CDP touch swipes / taps on overlay buttons.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/ice-slide/index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, initState, doMove, solve, stateKey};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const TIME_CAP_BASE = 30000, TIME_PER_OPT = 2500; // per-attempt cap = 30 s + 2.5 s x optimal moves (game itself has no timer)

const popc = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
function heur(L, S, r) {
  if (r && r.ev.result === 'win') return -1e6;
  if (r && r.ev.result === 'fall') return 1e5;
  const all = (1 << L.fish.length) - 1, px = S.p % L.w, py = (S.p / L.w) | 0;
  const md = c => Math.abs(c % L.w - px) + Math.abs(((c / L.w) | 0) - py);
  if (S.fm === all) return md(L.igloo);
  let best = 1e9; L.fish.forEach((c, i) => { if (!((S.fm >> i) & 1)) best = Math.min(best, md(c)); });
  return 100 * (L.fish.length - popc(S.fm)) + best;
}
// Full reachable-state graph per level, reverse BFS distance to a win (cached: the shared Node thread must not stall)
const DIST = new Map();
function distMap(L) {
  if (DIST.has(L)) return DIST.get(L);
  const S0 = core.initState(L), keys = [core.stateKey(S0)], states = [S0], idx = new Map([[keys[0], 0]]), radj = [[]], win = [];
  for (let h = 0; h < states.length; h++) for (let d = 0; d < 4; d++) {
    const r = core.doMove(L, states[h], d); if (!r || r.ev.result === 'fall') continue;
    if (r.ev.result === 'win') { win.push(h); continue; }
    const k = core.stateKey(r.S); let j = idx.get(k);
    if (j === undefined) { j = states.length; idx.set(k, j); states.push(r.S); keys.push(k); radj.push([]); }
    radj[j].push(h);
  }
  const dist = new Map(); const q = [];
  for (const h of win) if (!dist.has(keys[h])) { dist.set(keys[h], 1); q.push(h); }
  for (let i = 0; i < q.length; i++) { const h = q[i], dh = dist.get(keys[h]); for (const p of radj[h]) if (!dist.has(keys[p])) { dist.set(keys[p], dh + 1); q.push(p); } }
  DIST.set(L, dist); return dist;
}
function optimalDir(L, S) {
  const dist = distMap(L); let best = -1, bd = 1e9;
  for (let d = 0; d < 4; d++) { const r = core.doMove(L, S, d); if (!r || r.ev.result === 'fall') continue; const v = r.ev.result === 'win' ? 0 : (dist.get(core.stateKey(r.S)) ?? 1e9); if (v < bd) { bd = v; best = d; } }
  return best;
}
// BFS from S to a win; returns first direction (or -1)
function bfsFirst(L, S0, limit = 400000) {
  const k0 = core.stateKey(S0), seen = new Set([k0]); const q = [[S0, -1]]; let head = 0;
  while (head < q.length) {
    const [S, first] = q[head++];
    for (let d = 0; d < 4; d++) {
      const r = core.doMove(L, S, d); if (!r || r.ev.result === 'fall') continue;
      const f = first < 0 ? d : first;
      if (r.ev.result === 'win') return f;
      const k = core.stateKey(r.S); if (seen.has(k)) continue; seen.add(k); q.push([r.S, f]);
      if (q.length > limit) return -1;
    }
  }
  return -1;
}
function decide(P, L, S, visits) {
  const legal = [0, 1, 2, 3].map(d => ({ d, r: core.doMove(L, S, d) })).filter(x => x.r);
  if (!legal.length) return -1;
  const nov = r => 18 * (visits.get(core.stateKey(r.S)) || 0);
  const score1 = x => heur(L, x.r.S, x.r) + (x.r.ev.result === 'move' ? nov(x.r) : 0);
  const greedy = () => legal.reduce((a, b) => (score1(b) + P.rng() * 0.5 < score1(a) ? b : a)).d;
  const tier = P.tierId;
  if (tier === 'clumsy') return P.rng() < 0.5 ? P.rng.pick(legal).d : greedy();
  if (tier === 'casual') return P.rng() < 0.15 ? P.rng.pick(legal).d : greedy();
  if (tier === 'skilled') {
    let best = null, bs = 1e18;
    for (const x of legal) {
      let s = score1(x);
      if (x.r.ev.result === 'move') {
        let m2 = 1e18;
        for (let d2 = 0; d2 < 4; d2++) { const r2 = core.doMove(L, x.r.S, d2); if (r2) m2 = Math.min(m2, heur(L, r2.S, r2) + (r2.ev.result === 'move' ? nov(r2) : 0)); }
        s = Math.min(s, m2 + 1);
      }
      s += P.rng() * 0.5;
      if (s < bs) { bs = s; best = x.d; }
    }
    return best;
  }
  const f = optimalDir(L, S);
  return f >= 0 ? f : greedy();
}

async function getState(page) { return page.evaluate(() => window.__game.state()); }
async function waitIdle(page, maxMs = 6000) {
  const t0 = Date.now(); let st;
  for (;;) { st = await getState(page); if (!st.animating && st.status !== 'anim') return st; if (Date.now() - t0 > maxMs) return st; await H.sleep(16); }
}

async function playAttempt(P, n, finding) {
  const page = P.page, L = LV(n);
  const TIME_CAP = TIME_CAP_BASE + TIME_PER_OPT * L_opt(n);
  await page.evaluate(n => window.__game.startLevel(n), n);
  await H.sleep(300);
  const rect = await page.evaluate(() => window.__game.boardRect());
  const cx = rect.x + rect.s * rect.w / 2, cy = rect.y + rect.s * rect.h / 2;
  let S = core.initState(L); const hist = []; const visits = new Map();
  const t0 = Date.now(); let swipes = 0, falls = 0, undos = 0, dropped = 0, misreg = 0;
  const maxSwipes = 2 * L_opt(n) + 12;
  let st = await getState(page);
  while (Date.now() - t0 < TIME_CAP && swipes < maxSwipes) {
    if (st.status === 'won') break;
    if (st.status === 'fail') { // fell in: tap 復原一步
      await H.sleep(P.reactMs() + P.thinkMs(0.5));
      await P.tapSelector('#fUndo'); undos++;
      await H.sleep(120); st = await waitIdle(page);
      if (st.status === 'play' && hist.length) S = hist.pop();
      continue;
    }
    await H.sleep(P.reactMs() + P.thinkMs());
    visits.set(core.stateKey(S), (visits.get(core.stateKey(S)) || 0) + 1);
    let d = decide(P, L, S, visits);
    if (d < 0) break;
    if (P.mistake()) d = P.rng.pick([0, 1, 2, 3].filter(x => x !== d));
    const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d];
    const [vx, vy] = await P.swipe(cx, cy, DX * 90, DY * 90);
    swipes++;
    const physDir = Math.max(Math.abs(vx), Math.abs(vy)) < 14 ? -1 : (Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 1 : 3) : (vy > 0 ? 2 : 0));
    const prevMoves = st.moves;
    await H.sleep(40);
    st = await waitIdle(page);
    if (st.status === 'won' || st.moves !== prevMoves || st.status === 'fail') {
      // identify which move registered
      const cands = [0, 1, 2, 3].map(k => ({ k, r: core.doMove(L, S, k) })).filter(x => x.r && (st.status === 'won' ? x.r.ev.result === 'win' : x.r.S.p === st.p && x.r.S.fm === st.fm));
      const pick = cands.find(c => c.k === physDir) || cands[0];
      if (pick) { if (pick.k !== physDir) misreg++; hist.push(S); S = pick.r.S; if (pick.r.ev.result === 'fall') falls++; }
      else { finding('model-desync', { level: n, tier: P.tierId }); hist.push(S); }
    } else if (physDir >= 0 && core.doMove(L, S, physDir)) { dropped++; }
  }
  st = await waitIdle(page);
  if (st.status === 'won') { await H.sleep(800); }
  const winVisible = st.status === 'won' ? await page.isVisible('#win') : false;
  return { cleared: st.status === 'won', moves: st.moves, opt: L_opt(n), swipes, falls, undos, dropped, misregistered: misreg, ms: Date.now() - t0, winOverlay: winVisible,
    stars: st.status === 'won' ? (st.moves <= L_opt(n) ? 3 : st.moves <= Math.ceil(L_opt(n) * 1.4) + 1 ? 2 : 1) : 0 };
}
const L_opt = n => LEVELS[n - 1][1];
const LVC = {}; const LV = n => LVC[n] || (LVC[n] = core.parseLevel(LEVELS[n - 1][0].split('/')));

async function runTier(browser, tierId, idx, findings) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 1000 + idx * 7919);
  await H.sleep(800);
  const runs = [];
  for (const n of TEST_LEVELS) {
    const run = { level: n, opt: L_opt(n), attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, n, (k, v) => findings.push({ k, v }));
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, moves: last.moves, stars: last.stars, ms: run.attempts.reduce((a, b) => a + b.ms, 0) });
    runs.push(run); try { const pf = require("path").join(__dirname, "partial-" + tierId + ".json"); require("fs").writeFileSync(pf, JSON.stringify({ runs, errors: sess.errors }, null, 1)); } catch (e) {}
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} moves=${run.moves}/${run.opt} stars=${run.stars} ${(run.ms / 1000).toFixed(1)}s`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, droppedSwipes: runs.reduce((a, r) => a + r.attempts.reduce((b, x) => b + x.dropped, 0), 0) } };
}

async function rapidInputProbe(browser) {
  // Superhuman-style probe: 3 swipes in quick succession during one slide animation.
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, 'superhuman', 42);
  await H.sleep(800);
  const n = 50, L = core.parseLevel(LEVELS[n - 1][0].split('/'));
  await sess.page.evaluate(n => window.__game.startLevel(n), n); await H.sleep(300);
  const sol = core.solve(L, 3e6).sol;
  const rect = await sess.page.evaluate(() => window.__game.boardRect());
  const cx = rect.x + rect.s * rect.w / 2, cy = rect.y + rect.s * rect.h / 2;
  for (let i = 0; i < 3; i++) { const d = sol[i]; await P.swipe(cx, cy, [0, 1, 0, -1][d] * 90, [-1, 0, 1, 0][d] * 90, { exact: true, steps: 3 }); }
  await waitIdle(sess.page); await H.sleep(300);
  const st = await getState(sess.page);
  await sess.ctx.close();
  return { level: n, swipesSent: 3, movesRegistered: st.moves, firstThreeOptimal: sol.slice(0, 3) };
}

(async () => {
  const browser = await H.launch();
  const findings = [];
  const out = { game: 'ice-slide', testedLevels: TEST_LEVELS, timeCap: '30 s + 2.5 s x optimal moves; swipe cap 2 x opt + 12', tiers: {}, findings: [] };
  const t0 = Date.now();
  for (const n of TEST_LEVELS) distMap(LV(n));
  const res = await Promise.all(TIER_LIST.map((t, i) => runTier(browser, t, i, findings)));
  TIER_LIST.forEach((t, i) => { out.tiers[t] = res[i]; });
  out.probe = await rapidInputProbe(browser);
  out.wallMs = Date.now() - t0;
  out.rawFindings = findings;
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'raw-results.json'), JSON.stringify(out, null, 1));
  console.log('probe', JSON.stringify(out.probe), 'wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
