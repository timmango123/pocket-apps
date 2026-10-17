// Core tests for 誰是臥底／狼人殺主持 (werewolf-host). Loads the engine between the CORE markers of ../index.html.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const WH = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return WH;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const N = n => Array.from({ length: n }, (_, i) => 'P' + (i + 1));
// deterministic rng for reproducible deals: LCG
const lcg = seed => { let x = seed >>> 0; return n => { x = (x * 1664525 + 1013904223) >>> 0; return x % n; }; };

// --- random fairness (rejection sampling on crypto) ---
{
  const T = 70000, c = new Array(7).fill(0);
  for (let i = 0; i < T; i++) c[WH.randInt(7)]++;
  const dev = Math.max(...c.map(x => Math.abs(x / T - 1 / 7)));
  ok(dev < 0.008, 'randInt(7) uniform over 70000 draws (max dev ' + dev.toFixed(4) + ')');
  ok(WH.randInt(1) === 0 && WH.randInt(0) === 0, 'randInt(1)/randInt(0) return 0');
  let inRange = true; for (let i = 0; i < 5000; i++) { const v = WH.randInt(13); if (v < 0 || v >= 13 || v !== Math.floor(v)) inRange = false; }
  ok(inRange, 'randInt always within [0,n)');
  // n = 3 would show modulo bias without rejection: 2^32 mod 3 = 1, so bucket 0 would be favoured by only 1/2^32; test a huge n instead
  const big = 3000000000, cnt = [0, 0]; for (let i = 0; i < 20000; i++) cnt[WH.randInt(big) < big / 2 ? 0 : 1]++;
  ok(Math.abs(cnt[0] / 20000 - 0.5) < 0.02, 'randInt(3e9) halves evenly (' + cnt.join('/') + ')');
  // every permutation of a 4-shuffle appears with near-equal frequency
  const perm = {}; const P = 24, T2 = 48000;
  for (let i = 0; i < T2; i++) { const k = WH.shuffle([0, 1, 2, 3]).join(''); perm[k] = (perm[k] || 0) + 1; }
  const keys = Object.keys(perm);
  ok(keys.length === P && Math.max(...keys.map(k => Math.abs(perm[k] / T2 - 1 / P))) < 0.008, 'Fisher–Yates: all 24 permutations of 4 items, each ~1/24');
}

// --- word bank ---
{
  const all = WH.pool(WH.CATS, []);
  ok(WH.bankSize() >= 150 && all.length === WH.bankSize(), 'built-in bank has ' + WH.bankSize() + ' pairs (>=150)');
  ok(WH.CATS.length >= 5 && ['食物', '日常', '動物', '地點', '職業'].every(c => WH.CATS.includes(c)), 'categories include 食物 日常 動物 地點 職業');
  ok(all.every(p => p.length === 2 && p[0] && p[1] && p[0] !== p[1]), 'every pair has two different non-empty words');
  const seen = new Set(), dup = all.filter(p => { const k = p.slice().sort().join('/'); if (seen.has(k)) return true; seen.add(k); return false; });
  ok(dup.length === 0, 'no duplicate pairs ' + JSON.stringify(dup));
  const c = WH.parseCustom('珍珠奶茶／鮮奶茶\n老虎 獅子\n單獨一個\n\n貓, 狗\n同／同\n');
  ok(c.length === 3 && c[0][0] === '珍珠奶茶' && c[1][1] === '獅子' && c[2][0] === '貓', 'parseCustom: ／, space and comma separators; skips 1-word and identical lines');
  ok(WH.pool(['食物'], c).length === WH.BANK['食物'].length + 3 && WH.pool([], c).length === 3 && WH.pool(['不存在'], []).length === 0, 'pool merges categories and custom pairs');
}

// --- 誰是臥底: validation and dealing ---
{
  ok(WH.ucValidate(2, 1, 0) && WH.ucValidate(21, 1, 0) && WH.ucValidate(5, 0, 0), 'ucValidate rejects <3, >20 and 0 undercover');
  ok(!WH.ucValidate(3, 1, 0) && WH.ucValidate(3, 1, 1) && !WH.ucValidate(5, 1, 1) && WH.ucValidate(5, 2, 1) && !WH.ucValidate(20, 5, 4) && WH.ucValidate(20, 5, 5), 'ucValidate: under+blank <= floor((n-1)/2)');
  const d = WH.ucDeal(N(8), 2, 1, ['A', 'B'], lcg(7));
  const r = k => d.filter(p => p.role === k);
  ok(r('under').length === 2 && r('blank').length === 1 && r('civ').length === 5, 'deal 8 with 2 undercover + 1 blank');
  ok(r('civ').every(p => p.word === r('civ')[0].word) && r('under').every(p => p.word === r('under')[0].word) && r('civ')[0].word !== r('under')[0].word && r('blank')[0].word === '', 'civilians share one word, undercover the other, blank has none');
  ok(d.every((p, i) => p.i === i && p.name === 'P' + (i + 1) && p.alive), 'players keep seat order and names');
  // role positions and word side are uniformly random over many deals
  const pos = new Array(5).fill(0); let sideA = 0; const T = 20000;
  for (let i = 0; i < T; i++) { const g = WH.ucDeal(N(5), 1, 0, ['A', 'B']); pos[g.findIndex(p => p.role === 'under')]++; if (g.find(p => p.role === 'civ').word === 'A') sideA++; }
  ok(Math.max(...pos.map(x => Math.abs(x / T - 0.2))) < 0.015, 'undercover seat uniform over 20000 deals (' + pos.join('/') + ')');
  ok(Math.abs(sideA / T - 0.5) < 0.02, 'which word the civilians get is a coin flip (' + sideA + '/' + T + ')');
}

// --- 誰是臥底: game flow, secrecy of the pass/reveal cycle, win conditions ---
{
  const mk = (n, u, b, lastN, seed) => new WH.UCGame({ names: N(n), under: u, blank: b, pair: ['A', 'B'], lastN: lastN || 3, rnd: lcg(seed || 1) });
  let g = mk(6, 1, 0);
  ok(g.round === 1 && g.phase === 'speak' && g.order.length === 6 && new Set(g.order).size === 6, 'round 1: speaking order covers everyone once');
  const s = g.order[0]; ok(g.order.every((v, k) => v === (s + k) % 6), 'order goes clockwise from a random start');
  const starts = new Set(); for (let i = 0; i < 300; i++) starts.add(mk(6, 1, 0, 3, i).order[0]);
  ok(starts.size === 6, 'random start covers all seats over 300 games');
  let steps = 0; while (g.nextSpeaker()) steps++;
  ok(steps === 5 && g.phase === 'vote', 'after the last speaker the phase becomes vote');
  // civilians win by voting out the undercover
  const und = g.players.find(p => p.role === 'under');
  const r = g.eliminate(und.i);
  ok(r.player === und && r.result.over && r.result.winner === 'civ' && g.result.winner === 'civ', 'voting out the only undercover: civilians win');
  ok(g.eliminate(0) === null, 'no more eliminations after the game ends');
  ok(g.log.some(l => /淘汰 P\d+，身分是臥底（B|A）/.test(l.text)) && g.log[g.log.length - 1].tag === '結束', 'log records the elimination and the end');
  // undercover survives to last 3
  g = mk(6, 1, 0, 3);
  const civs = () => g.players.filter(p => p.alive && p.role === 'civ');
  g.phase = 'vote'; let res = g.eliminate(civs()[0].i);
  ok(!res.result.over && g.round === 2 && g.order.length === 5, 'civilian out: next round with 5 speakers');
  res = g.eliminate(civs()[0].i); res = g.eliminate(civs()[0].i);
  ok(res.result.over && res.result.winner === 'under' && /剩 3 人/.test(res.result.reason), 'undercover wins when 3 remain (lastN=3)');
  g = mk(6, 1, 0, 2); g.eliminate(civs()[0].i); g.eliminate(civs()[0].i); res = g.eliminate(civs()[0].i);
  ok(!res.result.over, 'with lastN=2 the game continues at 3 players');
  res = g.eliminate(civs()[0].i);
  ok(res.result.over && res.result.winner === 'under', '…and the undercover wins at 2');
  // undercover side >= civilians
  g = mk(7, 2, 1, 2); // 4 civ vs 3
  res = g.eliminate(civs()[0].i); // 3 civ vs 3 -> spies >= civ
  ok(res.result.over && res.result.winner === 'under' && /不少於平民/.test(res.result.reason), 'undercover side wins when it is not outnumbered');
  // blank guess
  g = mk(7, 1, 1, 3);
  const blank = g.players.find(p => p.role === 'blank');
  res = g.eliminate(blank.i);
  ok(res.guess === true && g.phase === 'guess' && g.pending.i === blank.i, 'eliminating the blank asks for a guess');
  ok(g.blankGuess(true).winner === 'blank' && g.result.winner === 'blank', 'correct guess: blank wins');
  g = mk(7, 1, 1, 3); g.eliminate(g.players.find(p => p.role === 'blank').i);
  res = g.blankGuess(false);
  ok(!res.over && g.round === 2 && g.result === null, 'wrong guess: game goes on');
  const u2 = g.players.find(p => p.role === 'under'); res = g.eliminate(u2.i);
  ok(res.result.winner === 'civ', 'then voting out the undercover wins for civilians');
  g = mk(7, 1, 1, 3); // only blank left on the spy side
  g.eliminate(g.players.find(p => p.role === 'under').i);
  ok(!g.result, 'undercover out but blank alive: game continues');
  g.eliminate(civs()[0].i); g.eliminate(civs()[0].i); res = g.eliminate(civs()[0].i);
  ok(res.result && res.result.winner === 'blank' && /白板撐到最後/.test(res.result.reason), 'blank alone surviving to 3 wins');
  ok(mk(6, 1, 0).civWord !== mk(6, 1, 0).undWord || true, 'civWord/undWord exposed');
  g = mk(6, 1, 0); ok(g.civWord !== g.undWord && ['A', 'B'].includes(g.civWord), 'civWord and undWord are the two words of the pair');
}

// --- 狼人殺: presets, validation, dealing ---
{
  const sum = r => WH.ROLE_ORDER.reduce((s, k) => s + r[k], 0);
  for (let n = 5; n <= 20; n++) { const r = WH.wwPreset(n); if (sum(r) !== n || WH.wwValidate(n, r)) ok(false, 'preset for ' + n + ' sums to n and validates: ' + JSON.stringify(r)); }
  ok(true, 'presets for 5–20 players sum to n and validate');
  const r6 = WH.wwPreset(6), r8 = WH.wwPreset(8), r10 = WH.wwPreset(10), r12 = WH.wwPreset(12);
  ok(r6.wolf === 2 && r6.seer === 1 && r6.witch === 1 && r6.villager === 2, '6 players: 2 wolves, seer, witch, 2 villagers');
  ok(r8.wolf === 2 && r8.hunter === 1 && r8.villager === 3, '8 players: adds hunter');
  ok(r10.wolf === 3 && r10.guard === 1 && r10.hunter === 1 && r10.villager === 3, '10 players: 3 wolves, seer witch hunter guard, 3 villagers');
  ok(r12.wolf === 4 && r12.villager === 4, '12 players: 4 wolves, 4 villagers');
  ok(WH.wwValidate(4, WH.wwPreset(4)) && WH.wwValidate(8, Object.assign(WH.wwPreset(8), { villager: 4 })) && WH.wwValidate(8, { wolf: 4, villager: 4 }) && WH.wwValidate(6, { wolf: 0, villager: 6 }), 'wwValidate rejects <5 players, wrong total, half wolves, no wolves');
  ok(!WH.wwValidate(7, { wolf: 2, wolfking: 1, villager: 2, seer: 1, witch: 1 }), 'custom roles with 狼王 validate');
  const d = WH.wwDeal(N(10), r10, lcg(3)), cnt = {}; d.forEach(p => cnt[p.role] = (cnt[p.role] || 0) + 1);
  ok(WH.ROLE_ORDER.every(k => (cnt[k] || 0) === r10[k]) && d.every((p, i) => p.i === i && p.alive), 'deal gives exactly the configured role counts');
  const seat = new Array(6).fill(0), T = 12000;
  for (let i = 0; i < T; i++) seat[WH.wwDeal(N(6), { wolf: 1, villager: 5 }).findIndex(p => p.role === 'wolf')]++;
  ok(Math.max(...seat.map(x => Math.abs(x / T - 1 / 6))) < 0.015, 'wolf seat uniform over 12000 deals (' + seat.join('/') + ')');
}

// --- 狼人殺: night resolution, every combination ---
{
  const R = a => WH.resolveNight(a).map(d => d.i + ':' + d.cause + (d.note ? '*' : '')).sort().join(',');
  ok(R({ wolf: 1, guard: null, save: false, poison: null }) === '1:wolf', 'wolf kill, nothing else: target dies');
  ok(R({ wolf: null, guard: null, save: false, poison: null }) === '', 'empty knife: nobody dies');
  ok(R({ wolf: 1, guard: 1, save: false, poison: null }) === '', 'guarded target survives');
  ok(R({ wolf: 1, guard: 2, save: false, poison: null }) === '1:wolf', 'guarding someone else does not help');
  ok(R({ wolf: 1, guard: null, save: true, poison: null }) === '', 'witch save: target survives');
  ok(R({ wolf: 1, guard: 1, save: true, poison: null }) === '1:wolf*', '同守同救: guarded and saved target dies');
  ok(R({ wolf: 1, guard: null, save: false, poison: 2 }) === '1:wolf,2:poison', 'wolf kill + poison: two deaths');
  ok(R({ wolf: 1, guard: 1, save: false, poison: 1 }) === '1:poison', 'poison kills through the guard');
  ok(R({ wolf: 1, guard: 1, save: false, poison: 2 }) === '2:poison', 'guarded target lives, poisoned one dies');
  ok(R({ wolf: null, guard: 3, save: false, poison: 3 }) === '3:poison', 'empty knife + poison on the guarded: poison still kills');
  ok(R({ wolf: 1, guard: null, save: true, poison: 1 }) === '1:poison', 'save then poison the same person (not allowed by the game, but resolves to poison)');
  ok(R({ wolf: 1, guard: 2, save: false, poison: 1 }) === '1:poison', 'wolf target also poisoned: recorded once as poison (no hunter shot)');
}

// --- 狼人殺: game flow rules (guard repeat, witch potions, seer, hunter, idiot, wolfking) and win conditions ---
{
  const mk = (roles, opt) => new WH.WWGame(Object.assign({ names: N(WH.ROLE_ORDER.reduce((s, k) => s + (roles[k] || 0), 0)), roles, rnd: lcg(5) }, opt || {}));
  const idx = (g, role, k) => g.players.filter(p => p.role === role && p.alive)[k || 0].i;
  let g = mk({ wolf: 2, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1 });
  ok(g.steps().map(s => s.id).join(',') === 'close,guard,wolf,witch,seer,dawn', 'night steps: close, guard, wolf, witch, seer, dawn');
  ok(mk({ wolf: 2, villager: 4 }).steps().map(s => s.id).join(',') === 'close,wolf,dawn', 'steps skip absent roles');
  // night 1: guard P_a, wolves kill villager, witch saves, seer checks a wolf
  const v0 = idx(g, 'villager', 0), v1 = idx(g, 'villager', 1), w0 = idx(g, 'wolf', 0), w1 = idx(g, 'wolf', 1);
  ok(g.setGuard(v0) && g.act.guard === v0, 'guard can protect anyone on night 1');
  ok(g.setWolf(v1), 'wolves pick a target');
  ok(g.seerCheck(w0) === 'wolf' && g.seerCheck(v0) === 'good' && g.seerCheck(w1) === 'wolf', 'seer sees wolf/good');
  ok(g.witchPoison(v0) && g.act.poison === v0 && !g.witchSave(true), 'after choosing poison the witch cannot also save');
  ok(g.witchPoison(null) && g.witchSave(true) && g.act.save && !g.witchPoison(v0), 'after choosing save the witch cannot also poison');
  let deaths = g.resolveNight();
  ok(deaths.length === 0 && g.phase === 'day' && g.witch.save === false && g.witch.poison === true, 'night 1 resolved: saved, antidote used up');
  ok(g.log.some(l => l.text === '女巫用解藥救 P' + (v1 + 1)) && g.log.some(l => /昨晚是平安夜/.test(l.text)), 'log: witch save and peaceful night');
  // day 1: vote nobody
  ok(g.vote(null).none && !g.result, 'tie vote: nobody out');
  g.startNight();
  ok(g.night === 2 && !g.guardOk(v0) && !g.setGuard(v0) && g.setGuard(v1), 'guard cannot protect the same player two nights in a row');
  ok(!g.witchSave(true), 'antidote cannot be used a second time');
  g.setWolf(v1); // guarded -> survives
  ok(g.witchPoison(w1), 'poison still available');
  deaths = g.resolveNight();
  ok(deaths.length === 1 && deaths[0].i === w1 && deaths[0].cause === 'poison' && !g.players[w1].alive && g.witch.poison === false, 'night 2: guarded target lives, poisoned wolf dies');
  ok(g.pending.length === 0, 'poisoned wolf: nothing pending');
  // day 2: vote out the hunter -> he shoots the last wolf -> good wins
  const h = idx(g, 'hunter');
  let r = g.vote(h);
  ok(r.player.role === 'hunter' && g.pending.length === 1 && g.pending[0].role === 'hunter' && !g.result, 'voted hunter gets a shot before the game can end');
  const shot = g.shoot(w0);
  ok(shot.length === 1 && !g.players[w0].alive && g.result && g.result.winner === 'good' && /狼人全部出局/.test(g.result.reason), 'hunter shoots the last wolf: good wins');

  // hunter killed by wolves shoots at dawn; poisoned hunter does not
  g = mk({ wolf: 1, villager: 3, hunter: 1, witch: 1 });
  g.setWolf(idx(g, 'hunter')); g.resolveNight();
  ok(g.pending.length === 1 && g.pending[0].type === 'shoot', 'hunter killed at night gets a shot');
  ok(g.shoot(null).length === 0 && g.pending.length === 0 && /沒有開槍/.test(g.log[g.log.length - 1].text), 'hunter may decline to shoot');
  g = mk({ wolf: 1, villager: 3, hunter: 1, witch: 1 });
  g.setWolf(null); g.witchPoison(idx(g, 'hunter')); g.resolveNight();
  ok(!g.players.find(p => p.role === 'hunter').alive && g.pending.length === 0, 'poisoned hunter cannot shoot');

  // idiot: survives the vote once, then counts as a normal villager-side death
  g = mk({ wolf: 2, villager: 3, idiot: 1, seer: 1 });
  const id = idx(g, 'idiot');
  g.setWolf(null); g.resolveNight();
  r = g.vote(id);
  ok(r.idiot && g.players[id].alive && g.players[id].idiotShown && !g.result, 'idiot flips and survives the vote');
  g.startNight(); g.setWolf(null); g.resolveNight();
  r = g.vote(id);
  ok(!r.idiot && !g.players[id].alive, 'second vote on the idiot kills him');

  // wolf king shoots when voted, not when killed at night
  g = mk({ wolf: 1, wolfking: 1, villager: 3, seer: 1, witch: 1 });
  const wk = idx(g, 'wolfking');
  g.setWolf(null); g.resolveNight(); g.vote(wk);
  ok(g.pending.length === 1 && g.pending[0].role === 'wolfking', 'voted wolf king gets a shot');
  g.shoot(idx(g, 'seer'));
  ok(!g.players.find(p => p.role === 'seer').alive && !g.result, 'wolf king takes the seer; game continues');
  g = mk({ wolf: 1, wolfking: 1, villager: 3, seer: 1, witch: 1 });
  g.setWolf(null); g.witchPoison(idx(g, 'wolfking')); g.resolveNight();
  ok(g.pending.length === 0, 'poisoned wolf king cannot shoot');

  // win conditions: 屠邊 vs 屠城
  const sideGame = (mode) => mk({ wolf: 2, villager: 2, seer: 1, witch: 1 }, { winMode: mode });
  g = sideGame('side'); g.setWolf(idx(g, 'villager', 0)); g.resolveNight(); ok(!g.result, '屠邊: one villager left, game continues');
  g.startNight(); g.setWolf(idx(g, 'villager', 0)); g.resolveNight();
  ok(g.result && g.result.winner === 'wolf' && /村民全部出局/.test(g.result.reason), '屠邊: all villagers dead -> wolves win');
  g = sideGame('side'); g.setWolf(idx(g, 'seer')); g.resolveNight(); g.startNight(); g.setWolf(idx(g, 'witch')); g.resolveNight();
  ok(g.result && /神職全部出局/.test(g.result.reason), '屠邊: all gods dead -> wolves win');
  g = sideGame('all'); g.setWolf(idx(g, 'villager', 0)); g.resolveNight(); g.startNight(); g.setWolf(idx(g, 'villager', 0)); g.resolveNight();
  ok(g.result && /狼人人數不少於好人/.test(g.result.reason), '屠城: 2 wolves vs 2 gods -> wolves win by numbers (not by side)');
  g = mk({ wolf: 1, villager: 3, seer: 1, witch: 1 }, { winMode: 'all' });
  g.setWolf(idx(g, 'villager', 0)); g.resolveNight(); g.startNight(); g.setWolf(idx(g, 'villager', 0)); g.resolveNight(); g.startNight(); g.setWolf(idx(g, 'villager', 0)); g.resolveNight();
  ok(!g.result, '屠城: villagers all dead but 2 gods vs 1 wolf -> continues');
  g.startNight(); g.setWolf(idx(g, 'seer')); g.resolveNight();
  ok(g.result && g.result.winner === 'wolf', '屠城: 1 wolf vs 1 god -> wolves win');
  g = mk({ wolf: 2, villager: 4 });
  ok(!g.hasGods, 'no gods configured: 屠邊 ignores the god side');
  g.setWolf(idx(g, 'villager', 0)); g.resolveNight(); ok(!g.result, '…and does not end immediately');
  g = mk({ wolf: 1, villager: 3, seer: 1 }); g.setWolf(null); g.resolveNight(); r = g.vote(idx(g, 'wolf'));
  ok(g.result && g.result.winner === 'good' && g.vote(0) === null, 'voting out the last wolf ends the game; no further votes');
  // guard + witch save edge case through the full game object
  g = mk({ wolf: 1, villager: 3, witch: 1, guard: 1 });
  const t = idx(g, 'villager', 0); g.setGuard(t); g.setWolf(t); g.witchSave(true); deaths = g.resolveNight();
  ok(deaths.length === 1 && deaths[0].note === '同守同救' && !g.players[t].alive, 'game: 同守同救 target dies');
  ok(g.log.filter(l => l.tag === '第1夜').length >= 4, 'log has an entry per night action');
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
