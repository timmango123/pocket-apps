// 分帳小幫手：上架重審第 1 輪的回歸測試（node tests.js，約 40 秒）。
// 每一項對應 score.json 的 toFix：觸控（另一指放著、兩指重疊、detail 0 補發 click、長按成員）、最少轉帳次數（獨立暴力解）、
// 最大餘數分錢（獨立計算）、50 個活動上限提示、匯出／匯入備份、連續加人、「＋ 加人」不用橫向捲動、全選高度、編輯不自動聚焦、
// 竄改存檔、.hint 對比、整數進位、草稿重新整理後還在、橫式浮動鈕不蓋字、1000 筆費用新增速度。
// 頁面用本機 http 伺服器載入（重新整理要保留 localStorage）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html lang="zh-Hant"><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'split-bill:v1:events', KEYC = 'split-bill:v1:current';

// ---------- independent money model (written for the test, not copied from the app) ----------
// owed shares: exact fraction amount·w/W, floor, then +1 cent to the largest fractional parts (ties: member order)
function shareOf(exp, order) {
  const ids = order.filter(i => (exp.shares[i] || 0) > 0);
  if (exp.mode === 'amount') return Object.fromEntries(ids.map(i => [i, exp.shares[i]]));
  const w = ids.map(i => BigInt(exp.mode === 'ratio' ? exp.shares[i] : 1)), Wt = w.reduce((a, b) => a + b, 0n), T = BigInt(exp.amountCents);
  const fl = w.map(x => T * x / Wt), fr = w.map((x, k) => T * x - fl[k] * Wt);
  let left = Number(T - fl.reduce((a, b) => a + b, 0n));
  const rank = ids.map((_, k) => k).sort((a, b) => (fr[b] > fr[a] ? 1 : fr[b] < fr[a] ? -1 : a - b));
  const out = Object.fromEntries(ids.map((i, k) => [i, Number(fl[k])]));
  for (const k of rank) { if (left-- <= 0) break; out[ids[k]]++; }
  return out;
}
function netsOf(ev) {
  const order = ev.members.map(m => m.id), net = Object.fromEntries(order.map(i => [i, 0]));
  for (const x of ev.expenses) { net[x.payerId] += x.amountCents; const s = shareOf(x, order); for (const k in s) net[k] -= s[k]; }
  return order.map(i => net[i]);
}
// minimum number of transfers by plain backtracking (classic "optimal account balancing" search)
function bruteMin(nets) {
  const d = nets.filter(x => x !== 0);
  const dfs = (s) => {
    while (s < d.length && d[s] === 0) s++;
    if (s === d.length) return 0;
    let best = Infinity;
    for (let i = s + 1; i < d.length; i++) if (d[i] * d[s] < 0) { d[i] += d[s]; best = Math.min(best, 1 + dfs(s + 1)); d[i] -= d[s]; }
    return best;
  };
  return dfs(0);
}
let seed = 12345; const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const open = async (w, h, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, colorScheme: opts.dark ? 'dark' : 'light' });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${w}x${h} ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    await p.goto(URL); await p.waitForFunction(() => window.__splitBill);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b0 = e.getBoundingClientRect(); if (b0.top < 0 || b0.bottom > innerHeight - 90) e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async (sel, hold = 40) => { const c = await center(sel); await T('touchStart', [[c[0], c[1], 1]]); await W(hold); await T('touchEnd', [[c[0], c[1], 1]]); await W(40); };
    const sheetReady = () => p.waitForFunction(() => { const s = document.querySelector('#layer .sheet'); return s && !s.getAnimations().length; });
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.__splitBill); };
    const setData = async (events, curId) => { await p.evaluate(([K, KC, ev, c]) => { localStorage.setItem(K, JSON.stringify(ev)); localStorage.setItem(KC, c); localStorage.removeItem('split-bill:v1:draft'); }, [KEY, KEYC, events, curId]); await reload(); };
    return { ctx, p, T, center, tap, sheetReady, reload, setData };
  };
  const sheetOpen = p => p.evaluate(() => !!document.querySelector('#layer .sheet'));
  const mkEv = (id, names, expenses = [], extra = {}) => ({ id, name: 'E' + id, members: names.map(n => ({ id: n, name: n })), expenses, currency: '$', roundInt: false, updatedAt: 1000, ...extra });

  try {
    // ---------- 1. touch: resting finger, overlapping taps, detail-0 click, holds ----------
    {
      const { ctx, p, T, center, tap, sheetReady } = await open(390, 844);
      const ids = await p.evaluate(() => JSON.parse(localStorage.getItem('split-bill:v1:events'))[0].members.map(m => m.id));
      const rest = await center('.mark');
      // 新增費用 with another finger resting on the header
      await T('touchStart', [[rest[0], rest[1], 7]]); await W(150);
      let c = await center('#addExp'); await T('touchStart', [[rest[0], rest[1], 7], [c[0], c[1], 8]]); await W(40);
      await T('touchEnd', [[c[0], c[1], 8]]); await W(60);
      assert(await sheetOpen(p), 'finger resting: 新增費用 opens the sheet');
      await sheetReady();
      const pressed = id => p.$eval('#who-' + id, b => b.getAttribute('aria-pressed'));
      // 分攤對象 toggle while the resting finger stays down (it went down before the sheet; it is lifted later)
      let a0 = await pressed(ids[1]); c = await center('#who-' + ids[1]);
      await T('touchStart', [[rest[0], rest[1], 7], [c[0], c[1], 9]]); await W(40); await T('touchEnd', [[c[0], c[1], 9]]); await W(40);
      assert(await pressed(ids[1]) !== a0, 'finger resting: 分攤對象 toggles');
      await T('touchEnd', [[rest[0], rest[1], 7]]); await W(60);
      assert(await sheetOpen(p), 'lifting the resting finger leaves the sheet open');
      // overlapping two-finger taps on two 分攤對象, both lift orders
      for (const order of ['first', 'second']) {
        const s0 = [await pressed(ids[2]), await pressed(ids[3])];
        const A = await center('#who-' + ids[2]), B = await center('#who-' + ids[3]);
        await T('touchStart', [[A[0], A[1], 3]]); await W(50); await T('touchStart', [[A[0], A[1], 3], [B[0], B[1], 4]]); await W(50);
        if (order === 'first') { await T('touchEnd', [[A[0], A[1], 3]]); await W(30); await T('touchEnd', [[B[0], B[1], 4]]); }
        else { await T('touchEnd', [[B[0], B[1], 4]]); await W(30); await T('touchEnd', [[A[0], A[1], 3]]); }
        await W(50);
        const s1 = [await pressed(ids[2]), await pressed(ids[3])];
        assert(s1[0] !== s0[0] && s1[1] !== s0[1], `overlapping taps (${order} lifts first): both toggle ${s0}→${s1}`);
      }
      // tap then detail-0 clicks on the button, its edge point and elementFromPoint → toggled once
      a0 = await pressed(ids[0]); c = await center('#who-' + ids[0]); await tap('#who-' + ids[0]);
      await p.evaluate(([x, y, id]) => {
        const f = document.getElementById('who-' + id), r = f.getBoundingClientRect(), mk = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
        f.dispatchEvent(mk()); document.elementFromPoint(r.right - 1, r.bottom - 1).dispatchEvent(mk()); document.elementFromPoint(x, y).dispatchEvent(mk());
      }, [c[0], c[1], ids[0]]);
      assert(await pressed(ids[0]) !== a0, 'tap + three detail-0 clicks: 分攤對象 toggled exactly once');
      await W(850); a0 = await pressed(ids[0]);
      await p.evaluate(id => document.getElementById('who-' + id).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), ids[0]);
      assert(await pressed(ids[0]) !== a0, 'lone detail-0 click (keyboard / screen reader) acts once');
      // 取消 closes; a detail-0 click at that spot afterwards must not run what is now underneath
      c = await center('#xCancel'); await tap('#xCancel');
      await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, c);
      assert(!(await sheetOpen(p)), '取消 + detail-0 click: sheet closed, nothing underneath ran');
      // holds on 新增費用 open it once
      for (const hold of [600, 1000]) {
        await tap('#addExp', hold); await W(60);
        const n = await p.evaluate(() => document.querySelectorAll('#layer .sheet').length);
        eq(n, 1, `hold ${hold} ms on 新增費用 opens one sheet`);
        await sheetReady(); await tap('#xCancel'); await W(40);
      }
      // ---------- 2. long-press a member chip ----------
      for (const hold of [600, 1000]) {
        await tap(`[data-mid="${ids[0]}"]`, hold); await W(120);
        const t = await p.evaluate(() => (document.getElementById('sheetTitle') || {}).textContent);
        eq(t, '編輯成員', `long-press ${hold} ms on a member opens the edit sheet and the release keeps it open`);
        // a fresh tap on the scrim (pressed after the sheet appeared) closes it
        await sheetReady(); await T('touchStart', [[195, 40, 5]]); await W(40); await T('touchEnd', [[195, 40, 5]]); await W(60);
        assert(!(await sheetOpen(p)), `after long-press ${hold} ms: a new tap on the scrim closes the sheet`);
      }
      // a quick tap on a chip opens it too
      await tap(`[data-mid="${ids[1]}"]`); await W(60);
      eq(await p.evaluate(() => document.getElementById('mName') && document.getElementById('mName').value), ids.length && await p.evaluate(id => JSON.parse(localStorage.getItem('split-bill:v1:events'))[0].members.find(m => m.id === id).name, ids[1]), 'tap on a member opens its edit sheet');
      await sheetReady(); await tap('#mCancel');
      // ---------- 8. 全選 ≥ 44 px, editing does not focus 品項 ----------
      await tap('.card'); await sheetReady(); await W(80);
      const f = await p.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, h: document.getElementById('xAll').getBoundingClientRect().height, title: document.getElementById('sheetTitle').textContent }));
      eq(f.title, '編輯費用', 'tap on a card opens 編輯費用');
      assert(f.tag !== 'INPUT', `editing an expense does not focus a text field (focused ${f.tag}#${f.id})`);
      assert(f.h >= 44, `全選／全不選 is ${f.h}px tall`);
      await tap('#xCancel');
      await tap('#menuBtn'); await tap('#mNew'); await W(120);
      assert(await p.evaluate(() => document.activeElement.id !== 'eventName'), '新活動 does not focus the event name');
      // ---------- 6. add several members in a row ----------
      await tap('#addMember'); await sheetReady();
      await p.fill('#mName', '甲'); await p.press('#mName', 'Enter');
      await p.fill('#mName', '乙'); await tap('#mSave');
      await p.fill('#mName', '丙, 丁，戊'); await tap('#mSave');
      const ms = await p.evaluate(() => ({ open: !!document.getElementById('mName'), v: document.getElementById('mName').value, chips: [...document.querySelectorAll('#chips [data-mid] .nm')].map(e => e.textContent) }));
      assert(ms.open && ms.v === '', 'the add-member sheet stays open and clears after each add');
      eq(ms.chips, ['甲', '乙', '丙', '丁', '戊'], 'Enter, 加入 and a comma list add five members in a row');
      await p.fill('#mName', '甲'); await tap('#mSave');
      assert(await p.evaluate(() => document.getElementById('mErr').textContent.includes('同名')), 'a duplicate name is refused with a reason');
      await p.fill('#mName', '己'); await tap('#mCancel'); await W(60);
      assert(!(await sheetOpen(p)) && await p.evaluate(() => document.querySelectorAll('#chips [data-mid]').length === 6), '完成 adds the name still in the box and closes');
      await ctx.close();
    }

    // ---------- 3, 4, minor: engine vs the independent model ----------
    {
      const { ctx, p, center, tap, sheetReady, setData } = await open(390, 844);
      const run = ev => p.evaluate(ev => { const f = __splitBill.finalTransfers(ev); return { nets: f.rows.map(r => r.net), xs: f.xs, note: f.note }; }, ev);
      const check = async (ev, label) => {
        const r = await run(ev), want = netsOf(ev);
        eq(r.nets, want, `${label}: nets match largest-remainder model`);
        const bal = Object.fromEntries(ev.members.map((m, i) => [m.id, r.nets[i]]));
        for (const x of r.xs) { bal[x.from] += x.c; bal[x.to] -= x.c; }
        assert(Object.values(bal).every(v => v === 0) && r.xs.every(x => x.c > 0), `${label}: transfers settle everyone with positive amounts`);
        eq(r.xs.length, bruteMin(want), `${label}: transfer count is the brute-force minimum`);
      };
      // repro: A pays 6 for C,D; B pays 4 for E,F → 4 transfers
      const M6 = ['A', 'B', 'C', 'D', 'E', 'F'];
      const trap = mkEv('t', M6, [
        { id: 'x1', title: 'a', amountCents: 600, payerId: 'A', mode: 'amount', shares: { C: 300, D: 300 } },
        { id: 'x2', title: 'b', amountCents: 400, payerId: 'B', mode: 'amount', shares: { E: 200, F: 200 } }]);
      eq((await run(trap)).xs.length, 4, 'A $6 for C,D + B $4 for E,F → 4 transfers');
      await check(trap, 'greedy trap 6,4 vs 3,3,2,2');
      await check(mkEv('t2', M6, [{ id: 'x', title: 'a', amountCents: 1200, payerId: 'A', mode: 'amount', shares: { C: 400, D: 300, E: 300, F: 200 } }, { id: 'y', title: 'b', amountCents: 500, payerId: 'B', mode: 'amount', shares: { C: 500 } }]), 'trap 2');
      // random events: 3–8 members, mixed modes
      for (let k = 0; k < 40; k++) {
        const n = 3 + rnd(6), names = Array.from({ length: n }, (_, i) => 'm' + i), exps = [];
        for (let j = 0, J = 1 + rnd(6); j < J; j++) {
          const who = names.filter(() => rnd(3) > 0); if (!who.length) who.push(names[0]);
          const mode = ['equal', 'ratio', 'amount'][rnd(3)], amt = 1 + rnd(rnd(2) ? 3000 : 300) * (rnd(2) ? 100 : 1);
          let shares;
          if (mode === 'amount') { shares = {}; let left = amt; who.forEach((w, i) => { const v = i === who.length - 1 ? left : Math.floor(left / 2); if (v > 0) shares[w] = v; left -= v; }); if (!Object.keys(shares).length) shares[who[0]] = amt; }
          else shares = Object.fromEntries(who.map(w => [w, mode === 'ratio' ? 1 + rnd(5) : 1]));
          exps.push({ id: 'x' + j, title: 't', amountCents: amt, payerId: names[rnd(n)], mode, shares });
        }
        await check(mkEv('r' + k, names, exps), `random #${k}`);
      }
      // large group: 30 members, many balances → still settles, no more than n−1 transfers, fast
      {
        const names = Array.from({ length: 30 }, (_, i) => 'p' + i), exps = [];
        for (let j = 0; j < 60; j++) exps.push({ id: 'x' + j, title: 't', amountCents: 1 + rnd(99999), payerId: names[rnd(30)], mode: 'equal', shares: Object.fromEntries(names.filter(() => rnd(2)).concat('p0').map(w => [w, 1])) });
        const ev = mkEv('big', names, exps);
        const t = await p.evaluate(ev => { const t0 = performance.now(); const f = __splitBill.finalTransfers(ev); return { ms: performance.now() - t0, xs: f.xs, nets: f.rows.map(r => r.net) }; }, ev);
        eq(t.nets, netsOf(ev), '30 members: nets match');
        const bal = Object.fromEntries(names.map((m, i) => [m, t.nets[i]])); for (const x of t.xs) { bal[x.from] += x.c; bal[x.to] -= x.c; }
        assert(Object.values(bal).every(v => v === 0) && t.xs.length <= t.nets.filter(v => v).length - 1, `30 members: settles in ${t.xs.length} transfers`);
        assert(t.ms < 400, `30 members settle in ${t.ms.toFixed(0)} ms`);
      }
      // 4. largest remainder: $301 at 1:2, $100 at 1:2, $0.02 / 3
      const al = (amt, mode, shares, order) => p.evaluate(([a, m, s, o]) => __splitBill.allocate({ amountCents: a, mode: m, shares: s }, o.map(id => ({ id }))), [amt, mode, shares, order]);
      eq(await al(30100, 'ratio', { a: 1, b: 2 }, ['a', 'b']), { a: 10033, b: 20067 }, '$301 at 1:2 → 100.33 / 200.67');
      eq(await al(10000, 'ratio', { a: 1, b: 2 }, ['a', 'b']), { a: 3333, b: 6667 }, '$100 at 1:2 → 33.33 / 66.67');
      eq(await al(2, 'equal', { a: 1, b: 1, c: 1 }, ['a', 'b', 'c']), { a: 1, b: 1, c: 0 }, '$0.02 / 3 → ties go by member order');
      eq(await al(999999900, 'ratio', { a: 9999, b: 1, c: 7 }, ['a', 'b', 'c']), shareOf({ amountCents: 999999900, mode: 'ratio', shares: { a: 9999, b: 1, c: 7 } }, ['a', 'b', 'c']), 'max amount at 9999:1:7 matches the model');
      // the sheet preview shows the same split
      await setData([mkEv('ui', ['小明', '小華'])], 'ui');
      await tap('#addExp'); await sheetReady();
      await p.fill('#xAmount', '301'); await tap('#modeRatio');
      await p.fill('#ratio-小華', '2'); await W(40);
      eq(await p.$$eval('[data-pv]', s => s.map(e => e.textContent)), ['$100.33', '$200.67'], 'ratio preview: $301 at 1:2 shows $100.33 / $200.67');
      // minor: draft survives a reload
      await p.fill('#xTitle', '晚餐草稿'); await W(30);
      await p.reload(); await p.waitForFunction(() => window.__splitBill); await sheetReady();
      const dr = await p.evaluate(() => ({ t: document.getElementById('xTitle').value, a: document.getElementById('xAmount').value, mode: document.querySelector('#xMode [aria-pressed="true"]').dataset.mode, r: document.getElementById('ratio-小華').value }));
      eq(dr, { t: '晚餐草稿', a: '301', mode: 'ratio', r: '2' }, 'unsaved expense draft comes back after reload');
      await tap('#xSave'); await W(60);
      assert(!(await sheetOpen(p)) && await p.evaluate(() => localStorage.getItem('split-bill:v1:draft') === null), 'saving clears the draft');
      await p.reload(); await p.waitForFunction(() => window.__splitBill); await W(100);
      assert(!(await sheetOpen(p)), 'no sheet after reload once saved');
      // minor: whole-dollar rounding treats equal debts equally
      const rr = await run(mkEv('r', ['a', 'b', 'c'], [{ id: 'x', title: 't', amountCents: 98, payerId: 'a', mode: 'amount', shares: { b: 49, c: 49 } }], { roundInt: true }));
      eq(rr.xs.map(x => x.c), [], 'roundInt: two people owing $0.49 each both pay $0 (no one pays $1 for the other)');
      const r2 = await run(mkEv('r2', ['a', 'b', 'c'], [{ id: 'x', title: 't', amountCents: 300, payerId: 'a', mode: 'amount', shares: { b: 150, c: 150 } }], { roundInt: true }));
      eq(r2.xs.map(x => x.c), [200, 200], 'roundInt: $1.50 + $1.50 → $2 each');
      const r3 = await run(mkEv('r3', ['a', 'b', 'c'], [{ id: 'x', title: 't', amountCents: 10000, payerId: 'a', mode: 'equal', shares: { a: 1, b: 1, c: 1 } }], { roundInt: true }));
      assert(r3.xs.every(x => x.c % 100 === 0 && Math.abs(x.c - x.exact) <= 50), 'roundInt: every transfer within $0.50 of exact');
      await ctx.close();
    }

    // ---------- 5. 50-event cap warning, export / import ----------
    {
      const { ctx, p, tap, setData, reload } = await open(390, 844);
      const evs = Array.from({ length: 50 }, (_, i) => mkEv('e' + i, ['a', 'b'], [], { updatedAt: 1000 + i }));
      await setData(evs, 'e49');
      await tap('#menuBtn'); await tap('#mNew'); await W(80);
      const dlg = await p.evaluate(() => (document.getElementById('cfT') || {}).textContent);
      assert(/50/.test(dlg || ''), `the 51st event asks first (${dlg})`);
      await tap('#cfNo'); await W(40);
      eq(await p.evaluate(() => JSON.parse(localStorage.getItem('split-bill:v1:events')).length), 50, 'cancel keeps all 50 events');
      assert(await p.evaluate(() => JSON.parse(localStorage.getItem('split-bill:v1:events')).some(e => e.id === 'e0')), 'cancel keeps the oldest');
      await tap('#menuBtn'); await tap('#mNew'); await W(80); await tap('#cfOk'); await W(60);
      const after = await p.evaluate(() => JSON.parse(localStorage.getItem('split-bill:v1:events')).map(e => e.id));
      assert(after.length === 50 && !after.includes('e0') && after.includes('e1'), 'confirming replaces only the oldest');
      // export
      const dl = p.waitForEvent('download');
      await tap('#menuBtn'); await tap('#mExport');
      const d = await dl; const file = await d.path(); const json = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert(/\.json$/.test(d.suggestedFilename()) && json.events.length === 50, `export downloads ${d.suggestedFilename()} with 50 events`);
      // import into a fresh store
      await setData([mkEv('only', ['x', 'y'])], 'only');
      const bad = path.join(path.dirname(file), 'bad.json'); fs.writeFileSync(bad, '{"oops"');
      await p.setInputFiles('#importFile', bad); await p.waitForSelector('#cfT');
      assert((await p.textContent('#cfT')).includes('無法匯入'), 'a broken file is refused with a reason');
      await tap('#cfNo');
      const small = path.join(path.dirname(file), 'small.json');
      fs.writeFileSync(small, JSON.stringify({ app: 'split-bill', events: json.events.slice(0, 3) }));
      await p.setInputFiles('#importFile', small); await p.waitForSelector('#cfOk'); await tap('#cfOk'); await W(60);
      await reload();
      eq(await p.evaluate(() => JSON.parse(localStorage.getItem('split-bill:v1:events')).length), 4, 'import adds 3 events next to the existing one and survives reload');
      await ctx.close();
    }

    // ---------- 9. tampered storage, 7. 加人 visible, 10. contrast ----------
    for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
      const { ctx, p, setData } = await open(w, h);
      const v = await p.evaluate(() => { const c = document.getElementById('chips'), b = document.getElementById('addMember').getBoundingClientRect(); return { right: b.right, W: innerWidth, sw: c.scrollWidth, cw: c.clientWidth, top: b.top, H: innerHeight }; });
      assert(v.right <= v.W && v.sw <= v.cw && v.top < v.H, `${w}x${h}: ＋ 加人 visible without scrolling the chip row (right ${Math.round(v.right)} / ${v.W})`);
      if (w === 360) {
        const huge = 'W'.repeat(300), nameIds = ['n1', 'n2'];
        await setData([{ id: 'bad', name: '名'.repeat(300), members: [{ id: 'n1', name: huge }, { id: 'n2', name: '短' }],
          expenses: [{ id: 'x1', title: 'T'.repeat(300), amountCents: 1e15, payerId: 'n1', mode: 'equal', shares: { n1: 1, n2: 1 } },
            { id: 'x2', title: 'ok', amountCents: 999999900, payerId: 'n1', mode: 'ratio', shares: { n1: 1e9, n2: 1 } }], currency: '$', updatedAt: 5 }], 'bad');
        const t = await p.evaluate(() => { return { sw: document.documentElement.scrollWidth, W: innerWidth, name: document.querySelector('#chips [data-mid] .nm').textContent.length, n: document.querySelectorAll('.card').length, ratio: (__splitBill.events[0].expenses[0] || {shares:{}}).shares.n1 }; });
        assert(t.sw <= t.W, `tampered event: no sideways overflow (${t.sw} / ${t.W})`);
        eq(t.name, 20, 'tampered event: member name capped at 20 characters');
        eq(t.n, 1, 'tampered event: the 1e15-cent expense is dropped');
        eq(t.ratio, 9999, 'tampered event: ratio capped at 9999');
        // .hint contrast in light mode
        const cr = await p.evaluate(() => {
          const lum = s => { const [r, g, b] = s.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const h = document.getElementById('memberHint'); const a = lum(getComputedStyle(h).color), b = lum(getComputedStyle(document.body).backgroundColor);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
        assert(cr >= 4.5, `.hint contrast ${cr.toFixed(2)}:1 in light mode`);
      }
      await ctx.close();
    }

    // ---------- minor: landscape floating button does not cover card text ----------
    {
      const { ctx, p } = await open(844, 390);
      for (const where of ['top', 'bottom']) {
      if (where === 'bottom') await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await W(50);
      const cov = await p.evaluate(() => {
        const btn = document.getElementById('addExp').getBoundingClientRect(), bar = document.querySelector('.bar'), bg = getComputedStyle(bar).backgroundColor;
        const bad = [];
        for (const el of document.querySelectorAll('.card .t, .card .a, .card .s, .card .m')) {
          const r = el.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= innerHeight) continue;
          const over = !(r.right <= btn.left || r.left >= btn.right || r.bottom <= btn.top || r.top >= btn.bottom);
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          if (over) bad.push(el.textContent);
        }
        return { bad, sw: document.documentElement.scrollWidth, W: innerWidth };
      });
      eq(cov.bad, [], `landscape (${where}): 新增費用 does not overlap any card text`);
      assert(cov.sw <= cov.W, `landscape (${where}): no sideways scroll`);
      }
      await ctx.close();
    }

    // ---------- swipe-left reveals 刪除; tapping it deletes; 復原 brings it back ----------
    {
      const { ctx, p, T, tap } = await open(390, 844);
      const n0 = await p.evaluate(() => document.querySelectorAll('#list .card').length);
      const b = await p.$eval('#list .card', e => { const r = e.getBoundingClientRect(); return { x: r.right - 20, y: r.top + r.height / 2 }; });
      await T('touchStart', [[b.x, b.y, 1]]);
      for (let i = 1; i <= 10; i++) { await T('touchMove', [[b.x - i * 12, b.y, 1]]); await W(16); }
      await T('touchEnd', [[b.x - 120, b.y, 1]]); await W(300);
      assert(await p.evaluate(() => !!document.querySelector('#list .item.reveal .del')) && !(await sheetOpen(p)), 'swipe left reveals 刪除 without opening the editor');
      const d = await p.$eval('#list .item.reveal .del', e => { const r = e.getBoundingClientRect(); return [r.right - 30, r.top + r.height / 2]; });
      await T('touchStart', [[d[0], d[1], 2]]); await W(40); await T('touchEnd', [[d[0], d[1], 2]]); await W(80);
      eq(await p.evaluate(() => document.querySelectorAll('#list .card').length), n0 - 1, 'tap 刪除 removes one expense');
      await tap('#undoBtn'); await W(60);
      eq(await p.evaluate(() => document.querySelectorAll('#list .card').length), n0, '復原 brings it back');
      await ctx.close();
    }

    // ---------- minor: adding to a 1000-expense list stays fast ----------
    {
      const { ctx, p, tap, sheetReady, setData } = await open(390, 844);
      const names = Array.from({ length: 30 }, (_, i) => 'p' + i), exps = [];
      for (let j = 0; j < 1000; j++) exps.push({ id: 'x' + j, title: '費用' + j, amountCents: 100 + rnd(99999), payerId: names[rnd(30)], mode: 'equal', shares: Object.fromEntries(names.map(w => [w, 1])) });
      await setData([mkEv('k', names, exps)], 'k');
      await tap('#addExp'); await sheetReady(); await p.fill('#xAmount', '123'); await W(850);
      const ms = await p.evaluate(() => { const t0 = performance.now(); document.getElementById('xSave').click(); void document.body.offsetHeight; return performance.now() - t0; });
      eq(await p.evaluate(() => document.querySelectorAll('.card').length), 1001, '1000-expense list shows the new one');
      assert(ms < 150, `adding to a 1000-expense list takes ${ms.toFixed(0)} ms`);
      await ctx.close();
    }
  } catch (e) { fails++; console.log('FAIL', e.stack || e); }
  eq(errors, [], 'no page errors');
  await browser.close(); srv.close();
  console.log(fails ? `${fails} 項失敗，${passes} 項通過` : `全部 ${passes} 項通過`);
  process.exit(fails ? 1 : 0);
})();
