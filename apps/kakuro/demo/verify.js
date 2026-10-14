// Verification for 馬賽克數和 (kakuro).
// 1) Node: loads all 100 embedded levels with the game's own core (CORE-START/END) and proves for each one:
//    unique solution (exact solver), solvable by the human-technique solver within the techniques allowed for that level,
//    embedded difficulty score reproduced, score strictly increasing level to level, mechanics introduced on schedule.
// 2) Browser: an auto-player clears levels 50, 75, 99, 100 in the real page with real touch input
//    (CDP Input.dispatchTouchEvent: tap a cell, tap a number key) at human pace, recording mp4 + result png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {decodeLevel, humanSolve, countSolutions, SGL};')();
const LEVELS = JSON.parse('[' + html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + ']');

function allowedTier(L) { return L < 20 ? 3 : L < 80 ? 4 : 5; }
function solveAll() {
  const res = []; let ok = true, prev = 0, mono = true;
  const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const P = core.decodeLevel(LEVELS[n - 1]);
    const [score, top] = P.meta[0].split(',').map(Number);
    const uq = core.countSolutions(P, 2, 2000000);
    const hs = core.humanSolve(P, { maxTier: allowedTier(n), trace: true });
    const solMatches = hs.ok && P.white.every(c => core.SGL[hs.cand[c]] === P.sol[c]);
    const longest = Math.max(...P.runs.map(r => r.len)), hidden = P.runs.filter(r => r.hid).length;
    const good = uq.count === 1 && !uq.aborted && hs.ok && solMatches && hs.score === score && hs.top === top;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM unique', uq.count, uq.aborted, 'human', hs.ok, hs.score, score); }
    if (score <= prev) { mono = false; console.log('LEVEL', n, 'NOT HARDER', prev, '->', score); }
    prev = score;
    const order = hs.trace.filter(t => t.val).map(t => [t.cell, t.val]);
    res.push({ n, P, score, top, used: hs.used, order, longest, hidden, size: P.R + 'x' + P.C, whites: P.white.length });
  }
  const T = ['', 'T1', 'T2', 'T3', 'T4', 'T5'];
  console.log('All', LEVELS.length, 'levels: unique solution + human-solvable within allowed techniques + embedded score reproduced:', ok, '(' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  console.log('Difficulty score strictly increasing every level:', mono, ' L1', res[0].score, '-> L100', res[99].score);
  const firstWith = (f) => { const r = res.find(f); return r ? r.n : '-'; };
  console.log('Mechanics: first block-sum (T4) level', firstWith(r => r.top >= 4), '| first 7-9 long run', firstWith(r => r.longest >= 7), '| first hidden clue', firstWith(r => r.hidden > 0), '| first trial (T5) level', firstWith(r => r.top >= 5));
  console.log('  L20 top technique', T[res[19].top], '| L40 longest run', res[39].longest, '| L60 hidden clues', res[59].hidden, '| L80 top technique', T[res[79].top]);
  console.log('  levels 20-79 needing block-sum:', res.slice(19, 79).filter(r => r.top >= 4).length, '/60 | levels 80-100 needing trial:', res.slice(79).filter(r => r.top >= 5).length, '/21');
  for (const n of [1, 10, 20, 25, 40, 50, 60, 75, 80, 90, 99, 100]) { const r = res[n - 1]; console.log('  level', String(n).padStart(3), r.size.padEnd(5), 'whites', String(r.whites).padStart(3), 'score', String(r.score).padStart(4), 'top', T[r.top], 'uses', r.used.slice(1).join('/'), 'longest', r.longest, 'hidden', r.hidden); }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 4, radiusY: 4 }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touch(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function playLevel(browser, lv) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const n = lv.n, vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const keys = {};
  for (let d = 1; d <= 9; d++) { const b = await page.locator('.k[data-d="' + d + '"]').boundingBox(); keys[d] = [b.x + b.width / 2, b.y + b.height / 2]; }
  const t0 = Date.now(); let wrongTaps = 0;
  for (const [cell, val] of lv.order) {
    const p = await page.evaluate(c => window.__game.cellCenter(c), cell);
    await touch(cdp, p.x, p.y); await sleep(150 + Math.random() * 80);
    if ((await page.evaluate(() => window.__game.sel())) !== cell) wrongTaps++;
    await touch(cdp, keys[val][0], keys[val][1]); await sleep(170 + Math.random() * 90);
  }
  await sleep(3200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8 * 1024 * 1024) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.unlinkSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: lv.order.length, errors: st.errors, hints: st.hints, wrongTaps, secs, pageErrors: errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = solveAll();
  if (args.includes('--solve-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, res[n - 1]);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'cells filled', r.moves, 'mistakes', r.errors, 'hints', r.hints, 'missed taps', r.wrongTaps, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.pageErrors.length ? 'PAGE ERRORS ' + r.pageErrors.join(' | ') : 'no page errors');
  }
  await browser.close();
})();
