// Verification for 蜘蛛接龍 (spider-solitaire).
// 1) Re-solves ALL 100 embedded level deals in Node with the game's own core code (CORE-START/END in ../index.html):
//    every deal must be won by the solver (solution replayed through the real rules) and the difficulty score S must
//    match the embedded value and rise strictly from level to level.
// 2) A bot clears levels 50, 75, 99 and 100 in the real page (Chromium, 390x844, DPR 2) using real touch input
//    (CDP Input.dispatchTouchEvent drags and taps) at human pace, recording level-NN(.mp4|-4x.mp4) + level-NN-result.png.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const OUT = __dirname, APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const { metrics } = require('./gen.js');
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[^\n]*\]);/)[1]);

function solveAll(only) {
  const res = []; let ok = true, prevS = -1, t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [seed, suits, S100, len, nodes] = LEVELS[n - 1];
    if (only && !only.includes(n) && n !== 1) { res.push(null); continue; }
    const m = metrics(seed, suits, n >= 61);
    const good = m.ok && Math.round(m.S * 100) === S100 && m.len === len && m.nodes === nodes && S100 > prevS;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', JSON.stringify({ ok: m.ok, S: m.S, len: m.len, nodes: m.nodes }), 'embedded', LEVELS[n - 1]); }
    prevS = S100; res.push(m);
  }
  if (!only) {
    console.log('All', LEVELS.length, 'levels solved by the core solver, S matches and strictly increases:', ok, '(' + ((Date.now() - t0) / 1000).toFixed(0) + 's)');
    const seg = (a, b) => { const x = res.slice(a - 1, b); return 'S ' + x[0].S.toFixed(2) + '→' + x[x.length - 1].S.toFixed(2) + ', nodes ' + Math.min(...x.map(c => c.nodes)) + '–' + Math.max(...x.map(c => c.nodes)) + ', moves ' + Math.min(...x.map(c => c.len)) + '–' + Math.max(...x.map(c => c.len)); };
    console.log('  1–40 單花色 (寬鬆):', seg(1, 40));
    console.log('  41–60 雙花色 (寬鬆):', seg(41, 60));
    console.log('  61–75 雙花色 (嚴格):', seg(61, 75));
    console.log('  76–100 四花色 (嚴格):', seg(76, 100));
  }
  for (const n of [1, 25, 50, 75, 99, 100]) if (res[n - 1]) console.log('  level', n, 'suits', res[n - 1].suits, 'S', res[n - 1].S.toFixed(2), 'solution moves', res[n - 1].len, 'expanded nodes', res[n - 1].nodes);
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchDrag(cdp, a, b) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  await sleep(60);
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps, e = p * p * (3 - 2 * p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }] });
    await sleep(16);
  }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const bb = await page.locator(sel).boundingBox();
  await touchTap(cdp, bb.x + bb.width / 2, bb.y + bb.height / 2);
}
async function settle(page) {
  for (let k = 0; k < 300; k++) { const st = await page.evaluate(() => window.__spider.state()); if (!st || !st.anim) return st; await sleep(30); }
}

async function playLevel(browser, n, moves) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(600);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(500); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(500);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(900);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tapSel(cdp, page, '#iOk'); await sleep(500); }
  await settle(page); await sleep(400);
  const t0 = Date.now(); let i = 0;
  for (const m of moves) {
    if (m === 0xFFFF) {
      const p = await page.evaluate(() => window.__spider.stock());
      await touchTap(cdp, p.x, p.y);
    } else {
      const from = m & 15, to = (m >> 4) & 15, cnt = m >> 8;
      const pts = await page.evaluate(([f, t, c]) => { const st = window.__spider.state(); return { a: window.__spider.cardPoint(f, st.cols[f] - c), b: window.__spider.colTop(t) }; }, [from, to, cnt]);
      await touchDrag(cdp, pts.a, pts.b);
    }
    i++;
    await sleep(60); await settle(page);
    const st = await page.evaluate(() => window.__spider.state());
    if (st.moves !== i) { errors.push('move ' + i + ' (' + m + ') not applied, page moves=' + st.moves); break; }
    await sleep(150 + Math.floor(Math.random() * 90)); // human reaction time between actions
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#win')); k++) await sleep(100);
  await sleep(700);
  const st = await page.evaluate(() => window.__spider.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.unlinkSync(path.join(OUT, f));
  const fast = secs > 70, name = 'level-' + n + (fast ? '-4x' : '') + '.mp4', mp4 = path.join(OUT, name);
  const vf = fast ? ['-vf', 'setpts=PTS/4', '-r', '30'] : [];
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.won && st.done === 8 && winVisible, moves: st.moves, score: st.score, planned: moves.length, secs: secs.toFixed(1), errors, video: name, mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const res = solveAll(args.includes('--solve-only') || !lv.length ? null : targets);
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].moves);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'moves', r.moves, '/ planned', r.planned, 'score', r.score, 'play time', r.secs + 's', r.video, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
