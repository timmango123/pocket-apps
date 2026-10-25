// 十三支 (thirteen-cards) skill-tier bot.
// Browser: node bot.js [tiers...] [--rounds=N] [--levels=0,1,2] [--out=results.json] [--tag=afterFix]
// Node simulation (same decision policies, no motor noise): node bot.js --sim=N [--levels=0,1,2] [tiers...]
// Five simulated players arrange their 13 cards against the page's three computer players at each difficulty
// (新手 / 一般 / 高手) in headless Chromium (390×844, touch). Bots read the screen through window.__tc.info()
// (own hand, own rows, overlay) and act only with CDP touch taps: tap a card then a card in another row (swap),
// 建議牌型, 報到, 比牌, the foul dialog, 下一局. Every round starts from the page's seed hook __tc.newGame(seed, level),
// so all tiers get the same deals. Superhuman also knows the deal seed (info().rs), so it can compute every hand
// and the computers' exact arrangements, and plays the best response.
const fs = require('fs'), path = require('path'), http = require('http'), { fork } = require('child_process');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/thirteen-cards/index.html');
const html = fs.readFileSync(APP, 'utf8');
const TC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TC;')();
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const TIER_LIST = args.filter(a => H.TIERS[a]).length ? args.filter(a => H.TIERS[a]) : H.TIER_IDS;
const ROUNDS = +opt('rounds', 6), LEVELS = opt('levels', '0,1,2').split(',').map(Number), OUT = path.resolve(__dirname, opt('out', 'results.json')), TAG = opt('tag', '');
const SIM = +opt('sim', 0);
const SEEDS = n => Array.from({ length: n }, (_, i) => 31000 + i * 7919);
const LV = ['新手', '一般', '高手'];
const sortIds = a => a.slice().sort((x, y) => x - y);
const key = arr => arr.map(r => sortIds(r).join(',')).join('|');

// ---------- decisions ----------
// returns { arr, declare, viaSug: index of suggestion to show (or -1), foulOk } ; rng is the tier's seeded rng
function randomArr(hand, rng) { const d = hand.slice(); for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; } return [d.slice(0, 3), d.slice(3, 8), d.slice(8)]; }
function randomSwaps(arr, rng, n) { const a = arr.map(r => r.slice()); for (let k = 0; k < n; k++) { const r1 = Math.floor(rng() * 3); let r2 = Math.floor(rng() * 2); if (r2 >= r1) r2++; const i = Math.floor(rng() * a[r1].length), j = Math.floor(rng() * a[r2].length); [a[r1][i], a[r2][j]] = [a[r2][j], a[r1][i]]; } return a; }
function decide(tier, hand, rng, ctx) {
  const sp = TC.special(hand), base = TC.arrange(hand, 0).arr;
  if (tier === 'clumsy') {
    if (sp && rng() < 0.7) return { declare: true };
    const u = rng();
    if (u < 0.5) return { arr: randomSwaps(base, rng, 1 + Math.floor(rng() * 3)), foulOk: rng() < 0.5 };   // fiddles at random
    if (u < 0.75) return { viaSug: 0, foulOk: false };
    return { arr: base };                                                                                // accepts the deal order
  }
  if (tier === 'casual') {
    if (sp) return { declare: true };
    const u = rng();
    if (u < 0.15) return { arr: randomSwaps(base, rng, 1), foulOk: false };
    if (u < 0.55) return { arr: base };
    return { viaSug: rng() < 0.8 ? 0 : 1 };
  }
  if (tier === 'skilled') {
    if (sp) return { declare: true };
    return { arr: TC.arrange(hand, 1).arr };
  }
  if (tier === 'world') {
    const r = TC.aiPlay(hand, 2, ctx.rs ^ 0x51ed27);
    return r.special ? { declare: true } : { arr: r.arr };
  }
  // superhuman: best response against the computers' exact arrangements
  const hands = TC.deal(ctx.rs), ai = [1, 2, 3].map(p => TC.aiPlay(hands[p], ctx.level, (ctx.rs ^ Math.imul(p, 0x9E3779B1)) >>> 0));
  const cands = TC.arrange(hand, 2, { top: 400, all: true }).map(c => ({ arr: c.arr, special: null }));
  if (sp) cands.push({ arr: sp.arr, special: sp });
  let best = null, bv = -1e9;
  for (const c of cands) { const v = TC.settle([c].concat(ai)).total[0]; if (v > bv) { bv = v; best = c; } }
  return best.special ? { declare: true } : { arr: best.arr };
}

// ---------- node simulation ----------
function simRound(tier, level, seed, rngSeed) {
  const rng = H.makeRng(rngSeed), sess = (seed + 7919 * 104729) >>> 0; // round 1 of a session seeded with `seed`
  const hands = TC.deal(sess), hand = hands[0];
  const d = decide(tier, hand, rng, { rs: sess, level });
  let me;
  if (d.declare) { const sp = TC.special(hand); me = { arr: sp.arr, special: sp }; }
  else if (d.viaSug !== undefined) { const sg = TC.suggestions(hand, 4); me = { arr: sg[Math.min(d.viaSug, sg.length - 1)].arr, special: null }; }
  else {
    let arr = d.arr;
    if (TC.isFoul(TC.rowVals(arr)) && !d.foulOk) arr = tier === 'clumsy' ? TC.arrange(hand, 0).arr : TC.suggestions(hand, 1)[0].arr;
    me = { arr, special: null };
  }
  const ai = [1, 2, 3].map(p => TC.aiPlay(hands[p], level, (sess ^ Math.imul(p, 0x9E3779B1)) >>> 0));
  const r = TC.settle([me].concat(ai));
  return { pts: r.total[0], foul: r.foul[0], guns: r.gun[0].reduce((a, b) => a + b, 0), shot: [1, 2, 3].filter(j => r.gun[j][0]).length, homer: r.homer === 0, special: !!me.special };
}
if (process.env.TC_CHILD) { process.on('message', jobs => { process.send(jobs.map(j => Object.assign({ tier: j.tier, level: j.level }, simRound(j.tier, j.level, j.seed, j.rseed)))); process.exit(0); }); return; }
async function runSim() {
  const jobs = [];
  for (const tier of TIER_LIST) for (const level of LEVELS) for (let i = 0; i < SIM; i++) jobs.push({ tier, level, seed: 500000 + i * 104729, rseed: 77 + i });
  const par = +opt('par', 3), chunks = Array.from({ length: par }, () => []);
  jobs.forEach((j, i) => chunks[i % par].push(j));
  const res = (await Promise.all(chunks.map(ch => new Promise(done => { const c = fork(__filename, [], { env: Object.assign({}, process.env, { TC_CHILD: '1' }) }); let got = false; c.on('message', m => { got = true; done(m); }); c.on('exit', code => { if (!got) { console.error('sim child exited without a result, code', code); process.exit(2); } }); c.send(ch); })))).flat();
  const table = {};
  for (const tier of TIER_LIST) for (const level of LEVELS) {
    const rs = res.filter(r => r.tier === tier && r.level === level), n = rs.length, m = rs.reduce((a, r) => a + r.pts, 0) / n;
    const sd = Math.sqrt(rs.reduce((a, r) => a + (r.pts - m) ** 2, 0) / n);
    table[tier + '@' + level] = { tier, level: LV[level], rounds: n, ptsPerRound: +m.toFixed(2), ci95: +(1.96 * sd / Math.sqrt(n)).toFixed(2), winRate: +(rs.filter(r => r.pts > 0).length / n * 100).toFixed(1), fouls: rs.filter(r => r.foul).length, gunsPerRound: +(rs.reduce((a, r) => a + r.guns, 0) / n).toFixed(2), shotPerRound: +(rs.reduce((a, r) => a + r.shot, 0) / n).toFixed(2), homers: rs.filter(r => r.homer).length, specials: rs.filter(r => r.special).length };
    console.log(`${tier.padEnd(10)} vs ${LV[level]}: ${table[tier + '@' + level].ptsPerRound.toFixed(2).padStart(6)} ±${table[tier + '@' + level].ci95} pts/round, win ${table[tier + '@' + level].winRate}%, fouls ${table[tier + '@' + level].fouls}, 打槍 ${table[tier + '@' + level].gunsPerRound}/局, 被打槍 ${table[tier + '@' + level].shotPerRound}/局`);
  }
  return table;
}

// ---------- browser play ----------
function serve() { return new Promise(res => { const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(html); }); srv.listen(0, '127.0.0.1', () => res(srv)); }); }
async function playRound(P, seed, level) {
  const { page } = P, info = () => page.evaluate(() => window.__tc.info());
  await page.evaluate(([s, l]) => window.__tc.newGame(s, l), [seed, level]);
  await H.sleep(300);
  let i = await info(); const hand = i.hand, t0 = Date.now();
  const d = decide(P.tierId, hand, P.rng, { rs: i.rs, level });
  let wrong = 0, taps0 = i.taps;
  await H.sleep(P.thinkMs(3));
  if (i.overlay === 'spov') { await P.tapSelector(d.declare ? '#spYes' : '#spNo'); await H.sleep(P.reactMs()); }
  else if (d.declare) { await P.tapSelector('#bSp'); await H.sleep(P.reactMs()); }
  if (!d.declare) {
    if (d.viaSug !== undefined) { for (let k = 0; k <= d.viaSug; k++) { await P.tapSelector('#bSug'); await H.sleep(P.reactMs()); } }
    else {
      // execute the target arrangement with tap-swaps, correcting any mis-taps
      const target = d.arr; let steps = 0;
      while (steps++ < 40) {
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
        i = await info(); if (i.sel !== null) { await tapCardId(P, i.sel); await H.sleep(P.reactMs()); continue; }
        const tr = target.map(r => new Set(r));
        let a = null, b = null;
        for (let r = 0; r < 3 && a === null; r++) for (const id of i.my[r]) if (!tr[r].has(id)) { a = id; const want = target.findIndex(row => row.includes(id)); b = i.my[want].find(x => !tr[want].has(x)); break; }
        if (a === null) break;
        if (P.mistake()) { const all = i.my.flat(); b = all[Math.floor(P.rng() * all.length)]; }
        await tapCardId(P, a); await H.sleep(P.reactMs() * 0.6);
        await tapCardId(P, b); await H.sleep(P.reactMs());
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))); // let queued touch events land first
        const j = await info(); if (j.sel !== null || key(j.my) === key(i.my)) { wrong++; if (process.env.TC_DEBUG) console.log('wrong', a, b, 'sel', j.sel, 'rows', JSON.stringify(i.my), '->', JSON.stringify(j.my), 'taps', j.taps, 'miss', j.miss, 'drops', j.drops); }
        if (P.tierId === 'clumsy' && steps > 8) break; // gives up fiddling
      }
    }
  }
  // compare
  for (let tries = 0; tries < 6; tries++) {
    i = await info();
    if (i.phase !== 'arrange') break;
    if (i.overlay === 'confirm') {
      if (d.foulOk) await P.tapSelector('#cfYes'); else { await P.tapSelector('#cfNo'); await H.sleep(P.reactMs()); await P.tapSelector('#bSug'); }
      await H.sleep(P.reactMs()); continue;
    }
    if (i.overlay === 'coach') { await P.tapSelector('#coOk'); continue; }
    await P.tapSelector('#bGo'); await H.sleep(P.reactMs());
  }
  await H.sleep(600); await P.tap(195, 300, { exact: true }); // tap to skip the reveal
  const ok = await waitFor(page, () => window.__tc.info().phase === 'result', 25000);
  i = await info();
  return { seed, level: LV[level], ok, pts: i.res ? i.res.total[0] : null, foul: i.res ? i.res.foul[0] : null, guns: i.res ? i.res.gun[0].reduce((a, b) => a + b, 0) : 0, shot: i.res ? [1, 2, 3].filter(j => i.res.gun[j][0]).length : 0, special: i.declared, wrongTaps: wrong, taps: i.taps - taps0, ms: Date.now() - t0 };
}
// people (and the bots) aim at a card they can see at rest: a card still sliding from the last swap is waited for
async function tapCardId(P, id) {
  for (let k = 0; k < 20 && await P.page.evaluate(id => { const e = document.querySelector('#board .cd[data-id="' + id + '"]'); return !!e && e.classList.contains('fly'); }, id); k++) await H.sleep(16);
  const r = await P.page.evaluate(id => window.__tc.cardRect(id), id); if (!r) return; await P.tap(r.x + r.w / 2, r.y + r.h / 2); }
async function waitFor(page, fn, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await H.sleep(150); } return false; }

(async () => {
  if (SIM) { const table = await runSim(); const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'thirteen-cards', tiers: {}, findings: [] }; const k = TAG ? TAG + 'Sim' : 'sim'; prev[k] = prev[k] || { roundsPerCell: SIM, table: {} }; Object.assign(prev[k].table, table); fs.writeFileSync(OUT, JSON.stringify(prev, null, 1)); return; }
  const srv = await serve(), url = `http://127.0.0.1:${srv.address().port}/?notitle=1`;
  const browser = await H.launch();
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'thirteen-cards', tiers: {}, findings: [] };
  const block = TAG ? (prev[TAG] = prev[TAG] || { tiers: {} }) : prev;
  for (const tier of TIER_LIST) {
    const sess = await H.newSession(browser, url, "try{localStorage.setItem('thirteen-cards:v1:settings',JSON.stringify({coach:1,snd:false}))}catch(e){}");
    const P = new H.Player(sess, tier, 1234);
    const runs = [];
    for (const level of LEVELS) for (const seed of SEEDS(ROUNDS)) {
      const r = await playRound(P, seed, level); runs.push(r);
      console.log(tier, LV[level], seed, r.ok ? 'pts ' + r.pts : 'NOT FINISHED', r.foul ? 'foul' : '', 'wrongTaps', r.wrongTaps, r.ms + 'ms');
    }
    const summary = {};
    for (const level of LEVELS) { const rs = runs.filter(r => r.level === LV[level] && r.ok); summary[LV[level]] = { rounds: rs.length, ptsPerRound: +(rs.reduce((a, r) => a + r.pts, 0) / rs.length).toFixed(2), wins: rs.filter(r => r.pts > 0).length, fouls: rs.filter(r => r.foul).length, guns: rs.reduce((a, r) => a + r.guns, 0), shot: rs.reduce((a, r) => a + r.shot, 0) }; }
    summary.unfinished = runs.filter(r => !r.ok).length; summary.wrongTaps = runs.reduce((a, r) => a + r.wrongTaps, 0); summary.taps = P.stats.taps; summary.errors = sess.errors;
    block.tiers[tier] = { runs, summary };
    console.log(tier, JSON.stringify(summary));
    await sess.ctx.close();
    fs.writeFileSync(OUT, JSON.stringify(prev, null, 1));
  }
  await browser.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
