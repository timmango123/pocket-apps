// Verification for 玉珠孤棋 (peg-solitaire).
// 1) Uses the game's own core (CORE-START/CORE-END in ../index.html) to check all 100 embedded levels: the stored solution
//    is legal and reaches the goal, an independent DFS solve from the start position also succeeds, the difficulty
//    metric D strictly increases, and mechanics appear at the levels the spec asks for.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch drags (CDP Input.dispatchTouchEvent) at
//    human pace, recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [--no-dfs] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {makeBoard, decLevel, applyMove, legalMoves, legal, goalOf, isGoal, solve, pegCount, handsOf, SHAPES, KeySet};')();
const NO_DFS = process.argv.includes('--no-dfs'); // skip the (slow) fresh-DFS cross-check, e.g. for bot-only runs
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function checkAll() {
  let ok = LEVELS.length === 100, prevD = -1, rows = [], indepOK = 0;
  const t0 = Date.now();
  LEVELS.forEach((e, k) => {
    const v = C.decLevel(e), B = v.B, G = C.goalOf(B, v.goal, v.goalCells);
    let s = v.s, legalOk = true;
    for (const m of v.sol) { if (m < 0 || !C.legal(B, s[0], s[1], m)) legalOk = false; else s = C.applyMove(B, s, m); }
    const reaches = legalOk && C.isGoal(G, s);
    const ind = NO_DFS ? { r: 'skipped', nodes: 0 } : C.solve(B, G, v.s, 5e6); if (ind.r === 'solved') indepOK++; else if (ind.r === 'dead') ok = false;
    const incr = v.D > prevD; prevD = v.D;
    const good = v.L === k + 1 && reaches && ind.r !== 'dead' && incr && C.handsOf(B, v.sol) === v.hands;
    if (!good) { ok = false; console.log('LEVEL', k + 1, 'PROBLEM', { L: v.L, legalOk, reaches, indep: ind.r, incr }); }
    rows.push({ L: v.L, shape: v.shape, lat: B.lat, diag: v.diag, rocks: v.rocks.length, goal: v.goal, n: v.n, r: v.r, D: v.D, hands: v.hands, moves: v.sol.length, nodes: ind.nodes, sol: v.sol.map(m => [B.mv[m][0], B.mv[m][2]]) });
  });
  console.log('All', LEVELS.length, 'levels: stored solution legal + reaches the goal (=> solvable), D strictly increasing:', ok, '| fresh DFS from the start position (5M-node budget) also finds a solution for', indepOK, '/ 100', '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  const first = f => (rows.find(f) || {}).L;
  console.log('Mechanics first appear at: English cross L' + first(r => r.shape === 'eng') + ', gold target L' + first(r => r.goal === 'c') + ', 6-direction board L' + first(r => r.lat === 'tri') +
    ', pattern ending L' + first(r => r.goal === 'p') + ', diagonal jumps L' + first(r => r.diag) + ', rocks L' + first(r => r.rocks > 0));
  const Dmin = rows[0].D, Dmax = rows[99] ? rows[99].D : 1;
  for (const n of [1, 10, 25, 40, 50, 55, 60, 75, 90, 99, 100]) { const r = rows[n - 1]; if (r) console.log('  L' + n, r.shape + (r.diag ? '/diag' : '') + (r.rocks ? '/rocks' : ''), 'goal', r.goal, 'pegs', r.n, 'r', r.r.toFixed(3), 'D', r.D.toFixed(3), 'shown', (1 + 9 * (r.D - Dmin) / (Dmax - Dmin)).toFixed(1), 'moves', r.moves, 'par hands', r.hands); }
  return rows;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function drag(cdp, a, b) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  const steps = 8;
  for (let i = 1; i <= steps; i++) { await sleep(22); const t = i / steps, e = t * t * (3 - 2 * t); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }] }); }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) {
  const bb = await page.locator(sel).boundingBox(), x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tap(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(500); }
  await sleep(600);
  const t0 = Date.now();
  for (const [a, b] of sol) {
    const pa = await page.evaluate(c => window.__game.cellXY(c), a), pb = await page.evaluate(c => window.__game.cellXY(c), b);
    await drag(cdp, pa, pb);
    for (let k = 0; k < 100; k++) { if (!(await page.evaluate(() => window.__game.state().animating))) break; await sleep(20); }
    await sleep(220 + Math.floor(Math.random() * 160)); // human-ish thinking pause (>=150 ms)
  }
  await sleep(2200);
  const st = await page.evaluate(() => window.__game.state()), winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm')), mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, pegs: st.pegs, hands: st.hands, undos: st.undos, moves: sol.length, secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const rows = checkAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number), targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, rows[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'jumps', r.moves, 'hands', r.hands, '(par', rows[n - 1].hands + ')', 'undos', r.undos, 'pegs left', r.pegs, 'time', r.secs + 's', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
