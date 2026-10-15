// Playwright verification for regex-lab. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);
const settle = page => page.waitForTimeout(260).then(() => page.waitForFunction(() => !window.__rl.pending && document.getElementById('stat').textContent !== '執行中…', null, { timeout: 5000 })).then(() => page.waitForTimeout(50));

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
    await page.goto(URL); await page.waitForFunction(() => window.__rlReady); await settle(page);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    const flagsRow = await page.$$eval('.flag', f => new Set(f.map(e => Math.round(e.getBoundingClientRect().top))).size);
    eq(flagsRow, 1, `${s.name} flag buttons on one row`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent.slice(0, 20)));
      eq(small, [], 'all visible buttons >= 44px');
      await page.screenshot({ path: `${OUT}/390x844-full.png`, fullPage: true });
      await page.click('#libBtn'); await page.waitForTimeout(100); await page.screenshot({ path: `${OUT}/flow-library.png` }); await page.click('#libSheet [data-close]');
      await page.click('#tab-explain'); await page.evaluate(() => document.getElementById('tab-explain').scrollIntoView()); await page.screenshot({ path: `${OUT}/flow-explain.png` });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__rlReady); await settle(page);
  eq(await page.evaluate(() => window.__rl.noWorker()), false, 'Blob Worker in use');
  // default sample: dates with named groups
  eq(await page.$$eval('#hl mark', m => m.map(e => e.textContent)), ['2026-10-12', '2026-10-15', '2026-11-01'], 'date sample highlights 3 valid dates');
  assert((await page.textContent('#mlist')).includes('<year>'), 'named groups listed');
  await page.click('#tab-repl');
  assert((await page.textContent('#replOut')).includes('於 12/10/2026 成立'), 'replace with $<day>/$<month>/$<year>');
  // Email sample from library
  await page.evaluate(() => window.__rl.applySample(window.__rl.SAMPLES.find(x => x.name === 'Email'))); await settle(page);
  eq(await page.$$eval('#hl mark', m => m.map(e => e.textContent)), ['amy.lin@example.com.tw', 'service+tw@shop-demo.io', 'ken_chen@mail.example.org'], 'Email sample marks all addresses');
  // zero-length ^ with gm
  await page.fill('#pattern', '^'); await page.click('#flag-m'); await settle(page);
  eq(await page.evaluate(() => window.__rl.last.matches.map(m => m.i)), await page.evaluate(() => { const t = document.getElementById('text').value, r = [0]; for (let i = 0; i < t.length; i++) if (t[i] === '\n') r.push(i + 1); return r; }), 'zero-length ^ gm: one per line, no infinite loop');
  await page.click('#flag-m');
  await page.fill('#pattern', ''); await page.fill('#pattern', 'x*'); await settle(page);
  const zl = await page.evaluate(() => window.__rl.last.matches.length); assert(zl > 50 && zl < 200, 'x* zero-length matches terminate: ' + zl);
  // catastrophic backtracking
  await page.evaluate(() => window.__rl.applySample(window.__rl.SAMPLES.find(x => x.name === '災難性回溯示範')));
  await page.fill('#text', 'a'.repeat(30) + 'b');
  const t0 = Date.now();
  const responsive = await page.evaluate(() => new Promise(r => setTimeout(() => r(1), 400)));
  eq(responsive, 1, 'page responsive while catastrophic pattern runs');
  await page.waitForFunction(() => !document.getElementById('err').hidden && document.getElementById('err').textContent.includes('災難性回溯'), null, { timeout: 3000 });
  const took = Date.now() - t0; assert(took < 2000, `catastrophic pattern aborted after ~${took}ms`);
  await page.screenshot({ path: `${OUT}/flow-timeout.png` });
  // recovers afterwards
  await page.fill('#pattern', 'a+$'); await settle(page);
  eq(await page.evaluate(() => window.__rl.last && window.__rl.last.matches.length), 0, 'worker recreated after abort (a+$ runs)');
  await page.fill('#text', 'aaab'); await page.fill('#pattern', 'a+b'); await settle(page);
  eq(await page.$$eval('#hl mark', m => m.map(e => e.textContent)), ['aaab'], 'matching works after abort');
  // unicode with u flag
  await page.evaluate(() => window.__rl.applySample(window.__rl.SAMPLES.find(x => x.name.startsWith('中文字')))); await settle(page);
  eq(await page.$$eval('#hl mark', m => m.map(e => e.textContent)), ['你好', '世界', '臺北', '𠮷野家'], 'u flag Han matches incl. astral char');
  eq(await page.evaluate(() => window.__rl.last.matches.map(m => [m.i, m.e])), [[6, 8], [9, 11], [18, 20], [24, 28]], 'u flag positions (UTF-16)');
  // invalid pattern
  await page.fill('#pattern', '(abc'); await page.waitForTimeout(300);
  assert((await page.textContent('#err')).includes('括號沒有閉合'), 'unterminated group explained in Chinese');
  await page.fill('#pattern', '*a'); await page.waitForTimeout(300);
  assert((await page.textContent('#err')).includes('量詞'), 'nothing to repeat explained');
  // overlay alignment: long wrapped text, textarea must not scroll internally & heights equal
  await page.fill('#pattern', '\\d+');
  await page.fill('#text', ('第一行 123 文字很長很長很長很長很長很長很長很長 456 😀 ' .repeat(6) + '\n').repeat(8)); await settle(page);
  const geo = await page.evaluate(() => { const t = document.getElementById('text'), h = document.getElementById('hl'); return [t.scrollHeight - t.clientHeight, Math.abs(t.offsetHeight - h.offsetHeight), t.offsetWidth === h.offsetWidth]; });
  eq(geo, [0, 0, true], 'overlay textarea and highlight layer same size, no inner scroll');
  // caret/mark alignment: measure position of 5th match in highlight vs textarea caret position via mirror
  const align = await page.evaluate(() => {
    const t = document.getElementById('text'), mk = document.querySelectorAll('#hl mark')[9];
    const m = window.__rl.last.matches[9]; const r = document.createRange(); const tn = document.createTextNode(t.value.slice(0, m.i));
    // compare with a fresh copy of hl styles holding plain text up to match start
    const probe = document.getElementById('hl').cloneNode(false); probe.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:' + document.getElementById('hl').offsetWidth + 'px';
    const end = document.createElement('span'); end.textContent = 'X'; probe.append(tn, end); document.querySelector('.inner').appendChild(probe);
    const a = end.getBoundingClientRect(), b = mk.getBoundingClientRect(); probe.remove();
    return [Math.round(a.left - b.left), Math.round(a.top - b.top)];
  });
  eq(align, [0, 0], 'highlight mark sits exactly where text flows');
  // split
  await page.fill('#pattern', ',\\s*'); await page.fill('#text', 'a, b,c'); await settle(page);
  await page.click('#tab-split'); eq(await page.textContent('#splitOut'), '0: "a"\n1: "b"\n2: "c"', 'split result');
  // explain
  const toks = await page.evaluate(() => window.__rl.tokenize('^(?<y>\\d{4})-[^a-z]+?\\b').map(t => t.t));
  eq(toks, ['^', '(?<y>', '\\d', '{4}', ')', '-', '[^a-z]', '+?', '\\b'], 'explainer tokens');
  // click match -> flash
  await page.fill('#pattern', '\\d+'); await page.fill('#text', ('行\n').repeat(40) + '777'); await settle(page);
  await page.click('#tab-list'); await page.click('#mlist button[data-k="0"]');
  const ed = await page.evaluate(() => [document.getElementById('editor').scrollTop > 0, !!document.querySelector('#hl mark.flash')]);
  eq(ed, [true, true], 'click match scrolls editor and flashes mark');
  // cheat sheet insert
  await page.fill('#pattern', 'ab'); await page.click('#pattern'); await page.keyboard.press('End');
  await page.click('#csBtn'); await page.locator('#csBody button').filter({ has: page.locator('code', { hasText: /^\\d$/ }) }).click();
  eq(await page.inputValue('#pattern'), 'ab\\d', 'cheat sheet inserts at caret');
  // persistence
  await page.waitForTimeout(400); await page.reload(); await page.waitForFunction(() => window.__rlReady); await settle(page);
  eq([await page.inputValue('#pattern'), await page.inputValue('#text')], ['ab\\d', ('行\n').repeat(40) + '777'], 'state restored after reload');
  await ctx.close();
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASS');
  process.exit(errors.length ? 1 : 0);
})();
