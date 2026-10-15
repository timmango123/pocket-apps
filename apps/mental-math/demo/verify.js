// Real-page auto-play for 粉筆心算 (endless). Drives Chromium at 390x844 with real touch input
// (CDP Input.dispatchTouchEvent) at human pace: each problem is answered >= 550 ms after it becomes the
// current one (150 ms reaction + 400 ms compute, as in the spec), never faster than 150 ms between taps.
// Plays classic mode until a target score, then stops answering so the run ends on the result screen.
// Writes demo/run.mp4 (2x speed) and demo/run-result.png.  Usage: node verify.js [targetScore=15000]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const TARGET = +process.argv[2] || 15000, SPEED = 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }
(async () => {
  const vdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mm-vid-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  await tapSel(cdp, page, '[data-mode=classic]');
  const t0 = Date.now(); let seenId = -1, seenAt = 0, lastTap = 0, taps = 0, wrong = 0; const log = [];
  let nextLog = 0;
  while (true) {
    const st = await page.evaluate(() => window.__game.state());
    if (st.over || st.result) break;
    if (st.score >= TARGET || Date.now() - t0 > 240000) break;
    if (st.answered >= nextLog) { log.push({ s: ((Date.now() - t0) / 1000).toFixed(0), answered: st.answered, score: st.score, tier: st.tier, simul: st.simul, T: st.T && st.T.toFixed(2), lives: st.lives }); nextLog += 15; }
    if (st.cur) {
      if (st.cur.id !== seenId) { seenId = st.cur.id; seenAt = Date.now(); }
      const now = Date.now();
      if (now - seenAt >= 550 && now - lastTap >= 150 && st.lock <= 0) {
        const idx = st.cur.opts.indexOf(st.cur.ans);
        const b = await page.locator('.k').nth(idx).boundingBox();
        await touch(cdp, b.x + b.width / 2 + (Math.random() - .5) * 20, b.y + b.height / 2 + (Math.random() - .5) * 20);
        lastTap = Date.now(); taps++; seenId = -1;
      }
    }
    await sleep(25);
  }
  const peak = await page.evaluate(() => window.__game.state());
  log.push({ s: ((Date.now() - t0) / 1000).toFixed(0), answered: peak.answered, score: peak.score, tier: peak.tier, simul: peak.simul, T: peak.T && peak.T.toFixed(2), lives: peak.lives, note: peak.over ? 'bot fell behind at the speed floor, chalk ran out' : 'bot stops answering' });
  // stop answering -> problems hit the bottom until the chalk runs out
  for (let i = 0; i < 200; i++) { if (await page.isVisible('#result')) break; await sleep(100); }
  await sleep(1200);
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  const res = await page.evaluate(() => ({ score: document.querySelector('#rScore').textContent, combo: document.querySelector('#rCombo').textContent, n: document.querySelector('#rN').textContent, acc: document.querySelector('#rAcc').textContent, rt: document.querySelector('#rRt').textContent }));
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'run.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', `setpts=PTS/${SPEED},fps=30`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (e) {}
  console.log('Difficulty ramp during the run:');
  log.forEach(l => console.log(`  t=${l.s}s answered=${l.answered} score=${l.score} tier=${l.tier}/6 simultaneous=${l.simul} fallTime=${l.T}s lives=${l.lives}${l.note ? '  <- ' + l.note : ''}`));
  console.log(`Taps: ${taps} (all real CDP touches, >=550 ms after each problem became current).`);
  console.log(`Result screen: score ${res.score}, max combo ${res.combo}, answered ${res.n}, accuracy ${res.acc}, avg reaction ${res.rt}`);
  console.log(`Video: run.mp4 (${SPEED}x speed) ${Math.round(fs.statSync(mp4).size / 1024)} KB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
})();
