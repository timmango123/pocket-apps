// Push Zombie skill-tier bot. Usage: node bot.js [tier,...] [probe]
// Reads window.__game.state() (read-only); acts only through CDP touchStart/touchEnd taps on the canvas
// (several fingers may overlap) and taps on the menu buttons. Clock is lock-stepped (rAF driven by the
// harness at 16.67ms/frame) and Math.random is seeded, so every tap can be checked against the state the
// game had at that exact instant: a tap that lands inside a live zombie's hit box but changes nothing is
// counted as DROPPED; a tap that changes more than one thing is DOUBLE-counted.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = 'file:///mnt/project-files/apps/push-zombie/index.html';
const OUT = __dirname;
const FRAME = 1000 / 60;

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, policy: 'clumsy', gap: 330, hold: 120, fingers: 2 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, policy: 'greedy', gap: 220, hold: 90, fingers: 2 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, policy: 'smart', gap: 150, hold: 80, fingers: 2 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, policy: 'smart', gap: 95, hold: 70, fingers: 2 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, policy: 'perfect', gap: 16, hold: 16, fingers: 5 },
};
const RUNS = process.env.PZRUNS ? JSON.parse(process.env.PZRUNS) : [['survival', 1], ['survival', 2], ['survival', 3], ['timed', 1], ['rush', 1]];
const CAP = { survival: 300, timed: 70, rush: 40 };

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = [], fakeT = 1000, ids = 0;
  window.__errs = [];
  window.requestAnimationFrame = cb => { ids++; q.push([ids, cb]); return ids; };
  window.cancelAnimationFrame = id => { q = q.filter(e => e[0] !== id); };
  performance.now = () => fakeT;
  window.__drawEvery = 20; let fc = 0; const P = CanvasRenderingContext2D.prototype;
  for (const m of ['fill','stroke','fillRect','strokeRect','drawImage','fillText','strokeText','clearRect','putImageData']) { const o = P[m]; P[m] = function () { if (fc % window.__drawEvery === 0) return o.apply(this, arguments); }; }
  window.__step = (n) => {
    for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = [];
      for (const [, cb] of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e)); } } }
    return window.__game.state(); };
})();`;

function zbox(g) { // replica of zombieBox() in index.html
  const z = g.z; if (!z) return null; const u = g.w / 100;
  if (z.phase !== 'rise' && z.phase !== 'top' && z.phase !== 'stage') return null;
  const top = g.holeY + (1 - z.p) * 100 * u - 100 * u;
  return { x0: g.cx - 42 * u, x1: g.cx + 42 * u, y0: Math.min(top, g.holeY - 30 * u), y1: g.holeY + 14 * u };
}
function graveAt(s, x, y) { // replica of graveAt()
  for (let i = s.graves.length - 1; i >= 0; i--) { const b = zbox(s.graves[i]); if (b && x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return s.graves[i]; }
  for (const g of s.graves) if (x >= g.x && x < g.x + g.w && y >= g.y && y < g.y + g.h) return g;
  return null;
}
const live = z => z && (z.phase === 'rise' || z.phase === 'top' || z.phase === 'stage');
function urgency(z) { return z.phase === 'top' ? 1 + z.t / Math.max(0.05, z.hold) : z.phase === 'stage' ? z.stage : z.p; }

async function runOne(browser, T, tierId, mode, rep, seed) {
  const rnd = mulberry32(seed);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(`try{localStorage.setItem('push-zombie:muted','true')}catch(e){}`);
  await ctx.addInitScript(INIT(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.evaluate(() => window.__step(30));
  const btn = { survival: '#btnSurvival', timed: '#btnTimed', rush: '#btnRush' }[mode];
  const bb = await page.locator(btn).boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const cdp = await ctx.newCDPSession(page);
  const down = new Map(); // finger id -> {x,y,upAt}
  let nextId = 1;
  const pts = () => [...down.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  let s = await page.evaluate(() => window.__step(1));
  let frame = 0, lastTap = -1e9; const seen = new Map(); const tapped = new Map();
  const st = { taps: 0, onTarget: 0, dropped: 0, doubled: 0, catTaps: 0, emptyTaps: 0, wrongStage: 0, mistakes: 0, randomPicks: 0, overlapTaps: 0, pausesSeen: 0 };
  const dropLog = []; const heartLoss = []; let lastHearts = s.hearts; const cap = (CAP[mode] + 3) * 60;
  const pending = []; let endScreen = null, endTime = null;
  while (frame < cap) {
    s = await page.evaluate(() => window.__step(1)); frame++;
    if (s.screen === 'paused') { st.pausesSeen++; break; }
    if (s.hearts < lastHearts) heartLoss.push(+s.time.toFixed(1)); lastHearts = s.hearts;
    if (s.screen === 'over' || s.screen === 'dying') break;
    // release fingers whose hold elapsed
    for (const [id, p] of [...down.entries()]) if (frame >= p.upAt) { down.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); }
    if (s.screen !== 'play') continue;
    if (!s.graves.some(g => g.z)) { st.fieldEmpty = (st.fieldEmpty || 0) + 1; if (st.firstEmpty == null) st.firstEmpty = +s.time.toFixed(2); }
    // perception: when each zombie first became visible (rising)
    for (const g of s.graves) if (g.z && live(g.z) && !seen.has(g.z.id)) seen.set(g.z.id, { f: frame, rt: Math.max(16, T.react[0] + gauss(rnd) * T.react[1]) / FRAME });
    // execute scheduled taps
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= frame) {
      const p = pending.shift();
      const x = p.x, y = p.y;
      const before = s; const g = graveAt(before, x, y);
      const tz = g && g.z ? { ...g.z } : null;
      const id = nextId++; if (down.size) st.overlapTaps++;
      down.set(id, { x, y, upAt: frame + Math.max(1, Math.round((T.hold + Math.abs(gauss(rnd) * T.tim * 0.5)) / FRAME)) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() });
      st.taps++;
      const after = await page.evaluate(() => window.__game.state()); // same frame: no game time has passed
      const ag = g ? after.graves[g.i] : null;
      if (g && tz && live(tz) && before.screen === 'play') {
        if (tz.type === 'cat') st.catTaps++;
        else if (mode === 'rush' && tz.stage < 3) st.wrongStage++;
        st.onTarget++;
        const changed = !ag.z || ag.z.id !== tz.id || ag.z.phase !== tz.phase || ag.z.hp !== tz.hp || after.hits !== before.hits || after.hearts !== before.hearts || after.stunT !== before.stunT;
        const stunned = mode === 'rush' && before.stunT > 0;
        if (!changed && !stunned) { st.dropped++; if (dropLog.length < 10) dropLog.push({ t: +before.time.toFixed(2), x: +x.toFixed(1), y: +y.toFixed(1), z: tz, fingersDown: down.size }); }
        if (after.hits - before.hits > 1) st.doubled++;
      } else if (g && !g.z) st.emptyTaps++;
      s = after;
    }
    // decide
    if ((frame - lastTap) * FRAME < T.gap) continue;
    const ready = s.graves.filter(g => g.z && live(g.z) && seen.has(g.z.id) && frame - seen.get(g.z.id).f >= seen.get(g.z.id).rt && !(tapped.get(g.z.id + ':' + g.z.hp) > frame));
    if (!ready.length) { continue; }
    let pick = null;
    const randomPick = (T.policy === 'clumsy' && rnd() < 0.5) || (T.policy === 'greedy' && rnd() < 0.15);
    if (randomPick) { pick = ready[Math.floor(rnd() * ready.length)]; st.randomPicks++; }
    else {
      let c = ready.filter(g => g.z.type !== 'cat');
      if (mode === 'rush') c = c.filter(g => g.z.stage >= 3);
      if (!c.length) { continue; }
      c.sort((a, b) => urgency(b.z) - urgency(a.z));
      pick = c[0];
    }
    if (rnd() < T.mistake) { // wrong target: a neighbouring grave
      st.mistakes++; const others = s.graves.filter(g => g !== pick); pick = others[Math.floor(rnd() * others.length)];
    }
    const b = zbox(pick); const tx = pick.cx, ty = b ? Math.max(b.y0 + 20 * pick.w / 100, pick.holeY - 45 * pick.w / 100) : pick.holeY - 20;
    const delay = Math.round(Math.abs(gauss(rnd) * T.tim) / FRAME);
    const x = Math.max(2, Math.min(388, tx + gauss(rnd) * T.pos)), y = Math.max(2, Math.min(842, ty + gauss(rnd) * T.pos));
    pending.push({ at: frame + delay, x, y });
    lastTap = frame;
    if (pick.z) tapped.set(pick.z.id + ':' + pick.z.hp, frame + Math.round(T.gap / FRAME) + delay + 1);
  }
  { const e = await page.evaluate(() => window.__game.state()); endScreen = e.screen; endTime = e.time; }
  for (const [id, p] of down) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  if (endScreen !== 'play') await page.evaluate(() => window.__step(90)); // let the game-over screen settle
  const fin = await page.evaluate(() => window.__game.state());
  const ui = await page.evaluate(() => ({ over: document.getElementById('over').classList.contains('show'), score: document.getElementById('overScore').textContent }));
  const pageErr = await page.evaluate(() => window.__errs);
  await ctx.close();
  return { mode, rep, seed, score: fin.score, time: +fin.time.toFixed(1), hits: fin.hits, maxCombo: fin.maxCombo, hearts: fin.hearts, wrongs: fin.wrongs, grid: fin.cols + 'x' + fin.rows,
    end: endScreen === 'play' ? 'cap' : (mode === 'survival' ? 'dead' : 'time'), endTime: +endTime.toFixed(1), heartLoss, ...st, dropLog, ui, errors: errors.concat(pageErr) };
}

// --- dedicated probes for the two known issues ---
async function probes(browser) {
  const out = {};
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(INIT(77));
  const page = await ctx.newPage();
  await page.goto(URL); await page.evaluate(() => window.__step(30));
  await page.evaluate(() => window.__game.start('survival'));
  await page.evaluate(() => window.__step(90));
  // 1) spurious auto-pause: window blur / focus churn / pagehide-less focus loss while visible
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }).catch(() => {});
  const p2 = await ctx.newPage(); await p2.bringToFront(); // focus moves to another tab
  const hiddenAfterSwitch = await page.evaluate(() => document.hidden);
  await page.evaluate(() => window.__step(30));
  out.blurPause = await page.evaluate(() => window.__game.state().screen);
  out.hiddenAfterTabSwitch = hiddenAfterSwitch;
  await page.bringToFront(); await p2.close();
  // real visibility change still pauses? (CDP lifecycle hidden is not available headless; use emulated visibility)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  out.hiddenPause = await page.evaluate(() => window.__game.state().screen);
  await ctx.close();
  // 2) fast taps: N fingers in the SAME touchstart event, and taps 1 frame apart with overlapping holds
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx2.addInitScript(INIT(78));
  const pg = await ctx2.newPage(); await pg.goto(URL); await pg.evaluate(() => window.__step(30));
  await pg.evaluate(() => window.__game.start('timed'));
  const c2 = await ctx2.newCDPSession(pg);
  let s = await pg.evaluate(() => window.__step(60));
  const res = { simultaneous: { tried: 0, registered: 0 }, perFrame: { tried: 0, registered: 0 } };
  for (let k = 0; k < 900 && s.screen !== 'over'; k++) {
    s = await pg.evaluate(() => window.__step(1));
    const L = s.graves.filter(g => g.z && live(g.z) && g.z.type !== 'cat');
    if (L.length >= 2 && res.simultaneous.tried < 40) { // two zombies, two fingers, one touchstart event
      const a = L[0], b = L[1];
      const pa = { x: a.cx, y: Math.max(zbox(a).y0 + 20 * a.w / 100, a.holeY - 45 * a.w / 100), id: 900 + k * 2 }, pb = { x: b.cx, y: Math.max(zbox(b).y0 + 20 * b.w / 100, b.holeY - 45 * b.w / 100), id: 901 + k * 2 };
      const h0 = s.hits + (a.z.hp > 1 ? 1 : 0) * 0;
      const before = [a.z.hp, b.z.hp, a.z.phase, b.z.phase];
      await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pa, pb] });
      const s2 = await pg.evaluate(() => window.__game.state());
      res.simultaneous.tried += 2;
      for (const [g, i] of [[a, 0], [b, 1]]) { const z2 = s2.graves[g.i].z; if (!z2 || z2.phase !== before[2 + i] || z2.hp !== before[i]) res.simultaneous.registered++; }
      await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      s = s2;
    } else if (L.length === 1 && res.perFrame.tried < 60) { // rapid same-spot double taps 1 frame apart, first finger still down
      const a = L[0]; const p = { x: a.cx, y: Math.max(zbox(a).y0 + 20 * a.w / 100, a.holeY - 45 * a.w / 100) };
      const hp0 = a.z.hp, ph0 = a.z.phase;
      await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 5000 + k }] });
      const s2 = await pg.evaluate(() => window.__game.state()); const z2 = s2.graves[a.i].z;
      res.perFrame.tried++; if (!z2 || z2.phase !== ph0 || z2.hp !== hp0) res.perFrame.registered++;
      s = await pg.evaluate(() => window.__step(1));
      const z3 = s.graves[a.i].z;
      if (z3 && live(z3)) { await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 5000 + k }, { ...p, x: p.x + 3, id: 6000 + k }] }); const s3 = await pg.evaluate(() => window.__game.state()); const z4 = s3.graves[a.i].z; res.perFrame.tried++; if (!z4 || z4.phase !== z3.phase || z4.hp !== z3.hp) res.perFrame.registered++; }
      await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
  }
  await ctx2.close();
  // 3) rush mode: two fingers in ONE touchstart event - finger A on the stage-3 zombie, finger B on the stage-2 one
  // (A's hit promotes B's zombie to stage 3 before B is processed, so both must count: hits +2, wrongs +0)
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx3.addInitScript(INIT(79));
  const p3 = await ctx3.newPage(); await p3.goto(URL); await p3.evaluate(() => window.__step(30));
  await p3.evaluate(() => window.__game.start('rush'));
  const c3 = await ctx3.newCDPSession(p3);
  s = await p3.evaluate(() => window.__step(70));
  res.rushPair = { events: 0, fingers: 0, hitsGained: 0, wrongs: 0 };
  for (let k = 0; k < 40 && s.screen === 'play'; k++) {
    const A = s.graves.find(g => g.z && g.z.phase === 'stage' && g.z.stage === 3), B = s.graves.find(g => g.z && g.z.phase === 'stage' && g.z.stage === 2);
    if (A && B) {
      const h0 = s.hits, w0 = s.wrongs;
      await c3.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: A.tap.x, y: A.tap.y, id: 1 }, { x: B.tap.x, y: B.tap.y, id: 2 }] });
      const s2 = await p3.evaluate(() => window.__game.state());
      res.rushPair.events++; res.rushPair.fingers += 2; res.rushPair.hitsGained += s2.hits - h0; res.rushPair.wrongs += s2.wrongs - w0;
      await c3.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    s = await p3.evaluate(() => window.__step(30));
  }
  await ctx3.close();
  out.fastTap = res;
  return out;
}

async function main() {
  const tiers = process.argv[2] === 'probeonly' ? [] : (process.argv[2] || Object.keys(TIERS).join(',')).split(',').filter(Boolean);
  const resFile = path.join(OUT, 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'push-zombie', tiers: {}, findings: [] };
  let browser = await chromium.launch({ headless: true });
  if (process.argv[3] === 'probe' || process.argv[2] === 'probeonly') { results.probes = await probes(browser); console.log('probes', JSON.stringify(results.probes)); fs.writeFileSync(resFile, JSON.stringify(results, null, 1)); }
  for (const tierId of tiers) {
    const T = TIERS[tierId]; const runs = [];
    for (const [mode, rep] of RUNS) {
      const seed = 1000 * (Object.keys(TIERS).indexOf(tierId) + 1) + { survival: 0, timed: 50, rush: 70 }[mode] + rep;
      let r;
      for (let k = 0; k < 3; k++) { try { r = await runOne(browser, T, tierId, mode, rep, seed); break; } catch (e) { console.log('HARNESS ERROR', tierId, mode, rep, String(e).slice(0, 200)); try { await browser.close(); } catch (_) {} browser = await chromium.launch({ headless: true }); } }
      if (!r) continue;
      runs.push(r); console.log(tierId, JSON.stringify(r));
    }
    const sum = {};
    for (const m of ['survival', 'timed', 'rush']) { const rs = runs.filter(r => r.mode === m); if (!rs.length) continue; const sc = rs.map(r => r.score).sort((a, b) => a - b); sum[m] = { scores: sc, median: sc[Math.floor(sc.length / 2)], survivalSec: rs.map(r => r.time) }; }
    const tot = runs.reduce((a, r) => ({ taps: a.taps + r.taps, onTarget: a.onTarget + r.onTarget, dropped: a.dropped + r.dropped, doubled: a.doubled + r.doubled, overlapTaps: a.overlapTaps + r.overlapTaps }), { taps: 0, onTarget: 0, dropped: 0, doubled: 0, overlapTaps: 0 });
    results.tiers[tierId] = { runs, summary: { ...sum, input: tot, errors: runs.reduce((n, r) => n + r.errors.length, 0) } };
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await browser.close();
}
module.exports = { INIT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
