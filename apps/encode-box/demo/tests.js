// Regression tests for 編碼轉換箱 (encode-box). One check per finding of the 2026-11-01 and round-2 release reviews, plus codec correctness.
// Usage: node tests.js   (Playwright Chromium, local http server, no network; waits on conditions, no fixed sleeps for results)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const HTML = SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>';
let pass = 0, fail = 0; const log = [], external = [];
function ok(c, m) { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('FAIL', m); } }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); ok(A === B, A === B ? m : `${m}\n     got  ${A}\n     want ${B}`); }
const mobile = (w, h, extra) => Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, extra || {});
const b64u = s => Buffer.from(s).toString('base64url');

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/apps/encode-box/`;
  const browser = await chromium.launch();
  const open = async (opt, tag) => {
    const ctx = await browser.newContext(opt); const p = await ctx.newPage();
    p.on('pageerror', e => log.push(`${tag} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') log.push(`${tag} console.${m.type()}: ${m.text()}`); });
    p.on('request', q => { if (!q.url().startsWith('http://127.0.0.1') && !q.url().startsWith('blob:')) external.push(q.url()); });
    await p.goto(URL); await p.waitForFunction(() => window.__ebReady);
    return { ctx, p, cdp: await ctx.newCDPSession(p) };
  };
  const T = 30000;
  try {
    const { ctx, p, cdp } = await open(mobile(390, 844), 'main');
    const conv = (id, dir, s, o) => p.evaluate(([id, dir, s, o]) => { const C = window.__eb.CODECS[id]; const r = window.__eb.convert(id, dir, s, Object.assign(window.__eb.optsFor(C), o || {})); return r.error ? 'ERR ' + r.error : r.text; }, [id, dir, s, o]);
    const note = (id, dir, s, o) => p.evaluate(([id, dir, s, o]) => { const C = window.__eb.CODECS[id]; return window.__eb.convert(id, dir, s, Object.assign(window.__eb.optsFor(C), o || {})).note || ''; }, [id, dir, s, o]);
    const fill = async (sel, v) => { await p.fill(sel, v); };
    const outIs = v => p.waitForFunction(v => document.getElementById('out').value === v, v, { timeout: T });

    console.log('Codec correctness');
    eq(await conv('b64', 'enc', '你好 😀 Hello, 世界'), '5L2g5aW9IPCfmIAgSGVsbG8sIOS4lueVjA==', 'Base64 sample');
    eq(await conv('b64', 'enc', 'x'.repeat(100), { wrap: true }).then(s => s.split('\n').map(l => l.length)), [76, 60], 'Base64 76-char wrap');
    eq(await conv('b64', 'dec', '/w=='), 'FF', 'Base64 non-UTF-8 shown as hex');
    eq(await conv('hex', 'enc', 'Hi中', { upper: true, sep: true }), '48 69 E4 B8 AD', 'Hex encode (lookup table)');
    eq(await conv('hex', 'enc', 'Hi中', { upper: false, sep: false }), '4869e4b8ad', 'Hex encode no separator');
    eq(await conv('hex', 'dec', '0x48,0x69:E4 b8 AD'), 'Hi中', 'Hex decode mixed case and separators');
    ok((await conv('hex', 'dec', '486')).includes('奇數'), 'Hex odd length error');
    eq(await conv('bin', 'enc', 'A中'), '01000001 11100100 10111000 10101101', 'Binary encode');
    eq(await conv('bin', 'dec', '01000001 11100100 10111000 10101101'), 'A中', 'Binary decode');
    { const r = await p.evaluate(() => { const C = window.__eb.convert; let s = ''; for (let i = 0; i < 3000; i++) s += String.fromCodePoint((i * 7919) % 0x10FFFF % 0xD000 + 1);
        const h = C('hex', 'enc', s, { upper: false, sep: true }).text, b = C('bin', 'enc', s, {}).text;
        return [C('hex', 'dec', h, {}).text === s, C('bin', 'dec', b, {}).text === s, C('b64', 'dec', C('b64', 'enc', s, { wrap: true }).text, {}).text === s]; });
      eq(r, [true, true, true], 'Hex / binary / Base64 round trip of 3000 mixed code points'); }
    eq(await conv('url', 'enc', 'a b&c=中'), 'a%20b%26c%3D%E4%B8%AD', 'URL component encode');
    eq(await conv('html', 'dec', '&copy; &#x4E2D;&bogus;'), '© 中&bogus;', 'HTML decode keeps unknown');
    eq(await conv('uni', 'dec', '\\u4F60 \\u{1F600} U+597D \\x41'), '你 😀 好A', 'Unicode decode mixed');
    eq(await conv('uni', 'enc', 'A😀中\uD800z', { style: 'u', nonascii: true }), 'A\\uD83D\\uDE00\\u4E2D\\uD800z', 'Unicode \\uXXXX: pairs as two escapes, ASCII kept');
    eq(await conv('uni', 'enc', 'A😀中', { style: 'brace', nonascii: false }), '\\u{41}\\u{1F600}\\u{4E2D}', 'Unicode \\u{} escapes everything');
    eq(await conv('uni', 'enc', 'A😀', { style: 'uplus', nonascii: true }), 'U+0041 U+1F600', 'Unicode U+XXXX');
    eq(await conv('uni', 'enc', 'plain', { style: 'u', nonascii: true }), 'plain', 'Unicode all-ASCII unchanged');
    eq(await conv('puny', 'dec', 'https://xn--fiq228c.tw/p'), 'https://中文.tw/p', 'Punycode decode inside URL');

    console.log('Finding: URL 整段網址 + 「+ 視為空白」 must escape a literal +');
    eq(await conv('url', 'enc', 'a+b c', { mode: 'full', plus: true }), 'a%2Bb+c', 'full+plus: a+b c → a%2Bb+c');
    eq(await conv('url', 'dec', 'a%2Bb+c', { mode: 'full', plus: true }), 'a+b c', 'full+plus decode returns the original');
    for (const s of ['1+1=2 & x', 'https://x.tw/p?q=a+b c#h', '中 + 文', '%2B+%20']) for (const mode of ['full', 'component']) {
      const e = await conv('url', 'enc', s, { mode, plus: true }); eq(await conv('url', 'dec', e, { mode, plus: true }), s, `round trip ${mode}+plus ${JSON.stringify(s)} (${e})`);
    }
    eq(await conv('url', 'enc', 'a+b c', { mode: 'full', plus: false }), 'a+b%20c', 'full without plus still keeps + (encodeURI)');

    console.log('Finding: Punycode NFC');
    eq(await conv('puny', 'enc', 'münchen.de'), 'xn--mnchen-3ya.de', 'NFD münchen → xn--mnchen-3ya.de');
    eq(await conv('puny', 'enc', 'München.DE'), 'xn--mnchen-3ya.DE', 'upper-case label lowered first');

    console.log('Finding: lone surrogates');
    { const e = await conv('url', 'enc', 'a\uD800b'); ok(/^ERR 第 2 個字元是孤立的代理字元（U\+D800）/.test(e), 'URL encode lone surrogate gives Chinese message: ' + e); }
    ok((await note('b64', 'enc', 'a\uD800b')).includes('孤立的代理字元'), 'Base64 encode notes the replaced lone surrogate');
    ok((await note('hex', 'enc', '\uDC00')).includes('U+DC00'), 'Hex encode notes the lone surrogate');
    eq(await note('b64', 'enc', '😀'), '', 'no note for a proper surrogate pair');

    console.log('Finding: JWT header/payload that is JSON but not an object');
    for (const [h, pl] of [['{"alg":"HS256"}', 'null'], ['null', '{"a":1}'], ['{"alg":"none"}', '123'], ['{"alg":"none"}', '"str"'], ['[1]', '{}']]) {
      const n0 = log.length; const tok = b64u(h) + '.' + b64u(pl) + '.x';
      await p.click('#codec-jwt'); await fill('#in', tok);
      await p.waitForFunction(() => !document.getElementById('err').hidden, null, { timeout: T });
      const st = await p.evaluate(() => ({ err: document.getElementById('err').textContent, jwt: !document.getElementById('jwt').hidden }));
      ok(log.length === n0 && /不是 JSON 物件/.test(st.err) && !st.jwt, `JWT ${h}.${pl}: error box, no page error (${st.err.slice(0, 40)})`);
    }
    { const n0 = log.length; await p.click('#codec-b64'); await fill('#in', b64u('{"alg":"HS256"}') + '.' + b64u('null') + '.x'); await p.click('#detectBtn');
      ok(log.length === n0 && await p.evaluate(() => window.__eb.detect(document.getElementById('in').value)) !== 'jwt', 'auto-detect with null payload: no page error, not JWT'); }
    { await p.click('#codec-jwt'); await fill('#in', 'a.b.c.d'); await p.waitForFunction(() => !document.getElementById('err').hidden);
      ok((await p.textContent('#err')).includes('應為 2 或 3 段'), 'JWT with 4 parts says 2 or 3 parts'); }
    { await fill('#in', b64u('{"alg":"none"}') + '.' + b64u('{"exp":1e20}') + '.x'); await p.waitForFunction(() => !document.getElementById('jwt').hidden);
      const t = await p.textContent('#jwt'); ok(t.includes('無效時間') && !t.includes('未過期') && !t.includes('天後'), 'JWT exp=1e20: only 無效時間, no relative time or status'); }

    console.log('Finding: U+XXXX disables 只跳脫非 ASCII');
    await p.click('#codec-uni'); await p.click('#dirEnc'); await fill('#in', 'A中');
    await p.selectOption('#opt-uni-style', 'uplus'); await outIs('U+0041 U+4E2D');
    ok(await p.isDisabled('#opt-uni-nonascii'), 'checkbox disabled for U+XXXX');
    await p.selectOption('#opt-uni-style', 'u'); await outIs('A\\u4E2D');
    ok(!(await p.isDisabled('#opt-uni-nonascii')), 'checkbox enabled again for \\uXXXX');

    console.log('Round 2: Unicode escape of text that already has backslashes / U+ round-trips');
    { const r = await p.evaluate(() => ['C:\\users\\中', 'U+0041 是 A', '\\u4E2D=中', 'a\\x41'].map(s => { const o = { style: 'u', nonascii: true }; const e = window.__eb.convert('uni', 'enc', s, o); const d = window.__eb.convert('uni', 'dec', e.text, o); return [s, e.text, d.error || d.text]; }));
      for (const [s, e, d] of r) eq(d, s, `round trip ${JSON.stringify(s)} via ${JSON.stringify(e)}`);
      eq(r.map(x => x[1]), ['C:\\users\\\\u4E2D', '\\u0055+0041 \\u662F A', '\\u005Cu4E2D=\\u4E2D', 'a\\u005Cx41'], 'only a backslash / U that would read as an escape is escaped');
      ok((await note('uni', 'dec', 'C:\\users')).includes('已保留原文'), 'an incomplete \\u is kept as text with a note, not an error'); }
    { // random strings rich in backslashes, u/x/U+/hex digits, for every style and option
      const r = await p.evaluate(() => { let seed = 7; const rnd = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
        const P = ['\\', '\\', 'u', 'x', 'U+', '{', '}', '0', '4', 'A', 'e', 'F', '9', '中', '😀', ' ', 'a', '\n', '"'];
        let bad = [], n = 0;
        for (let k = 0; k < 1500; k++) { let s = ''; const L = rnd(16); for (let i = 0; i < L; i++) s += P[rnd(P.length)];
          for (const style of ['u', 'brace', 'uplus']) for (const nonascii of [true, false]) for (const js of [false, true]) { const o = { style, nonascii, js }; n++;
            const e = window.__eb.convert('uni', 'enc', s, o); const d = window.__eb.convert('uni', 'dec', e.text, o); if (d.text !== s) bad.push([s, o, e.text, d.error || d.text]); } }
        return { n, bad: bad.slice(0, 5), count: bad.length }; });
      eq(r.count, 0, `${r.n} random Unicode round trips (all styles, 只跳脫非 ASCII on/off, JS on/off) ${JSON.stringify(r.bad)}`); }
    { // JS mode gives a valid JS/JSON string body
      const ins = ['C:\\users\\中', 'a\\u4E2D\\\\b 😀', 'U+0041\\x41'];
      for (const s of ins) for (const nonascii of [true, false]) { const e = await conv('uni', 'enc', s, { style: 'u', nonascii, js: true }); let v; try { v = JSON.parse('"' + e + '"'); } catch { v = 'JSON error'; }
        eq(v, s, `JS mode (只跳脫非 ASCII ${nonascii}) ${JSON.stringify(e)} parses back as JSON`); } }
    await p.click('#codec-uni'); await p.click('#dirEnc'); await fill('#in', 'C:\\中');
    await p.check('#opt-uni-js'); await outIs('C:\\\\\\u4E2D');
    await p.selectOption('#opt-uni-style', 'uplus'); ok(await p.isDisabled('#opt-uni-js'), 'JS option disabled for U+XXXX');
    await p.selectOption('#opt-uni-style', 'u'); await p.uncheck('#opt-uni-js'); await outIs('C:\\\\u4E2D');

    console.log('Round 2: Punycode maps like the browser (lower-case + NFKC)');
    { const url_ = require('url');
      for (const l of ['Ⅻ', 'ﬁ', 'münchen', 'Bücher', '中文', 'ＡＢＣ中', 'ß', 'ελληνικά', '😀', 'mu\u0308nchen'])
        eq(await conv('puny', 'enc', l + '.tw'), url_.domainToASCII(l + '.tw'), `${l}.tw matches the URL standard`); }

    console.log('Finding: short input converts without debounce');
    await p.click('#codec-b64');
    eq(await p.evaluate(() => { const i = document.getElementById('in'); i.value = 'hello'; i.dispatchEvent(new Event('input')); return document.getElementById('out').value; }), 'aGVsbG8=', 'output updated in the same task as the input event');

    console.log('Finding: >5MB input must not leave a stale output');
    await fill('#in', 'hello'); await outIs('aGVsbG8=');
    eq(await p.evaluate(() => { const i = document.getElementById('in'); i.value = 'q'.repeat(50000); i.dispatchEvent(new Event('input')); return document.getElementById('copyBtn').disabled; }), true, 'copy disabled while a large input waits for its conversion');
    await p.waitForFunction(() => document.getElementById('out').value.startsWith('cXFx'), null, { timeout: T });
    await fill('#in', 'hello'); await outIs('aGVsbG8=');
    let st = await p.evaluate(() => { const i = document.getElementById('in'); i.value = 'h'.repeat(6 * 1048576); i.dispatchEvent(new Event('input')); return document.getElementById('out').value; });
    eq(st, '', 'stale output cleared in the same task as the >5MB input event');
    await p.waitForFunction(() => !document.getElementById('bigBar').hidden, null, { timeout: T });
    st = await p.evaluate(() => ({ out: document.getElementById('out').value, meta: document.getElementById('outMeta').textContent, copy: document.getElementById('copyBtn').disabled, use: document.getElementById('useBtn').disabled }));
    eq(st, { out: '', meta: '按「轉換」產生結果', copy: true, use: true }, 'big input: output cleared, copy/use disabled');
    await p.click('#codec-hex');
    eq(await p.inputValue('#out'), '', 'switching codec with big input keeps output empty');
    await p.click('#runBtn');
    await p.waitForFunction(() => document.getElementById('out').value.length > 0, null, { timeout: 60000 });
    st = await p.evaluate(() => ({ preview: document.getElementById('out').value.length, full: window.__eb.result().text.length, head: document.getElementById('out').value.slice(0, 8), note: document.getElementById('note').textContent, copy: document.getElementById('copyBtn').disabled }));
    ok(st.full === 6 * 1048576 * 3 - 1 && st.preview <= 100000 && st.head === '68 68 68' && /完整/.test(st.note) && !st.copy, `manual run on 6MB (worker): full ${st.full}, preview ${st.preview}`);
    await p.click('#codec-b64');
    eq(await p.inputValue('#out'), '', 'switching back after a manual run shows no stale result');
    eq(await p.isDisabled('#copyBtn'), true, 'copy disabled again');

    console.log('Finding: large conversions run off the main thread and can be cancelled');
    { // 300k distinct CJK chars as one label: Punycode is quadratic here, so the job is reliably still running
      await p.click('#codec-puny'); await p.click('#dirEnc');
      await p.evaluate(() => { let s = ''; for (let i = 0; i < 300000; i++) s += String.fromCharCode(0x4E00 + i % 20000); const el = document.getElementById('in'); el.value = s; el.dispatchEvent(new Event('input')); });
      await p.waitForFunction(() => !document.getElementById('busy').hidden, null, { timeout: T });
      const resp = await p.evaluate(() => new Promise(r => { const t = performance.now(); setTimeout(() => r(performance.now() - t), 0); }));
      ok(resp < 1000, 'main thread free while converting (timer fired after ' + Math.round(resp) + 'ms)');
      await p.click('#cancelBtn');
      st = await p.evaluate(() => ({ busy: document.getElementById('busy').hidden, meta: document.getElementById('outMeta').textContent, bar: !document.getElementById('bigBar').hidden, msg: document.getElementById('bigMsg').textContent }));
      eq(st, { busy: true, meta: '已取消', bar: true, msg: '已取消轉換。' }, 'cancel stops the job and offers 轉換 again');
      await p.click('#codec-b64'); await fill('#in', 'ok'); await outIs('b2s=');
      ok(true, 'conversions work again after cancel');
    }

    console.log('Round 2: slower codecs go to the Worker from ~300k (100k for Punycode)');
    for (const [id, dir, mk] of [['bin', 'enc', () => 'a'.repeat(400000)], ['html', 'dec', () => '&amp;'.repeat(80000)], ['puny', 'enc', () => 'ü'.repeat(150000)]]) {
      await p.click('#codec-' + id); await p.click(dir === 'enc' ? '#dirEnc' : '#dirDec');
      const sync = await p.evaluate(src => { window.__eb.setInput((0, eval)('(' + src + ')')()); return !document.getElementById('copyBtn').disabled; }, mk.toString());
      eq(sync, false, `${id} ${dir} of a large input is not converted on the main thread`);
      await p.waitForFunction(() => document.getElementById('out').value !== '' || !document.getElementById('err').hidden, null, { timeout: 60000 });
    }
    await p.click('#codec-b64'); await p.click('#dirEnc'); await fill('#in', 'ok'); await outIs('b2s=');

    console.log('Finding: swipe left on the output swaps (touch-action)');
    { await p.click('#codec-url'); await p.click('#dirEnc'); await fill('#in', '中 文'); await outIs('%E4%B8%AD%20%E6%96%87');
      const b = await p.locator('#out').boundingBox(); const y = b.y + b.height / 2;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width - 20, y }] });
      for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width - 20 - k * 25, y: y + k }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForFunction(() => document.getElementById('in').value === '%E4%B8%AD%20%E6%96%87', null, { timeout: 5000 }).catch(() => {});
      eq([await p.inputValue('#in'), await p.inputValue('#out'), await p.getAttribute('#dirDec', 'aria-pressed')], ['%E4%B8%AD%20%E6%96%87', '中 文', 'true'], 'touch swipe left swapped input/output and direction'); }

    console.log('Finding: 結果當輸入 is labelled differently from ⇅ 交換');
    ok((await p.textContent('#useBtn')).includes('方向不變'), 'use-result button says the direction stays');

    console.log('Finding: input survives refresh by default (sessionStorage), clear can be undone, last keystrokes saved');
    await p.click('#codec-b64'); await p.click('#dirEnc');
    await fill('#in', 'my text'); await p.reload(); await p.waitForFunction(() => window.__ebReady);
    eq([await p.inputValue('#in'), await p.isVisible('#sampleChip')], ['my text', false], 'remember off: refresh keeps the input in this tab');
    ok(await p.evaluate(() => !Object.keys(localStorage).some(k => k.endsWith(':input'))), 'remember off: nothing written to localStorage');
    await fill('#in', 'abc'); await p.type('#in', 'DEF', { delay: 5 }); await p.reload(); await p.waitForFunction(() => window.__ebReady);
    eq(await p.inputValue('#in'), 'abcDEF', 'typing then refreshing at once keeps every character');
    await p.click('#clearBtn'); eq(await p.inputValue('#in'), '', 'clear empties the input');
    { const r = await p.evaluate(() => { const a = document.querySelector('.toast button').getBoundingClientRect(), o = document.getElementById('out').getBoundingClientRect(), c = document.getElementById('copyBtn').getBoundingClientRect();
        const hit = (x, y) => !(x.right <= y.left || y.right <= x.left || x.bottom <= y.top || y.bottom <= x.top); return [hit(a, o), hit(a, c)]; });
      eq(r, [false, false], 'round 2: the 復原 toast does not cover the output box or 複製結果'); }
    await p.click('.toast button'); eq(await p.inputValue('#in'), 'abcDEF', '復原 restores the cleared input');
    await p.click('#clearBtn'); await p.waitForSelector('.toast button');
    await p.tap('#codec-hex'); await p.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: T });
    ok(true, 'round 2: the next tap elsewhere closes the 復原 toast');
    await p.click('#codec-b64'); await fill('#in', 'abcDEF');
    await p.click('#clearBtn'); await p.reload(); await p.waitForFunction(() => window.__ebReady);
    eq(await p.isVisible('#sampleChip'), true, 'cleared input stays cleared after refresh (sample shown)');

    console.log('Finding: 記住輸入 with >100k chars');
    await p.check('#remChk'); await fill('#in', 'first saved');
    await p.evaluate(() => { const i = document.getElementById('in'); i.value = 'y'.repeat(150000); i.dispatchEvent(new Event('input')); });
    await p.reload(); await p.waitForFunction(() => window.__ebReady);
    eq((await p.inputValue('#in')).length, 150000, '150,000 chars come back after refresh');
    await fill('#in', 'first saved');
    await p.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/:input$/.test(k) && v.length > 1000) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); };
      const i = document.getElementById('in'); i.value = 'z'.repeat(5000); i.dispatchEvent(new Event('input')); });
    await p.waitForFunction(() => !document.getElementById('saveWarn').hidden, null, { timeout: T });
    ok((await p.textContent('#saveWarn')).includes('內容太大（5,000 字）'), 'storage full: visible warning with the size');
    await p.reload(); await p.waitForFunction(() => window.__ebReady);
    ok(await p.inputValue('#in') !== 'first saved', 'storage full: the older save is not restored');
    await p.uncheck('#remChk');
    ok(await p.evaluate(() => localStorage.getItem('encode-box:v1:input') === null), 'turning remember off clears the device copy');
    await ctx.close();

    console.log('Round 2: blocked storage is not reported as "too big"');
    { const c4 = await browser.newContext(mobile(390, 844)); await c4.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('denied', 'SecurityError'); }; });
      const p4 = await c4.newPage(); p4.on('pageerror', e => log.push('blocked pageerror: ' + e.message)); await p4.goto(URL); await p4.waitForFunction(() => window.__ebReady);
      await p4.fill('#in', 'ab'); await p4.waitForFunction(() => !document.getElementById('saveWarn').hidden, null, { timeout: T });
      const t1 = await p4.textContent('#saveWarn'); await p4.type('#in', 'cdef', { delay: 5 }); const t2 = await p4.textContent('#saveWarn');
      ok(t1.includes('不允許網站儲存資料') && !t1.includes('太大') && t1 === t2, 'blocked storage: one fixed message about blocked site data: ' + t1);
      await c4.close(); }

    console.log('Old saved data still loads');
    { const c2 = await browser.newContext(mobile(390, 844)); await c2.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1');
        localStorage.setItem('encode-box:v1:state', JSON.stringify({ codec: 'hex', dir: 'enc', opts: { hex: { upper: true } } })); localStorage.setItem('encode-box:v1:remember', 'true'); localStorage.setItem('encode-box:v1:input', JSON.stringify('Hi')); } });
      const p2 = await c2.newPage(); p2.on('pageerror', e => log.push('old pageerror: ' + e.message)); await p2.goto(URL); await p2.waitForFunction(() => window.__ebReady);
      eq([await p2.inputValue('#in'), await p2.inputValue('#out'), await p2.isChecked('#remChk')], ['Hi', '48 69', true], 'v1 keys (state, remember, input) restore codec, options and text');
      await c2.close(); }

    console.log('Layout findings');
    { const { ctx: c5, p: p5 } = await open(mobile(390, 844), 'L390w');
      const r = await p5.evaluate(() => { const n = document.getElementById('codecs').getBoundingClientRect(); return [...document.querySelectorAll('.codec')].every(c => { const b = c.getBoundingClientRect(); return b.left >= n.left && b.right <= n.right && b.height >= 44; }); });
      ok(r, '390x844: all 9 codecs visible without side scrolling (wrapped rows)');
      await c5.close(); }
    for (const [w, h] of [[360, 640]]) {
      const { ctx: c3, p: p3, cdp: d3 } = await open(mobile(w, h), `L${w}`);
      const r = await p3.evaluate(() => { const g = id => document.getElementById(id).getBoundingClientRect(); const boxes = [...document.querySelectorAll('.io > .box')].map(b => b.getBoundingClientRect());
        return { copyBottom: g('copyBtn').bottom, ih: innerHeight, gap: boxes[1].top - boxes[0].bottom, fade: document.getElementById('cwrap').classList.contains('more-r'),
          sel: [...document.querySelectorAll('.opts select')].map(s => s.getBoundingClientRect().height), sw: document.documentElement.scrollWidth, iw: innerWidth }; });
      ok(r.copyBottom <= r.ih, `${w}x${h}: 複製結果 on the first screen (bottom ${Math.round(r.copyBottom)} ≤ ${r.ih})`);
      ok(r.gap >= 10, `${w}x${h}: gap between INPUT and OUTPUT cards (${r.gap}px)`);
      ok(r.fade, `${w}x${h}: codec row shows the scroll hint`);
      ok(r.sw <= r.iw, `${w}x${h}: no horizontal scroll`);
      await p3.click('#codec-url');
      ok((await p3.$$eval('.opts select', s => s.map(e => e.getBoundingClientRect().height))).every(x => x >= 44), `${w}x${h}: option selects ≥ 44px`);
      // tap a chip that is only partly visible: the row must not jump
      const pos = await p3.evaluate(() => { const n = document.getElementById('codecs'); const vr = n.getBoundingClientRect();
        const b = [...n.children].find(c => { const r = c.getBoundingClientRect(); return r.left < vr.right - 8 && r.right > vr.right; }); const r = b.getBoundingClientRect(); return { id: b.id, x: (r.left + vr.right) / 2, y: r.top + r.height / 2, sl: n.scrollLeft }; });
      await d3.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pos.x, y: pos.y }] });
      await d3.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p3.waitForFunction(id => document.getElementById(id).getAttribute('aria-pressed') === 'true', pos.id, { timeout: T });
      eq(await p3.evaluate(() => document.getElementById('codecs').scrollLeft), pos.sl, `${w}x${h}: tapping half-visible ${pos.id} selects it without scrolling the row`);
      const small = await p3.$$eval('button,select,input[type=checkbox]', els => els.filter(e => e.offsetParent && e.closest('label,button,select') && (e.closest('label') || e).getBoundingClientRect().height < 44).map(e => e.id));
      eq(small, [], `${w}x${h}: every visible control ≥ 44px tall`);
      { const r = await p3.evaluate(() => { const w = document.getElementById('cwrap').getBoundingClientRect(), n = document.getElementById('codecs').getBoundingClientRect(), a = getComputedStyle(document.getElementById('cwrap'), '::after');
          return { fadeRight: w.right - parseFloat(a.right), navRight: n.right }; });
        ok(r.fadeRight >= r.navRight, `${w}x${h}: the fade covers the chip edge (fade to ${r.fadeRight}, row to ${r.navRight})`); }
      // an error message is on the first screen, above the (shrunk) output
      await p3.click('#codec-url'); await p3.click('#dirDec'); await p3.fill('#in', '%ZZ'); await p3.waitForFunction(() => !document.getElementById('err').hidden, null, { timeout: T });
      { const r = await p3.evaluate(() => { const e = document.getElementById('err').getBoundingClientRect(), o = document.getElementById('out').getBoundingClientRect(); return { eb: e.bottom, ot: o.top, ih: innerHeight }; });
        ok(r.eb <= r.ih && r.eb <= r.ot, `${w}x${h}: error box on the first screen above the output (bottom ${Math.round(r.eb)} ≤ ${r.ih})`); }
      await c3.close();
    }
  } catch (e) { fail++; console.log('FAIL exception', e.stack || e); }
  eq(log, [], 'no page errors, console errors or warnings');
  eq(external, [], 'no external requests');
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
