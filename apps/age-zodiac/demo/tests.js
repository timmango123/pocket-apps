// 年齡與星座查詢：上架評分 toFix 的回歸測試（node tests.js，約 20 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'age-zodiac-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const KEY = 'age-zodiac:v1:';
const seedPeople = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: '人' + i, date: `19${String(50 + (i % 50)).padStart(2, '0')}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, calendar: 'solar', leap: false }));

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await p.goto(URL); await p.waitForTimeout(80);
    return { ctx, p };
  }
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast').textContent);

  // 1. 匯出：沒有 window.claude 時下載 .json 檔
  {
    const { ctx, p } = await open();
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY + 'people', JSON.stringify(seedPeople(3))]); await p.reload(); await p.waitForTimeout(80);
    assert((await p.textContent('#export')).trim() === '匯出', '匯出鈕不再是「複製 JSON」');
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 3000 }).catch(() => null), p.click('#export')]);
    let parsed = null; if (d) { try { parsed = JSON.parse(fs.readFileSync(await d.path(), 'utf8')); } catch (e) { parsed = null; } }
    assert(d && /^birthdays-2026-10-13\.json$/.test(d.suggestedFilename()) && parsed && parsed.people.length === 3, '匯出下載 birthdays-日期.json，內含 3 筆 ' + (d && d.suggestedFilename()));
    // 2. 文字備份：唯讀框可手動複製、貼上文字可還原
    await p.click('#backup-btn');
    assert(await p.isVisible('#backup-out') && await p.$eval('#backup-out', t => t.readOnly && JSON.parse(t.value).people.length === 3), '文字備份：唯讀文字框含完整 JSON');
    await p.fill('#backup-in', JSON.stringify({ people: [{ name: '貼上甲', date: '2001-05-05', calendar: 'solar' }, { name: '壞', date: '2001-02-30' }] }));
    await p.click('#backup-import');
    assert((await toastText(p)).includes('匯入 1 筆') && (await toastText(p)).includes('略過 1 筆格式不符'), '貼上文字匯入：' + await toastText(p));
    await p.reload(); await p.waitForTimeout(80);
    assert((await p.$$('#people li.person')).length === 4, '貼上匯入後重新整理仍有 4 筆');
    await p.click('#backup-btn'); await p.fill('#backup-in', '{"people": [ 截斷'); await p.click('#backup-import');
    assert((await toastText(p)) === '檔案格式不正確' && (await p.$$('#people li.person')).length === 4, '貼上壞文字顯示格式不正確，不動清單');
    await ctx.close();
  }
  // 2b. 剪貼簿被拒：選取唯讀文字框讓人手動複製
  {
    const { ctx, p } = await open(390, 844, {}, () => { Object.defineProperty(navigator, 'clipboard', { get: () => ({ writeText: () => Promise.reject(new Error('denied')) }) }); });
    await p.click('#backup-btn'); await p.click('#backup-copy'); await p.waitForTimeout(50);
    const sel = await p.evaluate(() => { const t = document.activeElement; return t && t.id === 'backup-out' && t.selectionEnd - t.selectionStart === t.value.length && t.value.length > 10; });
    assert(sel && (await toastText(p)).includes('長按'), '剪貼簿失敗時選取唯讀文字框並說明：' + await toastText(p));
    await ctx.close();
  }
  // 3. 輸入後立刻重新整理（pagehide 先存）
  {
    const { ctx, p } = await open();
    await p.fill('#name', '阿姨'); await p.fill('#birth', '1970-05-06');
    await p.reload(); await p.waitForTimeout(80);
    assert(await p.inputValue('#name') === '阿姨' && await p.inputValue('#birth') === '1970-05-06', '改完 0 ms 內重新整理仍保留姓名與生日');
    await ctx.close();
  }
  // 4. 刪除可復原，回到原位
  {
    const { ctx, p } = await open();
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY + 'people', JSON.stringify(seedPeople(5))]); await p.reload(); await p.waitForTimeout(80);
    const before = await p.evaluate(k => localStorage.getItem(k), KEY + 'people');
    const target = await p.$eval('#people li.person:nth-child(3)', li => li.dataset.id);
    await p.click(`#people li[data-id="${target}"] .del`);
    const cf = await p.$eval(`#people li[data-id="${target}"] .confirm`, el => [...el.querySelectorAll('.btn')].map(b => [getComputedStyle(b).whiteSpace, Math.round(b.getBoundingClientRect().height)]));
    assert(cf.length === 2 && cf.every(([ws, h]) => ws === 'nowrap' && h <= 46), '刪除確認鈕不換行（390 寬）' + JSON.stringify(cf));
    await p.click(`[data-del-yes="${target}"]`);
    assert(await p.isVisible('#toast-act') && (await p.textContent('#toast-act')) === '復原', '刪除提示有「復原」按鈕');
    const bb = await p.$eval('#toast-act', b => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
    assert(bb[0] >= 44 && bb[1] >= 44, '復原鈕 ≥44px ' + bb);
    await p.click('#toast-act');
    const after = await p.evaluate(k => localStorage.getItem(k), KEY + 'people');
    assert(after === before && (await p.$$('#people li.person')).length === 5, '復原後放回原位並存檔');
    await p.click(`#people li[data-id="${target}"] .del`); await p.click(`[data-del-yes="${target}"]`);
    await p.clock.runFor(5200);
    assert(await p.isHidden('#toast'), '5 秒後提示消失');
    await ctx.close();
  }
  // 5. localStorage 被封鎖：不說「已存入」，並顯示警告
  {
    const { ctx, p } = await open(390, 844, {}, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    await p.fill('#name', '甲'); await p.click('#save');
    const t = await toastText(p);
    assert(t.includes('無法儲存') && !t.startsWith('已存入'), 'localStorage 失敗時提示無法儲存：' + t);
    assert(await p.isVisible('#store-warn'), '無法儲存時顯示常駐警告');
    await ctx.close();
  }
  // 6. 1900/1/31 以前切農曆：顯示錯誤並保留國曆日期
  {
    const { ctx, p } = await open();
    await p.fill('#birth', '1880-03-04'); await p.click('#old-ok');
    await p.click('#cal-lunar');
    assert(await p.isVisible('#err') && (await p.textContent('#err')).includes('1900/1/31'), '早於 1900/1/31 切農曆顯示錯誤：' + await p.textContent('#err'));
    assert(await p.getAttribute('#cal-solar', 'aria-pressed') === 'true' && await p.inputValue('#birth') === '1880-03-04', '仍是國曆並保留 1880-03-04');
    // 7. 1900/1/1–1/30 屬己亥豬
    await p.fill('#birth', '1900-01-15'); await p.click('#old-ok').catch(() => {});
    assert((await p.textContent('#animal')).includes('豬') && (await p.textContent('.fact:nth-child(4)')).includes('己亥'), '1900-01-15 春節界屬己亥豬');
    assert((await p.textContent('#lunar-bday')).includes('1900/1/31 以前不支援'), '農曆生日說明 1900/1/31 以前不支援');
    await ctx.close();
  }
  // 8. 匯入 1000 筆：上限和格式不符分開說
  {
    const { ctx, p } = await open();
    const tmp = path.join(path.dirname(WRAP), 'n1000.json');
    fs.writeFileSync(tmp, JSON.stringify({ people: seedPeople(1000).map(x => ({ ...x, name: 'N' + x.id })) }));
    await p.setInputFiles('#import-file', tmp); await p.waitForTimeout(200);
    const t = await toastText(p);
    assert(t.includes('匯入 200 筆') && t.includes('已達 200 筆上限，另有 800 筆未匯入') && !t.includes('格式不符'), '匯入 1000 筆：' + t);
    await ctx.close();
  }
  // 9. 設定 summary 有展開圖示；今天出生試算移入設定；深淺色鈕顯示目前狀態；資料只在本機
  {
    const { ctx, p } = await open(360, 640);
    const mk = () => p.$eval('#settings summary', s => getComputedStyle(s, '::before').content);
    assert(/▸/.test(await mk()), '設定收合時顯示 ▸');
    assert(!(await p.isVisible('#today-btn')), '「今天出生試算」收在設定裡');
    await p.click('#settings summary');
    assert(/▾/.test(await mk()) && await p.isVisible('#today-btn'), '設定展開時顯示 ▾，內含試算鈕');
    assert((await p.textContent('#set-cur')).includes('春節界'), '設定標題顯示目前選項');
    const acts = await p.$$eval('.form > .actions .btn', bs => bs.map(b => Math.round(b.getBoundingClientRect().top)));
    assert(acts.length === 2 && acts[0] === acts[1], '360 寬主要按鈕在同一行');
    const m1 = await p.$eval('#theme', b => [b.dataset.mode, b.getAttribute('aria-label'), b.innerHTML]);
    await p.click('#theme');
    const m2 = await p.$eval('#theme', b => [b.dataset.mode, b.getAttribute('aria-label'), b.innerHTML]);
    assert(m1[0] === 'light' && m2[0] === 'dark' && m1[2] !== m2[2] && m2[1].includes('深色'), '深淺色鈕圖示隨目前模式改變');
    assert((await p.textContent('body')).includes('資料只存在這台裝置'), '說明資料只存在本機');
    assert(!/\p{Extended_Pictographic}/u.test(await p.textContent('#animal')), '生肖印章內沒有彩色表情符號');
    // 10. 農曆年打到一半不跳錯誤
    await p.click('#cal-lunar'); await p.fill('#lunar-y', ''); await p.type('#lunar-y', '19');
    assert(await p.isHidden('#err') && await p.$('#real-age'), '農曆年打「19」時不顯示錯誤、不清空結果');
    await p.type('#lunar-y', '89'); await p.selectOption('#lunar-m', '12'); await p.selectOption('#lunar-d', '24');
    assert((await p.textContent('#lunar-conv')).includes('1990-01-20'), '打滿 4 位數後照常換算');
    await p.fill('#lunar-y', '19'); await p.$eval('#lunar-y', e => e.blur()); await p.dispatchEvent('#lunar-y', 'change');
    assert(await p.isVisible('#err'), '離開欄位後才提示年份錯誤');
    await ctx.close();
  }
  // 11. 農曆三十在小月：說明以廿九計；（日）不單獨換行
  {
    const { ctx, p } = await open();
    const hit = await p.evaluate(() => { for (let y = 1950; y <= 2000; y++) for (let m = 1; m <= 12; m++) { if (!window.__age.lunarToSolar(y, m, 30, false)) continue; const nb = window.__age.nextBirthday({ date: y + '-' + String(m).padStart(2, '0') + '-30', calendar: 'lunar' }, '2026-10-13'); if (nb && nb.shortMonth) return [y, m]; } return null; });
    assert(!!hit, '找到農曆三十、今年該月只有 29 天的例子 ' + hit);
    if (hit) {
      await p.click('#cal-lunar'); await p.fill('#lunar-y', String(hit[0])); await p.selectOption('#lunar-m', String(hit[1])); await p.selectOption('#lunar-d', '30');
      assert((await p.textContent('#next-bday')).includes('以廿九計'), '下次農曆生日說明以廿九計：' + await p.textContent('#next-bday'));
    }
    await p.click('#cal-solar'); await p.fill('#birth', '1990-01-20');
    const ob = await p.$eval('#other-bday .v', v => { const r = v.getClientRects(); return [v.textContent, Math.round(v.getBoundingClientRect().height), parseFloat(getComputedStyle(v).lineHeight)]; });
    assert(ob[1] <= ob[2] * 1.5 && !ob[0].includes('（'), '下次農曆生日的值一行顯示，星期另放說明列 ' + JSON.stringify(ob));
    assert(await p.$eval('#next-bday .when .nw', e => getComputedStyle(e).whiteSpace === 'nowrap'), '日期與（星期）不拆行');
    await ctx.close();
  }
  // 12. 844×390 橫向：第一個畫面看得到結果，無橫向捲動
  for (const [w, h] of [[844, 390], [360, 640], [700, 800]]) {
    const { ctx, p } = await open(w, h);
    const r = await p.evaluate(() => { const hero = document.querySelector('#out .hero').getBoundingClientRect(); return [Math.round(hero.top), document.documentElement.scrollWidth, innerWidth, Math.round(document.querySelector('#birth').getBoundingClientRect().width)]; });
    assert(r[1] <= r[2], `${w}×${h} 無橫向捲動 ${r[1]}/${r[2]}`);
    if (w >= 700) assert(r[0] + 120 < h && r[3] <= 360, `${w}×${h} 結果在第一個畫面（hero top ${r[0]}），日期欄寬 ${r[3]}`);
    await ctx.close();
  }
  // 13. 舊資料鍵仍可讀（在頁面載入前寫入，模擬舊版留下的資料）
  {
    const { ctx, p } = await open(390, 844, {}, () => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); const k = 'age-zodiac:v1:'; localStorage.setItem(k + 'people', JSON.stringify([{ id: 'a', name: '媽媽', date: '1962-10-15', calendar: 'solar' }, { id: 'b', name: '阿公', date: '1938-08-15', calendar: 'lunar', leap: false }])); localStorage.setItem(k + 'current', JSON.stringify({ name: '舊', calendar: 'solar', date: '1980-02-02', leap: false, example: false })); localStorage.setItem(k + 'settings', JSON.stringify({ leapRule: 'mar1', zodiacRule: 'lichun' })); });
    assert((await p.$$('#people li.person')).length === 2 && await p.inputValue('#name') === '舊' && await p.inputValue('#birth') === '1980-02-02' && await p.inputValue('#zodiac-rule') === 'lichun', '舊 localStorage 鍵照常載入');
    await ctx.close();
  }
  await browser.close();
  fs.rmSync(path.dirname(WRAP), { recursive: true, force: true });
  assert(errors.length === 0, '無 console／page error ' + JSON.stringify(errors));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})();
