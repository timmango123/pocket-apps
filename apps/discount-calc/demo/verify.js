// 折扣計算驗證：node verify.js
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
  const TABS = ['disc', 'spend', 'tip', 'cmp'];
  for (const [name, w, h, mob] of [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(URL); await p.waitForTimeout(150);
    const iw = await p.evaluate(() => innerWidth);
    assert(iw === w, `${name} innerWidth = ${iw}`);
    for (const t of TABS) {
      await p.click('#tab-' + t); await p.waitForTimeout(40);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      assert(sw <= iw, `${name} ${t} 無水平捲動 (${sw})`);
      if (name === '390x844') {
        await p.screenshot({ path: `${OUT}/${name}-${t}.png`, fullPage: true });
        const small = await p.evaluate(() => [...document.querySelectorAll('button, input, select')].filter(e => e.offsetParent && e.type !== 'checkbox').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.className, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
        assert(small.length === 0, `${t} 觸控目標 ≥44px ` + JSON.stringify(small));
      }
    }
    await p.click('#tab-disc');
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await p.click('#tab-cmp'); await p.screenshot({ path: `${OUT}/390x844-dark-cmp.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(150);
  const fill = async (sel, v) => { await p.fill(sel, String(v)); };
  const txt = s => p.textContent(s);
  await p.click('#tab-disc');
  assert((await txt('#d-final')).replace(/\s/g, '') === '$765', '1000 元 85 折再 9 折 = 765');
  assert((await txt('#d-eq')) === '相當於 76.5 折', '顯示「相當於 76.5 折」');
  await p.click('#copy-btn'); await p.waitForTimeout(100);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip.startsWith('原價 $1,000 → 85 折再 9 折 → $765（省 $235）'), '複製格式: ' + clip.split('\n')[0]);
  const rates = await p.evaluate(() => ['85', '8.5', '15% off', '85折', '0', '11', '-5', '9'].map(s => { const r = window.__discountCalc.parseRate(s); return r.err ? 'E' : r.r; }).join(','));
  assert(rates === '0.85,0.85,0.85,0.85,E,E,E,0.9', '折數解析三種寫法一致，0／11／負數為錯誤 ' + rates);
  for (const bad of ['0', '11', '-3']) { await fill('#d-rate1', bad); assert((await txt('#d-rate1-msg')).length > 0, `輸入 ${bad} 顯示錯誤提示：` + await txt('#d-rate1-msg')); }
  await fill('#d-rate1', '15% off'); assert((await txt('#d-final')).replace(/\s/g, '') === '$765', '15% off 再 9 折 = 765');
  await p.click('#d-rate2-chip-08');
  assert((await txt('#d-final')).replace(/\s/g, '') === '$680' && (await txt('#d-eq')) === '相當於 68 折', '85 折再 8 折 = 680（相當於 68 折）');
  await fill('#d-price', '99.999'); assert((await txt('#d-price-msg')).includes('捨去'), '小數第三位提示');
  await fill('#d-price', '100000000'); assert((await txt('#d-price-msg')).includes('上限'), '金額上限提示');
  await fill('#d-price', '1000');
  assert((await txt('#n-total')).replace(/\s/g, '') === '$1,120' && (await txt('#n-avg')) === '$280', '350 元 4 件第二件 6 折 = 1,120，平均 280');
  await p.uncheck('#n-cycle');
  assert((await txt('#n-total')).replace(/\s/g, '') === '$980', '第 2 件起都 6 折 = 980');

  await p.click('#tab-spend');
  assert((await txt('#s-off')) === '$200' && (await txt('#s-final')).replace(/\s/g, '') === '$2,150', '滿千折百累計：2350 折 200');
  assert((await txt('#s-hint')) === '再買 $650 可再折 $100', '提示「再買 650 元可再折 100」');
  await p.click('#s-mode-once');
  assert((await txt('#s-off')) === '$100', '單次：折 100');

  await p.click('#tab-tip');
  assert((await txt('#t-tip')) === '$128' && (await txt('#t-main')).replace(/\s/g, '') === '$352', '1280 元 10%，4 人每人 352');
  await p.click('#t-minus');
  assert((await txt('#t-main')).replace(/\s/g, '') === '$470' && (await txt('#t-extra')) === '$2', '3 人進位到元每人 470，多收 2 元');
  await p.click('#t-round-10');
  assert((await txt('#t-main')).replace(/\s/g, '') === '$470' && (await txt('#t-extra')) === '$2', '進位到 10 元仍 470');
  await p.click('#t-chip-15');
  assert((await txt('#t-tip')) === '$192', '15% = 192');

  await p.click('#tab-cmp');
  const badges = await p.$$eval('.pcard .badge', bs => bs.map(b => b.textContent));
  assert(badges[0] === '貴 5%' && badges[1] === '最划算', '500g $89 vs 1kg $169：1kg 最划算 ' + badges.join('/'));
  await p.click('#cmp-add');
  await fill('#cmp-price-3', '60'); await fill('#cmp-qty-3', '1'); await p.selectOption('#cmp-unit-3', 'L');
  assert((await txt('#cmp-msg')).includes('不能互相比較'), '不同單位類別顯示提示');
  for (let i = 0; i < 8; i++) if (await p.isVisible('#cmp-add')) await p.click('#cmp-add');
  assert((await p.locator('.pcard').count()) === 10 && !(await p.isVisible('#cmp-add')), '上限 10 張且隱藏新增鈕');
  await p.reload(); await p.waitForTimeout(150);
  assert((await p.locator('.pcard').count()) === 10 && await p.isVisible('#p-cmp'), '重新整理後保留比價卡片與分頁');
  await p.click('#reset-btn'); await p.click('#reset-btn');
  assert((await p.locator('.pcard').count()) === 2, '兩段式重設回範例');
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? fails + ' 項失敗' : '全部通過'); process.exit(fails ? 1 : 0);
})();
