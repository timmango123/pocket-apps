// Builds results.json from the raw runs: before = original game (results-before.json + the L100 re-run with the
// longer wall-clock guard in before-l100.json), afterFix = the fixed game (results-after.json [+ after-extra.json]).
const fs = require('fs'), path = require('path');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const B = rd('results-before.json'), L = fs.existsSync(path.join(__dirname, 'before-l100.json')) ? rd('before-l100.json') : null;
if (L) for (const t of Object.keys(L.tiers)) { const runs = B.tiers[t].runs; const i = runs.findIndex(r => r.level === 100); runs[i] = L.tiers[t].runs[0]; }
function summarize(v) {
  const cl = v.runs.filter(r => r.cleared);
  v.summary = Object.assign({}, v.summary, { cleared: cl.length + '/' + v.runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: v.runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0 });
  return v;
}
for (const t of Object.keys(B.tiers)) summarize(B.tiers[t]);
const A = rd('results-after.json');
for (const t of Object.keys(A.tiers)) summarize(A.tiers[t]);
const extra = fs.existsSync(path.join(__dirname, 'after-extra.json')) ? rd('after-extra.json') : null;
const strip = v => ({ summary: v.summary, runs: v.runs.map(r => ({ level: r.level, cleared: r.cleared, tries: r.tries, stars: r.stars, time: r.time, attempts: r.attempts.map(a => ({ end: a.end, time: a.time, limit: a.limit, livesLost: a.livesLost, kills: a.kills, enemiesLeft: a.enemiesLeft, deaths: a.deaths, input: a.input })) })),
  battles: v.battles.map(b => ({ won: b.won, winner: b.winner, time: b.time })), errors: v.errors });
const out = {
  game: 'bomb-maze', testedLevels: B.testedLevels, battles: '2 per tier, 1 vs 3 CPU (普通)',
  method: 'Real touch (CDP) on the joystick and bomb button at 390x844 in headless Chromium, lock-stepped clock (harness.js LOCKSTEP). clumsy/casual: bot.js simpleDecide; skilled: the game\'s own CPU brain; world/superhuman: planner.js (brain + look-ahead veto). Bots read state through window.__game.sim() and act only through touch.',
  timeCap: 'the stage timer (150-280 s); battle 200 s',
  tiers: B.tiers, findings: JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8')),
  afterFix: { tiers: Object.fromEntries(Object.entries(A.tiers).map(([k, v]) => [k, strip(v)])), extra: extra ? Object.fromEntries(Object.entries(extra.tiers).map(([k, v]) => [k, strip(summarize(v))])) : undefined }
};
if (fs.existsSync(path.join(__dirname, 'after-world99.json'))) out.afterFix.worldL99Retry = strip(summarize(rd('after-world99.json').tiers.world));
out.afterFix.note = 'skilled/world/superhuman ran before the last fix (bigger joystick hit area; they never missed the stick), clumsy/casual and the extra runs after it. world L99 timed out once with 6/7 monsters (one attempt: a time-out ends the level, as in the before run); a second run cleared it (worldL99Retry). extra = clumsy on stages 2, 3, 5.';
const prev = fs.existsSync(path.join(__dirname, 'results.json')) ? rd('results.json') : {};
if (prev.round2) out.round2 = prev.round2;   // kept: written by finalize2.js
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
const row = (v, lv) => lv.map(n => { const r = v.runs.find(x => x.level === n); return r ? (r.cleared ? '✔' + (r.tries > 1 ? '(' + r.tries + ')' : '') : '✘×' + r.tries) : '-'; }).join(' | ');
for (const [name, T] of [['before', B.tiers], ['after', A.tiers]]) { console.log(name); for (const t of Object.keys(T)) console.log(t, row(T[t], B.testedLevels), T[t].summary.cleared, 'battles', T[t].summary.battlesWon, 'err', T[t].summary.pageErrors); }
