// Generates the 100-level table for 麻將接龍 using the game's own core code (CORE-START/END in index.html)
// and writes it back into index.html between /*LEVELS-START*/ and /*LEVELS-END*/.
// For every level it evaluates many (template, seed, deal-mode) candidates by the spec's difficulty score
//   S = N/20 + layers*0.6 + 5/avgPairs + 4*stuckRate   (300 random-player simulations)
// and picks a strictly increasing sequence (maximising the minimum step), each pick also confirmed by the DFS solver.
// Usage: node gen.js [--dry]
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
let html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {TPL,makeLevel,levelParams,simStats,scoreS,solve,replayCheck,mulberry32};')();
const t0 = Date.now();
const cands = [];
for (let n = 1; n <= 100; n++) {
  const p = C.levelParams(n), list = [];
  const K = n >= 85 ? 7 : n >= 60 ? 4 : 3, modes = n >= 50 ? [0, 1] : [0];
  for (let ti = 0; ti < C.TPL.length; ti++) for (let seed = 1; seed <= K; seed++) for (const mode of modes) {
    const L = C.makeLevel(n, ti, seed * 13 + n, mode); if (!L) continue;
    const st = C.simStats(L.lay, L.faces, C.mulberry32(1000 + n), 300);
    list.push({ ti, seed: seed * 13 + n, mode, S: Math.round(C.scoreS(p.N, p.L, st) * 1000) / 1000, st });
  }
  list.sort((a, b) => a.S - b.S);
  cands.push(list);
  if (n % 10 == 0) process.stdout.write('candidates up to level ' + n + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
}
const solved = new Map();
function solverOK(n, c) {
  const k = n + ':' + c.ti + ':' + c.seed + ':' + c.mode; if (solved.has(k)) return solved.get(k);
  const L = C.makeLevel(n, c.ti, c.seed, c.mode);
  const ok = C.replayCheck(L.lay, L.faces, L.order) && C.solve(L.lay, new Uint8Array(L.lay.n).fill(1), L.faces, 150000).ok;
  solved.set(k, ok); return ok;
}
function pick(delta, check) {
  const out = []; let prev = -1, recent = [];
  for (let n = 1; n <= 100; n++) {
    let ch = null;
    for (const strict of [true, false]) {
      for (const c of cands[n - 1]) {
        if (c.S < prev + delta) continue;
        if (strict && recent.includes(c.ti)) continue;
        if (check && !solverOK(n, c)) continue;
        ch = c; break;
      }
      if (ch) break;
    }
    if (!ch) return null;
    out.push(ch); prev = ch.S; recent.push(ch.ti); if (recent.length > 4) recent.shift();
  }
  return out;
}
let lo = 0, hi = 0.6;
for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (pick(m, false)) lo = m; else hi = m; }
let delta = lo, res = pick(delta, true);
while (!res) { delta *= 0.97; res = pick(delta, true); }
console.log('min step between consecutive levels:', delta.toFixed(3));
const S1 = res[0].S, S100 = res[99].S;
const table = res.map((c, i) => [c.ti, c.seed, c.mode, Math.round(c.S * 100) / 100]);
let minStep = 1e9;
for (let i = 1; i < 100; i++) minStep = Math.min(minStep, res[i].S - res[i - 1].S);
for (const n of [1, 10, 25, 50, 75, 85, 99, 100]) { const c = res[n - 1], p = C.levelParams(n); console.log('level', n, C.TPL[c.ti][0], 'N', p.N, 'layers', p.L, 'S', c.S.toFixed(2), 'avgPairs', c.st.avgPairs.toFixed(2), 'stuck', c.st.stuck.toFixed(2)); }
console.log('S range', S1, '->', S100, 'min step', minStep.toFixed(3), 'time', ((Date.now() - t0) / 1000).toFixed(0) + 's');
const txt = '[\n' + table.map(r => JSON.stringify(r)).join(',\n') + '\n]';
if (!process.argv.includes('--dry')) {
  html = html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, '/*LEVELS-START*/' + txt + '/*LEVELS-END*/');
  fs.writeFileSync(APP, html); console.log('wrote LEVELS into index.html');
}
