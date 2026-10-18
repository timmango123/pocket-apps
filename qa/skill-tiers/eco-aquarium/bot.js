// Skill-tier bot for 生態水族箱 (eco-aquarium), a sandbox tank keeper. Usage: node bot.js [tier,...] [--days N]
// Five keepers look after the sample tank for N tank days (default 14) in real headless Chromium (390x844 mobile, touch).
// The clock is lock-stepped: rAF + performance.now are virtualised at 100 ms/frame (the game caps dt at 0.1 s), and every
// keeper switches on the game's own 快轉 4× from the menu (a real tap), so one frame = 96 tank seconds. Math.random is seeded.
// Bots READ what a human sees (HUD text, the stats sheet, fish cards) through the DOM; superhuman reads window.__eco.st.
// They ACT only through touch: 餵食 / 換水 / 燈光 buttons and the ＋/－ buttons of the 生物 sheet (scrolled by touch drag).
// A tier = how well the keeper keeps the tank alive and clean: survival, births/deaths, quality score, hours in 危險.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = path.resolve(__dirname, '../../../apps/eco-aquarium/index.html');
const OUT = __dirname;
const FRAME = 100; // ms of virtual time per frame
const DAY = 86400, HOUR = 3600;
const args = process.argv.slice(2);
const DAYS = +(args[args.indexOf('--days') + 1] || 14);
const DBG = process.env.DBG ? (...a) => console.error('[dbg]', ...a) : () => {};
const onlyTiers = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a)).join(',').split(',').filter(Boolean);

const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, tim: 120, mistake: 0.15, every: [4, 20], policy: 'clumsy' },
  casual:     { name: '普通', react: [400, 100], pos: 20, tim: 60, mistake: 0.06, every: [6, 12], policy: 'casual' },
  skilled:    { name: '熟練', react: [260, 50], pos: 10, tim: 30, mistake: 0.02, every: [5, 7], policy: 'skilled' },
  world:      { name: '世界級', react: [180, 25], pos: 4, tim: 12, mistake: 0.003, every: [3, 5], policy: 'world' },
  superhuman: { name: '非人', react: [16, 0], pos: 0, tim: 0, mistake: 0, every: [1, 1], policy: 'perfect' },
};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(rnd) { let u = 0; while (u === 0) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); }

const INIT = seed => `(() => {
  ${mulberry32.toString()}
  Math.random = mulberry32(${seed});
  let q = new Map(), id = 0, t = 1000; window.__errs = [];
  window.requestAnimationFrame = cb => { q.set(++id, cb); return id; };
  window.cancelAnimationFrame = i => { q.delete(i); };
  performance.now = () => t;
  window.__vt = { step(n) { for (let i = 0; i < n; i++) { t += ${FRAME}; const c = [...q.values()]; q = new Map(); for (const f of c) { try { f(t); } catch (e) { window.__errs.push(String(e && e.stack || e)); } } } return t; } };
})();`;
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
function serve() { return new Promise(res => { const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(SRC, 'utf8') + '</body></html>'); }); srv.listen(0, () => res(srv)); }); }

class Keeper {
  constructor(page, cdp, T, rnd, log) { this.page = page; this.cdp = cdp; this.T = T; this.rnd = rnd; this.log = log; }
  async step(n) { await this.page.evaluate(n => window.__vt.step(n), n); }
  async box(sel) { return this.page.evaluate(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, bottom: r.bottom }; }, sel); }
  async touchAt(x, y) {
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    await this.step(1);
    await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.step(1);
  }
  // human-like tap on a selector: reaction delay (virtual frames), position noise; returns whether the finger landed on the element
  async tap(sel) {
    const T = this.T, r = this.rnd; DBG('tap', sel);
    const delay = Math.max(0, T.react[0] + gauss(r) * T.react[1] + Math.abs(gauss(r)) * T.tim);
    await this.step(Math.max(1, Math.round(delay / FRAME)));
    const b = await this.box(sel); if (!b) { this.log.missing.push(sel); return false; }
    const x = b.x + gauss(r) * T.pos * 0.5, y = b.y + gauss(r) * T.pos * 0.5;
    const hit = Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2 && x >= 0 && x <= 390 && y >= 0 && y <= 844;
    await this.touchAt(Math.max(1, Math.min(389, x)), Math.max(1, Math.min(843, y)));
    this.log.taps++; if (!hit) this.log.missed++;
    return hit;
  }
  async real(ms) { await new Promise(r => setTimeout(r, ms)); }
  async sheetOpen(id) { for (let i = 0; i < 20; i++) { await this.real(60); await this.step(1); if (await this.page.evaluate(id => { const el = document.getElementById(id); return !el.hidden && el.classList.contains('show') && el.getBoundingClientRect().top < 700; }, id)) { await this.real(350); return true; } } return false; }
  async openLife() { if (!await this.tap('#bLife')) return false; return this.sheetOpen('sheetLife'); }
  async openStats() { if (!await this.tap('#bStats')) return false; return this.sheetOpen('sheetStats'); }
  async closeSheet() { const open = await this.page.evaluate(() => [...document.querySelectorAll('.sheet')].find(s => !s.hidden)); if (!open) return; const id = await this.page.evaluate(() => [...document.querySelectorAll('.sheet')].find(s => !s.hidden).id); await this.tap('#' + id + ' [data-close]'); await this.real(380); await this.step(1); }
  // scroll the open sheet body by touch drag until the row is fully visible
  async bringIntoView(sel) {
    for (let k = 0; k < 6; k++) { DBG('scroll for', sel, k);
      const b = await this.box(sel); if (!b) return false;
      const body = await this.box('.sheet:not([hidden]) .body'); if (!body) return false;
      if (b.top >= body.top && b.bottom <= body.bottom) return true;
      const dy = b.top < body.top ? Math.min(250, body.top - b.top + 20) : -Math.min(250, b.bottom - body.bottom + 20);
      const x = body.x, y0 = body.y - dy / 2;
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
      for (let i = 1; i <= 8; i++) { await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + dy * i / 8, id: 1 }] }); await this.real(16); }
      await this.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await this.real(80); await this.step(1);
    }
    return false;
  }
  async lifeAction(kind, type, add) { // e.g. lifeAction('oto','fish',true)
    if (!await this.openLife()) return false;
    const sel = 'button[data-' + (add ? 'add' : 'rem') + '="' + type + ':' + kind + '"]';
    let ok = false;
    if (await this.bringIntoView(sel)) { const dis = await this.page.evaluate(s => document.querySelector(s).disabled, sel); if (!dis) ok = await this.tap(sel); }
    await this.closeSheet();
    if (ok) this.log.actions[add ? 'add' : 'remove']++;
    return ok;
  }
  // what a human reads
  async hud() { return this.page.evaluate(() => ({ q: document.getElementById('qlab').textContent, sub: document.getElementById('qsub').textContent, light: document.querySelectorAll('#lightDots i.on').length, clock: document.getElementById('clockT').textContent })); }
  async stats() {
    if (!await this.openStats()) return null;
    const txt = await this.page.evaluate(() => ({ rows: [...document.querySelectorAll('#statRows .stat')].map(r => r.textContent.replace(/\s+/g, ' ')), pop: document.getElementById('popRow').textContent }));
    await this.closeSheet();
    const num = (lab) => { const r = txt.rows.find(x => x.startsWith(lab)); const m = r && r.slice(lab.length).match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };
    const fish = +(txt.pop.match(/魚 (\d+) 隻/) || [0, 0])[1];
    return { ammonia: num('氨'), nitrate: num('硝酸鹽'), o2: num('氧氣'), algae: num('藻類'), detritus: num('殘渣'), load: num('負載'), fish, raw: txt };
  }
  async feed(n) { for (let i = 0; i < n; i++) { if (await this.tap('#bFeed')) this.log.actions.feed++; } }
  async water() { if (await this.tap('#bWater')) this.log.actions.water++; }
  async setLight(target) { let h = await this.hud(); let guard = 0; while (h.light !== target && guard++ < 4) { if (await this.tap('#bLight')) this.log.actions.light++; h = await this.hud(); } }
}

async function runTier(browser, base, tierId, T, seed) {
  const rnd = mulberry32(seed);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.addInitScript(INIT(seed));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(base + '/app/eco-aquarium/'); await new Promise(r => setTimeout(r, 300));
  const log = { tier: tierId, taps: 0, missed: 0, missing: [], actions: { feed: 0, water: 0, light: 0, add: 0, remove: 0 }, events: [], mistakes: 0, checkins: 0 };
  const K = new Keeper(page, cdp, T, rnd, log);
  await K.step(3);
  await K.tap('#bStart'); await K.step(2);
  // every keeper runs the tank on 快轉 4× (menu → 快轉), the game's own speed setting
  await K.tap('#bMenu'); await K.sheetOpen('sheetMenu'); await K.tap('#mSpeed'); await K.closeSheet();
  const speedOn = await page.evaluate(() => window.__eco.speed());
  if (speedOn !== 4) { await K.tap('#bMenu'); await K.sheetOpen('sheetMenu'); await K.tap('#mSpeed'); await K.closeSheet(); }
  const read = () => page.evaluate(() => { const s = window.__eco.st, q = window.__eco.ECO.quality(s); return { t: s.t, fish: s.fish.length, born: s.born, died: s.died, q: q.score, label: q.label, snails: s.cleaners.filter(c => c.kind === 'snail').length, cleaners: s.cleaners.length, plants: s.plants.length, load: window.__eco.ECO.load(s), hungry: s.fish.filter(f => f.hunger > 0.6).length, maxHunger: s.fish.reduce((m, f) => Math.max(m, f.hunger), 0), food: s.food.length, w: { a: s.water.ammonia, n: s.water.nitrate, o: s.water.o2, g: s.water.algae, b: s.water.bacteria }, det: s.detritus, light: s.light, speed: window.__eco.speed(), log: s.log.slice(0, 3).map(l => l.msg) }; });
  const s0 = await read(); const t0 = s0.t, tEnd = t0 + DAYS * DAY;
  const samples = []; let qSum = 0, qN = 0, qMin = 100, dangerH = 0, maxFish = s0.fish, maxSnails = s0.snails, lastSample = t0, nextCheck = t0, lastLogs = new Set();
  const perFrame = 0.1 * 240 * s0.speed; // tank seconds per frame
  while (true) {
    let s = await read(); if (s.t >= tEnd) break;
    if (s.t - lastSample >= HOUR) { lastSample = s.t; qSum += s.q; qN++; qMin = Math.min(qMin, s.q); if (s.label === '危險') dangerH++; maxFish = Math.max(maxFish, s.fish); maxSnails = Math.max(maxSnails, s.snails); if (qN % 6 === 0) samples.push({ day: +((s.t - t0) / DAY).toFixed(2), fish: s.fish, q: s.q, a: +s.w.a.toFixed(3), n: +s.w.n.toFixed(1), o: +s.w.o.toFixed(0), g: +s.w.g.toFixed(1), det: +s.det.toFixed(2), snails: s.snails, plants: s.plants, light: s.light }); }
    for (const m of s.log) if (!lastLogs.has(m)) { lastLogs.add(m); log.events.push([+((s.t - t0) / DAY).toFixed(2), m]); }
    if (s.t >= nextCheck) {
      log.checkins++; DBG('checkin day', ((s.t - t0) / DAY).toFixed(2), 'fish', s.fish);
      const [lo, hi] = T.every; nextCheck = s.t + (lo + rnd() * (hi - lo)) * HOUR;
      await act(K, T, rnd, s, log, read);
    }
    await K.step(Math.max(1, Math.min(60, Math.floor((nextCheck - s.t) / perFrame))));
  }
  const s1 = await read();
  const pageErr = await page.evaluate(() => window.__errs);
  const deaths = {}; for (const [, m] of log.events) { const k = /餓死/.test(m) ? '餓死' : /水質/.test(m) ? '水質' : /缺氧/.test(m) ? '缺氧' : /老去/.test(m) ? '老死' : /吃掉/.test(m) ? '被吃' : /生病/.test(m) ? '生病' : null; if (k) deaths[k] = (deaths[k] || 0) + 1; }
  const run = { tier: tierId, seed, days: DAYS, fishStart: s0.fish, fishEnd: s1.fish, born: s1.born - s0.born, died: s1.died - s0.died, deaths, maxFish, snailsEnd: s1.snails, maxSnails, plantsEnd: s1.plants, loadEnd: +s1.load.toFixed(1),
    avgQ: +(qSum / Math.max(1, qN)).toFixed(1), minQ: qMin, dangerHours: dangerH, endWater: { a: +s1.w.a.toFixed(3), n: +s1.w.n.toFixed(1), o: +s1.w.o.toFixed(0), g: +s1.w.g.toFixed(1) }, actions: log.actions, taps: log.taps, missedTaps: log.missed, mistakes: log.mistakes, checkins: log.checkins, missingSelectors: log.missing, samples, events: log.events.slice(0, 60), errors: errors.concat(pageErr) };
  await ctx.close();
  return run;
}

// one check-in of a keeper
async function act(K, T, rnd, s, log, read) {
  const hud = await K.hud();
  const hungry = /魚餓了/.test(hud.sub), label = hud.q.replace('水質 ', '');
  const mistake = () => rnd() < T.mistake;
  if (T.policy === 'clumsy') {
    const r = rnd();
    if (r < 0.5) { const n = 1 + Math.floor(rnd() * 3); if (mistake()) { log.mistakes++; await K.water(); } else await K.feed(n); }
    else if (r < 0.62) { if (mistake()) { log.mistakes++; await K.feed(2); } else await K.water(); }
    else if (r < 0.72) { if (await K.tap('#bLight')) log.actions.light++; }
    else if (r < 0.8) { const picks = ['guppy', 'goldfish', 'goldfish', 'betta', 'angel', 'neon']; await K.lifeAction(picks[Math.floor(rnd() * picks.length)], 'fish', true); }
    else if (r < 0.84 && label === '危險') { await K.water(); }
    // else: looks and leaves
  } else if (T.policy === 'casual') {
    if (mistake()) { log.mistakes++; if (await K.tap('#bLight')) log.actions.light++; return; }
    if (hungry) await K.feed(1 + (rnd() < 0.3 ? 1 : 0)); else if (rnd() < 0.35) await K.feed(1);
    if (label !== '清澈' && rnd() < 0.85) await K.water();
    if (rnd() < 0.08) await K.lifeAction('guppy', 'fish', true);
  } else if (T.policy === 'skilled' || T.policy === 'world') {
    const W = T.policy === 'world';
    const st = await K.stats(); if (!st) return;
    if (mistake()) { log.mistakes++; await K.feed(3); return; }
    const pinches = hungry ? Math.ceil(st.fish / (W ? 7 : 9)) : (log.checkins % 2 === 0 ? 1 : 0);
    if (pinches) await K.feed(Math.min(pinches, 4));
    if (st.nitrate > (W ? 30 : 40) || st.ammonia > (W ? 0.15 : 0.2) || st.algae > (W ? 35 : 45)) await K.water();
    const lightTarget = st.algae > 30 ? 1 : st.algae < 6 ? 3 : 2; await K.setLight(lightTarget);
    if (st.load > (W ? 18 : 20)) await K.lifeAction('guppy', 'fish', false);
    if (W && st.fish > 24) await K.lifeAction('guppy', 'fish', false);
    if (st.algae > 30 && rnd() < 0.5) await K.lifeAction('oto', 'fish', true);
    if (W && st.detritus > 1.2) await K.lifeAction('shrimp', 'cleaner', true);
  } else { // perfect information, exact amounts
    const fullState = await K.page.evaluate(() => { const s = window.__eco.st; return { hungry: s.fish.filter(f => f.hunger > 0.45).length, fish: s.fish.length, food: s.food.length, w: s.water, det: s.detritus, load: window.__eco.ECO.load(s), guppies: s.fish.filter(f => f.sp === 'guppy').length, otos: s.fish.filter(f => f.sp === 'oto').length, shrimp: s.cleaners.filter(c => c.kind === 'shrimp').length, light: s.light }; });
    const need = Math.max(0, fullState.hungry - fullState.food);
    if (need > 0) await K.feed(Math.ceil(need / 8));
    if (fullState.w.nitrate > 30 || fullState.w.ammonia > 0.15 || fullState.w.algae > 30) await K.water();
    await K.setLight(fullState.w.algae > 20 ? 1 : fullState.w.algae < 8 ? 3 : 2);
    if (fullState.load > 18 || fullState.fish > 24) await K.lifeAction(fullState.guppies > 4 ? 'guppy' : 'neon', 'fish', false);
    if (fullState.w.algae > 25 && fullState.otos < 3) await K.lifeAction('oto', 'fish', true);
    if (fullState.det > 1 && fullState.shrimp < 6) await K.lifeAction('shrimp', 'cleaner', true);
  }
}

async function main() {
  const srv = await serve(); const base = 'http://localhost:' + srv.address().port;
  const resFile = path.join(OUT, 'results.json');
  let results = fs.existsSync(resFile) ? JSON.parse(fs.readFileSync(resFile, 'utf8')) : { game: 'eco-aquarium', tiers: {}, findings: [] };
  results.harness = { days: DAYS, frameMs: FRAME, speed: '4× (menu)', viewport: '390x844 @2x touch', date: new Date().toISOString().slice(0, 10) };
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const tierId of Object.keys(TIERS)) {
    if (onlyTiers.length && !onlyTiers.includes(tierId)) continue;
    const T = TIERS[tierId]; const t0 = Date.now();
    const run = await runTier(browser, base, tierId, T, 1000 + Object.keys(TIERS).indexOf(tierId) * 17);
    run.wallSeconds = Math.round((Date.now() - t0) / 1000);
    results.tiers[tierId] = { name: T.name, runs: [run], summary: { fishStart: run.fishStart, fishEnd: run.fishEnd, born: run.born, died: run.died, deaths: run.deaths, avgQ: run.avgQ, minQ: run.minQ, dangerHours: run.dangerHours, maxFish: run.maxFish, maxSnails: run.maxSnails, actions: run.actions, missedTaps: run.missedTaps, errors: run.errors.length } };
    console.log(tierId, JSON.stringify(results.tiers[tierId].summary), run.wallSeconds + 's');
    fs.writeFileSync(resFile, JSON.stringify(results, null, 1));
  }
  await Promise.race([browser.close(), new Promise(r => setTimeout(r, 5000))]); srv.close();
  process.exit(0);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
