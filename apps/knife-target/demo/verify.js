// Verification: a human-like bot (150 ms perception delay, predicts only with the
// current angular velocity, accounts for its own input latency + knife flight time)
// plays the REAL page through real touch taps (Playwright touchscreen -> pointer events).
// Usage: node verify.js [levels=50,75,99,100] [maxAttempts=12]
'use strict';
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { createBot } = require('./bot.js');
const DEMO = __dirname;
const URL = 'file://' + path.join(DEMO, '..', 'index.html');
const levels = (process.argv[2] || '50,75,99,100').split(',').map(Number);
const MAX_ATT = +(process.argv[3] || 12);

(async () => {
  const browser = await chromium.launch();
  const results = [];
  for (const L of levels) {
    const vdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ktv-'));
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL);
    await page.waitForTimeout(500);
    const K = await page.evaluate(() => ({ FLIGHT: __game.core.FLIGHT, LAUNCH: __game.core.LAUNCH, COLLIDE: __game.core.COLLIDE, TAU: __game.core.TAU }));
    const Kfull = Object.assign({}, K, {
      norm: a => { a %= K.TAU; return a < 0 ? a + K.TAU : a; },
      angDiff: (a, b) => { let d = (a - b) % K.TAU; if (d < 0) d += K.TAU; return d > Math.PI ? d - K.TAU : d; }
    });
    const bot = createBot(Kfull);
    const cdp = await ctx.newCDPSession(page);
    const touch = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }).catch(() => {}); };
    await page.evaluate(l => __game.start(l), L);
    let attempt = 1, won = false, t0 = Date.now(), lastT = -1, throws = 0, attemptLog = [];
    let attStart = Date.now();
    while (true) {
      const s = await page.evaluate(() => __game.state());
      if (s.state === 'win') { won = true; attemptLog.push({ attempt, result: 'clear', seconds: +((Date.now() - attStart) / 1000).toFixed(1), throws }); break; }
      if (s.state === 'fail') {
        attemptLog.push({ attempt, result: 'fail', seconds: +((Date.now() - attStart) / 1000).toFixed(1), throws, knivesLeft: s.left + 1 });
        console.log(`L${L} attempt ${attempt} failed (${s.left + 1} knives short)`);
        if (attempt >= MAX_ATT) break;
        await page.waitForFunction(() => __game.state().resultShown, null, { timeout: 5000 });
        await page.waitForTimeout(250);
        const box = await page.locator('#btnNext').boundingBox();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); // real tap on 「再試一次」
        attempt++; throws = 0; attStart = Date.now(); bot.newAttempt(); lastT = -1;
        await page.waitForTimeout(100);
        continue;
      }
      if (Date.now() - attStart > 240000) { attemptLog.push({ attempt, result: 'timeout' }); break; }
      if (s.t !== lastT) {
        lastT = s.t;
        bot.observe({ t: s.t, theta: s.theta, omega: s.omega, knives: s.knives, canThrow: s.canThrow, state: s.state, throwT: s.throwT });
      }
      // page clock "now" ~= s.now (measured inside the page a moment ago)
      if (bot.decide(s.now)) { throws++; await touch(s.tap.x, s.tap.y); } else await new Promise(r => setTimeout(r, 4));
    }
    let secs = 0;
    if (won) {
      await page.waitForFunction(() => __game.state().resultShown, null, { timeout: 8000 });
      await page.waitForTimeout(1300);
      await page.screenshot({ path: path.join(DEMO, `level-${L}-result.png`) });
    } else await page.waitForTimeout(800);
    const video = page.video();
    await ctx.close();
    const webm = await video.path();
    const mp4 = path.join(DEMO, `level-${L}.mp4`);
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
    fs.rmSync(vdir, { recursive: true, force: true });
    const r = { level: L, cleared: won, attempts: attempt, latencyEstMs: Math.round(bot.latency() * 1000), latencyJitterMs: Math.round(bot.latencyJitter() * 1000), learnedMinHold: bot.learned(), attemptLog, pageErrors: errs, mp4MB: +(fs.statSync(mp4).size / 1e6).toFixed(2) };
    console.log(JSON.stringify(r));
    results.push(r);
  }
  await browser.close();
  const rf = path.join(DEMO, 'verify-results.json');
  let prev = []; try { prev = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch (e) {}
  const merged = prev.filter(p => !results.some(r => r.level === p.level)).concat(results).sort((a, b) => a.level - b.level);
  fs.writeFileSync(rf, JSON.stringify(merged, null, 2));
})();
