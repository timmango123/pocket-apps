// Playwright verification for encode-box. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ sub: '1234567890', name: '王小明', iat: 1716239022, exp: 1716242622 }) + '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

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
    await page.goto(URL); await page.waitForFunction(() => window.__ebReady);
    await page.waitForTimeout(200);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === 'dark-390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], s.name + ' all visible buttons >= 44px');
      await page.click('#codec-jwt');
      await page.fill('#in', JWT); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${s.name === '390x844' ? 'flow-jwt' : 'flow-jwt-dark'}.png`, fullPage: true });
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__ebReady);

  // round trips for every codec + options
  const rt = await page.evaluate(() => {
    const C = window.__eb.CODECS, src = '你好 😀', res = {};
    const variants = { b64: [{ wrap: false }, { wrap: true }], b64url: [{}], url: [{ mode: 'component', plus: false }, { mode: 'full', plus: true }], html: [{ mode: 'min' }, { mode: 'all' }],
      uni: [{ style: 'u', nonascii: true }, { style: 'brace', nonascii: false }, { style: 'uplus', nonascii: true }], hex: [{ upper: true, sep: true }, { upper: false, sep: false }], bin: [{}], puny: [{}] };
    for (const [id, vs] of Object.entries(variants)) vs.forEach((o, i) => { const e = C[id].enc(src, o).text; const d = C[id].dec(e, o).text; res[id + i] = [e, d === src]; });
    return res;
  });
  for (const [k, [e, ok]] of Object.entries(rt)) assert(ok, `round trip ${k}: ${e}`);
  const ev = async (id, dir, s, o) => page.evaluate(([id, dir, s, o]) => { const C = window.__eb.CODECS[id]; const opts = Object.assign(window.__eb.optsFor(C), o || {}); try { const r = dir === 'enc' ? C.enc(s, opts) : C.dec(s, opts); return r.text; } catch (e) { return 'ERR ' + e.message; } }, [id, dir, s, o]);
  eq(await ev('b64', 'enc', '中文😀'), '5Lit5paH8J+YgA==', 'Base64 中文😀');
  eq(await ev('b64', 'dec', '5Lit5paH8J+YgA'), '中文😀', 'Base64 decode auto-pads missing =');
  eq(await ev('b64url', 'enc', '中文😀'), '5Lit5paH8J-YgA', 'Base64URL 中文😀');
  eq(await ev('puny', 'enc', 'münchen.de'), 'xn--mnchen-3ya.de', 'Punycode münchen.de');
  eq(await ev('puny', 'enc', '中文.tw'), 'xn--fiq228c.tw', 'Punycode 中文.tw');
  eq(await ev('puny', 'dec', 'https://xn--fiq228c.tw/path?q=1'), 'https://中文.tw/path?q=1', 'Punycode decodes host inside URL');
  eq(await ev('url', 'enc', 'a b&c=中'), 'a%20b%26c%3D%E4%B8%AD', 'URL component encode');
  const urlErr = await ev('url', 'dec', '%E4%B8%AD%ZZ'); assert(urlErr.startsWith('ERR 第 10 個字元的「%ZZ」'), 'URL %ZZ error: ' + urlErr);
  const urlErr2 = await ev('url', 'dec', 'abc%E4%B8'); assert(urlErr2.includes('不是完整的 UTF-8'), 'URL truncated UTF-8 error: ' + urlErr2);
  eq(await ev('html', 'enc', '<a href="x">Tom & Jerry\'s</a>'), '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;', 'HTML encode');
  eq(await ev('html', 'dec', '&copy; 2026 &hellip; &#x4E2D;&#25991; &nbsp;&bogus;'), '© 2026 … 中文  &bogus;', 'HTML decode named/numeric, keeps unknown');
  eq(await ev('html', 'dec', '&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>', 'HTML decode does not execute');
  eq(await ev('uni', 'enc', 'A😀', { style: 'u', nonascii: true }), 'A\\uD83D\\uDE00', 'Unicode \\u surrogate pair');
  eq(await ev('uni', 'dec', '\\u4F60 \\u{1F600} U+597D \\x41'), '你 😀 好A', 'Unicode decode mixed formats');
  const uerr = await ev('uni', 'dec', 'ab\\u12'); assert(uerr.startsWith('ERR 第 3 個字元'), 'bad \\u error: ' + uerr);
  eq(await ev('hex', 'enc', 'Hi中', { upper: true, sep: true }), '48 69 E4 B8 AD', 'Hex encode');
  eq(await ev('hex', 'dec', '0x48 0x69'), 'Hi', 'Hex decode with 0x');
  assert((await ev('hex', 'dec', '486')).includes('奇數'), 'Hex odd length error');
  eq(await ev('bin', 'enc', 'A'), '01000001', 'Binary A');
  const jw = await ev('jwt', 'dec', JWT); assert(jw.includes('"name": "王小明"') && jw.includes('"alg": "HS256"'), 'JWT decodes header+payload');
  eq(await page.evaluate(j => window.__eb.detect(j), JWT), 'jwt', 'detect JWT');
  eq(await page.evaluate(() => [window.__eb.detect('%E4%B8%AD'), window.__eb.detect('&lt;b&gt;'), window.__eb.detect('\\u4F60'), window.__eb.detect('5Lit5paH'), window.__eb.detect('xn--fiq228c.tw'), window.__eb.detect('48 69')]), ['url', 'html', 'uni', 'b64', 'puny', 'hex'], 'detect url/html/uni/b64/puny/hex');

  // UI flow
  assert(await page.isVisible('#sampleChip'), 'sample chip shown on first open');
  eq(await page.inputValue('#out'), (await ev('b64', 'enc', '你好 😀 Hello, 世界')), 'sample encoded on open');
  await page.click('#codec-url'); await page.click('#dirDec');
  await page.fill('#in', '%E4%B8%AD%ZZ'); await page.waitForTimeout(250);
  assert(await page.isVisible('#err'), 'URL decode error visible in UI'); eq(await page.inputValue('#out'), '', 'output cleared on error');
  await page.screenshot({ path: `${OUT}/flow-error.png` });
  await page.fill('#in', '%E4%BD%A0%E5%A5%BD'); await page.waitForTimeout(250);
  eq(await page.inputValue('#out'), '你好', 'URL decode in UI');
  await page.click('#swapBtn'); await page.waitForTimeout(100);
  eq([await page.inputValue('#in'), await page.inputValue('#out'), await page.getAttribute('#dirEnc', 'aria-pressed')], ['你好', '%E4%BD%A0%E5%A5%BD', 'true'], 'swap moves output to input and flips direction');
  await page.fill('#in', 'SGVsbG8g5LiW55WM'); await page.click('#detectBtn'); await page.waitForTimeout(100);
  eq([await page.getAttribute('#codec-b64', 'aria-pressed'), await page.inputValue('#out')], ['true', 'Hello 世界'], 'auto-detect Base64 and decode');
  await page.click('#codec-b64'); await page.fill('#in', '/w=='); await page.waitForTimeout(250);
  assert((await page.textContent('#note')).includes('二進位'), 'non-UTF-8 base64 shows hex notice'); eq(await page.inputValue('#out'), 'FF', 'binary shown as hex');
  // jwt UI
  await page.click('#codec-jwt'); await page.fill('#in', JWT); await page.waitForTimeout(250);
  assert((await page.textContent('#jwt')).includes('已過期'), 'JWT exp shows 已過期');
  assert(await page.isDisabled('#dirEnc'), 'JWT encode disabled');
  // option persistence + no input stored by default
  await page.click('#codec-hex'); await page.click('#opt-hex-upper');
  const ls = await page.evaluate(() => Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]));
  assert(ls.every(([k]) => k.startsWith('encode-box:v1:')) && !ls.some(([k]) => k.endsWith(':input')), 'no input stored by default; keys namespaced: ' + ls.map(x => x[0]).join(','));
  await page.reload(); await page.waitForFunction(() => window.__ebReady);
  eq([await page.getAttribute('#codec-hex', 'aria-pressed'), await page.isChecked('#opt-hex-upper')], ['true', true], 'codec + options remembered after reload');
  await ctx.close();
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASS');
  process.exit(errors.length ? 1 : 0);
})();
