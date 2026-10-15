// BMI 與熱量計算驗證：node verify.js
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
  const sizes = [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]];
  for (const [name, w, h, mob] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(URL); await p.waitForTimeout(150);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    assert(sw <= iw, `${name} 無水平捲動 (${sw} <= ${iw})`);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(e => e.offsetParent && e.type !== 'checkbox').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(150);
  const t = s => p.textContent(s);
  // 範例：30 歲男 170/65 中度
  assert((await t('#bmi')) === '22.5' && (await t('#bmi-cls')) === '正常', '170 cm 65 kg → BMI 22.5 正常');
  const pure = await p.evaluate(() => { const b = window.__body.bmr({ sex: 'm', age: 30, cm: 170, kg: 65 }); return [b.v, window.__body.tdee(b.v, 2)]; });
  assert(pure[0] === 1567.5 && Math.round(pure[1]) === 2430, 'BMR 1567.5、TDEE 2430（純函式）');
  assert((await t('#bmr')) === '1,568' && (await t('#tdee')) === '2,430' && (await t('#target')) === '2,430', '畫面 BMR 1,568 / TDEE 2,430 / 目標 2,430');
  // 營養素：維持 1.6 g/kg → 104 g；脂肪 25% → 67.5 → 68 g；碳水 (2430-416-607.5)/4=351.6 → 352
  const tdeeV = pure[1], fatG = Math.round(Math.round(tdeeV) * .25 / 9), carbG = Math.round((Math.round(tdeeV) - 104 * 4 - Math.round(tdeeV) * .25) / 4);
  assert((await t('#pro')) === '104 g' && (await t('#fat')) === fatG + ' g' && (await t('#carb')) === carbG + ' g', `營養素 104 / ${fatG} / ${carbG} g：` + [await t('#pro'), await t('#fat'), await t('#carb')]);
  await p.screenshot({ path: `${OUT}/390x844-results.png`, fullPage: true });
  // 減脂低於下限警告：女 50 歲 150 cm 45 kg 久坐 減 0.5
  await p.click('#sex-f'); await p.fill('#age', '50'); await p.fill('#height', '150'); await p.fill('#weight', '45');
  await p.click('#act-0'); await p.click('#goal-lose'); await p.click('#rate-50');
  assert(await p.isVisible('#warn') && (await t('#target')) === '1,200', '減脂低於女性下限 1200 顯示警告');
  // 邊界：身高 0 / 999
  await p.fill('#height', '0');
  assert((await t('#bmi')) === '—' && !(await p.evaluate(() => document.body.innerText)).match(/Infinity|NaN/), '身高 0 不出現 Infinity/NaN');
  await p.fill('#height', '999');
  assert((await t('#bmi')) === '—' && (await t('#err')).includes('請確認數值'), '身高 999 顯示請確認數值');
  await p.fill('#height', '');
  assert((await t('#tdee')) === '—', '空白欄位顯示 —');
  await p.fill('#height', '170'); await p.fill('#age', '16');
  assert(await p.isVisible('#teen'), '未滿 18 歲加註');
  // Katch-McArdle
  await p.fill('#age', '30'); await p.fill('#weight', '65'); await p.fill('#bodyfat', '20'); await p.check('#katch');
  assert((await t('#bmr')) === '1,493' && (await t('#bmr-f')) === 'Katch-McArdle', 'Katch-McArdle 370+21.6×52 = 1,493');
  // 英制
  await p.click('#unit-imperial');
  assert((await p.inputValue('#height-ft')) === '5' && (await p.inputValue('#weight-lb')) === '143.3', '英制換算 5 ft / 143.3 lb');
  await p.fill('#weight-lb', '154.3');
  assert((await t('#bmi')) === '24.2' && (await t('#bmi-cls')) === '過重', '154.3 lb → BMI 24.2 過重');
  await p.click('#unit-metric');
  // 體重紀錄
  assert((await t('#chartbox')).includes('還沒有紀錄'), '無紀錄提示');
  const iso = d => d.toISOString().slice(0, 10);
  const day = k => { const d = new Date(); d.setDate(d.getDate() - k); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  await p.fill('#log-date', day(0)); await p.fill('#log-kg', '68.2'); await p.click('#log-add');
  assert((await t('#chartbox')).includes('再紀錄一天'), '1 筆時提示再紀錄一天');
  await p.fill('#log-date', day(0)); await p.fill('#log-kg', '68.0'); await p.click('#log-add');
  assert((await p.$$eval('#logs li', l => l.length)) === 1, '同日覆寫只保留一筆');
  for (const [k, v] of [[3, '68.9'], [7, '69.4'], [12, '69.8'], [20, '70.1']]) { await p.fill('#log-date', day(k)); await p.fill('#log-kg', v); await p.click('#log-add'); }
  assert(await p.isVisible('#chartbox svg'), '多筆後顯示折線圖');
  await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(150);
  assert((await p.$$eval('#logs li', l => l.length)) === 5 && (await p.inputValue('#bodyfat')) === '20', '重新整理保留資料');
  await p.evaluate(() => document.querySelector('#chartbox').scrollIntoView());
  await p.screenshot({ path: `${OUT}/390x844-log.png` });
  await ctx.close();
  await browser.close();
  assert(errors.length === 0, '無 console error ' + JSON.stringify(errors));
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
