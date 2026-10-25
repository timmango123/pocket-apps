// Browser-free mirror of bot.js for tuning the curve: same decision model, reaction delay, mistakes and tap rate,
// run directly on the engine. Usage: node tiersim.js <tier> [from] [to] [seeds]   (prints clears per level)
const fs = require('fs'), path = require('path');
const H = require('./harness');
const APP = process.env.TB_APP ? path.resolve(process.env.TB_APP) : path.resolve(__dirname, '../../../apps/tank-battle/index.html');
let SRC = fs.readFileSync(APP, 'utf8'); if (process.env.BRAINDBG) SRC = SRC.replace("return { dir: dir, fire: wantFire", "if(globalThis.BD)console.log('    brain t'+sim.time.toFixed(2),'p',p.x.toFixed(1),p.y.toFixed(1),'pd',p.dir,'dir',dir,'fire',wantFire,'sw',JSON.stringify({e:sw.enemy&&[sw.enemy.x,sw.enemy.y],ed:sw.enemyD,wd:sw.wallD,ring:sw.ring,st:sw.steel}),'cancel',cancel,'path',path.length,'en',enemies.filter(e=>Math.abs(e.x-p.x)+Math.abs(e.y-p.y)<8).map(e=>e.x.toFixed(1)+','+e.y.toFixed(1)+'d'+e.dir+' s'+(e.seeT||0).toFixed(2)).join(' '));return { dir: dir, fire: wantFire");
const TB = new Function(SRC.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TB;')();
const { MODEL } = require('./bot.js');
const { DX, DY } = TB;
// a tank right in front of ours is impossible to miss: it fills the screen and stops our tank (no reaction delay)
function contactAhead(s) {
  const p = s.tanks[0];
  for (let i = 1; i < s.tanks.length; i++) { const e = s.tanks[i]; if (!e.alive || e.spawnT > 0) continue; const ax = e.x - p.x, ay = e.y - p.y, al = DX[p.dir] * ax + DY[p.dir] * ay, cr = DX[p.dir] ? Math.abs(ay) : Math.abs(ax); if (al > 0 && al < 3.2 && cr < 1.9) return true; }
  return false;
}
function play(tier, n, seed) {
  const M = MODEL[tier], T = H.TIERS[tier], rng = H.makeRng(seed * 31 + n);
  const VARS = process.env.VARS ? JSON.parse(process.env.VARS) : {};
  let L = TB.genLevel(n, VARS[n] != null ? VARS[n] : undefined);
  if (process.env.MAPOFF) { const L2 = TB.genLevel(Math.max(1, Math.min(100, n + +process.env.MAPOFF))); L = Object.assign({}, L, { grid: L2.grid }); }
  if (process.env.PARAMS) { L = Object.assign({}, L, { params: Object.assign({}, L.params, JSON.parse(process.env.PARAMS)) }); if (L.params.total < L.queue.length) L.queue = L.queue.slice(0, L.params.total); }
  const s = TB.createSim(L, { seed });
  const hist = []; let dec = { dir: -1, fire: false }, prev = null, f = 0, nextDec = 0, holdUntil = 0, wrongUntil = 0, wrongDir = -1, lastTap = -99, pend = 0;
  const deaths = [];
  while (s.status === 'play' && s.time < 300) {
    hist.push(TB.cloneSim(s)); if (hist.length > 60) hist.shift();
    const me = s.tanks[0];
    if (process.env.BRAINDBG) globalThis.BD = Math.abs(s.time - +process.env.BRAINDBG) < 1.2;
    if (me.alive && f >= nextDec) {
      nextDec = f + M.every;
      const d = Math.max(0, Math.round(Math.max(16, rng.gauss(T.react[0], T.react[1])) / H.FRAME));
      const ob = hist[Math.max(0, hist.length - 1 - d)], lag = Math.min(d, hist.length - 1) / 60;
      if (ob.tanks[0].alive) {
        let v;
        if (M.exact) v = TB.cloneSim(s);
        else { v = TB.cloneSim(ob); v.tanks[0] = Object.assign({}, me); v.bullets = v.bullets.map(b => Object.assign({}, b, { x: b.x + DX[b.dir] * b.speed * lag, y: b.y + DY[b.dir] * b.speed * lag })).filter(b => b.x > 0 && b.y > 0 && b.x < 26 && b.y < 26); }
        if (f >= holdUntil) {
          let r;
          if (M.policy === 'plan') r = TB.planDecide(v, { prev, exact: M.exact, samples: M.samples, seed: Math.floor(rng() * 1e6) });
          else if (M.random && rng() < M.random) { r = { dir: rng.int(5) - 1, fire: rng() < 0.4, random: true }; holdUntil = f + (M.hold || 0); }
          else r = TB.brainDecide(v, Object.assign({ prev }, M.brain));
          if (!r.random) prev = r;
          dec = r;
          if (rng() < T.mistake) { wrongDir = rng.int(4); wrongUntil = f + M.every * 2; }
        }
      }
    }
    let press = 0;
    if (me.alive && !dec.fire && M.contact && contactAhead(s)) dec = Object.assign({}, dec, { fire: true });
    if (dec.fire && f - lastTap >= M.tapGap && rng() < M.fireP) { const late = Math.abs(rng.gauss(0, T.timing || 0.0001)) / H.FRAME; if (late < 1 || rng() < 0.5) { press = 1; lastTap = f; } }
    TB.setInput(s, f < wrongUntil ? wrongDir : dec.dir, false, press);
    const lost = s.livesLost; TB.tick(s, 1 / 60);
    if (process.env.DBG) for (const e of s.events) if (e.t === 'baseHit') { const o = s.tanks.find(t => t.id === e.owner), p = s.tanks[0]; console.log(`  t${s.time.toFixed(1)} BASE hit hp${e.hp} from ${o ? o.x.toFixed(1) + ',' + o.y.toFixed(1) + ' d' + o.dir + ' k' + o.kind : '?'} player ${p.alive ? p.x.toFixed(1) + ',' + p.y.toFixed(1) + ' d' + p.dir : 'dead'}`); }
    if (process.env.DBG) for (const e of s.events) if (e.t === 'die') { const o = s.tanks.find(t => t.id === e.owner); console.log(`  t${s.time.toFixed(1)} die at ${e.x.toFixed(1)},${e.y.toFixed(1)} shell ${e.bx.toFixed(1)},${e.by.toFixed(1)} d${e.bdir} from ${o ? o.x.toFixed(1) + ',' + o.y.toFixed(1) + ' k' + o.kind : '?'} input ${dec.dir}${dec.fire ? 'F' : ''} dist ${o ? (Math.abs(o.x + 1 - e.x) + Math.abs(o.y + 1 - e.y)).toFixed(1) : ''}`); }
    s.events.length = 0; f++;
    if (s.livesLost > lost) deaths.push(+s.time.toFixed(0));
  }
  return { n, won: s.status === 'won', reason: s.reason, t: +s.time.toFixed(0), lost: s.livesLost, base: s.baseHp, k: s.kills + '/' + s.total, deaths };
}
module.exports = { play, contactAhead };
if (require.main === module) {
  const tier = process.argv[2] || 'skilled', a = +process.argv[3] || 1, b = +process.argv[4] || 100, seeds = +process.argv[5] || 1;
  const list = process.env.LIST ? process.env.LIST.split(',').map(Number) : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  let won = 0, tot = 0; const per = [];
  for (const n of list) { let w = 0; for (let k = 0; k < seeds; k++) { const r = play(tier, n, 500 + k * 13); tot++; if (r.won) { won++; w++; } if (process.env.V) console.log(JSON.stringify(r)); } per.push(w); }
  console.log(tier, 'won', won + '/' + tot);
  if (!process.env.LIST) { const g = []; for (let i = 0; i < per.length; i += 10) g.push(per.slice(i, i + 10).reduce((x, y) => x + y, 0)); console.log('per 10 levels:', g.join(' ')); }
}
