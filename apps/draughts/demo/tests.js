// 國際跳棋 rule unit tests. Uses the game's own core (extracted from index.html via CORE markers).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const coreSrc = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(coreSrc + '\nreturn {RULES,LEVELS,RC,SQR,SQC,initBoard,initState,genMoves,applyMove,perft,stepState,statusOf,counts,moveKey,think,dailyOpening,seededRng,evaluate};')();

let pass = 0, fail = 0;
function ok(cond, name, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
// algebraic helpers (independent of the core's numbering): a1 = bottom-left (dark), white at the bottom
function sq(a) { const c = a.charCodeAt(0) - 97, r = 8 - +a[1]; const i = C.RC[r * 8 + c]; if (i < 0 || i === undefined) throw new Error('light square ' + a); return i; }
function name(i) { return 'abcdefgh'[C.SQC[i]] + (8 - C.SQR[i]); }
function pos(rule, p, turn) { const b = new Array(32).fill(0); (p.w || []).forEach(a => b[sq(a)] = 1); (p.W || []).forEach(a => b[sq(a)] = 2); (p.b || []).forEach(a => b[sq(a)] = -1); (p.B || []).forEach(a => b[sq(a)] = -2); return C.initState(rule, b, turn || 0); }
function moves(st) { return C.genMoves(st.b, st.turn, C.RULES[st.rule]); }
function desc(m) { return m.path.map(name).join(m.caps.length ? 'x' : '-') + (m.caps.length ? ' [' + m.caps.map(name).sort().join(',') + ']' : '') + (m.pr ? ' =K' : ''); }
function descs(st) { return moves(st).map(desc).sort(); }
const RULESET = ['br', 'ru', 'en'];

// 1. Initial position and first mover
for (const r of RULESET) {
  const st = C.initState(r), c = C.counts(st.b);
  ok(c.wm === 12 && c.bm === 12 && c.wk + c.bk === 0, r + ' 12 men each');
  ok(st.b.slice(20).every(v => v === 1) && st.b.slice(0, 12).every(v => v === -1), r + ' white on 21-32, black on 1-12');
  ok(st.turn === (r === 'en' ? 1 : 0), r + ' first mover ' + (r === 'en' ? 'black' : 'white'));
  ok(moves(st).length === 7, r + ' 7 opening moves');
}
ok(name(0) === 'b8' && name(28) === 'a1' && name(31) === 'g1', 'numbering: 1=b8, 29=a1, 32=g1');

// 2. Perft
const KNOWN_EN = [7, 49, 302, 1469, 7361, 36768, 179740, 845931];
const perftOut = {};
for (const r of RULESET) {
  const R = C.RULES[r], res = [];
  for (let d = 1; d <= 8; d++) { const t = Date.now(), n = C.perft(C.initBoard(), R.first, R, d); res.push(n); if (r === 'en') ok(n === KNOWN_EN[d - 1], 'english perft d' + d, n); }
  perftOut[r] = res;
}
ok(perftOut.br.slice(0, 4).join() === perftOut.en.slice(0, 4).join() && perftOut.ru.slice(0, 4).join() === perftOut.en.slice(0, 4).join(), 'perft d1-4 equal across rules (no captures yet)');
console.log('perft english   ', perftOut.en.join(', '), '(published: 7, 49, 302, 1469, 7361, 36768, 179740, 845931)');
console.log('perft brazilian ', perftOut.br.join(', '));
console.log('perft russian   ', perftOut.ru.join(', '));

// 3. Men: quiet moves forward only; capture direction per rule
for (const r of RULESET) {
  let st = pos(r, { w: ['d4'], b: ['a7'] });
  ok(JSON.stringify(descs(st)) === JSON.stringify(['d4-c5', 'd4-e5']), r + ' man moves forward only', descs(st));
  st = pos(r, { w: ['e5'], b: ['d4', 'h8'] });
  const back = descs(st).includes('e5xc3 [d4]');
  ok(back === (r !== 'en'), r + ' man backward capture ' + (r !== 'en' ? 'allowed' : 'forbidden'), descs(st));
  st = pos(r, { b: ['e5'], w: ['d4', 'a1'] }, 1);
  ok(descs(st).includes('e5xc3 [d4]'), r + ' black man captures forward (down)', descs(st));
}
// 4. Kings
let st = pos('br', { W: ['a1'], b: ['h6'] });
ok(moves(st).length === 7, 'br flying king slides whole diagonal (7)', descs(st));
st = pos('ru', { W: ['a1'], b: ['h6'] }); ok(moves(st).length === 7, 'ru flying king slides whole diagonal');
st = pos('en', { W: ['a1'], b: ['h6'] }); ok(JSON.stringify(descs(st)) === JSON.stringify(['a1-b2']), 'en king moves one square', descs(st));
st = pos('en', { W: ['d4'], b: ['h8'] }); ok(moves(st).length === 4, 'en king moves in 4 directions');
st = pos('br', { W: ['a1'], b: ['d4'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['a1xe5 [d4]', 'a1xf6 [d4]', 'a1xg7 [d4]', 'a1xh8 [d4]']), 'br flying king captures from afar and lands on any square behind', descs(st));
st = pos('en', { W: ['a1'], b: ['d4'] }); ok(moves(st).every(m => !m.caps.length), 'en king cannot capture from afar');
st = pos('en', { W: ['d4'], b: ['c3', 'h8'] }); ok(descs(st).includes('d4xb2 [c3]'), 'en king captures backward');
st = pos('br', { W: ['a1'], b: ['c3', 'd4'] }); ok(moves(st).every(m => !m.caps.length), 'two pieces in a row cannot be jumped');
st = pos('br', { W: ['a1'], b: ['d4'], w: ['f6'] }); ok(JSON.stringify(descs(st).filter(d => d.includes('x'))) === JSON.stringify(['a1xe5 [d4]']), 'landing squares stop at the next piece');

// 5. Forced capture and maximum capture
for (const r of RULESET) { st = pos(r, { w: ['c3', 'h2'], b: ['d4'] }); ok(moves(st).length === 1 && moves(st)[0].caps.length === 1, r + ' capture is compulsory (no quiet moves offered)', descs(st)); }
const maxPos = { w: ['c3'], b: ['b4', 'd4', 'd6'] };
ok(JSON.stringify(descs(pos('br', maxPos))) === JSON.stringify(['c3xe5xc7 [d4,d6]']), 'br must take the maximum', descs(pos('br', maxPos)));
ok(descs(pos('ru', maxPos)).length === 2, 'ru may choose any capture route', descs(pos('ru', maxPos)));
ok(descs(pos('en', maxPos)).length === 2, 'en may choose any capture route', descs(pos('en', maxPos)));
st = pos('br', { w: ['c3', 'g3'], B: ['d4'], b: ['f4'] });
ok(descs(st).length === 2, 'br: king and man count the same (1 king vs 1 man both allowed)', descs(st));
for (const r of RULESET) {
  st = pos(r, maxPos);
  ok(!descs(st).includes('c3xe5 [d4]'), r + ' must finish the capture chain (no stopping after one jump)', descs(st));
}

// 6. Promotion, including during a capture
for (const r of RULESET) {
  st = pos(r, { w: ['b6'], b: ['h2'] });
  const m = moves(st).find(x => x.t === sq('c7')); const s2 = C.stepState(st, m);
  ok(s2.b[sq('c7')] === 1, r + ' no promotion before the last row');
  st = pos(r, { w: ['c7'], b: ['h2'] }); const m2 = moves(st).find(x => x.t === sq('d8'));
  ok(m2.pr && C.stepState(st, m2).b[sq('d8')] === 2, r + ' man reaching last row becomes king');
}
// passes through last row, then must continue backwards
st = pos('br', { w: ['d6'], b: ['e7', 'g7'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['d6xf8xh6 [e7,g7]']), 'br: passing the last row mid-capture continues as a man, no promotion', descs(st));
ok(C.stepState(st, moves(st)[0]).b[sq('h6')] === 1, 'br: piece is still a man after the chain');
st = pos('ru', { w: ['d6'], b: ['e7', 'g7'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['d6xf8xh6 [e7,g7] =K']), 'ru: crowned on the last row, continues and stays king', descs(st));
st = pos('en', { w: ['d6'], b: ['e7', 'g7'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['d6xf8 [e7] =K']), 'en: reaching the king row ends the move', descs(st));
// Russian: after crowning it captures like a flying king (piece far away)
st = pos('ru', { w: ['b6'], b: ['c7', 'f6'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['b6xd8xg5 [c7,f6] =K', 'b6xd8xh4 [c7,f6] =K']), 'ru: newly crowned king continues with flying capture', descs(st));
st = pos('br', { w: ['b6'], b: ['c7', 'f6'] });
ok(JSON.stringify(descs(st)) === JSON.stringify(['b6xd8 [c7] =K']), 'br: ending on last row promotes, no flying continuation', descs(st));

// 7. Turkish strike rule
// captured pieces stay until the end: the king cannot pass over d4 again to reach c5
st = pos('br', { W: ['b2'], b: ['d4', 'g5', 'g3', 'c5'] });
let ds = descs(st);
ok(ds.length === 2 && ds.every(d => d.includes('[d4,g3,g5]')) && ds.every(d => !d.includes('c5')), 'Turkish rule: jumped piece blocks the way (c5 unreachable)', ds);
// each piece may be jumped only once: a loop around four men returns to the start square
for (const r of RULESET) {
  st = pos(r, { W: ['d2'], b: ['c3', 'c5', 'e5', 'e3'] });
  ds = descs(st);
  const full = moves(st).filter(m => m.caps.length === 4);
  ok(full.length >= 1 && full.every(m => new Set(m.caps).size === 4) && moves(st).every(m => new Set(m.caps).size === m.caps.length), r + ' no piece is jumped twice; 4-piece loop found', ds);
  if (r === 'en') ok(ds.length === 1 && ds[0].startsWith('d2x') && ds[0].includes('xd2 '), 'en loop ends on its own start square (deduplicated)', ds);
}
// pieces are removed only after the whole move
st = pos('br', { w: ['c3'], b: ['d4', 'd6'] }); const sc = C.stepState(st, moves(st)[0]);
ok(sc.b[sq('d4')] === 0 && sc.b[sq('d6')] === 0 && sc.b[sq('c7')] === 1, 'all captured pieces are removed when the move completes');

// 8. Win conditions
st = pos('br', { w: ['c3'], b: ['d4'] }); let s2 = C.stepState(st, moves(st)[0]); let S = C.statusOf(s2);
ok(S.over && S.winner === 0 && S.reason.includes('吃光'), 'win by capturing all pieces', S);
for (const r of RULESET) { st = pos(r, { b: ['b8'], w: ['a7', 'c7', 'd6'] }, 1); S = C.statusOf(st); ok(S.over && S.winner === 0 && S.reason.includes('無子可走'), r + ' win when opponent is blocked', S); }

// 9. Draw rules
// threefold repetition
st = pos('br', { W: ['a1', 'c1'], B: ['a7', 'c7'] });
const shuffle = [['a1', 'b2'], ['a7', 'b8'], ['b2', 'a1'], ['b8', 'a7']];
let rep = st, firstOver = -1;
for (let k = 0; k < 8; k++) { const [f, t] = shuffle[k % 4]; const m = moves(rep).find(x => x.f === sq(f) && x.t === sq(t)); rep = C.stepState(rep, m); const s = C.statusOf(rep); if (s.over && firstOver < 0) { firstOver = k + 1; S = s; } }
ok(firstOver === 8 && S.winner === -1 && S.reason.includes('重複'), 'threefold repetition draws at the 3rd occurrence (ply 8)', { firstOver, S });
// 25 king-only moves without capture (flying rules) / 40 moves (English)
for (const r of RULESET) {
  const lim = r === 'en' ? 80 : 50;
  st = pos(r, { W: ['a1', 'c1', 'e1'], B: ['b8', 'd8', 'f8'], w: ['h2'], b: ['a5'] });
  st.kq = lim - 2; let a = C.statusOf(st); ok(!a.over, r + ' no draw before the limit');
  let m = moves(st).find(x => Math.abs(st.b[x.f]) === 2); st = C.stepState(st, m); ok(!C.statusOf(st).over, r + ' still playing at ' + (lim - 1));
  m = moves(st).find(x => Math.abs(st.b[x.f]) === 2); let s3 = C.stepState(st, m); a = C.statusOf(s3);
  ok(a.over && a.winner === -1 && s3.kq === lim, r + ' draw after ' + lim / 2 + ' moves each without capture / man move', a);
  m = moves(st).find(x => Math.abs(st.b[x.f]) === 1); ok(m && C.stepState(st, m).kq === 0, r + ' a man move resets the counter');
}
// 3 pieces vs lone king: 16 moves; 2 pieces vs lone king: 5 moves (flying rules)
for (const r of ['br', 'ru']) {
  let s;
  // exact counter check
  st = pos(r, { W: ['a1', 'c1', 'e1'], B: ['h4'] }); s = C.stepState(st, moves(st).find(m => m.f === sq('a1') && m.t === sq('b2')));
  ok(s.egLim === 32 && s.eg === 0, r + ' 3v1 counter starts (limit 32 plies)', s);
  s.eg = 31; s.hist = [s.hist[s.hist.length - 1]]; const s4 = C.stepState(s, moves(s)[0]); ok(C.statusOf(s4).over && C.statusOf(s4).reason.includes('16'), r + ' 3v1 draw after 16 moves each');
  st = pos(r, { W: ['a1', 'c1'], B: ['h4'] }); s = C.stepState(st, moves(st)[0]); ok(s.egLim === 10, r + ' 2v1 limit 5 moves each');
  st = pos(r, { W: ['a1', 'c1'], w: ['g3'], b: ['a7'], B: ['h8'] }); s = C.stepState(st, moves(st)[0]); ok(!s.egSig, r + ' counter not active with 2 black pieces');
}
st = pos('en', { W: ['a1', 'c1', 'e1'], B: ['h4'] }); ok(!C.stepState(st, moves(st)[0]).egSig, 'en: no lone-king rule (3 kings beat 1 king)');

// 10. Independent reference generator vs core, over random games
function refGen(b, turn, rule) {
  const R = C.RULES[rule], s = turn ? -1 : 1, grid = {}, at = (r, c) => (r < 0 || r > 7 || c < 0 || c > 7) ? null : grid[r * 8 + c];
  for (let i = 0; i < 32; i++) grid[C.SQR[i] * 8 + C.SQC[i]] = b[i];
  const idx = (r, c) => C.RC[r * 8 + c], fwd = turn ? 1 : -1, last = turn ? 7 : 0, out = [];
  const D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  function rec(r0, c0, r, c, king, crowned, pth, caps) {
    let any = false;
    for (const [dr, dc] of D) {
      if (!king && !R.manBack && dr !== fwd) continue;
      if (king && R.flying) {
        let k = 1; while (at(r + dr * k, c + dc * k) === 0 || (r + dr * k === r0 && c + dc * k === c0 && false)) k++;
        const v = at(r + dr * k, c + dc * k); if (v == null || v * s >= 0 || caps.includes(idx(r + dr * k, c + dc * k))) continue;
        for (let j = k + 1; at(r + dr * j, c + dc * j) === 0; j++) { any = true; rec(r0, c0, r + dr * j, c + dc * j, true, crowned, pth.concat([idx(r + dr * j, c + dc * j)]), caps.concat([idx(r + dr * k, c + dc * k)])); }
      } else {
        const v = at(r + dr, c + dc), l = at(r + 2 * dr, c + 2 * dc);
        if (v == null || v * s >= 0 || l !== 0 || caps.includes(idx(r + dr, c + dc))) continue;
        any = true; let nk = king, nc = crowned; if (!king && r + 2 * dr === last && R.midPromo) { nk = true; nc = true; }
        rec(r0, c0, r + 2 * dr, c + 2 * dc, nk, nc, pth.concat([idx(r + 2 * dr, c + 2 * dc)]), caps.concat([idx(r + dr, c + dc)]));
      }
    }
    if (!any && caps.length) out.push({ path: pth, caps, pr: crowned || (!king && r === last) });
  }
  for (let i = 0; i < 32; i++) if (b[i] * s > 0) { const r = C.SQR[i], c = C.SQC[i]; grid[r * 8 + c] = 0; rec(r, c, r, c, Math.abs(b[i]) === 2, false, [i], []); grid[r * 8 + c] = b[i]; }
  let res = out;
  if (res.length && R.maxCap) { const mx = Math.max(...res.map(m => m.caps.length)); res = res.filter(m => m.caps.length === mx); }
  if (!res.length) for (let i = 0; i < 32; i++) if (b[i] * s > 0) {
    const r = C.SQR[i], c = C.SQC[i], king = Math.abs(b[i]) === 2;
    for (const [dr, dc] of D) {
      if (!king && dr !== fwd) continue;
      for (let k = 1; at(r + dr * k, c + dc * k) === 0; k++) { const t = idx(r + dr * k, c + dc * k); res.push({ path: [i, t], caps: [], pr: !king && r + dr === last }); if (!(king && R.flying)) break; }
    }
  }
  const key = m => m.path[0] + ':' + m.path[m.path.length - 1] + ':' + m.caps.slice().sort((a, c) => a - c).join(',') + (m.pr ? 'K' : '');
  return [...new Set(res.map(key))].sort();
}
const ck = m => m.f + ':' + m.t + ':' + m.caps.slice().sort((a, c) => a - c).join(',') + (m.pr ? 'K' : '');
for (const r of RULESET) {
  const rng = C.seededRng(r.charCodeAt(0) * 7 + 3); let positions = 0, mism = 0, maxCaps = 0, kingCaps = 0, games = 0;
  for (let g = 0; g < 300; g++) {
    let s = C.initState(r); games++;
    for (let ply = 0; ply < 150; ply++) {
      const ms = moves(s); positions++;
      const a = ms.map(ck).sort(), bb = refGen(s.b, s.turn, r);
      if (JSON.stringify(a) !== JSON.stringify(bb)) { if (mism++ < 3) console.log('mismatch', r, JSON.stringify(s.b), s.turn, a, bb); }
      if (!ms.length || C.statusOf(s).over) break;
      const m = ms[Math.floor(rng() * ms.length)]; maxCaps = Math.max(maxCaps, m.caps.length); if (m.caps.length && Math.abs(s.b[m.f]) === 2) kingCaps++;
      s = C.stepState(s, m);
    }
  }
  ok(mism === 0, r + ' core generator == reference generator', mism);
  console.log(`cross-check ${r}: ${positions} positions from ${games} random games, ${mism} mismatches (longest random capture ${maxCaps}, king captures ${kingCaps})`);
}

// 11. AI sanity: legal moves, takes a free piece, time limits
for (const r of RULESET) {
  st = pos(r, { w: ['c3', 'g3', 'a1'], b: ['d6', 'h8', 'b8'] });
  const t = C.think(st, 3); ok(t && moves(st).some(m => C.moveKey(m.path, m.caps) === C.moveKey(t.move.path, t.move.caps)), r + ' AI returns a legal move');
}
st = pos('br', { w: ['c3', 'a1'], b: ['d4', 'b8'] }, 0); // forced capture position: only capture
ok(C.think(st, 5).only === true, 'AI answers instantly when the move is forced');
console.log('\nAI think times (ms) from 4 game positions:');
const tp = []; { let s = C.initState('br'); const rng = C.seededRng(77); for (let k = 0; k < 24; k++) { const ms = moves(s); s = C.stepState(s, ms[Math.floor(rng() * ms.length)]); if (k % 6 === 5 && !C.statusOf(s).over) tp.push(s); } }
for (let lv = 1; lv <= 5; lv++) {
  const ts = [], ds = []; for (const s of tp) { const t = C.think(s, lv, { rng: C.seededRng(lv) }); if (!t.only) { ts.push(t.ms); ds.push(t.depth); } }
  const lim = C.LEVELS[lv].ms; ok(Math.max(...ts) <= lim * 1.15 + 30, 'L' + lv + ' within time budget ' + lim + 'ms', ts);
  console.log(`  L${lv} ${C.LEVELS[lv].name}: avg ${Math.round(ts.reduce((a, b) => a + b, 0) / ts.length)} max ${Math.round(Math.max(...ts))} (budget ${lim}), depth ${Math.min(...ds)}-${Math.max(...ds)}`);
}
// daily opening deterministic
const d1 = C.dailyOpening('br', 20261014), d2 = C.dailyOpening('br', 20261014);
ok(JSON.stringify(d1) === JSON.stringify(d2) && d1.length === 3, 'daily opening is deterministic, 3 plies');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
