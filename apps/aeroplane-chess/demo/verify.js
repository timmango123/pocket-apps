// Verification for 飛行棋 (aeroplane chess).
// (1) Node match series with the game's own engine (CORE block of ../index.html):
//     a. spec §六-14: 1,000 auto games, Lv4 資深機長 vs three Lv1 實習生 (seat rotates) — no stalls, Lv4 first-place rate must be > 40% (baseline 25%)
//     b. strongest vs weakest, 4 players: Lv5 王牌飛行員 vs three Lv1 實習生 — first-place rate vs 25% baseline, z-score
//     c. strongest vs weakest, heads-up: Lv5 vs Lv1, 2 players, alternating who starts — win rate vs 50%, z-score
//     d. stall test: random levels / personalities / house rules / quick mode / empty seats
// (2) A bot plays one complete game in the real page in Chromium (390x844) against the page's own AI (Web Worker),
//     using real touch input (CDP Input.dispatchTouchEvent) at human pace (>= 150 ms between actions), recorded to game*.mp4 + game-result.png.
// Usage: node verify.js [--games N] [--skip-match] [--skip-game]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const AP = new Function(fs.readFileSync(APP, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return AP;')();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function playGame(opts, levels, pers, seed) {
  const st = AP.newGame(Object.assign({ seed }, opts)); let n = 0; const ms = {};
  while (!st.over) {
    if (++n > 20000) throw new Error('stall in game seed ' + seed);
    const r = AP.roll(st); if (!r.moves || !r.moves.length) continue;
    const lv = levels[st.turn], t = process.hrtime.bigint();
    const c = AP.think(st, lv, pers[st.turn], seed * 31 + n);
    const dt = Number(process.hrtime.bigint() - t) / 1e6; (ms[lv] = ms[lv] || []).push(dt);
    AP.play(st, c.i);
  }
  return { st, ms };
}
const pct = x => (x * 100).toFixed(1) + '%';
function series(label, N, strongLv, np4) {
  let first = 0, pts = 0, turns = 0; const think = [];
  for (let g = 0; g < N; g++) {
    let levels, act, seat;
    if (np4) { seat = g % 4; levels = [1, 1, 1, 1]; levels[seat] = strongLv; act = [1, 1, 1, 1]; }
    else { seat = g % 2 ? 2 : 0; levels = [1, 1, 1, 1]; levels[seat] = strongLv; act = [1, 0, 1, 0]; }
    const r = playGame({ active: act }, levels, [0, 0, 0, 0], 70001 + g * 13 + strongLv * 100000);
    const R = r.st.over.ranking; if (R[0] === seat) first++; pts += R.length - 1 - R.indexOf(seat); turns += r.st.turnNo;
    think.push(...(r.ms[strongLv] || []));
  }
  const p = first / N, base = np4 ? .25 : .5, se = Math.sqrt(base * (1 - base) / N), z = (p - base) / se, ci = 1.96 * Math.sqrt(p * (1 - p) / N);
  think.sort((a, b) => a - b);
  console.log(`${label}: ${first}/${N} first places = ${pct(p)} (95% CI ${pct(p - ci)}–${pct(p + ci)}), baseline ${pct(base)}, z = ${z.toFixed(1)} | avg turns ${(turns / N).toFixed(0)} | Lv${strongLv} think avg ${(think.reduce((a, b) => a + b, 0) / think.length).toFixed(2)}ms p99 ${think[Math.floor(think.length * .99)].toFixed(1)}ms max ${think[think.length - 1].toFixed(1)}ms`);
  return { p, z, base };
}
// first-place rate of one Lv<lv> seat (rotating) against three Lv3 with the three personalities
function vsLv3(lv, N) {
  let first = 0;
  for (let g = 0; g < N; g++) { const seat = g % 4, levels = [3, 3, 3, 3], pers = [1, 2, 0, 1]; levels[seat] = lv; pers[seat] = 0;
    const r = playGame({}, levels, pers, 50000 + g * 7919); if (r.st.over.ranking[0] === seat) first++; }
  console.log(`Lv${lv} vs 3×Lv3 機長: first place ${pct(first / N)} of ${N} (baseline 25%)`); return first / N;
}
// heads-up Lv a vs Lv b, alternating who starts: win rate of a
function series2(a, b, N) {
  let w = 0;
  for (let g = 0; g < N; g++) { const levels = [b, 1, b, 1], seatA = g % 2 ? 2 : 0; levels[seatA] = a;
    const r = playGame({ active: [1, 0, 1, 0] }, levels, [0, 0, 0, 0], 31000 + g * 17); if (r.st.over.ranking[0] === seatA) w++; }
  console.log(`HEAD-TO-HEAD Lv${a} vs Lv${b} (2 players): Lv${a} wins ${pct(w / N)} of ${N}`); return w / N;
}
function stallTest(N) {
  const rnd = AP.rng(4242); let turns = 0;
  for (let g = 0; g < N; g++) {
    const act = [1, 1, 1, 1].map(() => rnd() < .8 ? 1 : 0); if (act.reduce((a, b) => a + b) < 2) { act[0] = 1; act[2] = 1; }
    const rules = { five: rnd() < .5, wall: rnd() < .5, triple: rnd() < .7, first: rnd() < .3 };
    const levels = [0, 1, 2, 3].map(() => 1 + Math.floor(rnd() * 5)), pers = [0, 1, 2, 3].map(() => Math.floor(rnd() * 3));
    const r = playGame({ active: act, rules, np: rnd() < .3 ? 2 : 4 }, levels, pers, 900000 + g);
    turns += r.st.turnNo;
  }
  console.log(`STALL TEST: ${N} games with random levels/personalities/house rules/quick mode/empty seats all finished (avg ${(turns / N).toFixed(0)} turns, guard 20000 rolls never hit)`);
}

let touchId = 1;
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: touchId }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  touchId++;
}
async function swipeUp(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: touchId }] });
  for (let k = 1; k <= 4; k++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - k * 18, id: touchId }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  touchId++;
}
async function center(page, sel) { await page.locator(sel).scrollIntoViewIfNeeded(); await sleep(120); const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
async function game() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  const gaps = []; let lastAct = 0;
  const act = async (fn) => { const now = Date.now(); if (lastAct) { if (now - lastAct < 160) await sleep(160 - (now - lastAct)); gaps.push(Date.now() - lastAct); } await fn(); lastAct = Date.now(); };
  // menu: make yellow the strongest computer (Lv5 王牌飛行員), keep blue Lv3 謹慎領航 and green Lv3 效率塔台, then start
  await act(async () => { const [x, y] = await center(page, '#mAdv summary'); await tapXY(cdp, x, y); }); await sleep(250);   // 進階設定
  for (let k = 0; k < 2; k++) { await act(async () => { const [x, y] = await center(page, '#seats .seat:nth-child(2) [data-lv="1"]'); await tapXY(cdp, x, y); }); await sleep(250); }
  const yl = await page.textContent('#seats .seat:nth-child(2) .step span');
  await act(async () => { const [x, y] = await center(page, '#mStart'); await tapXY(cdp, x, y); }); await sleep(900);
  if (!(await page.evaluate(() => document.getElementById('menu').hidden))) throw new Error('start button tap did not start the game');
  if (await page.isVisible('#tut')) { await act(async () => { const [x, y] = await center(page, '#tutSkip'); await tapXY(cdp, x, y); }); await sleep(300); }   // first start opens the tutorial
  await act(async () => { const [x, y] = await center(page, '#bSpeed'); await tapXY(cdp, x, y); }); await sleep(300);   // 2x -> 4x for the computers' turns
  const t0 = Date.now(); let rolls = 0, picks = 0, stackChoices = 0, swipes = 0; const thinks = [];
  let lastThinkSeen = -1;
  for (let guard = 0; guard < 6000; guard++) {
    const s = await page.evaluate(() => window.__game.state());
    if (s.over) break;
    if (s.think !== lastThinkSeen) { lastThinkSeen = s.think; thinks.push(s.think); }
    if (s.human && !s.busy && s.ui === 'await-roll') {
      await sleep(260 + Math.random() * 200);
      const [x, y] = await center(page, '#diceBtn');
      if (rolls % 5 === 2) { await act(() => swipeUp(cdp, x, y + 20)); swipes++; } else await act(() => tapXY(cdp, x, y));
      rolls++; await sleep(500); continue;
    }
    if (s.human && !s.busy && s.ui === 'choose' && s.legal > 1) {
      const r = AP.think(s.st, 4, 0, 11 + picks), mv = AP.legal(s.st, s.st.turn, s.st.d)[r.i];
      await sleep(350 + Math.random() * 250);
      const [x, y] = await page.evaluate(([c, i]) => window.__game.planeXY(c, i), [mv.c, mv.pl[0]]);
      await act(() => tapXY(cdp, x, y)); picks++;
      await sleep(260);
      const s2 = await page.evaluate(() => window.__game.state());
      if (s2.chooser) { const [cx, cy] = await center(page, mv.stack ? '#chAll' : '#chOne'); await act(() => tapXY(cdp, cx, cy)); stackChoices++; }
      await sleep(200); continue;
    }
    await sleep(70);
  }
  for (let k = 0; k < 100 && !(await page.evaluate(() => window.__game.state().resultVisible)); k++) await sleep(100);
  await sleep(1800);
  const fin = await page.evaluate(() => window.__game.state());
  const title = await page.textContent('#rTitle');
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  for (const f of fs.readdirSync(OUT)) if (/^game(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  const speed = secs > 240 ? 6 : secs > 120 ? 4 : secs > 60 ? 2 : 1, mp4 = path.join(OUT, speed > 1 ? 'game-' + speed + 'x.mp4' : 'game.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  const st = fin.st, th = thinks.filter(x => x >= 0);
  console.log('GAME in Chromium (390x844, touch via CDP): bot = red (seat 0, picks with Lv4 core) vs page AI: yellow', yl, '/ blue Lv3 謹慎領航 / green Lv3 效率塔台, computers at 4x speed');
  console.log('  result screen:', fin.resultVisible ? 'shown' : 'NOT shown', '| title:', title, '| ranking', JSON.stringify(st.over && st.over.ranking.map(c => AP.NAMES[c])), '| turns', st.turnNo, '| captures', JSON.stringify(st.caps));
  console.log('  bot rolls', rolls, '(', swipes, 'by swipe-up ) | plane picks', picks, '| stack choices', stackChoices, '| min gap between touches', Math.min(...gaps) + 'ms', '| wall time', secs.toFixed(0) + 's');
  console.log('  page AI think times (worker):', th.length, 'samples, max', Math.max(...th) + 'ms');
  console.log('  video', path.basename(mp4), Math.round(fs.statSync(mp4).size / 1024) + 'KB', '(' + speed + 'x) |', errors.length ? 'CONSOLE ERRORS: ' + errors.join(' | ') : 'no console errors');
  return fin.resultVisible && !errors.length && Math.min(...gaps) >= 150;
}
(async () => {
  let ok = true;
  if (!process.argv.includes('--skip-match')) {
    const N = +arg('--games', 2000);
    const a = series('SPEC §六-14  Lv4 資深機長 vs 3×Lv1 實習生 (4 players)', 1000, 4, true); ok = ok && a.p > .40;
    const b = series('STRONG vs WEAK Lv5 王牌飛行員 vs 3×Lv1 實習生 (4 players)', N, 5, true); ok = ok && b.z > 5;
    const c = series('STRONG vs WEAK Lv5 王牌飛行員 vs Lv1 實習生 (heads-up)', N, 5, false); ok = ok && c.z > 5;
    const d = vsLv3(4, 600), e = vsLv3(5, 600); ok = ok && e - d >= 0.1 && e >= 0.45;
    const f = series2(5, 4, 1000); ok = ok && f > 0.6;
    stallTest(1000);
  }
  if (!process.argv.includes('--skip-game')) ok = (await game()) && ok;
  console.log(ok ? 'VERIFY OK' : 'VERIFY FAILED');
  process.exitCode = ok ? 0 : 1;
})();
