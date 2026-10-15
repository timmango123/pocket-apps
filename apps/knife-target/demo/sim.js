// Fast Node simulation of the human-like bot against the real game logic
// (the CORE block is extracted from index.html). Usage: node sim.js [file] [trials]
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'index.html'), 'utf8');
const core = src.slice(src.indexOf('/*CORE-START*/'), src.indexOf('/*CORE-END*/'));
const K = new Function(core + '; return KT;')();
const { createBot } = require('./bot.js');
const trials = +(process.argv[3] || 30);
const levels = (process.argv[4] || '1,10,20,30,40,50,60,70,75,80,90,95,99,100').split(',').map(Number);

function play(L, seed, bot) {
  const rnd = K.mulberry32(seed);
  const r = new K.Round(L);
  bot.newAttempt();
  let wall = 0, acc = 0, hitstop = 0, throwT = null, pending = [];
  for (let frame = 0; frame < 60 * 120; frame++) {
    const dtw = 1 / 60 + (rnd() - 0.5) * 0.004;
    wall += dtw;
    // deliver inputs that have arrived
    pending = pending.filter(p => { if (p <= wall) { if (r.throwKnife()) throwT = wall; return false; } return true; });
    if (hitstop > 0) hitstop -= dtw;
    else {
      acc += dtw;
      while (acc >= K.STEP) {
        acc -= K.STEP; r.step(K.STEP);
        for (const e of r.events) if (e.type === 'hit') hitstop = 0.045;
        r.events.length = 0;
        if (hitstop > 0) { acc = 0; break; }
      }
    }
    if (r.state === 'win') return { ok: true, t: wall };
    if (r.state === 'fail') { if (process.env.DBG) console.log('fail L'+L, 'wall', wall.toFixed(2), 'simT', r.motion.t.toFixed(2), 'w', r.motion.omega.toFixed(2), 'left', r.left, 'knives', r.knives.map(k=>k.a.toFixed(2)).join(','), JSON.stringify(r.motion.seg), (r.motion.t-r.motion.segStart).toFixed(2), JSON.stringify(bot.learned())); return { ok: false, t: wall, left: r.left }; }
    bot.observe({ t: wall, theta: r.motion.theta, omega: r.motion.omega, knives: r.knives.map(k => k.a), canThrow: r.canThrow(), state: r.state, throwT });
    if (bot.decide(wall)) pending.push(wall + 0.012 + rnd() * 0.025);
  }
  if (process.env.DBG) { const a=r.knives.map(k=>k.a).sort((x,y)=>x-y); const gaps=a.map((v,i)=>((i+1<a.length?a[i+1]:a[0]+K.TAU)-v).toFixed(2)); console.log('timeout L'+L,'left',r.left,'gaps',gaps.join(' '),JSON.stringify(bot.learned())); }
  return { ok: false, timeout: true };
}
let summary = [];
for (const L of levels) {
  let wins = 0, tsum = 0, to = 0, first = 0, attSum = 0, never = 0;
  for (let i = 0; i < trials; i++) {
    const bot = createBot(K);
    let a = 0, res;
    do { a++; res = play(L, 1000 + i * 77 + L + a * 13, bot); if (res.timeout) to++; } while (!res.ok && a < 12);
    if (res.ok) { wins++; tsum += res.t; attSum += a; if (a === 1) first++; } else never++;
  }
  const cfg = K.levelConfig(L);
  summary.push(`L${String(L).padStart(3)} ${cfg.type.padEnd(7)} knives=${String(cfg.knives).padStart(2)} pre=${cfg.pre.length} w0=${cfg.motion.w0.toFixed(2)}  1st-try ${(first / trials * 100).toFixed(0).padStart(3)}%  avgAttempts=${wins ? (attSum / wins).toFixed(2) : '-'} unbeaten(12)=${never}  avgT=${wins ? (tsum / wins).toFixed(1) : '-'}s timeouts=${to}`);
}
console.log(summary.join('\n'));
