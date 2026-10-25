// Five skill tiers (qa/skill-tiers/SPEC.md) vs the page AI, in node with the game's own core. The AI gets exactly the options the
// page passes (BQ.LEVELS[L] + random seed + rep/forbid), the bot sits in seat 0 (the human seat), first player alternates.
// Tiers: clumsy 15% random + half random / half 1-ply; casual 1-ply, 15% random (+6%); skilled 2-ply ~400ms, 2%;
// world = full engine (Lv5 settings, public info only), 0.3%; superhuman = knows the hidden deal: scores every root move by playing it
// with the true flip result and searching the reply with the engine, plus the public engine score (perfect information at the root).
// Round 2 adds: --seedBase N (fresh deals), tier 'lv4' (the page's Lv4 settings as the bot, to compare Lv4 and Lv5 head to head),
// tier 'reroll' (skilled bot that uses 悔棋 to re-roll a flip: flip, and if the result scores worse than before, undo (the app refuses to undo a flip since round 3, so this is plain skilled play)
// and flip again, up to 5 tries; exactly what the page allows while the computer is thinking).
// Usage: node sim-tiers.js [--par 3] [--plan clumsy:1x10,...] ; writes sim-tiers.json
const { fork } = require('child_process'), fs = require('fs'), path = require('path');
const { BQ } = require('./core.js');
const { FLIP, CAP, END } = BQ;
function botMove(tier, g, R) {
  const L = g.legal(), st = g.publicState(), rep = g.repKeys(), forbid = g.forbidden();
  const rnd = () => L[Math.floor(R() * L.length)];
  const eng = (depth, ms) => { const r = BQ.think(st, { depth, ms, fk: 6, seed: (R() * 1e9) | 0, rep, forbid }); return L.indexOf(r.move) >= 0 ? r.move : rnd(); };
  if (tier === 'clumsy') { if (R() < 0.15 || R() < 0.5) return rnd(); return eng(1, 100); }
  if (tier === 'casual') { if (R() < 0.15 || R() < 0.06) return rnd(); return eng(1, 150); }
  if (tier === 'skilled') { if (R() < 0.02) return rnd(); return eng(2, 400); }
  if (tier === 'lv4') { const Lv = BQ.LEVELS[4]; const r = BQ.think(st, Object.assign({}, Lv, { seed: (R() * 1e9) | 0, rep, forbid })); return L.indexOf(r.move) >= 0 ? r.move : rnd(); }
  if (tier === 'reroll') { if (R() < 0.02) return rnd(); return eng(2, 400); }
  if (tier === 'world') { if (R() < 0.003) return rnd(); return eng(40, 3000); }
  // superhuman
  if (g.st.turn < 0) { // first flip: pick a square whose true piece is the strongest available
    let best = L[0], bv = -1; for (const m of L) { const c = g.deal[m & 31], v = BQ.BASE[c & 7]; if (v > bv) { bv = v; best = m; } } return best;
  }
  if (L.length === 1) return L[0];
  // public best move with the full engine (same budget as Lv5), then use the true deal: re-score it and every flip by playing them with
  // the real hidden piece and searching the opponent's reply; take a flip only if it is clearly better than the engine move.
  const me = g.st.turn, base = eng(40, 3000);
  const val = m => { const s2 = BQ.clone(g.st), code = (m >> 10) === FLIP ? g.deal[m & 31] : 0; BQ.make(s2, m, code); if (s2.alive[1 - me] === 0) return 1e6; const r = BQ.think(BQ.toPlain(s2), { depth: 4, ms: 150, fk: 6, seed: 7 }); return s2.turn === me ? r.score : -r.score; };
  let best = base, bv = val(base);
  const flips = L.filter(m => (m >> 10) === FLIP && m !== base);
  for (const m of flips) { const v = val(m); if (v > bv + 30) { bv = v; best = m; } }
  return best;
}
function playOne(job) {
  const g = new BQ.Game({ seed: job.seed, v: { longChase: true }, first: job.first }), R = BQ.rng(job.seed ^ 0x9e3779b9);
  let ply = 0; const t0 = Date.now(), aiMs = [];
  while (!g.result && ply < 800) {
    const p = g.player(); let m;
    if (p === 0) {
      m = botMove(job.tier, g, R);
      if (job.tier === 'reroll' && (m >> 10) === FLIP && g.st.turn >= 0) { // flip, judge, 悔棋 (re-deal), flip the same square again
        const me = g.st.turn, sc = () => { const r = BQ.think(g.publicState(), { depth: 2, ms: 300, fk: 6, seed: 7, rep: g.repKeys(), forbid: g.forbidden() }); return g.st.turn === me ? r.score : -r.score; };
        const before = sc(); let k = 0;
        for (; k < 5; k++) { g.play(m); if (g.result || k === 4 || sc() >= before) break; g.undo(); }
        job.rerolls = (job.rerolls || 0) + k; ply++; continue;
      }
    }
    else { const Lv = BQ.LEVELS[job.level]; const r = BQ.think(g.publicState(), Object.assign({}, Lv, { seed: (R() * 1e9) | 0, rep: g.repKeys(), forbid: g.forbidden() })); aiMs.push(r.ms); m = r.move; if (g.legal().indexOf(m) < 0) { const lg = g.legal(); m = lg[0]; job.aiIllegal = (job.aiIllegal || 0) + 1; } }
    if (!g.play(m)) throw new Error('illegal ' + m);
    ply++;
  }
  let w = 'cap'; if (g.result) w = g.result.draw ? 'draw' : (g.pcol.indexOf(g.result.winner) === 0 ? 'bot' : 'ai');
  const lost = g.log.filter(r => r.victim && r.player === 1).length, took = g.log.filter(r => r.victim && r.player === 0).length;
  return Object.assign({}, job, { w, reason: g.result ? g.result.reason : 'cap', plies: ply, took, lost, sec: Math.round((Date.now() - t0) / 1000), aiAvgMs: Math.round(aiMs.reduce((a, b) => a + b, 0) / Math.max(1, aiMs.length)) });
}
if (process.env.SIM_CHILD) { process.on('message', j => { try { process.send(playOne(j)); } catch (e) { process.send(Object.assign({}, j, { w: 'error', err: String(e.stack || e) })); } }); return; }
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PAR = +arg('--par', 3);
const plan = arg('--plan', 'clumsy:1x10,clumsy:2x10,casual:1x8,casual:2x10,casual:3x6,skilled:2x6,skilled:3x8,skilled:4x4,world:3x4,world:4x4,world:5x4,superhuman:4x2,superhuman:5x6');
const SB = +arg('--seedBase', 7000);
const jobs = []; plan.split(',').forEach(p => { const [tier, rest] = p.split(':'), [lv, n] = rest.split('x'); for (let i = 0; i < +n; i++) jobs.push({ tier, level: +lv, seed: SB + i * 104729 + (+lv) * 31, first: i % 2 }); });
const OUTF = path.resolve(__dirname, arg('--out', 'sim-tiers.json'));
const res = fs.existsSync(OUTF) ? JSON.parse(fs.readFileSync(OUTF, 'utf8')) : { games: [] };
const doneKey = new Set(res.games.map(r => r.tier + r.level + ':' + r.seed));
const todo = jobs.filter(j => !doneKey.has(j.tier + j.level + ':' + j.seed));
// longest jobs first
const cost = j => (({ clumsy: 1, casual: 1, skilled: 3, world: 8, superhuman: 12, lv4: 4, reroll: 4 }[j.tier]) + j.level * 2); todo.sort((a, b) => cost(b) - cost(a));
let next = 0, live = 0;
function summarize() {
  const S = {}; for (const r of res.games) { const k = r.tier + ' vs Lv' + r.level; const s = S[k] || (S[k] = { n: 0, bot: 0, ai: 0, draw: 0, other: 0, plies: 0 }); s.n++; if (s[r.w] !== undefined) s[r.w]++; else s.other++; s.plies += r.plies; }
  for (const k in S) S[k].avgPlies = Math.round(S[k].plies / S[k].n), delete S[k].plies;
  res.summary = S; fs.writeFileSync(OUTF, JSON.stringify(res, null, 1));
}
function spawn() {
  if (next >= todo.length) { if (!live) { summarize(); console.log(JSON.stringify(res.summary, null, 0)); } return; }
  const j = todo[next++]; live++;
  const ch = fork(__filename, [], { env: Object.assign({}, process.env, { SIM_CHILD: '1' }) });
  ch.on('message', r => { res.games.push(r); summarize(); console.log(r.tier, 'Lv' + r.level, r.w, r.reason, r.plies + ' plies', r.sec + 's', 'aiAvg ' + r.aiAvgMs + 'ms', r.err || ''); ch.kill(); live--; spawn(); });
  ch.send(j);
}
for (let i = 0; i < PAR; i++) spawn();
