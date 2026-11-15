// 輪班行事曆：上架重審 r1 toFix 的回歸測試（node tests.js，約 40 秒）。
// 觸控用真正的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指）；時間用 Playwright clock 固定在 2026-11-15。
// 透過本機 http 伺服器開啟（file:// 的 localStorage 在重新整理、多分頁之間不可靠）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = path.resolve(__dirname, '../index.html');
const K = 'shift-calendar:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const T0 = Date.now();
const S5 = [{ id: 'e', name: '早班', short: '早', color: '#22814a', start: '07:00', end: '15:00', brk: 0 }, { id: 'o', name: '休假', short: '休', color: '#6e747e', start: '', end: '', brk: 0 }];
// 很寬的字型（CI 的字型比本機寬）：確認標題在 360 寬也不會被按鈕蓋住
const WIDE = '*{font-family:"DejaVu Sans Mono","Noto Sans Mono",monospace !important} #ym{letter-spacing:.12em !important}';

(async () => {
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();

  async function open(o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', timezoneId: 'Asia/Taipei', locale: 'zh-TW', acceptDownloads: true, reducedMotion: 'reduce' });
    if (o.seed) await ctx.addInitScript(([k, v]) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.setItem(k + 'data', v); }, [K, o.seed]);
    if (o.css) await ctx.addInitScript(css => {
      const add = () => { if (!document.documentElement) return false; const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st); return true; };
      if (!add()) { const mo = new MutationObserver(() => { if (add()) mo.disconnect(); }); mo.observe(document, { childList: true }); }
    }, o.css);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date('2026-11-15T12:00:00+08:00') });
    await p.goto(URL); await p.waitForFunction(() => window.__sc); await p.clock.resume();
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1 })) });
    const center = sel => p.$eval(sel, e => { e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); await p.waitForTimeout(hold); await T('touchEnd', []); };
    const tap = async (sel, hold) => tapAt(await center(sel), hold);
    const d0 = (x, y) => p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window, clientX: x, clientY: y })); return e ? (e.id || e.tagName) : null; }, [x, y]);
    const d0sel = sel => p.$eval(sel, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, view: window })));
    const wait = (fn, arg, ms = 3000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
    return { ctx, p, T, tap, tapAt, center, d0, d0sel, wait };
  }
  const ym = p => p.textContent('#ym');
  const seqLen = p => p.evaluate(() => document.querySelectorAll('#seq button').length);
  const settle = p => p.waitForTimeout(120); // 點按由 pointerup 觸發，不必等防重複視窗；只讓畫面穩定
  const quiet = p => p.waitForTimeout(850); // 讓上一次點按的 800ms 防重複視窗過去（測單獨的 detail 0 click 用）

  // ---------- 1. [否決] 另一指放著時點按照常動作（含日期格、對話框、設定動態按鈕、原生欄位） ----------
  {
    const o = await open(); const { p, T } = o;
    const wk = await o.center('#wk'), restAt = [wk[0], wk[1], 1]; // 星期列，不是按鈕
    const q = await o.center('#next');
    await T('touchStart', [restAt]); await p.waitForTimeout(200);
    await T('touchStart', [restAt, [q[0], q[1], 2]]); await p.waitForTimeout(50); await T('touchEnd', [[q[0], q[1], 2]]);
    assert(await o.wait(() => document.getElementById('ym').textContent.includes('12 月')), '另一指放著時點下個月 → 12 月');
    await T('touchEnd', [restAt]); await p.waitForTimeout(150);
    eq(await ym(p), '2026 年 12 月', '放開那根放著的手指不會再動作');
    // 放在日期格上不動，另一指點下個月：放開日期格那指時畫面已換過，不會打開日期
    await settle(p);
    const c = await o.center('.cell:nth-child(20)');
    await T('touchStart', [[c[0], c[1], 1]]); await p.waitForTimeout(200);
    await T('touchStart', [[c[0], c[1], 1], [q[0], q[1], 2]]); await p.waitForTimeout(50); await T('touchEnd', [[q[0], q[1], 2]]);
    await o.wait(() => document.getElementById('ym').textContent.includes('2027'));
    await T('touchEnd', [[c[0], c[1], 1]]); await p.waitForTimeout(200);
    assert(!(await p.evaluate(() => document.getElementById('dayDlg').open)), '放在舊日期格上的手指放開時不會打開日期面板');
    // 日期格 + 對話框按鈕 + 原生備註欄
    await settle(p); await o.tap('#today'); await settle(p);
    const cell = await o.center('.cell[data-ds="2026-11-18"]');
    await T('touchStart', [restAt]); await p.waitForTimeout(200); await T('touchStart', [restAt, [cell[0], cell[1], 2]]); await p.waitForTimeout(40); await T('touchEnd', [[cell[0], cell[1], 2]]);
    assert(await o.wait(() => document.getElementById('dayDlg').open), '另一指放著時點日期格 → 打開日期面板');
    const pk = await o.center('#pick-m'); await p.waitForTimeout(60);
    await T('touchStart', [restAt, [pk[0], pk[1], 3]]); await p.waitForTimeout(40); await T('touchEnd', [[pk[0], pk[1], 3]]);
    assert(await o.wait(() => document.getElementById('pick-m').getAttribute('aria-pressed') === 'true'), '另一指放著時點「中」班 → 選取');
    const nt = await o.center('#dayNote');
    await T('touchStart', [restAt, [nt[0], nt[1], 4]]); await p.waitForTimeout(40); await T('touchEnd', [[nt[0], nt[1], 4]]);
    assert(await o.wait(() => document.activeElement && document.activeElement.id === 'dayNote'), '另一指放著時點備註欄 → 備註欄拿到焦點');
    const sv = await o.center('#daySave');
    await T('touchStart', [restAt, [sv[0], sv[1], 5]]); await p.waitForTimeout(40); await T('touchEnd', [[sv[0], sv[1], 5]]);
    assert(await o.wait(() => !document.getElementById('dayDlg').open && window.__sc.data.overrides['2026-11-18'] && window.__sc.data.overrides['2026-11-18'].shiftId === 'm'), '另一指放著時點儲存 → 存檔並關閉');
    await T('touchEnd', [restAt]);
    // 設定裡動態產生的按鈕
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    const n0 = await seqLen(p), ad = await o.center('#add-e'), rs2 = [30, 830, 1];
    await T('touchStart', [rs2]); await p.waitForTimeout(200); await T('touchStart', [rs2, [ad[0], ad[1], 2]]); await p.waitForTimeout(40); await T('touchEnd', [[ad[0], ad[1], 2]]);
    assert(await o.wait(n => document.querySelectorAll('#seq button').length === n + 1, n0), '另一指放著時點「＋早」→ 序列加 1 格');
    await T('touchEnd', [rs2]);
    // 單點、0.6 秒、1 秒按住都只執行一次
    for (const hold of [40, 600, 1000]) {
      await settle(p); const n = await seqLen(p); await o.tap('#add-e', hold); await p.waitForTimeout(150);
      eq(await seqLen(p) - n, 1, `按住 ${hold}ms 的「＋早」只加 1 格`);
    }
    await o.ctx.close();
  }

  // ---------- 1b. [否決 r2] 兩指點按時間重疊：兩下都算（第二指晚 50ms 按下，兩種放開順序） ----------
  {
    const o = await open(); const { p, T } = o;
    await p.evaluate(() => { window.__go = 0; new MutationObserver(() => window.__go++).observe(document.getElementById('ym'), { childList: true, characterData: true, subtree: true }); });
    const overlap = async (a, b, order) => {
      const A = await o.center(a), B0 = await o.center(b), B = a === b ? [B0[0] + 6, B0[1] + 4] : B0;
      await T('touchStart', [[A[0], A[1], 1]]); await p.waitForTimeout(50);
      await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await p.waitForTimeout(50);
      if (order === 'A') { await T('touchEnd', [[A[0], A[1], 1]]); await p.waitForTimeout(50); await T('touchEnd', [[B[0], B[1], 2]]); }
      else { await T('touchEnd', [[B[0], B[1], 2]]); await p.waitForTimeout(50); await T('touchEnd', [[A[0], A[1], 1]]); }
      await p.waitForTimeout(150);
    };
    const go = () => p.evaluate(() => { const g = window.__go; window.__go = 0; return g; });
    const closeAll = () => p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close()));
    for (const order of ['A', 'B']) {
      const tag = order === 'A' ? '先放第一指' : '先放第二指';
      await overlap('#next', '#prev', order); eq([await go(), await ym(p)], [2, '2026 年 11 月'], `${tag}：下個月＋上個月 → 換兩次月（回到 11 月）`);
      await overlap('#next', '#next', order); eq([await go(), await ym(p)], [2, '2027 年 1 月'], `${tag}：下個月＋下個月 → 前進兩個月`);
      await overlap('#prev', '#today', order); eq([await go(), await ym(p)], [2, order === 'A' ? '2026 年 11 月' : '2026 年 10 月'], `${tag}：上個月＋今天 → 兩下都依放開順序執行`);
      await overlap('#next', '#exportBtn', order); eq([await go(), await p.evaluate(() => document.getElementById('expDlg').open)], [1, true], `${tag}：下個月＋匯出 → 換月並打開匯出`);
      await closeAll(); await o.tap('#today'); await settle(p); await go();
      await overlap('#next', '#openSettings', order); eq([await go(), await p.evaluate(() => document.getElementById('setDlg').open)], [1, true], `${tag}：下個月＋設定 → 換月並打開設定`);
      await settle(p);
      let s0 = await p.evaluate(() => window.__sc.draft.rules[0].sequence.join(''));
      await overlap('#add-e', '#add-l', order);
      eq(await p.evaluate(() => window.__sc.draft.rules[0].sequence.join('')), s0 + (order === 'A' ? 'el' : 'le'), `${tag}：設定裡 ＋早＋晚 → 兩個都加入`);
      s0 = await p.evaluate(() => window.__sc.draft.rules[0].sequence.join(''));
      await overlap('#seq button', '#add-l', order);
      eq(await p.evaluate(() => window.__sc.draft.rules[0].sequence.join('')), s0.slice(1) + 'l', `${tag}：移除序列第 1 天＋＋晚 → 兩個都執行`);
      await closeAll(); await o.tap('#today'); await settle(p); await go();
    }
    // 早按很多（≥120ms）還按著的手指才算放著：放開時不動作
    const A = await o.center('#next'), B = await o.center('#prev');
    await T('touchStart', [[A[0], A[1], 1]]); await p.waitForTimeout(250); await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await p.waitForTimeout(40);
    await T('touchEnd', [[B[0], B[1], 2]]); await p.waitForTimeout(60); await T('touchEnd', [[A[0], A[1], 1]]); await p.waitForTimeout(150);
    eq([await go(), await ym(p)], [1, '2026 年 10 月'], '放著 250ms 的手指上有另一指點按：只算那一下');
    // 只早 80ms 按下、但另一指點完後 300ms 才放開：也是放著的手指
    await T('touchStart', [[A[0], A[1], 1]]); await p.waitForTimeout(80); await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await p.waitForTimeout(60);
    await T('touchEnd', [[B[0], B[1], 2]]); await p.waitForTimeout(300); await T('touchEnd', [[A[0], A[1], 1]]); await p.waitForTimeout(150);
    eq([await go(), await ym(p)], [1, '2026 年 9 月'], '早 80ms 按下、另一指點完 300ms 後才放開的手指不動作');
    await o.ctx.close();
  }

  // ---------- 1d. [否決 r3] 重疊時日期格不在新月曆也要打開；序列格依「按下的那一項」移除 ----------
  {
    const o = await open(); const { p, T } = o;
    const ovl = async (a, b, order) => {
      const A = await o.center(a), B = await o.center(b);
      await T('touchStart', [[A[0], A[1], 1]]); await p.waitForTimeout(50);
      await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await p.waitForTimeout(50);
      if (order === 'A') { await T('touchEnd', [[A[0], A[1], 1]]); await p.waitForTimeout(50); await T('touchEnd', [[B[0], B[1], 2]]); }
      else { await T('touchEnd', [[B[0], B[1], 2]]); await p.waitForTimeout(50); await T('touchEnd', [[A[0], A[1], 1]]); }
      await p.waitForTimeout(150);
    };
    const dayState = () => p.evaluate(() => [document.getElementById('ym').textContent, document.getElementById('dayDlg').open, document.getElementById('dayTitle').textContent.replace(/\s/g, '')]);
    const reset = async () => { await p.evaluate(() => document.querySelectorAll('dialog[open]').forEach(d => d.close())); await o.tap('#today'); await settle(p); };
    await ovl('#next', '.cell[data-ds="2026-11-14"]', 'A');
    eq(await dayState(), ['2026 年 12 月', true, '11月14日（六）2026-11-14'], '下個月＋11/14（先放下個月）→ 換到 12 月，11/14 的面板照樣打開');
    await reset();
    await ovl('.cell[data-ds="2026-11-18"]', '#next', 'B');
    eq(await dayState(), ['2026 年 12 月', true, '11月18日（三）2026-11-18'], '11/18＋下個月（先放下個月）→ 換到 12 月，11/18 的面板照樣打開');
    await reset();
    await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    for (const order of ['A', 'B']) for (const [a, b] of [['#seqi-1', '#seqi-3'], ['#seqi-3', '#seqi-1']]) {
      await o.tap('#seq-clear'); for (const k of ['e', 'm', 'l', 'n', 'o']) await o.tap('#add-' + k); await settle(p);
      const before = await p.evaluate(() => [...document.querySelectorAll('#seq button')].map(x => x.textContent).join(''));
      await ovl(a, b, order);
      eq([before, await p.evaluate(() => [...document.querySelectorAll('#seq button')].map(x => x.textContent).join(''))], ['早中晚夜休', '早晚休'], `序列 早中晚夜休，重疊點 ${a}＋${b}（${order === 'A' ? '先放第一指' : '先放第二指'}）→ 早晚休`);
    }
    await o.ctx.close();
  }

  // ---------- 1c. 360 寬班別時間欄、首次使用引導、跳到指定月份 ----------
  {
    const o = await open({ w: 360, h: 640 }); const { p } = o;
    assert(await p.isVisible('#startSetup'), '範例資料時顯示「設定我的班表」');
    await o.tap('#startSetup'); await o.wait(() => document.getElementById('setDlg').open);
    eq(await p.evaluate(() => [document.querySelector('.tabs [aria-selected=true]').id, !!document.getElementById('setupSteps'), !!document.getElementById('tpl-0'), !!document.getElementById('rule-from')]), ['tab-rule', true, true, true], '直接進循環規則：有三步說明、範本、起始日');
    await settle(p); await o.tap('#tab-shift'); await p.waitForTimeout(100);
    const t = await p.evaluate(() => { const a = document.getElementById('sh-start-0').getBoundingClientRect(), b = document.getElementById('sh-end-0').getBoundingClientRect(), k = document.getElementById('sh-brk-0').getBoundingClientRect(); return [Math.round(a.width), Math.round(b.width), Math.abs(a.top - b.top), k.right]; });
    assert(t[0] >= 140 && t[1] >= 140 && t[2] < 1 && t[3] <= 344, `360 寬：上班／下班欄 ${t[0]}／${t[1]}px 寬且同一高度，休息欄在下一行`);
    await settle(p); await o.tap('#tpl-1').catch(() => {}); await o.tap('#tab-rule'); await settle(p); await o.tap('#tpl-1'); await settle(p); await o.tap('#setSave');
    await o.wait(() => !document.getElementById('setDlg').open);
    assert(await o.wait(() => document.getElementById('intro').hidden), '儲存自己的設定後引導消失');
    await settle(p); await o.tap('#ymBtn'); await o.wait(() => document.getElementById('monDlg').open); await settle(p);
    await o.tap('#monNextY'); await settle(p); await o.tap('#mon-3');
    assert(await o.wait(() => !document.getElementById('monDlg').open && document.getElementById('ym').textContent.replace(/\s/g, '') === '2027年3月'), '點標題 → 選 2027 年 3 月 → 跳過去');
    await o.ctx.close();
  }

  // ---------- 2. [否決] 點按後補送的 detail 0 click 不會重複執行，也不會點到新畫面 ----------
  {
    const o = await open(); const { p } = o;
    const q = await o.center('#next');
    await o.tap('#next'); await p.waitForTimeout(20);
    await o.d0sel('#next'); const b = await p.$eval('#next', e => { const r = e.getBoundingClientRect(); return [r.right - 1, r.bottom - 1]; });
    await o.d0(b[0], b[1]); await o.d0(q[0], q[1]); await p.waitForTimeout(150);
    eq(await ym(p), '2026 年 12 月', '點下個月後再送 3 個 detail 0 click（本身、邊緣點、elementFromPoint）→ 只前進一個月');
    await quiet(p);
    await o.d0sel('#next'); await p.waitForTimeout(100);
    eq(await ym(p), '2027 年 1 月', '沒有點按在前的單獨 detail 0 click（鍵盤／輔助科技）照常執行一次');
    await o.tap('#today'); await settle(p);
    // 點日期格打開面板後，原位置的 detail 0 click 不會點到面板裡的東西或關掉它
    const c = await o.center('.cell[data-ds="2026-11-30"]');
    await o.tapAt(c); await p.waitForTimeout(20); const hit = await o.d0(c[0], c[1]); await p.waitForTimeout(150);
    const st = await p.evaluate(() => ({ open: document.getElementById('dayDlg').open, pick: (document.querySelector('#dayPick [aria-pressed=true]') || {}).id }));
    assert(st.open && st.pick !== undefined, `點日期格後 detail 0 click（落在 ${hit}）不會關掉面板或改選班別`);
    await o.tap('#dayDlg [data-close]'); await settle(p);
    // 設定：＋早 與 點序列格移除
    await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    let n = await seqLen(p); await o.tap('#add-e'); await p.waitForTimeout(20); await o.d0sel('#add-e'); const a = await o.center('#add-e'); await o.d0(a[0], a[1]); await p.waitForTimeout(120);
    eq(await seqLen(p) - n, 1, '「＋早」點一下 + detail 0 click → 只加 1 格');
    await settle(p); n = await seqLen(p); const sq = await o.center('#seq button');
    await o.tap('#seq button'); await p.waitForTimeout(20); await o.d0(sq[0], sq[1]); await p.waitForTimeout(120);
    eq(n - await seqLen(p), 1, '點序列格移除 + detail 0 click → 只移除 1 格');
    // 鍵盤：Enter 照常
    await settle(p); n = await seqLen(p); await p.focus('#add-e'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
    eq(await seqLen(p) - n, 1, '鍵盤 Enter 在「＋早」上 → 加 1 格');
    await o.ctx.close();
  }

  // ---------- 3. [否決] 規則全部無效的資料：設定照常開，沒有 page error ----------
  for (const [name, d] of [['rules:[]', { shifts: S5, rules: [] }], ['壞日期', { shifts: S5, rules: [{ from: '2026-02-30', type: 'cycle', sequence: ['e'] }] }], ['不存在的班別', { shifts: S5, rules: [{ from: '2026-01-01', type: 'cycle', sequence: ['zz'] }], people: [{ on: true, rules: [] }] }]]) {
    const e0 = errors.length;
    const o = await open({ seed: JSON.stringify(d) }); const { p } = o;
    await o.tap('#openSettings');
    assert(await o.wait(() => document.getElementById('setDlg').open && document.getElementById('rule-from')), `${name}：設定可以打開並顯示規則編輯`);
    eq(await p.evaluate(() => window.__sc.data.rules.length), 1, `${name}：補上一條有效規則`);
    eq(errors.length - e0, 0, `${name}：沒有 page error`);
    await o.ctx.close();
  }
  eq(await (async () => { const o = await open(); const r = await o.p.evaluate(() => { const s = window.__sc.sanitize({ shifts: [{ id: 'e', short: 'E', start: 'abc', end: '99:99' }], rules: [{ from: '2026-01-01', type: 'cycle', sequence: ['e'] }] }); return [s.shifts[0].start, window.__sc.hoursOf({ start: 'abc', end: '08:00' }), window.__sc.hoursOf({ start: '07:00', end: '15:00', brk: 'x' })]; }); await o.ctx.close(); return r; })(), ['', 0, 8], '壞的上下班時間當成休假（0 h），不會出現非數值');

  // ---------- 4. [否決] 兩個分頁各自改班不互相覆寫 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Taipei' });
    const A = await open({ ctx }), B = await open({ ctx });
    const setDay = async (o, ds) => { await settle(o.p); await o.tap(`.cell[data-ds="${ds}"]`); await o.wait(() => document.getElementById('dayDlg').open); await settle(o.p); await o.tap('#pick-m'); await settle(o.p); await o.tap('#daySave'); await o.wait(() => !document.getElementById('dayDlg').open); };
    await setDay(A, '2026-11-25');
    await setDay(B, '2026-11-26');
    const C = await open({ ctx });
    eq(await C.p.evaluate(() => ['2026-11-25', '2026-11-26'].map(d => (window.__sc.data.overrides[d] || {}).shiftId)), ['m', 'm'], '分頁 A 改 11/25、分頁 B 改 11/26 → 重新開啟兩天都在');
    assert(await A.wait(() => document.querySelector('.cell[data-ds="2026-11-26"] .ov')), '分頁 A 收到 storage 事件後也顯示 B 改的 11/26');
    // 設定開著時另一分頁改班，存設定不會蓋掉
    await settle(A.p); await A.tap('#openSettings'); await A.wait(() => document.getElementById('setDlg').open);
    await setDay(B, '2026-11-27');
    await settle(A.p); await A.tap('#tab-gen'); await A.p.fill('#gen-name', '多分頁'); await settle(A.p); await A.tap('#setSave');
    await A.wait(() => !document.getElementById('setDlg').open);
    eq(await A.p.evaluate(() => [window.__sc.data.name, Object.keys(window.__sc.data.overrides).filter(k => k >= '2026-11-25').sort()]), ['多分頁', ['2026-11-25', '2026-11-26', '2026-11-27']], '設定存檔時保留另一分頁剛改的 11/27');
    await ctx.close();
  }

  // ---------- 5. [否決] 360 寬：標題不被按鈕蓋住（寬字型）、班別時間列不超出 ----------
  for (const [w, h] of [[360, 640], [320, 568]]) {
    const o = await open({ w, h, css: WIDE }); const { p } = o;
    await p.evaluate(() => { const d = window.__sc.data; d.people[0].on = true; }); await settle(p); await o.tap('#next'); await p.waitForTimeout(100); await o.tap('#prev'); await p.waitForTimeout(100);
    const r = await p.evaluate(() => { const y = document.getElementById('ym'), yb = y.getBoundingClientRect(), nb = document.getElementById('next').getBoundingClientRect(), pb = document.getElementById('prev').getBoundingClientRect(), t = document.getElementById('title');
      return { fits: y.scrollWidth <= y.clientWidth + 0.5, inside: yb.left >= pb.right - 0.5 && yb.right <= nb.left + 0.5, h1: t.scrollWidth <= t.clientWidth + 0.5, txt: y.textContent, sw: document.documentElement.scrollWidth }; });
    assert(r.fits && r.inside && r.h1 && /11\s*月$/.test(r.txt), `${w} 寬＋寬字型：標題「${r.txt}」完整、在上下月按鈕之間`);
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p); await o.tap('#tab-shift'); await p.waitForTimeout(150);
    const s = await p.evaluate(() => { const b = document.getElementById('setBody'); return { over: b.scrollWidth - b.clientWidth, right: Math.max(...[...b.querySelectorAll('input,button')].map(e => e.getBoundingClientRect().right)) }; });
    assert(s.over <= 0 && s.right <= w + 0.5, `${w} 寬＋寬字型：設定→班別沒有東西超出畫面（最右 ${Math.round(s.right)}px）`);
    await o.ctx.close();
  }

  // ---------- 6. 備份匯出／匯入；恢復規則班可復原 ----------
  {
    const o = await open(); const { p } = o;
    await settle(p); await o.tap('.cell[data-ds="2026-11-20"]'); await o.wait(() => document.getElementById('dayDlg').open); await settle(p);
    await o.tap('#pick-n'); await p.fill('#dayNote', '換班 😀'); await settle(p); await o.tap('#daySave'); await o.wait(() => !document.getElementById('dayDlg').open);
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p); await o.tap('#tab-gen'); await settle(p);
    const [dlv] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), o.tap('#backup-export')]);
    let backup = null; if (dlv) { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-')), 'b.json'); await dlv.saveAs(f); backup = fs.readFileSync(f, 'utf8'); }
    assert(backup && JSON.parse(backup).data.overrides['2026-11-20'].note === '換班 😀', '匯出備份（JSON）含改班與備註');
    // 換成別的資料再匯入
    await p.evaluate(() => { localStorage.clear(); }); await p.reload(); await p.waitForFunction(() => window.__sc);
    assert(!(await p.evaluate(() => window.__sc.data.overrides['2026-11-20'])), '清掉資料後 11/20 不在');
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p); await o.tap('#tab-gen');
    await p.setInputFiles('#impFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(backup || '{}') });
    assert(await o.wait(() => document.getElementById('cfmDlg').open), '匯入前先確認');
    await settle(p); await o.tap('#cfmYes');
    assert(await o.wait(() => (window.__sc.data.overrides['2026-11-20'] || {}).note === '換班 😀' && !document.getElementById('setDlg').open), '匯入備份後 11/20 的改班與備註回來了');
    await p.setInputFiles('#impFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    assert(await o.wait(() => /不是班表備份/.test(document.body.textContent)), '壞檔不匯入並說明');
    // 恢復規則班 → 復原
    await settle(p); await o.tap('.cell[data-ds="2026-11-20"]'); await o.wait(() => document.getElementById('dayDlg').open); await settle(p);
    await o.tap('#dayRestore'); await o.wait(() => !document.getElementById('dayDlg').open);
    assert(!(await p.evaluate(() => window.__sc.data.overrides['2026-11-20'])), '恢復規則班後 11/20 的改班移除');
    await o.wait(() => document.querySelector('.toast .tbtn')); await settle(p); await o.tap('.toast .tbtn');
    assert(await o.wait(() => (window.__sc.data.overrides['2026-11-20'] || {}).note === '換班 😀'), '按 toast 的「復原」→ 改班與備註回來');
    await o.ctx.close();
  }

  // ---------- 7. 未儲存的修改：設定關閉先確認；日期備註留成草稿 ----------
  {
    const o = await open(); const { p } = o;
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    await o.tap('#tab-gen'); await p.fill('#gen-name', '未儲存'); await settle(p);
    await o.tap('#setDlg .dh [data-close]');
    assert(await o.wait(() => document.getElementById('cfmDlg').open && document.getElementById('setDlg').open), '設定改過後按 ✕ → 先問要不要放棄');
    await settle(p); await o.tap('#cfmDlg [data-close]'); await p.waitForTimeout(150);
    assert(await p.evaluate(() => document.getElementById('setDlg').open && window.__sc.draft.name === '未儲存'), '選取消 → 設定還開著，修改還在');
    await settle(p); await o.tap('#setDlg .ffoot [data-close]'); await o.wait(() => document.getElementById('cfmDlg').open); await settle(p); await o.tap('#cfmYes');
    assert(await o.wait(() => !document.getElementById('setDlg').open), '選放棄修改 → 關閉');
    eq(await p.evaluate(() => window.__sc.data.name), '我的班表', '放棄後名稱沒變');
    await settle(p); await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p); await o.tap('#setDlg .dh [data-close]');
    assert(await o.wait(() => !document.getElementById('setDlg').open && !document.getElementById('cfmDlg').open), '沒有修改時 ✕ 直接關閉');
    // 日期備註
    await settle(p); await o.tap('.cell[data-ds="2026-11-21"]'); await o.wait(() => document.getElementById('dayDlg').open); await settle(p);
    await p.fill('#dayNote', '還沒存的備註'); await settle(p); await o.tap('#dayDlg [data-close]');
    assert(await o.wait(() => !document.getElementById('dayDlg').open && /草稿/.test((document.querySelector('.toast') || {}).textContent || '')), '關閉時提示備註已留成草稿');
    await p.reload(); await p.waitForFunction(() => window.__sc); await settle(p);
    await o.tap('.cell[data-ds="2026-11-21"]'); await o.wait(() => document.getElementById('dayDlg').open);
    eq(await p.evaluate(() => [document.getElementById('dayNote').value, document.getElementById('dayDraftHint').hidden]), ['還沒存的備註', false], '重新整理後打開同一天，草稿帶回來並標示');
    await settle(p); await o.tap('#daySave'); await o.wait(() => !document.getElementById('dayDlg').open);
    eq(await p.evaluate(() => [window.__sc.data.overrides['2026-11-21'].note, JSON.parse(localStorage.getItem('shift-calendar:v1:dayDrafts'))['2026-11-21'] || null]), ['還沒存的備註', null], '儲存後備註存入、草稿清掉');
    // 每天各自的草稿：兩天都打字不互相覆蓋；舊版單一草稿 dayDraft 也會載入
    for (const [ds, t] of [['2026-11-22', '甲'], ['2026-11-23', '乙']]) { await o.tap(`.cell[data-ds="${ds}"]`); await o.wait(() => document.getElementById('dayDlg').open); await settle(p); await p.fill('#dayNote', t); await o.tap('#dayDlg [data-close]'); await o.wait(() => !document.getElementById('dayDlg').open); await settle(p); }
    await p.evaluate(() => localStorage.setItem('shift-calendar:v1:dayDraft', JSON.stringify({ ds: '2026-11-24', note: '舊版', pick: 'e' })));
    await p.reload(); await p.waitForFunction(() => window.__sc); await settle(p);
    const got = [];
    for (const ds of ['2026-11-22', '2026-11-23', '2026-11-24']) { await o.tap(`.cell[data-ds="${ds}"]`); await o.wait(() => document.getElementById('dayDlg').open); got.push(await p.inputValue('#dayNote')); await o.tap('#dayDlg [data-close]'); await o.wait(() => !document.getElementById('dayDlg').open); await settle(p); }
    eq(got, ['甲', '乙', '舊版'], '兩天的備註草稿各自保留，舊版草稿也帶回來');
    await o.ctx.close();
  }

  // ---------- 8. 觸控打開對話框：關閉鈕沒有 focus 外框；鍵盤打開才有 ----------
  {
    const o = await open(); const { p } = o;
    await o.tap('.cell[data-ds="2026-11-18"]'); await o.wait(() => document.getElementById('dayDlg').open); await p.waitForTimeout(100);
    eq(await p.evaluate(() => [document.activeElement.id, document.querySelector('#dayDlg [data-close]').matches(':focus-visible')]), ['dayTitle', false], '觸控打開日期面板：焦點在標題，關閉鈕沒有外框');
    await settle(p); await o.tap('#dayDlg [data-close]'); await settle(p);
    await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await p.waitForTimeout(100);
    assert(await p.evaluate(() => [...document.querySelectorAll(':focus-visible')].every(e => getComputedStyle(e).outlineStyle === 'none')), '觸控打開設定：沒有元素顯示 focus 外框');
    await p.keyboard.press('Escape'); await o.wait(() => !document.getElementById('setDlg').open);
    await p.focus('#openSettings'); await p.keyboard.press('Enter'); await o.wait(() => document.getElementById('setDlg').open); await p.waitForTimeout(100);
    assert(await p.evaluate(() => document.activeElement.matches('[data-close]') && document.activeElement.matches(':focus-visible')), '鍵盤打開設定：關閉鈕拿焦點並顯示外框');
    await o.ctx.close();
  }

  // ---------- 9. 第二成員規則起始日重複要擋 ----------
  {
    const o = await open(); const { p } = o;
    await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    await o.tap('#tab-p2'); await settle(p); await o.tap('label.switch'); await o.wait(() => document.getElementById('p2-seg-add')); await settle(p);
    await o.tap('#p2-seg-add'); await p.waitForTimeout(100);
    await p.$eval('#p2-rule-from', e => { e.value = '2026-10-05'; e.dispatchEvent(new Event('change')); });
    await settle(p); await o.tap('#setSave'); await p.waitForTimeout(150);
    assert(await p.evaluate(() => document.getElementById('setDlg').open && /起始日相同/.test(document.getElementById('setErr').textContent)), '第二成員兩段規則起始日相同 → 擋下並說明');
    await o.ctx.close();
  }

  // ---------- 10. 細節：序列按鈕 44px、toast 不疊、深色外框對比、844×390 版面 ----------
  {
    const o = await open({ dark: true }); const { p } = o;
    await o.tap('#openSettings'); await o.wait(() => document.getElementById('setDlg').open); await settle(p);
    const sz = await p.evaluate(() => [...document.querySelectorAll('#seq button')].map(b => Math.min(b.offsetWidth, b.offsetHeight)));
    assert(sz.length && Math.min(...sz) >= 44, `序列編輯按鈕至少 44px（${Math.min(...sz)}）`);
    await p.keyboard.press('Escape'); await o.wait(() => !document.getElementById('setDlg').open);
    for (let i = 0; i < 4; i++) { await settle(p); await o.tap('.cell[data-ds="2026-11-1' + i + '"]'); await o.wait(() => document.getElementById('dayDlg').open); await settle(p); await o.tap('#daySave'); await o.wait(() => !document.getElementById('dayDlg').open); }
    eq(await p.evaluate(() => document.querySelectorAll('.toast').length), 1, '連續操作只顯示一則 toast');
    await p.evaluate(() => { window.__sc.data.people[0].on = true; }); await settle(p); await o.tap('#today'); await p.waitForTimeout(100);
    const cr = await p.evaluate(() => {
      const lum = c => { const v = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : Math.pow((x + .055) / 1.055, 2.4); }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
      const toRgb = c => { const x = document.createElement('i'); x.style.color = c; document.body.append(x); const r = getComputedStyle(x).color; x.remove(); if (r.startsWith('rgb')) return r; const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = r; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
      const ch = document.querySelector('.chip.p2'), cs = getComputedStyle(ch), paper = getComputedStyle(document.querySelector('.cal')).backgroundColor;
      return [ratio(toRgb(cs.borderTopColor), paper), ratio(toRgb(cs.color), toRgb(cs.backgroundColor))];
    });
    assert(cr[0] >= 3 && cr[1] >= 4.5, `深色模式第二成員外框對比 ${cr[0].toFixed(1)}、文字對比 ${cr[1].toFixed(1)}`);
    await o.ctx.close();
    const L = await open({ w: 844, h: 390 });
    const r = await L.p.evaluate(() => { const g = document.getElementById('grid').getBoundingClientRect(), s = document.querySelector('#side .stats'); const sb = s && s.getBoundingClientRect(); return { gridBottom: g.bottom, side: !!(sb && sb.width > 0 && sb.top < innerHeight), tot: document.getElementById('totHours2').getBoundingClientRect().bottom, sw: document.documentElement.scrollWidth, vh: innerHeight }; });
    assert(r.gridBottom <= r.vh + 0.5 && r.side && r.tot <= r.vh && r.sw <= 844, `844×390：整個月曆（底 ${Math.round(r.gridBottom)}px）和側邊統計都在第一屏`);
    await L.ctx.close();
  }

  assert(!errors.length, '沒有 page error / console error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(fails ? `${fails} 項失敗` : `全部通過（${Math.round((Date.now() - T0) / 1000)} 秒）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
