// Skill-tier simulation for 六角連通 (hex), same tier models as the release review (qa/release/hex/sim-tiers.js):
// clumsy = 50% random legal else 1-step greedy (+15% mistakes); casual = 1-step greedy, 15% random, 6% mistakes;
// skilled = engine 工蜂-strength search as it was before the 2026-11 retune (1500 sims, bridge playouts, no errors);
// world = engine 蜂巢意志 settings, no errors; superhuman = the same with 2x time. The human side uses its own engine instance.
// Page rules: swap on, the computer resigns when the human holds a virtual connection.
// Usage: node sim.js <plan> [levelOverridesJSON]   plans: curve, quick
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '../../../apps/hex/index.html'), 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const loadH = () => new Function(SRC + ';return HEX;')();
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function greedy(H, g, R) {
  const me = g.turn, opp = 3 - me, L = g.legalMoves().filter(m => m !== H.SWAP); let best = L[0], bs = -1e9;
  for (const m of L) { g.cells[m] = me; const s = H.needCells(g.cells, g.G, opp) - H.needCells(g.cells, g.G, me) + R() * 0.9; g.cells[m] = 0; if (s > bs) { bs = s; best = m; } }
  return best;
}
const OLD_LV2 = { name: 'old工蜂', sims: 1500, time: 600, bridge: 1, rave: 0, err: 0, vc: 0, reuse: 0, C: 0.5, thr: 2 };
const TIERS = {
  clumsy: { rnd: 0.5, mist: 0.15 }, casual: { rnd: 0.15, mist: 0.06 },
  skilled: { eng: { lv: 'old', lim: { noErr: true } }, mist: 0.02 }, world: { eng: { lv: 4, lim: { noErr: true } }, mist: 0.003 },
  superhuman: { eng: { lv: 4, lim: { noErr: true, time: 8000 } }, mist: 0 }
};
function play(j) {
  const H = loadH(), Hh = loadH(); H.setSeed(j.seed); Hh.setSeed(j.seed + 999); H.resetTree(); const R = mulberry(j.seed * 7 + 1), T = TIERS[j.tier];
  if (j.ov) Object.keys(j.ov).forEach(k => Object.assign(H.LEVELS[k], j.ov[k]));
  Hh.LEVELS.push(OLD_LV2); const oldIdx = Hh.LEVELS.length - 1;
  const g = new H.Game({ size: j.N, swap: true }); const human = j.color; let res = null; const t0 = Date.now();
  while (!g.winner) {
    if (g.turn === human) {
      let m;
      if (T.eng) { if (R() < T.mist) { const L = g.legalMoves(); m = L[(R() * L.length) | 0]; } else m = Hh.think(g, T.eng.lv === 'old' ? oldIdx : T.eng.lv, T.eng.lim).move; }
      else if (R() < T.rnd || R() < T.mist) { const L = g.legalMoves(); m = L[(R() * L.length) | 0]; }
      else m = (g.canSwap() && R() < 0.3) ? H.SWAP : greedy(H, g, R);
      g.play(m);
    } else {
      const r = H.think(g, j.lv, {});
      if (r.resign && r.lostCarrier) { res = 'airesign'; break; }
      if (r.move == null || !g.legal(r.move)) { res = 'stuck:' + r.why; break; }
      g.play(r.move);
    }
  }
  const win = res === 'airesign' || g.winner === human;
  return { tier: j.tier, N: j.N, lv: j.lv, color: j.color, seed: j.seed, win, how: res || 'connect', moves: g.moves.length, sec: Math.round((Date.now() - t0) / 1000) };
}
if (!isMainThread) { parentPort.postMessage(play(workerData)); return; }
(async () => {
  const plan = process.argv[2] || 'quick', ov = process.argv[3] ? JSON.parse(process.argv[3]) : null, par = +(process.env.PAR || 3);
  const jobs = []; let s = 100;
  const add = (tier, N, lvs, n) => lvs.forEach(lv => { for (let i = 0; i < n; i++) jobs.push({ tier, N, lv, color: i % 2 ? 2 : 1, seed: s++, ov }); });
  if (plan === 'quick') { add('casual', 11, [1], 8); add('clumsy', 11, [1], 6); add('casual', 11, [2], 6); add('skilled', 11, [1], 4); add('skilled', 11, [2], 8); }
  if (plan === 'lv2') { add('casual', 11, [1], 10); add('clumsy', 11, [1], 8); add('casual', 9, [1], 6); add('casual', 7, [1], 6); }
  if (plan === 'lv3') { add('casual', 11, [2], 6); add('skilled', 11, [2], 8); add('skilled', 9, [2], 4); add('skilled', 7, [2], 4); }
  if (plan === 'top') { add('skilled', 11, [3], 4); add('world', 11, [3], 4); }
  if (plan === 'curve') {
    add('clumsy', 11, [0, 1, 2], 6); add('casual', 11, [0, 1, 2, 3], 6); add('skilled', 11, [1, 2, 3], 4);
    add('world', 11, [2, 3, 4], 2); add('superhuman', 11, [3, 4], 2);
  }
  const out = path.join(__dirname, 'sim-' + plan + '.json'), res = []; let next = 0;
  await Promise.all(Array.from({ length: par }, async () => { while (next < jobs.length) { const j = jobs[next++];
    const r = await new Promise((ok, no) => { const w = new Worker(__filename, { workerData: j }); w.on('message', ok); w.on('error', no); });
    res.push(r); console.log(JSON.stringify(r)); } }));
  const sum = {}; res.forEach(r => { const k = r.tier + ' ' + r.N + 'x' + r.N + ' Lv' + (r.lv + 1); (sum[k] = sum[k] || { w: 0, n: 0 }); sum[k].n++; if (r.win) sum[k].w++; });
  fs.writeFileSync(out, JSON.stringify({ levels: ov, summary: sum, games: res }, null, 1)); console.log(JSON.stringify(sum));
})();
