// Verification for 播棋 (mancala).
// (1) Node match series between AI levels using the game's own core (CORE-START/CORE-END in index.html), real time budgets,
//     games run in parallel worker threads: 祖靈(L5) vs 撒豆子(L1), 祖靈 moving first vs 長老(L3), plus a ladder; reports think times.
// (2) A bot plays one complete game against the page's own Web Worker AI in Chromium with real CDP touch input
//     (taps, one long-press preview, a hint) at human pace, recorded as demo/game.mp4 (+ sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--no-series] [--no-browser] [--skip-top] [--skip-acc] [--skip-l2] [--games N]  (skip flags resume an interrupted run)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const MC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MC;')();

function playMatch(lvA, lvB, aFirst, rule = 'kalah') { // A = side 0
  const g = MC.newGame({ rule, seeds: 4 }); g.side = aFirst ? 0 : 1;
  const times = { [lvA]: [], [lvB]: [] };
  while (!g.over) {
    const lv = g.side === 0 ? lvA : lvB, hist = g.hist.length <= 1 ? g.hist.map(h => h.p).join('') : null;
    const r = MC.think({ rule, b: Array.from(g.b), side: g.side, level: lv, seeds: 4, hist });
    if (!r.forced && !r.book) times[lv].push(r.ms);
    MC.play(g, r.pit);
  }
  const s = MC.score(g);
  return { res: s[0] > s[1] ? 'a' : s[1] > s[0] ? 'b' : 'd', score: s, times };
}
if (!isMainThread) {
  const { jobs } = workerData;
  for (const j of jobs) parentPort.postMessage(Object.assign({ i: j.i }, playMatch(j.a, j.b, j.first, j.rule)));
  process.exit(0);
}
const args = process.argv.slice(2), has = a => args.includes(a);
const NG = +(args[args.indexOf('--games') + 1] || 0) || 20;
const allTimes = {};
function series(lvA, lvB, n, firstMode, rule = 'kalah', threads = 4) { // firstMode: 'alt' | 'a'
  return new Promise(resolve => {
    const jobs = []; for (let i = 0; i < n; i++) jobs.push({ i, a: lvA, b: lvB, first: firstMode === 'a' ? true : i % 2 === 0, rule });
    const res = { a: 0, b: 0, d: 0, margins: [] }, t0 = Date.now(); let doneW = 0;
    for (let w = 0; w < threads; w++) {
      const mine = jobs.filter((_, k) => k % threads === w);
      const wk = new Worker(__filename, { workerData: { jobs: mine } });
      wk.on('message', m => { res[m.res]++; res.margins.push(m.score[0] - m.score[1]); for (const lv in m.times) (allTimes[lv] = allTimes[lv] || []).push(...m.times[lv]); });
      wk.on('exit', () => {
        if (++doneW < threads) return;
        const avg = res.margins.reduce((x, y) => x + y, 0) / n;
        console.log(`  ${rule === 'oware' ? 'Oware ' : ''}${MC.LEVELS[lvA - 1].name}(L${lvA}) vs ${MC.LEVELS[lvB - 1].name}(L${lvB}) [${firstMode === 'a' ? `L${lvA} moves first` : 'first move alternates'}]: ${res.a} 勝 ${res.b} 負 ${res.d} 和, avg margin ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}  (${n} games, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
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
  let tid = 1;
  const touch = async (x, y, hold) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await touch(b.x + b.width / 2, b.y + b.height / 2, 90); };
  const st = () => page.evaluate(() => window.__game.state());
  await sleep(900);
  await tap('#cMode .chip[data-v="ai"]'); await sleep(250);
  await tap('#cLevel .chip[data-v="3"]'); await sleep(250);
  await tap('#cFirst .chip[data-v="me"]'); await sleep(250);
  await tap('#cRule .chip[data-v="kalah"]'); await sleep(250);
  await tap('#cSeeds .chip[data-v="4"]'); await sleep(250);
  await tap('#mStart'); await sleep(700);
  const t0 = Date.now(); let botMoves = 0, aiTimes = [], previewChecked = null, hinted = false, lastThink = null;
  for (let turn = 0; turn < 120; turn++) {
    let s;
    for (let k = 0; k < 600; k++) { s = await st(); if (s.over || (s.inputOK && !s.busy)) break; await sleep(50); }
    if (s.over) break;
    if (s.think && s.think !== lastThink && JSON.stringify(s.think) !== JSON.stringify(lastThink)) { lastThink = s.think; if (!s.think.forced && !s.think.book) aiTimes.push(s.think.ms); }
    const r = MC.think({ rule: 'kalah', b: s.b, side: s.side, depth: 9, ms: 400, err: 0, level: 4 });   // bot: depth-9 search
    await sleep(350 + Math.floor(Math.random() * 250));                                               // human "thinking" pause
    const [x, y] = await page.evaluate(([sd, p]) => window.__game.pitToClient(sd, p), [s.side, r.pit]);
    if (botMoves === 1 && !hinted) { await tap('#tHint'); hinted = true; await sleep(1600); }
    if (previewChecked === null) { // long-press: preview appears, releasing cancels without moving
      await touch(x, y, 650);
      const after = await st(); const pv = after.preview;
      const sim = MC.simulate(Object.assign(MC.newGame({ rule: 'kalah', seeds: 4 }), { b: Int8Array.from(s.b), side: s.side }), r.pit);
      previewChecked = { pv, unchanged: JSON.stringify(after.b) === JSON.stringify(s.b) && !after.busy, simLast: sim.last, simExtra: sim.extra };
      await sleep(400);
    }
    await touch(x, y, 90); botMoves++;
    if (previewChecked && previewChecked.moveLast == null) { await sleep(60); previewChecked.moveLast = await page.evaluate(() => window.__lastMove && window.__lastMove.last); }
    await sleep(200);
  }
  for (let k = 0; k < 200 && !(await page.isVisible('#ovResult')); k++) await sleep(60);
  await sleep(1500);
  const s = await st();
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const mp4x = path.join(OUT, 'game-4x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.25*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  const pc = previewChecked || {};
  console.log(`BROWSER GAME: bot (depth-9 search, first) vs page AI 長老(L3) -> ${s.over ? (s.score[0] > s.score[1] ? 'bot won' : s.score[1] > s.score[0] ? 'page AI won' : 'draw') : 'NOT FINISHED'} ${s.score && s.score.join(':')}, result screen "${title}" visible=${s.resultVisible}`);
  console.log(`  ${s.hist.length} sowings (bot ${botMoves} taps), ${secs}s, page AI think ms: ${aiTimes.join(',')}`);
  console.log(`  long-press preview: shown=${!!pc.pv} last=${pc.pv && pc.pv.last} extra=${pc.pv && pc.pv.extra}; release left board unchanged=${pc.unchanged}; real move landed at ${pc.moveLast} (core sim ${pc.simLast}) -> ${pc.pv && pc.pv.last === pc.moveLast && pc.moveLast === pc.simLast ? 'consistent' : 'MISMATCH'}`);
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB (4x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB)`);
  console.log('  console errors:', errors.length ? errors.join(' | ') : 'none');
  return s.over && s.resultVisible && !errors.length && pc.pv && pc.unchanged && pc.pv.last === pc.moveLast;
}
(async () => {
  let okAll = true;
  if (!has('--no-series')) {
    console.log('AI match series (Node, game core, real time budgets, 4 threads):');
    if (!has('--skip-top')) { const top = await series(5, 1, NG, 'alt'); okAll = okAll && top.a > top.b * 3; }
    if (!has('--skip-acc')) { const acc = await series(5, 3, NG, 'a'); okAll = okAll && acc.a / NG > 0.9; }
    if (!has('--skip-l2')) await series(2, 1, 40, 'alt');
    await series(3, 2, 40, 'alt'); await series(4, 3, 20, 'alt'); await series(5, 4, 8, 'alt');
    await series(5, 2, 8, 'alt', 'oware');
    console.log('Think time per move (ms) — mean / max / budget (book and forced moves excluded):');
    for (const lv of Object.keys(allTimes).sort()) { const a = allTimes[lv], m = a.reduce((x, y) => x + y, 0) / a.length; console.log(`  L${lv} ${MC.LEVELS[lv - 1].name}: ${m.toFixed(0)} / ${Math.max(...a)} / ${MC.LEVELS[lv - 1].ms}  (${a.length} moves)`); }
  }
  if (!has('--no-browser')) okAll = (await browserGame()) && okAll;
  console.log(okAll ? 'ALL OK' : 'SOME CHECKS FAILED');
  process.exitCode = okAll ? 0 : 1;
})();
