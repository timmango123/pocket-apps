// Tests for 小店經營 (little-shop): the shop economy between CORE markers (pure, seeded), then a short
// Playwright drive of the real page (touch taps, refresh persistence, no errors).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const SHOP = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SHOP;')();
const { ITEMS, SEASONS, DAYS, OPEN, CLOSE } = SHOP;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const clone = o => JSON.parse(JSON.stringify(o));
const playDay = (run, each) => { SHOP.openShop(run); while (!SHOP.dayDone(run)) { SHOP.tick(run); if (each) each(run); } return SHOP.closeDay(run); };
const casual = (season, seed, opts) => {
  const run = SHOP.newRun(season, seed);
  while (true) {
    SHOP.applySuggest(run);
    playDay(run, opts && opts.serve ? r => { if (r.ds.q.length >= 3) SHOP.serve(r); } : null);
    if (run.phase === 'end') return run;
    SHOP.nextDay(run);
  }
};

// --- construction & determinism ---
{
  const a = SHOP.newRun(0, 42), b = SHOP.newRun(0, 42), c = SHOP.newRun(0, 43);
  ok(JSON.stringify(a) === JSON.stringify(b), 'newRun is deterministic for a seed');
  ok(JSON.stringify(a.wxs) !== JSON.stringify(c.wxs), 'different seeds give different weather');
  ok(a.phase === 'market' && a.day === 1 && a.cash === SEASONS[0].start && a.rep === 50, 'season starts on day 1 in the market with starting cash');
  ok(SEASONS[0].items.every(id => a.price[id] === ITEMS[id].ref && a.stock[id] === 0), 'prices start at the reference price, shelves empty');
  ok(a.wxs.length === DAYS + 1 && a.wxs.every(w => SHOP.WX[w.base]), 'weather rolled for every day');
  ok(SEASONS.every((S, i) => S.items.every(id => ITEMS[id]) && S.stars[0] < S.stars[1] && S.stars[1] < S.stars[2] && S.stars[0] > S.start), 'season definitions are sane');
  ok(SHOP.newRun(1, 5).wxs[8].base === 'typhoon', 'summer day 9 is the scripted typhoon');
  const r1 = casual(0, 9), r2 = casual(0, 9);
  ok(r1.cash === r2.cash && JSON.stringify(r1.hist) === JSON.stringify(r2.hist), 'a whole season replays identically');
}
// --- market: ordering, caps, cash ---
{
  const run = SHOP.newRun(0, 7);
  ok(SHOP.setOrder(run, 'noodle', 10) === 10, 'order 10 noodles');
  ok(SHOP.orderCost(run) === 10 * run.cost.noodle, 'order cost = qty × today\'s cost');
  ok(SHOP.setOrder(run, 'noodle', 999) === SHOP.cap(run, 'noodle'), 'order is capped by shelf space (' + SHOP.cap(run, 'noodle') + ')');
  ok(SHOP.setOrder(run, 'noodle', -5) === 0, 'negative order clamps to 0');
  ok(SHOP.setOrder(run, 'nope', 5) === 0, 'unknown item ignored');
  run.cash = 100; SHOP.setOrder(run, 'umbrella', 10);
  ok(run.order.umbrella === Math.floor(100 / run.cost.umbrella), 'order is capped by cash (' + run.order.umbrella + ' umbrellas for $100)');
  SHOP.setOrder(run, 'noodle', 50);
  ok(SHOP.orderCost(run) <= run.cash, 'total order never exceeds cash');
  ok(SHOP.setPrice(run, 'noodle', 0) >= 1 && SHOP.setPrice(run, 'noodle', 1e6) === ITEMS.noodle.ref * 3, 'price clamped to a sane range');
  ok(SHOP.setPrice(run, 'noodle', 17.6) === 18, 'price rounds to whole dollars');
  const sg = SHOP.suggest(SHOP.newRun(0, 7));
  ok(SEASONS[0].items.every(id => sg[id] >= 0 && sg[id] <= 40), 'suggestion within 0..cap');
}
// --- the day: conservation of stock and money ---
for (const [season, seed] of [[0, 11], [1, 12], [2, 13], [3, 14]]) {
  const run = SHOP.newRun(season, seed);
  let okStock = true, okCash = true, okShrink = true, okRep = true;
  for (let d = 0; d < DAYS; d++) {
    SHOP.applySuggest(run);
    const cash0 = run.cash, stock0 = clone(run.stock), order = clone(run.order), upg0 = run.spent;
    const r = playDay(run, rr => { for (const id in rr.stock) if (rr.stock[id] < 0) okStock = false; if (rr.ds.t % 37 === 0) SHOP.serve(rr); if (rr.ds.t % 23 === 0) SHOP.upsell(rr); });
    for (const id of SEASONS[season].items) {
      const sold = r.sold[id] || 0, sp = r.spoiled[id] || 0;
      if (stock0[id] + order[id] !== run.stock[id] + sold + sp) okStock = false;
    }
    if (Math.abs(cash0 - r.spend + r.rev - r.rent - r.shrink - (run.cash)) > 1e-6) okCash = false;
    if (r.net !== r.rev - r.spend - r.rent - r.upg - r.shrink) okCash = false;
    // shrink: SHRINK of the cost of every shelf-stable item left tonight, none on the last night
    let shr = 0; if (r.day < DAYS) for (const id of SEASONS[season].items) if (!SHOP.ITEMS[id].perish) shr += run.stock[id] * run.avg[id] * SHOP.SHRINK;
    if (Math.abs(Math.round(shr) - r.shrink) > 0) okShrink = false;
    // reputation moves a third of the way toward the day's satisfaction score (plus event / 里長 bonuses)
    if (r.score < 0 || r.score > 100 || r.rep < 0 || r.rep > 100) okRep = false;
    if (run.phase !== 'end') SHOP.nextDay(run);
  }
  ok(okStock, `${SEASONS[season].id}: stock is conserved (start + bought = left + sold + spoiled) and never negative`);
  ok(okCash, `${SEASONS[season].id}: cash moves exactly by revenue − purchases − rent − shrink`);
  ok(okShrink, `${SEASONS[season].id}: nightly shrink is ${SHOP.SHRINK * 100}% of leftover shelf-stable stock, none on the last night`);
  ok(okRep, `${SEASONS[season].id}: satisfaction score and reputation stay within 0–100`);
  ok(run.phase === 'end' && run.hist.length === DAYS, `${SEASONS[season].id}: season ends after ${DAYS} days`);
  ok(!SHOP.nextDay(run) && !SHOP.openShop(run), `${SEASONS[season].id}: nothing continues after the last day`);
  ok(run.hist.every(h => h.served + h.lost.price + h.lost.oos + h.lost.wait === h.n), `${SEASONS[season].id}: every customer is either served or has a reason for leaving`);
}
// --- perishables, rent ---
{
  const run = SHOP.newRun(0, 21);
  SHOP.setOrder(run, 'egg', 40); SHOP.setOrder(run, 'noodle', 40);
  const r = playDay(run);
  ok(run.stock.egg === 0 && (r.spoiled.egg || 0) === 40 - (r.sold.egg || 0), 'tea eggs left at closing are thrown away (' + r.spoiled.egg + ')');
  ok(run.stock.noodle === 40 - (r.sold.noodle || 0), 'noodles carry over to tomorrow');
  ok(r.rent === SEASONS[0].rent, 'rent charged at closing');
}
// --- serving and upselling ---
{
  const run = SHOP.newRun(0, 31); SHOP.applySuggest(run); SHOP.openShop(run);
  ok(SHOP.serve(run) === null, 'serve with nobody at the counter does nothing');
  while (run.ds.q.length < 2) SHOP.tick(run);
  const front = SHOP.front(run), n0 = run.ds.served, cash0 = run.cash;
  const ev = SHOP.serve(run);
  ok(ev && ev.k === 'sale' && ev.c.id === front.id && run.ds.served === n0 + 1 && run.cash === cash0 + ev.amt, 'tapping 結帳 sells to the front customer at once');
  ok(ev.tapped === true && run.ds.taps === 1, 'tapped sale is counted');
  // find a customer with an upsell offer
  let tries = 0, res = null;
  while (tries++ < 5000 && !res) { SHOP.tick(run); const f = SHOP.front(run); if (f && f.up && !f.upRes) { const cart0 = f.cart.length; res = SHOP.upsell(run); ok(res && (res.ok ? f.cart.length === cart0 + 1 : f.cart.length === cart0), 'upsell adds exactly one item when accepted'); ok(SHOP.upsell(run) === null, 'only one upsell per customer'); } if (SHOP.dayDone(run)) break; }
  ok(!!res, 'an upsell offer appears during a day');
  let fronts = 0, offers = 0; const r2 = SHOP.newRun(0, 32); SHOP.applySuggest(r2); SHOP.openShop(r2);
  const seen = new Set();
  while (!SHOP.dayDone(r2)) { SHOP.tick(r2); const f = SHOP.front(r2); if (f && !seen.has(f.id)) { seen.add(f.id); fronts++; if (f.up) offers++; } }
  ok(offers / fronts > 0.25 && offers / fronts < 0.7, `upsell offers on a fair share of customers (${offers}/${fronts})`);
}
// --- mid-day save/restore continues identically (refresh persistence) ---
{
  const a = SHOP.newRun(2, 77); SHOP.applySuggest(a); SHOP.openShop(a);
  while (a.ds.t < 800) SHOP.tick(a);
  const b = clone(a);
  while (!SHOP.dayDone(a)) SHOP.tick(a); while (!SHOP.dayDone(b)) SHOP.tick(b);
  ok(JSON.stringify(SHOP.closeDay(a)) === JSON.stringify(SHOP.closeDay(b)), 'a JSON round-trip mid-day finishes the day identically');
}
// --- demand responds to price, weather, events, reputation ---
{
  const run = SHOP.newRun(0, 3);
  let mono = true; for (const t of SHOP.TYPE_IDS) { let p = 2; for (let pr = 5; pr <= 40; pr++) { SHOP.setPrice(run, 'noodle', pr); const q = SHOP.pBuy(run, t, 'noodle', 600); if (q > p + 1e-12) mono = false; p = q; } }
  ok(mono, 'higher price → lower chance to buy, for every customer type');
  SHOP.setPrice(run, 'noodle', 15);
  ok(SHOP.pBuy(run, 'tourist', 'noodle', 600) > SHOP.pBuy(run, 'kid', 'noodle', 600), 'tourists care less about price than kids');
  const dry = SHOP.newRun(0, 3); dry.today = { base: 'sun', chance: 0, win: null };
  const wet = SHOP.newRun(0, 3); wet.today = { base: 'rain', chance: 100, win: [OPEN, CLOSE] };
  const dd = SHOP.expectDemand(dry), dw = SHOP.expectDemand(wet);
  ok(dw.umbrella > dd.umbrella * 4, `rain sells umbrellas (${dw.umbrella.toFixed(1)} vs ${dd.umbrella.toFixed(1)})`);
  ok(SHOP.arrivalRate(wet, 600) < SHOP.arrivalRate(dry, 600), 'rain keeps people at home');
  wet.upg.awning = 1; ok(SHOP.arrivalRate(wet, 600) > SHOP.arrivalRate(dry, 600) * 0.85, 'awning keeps rainy-day traffic');
  const hi = SHOP.newRun(0, 3), lo = SHOP.newRun(0, 3); hi.rep = 90; lo.rep = 10;
  ok(SHOP.arrivalRate(hi, 600) > SHOP.arrivalRate(lo, 600) * 1.5, 'good reputation brings more customers');
  const moon = SHOP.newRun(2, 3); moon.day = 10; SHOP.planDay(moon);
  const norm = SHOP.newRun(2, 3); norm.day = 3; SHOP.planDay(norm); norm.today = moon.today;
  ok(moon.event === 'moon' && SHOP.expectDemand(moon).pomelo > SHOP.expectDemand(norm).pomelo * 3, 'Mid-Autumn festival sells pomelos');
  const sat = SHOP.newRun(0, 3); sat.day = 6; const mon = SHOP.newRun(0, 3); mon.today = sat.today = { base: 'sun', chance: 0, win: null };
  ok(SHOP.isWeekend(6) && !SHOP.isWeekend(5) && SHOP.arrivalRate(sat, 600) > SHOP.arrivalRate(mon, 600), 'weekends are busier');
}
// --- bulk order event ---
{
  const run = SHOP.newRun(0, 5); run.day = 9; SHOP.planDay(run);
  ok(run.event === 'order:noodle:20', 'spring day 9 has the 里長 order');
  const a = clone(run); SHOP.setOrder(a, 'noodle', 40); const ra = playDay(a);
  ok(ra.bulk && ra.bulk.ok && ra.bulk.amt === 20 * Math.round(ITEMS.noodle.ref * 1.1), 'order delivered when stock is enough');
  const b = clone(run); SHOP.setOrder(b, 'noodle', 5); const rb = playDay(b);
  ok(rb.bulk && !rb.bulk.ok, 'order fails when stock is short');
}
// --- upgrades ---
{
  const run = SHOP.newRun(0, 8); const c0 = run.cash;
  ok(SHOP.buyUpgrade(run, 'register') && run.cash === c0 - SHOP.UPGRADES.register.cost, 'buying an upgrade costs its price');
  ok(!SHOP.buyUpgrade(run, 'register'), 'cannot buy the same upgrade twice');
  ok(SHOP.serveTime(run) < 15, 'register serves faster');
  run.cash = 100; ok(!SHOP.buyUpgrade(run, 'sign'), 'cannot buy without cash');
  run.cash = 5000; SHOP.setOrder(run, 'noodle', 40); const keep = run.cash - SHOP.orderCost(run);
  ok(!SHOP.buyUpgrade(run, 'shelf') || keep >= 600, 'upgrade cannot eat money already committed to stock');
  ok(SHOP.cap(run, 'noodle') === 99, 'shelf-stable goods: up to 99 on the shelf');
  const r1 = SHOP.newRun(1, 8); ok(SHOP.cap(r1, 'pop') === 40, 'freezer holds 40 popsicles'); r1.upg.fridge = 1; ok(SHOP.cap(r1, 'pop') === 80, 'glass fridge holds 80');
  ok(!SHOP.buyUpgrade(SHOP.newRun(0, 1), 'nope'), 'unknown upgrade rejected');
}
{
  // reputation follows how customers felt: a day of walk-outs pulls it down, a day of happy buyers up
  const mk = () => { const r = SHOP.newRun(0, 31); SHOP.applySuggest(r); SHOP.openShop(r); return r; };
  const bad = mk(); for (const id in bad.price) SHOP.setPrice(bad, id, SHOP.ITEMS[id].ref * 2.2);
  while (!SHOP.dayDone(bad)) { SHOP.tick(bad); if (bad.ds.q.length) SHOP.serve(bad); }
  const rb = SHOP.closeDay(bad);
  ok(rb.rep < 50 && rb.score < 40, `overpricing everything: satisfaction ${rb.score}, reputation 50 → ${rb.rep}`);
  const good = mk(); for (const id in good.price) SHOP.setPrice(good, id, SHOP.ITEMS[id].ref * 0.9);
  while (!SHOP.dayDone(good)) { SHOP.tick(good); if (good.ds.q.length) SHOP.serve(good); }
  const rg = SHOP.closeDay(good);
  ok(rg.rep > 50 && rg.score > 70, `bargain prices, nobody waiting: satisfaction ${rg.score}, reputation 50 → ${rg.rep}`);
  ok(SHOP.arrivalRate({ ...good, rep: 30 }, 600) < SHOP.arrivalRate({ ...good, rep: 80 }, 600), 'lower reputation means fewer customers');
  // the suggestion counts customers who found an item sold out, reads today's weather, and does not pad the last day
  const s1 = SHOP.newRun(0, 44); s1.hist.push({ day: 1, wx: 'cloudy', chance: 0, event: null, rep0: 50, sold: { noodle: 10 }, oosItem: { noodle: 8 }, bulkN: 0 });
  s1.day = 2; SHOP.planDay(s1); s1.today = { base: 'cloudy', chance: 0, win: null }; s1.event = null;
  const g1 = SHOP.suggest(s1).noodle;
  s1.hist[0].oosItem = {}; const g0 = SHOP.suggest(s1).noodle;
  ok(g1 > g0 + 6, `照建議 adds the sold-out customers (${g0} → ${g1} 王子麵)`);
  s1.today = { base: 'typhoon', chance: 100, win: [420, 1260] }; const gT = SHOP.suggest(s1).noodle;
  ok(gT > g0 * 1.3, `照建議 stocks more 王子麵 for a typhoon (${g0} → ${gT})`);
  s1.today = { base: 'cloudy', chance: 0, win: null }; s1.hist[0].oosItem = { noodle: 8 }; s1.day = DAYS; s1.event = null;
  const gL = SHOP.suggest(s1).noodle;
  ok(gL < g1, `last day: 照建議 buys only what today should sell (${g1} → ${gL})`);
  // upgrades: the new shelf makes customers pick up a second item more often
  const a = SHOP.newRun(0, 9), b = SHOP.newRun(0, 9); b.upg.shelf = 1;
  for (const r of [a, b]) { for (const id in r.order) r.order[id] = 0; for (const id of SEASONS[0].items) { r.cash = 1e5; SHOP.setOrder(r, id, 60); } SHOP.openShop(r); while (!SHOP.dayDone(r)) { SHOP.tick(r); if (r.ds.q.length) SHOP.serve(r); } SHOP.closeDay(r); }
  ok(b.last.items > a.last.items, `new shelf: more items per day (${a.last.items} → ${b.last.items})`);
}
{
  // forecasts never contradict themselves: rain/typhoon forecasts say 100%, any other forecast says less, and
  // a wrong forecast's chance comes from its own weather (seed 92 / 118 used to show 晴天・降雨 100%)
  let bad = [], n = 0;
  for (let season = 0; season < 4; season++) for (let seed = 1; seed <= 400; seed++) {
    const r = SHOP.newRun(season, seed);
    for (const w of r.wxs) {
      const f = w.fc; n++;
      const wet = f.base === 'rain' || f.base === 'typhoon';
      const okC = wet ? f.chance === 100 : f.chance >= 0 && f.chance <= 70 && (f.base !== 'sun' && f.base !== 'hot' || f.chance <= 60) && (f.base !== 'cold' || f.chance <= 20);
      if (!okC || !SHOP.WX[f.base] || (f.base !== w.base && wet && w.chance === 100 && w.base === f.base)) bad.push(`${season}/${seed} ${f.base} ${f.chance}%`);
    }
  }
  ok(!bad.length, `forecast weather and rain chance agree in ${n} forecasts ${bad.slice(0, 5).join(', ')}`);
  const r92 = SHOP.newRun(0, 92).wxs[0].fc, r118 = SHOP.newRun(0, 118).wxs[3].fc;
  ok(r92.chance < 100 && r118.chance < 100, `the reported cases: seed 92 day 1 → ${r92.base} ${r92.chance}%, seed 118 day 4 → ${r118.base} ${r118.chance}%`);
}
// --- stars and the skill curve (a casual player can finish every season) ---
{
  ok(SHOP.stars(0, 0) === 0 && SHOP.stars(0, SEASONS[0].stars[0]) === 1 && SHOP.stars(0, SEASONS[0].stars[2] + 1) === 3, 'stars thresholds');
  for (let s = 0; s < 4; s++) {
    const cash = [101, 202, 303].map(seed => casual(s, seed, { serve: true }).cash);
    ok(cash.every(c => SHOP.stars(s, c) >= 1), `${SEASONS[s].id}: following the suggestions at reference prices earns at least 1★ (${cash.join(', ')})`);
  }
  // doing nothing (no stock) loses money
  const idle = SHOP.newRun(0, 4); while (idle.phase !== 'end') { playDay(idle); if (idle.phase === 'report') SHOP.nextDay(idle); }
  ok(idle.cash === SEASONS[0].start - SEASONS[0].rent * DAYS && SHOP.stars(0, idle.cash) === 0, 'an empty shop only pays rent');
}

// --- page drive ---
(async () => {
  let chromium;
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { console.log('(playwright not found, page checks skipped)'); return done(); }
  const SK = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
  const page_ = SK + html + '</body></html>';
  const srv = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(page_); });
  await new Promise(r => srv.listen(0, r));
  const URL = 'http://localhost:' + srv.address().port + '/app/little-shop/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage(), errors = [], external = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith('http://localhost') && !r.url().startsWith('data:')) external.push(r.url()); });
    await page.goto(URL); await page.waitForTimeout(600);
    ok(await page.isVisible('#title') && await page.isVisible('#bStart'), 'title screen with the start button on first open');
    ok(await page.evaluate(() => __shop.view === 'title' && __shop.Scene.actors.size > 0), 'title shows the shop with customers in the background');
    // the forecast line and its hint say the same thing, over many seeds
    const fcBad = await page.evaluate(() => {
      const out = []; let n = 0;
      for (let season = 0; season < 4; season++) for (let seed = 1; seed <= 300; seed++) for (const w of SHOP.newRun(season, seed).wxs) {
        const f = w.fc, line = wxLine(f), hint = wxAdvice(f.base, f.chance), wet = f.base === 'rain' || f.base === 'typhoon'; n++;
        const sayRain = /下雨|颱風/.test(line), hintRain = /可能會下雨/.test(hint);
        if (sayRain !== wet || /100%/.test(line) || (hintRain && (wet || f.chance < 40)) || (!wet && f.base !== 'hot' && f.base !== 'cold' && f.chance >= 40 && !hintRain)) out.push(`${season}/${seed}: ${line}｜${hint}`);
      }
      return { n, out: out.slice(0, 4), bad: out.length };
    });
    ok(fcBad.bad === 0, `forecast line and hint agree in ${fcBad.n} forecasts ${fcBad.out.join(' / ')}`);
    await page.tap('#bStart'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => __shop.view === 'market'), 'start opens the morning market');
    const b0 = await page.evaluate(() => __shop.run.order.noodle);
    for (let i = 0; i < 6; i++) { await page.tap('.item[data-id="noodle"] [data-a="b+"]'); await page.waitForTimeout(125); }
    ok(await page.evaluate(() => __shop.run.order.noodle) === b0 + 6, 'six taps on ＋ order six packs');
    await page.tap('.item[data-id="noodle"] [data-a="p+"]'); await page.waitForTimeout(80);
    ok(await page.evaluate(() => __shop.run.price.noodle) === ITEMS.noodle.ref + 1, 'price ＋ raises the price by $1');
    await page.tap('#bSuggest'); await page.waitForTimeout(100);
    ok(await page.evaluate(() => SHOP.orderCost(__shop.run) > 0), '照建議 fills the order');
    await page.reload(); await page.waitForTimeout(500);
    ok(await page.evaluate(() => __shop.view === 'market' && __shop.run.price.noodle === 16), 'refresh keeps the market and prices');
    await page.tap('#bOpen'); await page.waitForTimeout(300);
    ok(await page.evaluate(() => __shop.view === 'day' && __shop.run.phase === 'day'), 'open starts the day');
    await page.evaluate(() => { const r = __shop.run; while (r.ds.q.length < 3) SHOP.tick(r); });
    const before = await page.evaluate(() => __shop.run.ds.served);
    await page.tap('#bServe'); await page.waitForTimeout(60);
    ok(await page.evaluate(() => __shop.run.ds.served) >= before + 1 && await page.evaluate(() => __shop.run.ds.taps) === 1, 'touching 結帳 serves the counter');
    await page.waitForTimeout(1600);
    const t1 = await page.evaluate(() => { __shop.save(); return __shop.run.ds.t; });
    await page.reload(); await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ v: __shop.view, t: __shop.run.ds && __shop.run.ds.t }));
    ok(after.v === 'day' && Math.abs(after.t - t1) <= 30, `refresh mid-day resumes the same moment (${t1} → ${after.t})`);
    ok(await page.evaluate(() => __shop.paused && !!document.getElementById('pauseBox')), 'after a refresh the day waits paused');
    await page.tap('#pauseBox [data-r]'); await page.waitForTimeout(100);
    await page.evaluate(() => { const r = __shop.run; while (!SHOP.dayDone(r)) SHOP.tick(r); });
    for (let i = 0; i < 40 && await page.evaluate(() => __shop.view) !== 'report'; i++) await page.waitForTimeout(100);
    { const vv = await page.evaluate(() => __shop.view + '/' + __shop.run.phase + '/' + __shop.paused); ok(vv === 'report/report/false', 'closing time shows the report (' + vv + ')'); }
    await page.reload(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => __shop.view === 'report'), 'refresh keeps the report');
    await page.tap('#bNext'); await page.waitForTimeout(200);
    ok(await page.evaluate(() => __shop.view === 'market' && __shop.run.day === 2), 'next morning is day 2');
    ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
    ok(external.length === 0, 'no external requests: ' + external.join(' '));
  } finally { await browser.close(); srv.close(); }
  done();
})();
function done() { console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
