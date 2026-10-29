// Worst-case cost of one placement step (incl. the exhaustive solvable() deal check) over 300 greedy games, Node.
const C = require('./common').core(); const ts = [];
for (let g = 0; g < 300; g++) { const G = C.newGame('normal', 99 + g * 131); let n = 0; while (!G.over && n < 3000) { const m = C.aiBest(G, true); if (!m) break; const t = performance.now(); const e = C.step(G, m.slot, m.r, m.c); const d = performance.now() - t; if (e.dealt) ts.push(d); n++; } }
ts.sort((a, b) => a - b); const q = p => +ts[Math.floor(p * (ts.length - 1))].toFixed(2);
console.log(JSON.stringify({ deals: ts.length, median: q(0.5), p99: q(0.99), p999: q(0.999), max: q(1), over16ms: ts.filter(x => x > 16).length }));
