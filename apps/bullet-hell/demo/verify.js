// Verification for 彈幕射擊 (bullet-hell).
// 1) Loads the page at 390×844 and the three lobby iframe sizes, light and dark: no page errors, title → start → HUD → pause → resume.
// 2) Real touch input through CDP: relative drag moves the crane by the finger's delta; a second finger turns on focus.
// 3) A keyboard-driven bot plays stage 1 (enemies, then the boss with all three patterns), bombs when cornered,
//    then stage 2 begins. Then the game-over → continue flow. Writes demo/cover-390x520.png (stage 3 "千本櫻" spell, real play).
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function ok(c, msg) { if (c) console.log('ok  ', msg); else { fails++; console.log('FAIL', msg); } }
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] };

function track(page, errors) { page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); }
const st = page => page.evaluate(() => window.__game.state());

// ---- bot: dodge by sampling 9 moves × focus over a short horizon against the predicted bullets ----
const DIRS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
function decide(s) {
  const pl = s.pl, FH = s.FH, near = s.bullets.filter(b => Math.hypot(b[0] - pl.x, b[1] - pl.y) < 200);
  let best = null, bestCost = Infinity;
  const homeX = s.boss ? Math.max(40, Math.min(320, s.boss.x)) : 180, homeY = FH - 70;
  for (const d of DIRS) for (const foc of [false, true]) {
    const sp = foc ? 95 : 210; let x = pl.x, y = pl.y, cost = 0;
    for (let k = 1; k <= 8; k++) {
      const t = k * 0.07; x = Math.max(8, Math.min(352, pl.x + d[0] * sp * t)); y = Math.max(12, Math.min(FH - 12, pl.y + d[1] * sp * t));
      for (const b of near) {
        const bx = b[0] + b[2] * t, by = b[1] + b[3] * t, cl = Math.hypot(bx - x, by - y) - b[4] - 3;
        if (cl < 0) cost += 3000 * (1.2 - t); else if (cl < 24) cost += (24 - cl) * (24 - cl) * 0.5 * (1.2 - t);
      }
    }
    cost += (Math.abs(x - homeX) * 0.8 + Math.abs(y - homeY)) * 0.3 + (foc ? 0.5 : 0) + (d[0] || d[1] ? 1 : 0);
    if (cost < bestCost) { bestCost = cost; best = { d, foc }; }
  }
  // unavoidable hit within the horizon → bomb
  return { ...best, bomb: bestCost > 2500 && s.bombs > 0 };
}
// Each bot step: apply the decision, advance the game 4 fixed 1/60 s frames (67 ms of game time), read the state.
// Game time therefore does not depend on the headless frame rate; rendering still runs on rAF in the background.
async function play(page, until, maxSteps, log) {
  let s = await st(page), bombs = 0, last = '', steps = 0;
  while (steps < maxSteps) {
    if (until(s) || s.st === 'over' || s.st === 'paused') break;
    if (log) { const tag = s.st + (s.boss && s.boss.name ? ' ' + s.boss.name : ''); if (tag !== last) { last = tag; console.log(`  game ${(steps * 4 / 60).toFixed(1)}s  ${tag}  score ${s.score}  lives ${s.lives}  bombs ${s.bombs}  bullets ${s.bullets.length}`); } }
    const dec = decide(s);
    if (dec.bomb && s.pl.dead <= 0) bombs++;
    s = await page.evaluate(d => { const g = window.__game; g.input(d.d[0], d.d[1], d.foc); if (d.bomb) g.bomb(); g.tick(4); return g.state(); }, dec);
    steps++;
  }
  await page.evaluate(() => window.__game.input(0, 0, false));
  return { s, bombs, secs: steps * 4 / 60 };
}

(async () => {
  const browser = await chromium.launch(LAUNCH);
  // ---- 1. sizes × colour schemes ----
  for (const vp of [[390, 844], [375, 500], [390, 610], [430, 740]]) for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage(), errors = []; track(page, errors);
    await page.goto(APP); await sleep(700);
    const label = `${vp[0]}×${vp[1]} ${scheme}`;
    ok(await page.locator('#title').isVisible() && await page.locator('#bStart').isVisible(), label + ': title and start button visible');
    const s0 = await st(page);
    ok(s0.st === 'title' && s0.bullets.length > 0, label + ': attract-mode spell plays behind the title (' + s0.bullets.length + ' bullets)');
    if (vp[0] === 375) await page.screenshot({ path: path.join(OUT, `shot-title-${scheme}.png`) });
    await page.locator('#bStart').tap(); await sleep(600);
    const s1 = await st(page);
    ok(s1.st === 'stage' && await page.locator('#bPause').isVisible() && await page.locator('#bBomb').isVisible() && await page.locator('#bFocus').isVisible(), label + ': game starts with HUD buttons');
    await page.locator('#bPause').tap(); await sleep(200);
    ok((await st(page)).st === 'paused' && await page.locator('#pause').isVisible(), label + ': pause overlay');
    await page.locator('#bResume').tap(); await sleep(200);
    ok((await st(page)).st === 'stage', label + ': resume');
    await page.locator('#bFocus').tap(); await page.evaluate(() => window.__game.tick(2));
    ok((await st(page)).focus === true, label + ': focus toggle button');
    await page.locator('#bFocus').tap();
    const b0 = (await st(page)).bombs; await page.locator('#bBomb').tap(); await sleep(150);
    ok((await st(page)).bombs === b0 - 1, label + ': bomb button uses a bomb');
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ow <= 1, label + ': no horizontal overflow');
    if (vp[0] === 375) { await sleep(2500); await page.screenshot({ path: path.join(OUT, `shot-play-${scheme}.png`) }); }
    ok(errors.length === 0, label + ': no page errors' + (errors.length ? ' — ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // ---- 2. touch: relative movement and two-finger focus ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage(), errors = []; track(page, errors);
    await page.goto(APP); await sleep(500);
    await page.evaluate(() => window.__game.start(1)); await sleep(300);
    await page.evaluate(() => window.__game.god(true));
    const cdp = await ctx.newCDPSession(page);
    const a = await st(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 120, y: 300, id: 1 }] });
    for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120 + i * 8, y: 300 - i * 4, id: 1 }] }); await sleep(16); }
    await sleep(100);
    const b = await st(page);
    const dx = (b.pl.x - a.pl.x) * b.S, dy = (b.pl.y - a.pl.y) * b.S;
    ok(dx > 70 && dx < 110 && dy < -30 && dy > -55, `relative touch: finger moved (80,-40) px, crane moved (${dx.toFixed(0)},${dy.toFixed(0)}) px, away from the finger`);
    ok(b.focus === false, 'one finger: not focused');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 300, id: 1 }] }); await sleep(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 300, id: 1 }, { x: 300, y: 500, id: 2 }] }); await sleep(200);
    ok((await st(page)).focus === true, 'two fingers held: focus (slow) mode on');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: 200, y: 300, id: 1 }] }); await sleep(120);
    ok((await st(page)).focus === false, 'lifting a finger ends focus');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const w0 = (await st(page)).pl;
    await page.keyboard.down('ArrowLeft'); await page.evaluate(() => window.__game.tick(30)); await page.keyboard.up('ArrowLeft');
    ok((await st(page)).pl.x < w0.x - 30, 'keyboard: arrow keys move the crane');
    ok(errors.length === 0, 'touch session: no page errors');
    await ctx.close();
  }

  // ---- 3. bot plays stage 1 through the boss; then game over and continue ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage(), errors = []; track(page, errors);
    await page.goto(APP); await sleep(500);
    await page.evaluate(() => { window.__fps = []; let n = 0, t = performance.now(); (function f(now) { n++; if (now - t >= 1000) { window.__fps.push(n); n = 0; t = now; } requestAnimationFrame(f); })(performance.now()); });
    await page.evaluate(() => window.__game.start(1)); await sleep(200);
    console.log('bot: stage 1 (normal)');
    let r = await play(page, s => s.t > 14, 400, true);
    ok(r.s.kills > 0, 'bot shot down ' + r.s.kills + ' enemies in the first 14 s of stage 1');
    await page.evaluate(() => window.__game.skipToBoss());
    r = await play(page, s => s.st === 'boss' && s.boss && s.boss.idx >= 0, 120, true);
    ok(r.s.st === 'boss' && r.s.boss.idx === 0, 'boss 狐火 enters and opens its first pattern');
    r = await play(page, s => s.st !== 'boss' && s.st !== 'bossdown', 2400, true);
    ok(r.s.st === 'cleared' || r.s.st === 'stage' || r.s.stage === 1, `boss 1 defeated: state ${r.s.st}, stage ${r.s.stage + 1}, score ${r.s.score}, lives ${r.s.lives}, bombs used ${r.bombs}, spells ${r.s.spellsGot}/${r.s.spells}, graze ${r.s.graze} in ${r.secs.toFixed(0)} s`);
    r = await play(page, s => s.st === 'stage' && s.stage === 1, 150, false);
    ok(r.s.stage === 1 && r.s.st === 'stage', 'stage 2 begins');
    // game over → continue
    await page.evaluate(() => { window.__game.lives(0); window.__game.god(false); });
    await page.evaluate(() => window.__game.skipToBoss());
    let s; for (let i = 0; i < 600; i++) { s = await page.evaluate(() => { window.__game.tick(10); return window.__game.state(); }); if (s.st === 'over') break; }
    await sleep(300);
    ok(s.st === 'over' && await page.locator('#over').isVisible() && await page.locator('#bContinue').isVisible(), 'standing still on the last life → game over screen with continue');
    await page.screenshot({ path: path.join(OUT, 'shot-over.png') });
    await page.locator('#bContinue').tap(); await sleep(300);
    s = await st(page);
    ok(s.st !== 'over' && s.conts === 1 && s.score === 1 && s.lives === 3, 'continue: back in play, score reset to the continue count, lives refilled');
    const fps = await page.evaluate(() => window.__fps);
    const sorted = fps.slice(2).sort((a, b) => a - b);
    if (sorted.length) console.log(`rAF fps while the bot ran: median ${sorted[sorted.length >> 1]}, 5th pct ${sorted[Math.floor(sorted.length * 0.05)]} (${sorted.length} s, headless software rendering, not a phone)`);
    const pools = await page.evaluate(() => window.__game.pools());
    ok(pools.bulMax === 1600, 'bullet pool allocated once (' + pools.bulMax + ')');
    ok(errors.length === 0, 'bot session: no page errors' + (errors.length ? ' — ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // ---- 4. cover: stage 3 spell "千本櫻" at 390×520 with the bot playing ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage(), errors = []; track(page, errors);
    await page.goto(APP); await sleep(400);
    await page.evaluate(() => { window.__game.start(2); window.__game.power(3); window.__game.jumpStage(2); window.__game.skipToBoss(); });
    await play(page, s => s.boss && s.boss.idx === 0, 200, false);
    await page.evaluate(() => { window.__game.skipPattern(); });
    await play(page, s => s.boss && s.boss.idx === 1, 100, false);
    await page.evaluate(() => { window.__game.skipPattern(); });
    await page.evaluate(() => window.__game.god(true));
    await play(page, s => s.boss && s.boss.idx === 2 && s.boss.timer < 39.5 && s.bullets.length > 100, 400, false);
    await page.evaluate(() => { window.__game.input(0, 0, true); window.__game.tick(2); });
    await sleep(400);
    await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    await page.evaluate(() => window.__game.input(0, 0, false));
    const s = await st(page);
    ok(s.boss && s.boss.name === '櫻符「千本櫻」' && s.bullets.length > 80, `cover shows 千本櫻 with ${s.bullets.length} bullets on screen`);
    ok(errors.length === 0, 'cover session: no page errors');
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `VERIFY FAILED: ${fails} check(s)` : 'VERIFY OK: all checks passed');
  process.exit(fails ? 1 : 0);
})();
