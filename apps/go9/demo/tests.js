// Rule unit tests for 九路圍棋. Extracts the engine between the CORE markers of ../index.html (or a given file) and checks
// capture, suicide, simple ko, positional superko, Japanese basic ko + triple-ko no-result, handicap, double pass,
// Chinese area / Japanese territory counting against hand-counted positions, automatic dead-stone marking, SGF.
const fs = require('fs'), path = require('path');
const file = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const src = fs.readFileSync(file, 'utf8').match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const GO = new Function(src + ';return GO;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const C = 'ABCDEFGHJKLMN';
function P(g, s) { return g.b.pt(C.indexOf(s[0]), g.size - +s.slice(1)); }
function play(g, list) { list.split(' ').forEach(m => { const p = m === 'pass' ? 0 : P(g, m); const why = g.check(p); if (why) throw new Error('illegal ' + m + ' ' + why); g.play(p); }); return g; }
/* set up a position from rows (top row first): X black, O white, . empty */
function setup(rows, o) {
  const g = new GO.Game(Object.assign({ size: rows.length }, o || {}));
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'X') g.b.place(g.b.pt(x, y), 1); else if (ch === 'O') g.b.place(g.b.pt(x, y), 2); }));
  g.b.caps[1] = g.b.caps[2] = 0; g.b.ko = 0; g.seen = {}; g.seen[g.b.key()] = 1;
  return g;
}

/* ---- move counts ---- */
ok(new GO.Game({ size: 9 }).legalMoves().length === 81, 'empty 9x9 has 81 legal moves');
ok(new GO.Game({ size: 13 }).legalMoves().length === 169, 'empty 13x13 has 169 legal moves');
console.log('legal moves on empty board: 9x9 =', new GO.Game({ size: 9 }).legalMoves().length, ', 13x13 =', new GO.Game({ size: 13 }).legalMoves().length);

/* ---- capture ---- */
{ const g = play(new GO.Game(), 'E5 E6 A1 D5 A2 F5 A3 E4'); ok(g.b.c[P(g, 'E5')] === 0 && g.b.caps[2] === 1, 'centre stone captured by four white stones'); }
{ const g = play(new GO.Game(), 'A1 A2 E5 B1'); ok(g.b.c[P(g, 'A1')] === 0 && g.b.caps[2] === 1, 'corner stone captured with two stones'); }
{ const g = play(new GO.Game(), 'A5 A6 E5 A4 E6 B5'); ok(g.b.c[P(g, 'A5')] === 0, 'edge stone captured with three stones'); }
{ const g = play(new GO.Game(), 'D5 D6 E5 E6 J9 F5 J8 C5 J7 D4 J6 E4'); ok(g.b.c[P(g, 'D5')] === 0 && g.b.c[P(g, 'E5')] === 0 && g.b.caps[2] === 2, 'two-stone group captured'); }
{ /* one move capturing two separate groups */
  const g = setup(['.........', '.........', '.........', '...O.O...', '..OX.XO..', '...O.O...', '.........', '.........', '.........']);
  g.b.toPlay = 2; const cap = g.play(P(g, 'E5')); ok(cap === 2 && g.b.c[P(g, 'D5')] === 0 && g.b.c[P(g, 'F5')] === 0, 'one move captures two groups');
}
{ /* capturing move that would otherwise be suicide is legal */
  const g = setup(['.XO......', 'XO.......', 'O........', '.........', '.........', '.........', '.........', '.........', '.........']);
  g.b.toPlay = 2; ok(g.check(P(g, 'A9')) === '', 'filling own last liberty is legal when it captures'); g.play(P(g, 'A9'));
  ok(g.b.c[P(g, 'B9')] === 0 && g.b.c[P(g, 'A8')] === 0, 'self-atari capture removes the two black stones');
}
/* ---- suicide ---- */
{ const g = play(new GO.Game(), 'B9 pass A8'); ok(g.check(P(g, 'A9')) === 'suicide', 'single-point suicide in the corner is forbidden'); }
{ const h = setup(['.XO......', 'XXO......', 'OO.......', '.........', '.........', '.........', '.........', '.........', '.........']);
  h.b.toPlay = 1; ok(h.check(P(h, 'A9')) === 'suicide', 'multi-stone suicide (black group would be left with no liberties) is forbidden');
  const g = setup(['.X.X.....', 'XXXX.....', '.........', '.........', '.........', '.........', '.........', '.........', '.........']);
  g.b.toPlay = 1; ok(g.check(P(g, 'A9')) === '', 'filling one of two own eyes is legal (group keeps liberties)');
  ok(g.check(P(g, 'A9'), 2) === 'suicide', 'white may not play into a black eye');
}
/* ---- simple ko ---- */
{ const g = setup(['.........', '.........', '.........', '...XO....', '..X.XO...', '...XO....', '.........', '.........', '.........']);
  g.b.toPlay = 2; g.play(P(g, 'D5'));                         // white captures E5 -> ko
  ok(g.b.c[P(g, 'E5')] === 0 && g.b.ko === P(g, 'E5'), 'ko point recorded after single-stone capture');
  ok(g.check(P(g, 'E5')) === 'ko', 'immediate recapture is forbidden (ko)');
  g.play(P(g, 'A1')); g.play(P(g, 'J9'));
  ok(g.check(P(g, 'E5')) === '', 'recapture allowed after an exchange elsewhere');
  const j = setup(['.........', '.........', '.........', '...XO....', '..X.XO...', '...XO....', '.........', '.........', '.........'], { rules: 'jp' });
  j.b.toPlay = 2; j.play(P(j, 'D5')); ok(j.check(P(j, 'E5')) === 'ko', 'Japanese rules also forbid the immediate recapture');
}
/* ---- positional superko & Japanese triple-ko no-result: search random tiny-board games for a cycle ---- */
{
  let found = null;
  for (let s = 1; s < 4000 && !found; s++) {
    GO.setSeed(s * 7919);
    const g = new GO.Game({ size: 4 }), snaps = [g.b.c.slice()];
    for (let k = 0; k < 120 && !found; k++) {
      const legal = g.legalMoves(); const sk = [];
      for (const p of g.b.pts) { if (!g.b.c[p] && g.b.legal(p, g.b.toPlay) && g.check(p) === 'superko') sk.push(p); }
      if (sk.length) { found = { g, p: sk[0], snaps }; break; }
      if (!legal.length) break;
      g.play(legal[Math.floor(GO.rand() * legal.length)]); snaps.push(g.b.c.slice());
    }
  }
  ok(!!found, 'random search found a positional-superko situation');
  if (found) {
    const { g, p, snaps } = found;
    const t = g.b.clone(); t.place(p, g.b.toPlay);
    const same = snaps.some(s => s.every((v, i) => v === t.c[i]));
    ok(same, 'superko move really recreates an earlier whole-board position (verified by array comparison, not hash)');
    ok(p !== g.b.ko, 'the superko move is not a simple ko recapture');
    const j = GO.Game.replay(Object.assign(g.opts(), { rules: 'jp' }), g.moves);
    ok(j.check(p) === '', 'same move is legal under Japanese rules (basic ko only)');
    console.log('superko example on 4x4 after', g.moves.length, 'moves: move', GO.coord(g.b, p), 'recreates an earlier position');
  }
  /* Japanese: a long cycle repeated three times -> no result */
  let nr = null;
  for (let s = 1; s < 6000 && !nr; s++) {
    GO.setSeed(s * 104729);
    const g = new GO.Game({ size: 4, rules: 'jp' }), keys = [g.b.key() + ':' + g.b.toPlay];
    for (let k = 0; k < 150; k++) {
      const legal = g.legalMoves(); if (!legal.length) break;
      g.play(legal[Math.floor(GO.rand() * legal.length)]);
      const key = g.b.key() + ':' + g.b.toPlay, i0 = keys.indexOf(key); keys.push(key);
      if (i0 >= 0 && g.moves.length - i0 > 2) {
        const cyc = g.moves.slice(i0); let okc = true;
        for (let r = 0; r < 2 && okc && !g.noResult; r++) for (const m of cyc) { if (m && g.check(m)) { okc = false; break; } g.play(m); if (g.noResult) break; }
        if (okc && g.noResult) { nr = { g, len: cyc.length }; }
        break;
      }
    }
  }
  ok(!!nr, 'Japanese rules: repeating a ko cycle three times ends the game with no result (三劫循環無勝負)');
  if (nr) console.log('triple-repetition example: cycle of', nr.len, 'moves repeated -> noResult =', nr.g.noResult);
}
/* ---- incremental group structures vs brute force (fuzz) ---- */
{
  let bad = 0, games = 0;
  for (let s = 1; s <= 60; s++) {
    GO.setSeed(s); const g = new GO.Game({ size: s % 2 ? 9 : 13 }); games++;
    for (let k = 0; k < 160; k++) {
      const legal = g.legalMoves(); if (!legal.length) break; g.play(legal[Math.floor(GO.rand() * legal.length)]);
      const b = g.b;
      for (const p of b.pts) if (b.c[p] === 1 || b.c[p] === 2) {
        const r = b.g[p], libs = b.libCount(r);
        if ((libs === 1) !== b.atari(r) || libs === 0) bad++;
      }
      if (k % 40 === 0) { const t = new GO.Board(b.n); for (const p of b.pts) if (b.c[p]) t.place(p, b.c[p]); if (t.key() !== b.key()) bad++; }
    }
  }
  ok(bad === 0, 'atari detection by pseudo-liberty sums and Zobrist hash agree with brute force over ' + games + ' random games');
}
/* ---- handicap ---- */
{ const g = new GO.Game({ size: 9, handicap: 5 }); const st = ['G7', 'C3', 'G3', 'C7', 'E5'].every(s => g.b.c[P(g, s)] === 1);
  ok(st && g.b.toPlay === 2 && g.komi === 0.5, 'five handicap stones on the star points, white to move, komi 0.5');
  const h = new GO.Game({ size: 9, handicap: 2 }); ok(h.b.c[P(h, 'G7')] === 1 && h.b.c[P(h, 'C3')] === 1 && h.b.c[P(h, 'E5')] === 0, 'two-stone handicap on G7 and C3'); }
/* ---- double pass ---- */
{ const g = play(new GO.Game(), 'E5 pass'); ok(!g.over(), 'single pass does not end'); g.play(0); ok(g.over(), 'two consecutive passes end the game');
  const h = play(new GO.Game(), 'E5 pass D4 pass'); ok(!h.over(), 'non-consecutive passes do not end'); }
/* ---- scoring: 10 hand-counted positions ---- */
const split = (bx, wx) => Array.from({ length: 9 }, () => Array.from({ length: 9 }, (_, x) => x === bx ? 'X' : x === wx ? 'O' : '.').join(''));
const cases = [
  { n: 'walls E/F: black 45 v white 36', rows: split(4, 5), cn: [45, 43.5], jp: [36, 33.5] },
  { n: 'walls D/E: black 36 v white 45', rows: split(3, 4), cn: [36, 52.5], jp: [27, 42.5] },
  { n: 'komi edge: black 44 v white 37 (white wins by 0.5)', rows: ['....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '....XO...', '...XOO...'], cn: [44, 44.5], jp: [35, 33.5] },
  { n: 'one dead stone each side marked', rows: (() => { const r = split(4, 5); r[1] = '.O..XO...'; r[7] = '....XO.X.'; return r; })(), dead: ['B8', 'H2'], cn: [45, 43.5], jp: [37, 34.5] },
  { n: 'one column of dame', rows: split(3, 5), cn: [36, 43.5], jp: [27, 33.5] },
  { n: 'seki in the corner (shared liberties neutral)', rows: ['X.OX.....', 'X.OX.....', 'XXOX.....', 'OOXX.....', '.OX......', '.OX......', '.OX......', '.OX......', '.OX......'], cn: [64, 22.5], jp: [50, 11.5] },
  { n: 'handicap game komi 0.5', rows: split(4, 5), opt: { handicap: 2 }, cn: [45, 36.5], jp: [36, 27.5], nohc: true },
  { n: 'prisoners matter only in territory scoring', rows: split(3, 5), caps: [4, 1], cn: [36, 43.5], jp: [31, 34.5] },
  { n: 'empty board', rows: Array(9).fill('.........'), cn: [0, 7.5], jp: [0, 6.5] },
  { n: 'black wall surrounded by white territory, dead black stones', rows: (() => { const r = split(6, 7); r[4] = '.....XXO.'; r[2] = '...O..XO.'; r[5] = '..X...XO.'; return r; })(), dead: [], cn: null }
];
/* case 10 counted by hand: black stones 11 (column G + F5 + C4), white 10 (column H + D7). D7 is dead inside black's area:
   black area = 54 points of columns A-F (2 stones + 52 empty after removing D7); white = 9 stones + 9 points of column J */
cases[9].dead = ['D7']; cases[9].cn = [11 + 52, 9 + 9 + 7.5]; cases[9].jp = [52 + 1, 9 + 6.5];
let sc = 0;
for (const cs of cases) {
  for (const rules of ['cn', 'jp']) {
    const o = Object.assign({ rules }, cs.opt || {});
    const g = setup(cs.rows, cs.nohc ? { rules, komi: 0.5 } : o);
    if (cs.caps) { g.b.caps[1] = cs.caps[0]; g.b.caps[2] = cs.caps[1]; }
    const dead = (cs.dead || []).map(s => P(g, s));
    const r = GO.finalScore(g, dead, rules), exp = cs[rules];
    const good = Math.abs(r.B - exp[0]) < 1e-9 && Math.abs(r.W - exp[1]) < 1e-9;
    ok(good, 'score ' + rules + ' ' + cs.n + ': got B ' + r.B + ' W ' + r.W + ' expected ' + exp);
    if (good) sc++;
  }
}
console.log('scoring: ' + sc + ' / ' + cases.length * 2 + ' hand-counted results match (' + cases.length + ' positions x Chinese+Japanese)');
{ const g = new GO.Game({ size: 9, handicap: 2 }); ok(g.komi === 0.5, 'handicap komi 0.5 by default'); ok(new GO.Game({ rules: 'jp' }).komi === 6.5 && new GO.Game().komi === 7.5, 'default komi 7.5 Chinese / 6.5 Japanese'); }
/* ---- automatic dead stones by ownership (2,000 playouts) ---- */
{
  /* final position of a real 8級 vs 18級 game: five white stones lower left are dead */
  const g = setup(['.OOOOOOOO', 'OOXXXOXX.', 'XX..XOX.X', '.X.XXOXXX', 'XX..XOOOX', 'X.X.XXXOO', '.XXXXOOXO', 'OOOOXO.XX', '.O..XOOO.']);
  const own = GO.ownership(g, 2000), dead = GO.deadFromOwn(g, own, 0.7).map(p => GO.coord(g.b, p)).sort();
  ok(dead.join(' ') === 'A2 B1 B2 C2 D2', 'ownership (2,000 playouts, >70%) marks exactly the five dead stones: ' + dead.join(' '));
  const s = setup(cases[5].rows); const own2 = GO.ownership(s, 2000), d2 = GO.deadFromOwn(s, own2, 0.7);
  ok(d2.length === 0, 'seki groups are not marked dead (' + d2.length + ')');
}
/* ---- SGF round trip ---- */
{ const g = play(new GO.Game({ handicap: 3 }), 'E5 D4 pass F6'); const t = GO.toSGF(g, 'W+R'); const h = GO.fromSGF(t);
  ok(h.moves.join() === g.moves.join() && h.handicap === 3 && h.komi === g.komi && h.b.key() === g.b.key(), 'SGF export/import round trip'); }
console.log('rule tests:', pass, 'passed,', fail, 'failed');
process.exitCode = fail ? 1 : 0;
