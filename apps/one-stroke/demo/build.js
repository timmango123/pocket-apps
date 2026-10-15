// node build.js <levels.json...>  -> levels.json + the LEVELS array in ../index.html
// Levels of the same board size from L45 on are re-ordered by human search effort (gen.js effort()), so the
// late-game curve rises inside each board size instead of jumping (old L99 = 50k nodes next to L98 = 79).
// The array is spliced into the existing ../index.html (keeping later edits to the page); template.html is
// only used when index.html has no LEVELS array yet.
const fs = require('fs'), path = require('path');
const { decode } = require('./solver');
const { effort } = require('./gen');
let all = [];
for (const f of process.argv.slice(2)) all = all.concat(JSON.parse(fs.readFileSync(f, 'utf8')));
all.sort((a, b) => a.L - b.L);
for (const l of all) if (l.effort == null) l.effort = effort(decode(l.enc));
const REORDER_FROM = 45;
for (let i = 0; i < all.length;) {
  let j = i; while (j < all.length && all[j].W === all[i].W && all[j].H === all[i].H) j++;
  if (all[i].L >= REORDER_FROM) {
    const Ls = all.slice(i, j).map(l => l.L);
    const grp = all.slice(i, j).sort((a, b) => a.effort - b.effort || a.L - b.L);
    grp.forEach((l, k) => { l.L = Ls[k]; all[i + k] = l; });
  }
  i = j;
}
fs.writeFileSync(path.join(__dirname, 'levels.json'), JSON.stringify(all.map(({ L, W, H, holes, walls, hints, minimal, unique, nodes, effort, enc }) => ({ L, W, H, holes, walls, hints, minimal, unique, nodes, effort, enc })), null, 0));
const arr = '[\n' + all.map(l => JSON.stringify(l.enc)).join(',\n') + '\n]';
const out = path.join(__dirname, '..', 'index.html');
let html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
const m = html.match(/const LEVELS = \[\n[\s\S]*?\n\];/);
if (m) html = html.replace(m[0], () => 'const LEVELS = ' + arr + ';');
else html = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8').replace('/*LEVELS*/[]', () => arr);
fs.writeFileSync(out, html);
console.log('levels', all.length);
