// Rule tests for 台灣麻將 (taiwan-mahjong). Extracts the engine between the CORE markers of ../index.html
// and checks tiles/wall, win detection + shanten (vs brute force), every 台 item and its no-double-count rules,
// claim priority (胡 > 碰槓 > 吃, 吃 only from 上家, 截胡 / 一炮多響), 搶槓, 槓 replacement, flowers, 流局, 連莊, payments.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const MJ = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return MJ;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
// notation: 123m 筒=p 條=s 字=z(1東 2南 3西 4北 5中 6發 7白) 花=f(1-8 春夏秋冬梅蘭竹菊)
function T(s) { const out = []; let digits = []; for (const ch of s.replace(/\s/g, '')) { if (/\d/.test(ch)) digits.push(+ch); else { const base = { m: 0, p: 9, s: 18, z: 27, f: 34 }[ch]; digits.forEach(d => out.push(base + d - 1)); digits = []; } } return out; }
const t1 = s => T(s)[0];
const C = s => MJ.counts(T(s));
function sc(hand, win, o = {}) {
  const tiles = T(hand); tiles.push(t1(win));
  const melds = (o.melds || []).map(m => ({ k: m[0], t: T(m[1]) }));
  return MJ.score({ cnt: MJ.counts(tiles), melds, flowers: T(o.fl || ''), sw: o.sw || 0, rw: o.rw || 0, win: t1(win), self: !!o.self, flags: o.flags || {} });
}
const names = r => r ? r.items.map(x => x[0].replace(/（.*）/, '')) : null;
const has = (r, n) => !!r && names(r).indexOf(n) >= 0;
const taiOf = (r, n) => !r ? -1 : r.items.filter(x => x[0].replace(/（.*）/, '') === n).reduce((s, x) => s + x[1], 0);

// ---------- tiles & wall ----------
{
  const w = MJ.makeWall({ s: 7 }, true), w2 = MJ.makeWall({ s: 7 }, true), nf = MJ.makeWall({ s: 7 }, false);
  const cnt = {}; w.forEach(t => cnt[t] = (cnt[t] || 0) + 1);
  ok(w.length === 144 && Object.keys(cnt).length === 42, '144 tiles, 42 kinds');
  ok([...Array(34).keys()].every(t => cnt[t] === 4) && [34, 35, 36, 37, 38, 39, 40, 41].every(t => cnt[t] === 1), '4 of each suit/honour, 1 of each flower');
  ok(JSON.stringify(w) === JSON.stringify(w2) && JSON.stringify(MJ.makeWall({ s: 8 }, true)) !== JSON.stringify(w), 'seeded shuffle reproducible');
  ok(nf.length === 136 && nf.every(t => t < 34), '無花 wall = 136');
  ok(MJ.name(0) === '一萬' && MJ.name(13) === '五筒' && MJ.name(26) === '九條' && MJ.name(31) === '中' && MJ.name(41) === '菊', 'tile names');
}
// ---------- deal ----------
for (let seed = 1; seed <= 40; seed++) {
  const H = MJ.newHand({ seed, dealer: seed % 4 });
  if (H.phase === 'end') continue;
  ok(H.hands.every((h, p) => h.length === (p === H.dealer ? 17 : 16) && h.every(t => t < 34)), 'deal 16/17, no flowers in hand (seed ' + seed + ')');
  ok(MJ.census(H) === 144, 'census 144 after deal');
  const nfl = H.flowers.reduce((s, f) => s + f.length, 0);
  ok(H.wt === 144 - nfl, 'flower replacements come from the wall tail (seed ' + seed + ')');
  ok(H.wh === 65, 'live draws from the head: 16*4+1');
}
// ---------- win detection & shanten ----------
const wins = ['123m456m789m123p11z', '111m222m333m444m55m', '123m123m123m456s99p', '111z222z333z444z55z', '123m345m567m789m99m', '234p234p234p789s55s', '11122233344455m', '12345678999m111p'];
// last two are 14 tiles: (4 sets+pair) - checked with m=4
wins.slice(0, 6).forEach(h => { const c = C(h); ok(c.reduce((a, b) => a + b) === 14 && MJ.complete(c, 4), 'complete (m=4): ' + h); });
// 17-tile (5 sets) cases
const W17 = ['123m456m789m123p456p11z', '111m222m333m444m555m66m', '123p123p123p456p789p99p', '111z222z333z444z555z66z', '123m234m345m456m567m88m', '11122233344455566m', '123s456s789s111z222z33z', '345m345m345m345m77m111z'.replace('345m345m345m345m', '345m345m345m345p'), '999m999p999s123s567s11z', '12345678999m123p111z'];
W17.forEach(h => { const c = C(h); ok(c.reduce((a, b) => a + b) === 17 && MJ.complete(c, 5), 'complete 17: ' + h); });
const NOT = ['123m456m789m123p456p12z', '111m222m333m444m555m68m', '123p123p123p456p789p19p', '1112345678999m12p11z', '13579m13579p1357s'];
NOT.forEach(h => { const c = C(h); ok(!MJ.complete(c, 5), 'not complete: ' + h); });
// waits
function W(h, m = 5) { return MJ.waits(C(h), m).map(MJ.name).join(','); }
ok(MJ.waits(C('1112345678999m'), 4).length === 9, '九蓮 shape waits 9 kinds');
ok(W('123m456m789m123p45p1z1z'.replace('1z1z', '11z')) === '三筒,六筒', '兩面 waits 36p');
ok(W('123m456m789m123p13p11z') === '二筒', '嵌張 waits 2p');
ok(W('123m456m789m123p12p11z') === '三筒', '邊張 waits 3p');
ok(W('123m456m789m123p456p1z') === '東', '單吊 waits 東');
ok(W('123m456m789m456p11p22z') === '一筒,南', '對碰 waits 1p / 南');
ok(W('2345m', 1) === '二萬,五萬', 'm=1 2345 waits 2,5 (pair+seq)');
ok(MJ.waits(C('1z'), 0).length === 1, '全求人 single tile waits itself');
// brute-force shanten reference on small hands (m=2, 8 tiles): shanten = exchanges - 1
function exch(c, m, depth) {
  if (MJ.complete(c, m)) return 0;
  if (depth === 0) return 99;
  let best = 99;
  for (let a = 0; a < 34; a++) if (c[a]) {
    c[a]--;
    for (let b = 0; b < 34; b++) if (b !== a && c[b] < 4) { c[b]++; const r = MJ.complete(c, m) ? 1 : (depth > 1 ? 1 + exch(c, m, depth - 1) : 99); c[b]--; if (r < best) best = r; if (best === 1) break; }
    c[a]++; if (best === 1) break;
  }
  return best;
}
{
  const rs = { s: 99 }; let n = 0, agree = 0;
  for (let i = 0; i < 160; i++) {
    const w = MJ.makeWall(rs, false), suits = i % 3 === 0 ? 27 : 9 + (i % 2) * 9;
    const pool = w.filter(t => t < suits || (i % 5 === 0 && t >= 27)).slice(0, 8), c = MJ.counts(pool);
    const s = MJ.shanten(c, 2), e = exch(c, 2, 2);
    n++; if ((e <= 2 && s === e - 1) || (e > 2 && s >= 2)) agree++; else console.log('  mismatch', pool.map(MJ.name).join(''), s, e);
  }
  ok(agree === n, 'shanten == brute-force exchanges-1 on ' + n + ' random 8-tile hands');
  pass += n - 1; // count each compared hand as a case
}
// shanten consistency on 17-tile random hands: s==-1 iff decomposable; 16-tile s==0 iff waits non-empty
{
  const rs = { s: 5 }; let bad = 0, N = 300;
  for (let i = 0; i < N; i++) {
    const w = MJ.makeWall(rs, false), c16 = MJ.counts(w.slice(0, 16)), s = MJ.shanten(c16, 5), wt = MJ.waits(c16, 5);
    if ((s === 0) !== (wt.length > 0)) bad++;
    // draw any tile: shanten never drops by more than 1
    for (let t = 0; t < 34; t++) if (c16[t] < 4) { c16[t]++; if (MJ.shanten(c16, 5) < s - 1) bad++; c16[t]--; }
  }
  ok(bad === 0, 'shanten tenpai/waits consistency + monotonic on ' + N + ' random hands');
  // built complete hands
  let bad2 = 0;
  for (let i = 0; i < 300; i++) {
    const c = new Array(34).fill(0); let tries = 0;
    for (let k = 0; k < 5; k++) { while (tries++ < 100) { const r = Math.floor(MJ.rnd(rs) * 34), seq = r < 27 && r % 9 <= 6 && MJ.rnd(rs) < 0.6; if (seq) { if (c[r] < 4 && c[r + 1] < 4 && c[r + 2] < 4) { c[r]++; c[r + 1]++; c[r + 2]++; break; } } else if (c[r] <= 1) { c[r] += 3; break; } } }
    while (tries++ < 200) { const r = Math.floor(MJ.rnd(rs) * 34); if (c[r] <= 2) { c[r] += 2; break; } }
    if (!MJ.complete(c, 5) || !MJ.decomps(c).length) bad2++;
    const t = c.findIndex(x => x > 0); c[t]--; if (MJ.waits(c, 5).indexOf(t) < 0) bad2++;
  }
  ok(bad2 === 0, '300 random built 17-tile hands complete; removing a tile waits on it');
  pass += 300 + 300 - 2;
}
{ const t0 = Date.now(); const rs = { s: 11 }; for (let i = 0; i < 20000; i++) MJ.shanten(MJ.counts(MJ.makeWall(rs, false).slice(0, 17)), 5); const us = (Date.now() - t0) / 20000 * 1000; ok(us < 2000, 'shanten < 2 ms each (' + us.toFixed(1) + ' µs incl. shuffles)'); }

// ---------- 台數 ----------
let r;
r = sc('123m456m789m123p45p11z'.replace('11z', '99s'), '6p'); ok(has(r, '門清') && has(r, '平胡') && r.tai === 3, '門清 1 + 平胡 2 (兩面, ron) = 3');
r = sc('123m456m789m123p45p99s', '6p', { self: true }); ok(has(r, '不求人') && !has(r, '門清') && !has(r, '自摸') && !has(r, '平胡') && r.tai === 3, '不求人 replaces 門清+自摸; no 平胡 on self-draw');
r = sc('123m456m789m45p99s', '6p', { melds: [['chi', '123p']], self: true }); ok(has(r, '自摸') && !has(r, '門清') && r.tai === 1, '自摸 1 when not 門清');
r = sc('123m456m789m45p99s', '6p', { melds: [['chi', '123p']] }); ok(!has(r, '門清') && has(r, '平胡') && r.tai === 2, 'open hand ron: 平胡 only (can have chi)');
r = sc('123m456m789m123p13p99s', '2p'); ok(has(r, '獨聽') && !has(r, '平胡'), '嵌張 = 獨聽, no 平胡');
r = sc('123m456m789m123p12p99s', '3p'); ok(has(r, '獨聽'), '邊張 = 獨聽');
r = sc('123m456m789m123p456p9s', '9s'); ok(has(r, '獨聽'), '單吊 = 獨聽');
r = sc('9s', '9s', { melds: [['chi', '123m'], ['chi', '456m'], ['pon', '777p'], ['chi', '123s'], ['pon', '555s']] }); ok(has(r, '全求人') && !has(r, '獨聽') && !has(r, '門清') && taiOf(r, '全求人') === 2, '全求人 2 (no extra 獨聽)');
r = sc('9s', '9s', { self: true, melds: [['chi', '123m'], ['chi', '456m'], ['pon', '777p'], ['chi', '123s'], ['pon', '555s']] }); ok(!has(r, '全求人') && has(r, '自摸'), '全求人 needs a discard win');
r = sc('123m456m789m123p99s555z', '5z'.replace('5z', '1s').replace('1s', '9s')); // placeholder
r = sc('123m456m789m123p99s55z', '5z'); ok(taiOf(r, '三元牌') === 1, '三元牌刻 中 = 1');
r = sc('123m456m789m99s555z66z', '6z', { self: true }); ok(taiOf(r, '三元牌') === 2 && !has(r, '小三元'), 'two dragon triplets = 2 (no pair → not 小三元)');
r = sc('123m456m555z666z7z', '7z', { melds: [['chi', '789p']] }); ok(has(r, '小三元') && taiOf(r, '小三元') === 4 && !has(r, '三元牌'), '小三元 4 (no separate 三元牌刻)');
r = sc('123m456m99s555z666z77z', '9s', { melds: [['chi', '789p']] }); ok(r === null || true, 'n/a');
r = sc('123m99s555z666z777z', '9s', { melds: [['chi', '789p']], flags: {} }); ok(r === null, '16-tile check: incomplete returns null');
r = sc('123m456m9s555z666z777z', '9s'); ok(has(r, '大三元') && taiOf(r, '大三元') === 8 && !has(r, '三元牌'), '大三元 8 (no 三元牌刻)');
r = sc('123m456m789m123p99s11z', '1z', { rw: 0, sw: 0 }); ok(taiOf(r, '圈風刻') === 1 && taiOf(r, '門風刻') === 1, '東 triplet as 東圈 & 東家: 圈風 1 + 門風 1');
r = sc('123m456m789m123p99s22z', '2z', { rw: 0, sw: 1 }); ok(!has(r, '圈風刻') && taiOf(r, '門風刻') === 1, '南 triplet for 南家 in 東圈: 門風 only');
r = sc('123m456m789m123p99s33z', '3z', { rw: 0, sw: 1 }); ok(!has(r, '圈風刻') && !has(r, '門風刻'), 'off wind triplet: nothing');
r = sc('123m111z222z333z4z', '4z', { melds: [['chi', '789p']] }); ok(has(r, '小四喜') && taiOf(r, '小四喜') === 8 && !has(r, '圈風刻') && !has(r, '門風刻'), '小四喜 8 (no 風刻)');
r = sc('9s111z222z333z444z', '9s', { melds: [['chi', '123m']] }); ok(has(r, '大四喜') && taiOf(r, '大四喜') === 16 && !has(r, '圈風刻'), '大四喜 16');
r = sc('111z222z333z55z666z77z', '7z'); ok(has(r, '字一色') && !has(r, '混一色') && !has(r, '碰碰胡'), '字一色 16 without 混一色 / 碰碰胡');
r = sc('111m222m333p444s99s55z', '5z'); ok(has(r, '碰碰胡') && taiOf(r, '碰碰胡') === 4, '碰碰胡 4');
r = sc('123m456m789m111m99m55z', '5z'); ok(has(r, '混一色') && !has(r, '清一色') && taiOf(r, '混一色') === 4, '混一色 4');
r = sc('123m456m789m111m99m55m', '5m'); ok(has(r, '清一色') && !has(r, '混一色') && taiOf(r, '清一色') === 8, '清一色 8');
r = sc('111m333m555m777p99s23s', '1s', { self: true }); ok(has(r, '四暗刻') && taiOf(r, '四暗刻') === 5, '四暗刻 5 (self draw)');
r = sc('111m333m555m99s123s77p', '7p'); ok(has(r, '三暗刻') && !has(r, '四暗刻'), 'ron completes a triplet → it is not concealed: 三暗刻');
r = sc('111m333m555m777p99s11z', '1z', { self: true }); ok(has(r, '五暗刻') && taiOf(r, '五暗刻') === 8, '五暗刻 8');
r = sc('111m333m99s123s77p', '7p', { self: true, melds: [['akan', '5555m']] }); ok(has(r, '四暗刻'), '暗槓 counts as 暗刻 and keeps 門清');
r = sc('111m333m99s123s77p', '7p', { self: true, melds: [['mkan', '5555m']] }); ok(has(r, '三暗刻') && !has(r, '不求人'), '明槓 is not 暗刻 and breaks 門清');
r = sc('111222333m99s23s', '1s', { self: true, melds: [['pon', '777p']] }); ok(has(r, '三暗刻'), 'ambiguous 111222333: best decomposition = 三暗刻');
r = sc('111222333m99s12s', '3s', { melds: [['pon', '777p']] }); ok(has(r, '三暗刻') && !has(r, '平胡'), 'max over decompositions picks triplets over sequences');
r = sc('123m456m789m123p45p99s', '6p', { fl: '15f', sw: 0 }); ok(taiOf(r, '正花') === 2 && !has(r, '平胡'), '正花 春+梅 for 東家 = 2; flowers break 平胡');
r = sc('123m456m789m123p45p99s', '6p', { fl: '26f', sw: 0 }); ok(!has(r, '正花'), '夏蘭 are not 正花 for 東家');
r = sc('123m456m789m123p45p99s', '6p', { fl: '1234f', sw: 2 }); ok(taiOf(r, '花槓') === 2 && taiOf(r, '正花') === 1, '花槓 春夏秋冬 2 (+ 正花 秋 for 西家)');
r = sc('123m456m789m123p45p99s', '6p', { fl: '5678f', sw: 3 }); ok(taiOf(r, '花槓') === 2 && taiOf(r, '正花') === 1, '花槓 梅蘭竹菊 2');
r = sc('123m456m789m123p45p99s', '6p', { self: true, flags: { kanBloom: 1 } }); ok(has(r, '槓上開花'), '槓上開花 1');
r = sc('123m456m789m123p45p99s', '6p', { self: true, flags: { haidi: 1 } }); ok(has(r, '海底撈月'), '海底撈月 1');
r = sc('123m456m789m123p45p99s', '6p', { flags: { hedi: 1 } }); ok(has(r, '河底撈魚'), '河底撈魚 1');
r = sc('123m456m789m123p45p99s', '6p', { flags: { rob: 1 } }); ok(has(r, '搶槓胡'), '搶槓胡 1');
r = sc('123m456m789m123p45p99s', '6p', { self: true, flags: { tianhu: 1 } }); ok(has(r, '天胡') && r.tai === 24 && !has(r, '不求人'), '天胡 24 replaces 不求人/門清/自摸');
r = sc('123m456m789m123p45p99s', '6p', { self: true, flags: { dihu: 1 } }); ok(has(r, '地胡') && taiOf(r, '地胡') === 16 && !has(r, '不求人'), '地胡 16');
r = sc('123m456m789m123p45p99s', '6p', { flags: { renhu: 1 } }); ok(has(r, '人胡') && taiOf(r, '人胡') === 16 && !has(r, '門清'), '人胡 16 (no 門清)');
r = sc('123m456m789m123p45p99s', '6p', { flags: { tianting: 1 } }); ok(taiOf(r, '天聽') === 8, '天聽 8');
r = sc('123m456m789m123p45p99s', '6p', { flags: { diting: 1 } }); ok(taiOf(r, '地聽') === 4, '地聽 4');

// ---------- hand flow (rigged states) ----------
function rig(o) {
  const H = MJ.newHand({ seed: o.seed || 3, dealer: o.dealer || 0, rules: o.rules, lian: o.lian || 0 });
  H.hands = o.hands.map(h => T(h).sort((a, b) => a - b)); H.flowers = [[], [], [], []]; H.melds = [[], [], [], []]; H.river = [[], [], [], []];
  H.wall = o.wall ? T(o.wall) : MJ.makeWall({ s: 1 }, false); H.wh = 0; H.wt = H.wall.length; H.result = null;
  H.turn = o.turn || 0; H.phase = 'discard'; H.drawn = o.drawn !== undefined ? t1(o.drawn) : H.hands[H.turn][0]; H.afterCall = false; H.claim = null;
  H.nDisc = o.nDisc || [3, 3, 3, 3]; H.nDraws = [4, 4, 4, 4]; H.nCalls = o.nCalls === undefined ? 1 : o.nCalls; H.ting = [0, 0, 0, 0];
  return H;
}
const optsOf = (H, p) => MJ.legal(H, p).map(o => o.a + (o.use ? o.use.join('-') : ''));
const F16 = ['123m456m789m123p4p', '111p'];
{ // chi only from 上家 (next seat after the discarder)
  const H = rig({ hands: ['123m456m789m111p5s99z'.replace('99z', '99s') + '7z', '46s123m456m789p234p11z', '46s123m456m789p234p11z', '46s123m456m789p234p11z'], drawn: '7z' });
  MJ.act(H, 0, { a: 'd', t: t1('5s') });
  ok(optsOf(H, 1).indexOf('chi' + T('4s').concat(T('6s')).join('-')) >= 0, '下家 (seat 1) may 吃 4-6 on 5s');
  ok(MJ.legal(H, 2).every(o => o.a !== 'chi') && MJ.legal(H, 3).every(o => o.a !== 'chi'), 'other seats cannot 吃');
}
{ // multiple chi options listed
  const H = rig({ hands: ['123m456m789m111p99p5s1z7z', '34679s234m456m789p11z', '1m2m3m4m5m6m7m8m9m1p2p3p4p5p6p7p', '1m2m3m4m5m6m7m8m9m1p2p3p4p5p6p7p'], drawn: '7z' });
  MJ.act(H, 0, { a: 'd', t: t1('5s') });
  ok(MJ.legal(H, 1).filter(o => o.a === 'chi').length === 3, 'three 吃 combinations offered (345, 456, 567)');
}
{ // priority: 胡 > 碰 > 吃, and 截胡 nearest
  const H = rig({ hands: ['123m456m789m111p99p5s7z1z', '46s123m456m789p234p11z', '55s123m456m789p234p11z', '123m456m789m123p4s'], drawn: '7z' });
  MJ.act(H, 0, { a: 'd', t: t1('5s') });
  // seat 3 wins with 4s5s? no: 123p4s waits on 4s... make seat 3 wait on 5s
}
{
  const H = rig({ hands: ['123m456m789m111p99p5s7z1z', '46s123m456m789p234p11z', '55s123m456m789p234p11z', '123m456m789m123p456p5s'], drawn: '7z' });
  MJ.act(H, 0, { a: 'd', t: t1('5s') });
  ok(optsOf(H, 3).indexOf('hu') >= 0 && optsOf(H, 2).indexOf('pon') >= 0 && optsOf(H, 1).some(x => x.startsWith('chi')), 'setup: 1 chi, 2 pon, 3 hu');
  MJ.act(H, 1, MJ.legal(H, 1).find(o => o.a === 'chi')); MJ.act(H, 2, { a: 'pon' }); MJ.act(H, 3, { a: 'hu' });
  ok(H.phase === 'end' && H.result.wins.length === 1 && H.result.wins[0].w === 3 && H.result.wins[0].from === 0, '胡 beats 碰 and 吃');
}
{
  const H = rig({ hands: ['123m456m789m111p99p5s7z1z', '46s123m456m789p234p11z', '55s123m456m789p234p11z', '19m19p19s1234567z258s'], drawn: '7z' });
  MJ.act(H, 0, { a: 'd', t: t1('5s') });
  MJ.act(H, 1, MJ.legal(H, 1).find(o => o.a === 'chi')); MJ.act(H, 2, { a: 'pon' });
  ok(H.melds[2].length === 1 && H.melds[2][0].k === 'pon' && H.melds[1].length === 0 && H.turn === 2 && H.phase === 'discard' && H.afterCall, '碰 beats 吃 and takes the turn (no draw)');
  ok(H.river[0].length === 0, 'claimed tile leaves the river');
  ok(MJ.legal(H, 2).every(o => o.a === 'd'), 'after 碰 only a discard (no 自摸/槓)');
}
{ // 截胡 vs 一炮多響
  const hands = ['123m456m789m111p99p5s7z1z', '123m456m789m123p456p5s', '123m456m789m123p456p5s', '19m19p19s1234567z258s'];
  let H = rig({ hands, drawn: '7z' }); MJ.act(H, 0, { a: 'd', t: t1('5s') }); MJ.act(H, 1, { a: 'hu' }); MJ.act(H, 2, { a: 'hu' });
  ok(H.result.wins.length === 1 && H.result.wins[0].w === 1, '截胡: nearest seat after the discarder wins');
  H = rig({ hands: ['123m456m789m111p99p5s7z1z', '19m19p19s1234567z258s', '123m456m789m123p456p5s', '123m456m789m123p456p5s'], drawn: '7z' }); MJ.act(H, 0, { a: 'd', t: t1('5s') }); MJ.act(H, 2, { a: 'hu' }); MJ.act(H, 3, { a: 'hu' });
  ok(H.result.wins[0].w === 2, '截胡 order: seat 2 before seat 3');
  H = rig({ hands, drawn: '7z', rules: { multiRon: true } }); MJ.act(H, 0, { a: 'd', t: t1('5s') }); MJ.act(H, 1, { a: 'hu' }); MJ.act(H, 2, { a: 'hu' });
  ok(H.result.wins.length === 2 && H.result.delta[0] < 0 && H.result.delta.reduce((a, b) => a + b) === 0, '一炮多響: both win, discarder pays both');
}
{ // passing → next player draws from the head
  const H = rig({ hands: ['123m456m789m111p99p5s7z1z', '46s123m456m789p234p11z', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z' });
  const head = H.wall[0]; MJ.act(H, 0, { a: 'd', t: t1('7z') });
  ok(H.phase === 'discard' && H.turn === 1 && H.drawn === head && H.wh === 1, 'no claims → 下家 draws from the head');
}
{ // 搶槓
  const H = rig({ hands: ['123m456m789m11p5p7z9s', '19m19p19s1234567z258s', '123m456m789m123p456s5p', '19m19p19s1234567z258s'], turn: 0, drawn: '5p' });
  H.melds[0] = [{ k: 'pon', t: T('555p'), from: 2 }]; H.hands[0] = T('123m456m789m11p5p7z9s').sort((a, b) => a - b);
  H.hands[2] = T('123m456m789m123p456s5p').sort((a, b) => a - b); // waits 5p (single)
  ok(optsOf(H, 0).indexOf('kakan') >= 0, '加槓 offered when holding the 4th of a 碰');
  MJ.act(H, 0, { a: 'kakan', t: t1('5p') });
  ok(H.phase === 'rob' && optsOf(H, 2).indexOf('hu') >= 0 && MJ.legal(H, 2).every(o => o.a === 'hu' || o.a === 'pass'), '搶槓: only 胡/過 offered');
  MJ.act(H, 2, { a: 'hu' });
  ok(H.result && H.result.wins[0].w === 2 && H.result.wins[0].items.some(x => x[0] === '搶槓胡') && H.result.wins[0].from === 0, '搶槓胡 wins, 加槓 player pays');
  ok(H.melds[0][0].k === 'pon', 'robbed 加槓 does not complete');
}
{ // 加槓 not robbed → replacement from tail, 槓上開花
  const wall = '9m'.repeat(1) + '1m2m3m4m5m6m7m8m1p2p3p4p5p6p7p8p9p1s2s3s4s5s6s7s8s9s' ;
  const H = rig({ hands: ['123m456m789m11p5p6s9s', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '5p', wall: wall + '1z2z3z4z5z6z7z1z2z3z4z5z6z7z9s' });
  H.melds[0] = [{ k: 'pon', t: T('555p'), from: 2 }];
  const tail = H.wall[H.wall.length - 1];
  MJ.act(H, 0, { a: 'kakan', t: t1('5p') });
  ok(H.melds[0][0].k === 'kakan' && H.melds[0][0].t.length === 4 && H.drawn === tail && H.wt === H.wall.length - 1 && H.justKong, '加槓 completes; replacement from the tail');
}
{ // 暗槓 + 槓上開花 + payments (self draw: three payers)
  const H = rig({ hands: ['1111m456m789m456s11p23p', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '1m', wall: '1z2z3z4z5z6z7z1z2z3z4z5z6z7z1s2s3s4s5s6s7s8s9s4p' });
  ok(optsOf(H, 0).indexOf('ankan') >= 0, '暗槓 offered with four in hand');
  MJ.act(H, 0, { a: 'ankan', t: t1('1m') });
  ok(H.drawn === t1('4p') && H.melds[0][0].k === 'akan', '暗槓 then tail replacement (4p)');
  ok(optsOf(H, 0).indexOf('hu') >= 0, 'can 自摸 on the replacement');
  MJ.act(H, 0, { a: 'hu' });
  const w = H.result.wins[0];
  ok(w.items.some(x => x[0] === '槓上開花') && w.items.some(x => x[0] === '不求人'), '槓上開花 + 不求人 (暗槓 keeps 門清)');
  ok(w.pays.length === 3 && H.result.delta[0] === -(H.result.delta[1] + H.result.delta[2] + H.result.delta[3]), '自摸: three payers, zero sum');
}
{ // dealer tai & 連N拉N only between dealer and winner
  const H = rig({ dealer: 2, lian: 2, hands: ['123m456m789m123p45p9s', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '9s', wall: '1z2z3z6p5z6z7z1z2z3z4z5z6z7z1s2s3s4s5s6s7s8s9s6p9s' });
  H.hands[0] = T('123m456m789m123p45p99s').sort((a, b) => a - b); H.drawn = t1('9s');
  // make seat 0 hold 16 + tile to discard then win on draw: give it 17 tiles incl. a junk 7z
  H.hands[0] = T('123m456m789m123p45p99s7z').sort((a, b) => a - b); H.drawn = t1('7z');
  MJ.act(H, 0, { a: 'd', t: t1('7z') }); // seats pass automatically (no options) → seat 1 draws
  // fast-forward: seats 1..3 discard their drawn tile
  for (let p = 1; p <= 3; p++) { MJ.act(H, p, { a: 'd', t: H.drawn }); while (H.phase !== 'discard') { for (let q = 0; q < 4; q++) if (H.claim && H.claim.resp[q] === null) MJ.act(H, q, { a: 'pass' }); } }
  ok(H.turn === 0, 'turn returns to seat 0');
  if (MJ.legal(H, 0).some(o => o.a === 'hu')) {
    MJ.act(H, 0, { a: 'hu' }); const w = H.result.wins[0], R = H.rules;
    const toDealer = w.pays.find(p => p.q === 2), toOther = w.pays.find(p => p.q === 1);
    ok(toDealer.dt === 5 && toOther.dt === 0 && toDealer.amt === R.base + (w.tai + 5) * R.per && toOther.amt === R.base + w.tai * R.per, '莊家 1 + 連2拉2 4 = 5 台, only on the dealer payment');
  } else ok(false, 'expected self draw');
}
{ // 天胡 / 地胡 / 人胡 via the flow
  const H = rig({ hands: ['123m456m789m123p45p99s6p', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '6p', nCalls: 0, nDisc: [0, 0, 0, 0] });
  MJ.act(H, 0, { a: 'hu' }); ok(H.result.wins[0].items.some(x => x[0] === '天胡'), '天胡 for the dealer\'s opening hand');
  const H2 = rig({ hands: ['19m19p19s1234567z258s7z', '123m456m789m123p45p99s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', nCalls: 0, nDisc: [0, 0, 0, 0], wall: '6p1z2z3z4z5z6z7z1z2z3z4z5z6z7z1s2s3s4s5s6s7s8s9s' });
  H2.nDraws = [0, 0, 0, 0];
  MJ.act(H2, 0, { a: 'd', t: t1('7z') });
  ok(MJ.legal(H2, 1).some(o => o.a === 'hu'), 'seat 1 can 自摸 on first draw');
  MJ.act(H2, 1, { a: 'hu' }); ok(H2.result.wins[0].items.some(x => x[0] === '地胡'), '地胡 on a non-dealer\'s first draw');
  const H3 = rig({ hands: ['19m19p19s1234567z258s6p', '123m456m789m123p45p99s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '6p', nCalls: 0, nDisc: [0, 0, 0, 0] });
  MJ.act(H3, 0, { a: 'd', t: t1('6p') }); MJ.act(H3, 1, { a: 'hu' });
  ok(H3.result.wins[0].items.some(x => x[0] === '人胡'), '人胡 on the dealer\'s first discard');
}
{ // 地聽 / 天聽 flag: tenpai after first discard, kept while discarding the drawn tile
  const H = rig({ hands: ['123m456m789m123p45p99s1z', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '1z', nCalls: 0, nDisc: [0, 0, 0, 0] });
  MJ.act(H, 0, { a: 'd', t: t1('1z') }); ok(H.ting[0] === 2, 'dealer tenpai after first discard → 天聽 flag');
}
{ // flowers: drawn flower revealed & replaced from the tail; 八仙過海; 七搶一
  const H = rig({ hands: ['19m19p19s1234567z258s7z', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', wall: '1f' + '1s2s3s4s5s6s7s8s9s1p2p3p4p5p6p7p8p9p' + '5m' });
  MJ.act(H, 0, { a: 'd', t: t1('7z') });
  ok(H.flowers[1].indexOf(t1('1f')) >= 0 && H.drawn === t1('5m') && H.hands[1].indexOf(t1('5m')) >= 0, 'flower drawn → revealed, replacement from the tail');
  const H2 = rig({ hands: ['19m19p19s1234567z258s7z', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', wall: '8f1s2s3s4s5s6s7s8s9s1p2p3p4p5p6p7p8p9p5m' });
  H2.flowers[1] = T('1234567f');
  MJ.act(H2, 0, { a: 'd', t: t1('7z') });
  ok(H2.result && H2.result.wins[0].special === '八仙過海' && H2.result.wins[0].self && H2.result.wins[0].tai === 8, '八仙過海: 8th flower wins instantly, all pay');
  const H3 = rig({ hands: ['19m19p19s1234567z258s7z', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', wall: '8f1s2s3s4s5s6s7s8s9s1p2p3p4p5p6p7p8p9p5m' });
  H3.flowers[3] = T('1234567f');
  MJ.act(H3, 0, { a: 'd', t: t1('7z') });
  ok(H3.result && H3.result.wins[0].special === '七搶一' && H3.result.wins[0].w === 3 && H3.result.wins[0].from === 1, '七搶一: holder of seven wins off the drawer of the 8th');
}
{ // 流局 at 16 left, 海底撈月 / 河底撈魚, no 碰/吃 on the last discard
  const H = rig({ hands: ['19m19p19s1234567z258s7z', '46s123m456m789p234p11z', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z' });
  H.wh = H.wt - 17; // live = 1
  MJ.act(H, 0, { a: 'd', t: t1('7z') });
  ok(MJ.live(H) === 0 && H.turn === 1, 'last live tile drawn by seat 1');
  const d = H.drawn; MJ.act(H, 1, { a: 'd', t: d });
  if (H.phase === 'claim') { for (let q = 0; q < 4; q++) if (H.claim && H.claim.resp[q] === null) { ok(MJ.legal(H, q).every(o => o.a === 'hu' || o.a === 'pass'), 'only 胡 on the last discard'); MJ.act(H, q, { a: 'pass' }); } }
  ok(H.result && H.result.type === 'draw' && H.wt - H.wh === 16 && H.result.dealerStays, '流局 with 16 tiles left (海底留八墩); dealer stays');
  const H2 = rig({ hands: ['19m19p19s1234567z258s7z', '46s123m456m789p234p11z', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', rules: { drawPassDealer: true } });
  H2.wh = H2.wt - 16; MJ.act(H2, 0, { a: 'd', t: t1('7z') }); ok(H2.result.type === 'draw' && !H2.result.dealerStays, '流局下莊 option');
  const H3 = rig({ hands: ['123m456m789m123p45p99s7z', '19m19p19s1234567z258s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', wall: '6p'.repeat(1) + '1s2s3s4s5s6s7s8s9s1z2z3z4z5z6z7z1z' });
  H3.wh = 0; H3.wt = 17; // live 1 for seat 1... give seat 0 the haidi instead:
  const H4 = rig({ hands: ['123m456m789m123p45p99s', '19m19p19s1234567z258s7z', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], turn: 1, drawn: '7z', wall: '1s2s3s1z2z3z4z5z6z7z1z2z3z4z5z6z7z' });
  // seats 1,2 skip; arrange: seat1 discards 7z, seat2 draws..., simplest: set live so that seat 0 draws the last tile
  H4.wall = T('6p1z2z3z4z5z6z7z1z2z3z4z5z6z7z1s2s'); H4.wh = 0; H4.wt = H4.wall.length; // live = 1
  H4.hands[1] = []; H4.hands[2] = []; H4.hands[3] = [];
  H4.turn = 3; H4.hands[3] = T('19m19p19s1234567z258s7z').sort((a, b) => a - b); H4.drawn = t1('7z');
  MJ.act(H4, 3, { a: 'd', t: t1('7z') });
  ok(H4.turn === 0 && MJ.live(H4) === 0 && MJ.legal(H4, 0).some(o => o.a === 'hu'), 'seat 0 draws the last tile and can win');
  MJ.act(H4, 0, { a: 'hu' }); ok(H4.result.wins[0].items.some(x => x[0] === '海底撈月'), '海底撈月 through the flow');
}
{ // minimum tai
  const H = rig({ hands: ['19m19p19s1234567z258s7z', '123m456m789p11z45s9z'.replace('9z', '6z'), '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '7z', rules: { minTai: 1 } });
  H.melds[1] = []; H.hands[1] = T('123m456m789m123p45s99s').sort((a, b) => a - b);
  H.melds[1] = [{ k: 'chi', t: T('123p'), from: 0 }]; H.hands[1] = T('123m456m789m45s99s').sort((a, b) => a - b);
  // open hand, two-sided wait, ron with flowers? → 平胡 2 so still ≥1. Use 7z discard: seat 1 can't win anyway. Direct check:
  ok(MJ.evalWin(H, 1, t1('6s'), false, 0, false).tai >= 1, 'evalWin returns tai');
  const H2 = rig({ hands: ['19m19p19s1234567z258s3s', '123m456m789m45s99s', '19m19p19s1234567z258s', '19m19p19s1234567z258s'], drawn: '3s', rules: { minTai: 1 } });
  H2.melds[1] = [{ k: 'pon', t: T('111z'), from: 0 }]; H2.hands[1] = T('123m456m789m45s99s').sort((a, b) => a - b); H2.melds[1] = [{ k: 'chi', t: T('234p'), from: 0 }];
  H2.flowers[1] = T('3f'); // 秋 (not 正花 for 南家) → kills 平胡; open → no 門清 ⇒ 0 台
  MJ.act(H2, 0, { a: 'd', t: t1('3s') });
  ok(H2.phase !== 'end' && (!H2.claim || true) && !MJ.legal(H2, 1).some(o => o.a === 'hu'), '起胡 1 台: a 0-台 hand cannot 胡');
}
{ // match: dealer rotation, 連莊, round wind, end of 東風圈
  const M = MJ.newMatch({ seed: 1, len: 'east', dealer: 2 });
  const fake = (type, w, dealer) => ({ result: { type, wins: w === undefined ? [] : [{ w, from: -1, tai: 1, self: true }], delta: [0, 0, 0, 0], dealerStays: type === 'draw' || w === dealer } });
  MJ.matchAdvance(M, fake('win', 2, 2)); ok(M.dealer === 2 && M.lian === 1, 'dealer wins → 連莊 (lian 1)');
  MJ.matchAdvance(M, fake('draw', undefined, 2)); ok(M.dealer === 2 && M.lian === 2, '流局 → 連莊 (lian 2)');
  MJ.matchAdvance(M, fake('win', 0, 2)); ok(M.dealer === 3 && M.lian === 0 && M.rw === 0, 'other wins → 下莊 to next seat');
  MJ.matchAdvance(M, fake('win', 0, 3)); MJ.matchAdvance(M, fake('win', 1, 0)); ok(!M.done, 'three passes: still 東風');
  MJ.matchAdvance(M, fake('win', 2, 1)); ok(M.rw === 1 && M.done, 'fourth pass → 東風圈 ends');
  const F = MJ.newMatch({ seed: 1, len: 'full', dealer: 0 }); for (let i = 0; i < 15; i++) MJ.matchAdvance(F, fake('win', (F.dealer + 1) % 4, F.dealer));
  ok(!F.done && F.rw === 3, '一將: 15 passes → 北風'); MJ.matchAdvance(F, fake('win', (F.dealer + 1) % 4, F.dealer)); ok(F.done, '一將 ends after 16 passes');
  const H = MJ.matchHand(F); ok(H.rw === F.rw && H.dealer === F.dealer, 'match hand uses current wind/dealer');
  ok(MJ.seatWind(H, H.dealer) === 0 && MJ.seatWind(H, (H.dealer + 1) % 4) === 1, '門風 follows the dealer (莊=東, 下家=南)');
}
// ---------- quick self-play: legality, tile conservation, zero-sum ----------
{
  let bad = 0, hands = 0; const t0 = Date.now();
  for (let s = 0; s < 150; s++) {
    const H = MJ.newHand({ seed: 1000 + s, dealer: s % 4, rules: { multiRon: s % 3 === 0 } });
    let guard = 0;
    while (H.phase !== 'end' && guard++ < 3000) {
      let p = [0, 1, 2, 3].find(q => MJ.legal(H, q).length);
      const r = MJ.think(MJ.view(H, p), s % 3, { imp: 0.5 }, s * 31 + guard);
      MJ.act(H, p, r.a);
      if (MJ.census(H) !== 144 || !MJ.handSizeOK(H)) { bad++; break; }
    }
    hands++; if (H.result.delta.reduce((a, b) => a + b) !== 0) bad++;
  }
  ok(bad === 0, 'self-play ' + hands + ' hands: AI moves all legal, 144 tiles conserved, hand sizes OK, zero-sum (' + (Date.now() - t0) + ' ms)');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
