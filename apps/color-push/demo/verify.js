// Verification for 積木推推樂 (color-push).
// 1) Uses the page's own core (CORE-START/CORE-END) to replay every embedded solution to a win, re-prove the minimum push
//    count with A* where it was proven, and check that minimum pushes never drop and difficulty strictly increases.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP touch events) at human pace:
//    taps to walk (BFS walking, no pushes) and swipes to push, recording level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUTDIR || __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {parseLevel, initState, step, solve, isWon, expandMoves};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const CH = [[1, '基本'], [11, '多色'], [21, '拆排'], [31, '冰面'], [41, '推力 P=3'], [51, '黏合'], [66, '變色格'], [81, '單向門'], [91, '全要素']];

function solveAll(reprove) {
  let ok = true, proven = 0, reproven = 0, mono = true, minStep = 1;
  const res = [];
  for (let n = 1; n <= LEVELS.length; n++) {
    const e = LEVELS[n - 1], L = C.parseLevel(e), pushes = e.s.map(v => ({ c: v >> 2, d: v & 3 }));
    const ex = C.expandMoves(L, C.initState(L), pushes);
    const good = !!ex && C.isWon(L, ex.S) && pushes.length === e.m;
    if (!good) { ok = false; console.log('LEVEL', n, 'SOLUTION DOES NOT REPLAY'); }
    if (!e.u) {
      proven++;
      if (reprove) {
        const r = C.solve(L, { limit: 600000 });
        if (r.len === e.m) reproven++; else if (r.len > 0) { ok = false; console.log('LEVEL', n, 'optimum mismatch', r.len, 'vs', e.m); }
      }
    }
    const chStart = CH.some(c => c[0] === n);
    if (n > 1 && ((!chStart && n < 91 && e.m < LEVELS[n - 2].m) || e.d < LEVELS[n - 2].d * 1.01)) { mono = false; console.log('LEVEL', n, 'not harder than', n - 1); }
    if (n > 1) minStep = Math.min(minStep, e.d / LEVELS[n - 2].d - 1);
    const mech = { ice: L.hasIce, glue: L.hasGlue, paint: L.hasPaint, door: L.hasDoor, P: L.P, colors: new Set(L.S0.col).size };
    res.push({ n, m: e.m, d: e.d, k: e.k, moves: ex ? ex.moves : null, size: L.w + 'x' + L.h, blocks: L.n, mech });
  }
  console.log('All', LEVELS.length, 'levels solvable (stored solutions replay to a win with the game core):', ok);
  console.log('Minimum pushes proven by exact A*:', proven, '/', LEVELS.length, reprove ? '(re-proven now: ' + reproven + ')' : '', '; the rest use the best solution found by weighted A*');
  console.log('Difficulty (m x log10(states) x (1+0.1 x mechanisms)) rises every level by >= 1% (smallest step ' + (minStep * 100).toFixed(1) + '%), minimum pushes never drop within chapters 1-8:', mono);
  console.log('Difficulty L1 -> L100:', LEVELS[0].d, '->', LEVELS[LEVELS.length - 1].d, '; minimum pushes L1 -> L100:', LEVELS[0].m, '->', LEVELS[LEVELS.length - 1].m);
  for (const [lv, name] of CH) { const r = res[lv - 1]; if (!r) continue; console.log('  L' + lv, name.padEnd(7), 'board', r.size, 'blocks', r.blocks, 'colours', r.mech.colors, 'pushes', r.m, 'difficulty', r.d, 'states(4 pushes)', r.k, 'ice', r.mech.ice, 'P', r.mech.P, 'glue', r.mech.glue, 'paint', r.mech.paint, 'door', r.mech.door); }
  for (const n of [50, 75, 99, 100]) { const r = res[n - 1]; if (r) console.log('  L' + n, 'pushes', r.m, 'difficulty', r.d, 'total moves incl. walking', r.moves.length); }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d], len = 60, steps = 5;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await sleep(18); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * len * i / steps, y: y + DY * len * i / steps }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function idle(page) { for (let k = 0; k < 400; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.animating) return st; await sleep(25); } }

async function playLevel(browser, n) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(700);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tap(cdp, page, '#iOk'); await sleep(400); }
  await sleep(600);
  const sol = await page.evaluate(() => window.__game.sol());
  const def = LEVELS[n - 1], Lc = C.parseLevel(def);
  const key = S => S.pos.map((x, i) => x * 8 + S.col[i]).sort((a, b) => a - b).join(',');
  let exp = C.initState(Lc), retries = 0;
  const t0 = Date.now();
  for (let i = 0; i < sol.length; i++) {
    const p = sol[i];
    let st = await idle(page);
    if (st.p !== p.c) {
      const xy = await page.evaluate(c => window.__game.cellCenter(c), p.c);
      await tapXY(cdp, xy.x, xy.y);           // tap a floor cell: the puppet walks there (BFS, no pushes)
      await sleep(150); st = await idle(page);
      if (st.p !== p.c) throw new Error('walk failed on level ' + n);
      await sleep(150 + Math.floor(Math.random() * 120));
    }
    await swipe(cdp, 195, 430, p.d);           // swipe anywhere to push
    await sleep(150); await idle(page);
    const next = C.expandMoves(Lc, exp, [p]).S;
    let snap = await page.evaluate(() => window.__game.snap());
    if (key(snap) !== key(next)) {
      // a human would notice the slip: undo until the board is back to where it was, then try that push again
      retries++; if (retries > 20) throw new Error('too many retries on level ' + n);
      for (let k = 0; k < 6 && key(snap) !== key(exp); k++) { await tap(cdp, page, '#bUndo'); await sleep(250); await idle(page); snap = await page.evaluate(() => window.__game.snap()); }
      i--; continue;
    }
    exp = next;
    await sleep(160 + Math.floor(Math.random() * 140));
  }
  await sleep(1800);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 70 ? 2 : 1;
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') && f.endsWith('.mp4') || f.startsWith('level-' + n + '-') && f.endsWith('x.mp4')) fs.rmSync(path.join(OUT, f));
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', '-an', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, retries, cleared: st.status === 'won' && winVisible, pushes: st.pushes, steps: st.steps, opt: sol.length, secs: secs.toFixed(1), errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  solveAll(args.includes('--reprove'));
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'pushes', r.pushes, '/ minimum', r.opt, 'walk steps', r.steps, 'slips undone', r.retries, 'time', r.secs + 's', 'video', r.mp4, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
