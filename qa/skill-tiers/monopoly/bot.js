// Skill-tier bots for 大富翁 (monopoly). Board game vs three computers: a tier is the player's decision quality.
// Decisions use the game's own core (CORE block of apps/monopoly/index.html).
//   node bot.js --sim [N]      large node simulation: every tier vs every computer level (新手/普通/高手)
//   node bot.js --browser      real Chromium games with CDP touch input (one per tier vs 普通, superhuman also vs 高手)
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '../../../apps/monopoly/index.html');
const MP = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MP;')();
const H = require('./harness.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };

// --- decision policies by tier ---
// clumsy: half random legal choice, else the game's 'random-ish' policy; mis-taps the other button 15% of the time
// casual: simple fixed-reserve policy, 15% random
// skilled: danger-aware heuristic (the 普通 computer's brain)
// world: heuristic + random-dice rollouts (the 高手 computer's brain), only what is on screen
// superhuman: knows the dice stream (perfect information) — plays every option out to the end of the game exactly and keeps the best
function mainOpts(st) { return MP.legal(st).filter(a => ['roll', 'roll1', 'buy', 'skip', 'build', 'take', 'pay', 'auto', 'bankrupt', 'bail', 'card', 'up'].includes(a.a)); }
function finalScore(s) { if (s.P[0].out) return -1e6 + s.outOrder.indexOf(0); const r = MP.ranking(s).indexOf(0); return (3 - r) * 1e5 + MP.netWorth(s, 0); }
function playOut(s, selfLv) { for (let k = 0; k < 60000 && s.phase !== 'over'; k++) { const lv = s.actor === 0 ? selfLv : MP.cpuLevel(s, s.actor); const x = MP.think(s, lv); if (!x || !MP.act(s, x)) break; } return s; }
function superChoice(st) {
  const base = MP.think(st, 2), L = mainOpts(st);
  let opts = [];
  if (st.phase === 'roll') { const ups = L.filter(a => a.a === 'up'); opts = [{ a: 'roll' }].concat(L.some(a => a.a === 'roll1') ? [{ a: 'roll1' }] : [], ups.slice(0, 3)); if (L.some(a => a.a === 'bail')) opts.push({ a: 'bail' }); if (L.some(a => a.a === 'card')) opts.push({ a: 'card' }); }
  else if (['buy', 'build', 'take'].includes(st.phase)) opts = L.filter(a => a.a !== 'roll');
  else return base;
  if (opts.length < 2) return base;
  let best = base, bv = -Infinity;
  for (const a of opts) { const s = MP.clone(st); if (!MP.act(s, a)) continue; const v = finalScore(playOut(s, 2)); if (v > bv) { bv = v; best = a; } }
  return best;
}
function choose(st, tier, rng) {
  const L = mainOpts(st); if (!L.length) return null;
  const pick = () => L[Math.floor(rng() * L.length)];
  if (st.phase === 'debt') return MP.think(st, 2);   // everyone pays or uses 自動變賣 (the only real choice)
  switch (tier) {
    case 'clumsy': return rng() < 0.5 ? pick() : MP.think(st, 0);
    case 'casual': return rng() < 0.15 ? pick() : MP.think(st, 1);
    case 'skilled': return MP.think(st, 2);
    case 'world': return MP.think(st, 3);
    case 'superhuman': return superChoice(st);
  }
}
// motor slip: the bot meant one button but hit the neighbour (buy/skip, build/skip, take/skip)
function slip(st, a, tier, rng) {
  const m = H.TIERS[tier].mistake; if (!(rng() < m)) return a;
  if (['buy', 'build', 'take'].includes(a.a)) return { a: 'skip' };
  if (a.a === 'skip') { const o = MP.legal(st).find(x => ['buy', 'build', 'take'].includes(x.a)); return o || a; }
  return a;
}

function simulate(N) {
  const out = {};
  for (const tier of H.TIER_IDS) {
    out[tier] = {};
    for (const diff of [0, 1, 2]) {
      const n = tier === 'superhuman' ? Math.round(N / 4) : N;
      let win = 0, rk = 0, bust = 0, worth = 0; const rng = H.makeRng(1234 + diff * 7);
      const t0 = Date.now();
      for (let g = 0; g < n; g++) {
        const st = MP.newGame({ seed: 70000 + g, rounds: 20, diff });
        let k = 0;
        while (st.phase !== 'over' && k++ < 60000) {
          let a;
          if (st.actor === 0) { a = choose(st, tier, rng); a = slip(st, a, tier, rng); if (!MP.isLegal(st, a)) a = MP.think(st, 2); }
          else a = MP.think(st, MP.cpuLevel(st, st.actor));
          if (!MP.act(st, a)) throw new Error('illegal ' + JSON.stringify(a));
        }
        const r = st.over.rank.indexOf(0); if (!r) win++; rk += r + 1; if (st.P[0].out) bust++; worth += st.over.worth[0];
      }
      out[tier][['新手', '普通', '高手'][diff]] = { games: n, winPct: +(win / n * 100).toFixed(1), avgRank: +(rk / n).toFixed(2), bustPct: +(bust / n * 100).toFixed(1), avgWorth: Math.round(worth / n), sec: +((Date.now() - t0) / 1000).toFixed(1) };
      console.log(tier.padEnd(10), ['新手', '普通', '高手'][diff], JSON.stringify(out[tier][['新手', '普通', '高手'][diff]]));
    }
  }
  return out;
}

// --- real browser game: read state through __mono, act only with touch ---
async function browserGame(browser, tier, diff, seed, rounds) {
  const sess = await H.newSession(browser, 'file://' + APP);
  const pl = new H.Player(sess, tier, seed), { page } = sess, rng = H.makeRng(seed * 3 + 1);
  await page.evaluate(([s, r, d]) => { __mono.setSpeed(4); __mono.newGame({ seed: s, rounds: r, diff: d }); }, [seed, rounds, diff]);
  const t0 = Date.now(); let decisions = 0, misses = 0, stuck = 0, last = '';
  const log = { taps: 0, dropped: 0 };
  while (Date.now() - t0 < 420000) {
    const u = await page.evaluate(() => __mono.ui());
    if (u.result) break;
    if (!u.human) { if (tier === 'superhuman' || pl.rng() < 0.5) { if (await page.isVisible('#skip')) await pl.tapSelector('#skip'); } await H.sleep(80); continue; }
    if (u.card) { await pl.tapSelector('#cardOk'); await H.sleep(100); continue; }
    const st = await page.evaluate(() => __mono.state());
    await H.sleep(pl.reactMs() + pl.thinkMs(st.phase === 'roll' ? 0.3 : 1));
    let a = choose(st, tier, rng); a = slip(st, a, tier, rng); if (!MP.isLegal(st, a)) a = MP.think(st, 2);
    decisions++;
    const sig = JSON.stringify([st.turnNo, st.phase, st.P[0].cash, st.dq.length]);
    if (sig === last) { if (++stuck > 25) throw new Error('stuck at ' + sig); } else { stuck = 0; last = sig; }
    let sel = null;
    if (a.a === 'roll') sel = '#diceBtn';
    else if (a.a === 'roll1') sel = '#one';
    else if (a.a === 'bail') sel = '#sAct .sb:first-child';
    else if (a.a === 'card') sel = '#sAct .sb:last-child';
    else if (a.a === 'up') { await pl.tapSelector('#bAssets'); await H.sleep(250); sel = `#aBody button[data-a="up"][data-i="${a.sq}"]`; }
    else if (['buy', 'build', 'take'].includes(a.a)) sel = '#pop .sb.pri';
    else if (a.a === 'skip') sel = '#pop .sb:not(.pri)';
    else if (['pay', 'auto', 'bankrupt'].includes(a.a)) sel = '#debtBtns button:not([disabled])';
    const before = await page.evaluate(() => JSON.stringify([__mono.state().turnNo, __mono.state().phase, __mono.state().P[0].cash, __mono.state().own, __mono.state().lvl, __mono.counts()]));
    let okTap = false, inside = true;
    if (sel) { const b = await page.locator(sel).first().boundingBox(); if (b) { const sg = Math.min(pl.t.pos, Math.min(b.width, b.height) / 3); const x = b.x + b.width / 2 + (sg ? pl.rng.gauss(0, sg) : 0), y = b.y + b.height / 2 + (sg ? pl.rng.gauss(0, sg) : 0); inside = x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height; await pl.tap(x, y, { exact: true }); okTap = true; } }
    log.taps++;
    if (a.a === 'up') { await H.sleep(200); if (await page.isVisible('#assets')) await pl.tapSelector('#assets .x'); }
    await H.sleep(250);
    const after = await page.evaluate(() => JSON.stringify([__mono.state().turnNo, __mono.state().phase, __mono.state().P[0].cash, __mono.state().own, __mono.state().lvl, __mono.counts()]));
    if (!okTap || before === after) { if (inside && okTap) { misses++; log.dropped++; log.droppedWhat = (log.droppedWhat || []).concat([a.a + '@' + st.phase]); } else log.offTarget = (log.offTarget || 0) + 1; }
  }
  const G = await page.evaluate(() => __mono.state());
  const res = { tier, diff: ['新手', '普通', '高手'][diff], seed, rounds, over: !!G.over, rank: G.over ? G.over.rank.indexOf(0) + 1 : null, reason: G.over && G.over.reason, worth: G.over ? G.over.worth[0] : null, decisions, tapsWithoutEffect: misses, droppedWhat: log.droppedWhat || [], offTargetTaps: log.offTarget || 0, timeS: +((Date.now() - t0) / 1000).toFixed(1), stats: pl.stats, errors: sess.errors.slice() };
  await sess.ctx.close();
  return res;
}

(async () => {
  const results = { game: 'monopoly', note: 'board game vs three computers; tier = player decision quality, measured against each computer difficulty', tiers: {}, findings: [] };
  const rf = path.join(__dirname, 'results.json');
  const prev = fs.existsSync(rf) ? JSON.parse(fs.readFileSync(rf, 'utf8')) : null;
  if (process.argv.includes('--sim')) {
    const sim = simulate(+arg('--sim', 200));
    const r = prev || results; r.sim = sim; for (const t of H.TIER_IDS) { r.tiers[t] = r.tiers[t] || { runs: [], summary: {} }; r.tiers[t].summary.sim20rounds = sim[t]; }
    fs.writeFileSync(rf, JSON.stringify(r, null, 1));
  }
  if (process.argv.includes('--browser')) {
    const browser = await H.launch(); const r = prev && !process.argv.includes('--sim') ? prev : JSON.parse(fs.readFileSync(rf, 'utf8'));
    const plan = H.TIER_IDS.map((t, k) => [t, 1, 310 + k]).concat([['superhuman', 2, 320], ['clumsy', 2, 321]]);
    const only = arg('--tier', null);
    for (const [tier, diff, seed] of plan) {
      if (only && only !== tier) continue;
      const res = await browserGame(browser, tier, diff, seed, 12);
      console.log(JSON.stringify(res));
      r.tiers[tier] = r.tiers[tier] || { runs: [], summary: {} }; r.tiers[tier].runs = (r.tiers[tier].runs || []).filter(x => !(x.seed === seed)); r.tiers[tier].runs.push(res);
      fs.writeFileSync(rf, JSON.stringify(r, null, 1));
    }
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
