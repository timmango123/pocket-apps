// Round 2 (release-review fixes, 2026-10-18): folds the new bot runs (r2-low.json, r2-mid.json, r2-top.json) and the
// offline sweeps into results.json under "round2", next to the earlier rounds, and prints the tier table.
// node finalize2.js [brain-sweep output] [offline planner output ...]
const fs = require('fs'), path = require('path');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));
const R = rd('results.json'), tiers = {};
for (const f of ['r2-low.json', 'r2-mid.json', 'r2-top.json']) if (fs.existsSync(path.join(__dirname, f))) Object.assign(tiers, rd(f).tiers);
const order = ['clumsy', 'casual', 'skilled', 'world', 'superhuman'].filter(t => tiers[t]);
const strip = v => ({ summary: v.summary, runs: v.runs.map(r => ({ level: r.level, cleared: r.cleared, tries: r.tries, stars: r.stars, time: r.time, attempts: r.attempts.map(a => ({ end: a.end, time: a.time, limit: a.limit, livesLost: a.livesLost, kills: a.kills, enemiesLeft: a.enemiesLeft, deaths: a.deaths, input: a.input })) })),
  battles: v.battles.map(b => ({ won: b.won, winner: b.winner, time: b.time })), errors: v.errors });
const extra = process.argv.slice(2).map(f => ({ file: path.basename(f), lines: fs.readFileSync(f, 'utf8').trim().split('\n') }));
R.round2 = {
  date: '2026-10-18', why: 'release review 9.2 (layout veto, fun 9.4): new monsters, crates, bosses, power-up runs, layout variants for a smooth curve',
  method: 'same bot.js / harness as before; every tested stage starts with the basic kit (__game.resetRun), look-ahead bots keep their last target while it stays safe (planner.js prev)',
  tiers: Object.fromEntries(order.map(t => [t, strip(tiers[t])])), sweeps: extra
};
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(R, null, 1));
const LV = R.testedLevels, NAME = { clumsy: '手殘', casual: '普通', skilled: '熟練', world: '世界級', superhuman: '非人' };
const cell = r => !r ? '-' : r.cleared ? '✔' + (r.tries > 1 ? '（第' + r.tries + '次）' : '') + (r.stars === 3 ? ' 3★' : '') : (r.attempts[r.attempts.length - 1].end === 'lost' && r.attempts[r.attempts.length - 1].livesLost < 3 && r.attempts[r.attempts.length - 1].time >= r.attempts[r.attempts.length - 1].limit - 1 ? '✘ 時間到' : '✘×' + r.tries);
console.log('| 等級 | ' + LV.join(' | ') + ' | 過關 | 對戰 |'); console.log('|' + '---|'.repeat(LV.length + 3));
for (const t of order) { const v = tiers[t]; console.log('| ' + NAME[t] + ' | ' + LV.map(n => cell(v.runs.find(r => r.level === n))).join(' | ') + ' | ' + v.summary.cleared + ' | ' + v.summary.battlesWon + ' |'); }
console.log('page errors:', order.map(t => t + ' ' + tiers[t].summary.pageErrors).join(', '));
