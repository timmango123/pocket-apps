// Verification for 極地探冰 (minesweeper).
// 1) Re-solves ALL 100 embedded levels in Node with the game's own core (extracted between CORE markers):
//    proves each is solvable by pure logic from the start cell (no guessing), the first tap is safe and opens an
//    empty area, parameters follow the spec formulas, mechanics appear at the right levels, every level is clearly
//    harder than the previous (composite C up by >= 0.5) and the displayed 1-10 difficulty (spec D) never drops.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent):
//    taps to dig, 450 ms long-presses to flag, one-finger drags to pan, >=150 ms between actions. Records mp4 + result png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const M = new Function(coreSrc + '\nreturn {msDecode, msSolve, msDiffRaw, msDiffShow, msParams};')();
const LEVELS = new Function(html.match(/var LEVELS = \[[\s\S]*?\];/)[0] + '\nreturn LEVELS;')();

function checkAll() {
  let ok = true, prevC = -Infinity, prevShow = 0, prevExp = 0, prevM = 0, minStep = Infinity, expGrowth = [];
  const rows = [];
  const fail = (n, msg) => { ok = false; console.log('LEVEL', n, 'PROBLEM:', msg); };
  if (LEVELS.length !== 100) fail(0, 'expected 100 levels, got ' + LEVELS.length);
  LEVELS.forEach((s, i) => {
    const n = i + 1, [code, Ds] = s.split('|'), L = M.msDecode(code), P = M.msParams(n);
    const R = M.msSolve(L);
    if (!R.solved) fail(n, 'not solvable without guessing');
    if (L.mine[L.start] || L.cnt8[L.start] !== 0) fail(n, 'start cell is not an empty safe cell');
    if (L.W !== P.W || L.H !== P.H) fail(n, 'size ' + L.W + 'x' + L.H + ' differs from formula ' + P.W + 'x' + P.H);
    const D = M.msDiffRaw(L, R.steps);
    if (Math.abs(D - +Ds) > 0.01) fail(n, 'embedded D ' + Ds + ' != recomputed ' + D.toFixed(3));
    const work = R.steps.basic + 2 * R.steps.subset + 3 * R.steps.enum, C = L.total + 0.2 * work, show = M.msDiffShow(D);
    if (C < prevC + 0.5) fail(n, 'composite difficulty not clearly above previous (' + prevC.toFixed(2) + ' -> ' + C.toFixed(2) + ')');
    if (show < prevShow) fail(n, 'displayed difficulty went down');
    if (n > 1) minStep = Math.min(minStep, C - prevC);
    const expect = P.W * P.H * P.rho; if (expect <= prevExp) fail(n, 'formula composite W*H*rho not increasing');
    if (L.total < prevM) fail(n, 'fewer mines than previous level');
    const cnt = [0, 0, 0, 0]; let holes = 0;
    for (let c = 0; c < L.N; c++) { if (!L.mask[c]) { holes++; continue; } if (!L.mine[c] && L.cnt8[c]) cnt[L.kind[c]]++; }
    if ((cnt[1] > 0) !== (n >= 25)) fail(n, 'dark cells should appear from level 25');
    if ((cnt[2] > 0) !== (n >= 45)) fail(n, 'parity cells should appear from level 45');
    if ((holes > 0) !== (n >= 60)) fail(n, 'irregular shape should appear from level 60');
    if ((cnt[3] > 0) !== (n >= 80)) fail(n, 'four-neighbour cells should appear from level 80');
    rows.push({ n, C: C.toFixed(1), work, size: L.W + 'x' + L.H, cells: L.safe + L.total, mines: L.total, dens: (100 * L.total / (L.safe + L.total)).toFixed(1) + '%', D: D.toFixed(2), show: M.msDiffShow(D), steps: R.steps, dark: cnt[1], parity: cnt[2], four: cnt[3], holes, safe: L.safe });
    if (n > 1) expGrowth.push(expect / prevExp - 1);
    prevC = C; prevShow = show; prevExp = expect; prevM = L.total;
  });
  console.log('All', LEVELS.length, 'levels solvable by pure logic from the start cell (no guessing):', ok);
  console.log('Spec composite W*H*rho rises every level, average +' + (100 * expGrowth.reduce((a, b) => a + b, 0) / expGrowth.length).toFixed(2) + '% per level');
  console.log('Actual composite C = mines + 0.2*(basic + 2*subset + 3*enum steps) strictly increasing, smallest step +' + minStep.toFixed(2) + ', from', rows[0].C, 'to', rows[99].C);
  console.log('Spec D = advanced-step share*50 + mines*0.3: from', rows[0].D, 'to', rows[99].D, '; displayed 1-10 never decreases, from', rows[0].show, 'to', rows[99].show);
  for (const n of [1, 10, 25, 45, 50, 60, 75, 80, 99, 100]) {
    const r = rows[n - 1];
    console.log(`  L${n}: C ${r.C} ${r.size} cells ${r.cells} mines ${r.mines} (${r.dens}) D ${r.D} show ${r.show} steps basic/subset/enum ${r.steps.basic}/${r.steps.subset}/${r.steps.enum} dark ${r.dark} parity ${r.parity} four ${r.four} holes ${r.holes}`);
  }
  return { ok, rows };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Each touch event carries an explicit timestamp: CDP only stamps/handles the next event after the renderer acks the
// previous one, which on a loaded machine (software raster + video capture) would stretch a 70 ms tap into a
// long-press. Explicit timestamps keep the human timing exact; real wall-clock pacing is still >= the hold.
const nowS = () => Date.now() / 1000;
async function touchTap(cdp, x, y, hold) {
  hold = hold || 70; const t0 = nowS();
  const a = cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
  await sleep(hold);
  const b = cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + hold / 1000 });
  await Promise.all([a, b]);
}
async function touchDrag(cdp, x0, y0, dx, dy) {
  const steps = 10;
  const t0 = nowS();
  const ps = [cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }], timestamp: t0 })];
  for (let i = 1; i <= steps; i++) { await sleep(16); ps.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx * i / steps, y: y0 + dy * i / steps }], timestamp: t0 + i * 0.016 })); }
  await sleep(40);
  ps.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + steps * 0.016 + 0.04 }));
  await Promise.all(ps);
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2);
}
const G = (page, fn, arg) => page.evaluate(fn, arg);

async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.stack || e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now(); let taps = 0, flags = 0, drags = 0, stuck = 0;
  while (true) {
    const st = await G(page, () => window.__game.state());
    if (st.status !== 'play') break;
    const moves = await G(page, () => window.__game.nextMoves());
    if (!moves.length) { if (++stuck > 3) break; await sleep(300); continue; }
    stuck = 0;
    for (const mv of moves) {
      let c = await G(page, c => window.__game.cell(c), mv.c);
      if (mv.mine ? c.flag : c.open) continue;
      // pan with one finger until the cell is comfortably inside the board view
      for (let k = 0; k < 6 && !c.inView; k++) {
        const v = await G(page, () => window.__game.view());
        const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
        const dx = Math.max(-220, Math.min(220, cx - c.x)), dy = Math.max(-260, Math.min(260, cy - c.y));
        await touchDrag(cdp, cx - dx / 2, cy - dy / 2, dx, dy); drags++;
        await sleep(180);
        c = await G(page, c => window.__game.cell(c), mv.c);
      }
      if (!c.inView) continue;
      if (mv.mine) { await touchTap(cdp, c.x, c.y, 450); flags++; }
      else { await touchTap(cdp, c.x, c.y, 70); taps++; }
      await sleep(160 + Math.floor(Math.random() * 90));
      const s2 = await G(page, () => window.__game.state());
      if (s2.status !== 'play') break;
    }
  }
  await sleep(2600);
  const st = await G(page, () => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 70 ? 4 : secs > 35 ? 2 : 1;
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', 'setpts=PTS/' + speed + ',fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, mistakes: st.mistakes, opened: st.opened, safe: st.safe, taps, flags, drags, secs: secs.toFixed(1), gameTime: (st.time / 1000).toFixed(1), errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = checkAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'mistakes', r.mistakes, 'opened', r.opened + '/' + r.safe, 'taps', r.taps, 'long-press flags', r.flags, 'drags', r.drags, 'wall', r.secs + 's', 'game clock', r.gameTime + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
