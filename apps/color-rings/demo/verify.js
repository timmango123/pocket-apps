// Verification for 光環穿越 (color-rings), an endless reaction game.
// Part A (Node, game's own core extracted via CORE markers):
//   1) collision precision: exact circle-vs-annular-sector / rotated-rect tests agree with brute-force sampling
//   2) fairness: every generated obstacle (all types, scores 0..150) leaves a same-colour pass window >= 220 ms
//   3) prism guarantee: every prism gives the colour the next obstacle was verified for
//   4) difficulty ramp: obstacle speed / spacing / pool by score
//   5) headless bot (150 ms reaction) over 10 seeds
// Part B (Chromium): auto-player drives the real page with CDP touch events at human pace (>=150 ms reaction,
//   >=150 ms between taps), records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--core-only] [--max-seconds N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const CR = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn CR;')();

function collisionTest() {
  const R = CR.rng(42); let bad = 0, n = 0, edge = 0;
  for (let i = 0; i < 20000; i++) {
    const Rr = 40 + R() * 80, th = 8 + R() * 12, a0 = (R() - 0.5) * 20, span = 0.3 + R() * 2.8, r = 9;
    const px = (R() - 0.5) * 2 * (Rr + 30), py = (R() - 0.5) * 2 * (Rr + 30);
    // brute force: min distance from ball centre to densely sampled sector points
    let md = Infinity;
    for (let k = 0; k <= 240; k++) { const a = a0 + span * k / 240; for (let j = 0; j <= 12; j++) { const rr = Rr - th / 2 + th * j / 12; const d = Math.hypot(px - rr * Math.cos(a), py - rr * Math.sin(a)); if (d < md) md = d; } }
    if (Math.abs(md - r) < 0.6) { edge++; continue; } // within sampling resolution of the edge
    n++; if (CR.hitArc(px, py, r, 0, 0, Rr, th, a0, span) !== (md < r)) bad++;
  }
  let badB = 0, nB = 0;
  for (let i = 0; i < 20000; i++) {
    const hx = 5 + R() * 50, hy = 3 + R() * 10, ang = R() * 7, px = (R() - 0.5) * 140, py = (R() - 0.5) * 140, r = 9;
    let md = Infinity; const c = Math.cos(ang), s = Math.sin(ang);
    for (let a = 0; a <= 60; a++) for (let b = 0; b <= 16; b++) { const lx = -hx + 2 * hx * a / 60, ly = -hy + 2 * hy * b / 16; const d = Math.hypot(px - (lx * c - ly * s), py - (lx * s + ly * c)); if (d < md) md = d; }
    if (Math.abs(md - r) < 0.6) continue;
    nB++; if (CR.hitBox(px, py, r, 0, 0, ang, hx, hy) !== (md < r)) badB++;
  }
  console.log(`[collision] annular sector: ${n} random cases vs brute force, mismatches ${bad} (edge-ambiguous skipped ${edge}); rotated rect: ${nB} cases, mismatches ${badB}`);
  return bad === 0 && badB === 0;
}

function fairnessTest() {
  const types = ['ring', 'cross', 'bar', 'double', 'triple', 'square', 'loose'];
  let minWin = Infinity, count = 0, slowedMax = 0; const byType = {};
  const R = CR.rng(7);
  for (let s = 0; s <= 150; s += 2) for (const t of types) {
    if (t !== 'loose' && !CR.poolFor(s).includes(t)) continue;
    for (let k = 0; k < 3; k++) {
      const o = CR.build(t, s, R, Math.floor(R() * 4)); count++;
      minWin = Math.min(minWin, o.win); slowedMax = Math.max(slowedMax, o.slowed);
      (byType[t] = byType[t] || []).push(o.win);
    }
  }
  console.log(`[fairness] ${count} obstacles (all types, score 0-150): shortest same-colour pass window = ${(minWin * 1000).toFixed(0)} ms (required >= 220 ms)`);
  console.log('           per type min window (ms): ' + Object.keys(byType).map(t => t + ' ' + Math.round(Math.min(...byType[t]) * 1000)).join(', '));
  return minWin >= 0.22;
}

function runGenerationTest() {
  // Generate long obstacle sequences, forcing the score up, and check the prism guarantee + ramp
  let prismsOk = 0, prismsBad = 0, lowWin = 0; const rows = [];
  for (let seed = 1; seed <= 20; seed++) {
    const S = CR.newRun(seed, 780);
    for (let step = 0; step < 140; step++) { S.score = step; S.cam -= 300; CR.fill(S); }
    const all = S.obs;
    for (const p of S.prisms) { const next = all.find(o => o.idx === p.idx); if (next && next.col === p.c && next.win >= CR.MINWIN) prismsOk++; else prismsBad++; }
    all.forEach(o => { if (o.win < CR.MINWIN) lowWin++; });
    if (seed === 1) rows.push(...all);
  }
  console.log(`[prism] ${prismsOk + prismsBad} prisms checked over 20 long runs: ${prismsOk} give the exact colour the next obstacle was fairness-verified for, ${prismsBad} bad; obstacles under 220 ms: ${lowWin}`);
  console.log('[ramp]  score -> target ω (rad/s), spacing (px), difficulty, unlocked pool');
  for (const s of [0, 5, 10, 18, 25, 28, 38, 50, 60, 80]) console.log(`        s=${String(s).padStart(3)}  ω=${CR.omegaFor(s).toFixed(2)}  spacing=${CR.spacingFor(s)}  難度=${CR.diffFor(s)}  pool=${CR.poolFor(s).join('/')}`);
  return prismsBad === 0 && lowWin === 0;
}

function headlessBot() {
  const scores = [];
  for (let seed = 1; seed <= 10; seed++) {
    const S = CR.newRun(seed * 7919, 780); CR.tap(S); let pending = -1, nextPlan = 0; const R = CR.rng(seed);
    while (!S.dead && S.t < 600) {
      if (pending >= 0 && S.t >= pending) { CR.tap(S); pending = -1; }
      if (pending < 0 && S.t >= nextPlan) { const lat = 0.15 + R() * 0.03; if (CR.plan(S, lat)) pending = S.t + lat; nextPlan = S.t + 0.04; }
      CR.tick(S);
    }
    scores.push(S.score);
  }
  console.log(`[bot-headless] 150-180 ms reaction, 10 seeds: scores ${scores.join(', ')} (avg ${(scores.reduce((a, b) => a + b) / scores.length).toFixed(1)})`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y, hold = 50) {
  // timestamp = the moment the finger lands (like a touchscreen's hardware timestamp)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: Date.now() / 1000 });
  await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2, 60); }

// The page runs under CDP virtual time, advanced one 30 fps frame at a time, so the bot's reaction time is exact
// game time no matter how loaded the machine is (other jobs run in parallel). Every frame is screenshotted into the
// video. The bot looks at the frame, decides, and its real CDP touch lands REACT_FRAMES frames (167 ms) later.
async function browserRun(maxSeconds) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const FPS = 30, FRAME = 1000 / FPS, REACT_FRAMES = 5; // 5 frames = 167 ms reaction
  const fdir = path.join(require('os').tmpdir(), 'color-rings-frames-' + process.pid); fs.rmSync(fdir, { recursive: true, force: true }); fs.mkdirSync(fdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(600);
  await cdp.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
  let nf = 0;
  const frame = async (shot = true) => {
    await new Promise(res => { cdp.once('Emulation.virtualTimeBudgetExpired', res); cdp.send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: FRAME }); });
    if (shot) await page.screenshot({ path: path.join(fdir, 'f' + String(nf++).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 80 });
  };
  const vtouch = async (x, y) => { // real touch: down, hold one frame, up
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await frame();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  console.log('[browser run] timeline (game time):');
  for (let i = 0; i < 30; i++) await frame();           // title screen
  const bp = await page.locator('#bPlay').boundingBox();
  await vtouch(bp.x + bp.width / 2, bp.y + bp.height / 2);
  for (let i = 0; i < 25; i++) await frame();           // "tap to start"
  if (process.env.DEBUG) await page.evaluate(() => { window.__plog = []; });
  let taps = 0, lastTapFrame = -99, minGapFrames = 99; const timeline = []; let nextLog = 0, gameT0 = null;
  await vtouch(195, 600); taps++; lastTapFrame = nf;
  while (true) {
    const r = await page.evaluate(lat => window.__game.plan(lat, 0.02), REACT_FRAMES * FRAME / 1000);
    if (gameT0 == null) gameT0 = r.t;
    if (process.env.DEBUG) console.log('it', nf, r.t.toFixed(3), r.go, r.state, JSON.stringify(await page.evaluate(() => [Math.round(performance.now()), window.__game.debug().y | 0, window.__game.debug().vy | 0])));
    const el = r.t - gameT0;
    if (el >= nextLog) { const st = await page.evaluate(() => window.__game.state()); const last = st.obs[st.obs.length - 1]; timeline.push(`${el.toFixed(0).padStart(4)}s score ${String(st.score).padStart(3)} 難度 ${String(st.diff).padStart(2)}  newest obstacle: ${last.type.padEnd(6)} ω=${last.w}${last.type === 'bar' ? 'px/s' : 'rad/s'} (mode ${last.mode}) pass window ${Math.round(last.win * 1000)}ms`); console.log('   ' + timeline[timeline.length - 1]); nextLog += 10; }
    if (r.state !== 'play' || el > maxSeconds) break;
    if (r.go) {
      for (let k = 0; k < REACT_FRAMES; k++) await frame(); // reaction time passes, then the finger lands
      minGapFrames = Math.min(minGapFrames, nf - lastTapFrame);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150 + Math.random() * 90, y: 500 + Math.random() * 200 }] });
      taps++; lastTapFrame = nf;
      await frame();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else await frame();
  }
  const fin = await page.evaluate(() => window.__game.state());
  if (process.env.DEBUG) console.log('PLOG', JSON.stringify(await page.evaluate(() => window.__plog.slice(-30))), JSON.stringify(await page.evaluate(() => window.__game.debug())));
  for (let i = 0; i < 90; i++) await frame();           // shatter + game-over card
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  await ctx.close(); await browser.close();
  let mp4 = path.join(OUT, 'run.mp4');
  for (const f of ['run.mp4', 'run-2x.mp4', 'run-3x.mp4']) fs.rmSync(path.join(OUT, f), { force: true });
  const enc = (out, speed, crf) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS * speed), '-i', path.join(fdir, 'f%05d.jpg'), ...(speed > 1 ? ['-r', '30'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(crf), '-preset', 'medium', '-movflags', '+faststart', out]);
  enc(mp4, 1, 30);
  if (fs.statSync(mp4).size > 8e6) { fs.unlinkSync(mp4); mp4 = path.join(OUT, 'run-2x.mp4'); enc(mp4, 2, 31); }
  if (fs.statSync(mp4).size > 8e6) { fs.unlinkSync(mp4); mp4 = path.join(OUT, 'run-3x.mp4'); enc(mp4, 3, 32); }
  fs.rmSync(fdir, { recursive: true, force: true });
    console.log(`[browser run] final score ${fin.score}, 難度 ${fin.diff}, ended by ${fin.state === 'play' ? 'time cap' : 'crash'} after ${(fin.t - gameT0).toFixed(0)} s of play; ${taps} real CDP touches, reaction ${Math.round(REACT_FRAMES * FRAME)} ms, min gap between taps ${Math.round(minGapFrames * FRAME)} ms; video ${path.basename(mp4)} ${(fs.statSync(mp4).size / 1e6).toFixed(1)} MB (${nf} frames); console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  const args = process.argv.slice(2);
  const ok1 = collisionTest(), ok2 = fairnessTest(), ok3 = runGenerationTest();
  headlessBot();
  console.log(`[core summary] collision ${ok1 ? 'PASS' : 'FAIL'}, fairness ${ok2 ? 'PASS' : 'FAIL'}, prism/ramp ${ok3 ? 'PASS' : 'FAIL'}`);
  if (args.includes('--core-only')) return;
  const mi = args.indexOf('--max-seconds');
  await browserRun(mi >= 0 ? +args[mi + 1] : 240);
})();
