// 鬥地主 (dou-dizhu) skill-tier bot. Usage: node bot.js [tiers...] [--rounds=N] [--out=results.json] [--tag=afterFix]
// Five simulated players play full rounds (bidding + play) against the page's two AI farmers/landlord in headless
// Chromium (390×844, touch). Bots read state through window.__dz.info() (what a human sees: own hand, counts,
// table) and act only with real touch taps on the card fan and the buttons. Superhuman reads every hand through a
// read-only getter appended to the served copy of the page (file on disk untouched). Each round is started with the
// page's own seed hook (__dz.newGame(seed)) so all tiers get the same deals.
const fs = require('fs'), path = require('path'), http = require('http');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/dou-dizhu/index.html');
const html = fs.readFileSync(APP, 'utf8');
const DZ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return DZ;')();
const args = process.argv.slice(2);
const TIER_LIST = args.filter(a => H.TIERS[a]).length ? args.filter(a => H.TIERS[a]) : H.TIER_IDS;
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const LEVEL = +opt('level', 1), ROUNDS = +opt('rounds', 8), OUT = path.resolve(__dirname, opt('out', 'results.json')), TAG = opt('tag', ''), CAP_MS = 240000;
const SEEDS = []; for (let i = 0; i < ROUNDS; i++) SEEDS.push(4101 + i * 37);
const HOOK = "window.__dzAll = function () { return G ? { hands: G.hands.map(function (h) { return h.slice(); }), bottom: G.bottom.slice(), passes: G.passes } : null; };\n";

function serve() {
  const marker = 'rafId = requestAnimationFrame(frame);\n})();';
  const at = html.lastIndexOf(marker);
  const served = html.slice(0, at) + HOOK + html.slice(at);
  return new Promise(res => { const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(served); }); srv.listen(0, '127.0.0.1', () => res(srv)); });
}
const sortIds = a => a.slice().sort((x, y) => x - y);
const same = (a, b) => sortIds(a).join() === sortIds(b).join();
const sum = a => a.reduce((x, y) => x + y, 0);

// ---------- policies ----------
// unseen pool for world tier: every card not played and not in my hand
function unseen(view) { const mine = {}; view.hand.forEach(c => { mine[c] = 1; }); view.played.forEach(c => { mine[c] = 1; }); const out = []; for (let c = 0; c < 54; c++) if (!mine[c]) out.push(c); return out; }
function unbeatableBy(hands, ev) { return hands.every(h => DZ.gen(h, ev).length === 0); }
function finishable(hand) { return DZ.gen(hand, null).some(o => o.cards.length === hand.length); }

function policyPlay(tier, view, rng, all) { // returns {cards|null, hint:boolean}
  const lead = view.lead ? view.lead.ev : null, hand = view.hand;
  const legal = DZ.hints(hand, lead);
  const win = legal.find(o => o.cards.length === hand.length); if (win) return { cards: win.cards };
  if (tier === 'clumsy') {
    if (!legal.length) return { cards: null };
    if (lead && rng() < 0.3) return { cards: null }; // gives up on following quite often
    if (rng() < 0.5) return { cards: rng.pick(legal).cards, random: true };
    return { cards: legal[0].cards }; // 1-step greedy: smallest play
  }
  if (tier === 'casual') {
    if (!legal.length) return { cards: null };
    if (rng() < 0.15) return { cards: rng.pick(legal.filter(o => !DZ.isBomb(o.ev)).length ? legal.filter(o => !DZ.isBomb(o.ev)) : legal).cards, random: true };
    const nb = legal.filter(o => !DZ.isBomb(o.ev));
    if (lead && !nb.length) return { cards: null }; // never bombs on purpose
    if (lead && lead.k >= 11 && nb[0].ev.k >= 13 && hand.length > 6) return { cards: null }; // keeps jokers
    return { cards: nb.length ? nb[0].cards : null };
  }
  if (tier === 'skilled') return { cards: DZ.think(view, Math.floor(rng() * 1e9)).cards };
  if (tier === 'world') {
    const base = DZ.think(view, Math.floor(rng() * 1e9)).cards;
    const pool = unseen(view), combos = DZ.bestSplit(hand);
    // endgame: if every combo of mine is unbeatable by any combination of unseen cards, cash them in highest first
    if (combos.length <= 4 && combos.every(o => DZ.gen(pool, o.ev).length === 0 || DZ.isBomb(o.ev)) && (!lead || legal.length)) {
      const cand = lead ? legal : combos.slice().sort((a, b) => b.ev.k - a.ev.k);
      if (cand.length) return { cards: cand[0].cards };
    }
    if (!lead) { // lead a combo unseen cards cannot beat when the opponent is close to finishing
      const safe = combos.filter(o => DZ.gen(pool, o.ev).length === 0 && !DZ.isBomb(o.ev));
      const oppMin = view.me === view.landlord ? Math.min(view.counts[(view.me + 1) % 3], view.counts[(view.me + 2) % 3]) : view.counts[view.landlord];
      if (safe.length && oppMin <= 4) return { cards: safe.sort((a, b) => a.ev.k - b.ev.k)[0].cards };
    }
    return { cards: base };
  }
  // superhuman: perfect information -> exact endgame solver, otherwise informed heuristics
  const me = view.me, L = view.landlord, farmer = me !== L;
  const oppIdx = farmer ? [L] : [(me + 1) % 3, (me + 2) % 3];
  const opps = oppIdx.map(p => all.hands[p]);
  const partner = farmer ? [0, 1, 2].find(p => p !== me && p !== L) : -1;
  const total = sum(all.hands.map(h => h.length));
  if (total <= 24) { const m = solveMove(all.hands, me, view.lead, all.passes || 0, L); if (m !== undefined) return { cards: m, solved: true }; }
  const combos = DZ.bestSplit(hand), myHands = combos.length;
  const oppMin = Math.min(...opps.map(h => h.length));
  const after = o => DZ.handsNeeded(hand.filter(c => !o.cards.includes(c)));
  if (!lead) {
    if (combos.every(o => unbeatableBy(opps, o.ev))) return { cards: combos.slice().sort((a, b) => b.ev.k - a.ev.k)[0].cards };
    const safe = combos.filter(o => unbeatableBy(opps, o.ev) && !DZ.isBomb(o.ev));
    if (combos.length === 2 && safe.length === 1) { const other = combos.find(o => o !== safe[0]); if (unbeatableBy(opps, other.ev)) return { cards: other.cards }; }
    if (farmer && all.hands[partner].length <= 2 && all.hands[partner].length < all.hands[L].length) {
      const feed = DZ.gen(hand, null).filter(o => o.ev.n === all.hands[partner].length && DZ.gen(all.hands[partner], o.ev).length > 0 && DZ.gen(all.hands[L], o.ev).length === 0).sort((a, b) => a.ev.k - b.ev.k);
      if (feed.length) return { cards: feed[0].cards };
    }
    if (safe.length && (oppMin <= 4 || myHands <= 3)) return { cards: safe.sort((a, b) => a.ev.k - b.ev.k)[0].cards };
    // midgame: shed the weakest combo first (long ones before singles), keep control cards for later
    const low = combos.filter(o => !DZ.isBomb(o.ev)).sort((a, b) => (a.ev.k - b.ev.k) || (b.ev.n - a.ev.n));
    return { cards: low.length ? low[0].cards : combos[0].cards };
  }
  const byOpp = farmer ? view.lead.by === L : true;
  if (!byOpp) { // partner led: take over only when the landlord can beat it and I have an answer the landlord cannot
    if (DZ.gen(all.hands[L], lead).length === 0) return { cards: null };
    const safe = legal.filter(o => unbeatableBy(opps, o.ev) && !DZ.isBomb(o.ev)).sort((a, b) => (after(a) - after(b)) || (a.ev.k - b.ev.k));
    if (safe.length && after(safe[0]) <= myHands) return { cards: safe[0].cards };
    return { cards: null };
  }
  const cand = legal.filter(o => !DZ.isBomb(o.ev)).map(o => { const a = after(o); return { o, a, safe: unbeatableBy(opps, o.ev), cost: (a - (myHands - 1)) * 2 + o.ev.k / 14 - (unbeatableBy(opps, o.ev) ? 1.5 : 0) }; }).sort((x, y) => x.cost - y.cost);
  const bombs = legal.filter(o => DZ.isBomb(o.ev)).sort((a, b) => a.ev.k - b.ev.k);
  // the leader could run out unopposed if we let this trick go: every remaining combo of theirs beats what we (and the partner) hold
  const ldHand = all.hands[view.lead.by], teamHands = farmer ? [hand, all.hands[partner]] : [hand];
  const ldRest = ldHand.length <= 12 && DZ.bestSplit(ldHand).every(o => unbeatableBy(teamHands, o.ev));
  const urgent = oppMin <= 3 || myHands <= 3 || ldRest;
  if (cand.length && (cand[0].cost <= 2.2 || urgent)) return { cards: cand[0].o.cards };
  if (bombs.length && (oppMin <= 4 || lead.n >= 5 || lead.k >= 12 || DZ.isBomb(lead))) return { cards: bombs[0].cards };
  return { cards: null };
}
// exact solver for small endgames (perfect information, two teams). Returns the winning move for `me`, null to pass, undefined if unknown/none winning.
function solveMove(hands, me, lead, passes, landlord) {
  const memo = new Map(); let nodes = 0; const LIMIT = 150000;
  const team = p => p === landlord ? 0 : 1;
  function leader(lg) { return lg ? lg.by : -1; }
  function rec(hs, turn, ld, ps) { // true if team(turn) wins
    for (let p = 0; p < 3; p++) if (!hs[p].length) return team(p) === team(turn);
    if (++nodes > LIMIT) throw 0;
    const key = hs.map(h => h.join('.')).join('|') + '|' + turn + '|' + (ld ? ld.by + ':' + ld.ev.t + ld.ev.k + ld.ev.n : '') + '|' + ps;
    if (memo.has(key)) return memo.get(key);
    const moves = DZ.gen(hs[turn], ld ? ld.ev : null);
    let res = false;
    // try finishing moves first, then by size
    moves.sort((a, b) => (b.cards.length === hs[turn].length) - (a.cards.length === hs[turn].length) || a.ev.k - b.ev.k);
    for (const m of moves) {
      const nh = hs.slice(); nh[turn] = hs[turn].filter(c => !m.cards.includes(c));
      const nt = (turn + 1) % 3, child = rec(nh, nt, { by: turn, ev: m.ev }, 0);
      if (team(nt) === team(turn) ? child : !child) { res = true; break; }
    }
    if (!res && ld) { // pass
      let nt = (turn + 1) % 3, nl = ld, np = ps + 1;
      if (np >= 2) { nt = ld.by; nl = null; np = 0; }
      const child = rec(hs, nt, nl, np);
      if (team(nt) === team(turn) ? child : !child) res = true;
    }
    memo.set(key, res); return res;
  }
  try {
    const moves = DZ.gen(hands[me], lead ? lead.ev : null).sort((a, b) => (b.cards.length === hands[me].length) - (a.cards.length === hands[me].length) || b.cards.length - a.cards.length || a.ev.k - b.ev.k);
    for (const m of moves) { const nh = hands.slice(); nh[me] = hands[me].filter(c => !m.cards.includes(c)); const nt = (me + 1) % 3; const child = rec(nh, nt, { by: me, ev: m.ev }, 0); if (team(nt) === team(me) ? child : !child) return m.cards; }
    if (lead) { let nt = (me + 1) % 3, nl = lead, np = passes + 1; if (np >= 2) { nt = lead.by; nl = null; np = 0; } const child = rec(hands, nt, nl, np); if (team(nt) === team(me) ? child : !child) return null; }
    return undefined; // losing position: fall back to heuristics
  } catch (e) { return undefined; }
}
function policyBid(tier, view, rng, all, cur, wantL) {
  const s = DZ.strength(view.hand);
  let v;
  if (tier === 'clumsy') v = rng.int(4);
  else if (tier === 'casual') v = s >= 7 ? 3 : s >= 5 ? 2 : s >= 3.5 ? 1 : 0;
  else if (tier === 'skilled') v = DZ.suggestBid(view.hand, cur, Math.floor(rng() * 1e9));
  else if (tier === 'world') v = s >= 7.5 ? 3 : s >= 5.5 ? 2 : s >= 4.5 ? 1 : 0;
  else { // superhuman: compares with the other two hands (plus the bottom cards it would get)
    const others = [0, 1, 2].filter(p => p !== view.me).map(p => DZ.strength(all.hands[p]));
    const mine = DZ.strength(view.hand.concat(all.bottom));
    v = mine >= Math.max(...others) + 2.5 && DZ.handsNeeded(view.hand.concat(all.bottom)) <= 7 ? 3 : mine >= Math.max(...others) + 1 ? 2 : 0;
  }
  if (wantL != null) v = wantL ? (s >= 3 || tier === 'casual' ? 3 : v) : (tier === 'clumsy' ? v : 0);
  if (v && v <= cur) v = tier === 'clumsy' ? 0 : (v < 3 && cur < 3 && s >= 5 ? cur + 1 : 0);
  return v;
}

// ---------- one round ----------
async function playRound(P, seed, tierId, wantL, log) {
  const { page } = P, rng = P.rng;
  const info = () => page.evaluate(() => window.__dz.info());
  const allHands = () => page.evaluate(() => window.__dzAll());
  await page.evaluate(s => window.__dz.newGame(s), seed);
  const t0 = Date.now(); let lastChange = Date.now(), lastSig = '';
  const run = { seed, tier: tierId, bidsMade: [], humanPlays: 0, passes: 0, hintTaps: 0, misselects: 0, wrongCardTaps: 0, randomPlays: 0, fixes: 0, hintFallbacks: 0, bombsMine: 0, errors: [] };
  let coins0 = null, hintChecked = false, done = null;
  while (Date.now() - t0 < CAP_MS) {
    const inf = await info();
    if (coins0 == null) coins0 = inf.coins;
    const sig = [inf.phase, inf.gphase, inf.turn, inf.counts && inf.counts.join(), inf.overlay, inf.bid].join('|');
    if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
    else if (Date.now() - lastChange > 25000) { run.softlock = sig; log('softlock', { seed, tier: tierId, sig }); break; }
    if (inf.overlay === 'help') { await P.tapSelector('#hOk'); await H.sleep(200); continue; }
    if (inf.overlay === 'roundEnd') { done = inf; break; }
    if (inf.overlay && inf.overlay !== 'title') { log('unexpected-overlay', { seed, overlay: inf.overlay }); break; }
    if (inf.busy || inf.paused || inf.turn !== 0 || inf.phase === 'deal') { await H.sleep(P.superhuman ? 30 : 80); continue; }
    if (inf.gphase === 'bid') {
      await H.sleep(P.thinkMs(0.6) + P.reactMs());
      const all = P.superhuman ? await allHands() : null;
      let v = policyBid(tierId, inf.view, rng, all, inf.bid, wantL);
      if (P.mistake() && v < 3) v = Math.min(3, v + 1) > inf.bid ? Math.min(3, v + 1) : 0; // fat-finger the neighbouring button
      const dis = await page.locator('#bid' + v).isDisabled(); if (dis) v = 0;
      await P.tapSelector('#bid' + v); run.bidsMade.push(v); await H.sleep(150); continue;
    }
    if (inf.gphase !== 'play') { await H.sleep(60); continue; }
    // ----- play decision -----
    await H.sleep(P.thinkMs(inf.lead ? 0.7 : 1) + P.reactMs());
    const all = P.superhuman ? await allHands() : null;
    const dec = policyPlay(tierId, inf.view, rng, all);
    if (dec.random) run.randomPlays++;
    // hint button check once per round (all tiers press it at least once, like a curious human)
    if (!hintChecked && inf.lead && rng() < 0.6) {
      hintChecked = true; await P.tapSelector('#bHint'); run.hintTaps++; await H.sleep(120);
      if (!(await info()).sel.length) { run.missedButtonTaps = (run.missedButtonTaps || 0) + 1; await P.tapSelector('#bHint'); run.hintTaps++; await H.sleep(120); } // a noisy tap can miss the 48px button; a human taps again
      const s = (await info()).sel, legalN = DZ.hints(inf.view.hand, inf.lead.ev).length;
      if (legalN && !(s.length && DZ.evaluate(s) && DZ.beats(DZ.evaluate(s), inf.lead.ev))) { run.errors.push('hint selected an illegal play'); log('hint-illegal', { seed, sel: s }); }
      if (!legalN && s.length) { run.errors.push('hint selected cards although nothing beats the lead'); log('hint-nothing', { seed, sel: s }); }
      // clear the hint selection by tapping the cards again
      for (const c of (await info()).sel) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); await P.tap(p.x, p.y, { exact: true }); await H.sleep(40); }
    }
    if (!dec.cards) {
      if (!inf.lead) { // must play something when leading: lowest card
        const low = DZ.hints(inf.view.hand, null)[0].cards; dec.cards = low;
      } else {
        if (P.mistake()) { await P.tapSelector('#bHint'); run.hintTaps++; await H.sleep(80); for (const c of (await info()).sel) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); await P.tap(p.x, p.y, { exact: true }); await H.sleep(30); } }
        await P.tapSelector('#bPass'); run.passes++; await H.sleep(120); continue;
      }
    }
    // select the cards by tapping the fan (with the tier's positional noise); a mistake taps a neighbouring card
    let target = dec.cards.slice();
    if (P.mistake() && inf.view.hand.length > target.length) { const extra = inf.view.hand.find(c => !target.includes(c)); target = target.concat([extra]); run.wrongCardTaps++; }
    for (const c of target) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); if (!p) continue; await P.tap(p.x, p.y); await H.sleep(P.superhuman ? 16 : 60 + Math.abs(rng.gauss(0, 30))); }
    let sel = (await info()).sel;
    if (!same(sel, dec.cards)) {
      run.misselects++;
      const tries = tierId === 'clumsy' ? 1 : tierId === 'casual' ? 2 : 3;
      for (let k = 0; k < tries && !same(sel, dec.cards); k++) { // notice the wrong selection and fix it card by card
        run.fixes++;
        const wrong = sel.filter(c => !dec.cards.includes(c)), missing = dec.cards.filter(c => !sel.includes(c));
        for (const c of wrong.concat(missing)) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); if (!p) continue; await P.tap(p.x, p.y); await H.sleep(P.superhuman ? 16 : 70); }
        sel = (await info()).sel;
      }
    }
    const canPlay = sel.length && !(await page.locator('#bPlay').isDisabled());
    if (!canPlay) { // the selection is not a legal play: a human would press 提示 (or pass when following)
      for (const c of sel) { const p = await page.evaluate(c => window.__dz.cardCenter(c), c); if (!p) continue; await P.tap(p.x, p.y, { exact: true }); await H.sleep(30); }
      if (inf.lead && DZ.hints(inf.view.hand, inf.lead.ev).length === 0) { await P.tapSelector('#bPass'); run.passes++; await H.sleep(120); continue; }
      await P.tapSelector('#bHint'); run.hintTaps++; run.hintFallbacks++; await H.sleep(100);
      if (await page.locator('#bPlay').isDisabled()) { if (inf.lead) { await P.tapSelector('#bPass'); run.passes++; } else { run.errors.push('no legal play offered while leading'); log('lead-stuck', { seed, hand: inf.view.hand }); } await H.sleep(120); continue; }
    }
    const played = (await info()).sel; const pe = DZ.evaluate(played); if (pe && DZ.isBomb(pe)) run.bombsMine++;
    await P.tapSelector('#bPlay'); run.humanPlays++; await H.sleep(P.superhuman ? 40 : 120);
  }
  run.timeS = +((Date.now() - t0) / 1000).toFixed(1);
  if (!done) { if (!run.softlock) run.timeout = true; run.role = null; run.won = null; return run; }
  const res = done.result;
  run.role = done.landlord === 0 ? 'landlord' : 'farmer'; run.bid = done.bid; run.won = res.deltas[0] > 0; run.delta = res.deltas[0] * 100; run.coinsAfter = done.coins; run.mult = res.mult; run.base = res.base;
  run.spring = res.spring; run.anti = res.anti; run.bombs = res.bombs; run.countsEnd = done.counts;
  if (done.coins !== coins0 + run.delta) { run.errors.push(`coins ${coins0} -> ${done.coins}, expected ${coins0 + run.delta}`); log('coins-mismatch', { seed, tier: tierId }); }
  return run;
}

async function runTier(browser, tierId, idx, log) {
  const srv = await serve(), url = `http://127.0.0.1:${srv.address().port}/`;
  const init = "try{localStorage.setItem('dou-dizhu:v1:settings',JSON.stringify({speed:'fast',sound:false,vib:false,theme:'auto',seenHelp:true,level:" + LEVEL + "}));localStorage.removeItem('dou-dizhu:v1:game');localStorage.removeItem('dou-dizhu:v1:stats');}catch(e){}";
  const sess = await H.newSession(browser, url, init);
  const P = new H.Player(sess, tierId, 7000 + idx * 101);
  await H.sleep(600);
  const runs = [];
  for (let i = 0; i < SEEDS.length; i++) {
    // alternate: even rounds the player tries to be landlord (bids 3), odd rounds it stays farmer (bids 0) so both roles get measured; clumsy bids at random
    const wantL = tierId === 'clumsy' ? null : i % 2 === 0;
    let r;
    try { r = await playRound(P, SEEDS[i], tierId, wantL, log); } catch (e) { r = { seed: SEEDS[i], tier: tierId, errors: ['harness: ' + String(e).slice(0, 200)] }; }
    r.pageErrors = sess.errors.splice(0);
    runs.push(r);
    console.log(tierId, JSON.stringify({ seed: r.seed, role: r.role, bid: r.bid, won: r.won, delta: r.delta, coins: r.coinsAfter, plays: r.humanPlays, passes: r.passes, mis: r.misselects, hint: r.hintTaps, t: r.timeS, err: (r.errors || []).concat(r.pageErrors).length, softlock: !!r.softlock }));
    if (r.role == null) { await page_reset(P); }
  }
  await sess.ctx.close(); srv.close();
  const fin = runs.filter(r => r.won != null), L = fin.filter(r => r.role === 'landlord'), F = fin.filter(r => r.role === 'farmer');
  const pct = a => a.length ? +(100 * a.filter(r => r.won).length / a.length).toFixed(0) : null;
  return { runs, stats: P.stats, summary: { rounds: runs.length, finished: fin.length, landlordRounds: L.length, landlordWinPct: pct(L), farmerRounds: F.length, farmerWinPct: pct(F), winPct: pct(fin),
    coinsStart: 3000, coinsEnd: fin.length ? fin[fin.length - 1].coinsAfter : null, meanDelta: fin.length ? +(sum(fin.map(r => r.delta)) / fin.length).toFixed(0) : null,
    misselects: sum(runs.map(r => r.misselects || 0)), wrongCardTaps: sum(runs.map(r => r.wrongCardTaps || 0)), hintTaps: sum(runs.map(r => r.hintTaps || 0)), hintFallbacks: sum(runs.map(r => r.hintFallbacks || 0)),
    randomPlays: sum(runs.map(r => r.randomPlays || 0)), bombsMine: sum(runs.map(r => r.bombsMine || 0)), springs: fin.filter(r => r.spring || r.anti).length,
    softlocks: runs.filter(r => r.softlock).length, timeouts: runs.filter(r => r.timeout).length, errors: runs.reduce((a, r) => a + (r.errors || []).length + (r.pageErrors || []).length, 0), timeS: summ(runs.map(r => r.timeS || 0)) } };
}
async function page_reset(P) { try { await P.page.reload(); await H.sleep(500); } catch (e) {} }
function summ(a) { return H.summarize(a); }

if (opt('sim', '')) { // node-only policy check: no browser, the bot plays seat 0 with the same policies vs the page AI
  const N = +opt('sim', '30');
  for (const t of TIER_LIST) {
    const rng = H.makeRng(99); let w = [0, 0], n = [0, 0], coins = 0, plies = 0;
    for (let i = 0; i < N; i++) {
      let g = new DZ.Game({ seed: 5000 + i }); const wantL = i % 2 === 0; let k = 0;
      while (g.phase === 'bid') { const p = g.turn; const all = { hands: g.hands, bottom: g.bottom }; let v = p === 0 ? policyBid(t, DZ.aiView(g, 0), rng, all, g.bid, wantL) : DZ.think(DZ.aiView(g, p), i * 7 + k, LEVEL).bid; if (v && v <= g.bid) v = 0; g.doBid(p, v); k++; }
      if (g.phase !== 'play') continue;
      while (g.phase === 'play' && k < 500) { const p = g.turn, all = { hands: g.hands, bottom: g.bottom }; let c = p === 0 ? policyPlay(t, DZ.aiView(g, 0), rng, all).cards : DZ.think(DZ.aiView(g, p), i * 1000 + k, LEVEL).cards; if (c === null && !g.lead) c = DZ.hints(g.hands[p], null)[0].cards; const e = c ? g.play(p, c) : g.pass(p); if (e) { console.log('ILLEGAL', t, i, e); break; } k++; }
      if (g.phase !== 'end') continue; const r = g.result(), role = g.landlord === 0 ? 0 : 1; n[role]++; if (r.deltas[0] > 0) w[role]++; coins += r.deltas[0] * 100; plies += k;
    }
    console.log(t, 'landlord', w[0] + '/' + n[0], 'farmer', w[1] + '/' + n[1], 'coins', coins, 'plies/round', (plies / N).toFixed(1));
  }
  process.exit(0);
}
(async () => {
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'dou-dizhu', rounds: ROUNDS, seeds: SEEDS, tiers: {}, findings: [] };
  const log = (k, v) => { (out.rawFindings = out.rawFindings || []).push({ k, v, tag: TAG }); };
  const browser = await H.launch();
  for (const [i, t] of TIER_LIST.entries()) {
    const t0 = Date.now();
    const r = await runTier(browser, t, i, log);
    r.wallMin = +((Date.now() - t0) / 60000).toFixed(1);
    r.level = LEVEL;
    if (TAG) { out.afterFix = out.afterFix || { tiers: {} }; out.afterFix.tiers[TAG === 'afterFix' ? t : t + '@' + TAG] = r; } else out.tiers[t] = r;
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
    console.log('TIER', t, JSON.stringify(r.summary));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
