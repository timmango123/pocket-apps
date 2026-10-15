// Verification for 花園女王 (queens).
// 1) Loads the game's own core (CORE-START/CORE-END in index.html) and the embedded LEVELS, then for all 100 levels checks:
//    size/K follow the spec table, the region map is valid (N connected regions), the embedded solution is valid,
//    the backtracking search finds exactly ONE solution, the logic solver (no guessing) solves it, and the
//    difficulty score strictly increases level by level.
// 2) An auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent),
//    at human pace (>=150 ms between actions), placing queens in the order the logic solver deduces them and
//    drag-painting × over the cells it rules out. Records level-NN(.mp4) + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {makePuzzle, countSolutions, logicSolve, nextDeduction, applyDed, decodeReg, regionConnected};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const TABLE = L => L <= 8 ? [5, 1] : L <= 20 ? [6, 1] : L <= 35 ? [7, 1] : L <= 50 ? [8, 1] : L <= 69 ? [9, 1] : L <= 84 ? [10, 2] : L <= 94 ? [11, 2] : [12, 2];
const decodeSol = s => { const o = []; for (let i = 0; i < s.length; i += 2) o.push(parseInt(s.substr(i, 2), 36)); return o; };

function checkAll() {
  let ok = true, prev = -1, t0 = Date.now();
  const rows = [], techLevels = { 3: [], 4: [] };
  for (let n = 1; n <= LEVELS.length; n++) {
    const [N, K, regS, solS, score] = LEVELS[n - 1];
    const reg = C.decodeReg(regS), sol = decodeSol(solS), P = C.makePuzzle(N, K, reg);
    const errs = [];
    const [tN, tK] = TABLE(n); if (N !== tN || K !== tK) errs.push('size ' + N + '/' + K + ' expected ' + tN + '/' + tK);
    if (reg.length !== N * N) errs.push('bad region length');
    for (let r = 0; r < N; r++) if (!C.regionConnected(N, reg, r, -1)) errs.push('region ' + r + ' not connected');
    // embedded solution valid
    const cnt = new Int8Array(3 * N); let adj = false;
    for (const c of sol) { for (const u of P.unitsOf[c]) cnt[u]++; for (const d of P.nb[c]) if (sol.includes(d)) adj = true; }
    if (adj || cnt.some(v => v !== K) || sol.length !== N * K) errs.push('embedded solution invalid');
    const cs = C.countSolutions(P, 2);
    if (cs.count !== 1) errs.push('solutions=' + cs.count);
    const ls = C.logicSolve(P, 4);
    if (!ls.solved) errs.push('logic solver could not solve');
    if (ls.score !== score) errs.push('score ' + ls.score + ' != embedded ' + score);
    if (!(ls.score > prev)) errs.push('not harder than previous (' + ls.score + ' <= ' + prev + ')');
    if (ls.used[3]) techLevels[3].push(n); if (ls.used[4]) techLevels[4].push(n);
    prev = ls.score;
    if (errs.length) { ok = false; console.log('LEVEL', n, 'PROBLEM:', errs.join('; ')); }
    rows.push({ n, N, K, score: ls.score, used: ls.used, steps: ls.steps });
  }
  console.log('Checked', LEVELS.length, 'levels in', ((Date.now() - t0) / 1000).toFixed(1) + 's:', ok ? 'ALL unique, logic-solvable, sizes per spec, strictly increasing difficulty' : 'PROBLEMS FOUND');
  for (const n of [1, 8, 9, 20, 21, 35, 36, 50, 51, 69, 70, 84, 85, 94, 95, 100]) {
    const r = rows[n - 1];
    console.log('  level', String(n).padStart(3), r.N + 'x' + r.N, 'K=' + r.K, 'score', String(r.score).padStart(4), 'techniques used [trivial,single,neighbour,locked,contradiction]', r.used.join('/'));
  }
  const firstLocked = Math.min(...techLevels[3]), firstTrial = Math.min(...techLevels[4]);
  const allLocked = rows.filter(r => r.n >= 30).every(r => r.used[3] > 0), allTrial = rows.filter(r => r.n >= 50).every(r => r.used[4] > 0);
  console.log('  locked-set reasoning needed on every level >= 30:', allLocked, '| depth-1 contradiction needed on every level >= 50:', allTrial);
  return ok;
}

// solver-ordered move list for the bot: queens in deduction order, plus × strokes for ruled-out cells
function plan(n) {
  const [N, K, regS] = LEVELS[n - 1], P = C.makePuzzle(N, K, C.decodeReg(regS));
  const st = new Int8Array(N * N), acts = [];
  for (let g = 0; g < 5000; g++) {
    const d = C.nextDeduction(P, st, 4); if (!d || d.contradiction) break;
    if (d.tech === 0) { C.applyDed(st, d); continue; }
    if (d.kind === 'q') for (const c of d.cells) acts.push({ q: c });
    else {
      // group excluded cells into horizontal runs -> one drag each; singles -> one tap
      const cells = d.cells.slice().sort((a, b) => a - b);
      let run = [cells[0]];
      for (let i = 1; i <= cells.length; i++) {
        const c = cells[i];
        if (c !== undefined && c === run[run.length - 1] + 1 && ((c / N) | 0) === ((run[0] / N) | 0)) run.push(c);
        else { acts.push(run.length > 1 ? { drag: [run[0], run[run.length - 1]] } : { x: run[0] }); run = [c]; }
      }
    }
    C.applyDed(st, d);
  }
  return acts;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(55);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchDrag(cdp, x0, y0, x1, y1) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  const steps = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 10));
  for (let i = 1; i <= steps; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function playLevel(browser, n) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const r = await page.evaluate(() => window.__game.rect());
  const xy = c => [r.x + (c % r.n + 0.5) * r.cs, r.y + (((c / r.n) | 0) + 0.5) * r.cs];
  const acts = plan(n), t0 = Date.now();
  let taps = 0, drags = 0;
  const pause = () => sleep(170 + Math.floor(Math.random() * 120)); // human pace, always >= 150 ms
  for (const a of acts) {
    const grid = await page.evaluate(() => window.__game.grid());
    if (a.q !== undefined) {
      // tap until the cell holds a queen (empty -> × -> queen)
      for (let k = 0; k < 3 && grid[a.q] !== 2; k++) { const [x, y] = xy(a.q); await touchTap(cdp, x, y); taps++; await pause(); grid[a.q] = (await page.evaluate(() => window.__game.grid()))[a.q]; }
    } else if (a.x !== undefined) {
      if (grid[a.x] === 0) { const [x, y] = xy(a.x); await touchTap(cdp, x, y); taps++; await pause(); }
    } else if (a.drag) {
      const [x0, y0] = xy(a.drag[0]), [x1, y1] = xy(a.drag[1]);
      if (grid[a.drag[0]] === 0) { await touchDrag(cdp, x0, y0, x1, y1); drags++; await pause(); }
    }
    if ((await page.evaluate(() => window.__game.state().status)) === 'won') break;
  }
  const playSecs = ((Date.now() - t0) / 1000).toFixed(1);
  await sleep(2600);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const durOut = execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(vdir, webm)]).toString().trim();
  const dur = parseFloat(durOut) || 60;
  const speed = dur > 75 ? 4 : dur > 40 ? 2 : 1;
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', 'setpts=PTS/' + speed, '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, N: st.N, K: st.K, taps, drags, playSecs, gameTime: st.time.toFixed(1), hintsLeft: st.hints, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024), speed };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = checkAll();
  if (args.includes('--solve-only')) process.exit(ok ? 0 : 1);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.N + 'x' + r.N, 'K=' + r.K, r.cleared ? 'CLEARED' : 'NOT CLEARED', '| taps', r.taps, 'drags', r.drags, '| play', r.playSecs + 's (in-game timer ' + r.gameTime + 's), hints used', 3 - r.hintsLeft, '|', r.mp4, r.mp4KB + 'KB', '|', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
