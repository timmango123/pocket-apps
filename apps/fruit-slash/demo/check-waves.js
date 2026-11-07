// Checks the wave generator of 果園快刀 (fruit-slash) with the game's own core code (CORE-START/END).
// For every generated wave: (1) a single stroke through all fruits exists that misses every chestnut,
// (2) apexes sit in the top 15%-40% of the screen, (3) no t<15s chestnuts, (4) items launch from inside the screen width.
// Also prints the difficulty curve.  Usage: node check-waves.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {mulberry32,makeWave,makePineWave,waveSafe,posAt,waveInterval,waveCount,nutProb,gravity,diffLevel,baseR,KINDS,DIFF_MAX_T,cutBonus,crossCheck,strokeLine,polyDist,CUT_TOL};')();

const views = [[390, 844], [360, 780], [844, 390]];
let waves = 0, unsafe = 0, apexBad = 0, earlyNut = 0, xBad = 0, fruits = 0, nuts = 0, dropped = 0, overlap = 0, maxN = 0;
let minApex = 1, maxApex = 0;
for (const [W, H] of views) {
  const R = C.baseR(W, H);
  for (let seed = 1; seed <= 40; seed++) {
    const rng = C.mulberry32(seed * 7919);
    for (let t = 0; t <= 300; t += 0.5) {
      const special = t >= 60 && seed % 5 === 0 ? 'peach' : t >= 45 && seed % 5 === 1 ? 'ice' : null;
      const w = (t >= 30 && seed % 13 === 0) ? C.makePineWave(rng, t, W, H, R) : C.makeWave(rng, t, W, H, R, { special });
      waves++;
      if (!C.waveSafe(w)) unsafe++;
      const fr = w.items.filter(i => i.kind !== 'nut');
      fruits += fr.length; maxN = Math.max(maxN, w.items.length);
      for (const it of w.items) {
        if (it.kind === 'nut') { nuts++; if (t < 15) earlyNut++; }
        const apex = (it.y0 - it.vy * it.vy / (2 * it.g)) / H;
        minApex = Math.min(minApex, apex); maxApex = Math.max(maxApex, apex);
        if (apex < 0.15 - 1e-9 || apex > 0.40 + 1e-9) apexBad++;
        if (it.x0 < 0 || it.x0 > W) xBad++;
      }
      // no overlapping items at the formation time
      const P = w.items.map(i => C.posAt(i, w.T));
      for (let a = 0; a < P.length; a++) for (let b = a + 1; b < P.length; b++)
        if (Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]) < (w.items[a].r + w.items[b].r)) overlap++;
    }
  }
}
console.log(`Waves generated: ${waves} (3 viewports x 40 seeds x t=0..300s), fruits ${fruits}, chestnuts ${nuts}, largest wave ${maxN} items`);
console.log(`Waves with NO safe stroke through all fruits: ${unsafe}`);
console.log(`Apex outside top 15%-40%: ${apexBad}  (observed range ${(minApex * 100).toFixed(1)}%-${(maxApex * 100).toFixed(1)}%)`);
console.log(`Chestnuts before t=15s: ${earlyNut};  launch x outside screen: ${xBad};  overlapping items at formation: ${overlap}`);
console.log('\nDifficulty curve (spec 五):');
console.log('  t(s)  難度  interval(s)  fruits/wave  chestnut%  gravity(px/s², 844 tall)');
for (const t of [0, 15, 30, 45, 60, 90, 120, 180, 240]) {
  console.log(`  ${String(t).padStart(4)}  ${String(C.diffLevel(t)).padStart(3)}   ${C.waveInterval(t).toFixed(2).padStart(6)}       ${String(C.waveCount(t)).padStart(3)}        ${(C.nutProb(t) * 100).toFixed(1).padStart(5)}      ${C.gravity(t, 844).toFixed(0)}`);
}

// Cross-wave simulation: waves keep coming at the game's own interval while earlier ones are still in the air (worst
// a player who cuts each fruit 0.25 s after its wave forms; chestnuts are never cut and keep flying). Spawning works like the game (crossCheck, up to 3 re-rolls, else a 0.2 s delay).
// Check: at each accepted wave's formation time, the one-stroke line through its fruit keeps clear of every
// chestnut still flying from earlier waves, and no fruit is within radii + 40 px of an older chestnut around its formation time (0.85T-1.15T).
let xWaves = 0, xBlocked = 0, xLine = 0, xNear = 0, xReroll = 0, xDelay = 0, xNutsDropped = 0, xNuts = 0;
for (const [W, H] of views) {
  const R = C.baseR(W, H);
  for (let seed = 1; seed <= 25; seed++) {
    const rng = C.mulberry32(seed * 104729); let live = [], t = 0, timer = 0.7;
    const step = dt => { for (const o of live) { o.x += o.vx * dt; o.y += o.vy * dt + o.g * dt * dt / 2; o.vy += o.g * dt; } live = live.filter(o => !(o.vy > 0 && o.y - o.r > H + 4) && !(o.cutAt && t >= o.cutAt)); for (const o of live) o.fT = o.formAt - t; };
    while (t < 240) {
      const dt = Math.min(timer, 0.05); step(dt); t += dt; timer -= dt; if (timer > 1e-9) continue;
      let w = null;
      for (let k = 0; k < 3; k++) { const c = C.makeWave(rng, t, W, H, R, {}); const n0 = c.items.filter(i => i.kind === 'nut').length; if (C.crossCheck(c, live, H)) { w = c; xNuts += n0; xNutsDropped += n0 - c.items.filter(i => i.kind === 'nut').length; break; } xReroll++; }
      if (!w) { xDelay++; timer = 0.2; continue; }
      xWaves++; timer = C.waveInterval(t);
      const fr = w.items.filter(i => i.kind !== 'nut');
      const pts = fr.map(i => C.posAt(i, w.T)), line = C.strokeLine(pts, fr[0].r, fr[fr.length - 1].r);
      for (const o of live) if (o.kind === 'nut') {
        const q = [o.x + o.vx * w.T, o.y + o.vy * w.T + o.g * w.T * w.T / 2];
        if (q[1] < H + o.r && C.polyDist(q[0], q[1], line) < o.r + C.CUT_TOL) xLine++;
        for (const f of fr) for (let k = 0.85; k <= 1.15001; k += 0.15) { const tau = w.T * k, a = C.posAt(f, tau), b = [o.x + o.vx * tau, o.y + o.vy * tau + o.g * tau * tau / 2]; if (a[1] < H + f.r && b[1] < H + o.r && Math.hypot(a[0] - b[0], a[1] - b[1]) < f.r + o.r + 40) xNear++; }
      }
      for (const i of w.items) live.push({ kind: i.kind, x: i.x0, y: i.y0, vx: i.vx, vy: i.vy, g: i.g, r: i.r, cutAt: i.kind === 'nut' ? 0 : t + w.T + 0.25, formAt: t + w.T, fT: w.T });
    }
  }
}
console.log(`\nCross-wave simulation (3 viewports x 25 seeds x 240 s, fruit cut at T+0.25 s): ${xWaves} waves, ${xReroll} re-rolls, ${xDelay} 0.2 s delays, ${xNutsDropped}/${xNuts} new chestnuts dropped`);
console.log(`Waves whose one-stroke line hits an older chestnut: ${xLine};  fruit within radii+40 px of an older chestnut: ${xNear}`);
const ok = unsafe === 0 && apexBad === 0 && earlyNut === 0 && xBad === 0 && overlap === 0 && xLine === 0 && xNear === 0 && xDelay < xWaves * 0.1;
console.log(ok ? '\nALL WAVE CHECKS PASSED' : '\nWAVE CHECKS FAILED');
process.exit(ok ? 0 : 1);
