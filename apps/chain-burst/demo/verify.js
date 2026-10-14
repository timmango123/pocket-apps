// 深海螢光 (chain-burst) auto-player.
// 1) Re-runs the 100-level grid-search check (gen.js) unless --play-only.
// 2) Clears levels 50, 75, 99, 100 in the real page (Chromium, 390x844, touch) with real CDP touch input:
//    after the level starts the bot reads the current sim frame, uses the game's own core to grid-search the
//    best robust tap region for a moment ~2.5 s ahead, presses ~200 ms before that moment (crosshair preview),
//    and releases at the chosen point plus a random error of up to 6 px. Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--play-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(src + '\nreturn {genLevel, newSim, simStep, runTap, FW, FH};')();
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Plan a tap for frame F: grid-search 24x40 points, then keep the point whose WORST result stays >= T when the
// release lands anywhere from 6 frames early to 30 frames late (touch latency) and up to 6 px off target.
function plan(n, F) {
  const lv = core.genLevel(n), T = lv.P.T;
  const bases = {};
  const base = f => { if (!bases[f]) { const s = core.newSim(lv); while (s.frame < f) { core.simStep(s); s.ev.length = 0; } bases[f] = s; } return bases[f]; };
  const cands = [];
  for (let gy = 0; gy < 40; gy++) for (let gx = 0; gx < 24; gx++) {
    const x = (gx + 0.5) * core.FW / 24, y = (gy + 0.5) * core.FH / 40, c = core.runTap(lv, F, x, y, base(F));
    if (c >= T) cands.push({ x, y, c });
  }
  cands.sort((a, b) => b.c - a.c);
  const offs = [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6], [4.2, 4.2], [-4.2, 4.2], [4.2, -4.2], [-4.2, -4.2]];
  let best = null;
  for (const p of cands.slice(0, 40)) {
    let worst = 1e9;
    for (let df = -6; df <= 30 && worst >= (best ? best.worst : T); df += 3) for (const [dx, dy] of offs) {
      worst = Math.min(worst, core.runTap(lv, F + df, p.x + dx, p.y + dy, base(F + df)));
      if (worst < (best ? best.worst : T)) break;
    }
    if (worst >= T && (!best || worst > best.worst)) best = { ...p, worst };
  }
  return { F, T, cands: cands.length, best };
}
function bestPlan(n) {
  let pick = null;
  for (const F of [90, 120, 150, 180]) {
    const p = plan(n, F);
    if (p.best && (!pick || p.best.worst > pick.best.worst || (p.best.worst === pick.best.worst && p.cands > pick.cands))) pick = p;
  }
  return pick;
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const st = page => page.evaluate(() => window.__game.state());

async function playLevel(browser, n) {
  const t0 = Date.now(); const pl = bestPlan(n); const planMs = Date.now() - t0;
  if (!pl) throw new Error('no robust plan for level ' + n);
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(200); }
  let s = await st(page);
  for (let i = 0; i < 100 && s.status !== 'aim'; i++) { await sleep(20); s = await st(page); }
  const F = pl.F;
  const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * 6;
  const target = await page.evaluate(([x, y]) => window.__game.toScreen(x, y), [pl.best.x, pl.best.y]);
  const ex = target.x + Math.cos(ang) * rad, ey = target.y + Math.sin(ang) * rad;
  // press ~0.6 s early with a slightly-off finger, slide onto the target, release at frame F
  for (let i = 0; i < 2000 && (await st(page)).frame < F - 36; i++) await sleep(8);
  const pressFrame = (await st(page)).frame;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ex - 14, y: ey + 18 }] });
  for (let k = 1; k <= 4; k++) { await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: ex - 14 + 14 * k / 4, y: ey + 18 - 18 * k / 4 }] }); }
  for (let i = 0; i < 2000 && (await st(page)).frame < F - 2; i++) await sleep(4);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  for (let i = 0; i < 600; i++) { s = await st(page); if (s.status === 'result') break; await sleep(50); }
  await sleep(2200);
  s = await st(page);
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: s.won && winVisible, count: s.count, T: s.T, nExp: s.nExp, stars: s.stars, plannedFrame: F, pressFrame, tapFrame: s.tapFrame, err: rad.toFixed(1), planMs, robust: pl.best.worst, cands: pl.cands, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.includes('--play-only')) execFileSync(process.execPath, [path.join(__dirname, 'gen.js')], { stdio: 'inherit' });
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'popped', r.count + '/' + r.nExp, 'target', r.T, 'stars', r.stars,
      '| press frame', r.pressFrame, 'tap frame', r.tapFrame, '(planned', r.plannedFrame + ')', 'error', r.err + 'px', '| worst case over ±6px & -6..+30 frames', r.robust,
      '| winning grid taps', r.cands, '| plan ms', r.planMs, '| video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
