// Shot Zombie skill-tier bot. Usage: node bot.js [tier,...] [probe]
// Reads window.__game.state()/layout() (read-only); shoots only through CDP touchStart/touchEnd taps on the lane
// buttons drawn on the canvas (fingers may overlap). Clock lock-stepped (rAF driven by harness, 16.67ms/frame),
// Math.random seeded. Every tap is verified against the state at that exact instant: a tap on a lane while the
// game is in play and not jammed must change shots/wrong; otherwise it is counted as DROPPED.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const URL = 'file:///mnt/project-files/apps/shot-zombie/index.html';
const OUT = __dirname;
const FRAME = 1000 / 60;

const TIERS = {
  clumsy:     { react: [650, 200], pos: 40, tim: 120, mistake: 0.15, policy: 'clumsy', gap: 300, hold: 120, look: 1 },
  casual:     { react: [400, 100], pos: 20, tim: 60, mistake: 0.06, policy: 'greedy', gap: 200, hold: 90, look: 1 },
  skilled:    { react: [260, 50], pos: 10, tim: 30, mistake: 0.02, policy: 'plan', gap: 140, hold: 80, look: 2 },
  world:      { react: [180, 25], pos: 4, tim: 12, mistake: 0.003, policy: 'plan', gap: 90, hold: 70, look: 4 },
  superhuman: { react: [16, 0], pos: 0, tim: 0, mistake: 0, policy: 'perfect', gap: 16, hold: 16, look: 99 },
};
const RUNS = process.env.SZRUNS ? JSON.parse(process.env.SZRUNS) : [['surv', 1], ['surv', 2], ['surv', 3], ['ta', 1], ['rapid', 1]];
const CAP = { surv: 300, ta: 120, rapid: 35 };

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

// the order in which zombies must be shot, as far as the player can see (closest first; survivors skipped)
function targetSeq(s, VIS) {
  if (s.mode === 'rapid') return s.ents.map(e => ({ id: e.id, lane: e.lane, hp: 1 }));
  return s.ents.filter(e => e.type === 'z' && e.y > VIS).sort((a, b) => b.y - a.y).map(e => ({ id: e.id, lane: e.lane, hp: e.hp }));
}

async function runOne(browser, T, tierId, mode, rep, seed) {
  const rnd = mulberry32(seed);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(INIT(seed));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL);
  await page.evaluate(() => window.__step(20));
  const bb = await page.locator({ surv: '#mSurv', ta: '#mTA', rapid: '#mRapid' }[mode]).boundingBox();
  await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
  const VIS = await page.evaluate(() => window.__game.VIS);
  const cdp = await ctx.newCDPSession(page);
  const down = new Map(); let nextId = 1;
  const pts = () => [...down.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  let s = await page.evaluate(() => window.__step(1));
  if (s.phase !== 'play') throw new Error('did not start ' + s.phase);
  let L = await page.evaluate(() => window.__game.layout());
  let frame = 0, lastTap = -1e9;
  const hist = [s]; // observed states for reaction delay
  const st = { taps: 0, dropped: 0, doubled: 0, jammedTaps: 0, overlapTaps: 0, mistakes: 0, randomPicks: 0, laneSlips: 0 };
  const dropLog = []; const pending = []; let plannedShots = 0; // shots already sent the delayed view doesn't show yet
  const cap = (CAP[mode] + 3) * 60; let seenWrong = s.wrong, resync = false, endPhase = null, endTime = null;
  while (frame < cap) {
    s = await page.evaluate(() => window.__step(1)); frame++;
    s.__taps = st.taps; hist.push(s); if (hist.length > 90) hist.shift(); // __taps: taps sent before this snapshot
    if (s.phase === 'over' || s.phase === 'ending') break;
    if (s.phase === 'pause') { st.paused = true; break; }
    for (const [id, p] of [...down.entries()]) if (frame >= p.upAt) { down.delete(id); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] }); }
    if (s.lanes !== L.lanes) L = await page.evaluate(() => window.__game.layout());
    pending.sort((a, b) => a.at - b.at);
    while (pending.length && pending[0].at <= frame) {
      const p = pending.shift();
      const before = s;
      const lane = Math.floor((p.x - L.playX) / L.laneW);
      if (lane !== p.lane) st.laneSlips++;
      const id = nextId++; if (down.size) st.overlapTaps++;
      down.set(id, { x: p.x, y: p.y, upAt: frame + Math.max(1, Math.round((T.hold + Math.abs(gauss(rnd) * T.tim * 0.5)) / FRAME)) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() });
      st.taps++;
      const after = await page.evaluate(() => window.__game.state());
      const valid = before.phase === 'play' && lane >= 0 && lane < before.lanes && p.y >= L.fieldTop;
      const jammed = before.mode === 'rapid' && before.stun > 0;
      const anyTarget = before.mode === 'rapid' ? before.ents.length > 0 : before.ents.some(e => e.type === 'z' && e.y > VIS);
      // shots isn't exposed: effect = kills + wrong taps + armour plates knocked off
      const hpZ = st_ => st_.ents.reduce((n, e) => n + (e.type === 'z' ? e.hp : 0), 0);
      const delta = (after.kills - before.kills) + (after.wrong - before.wrong) + (before.mode !== 'rapid' && hpZ(before) - hpZ(after) - (after.kills - before.kills) > 0 ? 1 : 0);
      if (jammed) st.jammedTaps++;
      else if (valid && anyTarget) {
        if (delta === 0) { st.dropped++; if (dropLog.length < 10) dropLog.push({ t: +before.time.toFixed(2), lane, fingersDown: down.size }); }
        if (delta > 1) st.doubled++;
      }
      s = after;
    }
    if ((frame - lastTap) * FRAME < T.gap) continue;
    // perception: the delayed screen
    const d = Math.max(1, Math.round(Math.max(16, T.react[0] + gauss(rnd) * T.react[1]) / FRAME));
    const ob = hist[Math.max(0, hist.length - 1 - d)];
    if (ob.phase !== 'play') continue;
    if (ob.mode === 'rapid' && ob.stun > 0) continue;
    // how many of my own shots has the delayed view not caught up with yet?
    const inflight = (st.taps - (ob.__taps || 0)) + pending.length; // taps the delayed view can't show yet (incl. armour hits)
    const seq = targetSeq(ob, VIS);
    // expand armored zombies (2 shots) into the sequence
    const shots = []; for (const z of seq) for (let k = 0; k < z.hp; k++) shots.push(z.lane);
    let idx = inflight; // planners skip what they already shot; simple players wait to see the result
    // a miss becomes visible (after the reaction delay): stop playing ahead until the screen catches up with every tap sent
    if (ob.wrong > seenWrong) { seenWrong = ob.wrong; resync = true; }
    if (resync) { if (inflight > 0) continue; resync = false; }
    if (T.look <= 1 && inflight > 0) continue;
    if (idx >= Math.min(shots.length, T.look + (T.look > 1 ? 0 : 0))) continue;
    if (idx >= shots.length) continue;
    let lane = shots[idx];
    if ((T.policy === 'clumsy' && rnd() < 0.5) || (T.policy === 'greedy' && rnd() < 0.15)) {
      // "random legal move": shoot a lane that has something in it
      const lanes = [...new Set(ob.ents.filter(e => e.y > VIS).map(e => e.lane))];
      if (lanes.length) { const r = lanes[Math.floor(rnd() * lanes.length)]; if (r !== lane) st.randomPicks++; lane = r; }
    }
    if (rnd() < T.mistake) { st.mistakes++; lane = (lane + 1 + Math.floor(rnd() * (ob.lanes - 1))) % ob.lanes; }
    const cx = L.playX + L.laneW * (lane + 0.5), cy = L.btnTop + L.btnH / 2;
    const x = Math.max(1, Math.min(389, cx + gauss(rnd) * T.pos)), y = Math.max(L.fieldTop + 2, Math.min(843, cy + gauss(rnd) * T.pos));
    pending.push({ at: frame + Math.round(Math.abs(gauss(rnd) * T.tim) / FRAME), x, y, lane });
    lastTap = frame;
  }
  { const e = await page.evaluate(() => window.__game.state()); endPhase = e.phase; endTime = e.time; }
  for (const [id, p] of down) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id }] });
  if (endPhase !== 'play') await page.evaluate(() => window.__step(120)); // let the result screen settle
  const fin = await page.evaluate(() => window.__game.state());
  const pageErr = await page.evaluate(() => window.__errs);
  const resText = await page.evaluate(() => document.getElementById('resCard') ? document.getElementById('resCard').innerText.replace(/\s+/g, ' ').slice(0, 160) : '');
  await ctx.close();
  return { mode, rep, seed, score: fin.score, kills: fin.kills, time: +fin.time.toFixed(2), penalty: fin.penalty, wrong: fin.wrong, rescued: fin.rescued, hearts: fin.hearts, lanes: fin.lanes,
    end: endPhase === 'play' ? 'cap' : fin.phase, endTime: +endTime.toFixed(2), ...st, dropLog, resText, errors: errors.concat(pageErr) };
}

async function probes(browser) {
  // fast-tap probe in 速射 (rapid): k fingers in one touchstart, then one tap per frame with overlapping holds
  const out = {};
  for (const [name, perEvent, everyN] of [['twoFingersSameEvent', 2, 2], ['onePerFrameOverlapping', 1, 1], ['threeFingersSameEvent', 3, 1]]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(INIT(91));
    const page = await ctx.newPage(); await page.goto(URL); await page.evaluate(() => window.__step(20));
    await page.evaluate(() => window.__game.start('rapid'));
    const L = await page.evaluate(() => window.__game.layout());
    const cdp = await ctx.newCDPSession(page);
    let s = await page.evaluate(() => window.__step(1)); let id = 1, tried = 0, reg = 0, held = [];
    for (let f = 0; f < 60 * 31 && s.phase === 'play'; f++) {
      if (f % everyN === 0 && s.stun === 0) {
        const lanes = s.slots.slice(0, perEvent); const k0 = s.kills;
        const fresh = lanes.map(l => ({ x: L.playX + L.laneW * (l + 0.5), y: L.btnTop + L.btnH / 2, id: id++ }));
        held = held.concat(fresh);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: held });
        const s2 = await page.evaluate(() => window.__game.state());
        tried += fresh.length; reg += s2.kills - k0 + (s2.wrong - s.wrong);
        if (held.length > 4) { const gone = held.splice(0, held.length - 2); for (const g of gone) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [g] }); }
      }
      s = await page.evaluate(() => window.__step(1));
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.evaluate(() => window.__step(120));
    const fin = await page.evaluate(() => window.__game.state());
    out[name] = { tried, registered: reg, kills30s: fin.kills, wrong: fin.wrong, killsPerSec: +(fin.kills / 30).toFixed(1) };
    await ctx.close();
  }
  // blur does not pause; hidden does
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(INIT(92));
  const page = await ctx.newPage(); await page.goto(URL); await page.evaluate(() => window.__step(20));
  await page.evaluate(() => window.__game.start('surv')); await page.evaluate(() => window.__step(30));
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); });
  out.blurPhase = (await page.evaluate(() => window.__step(10))).phase;
  await ctx.close();
  return out;
}

async function main() {
  const tiers = (process.argv[2] || Object.keys(TIERS).join(',')).split(',').filter(Boolean);
  const resFile = path.join(OUT, 'results.json');
  const results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'shot-zombie', tiers: {}, findings: [] };
  let browser = await chromium.launch({ headless: true });
  if (process.argv[3] === 'probe') { results.probes = await probes(browser); console.log('probes', JSON.stringify(results.probes)); fs.writeFileSync(resFile, JSON.stringify(results, null, 1)); }
  for (const tierId of tiers) {
    const T = TIERS[tierId]; const runs = [];
    for (const [mode, rep] of RUNS) {
      const seed = 1000 * (Object.keys(TIERS).indexOf(tierId) + 1) + { surv: 0, ta: 50, rapid: 70 }[mode] + rep;
      let r;
      for (let k = 0; k < 3; k++) { try { r = await runOne(browser, T, tierId, mode, rep, seed); break; } catch (e) { console.log('HARNESS ERROR', tierId, mode, rep, String(e).slice(0, 200)); try { await browser.close(); } catch (_) {} browser = await chromium.launch({ headless: true }); } }
      if (!r) continue;
      runs.push(r); console.log(tierId, JSON.stringify(r));
    }
    const sum = {};
    for (const m of ['surv', 'ta', 'rapid']) { const rs = runs.filter(r => r.mode === m); if (!rs.length) continue; sum[m] = { scores: rs.map(r => r.score), kills: rs.map(r => r.kills), times: rs.map(r => r.time + (m === 'ta' ? r.penalty : 0)) }; }
    const tot = runs.reduce((a, r) => ({ taps: a.taps + r.taps, dropped: a.dropped + r.dropped, doubled: a.doubled + r.doubled, overlapTaps: a.overlapTaps + r.overlapTaps }), { taps: 0, dropped: 0, doubled: 0, overlapTaps: 0 });
    results.tiers[tierId] = { runs, summary: { ...sum, input: tot, errors: runs.reduce((n, r) => n + r.errors.length, 0) } };
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await browser.close();
}
module.exports = { INIT };
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
