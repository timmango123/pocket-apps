// Verification for 銅管水坊 (pipe-flow).
// 1) Rebuilds all 100 levels in Node from the game's own core (CORE-START/CORE-END in ../index.html) and runs the
//    backtracking solver (water-front search with constraint propagation: matching openings, no leaks, no colour
//    mixing) on every level, first to find any solution, then exhaustively (branch and bound) for the minimum number
//    of turns, which must equal the embedded par. Every answer is checked with the game's own evaluate() -> win, and
//    difficulty and par must rise every level.
// 2) Auto-player: opens the real page in Chromium (390x844, touch, DPR 2), unlocks all levels through the switch,
//    and clears levels 50, 75, 99, 100 with real CDP touch events at human pace (150 ms + 0-80 ms between taps,
//    a 520 ms long-press for a counter-clockwise turn), recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {generate, solve, evaluate, rotCW, rotatable, params, T_PIPE, T_VALVE, T_CROSS, popc, rotl};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  const res = []; let ok = true, prevD = -1, prevPar = -1, mono = true, totalNodes = 0; const t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [att, par, diff] = LEVELS[n - 1];
    const Lv = core.generate(n, att);
    if (!Lv) { ok = false; console.log('LEVEL', n, 'generator returned nothing'); continue; }
    if (diff <= prevD || par <= prevPar) mono = false;
    prevD = diff; prevPar = par;
    const first = core.solve(Lv, 20000000);            // plain backtracking: does a solution exist?
    const r = core.solve(Lv, 20000000, true);           // branch and bound: the cheapest solution
    totalNodes += first.nodes + r.nodes;
    const win = first.ok && core.evaluate(Lv, first.rots).win && r.ok && core.evaluate(Lv, r.rots).win;
    if (!win) { ok = false; console.log('LEVEL', n, 'solver failed', r.nodes); }
    if (!r.exhausted || r.cost !== par || Math.round(Lv.P.base + r.cost) !== diff) { ok = false; console.log('LEVEL', n, 'par/difficulty mismatch', r.cost, par, diff); }
    // solver plan: cells to turn and clockwise taps needed
    let cost = 0; const plan = [];
    if (win) {
      const ev = core.evaluate(Lv, r.rots);
      for (let c = 0; c < Lv.w * Lv.h; c++) if (core.rotatable(Lv, c)) {
        const k = core.rotCW(Lv, c, Lv.rot[c], r.rots[c]);
        if (k) { plan.push({ c, k, d: Math.max(ev.depth[c * 2], ev.depth[c * 2 + 1]) }); cost += k === 3 ? 1 : k; }
      }
      plan.sort((a, b) => a.d - b.d);
    }
    let nT = 0, nPlus = 0, nLock = 0, nX = 0, nV = 0, nOut = 0;
    for (let c = 0; c < Lv.w * Lv.h; c++) {
      if (Lv.sol[c] >= 0) { const pc = core.popc(core.rotl(Lv.base[c], Lv.sol[c])); if (Lv.type[c] === core.T_PIPE) { if (pc === 3) nT++; if (pc === 4) nPlus++; } if (Lv.lock[c]) nLock++; if (Lv.type[c] === core.T_VALVE) nV++; }
      if (Lv.type[c] === core.T_CROSS) nX++;
      if (Lv.type[c] === 3) nOut++;
    }
    res.push({ target: { Lv, rots: r.rots }, n, par, diff, size: Lv.w + 'x' + Lv.h, nodes: r.nodes, solverCost: cost, plan, nT, nPlus, nLock, nX, nV, nOut, colors: Lv.colors, leak: Lv.leak });
  }
  console.log('All', LEVELS.length, 'levels regenerated, solved, and embedded par = exact minimum turns:', ok,
    '(' + totalNodes + ' search nodes, ' + ((Date.now() - t0) / 1000).toFixed(1) + 's)');
  console.log('Difficulty and par strictly increase every level:', mono);
  console.log('Difficulty L1..L100:', res[0].diff, '->', res[99].diff, ' par:', res[0].par, '->', res[99].par);
  for (const n of [1, 6, 11, 21, 31, 46, 61, 76, 91, 100]) {
    const r = res[n - 1];
    console.log('  L' + n, 'board', r.size, 'outlets', r.nOut, 'colours', r.colors, 'tees', r.nT, 'crosses+', r.nPlus, 'locked', r.nLock,
      'leakRule', r.leak, 'X', r.nX, 'valves', r.nV, 'par', r.par, 'diff', r.diff, 'solverNodes', r.nodes);
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touch(cdp, x, y, hold) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await touch(cdp, b.x + b.width / 2, b.y + b.height / 2, 60);
}

async function playLevel(browser, n, plan, target) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
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
  if (await page.isVisible('#intro')) { await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  await sleep(900);
  const t0 = Date.now(); let actions = 0;
  for (const step of plan) {
    const p = await page.evaluate(c => window.__game.cellCenter(c), step.c);
    if (step.k === 3) { await touch(cdp, p.x, p.y, 520); actions++; await sleep(150 + Math.floor(Math.random() * 80)); }
    else for (let i = 0; i < step.k; i++) { await touch(cdp, p.x, p.y, 50); actions++; await sleep(150 + Math.floor(Math.random() * 80)); }
  }
  for (let i = 0; i < 40 && !(await page.isVisible('#win')); i++) await sleep(150);
  await sleep(900);
  const st = await page.evaluate(() => window.__game.state());
  if (target) { const got = await page.evaluate(() => window.__game.rots()); const bad = []; for (let c = 0; c < got.length; c++) if (got[c] !== target.rots[c] && core.rotatable(target.Lv, c) && core.rotl(target.Lv.base[c], got[c]) !== core.rotl(target.Lv.base[c], target.rots[c])) bad.push(c + ':' + target.Lv.type[c] + ':' + target.Lv.base[c] + ' got ' + got[c] + ' want ' + target.rots[c] + ' init ' + target.Lv.rot[c]); if (bad.length) console.log('  mismatched cells', bad.join(', ')); }
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8 * 1024 * 1024) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && st.win && winVisible, moves: st.moves, par: st.par, actions, secs, errors, video: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
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
    const r = await playLevel(browser, n, res[n - 1].plan, res[n - 1].target);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'touch actions', r.actions, 'moves', r.moves, '/ par', r.par,
      'time', r.secs + 's', r.video, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
