// Shared tier logic (adapted from the release reviewer's tierlib.js) for freecell difficulty calibration.
// Loads the game's own rule core from app-snapshot.html (CORE-START/END) and the level table.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../../apps/freecell/index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {msDeal,newState,cloneS,capacity,checkMove,isSafe,runAuto,genMoves,solve,expandSolution,isWon,canStack,runLen,cRank,cSuit,applyMove,moveCard,stateKey,heur,nextAuto,locate,canFound};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const SOLA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function decodeSol(str) { const out = []; for (let i = 0; i + 1 < str.length; i += 2) { const c = SOLA.indexOf(str[i]), d = str[i + 1]; out.push({ k: d === 'f' ? 'f' : d === 'r' ? 'r' : 'c', to: d === 'f' || d === 'r' ? 0 : +d, card: c }); } return out; }

// seeded RNG
function rng(seed) { let s = seed >>> 0 || 1; const f = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; f.gauss = () => { let u = 0, v = 0; while (!u) u = f(); while (!v) v = f(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; return f; }

const TIERS = {
  clumsy:     { think: [6000, 2500], posSd: 40, mistake: 0.15, randomShare: 0.5, look: 1, undo: 5,  hints: 5, attempts: 5 },
  casual:     { think: [4000, 1500], posSd: 20, mistake: 0.06, randomShare: 0.15, look: 1, undo: 10, hints: 5, attempts: 3 },
  skilled:    { think: [3000, 1000], posSd: 10, mistake: 0.02, randomShare: 0, look: 2, undo: 40, hints: 3, attempts: 3 },
  world:      { think: [2000, 600],  posSd: 4,  mistake: 0.003, randomShare: 0, search: 60000, undo: 200, hints: 0, attempts: 3 },
  superhuman: { think: [0, 0],       posSd: 0,  mistake: 0, randomShare: 0, solver: true, attempts: 1 },
};

function freeCells(S) { return S.r.filter(c => c < 0).length; }
function emptyCols(S) { return S.c.filter(c => !c.length).length; }
function evalS(S) { // lower is better (what a decent human eyeballs: cards home, buried low cards, free space)
  return core.heur(S) - 0.7 * freeCells(S) - 1.2 * emptyCols(S);
}
function after(S, m, auto) { const T = core.cloneS(S); core.applyMove(T, m); if (auto) core.runAuto(T); return T; }

// pick a move for a tier. visited: Set of state keys already seen in this attempt
function pick(S, tier, R, auto, visited) {
  const ms = core.genMoves(S);
  if (!ms.length) return null;
  const fresh = ms.filter(m => !visited.has(core.stateKey(after(S, m, auto))));
  const pool = fresh.length ? fresh : ms;
  if (R() < tier.mistake || R() < tier.randomShare) return { m: pool[Math.floor(R() * pool.length)], random: true };
  let best = null, bv = Infinity;
  for (const m of pool) {
    const T = after(S, m, auto); let v = evalS(T);
    if (tier.look >= 2) { // 2-step lookahead: best follow-up
      const ms2 = core.genMoves(T); let b2 = v;
      for (const m2 of ms2) { const U = after(T, m2, auto); if (visited.has(core.stateKey(U))) continue; b2 = Math.min(b2, evalS(U)); }
      v = 0.4 * v + 0.6 * b2;
    }
    v += R() * 0.05; // ties
    if (v < bv) { bv = v; best = m; }
  }
  return { m: best, random: false };
}

module.exports = { core, LEVELS, decodeSol, rng, TIERS, pick, after, evalS, freeCells, emptyCols };
