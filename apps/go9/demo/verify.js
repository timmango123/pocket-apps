// Verification for 九路圍棋.
// (1) Node match series: strongest computer level (5 級) vs weakest (25 級) using the game's own engine (CORE block of index.html),
//     colours alternating, real level settings (5 級 = 5 s per move with tree reuse), scored with the same end-of-game logic as the page.
// (2) Browser game: a bot (8 級 engine settings) plays one complete game against the page's own computer (Web Worker) in Chromium, with real CDP touch
//     input at human pace (>=150 ms between actions: tap to preview, tap again to place), through the 終局判定 screen to the
//     result screen. Records demo/game.mp4 (+ sped-up copy) and demo/game-result.png and checks for console errors.
// Usage: node verify.js [--games N] [--skip-match] [--skip-browser] [--page-level L]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SRC = fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const loadGO = () => new Function(SRC + ';return GO;')();

/* ---------- one engine-vs-engine game (runs in a worker thread) ---------- */
function playGame(GO, lb, lw, seed) {
  GO.setSeed(seed); GO.resetTree();
  const g = new GO.Game({ size: 9 }), low = { 1: 0, 2: 0 }, times = { 1: [], 2: [] };
  let res = null;
  while (!g.over() && g.moves.length < 250) {
    const col = g.b.toPlay, lv = col === 1 ? lb : lw, t0 = Date.now();
    const r = GO.think(g, lv);
    times[col].push(Date.now() - t0);
    if (r.sims && r.wr < 0.05 && g.moves.length > 20) low[col]++; else low[col] = 0;
    if (low[col] >= 3) { res = { winner: 3 - col, how: 'R' }; break; }
    g.play(r.move);
  }
  if (!res) {
    const own = GO.ownership(g, 2000), sc = GO.finalScore(g, GO.deadFromOwn(g, own, 0.7));
    res = { winner: sc.winner, how: Math.abs(sc.diff) };
  }
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0, max = a => a.length ? Math.max(...a) : 0;
  return { lb, lw, winner: res.winner, how: res.how, moves: g.moves.length, tB: [avg(times[1]), max(times[1])], tW: [avg(times[2]), max(times[2])] };
}
if (!isMainThread) { const GO = loadGO(); parentPort.postMessage(playGame(GO, workerData.lb, workerData.lw, workerData.seed)); return; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function matchSeries(n) {
  const GO = loadGO(), jobs = [];
  for (let i = 0; i < n; i++) jobs.push(i % 2 ? { lb: 0, lw: 4, seed: 1000 + i } : { lb: 4, lw: 0, seed: 1000 + i });
  const results = [], par = 3; let next = 0;
  await Promise.all(Array.from({ length: par }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await new Promise((res, rej) => { const w = new Worker(__filename, { workerData: j }); w.on('message', res); w.on('error', rej); });
      results.push(r);
      const strong = r.lb === 4 ? 1 : 2;
      console.log(`  game: 黑 ${GO.LEVELS[r.lb].name} vs 白 ${GO.LEVELS[r.lw].name} -> ${r.winner === 1 ? '黑' : '白'}勝 ${r.how === 'R' ? '(中盤認輸)' : r.how}  ${r.moves} 手 | 5級 think avg/max ${(strong === 1 ? r.tB : r.tW).join('/')} ms, 25級 ${(strong === 1 ? r.tW : r.tB).join('/')} ms`);
    }
  }));
  const strongWins = results.filter(r => r.winner === (r.lb === 4 ? 1 : 2)).length;
  console.log(`MATCH 5 級 vs 25 級: ${strongWins} - ${results.length - strongWins} over ${results.length} games`);
  return strongWins > results.length * 0.8;
}

/* ---------- browser game with real touch input ---------- */
async function browserGame(pageLevel) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const GO = loadGO();
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1;
  const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  await sleep(900);
  // new game from the menu: vs computer, chosen level, play black, no handicap, Chinese rules, 9x9
  for (const sel of ['#sgMode [data-v="ai"]', `#sgLevel [data-v="${pageLevel}"]`, '#sgColor [data-v="black"]', '#sgHcap [data-v="0"]', '#sgRules [data-v="cn"]', '#sgSize [data-v="9"]']) {
    await page.locator(sel).scrollIntoViewIfNeeded(); await tap(sel); await sleep(200);
  }
  if ((await page.getAttribute('#swConfirm', 'aria-checked')) !== 'true') { await page.locator('#swConfirm').scrollIntoViewIfNeeded(); await tap('#swConfirm'); await sleep(200); }
  await page.locator('#bStart').scrollIntoViewIfNeeded(); await sleep(250); await tap('#bStart'); await sleep(1300);
  const t0 = Date.now(); let landed = 0; let st, botMoves = 0, aiTimes = [], lastLen = -1;
  while (Date.now() - t0 < 20 * 60 * 1000) {
    st = await page.evaluate(() => window.__go9.state());
    if (st.phase === 'over' || st.phase === 'scoring') break;
    if (st.phase !== 'play' || st.toPlay === st.ai) {
      if (st.think && st.moves.length !== lastLen) { aiTimes.push(st.think.ms); lastLen = st.moves.length; }
      await sleep(120); continue;
    }
    if (st.think && st.moves.length !== lastLen) { aiTimes.push(st.think.ms); lastLen = st.moves.length; }
    // bot decides with the game's own engine (8 級 settings, 2.5 s per move); like a person, it accepts the end of the game
    // (passes) once the computer has passed late in the game, so the game goes through 終局判定 and the count
    const g = GO.Game.replay(st.opts, st.moves);
    const r = st.moves.length > 40 && st.moves[st.moves.length - 1] === 0 ? { move: 0 } : GO.think(g, 3, { time: 2500 });
    await sleep(300 + Math.floor(Math.random() * 300));                        // human "thinking" pause
    if (!r.move) { await tap('#bPass'); await sleep(500); botMoves++; continue; }
    const xy = g.b.xy(r.move);
    const [cx, cy] = await page.evaluate(([x, y]) => window.__go9.ptClient(x, y), xy);
    await tapXY(cx, cy); await sleep(220 + Math.floor(Math.random() * 120));    // preview stone
    await tapXY(cx, cy); await sleep(250);                                      // confirm -> place
    botMoves++;
    const after = await page.evaluate(() => window.__go9.state().moves);
    if (after[st.moves.length] === r.move) landed++; else console.log('  tap mismatch: wanted', GO.coord(g.b, r.move), 'got', after[st.moves.length]);
  }
  // 終局判定: wait for automatic dead-stone marking, then confirm the count
  for (let k = 0; k < 100; k++) { st = await page.evaluate(() => window.__go9.state()); if (st.phase !== 'scoring') break; const t = await page.textContent('#scLive'); if (!/判定/.test(t)) break; await sleep(100); }
  if (st.phase === 'scoring') { await sleep(1800); await tap('#bConfirm'); }
  for (let k = 0; k < 100 && !(await page.isVisible('#result')); k++) await sleep(100);
  await sleep(1800);
  st = await page.evaluate(() => window.__go9.state());
  const title = await page.textContent('#rTitle'), sub = await page.textContent('#rSub');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=PTS/4', '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024);
  console.log(`BROWSER game vs page computer ${GO.LEVELS[pageLevel].name}: ${title} (${sub}) | ${st.moves.length} moves, bot ${botMoves} actions, ${secs.toFixed(0)} s`);
  console.log(`  bot stones placed exactly where intended: ${landed}`);
  console.log(`  page AI think times (Web Worker): avg ${Math.round(aiTimes.reduce((a, b) => a + b, 0) / Math.max(1, aiTimes.length))} ms, max ${Math.max(0, ...aiTimes)} ms over ${aiTimes.length} moves`);
  console.log(`  result screen visible: ${st.resultVisible} | video game.mp4 ${kb(mp4)} KB, game-4x.mp4 ${kb(fast)} KB | ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors'}`);
  return st.resultVisible && st.phase === 'over' && !errors.length;
}

(async () => {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  let okAll = true;
  if (!a.includes('--skip-match')) okAll = (await matchSeries(+(opt('--games') || 8))) && okAll;
  if (!a.includes('--skip-browser')) okAll = (await browserGame(+(opt('--page-level') || 3))) && okAll;
  process.exitCode = okAll ? 0 : 1;
})();
