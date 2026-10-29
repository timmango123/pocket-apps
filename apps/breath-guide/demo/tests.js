// 呼吸放鬆引導：上架評分 toFix 的回歸測試（node tests.js，約 20 秒）
// 時間全用 Playwright 假時鐘（pauseAt + runFor / fastForward），不看實際經過的時間。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'breath-guide-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const KEY = 'breath-guide:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
// Records every oscillator start/stop so tone timing can be checked without listening.
const AUDIO_SPY = () => {
  window.__osc = [];
  const P = window.OscillatorNode && OscillatorNode.prototype; if (!P) return;
  const st = P.start, sp = P.stop;
  P.start = function (w) { window.__osc.push({ type: this.type, f: this.frequency.value, t0: this.context.currentTime }); this.__rec = window.__osc[window.__osc.length - 1]; return st.apply(this, arguments); };
  P.stop = function (w) { if (this.__rec && this.__rec.len == null) this.__rec.len = w - this.context.currentTime; return sp.apply(this, arguments); };
};

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, seed) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    await ctx.addInitScript(AUDIO_SPY);
    if (seed) await ctx.addInitScript(seed);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.clock.install({ time: new Date('2026-10-14T21:00:00') });
    await p.goto(URL);
    await p.clock.pauseAt(new Date('2026-10-14T21:00:02'));
    await p.waitForFunction(() => window.__breath);
    return { ctx, p };
  }
  const ls = (p, k) => p.evaluate(k => localStorage.getItem(k), KEY + k);
  const shown = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.5; }, sel);
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);
  async function touch(p, x, y) {
    const c = await p.context().newCDPSession(p);
    await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await c.detach();
  }

  // 1. 進行中紀錄：每完成一個循環就寫入（同一筆更新，不重複）
  {
    const { ctx, p } = await open();
    await p.click('[data-mode="relax"]');
    for (let i = 0; i < 1; i++) await p.click('#cycPlus'); // 4 -> 5 cycles
    await p.click('#btnStart');
    await p.clock.fastForward(11500);
    let log = JSON.parse(await ls(p, 'log') || 'null');
    assert(Array.isArray(log) && log.length === 1 && log[0].cycles === 1 && log[0].mode === 'relax' && log[0].date === '2026-10-14', '放鬆 4-6 跑 11.5 s：不用重新整理就已記 1 循環 ' + JSON.stringify(log));
    await p.clock.fastForward(10000);
    log = JSON.parse(await ls(p, 'log'));
    assert(log.length === 1 && log[0].cycles === 2 && log[0].seconds >= 20, '第 2 循環完成後更新同一筆（不重複新增）');
    await p.reload(); await p.waitForFunction(() => window.__breath);
    assert((await p.textContent('#foot')).includes('本週已練習 1 天'), '中途重新整理後頁尾顯示本週已練習 1 天');
    await ctx.close();
  }
  // 1b. pagehide / 暫停也寫入；結束時不重複
  {
    const { ctx, p } = await open();
    await p.click('[data-mode="relax"]'); await p.click('#btnStart');
    await p.clock.fastForward(13000);
    await p.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
    let log = JSON.parse(await ls(p, 'log'));
    assert(log.length === 1 && log[0].seconds === 13, 'pagehide 時把目前秒數寫入同一筆（13 s）');
    await p.click('#tapcatch'); await p.click('#btnStop');
    log = JSON.parse(await ls(p, 'log'));
    assert(log.length === 1 && log[0].cycles === 1, '按結束後仍只有 1 筆');
    await ctx.close();
  }
  // 2. 自訂秒數輸入後不離開欄位直接重新整理
  {
    const { ctx, p } = await open();
    await p.click('[data-mode="custom"]');
    await p.click('#cOut'); await p.keyboard.press('Control+A'); await p.keyboard.type('9');
    assert((await p.textContent('#desc')).includes('吐氣 9'), '輸入時說明列即時更新');
    await p.reload(); await p.waitForFunction(() => window.__breath);
    assert(await p.inputValue('#cOut') === '9', '輸入 9 後未離開欄位就重新整理，回來仍是 9');
    await p.click('#cIn'); await p.keyboard.press('Control+A'); await p.keyboard.press('Backspace');
    await p.reload(); await p.waitForFunction(() => window.__breath);
    assert(await p.inputValue('#cIn') === '4', '輸入中清空欄位不會把已存的值改成 0');
    await p.fill('#cIn', '25'); await p.locator('#cIn').dispatchEvent('change');
    assert(await p.inputValue('#cIn') === '20', '離開欄位時顯示夾值後的數字（25 → 20）');
    const units = await p.$$eval('#customBox .u', a => a.map(x => x.textContent));
    assert(units.length === 4 && units.every(u => u === '秒'), '四個自訂欄位都標示單位「秒」');
    await ctx.close();
  }
  // 3. 異常 localStorage 不讓整頁壞掉
  {
    const before = errors.length;
    const { ctx, p } = await open(390, 844, {}, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('breath-guide:v1:settings', '{"mode":"zzz","durType":"x","cycles":-3,"minutes":7,"tone":1,"scene":"mars","theme":null}');
      localStorage.setItem('breath-guide:v1:log', '"str"');
      localStorage.setItem('breath-guide:v1:custom', '[{"in":"abc","out":99}]');
    });
    const S = await p.evaluate(() => ({ ...__breath.S }));
    assert(errors.length === before, '異常設定 / log 載入時沒有 page error ' + errors.slice(before).join(' | '));
    assert(S.mode === '478' && S.durType === 'cycles' && S.cycles === 4 && S.tone === 'hum' && S.scene === 'night' && S.theme === 'auto', '不合法的設定值改回預設');
    assert((await p.textContent('#foot')).includes('本週還沒練習'), 'log 不是陣列時當成空紀錄');
    await p.click('[data-mode="custom"]');
    assert(await p.inputValue('#cIn') === '0' && await p.inputValue('#cOut') === '20', '自訂秒數異常值被夾到 0–20');
    await ctx.close();
  }
  {
    const before = errors.length;
    const { ctx, p } = await open(390, 844, {}, () => {
      localStorage.setItem('breath-guide:v1:log', JSON.stringify([{ date: '2026-10-13', mode: 'box', seconds: 64, cycles: 4 }, null, { date: 5 }, { date: 'bad' }, 7]));
    });
    const foot = await p.textContent('#foot');
    await p.click('#btnSet');
    const n = await p.$$eval('#logList li', a => a.length);
    assert(foot.includes('本週已練習 1 天') && n === 1 && errors.length === before, '舊格式紀錄仍可讀，壞筆數略過（' + foot + '）');
    await ctx.close();
  }
  // 4. 練習紀錄列表 + 匯出
  {
    const { ctx, p } = await open(390, 844, {}, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('breath-guide:v1:log', JSON.stringify([{ date: '2026-10-12', mode: 'box', seconds: 64, cycles: 4 }, { date: '2026-10-13', mode: 'relax', seconds: 60, cycles: 6 }]));
    });
    await p.click('#btnSet');
    const items = await p.$$eval('#logList li', a => a.map(x => x.textContent));
    assert(items.length === 2 && items[0].includes('10/13') && items[0].includes('放鬆') && items[0].includes('1:00') && items[1].includes('方塊'), '設定裡列出練習紀錄（新到舊）' + JSON.stringify(items));
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }).catch(() => null), p.click('#btnExport')]);
    let parsed = null; if (d) { try { parsed = JSON.parse(fs.readFileSync(await d.path(), 'utf8')); } catch (e) {} }
    assert(d && /^breath-log-2026-10-14\.json$/.test(d.suggestedFilename()) && parsed && parsed.log.length === 2, '匯出下載 breath-log-日期.json，含 2 筆');
    await p.click('#btnLogText');
    assert(await p.$eval('#logText', t => !t.hidden && JSON.parse(t.value).log.length === 2), '備份文字顯示完整 JSON');
    await ctx.close();
  }
  // 5. 控制鈕淡出後，點畫面任一處（含原本暫停鈕的位置）先叫出按鈕；第一次淡出有提示
  {
    const { ctx, p } = await open();
    await p.click('#btnStart');
    const box = await p.locator('#btnPause').boundingBox();
    await p.clock.runFor(3500);
    assert(await p.evaluate(() => document.body.classList.contains('calm')), '3 秒後控制鈕淡出');
    assert(await p.waitForFunction(() => +getComputedStyle(document.querySelector('#calmHint')).opacity > 0.9, null, { timeout: 5000 }).then(() => true, () => false), '第一次淡出時顯示「點畫面任一處顯示按鈕」');
    await touch(p, box.x + box.width / 2, box.y + box.height / 2);
    const st = await p.evaluate(() => ({ calm: document.body.classList.contains('calm'), paused: __breath.state().el }));
    assert(!st.calm && await p.evaluate(() => getComputedStyle(document.querySelector('#runCtrl')).pointerEvents !== 'none'), '真觸控點原本暫停鈕的位置：按鈕重新出現');
    assert((await p.textContent('#btnPause')) === '暫停', '這一下只叫出按鈕，不會同時按到暫停');
    await touch(p, box.x + box.width / 2, box.y + box.height / 2);
    assert((await p.textContent('#btnPause')) === '繼續', '按鈕出現後再點同位置才暫停');
    await p.click('#btnPause'); await p.clock.runFor(3500);
    await touch(p, 20, 120); // top bar area while calm
    assert(!(await p.evaluate(() => document.body.classList.contains('calm'))), '點畫面頂端也能叫出按鈕');
    await p.clock.fastForward(8000);
    assert(await p.evaluate(() => document.body.classList.contains('calm') && !document.body.classList.contains('hint')), '提示只出現一次，之後再淡出不再顯示');
    await ctx.close();
  }
  // 6. 不滿 1 循環結束有說明；8. 練習完成點背景可關
  {
    const { ctx, p } = await open();
    await p.click('#btnStart'); await p.clock.runFor(2000);
    await p.click('#btnStop');
    assert((await toastText(p)).includes('未滿 1 個循環'), '不滿 1 循環按結束：提示這次不記錄');
    assert(await p.$eval('#toast', t => getComputedStyle(t).pointerEvents === 'none'), '提示訊息不擋住底下的節奏鈕');
    assert(await ls(p, 'log') === null, '不滿 1 循環不寫紀錄');
    await p.click('[data-mode="relax"]');
    for (let i = 0; i < 3; i++) await p.click('#cycMinus'); // 1 cycle
    await p.click('#btnStart'); await p.clock.fastForward(10500);
    assert(await p.isVisible('#dlgDone'), '完成畫面出現');
    await p.mouse.click(10, 10);
    assert(!(await p.isVisible('#dlgDone')), '練習完成點背景可以關閉');
    await ctx.close();
  }
  // 9. 暫停時停聲，繼續只播剩餘的滑音；10. 倒數與剩餘時間進位一致；17. 低沉滑音也有完成音
  {
    const { ctx, p } = await open();
    await p.click('[data-mode="relax"]');
    for (let i = 0; i < 3; i++) await p.click('#cycMinus'); // 1 cycle
    await p.click('#btnStart');
    await p.clock.runFor(3000);
    await p.click('#tapcatch'); await p.click('#btnPause');
    assert(await p.evaluate(() => __breath.voices) === 0, '暫停時正在播的滑音被停掉');
    const n0 = await p.evaluate(() => __osc.length);
    await p.clock.runFor(5000);
    await p.click('#btnPause'); await p.clock.runFor(50);
    const rs = await p.evaluate(n => __osc.slice(n), n0);
    assert(rs.length === 1 && Math.abs(rs[0].len - 1.05) < 0.1 && rs[0].f > 290, '繼續時只播吸氣剩下的 1 秒，從當下音高開始 ' + JSON.stringify(rs));
    await p.clock.fastForward(6450); // 9.5 s of 10 s
    const lab = await p.textContent('#label .sec'), prog = await p.textContent('#progress');
    assert(lab === '1' && prog.includes('剩 0:01'), '最後半秒：倒數 1、剩 0:01（' + prog + '）');
    const n1 = await p.evaluate(() => __osc.length);
    await p.clock.runFor(1000);
    const end = await p.evaluate(n => __osc.slice(n), n1);
    assert(await p.isVisible('#dlgDone') && end.some(o => o.type === 'sine'), '低沉滑音模式完成時也有結束音');
    await ctx.close();
  }
  // 11. 點 4-7-8 不覆蓋使用者選的時長；12. 分鐘模式按 + 第一下只切換
  {
    const { ctx, p } = await open();
    await p.click('[data-mode="relax"]'); await p.click('#durSeg [data-min="5"]');
    await p.click('[data-mode="478"]');
    let S = await p.evaluate(() => ({ ...__breath.S }));
    assert(S.durType === 'minutes' && S.minutes === 5, '選 5 分後點 4-7-8 仍是 5 分');
    await p.click('#cycPlus');
    S = await p.evaluate(() => ({ ...__breath.S }));
    assert(S.durType === 'cycles' && S.cycles === 4 && (await p.textContent('#cycOut')) === '4 循環', '分鐘模式按 +：第一下只切到循環並顯示原值 4');
    await p.click('#cycPlus');
    assert((await p.textContent('#cycOut')) === '5 循環', '第二下才加到 5');
    await ctx.close();
    const o = await open(390, 844, {}, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('breath-guide:v1:settings', '{"mode":"box","durType":"cycles","cycles":10}');
    });
    await o.p.click('[data-mode="478"]');
    assert(await o.p.evaluate(() => __breath.S.cycles) === 10, '舊存檔已選 10 循環：點 4-7-8 保留 10 循環');
    await o.ctx.close();
  }
  // 13. 窄螢幕節奏列；14. 深色分段鈕；15. 橫向閒置文字；16. 進度貼近圓形
  {
    for (const w of [360, 375]) {
      const { ctx, p } = await open(w, 700);
      const fit = await p.evaluate(() => { const m = document.querySelector('#modes').getBoundingClientRect(); const c = [...document.querySelectorAll('.chip')].pop().getBoundingClientRect(); return c.right <= m.right + 0.5; });
      assert(fit, w + ' 寬：節奏列 5 個都完整顯示（「自訂」不被切）');
      await ctx.close();
    }
    {
      const { ctx, p } = await open(320, 568);
      assert(await p.evaluate(() => document.querySelector('#modes').classList.contains('more')), '320 寬放不下時右側有漸層提示可滑動');
      await p.evaluate(() => { const m = document.querySelector('#modes'); m.scrollLeft = m.scrollWidth; m.dispatchEvent(new Event('scroll')); });
      assert(!(await p.evaluate(() => document.querySelector('#modes').classList.contains('more'))), '滑到最右後漸層消失');
      const minW = await p.$$eval('.chip', a => Math.min(...a.map(b => b.getBoundingClientRect().width)));
      assert(minW >= 44, '節奏鈕寬度 ≥ 44 px（' + minW.toFixed(1) + '）');
      await ctx.close();
    }
    {
      const { ctx, p } = await open(360, 640, { colorScheme: 'dark' });
      await p.click('#btnSet');
      const r = await p.evaluate(() => {
        const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
        const on = document.querySelector('#toneSeg [aria-pressed="true"]'), seg = document.querySelector('#toneSeg');
        const a = lum(getComputedStyle(on).backgroundColor), b = lum(getComputedStyle(seg).backgroundColor);
        return { ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05), ring: /inset/.test(getComputedStyle(on).boxShadow) && !/rgba\(0, 0, 0, 0\) 0px 0px 0px 1px inset/.test(getComputedStyle(on).boxShadow) };
      });
      assert(r.ratio >= 1.3 && r.ring, '深色模式分段鈕選中狀態：底色對比 ' + r.ratio.toFixed(2) + ' 且有 accent 外框');
      await ctx.close();
    }
    {
      const { ctx, p } = await open(844, 390);
      const lines = await p.$$eval('#label .idle span', a => a.map(s => s.getClientRects().length));
      assert(lines.length === 2 && lines.every(n => n === 1), '844×390 閒置文字固定斷成「按下開始，／跟著圓形呼吸」兩行');
      await ctx.close();
    }
    {
      const { ctx, p } = await open(390, 844, { colorScheme: 'dark' });
      await p.click('#btnStart'); await p.clock.runFor(1000);
      const gap = await p.evaluate(() => document.querySelector('#progress').getBoundingClientRect().top - document.querySelector('#orbbox').getBoundingClientRect().bottom);
      assert(gap >= 0 && gap <= 24, '進行中進度文字緊接在圓形下方（間距 ' + gap.toFixed(0) + ' px）');
      await ctx.close();
    }
  }
  await browser.close();
  assert(errors.length === 0, '全程沒有 page / console error ' + errors.join(' | '));
  fs.rmSync(path.dirname(WRAP), { recursive: true, force: true });
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
