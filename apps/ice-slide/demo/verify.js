// Verification for 冰原企鵝 (ice-slide).
// 1) Solves ALL 100 embedded levels in Node with the game's own core logic (BFS) -> proves solvable + exact optimum.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch swipes (CDP touch events) at human pace,
//    recording an mp4 and result screenshot per level.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {parseLevel, initState, doMove, solve};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  const res = []; let ok = true;
  for (let n = 1; n <= LEVELS.length; n++) {
    const L = core.parseLevel(LEVELS[n - 1][0].split('/'));
    const r = core.solve(L, 3000000);
    const good = r && r.len === LEVELS[n - 1][1];
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', r && r.len, 'embedded', LEVELS[n - 1][1]); }
    res.push({ n, opt: r ? r.len : null, sol: r ? r.sol : null, size: L.w + 'x' + L.h, fish: L.fish.length });
  }
  console.log('All', LEVELS.length, 'levels solvable with embedded optimum:', ok);
  for (const n of [1, 25, 50, 75, 100]) console.log('  level', n, 'optimal moves', res[n - 1].opt, 'board', res[n - 1].size, 'fish', res[n - 1].fish);
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d], len = 90, steps = 6;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * len * i / steps, y: y + DY * len * i / steps }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(700);
  // Navigate like a player: title -> level select -> unlock-all switch -> level tile
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now();
  const W = 390, Hh = 844;
  for (let i = 0; i < sol.length; i++) {
    await swipe(cdp, W / 2, Hh / 2, sol[i]);
    // wait for slide animation to settle, then a human-ish pause (250-400 ms)
    for (let k = 0; k < 200; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.animating) break; await sleep(25); }
    await sleep(250 + Math.floor(Math.random() * 150));
  }
  await sleep(1500);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = solveAll();
  if (args.includes('--solve-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'time', r.secs + 's', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
