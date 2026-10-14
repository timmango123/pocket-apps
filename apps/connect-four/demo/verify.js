// Verification for 四子連線 (connect-four).
// (1) Node match series between AI levels using the game's own core (CORE-START/CORE-END in index.html):
//     strongest (完美) vs weakest (小朋友), plus neighbouring-level ladder; reports scores and measured think times.
// (2) A bot plays one complete game against the page's own Web Worker AI in Chromium using real CDP touch input
//     (touchStart / touchMove drag / touchEnd) at human pace, recorded as demo/game.mp4 + demo/game-result.png.
// Usage: node verify.js [--no-series] [--no-browser] [--games N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const C4 = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';C4.loadBook(C4_BOOK);return C4;')();
const args = process.argv.slice(2), has = a => args.includes(a);
const NG = +(args[args.indexOf('--games') + 1] || 0) || 10;
const times = {};
function playMatch(lvA, lvB, aFirst, W = 7, H = 6) {
  const g = C4.newGame(W, H, false);
  const lvOf = p => ((p === 1) === aFirst ? lvA : lvB);
  while (!g.over) {
    const lv = lvOf(g.turn), t = Date.now();
    const r = C4.think({ W, H, pop: false, moves: g.moves.slice(), level: lv });
    (times[lv] = times[lv] || []).push(Date.now() - t);
    C4.play(g, r.move);
  }
  if (!g.winner) return 'd';
  return lvOf(g.winner) === lvA ? 'a' : 'b';
}
function series(lvA, lvB, n) {
  const res = { a: 0, b: 0, d: 0 }, t0 = Date.now();
  for (let i = 0; i < n; i++) res[playMatch(lvA, lvB, i % 2 === 0)]++;
  console.log(`  ${C4.LEVELS[lvA - 1].name}(L${lvA}) vs ${C4.LEVELS[lvB - 1].name}(L${lvB}): ${res.a} 勝 ${res.b} 負 ${res.d} 和  (${n} games, colours alternate, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return res;
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
  let tid = 1;
  const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(90); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  const dragDrop = async (fromC, toC) => { // press over the drop zone, slide to the target column, release
    const [x0, y0] = await page.evaluate(c => window.__game.dropZoneToClient(c), fromC);
    const [x1] = await page.evaluate(c => window.__game.dropZoneToClient(c), toC);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 + 10, id: tid }] });
    const steps = Math.max(2, Math.abs(toC - fromC) * 3);
    for (let i = 1; i <= steps; i++) { await sleep(45); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + 10 + i, id: tid }] }); }
    await sleep(160);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++;
  };
  await sleep(900);
  // menu: 對電腦, level 中級, 我先, 標準 7x6, then 開始新局
  await tap('#cMode .chip[data-v="ai"]'); await sleep(250);
  await tap('#cLevel .chip[data-v="3"]'); await sleep(250);
  await tap('#cFirst .chip[data-v="me"]'); await sleep(250);
  await tap('#cVar .chip[data-v="std"]'); await sleep(250);
  await page.locator('#mStart').scrollIntoViewIfNeeded();
  await tap('#mStart'); await sleep(800);
  const t0 = Date.now(); let lastCol = 3, botMoves = 0, aiTimes = [];
  for (let turn = 0; turn < 30; turn++) {
    let st;
    for (let k = 0; k < 400; k++) { st = await page.evaluate(() => window.__game.state()); if (st.over || st.inputOK) break; await sleep(50); }
    if (st.over) break;
    if (st.think) aiTimes.push(st.think.ms);
    const moves = C4.fromNotation(st.moves);
    const r = C4.think({ W: 7, H: 6, pop: false, moves, level: 5 });     // bot plays the perfect engine
    await sleep(300 + Math.floor(Math.random() * 250));                  // human "thinking" pause
    await dragDrop(lastCol, r.move.c); lastCol = r.move.c; botMoves++;
    await sleep(200);
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#result')); k++) await sleep(60);
  await sleep(1200);
  const st = await page.evaluate(() => window.__game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const mp4x = path.join(OUT, 'game-2x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  console.log(`BROWSER GAME: bot (perfect engine, first) vs page AI 中級 -> ${st.over ? (st.winner === st.human ? 'bot won' : st.winner ? 'page AI won' : 'draw') : 'NOT FINISHED'}, result screen "${title}" visible=${st.resultVisible}`);
  console.log(`  moves ${st.moves} (${st.moves.length} plies, bot ${botMoves} drag-drops), ${secs}s, page AI think ms: ${aiTimes.join(',')}, video ${Math.round(fs.statSync(mp4).size / 1024)} KB (2x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB)`);
  console.log('  console errors:', errors.length ? errors.join(' | ') : 'none');
  return st.over && st.resultVisible && !errors.length;
}
(async () => {
  let okAll = true;
  if (!has('--no-series')) {
    console.log('AI match series (Node, game core):');
    const top = series(5, 1, NG);
    okAll = okAll && top.a > top.b * 3;
    series(2, 1, 20); series(3, 2, 20); series(4, 3, 10); series(5, 4, 6);
    console.log('Think time per move (ms) — mean / max / budget:');
    for (const lv of Object.keys(times).sort()) { const a = times[lv], m = a.reduce((x, y) => x + y, 0) / a.length; console.log(`  L${lv} ${C4.LEVELS[lv - 1].name}: ${m.toFixed(0)} / ${Math.max(...a)} / ${C4.LEVELS[lv - 1].ms}  (${a.length} moves)`); }
  }
  if (!has('--no-browser')) okAll = (await browserGame()) && okAll;
  process.exitCode = okAll ? 0 : 1;
})();
