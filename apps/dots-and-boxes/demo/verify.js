// Verification for 點格棋 (dots-and-boxes).
// (1) Node match series between AI levels using the game's own core (CORE-START/CORE-END in index.html),
//     strongest (教授) vs weakest (小學生) plus a ladder; reports scores and think times.
// (2) Edge hot-zone check at 360x780: every edge midpoint hits its edge, every dot and box centre hits nothing.
// (3) A bot (core level 5) plays one complete game against the page's own Web Worker AI in Chromium using real
//     CDP touch input at human pace, recorded as demo/game.mp4 (+ sped-up copy) and demo/game-result.png.
// Usage: node verify.js [--no-series] [--no-browser] [--games N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const D = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return DOTS;')();
const args = process.argv.slice(2), has = a => args.includes(a);
const NG = +(args[args.indexOf('--games') + 1] || 0) || 10;
const times = {};
function playMatch(la, lb, aFirst, size, seed) {
  const [C, R] = D.SIZES[size], g = D.newGame(C, R, 1), lvOf = p => ((p === 1) === aFirst ? la : lb);
  while (!g.over) { const lv = lvOf(g.turn), r = D.think({ C, R, edges: g.moves.map(m => m.e), level: lv, seed: seed++ }); (times[lv] = times[lv] || []).push(r.ms); D.play(g, r.e); }
  const pa = aFirst ? 1 : 2; return g.score[pa] - g.score[3 - pa];
}
function series(la, lb, n, size) {
  const res = { a: 0, b: 0, d: 0 }; let diff = 0; const t0 = Date.now();
  for (let i = 0; i < n; i++) { const d = playMatch(la, lb, i % 2 === 0, size, 1000 + i * 131); diff += d; res[d > 0 ? 'a' : d < 0 ? 'b' : 'd']++; }
  console.log(`  ${D.LEVELS[la - 1].name}(L${la}) vs ${D.LEVELS[lb - 1].name}(L${lb}) on ${size}: ${res.a} 勝 ${res.b} 負 ${res.d} 和, avg margin ${(diff / n > 0 ? '+' : '') + (diff / n).toFixed(1)} boxes (${n} games, first move alternates, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return res;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hotspotCheck(chromium) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); await page.goto('file://' + APP); await sleep(500);
  const out = [];
  for (const size of ['4x4', '6x6', '5x7']) {
    await page.tap('#cMode .chip[data-v="2p"]'); await page.tap(`#cSize .chip[data-v="${size}"]`); await page.locator('#mStart').scrollIntoViewIfNeeded(); await page.tap('#mStart'); await sleep(300);
    const r = await page.evaluate(() => {
      const s = __game.state(), G = DOTS.geo(s.C, s.R); let mid = 0, off = 0, dots = 0, centres = 0;
      for (let e = 0; e < G.NE; e++) {
        const [x, y] = __game.edgeToClient(e); if (__game.hitClient(x, y) === e) mid++;
        const [a, b, c, d] = DOTS.edgeDots(G, e), [x1, y1] = __game.dotToClient(a, b), [x2, y2] = __game.dotToClient(c, d);
        const hz = b === d, px = x1 + (x2 - x1) * 0.25 + (hz ? 0 : 4), py = y1 + (y2 - y1) * 0.25 + (hz ? 4 : 0); // 1/4 along, 4px off the line (rhombus tapers toward the dots)
        if (__game.hitClient(px, py) === e) off++;
      }
      for (let y = 0; y <= s.R; y++) for (let x = 0; x <= s.C; x++) { const [px, py] = __game.dotToClient(x, y); if (__game.hitClient(px, py) === -1 && __game.hitClient(px + 4, py + 4) === -1) dots++; }
      for (let y = 0; y < s.R; y++) for (let x = 0; x < s.C; x++) { const [px, py] = __game.dotToClient(x + 0.5, y + 0.5); if (__game.hitClient(px, py) === -1) centres++; }
      return { NE: G.NE, mid, off, dots, nd: (s.C + 1) * (s.R + 1), centres, nb: s.C * s.R, cell: __game.cell() };
    });
    out.push(r); console.log(`  360x780 ${size} (cell ${r.cell.toFixed(0)}px): edge midpoints ${r.mid}/${r.NE}, 1/4-along+4px-off ${r.off}/${r.NE}, dots (incl. 4px off) dead ${r.dots}/${r.nd}, box centres dead ${r.centres}/${r.nb}`);
    await page.tap('#bMenu'); await sleep(200);
  }
  await browser.close();
  return out.every(r => r.mid === r.NE && r.off === r.NE && r.dots === r.nd && r.centres === r.nb);
}
async function browserGame(chromium) {
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1, taps = 0;
  const tapXY = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(110); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; taps++; };
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); await tapXY(b.x + b.width / 2, b.y + b.height / 2); };
  await sleep(1000);
  await tap('#cMode .chip[data-v="ai"]'); await sleep(250);
  await tap('#cLevel .chip[data-v="4"]'); await sleep(250);
  await tap('#cSize .chip[data-v="4x4"]'); await sleep(250);
  await tap('#cFirst .chip[data-v="me"]'); await sleep(250);
  await tap('#mStart'); await sleep(700);
  const t0 = Date.now(); let bot = 0, confirms = 0, misses = 0, last;
  for (let i = 0; i < 80; i++) {
    let st;
    for (let k = 0; k < 600; k++) { st = await page.evaluate(() => __game.state()); if (st.over || st.inputOK) break; await sleep(50); }
    if (st.over) break;
    const r = D.think({ C: st.C, R: st.R, edges: st.edges, level: 5, seed: 77 + i });
    await sleep(280 + Math.floor(Math.random() * 260));          // human reaction time
    const [x, y] = await page.evaluate(e => __game.edgeToClient(e), r.e);
    await tapXY(x + (Math.random() - 0.5) * 6, y + (Math.random() - 0.5) * 6); bot++;
    await sleep(220);
    const after = await page.evaluate(() => __game.state());
    if (!after.edges.includes(r.e) && !(await page.isVisible('#confirm'))) { misses++; console.log('  miss: edge', r.e, 'state', JSON.stringify({ inputOK: after.inputOK, n: after.edges.length, preview: after.preview })); }
    if (await page.isVisible('#confirm')) { confirms++; await sleep(400); await tap('#cfYes'); await sleep(200); }
    last = r;
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#result')); k++) await sleep(80);
  await sleep(1300);
  const st = await page.evaluate(() => __game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm')), mp4 = path.join(OUT, 'game.mp4'), mp4x = path.join(OUT, 'game-2x.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const th = st.think, mean = th.length ? th.reduce((a, b) => a + b, 0) / th.length : 0;
  console.log(`BROWSER GAME (390x844, CDP touch): bot (core L5) vs page AI 大學生 L4 on 4x4 -> score ${st.score[1]}:${st.score[2]} ${st.winner === 1 ? 'bot won' : st.winner === 2 ? 'page AI won' : 'draw'}; result screen "${title}" visible=${st.resultVisible}`);
  console.log(`  ${bot} bot lines by touch (${taps} taps incl. menu, ${confirms} novice-warning confirms, ${misses} taps not registered), ${secs}s; page AI worker think ms mean ${mean.toFixed(0)} max ${Math.max(0, ...th)} over ${th.length} moves; video ${Math.round(fs.statSync(mp4).size / 1024)} KB (2x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB)`);
  console.log('  console errors:', errors.length ? errors.join(' | ') : 'none');
  return st.over && st.resultVisible && !errors.length && !misses;
}
(async () => {
  let okAll = true;
  if (!has('--no-series')) {
    console.log('AI match series (Node, game core, real time budgets):');
    const top = series(5, 1, NG, '4x4'); okAll = okAll && top.a >= NG * 0.9;
    series(2, 1, 20, '4x4'); series(3, 2, 20, '4x4'); series(4, 3, 10, '5x5'); series(5, 4, 6, '6x6');
    console.log('Think time per move (ms) — mean / max / budget:');
    for (const lv of Object.keys(times).sort()) { const a = times[lv], m = a.reduce((x, y) => x + y, 0) / a.length; console.log(`  L${lv} ${D.LEVELS[lv - 1].name}: ${m.toFixed(0)} / ${Math.max(...a)} / ${D.LEVELS[lv - 1].ms}  (${a.length} moves)`); }
  }
  if (!has('--no-browser')) {
    const { chromium } = require('/opt/node22/lib/node_modules/playwright');
    console.log('Edge hot zones:'); okAll = (await hotspotCheck(chromium)) && okAll;
    okAll = (await browserGame(chromium)) && okAll;
  }
  console.log(okAll ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exitCode = okAll ? 0 : 1;
})();
