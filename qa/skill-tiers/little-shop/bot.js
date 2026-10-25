// Skill-tier playtest for 小店經營 (little-shop).
// Five simulated players run whole seasons in real headless Chromium (390×844, DPR 2, touch). They READ the
// game state through window.__shop, but ACT only with CDP touch events (Input.dispatchTouchEvent) on the real
// buttons, with tier-specific reaction time, aim error and mistakes. Game time runs on the page's own
// virtual clock (__shop.lockstep / step / stepUntil), so a loaded machine cannot change the results.
//   node bot.js [tier ...] [--seasons 0,1,2,3] [--seed N] [--out results.json]
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '../../../apps/little-shop/index.html');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, mistake: 0.15, speed: 4, up: 0.3, serveQ: 4, serveP: 0.35 },
  casual:     { name: '普通', react: [400, 100], pos: 20, mistake: 0.06, speed: 2, up: 0.55, serveQ: 3, serveP: 0.6 },
  skilled:    { name: '熟練', react: [260, 50], pos: 10, mistake: 0.02, speed: 2, up: 0.85, serveQ: 2, serveP: 0.85 },
  world:      { name: '世界級', react: [180, 25], pos: 4, mistake: 0.003, speed: 2, up: 0.97, serveQ: 1, serveP: 0.97 },
  superhuman: { name: '非人', react: [16, 0], pos: 0, mistake: 0, speed: 4, up: 1, serveQ: 1, serveP: 1 },
};
const only = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const tiers = only.length ? only : Object.keys(TIERS);
const seasons = opt('--seasons', '0,1,2,3').split(',').map(Number);
const SEED = +opt('--seed', 2026);
const OUT = opt('--out', path.join(__dirname, 'results.json'));
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = r => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(6.2831853 * r());

// ---------- planning (runs in the page on a CLONE of the state; never touches the live run) ----------
function planInPage([tier, u]) {
  let k = 0; const rand = () => u[k++ % u.length];
  const r = JSON.parse(JSON.stringify(__shop.run)), S = SHOP.SEASONS[r.season], I = SHOP.ITEMS;
  const plan = { suggest: false, orders: null, prices: {}, upgrades: [] };
  const daysLeft = SHOP.DAYS - r.day;
  if (tier === 'clumsy') {
    if (r.day === 1 || rand() < 0.3) for (const id of S.items) plan.prices[id] = rand() < 0.5 ? r.price[id] : Math.round(I[id].ref * (0.7 + rand()));
    if (rand() < 0.5) plan.suggest = true;
    else { plan.orders = {}; for (const id of S.items) plan.orders[id] = Math.floor(rand() * (I[id].ref >= 50 ? 6 : 26)); }
    if (rand() < 0.08) plan.upgrades.push(Object.keys(SHOP.UPGRADES)[Math.floor(rand() * 6)]);
    return plan;
  }
  if (tier === 'casual') {
    plan.suggest = true;
    if (r.day === 4 && r.cash > 2400) plan.upgrades.push('sign');
    return plan;
  }
  if (tier === 'skilled') {
    // same plan as fastsim.js: base prices nudged by yesterday's walk-outs, a mark-up on what today's weather or
    // event makes people want, the restock suggestion (topped up when wholesale is cheap), season-sensible upgrades
    const last = r.last, wx = r.today.base, ev = r.event || '', wet = wx === 'rain' || wx === 'typhoon' || r.today.chance >= 50;
    const base = window.__botBase && window.__botBase.season === r.season && window.__botBase.day === r.day - 1 ? window.__botBase.p : {};
    for (const id of S.items) {
      let p = base[id] || I[id].ref * 1.05;
      if (last && base[id]) { const lp = last.priceItem[id] || 0, sold = last.sold[id] || 0; if (lp > 0.2 * sold + 1) p *= 0.96; else if (lp <= 0.08 * sold) p *= 1.03; }
      base[id] = Math.min(p, I[id].ref * 1.25);
      let bump = 1;
      if (id === 'umbrella' && wet) bump = 1.25;
      if (id === 'noodle' && (wx === 'typhoon' || ev === 'typhoonWarn')) bump = 1.2;
      if (id === 'pop' && wx === 'hot') bump = 1.1;
      if ((id === 'warmer' || id === 'potato') && wx === 'cold') bump = 1.12;
      if (id === 'pomelo' && ev.startsWith('moon')) bump = 1.15;
      if (id === 'couplet' && ev.startsWith('newyear')) bump = 1.2;
      plan.prices[id] = SHOP.setPrice(r, id, base[id] * bump);
    }
    window.__botBase = { season: r.season, day: r.day, p: base };
    let cash = r.cash;
    const want = [];
    if (r.day <= 3 && cash > 1600) want.push('sign');
    if (r.season === 1 && r.day >= 2 && r.day <= 6 && cash > 1500) want.push('fridge');
    if (r.day >= 3 && r.day <= 7 && cash > 1700) want.push('shelf');
    for (const x of want) if (!r.upg[x] && cash >= SHOP.UPGRADES[x].cost) { plan.upgrades.push(x); cash -= SHOP.UPGRADES[x].cost; r.upg[x] = r.day; }
    r.cash = cash;
    const sg = SHOP.suggest(r); plan.orders = {};
    for (const id of S.items) {
      let n = sg[id];
      if (!I[id].perish && r.mkt[id] < 0.88 && daysLeft > 3) n = Math.round(n * 1.3 + 2);
      plan.orders[id] = Math.max(0, n);
    }
    return plan;
  }
  // world / superhuman: same plan as fastsim.js. World only knows the forecast; superhuman knows the actual rain window.
  const ups = { 0: ['sign', 'shelf', 'awning'], 1: ['sign', 'fridge', 'shelf', 'fan'], 2: ['sign', 'shelf'], 3: ['sign', 'shelf'] }[r.season];
  let cash = r.cash;
  if (daysLeft >= 8) for (const x of ups) if (!r.upg[x] && cash - SHOP.UPGRADES[x].cost >= 1100) { plan.upgrades.push(x); cash -= SHOP.UPGRADES[x].cost; r.upg[x] = r.day; }
  r.cash = cash;
  const demand = (rr, id) => {
    if (tier === 'superhuman' || !rr.today.chance || rr.today.chance >= 100) return SHOP.expectDemand(rr, id ? { only: id, step: 30 } : null);
    const c = rr.today.chance / 100, dry = JSON.parse(JSON.stringify(rr)), wet = JSON.parse(JSON.stringify(rr));
    dry.today = { ...rr.today, win: null }; wet.today = { ...rr.today, win: [840, 1080] };
    const a = SHOP.expectDemand(dry, id ? { only: id, step: 30 } : null), b = SHOP.expectDemand(wet, id ? { only: id, step: 30 } : null), o = {};
    for (const k2 in a) o[k2] = a[k2] * (1 - c) + b[k2] * c; return o;
  };
  for (const id of S.items) {
    let best = r.price[id], bv = -1e9;
    SHOP.setPrice(r, id, I[id].ref * 0.4); const all = demand(r, id)[id];
    for (let q = 0.8; q <= 2.2; q += 0.05) {
      SHOP.setPrice(r, id, I[id].ref * q);
      const dm = demand(r, id)[id], walk = Math.max(0, all - dm), V = 4 * Math.min(1, daysLeft / 6);
      const v = (r.price[id] - Math.max(r.cost[id], (r.avg[id] + r.cost[id]) / 2)) * dm - V * walk;
      if (v > bv) { bv = v; best = r.price[id]; }
    }
    plan.prices[id] = SHOP.setPrice(r, id, best * (daysLeft > 4 ? 0.97 : 1));
  }
  const sg = SHOP.suggest(r), dem = demand(r); plan.orders = {};
  for (const id of S.items) {
    let n = Math.max(sg[id] + r.stock[id], dem[id] * (I[id].perish ? 1.05 : 1.2) + 1);
    if (r.event && r.event.startsWith('order:') && r.event.split(':')[1] === id) n = Math.max(n, dem[id] + +r.event.split(':')[2]);
    if (!I[id].perish && r.mkt[id] < 0.86 && daysLeft > 3) n *= 1.25;
    if (daysLeft === 0) n = dem[id] * 0.95;
    plan.orders[id] = Math.max(0, Math.round(n - r.stock[id]));
  }
  return plan;
}

(async () => {
  const SK = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
  const html = SK + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); });
  await new Promise(r => srv.listen(0, r));
  const URL = 'http://localhost:' + srv.address().port + '/app/little-shop/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'little-shop', tiers: {}, findings: [] };
  results.game = 'little-shop';
  for (const tier of tiers) {
    const T = TIERS[tier], rand = rng(SEED * 31 + tier.length * 7);
    results.tiers[tier] = { name: T.name, runs: [], summary: {} };
    for (const season of seasons) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
      const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      // watchdog: on this loaded machine a browser call has hung for minutes with nothing running; time it out,
      // reload (the app saves and resumes a mid-day reload paused) and carry on
      const TO = (p, what) => { let k; return Promise.race([p, new Promise((_, rej) => { k = setTimeout(() => rej(new Error('stall: ' + what)), 45000); })]).finally(() => clearTimeout(k)); };
      const ev0 = page.evaluate.bind(page), send0 = cdp.send.bind(cdp);
      page.evaluate = (f, a) => TO(ev0(f, a), 'evaluate');
      cdp.send = (m, a) => TO(send0(m, a), m);
      let stalls = 0;
      await page.goto(URL); await page.waitForTimeout(400);
      const t0 = Date.now();
      const stats = { taps: 0, missTaps: 0, serveSent: 0, serveGot: 0, upSent: 0, upGot: 0, mistakes: 0, marketTaps: 0, pauses: 0 };
      const box = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height] : null; }, sel);
      const touch = async (x, y) => {
        const pt = [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        stats.taps++;
      };
      // aimed tap with motor error; returns what was actually under the finger
      // one round trip: find the target, apply the aim error, report whether the finger lands on it
      const tap = async (sel, sigma, scroll) => {
        const s = sigma == null ? T.pos : sigma, nx = gauss(rand) * s, ny = gauss(rand) * s;
        const a = await page.evaluate(([sel, nx, ny, scroll]) => {
          const want = document.querySelector(sel); if (!want) return null;
          if (scroll) want.scrollIntoView({ block: 'center' });
          const r = want.getBoundingClientRect(); if (!r.width) return null;
          const x = Math.max(1, Math.min(innerWidth - 1, r.x + r.width / 2 + nx)), y = Math.max(1, Math.min(innerHeight - 1, r.y + r.height / 2 + ny));
          const e = document.elementFromPoint(x, y); return { x, y, hit: !!(e && (e === want || want.contains(e))) };
        }, [sel, nx, ny, !!scroll]);
        if (!a) return null;
        if (!a.hit) stats.missTaps++;
        await touch(a.x, a.y);
        return a.hit;
      };
      const react = () => Math.max(16, T.react[0] + gauss(rand) * T.react[1]);
      await page.evaluate(([s, seed]) => { __shop.prefs.tips = { mkt: 1, day: 1 }; __shop.unlockAll(); __shop.start(s, seed); }, [season, SEED + season * 101 + tier.length]);
      const days = [];
      while (true) {
        if (Date.now() - t0 > 2400000) { errors.push('time cap reached'); break; }
        let view;
        try { view = await page.evaluate(() => __shop.view); } catch (e) { if (!/stall/.test(e.message) || ++stalls > 6) throw e; await recover(e); continue; }
        if (view === 'end') break;
        if (view === 'report') { await tap('#bNext', Math.min(T.pos, 10)); await page.waitForTimeout(150); continue; }
        if (view === 'day') {
          // resumed after a reload: tap 繼續 and play the rest of the day
          if (await page.evaluate(() => __shop.paused)) await tap('#pauseBox [data-r]', 3);
          try { await playDay(); } catch (e) { if (!/stall/.test(e.message) || ++stalls > 6) throw e; await recover(e); }
          continue;
        }
        if (view !== 'market') { await page.waitForTimeout(150); continue; }
        try {
        // ---- morning ----
        const plan = await page.evaluate(planInPage, [tier, Array.from({ length: 64 }, rand)]);
        if (plan.upgrades.length) {
          await tap('#bUpg', 2); await page.waitForTimeout(380);
          for (const u of plan.upgrades) { await tap(`[data-u="${u}"]`, 3); await page.waitForTimeout(60); await tap(`[data-u="${u}"]`, 3); await page.waitForTimeout(60); }
          await touch(195, 30); await page.waitForTimeout(350);
        }
        if (plan.suggest) await tap('#bSuggest', Math.min(T.pos, 8));
        const fix = async (id, kind, target) => {
          for (let guard = 0; guard < 120; guard++) {
            const cur = await page.evaluate(([id, kind]) => kind === 'b' ? __shop.run.order[id] : __shop.run.price[id], [id, kind]);
            const step = kind === 'b' ? 1 : (SHOP_REF[id] >= 50 ? 5 : 1);
            const diff = Math.round((target - cur) / step);
            if (!diff) return;
            if (rand() < T.mistake) { stats.mistakes++; if (tier === 'clumsy') return; }
            const sel = `.item[data-id="${id}"] [data-a="${kind}${diff > 0 ? '+' : '-'}"]`;
            const hit = await tap(sel, Math.min(T.pos, 14), true); stats.marketTaps++;
            if (!hit && tier === 'clumsy' && rand() < 0.5) return;
            if (kind === 'b' && diff > 0) { const can = await page.evaluate(id => __shop.run.order[id], id); if (can === cur && hit) return; }
          }
        };
        const SHOP_REF = await page.evaluate(() => Object.fromEntries(Object.entries(SHOP.ITEMS).map(([k, v]) => [k, v.ref])));
        for (const id in plan.prices) await fix(id, 'p', plan.prices[id]);
        if (plan.orders) for (const id in plan.orders) await fix(id, 'b', plan.orders[id]);
        await tap('#bOpen', Math.min(T.pos, 8)); await page.waitForTimeout(250);
        if (await box('.confirm [data-y]')) await tap('.confirm [data-y]', 4);
        if (await page.evaluate(() => __shop.view) !== 'day') continue;
        await playDay();
        } catch (e) { if (!/stall/.test(e.message) || ++stalls > 6) throw e; await recover(e); }
      }
      async function recover(e) {
        console.log(`  ${tier} stall (${e.message}), reloading`);
        await page.reload({ timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500);
      }
      async function playDay() {
        // ---- the day ----
        for (let g = 0; g < 4 && await page.evaluate(() => __shop.prefs.speed) !== T.speed; g++) { await tap('#bSpeed', 3); }
        await page.evaluate(() => __shop.lockstep(true));
        const seenUp = new Set();
        let hold = 0;
        while (true) {
          const w = await page.evaluate(([q, h]) => h ? (__shop.step(h), { why: 'time' }) : __shop.stepUntil(1500, q), [T.serveQ, hold]);
          hold = 0;
          if (w.why === 'end') break;
          if (w.why === 'up' && !seenUp.has(w.id)) {
            seenUp.add(w.id);
            if (rand() < T.up) {
              const [live, before] = await page.evaluate(ms => { __shop.step(ms); const r = __shop.run, f = SHOP.front(r); return [!!(f && f.up && !f.upRes && r.stock[f.up] > 0), r.ds ? r.ds.up.tried : 0]; }, react());
              if (rand() < T.mistake) { stats.mistakes++; await tap('#bPause', T.pos); }
              else { const hit = await tap('#bUp'); stats.upSent++; const after = await page.evaluate(() => __shop.run.ds ? __shop.run.ds.up.tried : 0); if (after > before) stats.upGot++; else if (hit && live) stats.upLost = (stats.upLost || 0) + 1; }
            }
          } else if (w.why === 'q') {
            if (rand() < T.serveP) {
              const qn = await page.evaluate(ms => { __shop.step(ms); return __shop.run.ds ? __shop.run.ds.q.length : 0; }, react());
              const n = Math.min(qn, tier === 'world' || tier === 'superhuman' ? qn : Math.max(1, Math.floor(qn / 2)));
              for (let i = 0; i < n; i++) {
                if (rand() < T.mistake) { stats.mistakes++; await tap('#bPause', T.pos); break; }
                const [b0, qq] = await page.evaluate(() => __shop.run.ds ? [__shop.run.ds.taps, __shop.run.ds.q.length] : [0, 0]);
                const hit = await tap('#bServe'); stats.serveSent++;
                const b1 = await page.evaluate(ms => { const t = __shop.run.ds ? __shop.run.ds.taps : 0; __shop.step(ms); return t; }, tier === 'superhuman' ? 16 : 125);
                if (b1 > b0) stats.serveGot++; else if (hit && qq) stats.serveLost = (stats.serveLost || 0) + 1;
              }
            } else hold = 600;
          }
          // a mistaken tap on pause: notice it and resume
          const ps = await page.evaluate(() => __shop.view === 'day' && __shop.paused ? (document.getElementById('pauseBox') ? 'box' : 'sheet') : '');
          if (ps === 'box') { stats.pauses++; await tap('#pauseBox [data-r]', Math.min(T.pos, 6)); }
          else if (ps === 'sheet') await touch(195, 30);
        }
        await page.evaluate(() => __shop.lockstep(false));
        for (let i = 0; i < 40 && !['report', 'end'].includes(await page.evaluate(() => __shop.view)); i++) await page.waitForTimeout(100);
        const last = await page.evaluate(() => __shop.run.last);
        if (process.env.VERBOSE) console.log(`  ${tier} s${season} day ${last.day} net ${last.net} cash ${last.cash} ${Math.round((Date.now() - t0) / 1000)}s`);
        days.push({ day: last.day, net: last.net, cash: last.cash, n: last.n, served: last.served, lost: last.lost, up: last.up, taps: last.taps, rep: last.rep, spoilV: last.spoilV });
      }
      const fin = await page.evaluate(() => ({ cash: __shop.run.cash, phase: __shop.run.phase, upg: Object.keys(__shop.run.upg), stars: SHOP.stars(__shop.run.season, __shop.run.cash), best: __shop.prog.best[__shop.run.season], unlocked: __shop.prog.unlocked }));
      // persistence: reload on the end screen keeps the record
      await page.reload(); await page.waitForTimeout(500);
      const kept = await page.evaluate(() => ({ view: __shop.view, best: __shop.prog.best }));
      stats.stalls = stalls;
      const runRec = { season, seed: SEED + season * 101 + tier.length, cash: fin.cash, stars: fin.stars, finished: fin.phase === 'end', upgrades: fin.upg, keptAfterReload: kept.view === 'end' && !!kept.best[season], secs: Math.round((Date.now() - t0) / 1000), stats, errors, days };
      results.tiers[tier].runs.push(runRec);
      console.log(`${tier} season ${season}: $${fin.cash} ${'★'.repeat(fin.stars)}${'☆'.repeat(3 - fin.stars)} served ${days.reduce((a, d) => a + d.served, 0)}/${days.reduce((a, d) => a + d.n, 0)} up ${days.reduce((a, d) => a + d.up.ok, 0)}/${days.reduce((a, d) => a + d.up.tried, 0)} taps ${stats.taps} miss ${stats.missTaps} serve ${stats.serveGot}/${stats.serveSent} errors ${errors.length} ${runRec.secs}s`);
      await ctx.close();
    }
    const R = results.tiers[tier].runs;
    results.tiers[tier].summary = { cleared: R.filter(r => r.stars > 0).length + '/' + R.length, stars: R.map(r => r.stars), cash: R.map(r => r.cash), errors: R.reduce((a, r) => a + r.errors.length, 0) };
    fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  }
  await browser.close(); srv.close();
})();
