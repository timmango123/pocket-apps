// Hidden-information par for 鍊金藥劑室 (color-sort): a careful player who can NOT see the hidden (?) layers.
// Each move it samples completions of the hidden layers that fit what it has seen (colour totals), plays the pour that stays
// solvable in the most samples (ties: shortest remaining solution), and replans after every reveal. When the game says the
// position is unsolvable it does what the stuck card says (undo back to before the pour that sealed it) and avoids that pour.
// The ★★★ limit of a hidden level is the median final move count of 3 such runs + 2 (as par + 2 on open levels),
// capped at par + 20 %.
// Usage: node hpar.js <outdir> <levels...>      -> <outdir>/<L>.json {L, p, runs:[{won, moves, undos}], s}
//        node hpar.js --inject <outdir>        -> writes "s" into the LEVELS of ../index.html (levels without a file: none)
//        node hpar.js --check <levels...>      -> plays once per level and prints won/moves/undos (no writes)
const fs = require('fs'), path = require('path');
const APP = process.env.APP || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {csInit, csSolve, csPour, csWon, csMoves, csClone};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
const ld = L => ({ tubes: L.t.split('/'), caps: L.c.split('').map(Number), hid: L.h.split(',').map(x => parseInt(x, 36) || 0), fz: L.f.split('').map(Number) });

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// what the player sees: hidden layers become unique unknown colours
const beliefKey = S => { let k = 0; return S.t.map((tb, i) => tb.map((c, j) => S.h[i][j] ? '?' + (k++) : c).join(',')).join('|'); };
function determinize(S, rnd) {
  const cnt = []; S.t.forEach((tb, i) => tb.forEach((c, j) => { if (!S.h[i][j]) cnt[c] = (cnt[c] || 0) + 1; }));
  const pool = []; S.tot.forEach((n, c) => { for (let k = cnt[c] || 0; k < n; k++) pool.push(c); });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return { t: S.t.map((tb, i) => tb.map((c, j) => S.h[i][j] ? pool.pop() : c)), cap: S.cap, fz: S.fz, h: S.h.map(a => a.map(() => false)), tot: S.tot };
}
// the game's own dead-end detector (checkEnd)
const dead = S => !core.csMoves(S).length || core.csSolve(S, { limit: 3000, w: 3 }) === null;

function play(D, seed, K = 6) {
  const rnd = mulberry32(seed);
  let S = core.csInit(D); const hist = [], mv = [], bad = new Set(); let undos = 0, steps = 0;
  const anyHid = () => S.h.some(a => a.some(x => x));
  while (!core.csWon(S) && steps++ < 400) {
    if (dead(S)) {
      // stuck card: back to the latest earlier position that can still be won, and never play that pour there again
      let j = hist.length - 1; while (j > 0 && core.csSolve(hist[j], { limit: 3000, w: 3 }) === null) j--;
      if (j < 0) return { won: false, moves: mv.length, undos };
      bad.add(beliefKey(hist[j]) + '#' + mv[j]);
      undos += hist.length - j; S = hist[j]; hist.length = j; mv.length = j; continue;
    }
    const samples = []; for (let k = 0; k < (anyHid() ? K : 1); k++) samples.push(anyHid() ? determinize(S, rnd) : S);
    const bk = beliefKey(S), last = mv[mv.length - 1];
    let best = null, bs = -1, bl = 1e9;
    const ms = core.csMoves(S).sort(() => rnd() - 0.5);
    for (const m of ms) {
      if (bad.has(bk + '#' + m)) continue;
      if (last && m[0] === last[1] && m[1] === last[0]) continue;
      let safe = 0, len = 0;
      for (const T of samples) {
        const P = core.csPour(T, m[0], m[1]); if (!P) continue;
        if (core.csWon(P.S)) { safe += 1; continue; }
        const r = core.csSolve(P.S, { limit: 1500, w: 3 });
        if (r && r.len >= 0) { safe += 1; len += r.len; } else if (r && r.len === -2) { safe += 0.5; len += 60; }
      }
      const al = safe ? len / safe : 1e9;
      if (safe > bs || (safe === bs && al < bl)) { bs = safe; bl = al; best = m; }
    }
    if (!best) best = ms[0];
    hist.push(S); mv.push(best); S = core.csPour(S, best[0], best[1]).S;
  }
  return { won: core.csWon(S), moves: mv.length, undos };
}
const hidden = Lv => Lv.h.split(',').some(x => parseInt(x, 36));
function hpar(n) {
  const Lv = LEVELS[n - 1], D = ld(Lv);
  const runs = [1, 2, 3].map(k => play(D, n * 7717 + k * 131));
  return { L: n, p: Lv.p, t: Lv.t, runs, s: starLimit(Lv.p, runs) };
}
// median of the won runs + 2, never below par + 2 and never looser than par + 20 % (a run that wandered is no ★★★ yardstick)
function starLimit(p, runs) {
  const ws = runs.filter(r => r.won).map(r => r.moves).sort((a, b) => a - b);
  const med = ws.length ? ws[Math.floor((ws.length - 1) / 2)] : p * 1.5;
  return Math.min(p + Math.ceil(p * 0.2), Math.max(p + 2, Math.round(med) + 2));
}

const args = process.argv.slice(2);
if (args[0] === '--inject') {
  const dir = args[1]; let n = 0;
  const out = LEVELS.map((Lv, i) => {
    const f = path.join(dir, (i + 1) + '.json'), o = { t: Lv.t, c: Lv.c, h: Lv.h, f: Lv.f, p: Lv.p };
    if (hidden(Lv) && fs.existsSync(f)) { const r = JSON.parse(fs.readFileSync(f, 'utf8')); const sl = starLimit(r.p, r.runs); if (r.t === Lv.t && sl > Lv.p + 2) { o.s = sl; n++; } }
    return o;
  });
  const js = '[\n' + out.map(o => JSON.stringify(o)).join(',\n') + '\n]';
  fs.writeFileSync(APP, html.replace(/\/\*LEVELS-START\*\/[\s\S]*?\/\*LEVELS-END\*\//, '/*LEVELS-START*/' + js + '/*LEVELS-END*/'));
  console.log('star limits injected for', n, 'levels');
} else if (args[0] === '--check') {
  for (const n of args.slice(1).map(Number)) { const t0 = Date.now(); const r = play(ld(LEVELS[n - 1]), n * 7717 + 1); console.log('L' + n, 'par', LEVELS[n - 1].p, r.won ? 'won' : 'LOST', 'moves', r.moves, 'undos', r.undos, ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
} else {
  const dir = args[0]; fs.mkdirSync(dir, { recursive: true });
  for (const n of args.slice(1).map(Number)) {
    if (!hidden(LEVELS[n - 1])) continue;
    const t0 = Date.now(), o = hpar(n);
    fs.writeFileSync(path.join(dir, n + '.json'), JSON.stringify(o));
    console.log('L' + n, 'par', o.p, 'runs', o.runs.map(r => (r.won ? '' : 'LOST ') + r.moves + (r.undos ? 'u' + r.undos : '')).join(' '), '-> ★★★ <=', o.s, ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
}
