// Verification for 星環迷宮 (gravity-maze).
// 1) Re-solves ALL 100 embedded levels in Node with the game's own core code (extracted via CORE markers):
//    BFS proves each level solvable, the embedded optimum is exact, and the difficulty metric D strictly increases.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent):
//    the first turn of each level is a one-finger arc gesture on the maze, the rest are taps on the big rotate buttons,
//    with a >=150 ms reaction pause after each animation settles. Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {parseLevel, initState, rotate, solve, isWin};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  const res = []; let ok = true, mono = true; const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [s, M, D] = LEVELS[n - 1], L = C.parseLevel(s);
    const r = C.solve(L, C.initState(L), 3000000, true);
    const good = r && r.len === M;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM: solver', r && r.len, 'embedded', M); }
    // replay the solution through the core to double-check it really wins
    let S = C.initState(L); for (const d of r.sol) S = C.rotate(L, S, d).S;
    if (!C.isWin(S)) { ok = false; console.log('LEVEL', n, 'solution does not win'); }
    if (n > 1 && !(D > LEVELS[n - 2][2])) { mono = false; console.log('LEVEL', n, 'D not increasing', LEVELS[n - 2][2], '->', D); }
    const kinds = ['x', '^>v<', 'g', 'O', '1'].filter(k => [...k].some(ch => s.includes(ch))).length;
    res.push({ n, opt: r.len, sol: r.sol, size: L.n, balls: L.cols.length, trap: r.trap, D, states: r.states, kinds });
  }
  const Ds = LEVELS.map(e => e[2]), dmin = Math.min(...Ds), dmax = Math.max(...Ds);
  console.log('All', LEVELS.length, 'levels solvable with exact embedded optimum:', ok, '| D strictly increasing:', mono, '| solve time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const n of [1, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 99, 100]) { const x = res[n - 1];
    console.log(`  level ${String(n).padStart(3)}  board ${x.size}x${x.size}  balls ${x.balls}  min rotations ${String(x.opt).padStart(2)}  trap ${x.trap.toFixed(2)}  element kinds ${x.kinds}  D ${x.D.toFixed(2)} (shown ${(1 + 9 * (x.D - dmin) / (dmax - dmin)).toFixed(1)})  states ${x.states}`); }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tapAt(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapAt(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function arc(cdp, cx, cy, r, dir) { // one-finger arc of 70 degrees around the maze centre
  const a0 = -Math.PI / 2 - dir * 0.6, steps = 10;
  const pt = a => ({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(a0)] });
  for (let i = 1; i <= steps; i++) { await sleep(18); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(a0 + dir * 1.22 * i / steps)] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function settle(page) { for (let k = 0; k < 400; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.animating) return st; await sleep(20); } }

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); await sleep(400); }
  await sleep(600);
  const geo = await page.evaluate(() => { const h = document.getElementById('hud').getBoundingClientRect(), t = document.getElementById('tools').getBoundingClientRect(); return { cy: (h.bottom + t.top - 26) / 2 }; });
  const t0 = Date.now(); let gestures = 0, taps = 0;
  for (let i = 0; i < sol.length; i++) {
    if (i === 0) { await arc(cdp, 195, geo.cy, 150, sol[i]); gestures++; }
    else { await tap(cdp, page, sol[i] > 0 ? '#bCW' : '#bCCW'); taps++; }
    await sleep(60); await settle(page);
    await sleep(170 + Math.floor(Math.random() * 130)); // human reaction time
  }
  await sleep(1800);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, secs, gestures, taps, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'rotations', r.moves, '/ optimal', r.opt, `(${r.gestures} arc gesture + ${r.taps} button taps)`, 'time', r.secs + 's', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
