// 複利與存錢計畫驗證：node verify.js
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
    await p.goto(URL); await p.waitForTimeout(200);
    const [sw, iw] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    assert(sw <= iw, `${name} 無水平捲動 (${sw} <= ${iw})`);
    await p.screenshot({ path: `${OUT}/${name}.png` });
    if (name === '390x844') {
      await p.screenshot({ path: `${OUT}/${name}-full.png`, fullPage: true });
      const small = await p.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent.trim().slice(0, 8), Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
      assert(small.length === 0, '觸控目標 ≥44px ' + JSON.stringify(small));
      // 旋轉後重繪
      await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(150);
      const cw = await p.evaluate(() => [document.querySelector('#chart').width, document.querySelector('#chart').clientWidth * devicePixelRatio]);
      assert(Math.abs(cw[0] - cw[1]) <= 1, 'canvas 旋轉後重設尺寸 ' + cw);
    }
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(200);
  const set = async (sel, v) => { await p.fill(sel, v); await p.waitForTimeout(220); };
  const yuan = s => Number(String(s).replace(/[^\d.−-]/g, '').replace('−', '-'));
  // 案例 1：每月 1 萬、年 6% 月複利、20 年，本金 0
  await set('#principal', '0'); await set('#monthly', '10000'); await set('#rate', '6'); await set('#years', '20'); await set('#inflation', '');
  const excel = 10000 * ((Math.pow(1.005, 240) - 1) / 0.005); // FV(0.005,240,-10000)
  let fv = yuan(await p.textContent('#r-main'));
  assert(Math.abs(fv - excel) <= 1, `月底投入 FV=${fv}，Excel FV=${excel.toFixed(2)}`);
  await p.click('#timing-begin'); await p.waitForTimeout(50);
  fv = yuan(await p.textContent('#r-main'));
  assert(Math.abs(fv - excel * 1.005) <= 1, `月初投入 FV=${fv}，Excel FV(type=1)=${(excel * 1.005).toFixed(2)}`);
  await p.click('#timing-end');
  // 案例 2：0% 時終值 = 總投入
  await set('#principal', '50000'); await set('#rate', '0');
  fv = yuan(await p.textContent('#r-main'));
  assert(fv === 50000 + 10000 * 240, '報酬率 0% 終值 = 總投入 ' + fv);
  // 負報酬
  await set('#rate', '-10');
  assert((await p.textContent('#r-ratio-sub')) === '虧損', '負報酬顯示虧損');
  // 全部為 0
  await set('#principal', '0'); await set('#monthly', '0');
  assert(await p.isVisible('#msg') && (await p.textContent('#msg')).includes('請輸入本金或每月投入'), '全 0 提示');
  // 案例 3：目標 1000 萬反推
  await set('#principal', '0'); await set('#monthly', '10000'); await set('#rate', '6');
  await p.click('#mode-pmt'); await set('#target', '10000000'); await set('#years', '20');
  const pmt = yuan(await p.textContent('#r-main'));
  const check = await p.evaluate(pm => { const s = window.__savings.simulate({ principal: 0, monthly: pm * 100, target: 1e9, rate: .06, freq: 'm', timing: 'end', growth: 0, months: 240 }); return s[240].balance / 100; }, pmt);
  assert(check >= 1e7 && check - 1e7 < pmt, `每月需存 ${pmt} 元，代回終值 ${check}（≥ 目標且差 < 1 次投入）`);
  await p.screenshot({ path: `${OUT}/390x844-pmt.png` });
  // 算需要幾年
  await p.click('#mode-years'); await p.waitForTimeout(50);
  const yt = await p.textContent('#r-main');
  const exp = await p.evaluate(() => { const s = window.__savings.simulate({ principal: 0, monthly: 1e6, target: 1e9, rate: .06, freq: 'm', timing: 'end', growth: 0, months: 1200, stopAtTarget: true }); return s.reach; });
  assert(yt.replace(/\s/g, '') === (Math.floor(exp / 12) + '年' + (exp % 12 ? exp % 12 + '個月' : '')), `需要幾年 ${yt}（${exp} 個月）`);
  assert((await p.textContent('#r-goal')).includes('達成'), '目標達成文字: ' + await p.textContent('#r-goal'));
  await set('#monthly', '1'); await set('#rate', '0');
  assert((await p.textContent('#msg')).includes('100 年內無法達成'), '100 年內無法達成');
  // 100 年繪圖時間
  await p.click('#mode-fv'); await set('#monthly', '10000'); await set('#rate', '6'); await set('#years', '100');
  const ms = await p.evaluate(() => { const t = performance.now(); window.dispatchEvent(new Event('resize')); return new Promise(r => requestAnimationFrame(() => r(performance.now() - t))); });
  assert(ms < 100, '100 年重繪 ' + ms.toFixed(1) + 'ms');
  assert((await p.$$eval('#table tbody tr', r => r.length)) === 100, '年度表 100 列');
  // 拖曳提示
  await p.locator('#chart').scrollIntoViewIfNeeded(); const box = await p.locator('#chart').boundingBox();
  await p.touchscreen.tap(box.x + box.width * 0.6, box.y + box.height / 2); await p.waitForTimeout(50);
  assert(await p.isVisible('#tip') && (await p.textContent('#tip')).includes('年底'), '圖表點按顯示年度數值');
  await set('#years', '20');
  await p.click('#copy'); await p.waitForTimeout(150);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip.split('\n').length === 22 && clip.startsWith('年\t年底累積'), '複製 Tab 分隔表格 ' + clip.split('\n').length + ' 行');
  // 輸入記憶
  await p.waitForTimeout(400); await p.reload(); await p.waitForTimeout(200);
  assert((await p.inputValue('#years')) === '20' && (await p.inputValue('#monthly')) === '10000', '重新整理保留輸入');
  await p.screenshot({ path: `${OUT}/390x844-flow.png`, fullPage: true });
  await ctx.close();
  await browser.close();
  assert(errors.length === 0, '無 console error ' + JSON.stringify(errors));
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
