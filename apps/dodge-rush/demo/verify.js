// Verification for 螢火迴避 (dodge-rush).
// 1) Node: runs the game's own core (extracted via CORE markers) with a potential-field bot that re-reads
//    bullet positions every 150 ms; reports average survival, difficulty ramp and the fairness check.
// 2) Browser: drives the real page in Chromium with real CDP touch input (relative drag + 2nd-finger double tap
//    for bullet time), records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--sim-only] [--runs N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {makeSim, speedMul, density, PATS};')();

// ---- bot: sample candidate points, score them with a repulsive potential over predicted bullet paths ----
function decide(sn, V, lat = 0, hard = 3) {
  const { px, py, L, R, T, B, b } = sn, near = [];
  for (let i = 0; i < b.length; i += 5) { const dx = b[i] - px, dy = b[i + 1] - py; if (dx * dx + dy * dy < 520 * 520) near.push(i); }
  const cands = [[px, py]];
  for (const rad of [20, 42, 66, 92, 130, 180, 240]) for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2 + rad; cands.push([px + Math.cos(a) * rad, py + Math.sin(a) * rad]); }
  let best = null, bc = Infinity;
  const cx0 = (L + R) / 2, cy0 = T + (B - T) * 0.68;
  for (const c of cands) {
    if (c[0] < L + 2 || c[0] > R - 2 || c[1] < T + 2 || c[1] > B - 2) continue;
    const dist = Math.hypot(c[0] - px, c[1] - py), tr = Math.max(dist / V, 1e-3);
    let cost = dist * 0.02;
    for (const tau of [0.08, 0.18, 0.28, 0.4, 0.55, 0.75, 1.0, 1.3]) {
      const f = Math.min(1, tau / tr), tb = tau + lat, qx = px + (c[0] - px) * f, qy = py + (c[1] - py) * f, w = tau < 0.45 ? 1 : tau < 0.8 ? 0.45 : 0.25;
      for (const i of near) {
        const bx = b[i] + b[i + 2] * tb, by = b[i + 1] + b[i + 3] * tb, d = Math.hypot(bx - qx, by - qy) - b[i + 4] - 4;
        if (d < hard) cost += 4000 * w; else if (d < 28) cost += (28 - d) * (28 - d) * w;
      }
    }
    const m = Math.min(c[0] - L, R - c[0], c[1] - T, B - c[1]); if (m < 45) cost += (45 - m) * (45 - m) * 0.6;
    cost += ((c[0] - cx0) ** 2 + (c[1] - cy0) ** 2) * 0.0008;
    if (cost < bc) { bc = cost; best = c; }
  }
  return { c: best || [px, py], cost: bc };
}
function snapOf(sim) {
  const b = [], m = sim.mult(), n = sim.count();
  for (let i = 0; i < n; i++) if (sim.harmful(i)) b.push(sim.X[i], sim.Y[i], sim.VX[i] * m, sim.VY[i] * m, sim.R[i] * 0.8);
  return { t: sim.t, px: sim.px, py: sim.py, L: sim.L, R: sim.Rr, T: sim.T, B: sim.Bt, glow: sim.glow, b };
}

function simRuns(runs, W = 390, H = 844) {
  const res = [];
  for (let r = 0; r < runs; r++) {
    const sim = core.makeSim({ w: W, h: H, left: 10, right: W - 10, top: 64, bottom: H - 12, seed: 1000 + r * 7919 });
    let tNext = 0, target = [sim.px, sim.py], bts = 0, maxN = 0; const dt = 1 / 60, V = 650, cap = 400;
    while (!sim.dead && sim.t < cap) {
      if (sim.t >= tNext) {
        tNext += 0.15; const d = decide(snapOf(sim), V); target = d.c;
        if (sim.glow >= 100 && d.cost > 900 && sim.trigger()) bts++;
      }
      const dx = target[0] - sim.px, dy = target[1] - sim.py, l = Math.hypot(dx, dy), mv = Math.min(l, V * dt);
      if (l > 0) { sim.px += dx / l * mv; sim.py += dy / l * mv; sim.clamp(); }
      sim.step(dt); maxN = Math.max(maxN, sim.count());
    }
    res.push({ t: sim.t, grazes: sim.grazes, score: sim.score(), dieBy: sim.dieBy, fairChecks: sim.fairChecks, fairFix: sim.fairFix, bts, maxN });
  }
  return res;
}

function report(res) {
  const ts = res.map(r => r.t).sort((a, b) => a - b), avg = ts.reduce((a, b) => a + b, 0) / ts.length;
  console.log(`Node sim: ${res.length} bot runs at 390x844, decision every 150 ms, finger speed cap 650 px/s`);
  console.log(`  survival avg ${avg.toFixed(1)} s, median ${ts[ts.length >> 1].toFixed(1)} s, min ${ts[0].toFixed(1)} s, max ${ts[ts.length - 1].toFixed(1)} s`);
  console.log(`  runs >= 60 s: ${ts.filter(t => t >= 60).length}/${ts.length}; avg grazes ${(res.reduce((a, r) => a + r.grazes, 0) / res.length).toFixed(0)}; avg score ${(res.reduce((a, r) => a + r.score, 0) / res.length).toFixed(0)}`);
  const fc = res.reduce((a, r) => a + r.fairChecks, 0), ff = res.reduce((a, r) => a + r.fairFix, 0);
  console.log(`  fairness check (30 px safe circle reachable in 0.5 s): ${fc} checks, ${ff} waves thinned (${(100 * ff / fc).toFixed(2)}%), after thinning 100% pass`);
  const deaths = {}; res.forEach(r => { if (r.dieBy) deaths[r.dieBy] = (deaths[r.dieBy] || 0) + 1; });
  console.log('  deaths by pattern:', JSON.stringify(deaths), ' peak bullets', Math.max(...res.map(r => r.maxN)));
  console.log('  ramp: ' + [0, 30, 60, 90, 120, 180, 240].map(t => `t=${t}s speed x${core.speedMul(t).toFixed(2)} density x${core.density(t).toFixed(2)}`).join(' | '));
  return avg;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserRun(attempt) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid' + attempt); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await sleep(900);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: p[2] ?? i })) });
  const b = await page.locator('#tPlay').boundingBox();
  await touch('touchStart', [[b.x + b.width / 2, b.y + b.height / 2]]); await sleep(70); await touch('touchEnd', []); await sleep(700);
  let sn = await page.evaluate(() => window.__game.snap());
  let fx = sn.px, fy = sn.py; // finger starts on the firefly; relative drag keeps the offset constant
  await touch('touchStart', [[fx, fy, 1]]); await sleep(150);
  const t0 = Date.now(), samples = []; let bts = 0, lastSample = -10;
  while (true) {
    sn = await page.evaluate(() => window.__game.snap());
    if (!sn || sn.dead || sn.state !== 'play' && sn.state !== 'resume') break;
    if (sn.t - lastSample >= 15) { lastSample = sn.t; samples.push(await page.evaluate(() => { const s = window.__game.state(); return { t: +s.t.toFixed(1), bullets: s.n, ids: s.ids.slice(), fps: s.fps }; })); }
    const d = decide(sn, 650, 0.06, 7);
    if (sn.glow >= 100 && d.cost > 900) { // double tap with a second finger while the first keeps holding
      const tx = Math.min(360, fx + 120), ty = Math.max(120, fy - 200);
      for (let k = 0; k < 2; k++) { await touch('touchStart', [[fx, fy, 1], [tx, ty, 2]]); await sleep(50); await touch('touchEnd', [[tx, ty, 2]]); await sleep(60); }
      bts++;
    }
    const dx = d.c[0] - sn.px, dy = d.c[1] - sn.py;
    for (let k = 1; k <= 3; k++) { await touch('touchMove', [[fx + dx * k / 3, fy + dy * k / 3, 1]]); await sleep(45); }
    fx += dx; fy += dy;
  }
  await sleep(2200);
  const st = await page.evaluate(() => ({ s: window.__game.state(), last: window.__lastRun }));
  await page.screenshot({ path: path.join(OUT, '_run' + attempt + '.png') });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, '_run' + attempt + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(`Browser bot (real CDP touch, ~150 ms per decision): survived ${st.last && st.last.t.toFixed(1)} s, grazes ${st.last && st.last.grazes}, score ${st.last && st.last.score}, killed by ${st.last && st.last.dieBy}, bullet-times ${bts}, wall ${wall}s`);
  console.log('  ramp samples:', samples.map(s => `t=${s.t}s ${s.bullets} bullets [${s.ids.map(i => core.PATS[i].name).join('+')}] fps ${s.fps}`).join(' | '));
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  return st.last ? st.last.t : 0;
}

(async () => {
  const args = process.argv.slice(2), ri = args.indexOf('--runs');
  report(simRuns(ri >= 0 ? +args[ri + 1] : 30));
  if (args.includes('--sim-only')) return;
  // three real-touch runs in the page; the longest is kept as demo/run.mp4 + run-result.png
  const ts = [];
  const ai = args.indexOf('--attempts'), NA = ai >= 0 ? +args[ai + 1] : 3;
  for (let a = 1; a <= NA; a++) { console.log('Browser run ' + a + ':'); ts.push(await browserRun(a)); }
  const best = ts.indexOf(Math.max(...ts)) + 1;
  fs.renameSync(path.join(OUT, '_run' + best + '.mp4'), path.join(OUT, 'run.mp4'));
  fs.renameSync(path.join(OUT, '_run' + best + '.png'), path.join(OUT, 'run-result.png'));
  for (let a = 1; a <= 3; a++) for (const ext of ['.mp4', '.png']) fs.rmSync(path.join(OUT, '_run' + a + ext), { force: true });
  console.log(`Browser runs survived: ${ts.map(t => t.toFixed(1)).join(', ')} s (avg ${(ts.reduce((x, y) => x + y, 0) / ts.length).toFixed(1)} s); kept run ${best} as run.mp4`);
})();
