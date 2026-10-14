// Skill-tier bot for atlantis (波塞迪亞). Free-roaming walk; goal = visit the 6 glowing landmarks (POIs).
// Usage: node bot.js [tier ...] [probes]   -> results.json
// Real headless Chromium (SwiftShader WebGL), mobile 390x844 @2x touch. three.js r128 is served from a local copy of the
// same npm build because the sandbox proxy blocks cdnjs. Movement = real touch drags: left 45% of screen = floating
// joystick, right side = look drag. Time is lock-stepped (rAF + performance.now virtualised, 1/60 s frames); hidden pages
// hold rAF callbacks like a real browser. Bots READ window.__poseidia (player pose, found list) and use the pure
// blocked()/groundAt() functions as their "map knowledge"; they never write state.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const GAME = '/mnt/project-files/apps/atlantis/index.html';
const THREE = path.join(OUT, 'three.min.js');
const FR = 1 / 60;
const CAP_S = +(process.env.CAP || 240);

const POIS = { temple: [0, 22, 11], springs: [-20, -1.5, 9], bridge: [0, 35, 7], walls: [71, 0, 8], market: [null, null, 11], harbor: [0, 172, 10] };

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, mistake: 0.15, random: 0.5, plan: 'greedy', run: 0.5, look: 0.2, events: true },
  casual:     { react: [400, 100], pos: 20, mistake: 0.06, random: 0.15, plan: 'greedy', run: 0.7, look: 0.3 },
  skilled:    { react: [260, 50], pos: 10, mistake: 0.02, random: 0, plan: 'astar', coarse: 6, run: 0.9, look: 0.5 },
  world:      { react: [180, 25], pos: 4, mistake: 0.003, random: 0, plan: 'astar', coarse: 3, run: 1, look: 0.2 },
  superhuman: { react: [16, 0], pos: 0, mistake: 0, random: 0, plan: 'astar', coarse: 1, run: 1, look: 0, tour: true },
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const INIT = `(() => {
  let q = new Map(), id = 0, t = 1000;
  window.requestAnimationFrame = cb => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = i => { q.delete(i); };
  performance.now = () => t;
  let hid = false;
  window.__vt = { step(n) { let ms = 0; for (let i = 0; i < n; i++) { t += ${1000 / 60}; if (hid) continue; const c = [...q.values()]; q = new Map(); const a = Date.now(); for (const f of c) f(t); ms += Date.now() - a; } return ms; }, pending: () => q.size };
  Object.defineProperty(Document.prototype, 'hidden', { get() { return hid; }, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return hid ? 'hidden' : 'visible'; }, configurable: true });
  window.__setHidden = h => { hid = h; document.dispatchEvent(new Event('visibilitychange')); };
  try { localStorage.setItem('poseidia.muted', 'true'); } catch (e) {}
})();`;

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>';
  const three = fs.readFileSync(THREE, 'utf8');
  await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://game.test/')) return r.fulfill({ body: html, contentType: 'text/html' }); if (/three(\.min)?\.js$/.test(u)) return r.fulfill({ body: three, contentType: 'application/javascript' }); return r.abort(); });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://game.test/');
  for (let i = 0; i < 100; i++) { await page.evaluate(() => __vt.step(2)); await new Promise(r => setTimeout(r, 50)); if (await page.evaluate(() => !document.getElementById('start').disabled)) break; }
  return { ctx, page, cdp, errors };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id, radiusX: 8, radiusY: 8, force: 1 })) });

// walkability grid (1 unit cells over [-192,192]) from the pure blocked() function
async function walkGrid(page) {
  const s = await page.evaluate(() => { let o = ''; for (let z = -192; z < 192; z++) for (let x = -192; x < 192; x++) o += __poseidia.blocked(x + 0.5, z + 0.5) ? '1' : '0'; return o; });
  return s;
}
const G = 384, idx = (x, z) => (Math.floor(z) + 192) * G + Math.floor(x) + 192;
function astar(grid, sx, sz, tx, tz, tr) {
  // 8-connected A*; goal = any free cell within tr of target
  const start = idx(sx, sz); const open = [[0, start]]; const g = new Float32Array(G * G).fill(1e9); const prev = new Int32Array(G * G).fill(-1); g[start] = 0;
  const h = i => Math.hypot((i % G) - 192 + 0.5 - tx, Math.floor(i / G) - 192 + 0.5 - tz);
  const push = (f, i) => { open.push([f, i]); let k = open.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (open[p][0] <= open[k][0]) break; [open[p], open[k]] = [open[k], open[p]]; k = p; } };
  const pop = () => { const top = open[0]; const last = open.pop(); if (open.length) { open[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r2 = l + 1; let m = k; if (l < open.length && open[l][0] < open[m][0]) m = l; if (r2 < open.length && open[r2][0] < open[m][0]) m = r2; if (m === k) break; [open[m], open[k]] = [open[k], open[m]]; k = m; } } return top; };
  let n = 0;
  while (open.length && n++ < 400000) {
    const [, c] = pop();
    if (h(c) < tr - 1.5) { const p = []; let k = c; while (k !== -1) { p.push([(k % G) - 192 + 0.5, Math.floor(k / G) - 192 + 0.5]); k = prev[k]; } return { path: p.reverse(), len: g[c] }; }
    const cx = c % G, cz = Math.floor(c / G);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue; const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue;
      const ni = nz * G + nx; if (grid.charCodeAt(ni) === 49) continue;
      if (dx && dz && (grid.charCodeAt(cz * G + nx) === 49 || grid.charCodeAt(nz * G + cx) === 49)) continue;
      // keep 1 cell away from walls when possible (soft cost)
      const ng = g[c] + (dx && dz ? 1.414 : 1);
      if (ng < g[ni]) { g[ni] = ng; prev[ni] = c; push(ng + h(ni), ni); }
    }
  }
  return null;
}

async function runTier(browser, tierId, T, seed, grid) {
  const r = rng(seed);
  const env = await newPage(browser); const { page, cdp } = env;
  const errs = env.errors;
  // tap start
  const sb = await page.evaluate(() => { const b = document.getElementById('start').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await touch(cdp, 'touchStart', [{ x: sb.x, y: sb.y, id: 0 }]); await page.evaluate(() => __vt.step(2)); await touch(cdp, 'touchEnd', []); await page.evaluate(() => __vt.step(2));
  const P = await page.evaluate(() => { const m = window.__poseidia; return { x: m.player.x, z: m.player.z }; });
  let vw = 390, vh = 844;
  const JO = () => ({ x: vw * 0.2, y: vh * 0.8 }); // joystick finger origin (left 45%)
  let joyDown = false, joyPos = null, joyOrigin = null;
  let gameT = 0, frameMs = [], hist = [];
  const log = { tier: tierId, found: [], foundAt: [], stuck: [], fellOut: [], distance: 0, clumsy: [], mistakes: 0 };
  const read = () => page.evaluate(() => { const m = window.__poseidia; const p = m.player; return { x: p.x, z: p.z, y: p.y, yaw: p.yaw, g: m.groundAt(p.x, p.z), found: m.found(), info: m.info(), hud: document.getElementById('found').textContent }; });
  const step = async n => { const ms = await page.evaluate(n => __vt.step(n), n); frameMs.push(ms / n); gameT += n * FR; };
  // market position: ring 90 at angle MK (constant read from the game source in main())
  const poi = Object.assign({}, POIS);
  poi.market = [Math.sin(MKANGLE) * 90, Math.cos(MKANGLE) * 90, 11];
  // order of visits
  let order;
  const ids = Object.keys(poi);
  if (T.tour) {
    // exact path lengths, best permutation (perfect information)
    const pts = { start: [P.x, P.z], ...Object.fromEntries(ids.map(k => [k, poi[k]])) };
    const D = {}; for (const a of ['start', ...ids]) for (const b of ids) if (a !== b) { const s = astar(grid, pts[a][0], pts[a][1], poi[b][0], poi[b][1], poi[b][2]); D[a + '>' + b] = s ? s.len : 1e9; }
    let best = null, bl = 1e9; const perm = (rest, cur, acc, seq) => { if (acc >= bl) return; if (!rest.length) { bl = acc; best = seq; return; } for (const k of rest) perm(rest.filter(q => q !== k), k, acc + D[cur + '>' + k], [...seq, k]); };
    perm(ids, 'start', 0, []); order = best; log.plannedLength = +bl.toFixed(1);
  } else order = null; // nearest-first by straight line at each step
  let target = null, path = null, pi = 0, lastProgress = { t: 0, x: P.x, z: P.z }, wanderUntil = -1, wanderDir = 0, nextLook = 0, sideStepUntil = -1, sideDir = 0, nextReplan = 0;
  let prev = { x: P.x, z: P.z };
  const t0 = Date.now();
  let rotated = false, rotateBack = -1, hiddenUntil = -1;
  while (gameT < CAP_S) {
    await step(2);
    const s = await read();
    hist.push({ t: gameT, s }); while (hist.length > 2 && hist[1].t <= gameT - 1.2) hist.shift();
    log.distance += Math.hypot(s.x - prev.x, s.z - prev.z); prev = { x: s.x, z: s.z };
    for (const f of s.found) if (!log.found.includes(f)) { log.found.push(f); log.foundAt.push([f, +gameT.toFixed(1)]); }
    if (s.g < 0 || s.y < 0.3) { if (!log.fellOut.length || gameT - log.fellOut[log.fellOut.length - 1].t > 5) log.fellOut.push({ t: +gameT.toFixed(1), x: +s.x.toFixed(2), z: +s.z.toFixed(2), y: +s.y.toFixed(2), g: s.g }); }
    if (s.found.length >= 6) break;
    if (hiddenUntil > 0) { if (gameT >= hiddenUntil) { await page.evaluate(() => __setHidden(false)); hiddenUntil = -1; if (joyDown) { await touch(cdp, 'touchEnd', []); joyDown = false; } } continue; }
    if (rotateBack > 0 && gameT >= rotateBack) { if (joyDown) { await touch(cdp, 'touchEnd', []); joyDown = false; } await page.setViewportSize({ width: 390, height: 844 }); vw = 390; vh = 844; rotateBack = -1; log.clumsy.push([+gameT.toFixed(1), 'rotate back']); }
    const dl = T.react[0] / 1000; let v = hist[0].s; for (const h of hist) if (h.t <= gameT - dl) v = h.s; if (T.react[0] <= 16) v = s;

    // clumsy extras
    if (T.events && r() < 2 * FR / 8) {
      const k = Math.floor(r() * 4);
      if (k === 0) { const pts = [{ x: 60, y: 600, id: 5 }, { x: 300, y: 500, id: 6 }, { x: 200, y: 300, id: 7 }]; await touch(cdp, 'touchStart', joyDown ? [{ ...joyPos, id: 1 }, ...pts] : pts); await step(6); await touch(cdp, joyDown ? 'touchMove' : 'touchEnd', joyDown ? [{ ...joyPos, id: 1 }] : []); log.clumsy.push([+gameT.toFixed(1), '3 extra fingers']); }
      else if (k === 1) { for (let i = 0; i < 8; i++) { await touch(cdp, 'touchStart', joyDown ? [{ ...joyPos, id: 1 }, { x: 280, y: 400, id: 9 }] : [{ x: 280, y: 400, id: 9 }]); await step(1); await touch(cdp, joyDown ? 'touchMove' : 'touchEnd', joyDown ? [{ ...joyPos, id: 1 }] : []); await step(1); } log.clumsy.push([+gameT.toFixed(1), 'rapid taps x8 (right side)']); }
      else if (k === 2 && !rotated) { await page.setViewportSize({ width: 844, height: 390 }); vw = 844; vh = 390; rotated = true; rotateBack = gameT + 4; log.clumsy.push([+gameT.toFixed(1), 'rotate to 844x390 with joystick held']); }
      else if (k === 3) { await page.evaluate(() => __setHidden(true)); hiddenUntil = gameT + 2; log.clumsy.push([+gameT.toFixed(1), 'background 2 s, joystick held']); continue; }
    }

    // choose target
    const remaining = ids.filter(k => !v.found.includes(k));
    if (!target || v.found.includes(target)) {
      target = T.tour ? order.find(k => remaining.includes(k)) : remaining.sort((a, b) => Math.hypot(poi[a][0] - v.x, poi[a][1] - v.z) - Math.hypot(poi[b][0] - v.x, poi[b][1] - v.z))[0];
      path = null; pi = 0;
    }
    const tg = poi[target];
    // desired world direction
    let dir;
    if (T.plan === 'astar') {
      if (!path || gameT > nextReplan) {
        const res = astar(grid, v.x, v.z, tg[0], tg[1], tg[2]); path = res ? res.path.filter((_, i) => i % T.coarse === 0 || i === res.path.length - 1) : null; pi = 0; nextReplan = gameT + 8;
      }
      if (path) { while (pi < path.length - 1 && Math.hypot(path[pi][0] - v.x, path[pi][1] - v.z) < Math.max(1.2, T.coarse * 0.7)) pi++; dir = [path[pi][0] - v.x, path[pi][1] - v.z]; }
      else dir = [tg[0] - v.x, tg[1] - v.z];
    } else dir = [tg[0] - v.x, tg[1] - v.z];
    // random wandering / unstick
    if (T.random && gameT > wanderUntil && r() < T.random * 2 * FR) { wanderUntil = gameT + 1 + r() * 3; wanderDir = r() * Math.PI * 2; }
    if (gameT < wanderUntil) dir = [Math.cos(wanderDir), Math.sin(wanderDir)];
    if (Math.hypot(v.x - lastProgress.x, v.z - lastProgress.z) > 1.5) lastProgress = { t: gameT, x: v.x, z: v.z };
    else if (gameT - lastProgress.t > 2.5) {
      // no progress for 2.5 s: record & try to unstick (greedy tiers side-step, A* tiers replan)
      log.stuck.push({ t: +gameT.toFixed(1), x: +v.x.toFixed(1), z: +v.z.toFixed(1), target });
      lastProgress = { t: gameT, x: v.x, z: v.z }; sideStepUntil = gameT + 1 + r() * 1.5; sideDir = r() < 0.5 ? 1 : -1; nextReplan = 0;
    }
    if (gameT < sideStepUntil) dir = [-dir[1] * sideDir + dir[0] * -0.3, dir[0] * sideDir + dir[1] * -0.3];
    const dn = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / dn, dir[1] / dn];
    // camera: turn to face movement direction now and then (look drag on right side)
    const desiredYaw = Math.atan2(-dir[0], -dir[1]);
    let dyaw = Math.atan2(Math.sin(desiredYaw - v.yaw), Math.cos(desiredYaw - v.yaw));
    if (T.look && gameT > nextLook && Math.abs(dyaw) > 0.5 && r() < T.look) {
      nextLook = gameT + 1.5; const px = Math.max(-260, Math.min(260, -dyaw / 0.0058)); const lx = vw * 0.75, ly = vh * 0.45;
      const pts0 = joyDown ? [{ ...joyPos, id: 1 }] : [];
      await touch(cdp, joyDown ? 'touchStart' : 'touchStart', [...pts0, { x: lx, y: ly, id: 2 }]);
      for (let i = 1; i <= 6; i++) { await touch(cdp, 'touchMove', [...pts0, { x: Math.max(vw * 0.46, Math.min(vw - 2, lx + px * i / 6)), y: ly + gauss(r) * T.pos * 0.2, id: 2 }]); await step(1); }
      await touch(cdp, 'touchEnd', pts0); // only the look finger lifts
      continue;
    }
    // joystick: convert world dir into stick axes relative to current yaw
    const fw = [-Math.sin(v.yaw), -Math.cos(v.yaw)], rt = [Math.cos(v.yaw), -Math.sin(v.yaw)];
    const f = dir[0] * fw[0] + dir[1] * fw[1], st = dir[0] * rt[0] + dir[1] * rt[1];
    const mag = (r() < T.run ? 1 : 0.6) * 56 * (gameT < wanderUntil ? 0.8 : 1) + 4;
    if (!joyDown) { joyOrigin = JO(); joyOrigin.x += gauss(r) * T.pos * 0.3; joyOrigin.y += gauss(r) * T.pos * 0.3; await touch(cdp, 'touchStart', [{ ...joyOrigin, id: 1 }]); joyDown = true; joyPos = { ...joyOrigin }; }
    joyPos = { x: joyOrigin.x + st * mag + gauss(r) * T.pos * 0.25, y: joyOrigin.y - f * mag + gauss(r) * T.pos * 0.25 };
    if (T.mistake && r() < T.mistake * 2 * FR) { await touch(cdp, 'touchEnd', []); joyDown = false; log.mistakes++; await step(Math.round(Math.max(0.1, T.react[0] / 1000) / FR)); continue; }
    await touch(cdp, 'touchMove', [{ ...joyPos, id: 1 }]);
  }
  if (joyDown) await touch(cdp, 'touchEnd', []);
  const s = await read();
  const fm = frameMs.slice().sort((a, b) => a - b);
  Object.assign(log, { completed: s.found.length >= 6, timeS: +gameT.toFixed(1), foundN: s.found.length, distance: +log.distance.toFixed(0), wallMs: Date.now() - t0, renderMsMedian: fm[fm.length >> 1], renderMsP95: fm[Math.floor(fm.length * 0.95)], drawInfo: s.info, hud: s.hud, errors: errs.slice(0, 5) });
  log.stuckEpisodes = log.stuck.length; if (log.stuck.length > 12) log.stuck = log.stuck.slice(0, 12);
  if (!log.clumsy.length) delete log.clumsy;
  await env.ctx.close();
  return log;
}
let MKANGLE = 0;

async function probes(browser, grid) {
  const env = await newPage(browser); const { page, cdp } = env;
  const out = {};
  // 1. hard-coded map facts: start cell, POI centres walkable?, reachability of every POI from start (flood fill on blocked())
  const start = await page.evaluate(() => ({ x: __poseidia.player.x, z: __poseidia.player.z }));
  const seen = new Uint8Array(G * G); const st = [idx(start.x, start.z)]; seen[st[0]] = 1; let n = 0;
  while (st.length) { const c = st.pop(); n++; const cx = c % G, cz = Math.floor(c / G); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= G || nz >= G) continue; const ni = nz * G + nx; if (!seen[ni] && grid.charCodeAt(ni) === 48) { seen[ni] = 1; st.push(ni); } } }
  const free = [...grid].filter(c => c === '0').length;
  out.walkable = { reachableCells: n, freeCells: free, isolatedFreeCells: free - n };
  const poi = Object.assign({}, POIS); poi.market = [Math.sin(MKANGLE) * 90, Math.cos(MKANGLE) * 90, 11];
  out.poiReach = {};
  for (const [k, p] of Object.entries(poi)) { let best = 1e9; for (let z = -12; z <= 12; z++) for (let x = -12; x <= 12; x++) { const i = idx(p[0] + x, p[1] + z); if (seen[i] && Math.hypot(x, z) < best) best = Math.hypot(x, z); } out.poiReach[k] = { nearestReachable: +best.toFixed(1), radius: p[2], ok: best < p[2] - 0.5 }; }
  // isolated pockets (free but unreachable): list a few
  const iso = []; for (let i = 0; i < G * G && iso.length < 2000; i++) if (grid.charCodeAt(i) === 48 && !seen[i]) iso.push([(i % G) - 192, Math.floor(i / G) - 192]);
  out.isolatedSample = iso.filter((_, i) => i % 50 === 0).slice(0, 20);
  // 2. edge probing: from many angles, run outward against each quay edge / bridge sides / pier end for 2 s and check we never leave ground
  const startBtn = await page.evaluate(() => { const b = document.getElementById('start').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await touch(cdp, 'touchStart', [{ ...startBtn, id: 0 }]); await page.evaluate(() => __vt.step(2)); await touch(cdp, 'touchEnd', []);
  await page.evaluate(() => __vt.step(10));
  // run straight forward toward the sea from the start position (south edge 140) and along the pier, sampling ground
  const samples = [];
  await touch(cdp, 'touchStart', [{ x: 78, y: 675, id: 1 }]); await touch(cdp, 'touchMove', [{ x: 78, y: 675 - 60, id: 1 }]);
  // face south (+z): yaw = PI
  await touch(cdp, 'touchStart', [{ x: 78, y: 615, id: 1 }, { x: 290, y: 400, id: 2 }]);
  for (let i = 1; i <= 10; i++) { await touch(cdp, 'touchMove', [{ x: 78, y: 615, id: 1 }, { x: 290 - i * 54.2, y: 400, id: 2 }]); await page.evaluate(() => __vt.step(1)); }
  await touch(cdp, 'touchEnd', [{ x: 78, y: 615, id: 1 }]);
  for (let i = 0; i < 60; i++) { await page.evaluate(() => __vt.step(10)); samples.push(await page.evaluate(() => { const p = __poseidia.player; return [+p.x.toFixed(2), +p.z.toFixed(2), +p.y.toFixed(2), __poseidia.groundAt(p.x, p.z)]; })); }
  await touch(cdp, 'touchEnd', []);
  out.runSouth = { end: samples[samples.length - 1], minGround: Math.min(...samples.map(s => s[3])), maxZ: Math.max(...samples.map(s => s[1])) };
  // 3. background while joystick held, release finger while hidden -> does the player keep walking after return?
  await touch(cdp, 'touchStart', [{ x: 78, y: 675, id: 1 }]); await touch(cdp, 'touchMove', [{ x: 78, y: 615, id: 1 }]); await page.evaluate(() => __vt.step(30));
  await page.evaluate(() => __setHidden(true)); await page.evaluate(() => __vt.step(30)); await touch(cdp, 'touchEnd', []);
  await page.evaluate(() => __setHidden(false));
  const a = await page.evaluate(() => ({ x: __poseidia.player.x, z: __poseidia.player.z })); await page.evaluate(() => __vt.step(120)); const b = await page.evaluate(() => ({ x: __poseidia.player.x, z: __poseidia.player.z }));
  out.releaseWhileHidden = { movedAfterReturn: +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2), pendingRaf: await page.evaluate(() => __vt.pending()) };
  // 4. repeated background cycles -> number of queued frame loops stays 1
  for (let i = 0; i < 5; i++) { await page.evaluate(() => __setHidden(true)); await page.evaluate(() => __vt.step(2)); await page.evaluate(() => __setHidden(false)); await page.evaluate(() => __vt.step(2)); }
  out.rafLoopsAfter5Backgrounds = await page.evaluate(() => __vt.pending());
  // 5. rotate to landscape and back mid-drag
  await touch(cdp, 'touchStart', [{ x: 78, y: 675, id: 1 }]); await touch(cdp, 'touchMove', [{ x: 120, y: 640, id: 1 }]); await page.evaluate(() => __vt.step(20));
  await page.setViewportSize({ width: 844, height: 390 }); await page.evaluate(() => __vt.step(30));
  await page.screenshot({ path: path.join(OUT, 'landscape.png') });
  const landscape = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, canvas: [document.querySelector('#view canvas').width, document.querySelector('#view canvas').height] }));
  await touch(cdp, 'touchEnd', []); await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => __vt.step(20));
  out.rotate = { landscape, errors: env.errors.slice(0, 3) };
  // 6. real-time frame rate (unlocked) for 3 s, at start position: count frames via a separate real rAF
  out.renderInfo = await page.evaluate(() => __poseidia.info());
  out.errors = env.errors.slice(0, 5);
  await env.ctx.close();
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const tiers = args.filter(a => TIERS[a]);
  const run = tiers.length || args.includes('probes') ? tiers : Object.keys(TIERS);
  const resPath = path.join(OUT, 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : { game: 'atlantis', tiers: {}, findings: [] };
  results.harness = { viewport: '390x844@2 touch', frame: '1/60 s lock-stepped', capS: CAP_S, renderer: 'SwiftShader (software WebGL) - render ms are CPU-bound, not device fps', three: 'r128 from npm (cdnjs blocked by sandbox proxy)' };
  const src = fs.readFileSync(GAME, 'utf8'); const m = src.match(/var MK = ([^;]+);/); MKANGLE = m ? eval(m[1].replace(/Math\.PI/g, String(Math.PI))) : 0;
  const browser = await chromium.launch({ args: ['--mute-audio', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const g0 = await newPage(browser); const grid = await walkGrid(g0.page); await g0.ctx.close();
  for (const id of run) {
    const runs = []; const nRuns = +(process.env.RUNS || 2);
    for (let k = 0; k < nRuns; k++) { const L = await runTier(browser, id, TIERS[id], 100 + k * 31 + id.length, grid); runs.push(L); console.log(id, k, JSON.stringify({ done: L.completed, t: L.timeS, found: L.foundN, dist: L.distance, stuck: L.stuckEpisodes, fell: L.fellOut.length, ms: L.renderMsMedian, wall: L.wallMs, err: L.errors })); }
    results.tiers[id] = { runs, summary: { completed: runs.filter(r => r.completed).length + '/' + runs.length, timeS: runs.map(r => r.timeS), found: runs.map(r => r.foundN), distance: runs.map(r => r.distance), stuckEpisodes: runs.map(r => r.stuckEpisodes), fellOut: runs.map(r => r.fellOut.length), renderMsMedian: runs.map(r => r.renderMsMedian) } };
    fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  }
  if (args.includes('probes') || !tiers.length) { results.probes = await probes(browser, grid); console.log(JSON.stringify(results.probes, null, 1)); fs.writeFileSync(resPath, JSON.stringify(results, null, 1)); }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
