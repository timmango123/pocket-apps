// Browser verification for 深海珍珠 (gem-match).
// For each target level: the game's own core (extracted from index.html between CORE markers) + its greedy AI
// finds a fixed attempt seed that the AI clears, then the real page is driven in Chromium with real touch swipes
// (CDP Input.dispatchTouchEvent) at human pace (>=150 ms between actions). After every move the page's board is
// compared with the Node prediction. Records level-NN.mp4 and level-NN-result.png next to this file.
// Usage: node verify.js [levels...]   (default 50 75 99 100)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const TUNE = JSON.parse(html.match(/var TUNE = (\[[\s\S]*?\]);/)[1]);
const C = new Function(coreSrc + '\nreturn {levelDef, newGame, simulate, trySwap, aiPick};')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
function def(n){ const t = TUNE[n - 1]; return C.levelDef(n, t[0] / 100, t[1], t[3]); }

function findSeed(n){
  const L = def(n);
  for (let s = 1; s < 5000; s++) { const seed = s * 2654435 + n; const r = C.simulate(L, seed, true); if (r.win) return { seed, log: r.log, tries: s, score: r.score }; }
  throw new Error('no winning seed for level ' + n);
}
async function touch(cdp, type, x, y){ await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 6, radiusY: 6, force: 1 }] }); }
async function tapAt(cdp, x, y){ await touch(cdp, 'touchStart', x, y); await sleep(70); await touch(cdp, 'touchEnd'); }
async function tapSel(cdp, page, sel){ const b = await page.locator(sel).boundingBox(); await tapAt(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function swipe(cdp, x0, y0, x1, y1){
  const steps = 7; await touch(cdp, 'touchStart', x0, y0);
  for (let i = 1; i <= steps; i++) { await sleep(16); await touch(cdp, 'touchMove', x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); }
  await sleep(20); await touch(cdp, 'touchEnd');
}
async function idle(page){ for (let k = 0; k < 600; k++) { const st = await page.evaluate(() => { const s = window.__game.state(); return { busy: s.busy, status: s.status }; }); if (!st.busy) return st; await sleep(25); } }

async function playLevel(browser, n){
  const plan = findSeed(n);
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // like a player: title -> map -> unlock-all switch -> level node
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.evaluate(n => document.querySelector('.node[data-n="' + n + '"]').scrollIntoView({ block: 'center' }), n); await sleep(600);
  await page.evaluate(s => window.__game.setSeed(s), plan.seed);
  await tapSel(cdp, page, '.node[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#intro')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); }
  await sleep(1400);
  // Node mirror of the same game for per-move cross-checking
  const S = C.newGame(def(n), plan.seed); let mismatches = 0;
  const t0 = Date.now();
  for (let i = 0; i < plan.log.length; i++) {
    const [a, b] = plan.log[i];
    const st = await page.evaluate(() => window.__game.state());
    const B = st.board, w = st.w;
    const ax = B.x + (a % w + 0.5) * B.cs, ay = B.y + (Math.floor(a / w) + 0.5) * B.cs;
    const bx = B.x + (b % w + 0.5) * B.cs, by = B.y + (Math.floor(b / w) + 0.5) * B.cs;
    await swipe(cdp, ax, ay, ax + (bx - ax) * 0.8, ay + (by - ay) * 0.8);
    C.trySwap(S, a, b, null);
    await sleep(60); await idle(page);
    const after = await page.evaluate(() => window.__game.state());
    if (after.over !== 'win' && (after.cells.join() !== Array.from(S.cell).join() || after.moves !== S.moves)) mismatches++;
    await sleep(250 + Math.floor(Math.random() * 200)); // human pause between moves
  }
  for (let k = 0; k < 40 && !(await page.isVisible('#win')) && !(await page.isVisible('#fail')); k++) await sleep(250);
  await sleep(2600);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  const stars = await page.locator('#wStars .on').count();
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-r', '30', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, seed: plan.seed, seedTries: plan.tries, cleared: st.over === 'win' && winVisible, moves: plan.log.length, movesLeft: def(n).moves - plan.log.length, score: st.score, stars, mismatches, secs, errors, mp4MB: (fs.statSync(mp4).size / 1048576).toFixed(1) };
}
(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'seed', r.seed, '(AI needed', r.seedTries, 'attempt seeds)', 'swipes', r.moves, 'moves left', r.movesLeft, 'score', r.score, 'stars', r.stars, 'board mismatches', r.mismatches, 'time', r.secs + 's', 'video', r.mp4MB + 'MB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
  }
  await browser.close();
})();
