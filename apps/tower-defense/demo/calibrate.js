// Builds the level table LVTAB in ../index.html: [k, D, alt] per level (enemy HP x 1.03^k, displayed difficulty D, seed variant).
// Method (all on the game's own deterministic core):
//   1. A smooth "capacity" curve K(n) (the HP steps at which the game's own greedy tower planner still keeps 20 lives) and a
//      slack curve S(n) that shrinks from very forgiving (level 1) to tight (level 100). Target k = K(n) - S(n).
//   2. A level whose first seed makes the planner collapse below that target (e.g. it never meets the ant swarm with a bomb tower)
//      gets the first of 5 alternative seeds that plays regularly.
//   3. Per-level cap: k <= kcap(n) - 3, where kcap is the highest k at which the best of the 5 planner strategies keeps 20 lives
//      at k, k-1, k-2 and k-3 (or keeps 10 lives, minus 9 more steps, on levels where flyers always leak a little).
//   4. D(n) = round(n + 12*(1 - exp(-(n-1)/15))): strictly increasing, 1..112, shown on the level tiles and the HUD.
// Usage: node calibrate.js [--write]   (about 2-3 minutes on 4 cores)
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const FILE = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(FILE, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn Core;')();
const interp = (P, n) => { for (let i = 1; i < P.length; i++) if (n <= P[i][0]) { const a = P[i-1], b = P[i]; return a[1] + (b[1]-a[1])*(n-a[0])/(b[0]-a[0]); } return P[P.length-1][1]; };
const KP = [[1,88],[22,88],[50,60],[85,30],[100,25]];
const SP = [[1,60],[5,40],[10,25],[20,12],[30,8],[50,6],[75,4],[100,3]];
const SMIN = 3;
const target = n => Math.max(0, Math.round(interp(KP, n) - interp(SP, n)));
const Dof = n => Math.round(n + 12*(1 - Math.exp(-(n-1)/15)));

function play(L, P){
  const s = C.newGame(L, {}), pre = C.botPrep(L); let next = 0;
  while (s.phase !== 'won' && s.phase !== 'lost'){
    if (s.phase === 'build'){ C.botActions(s, pre, P); C.callWave(s, false); next = s.time + 2.6; }
    C.step(s);
    if (s.phase === 'wave' && s.time >= next){ C.botActions(s, pre, P); next = s.time + 2.6; }
    if (s.time > 3600) break;
  }
  return {win:s.phase === 'won', lives:s.lives};
}
function level(n, k, alt, maps){ const sd = C.altSeed(n, alt), mp = maps[alt] || (maps[alt] = C.genMap(n, sd)); return C.genLevel(n, C.bumpOf(k), sd, mp); }
const P0 = Object.assign({}, C.STRATS[0], {look:3});
function best5(L){ let b = null; for (let i = 0; i < 5; i++){ const r = play(L, Object.assign({}, C.STRATS[i], {look:3})); if (!b || (r.win && (!b.win || r.lives > b.lives))) b = r; if (b.win && b.lives >= 20) break; } return b; }
function kcapOf(n, alt, maps, lives){
  const res = {}, get = k => res[k] || (res[k] = best5(level(n, k, alt, maps))), ok = r => r.win && r.lives >= lives;
  let last = -1, fails = 0;
  for (let k = 0; k <= 120; k += 6){ const r = get(k); if (ok(r)) last = k; if (!r.win){ if (++fails >= 2) break; } else fails = 0; }
  let run = 0; for (let j = Math.max(last, 0) + 6; j >= 0; j--){ if (ok(get(j))){ if (++run >= 4) return j + 3; } else run = 0; }
  return -1;
}
function calib(n){
  const maps = {}, t = target(n);
  // 2. seed choice: the single planner must win with >= 15 lives at t, t-8 and t-16
  let alt = 0, bestAlt = 0, bestMin = -1;
  for (let a = 0; a <= 5; a++){
    let mn = 99; for (const k of [t, t-8, t-16]) if (k >= 0){ const r = play(level(n, k, a, maps), P0); mn = Math.min(mn, r.win ? r.lives : -1); }
    if (mn > bestMin){ bestMin = mn; bestAlt = a; }
    if (mn >= 15){ alt = a; break; }
    alt = bestAlt;
  }
  // 3. cap
  let cap = kcapOf(n, alt, maps, 20);
  if (cap < 15){ const c10 = kcapOf(n, alt, maps, 10); cap = Math.max(cap, c10 - 9); }
  return {n, k:Math.max(0, Math.min(t, cap - SMIN)), D:Dof(n), alt, t, cap};
}
if (process.argv[2] === '--child'){ process.on('message', m => { for (const n of m) process.send(calib(n)); process.exit(0); }); return; }
const jobs = 4, out = []; let left = jobs;
for (let j = 0; j < jobs; j++){
  const ch = fork(__filename, ['--child']);
  ch.on('message', r => out.push(r));
  ch.on('exit', () => {
    if (--left) return;
    out.sort((a, b) => a.n - b.n);
    out.forEach(r => console.log(`L${String(r.n).padStart(3)}  k ${String(r.k).padStart(2)}  (target ${r.t}, cap ${r.cap})  alt ${r.alt}  D ${r.D}`));
    const tab = out.map(r => r.alt ? [r.k, r.D, r.alt] : [r.k, r.D]);
    if (process.argv.includes('--write')){
      fs.writeFileSync(FILE, fs.readFileSync(FILE, 'utf8').replace(/var LVTAB = \[[^;]*\];/, 'var LVTAB = ' + JSON.stringify(tab) + ';'));
      console.log('LVTAB written to index.html');
    } else console.log(JSON.stringify(tab));
  });
  ch.send(Array.from({length:100}, (_, i) => i + 1).filter(n => n % jobs === j));
}
