// 年齡與星座查詢驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (p, tag) => { p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); }); p.on('pageerror', e => errors.push(tag + ': ' + e.message)); };
  const seed = async p => { await p.evaluate(() => { localStorage.setItem('age-zodiac:v1:people', JSON.stringify([{ id: 'a', name: '媽媽', date: '1962-10-15', calendar: 'solar' }, { id: 'b', name: '阿公', date: '1938-08-15', calendar: 'lunar', leap: false }, { id: 'c', name: '小美', date: '1998-02-03', calendar: 'solar' }, { id: 'd', name: '同事 Kevin', date: '1993-12-24', calendar: 'solar' }])); }); await p.reload(); await p.waitForTimeout(100); };
  const sizes = [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]];
  for (const [name, w, h, mob] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await p.goto(URL); await seed(p);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    assert(sw <= iw, `${name} 無水平捲動 (${sw} <= ${iw})`);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, select, summary, label.btn')].filter(e => e.offsetParent && e.type !== 'file').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.clock.setFixedTime(new Date('2026-10-13T10:00:00'));
    await p.goto(URL); await seed(p);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.clock.setFixedTime(new Date('2026-10-07T10:00:00')); // 規格範例的「今天」
  await p.goto(URL); await p.waitForTimeout(100);
  await p.click('#copy'); await p.waitForTimeout(100);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip === '小明｜1990-01-20 生｜實歲 36｜虛歲 38｜屬蛇｜水瓶座｜下次生日還有 105 天', '範例複製格式：' + clip);
  assert((await p.textContent('#animal')).includes('蛇'), '1990-01-20（農曆己巳年臘月）屬蛇而非馬');
  const A = (a, b) => p.evaluate(([a, b]) => window.__age.calcAge(a, b), [a, b]);
  let r = await A('2000-02-29', '2026-02-28');
  assert(r.y === 26 && r.m === 0 && r.d === 0, '2000-02-29 在 2026-02-28 滿 26 歲（預設 2/28 規則）' + JSON.stringify(r));
  r = await A('2000-02-29', '2026-02-27');
  assert(r.y === 25, '2026-02-27 仍為 25 歲');
  r = await A('1990-01-20', '2026-10-07');
  assert(r.y === 36 && r.m === 8 && r.d === 17, '1990-01-20 → 2026-10-07 = 36 歲 8 個月 17 天 ' + JSON.stringify(r));
  const Z = (m, d) => p.evaluate(([m, d]) => window.__age.zodiacSign(m, d).name, [m, d]);
  assert(await Z(3, 20) === '雙魚座' && await Z(3, 21) === '牡羊座', '3/20 雙魚、3/21 牡羊');
  assert(await Z(1, 19) === '摩羯座' && await Z(1, 20) === '水瓶座' && await Z(12, 22) === '摩羯座' && await Z(12, 21) === '射手座', '摩羯跨年邊界');
  const sp = await p.evaluate(() => [1900, 1990, 2024, 2026, 2100].map(y => window.__age.spring(y)));
  assert(JSON.stringify(sp) === JSON.stringify(['1900-01-31', '1990-01-27', '2024-02-10', '2026-02-17', '2100-02-09']), '春節表 ' + sp);
  assert(await p.evaluate(() => window.__age.lunarToSolar(2023, 2, 1, true)) === '2023-03-22', '農曆 2023 閏二月初一 = 2023-03-22');
  // 立春界：1990-02-03（春節後、立春前）
  await p.fill('#birth', '1990-02-03');
  assert((await p.textContent('#animal')).includes('馬'), '1990-02-03 春節界屬馬');
  await p.click('#settings summary'); await p.selectOption('#zodiac-rule', 'lichun');
  assert((await p.textContent('#animal')).includes('蛇'), '1990-02-03 立春界屬蛇');
  await p.selectOption('#zodiac-rule', 'cny');
  // 未來日期
  await p.fill('#birth', '2026-10-08');
  assert((await p.textContent('#err')) === '生日不能晚於今天', '明天日期顯示錯誤');
  await p.fill('#birth', '1880-01-01');
  assert(await p.isVisible('#old-warn'), '超過 130 歲顯示確認');
  await p.click('#old-ok');
  assert((await p.textContent('#lunar-bday')).includes('1900/1/31 以前不支援'), '1900/1/31 前農曆功能不支援並說明');
  // 今天生日
  await p.fill('#birth', '2000-10-07');
  assert((await p.textContent('#next-bday')).includes('今天生日'), '今天生日顯示');
  // 農曆輸入
  await p.click('#cal-lunar');
  await p.fill('#lunar-y', '1989'); await p.selectOption('#lunar-m', '12'); await p.selectOption('#lunar-d', '24');
  assert((await p.textContent('#lunar-conv')).includes('1990-01-20'), '農曆 1989 臘月廿四 = 1990-01-20');
  const nbText = await p.textContent('#next-bday');
  const nbExp = await p.evaluate(() => window.__age.lunarToSolar(2026, 12, 24, false));
  const nbDays = Math.round((Date.parse(nbExp) - Date.parse('2026-10-07')) / 864e5);
  assert(nbText.includes(String(nbDays)) && nbText.includes('農曆'), `下次農曆生日 ${nbExp}，還有 ${nbDays} 天：${nbText}`);
  await p.screenshot({ path: `${OUT}/390x844-lunar.png`, fullPage: true });
  await p.click('#cal-solar');
  // 親友清單 20 筆排序
  const names = [];
  for (let i = 0; i < 20; i++) {
    const m = 1 + (i * 7) % 12, d = 1 + (i * 11) % 28, nm = '親友' + String(i + 1).padStart(2, '0');
    names.push(nm);
    await p.fill('#name', nm); await p.fill('#birth', `19${70 + i}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`); await p.click('#save');
  }
  const daysList = await p.$$eval('#people .days b', b => b.map(x => x.textContent === '今天' ? 0 : +x.textContent));
  assert(daysList.length === 20 && daysList.every((v, i) => i === 0 || v >= daysList[i - 1]), '20 筆依下次生日排序 ' + daysList.join(','));
  // 7 天內標示
  await p.fill('#name', '下週壽星'); await p.fill('#birth', '1985-10-12'); await p.click('#save');
  assert(await p.$eval('#people li:first-child', li => li.classList.contains('soon') && li.textContent.includes('下週壽星')), '7 天內強調色且排第一');
  // 刪除確認
  await p.click('#people li:first-child .del');
  assert(await p.isVisible('[data-del-yes]'), '頁內刪除確認');
  await p.click('[data-del-yes]');
  assert((await p.$$('#people li')).length === 20, '刪除後 20 筆');
  await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(100);
  assert((await p.$$('#people li')).length === 20, '重新整理後保留 20 筆');
  // 點清單帶入
  await p.click('#people li:first-child .open');
  assert((await p.inputValue('#name')).startsWith('親友'), '點清單帶入查詢');
  // 匯入
  const tmp = path.resolve(__dirname, '_import.json');
  fs.writeFileSync(tmp, JSON.stringify({ people: [{ name: '匯入A', date: '2001-05-05', calendar: 'solar' }, { name: '壞資料', date: '2001-02-30', calendar: 'solar' }] }));
  await p.setInputFiles('#import-file', tmp); await p.waitForTimeout(150); fs.unlinkSync(tmp);
  assert((await p.textContent('#toast')).includes('匯入 1 筆，略過 1 筆'), '匯入逐筆驗證：' + await p.textContent('#toast'));
  await ctx.close();
  await browser.close();
  assert(errors.length === 0, '無 console error ' + JSON.stringify(errors));
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
