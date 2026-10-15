// Verification for 霓虹夜停 (parking-escape).
// 1) Node: re-solves ALL 100 embedded levels (and the daily pool) with the game's own core (BFS, extracted from
//    index.html between CORE markers): solvable, embedded optimum exact, embedded solution legal, min moves
//    non-decreasing, difficulty index strictly increasing, mechanics present where the spec says (L11/41/71/81/91),
//    and hint correctness (from random reachable states the solver's first move always shortens the solution by 1).
// 2) Browser: an auto-player clears levels 50, 75, 99, 100 in the real page using real touch drags
//    (CDP Input.dispatchTouchEvent: touchStart -> touchMove every 16 ms -> touchEnd) with >=150 ms human reaction
//    between moves, recording level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {parseBoard, encodeBoard, gridOf, rangeOf, isWin, keyOf, solve, reachCount, encodeSol, decodeSol, rawDifficulty};')();
const data = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn {LEVELS, DAILY};')();
const { LEVELS, DAILY } = data;

function replaySol(B, sol) { // legal + reaches goal?
  const s = B.start.slice(), cars = new Set();
  for (const [i, v] of sol) { const r = C.rangeOf(B, s, C.gridOf(B, s), i); if (v < r[0] || v > r[1] || v === s[i]) return null; s[i] = v; cars.add(i); }
  return C.isWin(B, s) ? cars.size : null;
}
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function hintCheck(B, trials) {
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    const s = B.start.slice(), steps = 1 + Math.floor(rnd() * 8);
    for (let k = 0; k < steps; k++) { // random legal moves
      const g = C.gridOf(B, s), opts = [];
      for (let i = 0; i < B.cars.length; i++) { const r = C.rangeOf(B, s, g, i); for (let v = r[0]; v <= r[1]; v++) if (v !== s[i]) opts.push([i, v]); }
      if (!opts.length) break; const m = opts[Math.floor(rnd() * opts.length)]; s[m[0]] = m[1];
      if (C.isWin(B, s)) break;
    }
    const a = C.solve(B, s);
    if (!a) { ok++; continue; } // dead end (one-way): the game reports "no solution" -> correct behaviour
    if (a.len === 0) { ok++; continue; }
    const s2 = s.slice(); s2[a.path[0][0]] = a.path[0][1];
    const b = C.solve(B, s2);
    if (b && b.len === a.len - 1) ok++;
  }
  return ok;
}
function solveAll() {
  const res = []; let ok = true, prevD = -1, prevM = 0, hintOk = 0, hintN = 0, deadEnds = 0;
  const D1 = (() => { const B = C.parseBoard(LEVELS[0][0]); return C.rawDifficulty(B, LEVELS[0][1], C.reachCount(B, B.start)); })();
  const D100 = (() => { const e = LEVELS[LEVELS.length - 1], B = C.parseBoard(e[0]); return C.rawDifficulty(B, e[1], C.reachCount(B, B.start)); })();
  const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [code, m, solStr, R, diff] = LEVELS[n - 1], B = C.parseBoard(code);
    const r = C.solve(B, B.start), reach = C.reachCount(B, B.start);
    const raw = C.rawDifficulty(B, r ? r.len : 0, reach), norm = Math.round((1 + 99 * (raw - D1) / (D100 - D1)) * 10) / 10;
    const distinct = replaySol(B, C.decodeSol(solStr));
    const pil = B.walls.some(Boolean), truck = B.cars.some(k => k.len === 3), ow = B.cars.some(k => k.ow);
    const problems = [];
    if (!r || r.len !== m) problems.push('optimum ' + (r && r.len) + ' != ' + m);
    if (distinct == null || C.decodeSol(solStr).length !== m) problems.push('embedded solution invalid');
    if (reach !== R || Math.abs(norm - diff) > 0.05) problems.push('difficulty mismatch ' + norm + ' vs ' + diff);
    if (!(diff > prevD)) problems.push('difficulty not increasing');
    if (m < prevM) problems.push('min moves decreased');
    if (n >= 11 && !truck) problems.push('no truck');
    if (n >= 41 && n <= 70 && !pil) problems.push('no pillar');
    if ((n >= 71) !== (B.W === 7)) problems.push('board size');
    if (n >= 81 && !ow) problems.push('no one-way car');
    if (n >= 91 && (!pil || distinct < 6)) problems.push('L91+ needs pillar and >=6 distinct cars (' + distinct + ')');
    if (n <= 3 && B.cars.length > 4) problems.push('tutorial too many cars');
    if (problems.length) { ok = false; console.log('LEVEL', n, 'PROBLEMS:', problems.join('; ')); }
    if (n % 3 === 0 || n >= 95) { const h = hintCheck(B, 4); hintOk += h; hintN += 4; }
    res.push({ n, m, sol: C.decodeSol(solStr), W: B.W, cars: B.cars.length, diff, reach, distinct, ow: B.cars.filter(k => k.ow).length });
    prevD = diff; prevM = m;
  }
  let dOk = 0; for (const [code, m, s] of DAILY) { const B = C.parseBoard(code), r = C.solve(B, B.start); if (r && r.len === m && m >= 25 && replaySol(B, C.decodeSol(s)) != null) dOk++; }
  console.log('All', LEVELS.length, 'levels solvable, optimum exact, rules/mechanics/monotonic checks:', ok ? 'PASS' : 'FAIL', '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  console.log('Hint check (solver next move shortens solution by 1, or reports dead end) :', hintOk + '/' + hintN);
  console.log('Daily pool:', dOk + '/' + DAILY.length, 'valid with >=25 moves');
  console.log('min moves  L1..L100:', res.map(r => r.m).join(' '));
  console.log('difficulty L1..L100:', res.map(r => r.diff).join(' '));
  for (const n of [1, 3, 10, 11, 25, 40, 41, 50, 70, 71, 75, 81, 90, 91, 99, 100]) { const r = res[n - 1]; console.log(`  L${n}: ${r.W}x${r.W}, ${r.cars} cars, min ${r.m} moves, difficulty ${r.diff}, reachable states ${r.reach}, cars moved in optimal ${r.distinct}, one-way ${r.ow}`); }
  if (!ok) process.exitCode = 1;
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchDrag(cdp, x0, y0, x1, y1) {
  const steps = 12; // 12 x 16ms ~ 200ms drag
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(16);
    const u = i / steps, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e, id: 1 }] });
  }
  await sleep(16);
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
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(500); }
  const t0 = Date.now(); let reactMin = 1e9;
  const cars = await page.evaluate(() => window.__game.cars());
  for (let k = 0; k < sol.length; k++) {
    const [i, to] = sol[k];
    const st = await page.evaluate(() => window.__game.state()), g = await page.evaluate(() => window.__game.geom());
    const car = cars[i], from = st.s[i];
    // grab the middle of the car, drag along its axis by (to-from) cells
    const cx = g.ox + (car.h ? from + car.len / 2 : car.f + 0.5) * g.cs, cy = g.oy + (car.h ? car.f + 0.5 : from + car.len / 2) * g.cs;
    const dx = car.h ? (to - from) * g.cs : 0, dy = car.h ? 0 : (to - from) * g.cs;
    await touchDrag(cdp, cx, cy, cx + dx, cy + dy);
    const tEnd = Date.now();
    for (let w = 0; w < 100; w++) { const s2 = await page.evaluate(() => window.__game.state()); if (!s2.animating) break; await sleep(20); }
    const react = 170 + Math.floor(Math.random() * 120); await sleep(react);
    reactMin = Math.min(reactMin, Date.now() - tEnd);
  }
  for (let w = 0; w < 150; w++) { if (await page.isVisible('#win')) break; await sleep(50); }
  await sleep(1300);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4'), args = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart'];
  if (secs > 40) { mp4 = path.join(OUT, 'level-' + n + '-2x.mp4'); args = ['-vf', 'setpts=0.5*PTS', '-r', '30'].concat(args); }
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm)].concat(args, [mp4]));
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: sol.length, secs: secs.toFixed(1), reactMin, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = args.includes("--skip-solve") ? LEVELS.map(e => ({ sol: C.decodeSol(e[2]) })) : solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'time', r.secs + 's', 'min reaction', r.reactMin + 'ms', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
