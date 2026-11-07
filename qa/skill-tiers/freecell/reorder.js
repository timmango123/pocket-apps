// One-off: reorder the 4-cell levels L1-L50 of apps/freecell/index.html from easiest to hardest by bot win rate
// (calib.json, made by calib.js before the reorder; ties broken by the old solver score S). The S column keeps its
// old values by position (difficulty.js then recomputes it from each deal's own win rate).
// Prints the old deal order, which the game keeps (OLD_ORDER) to move saved stars to the new level numbers.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '../../../apps/freecell/index.html');
let html = fs.readFileSync(APP, 'utf8');
const m = html.match(/var LEVELS = \[\n([\s\S]*?)\n\];/);
const rows = m[1].split('\n');
const calib = require('./calib.json').levels, byDeal = new Map(calib.map(l => [l.deal, l]));
const first = rows.slice(0, 50).map(r => JSON.parse(r.replace(/,$/, '')));
if (first.some(r => r[1] !== 4 || !byDeal.has(r[0]))) throw new Error('unexpected table');
const oldOrder = first.map(r => r[0]), Svals = first.map(r => r[3]);
const sorted = first.slice().sort((a, b) => byDeal.get(b[0]).score - byDeal.get(a[0]).score || byDeal.get(a[0]).S - byDeal.get(b[0]).S);
const out = sorted.map((r, i) => JSON.stringify([r[0], r[1], r[2], Svals[i], r[4]]) + ',');
html = html.replace(m[0], 'var LEVELS = [\n' + out.concat(rows.slice(50)).join('\n') + '\n];');
fs.writeFileSync(APP, html);
console.log('OLD_ORDER', JSON.stringify(oldOrder));
console.log('NEW_ORDER', JSON.stringify(sorted.map(r => r[0])));
console.log(sorted.map((r, i) => 'L' + (i + 1) + ':' + byDeal.get(r[0]).score).join(' '));
