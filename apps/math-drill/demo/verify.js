// 九九乘法練習驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html'), OUT = __dirname;
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
async function open(browser, opt) {
  const ctx = await browser.newContext(opt);
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(200);
  return { ctx, page, errors };
}
// 用螢幕鍵盤（觸控）輸入一個數字並確認
async function answer(page, val) {
  for (const d of String(val)) await page.tap(`.key[data-k="${d}"]`);
  await page.tap('#key-ok');
}
const waitNext = page => page.waitForFunction(() => Q && (Q.done || !Q.locked), null, { timeout: 4000 });
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 1. 出題規則（各 1000 題）
  const gen = await page.evaluate(() => {
    const r = {};
    const c10 = { ...DEFAULT_CFG, ops: ['add', 'sub'], addRange: '10' };
    let bad = 0; for (let i = 0; i < 1000; i++) { const q = genOne(c10); if (q.op === 'add' && (q.a + q.b > 10 || q.a < 0 || q.b < 0)) bad++; if (q.op === 'sub' && (q.ans < 0 || q.a > 10)) bad++; }
    r.addsub = bad;
    const c100 = { ...DEFAULT_CFG, ops: ['sub'], addRange: 'custom', addMax: 100 }; bad = 0; let maxA = 0;
    for (let i = 0; i < 1000; i++) { const q = genOne(c100); if (q.ans < 0) bad++; maxA = Math.max(maxA, q.a); } r.sub100 = bad; r.maxA = maxA;
    const cd = { ...DEFAULT_CFG, ops: ['div'] }; bad = 0;
    for (let i = 0; i < 1000; i++) { const q = genOne(cd); if (q.b === 0 || q.a % q.b !== 0 || !Number.isInteger(q.ans) || q.ans < 1 || q.ans > 9) bad++; } r.div = bad;
    const cm = { ...DEFAULT_CFG, ops: ['mul'], mulMode: 'tables', tables: [7] }; bad = 0;
    for (let i = 0; i < 1000; i++) { const q = genOne(cm); if (!(q.a === 7 || q.b === 7) || q.ans !== q.a * q.b || Math.max(q.a, q.b) > 9) bad++; } r.mul7 = bad;
    const c12 = { ...DEFAULT_CFG, ops: ['mul'], mulMode: 'tables', tables: [12] }; let m12 = 0; for (let i = 0; i < 500; i++) { const q = genOne(c12); m12 = Math.max(m12, Math.min(q.a, q.b)); } r.m12 = m12;
    // 弱點權重：w = 1 + 3×錯誤率 + min(平均秒/3, 2) + 7 天未練 0.5
    const now = Date.now();
    const w = Object.fromEntries(weakWeights({ '7x8': { n: 4, wrong: 2, totalMs: 24000, last: now }, '2x3': { n: 5, wrong: 0, totalMs: 5000, last: now - 8 * 864e5 }, '3+4': { n: 3, wrong: 3, totalMs: 9000, last: now } }, ['mul'], now));
    r.w = w;
    return r;
  });
  ok(gen.addsub === 0, '加減 10 以內 1000 題：和 ≤ 10、差不為負');
  ok(gen.sub100 === 0 && gen.maxA <= 100, `減法 100 以內：無負數（最大被減數 ${gen.maxA}）`);
  ok(gen.div === 0, '除法 1000 題：除數 ≠ 0、皆整除');
  ok(gen.mul7 === 0, '指定 7 的段：每題含 7、乘數 1–9');
  ok(gen.m12 === 12, '12 的段乘數可到 12');
  ok(Math.abs(gen.w['7x8'] - 4.5) < 1e-9 && Math.abs(gen.w['2x3'] - (1 + 0 + 1 / 3 + .5)) < 1e-9 && !('3+4' in gen.w), `弱點權重：7×8（錯 50%、6 秒）= ${gen.w['7x8']}；2×3（全對、1 秒、8 天未練）= ${gen.w['2x3'].toFixed(3)}；未選的加法不列入`);

  // 2. 未勾運算不能開始
  await page.tap('#op-mul');
  ok(await page.isDisabled('#btn-start') && (await page.textContent('#setup-err')).includes('至少選一種'), '未勾任何運算時「開始」停用');
  await page.tap('#op-mul');

  // 3. 固定 20 題：答對 17、答錯 2、跳過 1
  await page.tap('#btn-start');
  ok(await page.isVisible('#s-quiz') && (await page.textContent('#q-left-val')) === '1/20', '作答畫面 1/20');
  const pad = await page.locator('.key[data-k="5"]').boundingBox();
  ok(pad.height >= 56, `數字鍵高 ${pad.height}px ≥ 56`);
  ok(await page.evaluate(() => document.activeElement.tagName !== 'INPUT' && !document.querySelector('#s-quiz input')), '作答畫面沒有輸入框，系統鍵盤不會彈出');
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    const q = await page.evaluate(() => ({ ans: Q.cur.ans, key: Q.cur.key, text: $('question').textContent }));
    seen.add(q.key);
    if (i === 3) { await page.screenshot({ path: path.join(OUT, '390x844-quiz.png') }); }
    if (i === 5 || i === 9) {
      await answer(page, q.ans + 1);
      await page.waitForTimeout(50);
      if (i === 5) { ok((await page.textContent('#fix')).includes(`正確答案是 ${q.ans}`), '答錯顯示正確答案'); await page.screenshot({ path: path.join(OUT, '390x844-wrong.png') }); }
    } else if (i === 12) {
      const b = await page.locator('#qbox').boundingBox();
      await page.mouse.move(b.x + b.width - 20, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + b.height / 2, { steps: 4 }); await page.mouse.up();
    } else if (i === 14) {
      // 實體鍵盤：先打錯一位再退格
      await page.keyboard.type(String(q.ans) + '9'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
    } else await answer(page, q.ans);
    await waitNext(page);
  }
  ok(seen.size === 20, '固定 20 題內同題不重複（九九題庫 36 題足夠）');
  await page.waitForSelector('#s-result:not([hidden])');
  ok((await page.textContent('#res-main')).startsWith('17') && (await page.textContent('#res-acc')) === '85%', `結果：17/20、正確率 85%（2 錯 + 1 跳過）`);
  ok(await page.locator('#wrong-body tr').count() === 3 && (await page.textContent('#wrong-body')).includes('跳過'), '錯題列表 3 筆（含跳過）');
  await page.screenshot({ path: path.join(OUT, '390x844-result.png') });

  // 4. 只練錯題
  await page.tap('#btn-wrong');
  ok(await page.evaluate(() => Q.total) === 3, '只練錯題：3 題');
  for (let i = 0; i < 3; i++) { await answer(page, await page.evaluate(() => Q.cur.ans)); await waitNext(page); }
  await page.waitForSelector('#s-result:not([hidden])');
  ok((await page.textContent('#res-acc')) === '100%' && await page.isHidden('#wrong-card'), '錯題全答對 → 100%');

  // 5. 限時模式 + 暫停 + 切頁自動暫停
  await page.tap('#btn-home');
  await page.check('#mode-timed');
  await page.tap('#btn-start');
  for (let i = 0; i < 4; i++) { await answer(page, await page.evaluate(() => Q.cur.ans)); await waitNext(page); }
  await answer(page, (await page.evaluate(() => Q.cur.ans)) + 1); await waitNext(page);
  ok(await page.evaluate(() => Q.items.length === 5 && $('fix').textContent === ''), '限時模式答錯直接下一題（不停 1 秒）');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const t1 = await page.evaluate(() => now()); await page.waitForTimeout(600); const t2 = await page.evaluate(() => now());
  ok(await page.evaluate(() => Q.paused) && t1 === t2 && await page.isVisible('#paused'), '切到背景自動暫停，計時停止且題目被遮住');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
  await page.screenshot({ path: path.join(OUT, '390x844-paused.png') });
  await page.tap('#btn-resume');
  await page.evaluate(() => { Q.elapsed += 61000; });
  await page.waitForSelector('#s-result:not([hidden])', { timeout: 3000 });
  ok((await page.textContent('#res-main')).startsWith('4'), '60 秒到 → 分數 = 答對 4 題');

  // 6. 統計
  await page.tap('#btn-to-stats');
  const st = await page.evaluate(() => ({ pts: document.querySelector('#chart-acc .ln').getAttribute('points').split(' ').length, colored: document.querySelectorAll('#heat button[data-acc]').length, today: $('today-count').textContent }));
  ok(st.pts === 3, `正確率折線 3 點（3 次測驗）`);
  ok(st.colored > 10, `熱力格已上色 ${st.colored} 格`);
  ok(st.today.startsWith('今天 28 /'), `每日題數：${st.today}`);
  await page.tap('#heat button[data-acc] >> nth=0');
  ok(/練習 \d+ 次/.test(await page.textContent('#heat-info')), '點格子顯示次數與平均秒數：' + await page.textContent('#heat-info'));
  await page.screenshot({ path: path.join(OUT, '390x844-stats.png'), fullPage: true });

  // 7. 多使用者互不干擾 + 重新整理保留
  await page.tap('#btn-back');
  await page.tap('#btn-user-add'); await page.fill('#user-name', '小華'); await page.tap('#btn-user-save');
  ok(await page.evaluate(() => store.get(uk('sessions'), []).length) === 0 && (await page.textContent('#rec-last')) === '—', '新使用者「小華」沒有紀錄');
  await page.selectOption('#user', { label: '小朋友' });
  ok(await page.evaluate(() => store.get(uk('sessions'), []).length) === 3, '切回「小朋友」仍有 3 次紀錄');
  // 弱點加強（已有足夠紀錄）
  await page.check('#mode-weak'); await page.tap('#btn-start');
  ok(await page.evaluate(() => Q.source === 'weak' && Q.total === 20), '弱點加強：紀錄足夠時以權重抽題');
  await page.tap('#btn-end'); await page.waitForSelector('#s-result:not([hidden])');
  await page.reload(); await page.waitForTimeout(200);
  ok(await page.evaluate(() => users.length === 2 && store.get(uk('sessions'), []).length === 3), '重新整理後使用者與紀錄保留');
  await page.selectOption('#user', { label: '小華' });
  await page.check('#mode-weak'); await page.tap('#btn-start');
  ok(await page.evaluate(() => Q.source === 'normal') && (await page.textContent('#toast')).includes('至少 10 筆'), '小華紀錄不足 → 提示並改用一般出題');
  await page.tap('#btn-end'); await page.waitForSelector('#s-result:not([hidden])'); await page.tap('#btn-home');
  await page.tap('#btn-user-del'); ok(await page.isVisible('#user-del-confirm'), '刪除使用者需確認'); await page.tap('#btn-user-del-yes');
  ok(await page.evaluate(() => users.length) === 1, '刪除後剩 1 位');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  ok(errors.length === 0, 'console/pageerror 無錯誤 ' + errors.join(' | '));
  await ctx.close();

  // 8. 截圖
  const shots = [
    ['360x780.png', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['844x390.png', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }],
    ['390x844-dark.png', { ...mob, colorScheme: 'dark' }],
    ['1100x800-desktop.png', { viewport: { width: 1100, height: 800 } }],
  ];
  for (const [name, opt] of shots) {
    const { ctx: c, page: p, errors: e } = await open(browser, opt);
    ok(await p.evaluate(w => innerWidth === w, opt.viewport.width), `${name} innerWidth`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 無水平捲動`);
    const small = await p.evaluate(() => [...document.querySelectorAll('button, select, input')].filter(b => b.offsetParent && b.type !== 'radio' && b.getBoundingClientRect().height < 40).map(b => b.id || b.textContent.trim()));
    ok(small.length === 0, `${name} 觸控目標 ≥40px ${small}`);
    await p.screenshot({ path: path.join(OUT, name) });
    await p.click('#btn-start');
    const fit = await p.evaluate(() => { const k = document.querySelector('#key-ok').getBoundingClientRect(); return k.bottom <= innerHeight && k.right <= innerWidth; });
    ok(fit, `${name} 作答畫面鍵盤完整在畫面內`);
    await p.screenshot({ path: path.join(OUT, name.replace('.png', '-quiz.png')) });
    if (name.includes('dark')) {
      for (let i = 0; i < 6; i++) { await p.evaluate(() => { Q.input = String(Q.items.length % 3 ? Q.cur.ans : Q.cur.ans + 1); press('OK'); }); await p.waitForFunction(() => Q.done || !Q.locked, null, { timeout: 3000 }); }
      await p.evaluate(() => finish()); await p.click('#btn-to-stats');
      await p.screenshot({ path: path.join(OUT, '390x844-dark-stats.png'), fullPage: true });
    }
    ok(e.length === 0, `${name} 無錯誤 ${e}`);
    await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過'); process.exit(fails ? 1 : 0);
})();
