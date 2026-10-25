// Core tests for 平台跳躍 (platform-jump). Loads the engine between the CORE markers of ../index.html and checks the
// physics (run, variable jump, coyote time, jump buffer, springs, wall jumps, platforms, hazards), every mechanic, level
// generation for all 100 levels, and replays the stored bot solution of every level to prove each one is clearable.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return PJ;')();
const SOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions.json'), 'utf8'));
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const { C, T, H } = PJ;

// ---- tiny hand-made levels: rows of 14 strings, '#' ground, '-' board, '^' spike, 'v' ceiling spike, '|' vine wall,
// 'C' crumble, '>' '<' conveyor, 'A' 'B' rhythm blocks, 't' timed spike, 'S' spring (on the cell above ground), 'P' spawn, 'G' goal
const CODE = { '#': T.S, '-': T.O, '^': T.SP, 'v': T.SD, '|': T.WL, 'C': T.CR, '>': T.CVR, '<': T.CVL, 'A': T.TA, 'B': T.TB, 't': T.TS };
function mk(rows, extra) {
  while (rows.length < H) rows.unshift('');
  const w = Math.max(...rows.map(r => r.length)) + 30, tiles = new Uint8Array(w * H);
  const L = { n: 0, w, h: H, tiles, world: 0, spawn: [1, 10], goal: [w + 50, 10], movers: [], saws: [], springs: [], gems: [], cps: [], wps: [], crumbles: [], crIdx: new Int16Array(w * H).fill(-1), period: 1 };
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    if (CODE[ch] !== undefined) tiles[x * H + y] = CODE[ch];
    if (ch === 'P') L.spawn = [x, y + 1];
    if (ch === 'G') L.goal = [x, y + 1];
    if (ch === 'S') L.springs.push([x, y]);
    if (ch === 'C') { L.crIdx[x * H + y] = L.crumbles.length; L.crumbles.push([x, y]); }
  }));
  return Object.assign(L, extra || {});
}
const flat = (w, extraRows) => mk([...(extraRows || []), ' P', '#'.repeat(w), '#'.repeat(w), '#'.repeat(w)]);
function run(L, s, ticks, inp) { const ev = []; let held = !!s._held; for (let i = 0; i < ticks; i++) { const x = typeof inp === 'function' ? inp(i, s) : inp; PJ.step(L, s, { h: x.h || 0, j: !!x.j, jp: !!x.j && !held }, ev); held = !!x.j; if (s.dead || s.won) break; } s._held = held; return ev; }
const apexOf = (L, holdTicks) => { const s = PJ.newRun(L), y0 = s.y; let top = y0; run(L, s, 90, (i, st) => { top = Math.min(top, st.y); return { j: i < holdTicks }; }); return y0 - top; };

// ---- running ----
{
  const L = flat(60), s = PJ.newRun(L);
  ok(s.ground && Math.abs(s.y + C.PH - 11) < 1e-9, 'spawn stands on the ground');
  run(L, s, 30, { h: 1 });
  ok(Math.abs(s.vx - C.RUN) < 1e-9, 'reaches top speed in half a second');
  const x0 = s.x; run(L, s, 60, { h: 1 });
  ok(Math.abs(s.x - x0 - C.RUN) < 0.02, 'runs 7 tiles a second');
  run(L, s, 12, { h: 0 });
  ok(s.vx === 0, 'stops within 12 frames when released');
  run(L, s, 6, { h: -1 }); ok(s.vx < 0 && s.face === -1, 'turns around quickly');
  const w = mk([' P   #', '######', '######', '######']), s2 = PJ.newRun(w);
  run(w, s2, 120, { h: 1 }); ok(Math.abs(s2.x + C.PW - 5) < 1e-6 && s2.vx === 0, 'stops flush against a wall: ' + s2.x);
  const s3 = PJ.newRun(L); run(L, s3, 600, { h: -1 }); ok(s3.x === 0, 'level edge is a wall');
}
// ---- variable jump height ----
{
  const L = flat(20);
  const full = apexOf(L, 90), tap = apexOf(L, 1), tap3 = apexOf(L, 5), mid = apexOf(L, 10);
  ok(full > 3.9 && full < 4.3, 'full jump about 4 tiles: ' + full.toFixed(2));
  ok(tap > 1.7 && tap < 1.9, 'tap jump about 1.8 tiles: ' + tap.toFixed(2));
  ok(Math.abs(tap - tap3) < 1e-9, 'taps up to 5 frames give the same hop (minimum jump)');
  ok(mid > tap + 0.5 && mid < full - 0.5, 'holding longer jumps higher: ' + mid.toFixed(2));
  let prev = 0, mono = true; for (let k = 5; k <= 30; k++) { const a = apexOf(L, k); if (a < prev - 1e-9) mono = false; prev = a; }
  ok(mono, 'jump height grows with hold time');
  const s = PJ.newRun(L), ev = run(L, s, 3, { j: 1 });
  ok(ev.some(e => e[0] === 'jump'), 'jump event fires');
  run(L, s, 200, { j: 1 }); ok(s.ground, 'holding jump does not auto-repeat after landing');
  const ev2 = run(L, s, 2, { j: 0 }).concat(run(L, s, 2, { j: 1 })); ok(ev2.some(e => e[0] === 'jump'), 'a fresh press jumps again');
}
// ---- coyote time and jump buffer ----
{
  const L = mk([' P', '#####', '#####', '#####']);
  for (const late of [1, 5, 6, 7, 9]) {
    const s = PJ.newRun(L); let left = -1;
    const ev = run(L, s, 200, (i, st) => { if (left < 0 && !st.ground) left = i; return { h: 1, j: left >= 0 && i === left + late - 1 }; });
    const jumped = ev.some(e => e[0] === 'jump');
    if (late <= 6) ok(jumped, 'coyote: jump ' + late + ' frames after leaving the edge still works');
    else ok(!jumped, 'coyote: ' + late + ' frames late is a fall');
  }
  const Lb = flat(20);
  for (const early of [1, 4, 7, 9, 12]) {
    const s = PJ.newRun(Lb); run(Lb, s, 2, { j: 1 }); run(Lb, s, 3, { j: 0 }); // short hop, then wait for landing
    let landAt = -1; const probe = PJ.cloneRun(s); for (let i = 0; i < 200; i++) { PJ.step(Lb, probe, { h: 0, j: false, jp: false }, null); if (probe.ground) { landAt = i; break; } }
    let jumpedAgain = false; const ev = [];
    for (let i = 0; i < 120; i++) { const press = i === landAt - early; PJ.step(Lb, s, { h: 0, j: press, jp: press }, ev); }
    jumpedAgain = ev.filter(e => e[0] === 'jump').length > 0;
    if (early <= 7) ok(jumpedAgain, 'buffer: pressing ' + early + ' frames before landing jumps on landing');
    else ok(!jumpedAgain, 'buffer: ' + early + ' frames early is ignored');
  }
}
// ---- one-way boards, ceilings, springs ----
{
  const L = mk(['', '   ---', '', '', ' P', '########', '########', '########']), s = PJ.newRun(L);
  run(L, s, 40, (i) => ({ h: i < 8 ? 1 : 0, j: 1 }));
  run(L, s, 60, { h: 0 });
  ok(s.ground && Math.abs(s.y + C.PH - (H - 7)) < 1e-6, 'jumps up through a board and stands on it');
  const L2 = mk([' ###', '', ' P', '#####', '#####', '#####']), s2 = PJ.newRun(L2), ev = run(L2, s2, 60, { j: 1 });
  ok(ev.some(e => e[0] === 'bonk') && s2.y >= H - 5 - 1e-9, 'bumps head on a ceiling');
  const L3 = mk([' PS', '#####', '#####', '#####']), s3 = PJ.newRun(L3); let top = 99;
  const ev3 = run(L3, s3, 160, (i, st) => { top = Math.min(top, st.y); return { h: i < 9 ? 1 : 0, j: 0 }; });
  ok(ev3.some(e => e[0] === 'spring'), 'spring fires');
  const sp1 = (H - 3 - C.PH) - top;
  const s4 = PJ.newRun(L3); let top4 = 99; run(L3, s4, 160, (i, st) => { top4 = Math.min(top4, st.y); return { h: i < 9 ? 1 : 0, j: !st.ground }; });
  const sp2 = (H - 3 - C.PH) - top4;
  ok(sp1 > 4 && sp2 > 7 && sp2 > sp1 + 2, 'spring: tall bounce, taller when holding jump: ' + sp1.toFixed(1) + ' / ' + sp2.toFixed(1));
}
// ---- hazards and falling ----
{
  const L = mk([' P  ^', '#'.repeat(20), '#'.repeat(20), '#'.repeat(20)]), s = PJ.newRun(L), ev = run(L, s, 120, { h: 1 });
  ok(s.dead && ev.some(e => e[0] === 'die'), 'walking into spikes kills');
  const s2 = PJ.newRun(L); run(L, s2, 120, (i, st) => ({ h: 1, j: st.x > 2.2 && st.x < 4.5 }));
  ok(!s2.dead && s2.x > 6, 'jumping over spikes is safe');
  const Lp = mk([' P', '###   ###', '###   ###', '###   ###']), s3 = PJ.newRun(Lp), ev3 = run(Lp, s3, 200, { h: 1 });
  ok(s3.dead && ev3.some(e => e[0] === 'fall'), 'falling into a pit kills');
  const Ll = mk(['  ######', '  vvvvvv', '', '', ' P   ^', '#'.repeat(30), '#'.repeat(30), '#'.repeat(30)]);
  const sa = PJ.newRun(Ll); run(Ll, sa, 120, (i, st) => ({ h: 1, j: st.x > 3.9 && st.x < 4.1 && st.ground }));
  ok(!sa.dead && sa.x > 7, 'a tap hop fits under a spiked ceiling');
  const sb = PJ.newRun(Ll); run(Ll, sb, 120, (i, st) => ({ h: 1, j: st.x > 3.4 }));
  ok(sb.dead, 'a full jump into a spiked ceiling kills');
  // respawn at the last flag
  const Lc = flat(40); Lc.cps = [[10, 11]]; const sc = PJ.newRun(Lc); const evc = run(Lc, sc, 120, { h: 1 });
  ok(sc.cp === 0 && evc.some(e => e[0] === 'cp'), 'touching a flag sets the checkpoint');
  sc.dead = true; PJ.respawn(Lc, sc);
  ok(!sc.dead && sc.deaths === 1 && Math.abs(sc.x + C.PW / 2 - 10.5) < 1e-9 && sc.ground, 'respawns at the flag and counts the failure');
}
// ---- gems and goal ----
{
  const L = flat(30); L.gems = [[4.5, 10.5], [8.5, 7.5], [12.5, 10.5]]; L.goal = [20, 11];
  const s = PJ.newRun(L), ev = run(L, s, 400, { h: 1 });
  ok(s.gems === 0b101, 'collects gems in reach, not the one up high');
  ok(s.won && ev.some(e => e[0] === 'win'), 'reaching the goal flag wins');
  const before = s.ticks; PJ.step(L, s, { h: 1 }, []); ok(s.ticks === before, 'nothing moves after winning');
}
// ---- wall jump ----
{
  const rows = ['', '', '', '      |  |###', '      |  |###', '      |  |###', '      |  |###', '      |  |###', '         |###', ' P       |###', '#############', '#############', '#############'];
  const L = mk(rows), s = PJ.newRun(L);
  run(L, s, 70, { h: 1 });
  ok(s.x + C.PW > 8.9 && s.ground, 'walks under the hanging vine pillar into the shaft');
  let wj = 0;
  const s2 = PJ.newRun(L); const ev2 = [];
  // a scripted climb: walk in, jump at the right wall, then alternate directions after each wall jump
  let dir = 1, held = false;
  for (let i = 0; i < 600 && !s2.dead; i++) {
    let j = false;
    if (s2.ground && s2.x > 7) j = true;
    if (s2.wall && !held) j = true;
    const e0 = ev2.length; PJ.step(L, s2, { h: dir, j, jp: j && !held }, ev2); held = j && (i % 2 === 0);
    for (let k = e0; k < ev2.length; k++) if (ev2[k][0] === 'walljump') { wj++; dir = -ev2[k][1]; }
    if (s2.y + C.PH <= 4.01 && s2.ground) break;
  }
  ok(wj >= 2, 'wall jumps happen off vine walls: ' + wj);
  ok(s2.ground && s2.y + C.PH <= 4.01, 'climbs the shaft to the top ledge: ' + s2.y.toFixed(2));
  const s3 = PJ.newRun(L); run(L, s3, 60, { h: 1 }); run(L, s3, 12, { h: 1, j: 1 }); let slid = false;
  run(L, s3, 60, (i, st) => { if (st.wall && st.vy > 0 && st.vy <= C.WSLIDE + 1e-9) slid = true; return { h: 1, j: 0 }; });
  ok(slid, 'pressing into a vine wall slides down slowly');
  const plain = mk(['      #', '      #', '      #', '      #', ' P    #', '#######', '#######']), s4 = PJ.newRun(plain), ev4 = [];
  let h4 = false; for (let i = 0; i < 120; i++) { const j = i === 2 || i === 30; PJ.step(plain, s4, { h: 1, j, jp: j && !h4 }, ev4); h4 = j; }
  ok(!ev4.some(e => e[0] === 'walljump'), 'plain stone walls are not climbable');
}
// ---- timed mechanics ----
{
  const L = mk([' P', '###CCCC' + '#'.repeat(20), '##     ' + '#'.repeat(20)]), s = PJ.newRun(L);
  let ev = run(L, s, 22, { h: 1 }); ev = ev.concat(run(L, s, 40, { h: 0 }));
  ok(ev.some(e => e[0] === 'shake'), 'stepping on a crumble block starts it shaking');
  ok(s.dead || s.y > 11, 'standing still on crumbling stone drops you: ' + s.y.toFixed(2));
  const s2 = PJ.newRun(L); run(L, s2, 120, { h: 1 });
  ok(!s2.dead && s2.x > 7, 'running across crumble blocks is safe');
  ok(s2.cr.some(v => v < 0), 'crossed blocks break behind you');
  run(L, s2, C.CRUMBLE_BACK + 40, { h: 0 }); ok(s2.cr.every(v => v === 0), 'broken blocks come back');
  // rhythm blocks
  ok(PJ.togOn(T.TA, 60) && !PJ.togOn(T.TB, 60) && !PJ.togOn(T.TA, 180) && PJ.togOn(T.TB, 180), 'red and blue blocks take turns');
  let both = 0, none = 0; for (let t = 0; t < C.TOG; t++) { const a = PJ.togOn(T.TA, t), b = PJ.togOn(T.TB, t); if (a && b) both++; if (!a && !b) none++; }
  ok(both > 0 && none === 0, 'red and blue overlap briefly when they swap, never both open');
  const Lt = mk([' P', '###AAA###', '###   ###']), st = PJ.newRun(Lt);
  st.t = C.TOG_ON - 60; run(Lt, st, 26, { h: 1 }); run(Lt, st, 8, { h: 0 }); const onIt = st.ground; run(Lt, st, 80, { h: 0 });
  ok(onIt && st.dead, 'standing on red blocks when they vanish drops you');
  // timed spikes
  ok(PJ.tspOn(T.TS, 0) && !PJ.tspOn(T.TS, C.TSP_ON) && !PJ.tspOn(T.TS2, 0), 'timed spikes alternate');
  const Ls = mk([' P  t', '#########', '#########']);
  const sOff = PJ.newRun(Ls); sOff.t = C.TSP_ON; run(Ls, sOff, 40, { h: 1 }); ok(!sOff.dead, 'retracted spikes are safe');
  const sOn = PJ.newRun(Ls); sOn.t = 0; run(Ls, sOn, 30, { h: 1 }); ok(sOn.dead, 'raised spikes kill');
  // conveyors
  const Lv = mk([' P', '##<<<<<<<<##', '############']), sv = PJ.newRun(Lv); run(Lv, sv, 15, { h: 1 }); const xv = sv.x; run(Lv, sv, 30, { h: 1 });
  const Lf = mk([' P', '##>>>>>>>>##', '############']), sf = PJ.newRun(Lf); run(Lf, sf, 15, { h: 1 }); const xf = sf.x; run(Lf, sf, 30, { h: 1 });
  ok(Math.abs((sv.x - xv) - (C.RUN - C.CONV) / 2) < 0.05 && Math.abs((sf.x - xf) - Math.min(9.28 - xf, (C.RUN + C.CONV) / 2)) < 0.05, 'conveyors slow you down or speed you up');
  const Ls2 = mk(['  P', '##>>>>>>>>##', '############']), sp = PJ.newRun(Ls2); const xs0 = sp.x; run(Ls2, sp, 20, { h: 0 }); ok(sp.x > xs0 + 0.8, 'standing still on a conveyor carries you');
  // moving platform
  const Lm = mk([' P', '###        ###', '###        ###']);
  Lm.movers = [{ x0: 3.1, y0: 12, x1: 9, y1: 12, w: 2, per: 240, ph: 0 }];
  const sm = PJ.newRun(Lm); run(Lm, sm, 22, { h: 1 }); run(Lm, sm, 10, { h: 0 });
  ok(sm.ground && sm.mover === 0, 'steps onto a moving platform');
  const xm = sm.x; run(Lm, sm, 100, { h: 0 }); ok(sm.ground && sm.x > xm + 4, 'the platform carries you');
  // saws
  const Lz = flat(30); Lz.saws = [{ cx: 6, cy: 10.45, ax: 0, ay: 0, per: 120, ph: 0, r: 0.55 }];
  const sz = PJ.newRun(Lz); run(Lz, sz, 120, { h: 1 }); ok(sz.dead, 'touching a saw kills');
  const sz2 = PJ.newRun(Lz); run(Lz, sz2, 120, (i, st) => ({ h: 1, j: st.x > 3.2 && st.x < 6 })); ok(!sz2.dead, 'jumping over a saw is safe');
}
// ---- level generation ----
{
  let total = 0;
  const intro = new Set();
  for (let n = 1; n <= PJ.NLEVELS; n++) {
    const L = PJ.genLevel(n), L2 = PJ.genLevel(n);
    ok(Buffer.from(L.tiles).equals(Buffer.from(L2.tiles)) && JSON.stringify([L.movers, L.saws, L.gems, L.cps, L.springs]) === JSON.stringify([L2.movers, L2.saws, L2.gems, L2.cps, L2.springs]), 'level ' + n + ' is deterministic');
    ok(L.gems.length === 3, 'level ' + n + ' has three stars');
    ok(L.world === Math.floor((n - 1) / 20), 'level ' + n + ' world');
    ok(PJ.tileAt(L, L.spawn[0], L.spawn[1]) === T.S && PJ.tileAt(L, L.goal[0], L.goal[1]) === T.S, 'level ' + n + ' spawn and goal stand on ground');
    ok(L.cps.every(c => PJ.tileAt(L, c[0], c[1]) === T.S && PJ.tileAt(L, c[0], c[1] - 1) === T.E), 'level ' + n + ' flags stand on ground');
    ok(L.gems.every(g => g[0] > 0 && g[0] < L.w && g[1] > 0.4 && g[1] < H - 1 && PJ.tileAt(L, Math.floor(g[0]), Math.floor(g[1])) === T.E), 'level ' + n + ' stars float in open air');
    total += L.w;
    if (L.intro) intro.add(L.intro.key);
    const sol = SOL.levels[n];
    ok(sol && sol.hash === PJ.levelHash(L), 'level ' + n + ' matches the solved layout');
  }
  ok(intro.size >= 15, 'mechanics are introduced one by one: ' + intro.size);
  const w1 = PJ.genLevel(1).w, w100 = PJ.genLevel(100).w;
  ok(w100 > w1 * 2.5, 'later levels are longer: ' + w1 + ' → ' + w100);
  ok(PJ.mechsFor(1).length < PJ.mechsFor(50).length && PJ.mechsFor(50).length < PJ.mechsFor(100).length, 'new mechanics keep arriving');
}
// ---- every level is clearable: replay the stored bot solution ----
{
  let slowest = 0;
  for (let n = 1; n <= PJ.NLEVELS; n++) {
    const L = PJ.genLevel(n), sol = SOL.levels[n];
    if (!sol) { ok(false, 'level ' + n + ' has a solution'); continue; }
    const codes = []; for (const p of sol.inputs.split('.')) { if (!p) continue; const c = +p[0], k = parseInt(p.slice(1), 36); for (let i = 0; i < k; i++) codes.push(c); }
    const s = PJ.newRun(L); let held = false;
    for (const c of codes) { const j = !!(c & 1); PJ.step(L, s, { h: (c >> 1) - 1, j, jp: j && !held }, null); held = j; if (s.dead || s.won) break; }
    ok(s.won && !s.dead && s.deaths === 0, 'level ' + n + ' cleared by the stored solution in ' + (s.ticks / 60).toFixed(1) + ' s');
    slowest = Math.max(slowest, s.ticks);
  }
  ok(slowest < 60 * 120, 'every level can be cleared in under 2 minutes');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
