// Prints the tier × difficulty table from results.json (or the afterFix block): node table.js [afterFix]
const fs = require('fs'), path = require('path');
const res = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
const block = process.argv[2] ? res[process.argv[2]] : res;
const NAMES = { clumsy: '手殘', casual: '普通', skilled: '熟練', world: '世界級', superhuman: '非人' };
const DIFFS = ['簡單', '普通', '困難', '地獄'];
console.log('| 分級 | ' + DIFFS.join(' | ') + ' |');
console.log('|---|' + DIFFS.map(() => '---').join('|') + '|');
for (const t of Object.keys(NAMES)) {
  const tier = block.tiers[t]; if (!tier) continue;
  const cells = DIFFS.map(d => {
    const runs = tier.runs.filter(r => r.difficulty === d); if (!runs.length) return '—';
    return runs.map(r => (r.result === 'clear' ? '✔ 通關' : r.result === 'timeout' ? '⏱ ' + r.endAt : '✘ ' + r.endAt) + `（${(r.score / 1000).toFixed(0)}k分，死 ${r.deaths}，炸 ${r.bombsUsed}）`).join('<br>');
  });
  console.log(`| ${NAMES[t]} | ${cells.join(' | ')} |`);
}
let errs = 0, runs = 0; for (const t in block.tiers) for (const r of block.tiers[t].runs) { runs++; errs += r.errors.length; }
console.log(`\n${runs} runs, ${errs} errors, wall ${res.wallSeconds}s`);
