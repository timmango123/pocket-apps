// Offline generator for the embedded 169 starting-hand equity table (heads-up vs one random hand).
// Usage: node gen-table.js [path-to-file-with-CORE-markers] [dealsPerClass]
// Prints the 507-digit string embedded as EQS in index.html (3 digits = equity x1000 per class).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(process.argv[2] || path.resolve(__dirname, '..', 'index.html'), 'utf8');
const HE = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const deals = +(process.argv[3] || 200000), r = HE.rng(12345), out = [], t0 = Date.now();
for (let ix = 0; ix < 169; ix++) {
  const i = (ix / 13) | 0, j = ix % 13, hi = 12 - Math.min(i, j), lo = 12 - Math.max(i, j);
  const hole = i === j ? [hi * 4, hi * 4 + 1] : i < j ? [hi * 4, lo * 4] : [hi * 4, lo * 4 + 1];
  out.push(Math.round(HE.equity(hole, [], [1], deals, r) * 1000));
}
console.error('done in', Date.now() - t0, 'ms; AA', out[0], 'AKs', out[1], 'AKo', out[13], '72o', out[12 * 13 + 7], '32o', out[12 * 13 + 11]);
console.log(out.map(x => String(Math.min(999, x)).padStart(3, '0')).join(''));
