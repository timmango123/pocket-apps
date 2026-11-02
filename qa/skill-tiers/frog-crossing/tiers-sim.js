// Copied from the release reviewer's qa/release/frog-crossing/tiers-sim.js; updated for the input queue (BUFMAX).
// Five-tier skill bots for frog-crossing (qa/skill-tiers/SPEC.md), simulated in Node on the game's own CORE
// (CORE-START/END of apps/frog-crossing/index.html) with a faithful copy of the page's world loop
// (sub-steps <= 1/60 s, exact input times, jump buffering, 1.0 s death / 0.45 s nest respawn, trip timer, 3 lives).
// Bot model: perception delayed by reaction time (it plans from the state predicted `react` later and can only act
// from then on), continuous re-planning every reaction interval, Gaussian timing noise on every input,
// a tier-dependent safety margin and look-ahead horizon, and random mistakes (wrong direction).
// Usage: node tiers-sim.js [tier...] [--levels 1,10,25] [--out file.json]
const fs = require('fs'), path = require('path');
const APP = process.env.APP || path.resolve(__dirname, '../../../apps/frog-crossing/index.html');
let html = fs.readFileSync(APP, 'utf8');
// experiment hook: NEED='n<=10?1:...' replaces the need formula of params()
if (process.env.NEED) html = html.replace(/function needOf\(n\) \{[^}]*\}/, 'function needOf(n) { return ' + process.env.NEED + '; }');
if (process.env.EASE) html = html.replace(/var EASE = [^;]+;/, 'var EASE = ' + process.env.EASE + ';');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {genLevel, params, plan, newFrog, stepFrog, tryJump, hazard, drift, TICK, ROWS, NESTS, JUMP};')();
function hash(n) { var x = Math.imul(n | 0, 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d) >>> 0; return (x ^ x >>> 12) >>> 0; }
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const TIERS = {
  clumsy:     { react: [0.65, 0.2], sigma: 0.12, mistake: 0.15, randomFrac: 0.5, horizon: 1.0, margin: 0.24, attempts: 5, gap: 0.35 },
  casual:     { react: [0.40, 0.1], sigma: 0.06, mistake: 0.06, randomFrac: 0.15, horizon: 1.6, margin: 0.12, attempts: 3, gap: 0.22 },
  skilled:    { react: [0.26, 0.05], sigma: 0.03, mistake: 0.02, randomFrac: 0, horizon: 3.0, margin: 0.06, attempts: 3, gap: 0.15 },
  world:      { react: [0.18, 0.025], sigma: 0.012, mistake: 0.003, randomFrac: 0, horizon: 8.0, margin: 0.03, attempts: 3, gap: 0.12 },
  superhuman: { react: [0.016, 0], sigma: 0, mistake: 0, randomFrac: 0, horizon: 20, margin: 0.0, attempts: 3, perfect: true }
};

function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---- faithful world model (mirrors simTo/stepOnce/statusTick/doJump of the page, worldScale 1) ----
function newWorld(n) {
  const L = C.genLevel(n, 0);
  const W = { L, n, t: 3 + (hash(n) % 1000) / 100, F: C.newFrog(), lives: 3, filled: [0, 0, 0, 0, 0], status: 'play', trip: L.T, best: C.ROWS - 1, buf: [], respawnAt: 0, deaths: 0, causes: [], score: 0, nests: 0, restSince: 0, jumps: 0, bumps: 0 };
  W.restSince = W.t; return W;
}
function clone(W) { return Object.assign({}, W, { F: Object.assign({}, W.F), filled: W.filled.slice(), causes: W.causes.slice(), buf: W.buf.slice() }); }
const BUFMAX = 8;
function spawn(W) { W.F = C.newFrog(); W.trip = W.L.T; W.best = C.ROWS - 1; W.buf = []; W.restSince = W.t; }
function doJump(W, d) { const r = C.tryJump(W.L, W.F, d, W.t, W.filled, 0); if (r) { if (r !== 'busy') W.bumps++; return; } W.jumps++; }
function applyInput(W, d) { if (W.status !== 'play') return; if (W.F.jt >= 0) { if (W.buf.length < BUFMAX) W.buf.push({ d, t: W.t }); return; } doJump(W, d); }
function die(W, cause) { if (W.status !== 'play') return; W.status = 'dying'; W.respawnAt = W.t + 1.0; W.lives--; W.deaths++; W.causes.push(cause + '@r' + W.F.row); W.buf = []; }
function statusTick(W) { if ((W.status === 'dying' || W.status === 'respawn') && W.t >= W.respawnAt - 1e-9) { if (W.status === 'dying' && W.lives <= 0) W.status = 'over'; else { spawn(W); W.status = 'play'; } } }
function reachNest(W, k) {
  W.filled[k] = 1; W.score += 50 + Math.ceil(W.trip) * 10; W.nests++;
  if (W.filled.reduce((a, b) => a + b, 0) >= W.L.need) { W.status = 'won'; W.score += 1000 + W.lives * 300; return; }
  W.status = 'respawn'; W.respawnAt = W.t + 0.45;
}
function stepOnce(W, h) {
  const t0 = W.t; W.t += h;
  if (W.status === 'play') {
    const F = W.F, wasJ = F.jt >= 0, res = C.stepFrog(W.L, F, t0, h, h, 0);
    if (res && res.nest != null && res.nest >= 0) { reachNest(W, res.nest); return; }
    if (res && res.cause) { die(W, res.cause); return; }
    if (wasJ && F.jt < 0) { W.restSince = W.t; if (F.row < W.best) { W.score += 10 * (W.best - F.row); W.best = F.row; } while (W.buf.length && W.F.jt < 0) doJump(W, W.buf.shift().d); /* the page's mashing guard (12+ taps/s) never applies to these bots */ }
    W.trip -= h; if (W.trip <= 1e-9) { W.trip = 0; die(W, 'time'); }
  } else if (W.status === 'dying' || W.status === 'respawn') statusTick(W);
}
// advance to tEnd applying queue (sorted [{t,d}]) inputs at exact times; consumes them from q
function simTo(W, tEnd, q) {
  let guard = 0;
  while (W.t < tEnd - 1e-9 && guard++ < 100000) {
    let h = Math.min(1 / 60, tEnd - W.t);
    if (q.length && q[0].t < W.t + h) h = Math.max(0, q[0].t - W.t);
    if ((W.status === 'dying' || W.status === 'respawn') && W.respawnAt < W.t + h) h = Math.max(0, W.respawnAt - W.t);
    if (W.status === 'play' && W.trip < h) h = Math.max(0, W.trip);
    if (W.status === 'play' && W.F.jt >= 0) { const rem = C.JUMP - W.F.jt; if (rem > 1e-9 && rem < h) h = rem; } // page lands exactly on time
    if (h > 1e-9) stepOnce(W, h); else { statusTick(W); if (W.status === 'play' && W.trip <= 1e-9) { W.trip = 0; die(W, 'time'); } }
    while (q.length && q[0].t <= W.t + 1e-9) applyInput(W, q.shift().d);
    if (W.status === 'won' || W.status === 'over') return;
  }
  while (q.length && q[0].t <= W.t + 1e-9) applyInput(W, q.shift().d);
}

// ---- bot ----
function planFrom(W, tier, rng) {
  // returns list of {t (abs), d}
  const F = { row: W.F.row, x: W.F.x, jt: -1 };
  const H = tier.horizon, ms = tier.perfect ? [0.02, 0] : [tier.margin, tier.margin / 2, 0];
  for (const m of ms) {
    const pl = C.plan(W.L, F, W.t, { margin: m, horizon: H, survive: Math.ceil(H / C.TICK), filled: W.filled, first: true, gap: Math.max(1, Math.ceil(((tier.gap || 0) - C.JUMP) / C.TICK - 1e-9)) });
    if (pl.path && pl.path.length) return pl.path.map(s => ({ t: W.t + s.t, d: s.d }));
    if (pl.path && !pl.path.length && m === ms[ms.length - 1]) return [];
  }
  return null;
}
function safeMoves(W, m) { // 1-step check of each direction (and waiting) from a resting frog
  const out = [];
  for (let d = -1; d < 4; d++) {
    const F = { row: W.F.row, x: W.F.x, jt: -1 }; let t = W.t, ok = true;
    if (d >= 0 && C.tryJump(W.L, F, d, t, W.filled, m)) continue;
    for (let i = 0; i < 15 && ok; i++) { const r = C.stepFrog(W.L, F, t, C.TICK, C.TICK, m); t += C.TICK; if (r) { if (r.cause) ok = false; else break; } }
    if (ok) out.push(d);
  }
  return out;
}
function runAttempt(n, tierId, seed, capSec) {
  const tier = TIERS[tierId], rng = mulberry(seed);
  const W = newWorld(n), start = W.t;
  let committed = [];   // [{t, d}] future inputs (actual times incl. noise)
  let nextThink = W.t + Math.max(0.016, tier.react[0] + tier.react[1] * gauss(rng));
  let inputs = 0, mistakes = 0, plans = 0;
  const sampleReact = () => Math.max(0.016, tier.react[0] + tier.react[1] * gauss(rng));
  while (W.status !== 'won' && W.status !== 'over' && W.t - start < capSec) {
    const tNext = Math.min(nextThink, committed.length ? committed[0].t : Infinity);
    const q = [];
    while (committed.length && committed[0].t <= tNext + 1e-9) { const c = committed.shift(); q.push(c); inputs++; if (c.mis) mistakes++; }
    simTo(W, tNext, q);
    if (W.status === 'won' || W.status === 'over') break;
    if (W.t < nextThink - 1e-9) continue;
    // think: perceive now, act no earlier than now + react
    const react = sampleReact();
    nextThink = W.t + (tier.perfect ? 0.6 : react);
    if (W.status !== 'play') { committed = []; continue; }
    if (tier.perfect && committed.length) continue; // superhuman follows its exact plan; replans only when it runs out
    // predict the world at tA = now + react given inputs already committed before tA
    const P = clone(W), tA = W.t + react, keep = committed.filter(c => c.t < tA);
    simTo(P, tA, keep.map(c => ({ t: c.t, d: c.d })));
    if (P.status !== 'play') continue; // the bot can't save itself in time; keep what it committed
    // let the in-flight jump land in the prediction
    const q2 = []; let g = 0; while (P.F.jt >= 0 && g++ < 20) simTo(P, P.t + 1 / 60, q2);
    if (P.status !== 'play') continue;
    plans++;
    let steps;
    if (tier.randomFrac && rng() < tier.randomFrac) {
      const mv = safeMoves(P, tier.margin / 2);
      const d = mv.length ? mv[Math.floor(rng() * mv.length)] : Math.floor(rng() * 4);
      steps = d >= 0 ? [{ t: P.t, d }] : [];
    } else {
      steps = planFrom(P, tier, rng);
      if (!steps) steps = [];
      if (!tier.perfect) steps = steps.slice(0, 4); // humans commit a few hops ahead, then look again
    }
    committed = keep.concat(steps.map(s => {
      let d = s.d, mis = false; if (tier.mistake && rng() < tier.mistake) { d = Math.floor(rng() * 4); mis = d !== s.d; }
      return { t: Math.max(tA, s.t + tier.sigma * gauss(rng)), d, mis };
    })).sort((a, b) => a.t - b.t);
    if (tier.perfect && !steps.length) nextThink = W.t + 0.04;
  }
  return { n, D: W.L.D, need: W.L.need, cleared: W.status === 'won', nests: W.nests, deaths: W.deaths, causes: W.causes, score: W.score, gameSec: +(W.t - start).toFixed(1), jumps: W.jumps, inputs, mistakes, plans, timedOut: W.status !== 'won' && W.status !== 'over' };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const li = args.indexOf('--levels'); const levels = li >= 0 ? args[li + 1].split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
  const oi = args.indexOf('--out'); const out = oi >= 0 ? args[oi + 1] : path.join(__dirname, 'tiers-sim.json');
  const tiers = args.filter(a => TIERS[a]); const list = tiers.length ? tiers : Object.keys(TIERS);
  const res = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { game: 'frog-crossing', model: 'tiers-sim.js', tiers: {} };
  for (const tid of list) {
    const tier = TIERS[tid], runs = [];
    for (const n of levels) {
      let a = 0, r, tries = [];
      const t0 = Date.now();
      do { a++; r = runAttempt(n, tid, n * 1000 + a * 17 + tid.length, 600); tries.push({ cleared: r.cleared, nests: r.nests, deaths: r.deaths, causes: r.causes, sec: r.gameSec, score: r.score }); } while (!r.cleared && a < tier.attempts);
      const row = { level: n, D: r.D, need: r.need, cleared: r.cleared, attempts: a, tries, inputs: r.inputs, mistakes: r.mistakes, wallMs: Date.now() - t0 };
      runs.push(row);
      console.log(tid, 'L' + n, 'D' + r.D, r.cleared ? 'CLEARED' : 'not cleared', 'attempts', a, tries.map(x => x.nests + 'n/' + x.deaths + 'd ' + x.sec + 's' + (x.cleared ? '' : ' [' + x.causes.join(',') + ']')).join(' | '), (Date.now() - t0) + 'ms');
    }
    res.tiers[tid] = { runs, summary: { cleared: runs.filter(r => r.cleared).map(r => r.level), notCleared: runs.filter(r => !r.cleared).map(r => r.level) } };
    fs.writeFileSync(out, JSON.stringify(res, null, 1));
  }
}
module.exports = { runAttempt, TIERS, C, newWorld };
