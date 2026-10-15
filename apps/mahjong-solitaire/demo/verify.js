// Verification for 麻將接龍 (mahjong-solitaire).
// 1) Rebuilds ALL 100 levels in Node from the embedded table (template + seed + deal mode) with the game's own core
//    code (CORE-START/END, solver between SOLVER-BEGIN/END), then for every level:
//    - replays the reverse-construction order under the real rules (proof of solvability),
//    - solves it independently with the DFS solver,
//    - recomputes the difficulty score S and asserts S strictly increases level to level.
// 2) Drives the real page in Chromium with CDP touch taps at human pace (>=150 ms between taps) and clears
//    levels 50, 75, 99, 100, recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {TPL,makeLevel,levelParams,simStats,scoreS,solve,replayCheck,mulberry32};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);

function solveAll() {
  let ok = true, prevS = -1, minStep = 1e9; const info = {}; const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [ti, seed, mode, Semb] = LEVELS[n - 1];
    const L = C.makeLevel(n, ti, seed, mode), p = L.p;
    const replay = C.replayCheck(L.lay, L.faces, L.order);
    const sol = C.solve(L.lay, new Uint8Array(L.lay.n).fill(1), L.faces, 400000);
    const st = C.simStats(L.lay, L.faces, C.mulberry32(1000 + n), 300);
    const S = C.scoreS(p.N, p.L, st);
    const layers = L.lay.maxZ + 1;
    const good = replay && sol.ok && C.replayCheck(L.lay, L.faces, sol.sol) && L.lay.n === p.N && layers === p.L && S > prevS && Math.abs(S - Semb) < 0.006;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', { replay, solver: sol.ok, n: L.lay.n, layers, S, Semb, prevS }); }
    if (prevS > 0) minStep = Math.min(minStep, S - prevS);
    prevS = S;
    info[n] = { n, tpl: C.TPL[ti][0], N: p.N, layers, S, solLen: sol.ok ? sol.sol.length : null, nodes: sol.nodes, stuck: st.stuck, avgPairs: st.avgPairs };
  }
  console.log('All', LEVELS.length, 'levels: construction replay + DFS solver solvable, tile counts/layers match, S strictly increasing:', ok);
  console.log('  S from', info[1].S.toFixed(2), 'to', info[100].S.toFixed(2), '; smallest step between consecutive levels', minStep.toFixed(3), '; time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const n of [1, 25, 50, 75, 99, 100]) { const r = info[n]; console.log('  level', n, r.tpl, 'tiles', r.N, 'layers', r.layers, 'S', r.S.toFixed(2), 'solution pairs', r.solLen, 'solver nodes', r.nodes, 'random-player stuck rate', (r.stuck * 100).toFixed(0) + '%', 'avg pairs', r.avgPairs.toFixed(2)); }
  return ok;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function playLevel(browser, n) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); await sleep(400); }
  await sleep(600);
  const plan = await page.evaluate(() => __game.plan());
  const t0 = Date.now(); let taps = 0, misses = 0;
  for (const [a, b] of plan) {
    for (const i of [a, b]) {
      const c = await page.evaluate(i => __game.tileCenter(i), i);
      if (!c.free) misses++;
      await tapXY(cdp, c.x, c.y); taps++;
      await sleep(170 + Math.floor(Math.random() * 90));
    }
    await sleep(60);
  }
  await sleep(2600);
  const st = await page.evaluate(() => __game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, stars: st.stars, pairs: plan.length, taps, misses, secs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = solveAll();
  if (args.includes('--solve-only')) { process.exitCode = ok ? 0 : 1; return; }
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'stars', r.stars, 'pairs', r.pairs, 'taps', r.taps, 'taps on non-free tiles', r.misses, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
