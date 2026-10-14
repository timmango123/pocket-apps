// Verification for 快艇骰子 (yacht-dice).
// (1) Node match series between the computer-captain levels using the game's own core (CORE-START/CORE-END in ../index.html),
//     with the same deterministic per-slot dice the page uses. Reports wins, win rate + 95% Wilson CI and think times.
// (2) Spec step 11: the hint engine (高手) plays 20000 solitaire sheets: mean score, bonus/yacht rates, voyage threshold curve.
// (3) A bot plays one complete 對戰 game against the page's own Web Worker AI (高手) in Chromium with real CDP touch input
//     at human pace (taps on dice/buttons/cells, one swipe-up roll, one hint), recorded as demo/game.mp4 (+ game-4x.mp4)
//     and demo/game-result.png, ending on the result screen with no console errors.
// Usage: node verify.js [--no-series] [--no-solo] [--no-browser] [--quick]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const YC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return YC;')();
const args = process.argv.slice(2), has = a => args.includes(a), quick = has('--quick');
const times = { 0: [], 1: [], 2: [] };
function playTurn(sh, g, level) {
  g.roll = 0; let hold = [false, false, false, false, false]; g.dice = [0, 0, 0, 0, 0];
  for (;;) {
    g.dice = YC.rollTurn(g, hold); g.roll++;
    const t0 = process.hrtime.bigint();
    const d = YC.decide(sh, g.dice, 3 - g.roll, level);
    times[level].push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (d.type === 'fill') { const o = YC.options(sh.sc, YC.counts(g.dice)).find(o => o.cat === d.cat); if (!o) throw new Error('illegal fill'); YC.apply(sh, o); return; }
    hold = d.hold;
  }
}
function playVs(a, b, seed) {
  const sh = [YC.newSheet(), YC.newSheet()];
  for (let turn = 0; turn < 13; turn++) for (let p = 0; p < 2; p++) playTurn(sh[p], { seed, k: 1, player: p, turn, undo: 0 }, p ? b : a);
  return [YC.total(sh[0]), YC.total(sh[1])];
}
function wilson(k, n) { const z = 1.96, p = k / n, den = 1 + z * z / n, c = (p + z * z / (2 * n)) / den, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den; return [c - h, c + h]; }
const LV = ['新手', '一般', '高手'];
function series(a, b, n, seed0) {
  let w = 0, l = 0, t = 0, sa = 0, sb = 0; const t0 = Date.now();
  for (let i = 0; i < n; i++) { const [x, y] = playVs(a, b, (seed0 + i * 7919) >>> 0); sa += x; sb += y; if (x > y) w++; else if (x < y) l++; else t++; }
  const pts = w + t / 2, [lo, hi] = wilson(pts, n);
  console.log(`  ${LV[a]} vs ${LV[b]}: ${w}-${l}-${t} (W-L-T) in ${n} games = ${(100 * pts / n).toFixed(1)}% (95% CI ${(100 * lo).toFixed(1)}–${(100 * hi).toFixed(1)}%), mean score ${(sa / n).toFixed(1)} vs ${(sb / n).toFixed(1)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { lo, hi, rate: pts / n };
}
function soloRun(n) {
  const R = YC.rng(20261014); let s = 0, s2 = 0, bon = 0, yz = 0, eb = 0, mx = 0, mn = 1e9; const scores = [];
  const g = { seed: 0, k: 1, player: 0, turn: 0, undo: 0 }, t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const sh = YC.newSheet(); g.seed = (R() * 4294967296) >>> 0;
    for (let turn = 0; turn < 13; turn++) { g.turn = turn; playTurn(sh, g, 2); }
    const tot = YC.total(sh); scores.push(tot); s += tot; s2 += tot * tot; if (YC.upper(sh) >= 63) bon++; if (sh.sc[11] === 50) yz++; eb += sh.yb; mx = Math.max(mx, tot); mn = Math.min(mn, tot);
  }
  const m = s / n, sd = Math.sqrt(s2 / n - m * m);
  console.log(`  ${n} sheets by the hint engine (高手): mean ${m.toFixed(2)} (sd ${sd.toFixed(1)}, min ${mn}, max ${mx}), upper bonus ${(100 * bon / n).toFixed(1)}%, yacht scored ${(100 * yz / n).toFixed(1)}%, extra yachts/sheet ${(eb / n).toFixed(3)}, ${((Date.now() - t0) / n).toFixed(2)} ms/sheet`);
  console.log('  (exact optimal play averages 254.59 — computed by the offline DP that produced the AI value table)');
  const pk = []; for (let k = 1; k <= 16; k++) { const T = YC.threshold(k); pk.push(scores.filter(x => x >= T).length / n); }
  console.log('  P(sheet >= T(k)) for k=1..16: ' + pk.map((p, i) => `T${i + 1}=${YC.threshold(i + 1)}:${(100 * p).toFixed(1)}%`).join(' '));
  // voyage length: sample sheets from the empirical distribution (tickets ignored)
  const RR = YC.rng(7); let tot = 0, best = 0; const V = 20000;
  for (let v = 0; v < V; v++) { let k = 1; while (scores[Math.floor(RR() * n)] >= YC.threshold(k)) k++; tot += k - 1; best = Math.max(best, k - 1); }
  console.log(`  voyage (sheets passed, ${V} sampled voyages): mean ${(tot / V).toFixed(2)}, longest ${best}`);
  return m;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserGame() {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  let tid = 1, actions = 0, lastAct = 0, minGap = 1e9;
  const pace = async () => { const gap = Date.now() - lastAct; if (gap < 170) await sleep(170 - gap); if (lastAct) minGap = Math.min(minGap, Date.now() - lastAct); };
  const touch = async (x, y, hold = 70) => { await pace(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: tid }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; actions++; lastAct = Date.now(); };
  const swipeUp = async (x, y0, y1) => { await pace(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: tid }] }); for (let i = 1; i <= 8; i++) { await sleep(20); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 8, id: tid }] }); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); tid++; actions++; lastAct = Date.now(); };
  const box = async sel => { const b = await page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async sel => { const [x, y] = await box(sel); await touch(x, y); };
  const st = () => page.evaluate(() => window.__game.state());
  await sleep(900);
  await tap('#lvChips .chip[data-lv="2"]'); await sleep(300);
  await tap('.mode[data-mode="vs"]'); await sleep(700);
  const t0 = Date.now(); let fills = 0, didHint = false, didSwipe = false, zeroConfirms = 0;
  for (let loop = 0; loop < 5000; loop++) {
    if (await page.evaluate(() => window.__game.resultVisible())) break;
    if (await page.isVisible('#ovConfirm')) { await sleep(400); await tap('#cYes'); zeroConfirms++; await sleep(300); continue; }
    const s = await st();
    if (!s.sheets || s.phase !== 'act' || s.player !== 0 || s.busy) { await sleep(120); continue; }
    if (s.roll === 0) {
      await sleep(350);
      if (!didSwipe && s.turn === 2) { const b = await page.locator('#trayWrap').boundingBox(); await swipeUp(b.x + b.width / 2, b.y + b.height * 0.85, b.y + b.height * 0.35); didSwipe = true; }
      else await tap('#bRoll');
      await sleep(1100); continue;
    }
    const sh = s.sheets[0], d = YC.decide(sh, s.dice, s.maxRolls - s.roll, 2);
    if (!didHint && s.turn === 4) { await sleep(300); await tap('#bHint'); didHint = true; await sleep(1500); }
    if (d.type === 'keep') {
      for (let i = 0; i < 5; i++) if (d.hold[i] !== s.hold[i]) { const [x, y] = await page.evaluate(i => window.__game.dieXY(i), i); await sleep(140); await touch(x, y); await sleep(160); }
      await sleep(350); await tap('#bRoll'); await sleep(1100); continue;
    }
    await sleep(400);
    await tap(`.row[data-cat="${d.cat}"]`); await sleep(350);
    await tap(`.row[data-cat="${d.cat}"]`); await sleep(500);
    if (await page.isVisible('#ovConfirm')) { await sleep(300); await tap('#cYes'); zeroConfirms++; await sleep(300); }
    fills++;
  }
  for (let k = 0; k < 100 && !(await page.isVisible('#ovResult')); k++) await sleep(100);
  await sleep(2000);
  const title = await page.textContent('#rTitle'), sub = await page.innerText('#rSub'), score = await page.textContent('#rScore');
  const think = await page.evaluate(() => window.__game.thinkLog());
  await page.screenshot({ path: path.join(OUT, 'game-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'game.mp4'), mp4x = path.join(OUT, 'game-4x.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.25*PTS', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4x]);
  const ai = think.filter(x => x.kind === 'ai').map(x => x.ms).sort((a, b) => a - b), hints = think.filter(x => x.kind === 'hint');
  console.log(`BROWSER GAME: bot (core 高手 engine, real touch) vs page AI 高手 -> result "${title}" / ${sub.replace(/\n/g, ' ')} / score ${score}`);
  console.log(`  ${fills} bot fills, ${actions} touch actions (min gap ${minGap} ms), ${secs} s, swipe-roll ${didSwipe}, hint ${didHint} (${hints.length} hint calls), zero-confirm dialogs ${zeroConfirms}`);
  console.log(`  page AI think ms (Web Worker=${think.every(x => x.worker)}, ${ai.length} decisions): mean ${(ai.reduce((a, b) => a + b, 0) / Math.max(1, ai.length)).toFixed(2)}, p95 ${ai[Math.floor(ai.length * 0.95)].toFixed(2)}, max ${ai[ai.length - 1].toFixed(2)}`);
  console.log(`  video ${Math.round(fs.statSync(mp4).size / 1024)} KB (4x: ${Math.round(fs.statSync(mp4x).size / 1024)} KB)`);
  console.log('  console errors:', errors.length ? errors.join(' | ') : 'none');
  return fills === 13 && !errors.length && /勝利|惜敗|平手/.test(title);
}
(async () => {
  let ok = true;
  if (!has('--no-series')) {
    console.log('AI match series (Node, game core, page dice):');
    const top = series(2, 0, quick ? 200 : 2000, 1);
    ok = ok && top.lo > 0.8;
    const s21 = series(2, 1, quick ? 400 : 4000, 2), s10 = series(1, 0, quick ? 200 : 2000, 3);
    ok = ok && s21.lo > 0.5 && s10.lo > 0.5;
    console.log('Think time per decision (ms, Node) — mean / p95 / max:');
    for (const lv of [0, 1, 2]) { const a = times[lv].slice().sort((x, y) => x - y), m = a.reduce((x, y) => x + y, 0) / a.length; console.log(`  ${LV[lv]}: ${m.toFixed(3)} / ${a[Math.floor(a.length * 0.95)].toFixed(3)} / ${a[a.length - 1].toFixed(2)}  (${a.length} decisions)`); }
    { const a = times[2].slice().sort((x, y) => x - y); ok = ok && a[Math.floor(a.length * 0.999)] < 30; console.log(`  高手 p99.9 ${a[Math.floor(a.length * 0.999)].toFixed(2)} ms (< 30 ms target; max includes JIT warm-up)`); }
  }
  if (!has('--no-solo')) { console.log('Hint engine solitaire run (spec step 11):'); const m = soloRun(quick ? 2000 : 20000); ok = ok && m >= 240; }
  if (!has('--no-browser')) ok = (await browserGame()) && ok;
  console.log(ok ? 'ALL OK' : 'SOME CHECKS FAILED');
  process.exitCode = ok ? 0 : 1;
})();
