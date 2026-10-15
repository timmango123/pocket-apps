// Auto-player for the bottom (human) mallet. Strategy: intercept incoming shots, otherwise get behind the
// puck and strike it toward the open side of the AI goal (direct or single bank). Pure function of a
// *perceived* state (callers feed it state that is >=150 ms old) -> desired mallet position (world coords).
const WW = 360, WH = 640, PR = 16, MR = 28, GX0 = 120, GX1 = 240, MID = 320;
function fold(xr) { const lo = PR, hi = WW - PR; for (let i = 0; i < 6; i++) { if (xr < lo) xr = 2 * lo - xr; else if (xr > hi) xr = 2 * hi - xr; else break; } return xr; }
function makeBot(seed) {
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const mem = { st: 'def', until: 0, cd: 0, img: 180, sx: 0, sy: 0 };
  // st: {px,py,pvx,pvy,on,freeze, mx,my, ox,oy}; now in seconds. Returns {x,y} world.
  return function plan(st, now) {
    // local frame: own goal at y=0
    // compensate own perception lag by extrapolating the (old) puck state forward, folding at walls
    const LA = st.on && !(st.freeze > 0) ? 0.15 : 0, k = Math.exp(-0.4 * LA);
    let ex = st.px + st.pvx * LA, ey = st.py + st.pvy * LA, evx = st.pvx * k, evy = st.pvy * k;
    if (ex < PR) { ex = 2 * PR - ex; evx = -evx; } else if (ex > WW - PR) { ex = 2 * (WW - PR) - ex; evx = -evx; }
    if (ey < PR && (ex < GX0 || ex > GX1)) { ey = 2 * PR - ey; evy = -evy; } else if (ey > WH - PR && (ex < GX0 || ex > GX1)) { ey = 2 * (WH - PR) - ey; evy = -evy; }
    const px = ex, py = WH - ey, pvx = evx, pvy = -evy;
    const mx = st.mx, my = WH - st.my, ox = st.ox, oy = WH - st.oy;
    const R2 = MR + PR, sp = Math.hypot(pvx, pvy);
    let tx, ty;
    const home = () => { const dx = px - WW / 2, dy = Math.max(40, py), d = Math.hypot(dx, dy); tx = WW / 2 + dx / d * 70; ty = Math.max(MR + 4, dy / d * 70); };
    if (!st.on || st.freeze > 0) { mem.st = 'def'; tx = WW / 2; ty = 80; }
    else if (mem.st === 'strike') { tx = mem.sx; ty = mem.sy; if (now > mem.until) { mem.st = 'def'; mem.cd = now + 0.1; } }
    else {
      const mine = py < MID - 2;
      if (mine && pvy > -170 && sp < 700 && now > mem.cd) {
        if (mem.st !== 'app') {
          // choose the shot whose line passes farthest from the AI mallet
          mem.st = 'app'; mem.until = now + 1.6;
          let best = -1;
          for (const gx of [GX0 + 26, WW / 2, GX1 - 26]) for (const k of [0, 1, 2]) {
            const ix = k === 0 ? gx : k === 1 ? 2 * PR - gx : 2 * (WW - PR) - gx;
            const xr = px + (ix - px) * (oy - py) / (WH + PR - py);
            const sc = Math.abs(fold(xr) - ox) + rnd() * 20 - (k ? 12 : 0);
            if (sc > best) { best = sc; mem.img = ix; }
          }
        }
        let dx = mem.img - px, dy = WH + PR - py; const d = Math.hypot(dx, dy); dx /= d; dy /= d;
        const rx = mx - px, ry = my - py, along = rx * dx + ry * dy;
        if (along > -R2 * 0.6) {
          const sx = -dy, sy = dx; let sg = rx * sx + ry * sy >= 0 ? 1 : -1;
          const cx = px + sg * sx * (R2 + 20) - dx * R2 * 1.3;
          if (cx < MR || cx > WW - MR) sg = -sg;
          tx = px + sg * sx * (R2 + 20) - dx * R2 * 1.3; ty = py + sg * sy * (R2 + 20) - dy * R2 * 1.3;
        } else {
          const bx = px - dx * (R2 + 56), by = py - dy * (R2 + 56);
          tx = bx; ty = by;
          if (Math.hypot(mx - bx, my - by) < 14 + sp * 0.03) { mem.st = 'strike'; mem.until = now + 0.22; mem.sx = px + dx * 90; mem.sy = py + dy * 90; tx = mem.sx; ty = mem.sy; }
        }
        if (mem.st === 'app' && now > mem.until) { mem.st = 'def'; mem.cd = now + 0.3; }
      } else {
        if (mem.st === 'app') mem.st = 'def';
        const inc = pvy < -90;
        if (inc && !mem.inc) mem.err = (rnd() + rnd() + rnd() - 1.5) * 70;
        mem.inc = inc;
        if (pvy < -90 && py > 78) {
          const yD = 72, t = (yD - py) / pvy;
          const g = fold(px + pvx * (PR - py) / pvy);
          const q = fold(px + pvx * t);
          if (g > GX0 - 30 && g < GX1 + 30) { tx = q + (mem.err || 0); ty = yD; } else home();
        } else home();
      }
    }
    return { x: tx, y: WH - ty };
  };
}
module.exports = { makeBot };
