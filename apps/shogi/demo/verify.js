// Verification for 日本將棋.
// (1) Think-time table: every computer level on a set of middle-game positions (game's own engine from the CORE block).
// (2) Node match series: strongest level (五段, 4 s/move) vs weakest (十級), colours alternating, run in worker threads.
// (3) Browser game: a bot (初段-strength engine settings) plays one complete game against the page's own computer (Web Worker) in
//     Chromium with real CDP touch input at human pace (>=150 ms between actions: tap piece / piece-stand, tap target, tap 成/不成),
//     until the result screen. Records demo/game.mp4 (+ sped-up copy) and demo/game-result.png and checks for console errors.
// Usage: node verify.js [--games N] [--skip-match] [--skip-browser] [--skip-times] [--page-level L]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SRC = fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const loadSG = () => new Function(SRC + ';return SG;')();

function playGame(SG, ls, lg, seed) {
  SG.setSeed(seed); SG.clearTT();
  const g = new SG.Game(), times = { 0: [], 1: [] };
  while (!g.result && g.moves.length < 400) {
    const side = g.pos.side, lv = side === 0 ? ls : lg, t0 = Date.now();
    const d = SG.declareInfo(g.pos, side); if (d.ok) { g.declare(); break; }
    const r = SG.think(g.pos, lv);
    times[side].push(Date.now() - t0);
    g.play(r.move);
  }
  const res = g.result || { winner: -1, reason: 'cap' };
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0, max = a => a.length ? Math.max(...a) : 0;
  return { ls, lg, winner: res.winner, reason: res.reason, moves: g.moves.length, t: [[avg(times[0]), max(times[0])], [avg(times[1]), max(times[1])]] };
}
if (!isMainThread) { const SG = loadSG(); parentPort.postMessage(playGame(SG, workerData.ls, workerData.lg, workerData.seed)); return; }

const sleep = ms => new Promise(r => setTimeout(r, ms));
function thinkTimes() {
  const SG = loadSG();
  const lines = ['7g7f 3c3d 2g2f 4c4d 2f2e 2b3c 3i4h 3a4b 5i6h 5a6b 6h7h 6b7b 5g5f 4a5b 9g9f 9c9d 1g1f 1c1d 4h5g 4b5c 3g3f 6a6b',
    '7g7f 8c8d 6g6f 3c3d 6i7h 4a3b 5g5f 5c5d 3i4h 7a6b 4i5h 5a4b 2g2f 6c6d 2f2e 6b6c 3g3f 8d8e 2h2f 5d5e',
    '7g7f 3c3d 8h2b+ 3a2b 7i8h 2b3c 8h7g 7a6b 2g2f 8c8d 2f2e 8d8e 3i3h 4a3b 5i6h 5a4b 6i7h 6c6d'];
  console.log('THINK TIMES (Node, same code as the page worker; ms avg / max over ' + lines.length * 2 + ' positions)');
  for (let lv = 0; lv < 5; lv++) {
    const ts = [], ds = [];
    lines.forEach(l => { const mv = l.split(' '); [mv.length, mv.length - 3].forEach(k => { const g = SG.Game.replay(SG.START, mv.slice(0, k)); SG.clearTT(); SG.setSeed(k); const r = SG.think(g.pos, lv, { nobook: 1 }); ts.push(r.ms); ds.push(r.depth); }); });
    console.log(`  ${SG.LEVELS[lv].name} (limit ${SG.LEVELS[lv].time} ms, depth ${SG.LEVELS[lv].depth > 60 ? 'ID' : SG.LEVELS[lv].depth}): avg ${Math.round(ts.reduce((a, b) => a + b) / ts.length)} ms, max ${Math.max(...ts)} ms, depth reached ${Math.min(...ds)}-${Math.max(...ds)}`);
  }
}
async function matchSeries(n) {
  const SG = loadSG(), jobs = [];
  for (let i = 0; i < n; i++) jobs.push(i % 2 ? { ls: 0, lg: 4, seed: 100 + i } : { ls: 4, lg: 0, seed: 100 + i });
  const results = [], par = 3; let next = 0;
  await Promise.all(Array.from({ length: par }, async () => {
    while (next < jobs.length) {
      const j = jobs[next++];
      const r = await new Promise((res, rej) => { const w = new Worker(__filename, { workerData: j }); w.on('message', res); w.on('error', rej); });
      results.push(r);
      const strongSide = r.ls === 4 ? 0 : 1;
      console.log(`  game: ▲${SG.LEVELS[r.ls].name} vs △${SG.LEVELS[r.lg].name} -> ${r.winner < 0 ? '和' : (r.winner === 0 ? '▲' : '△') + '勝'} (${r.reason}) ${r.moves} 手 | 五段 think avg/max ${r.t[strongSide].join('/')} ms, 十級 ${r.t[1 - strongSide].join('/')} ms`);
    }
  }));
  const strongWins = results.filter(r => r.winner === (r.ls === 4 ? 0 : 1)).length, draws = results.filter(r => r.winner < 0).length;
  console.log(`MATCH 五段 vs 十級: ${strongWins} - ${results.length - strongWins - draws}${draws ? ' - ' + draws + ' draws' : ''} over ${results.length} games`);
  return strongWins >= results.length * 0.8;
}

async function browserGame(pageLevel) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const SG = loadSG();
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  await page.evaluate(() => { try { localStorage.setItem('shogi.tutDone', '1'); localStorage.removeItem('shogi.game'); } catch (e) {} });
  await page.reload();
  const cdp = await ctx.newCDPSession(page);
  let tid = 1, actions = 0, lastAct = 0;
  const pace = async () => { const w = 160 - (Date.now() - lastAct); if (w > 0) await sleep(w); };
  const tapXY = async (x, y) => { await pace(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; actions++; lastAct = Date.now(); };
  const tap = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  await sleep(900);
  for (const sel of ['#sgMode [data-v="ai"]', `#sgLevel [data-v="${pageLevel}"]`, '#sgColor [data-v="sente"]', '#sgHc [data-v="0"]', '#sgLabel [data-v="trad"]']) { await tap(sel); await sleep(250); }
  if ((await page.getAttribute('#swPromo', 'aria-checked')) === 'true') { await tap('#swPromo'); await sleep(200); }
  await sleep(300); await tap('#bStart'); await sleep(1500);
  const t0 = Date.now(); let st, botMoves = 0, landed = 0, promoTaps = 0, drops = 0;
  const BOT = Object.assign({}, SG.LEVELS[2], { name: 'bot', time: 1200, depth: 5, mistake: 0 });
  while (Date.now() - t0 < 25 * 60 * 1000) {
    st = await page.evaluate(() => window.__shogi.state());
    if (st.phase === 'over') break;
    if (st.phase !== 'play' || st.side !== st.human) { await sleep(120); continue; }
    const g = SG.Game.replay(st.sfen, st.moves);
    SG.setSeed(st.moves.length + 1);
    const r = SG.think(g.pos, BOT);
    await sleep(250 + Math.floor(Math.random() * 300));                    // human "thinking" pause
    const m = r.move, usi = SG.toUSI(m);
    if (SG.mDrop(m)) { const [x, y] = await page.evaluate(([s, l]) => window.__shogi.handClient(s, l), [st.side, usi[0]]); await tapXY(x, y); drops++; }
    else { const [x, y] = await page.evaluate(u => window.__shogi.sqClient(u), usi.slice(0, 2)); await tapXY(x, y); }
    await sleep(120);
    const [tx, ty] = await page.evaluate(u => window.__shogi.sqClient(u), usi.slice(SG.mDrop(m) ? 2 : 2, SG.mDrop(m) ? 4 : 4));
    await tapXY(tx, ty); await sleep(200);
    if ((await page.evaluate(() => window.__shogi.state().promo))) { await sleep(150); await tap(SG.mProm(m) ? '#pYes' : '#pNo'); promoTaps++; await sleep(200); }
    botMoves++;
    const after = await page.evaluate(() => window.__shogi.state().moves);
    if (after[st.moves.length] === usi) landed++; else console.log('  tap mismatch: wanted', usi, 'got', after[st.moves.length]);
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#result')); k++) await sleep(100);
  await sleep(1800);
  st = await page.evaluate(() => window.__shogi.state());
  const title = await page.textContent('#rTitle'), sub = await page.textContent('#rSub');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), fast = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=PTS/4', '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', fast]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const kb = f => Math.round(fs.statSync(f).size / 1024), th = st.thinkAll;
  console.log(`BROWSER game vs page computer ${SG.LEVELS[pageLevel].name}: ${title} (${sub}) | ${st.moves.length} moves, bot ${botMoves} moves / ${actions} taps (${drops} drops, ${promoTaps} 成/不成 choices), ${secs.toFixed(0)} s`);
  console.log(`  bot moves landed exactly as intended: ${landed}/${botMoves}`);
  console.log(`  page AI reply times incl. 420 ms min display delay (Web Worker): avg ${Math.round(th.reduce((a, b) => a + b, 0) / Math.max(1, th.length))} ms, max ${Math.max(0, ...th)} ms over ${th.length} moves`);
  console.log(`  result screen visible: ${st.resultVisible} | game.mp4 ${kb(mp4)} KB, game-4x.mp4 ${kb(fast)} KB | ${errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors'}`);
  return st.resultVisible && st.phase === 'over' && !errors.length && landed === botMoves;
}

(async () => {
  const a = process.argv.slice(2), opt = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  let okAll = true;
  if (!a.includes('--skip-times')) thinkTimes();
  if (!a.includes('--skip-match')) okAll = (await matchSeries(+(opt('--games') || 6))) && okAll;
  if (!a.includes('--skip-browser')) okAll = (await browserGame(+(opt('--page-level') || 1))) && okAll;
  console.log(okAll ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exitCode = okAll ? 0 : 1;
})();
