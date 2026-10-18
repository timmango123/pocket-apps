// Core logic tests for 鞭炮貓老街 (bomb-maze). Loads the engine between the CORE markers of ../index.html and
// checks generation, movement with corner assist, bombs, chain reactions, power-ups, enemies, the CPU brain and
// whole-stage / whole-battle simulations. Usage: node tests.js
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
  const p1 = BM.stageParams(1), p100 = BM.stageParams(100);
  ok(p100.enemies > p1.enemies && p100.density > p1.density && p100.pool.length > p1.pool.length, 'difficulty ramps up');
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
// ---- whole stages playable by the CPU ----
{
  let won = 0;
  for (const n of [1, 2, 3, 4, 5, 8, 12, 20]) {
    const L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [true], seed: n, skill: 2, lives: 3 });
    let t = 0; while (s.status === 'play' && t < L.time + 1) { BM.tick(s, 1 / 60); t += 1 / 60; s.events.length = 0; }
    if (s.status === 'won') won++; else console.log('  note: CPU did not clear stage', n, s.status);
  }
  ok(won >= 6, 'CPU clears most early stages (' + won + '/8)');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
