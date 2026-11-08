// Skill-tier simulation (per qa/skill-tiers/SPEC.md) on the game's own rule core (extracted from apps/klondike-solitaire/index.html; adapted from the release reviewer's qa/release/klondike-solitaire/tier-sim.js).
// Bots only use what a player sees: face-up tableau cards, waste top, foundations, counts. They never read the
// stock order or face-down cards (superhuman excepted: it uses the game's omniscient solver = perfect information).
// Skilled/world may use 悔棋 (unlimited in-game, -5 points each) to back up from dead ends, like a real player.
// Usage: node tier-sim.js [levels...]   -> results.json
const fs = require('fs'), path = require('path');
const APP = fs.readFileSync(path.resolve(__dirname, '../../../apps/klondike-solitaire/index.html'), 'utf8');
const core = new Function(APP.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {mulberry32,deal,cloneSt,fits,canTab,canFound,runOk,doDraw,doMove,legalMove,isWon,canDraw,talonReach,setTalon,safeFound,genMoves,solve,moveScore,recycleScore,timeBonus,diffScore,levelMode,cRank,cSuit,cRed,stKey};')();
const LEVELS = JSON.parse(APP.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const C = core;
const TIERS = {
  clumsy:     { att: 5, rnd: 0.5, mis: 0.15, look: 0, undo: 0,    topk: 0, secs: 0.65 + 1.4, cap: 900 },
  casual:     { att: 3, rnd: 0.15, mis: 0.06, look: 0, undo: 0,   topk: 0, secs: 0.40 + 0.9, cap: 900 },
  skilled:    { att: 3, rnd: 0,    mis: 0.02, look: 1, undo: 120, topk: 3, secs: 0.26 + 0.6, cap: 3000 },
  world:      { att: 3, pimc: 8000, samples: 4, explore: 20000, knowTalon: true, mis: 0.003, secs: 0.18 + 0.6, cap: 1500 },
  superhuman: { att: 1, solver: true, secs: 0.016 }
};
const LV = process.argv.slice(2).map(Number).filter(Boolean);
const levels = LV.length ? LV : Array.from({ length: 100 }, (_, i) => i + 1);

// all legal visible actions
function legalActs(st) {
  const out = [];
  if (C.canDraw(st)) out.push('D');
  if (st.w.length) { out.push({ from: 'w', to: 'f' }); for (let c = 0; c < 7; c++) out.push({ from: 'w', to: 't', tc: c }); }
  for (let fc = 0; fc < 7; fc++) for (let idx = st.d[fc]; idx < st.t[fc].length; idx++) {
    if (!C.runOk(st, fc, idx)) continue;
    if (idx === st.t[fc].length - 1) out.push({ from: 't', fc, idx, to: 'f' });
    for (let tc = 0; tc < 7; tc++) if (tc !== fc) out.push({ from: 't', fc, idx, to: 't', tc });
  }
  for (let s = 0; s < 4; s++) if (st.f[s]) for (let tc = 0; tc < 7; tc++) out.push({ from: 'f', fc: s, to: 't', tc });
  return out.filter(a => a === 'D' || C.legalMove(st, a));
}
const visibleKing = st => { for (let c = 0; c < 7; c++) for (let i = Math.max(st.d[c], 1); i < st.t[c].length; i++) if (C.cRank(st.t[c][i]) === 13 && C.runOk(st, c, i)) return true; return st.w.length && C.cRank(st.w[st.w.length - 1]) === 13; };
// heuristic value of a move (visible info only); <=0 = pointless
function heur(st, a, safeOnly) {
  if (a === 'D') return 4;
  const cards = C.legalMove(st, a); if (!cards) return -99;
  const reveal = a.from === 't' && a.idx === st.d[a.fc] && st.d[a.fc] > 0;
  if (a.to === 'f') { let v = a.from === 'w' ? 55 : 60; if (reveal) v += 30 + st.d[a.fc]; if (safeOnly && !C.safeFound(st, cards[0]) && !reveal) v = 12; return v; }
  if (a.from === 'f') return -5;
  if (a.from === 'w') { const empty = !st.t[a.tc].length; return empty ? (visibleKing(st) ? 14 : 24) : 22; }
  // tableau -> tableau
  if (reveal) return 50 + st.d[a.fc] * 3 - (st.t[a.tc].length ? 0 : 6);
  if (a.idx === 0) return st.t[a.tc].length ? (visibleKing(st) ? 26 : 3) : -5; // empties a column
  if (a.idx > st.d[a.fc] && C.canFound(st, st.t[a.fc][a.idx - 1])) return 30;
  return -5;
}
function apply(st, a) { if (a === 'D') return C.doDraw(st); return C.doMove(st, a); }
function moveScoreOf(st, a) { if (a === 'D') { const rec = !st.s.length; return { rec }; } return null; }

function runGame(n, tier, T, seed) {
  const m = C.levelMode(n), st0 = C.deal(LEVELS[n - 1][0], m.draw, m.limit);
  if (T.solver) { const r = C.solve(st0, 4000000); const acts = r.ok ? r.path.length : 0; const secs = acts * T.secs; return { won: r.ok, actions: acts, undos: 0, secs: +secs.toFixed(1), nodes: r.nodes }; }
  const rng = C.mulberry32(seed * 7919 + n * 31 + 1);
  if (T.pimc) {
    // world = the better of (A) PIMC play without peeking at face-down cards and (B) an undo-explorer:
    // the game's own search on the real deal with a budget of T.explore tried moves (each = one move + 悔棋)
    const A = runPimc(st0, T, rng); if (A.won) return { ...A, how: 'pimc' };
    const r = C.solve(st0, T.explore); if (r.ok) { const acts = r.path.length + 2 * r.nodes; return { won: true, actions: acts, undos: r.nodes, secs: +(acts * T.secs).toFixed(1), found: 52, score: 0, how: 'explore' }; }
    return { ...A, how: 'none', exploreNodes: r.nodes };
  }
  let st = C.cloneSt(st0), actions = 0, undos = 0, score = 0, sinceProg = 0;
  const hist = []; // for undo: {st, alts, score}
  const seen = new Set();
  const key = s => C.stKey(s) + '|' + s.s.length + '|' + s.passes;
  seen.add(key(st));
  const cycleLen = () => Math.ceil((st.s.length + st.w.length) / st.draw) + 2;
  while (!C.isWon(st) && actions < T.cap) {
    let acts = legalActs(st);
    let ranked = acts.map(a => ({ a, v: heur(st, a, T.look > 0) }));
    // a draw is pointless once a full stock cycle passed without progress
    ranked = ranked.filter(r => !(r.a === 'D' && sinceProg > cycleLen()));
    // avoid revisiting positions (players avoid obvious loops)
    ranked = ranked.filter(r => { const s2 = C.cloneSt(st); apply(s2, r.a); return !seen.has(key(s2)); });
    if (T.look) for (const r of ranked) if (r.a !== 'D' && r.v > 0) { const s2 = C.cloneSt(st); apply(s2, r.a); let b = 0; for (const a2 of legalActs(s2)) if (a2 !== 'D') b = Math.max(b, heur(s2, a2, true)); r.v += 0.4 * b; }
    ranked.sort((x, y) => y.v - x.v);
    const good = ranked.filter(r => r.v > 0);
    let pick = null;
    const mistake = rng() < (T.mis || 0), random = rng() < (T.rnd || 0);
    if ((mistake || random) && acts.length) pick = acts[Math.floor(rng() * acts.length)];
    else if (good.length) pick = good[0].a;
    if (!pick) {
      // stuck: undo back to a decision with untried alternatives (skilled / world), else give up
      let backed = false;
      while (T.undo && undos < T.undo && hist.length) {
        const h = hist.pop(); undos++; actions++; st = h.st; score = h.score - 5; sinceProg = h.sinceProg;
        if (h.alts.length) { pick = h.alts.shift(); hist.push({ st: C.cloneSt(st), alts: h.alts, score, sinceProg }); backed = true; break; }
      }
      if (!backed) break;
    } else if (T.undo) {
      const alts = good.slice(1, T.topk).map(r => r.a);
      hist.push({ st: C.cloneSt(st), alts, score, sinceProg });
    }
    const wasRecycle = pick === 'D' && !st.s.length;
    const res = apply(st, pick); actions++;
    if (pick === 'D') { if (res && res.recycle) score += C.recycleScore(st.draw, st.passes); sinceProg++; }
    else { score += C.moveScore(pick, res.revealed); if (pick.to === 'f' || res.revealed || pick.from === 'w') sinceProg = 0; else sinceProg++; }
    seen.add(key(st));
    // auto-finish: game finishes once no face-down cards and stock/waste empty
    if (!st.s.length && !st.w.length && st.d.every(x => !x)) { while (!C.isWon(st)) { let mv = null; for (let c = 0; c < 7 && !mv; c++) { const cc = st.t[c]; if (cc.length && C.canFound(st, cc[cc.length - 1])) mv = { from: 't', fc: c, idx: cc.length - 1, to: 'f' }; } if (!mv) break; C.doMove(st, mv); score += 10; } }
  }
  const won = C.isWon(st), secs = actions * T.secs;
  return { won, actions, undos, secs: +secs.toFixed(1), found: st.f.reduce((a, b) => a + b), score: Math.max(0, score) + (won ? C.timeBonus(Math.round(secs)) : 0) };
}

// World tier: perfect-information Monte Carlo. Every decision re-deals the cards the player has never seen
// (face-down tableau cards; the talon order is treated as known, since a world-class player reads it by drawing
// through the stock and pressing 悔棋, which the game allows without limit) at random into their hidden slots, runs the
// game's own solver on that guess with a node budget, and follows that plan on the real deal until a face-down
// card is turned over (new information), then re-plans.
function runPimc(st0, T, rng) {
  let st = C.cloneSt(st0), actions = 0, score = 0; const seenC = new Set();
  const mark = () => { for (let c = 0; c < 7; c++) for (let i = st.d[c]; i < st.t[c].length; i++) seenC.add(st.t[c][i]); if (st.w.length) seenC.add(st.w[st.w.length - 1]); if (st.draw === 3) for (const c of st.w.slice(-3)) seenC.add(c); };
  mark();
  let fails = 0, plan = [];
  while (!C.isWon(st) && actions < T.cap) {
    let a = plan.length ? plan.shift() : null;
    if (a && a !== 'D' && !C.legalMove(st, a)) { a = null; plan = []; }
    for (let smp = 0; smp < (T.samples || 1) && !a; smp++) {
      const g = C.cloneSt(st), slots = [], pool = [];
      for (let c = 0; c < 7; c++) for (let i = 0; i < g.d[c]; i++) if (!seenC.has(g.t[c][i])) { slots.push(['t', c, i]); pool.push(g.t[c][i]); }
      if (!T.knowTalon) {
        for (let i = 0; i < g.s.length; i++) if (!seenC.has(g.s[i])) { slots.push(['s', i]); pool.push(g.s[i]); }
        for (let i = 0; i < g.w.length; i++) if (!seenC.has(g.w[i])) { slots.push(['w', i]); pool.push(g.w[i]); }
      }
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      slots.forEach((sl, k) => { if (sl[0] === 't') g.t[sl[1]][sl[2]] = pool[k]; else g[sl[0]][sl[1]] = pool[k]; });
      const r = C.solve(g, T.pimc);
      if (r.ok) { plan = r.path.slice(1); a = r.path[0]; }
    }
    if (a && a !== 'D' && !C.legalMove(st, a)) a = null;
    if (!a) {
      // fall back to the best visible heuristic move, else draw
      const acts = legalActs(st).map(x => ({ x, v: heur(st, x, true) })).filter(o => o.v > 0).sort((p, q) => q.v - p.v);
      if (!acts.length || ++fails > 400) break; a = acts[Math.floor(rng() * Math.min(2, acts.length))].x;
    }
    if (rng() < T.mis) { const all = legalActs(st); a = all[Math.floor(rng() * all.length)]; }
    const res = apply(st, a); actions++;
    if (!res) { plan = []; continue; }
    if (a === 'D') { if (res && res.recycle) score += C.recycleScore(st.draw, st.passes); } else { score += C.moveScore(a, res.revealed); if (res.revealed) plan = []; }
    mark();
    if (!st.s.length && !st.w.length && st.d.every(x => !x)) break;
  }
  if (!C.isWon(st) && !st.s.length && !st.w.length && st.d.every(x => !x)) { while (!C.isWon(st)) { let mv = null; for (let c = 0; c < 7 && !mv; c++) { const cc = st.t[c]; if (cc.length && C.canFound(st, cc[cc.length - 1])) mv = { from: 't', fc: c, idx: cc.length - 1, to: 'f' }; } if (!mv) break; C.doMove(st, mv); score += 10; } }
  const won = C.isWon(st), secs = actions * T.secs;
  return { won, actions, undos: 0, secs: +secs.toFixed(1), found: st.f.reduce((a, b) => a + b), score: Math.max(0, score) + (won ? C.timeBonus(Math.round(secs)) : 0) };
}

const parOf = n => Math.round((90 + LEVELS[n - 1][3] * 1.6) * (n <= 40 ? 1 : n <= 60 ? 1.3 : n <= 85 ? 1.8 : 2));
const out = { game: 'klondike-solitaire', levels, tiers: {} };
const t0 = Date.now();
for (const [tier, T] of Object.entries(TIERS)) {
  const runs = [];
  for (const n of levels) {
    const atts = []; let cleared = false;
    for (let a = 0; a < T.att && !cleared; a++) { const r = runGame(n, tier, T, a + 1); atts.push(r); cleared = r.won; }
    const last = atts[atts.length - 1], par = parOf(n);
    runs.push({ n, cleared, attempts: atts.length, secs: last.secs, undos: last.undos, found: last.found, stars: cleared ? 2 + (last.secs <= par ? 1 : 0) : 0, par, score: last.score, firstTryWon: atts[0].won });
  }
  const band = (a, b) => { const r = runs.filter(x => x.n >= a && x.n <= b); return r.length ? { levels: r.length, cleared: r.filter(x => x.cleared).length, firstTry: r.filter(x => x.firstTryWon).length, stars3: r.filter(x => x.stars === 3).length } : null; };
  out.tiers[tier] = { runs, summary: { cleared: runs.filter(r => r.cleared).length + '/' + runs.length, firstTry: runs.filter(r => r.firstTryWon).length, b1_40: band(1, 40), b41_60: band(41, 60), b61_85: band(61, 85), b86_100: band(86, 100) } };
  console.log(tier, JSON.stringify(out.tiers[tier].summary), ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
fs.writeFileSync(path.join(__dirname, LV.length ? 'results-subset.json' : 'results.json'), JSON.stringify(out, null, 1));
