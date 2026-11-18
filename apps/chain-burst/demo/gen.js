// 深海螢光 (chain-burst) level verifier, using the game's own core (CORE-START..CORE-END of ../index.html).
// Every level 1..100, full deterministic chain simulation (fixed 1/60 s steps), 24x40 tap grid:
//  - beatable: best >= target T at tap frame 0, and >= 1.5% of tap points win (1% -> 0.5% on levels 65..100; no pixel-perfect taps);
//    still beatable when tapping after 1, 2 or 3 s (frames 60/120/180: best >= T and >= 0.5% winning points)
//  - aiming matters: share of "tap straight on a random jelly" (frames 60/120/180) that clears the level
//    stays <= 0.35 on levels 21..60 and <= 0.15 after, and never moves by more than 0.25 from the level before (no spikes)
//  - levels 4..TWIN_END are really built as two facing schools (no fallback layout)
//  - the difficulty metric strictly increases level to level; new jellies first appear at BIG_LV/41/56/71/86
// Stars: the 3-star count must be reachable within the first 10 s on the 24x40 tap grid, release frames 0..600 every
// 10 frames (the same search an outside reviewer runs). Where the formula asks for more, S3CAP caps it at the best found.
// Usage: node gen.js              -> verify and print summary (exit 1 on failure)
//        node gen.js --fix        -> search SEEDFIX offsets for failing levels, then recompute S3CAP; --write patches index.html
const fs = require('fs'), path = require('path');
const APP = path.join(__dirname, '..', 'index.html');
let html = fs.readFileSync(APP, 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const core = new Function(src + '\nreturn {levelParams, difficulty, genLevel, gridSearch, newSim, simStep, runTap, SEEDFIX, S3CAP, BIG_LV, TWIN_END, FW, FH};')();
const FIX = process.argv.includes('--fix'), WRITE = process.argv.includes('--write');
const t0 = Date.now();
function share(lv) {
  let win = 0, n = 0;
  for (const f of [60, 120, 180]) {
    const s = core.newSim(lv); while (s.frame < f) { core.simStep(s); s.ev.length = 0; }
    for (const j of s.js) if (j.alive && j.k !== 5) { n++; if (core.runTap(lv, f, j.x, j.y, s) >= lv.P.T) win++; }
  }
  return win / n;
}
function check(L, prevShare) {
  const lv = core.genLevel(L), P = lv.P, r = core.gridSearch(lv, 0), why = [];
  const feas = r.grid.filter(c => c >= P.T).length / r.grid.length;
  // deep-sea levels (65+) pinch the lane at one end: the winning spot may shrink from 1% of the grid to 0.5% by level 100
  const fmin = L > 64 ? 0.01 - 0.005 * (L - 65) / 35 : 0.015;
  if (r.best < P.T || feas < fmin) why.push('frame0 best ' + r.best + '/' + P.T + ' feas ' + (feas * 100).toFixed(1) + '%');
  const late = [60, 120, 180].map(f => { const q = core.gridSearch(lv, f); return { f, best: q.best, feas: q.grid.filter(c => c >= P.T).length / q.grid.length }; });
  late.forEach(q => { if (q.best < P.T || q.feas < 0.005) why.push('frame' + q.f + ' best ' + q.best + ' feas ' + (q.feas * 100).toFixed(1) + '%'); });
  const sh = share(lv);
  if (prevShare != null && Math.abs(sh - prevShare) > 0.25) why.push('random-jelly share ' + sh.toFixed(2) + ' vs ' + prevShare.toFixed(2) + ' before');
  if (L >= 21 && L <= 60 && sh > 0.35) why.push('random-jelly share ' + sh.toFixed(2) + ' > 0.35');
  if (L > 60 && sh > 0.15) why.push('random-jelly share ' + sh.toFixed(2) + ' > 0.15');
  if (P.form === 'twin' && lv.built !== 'twin') why.push('layout fell back');
  return { L, lv, P, best: r.best, feas, late, sh, why };
}
// Two simple player models, averaged over 12 draws each (a design estimate, not a fixed-seed replay):
//  sloppy : looks ~2 s, releases ~0.65 s later where it saw the most jellies (or, half the time, on any jelly), 40 px off,
//           5 tries;  careful: looks ~1.4 s, aims for where the jellies will be (best of the 8 densest spots), 10 px off, 3 tries.
// On levels 41..100 --fix keeps, of the first few seeds that pass every check, the one whose sloppy clear rate is closest to a
// target of 0.2 on 41..60 (this model underrates sloppy wins there) and 0.25 -> 0.12 on 61..100, while the careful rate stays >= 0.7 (and the random-jelly share near a target rising
// from 0.02 to 0.06), so precision decides more as the levels go on.
function mrng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gss = r => { let u = 0; while (!u) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * r()); };
const simAt = (lv, f) => { const s = core.newSim(lv); while (s.frame < f) { core.simStep(s); s.ev.length = 0; } return s; };
function dense(s, R, n) { const o = []; for (let iy = 0; iy < 40; iy++) for (let ix = 0; ix < 24; ix++) { const x = (ix + 0.5) * core.FW / 24, y = (iy + 0.5) * core.FH / 40; let c = 0; for (const j of s.js) if (j.alive) { const dx = j.x - x, dy = j.y - y; if (dx * dx + dy * dy <= R * R) c += j.k === 5 ? -2 : 1; } o.push({ x, y, c }); } o.sort((a, b) => b.c - a.c); return o.slice(0, n); }
function player(lv, careful, L) {
  let wins = 0; const K = 12;
  for (let k = 0; k < K; k++) {
    const r = mrng(L * 7919 + k * 104729 + (careful ? 1 : 0));
    for (let t = 0, n = careful ? 3 : 5; t < n; t++) {
      const F0 = Math.max(0, Math.round((careful ? 1.4 + gss(r) * 0.3 : 2.0 + gss(r) * 0.6) * 60));
      const fr = F0 + Math.max(1, Math.round((careful ? 0.26 + gss(r) * 0.05 : 0.65 + gss(r) * 0.2) * 60));
      let x, y;
      if (careful) { const rs = simAt(lv, fr); let b = null; for (const c of dense(rs, lv.P.R, 8)) { const v = core.runTap(lv, fr, c.x, c.y, rs); if (!b || v > b.v) b = { ...c, v }; } x = b.x; y = b.y; }
      else { const seen = simAt(lv, F0); if (r() < 0.5) { const a = seen.js.filter(j => j.alive && j.k !== 5), j = a[Math.floor(r() * a.length)]; x = j.x; y = j.y; } else { const b = dense(seen, lv.P.R, 1)[0]; x = b.x; y = b.y; } }
      const f = Math.max(0, fr + Math.round(gss(r) * (careful ? 0.03 : 0.12) * 60)), sg = (careful ? 10 : 40) / 0.969;
      x += gss(r) * sg; y += gss(r) * sg;
      if (x < 0 || y < 0 || x > core.FW || y > core.FH) continue;
      if (core.runTap(lv, f, x, y) >= lv.P.T) { wins++; break; }
    }
  }
  return wins / K;
}
const sloppyTarget = L => L <= 60 ? 0.2 : 0.25 - 0.13 * (L - 61) / 39, shareTarget = L => 0.02 + 0.04 * (L - 41) / 59;
if (FIX) for (const k in core.SEEDFIX) delete core.SEEDFIX[k];
const rows = []; let prev = null, allOk = true;
for (let L = 1; L <= 100; L++) {
  let a = core.SEEDFIX[L] || 0, r, pick = null, nOk = 0;
  for (;;) {
    core.SEEDFIX[L] = a; r = check(L, prev);
    if (FIX && L >= 41 && !r.why.length) {
      const sl = player(r.lv, false, L), ca = player(r.lv, true, L), sc = Math.abs(sl - sloppyTarget(L)) + Math.max(0, 0.7 - ca) * 2 + Math.abs(r.sh - shareTarget(L));
      if (!pick || sc < pick.sc) pick = { a, sc, r, sl, ca };
      if (++nOk < 6 && a < 200) { a++; continue; }
      a = pick.a; r = pick.r; core.SEEDFIX[L] = a; r.sl = pick.sl; r.ca = pick.ca; break;
    }
    if (!r.why.length || !FIX || a > 200) { if (pick && r.why.length) { a = pick.a; r = pick.r; core.SEEDFIX[L] = a; r.sl = pick.sl; r.ca = pick.ca; } break; }
    a++;
  }
  if (!a) delete core.SEEDFIX[L];
  r.a = a; rows.push(r); prev = r.sh;
  if (r.why.length) { allOk = false; console.log('LEVEL', L, 'FAILED:', r.why.join('; ')); }
}
// three stars reachable in the first 10 s?
const s3fail = [];
if (FIX) for (const k in core.S3CAP) delete core.S3CAP[k];
for (const r of rows) {
  const lv = core.genLevel(r.L), P = lv.P;
  let best = r.best;
  for (let f = 0; f <= 600 && best < P.s3; f += 10) {
    const base = core.newSim(lv); while (base.frame < f) { core.simStep(base); base.ev.length = 0; }
    for (let gy = 0; gy < 40 && best < P.s3; gy++) for (let gx = 0; gx < 24; gx++) { const c = core.runTap(lv, f, (gx + 0.5) * core.FW / 24, (gy + 0.5) * core.FH / 40, base); if (c > best) best = c; }
  }
  r.best10 = best;
  if (best < P.s3) { if (FIX) core.S3CAP[r.L] = best; else s3fail.push(r.L + ' (3★ ' + P.s3 + ', best ' + best + ')'); }
}
let mono = true, prevRaw = 0; for (const r of rows) { if (r.P.raw <= prevRaw) mono = false; prevRaw = r.P.raw; }
const firstOf = k => rows.find(r => r.lv.jellies.some(j => j.k === k)).L;
const intro = [core.BIG_LV, 41, 56, 71, 86], introOk = [1, 2, 3, 4, 5].every((k, i) => firstOf(k) === intro[i]);
console.log('Level  N   T  3★  R(px) 難度  best  可行點擊%  隨便點一隻%');
for (const r of rows) if (r.L <= 6 || r.L % 10 === 0 || [21, 41, 56, 71, 86, 99].includes(r.L))
  console.log(String(r.L).padStart(5), String(r.P.N).padStart(3), String(r.P.T).padStart(3), String(core.genLevel(r.L).P.s3).padStart(3), r.P.R.toFixed(1).padStart(6),
    String(core.difficulty(r.L)).padStart(4), String(r.best).padStart(5), (r.feas * 100).toFixed(1).padStart(8), (r.sh * 100).toFixed(0).padStart(9));
const band = (a, b) => { const x = rows.filter(r => r.L >= a && r.L <= b); return (x.reduce((s, r) => s + r.sh, 0) / x.length * 100).toFixed(0) + '%'; };
console.log('All levels beatable at frames 0/60/120/180, shares smooth, layouts built:', allOk);
if (FIX) console.log('Model clear estimate per band (sloppy / careful):', [[41, 60], [61, 80], [81, 100]].map(([x, y]) => { const q = rows.filter(r => r.L >= x && r.L <= y && r.sl != null); return x + '-' + y + ' ' + q.reduce((s, r) => s + r.sl, 0).toFixed(1) + ' / ' + q.reduce((s, r) => s + r.ca, 0).toFixed(1); }).join(', '));
console.log('Random-jelly clear share by band: 1-20', band(1, 20), '21-40', band(21, 40), '41-60', band(41, 60), '61-80', band(61, 80), '81-100', band(81, 100),
  '| largest step', Math.max(...rows.slice(1).map((r, i) => Math.abs(r.sh - rows[i].sh))).toFixed(2));
console.log('3 stars reachable within 10 s on every level:', !s3fail.length, s3fail.join(', '));
console.log('Difficulty metric strictly increasing:', mono, '| new jellies first at', intro.join('/') + ':', introOk);
if (FIX) {
  const sf = JSON.stringify(core.SEEDFIX), sc = JSON.stringify(core.S3CAP);
  console.log('SEEDFIX =', sf); console.log('S3CAP =', sc);
  if (WRITE) {
    html = html.replace(/var SEEDFIX = \{[^}]*\};/, 'var SEEDFIX = ' + sf + ';').replace(/S3CAP = \{[^}]*\}/, 'S3CAP = ' + sc);
    fs.writeFileSync(APP, html); console.log('written to index.html');
  }
}
console.log('time', ((Date.now() - t0) / 1000).toFixed(1) + 's');
process.exit(allOk && mono && introOk && (FIX || !s3fail.length) ? 0 : 1);
