// Page-level verification for 投籃王 (hoop-king).
// Drives the real page in Chromium with real touch input (CDP Input.dispatchTouchEvent): every shot is a
// 120 ms upward swipe made of touchStart + 10 touchMoves + touchEnd. The bot plans each shot with the game's own
// core physics (extracted between CORE-START/CORE-END). Each shot is decided from a state observation made
// >=150 ms before the finger lets go, waits for a moment that tolerates +-40 ms timing error, respects the 0.6 s
// cooldown, and adds +-3% power / +-4 cm aim noise. Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [levels...]   (default 50 75 99 100)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const HK = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn HK;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// One 120 ms upward swipe: touchStart + 10 touchMoves 12 ms apart (explicit timestamps so the page sees true finger
// timing), then the finger lifts once the game clock reaches the planned release time (at most 95 ms later).
async function swipe(cdp, page, sw, tRelease) {
  const t0 = Date.now() / 1000, ps = [];
  ps.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sw.x0, y: sw.y0 }], timestamp: t0 }));
  for (let k = 1; k <= 10; k++) {
    await sleep(12);
    ps.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sw.x0 + sw.dx * k / 10, y: sw.y0 + sw.dy * k / 10 }], timestamp: t0 + 0.012 * k }));
  }
  await Promise.all(ps);
  const tm = Date.now();
  for (let k = 0; k < 40 && Date.now() - tm < 95; k++) { const t = await page.evaluate(() => window.__game.state().t); if (t >= tRelease - 0.1) break; await sleep(2); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + 0.121 + Math.min(0.095, (Date.now() - tm) / 1000) });
}

async function playLevel(browser, n, seed) {
  const vdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hoopvid' + n + '-')); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(600);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); }
  const c = HK.levelCfg(n);
  let r = HK.rng(seed), swipeLat = 0.15, lastAction = 0, shots = 0;
  const wall0 = Date.now();
  for (let guard = 0; guard < 4000; guard++) {
    const wallRead = Date.now(), st = await page.evaluate(() => window.__game.state());
    if (st.over || st.ui === 'end') break;
    if (st.inAir >= 2 || st.timeUp) { await sleep(40); continue; }
    // Anticipate like a player who has learned the hoop's rhythm: look ahead for the first release moment
    // (at least 150 ms + the swipe itself after this observation) where the shot still scores if released
    // 40 ms early or late. The wind reading used is 150 ms old.
    const wind = HK.windAt(c, Math.max(0, st.t - 0.15)), earliest = st.t + Math.max(0.15, st.cool) + 0.25;
    let plan = null, tr = 0;
    for (let d = 0; d < 1.2 && !plan; d += 0.025) { tr = earliest + d; if (tr > st.S) break; plan = HK.planShot(c, tr, wind, 0.04); }
    if (!plan) { await sleep(60); continue; }
    const p = plan.p * (1 + (r() * 2 - 1) * 0.03), x = plan.xT + (r() * 2 - 1) * 0.04;
    const sw = await page.evaluate(([pp, xx]) => window.__game.swipeFor(pp, xx, 0.12), [p, x]);
    const startAt = wallRead + (tr - st.t - 0.23) * 1000, wait = startAt - Date.now();
    if (wait < -30) { continue; } // planning took too long: re-observe
    if (wait > 70) await sleep(wait - 70);
    // final timing against the game clock itself (a player watching the hoop, not a stopwatch)
    let gt = 0, wallStart = Date.now(), tg = st.t;
    for (let k = 0; k < 40; k++) { tg = await page.evaluate(() => window.__game.state().t); wallStart = Date.now(); if (tg >= tr - 0.23) break; await sleep(4); }
    await swipe(cdp, page, sw, tr); lastAction = Date.now(); shots++;
    await sleep(40);
    const s2 = await page.evaluate(() => window.__game.state());
    if (!(s2.lastShot && s2.shots === shots)) shots = s2.shots;
    if (process.env.DEBUG) console.log('shot', st.t.toFixed(2), 'plan', tr.toFixed(3), 'release', s2.lastShot && s2.lastShot.t.toFixed(3), 'lat', swipeLat.toFixed(3), 'wait', wait.toFixed(0), 'score', s2.score, 'p', p.toFixed(3), s2.lastShot.p.toFixed(3), 'x', x.toFixed(3), s2.lastShot.xT.toFixed(3), 'pred', HK.simShot(c, s2.lastShot.t, s2.lastShot.p, s2.lastShot.xT).scored);
    await sleep(150);
  }
  await sleep(2200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - wall0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-r', '30', '-movflags', '+faststart', mp4]);
  try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (e) {}
  return { n, cleared: st.result === 'win' && winVisible, st, secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  let all = true;
  for (const n of targets) {
    const r = await playLevel(browser, n, 4242 + n);
    if (!r.cleared) all = false;
    console.log(`BOT level ${n} ${r.cleared ? 'CLEARED' : 'NOT CLEARED'}: score ${r.st.score}/${r.st.G} in ${r.st.t.toFixed(1)}s game time (limit ${r.st.S}s), stars ${r.st.stars}, made ${r.st.makes}/${r.st.shots} (swish ${r.st.swishes}), wall ${r.secs}s, video ${r.mp4KB}KB, ${r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors'}`);
  }
  console.log('ALL CLEARED:', all);
  await browser.close();
})();
