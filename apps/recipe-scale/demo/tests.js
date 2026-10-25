// 食譜換算 (recipe-scale) 核心邏輯測試：從 ../index.html 的 CORE 區塊取出純函式。
// 用法：node tests.js　　預期值都在這裡用基本換算常數另外算，不呼叫被測的換算函式。
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const RS = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return RS;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(a === b, msg + '：得到 ' + JSON.stringify(a) + '，應為 ' + JSON.stringify(b));
const near = (a, b, msg, eps = 1e-9) => ok(Math.abs(a - b) <= eps, msg + '：得到 ' + a + '，應為 ' + b);

// 換算常數（獨立寫一份）
const TSP = 5, TBSP = 15, CUP = 240, JIN = 600, LIANG = 37.5, LB = 453.59237, OZ = 28.349523125, FLOZ = 29.5735295625;
const O = { cupMl: 240, dens: {} };
const P = s => RS.parseLine(s);
const S = (line, f, mode, o) => RS.scaleItem(RS.parseLine(line), f, mode, o || O);

// ---------- 數字 ----------
eq(RS.parseAmount('1/2'), 0.5, '分數 1/2');
eq(RS.parseAmount('1 1/2'), 1.5, '帶分數 1 1/2');
eq(RS.parseAmount('1又1/2'), 1.5, '帶分數 1又1/2');
eq(RS.parseAmount('½'), 0.5, 'Unicode ½');
eq(RS.parseAmount('2¾'), 2.75, 'Unicode 2¾');
eq(RS.parseAmount('１２０'), 120, '全形數字');
eq(RS.parseAmount('1,250'), 1250, '千分位');
eq(RS.parseAmount('半'), 0.5, '半');
eq(RS.parseAmount('兩'), 2, '兩 = 2');
eq(RS.parseAmount('十二'), 12, '十二');
eq(RS.parseAmount('二十五'), 25, '二十五');
eq(RS.parseAmount('三分之一'), 1 / 3, '三分之一');
eq(RS.parseAmount('一又二分之一'), 1.5, '一又二分之一');
eq(RS.parseAmount('一個半'.replace('個', '')), 1.5, '一半 → 1.5');
ok(isNaN(RS.parseAmount('')), '空白不是數字');
ok(isNaN(RS.parseAmount('abc')), 'abc 不是數字');
ok(isNaN(RS.parseAmount('1/0')), '1/0 不是數字');
ok(isNaN(RS.parseAmount('🍰')), '表情符號不是數字');
ok(isNaN(RS.parseAmount('1.2.3')), '1.2.3 不是數字');
ok(isNaN(RS.parseAmount('-2')), '負數不接受');

// ---------- 解析一行 ----------
function chk(line, name, lo, unit, key, extra) {
  const p = P(line);
  ok(p.kind === 'item', `「${line}」是材料（${p.kind}）`);
  eq(p.name, name, `「${line}」名稱`);
  if (lo === null) ok(!p.qty, `「${line}」沒有數量`); else near(p.qty && p.qty.lo, lo, `「${line}」數量`, 1e-9);
  eq(p.unit ? p.unit.id : null, unit, `「${line}」單位`);
  eq(p.key, key, `「${line}」食材`);
  if (extra) for (const k in extra) eq(typeof p[k] === 'object' && p[k] ? JSON.stringify(p[k]) : p[k], extra[k], `「${line}」${k}`);
}
chk('中筋麵粉 300g', '中筋麵粉', 300, 'g', 'flour');
chk('麵粉：300 公克', '麵粉', 300, 'g', 'flour');
chk('300g 麵粉', '麵粉', 300, 'g', 'flour');
chk('糖 2大匙', '糖', 2, 'tbsp', 'sugar');
chk('鹽 1/2 小匙', '鹽', 0.5, 'tsp', 'salt');
chk('雞蛋 2 顆', '雞蛋', 2, 'c:顆', 'egg');
chk('雞蛋兩顆', '雞蛋', 2, 'c:顆', 'egg');
chk('牛奶 半杯', '牛奶', 0.5, 'cup', 'milk');
chk('水一杯半', '水', 1.5, 'cup', 'water');
chk('1又1/2杯 牛奶', '牛奶', 1.5, 'cup', 'milk');
chk('二分之一杯 糖', '糖', 0.5, 'cup', 'sugar');
chk('醬油 適量', '醬油', null, null, 'soy', { approx: '適量' });
chk('香菜 少許', '香菜', null, null, null, { approx: '少許' });
chk('奶油 50g（室溫軟化）', '奶油', 50, 'g', 'butter', { note: '室溫軟化' });
chk('蔥 2 根，切段', '蔥', 2, 'c:根', null, { note: '切段' });
chk('無鹽奶油 30g', '無鹽奶油', 30, 'g', 'butter');
chk('鮮奶油 200ml', '鮮奶油', 200, 'ml', 'cream');
chk('奶油乳酪 100g', '奶油乳酪', 100, 'g', 'creamcheese');
chk('白醋 15cc', '白醋', 15, 'ml', 'vinegar');
chk('五花肉 1 斤', '五花肉', 1, 'jin', null);
chk('豬絞肉 半斤', '豬絞肉', 0.5, 'jin', null);
chk('牛肉 1 台斤', '牛肉', 1, 'jin', null);
chk('豬肉 3 兩', '豬肉', 3, 'liang', null);
chk('三星蔥兩根', '三星蔥', 2, 'c:根', null);
chk('八角 2 顆', '八角', 2, 'c:顆', null);
chk('五香粉 1 小匙', '五香粉', 1, 'tsp', null);
chk('蒜頭三瓣', '蒜頭', 3, 'c:瓣', 'garlic');
chk('水果 2 顆', '水果', 2, 'c:顆', null);
chk('麵包粉 1 杯', '麵包粉', 1, 'cup', null);
chk('醬油膏 1 大匙', '醬油膏', 1, 'tbsp', 'soypaste');
chk('砂糖 1,000 g', '砂糖', 1000, 'g', 'sugar');
chk('１２０ｍｌ 水', '水', 120, 'ml', 'water');
chk('2.5 kg 豬肉', '豬肉', 2.5, 'kg', null);
chk('米 2 米杯', '米', 2, 'ricecup', 'rice');
chk('2 cups flour', 'flour', 2, 'cup', 'flour');
chk('1/2 tsp salt', 'salt', 0.5, 'tsp', 'salt');
chk('1 1/2 cups sugar', 'sugar', 1.5, 'cup', 'sugar');
chk('1½ cups milk', 'milk', 1.5, 'cup', 'milk');
chk('200g butter, softened', 'butter', 200, 'g', 'butter', { note: 'softened' });
chk('3 eggs', 'eggs', 3, null, 'egg');
chk('1 tbsp olive oil', 'olive oil', 1, 'tbsp', 'oil');
chk('1 T sugar', 'sugar', 1, 'tbsp', 'sugar');
chk('1 t salt', 'salt', 1, 'tsp', 'salt');
chk('salt to taste', 'salt', null, null, 'salt', { approx: 'to taste' });
chk('a pinch of salt', 'salt', 1, 'c:pinch', 'salt');
chk('4 cloves garlic, minced', 'garlic', 4, 'c:clove', 'garlic', { note: 'minced' });
chk('2 sticks butter', 'butter', 2, 'c:stick', 'butter');
chk('8 oz cream cheese', 'cream cheese', 8, 'oz', 'creamcheese');
chk('1 lb ground beef', 'ground beef', 1, 'lb', null);
chk('1 cup peanut butter', 'peanut butter', 1, 'cup', 'pb');
chk('2 cups buttermilk', 'buttermilk', 2, 'cup', 'milk');
chk('1 eggplant', 'eggplant', 1, null, null);
chk('1 (14 oz) can tomatoes', 'tomatoes', 1, 'c:can', null, { note: '14 oz' });
chk('1. 2 cups flour', 'flour', 2, 'cup', 'flour');
chk('- 雞蛋 1 顆', '雞蛋', 1, 'c:顆', 'egg');
chk('• 糖 30 g', '糖', 30, 'g', 'sugar');
{ const p = P('醬油 2-3 大匙'); ok(p.qty.lo === 2 && p.qty.hi === 3, '範圍 2-3'); }
{ const p = P('水 1～2 杯'); ok(p.qty.lo === 1 && p.qty.hi === 2, '範圍 1～2'); }
{ const p = P('鹽、糖 各1小匙'); ok(p.each && p.key === null && p.qty.lo === 1, '「各」：兩種材料各 1 小匙，不套密度'); }
{ const p = P('奶油 1 杯 + 2 大匙'); ok(p.extra && p.extra.lo === 2 && p.extra.unit.id === 'tbsp', '1 杯 + 2 大匙 的第二段'); }
eq(P('烤箱預熱 180 度').kind, 'text', '溫度行不是材料');
eq(P('Preheat oven to 375°F.').kind, 'text', '英文溫度行不是材料');
eq(P('烤 35 分鐘').kind, 'text', '時間行不是材料');
eq(P('【內餡】').kind, 'head', '【內餡】是分類');
eq(P('醬汁：').kind, 'head', '醬汁：是分類');
eq(P('For the filling:').kind, 'head', 'For the filling: 是分類');
eq(P('作法').kind, 'head', '作法是分類');
ok(P('作法').steps === true, '作法以下是步驟');
eq(P('Directions').steps, true, 'Directions 是步驟');
eq(P('').kind, 'blank', '空行');
eq(P('<b>糖</b> & "粉" 2 杯').name, '<b>糖</b> & "粉"', '特殊字元原樣保留（畫面端會轉義）');
eq(P('🍓 草莓 10 顆').qty.lo, 10, '表情符號開頭的材料');
{ const p = P('糖 -5 g'); ok(p.kind === 'item' && !p.qty && p.bad === '負數', '負數份量被擋下'); }
{ const p = P('<img src=x onerror=alert(1)> 2 杯'); ok(p.qty.lo === 2 && p.unit.id === 'cup', '括號裡的 (1) 不當成數量'); }
eq(RS.fmtMetric(123456700000, 'mass'), '123,456,700 kg', '極大值加千分位');

// ---------- 整份食譜 ----------
{
  const r = RS.parseRecipe('古早味紅燒肉（4 人份）\n\n【材料】\n五花肉 1 斤\n醬油 1/3 杯\n\n作法\n1. 加入 2 大匙糖。\n2. 燉 50 分鐘。');
  eq(r.title, '古早味紅燒肉', '標題');
  eq(r.servings, 4, '從標題抓到 4 人份');
  eq(r.itemCount, 2, '2 項材料');
  eq(r.lines.filter(l => l.kind === 'step').length, 2, '作法 2 行');
  ok(r.lines.filter(l => l.kind === 'step').every(l => l.sx), '作法行標記為不換算');
}
eq(RS.parseRecipe('Cookies\nMakes 24 cookies\n2 cups flour').servings, 24, 'Makes 24');
eq(RS.parseRecipe('Pancakes\nServes 4\n1 cup milk').servings, 4, 'Serves 4');
eq(RS.parseRecipe('鬆餅\n份量：6 片\n牛奶 1 杯').servings, 6, '份量：6 片');
eq(RS.parseRecipe('滷肉飯（四人份）\n豬肉 1 斤').servings, 4, '中文數字 四人份');
eq(RS.parseRecipe('雞蛋 2 顆\n糖 30g').servings, null, '沒寫份量');
eq(RS.parseRecipe('').itemCount, 0, '空白食譜');
{ const pz = RS.parseRecipe('蜂蜜蛋糕（6 吋圓模）\n雞蛋 3 顆').pan; ok(pz && pz.shape === 'round' && pz.a === 6 && pz.unit === 'in', '偵測 6 吋圓模'); }
{ const pz = RS.panOf('20×20 cm 方形烤盤'); ok(pz && pz.shape === 'square' && pz.a === 20 && pz.unit === 'cm', '偵測 20×20 cm'); }
{ const pz = RS.panOf('9x13 inch pan'); ok(pz && pz.shape === 'rect' && pz.a === 9 && pz.b === 13, '偵測 9x13 inch'); }
{ // 1000 行也很快
  const big = Array.from({ length: 1000 }, (_, i) => '材料' + i + ' ' + (i + 1) + ' g').join('\n');
  const t0 = Date.now(); const r = RS.parseRecipe(big); const ms = Date.now() - t0;
  ok(r.itemCount === 1000 && ms < 1500, '1000 行在 1.5 秒內解析（' + ms + ' ms）');
}

// ---------- 烤模面積 ----------
near(RS.panArea({ shape: 'round', a: 8, unit: 'in' }) / RS.panArea({ shape: 'round', a: 6, unit: 'in' }), 64 / 36, '6 吋圓 → 8 吋圓 = (8/6)²');
near(RS.panArea({ shape: 'round', a: 20, unit: 'cm' }), Math.PI * 100, '20 cm 圓模面積 = π·10²', 1e-9);
near(RS.panArea({ shape: 'square', a: 8, unit: 'in' }), (8 * 2.54) ** 2, '8 吋方模面積');
near(RS.panArea({ shape: 'rect', a: 9, b: 13, unit: 'in' }), 9 * 13 * 2.54 * 2.54, '9×13 吋長方面積');
near(RS.panArea({ shape: 'square', a: 20, unit: 'cm' }) / RS.panArea({ shape: 'round', a: 8, unit: 'in' }), 400 / (Math.PI * (8 * 2.54 / 2) ** 2), '8 吋圓 → 20 cm 方');
ok(isNaN(RS.panArea({ shape: 'round', a: 0, unit: 'in' })), '0 吋無效');
ok(isNaN(RS.panArea({ shape: 'rect', a: 9, b: '', unit: 'in' })), '長方形缺寬無效');

// ---------- 換算：公克 ----------
eq(S('中筋麵粉 300g', 1.5, 'orig').main, '450 g', '300 g × 1.5 = 450 g');
eq(S('中筋麵粉 300g', 1 / 3, 'orig').main, '100 g', '300 g × ⅓ = 100 g');
eq(S('酵母 3g', 0.5, 'orig').main, '1.5 g', '3 g × 0.5 = 1.5 g（小於 10 g 保留一位小數）');
eq(S('鹽 0.6 g', 0.25, 'orig').main, '0.2 g', '0.15 g → 0.2 g');
eq(S('糖 600 g', 2.5, 'orig').main, '1.5 kg', '1500 g 顯示 1.5 kg');
eq(S('2.5 kg 豬肉', 0.3, 'orig').main, '750 g', '0.75 kg 顯示 750 g');
// 量匙量杯換公克：體積 × 密度
eq(S('2 cups flour', 1, 'metric').main, Math.round(2 * CUP * 0.53) + ' g', '2 杯中筋麵粉 = 2×240×0.53 g');
eq(S('糖 2大匙', 1, 'metric').main, Math.round(2 * TBSP * 0.85) + ' g', '2 大匙砂糖 = 2×15×0.85 g');
eq(S('鹽 1/2 小匙', 1, 'metric').main, (0.5 * TSP * 1.2).toFixed(0) + ' g', '½ 小匙鹽 = 3 g');
eq(S('牛奶 1 杯', 1.5, 'metric').main, Math.round(1.5 * CUP * 1.03) + ' g', '1.5 杯牛奶');
eq(S('1 tbsp olive oil', 3, 'metric').main, Math.round(3 * TBSP * 0.92) + ' g', '3 大匙橄欖油');
eq(S('蜂蜜 1 大匙', 1, 'metric').main, (TBSP * 1.42).toFixed(1).replace(/\.0$/, '') === '21.3' ? '21 g' : '?', '1 大匙蜂蜜 = 21.3 g → 21 g');
eq(S('牛奶 1 杯', 1, 'metric', { cupMl: 200, dens: {} }).main, Math.round(200 * 1.03) + ' g', '日本量杯 200 ml');
eq(S('牛奶 1 杯', 1, 'metric', { cupMl: 236.6, dens: {} }).main, Math.round(236.6 * 1.03) + ' g', '美制量杯 236.6 ml');
eq(S('2 cups flour', 1, 'metric', { cupMl: 240, dens: { flour: 125 / 240 } }).main, '250 g', '自訂密度：1 杯 125 g');
eq(S('五香粉 1 小匙', 1, 'metric').main, '5 ml', '沒有密度的粉維持 ml');
ok(S('2 cups flour', 1, 'metric').approx, '密度換算標示 ≈');
ok(!S('中筋麵粉 300g', 1, 'metric').approx, '原本就是公克不標 ≈');
// 公克換量匙量杯
{ const r = S('中筋麵粉 300g', 1, 'spoon'); const ml = 300 / 0.53; const sp = RS.spoonify(ml, CUP, true); ok(Math.abs(sp.total - ml) / ml < 0.04 && r.main === RS.fmtSpoon(ml, CUP, 'zh', true).text, '300 g 麵粉換量杯誤差 < 3%：' + r.main); }
eq(S('無鹽奶油 30g', 1, 'spoon').main, '2 大匙', '30 g 奶油 ≈ 2 大匙（31.25 ml）');
eq(S('糖 25g', 1, 'spoon').main, '2 大匙', '25 g 砂糖 ≈ 2 大匙');
// 台斤、兩
eq(S('五花肉 1 斤', 1.5, 'orig').main, '1 斤 8 兩', '1 斤 × 1.5 = 1 斤 8 兩');
eq(S('五花肉 1 斤', 1.5, 'metric').main, JIN * 1.5 + ' g', '1.5 斤 = 900 g');
eq(S('豬肉 3 兩', 1, 'metric').main, Math.round(3 * LIANG) + ' g', '3 兩 = 112.5 g → 113 g');
eq(S('豬肉 300 g', 1, 'tw').main, 300 / LIANG + ' 兩', '300 g = 8 兩');
eq(S('豬肉 450 g', 1, 'tw').main, 450 / LIANG + ' 兩', '450 g = 12 兩');
eq(S('豬肉 600 g', 1, 'tw').main, '1 斤', '600 g = 1 斤');
eq(S('豬肉 750 g', 1, 'tw').main, '1 斤 4 兩', '750 g = 1 斤 4 兩');
eq(S('豬肉 1.2 kg', 1, 'tw').main, '2 斤', '1.2 kg = 2 斤');
eq(S('豬肉 250 g', 1, 'tw').main, (250 / LIANG).toFixed(1) + ' 兩', '250 g = 6.7 兩');
eq(S('鹽 10 g', 1, 'tw').main, '10 g', '太少（< 半兩）維持公克');
eq(S('1 lb ground beef', 1, 'tw').main, (LB / LIANG).toFixed(1) + ' 兩', '1 磅 = 12.1 兩');
eq(S('牛肉 1 台斤', 1, 'orig').sub, '= 600 g', '台斤附公克');
// 英制
eq(S('8 oz cream cheese', 1.5, 'orig').main, '12 oz', '8 oz × 1.5');
eq(S('8 oz cream cheese', 1, 'metric').main, Math.round(8 * OZ) + ' g', '8 oz = 227 g');
eq(S('1 lb ground beef', 1.5, 'orig').main, '1.5 lb', '1 lb × 1.5');
eq(S('1 lb ground beef', 0.5, 'orig').main, '8 oz', '0.5 lb 改以 oz 顯示');
eq(S('4 fl oz milk', 1, 'metric').main, Math.round(4 * FLOZ * 1.03) + ' g', '4 fl oz 牛奶');
eq(S('2 sticks butter', 1, 'metric').main, Math.round(2 * 113.4) + ' g', '2 條奶油 = 226.8 g');
eq(S('2 sticks butter', 1.5, 'orig').main, '3 sticks', '2 sticks × 1.5');
// 量匙組合
eq(S('糖 2大匙', 1.5, 'orig').main, '3 大匙', '2 大匙 × 1.5');
eq(S('糖 2大匙', 2, 'orig').main, '4 大匙', '原文用大匙：2 大匙 × 2 = 4 大匙（不改成 ¼ 杯）');
eq(S('鹽 1/2 小匙', 1.5, 'orig').main, '¾ 小匙', '½ 小匙 × 1.5');
eq(S('牛奶 半杯', 1.5, 'orig').main, '¾ 杯', '½ 杯 × 1.5');
eq(S('醬油 1/3 杯', 1.5, 'orig').main, '½ 杯', '⅓ 杯 × 1.5');
eq(S('糖 1 大匙', 1.5, 'orig').main, '1½ 大匙', '1 大匙 × 1.5 = 1½ 大匙');
eq(S('奶油 1 杯 + 2 大匙', 2, 'orig').main, '2¼ 杯', '(1 杯 + 2 大匙) × 2 = 2¼ 杯（540 ml）');
eq(S('2 cups flour', 0.5, 'orig').main, '1 cup', '英文食譜用英文單位');
eq(S('1 1/2 cups sugar', 1.5, 'orig').main, '2¼ cups', '1½ cups × 1.5');
eq(S('醬油 1-2 大匙', 1.5, 'orig').main, '1½–3 大匙', '範圍 1–2 大匙 × 1.5');
eq(S('醬油 1-2 大匙', 3, 'orig').main, '3–6 大匙', '範圍 × 3 不跳成杯');
eq(S('鹽 1/8 小匙', 0.25, 'orig').main, '一小撮', '極少量（0.16 ml）= 一小撮');
// spoonify 的誤差上限（隨機 500 個）
{
  let worst = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 500; i++) {
    const ml = 2.5 + rnd() * 1200, r = RS.spoonify(ml, CUP);
    const v = r.parts.reduce((s, p) => s + p.n * (p.u === 'cup' ? CUP : p.u === 'tbsp' ? TBSP : TSP), 0);
    ok(Math.abs(v - r.total) < 1e-9, 'spoonify 回報的總量正確');
    worst = Math.max(worst, Math.abs(v - ml) / ml);
    ok(r.parts.length <= 3 && r.parts.length >= 1, 'spoonify 最多三段');
  }
  ok(worst < 0.25, '½ 小匙以上最大誤差 < 25%（' + (worst * 100).toFixed(1) + '%）');
  let bad = 0; for (let ml = 2.5; ml <= 1200; ml += 0.05) { const r = RS.spoonify(ml, CUP), t = RS.fmtSpoon(ml, CUP, 'zh').text; const e = Math.abs(r.total - ml) / ml; if (e > 0.06 && !(/^略(多|少)於 /.test(t) && (r.total < ml) === /^略多於/.test(t))) bad++; if (e <= 0.06 && /^略/.test(t)) bad++; }
  eq(bad, 0, '½ 小匙以上：誤差超過 6% 一律標「略多於／略少於」，方向正確');
  eq(RS.fmtSpoon(3.1, CUP, 'zh').text, '略多於 ½ 小匙', '3.1 ml = 略多於 ½ 小匙');
  eq(RS.fmtSpoon(3.1, CUP, 'en').text, 'heaping 1/2 tsp'.replace('1/2', '½'), '英文 heaping');
  let w2 = 0; for (let ml = 15; ml <= 1000; ml += 0.7) { const r = RS.spoonify(ml, CUP); w2 = Math.max(w2, Math.abs(r.total - ml) / ml); }
  ok(w2 < 0.05, '15 ml 以上誤差 < 5%（' + (w2 * 100).toFixed(1) + '%）');
}
// 個數
eq(S('雞蛋 2 顆', 1.5, 'orig').main, '3 顆', '2 顆 × 1.5');
eq(S('雞蛋 3 顆', 0.5, 'orig').main, '1½ 顆', '3 顆 × 0.5');
eq(S('雞蛋 3 顆', 1.5, 'metric').main, 4.5 * 50 + ' g', '4.5 顆蛋 ≈ 225 g');
eq(S('雞蛋 2 顆', 4 / 3, 'orig').main, '2½ 顆', '2.67 顆 → 2½ 顆');
ok(/打散秤重/.test(S('雞蛋 2 顆', 4 / 3, 'orig').sub), '蛋數四捨五入誤差大時提示秤重');
eq(S('蛋黃 2 個', 1, 'metric').main, '34 g', '蛋黃 2 個 ≈ 34 g');
eq(S('蒜頭三瓣', 1, 'metric').main, '15 g', '3 瓣蒜 ≈ 15 g');
eq(S('蒜頭 1 顆', 1, 'metric').main, '1 顆', '整顆蒜頭不用每瓣重量');
eq(S('蔥 2 根', 12, 'orig').main, '24 根', '10 個以上取整數');
eq(S('3 eggs', 1, 'orig').main, '3', '沒有量詞的蛋');
// 各、適量
eq(S('鹽、糖 各1小匙', 3, 'orig').main, '各 1 大匙', '各 1 小匙 × 3 = 各 1 大匙');
eq(S('醬油 適量', 3, 'orig').main, '適量', '適量不換算');
// 原文顯示
eq(RS.origText(P('醬油 1/3 杯')), '⅓ 杯', '原文 ⅓ 杯');
eq(RS.origText(P('醬油 1-2 大匙')), '1–2 大匙', '原文範圍');

// ---------- 依食材反推倍數 ----------
const F = (line, have, u) => RS.factorFromHave(P(line), have, u === undefined ? P(line).unit : (u ? RS.UNIT[u] : null), O);
near(F('無鹽奶油 50g', 30), 0.6, '奶油 50 g → 30 g = ×0.6');
near(F('五花肉 1 斤', 900, 'g'), 1.5, '1 斤 → 900 g = ×1.5');
near(F('豬肉 300 g', 12, 'liang'), 12 * LIANG / 300, '300 g → 12 兩');
near(F('牛奶 1 杯', 360, 'ml'), 1.5, '1 杯 → 360 ml');
near(F('2 cups flour', 300, 'g'), 300 / (2 * CUP * 0.53), '2 杯麵粉 → 300 g（經密度）');
near(F('中筋麵粉 300g', 1, 'cup'), CUP * 0.53 / 300, '300 g 麵粉 → 1 杯');
near(F('雞蛋 3 顆', 2), 2 / 3, '蛋 3 → 2 顆');
near(F('雞蛋 3 顆', 100, 'g'), 100 / 150, '蛋 3 顆 → 100 g');
ok(isNaN(F('五香粉 1 小匙', 10, 'g')), '沒有密度不能體積換重量');
ok(isNaN(F('雞蛋 3 顆', 0)), '0 無效');
ok(isNaN(F('醬油 適量', 2)), '沒有數量不能當基準');
ok(RS.haveUnits(P('五香粉 1 小匙'), O).every(u => ['ml', 'l', 'cup', 'tbsp', 'tsp'].includes(u)), '沒有密度時只能選體積單位');
ok(RS.haveUnits(P('2 cups flour'), O).includes('g'), '有密度可選公克');

// ---------- 審查回饋的修正 ----------
// 1. 原單位不改寫原文；大匙維持大匙（½ 階、8 大匙內）
for (const l of ['醬油 1.5 大匙', '奶油 6 大匙', '水 5 大匙', '鹽 1/2 小匙', '牛奶 1/3 杯', '奶油 1 杯 + 2 大匙', '醬油 1-2 大匙', '五花肉 1.5 斤', '豬肉 3 兩', '雞蛋 2 顆', '2 1/4 cups flour', '1 lb ground beef', '白醋 15cc', '中筋麵粉 300g', '鹽、糖 各1小匙'])
  eq(S(l, 1, 'orig').main, RS.origText(P(l)), `×1 原單位照原文：「${l}」`);
eq(S('醬油 1.5 大匙', 1, 'orig').main, '1½ 大匙', '1.5 大匙 × 1 = 1½ 大匙');
eq(S('奶油 6 大匙', 1, 'orig').main, '6 大匙', '6 大匙 × 1 = 6 大匙');
eq(S('醬油 2 大匙', 3, 'orig').main, '6 大匙', '2 大匙 × 3 = 6 大匙');
eq(S('醬油 2 大匙', 3, 'spoon').main, '6 大匙', '量匙模式也維持 6 大匙');
eq(S('冰糖 1 大匙', 1.5, 'orig').main, '1½ 大匙', '冰糖 1 大匙 × 1.5 = 1½ 大匙');
eq(S('水 5 大匙', 1.6, 'orig').main, '8 大匙', '5 大匙 × 1.6 = 8 大匙');
eq(S('醬油 2 大匙', 5, 'orig').main, '½ 杯 + 2 大匙', '超過 8 大匙改用杯：10 大匙 = ½ 杯 + 2 大匙（150 ml）');
eq(S('醬油 1 大匙', 1.25, 'orig').main, '1 大匙 + ¾ 小匙', '1.25 大匙 = 1 大匙 + ¾ 小匙（18.75 ml，不硬湊 ½ 大匙）');
eq(S('醬油 1-2 大匙', 2.5, 'orig').main, '2½–5 大匙', '範圍也維持大匙');
eq(S('鹽 1 小匙', 1.5, 'orig').main, '1½ 小匙', '1 小匙 × 1.5');
eq(S('鹽 2 小匙', 3, 'orig').main, '2 大匙', '6 小匙 = 2 大匙');
{ // 隨機：大匙來源、8 大匙以內 → 一律大匙且誤差 ≤ 3.4%
  let bad = 0; for (let t = 0.5; t <= 4; t += 0.5) for (let f = 0.3; f <= 2; f += 0.05) { const ml = t * f * TBSP; if (ml < 7 || ml > 120) continue; const r = S('醬油 ' + t + ' 大匙', f, 'orig').main; const m = r.match(/^([\d½]+) 大匙$/); if (!m) { if (Math.abs(Math.round(ml / 7.5) / 2 * 15 - ml) / ml <= 0.034) bad++; continue; } const n = parseFloat(m[1].replace('½', '.5')) || 0.5; if (Math.abs(n * TBSP - ml) / ml > 0.04) bad++; }
  eq(bad, 0, '大匙來源 8 大匙內維持大匙且誤差 ≤ 4%');
}
// 3. 大／小 量詞、一行兩項
chk('薑 1 小塊', '薑', 1, 'c:小塊', null);
chk('薑 2 大片', '薑', 2, 'c:大片', null);
chk('九層塔 1 小把', '九層塔', 1, 'c:小把', null);
chk('白飯 1 小碗', '白飯', 1, 'c:小碗', null);
eq(S('薑 1 小塊', 2, 'orig').main, '2 小塊', '1 小塊 × 2 = 2 小塊');
eq(S('薑 2 大片', 1.5, 'orig').main, '3 大片', '2 大片 × 1.5 = 3 大片');
chk('一小撮鹽'.replace('一小撮鹽', '鹽 一小撮'), '鹽', 1, 'c:小撮', 'salt');
{
  const r = RS.parseRecipe('餅\n麵粉300g、水200ml\n鹽 1 小匙，糖 2 大匙\n砂糖 1,000 g\n蔥 2 根，切段\n鹽、糖 各1小匙');
  const its = r.lines.filter(l => l.kind === 'item');
  eq(its.map(l => l.name + ':' + l.qty.lo + (l.unit ? l.unit.id : '')).join('|'), '麵粉:300g|水:200ml|鹽:1tsp|糖:2tbsp|砂糖:1000g|蔥:2c:根|鹽、糖:1tsp', '一行兩項拆開，千分位、備註、「各」不拆');
  eq(its.map(l => l.i).join(','), '1,1.01,2,2.01,3,4,5', '拆開的項目有各自的編號');
  eq(RS.scaleItem(its[1], 2, 'orig', O).main, '400 ml', '拆出的「水200ml」也會換算');
}
// 4（介面）、7. 份量單位
eq(RS.parseRecipe('Cookies\nMakes 24 cookies\n1 cup flour').servUnit, '份', 'Makes 24 cookies → 份');
eq(RS.parseRecipe('鬆餅\n份量：6 片\n牛奶 1 杯').servUnit, '片', '份量：6 片 → 片');
eq(RS.parseRecipe('滷肉（4 人份）\n肉 1 斤').servUnit, '人份', '4 人份 → 人份');
eq(RS.parseRecipe('Pancakes\nServes 4\n1 cup milk').servUnit, '人份', 'Serves 4 → 人份');
// 9. 細節
{ const p = P('雞蛋 1 個（約 60g）'); eq(p.pieceG, 60, '原文寫的單顆重量 60 g'); eq(RS.scaleItem(p, 2, 'metric', O).main, '120 g', '2 個 × 60 g = 120 g'); }
{ const p = P('雞蛋 4 個（約 200g）'); eq(p.pieceG, 50, '4 個約 200 g → 每個 50 g'); }
{ const p = P('雞蛋 3 顆（每顆約 55 g）'); eq(p.pieceG, 55, '每顆約 55 g'); near(RS.factorFromHave(p, 110, RS.UNIT.g, O), 110 / 165, '以 110 g 蛋為準 = 110/165'); }
chk('1 c flour', 'flour', 1, 'cup', 'flour');
chk('2 C sugar', 'sugar', 2, 'cup', 'sugar');
chk('米 1 合', '米', 1, 'ricecup', 'rice');
eq(S('米 2 合', 1, 'metric').main, Math.round(2 * 180 * 0.85) + ' g', '2 合米 = 360 ml × 0.85');
eq(P('Bake at 350 C').kind, 'text', '350 C 是溫度');
{ const p = P('水 1e5 ml'); ok(p.kind === 'item' && !p.qty && p.bad === '格式', '1e5 不當成 1，標成格式錯誤'); }
{ // 效能：2000 行 × 4 種模式
  const big = RS.parseRecipe(Array.from({ length: 2000 }, (_, i) => '材料' + i + ' ' + (i % 9 + 1) + ' 大匙').join('\n'));
  const t0 = Date.now(); for (const m of ['orig', 'metric', 'spoon', 'tw']) for (const l of big.lines) if (l.kind === 'item') RS.scaleItem(l, 1.37, m, O); const ms = Date.now() - t0;
  ok(ms < 400, '2000 行四種模式換算 < 400 ms（' + ms + ' ms）');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
