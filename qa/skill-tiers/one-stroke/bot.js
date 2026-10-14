// 一筆繪境 (one-stroke) — five skill-tier simulated players (see ../SPEC.md).
// Real headless Chromium, mobile context, real touch input via CDP Input.dispatchTouchEvent.
// Reads state through window.__game (what a human sees on screen); acts only by touch.
// Puzzle-time compression: the game has no time pressure, so human waits (reaction, thinking,
// stroke speed) are tracked as *virtual human time* and slept at 1/SCALE in real time.
// usage: node bot.js [tier,tier...] [levels]
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const { solve, decode, mulberry32 } = require('./solver');   // copy of apps/one-stroke/demo/solver.js
const { mentalSolve } = require('./mind');
const DIR = __dirname;
const URL = 'file://' + path.resolve(DIR, '../../../apps/one-stroke/index.html');
const html = fs.readFileSync(path.resolve(DIR, '../../../apps/one-stroke/index.html'), 'utf8');
const LEVELS = JSON.parse(html.match(/const LEVELS = (\[[\s\S]*?\n\]);/)[1]);

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  rand: 0.5,  attempts: 5, think: [900, 400], cellMs: 380, mode: 'greedy', hintAfter: 3 },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  rand: 0.15, attempts: 3, think: [550, 200], cellMs: 290, mode: 'greedy', hintAfter: 6 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  rand: 0,    attempts: 3, nodeMs: 60, prune: 'weak', cellMs: 220, mode: 'search' },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, rand: 0,    attempts: 3, nodeMs: 15, prune: 'full', cellMs: 150, mode: 'search' },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     rand: 0,    attempts: 3, nodeMs: 0, cellMs: 16, mode: 'exact' },
};
const CAP_MS = 4 * 60 * 1000;            // virtual human time per attempt before giving up
const SCALE = 30;                         // real sleep = virtual / SCALE (superhuman: real time)
const tierArg = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
const levels = (process.argv[3] || '1,10,25,50,75,99,100').split(',').map(Number);

(async () => {
  const browser = await chromium.launch();
  const outFile = path.join(DIR, 'results.json');
  let out = { game: 'one-stroke', tiers: {}, findings: [] };
  try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  for (const tierId of tierArg) {
    const T = TIERS[tierId];
    const seed = 0x51ED + Object.keys(TIERS).indexOf(tierId) * 1013;
    const rnd = mulberry32(seed);
    const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
    const sampleMs = ([m, s]) => Math.max(16, m + gauss() * s);
    const prevRuns = (out.tiers[tierId] && out.tiers[tierId].runs) || [];
    const runs = prevRuns.filter(r => levels.includes(r.level) || true);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(URL); await page.waitForTimeout(600);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    let vt = 0; // virtual human ms in current attempt
    const wait = async ms => { vt += ms; const real = tierId === 'superhuman' ? ms : ms / SCALE; if (real >= 2) await new Promise(r => setTimeout(r, real)); };
    const state = () => page.evaluate(() => __game.state());
    const tapAt = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd', 0, 0); };
    const tapBtn = async id => {
      const b = await page.locator('#' + id).boundingBox();
      await wait(sampleMs(T.react));
      await tapAt(b.x + b.width / 2 + gauss() * T.pos, b.y + b.height / 2 + gauss() * T.pos);
      await page.waitForTimeout(20);
    };

    for (const L of levels) {
      if (runs.some(r => r.level === L)) continue;
      const lv = decode(LEVELS[L - 1]);
      const N = lv.W * lv.H;
      const wallSet = new Set(lv.walls.map(([a, b]) => a < b ? a * 1024 + b : b * 1024 + a));
      const cpNum = new Int16Array(N); lv.cps.forEach((c, i) => cpNum[c] = i + 1);
      const total = Array.from(lv.open).filter(Boolean).length, end = lv.cps[lv.cps.length - 1];
      const nbrs = c => { const x = c % lv.W, y = (c / lv.W) | 0, r = [];
        if (y > 0) r.push(c - lv.W); if (x < lv.W - 1) r.push(c + 1); if (y < lv.H - 1) r.push(c + lv.W); if (x > 0) r.push(c - 1);
        return r.filter(n => lv.open[n] && !wallSet.has(c < n ? c * 1024 + n : n * 1024 + c)); };
      const legal = p => {
        const h = p[p.length - 1]; if (h === end) return [];
        let nx = 1; for (const c of p) if (cpNum[c]) nx = cpNum[c] + 1;
        const inP = new Set(p);
        return nbrs(h).filter(n => !inP.has(n) && (!cpNum[n] || cpNum[n] === nx) && (n !== end || p.length === total - 1));
      };
      const freeDeg = (n, p) => { const inP = new Set(p); inP.add(n); return nbrs(n).filter(m => !inP.has(m)).length; };
      let cleared = false, attempt = 0; const att = [];
      const prevFailedAll = runs.length && !runs[runs.length - 1].cleared;
      const maxAtt = prevFailedAll ? Math.min(2, T.attempts) : T.attempts; // budget: tier already gave up on the previous level
      while (!cleared && attempt < maxAtt) {
        attempt++; vt = 0;
        await page.evaluate(l => __game.start(l), L); // start/reset level (allowed hook)
        await page.waitForTimeout(250);
        const centers = await page.evaluate(n => Array.from({ length: n }, (_, c) => __game.cellCenter(c)), N);
        const cellPx = await page.evaluate(() => __game.cellSize());
        const hints0 = (await state()).hintsLeft; // hint count now scales with board size (was always 3)
        let stats = { strokes: 0, moves: 0, deadEnds: 0, corrections: 0, hints: 0, misTouches: 0, nodes: 0 };
        // drag a stroke through `cells` starting at the current head
        const stroke = async (head, cells, posSigma) => {
          stats.strokes++;
          const jit = () => gauss() * posSigma;
          let p = { x: centers[head].x + gauss() * posSigma * 0.5, y: centers[head].y + gauss() * posSigma * 0.5 };
          await wait(sampleMs(T.react));
          await touch('touchStart', p.x, p.y);
          for (const c of cells) {
            const q = { x: centers[c].x + jit() * 0.5, y: centers[c].y + jit() * 0.5 };
            const dur = tierId === 'superhuman' ? 16 : T.cellMs * (0.85 + rnd() * 0.3);
            const SUB = 2; for (let s = 1; s <= SUB; s++) { const f = s / SUB; await touch('touchMove', p.x + (q.x - p.x) * f, p.y + (q.y - p.y) * f); await wait(dur / SUB); }
            p = q; stats.moves++;
          }
          await touch('touchEnd', 0, 0);
          await page.waitForTimeout(tierId === 'superhuman' ? 16 : 8);
        };
        // bring the on-screen path back to `want` (a prefix) by tapping cells / undo
        const fixTo = async want => {
          for (let k = 0; k < 6; k++) {
            const s = await state(); const pth = s.path;
            let i = 0; while (i < pth.length && i < want.length && pth[i] === want[i]) i++;
            if (i === pth.length && i <= want.length) return pth;            // on-screen is a prefix of what we want
            stats.corrections++;
            if (i === 0) { await tapBtn('bReset'); continue; }
            if (pth.length - i <= 2) { await tapBtn('bUndo'); continue; }
            const c = pth[i - 1]; await wait(sampleMs(T.react));
            await tapAt(centers[c].x + gauss() * T.pos, centers[c].y + gauss() * T.pos);
            await page.waitForTimeout(10);
          }
          return (await state()).path;
        };
        const sol0 = lv.sol;
        let plan = null; // full intended path for search/exact tiers
        if (T.mode === 'exact') { const r = solve(lv, 1, 5e7, 1); plan = r.sols[0]; stats.nodes = r.nodes; }
        else if (T.mode === 'search') {
          const budget = Math.floor(CAP_MS / T.nodeMs);
          const r = mentalSolve(lv, T.prune, budget, rnd);
          stats.nodes = r.nodes; await wait(r.nodes * T.nodeMs);
          plan = r.path; // null => gave up thinking (cap)
        }
        let ghost = [];
        const t0 = Date.now();
        while (vt < CAP_MS && Date.now() - t0 < 60000) {
          let s = await state();
          if (s.won) { cleared = true; break; }
          if (!plan && T.mode !== 'greedy') break;
          if (plan) {
            const pth = s.path.length ? await fixTo(plan) : [];
            if (!pth.length) { // first touch on seal ①, then the rest
              const chunk = tierId === 'superhuman' ? plan.length - 1 : 6;
              await stroke(plan[0], plan.slice(1, 1 + chunk), T.pos);
            } else {
              const rest = plan.slice(pth.length);
              const chunk = tierId === 'superhuman' ? rest.length : 6;
              // rare wrong turn (mistake): drag into a different legal cell first
              let cells = rest.slice(0, chunk);
              if (rnd() < T.mistake) { const lg = legal(pth).filter(n => n !== rest[0]); if (lg.length) { cells = [lg[(rnd() * lg.length) | 0]]; } }
              await stroke(pth[pth.length - 1], cells, T.pos);
            }
            continue;
          }
          // ---------- greedy online player (casual / clumsy) ----------
          let pth = s.path;
          if (!pth.length) { await stroke(lv.cps[0], [], T.pos); s = await state(); if (!s.path.length) stats.misTouches++; continue; }
          if (ghost.length) { // follow the hint ghost (visible on screen)
            let k = 0; while (k < ghost.length && pth.includes(ghost[k])) k++;
            ghost = ghost.slice(k);
          }
          let next;
          const lg = legal(pth);
          if (!lg.length) {
            stats.deadEnds++;
            await wait(sampleMs(T.think) * 2); // realise it's stuck
            if (stats.deadEnds % T.hintAfter === 0 && s.hintsLeft > 0) {
              await tapBtn('bHint'); stats.hints = hints0 - (await state()).hintsLeft;
              const ns = await state(); const sol = sol0; let k = 0; while (k < ns.path.length && ns.path[k] === sol[k]) k++;
              ghost = []; for (let i = k; i < sol.length && ghost.length < 6; i++) { ghost.push(sol[i]); if (cpNum[sol[i]] && ghost.length >= 3) break; }
              continue;
            }
            const back = rnd() < 0.15 ? 0 : Math.max(1, pth.length - 2 - ((rnd() * 7) | 0));
            if (back === 0) await tapBtn('bReset');
            else { await fixTo(pth.slice(0, back)); }
            continue;
          }
          await wait(sampleMs(T.think));
          if (ghost.length && lg.includes(ghost[0])) next = ghost[0];
          else if (rnd() < T.rand || rnd() < T.mistake) next = lg[(rnd() * lg.length) | 0];
          else { // 1-step greedy: Warnsdorff (fewest onward options), seal cells first
            const sc = n => (cpNum[n] ? -10 : 0) + freeDeg(n, pth) + rnd() * 0.5;
            next = lg.slice().sort((a, b) => sc(a) - sc(b))[0];
          }
          const cells = [next];
          await stroke(pth[pth.length - 1], cells, T.pos);
          const after = (await state()).path;
          if (after[after.length - 1] !== next || after.length !== pth.length + 1) await fixTo(pth.concat([next]));
        }
        const s = await state();
        if (s.won) cleared = true;
        await page.waitForTimeout(cleared ? 1700 : 100);
        const s2 = await state();
        const res = { attempt, cleared, humanSec: +(vt / 1000).toFixed(1), gameTimerSec: +(s.time / 1000).toFixed(1),
          stars: cleared ? (s.hintsLeft === hints0 ? 3 : s.hintsLeft === hints0 - 1 ? 2 : 1) : 0, hintsUsed: hints0 - s.hintsLeft,
          pathLen: s.path.length, total, resultShown: s2.resultShown, ...stats };
        if (!cleared) res.reason = (!plan && T.mode !== 'greedy') ? 'mental search exceeded 4-min cap' : vt >= CAP_MS ? '4-min human-time cap' : '60-s wall budget';
        att.push(res);
      }
      const run = { level: L, size: lv.W + 'x' + lv.H, cells: total, cleared, attempts: attempt, attemptLog: att };
      console.log(tierId, JSON.stringify({ L, cleared, attempts: attempt, last: att[att.length - 1] }));
      runs.push(run); runs.sort((a, b) => a.level - b.level);
      out.tiers[tierId] = { runs, summary: {} }; fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    }
    await ctx.close();
    const cl = runs.filter(r => r.cleared);
    out.tiers[tierId] = { runs, summary: {
      cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), failedLevels: runs.filter(r => !r.cleared).map(r => r.level),
      firstTryClears: runs.filter(r => r.cleared && r.attempts === 1).length,
      avgHumanSecOnClears: cl.length ? +(cl.reduce((a, r) => a + r.attemptLog[r.attemptLog.length - 1].humanSec, 0) / cl.length).toFixed(1) : null,
      totalHintsUsed: runs.reduce((a, r) => a + r.attemptLog.reduce((b, x) => b + x.hintsUsed, 0), 0),
      pageErrors: errors } };
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  }
  await browser.close();
})();
