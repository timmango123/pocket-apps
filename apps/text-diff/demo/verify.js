// Playwright verification for text-diff. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const PREV = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(PREV, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + PREV, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);

(async () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
  assert(!src.includes('�'), 'no literal U+FFFD in source');
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(s); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    await page.goto(URL); await page.waitForFunction(() => window.__tdReady); await page.waitForTimeout(150);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    if (s.name === '390x844') await page.evaluate(() => scrollTo(0, 380));
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 40).map(e => e.id || e.textContent));
      eq(small, [], 'buttons are >= 40px tall (44 with hit area)');
      await page.click('#viewSide'); await page.waitForTimeout(100);
      await page.evaluate(() => scrollTo(0, 380));
      await page.screenshot({ path: `${OUT}/${s.name}-side.png` });
      const sw2 = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(sw2 <= 390, 'side view no horizontal scroll');
      await page.click('#viewInline');
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__tdReady);

  // ---- Myers correctness: fuzz vs. LCS dynamic programming (edit count must be minimal and script must rebuild both sides)
  const fuzz = await page.evaluate(() => {
    const { myers } = window.__td.C; let bad = 0, n = 0;
    const rnd = k => Math.floor(Math.random() * k);
    for (let t = 0; t < 600; t++) {
      const A = Array.from({ length: rnd(40) }, () => rnd(4)), B = Array.from({ length: rnd(40) }, () => rnd(4));
      const ops = myers(A, B); let i = 0, j = 0, ok = true, ed = 0;
      for (const o of ops) { if (o === 0) { if (A[i] !== B[j]) ok = false; i++; j++; } else if (o < 0) { i++; ed++; } else { j++; ed++; } }
      if (i !== A.length || j !== B.length) ok = false;
      const dp = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
      for (let x = 1; x <= A.length; x++) for (let y = 1; y <= B.length; y++) dp[x][y] = A[x - 1] === B[y - 1] ? dp[x - 1][y - 1] + 1 : Math.max(dp[x - 1][y], dp[x][y - 1]);
      if (ed !== A.length + B.length - 2 * dp[A.length][B.length]) ok = false;
      if (!ok) bad++; n++;
    }
    return { bad, n };
  });
  eq(fuzz.bad, 0, `Myers fuzz ${fuzz.n} cases: valid & minimal`);

  // ---- spec example 1: contract wording (character granularity)
  const r1 = await page.evaluate(() => window.__td.C.tokenDiff('甲方應於十日內付款', '甲方應於三十日內付清款項', 'char', {}).map(g => [g.op, g.op < 0 ? g.a : g.b]));
  eq(r1, [[0, '甲方應於'], [1, '三'], [0, '十日內付'], [-1, '款'], [1, '清款項']], 'contract example: 三 inserted, 付款→付清款項 grouped by semantic cleanup');
  // ---- example 2: word granularity, ignore case
  const r2 = await page.evaluate(() => window.__td.C.tokenDiff('The quick brown fox', 'the quick red fox', 'word', { cs: true }).map(g => [g.op, g.op < 0 ? g.a : g.b]));
  eq(r2, [[0, 'the quick '], [-1, 'brown'], [1, 'red'], [0, ' fox']], 'word diff with ignore-case');
  // ---- example 3: full diff stats + unified output
  const r3 = await page.evaluate(() => { const R = window.__td.C.diffAll('a\nb\nc\nd', 'a\nB\nc\nd\ne', { gran: 'line' }); return { adds: R.adds, dels: R.dels, sim: R.sim }; });
  eq(r3, { adds: 2, dels: 1, sim: 0.6 }, 'line diff stats (1 changed + 1 added of 5 lines -> 60.0%)');
  const ign = await page.evaluate(() => window.__td.C.diffAll('Hello,  World!', 'hello world', { gran: 'char', ws: true, cs: true, punct: true }).same);
  eq(ign, true, 'ignore whitespace/case/punct makes texts equal');
  const crlf = await page.evaluate(() => window.__td.C.diffAll('a\r\nb', 'a\nb', { gran: 'char' }));
  assert(crlf.same && crlf.notes.includes('已統一換行符'), 'CRLF normalised and noted');

  // ---- UI flow on sample
  const ui = await page.evaluate(() => ({ add: document.querySelector('#sAdd').textContent, del: document.querySelector('#sDel').textContent, sim: document.querySelector('#sSim').textContent, ins: [...document.querySelectorAll('#dv ins')].map(e => e.textContent).slice(0, 3) }));
  console.log('     sample summary', JSON.stringify(ui));
  assert(+ui.add > 0 && +ui.del > 0, 'sample shows additions and deletions');
  eq(ui.ins[0], '三', 'first insertion rendered is 三');
  await page.click('#nextBtn'); await page.click('#nextBtn');
  eq(await page.textContent('#navCnt'), '2 / 3', 'next/prev navigation counter');
  assert(await page.$$eval('.r.hl', e => e.length) > 0, 'current change highlighted');
  const uni = await page.evaluate(() => window.__td.unified());
  assert(uni.startsWith('--- 原文\n+++ 修改後\n@@ -1,') && uni.includes('-甲方應於十日內付款。') && uni.includes('+  log: true'), 'unified diff export');
  // typing triggers auto compare after 400ms
  await page.fill('#left', 'one\ntwo'); await page.fill('#right', 'one\ntwo'); await page.waitForTimeout(550);
  eq(await page.textContent('#result'), '兩段文字完全相同', 'identical texts message');
  const many = Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n');
  await page.fill('#left', many); await page.fill('#right', many.replace('line 20', 'line twenty')); await page.waitForTimeout(550);
  eq(await page.$$eval('.fold', e => e.map(x => x.textContent)), ['⋯ 展開 18 行未變更', '⋯ 展開 17 行未變更'], 'unchanged runs folded');
  await page.click('.fold'); eq(await page.$$eval('.fold', e => e.length), 1, 'fold expands');
  // persistence
  await page.waitForTimeout(600); await page.reload(); await page.waitForFunction(() => window.__tdReady);
  eq(await page.inputValue('#left'), many, 'left text persisted');
  // large input goes to the worker and can finish
  await page.evaluate(() => { const a = Array.from({ length: 30000 }, (_, i) => 'row ' + i + ' 內容' + (i % 7)).join('\n'); document.querySelector('#left').value = a; document.querySelector('#right').value = a.replace(/row 1(\d)00 /g, 'ROW 1$100 '); window.__td.run(); });
  const busyShown = await page.isVisible('#busy');
  await page.waitForFunction(() => document.querySelector('#busy').hidden, null, { timeout: 30000 });
  const big = await page.evaluate(() => ({ dels: window.__td.R.dels, note: window.__td.R.notes.join() }));
  console.log('     large diff', JSON.stringify(big), 'busy shown', busyShown);
  assert(big.dels >= 10, 'large text diff in worker completes');
  await page.screenshot({ path: `${OUT}/flow-large.png` });
  await ctx.close(); await browser.close();
  fs.unlinkSync(PREV);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
