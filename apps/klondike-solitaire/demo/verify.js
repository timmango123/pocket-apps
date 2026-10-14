// Verification for 經典接龍 (klondike-solitaire).
// 1) Node: re-deals all 100 embedded levels with the game's own core (extracted from index.html between
//    CORE-START/CORE-END), solves each with the game's solver, replays the solution move-by-move with the
//    rule engine, recomputes the difficulty score S = ln(N) + L/40 + R*0.8 + rule coefficient and asserts
//    it matches the embedded value and is strictly increasing level over level.
// 2) Chromium: a bot clears levels 50, 75, 99 and 100 in the real page using real touch input
//    (CDP Input.dispatchTouchEvent: taps on the stock, drags for every card move) at human pace
//    (>= 150 ms between actions), recording an mp4 and a result screenshot per level.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {deal, solve, doDraw, doMove, isWon, cloneSt, diffScore, levelMode};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const MAXN = 600000;

function solveAll() {
  const res = []; let ok = true, prevS = -1; const t0 = Date.now();
  if (LEVELS.length !== 100) { ok = false; console.log('expected 100 levels, got', LEVELS.length); }
  for (let n = 1; n <= LEVELS.length; n++) {
    const [seed, S, N0] = LEVELS[n - 1], m = C.levelMode(n);
    const st = C.deal(seed, m.draw, m.limit);
    const r = C.solve(st, MAXN);
    let good = r.ok;
    // independent replay of the solution with the rule engine
    if (good) { const s = C.cloneSt(st); for (const a of r.path) { if (a === 'D') { if (!C.doDraw(s)) { good = false; break; } } else if (!C.doMove(s, a)) { good = false; break; } } good = good && C.isWon(s); }
    const S2 = good ? C.diffScore(r.nodes, r.path.length, r.R, m.draw, m.limit) : NaN;
    const sOk = Math.abs(S2 - S) < 0.002 && S2 > prevS;
    if (!good || !sOk) { ok = false; console.log('LEVEL', n, 'PROBLEM solvable=', good, 'S=', S2, 'embedded', S, 'prev', prevS); }
    prevS = S2;
    res.push({ n, seed, draw: m.draw, limit: m.limit, N: r.nodes, L: good ? r.path.length : 0, R: r.R, S: S2, path: r.path });
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`All ${res.length} levels solvable (replayed) with strictly increasing S: ${ok}  [${secs}s]`);
  const gaps = res.slice(1).map((r, i) => r.S - res[i].S);
  console.log(`S range ${res[0].S.toFixed(2)} -> ${res[99].S.toFixed(2)}; min step ${Math.min(...gaps).toFixed(3)}, mean step ${(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(3)}`);
  for (const n of [1, 10, 25, 40, 41, 50, 60, 61, 75, 85, 86, 99, 100]) {
    const r = res[n - 1];
    console.log(`  level ${String(n).padStart(3)}  draw-${r.draw} ${r.limit < 0 ? 'unlimited ' : 'limit ' + r.limit + '   '}  nodes N=${String(r.N).padStart(7)}  solution L=${String(r.L).padStart(3)} actions  recycles R=${r.R}  S=${r.S.toFixed(3)}`);
  }
  return { res, ok };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchDrag(cdp, a, b) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    await sleep(22);
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }] });
  }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const bb = await page.locator(sel).boundingBox();
  await touchTap(cdp, bb.x + bb.width / 2, bb.y + bb.height / 2);
}
const state = page => page.evaluate(() => window.__game.state());
async function settle(page) { for (let k = 0; k < 100; k++) { const s = await state(page); if (!s.anim) return s; await sleep(30); } return state(page); }

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  // like a player: title -> level select -> unlock-all switch -> level tile -> rule intro
  await tapSel(cdp, page, '#tLevels'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  await sleep(1400); // deal animation
  const t0 = Date.now(); let actions = 0, failed = null;
  for (let i = 0; i < sol.length; i++) {
    const s = await settle(page);
    if (s.status !== 'play') break; // auto-collect took over (all cards face up, stock empty)
    const a = sol[i], before = s.moves;
    if (a === 'D') { const p = await page.evaluate(() => window.__game.stockPt()); await touchTap(cdp, p.x, p.y); }
    else {
      const src = await page.evaluate(m => window.__game.srcPt(m.from, m.fc, m.idx), a);
      const target = await page.evaluate(m => { const g = window.__game; return m.to === 'f' ? g.dstPt('f', 0, g.cardSuit(m.from, m.fc, m.idx)) : g.dstPt('t', m.tc); }, a);
      await touchDrag(cdp, src, target);
    }
    actions++;
    await sleep(120);
    const s2 = await state(page);
    if (s2.moves !== before + 1 && s2.status === 'play') { failed = 'action ' + i + ' ' + JSON.stringify(a) + ' did not register'; break; }
    await sleep(150 + Math.floor(Math.random() * 120)); // human pace between actions
  }
  // wait for auto-collect, the bouncing-cards finale and the result card
  for (let k = 0; k < 200 && !(await page.isVisible('#win')); k++) await sleep(100);
  await sleep(1300);
  const st = await state(page);
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const mp4 = path.join(OUT, 'level-' + n + '-3x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-filter:v', 'setpts=PTS/3,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && st.won && winVisible && !failed, failed, moves: st.moves, actions, solLen: sol.length, score: st.score, stars: st.stars, secs, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const { res, ok } = solveAll();
  if (args.includes('--solve-only')) { process.exit(ok ? 0 : 1); }
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].path);
    console.log(`BOT level ${n}: ${r.cleared ? 'CLEARED' : 'NOT CLEARED'}${r.failed ? ' (' + r.failed + ')' : ''}  touch actions ${r.actions}/${r.solLen} (rest auto-collected)  moves ${r.moves}  score ${r.score}  stars ${r.stars}  play time ${r.secs}s  video ${r.mp4} ${r.mp4KB}KB  ${r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors'}`);
  }
  await browser.close();
})();
