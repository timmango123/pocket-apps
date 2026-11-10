// Skill-tier bots per qa/skill-tiers/SPEC.md, run on the app's own core rules (Node, seeded).
// Decision model only; timing model: per move = think + reaction + animation (260 ms turn + fall at 18 cells/s, measured in page).
// Bots: clumsy (50% random else 1-step greedy, 15% mistakes, no memory, 5 attempts), casual (1-step greedy + 15% random,
// 6% mistakes, short memory), skilled (2-step lookahead + visited memory, 2%), world (BFS from current state, 0.3%),
// superhuman (BFS optimum). Death on a spike -> the bot presses 悔棋 (as the fail card offers). No hints used ("nohint")
// and a variant that uses the level's 3 hints when stuck ("hint"). Usage: node tiersim.js [levels...]
const { C, LEVELS } = require('./core');
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r()); }
const TIERS = {
  clumsy: { react: [650, 200], think: 3500, mistake: 0.15, rand: 0.5, look: 1, mem: 0, attempts: 5 },
  casual: { react: [400, 100], think: 2200, mistake: 0.06, rand: 0.15, look: 1, mem: 6, attempts: 3 },
  skilled: { react: [260, 50], think: 1500, mistake: 0.02, rand: 0, look: 6, mem: 1e9, attempts: 3 },
  world: { react: [180, 25], think: 900, mistake: 0.003, rand: 0, look: 'bfs', mem: 1e9, attempts: 3 },
  superhuman: { react: [16, 0], think: 0, mistake: 0, rand: 0, look: 'bfs', mem: 1e9, attempts: 3 },
};
function exitsOf(L) { const e = {}; L.tile.forEach((t, c) => { if (t >= 10) e[t - 10] = c; }); return e; }
function h(L, S, ex) { let v = 0; const n = L.n; S.b.forEach((p, i) => { if (p < 0) return; const q = ex[L.cols[i]]; v += 10 + Math.abs(p % n - q % n) + Math.abs(((p / n) | 0) - ((q / n) | 0)); }); return v; }
function look(L, S, depth, ex, seen) { // best heuristic reachable within depth turns (win = -1e5, unseen states slightly preferred)
  if (C.isWin(S)) return -1e5; let v = h(L, S, ex) + (seen.has(C.stateKey(S)) ? 3 : 0); if (!depth) return v;
  for (const d of [1, -1]) { const a = C.rotate(L, S, d); if (a.dead.length) continue; v = Math.min(v, look(L, a.S, depth - 1, ex, seen) + 0.01); }
  return v; }
function animMs(r) { let mx = 0; r.moves.forEach(m => mx = Math.max(mx, m.path.length - 1)); return 260 + mx / 18 * 1000 + 60; }
function decide(L, S, tier, r, seen, moves, ex) { const T = TIERS[tier]; let dir;
      if (T.look === 'bfs') { const s = C.solve(L, S, 3000000, false); dir = s ? s.sol[0] : (r() < .5 ? 1 : -1); }
      else if (r() < T.rand) dir = r() < 0.5 ? 1 : -1;
      else {
        const score = d => { const a = C.rotate(L, S, d); if (a.dead.length) return 1e6; if (C.isWin(a.S)) return -1e6;
          let v = h(L, a.S, ex); const k = C.stateKey(a.S); if (T.mem && seen.has(k) && moves - seen.get(k) <= T.mem) v += 50;
          if (T.look >= 2) { v = v * 0.3 + 0.7 * look(L, a.S, T.look - 1, ex, seen); } if (false) { let best = 1e9; for (const d2 of [1, -1]) { const b = C.rotate(L, a.S, d2); const v2 = b.dead.length ? 1e6 : C.isWin(b.S) ? -1e5 : h(L, b.S, ex) + (T.mem && seen.has(C.stateKey(b.S)) ? 30 : 0); best = Math.min(best, v2); } v = v * 0.4 + best * 0.6; }
          return v + r() * 0.5; };
        const s1 = score(1), s2 = score(-1); dir = s1 < s2 ? 1 : s2 < s1 ? -1 : (r() < .5 ? 1 : -1);
      }
      if (r() < T.mistake) dir = -dir;
  return dir; }
function playAttempt(L, tier, r, opt, useHints, capMs) {
  const T = TIERS[tier], ex = exitsOf(L); let lastHint = -1e9, S = C.initState(L), hist = [], t = 0, moves = 0, deaths = 0, hints = useHints ? 3 : 0, seen = new Map();
  const remember = S => { seen.set(C.stateKey(S), moves); };
  remember(S);
  while (t < capMs && moves < Math.max(60, opt * 8)) {
    let dir;
    const stuck = moves > opt * 2 + 6;
    if (hints > 0 && stuck && moves - lastHint > Math.max(3, opt / 2)) { const s = C.solve(L, S, 600000, false); if (s) { dir = s.sol[0]; hints--; lastHint = moves; t += 1500; } }
    if (dir == null) {
      dir = decide(L, S, tier, r, seen, moves, ex);
    }
    t += T.think * (0.5 + r()) + Math.max(16, T.react[0] + gauss(r) * T.react[1]);
    const res = C.rotate(L, S, dir); moves++; t += animMs(res);
    if (res.dead.length) { deaths++; t += 650 + 900 + T.react[0]; moves--; continue; } // fail card -> 悔棋 (undo removes the move)
    hist.push(S); S = res.S; remember(S);
    if (C.isWin(S)) return { cleared: true, moves, t: Math.round(t), deaths, stars: moves <= opt ? 3 : moves <= opt + 2 ? 2 : 1 };
  }
  return { cleared: false, moves, t: Math.round(t), deaths };
}
module.exports = { TIERS, decide, exitsOf, rng, gauss };
if (require.main === module) {
const levels = process.argv.slice(2).map(Number).filter(Boolean);
const LV = levels.length ? levels : [1, 10, 25, 50, 75, 99, 100];
const out = { model: 'node sim on app core', levels: LV, tiers: {} };
for (const mode of (process.env.MODES || 'nohint,hint').split(',')) for (const tier of (process.env.TIERS ? process.env.TIERS.split(',') : Object.keys(TIERS))) {
  const key = tier + '-' + mode; out.tiers[key] = {};
  for (const n of LV) {
    const L = C.parseLevel(LEVELS[n - 1][0]), opt = LEVELS[n - 1][1], runs = [];
    for (let seed = 1; seed <= 5; seed++) { // 5 players per tier per level
      const r = rng(n * 1000 + seed * 7 + tier.length); const att = [];
      for (let a = 0; a < TIERS[tier].attempts; a++) { const x = playAttempt(L, tier, r, opt, mode === 'hint', 5 * 60000); att.push(x); if (x.cleared) break; }
      const last = att[att.length - 1]; runs.push({ cleared: last.cleared, attempts: att.length, moves: last.moves, stars: last.stars || 0, sec: Math.round(att.reduce((s, x) => s + x.t, 0) / 1000), deaths: att.reduce((s, x) => s + x.deaths, 0) });
    }
    out.tiers[key][n] = { cleared: runs.filter(x => x.cleared).length + '/5', stars3: runs.filter(x => x.stars === 3).length, medSec: runs.map(x => x.sec).sort((a, b) => a - b)[2], runs };
  }
}
console.log(JSON.stringify(out));
}
