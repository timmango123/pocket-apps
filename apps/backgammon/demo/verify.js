// Verification for 雙陸棋 (backgammon).
// (1) Node match series between AI levels using the game's own core (CORE-START/CORE-END in ../index.html) at the real
//     per-level time budgets, 4 worker threads. Cubeless single games (gammons/backgammons count in the points per game).
//     Reports wins, win rate with a 95% Wilson confidence interval, points per game and think times.
// (2) A bot plays one complete game against the page's own Web Worker AI (大師, Lv5) in Chromium with real CDP touch input
//     (taps, one drag, one 復原, one hint) at human pace, recorded as demo/game.mp4 (+ sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--no-series] [--no-browser] [--quick] [--skip-top]  (--skip-top resumes after the long L5-vs-L1 series)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const BG = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BG;')();

function playGame(lvA, lvB, seed) { // A = side 0; opening roll decides who starts
  const R = BG.rng(seed); let d;
  do { d = [1 + Math.floor(R() * 6), 1 + Math.floor(R() * 6)]; } while (d[0] === d[1]);
  let side = d[0] > d[1] ? 0 : 1, q = side === 0 ? BG.initial() : BG.flip(BG.initial()), first = true;
  const times = {}; let plies = 0;
  for (;;) {
    if (!first) d = [1 + Math.floor(R() * 6), 1 + Math.floor(R() * 6)]; first = false;
    const lv = side === 0 ? lvA : lvB;
    const r = BG.think({ pos: Array.from(q), dice: d, level: lv, seed: Math.floor(R() * 4294967296) });
    if (!r.forced) (times[lv] = times[lv] || []).push(r.ms);
    q = Int8Array.from(r.pos); plies++;
    if (BG.onBoard(q) === 0) { const k = BG.resultKind(q); return { pts: side === 0 ? k : -k, plies, times }; }
    q = BG.flip(q); side ^= 1;
  }
}
if (!isMainThread) {
  BG.buildDB();
  for (const j of workerData.jobs) parentPort.postMessage(playGame(j.a, j.b, j.seed));
  process.exit(0);
}
const args = process.argv.slice(2), has = a => args.includes(a);
const allTimes = {};
function wilson(k, n) { const z = 1.96, p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den; return [c - h, c + h]; }
function series(a, b, n, seed0) {
  return new Promise(resolve => {
    const res = { w: 0, l: 0, pts: 0, g: 0, bg: 0, plies: 0 }, t0 = Date.now(); let done = 0;
    for (let k = 0; k < 4; k++) {
      const jobs = []; for (let i = k; i < n; i += 4) jobs.push({ a, b, seed: seed0 + i });
      const wk = new Worker(__filename, { workerData: { jobs } });
      wk.on('message', m => { if (m.pts > 0) res.w++; else res.l++; res.pts += m.pts; if (Math.abs(m.pts) === 2) res.g++; if (Math.abs(m.pts) === 3) res.bg++; res.plies += m.plies; for (const lv in m.times) (allTimes[lv] = allTimes[lv] || []).push(...m.times[lv]); });
      wk.on('exit', () => {
        if (++done < 4) return;
        const [lo, hi] = wilson(res.w, n);
        res.rate = res.w / n; res.lo = lo; res.hi = hi;
        console.log(`  ${BG.LEVELS[a - 1].name}(L${a}) vs ${BG.LEVELS[b - 1].name}(L${b}): ${res.w}-${res.l} in ${n} games = ${(100 * res.rate).toFixed(1)}% `
          + `(95% CI ${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%), ${res.pts >= 0 ? '+' : ''}${(res.pts / n).toFixed(2)} pts/game, gammons ${res.g}, backgammons ${res.bg}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        resolve(res);
      });
    }
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1, actions = 0, lastAct = 0;
  const pace = async () => { const gap = Date.now() - lastAct; if (gap < 160) await sleep(160 - gap); };
  const touch = async (x, y, hold = 80) => { await pace(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; actions++; lastAct = Date.now(); };
  const dragTouch = async (x0, y0, x1, y1) => { await pace(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: tid }] }); await sleep(120); for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 12, y: y0 + (y1 - y0) * i / 12, id: tid }] }); await sleep(28); } await sleep(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; actions++; lastAct = Date.now(); };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2); };
  const st = () => page.evaluate(() => window.__game.state());
  const xy = (side, r) => page.evaluate(([s, i]) => window.__game.placeXY(s, i), [side, r]);
  await sleep(900);
  await tap('#cMode .chip[data-v="ai"]'); await sleep(200);
  await tap('#cLevel .chip[data-v="5"]'); await sleep(200);
  await tap('#cMatch .chip[data-v="0"]'); await sleep(200);
  await tap('#cVar .chip[data-v="std"]'); await sleep(200);
  await tap('#mStart'); await sleep(600);
  const t0 = Date.now(); let botTurns = 0, didHint = false, didDrag = false, didUndo = false, offers = 0, takes = 0, finalsKey = null, planTurn = -1;
  const pageThink = [];
  for (let loop = 0; loop < 4000; loop++) {
    const s = await st();
    if (s.resultVisible) break;
    if (s.offer) { // page AI doubled us: the bot always takes so the game is played to the end
      offers++; await sleep(1200); takes++; await tap('#cbTake'); await sleep(400); continue;
    }
    if (s.busy || s.thinking) { await sleep(80); continue; }
    if (s.phase === 'opening') { await sleep(500); await tap('#tMain'); await sleep(900); continue; }
    if (s.phase === 'pre' && s.turn === 0) { await sleep(350); await tap('#tMain'); await sleep(700); continue; }
    if (s.phase === 'move' && s.human && s.turn === 0) {
      if (s.maxLen === 0) { await sleep(150); continue; }
      if (planTurn !== botTurns) { planTurn = botTurns; finalsKey = new Set(BG.genRoll(Int8Array.from(s.r0), s.dice[0], s.dice[1]).map(m => BG.key(m.pos))); }
      if (s.steps >= s.maxLen) { await sleep(300); await tap('#tMain'); botTurns++; await sleep(500); continue; }
      if (!didHint && botTurns >= 1) { await sleep(300); await tap('#tHint'); await sleep(1800); await tap('#ovHint [data-close]'); didHint = true; await sleep(300); continue; }
      // best continuation from the current partial position among the legal full plays (0-ply evaluation)
      const cur = Int8Array.from(s.cur), conts = BG.gen(cur, s.rem).filter(m => finalsKey.has(BG.key(m.pos)));
      let best = null, bv = -9; for (const m of conts) { const v = BG.afterValue(m.pos, BG.evaluate, 1); if (v > bv) { bv = v; best = m; } }
      if (!best || !best.steps.length) { await sleep(200); continue; }
      const [f, t] = best.steps[0];
      await sleep(220 + Math.random() * 200);
      const a = await xy(0, f);
      if (!didDrag && botTurns >= 2 && t !== 0) { // one move by dragging the checker
        await touch(a[0], a[1]); await sleep(250); const b = await xy(0, t); await dragTouch(a[0], a[1], b[0], b[1] + 30); didDrag = true; await sleep(450); continue;
      }
      await touch(a[0], a[1]); await sleep(260);
      const ds = await page.evaluate(() => window.__game.dests());
      if (!ds.includes(t)) { console.log('  ! planned destination', t, 'not offered', ds); }
      const b = await xy(0, t); await touch(b[0], b[1]); await sleep(420);
      if (!didUndo && botTurns >= 3 && s.steps === 0) { await tap('#tUndo'); didUndo = true; await sleep(400); }
      continue;
    }
    await sleep(100);
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#ovResult')); k++) await sleep(100);
  await sleep(1600);
  const s = await st();
  const title = await page.textContent('#rTitle'), kind = await page.textContent('#rKind'), pts = await page.textContent('#rPts');
  const think = await page.evaluate(() => window.__game.thinkLog());
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), mp4x = path.join(OUT, 'game-4x.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.25*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  const tms = think.filter(x => !x.forced).map(x => x.ms);
  console.log(`BROWSER GAME: bot (0-ply core eval, real touch) vs page AI 大師(L5) -> ${s.result ? (s.result.winner === 0 ? 'bot won' : 'page AI won') : 'NOT FINISHED'}; result screen "${title}" / "${kind}" / "${pts}" visible=${s.resultVisible}`);
  console.log(`  ${botTurns} bot turns, ${actions} touch actions (>=160 ms apart), ${secs} s; cube offers to bot ${offers} (took ${takes}); hint/drag/undo used: ${didHint}/${didDrag}/${didUndo}`);
  console.log(`  page AI think ms (worker, non-forced, ${tms.length} moves): mean ${(tms.reduce((a, b) => a + b, 0) / Math.max(1, tms.length)).toFixed(0)}, max ${Math.max(0, ...tms)}; search depths ${JSON.stringify(think.reduce((o, x) => { o[x.depth] = (o[x.depth] || 0) + 1; return o; }, {}))}`);
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB (4x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB)`);
  console.log('  console errors:', errors.length ? errors.join(' | ') : 'none');
  return !!(s.result && s.resultVisible && !errors.length);
}
(async () => {
  let ok = true;
  if (!has('--no-series')) {
    const q = has('--quick');
    console.log('AI match series (Node, game core, real time budgets, 4 threads):');
    if (!has('--skip-top')) { const top = await series(5, 1, q ? 40 : 300, 1000); ok = ok && top.lo > 0.8; }
    const s53 = await series(5, 3, q ? 40 : 200, 20000);
    ok = ok && s53.lo > 0.5;
    await series(2, 1, q ? 40 : 400, 40000);
    await series(3, 2, q ? 40 : 400, 60000);
    await series(4, 3, q ? 40 : 400, 80000);
    await series(5, 4, q ? 20 : 100, 100000);
    console.log('Think time per move (ms) — mean / p95 / max / budget (forced moves excluded):');
    for (const lv of Object.keys(allTimes).sort()) {
      const a = allTimes[lv].slice().sort((x, y) => x - y), m = a.reduce((x, y) => x + y, 0) / a.length;
      console.log(`  L${lv} ${BG.LEVELS[lv - 1].name}: ${m.toFixed(0)} / ${a[Math.floor(a.length * 0.95)]} / ${a[a.length - 1]} / ${BG.LEVELS[lv - 1].ms}  (${a.length} moves)`);
    }
  }
  if (!has('--no-browser')) ok = (await browserGame()) && ok;
  console.log(ok ? 'ALL OK' : 'SOME CHECKS FAILED');
  process.exitCode = ok ? 0 : 1;
})();
