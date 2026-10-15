// Verification for 九宮井字 (ultimate-tictactoe).
// (1) Node match series between AI levels using the game's own core (CORE-START/CORE-END in index.html), run on worker
//     threads: 校長 (L5, full 3 s) vs 粉筆頭 (L1) and vs 班長 (L3), a neighbour ladder, and the spec's 200-game 校長 vs 班長
//     check (校長 capped at 0.5 s/move so 200 games finish in reasonable time). Colours alternate. Reports think times.
// (2) A bot plays one complete game against the page's own Web Worker AI in Chromium using real CDP touch input at human
//     pace, recorded as demo/game.mp4 (+ game-2x.mp4) and demo/game-result.png; fails on any console error.
// Usage: node verify.js [--no-series] [--no-browser] [--quick]
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const UT = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return UT;')();
function playMatch(A, B, aFirst) { // A/B: {level, ms?}
  const moves = [], side = p => ((p === 1) === aFirst ? A : B), times = [];
  UT.resetTree();
  let s = UT.newState(0), lastPl = null;
  while (s[UT.RS] < 0) {
    const pl = side(s[UT.TN]); if (lastPl !== pl && pl.level === 5) { /* tree reuse is keyed by move list, safe across sides */ }
    const r = UT.think({ moves, vf: 0, level: pl.level, ms: pl.ms });
    times.push([pl.tag, r.ms]); UT.play(s, r.move); moves.push(r.move);
  }
  const w = s[UT.RS];
  return { res: !w ? 'd' : side(w) === A ? 'a' : 'b', plies: moves.length, times };
}
if (!isMainThread) {
  const { A, B, games } = workerData, out = [];
  for (const g of games) out.push(playMatch(A, B, g % 2 === 0));
  parentPort.postMessage(out);
  return;
}
const args = process.argv.slice(2), has = a => args.includes(a), QUICK = has('--quick');
const NT = Math.max(1, Math.min(4, os.cpus().length));
const times = {};
async function series(A, B, n, label) {
  const t0 = Date.now(), chunks = Array.from({ length: NT }, () => []);
  for (let i = 0; i < n; i++) chunks[i % NT].push(i);
  const parts = await Promise.all(chunks.filter(c => c.length).map(games => new Promise((res, rej) => {
    const w = new Worker(__filename, { workerData: { A, B, games } }); w.on('message', res); w.on('error', rej);
  })));
  const r = { a: 0, b: 0, d: 0 }; let plies = 0;
  for (const p of parts) for (const g of p) { r[g.res]++; plies += g.plies; for (const [tag, ms] of g.times) (times[tag] = times[tag] || []).push(ms); }
  const nm = x => `${UT.LEVELS[x.level - 1].name}(L${x.level}${x.ms ? ' ' + x.ms + 'ms' : ''})`;
  console.log(`  ${label || ''}${nm(A)} vs ${nm(B)}: ${r.a} 勝 ${r.b} 負 ${r.d} 和  — score ${((r.a + r.d / 2) / n * 100).toFixed(1)}%  (${n} games, avg ${(plies / n).toFixed(1)} plies, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return r;
}
const L = (level, ms) => ({ level, ms, tag: 'L' + level + (ms ? '@' + ms : '') });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1;
  const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  await sleep(1200);
  // first visit shows the interactive tutorial: do step 1 for real, then skip
  const [tx, ty] = await page.evaluate(() => { const c = document.getElementById('tutCv').getBoundingClientRect(); return [c.left, c.top]; });
  const tc = await page.evaluate(() => { const r = document.getElementById('tutCv').getBoundingClientRect(), w = r.width, pad = w * 0.02, B = (w - 2 * pad) / 3, ip = B * 0.045, c = (B - 2 * ip) / 3; return [pad + B + ip + 2.5 * c, pad + B + ip + 0.5 * c]; });
  await tapXY(tx + tc[0], ty + tc[1]); await sleep(1600);
  await tap('#tutSkip'); await sleep(500);
  // menu: 對電腦, 班長, 我先, then 開始新局
  await tap('#bMenu'); await sleep(500);
  await tap('#cMode .chip[data-v="ai"]'); await sleep(200);
  await tap('#cLevel .chip[data-v="3"]'); await sleep(250);
  await tap('#cFirst .chip[data-v="me"]'); await sleep(250);
  await page.locator('#mStart').scrollIntoViewIfNeeded();
  await tap('#mStart'); await sleep(700);
  const t0 = Date.now(); let taps = 0; const botMs = [];
  for (let turn = 0; turn < 60; turn++) {
    let st;
    for (let k = 0; k < 400; k++) { st = await page.evaluate(() => window.__game.state()); if (st.over || st.inputOK) break; await sleep(50); }
    if (st.over) break;
    const tb = Date.now(); UT.resetTree();
    const r = UT.think({ moves: st.moves, vf: st.vf, level: 5, ms: 700 });   // bot uses the strongest engine at 0.7 s
    botMs.push(Date.now() - tb);
    await sleep(250 + Math.floor(Math.random() * 250));                       // human pause (>=150 ms between actions)
    const [x, y] = await page.evaluate(m => window.__game.cellToClient(m), r.move);
    await tapXY(x, y); taps++;
    await sleep(300);
  }
  for (let k = 0; k < 120 && !(await page.isVisible('#result')); k++) await sleep(60);
  await sleep(1500);
  const st = await page.evaluate(() => window.__game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), mp4x = path.join(OUT, 'game-2x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  const ai = st.aiTimes;
  console.log(`BROWSER GAME: bot (校長 engine 0.7 s, X) vs page AI 班長 (L3) -> ${st.over ? (st.rs === st.human ? 'bot won' : st.rs ? 'page AI won' : 'draw') : 'NOT FINISHED'}; result screen "${title}" visible=${st.resultVisible}`);
  console.log(`  ${st.moves.length} plies, ${taps} touch taps, ${secs}s; page AI think ms (worker): ${ai.join(',')} (max ${Math.max(...ai)})`);
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB (2x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB); console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  return st.over && st.resultVisible && !errors.length;
}
(async () => {
  let okAll = true;
  if (!has('--no-series')) {
    console.log(`AI match series (Node, game core, ${NT} threads):`);
    const top = await series(L(5), L(1), QUICK ? 4 : 8, 'strongest vs weakest: ');
    okAll = okAll && top.a > (top.b + top.d) * 3;
    console.log('  ladder:');
    await series(L(2), L(1), QUICK ? 8 : 40); await series(L(3), L(2), QUICK ? 8 : 40); await series(L(4), L(3), QUICK ? 8 : 40);
    await series(L(5), L(4), QUICK ? 4 : 12);
    await series(L(5), L(3), QUICK ? 4 : 16, 'full strength: ');
    if (!QUICK) { const r = await series(L(5, 500), L(3), 200, 'spec 200-game check: '); okAll = okAll && (r.a + r.d / 2) / 200 > 0.85; }
    console.log('Think time per move (ms) — mean / max / budget:');
    for (const tag of Object.keys(times).sort()) { const a = times[tag], m = a.reduce((x, y) => x + y, 0) / a.length, lv = +tag[1]; console.log(`  ${tag} ${UT.LEVELS[lv - 1].name}: ${m.toFixed(0)} / ${Math.max(...a)} / ${tag.includes('@') ? tag.split('@')[1] : UT.LEVELS[lv - 1].ms}  (${a.length} moves)`); }
  }
  if (!has('--no-browser')) okAll = (await browserGame()) && okAll;
  console.log(okAll ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exitCode = okAll ? 0 : 1;
})();
