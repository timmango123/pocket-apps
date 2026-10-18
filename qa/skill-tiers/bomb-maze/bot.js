// 鞭炮貓老街 (bomb-maze) skill-tier bot. Usage: node bot.js [tiers...] [--levels=1,10,...] [--battles=3] [--out=results.json]
// Reads state through window.__game.sim() (a read-only snapshot built by __obs in the page); acts ONLY through real
// touch events: a finger on the virtual joystick (#pad) and taps on the big bomb button (#bombBtn). The clock is
// lock-stepped (harness LOCKSTEP) so every run is deterministic for a given seed and faster than real time.
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = path.resolve(__dirname, '../../../apps/bomb-maze/index.html');
const html = fs.readFileSync(APP, 'utf8');
const BM = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BM;')();
const { DX, DY, EMPTY, SOFT, IT } = BM;

const args = process.argv.slice(2);
const TIER_LIST = args.filter(a => H.TIERS[a]).length ? args.filter(a => H.TIERS[a]) : H.TIER_IDS;
const lvArg = args.find(a => a.startsWith('--levels='));
const TEST_LEVELS = lvArg ? lvArg.slice(9).split(',').map(Number) : [1, 10, 25, 50, 75, 99, 100];
const btArg = args.find(a => a.startsWith('--battles='));
const BATTLES = btArg ? +btArg.slice(10) : 3;
const outArg = args.find(a => a.startsWith('--out='));
const OUT = path.join(__dirname, outArg ? outArg.slice(6) : 'results.json');
const WALL_CAP_MS = +(args.find(a => a.startsWith('--cap=')) || '--cap=1800000').slice(6);

// Per-tier decision model on top of the shared reaction / motor / mistake numbers.
//  every: frames between decisions; policy: clumsy (half random, 1-step greedy, bombs without checking escape),
//  casual (greedy, 15% random, checks only its own bomb's cross), skilled/world (the full planner with chain-aware
//  danger map and escape check; world sees fresher state), superhuman (planner every frame, perfect information).
const MODEL = {
  clumsy: { every: 12, policy: 'clumsy', random: 0.5, margin: 0.1, fat: 0.03, attempts: 5 },
  casual: { every: 8, policy: 'casual', random: 0.15, margin: 0.25, fat: 0.01, attempts: 3 },
  skilled: { every: 5, policy: 'plan', random: 0, margin: 0.45, fat: 0, attempts: 3 },
  world: { every: 3, policy: 'plan', random: 0, margin: 0.4, fat: 0, attempts: 3 },
  superhuman: { every: 1, policy: 'plan', random: 0, margin: 0.3, fat: 0, attempts: 3 }
};
const PAD_PUSH = 44; // px the thumb is pushed from the pad centre for a direction

// read-only observation installed in the page (the game exposes sim() for tests; we only read it)
const OBS = `window.__obs = () => { const g = window.__game, s = g && g.sim(); if (!s) return null; const st = g.state();
  return { st: s.status, mode: st.mode, playing: st.playing, paused: st.paused, time: s.time, limit: s.limit, lives: s.lives, kills: s.kills, doorOpen: s.doorOpen, doorCell: s.doorCell, w: s.w, h: s.h, hold: s.hold || 0,
    grid: Array.from(s.grid), items: Array.from(s.items), fire: Array.from(s.fire, v => +v.toFixed(3)),
    bombs: s.bombs.map(b => ({ x: b.x, y: b.y, t: +b.t.toFixed(3), range: b.range, slide: b.slide, p: b.p, owner: b.owner })),
    bombers: s.bombers.map(b => ({ id: b.id, x: +b.x.toFixed(3), y: +b.y.toFixed(3), alive: b.alive, invul: b.invul, shield: b.shield, kick: b.kick, bombs: b.bombs, fire: b.fire, speed: b.speed, placed: b.placed, onBomb: b.onBomb, inDir: b.inDir })),
    enemies: s.enemies.map(e => ({ t: e.t, x: +e.x.toFixed(3), y: +e.y.toFixed(3), tx: e.tx, ty: e.ty, dir: e.dir, alive: e.alive, hp: e.hp })),
    sudden: s.sudden ? { on: s.sudden.on, idx: s.sudden.idx, timer: s.sudden.timer, step: s.sudden.step } : null, winner: s.winner }; };`;

// Node-side view of the snapshot that the game's own planner functions accept
function mkSim(o, rng) {
  const sim = { w: o.w, h: o.h, mode: o.mode === 'battle' ? 'battle' : 'stage', grid: o.grid, items: o.items, fire: Float32Array.from(o.fire), bombs: o.bombs, bombers: o.bombers, enemies: o.enemies, doorOpen: o.doorOpen, doorCell: o.doorCell, rng, sudden: null };
  if (o.sudden) sim.sudden = Object.assign({ order: BM.spiralOrder(o.w, o.h) }, o.sudden);
  return sim;
}
const inB = (s, x, y) => x >= 0 && y >= 0 && x < s.w && y < s.h;
function passableFn(s, c) { return (x, y) => inB(s, x, y) && s.grid[y * s.w + x] === EMPTY && (!BM.bombAt(s, x, y) || y * s.w + x === c); }
function nearest(s, cx, cy, pass, pick) {
  const r = BM.bfs(s, cx, cy, pass); let best = -1, bd = 1e9;
  for (const u of r.order) { if (u === cy * s.w + cx) continue; const v = pick(u, r.dist[u]); if (v != null && v < bd) { bd = v; best = u; } }
  if (best < 0) return null; const p = []; let c = best; while (c !== cy * s.w + cx && c >= 0) { p.push(c); c = r.prev[c]; } return p.reverse();
}
// clumsy / casual: short-sighted humans. Bomb when something burnable is next to them, flee only when they see
// their own cell in a blast line; casual also checks that there is a way out before planting.
function simpleDecide(M, s, b, rng) {
  const W = s.w, cx = Math.floor(b.x), cy = Math.floor(b.y), c = cy * W + cx;
  const D = BM.dangerMap(s), pass = passableFn(s, c);
  const monsters = s.enemies.filter(e => e.alive);
  const mDist = (x, y) => monsters.reduce((m, e) => Math.min(m, Math.abs(e.x - x - 0.5) + Math.abs(e.y - y - 0.5)), 99);
  const avoid = (x, y) => M.policy === 'casual' ? mDist(x, y) < 1.6 : false;
  const safeIsh = (x, y, d) => pass(x, y) && !avoid(x, y) && (D[y * W + x] === Infinity || (M.policy === 'casual' && D[y * W + x] > d / b.speed + M.margin));
  if (D[c] !== Infinity || mDist(cx, cy) < 1.1) {
    const p = nearest(s, cx, cy, (x, y, d) => pass(x, y) && (M.policy === 'clumsy' || D[y * W + x] !== 0), (u, d) => (D[u] === Infinity && !avoid(u % W, (u - u % W) / W)) ? d : null);
    if (p) return { path: p, bomb: false, flee: true };
    const opts = []; for (let d = 0; d < 4; d++) if (pass(cx + DX[d], cy + DY[d])) opts.push((cy + DY[d]) * W + cx + DX[d]);
    return { path: opts.length ? [rng.pick(opts)] : [], bomb: false, flee: true };
  }
  if (rng() < M.random) { const opts = []; for (let d = 0; d < 4; d++) if (pass(cx + DX[d], cy + DY[d])) opts.push((cy + DY[d]) * W + cx + DX[d]); if (opts.length) return { path: [rng.pick(opts)], bomb: false, random: true }; }
  const targets = s.bombers.filter(x => x.id !== b.id && x.alive).concat(monsters);
  if (b.placed < b.bombs && !BM.bombAt(s, cx, cy) && s.fire[c] <= 0 && (BM.softAdj(s, cx, cy) > 0 || BM.lineHits(s, cx, cy, b.fire, targets) > 0)) {
    if (M.policy === 'clumsy') { for (let d = 0; d < 4; d++) if (pass(cx + DX[d], cy + DY[d])) return { path: [(cy + DY[d]) * W + cx + DX[d]], bomb: rng() < 0.85, flee: false }; }
    else {
      const own = { w: s.w, h: s.h, grid: s.grid, items: s.items, fire: s.fire, bombs: [{ x: cx, y: cy, range: b.fire, t: BM.FUSE }], bombers: s.bombers, enemies: s.enemies, sudden: null };
      const D2 = BM.dangerMap(own);
      const p = nearest(s, cx, cy, (x, y, d) => pass(x, y) && !avoid(x, y) && D2[y * W + x] > d / b.speed + M.margin, (u, d) => D2[u] === Infinity && d / b.speed < BM.FUSE - 0.4 ? d : null);
      if (p) return { path: p, bomb: true };
    }
  }
  const p = nearest(s, cx, cy, safeIsh, (u, d) => {
    const ux = u % W, uy = (u - ux) / W, it = s.items[u];
    if (it === IT.DOOR) return s.doorOpen ? d - 50 : null;
    if (it) return d - 6;
    if (b.placed < b.bombs && BM.softAdj(s, ux, uy) > 0) return d;
    if (M.policy === 'casual' && b.placed < b.bombs && BM.lineHits(s, ux, uy, b.fire, targets) > 0) return d - 2;
    return null;
  });
  if (p) return { path: p, bomb: false };
  if (targets.length) { // nothing to burn: walk toward the nearest target
    const t = targets.reduce((a, e) => (Math.abs(e.x - b.x) + Math.abs(e.y - b.y) < Math.abs(a.x - b.x) + Math.abs(a.y - b.y) ? e : a));
    const p2 = nearest(s, cx, cy, safeIsh, (u, d) => { const ux = u % W, uy = (u - ux) / W, md = Math.abs(ux + 0.5 - t.x) + Math.abs(uy + 0.5 - t.y); return md >= 2 ? md * 2 + d * 0.5 : null; });
    if (p2) return { path: p2, bomb: false };
  }
  const opts = []; for (let d = 0; d < 4; d++) if (safeIsh(cx + DX[d], cy + DY[d], 1)) opts.push((cy + DY[d]) * W + cx + DX[d]);
  return { path: opts.length ? [rng.pick(opts)] : [], bomb: false };
}
function decide(M, s, b, rng) {
  if (M.policy === 'plan') { b.skill = 2; return BM.cpuDecide(s, b); }
  return simpleDecide(M, s, b, rng);
}
function dirToward(b, cell, W, tol) {
  // tol: how close to a cell centre counts as "there" (a human stops within the distance covered between two looks)
  const nx = (cell % W) + 0.5, ny = Math.floor(cell / W) + 0.5, dx = nx - b.x, dy = ny - b.y;
  if (Math.abs(dx) < (tol || 0.07) && Math.abs(dy) < (tol || 0.07)) return -1;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
}

class Finger {
  // one finger on the joystick (touch id 1), a second one for the bomb button (id 2); real CDP touch events
  constructor(P, padBox, bombBox) { this.P = P; this.pad = padBox; this.bomb = bombBox; this.padPt = null; this.dir = -1; this.want = -1; this.stats = { moves: 0, lifts: 0, bombTaps: 0, misdir: 0, dropped: 0 }; }
  points(extra) { const pts = []; if (this.padPt) pts.push({ x: this.padPt.x, y: this.padPt.y, id: 1 }); if (extra) pts.push(extra); return pts; }
  async setDir(d) {
    const P = this.P;
    if (d < 0) { if (this.padPt) { this.padPt = null; try { await P.touch('touchEnd', []); } catch (e) {} this.stats.lifts++; } this.dir = -1; this.want = -1; return -1; }
    const cx = this.pad.x + this.pad.width / 2, cy = this.pad.y + this.pad.height / 2;
    // a thumb pushing a stick is steadier than a tap on a target: a third of the tier's positional sigma
    const sg = P.t.pos / 3, x = cx + DX[d] * PAD_PUSH + (sg ? P.rng.gauss(0, sg) : 0), y = cy + DY[d] * PAD_PUSH + (sg ? P.rng.gauss(0, sg) : 0);
    const actual = Math.hypot(x - cx, y - cy) < 9 ? -1 : (Math.abs(x - cx) > Math.abs(y - cy) ? (x > cx ? 1 : 3) : (y > cy ? 2 : 0));
    if (actual !== d) this.stats.misdir++;
    const was = !!this.padPt; this.padPt = { x, y };
    await P.touch(was ? 'touchMove' : 'touchStart', this.points());
    this.stats.moves++; this.dir = actual; this.want = d; return actual;
  }
  async tapBomb() {
    const P = this.P, b = this.bomb;
    const s = Math.min(P.t.pos, 30);
    const x = b.x + b.width / 2 + (s ? P.rng.gauss(0, s) : 0), y = b.y + b.height / 2 + (s ? P.rng.gauss(0, s) : 0);
    await P.touch('touchStart', this.points({ x, y, id: 2 }));
    this.stats.bombTaps++; P.stats.taps++;
    // CDP's touchEnd ends the whole touch sequence (the joystick finger is dropped as well), so after the tap the
    // thumb is treated as lifted and the next loop step re-grips the pad.
    return async () => { try { await P.touch('touchEnd', []); } catch (e) {} this.padPt = null; this.dir = -1; this.want = -1; this.stats.lifts++; };
  }
}

async function playRun(P, M, kind, n, opts) {
  const page = P.page, rng = P.rng, FR = H.FRAME;
  const stepN = M.every <= 3 ? (M.every === 1 ? 2 : 3) : (M.every <= 5 ? 4 : 6);
  if (kind === 'stage') await page.evaluate(n => window.__game.startStage(n), n);
  else await page.evaluate(([c, s]) => window.__game.startBattle(c, s), [opts.cpus, opts.skill]);
  const padBox = await page.locator('#pad').boundingBox(), bombBox = await page.locator('#bombBtn').boundingBox();
  const F = new Finger(P, padBox, bombBox);
  let o = await page.evaluate(() => window.__step(1, true));
  if (!o || o.st !== 'play') throw new Error('start failed ' + JSON.stringify(o && [o.st, o.mode]));
  const buf = [o]; let frame = 0, nextDec = 0, plan = null, pendingBomb = null, release = null, releaseAt = 0, decisions = 0, randoms = 0, mistakes = 0;
  let livesLost = 0, lastLives = o.lives, lastAlive = true; const deaths = []; const picks = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let lastItems = o.items.slice(); let end = null, wrongDir = -1, wrongUntil = 0; const t0 = Date.now(); const prof = { ev: 0, dec: 0 }; let lastDecCell = -1, lastBombKey = '', lastDecFrame = -999, mismatch = 0;
  const capFrames = Math.round(((kind === 'stage' ? o.limit + 5 : 200)) * 60);
  while (frame < capFrames && Date.now() - t0 < 240000) {
    const _te = Date.now(); o = await page.evaluate(n => window.__step(n, true), stepN); frame += stepN; prof.ev += Date.now() - _te;
    buf.push(o); if (buf.length > 80) buf.shift();
    if (process.env.BM_DEBUG && frame % (+process.env.BM_DEBUG) === 0) console.log('  f', frame, 't', o.time.toFixed(1), 'pos', o.bombers[0].x.toFixed(2), o.bombers[0].y.toFixed(2), 'dir', F.dir, o.bombers[0].inDir, 'plan', plan && JSON.stringify(plan.path), plan && plan.flee ? 'FLEE' : '', plan && plan.bomb ? 'BOMB' : '', 'en', o.enemies.filter(e => e.alive).map(e => e.x.toFixed(1) + ',' + e.y.toFixed(1)).join(' '), 'bombs', o.bombs.map(b => b.x + ',' + b.y).join(' '), 'kills', o.kills, 'wall', Date.now() - t0, 'touches', F.stats.moves);
    const me = o.bombers[0];
    if (o.lives < lastLives) { livesLost += lastLives - o.lives; }
    if (lastAlive && !me.alive) { deaths.push({ t: +o.time.toFixed(1), near: o.enemies.filter(e => e.alive && Math.abs(e.x - me.x) + Math.abs(e.y - me.y) < 1).length ? 'contact' : 'fire' }); plan = null; }
    lastAlive = me.alive; lastLives = o.lives;
    for (let i = 0; i < o.items.length; i++) if (lastItems[i] > 0 && lastItems[i] !== IT.DOOR && o.items[i] === 0 && Math.floor(me.x) + Math.floor(me.y) * o.w === i) picks[lastItems[i]]++;
    lastItems = o.items;
    if (o.st !== 'play') { end = o.st; break; }
    if (release && frame >= releaseAt) { await release(); release = null; }
    if (o.hold > 0 || !me.alive) { if (F.dir >= 0) await F.setDir(-1); continue; }
    // decide on delayed screen state (reaction time), own position known exactly (proprioception).
    // Like a human, re-plan at cell centres, when the bombs on screen change, when a monster is close, or after a while.
    const cellNow = Math.floor(me.x) + Math.floor(me.y) * o.w;
    const atC = Math.abs(me.x - Math.floor(me.x) - 0.5) < 0.08 && Math.abs(me.y - Math.floor(me.y) - 0.5) < 0.08;
    const bombKey = o.bombs.map(b => b.x + ',' + b.y).join('|') + '/' + o.fire.filter(v => v > 0).length;
    const monsterNear = o.enemies.some(e => e.alive && Math.abs(e.x - me.x) + Math.abs(e.y - me.y) < 2.2);
    const need = !plan || (atC && cellNow !== lastDecCell) || bombKey !== lastBombKey || (!plan.path.length && atC) || frame - lastDecFrame > 60 || (monsterNear && frame - lastDecFrame > M.every * 2);
    if (need && frame >= nextDec) {
      nextDec = frame + M.every; lastDecCell = cellNow; lastBombKey = bombKey; lastDecFrame = frame;
      const d = Math.max(1, Math.round(P.reactMs() / FR / stepN));
      const ob = buf[Math.max(0, buf.length - d)];
      if (ob.st === 'play') {
        const s = mkSim(ob, rng); const b = Object.assign({}, ob.bombers[0], { x: me.x, y: me.y, placed: me.placed, onBomb: me.onBomb });
        if (b.alive) {
          const _td = Date.now(); const dec = decide(M, s, b, rng); prof.dec += Date.now() - _td; decisions++; if (dec.random) randoms++;
          plan = dec;
          if (P.mistake()) { wrongDir = rng.int(4); wrongUntil = frame + M.every; mistakes++; }
          if (dec.bomb || (M.fat && rng() < M.fat)) { if (!dec.bomb) mistakes++; pendingBomb = frame + Math.round(Math.abs(P.timingErr()) / FR); }
        }
      }
    }
    if (pendingBomb != null && frame >= pendingBomb && !release) { pendingBomb = null; release = await F.tapBomb(); releaseAt = frame + (P.superhuman ? 1 : 4); }
    // follow the plan: steer toward the next cell; when a cell is reached, pop it
    let want = -1;
    if (frame < wrongUntil) want = wrongDir;
    else if (plan && plan.path.length) {
      const tol = Math.max(0.08, me.speed * stepN / 60 * 0.55);
      while (plan.path.length && dirToward(me, plan.path[0], o.w, plan.path.length > 1 ? tol : tol * 0.8) < 0) plan.path.shift();
      if (plan.path.length) want = dirToward(me, plan.path[0], o.w, 0.03);
    }
    // the stick is held until the intended direction changes; a registered direction that differs from the finger's
    // actual direction for two consecutive checks counts as a dropped input and is re-pushed
    const held = F.padPt ? F.want : -1;
    if (want !== held) await F.setDir(want);
    else if (want >= 0 && me.inDir !== F.dir) { if (mismatch++ >= 1) { F.stats.dropped++; mismatch = 0; await F.setDir(want); } }
    else mismatch = 0;
  }
  if (F.dir >= 0) await F.setDir(-1);
  if (release) await release();
  const me = o.bombers[0];
  const res = { kind, level: kind === 'stage' ? n : undefined, cleared: end === 'won', end: end || 'timeout', time: +o.time.toFixed(1), limit: o.limit, livesLost, deaths, kills: o.kills, enemiesLeft: o.enemies.filter(e => e.alive).length, doorOpen: o.doorOpen,
    powerups: picks, bombsMax: me.bombs, fireRange: me.fire, decisions, randoms, mistakes, input: F.stats, ms: Date.now() - t0 };
  if (kind === 'stage' && end === 'won') res.stars = 1 + (livesLost === 0 ? 1 : 0) + ((o.limit - o.time) / o.limit >= 0.4 ? 1 : 0);
  if (kind === 'battle') { res.winner = o.winner; res.won = o.winner === 0; res.aliveCpus = o.bombers.filter(b => b.id && b.alive).length; }
  // let the result overlay appear and check it (UI sanity)
  await page.evaluate(() => window.__step(150));
  res.overlay = await page.evaluate(() => ['ovResult', 'ovBattleEnd'].map(id => document.getElementById(id).hidden ? 0 : 1).join(''));
  return res;
}

async function runTier(browser, tierId, idx) {
  const M = MODEL[tierId];
  const sess = await H.newSession(browser, 'file://' + APP, H.LOCKSTEP(777 + idx * 101) + OBS);
  const P = new H.Player(sess, tierId, 1000 + idx * 7919);
  await sess.page.evaluate(() => { try { localStorage.setItem('bomb-maze:v1:mute', 'true'); } catch (e) {} window.__step(5); });
  const runs = [], battles = [];
  const t0 = Date.now();
  for (const n of TEST_LEVELS) {
    const run = { level: n, attempts: [], cleared: false };
    for (let a = 1; a <= M.attempts; a++) {
      const r = await playRun(P, M, 'stage', n);
      run.attempts.push(r);
      if (r.cleared) { run.cleared = true; break; }
      if (r.end === 'lost' && r.livesLost < 3) break;   // ran out of time, not lives: a retry replays the same stalemate
      if (Date.now() - t0 > WALL_CAP_MS / TIER_LIST.length) break;
    }
    const last = run.attempts[run.attempts.length - 1];
    Object.assign(run, { tries: run.attempts.length, stars: last.stars || 0, time: last.time, ms: run.attempts.reduce((s, x) => s + x.ms, 0) });
    runs.push(run);
    console.log(`[${tierId}] L${n} ${run.cleared ? 'CLEAR' : 'fail'} tries=${run.tries} stars=${run.stars} t=${last.time}s lives-${last.livesLost} kills=${last.kills}/${last.kills + last.enemiesLeft} ${(run.ms / 1000).toFixed(0)}s wall`);
    fs.writeFileSync(path.join(__dirname, `partial-${tierId}.json`), JSON.stringify({ runs, errors: sess.errors }, null, 1));
  }
  for (let i = 0; i < BATTLES; i++) {
    const r = await playRun(P, M, 'battle', 0, { cpus: 3, skill: 1 });
    battles.push(r);
    console.log(`[${tierId}] battle ${i + 1} ${r.won ? 'WIN' : 'lose'} winner=${r.winner} t=${r.time}s kills=${r.kills} ${(r.ms / 1000).toFixed(0)}s wall`);
  }
  const pageErr = await sess.page.evaluate(() => window.__errs);
  const errors = sess.errors.concat(pageErr);
  await sess.ctx.close();
  const cl = runs.filter(r => r.cleared);
  return { runs, battles, errors, stats: P.stats, summary: { cleared: cl.length + '/' + runs.length, clearedLevels: cl.map(r => r.level), totalAttempts: runs.reduce((a, r) => a + r.tries, 0),
    avgStarsCleared: cl.length ? +(cl.reduce((a, r) => a + r.stars, 0) / cl.length).toFixed(2) : 0, battlesWon: battles.filter(b => b.won).length + '/' + battles.length,
    misdirected: runs.reduce((a, r) => a + r.attempts.reduce((b, x) => b + x.input.misdir, 0), 0), droppedInputs: runs.reduce((a, r) => a + r.attempts.reduce((b, x) => b + x.input.dropped, 0), 0), pageErrors: errors.length } };
}

(async () => {
  const browser = await H.launch();
  const out = fs.existsSync(OUT) && outArg ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { game: 'bomb-maze', testedLevels: TEST_LEVELS, battles: BATTLES + ' x 3 CPU (普通)', timeCap: 'the stage timer itself (150-190 s); battle 200 s', tiers: {}, findings: [] };
  const t0 = Date.now();
  for (let i = 0; i < TIER_LIST.length; i++) {
    out.tiers[TIER_LIST[i]] = await runTier(browser, TIER_LIST[i], H.TIER_IDS.indexOf(TIER_LIST[i]));
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  }
  out.wallSeconds = Math.round((Date.now() - t0) / 1000);
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('done', TIER_LIST.map(t => t + ':' + out.tiers[t].summary.cleared + ' battles ' + out.tiers[t].summary.battlesWon).join(' | '), 'wall', out.wallSeconds + 's');
})().catch(e => { console.error(e); process.exit(1); });
