// 倒數日看板：上架評分 9.5 重審的回歸測試（node tests.js，約 30 秒）。
// 時間用 Playwright clock 假造；觸控用真實 CDP Input.dispatchTouchEvent，等狀態不靠固定延遲。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const APP = path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const K = 'countdown-board:v1:';
const item = (o) => Object.assign({ id: 'a' + Math.random().toString(36).slice(2, 8), title: '測試', date: '2026-11-01', time: null, repeat: 'none', emoji: '🎉', bg: 'c:#4a6cf7', pinned: false, note: '', order: 0, createdAt: 1 }, o);

(async () => {
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-tests-'));

  // seed: items written before the app script runs (only on the first load of this context)
  async function open({ time = '2026-10-30T10:00:00+08:00', tz = 'Asia/Taipei', seed, settings, w = 390, h = 844, acceptDownloads = false, css = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce', timezoneId: tz, acceptDownloads });
    if (seed || settings) await ctx.addInitScript(([K, seed, settings]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      if (seed) localStorage.setItem(K + 'items', typeof seed === 'string' ? seed : JSON.stringify(seed));
      if (settings) localStorage.setItem(K + 'settings', JSON.stringify(settings));
    }, [K, seed || null, settings || null]);
    // css：在 app 載入前插入的樣式（例如換成很寬的字型，確認版面不靠本機字型）
    if (css) await ctx.addInitScript(css => {
      const add = () => { const root = document.documentElement; if (!root) return false; const st = document.createElement('style'); st.textContent = css; root.appendChild(st); return true; };
      if (!add()) { const mo = new MutationObserver(() => { if (add()) mo.disconnect(); }); mo.observe(document, { childList: true }); }
    }, css);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date(time) });
    await p.goto(URL); await p.waitForFunction(() => window.__cd);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const tap = async q => { await touch('touchStart', [q]); await touch('touchEnd', []); };
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tapSel = async sel => tap(await center(sel));
    const settle = () => p.waitForFunction(() => performance.now() >= __cd.guardUntil);
    return { ctx, p, tap, touch, center, tapSel, settle };
  }
  const tileText = (p, id) => p.$eval(`#app .tile[data-id="${id}"]`, e => e.querySelector('.lbl').textContent + ' ' + e.querySelector('.days').textContent);

  // 1. 純日期：閏年、月底、跨年、過去
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => ({
      feb29: __cd.occurrence({ date: '2024-02-29', repeat: 'yearly' }, '2026-10-30'),
      feb29leap: __cd.occurrence({ date: '2024-02-29', repeat: 'yearly' }, '2027-03-01'),
      m31: __cd.occurrence({ date: '2026-01-31', repeat: 'monthly' }, '2027-02-01'),
      m31leap: __cd.occurrence({ date: '2026-01-31', repeat: 'monthly' }, '2028-02-10'),
      dec: __cd.occurrence({ date: '2000-12-31', repeat: 'yearly' }, '2026-12-31'),
      decNext: __cd.occurrence({ date: '2000-12-31', repeat: 'yearly' }, '2027-01-01'),
      tomorrow: __cd.dayInfo({ date: '2026-10-31', repeat: 'none' }, '2026-10-30').diff,
      past: __cd.dayInfo({ date: '2026-10-20', repeat: 'none' }, '2026-10-30').num,
      nth: __cd.dayInfo({ date: '2026-10-20', repeat: 'none' }, '2026-10-30', 'nth').num,
      future: __cd.occurrence({ date: '2027-05-01', repeat: 'yearly' }, '2026-10-30')
    }));
    eq(r, { feb29: '2027-02-28', feb29leap: '2028-02-29', m31: '2027-02-28', m31leap: '2028-02-29', dec: '2026-12-31', decNext: '2027-12-31', tomorrow: 1, past: 10, nth: 11, future: '2027-05-01' },
      '閏日生日平年落在 2/28、閏年 2/29；每月 31 號落在月底；跨年；過去 N 天與第 N+1 天');
    await ctx.close();
  }

  // 2. 午夜跨日：計時器照常時翻日；睡眠（計時器沒跑、時鐘跳了）醒來立刻重算
  {
    const seed = [item({ id: 'tmr', title: '明天', date: '2026-10-31' })];
    const { ctx, p } = await open({ time: '2026-10-30T23:59:50+08:00', seed });
    eq(await tileText(p, 'tmr'), '還有 1天', '23:59:50 明天的卡片顯示還有 1 天');
    await p.clock.runFor(15000);
    await p.waitForFunction(() => document.querySelector('#app .tile[data-id="tmr"] .days').textContent === '就是今天');
    assert(true, '過午夜（計時器照常）變成就是今天');
    assert((await p.textContent('#today-line')).includes('2026/10/31'), '頂部今天日期也更新');
    // 睡眠：只改系統時間不跑計時器，再以醒來事件喚醒
    await p.clock.setSystemTime(new Date('2026-11-03T08:00:00+08:00'));
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForFunction(() => document.querySelector('#past .tile[data-id="tmr"]'));
    eq(await tileText(p, 'tmr'), '已過 3天', '睡三天醒來立刻顯示已過 3 天（從牆上時鐘重算）');
    // 每分鐘的保底檢查：沒有任何醒來事件也會在一分鐘內翻日
    await p.clock.setSystemTime(new Date('2026-11-03T23:59:30+08:00'));
    await p.clock.runFor(61000);
    eq(await tileText(p, 'tmr'), '已過 4天', '計時器被延後也在一分鐘內翻日');
    await ctx.close();
  }

  // 3. 詳情倒數：時／分／秒用實際經過的時間（夏令時間少掉的一小時要算進去），卡片的天數仍用日曆日
  {
    const seed = [item({ id: 'pst', title: '十天前', date: '2026-03-01' }), item({ id: 'fut', title: '週一早上', date: '2026-03-09', time: '09:00', order: 1 })];
    const { ctx, p, tapSel, settle } = await open({ time: '2026-03-11T00:30:00-04:00', tz: 'America/New_York', seed });
    eq(await tileText(p, 'pst'), '已過 10天', '紐約 3/11 00:30（3/8 起夏令時間）卡片已過 10 天');
    await tapSel('#app .tile[data-id="pst"]'); await p.waitForSelector('#d-clock b'); await settle();
    eq(await p.$$eval('#d-clock b', b => b.map(x => x.textContent)), ['9', '23', '30', '00'], '詳情是實際經過的 9 天 23:30:00（3/8 少了一小時），卡片仍是已過 10 天');
    await p.goBack(); await p.waitForSelector('#detail', { state: 'hidden' });
    await p.clock.setSystemTime(new Date('2026-03-07T09:00:00-05:00'));
    await p.evaluate(() => dispatchEvent(new Event('focus')));
    await p.waitForFunction(() => __cd.today === '2026-03-07'); await settle();
    await tapSel('#app .tile[data-id="fut"]'); await p.waitForSelector('#d-clock b'); await settle();
    eq(await p.$$eval('#d-clock b', b => b.map(x => x.textContent)), ['1', '23', '00', '00'], '週六 09:00 到週一 09:00（中間換夏令時間）實際只有 47 小時：1 天 23:00:00');
    await ctx.close();
  }

  // 4. 背景時停表；醒來從牆上時鐘補正；報讀器只拿到分鐘級摘要、數字不播報
  {
    const seed = [item({ id: 'x', title: '旅行', date: '2026-11-02', time: '12:00' })];
    const { ctx, p, tapSel, settle } = await open({ seed });
    await tapSel('#app .tile[data-id="x"]'); await p.waitForSelector('#d-clock b'); await settle();
    const clock = () => p.$$eval('#d-clock b', b => b.map(x => x.textContent).join(':'));
    const c0 = await clock();
    await p.clock.runFor(2000);
    assert(await clock() !== c0, '前景時每秒更新');
    const sr0 = await p.textContent('#d-sr');
    eq(sr0, '倒數：3 天 1 小時 59 分', '報讀器摘要只到分鐘');
    const live = await p.evaluate(() => [document.querySelector('#d-clock').getAttribute('aria-hidden'), document.querySelectorAll('#detail [aria-live]:not([aria-live="off"])').length]);
    eq(live, ['true', 0], '跳秒的數字 aria-hidden、詳情內沒有 live region');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    const c1 = await clock();
    await p.clock.runFor(5000);
    eq(await clock(), c1, '背景時不再每秒更新');
    await p.clock.setSystemTime(new Date('2026-11-01T11:00:00+08:00'));
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    eq(await clock(), '1:01:00:00', '回到前景立刻顯示正確剩餘時間');
    await ctx.close();
  }

  // 5. 左滑刪除＋復原、編輯＋復原、從詳情刪除＋復原
  {
    const seed = [item({ id: 'a1', title: '甲', date: '2026-11-05' }), item({ id: 'b2', title: '乙', date: '2026-11-06', order: 1 }), item({ id: 'c3', title: '丙', date: '2026-11-07', order: 2, pinned: true })];
    const { ctx, p, touch, tap, center, tapSel, settle } = await open({ seed });
    const [x, y] = await center('#app .tile[data-id="a1"]');
    await touch('touchStart', [[x + 40, y]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[x + 40 - i * 20, y]]);
    await touch('touchEnd', []);
    await p.waitForFunction(() => !document.querySelector('#app .tile[data-id="a1"]') && !document.querySelector('#toast').hidden);
    eq(await p.textContent('#toast-t'), '已刪除「甲」', '左滑刪除，提示可復原');
    await tapSel('#toast-undo');
    await p.waitForFunction(() => document.querySelector('#app .tile[data-id="a1"]'));
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('countdown-board:v1:items')).map(x => x.id).sort()), ['a1', 'b2', 'c3'], '復原後回到清單並已存檔');
    // 編輯（勾置頂會把原置頂取消）後復原：標題與置頂都回來
    await tapSel('#app .tile[data-id="b2"]'); await p.waitForSelector('#d-edit'); await settle();
    await tapSel('#d-edit'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await p.fill('#f-title', '乙改'); await p.check('#f-pinned');
    await tapSel('#f-save'); await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '已更新「乙改」');
    eq(await p.evaluate(() => __cd.items.filter(x => x.pinned).map(x => x.id)), ['b2'], '編輯後乙成為唯一置頂');
    assert(await p.isVisible('#detail') && (await p.textContent('#detail .ttl')) === '乙改', '儲存後回到已更新的詳情');
    await p.goBack(); await p.waitForSelector('#detail', { state: 'hidden' }); await settle();
    await tapSel('#toast-undo');
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '已復原');
    eq(await p.evaluate(() => [__cd.items.find(x => x.id === 'b2').title, __cd.items.filter(x => x.pinned).map(x => x.id)]), ['乙', ['c3']], '復原編輯：標題與原置頂都回來');
    // 從詳情→編輯→刪除：兩層都關、返回紀錄退乾淨、可復原
    await tapSel('#app .tile[data-id="a1"]'); await p.waitForSelector('#d-edit'); await settle();
    await tapSel('#d-edit'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await tapSel('#f-delete'); await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '已刪除「甲」');
    assert(await p.isHidden('#detail') && await p.isHidden('#sheet'), '刪除後抽屜與詳情都關閉');
    await p.waitForFunction(() => !history.state || !history.state.cdLayer);
    assert(true, '推進去的兩筆返回紀錄已退掉');
    await settle(); await tapSel('#toast-undo');
    await p.waitForFunction(() => document.querySelector('#app .tile[data-id="a1"]'));
    assert(true, '從詳情刪除也能復原');
    await ctx.close();
  }

  // 6. 返回鍵：關上層、不離開；畫面按鈕關閉不留多餘紀錄；連點不會兩個動作
  {
    const seed = [item({ id: 'k1', title: '一', date: '2026-11-05' })];
    const { ctx, p, tap, center, tapSel, settle } = await open({ seed });
    await tapSel('#app .tile[data-id="k1"]'); await p.waitForSelector('#d-edit'); await settle();
    assert(await p.evaluate(() => document.querySelector('#app').inert), '詳情開著時背景 inert');
    await tapSel('#d-edit'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await p.goBack(); await p.waitForSelector('#sheet', { state: 'hidden' });
    assert(await p.isVisible('#detail'), '返回鍵先關抽屜，詳情還在');
    await p.goBack(); await p.waitForSelector('#detail', { state: 'hidden' });
    eq(await p.evaluate(() => location.href), URL, '再返回關詳情，仍在本頁');
    await settle();
    await tapSel('#app .tile[data-id="k1"]'); await p.waitForSelector('#d-close'); await settle();
    await tapSel('#d-close'); await p.waitForSelector('#detail', { state: 'hidden' });
    await p.waitForFunction(() => !history.state || !history.state.cdLayer);
    assert(true, '按「← 返回」關閉時把歷史紀錄退掉');
    assert(await p.evaluate(() => document.activeElement && document.activeElement.dataset.id === 'k1'), '焦點回到原卡片');
    // 新增後立刻在同一點再點一下：只新增一筆、不會打開底下的卡片
    await settle(); await tapSel('#add'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await p.fill('#f-title', '新的');
    const pt = await center('#f-save');
    await tap(pt); await tap(pt);
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '已新增「新的」');
    await p.clock.runFor(500);
    eq(await p.evaluate(() => [__cd.items.length, __cd.detailId, document.querySelector('#sheet').hidden]), [2, null, true], '連點儲存只新增一筆、沒有誤開詳情');
    // iOS 只送 change 的日期選擇器
    await settle(); await tapSel('#add'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await p.evaluate(() => { const d = document.querySelector('#f-date'); d.value = '2026-12-25'; d.dispatchEvent(new Event('change')); });
    assert((await p.textContent('#preview .dt')).startsWith('2026/12/25'), '只收到 change 事件時預覽也跟著更新');
    await ctx.close();
  }

  // 7. 存檔驗證：壞資料不執行、不出錯；只留一個置頂；設定值不合法時用預設
  {
    const seed = [
      item({ id: 'ok1', title: '好的', emoji: '<img src=x onerror=window.__pwn=1>', bg: 'bogus', pinned: true, order: 'x', note: 5 }),
      item({ id: 'ok1', title: '同 id', pinned: true, order: 1 }),
      item({ id: 'bad', title: '壞時間', time: '25:00' }),
      item({ id: 'bad2', title: '', date: '2026-02-30' }), null, 5
    ];
    const { ctx, p } = await open({ seed, settings: { sort: 'weird', count: 3, pastOpen: 'no' } });
    const r = await p.evaluate(() => ({ n: __cd.items.length, pins: __cd.items.filter(x => x.pinned).length, ids: new Set(__cd.items.map(x => x.id)).size, img: document.querySelectorAll('#app img').length, pwn: !!window.__pwn, sort: document.querySelector('#sort-soon').getAttribute('aria-pressed'), cnt: document.querySelector('#count-diff').getAttribute('aria-pressed'), emoji: __cd.items[0].emoji, note: __cd.items[0].note }));
    eq(r, { n: 2, pins: 1, ids: 2, img: 0, pwn: false, sort: 'true', cnt: 'true', emoji: '📅', note: '' }, '壞項目被濾掉、圖示不注入 HTML、重複 id 重編、單一置頂、設定回預設');
    await ctx.close();
  }

  // 8. 匯出成檔案再匯入（去重、可復原）；存檔在重新整理後保留
  {
    const seed = [item({ id: 'e1', title: '匯出一', date: '2026-12-01' }), item({ id: 'e2', title: '匯出二', date: '2027-01-01', repeat: 'yearly', order: 1 })];
    const { ctx, p, tapSel, settle } = await open({ seed, acceptDownloads: true });
    const [dlEv] = await Promise.all([p.waitForEvent('download'), tapSel('#export')]);
    const file = path.join(tmp, 'backup.json'); await dlEv.saveAs(file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    eq([j.app, j.items.length], ['countdown-board', 2], '匯出下載成 JSON 檔（不是只複製到剪貼簿）');
    await p.setInputFiles('#import-file', file);
    await p.waitForFunction(() => /沒有新的項目/.test(document.querySelector('#toast-t').textContent));
    assert(true, '重複匯入全部略過');
    await ctx.close();
  }
  {
    const { ctx, p, tapSel, settle } = await open({ seed: [] });
    eq(await p.evaluate(() => __cd.items.length), 0, '存著空清單時不再出現範例');
    const file = path.join(tmp, 'backup.json');
    await p.setInputFiles('#import-file', file);
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '匯入 2 筆');
    eq(await p.evaluate(() => __cd.items.map(x => x.title + x.repeat)), ['匯出一none', '匯出二yearly'], '匯入還原內容');
    await settle(); await tapSel('#toast-undo');
    await p.waitForFunction(() => __cd.items.length === 0);
    assert(true, '匯入可復原');
    await p.setInputFiles('#import-file', file);
    await p.waitForFunction(() => __cd.items.length === 2);
    await p.reload(); await p.waitForFunction(() => window.__cd);
    eq(await p.evaluate(() => __cd.items.map(x => x.title)), ['匯出一', '匯出二'], '重新整理後資料還在');
    await ctx.close();
  }

  // 9. 對比：每種背景的字色至少 4.5:1；不到 6:1 時次要小字不半透明
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => {
      const bgs = ['#f9d64a', '#ffb38a', '#ff6b6b', '#e84a7f', '#4a6cf7', '#1f3a93', '#1aa6a0', '#3ea76a', '#c5e86c', '#8d6e63', '#2b2d33', '#e6e9ef'].map(c => 'c:' + c).concat(['g:0', 'g:1', 'g:2', 'g:3']);
      return bgs.map(bg => { const b = __cd.bgInfo(bg), fgL = b.fg === 'light' ? 0 : 1; return [bg, Math.min(...b.stops.map(s => { const l = __cd.lum(s); return (Math.max(l, fgL) + .05) / (Math.min(l, fgL) + .05); })), b.lowc]; });
    });
    const low = r.filter(x => x[1] < 4.5);
    eq(low, [], '所有背景（含漸層兩端）字色對比 ≥ 4.5');
    eq(r.filter(x => x[1] < 6 && !x[2]), [], '對比 < 6 的背景都標成 lowc');
    await ctx.close();
  }

  // 10. 短橫向螢幕：詳情的按鈕都看得到、可點
  {
    const seed = [item({ id: 'l1', title: '很長很長的中文標題會不會把畫面撐破呢再長一點點好了', date: '2030-01-01', time: '08:00', note: '備註' })];
    const { ctx, p, tapSel, settle } = await open({ seed, w: 844, h: 390 });
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    assert(sw <= 844, `橫向無水平捲動（${sw}）`);
    await tapSel('#app .tile[data-id="l1"]'); await p.waitForSelector('#d-share'); await settle();
    const ok = await p.evaluate(() => ['#d-close', '#d-edit'].every(s => { const b = document.querySelector(s).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.height >= 44; }));
    assert(ok, '橫向詳情的返回／編輯在畫面內且 ≥44px');
    await ctx.close();
  }

  // 11. r1 回歸：第二指點按、點按後的 detail 0 click、多分頁、夏令時間、不自動聚焦、橫式抽屜、字數、五位數天數
  {
    const seed = [item({ id: 'aa', title: '甲', date: '2027-03-01' }), item({ id: 'pp', title: '過去', date: '2026-01-01', order: 1 })];
    const { ctx, p, touch, tap, center, tapSel, settle } = await open({ seed });
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] })) });
    const theme = () => p.evaluate(() => document.documentElement.dataset.theme || '');
    const past = () => p.evaluate(() => !document.querySelector('#past').hidden);
    const quiet = () => p.evaluate(() => performance.now()).then(t0 => p.waitForFunction(t => performance.now() > t + 850, t0));
    // 另一指按住 (200,30)，第二指點主題、收合、卡片：各觸發一次（CDP touchEnd 只放開列出的那一指）
    const rest = [200, 30, 1];
    for (const [sel, get] of [['#theme', theme], ['#past-toggle', past]]) {
      const before = await get(), q = await center(sel);
      await T('touchStart', [rest]); await T('touchStart', [rest, [q[0], q[1], 2]]); await T('touchEnd', [[q[0], q[1], 2]]);
      await p.waitForFunction(([s, b]) => s === '#theme' ? (document.documentElement.dataset.theme || '') !== b : !document.querySelector('#past').hidden !== b, [sel, before]);
      await T('touchEnd', [rest]); await quiet();
      assert((await get()) !== before, '另一指按住時第二指點 ' + sel + ' 有作用');
    }
    { const q = await center('#app .tile[data-id="aa"]');
      await T('touchStart', [[20, 30, 1]]); await T('touchStart', [[20, 30, 1], [q[0], q[1], 2]]); await T('touchEnd', [[q[0], q[1], 2]]);
      await p.waitForFunction(() => __cd.detailId === 'aa'); await T('touchEnd', [[20, 30, 1]]);
      assert(true, '另一指按住時第二指點卡片打開詳情');
      await settle(); await tapSel('#d-close'); await p.waitForSelector('#detail', { state: 'hidden' }); await settle(); await quiet(); }
    // 點按後馬上補一個 detail 0 click（在按鈕上、按鈕邊緣、elementFromPoint）：只執行一次
    const d0 = sel => p.evaluate(sel => {
      const e = document.querySelector(sel), b = e.getBoundingClientRect(), fire = el => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
      fire(e); fire(document.elementFromPoint(b.right - 1, b.top + b.height / 2)); fire(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2));
    }, sel);
    for (const [sel, get] of [['#theme', theme], ['#past-toggle', past]]) {
      const before = await get(); await tapSel(sel); await d0(sel);
      assert((await get()) !== before, '點 ' + sel + ' 再補 3 個 detail 0 click：只切換一次');
      await quiet();
    }
    { const t0 = await theme(); await p.evaluate(() => document.querySelector('#theme').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      assert((await theme()) !== t0, '沒有點按在前、單獨的 detail 0 click 執行一次');
      const t1 = await theme(); await tapSel('#theme'); await p.keyboard.press('Enter');
      eq([await theme() === t1, await p.evaluate(() => document.activeElement.id)], [true, 'theme'], '點按後 800ms 內按 Enter 照樣有作用（點一次＋Enter 一次＝回到原樣）');
      await quiet(); }
    // 匯出：點一下＋detail 0 只下載一次
    await p.evaluate(() => { window.__dl = 0; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl++; return; } return oc.call(this); }; });
    await tapSel('#export'); await d0('#export');
    eq(await p.evaluate(() => window.__dl), 1, '匯出點一下＋detail 0 只下載一次'); await quiet();
    // 儲存（新增、編輯）：點一下＋detail 0 只存一筆，詳情不會被打開；抽屜關了之後 f-save 是空操作
    await tapSel('#add'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    await p.fill('#f-title', '新的'); await tapSel('#f-save'); await d0('#f-save');
    eq(await p.evaluate(() => [__cd.items.filter(x => x.title === '新的').length, __cd.detailId, document.querySelector('#sheet').hidden]), [1, null, true], '新增：點儲存＋detail 0 只多一筆，底下沒有東西被觸發');
    await quiet();
    await p.evaluate(() => document.querySelector('#f-save').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    eq(await p.evaluate(() => __cd.items.length), 3, '抽屜關閉後單獨的 f-save click 不做任何事');
    await tapSel('#app .tile[data-id="aa"]'); await p.waitForSelector('#d-edit'); await settle();
    await tapSel('#d-edit'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    // 不自動聚焦名稱欄（鍵盤不會自己跳出來）
    await p.clock.runFor(100);
    eq(await p.evaluate(() => document.activeElement.id), 'sheet-h', '編輯：焦點在抽屜標題，不在名稱欄');
    await p.fill('#f-title', '甲改'); await tapSel('#f-save'); await d0('#f-save');
    eq(await p.evaluate(() => __cd.items.map(x => x.title).sort()), ['新的', '甲改', '過去'].sort(), '編輯：點儲存＋detail 0 不會多出一筆');
    await settle(); await tapSel('#d-close'); await p.waitForSelector('#detail', { state: 'hidden' }); await settle(); await quiet();
    await tapSel('#add'); await p.waitForSelector('#sheet:not([hidden])'); await p.clock.runFor(100);
    eq(await p.evaluate(() => document.activeElement.id), 'sheet-h', '新增：也不自動聚焦名稱欄');
    // 名稱以字元數計：30 個表情符號可以存，第 31 個被截掉；每年 2/29 有說明
    await p.fill('#f-title', '😀'.repeat(31));
    eq([await p.evaluate(() => Array.from(document.querySelector('#f-title').value).length), await p.textContent('#f-count')], [30, '30/30'], '名稱上限 30 個字元（表情符號算 1 字）');
    await p.fill('#f-date', '2024-02-29'); await settle(); await tapSel('#rep-yearly');
    assert(/平年算在 2\/28/.test(await p.textContent('#rep-hint')) && await p.isVisible('#rep-hint'), '每年＋2/29 說明平年算 2/28');
    await tapSel('#f-save'); await p.waitForFunction(() => __cd.items.some(x => Array.from(x.title).length === 30 && x.title.startsWith('😀')));
    assert(true, '30 個表情符號的名稱存得進去');
    await ctx.close();
  }
  {
    // 清除範例：點一下＋detail 0 只清一次，復原把範例找回來
    const { ctx, p, tapSel, settle } = await open();
    const n0 = await p.evaluate(() => __cd.items.length);
    await tapSel('#clear-ex');
    await p.evaluate(() => document.querySelector('#clear-ex').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    await p.evaluate(() => performance.now()).then(t0 => p.waitForFunction(t => performance.now() > t + 400, t0));
    await tapSel('#toast-undo');
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent === '已復原');
    eq(await p.evaluate(() => __cd.items.length), n0, '清除範例＋detail 0 後復原，範例都回來');
    await ctx.close();
  }
  {
    // 夏令時間：時／分／秒是實際剩下的時間
    for (const [now, date, exp, m] of [['2027-03-13T22:00:00-05:00', '2027-03-14', ['0', '04', '00', '00'], '紐約 3/13 22:00 到 3/14 03:00 實際 4 小時'], ['2026-10-31T22:00:00-04:00', '2026-11-01', ['0', '06', '00', '00'], '紐約 10/31 22:00 到 11/1 03:00 實際 6 小時']]) {
      const { ctx, p, tapSel, settle } = await open({ time: new Date(Date.parse(now) - 5000), tz: 'America/New_York', seed: [item({ id: 'ds', date, time: '03:00' })] });
      await p.clock.pauseAt(new Date(now));
      await tapSel('#app .tile[data-id="ds"]'); await p.waitForSelector('#d-clock b');
      eq(await p.$$eval('#d-clock b', b => b.map(x => x.textContent)), exp, m);
      eq(await p.evaluate(() => /約 (\d+) 小時/.exec(document.querySelector('#d-stats').textContent)[1]), String(+exp[1]), m + '（約 N 小時）');
      await ctx.close();
    }
  }
  {
    // 兩個分頁：A 新增後關掉，再關掉較舊的 B，重新打開資料還在；B 也即時同步到 A 的變更
    const { ctx, p: A } = await open(); // 不用 seed（seed 只在每個分頁第一次載入時寫，第三個分頁會再寫一次）
    const B = await ctx.newPage(); B.on('pageerror', e => errors.push(e.message)); await B.goto(URL); await B.waitForFunction(() => window.__cd);
    await A.bringToFront(); await A.click('#add'); await A.waitForSelector('#sheet:not([hidden])');
    await A.fill('#f-title', '重要的日子'); await A.fill('#f-date', '2027-06-01');
    await A.evaluate(() => performance.now()).then(t0 => A.waitForFunction(t => performance.now() > t + 400, t0));
    await A.click('#f-save'); await A.waitForFunction(() => __cd.items.some(x => x.title === '重要的日子'));
    await B.waitForFunction(() => __cd.items.some(x => x.title === '重要的日子') && document.querySelector('#app .tile'));
    assert(true, '另一個分頁透過 storage 事件同步新項目');
    await A.close({ runBeforeUnload: true }); await B.close({ runBeforeUnload: true });
    const C = await ctx.newPage(); await C.goto(URL); await C.waitForFunction(() => window.__cd);
    assert(await C.evaluate(() => __cd.items.some(x => x.title === '重要的日子')), '關掉舊分頁不會蓋掉另一分頁存的資料');
    await ctx.close();
  }
  {
    // 844×390 抽屜：沒有預覽卡，名稱欄不被底部儲存列蓋住
    const { ctx, p, tapSel, settle } = await open({ w: 844, h: 390, seed: [] });
    await tapSel('#add'); await p.waitForSelector('#sheet:not([hidden])'); await settle();
    const r = await p.evaluate(() => { const t = document.querySelector('#f-title').getBoundingClientRect(), a = document.querySelector('.sheet-actions').getBoundingClientRect(); return [document.querySelector('#preview').offsetHeight, t.bottom <= a.top, t.top >= 0]; });
    eq(r, [0, true, true], '橫式抽屜不顯示預覽卡、名稱欄完整露出');
    await ctx.close();
  }
  // 五位數／四位數天數：「天」和數字在同一行、整組在卡片內距之內；本機字型和刻意很寬的字型（等寬＋字距）都要過
  const WIDE = '.tile .days { font-family: "DejaVu Sans Mono", "DejaVu Sans", monospace !important; letter-spacing: .08em !important; } .tile .days small { font-family: "DejaVu Sans", serif !important; font-size: 16px !important; }';
  for (const [w, css] of [[320, null], [360, null], [390, null], [430, null], [320, WIDE], [360, WIDE], [390, WIDE], [430, WIDE], [844, WIDE]]) {
    const seed = [item({ id: 'hero', title: '置頂五位數', date: '1900-01-01', pinned: true }), item({ id: 'old', title: '很久以前', date: '1901-01-01', order: 1 }), item({ id: 'k4', title: '四位數', date: '2020-01-01', order: 2 }), item({ id: 'k3', title: '三位數', date: '2026-01-01', order: 3 })];
    const { ctx, p } = await open({ w, h: w > 700 ? 390 : 844, seed, css });
    if (css) eq(await p.$eval('#app .tile .days', d => getComputedStyle(d).letterSpacing !== 'normal'), true, w + ' 寬字型樣式有套用');
    await p.evaluate(() => document.fonts.ready); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const r = await p.$$eval('#app .tile .days', ds => ds.map(d => { const s = d.querySelector('small').getBoundingClientRect(), b = d.getBoundingClientRect(), t = d.closest('.tile').getBoundingClientRect(), pr = parseFloat(getComputedStyle(d.closest('.tile')).paddingRight);
      const oneLine = s.top >= b.top - 2 && s.bottom <= b.bottom + 2, inside = s.right <= t.right - pr + 0.5 && d.scrollWidth <= d.clientWidth + 1;
      return oneLine && inside ? 'ok' : d.closest('.tile').dataset.id + ' ' + d.textContent + ' line:' + oneLine + ' in:' + inside; }));
    eq(r, ['ok', 'ok', 'ok', 'ok'], w + ' 寬' + (css ? '（很寬的字型）' : '') + '：五位數、四位數天數「天」在同一行、不超出卡片內距');
    await ctx.close();
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  await browser.close();
  eq(errors, [], '沒有頁面錯誤');
  console.log(fails ? `FAIL ${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
