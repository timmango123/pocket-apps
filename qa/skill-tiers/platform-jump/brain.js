// Simulated player brain shared by the node tier simulation and the browser bot.
// It sees the game state (as a person sees the screen), plans a route with the A* solver, and executes it with
// human noise: reaction delay before re-planning, timing error on every button change, occasional mistakes,
// and a safety margin around hazards that shrinks with skill.
const Solver = require('./solver.js');

const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, timing: 120, mistake: 0.15,  attempts: 5, margin: 0.3 },
  casual:     { name: '普通', react: [400, 100], pos: 20, timing: 60,  mistake: 0.06,  attempts: 3, margin: 0.25 },
  skilled:    { name: '熟練', react: [260, 50],  pos: 10, timing: 30,  mistake: 0.02,  attempts: 3, margin: 0.2 },
  world:      { name: '世界級', react: [180, 25], pos: 4,  timing: 12,  mistake: 0.003, attempts: 3, margin: 0.12 },
  superhuman: { name: '非人', react: [16, 0],    pos: 0,  timing: 0,   mistake: 0,     attempts: 3, margin: 0 },
};
const MS2T = ms => ms / (1000 / 60);

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

class Brain {
  constructor(PJ, L, tierId, seed, opts) {
    this.PJ = PJ; this.L = L; this.tierId = tierId; this.t = TIERS[tierId]; this.rng = mulberry32(seed);
    this.opts = opts || {};
    this.queue = [];           // scheduled input changes: {at: tick, h?, j?}
    this.cur = { h: 0, j: false };
    this.replanAt = 0;          // tick at which to (re)plan; 0 = now
    this.expect = null;         // expected states by tick from the plan
    this.planEnd = -1;
    this.seg = 0;
    this.stats = { replans: 0, mistakes: 0, solveMs: 0 };
    this.lastDeaths = 0;
  }
  reactTicks() { const [m, s] = this.t.react; return Math.max(1, Math.round(MS2T(Math.max(16, m + (s ? gauss(this.rng) * s : 0))))); }
  timingErr() { return this.t.timing ? Math.round(MS2T(gauss(this.rng) * this.t.timing)) : 0; }
  // which waypoint is next for this state
  segFor(s) {
    const L = this.L, PJ = this.PJ, px = s.x + PJ.C.PW / 2;
    let i = 0;
    while (i < L.wps.length - 1 && px >= L.wps[i][0] + 0.2 && Math.abs((s.y + PJ.C.PH) - L.wps[i][1]) < 0.3) i++;
    // after a checkpoint respawn, skip waypoints behind
    while (i < L.wps.length - 1 && L.wps[i][0] + 0.2 < px - 1) i++;
    return i;
  }
  solveCodes(s, held0, i, margin) {
    const PJ = this.PJ, L = this.L;
    let st = PJ.cloneRun(s), held = held0, codes = [];
    // plan two waypoints ahead so the bot does not stop at every waypoint
    for (let k = 0; k < 2 && i + k < L.wps.length; k++) {
      const g = Solver.segGoal(PJ, L, i + k);
      let r = null;
      const cp = { clumsy: 2.5, casual: 1.5 }[this.tierId] || 0.6;
      if (margin) r = Solver.solveSegment(PJ, L, st, held, g, { margin, cap: 12000, cutPen: 3, chgPen: cp, human: true });
      if (margin && r.fail) r = Solver.solveWait(PJ, L, st, held, g, { margin, cutPen: 3, chgPen: cp, human: true }, 4000);
      if (!r || r.fail) r = Solver.solveSegment(PJ, L, st, held, g, { cap: 60000, cutPen: margin ? 3 : 0, chgPen: margin ? 0.6 : 0, human: !!margin });
      const deep = !(this.lastFail > 0 && this.nowT - this.lastFail < 90); // after a failed deep search, stay cheap for a while
      if (r.fail && deep) r = Solver.solveWait(PJ, L, st, held, g, {}, 15000);
      if (r.fail && deep) r = Solver.solveSegment(PJ, L, st, held, g, { cap: 200000 });
      if (r.fail && deep) r = Solver.solveSegment(PJ, L, st, held, g, { macro: 2, cap: 300000 });
      if (r.fail && deep && k === 0) this.lastFail = this.nowT;
      if (r.fail) break;
      codes.push(...r.inputs); st = r.state; held = r.held;
      if (st.won) break;
    }
    return { codes, end: st };
  }
  // how often does this plan survive this player's own timing noise (no outright mistakes)?
  robustness(s, codes, end, n) {
    // judged over the next couple of seconds only: after that the player is looking again and re-plans anyway
    const PJ = this.PJ, L = this.L; let ok = 0;
    const ex = PJ.cloneRun(s); let hd = this.cur.j, HZ = Math.min(codes.length, 120);
    for (let t = 0; t < codes.length; t++) { const c = codes[t]; PJ.step(L, ex, { h: (c >> 1) - 1, j: !!(c & 1), jp: !!(c & 1) && !hd }, null); hd = !!(c & 1); if (ex.won) { HZ = t + 1; break; } if (t + 1 >= HZ && ex.ground) { HZ = t + 1; break; } }
    for (let k = 0; k < n; k++) {
      const q = this.noisyQueue(codes, 0, false), st = PJ.cloneRun(s); let cur = { h: this.cur.h, j: this.cur.j }, held = this.cur.j, dead = false;
      for (let t = 0; t < HZ + 20; t++) {
        while (q.length && q[0].at <= t) { const c = q.shift(); if (c.h !== undefined) cur.h = c.h; if (c.j !== undefined) cur.j = c.j; }
        PJ.step(L, st, { h: cur.h, j: cur.j, jp: cur.j && !held }, null); held = cur.j;
        if (st.dead) { dead = true; break; }
        if (st.won) break;
        if (t >= HZ - 1 && st.ground) break;
      }
      if (!dead && (st.won || Math.abs(st.x - ex.x) + Math.abs(st.y - ex.y) < 1.2)) ok++;
    }
    return ok / n;
  }
  // people aim for the middle of a jump's timing window, not its last possible frame: shift each jump press
  // (with its release) to the centre of the run of shifts that still reach the plan's end alive
  centerJumps(s, codes, end) {
    const PJ = this.PJ, L = this.L, R = 30;
    const ok = cs => {
      const st = PJ.cloneRun(s); let held = this.cur.j;
      for (let t = 0; t < cs.length; t++) { const c = cs[t]; PJ.step(L, st, { h: (c >> 1) - 1, j: !!(c & 1), jp: !!(c & 1) && !held }, null); held = !!(c & 1); if (st.dead) return false; if (st.won) return true; }
      return Math.abs(st.x - end.x) + Math.abs(st.y - end.y) < 0.8 && st.ground === end.ground;
    };
    let out = codes.slice();
    for (let i = 1; i < out.length; i++) {
      if (!((out[i] & 1) && !(out[i - 1] & 1))) continue;
      let k = i; while (k < out.length && (out[k] & 1)) k++; // press i .. release k
      const shifted = d => {
        const cs = out.slice(), lo = i + d, hi = k + d;
        if (lo < 1 || hi > cs.length) return null;
        for (let t = Math.min(i, lo); t < Math.max(k, hi); t++) cs[t] = (cs[t] & ~1) | (t >= lo && t < hi ? 1 : 0);
        return cs;
      };
      let a = 0, b = 0;
      while (a > -R) { const cs = shifted(a - 1); if (!cs || !ok(cs)) break; a--; }
      while (b < R) { const cs = shifted(b + 1); if (!cs || !ok(cs)) break; b++; }
      const d = Math.round((a + b) / 2);
      if (d) { const cs = shifted(d); if (cs && ok(cs)) { out = cs; i += d; k += d; } }
      // and hold the button for the middle of the workable hold lengths
      const held = e => { if (k + e <= i + 1 || k + e > out.length) return null; const cs = out.slice(); for (let t = Math.min(k, k + e); t < Math.max(k, k + e); t++) cs[t] = (cs[t] & ~1) | (e > 0 ? 1 : 0); return cs; };
      let ha = 0, hb = 0;
      while (ha > -R) { const cs = held(ha - 1); if (!cs || !ok(cs)) break; ha--; }
      while (hb < R) { const cs = held(hb + 1); if (!cs || !ok(cs)) break; hb++; }
      const e = Math.round((ha + hb) / 2);
      if (e) { const cs = held(e); if (cs && ok(cs)) { out = cs; k += e; } }
      i = k;
    }
    return out;
  }
  plan(s, now) {
    this.nowT = now;
    const PJ = this.PJ, L = this.L, t0 = Date.now();
    this.stats.replans++;
    this.minAt = 0;
    if (s.ground && this.cur.j) { this.cur.j = false; this.minAt = now + 1; } // people let go of jump once they land
    const i = this.segFor(s);
    let best = null;
    const base = Math.min(0.7, Math.max(0.15, MS2T(this.t.timing) * 7 / 60 * 1.4));
    const ms = this.t.margin ? (this.t.timing <= 30 ? [base, 0.3, 0.2, 0.12, 0.06] : [base, 0.12]) : [0];
    for (const m of ms) {
      const p = this.solveCodes(s, this.cur.j, i, m);
      if (!p.codes.length) continue;
      if (this.t.timing) p.codes = this.centerJumps(s, p.codes, p.end);
      p.rob = this.t.timing ? this.robustness(s, p.codes, p.end, 6) : 1;
      if (!best || p.rob > best.rob) best = p;
      if (p.rob >= 0.8) break;
    }
    this.stats.solveMs += Date.now() - t0;
    if (!best) { this.stats.planFails = (this.stats.planFails || 0) + 1; // no route found from here: keep doing what the hands were doing (the old plan) and look again shortly
      if (!this.queue.length && s.ground) this.queue = [{ at: now, h: 0, j: false }];
      this.replanAt = now + (s.ground ? 20 : 4); this.expect = null; return; }
    const codes = best.codes;
    // expected trajectory with perfect execution
    const ex = PJ.cloneRun(s); let hd = this.cur.j; this.expect = new Map();
    for (let k = 0; k < codes.length; k++) { const c = codes[k]; PJ.step(L, ex, { h: (c >> 1) - 1, j: !!(c & 1), jp: !!(c & 1) && !hd }, null); hd = !!(c & 1); this.expect.set(now + k + 1, [ex.x, ex.y]); }
    this.planEnd = now + codes.length; this.lastCodes = codes;
    this.queue = this.noisyQueue(codes, now, true);
    const lastJ = !!(codes[codes.length - 1] & 1);
    if (lastJ) this.queue.push({ at: Math.max(this.planEnd, this.queue.length ? this.queue[this.queue.length - 1].at : 0) + 1, j: false });
    this.replanAt = Infinity;
  }
  // turn per-tick codes into timed button changes with human noise
  noisyQueue(codes, now, mistakes) {
    const q = []; let lastRel = -1e9, drift = 0, ph = this.cur.h, pj = this.cur.j, lastAt = Math.max(now, mistakes ? this.minAt || 0 : 0), pressPlan = -1, pressAt = -1;
    const holdSd = { clumsy: 0.3, casual: 0.2, skilled: 0.12, world: 0.06, superhuman: 0 }[this.tierId];
    for (let k = 0; k < codes.length; k++) {
      let h = (codes[k] >> 1) - 1, j = !!(codes[k] & 1);
      if (h === ph && j === pj) continue;
      let at;
      if (j === false && pj === true && pressAt >= 0 && h === ph) {
        const hold = k - pressPlan; at = pressAt + Math.max(1, Math.round(hold * (1 + gauss(this.rng) * holdSd)));
      } else at = now + k + drift + this.timingErr();
      at = Math.max(lastAt, at);
      // starting to run late (or early) shifts where the hero is; the player times what follows by eye, from there
      if (ph === 0 && h !== 0) drift = at - (now + k);
      if (j === true && pj === false) { pressPlan = k; pressAt = at; }
      let chg = { at };
      if (h !== ph) chg.h = h;
      if (j !== pj) chg.j = j;
      // each real button change gets one roll for a mistake, even if the plan is redrawn many times before it happens
      let roll = false;
      if (mistakes && this.t.mistake) { this.rolled = this.rolled || []; const T0 = now + k; if (!this.rolled.some(t => Math.abs(t - T0) <= 4)) { this.rolled.push(T0); if (this.rolled.length > 400) this.rolled.splice(0, 200); roll = true; } }
      if (roll && this.rng() < this.t.mistake) {
        this.stats.mistakes++;
        const r = this.rng(), d = Math.round(MS2T(80 + this.rng() * 170));
        if (chg.j === true) chg.at += r < 0.5 ? -d : d;                                   // jumped too early / too late
        else if (chg.j === false) chg.at += r < 0.5 ? Math.min(d, 12) : -Math.min(d, 6);  // let go of jump at the wrong time
        else if (chg.h !== undefined && r < 0.5) { chg.h = -h; q.push(chg); lastAt = chg.at; chg = { at: chg.at + d, h: h }; } // wrong way, then corrected
        else chg.at += d;                                                                   // hesitated
        chg.at = Math.max(lastAt, chg.at);
      }
      if (chg.j === true) { chg.at = Math.max(chg.at, lastRel + 1); pressAt = chg.at; } // a finger must lift before it can press again
      if (chg.j === false) lastRel = chg.at;
      q.push(chg); lastAt = chg.at; ph = h; pj = j;
    }
    return q;
  }
  // called once per game tick with the current state; returns the input to hold during the next tick
  act(s, now) {
    if (s.deaths !== this.lastDeaths) { this.lastDeaths = s.deaths; this.queue = []; this.cur = { h: 0, j: false }; this.replanAt = now + this.reactTicks(); this.expect = null; }
    if (s.dead) return this.cur;
    if (this.replanAt !== Infinity && now >= this.replanAt) this.plan(s, now);
    else if (now >= this.planEnd && this.replanAt === Infinity) this.plan(s, now); // finished the plan: keep going (anticipated)
    else if (this.expect && this.replanAt === Infinity) {
      const e = this.expect.get(now);
      if (e && Math.abs(e[0] - s.x) + Math.abs(e[1] - s.y) > ({ clumsy: 0.45, casual: 0.35, skilled: 0.25, world: 0.12 }[this.tierId] || 0.45)) this.replanAt = now + this.reactTicks();
    }
    while (this.queue.length && this.queue[0].at <= now) { const c = this.queue.shift(); if (c.h !== undefined) this.cur.h = c.h; if (c.j !== undefined) this.cur.j = c.j; }
    return this.cur;
  }
}

// run one level in pure simulation; returns {cleared, deaths, ticks}
function simLevel(PJ, L, tierId, seed, capTicks) {
  const B = new Brain(PJ, L, tierId, seed), s = PJ.newRun(L), T = TIERS[tierId];
  let held = false, deadT = 0;
  for (let now = 1; now <= capTicks; now++) {
    if (s.dead) {
      if (s.deaths + 1 >= T.attempts) return { cleared: false, deaths: s.deaths + 1, ticks: s.ticks, x: s.x, stats: B.stats, why: 'attempts' };
      if (++deadT >= 34) { PJ.respawn(L, s); deadT = 0; }
      B.act(s, now); continue;
    }
    const a = B.act(s, now);
    PJ.step(L, s, { h: a.h, j: a.j, jp: a.j && !held }, null); held = a.j;
    if (s.won) return { cleared: true, deaths: s.deaths, ticks: s.ticks, gems: s.gems, stats: B.stats };
  }
  return { cleared: false, deaths: s.deaths, ticks: s.ticks, x: s.x, stats: B.stats, why: 'time' };
}
module.exports = { TIERS, Brain, simLevel, mulberry32, gauss };
