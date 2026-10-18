// 發票對獎 (invoice-lottery) logic tests: prize tiers, boundary cases, draw/claim date math, text import/export.
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const IL = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return IL;')();
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg + ' — got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b));
const P = IL.normPeriod({ year: 2026, m: 7, special: '12345678', grand: '87654321', first: ['11111111', '22222222', '00000123'], extra: ['000', '999'] });
const prize = n => { const t = IL.checkFull(P, n); return t ? t.key + ':' + t.amt : null; };

// --- every tier ---
eq(prize('12345678'), 'special:10000000', '特別獎 8 碼全中');
eq(prize('87654321'), 'grand:2000000', '特獎 8 碼全中');
eq(prize('11111111'), 'first:200000', '頭獎 8 碼全中');
eq(prize('91111111'), 'second:40000', '二獎 末 7 碼');
eq(prize('99111111'), 'third:10000', '三獎 末 6 碼');
eq(prize('99911111'), 'fourth:4000', '四獎 末 5 碼');
eq(prize('99991111'), 'fifth:1000', '五獎 末 4 碼');
eq(prize('99999111'), 'sixth:200', '六獎 末 3 碼');
eq(prize('55555000'), 'extra:200', '增開六獎 末 3 碼');
eq(prize('99999911'), null, '只剩末 2 碼相同不算');
eq(prize('12345670'), null, '特別獎差一碼不算（特別獎無尾數獎）');
eq(prize('87654329'), null, '特獎差一碼不算');
eq(prize('47654321'), null, '特獎末 7 碼相同也不算');
eq(prize('00000000'), 'extra:200', '00000000 → 增開六獎 000（全零也要算）');

// --- boundary: leading zeros ---
eq(prize('00000123'), 'first:200000', '頭獎含前導零 8 碼全中');
eq(prize('10000123'), 'second:40000', '前導零號碼的二獎');
eq(prize('00000120'), null, '前導零號碼末 3 碼 120 不符');
eq(prize(123), null, '數字型 123 不足 8 碼 → null');
eq(prize('0000012'), null, '7 碼字串不算');
eq(prize('000001234'), null, '9 碼不算');
eq(prize('1234-5678'), 'special:10000000', '非數字字元會被去掉');

// --- highest tier wins when several match ---
{
  const Q = IL.normPeriod({ year: 2026, m: 7, special: '55555123', grand: '44444123', first: ['33333123', '22222222', '99999999'], extra: ['123'] });
  const pr = n => { const t = IL.checkFull(Q, n); return t ? t.key : null; };
  eq(pr('55555123'), 'special', '同時符合特別獎與頭獎尾 3 碼與增開六獎 → 特別獎');
  eq(pr('44444123'), 'grand', '同時符合特獎與增開六獎 → 特獎');
  eq(pr('33333123'), 'first', '頭獎全中且增開六獎也符合 → 頭獎');
  eq(pr('03333123'), 'second', '二獎優先於增開六獎');
  eq(pr('77777123'), 'sixth', '六獎與增開六獎同為 200，回報六獎');
  const Q2 = IL.normPeriod({ year: 2026, m: 7, first: ['11111111', '21111111', '33333333'] });
  eq(IL.checkFull(Q2, '21111111').key, 'first', '兩組頭獎同時符合：取最高（頭獎而非二獎）');
  eq(IL.checkFull(Q2, '01111111').key, 'second', '兩組頭獎尾 7 碼都符合 → 二獎');
}

// --- empty / partial periods ---
{
  const E = IL.normPeriod({ year: 2026, m: 1 });
  eq(IL.checkFull(E, '12345678'), null, '空期別一律沒中');
  eq(IL.checkTail(E, '123').possible, false, '空期別尾 3 碼不可能中');
  const E2 = IL.normPeriod({ year: 2026, m: 1, special: '1234567', first: ['abc', '12', null], extra: ['12', '1234', 'x'] });
  eq([E2.special, E2.first, E2.extra], ['', ['', '', ''], []], '不合法號碼正規化為空');
  const E3 = IL.normPeriod({ year: 2026, m: 1, extra: ['000', '000', '001'] });
  eq(E3.extra, ['000', '001'], '增開六獎去重');
  eq(IL.normPeriod({ year: 'x', m: 4 }).m, 1, '月份不合法 → 1');
  eq(IL.normPeriod({ year: 2026, m: 7, extra: [] }).extra, [], '增開六獎可為空');
}

// --- tail check ---
{
  const t = IL.checkTail(P, '111');
  ok(t.possible && t.hits.length === 1 && t.hits[0].kind === 'first' && t.floor.key === 'sixth', '末 3 碼 111 → 可能中獎，至少六獎');
  const t2 = IL.checkTail(P, '678');
  ok(t2.possible && t2.hits[0].kind === 'special' && t2.floor === null, '末 3 碼符合特別獎 → 可能但無保底');
  const t3 = IL.checkTail(P, '000');
  ok(t3.possible && t3.hits[0].kind === 'extra' && t3.floor.key === 'extra', '增開六獎 000 → 保底 200');
  const t4 = IL.checkTail(P, '123');
  ok(t4.possible && t4.hits[0].num === '00000123' && t4.floor.key === 'sixth', '前導零頭獎尾 123');
  eq(IL.checkTail(P, '555').possible, false, '555 沒中');
  eq(IL.checkTail(P, '12').possible, false, '2 碼不判斷');
  const M = IL.normPeriod({ year: 2026, m: 7, special: '10000999', first: ['20000999'], extra: ['999'] });
  const t5 = IL.checkTail(M, '999');
  eq(t5.hits.map(h => h.kind), ['special', 'first', 'extra'], '多組同尾全部列出');
  eq(t5.floor.key, 'sixth', '保底取六獎（高於增開）');
  // tail-possible but full miss: special tail only
  eq(IL.checkFull(P, '00000678'), null, '尾 3 碼符合特別獎但全碼不符 → 沒中');
}

// --- money ---
eq(IL.fmtMoney(10000000), 'NT$10,000,000', '金額格式');
eq(IL.fmtMoney(200), 'NT$200', '金額格式小額');
eq(IL.fmtMoney(0), 'NT$0', '金額 0');

// --- dates ---
eq(IL.drawDate(2026, 1), { y: 2026, mo: 3, d: 25 }, '1–2月 於 3/25 開獎');
eq(IL.drawDate(2026, 7), { y: 2026, mo: 9, d: 25 }, '7–8月 於 9/25 開獎');
eq(IL.drawDate(2026, 11), { y: 2027, mo: 1, d: 25 }, '11–12月 於次年 1/25 開獎');
eq(IL.claimWindow(2026, 1), { from: { y: 2026, mo: 4, d: 6 }, to: { y: 2026, mo: 7, d: 5 } }, '1–2月 領獎 4/6–7/5');
eq(IL.claimWindow(2026, 9), { from: { y: 2026, mo: 12, d: 6 }, to: { y: 2027, mo: 3, d: 5 } }, '9–10月 領獎 12/6–次年 3/5');
eq(IL.claimWindow(2026, 11), { from: { y: 2027, mo: 2, d: 6 }, to: { y: 2027, mo: 5, d: 5 } }, '11–12月 領獎次年 2/6–5/5');
eq(IL.periodOf(new Date(2026, 9, 17)), { year: 2026, m: 9 }, '10/17 屬 9–10月');
eq(IL.periodOf(new Date(2026, 0, 1)), { year: 2026, m: 1 }, '1/1 屬 1–2月');
eq(IL.periodOf(new Date(2026, 11, 31)), { year: 2026, m: 11 }, '12/31 屬 11–12月');
const nd = (y, mo, d) => { const n = IL.nextDraw(new Date(y, mo - 1, d)); return [n.year, n.m, n.date.y, n.date.mo, n.date.d]; };
eq(nd(2026, 10, 17), [2026, 9, 2026, 11, 25], '10/17 下次開獎 11/25（9–10月）');
eq(nd(2026, 9, 25), [2026, 7, 2026, 9, 25], '開獎當天仍算當天開獎');
eq(nd(2026, 9, 26), [2026, 9, 2026, 11, 25], '開獎隔天 → 下一期');
eq(nd(2026, 12, 30), [2026, 11, 2027, 1, 25], '12/30 → 次年 1/25');
eq(nd(2027, 1, 25), [2026, 11, 2027, 1, 25], '1/25 當天');
eq(nd(2027, 1, 26), [2027, 1, 2027, 3, 25], '1/26 → 3/25');
eq(IL.latestDrawn(new Date(2026, 9, 17)), { year: 2026, m: 7 }, '10/17 最近已開獎 7–8月');
eq(IL.latestDrawn(new Date(2026, 8, 25)), { year: 2026, m: 7 }, '9/25 當天 7–8月 已開獎');
eq(IL.latestDrawn(new Date(2026, 8, 24)), { year: 2026, m: 5 }, '9/24 最近已開獎 5–6月');
eq(IL.latestDrawn(new Date(2027, 0, 10)), { year: 2026, m: 9 }, '1/10 最近已開獎 前一年 9–10月');
const cs = (y, m, Y, M, D) => IL.claimStatus(y, m, new Date(Y, M - 1, D));
eq(cs(2026, 7, 2026, 9, 24), 'pending', '開獎前 pending');
eq(cs(2026, 7, 2026, 9, 25), 'wait', '開獎當天 wait');
eq(cs(2026, 7, 2026, 10, 5), 'wait', '10/5 尚未開放領獎');
eq(cs(2026, 7, 2026, 10, 6), 'open', '10/6 開放領獎');
eq(cs(2026, 7, 2027, 1, 5), 'open', '次年 1/5 最後一天');
eq(cs(2026, 7, 2027, 1, 6), 'closed', '1/6 截止');
eq(cs(2026, 11, 2027, 5, 5), 'open', '11–12月 5/5 仍可領');
eq(cs(2026, 11, 2027, 5, 6), 'closed', '11–12月 5/6 截止');
eq(IL.periodLabel(2026, 7), '115年7–8月', '民國期別標籤');
eq(IL.periodLabel(2026, 11), '115年11–12月', '11–12月 標籤');
eq(IL.fmtD({ y: 2027, mo: 1, d: 25 }), '116/1/25', '民國日期');
eq(IL.nextPeriod(2026, 11), { year: 2027, m: 1 }, '11–12月 的下一期');
eq(IL.prevPeriod(2026, 1), { year: 2025, m: 11 }, '1–2月 的上一期');

// --- export / import ---
{
  const txt = IL.exportText(P);
  ok(txt.includes('115年7–8月') && txt.includes('特別獎 12345678') && txt.includes('頭獎 11111111 22222222 00000123') && txt.includes('增開六獎 000 999'), '匯出文字內容');
  const r = IL.importText(txt);
  ok(!r.error, '匯出再匯入無錯');
  eq([r.period.year, r.period.m, r.period.special, r.period.grand, r.period.first, r.period.extra], [2026, 7, '12345678', '87654321', ['11111111', '22222222', '00000123'], ['000', '999']], '往返一致');
  const r2 = IL.importText('民國114年 11-12月\n特獎：55555555\n頭獎 1\n增開六獎：無');
  ok(!r2.error, '鬆散格式可讀');
  eq([r2.period.year, r2.period.m, r2.period.special, r2.period.grand, r2.period.first, r2.period.extra], [2025, 11, '', '55555555', ['', '', ''], []], '鬆散格式欄位');
  const r3 = IL.importText('2026年3–4月\n特別獎 11112222、特獎 33334444\n頭獎 55556666，77778888，99990000\n增開六獎 123, 456');
  eq([r3.period.year, r3.period.m, r3.period.special, r3.period.grand, r3.period.first, r3.period.extra], [2026, 3, '11112222', '33334444', ['55556666', '77778888', '99990000'], ['123', '456']], '西元年與同列多號');
  ok(IL.importText('hello').error, '無期別 → 錯誤');
  ok(IL.importText('115年2–3月 特別獎 12345678').error, '非法起始月 → 錯誤');
  ok(IL.importText('115年7–8月').error, '沒有號碼 → 錯誤');
  const r4 = IL.importText(IL.exportText(IL.normPeriod({ year: 2026, m: 1 })));
  ok(r4.error, '全空期別匯出後匯入 → 沒有號碼錯誤');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
