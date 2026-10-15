// Verification for 金字塔接龍 (pyramid-solitaire).
// 1) Node: extracts the game's own rules + DFS solver from index.html (CORE-START/CORE-END) and, for all 100 embedded
//    levels, solves the deal under that level's recycle rule, replays the solution move-by-move through the rules
//    (each move must be legal, the pyramid must end empty), recomputes the difficulty score S and asserts that S
//    matches the embedded value and rises strictly from level to level. Prints full solutions for 50/75/99/100.
// 2) Chromium: a bot clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent)
//    at human pace (>=150 ms between taps), recording level-NN.mp4 and level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {dealFromSeed,initState,solve,legalMoves,applyMove,isWon,randomRate,difficultyScore,deferredCount,stockLeft};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[.*?\]);/)[1]);
const CAP = 60000, RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'], SUIT = ['♠', '♥', '♦', '♣'];

function sameMove(a, b) { if (a.t !== b.t) return false; if (a.t === 'p') return (a.a === b.a && a.b === b.b) || (a.a === b.b && a.b === b.a); if (a.t === 'k') return a.a === b.a; return true; }
function cardName(D, loc) { const c = D.cards[loc]; return RANK[c % 13 + 1] + SUIT[Math.floor(c / 13)]; }
function locName(D, loc) { return (loc < 28 ? '塔' + loc : '庫') + ':' + cardName(D, loc); }
function moveText(D, m) { return m.t === 'd' ? '翻牌' : m.t === 'r' ? '翻回' : m.t === 'k' ? 'K ' + locName(D, m.a) : locName(D, m.a) + '+' + locName(D, m.b); }

function solveAll() {
  const res = []; let ok = true, prevS = -Infinity, minStep = Infinity;
  for (let n = 1; n <= LEVELS.length; n++) {
    const [seed, R, Semb] = LEVELS[n - 1], D = C.dealFromSeed(seed);
    const r = C.solve(D, C.initState(), R, CAP);
    let good = r.ok, s = C.initState();
    if (good) for (const m of r.sol) { if (!C.legalMoves(D, s, R).some(x => sameMove(x, m))) { good = false; break; } s = C.applyMove(D, s, m); }
    good = good && C.isWon(s);
    const p = good ? C.randomRate(D, R, 500, seed) : 0;
    const S = good ? C.difficultyScore(D, R, r, p) : NaN;
    const match = Math.abs(S - Semb) < 0.002, rising = S > prevS;
    if (n > 1) minStep = Math.min(minStep, S - prevS);
    if (!good || !match || !rising) { ok = false; console.log('LEVEL', n, 'PROBLEM solved', good, 'S', S, 'embedded', Semb, 'rising', rising); }
    prevS = S;
    res.push({ n, seed, R, S, nodes: r.nodes, p, def: good ? C.deferredCount(D, r.sol, R) : 0, sol: r.sol, D, left: C.stockLeft(s) });
  }
  console.log('All', LEVELS.length, 'levels proven clearable, replay-checked, S matches embedded and strictly increasing:', ok);
  console.log('S range', res[0].S.toFixed(2), '→', res[99].S.toFixed(2), '| smallest level-to-level increase', minStep.toFixed(3), '| mean growth', Math.pow(res[99].S / res[0].S, 1 / 99).toFixed(4) + '×/level');
  for (const [a, b] of [[1, 30], [31, 70], [71, 100]]) {
    const t = res.slice(a - 1, b);
    console.log(`  levels ${a}-${b}: recycles ${t[0].R}, S ${t[0].S.toFixed(2)}–${t[t.length - 1].S.toFixed(2)}, solver nodes ${Math.min(...t.map(x => x.nodes))}–${Math.max(...t.map(x => x.nodes))}, random-player win rate ${(t[0].p * 100).toFixed(1)}% → ${(t[t.length - 1].p * 100).toFixed(1)}%`);
  }
  for (const n of [1, 10, 25, 50, 75, 99, 100]) { const x = res[n - 1]; console.log(`  level ${n}: seed ${x.seed}, recycles ${x.R}, S ${x.S.toFixed(2)}, nodes ${x.nodes}, deferred ${x.def}, random win ${(x.p * 100).toFixed(1)}%, solution ${x.sol.length} moves`); }
  for (const n of [50, 75, 99, 100]) { const x = res[n - 1]; console.log(`  SOLUTION level ${n}: ` + x.sol.map(m => moveText(x.D, m)).join(' → ')); }
  return { res, ok };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function tapLoc(cdp, page, loc) { const r = await page.evaluate(l => window.__game.rect(l), loc); await tapXY(cdp, r.x + r.w / 2, r.y + Math.min(r.h * 0.3, 22)); }
async function settle(page) { for (let k = 0; k < 100; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.anim) return st; await sleep(20); } }

async function playLevel(browser, n, sol) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(700);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(400); }
  const t0 = Date.now(); let taps = 0;
  for (const m of sol) {
    if (m.t === 'd' || m.t === 'r') { const r = await page.evaluate(() => window.__game.stock()); await tapXY(cdp, r.x + r.w / 2, r.y + r.h / 2); taps++; }
    else if (m.t === 'k') { await tapLoc(cdp, page, m.a); taps++; }
    else { await tapLoc(cdp, page, m.a); taps++; await sleep(170 + Math.random() * 80); await tapLoc(cdp, page, m.b); taps++; }
    await settle(page);
    await sleep(170 + Math.floor(Math.random() * 120));
  }
  await sleep(2600);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, score: st.score, moves: sol.length, taps, secs: secs.toFixed(1), errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const { res } = solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].sol);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'score', r.score, 'moves', r.moves, 'taps', r.taps, 'time', r.secs + 's', 'avg', (r.secs * 1000 / r.taps).toFixed(0) + 'ms/tap', 'video', r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
