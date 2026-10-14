// Doodle Shooter skill-tier bot. Usage: node bot.js [tier,...] [levels,...]
// The game has no test hooks, so the harness serves the page from a local HTTP server and appends a READ-ONLY
// getter object (window.__ds) inside the game closure; the file on disk is untouched. Clock is lock-stepped
// (rAF driven by the harness at 16.67ms/frame), Math.random seeded. All control is a real touch drag on the canvas.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const SRC = '/mnt/project-files/apps/doodle-shooter/index.html';
const OUT = __dirname;
const FRAME = 1000 / 60;

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, every: 12, policy: 'clumsy', pred: 0.5, speed: 600, margin: 2, H: 0.3, maxAtt: 5 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, every: 8, policy: 'greedy', pred: 0.8, speed: 900, margin: 3, H: 0.4, maxAtt: 3 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, every: 5, policy: 'look2', speed: 1200, margin: 4, H: 0.6, maxAtt: 3 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, every: 3, policy: 'search', speed: 1600, margin: 4, H: 0.8, fine: true, maxAtt: 3 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, every: 1, policy: 'perfect', speed: 2400, margin: 3, H: 0.8, fine: true, maxAtt: 3 },
};
const LEVELS = [1, 10, 25, 50, 75, 99, 100];

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = [], fakeT = 1000;
  window.__errs = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => fakeT;
  window.__drawEvery = 20; let fc = 0; const P = CanvasRenderingContext2D.prototype;
  for (const m of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText','clearRect']) { const o = P[m]; P[m] = function () { if (fc % window.__drawEvery === 0) return o.apply(this, arguments); }; }
  window.__step = (n, rec) => { let last = null;
    for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = [];
      for (const cb of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e)); } } }
    return rec && window.__obs ? window.__obs() : null; };
})();`;

// read-only hook appended inside the game IIFE (served copy only)
const HOOK = `
window.__ds = { get P() { return P; }, ens, ebs, picks, get boss() { return boss; }, get state() { return state; }, get phase() { return phase; }, get stage() { return stage; }, get score() { return score; }, get LH() { return LH; }, get SC() { return SC; }, get paused() { return paused; } };
window.__obs = () => { const b = [], e = [], k = [];
  ebs.forEach(o => { if (o.on) b.push([+o.x.toFixed(1), +o.y.toFixed(1), +o.vx.toFixed(1), +o.vy.toFixed(1), o.r]); });
  ens.forEach((o, i) => { if (o.on) e.push([i, +o.x.toFixed(1), +o.y.toFixed(1), o.r, o.hp]); });
  picks.forEach(o => { if (o.on) k.push([+o.x.toFixed(1), +o.y.toFixed(1), o.kind]); });
  return { st: state, ph: phase, stage, score, LH, SC, paused, P: { x: P.x, y: P.y, power: P.power, lives: P.lives, inv: P.inv }, b, e, k,
    boss: boss ? { x: boss.x, y: boss.y, sz: boss.sz, hp: boss.hp, max: boss.max, t: boss.t } : null }; };
`;
function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      if (!req.url.startsWith('/game')) { // hub-like host: full-screen iframe in a 390x844 page with a viewport meta (the app itself has none)
        rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        rsp.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="/game"></iframe></body></html>');
        return;
      }
      let html = fs.readFileSync(SRC, 'utf8');
      const marker = 'requestAnimationFrame(frame);\n})();';
      const at = html.lastIndexOf(marker);
      html = html.slice(0, at) + HOOK + html.slice(at);
      rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rsp.end(html);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// ---- planner ----
const DIRS16 = []; for (let i = 0; i < 16; i++) DIRS16.push([Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
const DIRS8 = DIRS16.filter((_, i) => i % 2 === 0);
function danger(o, px, py, t, margin, ext) {
  let pen = 0;
  for (const bl of o.near) {
    const bx = bl[0] + bl[2] * (t + ext), by = bl[1] + bl[3] * (t + ext), rr = bl[4] + 3.5 + margin;
    const dx = bx - px, dy = by - py, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) pen += 1;
    else if (d2 < (rr + 10) * (rr + 10)) pen += 0.05;
  }
  for (const e of o.e) { const ex = e[1] + (e.vx || 0) * (t + ext), ey = e[2] + (e.vy || 0) * (t + ext), rr = e[3] + 7 + margin + 4; const dx = ex - px, dy = ey - py; if (dx * dx + dy * dy < rr * rr) pen += 1; }
  if (o.boss && o.ph === 'boss') { const z2 = o.boss.sz * o.boss.sz * 1.3; const dx = o.boss.x - px, dy = o.boss.y - py; if (dx * dx / (3200 * z2) + dy * dy / (2200 * z2) < 1) pen += 1; }
  return pen;
}
function attract(o, px, py) {
  // be under a target, at a comfortable height, grab pickups
  let tx = 180, ty = o.LH * 0.78;
  if (o.boss && o.ph === 'boss') tx = o.boss.x;
  else if (o.e.length) { let best = null, bd = 1e9; for (const e of o.e) { if (e[2] > py - 40 || e[2] < 0) continue; const d = Math.abs(e[1] - px) + (o.LH - e[2]) * 0.2; if (d < bd) { bd = d; best = e; } } if (best) tx = best[1]; }
  let s = -Math.abs(px - tx) * 0.004 - Math.abs(py - ty) * 0.002;
  for (const k of o.k) { const d = Math.hypot(k[0] - px, k[1] - py); s += 0.6 / (1 + d / 30); }
  return s;
}
function clampXY(o, x, y) { return [Math.max(14, Math.min(346, x)), Math.max(o.LH * 0.25, Math.min(o.LH - 24, y))]; }
function evalPath(o, legs, H, T, ext) {
  // legs: [[dx,dy,dur]] velocity legs (game units / s)
  let x = o.P.x, y = o.P.y, t = 0, pen = 0, li = 0, lt = 0; const dt = T.fine ? 1 / 60 : 1 / 30;
  while (t < H) {
    const L = legs[Math.min(li, legs.length - 1)];
    [x, y] = clampXY(o, x + L[0] * dt, y + L[1] * dt);
    t += dt; lt += dt; if (lt >= L[2] && li < legs.length - 1) { li++; lt = 0; }
    pen += danger(o, x, y, t, T.margin, ext) * (o.P.inv > t ? 0.05 : 1) / (1 + t * 2);
  }
  return -pen * 10 + attract(o, x, y);
}
function decide(T, o, rnd, age) {
  const sp = T.speed / 1.15 * 1.0; // finger px/s -> game units/s approx
  const v = sp * 0.6;
  const ext = (age || 0) * (T.pred == null ? 1 : T.pred); // humans extrapolate the motion they saw `age` s ago
  o.near = o.b.filter(b => Math.abs(b[0] - o.P.x) < 220 && Math.abs(b[1] - o.P.y) < 260);
  const opts = [[0, 0]].concat((T.policy === 'search' || T.policy === 'perfect') ? DIRS16 : DIRS8);
  const fast = T.policy === 'perfect' || T.policy === 'search';
  if (T.policy === 'clumsy' && rnd() < 0.5) { const d = opts[Math.floor(rnd() * opts.length)]; return { dx: d[0] * v * T.every / 60, dy: d[1] * v * T.every / 60, kind: 'random' }; }
  if (T.policy === 'greedy' && rnd() < 0.15) { const d = opts[Math.floor(rnd() * opts.length)]; return { dx: d[0] * v * T.every / 60, dy: d[1] * v * T.every / 60, kind: 'random' }; }
  let best = -1e9, bd = [0, 0], bs = 1;
  const speeds = fast ? [0.35, 1] : [1];
  const seg = Math.max(0.1, T.every / 60 * 2);
  for (const s1 of speeds) for (const d1 of opts) {
    if (T.policy === 'greedy' || T.policy === 'clumsy') {
      const sc = evalPath(o, [[d1[0] * v * s1, d1[1] * v * s1, 9]], T.H, T, ext);
      if (sc > best) { best = sc; bd = d1; bs = s1; }
    } else {
      for (const d2 of opts) {
        const sc = evalPath(o, [[d1[0] * v * s1, d1[1] * v * s1, seg], [d2[0] * v, d2[1] * v, 9]], T.H, T, ext);
        if (sc > best) { best = sc; bd = d1; bs = s1; }
      }
    }
  }
  const dur = T.every / 60 + 0.05;
  return { dx: bd[0] * v * bs * dur, dy: bd[1] * v * bs * dur, kind: 'plan' };
}

async function main() {
  const tiers = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
  const levels = process.argv[3] ? process.argv[3].split(',').map(Number) : LEVELS;
  const capSec = +(process.argv[4] || 240);
  const resFile = path.join(OUT, 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'doodle-shooter', tiers: {}, findings: [] };
  const srv = await serve();
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  let browser = await chromium.launch({ headless: true });
  const relaunch = async () => { try { await browser.close(); } catch (e) {} browser = await chromium.launch({ headless: true }); };
  for (const tierId of tiers) {
    const T = TIERS[tierId];
    const runs = (results.tiers[tierId] && process.argv[3]) ? results.tiers[tierId].runs.filter(r => !levels.includes(r.level)) : [];
    for (const lv of levels) {
      const maxAtt = process.env.HARD_ATT && lv >= 99 ? +process.env.HARD_ATT : T.maxAtt; // compute budget: superhuman already fails 99/100 in 3/3
      for (let att = 1, crashes = 0; att <= maxAtt; att++) {
       try {
        const seed = 1000 * (Object.keys(TIERS).indexOf(tierId) + 1) + lv * 7 + att;
        const rnd = mulberry32(seed);
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        await ctx.addInitScript(`try{localStorage.setItem('doodleShooter.unlockAll','true');localStorage.setItem('doodleShooter.muted','true')}catch(e){}`);
        await ctx.addInitScript(INIT(seed));
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        await page.goto(URL);
        let fr = null; for (let i = 0; i < 200 && !fr; i++) { fr = page.frames().find(f => f.url().endsWith('/game')); if (!fr) await page.waitForTimeout(20); }
        await fr.waitForLoadState('load');
        await fr.evaluate(() => window.__step(3));
        await fr.locator('#selectBtn').tap();
        await fr.locator('#lvwrap button.lv').nth(lv - 1).tap();
        let o = await fr.evaluate(() => window.__step(1, true));
        if (o.st !== 'play' || o.stage !== lv) throw new Error('level select failed ' + JSON.stringify([o.st, o.stage]));
        const cdp = await ctx.newCDPSession(page);
        const SC = o.SC, k = 1.15 / SC;
        let fx = o.P.x * SC, fy = Math.min(830, o.P.y * SC + 70);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy, id: 1 }] });
        const buf = [o]; let frame = 0, nextDecision = 0, tgt = null, decisions = 0, randomMoves = 0, mistakes = 0, livesLost = 0, lastLives = o.P.lives, reGrips = 0;
        const deathAt = []; let end = null; const cap = capSec * 60; const stepN = T.every === 1 ? 1 : 2;
        const prevE = new Map();
        while (frame < cap) {
          o = await fr.evaluate(n => window.__step(n, true), stepN); frame += stepN;
          for (const e of o.e) { const p = prevE.get(e[0]); if (p) { e.vx = (e[1] - p[1]) * 60 / stepN; e.vy = (e[2] - p[2]) * 60 / stepN; } }
          prevE.clear(); for (const e of o.e) prevE.set(e[0], e);
          buf.push(o); if (buf.length > 120) buf.shift();
          if (o.P.lives < lastLives) { livesLost += lastLives - o.P.lives; deathAt.push({ t: +(frame / 60).toFixed(1), phase: o.ph }); }
          lastLives = o.P.lives;
          if (o.st === 'over' || o.st === 'dying') { end = 'dead'; break; }
          if (o.stage > lv || (o.stage === lv && o.ph === 'clear')) { end = 'cleared'; break; }
          if (frame >= nextDecision) {
            nextDecision = frame + T.every;
            const rt = Math.max(16, T.react[0] + gauss(rnd) * T.react[1]);
            const d = Math.max(1, Math.round(rt / FRAME / stepN));
            const ob = buf[Math.max(0, buf.length - d)];
            if (ob.st === 'play') {
              const age = (buf.length - 1 - Math.max(0, buf.length - d)) * stepN / 60;
              const plan = decide(T, { ...ob, P: o.P }, rnd, age); decisions++; /* own ship: proprioception; hostiles: delayed + extrapolated */ if (plan.kind === 'random') randomMoves++;
              if (rnd() < T.mistake) { plan.dx = -plan.dx; plan.dy = -plan.dy; mistakes++; }
              // planned ship displacement relative to the observed position -> finger target (finger knows where it is now)
              const delay = Math.round(Math.abs(gauss(rnd) * T.tim) / FRAME);
              tgt = { at: frame + delay, x: fx + plan.dx / k + gauss(rnd) * T.pos * 0.25, y: fy + plan.dy / k + gauss(rnd) * T.pos * 0.25 };
              // position sigma is applied as a slow drift (per-decision 1/4 sigma) to avoid teleporting the ship
            }
          }
          if (tgt && frame >= tgt.at) {
            const maxStep = T.speed * stepN / 60;
            let dx = tgt.x - fx, dy = tgt.y - fy; const dd = Math.hypot(dx, dy);
            if (dd > 0.3) {
              if (dd > maxStep) { dx *= maxStep / dd; dy *= maxStep / dd; }
              let nx = fx + dx, ny = fy + dy;
              if (nx < 8 || nx > 382 || ny < 60 || ny > 836) { // finger hit the screen edge: lift and re-grip near the ship
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                const ox = fx, oy = fy; fx = 195 + (rnd() - 0.5) * 20; fy = 520 + (rnd() - 0.5) * 20; // re-grip mid-screen (relative drag: ship does not move)
                tgt.x += fx - ox; tgt.y += fy - oy; reGrips++;
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy, id: 1 }] });
              } else {
                fx = nx; fy = ny;
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: fy, id: 1 }] });
              }
            }
          }
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const pageErr = await fr.evaluate(() => window.__errs);
        const last = o;
        const run = { level: lv, attempt: att, seed, cleared: end === 'cleared', end: end || 'timeout', time: +(frame / 60).toFixed(1), score: last.score,
          livesLost, deathAt, endPhase: last.ph, bossHpLeft: last.boss ? +(last.boss.hp / last.boss.max).toFixed(3) : null, power: last.P.power,
          decisions, randomMoves, mistakes, reGrips, errors: errors.concat(pageErr) };
        if (end === 'dead') { await fr.evaluate(() => window.__step(120)); run.overText = await fr.evaluate(() => document.querySelector('#overStage').textContent); }
        runs.push(run);
        console.log(tierId, JSON.stringify(run));
        await ctx.close();
        if (run.cleared || run.end === 'timeout') break; // a timeout replays the same deterministic stalemate; don't spend 3x
       } catch (e) { console.log('HARNESS ERROR', tierId, lv, att, String(e).slice(0, 200)); if (++crashes > 2) throw e; att--; await relaunch(); }
      }
    }
    const byLv = {};
    for (const r of runs) { const b = byLv[r.level] || (byLv[r.level] = { cleared: false, attempts: 0, bestScore: 0, minBossHpLeft: null }); b.attempts++; if (r.cleared) b.cleared = true; b.bestScore = Math.max(b.bestScore, r.score); if (r.bossHpLeft != null) b.minBossHpLeft = b.minBossHpLeft == null ? r.bossHpLeft : Math.min(b.minBossHpLeft, r.bossHpLeft); }
    results.tiers[tierId] = { runs, summary: { levelsCleared: Object.values(byLv).filter(b => b.cleared).length, levelsTested: Object.keys(byLv).length, byLevel: byLv } };
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await browser.close(); srv.close();
}
module.exports = { INIT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
