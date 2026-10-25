// Verification for 霓虹冰球 (air-hockey).
// 1) Node: extracts the game's own core (CORE-START/END) and checks the difficulty index D is strictly increasing over
//    100 levels, then plays 10 headless matches per level (50/75/99/100) of the auto-player vs the real AI.
//    The auto-player only sees the table as it was >=150 ms ago and moves its finger at <=2600 px/s.
// 2) Browser: drives the real page in Chromium (390x844, touch) with CDP Input.dispatchTouchEvent, using the same
//    auto-player at the same 150 ms perception lag, and clears levels 50/75/99/100, recording mp4 + result png.
// Usage: node verify.js [--sim-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { makeBot } = require('./bot.js');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {newMatch, stepMatch, difficulty, targetScore};')();
const DELAY = 0.15, FSPD = 2600;

function simMatch(n, seed) {
  const M = core.newMatch(n, { seed }), plan = makeBot(seed * 31 + 7), hist = [];
  let t = 0, fx = M.m[1].x, fy = M.m[1].y, tgt = { x: fx, y: fy }, anc = null, stuck = 0;
  while (!M.over && t < 900) {
    const p = M.puck;
    hist.push({ t, px: p.x, py: p.y, pvx: p.vx, pvy: p.vy, on: p.on, freeze: M.freeze, mx: M.m[1].x, my: M.m[1].y, ox: M.m[0].x, oy: M.m[0].y });
    while (hist.length > 2 && hist[1].t <= t - DELAY) hist.shift();
    if (t >= DELAY) tgt = plan(hist[0], t);
    const dx = tgt.x - fx, dy = tgt.y - fy, d = Math.hypot(dx, dy), st = FSPD / 60;
    if (d <= st) { fx = tgt.x; fy = tgt.y; } else { fx += dx / d * st; fy += dy / d * st; }
    M.m[1].tx = fx; M.m[1].ty = fy;
    core.stepMatch(M, 1 / 60); M.ev.length = 0; t += 1 / 60;
    // wedge watch: a puck that keeps speed > 40 but does not move for 2 s (it used to get pinned in a corner)
    const v = Math.hypot(M.puck.vx, M.puck.vy);
    if (!M.puck.on || M.freeze > 0 || v <= 40 || !anc || Math.hypot(M.puck.x - anc.x, M.puck.y - anc.y) > 1) anc = { x: M.puck.x, y: M.puck.y, t };
    else if (t - anc.t > 2) { stuck++; anc = null; }
  }
  return { win: M.winner === 1, score: M.score, t, stuck };
}
function simulate(levels) {
  let prev = 0, mono = true; const D = [];
  for (let n = 1; n <= 100; n++) { const d = core.difficulty(n); if (d <= prev) mono = false; prev = d; D.push(d); }
  console.log('Difficulty D strictly increasing over 100 levels:', mono, '(D1 =', D[0] + ', D50 =', D[49] + ', D100 =', D[99] + ')');
  for (const n of levels) {
    let w = 0, tt = 0, mx = 0, stuck = 0; const sc = [];
    for (let g = 0; g < 10; g++) { const r = simMatch(n, 5000 + g * 101 + n); if (r.win) w++; tt += r.t; mx = Math.max(mx, r.t); stuck += r.stuck; sc.push(r.score[1] + '-' + r.score[0]); }
    console.log('SIM level', n, 'D', core.difficulty(n), 'first to', core.targetScore(n), '| bot won', w + '/10', '(' + (w * 10) + '%)', 'avg match', (tt / 10).toFixed(0) + 's, longest', mx.toFixed(0) + 's | wedged pucks', stuck, '|', sc.join(' '));
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function playLevel(browser, n, attempt) {
  const vdir = path.join(OUT, '_vid' + n); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(300); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(300);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  await tap(cdp, page, '#vGo'); await sleep(200);
  const L = await page.evaluate(() => window.__game.layout());
  const plan = makeBot(n * 7 + attempt);
  const t0 = Date.now(), hist = [];
  let st = await page.evaluate(() => window.__game.state());
  let fx = st.mx, fy = st.my + L.offset, down = false, last = Date.now(), moves = 0;
  const scr = (x, y) => ({ x: L.ox + x * L.s, y: L.oy + y * L.s });
  while (Date.now() - t0 < 15 * 60 * 1000) {
    st = (await cdp.send('Runtime.evaluate', { expression: 'window.__game.state()', returnByValue: true })).result.value;
    if (st.scene === 'result' || st.over) break;
    const now = Date.now(); hist.push(Object.assign({ at: now }, st));
    while (hist.length > 2 && hist[1].at <= now - DELAY * 1000) hist.shift();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (now - t0 >= DELAY * 1000 && hist[0].at <= now - DELAY * 1000) {
      const tg = plan(hist[0], (now - t0) / 1000); // perceived state is >=150 ms old
      const tx = tg.x, ty = tg.y + L.offset;       // the mallet appears OFFSET above the finger
      const dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy), stp = FSPD * dt;
      if (d <= stp) { fx = tx; fy = ty; } else { fx += dx / d * stp; fy += dy / d * stp; }
    }
    fy = Math.max(fy, 330);
    const p = scr(fx, fy);
    // touchMoves are pipelined (not awaited): CDP keeps them in order and the measured input lag stays ~50 ms,
    // which only adds to the bot's 150 ms perception delay.
    if (!down) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
    else cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }).catch(() => {});
    down = true; moves++;
    await sleep(8);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (let k = 0; k < 40; k++) { if ((await page.evaluate(() => window.__game.scene)) === 'result') break; await sleep(100); }
  await sleep(1400);
  const fin = await page.evaluate(() => window.__game.state());
  const res = path.join(OUT, 'level-' + n + '-result.png');
  await page.screenshot({ path: res });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const speed = secs > 100 ? 4 : secs > 50 ? 2 : 1;
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  const vf = (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30';
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, won: fin.winner === 1, score: fin.score, secs: secs.toFixed(0), moves, errors, mp4: path.basename(mp4), mb: (fs.statSync(mp4).size / 1048576).toFixed(1) };
}

(async () => {
  const args = process.argv.slice(2);
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  simulate(targets);
  if (args.includes('--sim-only')) return;
  const browser = await chromium.launch();
  for (const n of targets) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = await playLevel(browser, n, attempt);
      console.log('BROWSER level', n, 'attempt', attempt, r.won ? 'CLEARED' : 'lost', 'score (bot:AI)', r.score[1] + ':' + r.score[0], 'time', r.secs + 's', 'touch events', r.moves, 'video', r.mp4, r.mb + 'MB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
      if (r.won) break;
    }
  }
  await browser.close();
})();
