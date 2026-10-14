// Slide Rush skill-tier bot. Usage: node bot.js [tier,...] [levels,...]
// Lock-step clock: requestAnimationFrame is driven by the harness (16.67ms per frame) so reaction delays are
// exact in game time and runs are reproducible; Math.random is seeded. Game state is only READ (window.__sr.view);
// all control goes through CDP touch events on the canvas (drag left/right) and taps on menu buttons.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const APP = '/mnt/project-files/apps/slide-rush/index.html';
const OUT = __dirname;
// --- hub-like host page: the app has no <!doctype>/viewport meta, so (like game-hub) it is run inside a
// full-screen iframe of a 390x844 page with a viewport meta. Touch coordinates map 1:1 into the iframe.
const http = require('http');
function serveHub(appFile, transform) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      if (req.url.startsWith('/game')) { let html = fs.readFileSync(appFile, 'utf8'); if (transform) html = transform(html); rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rsp.end(html); return; }
      rsp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rsp.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style></head><body><iframe src="/game"></iframe></body></html>');
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
async function openGame(page, base) {
  await page.goto(base);
  let fr = null;
  for (let i = 0; i < 200 && !fr; i++) { fr = page.frames().find(f => f.url().endsWith('/game')); if (!fr) await page.waitForTimeout(20); }
  await fr.waitForLoadState('load');
  return fr;
}


const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, every: 12, policy: 'clumsy', maxAtt: 5 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, every: 8, policy: 'greedy', maxAtt: 3 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, every: 5, policy: 'look2', maxAtt: 3 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, every: 3, policy: 'search', maxAtt: 3 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, every: 1, policy: 'perfect', maxAtt: 3 },
};
const LEVELS = [1, 10, 25, 50, 75, 99, 100];
const FRAME = 1000 / 60;

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = [], fakeT = 1000;
  window.__errs = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => fakeT;
  // harness frame-skip: canvas raster ops are no-ops except every DRAW_EVERY-th frame (all game JS still runs every frame)
  window.__drawEvery = 20; let fc = 0; const P = CanvasRenderingContext2D.prototype;
  for (const m of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText','clearRect','putImageData']) { const o = P[m]; P[m] = function () { if (fc % window.__drawEvery === 0) return o.apply(this, arguments); }; }
  window.__step = (n, rec) => { const out = [];
    for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = [];
      for (const cb of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e)); } }
      if (rec && window.__sr) out.push(window.__sr.view()); }
    return out; };
})();`;

// ---- physics model (copied constants from game) ----
const KC = 1.7, KG = 9, KS = 6.5, KD = 3.2, VREF = 10000, RIM = 1.92, SEG = 200;
function rollout(s, plan, view, horizon, hazVis) {
  // s: {a,w,v,steer,z} z in segs relative to view seg start (frac). plan: [[u, dur],...]
  let { a, w, v, steer } = s, z = s.frac, score = 0, t = 0, pi = 0, pend = plan[0][1];
  const dt = 1 / 30; let lastSeg = Math.floor(z);
  while (t < horizon) {
    if (t >= pend && pi < plan.length - 1) { pi++; pend += plan[pi][1]; }
    const u = plan[pi][0];
    steer += (u - steer) * Math.min(1, dt * 9);
    const k = Math.floor(z); const c = view.ahead[Math.min(69, k)] || 0;
    const vr = Math.min(1, v / VREF);
    const acc = -KC * c * vr * vr - KG * Math.sin(a) + KS * steer - KD * w;
    w += acc * dt; a += w * dt; z += v * dt / SEG; t += dt;
    if (Math.abs(a) > RIM * 0.97) return score - 1000 + t * 10;
    const lean = c !== 0 ? Math.max(0, steer * Math.sign(c)) * Math.min(1, Math.abs(c) / 3) : 0;
    const wall = Math.max(0, Math.abs(a) - 1.0);
    score += (lean * 0.17 - wall * 0.22) * dt - Math.max(0, Math.abs(a) - 1.45) * 3 * dt;
    const nk = Math.floor(z);
    for (let q = lastSeg + 1; q <= nk; q++) {
      for (const [hk, h] of view.haz) if (hk <= hazVis && Math.abs(hk - q) <= 1 && Math.abs(a - h) < 0.36) score -= 0.6;
      for (const [pk, pa] of view.pads) if (q >= pk && q < pk + 4 && Math.abs(a - pa) < 0.26) score += 0.5;
    }
    lastSeg = nk;
  }
  return score;
}
const U9 = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1], U5 = [-1, -0.5, 0, 0.5, 1];
function decide(policy, obs, rnd) {
  const s = obs;
  if (policy === 'clumsy' && rnd() < 0.5) return { u: U5[Math.floor(rnd() * 5)], kind: 'random' };
  if ((policy === 'greedy') && rnd() < 0.15) return { u: U5[Math.floor(rnd() * 5)], kind: 'random' };
  let best = -1e9, bu = 0;
  if (policy === 'greedy' || policy === 'clumsy') { // 1-step greedy: constant input over a short horizon, near hazards only
    for (const u of U5) { const sc = rollout(s, [[u, 9]], s, 0.6, 20); if (sc > best) { best = sc; bu = u; } }
  } else {
    const [U, H, vis] = policy === 'look2' ? [U5, 1.0, 40] : policy === 'search' ? [U9, 1.5, 70] : [U9, 1.75, 70];
    for (const u1 of U) for (const u2 of U) { const sc = rollout(s, [[u1, 0.35], [u2, 9]], s, H, vis); if (sc > best) { best = sc; bu = u1; } }
  }
  return { u: bu, kind: 'plan' };
}

async function main() {
  const tiers = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
  const levels = process.argv[3] ? process.argv[3].split(',').map(Number) : LEVELS;
  const resFile = path.join(OUT, 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'slide-rush', tiers: {}, findings: [] };
  const srv = await serveHub(APP); const BASE = `http://127.0.0.1:${srv.address().port}/`;
  let browser = await chromium.launch({ headless: true });
  const relaunch = async () => { try { await browser.close(); } catch (e) {} browser = await chromium.launch({ headless: true }); };
  for (const tierId of tiers) {
    const T = TIERS[tierId];
    const runs = (results.tiers[tierId] && process.argv[3]) ? results.tiers[tierId].runs.filter(r => !levels.includes(r.level)) : [];
    let seedN = 0;
    for (const lv of levels) {
      for (let att = 1, crashes = 0; att <= T.maxAtt; att++) {
       try {
        const seed = 1000 * (Object.keys(TIERS).indexOf(tierId) + 1) + lv * 7 + att;
        const rnd = mulberry32(seed);
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        await ctx.addInitScript(`try{localStorage.setItem('sr_unlockAll','true')}catch(e){}`);
        await ctx.addInitScript(INIT(seed));
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        const fr = await openGame(page, BASE);
        await fr.evaluate(() => window.__step(5));
        const cdp = await ctx.newCDPSession(page);
        let offscreen = []; const tapEl = async sel => { { const b0 = await fr.locator(sel).boundingBox(); if (b0 && (b0.x + b0.width > 390 || b0.x < 0)) offscreen.push(sel); } await fr.locator(sel).scrollIntoViewIfNeeded(); const b = await fr.locator(sel).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await fr.evaluate(() => window.__step(2)); };
        // menu: world tab, then tile
        const world = Math.floor((lv - 1) / 20);
        await tapEl(`#worldTabs button:nth-child(${world + 1})`);
        await tapEl(`#tracks button:nth-child(${(lv - 1) % 20 + 1})`);
        const tag = await fr.evaluate(() => document.querySelector('#dfTag').textContent);
        if (!tag.startsWith('難度 ' + lv + '・')) throw new Error('wrong track selected: ' + JSON.stringify(tag) + ' lv=' + JSON.stringify(lv));
        // finger down during countdown
        const X0 = 195, Y0 = 640; let fx = X0, anchor = X0;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: X0, y: Y0, id: 1 }] });
        const buf = []; let frame = 0; const pending = []; let nextDecision = 0;
        let offs = 0, wasOff = false, hazHits = 0, pads = 0, lastV = null, randomMoves = 0, mistakes = 0, decisions = 0;
        let fin = null; const capFrames = 60 * 240;
        while (frame < capFrames) {
          const nextEv = Math.min(nextDecision, pending.length ? pending[0].at : Infinity);
          const n = Math.max(1, nextEv - frame);
          const views = await fr.evaluate(n => window.__step(n, true), n);
          for (const v of views) {
            buf.push(v);
            if (v.off > 0 && !wasOff) offs++; wasOff = v.off > 0;
            if (lastV && lastV.state === 'race' && v.state === 'race' && v.off <= 0) {
              if (v.boost > lastV.boost + 0.5) pads++;
              if (v.v < lastV.v * 0.8 && v.boost === 0 && !(v.off > 0)) hazHits++;
            }
            lastV = v;
          }
          frame += n;
          const cur = buf[buf.length - 1];
          if (cur.fin >= 0 || cur.state === 'done') { fin = cur; break; }
          while (pending.length && pending[0].at <= frame) {
            const p = pending.shift();
            fx = p.x;
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: Y0, id: 1 }] });
            const range = 78; if (Math.abs(fx - anchor) > range * 1.4) anchor = fx - Math.sign(fx - anchor) * range * 1.4;
          }
          if (frame >= nextDecision) {
            nextDecision = frame + T.every;
            if (cur.state !== 'race') continue;
            const rt = Math.max(16, T.react[0] + gauss(rnd) * T.react[1]);
            const d = Math.max(1, Math.round(rt / FRAME));
            const obs = buf[Math.max(0, buf.length - d)];
            if (obs.state !== 'race') continue;
            let { u, kind } = decide(T.policy, obs, rnd);
            decisions++; if (kind === 'random') randomMoves++;
            if (rnd() < T.mistake) { u = u === 0 ? (rnd() < 0.5 ? 1 : -1) : -u; mistakes++; }
            const x = Math.max(4, Math.min(386, anchor + u * 78 + gauss(rnd) * T.pos));
            const delay = Math.round(Math.abs(gauss(rnd) * T.tim) / FRAME);
            if (Math.abs(x - fx) > 0.5 || pending.length) { pending.push({ at: frame + delay, x }); pending.sort((p, q) => p.at - q.at); }
          }
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        // let the results screen come up
        await fr.evaluate(() => window.__step(150));
        const shown = await fr.evaluate(() => ({ place: document.querySelector('#resPlace').textContent, best: document.querySelector('#resBest').textContent, hidden: document.querySelector('#result').hidden }));
        const pageErr = await fr.evaluate(() => window.__errs);
        const run = {
          level: lv, attempt: att, seed, finished: !!fin, rank: fin ? fin.rank : null, need: buf[buf.length - 1].need,
          cleared: !!fin && fin.rank <= fin.need, time: fin ? +fin.fin.toFixed(2) : null, offs, hazHits, pads,
          decisions, randomMoves, mistakes, resultScreen: shown, menuOffscreen: offscreen, errors: errors.concat(pageErr),
        };
        if (fin && shown.place && !shown.hidden) {
          const names = ['冠軍', '亞軍', '季軍'];
          const shownRank = names.indexOf(shown.place) >= 0 ? names.indexOf(shown.place) + 1 : parseInt(shown.place.replace(/\D/g, ''));
          if (shownRank !== fin.rank) run.rankMismatch = { hud: fin.rank, results: shownRank };
        }
        runs.push(run);
        console.log(tierId, JSON.stringify(run));
        await ctx.close();
        if (run.cleared) break;
       } catch (e) { console.log('HARNESS ERROR', tierId, lv, att, String(e).slice(0, 200)); if (++crashes > 2) throw e; att--; await relaunch(); }
      }
    }
    const byLv = {};
    for (const r of runs) { const b = byLv[r.level] || (byLv[r.level] = { cleared: false, attempts: 0, bestRank: 99, bestTime: null }); b.attempts++; if (r.cleared) b.cleared = true; if (r.rank && r.rank < b.bestRank) b.bestRank = r.rank; if (r.cleared && (!b.bestTime || r.time < b.bestTime)) b.bestTime = r.time; }
    results.tiers[tierId] = { runs, summary: { levelsCleared: Object.values(byLv).filter(b => b.cleared).length, levelsTested: Object.keys(byLv).length, byLevel: byLv } };
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await browser.close(); srv.close();
}
module.exports = { INIT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
