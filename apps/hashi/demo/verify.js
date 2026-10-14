// Verification for 群島橋匠 (hashi).
// 1) Node: extracts the game's own core (CORE-START/CORE-END) from ../index.html and checks ALL 100 embedded levels:
//    the logic solver finishes each one (=> unique solution), an independent backtracking search finds exactly one
//    solution, island counts follow I(L), difficulty scores strictly increase, and the spec's new elements appear.
// 2) Browser: an auto-player clears levels 50, 75, 99, 100 in the real page with real touch drags
//    (CDP Input.dispatchTouchEvent) at human pace, recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {parseLevel, logicSolve, countSolutions, levelParams, checkSolution};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  let ok = true, prev = 0, prevI = 0; const t0 = Date.now(), rows = [];
  for (let n = 1; n <= LEVELS.length; n++) {
    const [src, emb] = LEVELS[n - 1], P = C.parseLevel(src), pr = C.levelParams(n);
    const r = C.logicSolve(P), bt = C.countSolutions(P, 2);
    const n78 = P.isl.filter(i => i.n >= 7).length, masked = P.mask.reduce((a, b) => a + b, 0);
    const probs = [];
    if (r.status !== 'solved') probs.push('logic ' + r.status);
    if (bt.count !== 1) probs.push('backtracking found ' + bt.count + ' solutions');
    if (r.score !== emb) probs.push('score ' + r.score + ' != embedded ' + emb);
    if (P.isl.length !== pr.I) probs.push('islands ' + P.isl.length + ' != I(L) ' + pr.I);
    if (P.w !== pr.w || P.h !== pr.h) probs.push('board size');
    if (n > 1 && !(r.score > prev)) probs.push('score not above previous ' + prev);
    if (P.isl.length < prevI) probs.push('fewer islands than previous');
    if (pr.needIso && !r.used.iso) probs.push('no isolation step');
    if (pr.needTrial && !r.used.trial) probs.push('no trial step');
    if (pr.dense && !n78) probs.push('no 7/8 island');
    if (pr.mask && !masked) probs.push('no coast mask');
    if (probs.length) { ok = false; console.log('LEVEL', n, 'PROBLEM', probs.join('; ')); }
    rows.push({ n, size: P.w + 'x' + P.h, islands: P.isl.length, score: r.score, target: Math.round(pr.target), used: r.used, n78, masked });
    prev = r.score; prevI = P.isl.length;
  }
  let minStep = 1e9; for (let i = 1; i < rows.length; i++) minStep = Math.min(minStep, rows[i].score / rows[i - 1].score - 1);
  console.log('All', LEVELS.length, 'levels: unique solution (logic + backtracking), I(L) islands, strictly rising score:', ok, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  console.log('  smallest level-to-level score increase: +' + (minStep * 100).toFixed(1) + '%');
  for (const n of [1, 10, 20, 30, 40, 50, 60, 70, 80, 85, 90, 99, 100]) {
    const r = rows[n - 1];
    console.log('  L' + n, r.size, 'islands', r.islands, 'score', r.score, '(target ' + r.target + ')', 'steps b/c/i/t', [r.used.basic, r.used.cap, r.used.iso, r.used.trial].join('/'), '7-8s', r.n78, 'coast', r.masked);
  }
  return ok;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchDrag(cdp, x0, y0, x1, y1) {
  const steps = 7;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) { await sleep(22); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps, id: 1 }] }); }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tap(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); await sleep(400); }
  const plan = await page.evaluate(() => window.__game.plan());
  const edges = await page.evaluate(() => window.__game.edges());
  const XY = await page.evaluate(() => { const g = window.__game, n = g.state().islands, o = []; for (let i = 0; i < n; i++) o.push(g.islandXY(i)); return o; });
  const cnt = await page.evaluate(() => window.__game.cnt());
  const t0 = Date.now(); let drags = 0;
  for (const st of plan) {
    let need = (st.v - cnt[st.e] + 3) % 3;
    const ed = edges[st.e], other = ed.a === st.from ? ed.b : ed.a, A = XY[st.from], B = XY[other];
    while (need-- > 0) {
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy), go = Math.min(L * 0.85, Math.max(44, L * 0.6));
      await touchDrag(cdp, A[0], A[1], A[0] + dx / L * go, A[1] + dy / L * go);
      cnt[st.e] = (cnt[st.e] + 1) % 3; drags++;
      await sleep(150 + Math.floor(Math.random() * 90)); // human pace between actions
    }
  }
  const playSecs = ((Date.now() - t0) / 1000).toFixed(1);
  for (let k = 0; k < 40; k++) { if (await page.isVisible('#win')) break; await sleep(150); }
  await sleep(1300);
  const st = await page.evaluate(() => window.__game.state());
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) { // speed up long recordings
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=0.5*PTS', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: !!(st && st.won && st.winShown), drags, islands: st && st.islands, hints: st && st.hints, playSecs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = solveAll();
  if (args.includes('--solve-only')) process.exit(ok ? 0 : 1);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'islands', r.islands, 'touch drags', r.drags, 'hints', r.hints, 'play time', r.playSecs + 's', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
