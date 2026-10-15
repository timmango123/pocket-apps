// Verification for 大老二 (big-two).
// (1) Node match series using the game's own core (CORE markers): strongest AI (高手) vs weakest (新手) —
//     one 高手 seat against three 新手 seats, rotating seats, seeded deals. Also 一般 vs 新手, 高手 vs 一般,
//     plus a 1000-round four-AI soak test (all rule options on) checking no illegal move / stall.
// (2) A bot plays one complete match against the page's AI in Chromium with real CDP touch input at human pace
//     (>=150 ms between actions), recorded as demo/game.mp4 (+ game-4x.mp4) and demo/game-result.png.
// Usage: node verify.js [--rounds N] [--par P] [--skip-match] [--skip-browser] [--level L]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const B2 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return B2;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

function playRound(job) { // job: {seed, levels:[4], rules}
  const rules = B2.mkRules(job.rules || {}), g = new B2.Game({ seed: job.seed, rules }); let k = 0; const times = [[], [], []];
  while (g.winner < 0 && k < 600) {
    const p = g.turn, lv = job.levels[p];
    const r = B2.think({ view: B2.aiView(g, p), level: lv, seed: job.seed * 1000 + k, ms: 110 });
    times[lv].push(r.ms);
    const err = r.cards ? g.play(r.cards) : g.pass();
    if (err) return { seed: job.seed, illegal: err };
    k++;
  }
  if (g.winner < 0) return { seed: job.seed, stall: true };
  return { seed: job.seed, winner: g.winner, deltas: B2.roundDeltas(g.hands, g.winner, rules), plies: k, times };
}
if (process.env.B2_CHILD) { process.on('message', jobs => { process.send(jobs.map(playRound)); process.exit(0); }); return; }
async function runJobs(jobs, par) {
  const chunks = []; const size = Math.ceil(jobs.length / par);
  for (let i = 0; i < jobs.length; i += size) chunks.push(jobs.slice(i, i + size));
  const res = await Promise.all(chunks.map(ch => new Promise(done => { const c = fork(__filename, [], { env: Object.assign({}, process.env, { B2_CHILD: '1' }) }); c.on('message', r => done(r)); c.send(ch); })));
  return res.flat();
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [(c - h) * 100, (c + h) * 100]; }
async function series(strong, weak, n, par) {
  const jobs = []; for (let i = 0; i < n; i++) { const seat = i % 4, levels = [weak, weak, weak, weak]; levels[seat] = strong; jobs.push({ seed: 5000 + i * 7919, levels, seat }); }
  const res = await runJobs(jobs, par);
  let wins = 0, pts = 0, bad = 0, sq = 0; const ts = [];
  res.forEach((r, i) => { if (r.illegal || r.stall) { bad++; return; } const s = jobs[i].seat; if (r.winner === s) wins++; pts += r.deltas[s]; sq += r.deltas[s] * r.deltas[s]; ts.push(...r.times[strong]); });
  const N = res.length - bad, ci = wilson(wins, N), mean = pts / N, sd = Math.sqrt(sq / N - mean * mean), se = sd / Math.sqrt(N);
  const L = ['新手', '一般', '高手'];
  console.log(`SERIES ${L[strong]} (1 seat) vs ${L[weak]} x3: ${N} rounds, ${L[strong]} won ${wins} = ${(wins / N * 100).toFixed(1)}% (95% CI ${ci[0].toFixed(1)}–${ci[1].toFixed(1)}%, fair share 25%), avg ${mean >= 0 ? '+' : ''}${mean.toFixed(2)} pts/round (±${(1.96 * se).toFixed(2)}), errors ${bad}`);
  ts.sort((a, b) => a - b);
  console.log(`  ${L[strong]} think time: avg ${(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1)} ms, p95 ${ts[Math.floor(ts.length * 0.95)]} ms, max ${ts[ts.length - 1]} ms over ${ts.length} decisions`);
}
async function soak(n, par) {
  const jobs = []; for (let i = 0; i < n; i++) jobs.push({ seed: 900000 + i, levels: [i % 2, (i >> 1) % 2, 1, 0], rules: i % 2 ? { flush: true, triple: true, bomb: true, passLock: true } : {} });
  const res = await runJobs(jobs, par); const bad = res.filter(r => r.illegal || r.stall);
  console.log(`SOAK ${res.length} four-AI rounds (新手/一般 mixed, half with every rule option on): illegal moves ${res.filter(r => r.illegal).length}, stalls ${res.filter(r => r.stall).length}, avg plies ${(res.reduce((a, r) => a + (r.plies || 0), 0) / res.length).toFixed(1)}`);
  return bad.length;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function browserGame(level, rounds) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP + '?seed=2024');
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // settings like a player: difficulty + match length, then start
  await tapSel(cdp, page, '#tSet'); await sleep(400);
  await tapSel(cdp, page, `#segLv button[data-v="${level}"]`); await sleep(250);
  await tapSel(cdp, page, `#segRounds button[data-v="${rounds}"]`); await sleep(250);
  await tapSel(cdp, page, '#sNew'); await sleep(500);
  const t0 = Date.now(); let taps = 0, plays = 0, passes = 0; const aiThinks = []; let lastT = null;
  for (let step = 0; step < 5000; step++) {
    const inf = await page.evaluate(() => window.__b2.info());
    if (inf.overlay === 'help') { await sleep(1200); await tapSel(cdp, page, '#hOk'); taps++; await sleep(300); continue; }
    if (inf.overlay === 'roundEnd') { await sleep(1800); await tapSel(cdp, page, '#reNext'); taps++; await sleep(600); continue; }
    if (inf.overlay === 'matchEnd') break;
    const lt = await page.evaluate(() => window.__b2.lastThink());
    if (lt && JSON.stringify(lt) !== JSON.stringify(lastT)) { aiThinks.push(lt); lastT = lt; }
    if (inf.phase !== 'play' || inf.turn !== 0 || inf.busy || inf.paused) { await sleep(120); continue; }
    await sleep(300); // human reaction
    const r = B2.think({ view: inf.view, level: 1, seed: step, ms: 60 });
    if (!r.cards) { await tapSel(cdp, page, '#bPass'); taps++; passes++; await sleep(250); continue; }
    for (const c of r.cards) { const p = await page.evaluate(c => window.__b2.cardCenter(c), c); await touch(cdp, p.x, p.y); taps++; await sleep(180); }
    const s = await page.evaluate(() => window.__b2.info().sel);
    if (s.slice().sort((a, b) => a - b).join() !== r.cards.join()) { console.log('  selection mismatch, retrying', s, r.cards); for (const c of s) { const p = await page.evaluate(c => window.__b2.cardCenter(c), c); await touch(cdp, p.x, p.y); await sleep(160); } continue; }
    await tapSel(cdp, page, '#bPlay'); taps++; plays++; await sleep(250);
  }
  await sleep(2500);
  const fin = await page.evaluate(() => window.__b2.info());
  const title = await page.textContent('#meTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = Math.round((Date.now() - t0) / 1000), worker = await page.evaluate(() => window.__b2.worker());
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '30', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '30', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024), at = aiThinks.map(x => x.rt), ac = aiThinks.map(x => x.ms);
  console.log(`BROWSER MATCH vs page AI (${['新手', '一般', '高手'][level]}, ${rounds} rounds): result screen "${title}", totals ${JSON.stringify(fin.totals)}, bot made ${plays} plays + ${passes} passes with ${taps} touch taps, ${secs}s real time`);
  console.log(`  page AI (Web Worker: ${worker}) think: core avg ${(ac.reduce((a, b) => a + b, 0) / ac.length).toFixed(1)} ms / max ${Math.max(...ac)} ms; round trip avg ${(at.reduce((a, b) => a + b, 0) / at.length).toFixed(1)} ms / max ${Math.max(...at)} ms over ${ac.length} AI moves`);
  console.log(`  video game.mp4 ${kb(mp4)} KB, game-4x.mp4 ${kb(fast)} KB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}
(async () => {
  const par = +(argv('--par') || 4), n = +(argv('--rounds') || 800);
  if (!args.includes('--skip-match')) {
    await series(2, 0, n, par);
    await series(1, 0, n, par);
    await series(2, 1, n, par);
    await soak(1000, par);
  }
  if (!args.includes('--skip-browser')) await browserGame(+(argv('--level') || 2), +(argv('--brounds') || 4));
})();
