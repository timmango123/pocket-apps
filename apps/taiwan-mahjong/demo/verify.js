// Verification for 台灣麻將 (taiwan-mahjong), using the game's own core (CORE markers in ../index.html).
// (0) 2000 hands of four-AI self play (mixed levels, all rule options rotating): every action legal, 144 tiles conserved,
//     hand sizes correct, scores zero-sum; prints the 台 distribution.
// (1) Match series 高手 vs 新手 (and 高手 vs 一般, 一般 vs 新手): 東風圈 matches, two seats per side (alternating seats),
//     a side wins a match when its combined score is positive. Win rate with a 95% Wilson interval + per-hand point edge.
// (2) A bot plays one full 東風圈 against the page's 高手 AI in Chromium with real CDP touch input at human pace
//     (>=150 ms between actions), recorded to demo/game.mp4 (+ game-4x.mp4) and demo/game-result.png.
// Usage: node verify.js [--hands 2000] [--matches 300] [--matches2 900 (高手 vs 一般)] [--par 3] [--skip-self] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const MJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MJ;')();
const args = process.argv.slice(2), argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const PERS = [{ imp: 0.5 }, { imp: 0.85 }, { imp: 0.5 }, { imp: 0.2 }];

function playHand(H, lv, times) {
  let guard = 0;
  while (H.phase !== 'end') {
    if (++guard > 3000) throw new Error('hand did not end');
    const p = [0, 1, 2, 3].find(q => MJ.legal(H, q).length);
    if (p === undefined) throw new Error('nobody to act in ' + H.phase);
    const r = MJ.think(MJ.view(H, p), lv[p], PERS[p], (H.seed ^ (guard * 2654435761)) >>> 0);
    if (times) times[lv[p]].push(r.ms);
    MJ.act(H, p, r.a);   // throws on an illegal action
    if (MJ.census(H) !== 144 - (H.rules.flowers ? 0 : 8)) throw new Error('tile census broken');
    if (!MJ.handSizeOK(H)) throw new Error('hand size broken');
  }
  if (H.result.delta.reduce((a, b) => a + b, 0) !== 0) throw new Error('not zero-sum');
  return H.result;
}
function selfJob(from, to) {
  const tai = {}, out = { hands: 0, wins: 0, self: 0, draws: 0, tai, errors: [], special: {} };
  for (let i = from; i < to; i++) {
    const rules = { flowers: i % 5 !== 4, multiRon: i % 3 === 1, drawPassDealer: i % 7 === 3, minTai: i % 4 === 2 ? 1 : 0 };
    const H = MJ.newHand({ seed: 7000 + i * 31, dealer: i % 4, rw: (i >> 2) % 4, lian: i % 6 === 0 ? 2 : 0, rules });
    if (!rules.flowers && MJ.census(H) !== 136) out.errors.push('census nf');
    try {
      const R = playHand(H, [i % 3, (i + 1) % 3, (i + 2) % 3, 2], null); out.hands++;
      if (R.type === 'draw') out.draws++;
      R.wins.forEach(w => { out.wins++; if (w.self) out.self++; tai[w.tai] = (tai[w.tai] || 0) + 1; w.items.forEach(x => { const n = x[0].replace(/（.*）/, ''); out.special[n] = (out.special[n] || 0) + 1; }); });
    } catch (e) { out.errors.push('hand ' + i + ': ' + e.message); }
  }
  return out;
}
function matchJob(seed, A, B, aSeats) {
  // A occupies aSeats (two seats), B the other two
  const lv = [0, 1, 2, 3].map(p => aSeats.indexOf(p) >= 0 ? A : B);
  const M = MJ.newMatch({ seed, len: 'east', dealer: seed % 4 });
  const times = { 0: [], 1: [], 2: [] }; let hu = { A: 0, B: 0 }, dealin = { A: 0, B: 0 };
  while (!M.done) {
    const H = MJ.matchHand(M), R = playHand(H, lv, times);
    R.wins.forEach(w => { hu[aSeats.indexOf(w.w) >= 0 ? 'A' : 'B']++; if (!w.self && w.from >= 0) dealin[aSeats.indexOf(w.from) >= 0 ? 'A' : 'B']++; });
    MJ.matchAdvance(M, H);
  }
  const aScore = aSeats.reduce((s, p) => s + M.scores[p], 0);
  const mx = a => a.length ? Math.max(...a) : 0, sm = a => a.reduce((x, y) => x + y, 0);
  return { aScore, hands: M.handNo, hu, dealin, t: { 0: [sm(times[0]), times[0].length, mx(times[0])], 1: [sm(times[1]), times[1].length, mx(times[1])], 2: [sm(times[2]), times[2].length, mx(times[2])] } };
}
if (process.env.TWMJ_CHILD) {
  process.on('message', j => process.send(j.kind === 'self' ? selfJob(j.from, j.to) : matchJob(j.seed, j.A, j.B, j.aSeats)));
  return;
}
function pool(jobs, par, onEach) {
  return new Promise(done => {
    const res = []; let next = 0, live = 0;
    const kids = [];
    const feed = ch => { if (next >= jobs.length) { ch.kill(); live--; if (!live) done(res); return; } const j = jobs[next++]; ch.once('message', r => { res.push(r); onEach && onEach(r, res.length); feed(ch); }); ch.send(j); };
    for (let i = 0; i < par; i++) { const ch = fork(__filename, [], { env: Object.assign({}, process.env, { TWMJ_CHILD: '1' }) }); live++; kids.push(ch); feed(ch); }
  });
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [c - h, c + h]; }
async function selfplay(n, par) {
  const per = Math.ceil(n / (par * 4)), jobs = [];
  for (let f = 0; f < n; f += per) jobs.push({ kind: 'self', from: f, to: Math.min(n, f + per) });
  const t0 = Date.now(), parts = await pool(jobs, par);
  const tot = { hands: 0, wins: 0, self: 0, draws: 0, tai: {}, errors: [], special: {} };
  parts.forEach(p => { tot.hands += p.hands; tot.wins += p.wins; tot.self += p.self; tot.draws += p.draws; tot.errors.push(...p.errors); for (const k in p.tai) tot.tai[k] = (tot.tai[k] || 0) + p.tai[k]; for (const k in p.special) tot.special[k] = (tot.special[k] || 0) + p.special[k]; });
  console.log(`SELF-PLAY ${tot.hands}/${n} hands in ${((Date.now() - t0) / 1000).toFixed(0)}s: errors ${tot.errors.length}, wins ${tot.wins} (self-drawn ${tot.self}), 流局 ${tot.draws}`);
  tot.errors.slice(0, 5).forEach(e => console.log('  ERR', e));
  const ks = Object.keys(tot.tai).map(Number).sort((a, b) => a - b), avg = ks.reduce((s, k) => s + k * tot.tai[k], 0) / tot.wins;
  console.log('  台 distribution: ' + ks.map(k => k + '台×' + tot.tai[k]).join(' ') + ` | mean ${avg.toFixed(2)}`);
  console.log('  items seen: ' + Object.keys(tot.special).sort((a, b) => tot.special[b] - tot.special[a]).map(k => k + ' ' + tot.special[k]).join(', '));
  return tot;
}
async function series(A, B, n, par) {
  const LV = ['新手', '一般', '高手'], jobs = [];
  for (let i = 0; i < n; i++) jobs.push({ kind: 'match', seed: 90001 + i * 7919, A, B, aSeats: i % 2 ? [1, 3] : [0, 2] });
  const t0 = Date.now(), res = await pool(jobs, par);
  const k = res.filter(r => r.aScore > 0).length, ties = res.filter(r => r.aScore === 0).length, ci = wilson(k, n - ties);
  const hands = res.reduce((s, r) => s + r.hands, 0), pts = res.map(r => r.aScore / r.hands / 2);
  const mean = pts.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(pts.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)), se = sd / Math.sqrt(n);
  const hu = res.reduce((s, r) => ({ A: s.A + r.hu.A, B: s.B + r.hu.B }), { A: 0, B: 0 }), di = res.reduce((s, r) => ({ A: s.A + r.dealin.A, B: s.B + r.dealin.B }), { A: 0, B: 0 });
  console.log(`MATCH ${LV[A]} vs ${LV[B]}: ${n} 東風圈 matches (${hands} hands), ${LV[A]} side wins ${k}, loses ${n - k - ties}, ties ${ties} → win rate ${(k / (n - ties) * 100).toFixed(1)}% (95% CI ${(ci[0] * 100).toFixed(1)}–${(ci[1] * 100).toFixed(1)}%), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  points per seat per hand: ${LV[A]} ${mean >= 0 ? '+' : ''}${mean.toFixed(0)} ± ${(1.96 * se).toFixed(0)} (95%) | 胡 per seat-hand ${LV[A]} ${(hu.A / hands / 2 * 100).toFixed(1)}% vs ${LV[B]} ${(hu.B / hands / 2 * 100).toFixed(1)}% | 放槍 ${(di.A / hands / 2 * 100).toFixed(1)}% vs ${(di.B / hands / 2 * 100).toFixed(1)}%`);
  const T = { 0: [0, 0, 0], 1: [0, 0, 0], 2: [0, 0, 0] };
  res.forEach(r => [0, 1, 2].forEach(l => { T[l][0] += r.t[l][0]; T[l][1] += r.t[l][1]; T[l][2] = Math.max(T[l][2], r.t[l][2]); }));
  [A, B].forEach(l => console.log(`  think ${LV[l]}: avg ${(T[l][0] / T[l][1]).toFixed(2)} ms, max ${T[l][2]} ms over ${T[l][1]} decisions (node, ${par} parallel procs)`));
}

// ---------------- browser ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) return false; await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); return true; }
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('twmj:settings', JSON.stringify({ lv: 2, len: 'east', preset: 'tw', speed: 2, timer: true })); } catch (e) {} });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#bNew'); await sleep(2000);
  if (await page.locator('#diceGo').isVisible()) await tapSel(cdp, page, '#diceGo');
  const t0 = Date.now(); let actions = 0, hands = 0, gaps = [], lastAct = 0;
  const act = async fn => { const now = Date.now(); if (now - lastAct < 160) await sleep(160 - (now - lastAct)); if (lastAct) gaps.push(Date.now() - lastAct); await fn(); lastAct = Date.now(); actions++; };
  while (Date.now() - t0 < 25 * 60 * 1000) {
    if (await page.locator('#summary').isVisible()) break;
    if (await page.locator('#result').isVisible()) {
      hands++; await sleep(2600);
      if (hands === 1) await page.screenshot({ path: path.join(OUT, '_hand1.png') });
      await act(() => tapSel(cdp, page, '#rNext')); await sleep(800); continue;
    }
    const inf = await page.evaluate(() => window.__twmj.info());
    if (!inf.human || inf.busy) { await sleep(120); continue; }
    await sleep(250 + Math.random() * 250); // reaction time
    const plan = await page.evaluate(() => {
      const V = window.__twmj.view(); if (!V || !V.opts.length) return null;
      const a = MJ.decide(V, 1, { imp: 0.5 }, (Date.now() & 0xffff) + 1);
      if (a.a === 'd') { const R = window.__twmj.rects().filter(x => x.t === a.t).pop(); return { a, i: R.i, x: R.x + R.w / 2, y: R.y + R.h / 2 }; }
      return { a };
    });
    if (!plan) continue;
    if (plan.a.a === 'd') {
      await act(() => touch(cdp, plan.x, plan.y));                       // lift the tile
      const R = await page.evaluate(i => window.__twmj.rects()[i], plan.i);
      await act(() => touch(cdp, R.x + R.w / 2, R.y + R.h / 2));          // tap again to discard
    } else if (plan.a.a === 'chi' && await page.locator('#acts button[data-a="chimenu"]').count()) {
      await act(() => tapSel(cdp, page, '#acts button[data-a="chimenu"]'));
      await act(() => tapSel(cdp, page, '#acts button[data-use="' + plan.a.use.join(',') + '"]'));
    } else {
      const sel = '#acts button[data-a="' + plan.a.a + '"]';
      if (await page.locator(sel).count()) await act(() => tapSel(cdp, page, sel));
    }
    await sleep(150);
  }
  await sleep(1800);
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const summ = await page.evaluate(() => ({ title: document.getElementById('sumTitle').textContent, rank: document.getElementById('sumRank').innerText.replace(/\n/g, ' '), info: window.__twmj.info(), think: window.__twmj.think() }));
  const vid = await page.video().path(); await ctx.close(); await browser.close();
  const th = summ.think, avg = th.reduce((a, b) => a + b, 0) / th.length;
  console.log(`BROWSER 東風圈 vs page 高手 AI: ${hands} hands, ${actions} touch actions, min gap between touch actions ${Math.min(...gaps)} ms, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  final: ${summ.title} | ${summ.rank} | summary visible: ${summ.info.done}`);
  console.log(`  page AI think (worker): avg ${avg.toFixed(1)} ms, max ${Math.max(...th)} ms over ${th.length} decisions`);
  console.log(`  console errors: ${errors.length}` + (errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''));
  const mp4 = path.join(OUT, 'game.mp4'), mp44 = path.join(OUT, 'game-4x.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', vid, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '33', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', vid, '-vf', 'setpts=PTS/4', '-r', '30', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp44]);
  console.log(`  video: game.mp4 ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB, game-4x.mp4 ${(fs.statSync(mp44).size / 1e6).toFixed(1)} MB`);
  fs.rmSync(vdir, { recursive: true, force: true });
}
(async () => {
  const par = argv('--par', 3);
  if (args.indexOf('--skip-self') < 0) await selfplay(argv('--hands', 2000), par);
  if (args.indexOf('--skip-match') < 0) {
    const n = argv('--matches', 300);
    await series(2, 0, n, par);
    await series(2, 1, argv('--matches2', 900), par);
    await series(1, 0, n, par);
  }
  if (args.indexOf('--skip-browser') < 0) await browserGame();
})();
