// Verification for 剪紙七巧 (tangram).
// 1) Extracts the game's own core (CORE-START..CORE-END) and level data from index.html and, for ALL 100 levels,
//    runs an independent backtracking solver on the silhouette alone (lattice + 45-degree rotations + flips) to prove it
//    can be filled by the piece set, recomputes complexity C, and checks the difficulty ladder.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent)
//    at human pace: taps to rotate/flip pieces in the tray, drags them onto the silhouette; records mp4 + result png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {TYPES, shapeOff, exactVerts, placeXY, xy, analyze, solveSilhouette, setCounts, complexity, levelParams, isSolved, centroidOff, lv};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  let ok = true, prevD = 0, prevC = 0, strictC = 0, deepN = 0;
  const rows = [];
  for (let n = 1; n <= LEVELS.length; n++) {
    const [name, Cstored, st, pl] = LEVELS[n - 1];
    const counts = core.setCounts(pl.length);
    const t0 = Date.now();
    const r = core.solveSilhouette(pl, counts, 8, pl.length > 7 ? 60000 : 400000);
    const cx = core.complexity(pl, r.count);
    // budget search found nothing (some 14-piece levels): search deeper just to prove solvability
    let first = r.first, deep = false;
    if (!r.count) { const r2 = core.solveSilhouette(pl, counts, 1, 4000000); first = r2.first; deep = true; deepN++; }
    // the solver's first tiling must really cover the silhouette
    const covered = !!first && core.isSolved(pl.map(core.placeXY), first.map(core.placeXY));
    // no-flip levels: the reference tiling uses no mirrored parallelogram
    const flipOK = !core.levelParams(n).noFlip || !pl.some(q => q[0] === 4 && q[2]);
    const holeOK = n <= 40 ? cx.holes === 0 : n <= 70 ? cx.holes === 1 : cx.holes >= 1;
    const tol = core.levelParams(n).tol, D = cx.C / tol;
    const good = covered && flipOK && holeOK && cx.C === Cstored && cx.comps === 1 && D > prevD && cx.C >= prevC;
    if (cx.C > prevC) strictC++;
    if (!good) { ok = false; console.log('LEVEL', n, name, 'PROBLEM sols', r.count, 'covered', covered, 'C', cx.C, 'stored', Cstored, 'comps', cx.comps, 'D', D.toFixed(1), 'prevD', prevD.toFixed(1)); }
    rows.push({ n, name, pieces: pl.length, sols: deep ? '1 (deep search)' : r.count + (r.exhausted ? '' : '+'), C: cx.C, holes: cx.holes, corners: cx.corners, nonAxis: cx.nonAxis, tol, D, stamps: st, ms: Date.now() - t0 });
    prevD = D; prevC = cx.C;
  }
  console.log('All', LEVELS.length, 'levels solved from silhouette alone (' + deepN + ' needed the deep search), hole rules, no-flip 95+, C matches, C non-decreasing, D=C/tol strictly increasing:', ok);
  console.log('C strictly increases on', strictC - 1, 'of 99 steps; C', rows[0].C, '->', rows[99].C, '; D', rows[0].D.toFixed(0), '->', rows[99].D.toFixed(0), '(x' + (rows[99].D / rows[0].D).toFixed(1) + ')');
  const ch = (a, b) => rows.slice(a - 1, b);
  [[1, 20, '動物'], [21, 40, '人物'], [41, 60, '器物'], [61, 80, '建築與字'], [81, 100, '抽象雙副']].forEach(([a, b, nm]) => {
    const R = ch(a, b);
    console.log(`  ${a}-${b} ${nm}: C ${R[0].C}-${R[R.length - 1].C}, holes ${Math.min(...R.map(r => r.holes))}-${Math.max(...R.map(r => r.holes))}, pieces ${R[0].pieces}-${R[R.length - 1].pieces}, stamps ${R[0].stamps}-${R[R.length - 1].stamps}`);
  });
  for (const n of [1, 25, 50, 75, 99, 100]) { const r = rows[n - 1]; console.log(`  level ${n} 「${r.name}」 pieces ${r.pieces} C ${r.C} (corners ${r.corners}, holes ${r.holes}, off-lattice ${r.nonAxis}) solver solutions ${r.sols} snap tol ${r.tol.toFixed(3)}u stamps ${r.stamps}`); }
  if (process.argv.includes('--table')) rows.forEach(r => console.log(r.n, r.name, r.C, r.holes, r.sols, r.D.toFixed(1), r.stamps));
  return ok;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y, hold = 70) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function touchDrag(cdp, x0, y0, x1, y1, ms = 420) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await sleep(90);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const u = i / steps, e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e }] });
    await sleep(ms / steps);
  }
  await sleep(160);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
function sameShape(t, k1, f1, k2, f2) {
  const key = (k, f) => { const o = core.shapeOff(t, k, f).map(core.xy), c = core.centroidOff(t, k, f); return o.map(p => (p[0] - c[0]).toFixed(4) + ',' + (p[1] - c[1]).toFixed(4)).sort().join('|'); };
  return key(k1, f1) === key(k2, f2);
}
async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> chapter tab -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  const chap = n <= 20 ? 0 : n <= 40 ? 1 : n <= 60 ? 2 : n <= 80 ? 3 : 4;
  await tapSel(cdp, page, '.tab[data-c="' + chap + '"]'); await sleep(400);
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(300);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(1200);
  if (await page.isVisible('#hOk')) { await tapSel(cdp, page, '#hOk'); await sleep(400); }
  const t0 = Date.now();
  const plan = await page.evaluate(() => __game.plan());
  const lift = await page.evaluate(() => __game.lift());
  let actions = 0;
  for (const sp of plan) {
    let st = await page.evaluate(() => __game.state());
    const pc = st.pieces.find(p => p.tray && p.t === sp.t);
    if (!pc) { console.log('  no tray piece for', sp.t); continue; }
    let k = pc.k, f = pc.f;
    const [sx, sy] = pc.slot;
    if (sp.t === 'P' && f !== sp.f) {
      await touchTap(cdp, sx, sy); actions++; await sleep(420); k = (k + 1) % 8; // tap = rotate (after double-tap window)
      await tapSel(cdp, page, '#bFlip'); actions++; await sleep(320); f = sp.f;
    }
    let taps = 0; while (!sameShape(sp.t, (k + taps) % 8, f, sp.k, sp.f) && taps < 8) taps++;
    for (let i = 0; i < taps; i++) { await touchTap(cdp, sx, sy); actions++; await sleep(sp.t === 'P' ? 380 : 230); }
    await sleep(150);
    await touchDrag(cdp, sx, sy, sp.x, sp.y + lift); actions++;
    await sleep(260 + Math.floor(Math.random() * 120));
  }
  for (let i = 0; i < 40 && !(await page.isVisible('#win')); i++) await sleep(100);
  await sleep(600);
  const st = await page.evaluate(() => __game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) { const m2 = path.join(OUT, 'level-' + n + '-2x.mp4'); execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-crf', '32', m2]); fs.rmSync(mp4); mp4 = m2; }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'win' && winVisible, hints: st.hints, actions, pieces: plan.length, secs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'pieces', r.pieces, 'touch actions', r.actions, 'hints used', r.hints, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
