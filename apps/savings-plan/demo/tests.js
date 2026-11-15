// 複利與存錢計畫：上架重審 R1 的回歸測試（node tests.js，約 30 秒）。
// 金額解析（全形、萬／千、擋下 abc／0x16）、手機直式的即時結果列、立即存檔、回到範例可復原、算需要幾年的時間點、
// tfoot 固定列、極大數不出現 e+、壞掉的 freq／timing、6%、± 負號、萬元不留 .0，以及觸控層（放開才執行、detail 0、第二指）。
// 頁面用本機 http 伺服器載入（重新整理要靠 localStorage）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
function serve() {
  return new Promise(res => {
    const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
    srv.listen(0, '127.0.0.1', () => { srv.unref(); res('http://127.0.0.1:' + srv.address().port + '/'); });
  });
}
(async () => {
  const URL = await serve();
  const browser = await chromium.launch();
  async function open({ w = 390, h = 844, init, ctx } = {}) {
    ctx = ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'zh-TW' });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__savings);
    const cdp = await ctx.newCDPSession(p);
    const pt = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const center = sel => p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async (sel, hold) => { await p.$eval(sel, e => e.scrollIntoView({ block: 'center' })); const c = await center(sel); await pt('touchStart', [[c[0], c[1], 1]]); if (hold) await p.waitForTimeout(hold); await pt('touchEnd', []); };
    const txt = sel => p.textContent(sel);
    const settle = () => p.waitForFunction(() => new Promise(r => setTimeout(() => r(true), 200)));   // after the 150 ms typing debounce
    const fillIn = async (sel, v) => { await p.fill(sel, v); await settle(); };
    return { ctx, p, pt, center, tap, txt, fillIn, settle };
  }

  // ---------- 1. 金額解析 + 6% ----------
  {
    const t = await open();
    const main = async (k, v) => { await t.fillIn('#' + k, v); return [await t.txt('#r-main'), await t.p.$eval('#err', e => e.hidden ? '' : e.textContent)]; };
    const base = await main('principal', '100000');
    eq(await main('principal', '10萬'), base, '本金「10萬」= 100000');
    eq(await main('principal', '１０００００'), base, '全形數字 = 半形');
    eq(await main('principal', '100,000'), base, '千分位逗號');
    eq(await main('principal', '9萬1萬'), ['—', '初始本金：請輸入數字（例：100000、10萬、1,000,000）'], '單位順序錯誤擋下');
    for (const bad of ['abc', '0x16', '0x10', '1e3', '😀', '1.2.3']) {
      const r = await main('principal', bad);
      eq([r[0], r[1].includes('請輸入數字')], ['—', true], `本金「${bad}」擋下並提示，不當成 0`);
    }
    eq([await t.p.$eval('#principal', e => e.getAttribute('aria-invalid')), (await t.txt('#live')).includes('請輸入數字')], ['true', true], '欄位標紅、即時結果列顯示原因');
    await main('principal', '100000');
    const m5k = await main('monthly', '5千'); const m5000 = await main('monthly', '5000');
    eq(m5k, m5000, '每月「5千」= 5000');
    eq((await main('monthly', '😀'))[1].includes('每月投入：請輸入數字'), true, '每月投入非數字擋下');
    await main('monthly', '10000');
    eq((await main('target', 'abc'))[1].includes('目標金額：請輸入數字'), true, '目標金額非數字擋下（不再顯示「未設定」）');
    await main('target', '400萬');
    eq(await t.txt('#r-goal'), '第 17 年 7 個月達成（目標 400 萬）', '目標「400萬」與萬元縮寫不留 .0');
    eq(await main('rate', '6%'), base, '年報酬率「6%」接受');
    eq(await main('rate', '６％'), base, '全形「６％」接受');
    eq((await main('rate', 'abc'))[1].includes('例：6 或 6%'), true, '報酬率格式錯誤說明格式');
    await main('rate', '6');
    eq(await t.p.evaluate(() => [__savings.short(250e4 * 100), __savings.short(4e6 * 100), __savings.short(1234.5e4 * 100), __savings.short(1.2e8 * 100)]), ['250 萬', '400 萬', '1,234.5 萬', '1.2 億'], '萬／億縮寫沒有多餘的 .0');
    await t.tap('#freq-y'); await t.p.waitForFunction(() => document.getElementById('freq-y').getAttribute('aria-pressed') === 'true');
    eq((await t.txt('#freq-note')).includes('(1＋年率)^(1/12)−1'), true, '年複利說明等效月利率');
    await t.tap('#freq-m');
    // extreme values: no e+ anywhere (cards, table, chart labels)
    await t.fillIn('#principal', '1000000000000'); await t.fillIn('#monthly', '10000000000'); await t.fillIn('#rate', '50'); await t.fillIn('#years', '100');
    const ex = await t.p.evaluate(() => { const L = __savings.last, top = L.sim[L.sim.length - 1].balance; return { body: /e\+/i.test(document.body.innerText), axis: /e\+/i.test(__savings.short(top * 1.07, '')), s: __savings.short(top) }; });
    eq([ex.body, ex.axis, /兆$/.test(ex.s)], [false, false, true], '極大數不出現 e+（用「兆」）');
    await t.ctx.close();
  }

  // ---------- 2. 即時結果列、算需要幾年的時間點、tfoot ----------
  for (const [w, h] of [[360, 640], [390, 844]]) {
    const t = await open({ w, h });
    const r = await t.p.evaluate(() => { const b = document.getElementById('live').getBoundingClientRect(); return [b.top >= 0 && b.bottom <= innerHeight, document.getElementById('live-v').textContent === document.getElementById('r-main').textContent]; });
    eq(r, [true, true], `${w}×${h}：主結果在第一屏（即時結果列）`);
    await t.p.$eval('#monthly', e => { e.focus(); e.scrollIntoView({ block: 'center' }); });
    await t.p.keyboard.type('5'); await t.settle();
    const k = await t.p.evaluate(() => { const b = document.getElementById('live').getBoundingClientRect(); return [b.top >= 0 && b.bottom <= innerHeight, document.getElementById('live-v').textContent]; });
    eq(k, [true, await t.txt('#r-main')], `${w}×${h}：編輯每月投入時即時結果列仍在畫面上並更新`);
    await t.ctx.close();
  }
  {
    const t = await open({ w: 390, h: 470 });
    for (const id of ['monthly', 'rate', 'inflation']) {
      await t.p.$eval('#' + id, e => { e.focus(); e.scrollIntoView({ block: 'center' }); });
      const vis = await t.p.evaluate(id => { const b = document.getElementById('live').getBoundingClientRect(), i = document.getElementById(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= i.top; }, id);
      eq(vis, true, `鍵盤開著（390×470）編輯 ${id}：即時結果列可見且不蓋住欄位`);
    }
    await t.ctx.close();
  }
  {
    const t = await open();
    await t.tap('#mode-years'); await t.p.waitForFunction(() => document.getElementById('r-main').textContent === '17 年 7 個月');
    const y = await t.p.evaluate(() => {
      const L = __savings.last, q = s => document.querySelector(s).textContent, rows = [...document.querySelectorAll('#table tbody tr')];
      const n = s => +s.replace(/[^\d]/g, '');
      return { months: L.months, contrib: n(q('#r-contrib-sub')), simC: Math.round(L.sim[211].contributed / 100), bal: n(q('#table tfoot td:nth-child(2)')), simB: Math.round(L.sim[211].balance / 100), lastRow: rows[rows.length - 1].children[0].textContent, note: q('#table-note'), sub: q('#r-main-sub') };
    });
    eq([y.months, y.contrib, y.bal, y.lastRow, y.note.includes('達標當月'), y.sub.includes('都算到這個月')], [211, y.simC, y.simB, '18 前 7 個月', true, true], '算需要幾年：卡片、年度表、圖表都算到達標當月（第 211 個月）並標示');
    eq(y.bal, 4015314, '達標當月累積 4,015,314');
    // tfoot: nothing shows under the sticky 合計 row
    await t.tap('#mode-fv'); await t.p.$eval('.tablewrap', e => e.scrollIntoView({ block: 'center' }));
    const gap = await t.p.evaluate(() => { const wr = document.querySelector('.tablewrap').getBoundingClientRect(), td = document.querySelector('tfoot td').getBoundingClientRect(); return Math.abs(wr.bottom - 1 - td.bottom); });
    assert(gap < 0.5, '合計列貼齊表格底部，下方不露出其他列（gap ' + gap + '）');
    await t.ctx.close();
  }

  // ---------- 3. 立即存檔、回到範例可復原、壞掉的存檔 ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    let t = await open({ ctx });
    await t.p.fill('#principal', '777777'); await t.p.reload(); await t.p.waitForFunction(() => window.__savings);
    eq(await t.p.inputValue('#principal'), '777777', '改本金後立刻重新整理：值還在');
    await t.tap('#mode-years'); await t.p.reload(); await t.p.waitForFunction(() => window.__savings);
    eq(await t.p.$eval('[data-mode][aria-pressed=true]', b => b.dataset.mode), 'years', '切模式後立刻重新整理：模式還在');
    await t.tap('#mode-fv');
    await t.p.fill('#monthly', '4321'); await t.p.close({ runBeforeUnload: true });
    t = await open({ ctx });
    eq(await t.p.inputValue('#monthly'), '4321', '打完立刻關分頁：值還在');
    await t.p.fill('#principal', '5555555');
    await t.p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('savings-plan:v1:inputs')).principal), '5555555', 'visibilitychange(hidden) 時已存');
    await t.p.reload(); await t.p.waitForFunction(() => window.__savings);
    await t.tap('#reset'); await t.p.waitForFunction(() => document.getElementById('principal').value === '100000');
    eq([await t.p.isVisible('#toast-act'), await t.txt('#toast-t')], [true, '已還原範例數值'], '回到範例後出現「復原」');
    await t.p.waitForTimeout(850);
    await t.tap('#toast-act'); await t.p.waitForFunction(() => document.getElementById('principal').value === '5555555');
    eq([await t.p.inputValue('#monthly'), await t.p.isVisible('#example-note')], ['4321', false], '按「復原」找回所有數字');
    await t.p.reload(); await t.p.waitForFunction(() => window.__savings);
    eq(await t.p.inputValue('#principal'), '5555555', '復原後重新整理仍在');
    for (const [v, f, tm] of [['{"freq":"zz","timing":"x","principal":"5"}', 'm', 'end'], ['{"freq":7,"timing":null}', 'm', 'end'], ['{"freq":"y","timing":"begin"}', 'y', 'begin']]) {
      // a fresh context whose storage holds only this value (a reload would save the page's own state on pagehide first)
      const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const u = await open({ ctx: c2, init: `if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('savings-plan:v1:inputs', ${JSON.stringify(v)}); }` });
      const st = await u.p.evaluate(() => [[...document.querySelectorAll('[data-freq][aria-pressed=true]')].map(b => b.dataset.freq), [...document.querySelectorAll('[data-timing][aria-pressed=true]')].map(b => b.dataset.timing), __savings.last.p.freq]);
      eq(st, [[f], [tm], f], `存檔 ${v}：按鈕顯示的頻率／時點就是計算用的`);
      await c2.close();
    }
    await ctx.close();
  }

  // ---------- 4. ± 負號 ----------
  {
    const t = await open();
    await t.p.$eval('#inflation', e => e.focus());
    await t.tap('[data-pm=inflation]');
    await t.p.waitForFunction(() => document.getElementById('inflation').value === '-2'); await t.settle();
    eq([await t.p.evaluate(() => document.activeElement.id), (await t.txt('#r-real-sub')).startsWith('通膨 -2%')], ['inflation', true], '± 把通膨變成 −2%，鍵盤（焦點）留在欄位上');
    await t.tap('[data-pm=growth]'); await t.p.waitForFunction(() => document.getElementById('growth').value === '-');
    await t.p.focus('#growth'); await t.p.keyboard.press('End'); await t.p.keyboard.type('3'); await t.settle();
    eq([await t.p.inputValue('#growth'), await t.p.$eval('#err', e => e.hidden)], ['-3', true], '空的年增率按 ± 再輸入 3 → −3%');
    await t.tap('[data-pm=rate]'); await t.p.waitForFunction(() => document.getElementById('rate').value === '-6');
    eq(await t.p.$eval('#rate-range', e => e.value), '-6', '報酬率 ± 同步滑桿');
    await t.ctx.close();
  }

  // ---------- 5. 觸控層 ----------
  {
    const t = await open();
    await t.p.evaluate(() => { window.__cl = []; document.addEventListener('click', e => { const x = e.target.closest && e.target.closest('[id]'); window.__cl.push(x ? x.id : e.target.tagName); }); });
    const reset = () => t.p.evaluate(() => { window.__cl = []; });
    const cl = () => t.p.evaluate(() => window.__cl);
    const pressed = g => t.p.$eval(`[data-${g}][aria-pressed=true]`, b => b.id);
    for (const hold of [0, 600, 1000]) {
      await t.p.waitForTimeout(850); await reset();
      await t.tap('#freq-y', hold); await t.p.waitForFunction(() => window.__cl.length > 0);
      await t.tap('#freq-d', hold); await t.p.waitForFunction(() => window.__cl.length > 1);
      await t.p.waitForTimeout(300);
      eq([await cl(), await pressed('freq')], [['freq-y', 'freq-d'], 'freq-d'], `點按（按住 ${hold} ms）各執行一次`);
    }
    // tap X, then replay a detail-0 click on X, on X's edge point and on whatever is under the finger now
    const d0After = async sel => {
      await t.p.waitForTimeout(850); await reset();
      await t.p.$eval(sel, e => e.scrollIntoView({ block: 'center' }));
      const c = await t.center(sel);
      await t.pt('touchStart', [[c[0], c[1], 1]]); await t.pt('touchEnd', []);
      await t.p.waitForFunction(() => window.__cl.length > 0);
      await t.p.evaluate(([sel, x, y]) => {
        const fire = (el, cx, cy) => el && el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: cx, clientY: cy }));
        const el = document.querySelector(sel);
        if (el) { const r = el.getBoundingClientRect(); fire(el, x, y); fire(el, r.left + 1, r.top + 1); }
        fire(document.elementFromPoint(x, y), x, y);
      }, [sel, c[0], c[1]]);
      await t.p.waitForTimeout(50);
      return cl();
    };
    const th0 = await t.p.evaluate(() => document.documentElement.dataset.theme || 'light');
    eq([await d0After('#theme'), await t.p.evaluate(() => document.documentElement.dataset.theme)], [['theme'], th0 === 'dark' ? 'light' : 'dark'], '主題：點按＋detail 0 click 只切換一次');
    eq([await d0After('#mode-pmt'), await pressed('mode')], [['mode-pmt'], 'mode-pmt'], '模式：只執行一次，新畫面上的東西沒被點到');
    eq([await d0After('#timing-begin'), await pressed('timing')], [['timing-begin'], 'timing-begin'], '投入時點：只執行一次');
    await t.p.evaluate(() => { window.__copies = 0; navigator.clipboard.writeText = () => { window.__copies++; return Promise.resolve(); }; });
    eq([await d0After('#copy'), await t.p.evaluate(() => window.__copies)], [['copy'], 1], '複製：只執行一次');
    await t.p.fill('#principal', '200000'); await t.p.locator('#principal').blur();
    eq([await d0After('#reset'), await t.p.inputValue('#principal')], [['reset'], '100000'], '回到範例：只執行一次，提示上的「復原」沒被點到');
    eq(await t.p.evaluate(() => document.activeElement.tagName), 'BUTTON', '點按鈕後沒有輸入框被聚焦（不叫出鍵盤）');
    // a lone detail-0 click (keyboard / screen reader) runs once; Enter right after a tap is not swallowed
    await t.p.waitForTimeout(850); await reset();
    await t.p.evaluate(() => document.getElementById('mode-fv').click());
    eq([await cl(), await pressed('mode')], [['mode-fv'], 'mode-fv'], '單獨的 detail 0 click 照常執行一次');
    await t.tap('#freq-y'); await t.p.waitForFunction(() => document.getElementById('freq-y').getAttribute('aria-pressed') === 'true');
    await t.p.focus('#freq-m'); await t.p.keyboard.press('Enter');
    eq(await pressed('freq'), 'freq-m', '點按後立刻按 Enter：鍵盤操作不會被吞');
    // second finger: one finger rests on the page, the other taps controls
    await t.p.evaluate(() => scrollTo(0, 0)); await t.p.waitForTimeout(850); await reset();
    const rest = [12, 830];
    eq(await t.p.evaluate(([x, y]) => !document.elementFromPoint(x, y).closest('button, input'), rest), true, '放著的手指不在控制項上');
    const tap2 = async sel => { const c = await t.center(sel); await t.pt('touchStart', [[rest[0], rest[1], 1]]); await t.pt('touchMove', [[rest[0], rest[1], 1], [c[0], c[1], 2]]); await t.pt('touchEnd', [[c[0], c[1], 2]]); await t.pt('touchEnd', [[rest[0], rest[1], 1]]); };
    await tap2('#mode-years'); await t.p.waitForFunction(() => document.getElementById('mode-years').getAttribute('aria-pressed') === 'true');
    await tap2('#mode-fv'); await t.p.waitForFunction(() => document.getElementById('mode-fv').getAttribute('aria-pressed') === 'true');
    await tap2('#theme'); await t.p.waitForTimeout(150);
    await tap2('#theme'); await t.p.waitForTimeout(150);
    eq(await cl(), ['mode-years', 'mode-fv', 'theme', 'theme'], '另一指放在頁面上時，第二指點模式、主題都各執行一次');
    // edge tap: a few px outside the button still hits it, once
    await t.p.waitForTimeout(850); await reset();
    const b = await t.p.$eval('#freq-y', e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom + 3]; });
    const hit = await t.p.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('button') ? document.elementFromPoint(x, y).closest('button').id : null, b);
    await t.pt('touchStart', [[b[0], b[1], 1]]); await t.pt('touchEnd', []); await t.p.waitForTimeout(300);
    const got = await cl();
    assert(got.length <= 1 && (got.length === 0 || got[0] === (hit || 'freq-y')), '按鈕邊緣外 3 px：最多執行一次 ' + JSON.stringify(got));
    await t.ctx.close();
  }

  await browser.close();
  assert(!errors.length, '沒有頁面錯誤' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  console.log(`${fails ? 'FAIL' : 'ok'}: ${passes} 項通過，${fails} 項失敗`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
