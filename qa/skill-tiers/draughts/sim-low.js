// Low-tier difficulty check for 國際跳棋 (release-review fix [中／3]).
// Bots from the release review (qa/release/draughts/sim-low.js): one-ply greedy with 65% (clumsy) / 21% (casual)
// random moves, and a 2-ply searcher, vs L1 入門 and L2 初級 under all three rule sets. Core comes from index.html.
// Usage: node sim-low.js [games]   (writes sim-low.json next to this file)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../../../apps/draughts/index.html'), 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {RULES,initState,genMoves,applyMove,stepState,statusOf,think,seededRng,evaluate};')();
const N = +process.argv[2] || 20;
function greedy(st, rng, rand) { const R = C.RULES[st.rule], ms = C.genMoves(st.b, st.turn, R); if (ms.length === 1 || rng() < rand) return ms[Math.floor(rng() * ms.length)]; let best, bv = -1e9; for (const m of ms) { const v = -C.evaluate(C.applyMove(st.b, m, st.turn), st.turn ^ 1, R) + rng() * 2; if (v > bv) { bv = v; best = m; } } return best; }
const bots = { clumsy: (st, r) => greedy(st, r, 0.65), casual: (st, r) => greedy(st, r, 0.21), depth2: (st, r) => C.think(st, 5, { depth: 2, ms: 200, rng: r }).move };
const out = {};
for (const rule of ['br', 'ru', 'en']) for (const lv of [1, 2]) for (const [bn, f] of Object.entries(bots)) {
  const s = { w: 0, l: 0, d: 0 };
  for (let g = 0; g < N; g++) { const rng = C.seededRng(9000 + g * 31 + lv), human = g % 2; let st = C.initState(rule), ply = 0, stt;
    while (!(stt = C.statusOf(st)).over && ply < 300) { st = C.stepState(st, st.turn === human ? f(st, rng) : C.think(st, lv, { rng }).move); ply++; }
    const w = stt.over ? stt.winner : -1; s[w === -1 ? 'd' : w === human ? 'w' : 'l']++; }
  out[`${rule} L${lv} ${bn}`] = s; console.log(rule, 'L' + lv, bn, JSON.stringify(s));
}
fs.writeFileSync(path.join(__dirname, 'sim-low.json'), JSON.stringify(out, null, 1));
