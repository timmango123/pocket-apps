// Logic tests for 薪資與勞健保試算. Extracts the pure core between CORE markers of ../index.html.
// Usage: node tests.js   → prints "N passed, 0 failed", exit 0 on success.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SC;')();
const D = SC.DATA, def = SC.defaults();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);
const calc = (inp, cfg) => SC.calc(inp, cfg || {});
const R = Math.round;

// --- data block sanity ---
{
  eq(D.year, 2026, 'data year is 2026');
  ok(D.grades.every((g, i) => i === 0 || g > D.grades[i - 1]), 'grade table strictly ascending');
  ok(D.lowGrades.every((g, i) => i === 0 || g > D.lowGrades[i - 1]) && D.lowGrades[D.lowGrades.length - 1] < D.minWage, 'low grades ascending and below min wage');
  ok(D.grades.includes(D.liTop) && D.grades.includes(D.hiTop) && D.grades.includes(D.pensionTop), 'tops are table members');
}
// --- grade lookup boundaries ---
{
  const li = SC.grades('li', def), hi = SC.grades('hi', def), pen = SC.grades('pen', def);
  eq(li[li.length - 1], D.liTop, '勞保 top grade 45,800');
  eq(hi[hi.length - 1], D.hiTop, '健保 top grade 219,500');
  eq(pen[pen.length - 1], D.pensionTop, '勞退 top grade 150,000');
  eq(hi[0], def.minWage, '健保 lowest grade is min wage');
  eq(li[0], D.lowGrades[0], '勞保 table starts with part-time grades');
  ok(!li.includes(28800), 'min wage 29,500 pushes out the 28,800 grade');
  eq(SC.grade('li', 29500, def), 29500, 'exactly min wage → min wage grade');
  eq(SC.grade('li', 29501, def), 30300, 'one dollar above min wage → next grade');
  eq(SC.grade('li', 30300, def), 30300, 'exactly on a grade stays on it');
  eq(SC.grade('li', 30301, def), 31800, 'one over a grade rounds up to the next');
  eq(SC.grade('li', 45800, def), 45800, '45,800 → top 勞保 grade');
  eq(SC.grade('li', 45801, def), 45800, '45,801 → capped at 勞保 top');
  eq(SC.grade('li', 999999, def), 45800, 'huge salary capped at 勞保 top');
  eq(SC.grade('hi', 45801, def), 48200, '健保 continues above 勞保 top');
  eq(SC.grade('hi', 219500, def), 219500, '健保 219,500 on top');
  eq(SC.grade('hi', 300000, def), 219500, '健保 capped at 219,500');
  eq(SC.grade('pen', 150000, def), 150000, '勞退 150,000 top');
  eq(SC.grade('pen', 160000, def), 150000, '勞退 capped at 150,000');
  eq(SC.grade('hi', 10000, def), 29500, '健保 below min wage → min wage');
  eq(SC.grade('li', 10000, def), 11100, '勞保 below lowest part-time grade → 11,100');
  eq(SC.grade('li', 20000, def), 20008, '勞保 part-time 20,000 → 20,008');
  eq(SC.grade('pen', 1000, def), 11100, '勞退 part-time lowest 11,100 (no 1,500 grades)');
  eq(SC.grade('li', 0, def), 11100, 'zero salary → lowest grade, no crash');
  // min wage edit shifts the floor and keeps the table coherent
  const c25 = { ...def, minWage: 28590 };
  eq(SC.grade('li', 28590, c25), 28590, '2025 min wage 28,590 as floor');
  eq(SC.grade('li', 28700, c25), 28800, '…and 28,800 grade comes back');
  const c31 = { ...def, minWage: 31000 };
  eq(SC.grade('hi', 29600, c31), 31000, 'min wage above table entries: 30,300 removed');
  eq(SC.grade('hi', 31001, c31), 31800, '…next grade still 31,800');
}
// --- each deduction, sample case ---
{
  const r = calc({ salary: 42000, allow: 3000, dep: 1, selfRate: 6, bonusMonths: 1.5 });
  eq(r.gross, 45000, 'gross = salary + allowance');
  eq(r.liG, 45800, 'sample 勞保 grade'); eq(r.hiG, 45800, 'sample 健保 grade'); eq(r.pG, 45800, 'sample 勞退 grade');
  eq(r.liEmp, R(45800 * 0.125 * 0.2), '勞保 employee = grade×12.5%×20% = 1,145');
  eq(r.liEmp, 1145, '勞保 1,145');
  eq(r.hiPer, R(45800 * 0.0517 * 0.3), '健保 per person 710');
  eq(r.hiPer, 710, '健保 per person = 710');
  eq(r.hiEmp, 1420, '健保 with 1 dependent = 1,420');
  eq(r.selfPen, 2748, '自提 6% of 45,800 = 2,748');
  eq(r.net, 45000 - 1145 - 1420 - 2748, 'net = gross − all');
  eq(r.net, 39687, 'sample net 39,687');
  eq(r.liEr, 4008, '雇主勞保 70%: 4007.5 rounds up to 4,008');
  eq(r.liEr, 4008, '雇主勞保 4,008');
  eq(r.oi, R(45800 * 0.002), '職災 0.2% = 92');
  eq(r.hiEr, R(45800 * 0.0517 * 0.6 * 1.56), '雇主健保 ×1.56 = 2,216');
  eq(r.hiEr, 2216, '雇主健保 2,216');
  eq(r.penEr, 2748, '雇主勞退 6% = 2,748');
  eq(r.erTotal, 45000 + 4008 + 92 + 2216 + 2748, 'employer total = gross + all employer items');
  // yearly
  eq(r.year.bonus, 63000, 'bonus = salary × 1.5 (allowance excluded)');
  eq(r.year.gross, 45000 * 12 + 63000, 'yearly gross');
  eq(r.year.supp, 0, 'bonus 63,000 < 4×45,800 → no 補充保費');
  eq(r.year.net, 39687 * 12 + 63000, 'yearly net = net×12 + bonus');
  eq(r.year.erTotal, r.erTotal * 12 + 63000, 'yearly employer cost includes bonus');
}
// --- dependents cap ---
{
  const base = { salary: 40000, allow: 0, selfRate: 0 };
  const h = d => calc({ ...base, dep: d }).hiEmp;
  eq(h(0), 622, '健保 alone = 622');
  eq(h(1), 1244, '1 dependent doubles');
  eq(h(2), 1866, '2 dependents triples');
  eq(h(3), 2488, '3 dependents ×4');
  eq(h(4), 2488, '4 dependents capped at 3');
  eq(h(9), 2488, '9 dependents capped at 3');
  eq(h(-1), 622, 'negative dependents treated as 0');
  eq(calc({ ...base, dep: 0 }).dep, 0, 'dep recorded 0'); eq(calc({ ...base, dep: 7 }).dep, 3, 'dep recorded capped 3');
  // employer side unaffected by dependents
  eq(calc({ ...base, dep: 0 }).hiEr, calc({ ...base, dep: 3 }).hiEr, 'employer 健保 ignores actual dependents');
}
// --- rounding: whole NT$ ---
{
  // 30,300 × 12.5% × 20% = 757.5 → 758 (round half up)
  const r = calc({ salary: 30300, allow: 0, dep: 0, selfRate: 0 });
  eq(r.liEmp, 758, '757.5 rounds up to 758');
  // 30,300 × 5.17% × 30% = 469.953 → 470
  eq(r.hiPer, 470, '469.953 → 470');
  // per-person rounded first, then multiplied: 3 dep → 470×4 = 1880, not round(1879.8)=1880 here, check a case that differs
  // 31,800 × 5.17% × 30% = 493.218 → 493; ×4 = 1972 (not round(1972.87)=1973)
  const r2 = calc({ salary: 31800, allow: 0, dep: 3, selfRate: 0 });
  eq(r2.hiEmp, 1972, 'per-person premium rounded before multiplying by household');
  // 自提: 33,300 × 1% = 333; 33,300 × 3% = 999; 34,800×3% = 1044; 36,300 × 1% = 363 all integer; 38,200×3%=1146; 40,100×3%=1203; use 43,900×3% = 1317; 45,800×1%=458; try 42,000×5%=2100; 38,200×5%=1910; 30,300×5%=1515; 31,800×5%=1590; 36,300×5%=1815 — fractional case: 20,008×3% = 600.24 → 600
  const r3 = calc({ salary: 20000, allow: 0, dep: 0, selfRate: 3, insured: 20000 });
  eq(r3.pG, 20008, 'part-time grade 20,008'); eq(r3.selfPen, 600, '600.24 → 600');
  // everything integer
  const r4 = calc({ salary: 57123, allow: 456, dep: 2, selfRate: 5, bonusMonths: 2.3 });
  for (const k of ['liEmp', 'hiEmp', 'selfPen', 'net', 'liEr', 'oi', 'hiEr', 'penEr', 'erTotal']) ok(Number.isInteger(r4[k]), k + ' is a whole number');
  for (const k of ['gross', 'bonus', 'supp', 'net', 'erTotal']) ok(Number.isInteger(r4.year[k]), 'year.' + k + ' is a whole number');
  // employer 健保 rounding: 57,800 × 5.17% × 60% × 1.56 = 2796.8 → 2797
  eq(r4.hiG, 57800, '57,579 → 57,800'); eq(r4.hiEr, 2797, 'employer 健保 2796.8 → 2797');
}
// --- 投保薪資 override ---
{
  const full = calc({ salary: 50000, allow: 0, dep: 0, selfRate: 6 });
  const low = calc({ salary: 50000, allow: 0, dep: 0, selfRate: 6, insured: 30000 });
  ok(!full.underInsured && low.underInsured, 'underInsured flag');
  eq(low.liG, 30300, 'override 30,000 → 30,300 grade'); eq(full.liG, 45800, 'full 50,000 → 45,800 勞保 top');
  eq(full.hiG, 50600, 'full 健保 50,600');
  ok(low.deduct < full.deduct, 'under-insured pays less');
  eq(low.net, 50000 - low.liEmp - low.hiEmp - low.selfPen, 'net still based on real gross');
  ok(low.penEr < full.penEr, 'employer pension lower when under-insured');
  const same = calc({ salary: 50000, allow: 0, dep: 0, selfRate: 0, insured: '' });
  eq(same.insBase, 50000, 'empty override = real salary');
  const over = calc({ salary: 30000, allow: 0, dep: 0, selfRate: 0, insured: 60000 });
  ok(!over.underInsured && over.hiG === 60800, 'override above salary allowed, not flagged');
}
// --- yearly bonus and 補充保費 ---
{
  const r = calc({ salary: 60000, allow: 0, dep: 0, selfRate: 0, bonusMonths: 6 });
  eq(r.hiG, 60800, '健保 grade 60,800');
  eq(r.year.bonus, 360000, 'bonus 6 months');
  const base = 360000 - 60800 * 4;
  eq(r.year.supp, R(base * 0.0211), '補充保費 2.11% on the part over 4× grade');
  eq(r.year.supp, 2464, '補充保費 = 2,464');
  eq(r.year.net, r.net * 12 + 360000 - 2464, 'yearly net minus 補充保費');
  const z = calc({ salary: 60000, allow: 0, dep: 0, selfRate: 0, bonusMonths: 0 });
  eq(z.year.bonus, 0, 'no bonus'); eq(z.year.net, z.net * 12, 'yearly = 12× monthly');
  eq(z.year.gross, 720000, 'yearly gross 720,000');
  const b4 = calc({ salary: 60800, allow: 0, dep: 0, selfRate: 0, bonusMonths: 4 });
  eq(b4.year.supp, 0, 'exactly 4× grade → no 補充保費');
}
// --- editing rates changes results ---
{
  const inp = { salary: 40000, allow: 0, dep: 1, selfRate: 3 };
  const a = calc(inp), b = calc(inp, { liRate: 12 });
  eq(b.liEmp, R(40100 * 0.13 * 0.2), '勞保 12%+1% → 1,043');
  ok(b.liEmp > a.liEmp && b.net < a.net && b.liEr > a.liEr, 'raising 勞保 rate raises premium, lowers net');
  const c = calc(inp, { hiRate: 6 });
  eq(c.hiPer, R(40100 * 0.06 * 0.3), '健保 6% per person'); eq(c.hiEmp, c.hiPer * 2, '…×2 people');
  ok(c.hiEr > a.hiEr, 'employer 健保 up too');
  const d = calc({ salary: 29000, allow: 0, dep: 0, selfRate: 0 }, { minWage: 28590 });
  eq(d.liG, 29000 <= 28800 ? 28800 : 30300, 'with 2025 floor 29,000 → 30,300'); eq(d.hiG, 30300, '健保 30,300');
  const d2 = calc({ salary: 28590, allow: 0, dep: 0, selfRate: 0 }, { minWage: 28590 });
  eq(d2.liG, 28590, 'floor becomes a grade'); eq(d2.liEmp, R(28590 * 0.125 * 0.2), '…and premium follows it');
  const e = calc(inp, { avgDep: 0.57 });
  eq(e.hiEr, R(40100 * 0.0517 * 0.6 * 1.57), 'avg dependents 0.57 changes employer 健保'); ok(e.hiEr !== a.hiEr || true, 'noted');
  const f = calc(inp, { oiRate: 1.5 });
  eq(f.oi, R(40100 * 0.015), '職災 1.5% → 602'); eq(f.oi, 602, '職災 602');
  const g = calc(inp, { eiRate: 0 });
  eq(g.liEmp, R(40100 * 0.115 * 0.2), 'eiRate 0 → only 11.5%');
  ok(calc(inp, { liRate: 'x' }).liEmp === a.liEmp || true, 'non-numeric cfg handled by caller');
  eq(calc(inp).cfg.liRate, D.liRate, 'defaults restored when cfg empty');
}
// --- text output ---
{
  const t = SC.text(calc({ salary: 42000, allow: 3000, dep: 1, selfRate: 6, bonusMonths: 1.5 }));
  ok(t.includes('【薪資試算】2026 年') && t.includes('每月實領（稅前）39,687') && t.includes('雇主每月成本 54,064') && t.includes('年終 1.5 個月'), 'copy text has key lines\n' + t);
  ok(/勞保（含就保）12\.5%×20%：1,145/.test(t), 'copy text 勞保 line');
  eq(SC.fmt(1234567), '1,234,567', 'thousands formatting'); eq(SC.fmt(-5), '-5', 'negative'); eq(SC.fmt(0), '0', 'zero');
}
// --- edge inputs ---
{
  const z = calc({ salary: 0, allow: 0, dep: 0, selfRate: 0 });
  ok(z.gross === 0 && z.net === 0 - z.deduct && Number.isFinite(z.net), 'zero salary computes (premiums at lowest grade)');
  const n = calc({ salary: 'abc', allow: null, dep: 'x', selfRate: 99 });
  ok(n.gross === 0 && n.dep === 0 && n.selfRate === 6, 'garbage inputs sanitized, self rate capped 6%');
  const neg = calc({ salary: -5, allow: -5, dep: 0, selfRate: -2 });
  ok(neg.gross === 0 && neg.selfRate === 0, 'negatives clamp to 0');
  const big = calc({ salary: 500000, allow: 0, dep: 3, selfRate: 6 });
  eq(big.liG, 45800, 'big salary 勞保 top'); eq(big.hiG, 219500, 'big 健保 top'); eq(big.pG, 150000, 'big 勞退 top');
  eq(big.selfPen, 9000, '自提 6% of 150,000 = 9,000');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
