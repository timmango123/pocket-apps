// Skill-tier auto-player for air-hockey (reviewer's own, per qa/skill-tiers/SPEC.md).
// Strategy core adapted from apps/air-hockey/demo/bot.js (intercept incoming shots, otherwise get behind the puck
// and strike toward the side of the AI goal farthest from the AI mallet), wrapped with tier-specific human limits:
//   perception delay (reaction mean/sd + timing sd, resampled every 250 ms), partial lag compensation,
//   position error (Gaussian offset re-drawn every 300 ms), mistakes (wrong-side read per incoming shot / whiffed
//   strike), max finger speed. Superhuman: 16 ms delay, exact extrapolation, no noise, fast finger.
const WW = 360, WH = 640, PR = 16, MR = 28, GX0 = 120, GX1 = 240, MID = 320;
const TIERS = {
  clumsy:     { react: 650, rsd: 200, pos: 40, tsd: 120, mistake: 0.15, comp: 0.4, fspd: 1500, derr: 1.5, attempts: 5 },
  casual:     { react: 400, rsd: 100, pos: 20, tsd: 60,  mistake: 0.06, comp: 0.6, fspd: 2000, derr: 1.0, attempts: 3 },
  skilled:    { react: 260, rsd: 50,  pos: 10, tsd: 30,  mistake: 0.02, comp: 0.8, fspd: 2400, derr: 0.6, attempts: 3 },
  world:      { react: 180, rsd: 25,  pos: 4,  tsd: 12,  mistake: 0.003, comp: 0.95, fspd: 2800, derr: 0.3, attempts: 3 },
  superhuman: { react: 16,  rsd: 0,   pos: 0,  tsd: 0,   mistake: 0, comp: 1.0, fspd: 6000, derr: 0, attempts: 3 },
};
function fold(xr) { const lo = PR, hi = WW - PR; for (let i = 0; i < 6; i++) { if (xr < lo) xr = 2 * lo - xr; else if (xr > hi) xr = 2 * hi - xr; else break; } return xr; }
function mkRnd(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function gauss(r) { const u = r() || 1e-9, v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * v); }
function makeTierBot(tier, seed) {
  const T = TIERS[tier], rnd = mkRnd(seed * 2654435761 + 99);
  const mem = { st: 'def', until: 0, cd: 0, img: 180, sx: 0, sy: 0, inc: false, err: 0, ox: 0, oy: 0, nextPos: 0, delay: T.react / 1000, nextDelay: 0, whiff: false };
  function curDelay(now) {
    if (now >= mem.nextDelay) { const sd = Math.hypot(T.rsd, T.tsd) / 1000; mem.delay = Math.max(0.016, T.react / 1000 + gauss(rnd) * sd); mem.nextDelay = now + 0.25; }
    return mem.delay;
  }
  // st = perceived (old) state; age = how old it is (s). Returns desired mallet {x,y} world.
  function plan(st, now, age) {
    const LA = st.on && !(st.freeze > 0) ? age * T.comp : 0, k = Math.exp(-0.4 * LA);
    let ex = st.px + st.pvx * LA, ey = st.py + st.pvy * LA, evx = st.pvx * k, evy = st.pvy * k;
    ex = fold(ex); if (st.px + st.pvx * LA < PR || st.px + st.pvx * LA > WW - PR) evx = -evx;
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
          mem.st = 'app'; mem.until = now + 1.6; mem.whiff = rnd() < T.mistake;
          let best = -1;
          for (const gx of [GX0 + 26, WW / 2, GX1 - 26]) for (const kk of [0, 1, 2]) {
            const ix = kk === 0 ? gx : kk === 1 ? 2 * PR - gx : 2 * (WW - PR) - gx;
            const xr = px + (ix - px) * (oy - py) / (WH + PR - py);
            const sc = Math.abs(fold(xr) - ox) + rnd() * 20 - (kk ? 12 : 0);
            if (sc > best) { best = sc; mem.img = ix; }
          }
          if (mem.whiff) mem.img += (rnd() < 0.5 ? -1 : 1) * 160; // mis-aimed swing
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
        if (inc && !mem.inc) {
          mem.err = (rnd() + rnd() + rnd() - 1.5) * 70 * T.derr;
          if (rnd() < T.mistake) mem.err = (rnd() < 0.5 ? -1 : 1) * (70 + rnd() * 60); // read the wrong side
        }
        mem.inc = inc;
        if (pvy < -90 && py > 78) {
          const yD = 72, t = (yD - py) / pvy;
          const g = fold(px + pvx * (PR - py) / pvy);
          const q = fold(px + pvx * t);
          if (g > GX0 - 30 && g < GX1 + 30) { tx = q + mem.err; ty = yD; } else home();
        } else home();
      }
    }
    if (now >= mem.nextPos) { mem.ox = gauss(rnd) * T.pos; mem.oy = gauss(rnd) * T.pos; mem.nextPos = now + 0.3; }
    return { x: tx + mem.ox, y: WH - ty + mem.oy };
  }
  return { plan, curDelay, T };
}
module.exports = { makeTierBot, TIERS };
