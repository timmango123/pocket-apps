// Rewrites the S (shown difficulty) column of L1-L50 in apps/freecell/index.html from each deal's own bot win rate
// (calib.json): S = S_lo + (1 - score) * (S_hi - S_lo), where S_lo/S_hi are the 4-cell band the table already had,
// nudged by 0.01 where needed so S still rises strictly. L51-L100 keep their solver scores. Re-runnable.
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '../../../apps/freecell/index.html');
let html = fs.readFileSync(APP, 'utf8');
const m = html.match(/var LEVELS = \[\n([\s\S]*?)\n\];/), rows = m[1].split('\n');
const byDeal = new Map(require('./calib.json').levels.map(l => [l.deal, l]));
const first = rows.slice(0, 50).map(r => JSON.parse(r.replace(/,$/, '')));
const LO = 4.863, HI = 9.43, next = JSON.parse(rows[50].replace(/,$/, ''))[3];
if (HI >= next) throw new Error('band overlaps L51');
let prev = -1;
const out = first.map(r => { let S = +(LO + (1 - byDeal.get(r[0]).score) * (HI - LO)).toFixed(3); if (S <= prev) S = +(prev + 0.01).toFixed(3); prev = S; return JSON.stringify([r[0], r[1], r[2], S, r[4]]) + ','; });
if (prev >= next) throw new Error('L50 above L51');
html = html.replace(m[0], 'var LEVELS = [\n' + out.concat(rows.slice(50)).join('\n') + '\n];');
fs.writeFileSync(APP, html);
console.log(first.map((r, i) => 'L' + (i + 1) + ' ' + JSON.parse(out[i].slice(0, -1))[3]).join('  '));
