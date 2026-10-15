// merges raw-results.json + findings into results.json
const fs = require('fs'), path = require('path');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-results.json'), 'utf8'));
const findings = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8'));
const out = { game: raw.game, method: raw.method || undefined, testedLevels: raw.testedLevels, wallSeconds: Math.round((raw.wallMs || 0) / 1000), tiers: {}, findings, extra: {} };
for (const [k, v] of Object.entries(raw)) if (!['game', 'testedLevels', 'tiers', 'wallMs', 'rawFindings'].includes(k)) out.extra[k] = v;
for (const [t, v] of Object.entries(raw.tiers)) out.tiers[t] = { runs: v.runs, summary: { ...v.summary, pageErrors: v.errors.length, inputStats: v.stats }, errors: v.errors };
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
console.log('ok', Object.keys(out.tiers).map(t => t + ':' + out.tiers[t].summary.cleared).join(' '));
