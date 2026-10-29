// BMI 與熱量計算：上架評分 toFix 的回歸測試（node tests.js，約 20 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'body-calc-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
// served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
const server = require('http').createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(WRAP)); });
let URL;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const KEY = 'body-calc:v1:';
const LB = 0.45359237, IN = 2.54;
const fmt = n => new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(Math.round(n));
const day = k => { const d = new Date(); d.setDate(d.getDate() - k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  URL = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  async function open(init, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForSelector('#bmi');
    return { ctx, p };
  }
  const tap = async (p, sel) => {
    await p.locator(sel).scrollIntoViewIfNeeded();
    const b = await p.locator(sel).boundingBox(), x = b.x + b.width / 2, y = b.y + b.height / 2;
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  };
  const sel = (p, s) => p.evaluate(s => { const e = document.querySelector(s); return [document.activeElement === e, e.selectionStart, e.selectionEnd, e.value.length]; }, s);
  const waitSel = (p, s) => p.waitForFunction(s => { const e = document.querySelector(s); return document.activeElement === e && e.selectionStart === 0 && e.selectionEnd === e.value.length; }, s, { timeout: 3000 }).then(() => true, () => false);

  // 1. 減脂目標永遠不高於維持熱量，差值照實顯示（純函式全格點）
  {
    const { ctx, p } = await open();
    const bad = await p.evaluate(() => {
      const B = window.__body, out = [];
      for (const sex of ['m', 'f']) for (let age = 15; age <= 100; age += 5) for (let cm = 100; cm <= 250; cm += 10) for (let kg = 20; kg <= 300; kg += 10) for (let a = 0; a < 5; a++) for (const rate of [0.25, 0.5]) {
        const T = B.tdee(B.bmr({ sex, age, cm, kg }).v, a), G = B.targetKcal(T, 'lose', rate, sex), floor = sex === 'm' ? 1500 : 1200;
        const want = Math.round(Math.min(T, Math.max(floor, T - G.delta)));
        if (G.v > Math.round(T) || G.v !== want || G.diff !== G.v - Math.round(T)) out.push([sex, age, cm, kg, a, rate, T, G.v]);
      }
      return out;
    });
    assert(bad.length === 0, '減脂目標 = min(TDEE, max(下限, TDEE−赤字))，全格點 0 例外 ' + JSON.stringify(bad.slice(0, 3)));
    await p.click('#sex-f'); await p.fill('#age', '60'); await p.fill('#height', '150'); await p.fill('#weight', '45'); await p.click('#act-0'); await p.click('#goal-lose'); await p.click('#rate-50');
    const [td, tg, tf, w] = await Promise.all(['#tdee', '#target', '#target-f', '#warn'].map(s => p.textContent(s)));
    assert(td === '1,112' && tg === '1,112' && tf.startsWith('±0') && w.includes('已低於女性建議下限') && w.includes('增加活動量'), `女 60 歲 150/45 久坐減脂：TDEE ${td} 目標 ${tg}「${tf}」不再寫 −550`);
    await p.click('#sex-m'); await p.fill('#height', '160'); await p.fill('#weight', '50');
    assert((await p.textContent('#target')) === (await p.textContent('#tdee')) && !(await p.textContent('#target-f')).includes('550'), '男 60 歲 160/50 久坐減脂：目標等於 TDEE');
    await p.click('#sex-f'); await p.fill('#age', '30'); await p.fill('#height', '160'); await p.fill('#weight', '50');
    const tdee = await p.textContent('#tdee'), diff = 1200 - Number(tdee.replace(',', ''));
    assert((await p.textContent('#target')) === '1,200' && (await p.textContent('#target-f')) === '−' + Math.abs(diff) + ' kcal／日' && (await p.textContent('#warn')).includes('實際每日少 ' + Math.abs(diff)), `被下限擋住時顯示實際差值 −${Math.abs(diff)}（TDEE ${tdee}）`);
    await ctx.close();
  }

  // 2/13. 全形、逗號小數、帶單位可算；abc、表情、0x64、1e2 擋下並說明
  {
    const { ctx, p } = await open();
    await p.fill('#height', '１７０'); assert((await p.textContent('#bmi')) === '22.5', '全形「１７０」可計算');
    await p.fill('#weight', '65,5'); assert((await p.textContent('#bmi')) === '22.7', '逗號小數「65,5」= 65.5');
    await p.fill('#height', '170cm'); await p.fill('#weight', '65．5公斤'); assert((await p.textContent('#bmi')) === '22.7', '「170cm」「65．5公斤」可計算');
    for (const v of ['abc', '😀', '0x64', '1e2']) {
      await p.fill('#height', v);
      const [b, err, inv] = [await p.textContent('#bmi'), await p.textContent('#err'), await p.getAttribute('#height', 'aria-invalid')];
      assert(b === '—' && err.includes('身高請輸入數字，例如 170') && inv === 'true', `身高「${v}」擋下：${err}`);
    }
    // 3. 空白欄位說明
    await p.fill('#height', '170'); await p.fill('#age', '');
    assert((await p.textContent('#err')).includes('請填入年齡') && await p.isVisible('#kcal-why') && (await p.textContent('#kcal-why')).includes('年齡') && (await p.textContent('#tdee')) === '—', '年齡空白：#err 與熱量卡都寫原因');
    await p.fill('#age', '30'); assert(await p.isHidden('#kcal-why') && await p.isHidden('#err'), '補上後原因消失');
    // 6. BMI 過輕選減脂要提醒
    await p.click('#sex-f'); await p.fill('#age', '20'); await p.fill('#weight', '48'); await p.click('#goal-lose');
    assert((await p.textContent('#bmi-cls')) === '過輕' && (await p.textContent('#warn')).includes('過輕，不建議減重'), 'BMI 16.6 過輕 + 減脂：顯示不建議減重');
    // 19. 未滿 18 歲減脂
    await p.fill('#age', '16'); await p.fill('#weight', '60');
    assert((await p.textContent('#warn')).includes('未滿 18 歲') && (await p.textContent('#teen')).includes('熱量'), '16 歲減脂：熱量卡也提醒');
    // 7. 紀錄欄 placeholder 跟著單位與體重
    await p.fill('#weight', '75'); assert((await p.getAttribute('#log-kg', 'placeholder')) === '75', '體重改 75 → placeholder 75');
    await p.click('#unit-imperial'); assert((await p.getAttribute('#log-kg', 'placeholder')) === '165.3' && (await p.textContent('#log-unit')) === 'lb', '切英制 → placeholder 165.3 lb');
    // 5/14. 英制錯誤訊息用英制範圍；in ≥ 12 擋下
    await p.fill('#height-ft', '2'); await p.fill('#height-in', '0');
    let e = await p.textContent('#err'); assert(e.includes('3 ft 3.4 in–8 ft 2.4 in') && !e.includes('100–250'), '英制 2 ft 0 in：' + e);
    await p.fill('#height-ft', '5'); await p.fill('#height-in', '15');
    e = await p.textContent('#err'); assert(e.includes('英吋請輸入 0–11.9') && (await p.textContent('#bmi')) === '—', '5 ft 15 in 擋下：' + e);
    await p.fill('#height-in', '7'); await p.fill('#weight-lb', '10');
    e = await p.textContent('#err'); assert(e.includes('44.1–661.3 lb'), '英制 10 lb：' + e);
    // R2：英制範圍訊息與實際接受值一致（邊界兩側）
    const okAt = async (ft, inch, lb) => { await p.fill('#height-ft', ft); await p.fill('#height-in', inch); await p.fill('#weight-lb', lb); return p.isHidden('#err'); };
    assert(await okAt('3', '3.4', '44.1') && !(await okAt('3', '3.3', '44.1')) && !(await okAt('3', '3.4', '44')) && await okAt('8', '2.4', '661.3') && !(await okAt('8', '2.5', '661.3')) && !(await okAt('8', '2.4', '661.4')), '3 ft 3.4 in–8 ft 2.4 in、44.1–661.3 lb 恰好是接受範圍');
    // R2：BMI < 12 或 > 60 提醒單位
    await okAt('5', '7', '44.5'); assert(await p.isVisible('#bmi-odd') && (await p.textContent('#bmi')) === '7.0', '5 ft 7 in 44.5 lb → BMI 7.0 顯示「數值異常」');
    await okAt('5', '7', '150'); assert(await p.isHidden('#bmi-odd'), '一般 BMI 不顯示異常提醒');
    // 15. 英制不先四捨五入
    await p.click('#sex-m'); await p.fill('#age', '30'); await p.click('#act-2'); await p.click('#goal-keep');
    for (const [ft, inch, lb] of [['5', '7', '150'], ['4', '11.5', '105']]) {
      await p.fill('#height-ft', ft); await p.fill('#height-in', inch); await p.fill('#weight-lb', lb);
      const cm = (+ft * 12 + +inch) * IN, kg = +lb * LB, want = fmt((10 * kg + 6.25 * cm - 150 + 5) * 1.55);
      assert((await p.textContent('#tdee')) === want, `${ft} ft ${inch} in ${lb} lb → TDEE ${want}（精確換算）`);
    }
    await p.reload(); await p.waitForSelector('#bmi');
    assert((await p.inputValue('#height-in')) === '11.5' && (await p.inputValue('#weight-lb')) === '105', '英制原始輸入重新整理後保留');
    await ctx.close();
  }

  // 4/18. 紀錄欄錯誤文字、未來日期；11. 刪除可復原；17. 顯示更多；16. 匯出／匯入
  {
    const seed = Array.from({ length: 150 }, (_, i) => ({ date: day(i + 1), kg: 60 + (i % 10) / 10 }));
    const { ctx, p } = await open(`if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('${KEY}weights', ${JSON.stringify(JSON.stringify(seed))}); }`);
    await p.fill('#log-kg', '5'); await p.click('#log-add');
    assert(await p.isVisible('#log-err') && (await p.textContent('#log-err')).includes('20–300 kg'), '紀錄 5 kg：顯示「請輸入 20–300 kg」');
    await p.fill('#log-kg', '64'); assert(await p.isHidden('#log-err'), '重新輸入後錯誤文字消失');
    await p.fill('#log-date', '2030-01-01'); await p.click('#log-add');
    assert((await p.textContent('#log-err')).includes('不能晚於今天') && !(await p.evaluate(k => localStorage.getItem(k), KEY + 'weights')).includes('2030-01-01'), '未來日期不存入並提示');
    assert((await p.$$eval('#logs li', l => l.length)) === 60 && (await p.textContent('#log-more')).includes('還有 90 筆'), '150 筆：先顯示 60 筆並有「顯示更早」');
    await p.click('#log-more'); assert((await p.$$eval('#logs li', l => l.length)) === 150 && await p.isHidden('#log-more'), '按一下顯示全部 150 筆');
    const first = day(1), stored = () => p.evaluate(k => JSON.parse(localStorage.getItem(k)).length, KEY + 'weights');
    const y0 = await p.locator(`[data-del="${day(2)}"]`).boundingBox();
    await tap(p, `[data-del="${first}"]`);
    await p.waitForSelector(`[data-undo="${first}"]`);
    const y1 = await p.locator(`[data-del="${day(2)}"]`).boundingBox();
    assert((await p.$$eval('#logs li.gone', l => l.length)) === 1 && (await p.textContent('#logs li.gone')).includes('已刪除') && await stored() === 149, '刪除後原列變成「已刪除 · 復原」，已存檔');
    const cover = await p.evaluate(ds => ds.map(d => { const b = document.querySelector(`[data-del="${d}"]`), r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; }), [day(2), day(3)]);
    assert(Math.abs(y0.y - y1.y) < 1 && cover.every(Boolean) && await p.isHidden('#toast'), '下兩列 × 不移動也沒被提示蓋住');
    await tap(p, `[data-del="${day(2)}"]`); await p.waitForSelector(`[data-undo="${day(2)}"]`);
    assert(await stored() === 148 && (await p.$$eval('#logs li.gone', l => l.length)) === 2, '可連續刪除下一列');
    await tap(p, `[data-undo="${first}"]`); await p.click(`[data-undo="${day(2)}"]`);
    assert((await p.$$eval('#logs li', l => l.length)) === 150 && (await p.$$eval('#logs li.gone', l => l.length)) === 0 && await stored() === 150, '復原後紀錄回來並已儲存');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#log-export')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    assert(/^﻿?date,kg\n/.test(csv) && csv.trim().split('\n').length === 151 && csv.includes(first + ',60'), '匯出 CSV 150 筆 + 表頭');
    const imp = path.join(DIR, 'in.csv');
    fs.writeFileSync(imp, 'date,kg\n2020/1/2,70.5\n2020-01-03,"71,2"\nhello\n2030-01-01,70\n2020-02-30,70\n2020-01-04,5\n');
    await p.setInputFiles('#log-file', imp);
    await p.waitForFunction(() => !document.querySelector('#toast').hidden && document.querySelector('#toast').textContent.includes('匯入'));
    const t = await p.textContent('#toast-t');
    assert(t.includes('已匯入 2 筆') && t.includes('略過 4 行'), '匯入：2 筆有效、4 行略過（' + t + '）');
    const ws = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY + 'weights');
    assert(ws.length === 152 && ws.some(x => x.date === '2020-01-03' && x.kg === 71.2), '匯入後已儲存 152 筆');
    await p.click('#toast-undo');
    assert((await p.evaluate(k => JSON.parse(localStorage.getItem(k)).length, KEY + 'weights')) === 150, '匯入可復原');
    // R2：分號／Tab 分隔時逗號是小數點；逗號分隔又沒加引號的 65,5 不亂存
    fs.writeFileSync(imp, '日期;體重\n2020-03-02;65,5\n2020-03-03\t66,1\n2020-03-04,67,3\n');
    await p.setInputFiles('#log-file', imp);
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent.includes('已匯入 2 筆'));
    const w2 = await p.evaluate(k => JSON.parse(localStorage.getItem(k)), KEY + 'weights');
    const t2 = await p.textContent('#toast-t');
    assert(w2.some(x => x.date === '2020-03-02' && x.kg === 65.5) && w2.some(x => x.date === '2020-03-03' && x.kg === 66.1) && !w2.some(x => x.date === '2020-03-04') && t2.includes('加引號'), 'CSV「;65,5」「\t66,1」正確；「,67,3」略過並提示（' + t2 + '）');
    await p.setInputFiles('#log-file', fs.writeFileSync(imp, 'garbage\n') || imp);
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent.includes('沒有可匯入'));
    assert(true, '壞檔不當掉並提示格式');
    await ctx.close();
  }

  // 8. 點欄位就全選（真實觸控與滑鼠）；20. enterkeyhint 與 Enter 跳下一欄；9. 預設活動量；10. 快速關閉不遺失；12/21 視覺
  {
    const { ctx, p } = await open();
    await tap(p, '#height'); assert(await waitSel(p, '#height'), '觸控點身高：全選 ' + JSON.stringify(await sel(p, '#height')));
    await p.keyboard.type('180'); assert((await p.inputValue('#height')) === '180', '直接輸入取代範例 170');
    await p.click('#age'); assert(await waitSel(p, '#age'), '滑鼠點年齡：全選 ' + JSON.stringify(await sel(p, '#age')));
    await p.click('#age'); await p.waitForFunction(() => document.activeElement.selectionStart === document.activeElement.selectionEnd, null, { timeout: 2000 }).catch(() => {});
    assert((await sel(p, '#age'))[1] === (await sel(p, '#age'))[2], '已在欄位內再點一次可放游標（不強制全選）');
    const hints = await p.$$eval('#age,#height,#weight,#height-ft,#height-in,#weight-lb,#bodyfat,#log-kg', l => l.map(e => e.getAttribute('enterkeyhint')));
    assert(hints.every(Boolean), 'enterkeyhint ' + hints.join(','));
    await p.focus('#age'); await p.keyboard.press('Enter'); assert(await p.evaluate(() => document.activeElement.id) === 'height', 'Enter 從年齡跳到身高');
    await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
    assert((await p.getAttribute('#weight', 'enterkeyhint')) === 'done' && await p.evaluate(() => document.activeElement === document.body), '體重欄 Enter = 完成（收起鍵盤，不跳到體脂率）');
    // R2：分級徽章白字對比 ≥ 4.5、理想體重文字
    const badge = await p.evaluate(() => {
      const L = rgb => { const c = rgb.match(/\d+/g).slice(0, 3).map(v => v / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const out = [];
      for (const th of ['light', 'dark']) { document.documentElement.dataset.theme = th; for (const w of ['40', '65', '75', '100']) { const i = document.querySelector('#weight'); i.value = w; i.dispatchEvent(new Event('input', { bubbles: true })); const cs = getComputedStyle(document.querySelector('#bmi-cls')), a = L(cs.color), b = L(cs.backgroundColor); out.push((Math.max(a, b) + .05) / (Math.min(a, b) + .05)); } }
      delete document.documentElement.dataset.theme; return out;
    });
    assert(badge.every(x => x >= 4.5), '分級徽章對比 ≥ 4.5（' + badge.map(x => x.toFixed(2)).join(' ') + '）');
    assert(/^理想體重 BMI 18\.5–24：\d/.test(await p.textContent('#ideal')), '理想體重文字：' + await p.textContent('#ideal'));
    // 9
    await p.evaluate(k => localStorage.clear(), KEY); await p.reload(); await p.waitForSelector('#bmi');
    assert((await p.getAttribute('#act-0', 'aria-pressed')) === 'true' && await p.isVisible('#act-badge'), '新使用者預設久坐，活動量標「範例，請選擇」');
    await p.fill('#weight', '70');
    assert(await p.isVisible('#act-badge'), '只改體重時活動量仍提示請選擇');
    await tap(p, '#act-3'); assert(await p.isHidden('#act-badge') && (await p.getAttribute('#act-3', 'aria-pressed')) === 'true', '點選活動量後提示消失');
    // 10
    await p.fill('#weight', '59.9'); await p.reload(); await p.waitForSelector('#bmi');
    assert((await p.inputValue('#weight')) === '59.9' && (await p.getAttribute('#act-3', 'aria-pressed')) === 'true' && await p.isHidden('#act-badge'), '改體重後立刻重新整理仍保留 59.9');
    // 12
    const cr = await p.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      const hex = getComputedStyle(document.documentElement).getPropertyValue('--over').trim();
      const L = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      return (1.05) / (L(hex) + .05);
    });
    assert(cr >= 3, '淺色「過重」白字對比 ' + cr.toFixed(2) + ':1 ≥ 3');
    // 21
    const dy = await p.evaluate(() => { const i = document.querySelector('#katch').getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(document.querySelector('label.chk').lastChild); const rs = r.getBoundingClientRect(); return Math.abs((i.top + i.bottom) / 2 - (rs.top + rs.bottom) / 2); });
    assert(dy <= 2, 'Katch 勾選框與文字垂直置中（差 ' + dy.toFixed(1) + 'px）');
    await ctx.close();
  }

  // R2：localStorage 被封鎖時提示一次
  {
    const { ctx, p } = await open(`Storage.prototype.setItem = function () { throw new Error('blocked'); };`);
    await p.fill('#weight', '66');
    await p.waitForFunction(() => document.querySelector('#toast-t').textContent.includes('不允許保存'), null, { timeout: 3000 }).catch(() => {});
    assert(await p.isVisible('#toast') && (await p.textContent('#toast-t')).includes('重新整理後資料會消失'), '無法保存時提示「重新整理後資料會消失」');
    await p.evaluate(() => { document.querySelector('#toast').hidden = true; });
    await p.fill('#log-kg', '66'); await p.click('#log-add');
    assert(await p.isHidden('#toast') && (await p.$$eval('#logs li', l => l.length)) === 1, '只提示一次，紀錄仍可在本次使用');
    await ctx.close();
  }

  // 舊版資料仍可載入
  {
    const old = { unit: 'metric', sex: 'f', age: '40', h: '160', w: '55', bf: '', katch: false, act: 3, goal: 'lose', rate: 0.25, example: false };
    const { ctx, p } = await open(`if (!sessionStorage.s) { sessionStorage.s = 1; localStorage.setItem('${KEY}profile', ${JSON.stringify(JSON.stringify(old))}); localStorage.setItem('${KEY}weights', '[{"date":"2026-01-02","kg":55.5}]'); }`);
    assert((await p.inputValue('#age')) === '40' && (await p.getAttribute('#act-3', 'aria-pressed')) === 'true' && await p.isHidden('#act-badge') && (await p.getAttribute('#goal-lose', 'aria-pressed')) === 'true' && (await p.$$eval('#logs li', l => l.length)) === 1, '舊版 profile / weights 照常載入');
    await ctx.close();
    for (const junk of ['{', '[]', '"x"', 'null', '{"act":"9","age":30,"h":null}']) {
      const { ctx, p } = await open(`localStorage.setItem('${KEY}profile', ${JSON.stringify(junk)})`);
      assert((await p.textContent('#bmi')).length > 0, '損壞 profile ' + junk + ' 不當掉');
      await ctx.close();
    }
  }

  await browser.close(); server.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  assert(errors.length === 0, '無 console / page error ' + JSON.stringify(errors));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
