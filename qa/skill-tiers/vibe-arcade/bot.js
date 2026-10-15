// 霓虹街機 (vibe-arcade) — five skill-tier simulated players on all four machines (see ../SPEC.md).
// The game has no test hook (everything lives in a closure), so "what the player sees" is read from
// the canvas draw calls themselves: an init script records fillRect / fill / fillText of each finished
// frame (read-only instrumentation; game state and files are untouched). All actions are real CDP touches.
// usage: node bot.js [tiers] [machines] [runs]
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { performance } = require('perf_hooks');
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const URL = 'file://' + path.resolve(DIR, '../../../apps/vibe-arcade/index.html');

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15,  rand: 0.5,  span: 5,  think: [900, 350], tapGap: 450 },
  casual:     { react: [400, 100], pos: 20, tim: 60,  mistake: 0.06,  rand: 0.15, span: 7,  think: [550, 200], tapGap: 320 },
  skilled:    { react: [260, 50],  pos: 10, tim: 30,  mistake: 0.02,  rand: 0,    span: 9,  think: [330, 100], tapGap: 230 },
  world:      { react: [180, 25],  pos: 4,  tim: 12,  mistake: 0.003, rand: 0,    span: 13, think: [220, 60],  tapGap: 170 },
  superhuman: { react: [16, 0],    pos: 0,  tim: 0,   mistake: 0,     rand: 0,    span: 1e9, think: [0, 0],   tapGap: 20 },
};
const MACHINES = ['react', 'stack', 'simon', 'slide'];
const CAPS = { stackLayers: 60, simonSteps: 20, slideSec: 90 };
const tierArg = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
const machArg = (process.argv[3] || MACHINES.join(',')).split(',');
const RUNS = +(process.argv[4] || 5);
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

// ---------- in-page instrumentation (init script) ----------
function instrument(seed) {
  // seeded Math.random so runs are reproducible
  let a = seed >>> 0; Math.random = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const D = window.__draw = { cur: [], last: [], lastT: 0, frame: 0, pd: [] };
  const P = CanvasRenderingContext2D.prototype;
  const fr = P.fillRect, fi = P.fill, ft = P.fillText;
  P.fillRect = function (x, y, w, h) { if (this.canvas.id === 'scr' && h > 4 && h < 40 && typeof this.fillStyle === 'string') D.cur.push(['R', x, y, w, h, this.fillStyle]); return fr.apply(this, arguments); };
  P.fill = function () { if (this.canvas.id === 'scr' && this.shadowBlur > 0) D.cur.push(['F', this.fillStyle]); return fi.apply(this, arguments); };
  P.fillText = function (s, x, y) { if (this.canvas.id === 'scr') D.cur.push(['T', String(s), x, y, this.fillStyle]); return ft.apply(this, arguments); };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => raf(ts => { cb(ts); D.last = D.cur; D.cur = []; D.lastT = ts; D.frame++; });
  addEventListener('pointerdown', () => D.pd.push(performance.now()), true);
}
// summariser evaluated in page each poll
function see(kind) {
  const D = window.__draw, ov = document.getElementById('over');
  const sc = document.getElementById('screen').getBoundingClientRect();
  const o = { now: performance.now(), t: D.lastT, frame: D.frame, over: !ov.hidden, W: sc.width, H: sc.height, L: sc.left, Tp: sc.top, pd: D.pd.length ? D.pd[D.pd.length - 1] : null };
  if (o.over) o.score = document.getElementById('ovScore').textContent;
  const texts = D.last.filter(e => e[0] === 'T');
  if (kind === 'react') {
    const t = texts.map(e => e[1]).join('|');
    o.phase = t.includes('點！') ? 'go' : t.includes('等待綠燈') ? 'wait' : t.includes('太早了') ? 'early' : /\d+ms/.test(t) ? 'shown' : '?';
  } else if (kind === 'stack') {
    const bh = Math.round(Math.max(16, Math.min(30, o.H / 22)));
    const R = D.last.filter(e => e[0] === 'R' && Math.abs(e[4] - (bh - 2)) < 0.5);
    o.bh = bh; o.blocks = R.map(e => [e[1], e[2], e[3], e[5]]);
  } else if (kind === 'simon') {
    const f = D.last.filter(e => e[0] === 'F').map(e => e[1]);
    o.lit = f.length ? f[f.length - 1] : null;
    const m = texts.find(e => /看好順序|換你|正確|準備|按錯/.test(e[1]));
    o.msg = m ? m[1] : '';
  } else if (kind === 'slide') {
    o.tiles = texts.filter(e => /^[1-8]$/.test(e[1])).map(e => [+e[1], e[2], e[3]]);
    const m = texts.find(e => /步數|完成/.test(e[1])); o.msg = m ? m[1] : '';
  }
  return o;
}

(async () => {
  const outFile = path.join(DIR, 'results.json');
  let out = { game: 'vibe-arcade', tiers: {}, findings: [] };
  try { out = JSON.parse(fs.readFileSync(outFile, 'utf8')); } catch (e) {}
  const browser = await chromium.launch();
  for (const tierId of tierArg) {
    const T = TIERS[tierId];
    const tierIdx = Object.keys(TIERS).indexOf(tierId);
    out.tiers[tierId] = out.tiers[tierId] || { runs: [], summary: {} };
    for (const mach of machArg) {
      if (out.tiers[tierId].runs.some(r => r.machine === mach)) continue;
      const rnd = mulberry32(0xA5C0DE + tierIdx * 101 + MACHINES.indexOf(mach) * 7);
      const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
      const sampleMs = ([m, s]) => Math.max(16, m + gauss() * s);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort()); // offline: no external fonts
      await ctx.addInitScript(instrument, 1234 + tierIdx * 17 + MACHINES.indexOf(mach));
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));
      page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push('console: ' + m.text()); });
      await page.goto(URL); await sleep(700);
      const origin = await page.evaluate(() => performance.timeOrigin);
      const epoch = () => performance.timeOrigin + performance.now();
      const cdp = await ctx.newCDPSession(page);
      const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
      const tapEl = async (sel, sigma = 0) => { const b = await page.locator(sel).first().boundingBox(); await tapXY(b.x + b.width / 2 + gauss() * Math.min(sigma, b.width / 3), b.y + b.height / 2 + gauss() * Math.min(sigma, b.height / 3)); };
      const S = () => page.evaluate(see, mach);
      // latency learning: send epoch -> pointerdown handler time
      const lats = []; let latEst = 35, lastSend = 0, lastPd = null;
      const learnLat = s => { if (s.pd != null && s.pd !== lastPd) { lastPd = s.pd; const l = origin + s.pd - lastSend; if (lastSend && l > 0 && l < 300) { lats.push(l); if (lats.length > 21) lats.shift(); latEst = lats.slice().sort((a, b) => a - b)[lats.length >> 1]; } } };
      const tapScreen = async (x, y, s) => { lastSend = epoch(); await tapXY(s.L + x, s.Tp + y); };
      const tapAtEpoch = async (when, x, y, s) => { while (epoch() < when - 1) await sleep(Math.min(3, when - epoch() - 1)); await tapScreen(x, y, s); };
      const cartIdx = MACHINES.indexOf(mach);
      // open machine via real UI
      await tapEl(`.cart >> nth=${cartIdx}`); await sleep(300);
      const runs = [];
      const nRuns = process.argv[4] ? RUNS : (mach === 'simon' && (tierId === 'superhuman' || tierId === 'world')) ? 2 : (mach === 'stack' && tierId === 'superhuman') ? 3 : (mach === 'slide' && (tierId === 'clumsy' || tierId === 'casual')) ? 3 : 5;
      for (let run = 0; run < nRuns; run++) {
        if (await page.evaluate(() => !document.getElementById('over').hidden)) await tapEl('#againBtn'); else await tapEl('#goBtn');
        await sleep(150);
        const t0 = Date.now(); let res = { run };
        let s = await S();
        if (mach === 'react') {
          const rts = []; let earlies = 0, round = 0, seenGo = null, planned = false, earlyPlanned = null;
          while (!s.over && Date.now() - t0 < 60000) {
            s = await S(); learnLat(s);
            if (s.phase === 'wait') {
              seenGo = null; planned = false;
              if (earlyPlanned == null) { const mis = rnd() < T.mistake; earlyPlanned = mis ? epoch() + 300 + rnd() * 1500 : 0; }
              if (earlyPlanned && epoch() >= earlyPlanned) { earlies++; earlyPlanned = 0; await tapScreen(s.W / 2 + gauss() * T.pos, s.H / 2 + gauss() * T.pos, s); }
            } else if (s.phase === 'go' && !planned) {
              // frame showing green was presented at s.t; human reaction counted from there
              planned = true; earlyPlanned = null;
              const R = tierId === 'superhuman' ? 16 : sampleMs(T.react) + gauss() * T.tim;
              const when = origin + s.t + Math.max(16, R) - latEst;
              await tapAtEpoch(when, s.W / 2 + gauss() * T.pos, s.H / 2 + gauss() * T.pos, s);
              rts.push(Math.round(R)); round++;
            } else if (s.phase !== 'wait') earlyPlanned = null;
            await sleep(2);
          }
          res = { run, scoreMs: parseInt(s.score) || null, earlyTaps: earlies, intendedReactionMs: rts, harnessLatencyMs: Math.round(latEst) };
        } else if (mach === 'stack') {
          let layers = 0, lastN = -1, plannedFor = -1, spawnSeen = 0, hist = [], perfects = 0, nTaps = 0;
          while (!s.over && Date.now() - t0 < 240000) {
            s = await S(); learnLat(s);
            if (s.over) break;
            const bl = s.blocks; if (bl.length < 2) { await sleep(3); continue; }
            const top = bl[0], cur = bl[bl.length - 1];
            if (Math.abs(cur[1] - (top[1] - s.bh)) > 3) { await sleep(3); continue; } // cur not on screen (ending / debris)
            const key = cur[3] + '|' + top[3]; // layer colours differ per level -> identity of the current drop
            if (key !== lastN) { lastN = key; hist = []; spawnSeen = epoch(); plannedFor = -1; }
            hist.push({ t: s.t, x: cur[0] });
            if (plannedFor === key) { await sleep(3); continue; }
            // estimate velocity from frames seen (human: needs ~react ms of observation)
            const age = tierId === 'superhuman' ? 34 : sampleMs(T.react);
            if (epoch() - spawnSeen < age || hist.length < 3) { await sleep(3); continue; }
            const h2 = hist[hist.length - 1], h1 = hist.find(h => h2.t - h.t <= 120) || hist[0];
            if (h2.t === h1.t) { await sleep(3); continue; }
            const v = (h2.x - h1.x) / (h2.t - h1.t); // px per ms
            if (Math.abs(v) < 0.05) { await sleep(3); continue; }
            const w = cur[2], lo = -w * 0.5, hi = s.W - w * 0.5, target = top[0];
            // predict crossing times with bounces (sampled at 1 ms) from the last seen frame
            let x = h2.x, vv = v, tt = h2.t, crossing = null; const earliest = origin + h2.t; const minT = epoch() + latEst + 5;
            for (let k = 0; k < 4000; k++) {
              const nx = x + vv; if (nx > hi) { vv = -Math.abs(vv); } else if (nx < lo) { vv = Math.abs(vv); }
              const px = x; x = Math.min(hi, Math.max(lo, nx)); tt += 1;
              if ((px - target) * (x - target) <= 0 && origin + tt > minT) { crossing = tt; break; }
            }
            if (crossing == null) { await sleep(3); continue; }
            let aim = origin + crossing;
            if (tierId === 'superhuman') { // frame-perfect: arrive mid-frame right after the frame closest to alignment
              const fd = 1000 / 60; const k = Math.round((crossing - h2.t) / fd); aim = origin + h2.t + k * fd + fd * 0.45;
            }
            const r = rnd(); let kind = 'aim';
            if (r < T.mistake) { kind = 'mistake'; aim += (rnd() - 0.5) * 800; }
            else if (r < T.mistake + T.rand) { kind = 'unaimed'; aim += (rnd() - 0.5) * 300; }
            aim += gauss() * T.tim;
            plannedFor = key; nTaps++;
            await tapAtEpoch(Math.max(epoch(), aim - latEst), s.W / 2 + gauss() * T.pos, s.H / 2 + gauss() * T.pos, s);
            await sleep(40);
            if (nTaps >= CAPS.stackLayers) break;
          }
          s = await S(); await sleep(1200); const fin = await S();
          res = { run, layers: fin.over ? parseInt(fin.score) : nTaps, ended: fin.over ? 'missed the tower' : 'cap ' + CAPS.stackLayers + ' layers', taps: nTaps, harnessLatencyMs: Math.round(latEst) };
          if (!fin.over) { await tapEl('#menuBtn'); await sleep(300); await tapEl(`.cart >> nth=${cartIdx}`); await sleep(300); }
        } else if (mach === 'simon') {
          const C = ['#ff3b3b', '#22e4f0', '#ffe94a', '#3dff8b'];
          let seq = [], prevLit = null, phase = '', errorsMade = 0, rounds = 0;
          const geo = () => { const W = s.W, H = s.H, sz = Math.min(W * 0.86, H * 0.7), g = sz * 0.05, c = (sz - g) / 2, ox = (W - sz) / 2, oy = (H - sz) / 2 + Math.min(20, H * 0.04); return i => [ox + (i % 2) * (c + g) + c / 2, oy + ((i / 2) | 0) * (c + g) + c / 2]; };
          while (!s.over && Date.now() - t0 < 300000) {
            s = await S(); learnLat(s);
            const ph = /看好/.test(s.msg) ? 'show' : /換你/.test(s.msg) ? 'input' : /按錯/.test(s.msg) ? 'wrong' : 'pause';
            if (ph === 'show') {
              if (phase !== 'show') seq = [];
              const li = s.lit ? C.indexOf(s.lit.toLowerCase()) : -1;
              if (li >= 0 && prevLit !== li) seq.push(li);
              prevLit = li;
            } else prevLit = null;
            if (ph === 'input' && phase !== 'input') {
              rounds++;
              if (seq.length > CAPS.simonSteps) break;
              // recall: each item mis-remembered with prob mistake + overload beyond span
              const pErr = Math.min(0.9, T.mistake + Math.max(0, seq.length - T.span) * 0.12);
              const center = geo();
              await sleep(tierId === 'superhuman' ? 0 : sampleMs(T.react));
              for (let i = 0; i < seq.length; i++) {
                let p = seq[i];
                if (rnd() < pErr) { p = (p + 1 + ((rnd() * 3) | 0)) % 4; errorsMade++; }
                const [cx, cy] = center(p);
                await tapScreen(cx + gauss() * T.pos, cy + gauss() * T.pos, s);
                await sleep(tierId === 'superhuman' ? 20 : Math.max(60, T.tapGap + gauss() * T.tim));
                const s2 = await S(); if (/按錯/.test(s2.msg) || s2.over) break;
              }
            }
            phase = ph;
            await sleep(4);
          }
          await sleep(1500); const fin = await S();
          res = { run, steps: fin.over ? parseInt(fin.score) : seq.length - 1, ended: fin.over ? 'wrong pad' : 'cap ' + CAPS.simonSteps + ' steps', recallErrors: errorsMade };
          if (!fin.over) { await tapEl('#menuBtn'); await sleep(300); await tapEl(`.cart >> nth=${cartIdx}`); await sleep(300); }
        } else if (mach === 'slide') {
          const W = s.W, H = s.H, sz = Math.min(W * 0.9, H * 0.72), cell = sz / 3, ox = (W - sz) / 2, oy = (H - sz) / 2 + Math.min(16, H * 0.03);
          const board = st => { const b = new Array(9).fill(0); for (const [v, x, y] of st.tiles) { const c = Math.floor((x - ox) / cell), r = Math.floor((y - oy) / cell); b[r * 3 + c] = v; } return b; };
          const settled = st => st.tiles.length === 8 && st.tiles.every(([v, x, y]) => { const fx = (x - ox) / cell - 0.5, fy = (y - 2 - oy) / cell - 0.5; return Math.abs(fx - Math.round(fx)) < 0.04 && Math.abs(fy - Math.round(fy)) < 0.04; });
          const man = b => { let d = 0; for (let i = 0; i < 9; i++) if (b[i]) { const g = b[i] - 1; d += Math.abs(g % 3 - i % 3) + Math.abs(((g / 3) | 0) - ((i / 3) | 0)); } return d; };
          const nbr = b => { const z = b.indexOf(0), r = []; for (const q of [z - 3, z + 3, z - 1, z + 1]) if (q >= 0 && q < 9 && (Math.abs(q - z) === 3 || ((q / 3) | 0) === ((z / 3) | 0))) r.push(q); return r; };
          const mv = (b, q) => { const n = b.slice(), z = n.indexOf(0); n[z] = n[q]; n[q] = 0; return n; };
          const goal = '1,2,3,4,5,6,7,8,0';
          const astar = b0 => { // optimal
            const open = [[man(b0), 0, b0, []]], seen = new Map([[b0.join(), 0]]);
            while (open.length) { open.sort((a, b) => a[0] - b[0]); const [, g, b, p] = open.shift(); if (b.join() === goal) return p;
              for (const q of nbr(b)) { const n = mv(b, q), k = n.join(); if (seen.has(k) && seen.get(k) <= g + 1) continue; seen.set(k, g + 1); open.push([g + 1 + man(n), g + 1, n, p.concat([q])]); } }
          };
          let plan = null, moves = 0, wrongTaps = 0; const visited = new Map();
          while (Date.now() - t0 < CAPS.slideSec * 1000) {
            s = await S(); learnLat(s);
            if (s.over || /完成/.test(s.msg)) break;
            if (!settled(s)) { await sleep(5); continue; }
            const b = board(s);
            if (b.join() === goal) { await sleep(20); continue; }
            visited.set(b.join(), (visited.get(b.join()) || 0) + 1);
            let q;
            if (tierId === 'superhuman') { // perfect info: solve once, fire the whole optimal sequence ~1 tap per frame
              const p = astar(b); for (const qq of p) { const [cx, cy] = [ox + (qq % 3 + 0.5) * cell, oy + (((qq / 3) | 0) + 0.5) * cell]; await tapScreen(cx, cy, s); moves++; await sleep(16); }
              await sleep(400); continue;
            }
            if (tierId === 'world') {
              if (!plan || !plan.length || plan.exp !== b.join()) plan = astar(b);
              q = plan.shift(); plan.exp = mv(b, q).join();
              if (tierId === 'world' && rnd() < T.mistake) { const ns = nbr(b); q = ns[(rnd() * ns.length) | 0]; plan = null; }
            } else {
              const ns = nbr(b);
              const r = rnd();
              if (r < T.rand + T.mistake) q = ns[(rnd() * ns.length) | 0];
              else if (tierId === 'skilled') { // 2-step lookahead on manhattan + revisit penalty
                let best = 1e9; for (const a of ns) { const b1 = mv(b, a); let m = 1e9; for (const c of nbr(b1)) { const b2 = mv(b1, c); m = Math.min(m, man(b2) + 2 * (visited.get(b2.join()) || 0)); } if (b1.join() === goal) m = -1; const sc = Math.min(m, man(b1)) + 3 * (visited.get(b1.join()) || 0) + rnd() * 0.5; if (sc < best) { best = sc; q = a; } }
              } else { // 1-step greedy with a short memory of visited boards
                let best = 1e9; for (const a of ns) { const b1 = mv(b, a); const sc = man(b1) + 2 * (visited.get(b1.join()) || 0) + rnd() * 1.5; if (sc < best) { best = sc; q = a; } }
              }
              plan = null;
            }
            await sleep(tierId === 'superhuman' ? 0 : sampleMs(T.think) / 2 + sampleMs(T.react) / 2);
            const [cx, cy] = [ox + (q % 3 + 0.5) * cell, oy + (((q / 3) | 0) + 0.5) * cell];
            const tx = cx + gauss() * T.pos, ty = cy + gauss() * T.pos;
            const tc = Math.floor((tx - ox) / cell), tr = Math.floor((ty - oy) / cell);
            if (tr * 3 + tc !== q) wrongTaps++;
            await tapScreen(tx, ty, s); moves++;
            await sleep(tierId === 'superhuman' ? 18 : 30);
          }
          await sleep(1500); const fin = await S();
          res = { run, timeSec: fin.over ? parseFloat(fin.score) : null, solved: fin.over, taps: moves, wrongCellTaps: wrongTaps, ended: fin.over ? 'solved' : 'gave up at ' + CAPS.slideSec + 's' };
          if (!fin.over) { await tapEl('#menuBtn'); await sleep(300); await tapEl(`.cart >> nth=${cartIdx}`); await sleep(300); }
        }
        res.wallSec = +((Date.now() - t0) / 1000).toFixed(1);
        console.log(tierId, mach, JSON.stringify(res));
        runs.push(res);
        await sleep(400);
      }
      out.tiers[tierId].runs.push({ machine: mach, runs, pageErrors: errors });
      fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
      await ctx.close();
    }
  }
  await browser.close();
})();
