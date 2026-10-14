// Offline reasoning for antikythera bots: candidate placements that mesh with the driven train, and a DFS solver.
const K = require('./core.js');
function drivenInfo(L, placement) { return K.evaluate(L, placement); }
// all placements (peg, piece, orient) that create at least one new mesh with a driven gear and don't jam
function candidates(L, placement, opts = {}) {
  const ev = K.evaluate(L, placement);
  const used = new Set([...placement.values()].map(p => p.piece.id));
  const out = [];
  const driven = [...ev.pegInfo.entries()].filter(([, inf]) => inf.ratio);
  L.pegs.forEach((p, peg) => {
    if (p.kind === 'crank' || placement.has(peg)) return;
    // must be at a mesh distance from some driven gear
    for (const piece of L.pieces) {
      if (used.has(piece.id)) continue;
      for (const orient of piece.t.length === 1 ? [0, 1] : [0, 1]) {
        const w = K.pieceWheels(piece, orient);
        let meshes = false;
        for (const [dp, inf] of driven) {
          const q = L.pegs[dp], d = Math.hypot(q.x - p.x, q.y - p.y);
          for (const Ly of ['A', 'B']) if (w[Ly] && inf.w[Ly] && Math.abs(d - w[Ly] - inf.w[Ly]) <= 0.6) meshes = true;
        }
        if (!meshes) continue;
        const pl = new Map(placement); pl.set(peg, { piece, orient });
        const e2 = K.evaluate(L, pl);
        if (e2.jammed) continue;
        // output check
        let outScore = 0, bad = false;
        L.outputs.forEach((o, i) => { if (e2.outs[i].ratio) { if (e2.outs[i].ok) outScore++; else bad = true; } });
        if (bad && !opts.allowBad) continue;
        out.push({ peg, piece, orient, outScore, ev: e2, single: piece.t.length === 1 });
      }
    }
  });
  return out;
}
// DFS: returns list of {peg, pieceId, orient} or null
function solveDFS(L, placement, maxNodes = 200000) {
  let nodes = 0;
  const seen = new Set();
  const key = pl => [...pl.entries()].map(([k, v]) => k + ':' + v.piece.id + ':' + v.orient).sort().join(',');
  function go(pl, acc) {
    if (++nodes > maxNodes) return null;
    const ev = K.evaluate(L, pl);
    if (ev.win) return acc;
    const k = key(pl); if (seen.has(k)) return null; seen.add(k);
    const cands = candidates(L, pl);
    cands.sort((a, b) => b.outScore - a.outScore);
    for (const c of cands) {
      const p2 = new Map(pl); p2.set(c.peg, { piece: c.piece, orient: c.orient });
      const r = go(p2, acc.concat([{ peg: c.peg, pieceId: c.piece.id, orient: c.orient }]));
      if (r) return r;
    }
    return null;
  }
  const r = go(new Map(placement), []);
  return { plan: r, nodes };
}
module.exports = { K, candidates, solveDFS };
