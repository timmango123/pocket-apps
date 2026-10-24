// Core logic tests for 購物清單 (shopping-list), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {CATS,parseEntry,splitEntries,parseText,categorize,normName,cnNum,toHalf,qtyText,totals,lineCents,fmtMoney,groupItems,shareText,mergeAdd,rankFrequent,suggest,cleanState,catOrder};')();
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } }
const P = s => C.parseEntry(s);
function pe(input, exp) {
  const r = P(input);
  const ok = Object.keys(exp).every(k => JSON.stringify(r[k]) === JSON.stringify(exp[k]));
  t('parse ' + JSON.stringify(input), ok, r);
}

// ---- quantity parsing (expected values written by hand) ----
pe('鮮奶', { name: '鮮奶', qty: 1, unit: '', hasQty: false });
pe('鮮奶 2 瓶', { name: '鮮奶', qty: 2, unit: '瓶', hasQty: true });
pe('鮮奶2瓶', { name: '鮮奶', qty: 2, unit: '瓶' });
pe('雞蛋兩盒', { name: '雞蛋', qty: 2, unit: '盒' });
pe('兩盒雞蛋', { name: '雞蛋', qty: 2, unit: '盒' });
pe('2 盒 豆腐', { name: '豆腐', qty: 2, unit: '盒' });
pe('蘋果 x3', { name: '蘋果', qty: 3, unit: '' });
pe('蘋果x3', { name: '蘋果', qty: 3, unit: '' });
pe('蘋果×3', { name: '蘋果', qty: 3 });
pe('蘋果*3顆', { name: '蘋果', qty: 3, unit: '顆' });
pe('3x 優格', { name: '優格', qty: 3 });
pe('香蕉 3', { name: '香蕉', qty: 3, unit: '' });
pe('五花肉半斤', { name: '五花肉', qty: 0.5, unit: '斤' });
pe('豬肉 1.5 公斤', { name: '豬肉', qty: 1.5, unit: '公斤' });
pe('豬絞肉600g', { name: '豬絞肉', qty: 600, unit: 'g' });
pe('雞胸肉 1KG', { name: '雞胸肉', qty: 1, unit: 'kg' });
pe('豆腐 一盒半', { name: '豆腐', qty: 1.5, unit: '盒' });
pe('十二顆雞蛋', { name: '雞蛋', qty: 12, unit: '顆' });
pe('蛋 二十個', { name: '蛋', qty: 20, unit: '個' });
pe('雞蛋 1 打', { name: '雞蛋', qty: 1, unit: '打' });
pe('麥香紅茶 300ml 6 瓶', { name: '麥香紅茶 300ml', qty: 6, unit: '瓶' });
pe('鮮奶 ２ 瓶', { name: '鮮奶', qty: 2, unit: '瓶' });          // full-width digit
pe('ｘｂｏｘ 手把', { name: 'xbox 手把', qty: 1 });                  // full-width latin, no qty
// names that look like numbers but are not quantities
pe('一條根', { name: '一條根', qty: 1, hasQty: false });
pe('三杯醬', { name: '三杯醬', qty: 1, hasQty: false });
pe('九層塔', { name: '九層塔', qty: 1, hasQty: false });
pe('四季豆', { name: '四季豆', qty: 1, hasQty: false });
pe('百香果', { name: '百香果', qty: 1, hasQty: false });
pe('電池 3 號', { name: '電池 3 號', qty: 1, hasQty: false });
pe('5 號電池', { name: '5 號電池', qty: 1, hasQty: false });
pe('3M 口罩', { name: '3M 口罩', qty: 1, hasQty: false });
pe('Max2', { name: 'Max2', qty: 1, hasQty: false });
pe('7-11 咖啡', { name: '7-11 咖啡', hasQty: false });
pe('🍌 香蕉 2 串', { name: '🍌 香蕉', qty: 2, unit: '串' });
pe('<b>可樂</b> 2', { name: '<b>可樂</b>', qty: 2 });                // kept as text, escaped at render
// price and notes
pe('吐司 $45', { name: '吐司', price: 45, qty: 1 });
pe('鮮奶 2 瓶 $95', { name: '鮮奶', qty: 2, unit: '瓶', price: 95 });
pe('鮮奶 2 瓶（低脂）（單價 $95）', { name: '鮮奶', qty: 2, unit: '瓶', note: '低脂', price: 95 });
pe('衛生紙 1 箱 559元', { name: '衛生紙', qty: 1, unit: '箱', price: 559 });
pe('冷氣濾網 NT$1,299', { name: '冷氣濾網', price: 1299 });
pe('鮮奶(低脂) x2', { name: '鮮奶', qty: 2, note: '低脂' });
// bullets and check marks
pe('・高麗菜 1 顆', { name: '高麗菜', qty: 1, unit: '顆', done: false });
pe('- 高麗菜', { name: '高麗菜' });
pe('1. 高麗菜', { name: '高麗菜', qty: 1, hasQty: false });
pe('1.5 斤 豬肉', { name: '豬肉', qty: 1.5, unit: '斤' });
pe('☑ 雞蛋 1 盒', { name: '雞蛋', qty: 1, unit: '盒', done: true });
pe('[x] 雞蛋', { name: '雞蛋', done: true });
pe('☐ 雞蛋', { name: '雞蛋', done: false });
// errors
t('empty -> error', P('').error === 'empty' && P('   ').error === 'empty');
t('only qty -> noname', P('2 瓶').error === 'noname', P('2 瓶'));
t('x0 -> zero', P('蘋果 x0').error === 'zero', P('蘋果 x0'));
t('0 個 -> zero', P('蘋果 0 個').error === 'zero', P('蘋果 0 個'));
t('negative -> neg', P('蘋果 x-2').error === 'neg' && P('蘋果 -2').error === 'neg', [P('蘋果 x-2'), P('蘋果 -2')]);
t('huge qty -> big', P('米 x100000').error === 'big', P('米 x100000'));
t('long name truncated to 60 and flagged', P('長'.repeat(80)).name.length === 60 && P('長'.repeat(80)).cut === true && !P('鮮奶').cut);
t('$0 price ignored', P('試吃 $0').price === null);

// ---- review round 1 fixes ----
pe('絞肉 300 克', { name: '絞肉', qty: 300, unit: '克' });
pe('豬肉 1 台斤', { name: '豬肉', qty: 1, unit: '台斤' });
pe('鮮奶油 200cc', { name: '鮮奶油', qty: 200, unit: 'cc' });
pe('鮮奶油 200CC', { name: '鮮奶油', qty: 200, unit: 'cc' });
pe('茶葉 三兩', { name: '茶葉', qty: 3, unit: '兩' });
pe('茶葉半兩', { name: '茶葉', qty: 0.5, unit: '兩' });
pe('雞蛋兩盒', { name: '雞蛋', qty: 2, unit: '盒' });          // 兩 as a unit must not break 兩 as a number
pe('兩盒雞蛋', { name: '雞蛋', qty: 2, unit: '盒' });
pe('蔥一把', { name: '蔥', qty: 1, unit: '把' });
pe('蛋一盒', { name: '蛋', qty: 1, unit: '盒' });
pe('薑一塊', { name: '薑', qty: 1, unit: '塊' });
pe('米一包', { name: '米', qty: 1, unit: '包' });
pe('魚兩尾', { name: '魚', qty: 2, unit: '尾' });
pe('蝦半斤', { name: '蝦', qty: 0.5, unit: '斤' });
pe('一條根', { name: '一條根', hasQty: false });
t('1-char name known only from memory', C.parseEntry('橙一箱').unit === '箱' && C.parseEntry('柿一箱').hasQty === false && C.parseEntry('柿一箱', { '柿': { name: '柿' } }).unit === '箱', [C.parseEntry('柿一箱')]);
pe('豬肉 兩百五 公克', { name: '豬肉', qty: 250, unit: '公克' });
const cn2 = { '兩百五': 250, '兩百五十': 250, '兩百零五': 205, '一千二': 1200, '一千零二十': 1020, '三千': 3000, '一百一': 110 };
for (const k in cn2) t('cnNum spoken ' + k, C.cnNum(k) === cn2[k], C.cnNum(k));
const cat2 = { '巧克力牛奶': 'dairy', '葡萄酒': 'drinks', '蝦餅': 'snacks', '毛巾': 'household', '保久乳': 'dairy' };
for (const k in cat2) t('categorize ' + k, C.categorize(k) === cat2[k], C.categorize(k));
{
  // names that would re-parse differently get an explicit ×1 so share → paste is lossless
  const odd = ['維他命C 1000', '麥香紅茶 300ml', '電池 x2', '1. 鮮奶', '☑ 勾勾', '一條根'];
  const list = { name: 'odd', items: odd.map((n, i) => ({ id: 'o' + i, name: n, qty: 1, unit: '', cat: 'other', store: '', price: null, note: '', done: false, doneAt: 0, added: i })) };
  const back = C.parseText(C.shareText(list, [], 'all', {})).items;
  t('odd names round-trip exactly', JSON.stringify(back.map(e => [e.name, e.qty, e.unit])) === JSON.stringify(odd.map(n => [n, 1, ''])), back.map(e => [e.name, e.qty, e.unit]));
}

// ---- chinese numerals ----
const cn = { '一': 1, '兩': 2, '十': 10, '十二': 12, '二十': 20, '二十五': 25, '一百': 100, '一百二十': 120, '兩百零五': 205, '半': 0.5, '3': 3, '2.5': 2.5 };
for (const k in cn) t('cnNum ' + k, C.cnNum(k) === cn[k], C.cnNum(k));
t('cnNum rejects garbage', isNaN(C.cnNum('十十')) && isNaN(C.cnNum('abc')));

// ---- splitting ----
t('split 、', JSON.stringify(C.splitEntries('鮮奶、雞蛋、吐司')) === '["鮮奶","雞蛋","吐司"]');
t('split , keeps 1,299', JSON.stringify(C.splitEntries('濾網 $1,299, 牙膏')) === '["濾網 $1299","牙膏"]', C.splitEntries('濾網 $1,299, 牙膏'));
t('split keeps parentheses', JSON.stringify(C.splitEntries('鮮奶（低脂，大瓶）；蛋')) === '["鮮奶（低脂，大瓶）","蛋"]', C.splitEntries('鮮奶（低脂，大瓶）；蛋'));
t('split lines + blanks', C.splitEntries('a\n\n b \r\nc').length === 3);

// ---- categories ----
const cat = { '高麗菜': 'produce', '雞蛋': 'dairy', '蛋糕': 'bakery', '水餃': 'frozen', '冷凍水餃': 'frozen', '洗髮精': 'care', '衛生紙': 'household', '醬油': 'condiment', '奶茶': 'drinks', '香蕉牛奶': 'dairy', '草莓果醬': 'bakery', '番茄醬': 'condiment', '魷魚絲': 'snacks', '牛肉乾': 'snacks', '米酒': 'condiment', '玉米': 'produce', '麵包': 'bakery', '漱口水': 'care', '鮭魚': 'seafood', '豬五花': 'meat', '貓砂': 'other', '神秘物品': 'other', '可樂': 'drinks', 'OK繃': 'care', '雞粉': 'condiment' };
for (const k in cat) t('categorize ' + k, C.categorize(k) === cat[k], C.categorize(k));
t('memory overrides dictionary', C.categorize('雞蛋', { '雞蛋': { cat: 'other' } }) === 'other');

// ---- qty text / money ----
t('qtyText unit', C.qtyText({ qty: 2, unit: '瓶' }) === '2 瓶');
t('qtyText plain 1', C.qtyText({ qty: 1, unit: '' }) === '');
t('qtyText plain 3', C.qtyText({ qty: 3, unit: '' }) === '×3');
t('qtyText 1.5', C.qtyText({ qty: 1.5, unit: '斤' }) === '1.5 斤');
t('lineCents 95x2', C.lineCents({ price: 95, qty: 2 }) === 19000);
t('lineCents 0.1x3 exact', C.lineCents({ price: 0.1, qty: 3 }) === 30);
t('lineCents 120 x 1.5', C.lineCents({ price: 120, qty: 1.5 }) === 18000);
t('lineCents 33.33 x 3', C.lineCents({ price: 33.33, qty: 3 }) === 9999);
t('fmtMoney', C.fmtMoney(154700) === '$1,547' && C.fmtMoney(1250) === '$12.5' && C.fmtMoney(9999) === '$99.99' && C.fmtMoney(0) === '$0');
{
  const items = [{ price: 95, qty: 2, done: false }, { price: null, qty: 5, done: false }, { price: 78, qty: 1, done: true }, { price: 12.5, qty: 3, done: false }];
  const r = C.totals(items);
  // independent: left = 190 + 37.5 = 227.5 ; done = 78
  t('totals', r.count === 4 && r.left === 3 && r.done === 1 && r.leftCents === 22750 && r.doneCents === 7800 && r.priced === 3, r);
}

// ---- grouping ----
const stores = [{ id: 'a', name: '全聯', color: '#d1495b', order: C.catOrder({ order: ['household', 'produce'] }) }, { id: 'b', name: 'Costco', color: '#2e86ab', order: C.catOrder(null) }];
const mk = (id, name, cat, store, done, added) => ({ id, name, qty: 1, unit: '', cat, store, price: null, note: '', done: !!done, doneAt: done ? added : 0, added });
const items = [mk('1', '高麗菜', 'produce', 'a', 0, 1), mk('2', '洗碗精', 'household', 'a', 0, 2), mk('3', '番茄', 'produce', 'a', 0, 3), mk('4', '衛生紙', 'household', 'b', 0, 4), mk('5', '電池', 'other', '', 0, 5), mk('6', '雞蛋', 'dairy', 'a', 1, 6), mk('7', '鮮奶', 'dairy', 'zz', 0, 7)];
{
  const g = C.groupItems(items, stores, 'all', null);
  t('all: store order a, b, none', g.groups.map(x => x.store).join() === 'a,b,', g.groups.map(x => x.store));
  t('all: aisle order in 全聯 (household first)', g.groups[0].cats.map(c => c.cat).join() === 'household,produce', g.groups[0].cats.map(c => c.cat));
  t('all: produce keeps add order', g.groups[0].cats[1].items.map(i => i.id).join() === '1,3');
  t('all: unknown store treated as anywhere', g.groups[2].cats.flatMap(c => c.items).map(i => i.id).sort().join() === '5,7');
  t('all: done separated', g.done.length === 1 && g.done[0].id === '6');
  t('all: show store headers', g.showStore);
  const f = C.groupItems(items, stores, 'b', null);
  t('filter b: b then anywhere', f.groups.map(x => x.store).join() === 'b,' && f.groups[1].name === '哪裡都能買');
  t('filter b: no 全聯 items', !f.vis.some(i => i.store === 'a'));
  const h = C.groupItems(items, stores, 'all', new Map([['6', false], ['1', true]]));
  t('hold keeps a just-checked row in place', h.groups[0].cats.some(c => c.items.some(i => i.id === '6')) && h.done.some(i => i.id === '1'));
  const single = C.groupItems([mk('x', '蛋', 'dairy', '', 0, 1)], stores, 'all', null);
  t('only anywhere items: no store header', !single.showStore);
}

// ---- merging ----
{
  let n = 0; const id = () => 'n' + (n++);
  const list = { items: [] };
  const a = C.mergeAdd(list, P('鮮奶 2 瓶'), 's1', 'dairy', 1, id);
  t('merge: new', a.action === 'new' && list.items.length === 1);
  const b = C.mergeAdd(list, P('鮮奶'), 's1', 'dairy', 2, id);
  t('merge: same name same store sums', b.action === 'merged' && list.items[0].qty === 3 && list.items[0].unit === '瓶' && list.items.length === 1, list.items);
  const c = C.mergeAdd(list, P('鮮奶 1 箱'), 's1', 'dairy', 3, id);
  t('merge: different unit -> separate row', c.action === 'new' && list.items.length === 2);
  const d = C.mergeAdd(list, P('鮮奶'), 's2', 'dairy', 4, id);
  t('merge: other store -> separate row', d.action === 'new' && list.items.length === 3);
  list.items[0].done = true;
  const e = C.mergeAdd(list, P('鮮奶 1 瓶'), 's1', 'dairy', 5, id);
  t('merge: re-adding a bought item revives it with new qty', e.action === 'revived' && !list.items[0].done && list.items[0].qty === 1);
  const f = C.mergeAdd(list, P(' 鮮奶  '), 's1', 'dairy', 6, id);
  t('merge: whitespace-insensitive', f.action === 'merged');
  list.items[0].qty = 9998; C.mergeAdd(list, P('鮮奶 5 瓶'), 's1', 'dairy', 7, id);
  t('merge: capped at 9999', list.items[0].qty === 9999);
}

// ---- paste / share round trip ----
{
  const r = C.parseText('🛒 每週採買\n還要買 3 項・預估 $240\n\n【全聯】\n☐ 鮮奶 2 瓶（低脂）（單價 $95）\n蛋奶豆品\n☐ 雞蛋\n【不限店家】\n☐ 電池 ×4\n—— 已買 1 項 ——\n☑ 吐司 1 條');
  t('parseText items', r.items.map(e => e.name).join() === '鮮奶,雞蛋,電池,吐司', r.items.map(e => e.name));
  t('parseText stores', r.items[0].store === '全聯' && r.items[2].store === '' && r.items[3].store === undefined, r.items.map(e => e.store));
  t('parseText qty/price/note/done', r.items[0].qty === 2 && r.items[0].price === 95 && r.items[0].note === '低脂' && r.items[2].qty === 4 && r.items[3].done === true);
  const r2 = C.parseText('鮮奶、雞蛋、吐司\n\n衛生紙 x2\n2 瓶\n蘋果 x0');
  t('parseText LINE style + errors', r2.items.length === 4 && r2.errors.length === 2, r2);
  // build a list, share it, paste it back: same items
  const list = { name: '測試', items: [mk('1', '高麗菜', 'produce', 'a', 0, 1), mk('2', '洗碗精', 'household', 'a', 0, 2), mk('4', '衛生紙', 'household', 'b', 0, 4), mk('5', '電池', 'other', '', 0, 5), mk('6', '雞蛋', 'dairy', 'a', 1, 6)] };
  list.items[0].qty = 2; list.items[0].unit = '顆'; list.items[1].price = 59; list.items[1].note = '補充包'; list.items[3].qty = 4;
  const txt = C.shareText(list, stores, 'all', { withDone: true });
  t('share text header', txt.startsWith('🛒 測試\n還要買 4 項・預估 $59'), txt);
  t('share text store headers', txt.includes('【全聯】') && txt.includes('【Costco】') && txt.includes('【不限店家】'));
  t('share text aisle order (洗碗精 before 高麗菜 in 全聯)', txt.indexOf('洗碗精') < txt.indexOf('高麗菜'));
  t('share text done line', txt.includes('☑ 雞蛋'));
  const back = C.parseText(txt);
  const sig = e => [e.name, e.qty, e.unit, e.price, e.note, !!e.done].join('|');
  const want = ['洗碗精|1||59|補充包|false', '高麗菜|2|顆|||false', '衛生紙|1||||false', '電池|4||||false', '雞蛋|1||||true'];
  t('share -> paste round trip', JSON.stringify(back.items.map(sig).map(s => s.replace('|null|', '||'))) === JSON.stringify(want), back.items.map(sig));
  t('round trip keeps stores', back.items.map(e => e.store).join() === '全聯,全聯,Costco,,全聯', back.items.map(e => e.store));
  const only = C.shareText(list, stores, 'b', {});
  t('share one store excludes others', only.includes('衛生紙') && !only.includes('高麗菜') && only.includes('電池') && !only.includes('雞蛋'), only);
  const empty = C.shareText({ name: '空', items: [] }, stores, 'all', {});
  t('share empty list', empty === '🛒 空\n全部買齊了', empty);
}

// ---- frequent / suggest ----
{
  const mem = { '鮮奶': { name: '鮮奶', n: 5, t: 1 }, '雞蛋': { name: '雞蛋', n: 9, t: 1 }, '鮮奶油': { name: '鮮奶油', n: 1, t: 5 }, 'x': { name: 'x', n: 0, t: 9 } };
  t('rankFrequent by count, drops n=0', C.rankFrequent(mem).map(m => m.name).join() === '雞蛋,鮮奶,鮮奶油');
  const s = C.suggest(mem, '鮮', 4).map(x => x.name);
  t('suggest memory first then dictionary', s[0] === '鮮奶' && s[1] === '鮮奶油' && s.length >= 3, s);
  t('suggest empty query', C.suggest(mem, '  ', 4).length === 0);
}

// ---- state cleaning (corrupt storage / bad imports never crash) ----
{
  t('clean null', C.cleanState(null) === null && C.cleanState('x') === null && C.cleanState({}) === null && C.cleanState({ lists: [] }) === null);
  const st = C.cleanState({ lists: [{ id: 'a', name: '', items: [{ name: '  ' }, { name: '蛋', qty: -3, price: 'x', cat: 'nope', store: 'gone' }, { id: 'd', name: 'A', qty: 1e9 }, { id: 'd', name: 'B', qty: 2 }, 5, null] }, null, { id: 'a', name: 'dup' }], stores: [{ id: 's', name: '全聯', color: 'red' }, { id: 's', name: 'dup' }, { name: 'noid' }], mem: { k: { name: '蛋', n: 'x' }, j: 7 }, cur: 'zzz', filter: 'gone' });
  const l = st.lists[0];
  t('clean: default list name', l.name === '購物清單');
  t('clean: blank names dropped, junk skipped', l.items.length === 3, l.items);
  t('clean: bad qty -> 1, bad price -> null, cat inferred, unknown store cleared', l.items[0].qty === 1 && l.items[0].price === null && l.items[0].cat === 'dairy' && l.items[0].store === '');
  t('clean: duplicate ids made unique', new Set(l.items.map(i => i.id)).size === 3);
  t('clean: huge qty -> 1', l.items[1].qty === 1);
  t('clean: duplicate list ids', st.lists.length === 2 && st.lists[0].id !== st.lists[1].id);
  t('clean: stores deduped, colour fixed', st.stores.length === 1 && /^#[0-9a-f]{6}$/i.test(st.stores[0].color) && st.stores[0].order.length === C.CATS.length);
  t('clean: cur/filter fall back', st.cur === 'a' && st.filter === 'all');
  t('clean: mem sanitized', st.mem['蛋'].n === 0 && Object.keys(st.mem).length === 1);
  // 2000 items survive and group quickly
  const big = { lists: [{ id: 'b', name: 'big', items: Array.from({ length: 2000 }, (_, i) => ({ id: 'i' + i, name: '品項' + i, qty: (i % 5) + 1, price: i % 7 ? 10 + i % 50 : null, cat: C.CATS[i % C.CATS.length].id, done: i % 3 === 0, added: i })) }], stores: [] };
  const t0 = Date.now(); const bs = C.cleanState(big); const g = C.groupItems(bs.lists[0].items, [], 'all', null); const tt = C.totals(bs.lists[0].items);
  let exp = 0, expLeft = 0; big.lists[0].items.forEach(i => { if (i.done) exp++; else if (i.price) expLeft += i.price * i.qty * 100; });
  t('2000 items: counts and totals', tt.count === 2000 && tt.done === exp && tt.leftCents === expLeft && g.done.length === exp, [tt, exp, expLeft]);
  t('2000 items: fast (<300ms)', Date.now() - t0 < 300, Date.now() - t0);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
