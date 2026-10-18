// 自訂拼圖 (photo-jigsaw) skill-tier bot.
// Usage: node bot.js [tiers...] [--sizes=12,30,63,99] [--rot=0,1] [--app=path/to/index.html] [--out=results-raw.json] [--probes-only] [--no-probes]
// Reads state through window.__game (state/target/pieceScreen/trayInfo/view/hitAt), acts only through CDP touch events.
// A jigsaw has no fail state, so a tier is defined by how fast and how cleanly it finishes: modelled human time
// (reaction + search/thinking time, added virtually, plus the real duration of every touch gesture), drags needed per
// piece, and every input problem seen on the way (dropped pulls, grabs that miss, pieces lost off screen or under buttons).
const fs = require('fs'), path = require('path');
const H = require('./harness');
const args = process.argv.slice(2);
const argv = k => { const a = args.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const APP = path.resolve(argv('app') || path.resolve(__dirname, '../../../apps/photo-jigsaw/index.html'));
const OUT = path.join(__dirname, argv('out') || 'raw-results.json');
const TIER_LIST = args.filter(a => H.TIERS[a]).length ? args.filter(a => H.TIERS[a]) : H.TIER_IDS;
const SIZES = (argv('sizes') || '12,30,63,99').split(',').map(Number);
const ROTS = (argv('rot') || '0,1').split(',').map(Number);
const PICS = { 12: 'bay', 30: 'balloons', 63: 'city', 99: 'garden' };
const RUN_WALL_CAP = 7 * 60 * 1000;   // real time per run
const sleep = H.sleep;

const ev = (page, fn, a) => page.evaluate(fn, a);
const G = {
  state: p => ev(p, () => window.__game.state()),
  view: p => ev(p, () => window.__game.view()),
  tray: p => ev(p, () => window.__game.trayInfo()),
  target: (p, id) => ev(p, id => window.__game.target(id), id),
  ps: (p, id) => ev(p, id => window.__game.pieceScreen(id), id),
  hit: (p, x, y) => ev(p, a => window.__game.hitAt(a[0], a[1]), [x, y]),
  // loose groups on the table: one representative piece per group
  loose: p => ev(p, () => { const s = window.__game.state(); const seen = {}, out = []; for (let id = 0; id < s.count; id++) { const q = window.__game.pieceScreen(id); if (!q || q.locked) continue; const h = window.__game.hitAt(q.x, q.y); const key = h ? h.id + ':' + h.n : 'x' + id; if (seen[key] && h && h.n > 1) continue; seen[key] = 1; out.push(Object.assign({ id }, q)); } return out; }),
  buttons: p => ev(p, () => ['bZoomIn', 'bZoomOut', 'bScatter'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, x: r.left, y: r.top, w: r.width, h: r.height }; })),
};

async function touch(P, type, pts) { await P.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts }); }
function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }

class Run {
  constructor(P, n, rot) { this.P = P; this.n = n; this.rot = rot; this.model = 0; this.ev = { pulls: 0, pullsDropped: 0, pullsWrongPiece: 0, trayMisses: 0, corrections: 0, grabMisses: 0, wrongTargets: 0, rotTaps: 0, rotTapsLost: 0, tableRotTaps: 0, offscreen: 0, underButtons: 0, underTray: 0, trayScrolls: 0, scatterUsed: 0 }; this.notes = []; }
  think(scale = 1) { const t = this.P.reactMs() + this.P.thinkMs(scale); this.model += t; return t; }
  async act(fn) { const t0 = Date.now(); const r = await fn(); this.model += Date.now() - t0; return r; }
  wrongRate() { return this.P.t.mistake * Math.min(2.5, Math.max(0.6, Math.sqrt(this.n / 30))); }
  searchScale() { return 1 + 0.55 * Math.log2(this.n / 12) + (this.rot ? 0.35 : 0); }
  // positional error of an aimed movement: full σ for long throws, smaller for short corrective nudges (motor noise scales with amplitude)
  aimSigma(dist) { const s = this.P.t.pos; return s ? s * Math.min(1, 0.25 + dist / 220) : 0; }
  gauss(s) { return s ? this.P.rng.gauss(0, s) : 0; }
}

// One drag gesture: start at `a`, first leg towards `guess`, then (once the piece is visible under the finger) aim so that
// the piece's centre lands on `aimAt` with error σ. Returns where the finger let go.
async function dragGesture(R, a, guess, pieceId, aimAt, fromTray) {
  const P = R.P, fast = P.superhuman, stepMs = fast ? 8 : 16;
  await touch(P, 'touchStart', [{ x: a[0], y: a[1], id: 1 }]);
  // first leg: 45 px (or the whole way if shorter) along the line to the guess
  const d = Math.hypot(guess[0] - a[0], guess[1] - a[1]), k1 = Math.min(1, 46 / Math.max(1, d));
  const l1 = fast ? 3 : 4; let cur = a;
  for (let i = 1; i <= l1; i++) { await sleep(stepMs); cur = lerp(a, guess, k1 * i / l1); await touch(P, 'touchMove', [{ x: cur[0], y: cur[1], id: 1 }]); }
  await sleep(stepMs);
  let end = guess;
  const ps = await G.ps(P.page, pieceId);
  if (ps && !ps.locked) {
    // human sees where the piece sits relative to the finger and aims the piece, not the finger
    const offx = ps.x - cur[0], offy = ps.y - cur[1];
    const dist = Math.hypot(aimAt[0] - ps.x, aimAt[1] - ps.y), s = R.aimSigma(dist);
    end = [aimAt[0] - offx + R.gauss(s), aimAt[1] - offy + R.gauss(s)];
  }
  const rest = Math.hypot(end[0] - cur[0], end[1] - cur[1]), steps = Math.max(fast ? 3 : 5, Math.min(fast ? 8 : 18, Math.round(rest / (fast ? 50 : 28))));
  const from = cur;
  for (let i = 1; i <= steps; i++) {
    await sleep(stepMs);
    // slight arc like a thumb, ease-out
    const t = i / steps, e = 1 - Math.pow(1 - t, 2); const p = lerp(from, end, e);
    const bow = fast ? 0 : Math.sin(Math.PI * t) * 6;
    cur = [p[0] + bow, p[1]]; await touch(P, 'touchMove', [{ x: cur[0], y: cur[1], id: 1 }]);
  }
  if (!fast) await sleep(30 + Math.abs(R.gauss(20)));
  await touch(P, 'touchEnd', []);
  return end;
}

async function tapAt(R, x, y) { const P = R.P; await touch(P, 'touchStart', [{ x, y, id: 1 }]); await sleep(P.superhuman ? 16 : 60 + Math.abs(P.rng.gauss(0, 25))); await touch(P, 'touchEnd', []); }

async function checkPlacement(R) {
  // every loose piece must be on screen and not under a button; mark the ones a player would have to rescue first
  const v = await G.view(R.P.page), loose = await G.loose(R.P.page), btn = await G.buttons(R.P.page);
  for (const q of loose) {
    if (q.x < v.left || q.x > v.left + v.width || q.y < v.top || q.y > v.top + v.height) { q.bad = 'off'; R.ev.offscreen++; R.notes.push('piece ' + q.id + ' centre off screen at ' + q.x.toFixed(0) + ',' + q.y.toFixed(0)); }
    else if (btn.some(b => q.x > b.x - 4 && q.x < b.x + b.w + 4 && q.y > b.y - 4 && q.y < b.y + b.h + 4)) { q.bad = 'btn'; R.ev.underButtons++; R.notes.push('piece ' + q.id + ' centre under a button'); }
  }
  return loose;
}
// pan the table (drag an empty spot) so that screen point `pt` moves towards the middle of the board area
async function panToward(R, pt) {
  const P = R.P, page = P.page, v = await G.view(page);
  const mid = [v.left + v.width / 2, v.top + v.height * 0.45];
  let sp = null;
  for (let k = 0; k < 30 && !sp; k++) { const c = [v.left + 20 + P.rng() * (v.width - 40), v.top + 20 + P.rng() * (v.height - 90)]; const h = await G.hit(page, c[0], c[1]); if (!h) sp = c; }
  if (!sp) return false;
  const dx = Math.max(-v.width * 0.6, Math.min(v.width * 0.6, mid[0] - pt[0])), dy = Math.max(-v.height * 0.6, Math.min(v.height * 0.6, mid[1] - pt[1]));
  R.think(0.3); R.ev.pans = (R.ev.pans || 0) + 1;
  await R.act(() => P.swipe(sp[0], sp[1], dx, dy, { exact: true, steps: 10 }));
  await sleep(80); return true;
}

async function pullFromTray(R, item) {
  const P = R.P, page = P.page, b = item.box;
  // rotation mode: tap the thumbnail until it looks upright (misjudging it sometimes)
  if (R.rot) {
    let need = (4 - item.rot) & 3;
    if (need && P.mistake()) need = (need + (P.rng() < 0.5 ? 1 : 3)) & 3;
    for (let i = 0; i < need; i++) {
      R.think(0.15);
      const sx = Math.min(P.t.pos, b.w / 3), x = b.x + b.w / 2 + R.gauss(sx), y = b.y + b.h / 2 + R.gauss(sx);
      const before = (await G.tray(page)).find(t => t.id === item.id);
      await R.act(() => tapAt(R, x, y)); R.ev.rotTaps++;
      await sleep(P.superhuman ? 20 : 90);
      const after = (await G.tray(page)).find(t => t.id === item.id);
      const hitOwn = x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
      if (hitOwn && after && before && after.rot === before.rot) { R.ev.rotTapsLost++; R.notes.push('rotation tap on tray piece ' + item.id + ' not registered'); }
      if (!hitOwn) R.ev.trayMisses++;
    }
  }
  // pick target: right cell, or a wrong one when the player misidentifies the piece
  let tid = item.id;
  if (P.rng() < R.wrongRate()) { tid = P.rng.int(R.n); if (tid !== item.id) { R.ev.wrongTargets++; P.stats.mistakes++; } }
  const t = await G.target(page, tid);
  const s = Math.min(P.t.pos, b.w / 3);
  const a = [b.x + b.w / 2 + R.gauss(s), b.y + b.h / 2 + R.gauss(s)];
  const onItem = a[0] >= b.x && a[0] <= b.x + b.w && a[1] >= b.y && a[1] <= b.y + b.h;
  if (!onItem) R.ev.trayMisses++;
  const trayBefore = (await G.tray(page)).map(x => x.id);
  R.ev.pulls++;
  const end = await R.act(() => dragGesture(R, a, [t.x, t.y + 20], item.id, [t.x, t.y], true));
  await sleep(P.superhuman ? 30 : 70);
  const trayAfter = (await G.tray(page)).map(x => x.id);
  const left = trayBefore.filter(id => trayAfter.indexOf(id) < 0);
  const tr = await ev(page, () => { const r = document.getElementById('tray').getBoundingClientRect(); return { top: r.top }; });
  if (!left.length && end[1] < tr.top - 10) { R.ev.pullsDropped++; const ang = Math.atan2(-(end[1] - a[1]), Math.abs(end[0] - a[0])) * 180 / Math.PI; R.notes.push(`pull of ${item.id} dropped (angle ${ang.toFixed(0)}° above horizontal, from ${a.map(v => v.toFixed(0))} to ${end.map(v => v.toFixed(0))}${onItem ? '' : ', started off the thumbnail'})`); return { dropped: true, angle: ang }; }
  if (left.length && left[0] !== item.id) R.ev.pullsWrongPiece++;
  return { pulled: left[0] };
}

// fix one loose group: rotate it if needed (rotation mode), then drag it to where it belongs
async function correct(R, q) {
  const P = R.P, page = P.page, v = await G.view(page);
  R.think(0.6);
  if (R.rot && q.rot !== 0) {
    let need = (4 - q.rot) & 3;
    for (let i = 0; i < need; i++) {
      const s = Math.min(P.t.pos, v.cellW * 0.3);
      const cur = await G.ps(page, q.id); if (!cur || cur.locked) return;
      const x = cur.x + R.gauss(s), y = cur.y + R.gauss(s);
      const h = await G.hit(page, x, y);
      await R.act(() => tapAt(R, x, y)); R.ev.tableRotTaps++;
      await sleep(P.superhuman ? 20 : 90);
      if (!h || h.locked) { R.ev.grabMisses++; i--; R.think(0.2); if (R.ev.grabMisses > 400) return; }
    }
    q = await G.ps(page, q.id); if (!q || q.locked) return; q.id = q.id === undefined ? 0 : q.id;
  }
  const cur = await G.ps(page, q.id); if (!cur || cur.locked) return;
  const t = await G.target(page, q.id);
  const s = Math.min(P.t.pos, v.cellW * 0.3);
  const a = [cur.x + R.gauss(s), cur.y + R.gauss(s)];
  const h = await G.hit(page, a[0], a[1]);
  if (!h || h.locked) R.ev.grabMisses++;
  R.ev.corrections++;
  await R.act(() => dragGesture(R, a, [t.x + (a[0] - cur.x), t.y + (a[1] - cur.y)], q.id, [t.x, t.y], false));
  await sleep(P.superhuman ? 30 : 70);
}

async function playRun(P, n, rot, seed) {
  const page = P.page, R = new Run(P, n, rot);
  await ev(page, a => window.__game.start(a[0], a[1], a[2], a[3]), [PICS[n], n, !!rot, seed]);
  await sleep(400);
  const st0 = await G.state(page), N = st0.count; R.n = N;
  const t0 = Date.now(); let stuck = 0, lastLocked = -1, loops = 0;
  const pending = new Map(); // id -> how many times corrected
  while (Date.now() - t0 < RUN_WALL_CAP) {
    const st = await G.state(page); if (st.won) break;
    loops++;
    if (st.locked === lastLocked) stuck++; else { stuck = 0; lastLocked = st.locked; }
    if (stuck > 60) { R.notes.push('no progress for 60 actions'); break; }
    const loose = await checkPlacement(R);
    // a human fixes the piece they just dropped before taking a new one
    if (loose.length) {
      const q = loose.find(x => x.bad) || loose[0];
      if (q.bad) { await panToward(R, [q.x, q.y]); continue; }
      // a piece placed on a wrong cell: notice it after a moment (the cell is wrong, it did not lock)
      R.think(0.3 * R.searchScale());
      pending.set(q.id, (pending.get(q.id) || 0) + 1);
      await correct(R, q);
      continue;
    }
    let tray = await G.tray(page);
    if (!tray.length) { R.notes.push('nothing loose, tray empty, not won'); break; }
    const vis = tray.filter(t => t.box && !t.box.cut);
    if (!vis.length) {
      // scroll the tray left with a horizontal swipe
      const tb = await ev(page, () => { const r = document.getElementById('trayScroll').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
      R.think(0.2); R.ev.trayScrolls++;
      await R.act(() => P.swipe(tb.x + tb.w * 0.8, tb.y + tb.h / 2, -tb.w * 0.6, 0));
      await sleep(300); continue;
    }
    // search: find the next piece and where it goes
    R.think(R.searchScale());
    const item = P.superhuman || P.rng() < 0.7 ? vis[0] : P.rng.pick(vis);
    await pullFromTray(R, item);
  }
  await sleep(1700);
  const st = await G.state(page);
  const winShown = st.won ? await page.isVisible('#win') : false;
  const spm = R.model / N / 1000;
  return Object.assign({ pieces: N, rot: !!rot, seed, cleared: st.won, locked: st.locked, winOverlay: winShown, modelSec: +(R.model / 1000).toFixed(1), gameSec: +(st.elapsed / 1000).toFixed(1), wallSec: +((Date.now() - t0) / 1000).toFixed(1),
    stars: st.won ? (spm < 6 ? 3 : spm < 14 ? 2 : 1) : 0, gameStars: st.won ? await ev(page, () => document.querySelectorAll('#winStars .on').length) : 0, dragsPerPiece: +((R.ev.pulls + R.ev.corrections) / N).toFixed(2) }, R.ev, { notes: R.notes.slice(0, 12) });
}

async function runTier(browser, tierId, idx) {
  const sess = await H.newSession(browser, 'file://' + APP, () => { try { localStorage.setItem('photo-jigsaw:v1:settings', JSON.stringify({ sound: false, vib: false, coached: true, rotHint: true, zoomHint: true })); } catch (e) {} });
  const P = new H.Player(sess, tierId, 4000 + idx * 7919);
  await sleep(600);
  const runs = [];
  for (const rot of ROTS) for (const n of SIZES) {
    const r = await playRun(P, n, rot, 1000 + n * 10 + rot);
    runs.push(r);
    console.log(`[${tierId}] ${n}${rot ? 'r' : ''} ${r.cleared ? 'DONE' : 'unfinished ' + r.locked + '/' + r.pieces} model ${r.modelSec}s game ${r.gameSec}s stars ${r.stars} drags/pc ${r.dragsPerPiece} dropped ${r.pullsDropped}/${r.pulls} grabMiss ${r.grabMisses} off ${r.offscreen} underBtn ${r.underButtons} rotLost ${r.rotTapsLost}/${r.rotTaps}`);
    fs.writeFileSync(path.join(__dirname, 'partial-' + tierId + '.json'), JSON.stringify({ runs, errors: sess.errors }, null, 1));
  }
  const errors = sess.errors.slice();
  await sess.ctx.close();
  const sum = k => runs.reduce((a, r) => a + (r[k] || 0), 0);
  return { name: H.TIERS[tierId].name, runs, errors, stats: P.stats, summary: { finished: runs.filter(r => r.cleared).length + '/' + runs.length, modelMinutes: +(sum('modelSec') / 60).toFixed(1), avgStars: +(sum('stars') / runs.length).toFixed(2), pulls: sum('pulls'), pullsDropped: sum('pullsDropped'), grabMisses: sum('grabMisses'), offscreen: sum('offscreen'), underButtons: sum('underButtons'), rotTapsLost: sum('rotTapsLost') } };
}

// ---------- probes ----------
async function probes(browser) {
  const out = {};
  // 1) pulling a piece out of the tray at different angles (straight line from the thumbnail), 390x844
  {
    const sess = await H.newSession(browser, 'file://' + APP, () => { try { localStorage.setItem('photo-jigsaw:v1:settings', JSON.stringify({ sound: false, vib: false, coached: true, rotHint: true, zoomHint: true })); } catch (e) {} });
    const P = new H.Player(sess, 'superhuman', 1); const R = new Run(P, 30, 0);
    const res = [];
    for (const ang of [90, 75, 60, 50, 45, 40, 35, 30, 20]) {
      await ev(sess.page, () => window.__game.start('balloons', 30, false, 77)); await sleep(250);
      const tray = await G.tray(sess.page), it = tray.find(t => t.box && !t.box.cut && t.box.x > 100) || tray[0];
      const b = it.box, a = [b.x + b.w / 2, b.y + b.h / 2];
      const rad = ang * Math.PI / 180, L = 300, dir = a[0] > 195 ? -1 : 1;
      const end = [a[0] + dir * Math.cos(rad) * L, a[1] - Math.sin(rad) * L];
      // a plain straight drag (no aiming): does the piece come out?
      await touch(P, 'touchStart', [{ x: a[0], y: a[1], id: 1 }]);
      for (let i = 1; i <= 14; i++) { await sleep(16); const p = lerp(a, end, i / 14); await touch(P, 'touchMove', [{ x: p[0], y: p[1], id: 1 }]); }
      await sleep(30); await touch(P, 'touchEnd', []); await sleep(120);
      const after = await G.tray(sess.page);
      const scrolled = await ev(sess.page, () => document.getElementById('trayScroll').scrollLeft);
      res.push({ angle: ang, pulledOut: after.length < tray.length, trayScrolled: scrolled > 0 });
    }
    out.trayPullAngles = res;
    out.trayPullErrors = sess.errors.slice();
    await sess.ctx.close();
  }
  // 2) small screens, 99 pieces: fitted cell size, snap radius, zoom buttons over the board, drop under buttons, zoomed play
  for (const [w, h] of [[360, 640], [375, 500], [390, 844], [844, 390]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { try { localStorage.setItem('photo-jigsaw:v1:settings', JSON.stringify({ sound: false, vib: false, coached: true, rotHint: true, zoomHint: true })); } catch (e) {} });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP); await sleep(500);
    const cdp = await ctx.newCDPSession(page);
    const P = new H.Player({ ctx, page, cdp, errors }, 'world', 3); const R = new Run(P, 99, 0);
    await ev(page, () => window.__game.start('garden', 99, false, 99)); await sleep(300);
    const v = await G.view(page), btn = await G.buttons(page);
    const boardCovered = btn.filter(b => b.x < v.boardLeft + v.boardW && b.x + b.w > v.boardLeft && b.y < v.boardTop + v.boardH && b.y + b.h > v.boardTop).map(b => b.id);
    const tray0 = await G.tray(page);
    const trayVisible = tray0.filter(t => t.box && !t.box.cut).length;
    // world-tier play of the first 15 pieces at fit zoom
    let placed = 0, drags = 0, dropped = 0;
    for (let k = 0; k < 15; k++) {
      const vis = (await G.tray(page)).filter(t => t.box && !t.box.cut); if (!vis.length) break;
      const r = await pullFromTray(R, vis[0]); drags++; if (r.dropped) dropped++;
      for (let c = 0; c < 6; c++) { const l = await G.loose(page); if (!l.length) break; await correct(R, l[0]); drags++; }
    }
    placed = (await G.state(page)).locked;
    // zoom in twice with the button, then place 5 more pieces whose cell is on screen (pan by dragging the empty table if needed)
    const zi = btn.find(b => b.id === 'bZoomIn');
    for (let i = 0; i < 2; i++) { await tapAt(R, zi.x + zi.w / 2, zi.y + zi.h / 2); await sleep(120); }
    const vz = await G.view(page);
    let zPlaced0 = (await G.state(page)).locked, zDrags = 0, pans = 0, unreachable = 0;
    for (let k = 0; k < 6; k++) {
      const vis = (await G.tray(page)).filter(t => t.box && !t.box.cut); if (!vis.length) break;
      let t = await G.target(page, vis[0].id); const vv = await G.view(page);
      if (t.x < vv.left + 30 || t.x > vv.left + vv.width - 30 || t.y < vv.top + 30 || t.y > vv.top + vv.height - 70) {
        // pan: drag the table from an empty spot so the target comes to the middle
        let sp = null; for (const cand of [[vv.left + vv.width / 2, vv.top + 20], [vv.left + 20, vv.top + vv.height / 2], [vv.left + vv.width - 70, vv.top + 20], [vv.left + vv.width / 2, vv.top + vv.height / 2]]) { const hh = await G.hit(page, cand[0], cand[1]); if (!hh || hh.locked) { sp = cand; break; } }
        if (sp) { const mid = [vv.left + vv.width / 2, vv.top + vv.height * 0.45]; await touch(P, 'touchStart', [{ x: sp[0], y: sp[1], id: 1 }]); for (let i = 1; i <= 10; i++) { await sleep(16); const p = lerp(sp, [sp[0] + mid[0] - t.x, sp[1] + mid[1] - t.y], i / 10); await touch(P, 'touchMove', [{ x: p[0], y: p[1], id: 1 }]); } await touch(P, 'touchEnd', []); pans++; await sleep(80); }
        t = await G.target(page, vis[0].id); const v2 = await G.view(page);
        if (t.x < v2.left || t.x > v2.left + v2.width || t.y < v2.top || t.y > v2.top + v2.height) { unreachable++; continue; }
      }
      const r = await pullFromTray(R, vis[0]); zDrags++;
      for (let c = 0; c < 6; c++) { const l = await G.loose(page); if (!l.length) break; await correct(R, l[0]); zDrags++; }
    }
    const zPlaced = (await G.state(page)).locked - zPlaced0;
    // drop a piece right under the zoom-out button and see whether it can be grabbed back
    const zo = (await G.buttons(page)).find(b => b.id === 'bZoomOut');
    const vis = (await G.tray(page)).filter(t => t.box && !t.box.cut);
    let underBtn = null;
    if (vis.length) {
      const b = vis[0].box, a = [b.x + b.w / 2, b.y + b.h / 2];
      await dragGesture(R, a, [zo.x + zo.w / 2, zo.y + zo.h / 2], vis[0].id, [zo.x + zo.w / 2, zo.y + zo.h / 2], true); await sleep(120);
      const q = await G.ps(page, vis[0].id);
      const onScreenTop = q ? await ev(page, a => { const el = document.elementFromPoint(a[0], a[1]); return el ? (el.id || el.closest('button') && el.closest('button').id || el.tagName) : null; }, [q.x, q.y]) : null;
      underBtn = { pieceAt: q && [Math.round(q.x), Math.round(q.y)], topElementAtPieceCentre: onScreenTop, buttonBox: [zo.x, zo.y, zo.w, zo.h] };
    }
    out['screen_' + w + 'x' + h] = { cellPx: +v.cellW.toFixed(1), snapPx: +v.snapPx.toFixed(1), boardCoveredBy: boardCovered, trayThumbsVisible: trayVisible, fitPlaced: placed, fitDrags: drags, fitPullsDropped: dropped, zoomCellPx: +vz.cellW.toFixed(1), zoomPlaced: zPlaced, zoomDrags: zDrags, pans, unreachableTargets: unreachable, dropUnderButton: underBtn, offscreen: R.ev.offscreen, underButtons: R.ev.underButtons, errors };
    console.log('probe', w + 'x' + h, JSON.stringify(out['screen_' + w + 'x' + h]));
    await ctx.close();
  }
  // 3) 8 taps per second on tray thumbnails in rotation mode (alternating two pieces): every tap must turn exactly one piece by 90°
  {
    const sess = await H.newSession(browser, 'file://' + APP, () => { try { localStorage.setItem('photo-jigsaw:v1:settings', JSON.stringify({ sound: false, vib: false, coached: true, rotHint: true, zoomHint: true })); } catch (e) {} });
    const P = new H.Player(sess, 'superhuman', 5); const R = new Run(P, 30, 1);
    await ev(sess.page, () => window.__game.start('balloons', 30, true, 55)); await sleep(300);
    const tr = (await G.tray(sess.page)).filter(t => t.box && !t.box.cut).slice(0, 2);
    const r0 = tr.map(t => t.rot); const taps = 16;
    for (let i = 0; i < taps; i++) { const b = tr[i % 2].box; const t1 = Date.now(); await tapAt(R, b.x + b.w / 2, b.y + b.h / 2); await sleep(Math.max(0, 125 - (Date.now() - t1))); }
    await sleep(200);
    const now = (await G.tray(sess.page)); const r1 = tr.map(t => now.find(x => x.id === t.id).rot);
    out.rapidTrayRotate = { taps, perPiece: taps / 2, expectedTurns: taps / 2 % 4, before: r0, after: r1, ok: r1.every((r, i) => r === (r0[i] + taps / 2) % 4) };
    // same on a piece on the table
    await ev(sess.page, () => window.__game.start('balloons', 30, true, 56)); await sleep(300);
    const it = (await G.tray(sess.page)).find(t => t.box && !t.box.cut);
    const v = await G.view(sess.page);
    await dragGesture(R, [it.box.x + it.box.w / 2, it.box.y + it.box.h / 2], [v.left + 40, v.top + 40], it.id, [v.left + 45, v.top + 45], true); await sleep(150);
    let q = await G.ps(sess.page, it.id); const q0 = q.rot;
    for (let i = 0; i < 8; i++) { q = await G.ps(sess.page, it.id); const t1 = Date.now(); await tapAt(R, q.x, q.y); await sleep(Math.max(0, 125 - (Date.now() - t1))); }
    await sleep(200); q = await G.ps(sess.page, it.id);
    out.rapidTableRotate = { taps: 8, before: q0, after: q && q.rot, ok: q && q.rot === q0 && !q.locked };
    out.rapidErrors = sess.errors.slice();
    await sess.ctx.close();
    console.log('probe rapid', JSON.stringify(out.rapidTrayRotate), JSON.stringify(out.rapidTableRotate));
  }
  return out;
}

(async () => {
  const browser = await H.launch();
  const out = { game: 'photo-jigsaw', app: path.relative(path.resolve(__dirname, '../../..'), APP), sizes: SIZES, rotation: ROTS, pictures: PICS, model: 'modelled time = reaction + search/think time per action (virtual) + real duration of every touch gesture; stars from the game formula (s per piece <6 = 3★, <14 = 2★) on modelled time', tiers: {} };
  const t0 = Date.now();
  if (!args.includes('--probes-only')) for (let i = 0; i < TIER_LIST.length; i++) out.tiers[TIER_LIST[i]] = await runTier(browser, TIER_LIST[i], i);
  if (!args.includes('--no-probes')) out.probes = await probes(browser);
  out.wallSec = Math.round((Date.now() - t0) / 1000);
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('done', out.wallSec + 's ->', OUT);
})().catch(e => { console.error(e); process.exit(1); });
