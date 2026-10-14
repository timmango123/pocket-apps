// Verification for 石碑翻滾 (block-roll).
// 1) Solves ALL 100 embedded levels in Node with the game's own core code (BFS over position x pose x bridge mask x split cubes)
//    -> proves every level solvable, checks the embedded optimum, the dead-end ratio and that difficulty rises every level.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch swipes (CDP Input.dispatchTouchEvent)
//    at human pace, recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {parseLevel, initState, doMove, solve};')();
const LEVELS = JSON.parse('[' + html.match(/var LEVELS = \[\n([\s\S]*?)\n\];/)[1] + ']');

function solveAll() {
  const res = []; let ok = true, incM = true, incD = true;
  const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const def = LEVELS[n - 1], L = core.parseLevel(def);
    const r = core.solve(L, null, { limit: 3000000, trap: true });
    const good = r && r.len === def.o && Math.abs(r.trap - def.t) < 0.0015;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM: solved', r && r.len, 'embedded', def.o, 'trap', r && r.trap, def.t); }
    if (n > 1 && def.o <= LEVELS[n - 2].o) incM = false;
    if (n > 1 && def.d <= LEVELS[n - 2].d) incD = false;
    // replay the solution to count mechanism use
    let S = core.initState(L), sw = 0, sp = 0;
    for (const mv of r.sol) { const q = core.doMove(L, S, mv); if (q.ev.fired.some(f => f.changed)) sw++; if (q.ev.split) sp++; S = q.S; }
    res.push({ n, opt: r.len, sol: r.sol, states: r.states, trap: r.trap, size: L.w + 'x' + L.h, switches: L.nSw, splits: L.nSp, swUse: sw, spUse: sp, D: def.d,
      fragile: [...L.kind].filter(k => k === 2).length, floor: [...L.kind].filter(k => k).length });
  }
  console.log('All', LEVELS.length, 'levels solvable by BFS with embedded optimum + trap ratio:', ok, `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log('Shortest solution strictly increasing every level:', incM, '| difficulty D strictly increasing every level:', incD);
  console.log('Switch levels use a switch in the optimal solution:', res.filter(r => r.switches).every(r => r.swUse > 0), '| split levels split in the optimal solution:', res.filter(r => r.splits).every(r => r.spUse > 0));
  console.log('Trap ratio >= 25% for all L>=30:', res.filter(r => r.n >= 30).every(r => r.trap >= 0.25));
  for (const n of [1, 8, 15, 25, 40, 50, 75, 80, 99, 100]) { const r = res[n - 1]; console.log(`  L${n}: optimal ${r.opt} moves, board ${r.size}, floor ${r.floor}, fragile ${r.fragile}, switches ${r.switches}, split pads ${r.splits}, trap ${(r.trap * 100).toFixed(0)}%, D ${r.D}, BFS states ${r.states}`); }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIRV = [[1, -1], [1, 1], [-1, 1], [-1, -1]]; // N up-right, E down-right, S down-left, W up-left
async function swipe(cdp, x, y, d) {
  const [dx, dy] = DIRV[d], len = 52, steps = 5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * len * i / steps, y: y + dy * len * i / steps }] }); }
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
  await sleep(600);
  const t0 = Date.now();
  let swaps = 0;
  for (let i = 0; i < sol.length; i++) {
    const mv = sol[i];
    const st = await page.evaluate(() => window.__game.state());
    if (st.split && st.active !== (mv >> 2)) { await tap(cdp, page, '#bSwap'); swaps++; await sleep(170); }
    await swipe(cdp, 195, 470, mv & 3);
    for (let k = 0; k < 200; k++) { const s2 = await page.evaluate(() => window.__game.state()); if (!s2.animating) break; await sleep(20); }
    await sleep(150 + Math.floor(Math.random() * 60)); // human reaction pause between rolls (>=150 ms)
  }
  await sleep(1800);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 7.5 * 1024 * 1024) { // keep demos small: speed up long runs
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, swaps, secs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
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
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'cube swaps', r.swaps, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
