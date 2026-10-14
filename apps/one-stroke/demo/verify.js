// Proves every embedded level is solvable (independent DFS solver) and checks uniqueness.
// node verify.js  -> prints table, writes verify-results.json
const fs = require('fs'), path = require('path');
const { solve, decode } = require('./solver');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const LEVELS = JSON.parse(html.match(/const LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const out = [];
let allOk = true;
for (let i = 0; i < LEVELS.length; i++) {
  const L = i + 1, lv = decode(LEVELS[i]);
  const open = lv.open.reduce((a, b) => a + b, 0);
  const t0 = Date.now();
  const r = solve(lv, 2, 1e8, 2);
  const ms = Date.now() - t0;
  // independently validate the solver's first solution against the rules
  let valid = false;
  if (r.sols.length) {
    const s = r.sols[0], seen = new Set(s), wall = new Set(lv.walls.map(([a, b]) => Math.min(a, b) + ',' + Math.max(a, b)));
    valid = s.length === open && seen.size === open && s.every(c => lv.open[c]) && s[0] === lv.cps[0] && s[s.length - 1] === lv.cps[lv.cps.length - 1];
    for (let k = 1; k < s.length && valid; k++) {
      const a = s[k - 1], b = s[k], d = Math.abs(a - b);
      if (!(d === lv.W || (d === 1 && Math.floor(a / lv.W) === Math.floor(b / lv.W)))) valid = false;
      if (wall.has(Math.min(a, b) + ',' + Math.max(a, b))) valid = false;
    }
    const order = s.filter(c => lv.cps.includes(c));
    if (order.join() !== lv.cps.join()) valid = false;
  }
  const row = { L, board: lv.W + 'x' + lv.H, cells: open, holes: lv.W * lv.H - open, walls: lv.walls.length, hints: lv.cps.length,
    moves: open - 1, solvable: valid, unique: r.count === 1 && !r.exceeded, solutionsFound: r.count, exhaustive: !r.exceeded, nodes: r.nodes, ms };
  if (!valid) allOk = false;
  out.push(row);
  console.log(`L${String(L).padStart(3)} ${row.board.padEnd(5)} cells=${open} holes=${row.holes} walls=${row.walls} hints=${row.hints} moves=${row.moves} solvable=${valid} unique=${row.unique} nodes=${r.nodes} ${ms}ms`);
}
fs.writeFileSync(path.join(__dirname, 'verify-results.json'), JSON.stringify(out, null, 1));
console.log('ALL SOLVABLE:', allOk, ' unique:', out.filter(r => r.unique).length + '/' + out.length);
