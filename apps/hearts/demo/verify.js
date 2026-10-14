// Verification for 紅心大戰 (hearts).
// (1) Node match series using the game's own core (CORE markers): full games to 100 points,
//     one strong AI against three weak ones with the strong seat rotating; games run in child processes.
//     Reports win rate with a 95% Wilson interval (baseline 25%), points per round and think times.
// (2) A bot plays one complete game against the page's AI in Chromium using real CDP touch input
//     at human pace (>=150 ms between actions), recording demo/game.mp4 (+ sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--games N] [--par P] [--level L] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync, fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const HE = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return HE;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CFG = { ms: 150, minS: 60, maxS: 120 }; // same as the page

function playMatch(seed, strongSeat, sLv, wLv) {
  const M = HE.newMatch(seed, {}), lv = [0, 1, 2, 3].map(p => p === strongSeat ? sLv : wLv);
  const times = [], samples = [], pts = [0, 0, 0, 0]; let moves = 0;
  while (!M.over && M.round < 60) {
    const S = HE.startRound(M);
    if (S.phase === 'pass') HE.applyPass(S, [0, 1, 2, 3].map(p => HE.think(HE.viewFor(S, p), p, lv[p], HE.hash(seed, M.round, 'p', p)).move));
    while (S.phase === 'play') {
      const p = S.turn, r = HE.think(HE.viewFor(S, p), p, lv[p], HE.hash(seed, M.round, S.tno, S.tc), CFG);
      if (!HE.isLegal(S, r.move)) throw new Error('illegal move');
      if (p === strongSeat && lv[p] === 2) { times.push(r.ms); if (r.samples) samples.push(r.samples); }
      HE.play(S, r.move); moves++;
    }
    const res = HE.roundScore(S); res.d.forEach((x, p) => pts[p] += x);
    HE.finishRound(M, res);
  }
  return { seed, win: M.winner === strongSeat, place: [0, 1, 2, 3].sort((a, b) => M.totals[a] - M.totals[b]).indexOf(strongSeat) + 1,
    rounds: M.round, strongPts: pts[strongSeat], weakPts: pts.reduce((a, b) => a + b) - pts[strongSeat], times, samples };
}
if (process.env.HEARTS_CHILD) {
  process.on('message', j => { process.send(playMatch(j.seed, j.seat, j.s, j.w)); });
  return;
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
async function series(n, par, sLv, wLv) {
  const jobs = []; for (let i = 0; i < n; i++) jobs.push({ seed: HE.hash('series', sLv, wLv, i), seat: i % 4, s: sLv, w: wLv });
  const res = []; let next = 0; const t0 = Date.now();
  await new Promise(done => {
    let live = 0;
    const spawn = () => {
      if (next >= jobs.length) { if (!live) done(); return; }
      const job = jobs[next++]; live++;
      const ch = fork(__filename, [], { env: Object.assign({}, process.env, { HEARTS_CHILD: '1' }) });
      ch.on('message', r => { res.push(r); ch.kill(); live--; spawn(); });
      ch.send(job);
    };
    for (let i = 0; i < par; i++) spawn();
  });
  const wins = res.filter(r => r.win).length, [lo, hi] = wilson(wins, n);
  const rounds = res.reduce((a, r) => a + r.rounds, 0), sp = res.reduce((a, r) => a + r.strongPts, 0), wp = res.reduce((a, r) => a + r.weakPts, 0);
  const places = [1, 2, 3, 4].map(k => res.filter(r => r.place === k).length);
  const N = HE.LEVELS;
  console.log(`MATCH ${N[sLv].name} (1 seat, rotating) vs 3× ${N[wLv].name}: ${n} games to 100, ${rounds} rounds, ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`  ${N[sLv].name} won ${wins}/${n} = ${(wins / n * 100).toFixed(1)}%  (95% CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%, fair share 25%)  places 1st..4th: ${places.join('/')}`);
  console.log(`  points per round: ${N[sLv].name} ${(sp / rounds).toFixed(2)}  vs  ${N[wLv].name} ${(wp / rounds / 3).toFixed(2)}`);
  const ts = [].concat(...res.map(r => r.times)).sort((a, b) => a - b), ss = [].concat(...res.map(r => r.samples)).sort((a, b) => a - b);
  if (ts.length) console.log(`  高手 think: avg ${(ts.reduce((a, b) => a + b) / ts.length).toFixed(1)}ms, p95 ${ts[Math.floor(ts.length * .95)]}ms, max ${ts[ts.length - 1]}ms over ${ts.length} decisions; samples/decision min ${ss[0]} median ${ss[ss.length >> 1]}`);
  return { wins, n, lo, hi };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function swipeUp(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 6; i++) { await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 15 }] }); }
  await sleep(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function browserGame(level) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#segLv button[data-v="' + level + '"]'); await sleep(400);
  await tapSel(cdp, page, '#bNew'); await sleep(800);
  const t0 = Date.now(); let plays = 0, swipes = 0, passes = 0, rounds = 0, gaps = [], lastAct = 0;
  const act = async fn => { const now = Date.now(); if (lastAct) gaps.push(now - lastAct); await fn(); lastAct = Date.now(); };
  for (let step = 0; step < 20000; step++) {
    const inf = await page.evaluate(() => window.__hearts.info());
    if (inf.ov.includes('ovEnd')) break;
    if (inf.ov.includes('ovRound')) { await sleep(1800); await act(() => tapSel(cdp, page, '#bNext')); rounds++; await sleep(500); continue; }
    if (inf.passReady) {
      await sleep(600);
      const V = await page.evaluate(() => window.__hearts.view());
      const pick = HE.think(V, 0, 2, step).move;
      for (const c of pick) { const p = await page.evaluate(c => window.__hearts.cardPt(c), c); await sleep(260); await act(() => touch(cdp, p.x, p.y + 20)); }
      await sleep(400); await act(() => tapSel(cdp, page, '#act')); passes++; await sleep(400); continue;
    }
    if (inf.phase === 'play' && inf.wait && inf.turn === 0 && !inf.ov.length) {
      await sleep(300); // reaction time
      const V = await page.evaluate(() => window.__hearts.view());
      const c = HE.think(V, 0, 2, step, CFG).move;
      const p = await page.evaluate(c => window.__hearts.cardPt(c), c);
      if (plays % 3 === 2) { await act(() => swipeUp(cdp, p.x, p.y + 20)); swipes++; }
      else { await act(() => touch(cdp, p.x, p.y + 20)); await sleep(220); await act(() => touch(cdp, p.x, p.y + 20 - 0)); }
      plays++; await sleep(200); continue;
    }
    await sleep(120);
  }
  await sleep(2500);
  const title = await page.textContent('#eTitle').catch(() => '(none)');
  const ranks = await page.$$eval('#eRank .rk', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const thinks = await page.evaluate(() => window.__hearts.thinks()), worker = await page.evaluate(() => window.__hearts.worker());
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '25', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  if (fs.statSync(mp4).size > 8 * 1024 * 1024) fs.rmSync(mp4); // keep only the 4x copy when the full-speed video is too big
  const kb = f => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) : '(removed, >8MB)', ms = thinks.map(t => t.ms).sort((a, b) => a - b), wall = thinks.map(t => t.wall).sort((a, b) => a - b);
  console.log(`BROWSER GAME vs page AI (${HE.LEVELS[level].name}, worker=${worker}): result "${title}" after ${rounds} rounds; ranking ${ranks.join(' | ')}`);
  console.log(`  bot: ${plays} card plays (${swipes} by swipe-up, rest tap-select + tap), ${passes} passes, min gap between touch actions ${Math.min(...gaps)}ms, ${secs}s real time`);
  console.log(`  page AI think in worker: median ${ms[ms.length >> 1]}ms, max ${ms[ms.length - 1]}ms; incl. round trip median ${wall[wall.length >> 1]}ms, max ${wall[wall.length - 1]}ms (${thinks.length} decisions)`);
  console.log(`  video game.mp4 ${kb(mp4)}KB, game-4x.mp4 ${kb(fast)}KB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  if (!args.includes('--skip-match')) {
    const n = +(argv('--games') || 120), par = +(argv('--par') || 3);
    await series(n, par, 2, 0);
    await series(n, par, 2, 1);
    await series(n, par, 1, 0);
  }
  if (!args.includes('--skip-browser')) await browserGame(+(argv('--level') || 2));
})();
