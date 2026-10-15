// Skill-tier bot for pressure-washer (高壓洗淨).
// Usage: node bot.js [tier ...]   (default: all five tiers; env LV=1,10 limits levels)  -> writes results.json
// Harness: real headless Chromium, mobile 390x844 @2x, touch via CDP Input.dispatchTouchEvent.
// Time is lock-stepped: the page's requestAnimationFrame is wrapped so the game advances only when the bot
// calls __vt.step(n) (n frames of 1/30 s = a 30 fps phone). Reproducible and faster than real time, while every
// player action is a real touch event. Bots READ window.__pw.dbg() (72x90 dirt grid) through a reaction-time
// delay buffer, as a human would see the screen, and never call state-changing hooks.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const GAME = '/mnt/project-files/apps/pressure-washer/index.html';
const FPS = +(process.env.FPS || 30), FRAME = 1 / FPS;

// speed: finger speed while scrubbing (css px / s); Infinity = a full lane traverse every frame (frame-perfect)
// scrubs: fixed traverses per lane for non-adaptive tiers; adaptive tiers re-check the (delayed) screen after each traverse
const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  random: 0.5,  attempts: 5, speed: 500,  adaptive: false, scrubs: 2, lane: 1.3,  lift: false, clumsyEvents: true },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  random: 0.15, attempts: 3, speed: 900,  adaptive: false, scrubs: 4, lane: 1.1,  lift: false },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  random: 0,    attempts: 3, speed: 1500, adaptive: true,  lane: 1.0,  lift: true },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, random: 0,    attempts: 3, speed: 2500, adaptive: true,  lane: 0.95, lift: true },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     random: 0,    attempts: 3, speed: Infinity, adaptive: true, lane: 0.9, lift: true },
};
if (process.env.SPEEDOVR) for (const k in TIERS) TIERS[k].speed = +process.env.SPEEDOVR; // experiment: fixed finger speed
const LEVELS = process.env.LV ? process.env.LV.split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const INIT = `(() => {
  const q = []; let t = 1000; const FR = ${1000 / FPS};
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__vt = { step(n) { for (let i = 0; i < n; i++) { t += FR; const c = q.splice(0); for (const f of c) f(t); } return t; }, get t() { return t; } };
  let hid = false;
  Object.defineProperty(Document.prototype, 'hidden', { get() { return hid; }, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return hid ? 'hidden' : 'visible'; }, configurable: true });
  window.__setHidden = h => { hid = h; document.dispatchEvent(new Event('visibilitychange')); };
  try { localStorage.setItem('pw_unlockAll', 'true'); localStorage.setItem('pw_muted', 'true'); } catch (e) {}
})();`;

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  // the app file is a body fragment (the host adds the document skeleton), so wrap it the same way
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>';
  await ctx.route('**/*', r => r.request().url().startsWith('http://game.test/') ? r.fulfill({ body: html, contentType: 'text/html' }) : r.abort());
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://game.test/');
  await page.evaluate(() => __vt.step(5));
  return { ctx, page, cdp, errors };
}

const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });
async function tap(env, x, y) { await touch(env.cdp, 'touchStart', [{ x, y }]); await env.page.evaluate(() => __vt.step(2)); await touch(env.cdp, 'touchEnd', []); await env.page.evaluate(() => __vt.step(2)); }
async function center(page, sel) { return page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }, sel); }

async function openLevel(env, lv) {
  // select the level through the real menu ("unlock all" switch pre-set): scroll the tile into view, tap it
  const sel = `#levels .tile:nth-child(${lv})`;
  await env.page.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  await env.page.evaluate(() => __vt.step(2));
  const c = await center(env.page, sel);
  await tap(env, c.x, c.y);
  const st = await env.page.evaluate(() => __pw.state);
  if (st !== 'play') throw new Error('level did not start, state=' + st);
}

const SAW = 72, SAH = 90, CELL = 10; // dirt grid (stage px per cell)
function counts(grid) { let g = 0, m = 0; for (let i = 0; i < grid.length; i++) { const c = grid.charCodeAt(i); if (c === 49) g++; else if (c === 50) m++; } return { g, m }; }
// dirty x-extent of a lane band (stage px) or null
function laneExtent(grid, want, y, half) {
  const gy0 = Math.floor((y - half) / CELL), gy1 = Math.floor((y + half) / CELL);
  let a = 1e9, b = -1;
  for (let gy = Math.max(0, gy0); gy <= Math.min(SAH - 1, gy1); gy++) for (let gx = 0; gx < SAW; gx++) if (grid.charCodeAt(gy * SAW + gx) - 48 === want) { if (gx < a) a = gx; if (gx > b) b = gx; }
  return b < 0 ? null : [a * CELL + CELL / 2, b * CELL + CELL / 2];
}

// ---------------- the player ----------------
async function playAttempt(env, tierId, T, lv, attempt, seed) {
  const r = rng(seed);
  const page = env.page, cdp = env.cdp;
  const hist = [];
  let gameT = 0;
  const info0 = await page.evaluate(() => __pw.dbg());
  const limit = info0.limit, limitVal = info0.limitVal, target = info0.target;
  const capT = limit ? limitVal + 40 : 300; // no-limit levels: a player gives up after 5 minutes (limited levels end by the game itself)
  const log = { level: lv, attempt };
  const events = [], clumsy = [];
  let finger = null;
  let noiseX = 0, noiseY = 0;
  let rotateBackAt = -1, hiddenUntil = -1, rotations = 0;
  let st = await page.evaluate(() => __pw.stage());
  const toScreen = (sx, sy) => ({ x: st.x + sx * st.s, y: st.y + sy * st.s + 70 }); // touch aim sits 70 css px above the finger
  const reactS = () => Math.max(1 / 60, (T.react[0] + gauss(r) * T.react[1]) / 1000);
  const view = () => { if (T.react[0] <= 16) return hist[hist.length - 1].grid; const dl = T.react[0] / 1000; let v = hist[0]; for (const h of hist) if (h.t <= gameT - dl) v = h; return v.grid; };
  const lift = async () => { if (finger) { await touch(cdp, 'touchEnd', []); finger = null; } };
  const step = async n => { if (n > 0) { await page.evaluate(n => __vt.step(n), n); gameT += n * FRAME; } };
  const READ = n => { __vt.step(n); const d = __pw.dbg(); return { grid: d.grid, pct: d.pct, state: d.state, elapsed: d.elapsed, water: d.water, nozzle: __pw.nozzle }; };
  let pending = null; // state returned by the last step+read call

  async function setNozzle(n) {
    await lift();
    const c = await center(page, n ? '#nozJet' : '#nozWide');
    await step(Math.round(reactS() * FPS * 0.5));
    await tap(env, c.x + gauss(r) * T.pos * 0.6, c.y + gauss(r) * T.pos * 0.6); gameT += 4 * FRAME;
    const now = await page.evaluate(() => __pw.nozzle);
    if (now !== n) events.push({ t: +gameT.toFixed(1), ev: 'nozzle tap missed', at: c });
  }

  let mode = -1, lanes = [], li = 0, sweepDir = 1, ext = null, scrubsDone = 0, pos = null, passes = 0;
  const t0 = Date.now();
  let res = null; const trace = [];
  let d = null;
  for (let iter = 0; ; iter++) {
    if (pending) { d = pending; pending = null; } else d = await page.evaluate(READ, 0);
    hist.push({ t: gameT, grid: d.grid });
    while (hist.length > 2 && hist[1].t <= gameT - 1.2) hist.shift();
    if (iter % Math.round(5 * FPS) === 0) trace.push([+gameT.toFixed(0), +(d.pct * 100).toFixed(1)]);
    if (process.env.DBG && iter % Math.round(5 * FPS) === 0) console.log('t', gameT.toFixed(1), 'pct', (d.pct * 100).toFixed(1), 'noz', d.nozzle, 'mode', mode, 'lane', li + '/' + lanes.length, 'wall', Date.now() - t0);
    if (d.state === 'reveal' || d.state === 'done') { res = { cleared: true, how: 'cleaned', time: +d.elapsed.toFixed(1), water: +d.water.toFixed(1), pct: 100 }; break; }
    if (d.state === 'fail') { res = { cleared: false, how: limit === 'time' ? 'time up' : 'water out', time: +d.elapsed.toFixed(1), water: +d.water.toFixed(1), pct: +(d.pct * 100).toFixed(1) }; break; }
    if (d.state !== 'play') { res = { cleared: false, how: 'unexpected state ' + d.state, time: +d.elapsed.toFixed(1), pct: +(d.pct * 100).toFixed(1) }; break; }
    // hopeless projection (compute saver): after 40% of the budget, linear projection short of target by > 25 pts
    if (limit && d.elapsed > 0.4 * limitVal && d.pct * 100 + (d.pct * 100 / Math.max(1, (limit === 'time' ? d.elapsed : d.water))) * ((limitVal - (limit === 'time' ? d.elapsed : d.water))) < target * 100 - 25) { res = { cleared: false, how: 'projected fail (abandoned at ' + Math.round(d.elapsed) + ' s)', time: +d.elapsed.toFixed(1), water: +d.water.toFixed(1), pct: +(d.pct * 100).toFixed(1) }; break; }
    if (gameT > capT) { res = { cleared: false, how: limit ? 'cap' : 'gave up (5 min, no limit)', time: +d.elapsed.toFixed(1), water: +d.water.toFixed(1), pct: +(d.pct * 100).toFixed(1) }; break; }

    if (hiddenUntil > 0) { if (gameT >= hiddenUntil) { await page.evaluate(() => __setHidden(false)); hiddenUntil = -1; } else { await step(1); continue; } }
    if (rotateBackAt > 0 && gameT >= rotateBackAt) { await lift(); await page.setViewportSize({ width: 390, height: 844 }); await step(2); st = await page.evaluate(() => __pw.stage()); rotateBackAt = -1; clumsy.push({ t: +gameT.toFixed(1), ev: 'rotate back to 390x844', stage: st }); pos = null; ext = null; }

    // clumsy extra behaviours (~ every 8 s)
    if (T.clumsyEvents && r() < FRAME / 8) {
      const kind = Math.floor(r() * 4);
      if (kind === 0) {
        const p2 = { x: 30 + r() * 330, y: 150 + r() * 500, id: 7 };
        if (finger) { await touch(cdp, 'touchMove', [{ ...finger, id: 0 }, p2]); await step(6); await touch(cdp, 'touchMove', [{ ...finger, id: 0 }]); }
        else { await touch(cdp, 'touchStart', [p2]); await step(6); await touch(cdp, 'touchEnd', []); }
        clumsy.push({ t: +gameT.toFixed(1), ev: 'second finger' });
      } else if (kind === 1) {
        await lift();
        const x = 40 + r() * 300, y = 200 + r() * 450;
        for (let k = 0; k < 6; k++) { await touch(cdp, 'touchStart', [{ x: x + gauss(r) * 5, y: y + gauss(r) * 5 }]); await step(1); await touch(cdp, 'touchEnd', []); await step(1); }
        clumsy.push({ t: +gameT.toFixed(1), ev: 'rapid taps x6' });
      } else if (kind === 2 && rotateBackAt < 0 && rotations < 2) {
        await page.setViewportSize({ width: 844, height: 390 }); await step(3); st = await page.evaluate(() => __pw.stage()); rotateBackAt = gameT + 3; rotations++;
        clumsy.push({ t: +gameT.toFixed(1), ev: 'rotate to 844x390 (finger down)', stage: st });
      } else if (kind === 3) {
        await page.evaluate(() => __setHidden(true)); hiddenUntil = gameT + 2; clumsy.push({ t: +gameT.toFixed(1), ev: 'background 2 s (finger down)' });
        await lift(); continue;
      }
    }

    // (re)plan: choose the dirt type and build lanes from the delayed view
    if (li >= lanes.length) {
      const g = view(); const c = counts(g);
      let want = c.g > 0.08 * c.m || c.m === 0 ? 1 : 2; // wide fan for surface grime first, then jet for mud
      if (c.g === 0 && c.m > 0) want = 2;
      if (T.random && r() < T.random) want = r() < 0.5 ? 1 : 2; // random choice
      const nz = want === 2 ? 1 : 0, rad = nz ? 30 : 80, sp = rad * 1.25 * T.lane;
      lanes = [];
      for (let y = Math.min(rad * 0.7, 40); y < SAH * CELL + rad * 0.3; y += sp) if (laneExtent(g, want, y, sp / 2)) lanes.push(y);
      if (T.random && r() < T.random) for (let i = lanes.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lanes[i], lanes[j]] = [lanes[j], lanes[i]]; }
      li = 0; mode = nz; passes++; ext = null;
      await lift();
      await step(Math.round(reactS() * FPS)); // look & think
      if (d.nozzle !== nz) await setNozzle(nz);
      if (T.mistake && r() < T.mistake) { await setNozzle(1 - nz); events.push({ t: +gameT.toFixed(1), ev: 'mistake: wrong nozzle' }); }
      if (!lanes.length) { await step(2); continue; }
    }
    const want = mode ? 2 : 1, rad = mode ? 30 : 80, sp = rad * 1.25 * T.lane, y = lanes[li];
    if (!ext) {
      ext = laneExtent(view(), want, y, sp / 2); scrubsDone = 0;
      if (!ext) { li++; continue; }
      sweepDir = pos && Math.abs(pos.x - ext[1]) < Math.abs(pos.x - ext[0]) ? -1 : 1; pos = { x: sweepDir > 0 ? ext[0] - rad * 0.3 : ext[1] + rad * 0.3, y };
      if (T.lift && limit === 'water') await lift();
    }
    // move along the lane at tier speed
    const goal = sweepDir > 0 ? ext[1] + rad * 0.3 : ext[0] - rad * 0.3;
    const stepPx = T.speed === Infinity ? 1e9 : T.speed * (1 + gauss(r) * T.tim / 600) / st.s * FRAME;
    pos.x += sweepDir * Math.max(2, stepPx);
    const endOfTraverse = sweepDir > 0 ? pos.x >= goal : pos.x <= goal;
    if (endOfTraverse) pos.x = goal;
    noiseX = noiseX * 0.92 + gauss(r) * T.pos * 0.39; noiseY = noiseY * 0.92 + gauss(r) * T.pos * 0.39; // OU motor noise, stationary sigma ~= T.pos
    const p = toScreen(Math.max(-30, Math.min(SAW * CELL + 30, pos.x)), pos.y);
    p.x = Math.min(389, Math.max(1, p.x + noiseX)); p.y = Math.min(843, Math.max(1, p.y + noiseY));
    if (T.mistake && r() < T.mistake * FRAME) { await lift(); events.push({ t: +gameT.toFixed(1), ev: 'mistake: finger slipped off' }); await step(Math.round(reactS() * FPS)); }
    if (!finger) { await touch(cdp, 'touchStart', [{ x: p.x, y: p.y }]); finger = p; }
    else { touch(cdp, 'touchMove', [{ x: p.x, y: p.y }]); finger = p; } // pipelined with the next frame (<= 1 frame input latency)
    pending = await page.evaluate(READ, 1); gameT += FRAME;
    if (endOfTraverse) {
      sweepDir = -sweepDir; scrubsDone++;
      if (T.adaptive) {
        const e2 = laneExtent(view(), want, y, sp / 2.4); // still dirt in this lane on the (delayed) screen? keep scrubbing
        if (!e2 || scrubsDone > 40) { li++; ext = null; } else ext = e2;
      } else if (scrubsDone >= T.scrubs) { li++; ext = null; }
    }
  }
  await lift();
  if (rotateBackAt > 0) await page.setViewportSize({ width: 390, height: 844 });
  await step(Math.round(3 * FPS)); // let reveal/done finish
  const st2 = await page.evaluate(() => ({ state: __pw.state, stars: document.querySelectorAll('#stars .s.on').length, title: document.querySelector('#doneTitle').textContent, hint: document.querySelector('#starHint').textContent }));
  Object.assign(log, res, { target: +(target * 100).toFixed(1), limit, limitVal, stars: st2.stars, doneTitle: st2.title, starHint: st2.hint, passes, pctPerMin: +((res.pct || 0) / Math.max(0.1, res.time / 60)).toFixed(1), trace, wallMs: Date.now() - t0 });
  if (events.length) log.events = events.slice(0, 20); if (clumsy.length) log.clumsy = clumsy;
  return log;
}

async function main() {
  const tiers = process.argv.slice(2).filter(a => TIERS[a]);
  const run = tiers.length ? tiers : Object.keys(TIERS);
  const resPath = path.join(OUT, process.env.OUTFILE || 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : { game: 'pressure-washer', harness: {}, tiers: {}, findings: [] };
  results.harness = { fps: FPS, viewport: '390x844@2 touch', levels: LEVELS, note: 'lock-stepped rAF at fixed 1/' + FPS + ' s; touch via CDP; retry only if within 4 pts of target' };
  const browser = await chromium.launch({ args: ['--mute-audio', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
  for (const tierId of run) {
    const T = TIERS[tierId]; const runs = [];
    for (const lv of LEVELS) {
      for (let a = 1; a <= T.attempts; a++) {
        const env = await newPage(browser);
        await openLevel(env, lv);
        const r = await playAttempt(env, tierId, T, lv, a, lv * 1000 + a * 17 + tierId.length);
        r.errors = env.errors.slice(0, 5); if (!r.errors.length) delete r.errors;
        await env.ctx.close();
        console.log(tierId, 'L' + lv, 'a' + a, r.cleared ? 'CLEAR' : 'fail', r.how, 't=' + r.time, 'pct=' + r.pct, '/' + r.target, 'stars=' + r.stars, 'wall=' + r.wallMs);
        runs.push(r);
        if (r.cleared) break;
        if (r.target - r.pct > 4) { r.gaveUp = 'hopeless (>4 pts short), no retry'; break; }
      }
    }
    const per = {}; for (const r of runs) { const p = per[r.level] || (per[r.level] = { attempts: 0, cleared: false }); p.attempts++; if (r.cleared) Object.assign(p, { cleared: true, time: r.time, stars: r.stars }); else p.bestPct = Math.max(p.bestPct || 0, r.pct); }
    const cleared = Object.values(per).filter(p => p.cleared).length;
    results.tiers[tierId] = { runs, summary: { levelsCleared: `${cleared}/${LEVELS.length}`, perLevel: per, meanPctPerMin: +(runs.reduce((s, r) => s + r.pctPerMin, 0) / runs.length).toFixed(1) } };
    fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  }
  await browser.close();
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { newPage, TIERS, touch };
