// Skill-tier bot for warehouse-command (倉儲指揮所). Management sim: forklifts auto-pick by default; the player
// dispatches (roster tap -> tap rack/dock/charger), adds/removes forklifts and reacts to bottleneck alerts.
// Usage: node bot.js [tier|auto ...]   -> results.json   ("auto" = baseline, no input at all)
// Scenario per run (3 sim-hours): A rate 120/h (normal) -> B rate 360/h (overload) -> C rate 120/h (recovery).
// The rate slider is scenario setup (set via its input event, like choosing a level); everything the player does is
// real CDP touch on canvas/buttons. Time is lock-stepped: rAF and performance.now() are virtualised so the sim
// advances only when the bot steps it (frames of 100 ms = the game's dt cap, 1x speed). Bots READ window.__wc and
// the alert/KPI DOM (what is on screen) through a reaction-time delay.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const GAME = '/mnt/project-files/apps/warehouse-command/index.html';
const FR = 0.1; // game seconds per frame
const PHASE_S = +(process.env.PHASE || 360); // 1 sim hour = 360 game seconds at 1x

const TIERS = {
  auto:       { react: [0, 0], pos: 0, mistake: 0, random: 0, maxF: 5, think: 1e9, passive: true },
  clumsy:     { react: [650, 200], pos: 40, mistake: 0.15, random: 0.5, maxF: 8, think: 4, events: true },
  casual:     { react: [400, 100], pos: 20, mistake: 0.06, random: 0.15, maxF: 8, think: 3 },
  skilled:    { react: [260, 50], pos: 10, mistake: 0.02, random: 0, maxF: 10, think: 1.5 },
  world:      { react: [180, 25], pos: 4, mistake: 0.003, random: 0, maxF: 12, think: 0.8 },
  superhuman: { react: [16, 0], pos: 0, mistake: 0, random: 0, maxF: 12, think: 0.1, perfect: true },
};

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const INIT = seed => `(() => {
  const q = []; let t = 1000;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => t;
  // seeded Math.random so the warehouse demand is identical for every tier
  let a = ${seed}; Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  window.__vt = { step(n) { for (let i = 0; i < n; i++) { t += ${FR * 1000}; const c = q.splice(0); for (const f of c) f(t); } return t; } };
  let hid = false;
  Object.defineProperty(Document.prototype, 'hidden', { get() { return hid; }, configurable: true });
  Object.defineProperty(Document.prototype, 'visibilityState', { get() { return hid ? 'hidden' : 'visible'; }, configurable: true });
  window.__setHidden = h => { hid = h; document.dispatchEvent(new Event('visibilitychange')); };
  try { localStorage.setItem('wc-muted', 'true'); localStorage.removeItem('wc-rate'); } catch (e) {}
})();`;

async function newPage(browser, seed) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(GAME, 'utf8') + '</body></html>';
  await ctx.route('**/*', r => r.request().url().startsWith('http://game.test/') ? r.fulfill({ body: html, contentType: 'text/html' }) : r.abort());
  await ctx.addInitScript(INIT(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://game.test/');
  await page.evaluate(() => __vt.step(3));
  return { ctx, page, cdp, errors };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i, radiusX: 8, radiusY: 8, force: 1 })) });

// read what is on screen
const READ = () => {
  const k = id => (document.getElementById(id).textContent || '').replace(/[^\d.]/g, '');
  const top = document.getElementById('top').getBoundingClientRect().bottom, bot = document.getElementById('cmd').getBoundingClientRect().top;
  return {
    simT: __wc.simT, shipped: __wc.shipped, thr: +k('vThr'), fill: +k('vFill'), back: +k('vBack'),
    alerts: [...document.querySelectorAll('#alertList button')].map(b => ({ key: b.dataset.key, level: b.className, text: b.textContent })),
    toast: document.getElementById('toast').textContent,
    view: { top, bot, w: innerWidth, z: __wc.cam.z },
    fl: __wc.forklifts.map(f => ({ id: f.id, x: +f.x.toFixed(2), y: +f.y.toFixed(2), cur: f.cur, state: f.state, battery: +f.battery.toFixed(1), auto: f.auto, job: f.job ? f.job.type : null, carry: f.carry, wait: +f.wait.toFixed(2), ghost: f.ghost })),
    racks: __wc.racks.map(r => ({ i: r.i, x: r.x, y: r.y, name: r.name, stock: r.stock, demand: r.demand, restocking: r.restocking })),
    orders: __wc.orders.length,
  };
};

async function runTier(browser, tierId, T, seed) {
  const r = rng(seed * 7 + tierId.length);
  const env = await newPage(browser, seed); const { page, cdp } = env;
  let gameT = 0;
  const step = async n => { await page.evaluate(n => __vt.step(n), n); gameT += n * FR; };
  const tap = async (x, y, hold = 2) => { await touch(cdp, 'touchStart', [{ x, y }]); await step(hold > 0 ? 1 : 0); await touch(cdp, 'touchEnd', []); await step(1); };
  const center = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); if (!b.width) return null; return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }, sel);
  const tapEl = async (sel, noisy = true) => { const c = await center(sel); if (!c) return false; await tap(c.x + (noisy ? gauss(r) * T.pos * 0.5 : 0), c.y + (noisy ? gauss(r) * T.pos * 0.3 : 0)); return true; };
  const tileXY = (i, lift) => page.evaluate(([i, lift]) => { const [x, y] = __wc.tileScreen(i); return { x, y: y - lift * __wc.cam.z }; }, [i, lift]);
  const setRate = v => page.evaluate(v => { const e = document.getElementById('rate'); e.value = v; e.dispatchEvent(new Event('input')); }, v);
  const log = { tier: tierId, actions: { dispatchRestock: 0, charge: 0, addForklift: 0, removeForklift: 0, randomTaps: 0, mistakes: 0, pinch: 0, pan: 0, failedCmd: 0, okCmd: 0 }, phases: [], clumsy: [], toastsBad: {} };
  const history = []; // delayed view
  const react = () => Math.max(FR, (T.react[0] + gauss(r) * T.react[1]) / 1000);
  // dismiss hint and zoom out once so the whole floor is visible (all non-passive tiers do this)
  if (!T.passive) { await tapEl('#hintClose', false); for (let i = 0; i < 2; i++) await tapEl('#zOut', false); }
  await setRate(120);
  const phases = [['A normal 120/h', 120], ['B overload 360/h', 360], ['C recovery 120/h', 120]];
  let nextThink = 0, stuck = new Map(), maxStuck = { s: 0 }, maxBack = 0;
  for (const [pname, rate] of phases) {
    await setRate(rate);
    const p0 = await page.evaluate(READ); const t0 = gameT;
    let backMax = 0, stuckEpisodes = 0, backSamples = [];
    while (gameT - t0 < PHASE_S) {
      await step(1);
      const s = await page.evaluate(READ);
      history.push({ t: gameT, s }); while (history.length > 2 && history[1].t <= gameT - 1.2) history.shift();
      backMax = Math.max(backMax, s.back); if (Math.round(gameT * 10) % 100 === 0) backSamples.push(s.orders);
      // stuck detection (truth, for findings): forklift with a job not moving for 60 game-s
      for (const f of s.fl) {
        const k = f.id, prev = stuck.get(k);
        const busy = f.job && !['charging', 'picking', 'unloading', 'loading', 'stocking', 'waitIn', 'waitTruck', 'waitDock'].includes(f.state);
        if (!prev || prev.x !== f.x || prev.y !== f.y || !busy) stuck.set(k, { x: f.x, y: f.y, t: gameT, rep: false });
        else if (gameT - prev.t > 60 && !prev.rep) { prev.rep = true; stuckEpisodes++; if (gameT - prev.t > maxStuck.s) maxStuck = { s: +(gameT - prev.t).toFixed(0), f: 'F' + k, at: [f.x, f.y], state: f.state, phase: pname }; }
      }
      if (T.passive || gameT < nextThink) continue;
      nextThink = gameT + T.think * (0.6 + r() * 0.8);
      const dl = T.react[0] / 1000; let view = history[0].s; for (const h of history) if (h.t <= gameT - dl) view = h.s;
      if (T.perfect) view = s;

      // clumsy extras
      if (T.events && r() < 0.15) {
        const k = Math.floor(r() * 5);
        if (k === 0) { const a = { x: 100 + r() * 190, y: 250 + r() * 300 }; await touch(cdp, 'touchStart', [{ ...a, id: 0 }, { x: a.x + 60, y: a.y + 40, id: 1 }]); for (let i = 1; i <= 5; i++) { await touch(cdp, 'touchMove', [{ ...a, id: 0 }, { x: a.x + 60 + i * 12 * (r() < 0.5 ? -1 : 1), y: a.y + 40 + i * 9, id: 1 }]); await step(1); } await touch(cdp, 'touchEnd', []); await step(1); log.actions.pinch++; log.clumsy.push([+gameT.toFixed(0), 'random pinch']); }
        else if (k === 1) { const x = 60 + r() * 270, y = 200 + r() * 350; for (let i = 0; i < 8; i++) await tap(x + gauss(r) * 4, y + gauss(r) * 4, 0); log.clumsy.push([+gameT.toFixed(0), 'rapid taps x8']); }
        else if (k === 2) { await page.setViewportSize({ width: 844, height: 390 }); await step(10); await tap(422 + gauss(r) * 80, 200 + gauss(r) * 50); await step(20); await page.setViewportSize({ width: 390, height: 844 }); await step(5); log.clumsy.push([+gameT.toFixed(0), 'rotate 844x390, tap, rotate back']); }
        else if (k === 3) { await page.evaluate(() => __setHidden(true)); await step(30); await page.evaluate(() => __setHidden(false)); log.clumsy.push([+gameT.toFixed(0), 'background 3 s']); }
        else { const a = { x: 195, y: 420 }; await touch(cdp, 'touchStart', [a]); for (let i = 1; i <= 6; i++) { await touch(cdp, 'touchMove', [{ x: a.x + i * 15 * (r() - 0.5) * 4, y: a.y + i * 10 * (r() - 0.5) * 4 }]); await step(1); } await touch(cdp, 'touchEnd', []); await step(1); log.actions.pan++; log.clumsy.push([+gameT.toFixed(0), 'pan drag']); }
        continue;
      }
      // random (half for clumsy): tap a forklift in roster then a random point on the floor
      if (T.random && r() < T.random) {
        const f = view.fl[Math.floor(r() * view.fl.length)];
        await tapEl(`#roster .unit[data-id="${f.id}"]`); await step(Math.round(react() / FR));
        if (r() < 0.25) { await tapEl(['#bStop', '#bAuto', '#bCharge', '#bFocus'][Math.floor(r() * 4)]); }
        else await tap(40 + r() * 310, view.view.top + 30 + r() * (view.view.bot - view.view.top - 60));
        log.actions.randomTaps++;
        const tt = await page.evaluate(() => document.getElementById('toast').textContent);
        await tapEl('#roster .unit[aria-pressed="true"]'); // deselect (tap again)
        continue;
      }
      // ---- heuristic policy (greedy, per think tick) ----
      // 1) not enough forklifts for the backlog -> add (via 調度 panel)
      if (view.back >= (T.perfect ? 6 : 12) && view.fl.length < T.maxF) {
        await tapEl('#opsBtn'); await step(Math.round(react() / FR)); { let prevY = -1; for (let i = 0; i < 60; i++) { const c = await center('#addF'); if (c && Math.abs(c.y - prevY) < 0.5) break; prevY = c ? c.y : -1; await step(1); } } // wait for the panel to finish sliding (see finding: taps during the slide hit other buttons)
        if (r() < T.mistake) { await tapEl('#remF'); log.actions.mistakes++; } else { await tapEl('#addF'); log.actions.addForklift++; }
        await tapEl('#opsClose'); continue;
      }
      // re-enable manual forklifts (a clumsy stop) when an info alert says so
      const manual = view.fl.find(f => !f.auto && !f.job);
      if (manual && !T.random) { await tapEl(`#roster .unit[data-id="${manual.id}"]`); await step(1); await tapEl('#bAuto'); await tapEl(`#roster .unit[data-id="${manual.id}"]`); continue; }
      // 2) low battery not heading to charger
      const low = view.fl.find(f => f.battery < 18 && f.job !== 'charge' && f.state !== 'charging' && !f.carry);
      if (low) {
        await tapEl(`#roster .unit[data-id="${low.id}"]`); await step(Math.round(react() / FR)); await tapEl('#bCharge'); log.actions.charge++;
        await tapEl(`#roster .unit[data-id="${low.id}"]`); continue;
      }
      // 3) stock-out with waiting orders and no restock running -> send the nearest idle/auto unit to restock that rack
      const so = view.racks.filter(rk => rk.demand > rk.stock && !rk.restocking && rk.stock < 6).sort((a, b) => (b.demand - b.stock) - (a.demand - a.stock))[0];
      if (so) {
        const cand = view.fl.filter(f => !f.carry && f.state !== 'charging' && f.battery > 25 && f.job !== 'restock').sort((a, b) => (a.job ? 1 : 0) - (b.job ? 1 : 0) || (Math.abs(a.x - so.x) + Math.abs(a.y - so.y)) - (Math.abs(b.x - so.x) + Math.abs(b.y - so.y)))[0];
        if (cand) {
          await tapEl(`#roster .unit[data-id="${cand.id}"]`); await step(Math.round(react() / FR));
          let target = so.i;
          if (r() < T.mistake) { target = view.racks[Math.floor(r() * view.racks.length)].i; log.actions.mistakes++; }
          const p = await tileXY(target, 18);
          if (p.y < view.view.top + 10 || p.y > view.view.bot - 10 || p.x < 5 || p.x > view.view.w - 5) { await tapEl('#bFocus'); await step(10); }
          const p2 = await tileXY(target, 18);
          await tap(p2.x + gauss(r) * T.pos * 0.5, p2.y + gauss(r) * T.pos * 0.5);
          const tt = await page.evaluate(() => ({ t: document.getElementById('toast').textContent, bad: document.getElementById('toast').classList.contains('bad') }));
          if (tt.bad) { log.actions.failedCmd++; log.toastsBad[tt.t.replace(/\d+/g, '#')] = (log.toastsBad[tt.t.replace(/\d+/g, '#')] || 0) + 1; } else log.actions.okCmd++;
          log.actions.dispatchRestock++;
          if (await page.evaluate(() => !!__wc.selected)) await tapEl(`#roster .unit[data-id="${cand.id}"]`);
          continue;
        }
      }
    }
    const p1 = await page.evaluate(READ);
    log.phases.push({ phase: pname, shipped: p1.shipped - p0.shipped, perHour: Math.round((p1.shipped - p0.shipped) * 3600 / (p1.simT - p0.simT)), demandPerHour: rate, backlogEnd: p1.orders, backlogMax: backMax, fillKpiEnd: p1.fill, thrKpiEnd: p1.thr, forklifts: p1.fl.length, stuckEpisodes, alertsEnd: p1.alerts.map(a => a.text) });
    maxBack = Math.max(maxBack, backMax);
  }
  log.maxStuck = maxStuck;
  log.errors = env.errors.slice(0, 5);
  if (!log.clumsy.length) delete log.clumsy;
  if (process.env.SHOT) await page.screenshot({ path: path.join(OUT, 'shot-' + tierId + '.png') });
  await env.ctx.close();
  return log;
}

async function main() {
  const args = process.argv.slice(2).filter(a => TIERS[a]);
  const run = args.length ? args : Object.keys(TIERS);
  const resPath = path.join(OUT, 'results.json');
  const results = fs.existsSync(resPath) ? JSON.parse(fs.readFileSync(resPath, 'utf8')) : { game: 'warehouse-command', tiers: {}, findings: [] };
  results.harness = { viewport: '390x844@2 touch', frameS: FR, phaseGameS: PHASE_S, scenario: 'A 120/h -> B 360/h -> C 120/h, 1 sim-hour each, Math.random seeded identically per tier' };
  const browser = await chromium.launch({ args: ['--mute-audio'] });
  for (const id of run) {
    const t = Date.now();
    const runs = [];
    for (const seed of (process.env.SEEDS || '11').split(',').map(Number)) runs.push(await runTier(browser, id, TIERS[id], seed));
    const sum = k => runs.map(r => r.phases.map(p => p[k]));
    results.tiers[id] = { runs, summary: { shippedPerPhase: sum('shipped'), backlogEnd: sum('backlogEnd'), backlogMax: sum('backlogMax'), forklifts: sum('forklifts'), stuckEpisodes: sum('stuckEpisodes'), errors: runs.reduce((a, r) => a + r.errors.length, 0) } };
    console.log(id, JSON.stringify(results.tiers[id].summary), 'wall', Date.now() - t);
    fs.writeFileSync(resPath, JSON.stringify(results, null, 1));
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
