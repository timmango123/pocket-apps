// 多功能計時器：上架評分 r1 修正的回歸測試（node tests.js，約 30 秒）。
// 觸控用真實 CDP Input.dispatchTouchEvent（touchEnd 只放開列出的手指）；等狀態不靠固定延遲。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const APP = path.resolve(__dirname, '../index.html');
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const K = 'timer-deck:v1:';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // served over http, not file://: localStorage must survive reloads
  const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(APP, 'utf8') + '</body></html>'); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();

  async function open({ seed = null, w = 390, h = 844, tag = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    if (seed) await ctx.addInitScript(([K, seed]) => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      for (const k in seed) localStorage.setItem(K + k, seed[k]);
    }, [K, seed]);
    const p = await ctx.newPage();
    const pageErr = [];
    p.on('console', m => { if (m.type() === 'error') { errors.push(tag + m.text()); pageErr.push(m.text()); } });
    p.on('pageerror', e => { errors.push(tag + e.message); pageErr.push(e.message); });
    await p.goto(URL); await p.waitForFunction(() => window.__timerDeck);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 1, radiusY: 1 })) });
    const pos = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const center = async sel => { await p.$eval(sel, e => e.scrollIntoView({ block: 'center' })); return pos(sel); };
    const settle = () => p.waitForFunction(() => performance.now() >= __timerDeck.guardUntil);
    const tapAt = async (q, hold = 40) => { await T('touchStart', [q]); if (hold) await sleep(hold); await T('touchEnd', [q]); };
    const tap = async (sel, hold) => { await settle(); return tapAt(await center(sel), hold); };
    const idOf = name => p.evaluate(n => __timerDeck.timers.find(t => t.name === n).id, name);
    const st = id => p.evaluate(id => { const t = __timerDeck.timers.find(t => t.id === id); return t ? { status: t.status, laps: t.laps.length, duration: t.duration } : null; }, id);
    return { ctx, p, T, tap, tapAt, center, pos, settle, idOf, st, pageErr };
  }

  // 1. 放在另一指時點按、兩指重疊、按住 0.6／1 秒、鍵盤：每次剛好一次
  {
    const o = await open({ tag: '[touch] ' }), { p, T } = o;
    const sw = await o.idOf('範例：簡報計時'), cd = await o.idOf('範例：煮麵');
    const lapSel = `.slot[data-id="${sw}"] [data-tap$=":lap"]`, cdPlay = `.slot[data-id="${cd}"] .play`;
    await o.tap(`.slot[data-id="${sw}"] .play`);
    await p.waitForFunction(id => __timerDeck.timers.find(t => t.id === id).status === 'running', sw);
    // resting finger at (20,830)
    let c = await o.center(lapSel);
    await T('touchStart', [[20, 830, 2]]); await sleep(150);
    for (let i = 0; i < 3; i++) { await T('touchStart', [[20, 830, 2], [c[0], c[1], 1]]); await sleep(50); await T('touchEnd', [[c[0], c[1], 1]]); await sleep(60); }
    eq((await o.st(sw)).laps, 3, '另一指放在 (20,830) 時點「計圈」3 次 → 3 圈');
    await T('touchEnd', [[20, 830, 2]]);
    // overlapping fingers, either one lifting first
    for (const first of [1, 2]) {
      const b = await o.st(sw), bc = await o.st(cd);
      await o.center(lapSel); const A = await o.pos(lapSel), B = await o.pos(cdPlay);
      await T('touchStart', [[A[0], A[1], 1]]); await sleep(50);
      await T('touchStart', [[A[0], A[1], 1], [B[0], B[1], 2]]); await sleep(60);
      if (first === 1) { await T('touchEnd', [[A[0], A[1], 1]]); await sleep(30); await T('touchEnd', [[B[0], B[1], 2]]); }
      else { await T('touchEnd', [[B[0], B[1], 2]]); await sleep(30); await T('touchEnd', [[A[0], A[1], 1]]); }
      const a = await o.st(sw), ac = await o.st(cd);
      eq([a.laps - b.laps, ac.status !== bc.status], [1, true], `兩指重疊（第 ${first} 指先放）：計圈 +1、煮麵播放切換`);
    }
    for (const hold of [600, 1000]) {
      const b = await o.st(sw); await o.tap(lapSel, hold);
      eq((await o.st(sw)).laps - b.laps, 1, `按住 ${hold} ms 計圈只算一次`);
    }
    // keyboard still works (Enter → click with detail 0 right after keydown)
    await o.settle(); await sleep(850);
    const kb = await o.st(sw);
    await p.focus(lapSel); await p.keyboard.press('Enter');
    eq((await o.st(sw)).laps - kb.laps, 1, '鍵盤 Enter 計圈一次');
    // 2. detail-0 click replay after a real tap: on X, on X's edge point and on elementFromPoint
    await sleep(850);
    const replay = (sel, where) => p.evaluate(([s, where]) => {
      const x = document.querySelector(s), r = x.getBoundingClientRect();
      const pts = { center: [r.left + r.width / 2, r.top + r.height / 2], edge: [r.left + 1, r.top + 1] };
      let tgt = x;
      if (where !== 'self') { const q = pts[where]; tgt = document.elementFromPoint(q[0], q[1]) || x; }
      tgt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }));
    }, [sel, where]);
    for (const where of ['self', 'edge', 'center']) {
      const b = await o.st(sw); await o.tap(lapSel); await sleep(80); await replay(lapSel, where);
      eq((await o.st(sw)).laps - b.laps, 1, `點「計圈」後補送 detail 0 click（${where}）→ 只 +1`);
    }
    {
      const b = await o.st(cd); await o.tap(cdPlay); await sleep(80); await replay(cdPlay, 'self');
      assert((await o.st(cd)).status !== b.status, '點播放後補送 detail 0 click → 只切換一次');
    }
    {
      const n0 = await p.evaluate(() => __timerDeck.timers.length);
      await o.tap('.chip[data-min="3"]'); await sleep(80); await replay('.chip[data-min="3"]', 'self');
      eq(await p.evaluate(() => __timerDeck.timers.length) - n0, 1, '點「3 分」後補送 detail 0 click → 只新增 1 個');
    }
    {
      // new screen: tap 新增, then a detail-0 click on whatever is now under that point must not act (scrim would close)
      const q = await o.center('#addBtn'); await o.settle(); await o.tapAt(q);
      await p.waitForFunction(() => !document.querySelector('#addScrim').hidden);
      await p.evaluate(q => { const e = document.elementFromPoint(q[0], q[1]); e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, q);
      assert(await p.evaluate(() => !document.querySelector('#addScrim').hidden), '開表單後補送的 detail 0 click 不會作用在新畫面上');
      // 5. no auto-focused number field on touch
      const ae = await p.evaluate(() => new Promise(r => setTimeout(() => r(document.activeElement.tagName), 120)));
      assert(ae !== 'INPUT', `觸控開「新增」不自動聚焦數字欄（focus: ${ae}）`);
      await o.tap('#addCancel'); await p.waitForFunction(() => document.querySelector('#addScrim').hidden);
    }
    {
      // lone detail-0 click with no tap before it acts once
      await sleep(850);
      const b = await o.st(sw);
      await p.evaluate(s => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), lapSel);
      eq((await o.st(sw)).laps - b.laps, 1, '沒有點按在前的 detail 0 click 照常執行一次');
    }
    {
      const id = await o.idOf('範例：燉湯');
      await o.tap(`.slot[data-id="${id}"] .time`);
      await p.waitForFunction(() => !document.querySelector('#addScrim').hidden);
      const ae = await p.evaluate(() => new Promise(r => setTimeout(() => r(document.activeElement.tagName), 120)));
      assert(ae !== 'INPUT' && (await p.textContent('#addTitle')) === '編輯計時器', '點時間開編輯表單也不自動聚焦數字欄');
      await o.tap('#addCancel'); await p.waitForFunction(() => document.querySelector('#addScrim').hidden);
    }
    eq(o.pageErr, [], '觸控測試沒有 page error');
    await o.ctx.close();
  }

  // 3. 壞存檔：每種都不出錯，計時器被修補或丟掉，預設範本照常
  {
    const cases = [
      ['timers', '[{"id":"a","type":"interval","status":"idle"}]', ts => ts.length === 1 && ts[0].cfg.work === 20],
      ['timers', '[{"id":"a","type":"stopwatch","status":"running","startAt":1}]', ts => ts.length === 1 && Array.isArray(ts[0].laps)],
      ['timers', '[{"id":"a","type":"stopwatch","status":"paused","pausedElapsed":5000,"laps":[null,{"split":1000,"total":1000},{"total":"x"}]}]', ts => ts[0].laps.length === 1],
      ['timers', '[{"id":"a","type":"interval","status":"idle","cfg":{"work":"a"}}]', ts => ts[0].cfg.work === 20 && ts[0].duration > 0],
      ['timers', '[{"id":"a","type":"interval","status":"running","startAt":' + Date.now() + ',"pausedElapsed":0,"cfg":{"prep":null}}]', ts => ts[0].status === 'running'],
      ['timers', '[{"id":"a","type":"countdown","status":"running","startAt":"x","pausedElapsed":null,"duration":1e308,"name":5}]', ts => ts[0].duration === 300000 && typeof ts[0].name === 'string' && ts[0].status === 'idle'],
      ['timers', '[null,1,"a",{"id":"b","type":"nope","status":"idle"},{"id":"c","type":"countdown","status":"idle","duration":60000},{"id":"c","type":"countdown","status":"idle","duration":60000}]', ts => ts.length === 2 && ts[0].id !== ts[1].id],
      ['presets', '[null,{"name":5},{"name":"ok","cfg":{"prep":0,"work":30,"rest":0,"rounds":2,"sets":1,"setRest":0}},{"name":"bad","cfg":{"work":"a"}}]', null],
    ];
    for (const [k, v, check] of cases) {
      const o = await open({ seed: { [k]: v }, tag: '[corrupt ' + k + '] ' }), { p } = o;
      await sleep(350); // a few logic ticks (100 ms each) for the running cases
      if (k === 'presets') {
        await o.tap('#addBtn'); await p.waitForFunction(() => !document.querySelector('#addScrim').hidden);
        await o.tap('#typeInterval');
        const names = await p.$$eval('#tplList .tpl > button:first-child', b => b.map(x => x.textContent));
        eq(names, ['Tabata 20/10', '30/30 × 10', 'ok'], 'presets 有 null／壞範本時「新增」照常打開，只留合法範本');
      } else {
        const ok = await p.evaluate(c => { try { return (0, eval)('(' + c + ')')(__timerDeck.timers); } catch (e) { return String(e); } }, check.toString());
        assert(ok === true, `壞計時器 ${v.slice(0, 60)} → 已修補／丟掉`);
      }
      eq(o.pageErr, [], `  沒有 page error`);
      await o.ctx.close();
    }
  }

  // 4. 連續刪兩個再復原：兩個都回來、順序不變；6. 握把、範本鈕尺寸；結束卡片圖示；全螢幕離開後焦點；手勢提示
  {
    const o = await open({ tag: '[ui] ' }), { p, T } = o;
    const order0 = await p.evaluate(() => __timerDeck.timers.map(t => t.name));
    const a = await o.idOf('範例：燉湯'), b = await o.idOf('範例：Tabata');
    await o.tap(`.slot[data-id="${a}"] .del`); await o.tap(`.slot[data-id="${b}"] .del`);
    eq(await p.evaluate(() => __timerDeck.timers.length), 2, '連刪兩個');
    await o.tap('#toastUndo');
    await p.waitForFunction(() => __timerDeck.timers.length === 4);
    eq(await p.evaluate(() => __timerDeck.timers.map(t => t.name)), order0, '按一次「復原」兩個都回來、順序不變');
    eq(await p.evaluate(() => JSON.parse(localStorage.getItem('timer-deck:v1:timers')).length), 4, '復原後已存檔');

    const grip = await p.$eval('.grip', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
    assert(grip[0] >= 44 && grip[1] >= 44, `握把 ≥ 44×44（${grip}）`);
    await o.tap('#addBtn'); await p.waitForFunction(() => !document.querySelector('#addScrim').hidden);
    await o.tap('#typeInterval');
    const tplH = await p.$$eval('#tplList button', bs => Math.min(...bs.map(x => x.getBoundingClientRect().height)));
    assert(tplH >= 44, `範本鈕高 ≥ 44（${tplH}）`);
    await o.tap('#addCancel'); await p.waitForFunction(() => document.querySelector('#addScrim').hidden);

    // fullscreen exit returns focus to the card
    const cd = await o.idOf('範例：煮麵');
    await o.tap(`.slot[data-id="${cd}"] [data-tap$=":full"]`); await p.waitForFunction(() => !document.querySelector('#fs').hidden);
    await o.tap('#fsExit'); await p.waitForFunction(() => document.querySelector('#fs').hidden);
    await sleep(150);
    eq(await p.evaluate(id => { const a = document.activeElement; return !!a.closest(`.slot[data-id="${id}"]`); }, cd), true, '離開全螢幕後焦點回到卡片（不是 body）');

    // first-use hint explains the gestures; 知道了 hides it for good
    const hint = await p.evaluate(() => { const h = document.querySelector('#hint'); return !h.hidden && /上下滑動/.test(h.textContent) && /握把/.test(h.textContent); });
    assert(hint, '首次使用提示說明 ±1 分鐘上下滑與握把拖曳');
    await o.tap('#hintOk'); await p.waitForFunction(() => document.querySelector('#hint').hidden);
    await p.reload(); await p.waitForFunction(() => window.__timerDeck);
    assert(await p.evaluate(() => document.querySelector('#hint').hidden), '按「知道了」後重新整理不再出現');

    // gestures still work: ±1 min swipe, swipe-left delete, grip reorder, chip scroll
    {
      const id = await o.idOf('範例：煮麵');
      const [x, y] = await o.center(`.slot[data-id="${id}"] .time`);
      await o.settle();
      await T('touchStart', [[x, y]]); for (let i = 1; i <= 6; i++) await T('touchMove', [[x, y - i * 10]]); await T('touchEnd', [[x, y - 60]]);
      eq([(await o.st(id)).duration, await p.evaluate(() => document.querySelector('#addScrim').hidden)], [600000, true], '時間上滑 2 格 → +2 分鐘，不開編輯表單');
    }
    {
      const names0 = await p.evaluate(() => __timerDeck.timers.map(t => t.name));
      const g = await o.center('.slot:nth-child(1) .grip'), to = await o.center('.slot:nth-child(2) .sub');
      const g2 = await o.center('.slot:nth-child(1) .grip');
      await T('touchStart', [g2]); for (let i = 1; i <= 10; i++) await T('touchMove', [[g2[0], g2[1] + (to[1] - g2[1]) * i / 10]]); await T('touchEnd', [[g2[0], to[1]]]);
      const names1 = await p.evaluate(() => __timerDeck.timers.map(t => t.name));
      eq(names1.slice(0, 2), [names0[1], names0[0]], '拖曳握把排序');
    }
    {
      const n0 = await p.evaluate(() => __timerDeck.timers.length);
      const id = await p.evaluate(() => __timerDeck.timers[0].id);
      const [x, y] = await o.center(`.slot[data-id="${id}"] .sub`);
      await T('touchStart', [[x + 60, y]]); for (let i = 1; i <= 10; i++) await T('touchMove', [[x + 60 - i * 25, y]]); await T('touchEnd', [[x + 60 - 250, y]]);
      await p.waitForFunction(n => __timerDeck.timers.length === n - 1, n0);
      assert(true, '左滑刪除');
      const [cx, cy] = await o.center('.chip[data-min="30"]');
      await T('touchStart', [[cx, cy]]); for (let i = 1; i <= 8; i++) await T('touchMove', [[cx - i * 15, cy]]); await T('touchEnd', [[cx - 120, cy]]);
      await sleep(100);
      eq(await p.evaluate(() => __timerDeck.timers.length), n0 - 1, '在快速鍵上橫向滑動不會新增');
    }
    eq(o.pageErr, [], '介面測試沒有 page error');
    await o.ctx.close();
  }

  // 6b. 結束的卡片：圓形鈕是「重新開始」不是播放；「停止」只按一次
  {
    const seed = { timers: JSON.stringify([{ id: 'd1', type: 'countdown', name: '結束了', status: 'done', startAt: Date.now() - 6000, pausedElapsed: 5000, duration: 5000, laps: [], doneAt: Date.now() - 1000, ack: false }]) };
    const o = await open({ seed, tag: '[done] ' }), { p } = o;
    const r = await p.evaluate(() => { const b = document.querySelector('.slot[data-id="d1"] .play'); return [b.getAttribute('aria-label'), !!document.querySelector('.slot[data-id="d1"] .stop-btn')]; });
    eq(r, ['重新開始', true], '結束卡片的圓形鈕顯示重新開始，下方有「停止」');
    await o.tap('.slot[data-id="d1"] .stop-btn');
    await p.waitForFunction(() => __timerDeck.timers[0].ack === true);
    eq(await o.st('d1'), { status: 'done', laps: 0, duration: 5000 }, '按「停止」只關提示，不會連帶按到下面新出現的按鈕');
    eq(o.pageErr, [], '結束卡片沒有 page error');
    await o.ctx.close();
  }

  // 舊的存檔鍵照常載入
  {
    const seed = { timers: JSON.stringify([{ id: 'k1', type: 'stopwatch', name: '舊資料', status: 'paused', startAt: 1, pausedElapsed: 3000, duration: 0, laps: [{ lap: 1, split: 1000, total: 1000 }], doneAt: 0, ack: false }]), settings: JSON.stringify({ sound: false, vibrate: true, wake: true, theme: 'dark' }), presets: JSON.stringify([{ name: '我的', cfg: { prep: 5, work: 40, rest: 20, rounds: 3, sets: 2, setRest: 30 } }]) };
    const o = await open({ seed, tag: '[legacy] ' }), { p } = o;
    const r = await p.evaluate(() => [__timerDeck.timers[0].name, __timerDeck.timers[0].laps.length, __timerDeck.timers[0].pausedElapsed, document.documentElement.dataset.theme, __timerDeck.presets.map(x => x.name)]);
    eq(r, ['舊資料', 1, 3000, 'dark', ['我的']], '既有 localStorage 鍵與格式照常載入');
    await o.ctx.close();
  }

  eq(errors, [], '全程沒有 page／console error');
  await browser.close(); server.close();
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
