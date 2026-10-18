// Builds results.json from raw-before.json (+ raw-after.json as the afterFix block) and prints the notes tables.
const fs = require('fs'), path = require('path');
const B = JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-before.json'), 'utf8'));
const A = fs.existsSync(path.join(__dirname, 'raw-after.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'raw-after.json'), 'utf8')) : null;
const starK = (n, rot) => (1 + 0.25 * Math.log2(Math.max(1, n / 12))) * (rot ? 1.3 : 1);
// stars recomputed on modelled time with the shipped formula (3★ < 6k s per piece, 2★ < 14k)
for (const R of [B, A]) if (R) for (const t of Object.values(R.tiers)) for (const r of t.runs) { const spm = r.modelSec / r.pieces; r.stars = r.cleared ? (spm < 6 * starK(r.pieces, r.rot) ? 3 : spm < 14 * starK(r.pieces, r.rot) ? 2 : 1) : 0; }
const PA = path.join(__dirname, 'raw-probes-after.json');
if (A && fs.existsSync(PA)) A.probes = JSON.parse(fs.readFileSync(PA, 'utf8')).probes;
const findings = JSON.parse(fs.readFileSync(path.join(__dirname, 'findings.json'), 'utf8'));
function table(R) {
  const cols = []; for (const rot of R.rotation) for (const n of R.sizes) cols.push([n, rot]);
  const head = '| 等級 | ' + cols.map(([n, r]) => n + (r ? ' 旋轉' : '')).join(' | ') + ' | 完成 | 拖曳失效 |';
  const sep = '|' + '---|'.repeat(cols.length + 3);
  const rows = Object.entries(R.tiers).map(([id, t]) => {
    const cells = cols.map(([n, r]) => { const x = t.runs.find(q => q.pieces >= n - 4 && q.pieces <= n + 9 && q.rot === !!r); if (!x) return '—'; return x.cleared ? `✔ ${fmt(x.modelSec)} ${'★'.repeat(x.stars)}` : `✘ ${x.locked}/${x.pieces}`; });
    return `| ${t.name} | ${cells.join(' | ')} | ${t.summary.finished} | ${t.summary.pullsDropped}/${t.summary.pulls} |`;
  });
  return [head, sep, ...rows].join('\n');
}
function fmt(s) { const m = Math.floor(s / 60), r = Math.round(s % 60); return m + ':' + String(r).padStart(2, '0'); }
const out = { game: 'photo-jigsaw', sizes: B.sizes, rotation: B.rotation, pictures: B.pictures, model: B.model, wallSec: B.wallSec, tiers: B.tiers, probes: B.probes, findings };
if (A) out.afterFix = { model: A.model, wallSec: A.wallSec, tiers: A.tiers, probes: A.probes };
const confirm = {};
for (const f of ['raw-confirm-super.json', 'raw-confirm-clumsy.json']) { const q = path.join(__dirname, f); if (fs.existsSync(q)) { const c = JSON.parse(fs.readFileSync(q, 'utf8')); for (const [k, t] of Object.entries(c.tiers)) { for (const r of t.runs) { const spm = r.modelSec / r.pieces; r.stars = r.cleared ? (spm < 6 * starK(r.pieces, r.rot) ? 3 : spm < 14 * starK(r.pieces, r.rot) ? 2 : 1) : 0; } confirm[k] = t; } } }
if (out.afterFix && Object.keys(confirm).length) out.afterFix.confirmAfterTrayTweaks = { note: 'rerun after the last tray changes (20° pull threshold, leaving the tray = pull, 16 px gap tolerance): superhuman all 8, clumsy 99 and 99 rotation', tiers: confirm };
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(out, null, 1));
console.log('BEFORE\n' + table(B));
if (A) console.log('\nAFTER\n' + table(A));
