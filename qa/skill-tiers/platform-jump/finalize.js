// builds results.json from raw-results.json (browser runs) and sim-results.json (extra node simulation runs, optional)
const fs = require('fs'), path = require('path');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-results.json'), 'utf8'));
const raw2 = fs.existsSync(path.join(__dirname, 'raw-results-seed2.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-results-seed2.json'), 'utf8')) : {};
const sim = fs.existsSync(path.join(__dirname, 'sim-results.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'sim-results.json'), 'utf8')) : null;
const findings = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8'));
const LEVELS = [1, 10, 25, 50, 75, 99, 100];
const out = { game: 'platform-jump', testedLevels: LEVELS, method: 'Headless Chromium 390x844 dpr2 touch, lock-stepped clock (one physics tick per frame). Bots read window.__game.run() and act only through CDP touch events on the on-screen keys. An attempt is one life: a run ends when the tier has used its attempts (clumsy 5, others 3); deaths respawn at the last flag like a player would.', tiers: {}, findings };
for (const t of ['clumsy', 'casual', 'skilled', 'world', 'superhuman']) {
  const runs = LEVELS.map(n => raw[t] && raw[t][n]).concat(LEVELS.map(n => raw2[t] && raw2[t][n])).filter(Boolean);
  const cleared = runs.filter(r => r.cleared).map(r => r.level);
  const perLevel = {}; for (const n of LEVELS) { const rs = runs.filter(r => r.level === n); perLevel[n] = rs.filter(r => r.cleared).length + '/' + rs.length; }
  out.tiers[t] = { runs, summary: { cleared: cleared.length + '/' + runs.length, perLevel, deaths: runs.reduce((a, r) => a + r.deaths, 0), jumpTouches: runs.reduce((a, r) => a + r.jumpTouches, 0), jumpsSeenByGame: runs.reduce((a, r) => a + r.jumpsSeenByGame, 0), errors: runs.reduce((a, r) => a + r.errors.length, 0) } };
  if (sim && sim[t]) out.tiers[t].summary.nodeSimulation = sim[t];
}
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
console.log(Object.entries(out.tiers).map(([k, v]) => k + ' ' + v.summary.cleared).join('  '));
