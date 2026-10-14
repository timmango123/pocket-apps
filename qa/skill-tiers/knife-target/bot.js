// 飛刀神射 (knife-target) — five skill-tier simulated players (see ../SPEC.md).
// Real headless Chromium, mobile context; every throw is a real CDP touch on the canvas.
// Human tiers reuse the perception/prediction model of apps/knife-target/demo/bot.js (copied to ./human.js),
// parameterised by tier (perception delay, timing jitter, safety margin, mistakes, impatient throws).
// Superhuman: perfect information — replays the level's deterministic motion script (core extracted
// read-only from index.html), syncs to the on-screen angle, and schedules each tap at the safest instant.
// usage: node bot.js [tiers] [levels]
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { performance } = require('perf_hooks');
const fs = require('fs'), path = require('path');
const { createBot } = require('./human.js');
const DIR = __dirname;
const SRC = path.resolve(DIR, '../../../apps/knife-target/index.html');
const URL = 'file://' + SRC;
const src = fs.readFileSync(SRC, 'utf8');
const K = new Function(src.slice(src.indexOf('/*CORE-START*/'), src.indexOf('/*CORE-END*/')) + '; return KT;')();

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  rand: 0.5,  attempts: 5, m0: 0.03 },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  rand: 0.15, attempts: 3, m0: 0.03 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  rand: 0,    attempts: 3, m0: 0.04 },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, rand: 0,    attempts: 3, m0: 0.03 },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     rand: 0,    attempts: 3 },
};
const ATT_CAP_S = 75;
const tierArg = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
const levels = (process.argv[3] || '1,10,25,50,75,99,100').split(',').map(Number);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

// ---------- superhuman planner ----------
function makeOracle(L) {
  const cfg = K.levelConfig(L), m = new K.Motion(cfg.motion), NMAX = 240 * 200;
  const th = new Float64Array(NMAX), om = new Float64Array(NMAX);
  for (let n = 0; n < NMAX; n++) { th[n] = m.theta; om[n] = m.omega; m.step(K.STEP); } // th[n] = theta after n steps
  let LAND = 0; for (let f = 0; f < K.FLIGHT; f += K.STEP) LAND++; // motion steps until flying.t >= FLIGHT (25, float accumulation)
  let n = -1, lastT = 0, lastKn = 0;
  return {
    cfg,
    sync(s) { // s: observed state; returns current motion step index
      const err = k => Math.abs(K.angDiff(th[k], s.theta)) + 0.02 * Math.abs(om[k] - s.omega);
      if (n < 0) { let best = 1e9; for (let k = 0; k < 600; k++) { const e = err(k); if (e < best) { best = e; n = k; } } }
      else {
        let exp = n + Math.round((s.t - lastT) / K.STEP) - 11 * Math.max(0, s.knives.length - lastKn);
        let best = 1e9, bn = n; for (let k = Math.max(n, exp - 14); k <= exp + 6; k++) { const e = err(k); if (e < best) { best = e; bn = k; } } n = bn;
      }
      lastT = s.t; lastKn = s.knives.length; return n;
    },
    // pick a throw delay (s from s.t) with max robustness; jitterSteps = harness delivery jitter
    landAt(k) { return K.norm(K.LAUNCH - th[Math.min(NMAX - 1, k + LAND)]); },
    plan(s, dmin, jitterSteps, applesAlive) {
      const clear = local => { let c = 9; for (const a of s.knives) c = Math.min(c, Math.abs(K.angDiff(local, a))); return c; };
      const landAt = k => K.norm(K.LAUNCH - th[Math.min(NMAX - 1, k + LAND)]);
      const k0 = n + Math.ceil(dmin / K.STEP), best = { score: -1 };
      for (let k = k0; k < k0 + 240 * 2.5; k++) {
        let worst = 9; for (let j = -jitterSteps; j <= jitterSteps; j++) worst = Math.min(worst, clear(landAt(k + j)));
        if (worst < K.COLLIDE + 0.015) continue;
        let apple = 0; for (const a of applesAlive) if (Math.abs(K.angDiff(landAt(k), a)) < K.APPLE_HIT - 0.03) apple = 1;
        // pack knives tightly next to existing ones (keeps room for later knives), then apples, then earliness
        const score = 10 - clear(landAt(k)) + apple * 0.1 - (k - k0) * 0.0002;
        if (score > best.score) { best.score = score; best.d = (k - n) * K.STEP; best.apple = apple; }
      }
      return best.score > 0 ? best : null;
    }
  };
}

(async () => {
  const browser = await chromium.launch();
  const outFile = path.join(DIR, 'results.json');
  let out = { game: 'knife-target', tiers: {}, findings: [] };
  try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  for (const tierId of tierArg) {
    const T = TIERS[tierId];
    const rnd = mulberry32(0xC0FFEE + Object.keys(TIERS).indexOf(tierId) * 7919);
    const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const runs = ((out.tiers[tierId] && out.tiers[tierId].runs) || []);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(URL); await sleep(600);
    const origin = await page.evaluate(() => performance.timeOrigin);
    const nodeEpoch = () => performance.timeOrigin + performance.now();
    const cdp = await ctx.newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); };
    const Kfull = { FLIGHT: K.FLIGHT, LAUNCH: K.LAUNCH, COLLIDE: K.COLLIDE, TAU: K.TAU, norm: K.norm, angDiff: K.angDiff };
    for (const L of levels) {
      if (runs.some(r => r.level === L)) continue;
      const cfg = K.levelConfig(L);
      let attempt = 0, cleared = false; const log = [];
      let bot = null; const lats = []; let latEst = 0.04;
      while (!cleared && attempt < T.attempts) {
        attempt++;
        await page.evaluate(l => __game.start(l), L);
        const reaction = Math.max(0.1, (T.react[0] + gauss() * T.react[1]) / 1000);
        if (tierId !== 'superhuman') { if (!bot) bot = createBot(Kfull, { reaction, jit: T.tim / 1000, m0: T.m0, latInit: 0.04 }); else bot.newAttempt(); }
        const oracle = tierId === 'superhuman' ? makeOracle(L) : null;
        let throwMode = 'normal', randAt = 0, throws = 0, randomThrows = 0, mistakes = 0, lastT = -1, pendingTapAt = null, lastSendEpoch = null, readyAt = null, lastThrowSeen = null;
        const t0 = Date.now(); let s;
        while (true) {
          s = await page.evaluate(() => __game.state());
          if (s.state === 'win' || s.state === 'fail') break;
          if (Date.now() - t0 > ATT_CAP_S * 1000) break;
          if (s.throwT != null && s.throwT !== lastThrowSeen) { // learn own latency (send -> handler)
            lastThrowSeen = s.throwT; if (process.env.DBG) console.error('landed knives', s.knives.slice(-1).map(a=>a.toFixed(3)).join(), 'thrown at page t', s.throwT.toFixed(3), 'sendLag', lastSendEpoch ? (origin + s.throwT * 1000 - lastSendEpoch).toFixed(1) : '-');
            if (lastSendEpoch) { const lat = (origin + s.throwT * 1000 - lastSendEpoch) / 1000; if (lat > 0 && lat < 0.3) { lats.push(lat); if (lats.length > 15) lats.shift(); latEst = lats.slice().sort((a, b) => a - b)[lats.length >> 1]; } }
          }
          if (pendingTapAt != null) { // scheduled tap
            if (nodeEpoch() >= pendingTapAt - 1) { pendingTapAt = null; lastSendEpoch = nodeEpoch(); throws++; await tap(s.tap.x + gauss() * T.pos, s.tap.y + gauss() * T.pos); }
            else await sleep(Math.min(3, pendingTapAt - nodeEpoch() - 1));
            continue;
          }
          if (s.state !== 'play') { await sleep(4); continue; }
          if (oracle) {
            const n = oracle.sync(s);
            if (!s.canThrow) { readyAt = null; await sleep(3); continue; }
            if (readyAt == null) readyAt = s.t;
            if (s.t - readyAt < 0.06) { await sleep(3); continue; } // let hit-stop finish
            const alive = oracle.cfg.apples.filter(a => !s.knives.some(k => Math.abs(K.angDiff(k, a)) < K.APPLE_HIT));
            const pageNow = s.now;
            const dmin = (pageNow - s.t) + latEst + 0.03;
            const jit = Math.round(0.025 / K.STEP); // cover most of the measured touch-delivery jitter (~±25 ms)
            const p = oracle.plan(s, dmin, jit, alive);
            if (p) { pendingTapAt = origin + (s.t + p.d - latEst) * 1000; readyAt = null; if (process.env.DBG) { const k = n + Math.round(p.d / K.STEP); console.error('plan n', n, 'd', p.d.toFixed(3), 'apple', p.apple, 'score', p.score.toFixed(3), 'predLand', oracle.landAt(k).toFixed(3), 'knives', s.knives.length, 'lat', latEst.toFixed(3)); } }
            else await sleep(4);
            continue;
          }
          if (s.t !== lastT) { lastT = s.t; bot.observe({ t: s.t, theta: s.theta, omega: s.omega, knives: s.knives, canThrow: s.canThrow, state: s.state, throwT: s.throwT }); }
          if (!s.canThrow) { readyAt = null; await sleep(3); continue; }
          if (readyAt == null) { readyAt = s.now; const r = rnd(); throwMode = r < T.mistake ? 'mistake' : r < T.mistake + T.rand ? 'random' : 'normal'; randAt = readyAt + reaction + rnd() * 0.6; }
          if (throwMode !== 'normal') { // impatient / mistimed throw: no judgement of the gap
            if (s.now >= randAt) { if (throwMode === 'random') randomThrows++; else mistakes++; pendingTapAt = nodeEpoch() + Math.abs(gauss()) * T.tim; }
            else await sleep(4);
            continue;
          }
          if (bot.decide(s.now)) pendingTapAt = nodeEpoch() + Math.max(0, gauss() * T.tim + T.tim);
          else await sleep(4);
        }
        const st = s.state === 'win' || s.state === 'fail' ? s.state : 'timeout';
        log.push({ attempt, result: st === 'win' ? 'clear' : st, seconds: +((Date.now() - t0) / 1000).toFixed(1), throws, randomThrows, mistakes,
          knivesShort: st === 'fail' ? s.left + 1 : st === 'timeout' ? s.left : 0, apples: s.applesHit + '/' + cfg.apples.length,
          stars: st === 'win' ? 1 + (s.applesHit >= Math.ceil(cfg.apples.length / 2) ? 1 : 0) + (s.applesHit >= cfg.apples.length ? 1 : 0) : 0,
          reactionMs: tierId === 'superhuman' ? 16 : Math.round(reaction * 1000) });
        if (st === 'win') cleared = true;
        await sleep(st === 'timeout' ? 100 : 1500);
      }
      const run = { level: L, type: cfg.type, boss: cfg.boss, knives: cfg.knives, preKnives: cfg.pre.length, cleared, attempts: attempt,
        latencyEstMs: Math.round(latEst * 1000), attemptLog: log };
      console.log(tierId, JSON.stringify(run));
      runs.push(run); runs.sort((a, b) => a.level - b.level);
      out.tiers[tierId] = { runs, summary: {} }; fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    }
    const cl = runs.filter(r => r.cleared);
    out.tiers[tierId] = { runs, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), failedLevels: runs.filter(r => !r.cleared).map(r => r.level),
      firstTryClears: cl.filter(r => r.attempts === 1).length, totalAttempts: runs.reduce((a, r) => a + r.attempts, 0),
      avgStarsOnClears: cl.length ? +(cl.reduce((a, r) => a + r.attemptLog[r.attemptLog.length - 1].stars, 0) / cl.length).toFixed(2) : null, pageErrors: errors } };
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    await ctx.close();
  }
  await browser.close();
})();
