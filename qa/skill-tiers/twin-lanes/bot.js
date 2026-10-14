// 雙軌疾行 (twin-lanes) — five skill-tier simulated players (see ../SPEC.md).
// Real headless Chromium, mobile context; steering = real CDP touches on the left/right half of the canvas.
// Perception reuses apps/twin-lanes/demo/bot.js logic (nearest row per side, seen REACT ms ago).
// Superhuman: perfect information (knows where swapping objects will end), frame-perfect, and farms the
// "驚險" near-miss bonus by sitting in a hazard lane and leaving ~0.1 s before impact.
// usage: node bot.js [tiers] [runs] ; node bot.js blurtest
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const URL = 'file://' + path.resolve(DIR, '../../../apps/twin-lanes/index.html');
const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  rand: 0.5,  runs: 5, cap: 150 },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  rand: 0.15, runs: 5, cap: 150 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  rand: 0,    runs: 5, cap: 150 },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, rand: 0,    runs: 3, cap: 150 },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     rand: 0,    runs: 3, cap: 150 },
};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));
function seedPage(seed) { let a = seed >>> 0; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const mobile = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

// rows of one side, nearest first: [{p, objs:[...]}]
function rows(snap, side) {
  const os = snap.objs.filter(o => o.side === side && o.p < 1).sort((a, b) => b.p - a.p), out = [];
  for (const o of os) { const r = out.find(r => Math.abs(r.p - o.p) < 0.005); if (r) r.objs.push(o); else out.push({ p: o.p, objs: [o] }); }
  return out;
}
// lane needed for a row given the lanes as currently displayed (human) or final (oracle)
function need(row, finalLanes) {
  const lane = o => finalLanes && o.swapAt > 0 && !o.swapped ? 1 - o.lane : o.lane;
  const c = row.objs.find(o => o.kind !== 's');
  return c ? lane(c) : 1 - lane(row.objs[0]);
}

async function blurTest(browser) {
  const ctx = await browser.newContext(mobile); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL); await sleep(500);
  await page.evaluate(() => { window.__vis = []; document.addEventListener('visibilitychange', () => __vis.push(document.visibilityState)); });
  await page.tap('#startBtn'); await sleep(250);
  const r = {};
  // 1) blur without a visibility change (window + document), as fired by stray focus changes / hub iframe
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('blur')); });
  await sleep(150); r.afterBlur = await page.evaluate(() => ({ state: __game.getState().state, t: +__game.getState().t.toFixed(2) }));
  await sleep(150); r.timeAdvancesAfterBlur = await page.evaluate(t0 => __game.getState().t > t0, r.afterBlur.t);
  // 2) focus moves to another tab of the same browser (headless keeps both visible)
  const p2 = await ctx.newPage(); await p2.goto('about:blank'); await p2.bringToFront(); await sleep(150);
  r.afterOtherTabFocused = await page.evaluate(() => ({ state: __game.getState().state, vis: document.visibilityState, visEvents: __vis.slice() }));
  await page.bringToFront(); await p2.close();
  // 3) a real visibilitychange to hidden must still pause
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(100); r.afterHidden = await page.evaluate(() => __game.getState().state);
  await page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(100); r.afterVisibleAgain = await page.evaluate(() => __game.getState().state);
  r.pageErrors = errs; await ctx.close();
  return r;
}

(async () => {
  const browser = await chromium.launch();
  const outFile = path.join(DIR, 'results.json');
  let out = { game: 'twin-lanes', tiers: {}, findings: [] };
  try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  if (process.argv[2] === 'blurtest') { out.blurTest = await blurTest(browser); console.log(JSON.stringify(out.blurTest)); fs.writeFileSync(outFile, JSON.stringify(out, null, 1)); await browser.close(); return; }
  const tierArg = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
  for (const tierId of tierArg) {
    const T = TIERS[tierId], tierIdx = Object.keys(TIERS).indexOf(tierId);
    const runs = (out.tiers[tierId] && out.tiers[tierId].runs) || [];
    for (let run = runs.length; run < (+process.argv[3] || T.runs); run++) {
      const rnd = mulberry32(0x7A1 + tierIdx * 977 + run * 31);
      const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
      const ctx = await browser.newContext(mobile);
      await ctx.addInitScript(seedPage, 9000 + run); // same 5 worlds for every tier
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
      await page.goto(URL); await sleep(500);
      const cdp = await ctx.newCDPSession(page);
      const box = await page.locator('canvas').first().boundingBox();
      const tapSide = async side => {
        const x = box.x + box.width * (side ? 0.75 : 0.25) + gauss() * T.pos, y = box.y + box.height * 0.7 + gauss() * T.pos;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
        cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {});
        return x < box.x + box.width / 2 ? 0 : 1;
      };
      await page.tap('#startBtn');
      const hist = []; const react = tierId === 'superhuman' ? 16 : Math.max(120, T.react[0] + gauss() * T.react[1]);
      const rowPlan = new Map(); // row key -> {wrong, extraDelay}
      const lock = [0, 0], pend = [null, null];
      let taps = 0, wrongSide = 0, s;
      const w0 = Date.now();
      while (true) {
        const now = Date.now();
        s = await page.evaluate(() => window.__game.getState());
        if (s.state !== 'play' || s.deathT >= 0 || s.t > T.cap) break;
        hist.push({ now, s });
        while (hist.length > 2 && hist[1].now <= now - react) hist.shift();
        const seen = tierId === 'superhuman' ? s : (hist[0].now <= now - react ? hist[0].s : null);
        if (!seen) { await sleep(3); continue; }
        for (const side of [0, 1]) {
          if (pend[side] && now < pend[side].at) continue;
          if (pend[side]) { const p = pend[side]; pend[side] = null; if (s.lanes[side] !== p.want) { taps++; const got = await tapSide(side); if (got !== side) wrongSide++; lock[side] = now + 90; } continue; }
          if (now < lock[side]) continue;
          const rs = rows(seen, side); if (!rs.length) continue;
          let want;
          if (tierId === 'superhuman') {
            const r0 = rs[0], tArr = (1 - r0.p) / s.speed, req = need(r0, true), hasSq = r0.objs.some(o => o.kind === 's');
            const sq = r0.objs.find(o => o.kind === 's'); const sqLane = sq ? (sq.swapAt > 0 && !sq.swapped ? 1 - sq.lane : sq.lane) : null;
            // farm the near-miss: wait in the hazard lane, leave 0.10 s before impact (needs the previous row resolved)
            if (hasSq && tArr > 0.19 && !process.env.NOFARM) want = sqLane; else want = req; // leave ~0.15 s before impact (inside the 0.2 s 驚險 window) after ~40 ms delivery
            if (want !== s.lanes[side]) { taps++; if (process.env.DBG) console.error('tap', s.t.toFixed(3), 'side', side, 'lane', s.lanes[side], '->', want, 'r0', JSON.stringify(r0.objs.map(o => [o.kind, o.lane, +o.p.toFixed(3), o.swapAt > 0 ? (o.swapped ? 'sw' : 'will') : ''])), 'tArr', tArr.toFixed(3)); await tapSide(side); lock[side] = now + 60; }
            continue;
          }
          const r0 = rs[0], key = side + ':' + r0.objs.map(o => o.id).join(',');
          if (!rowPlan.has(key)) { const u = rnd(); rowPlan.set(key, { wrong: u < T.mistake, extra: u < T.mistake + T.rand ? rnd() * 350 : 0, seenAt: now }); }
          const pl = rowPlan.get(key);
          want = need(r0, false); if (pl.wrong) want = 1 - want;
          if (now - pl.seenAt < pl.extra) continue; // hesitation
          if (want !== s.lanes[side]) pend[side] = { at: now + Math.abs(gauss()) * T.tim, want };
        }
        await sleep(2);
      }
      if (process.env.DBG) console.error('END', JSON.stringify(s));
      await sleep(900);
      const fin = await page.evaluate(() => window.__game.getState());
      const res = { run, worldSeed: 9000 + run, gameSec: +Math.min(s.t, T.cap).toFixed(1), score: fin.score, capped: s.t > T.cap, death: fin.deathInfo, taps, wrongSideTaps: wrongSide,
        reactionMs: Math.round(react), wallSec: +((Date.now() - w0) / 1000).toFixed(1), errors };
      console.log(tierId, JSON.stringify(res));
      runs.push(res);
      out.tiers[tierId] = { runs, summary: {} }; fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
      await ctx.close();
    }
  }
  await browser.close();
})();
