// Verification for 苔原光蛇 (snake-glide).
// 1) Node fairness test: runs the game's own core (extracted via CORE markers) with the auto player under a
//    150 ms reaction model: every move is decided >= 150 ms (ceil(150/T) ticks) before it takes effect, and two
//    turns are never closer than 150 ms. Reports how many runs pass 500 points and why runs end.
// 2) Browser: drives the real page in Chromium with real CDP touch input (one finger kept down, each turn is a
//    >= 24 px finger move, i.e. the "no-lift" continuous swipe), records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--sim-only] [--runs N] [--browser-only]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {newGame, step, qDir, botDecide, interval, tickMs, bodyAt, stoneWant, GN};')();

// conservative turn spacing: assume the next food may already speed things up (and gold may trigger 光速)
function cdTicks(G) { const g = G.t < G.boostEnd || G.foods.some(f => f.k === 2); return Math.max(1, Math.ceil(150 / (core.tickMs(G.score + 60) * (g ? 0.75 : 1)))); }
function botRun(seed, mode, wrap, cap) {
  const G = core.newGame({ mode, wrap, seed, maze: seed % 3 });
  let committed = [], lastTurn = -99, minGapMs = 1e9, lastTurnT = -1e9, minLagMs = 1e9;
  const at = {}; let maxStones = 0, maxPortals = 0;
  while (G.alive && G.score < cap && G.tick < 40000) {
    const T = core.interval(G), cdT = cdTicks(G);
    const decideFor = (D, pre) => { const d = core.botDecide(G, pre, cdT, D - lastTurn); const prev = pre.length ? pre[pre.length - 1] : G.dir; if (d !== prev) lastTurn = D; return d; };
    if (!committed.length) committed.push(decideFor(G.tick + 1, []));
    const d = committed.shift();
    while (committed.length < cdT - 1) committed.push(decideFor(G.tick + 2 + committed.length, [d].concat(committed)));
    minLagMs = Math.min(minLagMs, G.tick > 2 ? cdT * T : 1e9);
    const before = G.dir;
    core.qDir(G, d); const ev = core.step(G);
    if (ev.turn) { if (G.tick > 1) minGapMs = Math.min(minGapMs, G.t - lastTurnT); lastTurnT = G.t; }
    for (const s of [150, 300, 500, 800, 1000, 1500]) if (G.score >= s && !at[s]) at[s] = { ms: Math.round(core.tickMs(G.score)), t: Math.round(G.t / 1000) };
    maxStones = Math.max(maxStones, G.stones.length); maxPortals = Math.max(maxPortals, G.portals.length);
    void before;
  }
  return { seed, score: G.score, len: G.len, dieBy: G.alive ? 'cap' : G.dieBy, ticks: G.tick, secs: G.t / 1000, at, maxStones, maxPortals,
    checks: G.checks, relax: G.relax, stoneFail: G.stoneFail, minGapMs, minLagMs, ptrips: G.ptrips, maxCombo: G.maxCombo };
}

function simReport(runs) {
  const t0 = Date.now();
  console.log('== Node fairness test: auto player, 150 ms reaction model (decide >= 150 ms ahead, turns >= 150 ms apart)');
  console.log('   speed curve T(s): ' + [0, 150, 300, 500, 800, 1000, 1500, 2500].map(s => `s=${s} ${core.tickMs(s).toFixed(0)}ms`).join(', '));
  for (const [mode, wrap, cap] of [['normal', false, 1500], ['classic', false, 1500], ['maze', false, 1500], ['daily', false, 1500], ['normal', true, 1500]]) {
    const res = []; for (let i = 0; i < runs; i++) res.push(botRun(1000 + i * 7919 + (mode === 'daily' ? 0 : 0), mode, wrap, cap));
    const p500 = res.filter(r => r.score >= 500).length, capd = res.filter(r => r.dieBy === 'cap').length;
    const sc = res.map(r => r.score).sort((a, b) => a - b), avg = Math.round(sc.reduce((a, b) => a + b, 0) / sc.length);
    const deaths = {}; res.forEach(r => deaths[r.dieBy] = (deaths[r.dieBy] || 0) + 1);
    const under = res.filter(r => r.score < 500).map(r => `seed ${r.seed}: ${r.score} (${r.dieBy})`);
    const relax = res.reduce((a, r) => a + r.relax, 0), checks = res.reduce((a, r) => a + r.checks, 0);
    console.log(`-- ${mode}${wrap ? '+無牆' : ''}: ${runs} runs (cap ${cap})  reached 500: ${p500}/${runs}  reached cap: ${capd}/${runs}  avg ${avg}  median ${sc[sc.length >> 1]}  min ${sc[0]}`);
    console.log(`   ends: ${JSON.stringify(deaths)}  max stones ${Math.max(...res.map(r => r.maxStones))}, max portal pairs ${Math.max(...res.map(r => r.maxPortals))}, portal trips avg ${(res.reduce((a, r) => a + r.ptrips, 0) / runs).toFixed(0)}`);
    console.log(`   food spawns ${checks}, spawns needing relaxed rule ${relax}; min turn gap ${Math.min(...res.map(r => r.minGapMs)).toFixed(0)} ms; min decision lead ${Math.min(...res.map(r => r.minLagMs)).toFixed(0)} ms`);
    if (under.length) console.log('   below 500: ' + under.join('; '));
    const r0 = res.find(r => r.at[1000]) || res[0];
    console.log('   ramp example (seed ' + r0.seed + '): ' + Object.entries(r0.at).map(([s, v]) => `${s}pts@${v.t}s tick ${v.ms}ms`).join(', '));
  }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserRun(cap) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const W = 390, H = 844;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1500);
  const tap = async sel => { const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  await tap('#mNormal'); await sleep(900);
  let fx = W / 2, fy = H * 0.62;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
  const DXs = [0, 1, 0, -1], DYs = [-1, 0, 1, 0];
  const t0 = Date.now(); let turns = 0, lastAct = 0, minGap = 1e9, lastGT = -1, minGameGap = 1e9, missed = 0, stopped = false, maxScore = 0;
  const samples = [];
  // in-page bookkeeping (decisions use only the page state at decision time)
  await page.evaluate(() => { window.__vb = { committed: [], lastTurn: -99 }; });
  let j = 0;
  for (;;) {
    const r = await page.evaluate(async ({ j, cap }) => {
      const g = window.__game; if (g.state() !== 'ready') await g.waitTick(j + 1);
      const G = g.G(), c = g.core, vb = window.__vb;
      if (!G.alive || g.state() === 'over' || g.state() === 'dead') return { dead: true, tick: G.tick, score: G.score, len: G.len, dieBy: G.dieBy };
      const g2 = G.t < G.boostEnd || G.foods.some(f => f.k === 2), T = c.interval(G), cdT = Math.max(1, Math.ceil(150 / (c.tickMs(G.score + 60) * (g2 ? 0.75 : 1))));
      // decisions that were meant for ticks already gone are dropped (counted as misses)
      let miss = 0; while (vb.committed.length && vb.committed[0].tick <= G.tick) { vb.committed.shift(); miss++; }
      const dec = (D, pre) => { const d = c.botDecide(G, pre, cdT, D - vb.lastTurn); const prev = pre.length ? pre[pre.length - 1] : (G.q.length ? G.q[G.q.length - 1] : G.dir); if (d !== prev) vb.lastTurn = D; return d; };
      if (!vb.committed.length) vb.committed.push({ tick: G.tick + 1, d: dec(G.tick + 1, []) });
      const m = vb.committed.shift();
      const pre = () => [m.d].concat(vb.committed.map(x => x.d));
      while (vb.committed.length < cdT - 1) vb.committed.push({ tick: G.tick + 2 + vb.committed.length, d: dec(G.tick + 2 + vb.committed.length, pre()) });
      const cur = G.q.length ? G.q[G.q.length - 1] : G.dir;
      const stop = G.score >= cap;
      return { tick: G.tick, gt: G.t, d: m.d, turn: m.d !== cur && !stop, score: G.score, len: G.len, T, miss, started: g.state() === 'play', stones: G.stones.length, portals: G.portals.length, stop };
    }, { j, cap });
    if (r.dead) { maxScore = r.score; console.log(`BOT run ended: score ${r.score}, length ${r.len}, ${r.dieBy}`); break; }
    missed += r.miss || 0; maxScore = r.score; j = r.tick;
    if (r.stop && !stopped) { stopped = true; console.log(`BOT reached cap ${cap} at ${((Date.now() - t0) / 1000).toFixed(0)} s (score ${r.score}); releasing control so the run ends naturally`); }
    if (!r.started || r.turn) {
      const now = Date.now();
      if (lastAct && r.turn) { minGap = Math.min(minGap, now - lastAct); minGameGap = Math.min(minGameGap, r.gt - lastGT); } lastAct = now; lastGT = r.gt;
      fx += DXs[r.d] * 30; fy += DYs[r.d] * 30;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx, y: fy }] });
      turns++;
      if (fx < 60 || fx > W - 60 || fy < 220 || fy > H - 80) { // re-centre the finger (lift + press does not steer)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); fx = W / 2; fy = H * 0.62;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
      }
    }
    if (samples.length === 0 || r.score >= samples[samples.length - 1].score + 150) samples.push({ s: Math.round((Date.now() - t0) / 1000), score: r.score, tickMs: Math.round(r.T), stones: r.stones, portals: r.portals });
    if (Date.now() - t0 > 420000) { console.log('time cap'); break; }
  }
  await sleep(2600);
  const st = await page.evaluate(() => ({ state: window.__game.state(), score: window.__game.G().score }));
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const speed = secs > 100 ? 3 : secs > 50 ? 2 : 1, name = speed > 1 ? `run-${speed}x.mp4` : 'run.mp4';
  for (const f of fs.readdirSync(OUT)) if (/^run(-\dx)?\.mp4$/.test(f)) fs.rmSync(path.join(OUT, f));
  const vf = speed > 1 ? ['-vf', `setpts=PTS/${speed}`, '-r', '30'] : [];
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), ...vf, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', path.join(OUT, name)]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(`BROWSER run: real CDP touch, ${turns} finger moves, min gap between turns ${Math.round(minGameGap)} ms of game time (${minGap} ms wall-clock incl. browser jitter), decisions made >= 150 ms ahead, missed ticks ${missed}`);
  console.log(`  final score ${st.score} (${st.state}), ${secs.toFixed(0)} s; ramp: ` + samples.map(x => `${x.s}s ${x.score}pts ${x.tickMs}ms/tick ${x.stones} stones ${x.portals} portal pairs`).join(' | '));
  console.log(`  video ${name} ${(fs.statSync(path.join(OUT, name)).size / 1048576).toFixed(1)} MB; console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  const a = process.argv.slice(2), ri = a.indexOf('--runs'), runs = ri >= 0 ? +a[ri + 1] : 40;
  if (!a.includes('--browser-only')) simReport(runs);
  if (a.includes('--sim-only')) return;
  await browserRun(2500);
})();
