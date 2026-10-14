// Offline level generator for 蜘蛛接龍 (spider-solitaire). Uses the game's own core (CORE-START/END in ../index.html).
//   node gen.js cand <suits> <strict 0|1> <firstSeedIndex> <count> <out.jsonl>   -> solve candidate deals, write metrics
//   node gen.js pick <dir-with-jsonl>                                         -> choose 100 levels + daily pool, write into index.html
// Difficulty S = ln(expanded nodes) + solution length/50 + mean reveal delay of the 44 face-down cards/10 + suit term (1->0, 2->3, 4->6)
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {makeGame, initState, cloneState, applyCode, isWon, solve, solveLadder, NCOL};')();
const SUITTERM = { 1: 0, 2: 3, 4: 6 };
function seedFor(suits, strict, i) { return ((suits * 1000003 + strict * 7777777 + i * 2654435761) >>> 0) % 4000000000 + 1; }
function metrics(seed, suits, strict, opts) {
  const G = core.makeGame(seed, suits, strict), s0 = core.initState(G);
  const r = core.solveLadder(G, s0, opts && opts.cap);
  if (!r.moves) return { seed, suits, strict, ok: false, nodes: r.nodes };
  // replay with the real rules and measure when each initially hidden card turns face-up
  const s = core.cloneState(s0), hidden = new Map();
  for (let i = 0; i < core.NCOL; i++) for (let j = 0; j < s.d[i]; j++) hidden.set(s.c[i][j], -1);
  r.moves.forEach((m, step) => {
    core.applyCode(G, s, m);
    for (let i = 0; i < core.NCOL; i++) for (let j = s.d[i]; j < s.c[i].length; j++) { const id = s.c[i][j]; if (hidden.get(id) === -1) hidden.set(id, step + 1); }
  });
  if (!core.isWon(s)) throw new Error('solution does not win ' + seed);
  let sum = 0; for (const v of hidden.values()) sum += v < 0 ? r.moves.length : v;
  const delay = sum / hidden.size;
  const S = Math.log(r.nodes) + r.moves.length / 50 + delay / 10 + SUITTERM[suits];
  return { seed, suits, strict, ok: true, nodes: r.nodes, len: r.moves.length, delay: +delay.toFixed(2), S: +S.toFixed(4), moves: r.moves };
}
module.exports = { metrics, seedFor, core };
if (require.main === module) {
  const [mode, ...a] = process.argv.slice(2);
  if (mode === 'cand') {
    const suits = +a[0], strict = +a[1], first = +a[2], count = +a[3], out = a[4];
    for (let i = first; i < first + count; i++) {
      const t = Date.now(), m = metrics(seedFor(suits, strict, i), suits, !!strict);
      delete m.moves; m.ms = Date.now() - t; m.i = i;
      fs.appendFileSync(out, JSON.stringify(m) + '\n');
    }
  } else if (mode === 'pick') {
    const dir = a[0], all = [];
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.jsonl')) for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) if (line.trim()) all.push(JSON.parse(line));
    const seenSeed = new Set(); for (let i = all.length - 1; i >= 0; i--) { const k = all[i].seed + ':' + all[i].strict; if (seenSeed.has(k)) all.splice(i, 1); else seenSeed.add(k); }
    const pool = (suits, strict) => all.filter(c => c.ok && c.suits === suits && !!c.strict === !!strict).sort((x, y) => x.S - y.S);
    const segs = [[1, 40, 1, 0], [41, 60, 2, 0], [61, 75, 2, 1], [76, 100, 4, 1]];
    const levels = [], used = new Set(); let prev = -1;
    for (const [a0, b0, suits, strict] of segs) {
      const P = pool(suits, strict).filter(c => c.S > prev + 0.005);
      const m = b0 - a0 + 1;
      if (P.length < m) throw new Error('not enough candidates for ' + a0 + '-' + b0 + ': ' + P.length);
      // geometric targets across the segment's spread: S(n) = lo * r^(n-a0)
      const lo = P[Math.min(P.length - 1, Math.floor(P.length * 0.02))].S, hi = P[Math.floor((P.length - 1) * ({ 1: 0.96, 41: 0.6, 61: 0.97, 76: 1 })[a0])].S;
      const r = Math.pow(hi / lo, 1 / (m - 1));
      let k = 0;
      for (let n = 0; n < m; n++) {
        const target = lo * Math.pow(r, n), left = m - n - 1;
        // nearest candidate to the target that keeps S strictly increasing and leaves enough for the rest
        let best = -1, bd = 1e9;
        for (let j = k; j < P.length - left; j++) { if (P[j].S <= prev + 0.005) continue; const d = Math.abs(P[j].S - target); if (d < bd) { bd = d; best = j; } }
        if (best < 0) throw new Error('segment ' + a0 + ' ran out at level ' + (a0 + n) + ' pool ' + P.length + ' prev ' + prev);
        const c = P[best]; levels.push(c); used.add(c.seed); prev = c.S; k = best + 1;
      }
    }
    const daily = all.filter(c => c.ok && c.suits === 2 && !c.strict && !used.has(c.seed)).map(c => c.seed);
    const L = levels.map(c => [c.seed, c.suits, Math.round(c.S * 100), c.len, c.nodes]);
    let h = html.replace(/var LEVELS = \[[^\n]*\];/, 'var LEVELS = ' + JSON.stringify(L) + ';').replace(/var DAILY = \[[^\n]*\];/, 'var DAILY = ' + JSON.stringify(daily) + ';');
    fs.writeFileSync(APP, h);
    console.log('levels', L.length, 'daily pool', daily.length);
    levels.forEach((c, i) => console.log(String(i + 1).padStart(3), c.suits + '花', c.strict ? '嚴' : '寬', 'S', c.S.toFixed(2), 'nodes', c.nodes, 'len', c.len, 'delay', c.delay));
  }
}
