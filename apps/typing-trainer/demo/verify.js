// 打字練習驗證：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const target = page => page.evaluate(() => S.target);
const typed = page => page.evaluate(() => S.typed);
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  const ctx = await browser.newContext(mob);
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.install();
  await page.goto(URL_); await page.waitForTimeout(300);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  ok((await target(page)).length > 300 && await page.locator('#text span').count() >= 300, '開啟即有英文題目（常用字隨機組句）');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 1. 60 秒內正確輸入 300 字元 → 60 WPM
  await page.tap('#board');
  const t = await target(page);
  await page.keyboard.type(t.slice(0, 300));
  ok((await typed(page)) === t.slice(0, 300), '已輸入 300 個正確字元');
  ok(await page.evaluate(() => state) === 'running', '首鍵開始計時');
  await page.clock.runFor(30000);
  const mid = await page.evaluate(() => ({ speed: document.getElementById('st-speed').textContent, time: document.getElementById('st-time').textContent }));
  ok(['29', '30'].includes(mid.time), `剩餘秒數 30（實際 ${mid.time}），即時速度 ${mid.speed}`);
  await page.screenshot({ path: path.join(OUT, '390x844-typing.png') });
  await page.clock.runFor(30500);
  await page.waitForTimeout(100);
  const r1 = await page.evaluate(() => ({ vis: !document.getElementById('result').hidden, wpm: document.getElementById('r-speed').textContent, acc: document.getElementById('r-acc').textContent, raw: document.getElementById('r-raw').textContent, curve: mem.sessions.at(-1).curve.length }));
  ok(r1.vis && r1.wpm === '60' && r1.acc === '100%' && r1.raw === '60', `60 秒 300 正確字元 → WPM ${r1.wpm}、原始 ${r1.raw}、正確率 ${r1.acc}`);
  ok(r1.curve >= 59, `速度曲線每秒取樣 ${r1.curve} 點`);
  await page.screenshot({ path: path.join(OUT, '390x844-result.png') });

  // 2. 錯字與退格：正確率包含被改正的錯誤按鍵
  await page.click('#r-again'); await page.waitForTimeout(50);
  const t2 = await target(page);
  const wrong = t2[0] === 'x' ? 'z' : 'x';
  await page.keyboard.type(wrong); await page.keyboard.press('Backspace'); await page.keyboard.type(t2.slice(0, 9));
  const a2 = await page.evaluate(() => ({ keys: S.keys, ck: S.correctKeys, acc: document.getElementById('st-acc').textContent, typed: S.typed, bad: document.querySelectorAll('#text .bad').length, conf: JSON.stringify([...S.stats.entries()].filter(([, v]) => v.wrong)) }));
  ok(a2.keys === 10 && a2.ck === 9 && a2.acc === '90%' && a2.bad === 0, `錯一鍵後改正：按鍵 ${a2.keys}、正確 ${a2.ck}、正確率 ${a2.acc}；混淆 ${a2.conf}`);
  // 錯字標紅
  await page.keyboard.type('#');
  ok(await page.locator('#text .bad').count() === 1, '錯字以紅底標示');
  // Esc 中止不存
  const n0 = await page.evaluate(() => mem.sessions.length);
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => state) === 'ready' && await page.evaluate(() => mem.sessions.length) === n0, 'Esc 中止且不存紀錄');
  // 貼上被阻擋
  await page.focus('#ta');
  await page.evaluate(() => { const dt = new DataTransfer(); dt.setData('text/plain', 'hello world'); document.getElementById('ta').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  ok((await typed(page)) === '' && await page.isVisible('#toast'), '貼上被阻擋並提示');
  // 嚴格模式
  await page.evaluate(() => { settings.strict = true; });
  const t3 = await target(page);
  await page.keyboard.type(t3[0] === 'q' ? 'w' : 'q'); await page.keyboard.type(t3[0]);
  ok((await typed(page)) === t3[0], '嚴格模式：錯字不前進，改打正確才前進');
  await page.evaluate(() => { settings.strict = false; });
  await page.keyboard.press('Escape');
  // Tab + Enter 重新開始
  const before = await target(page);
  await page.focus('#ta'); await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  ok((await target(page)) !== before, 'Tab + Enter 重新開始（換一組新題）');

  // 3. 固定段落與自訂文字
  await page.click('#mode-passage');
  const p0 = await target(page);
  ok(p0.startsWith('The morning train'), '固定段落 1：' + p0.slice(0, 30));
  await page.click('#btn-next');
  ok((await target(page)).startsWith('Rain tapped'), '下一段');
  await page.click('#mode-custom');
  await page.fill('#custom-input', '   ');
  await page.click('#btn-custom-start');
  ok((await target(page)) === '' && await page.isVisible('#toast'), '空白自訂文字無法開始');
  const big = Array.from({ length: 900 }, (_, i) => ['alpha', 'bravo', 'delta', 'gamma', 'kilo'][i % 5]).join(' ').slice(0, 5000);
  await page.fill('#custom-input', big);
  await page.click('#btn-custom-start');
  ok((await target(page)).length >= 4990, `自訂 ${(await target(page)).length} 字元載入`);
  const spans = await page.locator('#text span').count();
  ok(spans <= 601, `大段文字只渲染視窗 ${spans} 個 span`);
  await page.focus('#ta');
  const perf = await page.evaluate(() => { const ta = document.getElementById('ta'); const t0 = performance.now(); let worst = 0; for (let i = 0; i < 200; i++) { const a = performance.now(); ta.value = S.target.slice(0, i + 1); ta.dispatchEvent(new Event('input')); worst = Math.max(worst, performance.now() - a); } return { avg: (performance.now() - t0) / 200, worst }; });
  ok(perf.worst < 16, `5,000 字元輸入每鍵平均 ${perf.avg.toFixed(2)}ms，最慢 ${perf.worst.toFixed(2)}ms`);
  await page.keyboard.press('Escape');

  // 4. 中文：組字期間不比對、同音誤選
  await page.click('#lang-zh'); await page.click('#mode-passage');
  const z = await target(page);
  ok(z.startsWith('床前明月光'), '中文段落：' + z.slice(0, 12));
  await page.focus('#ta');
  const zc = await page.evaluate(async () => {
    const ta = document.getElementById('ta'), fire = (t, d) => ta.dispatchEvent(new CompositionEvent(t, { data: d, bubbles: true }));
    const wait = () => new Promise(r => setTimeout(r, 5));
    fire('compositionstart', '');
    ta.value = 'ㄔㄨㄤˊ'; ta.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
    const during = { typed: S.typed, bad: document.querySelectorAll('#text .bad').length, ime: document.getElementById('status').textContent };
    ta.value = '床'; fire('compositionend', '床'); ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await wait();
    // 同音誤選：前(qian) → 錢(qian)
    fire('compositionstart', ''); ta.value = '床ㄑㄧㄢˊ'; ta.dispatchEvent(new InputEvent('input', { isComposing: true, bubbles: true }));
    ta.value = '床錢'; fire('compositionend', '錢'); await wait();
    return { during, typed: S.typed, bad: document.querySelectorAll('#text .bad').length, homo: S.homophone, label: document.getElementById('st-speed-label').textContent };
  });
  ok(zc.during.typed === '' && zc.during.bad === 0 && zc.during.ime.includes('組字中'), '組字期間不比對，顯示「輸入法組字中…」');
  ok(zc.typed === '床錢' && zc.bad === 1 && zc.homo === 1, `選字後比對：「床」正確、「錢」錯並計為同音誤選（${zc.homo}）`);
  ok(zc.label === '字／分', '中文速度單位 字／分');
  // 完成整段中文：速度 = 正確字數 / 分
  await page.evaluate(() => { const ta = document.getElementById('ta'); ta.value = '床'; ta.dispatchEvent(new Event('input')); });
  const full = await target(page);
  await page.clock.runFor(30000);
  await page.evaluate(t => { const ta = document.getElementById('ta'); ta.value = t; ta.dispatchEvent(new Event('input')); }, full);
  await page.waitForTimeout(100);
  const zr = await page.evaluate(() => ({ vis: !document.getElementById('result').hidden, speed: document.getElementById('r-speed').textContent, n: S.target.length, note: document.getElementById('r-note').textContent }));
  ok(zr.vis && Math.abs(+zr.speed - zr.n * 2) <= 1, `中文 ${zr.n} 字 30 秒完成 → ${zr.speed} 字／分（預期 ${zr.n * 2}）`);
  ok(zr.note.includes('同音字誤選'), '結果提示同音誤選');
  await page.screenshot({ path: path.join(OUT, '390x844-zh-result.png') });
  await page.click('#result-close');

  // 5. 練習錯字、歷史（重新整理後保留）
  await page.click('#lang-en');
  await page.click('#mode-custom'); await page.fill('#custom-input', 'the quick brown fox jumps'); await page.click('#btn-custom-start');
  await page.keyboard.type('thw quick brown fox jumps'); await page.waitForTimeout(100);
  ok(await page.isVisible('#result') && (await page.textContent('#r-errs')).includes('e'), '自訂文字完成，常錯列出 e');
  await page.click('#result-close');
  await page.click('#btn-practice'); await page.waitForTimeout(50);
  const pr = await page.evaluate(() => ({ mode: settings.mode, t: S.target.slice(0, 60) }));
  ok(pr.mode === 'practice' && pr.t.length > 20, '練習錯字產生加權文字：' + pr.t);
  await page.reload(); await page.waitForTimeout(500);
  await page.click('#btn-history'); await page.waitForTimeout(100);
  const h = await page.evaluate(() => ({ count: document.getElementById('h-count').textContent, best: document.getElementById('h-best').textContent, pts: document.querySelectorAll('#h-speed circle').length }));
  ok(+h.count >= 1 && h.best === '60' && h.pts >= 1, `重新整理後歷史保留：${h.count} 次、最佳 ${h.best}`);
  await page.screenshot({ path: path.join(OUT, '390x844-history.png') });
  await page.click('#history-close');
  const ls = await page.evaluate(() => Object.keys(localStorage));
  ok(ls.every(k => k.startsWith('typing-trainer:v1:')), '儲存鍵：' + ls.join(', '));
  // 熱力圖
  ok(await page.locator('.key').count() >= 39, '鍵盤熱力圖顯示');
  // 切到背景暫停
  await page.click('#mode-60'); await page.focus('#ta'); await page.keyboard.type('abc');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.clock.runFor(5000);
  const paused = await page.evaluate(() => Math.round(elapsed()));
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  ok(paused < 200, `切換分頁時暫停計時（背景 5 秒，計時 ${paused}ms）`);
  await page.keyboard.press('Escape');
  ok(errors.length === 0, 'no console errors ' + errors.join(' | '));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  await ctx.close();

  for (const [name, o] of [['360x780', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['390x844-dark', { ...mob, colorScheme: 'dark' }], ['1280x860-desktop', { viewport: { width: 1280, height: 860 } }]]) {
    const c = await browser.newContext(o); const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(URL_); await p.waitForTimeout(300);
    if (name.includes('dark') || name.includes('desktop')) { await p.click('#board'); const t = await p.evaluate(() => S.target); await p.keyboard.type(t.slice(0, 40) + 'x' + t.slice(41, 70)); }
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
    ok(m.sw <= m.iw && m.iw === o.viewport.width, `${name} 無水平捲動（${m.sw}/${m.iw}）`);
    ok(errs.length === 0, `${name} 無錯誤 ${errs.join('|')}`);
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
