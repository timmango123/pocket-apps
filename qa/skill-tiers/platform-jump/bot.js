// 平台跳躍 skill-tier bot. Usage: node bot.js [tier,...] [level,...] [--attempts-cap N]
// Real headless Chromium, mobile context 390x844 (dpr 2, touch). The clock is lock-stepped (requestAnimationFrame and
// performance.now are driven by the harness, 16.67 ms per frame) so the game runs exactly one physics tick per frame.
// The bot READS the run state through window.__game.run() (what a player sees on screen) and ACTS only through real
// CDP touch events on the on-screen ◀ ▶ and jump keys: one finger for direction (it slides between ◀ and ▶), one for
// jump. Planning uses the game's own core (loaded from index.html) and the shared brain (brain.js / solver.js).
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SRC = path.resolve(__dirname, '../../../apps/platform-jump/index.html');
const html = fs.readFileSync(SRC, 'utf8');
const PJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PJ;')();
const { TIERS, Brain, mulberry32, gauss } = require('./brain.js');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const TIER_IDS = (args[0] || 'superhuman,world,skilled,casual,clumsy').split(',');
const LEVELS = (args[1] || '1,10,25,50,75,99,100').split(',').map(Number);
const OUT = process.env.OUT || path.join(__dirname, 'raw-results.json');
const FRAME = 1000 / 60;

const LOCKSTEP = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = [], fakeT = 1000, fc = 0;
  window.__errs = []; window.__drawEvery = 30;
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  performance.now = () => fakeT;
  const og = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (t, o) {
    const c = og.call(this, t, o);
    if (this.id === 'cv' && c && !c.__wrapped) {
      c.__wrapped = true; const P = Object.getPrototypeOf(c);
      for (const m of ['fill', 'stroke', 'fillRect', 'strokeRect', 'drawImage', 'fillText', 'strokeText', 'clearRect']) { const orig = P[m]; c[m] = function () { if (fc % window.__drawEvery === 0) return orig.apply(c, arguments); }; }
    }
    return c;
  };
  window.__step = n => { for (let i = 0; i < n; i++) { fakeT += ${FRAME}; fc++; const cur = q; q = []; for (const cb of cur) { try { cb(fakeT); } catch (e) { window.__errs.push(String(e && e.stack || e).slice(0, 300)); } } }
    const g = window.__game; return g ? g.run() : null; };
})();`;

function toRun(o) { const s = Object.assign({}, o); s.cr = Int16Array.from(o.cr || []); return s; }

async function playLevel(browser, tierId, n, seed) {
  const T = TIERS[tierId], rng = mulberry32(seed ^ 0x5bd1e995);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(LOCKSTEP(seed));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e && e.message || e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto('file://' + SRC);
  await page.evaluate(() => window.__step(30));
  // start the level the way a player does after choosing it (intro card skipped)
  await page.evaluate(n => window.__game.startLevel(n, { skipIntro: true }), n);
  const cdp = await ctx.newCDPSession(page);
  const keys = await page.evaluate(() => window.__game.keyRects());
  const center = r => [r.x + r.w / 2, r.y + r.h / 2];
  const L = PJ.genLevel(n), brain = new Brain(PJ, L, tierId, seed);
  // 非人 plays the full offline solver route (perfect information, frame-perfect) when one is stored for this exact layout
  const SOLS = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../apps/platform-jump/demo/solutions.json'), 'utf8')).levels;
  const route = tierId === 'superhuman' && SOLS[n] && SOLS[n].hash === PJ.levelHash(L) ? require('./solver.js').unrle(SOLS[n].inputs) : null;
  // touch state
  let dirF = null, jumpF = null, sent = { h: 0, j: false }, taps = 0, missTaps = 0;
  const pts = () => [dirF, jumpF].filter(Boolean);
  const aim = key => { const [x, y] = center(keys[key]); const s = T.pos; return s ? { x: x + gauss(rng) * s, y: y + gauss(rng) * s } : { x, y }; };
  // CDP: touchStart/touchMove take the active points, touchEnd takes the points being lifted
  async function touch(type, only) { const ps = only ? [only] : pts(); await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: ps.map(p => ({ x: p.x, y: p.y, id: p.id })) }); }
  async function apply(want) {
    if (want.h !== sent.h) {
      if (want.h === 0) { const f = dirF; dirF = null; await touch('touchEnd', f); }
      else if (!dirF) { const p = aim(want.h < 0 ? 'L' : 'R'); dirF = { id: 1, x: p.x, y: p.y }; taps++; await touch('touchStart'); }
      else { const p = aim(want.h < 0 ? 'L' : 'R'); dirF.x = p.x; dirF.y = p.y; await touch('touchMove'); } // slide to the other arrow
      sent.h = want.h;
    }
    if (want.j !== sent.j) {
      if (want.j) { const p = aim('J'); jumpF = { id: 2, x: p.x, y: p.y }; taps++; await touch('touchStart'); }
      else { const f = jumpF; jumpF = null; await touch('touchEnd', f); }
      sent.j = want.j;
    }
  }
  const cap = 60 * 240;
  let st = toRun(await page.evaluate(() => window.__game.run())), result = null, seen = 0, gameSaw = 0, stuck = 0, repress = 0;
  const t0 = Date.now();
  for (let now = 1; now <= cap; now++) {
    if (st.won) { result = 'cleared'; break; }
    if (Date.now() - t0 > 600000) { result = 'wall-clock cap (10 min of bot thinking)'; break; }
    if (st.deaths + (st.dead ? 1 : 0) >= T.attempts) { result = 'out of attempts'; break; }
    const want = route && st.deaths === 0 && now - 1 < route.length ? { h: (route[now - 1] >> 1) - 1, j: !!(route[now - 1] & 1) } : brain.act(st, now);
    if (process.env.TRACE && now < +process.env.TRACE) console.log(now, st.x.toFixed(3), st.y.toFixed(3), st.ground, st.t, st.ticks, JSON.stringify(want), st.deathT);
    // a person whose hero does not move although a thumb is on an arrow notices and presses again
    if (!st.dead && want.h && sent.h === want.h && st.ground && Math.abs(st.vx) < 0.05) stuck++; else stuck = 0;
    if (stuck > 30) { stuck = 0; repress++; const f = dirF; dirF = null; await touch('touchEnd', f); sent.h = 0; }
    await apply(st.dead ? { h: 0, j: false } : want);
    const o = await page.evaluate(() => window.__step(1));
    st = toRun(o);
  }
  if (!result) result = 'time cap';
  const inp = await page.evaluate(() => window.__game.input());
  const errs = errors.concat(await page.evaluate(() => window.__errs));
  const out = { level: n, tier: tierId, seed, cleared: result === 'cleared', end: result, deaths: st.deaths + (st.dead ? 1 : 0), time: +(st.ticks / 60).toFixed(1),
    gems: [0, 1, 2].filter(i => st.gems & (1 << i)).length, checkpoint: st.cp, x: +st.x.toFixed(1), levelWidth: L.w, jumpTouches: inp.presses, jumpsSeenByGame: inp.used,
    taps, represses: repress, replans: brain.stats.replans, planFails: brain.stats.planFails || 0, mistakes: brain.stats.mistakes, wallSec: +((Date.now() - t0) / 1000).toFixed(1), errors: errs };
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const res = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  for (const tier of TIER_IDS) {
    res[tier] = res[tier] || {};
    for (const n of LEVELS) {
      const r = await playLevel(browser, tier, n, 9000 + n * 13 + TIER_IDS.indexOf(tier) + (+process.env.SEEDOFS || 0));
      res[tier][n] = r;
      console.log(`${TIERS[tier].name}\tL${n}\t${r.cleared ? '過' : '✘'}\t${r.end}\tdeaths ${r.deaths}\t${r.time}s\tgems ${r.gems}\tx ${r.x}/${r.levelWidth}\tjump ${r.jumpTouches}/${r.jumpsSeenByGame}\terr ${r.errors.length}\t(${r.wallSec}s)`);
      fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
    }
  }
  await browser.close();
})();
