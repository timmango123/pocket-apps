// Offline solver shared by solve.js / verify.js. Uses the game's own core (World, genLevel, buildWorld...).
module.exports = function(C){
  const { TICK, DT, GRAV, SLING_X, SLING_Y } = C;
  const K0 = 14;
  function boundaryAfter(s){ return Math.ceil(s / TICK) * TICK; }
  function launchStepFor(W, ph, delay){
    let s = boundaryAfter(W.stepN + (delay || 72));
    if (ph >= 0 && W.movers.length){ const P = W.movers[0].P; while (s % P !== ph) s += TICK; }
    return s;
  }
  // run one shot on W (mutates). shot = {dx,dy,tap,ph}
  function runShot(W, shot, ammo, opts){
    const v = C.pullToVel(shot.dx, shot.dy);
    const L = launchStepFor(W, shot.ph, opts && opts.delay);
    while (W.stepN < L) W.step();
    W.qL = { vx: v.vx, vy: v.vy, ammo: ammo };
    const T = shot.tap >= 0 ? L + shot.tap : -1;
    W.step();
    let guard = 0;
    while (W.shotActive && guard++ < 1300){
      if (T >= 0 && W.stepN === T - 1) W.qT = true;
      W.step();
    }
    return L;
  }
  // ballistic pre-trace against sleeping bodies' AABBs
  function pretrace(W, vx, vy, ammo, maxSteps, L0){
    const r = ammo === 2 ? 0.36 : 0.3, bs = W.bodies, wind = W.wind;
    let x = SLING_X, y = SLING_Y, path = [];
    const movers = W.movers;
    for (let k = 1; k < (maxSteps || 600); k++){
      vy += GRAV*DT; vx += wind*DT; x += vx*DT; y += vy*DT;
      if ((k % 3) === 0) path.push([k, x, y, vx, vy]);
      if (y - r < 0) return { k, x, y, body: null, spd: Math.hypot(vx, vy), vx, vy, path };
      if (x > 80 || x < -10) return { k, x, y, body: null, out: true, path };
      for (let i = 0; i < bs.length; i++){
        const b = bs[i];
        if (!b.dyn && b.kind !== 'static' && b.kind !== 'mover' && b.kind !== 'rider') continue;
        if (b.kind === 'static' && b.minY < -0.5) continue; // ground
        let mnx = b.minX, mxx = b.maxX;
        if ((b.kind === 'mover' || b.kind === 'rider') && L0 != null){
          const M = b.kind === 'mover' ? b.mv : b.mv.m; const st = L0 + k;
          const ph = 6.283185307179586 * (st % M.P) / M.P; const nx = M.x0 + M.A*Math.sin(ph) + (b.kind === 'rider' ? b.mv.ox : 0);
          const dx = nx - b.x; mnx += dx; mxx += dx;
        }
        if (x + r < mnx || x - r > mxx || y + r < b.minY || y - r > b.maxY) continue;
        return { k, x, y, body: b, spd: Math.hypot(vx, vy), vx, vy, path };
      }
    }
    return { k: 999, x, y, body: null, path };
  }
  function gobsOf(W){ return W.bodies.filter(b => b.kind === 'gob' || b.kind === 'rider'); }
  function candidates(W, ammo, R, phases){
    const out = [], seen = new Set(), gl = gobsOf(W);
    for (let ad = -6; ad <= 78; ad += 1.5){
      const a = ad*Math.PI/180;
      for (let p = 0.3; p <= 1.0001; p += 0.025){
        const dx = Math.round(Math.cos(a)*120*p), dy = Math.round(Math.sin(a)*120*p);
        if (dx < 1) continue;
        const key = dx*1000 + dy; if (seen.has(key)) continue; seen.add(key);
        if (Math.hypot(dx, dy) < 21 || Math.hypot(dx, dy) > 120) continue;
        for (const ph of phases) out.push({ dx, dy, tap: -1, ph });
      }
    }
    // pretrace + group
    const groups = new Map();
    for (const c of out){
      const v = C.pullToVel(c.dx, c.dy);
      const L0 = c.ph >= 0 ? launchStepFor(W, c.ph) : null;
      const t = pretrace(W, v.vx, v.vy, ammo, 600, L0);
      c.t = t;
      if (!t.body && (t.out || t.x < W.bodies.reduce((m,b)=>b.dyn? Math.min(m,b.minX):m, 99) - 3)) continue;
      const key = (t.body ? t.body.id : 0) + ':' + Math.floor(t.y/0.4) + ':' + (t.vy < 0 ? 1 : 0) + ':' + c.ph + (t.body ? '' : ':' + Math.floor(t.x/0.6));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(c);
    }
    const reps = [];
    for (const [key, arr] of groups){
      const c = arr[Math.floor(arr.length/2)], t = c.t, b = t.body;
      let dmin = 99; for (const g of gl){ const d = Math.hypot(g.x - t.x, g.y - t.y); if (d < dmin) dmin = d; }
      let h;
      if (b && (b.kind === 'gob' || b.kind === 'rider')) h = 1000 + t.spd;
      else if (b && b.kind === 'tnt') h = 600 - dmin*20;
      else if (b && b.dyn) h = 300 - dmin*35 + t.spd*4 + (b.mat === 'stone' ? -20 : 0) + Math.min(arr.length, 20);
      else h = 100 - dmin*40;
      c.h = h; c.n = arr.length; reps.push(c);
    }
    reps.sort((a, b) => b.h - a.h || a.dx - b.dx || a.dy - b.dy);
    return { reps, gl, all: out };
  }
  function addTaps(list, ammo, W, gl){
    const extra = [];
    if (ammo === 1){
      for (const c of list){
        const k = c.t.k;
        for (const f of [0.45, 0.7]){ const tap = Math.max(TICK, Math.round(k*f/TICK)*TICK); extra.push({ dx: c.dx, dy: c.dy, tap, ph: c.ph, t: c.t, h: c.h }); }
      }
    }
    return extra;
  }
  function heavyCands(cands, gl, W){
    // for each goblin, find trajectories passing well above it and tap there
    const out = [];
    for (const g of gl){
      const opts = [];
      for (const c of cands){
        if (c.t.k > 900) continue;
        for (const p of c.t.path){
          if (p[0] >= c.t.k - 3) break;
          if (Math.abs(p[1] - g.x) < 0.12 && p[2] > g.y + 1.2){ opts.push({ c, k: p[0], hgt: p[2] - g.y }); break; }
        }
      }
      opts.sort((a, b) => a.hgt - b.hgt);
      const pick = [opts[0], opts[Math.floor(opts.length/3)], opts[Math.floor(opts.length*2/3)]].filter(Boolean);
      for (const o of pick){ const tap = Math.max(TICK, Math.floor(o.k/TICK)*TICK); out.push({ dx: o.c.dx, dy: o.c.dy, tap, ph: o.c.ph, h: 900 }); }
    }
    return out;
  }
  function evalState(W){ return { gob: W.gobAlive, score: W.score }; }
  function better(a, b){ return a.W.gobAlive !== b.W.gobAlive ? a.W.gobAlive < b.W.gobAlive : a.W.score > b.W.score; }
  // beam search for the fewest shots
  function solve(spec, opts){
    opts = opts || {};
    const K = opts.K || 14, KR = opts.KR || 4, beamW = opts.beam || 2, maxDepth = opts.maxDepth || 7;
    const R = C.rng(spec.seed * 31 + spec.n);
    const W0 = C.buildWorld(spec);
    const hasMov = W0.movers.length > 0;
    let beam = [{ W: W0, shots: [] }], sims = 0;
    for (let d = 0; d < maxDepth; d++){
      const ammo = spec.pattern[d];
      const Kd = d >= 2 ? K + 6 : K;
      const children = [];
      let winners = [];
      for (const st of beam){
        const phases = hasMov ? (() => { const P = st.W.movers[0].P; return [0, 1, 2, 3].map(q => Math.round(q*P/4/TICK)*TICK % P); })() : [-1];
        const { reps, gl } = candidates(st.W, ammo, R, phases);
        let list = reps.slice(0, Kd);
        const rest = reps.slice(Kd);
        for (let i = 0; i < KR && rest.length; i++) list.push(rest.splice(Math.floor(R()*rest.length), 1)[0]);
        if (ammo === 1) list = list.concat(addTaps(list.slice(0, 8), ammo, st.W, gl));
        if (ammo === 2) list = list.concat(heavyCands(reps.slice(0, 200).concat(rest), gl, st.W));
        for (const c of list){
          const W = st.W.clone();
          const shot = { dx: c.dx, dy: c.dy, tap: c.tap, ph: c.ph };
          runShot(W, shot, ammo); sims++;
          const node = { W, shots: st.shots.concat([shot]), pre: st.W };
          if (W.gobAlive === 0){ winners.push(node); if (opts.firstWin) break; }
          else children.push(node);
        }
        if (winners.length && opts.firstWin) break;
      }
      if (winners.length){
        winners.sort((a, b) => b.W.score - a.W.score);
        // robustness of the final shot: +-1px neighbours from the same pre-state
        let bestW = null, bestR = -1;
        for (const w of winners.slice(0, 3)){
          const pre = w.pre, last = w.shots[w.shots.length - 1]; let ok = 0;
          for (const [ex, ey] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
            const W2 = pre.clone(); runShot(W2, { dx: last.dx + ex, dy: last.dy + ey, tap: last.tap, ph: last.ph }, ammo); sims++; if (W2.gobAlive === 0) ok++;
          }
          w.rob = ok/8; if (w.rob > bestR + 1e-9 || (Math.abs(w.rob - bestR) < 1e-9 && w.W.score > bestW.W.score)){ bestR = w.rob; bestW = w; }
        }
        return { ok: true, shots: bestW.shots, score: bestW.W.score, sims, winners: winners.length, depth: d + 1, rob: bestW.rob };
      }
      children.sort((a, b) => better(a, b) ? -1 : (better(b, a) ? 1 : 0));
      // keep diverse beam: distinct (gob, score)
      const nb = [], keys = new Set();
      for (const ch of children){ const k = ch.W.gobAlive + ':' + ch.W.score; if (keys.has(k)) continue; keys.add(k); nb.push(ch); if (nb.length >= beamW) break; }
      beam = nb;
      if (opts.log) console.log('  depth', d+1, 'best gobs left', beam[0] && beam[0].W.gobAlive, 'score', beam[0] && beam[0].W.score, 'sims', sims);
    }
    return { ok: false, sims };
  }
  // replay a solution from scratch; returns world + per-shot launch steps
  function replay(spec, shots, opts){
    const W = C.buildWorld(spec); const L = [];
    for (let i = 0; i < shots.length; i++){ L.push(runShot(W, shots[i], spec.pattern[i], opts)); if (W.gobAlive === 0) break; }
    return { W, L };
  }
  return { runShot, pretrace, candidates, solve, replay, launchStepFor };
};
