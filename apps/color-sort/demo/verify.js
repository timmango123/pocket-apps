// Verification for 鍊金藥劑室 (color-sort).
// 1) Node: reads the game's own core (CORE-START/END) + embedded LEVELS from ../index.html and, for all 100 levels,
//    proves solvability with exact A* (admissible heuristic: colour segments - colours), checks the embedded par equals
//    the proven optimum, par is within ±10% of the target curve and never decreases, and the difficulty metric
//    (spec formula) strictly increases.
// 2) Browser: an auto-player clears levels 50, 75, 99, 100 in the real page with real touch taps
//    (CDP Input.dispatchTouchEvent) at human pace (>=150 ms between taps, waits for each pour animation),
//    recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT || __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {csParams, csTarget, csDiffRaw, csInit, csSolve, csPour, csWon, csMoves};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
const levelData = L => ({ tubes: L.t.split('/'), caps: L.c.split('').map(Number), hid: L.h.split(',').map(x => parseInt(x, 36) || 0), fz: L.f.split('').map(Number) });

function solveAll(only) {
  const res = []; let ok = true, prevPar = 0, prevDiff = 0, totalMs = 0;
  for (let n = 1; n <= LEVELS.length; n++) {
    const Lv = LEVELS[n - 1], D = levelData(Lv), P = core.csParams(n);
    if (only && !only.includes(n)) { res.push(null); continue; }
    const t0 = Date.now();
    const r = core.csSolve(core.csInit(D), { limit: 3000000 });
    const ms = Date.now() - t0; totalMs += ms;
    // replay the solution with the game's pour() to double-check it really wins
    let S = core.csInit(D), legal = true;
    if (r && r.sol) for (const [a, b] of r.sol) { const q = core.csPour(S, a, b); if (!q) { legal = false; break; } S = q.S; }
    const T = core.csTarget(n), diff = core.csDiffRaw(n);
    const hidden = Lv.h.split(',').reduce((s, x) => { let m = parseInt(x, 36) || 0, c = 0; while (m) { c += m & 1; m >>= 1; } return s + c; }, 0);
    const issues = [];
    if (!r || r.len < 0) issues.push('not solved');
    else {
      if (!legal || !core.csWon(S)) issues.push('replay failed');
      if (r.len !== Lv.p) issues.push('optimum ' + r.len + ' != embedded par ' + Lv.p);
      if (Math.abs(r.len - T) > T * 0.1) issues.push('outside target ±10% (' + T.toFixed(1) + ')');
      if (r.len < prevPar) issues.push('par decreased');
    }
    if (!only && diff <= prevDiff) issues.push('difficulty not increasing');
    if (issues.length) { ok = false; console.log('LEVEL', n, 'PROBLEM:', issues.join('; ')); }
    prevPar = r ? r.len : prevPar; prevDiff = diff;
    res.push({ n, opt: r ? r.len : null, sol: r ? r.sol : null, K: P.K, tubes: D.tubes.length, hidden, frozen: P.frozen, diff, ms, expanded: r ? r.expanded : 0 });
  }
  if (!only) {
    console.log('All', LEVELS.length, 'levels solvable, embedded par = proven A* optimum, par non-decreasing & within ±10% of target, difficulty strictly increasing:', ok);
    console.log('Solve time total', (totalMs / 1000).toFixed(1) + 's');
    for (const n of [1, 10, 20, 21, 40, 41, 50, 60, 61, 70, 71, 75, 80, 81, 90, 91, 99, 100]) {
      const x = res[n - 1];
      console.log('  L' + String(n).padStart(3), 'optimal', String(x.opt).padStart(2), 'colours', String(x.K).padStart(2), 'tubes', String(x.tubes).padStart(2), 'hidden', String(x.hidden).padStart(2), 'frozen', x.frozen, 'difficulty raw', x.diff.toFixed(1), 'A* nodes', x.expanded);
    }
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchAt(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50 + Math.random() * 30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await touchAt(cdp, b.x + b.width / 2, b.y + b.height / 2);
}

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // Navigate like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(500); }
  const t0 = Date.now();
  for (let i = 0; i < sol.length; i++) {
    const [a, b] = sol[i];
    const pa = await page.evaluate(i => __game.tubeCenter(i), a);
    await touchAt(cdp, pa.x + (Math.random() - .5) * 10, pa.y + (Math.random() - .5) * 30);
    await sleep(170 + Math.random() * 120);           // human reaction between the two taps
    const pb = await page.evaluate(i => __game.tubeCenter(i), b);
    await touchAt(cdp, pb.x + (Math.random() - .5) * 10, pb.y + (Math.random() - .5) * 30);
    // wait for the pour animation, then a short human-ish pause before the next move
    for (let k = 0; k < 200; k++) { const st = await page.evaluate(() => __game.state()); if (!st.animating) break; await sleep(25); }
    await sleep(160 + Math.floor(Math.random() * 140));
  }
  await sleep(2600);
  const st = await page.evaluate(() => __game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 75 ? 2 : 1;
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const vf = speed > 1 ? ['-vf', 'setpts=PTS/' + speed] : [];
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, secs: secs.toFixed(1), errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const res = solveAll(args.includes('--fast') ? targets : null);
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
