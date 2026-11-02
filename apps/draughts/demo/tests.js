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
// 25 king-only moves without capture (Brazilian) / 15 (Russian) / 40 moves (English)
for (const r of RULESET) {
  const lim = { br: 50, ru: 30, en: 80 }[r];
  st = pos(r, { W: ['a1', 'c1', 'e1'], B: ['b8', 'd8', 'f8'], w: ['h2'], b: ['a5'] });
  st.kq = lim - 2; let a = C.statusOf(st); ok(!a.over, r + ' no draw before the limit');
  let m = moves(st).find(x => Math.abs(st.b[x.f]) === 2); st = C.stepState(st, m); ok(!C.statusOf(st).over, r + ' still playing at ' + (lim - 1));
  m = moves(st).find(x => Math.abs(st.b[x.f]) === 2); let s3 = C.stepState(st, m); a = C.statusOf(s3);
  ok(a.over && a.winner === -1 && s3.kq === lim, r + ' draw after ' + lim / 2 + ' moves each without capture / man move', a);
  m = moves(st).find(x => Math.abs(st.b[x.f]) === 1); ok(m && C.stepState(st, m).kq === 0, r + ' a man move resets the counter');
}
// 3 pieces vs lone king: 16 moves (Brazilian) / 15 moves (Russian); 2 pieces vs lone king: 5 moves (flying rules)
for (const r of ['br', 'ru']) {
  let s; const L3 = r === 'br' ? 32 : 30;
  // exact counter check
  st = pos(r, { W: ['a1', 'c1', 'e1'], B: ['h4'] }); s = C.stepState(st, moves(st).find(m => m.f === sq('a1') && m.t === sq('b2')));
  ok(s.egLim === L3 && s.eg === 0, r + ' 3v1 counter starts (limit ' + L3 + ' plies)', s);
  s.eg = L3 - 2; s.hist = [s.hist[s.hist.length - 1]]; const s3b = C.stepState(s, moves(s)[0]); ok(!C.statusOf(s3b).over, r + ' 3v1 not yet drawn one ply before the limit');
  s.eg = L3 - 1; const s4 = C.stepState(s, moves(s)[0]); ok(C.statusOf(s4).over && C.statusOf(s4).reason.includes(String(L3 / 2)), r + ' 3v1 draw after ' + L3 / 2 + ' moves each', C.statusOf(s4));
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

// 12. Release-review fixes (2026-11-01), core level: Russian draw limits are 15 moves, L1 入門 is beatable by a casual player
ok(C.RULES.ru.kqLim === 30 && C.RULES.ru.eg3 === 30 && C.RULES.br.kqLim === 50 && C.RULES.br.eg3 === 32, 'Russian draw limits 15 moves, Brazilian 25 / 16');
ok(C.LEVELS[1].depth === 1 && C.LEVELS[1].noQ && C.LEVELS[1].err >= 0.5, 'L1 入門: one ply, no capture quiescence, frequent mistakes');
{ // the review's casual bot (one-ply greedy, 21% random) must win at least 30% against L1 (deterministic: L1 is one ply, seeded)
  const greedy = (st, rng, rand) => { const R = C.RULES[st.rule], ms = C.genMoves(st.b, st.turn, R); if (ms.length === 1 || rng() < rand) return ms[Math.floor(rng() * ms.length)]; let best, bv = -1e9; for (const m of ms) { const v = -C.evaluate(C.applyMove(st.b, m, st.turn), st.turn ^ 1, R) + rng() * 2; if (v > bv) { bv = v; best = m; } } return best; };
  for (const rule of RULESET) { let w = 0; const N = 12;
    for (let g = 0; g < N; g++) { const rng = C.seededRng(9000 + g * 31 + 1), human = g % 2; let s = C.initState(rule), ply = 0, stt;
      while (!(stt = C.statusOf(s)).over && ply < 300) { s = C.stepState(s, s.turn === human ? greedy(s, rng, 0.21) : C.think(s, 1, { rng }).move); ply++; }
      if (stt.over && stt.winner === human) w++; }
    ok(w / N >= 0.3, rule + ' casual bot beats L1 in at least 30% of games', w + '/' + N); console.log(`casual vs L1 (${rule}): ${w}/${N} wins`); }
}
ok(/level: 1, color/.test(html), 'default level is 1 入門');
{ // round 2 [中／3]: no wall between L1 and L2 — the casual bot wins 15–30% against L2 (the review's r2/sim-low.js seeds, 40 games)
  const greedy = (st, rng, rand) => { const R = C.RULES[st.rule], ms = C.genMoves(st.b, st.turn, R); if (ms.length === 1 || rng() < rand) return ms[Math.floor(rng() * ms.length)]; let best, bv = -1e9; for (const m of ms) { const v = -C.evaluate(C.applyMove(st.b, m, st.turn), st.turn ^ 1, R) + rng() * 2; if (v > bv) { bv = v; best = m; } } return best; };
  for (const rule of RULESET) { let w = 0; const N = 40;
    for (let g = 0; g < N; g++) { const rng = C.seededRng(9000 + g * 31 + 2), human = g % 2; let s = C.initState(rule), ply = 0, stt;
      while (!(stt = C.statusOf(s)).over && ply < 300) { s = C.stepState(s, s.turn === human ? greedy(s, rng, 0.21) : C.think(s, 2, { rng }).move); ply++; }
      if (stt.over && stt.winner === human) w++; }
    ok(w / N >= 0.15 && w / N <= 0.3, rule + ' casual bot wins 15–30% against L2', w + '/' + N); console.log(`casual vs L2 (${rule}): ${w}/${N} wins`); }
}
ok(/CELL \* 0\.26 \* pulse/.test(html), 'landing dots are 0.26 of a cell');
ok(!/北歐咖啡館/.test(html), 'start screen subtitle explains how to play');

// 13. Browser regressions with real CDP touch (one Chromium; waits on conditions, no timing-derived values)
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { console.log('playwright missing: browser checks skipped'); } }
  if (chromium) await browserChecks(chromium).catch(e => ok(false, 'browser checks crashed', String(e && e.stack || e)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

async function browserChecks(chromium) {
  const ORIGIN = 'https://draughts.test', T0 = Date.now();
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function ctxOpen(vp, init) {
    const ctx = await browser.newContext({ viewport: vp || { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith(ORIGIN)) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); if (u.startsWith('blob:') || u.startsWith('data:')) return r.continue(); errors.push('external request ' + u); return r.abort(); });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    const cdp = await ctx.newCDPSession(page);
    const down = (x, y) => cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    const up = () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tap = async (x, y) => { await down(x, y); await up(); };
    // waits until the element stops moving (overlay cards pop in with a scale animation), then taps its centre
    const tapEl = async sel => {
      const b = await page.evaluate(sel => new Promise((res, rej) => { let last = '', same = 0, n = 0; const el = document.querySelector(sel); if (!el) return rej(new Error('no ' + sel));
        const f = () => { const r = el.getBoundingClientRect(), k = [r.x, r.y, r.width, r.height].map(v => v.toFixed(1)).join(); const moving = [el.closest('.card'), el.closest('.ov')].some(x => x && x.getAnimations().some(an => an.playState === 'running' || an.playState === 'pending'));
          if (k === last && r.width && !moving) same++; else same = 0; last = k;
          if (same >= 2 || ++n > 600) { el.scrollIntoView({ block: 'nearest' }); const q = el.getBoundingClientRect(); res({ x: q.x, y: q.y, width: q.width, height: q.height }); } else requestAnimationFrame(f); }; f(); }), sel);
      await tap(b.x + b.width / 2, b.y + b.height / 2); };
    const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 20 });
    const sqc = i => page.evaluate(i => __dr.sqClient(i), i);
    await page.goto(ORIGIN + '/', { waitUntil: 'load' });
    return { ctx, page, tap, tapEl, until, sqc, down, up };
  }
  async function startGame(h, o) {
    await h.until(() => !document.querySelector('#ovSetup').classList.contains('hidden'));
    for (const [box, v] of [['sgRule', o.rule || 'br'], ['sgMode', o.mode || 'ai']].concat((o.mode || 'ai') === 'ai' ? [['sgLevel', String(o.level || 1)], ['sgColor', o.color || '0']] : [])) await h.tapEl(`#${box} button[data-v="${v}"]`);
    await h.tapEl('#sStart');
    await h.until(() => __dr.phase === 'play' && __dr.canInput());
  }
  const lit = (page, board) => page.evaluate(board => { const cv = document.getElementById('cv'), g = cv.getContext('2d'), rc = cv.getBoundingClientRect(), k = cv.width / rc.width, B = board || __dr.cur.b; let n = 0;
    for (let i = 0; i < 32; i++) if (B[i]) { const p = __dr.sqClient(i), d = g.getImageData(Math.round((p.x - rc.left) * k), Math.round((p.y - rc.top) * k - 2), 1, 1).data; const dk = B[i] < 0; if (dk ? (d[0] < 120) : (d[0] > 200 && d[1] > 185)) n++; } return n; }, board || null);

  // [嚴重／1] empty board after 開始對局: every rAF timestamp is moved 40 ms before the tap that started the game
  // (the race the review hit 21/30 times); the deal-in must still finish with all 24 pieces drawn, 6 starts in a row
  {
    const h = await ctxOpen(null, () => { const raw = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => raw(t => cb(t - 40)); });
    await startGame(h, { level: 1 });
    let full = 0;
    for (let k = 0; k < 6; k++) {
      if (k) { await h.tapEl('#bNew'); await h.until(() => !document.querySelector('#ovSetup').classList.contains('hidden')); await h.tapEl('#sStart');
        if (await h.page.evaluate(() => !document.querySelector('#ovConfirm').classList.contains('hidden'))) await h.tapEl('#cfYes');
        await h.until(() => __dr.phase === 'play'); }
      try { await h.until(() => !__dr.dealing, null, 8000); } catch (e) {}
      await h.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      if (await lit(h.page) === 24) full++;
    }
    ok(full === 6, 'deal-in always ends with every piece drawn (rAF time earlier than the tap)', full + '/6');
    await h.ctx.close();
  }
  // pvp game for the input checks
  const h = await ctxOpen();
  await startGame(h, { mode: 'pvp' });
  const st = () => h.page.evaluate(() => ({ n: __dr.G.moves.length, sel: __dr.sel, turn: __dr.cur.turn, anim: __dr.anim, cell: __dr.cell }));
  // round 2 [小／2]: with nothing selected, a tap 0.45 cell off a movable piece selects it; next to a piece that cannot move nothing is selected
  {
    const t = await h.page.evaluate(() => { const L = __dr.legal, m = L.find(x => !x.caps.length); const back = [28, 29, 30, 31].find(i => __dr.cur.b[i] && !L.some(x => x.f === i)); return { f: m.f, t: m.t, back }; });
    const a = await h.sqc(t.f), b = await h.sqc(t.t), cell = (await st()).cell, dl = Math.hypot(b.x - a.x, b.y - a.y);
    await h.tap(a.x + (b.x - a.x) / dl * cell * 0.45, a.y + (b.y - a.y) / dl * cell * 0.45);
    await h.until(f => __dr.sel && __dr.sel.f === f, t.f, 5000).catch(() => {});
    ok((await st()).sel && (await st()).sel.f === t.f, 'near-miss tap with nothing selected picks the closest movable piece', await st());
    await h.tap(a.x, a.y); await h.until(() => !__dr.sel);
    const k = await h.sqc(t.back); // a light square beside a back-row piece that cannot move
    await h.tap(k.x + cell * 0.45 * (k.x > 200 ? -1 : 1), k.y);
    await h.page.evaluate(() => new Promise(r => setTimeout(r, 80)));
    ok(!(await st()).sel, 'a tap beside a piece that cannot move selects nothing', await st());
  }
  // [中／2] a tap that misses the landing square by 0.6 cell still moves; a tap on an empty square keeps the selection
  {
    const m = await h.page.evaluate(() => { const L = __dr.legal; for (const m of L) { const others = L.filter(x => x.f === m.f && x.t !== m.t); if (others.length === 1) return { f: m.f, t: m.t, o: others[0].t }; } return null; });
    const a = await h.sqc(m.f), b = await h.sqc(m.t), o = await h.sqc(m.o), cell = (await st()).cell;
    await h.tap(a.x, a.y); await h.until(f => __dr.sel && __dr.sel.f === f, m.f);
    // far empty square (row 3/4 middle that is not a target): selection stays
    const empty = await h.page.evaluate(([f, t, o]) => { for (let i = 12; i < 20; i++) if (!__dr.cur.b[i] && i !== t && i !== o) return i; return -1; }, [m.f, m.t, m.o]);
    const e = await h.sqc(empty);
    if (Math.hypot(e.x - b.x, e.y - b.y) > cell * 0.8 && Math.hypot(e.x - o.x, e.y - o.y) > cell * 0.8) { await h.tap(e.x, e.y); await h.page.evaluate(() => new Promise(r => setTimeout(r, 50))); ok((await st()).sel && (await st()).sel.f === m.f, 'tap on an empty square keeps the selection'); }
    // 0.6 cell away from the target, pointing away from the other landing square
    const dx = b.x - o.x, dy = b.y - o.y, dl = Math.hypot(dx, dy) || 1, n0 = (await st()).n;
    await h.tap(b.x + dx / dl * cell * 0.6 * 0.7, b.y - cell * 0.6 * 0.7);
    await h.until(n => __dr.G.moves.length === n + 1, n0);
    ok((await h.page.evaluate(() => __dr.G.moves[__dr.G.moves.length - 1].p)).join() === [m.f, m.t].join(), 'near-miss tap snaps to the closest landing square');
    // data saved at the moment of the move (not when the animation ends)
    const saved = await h.page.evaluate(() => (JSON.parse(localStorage.getItem('draughts.game') || '{}').moves || []).length);
    ok(saved === n0 + 1, 'move saved immediately', saved);
  }
  // [小／2] pvp: a tap on the next side's piece during the move animation is applied when the animation ends
  // (the page records whether the tap really arrived during the animation; retried if a slow machine missed it)
  {
    await h.page.evaluate(() => document.getElementById('cv').addEventListener('pointerdown', () => { window.__downAnim = __dr.anim; }, true));
    let res = null;
    for (let tr = 0; tr < 4 && !res; tr++) {
      await h.until(() => __dr.canInput() && !__dr.sel);
      const m = await h.page.evaluate(() => { const L = __dr.legal, m = L.find(x => !x.caps.length) || L[0]; const nb = applyMove(__dr.cur.b, m, __dr.cur.turn), om = genMoves(nb, __dr.cur.turn ^ 1, RULES[__dr.cur.rule]); return { f: m.f, t: m.t, opp: om[0].f }; });
      const a = await h.sqc(m.f), b = await h.sqc(m.t), c = await h.sqc(m.opp);
      await h.tap(a.x, a.y); await h.until(f => __dr.sel && __dr.sel.f === f, m.f);
      await h.tap(b.x, b.y); await h.tap(c.x, c.y);
      const during = await h.page.evaluate(() => window.__downAnim);
      await h.until(() => !__dr.anim && __dr.canInput());
      const s2 = await st();
      if (during) res = { ok: !!(s2.sel && s2.sel.f === m.opp), sel: s2.sel };
      if (s2.sel) { await h.tap(c.x, c.y); await h.until(() => !__dr.sel); }
    }
    ok(res && res.ok, 'tap during the move animation selects the next side\'s piece afterwards', res);
  }
  // [細節] backgrounds are cached: flipping twice and starting a new game build nothing new
  {
    const b0 = await h.page.evaluate(() => __dr.bgBuilds);
    await h.tapEl('#bFlip'); await h.tapEl('#bFlip'); await h.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    ok(await h.page.evaluate(() => __dr.bgBuilds) === b0, 'flip uses the cached board background');
  }
  // overwriting a game in progress asks first; 取消 keeps it
  {
    const n0 = (await st()).n;
    await h.tapEl('#bNew'); await h.until(() => !document.querySelector('#ovSetup').classList.contains('hidden')); await h.tapEl('#sStart');
    await h.until(() => !document.querySelector('#ovConfirm').classList.contains('hidden'));
    await h.tapEl('#cfNo'); await h.until(() => document.querySelector('#ovConfirm').classList.contains('hidden'));
    ok((await st()).n === n0 && n0 > 0, 'new game over a game in progress needs confirmation; cancel keeps the game', n0);
  }
  // [小／4] review: resign, open 回顧棋局, step back and forth through every position
  {
    // first play a move that gives the opponent a capture, and take it, so the final position has fewer than 24 pieces
    await h.until(() => __dr.canInput() && !__dr.sel);
    const line = await h.page.evaluate(() => { const R = RULES[__dr.cur.rule], t = __dr.cur.turn; for (const a of __dr.legal) { const b1 = applyMove(__dr.cur.b, a, t), om = genMoves(b1, t ^ 1, R); if (om.length && om[0].caps.length) { const c = om.find(x => om.filter(y => y.f === x.f && y.t === x.t).length === 1); if (c) return [a.f, a.t, c.f, c.t]; } } return null; });
    for (let k = 0; line && k < 4; k += 2) { const n0 = (await st()).n, p = await h.sqc(line[k]), q = await h.sqc(line[k + 1]); await h.until(() => __dr.canInput()); await h.tap(p.x, p.y); await h.until(f => __dr.sel && __dr.sel.f === f, line[k]); await h.tap(q.x, q.y); await h.until(n => __dr.G.moves.length === n + 1 && !__dr.anim, n0); }
    const fin = await h.page.evaluate(() => [document.getElementById('kTop').textContent, document.getElementById('kBot').textContent].join());
    ok(!!line && fin !== '12,12', 'a capture was played before the review', fin);
    const n = (await st()).n;
    await h.tapEl('#bMenu'); await h.until(() => !document.querySelector('#ovMenu').classList.contains('hidden'));
    await h.tapEl('#mResign'); await h.until(() => !document.querySelector('#ovConfirm').classList.contains('hidden')); await h.tapEl('#cfYes');
    await h.until(() => !document.querySelector('#ovResult').classList.contains('hidden'));
    await h.tapEl('#rBoard'); await h.until(() => __dr.rv >= 0);
    ok(await h.page.evaluate(() => __dr.rv) === n && await h.page.evaluate(() => !document.querySelector('#rvBar').classList.contains('hidden')), 'review opens at the final position with its bar');
    await h.tapEl('#rvPrev'); await h.until(i => __dr.rv === i, n - 1);
    await h.tapEl('#rvFirst'); await h.until(() => __dr.rv === 0);
    ok(await h.page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(true)))) && await lit(h.page, C.initBoard()) === 24, 'review shows the start position (24 pieces drawn)');
    const bars = () => h.page.evaluate(() => [document.getElementById('kTop').textContent, document.getElementById('kBot').textContent, document.getElementById('cTop').childElementCount, document.getElementById('cBot').childElementCount].join());
    ok(await bars() === '12,12,0,0', 'round 2 [小／5]: in review the player bars show the reviewed position (start: 12 / 12, nothing taken)', await bars());
    await h.tapEl('#rvNext'); await h.until(() => __dr.rv === 1);
    ok((await h.page.evaluate(() => document.getElementById('rvPos').textContent)).startsWith('1／' + n), 'review counter', await h.page.evaluate(() => document.getElementById('rvPos').textContent));
    await h.tapEl('#rvExit'); await h.until(() => __dr.rv === -1 && !document.querySelector('#ovResult').classList.contains('hidden'));
    ok((await bars()).startsWith(fin), 'after the review the bars show the final position again', await bars());
  }
  // [細節] idle must-capture pulse is drawn at a low rate (upper bound only, so machine load cannot make it fail)
  {
    await h.tapEl('#rAgain'); await h.until(() => __dr.phase === 'play' && __dr.canInput() && !__dr.dealing);
    // play into a forced capture: 22-18 is answered by ... use the core to find a two-ply line that leaves a capture
    const line = await h.page.evaluate(() => { const R = RULES[__dr.cur.rule]; for (const a of genMoves(__dr.cur.b, 0, R)) { const b1 = applyMove(__dr.cur.b, a, 0); for (const b of genMoves(b1, 1, R)) { const b2 = applyMove(b1, b, 1); if (genMoves(b2, 0, R)[0].caps.length) return [a.f, a.t, b.f, b.t]; } } return null; });
    for (let k = 0; k < 4; k += 2) { const p = await h.sqc(line[k]), q = await h.sqc(line[k + 1]); await h.until(() => __dr.canInput()); await h.tap(p.x, p.y); await h.until(f => __dr.sel && __dr.sel.f === f, line[k]); await h.tap(q.x, q.y); await h.until(n => __dr.G.moves.length === n, k / 2 + 1); }
    await h.until(() => __dr.canInput() && __dr.legal[0].caps.length > 0 && !__dr.sel && !__dr.fxBusy && !__dr.dealing, null, 20000);
    const fr = await h.page.evaluate(() => new Promise(res => { let n = 0; const raw = window.requestAnimationFrame; window.requestAnimationFrame = cb => raw(t => { n++; cb(t); }); const t0 = performance.now(); setTimeout(() => { window.requestAnimationFrame = raw; res(n / ((performance.now() - t0) / 1000)); }, 1500); }));
    ok(fr <= 30, 'idle must-capture pulse redraws at most ~15 fps', fr.toFixed(1));
  }
  await h.ctx.close();
  // [小／2+7] short screens: compact bars give bigger cells; [小／7] 開始對局 is on screen without scrolling
  for (const vp of [{ width: 375, height: 500 }, { width: 390, height: 610 }, { width: 844, height: 390 }, { width: 640, height: 360 }, { width: 360, height: 640 }, { width: 390, height: 844 }]) {
    const p = await ctxOpen(vp);
    await p.until(() => !document.querySelector('#ovSetup').classList.contains('hidden'));
    const r = await p.page.evaluate(() => { const b = document.getElementById('sStart').getBoundingClientRect(), x = document.getElementById('sStats').getBoundingClientRect(); return { start: b.bottom <= innerHeight && b.top >= 0, stats: x.bottom <= innerHeight, ov: document.getElementById('ovSetup').scrollHeight <= innerHeight + 1, sw: document.documentElement.scrollWidth <= innerWidth }; });
    ok(r.start && r.stats && r.ov && r.sw, `${vp.width}×${vp.height}: whole start card fits, 開始對局 visible without scrolling`, r);
    await p.tapEl('#sStart'); await p.until(() => __dr.phase === 'play');
    const c = await p.page.evaluate(() => ({ cell: __dr.cell, short: document.body.classList.contains('short'), tools: [...document.querySelectorAll('.tools:not(.hidden) .tbtn')].every(b => b.getBoundingClientRect().height >= 44 && b.getBoundingClientRect().bottom <= innerHeight), sw: document.documentElement.scrollWidth <= innerWidth }));
    const minCell = vp.height === 500 ? 36 : vp.width === 360 ? 40 : 40;
    ok(c.cell >= minCell && c.tools && c.sw, `${vp.width}×${vp.height}: cell ${c.cell.toFixed(1)}px (≥${minCell}), toolbar ≥44px and on screen${c.short ? ', compact bars' : ''}`, c);
    await p.ctx.close();
  }
  // [小／3] a win after using 提示 is recorded as assisted and does not unlock 屠龍: saved game one move before a win vs L5
  {
    const line = (() => { const rng = C.seededRng(4242);
      for (let tr = 0; tr < 200; tr++) { let s = C.initState('br'); const mv = [];
        for (let ply = 0; ply < 160; ply++) { const ms = C.genMoves(s.b, s.turn, C.RULES.br); if (!ms.length) break;
          if (s.turn === 0) { const win = ms.find(m => { const o = C.statusOf(C.stepState(s, m)); return o.over && o.winner === 0 && ms.filter(x => x.f === m.f && x.t === m.t).length === 1; }); if (win) return { moves: mv, win }; }
          const m = s.turn === 0 ? C.think(s, 3, { depth: 3, ms: 200, rng }).move : ms[Math.floor(rng() * ms.length)];
          mv.push({ p: m.path.slice(), c: m.caps.slice() }); s = C.stepState(s, m); if (C.statusOf(s).over) break; } } return null; })();
    ok(!!line, 'found a won line for the assisted-win check');
    if (line) {
      const G0 = { rule: 'br', mode: 'ai', level: 5, human: 0, daily: false, day: 0, pre: 0, moves: line.moves, over: null, lone: false, hints: 1, undos: 0, maxCap: 0, date: Date.now() };
      const h2 = await ctxOpen(null, new Function('localStorage.setItem("draughts.game", ' + JSON.stringify(JSON.stringify(G0)) + ')'));
      await h2.until(() => __dr.phase === 'play' && __dr.canInput());
      const a = await h2.sqc(line.win.f), b = await h2.sqc(line.win.t);
      await h2.tap(a.x, a.y); await h2.until(f => __dr.sel && __dr.sel.f === f, line.win.f);
      await h2.tap(b.x, b.y);
      await h2.until(() => !document.querySelector('#ovResult').classList.contains('hidden'));
      const r = await h2.page.evaluate(() => JSON.parse(localStorage.getItem('draughts.stats')));
      ok(r.rec.br5 && r.rec.br5.w === 1 && r.rec.br5.a === 1 && !r.ach.master && r.ach.first, 'assisted win counted with an 輔助 mark, no 屠龍', r);
      ok(/悔棋／提示/.test(await h2.page.evaluate(() => document.getElementById('rSub').textContent)), 'result card says the win was assisted');
      await h2.ctx.close();
    }
  }
  await browser.close();
  ok(!errors.length, 'no page / console errors or external requests in the browser checks', errors.slice(0, 5));
  console.log(`browser checks: ${((Date.now() - T0) / 1000).toFixed(1)}s`);
}
