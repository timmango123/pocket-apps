// Independent skill-tier simulation for 螢火迷宮 (firefly-maze), per qa/skill-tiers/SPEC.md.
// Uses the game's own deterministic core (CORE-START..CORE-END of apps/firefly-maze/index.html, or $APP) and the planner
// from the app's demo/bot.js, wrapped with per-tier human models:
//   reaction latency (ticks) sampled per press from N(mean, sd) + timing sigma, planner predicts with the mean,
//   decision quality (search depth, random choice share kept per junction), mis-swipe rate (wrong direction),
//   perception interval (how often the bot looks at the screen).
// Usage: node tiersim.js <tier> [levels...]   -> appends JSON lines to $OUT/tier-<tier>.jsonl (default: this folder)
const fs = require('fs'), path = require('path');
const B = require('../../../apps/firefly-maze/demo/bot.js');
const C = B.loadCore(process.env.APP || path.join(__dirname, '../../../apps/firefly-maze/index.html'));
const TIERS = {
  clumsy:     { react: 650, rsd: 200, tsd: 120, mistake: 0.15, rand: 0.5,  depth: 0, hor: 90,  think: 8, attempts: 5, pressAt: 9 },
  casual:     { react: 400, rsd: 100, tsd: 60,  mistake: 0.06, rand: 0.15, depth: 1, hor: 120, think: 5, attempts: 3, pressAt: 9 },
  skilled:    { react: 260, rsd: 50,  tsd: 30,  mistake: 0.02, rand: 0,    depth: 2, hor: 150, think: 3, attempts: 3, pressAt: 7 },
  world:      { react: 180, rsd: 25,  tsd: 12,  mistake: 0.003, rand: 0,   depth: 4, hor: 180, think: 2, attempts: 3 },
  superhuman: { react: 16,  rsd: 0,   tsd: 0,   mistake: 0,    rand: 0,    depth: 5, hor: 200, think: 1, attempts: 3 },
};
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function run(n, T, seed) {
  const L = C.buildLevel(n), S = C.newState(L, { assist: !!process.env.ASSIST }), bot = B.makeBot(C, L, { depth: Math.max(1, T.depth), horizon: T.hor, pressAt: T.pressAt });
  let s = (seed * 2654435761) >>> 0; const rng = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const LAT = Math.max(1, Math.round(T.react / 16.67));
  // decision quality: depth 0 = greedy (plan with depth 1 but only one-step value), random share fixed per junction
  const orig = bot.plan, randMemo = new Map();
  bot.plan = Sp => {
    const res = orig(Sp);
    if (res.length > 1 && T.rand > 0) {
      const turns = res.filter(r => r.kind === 'turn');
      if (turns.length > 1) {
        const k = turns[0].at + ':' + Math.floor((Sp.tick + turns[0].ticks) / 30);
        if (!randMemo.has(k)) randMemo.set(k, rng() < T.rand ? turns[(rng() * turns.length) | 0].dir : -1);
        const d = randMemo.get(k);
        if (d >= 0) { const i = res.findIndex(r => r.kind === 'turn' && r.dir === d); if (i > 0) res.unshift(res.splice(i, 1)[0]); }
      }
    }
    return res;
  };
  let queue = [], lastPress = -99, nextThink = 0, presses = 0, misses = 0;
  while (S.status !== 'won' && S.status !== 'lost' && S.tick < 60 * 480) {
    let inp = -1;
    if (queue.length && queue[0].at <= S.tick) inp = queue.shift().dir;
    C.step(L, S, inp);
    if (S.tick >= nextThink && !queue.length) {
      const r = B.decide(C, L, bot, S, LAT, lastPress);
      if (r.press >= 0) {
        const ms = Math.max(16, T.react + gauss(rng) * T.rsd + gauss(rng) * T.tsd);
        const lat = Math.max(1, Math.round(ms / 16.67));
        let dir = r.press;
        if (rng() < T.mistake) { dir = (dir + 1 + ((rng() * 3) | 0)) & 3; misses++; }
        if (S.tick + lat - lastPress >= (T.react < 50 ? 1 : 9)) { queue.push({ at: S.tick + lat, dir }); lastPress = S.tick + lat; presses++; }
      }
      nextThink = S.tick + T.think + ((rng() * 2) | 0);
    }
  }
  return { n, won: S.status === 'won', end: S.status, lives: S.lives, deaths: S.deaths, score: S.score, secs: +(S.tick / 60).toFixed(1), left: S.left, total: L.total, presses, misSwipes: misses };
}
if (require.main !== module) { module.exports = { run, TIERS }; return; }
const tier = process.argv[2], T = Object.assign({}, TIERS[tier], process.env.OVR ? JSON.parse(process.env.OVR) : {});
const levels = process.argv.slice(3).map(Number);
const out = path.join(process.env.OUT || __dirname, 'tier-' + tier + (process.env.ASSIST ? '-assist' : '') + '.jsonl');
for (const n of levels.length ? levels : [1, 10, 25, 50, 75, 99, 100]) {
  const runs = [];
  for (let k = 1; k <= T.attempts; k++) {
    const t0 = Date.now(); const r = run(n, T, n * 100 + k); r.attempt = k; r.cpuSec = (Date.now() - t0) / 1000; runs.push(r);
    if (r.won) break;
  }
  const line = { tier, n, cleared: runs.some(r => r.won), attempts: runs.length, runs };
  fs.appendFileSync(out, JSON.stringify(line) + '\n');
  console.log(tier, 'L' + n, line.cleared ? 'CLEARED' : 'FAILED', 'attempts', runs.length, runs.map(r => `${r.end} d${r.deaths} left${r.left}/${r.total} ${r.secs}s cpu${r.cpuSec}`).join(' | '));
}
