// Bot verification for 中國象棋 殘局闖關: clears levels 50, 75, 99, 100 in the real page with real touch input
// (CDP Input.dispatchTouchEvent taps on the canvas) at human pace, recording level-NN.mp4 + level-NN-result.png.
// The bot decides its moves with the game's own engine code (MateSolver from the CORE block of index.html);
// black's replies come from the page's own Web Worker defence.
// Usage: node verify.js [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const XQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return XQ;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let touchId = 1;
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: touchId }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  touchId++;
}
async function tap(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function waitTurn(page) {
  for (let k = 0; k < 600; k++) { const st = await page.evaluate(() => window.__game.state()); if (st.over || (!st.pending && !st.anim && st.side === 0)) return st; await sleep(50); }
  throw new Error('timeout waiting for turn');
}
async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#mPuzzle'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(1300);
  await tap(cdp, page, '#iGo'); await sleep(700);
  const t0 = Date.now(), played = [];
  let st;
  for (let turn = 0; turn < 40; turn++) {
    st = await waitTurn(page);
    if (st.over) break;
    // replay the real game state and ask the engine core for the fastest forced mate
    const p = XQ.fromFen(st.startFen || st.fen);
    const left = st.budget - Math.ceil(st.moves.length / 2);
    const cur = XQ.fromFen(st.fen);
    const best = new XQ.MateSolver(false).bestAttack(cur, left);
    if (!best) throw new Error('bot found no mate at ' + st.fen);
    const mv = XQ.iccs(best.move); played.push(XQ.moveName(cur, best.move));
    await sleep(350 + Math.floor(Math.random() * 250));             // human "thinking" pause
    const a = await page.evaluate(s => window.__game.sqToClient(s), mv.slice(0, 2));
    await tapXY(cdp, a[0], a[1]);                                      // select piece
    await sleep(260 + Math.floor(Math.random() * 160));
    const b = await page.evaluate(s => window.__game.sqToClient(s), mv.slice(2, 4));
    await tapXY(cdp, b[0], b[1]);                                      // drop on target
    await sleep(200);
  }
  for (let k = 0; k < 80 && !(await page.isVisible('#result')); k++) await sleep(50);
  await sleep(900);
  st = await page.evaluate(() => window.__game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: !!(st.over && st.over.winner === 0 && st.resultVisible), title, redMoves: Math.ceil(st.moves.length / 2), budget: st.budget, line: played.join(' '), secs, errors, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}
(async () => {
  const lv = process.argv.slice(2).filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  let all = true;
  for (const n of targets) {
    const r = await playLevel(browser, n);
    all = all && r.cleared && !r.errors.length;
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', '(' + r.title + ')', 'red moves', r.redMoves, '/ limit', r.budget, '| time', r.secs + 's | video', r.mp4KB + 'KB |', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
    console.log('   red played:', r.line);
  }
  await browser.close();
  process.exitCode = all ? 0 : 1;
})();
