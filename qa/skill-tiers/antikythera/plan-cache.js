// builds plan-cache.json: DFS solutions for the test levels (world tier "plans before the first move")
const fs = require('fs'), path = require('path');
const S = require('./solver.js');
const out = {};
for (const n of [1, 10, 25, 50, 75, 99, 100]) { const L = S.K.getLevel(n); const t = Date.now(); const r = S.solveDFS(L, new Map(), 400000); out[n] = { plan: r.plan, nodes: r.nodes, ms: Date.now() - t }; console.log(n, r.plan && r.plan.length, r.nodes, Date.now() - t); }
fs.writeFileSync(path.join(__dirname, 'plan-cache.json'), JSON.stringify(out));
