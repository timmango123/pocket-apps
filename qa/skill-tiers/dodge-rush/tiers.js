// Skill-tier bots for 螢火迴避 (dodge-rush), written by the release reviewer per qa/skill-tiers/SPEC.md.
// Real headless Chromium, 390x844 mobile context (deviceScaleFactor 1 to halve software-raster cost; game logic is in CSS px, DPR only sizes the canvas), real CDP touch (Input.dispatchTouchEvent).
// Lockstep clock: requestAnimationFrame + performance.now are virtualised (init script) so each frame is exactly
// 1/60 s of game time, independent of machine load. Bots READ window.__game.snap() (what is on screen), ACT only by touch.
// node tiers.js [tier ...] [--runs N] [--cap S]   -> tiers-results.json
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = '' + require('path').resolve(__dirname, '../../../apps/dodge-rush/index.html') + '';
const OUT = __dirname, RES = path.join(OUT, 'tiers-results.json');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const CAP = opt('--cap', 240), RUNS = opt('--runs', 5);
const tiersWanted = args.filter(a => !a.startsWith('--') && isNaN(+a));

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

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(SRC)); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, url: `http://127.0.0.1:${srv.address().port}/apps/dodge-rush/` })));
}
const INIT = seed => `(() => {
  let a = ${seed} >>> 0; Math.random = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let vt = 1000; const q = []; performance.now = () => vt;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  window.__adv = n => { for (let i = 0; i < n; i++) { vt += 1000 / 60; const c = q.splice(0); for (const f of c) f(vt); } };
  window.__step = n => { window.__adv(n); return window.__game.snap(); };
})();`;

async function runOne(browser, url, tierId, mode, runIdx, cap) {
  const P = TIERS[tierId], rnd = mulberry(7919 * (runIdx + 1) + tierId.length * 31 + (mode === 'daily' ? 5 : mode === 'casual' ? 11 : 0));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  await ctx.addInitScript(INIT(1000 + runIdx * 7717 + tierId.length * 13));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto(url); await page.evaluate(() => window.__adv(10));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const btnC = async sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const startBtn = { normal: '#tPlay', casual: '#tCasual', daily: '#tDaily' }[mode];
  const sb = await btnC(startBtn);
  await touch('touchStart', [{ x: sb[0], y: sb[1], id: 9 }]); await touch('touchEnd', []);
  await page.evaluate(() => window.__adv(3));
  let sn = await page.evaluate(() => window.__game.snap());
  if (!sn) throw new Error('game did not start');
  let fx = sn.px, fy = sn.py; // finger on the firefly
  await touch('touchStart', [{ x: fx, y: fy, id: 1 }]);
  sn = await page.evaluate(() => window.__step(32)); // 0.5 s resume countdown
  const bt = await btnC('#bBT');
  const F = 2, dt = F / 60; // one touchMove per 2 frames (CDP touchMove waits ~1 vsync); superhuman re-decides every step
  const hist = []; let target = [sn.px, sn.py], nextDec = 0, bts = 0, liftReplace = 0, decisions = 0, mistakes = 0, maxB = 0;
  let curLat = P.lat[0] / 1000;
  while (true) {
    sn = await page.evaluate(n => window.__step(n), F);
    if (!sn || sn.dead || sn.state === 'over' || sn.state === 'dying' || sn.t >= cap) break;
    if (mode === 'daily' && sn.t >= 60) break;
    hist.push(sn); if (hist.length > 200) hist.shift();
    maxB = Math.max(maxB, sn.b.length / 5);
    if (sn.t >= nextDec) {
      decisions++;
      nextDec = sn.t + Math.max(0.016, (P.dec + gauss(rnd) * P.tim) / 1000);
      curLat = Math.max(0.016, (P.lat[0] + gauss(rnd) * P.lat[1]) / 1000);
      let view = hist[0]; for (let i = hist.length - 1; i >= 0; i--) if (hist[i].t <= sn.t - curLat + 1e-6) { view = hist[i]; break; }
      if (tierId === 'superhuman') view = sn;
      const off = (sn.t - view.t) * P.comp;
      const sc = decide(view, sn.px, sn.py, off, P);
      let pick = sc[0];
      const r = rnd();
      if (r < P.mistake) { pick = sc[Math.floor(rnd() * sc.length)]; mistakes++; }
      else if (r < P.mistake + P.randomFrac) { const small = sc.filter(s => s.c[2] <= 52); pick = small[Math.floor(rnd() * small.length)] || pick; }
      target = [pick.c[0] + gauss(rnd) * P.pos * 0.5, pick.c[1] + gauss(rnd) * P.pos * 0.5];
      // bullet time with a second finger on the hourglass when the best option still looks like a hit
      if (P.bt && sn.glow >= 100 && sn.bt <= 0 && sc[0].cost > 2500 && rnd() < P.bt) {
        await touch('touchStart', [{ x: fx, y: fy, id: 1 }, { x: bt[0], y: bt[1], id: 2 }]); await touch('touchEnd', [{ x: bt[0], y: bt[1], id: 2 }]); bts++;
      }
    }
    const dx = target[0] - sn.px, dy = target[1] - sn.py, l = Math.hypot(dx, dy), mv = Math.min(l, P.V * dt);
    if (l > 0.5) {
      let nx = fx + dx / l * mv, ny = fy + dy / l * mv;
      if (nx < 2 || nx > 388 || ny < 2 || ny > 842) { // finger hits the glass edge: lift and put it back on the firefly
        await touch('touchEnd', [{ x: fx, y: fy, id: 1 }]); fx = sn.px; fy = sn.py; await touch('touchStart', [{ x: fx, y: fy, id: 1 }]);
        await page.evaluate(() => window.__adv(32)); liftReplace++; continue;
      }
      fx = nx; fy = ny; await touch('touchMove', [{ x: fx, y: fy, id: 1 }]);
    }
  }
  await page.evaluate(() => window.__adv(150));
  const fin = await page.evaluate(() => ({ last: window.__lastRun || null, st: window.__game.state(), best: localStorage.getItem('dodge.best'), daily: localStorage.getItem('dodge.daily'), ach: localStorage.getItem('dodge.ach') }));
  await ctx.close();
  const t = fin.last ? fin.last.t : sn ? sn.t : 0;
  return { tier: tierId, mode, run: runIdx, t: +t.toFixed(2), capped: !fin.last && sn && sn.t >= cap, score: fin.last ? fin.last.score : fin.st.score, grazes: fin.last ? fin.last.grazes : fin.st.grazes, dieBy: fin.last ? fin.last.dieBy : '', survived: fin.last ? fin.last.survived : null, bts, decisions, mistakes, liftReplace, maxBullets: maxB, best: fin.best, daily: fin.daily, ach: fin.ach, errors };
}

(async () => {
  const S = await serve();
  const browser = await chromium.launch();
  const R = fs.existsSync(RES) ? JSON.parse(fs.readFileSync(RES, 'utf8')) : { game: 'dodge-rush', tiers: {} };
  const list = tiersWanted.length ? tiersWanted : Object.keys(TIERS);
  for (const tid of list) {
    const runs = [], n = Math.min(RUNS, { superhuman: 3, world: 3, skilled: 4 }[tid] || RUNS), t0 = Date.now();
    for (let i = 0; i < n; i++) { const r = await runOne(browser, S.url, tid, 'normal', i, CAP); runs.push(r); console.log(tid, 'normal', i, r.t, r.score, r.dieBy, 'bt', r.bts, 'err', r.errors.length); }
    for (const m of (['clumsy', 'casual'].includes(tid) ? ['daily', 'casual'] : ['daily'])) { const r = await runOne(browser, S.url, tid, m, 0, CAP); runs.push(r); console.log(tid, m, r.t, r.score, r.grazes, r.dieBy, r.survived, 'err', r.errors.length); }
    const ts = runs.filter(r => r.mode === 'normal').map(r => r.t).sort((a, b) => a - b);
    R.tiers[tid] = { name: TIERS[tid].name, params: TIERS[tid], runs, summary: { normal: { median: ts[ts.length >> 1], min: ts[0], max: ts[ts.length - 1], capped: runs.filter(r => r.capped).length, n: ts.length }, wallSec: Math.round((Date.now() - t0) / 1000), errors: runs.reduce((a, r) => a + r.errors.length, 0) } };
    fs.writeFileSync(RES, JSON.stringify(R, null, 1));
  }
  await browser.close(); S.srv.close();
})();
