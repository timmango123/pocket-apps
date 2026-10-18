// Logic tests for 薪資與勞健保試算. Extracts the pure core between CORE markers of ../index.html.
// Usage: node tests.js   → prints "N passed, 0 failed", exit 0 on success.
// Expected values are computed by hand (Decimal, round half up) from the 2026 figures, independent of the app code.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SC;')();
const D = SC.DATA, def = SC.defaults();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${a}, want ${b})`);
const calc = (inp, cfg) => SC.calc(inp, cfg || {});
const R = Math.round;

// --- data block sanity / internal consistency ---
{
  eq(D.year, 2026, 'data year is 2026'); eq(D.minWage, 29500, '基本工資 29,500');
  eq(D.liRate + D.eiRate, 12.5, '勞保 11.5% + 就保 1% = 12.5%');
  eq(D.hiRate, 5.17, '健保 5.17%'); eq(D.avgDep, 0.56, '平均眷口數 0.56'); eq(D.pensionEr, 6, '勞退 6%');
  eq(D.liEmpShare + D.liErShare, 90, '勞保 20+70 (政府 10)'); eq(D.hiEmpShare + D.hiErShare, 90, '健保 30+60 (政府 10)');
  ok(D.grades.every((g, i) => i === 0 || g > D.grades[i - 1]), 'grade table strictly ascending');
  ok(!D.grades.includes(D.minWage), 'min wage is added as a grade, not stored in the table');
  ok(D.penLow.every((g, i) => i === 0 || g > D.penLow[i - 1]) && D.penLow[D.penLow.length - 1] < D.grades[0], 'pension low grades ascending, below table');
  ok([D.liTop, D.oiTop, D.hiTop, D.pensionTop].every(t => D.grades.includes(t)), 'tops are table members');
  ok(D.liTop < D.oiTop && D.oiTop < D.pensionTop && D.pensionTop < D.hiTop, 'top order 勞保 < 職災 < 勞退 < 健保');
}
// --- grade lookup boundaries ---
{
  const li = SC.grades('li', def), lip = SC.grades('li', def, true), hi = SC.grades('hi', def, true), pen = SC.grades('pen', def, true), oi = SC.grades('oi', def);
  eq(li[0], 29500, 'full-time 勞保 starts at min wage'); eq(li[li.length - 1], 45800, '勞保 top 45,800'); eq(li.length, 11, '勞保 full-time has 11 grades');
  eq(lip[0], 11100, 'part-time 勞保 starts at 11,100'); ok(lip.includes(28800) && lip.includes(27600), 'part-time keeps 27,600 and 28,800 (below min wage)');
  eq(lip.length, 28, 'part-time 勞保 has 17 low + 11 grades');
  eq(hi[0], 29500, '健保 lowest = min wage even part-time'); eq(hi[hi.length - 1], 219500, '健保 top 219,500');
  eq(pen[0], 1500, '勞退 part-time starts at 1,500'); eq(pen[pen.length - 1], 150000, '勞退 top 150,000');
  eq(oi[oi.length - 1], 72800, '職災 top 72,800');
  const G = (k, a, p) => SC.grade(k, a, def, p);
  eq(G('li', 29500), 29500, 'exactly min wage → min wage');
  eq(G('li', 29501), 30300, 'one dollar above min wage → 30,300');
  eq(G('li', 30300), 30300, 'exactly on a grade stays');
  eq(G('li', 30301), 31800, 'one over a grade → next');
  eq(G('li', 45801), 45800, '勞保 capped at 45,800');
  eq(G('li', 999999), 45800, 'huge → 勞保 top');
  eq(G('hi', 45801), 48200, '健保 continues above 勞保 top');
  eq(G('hi', 300000), 219500, '健保 capped');
  eq(G('pen', 150001), 150000, '勞退 capped');
  eq(G('oi', 50000), 50600, '職災 50,000 → 50,600 (not capped at 勞保 top)');
  eq(G('oi', 80000), 72800, '職災 capped at 72,800');
  eq(G('li', 20000), 29500, 'full-time below min wage → min wage grade');
  eq(G('li', 20000, true), 20008, 'part-time 20,000 → 20,008');
  eq(G('li', 28700, true), 28800, 'part-time 28,700 → 28,800');
  eq(G('li', 28801, true), 29500, 'part-time 28,801 → 29,500');
  eq(G('li', 5000, true), 11100, 'part-time below 11,100 → 11,100');
  eq(G('pen', 5000, true), 6000, '勞退 part-time 5,000 → 6,000');
  eq(G('pen', 1, true), 1500, '勞退 part-time lowest 1,500');
  eq(G('pen', 9901, true), 11100, '勞退 9,901 → 11,100');
  eq(G('hi', 10000, true), 29500, '健保 part-time below min wage → min wage');
  eq(G('li', 0), 29500, 'zero → lowest grade, no crash');
  // min wage edits
  const c25 = { ...def, minWage: 28590 };
  eq(SC.grade('li', 28590, c25), 28590, '2025 min wage 28,590 becomes the floor');
  eq(SC.grade('li', 28700, c25), 28800, '…and 28,800 is a normal grade again');
  const c31 = { ...def, minWage: 31000 };
  eq(SC.grade('hi', 29600, c31), 31000, 'min wage 31,000 drops 30,300');
  eq(SC.grade('hi', 31001, c31), 31800, '…next 31,800');
  eq(SC.grade('li', 30000, c31, true), 30300, 'part-time can use 30,300 under a 31,000 floor');
  // editable tops
  eq(SC.grade('li', 60000, { ...def, liTop: 48200 }), 48200, '勞保 top raised to 48,200');
  eq(SC.grade('li', 60000, { ...def, liTop: 47000 }), 47000, 'top not in table becomes the last grade');
  eq(SC.grade('li', 60000, { ...def, liTop: 20000 }), 29500, 'top below min wage → min wage');
}
// --- the sample case, every item ---
{
  const r = calc({ salary: 42000, allow: 3000, dep: 1, selfRate: 6, bonusMonths: 1.5 });
  eq(r.gross, 45000, 'gross = salary + allowance');
  eq(r.liG, 45800, '勞保 grade'); eq(r.hiG, 45800, '健保 grade'); eq(r.pG, 45800, '勞退 grade'); eq(r.oiG, 45800, '職災 grade');
  eq(r.liEmpN, 1053, '普通事故 45,800×11.5%×20% = 1,053.4 → 1,053');
  eq(r.liEmpE, 92, '就保 45,800×1%×20% = 91.6 → 92');
  eq(r.liEmp, 1145, '勞保 1,145');
  eq(r.hiPer, 710, '健保 per person 45,800×5.17%×30% = 710.358 → 710');
  eq(r.hiEmp, 1420, '健保 ×2 people');
  eq(r.selfPen, 2748, '自提 6% = 2,748');
  eq(r.net, 39687, 'net 45,000 − 1,145 − 1,420 − 2,748');
  eq(r.liEr, 4008, '雇主勞保 3,686.9→3,687 + 320.6→321');
  eq(r.oi, 92, '職災 0.2% = 91.6 → 92');
  eq(r.wf, 11, '墊償 0.025% = 11.45 → 11');
  eq(r.hiEr, 2216, '雇主健保 45,800×5.17%×60%×1.56 = 2,216.36');
  eq(r.penEr, 2748, '雇主勞退 2,748');
  eq(r.erTotal, 45000 + 4008 + 92 + 11 + 2216 + 2748, 'employer total 54,075');
  eq(r.year.bonus, 63000, 'bonus = 本薪 × 1.5');
  eq(r.year.supp, 0, 'bonus 63,000 < 4×45,800 → no 補充保費');
  eq(r.year.net, 39687 * 12 + 63000, 'yearly net');
  eq(r.year.erTotal, r.erTotal * 12 + 63000, 'yearly employer cost');
  eq(r.year.self, 2748 * 12, 'yearly 自提 32,976');
  eq(JSON.stringify(r.year.taxSave), JSON.stringify([[5, 1649], [12, 3957], [20, 6595], [30, 9893], [40, 13190]]), '自提 tax saving at 5/12/20/30/40%');
}
// --- 勞保 split rounding differs from combined rounding ---
{
  const r = calc({ salary: 40100 });
  eq(r.liEmp, 922 + 80, '40,100: 922.3→922 + 80.2→80 = 1,002 (combined would give 1,003)');
  const r2 = calc({ salary: 29500 });
  eq(r2.liEr, 2375 + 207, '29,500 employer: 2,374.75→2,375 + 206.5→207 = 2,582');
  eq(r2.liEmp, 679 + 59, '29,500 employee: 678.5→679 + 59 = 738');
  const r3 = calc({ salary: 11000, part: true });
  eq(r3.liEmp, 255 + 22, 'part-time 11,100: 255.3→255 + 22.2→22 = 277');
}
// --- dependents cap ---
{
  const h = d => calc({ salary: 40000, dep: d }).hiEmp;
  eq(h(0), 622, '健保 alone 40,100×5.17%×30% = 621.951 → 622');
  eq(h(1), 1244, '×2'); eq(h(2), 1866, '×3'); eq(h(3), 2488, '×4');
  eq(h(4), 2488, '4 dependents capped at 3'); eq(h(9), 2488, '9 capped'); eq(h(-1), 622, 'negative → 0'); eq(h(1.7), 1244, 'fraction floors');
  eq(calc({ salary: 40000, dep: 7 }).dep, 3, 'dep recorded capped 3');
  eq(calc({ salary: 40000, dep: 0 }).hiEr, calc({ salary: 40000, dep: 3 }).hiEr, 'employer 健保 ignores dependents');
  eq(calc({ salary: 40000, dep: 5 }, { maxDep: 5 }).hiEmp, 622 * 6, 'editable cap');
  const r2 = calc({ salary: 31800, dep: 3 });
  eq(r2.hiEmp, 493 * 4, 'per-person rounded before multiplying (1,972 not 1,973)');
}
// --- part-time ---
{
  const p = calc({ salary: 20000, part: true, selfRate: 3 });
  eq(p.liG, 20008, '勞保 20,008'); eq(p.pG, 20008, '勞退 20,008'); eq(p.hiG, 29500, '健保 29,500'); eq(p.oiG, 20008, '職災 follows part-time grade');
  eq(p.liEmp, 460 + 40, '20,008: 460.18→460 + 40.016→40');
}
// --- part-time health premium, 健保 not insured here ---
{
  const p = calc({ salary: 20000, part: true, selfRate: 3 });
  eq(p.hiPer, 458, '健保 29,500×5.17%×30% = 457.545 → 458');
  eq(p.selfPen, 600, '自提 20,008×3% = 600.24 → 600');
  eq(p.net, 20000 - 500 - 458 - 600, 'part-time net 18,442');
  const q = calc({ salary: 20000, part: true, hiIn: false });
  eq(q.hiG, 0, '健保 not insured here → no grade'); eq(q.hiEmp, 0, 'no 健保 premium'); eq(q.hiEr, 0, 'no employer 健保');
  eq(q.net, 20000 - 500, 'net only minus 勞保');
  ok(calc({ salary: 20000, part: false, hiIn: false }).hiEmp > 0, 'hiIn=false ignored for full-time');
  const f = calc({ salary: 20000 });
  ok(f.belowMin && f.liG === 29500, 'full-time below min wage flagged, insured at min wage');
  ok(!calc({ salary: 20000, part: true }).belowMin, 'part-time not flagged');
  const tiny = calc({ salary: 1200, part: true, selfRate: 6 });
  eq(tiny.pG, 1500, 'tiny part-time 勞退 1,500'); eq(tiny.selfPen, 90, '自提 90'); eq(tiny.liG, 11100, '勞保 11,100');
  eq(tiny.net, 1200 - 277 - 458 - 90, 'tiny part-time net 375');
  ok(calc({ salary: 500, part: true }).net < 0, '500/month with 健保 goes negative (UI warns)');
}
// --- 投保薪資 override ---
{
  const full = calc({ salary: 50000, selfRate: 6 }), low = calc({ salary: 50000, selfRate: 6, insured: 30000 });
  ok(!full.underInsured && low.underInsured, 'underInsured flag');
  eq(low.liG, 30300, 'override 30,000 → 30,300'); eq(full.hiG, 50600, 'full 健保 50,600'); eq(full.oiG, 50600, '職災 50,600');
  eq(full.oi, 101, '職災 50,600×0.2% = 101.2 → 101');
  eq(low.net, 50000 - low.liEmp - low.hiEmp - low.selfPen, 'net still based on real gross');
  eq(calc({ salary: 50000, insured: '' }).insBase, 50000, 'empty override = real salary');
  const over = calc({ salary: 30000, insured: 60000 });
  ok(!over.underInsured && over.hiG === 60800, 'override above salary allowed');
}
// --- yearly bonus and 補充保費 ---
{
  const r = calc({ salary: 60000, bonusMonths: 6 });
  eq(r.hiG, 60800, '健保 60,800'); eq(r.year.bonus, 360000, 'bonus 6 months');
  eq(r.year.suppBase, 360000 - 243200, '補充保費 base = part over 4×');
  eq(r.year.supp, 2464, '116,800×2.11% = 2,464.48 → 2,464');
  eq(r.year.net, r.net * 12 + 360000 - 2464, 'yearly net minus 補充保費');
  eq(calc({ salary: 60800, bonusMonths: 4 }).year.supp, 0, 'exactly 4× → none');
  eq(calc({ salary: 60000, bonusMonths: 30 }).year.bonusMonths, 24, 'bonus months capped at 24');
  eq(calc({ salary: 20000, part: true, hiIn: false, bonusMonths: 10 }).year.supp, 0, 'no 補充保費 when 健保 not insured here');
  eq(calc({ salary: 42000, allow: 3000, bonusMonths: 2.5 }).year.bonus, 105000, 'bonus excludes allowance');
}
// --- editing rates changes results ---
{
  const inp = { salary: 40000, dep: 1, selfRate: 3 }, a = calc(inp);
  const b = calc(inp, { liRate: 12 });
  eq(b.liEmp, R(40100 * 0.12 * 0.2) + R(40100 * 0.01 * 0.2), '勞保 12% → 962+80');
  ok(b.net < a.net && b.liEr > a.liEr, 'raising 勞保 lowers net, raises employer');
  const c = calc(inp, { hiRate: 6 }); eq(c.hiPer, R(40100 * 0.06 * 0.3), '健保 6%');
  eq(calc(inp, { avgDep: 0.57 }).hiEr, R(40100 * 0.0517 * 0.6 * 1.57), 'avg dependents 0.57');
  eq(calc(inp, { oiRate: 1.5 }).oi, 602, '職災 1.5% → 601.5 → 602');
  eq(calc(inp, { eiRate: 0 }).liEmp, R(40100 * 0.115 * 0.2), '就保 0%');
  eq(calc(inp, { liEmpShare: 30 }).liEmp, R(40100 * 0.115 * 0.3) + R(40100 * 0.01 * 0.3), '勞保 share 30%');
  eq(calc(inp, { pensionEr: 7 }).penEr, R(40100 * 0.07), '勞退 7%');
  eq(calc({ salary: 60000, bonusMonths: 6 }, { suppRate: 2.5 }).year.supp, R(116800 * 0.025), '補充保費 2.5%');
  eq(calc({ salary: 29000 }, { minWage: 28590 }).liG, 30300, '2025 floor: 29,000 → 30,300');
  eq(calc({ salary: 28590 }, { minWage: 28590 }).liEmp, R(28590 * 0.115 * 0.2) + R(28590 * 0.01 * 0.2), 'premium follows edited floor');
  eq(calc({ salary: 33000 }, { grades: [30000, 35000, 45800] }).liG, 35000, 'edited grade table used');
  // garbage cfg falls back per field
  const g = calc(inp, { liRate: 'x', hiRate: -1, avgDep: 99, grades: [3, 2, 1], minWage: NaN });
  eq(g.cfg.liRate, 11.5, 'non-numeric rate → default'); eq(g.cfg.hiRate, 5.17, 'negative rate → default');
  eq(g.cfg.avgDep, 0.56, 'out-of-range → default'); eq(g.cfg.grades.length, D.grades.length, 'descending grades rejected'); eq(g.cfg.minWage, 29500, 'NaN min wage → default');
  eq(g.net, a.net, 'garbage cfg gives default result');
  ok(!SC.isCustom(SC.defaults()) && SC.isCustom({ ...SC.defaults(), wfRate: 0.03 }), 'isCustom');
}
// --- input parsing ---
{
  const P = (s, o) => SC.parseNum(s, o);
  eq(P('42000').value, 42000, 'plain'); eq(P('42,000').value, 42000, 'commas'); eq(P(' NT$ 42,000 元 ').value, 42000, 'NT$ and 元');
  eq(P('４２０００').value, 42000, 'full-width digits'); eq(P('4.2萬').value, 42000, '萬'); eq(P('42k').value, 42000, 'k'); eq(P('3.5K').value, 3500, 'K');
  eq(P('$38000').value, 38000, '$'); eq(P('42000.6').value, 42001, 'decimal money rounds');
  ok(P('').ok && P('').empty && P('').value === 0, 'empty ok = 0');
  ok(!P('-5').ok && /負數/.test(P('-5').msg), 'negative rejected with reason');
  ok(!P('abc').ok && /看不懂/.test(P('abc').msg), 'letters rejected');
  ok(!P('四萬').ok, 'Chinese numerals rejected'); ok(!P('😀').ok, 'emoji rejected'); ok(!P('4..2').ok, 'double dot rejected');
  ok(!P('1e9').ok, 'scientific notation rejected');
  ok(!P('99999999').ok && /太大/.test(P('99999999').msg), 'too large rejected');
  eq(P('1.5', { months: true, max: 24 }).value, 1.5, 'months keep decimals');
  ok(!P('25', { months: true, max: 24 }).ok, 'months > 24 rejected'); ok(!P('2萬', { months: true, max: 24 }).ok, 'months with 萬 rejected');
  const L = SC.parseList;
  eq(L('100, 200 300\n400').value.join(), '100,200,300,400', 'list separators');
  eq(L('11,100, 12,540').value.join(), '11100,12540', 'list with thousands commas');
  ok(!L('300, 200').ok && !L('a, 1').ok && !L('').ok && !L('1, 1').ok, 'bad lists rejected');
}
// --- text output ---
{
  const t = SC.text(calc({ salary: 42000, allow: 3000, dep: 1, selfRate: 6, bonusMonths: 1.5 }));
  ok(t.includes('【薪資試算】依 2026 年') && t.includes('每月實領（稅前）39,687') && t.includes('雇主每月成本 54,075') && t.includes('年終 1.5 個月'), 'copy text key lines\n' + t);
  ok(/勞保（含就保）12\.5%×20%：1,145/.test(t), 'copy text 勞保 line');
  ok(SC.text(calc({ salary: 20000, part: true, hiIn: false })).includes('健保：未在此投保'), 'copy text without 健保');
  eq(SC.fmt(1234567), '1,234,567', 'fmt'); eq(SC.fmt(-5), '-5', 'negative'); eq(SC.fmt(0), '0', 'zero');
}
// --- edge inputs ---
{
  const z = calc({ salary: 0 });
  ok(z.gross === 0 && Number.isFinite(z.net), 'zero salary computes');
  const n = calc({ salary: 'abc', allow: null, dep: 'x', selfRate: 99 });
  ok(n.gross === 0 && n.dep === 0 && n.selfRate === 6, 'garbage inputs sanitized, self rate capped 6%');
  const neg = calc({ salary: -5, allow: -5, selfRate: -2 }); ok(neg.gross === 0 && neg.selfRate === 0, 'negatives clamp');
  const big = calc({ salary: 9999999, dep: 3, selfRate: 6, bonusMonths: 24 });
  eq(big.liG, 45800, 'big 勞保'); eq(big.hiG, 219500, 'big 健保'); eq(big.pG, 150000, 'big 勞退'); eq(big.selfPen, 9000, '自提 9,000');
  eq(big.year.supp, R((9999999 * 24 - 219500 * 4) * 0.0211), 'big bonus 補充保費');
  ok(Object.values(big).every(v => typeof v !== 'number' || Number.isFinite(v)), 'all finite');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
