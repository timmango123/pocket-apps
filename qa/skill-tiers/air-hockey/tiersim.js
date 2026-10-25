// Headless tier simulation against the game's own core (CORE-START..CORE-END of the scored index.html).
// Usage: node tiersim.js <app index.html> <out.json> [--sweep]
const fs = require('fs');
const { makeTierBot, TIERS } = require('./tierbot.js');
const html = fs.readFileSync(process.argv[2], 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {newMatch, stepMatch, difficulty, targetScore};')();
const CAP = 600; // s of game time per attempt
function play(tier, n, seed) {
  const M = core.newMatch(n, { seed: seed }), bot = makeTierBot(tier, seed * 13 + n), hist = [];
  let t = 0, fx = M.m[1].x, fy = M.m[1].y, goals = 0, hits = 0;
  const dt = 1 / 60;
  while (!M.over && t < CAP) {
    const p = M.puck;
    hist.push({ t, px: p.x, py: p.y, pvx: p.vx, pvy: p.vy, on: p.on, freeze: M.freeze, mx: M.m[1].x, my: M.m[1].y, ox: M.m[0].x, oy: M.m[0].y });
    const D = bot.curDelay(t);
    while (hist.length > 2 && hist[1].t <= t - D) hist.shift();
    const seen = hist[0];
    const tg = bot.plan(seen, t, t - seen.t);
    const ddx = tg.x - fx, ddy = tg.y - fy, d = Math.hypot(ddx, ddy), st = bot.T.fspd * dt;
    if (d <= st) { fx = tg.x; fy = tg.y; } else { fx += ddx / d * st; fy += ddy / d * st; }
    M.m[1].tx = fx; M.m[1].ty = fy;
    core.stepMatch(M, dt);
    for (const e of M.ev) if (e.t === 'hit' && e.s === 1) hits++;
    M.ev.length = 0; t += dt;
  }
  return { win: M.winner === 1, score: M.score[1] + '-' + M.score[0], t: +t.toFixed(0), timeout: !M.over, shots: M.st.shots[1], hits };
}
const out = { game: 'air-hockey', note: 'game core extracted from the scored file; bot acts by setting the mallet target (what touch input does), sees state delayed per tier', tiers: {} };
const LEVELS = [1, 10, 25, 50, 75, 99, 100];
for (const tier of Object.keys(TIERS)) {
  const runs = [];
  for (const n of LEVELS) {
    const tries = [];
    for (let a = 0; a < TIERS[tier].attempts; a++) { const r = play(tier, n, 7000 + n * 31 + a * 997); tries.push(r); if (r.win) break; }
    // extra fixed-count sample for a win-rate (10 matches) independent of attempt rule
    let w = 0; for (let g = 0; g < 10; g++) if (play(tier, n, 91000 + n * 17 + g * 211).win) w++;
    runs.push({ level: n, cleared: tries.some(r => r.win), attempts: tries.length, tries, winRate10: w / 10 });
    console.log(tier, 'L' + n, tries.some(r => r.win) ? 'CLEARED' : 'failed', 'attempts', tries.length, tries.map(r => r.score + (r.timeout ? 'T' : '')).join(' '), 'win10', w + '/10');
  }
  out.tiers[tier] = { runs, summary: { cleared: runs.filter(r => r.cleared).map(r => r.level), meanWinRate: +(runs.reduce((s, r) => s + r.winRate10, 0) / runs.length).toFixed(2) } };
}
if (process.argv.includes('--sweep')) {
  out.sweep = {};
  for (const tier of ['clumsy', 'casual', 'skilled', 'world']) {
    const row = [];
    for (let n = 1; n <= 100; n++) { let w = 0; for (let g = 0; g < 4; g++) if (play(tier, n, 33000 + n * 7 + g * 101).win) w++; row.push(w); }
    out.sweep[tier] = row;
    const dec = []; for (let i = 0; i < 10; i++) dec.push(row.slice(i * 10, i * 10 + 10).reduce((a, b) => a + b, 0));
    console.log('SWEEP', tier, 'wins per decade (/40):', dec.join(' '));
  }
}
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
