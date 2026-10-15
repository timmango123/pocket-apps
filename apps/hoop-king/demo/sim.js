// Node verification for 投籃王 (hoop-king), using the game's own core (CORE-START/CORE-END).
// 1) Difficulty metric for all 100 levels (must strictly increase) + mechanic checkpoints.
// 2) "Scoring window": for sampled release times, the area of the (power, aim) grid that scores.
// 3) Auto-player: 200 simulated games per level. The bot plans with the noiseless physics using
//    information 150 ms old, waits for a moment where +-30 ms timing still scores, then shoots with
//    +-20 ms release jitter, +-3% power error and +-4 cm aim error, at most one
//    shot every 0.6 s. Success = final score >= target when the clock runs out (no early finish).
// Usage: [THREADS=2] node sim.js [games=200] [levels...]
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const HK = new Function(src + '\nreturn HK;')();
const K = HK.K;

function rand(seed) { return HK.rng(seed); }
function playGame(L, seed, opts) {
  opts = opts || {};
  const c = HK.levelCfg(L), g = new HK.Game(c, { noEarly: true }), r = rand(seed);
  const LAT = 0.15, PERR = 0.03, AERR = 0.04;
  let nextTry = 0.3 + r() * 0.3;
  while (!g.over) {
    if (g.t >= nextTry && g.canShoot()) {
      // decide using what was visible 150 ms ago (wind reading); hoop motion is periodic and learned
      const tr = g.t, wind = HK.windAt(c, Math.max(0, tr - LAT));
      const plan = HK.planShot(c, tr, wind, 0.03);
      if (plan) {
        const p = plan.p * (1 + (r() * 2 - 1) * PERR), x = plan.xT + (r() * 2 - 1) * AERR;
        // release timing jitter +-20 ms: step the world until the finger actually lets go
        const jit = Math.round((r() * 2 - 1) * 0.02 / K.DT); for (let j = 0; j < jit; j++) { g.step(); g.ev.length = 0; }
        if (g.over) break;
        g.shoot(p, x); nextTry = g.t + K.COOLDOWN;
      } else nextTry = g.t + 0.05;
    }
    g.step(); g.ev.length = 0;
  }
  return { score: g.score, win: g.score >= c.G, shots: g.shots, makes: g.makes, swishes: g.swishes };
}

function windowArea(L) {
  // average scoring area in (p, xT) over release times spread across one hoop period
  const c = HK.levelCfg(L), n = 8; let area = 0;
  for (let k = 0; k < n; k++) {
    const t = 2 + k * c.P / n, a = HK.aim(c, t); let cells = 0;
    for (let dp = -0.25; dp <= 0.25; dp += 0.025) for (let dx = -0.5; dx <= 0.5; dx += 0.05) {
      if (HK.simShot(c, t, a.p + dp, a.xT + dx).scored) cells++;
    }
    area += cells * 0.025 * 0.05;
  }
  return area / n;
}

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
function runLevel(L, GAMES) {
  let wins = 0, sum = 0, shots = 0, makes = 0, swishes = 0;
  for (let i = 0; i < GAMES; i++) { const r = playGame(L, L * 1000 + i); if (r.win) wins++; sum += r.score; shots += r.shots; makes += r.makes; swishes += r.swishes; }
  return { L, rate: wins / GAMES, avg: sum / GAMES, hit: makes / shots, area: windowArea(L) };
}
if (!isMainThread) {
  for (const L of workerData.levels) parentPort.postMessage(runLevel(L, workerData.games));
  parentPort.postMessage(null);
} else {
  const args = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  const GAMES = args[0] || 200;
  const levels = args.length > 1 ? args.slice(1) : Array.from({ length: 100 }, (_, i) => i + 1);
  const THREADS = +(process.env.THREADS || 2);
  let mono = true, minStep = 9;
  for (let L = 2; L <= 100; L++) { const s = HK.rawMetric(L) / HK.rawMetric(L - 1); if (s <= 1) mono = false; minStep = Math.min(minStep, s); }
  console.log('Difficulty metric strictly increasing over 100 levels:', mono, '| smallest level-to-level step: +' + ((minStep - 1) * 100).toFixed(1) + '%');
  console.log([1, 11, 26, 31, 41, 61, 76, 81, 91, 100].map(L => { const c = HK.levelCfg(L); return `L${L}: G=${c.G} S=${c.S}s A=${Math.round(c.Apx)}px P=${c.P.toFixed(2)}s V=${Math.round(c.V / 0.008)}px W=${c.W.toFixed(2)} dist=${c.D.toFixed(2)}m rim=${c.rimScale} obst=${c.obstacle ? 1 : 0} diff=${c.diff}`; }).join('\n'));
  const t0 = Date.now(), res = {}; let done = 0;
  const parts = Array.from({ length: THREADS }, (_, k) => levels.filter((_, i) => i % THREADS === k));
  parts.forEach(lv => {
    const w = new Worker(__filename, { workerData: { levels: lv, games: GAMES } });
    w.on('message', m => { if (m) { res[m.L] = m; process.stderr.write('.'); } else if (++done === THREADS) report(); });
  });
  function report() {
    let allOk = true, worst = null, prevArea = null;
    console.log('');
    for (const L of levels) {
      const r = res[L], c = HK.levelCfg(L), ok = r.rate >= 0.7 && r.avg >= c.G * 1.05;
      if (!ok) allOk = false; if (!worst || r.rate < worst.rate) worst = r;
      console.log(`L${String(L).padStart(3)} diff ${String(c.diff).padStart(3)} G ${String(c.G).padStart(2)} S ${c.S} | win ${(r.rate * 100).toFixed(0).padStart(3)}% avg ${r.avg.toFixed(1).padStart(5)} (${(r.avg / c.G).toFixed(2)}xG) hit ${(r.hit * 100).toFixed(0)}% | scoring window ${r.area.toFixed(3)}${ok ? '' : '  <-- FAIL'}`);
    }
    const a1 = levels.slice(0, 10).reduce((s, L) => s + res[L].area, 0) / Math.min(10, levels.length), a2 = levels.slice(-10).reduce((s, L) => s + res[L].area, 0) / Math.min(10, levels.length);
    console.log(`\nSUMMARY: ${levels.length} levels x ${GAMES} games. Every level success >= 70% and avg >= 1.05 G: ${allOk}. Lowest success: L${worst.L} ${(worst.rate * 100).toFixed(1)}%. Mean scoring window first 10 levels ${a1.toFixed(3)} -> last 10 ${a2.toFixed(3)}. (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
