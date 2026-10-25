// Core logic tests for 坦克大戰 (tank-battle). Loads the engine between the CORE markers of ../index.html and checks
// level generation (100 deterministic, valid maps), tank movement and lane snapping, collisions, shells vs bricks /
// steel / water / base, shell clashes, power-ups, enemy waves, scoring, win/lose and the built-in brain.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const TB = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TB;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const { N, E, BRICK, STEEL, WATER, TREE, ICE, BASE } = TB;
const hush = s => { s.spawnT = 1e9; return s; };
const run = (sim, sec, fn) => { for (let t = 0; t < sec - 1e-9; t += 1 / 60) { TB.tick(sim, 1 / 60); if (fn) fn(sim); sim.events.length = 0; } };
// a blank test arena: base and ring only, no enemies queued unless given
function arena(rows, queue, extra) {
  const g = new Uint8Array(N * N);
  TB.RING.forEach(c => g[c] = BRICK);
  for (let y = 24; y <= 25; y++) for (let x = 12; x <= 13; x++) g[y * N + x] = BASE;
  (rows || []).forEach(([x, y, w, h, v]) => { for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g[yy * N + xx] = v; });
  return Object.assign({ n: 1, grid: g, queue: queue || [{ kind: 0, carrier: false }], params: TB.levelParams(1) }, extra || {});
}
function enemy(sim, kind, x, y, dir) {
  const t = { id: sim.nextId++, side: 1, kind, x, y, dir, hp: TB.KIND[kind].hp, maxHp: TB.KIND[kind].hp, alive: true, spawnT: 0, shield: 0, cool: 0, power: 0, carrier: false, moving: false, slide: 0, blockT: 0, turnT: 99, fireT: 99, aimT: 99, hold: 0, tread: 0, flash: 0 };
  sim.tanks.push(t); return t;
}

// ---- generation ----
{
  const seen = new Set();
  for (let n = 1; n <= 100; n++) {
    const L = TB.genLevel(n), L2 = TB.genLevel(n);
    ok(Buffer.from(L.grid).equals(Buffer.from(L2.grid)) && JSON.stringify(L.queue) === JSON.stringify(L2.queue), 'level ' + n + ' deterministic');
    ok(TB.validMap(L.grid), 'level ' + n + ' valid map (spawns and base reachable)');
    const g = L.grid;
    ok(g[24 * N + 12] === BASE && g[25 * N + 13] === BASE && TB.RING.every(c => g[c] === BRICK), 'level ' + n + ' base with full brick ring');
    // spawns free
    ok(TB.E_SPAWN.concat([TB.P_SPAWN]).every(s => [0, 1].every(dy => [0, 1].every(dx => g[(s.y + dy) * N + s.x + dx] === E))), 'level ' + n + ' spawn points clear');
    // left/right mirror
    let mir = true; for (let y = 0; y < N; y++) for (let x = 0; x < 13; x++) if (g[y * N + x] !== g[y * N + 25 - x]) mir = false;
    ok(mir, 'level ' + n + ' mirrored');
    const P = L.params;
    ok(L.queue.length === P.total + (P.boss ? 1 : 0) && L.queue.filter(q => q.carrier).length >= 2, 'level ' + n + ' queue size and carriers');
    ok(!P.boss || L.queue[L.queue.length - 1].kind === 4, 'level ' + n + ' boss comes last');
    seen.add(Buffer.from(g).toString('base64'));
    const ch = Math.floor((n - 1) / 10);
    ok(P.chapter === ch && TB.CHAPTERS[ch].name, 'level ' + n + ' chapter');
  }
  ok(seen.size === 100, 'all 100 maps differ (' + seen.size + ')');
  const p1 = TB.levelParams(1), p50 = TB.levelParams(50), p100 = TB.levelParams(100);
  ok(p1.total < p50.total && p50.total <= p100.total && p1.field < p100.field && p1.aggr < p100.aggr && p1.fireMin > p100.fireMin, 'difficulty ramps up');
  for (let n = 2; n <= 100; n++) { const a = TB.levelParams(n - 1), b = TB.levelParams(n); if (b.total + (b.boss ? 2 : 0) < a.total + (a.boss ? 2 : 0) || b.field < a.field || b.aggr < a.aggr - 1e-9) { ok(false, 'monotone difficulty at ' + n); break; } }
  ok([25, 50, 75, 100].every(n => TB.levelParams(n).boss) && !TB.levelParams(24).boss, 'boss levels every 25');
  // water / steel / tree / ice appear in their chapters
  const has = (a, b, v) => { for (let n = a; n <= b; n++) if (TB.genLevel(n).grid.includes(v)) return true; return false; };
  ok(has(11, 20, WATER) && has(21, 30, TREE) && has(31, 40, ICE) && has(41, 50, STEEL), 'chapter terrain shows up');
}
// ---- movement ----
{
  const sim = hush(TB.createSim(arena([[4, 10, 2, 2, BRICK], [10, 14, 4, 2, WATER]]), { seed: 1 }));
  const p = TB.player(sim); p.x = 4; p.y = 16; p.dir = 0;
  TB.setInput(sim, 0, false, 0); run(sim, 2);
  ok(Math.abs(p.y - 12) < 1e-6 && p.x === 4, 'drives up and stops flush under a brick block: y=' + p.y.toFixed(3));
  TB.setInput(sim, 1, false, 0); run(sim, 0.4);
  ok(p.x > 5.5 && Math.abs(p.y - 12) < 1e-9, 'turns and drives right');
  // lane snapping: at y=12.4 turning up snaps x, turning sideways snaps y
  p.x = 7.4; p.y = 18; p.dir = 1; TB.setInput(sim, 0, false, 0); run(sim, 1 / 60);
  ok(p.x === 7 && p.dir === 0, 'turning snaps to the half-tile lane (x=' + p.x + ')');
  // water blocks
  p.x = 11; p.y = 20; p.dir = 0; TB.setInput(sim, 0, false, 0); run(sim, 2);
  ok(Math.abs(p.y - 16) < 1e-6, 'water stops tanks: y=' + p.y.toFixed(3));
  // edges
  p.x = 1; p.y = 5; TB.setInput(sim, 3, false, 0); run(sim, 1);
  ok(p.x === 0, 'map edge stops tanks');
  // tanks block tanks
  const e = enemy(sim, 0, 6, 5, 3); sim.params = Object.assign({}, sim.params, { speedMul: 0 });
  p.x = 0; p.y = 5; TB.setInput(sim, 1, false, 0); run(sim, 1);
  ok(Math.abs(p.x - 4) < 1e-6, 'tanks block each other: x=' + p.x.toFixed(3));
  // releasing the stick stops; ice slides a bit
  const s2 = hush(TB.createSim(arena([[0, 4, 26, 6, ICE]]), { seed: 1 })); const q = TB.player(s2); q.x = 2; q.y = 6; q.dir = 1;
  TB.setInput(s2, 1, false, 0); run(s2, 0.5); const x0 = q.x; TB.setInput(s2, -1, false, 0); run(s2, 0.6);
  ok(q.x > x0 + 0.5, 'the tank slides on ice after letting go (' + (q.x - x0).toFixed(2) + ')');
  const s3 = hush(TB.createSim(arena(), { seed: 1 })); const r = TB.player(s3); r.x = 2; r.y = 6; r.dir = 1;
  TB.setInput(s3, 1, false, 0); run(s3, 0.5); const x1 = r.x; TB.setInput(s3, -1, false, 0); run(s3, 0.5);
  ok(r.x === x1, 'releasing the stick stops at once on dirt');
}
// ---- shells ----
{
  const sim = hush(TB.createSim(arena([[4, 4, 2, 2, BRICK], [10, 4, 2, 2, STEEL], [16, 2, 4, 2, WATER]]), { seed: 1 }));
  const p = TB.player(sim); p.x = 4; p.y = 12; p.dir = 0;
  TB.setInput(sim, -1, false, 1); run(sim, 1);
  ok(sim.grid[5 * N + 4] === E && sim.grid[5 * N + 5] === E && sim.grid[4 * N + 4] === BRICK, 'a shell knocks out one row of a brick block (both halves of its line)');
  TB.setInput(sim, -1, false, 1); run(sim, 1);
  ok(sim.grid[4 * N + 4] === E, 'a second shell clears the next row');
  p.x = 10; TB.setInput(sim, -1, false, 1); run(sim, 1);
  ok(sim.grid[5 * N + 10] === STEEL, 'steel stops normal shells');
  p.power = 3; TB.setInput(sim, -1, false, 1); run(sim, 1);
  ok(sim.grid[5 * N + 10] === E && sim.grid[4 * N + 10] === E, 'three-star shells break steel (two rows deep)');
  p.x = 16; p.y = 12; p.power = 0; sim.bullets = [];
  TB.setInput(sim, -1, false, 1); run(sim, 1 / 60);
  const b = sim.bullets[0]; ok(b && b.side === 0, 'shell fired');
  run(sim, 1.2); ok(sim.bullets.length === 0 && sim.grid[2 * N + 16] === WATER, 'shells fly over water');
  // player shells never hurt the eagle, enemy shells do (3 hits)
  const s2 = hush(TB.createSim(arena(null, null, { params: TB.levelParams(30) }), { seed: 1 })); s2.grid.fill(0); TB.RING.forEach(c => s2.grid[c] = E); for (let y = 24; y <= 25; y++) for (let x = 12; x <= 13; x++) s2.grid[y * N + x] = BASE;
  const pp = TB.player(s2); pp.x = 12; pp.y = 16; pp.dir = 2; TB.setInput(s2, -1, false, 1); run(s2, 1);
  ok(s2.baseHp === s2.baseMax, 'own shells do not damage the base');
  pp.x = 0; pp.y = 2; const e = enemy(s2, 0, 12, 16, 2);
  for (let i = 0; i < 3; i++) { TB.fire(s2, e); run(s2, 0.8); }
  ok(s2.baseHp === 0 && s2.status === 'lost' && s2.reason === 'base', 'three enemy hits destroy the base and lose the level');
  ok(TB.createSim(TB.genLevel(1), { seed: 1 }).baseMax === 5 && TB.createSim(TB.genLevel(10), { seed: 1 }).baseMax === 4 && TB.createSim(TB.genLevel(15), { seed: 1 }).baseMax === 3, 'the eagle is sturdier in the first levels (5, 4, then 3 hits)');
}
// ---- hits, clashes, armour, carriers, items ----
{
  const sim = hush(TB.createSim(arena(), { seed: 2 })); sim.queue = [{ kind: 0, carrier: false }]; sim.spawnT = 99;
  const p = TB.player(sim); p.x = 10; p.y = 14; p.dir = 0; p.shield = 0;
  const e = enemy(sim, 3, 10, 2, 2); sim.params = Object.assign({}, sim.params, { speedMul: 0.0001 });
  for (let i = 0; i < 3; i++) { TB.setInput(sim, -1, false, 1); run(sim, 0.9); }
  ok(e.alive && e.hp === 1, 'heavy tank takes four hits (hp ' + e.hp + ')');
  TB.setInput(sim, -1, false, 1); run(sim, 0.9);
  ok(!e.alive && sim.kills === 1 && sim.score === 400, 'heavy tank destroyed for 400 points');
  // clash: shells meeting head-on cancel
  const e2 = enemy(sim, 0, 10, 2, 2); TB.fire(sim, e2); TB.setInput(sim, -1, false, 1); run(sim, 1 / 60); TB.setInput(sim, -1, false, 0);
  let clash = 0; run(sim, 0.8, s => { clash += s.events.filter(x => x.t === 'clash').length; });
  ok(clash === 1 && p.alive, 'shells meeting head-on cancel out');
  // shield
  const e3 = enemy(sim, 0, 4, 14, 1); p.shield = 2; TB.fire(sim, e3); run(sim, 0.6);
  ok(p.alive, 'shield stops enemy shells');
  // death and respawn
  p.shield = 0; TB.fire(sim, e3); run(sim, 0.6);
  ok(!TB.player(sim).alive && sim.lives === 2 && sim.livesLost === 1, 'enemy shell destroys the tank');
  run(sim, 1.6);
  const np = TB.player(sim); ok(np.alive && np.x === TB.P_SPAWN.x && np.y === TB.P_SPAWN.y && np.shield > 0, 'respawn at the start with a shield');
  // carrier drops an item; items work
  const s2 = hush(TB.createSim(arena(), { seed: 3 })); s2.spawnT = 99; s2.queue = [{ kind: 0 }];
  const c = enemy(s2, 3, 10, 2, 2); c.carrier = true; const q = TB.player(s2); q.x = 10; q.y = 14; q.dir = 0;
  TB.setInput(s2, -1, false, 1); run(s2, 1.0);
  ok(s2.item && TB.ITEMS.includes(s2.item.type) && c.alive && !c.carrier, 'hitting a flashing tank drops a power-up');
  const apply = (type) => { const st = hush(TB.createSim(arena(), { seed: 4 })); st.spawnT = 99; st.queue = [{ kind: 0 }]; for (let i = 0; i < 3; i++) enemy(st, 0, 2 + i * 6, 2, 2); TB.applyItem(st, { type, x: 0, y: 0 }); return st; };
  let st = apply('star'); ok(TB.player(st).power === 1, 'star upgrades the gun');
  st = apply('helmet'); ok(TB.player(st).shield >= 10, 'helmet gives a shield');
  st = apply('shovel'); ok(TB.RING.every(k => st.grid[k] === STEEL), 'shovel turns the ring to steel');
  run(st, 18.2); ok(TB.RING.every(k => st.grid[k] === BRICK), '...and back to (repaired) bricks after 18 s');
  st = apply('grenade'); ok(st.tanks.slice(1).every(t => !t.alive) && st.kills === 3, 'grenade destroys every enemy on the field');
  st = apply('clock'); const fz = st.tanks[1], fx = fz.x, fy = fz.y; fz.turnT = 0; fz.fireT = 0; const nb = st.bullets.length; run(st, 3);
  ok(fz.x === fx && fz.y === fy && st.bullets.length === nb, 'clock freezes enemies');
  st = apply('tank'); ok(st.lives === 4, 'tank gives a spare tank');
  ok(apply('star').score === 500, 'power-up worth 500 points');
}
// ---- fire input: taps queue, hold auto-fires ----
{
  const sim = hush(TB.createSim(arena(), { seed: 5 })); sim.spawnT = 99; sim.queue = [{ kind: 0 }];
  const p = TB.player(sim); p.x = 0; p.y = 4; p.dir = 1;
  let shots = 0; TB.setInput(sim, -1, false, 1); run(sim, 1 / 60, s => { shots += s.events.filter(x => x.t === 'fire').length; });
  ok(shots === 1, 'a tap fires in the same frame');
  // 8 taps per second for two seconds: every tap becomes a shell
  run(sim, 0.3); shots = 0; let f = 0;
  for (let i = 0; i < 120; i++) { TB.setInput(sim, -1, false, i % 7 === 0 ? 1 : 0); TB.tick(sim, 1 / 60); shots += sim.events.filter(x => x.t === 'fire').length; sim.events.length = 0; }
  ok(shots === 18, '8.6 taps/s: one shell per tap (' + shots + '/18)');
  shots = 0; for (let i = 0; i < 120; i++) { TB.setInput(sim, -1, true, 0); TB.tick(sim, 1 / 60); shots += sim.events.filter(x => x.t === 'fire').length; sim.events.length = 0; }
  ok(shots >= 5 && shots <= 7, 'holding fire auto-fires about 3 shells per second (' + shots + ')');
}
// ---- waves, win and stars ----
{
  const sim = TB.createSim(TB.genLevel(1), { seed: 7 });
  ok(sim.queue.length === 6 && TB.remaining(sim) === 6, 'level 1 has 6 enemies');
  let maxField = 0; run(sim, 30, s => { maxField = Math.max(maxField, s.tanks.filter((t, i) => i && t.alive).length); TB.player(s).shield = 9; s.baseHp = 3; });
  ok(maxField <= sim.params.field && maxField >= 2, 'never more enemies on the field than allowed (' + maxField + ')');
  // clear by grenades
  const s2 = TB.createSim(TB.genLevel(3), { seed: 7 });
  let guard = 0; while (s2.status === 'play' && guard++ < 8000) { TB.player(s2).shield = 9; TB.tick(s2, 1 / 60); if (guard % 120 === 0) TB.applyItem(s2, { type: 'grenade', x: 0, y: 0 }); s2.events.length = 0; }
  ok(s2.status === 'won' && TB.stars(s2) === 3, 'killing every queued enemy wins with 3 stars when nothing was lost');
  s2.status = 'won'; s2.livesLost = 1; ok(TB.stars(s2) === 2, '2 stars after losing one tank'); s2.livesLost = 2; ok(TB.stars(s2) === 1, '1 star after losing two');
  // lives run out
  const s3 = hush(TB.createSim(arena(), { seed: 1, lives: 1 })); s3.spawnT = 99; s3.queue = [{ kind: 0 }]; const p3 = TB.player(s3); p3.shield = 0;
  const k = enemy(s3, 0, p3.x, p3.y - 6, 2); TB.fire(s3, k); run(s3, 1);
  ok(s3.status === 'lost' && s3.reason === 'lives', 'losing the last tank loses the level');
  // boss
  const s4 = TB.createSim(TB.genLevel(25), { seed: 1 }); ok(s4.queue[s4.queue.length - 1].kind === 4 && TB.KIND[4].hp >= 10, 'boss with lots of armour at level 25');
  // a player parked on the centre gate cannot stall the boss
  const s5 = TB.createSim(arena(null, [{ kind: 4 }]), { seed: 1 }); const p5 = TB.player(s5); p5.x = 11; p5.y = 1; p5.shield = 99;
  run(s5, 2); const b5 = s5.tanks.find(t => t.side && t.alive);
  ok(!!b5 && b5.kind === 4 && (b5.x === 0 || b5.x === 24), 'the boss uses a side gate when the centre one is blocked');
}
// ---- corner assist: half a tile off a gap slides in, a full tile off stays put ----
{
  const ends = [5, 7, 4].map(sx => { const L = arena([[0, 10, 6, 1, TB.STEEL], [8, 10, 18, 1, TB.STEEL]]); const s = hush(TB.createSim(L, { seed: 1 })); const p = TB.player(s); p.x = sx; p.y = 13; p.dir = 0; run(s, 1.5, z => TB.setInput(z, 0, false, 0)); return [p.x, p.y]; });
  ok(ends[0][0] === 6 && ends[0][1] < 9 && ends[1][0] === 6 && ends[1][1] < 9, 'pushing into a wall half a tile off a gap slides the tank into it');
  ok(ends[2][0] === 4 && ends[2][1] === 11, 'a full tile off the gap the tank stays against the wall');
}
// ---- deterministic copies (the planner relies on them) ----
{
  const a = TB.createSim(TB.genLevel(30), { seed: 11 });
  run(a, 5, s => TB.setInput(s, 0, false, 0));
  const b = TB.cloneSim(a);
  run(a, 6, s => TB.setInput(s, 1, false, 1)); run(b, 6, s => TB.setInput(s, 1, false, 1));
  ok(JSON.stringify([a.tanks, a.bullets, a.score, a.rs]) === JSON.stringify([b.tanks, b.bullets, b.score, b.rs]), 'a cloned simulation plays out exactly the same');
}
// ---- the built-in brain clears early levels ----
{
  let won = 0;
  for (const n of [1, 2, 4, 6, 9, 13]) {
    const s = TB.createSim(TB.genLevel(n), { seed: 100 + n }); let prev = null, f = 0, d = null;
    while (s.status === 'play' && s.time < 300) { if (f++ % 3 === 0) { d = TB.brainDecide(s, { prev }); prev = d; } TB.setInput(s, d.dir, false, d.fire ? 1 : 0); TB.tick(s, 1 / 60); s.events.length = 0; }
    if (s.status === 'won') won++; else console.log('  note: brain lost level', n, s.reason);
  }
  ok(won >= 5, 'brain clears early levels (' + won + '/6)');
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
