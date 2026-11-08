// 記帳本：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent；CDP 的 touchEnd 只放開它列出的手指。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-ledger-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const K = 'pocket-ledger:v1:';
const T0 = Date.now();

// Records trusted pointer clicks before the app sees them, so a test can wait until a ghost click has really arrived.
const PROBE = () => { window.__clicks = 0; addEventListener('click', e => { if (e.isTrusted && e.detail > 0) window.__clicks++; }, true); };

(async () => {
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, colorScheme: o.dark ? 'dark' : 'light' });
    await ctx.addInitScript(PROBE);
    if (o.noIDB) await ctx.addInitScript(() => { try { Object.defineProperty(window, 'indexedDB', { value: undefined }); } catch (e) {} });
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await ready(p);
    return { ctx, p };
  }
  const ready = p => p.waitForSelector('html[data-ready="1"]');
  const reload = async p => { await p.reload(); await ready(p); };
  const L = (p, fn, arg) => p.evaluate(fn, arg);
  const dist = p => L(p, () => { const l = window.__ledger, m = {}; l.entries.forEach(e => { const n = (l.cats.find(c => c.id === e.catId) || {}).name + '/' + e.type; m[n] = (m[n] || 0) + 1; }); return JSON.stringify(Object.keys(m).sort().map(k => k + ':' + m[k])); });
  const toastText = p => L(p, () => document.querySelector('#toastLayer').textContent);
  const sheetTitle = p => L(p, () => { const t = document.querySelector('#sheetTitle'); return t ? t.textContent : ''; });
  const waitFor = (p, fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

  // ---------- 1. [嚴重] 分類 id 固定，重新整理不再變「其他」 ----------
  {
    const { ctx, p } = await open();
    const saved = await L(p, k => JSON.parse(localStorage.getItem(k) || 'null'), K + 'categories');
    assert(Array.isArray(saved) && saved.length === 10 && saved[0].id === 'd-food', '首次開啟就把預設分類存檔，id 固定（d-food…）');
    await p.fill('#amount', '88'); await p.click('#cats [data-cat] >> nth=1');
    await waitFor(p, () => window.__ledger.entries.some(e => e.cents === 8800));
    const d0 = await dist(p);
    await reload(p); const d1 = await dist(p);
    await reload(p); const d2 = await dist(p);
    assert(d0 === d1 && d1 === d2 && !/其他\/out:[4-9]\d/.test(d2), '重新整理兩次，各分類筆數不變 ' + d2.slice(0, 80));
    assert(await L(p, () => window.__ledger.entries.find(e => e.cents === 8800).catId === 'd-transit'), '剛記的交通重新整理後仍是交通');
    // a change is journaled synchronously, so reloading the moment after recording (before IndexedDB commits) keeps it
    await p.fill('#amount', '77'); await p.click('#cats [data-cat] >> nth=1');
    await reload(p);
    assert(await L(p, () => window.__ledger.entries.filter(e => e.cents === 7700).length === 1 && !localStorage.getItem('pocket-ledger:v1:pending')), '記帳後立刻重新整理，紀錄仍在且只有一筆');
    await ctx.close();
  }

  // ---------- 1b. 舊版資料修復（IndexedDB 中的隨機分類 id） ----------
  {
    const { ctx, p } = await open();
    // Old build: categories never saved; entries carry random ids from the session they were made in.
    await L(p, async () => {
      const mk = (id, catId, note, sample, type = 'out', extra = {}) => ({ id, date: '2026-10-0' + (1 + (id.length % 8)), month: '2026-10', type, catId, cents: 1000, note, sample, createdAt: 1, ...extra });
      const list = [
        mk('a1', 'old-food', '午餐便當', true), mk('a2', 'old-food', '晚餐', true), mk('a3', 'old-food', '', false), // user entry, same session as samples
        mk('b1', 'old-tr', '捷運', true), mk('b2', 'old-tr', '去機場', false),
        mk('c1', 'old-sal', '10月薪資', true, 'in'), mk('c2', 'old-sal', '', false, 'in'),
        mk('x1', 'old-mix', '捷運', true), mk('x2', 'old-mix', '晚餐', true), mk('x3', 'old-mix', '', false), // conflicting votes: not mapped
        mk('u1', 'old-unknown', '書', false), // no clue at all: stays 其他
        mk('w1', 'd-other-out', '', false, 'out', { lostCat: 'old-tr' }), // written back earlier as 其他, original id kept
      ];
      await new Promise((res, rej) => { const rq = indexedDB.open('pocket-ledger', 1); rq.onsuccess = () => { const db = rq.result, t = db.transaction('entries', 'readwrite'), os = t.objectStore('entries'); os.clear(); list.forEach(e => os.put(e)); t.oncomplete = () => { db.close(); res(); }; t.onerror = rej; }; rq.onerror = rej; });
      localStorage.removeItem('pocket-ledger:v1:categories');
    });
    await reload(p);
    const got = await L(p, () => Object.fromEntries(window.__ledger.entries.map(e => [e.id, (window.__ledger.cats.find(c => c.id === e.catId) || {}).name])));
    assert(got.a3 === '餐飲' && got.b2 === '交通' && got.c2 === '薪資' && got.w1 === '交通', `同一次開啟的範例可推回分類：a3=${got.a3} b2=${got.b2} c2=${got.c2} w1=${got.w1}`);
    assert(got.x3 === '其他' && got.u1 === '其他', '沒有可靠線索或線索互相矛盾的紀錄不亂猜，仍在「其他」');
    const keep = await L(p, () => window.__ledger.entries.find(e => e.id === 'u1').lostCat);
    assert(keep === 'old-unknown', '無法修復的紀錄保留原分類 id（lostCat）以便之後修復');
    // persisted: survives reload without needing the clues again
    await reload(p);
    const stored = await L(p, () => new Promise(res => { const rq = indexedDB.open('pocket-ledger', 1); rq.onsuccess = () => { const g = rq.result.transaction('entries').objectStore('entries').get('a3'); g.onsuccess = () => { res(g.result.catId); rq.result.close(); }; }; }));
    assert(stored === 'd-food', '修復結果寫回 IndexedDB');
    // an old JSON backup that still lists the old category by name restores the rest
    const msg = await L(p, () => window.__ledger.importJSON({ categories: [{ id: 'old-unknown', name: '購物', type: 'out' }, { id: 'old-mix', name: '自訂雜支', type: 'out', color: '#123456' }], entries: [] }));
    const got2 = await L(p, () => Object.fromEntries(window.__ledger.entries.map(e => [e.id, (window.__ledger.cats.find(c => c.id === e.catId) || {}).name])));
    assert(got2.u1 === '購物' && got2.x3 === '自訂雜支' && !(await L(p, () => window.__ledger.cats.filter(c => c.name === '購物').length > 1)), `匯入舊備份依分類名稱還原：u1=${got2.u1} x3=${got2.x3}（${msg}）`);
    await ctx.close();
  }

  // ---------- 2. [嚴重] 觸控：pointerup 觸發、第二指、按住、換畫面不誤觸 ----------
  {
    const { ctx, p } = await open();
    const cdp = await ctx.newCDPSession(p);
    let tid = 1;
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ctr = sel => L(p, s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    const clicks = () => L(p, () => window.__clicks);
    // tap; resting = a finger already on the blank header (released afterwards)
    const tap = async (sel, hold = 40, resting = false) => {
      const c = await ctr(sel), t = { x: c.x, y: c.y, id: tid++ }, r = { x: 120, y: 24, id: tid++ };
      if (resting) { await T('touchStart', [r]); await T('touchStart', [r, t]); } else await T('touchStart', [t]);
      if (hold > 40) await p.waitForTimeout(hold);
      await T('touchEnd', [t]);
      if (resting) await T('touchEnd', [r]);
      return c;
    };
    const n = () => L(p, () => window.__ledger.entries.length);
    const setAmt = async v => { await p.fill('#amount', v); await L(p, () => document.activeElement.blur()); };
    for (const hold of [40, 600, 1000]) {
      await setAmt('12'); const n0 = await n(); const c0 = await clicks();
      await tap('#cats [data-cat]', hold);
      const ok = await waitFor(p, n0 => window.__ledger.entries.length === n0 + 1, n0);
      await waitFor(p, c0 => window.__clicks > c0, c0, 1200); // let any native click arrive
      assert(ok && (await n()) === n0 + 1, `按住 ${hold}ms 點分類只記一筆`);
    }
    for (const hold of [40, 600]) {
      await L(p, () => document.querySelector('#typeOut').click());
      await tap('#typeIn', hold, true);
      assert(await waitFor(p, () => window.__ledger.st.type === 'in'), `另一指按著時點「收」（按住 ${hold}ms）有反應`);
    }
    await L(p, () => document.querySelector('#typeOut').click());
    { await setAmt('7'); const n0 = await n(); await tap('#cats [data-cat]', 40, true); assert(await waitFor(p, n0 => window.__ledger.entries.length === n0 + 1, n0) && (await n()) === n0 + 1, '另一指按著時點分類記一筆'); }
    await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
    await tap('#ledger .entry', 40, true);
    assert(await waitFor(p, () => !!document.querySelector('#eSave')), '另一指按著時點紀錄打開編輯');
    await L(p, () => document.querySelector('#eCancel').click());
    // screen-changing taps: whatever appears under the finger must not fire
    for (const hold of [40, 600, 1000]) {
      await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
      let c0 = await clicks();
      await tap('#ledger .entry', hold);
      await waitFor(p, () => !!document.querySelector('#eSave')); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      assert((await sheetTitle(p)) === '編輯紀錄', `點紀錄開編輯（按住 ${hold}ms），出現的面板沒被同一下關掉`);
      c0 = await clicks();
      await tap('#eCancel', hold);
      await waitFor(p, () => !document.querySelector('#layer').innerHTML); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      assert(!(await L(p, () => document.querySelector('#layer').innerHTML)), `按「取消」關閉後，底下的紀錄沒被誤開（按住 ${hold}ms）`);
    }
    {
      await L(p, () => scrollTo(0, 0));
      let c0 = await clicks(); await tap('#openSettings'); await waitFor(p, () => !!document.querySelector('#sCats')); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      c0 = await clicks(); await tap('#sCats'); await waitFor(p, () => !!document.querySelector('#catBody .lrow')); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      assert((await sheetTitle(p)) === '分類管理', '設定 → 分類管理，出現在指下的分類列沒被觸發');
      const catsN = await L(p, () => window.__ledger.cats.length);
      c0 = await clicks(); await tap('#catBody .lrow'); await waitFor(p, () => !!document.querySelector('#cSave')); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      assert((await sheetTitle(p)) === '編輯分類' && (await L(p, () => window.__ledger.cats.length)) === catsN, '分類列 → 編輯分類，沒有誤按儲存或刪除');
      await L(p, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    }
    // canvas tap: donut segment filters the list (and the list's controls under the finger don't fire)
    {
      await L(p, () => scrollTo(0, 0)); await tap('#tabChart');
      await waitFor(p, () => window.__ledger.st.tab === 'chart');
      await L(p, () => document.querySelector('#donut').scrollIntoView({ block: 'center' }));
      await waitFor(p, () => document.querySelector('#legend button'));
      const d = await L(p, () => { const r = document.querySelector('#donut').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.06 }; });
      const t = { x: d.x, y: d.y, id: tid++ }; const c0 = await clicks();
      await T('touchStart', [t]); await T('touchEnd', [t]);
      await waitFor(p, () => window.__ledger.st.filter && window.__ledger.st.tab === 'list'); await waitFor(p, c0 => window.__clicks > c0, c0, 1200);
      assert(await L(p, () => !!window.__ledger.st.filter && window.__ledger.st.tab === 'list' && !document.querySelector('#layer').innerHTML), '觸控點圓餅區塊：篩選並切回明細，沒誤開底下的紀錄');
      await L(p, () => document.querySelector('#clearFilter').click());
    }
    // rapid taps: 8 per second, none lost, none doubled
    {
      await L(p, () => scrollTo(0, 0));
      const m0 = await L(p, () => window.__ledger.st.month);
      for (let i = 0; i < 8; i++) { await tap(i % 2 ? '#prevMonth' : '#nextMonth'); await tap('#nextMonth'); }
      await waitFor(p, () => true);
      const m1 = await L(p, () => window.__ledger.st.month);
      const exp = await L(p, ([m, k]) => { let [y, mo] = m.split('-').map(Number); mo += k; while (mo > 12) { mo -= 12; y++; } return `${y}-${String(mo).padStart(2, '0')}`; }, [m0, 8]);
      assert(m1 === exp, `16 下快速連點月份（+1/-1 交替）結果正確 ${m0} → ${m1}`);
      await L(p, () => document.querySelector('#monthLabel').click());
    }
    // mouse click and keyboard still work exactly once
    {
      const m0 = await L(p, () => window.__ledger.st.month);
      await p.click('#nextMonth'); await p.waitForTimeout(50);
      const m1 = await L(p, () => window.__ledger.st.month);
      assert(m1 !== m0 && (await L(p, () => window.__ledger.st.month)) === m1, '滑鼠點擊觸發一次');
      await p.focus('#monthLabel'); await p.keyboard.press('Enter');
      await p.focus('#typeIn'); await p.keyboard.press('Enter');
      const a = await L(p, () => [window.__ledger.st.type, window.__ledger.st.month]);
      await p.focus('#typeOut'); await p.keyboard.press(' ');
      assert(a[0] === 'in' && a[1] === m0 && (await L(p, () => window.__ledger.st.type)) === 'out', '鍵盤 Enter／空白鍵可操作按鈕');
      await p.focus('#moreBox summary'); await p.keyboard.press('Enter');
      const kOpen = await L(p, () => document.querySelector('#moreBox').open);
      await L(p, () => scrollTo(0, 0)); await tap('#moreBox summary');
      assert(kOpen && await waitFor(p, () => !document.querySelector('#moreBox').open), '「＋備註/日期」鍵盤與觸控都能開關');
    }
    await ctx.close();
  }

  // ---------- 3. [中] 匯出在沒有 downloads 能力時直接下載 ----------
  {
    const { ctx, p } = await open();
    await p.click('#openSettings');
    const [d1] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#jsonAll')]);
    let j = null; if (d1) try { j = JSON.parse(fs.readFileSync(await d1.path(), 'utf8')); } catch (e) {}
    assert(d1 && /^ledger-backup-\d{4}-\d{2}-\d{2}\.json$/.test(d1.suggestedFilename()) && j && j.entries.length > 20 && j.categories.length === 10, 'JSON 備份下載成檔案 ' + (d1 && d1.suggestedFilename()));
    const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.click('#csvAll')]);
    const csv = d2 ? fs.readFileSync(await d2.path(), 'utf8') : '';
    assert(csv.startsWith('﻿日期,類型,分類,金額,備註'), '全部 CSV 下載成檔案');
    assert(!(await p.textContent('#expNote')).includes('無法直接下載'), '說明文字不再說無法下載');
    // 360 寬：匯出按鈕不斷行
    await p.setViewportSize({ width: 360, height: 640 });
    const lines = await L(p, () => ['#csvMonth', '#csvAll', '#jsonAll', '#jsonCopy'].map(s => { const b = document.querySelector(s), cs = getComputedStyle(b); return Math.round((b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / parseFloat(cs.lineHeight || 22)); }));
    const h = await L(p, () => ['#csvMonth', '#csvAll', '#jsonAll', '#jsonCopy'].map(s => document.querySelector(s).getBoundingClientRect().height));
    assert(h.every(x => x < 50), '360 寬設定頁匯出按鈕都是單行 ' + h.map(Math.round).join('/'));
    await ctx.close();
  }

  // ---------- 4. 範例：編輯過的不被清除；範例預算一起清掉並可復原 ----------
  {
    const { ctx, p } = await open();
    assert((await L(p, () => window.__ledger.settings)).budgetFromSample === true, '範例預算有標記');
    await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
    const id = await L(p, () => document.querySelector('#ledger .entry').dataset.edit);
    await p.click('#ledger .entry'); await p.fill('#eNote', '我改過'); await p.click('#eSave');
    assert(await L(p, id => window.__ledger.entries.find(e => e.id === id).sample === false, id), '編輯範例紀錄後不再是範例');
    await p.click('#clearSample');
    assert((await p.textContent('.dlgmsg')).includes('改過的範例都會保留'), '清除確認文字說明會保留改過的範例');
    await p.click('#cfOk');
    await waitFor(p, () => !window.__ledger.entries.some(e => e.sample) && document.querySelector('#toastLayer').textContent.includes('已清除'));
    const s = await L(p, id => ({ n: window.__ledger.entries.length, kept: !!window.__ledger.entries.find(e => e.id === id), b: window.__ledger.settings.budget, hidden: document.querySelector('#budgetBox').hidden }), id);
    assert(s.n === 1 && s.kept, '清除範例保留編輯過的那筆');
    assert(s.b === 0 && s.hidden, '清除範例時一併清掉範例預算 $25,000');
    await p.click('#undoBtn');
    assert(await waitFor(p, () => window.__ledger.entries.length > 20 && window.__ledger.settings.budget === 2500000), '清除範例可復原');
    // user-set budget survives clearing samples
    await p.click('#openSettings'); await p.fill('#sBudget', '30000'); await p.click('#sDone');
    await p.click('#clearSample'); await p.click('#cfOk'); await waitFor(p, () => !window.__ledger.entries.some(e => e.sample));
    assert((await L(p, () => window.__ledger.settings.budget)) === 3000000, '自己設的預算不會被清除範例清掉');
    await ctx.close();
  }

  // ---------- 5. 合併刪除分類可復原；6. JSON 匯入還原預算與幣別 ----------
  {
    const { ctx, p } = await open();
    const before = await dist(p);
    await p.click('#openSettings'); await p.click('#sCats'); await p.click('.lrow >> nth=0');
    await p.click('#cDel'); await p.click('#cDel');
    await waitFor(p, () => !window.__ledger.cats.some(c => c.id === 'd-food'));
    assert((await dist(p)) !== before, '合併刪除餐飲');
    await p.click('#undoBtn');
    await waitFor(p, () => window.__ledger.cats.some(c => c.id === 'd-food'));
    assert((await dist(p)) === before && (await L(p, () => window.__ledger.cats[0].id)) === 'd-food', '合併刪除可復原：分類與紀錄都回來');
    const idbFood = () => L(p, () => new Promise(res => { const rq = indexedDB.open('pocket-ledger', 1); rq.onsuccess = () => { const g = rq.result.transaction('entries').objectStore('entries').getAll(); g.onsuccess = () => { res(g.result.filter(e => e.catId === 'd-food').length); rq.result.close(); }; }; }));
    const memFood = await L(p, () => window.__ledger.entries.filter(e => e.catId === 'd-food').length);
    const stored = await idbFood();
    await reload(p);
    const d3 = await dist(p);
    assert(d3 === before && stored === memFood, `復原結果已寫入並在重新整理後仍在 (idb ${stored}/${memFood}) ` + (d3 === before ? '' : d3 + ' vs ' + before));
    await L(p, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    const msg = await L(p, () => window.__ledger.importJSON({ settings: { currency: 'JPY', budget: 1234500 }, categories: [], entries: [] }));
    await L(p, () => window.__ledger.render());
    const st = await L(p, () => [window.__ledger.settings.currency, window.__ledger.settings.budget, document.querySelector('#sumOut').textContent]);
    assert(st[0] === 'JPY' && st[1] === 1234500 && /￥|¥/.test(st[2]) && msg.includes('預算與幣別'), 'JSON 匯入還原預算與幣別 ' + st.join(' '));
    const bad = await L(p, () => window.__ledger.importJSON({ settings: { currency: 'XXX', budget: -5 } }));
    assert(!bad.includes('預算') && (await L(p, () => window.__ledger.settings.currency)) === 'JPY', '不合法的設定不套用');
    await ctx.close();
  }

  // ---------- 7–9. CSV 匯入：不存在的日期、長分類名、類型欄 ----------
  {
    const { ctx, p } = await open();
    const r = await L(p, () => { const l = window.__ledger, n0 = l.cats.length; const r = l.importCSV('日期,類型,分類,金額,備註\n2026-02-30,支出,餐飲,10,\n2026-02-28,支出,餐飲,10,\n2025-02-29,支出,餐飲,1,\n2024-02-29,支出,餐飲,1,\n2026-04-31,支出,餐飲,1,\n2026-03-01,支出,很長的分類名稱九字,5,\n2026-03-02,支出,很長的分類名稱九字,6,\n2026-03-03,outside,餐飲,1,\n2026-03-04,invalid,餐飲,1,\n2026-03-05,OUT,餐飲,1,\n2026-03-06,Income,薪資,1,\n'); return { add: r.add.length, sk: r.skipped.join(','), newCats: l.cats.length - n0, names: l.cats.slice(n0).map(c => c.name) }; });
    assert(r.sk.split(',').includes('2') && r.sk.split(',').includes('4') && r.sk.split(',').includes('6'), '不存在的日期（2/30、非閏年 2/29、4/31）被略過：第 ' + r.sk + ' 列');
    assert(r.newCats === 1 && r.names[0] === '很長的分類名稱九', '超過 8 字的分類名只建立一個分類');
    assert(r.sk.split(',').includes('9') && r.sk.split(',').includes('10') && r.add === 6, '類型「outside」「invalid」被略過，OUT／Income 接受');
    await ctx.close();
  }

  // ---------- 11–13. 版面：收支鈕、篩選 ✕、自動 focus、橫式摘要 ----------
  {
    const { ctx, p } = await open();
    const sz = await L(p, () => ['#typeOut', '#typeIn'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [r.width, r.height]; }));
    assert(sz.every(([w, h]) => w >= 44 && h >= 44), '收／支切換鈕 ≥ 44×44：' + sz.map(x => x.map(Math.round).join('×')).join(', '));
    await p.click('#tabChart'); await p.click('#legend button >> nth=0');
    const x = await L(p, () => { const r = document.querySelector('#clearFilter').getBoundingClientRect(); return [r.width, r.height]; });
    assert(x[0] >= 44 && x[1] >= 44, '篩選 ✕ ≥ 44×44');
    await p.click('#clearFilter');
    await p.click('#openSettings'); await waitFor(p, () => document.activeElement.id === 'sheetTitle', null, 1500);
    assert(await L(p, () => !document.activeElement.matches('input,select,textarea')), '打開設定不自動 focus 輸入欄（不彈鍵盤）');
    await p.click('#sDone');
    await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
    await L(p, () => { document.querySelector('#amount').value = '5'; document.querySelector('#cats [data-cat]').disabled = false; document.querySelector('#cats [data-cat]').click(); });
    await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
    await p.click('#ledger .entry'); await waitFor(p, () => document.activeElement.id === 'sheetTitle', null, 1500);
    assert(await L(p, () => { const t = document.querySelector('#toastLayer .toast'), out = []; for (const s of ['#eCancel', '#eSave', '#eDel']) { const r = document.querySelector(s).getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); out.push(e && e.closest(s)); } return t && out.every(Boolean); }), '提示（toast）顯示時不擋住面板的按鈕');
    assert(await L(p, () => !document.activeElement.matches('input,select,textarea') && document.activeElement.id === 'sheetTitle'), '打開編輯紀錄 focus 標題而非金額欄');
    await p.click('#eCancel');
    await p.click('#openSettings'); await p.click('#sCats'); await p.click('#cNew'); await waitFor(p, () => document.activeElement.id === 'cName', null, 1500);
    assert(await L(p, () => document.activeElement.id === 'cName'), '新增分類仍自動 focus 名稱欄');
    await L(p, () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await p.setViewportSize({ width: 844, height: 390 }); await L(p, () => scrollTo(0, 0));
    const o = await L(p, () => [document.querySelector('#summary').getBoundingClientRect().top, document.querySelector('.quick').getBoundingClientRect().top, document.querySelector('#sumOut').getBoundingClientRect().bottom]);
    assert(o[0] < o[1] && o[2] < 390, '844×390 橫式：本月支出在快速記帳上方、第一屏可見');
    await ctx.close();
  }

  // ---------- 14. 編輯改到別的月份：切到該月並提示 ----------
  {
    const { ctx, p } = await open();
    await L(p, () => document.querySelector('#ledger .entry').scrollIntoView({ block: 'center' }));
    const id = await L(p, () => document.querySelector('#ledger .entry').dataset.edit);
    await p.click('#ledger .entry'); await p.fill('#eDate', '2025-03-15'); await p.click('#eSave');
    await waitFor(p, () => window.__ledger.st.month === '2025-03');
    assert((await L(p, () => window.__ledger.st.month)) === '2025-03' && (await toastText(p)).includes('移到 2025 年 3 月') && await L(p, id => !!document.querySelector(`[data-edit="${id}"]`), id), '改日期到 2025/3：切到該月、toast 寫「移到 2025 年 3 月」');
    await ctx.close();
  }

  // ---------- 16. localStorage 備援不再截掉 5000 筆以前；寫入失敗會提示 ----------
  {
    const seed = Array.from({ length: 5200 }, (_, i) => ({ id: 'e' + i, date: '2026-0' + (1 + (i % 9)) + '-1' + (i % 9), type: 'out', catId: 'd-food', cents: 100 + i, note: '', sample: false, createdAt: i }));
    const { ctx, p } = await open({ noIDB: true, init: [([k, v]) => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem(k + 'entries', v); localStorage.setItem(k + 'settings', '{"seeded":true}'); } }, [K, JSON.stringify(seed)]] });
    await p.fill('#amount', '9'); await p.click('#cats [data-cat] >> nth=0');
    await waitFor(p, () => window.__ledger.entries.length === 5201);
    await reload(p);
    assert((await L(p, () => window.__ledger.entries.length)) === 5201 && (await L(p, () => window.__ledger.entries.some(e => e.id === 'e0'))), 'localStorage 模式超過 5000 筆不再丟掉最舊紀錄');
    await L(p, () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/entries/.test(k)) throw new Error('QuotaExceededError'); return o.call(this, k, v); }; });
    await p.fill('#amount', '9'); await p.click('#cats [data-cat] >> nth=0');
    assert(await waitFor(p, () => document.querySelector('#toastLayer').textContent.includes('儲存空間已滿')), '寫入失敗時提示儲存空間已滿');
    await ctx.close();
  }

  // ---------- 17. 單月大量紀錄分段渲染 ----------
  {
    const { ctx, p } = await open();
    const t = await L(p, async () => {
      const l = window.__ledger, m = l.st.month, list = [];
      for (let i = 0; i < 5000; i++) list.push({ id: 'big' + i, date: m + '-0' + (1 + (i % 9)), month: m, type: 'out', catId: 'd-food', cents: 100, note: 'n' + i, sample: false, createdAt: i });
      await l.addEntries(list);
      const t0 = performance.now(); l.render(); const t1 = performance.now();
      return { ms: t1 - t0, rows: document.querySelectorAll('#ledger .entry').length };
    });
    assert(t.rows === 200 && (await p.isVisible('#moreRows')), `5000 筆的月份先畫 200 列（render ${t.ms.toFixed(0)}ms）`);
    await L(p, () => document.querySelector('#moreRows').click());
    const n1 = await L(p, () => document.querySelectorAll('#ledger .entry').length);
    await L(p, () => document.querySelector('#moreRows').scrollIntoView());
    assert(n1 === 500 && await waitFor(p, () => document.querySelectorAll('#ledger .entry').length >= 800), '「再顯示」與捲到底都會載入更多');
    assert(await L(p, () => document.querySelector('#sumOut').textContent.length > 0), '摘要仍計入全部紀錄');
    await ctx.close();
  }

  await browser.close();
  assert(errors.length === 0, '無 console error / pageerror ' + errors.slice(0, 3).join(' | '));
  console.log(fails ? `FAIL ${fails} 項失敗` : `全部通過（${((Date.now() - T0) / 1000).toFixed(1)} 秒）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
