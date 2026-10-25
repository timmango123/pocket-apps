// 坦克大戰 (tank-battle) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...] [--out=results.json]
// Reads the game through window.__game.sim() (a read-only snapshot built by __obs in the page) and acts ONLY through
// real CDP touch events: one finger on the joystick (#pad), a second finger tapping the fire button (#fireBtn).
// The clock is lock-stepped (harness LOCKSTEP), so a run is deterministic for a seed and faster than real time.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = process.env.TB_APP ? path.resolve(process.env.TB_APP) : path.resolve(__dirname, '../../../apps/tank-battle/index.html');
const html = fs.readFileSync(APP, 'utf8');
const TB = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TB;')();
const { DX, DY } = TB;

const args = process.argv.slice(2);
const TIER_LIST = args.filter(a => H.TIERS[a]).length ? args.filter(a => H.TIERS[a]) : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const outArg = args.find(a => a.startsWith('--out='));
const OUT = path.join(__dirname, outArg ? outArg.slice(6) : 'results.json');
const CAP_S = 300;   // sim seconds per attempt (levels normally end in 40-150 s)

// Decision model per tier, on top of the shared reaction / motor / mistake numbers in harness.js.
//  every: frames between looks at the screen; policy:
//   clumsy  - half the looks pick a random heading, otherwise the brain without dodging or shell interception
//   casual  - the brain without dodging, 15 % random headings
//   skilled - the full brain (dodges, intercepts shells aimed at the base)
//   world   - the look-ahead planner on the delayed screen (it guesses the enemies' dice: samples)
//   superhuman - the look-ahead planner on the live state with the real dice (exact prediction)
const MODEL = {
  clumsy: { every: 12, policy: 'brain', random: 0.5, hold: 30, brain: { dodge: false, intercept: false, items: false, guard: 0.6, home: 0 }, tapGap: 20, fireP: 0.6 },
  casual: { every: 8, policy: 'brain', random: 0.15, hold: 16, brain: { dodge: false, intercept: false, guard: 1, home: 0.15 }, tapGap: 10, fireP: 0.85, contact: true },
  skilled: { every: 5, policy: 'brain', random: 0, brain: {}, tapGap: 7, fireP: 1, contact: true },
  world: { every: 4, policy: 'plan', samples: 1, exact: false, tapGap: 6, fireP: 1, contact: true },
  superhuman: { every: 2, policy: 'plan', samples: 1, exact: true, tapGap: 7, fireP: 1 }
};
const PAD_PUSH = 46;

const OBS = `window.__obs = () => { const g = window.__game, s = g && g.sim(); if (!s) return null; const st = g.state();
  const c = {}; for (const k in s) { const v = s[k]; if (typeof v === 'function' || k === 'events') continue; c[k] = v; }
  c.grid = Array.from(s.grid); c.tanks = s.tanks.map(t => Object.assign({}, t)); c.bullets = s.bullets.map(b => Object.assign({}, b));
  c.queue = s.queue.map(q => Object.assign({}, q)); c.item = s.item ? Object.assign({}, s.item) : null;
  c._mode = st.mode; c._hold = st.hold; c._playing = st.playing; c._level = st.level; return c; };`;

function mkSim(o) { return TB.cloneSim(o); }
function contactAhead(s) {
  const p = s.tanks[0];
  for (let i = 1; i < s.tanks.length; i++) { const e = s.tanks[i]; if (!e.alive || e.spawnT > 0) continue; const ax = e.x - p.x, ay = e.y - p.y, al = DX[p.dir] * ax + DY[p.dir] * ay, cr = DX[p.dir] ? Math.abs(ay) : Math.abs(ax); if (al > 0 && al < 3.2 && cr < 1.9) return true; }
  return false;
}

class Fingers {
  constructor(P, padBox, fireBox) { this.P = P; this.pad = padBox; this.fire = fireBox; this.padPt = null; this.dir = -1; this.want = -1; this.firePt = null; this.stats = { moves: 0, lifts: 0, taps: 0, misdir: 0 }; }
  pts() { const a = []; if (this.padPt) a.push({ x: this.padPt.x, y: this.padPt.y, id: 1 }); if (this.firePt) a.push({ x: this.firePt.x, y: this.firePt.y, id: 2 }); return a; }
  async setDir(d) {
    const P = this.P;
    if (d < 0) { if (this.padPt) { const pt = this.padPt; this.padPt = null; await P.touch('touchEnd', [{ x: pt.x, y: pt.y, id: 1 }]); this.stats.lifts++; } this.dir = -1; this.want = -1; return; }
    const cx = this.pad.x + this.pad.width / 2, cy = this.pad.y + this.pad.height / 2;
    const sg = P.t.pos / 3, x = cx + DX[d] * PAD_PUSH + (sg ? P.rng.gauss(0, sg) : 0), y = cy + DY[d] * PAD_PUSH + (sg ? P.rng.gauss(0, sg) : 0);
    const actual = Math.hypot(x - cx, y - cy) < 10 ? -1 : (Math.abs(x - cx) > Math.abs(y - cy) ? (x > cx ? 1 : 3) : (y > cy ? 2 : 0));
    if (actual !== d) this.stats.misdir++;
    const was = !!this.padPt; this.padPt = { x, y };
    await P.touch(was ? 'touchMove' : 'touchStart', this.pts());
    this.stats.moves++; this.dir = actual; this.want = d;
  }
  async fireDown() {
    const P = this.P, b = this.fire, s = Math.min(P.t.pos, 34);
    this.firePt = { x: b.x + b.width / 2 + (s ? P.rng.gauss(0, s) : 0), y: b.y + b.height / 2 + (s ? P.rng.gauss(0, s) : 0) };
    await P.touch('touchStart', this.pts()); this.stats.taps++; P.stats.taps++;
  }
  async fireUp() { if (!this.firePt) return; const pt = this.firePt; this.firePt = null; await P_touchEnd(this.P, pt); }
}
async function P_touchEnd(P, pt) { await P.touch('touchEnd', [{ x: pt.x, y: pt.y, id: 2 }]); }

function decide(M, s, rng, prevRef) {
  if (M.policy === 'plan') return TB.planDecide(s, { prev: prevRef.prev, exact: M.exact, samples: M.samples, seed: Math.floor(rng() * 1e6) });
  if (M.random && rng() < M.random) return { dir: rng.int(5) - 1, fire: rng() < 0.4, random: true };
  return TB.brainDecide(s, Object.assign({ prev: prevRef.prev }, M.brain));
}

async function playRun(P, M, n) {
  const page = P.page, rng = P.rng, stepN = 2;
  await page.evaluate(n => window.__game.startStage(n), n);
  const padBox = await page.locator('#pad').boundingBox(), fireBox = await page.locator('#fireBtn').boundingBox();
  const F = new Fingers(P, padBox, fireBox);
  let o = await page.evaluate(() => window.__step(1, true));
  // skip the level intro (banner); the game ignores input then
  while (o._hold > 0) o = await page.evaluate(() => window.__step(6, true));
  const buf = [o]; let frame = 0, nextDec = 0, dec = { dir: -1, fire: false }, prevRef = { prev: null }, decisions = 0, randoms = 0, mistakes = 0;
  let wrongDir = -1, wrongUntil = 0, holdUntil = 0, lastTap = -99, tapUp = -1, end = null;
  const deaths = [], baseHits = [];
  let lastLost = o.livesLost, lastBase = o.baseHp;
  const t0 = Date.now(), cap = CAP_S * 60;
  while (frame < cap && Date.now() - t0 < 600000) {
    o = await page.evaluate(n => window.__step(n, true), stepN); frame += stepN;
    buf.push(o); if (buf.length > 60) buf.shift();
    if (o.livesLost > lastLost) deaths.push(+o.time.toFixed(1)); lastLost = o.livesLost;
    if (o.baseHp < lastBase) baseHits.push(+o.time.toFixed(1)); lastBase = o.baseHp;
    if (o.status !== 'play') { end = o.status; break; }
    if (tapUp >= 0 && frame >= tapUp) { await F.fireUp(); tapUp = -1; }
    const me = o.tanks[0];
    if (!me.alive) { if (F.padPt) await F.setDir(-1); continue; }
    if (frame >= nextDec) {
      nextDec = frame + M.every;
      const d = Math.max(0, Math.round(P.reactMs() / H.FRAME / stepN));
      const ob = buf[Math.max(0, buf.length - 1 - d)];
      if (ob.status === 'play' && ob.tanks[0].alive) {
        // decide on the delayed screen; own tank position and gun are known exactly (proprioception)
        // shells on screen are seen moving: a player extrapolates them over the reaction delay
        const lag = (buf.length - 1 - Math.max(0, buf.length - 1 - d)) * stepN / 60;
        const shells = ob.bullets.map(b => Object.assign({}, b, { x: b.x + DX[b.dir] * b.speed * lag, y: b.y + DY[b.dir] * b.speed * lag })).filter(b => b.x > 0 && b.y > 0 && b.x < 26 && b.y < 26);
        const snap = Object.assign({}, ob, { bullets: shells, tanks: ob.tanks.map((t, i) => i === 0 ? Object.assign({}, t, { x: me.x, y: me.y, dir: me.dir, cool: me.cool, power: me.power }) : t) });
        const s = mkSim(M.exact ? o : snap);
        if (frame >= holdUntil) {
          const r = decide(M, s, rng, prevRef); decisions++;
          if (r.random) { randoms++; holdUntil = frame + (M.hold || 0); }
          else prevRef.prev = r;
          dec = r;
          if (P.mistake()) { wrongDir = rng.int(4); wrongUntil = frame + M.every * 2; mistakes++; }
        }
      }
    }
    // a tank right in front of ours fills the screen and stops our tank: everyone above clumsy shoots it at once
    if (M.contact && !dec.fire && contactAhead(o)) dec = Object.assign({}, dec, { fire: true });
    // fire: tap the button (a second finger) when the plan says so, no faster than the tier can tap
    if (dec.fire && tapUp < 0 && frame - lastTap >= M.tapGap && rng() < M.fireP) {
      const late = Math.abs(P.timingErr()) / H.FRAME;
      if (late < 1 || rng() < 0.5) { await F.fireDown(); lastTap = frame; tapUp = frame + (P.superhuman ? 2 : 4 + rng.int(3)); }
    }
    const want = frame < wrongUntil ? wrongDir : dec.dir;
    if (want !== F.want) await F.setDir(want);
  }
  if (tapUp >= 0) await F.fireUp();
  if (F.padPt) await F.setDir(-1);
  const res = { level: n, cleared: end === 'won', end: end || 'timeout', reason: o.reason, time: +o.time.toFixed(1), livesLost: o.livesLost, baseHp: o.baseHp, kills: o.kills, total: o.total,
    stars: end === 'won' ? (o.livesLost === 0 ? (o.baseHp === o.baseMax ? 3 : 2) : o.livesLost === 1 ? 2 : 1) : 0, deaths, baseHits, decisions, randoms, mistakes, input: F.stats, ms: Date.now() - t0 };
  await page.evaluate(() => window.__step(200));
  res.overlay = await page.evaluate(() => !document.getElementById('ovResult').hidden);
  const ist = await page.evaluate(() => window.__game.inputStats());
  res.fireTaps = F.stats.taps; res.inputStats = ist;
  return res;
}

async function runTier(browser, tierId, idx) {
  const M = MODEL[tierId], att = H.TIERS[tierId].attempts;
  const sess = await H.newSession(browser, 'file://' + APP, H.LOCKSTEP(777 + idx * 101) + OBS);
  const P = new H.Player(sess, tierId, 1000 + idx * 7919);
  await sess.page.evaluate(() => { try { localStorage.setItem('tank-battle:v1:mute', 'true'); localStorage.setItem('tank-battle:v1:played', 'true'); } catch (e) {} });
  await sess.page.reload(); await sess.page.evaluate(() => window.__step(5));
  const runs = [];
  let tapsSent = 0, downsSeen0 = await sess.page.evaluate(() => window.__game.inputStats().fireDowns);
  for (const n of TEST_LEVELS) {
    const run = { level: n, attempts: [], cleared: false };
    for (let a = 1; a <= att; a++) {
      const r = await playRun(P, M, n);
      run.attempts.push(r); tapsSent += r.fireTaps;
      if (r.cleared) { run.cleared = true; break; }
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, stars: last.stars || 0, time: last.time });
    runs.push(run);
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} stars=${run.stars} t=${last.time}s lost=${last.livesLost} base=${last.baseHp} kills=${last.kills}/${last.total} ${last.end}/${last.reason} ${(run.attempts.reduce((s, x) => s + x.ms, 0) / 1000).toFixed(0)}s wall`);
    fs.writeFileSync(path.join(__dirname, `partial-${tierId}.json`), JSON.stringify({ runs, errors: sess.errors }, null, 1));
  }
  const downsSeen = (await sess.page.evaluate(() => window.__game.inputStats().fireDowns)) - downsSeen0;
  const pageErr = await sess.page.evaluate(() => window.__errs);
  const errors = sess.errors.concat(pageErr);
  await sess.ctx.close();
  try { fs.unlinkSync(path.join(__dirname, `partial-${tierId}.json`)); } catch (e) {}
  const cl = runs.filter(r => r.cleared);
  return { runs, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, fireTapsSent: tapsSent, fireDownsSeen: downsSeen, pageErrors: errors.length } };
}

module.exports = { TB, MODEL };
if (require.main === module) (async () => {
  const browser = await H.launch();
  const out = fs.existsSync(OUT) && outArg ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'tank-battle', testedLevels: TEST_LEVELS, timeCap: CAP_S + ' s of game time per attempt', tiers: {}, findings: [] };
  const t0 = Date.now();
  for (const tid of TIER_LIST) {
    out.tiers[tid] = await runTier(browser, tid, H.TIER_IDS.indexOf(tid));
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
  out.wallSeconds = Math.round((Date.now() - t0) / 1000);
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('done', TIER_LIST.map(t => t + ':' + out.tiers[t].summary.cleared + ' taps ' + out.tiers[t].summary.fireTapsSent + '/' + out.tiers[t].summary.fireDownsSeen).join(' | '), 'wall', out.wallSeconds + 's');
})().catch(e => { console.error(e); process.exit(1); });
