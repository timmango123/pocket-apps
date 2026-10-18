// Look-ahead planner for the world-class / superhuman bots (and an offline tuning tool). It clones the game state into
// the game's own engine (BM.stepOnce), tries a set of macro actions (optionally plant a firecracker here, walk a BFS path
// to a nearby cell, then stand), plays each forward for a couple of seconds against a few random futures of the monsters,
// and picks the action with the best average outcome. Receding horizon: only the first step is executed, then re-plan.
'use strict';
module.exports = function makePlanner(BM) {
  const { DX, DY, EMPTY, SOFT, IT } = BM;
  const W_ = s => s.w;
  function cloneSim(o, seed) {
    // o: a sim (real or a read-only snapshot from the page). Only fields stepOnce reads are copied.
    const N = o.w * o.h;
    return {
      mode: o.mode === 'battle' ? 'battle' : 'stage', w: o.w, h: o.h, n: o.n || 0,
      grid: Array.from(o.grid), items: Array.from(o.items), fire: Float32Array.from(o.fire),
      crumble: new Float32Array(N), flash: new Float32Array(N),
      bombs: o.bombs.map(b => ({ x: b.x, y: b.y, owner: b.owner, range: b.range, t: b.t, slide: b.slide, p: b.p || 0 })),
      bombers: o.bombers.map(b => ({ id: b.id, x: b.x, y: b.y, sx: b.sx != null ? b.sx : 1, sy: b.sy != null ? b.sy : 1, dir: 2, moving: false, alive: b.alive, cpu: false,
        bombs: b.bombs, fire: b.fire, speed: b.speed, kick: b.kick, shield: b.shield, invul: b.invul, placed: b.placed, onBomb: b.onBomb,
        inDir: -1, inBomb: false, bombHeld: false, deadT: 0, anim: 0, plan: null, wait: 0, lastCell: -1, lastVer: -1, kills: 0, skill: 2 })),
      enemies: o.enemies.map(e => ({ t: e.t, x: e.x, y: e.y, tx: e.tx, ty: e.ty, dir: e.dir, speed: e.speed || BM.ENEMY[e.t].speed, hp: e.hp, alive: e.alive, hurt: e.hurt || 0, anim: 0, deadT: 0 })),
      events: [], time: o.time, limit: o.limit || 999, status: 'play', winner: -1, doorOpen: o.doorOpen, doorCell: o.doorCell,
      rng: BM.mulberry(seed), bombVer: 0, lives: 1, sudden: o.sudden ? Object.assign({}, o.sudden, { order: o.sudden.order || BM.spiralOrder(o.w, o.h) }) : null,
      distP: null, distT: 0, endT: 0, started: true, skill: 1, deaths: 0, kills: o.kills || 0
    };
  }
  function dirTo(b, cell, W, tol) {
    const nx = (cell % W) + 0.5, ny = Math.floor(cell / W) + 0.5, dx = nx - b.x, dy = ny - b.y;
    if (Math.abs(dx) < tol && Math.abs(dy) < tol) return -1;
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
  }
  // walkable for the planner: empty, no bomb (except the one it stands on), not burning
  function reach(s, b, maxD) {
    const W = s.w, cx = Math.floor(b.x), cy = Math.floor(b.y), c = cy * W + cx;
    return BM.bfs(s, cx, cy, (x, y, d) => d <= maxD && s.grid[y * W + x] === EMPTY && !(BM.bombAt(s, x, y) && y * W + x !== c));
  }
  function pathTo(r, from, to) { const p = []; let c = to; while (c !== from && c >= 0) { p.push(c); c = r.prev[c]; } return c === from ? p.reverse() : null; }
  // distance (cells) to the nearest useful thing: open door, item, soft block, monster
  function workDist(s, b) {
    const W = s.w, cx = Math.floor(b.x), cy = Math.floor(b.y);
    const r = BM.bfs(s, cx, cy, (x, y) => s.grid[y * W + x] !== 1);   // soft blocks count as walkable (they get blown)
    let best = 99;
    for (const u of r.order) {
      const d = r.dist[u]; if (d >= best) break;
      const g = s.grid[u], it = s.items[u];
      if (s.doorOpen) { if (u === s.doorCell) best = d * 2; continue; }
      if (g === SOFT || (it && it !== IT.DOOR)) { best = d; break; }
      if (s.enemies.some(e => e.alive && Math.floor(e.x) + Math.floor(e.y) * W === u)) { best = d; break; }
    }
    return best;
  }
  function monsterNear(s, b) {
    let m = 9; for (const e of s.enemies) if (e.alive) m = Math.min(m, Math.abs(e.x - b.x) + Math.abs(e.y - b.y)); return m;
  }
  function rollout(base, macro, seed, horizon, me) {
    const s = cloneSim(base, seed), b = s.bombers[me];
    for (const o of s.bombers) if (o.id !== me) { o.cpu = true; o.skill = base.cpuSkill == null ? 1 : base.cpuSkill; }   // rival cats play the built-in brain
    const W = s.w, path = macro.path.slice();
    const kills0 = s.kills, soft0 = s.grid.reduce((a, g) => a + (g === SOFT ? 1 : 0), 0), pw0 = b.bombs + b.fire + b.speed * 2 + (b.kick ? 1 : 0) + (b.shield ? 2 : 0);
    const DT = 1 / 30, steps = Math.round(horizon / DT);
    let dead = -1, won = false, minMon = 9;
    for (let i = 0; i < steps; i++) {
      if (!b.cpu) {
        let dir = -1;
        while (path.length && dirTo(b, path[0], W, 0.07) < 0) path.shift();
        if (path.length) dir = dirTo(b, path[0], W, 0.03);
        b.inDir = dir; b.inBomb = i === 0 && macro.bomb;
        if (!path.length && i > 0 && i * DT >= (macro.hold || 0)) { b.cpu = true; b.plan = null; b.lastCell = -1; }   // then the built-in brain takes over
      }
      BM.stepOnce(s, DT);
      s.events.length = 0;
      if (!b.alive) { dead = i; break; }
      if (s.status === 'won') { won = true; break; }
      if (i % 3 === 0) minMon = Math.min(minMon, monsterNear(s, b));
    }
    if (won) return 1e6 - steps;
    if (dead >= 0) return -1e6 + dead * 100;
    const soft1 = s.grid.reduce((a, g) => a + (g === SOFT ? 1 : 0), 0), pw1 = b.bombs + b.fire + b.speed * 2 + (b.kick ? 1 : 0) + (b.shield ? 2 : 0);
    let sc = (s.kills - kills0) * 400 + (soft0 - soft1) * 25 + (pw1 - pw0) * 60;
    if (s.doorOpen && !base.doorOpen) sc += 300;
    sc -= workDist(s, b) * 6;
    // end state safety: what the monsters and the remaining firecrackers can still do
    const D = BM.dangerMap(s), c = Math.floor(b.y) * W + Math.floor(b.x);
    if (D[c] !== Infinity) sc -= 80;
    sc += Math.min(minMon, 3) * 25 + Math.min(monsterNear(s, b), 4) * 10;
    return sc;
  }
  // opts: { samples, horizon, maxD }
  function decide(sim, me, opts) {
    opts = opts || {};
    const K = opts.samples || 3, H = opts.horizon || 2.8, maxD = opts.maxD || 3;
    const b = sim.bombers[me], W = sim.w, cx = Math.floor(b.x), cy = Math.floor(b.y), c = cy * W + cx;
    if (sim.mode === 'stage' && sim.doorOpen && c === sim.doorCell) return { path: [c], bomb: false, score: 1e6, n: 0 };   // step onto the centre of the open door
    const r = reach(sim, b, maxD);
    const canBomb = b.placed < b.bombs && !BM.bombAt(sim, cx, cy) && sim.fire[c] <= 0 && sim.grid[c] === EMPTY;
    const cands = [];
    const useful = canBomb && (BM.softAdj(sim, cx, cy) > 0 || sim.enemies.some(e => e.alive && (Math.abs(e.x - b.x) < 0.6 || Math.abs(e.y - b.y) < 0.6) && Math.abs(e.x - b.x) + Math.abs(e.y - b.y) < b.fire + 2.5) || monsterNear(sim, b) < 3.5);
    for (const u of r.order) {
      const p = u === c ? [] : pathTo(r, c, u); if (!p) continue;
      if (u !== c) cands.push({ path: p, bomb: false, to: u });
      if (canBomb && useful && r.dist[u] >= 1 && r.dist[u] <= 4) cands.push({ path: p, bomb: true, to: u });
    }
    if (useful) cands.push({ path: [], bomb: true, to: c });
    cands.push({ path: [], bomb: false, to: c, hold: 0.4 });
    { const cl = cloneSim(sim, 1), cb = cl.bombers[me]; cb.skill = 2; const d = BM.cpuDecide(cl, cb); cands.push({ path: d.path.slice(), bomb: !!d.bomb && canBomb, to: d.path.length ? d.path[d.path.length - 1] : c, brain: true }); }
    const seed0 = (opts.seed || 1) * 7919;
    const evalC = m => { let tot = 0, dead = 0; for (let k = 0; k < K; k++) { const v = rollout(sim, m, seed0 + k * 104729, H, me); if (v < -5e5) dead++; tot += v; } return { dead, v: tot / K }; };
    // the built-in brain's choice stands unless a look-ahead shows it can get the cat killed
    const brain = cands[cands.length - 1], be = evalC(brain);
    let best = brain, bs = be.v, bd = be.dead;
    if (be.dead > 0) for (const m of cands) {
      if (m === brain) continue;
      const e = evalC(m), v = e.v - m.path.length * 0.5;
      if (e.dead < bd || (e.dead === bd && v > bs)) { best = m; bs = v; bd = e.dead; }
      if (bd === 0 && opts.firstSafe) break;
    }
    return { path: best ? best.path : [], bomb: !!(best && best.bomb), score: bs, n: cands.length };
  }
  return { decide, cloneSim, dirTo };
};
