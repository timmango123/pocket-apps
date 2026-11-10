// 番茄專注板：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
// 觸控一律用真的 CDP Input.dispatchTouchEvent（touchEnd 只放開它列出的觸點；空陣列＝全部放開）。
// 等條件，不用固定長睡眠；時間相關的檢查用 Playwright 假時鐘或直接設定 endAt，不用畫面幀差。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-'));
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'pomodoro-todo-v1';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [], external = [];
const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const TODAY = dayKey(new Date());
const task = (id, text, o = {}) => ({ id, text, est: 1, done: 0, ok: false, ...o });
const base = (o = {}) => ({ cfg: { focus: 25, short: 5, long: 15, every: 4, auto: false, sound: false, plant: true, noise: true }, noise: 'off', vol: 50, history: {}, forest: { day: TODAY, items: [] }, plantDead: false, leftAt: null, mode: 'focus', round: 0, remaining: 1500, endAt: null, segLen: 1500, activeId: 'a', stats: { day: TODAY, pomos: 0, mins: 0, done: 0 }, tasks: [task('a', '寫報告'), task('b', '回信'), task('c', '運動')], ...o });

(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, state, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, acceptDownloads: true, colorScheme: opt.dark ? 'dark' : 'light', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
    if (state !== undefined) await ctx.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [KEY, typeof state === 'string' ? state : JSON.stringify(state)]);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    p.on('request', q => { if (!q.url().startsWith('file:') && !/^(data|blob|about):/.test(q.url())) external.push(q.url()); });
    if (opt.clock) await p.clock.install({ time: opt.clock });
    await p.goto(URL); await p.waitForFunction(() => window.__pomo);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async (sel, i = 0) => { const l = p.locator(sel).nth(i); await l.scrollIntoViewIfNeeded(); const b = await l.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tapXY = async (c, hold = 40) => { await T('touchStart', [{ x: c.x, y: c.y, id: 1 }]); await sleep(hold); await T('touchEnd', [{ x: c.x, y: c.y, id: 1 }]); };
    const tap = async (sel, hold = 40, i = 0) => tapXY(await at(sel, i), hold);
    // finger 1 rests on `rest`, finger 2 taps `sel` and lifts while finger 1 is still down
    const tap2 = async (rest, sel) => {
      const a = await at(rest), b = await at(sel);
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(60);
      await T('touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(50);
      await T('touchEnd', [{ x: b.x, y: b.y, id: 2 }]); await sleep(60);
      await T('touchEnd', []);
    };
    // double tap: coordinates fetched once so both taps land well inside the 500 ms window
    // (one retry after the window has passed, for a heavily loaded CI machine where CDP round trips get slow)
    const dbl = async (sel, i = 0) => {
      const c = await at(sel, i);
      for (let k = 0; k < 2; k++) {
        await tapXY(c, 30); await tapXY(c, 30);
        if (await p.locator('#editSheet').isVisible()) return;
        await sleep(700);
      }
    };
    const settle = () => p.evaluate(() => new Promise(r => setTimeout(() => requestAnimationFrame(() => r()), 250))); // let any trailing click arrive
    const S = () => p.evaluate(() => JSON.parse(JSON.stringify(__pomo.S)));
    const txt = sel => p.locator(sel).first().textContent();
    return { ctx, p, T, at, tap, tapXY, tap2, dbl, settle, S, txt };
  }

  // ---- 嚴重／7：沒有對外請求（Google Fonts 已移除）----
  assert(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+https?:/i.test(SRC), '原始碼沒有 Google Fonts 或外部 <link>');

  // ---- 嚴重／3：計時中關頁、結束後重開（未點畫面）→ 只計一次、0 console error ----
  {
    const n0 = errors.length;
    const { ctx, p, S } = await open(390, 844, base({ endAt: Date.now() - 60000, remaining: 0 }));
    await p.waitForTimeout(400);
    const s = await S();
    assert(s.stats.pomos === 1 && s.stats.mins === 25 && s.mode === 'short', `關頁期間結束的番茄重開後計一次（${s.stats.pomos} 個、${s.stats.mins} 分、下一段 ${s.mode}）`);
    assert(errors.length === n0, '重開後沒有 vibrate 被擋的 console error ' + JSON.stringify(errors.slice(n0)));
    await ctx.close();
  }

  // ---- 中／3：刪除與清除已完成可復原；ghost click：刪除後下一列的 × 移到指下不會被誤觸 ----
  {
    const { ctx, p, tap, settle, S } = await open(390, 844, base({ tasks: [task('a', '寫報告'), task('b', '回信'), task('c', '運動', { ok: true, okDay: TODAY })] }));
    for (const hold of [40, 600, 1000]) {
      const before = (await S()).tasks.length;
      await tap('#list li .del', hold); await settle();
      const s = await S();
      assert(s.tasks.length === before - 1, `按住 ${hold} ms 刪除第一列：只刪一項（${before}→${s.tasks.length}）`);
      assert(await p.locator('#toastAct').isVisible(), `刪除後吐司有「復原」`);
      await tap('#toastAct', 40); await settle();
      const r = await S();
      assert(r.tasks.length === before && r.tasks.map(t => t.id).join() === 'a,b,c', `復原後回到原位（${r.tasks.map(t => t.id).join()}）`);
    }
    // two deletes in a row: 復原 twice brings both back
    await tap('#list li .del'); await settle(); await tap('#list li .del'); await settle();
    assert((await S()).tasks.length === 1, '連刪兩項');
    await tap('#toastAct'); await settle();
    assert((await S()).tasks.length === 2 && await p.locator('#toastAct').isVisible(), '第一次復原救回第二項，吐司仍可再復原');
    await tap('#toastAct'); await settle();
    assert((await S()).tasks.map(t => t.id).join() === 'a,b,c', `第二次復原救回第一項（${(await S()).tasks.map(t => t.id).join()}）`);
    await tap('#clearDone'); await settle();
    assert((await S()).tasks.length === 2, '清除已完成：移除 1 項');
    await tap('#toastAct'); await settle();
    assert((await S()).tasks.map(t => t.id).join() === 'a,b,c', '清除已完成可復原');
    await ctx.close();
  }

  // ---- 中／5：844×390 設定面板可捲到「完成」；橫式開始鈕不用捲動 ----
  {
    const { ctx, p, tap, settle } = await open(844, 390, base(), { dark: true });
    const tb = await p.evaluate(() => document.getElementById('toggle').getBoundingClientRect().bottom);
    assert(tb <= 390, `844×390 開始鈕在第一屏（bottom ${Math.round(tb)} ≤ 390）`);
    await tap('#openSettings'); await settle();
    const m = await p.evaluate(() => { const s = document.querySelector('#sheet .sheet'); return { h: s.getBoundingClientRect().height, sh: s.scrollHeight, ov: getComputedStyle(s).overflowY }; });
    assert(m.h <= 390 && m.ov === 'auto', `設定面板高 ${Math.round(m.h)} ≤ 390 且可捲動（${m.ov}）`);
    await p.evaluate(() => document.getElementById('closeSettings').scrollIntoView({ block: 'center' }));
    const vis = await p.evaluate(() => { const b = document.getElementById('closeSettings').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; });
    assert(vis, '捲動後「完成」整顆在畫面內');
    await tap('#closeSettings'); await settle();
    assert(await p.locator('#sheet').isHidden(), '點「完成」關閉設定');
    await ctx.close();
  }

  // ---- 小／1：執行中改設定，本段長度固定，結束時記實際分鐘 ----
  {
    const { ctx, p, tap, settle, S } = await open(390, 844, base({ endAt: Date.now() + 600000, remaining: 1500, segLen: 1500 }));
    await tap('#openSettings'); await settle();
    assert(await p.locator('#runNote').isVisible(), '計時中開設定：提示「新的時間長度從下一段開始生效」');
    await p.fill('#cFocus', '5'); await tap('#closeSettings'); await settle();
    const mid = await S();
    assert(mid.segLen === 1500 && mid.cfg.focus === 5, `執行中改專注 25→5：本段仍是 25 分（segLen ${mid.segLen}）`);
    await p.evaluate(() => { __pomo.S.endAt = Date.now() + 200; });  // jump to the end of this segment
    await p.waitForFunction(() => __pomo.S.stats.pomos === 1, null, { timeout: 15000 });
    const s = await S();
    assert(s.stats.mins === 25 && s.history[Object.keys(s.history)[0]].m === 25, `結束時記 25 分（記 ${s.stats.mins}）`);
    await ctx.close();
  }
  // 暫停中（已有進度）改專注長度：保留進度與本段長度，從下一段生效；還沒開始的段落直接用新長度
  {
    const { ctx, p, tap, settle, S, txt } = await open(390, 844, base({ remaining: 900, segLen: 1500 }));
    await tap('#openSettings'); await settle();
    assert(await p.locator('#runNote').isVisible(), '暫停中開設定：提示從下一段生效');
    await p.fill('#cFocus', '30'); await tap('#closeSettings'); await settle();
    const s = await S();
    assert(s.remaining === 900 && s.segLen === 1500 && await txt('#time') === '15:00' && s.cfg.focus === 30, `暫停 15:00 時改 30 分：仍是 15:00、本段 25 分（${await txt('#time')}、${s.segLen}）`);
    await tap('#reset'); await settle();
    assert(await txt('#time') === '30:00', `重設後下一段用新長度 30:00（${await txt('#time')}）`);
    await tap('#openSettings'); await settle();
    await p.fill('#cFocus', '20'); await tap('#closeSettings'); await settle();
    assert(await txt('#time') === '20:00', '還沒開始的段落直接換成新長度');
    await ctx.close();
  }

  // ---- 小／1：跨午夜不用操作也歸零；取消勾選前一天完成的任務不扣今天 ----
  {
    const { ctx, p, tap, settle, txt } = await open(390, 844, base({ stats: { day: '2026-11-08', pomos: 2, mins: 50, done: 0 }, forest: { day: '2026-11-08', items: [1, 1] }, history: { '2026-11-08': { p: 2, m: 50 } } }), { clock: new Date('2026-11-08T23:59:20+08:00') });
    await tap('#list li .chk'); await settle();
    assert(await txt('#sDone') === '1', '23:59 勾選一項：完成任務 1');
    await p.clock.runFor(70000);
    assert(await txt('#sDone') === '0' && await txt('#sPomo') === '0', `過午夜（頁面一直開著）今日統計歸零（完成 ${await txt('#sDone')}、番茄 ${await txt('#sPomo')}）`);
    await p.clock.runFor(1000);
    await tap('#list li.done .chk'); await settle();
    const s = await p.evaluate(() => __pomo.S.stats.done);
    assert(s === 0, `取消勾選昨天完成的任務，今天的完成數不變（${s}）`);
    await ctx.close();
  }

  // ---- 細節：ETA 含長休息 ----
  {
    const st = base({ tasks: [task('a', 'x', { est: 3 }), task('b', 'y', { est: 2 })] });
    const { ctx, p, txt } = await open(390, 844, st, { clock: new Date('2026-11-09T10:00:00+08:00') });
    // 25+5+25+5+25+5+25+15(長休息)+25 = 155 分 → 12:35
    assert((await txt('#eta')).includes('12:35'), `5 個番茄的完成時間含長休息：${await txt('#eta')}（應 12:35）`);
    await p.clock.runFor(61000);
    assert((await txt('#eta')).includes('12:36'), `放著不動會自動更新：${await txt('#eta')}`);
    await ctx.close();
  }

  // ---- 小／1 + 細節：設定不合法值提示範圍、拒絕小數；取消不儲存 ----
  {
    const { ctx, p, tap, settle, S } = await open(390, 844, base());
    await tap('#openSettings'); await settle();
    for (const v of ['0', '121', '-5', '', '2.5', '1e1']) {
      await p.fill('#cFocus', v).catch(() => p.evaluate(v => { document.getElementById('cFocus').value = v; }, v));
      await tap('#closeSettings'); await settle();
      const shown = await p.locator('#eFocus').isVisible(), msg = await p.locator('#eFocus').textContent();
      assert(shown && /1–120/.test(msg) && (await p.locator('#sheet').isVisible()) && (await S()).cfg.focus === 25, `專注填「${v}」：面板不關、顯示「${msg}」、設定不變`);
    }
    assert(await p.locator('#toast').isHidden(), '欄位錯誤時沒有吐司蓋住面板');
    const nh = await p.$$eval('.row input[type=number]', r => Math.min(...r.map(x => x.getBoundingClientRect().height)));
    assert(nh >= 44, `設定數字框高 ${Math.round(nh)} ≥ 44`);
    await tap('#cancelSettings'); await settle();
    await tap('#openSettings'); await settle();
    await p.fill('#cShort', '9'); await tap('#cancelSettings'); await settle();
    assert((await S()).cfg.short === 5, '改了再按「取消」不儲存');
    await tap('#openSettings'); await settle();
    await p.fill('#cShort', '9'); await p.keyboard.press('Escape'); await settle();
    assert((await S()).cfg.short === 5 && await p.locator('#sheet').isHidden(), 'Esc 關閉也不儲存');
    // checkbox rows: tap anywhere on the row toggles once; Space on the focused checkbox still works
    await tap('#openSettings'); await settle();
    const c0 = await p.isChecked('#cAuto');
    await tap('.row.tog[data-for=cAuto] label'); await settle();
    assert(await p.isChecked('#cAuto') === !c0, '點設定列文字切換核取方塊一次');
    await tap('.row.tog[data-for=cAuto]', 40); await settle();
    assert(await p.isChecked('#cAuto') === c0, '再點一次切回來');
    await p.focus('#cAuto'); await p.keyboard.press('Space');
    assert(await p.isChecked('#cAuto') === !c0, '鍵盤空白鍵切換核取方塊');
    const sz = await p.$$eval('.row.tog', r => Math.min(...r.map(x => x.getBoundingClientRect().height)));
    assert(sz >= 44, `設定核取列高 ${Math.round(sz)} ≥ 44`);
    await tap('#closeSettings'); await settle();
    assert((await S()).cfg.auto === !c0, '「完成」儲存核取方塊');
    await ctx.close();
  }

  // ---- 小／2：點兩下任務可改名與預估 ----
  {
    const { ctx, p, tap, dbl, settle, S } = await open(390, 844, base());
    await dbl('#list li .body', 1); await settle();
    assert(await p.locator('#editSheet').isVisible(), '點兩下任務名稱開啟「修改任務」');
    assert(await p.inputValue('#editText') === '回信', '編輯框帶入原名稱');
    assert(await p.evaluate(() => document.activeElement.id) === 'editText', '開啟後輸入框已聚焦，可直接打字');
    await p.fill('#editText', '回覆客戶信件'); await tap('#editPlus'); await tap('#editPlus'); await tap('#editSave'); await settle();
    const t = (await S()).tasks.find(x => x.id === 'b');
    assert(t.text === '回覆客戶信件' && t.est === 3, `儲存後名稱與預估更新（${t.text}、${t.est}）`);
    await dbl('#list li .body', 0); await settle();
    await p.fill('#editText', '  '); await tap('#editSave'); await settle();
    assert(await p.locator('#editErr').isVisible() && (await S()).tasks[0].text === '寫報告', '名稱空白不能儲存');
    await tap('#editCancel'); await settle();
    // an imported estimate above 10 survives open → save
    await p.evaluate(() => { __pomo.S.tasks[2].est = 50; });
    await dbl('#list li .body', 2); await settle(); await tap('#editPlus'); await tap('#editSave'); await settle();
    assert((await S()).tasks[2].est === 51, `預估 50 的任務編輯後是 51，不被截成 10（${(await S()).tasks[2].est}）`);
    // single taps on two different names alternate the current task and never open the editor
    await tap('#list li .body', 40, 0); await tap('#list li .body', 40, 2); await settle();
    assert((await S()).activeId === 'c' && await p.locator('#editSheet').isHidden(), '點不同任務只切換目前任務');
    await ctx.close();
  }

  // ---- 小／3：專注進行中切模式／重設／跳過可復原 ----
  {
    const { ctx, p, tap, settle, S } = await open(390, 844, base({ remaining: 900 }));
    for (const [sel, name] of [['#reset', '重設'], ['#skip', '跳過'], ['.modes button[data-mode=long]', '切到長休息']]) {
      await tap(sel); await settle();
      const mid = await S();
      assert(mid.remaining !== 900 || mid.mode !== 'focus', `${name}：進度改變`);
      assert(await p.locator('#toastAct').isVisible(), `${name}後吐司有「復原」`);
      await tap('#toastAct'); await settle();
      const s = await S();
      assert(s.mode === 'focus' && s.remaining === 900 && s.round === 0, `${name}可復原（${s.mode} ${s.remaining}s）`);
    }
    await ctx.close();
  }

  // ---- 小／3：匯出／匯入備份；壞檔不會覆蓋；匯入可復原 ----
  {
    const { ctx, p, tap, settle, S } = await open(390, 844, base());
    await tap('#openSettings'); await settle();
    const [dl] = await Promise.all([p.waitForEvent('download'), tap('#exportBtn')]);
    const file = path.join(DIR, 'backup.json'); await dl.saveAs(file);
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert(j.app === 'pomodoro-todo' && j.state.tasks.length === 3, `匯出 JSON 含 ${j.state.tasks.length} 項任務`);
    const bad = path.join(DIR, 'bad.json'); fs.writeFileSync(bad, '{"hello": 1');
    await p.setInputFiles('#importFile', bad);
    await p.waitForFunction(() => /不是/.test(document.getElementById('toastMsg').textContent), null, { timeout: 10000 }).catch(() => {});
    assert((await S()).tasks.length === 3 && /不是/.test(await p.textContent('#toastMsg')), '匯入壞檔：提示原因、資料不變');
    const other = path.join(DIR, 'other.json'); fs.writeFileSync(other, JSON.stringify({ state: { ...j.state, tasks: [task('z', '匯入的任務', { est: 'x' })] } }));
    await p.setInputFiles('#importFile', other); await p.waitForFunction(() => __pomo.S.tasks.length === 1);
    assert((await S()).tasks[0].text === '匯入的任務' && (await S()).tasks[0].est === 1, '匯入合法備份（欄位不對的值用預設）');
    await tap('#toastAct'); await settle();
    assert((await S()).tasks.length === 3, '匯入可復原');
    await ctx.close();
  }

  // ---- 小／3：儲存資料損毀不會當掉；舊版存檔照常載入（同一頁換存檔後重新整理）----
  // ---- 小／5：按鈕 ≥ 44；360 寬輸入列換行 ----
  {
    const { ctx, p, txt, S } = await open(360, 640, base({ tasks: [task('a', 'x'), task('b', 'y', { ok: true })] }));
    for (const [w, h] of [[360, 640], [390, 844]]) {
      await p.setViewportSize({ width: w, height: h });
      const small = await p.$$eval('#openSettings, .sound button, #clearDone, .est button, .side-btn, .modes button, #toggle, .del, .go', bs => bs.filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className || b.textContent, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(!small.length, `${w}×${h} 按鈕都 ≥ 44×44 ${JSON.stringify(small)}`);
      const iw = await p.$eval('#newTask', e => e.getBoundingClientRect().width);
      assert(iw >= 250, `${w} 寬任務輸入框 ${Math.round(iw)}px（換行，提示字不被切）`);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert(sw, `${w}×${h} 無水平捲動`);
    }
    const reloadWith = async v => { await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, v]); await p.reload(); await p.waitForFunction(() => window.__pomo); };
    for (const bad of ['{"cfg":{}}', JSON.stringify({ ...base(), tasks: null }), JSON.stringify({ ...base(), stats: 'x', forest: 5, history: [1], tasks: [null, 5, { text: '留下來' }] }), 'not json{', '[]', JSON.stringify({ ...base(), cfg: { focus: 'abc', every: 99 } })]) {
      const n0 = errors.length;
      await reloadWith(bad);
      const ok = errors.length === n0 && (await txt('#time')).match(/^\d\d:\d\d$/) && await p.locator('#list li').count() >= 1;
      assert(ok, `損毀資料 ${bad.slice(0, 40)}…：0 錯誤、頁面正常 ` + JSON.stringify(errors.slice(n0)));
    }
    const old = base(); delete old.segLen;
    await reloadWith(JSON.stringify(old));
    const s = await S();
    assert(s.tasks.length === 3 && s.cfg.focus === 25 && s.segLen === 1500, '舊版存檔（沒有 segLen／okDay）照常載入');
    await ctx.close();
  }

  // ---- 細節：深色主按鈕對比、重設/跳過有文字、進度 0 有番茄苗、目前任務不壓刻度 ----
  {
    const { ctx, p } = await open(390, 844, base({ tasks: [task('a', '一個很長很長很長很長很長的任務名稱')] }), { dark: true });
    const r = await p.evaluate(() => {
      const rgb = c => c.match(/[\d.]+/g).slice(0, 3).map(Number), L = c => { const v = rgb(c).map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const b = getComputedStyle(document.getElementById('toggle')), a = L(b.color), c = L(b.backgroundColor);
      return (Math.max(a, c) + .05) / (Math.min(a, c) + .05);
    });
    assert(r >= 4.5, `深色主按鈕文字對比 ${r.toFixed(2)}:1`);
    assert((await p.textContent('#reset')).includes('重設') && (await p.textContent('#skip')).includes('跳過'), '重設、跳過鈕有文字');
    const leaf = await p.evaluate(() => { const s = document.querySelector('#plant svg'); return !!s && s.querySelectorAll('.leaf').length >= 2 && getComputedStyle(s).transform === 'none'; });
    assert(leaf, '進度 0 盆栽有兩片子葉，且不跟著錶盤旋轉');
    for (const [w, h] of [[390, 844], [844, 390], [360, 640]]) {
      await p.setViewportSize({ width: w, height: h });
      const r = await p.evaluate(() => {
        const d = document.querySelector('.dial').getBoundingClientRect(), c = document.getElementById('current'), b = c.getBoundingClientRect();
        const apart = b.top >= d.bottom - 1 || b.left >= d.right - 1;
        return { apart, w: Math.round(b.width) };
      });
      assert(r.apart && r.w >= 200, `${w}×${h} 目前任務名稱在錶盤外、不壓刻度，寬 ${r.w}px`);
    }
    await ctx.close();
  }

  // ---- 細節：草稿保存；兩個分頁同步 ----
  {
    const { ctx, p } = await open(390, 844, base());
    await p.fill('#newTask', '還沒送出的字');
    await p.reload(); await p.waitForFunction(() => window.__pomo);
    assert(await p.inputValue('#newTask') === '還沒送出的字', '輸入框草稿重新整理後還在');
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errors.push(e.message));
    await p2.goto(URL); await p2.waitForFunction(() => window.__pomo);
    await p.press('#newTask', 'Enter');
    await p2.waitForFunction(() => __pomo.S.tasks.some(t => t.text === '還沒送出的字'), null, { timeout: 5000 }).catch(() => {});
    assert(await p2.evaluate(() => __pomo.S.tasks.filter(t => t.text === '還沒送出的字').length) === 1, '另一個分頁收到新增的任務（storage 同步）');
    assert(await p.evaluate(() => __pomo.S.tasks.filter(t => t.text === '還沒送出的字').length) === 1, 'Enter 新增只新增一次');
    await ctx.close();
  }

  // ---- 觸控：8 次/秒、慢按 0.6/1 s、第二指、畫面改變後的 ghost click、鍵盤 ----
  {
    const { ctx, p, T, at, tap, tap2, settle, S, txt } = await open(390, 844, base({ tasks: 'abcdef'.split('').map(c => task(c, '任務 ' + c)) }));
    // est starts at 1; 4 × + at 8/s
    const plus = await at('#estPlus');
    for (let i = 0; i < 4; i++) { await T('touchStart', [{ ...plus, id: 1 }]); await sleep(40); await T('touchEnd', [{ ...plus, id: 1 }]); await sleep(85); }
    await settle();
    assert(await txt('#estVal') === '5', `預估 + 連點 4 次（8 次/秒）→ 5（${await txt('#estVal')}）`);
    for (const hold of [600, 1000]) { await tap('#estMinus', hold); }
    await settle();
    assert(await txt('#estVal') === '3', `慢按 0.6 s、1 s 各觸發一次 → 3（${await txt('#estVal')}）`);
    await tap2('.brand', '#estMinus'); await settle();
    assert(await txt('#estVal') === '2', `另一指按住畫面時第二指點 − 有效 → 2（${await txt('#estVal')}）`);
    const before = await p.evaluate(() => __pomo.S.stats.done);
    await tap2('.brand', '#list li .chk'); await settle();
    assert(await p.evaluate(() => __pomo.S.stats.done) === before + 1, '第二指勾選任務有效且只算一次');
    // ghost: checking the first row reorders the list; the row that slides under the finger must not be toggled
    for (const hold of [40, 600, 1000]) {
      const s0 = await S(), first = s0.tasks.filter(t => !t.ok).length;
      await tap('#list li .chk', hold); await settle();
      const s1 = await S();
      assert(s1.tasks.filter(t => !t.ok).length === first - 1, `按住 ${hold} ms 勾選第一列：只勾一項（未完成 ${first}→${s1.tasks.filter(t => !t.ok).length}）`);
    }
    // ghost: 設定「完成」 closes the sheet over the timer/task card
    for (const hold of [40, 600, 1000]) {
      await tap('#openSettings'); await settle();
      const n0 = await p.evaluate(() => __pomoTaps);
      const s0 = JSON.stringify((await S()).tasks) + (await S()).endAt;
      await tap('#closeSettings', hold); await settle();
      const s1 = JSON.stringify((await S()).tasks) + (await S()).endAt;
      assert(await p.locator('#sheet').isHidden() && s0 === s1 && await p.evaluate(() => __pomoTaps) === n0 + 1, `按住 ${hold} ms 點「完成」：只關閉面板，底下不被觸發`);
    }
    // a tap that slides off its button does nothing
    const b = await at('#toggle');
    await T('touchStart', [{ ...b, id: 1 }]); await T('touchMove', [{ x: b.x, y: b.y + 120, id: 1 }]); await T('touchEnd', [{ x: b.x, y: b.y + 120, id: 1 }]); await settle();
    assert(!(await S()).endAt, '按下後滑離按鈕放開不觸發');
    // start/pause 8/s alternating, exact count
    const tg = await at('#toggle');
    for (let i = 0; i < 6; i++) { await T('touchStart', [{ ...tg, id: 1 }]); await sleep(30); await T('touchEnd', [{ ...tg, id: 1 }]); await sleep(95); }
    await settle();
    assert(!(await S()).endAt && await txt('#toggle') === '繼續', '開始/暫停連按 6 次 → 停在暫停（零遺漏零重複）');
    // keyboard
    await p.focus('#estPlus'); await p.keyboard.press('Enter'); await p.keyboard.press('Space'); await settle();
    assert(await txt('#estVal') === '4', `鍵盤 Enter/Space 啟動按鈕各一次 → 4（${await txt('#estVal')}）`);
    await p.focus('#toggle'); await p.keyboard.press('Enter'); await settle();
    assert(!!(await S()).endAt, '鍵盤 Enter 開始計時');
    await p.focus('#toggle'); await p.keyboard.press('Enter'); await settle();
    // mouse click (desktop) also works once
    await p.click('#estMinus'); await settle();
    assert(await txt('#estVal') === '3', `滑鼠點一下 − 只算一次 → 3（${await txt('#estVal')}）`);
    await ctx.close();
  }

  // ---- 否決修正：兩指重疊點兩個任務，先放開的那下重繪了列，後放開的那下仍要算 ----
  {
    const { ctx, p, T, at, settle, S } = await open(390, 844, undefined);
    const names = [];
    for (let n = 0; n < 3; n++) {
      await p.evaluate(() => { __pomo.S.activeId = 'ex1'; });
      await p.evaluate(() => document.querySelectorAll('#list .body')[0].click()); await settle();
      const A = await at('#list li.task .body', 0), B = await at('#list li.task .body', 1);
      await T('touchStart', [{ ...B, id: 1 }]); await sleep(60);
      await T('touchStart', [{ ...B, id: 1 }, { ...A, id: 2 }]); await sleep(60);
      await T('touchEnd', [{ ...B, id: 1 }]); await sleep(60);
      const mid = (await S()).activeId;
      await T('touchEnd', [{ ...A, id: 2 }]); await settle();
      names.push(mid + '->' + (await S()).activeId);
    }
    assert(names.every(x => x === 'ex2->ex1') && await p.locator('#editSheet').isHidden(), `重疊點兩個任務名稱，後放開的也算：${names.join(' ')}`);
    const checks = [];
    for (let n = 0; n < 2; n++) {
      await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForFunction(() => window.__pomo);
      const A = await at('#list li.task .chk', 0), B = await at('#list li.task .chk', 1);
      await T('touchStart', [{ ...A, id: 1 }]); await sleep(60);
      await T('touchStart', [{ ...A, id: 1 }, { ...B, id: 2 }]); await sleep(60);
      await T('touchEnd', [{ ...A, id: 1 }]); await sleep(60);
      await T('touchEnd', [{ ...B, id: 2 }]); await settle();
      checks.push((await S()).tasks.map(t => t.id + (t.ok ? '✓' : '')).join(' '));
    }
    assert(checks.every(x => x === 'ex1✓ ex2✓ ex3✓'), `重疊勾兩個圓圈，兩個都勾：${checks.join(' | ')}`);
    // 8 taps/s, each held 180 ms so consecutive fingers overlap, alternating two task names: 16 sent, 16 received
    await p.evaluate(k => localStorage.removeItem(k), KEY); await p.reload(); await p.waitForFunction(() => window.__pomo);
    const P = [await at('#list li.task .body', 0), await at('#list li.task .body', 1)];
    await p.evaluate(() => { window.__t0 = __pomoTaps; });
    const down = new Map(); let id = 10;
    const ev = [];
    for (let i = 0; i < 16; i++) { ev.push({ t: i * 125, type: 'down', i }); ev.push({ t: i * 125 + 180, type: 'up', i }); }
    ev.sort((a, b) => a.t - b.t || (a.type === 'up' ? -1 : 1));
    const start = Date.now();
    for (const e of ev) {
      const wait = start + e.t - Date.now(); if (wait > 0) await sleep(wait);
      if (e.type === 'down') down.set(e.i, { ...P[e.i % 2], id: id++ });
      const pts = [...down.values()];
      if (e.type === 'down') await T('touchStart', pts);
      else { const pt = down.get(e.i); down.delete(e.i); await T('touchEnd', [pt]); }
    }
    await settle();
    const got = await p.evaluate(() => __pomoTaps - __t0);
    assert(got === 16 && await p.locator('#editSheet').isHidden(), `8 次/秒、每下 180 ms 重疊交替點兩個任務：送 16 收 ${got}，沒有誤開編輯`);
    await ctx.close();
  }

  // ---- 細節：1000 筆任務只更新變動的列 ----
  {
    const tasks = Array.from({ length: 1000 }, (_, i) => task('t' + i, '任務 ' + i, { est: 2 }));
    const { ctx, p, tap, settle } = await open(390, 844, base({ tasks, activeId: 't0' }));
    await p.evaluate(() => { document.querySelectorAll('#list li').forEach(li => li.__keep = 1); });
    await tap('#list li .body', 40, 3); await settle();
    const kept = await p.evaluate(() => [...document.querySelectorAll('#list li')].filter(li => li.__keep).length);
    const changed = await p.evaluate(() => [...document.querySelectorAll('#list li')].filter(li => li.__keep && li.classList.contains('active')).map(li => li.dataset.id));
    assert(kept === 1000 && changed.join() === 't3' && await p.evaluate(() => __pomo.S.activeId) === 't3', `1000 筆時點任務：1000 列都沿用原節點，只改變動的列（active ${changed.join()}）`);
    // checking one row: handler + layout well under 100 ms, and only that row is moved
    const res = await p.evaluate(() => {
      const out = [];
      for (const k of [5, 6, 7]) {
        let moved = 0; const mo = new MutationObserver(() => {}); mo.observe(document.getElementById('list'), { childList: true });
        const btn = document.querySelector(`#list li[data-id="t${k}"] .chk`), t = performance.now();
        btn.click(); document.body.offsetHeight;
        const ms = performance.now() - t; mo.takeRecords().forEach(r => { moved += r.addedNodes.length; }); mo.disconnect();
        out.push({ ms, moved });
      }
      const ms = out.map(x => x.ms).sort((a, b) => a - b)[1];
      return { ms, moved: Math.max(...out.map(x => x.moved)), last: document.querySelector('#list li:last-child').dataset.id };
    });
    assert(res.ms < 100 && res.moved === 1 && res.last === 't7', `1000 筆時勾選一項（3 次中位數）${res.ms.toFixed(0)} ms，每次只移動 ${res.moved} 列`);
    await ctx.close();
  }

  assert(!external.length, '沒有任何對外請求 ' + JSON.stringify(external.slice(0, 3)));
  assert(!errors.length, '全程 0 page/console error ' + JSON.stringify(errors.slice(0, 5)));
  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`${fails ? 'FAIL' : 'PASS'} pomodoro-todo：${fails} 項失敗（${((Date.now() - t0) / 1000).toFixed(1)} s）`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.stack); process.exit(1); });
