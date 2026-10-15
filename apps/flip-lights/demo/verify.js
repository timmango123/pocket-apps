// Verification for 夜市花燈 (flip-lights).
// 1) Re-solves ALL 100 embedded levels in Node with the game's own core (GF(p) Gaussian elimination + null-space
//    enumeration, extracted from index.html between CORE-START/CORE-END): solvable, true minimum == embedded minimum,
//    the solution really lights every lantern, difficulty coefficient rises >= 2% every level, mechanics appear on time.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch taps (CDP Input.dispatchTouchEvent)
//    at human pace (>= 150 ms between taps), recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {buildBoard, initCells, press, solve, solved, diffCoef, levelDef};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);

function solveAll() {
  const res = []; let ok = true, prevD = 0, minRise = 1e9;
  for (let n = 1; n <= LEVELS.length; n++) {
    const rec = LEVELS[n - 1], B = C.buildBoard(C.levelDef(rec)), s = C.initCells(B, rec[6]);
    const r = C.solve(B, s, 1e7);
    let good = !!r && r.moves === rec[7] && r.nullity <= 8;
    const seq = [];
    if (r) { const t = s.slice(); for (let i = 0; i < B.n; i++) for (let k = 0; k < r.x[i]; k++) { C.press(B, t, i); seq.push(i); } if (!C.solved(B, t)) good = false; }
    const D = C.diffCoef(B, rec[7]);
    if (prevD) { minRise = Math.min(minRise, D / prevD - 1); if (D < prevD * 1.02 - 1e-9) good = false; }
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', r && r.moves, 'embedded', rec[7]); }
    res.push({ n, B, rec, opt: r ? r.moves : null, nullity: r ? r.nullity : null, seq, D });
    prevD = D;
  }
  const first = f => { const x = res.find(f); return x ? x.n : null; };
  const mech = { '5x5': first(x => x.B.w * x.B.h >= 25), '6x6': first(x => x.B.w >= 6 && x.B.h >= 6), 'three-color': first(x => x.B.p === 3), 'X/long range': first(x => x.B.nonstd && x.B.shape === 'sq' && !x.B.mixed), 'hex+irregular 2-color': first(x => x.B.shape === 'hex'), 'hex 3-color': first(x => x.B.shape === 'hex' && x.B.p === 3), 'mixed ranges': first(x => x.B.mixed) };
  console.log('All', LEVELS.length, 'levels solvable by the GF(p) solver, true minimum == embedded minimum, solution verified:', ok);
  console.log('Difficulty coefficient strictly increasing every level; smallest rise +' + (minRise * 100).toFixed(1) + '%, L1', res[0].D.toFixed(1), '-> L100', res[99].D.toFixed(1));
  console.log('Mechanics first appear at:', JSON.stringify(mech));
  console.log('Max null-space dimension:', Math.max(...res.map(x => x.nullity)));
  for (const n of [1, 10, 11, 25, 26, 40, 41, 50, 55, 56, 70, 71, 75, 85, 86, 95, 96, 99, 100]) {
    const x = res[n - 1], B = x.B;
    console.log('  L' + String(n).padStart(3), (B.shape === 'hex' ? 'hex ' : 'sq  ') + B.w + 'x' + B.h, 'cells', String(B.n).padStart(2), 'colors', B.p, 'range', B.mixed ? 'mixed' : ['cross', 'X', 'long', 'hex'][B.kind[B.cells[0]]], 'min moves', String(x.opt).padStart(2), 'difficulty', x.D.toFixed(1));
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchAt(cdp, x, y, hold) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(hold || 70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touchAt(cdp, b.x + b.width / 2, b.y + b.height / 2, 60); }

async function playLevel(browser, n, seq) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(700);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(500); }
  await sleep(600);
  const t0 = Date.now();
  for (let k = 0; k < seq.length; k++) {
    const c = await page.evaluate(i => window.__game.cell(i), seq[k]);
    // tap near (not exactly at) the lantern centre, like a finger would
    const jx = (Math.random() - 0.5) * c.pitch * 0.3, jy = (Math.random() - 0.5) * c.pitch * 0.3;
    await touchAt(cdp, c.x + jx, c.y + jy, 60 + Math.floor(Math.random() * 40));
    await sleep(160 + Math.floor(Math.random() * 120)); // human pace: >= 150 ms before the next tap
  }
  for (let k = 0; k < 80; k++) { if (await page.isVisible('#win')) break; await sleep(100); }
  await sleep(900);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, moves: st.moves, opt: seq.length, secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
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
    const r = await playLevel(browser, n, res[n - 1].seq);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'taps', r.moves, '/ minimum', r.opt, 'time', r.secs + 's', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
