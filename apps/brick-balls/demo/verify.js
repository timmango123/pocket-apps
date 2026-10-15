// Playwright verification for 幾何霓虹磚 (brick-balls).
// Drives the real page in Chromium (390×844, DPR 2, touch) with real touch input (CDP Input.dispatchTouchEvent):
// level select -> 解鎖全部關卡 switch -> level tile -> each turn: drag-to-aim and release, tap ⏩ 快進 after 3 s.
// The aim for each turn is planned in Node with the game's own core code (extracted between CORE markers) from the page's
// current state; every touch action waits ≥150 ms (human reaction pace). Records level-NN.mp4 + level-NN-result.png.
// Planning (thinking) time is cut out of the mp4; long runs are additionally sped up (file name says e.g. -2x).
// Usage: node verify.js [levels...]   (default 50 75 99 100)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const BB = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn BB;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tapEl(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  if (!b) return false;
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return true;
}
// press, drag in the shot direction (default 指向 mode: drag direction = shot direction), hold, release
async function aimAndShoot(cdp, page, angle, W, H) {
  const a = angle * Math.PI / 180, len = 170, x0 = W / 2, y0 = H * 0.72;
  const x1 = x0 + Math.cos(a) * len, y1 = y0 - Math.sin(a) * len, steps = 8;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(28);
    const t = i / steps, e = t * (2 - t);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e }] });
  }
  await sleep(220); // look at the aim line before letting go
  const st = await page.evaluate(() => window.__bb.state());
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  return st.aim;
}

async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const W = 390, H = 844;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const vt0 = Date.now(); const cuts = [];
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapEl(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapEl(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapEl(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tapEl(cdp, page, '#iOk'); await sleep(400); }
  const log = []; const t0 = Date.now();
  for (let turn = 0; turn < 60; turn++) {
    let st = await page.evaluate(() => window.__bb.state());
    if (st.phase !== 'aim') break;
    const c0 = Date.now();
    const S = JSON.parse(await page.evaluate(() => window.__bb.snapshot())); BB.rebuild(S);
    const plan = BB.bestAngle(S).angle;
    const c1 = Date.now(); cuts.push([(c0 - vt0) / 1000 + 0.15, (c1 - vt0) / 1000]);
    await sleep(150 + Math.random() * 150);
    const fired = await aimAndShoot(cdp, page, plan, W, H);
    log.push({ turn: st.turn, plan, fired: +fired.toFixed(2) });
    // wait for the turn; tap 快進 as soon as it appears (3 s)
    let ffDone = false;
    for (let k = 0; k < 2000; k++) {
      await sleep(100);
      st = await page.evaluate(() => window.__bb.state());
      if (!ffDone && st.phase === 'run' && await page.isVisible('#bFF')) { await sleep(150); if (await page.isVisible('#bFF')) await tapEl(cdp, page, '#bFF'); ffDone = true; }
      if (st.phase === 'aim' || st.phase === 'over') break;
    }
    if (st.phase === 'over') break;
  }
  await sleep(2600);
  const st = await page.evaluate(() => window.__bb.state());
  const won = st.status === 'win' && await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  // video: cut the planning gaps, speed up if long
  const webm = path.join(vdir, fs.readdirSync(vdir).find(f => f.endsWith('.webm')));
  const keepDur = (Date.now() - vt0) / 1000 - cuts.reduce((s, c) => s + Math.max(0, c[1] - c[0]), 0);
  const speed = keepDur > 150 ? 4 : keepDur > 75 ? 2 : 1;
  for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') || f.startsWith('level-' + n + '-') && f.endsWith('.mp4')) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  const sel = cuts.filter(c => c[1] > c[0]).map(c => `between(t,${c[0].toFixed(2)},${c[1].toFixed(2)})`).join('+') || '0';
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', `select='not(${sel})',setpts=(N/FRAME_RATE/TB)/${speed}`, '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, won, turns: st.turn, minMargin: st.minMargin, secs, log, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  let all = true;
  for (const n of targets) {
    const r = await playLevel(browser, n);
    if (!r.won) all = false;
    const dev = r.log.map(l => Math.abs(l.plan - l.fired));
    console.log(`BOT level ${n}: ${r.won ? 'CLEARED' : 'NOT CLEARED'} in ${r.turns} turns, min margin ${r.minMargin} rows, ${r.log.length} touch shots, ` +
      `touch-vs-plan angle error max ${Math.max(...dev).toFixed(2)}°, wall time ${r.secs}s, video ${r.mp4} ${r.mp4KB}KB, ${r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors'}`);
  }
  await browser.close();
  console.log(all ? 'ALL TARGET LEVELS CLEARED' : 'SOME LEVELS NOT CLEARED');
})();
