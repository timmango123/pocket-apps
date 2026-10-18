// Builds results.json from the per-tier partial files (the run was stopped after the wall-time cap) or a raw file.
// Usage: node assemble.js <before|after> [raw.json]
const fs = require('fs'), path = require('path');
const which = process.argv[2] || 'before';
const tiers = ['clumsy', 'casual', 'skilled', 'world', 'superhuman'];
const TEST = [1, 10, 25, 50, 75, 99, 100];
let src = {};
if (process.argv[3]) src = JSON.parse(fs.readFileSync(path.join(__dirname, process.argv[3]), 'utf8')).tiers;
else for (const t of tiers) { const f = path.join(__dirname, 'partial-' + t + '.json'); if (fs.existsSync(f)) src[t] = JSON.parse(fs.readFileSync(f, 'utf8')); }
const star3 = p => Math.max(p + 2, Math.ceil(p * 11 / 10)), star2 = p => Math.max(p + 6, Math.ceil(p * 16 / 10));
const starsNow = (m, p) => m <= star3(p) ? 3 : m <= star2(p) ? 2 : 1;
if (which !== 'before') for (const t of Object.keys(src)) for (const r of src[t].runs) if (r.cleared) { r.starsAtRun = r.stars; r.stars = starsNow(r.moves, r.par); }
const out = {};
for (const t of tiers) {
  const v = src[t]; if (!v) continue;
  const runs = v.runs, cl = runs.filter(r => r.cleared);
  const sumA = k => runs.reduce((a, r) => a + r.attempts.reduce((b, x) => b + (x[k] || 0), 0), 0);
  const notRun = TEST.filter(n => !runs.find(r => r.level === n));
  out[t] = { runs, errors: v.errors, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), notRun, totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, droppedPushes: sumA('dropped'), doubleCounted: sumA('doubleCounted'), missWalks: sumA('missWalks'), walkTaps: sumA('walkTaps'), undos: sumA('undos'), pageErrors: v.errors.length } };
}
const file = path.join(__dirname, 'results.json');
let res = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { game: 'sokoban', testedLevels: TEST };
if (which === 'before') { res.tiers = out; } else if (process.env.PROBE) { res.afterFix = res.afterFix || {}; res.afterFix.probe = JSON.parse(fs.readFileSync(path.join(__dirname, process.env.PROBE), 'utf8')).probe; } else { res.afterFix = Object.assign(res.afterFix || {}, { tiers: Object.assign((res.afterFix || {}).tiers || {}, out) }); }
fs.writeFileSync(file, JSON.stringify(res, null, 1));
for (const t of tiers) if (out[t]) console.log(t, out[t].summary.cleared, JSON.stringify(out[t].runs.map(r => [r.level, r.cleared ? 'C' : 'x', r.tries, r.moves + '/' + r.par])), 'drop', out[t].summary.droppedPushes, 'dbl', out[t].summary.doubleCounted, 'miss', out[t].summary.missWalks + '/' + out[t].summary.walkTaps);
