// Verification for 石砲攻城記 (slingshot-siege).
// 1) Node: extracts the game's own core (CORE-START/END) from ../index.html, regenerates all 100 castles from the
//    embedded LEVELS seeds and replays the recorded solutions (demo/solutions.json) with the deterministic physics
//    -> proves every level is clearable within its ammo; checks the spec formulas, new-element schedule,
//    strictly increasing difficulty metric and +-1px robustness of each level's final shot.
// 2) Chromium: an auto-player drives the real page with real touch input (CDP Input.dispatchTouchEvent) at human pace
//    (>=150ms reaction, 400ms pull) and clears levels 50, 75, 99, 100, recording level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--node-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {World, genLevel, buildWorld, levelCover, levelParams, pullToVel, rng, TICK, DT, GRAV, SLING_X, SLING_Y};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const S = require('./solver.js')(C);
const SOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions.json'), 'utf8')).levels;

function nodeVerify(){
  let ok = true, robSum = 0, robN = 0, shotsTot = 0;
  const rows = [];
  for (let n = 1; n <= 100; n++){
    const L = LEVELS[n-1], sol = SOL[n-1];
    if (!sol || sol.seed !== L[0]){ console.log('LEVEL', n, 'seed mismatch'); ok = false; continue; }
    const spec = C.genLevel(n, L[0]), P = spec.P;
    const ammo = L[1];
    const rp = S.replay(spec, sol.shots, { delay: 90 + (n % 5)*37 });   // different idle times than the solver used
    const cleared = rp.W.gobAlive === 0 && sol.shots.length <= ammo;
    const cover = C.levelCover(spec);
    const A = sol.shots.length + P.slack;
    const D = 0.4*P.T + 0.03*P.B + 4*cover + 2*(1 - P.slack/A);
    if (!cleared){ ok = false; console.log('LEVEL', n, 'NOT CLEARED by replay', rp.W.gobAlive, 'goblins left'); }
    if (ammo !== A){ ok = false; console.log('LEVEL', n, 'ammo', ammo, '!= best+slack', A); }
    if (spec.gobs.length !== P.T || spec.blocks.length !== P.B){ ok = false; console.log('LEVEL', n, 'T/B mismatch', spec.gobs.length, P.T, spec.blocks.length, P.B); }
    // robustness: +-1px on the final shot from the same pre-state
    if (n % 5 === 0 || n >= 96 || n === 50 || n === 75 || n === 99){
      const pre = C.buildWorld(spec); for (let i = 0; i < sol.shots.length - 1; i++) S.runShot(pre, sol.shots[i], spec.pattern[i]);
      const last = sol.shots[sol.shots.length - 1]; let good = 0;
      for (const [ex, ey] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){ const W2 = pre.clone(); S.runShot(W2, { dx: last.dx + ex, dy: last.dy + ey, tap: last.tap, ph: last.ph }, spec.pattern[sol.shots.length - 1]); if (W2.gobAlive === 0) good++; }
      robSum += good/8; robN++;
      sol._rob = good/8;
    }
    shotsTot += sol.shots.length;
    rows.push({ n, T: P.T, B: P.B, cover, D, ammo, best: sol.shots.length, score: rp.W.score, diff: L[5], hasSplit: spec.pattern.includes(1), wind: spec.wind, movers: spec.movers.length, chains: spec.chains.length, tnt: spec.blocks.filter(b => b.k === 'tnt').length, D_: P.D });
  }
  let mono = true; for (let i = 1; i < rows.length; i++) if (!(rows[i].D > rows[i-1].D) || !(rows[i].diff > rows[i-1].diff)){ mono = false; console.log('difficulty not increasing at', rows[i].n, rows[i-1].D.toFixed(3), rows[i].D.toFixed(3), rows[i].diff); }
  const first = k => (rows.find(r => r[k]) || {}).n;
  console.log('All 100 levels replayed to a clear within the given ammo (deterministic core):', ok);
  console.log('Difficulty metric D = 0.4T + 0.03B + 4*cover + 2*(1 - slack/A) strictly increasing:', mono, '| D range', rows[0].D.toFixed(2), '->', rows[99].D.toFixed(2), '| shown 難度', rows[0].diff, '->', rows[99].diff);
  console.log('Final-shot robustness (+-1px, 8 neighbours) averaged over', robN, 'levels:', (robSum/robN*100).toFixed(0) + '%');
  console.log('New elements first appear: split', first('hasSplit'), '| chains', first('chains'), '| TNT', first('tnt'), '| movers', first('movers'), '| wind', first('wind'));
  for (const n of [1, 25, 50, 75, 99, 100]){ const r = rows[n-1]; console.log('  L' + n, 'goblins', r.T, 'blocks', r.B, 'cover', r.cover.toFixed(2), 'distance', r.D_.toFixed(1), 'best shots', r.best, 'ammo', r.ammo, '難度', r.diff, 'D', r.D.toFixed(2)); }
  console.log('Total shots in all solutions:', shotsTot);
  return ok && mono;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y){ await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel){ const b = await page.locator(sel).boundingBox(); await touchTap(cdp, Math.round(b.x + b.width/2), Math.round(b.y + b.height/2)); }
const st = page => page.evaluate(() => window.__game.state());

async function playLevel(browser, n, VW, VH){
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const sol = SOL[n-1], spec = C.genLevel(n, LEVELS[n-1][0]);
  const vdir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'slingsiege-vid' + n + '-')); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: VW, height: VH } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(900);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true'){ await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')){ await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(300); }
  for (let k = 0; k < 200; k++){ const s = await st(page); if (s.phase === 'aim' && s.introT <= 0) break; await sleep(50); }
  const t0 = Date.now(), log = [];
  let coverShot = null;
  for (let i = 0; i < sol.shots.length; i++){
    const shot = sol.shots[i];
    for (let k = 0; k < 600; k++){ const s = await st(page); if (s.phase === 'aim') break; await sleep(50); }
    await sleep(150 + Math.floor(Math.random()*120));          // human reaction
    // wait until the camera has glided back to the slingshot (its screen position stops moving)
    let s0 = await st(page);
    for (let k = 0; k < 80; k++){ await sleep(100); const s = await st(page); const still = Math.hypot(s.sling.x - s0.sling.x, s.sling.y - s0.sling.y) < 0.5; s0 = s; if (still) break; }
    const prevL = s0.lastL;
    const x0 = Math.round(s0.sling.x + 40), y0 = Math.round(s0.sling.y + 10);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    const steps = 16;                                          // 400 ms pull
    for (let j = 1; j <= steps; j++){ await sleep(25); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - Math.round(shot.dx*j/steps), y: y0 + Math.round(shot.dy*j/steps) }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - shot.dx, y: y0 + shot.dy }] });
    await sleep(120);
    let L = -1, brk = -1;
    if (shot.ph >= 0){
      // moving targets: release so the launch lands on the planned phase of the platform swing
      const s1 = await st(page), P = s1.P;
      L = Math.ceil((s1.step + 48)/6)*6; while (L % P !== shot.ph) L += 6;
      for (;;){ const s = await st(page); if (s.step >= L - 9 && s.step <= L - 7){ brk = s.step; break; } if (s.step > L - 7){ L += P; } await sleep(4); }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // ability tap at the planned moment of the flight
    let s2; for (let k = 0; k < 400; k++){ s2 = await st(page); if (s2.phase === 'flight' && s2.lastL !== prevL && s2.proj) break; await sleep(5); }
    const Lr = s2.lastL;
    if (shot.tap >= 0){
      const T = Lr + shot.tap;
      for (;;){ const s = await st(page); if (s.step >= T - 9) break; await sleep(4); }
      await touchTap(cdp, Math.round(VW*0.6), Math.round(VH*0.35));
    }
    if (n === 75 && i === 0 && !coverShot){ await sleep(1700); coverShot = path.join(OUT, '_cover.png'); await page.screenshot({ path: coverShot }); }
    for (let k = 0; k < 600; k++){ const s = await st(page); if (s.phase !== 'flight') break; await sleep(50); }
    const s3 = await st(page);
    log.push({ shot: i + 1, plannedL: L, brk, launchStep: Lr, plannedPhase: shot.ph, phaseOk: shot.ph < 0 || Lr % s3.P === shot.ph, tapStep: s3.lastT, tapOk: shot.tap < 0 || s3.lastT === Lr + shot.tap, goblinsLeft: s3.gobs });
  }
  for (let k = 0; k < 100; k++){ if (await page.isVisible('#win')) break; await sleep(100); }
  await sleep(1600);
  const fin = await st(page), winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0)/1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryfast', '-movflags', '+faststart', mp4]);
  try { fs.rmSync(vdir, { recursive: true, force: true }); } catch (e) {}
  let mp4KB = Math.round(fs.statSync(mp4).size/1024), name = 'level-' + n + '.mp4';
  if (mp4KB > 8000){ const fast = path.join(OUT, 'level-' + n + '-2x.mp4'); execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=0.5*PTS', '-an', '-c:v', 'libx264', '-crf', '32', fast]); fs.rmSync(mp4); mp4KB = Math.round(fs.statSync(fast).size/1024); name = path.basename(fast); }
  return { n, cleared: fin.phase === 'won' && winVisible && fin.gobs === 0, shots: sol.shots.length, ammo: LEVELS[n-1][1], secs, errors, name, mp4KB, log, coverShot };
}

(async () => {
  const args = process.argv.slice(2);
  const okNode = nodeVerify();
  if (args.includes('--node-only')) return;
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets){
    const r = await playLevel(browser, n, 844, 390);
    console.log('BOT level', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'shots', r.shots, '/ ammo', r.ammo, 'time', r.secs + 's', 'video', r.name, r.mp4KB + 'KB', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no errors');
    console.log('   ', r.log.map(l => '#' + l.shot + ' launch@' + l.launchStep + '(plan ' + l.plannedL + ' brk ' + l.brk + ')' + (l.plannedPhase >= 0 ? (l.phaseOk ? ' phase-ok' : ' PHASE-MISS') : '') + (l.tapStep >= 0 ? (l.tapOk ? ' tap-ok' : ' tap-off') : '') + ' left ' + l.goblinsLeft).join(' | '));
  }
  await browser.close();
})();
