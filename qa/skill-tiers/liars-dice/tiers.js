// Node tier sim for 吹牛骰: seat 0 is a skill-tier bot, seats 1..n-1 run the app's own AI exactly as newMatch/nextTurn
// set them up (same seed -> first player, characters/personalities, G.aiR seeds, grudge, learned models incl. a persistent
// MD profile of the "human"). Uses the game's core (CORE-START..CORE-END) from the scored file.
// Usage: node tiers.js <games-per-cell> [app path] [cell prefixes,comma] [tiers,comma]   -> tiers-results.json
const fs = require('fs'), path = require('path');
const APP = process.argv[3] || path.join(__dirname, '../../../apps/liars-dice/index.html');
const ONLY = process.argv[4] ? process.argv[4].split(',') : null, TONLY = process.argv[5] ? process.argv[5].split(',') : null;
const html = fs.readFileSync(APP, 'utf8');
const LD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn LD;')();
const { decide } = require('./bots');
const N = +process.argv[2] || 100;
const fresh = () => ({ bids: 0, bluffs: 0, cs: 0, cn: 0, rs: 0, rn: 0 });
function modelFor(obs, MD, i) {
  const o = obs[i], src = i === 0 ? { bids: o.bids + MD.bids, bluffs: o.bluffs + MD.bluffs, cs: o.cs + MD.cs, cn: o.cn + MD.cn, rs: o.rs + MD.rs, rn: o.rn + MD.rn } : o;
  const b = (src.bluffs + 1) / (src.bids + 5), c = (src.cs + 0.6) / (src.cn + 2), r = (src.rs + 1.2) / (src.rn + 2);
  return { b: Math.max(0.05, Math.min(0.6, b)), thr: Math.max(0.2, Math.min(0.6, (c + r) / 2)) };
}
function match(tier, cfg, seed, MD, R) {
  const n = cfg.n, rr = LD.rng(seed ^ 0x9e3779b9);
  const g = LD.newGame({ n, mode: cfg.mode || 'lives', special: true, start: 'players', seed, lives: 3, dice: 5, first: Math.floor(rr() * n) });
  const aiR = rr, pick = n === 2 ? [0] : n === 3 ? [0, 2] : [0, 1, 2], chars = [null, ...pick.slice(0, n - 1)];
  const obs = [], grudge = []; for (let i = 0; i < n; i++) { obs.push(fresh()); grudge.push(0); }
  let rounds = 0, myCalls = 0, myCallsWon = 0, caught = 0, myBids = 0, illegal = 0, lostLives = 0;
  while (g.phase !== 'over' && !g.P[0].out) {
    LD.startRound(g); rounds++;
    for (let k = 0; k < 500; k++) {
      const p = g.turn; let a;
      if (p === 0) {
        const model = {}; for (let i = 1; i < n; i++) if (!g.P[i].out) model[i] = modelFor(obs, MD, i);
        a = decide(tier, { LD, g, model }, R);
      } else {
        aiR(); // delay draw in nextTurn
        const model = {}; for (let i = 0; i < n; i++) if (i !== p) model[i] = modelFor(obs, MD, i);
        const v = LD.viewFor(g, p, { lvl: cfg.lvl, pers: LD.PERS[chars[p]], grudge: { 0: grudge[p] }, model, seed: (aiR() * 4294967295) >>> 0 });
        a = LD.think(v);
      }
      if (a.act === 'call' && LD.canCall(g)) break;
      let b = { q: a.q, f: a.f };
      if (a.act === 'call' || !LD.legal(g, b)) { if (p === 0) illegal++; const cs = LD.candidates(LD.viewFor(g, p), 0); if (!cs.length) break; b = cs[0]; }
      const prev = LD.last(g); LD.doBid(g, b); const nb = LD.last(g); nb.prevP = prev ? LD.probFor(g, p, prev, prev.wild) : null;
      if (p === 0) myBids++;
    }
    const res = LD.doCall(g); if (!res) throw new Error('round did not end in a call');
    // independent recount
    let t = 0; for (const P of g.P) { if (P.out) continue; const s = P.hand.slice().sort().join(''); if (P.hand.length === 5 && (s === '12345' || s === '23456')) continue; let c = P.hand.filter(d => d === res.bid.f || (res.wild && d === 1)).length; if (P.hand.length === 5 && c === 5) c++; t += c; }
    if (t !== res.count || (t >= res.bid.q) !== res.truth) throw new Error('count mismatch seed ' + seed);
    // learn (as app.learn)
    g.bids.forEach(b => { const c = LD.handCount(g.P[b.p].hand, b.f, b.wild, true), o = obs[b.p]; o.bids++; if (c === 0) o.bluffs++; if (b.prevP != null) { o.rs += b.prevP; o.rn++; } if (b.p === 0) { MD.bids++; if (c === 0) MD.bluffs++; if (b.prevP != null) { MD.rs += b.prevP; MD.rn++; } } });
    const cp = LD.probFor(g, res.caller, res.bid, res.wild); obs[res.caller].cs += cp; obs[res.caller].cn++; if (res.caller === 0) { MD.cs += cp; MD.cn++; }
    LD.settle(g);
    if (res.caller === 0) { myCalls++; if (res.loser !== 0) myCallsWon++; }
    if (res.bidder === 0 && !res.truth) caught++;
    if (res.caller === 0 && res.loser === res.bidder) grudge[res.bidder]++;
    if (res.loser === 0) lostLives++;
  }
  const win = !g.P[0].out && g.winner === 0;
  const order = []; // place: 1 if win, else n - (#eliminated before me)
  let place = 1; if (!win) { place = g.P.filter(P => !P.out).length + 1; }
  return { win, place, rounds, myCalls, myCallsWon, caught, myBids, illegal, lostLives };
}
const cells = [
  { id: '4p-normal(預設 3 位一般)', n: 4, lvl: 1 }, { id: '4p-novice(3 位新手)', n: 4, lvl: 0 }, { id: '4p-expert(3 位高手)', n: 4, lvl: 2 },
  { id: 'duel(單挑高手)', n: 2, lvl: 2 }, { id: '4p-normal-dice(減骰制)', n: 4, lvl: 1, mode: 'dice' }
];
const tiers = ['clumsy', 'casual', 'skilled', 'world', 'superhuman'];
const out = { game: 'liars-dice', gamesPerCell: N, file: APP, cells: {} };
const t0 = Date.now();
for (const cell of cells) {
  if (ONLY && !ONLY.some(o => cell.id.startsWith(o))) continue;
  out.cells[cell.id] = {};
  for (const tier of tiers) {
    if (TONLY && !TONLY.includes(tier)) continue;
    const MD = fresh(), R = LD.rng(777 + tiers.indexOf(tier)); let w = 0, pl = 0, rounds = 0, ill = 0, clean = 0;
    for (let i = 0; i < N; i++) { const r = match(tier, cell, 424242 + i * 97, MD, R); if (r.win) w++; pl += r.place; rounds += r.rounds; ill += r.illegal; if (r.win && !r.lostLives) clean++; }
    out.cells[cell.id][tier] = { winRate: +(w / N).toFixed(3), avgPlace: +(pl / N).toFixed(2), avgRounds: +(rounds / N).toFixed(1), cleanWins: clean, illegalFallbacks: ill };
    console.log(cell.id, tier, JSON.stringify(out.cells[cell.id][tier]), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}
fs.writeFileSync(path.join(__dirname, 'tiers-results.json'), JSON.stringify(out, null, 1));
