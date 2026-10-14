// Verification for 鏡湖雙影 (mirror-walk).
// 1) Re-solves ALL 100 embedded levels in Node with the game's own core (extracted between CORE markers):
//    proves solvable, checks the embedded optimum / 錯位 count / trap ratio, and that difficulty D rises every level.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch swipes (CDP Input.dispatchTouchEvent)
//    at human pace (>=150 ms between actions), recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {parseLevel, initState, step, analyze, diffScore, levelKinds};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn LEVELS;')();

function solveAll() {
  const res = []; let ok = true, mono = true, prevD = -1;
  const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const e = LEVELS[n - 1], L = core.parseLevel(e);
    const r = core.analyze(L, null, 3000000, true);
    const kinds = core.levelKinds(L), D = core.diffScore(r.len, r.E, r.trap, kinds);
    const M = Math.min(60, Math.round(6 * Math.pow(1.03, n))), En = Math.floor(1 + n / 8);
    const good = r.len > 0 && r.len === e[4] && r.E === e[5] && Math.round(r.trap * 100) === e[6] && r.len >= M && r.E >= En;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM opt', r.len, 'embedded', e[4], 'M', M, 'E', r.E, '/', En, 'trap', r.trap); }
    if (D <= prevD) { mono = false; console.log('LEVEL', n, 'D not rising', D.toFixed(2), '<=', prevD.toFixed(2)); }
    prevD = D;
    res.push({ n, opt: r.len, E: r.E, trap: r.trap, D, kinds, states: r.states, sol: r.sol, size: L.w + 'x' + L.h, mode: e[0] });
  }
  console.log('All', LEVELS.length, 'levels solvable by BFS with embedded optimum, opt >= M(L), E >= floor(1+L/8):', ok, '| D strictly increasing:', mono, '|', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log(' lvl size mode opt  M  E/need trap/target  kinds   D');
  for (const n of [1, 10, 20, 30, 40, 50, 60, 65, 75, 85, 90, 99, 100]) {
    const r = res[n - 1], M = Math.min(60, Math.round(6 * Math.pow(1.03, n))), tt = Math.min(0.75, 0.05 * Math.pow(1.035, n));
    console.log(String(n).padStart(4), r.size.padStart(4), String(r.mode).padStart(4), String(r.opt).padStart(4), String(M).padStart(3), (r.E + '/' + Math.floor(1 + n / 8)).padStart(7), (r.trap.toFixed(2) + '/' + tt.toFixed(2)).padStart(12), String(r.kinds).padStart(6), r.D.toFixed(1).padStart(7));
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d], len = 60, steps = 5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await sleep(14); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * len * i / steps, y: y + DY * len * i / steps }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // Navigate like a player: title -> level select -> unlock-all switch -> level tile
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(500); }
  const t0 = Date.now();
  const X = 195, Y = await page.evaluate(() => { const g = window.__game.geo(); return Math.round(g.B.y - g.s * 0.5); });
  for (let i = 0; i < sol.length; i++) {
    for (let k = 0; k < 200; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.animating) break; await sleep(20); }
    await sleep(150 + Math.floor(Math.random() * 120)); // human reaction time between moves
    await swipe(cdp, X, Y, sol[i]);
  }
  await sleep(2200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
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
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'time', r.secs + 's', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
