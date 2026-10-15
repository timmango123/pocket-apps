// pick one candidate per level so that D is strictly increasing, minimising distance to the spec target
const fs = require('fs');
const all = [];
for (const f of fs.readdirSync('out').filter(f => f.endsWith('.json'))) for (const r of JSON.parse(fs.readFileSync("out/" + f))) if (r && r.M <= 40) all.push(r);
const by = {}; all.forEach(r => (by[r.L] = by[r.L] || []).push(r));
const maxL = Math.max(...Object.keys(by).map(Number));
const STEP = 0.005; const NOMONO = process.argv.includes("--nomono"); const SOFT = process.argv.includes("--soft");
// DP: best[L][j] = min cost ending at candidate j
let prev = null, back = [];
for (let L = 1; L <= maxL; L++) {
  const cs = (by[L] || []).slice().sort((a, b) => a.D - b.D);
  const cur = cs.map(c => {
    const MT = Math.min(40, Math.round(3 * Math.pow(1.027, L))); c.Mt = MT; const own = Math.abs(c.D - c.Dt) + 0.5 * Math.abs(c.M - MT);
    if (!prev) return { c, cost: own, from: -1 };
    let best = Infinity, from = -1;
    prev.forEach((p, i) => { if (p.cost < best && c.D > p.c.D + STEP && (NOMONO || c.M >= p.c.M)) { best = p.cost; from = i; } });
    return { c, cost: best + own, from };
  });
  if (SOFT && !cur.some(x => x.cost < Infinity)) { console.log("stuck", L); cur.forEach(x => { x.cost = 0; x.from = 0; }); }
  if (!cur.some(x => x.cost < Infinity)) { console.log('NO increasing choice at level', L, cs.map(c => c.D), 'prev', prev && prev.map(p => p.c.D)); process.exit(1); }
  back.push(cur); prev = cur;
}
let j = prev.reduce((bi, x, i) => x.cost < prev[bi].cost ? i : bi, 0); const pick = [];
for (let L = maxL; L >= 1; L--) { const x = back[L - 1][j]; pick.unshift(x.c); j = x.from; }
fs.writeFileSync('levels.json', JSON.stringify(pick.map(c => [c.s, c.M, c.D])));
pick.forEach(c => { if ([1, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 99, 100].includes(c.L)) console.log('L' + c.L, 'M', c.M, '(t' + c.Mt + ')', 'T', c.T, 'D', c.D, '(t' + c.Dt + ')', 'states', c.states); });
let bad = 0; for (let i = 1; i < pick.length; i++) if (!(pick[i].D > pick[i - 1].D)) bad++;
console.log('levels', pick.length, 'non-increasing', bad, 'M off-target', pick.filter(c => c.M !== c.Mt).length);
