// Verification for 果嶺彈珠 (mini-golf).
// 1) Re-checks ALL 100 embedded holes in Node with the game's own core (extracted between CORE-START/CORE-END):
//    replays the stored solver solution (must hole in exactly `best` strokes), checks par = best+1 (2..6)
//    and that the difficulty metric D = 10*(cells*0.8 + obstacles*1.2 + mechanics*1.5 + par*0.7)/3 strictly increases.
// 2) A bot plays holes 50, 75, 99, 100 in the real page with real touch drags (CDP Input.dispatchTouchEvent),
//    >=150 ms between actions, planning each shot from the live ball position with the same core solver
//    (robust to +-3 ticks of timing on holes with moving parts). Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--solve-only] [holes...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = process.env.APP || path.resolve(__dirname, '..', 'index.html');
const OUT = process.env.OUT || __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {buildLevel, initState, cloneState, simShot, solveLevel, replay, dragToShot, makeHeur, PULLMAX};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);

function checkAll() {
  let ok = true, prev = -1; const mechAt = {};
  for (let n = 1; n <= LEVELS.length; n++) {
    const d = LEVELS[n - 1], L = C.buildLevel(d), r = C.replay(L, d.sol);
    const num = 8 * d.k + 12 * d.nb + 15 * (d.mk ? d.mk.length : 0) + 7 * d.par;
    const bad = [];
    if (!r.holed || r.strokes !== d.best) bad.push('replay ' + r.holed + '/' + r.strokes);
    if (d.par !== d.best + 1 || d.par < 2 || d.par > 6) bad.push('par ' + d.par);
    if (num !== d.num || num <= prev) bad.push('metric ' + num + ' prev ' + prev);
    if (d.k < 3 || d.k > 8) bad.push('cells ' + d.k);
    (d.mk || []).forEach(m => { if (!mechAt[m]) mechAt[m] = n; });
    if (bad.length) { ok = false; console.log('HOLE', n, 'PROBLEM', bad.join(', ')); }
    prev = num;
  }
  const D = n => (LEVELS[n - 1].num / LEVELS[LEVELS.length - 1].num * 100).toFixed(1);
  console.log('Holes:', LEVELS.length, '| all solver solutions replay into the cup, par = best+1 in 2..6, metric strictly increasing:', ok);
  const pars = {}; LEVELS.forEach(d => pars[d.par] = (pars[d.par] || 0) + 1);
  console.log('Par distribution:', JSON.stringify(pars), '| metric D raw', (LEVELS[0].num / 3).toFixed(1), '->', (LEVELS[LEVELS.length - 1].num / 3).toFixed(1), '| shown 1-100:', D(1), '->', D(LEVELS.length));
  console.log('First appearance of each mechanic:', JSON.stringify(mechAt));
  for (const n of [1, 25, 50, 75, 99, 100].filter(n => n <= LEVELS.length)) { const d = LEVELS[n - 1]; console.log('  hole', n, 'cells', d.k, 'obstacles', d.nb, 'mechanics', (d.mk || []).join('+') || '-', 'best', d.best, 'par', d.par, 'D', D(n)); }
  return ok;
}

let Heur = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = Math.round(b.x + b.width / 2), y = Math.round(b.y + b.height / 2);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
// choose an integer-pixel screen drag for a planned shot: among drags within +-3 px of the ideal one, take the one
// whose WORST outcome over the page's timing jitter (+-3 ticks on holes with moving parts) is best
function dragFor(L, S, shot, W, H, dyn, rot) {
  const [ang, pow] = shot, len = pow * C.PULLMAX;
  const wx = Math.cos(ang) * len, wy = Math.sin(ang) * len;
  const ex = rot ? -wy : wx, ey = rot ? wx : wy; // screen pull (page rotates wide courses 90 degrees)
  const sx = Math.round(W / 2 + ex / 2), sy = Math.round(H * 0.5 + ey / 2);
  const tx0 = Math.round(sx - ex), ty0 = Math.round(sy - ey);
  const dts = dyn ? [-3, -2, -1, 0, 1, 2, 3] : [0];
  let best = null;
  for (let ox = -3; ox <= 3; ox++) for (let oy = -3; oy <= 3; oy++) {
    const tx = tx0 + ox, ty = ty0 + oy;
    if (tx < 70 && ty > H - 200) continue; // keep clear of the cancel circle
    const sh = rot ? C.dragToShot(sy - ty, -(sx - tx)) : C.dragToShot(sx - tx, sy - ty);
    if (sh.cancel) continue;
    let worst = -1, holes = 0;
    for (const dt of dts) {
      const s2 = C.cloneState(S); s2.t = shot[2] + dt; const r = C.simShot(L, s2, sh.ang, sh.pow, null);
      const v = r === 2 ? -1 : r === 3 ? 1e9 : Heur(s2);
      if (r === 2) holes++;
      if (v > worst) worst = v;
    }
    const score = worst - holes * 0.01;
    if (!best || score < best.score) best = { sx, sy, tx, ty, sh, score };
  }
  return best && best.score < 1e8 ? best : null;
}
async function playLevel(browser, n) {
  const vdir = path.join(OUT, '_vid' + n); fs.mkdirSync(vdir, { recursive: true });
  const W = 390, H = 844;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: W, height: H } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tap(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tap(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(700);
  if (await page.isVisible('#iOk')) { await sleep(1200); await tap(cdp, page, '#iOk'); await sleep(400); }
  const d = LEVELS[n - 1], L = C.buildLevel(d);
  const t0 = Date.now(); let shots = 0, planMs = 0;
  for (let guard = 0; guard < 14; guard++) {
    let st = await page.evaluate(() => window.__game.state());
    if (st.status !== 'play') break;
    if (st.mv) { await sleep(100); guard--; continue; }
    const S0 = C.initState(L); Object.assign(S0, { x: st.x, y: st.y, t: st.t, sw: st.sw, sx: st.sx, sy: st.sy });
    const left = d.par + 4 - st.strokes;
    const tp = Date.now();
    let plan = null;
    for (const depth of [1, 2, 3, 4]) {
      if (depth > left) break;
      plan = C.solveLevel(L, { S0, maxDepth: depth, robust: L.dyn, minWait: L.dyn ? 150 : 0, beam: L.dyn ? 8 : 10, angStep: L.dyn ? 4 : 3, phases: 6, refine: 16, pows: L.dyn ? [0.15, 0.24, 0.34, 0.45, 0.57, 0.7, 0.85, 1] : undefined });
      if (plan) break;
    }
    planMs += Date.now() - tp;
    if (!plan) { console.log('  no plan from', st.x.toFixed(1), st.y.toFixed(1)); break; }
    const shot = plan.shots[0].slice(); shot.want = plan.strokes === 1 ? 2 : 1;
    Heur = C.makeHeur(L);
    { const s2 = C.cloneState(S0); s2.t = shot[2]; C.simShot(L, s2, shot[0], shot[1], null); shot.h = Heur(s2); }
    // re-anchor the planned tick to the page clock (outcome depends only on phase = t mod P)
    const rot = (await page.evaluate(() => window.__game.view())).rot;
    let drag = dragFor(L, S0, shot, W, H, L.dyn, rot);
    if (!drag) { console.log('  could not map shot to a drag'); break; }
    // human-paced drag
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: drag.sx, y: drag.sy }] });
    const steps = 10;
    for (let i = 1; i <= steps; i++) { await sleep(22); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(drag.sx + (drag.tx - drag.sx) * i / steps), y: Math.round(drag.sy + (drag.ty - drag.sy) * i / steps) }] }); }
    await sleep(160);
    if (L.dyn) {
      const P = L.P; let now = (await page.evaluate(() => window.__game.state())).t;
      let target = shot[2] - (shot[2] % P) + (shot[2] % P); while (target < now + 2) target += P;
      // wait until just before the target tick (page clock runs at 120 Hz)
      for (;;) { now = (await page.evaluate(() => window.__game.state())).t; if (now >= target - 1) break; const wait = (target - 1 - now) * 1000 / 120; await sleep(Math.max(1, Math.min(40, wait - 6))); }
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    shots++;
    await sleep(200);
    for (let k = 0; k < 600; k++) { st = await page.evaluate(() => window.__game.state()); if (!st.mv || st.status !== 'play') break; await sleep(50); }
    await sleep(250 + Math.floor(Math.random() * 150));
  }
  await sleep(1600);
  const st = await page.evaluate(() => window.__game.state());
  const winVisible = await page.isVisible('#win');
  await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = path.join(OUT, 'level-' + n + '.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4]);
  if (fs.statSync(mp4).size > 7.5e6) { const sp = path.join(OUT, 'level-' + n + '-4x.mp4'); execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-filter:v', 'setpts=PTS/4', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', sp]); fs.unlinkSync(mp4); mp4 = sp; }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, cleared: (st.status === 'won') && winVisible, strokes: st.strokes, par: d.par, shots, secs, planS: (planMs / 1000).toFixed(1), errors, mp4: path.basename(mp4), mp4KB: Math.round(fs.statSync(mp4).size / 1024) };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = checkAll();
  if (args.includes('--solve-only')) process.exit(ok ? 0 : 1);
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    const r = await playLevel(browser, n);
    console.log('BOT hole', n, r.cleared ? 'CLEARED' : 'NOT CLEARED', 'strokes', r.strokes, '/ par', r.par, '| real-time', r.secs + 's (of which planning', r.planS + 's) |', r.mp4, r.mp4KB + 'KB |', r.errors.length ? 'ERRORS ' + r.errors.join(' | ') : 'no console errors');
  }
  await browser.close();
})();
