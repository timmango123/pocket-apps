// Verification for 隕石風暴 (asteroid-storm), an endless wave game.
// 1) Prints the difficulty ramp per wave using the game's own core code (CORE-START/CORE-END markers).
// 2) An auto-player drives the real page in Chromium with real two-finger touch input (CDP Input.dispatchTouchEvent):
//    left thumb = move stick, right thumb = aim/fire stick. It re-reads the screen state and re-decides only every
//    150 ms (human reaction), picks the nearest/most threatening target with lead aim, and dodges by sampling
//    thrust directions against the predicted motion of every hazard (a short-horizon potential field).
//    Records demo/run.mp4 (sped up) + demo/run-result.png and prints the per-wave log.
// Usage: node verify.js [--table-only] [--max-min=N] [--no-video]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {waveConfig, waveHits, CFG};')();
const args = process.argv.slice(2);
const MAXMIN = +((args.find(a => a.startsWith('--max-min=')) || '').split('=')[1] || 6);
const VIDEO = !args.includes('--no-video');

function table() {
  console.log('wave | large | speed | ships | metal | expl | storm | special | hits needed | difficulty');
  for (let w = 1; w <= 24; w++) {
    const c = core.waveConfig(w);
    console.log(String(w).padStart(4), '|', String(c.large).padStart(5), '|', c.speed.toFixed(1).padStart(5), '|', String(c.enemies).padStart(5), '|',
      (c.metal * 100).toFixed(0).padStart(4) + '%', '|', (c.expl * 100).toFixed(0).padStart(3) + '%', '|', (c.storm ? 'yes' : '-').padStart(5), '|',
      (c.boss ? 'BOSS hp' + c.bossHp : c.rest ? 'rest' : '').padEnd(7), '|', String(core.waveHits(c)).padStart(11), '|', c.difficulty);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const wd = (d, s) => d > s / 2 ? d - s : d < -s / 2 ? d + s : d;
const BS = core.CFG.bulletSpeed, BL = core.CFG.bulletLife;

// ---- decision: one call per 150 ms ----
const DIRS = []; for (let i = 0; i < 16; i++) DIRS.push([Math.cos(i / 16 * Math.PI * 2), Math.sin(i / 16 * Math.PI * 2)]);
function decide(st) {
  const s = st.ship, WW = st.WW, WH = st.WH;
  const hz = [];
  for (const r of st.rocks) if (!r[5]) hz.push({ x: r[0], y: r[1], vx: r[2], vy: r[3], r: r[4] * (r[6] ? 0.92 : 0.86) });
  for (const e of st.enemies) if (!e[4]) hz.push({ x: e[0], y: e[1], vx: e[2], vy: e[3], r: 12 });
  for (const b of st.ebul) hz.push({ x: b[0], y: b[1], vx: b[2], vy: b[3], r: 3 });
  // relative coordinates (ship at origin), wrapped
  for (const h of hz) { h.px = wd(h.x - s.x, WW); h.py = wd(h.y - s.y, WH); }
  // --- movement: evaluate candidate thrusts over a 1 s horizon ---
  const cands = [[0, 0, 0]].concat(DIRS.map(d => [d[0], d[1], 1]), DIRS.filter((_, i) => i % 2 === 0).map(d => [d[0], d[1], 0.5]));
  let best = null, bestCost = Infinity;
  const near = hz.filter(h => Math.hypot(h.px, h.py) < 330);
  for (const c of cands) {
    let x = 0, y = 0, vx = s.vx, vy = s.vy, cost = 0;
    const dt = 0.08;
    for (let k = 1; k <= 13; k++) {
      const t = k * dt;
      vx += c[0] * c[2] * 600 * dt; vy += c[1] * c[2] * 600 * dt;
      const dmp = Math.exp(-1.2 * dt); vx *= dmp; vy *= dmp;
      const sp = Math.hypot(vx, vy); if (sp > 320) { vx *= 320 / sp; vy *= 320 / sp; }
      x += vx * dt; y += vy * dt;
      const wt = 1.3 - t;
      for (const h of near) {
        const cl = Math.hypot(h.px + h.vx * t - x, h.py + h.vy * t - y) - h.r - 9;
        if (cl < 0) cost += 4000 * wt;
        else if (cl < 34) cost += (34 - cl) * (34 - cl) * 0.6 * wt;
      }
    }
    cost += Math.hypot(vx, vy) * 0.08 + c[2] * 2;   // prefer calm flight
    if (cost < bestCost) { bestCost = cost; best = c; }
  }
  // drift toward a power-up when it is safe
  let move = best;
  if (bestCost < 20 && st.pus.length) {
    let pb = null, pd = 1e9;
    for (const p of st.pus) { const dx = wd(p[0] - s.x, WW), dy = wd(p[1] - s.y, WH), d = Math.hypot(dx, dy); if (d < pd) { pd = d; pb = [dx / d, dy / d]; } }
    if (pd < 260) move = [pb[0], pb[1], 0.7];
  }
  // --- aim: most urgent target with lead (account for our own 150 ms latency) ---
  const L = 0.15, sx = s.vx * L, sy = s.vy * L;
  let tgt = null, tc = Infinity;
  const consider = (x, y, vx, vy, r, bonus) => {
    const px = wd(x - s.x, WW) + vx * L - sx, py = wd(y - s.y, WH) + vy * L - sy;
    const a = vx * vx + vy * vy - BS * BS, b = 2 * (px * vx + py * vy), cc = px * px + py * py;
    const disc = b * b - 4 * a * cc; if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / (2 * a); if (!(t > 0) || t > BL - 0.05) return;
    const rvx = vx - s.vx, rvy = vy - s.vy, vv = rvx * rvx + rvy * rvy;
    const tca = vv > 1 ? Math.max(0, -(px * rvx + py * rvy) / vv) : 9;
    const dmin = Math.hypot(px + rvx * Math.min(tca, 3), py + rvy * Math.min(tca, 3));
    let cost = t - (dmin < r + 50 ? 0.4 / (0.4 + tca) : 0) - bonus;
    if (cost < tc) { tc = cost; tgt = Math.atan2(py + vy * t, px + vx * t); }
  };
  for (const r of st.rocks) if (!r[5]) consider(r[0], r[1], r[2], r[3], r[4], r[6] ? -0.1 : 0);
  for (const e of st.enemies) if (!e[4]) consider(e[0], e[1], e[2], e[3], 12, 0.35);
  return { move, aim: tgt };
}

async function run() {
  const vdir = path.join(OUT, '_vid'); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark',
    ...(VIDEO ? { recordVideo: { dir: vdir, size: { width: 390, height: 844 } } } : {}) });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  const b = await page.locator('#bStart').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 9 }] });
  await sleep(80); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(600);
  // two thumbs down
  const LA = { x: 95, y: 690 }, RA = { x: 295, y: 690 }, R = 56;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...LA, id: 1 }] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...LA, id: 1 }, { ...RA, id: 2 }] });
  // frame-rate probe: count rAF callbacks per second for the whole run
  await page.evaluate(() => { window.__fps = []; let n = 0, t = performance.now(); (function f(now) { n++; if (now - t >= 1000) { window.__fps.push({ n, w: window.__game.state().w }); n = 0; t = now; } requestAnimationFrame(f); })(performance.now()); });
  const t0 = Date.now(); let lastW = 0; const log = []; let ticks = 0, maxParts = 0; const shots = {};
  let st;
  while (true) {
    const tick = Date.now();
    st = await page.evaluate(() => window.__game.state());
    if (st.st === 'over') break;
    if (st.w !== lastW) {
      const c = core.waveConfig(st.w);
      log.push({ w: st.w, t: ((Date.now() - t0) / 1000).toFixed(0), score: st.score, lives: st.lives, rocks: st.rocks.length, speed: c.speed.toFixed(0), ships: c.enemies });
      console.log(`wave ${st.w} at ${log[log.length - 1].t}s  score ${st.score}  lives ${st.lives}  rocks ${st.rocks.length}  speed ${c.speed.toFixed(0)}  ships ${c.enemies}${c.boss ? '  BOSS' : ''}${c.rest ? '  rest' : ''}`);
      lastW = st.w;
    }
    maxParts = Math.max(maxParts, st.parts);
    if (!shots[st.w] && st.waveState === 'fight' && st.rocks.length > 10 && !st.ship.dead && Date.now() - t0 > 8000) {
      shots[st.w] = 1; await page.screenshot({ path: path.join(process.env.SHOTDIR || OUT, `_wave-${st.w}.png`) });
    }
    if ((Date.now() - t0) / 60000 > MAXMIN) break;
    const d = decide(st);
    const m = d.move[2] ? R * (d.move[2] === 1 ? 0.98 : 0.55) : 0;
    const lp = { x: LA.x + d.move[0] * m, y: LA.y + d.move[1] * m, id: 1 };
    const rp = d.aim === null ? { ...RA, id: 2 } : { x: RA.x + Math.cos(d.aim) * R * 0.8, y: RA.y + Math.sin(d.aim) * R * 0.8, id: 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [lp, rp] });
    ticks++;
    const spent = Date.now() - tick; if (spent < 150) await sleep(150 - spent);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const alive = st.st !== 'over', capState = st;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  if (alive) {  // time cap reached: lift both thumbs and let the storm win, to show the game-over screen
    console.log(`time cap: bot alive at wave ${st.w}, score ${st.score}, lives ${st.lives}; hands off until game over`);
    for (let k = 0; k < 600; k++) { await sleep(200); if ((await page.evaluate(() => window.__game.state().st)) === 'over') break; }
  }
  await sleep(1800);
  const fin = await page.evaluate(() => window.__game.state());
  const fpsLog = await page.evaluate(() => window.__fps);
  const late = fpsLog.filter(x => x.w >= 13).map(x => x.n).sort((a, b) => a - b);
  const fps = late.length ? `median ${late[late.length >> 1]}, 5th pct ${late[Math.floor(late.length * 0.05)]} over ${late.length} s of waves >= 13` : 'n/a';
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  await ctx.close(); await browser.close();
  let mp4 = null;
  if (VIDEO) {
    const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
    mp4 = path.join(OUT, 'run-4x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', 'setpts=PTS/4,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log('---');
  console.log(`RESULT: bot ${alive ? 'still alive at the ' + MAXMIN + '-min cap (lives ' + capState.lives + ')' : 'lost its last life'} after ${secs}s of play, reached wave ${capState.w}, score ${capState.score}, kills ${fin.kills}, accuracy ${Math.round(fin.hits / Math.max(1, fin.shots) * 100)}%, max combo ${fin.maxCombo}`);
  console.log(`bot decisions: ${ticks} (every >=150 ms), peak particles ${maxParts}, rAF fps ${fps} (while recording video)`);
  if (mp4) console.log('video', path.basename(mp4), Math.round(fs.statSync(mp4).size / 1024) + 'KB');
  console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no console errors');
}

(async () => {
  table();
  if (args.includes('--table-only')) return;
  await run();
})();
