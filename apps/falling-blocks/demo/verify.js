// Verification for 星塊落陣 (falling-blocks).
// 1) Node: runs the game's own core (extracted via CORE markers) with a Dellacherie bot. The bot plans each piece
//    as a human-paced gesture timeline (150 ms reaction, actions >= 150 ms apart, taps 60 ms, drags 28 px per cell,
//    flick for hard drop) and simulates that timeline under real gravity / lock delay, so it only picks placements it
//    can actually reach in time. Reports survival at L15 for 3 minutes and a long run from L1 showing the ramp.
// 2) Browser: drives the real page in Chromium with real CDP touch input (start level chip, taps to rotate,
//    horizontal drags to move, downward flicks to hard drop) and records demo/run.mp4 + run-result.png.
// Usage: node verify.js [--sim-only] [--runs N] [--secs S]
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(coreSrc + '\nreturn {makeGame, SHAPES, gravityMs, lockDelayMs, garbageChance, COLS, ROWS, HID, CLEAR_MS};')();
const { makeGame, COLS, ROWS, CLEAR_MS } = core;

// ---------------- Dellacherie evaluation ----------------
const WT = { lh: -4.500158825082766, er: 3.4181268101392694, rt: -3.2178882868487753, ct: -9.348695305445199, ho: -7.899265427351652, we: -3.3855972247263626 };
function features(b) {
  let rt = 0, ct = 0, ho = 0, we = 0;
  for (let y = 0; y < ROWS; y++) {
    let prev = 1;
    for (let x = 0; x < COLS; x++) { const f = b[y * COLS + x] ? 1 : 0; if (f !== prev) rt++; prev = f; }
    if (!prev) rt++;
  }
  for (let x = 0; x < COLS; x++) {
    let prev = 0, seen = false;
    for (let y = 0; y < ROWS; y++) { const f = b[y * COLS + x] ? 1 : 0; if (f !== prev) ct++; prev = f; if (f) seen = true; else if (seen) ho++; }
    if (!prev) ct++;
    let depth = 0;
    for (let y = 0; y < ROWS; y++) {
      const f = b[y * COLS + x];
      const l = x === 0 || b[y * COLS + x - 1], r = x === COLS - 1 || b[y * COLS + x + 1];
      if (!f && l && r) { depth++; we += depth; } else if (f) depth = 0; else depth = 0;
    }
  }
  return { rt, ct, ho, we };
}
function maxHeight(b) { for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (b[y * COLS + x]) return ROWS - y; return 0; }

// ---------------- gesture timeline (shared by sim + browser) ----------------
const REACT = 150, GAP = 150, TAP = 60, CELLMS = 32, FLICK = 56;
function timeline(rot, dx) {
  const acts = []; let a = REACT;
  const rots = rot === 2 ? [1, 1] : rot ? [rot] : [];
  for (const r of rots) { acts.push({ kind: 'tap', dir: r, start: a, at: a + TAP }); a += GAP; }
  if (dx) {
    const n = Math.abs(dx), s = Math.sign(dx);
    for (let m = 0; m < n; m++) acts.push({ kind: 'move', dir: s, start: a, at: a + CELLMS * (m + 1) });
    a = Math.max(a + GAP, a + CELLMS * n + 16 + 20);
  }
  acts.push({ kind: 'hard', start: a, at: a + FLICK });
  return acts;
}
function simulatePlan(opts, save, rot, dx) {
  const g = makeGame(opts); g.load(save); g.ev.length = 0;
  const acts = timeline(rot, dx), pid = g.pieceId, FR = 1000 / 60;
  let t = 0, i = 0, pre = null;
  for (let f = 0; f < 400; f++) {
    t += FR;
    while (i < acts.length && acts[i].at <= t) {
      const a = acts[i++];
      if (g.pieceId !== pid || !g.cur) continue;
      if (a.kind === 'tap') g.rotate(a.dir); else if (a.kind === 'move') g.move(a.dir); else { pre = { r: g.cur.r, x: g.cur.x }; g.hardDrop(); }
    }
    if (g.over || g.clearing || !g.cur || g.pieceId !== pid) break;
    g.update(FR);
    if (g.over || g.clearing || !g.cur || g.pieceId !== pid) break;
  }
  const lk = g.ev.find(e => e.type === 'lock');
  if (!lk || g.over) return { score: -1e9, g, lk, pre };
  if (g.clearing) g.update(CLEAR_MS + 1);
  if (g.over) return { score: -1e9, g, lk, pre };
  const ys = lk.cells.map(c => c[1]), lh = ROWS - (Math.min(...ys) + Math.max(...ys)) / 2;
  const er = lk.n * lk.cells.filter(c => lk.rows.includes(c[1])).length;
  const F = features(g.board);
  let score = WT.lh * lh + WT.er * er + WT.rt * F.rt + WT.ct * F.ct + WT.ho * F.ho + WT.we * F.we;
  const mh = maxHeight(g.board); if (mh > 12) score -= (mh - 12) * 25;
  // tie-break: fewer actions
  score -= (Math.abs(dx) + (rot === 2 ? 2 : rot ? 1 : 0)) * 0.01;
  return { score, g, lk, pre, key: lk.cells.map(c => c.join(',')).sort().join(';') };
}
function plan(opts, save) {
  const t = save.cur.t, seen = new Map();
  let best = null;
  for (const rot of t === 1 ? [0] : [0, 1, -1, 2]) for (let dx = -6; dx <= 6; dx++) {
    const r = simulatePlan(opts, save, rot, dx);
    if (r.key && seen.has(r.key)) continue; if (r.key) seen.set(r.key, 1);
    if (!best || r.score > best.score) best = { rot, dx, score: r.score, pre: r.pre };
  }
  return best;
}

// ---------------- Node sim ----------------
function simRun(seed, startLevel, secs) {
  const opts = { mode: 'marathon', level: startLevel, seed };
  const g = makeGame(opts); g.start();
  const FR = 1000 / 60, ramp = [];
  let nextMark = 0;
  while (!g.over && g.time < secs * 1000) {
    if (g.cur && !g.clearing) {
      const save = g.save(), p = plan(opts, save);
      // play the chosen timeline on the real game object
      const acts = timeline(p.rot, p.dx), pid = g.pieceId; let t = 0, i = 0;
      for (let f = 0; f < 400 && !g.over && g.pieceId === pid && g.cur; f++) {
        t += FR;
        while (i < acts.length && acts[i].at <= t) { const a = acts[i++]; if (!g.cur || g.pieceId !== pid) continue; if (a.kind === 'tap') g.rotate(a.dir); else if (a.kind === 'move') g.move(a.dir); else g.hardDrop(); }
        if (g.over || g.clearing || !g.cur || g.pieceId !== pid) break;
        g.update(FR);
      }
    } else g.update(FR);
    g.ev.length = 0;
    if (g.time >= nextMark) { ramp.push({ t: Math.round(g.time / 1000), L: g.level, lines: g.lines, h: maxHeight(g.board), gar: g.st.garbage }); nextMark += 30000; }
  }
  return { seed, survived: g.time / 1000, over: g.over, reason: g.reason, level: g.level, lines: g.lines, score: g.score, pieces: g.pieces, garbage: g.st.garbage, tetris: g.st.tetris, ramp };
}

// ---------------- browser run ----------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function browserRun(secs) {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const vdir = path.join(OUT, '_vid'); fs.rmSync(vdir, { recursive: true, force: true }); fs.mkdirSync(vdir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: 'dark', recordVideo: { dir: vdir, size: { width: 390, height: 844 } } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + APP); await sleep(1200);
  const cdp = await ctx.newCDPSession(page);
  // touch events are fired without awaiting each one (each round trip costs ~60 ms under recording); CDP keeps them in order
  let pending = Promise.resolve();
  const touch = (type, pts) => { pending = cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) }); return Promise.resolve(); };
  const tapAt = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(TAP); await touch('touchEnd', []); };
  const tapEl = async sel => { const b = await page.locator(sel).boundingBox(); await tapAt(b.x + b.width / 2, b.y + b.height / 2); };
  await tapEl('#lvrow .chip:nth-of-type(4)'); await sleep(400); // start level 15
  await tapEl('#tPlay'); await sleep(900);
  const opts = { mode: 'marathon', level: 15 };
  let lastId = -1, acted = 0, corrections = 0, samples = [], lastSample = -30;
  const t0 = Date.now();
  let sn;
  while (true) {
    await pending; sn = await page.evaluate(() => window.__fb.snap(true));
    if (!sn || sn.state !== 'play' || sn.over) break;
    if (sn.time / 1000 - lastSample >= 30) { lastSample = sn.time / 1000; samples.push(`t=${Math.round(sn.time / 1000)}s L${sn.level} lines ${sn.lines} garbage ${sn.garbage} fps ${sn.fps}`); }
    if (sn.time >= secs * 1000) { await sleep(50); continue; } // stop playing: let the stack top out to show the ending
    if (!sn.cur || sn.clearing || sn.pieceId === lastId) { await sleep(12); continue; }
    lastId = sn.pieceId; const tn = Date.now();
    const fullSn = await page.evaluate(() => window.__fb.snap()); if (!fullSn.cur || fullSn.pieceId !== lastId) continue;
    sn = fullSn; const p = plan(opts, sn.full);
    const { wx, wy, ww, wh, cell } = sn.layout, cy = wy + wh * 0.32;
    const acts = timeline(p.rot, p.dx);
    const until = async ms => { const w = tn + ms - Date.now(); if (w > 0) await sleep(w); };
    let i = 0;
    while (i < acts.length) {
      const a = acts[i];
      await until(a.start);
      if (a.kind === 'tap') { await tapAt(a.dir > 0 ? wx + ww * 0.78 : wx + ww * 0.22, cy); i++; continue; }
      if (a.kind === 'move') {
        const n = acts.filter(q => q.kind === 'move').length, s = a.dir, x0 = wx + ww / 2 - s * n * 14;
        await touch('touchStart', [[x0, cy + 40]]);
        for (let k = 1; k <= n * 2; k++) { await sleep(16); await touch('touchMove', [[x0 + s * 14 * k, cy + 40]]); }
        await sleep(16); await touch('touchEnd', []);
        i += n; continue;
      }
      // before the flick: check the piece is where the plan expects, fix once if not
      await pending; const chk = await page.evaluate(() => window.__fb.snap(true));
      if (chk.pieceId !== lastId || !chk.cur) break;
      if (p.pre && (chk.cur.r !== p.pre.r || chk.cur.x !== p.pre.x)) {
        corrections++;
        if (chk.cur.r !== p.pre.r) { const d = ((p.pre.r - chk.cur.r) + 4) % 4; await tapAt(d === 3 ? wx + ww * 0.22 : wx + ww * 0.78, cy); await sleep(GAP); }
        await pending; const c2 = await page.evaluate(() => window.__fb.snap(true));
        if (c2.pieceId === lastId && c2.cur && c2.cur.x !== p.pre.x) {
          const n = Math.abs(p.pre.x - c2.cur.x), s = Math.sign(p.pre.x - c2.cur.x), x0 = wx + ww / 2 - s * n * 14;
          await touch('touchStart', [[x0, cy + 40]]);
          for (let k = 1; k <= n * 2; k++) { await sleep(16); await touch('touchMove', [[x0 + s * 14 * k, cy + 40]]); }
          await sleep(16); await touch('touchEnd', []); await sleep(GAP);
        }
      }
      const fx = wx + ww / 2, fy = wy + wh * 0.3;
      await touch('touchStart', [[fx, fy]]);
      for (let k = 1; k <= 3; k++) { await sleep(16); await touch('touchMove', [[fx, fy + 40 * k]]); }
      await sleep(8); await touch('touchEnd', []);
      acted++; i++;
    }
  }
  // wait for the result card
  for (let k = 0; k < 80; k++) { const s = await page.evaluate(() => window.__fb.snap().state); if (s === 'result') break; await sleep(250); }
  await sleep(1200);
  const last = await page.evaluate(() => window.__lastRun);
  await page.screenshot({ path: path.join(OUT, 'run-result.png') });
  const wall = ((Date.now() - t0) / 1000).toFixed(1);
  await ctx.close(); await browser.close();
  const webm = fs.readdirSync(vdir).find(f => f.endsWith('.webm'));
  const raw = path.join(vdir, webm), mp4 = path.join(OUT, 'run.mp4');
  execFileSync('/usr/bin/ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-vf', 'setpts=PTS/2,fps=30', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '31', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  fs.rmSync(vdir, { recursive: true, force: true });
  console.log(`Browser bot (real CDP touch, 150 ms reaction, taps/drags/flicks): played ${acted} pieces, ${corrections} corrections, wall ${wall}s`);
  console.log(`  bot stopped playing at game time ${secs}s; final: level ${last && last.level}, lines ${last && last.lines}, score ${last && last.score}, game time ${last && (last.time / 1000).toFixed(1)}s, garbage rows ${last && last.st.garbage}, end ${last && last.reason}`);
  console.log('  samples: ' + samples.join(' | '));
  console.log(`  video run.mp4 (2x speed) ${Math.round(fs.statSync(mp4).size / 1024)} KB, errors: ${errors.length ? errors.join(' | ') : 'none'}`);
}

(async () => {
  const args = process.argv.slice(2), ri = args.indexOf('--runs'), si = args.indexOf('--secs');
  const runs = ri >= 0 ? +args[ri + 1] : 6, secs = si >= 0 ? +args[si + 1] : 180;
  console.log('Gravity ms/row by level: ' + [1, 5, 10, 15, 20, 25, 30].map(L => `L${L} ${core.gravityMs(L).toFixed(0)}`).join(', ') + '; lock delay L20 ' + core.lockDelayMs(20) + ' / L30 ' + core.lockDelayMs(30) + ' ms; garbage chance L15 ' + core.garbageChance(15) + ' / L25 ' + core.garbageChance(25));
  const t0 = Date.now();
  const res = []; for (let r = 0; r < runs; r++) res.push(simRun(1000 + r * 7919, 15, secs));
  console.log(`Node sim: ${runs} bot runs starting at L15, ${secs}s each, human-paced gesture timelines (${((Date.now() - t0) / 1000).toFixed(1)}s compute)`);
  for (const r of res) console.log(`  seed ${r.seed}: survived ${r.survived.toFixed(1)}s${r.over ? ' (topped out: ' + r.reason + ')' : ''}, L${r.level}, ${r.lines} lines, ${r.pieces} pieces, ${r.garbage} garbage rows, ${r.tetris} 4-line clears, peak-check ramp ${r.ramp.map(q => `${q.t}s:L${q.L}/h${q.h}`).join(' ')}`);
  console.log(`  survived full ${secs}s: ${res.filter(r => !r.over).length}/${runs}`);
  const lr = simRun(4242, 1, 900);
  console.log(`Node sim from L1 (900s cap): survived ${lr.survived.toFixed(0)}s${lr.over ? ' (' + lr.reason + ')' : ''}, reached L${lr.level}, ${lr.lines} lines, score ${lr.score}, garbage rows ${lr.garbage}`);
  console.log('  ramp: ' + lr.ramp.filter((q, i) => i % 2 === 0).map(q => `${q.t}s L${q.L} (${core.gravityMs(q.L).toFixed(0)}ms/row) h${q.h}`).join(' | '));
  if (args.includes('--sim-only')) return;
  await browserRun(secs);
})();
