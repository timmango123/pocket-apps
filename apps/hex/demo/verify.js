// Verification for 六角連通 (Hex).
// (1) Node match series with the game's own engine (CORE block of index.html), real level settings, 11x11, swap rule on,
//     colours alternating: strongest 蜂巢意志 (Lv5, 4 s/move + tree reuse) vs weakest 蜜蜂 (Lv1).
// (2) 蜂巢意志 vs a uniformly random player on 7x7 (spec: "等級 5 在 7×7 不敗於隨機測試").
// (3) Browser game: a bot (engine 女王 settings, 1 s/move) plays one complete game as red against the page's own computer
//     (Web Worker) in Chromium, with real CDP touch input at human pace (tap to preview, tap again to place, >=150 ms apart),
//     to the result screen. Records demo/game.mp4 (+ sped-up copy) and demo/game-result.png and checks for console errors.
// Usage: node verify.js [--games N] [--rand N] [--skip-match] [--skip-browser] [--page-level L]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SRC = fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const loadH = () => new Function(SRC + ';return HEX;')();

function playGame(H, a, b, N, seed) {      // a plays red, b blue; level index or 'rand'
  H.setSeed(seed); H.resetTree();
  const g = new H.Game({ size: N, swap: true }), times = { 1: [], 2: [] };
  while (!g.winner) {
    const who = g.turn === 1 ? a : b, t0 = Date.now();
    let m;
    if (who === 'rand') { const l = g.legalMoves(); m = l[(H.rand() * l.length) | 0]; }
    else m = H.think(g, who).move;
    times[g.turn].push(Date.now() - t0);
    g.play(m);
  }
  const avg = x => x.length ? Math.round(x.reduce((p, q) => p + q, 0) / x.length) : 0;
  return { a, b, winner: g.winner, moves: g.moves.length, swapped: g.swapped, t: { 1: [avg(times[1]), Math.max(0, ...times[1])], 2: [avg(times[2]), Math.max(0, ...times[2])] } };
}
if (!isMainThread) { parentPort.postMessage(playGame(loadH(), workerData.a, workerData.b, workerData.N, workerData.seed)); return; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function series(label, jobs, strong) {
  const H = loadH(), res = [], par = 3; let next = 0;
  const nm = x => x === 'rand' ? '隨機' : H.LEVELS[x].name;
  await Promise.all(Array.from({ length: par }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await new Promise((ok, no) => { const w = new Worker(__filename, { workerData: j }); w.on('message', ok); w.on('error', no); });
      res.push(r);
      const sc = r.a === strong ? 1 : 2;
      console.log(`  紅 ${nm(r.a)} vs 藍 ${nm(r.b)} -> ${r.winner === 1 ? '紅' : '藍'}勝 ${r.moves} 手${r.swapped ? '（換手）' : ''} | ${nm(strong)} think avg/max ${r.t[sc].join('/')} ms`);
    }
  }));
  const w = res.filter(r => r.winner === (r.a === strong ? 1 : 2)).length;
  const all = res.map(r => r.t[r.a === strong ? 1 : 2][0]);
  console.log(`${label}: ${nm(strong)} ${w} - ${res.length - w} (avg think ${Math.round(all.reduce((p, q) => p + q, 0) / all.length)} ms/move)`);
  return { w, n: res.length };
}

async function browserGame(pageLevel) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const H = loadH();
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1;
  const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; };
  const tap = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  await sleep(900);
  for (const sel of ['#sgMode [data-v="ai"]', `#sgLevel [data-v="${pageLevel}"]`, '#sgColor [data-v="red"]', '#sgSize [data-v="11"]']) { await tap(sel); await sleep(250); }
  if ((await page.getAttribute('#swSwap', 'aria-checked')) !== 'true') { await tap('#swSwap'); await sleep(250); }
  if ((await page.getAttribute('#swConfirm', 'aria-checked')) !== 'true') { await tap('#swConfirm'); await sleep(250); }
  await tap('#bStart'); await sleep(1500);
  const t0 = Date.now(); let st, landed = 0, botMoves = 0; const aiTimes = []; let lastLen = -1;
  while (Date.now() - t0 < 10 * 60 * 1000) {
    st = await page.evaluate(() => window.__hex.state());
    if (st.phase !== 'play') break;
    if (st.think && st.moves.length !== lastLen && st.turn === st.human) { aiTimes.push(st.think.ms); lastLen = st.moves.length; }
    if (st.turn !== st.human) { await sleep(120); continue; }
    const g = H.Game.replay(st.opts, st.moves);
    const r = H.think(g, 3, { time: 1000, sims: 1e7, noBook: g.moves.length > 0 });
    await sleep(250 + Math.floor(Math.random() * 250));          // human "thinking"
    const [cx, cy] = await page.evaluate(i => window.__hex.cellClient(i), r.move);
    await tapXY(cx, cy); await sleep(260 + Math.floor(Math.random() * 120));   // preview + magnifier
    await tapXY(cx, cy); await sleep(220);                                      // confirm
    botMoves++;
    const after = await page.evaluate(() => window.__hex.state().moves);
    if (after[st.moves.length] === r.move) landed++; else console.log('  tap mismatch: wanted', H.coord(g.N, r.move), 'got', after[st.moves.length]);
  }
  for (let k = 0; k < 120 && !(await page.isVisible('#result')); k++) await sleep(100);
  await sleep(1500);
  st = await page.evaluate(() => window.__hex.state());
  const title = await page.textContent('#rTitle'), sub = (await page.textContent('#rSub')).replace(/\s+/g, ' ');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-2x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=PTS/2', '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024);
  console.log(`BROWSER bot (女王 1 s) as red vs page computer ${H.LEVELS[pageLevel].name}: ${title} (${sub}) | ${st.moves.length} moves, ${secs.toFixed(0)} s`);
  console.log(`  bot moves placed exactly where intended by touch: ${landed}/${botMoves}`);
  console.log(`  page AI think times (Web Worker): avg ${Math.round(aiTimes.reduce((a, b) => a + b, 0) / Math.max(1, aiTimes.length))} ms, max ${Math.max(0, ...aiTimes)} ms over ${aiTimes.length} moves`);
  console.log(`  result screen visible: ${st.resultVisible} | game.mp4 ${kb(mp4)} KB, game-2x.mp4 ${kb(fast)} KB | ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors'}`);
  return st.resultVisible && st.phase === 'over' && !errors.length && landed === botMoves;
}

(async () => {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  let ok = true;
  if (!a.includes('--skip-match')) {
    const n = +(opt('--games') || 6), jobs = [];
    for (let i = 0; i < n; i++) jobs.push(i % 2 ? { a: 0, b: 4, N: 11, seed: 100 + i } : { a: 4, b: 0, N: 11, seed: 100 + i });
    const s1 = await series('MATCH 11x11 蜂巢意志 vs 蜜蜂', jobs, 4); ok = ok && s1.w >= s1.n * 0.8;
    const m = +(opt('--rand') || 10), j2 = [];
    for (let i = 0; i < m; i++) j2.push(i % 2 ? { a: 'rand', b: 4, N: 7, seed: 500 + i } : { a: 4, b: 'rand', N: 7, seed: 500 + i });
    const s2 = await series('MATCH 7x7 蜂巢意志 vs random', j2, 4); ok = ok && s2.w === s2.n;
  }
  if (!a.includes('--skip-browser')) ok = (await browserGame(+(opt('--page-level') || 2))) && ok;
  process.exitCode = ok ? 0 : 1;
})();
