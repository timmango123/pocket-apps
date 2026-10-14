// Level builder for 石砲攻城記 (slingshot-siege).
// Picks a generator seed per level, then searches (beam search over pretraced aim groups) for the
// fewest shots that clear it, using the game's OWN core code extracted from ../index.html.
// Writes demo/solutions.json: per level seed, ammo = best + slack, star thresholds, difficulty, solution shots.
// Usage: node solve.js [--workers N] [--from a --to b]   (re-pick levels onto a D ramp: --retarget a b [a2 b2 ...] [--tol k] --from 101 --to 100)
const fs = require('fs'), path = require('path'), { fork } = require('child_process');
const APP = path.resolve(__dirname, '..', 'index.html');
function loadCore(){
  const html = fs.readFileSync(APP, 'utf8');
  const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
  return new Function(src + '\nreturn {World, genLevel, buildWorld, levelCover, levelParams, pullToVel, rng, TICK, DT, GRAV, SLING_X, SLING_Y};')();
}
const C = loadCore();
const S = require('./solver.js')(C);
const OUT = path.join(__dirname, 'solutions.json');

function stable(spec){
  const W = C.buildWorld(spec); const nb = W.bodies.length;
  W.bodies.forEach(b => { if (b.dyn) b.sleep = false; });
  for (let i = 0; i < 480; i++) W.step();
  let mv = 0; W.bodies.forEach(b => { if (b.dyn) mv = Math.max(mv, Math.hypot(b.vx, b.vy)); });
  return W.bodies.length === nb && W.gobAlive === spec.gobs.length && mv < 0.08;
}
function partialD(spec, cover){ return 0.4*spec.P.T + 0.03*spec.P.B + 4*cover; }
function width(spec){ let x1 = spec.xEnd; spec.blocks.forEach(b => x1 = Math.max(x1, b.x + b.w/2)); return x1 - spec.P.D; }
function candidatesFor(n){
  const out = [];
  for (let seed = 1; seed <= 40; seed++){
    const sp = C.genLevel(n, seed); const cv = C.levelCover(sp); const w = width(sp);
    if (w > 8 + 0.17*n) continue;
    out.push({ seed, cover: cv, err: Math.abs(cv - sp.P.cover), pd: partialD(sp, cv), w });
  }
  out.sort((a, b) => a.err - b.err || a.w - b.w);
  return out;
}

if (process.argv[2] === '--child'){
  process.on('message', job => {
    const sp = C.genLevel(job.n, job.seed);
    const t0 = Date.now();
    const r = stable(sp) ? S.solve(sp, { maxDepth: 7 }) : { ok: false, unstable: true, sims: 0 };
    // accept only if a from-scratch replay clears it with different idle times (no reliance on clone state)
    if (r.ok && ![90, 157].every(d => S.replay(sp, r.shots, { delay: d }).W.gobAlive === 0)){ r.ok = false; r.replayFail = true; }
    process.send({ n: job.n, seed: job.seed, r, secs: (Date.now() - t0)/1000 });
  });
  return;
}

function Draw(r, n){ const P = C.levelParams(n); const A = r.best + P.slack; return 0.4*P.T + 0.03*P.B + 4*r.cover + 2*(1 - P.slack/A); }
(async () => {
  const args = process.argv.slice(2);
  const nw = +(args[args.indexOf('--workers') + 1] || 3) || 3;
  const from = args.includes('--from') ? +args[args.indexOf('--from') + 1] : 1, to = args.includes('--to') ? +args[args.indexOf('--to') + 1] : 100;
  let prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { levels: [] };
  const res = prev.levels || [];
  const cands = {}, ci = {}, tried = {};
  for (let n = from; n <= to; n++){ cands[n] = candidatesFor(n); ci[n] = 0; }
  const workers = []; for (let i = 0; i < nw; i++) workers.push(fork(__filename, ['--child']));
  function runBatch(levels){
    const queue = levels.slice();
    return new Promise(resolve => {
      let active = 0;
      function next(w){
        if (!queue.length){ if (active === 0) resolve(); return; }
        const n = queue.shift(); const c = cands[n][ci[n]];
        if (!c){ console.log('LEVEL', n, 'NO CANDIDATE LEFT'); return next(w); }
        active++; w.n = n; w.c = c; w.send({ n, seed: c.seed });
      }
      workers.forEach(w => {
        w.removeAllListeners('message');
        w.on('message', m => {
          active--;
          const n = w.n, c = w.c;
          if (m.r.ok){
            res[n - 1] = { n, seed: m.seed, cover: c.cover, width: c.w, best: m.r.shots.length, score: m.r.score, shots: m.r.shots, sims: m.r.sims, rob: m.r.rob, secs: m.secs };
            console.log('L' + n, 'seed', m.seed, 'shots', m.r.shots.length, 'score', m.r.score, 'rob', m.r.rob, 'sims', m.r.sims, m.secs.toFixed(1) + 's');
            fs.writeFileSync(OUT, JSON.stringify({ levels: res }));
          } else {
            console.log('L' + n, 'seed', m.seed, m.r.unstable ? 'UNSTABLE' : (m.r.replayFail ? 'REPLAYFAIL' : 'UNSOLVED'), 'sims', m.r.sims, m.secs.toFixed(1) + 's -> next seed');
            tried[n] = tried[n] || new Set(); tried[n].add(m.seed); let k = 0; while (cands[n][k] && tried[n].has(cands[n][k].seed)) k++; ci[n] = k; queue.unshift(n);
          }
          next(w);
        });
        next(w);
      });
    });
  }
  const TOLK = args.includes('--tol') ? +args[args.indexOf('--tol') + 1] : 0.4;
  if (args.includes('--retarget')){
    // Re-pick levels strictly between anchor pairs (a b ...) so their D lies on a straight ramp between D(a) and D(b).
    // b = 101 means open-ended (only needs to exceed D(a)). The level's current seed is tried first.
    const nums = []; for (let i = args.indexOf('--retarget') + 1; i < args.length && /^\d+$/.test(args[i]); i++) nums.push(+args[i]);
    const want = {}, tol = {}, done = {}, ptr = {}, lv = [];
    for (let p = 0; p + 1 < nums.length; p += 2){
      const a = nums[p], b = nums[p+1], Da = Draw(res[a-1], a), Db = b > 100 ? Da + 0.3*(b - a) : Draw(res[b-1], b), stepD = (Db - Da)/(b - a);
      for (let n = a + 1; n < b && n <= 100; n++){ lv.push(n); want[n] = Da + stepD*(n - a); tol[n] = b > 100 ? [Da + 0.013, 1e9] : [want[n] - TOLK*stepD, want[n] + TOLK*stepD]; }
    }
    for (const n of lv){
      ptr[n] = 0; const P = C.levelParams(n), cs = [];
      for (let seed = 1; seed <= 90; seed++){
        const sp = C.genLevel(n, seed), cv = C.levelCover(sp), w = width(sp);
        if (w > 8 + 0.17*n) continue;
        let e = 1e9; for (let bb = 1; bb <= 6; bb++) e = Math.min(e, Math.abs(0.4*P.T + 0.03*P.B + 4*cv + 2*(1 - P.slack/(bb + P.slack)) - want[n]));
        if (res[n-1] && res[n-1].seed === seed) e = -1;
        cs.push({ seed, cover: cv, w, e });
      }
      cs.sort((x, y) => x.e - y.e); cands[n] = cs;
    }
    const a = Math.min(...lv) - 1, b = Math.max(...lv) + 1;
    await new Promise(resolve => {
      let active = 0;
      const pickLevel = () => { for (let n = a + 1; n < b; n++) if (!done[n] && ptr[n] < cands[n].length) return n; return 0; };
      function next(w){
        // round-robin over unfinished levels
        let n = 0, best = 1e9; for (const k of lv) if (!done[k] && ptr[k] < cands[k].length && ptr[k] < best){ best = ptr[k]; n = k; }
        if (!n){ if (active === 0) resolve(); return; }
        const c = cands[n][ptr[n]++]; active++; w.n = n; w.c = c; w.send({ n, seed: c.seed });
      }
      workers.forEach(w => {
        w.removeAllListeners('message');
        w.on('message', m => {
          active--; const n = w.n, c = w.c;
          if (m.r.ok && !done[n]){
            const r = { n, seed: m.seed, cover: c.cover, width: c.w, best: m.r.shots.length, score: m.r.score, shots: m.r.shots, sims: m.r.sims, rob: m.r.rob, secs: m.secs };
            const d = Draw(r, n);
            console.log('L' + n, 'seed', m.seed, 'D', d.toFixed(3), 'want', want[n].toFixed(3));
            if (d > tol[n][0] && d < tol[n][1]){ res[n-1] = r; done[n] = true; fs.writeFileSync(OUT, JSON.stringify({ levels: res })); console.log('  ACCEPT L' + n); }
          }
          next(w);
        });
        next(w);
      });
    });
    for (const n of lv) if (!done[n]) console.log('RETARGET FAILED L' + n);
  }
  const todo = []; for (let n = from; n <= to; n++) if (!res[n-1] || args.includes('--fresh')) todo.push(n);
  await runBatch(todo);
  // enforce strictly increasing difficulty metric
  for (let round = 0; round < 40; round++){
    const bad = [];
    for (let n = Math.max(2, from); n <= to; n++){
      if (!res[n-1] || !res[n-2]) continue;
      if (Draw(res[n-1], n) <= Draw(res[n-2], n-1) + 0.005 && bad.indexOf(n - 1) < 0) bad.push(n);
    }
    console.log('round', round, 'monotonic violations:', bad.join(',') || 'none');
    if (!bad.length) break;
    bad.forEach(n => {
      const P = C.levelParams(n), prevD = Draw(res[n-2], n-1);
      tried[n] = tried[n] || new Set([cands[n][ci[n]] && cands[n][ci[n]].seed]);
      let pick = -1, pickD = 1e9, alt = -1, altD = -1;
      cands[n].forEach((c, k) => {
        if (tried[n].has(c.seed)) return;
        const pd = 0.4*P.T + 0.03*P.B + 4*c.cover + 2*(1 - P.slack/(res[n-1].best + P.slack));
        if (pd > prevD + 0.005 && pd < pickD){ pickD = pd; pick = k; }
        if (pd > altD){ altD = pd; alt = k; }
      });
      ci[n] = pick >= 0 ? pick : (alt >= 0 ? alt : cands[n].length);
      if (cands[n][ci[n]]) tried[n].add(cands[n][ci[n]].seed);
    });
    await runBatch(bad);
  }
  workers.forEach(w => w.kill());
  // finalize: ammo, stars, normalized difficulty
  const D = res.map((r, i) => Draw(r, i + 1)), mn = Math.min(...D), mx = Math.max(...D);
  res.forEach((r, i) => { const P = C.levelParams(i + 1); r.ammo = r.best + P.slack; r.Draw = +D[i].toFixed(4);
    const tot = r.score + P.slack*10000; r.stars = [Math.round(tot*0.6), Math.round(tot*0.8), Math.round(tot*0.95)];
    r.diff = +(1 + 9*(D[i] - mn)/(mx - mn)).toFixed(2); });
  fs.writeFileSync(OUT, JSON.stringify({ levels: res }));
  console.log('done; levels', res.filter(Boolean).length);
})();
