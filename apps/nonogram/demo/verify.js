// Verification for 十字繡坊 (nonogram).
// 1) Solves ALL 100 embedded levels in Node with the game's own core (extracted between CORE-START/CORE-END):
//    line solver (DP over all placements) to convergence + depth-1 probing. Proves every level has a unique
//    solution reachable without guessing, checks L1-30 need no probing, and that raw difficulty rises >= 3% per level.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent):
//    one drag per solver deduction (a run of newly deduced stitches), two-finger pans when the zoomed board needs it,
//    palette taps on multicolour levels, >=150 ms "reaction" pause between actions. Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {decodeLevel, prepLevel, solveLevel, rawDifficulty, isSingle, bitIndex};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + '\nreturn LEVELS;')();

function solveAll() {
  const res = []; let ok = true, rising = true, minRatio = 1e9, probeLv = 0, early = true;
  for (let n = 1; n <= LEVELS.length; n++) {
    const L = core.prepLevel(core.decodeLevel(LEVELS[n - 1][0]));
    const r = core.solveLevel(L, { probe: true, trace: true });
    const solvedOk = r.ok && r.st.every((m, i) => core.bitIndex(m) === L.sol[i]);
    if (!solvedOk) { ok = false; console.log('LEVEL', n, 'NOT uniquely solvable by logic'); }
    const D = solvedOk ? core.rawDifficulty(L, r) : 0;
    if (n <= 30 && r.P > 0) early = false;
    if (r.P > 0) probeLv++;
    if (n > 1) { const q = D / res[n - 2].D; minRatio = Math.min(minRatio, q); if (q < 1.03) { rising = false; console.log('LEVEL', n, 'difficulty ratio', q.toFixed(3)); } }
    res.push({ n, L, r, D, disp: LEVELS[n - 1][1] });
  }
  const tiers = {}; res.forEach(x => { const k = x.L.w + 'x' + x.L.h + (x.L.multi ? ' multi' : ''); tiers[k] = tiers[k] || []; tiers[k].push(x.n); });
  console.log('All', LEVELS.length, 'levels uniquely solvable by line logic + depth-1 probing:', ok);
  console.log('L1-30 need no probing:', early, '| levels needing probing:', probeLv, '(L31-65:', res.filter(x => x.n >= 31 && x.n <= 65 && x.r.P).length + '/35, L66-100:', res.filter(x => x.n >= 66 && x.r.P).length + '/35)');
  console.log('Raw difficulty rises >= 3% every level:', rising, '| smallest step x' + minRatio.toFixed(3), '| D(L1)=' + res[0].D.toFixed(1), 'D(L100)=' + res[99].D.toFixed(1));
  console.log('Sizes:', Object.keys(tiers).map(k => k + ' L' + tiers[k][0] + '-' + tiers[k][tiers[k].length - 1]).join(', '));
  for (const n of [1, 10, 25, 45, 50, 65, 75, 80, 90, 99, 100]) { const x = res[n - 1]; console.log('  L' + n, x.L.name, x.L.w + 'x' + x.L.h + (x.L.multi ? ' multi(' + x.L.nc + ')' : ''), 'steps', x.r.S, 'weighted', x.r.W, 'probes', x.r.P, 'raw', x.D.toFixed(1), 'shown', x.disp); }
  return res;
}

// segments: runs of newly deduced stitches (same colour, contiguous along the deducing line), in solver order
function segments(x) {
  const L = x.L, segs = [];
  for (const t of x.r.trace) {
    const cells = t.cells.filter(([i, m]) => core.isSingle(m) && m !== 1).map(([i, m]) => [i, core.bitIndex(m)]);
    if (!cells.length) continue;
    const isRow = t.line != null ? t.line < L.h : true;
    const key = ([i]) => isRow ? i % L.w : Math.floor(i / L.w);
    cells.sort((a, b) => key(a) - key(b));
    let cur = null;
    for (const c of cells) {
      if (cur && c[1] === cur.color && key(c) === key(cur.cells[cur.cells.length - 1]) + 1) cur.cells.push(c);
      else { cur = { color: c[1], cells: [c] }; segs.push(cur); }
    }
  }
  return segs;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tap(cdp, x, y, hold = 70) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function drag(cdp, x0, y0, x1, y1, ms) {
  const steps = Math.max(3, Math.round(ms / 16));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  await sleep(40);
  for (let i = 1; i <= steps; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / steps, y: y0 + (y1 - y0) * i / steps }] }); }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function twoFingerPan(cdp, cx, cy, dx, dy) {
  // keep both fingers on the board area (clamp the pan distance), like a real two-finger swipe
  // start the swipe on the side it moves away from, so both fingers stay on the screen
  dx = Math.max(-240, Math.min(240, dx)); dy = Math.max(-520, Math.min(520, dy)); cx = 195 - dx / 2; cy = 410 - dy / 2;
  const steps = 12, a = { x: cx - 45, y: cy }, b = { x: cx + 45, y: cy };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
  for (let i = 1; i <= steps; i++) { await sleep(18); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + dx * i / steps, y: a.y + dy * i / steps, id: 1 }, { x: b.x + dx * i / steps, y: b.y + dy * i / steps, id: 2 }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function playLevel(browser, x) {
  const n = x.n, L = x.L, segs = segments(x);
  const vdir = path.join(require('os').tmpdir(), 'nonogram-vid-' + process.pid + '-' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  await page.evaluate(() => { try { localStorage.setItem('nonogram.helped', 'true'); } catch (e) {} });
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // navigate like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  const t0 = Date.now(); let fixPasses = 0, fixed = 0, skipped = 0, pans = 0, colorTaps = 0, color = 1, acts = 0, lastErr = 0;
  const work = [];
  for (const s of segs) work.push(s);
  for (let wi = 0; wi < work.length; wi++) {
    let s = work[wi];
    { // a run longer than the visible part of a zoomed board is stitched in pieces, like a person would
      const v0 = await page.evaluate(() => window.__game.view());
      const isRow = s.cells.length > 1 && Math.floor(s.cells[0][0] / L.w) === Math.floor(s.cells[1][0] / L.w);
      const span = isRow ? v0.ax1 - v0.ax0 - v0.RW - 64 : v0.ay1 - v0.ay0 - v0.CH - 64, maxN = Math.max(1, Math.floor(span / v0.c));
      if (s.cells.length > maxN) { work.splice(wi + 1, 0, { color: s.color, cells: s.cells.slice(maxN) }); s = { color: s.color, cells: s.cells.slice(0, maxN) }; }
    }
    { // skip stitches that are already in place (tapping a finished stitch would unpick it)
      const bd = await page.evaluate(() => window.__game.board());
      const keep = s.cells.filter(c => bd[c[0]] !== c[1]);
      if (keep.length < s.cells.length) { skipped += s.cells.length - keep.length; console.log("  already done:", s.cells.filter(c => bd[c[0]] === c[1]).map(c => c[0]).join(","), "before stroke", acts + 1); }
      if (!keep.length) continue;
      const step = s.cells.length > 1 ? s.cells[1][0] - s.cells[0][0] : 1; let cut = 1;
      while (cut < keep.length && keep[cut][0] - keep[cut - 1][0] === step) cut++;
      if (cut < keep.length) work.splice(wi + 1, 0, { color: s.color, cells: keep.slice(cut) });
      s = { color: s.color, cells: keep.slice(0, cut) };
    }
    if (L.multi && s.color !== color) { await tapSel(cdp, page, '#palette .sw[data-c="' + s.color + '"]'); color = s.color; colorTaps++; await sleep(180); }
    let v = await page.evaluate(() => window.__game.view());
    const pos = i => { const cx = i % L.w, cy = Math.floor(i / L.w); return { x: v.ox + (cx + 0.5) * v.c, y: v.oy + (cy + 0.5) * v.c }; };
    const M = 30, vis = p => p.x > v.ax0 + v.RW + M && p.x < v.ax1 - M && p.y > v.ay0 + v.CH + M && p.y < v.ay1 - M;
    let a = pos(s.cells[0][0]), b = pos(s.cells[s.cells.length - 1][0]);
    for (let k = 0; k < 8 && (!vis(a) || !vis(b)); k++) {
      const mx = (v.ax0 + v.RW + v.ax1) / 2, my = (v.ay0 + v.CH + v.ay1) / 2;
      await twoFingerPan(cdp, mx, my, mx - (a.x + b.x) / 2, my - (a.y + b.y) / 2); pans++; await sleep(220);
      const pv = v; v = await page.evaluate(() => window.__game.view()); a = pos(s.cells[0][0]); b = pos(s.cells[s.cells.length - 1][0]);
      if (Math.abs(pv.ox - v.ox) < 2 && Math.abs(pv.oy - v.oy) < 2) break; // board already at its pan limit
    }
    if (s.cells.length === 1) { if ((await page.evaluate(i => window.__game.board()[i], s.cells[0][0])) === -1) { await tap(cdp, a.x, a.y); await sleep(170); } await tap(cdp, a.x, a.y); } // a wrongly crossed cell is unpicked first
    else await drag(cdp, a.x, a.y, b.x, b.y, 70 + 45 * s.cells.length);
    acts++;
    await sleep(160 + Math.floor(Math.random() * 90)); // human reaction time between strokes
    if (process.env.NONO_DEBUG) { const bd = await page.evaluate(() => window.__game.board()); const miss = s.cells.filter(c => bd[c[0]] !== c[1]); if (miss.length) console.log('  stroke', acts, 'missed', miss.map(c => c[0]).join(','), 'a', JSON.stringify(a), 'b', JSON.stringify(b), 'vis', vis(a), vis(b), 'view', JSON.stringify(v)); }
    const st = await page.evaluate(() => window.__game.state());
    if (st.errors > lastErr) { lastErr = st.errors; console.log('  mistake after stroke', acts, JSON.stringify(st.errLog), 'cells', s.cells.map(c => c[0]).join(','), 'from', a, 'to', b, 'view', JSON.stringify(v)); }
    if (st.status !== 'play') break;
    if (wi === work.length - 1 && fixPasses < 2) { // final check, like a player scanning the board: redo any stitch that is missing
      fixPasses++;
      const bd = await page.evaluate(() => [window.__game.board(), window.__game.solution()]);
      bd[1].forEach((c, i) => { if (c && bd[0][i] !== c) { work.push({ color: c, cells: [[i, c]] }); fixed++; } });
    }
  }
  const playSecs = ((Date.now() - t0) / 1000).toFixed(1);
  { const bd = await page.evaluate(() => [window.__game.board(), window.__game.solution()]); const miss = []; bd[1].forEach((c, i) => { if (c && bd[0][i] !== c) miss.push(i); }); if (miss.length) console.log('  level', n, 'unfinished cells', miss.join(',')); }
  await sleep(3200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 7.5e6) { // speed up long recordings
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', fast]);
    fs.unlinkSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, errors: st.errors, hearts: st.hearts, stars: st.stars, strokes: acts, fixed, skipped, pans, colorTaps, playSecs, pageErrors: errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, res[n - 1]);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', '| strokes', r.strokes, 're-stitched in final check', r.fixed, 'pans', r.pans, 'colour taps', r.colorTaps, '| mistakes', r.errors, 'hearts', r.hearts, 'stars', r.stars, '| play time', r.playSecs + 's', '|', r.mp4, r.mp4KB + 'KB', r.pageErrors.length ? 'PAGE ERRORS ' + r.pageErrors.join(' | ') : 'no page errors');
  }
  await browser.close();
})();
