// Human-plausible auto-player: perceives only on-screen objects with a 150 ms delay,
// re-decides at 8 Hz (one movement thumb + one spell thumb), uses normal inputs only.
window.__installBot = function (opts) {
  const P = window.__pw;
  const REACT = (opts && opts.react) || 0.15, TICK = (opts && opts.tick) || 0.125;
  const snaps = []; let t = 0, nextDecide = 0, mode = 'stay', lastSeenX = null;
  const stats = { casts: 0, decisions: 0 };
  function snapshot() {
    const camX = P.cameraX(), BW = P.BW;
    const vis = (x) => x >= camX - 2 && x <= camX + BW + 2;
    const ws = [], os = [];
    for (const q of P.wisps) if (!q.dead && vis(q.x)) ws.push({ x: q.x, y: q.y, type: q.type, boss: q.boss, ref: q, vx: q.vx });
    for (const o of P.orbs) if (vis(o.x)) os.push({ x: o.x, y: o.y, vx: o.vx, vy: o.vy });
    return { t, ws, os };
  }
  function perceived() {
    let s = snaps[0];
    for (const q of snaps) { if (q.t <= t - REACT) s = q; else break; }
    return s;
  }
  // plan = [dirA, jumpA, dirB] : hold dirA (jump at start if jumpA) for SPLIT seconds, then dirB.
  const SPLIT = 0.25;
  function simulate(plan, view, w, gy) {
    let x = w.x, y = w.y, vy = w.vy, onG = w.onGround;
    const [dA, jA, dB, jB] = plan;
    if (jA && onG) { vy = -175; onG = false; }
    const age = t - view.t;
    let cost = 0; const H = 1.1, h = 1 / 40;
    let jumpedB = false;
    for (let s = h; s <= H + 1e-6; s += h) {
      const dir = s < SPLIT ? dA : dB;
      if (s >= SPLIT && jB && !jumpedB && onG) { vy = -175; onG = false; jumpedB = true; }
      const spd = (w.castT > 0 && s < w.castT) ? 38 : 62;
      x = Math.max(6, Math.min(P.worldW - 6, x + dir * spd * h));
      if (!onG) { vy += 520 * h; y += vy * h; if (y >= gy) { y = gy; vy = 0; onG = true; } }
      const inv = w.inv > s;
      for (const o of view.os) {
        const ox = o.x + o.vx * (age + s), oy = o.y + o.vy * (age + s);
        if (oy >= gy + 2) continue;
        if (!inv && Math.abs(ox - x) < 6.5 && oy > y - 24 && oy < y + 2) cost += 10 / (s + 0.15);
      }
      for (const q of view.ws) {
        const qx = q.x + (q.vx || 0) * (age + s);
        if (!inv && Math.abs(qx - x) < (q.boss ? 17 : 11) && Math.abs(q.y - (y - 12)) < (q.boss ? 20 : 14)) cost += 4 / (s + 0.2);
      }
    }
    // end-state safety: penalise ending next to a wisp or a wall, and in front of dense orb lanes
    let nd = 1e9; for (const q of view.ws) nd = Math.min(nd, Math.abs(q.x - x));
    if (nd < 30) cost += (30 - nd) * 0.05;
    if (x < 20 || x > P.worldW - 20) cost += 0.6;
    if (jA) cost += 0.05; if (dA) cost += 0.02;
    return cost;
  }
  const ACTIONS = [];
  for (const dA of [0, -1, 1]) for (const jA of [0, 1]) for (const dB of [0, -1, 1]) for (const jB of [0, 1]) if (!(jA && jB)) ACTIONS.push([dA, jA, dB, jB]);
  function decide() {
    stats.decisions++;
    const view = perceived(); if (!view) return;
    const w = P.wiz, gy = P.groundY;
    let best = ACTIONS[0], bc = 1e9;
    for (const a of ACTIONS) { const c = simulate(a, view, w, gy); if (c < bc - 1e-6) { bc = c; best = a; } }
    if (view.ws.length) lastSeenX = view.ws[0].x;
    if (!view.ws.length && !view.os.length && bc < 0.2) { const gx = lastSeenX !== null ? lastSeenX : P.worldW / 2; best = [Math.abs(gx - w.x) < 8 ? 0 : Math.sign(gx - w.x), 0]; if (Math.abs(gx - w.x) < 8) lastSeenX = null; }
    P.held.L = best[0] < 0; P.held.R = best[0] > 0; P.wiz.target = null;
    if (best[1]) P.jump();
    // spell thumb
    const mp = w.mp, SP = P.SPELLS, cds = P.cds;
    const heal = P.SP.heal;
    if (opts && opts.noCast) return;
    if (w.hp < 55 && w.hp + heal <= 108 && mp >= SP[3].cost && cds[3] <= 0) { P.cast(3); stats.casts++; return; }
    if (!view.ws.length) return;
    // target: nearest perceived wisp (by its live object so the tap lands on it)
    let tq = null, td = 1e9;
    for (const q of view.ws) { if (q.ref.dead) continue; const d = Math.hypot(q.x - w.x, (q.y - (w.y - 14)) * 1.2) - (q.boss ? 0 : 0); if (d < td) { td = d; tq = q; } }
    if (!tq) return;
    const weak = [1, 0, 2][tq.type];
    let spell = weak;
    // lightning also good when several are clustered
    let cluster = 0; for (const q of view.ws) if (Math.hypot(q.x - tq.x, q.y - tq.y) < 70) cluster++;
    if (cluster >= 2 && mp >= SP[2].cost && cds[2] <= 0 && weak !== 2) spell = 2;
    if (mp < SP[spell].cost || cds[spell] > 0) {
      const alt = [0, 1, 2].filter(i => mp >= SP[i].cost && cds[i] <= 0);
      if (!alt.length) return;
      if (mp < 30 && w.hp < 60) return; // save for heal
      spell = alt.includes(1) ? 1 : alt[0];
    }
    P.cast(spell, tq.ref); stats.casts++;
  }
  P.stepHook = function (dt) {
    t += dt;
    snaps.push(snapshot()); while (snaps.length && snaps[0].t < t - 0.4) snaps.shift();
    if (t >= nextDecide) { nextDecide = t + TICK; decide(); }
  };
  return stats;
};
