// Playwright verification for text-kit. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
// The artifact host wraps the page in a document with a viewport meta; reproduce that for testing.
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(a === b, `${m}: ${JSON.stringify(a)}${a === b ? '' : ' != ' + JSON.stringify(b)}`);

(async () => {
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
    await page.goto(URL); await page.waitForFunction(() => window.__tkReady);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('.op', els => els.filter(e => e.getBoundingClientRect().height < 44).length);
      eq(small, 0, 'all op buttons >= 44px tall');
      const cols = await page.$$eval('.grid', g => getComputedStyle(g[0]).gridTemplateColumns.split(' ').length);
      eq(cols, 2, 'ops grid has 2 columns at 390px');
      await page.screenshot({ path: `${OUT}/${s.name}-full.png`, fullPage: true });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__tkReady);

  // ---- pure logic cases ----
  const r = await page.evaluate(() => {
    const K = window.__K, O = K.OPS;
    return {
      a: K.s2t('后来发现这个软件很好用', true),
      a0: K.s2t('后来发现这个软件很好用', false),
      b: K.s2t('头发很干', true),
      c: K.s2t('干净的头发，发展经济，干燥的天气', true),
      d: K.s2t('信息技术与网络视频，打印机默认设置', true),
      e: K.t2s('後來發現這個軟體很好用，頭髮很乾'),
      f: K.s2t('皇后来了，一碗面条，很有面子，一只钟表', true),
      st: K.stats('👨‍👩‍👧abc中文'),
      f2h: O.f2h('ＡＢＣ　１２３，你好！', {}),
      f2hA: O.f2h('ＡＢＣ　１２３，你好！', { alnum: true }),
      h2f: O.h2f('Hi 5!', {}),
      title: O.title('hello WORLD, it\'s me'),
      sentence: O.sentence('HELLO there. how ARE you? fine!'),
      rmEmpty: O.rmEmpty('a\n\n \nb\n'),
      merge: O.mergeEmpty('a\n\n\n\nb\n\nc'),
      trim: O.trim('  a  \n\t b　'),
      rmSpace: O.rmSpace('a b\tc　d\ne f'),
      dedupe: O.dedupe('A\na\n A\nb\nA', { dTrim: true, dCase: false }),
      dedupeCI: O.dedupe('A\na\n A\nb\nA', { dTrim: true, dCase: true }),
      strip: O.stripHtml('<p>Hello <b>world</b></p><script>window.__x=1</script><p>第二段<br>換行</p>'),
      spacing: O.spacing('用iPhone拍了3張照片 ok中文'),
      punct: O.punct('你好,世界.今天天氣不錯!(真的)3.14 hello, world.'),
      sortAsc: O.sortAsc('b10\na2\nb2\nA1', { coll: 'zh-Hant' }),
      sortZhuyin: O.sortAsc('中\n安\n波', { coll: 'zh-Hant-u-co-zhuyin' }),
      sortLen: O.sortLen('ccc\na\nbb', { coll: 'zh-Hant' }),
      reverse: O.reverse('1\n2\n3'),
      lineNo: O.lineNo(Array.from({ length: 10 }, (_, i) => 'x' + i).join('\n')).split('\n').slice(8).join('|'),
      bullet: O.bullet('a\n\nb'),
      nfc: O.nfc('é') === 'é',
      rep: O.replace('foo123 bar45', { find: '(\\d+)', repl: '<$1>', regex: true, cs: false }),
      repPlain: O.replace('a.b.c', { find: '.', repl: '-', regex: false, cs: false }),
      bad: K.makeRegex('(', true, false).error || null,
      shufOK: O.shuffle('1\n2\n3\n4\n5').split('\n').sort().join(''),
      delta: K.delta('abc\ndef', 'abC\ndef'),
    };
  });
  eq(r.a, '後來發現這個軟體很好用', '簡→繁+台灣用語「后来发现这个软件很好用」');
  eq(r.a0, '後來發現這個軟件很好用', '簡→繁（關閉台灣用語）');
  eq(r.b, '頭髮很乾', '簡→繁「头发很干」');
  eq(r.c, '乾淨的頭髮，發展經濟，乾燥的天氣', '簡→繁 干/发 一對多');
  eq(r.d, '資訊科技與網路影片，印表機預設設定', '台灣用語 信息/网络/视频/打印机/默认');
  eq(r.e, '后来发现这个软体很好用，头发很干', '繁→簡');
  eq(r.f, '皇后來了，一碗麵條，很有面子，一隻鐘錶', '簡→繁 后/面/只/钟');
  eq(`${r.st.chars}/${r.st.han}/${r.st.words}`, '6/2/1', '「👨‍👩‍👧abc中文」字元/中文/英文詞');
  eq(r.st.bytes, 27, 'UTF-8 bytes');
  eq(r.f2h, 'ABC 123,你好!', '全形→半形');
  eq(r.f2hA, 'ABC　123，你好！', '全形→半形（只轉英數）');
  eq(r.h2f, 'Ｈｉ　５！', '半形→全形');
  eq(r.title, "Hello World, It's Me", '每字首大寫');
  eq(r.sentence, 'Hello there. How are you? Fine!', '句首大寫');
  eq(r.rmEmpty, 'a\nb', '去空行');
  eq(r.merge, 'a\n\nb\n\nc', '多空行併為一');
  eq(r.trim, 'a\nb', '去行首尾空白');
  eq(r.rmSpace, 'abcd\nef', '去全部空白');
  eq(r.dedupe, 'A\na\nb', '去重（忽略空白）');
  eq(r.dedupeCI, 'A\nb', '去重（忽略大小寫）');
  eq(r.strip, 'Hello world\n\n第二段\n換行', '移除 HTML（script 不執行）');
  eq(r.spacing, '用 iPhone 拍了 3 張照片 ok 中文', '中英間加空格');
  eq(r.punct, '你好，世界。今天天氣不錯！（真的）3.14 hello, world.', '統一中文標點');
  eq(r.sortAsc, 'A1\na2\nb2\nb10', '升冪（numeric）');
  eq(r.sortZhuyin, '波\n中\n安', '注音排序（ㄅ→ㄓ→ㄢ，聲母在韻母前）');
  eq(r.sortLen, 'a\nbb\nccc', '依長度');
  eq(r.reverse, '3\n2\n1', '反轉');
  eq(r.lineNo, ' 9. x8|10. x9', '加行號（對齊）');
  eq(r.bullet, '- a\n\n- b', '包成清單');
  eq(r.nfc, true, 'NFC');
  eq(r.rep, 'foo<123> bar<45>', '正規取代 $1');
  eq(r.repPlain, 'a-b-c', '一般取代跳脫');
  assert(r.bad && r.bad.includes('語法錯誤'), '正規 ( 顯示錯誤: ' + r.bad);
  eq(r.shufOK, '12345', '打亂保留所有行');
  eq(r.delta.n, 1, '變更計數');
  assert(await page.evaluate(() => window.__x) === undefined, 'stripHtml did not execute script');

  // ---- UI flow ----
  eq(await page.inputValue('#output'), await page.evaluate(() => window.__K.s2t(document.getElementById('input').value, true)), 'sample shows 簡→繁 result on open');
  await page.click('#clearBtn');
  assert(await page.isDisabled('.op[data-op="upper"]'), 'ops disabled on empty input');
  await page.fill('#input', 'b\n\na\nb\n头发很干');
  await page.waitForTimeout(50);
  eq(await page.textContent('#sHan'), '4', 'stats 中文字');
  eq(await page.textContent('#sLines'), '5', 'stats 行數');
  await page.click('.op[data-op="rmEmpty"]');
  await page.click('.op[data-op="dedupe"]');
  await page.click('.op[data-op="s2t"]');
  eq(await page.inputValue('#output'), 'b\na\n頭髮很乾', 'chain 去空行→去重→簡繁');
  await page.waitForTimeout(100);
  assert(await page.isVisible('#jump'), 'mobile jump bar visible when result off-screen');
  await page.screenshot({ path: `${OUT}/flow-jumpbar.png` });
  await page.click('#jumpBtn'); await page.waitForTimeout(700);
  assert(await page.isHidden('#jump'), 'jump bar hides after scrolling to result');
  eq(await page.$$eval('.step', e => e.length), 3, 'chain shows 3 steps');
  const deltaTxt = await page.textContent('#delta');
  assert(/變更了 \d+ 行/.test(deltaTxt), 'delta shown: ' + deltaTxt);
  await page.evaluate(() => document.querySelectorAll('.step')[1].querySelector('button').click()); // remove 去重
  await page.waitForTimeout(50);
  eq(await page.inputValue('#output'), 'b\na\nb\n頭髮很乾', 'remove a step recomputes');
  // find/replace with bad regex
  await page.click('#frToggle');
  await page.check('#frRegex');
  await page.fill('#frFind', '(');
  await page.waitForTimeout(250);
  assert((await page.textContent('#frMsg')).includes('語法錯誤'), 'bad regex message');
  await page.click('#frApply');
  eq(await page.$$eval('.step', e => e.length), 2, 'bad regex not added');
  await page.fill('#frFind', '^b$'); await page.uncheck('#frRegex'); await page.check('#frRegex');
  await page.fill('#frRepl', 'B');
  await page.waitForTimeout(250);
  // regex without m flag: ^b$ won't match multi-line; use (?<=^|\n)b(?=\n|$)
  await page.fill('#frFind', '(?<=^|\\n)b(?=\\n|$)');
  await page.waitForTimeout(250);
  assert((await page.textContent('#frMsg')).includes('找到 2'), 'match count: ' + await page.textContent('#frMsg'));
  await page.click('#frApply');
  eq(await page.inputValue('#output'), 'B\na\nB\n頭髮很乾', 'regex replace in chain');
  await page.screenshot({ path: `${OUT}/flow-chain.png` });
  await page.click('#useBtn');
  eq(await page.inputValue('#input'), 'B\na\nB\n頭髮很乾', 'use result as input');
  eq(await page.$$eval('.step', e => e.length), 0, 'chain cleared after use');
  // history
  await page.click('#histBtn');
  const hc = await page.$$eval('#hList li button', e => e.length);
  assert(hc >= 1, 'history has entries: ' + hc);
  await page.screenshot({ path: `${OUT}/flow-history.png` });
  await page.click('#hList li button');
  eq(await page.inputValue('#input'), 'b\n\na\nb\n头发很干', 'history restores earlier input');
  // stats details
  await page.click('#stats');
  assert(await page.isVisible('#statsMore'), 'stats detail expands');
  // reload keeps draft
  await page.waitForTimeout(600);
  await page.reload(); await page.waitForFunction(() => window.__tkReady);
  eq(await page.inputValue('#input'), 'b\n\na\nb\n头发很干', 'draft persists after reload');

  // ---- big text: 3MB dedupe ----
  const t0 = await page.evaluate(async () => {
    const lines = []; for (let i = 0; i < 150000; i++) lines.push('第' + (i % 50000) + '行 sample text');
    const big = lines.join('\n');
    const inp = document.getElementById('input');
    inp.value = big; inp.dispatchEvent(new Event('input'));
    // let the pasted text render and the background stats finish (paste cost is not part of the operation)
    await new Promise(r => setTimeout(r, 4000));
    // measure main-thread blocking during dedupe click
    let maxGap = 0, last = performance.now(), running = true;
    (function tick() { const n = performance.now(); maxGap = Math.max(maxGap, n - last); last = n; if (running) requestAnimationFrame(tick); })();
    const t = performance.now();
    document.querySelector('.op[data-op="dedupe"]').click();
    const busyShown = !document.getElementById('busy').hidden;
    await new Promise(r => { const iv = setInterval(() => { if (document.getElementById('busy').hidden) { clearInterval(iv); r(); } }, 20); });
    running = false;
    return { size: big.length, ms: performance.now() - t, maxGap, busyShown, outLines: window.__out().split('\n').length };
  });
  assert(t0.busyShown, 'busy indicator shown for big text');
  eq(t0.outLines, 50000, '3MB dedupe result lines');
  assert(t0.maxGap < 1000, `UI not frozen > 1s during 3MB dedupe (max frame gap ${t0.maxGap.toFixed(0)}ms, total ${t0.ms.toFixed(0)}ms, size ${(t0.size / 1048576).toFixed(2)}M chars)`);
  await ctx.close();
  await browser.close();
  console.log('\nerrors:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})();
