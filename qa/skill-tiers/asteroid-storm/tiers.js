// Skill-tier bots for 隕石風暴 per qa/skill-tiers/SPEC.md (written by the release reviewer; none existed).
// Real headless Chromium, 390x844 mobile, two-thumb CDP touch (left = move stick, right = aim/fire stick).
// Bots READ window.__game.state() (what a player sees) through a reaction-delay buffer and ACT only via touch.
// The only state pokes: seeding Math.random (init script) and, for late-wave probes, starting at wave N
// (SPEC: "start/select a level"). Usage: node tiers.js [jobFilter] ; results -> tiers-results.json
const fs = require('fs'), path = require('path');
const { serve, launch, newPage, Hands, center, sleep } = require('./common');
const OUT = path.join(__dirname, 'tiers-results.json');
const html = fs.readFileSync(path.resolve(__dirname, '../../../apps/asteroid-storm/index.html'), 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {CFG};')();
const BS = core.CFG.bulletSpeed, BL = core.CFG.bulletLife;

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, randomShare: 0.5, predict: 0, dirs: 8, tick: 150 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, randomShare: 0.15, predict: 0.3, dirs: 16, tick: 120 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, randomShare: 0, predict: 0.6, dirs: 16, tick: 100 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, randomShare: 0, predict: 0.85, dirs: 24, tick: 80 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, randomShare: 0, predict: 1, dirs: 32, tick: 0 },
};
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const wd = (d, s) => d > s / 2 ? d - s : d < -s / 2 ? d + s : d;

function decide(st, T, lag) {
  const s = st.ship, WW = st.WW, WH = st.WH, hz = [];
  for (const r of st.rocks) if (!r[5]) hz.push({ x: r[0], y: r[1], vx: r[2], vy: r[3], r: r[4] * (r[6] ? 0.92 : 0.86) });
  for (const e of st.enemies) if (!e[4]) hz.push({ x: e[0], y: e[1], vx: e[2], vy: e[3], r: 12 });
  for (const b of st.ebul) hz.push({ x: b[0], y: b[1], vx: b[2], vy: b[3], r: 3 });
  for (const h of hz) { h.px = wd(h.x - s.x, WW); h.py = wd(h.y - s.y, WH); }
  const DIRS = []; for (let i = 0; i < T.dirs; i++) DIRS.push([Math.cos(i / T.dirs * Math.PI * 2), Math.sin(i / T.dirs * Math.PI * 2)]);
  const cands = [[0, 0, 0]].concat(DIRS.map(d => [d[0], d[1], 1]), DIRS.map(d => [d[0], d[1], 0.5]));
  let best = cands[0], bestCost = Infinity;
  const near = hz.filter(h => Math.hypot(h.px, h.py) < 360);
  for (const c of cands) {
    let x = 0, y = 0, vx = s.vx, vy = s.vy, cost = 0; const dt = 0.08;
    for (let k = 1; k <= 13; k++) {
      const t = k * dt;
      vx += c[0] * c[2] * 600 * dt; vy += c[1] * c[2] * 600 * dt;
      const dmp = Math.exp(-1.2 * dt); vx *= dmp; vy *= dmp;
      const sp = Math.hypot(vx, vy); if (sp > 320) { vx *= 320 / sp; vy *= 320 / sp; }
      x += vx * dt; y += vy * dt; const wt = 1.3 - t;
      for (const h of near) { const cl = Math.hypot(h.px + h.vx * t - x, h.py + h.vy * t - y) - h.r - 9; if (cl < 0) cost += 4000 * wt; else if (cl < 34) cost += (34 - cl) * (34 - cl) * 0.6 * wt; }
    }
    cost += Math.hypot(vx, vy) * 0.08 + c[2] * 2;
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  let move = best;
  if (bestCost < 20 && st.pus.length) {
    let pb = null, pd = 1e9;
    for (const p of st.pus) { const dx = wd(p[0] - s.x, WW), dy = wd(p[1] - s.y, WH), d = Math.hypot(dx, dy); if (d < pd) { pd = d; pb = [dx / d, dy / d]; } }
    if (pd < 260) move = [pb[0], pb[1], 0.7];
  }
  const L = lag, sx = s.vx * L, sy = s.vy * L;
  let tgt = null, tc = Infinity;
  const consider = (x, y, vx, vy, r, bonus) => {
    const px = wd(x - s.x, WW) + vx * L - sx, py = wd(y - s.y, WH) + vy * L - sy;
    const a = vx * vx + vy * vy - BS * BS, b = 2 * (px * vx + py * vy), cc = px * px + py * py;
    const disc = b * b - 4 * a * cc; if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / (2 * a); if (!(t > 0) || t > BL - 0.05) return;
    const rvx = vx - s.vx, rvy = vy - s.vy, vv = rvx * rvx + rvy * rvy;
    const tca = vv > 1 ? Math.max(0, -(px * rvx + py * rvy) / vv) : 9;
    const dmin = Math.hypot(px + rvx * Math.min(tca, 3), py + rvy * Math.min(tca, 3));
    const cost = t - (dmin < r + 50 ? 0.4 / (0.4 + tca) : 0) - bonus;
    if (cost < tc) { tc = cost; tgt = Math.atan2(py + vy * t, px + vx * t); }
  };
  for (const r of st.rocks) if (!r[5]) consider(r[0], r[1], r[2], r[3], r[4], r[6] ? -0.1 : 0);
  for (const e of st.enemies) if (!e[4]) consider(e[0], e[1], e[2], e[3], 12, 0.35);
  if (tgt === null) {  // nothing in range: aim at the nearest rock so the ship turns toward it anyway
    let d0 = 1e9; for (const r of st.rocks) { const dx = wd(r[0] - s.x, WW), dy = wd(r[1] - s.y, WH), d = Math.hypot(dx, dy); if (d < d0) { d0 = d; tgt = Math.atan2(dy, dx); } }
    if (tgt !== null && d0 > 420) tgt = null;
  }
  return { move, aim: tgt };
}
// advance a delayed snapshot by dt seconds of straight-line motion (how well a player anticipates)
function extrapolate(st, dt) {
  if (dt <= 0) return st;
  const W = st.WW, H = st.WH, mv = a => a.map(o => { const n = o.slice(); n[0] = ((o[0] + o[2] * dt) % W + W) % W; n[1] = ((o[1] + o[3] * dt) % H + H) % H; return n; });
  return { ...st, rocks: mv(st.rocks), enemies: mv(st.enemies), ebul: mv(st.ebul), ship: { ...st.ship, x: ((st.ship.x + st.ship.vx * dt) % W + W) % W, y: ((st.ship.y + st.ship.vy * dt) % H + H) % H } };
}

async function runOne(browser, url, job) {
  const T = TIERS[job.tier], r = rng(job.seed);
  const { ctx, page, errors, cdp } = await newPage(browser, 390, 844, 'dark');
  await ctx.addInitScript(seed => { let a = seed >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }, job.seed * 7919 + 13);
  await page.goto(url); await sleep(700);
  const H = new Hands(cdp); const b = await center(page, '#bStart'); await H.tap(b.x, b.y); await sleep(300);
  if (job.startWave > 1) await page.evaluate(w => { G.rocks = []; G.w = w - 1; G.state = 'play'; nextWave(); G.ship.invul = 2.5; }, job.startWave);
  const LA = { x: 86, y: 694 }, RA = { x: 304, y: 694 }, R = 56;
  await H.down(1, LA.x, LA.y); await sleep(30); await H.down(2, RA.x, RA.y);
  const buf = [], t0 = Date.now(), waves = [], res = { ...job, errors: [] };
  let lastW = -1, wStart = Date.now(), maxWaveSec = 0, decisions = 0, lives0 = null, minLives = 9, st;
  const frames = await page.evaluate(() => { window.__fc = 0; (function f() { __fc++; requestAnimationFrame(f); })(); return 0; });
  let nextDecide = 0;
  while (true) {
    st = await page.evaluate(() => { const s = window.__game.state(); s.gt = G.time; return s; });
    const now = Date.now(); buf.push({ t: now, st }); while (buf.length > 2 && now - buf[1].t > 1500) buf.shift();
    if (lives0 === null) lives0 = st.lives; minLives = Math.min(minLives, st.lives);
    if (st.w !== lastW) { if (lastW >= 0) { const sec = (now - wStart) / 1000; maxWaveSec = Math.max(maxWaveSec, sec); waves.push({ w: lastW, sec: +sec.toFixed(1) }); } lastW = st.w; wStart = now; }
    if (st.st === 'over') break;
    if ((now - t0) / 60000 > job.capMin) break;
    if ((now - wStart) / 1000 > 240) { res.stuck = { w: st.w, rocks: st.rocks.length, waveState: st.waveState }; break; }
    if (now < nextDecide) { await sleep(Math.min(10, nextDecide - now)); continue; }
    // what the player "sees": the snapshot from `react` ms ago, partially extrapolated
    const react = Math.max(16, T.react[0] + gauss(r) * T.react[1]);
    let seen = buf[0]; for (const e of buf) if (now - e.t >= react) seen = e;
    const view = extrapolate(seen.st, ((now - seen.t) / 1000) * T.predict);
    let d = decide(view, T, T.tick ? 0.15 : 0.03);
    if (r() < T.randomShare) { const a = r() * 6.283; d = { move: r() < 0.3 ? [0, 0, 0] : [Math.cos(a), Math.sin(a), r() < 0.5 ? 1 : 0.5], aim: r() < 0.5 ? d.aim : r() * 6.283 }; }
    if (r() < T.mistake) { if (r() < 0.5) { const a = r() * 6.283; d.move = [Math.cos(a), Math.sin(a), 1]; } else d.aim = r() * 6.283; }
    const m = d.move[2] ? R * (d.move[2] === 1 ? 0.98 : 0.55) : 0;
    const lp = { x: LA.x + d.move[0] * m + gauss(r) * T.pos, y: LA.y + d.move[1] * m + gauss(r) * T.pos };
    const rp = d.aim === null ? { ...RA } : { x: RA.x + Math.cos(d.aim) * R * 0.8 + gauss(r) * T.pos, y: RA.y + Math.sin(d.aim) * R * 0.8 + gauss(r) * T.pos };
    await H.moveAll({ 1: lp, 2: rp }); decisions++;
    nextDecide = now + Math.max(0, T.tick + gauss(r) * T.tim);
  }
  const fin = await page.evaluate(() => ({ ...window.__game.state(), gt: G.time, fc: __fc, maxCombo: G.maxCombo }));
  const wall = (Date.now() - t0) / 1000;
  Object.assign(res, { ended: st.st === 'over' ? 'gameover' : res.stuck ? 'stuck' : 'cap', wave: st.w, score: st.score, lives: st.lives, minLives, kills: fin.kills,
    acc: Math.round(fin.hits / Math.max(1, fin.shots) * 100), maxCombo: fin.maxCombo, wallSec: Math.round(wall), gameSec: Math.round(fin.gt), fps: +(fin.fc / wall).toFixed(1), decisions, maxWaveSec: +maxWaveSec.toFixed(0), waves,
    errors: errors.slice() });
  await ctx.close();
  return res;
}

(async () => {
  const filter = process.argv[2] || '';
  const jobs = [];
  const add = (tier, n, capMin, startWave = 1, base = 0) => { for (let i = 0; i < n; i++) jobs.push({ id: `${tier}-w${startWave}-${i + 1}`, tier, seed: base + i + 1 + Object.keys(TIERS).indexOf(tier) * 100 + startWave * 1000, capMin, startWave }); };
  add('clumsy', 5, 4); add('casual', 5, 5); add('skilled', 3, 6); add('world', 3, 6); add('superhuman', 2, 6);
  for (const w of [13, 20]) add('skilled', 1, 2.5, w);
  for (const w of [16, 20, 30]) { add('world', 1, 2.5, w); add('superhuman', 1, 2.5, w); }
  const todo = jobs.filter(j => j.id.includes(filter));
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { runs: [] };
  const S = await serve(), browser = await launch();
  let qi = 0;
  const worker = async () => { while (qi < todo.length) { const j = todo[qi++]; const res = await runOne(browser, S.url, j).catch(e => ({ ...j, crash: String(e) }));
    prev.runs = prev.runs.filter(x => x.id !== res.id).concat([res]); fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
    console.log(res.id, res.ended, 'wave', res.wave, 'score', res.score, 'lives', res.lives, 'acc', res.acc, 'wall', res.wallSec, 'game', res.gameSec, 'fps', res.fps, 'err', (res.errors || []).length, res.crash || ''); } };
  await Promise.all([worker(), worker()]);
  await browser.close(); S.srv.close();
})();
