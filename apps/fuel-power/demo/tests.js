// 油錢與電費計算 (fuel-power) 核心邏輯測試：從 ../index.html 的 CORE 區塊取出純函式。
// 用法：node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const FP = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return FP;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const R = FP.DEFAULT_RATES;
const S = 1, W = 0; // 夏月 / 非夏月

// --- 費率表本身 ---
ok(R.tiers.length === 6 && R.tiers[5].upTo === null, '六段費率，最後一段無上限');
ok(R.tiers.slice(0, 5).every((t, i, a) => i === 0 || t.upTo > a[i - 1].upTo), '門檻遞增');
ok(R.tiers.every(t => t.summer >= t.winter), '夏月單價都不低於非夏月');
ok(R.tiers.every((t, i, a) => i === 0 || (t.summer > a[i - 1].summer && t.winter > a[i - 1].winter)), '越高級距單價越高');
ok(R.tiers[0].summer === R.tiers[0].winter, '120 度以下夏月與非夏月同價');

// --- 夏月判定 / 計費期間 ---
ok(FP.periodInfo(7).fs === 1 && FP.periodInfo(7).days === 62, '7–8 月全為夏月（62 天）');
ok(FP.periodInfo(8).fs === 1 && FP.periodInfo(8).days === 61, '8–9 月全為夏月（61 天）');
ok(FP.periodInfo(1).fs === 0 && FP.periodInfo(1).days === 59, '1–2 月全為非夏月（59 天）');
ok(FP.periodInfo(11).fs === 0 && FP.periodInfo(11).days === 61, '11–12 月非夏月');
ok(FP.periodInfo(12).fs === 0 && FP.periodInfo(12).days === 62, '12–1 月跨年：31 + 31 天，非夏月');
{ const p = FP.periodInfo(5); ok(p.days === 61 && p.summerDays === 30 && near(p.fs, 30 / 61), '5–6 月跨季：夏月 30／61 天'); }
{ const p = FP.periodInfo(9); ok(p.days === 61 && p.summerDays === 30 && near(p.fs, 30 / 61), '9–10 月跨季：夏月 30／61 天'); }
ok(FP.periodInfo(6).fs === 1, '6–7 月全為夏月');
ok(FP.periodInfo(10).fs === 0, '10–11 月全為非夏月');

// --- 分段計算：邊界 ---
const bill = (kwh, fs, r) => FP.billBreakdown(kwh, r || R, fs, 2);
ok(bill(0, S).total === 0 && bill(0, S).rounded === 0 && bill(0, S).avg === 0, '0 度 = 0 元');
ok(bill(-50, W).total === 0, '負數度數視為 0');
ok(bill('abc', W).total === 0, '非數字視為 0');
ok(near(bill(1, W).total, 1.68), '1 度非夏月 = 1.68');
ok(near(bill(240, W).total, 240 * 1.68) && bill(240, W).rounded === 403, '240 度（第一段上限）非夏月 = 403.2 → 403');
ok(near(bill(241, W).total, 240 * 1.68 + 2.16), '241 度：第 241 度用第二段非夏月 2.16');
ok(near(bill(241, S).total, 240 * 1.68 + 2.45), '241 度：第 241 度用第二段夏月 2.45');
ok(near(bill(660, S).total, 240 * 1.68 + 420 * 2.45), '660 度夏月 = 403.2 + 1029');
ok(near(bill(661, S).total, 240 * 1.68 + 420 * 2.45 + 3.70), '661 度夏月：第 661 度 3.70');
ok(near(bill(1000, W).total, 240 * 1.68 + 420 * 2.16 + 340 * 3.03), '1000 度非夏月三段');
ok(near(bill(1400, S).total, 240 * 1.68 + 420 * 2.45 + 340 * 3.70 + 400 * 5.04), '1400 度夏月四段');
ok(near(bill(2000, S).total, 240 * 1.68 + 420 * 2.45 + 340 * 3.70 + 400 * 5.04 + 600 * 6.24), '2000 度夏月五段（第五段上限）');
ok(near(bill(2001, S).total, bill(2000, S).total + 8.46), '2001 度夏月：第 2001 度 8.46');
ok(near(bill(2001, W).total, bill(2000, W).total + 6.63), '2001 度非夏月：第 2001 度 6.63');
ok(near(bill(5000, W).total, bill(2000, W).total + 3000 * 6.63), '5000 度非夏月：最後一段無上限');
{
  const b = bill(760, S);
  ok(b.rows.length === 6 && b.rows.map(r => r.kwh).join() === '240,420,100,0,0,0', '760 度分段度數 240/420/100/0/0/0');
  ok(b.rows[0].from === 0 && b.rows[0].to === 240 && b.rows[1].from === 240 && b.rows[1].to === 660 && b.rows[5].to === null, '級距區間為每月 × 2');
  ok(b.rounded === 1802 && near(b.total, 1802.2), '760 度夏月 = 1802.2 → 1802');
  ok(near(b.avg, 1802.2 / 760), '平均每度');
  ok(near(b.rows.reduce((s, r) => s + r.cost, 0), b.total), '各段金額加總 = 合計');
}
ok(bill(760, W).total < bill(760, S).total, '同度數夏月比非夏月貴');
ok(bill(240, W).total === bill(240, S).total, '240 度以內夏月非夏月同價');
ok(Math.round(bill(1234.5, W).total) === bill(1234.5, W).rounded, 'rounded 為四捨五入整數');
// 單調性
{ let last = -1, mono = true; for (let k = 0; k <= 3000; k += 7) { const t = bill(k, S).total; if (t < last) mono = false; last = t; } ok(mono, '金額隨度數單調遞增'); }

// --- 跨季 ---
{
  const fs = FP.periodInfo(5).fs, b = bill(500, fs);
  const exp = 240 * 1.68 + 260 * (2.45 * fs + 2.16 * (1 - fs));
  ok(near(b.total, exp), '5–6 月 500 度：第二段單價按天數比例混合');
  ok(near(b.total, bill(500, S).total * fs + bill(500, W).total * (1 - fs)), '跨季金額 = 夏月帳 × 比例 + 非夏月帳 × 比例');
  ok(b.total > bill(500, W).total && b.total < bill(500, S).total, '跨季金額介於兩季之間');
  ok(near(b.rows[1].rate, 2.45 * fs + 2.16 * (1 - fs)), 'row.rate 為混合單價');
}
ok(near(FP.tierRate({ summer: 4, winter: 2 }, 0.25), 2.5), 'tierRate 線性混合');
ok(near(bill(100, 2).total, 168) && near(bill(100, -1).total, 168), 'fs 超出 0–1 會被夾住');

// --- 邊際成本（電器） ---
ok(near(FP.marginalCost(0, 100, R, W), 168), '從 0 多用 100 度 = 第一段');
ok(near(FP.marginalCost(620, 100, R, S), 40 * 2.45 + 60 * 3.70), '620 → 720 度夏月：跨第二、三段');
ok(near(FP.marginalCost(620, 100, R, W), 40 * 2.16 + 60 * 3.03), '620 → 720 度非夏月');
ok(near(FP.marginalCost(1990, 20, R, S), 10 * 6.24 + 10 * 8.46), '1990 → 2010 度跨最高段');
ok(FP.marginalCost(500, 0, R, S) === 0, '多用 0 度 = 0 元');
ok(near(FP.marginalCost(300, 100, R, S) + bill(300, S).total, bill(400, S).total), '邊際 + 基準 = 總額');
ok(near(FP.applianceKwh(900, 8, 60), 432), '冷氣 900W × 8 時 × 60 天 = 432 度');
ok(near(FP.applianceKwh(80, 24, 60), 115.2), '冰箱 80W × 24 時 × 60 天 = 115.2 度');
ok(FP.applianceKwh(-5, 8, 60) === 0 && FP.applianceKwh('x', 8, 60) === 0, '負數或非數字瓦數 = 0');

// --- 自訂費率檢查 ---
ok(FP.sanitizeRates(null) === null && FP.sanitizeRates({}) === null && FP.sanitizeRates({ tiers: [] }) === null, '空值或段數不對 → null');
{
  const r = FP.sanitizeRates(JSON.parse(JSON.stringify(R)));
  ok(r && r.tiers.length === 6 && r.tiers[5].upTo === null && r.effective === R.effective, '預設表可通過檢查');
  ok(near(bill(760, S, r).total, 1802.2), '通過檢查的表算出相同結果');
}
{
  const bad = JSON.parse(JSON.stringify(R)); bad.tiers[2].summer = 'abc';
  ok(FP.sanitizeRates(bad) === null, '非數字單價 → null');
  const neg = JSON.parse(JSON.stringify(R)); neg.tiers[1].winter = -1;
  ok(FP.sanitizeRates(neg) === null, '負單價 → null');
  const order = JSON.parse(JSON.stringify(R)); order.tiers[1].upTo = 100;
  ok(FP.sanitizeRates(order) === null, '門檻未遞增 → null');
  const str = JSON.parse(JSON.stringify(R)); str.tiers.forEach(t => { t.summer = String(t.summer); t.winter = String(t.winter); });
  const r2 = FP.sanitizeRates(str); ok(r2 && r2.tiers[1].summer === 2.45, '字串單價轉成數字');
  const custom = JSON.parse(JSON.stringify(R)); custom.tiers[0].summer = 2; custom.tiers[0].winter = 2;
  ok(near(bill(100, S, FP.sanitizeRates(custom)).total, 200), '自訂單價生效');
}

// --- 油錢 ---
const trip = o => FP.tripCost(Object.assign({ km: 100, roundTrip: false, kmPerL: 10, price: 30, people: 1, tolls: 0, parking: 0 }, o));
{ const t = trip({}); ok(t.km === 100 && near(t.litres, 10) && near(t.fuel, 300) && near(t.total, 300) && near(t.perKm, 3) && t.valid, '100 km 單程 10 km/L 30 元 = 10 L、300 元、3 元/km'); }
{ const t = trip({ roundTrip: true }); ok(t.km === 200 && near(t.litres, 20) && near(t.fuel, 600), '來回距離加倍'); }
{ const t = trip({ tolls: 80, parking: 50 }); ok(near(t.total, 430) && near(t.fuel, 300) && near(t.perKm, 4.3), '過路費與停車費加進總額與每公里'); }
{ const t = trip({ tolls: 80, parking: 50, people: 4 }); ok(near(t.perPerson, 107.5) && t.people === 4, '4 人分攤 430 元 = 107.5'); }
{ const t = trip({ people: 0 }); ok(t.people === 1 && near(t.perPerson, 300), '0 人視為 1 人'); }
{ const t = trip({ people: 2.7 }); ok(t.people === 2 && near(t.perPerson, 150), '小數人數無條件捨去'); }
{ const t = trip({ people: -3 }); ok(t.people === 1, '負人數視為 1'); }
{ const t = trip({ km: 112, roundTrip: true, kmPerL: 14.5, price: 31, people: 4, tolls: 120, parking: 100 }); ok(near(t.litres, 224 / 14.5) && near(t.total, 224 / 14.5 * 31 + 220) && near(t.perPerson, t.total / 4), '範例行程：224 km、15.45 L'); }
{ const t = trip({ kmPerL: 0 }); ok(!t.valid && t.litres === 0 && t.fuel === 0, '油耗 0 不除以零'); }
{ const t = trip({ km: 0 }); ok(!t.valid && t.perKm === 0 && t.total === 0, '距離 0 不除以零'); }
{ const t = trip({ km: '50', kmPerL: '12.5', price: '30.0', people: '3', tolls: '', parking: '' }); ok(t.km === 50 && near(t.litres, 4) && near(t.total, 120) && near(t.perPerson, 40), '字串輸入與空白欄位'); }
{ const t = trip({ km: -10, tolls: -5 }); ok(t.km === 0 && t.tolls === 0, '負數距離與費用視為 0'); }
{ const t = trip({ km: 100, roundTrip: true, kmPerL: 40, price: 29.5, tolls: 0, parking: 0 }); ok(near(t.litres, 5) && near(t.fuel, 147.5), '機車 40 km/L 來回 200 km = 5 L'); }

// --- 電動車比較 ---
{ const e = FP.evCost({ km: 200, kwhPer100: 16, pricePerKwh: 5 }); ok(near(e.kwh, 32) && near(e.cost, 160) && near(e.perKm, 0.8), '200 km × 16 kWh/100km × 5 元 = 32 kWh、160 元'); }
{ const e = FP.evCost({ km: 0, kwhPer100: 16, pricePerKwh: 5 }); ok(e.kwh === 0 && e.perKm === 0, '0 km 不除以零'); }
{ const e = FP.evCost({ km: 100, kwhPer100: '', pricePerKwh: 5 }); ok(e.cost === 0, '空電耗 = 0'); }
{ const g = trip({ km: 200, kmPerL: 14.5, price: 31 }), e = FP.evCost({ km: 200, kwhPer100: 16, pricePerKwh: 5 }); ok(g.fuel > e.cost, '範例情境電動車較省'); }

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
