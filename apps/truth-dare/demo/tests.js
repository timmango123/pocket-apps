// Core tests for 真心話大冒險 (truth-dare). Loads the engine between the CORE markers of ../index.html.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const TD = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return TD;')();
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lcg = seed => { let x = seed >>> 0; return n => { x = (x * 1664525 + 1013904223) >>> 0; return n > 1 ? x % n : 0; }; };
const P = names => names.map((n, i) => ({ id: 'p' + i, name: n }));

// ---------- built-in bank ----------
{
  const B = TD.BANK;
  ok(B.length >= 300, 'bank has ' + B.length + ' questions (>= 300)');
  const by = k => B.filter(q => q.t === k[0] && q.lv === +k[1]).length;
  ['T1', 'T2', 'T3', 'D1', 'D2', 'D3'].forEach(k => ok(by(k) >= 35, `${k} has ${by(k)} questions (>= 35)`));
  ok(new Set(B.map(q => q.id)).size === B.length, 'ids are unique');
  const keys = B.map(q => q.t + TD.normQ(q.q)); const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
  ok(dups.length === 0, 'no duplicate question texts ' + dups.join(','));
  ok(B.every(q => TD.checkQ(q.q) === '' && /[？。！」）]$/.test(q.q)), 'every question is 2–200 chars and ends with full-width punctuation ' + B.filter(q => !/[？。！」）]$/.test(q.q)).map(q => q.id));
  ok(B.every(q => !/[?!,:;]/.test(q.q.replace(/\{某人\}/g, ''))), 'no half-width punctuation in questions ' + B.filter(q => /[?!,:;]/.test(q.q)).map(q => q.id));
  ok(B.every(q => !/[这们说时么对还问个钟买卖饮]/.test(q.q)), 'no simplified characters');
  // family mode safety: any romance/dating word must be on a ♥ item
  const ROM = /吻|戀|曖昧|告白|約會|前任|心動|另一半|情侶|交友|情話|撩|男女朋友/;
  const leak = B.filter(q => !q.r && ROM.test(q.q));
  ok(leak.length === 0, 'romance words only appear on ♥ items: ' + leak.map(q => q.q).join(' | '));
  ok(B.filter(q => q.r).length >= 30, '♥ items: ' + B.filter(q => q.r).length);
  // nothing dangerous / alcohol / humiliating keywords
  const BAD = /喝酒|乾杯|啤酒|烈酒|脫|裸|性|胸|屁股|舔|打自己|撞|跳下|吃生|醜八怪|胖|吸菸|抽菸|檳榔/;
  ok(B.every(q => !BAD.test(q.q)), 'no alcohol, nudity, body-shaming or danger words: ' + B.filter(q => BAD.test(q.q)).map(q => q.q).join(' | '));
  // family pools still have content at every level
  for (const t of ['T', 'D']) for (const lv of [1, 2, 3]) {
    const n = TD.poolFor(t, { levels: [lv], family: true }).length;
    ok(n >= 20, `family pool ${t}${lv} has ${n} (>= 20)`);
  }
  ok(TD.poolFor('T', { levels: [1, 2, 3], family: true }).every(q => !q.r), 'family pool excludes ♥ items');
  ok(B.filter(q => TD.hasPH(q.q)).length >= 40, 'many dares name another player via {某人}');
  ok(B.filter(q => TD.hasPH(q.q)).every(q => q.t === 'D'), '{某人} only in dares');
}

// ---------- pools ----------
{
  const custom = [{ id: 'c1', t: 'T', lv: 2, r: 0, q: '自訂一' }, { id: 'c2', t: 'D', lv: 3, r: 1, q: '自訂二' }];
  const all = TD.poolFor('T', { levels: [1, 2, 3] }).length;
  ok(TD.poolFor('T', { levels: [1, 2, 3], custom }).length === all + 1, 'custom truth joins the truth pool');
  ok(TD.poolFor('T', { levels: [1, 2, 3], builtin: false, custom }).length === 1, 'builtin off: only custom');
  ok(TD.poolFor('D', { levels: [3], builtin: false, custom, family: true }).length === 0, 'family mode drops a ♥ custom item');
  ok(TD.poolFor('T', { levels: [1], hidden: { 'T1-1': 1 } }).every(q => q.id !== 'T1-1') && TD.poolFor('T', { levels: [1], hidden: { 'T1-1': 1 } }).length === TD.poolFor('T', { levels: [1] }).length - 1, 'hidden built-in is excluded');
  ok(TD.poolFor('T', { levels: [2] }).every(q => q.lv === 2), 'level filter');
}

// ---------- drawing without repeats ----------
{
  const pool = TD.poolFor('T', { levels: [1] }), used = [], seen = new Set();
  let resets = 0, last = null, rnd = lcg(3);
  for (let i = 0; i < pool.length; i++) { const r = TD.draw(pool, used, last, rnd); if (r.reset) resets++; used.push(r.item.id); seen.add(r.item.id); last = r.item.id; }
  ok(seen.size === pool.length && resets === 0, `one full pass draws all ${pool.length} distinct questions with no reset`);
  const r = TD.draw(pool, used, last, rnd);
  ok(r.reset && r.item.id !== last, 'pool exhausted -> reset, and the next card is not the one just shown');
  const left = TD.usedAfterReset(used.concat(['X-1']), pool);
  ok(eq(left, ['X-1']), 'usedAfterReset keeps only ids outside this pool');
  ok(TD.draw([], [], null).item === null, 'empty pool -> null');
  const one = [{ id: 'a', q: 'x' }]; ok(TD.draw(one, ['a'], 'a').item.id === 'a', 'single-item pool repeats itself after reset');
}

// ---------- placeholders, timer seconds ----------
{
  const f = TD.fill('跟 {某人} 擊掌', ['阿華'], lcg(1));
  ok(f.text === '跟 阿華 擊掌' && f.names[0] === '阿華' && f.marked.includes('\u0001阿華\u0002'), 'fill {某人}');
  const g = TD.fill('{某人} 和 {P} 對看', ['甲', '乙'], lcg(2));
  ok(g.names.length === 2 && g.names[0] !== g.names[1], 'two placeholders get two different players');
  ok(TD.fill('{某人}', [], lcg(1)).text === '旁邊的人', 'no other players -> 旁邊的人');
  ok(TD.fill('沒有佔位', ['甲']).text === '沒有佔位', 'text without placeholder untouched');
  ok(TD.secondsIn('維持 10 秒。') === 10 && TD.secondsIn('30秒內') === 30 && TD.secondsIn('一分鐘的機器人') === 60 && TD.secondsIn('兩分鐘') === 120 && TD.secondsIn('沒有時間') === 0 && TD.secondsIn('9999 秒') === 0, 'secondsIn');
}

// ---------- names ----------
{
  const ps = P(['小明', 'Amy']);
  ok(TD.validateName('  ', ps) === '名字不能空白', 'blank name rejected');
  ok(TD.validateName('小明', ps).includes('已經有'), 'duplicate rejected');
  ok(TD.validateName('amy', ps).includes('已經有'), 'duplicate ignores case');
  ok(TD.validateName('小明', ps, 'p0') === '', 'renaming to own name is fine');
  ok(TD.validateName('一二三四五六七八九十一二', ps) === '' && TD.validateName('一二三四五六七八九十一二三', ps).includes('12'), '12 chars ok, 13 rejected');
  ok(TD.validateName('👨‍👩‍👧‍👦 家', ps) === '', 'emoji family counts as one grapheme');
  ok(TD.cleanName(' 阿​華\n ') === '阿華', 'zero-width and whitespace cleaned');
  ok(eq(TD.splitNames('小明、阿華,怡君，家豪\n雅婷'), ['小明', '阿華', '怡君', '家豪', '雅婷']), 'split on 、 , ， newline');
  ok(eq(TD.splitNames('小明 阿華  怡君'), ['小明', '阿華', '怡君']), 'CJK names split on spaces');
  ok(eq(TD.splitNames('Amy Chen'), ['Amy Chen']), 'Latin name with a space stays one name');
  ok(eq(TD.splitNames('Amy Chen, Bob Lin'), ['Amy Chen', 'Bob Lin']), 'Latin names split on commas');
  let id = 0; const mk = () => 'n' + (id++);
  const r = TD.addNames(P(['小明']), '阿華、小明、、一二三四五六七八九十一二三、怡君', mk);
  ok(r.added.length === 2 && r.errors.length === 2 && r.players.length === 3, 'addNames adds valid, reports dup and too-long ' + JSON.stringify(r.errors));
  const big = TD.addNames([], Array.from({ length: 25 }, (_, i) => 'P' + i).join(','), mk);
  ok(big.players.length === 20 && big.errors.length === 5, 'max 20 players');
  ok(TD.addNames([], '', mk).errors[0] === '名字不能空白', 'empty add');
}

// ---------- picking who's next ----------
{
  const ps = P(['a', 'b', 'c', 'd', 'e']);
  let st = { bag: [], last: null }, rnd = lcg(9), seq = [];
  for (let i = 0; i < 50; i++) { const r = TD.pickNext(ps, st, 'fair', true, rnd); seq.push(r.id); st = { bag: r.bag, last: r.id }; }
  let fairOk = true; for (let c = 0; c < 10; c++) if (new Set(seq.slice(c * 5, c * 5 + 5)).size !== 5) fairOk = false;
  ok(fairOk, 'fair mode: everyone exactly once per cycle (10 cycles)');
  ok(seq.every((x, i) => i === 0 || x !== seq[i - 1]), 'fair mode: never the same player twice in a row, even across cycles');
  st = { bag: [], last: null }; const cnt = {}; seq = [];
  for (let i = 0; i < 5000; i++) { const r = TD.pickNext(ps, st, 'random', true); cnt[r.id] = (cnt[r.id] || 0) + 1; seq.push(r.id); st = { bag: r.bag, last: r.id }; }
  ok(seq.every((x, i) => i === 0 || x !== seq[i - 1]), 'random + noRepeat: no immediate repeats');
  ok(Object.values(cnt).every(v => Math.abs(v / 5000 - 0.2) < 0.03), 'random: roughly uniform ' + JSON.stringify(cnt));
  let rep = 0; st = { last: null }; for (let i = 0; i < 3000; i++) { const r = TD.pickNext(ps, st, 'random', false); if (r.id === st.last) rep++; st = { last: r.id }; }
  ok(rep > 400 && rep < 800, 'random without noRepeat can repeat (~1/5): ' + rep);
  st = { last: null }; seq = []; for (let i = 0; i < 7; i++) { const r = TD.pickNext(ps, st, 'order'); seq.push(r.id); st = { last: r.id }; }
  ok(seq.join('') === 'p0p1p2p3p4p0p1', 'order mode cycles the list');
  ok(TD.pickNext(P(['solo']), { last: 'p0' }, 'fair', true).id === 'p0' && TD.pickNext(P(['solo']), { last: 'p0' }, 'random', true).id === 'p0', 'single player always picked');
  ok(TD.pickNext([], {}, 'fair').id === null, 'no players -> null');
  ok(eq(TD.syncBag(['a', 'b'], ['a', 'b', 'c'], ['b', 'c', 'd']), ['b', 'd']), 'syncBag drops removed, adds newcomers');
}

// ---------- wheel geometry ----------
{
  let bad = 0, rnd = lcg(77);
  for (let i = 0; i < 4000; i++) {
    const n = 2 + rnd(19), k = rnd(n), style = rnd(2) ? 'wheel' : 'bottle', dir = rnd(2) ? 1 : -1, turns = rnd(6), u = 0.18 + rnd(1000) / 1000 * 0.64;
    const th0 = (rnd(20000) - 10000) / 100;
    const th = TD.targetAngle(th0, k, n, style, turns, u, dir);
    if (TD.indexAt(th, n, style) !== k) bad++;
    if (dir > 0 ? th - th0 < turns * 2 * Math.PI - 1e-9 : th0 - th < turns * 2 * Math.PI - 1e-9) bad++;
    if (Math.abs(th - th0) > (turns + 1) * 2 * Math.PI + 1e-9) bad++;
  }
  ok(bad === 0, 'targetAngle lands on the chosen segment, turns at least N and at most N+1 times, both styles and directions (4000 cases)');
  ok(TD.indexAt(0.01, 4, 'bottle') === 0 && TD.indexAt(-0.01, 4, 'wheel') === 0 && TD.indexAt(0.01, 4, 'wheel') === 3, 'indexAt orientation');
  ok(TD.easeOut(0) === 0 && TD.easeOut(1) === 1 && TD.easeOut(2) === 1 && TD.easeOut(0.5) > 0.9, 'easeOut');
}

// ---------- import / export (edge cases with known answers) ----------
{
  const imp = (t, d, ex) => TD.parseImport(t, d || 'T', 2, ex);
  let r;
  r = imp(''); ok(r.items.length === 0 && r.errors[0] === '沒有內容', 'import: empty');
  r = imp('   \n\n  '); ok(r.items.length === 0 && r.errors[0] === '沒有內容', 'import: whitespace only');
  r = imp('真心話｜刺激｜你最怕什麼？'); ok(eq(r.items, [{ t: 'T', lv: 3, r: 0, q: '你最怕什麼？' }]), 'import: full-width bar format');
  r = imp('大冒險,輕鬆,唱一首歌'); ok(eq(r.items, [{ t: 'D', lv: 1, r: 0, q: '唱一首歌' }]), 'import: CSV');
  r = imp('D|3|跳舞'); ok(r.items[0].t === 'D' && r.items[0].lv === 3, 'import: D|3|');
  r = imp('3｜冒｜跳舞二'); ok(r.items[0].t === 'D' && r.items[0].lv === 3, 'import: level before type');
  r = imp('truth: 你喜歡貓嗎？'); ok(r.items[0].t === 'T' && r.items[0].lv === 2, 'import: english type, default level');
  r = imp('沒有前綴的題目', 'D'); ok(r.items[0].t === 'D' && r.items[0].lv === 2, 'import: no prefix uses default type');
  r = imp('1. 第一題\n2) 第二題\n- 第三題'); ok(eq(r.items.map(x => x.q), ['第一題', '第二題', '第三題']), 'import: list numbering stripped');
  r = imp('你喜歡吃，還是喝？'); ok(r.items[0].q === '你喜歡吃，還是喝？', 'import: comma inside a question kept');
  r = imp('真｜普通｜♥ 你的初戀？'); ok(r.items[0].r === 1 && r.items[0].q === '你的初戀？', 'import: ♥ marks romance');
  r = imp('﻿真心話｜普通｜BOM 題\r\n大冒險｜普通｜CRLF 題\r\n'); ok(r.items.length === 2 && r.items[1].q === 'CRLF 題', 'import: BOM and CRLF');
  r = imp('# 註解\n題目甲\n題目甲\n題目甲。'); ok(r.items.length === 1 && r.dup === 2, 'import: comments skipped, duplicates (incl. trailing 。) collapsed');
  r = imp('你手機裡最常打開的 App 是哪一個？', 'T', TD.BANK); ok(r.items.length === 0 && r.dup === 1, 'import: duplicate of a built-in skipped');
  r = imp('a'); ok(r.items.length === 0 && /第 1 行：題目太短/.test(r.errors[0]), 'import: too short explained');
  r = imp('長'.repeat(201)); ok(r.items.length === 0 && /太長/.test(r.errors[0]), 'import: too long explained');
  r = imp('長'.repeat(200)); ok(r.items.length === 1, 'import: exactly 200 chars ok');
  r = imp('🎉🎉 用表情符號題 😂'); ok(r.items[0].q === '🎉🎉 用表情符號題 😂', 'import: emoji kept');
  r = imp('<script>alert(1)</script>'); ok(r.items[0].q === '<script>alert(1)</script>', 'import: HTML kept as text (escaped on render)');
  r = imp('{"broken": '); ok(r.items.length === 0 && /JSON 格式錯誤/.test(r.errors[0]), 'import: broken JSON explained');
  r = imp('{"foo": 1}'); ok(/找不到題目清單/.test(r.errors[0]), 'import: JSON without items explained');
  r = imp('[1, null, "字串題目", {"text": "物件題", "type": "dare", "level": "刺激"}]'); ok(r.items.length === 2 && r.errors.length === 2 && r.items[1].t === 'D' && r.items[1].lv === 3, 'import: JSON array mixed');
  const items = [{ t: 'T', lv: 1, r: 0, q: '題一？' }, { t: 'D', lv: 3, r: 1, q: '跟 {某人} 對看' }, { t: 'T', lv: 2, r: 0, q: '含｜直線的題' }];
  r = imp(TD.exportJSON(items, ['T1-1'])); ok(eq(r.items, items), 'export JSON -> import round trip');
  r = imp(TD.exportText(items)); ok(eq(r.items, items), 'export text -> import round trip (incl. ｜ inside text)');
  const many = Array.from({ length: 1000 }, (_, i) => '大冒險｜普通｜第 ' + i + ' 題').join('\n');
  const t0 = Date.now(); r = imp(many); ok(r.items.length === 1000 && Date.now() - t0 < 1000, 'import 1000 lines in ' + (Date.now() - t0) + 'ms');
  ok(TD.typeOf('冒險') === 'D' && TD.typeOf('x') === '' && TD.lvOf('hard') === 3 && TD.lvOf('9') === 0, 'typeOf / lvOf');
}

// ---------- review fixes (2026-10-24) ----------
{
  const B = TD.BANK, has = t => B.some(q => q.q === t), find = t => B.find(q => q.q === t);
  // bank edits
  ok(find('在場你覺得誰最有魅力？為什麼？') && find('在場你覺得誰最有魅力？為什麼？').t === 'T' && find('你為了喜歡的人做過最勇敢的一件事是什麼？').t === 'T', 'charm question moved to 真心話');
  ok(!B.some(q => q.t === 'D' && /最有魅力的人|心動的對象/.test(q.q)), 'no truth-style questions left in 大冒險');
  ok(!has('用一個詞形容在場的每一個人。') && !has('站起來大聲唱完一首歌的副歌。'), 'near-duplicates removed');
  ok(find('你覺得在場誰最有可能半夜傳訊息給你？').r === 1 && find('如果明天就是世界末日，你今晚想跟誰在一起？').r === 1, 'flirty truths tagged ♥ (family mode skips them)');
  ok(!B.some(q => /聊天列表的第三位|再掛掉|情侶合照|土味|八百標兵|捷運站名|謝謝你今天來|有沒有曾經|男女朋友|最常用的三個 App/.test(q.q)), 'risky / mainland / weak wording replaced');
  ok(!B.some(q => /念/.test(q.q)), '唸 used consistently (no 念)');
  ok(/乾淨、安全/.test(B.find(q => /拿一樣/.test(q.q)).q) && /願意的人/.test(B.find(q => /偶像劇海報/.test(q.q)).q), 'touch / photo dares need a safe object / a willing partner');
  ok(/三次都不一樣/.test(B.find(q => /背對背/.test(q.q)).q), 'back-to-back dare says what happens after three misses');
  ok(['D1', 'D2', 'D3', 'T1', 'T2', 'T3'].every(k => B.filter(q => q.id.startsWith(k + '-')).length >= 38), 'every level keeps at least 38 questions');
  // names
  ok(TD.cleanName('👨‍👩‍👧') === '👨‍👩‍👧' && TD.glen(TD.cleanName('👨‍👩‍👧')) === 1, 'ZWJ kept: family emoji stays one character');
  ok(eq(TD.splitNames('AC/DC'), ['AC/DC']) && eq(TD.splitNames('A|B'), ['A|B']), 'slash and bar do not split names');
  ok(eq(TD.splitNames('小明 Amy'), ['小明', 'Amy']), 'mixed Chinese + Latin names split on spaces');
  ok(eq(TD.splitNames('小明，阿華, 怡君、家豪'), ['小明', '阿華', '怡君', '家豪']), 'split on ， , 、');
  // timer
  ok(TD.secondsIn('做出 5 種不同的自拍姿勢，每種停 2 秒。') === 0, 'per-step 「每種停 2 秒」 is not a timer');
  ok(TD.secondsIn('用三十秒教大家一個你會的小技能。') === 30 && TD.secondsIn('二十秒') === 20 && TD.secondsIn('十五秒') === 15 && TD.secondsIn('十秒') === 10 && TD.secondsIn('兩分鐘') === 120, 'Chinese numerals: 三十秒 / 二十秒 / 十五秒 / 十秒 / 兩分鐘');
  ok(TD.secondsIn('單腳站 15 秒，同時說出三首歌，每首 2 秒') === 15, 'main duration wins');
  ok(B.filter(q => TD.secondsIn(q.q)).every(q => TD.secondsIn(q.q) >= 5), 'every built-in timer is at least 5 seconds (no per-step durations)');
  // import digits
  const imp = t => TD.parseImport(t, 'T', 2, []);
  let r = imp('1,000 元你會怎麼花？'); ok(r.items[0].q === '1,000 元你會怎麼花？' && r.items[0].lv === 2, 'import keeps 「1,000 元…」');
  r = imp('2，3 個人一組比賽。'); ok(r.items[0].q === '2，3 個人一組比賽。', 'import keeps 「2，3 個人…」');
  r = imp('2:30 的時候你在做什麼？'); ok(r.items[0].q === '2:30 的時候你在做什麼？', 'import keeps 「2:30…」');
  r = imp('3,大冒險,跳舞'); ok(r.items[0].q === '3,大冒險,跳舞' || (r.items[0].t === 'D' && r.items[0].lv === 3), 'level-first CSV is either kept whole or parsed correctly');
  r = imp('大冒險,1,唱歌'); ok(r.items[0].t === 'D' && r.items[0].lv === 1 && r.items[0].q === '唱歌', 'CSV with type first still parses a numeric level');
  r = imp('1｜唱歌給大家聽'); ok(r.items[0].lv === 1 && r.items[0].q === '唱歌給大家聽', '「1｜…」 is still a level prefix');
  r = imp('真心話｜'); ok(r.items.length === 1 && r.items[0].q === '真心話｜' || r.errors.length === 1, 'a bare prefix is not swallowed into an empty question');
  // binary garbage
  r = imp('\u0000\u0001PNG��\u0002\u0003 data'); ok(r.items.length === 0 && /不是文字檔/.test(r.errors[0]), 'binary file rejected with an explanation');
  r = imp('�'); ok(r.items.length === 0 && /不是文字檔/.test(r.errors[0]), 'replacement-character garbage rejected');
  // hidden builtin in backups
  r = imp(TD.exportJSON([{ t: 'T', lv: 1, r: 0, q: '題一？' }], ['T1-1', 'D3-2', 'bogus', 5]));
  ok(eq(r.hidden, ['T1-1', 'D3-2']) && r.items.length === 1, 'backup import returns the disabled built-in ids');
  // pickNext exclude (換人重轉)
  const ps = P(['a', 'b', 'c', 'd']);
  let bad = 0;
  for (let i = 0; i < 200; i++) { const x = TD.pickNext(ps, { bag: ['p3'], last: 'p3' }, 'fair', true, undefined, 'p3'); if (x.id === 'p3' || x.bag.indexOf('p3') < 0) bad++; }
  ok(bad === 0, 'fair respin with only the skipped player left picks someone else and keeps their turn owed');
  bad = 0; for (let i = 0; i < 200; i++) { const x = TD.pickNext(ps, { bag: ['p1', 'p3'], last: 'p3' }, 'fair', true, undefined, 'p3'); if (x.id !== 'p1') bad++; }
  ok(bad === 0, 'fair respin picks from the rest of the bag');
  bad = 0; for (let i = 0; i < 200; i++) { const x = TD.pickNext(ps, { last: 'p0' }, 'random', false, undefined, 'p0'); if (x.id === 'p0') bad++; }
  ok(bad === 0, 'random respin never picks the same player, even with repeats allowed');
  ok(TD.pickNext(P(['solo']), { bag: [], last: 'p0' }, 'fair', true, undefined, 'p0').id === 'p0', 'single player: respin still returns them');
}

// ---------- round 2 review fixes ----------
{
  const B = TD.BANK;
  const dance = B.filter(q => /舞/.test(q.q));
  ok(dance.length <= 2, 'at most two dance dares: ' + dance.map(q => q.q).join(' | '));
  ok(B.filter(q => /最近一次心動/.test(q.q)).length === 1, 'only one 「最近一次心動」 truth');
  const imp = t => TD.parseImport(t, 'T', 2, []);
  let r = imp('1、第一題內容\n2、第二題內容\n(3) 第三題內容\n４．全形不算'); ok(r.items[0].q === '第一題內容' && r.items[1].q === '第二題內容' && r.items[2].q === '第三題內容', 'import strips 「1、」 and 「(3)」 numbering');
  r = imp('[{"text":"甲題目","romance":"false"},{"text":"乙題目","romance":"true"},{"text":"丙題目","romance":0},{"text":"丁題目","r":1},{"text":"戊題目","romance":"否"}]');
  ok(r.items.map(x => x.r).join('') === '01010', 'romance parsed strictly: "false"/0/"否" are not romance ' + r.items.map(x => x.r).join(''));
  ok(TD.boolOf('TRUE') && !TD.boolOf('false') && !TD.boolOf('') && !TD.boolOf(null) && TD.boolOf(1) && !TD.boolOf(2), 'boolOf');
}

// ---------- awards ----------
{
  const ps = P(['a', 'b']);
  const aw = TD.awards(ps, { p0: { D: 3, T: 0, skip: 2 }, p1: { D: 1, T: 2, skip: 2 } });
  ok(eq(aw.p0, ['最勇敢']) && eq(aw.p1, ['最誠實']), 'awards: unique leaders only, ties get none ' + JSON.stringify(aw));
  ok(eq(TD.awards(ps, {}), {}), 'awards: none with no data');
}

// ---------- randomness ----------
{
  const c = [0, 0, 0]; for (let i = 0; i < 30000; i++) c[TD.randInt(3)]++;
  ok(c.every(v => Math.abs(v / 30000 - 1 / 3) < 0.015), 'randInt(3) uniform ' + c);
  ok(TD.randInt(1) === 0 && TD.randInt(0) === 0, 'randInt(1|0) = 0');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
