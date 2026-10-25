// Finds, per level, the first generator variant whose solver effort fits a smooth budget, and prints the LEVEL_K
// table for apps/antikythera/index.html. Effort = nodes of solver.js solveDFS from the level's start position
// (fixed gears on, rusted gear already flipped right). Budget: 40 + 2600 * ((n - 6) / 94)^1.6 nodes; L7 ≈ 40, L50 ≈ 1000, L100 ≈ 2640.
// Usage: node level-k.js [from] [to]   (writes level-k.json: { n: { k, nodes } })
const fs = require('fs'), path = require('path');
const S = require('./solver.js'), K = S.K;
const from = +(process.argv[2] || 7), to = +(process.argv[3] || 100);
const cap = n => Math.round(40 + 2600 * Math.pow((n - 6) / 94, 1.6));
const startMap = L => { const m = new Map(); for (const k of [...(L.locked || []), ...(L.rusted || [])]) m.set(k.peg, { piece: L.pieces.find(p => p.id === k.piece), orient: k.orient }); return m; };
const file = path.join(__dirname, 'level-k.json');
const out = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
for (let n = from; n <= to; n++) {
  let k0 = 0, best = null;
  for (let tries = 0; tries < (+process.env.TRIES || 25); tries++) {
    const L = K.makeLevel(n, k0); if (!L) break;
    K.decorate(L, n);
    const r = S.solveDFS(L, startMap(L), cap(n));
    if (r.plan && (!best || r.nodes < best.nodes)) best = { k: L.k, nodes: r.nodes };
    if (r.plan) break;
    k0 = L.k + 1;
  }
  out[n] = best || { k: 0, nodes: null };
  console.log(n, 'cap', cap(n), JSON.stringify(out[n]));
  fs.writeFileSync(file, JSON.stringify(out));
}
