// Playwright verification for json-viewer. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);

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
    await page.goto(URL); await page.waitForFunction(() => window.__jvReady);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    if (s.name.startsWith('dark')) { await page.evaluate(() => document.getElementById('vp').scrollIntoView()); }
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button.btn', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id));
      eq(small, [], 'all visible buttons >= 44px');
      // error state screenshot
      await page.fill('#src', '{\n  "name": "咖啡",\n  "price": 120,\n}');
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${OUT}/flow-error.png` });
      await page.fill('#src', '');
      await page.click('#sampleBtn'); await page.waitForTimeout(100);
      await page.fill('#q', '拿鐵'); await page.waitForTimeout(400);
      await page.evaluate(() => document.getElementById('q').scrollIntoView());
      await page.screenshot({ path: `${OUT}/flow-search.png` });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__jvReady);

  const err = async t => page.evaluate(t => { try { window.__jv.parseJSON(t); return 'OK'; } catch (e) { const lc = window.__jv.lineCol(t, e.pos); return `${lc.line}:${lc.col} ${e.msg}`; } }, t);
  const r1 = await err('{"a":1,}'); assert(r1.startsWith('1:8 不允許尾逗號'), 'trailing comma -> ' + r1);
  const r2 = await err("{'a':1}"); assert(r2.startsWith('1:2 ') && r2.includes('單引號'), 'single quote -> ' + r2);
  const r3 = await err('{"a":"abc}'); assert(r3.startsWith('1:6 ') && r3.includes('未閉合字串'), 'unclosed string -> ' + r3);
  const r3b = await err('{\n  "a": "abc,\n  "b": 2\n}'); assert(r3b.startsWith('2:8 ') && r3b.includes('未閉合字串'), 'unclosed string multi-line -> ' + r3b);
  const r4 = await err('{"a":1 "b":2}'); assert(r4.startsWith('1:8 缺少逗號'), 'missing comma -> ' + r4);
  const r5 = await err('[1,2'); assert(r5.includes('沒有閉合'), 'unclosed bracket -> ' + r5);
  const r6 = await err('{"a":"\\x"}'); assert(r6.startsWith('1:7 非法跳脫'), 'bad escape -> ' + r6);
  const r7 = await err('{a:1}'); assert(r7.includes('鍵名必須加雙引號'), 'unquoted key -> ' + r7);
  eq(await err('42'), 'OK', 'scalar 42 is valid'); eq(await err('"abc"'), 'OK', 'scalar string valid');
  const deep = '['.repeat(3000) + ']'.repeat(3000); eq(await err(deep), 'OK', '3000-level nesting parses');
  const big = await page.evaluate(() => { const d = window.__jv.parseJSON('{"id":12345678901234567890}'); return [d.V[1], d.BIG[1]]; });
  eq(big, ['12345678901234567890', 1], 'big number kept raw and flagged');
  const ser = await page.evaluate(() => window.__jv.serialize('{"b":1,"a":{"d":[1,{"z":true,"y":null}],"c":"x"},"id":12345678901234567890}', '', true));
  eq(ser, '{"a":{"c":"x","d":[1,{"y":null,"z":true}]},"b":1,"id":12345678901234567890}', 'minify + sort keys keeps big number');
  const ser2 = await page.evaluate(() => window.__jv.serialize('{"a":[1,2],"b":{}}', '  ', false));
  eq(ser2, '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}', 'format 2-space');
  const fix = await page.evaluate(() => window.__jv.repair("{\n  // 註解\n  name: 'Tom',\n  'age': 3, /* x */\n  list: [1,2,],\n}"));
  eq(JSON.parse(fix.text), { name: 'Tom', age: 3, list: [1, 2] }, 'repair result parses'); assert(fix.fixes >= 6, 'repair count ' + fix.fixes);

  // UI flow: status, error jump, repair button, JSONL, search, sheet
  await page.fill('#src', '{"a":1,}'); await page.waitForTimeout(450);
  eq(await page.textContent('#errJump'), '第 1 行第 8 欄：不允許尾逗號', 'status shows trailing comma line/col');
  await page.click('#errJump');
  eq(await page.evaluate(() => document.getElementById('src').selectionStart), 7, 'click error jumps caret to position');
  await page.click('#fixBtn'); await page.waitForTimeout(100);
  assert((await page.textContent('#status')).includes('合法 JSON'), 'repair button fixes input');
  await page.fill('#src', '{"n":1}\n{"n":2}\n{"n":3}'); await page.waitForTimeout(450);
  assert((await page.textContent('#status')).includes('偵測到 JSONL，共 3 筆'), 'JSONL detected');
  await page.click('#sampleBtn'); await page.waitForTimeout(100);
  assert((await page.textContent('#status')).includes('合法 JSON'), 'sample valid');
  assert(await page.isVisible('#sampleChip'), 'sample chip visible');
  const warn = await page.$$eval('.warnb', e => e.length); assert(warn >= 1, 'precision warning badge shown in tree');
  await page.fill('#q', 'price'); await page.waitForTimeout(400);
  eq(await page.textContent('#cnt'), '1/3', 'search price: 1/3');
  await page.click('#nextBtn'); eq(await page.textContent('#cnt'), '2/3', 'next -> 2/3');
  const cur = await page.$eval('.r.cur', e => e.textContent); assert(cur.includes('220'), 'current hit row is 2nd price (220): ' + cur);
  await page.click('#colBtn'); await page.click('#nextBtn'); // reveals ancestors
  const cur2 = await page.$eval('.r.cur', e => e.textContent); assert(cur2.includes('95'), 'after collapse-all, next hit revealed: ' + cur2);
  // open sheet via click on primitive row
  await page.$eval('.r.cur', e => e.click());
  eq(await page.textContent('#shPath'), '$.data.items[2].price', 'sheet shows JSONPath');
  await page.click('#shClose');
  await page.fill('#q', 'has more'); await page.waitForTimeout(400);
  await page.$eval('.r.cur', e => e.click());
  eq(await page.textContent('#shPath'), "$.paging['has more']", 'special-char key path uses bracket form');
  await page.click('#shClose');
  // format + minify
  await page.selectOption('#indentSel', '4');
  await page.fill('#src', '{"x":[1,2]}'); await page.waitForTimeout(450);
  await page.click('#fmtBtn'); eq(await page.inputValue('#src'), '{\n    "x": [\n        1,\n        2\n    ]\n}', 'format with 4 spaces');
  await page.click('#minBtn'); eq(await page.inputValue('#src'), '{"x":[1,2]}', 'minify');
  await page.click('#tabText'); assert((await page.textContent('#txt')).includes('"x"'), 'text tab renders');
  // big file perf: ~10MB
  const ms = await page.evaluate(() => {
    const arr = []; for (let i = 0; i < 60000; i++) arr.push({ id: i, name: '項目 ' + i, tags: ['a', 'b'], price: i * 1.5, ok: i % 2 === 0, note: 'x'.repeat(80) });
    const t = JSON.stringify(arr); const t0 = performance.now(); const d = window.__jv.parseJSON(t); return [t.length, Math.round(performance.now() - t0), d.count];
  });
  console.log('big parse', ms); assert(ms[0] > 9e6 && ms[1] < 3000, `~10MB parse in ${ms[1]}ms (${ms[2]} nodes)`);
  // load it in UI and scroll
  const uiMs = await page.evaluate(async () => {
    const arr = []; for (let i = 0; i < 60000; i++) arr.push({ id: i, name: '項目 ' + i, tags: ['a', 'b'], price: i * 1.5, ok: i % 2 === 0, note: 'x'.repeat(80) });
    const t = JSON.stringify(arr); const t0 = performance.now(); window.__jv.load(t);
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); return Math.round(performance.now() - t0);
  });
  await page.click('#tabTree'); await page.click('#expBtn');
  const rows = await page.evaluate(() => { const vp = document.getElementById('vp'); vp.scrollTop = 500000; return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(document.querySelectorAll('.r:not([style*="display: none"])').length)))); });
  assert(rows < 200, `virtualized rows in DOM: ${rows}`);
  assert(uiMs < 3000, `10MB load in UI incl. render: ${uiMs}ms`);
  assert(await page.isVisible('#bigNote'), 'large content note shown');
  await page.screenshot({ path: `${OUT}/flow-large.png` });
  await ctx.close();
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASS');
  process.exit(errors.length ? 1 : 0);
})();
