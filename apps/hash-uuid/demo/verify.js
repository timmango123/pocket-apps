// Playwright verification for hash-uuid. Run: node verify.js
// Reference values come from Python hashlib / hmac / zlib.crc32.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const WRAP = path.resolve(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, k2) => (o[k2] = x[k2], o), {}) : x);
const short = s => s.length > 90 ? s.slice(0, 90) + '…' : s;
const eq = (a, b, m) => { const A = canon(a), B = canon(b); assert(A === B, `${m}: ${A === B ? short(A) : A + ' != ' + B}`); };

const BIGFILE = path.resolve(__dirname, '_test.bin');
const py = `
import hashlib, hmac, zlib, json, sys, os
texts = ["", "abc", "The quick brown fox jumps over the lazy dog", "雜湊與 UUID 😀", "a"*1000, "x"*55, "x"*56, "x"*64, "abc\\nabc", "abc\\r\\nabc"]
algs = {"SHA-1":"sha1","SHA-256":"sha256","SHA-384":"sha384","SHA-512":"sha512","MD5":"md5"}
def all_for(b, key=None):
    r = {}
    for k,v in algs.items():
        r[k] = hmac.new(key, b, v).hexdigest() if key is not None else hashlib.new(v, b).hexdigest()
    r["CRC32"] = "%08x" % (zlib.crc32(b) & 0xffffffff)
    return r
out = {"plain": {t: all_for(t.encode()) for t in texts},
       "hmac": {t: all_for(t.encode(), b"key") for t in texts[:4]},
       "hmacEmpty": all_for(b"abc", b"")}
data = os.urandom(3*1024*1024+123)
open(sys.argv[1], "wb").write(data)
out["file"] = all_for(data)
print(json.dumps(out))`;
const REF = JSON.parse(execFileSync('python3', ['-c', py, BIGFILE]).toString());

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
    await page.goto(URL); await page.waitForFunction(() => window.__huReady);
    await page.waitForTimeout(300);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    eq(sw[1], s.viewport.width, `${s.name} innerWidth equals device width`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844' || s.name === 'dark-390x844') {
      const small = await page.$$eval('button', els => els.filter(e => e.offsetParent && e.getBoundingClientRect().height < 44).map(e => e.id || e.textContent));
      eq(small, [], s.name + ' all visible buttons >= 44px');
      await page.click('#alg-sha512', { force: true }); await page.click('#alg-crc32', { force: true });
      await page.fill('#expect', 'BA7816BF 8F01CFEA 414140DE 5DAE2223 B00361A3 96177A9C B410FF61 F20015AD');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/flow-hash${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
      await page.click('#tab-uuid'); await page.click('#ver-v7'); await page.waitForTimeout(100);
      await page.screenshot({ path: `${OUT}/flow-uuid${s.name.startsWith('dark') ? '-dark' : ''}.png`, fullPage: true });
      const sw2 = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      assert(sw2, s.name + ' uuid tab no horizontal scroll');
    }
    await ctx.close();
  }

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__huReady);

  // Library vs Python, every algorithm, plain + HMAC
  const lib = await page.evaluate(async ({ texts, hm }) => {
    const H = window.__hu.H, enc = new TextEncoder(), hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    const go = (t, key) => new Promise(res => H.run({ blob: new Blob([enc.encode(t)]), algs: ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'MD5', 'CRC32'], key }, m => { if (m.type === 'done') { const o = {}; for (const k in m.res) o[k] = hex(m.res[k].bytes); res(o); } }, () => false));
    const out = { plain: {}, hmac: {}, js256: {}, jsHmac: {} };
    for (const t of texts) out.plain[t] = await go(t, null);
    for (const t of hm) out.hmac[t] = await go(t, enc.encode('key'));
    out.hmacEmpty = await go('abc', new Uint8Array(0));
    for (const t of texts) out.js256[t] = hex(H.sha256().update(enc.encode(t)).digest());
    for (const t of hm) out.jsHmac[t] = [hex(H.hmac(H.sha256, enc.encode('key')).update(enc.encode(t)).digest()), hex(H.hmac(H.md5, enc.encode('key')).update(enc.encode(t)).digest())];
    // chunked update must equal one-shot
    const big = enc.encode('分段'.repeat(5000)); const h = H.md5(); for (let i = 0; i < big.length; i += 37) h.update(big.subarray(i, i + 37));
    out.chunk = [hex(h.digest()), hex(H.md5().update(big).digest())];
    return out;
  }, { texts: Object.keys(REF.plain), hm: Object.keys(REF.hmac) });
  for (const t of Object.keys(REF.plain)) {
    const crcRef = REF.plain[t].CRC32;
    eq(lib.plain[t], REF.plain[t], `all algs "${t.slice(0, 20)}${t.length > 20 ? '…' : ''}" (len ${t.length}) match Python`);
    eq(lib.js256[t], REF.plain[t]['SHA-256'], `pure-JS SHA-256 "${t.slice(0, 12)}" matches hashlib`);
  }
  for (const t of Object.keys(REF.hmac)) {
    const exp = Object.assign({}, REF.hmac[t], { CRC32: REF.plain[t].CRC32 });
    eq(lib.hmac[t], exp, `HMAC key="key" "${t.slice(0, 16)}" all SHA + MD5 match Python hmac`);
    eq(lib.jsHmac[t], [REF.hmac[t]['SHA-256'], REF.hmac[t]['MD5']], `pure-JS HMAC-SHA256/MD5 "${t.slice(0, 12)}"`);
  }
  eq(lib.hmacEmpty, Object.assign({}, REF.hmacEmpty, { CRC32: REF.plain.abc.CRC32 }), 'HMAC with empty key matches Python');
  eq(lib.chunk[0], lib.chunk[1], 'MD5 streaming in 37-byte chunks equals one-shot');
  eq(REF.plain.abc.MD5, '900150983cd24fb0d6963f7d28e17f72', 'spec MD5(abc) vector');
  eq(REF.plain[''].CRC32, '00000000', 'CRC32 empty');

  // UI: default text abc
  await page.click('#alg-sha1', { force: true }); await page.click('#alg-crc32', { force: true });
  await page.waitForTimeout(300);
  const cards = async () => page.$$eval('#results .card', cs => cs.map(c => [c.querySelector('h3').textContent, c.querySelector('.digest').textContent, c.className]));
  let cs = await cards();
  eq(cs.find(c => c[0] === 'SHA-256')[1], REF.plain.abc['SHA-256'], 'UI SHA-256(abc) = ba7816bf…15ad');
  eq(cs.find(c => c[0] === 'MD5')[1], REF.plain.abc.MD5, 'UI MD5(abc)');
  eq(cs.find(c => c[0] === 'CRC32')[1], REF.plain.abc.CRC32, 'UI CRC32(abc) = 352441c2');
  // empty text
  await page.fill('#text', ''); await page.waitForTimeout(300);
  cs = await cards();
  eq(cs.find(c => c[0] === 'SHA-256')[1], REF.plain['']['SHA-256'], 'UI SHA-256("") = e3b0c442…b855');
  // CRLF normalisation
  await page.fill('#text', 'abc\nabc'); await page.waitForTimeout(300);
  eq((await cards()).find(c => c[0] === 'SHA-256')[1], REF.plain['abc\nabc']['SHA-256'], 'multi-line text hashed with LF');
  await page.click('#crlf'); await page.waitForTimeout(300);
  eq((await cards()).find(c => c[0] === 'SHA-256')[1], REF.plain['abc\r\nabc']['SHA-256'], 'CRLF option hashes with CRLF');
  await page.click('#crlf');
  // Base64 format + expected compare
  await page.fill('#text', 'abc'); await page.waitForTimeout(300);
  await page.click('#results .card:nth-child(2) .fmt button[data-f="b64"]');
  cs = await cards(); eq(cs[1][1], Buffer.from(REF.plain.abc['SHA-256'], 'hex').toString('base64'), 'Base64 output for SHA-256');
  await page.fill('#expect', Buffer.from(REF.plain.abc.MD5, 'hex').toString('base64')); await page.waitForTimeout(100);
  cs = await cards(); assert(cs.find(c => c[0] === 'MD5')[2].includes('match'), 'Base64 expected value marks MD5 as match');
  await page.fill('#expect', REF.plain.abc['SHA-256'].toUpperCase().replace(/(.{8})/g, '$1 ')); await page.waitForTimeout(100);
  cs = await cards(); assert(cs.find(c => c[0] === 'SHA-256')[2].includes('match') && cs.find(c => c[0] === 'MD5')[2].includes('miss'), 'uppercase spaced hex matches SHA-256, MD5 marked mismatch');
  // HMAC UI
  await page.fill('#expect', '');
  await page.click('#results .card:nth-child(2) .fmt button[data-f="hex"]');
  await page.click('#hmac'); await page.fill('#hmacKey', 'key'); await page.waitForTimeout(400);
  cs = await cards(); eq(cs.find(c => c[0] === 'HMAC-SHA-256')[1], REF.hmac.abc['SHA-256'], 'UI HMAC-SHA-256(abc,key)');
  await page.click('#hmac'); await page.waitForTimeout(200);

  // File mode
  await page.click('#src-file');
  await page.setInputFiles('#file', BIGFILE);
  await page.waitForFunction(() => !window.__hu.S.busy && Object.keys(window.__hu.S.res).length, null, { timeout: 30000 });
  await page.waitForTimeout(100);
  cs = await cards();
  for (const c of cs) eq(c[1], REF.file[c[0]], `file (3MB) ${c[0]} matches Python`);
  const usedWorker = await page.evaluate(() => !!window.__hu.workerURL);
  console.log('info worker URL available:', usedWorker);
  await page.screenshot({ path: `${OUT}/flow-file.png`, fullPage: true });

  // UUID
  await page.click('#tab-uuid');
  const u = await page.evaluate(() => {
    const H = window.__hu; const v7 = []; for (let i = 0; i < 1000; i++) v7.push(H.uuid7());
    const v4 = []; for (let i = 0; i < 200; i++) v4.push(H.uuid4());
    return { v7, v4 };
  });
  eq(u.v7.slice().sort(), u.v7, '1000 v7 UUIDs sort order equals generation order');
  eq(new Set(u.v7).size, 1000, '1000 v7 UUIDs unique');
  assert(u.v7.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)), 'v7 version/variant bits');
  assert(u.v4.every(x => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x)), 'v4 version/variant bits');
  await page.click('#ver-v7'); await page.fill('#count', '5000'); await page.dispatchEvent('#count', 'change');
  eq(await page.$eval('#count', e => e.value), '1000', 'count clamped to 1000');
  eq(await page.$$eval('#uuidList li', l => l.length), 1000, '1000 rows rendered');
  await page.fill('#count', '3'); await page.dispatchEvent('#count', 'change');
  await page.click('#upper'); await page.click('#braces');
  const rows = await page.$$eval('#uuidList button', b => b.map(x => x.textContent));
  assert(rows.every(r => /^\{[0-9A-F-]{36}\}$/.test(r)), 'uppercase + braces format: ' + rows[0]);
  const parsed = await page.$eval('#parseOut', e => e.textContent);
  assert(parsed.includes('v7') && parsed.includes('RFC 9562') && parsed.includes(String(new Date().getUTCFullYear())), 'auto-parse of generated v7 shows version + time');
  await page.fill('#parse', '017F22E2-79B0-7CC3-98C4-DC0C0C07398F'); // RFC 9562 example
  const p2 = await page.$eval('#parseOut', e => e.textContent);
  assert(p2.includes('1645557742000') && p2.includes('2022-02-22T19:22:22.000Z'), 'RFC 9562 v7 example → 2022-02-22T19:22:22Z');
  await page.fill('#parse', 'C232AB00-9414-11EC-B3C8-9F6BDECED846'); // RFC 9562 v1 example
  const p3 = await page.$eval('#parseOut', e => e.textContent);
  assert(p3.includes('v1') && p3.includes('2022-02-22T19:22:22.000Z'), 'RFC 9562 v1 example time');
  await page.fill('#parse', 'not-a-uuid');
  eq(await page.$eval('#parseOut', e => e.textContent), '不是有效的 UUID', 'invalid UUID message');
  const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  assert(!ls.includes('abc') && !ls.includes('key"'), 'localStorage holds no inputs: ' + ls);
  await page.click('#copyAll');
  await ctx.close();
  await browser.close();
  fs.unlinkSync(WRAP); fs.unlinkSync(BIGFILE);
  console.log(errors.length ? '\nERRORS:\n' + errors.join('\n') : '\nALL PASSED');
  process.exit(errors.length ? 1 : 0);
})();
