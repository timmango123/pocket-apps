// Pixel Wizard skill-tier bot. Usage: node bot.js [tier,...] [levels,...]
// Reads state through window.__pw (read-only getters); acts only through real CDP touch events:
// finger 1 holds ◀/▶, finger 2 taps jump, finger 3 taps spell buttons or taps a wisp on the canvas (aimed cast).
// Level start uses the allowed hook __pw.newGame(n). Clock lock-stepped (rAF driven by harness), Math.random seeded.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const APP = '/mnt/project-files/apps/pixel-wizard/index.html';
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

const FRAME = 1000 / 60;

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, every: 12, policy: 'clumsy', pred: 0.5, tapGap: 450, maxAtt: 5 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, every: 8, policy: 'greedy', pred: 0.8, tapGap: 300, maxAtt: 3 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, every: 6, policy: 'look2', tapGap: 200, maxAtt: 3 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, every: 4, policy: 'search', tapGap: 130, maxAtt: 3 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, every: 1, policy: 'perfect', tapGap: 16, maxAtt: 3 },
};
const LEVELS = [1, 10, 25, 50, 75, 99, 100];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = [], fakeT = 1000;
  window.__errs = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => fakeT;
  window.__drawEvery = 20; let fc = 0; const P = CanvasRenderingContext2D.prototype;
  for (const m of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText','clearRect','putImageData']) { const o = P[m]; P[m] = function () { if (fc % window.__drawEvery === 0) return o.apply(this, arguments); }; }
  window.__obs = () => { const P = window.__pw, w = P.wiz;
    return { st: P.state, wave: P.wave, score: P.score, camX: P.cameraX(), S: P.S, BW: P.BW, gy: P.groundY, WW: P.worldW, cds: P.cds.slice(),
      w: { x: w.x, y: w.y, vy: w.vy, onGround: w.onGround, hp: w.hp, mp: w.mp, castT: w.castT, inv: w.inv, face: w.face },
      ws: P.wisps.filter(q => !q.dead).map(q => ({ x: q.x, y: q.y, vx: q.vx, type: q.type, boss: q.boss, hp: q.hp, max: q.maxHp })),
      os: P.orbs.map(o => ({ x: o.x, y: o.y, vx: o.vx, vy: o.vy })), heal: P.SP.heal };
  };
  window.__step = (n, rec) => {
    for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = [];
      for (const cb of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e)); } } }
    return rec ? window.__obs() : null; };
})();`;

// ---- movement planner (adapted from apps/pixel-wizard/demo/autoplayer-bot.js) ----
const SPLIT = 0.25;
function simulate(plan, v, age, H) {
  let { x, y, vy, onGround: onG } = v.w; const gy = v.gy;
  const [dA, jA, dB, jB] = plan;
  if (jA && onG) { vy = -175; onG = false; }
  let cost = 0, jumpedB = false; const h = 1 / 40;
  for (let s = h; s <= H + 1e-6; s += h) {
    const dir = s < SPLIT ? dA : dB;
    if (s >= SPLIT && jB && !jumpedB && onG) { vy = -175; onG = false; jumpedB = true; }
    const spd = (v.w.castT > 0 && s < v.w.castT) ? 38 : 62;
    x = Math.max(6, Math.min(v.WW - 6, x + dir * spd * h));
    if (!onG) { vy += 520 * h; y += vy * h; if (y >= gy) { y = gy; vy = 0; onG = true; } }
    const inv = v.w.inv > s;
    for (const o of v.os) {
      const ox = o.x + o.vx * (age + s), oy = o.y + o.vy * (age + s);
      if (oy >= gy + 2) continue;
      if (!inv && Math.abs(ox - x) < 6.5 && oy > y - 24 && oy < y + 2) cost += 10 / (s + 0.15);
    }
    for (const q of v.ws) {
      const qx = q.x + (q.vx || 0) * (age + s);
      if (!inv && Math.abs(qx - x) < (q.boss ? 17 : 11) && Math.abs(q.y - (y - 12)) < (q.boss ? 20 : 14)) cost += 4 / (s + 0.2);
    }
  }
  let nd = 1e9; for (const q of v.ws) nd = Math.min(nd, Math.abs(q.x - x));
  if (nd < 30) cost += (30 - nd) * 0.05;
  if (x < 20 || x > v.WW - 20) cost += 0.6;
  if (jA) cost += 0.05; if (dA) cost += 0.02;
  return cost;
}
const ACT2 = [], ACT1 = [];
for (const dA of [0, -1, 1]) for (const jA of [0, 1]) for (const dB of [0, -1, 1]) for (const jB of [0, 1]) if (!(jA && jB)) ACT2.push([dA, jA, dB, jB]);
for (const d of [0, -1, 1]) for (const j of [0, 1]) ACT1.push([d, j, d, 0]);
const WEAK = [1, 0, 2]; // wisp type -> weakness spell (matches WISP_TYPES weak in game)
const COST = [12, 9, 24, 30];

function decideMove(T, v, age, rnd) {
  if ((T.policy === 'clumsy' && rnd() < 0.5) || (T.policy === 'greedy' && rnd() < 0.15)) return { a: ACT1[Math.floor(rnd() * ACT1.length)], kind: 'random' };
  const acts = (T.policy === 'greedy' || T.policy === 'clumsy') ? ACT1 : ACT2;
  const H = T.policy === 'greedy' || T.policy === 'clumsy' ? 0.6 : T.policy === 'look2' ? 0.9 : 1.1;
  let best = acts[0], bc = 1e9;
  for (const a of acts) { const c = simulate(a, v, age, H); if (c < bc - 1e-6) { bc = c; best = a; } }
  if (!v.ws.length && !v.os.length && bc < 0.2) best = [0, 0, 0, 0];
  return { a: best, kind: 'plan' };
}
function decideSpell(T, v, cur, rnd) {
  const w = v.w;
  if (w.hp < 55 && w.mp >= 30 && v.cds[3] <= 0) return { spell: 3 };
  if (!v.ws.length) return null;
  let tq = null, td = 1e9;
  for (const q of v.ws) { const d = Math.hypot(q.x - w.x, (q.y - (w.y - 14)) * 1.2); if (d < td) { td = d; tq = q; } }
  let spell = WEAK[tq.type];
  if (T.policy === 'clumsy' && rnd() < 0.5) spell = Math.floor(rnd() * 3);
  else if (T.policy === 'greedy' && rnd() < 0.15) spell = Math.floor(rnd() * 3);
  let cluster = 0; for (const q of v.ws) if (Math.hypot(q.x - tq.x, q.y - tq.y) < 70) cluster++;
  if (T.policy !== 'clumsy' && T.policy !== 'greedy' && cluster >= 2 && w.mp >= 24 && v.cds[2] <= 0 && spell !== 2) spell = 2;
  if (w.mp < COST[spell] || v.cds[spell] > 0) {
    const alt = [0, 1, 2].filter(i => w.mp >= COST[i] && v.cds[i] <= 0);
    if (!alt.length) return null;
    if (w.mp < 30 && w.hp < 60 && T.policy !== 'clumsy') return null; // save for heal
    spell = alt.includes(1) ? 1 : alt[0];
  }
  return { spell, target: tq };
}

async function main() {
  const tiers = (process.argv[2] || Object.keys(TIERS).join(',')).split(',');
  const levels = process.argv[3] ? process.argv[3].split(',').map(Number) : LEVELS;
  const capSec = +(process.argv[4] || 200);
  const resFile = path.join(OUT, 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'pixel-wizard', tiers: {}, findings: [] };
  const srv = await serveHub(APP); const BASE = `http://127.0.0.1:${srv.address().port}/`;
  let browser = await chromium.launch({ headless: true });
  const relaunch = async () => { try { await browser.close(); } catch (e) {} browser = await chromium.launch({ headless: true }); };
  for (const tierId of tiers) {
    const T = TIERS[tierId];
    const runs = (results.tiers[tierId] && process.argv[3]) ? results.tiers[tierId].runs.filter(r => !levels.includes(r.level)) : [];
    for (const lv of levels) {
      for (let att = 1, crashes = 0; att <= T.maxAtt; att++) {
       try {
        const seed = 1000 * (Object.keys(TIERS).indexOf(tierId) + 1) + lv * 7 + att;
        const rnd = mulberry32(seed);
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
        await ctx.addInitScript(`try{localStorage.setItem('pw-unlock-all','true');localStorage.setItem('pw-muted','true')}catch(e){}`);
        await ctx.addInitScript(INIT(seed));
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e)));
        page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
        const fr = await openGame(page, BASE);
        await fr.evaluate(n => { window.__step(3); window.__pw.newGame(n); }, lv);
        const box = {};
        for (const id of ['bL', 'bR', 'bJ', 's0', 's1', 's2', 's3']) box[id] = await fr.locator('#' + id).boundingBox();
        const cdp = await ctx.newCDPSession(page);
        const touches = new Map(); // id -> {x,y}
        const pts = () => [...touches.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
        const down = async (id, x, y) => { touches.set(id, { x, y }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); };
        const up = async id => { const p = touches.get(id); if (!p) return; touches.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); };
        const inBox = (b, sd) => [b.x + b.width / 2 + gauss(rnd) * sd, b.y + b.height / 2 + gauss(rnd) * sd];
        let v = await fr.evaluate(() => window.__step(1, true));
        const buf = [v]; let frame = 0, nextDec = 0, moveDir = 0, curSpell = 0, lastTap = -1e9, pending = [];
        const st = { decisions: 0, randomMoves: 0, mistakes: 0, spellTaps: 0, wispTaps: 0, missTaps: 0, jumps: 0, heals: 0, hpLost: 0 };
        let lastHp = v.w.hp, end = null; const cap = capSec * 60; const stepN = T.every === 1 ? 1 : 2;
        while (frame < cap) {
          v = await fr.evaluate(n => window.__step(n, true), stepN); frame += stepN;
          buf.push(v); if (buf.length > 90) buf.shift();
          if (v.w.hp < lastHp) st.hpLost += lastHp - v.w.hp; lastHp = v.w.hp;
          if (v.st === 'clear') { end = 'cleared'; break; }
          if (v.st === 'over') { end = 'dead'; break; }
          // execute scheduled touches (motor timing jitter)
          pending.sort((a, b) => a.at - b.at);
          while (pending.length && pending[0].at <= frame) { const p = pending.shift(); await p.fn(); }
          if (frame >= nextDec) {
            nextDec = frame + T.every;
            const rt = Math.max(16, T.react[0] + gauss(rnd) * T.react[1]);
            const d = Math.max(1, Math.round(rt / FRAME / stepN));
            const ob = buf[Math.max(0, buf.length - d)];
            if (ob.st !== 'play') continue;
            st.decisions++;
            const age = (buf.length - 1 - Math.max(0, buf.length - d)) * stepN / 60;
            let { a, kind } = decideMove(T, { ...ob, w: v.w }, age * (T.pred == null ? 1 : T.pred), rnd); // own wizard: current; orbs/wisps: delayed + extrapolated
            if (kind === 'random') st.randomMoves++;
            let dir = a[0];
            if (rnd() < T.mistake) { dir = dir === 0 ? (rnd() < 0.5 ? 1 : -1) : -dir; st.mistakes++; }
            const delay = () => Math.round(Math.abs(gauss(rnd) * T.tim) / FRAME);
            if (dir !== moveDir) {
              const nd = dir; moveDir = dir;
              pending.push({ at: frame + delay(), fn: async () => { await up(1); if (nd) { const [x, y] = inBox(box[nd < 0 ? 'bL' : 'bR'], T.pos * 0.4); await down(1, x, y); } } });
            }
            if (a[1]) { st.jumps++; pending.push({ at: frame + delay(), fn: async () => { const [x, y] = inBox(box.bJ, T.pos * 0.4); await down(2, x, y); await up(2); } }); }
            // spell thumb, rate limited
            if ((frame - lastTap) * FRAME >= T.tapGap) {
              const sp = decideSpell(T, ob, curSpell, rnd);
              if (sp) {
                lastTap = frame;
                let spell = sp.spell;
                if (rnd() < T.mistake) { spell = (spell + 1 + Math.floor(rnd() * 2)) % 3; st.mistakes++; }
                if (spell === 3 || spell !== curSpell || T.policy === 'clumsy') {
                  // tap the spell button: selects it and casts at the nearest target
                  curSpell = spell; if (spell === 3) st.heals++; else st.spellTaps++;
                  const b = box['s' + spell];
                  pending.push({ at: frame + delay(), fn: async () => { const [x, y] = inBox(b, T.pos * 0.4); await down(3, x, y); await up(3); } });
                  if (spell === 3) curSpell = 3;
                } else if (sp.target) {
                  // tap the wisp where it was seen (aimed cast with the selected spell)
                  st.wispTaps++;
                  const q = sp.target, dpr = 2;
                  const devW = 390 * dpr, devH = 844 * dpr, offX = Math.floor((devW - ob.BW * ob.S) / 2), offY = Math.floor((devH - Math.ceil(devH / ob.S) * ob.S) / 2);
                  const cx = ((q.x - ob.camX) * ob.S + offX) / dpr + gauss(rnd) * T.pos, cy = (q.y * ob.S + offY) / dpr + gauss(rnd) * T.pos;
                  pending.push({ at: frame + delay(), fn: async () => { const x = Math.max(2, Math.min(388, cx)), y = Math.max(60, Math.min(840, cy)); await down(3, x, y); await up(3); } });
                }
              }
            }
          }
        }
        for (const id of [...touches.keys()]) await up(id);
        await fr.evaluate(() => window.__step(90));
        const ui = await fr.evaluate(() => ({ title: document.getElementById('overTitle').textContent, stars: document.getElementById('oStars').textContent, overHidden: document.getElementById('over').hidden }));
        const aliveAtEnd = await fr.evaluate(() => window.__pw.wisps.filter(q => !q.dead).map(q => ({ boss: q.boss, hp: Math.round(q.hp), x: Math.round(q.x), y: Math.round(q.y) })));
        const pageErr = await fr.evaluate(() => window.__errs);
        const run = { level: lv, attempt: att, seed, cleared: end === 'cleared', end: end || 'timeout', time: +(frame / 60).toFixed(1), score: v.score, hp: Math.round(v.w.hp),
          stars: end === 'cleared' ? (v.w.hp >= 70 ? 3 : v.w.hp >= 35 ? 2 : 1) : 0, wispsLeft: v.ws.length, aliveAtEnd, ...st, ui, errors: errors.concat(pageErr) };
        runs.push(run);
        console.log(tierId, JSON.stringify(run));
        await ctx.close();
        if (run.cleared) break;
       } catch (e) { console.log('HARNESS ERROR', tierId, lv, att, String(e).slice(0, 300)); if (++crashes > 2) throw e; att--; await relaunch(); }
      }
    }
    const byLv = {};
    for (const r of runs) { const b = byLv[r.level] || (byLv[r.level] = { cleared: false, attempts: 0, bestStars: 0, bestScore: 0 }); b.attempts++; if (r.cleared) b.cleared = true; b.bestStars = Math.max(b.bestStars, r.stars); b.bestScore = Math.max(b.bestScore, r.score); }
    results.tiers[tierId] = { runs, summary: { levelsCleared: Object.values(byLv).filter(b => b.cleared).length, levelsTested: Object.keys(byLv).length, byLevel: byLv } };
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await browser.close(); srv.close();
}
module.exports = { INIT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
