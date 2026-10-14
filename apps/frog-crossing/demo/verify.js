// Verification for 小蛙過河 (frog-crossing).
// 1) Uses the game's own core (CORE-START/END) to BFS every one of the 100 levels over (time tick 40ms, row, x):
//    from 5 different start phases, all 5 lily-pad nests must be reachable within the trip time limit while every
//    hazard is inflated by a ±150 ms timing margin (= 300 ms safety window). Also checks 難度 D strictly increases.
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page (390x844, touch) with real CDP touch input
//    (taps + swipes) at human pace (>=160 ms between inputs). It plans with the same core BFS from the live game
//    state and keeps a safety margin, measuring how late its touches register and compensating.
//    Up to 4 attempts per level are allowed (3 lives each); the report says which attempt cleared.
// 3) Filming: a screen recorder on this shared, heavily loaded machine adds 100-300 ms of jittery input lag, so the
//    live run is not recorded. Instead the page re-plays that run's exact input log (each input at the world time
//    it registered; the game is deterministic) while the screen is captured -> level-NN.mp4. The script checks
//    the replay reaches the same outcome. level-NN-result.png is a screenshot of the live run's win screen.
// Usage: node verify.js [--solve-only | --play-only] [--fix] [levels...]   (default levels: 50 75 99 100)
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {genLevel, params, plan, newFrog, stepFrog, TICK, ROWS};')();
const SALTS = Function('return ' + html.match(/var SALTS = (\{[^}]*\});/)[1])();
const PHASES = [0, 2.2, 4.9, 7.3, 11.6], MARGIN = 0.15;

function checkLevel(n, salt) {
  const L = core.genLevel(n, salt);
  let worst = 0, nodes = 0;
  for (const ph of PHASES) {
    const r = core.plan(L, core.newFrog(), ph, { margin: MARGIN, horizon: L.T });
    nodes += r.nodes;
    for (const a of r.arrive) { if (a < 0) return { ok: false, L }; worst = Math.max(worst, a); }
  }
  return { ok: true, L, worst, nodes };
}
function solveAll(fix) {
  let ok = true, prevD = -1, mono = true; const rows = [], newSalts = {};
  const t0 = Date.now();
  for (let n = 1; n <= 100; n++) {
    let salt = SALTS[n] || 0, r = checkLevel(n, salt);
    if (!r.ok && fix) { for (let s = 1; s < 50 && !r.ok; s++) { r = checkLevel(n, s); if (r.ok) { salt = s; newSalts[n] = s; } } }
    if (!r.ok) { ok = false; console.log('LEVEL', n, 'NOT VERIFIED (salt ' + salt + ')'); }
    const D = r.L.D; if (D <= prevD) { mono = false; console.log('D not increasing at', n, prevD, '->', D); } prevD = D;
    rows.push({ n, D, worst: r.worst, T: r.L.T, lanes: r.L.P.C + '+' + r.L.P.R, mech: r.L.P.mech.length });
  }
  console.log(`All 100 levels: every nest reachable from ${PHASES.length} start phases with ${MARGIN * 2 * 1000}ms safety window: ${ok}`);
  console.log('難度 D strictly increasing 1..100:', mono, ' D range', rows[0].D, '->', rows[99].D, ` (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  for (const n of [1, 10, 25, 50, 75, 99, 100]) { const r = rows[n - 1]; console.log(`  level ${n}: D ${r.D}, roads+rivers ${r.lanes}, mechanics ${r.mech}, trip limit ${r.T.toFixed(0)}s, slowest nest reached in ${r.worst.toFixed(1)}s`); }
  if (fix && Object.keys(newSalts).length) console.log('SALTS overrides:', JSON.stringify(newSalts));
  return ok && mono;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Gestures are sent without waiting for each CDP ack in between (acks only return after the page handled the event,
// which on a busy machine would add latency between touchStart and the move that triggers the jump).
async function touchTap(cdp, x, y) {
  const p1 = cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(12);
  const p2 = cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await Promise.all([p1, p2]);
}
async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d];
  const ps = [cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }),
    cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * 20, y: y + DY * 20 }] }),
    cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * 44, y: y + DY * 44 }] })];
  await sleep(20);
  ps.push(cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }));
  await Promise.all(ps);
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2);
}

async function playLevel(browser, n) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(300); }
  const lv = await page.evaluate(() => window.__game.level());
  const L = core.genLevel(n, lv.salt);
  const X = 195, Y = 520; // gestures land mid-screen, like a thumb
  const getS = () => page.evaluate(() => window.__game.state());
  const t0 = Date.now(); let rushes = 0, prevDeaths = 0, deathLog = [], lastChain = [], sent = 0, lastReg = -1, emaT = { tap: 0.03, swipe: 0.02 }, ema = 0.03, lead = 0.08, late = 0, maxPlan = 0, lastAct = 0, inputs = 0, taps = 0, swipes = 0, replans = 0, minGap = 1e9, st;
  while (Date.now() - t0 < 300000) {
    st = await getS();
    if (st.deaths !== prevDeaths) { prevDeaths = st.deaths; deathLog.push(st.cause); if (process.env.DEBUG) console.log('DEATH', st.cause, 'row', st.row, 'x', st.x.toFixed(2), 't', st.t.toFixed(3), 'last chain', JSON.stringify(lastChain.map(c => [c.d, +c.target.toFixed(3), c.reg]))); }
    if (st.status === 'won' || st.status === 'over') break;
    if (st.status !== 'play' || st.jt >= 0 || st.paused) { await sleep(15); continue; }
    // predict `lead` seconds ahead (covers planning + input latency), then BFS from there with the widest timing margin that works
    const F = { row: st.row, x: st.x, jt: -1 }; let tl = st.t, dead = false;
    let nT = Math.max(2, Math.round(lead / core.TICK));
    for (let i = 0; i < nT; i++) { const r = core.stepFrog(L, F, tl, core.TICK, core.TICK, 0); tl += core.TICK; if (r) { dead = true; break; } }
    let rush = false;
    if (dead) { // danger is close: plan from just ahead of now, quick and short
      rush = true; F.row = st.row; F.x = st.x; tl = st.t; nT = Math.max(1, Math.round((ema + 0.05) / core.TICK));
      for (let i = 0; i < nT; i++) { core.stepFrog(L, F, tl, core.TICK, core.TICK, 0); tl += core.TICK; }
    }
    const pt0 = Date.now();
    let pl = null, usedM = 0;
    for (const mg of (rush ? [0.1, 0.04, 0] : [0.2, 0.13, 0.07, 0.03])) { usedM = mg; pl = core.plan(L, F, tl, rush ? { margin: mg, horizon: 1.6, survive: 30, filled: st.filled } : { margin: mg, horizon: 14, filled: st.filled, first: true }); if (pl.path) break; }
    if (rush) rushes++;
    const ptime = Date.now() - pt0; maxPlan = Math.max(maxPlan, ptime); replans++;
    if (!pl.path) { await sleep(20); continue; }
    if (!rush) lead = Math.max(0.12, Math.min(0.6, ptime / 1000 * 1.5 + 0.06 + ema));
    // execute the planned chain of inputs (pipelined: input latency on a loaded machine can exceed the 160 ms spacing),
    // re-planning when timing drifts or the next input is far away
    const chain = []; lastChain = chain;
    for (let i = 0; i < pl.path.length; i++) {
      const step = pl.path[i], target = tl + step.t;
      // one round-trip per input: see how earlier inputs registered and re-sync the game clock
      const info = await page.evaluate(() => window.__game.inputs());
      const w0 = Date.now(), g0 = info.t;
      if (info.status !== 'play') break;
      let bad = false;
      for (const c of chain) if (c.reg == null) { const k = c.idx - info.count + info.log.length; if (k >= 0 && k < info.log.length) { c.reg = info.log[k][0]; const err = c.reg - c.target; const ty = c.d === 0 ? 'tap' : 'swipe'; emaT[ty] = Math.max(0, Math.min(0.3, emaT[ty] + err * 0.4)); ema = Math.max(emaT.tap, emaT.swipe); if (Math.abs(err) > Math.max(0.05, usedM)) bad = true; if (process.env.DEBUG) console.log('  reg', c.d, 'err', err.toFixed(3), 'ema', ema.toFixed(3), 'm', usedM); } }
      if (bad) break;
      // the page tells us when its last frame ran (same machine clock), so game time "now" is G.t + elapsed since that frame
      const gameAt = w => g0 + (w - info.frameWall) / 1000 * info.ws;
      const em = step.d === 0 ? emaT.tap : emaT.swipe;
      const delay = (target - em - gameAt(Date.now())) * 1000;
      if (delay < -Math.max(30, usedM * 700)) { if (i === 0) { lead = Math.min(0.6, lead + 0.06); late++; } break; } // too late to follow this plan
      if (delay > 0) { await sleep(Math.max(0, delay - 4)); while ((target - em - gameAt(Date.now())) > 0.001) await new Promise(r => setImmediate(r)); }
      const since = Date.now() - lastAct; if (since < 160) { await sleep(Math.max(0, 157 - since)); while (Date.now() - lastAct < 160) await new Promise(r => setImmediate(r)); }
      if (lastAct) minGap = Math.min(minGap, Date.now() - lastAct);
      lastAct = Date.now(); inputs++;
      chain.push({ idx: sent++, target, d: step.d });
      if (step.d === 0) { taps++; await touchTap(cdp, X, Y); } else { swipes++; await swipe(cdp, X, Y, step.d); }
    }
    // wait until every dispatched input has reached the game before planning again
    for (let k = 0; k < 40; k++) { const info = await page.evaluate(() => window.__game.inputs()); if (info.count >= sent) break; await sleep(15); }
    for (let k = 0; k < 60; k++) { const s3 = await getS(); if (s3.status !== 'play' || s3.jt < 0) break; await sleep(15); }
  }
  await sleep(2600);
  st = await getS();
  const winVisible = await page.isVisible('#win');
  const log = await page.evaluate(() => window.__game.fullLog());
  const trace = await page.evaluate(() => window.__game.trace());
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = (Date.now() - t0) / 1000;
  await ctx.close();
  return { n, D: L.D, cleared: st.status === 'won' && winVisible, deaths: st.deaths, causes: deathLog, filled: st.filled, nests: st.filled.reduce((a, b) => a + b, 0), score: st.score, inputs, taps, swipes, minGap, secs: secs.toFixed(1), errors, maxPlan, late, rushes, log, trace };
}

// Film the run: the page re-plays the exact input log of the live run (each input at the world time it registered),
// which is deterministic, so the video shows that run without the screen recorder slowing the live run down.
async function filmReplay(browser, n, live) {
  const vdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'frogx-vid' + n + '-')); // frames stay outside the project folder
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', e => { frames.push({ ts: e.metadata.timestamp, data: e.data }); cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {}); });
  await sleep(500);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: 390, maxHeight: 844, everyNthFrame: 1 });
  await sleep(1200);
  await page.evaluate(([n, log]) => window.__game.replay(n, log), [n, live.log]);
  let st;
  for (let k = 0; k < 4000; k++) { st = await page.evaluate(() => window.__game.state()); if (st.status === 'won' || st.status === 'over') break; await sleep(100); }
  await sleep(2800);
  st = await page.evaluate(() => window.__game.state());
  const trace = await page.evaluate(() => window.__game.trace());
  await cdp.send('Page.stopScreencast').catch(() => {});
  await ctx.close();
  let list = '';
  frames.forEach((f, i) => { const fn = 'f' + String(i).padStart(5, '0') + '.jpg'; fs.writeFileSync(path.join(vdir, fn), Buffer.from(f.data, 'base64')); const d = i + 1 < frames.length ? Math.max(0.001, frames[i + 1].ts - f.ts) : 0.5; list += `file '${fn}'\nduration ${d.toFixed(4)}\n`; });
  list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
  fs.writeFileSync(path.join(vdir, 'list.txt'), list);
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  for (const f of fs.readdirSync(OUT)) if (new RegExp('^level-' + n + '(-\\dx)?\\.mp4$').test(f)) fs.rmSync(path.join(OUT, f));
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(vdir, 'list.txt'), '-vf', 'fps=30,scale=390:844', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 8e6) {
    const fast = path.join(OUT, 'level-' + n + '-2x.mp4');
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', 'setpts=0.5*PTS', '-r', '30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '32', '-movflags', '+faststart', fast]);
    fs.rmSync(mp4); mp4 = fast;
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  const same = st.status === 'won' && st.deaths === live.deaths && st.filled.join() === live.filled.join();
  if (!same) { for (let i = 0; i < Math.max(trace.length, live.trace.length); i++) { const a = trace[i] || [], b = live.trace[i] || []; if (a.length !== b.length || a.some((v, j) => typeof v === 'number' ? Math.abs(v - b[j]) > 1e-6 : v !== b[j])) { console.log('  replay diverges at trace', i, 'live', JSON.stringify(live.trace.slice(Math.max(0, i - 2), i + 2)), 'replay', JSON.stringify(trace.slice(Math.max(0, i - 2), i + 2))); break; } } }
  return { same, status: st.status, deaths: st.deaths, score: st.score, errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const good = args.includes('--play-only') ? true : solveAll(args.includes('--fix'));
  if (args.includes('--solve-only')) process.exit(good ? 0 : 1);
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  for (const n of targets) {
    let r, attempt = 0;
    do { attempt++; r = await playLevel(browser, n); if (!r.cleared) console.log(`  level ${n} attempt ${attempt}: not cleared (nests ${r.nests}, lost lives to ${r.causes.join(', ')}) - retrying`); } while (!r.cleared && attempt < 4);
    console.log(`BOT level ${n} (D ${r.D}): ${r.cleared ? 'CLEARED' : 'NOT CLEARED'} on attempt ${attempt}, nests ${r.nests}, lives lost ${r.deaths}${r.deaths ? ' (' + r.causes.join(', ') + ')' : ''}, score ${r.score}, ${r.inputs} touch inputs (${r.taps} taps / ${r.swipes} swipes), min gap between inputs ${r.minGap}ms, slowest plan ${r.maxPlan}ms, ${r.secs}s, ${r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors'}`);
    if (!r.cleared) continue;
    const f = await filmReplay(browser, n, r);
    console.log(`  film: replay of that run's ${r.log.length} inputs -> ${f.same ? 'same outcome (won, ' + f.deaths + ' lives lost, score ' + f.score + ' vs ' + r.score + ' live; time bonus rounds per frame)' : 'DIFFERENT outcome (' + f.status + ', lost ' + f.deaths + ', score ' + f.score + ')'}, ${f.mp4} ${f.mp4KB}KB, ${f.errors.length ? 'ERRORS ' + f.errors.join(' | ') : 'no console errors'}`);
  }
  await browser.close();
})();
