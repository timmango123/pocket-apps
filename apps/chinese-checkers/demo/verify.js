// Verification for 中國跳棋.
// (1) Node match series with the game's own engine (CORE block of ../index.html): strongest level 5 「冠軍」 vs weakest level 1 「小孩」,
//     2 players, alternating who moves first, real time budgets.
// (2) A bot plays one complete game in the real page in Chromium against the page's own AI (Web Worker), using real touch input
//     (CDP Input.dispatchTouchEvent) at human pace (>= 150 ms between actions), recorded to game*.mp4 + game-result.png.
// Usage: node verify.js [--games N] [--skip-match] [--skip-game] [--cpu LEVEL]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const CC = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return CC;')();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function match(games) {
  let strong = 0, weak = 0; const lens = [], margins = [], tStrong = [];
  for (let g = 0; g < games; g++) {
    const st = CC.newGame({ np: 2 }), strongSeat = g % 2, lv = s => s === strongSeat ? 5 : 1;
    let n = 0;
    while (!st.over) {
      const r = CC.think(st, st.turn, lv(st.turn), { seed: 99 + g * 1000 + n });
      if (!r) { CC.pass(st); continue; }
      if (st.turn === strongSeat) tStrong.push(r.ms);
      CC.play(st, r.from, r.to); n++;
    }
    const win = st.over.ranking[0];
    if (win === strongSeat) strong++; else weak++;
    lens.push(st.round); margins.push(CC.remaining(st, st.over.ranking[1]));
    console.log('  game', g + 1, '冠軍 plays', strongSeat ? 'second' : 'first', '-> winner', win === strongSeat ? '冠軍(L5)' : '小孩(L1)', '| rounds', st.round, '| loser still', CC.remaining(st, st.over.ranking[1]), 'steps from home');
  }
  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length);
  console.log('MATCH L5 冠軍 vs L1 小孩:', strong + '-' + weak, '| avg rounds', avg(lens).toFixed(1), '| avg loser distance left', avg(margins).toFixed(1), '| L5 think avg', avg(tStrong).toFixed(0) + 'ms max', Math.max(...tStrong) + 'ms');
  return { strong, weak };
}

let touchId = 1;
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: touchId }] });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  touchId++;
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function game(cpuLevel) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // set the computer seat to the requested level with the + / − buttons, then start
  for (let k = 0; k < 6; k++) {
    const txt = await page.textContent('#seats .seat:nth-child(2) .lv span');
    const cur = +txt.match(/Lv(\d)/)[1]; if (cur === cpuLevel) break;
    await tapSel(cdp, page, '#seats .seat:nth-child(2) .lv button[data-d="' + (cur < cpuLevel ? 1 : -1) + '"]'); await sleep(250);
  }
  await tapSel(cdp, page, '#bStart'); await sleep(900);
  const t0 = Date.now(); let myMoves = 0, longest = 0, gaps = [], lastAct = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const s = await page.evaluate(() => window.__game.state());
    if (s.over) break;
    if (!(s.human && s.phase === 'human' && !s.anim)) { await sleep(60); continue; }
    const r = CC.think(s.st, s.turn, 5, { seed: 5 + myMoves, timeMs: 450 });   // the bot's own decision (engine core, level 5)
    await sleep(320 + Math.floor(Math.random() * 220));                        // human "look at the board" pause
    const a = await page.evaluate(c => window.__game.cellXY(c), r.from);
    if (lastAct) gaps.push(Date.now() - lastAct);
    await tapXY(cdp, a[0], a[1]); lastAct = Date.now();
    await sleep(240 + Math.floor(Math.random() * 160));
    const s2 = await page.evaluate(() => window.__game.state());
    if (s2.sel !== r.from) { continue; }
    const b = await page.evaluate(c => window.__game.cellXY(c), r.to);
    gaps.push(Date.now() - lastAct);
    await tapXY(cdp, b[0], b[1]); lastAct = Date.now();
    const jumps = CC.paths(CC.load(s.st), s.turn, r.from)[r.to].jumps; longest = Math.max(longest, jumps);
    myMoves++;
    await sleep(200);
  }
  for (let k = 0; k < 100 && !(await page.evaluate(() => window.__game.state().resultVisible)); k++) await sleep(100);
  await sleep(1600);
  const fin = await page.evaluate(() => window.__game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (/^game(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  const speed = secs > 70 ? 4 : 1, mp4 = path.join(OUT, speed > 1 ? 'game-' + speed + 'x.mp4' : 'game.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const st = fin.st, me = 0;
  console.log('GAME in Chromium (390x844, touch via CDP): bot (red, seat 0) vs page AI level', cpuLevel, CC.LEVELS[cpuLevel - 1].name);
  console.log('  result screen:', fin.resultVisible ? 'shown' : 'NOT shown', '| title:', title, '| ranking', JSON.stringify(st.over && st.over.ranking), '| reason', st.over && st.over.reason);
  console.log('  rounds', st.round, '| bot moves', myMoves, '| longest bot jump chain', longest, '| min gap between taps', Math.min(...gaps) + 'ms', '| wall time', secs.toFixed(0) + 's');
  console.log('  video', path.basename(mp4), Math.round(fs.statSync(mp4).size / 1024) + 'KB', '(' + speed + 'x) |', errors.length ? 'CONSOLE ERRORS: ' + errors.join(' | ') : 'no console errors');
  return fin.resultVisible && !errors.length && Math.min(...gaps) >= 150;
}
(async () => {
  let ok = true;
  if (!process.argv.includes('--skip-match')) { const m = match(+arg('--games', 10)); ok = ok && m.strong > m.weak * 3; }
  if (!process.argv.includes('--skip-game')) ok = (await game(+arg('--cpu', 3))) && ok;
  process.exitCode = ok ? 0 : 1;
})();
