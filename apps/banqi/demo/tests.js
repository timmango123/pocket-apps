// Rule tests for 象棋暗棋 (banqi). Extracts the engine between CORE markers of ../index.html and checks every rule in the spec.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const BQ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BQ;')();
const { mk, MOVE, CAP, FLIP, END, HID } = BQ;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
// code helpers: R(t) red, K(t) black; types 1兵 2炮 3馬 4車 5相 6仕 7帥
const R = t => t, K = t => 8 + t;
const sq = (r, c) => r * 4 + c;
// Build a state: pieces = {sq: code}, hidden = {sq: code-for-pool}, turn
function pos(pieces, turn, v, hidden) {
  const st = BQ.newState(v || {});
  st.b.fill(0); st.pool.fill(0); st.cnt.fill(0); st.alive = [0, 0]; st.hidden = 0; st.turn = turn;
  for (const s in pieces) { const c = pieces[s]; st.b[s] = c; st.cnt[c]++; st.alive[c >> 3]++; }
  for (const s in (hidden || {})) { const c = hidden[s]; st.b[s] = HID; st.pool[c]++; st.cnt[c]++; st.alive[c >> 3]++; st.hidden++; }
  return st;
}
const moves = st => BQ.gen(st, [], false, false);
const has = (st, f, t, k) => moves(st).indexOf(mk(f, t, k)) >= 0;
function gameAt(st, pcol) { const g = new BQ.Game({ seed: 1, v: st.v }); g.st = st; g.pcol = pcol || [0, 1]; g.keys = [BQ.posKey(st)]; return g; }

// --- setup / dealing ---
{
  const d = BQ.newDeal(42), cnt = {};
  d.forEach(c => cnt[c] = (cnt[c] || 0) + 1);
  ok(d.length === 32 && cnt[1] === 5 && cnt[9] === 5 && cnt[7] === 1 && cnt[15] === 1 && cnt[2] === 2 && cnt[14] === 2, '32 pieces: 5 soldiers, 2 of each, 1 general per side');
  ok(JSON.stringify(BQ.newDeal(42)) === JSON.stringify(d) && JSON.stringify(BQ.newDeal(43)) !== JSON.stringify(d), 'seeded shuffle reproducible');
  const st = BQ.newState({}), m = moves(st);
  ok(m.length === 32 && m.every(x => (x >> 10) === FLIP), 'opening: exactly 32 legal actions, all flips');
  let distinct = 0; for (let c = 1; c < 16; c++) if (st.pool[c]) distinct++;
  ok(distinct === 14, 'opening chance node has 14 distinct outcomes');
}
// --- rank captures ---
{
  const t = (a, b) => has(pos({ [sq(3, 1)]: R(a), [sq(3, 2)]: K(b) }, 0), sq(3, 1), sq(3, 2), CAP);
  ok(t(7, 6) && !t(6, 7), '帥 eats 仕; 仕 cannot eat 將');
  ok(t(6, 6) && t(4, 4) && t(3, 3) && t(1, 1), 'equal ranks can capture each other');
  ok(t(5, 4) && t(4, 3) && t(3, 2) && !t(3, 4) && !t(2, 3), 'higher eats lower, lower cannot eat higher (non-cannon)');
  ok(t(1, 7), '兵 eats 將 (exception)');
  ok(!t(7, 1), '帥 cannot eat 卒 (exception)');
  ok(!t(1, 2) && !t(1, 6), '兵 cannot eat other higher pieces');
  ok(!has(pos({ [sq(3, 1)]: R(7), [sq(4, 2)]: K(1) }, 0), sq(3, 1), sq(4, 2), CAP), 'no diagonal capture');
  const s2 = pos({ [sq(3, 1)]: R(7) }, 0, {}, { [sq(3, 2)]: K(1) });
  ok(!moves(s2).some(m => (m >> 10) === CAP), 'cannot capture a hidden piece');
  ok(!has(pos({ [sq(3, 1)]: R(6), [sq(3, 2)]: R(1) }, 0), sq(3, 1), sq(3, 2), CAP), 'cannot capture own piece');
  const s3 = pos({ [sq(3, 1)]: R(4) }, 0);
  ok(moves(s3).length === 4 && !has(s3, sq(3, 1), sq(5, 1), MOVE), 'normal pieces move exactly one step orthogonally');
}
// --- cannon ---
{
  const C = sq(0, 0);
  ok(has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7) }, 0), C, sq(2, 0), CAP), '炮 jumps one screen and eats 將');
  ok(has(pos({ [C]: R(2), [sq(5, 0)]: K(6) }, 0, {}, { [sq(2, 0)]: K(1) }), C, sq(5, 0), CAP), 'hidden piece works as screen, empty squares around are skipped');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(6) }, 0), C, sq(1, 0), CAP), '炮 cannot eat an adjacent piece');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(3), [sq(3, 0)]: K(7) }, 0), C, sq(3, 0), CAP), '炮 cannot jump two screens');
  const s4 = pos({ [C]: R(2), [sq(1, 0)]: K(3) }, 0, {}, { [sq(2, 0)]: K(6) });
  ok(!moves(s4).some(m => (m >> 10) === CAP), '炮 cannot capture a hidden piece');
  ok(!has(pos({ [C]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: R(6) }, 0), C, sq(2, 0), CAP), '炮 cannot capture own piece');
  ok(has(pos({ [C]: R(2), [sq(0, 1)]: R(3), [sq(0, 3)]: K(1) }, 0), C, sq(0, 3), CAP), '炮 captures along a row, own piece as screen');
  const s5 = pos({ [sq(3, 1)]: R(2) }, 0);
  ok(moves(s5).filter(m => (m >> 10) === MOVE).length === 4 && !has(s5, sq(3, 1), sq(5, 1), MOVE), '炮 moves only one step');
  ok(has(pos({ [sq(3, 1)]: R(3), [sq(3, 2)]: K(2) }, 0), sq(3, 1), sq(3, 2), CAP) && !has(pos({ [sq(3, 1)]: R(1), [sq(3, 2)]: K(2) }, 0), sq(3, 1), sq(3, 2), CAP), '炮 is captured by rank>=2 adjacent pieces, not by 兵');
}
// --- variants ---
{
  const v = { noKing: true };
  ok(!has(pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7) }, 0, v), sq(0, 0), sq(2, 0), CAP), 'variant 炮不可吃帥 forbids cannon on general');
  ok(has(pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(6) }, 0, v), sq(0, 0), sq(2, 0), CAP), '…but cannon still eats others');
  const rush = pos({ [sq(0, 0)]: R(4), [sq(4, 0)]: K(3), [sq(6, 0)]: K(1) }, 0, { rush: true });
  ok(has(rush, sq(0, 0), sq(3, 0), MOVE) && has(rush, sq(0, 0), sq(4, 0), CAP) && !has(rush, sq(0, 0), sq(6, 0), CAP), 'variant 車直衝: slides over empties, captures first piece only');
  ok(!has(pos({ [sq(0, 0)]: R(4), [sq(4, 0)]: K(3) }, 0), sq(0, 0), sq(4, 0), CAP), 'without 車直衝 the rook moves one step');
  // chain capture
  const ch = pos({ [sq(2, 1)]: R(4), [sq(2, 2)]: K(3), [sq(2, 3)]: K(2), [sq(7, 3)]: K(1) }, 0, { chain: true });
  BQ.make(ch, mk(sq(2, 1), sq(2, 2), CAP), 0);
  const cm = moves(ch);
  ok(ch.turn === 0 && ch.chain === sq(2, 2) && cm.length === 2 && cm.indexOf(mk(sq(2, 2), sq(2, 3), CAP)) >= 0 && cm.indexOf(mk(sq(2, 2), sq(2, 2), END)) >= 0, 'variant 連吃: same piece may continue capturing or end');
  BQ.make(ch, mk(sq(2, 2), sq(2, 2), END), 0);
  ok(ch.turn === 1 && ch.chain === -1, '結束連吃 passes the turn');
  const nc = pos({ [sq(2, 1)]: R(4), [sq(2, 2)]: K(3), [sq(2, 3)]: K(2), [sq(7, 3)]: K(1) }, 0, {});
  BQ.make(nc, mk(sq(2, 1), sq(2, 2), CAP), 0);
  ok(nc.turn === 1 && nc.chain === -1, 'without 連吃 the turn passes after a capture');
}
// --- color from first flip, turn order ---
{
  for (const first of [0, 1]) {
    const g = new BQ.Game({ seed: 777, v: {}, first });
    ok(g.player() === first, 'first player ' + first + ' moves first');
    const rec = g.play(mk(13, 13, FLIP));
    const col = g.deal[13] >> 3;
    ok(rec && g.pcol[first] === col && g.pcol[1 - first] === 1 - col && g.st.turn === 1 - col && g.player() === 1 - first, 'first flipped piece decides flipper color (first=' + first + ')');
  }
}
// --- win / loss / draw ---
{
  const st = pos({ [sq(0, 0)]: R(7), [sq(0, 1)]: K(3) }, 0);
  const g = gameAt(st); g.play(mk(sq(0, 0), sq(0, 1), CAP));
  ok(g.result && g.result.winner === 0 && g.result.reason === 'all', 'capturing the last enemy piece wins');
  // stuck: black to move, black soldier boxed by red horses, no hidden pieces
  const st2 = pos({ [sq(0, 0)]: K(1), [sq(0, 1)]: R(3), [sq(1, 0)]: R(3), [sq(7, 3)]: R(5), [sq(6, 3)]: R(6) }, 0);
  const g2 = gameAt(st2); g2.play(mk(sq(6, 3), sq(5, 3), MOVE));
  ok(g2.result && g2.result.winner === 0 && g2.result.reason === 'stuck', 'side to move with no legal action loses');
  // not stuck while a hidden piece remains (flip is always possible)
  const st3 = pos({ [sq(0, 0)]: K(1), [sq(0, 1)]: R(3), [sq(1, 0)]: R(3), [sq(7, 3)]: R(5), [sq(6, 3)]: R(6) }, 0, {}, { [sq(4, 2)]: R(2) });
  const g3 = gameAt(st3); g3.play(mk(sq(6, 3), sq(5, 3), MOVE));
  ok(!g3.result, 'a boxed side can still flip, so it is not lost');
  // 50 rounds (100 plies) without flip/capture
  const st4 = pos({ [sq(0, 0)]: R(5), [sq(7, 3)]: K(5) }, 0); st4.np = 99;
  const g4 = gameAt(st4); g4.play(mk(sq(0, 0), sq(1, 0), MOVE));
  ok(g4.result && g4.result.draw && g4.result.reason === 'np', '50 rounds without flip or capture is a draw');
  const st5 = pos({ [sq(0, 0)]: R(5), [sq(7, 3)]: K(5) }, 0, {}, { [sq(4, 1)]: R(1) }); st5.np = 99;
  const g5 = gameAt(st5); g5.play(mk(sq(4, 1), sq(4, 1), FLIP));
  ok(!g5.result && g5.st.np === 0, 'a flip resets the 50-round counter');
  const st6 = pos({ [sq(0, 0)]: R(5), [sq(0, 1)]: K(4), [sq(7, 3)]: K(5) }, 0); st6.np = 99;
  const g6 = gameAt(st6); g6.play(mk(sq(0, 0), sq(0, 1), CAP));
  ok(!g6.result && g6.st.np === 0, 'a capture resets the 50-round counter');
}
// --- long chase (長追) ---
{
  const build = v => gameAt(pos({ [sq(2, 0)]: R(4), [sq(0, 0)]: K(3), [sq(7, 3)]: K(5), [sq(7, 0)]: R(5) }, 0, v));
  const seq = [[8, 4], [0, 1], [4, 5], [1, 0], [5, 4], [0, 1], [4, 5], [1, 0], [5, 4], [0, 1], [4, 5], [1, 0]];
  const g = build({ longChase: true });
  let okSeq = true;
  for (const [f, t] of seq) if (!g.play(mk(f, t, MOVE))) okSeq = false;
  ok(okSeq && g.chase[0].c === 6 && !g.result, 'rook chased the horse 6 times, position repeating, no draw (one-sided chase)');
  ok(g.isForbidden(mk(5, 4, MOVE)) && g.legal().indexOf(mk(5, 4, MOVE)) < 0, '7th repeating chase move is forbidden (長追須變著)');
  ok(g.legal().indexOf(mk(5, 6, MOVE)) >= 0, 'other moves stay legal');
  const g2 = build({ longChase: false });
  for (const [f, t] of seq) g2.play(mk(f, t, MOVE));
  ok(!g2.isForbidden(mk(5, 4, MOVE)), 'with 長追 off the chase continues (50-round rule handles it)');
  // only-forbidden moves -> loss
  const g3 = build({ longChase: true }); for (const [f, t] of seq) g3.play(mk(f, t, MOVE));
  g3.isForbidden = () => true; const r3 = g3.judge();
  ok(r3 && r3.winner === 1 && r3.reason === 'chase', 'if every move is a forbidden chase, the chaser loses');
  // mutual chase threefold -> draw: two rooks chase each other
  const gm = gameAt(pos({ [sq(0, 0)]: R(4), [sq(0, 2)]: K(4), [sq(7, 3)]: K(5), [sq(7, 0)]: R(5) }, 0, { longChase: true }));
  const ms = [[0, 4], [2, 6], [4, 0], [6, 2], [0, 4], [2, 6], [4, 0], [6, 2]];
  let rr = null; for (const [f, t] of ms) { gm.play(mk(f, t, MOVE)); if (gm.result) { rr = gm.result; break; } }
  ok(!rr, 'non-chasing repetition is not a draw by itself');
  // same repetition, but with both sides recorded as chasing (each side's last move attacked an enemy piece) -> draw
  gm.chase = [{ c: 2, t: 1 }, { c: 2, t: 2 }]; const dr = gm.judge();
  ok(dr && dr.draw && dr.reason === 'rep', 'both sides only chasing + 3-fold repetition is a draw');
}
// --- undo keeps the same hidden truth ---
{
  const g = new BQ.Game({ seed: 99, v: {}, first: 0 });
  g.play(mk(10, 10, FLIP)); const c1 = g.st.b[10];
  g.undo(); ok(g.st.b[10] === HID && g.st.hidden === 32 && g.pcol[0] === -1, 'undo re-hides the flipped piece');
  g.play(mk(10, 10, FLIP)); ok(g.st.b[10] === c1, 'flipping the same square after undo gives the same piece (no re-roll cheating)');
  // replay from serialized moves
  for (let i = 0; i < 30 && !g.result; i++) { const L = g.legal(); g.play(L[(i * 7) % L.length]); }
  const g2 = BQ.Game.load(JSON.parse(JSON.stringify(g.serialize())));
  ok(g2 && BQ.posKey(g2.st) === BQ.posKey(g.st) && g2.st.np === g.st.np, 'saved game replays to the identical position');
}
// --- engine fairness: decision depends only on the public state ---
{
  const sq0 = 5; let a = null, b = null;
  for (let s = 1; s < 5000 && !b; s++) { const d = BQ.newDeal(s); if (!a) { a = { s, d }; continue; } if (d[sq0] === a.d[sq0] && d.join() !== a.d.join()) b = { s, d }; }
  const gA = new BQ.Game({ seed: a.s, v: {} }), gB = new BQ.Game({ seed: b.s, v: {} });
  gA.play(mk(sq0, sq0, FLIP)); gB.play(mk(sq0, sq0, FLIP));
  const pA = gA.publicState(), pB = gB.publicState();
  ok(!('deal' in pA) && pA.b.filter(x => x === HID).length === 31, 'public state handed to the engine has no deal, hidden squares are opaque');
  const o = { depth: 3, ms: 100000, seed: 5, fk: 6 };
  const rA = BQ.think(pA, o), rB = BQ.think(pB, o);
  ok(gA.deal.join() !== gB.deal.join() && rA.move === rB.move && rA.score === rB.score, 'engine picks the same move for two different hidden deals with the same public view');
}
// --- engine sanity: takes a free general, levels answer within budget ---
{
  const st = pos({ [sq(3, 1)]: R(1), [sq(3, 2)]: K(7), [sq(7, 3)]: K(1), [sq(0, 0)]: R(1) }, 0);
  ok(BQ.think(st, { depth: 3, ms: 2000 }).move === mk(sq(3, 1), sq(3, 2), CAP), 'engine has the soldier take the general');
  const st2 = pos({ [sq(0, 0)]: R(2), [sq(1, 0)]: K(3), [sq(2, 0)]: K(7), [sq(7, 3)]: K(1), [sq(6, 3)]: R(5) }, 0);
  ok(BQ.think(st2, { depth: 3, ms: 2000 }).move === mk(sq(0, 0), sq(2, 0), CAP), 'engine finds the cannon jump onto the general');
  // a midgame position from a real game
  const g = new BQ.Game({ seed: 2026, v: {} });
  for (let i = 0; i < 24 && !g.result; i++) { const r = BQ.think(g.publicState(), { depth: 2, ms: 200, seed: i }); g.play(r.move); }
  const times = [];
  for (let L = 1; L <= 5; L++) {
    const lv = Object.assign({}, BQ.LEVELS[L], { seed: 1 });
    const r = BQ.think(g.publicState(), lv);
    times.push('Lv' + L + ' ' + r.ms + 'ms d' + r.depth);
    ok(r.ms <= lv.ms * 1.1 + 30, 'Lv' + L + ' answers within its time budget (' + r.ms + 'ms of ' + lv.ms + ')');
  }
  console.log('think times on a midgame position:', times.join(', '));
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
