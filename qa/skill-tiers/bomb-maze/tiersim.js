// Offline mirror of bot.js playRun (no browser, no touch noise): same decision models, reaction delay, mistakes and
// bomb timing error, played straight in the engine. Used to tune the curve quickly; the reported tables come from bot.js.
// node tiersim.js <tier> <levels csv> [seeds]
const H = require('./harness');
const { BM, MODEL, decide, dirToward } = require('./bot');
const tier = process.argv[2], levels = process.argv[3].split(',').map(Number), seeds = +(process.argv[4] || 3);
const T = H.TIERS[tier], M = MODEL[tier], FR = 1000 / 60;
const snap = s => ({ st: s.status, mode: s.mode, fuse: s.fuse, time: s.time, limit: s.limit, kills: s.kills, doorOpen: s.doorOpen, doorCell: s.doorCell, w: s.w, h: s.h, grid: s.grid.slice(), items: s.items.slice(), fire: Array.from(s.fire),
  bombs: s.bombs.map(b => Object.assign({}, b)), bombers: s.bombers.map(b => Object.assign({}, b, { plan: null })), enemies: s.enemies.map(e => Object.assign({}, e)), sudden: null, cpuSkill: s.skill });
function mk(o, rng) { return { w: o.w, h: o.h, fuse: o.fuse, time: o.time, limit: o.limit, kills: o.kills, mode: o.mode, grid: o.grid, items: o.items, fire: Float32Array.from(o.fire), bombs: o.bombs, bombers: o.bombers, enemies: o.enemies, doorOpen: o.doorOpen, doorCell: o.doorCell, rng, sudden: null }; }
function play(n, seed) {
  const rng = H.makeRng(seed), L = BM.genStage(n), s = BM.createSim(L, { mode: 'stage', cpu: [false], seed: n * 31 + 7 + seed, lives: +(process.env.LIVES || BM.stageParams(n).lives) });
  const stepN = M.step || (M.every <= 3 ? (M.every === 1 ? 2 : 3) : (M.every <= 5 ? 4 : 6));
  const buf = []; let frame = 0, nextDec = 0, plan = null, wrongDir = -1, wrongUntil = 0, pendingBomb = null, lastDecCell = -1, lastBombKey = '', lastDecFrame = -999, held = -1;
  const me = s.bombers[0]; const why = [];
  while (s.status === 'play' && frame < (L.time + 5) * 60) {
    for (let k = 0; k < stepN; k++) { BM.setInput(s, 0, held, pendingBomb === -2); if (pendingBomb === -2) pendingBomb = null; BM.stepOnce(s, 1 / 60); for (const e of s.events) if (e.t === 'die') { why.push(e.by == null ? 'contact' : 'fire'); if (process.env.DBG && why.length === +(process.env.DBG)) { console.log(LOG.slice(-30).join('\n')); console.log('DIED', e.by, s.time.toFixed(2)); } } s.events.length = 0; frame++; }
    const o = snap(s); buf.push(o); if (buf.length > 80) buf.shift();
    if (!me.alive) { held = -1; plan = null; continue; }
    const cellNow = Math.floor(me.x) + Math.floor(me.y) * s.w;
    const atC = Math.abs(me.x - Math.floor(me.x) - 0.5) < 0.08 && Math.abs(me.y - Math.floor(me.y) - 0.5) < 0.08;
    const bombKey = o.bombs.map(b => b.x + ',' + b.y).join('|') + '/' + o.fire.filter(v => v > 0).length;
    const monsterNear = o.enemies.some(e => e.alive && Math.abs(e.x - me.x) + Math.abs(e.y - me.y) < 2.2);
    const need = !plan || (atC && cellNow !== lastDecCell) || bombKey !== lastBombKey || (!plan.path.length && atC) || frame - lastDecFrame > 60 || (monsterNear && frame - lastDecFrame > M.every * 2);
    if ((need || M.policy === 'look') && frame >= nextDec) {
      nextDec = frame + M.every; lastDecCell = cellNow; lastBombKey = bombKey; lastDecFrame = frame;
      const react = Math.max(16, rng.gauss(T.react[0], T.react[1]));
      const d = Math.max(1, Math.round(react / FR / stepN)); const ob = buf[Math.max(0, buf.length - d)];
      const sv = mk(Object.assign({}, ob, { bombs: ob.bombs.concat(o.bombs.filter(x => x.owner === 0 && !ob.bombs.some(y => y.x === x.x && y.y === x.y))) }), rng);
      const b = Object.assign({}, ob.bombers[0], { x: me.x, y: me.y, placed: me.placed, onBomb: me.onBomb, alive: true });
      plan = decide(M, sv, b, rng);
      if (rng() < T.mistake) { wrongDir = rng.int(4); wrongUntil = frame + M.every; }
      if (plan.bomb || (M.fat && rng() < M.fat)) pendingBomb = frame + Math.round(Math.abs(T.timing ? rng.gauss(0, T.timing) : 0) / FR);
    }
    if (pendingBomb != null && pendingBomb >= 0 && frame >= pendingBomb) pendingBomb = -2;
    let want = -1;
    if (frame < wrongUntil) want = wrongDir;
    else if (plan && plan.path.length) {
      const tol = Math.max(0.08, me.speed * stepN / 60 * 0.55);
      while (plan.path.length && dirToward(me, plan.path[0], s.w, tol) < 0) plan.path.shift();   // tol covers half a look-to-look move, so the thumb never overshoots back and forth
      if (plan.path.length) want = dirToward(me, plan.path[0], s.w, 0.03);
    }
    held = want;
    if (process.env.DBG) LOG.push(`t${s.time.toFixed(2)} p${me.x.toFixed(2)},${me.y.toFixed(2)} want${want} plan${plan ? JSON.stringify(plan.path.map(c => [c % s.w, Math.floor(c / s.w)])) + (plan.bomb ? 'B' : '') + (plan.flee ? 'F' : '') + (plan.random ? 'R' : '') : ''} bombs${s.bombs.map(b => b.x + ',' + b.y + '@' + b.t.toFixed(2)).join(' ')} wrong${frame < wrongUntil}`);
  }
  return { won: s.status === 'won', t: Math.round(s.time), why };
}
const LOG = [];
const out = [];
for (const n of levels) { let w = 0; const ws = []; for (let sd = 1; sd <= seeds; sd++) { const r = play(n, sd * 101 + (+process.env.SO || 0)); if (r.won) w++; ws.push(r.won ? 'W' + r.t : r.why.map(x => x[0]).join('')); } out.push(`L${n}:${w}/${seeds}(${ws.join(' ')})`); }
console.log(tier, out.join('  '));
