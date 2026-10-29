// builds plan-cache.json: DFS solutions for the test levels (the world tier works the whole train out — and pays
// bot.js PLAN_S seconds per move for it on the clock). Start: fixed gears on, rusted gear on its right side.
const fs = require('fs'), path = require('path');
const S = require('./solver.js');
const out = {};
for (const n of [1, 10, 25, 50, 75, 99, 100]) {
  const L = S.K.getLevel(n), t = Date.now(), m = new Map();
  for (const k of [...(L.locked || []), ...(L.rusted || [])]) m.set(k.peg, { piece: L.pieces.find(p => p.id === k.piece), orient: k.orient });
  const r = S.solveDFS(L, m, 400000);
  out[n] = { k: L.k ?? null, plan: r.plan, nodes: r.nodes, ms: Date.now() - t }; console.log(n, r.plan && r.plan.length, r.nodes, Date.now() - t);
}
fs.writeFileSync(path.join(__dirname, 'plan-cache.json'), JSON.stringify(out));
