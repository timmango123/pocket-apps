// Verification for 排七 (sevens).
// (1) Node match series using the game's own core (CORE markers): 5-round matches, one AI level in one seat
//     (rotating) against three copies of another level. Reports win rate with a 95% Wilson interval
//     (fair share 25%), penalty per round with a 95% CI, and 高手 think times.
// (2) A bot plays one complete 5-round match against the page's 高手 AI in Chromium using real CDP touch input
//     at human pace (>=150 ms between actions), recording demo/game.mp4 (+ game-4x.mp4) and demo/game-result.png.
// Usage: node verify.js [--games N] [--level L] [--skip-match] [--skip-browser]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const SV = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SV;')();
const args = process.argv.slice(2), argv = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const CFG = { ms: 80, minS: 40, maxS: 100 }; // same as the page

function playMatch(seed, seat, sLv, wLv) {
  const M = SV.newMatch(seed, {}, 5), lv = [0, 1, 2, 3].map(p => p === seat ? sLv : wLv), times = [], samples = [], rp = [];
  while (!M.over) {
    const S = SV.startRound(M);
    while (!S.done) {
      const p = S.turn, r = SV.think(SV.viewFor(S, p), p, lv[p], SV.hash(seed, M.round, S.moves), CFG);
      SV.apply(S, r.move);
      if (lv[p] === 2 && p === seat) { times.push(r.ms); if (r.samples) samples.push(r.samples); }
    }
    rp.push(S.pen[seat] - (S.pen.reduce((a, b) => a + b) - S.pen[seat]) / 3);
    SV.finishRound(M, S);
  }
  const share = M.winners.includes(seat) ? 1 / M.winners.length : 0;
  return { share, pen: M.totals[seat], opp: (M.totals.reduce((a, b) => a + b) - M.totals[seat]) / 3, rp, times, samples };
}
function wilson(k, n) { const z = 1.96, p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
function series(n, sLv, wLv) {
  const t0 = Date.now(), N = SV.LEVELS; let wins = 0, pen = 0, opp = 0; const diffs = [], ts = [], ss = [];
  for (let i = 0; i < n; i++) {
    const r = playMatch(SV.hash('series', sLv, wLv, i), i % 4, sLv, wLv);
    wins += r.share; pen += r.pen; opp += r.opp; diffs.push(...r.rp); ts.push(...r.times); ss.push(...r.samples);
  }
  const [lo, hi] = wilson(wins, n), md = diffs.reduce((a, b) => a + b) / diffs.length, sd = Math.sqrt(diffs.reduce((a, b) => a + (b - md) ** 2, 0) / (diffs.length - 1)), se = sd / Math.sqrt(diffs.length);
  console.log(`MATCH ${N[sLv].name} (1 seat, rotating) vs 3× ${N[wLv].name}: ${n} matches × 5 rounds, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${N[sLv].name} won ${wins.toFixed(1)}/${n} = ${(wins / n * 100).toFixed(1)}%  (95% CI ${(lo * 100).toFixed(1)}–${(hi * 100).toFixed(1)}%, fair share 25%)`);
  console.log(`  penalty per round: ${N[sLv].name} ${(pen / n / 5).toFixed(2)} vs ${N[wLv].name} ${(opp / n / 5).toFixed(2)}; difference ${md.toFixed(2)} ± ${(1.96 * se).toFixed(2)} (95% CI, ${diffs.length} rounds)`);
  if (ts.length) { ts.sort((a, b) => a - b); ss.sort((a, b) => a - b); console.log(`  高手 think: median ${ts[ts.length >> 1]}ms, p95 ${ts[Math.floor(ts.length * .95)]}ms, max ${ts[ts.length - 1]}ms over ${ts.length} decisions; samples/decision median ${ss[ss.length >> 1]}, min ${ss[0]}`); }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y, hold) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(hold || 70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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
  const t0 = Date.now(); let plays = 0, covers = 0, longs = 0, rounds = 0, lastAct = 0; const gaps = [];
  const act = async fn => { const now = Date.now(); if (lastAct) gaps.push(now - lastAct); await fn(); lastAct = Date.now(); };
  for (let step = 0; step < 20000; step++) {
    const inf = await page.evaluate(() => window.__sevens.info());
    if (inf.ov.includes('ovEnd')) break;
    if (inf.ov.includes('ovRound')) { await sleep(2600); await act(() => tapSel(cdp, page, '#bNext')); rounds++; await sleep(500); continue; }
    if (inf.wait && inf.turn === 0 && !inf.ov.length) {
      await sleep(350); // reaction time
      const V = await page.evaluate(() => window.__sevens.view());
      const m = SV.think(V, 0, 2, step, CFG).move, c = m % SV.COV;
      const p = await page.evaluate(c => window.__sevens.cardPt(c), c);
      if (m >= SV.COV) {
        await act(() => touch(cdp, p.x, p.y)); await sleep(450);
        await act(() => tapSel(cdp, page, '#act')); covers++;
      } else if (plays % 6 === 3) { // long-press preview first, then tap
        await act(() => touch(cdp, p.x, p.y, 700)); longs++; await sleep(300);
        await act(() => touch(cdp, p.x, p.y)); plays++;
      } else { await act(() => touch(cdp, p.x, p.y)); plays++; }
      await sleep(250); continue;
    }
    await sleep(120);
  }
  await sleep(2500);
  const title = await page.textContent('#eTitle').catch(() => '(none)');
  const ranks = await page.$$eval('#eRank .rk', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const thinks = await page.evaluate(() => window.__sevens.thinks()), worker = await page.evaluate(() => window.__sevens.worker());
  const secs = Math.round((Date.now() - t0) / 1000);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-r', '25', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-r', '25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  if (fs.statSync(mp4).size > 8 * 1024 * 1024) fs.rmSync(mp4);
  const kb = f => fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) + 'KB' : '(removed, >8MB)';
  const ai = thinks.filter(t => t.p !== 0), ms = ai.map(t => t.ms).sort((a, b) => a - b), wall = ai.map(t => t.wall).sort((a, b) => a - b);
  console.log(`BROWSER GAME vs page AI (${SV.LEVELS[level].name}, worker=${worker}): result "${title}" after ${rounds} rounds; ranking ${ranks.join(' | ')}`);
  console.log(`  bot: ${plays} plays (${longs} after a long-press preview), ${covers} covers (tap card + tap 蓋掉), min gap between touch actions ${Math.min(...gaps)}ms, ${secs}s real time`);
  console.log(`  page AI think in worker: median ${ms[ms.length >> 1]}ms, max ${ms[ms.length - 1]}ms; incl. round trip median ${wall[wall.length >> 1]}ms, max ${wall[wall.length - 1]}ms (${ai.length} decisions)`);
  console.log(`  video game.mp4 ${kb(mp4)}, game-4x.mp4 ${kb(fast)}; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  if (!args.includes('--skip-match')) {
    const n = +(argv('--games') || 1000);
    series(n, 2, 0); series(n, 2, 1); series(n, 1, 0);
  }
  if (!args.includes('--skip-browser')) await browserGame(+(argv('--level') || 2));
})();
