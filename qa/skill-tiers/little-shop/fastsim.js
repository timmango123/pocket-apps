// Browserless cross-check for 小店經營: plays whole seasons with the five tier strategies on many seeds (no input timing).
// node fastsim.js [index.html] [seeds]
const fs = require('fs');
const src = fs.readFileSync(process.argv[2] || __dirname + '/../../../apps/little-shop/index.html', 'utf8');
const SHOP = new Function(src.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SHOP;')();
const NSEEDS = +process.argv[3] || 20;
const { ITEMS, SEASONS } = SHOP;
function R(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const TIERS = {
  ...(process.env.TAP10 ? { fill25: { serveQ: 1, serveP: 1, up: 1 }, fill40: { serveQ: 1, serveP: 1, up: 1 } } : {}),
  clumsy:  { serveQ: 99, serveP: 0, up: 0.1, react: 9 },
  casual:  { serveQ: 3, serveP: 0.3, up: 0.35, react: 6 },
  skilled: { serveQ: 2, serveP: 0.7, up: 0.75, react: 4 },
  world:   { serveQ: 1, serveP: 0.95, up: 0.97, react: 2 },
  superhuman: { serveQ: 1, serveP: 1, up: 1, react: 0 },
};
function bestPrices(run, rand, opt) {
  const S = SEASONS[run.season];
  const daysLeft = SHOP.DAYS - run.day;
  for (const id of S.items) {
    let best = run.price[id], bv = -1e9;
    SHOP.setPrice(run, id, ITEMS[id].ref * 0.4); const base = SHOP.expectDemand(run, { only: id, step: 30 })[id];
    for (let r = 0.8; r <= 2.2; r += 0.05) {
      SHOP.setPrice(run, id, ITEMS[id].ref * r);
      const dem = SHOP.expectDemand(run, { only: id, step: 30 })[id];
      // unconstrained demand at ref to estimate lost-to-price customers
      const c = Math.max(run.cost[id], run.avg[id] * 0.5 + run.cost[id] * 0.5);
      // each customer who walks out over price costs reputation, which costs traffic on the days left
      const walk = Math.max(0, base - dem), V = (+process.env.WV || 4) * Math.min(1, daysLeft / 6);
      const v = (run.price[id] - c) * dem - V * walk;
      if (v > bv) { bv = v; best = run.price[id]; }
    }
    SHOP.setPrice(run, id, best * (daysLeft > 4 ? 0.97 : 1));
  }
}
function planOrders(run, tier, rand) {
  const S = SEASONS[run.season];
  for (const id of S.items) run.order[id] = 0;
  if (tier === 'fill25' || tier === 'fill40') { const L = tier === 'fill25' ? 25 : 40; for (const id of S.items) SHOP.setOrder(run, id, L - run.stock[id]); return; }
  if (tier === 'clumsy') {
    if (rand() < 0.5) SHOP.applySuggest(run);
    else for (const id of S.items) SHOP.setOrder(run, id, Math.floor(rand() * (id === 'umbrella' || id === 'pomelo' || id === 'couplet' ? 6 : 26)));
    if (run.day === 1 || rand() < 0.3) for (const id of S.items) SHOP.setPrice(run, id, rand() < 0.5 ? ITEMS[id].ref : ITEMS[id].ref * (0.7 + rand() * 1.0));
    if (rand() < 0.08) { const u = Object.keys(SHOP.UPGRADES)[Math.floor(rand() * 6)]; SHOP.buyUpgrade(run, u); }
    return;
  }
  if (tier === 'casual') {
    SHOP.applySuggest(run);
    if (run.day === 4 && run.cash > 2400) SHOP.buyUpgrade(run, 'sign');
    return;
  }
  if (tier === 'skilled') {
    // a player who reads the forecast card and yesterday's report: base prices nudged by walk-outs,
    // a mark-up on whatever today's weather or event makes people want, the restock suggestion topped up when wholesale is cheap
    const last = run.last, wx = run.today.base, ev = run.event || '', wet = wx === 'rain' || wx === 'typhoon' || run.today.chance >= 50;
    run.base = run.base || {};
    for (const id of S.items) {
      let p = run.base[id] || ITEMS[id].ref * 1.05;
      if (last) { const lostP = last.priceItem[id] || 0, sold = last.sold[id] || 0; if (lostP > 0.2 * sold + 1) p *= 0.96; else if (lostP <= 0.08 * sold) p *= 1.03; }
      run.base[id] = Math.min(p, ITEMS[id].ref * 1.25);
      let bump = 1;
      if (id === 'umbrella' && wet) bump = 1.25;
      if (id === 'noodle' && (wx === 'typhoon' || ev === 'typhoonWarn')) bump = 1.2;
      if (id === 'pop' && wx === 'hot') bump = 1.1;
      if ((id === 'warmer' || id === 'potato') && wx === 'cold') bump = 1.12;
      if (id === 'pomelo' && ev.startsWith('moon')) bump = 1.15;
      if (id === 'couplet' && ev.startsWith('newyear')) bump = 1.2;
      SHOP.setPrice(run, id, run.base[id] * bump);
    }
    if (run.day <= 3 && run.cash > 1600) SHOP.buyUpgrade(run, 'sign');
    if (run.season === 1 && run.day >= 2 && run.day <= 6 && run.cash > 1500) SHOP.buyUpgrade(run, 'fridge');
    if (run.day >= 3 && run.day <= 7 && run.cash > 1700) SHOP.buyUpgrade(run, 'shelf');
    const sg = SHOP.suggest(run), daysLeft = SHOP.DAYS - run.day;
    for (const id of S.items) {
      let n = sg[id];
      if (!ITEMS[id].perish && run.mkt[id] < 0.88 && daysLeft > 3) n = Math.round(n * 1.3 + 2);
      SHOP.setOrder(run, id, n);
    }
    return;
  }
  // world / superhuman: model-optimised prices (with the reputation cost of walk-outs), demand-model stock,
  // the upgrades that suit the season bought early
  const daysLeft = SHOP.DAYS - run.day;
  const ups = { 0: ['sign', 'shelf', 'awning'], 1: ['sign', 'fridge', 'shelf', 'fan'], 2: ['sign', 'shelf'], 3: ['sign', 'shelf'] }[run.season];
  if (daysLeft >= 8) for (const u of ups) if (run.cash - SHOP.UPGRADES[u].cost >= 1100) SHOP.buyUpgrade(run, u);
  bestPrices(run, rand, {});
  const sg = SHOP.suggest(run), dem = SHOP.expectDemand(run);
  for (const id of S.items) {
    // blend the model with the history-based suggestion (the model does not see second items or upsells)
    let n = Math.max(sg[id] + run.stock[id], dem[id] * (ITEMS[id].perish ? 1.05 : 1.2) + 1);
    if (run.event && run.event.startsWith('order:') && run.event.split(':')[1] === id) n = Math.max(n, dem[id] + +run.event.split(':')[2]);
    if (!ITEMS[id].perish && run.mkt[id] < 0.86 && daysLeft > 3) n *= 1.25;
    if (daysLeft === 0) n = dem[id] * 0.95;
    SHOP.setOrder(run, id, Math.round(n - run.stock[id]));
  }
}
function playDay(run, tier, rand) {
  const T = TIERS[tier];
  SHOP.openShop(run);
  if (process.env.TAP10) { // same tapping for everyone (the release scorer's model): serve + 推薦 every 10 game minutes
    let k = 0; while (!SHOP.dayDone(run)) { SHOP.tick(run); if (++k % 10 === 0) { const f = SHOP.front(run); if (f) { if (f.up && !f.upRes) SHOP.upsell(run); SHOP.serve(run); } } }
    return SHOP.closeDay(run);
  }
  let pend = null;
  while (!SHOP.dayDone(run)) {
    SHOP.tick(run);
    const d = run.ds;
    if (d.q.length) {
      const f = SHOP.front(run);
      if (f.up && !f.upRes && pend !== f.id) { pend = f.id; if (rand() < T.up) { /* reaction */ SHOP.upsell(run); } }
      if (d.q.length >= T.serveQ && rand() < T.serveP * 0.25) SHOP.serve(run);
    }
  }
  return SHOP.closeDay(run);
}
function playSeason(season, seed, tier) {
  const rand = R(seed * 7 + tier.length);
  const run = SHOP.newRun(season, seed);
  while (true) {
    planOrders(run, tier, rand);
    playDay(run, tier, rand);
    if (run.phase === 'end') break;
    SHOP.nextDay(run);
  }
  return run;
}
const out = {};
for (const tier of Object.keys(TIERS)) {
  out[tier] = [];
  for (let s = 0; s < 4; s++) {
    const revs = [], custs = [], byItem = {}, pr = {}, cash = [], st = [], rep = [], lost = [0, 0, 0], served = [];
    for (let k = 0; k < NSEEDS; k++) {
      const run = playSeason(s, 1000 + k * 17, tier);
      cash.push(run.cash); st.push(SHOP.stars(s, run.cash)); rep.push(run.rep);
      for (const h of run.hist) { lost[0] += h.lost.price; lost[1] += h.lost.oos; lost[2] += h.lost.wait; }
      for (const h of run.hist) for (const id in h.sold) byItem[id] = (byItem[id] || 0) + h.sold[id] * h.prices[id] / NSEEDS / run.hist.length;
      for (const h of run.hist) for (const id in h.prices) pr[id] = (pr[id] || 0) + h.prices[id] / ITEMS[id].ref / NSEEDS / run.hist.length;
      revs.push(run.hist.reduce((a, h) => a + h.rev, 0) / run.hist.length); custs.push(run.hist.reduce((a, h) => a + h.n, 0) / run.hist.length);
      served.push(run.hist.reduce((a, h) => a + h.served, 0) / run.hist.reduce((a, h) => a + h.n, 0));
    }
    cash.sort((a, b) => a - b);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    out[tier].push({ s: SEASONS[s].id, med: cash[cash.length >> 1], min: cash[0], max: cash[cash.length - 1], stars: [0, 1, 2, 3].map(k => st.filter(x => x === k).length), clear: st.filter(x => x > 0).length / st.length, rep: Math.round(avg(rep)), conv: avg(served).toFixed(2), rev: Math.round(avg(revs)), it: Object.fromEntries(Object.entries(byItem).map(([k, v]) => [k, Math.round(v)])), cust: Math.round(avg(custs)), pr: Object.fromEntries(Object.entries(pr).map(([k, v]) => [k, +v.toFixed(2)])), lost: lost.map(x => Math.round(x / NSEEDS)) });
  }
}
for (const t in out) { console.log(t); for (const r of out[t]) console.log('  ', JSON.stringify(r)); }
fs.writeFileSync(process.env.TAP10 ? __dirname + '/fastsim-tap10.json' : __dirname + '/fastsim.json', JSON.stringify(out, null, 1));
