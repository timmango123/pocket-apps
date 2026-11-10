// generated from tiers.js for simbot.js
const TIERS = {
  clumsy:     { name: '手殘', lat: [650, 200], pos: 40, tim: 120, mistake: 0.15, randomFrac: 0.5, dec: 300, V: 450, comp: 0,   hor: 0.35, bt: 0, margin: 6 },
  casual:     { name: '普通', lat: [400, 100], pos: 20, tim: 60,  mistake: 0.06, randomFrac: 0.15, dec: 200, V: 650, comp: 0.5, hor: 0.6, bt: 0.5, margin: 5 },
  skilled:    { name: '熟練', lat: [260, 50],  pos: 10, tim: 30,  mistake: 0.02, randomFrac: 0,   dec: 130, V: 850, comp: 1,   hor: 1.0, bt: 1, margin: 4, plan2: 1 },
  world:      { name: '世界級', lat: [180, 25], pos: 4,  tim: 12,  mistake: 0.003, randomFrac: 0,  dec: 100, V: 1100, comp: 1,  hor: 1.3, bt: 1, margin: 3, plan2: 1 },
  superhuman: { name: '非人', lat: [16, 0],    pos: 0,  tim: 0,   mistake: 0,   randomFrac: 0,   dec: 16,  V: 1600, comp: 1,   hor: 1.3, bt: 1, margin: 2, plan2: 1 }
};

function mulberry(a) { return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// candidate scoring: swept (continuous) closest approach between the straight move to the candidate and each
// bullet's linear path, over time windows weighted by how soon they are
function segMin(rx, ry, vx, vy, a, b) { // min |r + v t| for t in [a,b]
  const vv = vx * vx + vy * vy; let t = vv > 1e-9 ? -(rx * vx + ry * vy) / vv : a; if (t < a) t = a; else if (t > b) t = b;
  const x = rx + vx * t, y = ry + vy * t; return Math.sqrt(x * x + y * y);
}
const WIN = [[0, 0.12, 1.4], [0.12, 0.3, 1], [0.3, 0.55, 0.6], [0.55, 0.85, 0.35], [0.85, 1.3, 0.2], [1.3, 1.8, 0.12], [1.8, 2.4, 0.08]];
// path = piecewise-linear finger path from (px,py) through waypoints at speed V, then standing still until the horizon
function pathCost(sn, near, px, py, way, off, P, hor) {
  const { L, R, T, B, b } = sn, segs = []; let x = px, y = py, t = 0, len = 0;
  for (const c of way) { const d = Math.hypot(c[0] - x, c[1] - y), dt = d / P.V; if (dt > 1e-6) segs.push([t, t + dt, x, y, (c[0] - x) / dt, (c[1] - y) / dt]); t += dt; x = c[0]; y = c[1]; len += d; }
  segs.push([t, 99, x, y, 0, 0]);
  const win = WIN.filter(w => w[0] < hor - 1e-6).map(w => [w[0], Math.min(w[1], hor), w[2]]);
  let cost = len * 0.012; const mg = P.margin;
  for (const i of near) {
    const hr = b[i + 4] + 4, bx = b[i] + b[i + 2] * off, by = b[i + 1] + b[i + 3] * off, vx = b[i + 2], vy = b[i + 3];
    for (const [w0, w1, w] of win) {
      let d = Infinity;
      for (const sg of segs) {
        const a0 = Math.max(w0, sg[0]), a1 = Math.min(w1, sg[1]); if (a0 >= a1) continue;
        // player at time t on this segment: (sg[2] + sg[4] (t - sg[0]), ...); bullet: (bx + vx t, ...)
        d = Math.min(d, segMin(bx - sg[2] + sg[4] * sg[0], by - sg[3] + sg[5] * sg[0], vx - sg[4], vy - sg[5], a0, a1));
      }
      d -= hr;
      if (d < mg) cost += 6000 * w; else if (d < 22) cost += (22 - d) * (22 - d) * w;
    }
  }
  const m = Math.min(x - L, R - x, y - T, B - y); if (m < 50) cost += (50 - m) * (50 - m) * 0.4;
  cost += ((x - (L + R) / 2) ** 2 + (y - (T + (B - T) * 0.66)) ** 2) * 0.0006;
  return cost;
}
function ring(x, y, sn, radii, k) {
  const out = [];
  for (const rad of radii) for (let j = 0; j < k; j++) { const a = j / k * 6.2832 + rad * 0.07, cx = x + Math.cos(a) * rad, cy = y + Math.sin(a) * rad; if (cx > sn.L + 1 && cx < sn.R - 1 && cy > sn.T + 1 && cy < sn.B - 1) out.push([cx, cy, rad]); }
  return out;
}
function decide(sn, px, py, off, P) {
  const b = sn.b, near = [], reach = 160 + (P.hor + (P.plan2 ? 1.1 : 0)) * 420;
  for (let i = 0; i < b.length; i += 5) { const dx = b[i] - px, dy = b[i + 1] - py; if (dx * dx + dy * dy < reach * reach) near.push(i); }
  const cands = [[px, py, 0]].concat(ring(px, py, sn, [14, 28, 46, 70, 100, 140, 190, 250, 320], 20));
  const scored = cands.map(c => ({ c, cost: pathCost(sn, near, px, py, [c], off, P, P.hor) }));
  scored.sort((a, b) => a.cost - b.cost);
  if (P.plan2 && scored[0].cost > 400) {
    // two-leg plans (e.g. through one wall's gap, then the other's), longer horizon
    const H2 = P.hor + 1.1, firsts = scored.slice(0, 10).concat(scored.filter(s => s.c[2] >= 190).slice(0, 8));
    let best = null;
    for (const f of firsts) for (const c2 of [f.c].concat(ring(f.c[0], f.c[1], sn, [40, 90, 150, 220, 300], 12))) {
      const cost = pathCost(sn, near, px, py, [f.c, c2], off, P, H2);
      if (!best || cost < best.cost) best = { c: f.c, cost, c2 };
    }
    const base = pathCost(sn, near, px, py, [scored[0].c], off, P, H2);
    if (best && best.cost < base) return [best].concat(scored);
  }
  return scored;
}


module.exports={decide,TIERS,mulberry,gauss};
