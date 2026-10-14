// Verification for 黑白棋 (othello).
// 1) Node match series with the game's own AI (core extracted via CORE markers): strongest (L5 專家) vs weakest (L1 初學),
//    plus a short ladder (L3 vs L1, L4 vs L3, L5 vs L4) to show strength grows with level.
// 2) A bot plays one complete game against the page's AI in Chromium using real CDP touch input at human pace,
//    recorded to demo/game.mp4 (+ game-result.png), ending on the result screen; console errors are reported.
// Usage: node verify.js [--match-only | --browser-only] [--games N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const mk = () => new Function(coreSrc + '\nreturn {initialPos,sides,legalOf,playPos,passPos,isOver,counts,finalCounts,think,LEVELS,seededRng,openingMoves,sqName};')();
const C = mk();
const args = process.argv.slice(2), gi = args.indexOf('--games'), GAMES = gi >= 0 ? +args[gi + 1] : 6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function playMatch(lvA, lvB, games, seed) {
  // A plays black in even games, white in odd games; each game starts from 2 seeded random moves for variety
  let a = 0, b = 0, d = 0, diffSum = 0; const times = { [lvA]: [], [lvB]: [] }, lines = [];
  for (let g = 0; g < games; g++) {
    const R = C.seededRng(seed + Math.floor(g / 2));
    let p = C.initialPos(); const pre = C.openingMoves(p, 2, R); pre.forEach(m => { p = C.playPos(p, m); });
    const aColor = g % 2; // 0 => A black
    while (!C.isOver(p)) {
      if (!C.legalOf(p).length) { p = C.passPos(p); continue; }
      const lv = p.turn === aColor ? lvA : lvB, r = C.think(C.sides(p), lv);
      if (!r.only) times[lv].push(r.ms);
      p = C.playPos(p, r.move);
    }
    const fc = C.finalCounts(p), sa = fc[aColor], sb = fc[aColor ^ 1];
    if (sa > sb) a++; else if (sb > sa) b++; else d++; diffSum += sa - sb;
    lines.push(`  game ${g + 1}: L${lvA} as ${aColor ? 'white' : 'black'} ${sa}-${sb}`);
  }
  const st = arr => arr.length ? `avg ${Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)}ms max ${Math.round(Math.max(...arr))}ms` : '-';
  return { a, b, d, avgDiff: diffSum / games, lines, tA: st(times[lvA]), tB: st(times[lvB]) };
}

function matches() {
  const res = [];
  const run = (A, B, n, seed) => {
    const t = Date.now(), r = playMatch(A, B, n, seed);
    console.log(`L${A} ${C.LEVELS[A].name} vs L${B} ${C.LEVELS[B].name}: ${r.a}-${r.b}-${r.d} (W-L-D for L${A}), avg disc margin ${r.avgDiff >= 0 ? '+' : ''}${r.avgDiff.toFixed(1)} | think L${A}: ${r.tA}; L${B}: ${r.tB} | ${((Date.now() - t) / 1000).toFixed(0)}s`);
    r.lines.forEach(l => console.log(l)); res.push(r);
  };
  console.log('== AI match series (WOF scoring) ==');
  run(5, 1, GAMES, 1000);
  run(2, 1, 6, 1500);
  run(3, 2, 6, 2000);
  run(4, 3, 6, 3000);
  run(5, 4, 4, 4000);
  return res;
}

async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); }

async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  // Like a player: 新對局 -> 對電腦, 難度 4, 執黑, 無讓子, 標準開局 -> 開始
  await tapSel(cdp, page, '#tNew'); await sleep(600);
  for (const sel of ['#sgMode [data-v="ai"]', '#sgLevel [data-v="4"]', '#sgColor [data-v="0"]', '#sgHand [data-v="0"]', '#sgOpen [data-v="std"]']) { await tapSel(cdp, page, sel); await sleep(250); }
  await sleep(400); await tapSel(cdp, page, '#sStart');
  const t0 = Date.now(); let botMoves = 0, minGap = 1e9, lastTap = 0; const botTimes = [];
  while (Date.now() - t0 < 600000) {
    const st = await page.evaluate(() => ({ phase: __oth.phase, can: __oth.canInput(), P: __oth.P }));
    if (st.phase === 'over' || st.phase === 'count') break;
    if (!st.can) { await sleep(120); continue; }
    await sleep(350); // human reaction time
    const st2 = await page.evaluate(() => ({ can: __oth.canInput(), P: __oth.P, g: __oth.geom() }));
    if (!st2.can) continue;
    const s = C.sides(st2.P), r = C.think(s, 5, { ms: 700 }); botTimes.push(r.ms);
    const g = st2.g, k = g.w / g.S, x = g.x + (g.M + ((r.move & 7) + 0.5) * g.CELL) * k, y = g.y + (g.M + ((r.move >> 3) + 0.5) * g.CELL) * k;
    const now = Date.now(); if (lastTap) minGap = Math.min(minGap, now - lastTap); lastTap = now;
    await tap(cdp, x, y); botMoves++;
    await sleep(200);
  }
  await page.waitForSelector('#ovResult:not(.hidden)', { timeout: 20000 });
  await sleep(1500);
  const result = await page.evaluate(() => ({ title: document.getElementById('rTitle').textContent, score: document.getElementById('rScore').textContent, sub: document.getElementById('rSub').innerText, moves: __oth.G.moves.length }));
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  // show the review (覆盤) briefly, then back to the result screen
  await tapSel(cdp, page, '#rReview'); await sleep(1400);
  for (let i = 0; i < 3; i++) { await tapSel(cdp, page, '#rvNext'); await sleep(1200); }
  await tapSel(cdp, page, '#rvEnd'); await sleep(1500);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const vid = page.video(); await ctx.close(); const webm = await vid.path(); await browser.close();
  const mp4 = path.join(OUT, 'game.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
  let fast = null;
  if (dur > 60) { fast = path.join(OUT, 'game-3x.mp4'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/3', '-an', '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fast]); }
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log('\n== Browser game (bot = black, real CDP touch; page AI = L4 高級) ==');
  console.log(`result: ${result.title} ${result.score} | ${result.sub.replace(/\n/g, ' / ')}`);
  console.log(`bot taps: ${botMoves}, total moves: ${result.moves}, min gap between bot taps: ${minGap}ms, bot think avg ${Math.round(botTimes.reduce((a, b) => a + b, 0) / botTimes.length)}ms`);
  console.log(`video: game.mp4 ${(fs.statSync(mp4).size / 1048576).toFixed(2)} MB, ${dur.toFixed(1)}s` + (fast ? `; game-3x.mp4 ${(fs.statSync(fast).size / 1048576).toFixed(2)} MB` : ''));
  console.log(`horizontal overflow: ${ov}px, console errors: ${errors.length}` + (errors.length ? '\n  ' + errors.join('\n  ') : ''));
  return errors.length === 0;
}

(async () => {
  if (!args.includes('--browser-only')) matches();
  if (!args.includes('--match-only')) { const ok = await browserGame(); if (!ok) process.exit(1); }
})();
