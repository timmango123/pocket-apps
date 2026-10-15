// Verification for 三國華容道 (klotski).
// 1) Uses the game's own core code (extracted from index.html between CORE markers) to check all 100 levels:
//    the embedded optimal solution is a legal sequence of one-piece moves that frees 曹操, and a full BFS proves
//    that no shorter solution exists (minimum moves == embedded M). Also checks M and difficulty strictly increase.
// 2) An auto-player clears levels 50, 75, 99, 100 in the real page with real touch drags (CDP Input.dispatchTouchEvent)
//    at human pace (>=150 ms between actions), recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [--no-bfs] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {TDIM, parseLevel, keyOf, decode, reach, pathTo, isGoal, neighbors, solve, setCh};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const CLASSICS = JSON.parse(html.match(/var CLASSICS = (\[[\s\S]*?\]);\n/)[1]);

function decodeSol(s) { const a = []; for (let i = 0; i < s.length; i += 2) a.push([parseInt(s[i], 36), parseInt(s[i + 1], 36)]); return a; }
// replay a solution with the core move generator; returns null if any step is illegal
function checkSolution(L, steps) {
  let k = core.keyOf(L, L.pieces);
  for (const [from, to] of steps) {
    const P = core.decode(L, k), i = P.findIndex(p => p.y * L.W + p.x === from);
    if (i < 0) return null;
    const R = core.reach(L, P, i); if (R.par[to] === undefined) return null;
    k = core.setCh(k, from, '.', to, P[i].t);
  }
  return core.isGoal(L, k) ? k : null;
}
function solveAll(doBfs) {
  let ok = true, prevM = -1, prevD = -1; const t0 = Date.now(); const rows = [];
  LEVELS.forEach((e, idx) => {
    const n = idx + 1, L = core.parseLevel(e[0]), steps = decodeSol(e[2]);
    const legal = !!checkSolution(L, steps) && steps.length === e[1];
    let bfs = null; if (doBfs) { const r = core.solve(L, L.pieces, 5e6); bfs = r ? r.len : null; }
    const good = legal && (!doBfs || bfs === e[1]) && e[1] > prevM && e[3] > prevD;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM legal', legal, 'bfs', bfs, 'M', e[1], 'prevM', prevM, 'D', e[3], 'prevD', prevD); }
    prevM = e[1]; prevD = e[3];
    const cnt = {}; L.pieces.forEach(p => cnt[p.t] = (cnt[p.t] || 0) + 1);
    rows.push({ n, M: e[1], D: e[3], size: L.W + 'x' + L.H, pieces: L.pieces.length, lock: cnt.X || 0, steps });
    if (doBfs && n % 10 === 0) process.stdout.write('  checked ' + n + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
  });
  let cok = true; CLASSICS.forEach(c => { const L = core.parseLevel(c[1]); if (!checkSolution(L, decodeSol(c[3])) || decodeSol(c[3]).length !== c[2]) cok = false; if (doBfs && core.solve(L, L.pieces).len !== c[2]) cok = false; });
  console.log('All ' + LEVELS.length + ' levels solvable, embedded solutions legal' + (doBfs ? ', BFS minimum == embedded M' : '') + ', M and difficulty strictly increasing: ' + ok);
  console.log('Classic layouts (' + CLASSICS.length + ') verified: ' + cok + '  [' + CLASSICS.map(c => c[0] + ' ' + c[2]).join(', ') + ']');
  for (const n of [1, 10, 25, 50, 69, 70, 75, 85, 99, 100]) { const r = rows[n - 1]; console.log('  level', String(n).padStart(3), 'min moves', String(r.M).padStart(3), 'difficulty', r.D.toFixed(1), 'box', r.size, 'pieces', r.pieces, r.lock ? '(locked block)' : ''); }
  return rows;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function drag(cdp, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
  await sleep(40);
  for (let j = 1; j < pts.length; j++) {
    const a = pts[j - 1], b = pts[j], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / 24));
    for (let s = 1; s <= n; s++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * s / n, y: a.y + (b.y - a.y) * s / n }] }); await sleep(16); }
  }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function playLevel(browser, n, steps) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#help')) { await tap(cdp, page, '#hOk'); await sleep(400); }
  const L = core.parseLevel(LEVELS[n - 1][0]);
  let k = core.keyOf(L, L.pieces);
  const t0 = Date.now();
  for (let i = 0; i < steps.length; i++) {
    const st = await page.evaluate(() => window.__game.state());
    if (st.key !== k) throw new Error('state diverged at step ' + i);
    const [from, to] = steps[i], P = core.decode(L, k), pi = P.findIndex(p => p.y * L.W + p.x === from), p = P[pi];
    const cells = core.pathTo(core.reach(L, P, pi), to);
    const pts = cells.map(c => ({ x: st.ox + ((c % L.W) + p.w / 2) * st.cs, y: st.oy + (((c / L.W) | 0) + p.h / 2) * st.cs }));
    await drag(cdp, pts);
    k = core.setCh(k, from, '.', to, p.t);
    for (let q = 0; q < 200; q++) { const s2 = await page.evaluate(() => window.__game.state()); if (!s2.animating || s2.won) break; await sleep(20); }
    await sleep(160 + Math.floor(Math.random() * 120)); // human reaction pause
  }
  for (let q = 0; q < 100; q++) { if (await page.isVisible('#win')) break; await sleep(100); }
  await sleep(1300);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  const stars = await page.locator('#wStars .on').count();
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.won && winVisible, moves: st.moves, opt: steps.length, stars, secs, errors, video: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const rows = solveAll(!args.includes('--no-bfs'));
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, rows[n - 1].steps);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ optimal', r.opt, 'stars', r.stars, 'time', r.secs + 's', r.video, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
