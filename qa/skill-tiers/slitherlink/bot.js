// 數回 (slitherlink) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...] [--out=raw-results.json]
// Reads the screen state through window.__game (edge marks, clue layout, red marks after 檢查) and acts only through
// real CDP touch input: taps on edges, one-finger drags, two-finger pinch / pan, taps on the 檢查 / 復原 buttons.
// Tiers differ in deduction depth (what they can reason out), thinking time, motor noise and mistake rate:
//   clumsy  : cell + vertex rules only            casual : + "no premature loop"
//   skilled : + corner pairs (3/1 in corners ...) world  : + one-level trial ("suppose ... contradiction") up to 20 steps
//   superhuman : knows the answer and traces the whole loop in one frame-perfect drag.
// When stuck a bot guesses a line at an open end; when its own reasoning hits a contradiction it presses 檢查 and erases
// the red marks. Thinking / reaction time is accounted on a virtual clock (taps themselves are sent in real time, ~40 ms
// apart) so the run fits the wall-time budget; the attempt fails when the virtual clock passes the cap.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/slitherlink/index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {parseLevel, loadState, stepFind, newState, levelParams};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

const args = process.argv.slice(2);
const tiers = args.filter(a => H.TIERS[a]);
const TIER_LIST = tiers.length ? tiers : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const outArg = args.find(a => a.startsWith('--out='));
const OUT = outArg ? outArg.slice(6) : 'raw-results.json';

const KNOW = { clumsy: [1, 0], casual: [2, 0], skilled: [3, 0], world: [4, 20], superhuman: [4, 30] };
const THINK = { clumsy: 2600, casual: 1500, skilled: 1000, world: 650, superhuman: 0 };   // ms per deduction (basic rule)
const AIM = 0.3;
const GIVEUP = { clumsy: 3, casual: 4, skilled: 5, world: 6, superhuman: 99 };   // fruitless 檢查 rounds before giving up an attempt
const TECHF = { 1: 1, 2: 1.6, 3: 2.3, 4: 3 };
const NOTICE = { clumsy: 0.5, casual: 0.75, skilled: 0.92, world: 1, superhuman: 1 };      // spots its own mis-tap
const parOf = n => Math.round((30 + LEVELS[n - 1][1] * 1.5) / 10) * 10;                     // the game's 3-star time (s)
const capOf = n => (3 * parOf(n) + 120) * 1000;                                                        // per-attempt virtual time cap

async function G(page, f, a) { return page.evaluate(f, a); }
const TECH_LEVEL = { zero: 1, cellX: 1, cellL: 1, vFull: 1, vDead: 1, vExt: 1, loop: 2, corner: 3, trial: 4 };

async function pinchZoom(P, factor) {
  const a = await G(P.page, () => window.__game.area()), cx = a.x + a.w / 2, cy = a.y + a.h / 2, d0 = 50, d1 = d0 * factor;
  await P.touch('touchStart', [{ x: cx - d0, y: cy, id: 1 }, { x: cx + d0, y: cy, id: 2 }]);
  for (let k = 1; k <= 8; k++) { const d = d0 + (d1 - d0) * k / 8; await H.sleep(16); await P.touch('touchMove', [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }]); }
  await P.touch('touchEnd', []); await H.sleep(60);
}
async function pan(P, dx, dy) {
  const a = await G(P.page, () => window.__game.area()), cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  await P.touch('touchStart', [{ x: cx - 40, y: cy, id: 1 }, { x: cx + 40, y: cy, id: 2 }]);
  for (let k = 1; k <= 8; k++) { await H.sleep(16); await P.touch('touchMove', [{ x: cx - 40 + dx * k / 8, y: cy + dy * k / 8, id: 1 }, { x: cx + 40 + dx * k / 8, y: cy + dy * k / 8, id: 2 }]); }
  await P.touch('touchEnd', []); await H.sleep(60);
}
// screen position of an edge, panning first if it is outside the comfortable part of the play area
async function edgeOnScreen(P, e) {
  for (let g = 0; g < 4; g++) {
    const [x, y] = await G(P.page, e => window.__game.edgeXY(e), e), a = await G(P.page, () => window.__game.area());
    const z = (await G(P.page, () => window.__game.state())).zoom || 1;
    if (z < 1.05) return [x, y];          // board at fit size: everything is already on screen
    const m = 30, okX = x > a.x + m && x < a.x + a.w - m, okY = y > a.y + m && y < a.y + a.h - m;
    if (okX && okY) return [x, y];
    await pan(P, okX ? 0 : a.x + a.w / 2 - x, okY ? 0 : a.y + a.h / 2 - y); P.pans++;
  }
  return G(P.page, e => window.__game.edgeXY(e), e);
}

async function playAttempt(P, n, rec) {
  const page = P.page, tier = P.tierId;
  await G(page, n => window.__game.start(n, true), n); await H.sleep(250);
  if (await page.isVisible('#iOk')) { await P.tapSelector('#iOk'); await H.sleep(200); }
  if (await page.isVisible('#hintBox')) { await P.tapSelector('#hintX'); await H.sleep(120); }
  const pz = await G(page, () => window.__game.puzzle()), PZ = core.parseLevel(pz.code), sol = await G(page, () => window.__game.sol());
  const cap = capOf(n), t0 = Date.now();
  const r = { level: n, cleared: false, vms: 0, taps: 0, tapMiss: 0, misTaps: 0, unnoticed: 0, guesses: 0, wrongGuesses: 0, mistakes: 0, checks: 0, undos: 0, drags: 0, zoom: 1, deductions: 0, byTech: {} };
  P.pans = 0;
  if (tier === 'superhuman') {
    // trace the solution loop in one frame-perfect drag through every vertex
    const order = []; const W1 = PZ.W + 1; let start = sol.findIndex(v => v), used = new Set([start]); let v = PZ.ev[2 * start]; order.push(v); v = PZ.ev[2 * start + 1]; order.push(v);
    for (;;) { let nx = -1; for (let k = 0; k < 4; k++) { const f = PZ.ve[v * 4 + k]; if (f >= 0 && sol[f] && !used.has(f)) { nx = f; break; } } if (nx < 0) break; used.add(nx); v = PZ.ev[2 * nx] === v ? PZ.ev[2 * nx + 1] : PZ.ev[2 * nx]; order.push(v); }
    const pts = []; for (const vv of order) pts.push(await G(page, v => window.__game.vertexXY(v), vv));
    await P.touch('touchStart', [{ x: pts[0][0], y: pts[0][1], id: 1 }]);
    for (let i = 1; i < pts.length; i++) for (let k = 1; k <= 3; k++) { await H.sleep(5); await P.touch('touchMove', [{ x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k / 3, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k / 3, id: 1 }]); }
    await P.touch('touchEnd', []); r.drags = 1; r.vms = pts.length * 16;
    await H.sleep(200);
    const st = await G(page, () => window.__game.state());
    r.cleared = st.won; r.lines = st.lines; r.solLines = st.solLines;
    if (st.won) { await H.sleep(1900); r.winOverlay = await page.isVisible('#win'); r.stars = await G(page, n => (window.__game.progress()[n] || {}).s || 0, n); }
    r.ms = Date.now() - t0; return r;
  }
  // humans zoom in when cells get small
  const cell = await G(page, () => window.__game.cellSize());
  const wantCell = { clumsy: 58, casual: 48, skilled: 40, world: 34 }[tier];
  if (cell < wantCell - 2) { await pinchZoom(P, Math.min(3.2, wantCell / cell)); r.zoom = +(await G(page, () => window.__game.state())).zoom.toFixed(2); }
  const [lvl, chain] = KNOW[tier];
  let focus = [PZ.W / 2, PZ.H / 2], stall = 0, bestRight = -1, noGain = 0; const guessAt = [];
  async function setTo(e, v) { // tap an edge until it shows v (line mode: blank -> line -> X -> blank)
    for (let guard = 0; guard < 6; guard++) {
      // one round trip: marks, zoom and the screen points this action needs
      let q = await G(page, ([e, a, b]) => { const g = window.__game; const st = g.state(); return { E: g.E(), z: st.zoom || 1, won: st.won, p: g.edgeXY(e), A: g.vertexXY(a), B: g.vertexXY(b), ar: g.area() }; }, [e, PZ.ev[2 * e], PZ.ev[2 * e + 1]]);
      let E = q.E;
      if (E[e] === v) return true;
      if (q.won) return false;   // solved already (the loop closed earlier than this plan)
      if (r.vms > cap) return false;
      let x, y;
      if (q.z < 1.05) [x, y] = q.p; else [x, y] = await edgeOnScreen(P, e);
      const before = E;
      r.vms += Math.max(120, P.reactMs() * 0.6);
      if (v === 1 && E[e] === 0) { // lines are drawn the way people do: a short drag from dot to dot, a little past the end
        let A = q.A, B = q.B;
        if (q.z >= 1.05) { A = await G(page, v => window.__game.vertexXY(v), PZ.ev[2 * e]); B = await G(page, v => window.__game.vertexXY(v), PZ.ev[2 * e + 1]); }
        const [sx, sy] = P.jitter(A[0], A[1]), lat = P.t.pos ? P.rng.gauss(0, P.t.pos) : 0, ux = B[0] - A[0], uy = B[1] - A[1], L = Math.hypot(ux, uy) || 1;
        const ex = B[0] + ux * 0.22 - uy / L * lat, ey = B[1] + uy * 0.22 + ux / L * lat;
        await P.touch('touchStart', [{ x: sx, y: sy, id: 1 }]);
        for (let k = 1; k <= 6; k++) { await H.sleep(12); await P.touch('touchMove', [{ x: sx + (ex - sx) * k / 6, y: sy + (ey - sy) * k / 6, id: 1 }]); }
        await P.touch('touchEnd', []); r.drags++;
      } else { await P.tap(x, y); }
      r.taps++; await H.sleep(28);
      E = await G(page, () => window.__game.E());
      const changed = []; for (let i = 0; i < E.length; i++) if (E[i] !== before[i]) changed.push(i);
      if (!changed.length) { r.tapMiss++; if (process.env.DBG) console.log("MISS", e, v, E[e], Math.round(x), Math.round(y), q.z, JSON.stringify(q.ar), v === 1 && E[e] === 0 ? "drag" : "tap", JSON.stringify(await G(page, () => window.__game.state()))); continue; }
      if (changed.length === 1 && changed[0] === e) continue;
      r.misTaps++;
      if (P.rng() < NOTICE[tier]) { r.vms += P.reactMs(); await P.tapSelector('#bUndo'); r.undos++; await H.sleep(28); }
      else r.unnoticed++;
    }
    return false;
  }
  while (r.vms < cap) {
    const { st, E } = await G(page, () => ({ st: window.__game.state(), E: window.__game.E() }));
    if (st.won) { r.cleared = true; break; }
    const S = core.loadState(PZ, E);
    let d = S ? core.stepFind(PZ, S, lvl, focus, chain || 30) : { contra: true };
    if (!d || d.contra) {
      if (d && d.contra || !E.some(v => v === 0)) {
        // something is wrong: press 檢查, then erase every red mark
        r.vms += P.thinkMs ? THINK[tier] * 1.5 : 0; await P.tapSelector('#bCheck'); r.checks++; await H.sleep(60);
        const lc = await G(page, () => window.__game.lastCheck()) || { wrong: 0, located: false };
        const bad = lc.located ? await G(page, () => window.__game.flash()) : [];
        for (const e of bad) await setTo(e, 0);
        if (lc.wrong && !lc.located) {
          // the level's error-finding uses are spent: 檢查 only says how many marks are wrong. Back up a stretch of
          // moves with 復原 and reason again from there (what the game's message suggests)
          // if they guessed earlier, they undo back to just before the last guess and mark that edge ✕ instead
          r.backups = (r.backups || 0) + 1;
          const g = guessAt.pop(), u0 = await G(page, () => window.__game.state().undo);
          const k = g && g.u < u0 ? u0 - g.u : 4 + P.rng.int(9);
          for (let i = 0; i < k; i++) { if (!(await G(page, () => window.__game.state().undo))) break; r.vms += P.reactMs() * 0.5; await P.tapSelector('#bUndo'); r.undos++; await H.sleep(20); }
          if (g && g.u < u0) await setTo(g.e, 2);
        } else if (!bad.length) stall++;
        if (stall > 6) break;
        // a human gives an attempt up after several 檢查 rounds that bring no net progress
        const E2 = await G(page, () => window.__game.E()); let right = 0; for (let i = 0; i < E2.length; i++) if (E2[i] && (E2[i] === 1) === !!sol[i]) right++;   // marks that agree with the answer
        if (right > bestRight) { bestRight = right; noGain = 0; } else if (lc.wrong && !lc.located && ++noGain >= GIVEUP[tier]) { r.gaveUp = true; break; }   // lost: errors it can no longer locate
        continue;
      }
      // stuck: guess a line at an open end (or next to the biggest clue)
      let ge = -1;
      for (let v = 0; v < PZ.NVX && ge < 0; v++) { let on = 0, u = []; for (let k = 0; k < 4; k++) { const f = PZ.ve[v * 4 + k]; if (f < 0) continue; if (E[f] === 1) on++; else if (E[f] === 0) u.push(f); } if (on === 1 && u.length) ge = P.rng.pick(u); }
      if (ge < 0) { const cells = []; for (let c = 0; c < PZ.NC; c++) if (PZ.clue[c] >= 2) for (let k = 0; k < 4; k++) if (!E[PZ.ce[4 * c + k]]) cells.push(PZ.ce[4 * c + k]); ge = cells.length ? P.rng.pick(cells) : E.findIndex(v => v === 0); }
      r.guesses++; if (!sol[ge]) r.wrongGuesses++;
      r.vms += THINK[tier] * 2;
      guessAt.push({ e: ge, u: (await G(page, () => window.__game.state().undo)) });   // remembered: "I guessed here"
      await setTo(ge, 1);
      continue;
    }
    stall = 0;
    const tl = TECH_LEVEL[d.t] || 1;
    r.deductions++; r.byTech[d.t] = (r.byTech[d.t] || 0) + 1;
    r.vms += THINK[tier] * TECHF[tl] * (d.t === 'trial' ? 1 + 0.35 * d.steps : 1) * (0.6 + P.rng() * 0.8);
    let set = d.set.map(s => s.slice());
    if (P.mistake()) { const k = P.rng.int(set.length); set[k][1] = set[k][1] === 1 ? 2 : 1; r.mistakes++; }
    for (const [e, v] of set) { if (!(await setTo(e, v))) break; focus = [(PZ.ev[2 * e] % (PZ.W + 1) + PZ.ev[2 * e + 1] % (PZ.W + 1)) / 2, (((PZ.ev[2 * e] / (PZ.W + 1)) | 0) + ((PZ.ev[2 * e + 1] / (PZ.W + 1)) | 0)) / 2]; }
  }
  const st = await G(page, () => window.__game.state());
  r.cleared = st.won;
  if (st.won) { await H.sleep(1900); r.winOverlay = await page.isVisible('#win'); r.stars = await G(page, n => (window.__game.progress()[n] || {}).s || 0, n); }
  r.lines = st.lines; r.solLines = st.solLines; r.pans = P.pans; r.ms = Date.now() - t0; r.vms = Math.round(r.vms); r.capMs = cap;
  return r;
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, tierId, 1000 + idx * 7919);
  // a slitherlink tap is aimed at a still target with no time pressure (σ ≈ 1.5–3 mm in touch studies), so the generic
  // positional noise of the harness (made for action games) is scaled by AIM here; see notes.md
  P.t = Object.assign({}, P.t, { pos: P.t.pos * AIM });
  await H.sleep(700);
  await sess.page.evaluate(() => { try { localStorage.setItem('slitherlink:v1:seen', JSON.stringify({ coach: 1, zoomTip: 1 })); localStorage.setItem('slitherlink:v1:settings', JSON.stringify({ sound: 0, vib: 0, dim: 1 })); } catch (e) {} });
  const runs = [];
  for (const n of TEST_LEVELS) {
    const run = { level: n, size: LEVELS[n - 1][0].split(',').slice(0, 2).join('x'), score: LEVELS[n - 1][1], par: parOf(n), attempts: [], cleared: false };
    for (let a = 1; a <= P.t.attempts; a++) {
      const r = await playAttempt(P, n);
      run.attempts.push(r);
      console.log(`  [${tierId}] L${n} try ${a}: ${r.cleared ? 'clear' : r.gaveUp ? 'gave up' : 'out of time'} v=${Math.round(r.vms / 1000)}s lines ${r.lines}/${r.solLines} taps=${r.taps} mis=${r.misTaps} guesses=${r.guesses} checks=${r.checks} backups=${r.backups || 0} wall=${Math.round(r.ms / 1000)}s`);
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, vSecs: Math.round(last.vms / 1000), stars: last.stars || 0, wallSecs: Math.round(run.attempts.reduce((a, b) => a + b.ms, 0) / 1000) });
    runs.push(run);
    fs.writeFileSync(path.join(__dirname, 'partial-' + tierId + '.json'), JSON.stringify({ runs, errors: sess.errors }, null, 1));
    console.log(`[${tierId}] L${n} ${run.size} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} vtime=${run.vSecs}s/cap ${capOf(n) / 1000}s stars=${run.stars} taps=${last.taps} misTaps=${last.misTaps} guesses=${last.guesses} checks=${last.checks} wall=${run.wallSecs}s`);
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  const all = runs.flatMap(r => r.attempts);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: all.length,
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, taps: all.reduce((a, x) => a + (x.taps || 0), 0), tapMiss: all.reduce((a, x) => a + (x.tapMiss || 0), 0), misTaps: all.reduce((a, x) => a + (x.misTaps || 0), 0) } };
}

// 8 taps per second, alternating between two edges with real touch events: every tap must land exactly once
async function rapidTapProbe(browser) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const P = new H.Player(sess, 'superhuman', 42);
  await H.sleep(700);
  await sess.page.evaluate(() => { localStorage.setItem('slitherlink:v1:seen', JSON.stringify({ coach: 1, zoomTip: 1 })); window.__game.start(25, true); });
  await H.sleep(400);
  const a = await G(sess.page, () => window.__game.edgeXY(30)), b = await G(sess.page, () => window.__game.edgeXY(31));
  const N = 24;
  for (let i = 0; i < N; i++) { const p = i % 2 ? b : a; await P.touch('touchStart', [{ x: p[0], y: p[1], id: 1 }]); await H.sleep(45); await P.touch('touchEnd', []); await H.sleep(80); }
  await H.sleep(200);
  const st = await G(sess.page, () => window.__game.state()), E = await G(sess.page, () => window.__game.E());
  await sess.ctx.close();
  // each edge got 12 taps: 12 mod 3 = 0 -> blank again; the undo stack holds one entry per tap
  return { tapsSent: N, undoEntries: st.undo, edgeStates: [E[30], E[31]], ok: st.undo === N && E[30] === 0 && E[31] === 0, errors: sess.errors };
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'slitherlink', testedLevels: TEST_LEVELS, timeCap: '3 x the level\'s 3-star time + 2 min (virtual clock); an attempt is also abandoned after several fruitless 檢查 rounds', tiers: {} };
  const t0 = Date.now();
  for (let i = 0; i < TIER_LIST.length; i++) out.tiers[TIER_LIST[i]] = await runTier(browser, TIER_LIST[i], i);
  if (!lvArg) out.probe = await rapidTapProbe(browser);
  out.wallMs = Date.now() - t0;
  await browser.close();
  fs.writeFileSync(path.join(__dirname, OUT), JSON.stringify(out, null, 1));
  console.log('probe', JSON.stringify(out.probe), 'wall', (out.wallMs / 1000).toFixed(0) + 's');
})().catch(e => { console.error(e); process.exit(1); });
