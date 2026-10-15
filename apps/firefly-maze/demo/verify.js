// Verification for 螢火迷宮 (firefly-maze).
// 1) Headless check of all 100 levels with the game's own core (extracted from index.html):
//    maze connected, no dead ends (also for moths that cannot reverse, in both hedge states), mechanics present,
//    difficulty strictly increasing.
// 2) Real page in Chromium: the auto-player (demo/bot.js) clears levels 50, 75, 99, 100 using real touch swipes
//    (CDP Input.dispatchTouchEvent) at human pace: every swipe is decided from a page snapshot and registers
//    >=150 ms later; >=150 ms between swipes. Up to 5 attempts per level; records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--check-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const B = require('./bot.js');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const C = B.loadCore(APP);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function checkAll() {
  let prevD = 0, prevRaw = 0, ok = true;
  const src = fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  const X = new Function(src + '\nreturn {checkMaze, buildLevel, params, MECHS};')();
  const rows = [];
  for (let n = 1; n <= 100; n++) {
    const L = X.buildLevel(n), P = L.P;
    const e0 = X.checkMaze(L, 0), e1 = X.checkMaze(L, 1);
    const has = { gate: L.gate.some(v => v >= 0), hedge: L.tog.some(v => v >= 0), flower: L.flw.some(v => v >= 0) };
    let bad = [];
    if (e0 || e1) bad.push('maze ' + (e0 || e1));
    if (P.D <= prevD || P.Draw <= prevRaw) bad.push('difficulty not increasing');
    for (const k of ['gate', 'hedge', 'flower']) if (P.mech[k] !== has[k]) bad.push('mechanic ' + k);
    if ((P.mech.twoPow ? 2 : 4) !== L.pw.length) bad.push('orbs');
    if (bad.length) { ok = false; console.log('LEVEL', n, 'PROBLEM', bad.join(', ')); }
    prevD = P.D; prevRaw = P.Draw;
    rows.push({ n, D: P.D, size: L.w + 'x' + L.h, moths: P.k, dots: L.total, r: P.r.toFixed(3), T: P.T.toFixed(2), mech: P.mc });
  }
  console.log('All 100 levels: connected, no dead ends (both hedge states, moth no-reverse rule), mechanics present, difficulty strictly increasing:', ok);
  for (const n of [1, 9, 18, 27, 36, 45, 50, 55, 70, 75, 85, 99, 100]) { const r = rows[n - 1]; console.log(`  L${n}: D=${r.D} maze ${r.size} dots ${r.dots} moths ${r.moths} speed ${r.r} panic ${r.T}s mechanics ${r.mech}`); }
  return ok;
}

async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// One finger stays on the glass and slides 34px in the wanted direction for each command (the page re-arms its
// 20px swipe threshold after every registered direction), like a player sliding a thumb around; the finger is
// lifted and re-centred when it drifts toward the screen edge.
const finger = { down: false, x: 0, y: 0 };
async function swipe(cdp, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d];
  if (!finger.down) { finger.x = 195; finger.y = 560; finger.down = true; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: finger.x, y: finger.y }] }); }
  finger.x += DX * 34; finger.y += DY * 34;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: finger.x, y: finger.y }] });
}
async function recentre(cdp) {
  if (finger.down && (finger.x < 80 || finger.x > 310 || finger.y < 380 || finger.y > 760)) {
    finger.down = false; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
}
async function attempt(browser, n, k) {
  const vdir = path.join(OUT, '_vid' + n + '_' + k); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(200); }
  const L = C.buildLevel(n), bot = B.makeBot(C, L, {});
  let trace = [], lastLives = 3, latEst = 12, compMs = [], snapMs = [], swMs = [], lastSwipe = 0, swipes = 0, lats = [], status = '', t0 = Date.now(), minGap = 1e9, minReact = 1e9;
  while (Date.now() - t0 < 420000) {
    const snapT = Date.now();
    const snap = await page.evaluate(() => window.__game.snap());
    if (!snap) { await sleep(50); continue; }
    status = snap.status;
    if (status === 'won' || status === 'lost') break;
    if (status !== 'play' && status !== 'ready') { await sleep(40); continue; }
    snap.dots = Uint8Array.from(snap.dots);
    const tc0 = Date.now();
    const r = B.decide(C, L, bot, snap, Math.round(latEst), -99);
    compMs.push(Date.now() - tc0); snapMs.push(tc0 - snapT);
    if (process.env.TRACE) { const pl = snap.pl; trace.push(snap.tick + ' ' + snap.status + ' P' + (pl.t % L.w) + ',' + ((pl.t / L.w) | 0) + 'd' + pl.d + 'p' + pl.p.toFixed(2) + ' des' + pl.des + ' lives' + snap.lives + ' best ' + (r.best ? r.best.kind + r.best.dir + '@' + r.best.ticks + ' v' + Math.round(r.best.v) : '-') + ' press ' + r.press + ' latEst ' + latEst.toFixed(1));
      if (snap.lives < lastLives) { console.log('--- death'); console.log(trace.slice(-14).join('\n')); } lastLives = snap.lives; }
    if (r.press >= 0) {
      // human pace: >=150 ms reaction from the observed frame, >=150 ms between swipes
      const wait = Math.max(snapT + 150 - Date.now(), lastSwipe + 150 - Date.now(), 0);
      if (wait) await sleep(wait);
      const s0 = Date.now();
      if (lastSwipe) minGap = Math.min(minGap, s0 - lastSwipe);
      await swipe(cdp, r.press); lastSwipe = s0; swipes++; swMs.push(Date.now() - s0);
      const info = await page.evaluate(() => window.__game.info());
      await recentre(cdp);
      if (info.lastIn >= 0) { const lt = info.lastIn - snap.tick; lats.push(lt); latEst = Math.max(9, Math.min(30, latEst * 0.7 + lt * 0.3)); }
      minReact = Math.min(minReact, s0 - snapT);
    } else await sleep(15);
  }
  if (finger.down) { finger.down = false; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  const won = status === 'won';
  await sleep(won ? 2600 : 1500);
  const winVisible = await page.isVisible('#win');
  const fin = await page.evaluate(() => window.__game.snap());
  if (won) await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const secs = (Date.now() - t0) / 1000;
  let mp4 = null;
  if (won) {
    // keep each mp4 small: speed up long runs
    const speed = secs > 100 ? 4 : secs > 50 ? 2 : 1;
    mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
    for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') && f.endsWith('.mp4') || f.startsWith('level-' + n + '-') && f.endsWith('x.mp4')) fs.rmSync(path.join(OUT, f));
    const vf = speed > 1 ? ['-vf', 'setpts=PTS/' + speed + ',fps=30'] : ['-vf', 'fps=30'];
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', '-an', mp4]);
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  lats.sort((a, b) => a - b); const med = a => { a = a.slice().sort((x, y) => x - y); return a[a.length >> 1]; };
  if (process.env.DEBUG) console.log('snapMs', med(snapMs), 'compMs', med(compMs), 'swipeMs', med(swMs), 'lat p10/p50/p90', lats[lats.length * 0.1 | 0], lats[lats.length >> 1], lats[lats.length * 0.9 | 0]);
  return { n, attempt: k, cleared: won && winVisible, deaths: fin && fin.deaths, score: fin && fin.score, secs: secs.toFixed(1), swipes, minGapMs: minGap, minReactMs: minReact, medianLatencyTicks: lats[lats.length >> 1], errors, mp4: mp4 && path.basename(mp4), mp4KB: mp4 && Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = checkAll();
  if (args.includes('--check-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    for (let k = 1; k <= (+process.env.ATTEMPTS || 5); k++) {
      const r = await attempt(browser, n, k);
      console.log('BOT level', n, 'attempt', k, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'deaths', r.deaths, 'score', r.score, 'time', r.secs + 's', 'swipes', r.swipes,
        'min gap', r.minGapMs + 'ms', 'min reaction', r.minReactMs + 'ms', 'median snapshot->input', r.medianLatencyTicks, 'ticks', r.mp4 ? r.mp4 + ' ' + r.mp4KB + 'KB' : '', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
      if (r.cleared) break;
    }
  }
  await browser.close();
})();
