// merges raw-results.json + findings into results.json
const fs = require('fs'), path = require('path');
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-results.json'), 'utf8'));
const findings = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8'));
const out = { game: raw.game, method: raw.method || undefined, testedLevels: raw.testedLevels, wallSeconds: Math.round((raw.wallMs || 0) / 1000), tiers: {}, findings, extra: {} };
for (const [k, v] of Object.entries(raw)) if (!['game', 'testedLevels', 'tiers', 'wallMs', 'rawFindings'].includes(k)) out.extra[k] = v;
for (const [t, v] of Object.entries(raw.tiers)) out.tiers[t] = { runs: v.runs, summary: { ...v.summary, pageErrors: v.errors.length, inputStats: v.stats }, errors: v.errors };
// extra curve sweeps between the tested levels (clumsy 13/16/19/22, casual 31/37/43)
for (const f of ['sweep-clumsy.json', 'sweep-casual.json']) { const p = path.join(__dirname, f); if (fs.existsSync(p)) { const d = JSON.parse(fs.readFileSync(p, 'utf8')); for (const [t, v] of Object.entries(d.tiers)) out.extra['sweep_' + t] = v.runs.map(r => ({ level: r.level, size: r.size, cleared: r.cleared, tries: r.tries, vSecs: r.vSecs, par: r.par })); } }
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
console.log('ok', Object.keys(out.tiers).map(t => t + ':' + out.tiers[t].summary.cleared).join(' '));
