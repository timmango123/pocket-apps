// 星軌跳躍 (orbit-hop) — five skill-tier simulated players (see ../SPEC.md).
// Reuses apps/orbit-hop/demo/bot.js: the plan comes from window.__game.botPlan(delayMs), a read-only planner
// that only uses the state as it was delayMs ago; the tap is a real CDP touch with tier timing jitter.
// Superhuman: botPlan(0) (current state, exact physics), latency-compensated, frame-aligned.
// usage: node bot.js [tiers] [runs]
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const URL = 'file://' + path.resolve(DIR, '../../../apps/orbit-hop/index.html');
const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  rand: 0.5,  runs: 5, capJumps: 80 },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  rand: 0.15, runs: 5, capJumps: 80 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  rand: 0,    runs: 5, capJumps: 80 },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, rand: 0,    runs: 3, capJumps: 80 },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     rand: 0,    runs: 3, capJumps: 80 },
};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
const DEATH = { 2: 'black hole', 3: 'asteroid', 4: 'lost in space' };

(async () => {
  const browser = await chromium.launch();
  const outFile = path.join(DIR, 'results.json');
  let out = { game: 'orbit-hop', tiers: {}, findings: [] };
  try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  const tierArg = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
  for (const tierId of tierArg) {
    const T = TIERS[tierId], tierIdx = Object.keys(TIERS).indexOf(tierId);
    const runs = (out.tiers[tierId] && out.tiers[tierId].runs) || [];
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(URL); await sleep(600);
    // read-only diagnostics: log pointerdowns and launches as the page sees them
    await page.evaluate(() => { window.__pd = []; window.__ln = []; let last = null;
      document.getElementById('cv').addEventListener('pointerdown', () => { const s = __game.state(); __pd.push([+performance.now().toFixed(1), s.astro.st, s.astro.pi, +s.T.toFixed(3)]); if (__pd.length > 8) __pd.shift(); }, true);
      (function poll() { const s = __game.state(); if (s.lastLaunchWall !== last) { last = s.lastLaunchWall; __ln.push([+s.lastLaunchWall.toFixed(1), s.astro.pi, +s.lastLaunchT.toFixed(3)]); if (__ln.length > 8) __ln.shift(); } requestAnimationFrame(poll); })(); });
    const cdp = await ctx.newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); };
    let comp = 0; // learned send->launch offset (ms), like the demo bot
    for (let run = runs.length; run < (+process.argv[3] || T.runs); run++) {
      const rnd = mulberry32(0x0B17 + tierIdx * 4243 + run * 17);
      const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
      const seed = 1000 + run; // same 5 worlds for every tier
      // start/reset each run through the seeded start hook (allowed by SPEC: start/select/reset)
      await page.evaluate(s => __game.start(s), seed);
      await sleep(300);
      const t0 = Date.now(); const errsT = []; let lastTap = null; let kinds = { aimed: 0, unaimed: 0, mistake: 0 };
      while (true) {
        const st = await page.evaluate(() => __game.state());
        if (st.mode !== 'play') break;
        if (st.jumps >= T.capJumps || Date.now() - t0 > 240000) break;
        const react = tierId === 'superhuman' ? 0 : Math.max(100, T.react[0] + gauss() * T.react[1]);
        // botPlan only scans forward from the snapshot, so a window already in progress at the snapshot is cut short and its
        // 'centre' drifts late; plan from a snapshot >= 700 ms old (still exact physics, and never newer than the tier's reaction)
        const look = Math.max(react, 700);
        let plan = await page.evaluate(d => __game.botPlan(d), look); let recvAt = Date.now();
        const pageNow = () => plan.now + (Date.now() - recvAt); // page clock estimate (fixes the demo bot using a stale plan.now)
        // a delayed snapshot can still show the previous planet: only act on a plan for the planet we are on now
        if (!plan || plan.pi !== st.astro.pi) { await sleep(10); continue; }
        // keep tracking (re-plan from the always-delayed snapshot) until the tap is close
        const tPlan = Date.now();
        while (plan && plan.wall - pageNow() - comp > 70 && Date.now() - tPlan < 8000) {
          await sleep(Math.min(plan.wall - pageNow() - comp - 50, 120));
          const p2 = await page.evaluate(d => __game.botPlan(d), look); if (!p2 || p2.pi !== st.astro.pi || Math.abs(p2.wall - plan.wall) > 60) break; plan = p2; recvAt = Date.now();
        }
        if (!plan) continue;
        let off = gauss() * T.tim; const u = rnd(); let kind = 'aimed';
        if (u < T.mistake) { kind = 'mistake'; off += (rnd() - 0.5) * 800; }
        else if (u < T.mistake + T.rand) { kind = 'unaimed'; off += (rnd() - 0.5) * 300; }
        kinds[kind]++;
        await sleep(plan.wall - pageNow() - comp + off);
        const sentAt = +pageNow().toFixed(1);
        await tap(195 + gauss() * T.pos, 640 + gauss() * T.pos);
        let s2;
        for (let k = 0; k < 400; k++) { await sleep(10); s2 = await page.evaluate(() => __game.state()); if (s2.mode !== 'play' || s2.astro.pi !== st.astro.pi || (s2.astro.st === 'orbit' && s2.astro.since > 0.2 && s2.lastLaunchT < plan.tg - 1)) break; }
        lastTap = { sentAtPage: sentAt, plannedWall: +plan.wall.toFixed(1), pi: st.astro.pi, windowMs: Math.round(plan.width * 1000), intendedOffMs: Math.round(off), kind, launchErrMs: s2 && s2.lastLaunchT !== st.lastLaunchT ? Math.round((s2.lastLaunchT - plan.tg) * 1000) : null, comp: Math.round(comp) };
        if (s2 && s2.lastLaunchT !== st.lastLaunchT && Math.abs(s2.lastLaunchT - plan.tg) < 0.4) {
          const e = (s2.lastLaunchT - plan.tg) * 1000; errsT.push({ e: e - off, w: plan.width * 1000 });
          if (kind === 'aimed') comp = comp * 0.8 + (e - off) * 0.2;
        }
        if (s2 && s2.mode !== 'play') break;
      }
      await sleep(1300);
      const st = await page.evaluate(() => __game.state());
      const diag = st.mode === 'play' ? null : await page.evaluate(() => ({ pointerdowns: __pd.slice(-4), launches: __ln.slice(-4) }));
      const mErr = errsT.length ? errsT.reduce((a, b) => a + b.e, 0) / errsT.length : null;
      const res = { run, seed, score: st.score, jumps: st.jumps, perfects: st.perfects, maxCombo: st.maxCombo, dust: st.dust,
        ended: st.mode === 'play' ? 'cap ' + T.capJumps + ' jumps' : (st.lastDeath ? DEATH[st.lastDeath.kind] || String(st.lastDeath.kind) : st.mode), deathAtPlanet: st.lastDeath ? st.lastDeath.pi : null,
        taps: kinds, harnessTimingErrMs: mErr == null ? null : +mErr.toFixed(1), fatalTap: st.mode === 'play' ? null : lastTap, diag, minWindowMs: errsT.length ? Math.round(Math.min(...errsT.map(x => x.w))) : null, wallSec: +((Date.now() - t0) / 1000).toFixed(1) };
      console.log(tierId, JSON.stringify(res));
      runs.push(res);
      out.tiers[tierId] = { runs, summary: {}, pageErrors: errors }; fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    }
    await ctx.close();
  }
  await browser.close();
})();
