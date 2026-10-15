// Verification for 和紙數獨 (sudoku).
// 1) Checks ALL 100 embedded levels in Node with the game's own core (CORE-START/CORE-END in ../index.html):
//    DLX proves a unique solution; the human-technique solver solves each level without guessing, its hardest
//    technique matches the level's band, and the difficulty score D equals the embedded value and rises every level.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent):
//    tap cell -> tap digit key, following the solver's step order at human pace, recording mp4 + result screenshot.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {dlxSolve, rateGrid, parseGrid, gridStr, countGivens, bandTier, targetGivens, TECH, TIER_NAMES};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn LEVELS;')();

function checkAll() {
  let ok = true, prevD = 0, prevG = 99, minInc = 1e9, maxIncPct = 0, minIncPct = 1e9;
  const res = [], techUse = {};
  for (let n = 1; n <= LEVELS.length; n++) {
    const [p, D, tier] = LEVELS[n - 1], g = C.parseGrid(p);
    const dlx = C.dlxSolve(g, 2);
    const r = C.rateGrid(g, true);
    const band = C.bandTier(n), givens = C.countGivens(g);
    const problems = [];
    if (dlx.count !== 1) problems.push('DLX solutions=' + dlx.count);
    if (!r.solved) problems.push('human solver stuck');
    else if (C.gridStr(r.grid) !== C.gridStr(dlx.sol)) problems.push('human solution differs');
    if (r.tier !== band || tier !== band) problems.push('tier ' + r.tier + ' (embedded ' + tier + ') != band ' + band);
    if (r.D !== D) problems.push('D ' + r.D + ' != embedded ' + D);
    if (n > 1 && D <= prevD) problems.push('D not increasing (' + prevD + ' -> ' + D + ')');
    
    if (n > 1) { minInc = Math.min(minInc, D - prevD); const pct = (D - prevD) / prevD * 100; maxIncPct = Math.max(maxIncPct, pct); minIncPct = Math.min(minIncPct, pct); }
    if (problems.length) { ok = false; console.log('LEVEL', n, 'PROBLEM:', problems.join('; ')); }
    for (const t in r.counts) if (C.TECH[t].tier === band && band > 0) techUse[band] = (techUse[band] || 0) + 1;
    res.push({ n, D, givens, steps: r.steps, counts: r.counts, sol: C.gridStr(dlx.sol) });
    prevD = D; prevG = givens;
  }
  console.log('All', LEVELS.length, 'levels: unique (DLX) + solved by technique solver without guessing + band technique required + D strictly increasing:', ok);
  console.log('  D from', res[0].D, 'to', res[res.length - 1].D, '| smallest step +' + minInc, '| per-level rise ' + minIncPct.toFixed(1) + '% .. ' + maxIncPct.toFixed(1) + '%');
  console.log('  givens from', res[0].givens, 'to', res[res.length - 1].givens);
  for (const n of [1, 15, 16, 35, 36, 50, 55, 56, 75, 76, 90, 91, 99, 100]) {
    const r = res[n - 1], c = Object.keys(r.counts).map(k => C.TECH[k].n + '×' + r.counts[k]).join(' ');
    console.log('  L' + String(n).padStart(3), 'D', String(r.D).padStart(3), 'givens', r.givens, '|', c);
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(55);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2);
}

async function playLevel(browser, n, info) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tap(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now();
  const geo = await page.evaluate(() => window.__game.geom());
  const cs = geo.size / 9;
  const keyBox = {};
  for (let d = 1; d <= 9; d++) keyBox[d] = await page.locator('.key[data-d="' + d + '"]').boundingBox();
  let taps = 0;
  // follow the human solver's placement order (the order a technique-solver would find them)
  const order = info.steps.filter(s => s.p !== undefined && s.d);
  for (const s of order) {
    const r = Math.floor(s.p / 9), c = s.p % 9;
    await tapXY(cdp, geo.x + (c + 0.5) * cs + (Math.random() - 0.5) * cs * 0.4, geo.y + (r + 0.5) * cs + (Math.random() - 0.5) * cs * 0.4); taps++;
    await sleep(160 + Math.floor(Math.random() * 120));
    const kb = keyBox[s.d];
    await tapXY(cdp, kb.x + kb.width / 2, kb.y + kb.height / 2); taps++;
    await sleep(200 + Math.floor(Math.random() * 140));
  }
  await sleep(2600);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await sleep(600);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.done && st.val === info.sol && winVisible, stars: st.stars, err: st.err, placements: order.length, taps, secs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = checkAll();
  if (args.includes('--solve-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1]);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'stars', r.stars, 'errors', r.err, 'placements', r.placements, 'touch taps', r.taps, 'time', r.secs + 's', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'JS ERRORS ' + r.errors.join(' | ') : 'no JS errors');
  }
  await browser.close();
})();
