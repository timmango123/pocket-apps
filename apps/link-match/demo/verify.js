// Auto-player for 糖果連連看 (link-match): drives the real page in Chromium (390x844, DPR 2, touch) with real CDP touch taps
// at human pace (>=180 ms reaction before each pair, 150 ms between taps) and clears levels 50, 75, 99, 100.
// Each move comes from the game's own solver on the live board (window.__game.plan) - the same logic as the 提示 button.
// Records demo/level-NN.mp4 (sped up when long) and demo/level-NN-result.png.
// Usage: node verify.js [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(300); }
  const t0 = Date.now(); let taps = 0, pairs = 0, minTime = 1e9;
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => window.__game.state());
    if (st.status !== 'play') break;
    minTime = Math.min(minTime, st.time);
    const plan = await page.evaluate(() => window.__game.plan());
    if (!plan) { await sleep(40); continue; }
    await sleep(180 + Math.floor(Math.random() * 60)); // reaction time before each pair
    for (let i = 0; i < plan.length; i++) { if (i) await sleep(150 + Math.floor(Math.random() * 40)); await touch(cdp, plan[i][0], plan[i][1]); taps++; }
    pairs += plan.length / 2;
  }
  await sleep(2200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 70 ? 2 : 1, name = 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4';
  for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') && f.endsWith('.mp4') || f.startsWith('level-' + n + '-') && f.endsWith('x.mp4')) fs.rmSync(path.join(OUT, f));
  const vf = speed > 1 ? ['-vf', 'setpts=PTS/' + speed] : [];
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', path.join(OUT, name)]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, left: st.left, timeLeft: st.time, timeMax: st.timeMax, minTime, score: st.score, taps, pairs, secs: secs.toFixed(1), errors, video: name, mp4KB: Math.round(fs.statSync(path.join(OUT, name)).size / 1024) };
}

(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED (' + r.left + ' pairs left)', 'pairs', r.pairs, 'taps', r.taps, 'play', r.secs + 's',
      'time left', r.timeLeft.toFixed(1) + '/' + r.timeMax + 's', 'lowest', r.minTime.toFixed(1) + 's', 'score', r.score, r.video, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
