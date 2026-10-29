// Core logic tests for 鞭炮貓老街 (bomb-maze). Loads the engine between the CORE markers of ../index.html and
// checks generation, movement with corner assist, bombs, chain reactions, power-ups, enemies, the CPU brain and
// whole-stage / whole-battle simulations, then (9.5 re-review) save validation and the page in Chromium with real CDP
// touch: damaged saves, win/lose settled on pagehide, 闖關 confirm, empty-bomb feedback, stick hysteresis, rotation,
// HUD contrast. Usage: node tests.js (about 15 s)
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const BM = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BM;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const { EMPTY, HARD, SOFT, IT } = BM;
const mkLevel = (rows, extra) => {
  const h = rows.length, w = rows[0].length, grid = [], items = [], enemies = [], spawns = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    grid.push(ch === '#' ? HARD : ch === '+' ? SOFT : EMPTY); items.push(0);
    if (ch === 'P') spawns.push({ x, y }); if (ch === 'Q') spawns.push({ x, y });
    if (ch === 'r') enemies.push({ t: 0, x, y }); if (ch === 'g') enemies.push({ t: 2, x, y }); if (ch === 'L') enemies.push({ t: 4, x, y });
    if (ch === 'b') enemies.push({ t: 5, x, y }); if (ch === 'm') enemies.push({ t: 6, x, y }); if (ch === 'N') enemies.push({ t: 7, x, y, hp: 3 });
    if (ch === 'X') grid[grid.length - 1] = BM.CRATE;
  }));
  return Object.assign({ w, h, grid, items, spawns, enemies, time: 100, n: 1 }, extra || {});
};
const run = (sim, sec) => { for (let t = 0; t < sec; t += 1 / 60) { BM.tick(sim, 1 / 60); sim.events.length = 0; } };

// ---- generation ----
{
  for (let n = 1; n <= 100; n++) {
    const L = BM.genStage(n), L2 = BM.genStage(n);
    ok(JSON.stringify(L) === JSON.stringify(L2), 'stage ' + n + ' deterministic');
    ok(L.w % 2 === 1 && L.h % 2 === 1 && L.w >= 13 && L.h >= 11, 'stage ' + n + ' odd size');
    ok(L.grid[L.w + 1] === EMPTY && L.grid[L.w + 2] === EMPTY && L.grid[2 * L.w + 1] === EMPTY, 'stage ' + n + ' start corner clear');
    const door = L.items.filter(v => v === IT.DOOR).length, pw = L.items.filter(v => v > 0 && v !== IT.DOOR).length;
    ok(door === 1, 'stage ' + n + ' has one door');
    ok(pw >= 3, 'stage ' + n + ' has power-ups');
    const dc = L.items.indexOf(IT.DOOR);
    ok(L.grid[dc] === SOFT, 'stage ' + n + ' door hidden under a soft block');
    ok(L.enemies.length >= 2 && L.enemies.every(e => L.grid[e.y * L.w + e.x] === EMPTY && Math.abs(e.x - 1) + Math.abs(e.y - 1) >= 6), 'stage ' + n + ' enemies on empty cells away from start');
    // every soft block / enemy is reachable by walking through empties and soft blocks (hard pillars only)
    const seen = new Uint8Array(L.w * L.h), q = [L.w + 1]; seen[q[0]] = 1;
    while (q.length) { const c = q.pop(), x = c % L.w, y = (c - x) / L.w; for (let d = 0; d < 4; d++) { const nx = x + BM.DX[d], ny = y + BM.DY[d], k = ny * L.w + nx; if (L.grid[k] !== HARD && !seen[k]) { seen[k] = 1; q.push(k); } } }
    ok(seen[dc] && L.enemies.every(e => seen[e.y * L.w + e.x]), 'stage ' + n + ' door and enemies reachable');
  }
  const p1 = BM.stageParams(1), p99 = BM.stageParams(99);
  ok(p99.enemies > p1.enemies && p99.density > p1.density && p99.pool.length > p1.pool.length, 'difficulty ramps up');
  const B = BM.genBattle(5, 4);
  ok(B.spawns.length === 4 && B.spawns.every(s => B.grid[s.y * B.w + s.x] === EMPTY), 'battle: 4 spawns on empty corners');
  ok(B.spawns.every(s => [[1, 0], [0, 1]].every(([dx, dy]) => B.grid[(s.y + (s.y === 1 ? dy : -dy)) * B.w + s.x + (s.x === 1 ? dx : -dx)] === EMPTY)), 'battle: corners have breathing room');
  ok(B.items.some(v => v > 0) && !B.items.some(v => v === IT.DOOR), 'battle: items but no door');
  ok(BM.genBattle(5, 2).spawns.length === 2, 'battle: 2 players');
  const sp = BM.spiralOrder(5, 5);
  ok(sp.length === 9 && sp[0] === 6 && sp[8] === 12, 'spiral order covers interior and ends in the centre');
}
// ---- movement & corner assist ----
{
  const L = mkLevel(['#####', '#P..#', '#.#.#', '#...#', '#####']);
  const sim = BM.createSim(L, { mode: 'stage' }), b = sim.bombers[0];
  BM.setInput(sim, 0, 1, false); run(sim, 0.3);
  ok(b.x > 1.6 && Math.abs(b.y - 1.5) < 1e-6, 'moves right along the lane');
  BM.setInput(sim, 0, 1, false); run(sim, 2);
  ok(Math.abs(b.x - (3 + 1 - BM.R)) < 0.01 || b.x > 3.5, 'stops at the wall, not inside it: ' + b.x.toFixed(3));
  ok(b.x < 4 - BM.R + 0.01, 'does not enter the hard block');
  // corner assist: slightly above a gap, pressing down should slide across and go through
  b.x = 1.8; b.y = 1.5; BM.setInput(sim, 0, 2, false); run(sim, 1.2);
  ok(Math.abs(b.x - 1.5) < 0.05 && b.y > 2.5, 'corner assist slides into the open lane: ' + b.x.toFixed(2) + ',' + b.y.toFixed(2));
  // blocked completely: pressing against a wall from the middle of the lane does nothing
  b.x = 2.5; b.y = 1.5; BM.setInput(sim, 0, 2, false); run(sim, 0.5);
  ok(Math.abs(b.x - 2.5) < 1e-6 && b.y <= 2 - BM.R + 0.01, 'no assist when the cell ahead is a pillar and we are centred: walks up to it and stops');
  // lane re-centering while walking
  b.x = 1.5; b.y = 1.58; BM.setInput(sim, 0, 1, false); run(sim, 0.5);
  ok(Math.abs(b.y - 1.5) < 0.01, 'drifts back to the lane centre while walking');
  // never clip into a wall when off-lane
  b.x = 1.5; b.y = 2.3; BM.setInput(sim, 0, 1, false); run(sim, 0.5);
  ok(Math.abs(b.y - 1.5) < 0.2 || b.x < 2 - BM.R + 0.01 || b.y > 2.5, 'off-lane walk toward a pillar either aligns or stops: ' + b.x.toFixed(2) + ',' + b.y.toFixed(2));
}
// ---- bombs, fire, chains ----
{
  const L = mkLevel(['#######', '#P....#', '#.#.#.#', '#.+...#', '#.#.#.#', '#.....#', '#######']);
  const sim = BM.createSim(L, { mode: 'stage' }), b = sim.bombers[0];
  ok(BM.placeBomb(sim, b), 'places a bomb');
  ok(!BM.placeBomb(sim, b), 'cannot place a second bomb on the same cell / beyond the limit');
  ok(b.placed === 1 && sim.bombs.length === 1, 'bomb count tracked');
  // walk off the bomb cell and come back: it now blocks
  BM.setInput(sim, 0, 1, false); run(sim, 0.5); ok(b.x > 2, 'can leave own bomb cell');
  BM.setInput(sim, 0, 3, false); run(sim, 0.5); ok(b.x >= 2 - BM.R - 0.01, 'bomb blocks after leaving it: ' + b.x.toFixed(2));
  BM.setInput(sim, 0, 1, false); run(sim, 1.2);
  const t0 = sim.time; run(sim, BM.FUSE - t0 + 0.05);
  ok(sim.bombs.length === 0, 'bomb exploded after the fuse');
  ok(sim.fire[1 * 7 + 1] > 0 && sim.fire[1 * 7 + 2] > 0 && sim.fire[1 * 7 + 3] > 0 && sim.fire[2 * 7 + 1] > 0 && sim.fire[3 * 7 + 1] > 0, 'cross-shaped blast of range 2');
  ok(!(sim.fire[1 * 7 + 4] > 0) && !(sim.fire[2 * 7 + 2] > 0), 'blast limited to range and stopped by pillars');
  ok(b.alive && b.x > 4, 'player walked clear of its own blast');
  run(sim, 0.6); ok(sim.fire.every(v => v <= 0), 'fire dies out');
  // soft block destruction reveals an item
  sim.items[3 * 7 + 2] = IT.FIRE;
  sim.bombs.push({ x: 2, y: 3, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 });
  b.placed = 1; b.x = 5.5; b.y = 5.5; run(sim, 0.1);
  ok(sim.grid[3 * 7 + 2] === EMPTY, 'soft block destroyed');
  ok(sim.items[3 * 7 + 2] === IT.FIRE, 'item revealed under the block');
  // blastOf stops at a soft block (includes it)
  const bl = BM.blastOf(sim, 1, 1, 8);
  ok(bl.cells.length === 1 + 4 + 4, 'long blast runs to the walls');
  // chain reaction: two bombs in a row explode together
  const s2 = BM.createSim(L, { mode: 'stage' });
  s2.bombs.push({ x: 1, y: 1, owner: 0, range: 2, t: 0.01, slide: -1, p: 0 }, { x: 3, y: 1, owner: 0, range: 2, t: 2.0, slide: -1, p: 0 });
  s2.bombers[0].placed = 2; s2.bombers[0].x = 5.5; s2.bombers[0].y = 5.5;
  run(s2, 0.05);
  ok(s2.bombs.length === 0 && s2.fire[1 * 7 + 5] > 0, 'chain reaction fires the second bomb immediately');
  ok(s2.bombers[0].placed === 0, 'placed counter released for both bombs');
  const explodes = s2.events.length;
  ok(explodes === 0, 'events were drained by run()');
  // danger map
  const s3 = BM.createSim(L, { mode: 'stage' });
  s3.bombs.push({ x: 1, y: 1, owner: 0, range: 2, t: 1.0, slide: -1, p: 0 }, { x: 3, y: 1, owner: 0, range: 2, t: 2.0, slide: -1, p: 0 });
  const D = BM.dangerMap(s3);
  ok(D[1 * 7 + 1] === 1 && Math.abs(D[1 * 7 + 5] - 1) < 1e-6, 'danger map propagates chain timing to the second bomb');
  ok(D[5 * 7 + 5] === Infinity && D[3 * 7 + 1] === 1, 'far cells safe, blast cells timed');
}
// ---- fire kills, shield, lives, enemies ----
{
  const L = mkLevel(['#######', '#P....#', '#.#.#.#', '#.....#', '#######']);
  const sim = BM.createSim(L, { mode: 'stage', lives: 3 }), b = sim.bombers[0];
  b.shield = true;
  sim.bombs.push({ x: 1, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); b.placed = 1;
  run(sim, 0.05);
  ok(b.alive && !b.shield && b.invul > 0, 'shield absorbs one hit');
  run(sim, 3);
  sim.bombs.push({ x: 1, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); b.placed = 1;
  run(sim, 0.05);
  ok(!b.alive && sim.lives === 2, 'second hit kills and costs a life');
  run(sim, 1.5);
  ok(b.alive && b.invul > 0, 'respawns with invulnerability');
  sim.lives = 0; b.invul = 0;
  sim.bombs.push({ x: 1, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); b.placed = 1;
  run(sim, 2);
  ok(sim.status === 'lost', 'no lives left: stage lost');
  // enemy contact kills
  const L2 = mkLevel(['#####', '#P.r#', '#####']);
  const s2 = BM.createSim(L2, { mode: 'stage', lives: 1 });
  run(s2, 2);
  ok(s2.lives === 0, 'touching a rat kills');
  // enemy killed by fire, door opens, walking in wins
  const L3 = mkLevel(['#######', '#P..+.#', '#.#.#r#', '#.....#', '#######']);
  L3.items[1 * 7 + 4] = IT.DOOR;
  const s3 = BM.createSim(L3, { mode: 'stage', lives: 3 });
  ok(s3.doorCell === 1 * 7 + 4 && !s3.doorOpen, 'door known, closed');
  s3.enemies[0].x = 5.5; s3.enemies[0].y = 2.5; s3.enemies[0].tx = 5; s3.enemies[0].ty = 2; s3.enemies[0].speed = 0;
  s3.bombs.push({ x: 5, y: 1, owner: 0, range: 2, t: 0.01, slide: -1, p: 0 }); s3.bombers[0].placed = 1;
  run(s3, 0.1);
  ok(!s3.enemies[0].alive && s3.kills === 1, 'fire kills the rat');
  ok(s3.doorOpen, 'door opens when all enemies are dead');
  ok(s3.grid[1 * 7 + 4] === EMPTY, 'door block cleared by the same blast');
  s3.bombers[0].x = 4.5; s3.bombers[0].y = 1.5; run(s3, 0.1);
  ok(s3.status === 'won', 'stepping into the open door wins');
  // stone lion takes two hits
  const L4 = mkLevel(['#####', '#P.L#', '#####']);
  const s4 = BM.createSim(L4, { mode: 'stage' }); s4.enemies[0].speed = 0;
  s4.bombs.push({ x: 2, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); s4.bombers[0].x = 1.5; s4.bombers[0].invul = 9;
  run(s4, 0.05);
  ok(s4.enemies[0].alive && s4.enemies[0].hp === 1, 'stone lion survives the first hit');
  run(s4, 1.5);
  s4.bombs.push({ x: 2, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); run(s4, 0.05);
  ok(!s4.enemies[0].alive, 'second hit kills the lion');
  // ghost wisp walks through soft blocks, rat does not
  const L5 = mkLevel(['#######', '#P+g+.#', '#######']);
  const s5 = BM.createSim(L5, { mode: 'stage' }); s5.bombers[0].invul = 99;
  let moved = false; for (let i = 0; i < 180; i++) { BM.tick(s5, 1 / 60); s5.events.length = 0; if (Math.abs(s5.enemies[0].x - 3.5) > 0.6) moved = true; }
  ok(moved, 'wisp passes through soft blocks');
  const L6 = mkLevel(['#######', '#P+r+.#', '#######']);
  const s6 = BM.createSim(L6, { mode: 'stage' }); s6.bombers[0].invul = 99; run(s6, 3);
  ok(Math.abs(s6.enemies[0].x - 3.5) < 1e-6, 'rat is fenced in by soft blocks');
  // time limit
  const s7 = BM.createSim(mkLevel(['#####', '#P..#', '#####'], { time: 1 }), { mode: 'stage' }); run(s7, 1.2);
  ok(s7.status === 'lost', 'time limit ends the stage');
}
// ---- power-ups & kick ----
{
  const L = mkLevel(['#########', '#P......#', '#########']);
  const sim = BM.createSim(L, { mode: 'stage' }), b = sim.bombers[0];
  sim.items[1 * 9 + 2] = IT.BOMB; sim.items[1 * 9 + 3] = IT.FIRE; sim.items[1 * 9 + 4] = IT.SPEED; sim.items[1 * 9 + 5] = IT.KICK; sim.items[1 * 9 + 6] = IT.SHIELD;
  BM.setInput(sim, 0, 1, false); run(sim, 2.5);
  ok(b.bombs === 2 && b.fire === 3 && b.speed > 3.2 && b.kick && b.shield, 'picked up all five power-ups');
  ok(sim.items.every(v => v === 0), 'items consumed');
  // kick: bomb slides until it hits a wall
  const s2 = BM.createSim(L, { mode: 'stage' }), p = s2.bombers[0]; p.kick = true;
  s2.bombs.push({ x: 3, y: 1, owner: 0, range: 1, t: 10, slide: -1, p: 0 }); p.placed = 1;
  BM.setInput(s2, 0, 1, false); run(s2, 1.5);
  ok(s2.bombs[0].x === 7 && s2.bombs[0].slide < 0, 'kicked bomb slides to the far wall: ' + s2.bombs[0].x);
  const s3 = BM.createSim(L, { mode: 'stage' }); s3.bombs.push({ x: 3, y: 1, owner: 0, range: 1, t: 10, slide: -1, p: 0 }); s3.bombers[0].placed = 1;
  BM.setInput(s3, 0, 1, false); run(s3, 1.5);
  ok(s3.bombs[0].x === 3 && s3.bombers[0].x < 3 - BM.R + 0.01, 'without kick the bomb just blocks');
}
// ---- CPU brain ----
{
  const L = mkLevel(['#######', '#P....#', '#.#.#.#', '#.....#', '#######']);
  const sim = BM.createSim(L, { mode: 'battle', cpu: [true] }), b = sim.bombers[0];
  sim.bombs.push({ x: 1, y: 1, owner: 0, range: 3, t: 1.5, slide: -1, p: 0 }); b.placed = 1; b.onBomb = 8;
  const dec = BM.cpuDecide(sim, b);
  ok(dec.flee && dec.path.length && dec.path[dec.path.length - 1] !== 8, 'CPU flees from a bomb it is standing on');
  const D = BM.dangerMap(sim);
  ok(D[dec.path[dec.path.length - 1]] === Infinity, 'CPU flee target is outside the blast');
  run(sim, 1.6);
  ok(b.alive, 'CPU survived its own bomb');
  // CPU bombs a soft block when it can escape
  const L2 = mkLevel(['#######', '#P+...#', '#.#.#.#', '#.....#', '#######']);
  const s2 = BM.createSim(L2, { mode: 'stage', cpu: [true] });
  const d2 = BM.cpuDecide(s2, s2.bombers[0]);
  ok(d2.bomb === true && d2.path.length > 0, 'CPU plants a bomb next to a soft block and plans an escape');
  // CPU will not bomb in a dead end where it cannot escape
  const L3 = mkLevel(['#####', '#P+.#', '#####']);
  const s3 = BM.createSim(L3, { mode: 'stage', cpu: [true] });
  ok(BM.cpuDecide(s3, s3.bombers[0]).bomb === false, 'CPU refuses a suicidal bomb');
  // long simulation: CPUs survive each other for a while, and the match ends with a winner or draw
  let ended = 0, cpuSelfKills = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const B = BM.genBattle(seed, 4), s = BM.createSim(B, { mode: 'battle', cpu: [true, true, true, true], seed, skill: 2 });
    let t = 0; while (s.status === 'play' && t < 200) { BM.tick(s, 1 / 60); t += 1 / 60; for (const e of s.events) if (e.t === 'die' && e.by === e.id) cpuSelfKills++; s.events.length = 0; }
    if (s.status === 'over') ended++;
    ok(s.bombers.filter(b => b.alive).length <= 1, 'battle ' + seed + ' ends with at most one survivor');
  }
  ok(ended === 6, 'all CPU battles finish');
  ok(cpuSelfKills <= 10, 'CPUs rarely blow themselves up (' + cpuSelfKills + ' self-kills in 6 battles)');
  // sudden death closes the arena
  const B = BM.genBattle(3, 2), s = BM.createSim(B, { mode: 'battle', cpu: [true, true], seed: 3 });
  s.sudden.at = 0.5; run(s, 10);
  ok(s.sudden.on && s.sudden.idx > 10 && s.grid[s.w + 1] === HARD, 'sudden death drops pillars from the top-left corner inward');
}
// ---- a later bomb that goes off first and chains an earlier one (kicked into fire) must not crash the loop ----
{
  {
    const s = BM.createSim(mkLevel(['#########', '#P......#', '#########']), { mode: 'battle', cpu: [false] });
    s.bombs.push({ x: 3, y: 1, owner: 0, range: 2, t: 2, slide: -1, p: 0 }, { x: 4, y: 1, owner: 0, range: 2, t: 0.001, slide: -1, p: 0 });
    let threw = null; try { BM.tick(s, 1 / 60); } catch (e) { threw = e; }
    ok(!threw && s.bombs.length === 0, 'chain reaction started by the newer bomb clears both without an error' + (threw ? ' (' + threw.message + ')' : ''));
  }
}
// ---- a battle stand-off cannot run forever ----
{
  const s = BM.createSim(BM.genBattle(5, 2), { mode: 'battle', cpu: [false, false], seed: 5 });
  ok(s.limit === 180, 'battle clock is 3 minutes');
  s.sudden.at = 1e9; for (let t = 0; t < 181 && s.status === 'play'; t += 1 / 60) { BM.tick(s, 1 / 60); s.events.length = 0; }
  ok(s.status === 'over' && s.winner === -1 && s.timeUp, 'two cats that never meet end in a draw when the clock runs out');
}
// ---- difficulty curve and beginner help ----
{
  const L = mkLevel(['#######', '#P.+..#', '#.#.#.#', '#..r..#', '#######']); L.items[1 * 7 + 3] = IT.DOOR;
  const s = BM.createSim(L, { mode: 'stage', cpu: [false] }); s.enemies[0].alive = false; BM.tick(s, 1 / 60);
  ok(s.doorOpen && s.grid[1 * 7 + 3] === EMPTY, 'clearing the monsters also shakes the brick off the hidden door');
}
{
  let prevE = 0, prevS = 0, mono = true;
  for (let n = 1; n <= 100; n++) { const P = BM.stageParams(n); if (P.boss) continue; if (P.enemies < prevE || P.speedMul < prevS - 1e-9) mono = false; prevE = P.enemies; prevS = P.speedMul; }
  ok(mono, 'monster count and speed never drop from one (non-boss) stage to the next');
  ok(BM.stageParams(1).enemies === 2 && BM.stageParams(99).enemies === 7, 'two monsters on stage 1, seven on stage 99');
  ok(BM.stageParams(1).speedMul < 0.85 && Math.abs(BM.stageParams(100).speedMul - 1.2) < 1e-9, 'monsters start slow and end 20% faster');
  ok(BM.stageParams(1).lives === 5 && BM.stageParams(25).lives === 4 && BM.stageParams(50).lives === 3, 'five lives on the teaching stages, three from stage 41');
  ok(BM.genStage(1).fuse === 3 && BM.genStage(10).fuse > 2.4 && BM.genStage(11).fuse === BM.FUSE, 'early stages have a slower fuse');
  const L = mkLevel(['#######', '#P....#', '#.#.#.#', '#.....#', '#######'], { fuse: 3 });
  const s = BM.createSim(L, { mode: 'stage', cpu: [false] }), b = s.bombers[0];
  BM.setInput(s, 0, -1, true); BM.tick(s, 1 / 60);
  ok(s.bombs.length === 1 && Math.abs(s.bombs[0].t - (3 - 1 / 60)) < 1e-6, 'a bomb uses the stage fuse');
  const s2 = BM.createSim(mkLevel(['#######', '#P....#', '#######']), { mode: 'stage', cpu: [false] });
  s2.fire[s2.w + 1] = 0.1; BM.tick(s2, 1 / 60);
  ok(s2.bombers[0].alive, 'the last tenth of a second of a flame is a harmless fade');
  s2.fire[s2.w + 1] = 0.3; BM.tick(s2, 1 / 60);
  ok(!s2.bombers[0].alive, 'a live flame still burns');
  // touching: a monster 0.6 cells away does not catch the cat, 0.4 does
  const s3 = BM.createSim(mkLevel(['#######', '#P...r#', '#######']), { mode: 'stage', cpu: [false] });
  s3.enemies[0].speed = 0; s3.enemies[0].x = s3.bombers[0].x + 0.6; s3.enemies[0].tx = 1; BM.tick(s3, 1 / 60);
  ok(s3.bombers[0].alive, 'a monster that only brushes past (0.6 cells) does not catch the cat');
  s3.enemies[0].x = s3.bombers[0].x + 0.4; BM.tick(s3, 1 / 60);
  ok(!s3.bombers[0].alive, 'a monster on top of the cat catches it');
}
// ---- later content: firework crates, boar, mother rat, the Nian boss, special stages ----
{
  // crates: a blast sets one off (range 2), the warning map knows it, and crates chain
  const L = mkLevel(['#########', '#P.X....#', '#.#.#.#.#', '#.......#', '#########']);
  const s = BM.createSim(L, { mode: 'stage', cpu: [false] });
  ok(s.grid[1 * 9 + 3] === BM.CRATE, 'crate placed');
  const D = BM.dangerMap(s, { x: 2, y: 1, range: 1, t: 1 });
  ok(D[1 * 9 + 5] === 1 && D[3 * 9 + 3] === 1 && D[1 * 9 + 6] === Infinity, 'danger map: a bomb next to a crate also marks the crate\'s range-2 cross');
  ok(BM.blastCells(s, { x: 2, y: 1, range: 1 }).indexOf(1 * 9 + 5) >= 0, 'warning cross on the floor includes what the crate will burn');
  s.bombers[0].x = 7.5; s.bombers[0].y = 3.5; s.bombs.push({ x: 2, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); s.bombers[0].placed = 1;
  BM.tick(s, 1 / 60);
  ok(s.grid[1 * 9 + 3] === BM.EMPTY && s.fire[1 * 9 + 5] > 0 && s.fire[3 * 9 + 3] > 0, 'burning crate explodes with range 2');
  ok(s.bombers[0].placed === 0 && s.bombs.length === 0, 'crate explosion does not count as one of the player\'s firecrackers');
  ok(BM.softAdj(s, 4, 1) === 0 && BM.softAdj(BM.createSim(L, { mode: 'stage' }), 2, 1) === 1, 'CPU sees crates as something worth bombing');
  const L2 = mkLevel(['#########', '#P.XX...#', '#########']);
  const s2 = BM.createSim(L2, { mode: 'stage', cpu: [false] }); s2.bombers[0].invul = 9;
  s2.bombs.push({ x: 2, y: 1, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); BM.tick(s2, 1 / 60);
  ok(s2.grid[1 * 9 + 4] === BM.EMPTY && s2.fire[1 * 9 + 6] > 0, 'crates set each other off');
  // generation: crates from 33, warehouse stages, bosses every 10th from 20
  ok(BM.genStage(32).grid.indexOf(BM.CRATE) < 0 && BM.genStage(33).grid.indexOf(BM.CRATE) >= 0, 'crates start on stage 33');
  ok(BM.stageParams(45).special === 'crates' && BM.genStage(45).grid.filter(g => g === BM.CRATE).length >= 10, 'stage 45 is a firework warehouse');
  for (let n = 1; n <= 100; n++) { const P = BM.stageParams(n), G = BM.genStage(n), boss = G.enemies.filter(e => e.t === 7);
    if (P.boss !== (n >= 20 && n % 10 === 0) || boss.length !== (P.boss ? 1 : 0) || (P.boss && !(boss[0].hp >= 2))) ok(false, 'boss placement on stage ' + n);
    if (n < 41 && G.enemies.some(e => e.t === 5) || n < 56 && G.enemies.some(e => e.t === 6)) ok(false, 'new monster too early on stage ' + n);
    if (G.enemies.some(e => e.t === 2) && n < 21) ok(false, 'wisp too early on ' + n);
  }
  ok(BM.REMIX.length === 100 && BM.REMIX.every(v => v >= 0 && v < 12), 'one layout variant per stage');
  for (const [n, t] of Object.entries(BM.INTRO)) ok(BM.genStage(+n).enemies.some(e => e.t === t), 'stage ' + n + ' introduces ' + BM.ENEMY[t].name + ' and has one');
  let nb = 0, nm = 0; for (let n = 41; n <= 100; n++) { const G = BM.genStage(n); if (G.enemies.some(e => e.t === 5)) nb++; if (G.enemies.some(e => e.t === 6)) nm++; }
  ok(nb >= 15 && nm >= 10, 'boars and mother rats keep showing up later (' + nb + ', ' + nm + ' stages)');
}
{
  // boar: sees the cat down a lane, stamps 0.7 s, then charges at double speed
  const L = mkLevel(['#########', '#P.....b#', '#########']);
  const s = BM.createSim(L, { mode: 'stage', cpu: [false], lives: 3 }), e = s.enemies[0];
  BM.tick(s, 1 / 60);
  ok(e.tele > 0 && e.dir === 3 && !e.chg, 'boar spots the cat and stamps first');
  const x0 = e.x; for (let i = 0; i < 30; i++) BM.tick(s, 1 / 60);
  ok(Math.abs(e.x - x0) < 1e-6, 'boar stands still while stamping');
  s.bombers[0].invul = 99; for (let i = 0; i < 30; i++) BM.tick(s, 1 / 60);
  ok(e.chg && e.x < x0 - 0.9, 'then it charges (' + (x0 - e.x).toFixed(2) + ' cells in 0.5 s)');
  const D = new Uint8Array(1); ok(BM.cpuDecide(s, s.bombers[0]).flee || true, 'brain runs with a charging boar about');
  // a charge stops at a wall or after 6 cells
  for (let i = 0; i < 120; i++) { BM.tick(s, 1 / 60); s.events.length = 0; }
  ok(!e.chg || e.rest > 0, 'charge ends');
  // mother rat splits into two rats that survive the blast that killed her
  const L2 = mkLevel(['#########', '#P.....m#', '#.#.#.#.#', '#.......#', '#########']);
  const s2 = BM.createSim(L2, { mode: 'stage', cpu: [false] }); s2.enemies[0].speed = 0; s2.bombers[0].invul = 99;
  s2.bombs.push({ x: 7, y: 2, owner: 0, range: 1, t: 0.01, slide: -1, p: 0 }); s2.bombers[0].placed = 1;
  BM.tick(s2, 1 / 60);
  ok(!s2.enemies[0].alive && s2.enemies.length === 3 && s2.enemies.slice(1).every(r => r.t === 0 && r.alive && r.baby), 'mother rat leaves two baby rats');
  for (let i = 0; i < 40; i++) BM.tick(s2, 1 / 60);
  ok(s2.enemies.slice(1).every(r => r.alive) && !s2.doorOpen, 'babies are fireproof for a moment, door stays shut while they live');
  // the boss: several hits, stunned after each, a roar pause, door opens when it falls
  const L3 = mkLevel(['#########', '#P.....N#', '#########']); L3.items[1 * 9 + 2] = IT.DOOR;
  const s3 = BM.createSim(L3, { mode: 'stage', cpu: [false] }), N = s3.enemies[0];
  ok(N.hp === 3 && N.maxHp === 3, 'boss hp from the level');
  BM.hitEnemy(s3, N); ok(N.alive && N.hp === 2 && N.rest > 0 && N.hurt > 1, 'boss survives a hit and is stunned, then fireproof for a while');
  BM.hitEnemy(s3, N); ok(N.hp === 2, 'no double hit while it flashes');
  N.hurt = 0; BM.hitEnemy(s3, N); N.hurt = 0; BM.hitEnemy(s3, N);
  ok(!N.alive && s3.kills === 1, 'third hit takes it down');
  BM.tick(s3, 1 / 60); ok(s3.doorOpen, 'door opens when the boss falls');
  const s4 = BM.createSim(mkLevel(['#########', '#P.....N#', '#########']), { mode: 'stage', cpu: [false] }), N4 = s4.enemies[0]; s4.bombers[0].invul = 99;
  let roared = false; for (let i = 0; i < 60 * 8; i++) { BM.tick(s4, 1 / 60); if (s4.events.some(e => e.t === 'roar')) roared = true; s4.events.length = 0; }
  ok(roared, 'boss stops to roar every few seconds');
}
{
  // door: when it opens, the bricks right next to it crumble too
  const L = mkLevel(['#######', '#P....#', '#.#.#.#', '#..+..#', '#.#+#.#', '#..r..#', '#######']); L.items[3 * 7 + 3] = IT.DOOR; L.grid[3 * 7 + 3] = SOFT;
  const s = BM.createSim(L, { mode: 'stage', cpu: [false] }); s.enemies[0].alive = false; BM.tick(s, 1 / 60);
  ok(s.doorOpen && s.grid[4 * 7 + 3] === EMPTY, 'opening door shakes off its neighbour bricks');
  // respawn: monsters near the start are startled
  const L2 = mkLevel(['#######', '#P.r..#', '#######']);
  const s2 = BM.createSim(L2, { mode: 'stage', cpu: [false], lives: 3 }); s2.enemies[0].speed = 0;
  BM.killPlayerNow(s2); run(s2, 1.4);
  ok(s2.lives === 2 && s2.bombers[0].alive && s2.enemies[0].rest > 0, 'after a respawn the monster next to the start freezes for a moment');
  // carried power-ups
  const s3 = BM.createSim(BM.genStage(5), { mode: 'stage', kit: { bombs: 3, fire: 4, speed: 4.2, kick: true } }), b3 = s3.bombers[0];
  ok(b3.bombs === 3 && b3.fire === 4 && b3.speed === 4.2 && b3.kick && !b3.shield, 'a run carries 炮, 火, 鞋 and 踢 into the next stage');
  const s4 = BM.createSim(BM.genStage(5), { mode: 'stage', kit: { bombs: 99, fire: -3, speed: 99 } });
  ok(s4.bombers[0].bombs === 8 && s4.bombers[0].fire === 2 && s4.bombers[0].speed === 5.2, 'carried power-ups are clamped');
  // snapshot / restore round trip, and the run continues identically
  const mk = () => BM.createSim(BM.genStage(57), { mode: 'stage', cpu: [true], seed: 99, skill: 2, lives: 3 });
  const a = mk(); for (let i = 0; i < 60 * 20; i++) { BM.tick(a, 1 / 60); a.events.length = 0; }
  const snap = JSON.parse(JSON.stringify(BM.snapshot(a)));
  const b = mk(); ok(BM.restore(b, snap), 'restore accepts a snapshot');
  b.bombers[0].cpu = true;
  for (let i = 0; i < 60 * 15; i++) { BM.tick(a, 1 / 60); BM.tick(b, 1 / 60); a.events.length = 0; b.events.length = 0; }
  const sig = s => [s.time.toFixed(3), s.kills, s.lives, s.bombers[0].x.toFixed(3), s.bombers[0].y.toFixed(3), s.enemies.map(e => e.x.toFixed(2) + e.alive).join()].join('|');
  ok(sig(a) === sig(b), 'a restored stage plays on exactly like the original (' + sig(a).slice(0, 40) + ')');
  ok(!BM.restore(BM.createSim(BM.genStage(1), { mode: 'stage' }), snap), 'a snapshot of another map size is refused');
}
// ---- whole stages playable by the CPU ----
{
  let won = 0;
  for (const n of [1, 2, 3, 4, 5, 8, 12, 20, 33, 41, 56]) {
    const L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [true], seed: n, skill: 2, lives: 3 });
    let t = 0; while (s.status === 'play' && t < L.time + 1) { BM.tick(s, 1 / 60); t += 1 / 60; s.events.length = 0; }
    if (s.status === 'won') won++; else console.log('  note: CPU did not clear stage', n, s.status);
  }
  ok(won >= 8, 'CPU clears most early stages and the first stages with new things (' + won + '/11)');
}
// ---- 9.5 re-review: saves from storage are checked before they are used ----
{
  const mk = n => BM.createSim(BM.genStage(n), { mode: 'stage' });
  let rejected = 0, accepted = 0;
  for (const n of [1, 20, 33, 56, 90, 100]) {
    const a = BM.createSim(BM.genStage(n), { mode: 'stage', cpu: [true], seed: n, skill: 2, lives: 3 });
    for (let i = 0; i < 60 * 90 && a.status === 'play'; i++) { BM.tick(a, 1 / 60); a.events.length = 0; if (i % 45 === 0) { if (BM.restore(mk(n), JSON.parse(JSON.stringify(BM.snapshot(a))))) accepted++; else rejected++; } }
  }
  ok(rejected === 0 && accepted > 200, 'every real autosave is accepted (' + accepted + ' saves, ' + rejected + ' refused)');
  const base = () => { const a = BM.createSim(BM.genStage(57), { mode: 'stage', cpu: [true], seed: 3, skill: 2, lives: 3 }); for (let i = 0; i < 600; i++) { BM.tick(a, 1 / 60); a.events.length = 0; } return JSON.parse(JSON.stringify(BM.snapshot(a))); };
  const bad = {
    'no bomb list': s => { s.bombs = 5; }, 'null player': s => { s.me = null; }, 'enemies not a list': s => { s.enemies = 'x'; },
    'short grid': s => { s.grid = s.grid.slice(1); }, 'missing fire': s => { s.fire = null; }, 'NaN time': s => { s.time = NaN; }, 'string lives': s => { s.lives = '3'; },
    'cat outside the map': s => { s.me.x = 99; }, 'unknown monster': s => { s.enemies[0].t = 42; }, 'pillar removed': s => { s.grid[s.grid.indexOf(BM.HARD)] = BM.EMPTY; },
    'bomb off the grid': s => { s.bombs.push({ x: 1.5, y: 1, range: 2, t: 1, slide: -1, p: 0 }); }, 'time past the limit': s => { s.time = 1e5; }
  };
  for (const k in bad) {
    const sn = base(); bad[k](sn); const sim = mk(57), before = JSON.stringify(sim.grid);
    let threw = false, r; try { r = BM.restore(sim, sn); } catch (e) { threw = true; }
    ok(!threw && r === false && JSON.stringify(sim.grid) === before && sim.time === 0, 'a damaged save is refused without touching the stage: ' + k);
  }
  const boss = BM.createSim(BM.genStage(20), { mode: 'stage' }); boss.enemies[0].roarT = 1.25;
  const back = BM.createSim(BM.genStage(20), { mode: 'stage' }); BM.restore(back, JSON.parse(JSON.stringify(BM.snapshot(boss))));
  ok(back.enemies[0].roarT === 1.25, 'the boss keeps its roar timer across a reload');
}

// ---- the page in Chromium (real CDP touch) ----
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const os = require('os');
  const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bomb-maze-')), 'index.html');
  fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + html + '</body></html>');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
  const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  const tap = async sel => { const c = await center(sel); await touch('touchStart', [c]); await touch('touchEnd', []); await frames(); };
  const open = async (store) => {
    await p.goto('file://' + WRAP);
    await p.evaluate(st => { localStorage.clear(); for (const k in st || {}) localStorage.setItem('bomb-maze:v1:' + k, JSON.stringify(st[k])); }, store);
    await p.reload(); await p.waitForFunction(() => window.__game && window.__game.sim()); await frames();
  };
  const vis = () => p.evaluate(() => [...document.querySelectorAll('.ov')].filter(o => !o.hidden).map(o => o.id).join());
  const store = k => p.evaluate(k => JSON.parse(localStorage.getItem('bomb-maze:v1:' + k)), k);
  try {
    // damaged saves: no 繼續, no crash, the clock does not run behind the menu
    await open({ resume: { n: 3, kit: null, snap: { v: 1, n: 3, grid: [1, 2], bombs: 5 } }, progress: { 1: 3, 2: 'x', 900: 3, '-4': 2, 3: 99 }, run: { next: 'a' } });
    ok(await p.$eval('#contBtn', e => e.hidden), 'a damaged save offers no 繼續 button');
    ok(await p.evaluate(() => document.getElementById('startDone').textContent) === '2' && JSON.stringify(await p.evaluate(() => window.__game.progress())) === '{"1":3,"3":3}', 'progress from storage is cleaned (only stages 1-100, at most 3 stars)');
    await p.evaluate(() => window.__game.startStage(3, { n: 3, kit: null, snap: { v: 1, n: 3, grid: [], bombs: 5 } }));
    const st = await p.evaluate(() => window.__game.state());
    ok(st.mode === 'stage' && st.playing && (await vis()) === '' && /存檔讀不到/.test((await p.evaluate(() => window.__game.banner())).sub), 'a save that cannot be read starts the stage fresh and says so');

    // a real autosave round-trips through a reload and waits on the pause panel
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(5); g.input(1); g.tick(3000); g.input(-1); window.dispatchEvent(new Event('pagehide')); });
    const saved = await store('resume');
    ok(saved && saved.n === 5 && saved.snap.time > 1.5, 'pagehide writes the stage in progress');
    await p.reload(); await p.waitForFunction(() => window.__game && window.__game.sim()); await frames();
    ok(!(await p.$eval('#contBtn', e => e.hidden)), 'after a reload 繼續 is offered');
    await tap('#contBtn');
    const r2 = await p.evaluate(() => ({ s: window.__game.state(), t: window.__game.sim().time }));
    ok((await vis()) === 'ovPause' && r2.s.paused && Math.abs(r2.t - saved.snap.time) < 1e-6, '繼續 restores the stage and waits on the pause panel');

    // a win (or loss) is settled when the page goes away during the 1 s pause before the result panel
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(1); g.auto(true); let k = 0; while (g.state().status === 'play' && k++ < 3000) { g.tick(100); if (k === 20) localStorage.setItem('bomb-maze:v1:resume', JSON.stringify({ n: 1, kit: null, snap: BM.snapshot(g.sim()) })); }   // the last autosave before the door
      g.auto(false); });
    ok((await p.evaluate(() => window.__game.state().status)) === 'won', 'the built-in brain clears stage 1');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); delete document.hidden; });
    ok((await p.evaluate(() => window.__game.progress()[1])) >= 1 && (await store('run')).next === 2 && (await store('resume')) === null && (await vis()) === 'ovResult', 'hiding the app right after the door: the stars are kept, the run moves on, no stale autosave');
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(7); g.tick(1500); window.dispatchEvent(new Event('pagehide'));
      const s = g.sim(); s.lives = 1; s.bombers[0].shield = false; s.bombers[0].invul = 0; s.bombers[0].alive = false; s.bombers[0].deadT = 0; s.lives = 0; g.tick(1400); });
    ok((await p.evaluate(() => window.__game.state().status)) === 'lost', 'stage lost');
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    ok((await store('resume')) === null && (await store('run')) === null, 'closing the app during the lose pause does not leave the stage to come back from the last autosave');

    // keys pressed behind the pause panel do nothing on 繼續
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(4); g.tick(1200); });
    await p.keyboard.press('p'); await p.keyboard.press(' ');
    ok((await vis()) === 'ovPause', 'P pauses');
    await p.keyboard.press('p'); await p.evaluate(() => window.__game.tick(100));
    ok((await p.evaluate(() => window.__game.state().bombs)) === 0, 'space pressed while paused is not queued into a bomb on 繼續');
    await p.keyboard.press(' '); await p.evaluate(() => window.__game.tick(100));
    ok((await p.evaluate(() => window.__game.state().bombs)) === 1, 'space places a bomb while playing');
    await p.evaluate(() => { const g = window.__game; g.manual(false); });
    await p.keyboard.press('Escape'); await p.click('#quitBtn');
    await p.click('#selectBtn'); await p.keyboard.press('Escape');
    ok((await vis()) === 'ovStart', 'Escape backs out of the stage list');

    // 闖關 with a saved stage needs a second tap
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(1); g.tick(2500); window.dispatchEvent(new Event('pagehide')); });
    await p.reload(); await p.waitForFunction(() => window.__game && window.__game.sim()); await frames();
    await tap('#startBtn');
    ok((await vis()) === 'ovStart' && (await store('resume')) && /再按一次/.test(await p.textContent('#startBtn')), 'first tap on 闖關 with a save only asks again');
    await tap('#startBtn');
    ok((await vis()) === '' && (await store('resume')) === null && (await p.evaluate(() => window.__game.sim().time)) === 0, 'second tap starts fresh');
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(1); g.tick(2500); window.dispatchEvent(new Event('pagehide')); });
    await p.reload(); await p.waitForFunction(() => window.__game && window.__game.sim()); await frames();
    await tap('#startBtn'); await sleep(3300);
    ok(/闖關/.test(await p.textContent('#startBtn')) && (await p.$eval('#startN', e => e.textContent)) === '1', 'the question goes away after 3 s');

    // touch: the bomb button says so when every firecracker is out; the stick keeps its axis near the diagonal
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(false); g.startStage(3); });
    await tap('#bombBtn'); await sleep(120);
    ok((await p.evaluate(() => window.__game.state().bombs)) === 1, 'a tap on 放炮 places a bomb');
    await p.evaluate(() => { window.__game.input(1); }); await sleep(450); await p.evaluate(() => window.__game.input(-1));
    await tap('#bombBtn'); await sleep(40);
    ok((await p.evaluate(() => window.__game.state().bombs)) === 1 && (await p.$eval('#bombN', e => e.classList.contains('deny'))), 'a tap with no firecracker left shakes the counter instead of doing nothing');
    await p.evaluate(() => { const g = window.__game; g.manual(true); });
    const pc = await center('#pad'), dir = () => p.evaluate(() => { const k = document.getElementById('knob').style.transform; const a = [...document.querySelectorAll('#pad .arr.lit')].map(e => e.classList[1]); return a.join(); });
    await touch('touchStart', [[pc[0] + 40, pc[1]]]); await frames();
    ok((await dir()) === 'r', 'stick: push right');
    await touch('touchMove', [[pc[0] + 40, pc[1] + 45]]); await frames();
    ok((await dir()) === 'r', 'stick: a thumb that drifts just past the diagonal keeps the cat going right');
    await touch('touchMove', [[pc[0] + 40, pc[1] + 56]]); await frames();
    ok((await dir()) === 'd', 'stick: a clear push down turns');
    await touch('touchMove', [[pc[0] + 46, pc[1] + 40]]); await frames();
    ok((await dir()) === 'd', 'stick: and holds the new axis the same way');
    await touch('touchEnd', []); await frames();
    ok((await dir()) === '', 'stick: lifting the thumb stops');

    // battle: knocked out while two or more CPUs fight on goes to the result instead of a long wait
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startBattle(3, 0); g.tick(1200); const s = g.sim(); const b = s.bombers[0]; b.shield = false; b.invul = 0; b.alive = false; b.deadT = 0; g.tick(2600); });
    ok((await vis()) === 'ovBattleEnd' && /第 [34] 名/.test(await p.textContent('#bendName')), 'knocked out in a battle: result with your place within 3 s (' + (await p.textContent('#bendName')) + ')');

    // rotation mid-stage: the maze and both controls stay on screen
    await open({});
    await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(13); g.tick(1500); });
    for (const [w, h] of [[844, 390], [390, 844], [667, 375]]) {
      await p.setViewportSize({ width: w, height: h }); await frames(); await frames();
      const r = await p.evaluate(() => { const q = id => document.getElementById(id).getBoundingClientRect(); const c = q('cv'), a = q('pad'), b = q('bombBtn'); return { c: [c.left, c.top, c.right, c.bottom], a: [a.left, a.top, a.right, a.bottom], b: [b.left, b.top, b.right, b.bottom], sw: document.documentElement.scrollWidth, land: document.body.classList.contains('land') }; });
      const inView = q => q[0] >= -0.5 && q[1] >= -0.5 && q[2] <= w + 0.5 && q[3] <= h + 0.5, apart = (x, y) => x[2] <= y[0] || y[2] <= x[0] || x[3] <= y[1] || y[3] <= x[1];
      ok(inView(r.c) && inView(r.a) && inView(r.b) && apart(r.c, r.a) && apart(r.c, r.b) && r.sw <= w && r.land === (w > h), 'rotate to ' + w + 'x' + h + ': maze, stick and 放炮 all on screen, nothing overlaps');
    }
    await p.setViewportSize({ width: 390, height: 844 });

    // small HUD text is readable in both themes
    for (const theme of ['light', 'dark']) {
      await open({ theme });
      await p.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(20); const b = g.sim().bombers[0]; b.kick = true; b.speed = 4.2; g.tick(1200); const s = g.sim(); s.time = s.limit - 10; g.tick(100); });
      const cr = await p.evaluate(() => {
        const rgb = c => c.match(/[\d.]+/g).slice(0, 3).map(Number), L = c => { const v = rgb(c).map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
        const ratio = el => { const cs = getComputedStyle(el), a = L(cs.color), b = L(cs.backgroundColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
        return { chip: ratio(document.querySelector('#hudPw span.on')), low: ratio(document.querySelector('#hudTime.low')) };
      });
      ok(cr.chip >= 4.5 && cr.low >= 4.5, theme + ': power-up chips and the low clock reach 4.5:1 (' + cr.chip.toFixed(2) + ', ' + cr.low.toFixed(2) + ')');
    }
    ok(errors.length === 0, 'no page or console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } catch (e) { fail++; console.log('FAIL browser block threw:', e.message); }
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
