// 科學計算機驗證：node verify.js
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
  for (const [name, w, h, mob] of [['390x844', 390, 844, true], ['360x780', 360, 780, true], ['844x390', 844, 390, true], ['1280x800', 1280, 800, false]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2 });
    const p = await ctx.newPage(); watch(p, name);
    await p.goto(URL); await p.waitForTimeout(150);
    const [sw, iw, sh, ih] = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
    assert(iw === w, `${name} innerWidth = ${iw}`); assert(sw <= iw, `${name} 無水平捲動 (${sw})`); assert(sh <= ih, `${name} 單屏無垂直溢出 (${sh} <= ${ih})`);
    const small = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id, Math.round(r.width), Math.round(r.height)]; }).filter(x => x[1] < 44 || x[2] < 44));
    assert(small.length === 0, `${name} 按鍵 ≥44px ` + JSON.stringify(small.slice(0, 6)));
    const minKey = await p.evaluate(() => Math.min(...[...document.querySelectorAll('#pad-basic .k')].map(k => k.getBoundingClientRect().height)));
    console.log('     基本鍵最小高度 ' + Math.round(minKey) + 'px');
    await p.screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const p = await ctx.newPage(); watch(p, 'dark');
    await p.goto(URL); await p.waitForTimeout(150);
    await p.screenshot({ path: `${OUT}/390x844-dark.png` });
    await p.click('#btn-history'); await p.waitForTimeout(100);
    await p.screenshot({ path: `${OUT}/390x844-dark-history.png` });
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL); await p.waitForTimeout(150);
  const st = await p.evaluate(() => window.__sciCalc.selfTest());
  assert(st.fails.length === 0, `頁內自我測試 ${st.total - st.fails.length}/${st.total} 通過 ` + st.fails.join('; '));
  const tap = async (...ids) => { for (const id of ids) await p.tap('#' + id); };
  const res = () => p.textContent('#res');
  await tap('key-ac', 'key-2', 'key-add', 'key-3', 'key-mul', 'key-4');
  assert((await res()) === '14', '即時預覽 2+3×4 = 14');
  await tap('key-eq'); assert((await res()) === '14' && (await p.textContent('#prev')) === '2+3×4 =', '按 = 後結果 14');
  await tap('key-add', 'key-1', 'key-eq'); assert((await res()) === '15', '接續上次結果 14+1 = 15');
  await tap('key-ac', 'key-1', 'key-div', 'key-0', 'key-eq'); assert((await res()) === '無法除以 0', '1÷0 顯示「無法除以 0」');
  await tap('key-ac', 'key-sqrt', 'key-sub', 'key-1', 'key-eq'); assert((await res()) === '定義域錯誤', '√(−1) 顯示「定義域錯誤」');
  await tap('key-ac', 'key-sin', 'key-3', 'key-0'); assert((await res()) === '0.5' && (await p.textContent('#expr')).includes(')'), 'DEG sin(30 自動補括號 = 0.5');
  await tap('key-ac', 'btn-angle', 'key-sin', 'key-pi', 'key-div', 'key-6'); assert((await res()) === '0.5', 'RAD sin(π÷6) = 0.5');
  await tap('btn-angle');
  await tap('key-ac', 'key-1', 'key-7', 'key-1', 'key-fact', 'key-eq'); assert((await res()) === '溢位', '171! 顯示溢位');
  await tap('key-ac', 'key-5', 'key-add', 'key-mul'); assert((await p.textContent('#expr')).startsWith('5×'), '連續運算子以後者取代');
  await tap('key-ac', 'key-1', 'key-dot', 'key-2', 'key-dot', 'key-3'); assert((await p.textContent('#expr')).startsWith('1.23'), '每個數字只能一個小數點');
  await tap('key-ac', 'key-2', 'btn-second', 'key-sq'); assert((await p.textContent('#expr')).startsWith('2³'), '2nd 將 x² 切換為 x³');
  await tap('key-eq'); await tap('key-mplus'); await tap('key-ac', 'key-mr'); assert((await res()) === '8', 'M+ 後 MR 取回 8');
  await tap('key-mc');
  // 鍵盤
  await tap('key-ac'); await p.keyboard.type('2^3^2'); await p.keyboard.press('Enter');
  assert((await res()) === '512', '實體鍵盤 2^3^2 Enter = 512');
  await p.keyboard.press('Backspace'); await p.keyboard.press('Escape');
  assert((await p.textContent('#expr')) === '', 'Esc 清除');
  // 滑動刪字
  await p.keyboard.type('123');
  const b = await p.locator('#lcd').boundingBox();
  await p.evaluate(({ x, y }) => { const el = document.getElementById('lcd'); const o = { bubbles: true, pointerType: 'touch', isPrimary: true }; el.dispatchEvent(new PointerEvent('pointerdown', { ...o, clientX: x, clientY: y })); el.dispatchEvent(new PointerEvent('pointermove', { ...o, clientX: x - 80, clientY: y })); el.dispatchEvent(new PointerEvent('pointerup', { ...o, clientX: x - 80, clientY: y })); }, { x: b.x + b.width - 20, y: b.y + 40 });
  assert((await p.textContent('#expr')) === '12', '顯示窗左滑刪一字');
  // 快速連點不縮放
  for (let i = 0; i < 6; i++) await p.tap('#key-7');
  const scale = await p.evaluate(() => window.visualViewport ? visualViewport.scale : 1);
  assert(scale === 1, '快速連點不會縮放頁面');
  // 歷史
  await p.tap('#btn-history'); await p.waitForTimeout(80);
  const items = await p.locator('#hist li').count();
  assert(items >= 5, '歷史抽屜列出紀錄 ' + items + ' 筆');
  await p.tap('#hist [data-cp]'); await p.waitForTimeout(100);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  assert(clip === '512', '歷史複製結果 ' + clip);
  await p.tap('#hist .use');
  assert((await p.textContent('#expr')).endsWith('512') && await p.isHidden('#drawer'), '點歷史把結果帶回算式');
  await p.reload(); await p.waitForTimeout(150);
  await p.tap('#btn-history');
  assert((await p.locator('#hist li').count()) === items, '重新整理後歷史仍在');
  assert(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? fails + ' 項失敗' : '全部通過'); process.exit(fails ? 1 : 0);
})();
