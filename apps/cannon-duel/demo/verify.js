// Verification for 山頭砲戰 (cannon-duel).
// 1) Node, using the game's own core (CORE-START/END): difficulty D strictly increases over 100 levels, and every level
//    has a standard-shell direct hit (integer angle 0-150, power 1-100) at wind = -cap, 0, +cap (the extremes the game can roll).
// 2) Auto-player clears levels 50, 75, 99, 100 in the real page with real touch input (CDP Input.dispatchTouchEvent):
//    drag-to-aim, then +/- fine-tune taps, weapon taps and the fire button, at human pace (>=150 ms between actions).
//    It reads the wind/terrain like a player reads the screen, picks a shot with the game's physics and corrects
//    after each shot. Records level-NN.mp4 + level-NN-result.png.
// Usage: node verify.js [--check-only] [levels...]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {params, genWorld, simulate, WINDCAP, TOWER_CY, mechsFor};')();

const ANG = []; for (let a = 60; a <= 150; a++) ANG.push(a); for (let a = 59; a >= 0; a--) ANG.push(a);
function firstHit(W, w) {
  const T0 = W.clouds.length ? [2, 4.5, 7] : [2];
  for (const t0 of T0) for (const a of ANG) for (let p = 100; p >= 1; p--) { const r = C.simulate(W, 0, a, p, 'std', w, null, t0); if (r.ev === 'tower' && r.hit === 1) return { a, p, t0 }; }
  return null;
}
function checkAll() {
  let prevD = -1, mono = true, allOk = true; const rows = [];
  for (let n = 1; n <= 100; n++) {
    const P = C.params(n), W = C.genWorld(n), cap = C.WINDCAP[n - 1];
    if (P.D <= prevD) mono = false; prevD = P.D;
    const res = [-cap[0], 0, cap[1]].map(w => firstHit(W, w));
    const ok = res.every(Boolean); if (!ok) { allOk = false; console.log('LEVEL', n, 'NO HIT at some wind', res); }
    rows.push({ n, D: P.D, mech: P.mech.join('+') || '-', hill: Math.round(P.hill), wind: Math.round(P.wind), sth: P.sth.toFixed(2), aiHp: P.aiHp, cap: cap.join('/'), sol: res[1] && res[1].a + '°/' + res[1].p + '%' });
  }
  console.log('Difficulty D strictly increasing over 100 levels:', mono, '(D', rows[0].D, '->', rows[99].D + ')');
  console.log('Every level has a standard-shell direct hit at wind -cap, 0, +cap:', allOk);
  for (const n of [1, 12, 24, 36, 50, 65, 75, 80, 90, 99, 100]) { const r = rows[n - 1]; console.log(`  L${n} D=${r.D} hill=${r.hill} wind=±${r.wind} (cap ${r.cap}) σθ=${r.sth} aiHP=${r.aiHp} mech=${r.mech} calm-wind hit ${r.sol}`); }
  return mono && allOk;
}

/* ---------------- bot brain (runs in Node on a snapshot of the page's world) ---------------- */
function snapshotWorld(snap) {
  const W = C.genWorld(snap.n);
  W.top = Float32Array.from(snap.top);
  W.towers = snap.towers;
  if (W.rocks) W.rocks.cells.forEach((c, i) => { c.a = snap.rocks[i]; });
  return W;
}
function planShot(W, wind, now, ammo, bias, timeLeft) {
  // every integer (angle, power) that is a direct hit under the current wind (clouds ignored here);
  // prefer short flights (less exposure to gusts) and shots whose ±1 % neighbours also hit
  const clouds = W.clouds; W.clouds = [];
  let hits = [];
  for (const kind of ['std', 'bounce', 'drill']) {
    if (kind !== 'std' && !(ammo[kind] > 0)) continue;
    for (let a = 5; a <= 150; a++) for (let p = 15; p <= 100; p++) {
      const r = C.simulate(W, 0, a, p, kind, wind, null, 0);
      if (r.ev === 'tower' && r.hit === 1) hits.push({ a, p, t: r.t, kind });
    }
    if (hits.length) break;
  }
  W.clouds = clouds;
  if (!hits.length) return null;
  const set = new Set(hits.map(h => h.kind + h.a + '/' + h.p));
  const robust = hits.filter(h => set.has(h.kind + h.a + '/' + (h.p + 1)) && set.has(h.kind + h.a + '/' + (h.p - 1)));
  let cand = (robust.length ? robust : hits).sort((x, y) => x.t - y.t).slice(0, 80);
  // moving clouds: like a player watching them, pick the shot whose path is clear soonest (launch >= now+3.6 s, time to aim)
  let pick = null;
  if (clouds.length) {
    let bestT = 1e9;
    for (const h of cand) for (let dt = 3.6; dt < Math.min(9.5, timeLeft - 0.6); dt += 0.25) {
      if (dt >= bestT) break;
      const r = C.simulate(W, 0, h.a, h.p, h.kind, wind, null, now + dt);
      if (r.ev === 'tower' && r.hit === 1) { bestT = dt; pick = Object.assign({ fireAt: now + dt }, h); break; }
    }
  }
  if (!pick) pick = Object.assign({ fireAt: 0 }, cand[0]);
  pick.p = Math.max(1, Math.min(100, pick.p + bias));
  if (pick.kind === 'std') { if (ammo.triple > 0 && !clouds.length) pick.kind = 'triple'; else if (ammo.heavy > 0) pick.kind = 'heavy'; }
  return pick;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function touchTap(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(70);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapSel(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  await touchTap(cdp, b.x + b.width / 2, b.y + b.height / 2);
}
async function dragAim(cdp, page, a, p) {
  const safe = await page.evaluate(() => window.__game.safe());
  const vw = await page.evaluate(() => innerWidth);
  const rad = a * Math.PI / 180, len = p / 100 * 200, dx = Math.cos(rad), dy = -Math.sin(rad);
  const x0 = vw / 2 + dx * 95, y0 = safe.y + safe.h * 0.28;
  const x1 = x0 - dx * len, y1 = y0 - dy * len, steps = 14;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= steps; i++) {
    await sleep(28);
    const u = i / steps, e = 1 - (1 - u) * (1 - u) * (1 - u);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * e, y: y0 + (y1 - y0) * e }] });
  }
  await sleep(180);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const state = page => page.evaluate(() => window.__game.state());

async function playAttempt(browser, n, attempt) {
  const vdir = path.join(OUT, '_vid' + n + '_' + attempt); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP);
  const cdp = await ctx.newCDPSession(page);
  await sleep(800);
  await tapSel(cdp, page, '#tSelect'); await sleep(500);
  if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tapSel(cdp, page, '#unlockSw'); await sleep(400); }
  await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded(); await sleep(400);
  await tapSel(cdp, page, '.lt[data-n="' + n + '"]'); await sleep(800);
  if (await page.isVisible('#iOk')) { await sleep(1500); await tapSel(cdp, page, '#iOk'); await sleep(300); }
  const t0 = Date.now(); let shots = 0, bias = 0, taps = 0, drags = 0; const log = [];
  for (let guard = 0; guard < 400; guard++) {
    const st = await state(page);
    if (st.won || st.lost) break;
    if (st.phase !== 'aim' || st.paused) { await sleep(120); continue; }
    await sleep(350 + Math.random() * 200); // reaction time
    const snap = await page.evaluate(() => { const W = window.__game.world(); return { n: W.n, top: Array.from(W.top), towers: W.towers.map(t => Object.assign({}, t)), rocks: W.rocks ? W.rocks.cells.map(c => c.a) : [] }; });
    const s2 = await state(page);
    const W = snapshotWorld(snap);
    const plan = planShot(W, s2.wind, s2.gt, s2.ammo, bias, s2.timeLeft) || { a: 70, p: 85, kind: 'std', t: 0, fireAt: 0 };
    // weapon
    if (plan.kind !== s2.weapon) { await tapSel(cdp, page, '.wb[data-k="' + plan.kind + '"]'); taps++; await sleep(220); }
    // drag to aim, then fine-tune with the +/- buttons
    await dragAim(cdp, page, plan.a, plan.p); drags++;
    await sleep(250);
    for (let k = 0; k < 30; k++) {
      const cur = (await state(page)).aim;
      if (cur.a === plan.a && cur.p === plan.p) break;
      const sel = cur.a < plan.a ? '#aUp' : cur.a > plan.a ? '#aDn' : cur.p < plan.p ? '#pUp' : '#pDn';
      await tapSel(cdp, page, sel); taps++; await sleep(170);
    }
    await sleep(200);
    // like a player watching the clouds: wait until the planned shot's path is clear, then fire
    let pre = await state(page);
    const simKind = plan.kind === 'heavy' || plan.kind === 'triple' ? 'std' : plan.kind;
    while (plan.fireAt && pre.phase === 'aim' && pre.gt < plan.fireAt - 0.35 && pre.timeLeft > 1.3) { await sleep(100); pre = await state(page); }
    for (let k = 0; k < 60 && pre.phase === 'aim' && pre.timeLeft > 1.3; k++) {
      const r = C.simulate(W, 0, pre.aim.a, pre.aim.p, simKind, pre.wind, null, pre.gt + 0.12);
      if (r.ev === 'tower' && r.hit === 1) break;
      await sleep(150); pre = await state(page);
    }
    if (pre.phase !== 'aim') continue;
    await tapSel(cdp, page, '#bFire'); shots++;
    const hpBefore = pre.hp[1];
    // wait for the shot + AI turn
    for (let k = 0; k < 400; k++) { await sleep(100); const s = await state(page); if (s.won || s.lost || (s.phase === 'aim' && s.turns > pre.turns)) break; }
    const post = await state(page);
    const dmg = hpBefore - post.hp[1];
    const ls = post.lastShot || {}, chk = C.simulate(W, 0, ls.a, ls.p, ls.kind === 'heavy' || ls.kind === 'triple' ? 'std' : ls.kind, ls.wind, null, ls.t0);
    log.push(`T${pre.turns} wind ${pre.wind} ${plan.kind} ${plan.a}°/${plan.p}% -> AI -${dmg}, me ${post.hp[0]}  page:${(ls.evs || []).join(' ')} model@fire:${chk.ev}@${Math.round(chk.x)},${Math.round(chk.y)} t0 plan ${(plan.fireAt || 0).toFixed(1)} real ${(ls.t0 || 0).toFixed(1)}`);
    // trial correction: when a planned direct hit did nothing under steady wind, nudge power the next time
    if (dmg <= 0 && !pre.gust) bias = bias === 0 ? 1 : (bias > 0 ? -bias : -bias + 1); else if (dmg > 0) bias = 0;
  }
  await sleep(2600);
  const st = await state(page);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (st.won) await page.screenshot({ path: path.join(OUT, 'level-' + n + '-result.png') });
  await ctx.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  let mp4 = null, mp4KB = 0;
  if (st.won) {
    const rawLen = parseFloat(execFileSync('/usr/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(vdir, webm)]).toString()) || 0;
    const speed = rawLen > 100 ? 2 : 1;
    for (const f of fs.readdirSync(OUT)) if (f.startsWith('level-' + n + '.') || f.startsWith('level-' + n + '-2x.')) fs.rmSync(path.join(OUT, f));
    mp4 = path.join(OUT, 'level-' + n + (speed > 1 ? '-' + speed + 'x' : '') + '.mp4');
    const vf = (speed > 1 ? 'setpts=PTS/' + speed + ',' : '') + 'fps=30';
    execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(vdir, webm), '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow', '-movflags', '+faststart', mp4]);
    mp4KB = Math.round(fs.statSync(mp4).size / 1024);
  }
  fs.rmSync(vdir, { recursive: true, force: true });
  return { n, attempt, won: st.won, hp: st.hp, turns: st.turns, shots, drags, taps, secs, errors, mp4: mp4 && path.basename(mp4), mp4KB, log };
}

(async () => {
  const args = process.argv.slice(2);
  const ok = args.includes('--skip-check') ? true : checkAll();
  if (args.includes('--check-only')) return;
  const lv = args.filter(a => /^\d+$/.test(a)).map(Number);
  const targets = lv.length ? lv : [50, 75, 99, 100];
  const browser = await chromium.launch();
  for (const n of targets) {
    let r;
    for (let attempt = 1; attempt <= 5; attempt++) {
      r = await playAttempt(browser, n, attempt);
      console.log(`BOT level ${n} attempt ${attempt}: ${r.won ? 'CLEARED' : 'lost'}  HP ${r.hp.join(' vs ')}  turns ${r.turns}  shots ${r.shots} drags ${r.drags} taps ${r.taps}  ${r.secs}s` + (r.mp4 ? `  video ${r.mp4} ${r.mp4KB}KB` : '') + (r.errors.length ? '  ERRORS ' + r.errors.join(' | ') : '  no errors'));
      r.log.forEach(l => console.log('    ' + l));
      if (r.won) break;
    }
  }
  await browser.close();
})();
