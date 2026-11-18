// 時間戳轉換：上架評分 r1 toFix 的回歸測試（node tests.js，約 30 秒）
// 觸控用真正的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的手指）；頁面用本機 http 伺服器載入，重新整理後 localStorage 仍在。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));
const K = 'timestamp:v1:';

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  async function open({ w = 390, h = 844, tz = 'Asia/Taipei', init } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: tz, locale: 'zh-TW' });
    if (init) await ctx.addInitScript(init);
    // count copies (clipboard stub) on every load
    await ctx.addInitScript(() => { window.__copies = []; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copies.push(t); return Promise.resolve(); } } }); } catch (e) {} });
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__tsReady);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const show = sel => p.$eval(sel, e => { const r = e.getBoundingClientRect(); if (r.top < 80 || r.bottom > innerHeight - 100) e.scrollIntoView({ block: 'center' }); });
    const tap = async (sel, hold = 40) => { await show(sel); const c = await center(sel); await T('touchStart', [[c[0], c[1], 1]]); await W(hold); await T('touchEnd', [[c[0], c[1], 1]]); };
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.__tsReady); };
    return { ctx, p, T, center, show, tap, reload };
  }
  const zonesOf = p => p.evaluate(() => window.__ts.zones());
  const copies = p => p.evaluate(() => window.__copies.length);

  // ---------- 1. 按鈕在 pointerup 依 pointerId 觸發：另一指放著、兩指重疊 ----------
  {
    const t = await open(), { p, T } = t;
    const rest = [200, 30, 9];
    const withRest = async sel => { await t.show(sel); const q = await t.center(sel); await T('touchStart', [rest]); await W(150); await T('touchStart', [rest, [q[0], q[1], 1]]); await W(50); await T('touchEnd', [[q[0], q[1], 1]]); await W(80); await T('touchEnd', [rest]); await W(120); };
    await p.evaluate(() => scrollTo(0, 0));
    await withRest('#livePause');
    eq(await p.$eval('#livePause', e => e.textContent), '繼續', '另一指放在標題列：點「暫停」有作用');
    await withRest('#livePause');
    const c0 = await copies(p); await withRest('#liveCopy');
    eq(await copies(p) - c0, 1, '另一指放著：點目前秒數複製一次');
    await withRest('#tsNow');
    assert(Math.abs(+(await p.$eval('#tsIn', e => e.value)) - Date.now() / 1000) < 5, '另一指放著：點「現在」有作用');
    await withRest('#zoneAddBtn');
    assert((await zonesOf(p)).includes('Europe/Paris'), '另一指放著：「＋ 加入」有作用');
    const c1 = await copies(p); await withRest('#zones li:nth-child(2) button.t');
    eq(await copies(p) - c1, 1, '另一指放著：點時區時間複製一次');
    await withRest('#zones li:last-child .del');
    assert(!(await zonesOf(p)).includes('Europe/Paris'), '另一指放著：× 有作用');
    await p.waitForTimeout(900);
    for (const order of [1, 2]) {
      await p.evaluate(() => scrollTo(0, 0)); await W(100);
      const before = await p.$eval('#livePause', e => e.textContent), cc = await copies(p);
      const a = await t.center('#livePause'), b = await t.center('#liveCopy');
      await T('touchStart', [[a[0], a[1], 1]]); await W(50); await T('touchStart', [[a[0], a[1], 1], [b[0], b[1], 2]]); await W(60);
      if (order === 1) { await T('touchEnd', [[a[0], a[1], 1]]); await W(30); await T('touchEnd', [[b[0], b[1], 2]]); }
      else { await T('touchEnd', [[b[0], b[1], 2]]); await W(30); await T('touchEnd', [[a[0], a[1], 1]]); }
      await W(150);
      assert(await p.$eval('#livePause', e => e.textContent) !== before && await copies(p) - cc === 1, `兩指 50 ms 先後點「暫停」與「目前秒數」（放開順序 ${order}）：兩個都只作用一次`);
      await p.waitForTimeout(850);
    }
    // single taps and holds
    for (const hold of [40, 600, 1000]) {
      const before = await p.$eval('#livePause', e => e.textContent);
      await t.tap('#livePause', hold); await W(100);
      assert(await p.$eval('#livePause', e => e.textContent) !== before, `點按住 ${hold} ms：暫停切換一次`);
      await W(850);
    }
    // swipe left deletes; vertical scroll on a row does not
    const z0 = await zonesOf(p);
    await t.show('#zones li:nth-child(3)');
    const s = await t.center('#zones li:nth-child(3) .city');
    await T('touchStart', [[s[0] + 60, s[1]]]); for (let i = 1; i <= 10; i++) { await T('touchMove', [[s[0] + 60, s[1] - i * 12]]); await W(16); } await T('touchEnd', [[s[0] + 60, s[1] - 120]]);
    await W(200);
    eq(await zonesOf(p), z0, '在時區列上縱向捲動不會刪除');
    await t.show('#zones li:nth-child(3)');
    const s2 = await t.center('#zones li:nth-child(3) button.t');
    await T('touchStart', [[s2[0], s2[1]]]); for (let i = 1; i <= 10; i++) { await T('touchMove', [[s2[0] - i * 14, s2[1]]]); await W(16); } await T('touchEnd', [[s2[0] - 140, s2[1]]]);
    await W(200);
    eq(await zonesOf(p), z0.filter((z, i) => i !== 2), '左滑（從時間按鈕起滑）刪除該列，且沒有順便複製');
    // 7. undo after swipe
    await t.tap('#toastUndo'); await W(150);
    eq(await zonesOf(p), z0, '左滑刪除後按「復原」放回原位置');
    await W(850);
    await t.ctx.close();
  }

  // ---------- 2. detail 0 click 重放；× 依名稱刪除 ----------
  {
    const t = await open(), { p } = t;
    await p.evaluate(() => { window.__cl = []; document.addEventListener('click', e => { const x = e.target.closest && e.target.closest('[id]'); window.__cl.push(x ? x.id : e.target.tagName); }); });
    const d0After = async sel => {
      await W(900); await p.evaluate(() => { window.__cl = []; });
      await t.show(sel); const c = await t.center(sel);
      await t.tap(sel);
      await p.waitForFunction(() => window.__cl.length > 0);
      await p.evaluate(([sel, x, y]) => {
        const fire = (el, cx, cy) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: cx, clientY: cy }));
        const el = document.querySelector(sel);
        if (el) { const r = el.getBoundingClientRect(); fire(el, x, y); fire(el, r.left + 1, r.top + 1); }
        fire(document.elementFromPoint(x, y), x, y);
      }, [sel, c[0], c[1]]);
      return p.evaluate(() => window.__cl);
    };
    eq(await d0After('#zone-del-UTC'), ['zone-del-UTC'], '× 點按後重放 detail 0 click：只有一次點擊到達');
    eq(await zonesOf(p), ['Asia/Taipei', 'Asia/Tokyo', 'America/New_York', 'Europe/London'], '點 UTC 的 × 只刪 UTC（東京還在）');
    await p.evaluate(() => scrollTo(0, 0));
    await d0After('#livePause');
    eq(await p.$eval('#livePause', e => e.textContent), '繼續', '暫停＋detail 0：只切換一次');
    const c0 = await copies(p); await d0After('#liveCopy'); await W(50);
    eq(await copies(p) - c0, 1, '複製＋detail 0：只複製一次');
    const n0 = (await zonesOf(p)).length; await d0After('#zoneAddBtn');
    eq((await zonesOf(p)).length, n0 + 1, '＋加入＋detail 0：只加入一次');
    const o0 = await p.$eval('#batch', e => e.open); await d0After('#batch summary');
    eq(await p.$eval('#batch', e => e.open), !o0, '批次轉換標題＋detail 0：只展開一次');
    // a lone detail-0 click (keyboard / screen reader) still acts once; Enter right after a tap is not swallowed
    await W(900);
    await p.evaluate(() => document.getElementById('livePause').click());
    eq(await p.$eval('#livePause', e => e.textContent), '暫停', '單獨的 detail 0 click 照常執行一次');
    await p.evaluate(() => scrollTo(0, 0)); await t.tap('#livePause'); await W(50);
    await p.focus('#livePause'); await p.keyboard.press('Enter'); await W(50);
    eq(await p.$eval('#livePause', e => e.textContent), '暫停', '點按後立刻按 Enter：鍵盤操作不會被吞');
    // tapping a button doesn't focus/raise the keyboard on the field; a focused field is blurred
    await p.focus('#tsIn'); await t.tap('#tsNow'); await W(50);
    assert(await p.evaluate(() => document.activeElement.id !== 'tsIn'), '點按鈕時輸入框失去焦點（鍵盤收起）');
    // 7. undo after ×
    const zb = await zonesOf(p);
    await W(900); await t.tap('#zone-del-Asia_2fTokyo'); await W(100);
    assert(!(await zonesOf(p)).includes('Asia/Tokyo'), '× 刪除東京');
    await t.tap('#toastUndo'); await W(100);
    eq(await zonesOf(p), zb, '按「復原」放回東京且位置不變');
    await t.ctx.close();
  }

  // ---------- 3. 保存與還原輸入 ----------
  {
    const t = await open(), { p } = t;
    await p.fill('#tsIn', '1234567890');
    await p.evaluate(() => scrollTo(0, 0));
    await p.$eval('#batch summary', e => e.scrollIntoView({ block: 'center' }));
    await t.tap('#batch summary'); await W(100);
    await p.fill('#batchIn', 'my list\n1700000000\n2024/02/29 12:00');
    await p.fill('#dtIn', '2030-01-02T03:04'); await p.fill('#dtSec', '7'); await p.selectOption('#dtZone', 'Asia/Tokyo');
    await t.tap('#zoneLiveLbl'); await W(100);
    assert(await p.$eval('#zoneLive', e => e.checked), '點「改用現在時間」勾選一次');
    await t.reload();
    const st = await p.evaluate(() => ({ ts: tsIn.value, b: batchIn.value, open: batch.open, dt: dtIn.value, sec: dtSec.value, zone: dtZone.value, live: zoneLive.checked, rows: document.querySelectorAll('#batchOut .br').length }));
    eq(st, { ts: '1234567890', b: 'my list\n1700000000\n2024/02/29 12:00', open: true, dt: '2030-01-02T03:04', sec: '7', zone: 'Asia/Tokyo', live: true, rows: 3 }, '重新整理後時間戳、批次清單與展開、日期/秒/時區、改用現在時間都還原');
    assert(/2009-02-13 23:31:30/.test(await p.$eval('#tsOut', e => e.textContent)), '還原後立即顯示 1234567890 的結果');
    await t.ctx.close();
    // old saves (unit + zones only) still load unchanged
    const o = await open({ init: () => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.clear(); localStorage.setItem('timestamp:v1:unit', '"ms"'); localStorage.setItem('timestamp:v1:zones', '["Asia/Seoul","UTC"]'); } } });
    eq([await o.p.$eval('#unit', e => e.value), await zonesOf(o.p), await o.p.$eval('#tsIn', e => e.value)], ['ms', ['Asia/Seoul', 'UTC'], '1700000000'], '舊存檔（單位與時區）照常載入');
    await o.ctx.close();
  }

  // ---------- 4. 壞存檔：__proto__ / constructor / 重複 ----------
  for (const bad of ['["__proto__"]', '["constructor"]', '["constructor","UTC","UTC","Asia/Tokyo","__proto__","toString",5,null]']) {
    const e0 = errors.length;
    const t = await open({ init: new Function(`localStorage.setItem('timestamp:v1:zones', ${JSON.stringify(bad)});`) });
    const s0 = await t.p.$eval('#liveSec', e => e.textContent); await W(1300);
    const s1 = await t.p.$eval('#liveSec', e => e.textContent);
    const z = await zonesOf(t.p);
    assert(errors.length === e0 && s1 !== s0, `壞存檔 ${bad}：沒有錯誤，時鐘在走`);
    assert(new Set(z).size === z.length && z.every(x => x !== '__proto__' && x !== 'constructor' && x !== 'toString'), `壞存檔 ${bad}：無效時區被丟掉、重複只留一個 ${JSON.stringify(z)}`);
    await t.ctx.close();
  }

  // ---------- 5–10, 12: 解析與數值（台北） ----------
  {
    const t = await open(), { p } = t;
    const P = (s, u = 'auto') => p.evaluate(([s, u]) => { const r = window.__ts.parseTs(s, u); return { err: r.err || null, why: r.why || null, ms: r.ms, dst: r.dst ? r.dst.status : null }; }, [s, u]);
    for (const s of ['2024/02/30', '2023/02/29', '2024/01/01 25:00', '2023-02-29', '2024-13-01', '2023-02-29T00:00:00Z', 'Fri, 30 Feb 2024 10:00:00 +0000', 'Feb 30 2024']) {
      const r = await P(s); assert(r.err === 'bad', `不存在的日期被擋下：${s} → ${r.why}`);
    }
    await p.fill('#tsIn', '2024/02/30');
    assert(/2024 年 2 月沒有 30 日/.test(await p.$eval('#tsOut', e => e.textContent)), '畫面顯示「2 月沒有 30 日」');
    eq((await P('2024/02/29')).ms, Date.UTC(2024, 1, 28, 16), '2024/02/29 仍然有效');
    // 6
    const a = await P('2024-05-01'), b = await P('2024/05/01'), c = await P('2024-05-01 00:00'), d = await P('2024-05-01T00:00:00');
    eq([a.ms, b.ms, c.ms, d.ms], Array(4).fill(Date.UTC(2024, 3, 30, 16)), '2024-05-01、2024/05/01、2024-05-01 00:00 都以本機時間解讀');
    eq((await P('2024-05-01T00:00:00Z')).ms, Date.UTC(2024, 4, 1), '帶 Z 的 ISO 仍是 UTC');
    eq((await P('2024-05-01T08:00:00+08:00')).ms, Date.UTC(2024, 4, 1), '帶偏移的 ISO 依偏移');
    eq((await P('Wed, 01 May 2024 08:00:00 +0800')).ms, Date.UTC(2024, 4, 1), 'RFC 2822 照常');
    // 8
    for (const s of ['May 1', 'May 1 10:00', 'Jan 5th']) { const r = await P(s); assert(r.err === 'bad' && /年份/.test(r.why || ''), `沒有年份的字串不猜：${s}`); }
    eq((await P('May 1 2024')).ms, Date.UTC(2024, 3, 30, 16), 'May 1 2024 有年份照常');
    // 9
    await p.selectOption('#unit', 's'); await p.fill('#tsIn', '8640000000000');
    const iso = await p.$eval('#ts-3', e => e.dataset.v);
    assert(!/NaN/.test(await p.$eval('#tsOut', e => e.textContent)) && iso === '+275760-09-13T08:00:00+08:00', '上限 8640000000000 秒：ISO 本地 ' + iso);
    await p.fill('#tsIn', '-8640000000000');
    assert(!/NaN/.test(await p.$eval('#tsOut', e => e.textContent)), '下限 -8640000000000 秒：沒有 NaN');
    await p.selectOption('#unit', 'auto');
    // 12: full-width digits
    await p.fill('#tsIn', '１７００００００００');
    assert(/2023-11-15 06:13:20/.test(await p.$eval('#tsOut', e => e.textContent)), '全形數字自動轉半形');
    eq((await P('２０２４／０５／０１')).ms, Date.UTC(2024, 3, 30, 16), '全形日期也可');
    // 12: seconds field
    for (const v of ['60', '-5']) {
      await p.fill('#dtSec', v);
      const txt = await p.$eval('#dtOut', e => e.textContent);
      assert(/秒必須是 0 到 59/.test(txt) && !/UTC\+/.test(txt), `秒欄 ${v}：提示而不默默改值`);
    }
    await p.fill('#dtSec', '30'); assert(!/秒必須/.test(await p.$eval('#dtOut', e => e.textContent)), '秒欄 30 正常');
    // 12: relative copy uses the value on screen
    await p.fill('#tsIn', String(Math.floor(Date.now() / 1000) - 3));
    const first = await p.$eval('#tsOut [data-rel]', e => e.textContent);
    await p.waitForFunction(f => document.querySelector('#tsOut [data-rel]').textContent !== f, first);
    const shown = await p.$eval('#tsOut [data-rel]', e => e.textContent);
    await W(900); await t.tap('#tsOut [data-rel]'); await W(100);
    const last = await p.evaluate(() => window.__copies[window.__copies.length - 1]);
    const shownNow = await p.$eval('#tsOut [data-rel]', e => e.textContent);
    assert(last !== first && (last === shownNow || last === shown), `相對時間複製畫面上的值（不是一開始的 ${first}）：${last} / ${shownNow}`);
    await t.ctx.close();
  }

  // ---------- 10. 時間戳欄的 DST 提示（紐約） ----------
  {
    const t = await open({ tz: 'America/New_York' }), { p } = t;
    await p.fill('#tsIn', '2024/03/10 02:30');
    let txt = await p.$eval('#tsOut', e => e.textContent);
    assert(/不存在/.test(txt) && /2024-03-10 03:30:00/.test(txt), '紐約 2024/03/10 02:30：提示不存在並順延到 03:30');
    await p.fill('#tsIn', '2024/11/03 01:30');
    txt = await p.$eval('#tsOut', e => e.textContent);
    assert(/出現兩次/.test(txt) && /1730615400/.test(txt), '紐約 2024/11/03 01:30：提示重複並給較晚者');
    await p.fill('#tsIn', '2024-05-01');
    eq(await p.evaluate(() => window.__ts.parseTs('2024-05-01', 'auto').ms), Date.UTC(2024, 4, 1, 4), '紐約：2024-05-01 為本機午夜');
    await t.ctx.close();
  }

  // ---------- 11, 12: 窄螢幕版面（批次、時區名稱、ISO 斷行）與批次 debounce ----------
  for (const w of [360, 390]) {
    const t = await open({ w, h: w === 360 ? 640 : 844, init: () => { localStorage.setItem('timestamp:v1:zones', '["Asia/Taipei","America/Argentina/Buenos_Aires","Etc/GMT+1","Etc/GMT-1"]'); localStorage.setItem('timestamp:v1:batchOpen', 'true'); } }), { p } = t;
    await p.fill('#batchIn', '1700000000123456789\n-86400\n2024/02/29 12:00:00\nhello');
    await p.waitForFunction(() => document.querySelectorAll('#batchOut .br').length === 4);
    const lay = await p.evaluate(() => {
      const out = document.getElementById('batchOut'), ob = out.getBoundingClientRect();
      const cells = [...out.querySelectorAll('.bv')];
      return { fits: out.scrollWidth <= out.clientWidth + 1 && cells.every(c => { const r = c.getBoundingClientRect(); return r.right <= ob.right + 1 && c.scrollWidth <= c.clientWidth + 1; }), text: out.textContent, docW: document.documentElement.scrollWidth <= innerWidth };
    });
    assert(lay.fits && lay.docW && /本地時間/.test(lay.text) && /1700000000\.123456789/.test(lay.text), `${w} 寬：批次結果不必左右捲動，本地時間與秒都看得到`);
    const tz = await p.$$eval('#zones .tz', es => es.map(e => ({ t: e.textContent, ok: e.scrollWidth <= e.clientWidth + 1 })));
    assert(tz.every(x => x.ok) && tz.some(x => /America\/Argentina\/Buenos_Aires/.test(x.t)), `${w} 寬：時區列顯示完整 IANA 名稱`);
    const ids = await p.$$eval('#zones button.t', es => es.map(e => e.id));
    eq(new Set(ids).size, ids.length, `${w} 寬：Etc/GMT+1 與 Etc/GMT-1 的按鈕 id 不相撞`);
    await p.fill('#tsIn', '1700000000.123456789');
    const iso = await p.$eval('#ts-2', e => { const s = e.querySelector('.nb'); return { lines: s.getClientRects().length, w: s.textContent, fits: e.scrollWidth <= e.clientWidth + 1 }; });
    assert(iso.lines === 1 && iso.w === '2023-11-14' && iso.fits, `${w} 寬：ISO 8601 的日期部分不在連字號處斷開`);
    // debounce: one keystroke into a 10000-line list returns quickly, then the table updates once
    const big = Array.from({ length: 10000 }, (_, i) => String(1700000000 + i)).join('\n');
    await p.$eval('#batchIn', (e, v) => { e.value = v; }, big);
    const ms = await p.evaluate(() => { const t0 = performance.now(); const e = document.getElementById('batchIn'); e.value += '\n1'; e.dispatchEvent(new Event('input')); return performance.now() - t0; });
    assert(ms < 30, `10000 行：每次按鍵同步工作 ${ms.toFixed(1)} ms（已 debounce）`);
    await p.waitForFunction(() => /10001 行/.test(document.getElementById('batchMeta').textContent), null, { timeout: 5000 });
    assert(await p.$$eval('#batchOut .br', e => e.length) <= 1000, '10000 行：只畫出前 1000 行，複製包含全部');
    await t.ctx.close();
  }

  eq(errors, [], '整個過程沒有頁面錯誤');
  await browser.close(); srv.close();
  console.log(`${passes} 通過，${fails} 失敗`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
