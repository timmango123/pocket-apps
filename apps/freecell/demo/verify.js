// Verification for 新接龍 (freecell).
// 1) Re-solves ALL 100 embedded levels in Node with the game's own core code (extracted from index.html between
//    CORE-START/CORE-END): asserts solvable with that level's free-cell count, that expanded nodes / L* / S match the
//    embedded table, that S strictly increases level by level, and that the embedded solution replays to a win.
// 2) A bot clears levels 50, 75, 99, 100 in the real page in Chromium using real touch input (CDP
//    Input.dispatchTouchEvent): taps for foundation moves, press-and-drag for everything else, at human pace
//    (>=150 ms between actions). Records level-NN(.mp4|-Nx.mp4) and level-NN-result.png in this folder.
// Usage: node verify.js [--solve-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {msDeal, newState, cloneS, solve, expandSolution, isWon, capacity, isSafe, cRank};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const COEF = { 4: 0, 3: 2.5, 2: 5 };
const SOLA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function decodeSol(str) { const out = []; for (let i = 0; i + 1 < str.length; i += 2) { const c = SOLA.indexOf(str[i]), d = str[i + 1]; out.push({ k: d === 'f' ? 'f' : d === 'r' ? 'r' : 'c', to: d === 'f' || d === 'r' ? 0 : +d, card: c }); } return out; }

function solveAll() {
  const res = []; let ok = true, prevS = -1, t0 = Date.now();
  for (let n = 1; n <= LEVELS.length; n++) {
    const [deal, cells, Lstar, Semb, sol] = LEVELS[n - 1];
    const S0 = core.newState(core.msDeal(deal), cells);
    const r = core.solve(S0, { limit: 300000, w: 1.5 });
    const S = r.ok ? Math.log(r.nodes) + r.len / 30 + COEF[cells] : NaN;
    const full = core.expandSolution(S0, decodeSol(sol));
    const expected = cells === (n <= 50 ? 4 : n <= 80 ? 3 : 2);
    const good = r.ok && r.len === Lstar && Math.abs(S - Semb) < 0.002 && S > prevS && !!full && expected;
    if (!good) { ok = false; console.log('LEVEL', n, 'PROBLEM', JSON.stringify({ ok: r.ok, len: r.len, Lstar, S, Semb, prevS, replay: !!full, cellsOk: expected })); }
    prevS = S;
    res.push({ n, deal, cells, nodes: r.nodes, len: r.len, S, full });
  }
  const ss = res.map(r => r.S), gaps = ss.slice(1).map((s, i) => s - ss[i]);
  console.log('All', LEVELS.length, 'levels solvable (with their 4/3/2 free cells), table matches, S strictly increasing:', ok,
    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log('  S range', ss[0].toFixed(2), '->', ss[99].toFixed(2), ' min step', Math.min(...gaps).toFixed(3), ' mean step', (gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(3),
    ' ratio/level', Math.pow(ss[99] / ss[0], 1 / 99).toFixed(4));
  console.log('  L* range', Math.min(...res.map(r => r.len)), '-', Math.max(...res.map(r => r.len)), ' nodes range', Math.min(...res.map(r => r.nodes)), '-', Math.max(...res.map(r => r.nodes)));
  for (const n of [1, 10, 25, 50, 51, 75, 80, 81, 99, 100]) {
    const r = res[n - 1];
    console.log(`  level ${String(n).padStart(3)}  deal #${String(r.deal).padStart(4)}  cells ${r.cells}  nodes ${String(r.nodes).padStart(6)}  L* ${r.len}  S ${r.S.toFixed(3)}  (ln nodes ${Math.log(r.nodes).toFixed(2)} + L*/30 ${(r.len / 30).toFixed(2)} + cells ${COEF[r.cells]})  moves incl. foundation ${r.full.length}`);
  }
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function touchDrag(cdp, a, b) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  await sleep(130); // press-and-hold 100 ms starts the drag
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps, e = p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }] });
    await sleep(22);
  }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function settle(page) { for (let k = 0; k < 200; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.busy) return st; await sleep(30); } return page.evaluate(() => window.__game.state()); }

async function playLevel(browser, n, full) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  // like a player: title -> level select -> unlock-all switch -> level tile
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]');
  await sleep(1800); await settle(page); await sleep(2600); // let the deal animation + level toast play
  const t0 = Date.now(); let actions = 0, taps = 0, drags = 0, skipped = 0;
  for (const m of full) {
    let st = await settle(page);
    const S = st.S;
    if (m.k === 'f' && S.f[m.card & 3] >= (m.card >> 2) + 1) { skipped++; continue; } // page auto-collected it already
    const from = await page.evaluate(c => window.__game.cardPoint(c), m.card);
    if (!from) throw new Error('card not found ' + m.card);
    if (m.k === 'f') { await touchTap(cdp, from.x, from.y); taps++; }
    else {
      let to;
      if (m.k === 'r') { const free = S.r.findIndex(c => c < 0); to = await page.evaluate(i => window.__game.dropPoint('r', i), free); }
      else to = await page.evaluate(i => window.__game.dropPoint('c', i), m.to);
      await touchDrag(cdp, from, to); drags++;
    }
    actions++;
    st = await settle(page);
    const where = st.S.r.indexOf(m.card) >= 0 ? 'r' : st.S.f[m.card & 3] >= (m.card >> 2) + 1 ? 'f' : 'c' + st.S.c.findIndex(col => col.includes(m.card));
    const want = m.k === 'c' ? 'c' + m.to : m.k;
    if (where !== want) throw new Error(`level ${n} action ${actions}: card ${m.card} ended at ${where}, expected ${want}`);
    await sleep(170 + Math.floor(Math.random() * 120));
  }
  await sleep(3200);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await sleep(700);
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  const speed = secs > 75 ? 2 : 1;
  const mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
  const vf = speed > 1 ? ['-filter:v', 'setpts=PTS/' + speed, '-r', '30'] : [];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: st.status === 'won' && winVisible, steps: st.moves, actions, taps, drags, skipped, secs: secs.toFixed(1), errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const res = args.includes("--fast") ? LEVELS.map(([deal, cells, , , sol]) => ({ full: core.expandSolution(core.newState(core.msDeal(deal), cells), decodeSol(sol)) })) : solveAll();
  if (args.includes('--solve-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n, res[n - 1].full);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'steps', r.steps, '/ target L*', LEVELS[n - 1][2], '| touch actions', r.actions, `(${r.drags} drags, ${r.taps} taps; ${r.skipped} auto-collected by page)`,
      '| time', r.secs + 's', '|', r.mp4, r.mp4KB + 'KB', '|', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
