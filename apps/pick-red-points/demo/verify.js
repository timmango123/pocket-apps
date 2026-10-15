// Verification for 撿紅點 (pick-red-points).
// (1) Node, using the game's own core (CORE markers):
//     - match series 高手 (1 seat) vs 新手 x3, four-round matches, seats and dealers rotating, seeded deals;
//       plus paired per-round gains 一般 vs 新手 and 高手 vs 一般 (same deals with/without the stronger seat) to show the ordering;
//     - two-player variant: 高手 vs 新手 head to head;
//     - 5000-round four-AI soak checking every round's red total is 208 (and 238 with the ♠A option), no illegal move.
// (2) Chromium: a bot plays one full four-round match against the page's 高手 AI with real CDP touch input at human pace
//     (>=150 ms between actions), recorded as demo/game.mp4 (+ game-4x.mp4) and demo/game-result.png.
// Usage: node verify.js [--matches N] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const PR = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PR;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const L = ['新手', '一般', '高手'];

function playRound(seed, levels, n, dealer, rules, times) {
  const s = PR.newRound({ seed, n, dealer, rules }); let k = 0;
  while (s.phase !== 'done') {
    const p = s.turn, lv = levels[p];
    let r = PR.think({ view: PR.aiView(s, p), level: lv, seed: seed * 131 + k++, budget: 1e9 }); if (times && lv === 2) times.push(r.ms);
    if (typeof PR.play(s, r.card, r.tgt) === 'string') throw new Error('illegal play');
    r = PR.think({ view: PR.aiView(s, p), level: lv, seed: seed * 131 + k++ });
    if (typeof PR.flip(s, r.tgt) === 'string') throw new Error('illegal flip');
  }
  if (s.table.length) throw new Error('table not empty');
  return PR.scores(s);
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [(c - h) * 100, (c + h) * 100]; }
function oneMatch(m, strong, weak, n, times) {
  const seat = m % n, levels = Array(n).fill(weak); levels[seat] = strong; const tot = Array(n).fill(0), mine = [];
  for (let r = 0; r < 4; r++) { const sc = playRound(PR.hash(70001 + m, r), levels, n, r % n, {}, times); sc.forEach((v, i) => tot[i] += v); mine.push(sc[seat]); }
  const best = Math.max(...tot), nb = tot.filter(v => v === best).length;
  return { win: tot[seat] === best ? 1 / nb : 0, tie: tot[seat] === best && nb > 1, mine };
}
function onePair(i, strong, weak) {
  const seat = i % 4, dealer = (i >> 2) % 4, seed = PR.hash(90001 + i, 7), base = [weak, weak, weak, weak], lv = base.slice(); lv[seat] = strong;
  return playRound(seed, lv, 4, dealer, {})[seat] - playRound(seed, base, 4, dealer, {})[seat];
}
if (process.env.PRV_CHILD) {
  process.on('message', job => {
    const out = [], times = [];
    for (let i = job.from; i < job.to; i++) out.push(job.kind === 'match' ? oneMatch(i, job.strong, job.weak, job.n, times) : onePair(i, job.strong, job.weak));
    process.send({ out, times: times.filter((t, k) => k % 7 === 0 || t > 5) }); process.exit(0);
  });
  return;
}
async function par(kind, N, extra) {
  const P = Math.max(1, Math.min(8, require('os').cpus().length)), size = Math.ceil(N / P), jobs = [];
  for (let f = 0; f < N; f += size) jobs.push(Object.assign({ kind, from: f, to: Math.min(N, f + size) }, extra));
  const res = await Promise.all(jobs.map(j => new Promise(done => { const c = fork(__filename, [], { env: Object.assign({}, process.env, { PRV_CHILD: '1' }) }); c.on('message', done); c.send(j); })));
  return { out: res.flatMap(r => r.out), times: res.flatMap(r => r.times) };
}
async function matchSeries(strong, weak, N, n) {
  const { out, times } = await par('match', N, { strong, weak, n });
  let wins = 0, ties = 0, sum = 0, sq = 0, rounds = 0;
  for (const o of out) { wins += o.win; ties += o.tie; for (const x of o.mine) { sum += x; sq += x * x; rounds++; } }
  const ci = wilson(wins, N), mean = sum / rounds, sd = Math.sqrt(sq / rounds - mean * mean);
  console.log(`MATCH SERIES ${n}p: ${L[strong]} (1 seat) vs ${L[weak]}${n === 4 ? ' x3' : ''}: ${N} four-round matches, ${L[strong]} won ${wins.toFixed(1)} = ${(wins / N * 100).toFixed(1)}% (95% CI ${ci[0].toFixed(1)}–${ci[1].toFixed(1)}%, fair share ${100 / n}%; ties split ${ties}); avg ${mean.toFixed(2)} red pts/round ±${(1.96 * sd / Math.sqrt(rounds)).toFixed(2)} (fair ${208 / n})`);
  return times;
}
async function paired(strong, weak, N) {
  const { out } = await par('pair', N, { strong, weak });
  let d = 0, sq = 0; for (const x of out) { d += x; sq += x * x; }
  const m = d / N, sd = Math.sqrt(sq / N - m * m);
  console.log(`PAIRED ${L[strong]} replacing one ${L[weak]} (same ${N} deals): ${m >= 0 ? '+' : ''}${m.toFixed(2)} red pts/round (95% CI ±${(1.96 * sd / Math.sqrt(N)).toFixed(2)})`);
}
function thinkTimes() { // single process, the page's own settings (240 playouts, 30 ms cap)
  for (const n of [4, 2]) {
    const ts = [], ns = [];
    for (let i = 0; i < 60; i++) { const s = PR.newRound({ seed: 3000 + i, n, dealer: 0 }); let k = 0;
      while (s.phase !== 'done') { const p = s.turn, r = PR.think({ view: PR.aiView(s, p), level: 2, seed: k++ }); if (r.n) { ts.push(r.ms); ns.push(r.n); } PR.play(s, r.card, r.tgt); PR.flip(s, PR.think({ view: PR.aiView(s, p), level: 2, seed: k++ }).tgt); } }
    ts.sort((a, b) => a - b);
    console.log(`  高手 think time ${n}p: avg ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)} ms, p95 ${ts[Math.floor(ts.length * 0.95)]} ms, max ${ts[ts.length - 1]} ms over ${ts.length} searched decisions; playouts avg ${Math.round(ns.reduce((a, b) => a + b, 0) / ns.length)} of 240 per move (30 ms cap)`);
  }
}
function soak(N) {
  let ok = 0, bad = 0, a = 0, b = 0; const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    const rules = { spadeA30: i % 5 === 4 }, lv = [i % 2, (i + 1) % 2, 1, i % 10 === 0 ? 2 : 0];
    try { const tot = playRound(500000 + i, lv, 4, i % 4, rules).reduce((x, y) => x + y, 0); if (tot === (rules.spadeA30 ? 238 : 208)) { ok++; rules.spadeA30 ? b++ : a++; } else bad++; } catch (e) { bad++; }
  }
  console.log(`SOAK ${N} four-AI rounds (新手/一般 mixed, 高手 in every 10th, every 5th with ♠A=30): ${a} totals = 208, ${b} totals = 238, problems ${bad}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'light', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP + '?seed=2026');
  const cdp = await ctx.newCDPSession(page);
  await sleep(1000);
  await tapSel(cdp, page, '#tSet'); await sleep(500);
  await tapSel(cdp, page, '#segLv button[data-v="2"]'); await sleep(300);
  await tapSel(cdp, page, '#segN button[data-v="4"]'); await sleep(300);
  await tapSel(cdp, page, '#segR button[data-v="4"]'); await sleep(300);
  await tapSel(cdp, page, '#sNew'); await sleep(600);
  const t0 = Date.now(); let taps = 0, caps = 0, places = 0, flipChoices = 0; const thinks = []; let lastT = null, step = 0;
  for (; step < 4000; step++) {
    const inf = await page.evaluate(() => window.__pr.info());
    const lt = await page.evaluate(() => window.__pr.lastThink());
    if (lt && JSON.stringify(lt) !== JSON.stringify(lastT)) { thinks.push(lt); lastT = lt; }
    if (inf.overlay === 'roundEnd') { await sleep(3600); await tapSel(cdp, page, '#reNext'); taps++; await sleep(700); continue; }
    if (inf.overlay === 'matchEnd') break;
    if (inf.mode === 'play') {
      await sleep(350); // human reaction
      const r = PR.think({ view: inf.view, level: 2, seed: step });
      const p = await page.evaluate(c => window.__pr.cardCenter(c), r.card); await touch(cdp, p.x, p.y); taps++; await sleep(300);
      if (r.tgt >= 0) { const q = await page.evaluate(c => window.__pr.cardCenter(c), r.tgt); await touch(cdp, q.x, q.y); caps++; }
      else { await tapSel(cdp, page, '#bPlace'); places++; }
      taps++; await sleep(250); continue;
    }
    if (inf.mode === 'flip') {
      await sleep(300); const r = PR.think({ view: inf.view, level: 2, seed: step });
      const q = await page.evaluate(c => window.__pr.cardCenter(c), r.tgt); await touch(cdp, q.x, q.y); taps++; flipChoices++; await sleep(250); continue;
    }
    await sleep(150);
  }
  await sleep(2500);
  const fin = await page.evaluate(() => window.__pr.info()), title = await page.textContent('#meTitle'), worker = await page.evaluate(() => window.__pr.worker());
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '33', '-r', '30', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '33', '-r', '30', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024), ac = thinks.map(x => x.ms), rt = thinks.map(x => x.rt);
  console.log(`BROWSER MATCH vs page AI (高手, 4 rounds): result screen "${title}", totals ${JSON.stringify(fin.totals)} (sum ${fin.totals.reduce((a, b) => a + b, 0)} = 4 x 208), bot: ${caps} captures + ${places} placements + ${flipChoices} flip choices, ${taps} touch taps, ${secs}s real time`);
  console.log(`  page AI (Web Worker: ${worker}) think: core avg ${(ac.reduce((a, b) => a + b, 0) / ac.length).toFixed(1)} ms / max ${Math.max(...ac)} ms; round trip avg ${(rt.reduce((a, b) => a + b, 0) / rt.length).toFixed(1)} ms / max ${Math.max(...rt)} ms over ${ac.length} AI decisions`);
  console.log(`  video game.mp4 ${kb(mp4)} KB, game-4x.mp4 ${kb(fast)} KB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}
(async () => {
  if (!args.includes('--skip-match')) {
    const N = +(argv('--matches') || 4000);
    const t = await matchSeries(2, 0, N, 4);
    void t; thinkTimes();
    await matchSeries(2, 0, Math.round(N / 4), 2);
    const P = +(argv('--pairs') || 6000); await paired(1, 0, P); await paired(2, 0, P); await paired(2, 1, P);
    soak(5000);
  }
  if (!args.includes('--skip-browser')) await browserGame();
})();
