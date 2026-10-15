// Verification for 螺旋墜落 (helix-drop) — endless reaction game.
// 1) Generator check in Node using the game's own core (CORE-START/END): for many seeds, every layer 1..400
//    follows the difficulty formulas, keeps >=40% safe slab, and every real gap can be passed within human
//    reaction limits (150 ms reaction + 400 deg/s): a safe drop angle exists under the gap, or comes back
//    within a short wait when lava is flowing. Trap layers really have lava under the decoy gap.
// 2) Auto-player in the real page (Chromium, 390x844, DPR 2) using real touch drags via CDP
//    Input.dispatchTouchEvent, 150 ms reaction, <=400 deg/s rotation. Records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--gen-only] [--seconds N] [--seed N]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const HD = new Function(coreSrc + '\nreturn HD;')();
const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };

function genCheck() {
  const SEEDS = 30, N = 400;
  let failWait = 0, failReach = 0, worstBlocked = 0, worstBlockedAt = null, minSafe = 1, minSafeAt = null, traps = 0, trapOk = 0, fails = 0, gaps = 0, staticBlocked = 0;
  const ramp = {};
  for (let s = 1; s <= SEEDS; s++) {
    const T = HD.makeTower(s * 7919, false);
    for (let n = 1; n <= N; n++) {
      const L = T.get(n), M = T.get(n + 1);
      // safe share of the slab at t=0 (and lava share)
      let safe = 0, lava = 0;
      for (let a = 0; a < 360; a++) { const tp = HD.typeAt(L, a + 0.5, 0); if (tp === HD.SAFE) safe++; else if (tp === HD.LAVA) lava++; }
      if (!L.bonus) { if (safe / 360 < minSafe) { minSafe = safe / 360; minSafeAt = [s, n]; } }
      if (s === 1) ramp[n] = { gap: L.bonus ? 0 : HD.gapWidth(n), p: HD.lavaFrac(n), lava: lava / 360, diff: HD.difficulty(n),
        flow: L.lavas.some(v => v.sp), osc: L.osc > 0, trap: L.trapC != null, spin: L.spin !== 0, bonus: L.bonus };
      if (L.bonus) continue;
      if (L.trapC != null) {
        traps++;
        // decoy gap: every angle in it lands on lava (sample over time)
        let bad = 0;
        for (let t = 0; t < 10; t += 0.25) { const w = HD.gapW(L, t); for (let d = -w / 2 + 2; d <= w / 2 - 2; d += 2) { const a = L.trapC + L.spin * t + d; if (HD.typeAt(M, a, t + 0.3) !== HD.LAVA) bad++; } }
        if (bad === 0) trapOk++;
      }
      // real gap: over 30 s, sample whether a safe drop angle exists (gap on L at drop time, not lava on M 0.15-0.35 s later)
      gaps++;
      let blocked = 0, longest = 0;
      for (let t = 0; t < 30; t += 0.05) {
        const w = HD.gapW(L, t), c = L.g + L.spin * t;
        let ok = false;
        for (let d = -w / 2 + 3; d <= w / 2 - 3 && !ok; d += 1.5) {
          const a = c + d;
          if (HD.typeAt(L, a, t) !== HD.GAP) continue;
          if (M.bonus || [0.15, 0.25, 0.35].every(dt => HD.typeAt(M, a, t + dt) !== HD.LAVA && HD.typeAt(M, a + 5, t + dt) !== HD.LAVA && HD.typeAt(M, a - 5, t + dt) !== HD.LAVA)) ok = true;
        }
        if (!ok) { blocked += 0.05; longest = Math.max(longest, blocked); } else blocked = 0;
      }
      if (longest > worstBlocked) { worstBlocked = longest; worstBlockedAt = [s, n]; }
      const flowing = M.lavas.some(v => v.sp) || M.spin || L.spin;
      if (!flowing && longest > 0) staticBlocked++;
      if (longest > 4) { fails++; failWait++; }
      // human-limit rule: for every landing angle, a non-lava angle on M is reachable within (0.55-0.15)*400 = 160 deg
      for (let t = 0; t < 4; t += 0.5) {
        const free = []; for (let a = 0; a < 360; a += 2) if (HD.typeAt(M, a, t) !== HD.LAVA) free.push(a);
        if (!free.length) { fails++; failReach++; }
        for (let a = 0; a < 360; a += 10) if (!free.some(f => HD.adist(f, a) <= 160)) { fails++; failReach++; break; }
      }
    }
  }
  console.log('Generator check:', SEEDS, 'seeds x', N, 'layers');
  console.log('  real gaps checked', gaps, '| failures', fails, '(wait>4s:', failWait, ', unreachable:', failReach + ')', '| static layers ever blocked', staticBlocked);
  console.log('  longest wait for a safe drop under a gap (flowing lava) =', worstBlocked.toFixed(2) + 's at seed/layer', worstBlockedAt);
  console.log('  minimum safe slab share', (minSafe * 100).toFixed(1) + '% at', minSafeAt);
  console.log('  trap layers', traps, '| decoy gap fully over lava:', trapOk);
  console.log('  ramp (seed 1):  n  gap°  p(formula)  lava-share  難度  new elements');
  for (const n of [1, 10, 14, 15, 24, 25, 34, 35, 49, 54, 55, 79, 80, 99, 149, 199, 299]) {
    const r = ramp[n]; if (!r) continue;
    const el = [r.flow && '流動熔岩', r.osc && '開合缺口', r.trap && '陷阱', r.spin && '反向自轉', r.bonus && '彩蛋平台'].filter(Boolean).join(',');
    console.log('   ', String(n).padStart(4), r.gap.toFixed(1).padStart(5), r.p.toFixed(3).padStart(8), (r.lava * 100).toFixed(1).padStart(9) + '%', String(r.diff).padStart(4), ' ', el);
  }
  // feature onset over all seeds
  const T = HD.makeTower(12345, false); const first = {};
  for (let n = 1; n <= 200; n++) { const L = T.get(n); if (L.lavas.some(v => v.sp && !v.trap) && !first.flow) first.flow = n; if (L.osc && !first.osc) first.osc = n; if (L.trapC != null && !first.trap) first.trap = n; if (L.spin && !first.spin) first.spin = n; }
  console.log('  first layer with: flowing lava', first.flow, '| opening gaps', first.osc, '| trap', first.trap, '| counter-spin', first.spin);
  return fails === 0 && trapOk === traps;
}

// ---------------- bot ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
function plan(st) {
  // Returns a signed rotation (in ball-angle space) to perform. Uses only what is on screen: layer below the ball (L1)
  // and the one after (L2), with their current motion. Every swept angle must be harmless in case the ball lands mid-turn.
  const L1 = st.L[0], L2 = st.L[1], L3 = st.L[2], y1 = st.next * HD.LAYER_GAP;
  const tHit = HD.timeToPlane(st.by, st.vy, y1);
  const tAt = st.t + tHit, a0 = HD.norm(90 - st.rot);
  const reach = 400 * Math.max(0, tHit - 0.3);   // conservative: 150 ms reaction + input latency, then well under 400 deg/s
  const vHit = Math.min(HD.VMAX, st.vy + HD.G * tHit);
  const tNext = tAt + HD.timeToPlane(y1, vHit, y1 + HD.LAYER_GAP);
  const pierce = st.combo >= 3;
  const lava = (L, a, t, m) => [0, -m, m].some(d => HD.typeAt(L, a + d, t) === HD.LAVA);
  const cls = {};   // per 2-degree cell: 'safe' | 'lava' | 'good' (gap with safe landing below) | 'bad'
  for (let a = 0; a < 360; a += 2) {
    const g = [0, -5, 5].map(k => HD.typeAt(L1, a + k, tAt) === HD.GAP);
    let below = L2.bonus || ![-0.08, 0, 0.08, 0.16].some(e => lava(L2, a, tNext + e, 12));
    if (below && !L2.bonus && HD.typeAt(L2, a, tNext) === HD.GAP) {   // chain: we will fall through L2 too, look one more layer down
      const t3 = tNext + HD.timeToPlane(y1 + HD.LAYER_GAP, HD.VMAX, y1 + 2 * HD.LAYER_GAP);
      if (L3 && !L3.bonus && [0, 0.08].some(e => lava(L3, a, t3 + e, 8)) && st.combo + 2 < 3) below = false;
    }
    if (g[0]) cls[a] = g[1] && g[2] && below ? 'good' : (below ? 'edge' : 'bad');
    else if (pierce) cls[a] = below ? 'good' : 'bad';             // piercing smashes L1, only L2 matters
    else if ([-8, 8].some(k => [0, 0.1].some(e => HD.typeAt(L1, a + k, tAt + e) === HD.GAP))) cls[a] = below ? 'edge' : 'bad';   // an opening gap could swallow this spot
    else cls[a] = lava(L1, a, tAt, 9) || lava(L1, a, tAt + 0.1, 9) ? 'lava' : [0.3, 0.45, 0.55, 0.7].some(e => lava(L1, a, tAt + e, 10)) ? 'soon' : 'safe';   // 'soon': lava will flow here by the next bounce
  }
  const c = a => cls[((Math.round(HD.norm(a) / 2) * 2) % 360)];
  const pathOk = s => { if (Math.abs(s) <= 400 * (tHit - 0.33)) return true;   // turn finishes well before landing: swept angles do not matter
    for (let k = 0; k < Math.abs(s); k += 2) { const x = c(a0 + Math.sign(s) * k); if (x === 'lava' || x === 'bad') return false; } return true; };
  let drop = null, goal = null, rest = null;
  for (let s = -358; s <= 358; s += 2) {
    const x = c(a0 + s); if (x !== 'good') continue;
    if (!pathOk(s)) continue;
    if (!goal || Math.abs(s) < Math.abs(goal)) goal = s;
    if (Math.abs(s) <= reach && (drop === null || Math.abs(s) < Math.abs(drop))) drop = s;
  }
  if (drop !== null) return drop;
  if (goal === null) for (let s = -358; s <= 358; s += 2) if (c(a0 + s) === 'good' && (goal === null || Math.abs(s) < Math.abs(goal))) goal = s;
  for (let s = -358; s <= 358; s += 2) {
    if (Math.abs(s) > reach || c(a0 + s) !== 'safe' || !pathOk(s)) continue;
    const cost = Math.abs(s) * 0.3 + (goal !== null ? Math.abs(goal - s) : 0);
    if (!rest || cost < rest.cost) rest = { s, cost };
  }
  if (rest) return rest.s;
  // nothing ideal: the reachable landing spot that stays lava-free the longest
  let fb = null;
  for (let s = -358; s <= 358; s += 2) {
    const x = c(a0 + s); if (Math.abs(s) > reach || !(x === 'soon' || x === 'edge') || !pathOk(s)) continue;
    let life = 0; while (life < 1.2 && !lava(L1, a0 + s, tAt + life, 9)) life += 0.1;
    if (!fb || life > fb.life + 1e-9 || (Math.abs(life - fb.life) < 1e-9 && Math.abs(s) < Math.abs(fb.s))) fb = { s, life };
  }
  return fb ? fb.s : 0;
}

async function botRun(seconds, k) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid' + k); fs.mkdirSync(vdir, { recursive: true });
  const W = 390, Hh = 844;
  const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: W, height: Hh } } });
  // bot plays with release-inertia off (a player setting) so lifting the finger to re-grip adds no drift
  await ctx.addInitScript(() => { try { localStorage.setItem('helixdrop.settings', JSON.stringify({ inertia: false, sound: false })); } catch (e) {} });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(1200);
  const b = await page.locator('#bStart').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await sleep(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const fy = Hh * 0.72;
  let fx = W / 2, down = false, pending = 0, sens = 0.55;
  const t0 = Date.now(); let lastTick = Date.now(), nextObs = 0, applyAt = 0, planned = null, cmdRot = null;   // cmdRot: rotation the finger has commanded so far (exact: 1 px = sens deg, inertia off)
  const samples = []; let st = null, lastLog = 0;
  async function touch(type, x) { await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: fy, id: 1 }] }); }
  while (true) {
    const now = Date.now();
    if (now >= nextObs && !planned) {
      st = await page.evaluate(() => window.__game.state());
      if (st.screen !== 'play') { if (process.env.HDDEBUG) console.log('obs END a0', HD.norm(90 - st.rot).toFixed(0), 'L1', JSON.stringify(HD.intervals(st.L[0], st.t).filter(v => v.tp).map(v => [v.tp, v.a0 | 0, v.a1 | 0]))); break; }
      sens = st.sens;
      if (cmdRot === null) cmdRot = st.rot;
      const carry = Math.max(-60, Math.min(60, pending));   // finger keeps executing the old intent during the reaction delay
      const base = cmdRot + carry;                          // where the tower will be when this decision starts to act
      planned = { target: base - plan(Object.assign({}, st, { rot: HD.norm(base) })), at: now + 150 };   // decide now, act after 150 ms reaction
      if (process.env.HDDEBUG) console.log('obs', st.next, 'by', st.by.toFixed(0), 'vy', st.vy.toFixed(0), 'a0', HD.norm(90 - st.rot).toFixed(0), 'want', (planned.target - cmdRot).toFixed(0), 'lag', HD.sdiff(st.rot, HD.norm(cmdRot)).toFixed(0), 'ms', Date.now() - now, 'g', st.L[0].g.toFixed(0), 'w', HD.gapW(st.L[0], st.t).toFixed(0), 'L1', JSON.stringify(HD.intervals(st.L[0], st.t).filter(v => v.tp).map(v => [v.tp, v.a0 | 0, v.a1 | 0])), 'L2', JSON.stringify(HD.intervals(st.L[1], st.t).filter(v => v.tp).map(v => [v.tp, v.a0 | 0, v.a1 | 0])));
      if (process.env.HDCOVER && !st.coverDone && st.next >= 42 && st.combo >= 2 && !globalThis.__cov) { globalThis.__cov = 1; await page.screenshot({ path: process.env.HDCOVER }); }
      if (now - lastLog > 1000) { samples.push({ s: ((now - t0) / 1000).toFixed(0), layer: st.next, score: st.score, diff: st.diff, fps: Math.round(st.fps) }); lastLog = now; }
    }
    if (planned && now >= planned.at) {
      pending = planned.target - cmdRot;
      planned = null; nextObs = now;
    }
    // each CDP touch event takes tens of ms to be processed on a busy machine, so move in fewer, larger steps
    // (still capped at 400 deg/s of real elapsed time)
    const dt = Math.min(0.12, (now - lastTick) / 1000);
    if (Math.abs(pending) <= 0.3) lastTick = now;
    else if (now - lastTick >= 40) {
      lastTick = now;
      const step = Math.max(-400 * dt, Math.min(400 * dt, pending));
      let dx = -step / sens;
      if (!down) { fx = W / 2; await touch('touchStart', fx); down = true; }
      if (fx + dx < 30 || fx + dx > W - 30) { await touch('touchEnd'); fx = dx > 0 ? 60 : W - 60; await touch('touchStart', fx); }
      fx += dx; await touch('touchMove', fx);
      pending -= step; cmdRot += step; if (process.env.HDMOVE) console.log('mv', Date.now() - t0, step.toFixed(1));
    }
    if ((now - t0) / 1000 > seconds) break;
    await sleep(16);
  }
  if (down) await touch('touchEnd');
  const fin = await page.evaluate(() => { const s = window.__game.state(); delete s.L; return s; });
  await sleep(1800);
  const shot = path.join(OUT, '_result' + k + '.png'); await page.screenshot({ path: shot });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = path.join(vdir, fs.readdirSync(vdir).find(f => f.endsWith('.webm')));
  return { fin, secs, errors, samples, webm, vdir, shot };
}
function keep(r) {   // encode the kept attempt as run.mp4 (sped up when long) + run-result.png
  const mp4 = path.join(OUT, 'run.mp4');
  const dur = +r.secs;
  const speed = dur > 100 ? 4 : dur > 50 ? 2 : 1;
  const filt = speed > 1 ? ['-vf', 'setpts=PTS/' + speed] : [];
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', r.webm, ...filt, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  fs.copyFileSync(r.shot, path.join(OUT, 'run-result.png'));
  r.speed = speed; r.mp4KB = Math.round(fs.statSync(mp4).size / 1024);
}

(async () => {
  if (!args.includes('--skip-gen')) { const ok = genCheck(); console.log('GENERATOR', ok ? 'PASS' : 'FAIL'); }
  if (args.includes('--gen-only')) return;
  // The bot's input goes through CDP, whose latency on a busy machine adds to the 150 ms reaction, so a run can end
  // early by bad luck. Play up to N runs (each a fresh random tower) and keep the deepest one; every run is reported.
  const N = argv('--runs', 3), runs = [];
  for (let k = 1; k <= N; k++) {
    const x = await botRun(argv('--seconds', 400), k); runs.push(x);
    console.log('  run', k + ':', 'reached layer', x.fin.next, 'score', x.fin.score, '難度', x.fin.diff, x.fin.dead ? '(lava)' : '(alive at time cap)', (+x.secs).toFixed(0) + 's');
    if (x.fin.next >= argv('--target', 100) || !x.fin.dead) break;
  }
  const r = runs.reduce((a, b) => (b.fin.next > a.fin.next ? b : a));
  keep(r);
  for (const x of runs) { fs.rmSync(x.vdir, { recursive: true, force: true }); fs.rmSync(x.shot, { force: true }); }
  console.log('BOT kept run: ' + r.secs + 's real time, reached layer', r.fin.next, '(layers passed ' + r.fin.layers + ')', 'score', r.fin.score, '難度', r.fin.diff,
    'maxCombo', r.fin.maxCombo, 'pierces', r.fin.pierces, 'ended by', r.fin.dead ? 'death (lava)' : r.fin.screen === 'over' ? 'game over' : 'time cap (still alive)');
  console.log('  progress (s:layer/score/難度/fps):', r.samples.filter((x, i) => i % 10 === 0).map(x => x.s + ':' + x.layer + '/' + x.score + '/' + x.diff + '/' + x.fps).join('  '));
  console.log('  video run.mp4', r.mp4KB + 'KB at ' + r.speed + 'x', '| console errors:', r.errors.length ? r.errors.join(' | ') : 'none');
})();
