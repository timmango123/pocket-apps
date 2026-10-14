// 猜拳與硬幣驗證：node verify.js
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
// 由 computed transform 讀出朝向觀者的面：rotateX(θ) 的 m22 = cos θ
const facing = () => coins.map(c => { const m = new DOMMatrix(getComputedStyle(c.spin).transform); return m.m22 > .5 ? 'h' : m.m22 < -.5 ? 't' : 'e'; });
(async () => {
  const browser = await chromium.launch();
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  let { ctx, page, errors } = await open(browser, mob);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 1. 1 萬次擲幣比例
  const sim = await page.evaluate(() => { let h = 0; for (let i = 0; i < 10000; i++) if (decideFace() === 'h') h++; return h / 100; });
  ok(sim >= 49 && sim <= 51, `1 萬次模擬正面 ${sim.toFixed(2)}%（49–51%）`);
  const edge = await page.evaluate(() => { settings.edge = true; let e = 0; for (let i = 0; i < 600000; i++) if (decideFace() === 'e') e++; settings.edge = false; return e; });
  ok(edge > 50 && edge < 160, `彩蛋開啟 60 萬次立起 ${edge} 次（期望 100）`);
  // planSpin 數學：所有起點 × 力度 × 結果都停在正確面且半圈數 4–13
  const plan = await page.evaluate(() => { let bad = 0; for (const a0 of [0, 180, 90, 360, 540]) for (let f = 0; f <= 1; f += .05) for (const face of ['h', 't']) { const a1 = planSpin(a0, face, f), n = Math.cos(a1 * Math.PI / 180); const halves = (a1 - Math.floor(a0 / 180) * 180) / 180; if ((face === 'h' ? n < .99 : n > -.99) || halves < 4 || halves > 13) bad++; } return bad; });
  ok(plan === 0, 'planSpin：各起點/力度下停面皆正確、半圈數 4–13');

  // 2. 連擲 30 次（真實動畫）停面一致
  let mismatch = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => flip(Math.random()));
    const r = await page.evaluate(([fs]) => ({ shown: eval(fs)(), want: lastFaces, text: $('coin-result').textContent }), [facing.toString()]);
    const label = r.want[0] === 'h' ? '正' : '反';
    if (r.shown[0] !== r.want[0] || r.text !== label) mismatch++;
  }
  ok(mismatch === 0, `連擲 30 次（含動畫）停面與結果文字 100% 一致`);
  const st = await page.evaluate(() => ({ s: session.h + session.t, a: stats.coin.heads + stats.coin.tails, seq: document.querySelectorAll('#seq i').length }));
  ok(st.s === 30 && st.a === 30 && st.seq === 20, '本次/累計各 30 次，序列顯示最近 20 次');
  // 上滑拋出
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 3 }); await page.mouse.up();
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => flipping), '在硬幣上快速上滑會拋出');
  await page.waitForFunction(() => !flipping, null, { timeout: 4000 });
  await page.screenshot({ path: path.join(OUT, '390x844-coin.png') });
  // 多枚
  await page.click('#cnt-5'); await page.click('#btn-flip');
  await page.waitForFunction(() => !flipping, null, { timeout: 5000 });
  const multi = await page.evaluate(([fs]) => ({ shown: eval(fs)(), want: lastFaces, major: $('coin-major').textContent }), [facing.toString()]);
  const h = multi.want.filter(f => f === 'h').length;
  ok(JSON.stringify(multi.shown) === JSON.stringify(multi.want) && multi.major === `正 ${h}：反 ${5 - h} → ${h > 2 ? '正' : '反'}方勝`, `5 枚：各枚停面一致，${multi.major}`);
  await page.screenshot({ path: path.join(OUT, '390x844-five.png') });
  // 自訂面
  await page.click('summary'); await page.fill('#face-h', '吃麵'); await page.fill('#face-t', '🍚');
  ok(await page.evaluate(() => faceText('h') === '吃麵' && faceText('t') === '🍚' && document.querySelector('.face.back span').textContent === '🍚'), '自訂硬幣面：吃麵 / 🍚');
  await page.fill('#face-h', '');
  ok(await page.evaluate(() => faceText('h')) === '正', '空白回復預設「正」');
  await page.fill('#face-t', '');
  // 重設確認
  await page.click('#btn-reset-coin'); ok(await page.isVisible('#confirm-coin'), '重設累計需頁內確認');
  await page.click('#no-coin');
  // 重新整理後保留
  await page.reload(); await page.waitForTimeout(200);
  ok(await page.evaluate(() => stats.coin.heads + stats.coin.tails) === 36, '重新整理後累計保留（36 次）');

  // 3. 猜拳規則與挑戰模式
  const rules = await page.evaluate(() => [[1, 0], [0, 2], [2, 1], [0, 1], [1, 1]].map(([a, b]) => judge(a, b)).join(','));
  ok(rules === 'win,win,win,lose,draw', '石頭勝剪刀、剪刀勝布、布勝石頭、剪刀輸石頭、同拳平手');
  const markov = await page.evaluate(() => {
    const run = (pattern) => { const hist = []; let cpuWin = 0; for (let i = 0; i < 1000; i++) { const me = pattern(i, hist); const p = predictCpu(hist); const cpu = p == null ? randInt(3) : p; if (beats(cpu, me)) cpuWin++; hist.push(me); if (hist.length > 50) hist.shift(); } return cpuWin / 10; };
    return { cycle: run(i => i % 3), sticky: run(i => Math.floor(i / 4) % 3 === 0 ? 1 : (i % 2 ? 2 : 0)), fair: (() => { let w = 0; for (let i = 0; i < 30000; i++) if (beats(randInt(3), i % 3)) w++; return w / 300; })() };
  });
  ok(markov.cycle > 50 && markov.sticky > 50, `挑戰模式 1000 手：對循環出拳者電腦勝率 ${markov.cycle}%、對固定習慣者 ${markov.sticky}%（皆 > 50%）`);
  ok(Math.abs(markov.fair - 33.3) < 1.5, `一般模式電腦勝率 ${markov.fair.toFixed(1)}%（≈ 1/3，公平）`);

  // 4. UI：對電腦三戰兩勝
  await page.click('#tab-rps');
  await page.selectOption('#best-of', '3');
  let n = 0;
  while (n < 15 && !(await page.evaluate(() => match.over))) { await page.click('#pick-' + (n % 3)); await page.waitForFunction(() => !busy); n++; }
  const mm = await page.textContent('#match-msg');
  ok(/贏得這場/.test(mm), `三戰兩勝結束：${mm}（${n} 手）`);
  const rs = await page.evaluate(() => stats.rps); ok(rs.win + rs.lose + rs.draw === n, `戰績累計 ${rs.win} 勝 ${rs.lose} 負 ${rs.draw} 平`);
  await page.keyboard.press('2'); await page.waitForFunction(() => !busy);
  ok(await page.textContent('#hand-me') === '✊', '鍵盤 2 = 石頭');
  await page.screenshot({ path: path.join(OUT, '390x844-rps.png') });
  // 雙人同機
  await page.click('#mode-duo');
  await page.click('#duo-area .pick[data-p="1"][data-m="1"]');
  ok(await page.textContent('#cover-1') === '？', '玩家一選完以「？」遮蓋');
  await page.click('#duo-area .pick[data-p="2"][data-m="0"]');
  await page.waitForTimeout(100);
  ok(await page.textContent('#cover-1') === '✊' && await page.textContent('#cover-2') === '✌️' && (await page.textContent('#duo-s1')) === '1', '兩人都選好後同時翻開：玩家一石頭勝剪刀');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.half.p1')).transform.startsWith('matrix(-1')), '上半部旋轉 180°');
  await page.screenshot({ path: path.join(OUT, '390x844-duo.png') });
  await page.waitForTimeout(1800);
  await page.click('#duo-area .pick[data-p="1"][data-m="2"]'); await page.click('#duo-area .pick[data-p="2"][data-m="2"]');
  await page.waitForTimeout(100);
  ok((await page.textContent('#duo-msg')).includes('再來'), '雙人平手提示「再來！」');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  ok(errors.length === 0, 'console/pageerror 無錯誤 ' + errors.join(' | '));
  await ctx.close();

  // 5. 減少動態效果：直接顯示結果
  {
    const { ctx: c, page: p, errors: e } = await open(browser, { ...mob, reducedMotion: 'reduce' });
    const t0 = Date.now(); await p.evaluate(() => flip()); const dt = Date.now() - t0;
    ok(dt < 600 && await p.evaluate(([fs]) => eval(fs)()[0] === lastFaces[0], [facing.toString()]), `減少動態效果：${dt}ms 內直接顯示結果且停面一致`);
    ok(e.length === 0, 'reduced motion 無錯誤'); await c.close();
  }

  // 6. 截圖
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
    const small = await p.evaluate(() => [...document.querySelectorAll('button, select, summary')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 40).map(b => b.id || b.textContent.trim()));
    ok(small.length === 0, `${name} 觸控目標 ≥40px ${small}`);
    await p.screenshot({ path: path.join(OUT, name) });
    if (name.includes('dark')) { await p.click('#tab-rps'); await p.screenshot({ path: path.join(OUT, '390x844-dark-rps.png') }); }
    if (name.startsWith('360')) { await p.click('#tab-rps'); const pk = await p.locator('#pick-2').boundingBox(); ok(pk.x + pk.width <= 360 && pk.width >= 44, '360 寬猜拳按鈕完整顯示'); }
    ok(e.length === 0, `${name} 無錯誤 ${e}`);
    await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過'); process.exit(fails ? 1 : 0);
})();
