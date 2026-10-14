// Real-page verification for 月下居合 (timing-slash).
// Drives index.html in Chromium (390x844, touch, DPR 2) with real CDP touch events (Input.dispatchTouchEvent) and clears
// levels 50, 75, 99, 100 using the spec's human strategy: tap when the blade is predicted to reach a talisman's centre,
// with N(0, 15 ms) human timing noise added, never sooner than 150 ms after the previous tap or after a reversal/speed change (the page's own core `plan()` gives the
// prediction; the bot only decides *when* to touch). Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SIGMA = 15; // ms, same as the Node human model
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function preciseSleep(ms) { const end = performance.now() + ms; if (ms > 4) await sleep(ms - 3); while (performance.now() < end) {} }
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function attempt(browser, n, k) {
  const vdir = path.join(OUT, '_vid' + n); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const W = 390, H = 844;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSel'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(350); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(350);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(600);
  if (await page.isVisible('#iOk')) { await sleep(1000); await tapSel(cdp, page, '#iOk'); }
  const t0 = Date.now(); let taps = 0, lat = 2, lastNoise = 0, gaps = [], lastTap = 0, nErr = 0;
  while (Date.now() - t0 < 120000) {
    const s0 = performance.now();
    const r = await page.evaluate(() => ({ p: window.__game.plan(), s: window.__game.state() }));
    const rtt = performance.now() - s0;
    if (r.s.status !== 'play') break;
    if (!r.p) { await sleep(20); continue; }
    const wait = r.p.ms - rtt / 2;
    if (wait > 80) { await sleep(Math.min(400, wait - 60)); continue; }
    const noise = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random()) * SIGMA; // human timing error N(0, 15 ms)
    await preciseSleep(Math.max(0, wait - lat + noise));
    const x = r.s.dual ? (r.p.ring === 0 ? W * 0.25 : W * 0.75) : W * (0.3 + Math.random() * 0.4), y = H * (0.55 + Math.random() * 0.2);
    lastNoise = noise; const now = Date.now(); if (lastTap) gaps.push(now - lastTap); lastTap = now;
    await touch(cdp, x, y); taps++;
    // adapt to CDP delivery latency using the page's own measured timing errors (+ = late)
    const e = await page.evaluate(() => window.__game.errs());
    if (e.length > nErr) { lat += 0.3 * (e[e.length - 1] - lastNoise); lat = Math.max(-5, Math.min(25, lat)); nErr = e.length; }
    await sleep(110);
  }
  await sleep(1900);
  const st = await page.evaluate(() => window.__game.state());
  const win = await page.isVisible('#win');
  const errs = await page.evaluate(() => window.__game.errs());
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
  return { n, cleared: st.status === 'win' && win, cut: st.cut, miss: st.miss, perfect: st.perfect, taps, secs: ((Date.now() - t0) / 1000).toFixed(1),
    minGap: gaps.length ? Math.min(...gaps) : null, meanErr: mean.toFixed(1), maxAbsErr: errs.length ? Math.max(...errs.map(Math.abs)) : 0, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    let r, k = 0;
    do { k++; r = await attempt(browser, n, k); } while (!r.cleared && k < 5);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'attempt', k, '| cut', r.cut, 'miss', r.miss, 'perfect', r.perfect, '| taps', r.taps, 'min gap', r.minGap + 'ms',
      '| timing err mean', r.meanErr + 'ms max', r.maxAbsErr + 'ms | play', r.secs + 's | video', r.mp4KB + 'KB |', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
