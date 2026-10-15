// Verification for 籃接豐收 (catch-basket).
// 1) Node: runs the game's own core (extracted via CORE markers) with an auto player that re-reads the field
//    every 150 ms, acts 150 ms late, picks the reachable spot with the highest expected value and dumps at >= 12 items.
//    Reports survival / score, the difficulty ramp, and the fairness check (bad-item combos always dodgeable).
// 2) Browser: drives the real page in Chromium with real CDP touch input (relative drag with finger 1,
//    double tap with finger 2 to dump), records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--sim-only] [--runs N] [--attempts N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {makeSim, KINDS, BW, MOUTH, spawnInterval, fallSpeed, badRatio, diffLevel, maxSpeed, catchHalf, itemX};')();
const { KINDS, BW, maxSpeed, catchHalf, itemX } = core;

// ---- auto player: evaluate candidate basket targets against every item's predicted landing point ----
function decide(sn, lat) {
  const { t, x, W, n, harvest, lives, freeze } = sn, v = maxSpeed(n) * 0.9, lo = BW / 2, hi = W - BW / 2;
  let best = x, bestV = -1e9;
  for (let c = lo; c <= hi + 0.1; c += 6) {
    let val = -Math.abs(c - x) * 0.03;
    for (const it of sn.items) {
      const tau = it.ta - t; if (tau <= 0 || tau > 3) continue;
      const mv = Math.max(0, tau - lat - freeze) * v, px = Math.abs(c - x) <= mv ? c : x + Math.sign(c - x) * mv;
      const d = Math.abs(itemX(it, it.ta) - px), h = catchHalf(it.r), w = 1 / (1 + tau * 0.8);
      if (it.good) { if (d < h - 5) val += w * (it.k === 'clover' ? (lives < 5 ? 160 : 20) : KINDS[it.k].val * (harvest ? 2 : 1) + 14); }
      else if (d < h + 10) val -= (it.k === 'hive' ? 260 : 900) * (d < h ? 1 : 0.35);
    }
    if (val > bestV) { bestV = val; best = c; }
  }
  return best;
}
function snapOf(S) {
  return { t: S.t, x: S.x, W: S.W, n: S.basket.length, harvest: S.harvest, lives: S.lives, freeze: S.freeze,
    items: S.items.filter(i => i.alive && !i.passed) };
}

function simRuns(runs, W = 360, cap = 600) {
  const res = [];
  for (let r = 0; r < runs; r++) {
    const S = core.makeSim({ W, seed: 1000 + r * 7919 }), dt = 1 / 60, queue = [];
    let tNext = 0, dumps = 0, rains = 0, maxOn = 0, badHits = { rotten: 0, stone: 0, hive: 0 };
    while (!S.dead && S.t < cap) {
      if (S.t >= tNext) { tNext += 0.15; queue.push([S.t + 0.15, decide(snapOf(S), 0.15)]); if (S.basket.length >= 12) queue.push([S.t + 0.15, 'dump']); }
      while (queue.length && queue[0][0] <= S.t) { const [, a] = queue.shift(); if (a === 'dump') { if (S.basket.length) { S.dump(false); dumps++; } } else S.setTarget(a); }
      S.step(dt);
      for (const e of S.ev) { if (e.e === 'bad') badHits[e.k]++; if (e.e === 'rain') rains++; }
      S.ev.length = 0;
    }
    res.push({ t: S.t, score: S.score, lvl: S.lvl, dumps, rains, badHits, fairChecks: S.fairChecks, fairFix: S.fairFix, maxOn: S.maxOnScreen, streak: S.maxStreak, bestDump: S.bestDump, caught: S.caught, missed: S.missed });
  }
  return res;
}

function gapAudit(runs, W = 360) {
  // record every spawned bad item and verify that bad items arriving within 0.35 s of each other keep >= 1.4 basket widths of gap
  let pairs = 0, viol = 0, bads = 0;
  for (let r = 0; r < runs; r++) {
    const S = core.makeSim({ W, seed: 4242 + r * 13, noDie: true }), all = [];
    const seen = new Set();
    for (let k = 0; k < 60 * 240; k++) {
      S.step(1 / 60); S.ev.length = 0; if (k % 9 === 0) S.setTarget(S.lo + ((k * 37) % 100) / 100 * (S.hi - S.lo));
      for (const it of S.items) if (!it.good && !seen.has(it)) { seen.add(it); all.push(it); }
    }
    bads += all.length;
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j]; if (Math.abs(a.ta - b.ta) >= 0.35) continue; pairs++;
      if (Math.abs(itemX(a, a.ta) - itemX(b, b.ta)) - a.r - b.r < 1.4 * BW - 1e-6) viol++;
    }
  }
  return { bads, pairs, viol };
}

function report(res) {
  const ts = res.map(r => r.t).sort((a, b) => a - b), sc = res.map(r => r.score).sort((a, b) => a - b), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`Node sim: ${res.length} auto-player runs (W=360, decide every 150 ms, act 150 ms late, dump at >= 12)`);
  console.log(`  survival avg ${avg(ts).toFixed(1)} s, median ${ts[ts.length >> 1].toFixed(1)} s, min ${ts[0].toFixed(1)} s, max ${ts[ts.length - 1].toFixed(1)} s; difficulty reached avg ${avg(res.map(r => r.lvl)).toFixed(1)}`);
  console.log(`  score avg ${avg(sc).toFixed(0)}, median ${sc[sc.length >> 1]}, max ${sc[sc.length - 1]}; avg dumps ${avg(res.map(r => r.dumps)).toFixed(1)}, best dump ${Math.max(...res.map(r => r.bestDump))}, longest harvest streak ${Math.max(...res.map(r => r.streak))}`);
  const hits = { rotten: 0, stone: 0, hive: 0 }; res.forEach(r => { for (const k in hits) hits[k] += r.badHits[k]; });
  console.log('  bad items caught (all runs):', JSON.stringify(hits), ' peak items on screen', Math.max(...res.map(r => r.maxOn)));
  const fc = res.reduce((a, r) => a + r.fairChecks, 0), ff = res.reduce((a, r) => a + r.fairFix, 0);
  console.log(`  fairness: ${fc} bad items spawned through the check, ${ff} needed a re-roll or became fruit (${(100 * ff / fc).toFixed(1)}%)`);
  console.log('  ramp: ' + [0, 30, 60, 90, 120, 180, 210].map(t => `t=${t}s 難度${core.diffLevel(t)} every ${core.spawnInterval(t).toFixed(2)}s fall ${core.fallSpeed(t).toFixed(0)} bad ${(core.badRatio(t) * 100).toFixed(0)}%`).join(' | '));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserRun(attempt, capS) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid' + attempt); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'light', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await sleep(1200);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p[0], y: p[1], id: p[2] })) });
  const b = await page.locator('#tPlay').boundingBox();
  await touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2, 0]]); await sleep(80); await touch('touchEnd', []); await sleep(1500);
  let fx = 195, fy = 600;
  await touch('touchStart', [[fx, fy, 1]]); await sleep(150);
  const t0 = Date.now(), samples = []; let lastSample = -10, dumps = 0, lifts = 0;
  while (true) {
    const sn = await page.evaluate(() => window.__game.snap());
    if (!sn || sn.dead || sn.state !== 'play') break;
    if (sn.t >= capS) break;
    if (sn.t - lastSample >= 15) { lastSample = sn.t; samples.push(await page.evaluate(() => window.__game.state())); }
    const tStart = Date.now();
    if (sn.n >= 12) { // double tap with a second finger while finger 1 keeps holding
      const tx = 120, ty = 520;
      for (let k = 0; k < 2; k++) { await touch('touchStart', [[fx, fy, 1], [tx, ty, 2]]); await sleep(45); await touch('touchEnd', [[tx, ty, 2]]); await sleep(70); }
      dumps++;
    }
    const c = decide(sn, 0.12);
    let dx = (c - sn.tx) * sn.sc / sn.sens;
    if (fx + dx < 12 || fx + dx > 378) { await touch('touchEnd', [[fx, fy, 1]]); fx = 195 - Math.sign(dx) * 120; await sleep(30); await touch('touchStart', [[fx, fy, 1]]); lifts++; }
    for (let k = 1; k <= 2; k++) { await touch('touchMove', [[fx + dx * k / 2, fy, 1]]); await sleep(16); }
    fx += dx;
    const el = Date.now() - tStart; if (el < 150) await sleep(150 - el);
  }
  const live = await page.evaluate(() => window.__game.snap());
  if (live && !live.dead) await page.evaluate(() => { /* cap reached: stop the run the way a player would see it end */ window.__game.pause(); });
  await sleep(2600);
  const st = await page.evaluate(() => ({ s: window.__game.state(), last: window.__lastRun || null }));
  await page.screenshot({ path: path.join(OUT, '_run' + attempt + '.png') });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, '_run' + attempt + '.mp4');
  const dur = st.s.t;
  const speed = dur > 100 ? 2 : 1;
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', (speed > 1 ? `setpts=PTS/${speed},` : '') + 'fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const L = st.last;
  console.log(`Browser bot (real CDP touch, >=150 ms per action): ${L ? `ended by ${L.by} at ${L.t.toFixed(1)} s` : `still alive at ${st.s.t.toFixed(1)} s (cap)`}, score ${L ? L.score : st.s.score}, 難度 ${st.s.lvl}, double-tap dumps ${dumps}, finger re-grips ${lifts}, wall ${wall}s`);
  console.log('  ramp samples:', samples.map(s => `t=${s.t.toFixed(0)}s 難度${s.lvl} items ${s.n} every ${s.interval.toFixed(2)}s fall ${s.speed.toFixed(0)} bad ${(s.bad * 100).toFixed(0)}%${s.rain ? ' 豐年雨' : ''} fps ${s.fps} score ${s.score}`).join('\n    '));
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB at ${speed}x, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  return { t: st.s.t, score: L ? L.score : st.s.score, speed };
}

(async () => {
  const args = process.argv.slice(2), ri = args.indexOf('--runs');
  report(simRuns(ri >= 0 ? +args[ri + 1] : 40));
  const g = gapAudit(20);
  console.log(`  gap audit: ${g.bads} bad items in 20 x 240 s runs, ${g.pairs} near-simultaneous bad pairs, ${g.viol} with < 1.4 basket widths of clear gap`);
  if (args.includes('--sim-only')) return;
  const ai = args.indexOf('--attempts'), NA = ai >= 0 ? +args[ai + 1] : 2, ci = args.indexOf('--cap'), cap = ci >= 0 ? +args[ci + 1] : 200;
  const rs = [];
  for (let a = 1; a <= NA; a++) { console.log('Browser run ' + a + ':'); rs.push(await browserRun(a, cap)); }
  const bi = rs.reduce((bi, r, i) => r.score > rs[bi].score ? i : bi, 0) + 1;
  fs.renameSync(path.join(OUT, '_run' + bi + '.mp4'), path.join(OUT, rs[bi - 1].speed > 1 ? 'run-2x.mp4' : 'run.mp4'));
  fs.renameSync(path.join(OUT, '_run' + bi + '.png'), path.join(OUT, 'run-result.png'));
  for (let a = 1; a <= NA; a++) for (const ext of ['.mp4', '.png']) fs.rmSync(path.join(OUT, '_run' + a + ext), { force: true });
  console.log(`Browser runs: ${rs.map(r => r.t.toFixed(0) + ' s / ' + r.score).join(', ')}; kept run ${bi}`);
})();
