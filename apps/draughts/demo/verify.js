// Verification for 國際跳棋 (draughts).
// 1) Node match series with the game's own AI (core extracted via CORE markers): strongest (L5 大師) vs weakest (L1 入門),
//    plus a short ladder, Brazilian rules. Each pair of games starts from the same seeded 2-ply opening with colours swapped.
// 2) A bot plays one complete game against the page's AI in Chromium with real CDP touch input at human pace,
//    recorded to demo/game.mp4 (+ game-result.png), ending on the result screen; console errors are reported.
// Usage: node verify.js [--match-only | --browser-only] [--games N] [--level L]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {RULES,LEVELS,initState,genMoves,stepState,statusOf,think,seededRng,counts,moveKey};')();
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const GAMES = arg('--games', 6), PAGE_LV = arg('--level', 3);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function playMatch(lvA, lvB, games, seed, rule) {
  let a = 0, b = 0, d = 0; const times = { [lvA]: [], [lvB]: [] }, lines = [];
  for (let g = 0; g < games; g++) {
    const R = C.seededRng(seed + Math.floor(g / 2));
    let s = C.initState(rule);
    for (let k = 0; k < 2; k++) { const ms = C.genMoves(s.b, s.turn, C.RULES[rule]); s = C.stepState(s, ms[Math.floor(R() * ms.length)]); }
    const aSide = g % 2; let st, plies = 0;
    while (!(st = C.statusOf(s)).over && plies < 300) {
      const lv = s.turn === aSide ? lvA : lvB, r = C.think(s, lv, { rng: R });
      if (!r.only) times[lv].push(r.ms);
      s = C.stepState(s, r.move); plies++;
    }
    const w = st.over ? st.winner : -1, c = C.counts(s.b);
    if (w === aSide) a++; else if (w === -1) d++; else b++;
    lines.push(`  game ${g + 1}: L${lvA} as ${aSide ? 'black' : 'white'} -> ${w === -1 ? 'draw' : w === aSide ? 'L' + lvA + ' wins' : 'L' + lvB + ' wins'} (${st.reason || '300-ply cap'}), ${plies} plies, left W${c.wm + c.wk} B${c.bm + c.bk}`);
  }
  const stt = arr => arr.length ? `avg ${Math.round(arr.reduce((x, y) => x + y, 0) / arr.length)}ms max ${Math.round(Math.max(...arr))}ms` : '-';
  return { a, b, d, lines, tA: stt(times[lvA]), tB: stt(times[lvB]) };
}
function matches() {
  console.log('== AI match series (Brazilian rules, real level settings) ==');
  const run = (A, B, n, seed) => {
    const t = Date.now(), r = playMatch(A, B, n, seed, 'br');
    console.log(`L${A} ${C.LEVELS[A].name} vs L${B} ${C.LEVELS[B].name}: ${r.a}-${r.b}-${r.d} (W-L-D for L${A}) | think L${A}: ${r.tA}; L${B}: ${r.tB} | ${((Date.now() - t) / 1000).toFixed(0)}s`);
    r.lines.forEach(l => console.log(l));
  };
  run(5, 1, GAMES, 1000);
  run(3, 1, 4, 2000);
  run(4, 2, 4, 3000);
}

async function tap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function tapSq(cdp, page, i) { const p = await page.evaluate(i => __dr.sqClient(i), i); await tap(cdp, p.x, p.y); }

async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'light', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  // like a player: 巴西 rules, 對電腦, level PAGE_LV, play white -> 開始對局
  for (const sel of ['#sgRule [data-v="br"]', '#sgMode [data-v="ai"]', `#sgLevel [data-v="${PAGE_LV}"]`, '#sgColor [data-v="0"]']) { await tapSel(cdp, page, sel); await sleep(250); }
  await sleep(300); await tapSel(cdp, page, '#sStart');
  const t0 = Date.now(); let botMoves = 0, taps = 0, minGap = 1e9, lastTap = 0, maxCap = 0; const botTimes = [];
  const stamp = () => { const now = Date.now(); if (lastTap) minGap = Math.min(minGap, now - lastTap); lastTap = now; taps++; };
  while (Date.now() - t0 < 900000) {
    const ph = await page.evaluate(() => __dr.phase);
    if (ph === 'over') break;
    if (!(await page.evaluate(() => __dr.canInput()))) { await sleep(120); continue; }
    await sleep(380); // human reaction time
    const st = await page.evaluate(() => { const c = __dr.cur; return { b: c.b, turn: c.turn, rule: c.rule, hist: c.hist, kq: c.kq, eg: c.eg, egSig: c.egSig, egLim: c.egLim, ply: c.ply, n: __dr.G.moves.length }; });
    const r = C.think(st, 5, { ms: 700 }); botTimes.push(r.ms);
    const m = r.move, legal = C.genMoves(st.b, st.turn, C.RULES[st.rule]);
    const sameEnd = legal.filter(x => x.f === m.f && x.t === m.t).length;
    maxCap = Math.max(maxCap, m.caps.length);
    stamp(); await tapSq(cdp, page, m.f); await sleep(260);
    if (sameEnd > 1) { // ambiguous: tap the intermediate landing squares in order
      for (let k = 1; k < m.path.length - 1; k++) { stamp(); await tapSq(cdp, page, m.path[k]); await sleep(260); if ((await page.evaluate(() => __dr.G.moves.length)) > st.n) break; }
    }
    if ((await page.evaluate(() => __dr.G.moves.length)) === st.n) { stamp(); await tapSq(cdp, page, m.t); }
    botMoves++;
    await sleep(250);
  }
  await page.waitForSelector('#ovResult:not(.hidden)', { timeout: 20000 });
  await sleep(2600);
  const result = await page.evaluate(() => ({ title: document.getElementById('rTitle').textContent, sub: document.getElementById('rSub').textContent, plies: __dr.G.moves.length }));
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const vid = page.video(); await ctx.close(); const webm = await vid.path(); await browser.close();
  const mp4 = path.join(OUT, 'game.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4]);
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).toString());
  let fast = null;
  if (dur > 60) { fast = path.join(OUT, 'game-4x.mp4'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', fast]); }
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(`\n== Browser game (bot = white, real CDP touch; page AI = L${PAGE_LV} ${C.LEVELS[PAGE_LV].name}, Brazilian rules) ==`);
  console.log(`result: ${result.title} | ${result.sub} | ${result.plies} plies`);
  console.log(`bot moves: ${botMoves}, taps: ${taps}, min gap between bot taps: ${minGap}ms, longest bot capture: ${maxCap}, bot think avg ${Math.round(botTimes.reduce((a, b) => a + b, 0) / botTimes.length)}ms`);
  console.log(`video: game.mp4 ${(fs.statSync(mp4).size / 1048576).toFixed(2)} MB, ${dur.toFixed(1)}s` + (fast ? `; game-4x.mp4 ${(fs.statSync(fast).size / 1048576).toFixed(2)} MB` : ''));
  console.log(`horizontal overflow: ${ov}px, console errors: ${errors.length}` + (errors.length ? '\n  ' + errors.join('\n  ') : ''));
  return errors.length === 0;
}

(async () => {
  if (!args.includes('--browser-only')) matches();
  if (!args.includes('--match-only')) { const ok = await browserGame(); if (!ok) process.exit(1); }
})();
