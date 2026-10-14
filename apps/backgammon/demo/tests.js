// Rule unit tests for 雙陸棋, run against the game's own core (CORE-START/CORE-END in ../index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const BG = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return BG;')();
let pass = 0, fail = 0;
function t(name, fn) { try { const r = fn(); if (r === true) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, r); } } catch (e) { fail++; console.log('  FAIL', name, e.stack); } }
// build a position from {own: {pt: n}, opp: {pt: n (in OWN numbering)}, bar, oppBar, off, oppOff}
function P(o) { const p = new Int8Array(28); for (const k in o.own || {}) p[k] = o.own[k]; for (const k in o.opp || {}) p[k] = -o.opp[k]; p[25] = o.bar || 0; p[0] = o.oppBar || 0; p[26] = o.off || 0; p[27] = o.oppOff || 0; return p; }
const plays = (p, a, b) => BG.genRoll(p, a, b);
const has = (ms, steps) => ms.some(m => JSON.stringify(m.steps.map(s => [s[0], s[1]]).sort()) === JSON.stringify(steps.slice().sort()));
const finals = ms => new Set(ms.map(m => BG.key(m.pos)));
const total = p => { let n = p[25] + p[26]; for (let i = 1; i <= 24; i++) if (p[i] > 0) n += p[i]; return n; };

console.log('Setup');
t('standard start: 15 checkers each, pip count 167 each', () => { const p = BG.initial('std'); return total(p) === 15 && total(BG.flip(p)) === 15 && BG.pips(p) === 167 && BG.oppPips(p) === 167 || [total(p), BG.pips(p), BG.oppPips(p)]; });
t('start layout 24:2 13:5 8:3 6:5 for both sides (mirrored)', () => { const p = BG.initial('std'); return p[24] === 2 && p[13] === 5 && p[8] === 3 && p[6] === 5 && p[1] === -2 && p[12] === -5 && p[17] === -3 && p[19] === -5; });
t('Nackgammon start 24:2 23:2 13:4 8:3 6:4, Hypergammon 3 checkers on 24/23/22', () => { const n = BG.initial('nack'), h = BG.initial('hyper'); return n[23] === 2 && n[13] === 4 && n[6] === 4 && total(n) === 15 && total(h) === 3 && h[22] === 1 && h[3] === -1; });
t('flip is an involution and swaps bars/off trays', () => { const p = P({ own: { 5: 2 }, opp: { 20: 3 }, bar: 1, oppBar: 2, off: 4, oppOff: 1 }); const q = BG.flip(p); return BG.key(BG.flip(q)) === BG.key(p) && q[25] === 2 && q[0] === 1 && q[26] === 1 && q[27] === 4 && q[5] === 3 && q[20] === -2; });

console.log('Moving');
t('opening 3-1: 8/5 6/5 is legal; 16 distinct plays', () => { const ms = plays(BG.initial(), 3, 1); return has(ms, [[8, 5], [6, 5]]) && ms.length === 16 || ms.length; });
t('opening 6-5: 24/13 (running) legal through 18', () => { const ms = plays(BG.initial(), 6, 5); return has(ms, [[24, 18], [18, 13]]) || has(ms, [[24, 19], [19, 13]]); });
t('cannot land on a point held by 2+ opposing checkers', () => { const ms = plays(P({ own: { 10: 1 }, opp: { 7: 2, 4: 2 } }), 3, 6); return ms.every(m => m.pos[7] !== 1 && m.pos[4] !== 1) || 'landed'; });
t('both dice must be used when possible', () => { const ms = plays(BG.initial(), 4, 2); return ms.every(m => m.steps.length === 2); });
t('combined move needs an open intermediate point', () => { // 24 with 6-5: both 18 and 19 blocked -> no 24/13
  const p = P({ own: { 24: 1, 6: 2 }, opp: { 18: 2, 19: 2 } }); const ms = plays(p, 6, 5); return ms.every(m => m.pos[13] !== 1) || 'reached 13'; });
t('only one die playable -> larger die must be played', () => { // checker on 9: 9-6=3 open, 9-4=5 open; after either, second die blocked
  const p = P({ own: { 9: 1 }, opp: { 5: 2, 3: 2, 1: 2, 7: 2 } }); // 6->3? blocked; build so 9/3 blocked: choose dice 4 & 2
  const q = P({ own: { 9: 1 }, opp: { 3: 2, 1: 2 } }); // 9/5 (4) then 5/3 blocked; 9/7 (2) then 7/3 blocked
  const ms = plays(q, 4, 2); void p;
  return ms.length === 1 && ms[0].steps.length === 1 && ms[0].steps[0][1] === 5 || JSON.stringify(ms.map(m => m.steps)); });
t('only the smaller die playable -> smaller is played', () => { const q = P({ own: { 9: 1 }, opp: { 5: 2, 3: 2, 1: 2 } }); const ms = plays(q, 4, 2); return ms.length === 1 && ms[0].steps[0][1] === 7 && ms[0].steps.length === 1 || JSON.stringify(ms.map(m => m.steps)); });
t('doubles move four times', () => { const ms = plays(BG.initial(), 2, 2); return ms.every(m => m.steps.length === 4) && ms.length === 75 || ms.length; });
t('doubles partially blocked: play as many as possible (2 of 4)', () => { const q = P({ own: { 20: 1 }, opp: { 14: 2 } }); const ms = plays(q, 3, 3); return ms.length === 1 && ms[0].steps.length === 1 && ms[0].pos[17] === 1 || JSON.stringify(ms.map(m => m.steps)); });
t('no legal move -> single empty play, position unchanged', () => { const q = P({ own: { 3: 1 }, bar: 1, opp: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 } }); const ms = plays(q, 6, 5); return ms.length === 1 && ms[0].steps.length === 0 && ms.maxLen === 0 && BG.key(ms[0].pos) === BG.key(q); });
t('duplicate final positions are merged', () => { const ms = plays(BG.initial(), 1, 2); return finals(ms).size === ms.length; });

console.log('Hitting and the bar');
t('landing on a blot hits it to the bar', () => { const ms = plays(P({ own: { 10: 1 }, opp: { 7: 1 } }), 3, 1); const m = ms.find(m => m.steps.some(s => s[1] === 7 && s[2] === 1)); return !!m && m.pos[0] === 1 && (m.pos[7] === 1 || m.pos[7] === 0) || 'no hit'; });
t('checker on the bar must enter before any other move', () => { const ms = plays(P({ own: { 6: 3 }, bar: 1 }), 4, 2); return ms.every(m => m.steps[0][0] === 25) && ms.every(m => m.pos[25] === 0); });
t('entry uses opponent home: die 6 enters on own 19 (opp 6-point)', () => { const ms = plays(P({ own: { 6: 3 }, bar: 1, opp: { 21: 2 } }), 6, 4); return ms.every(m => m.steps[0][1] === 19); });
t('two on the bar, one entry open: enter one and nothing else moves', () => { const q = P({ own: { 6: 3 }, bar: 2, opp: { 19: 2, 20: 2, 22: 2, 23: 2, 24: 2 } }); const ms = plays(q, 4, 3); return ms.length === 1 && ms[0].steps.length === 1 && ms[0].pos[25] === 1 && ms[0].pos[21] === 1 || JSON.stringify(ms.map(m => m.steps)); });
t('closed board: no entry, no move', () => { const q = P({ own: { 6: 3 }, bar: 1, opp: { 19: 2, 20: 2, 21: 2, 22: 2, 23: 2, 24: 2 } }); return plays(q, 1, 2)[0].steps.length === 0; });
t('enter then continue with the other die', () => { const ms = plays(P({ own: {}, bar: 1, opp: { 1: 2 } }), 6, 5); return ms.some(m => m.pos[14] === 1 || m.pos[13] === 1) || 'stuck'; });

console.log('Bearing off');
const home = o => P(Object.assign({ off: 15 - Object.values(o.own).reduce((a, b) => a + b, 0) }, o));
t('exact roll bears a checker off', () => { const ms = plays(home({ own: { 5: 1, 3: 1 } }), 5, 3); return ms.some(m => m.pos[26] === 15); });
t('higher die bears off from the highest point', () => { const ms = plays(home({ own: { 4: 1, 2: 1 } }), 6, 5); return ms.length === 1 && ms[0].pos[26] === 15 || JSON.stringify(ms.map(m => m.steps)); });
t('higher die cannot bear off a lower checker while a higher point is occupied', () => { const q = home({ own: { 5: 1, 2: 1 } }); const ms = plays(q, 6, 1); return ms.every(m => !m.steps.some(s => s[0] === 2 && s[1] === 0 && s[3] === 6 && m.pos[5] === 1)); });
t('no bearing off while a checker is outside home', () => { const q = P({ own: { 7: 1, 1: 5 }, off: 9 }); const ms = plays(q, 6, 6); return ms.every(m => m.steps.every(s => s[1] !== 0 || s[0] <= 6) && m.steps[0][0] === 7) && !BG.canOff(q); });
t('bear-off becomes legal mid-turn once the last checker is home', () => { const q = P({ own: { 8: 1, 3: 2 }, off: 12 }); const ms = plays(q, 5, 3); return ms.some(m => m.pos[26] === 13) || 'not allowed'; });
t('checker on the bar blocks bearing off', () => !BG.canOff(P({ own: { 1: 5 }, bar: 1, off: 9 })));
t('doubles bear off four checkers', () => { const ms = plays(home({ own: { 3: 4 } }), 3, 3); return ms.length === 1 && ms[0].pos[26] === 15; });

console.log('Results and scoring');
t('single win when loser has borne off a checker', () => BG.resultKind(P({ off: 15, opp: { 20: 3 }, oppOff: 1 })) === 1);
t('gammon when loser has borne off nothing', () => BG.resultKind(P({ off: 15, opp: { 20: 15 } })) === 2);
t('backgammon: loser still on the bar', () => BG.resultKind(P({ off: 15, opp: { 20: 14 }, oppBar: 1 })) === 3);
t('backgammon: loser still in winner\'s home board', () => BG.resultKind(P({ off: 15, opp: { 20: 14, 3: 1 } })) === 3);
t('points = cube x (1/2/3)', () => BG.gamePoints({ kind: 2, cube: 4 }) === 8 && BG.gamePoints({ kind: 3, cube: 2 }) === 6 && BG.gamePoints({ kind: 1, cube: 1 }) === 1);
t('refused double scores the cube before doubling', () => BG.gamePoints({ kind: 0, cube: 2, passed: true }) === 2);
t('Jacoby: gammon counts single only while the cube is centred (money play)', () => BG.gamePoints({ kind: 2, cube: 1, jacoby: true }) === 1 && BG.gamePoints({ kind: 3, cube: 2, jacoby: true }) === 6 && BG.gamePoints({ kind: 2, cube: 1, jacoby: true, match: 5 }) === 2);

console.log('Doubling cube and match rules');
const base = { side: 0, turn: 0, phase: 'pre', cube: { v: 1, owner: -1 }, matchLen: 0, score: [0, 0], crawford: 'pre' };
t('centred cube: either player may double before rolling', () => BG.canOffer(base) && BG.canOffer(Object.assign({}, base, { side: 1, turn: 1 })));
t('cannot double after rolling or on the opponent\'s turn', () => !BG.canOffer(Object.assign({}, base, { phase: 'move' })) && !BG.canOffer(Object.assign({}, base, { turn: 1 })));
t('take: cube doubles and goes to the taker; only the owner may redouble', () => { const c = BG.takeCube({ v: 2, owner: 0 }, 1); return c.v === 4 && c.owner === 1 && !BG.canOffer(Object.assign({}, base, { cube: c })) && BG.canOffer(Object.assign({}, base, { side: 1, turn: 1, cube: c })); });
t('cube stops at 64', () => !BG.canOffer(Object.assign({}, base, { cube: { v: 64, owner: 0 } })) && BG.canOffer(Object.assign({}, base, { cube: { v: 32, owner: 0 } })));
t('Crawford: next game after reaching match point-1 is Crawford, then post-Crawford', () => BG.nextCrawford('pre', [4, 2], 5) === 'now' && BG.nextCrawford('now', [4, 3], 5) === 'post' && BG.nextCrawford('post', [4, 4], 5) === 'post' && BG.nextCrawford('pre', [3, 2], 5) === 'pre');
t('no doubling in the Crawford game; allowed post-Crawford', () => !BG.canOffer(Object.assign({}, base, { matchLen: 5, score: [2, 4], crawford: 'now' })) && BG.canOffer(Object.assign({}, base, { matchLen: 5, score: [2, 4], crawford: 'post' })));
t('match equity table: symmetric, 50% at equal scores', () => Math.abs(BG.met(3, 3) - 0.5) < 1e-9 && Math.abs(BG.met(2, 5) + BG.met(5, 2) - 1) < 1e-9 && BG.met(1, 5) > 0.8);
t('post-Crawford trailer (opponent needs 1) doubles at once', () => { const p = BG.initial(); return BG.decideDouble({ pos: Array.from(p), level: 3, cube: { v: 1, own: 'mid' }, match: { len: 5, a: 3, b: 1 } }).double === true; });
t('Lv1 tourist never doubles and always takes', () => { const p = P({ own: { 1: 2 }, off: 13, opp: { 24: 15 } }); return !BG.decideDouble({ pos: Array.from(p), level: 1, cube: { v: 1, own: 'mid' } }).double && BG.decideTake({ pos: Array.from(BG.flip(p)), level: 1, cube: { v: 1 } }).take; });
t('Lv4 drops a hopeless double and takes an even one', () => { const p = P({ own: { 1: 2 }, off: 13, opp: { 24: 15 } }); const hopeless = BG.decideTake({ pos: Array.from(BG.flip(p)), level: 4, cube: { v: 1 } }); const even = BG.decideTake({ pos: Array.from(BG.initial()), level: 4, cube: { v: 1 } }); return !hopeless.take && even.take || JSON.stringify([hopeless, even]); });

console.log('Shots, dice, bearoff database');
const SHOTS = { 1: 11, 2: 12, 3: 14, 4: 15, 5: 15, 6: 17, 7: 6, 8: 6, 9: 5, 10: 3, 11: 2, 12: 3 };
t('direct/indirect shot counts on an open board match the standard table (1..12 pips)', () => { const bad = []; for (let d = 1; d <= 12; d++) { const a = P({ own: { 24: 1 }, opp: { [24 - d]: 1 } }); const n = Math.round(BG.shots(a)[0] * 36); if (n !== SHOTS[d]) bad.push(d + ':' + n); } return !bad.length || bad.join(' '); });
t('seeded dice are reproducible and fair (chi-square over 36,000 rolls)', () => { const c = new Array(36).fill(0); for (let k = 0; k < 36000; k++) { const [a, b] = BG.rollAt(12345, k); c[(a - 1) * 6 + b - 1]++; } let x2 = 0; for (const n of c) x2 += (n - 1000) ** 2 / 1000; const same = JSON.stringify(BG.rollAt(7, 3)) === JSON.stringify(BG.rollAt(7, 3)); return same && x2 < 65 || 'chi2=' + x2.toFixed(1); });
t('bearoff DB has 54,264 positions with a bijective rank', () => { const d = BG.buildDB(); const seen = new Uint8Array(d.NP); let n = 0; const c = [0, 0, 0, 0, 0, 0]; (function en(i, s) { if (i === 6) { const r = BG.dbRank(c); if (!seen[r]) { seen[r] = 1; n++; } return; } for (let v = 0; v <= s; v++) { c[i] = v; en(i + 1, s - v); } c[i] = 0; })(0, 15); return d.NP === 54264 && n === 54264 || [d.NP, n]; });
t('bearoff DB expected rolls: 1 checker on 6-pt = 1.25, two on 1-pt = 1', () => Math.abs(BG.dbExpected([0, 0, 0, 0, 0, 1]) - 1.25) < 1e-6 && Math.abs(BG.dbExpected([2, 0, 0, 0, 0, 0]) - 1) < 1e-6);
t('bearoff DB expected rolls grow with pips (15 on 6-pt > 15 on 1-pt)', () => BG.dbExpected([0, 0, 0, 0, 0, 15]) > BG.dbExpected([15, 0, 0, 0, 0, 0]));
console.log(`\n${pass} passed, ${fail} failed`);
console.log('Opening play counts (distinct final positions per roll, own generator):', BG.ROLLS.map(([a, b]) => a + '-' + b + ':' + plays(BG.initial(), a, b).length).join(' '));
console.log('Bearoff DB: ' + BG.buildDB().NP + ' positions; E[rolls] 15 checkers on 6-pt = ' + BG.dbExpected([0, 0, 0, 0, 0, 15]).toFixed(3) + ', on 1-pt = ' + BG.dbExpected([15, 0, 0, 0, 0, 0]).toFixed(3));
process.exitCode = fail ? 1 : 0;
