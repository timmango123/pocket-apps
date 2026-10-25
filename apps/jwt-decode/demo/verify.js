// Playwright check for JWT 與網址解析 (jwt-decode). Run: node verify.js
// Sizes: 390x844, the lobby iframes 375x500 / 390x610 / 430x740, 360x640, 430x932, 844x390 landscape, desktop; light + dark.
// Flows: sample verifies, wrong secret, encoding hint, every sample, Bearer paste, URL table edit/delete/undo/add,
// nested URL → back, fragment id_token → JWT, copy, clear + undo, persistence, live countdown, rapid real-touch taps,
// big input, no network requests. Writes cover-390x520.png (+ dark).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const OUT = __dirname;
const WRAP = path.join(OUT, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(OUT, '../index.html'), 'utf8') + '</body></html>');
const URL0 = 'file://' + WRAP;
const errors = [];
let passN = 0;
const assert = (c, m) => { if (!c) { errors.push(m); console.log('FAIL', m); } else { passN++; console.log('ok  ', m); } };
const touch = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64url');

(async () => {
  const browser = await chromium.launch();
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) errors.push(`${tag} network request: ${r.url()}`); });
  };
  const ready = p => p.waitForFunction(() => window.__jdReady && window.__jd.vres);
  const layoutCheck = () => {
    const vis = e => { const r = e.getBoundingClientRect(); return e.offsetParent && r.width > 0; };
    const btns = [...document.querySelectorAll('button,input,textarea,[role=button]')].filter(vis);
    const small = btns.filter(b => { const r = b.getBoundingClientRect(); return (r.width < 43.5 || r.height < 36) || (b.tagName === 'BUTTON' && !b.classList.contains('mini') && r.height < 43.5); }).map(b => (b.id || b.className || b.textContent.trim()) + "@" + Math.round(b.getBoundingClientRect().width) + "x" + Math.round(b.getBoundingClientRect().height) + ":" + b.textContent.trim().slice(0,8));
    const cut = btns.filter(b => { const r = b.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map(b => b.id || b.className);
    return { sw: document.documentElement.scrollWidth, iw: innerWidth, small, cut };
  };

  // ---------- sizes x themes x content ----------
  const sizes = [['390x844', 390, 844], ['375x500', 375, 500], ['390x610', 390, 610], ['430x740', 430, 740], ['360x640', 360, 640], ['430x932', 430, 932], ['844x390', 844, 390]];
  for (const scheme of ['light', 'dark']) for (const [name, w, h] of sizes) {
    const ctx = await browser.newContext({ ...touch(w, h), colorScheme: scheme }); const p = await ctx.newPage(); watch(p, `${name}-${scheme}`);
    const t0 = Date.now(); await p.goto(URL0); await ready(p); const lt = Date.now() - t0;
    if (name === '390x844') assert(lt < 1000, `${scheme}: first load to verified result in ${lt} ms`);
    for (const sid of ['login', 'shop', 'api', 'oauth']) {
      await p.evaluate(s => window.__jd.loadSample(s, false), sid); await p.waitForTimeout(450);
      const m = await p.evaluate(layoutCheck);
      assert(m.sw <= m.iw, `${name} ${scheme} ${sid}: no horizontal scroll (${m.sw}<=${m.iw})`);
      assert(!m.small.length, `${name} ${scheme} ${sid}: tap targets >= 44px ${m.small.join(',')}`);
      assert(!m.cut.length, `${name} ${scheme} ${sid}: nothing cut off ${m.cut.join(',')}`);
      if (name === '844x390') assert(await p.evaluate(() => { const t = document.querySelector('#verdict .tile'), r = t && t.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight && scrollY === 0; }), `844x390 ${scheme} ${sid}: verdict visible on the first screen, beside the input`);
      if (sid === 'login') await p.screenshot({ path: `${OUT}/shot-${name}-${scheme}.png` });
    }
    await ctx.close();
  }
  { // desktop: input + verify on the left, claims on the right
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage(); watch(p, 'desktop');
    await p.goto(URL0); await ready(p); await p.waitForTimeout(200);
    const lay = await p.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(); return { inTop: r('inCard').top, sigTop: r('sec-sig').top, inL: r('inCard').left, clL: r('sec-claims').left }; });
    assert(lay.inTop < lay.sigTop && lay.clL > lay.inL + 300, 'desktop: input then verdict/verify on the left, claims on the right');
    await p.screenshot({ path: `${OUT}/shot-1280x800.png` }); await ctx.close();
  }

  // ---------- flows ----------
  const ctx = await browser.newContext({ ...touch(390, 844), permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); watch(p, 'flow');
  await p.goto(URL0); await ready(p);
  const st = () => p.evaluate(() => ({ kind: window.__jd.det.kind, v: window.__jd.vres && window.__jd.vres.state, hint: window.__jd.vres && window.__jd.vres.hint, tiles: [...document.querySelectorAll('#verdict .tile b')].map(b => b.textContent) }));
  let s = await st();
  assert(s.kind === 'jwt' && s.v === 'ok' && s.tiles[0] === '簽章正確' && s.tiles[1] === '有效中', 'sample: signature verified and token valid on first open');
  assert(await p.isVisible('#sampleChip'), 'sample marked 範例');
  assert(/還有 2 小時 3\d 分鐘過期/.test(await p.textContent('[data-tk="exp"]')), 'exp shows a relative countdown: ' + await p.textContent('[data-tk="exp"]'));
  const hc = await p.evaluate(() => [...document.querySelectorAll('#hlc span')].map(x => x.className).filter((c, i, a) => a.indexOf(c) === i));
  assert(['h', 'dt', 'p', 's'].every(c => hc.includes(c)), 'token colour-coded into header / payload / signature');
  // wrong secret, then a base64 secret hint
  await p.fill('#secret', 'wrong'); await p.waitForTimeout(350);
  s = await st(); assert(s.v === 'bad' && s.tiles[0] === '簽章不符', 'wrong secret → 簽章不符');
  const sec = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0+Pw==';
  const tokB = await p.evaluate(async sec => { const raw = Uint8Array.from(atob(sec), c => c.charCodeAt(0)); const J = window.__jd.J; const si = J.b64urlEnc(J.te.encode('{"alg":"HS256"}')) + '.' + J.b64urlEnc(J.te.encode('{"sub":"b64","exp":4102444800}')); const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return si + '.' + J.b64urlEnc(new Uint8Array(await crypto.subtle.sign('HMAC', k, J.te.encode(si)))); }, sec);
  await p.fill('#src', tokB); await p.waitForTimeout(200); await p.fill('#secret', sec); await p.waitForTimeout(350);
  s = await st(); assert(s.v === 'bad' && s.hint === 'b64', 'base64 secret typed as text → hint to switch');
  await p.click('#vres [data-enc="b64"]'); await p.waitForTimeout(250);
  s = await st(); assert(s.v === 'ok', 'one tap on the hint switches to Base64 and verifies');
  await p.click('.segc [data-enc="text"]');
  // Bearer + line breaks pasted
  const T = await p.evaluate(() => window.__jd.det.token);
  await p.fill('#src', 'Authorization: Bearer ' + T.slice(0, 50) + '\n' + T.slice(50)); await p.waitForTimeout(250);
  assert((await p.evaluate(() => window.__jd.det.token)) === T && /Bearer/.test(await p.textContent('#legend')), 'Bearer prefix and line break removed, and said so');
  // every sample through the sheet
  for (const [sid, want] of [['oidc', 'ok'], ['api', 'ok'], ['expired', 'ok'], ['none', null], ['jwe', null]]) {
    await p.click('#sampleBtn'); await p.click(`.sheet [data-sid="${sid}"]`); await p.waitForTimeout(400);
    s = await st();
    if (want) assert(s.v === want, `sample ${sid}: signature ${s.v}`);
    if (sid === 'expired') assert(s.tiles[1] === '已過期' && /已過期 3 天/.test(await p.textContent('[data-tk="exp"]')), 'expired sample shows 已過期 3 天');
    if (sid === 'none') assert(s.tiles[0] === '沒有簽章' && /none/.test(await p.textContent('.issues .bad')), 'alg none flagged');
    if (sid === 'jwe') assert(s.tiles[0] === '已加密' && (await p.$$('.jparts li')).length === 5, 'JWE shows 5-part structure');
  }
  // broken inputs
  await p.fill('#src', 'eyJhbGciOiJIUzI1NiJ9.a.b.c'); await p.waitForTimeout(200);
  assert(/4 段/.test(await p.textContent('.errcard')), 'four-part token explained');
  await p.fill('#src', 'hello world'); await p.waitForTimeout(200);
  assert(await p.isVisible('#sec-guide'), 'unrecognised input shows guidance');
  // URL: edit a parameter, check the URL, delete + undo, add
  await p.evaluate(() => window.__jd.loadSample('shop', false)); await p.waitForTimeout(200);
  const kw = p.locator('#plist-q .prow').first().locator('.pv');
  assert((await kw.inputValue()) === '珍珠奶茶', 'Chinese query value decoded');
  assert(/第 2 層/.test(await p.textContent('#plist-q')) && /https:\/\/m\.example\.tw\/cart\?id=7&from=首頁/.test(await p.textContent('#plist-q')), 'double-encoded redirect shows its inner layer');
  await kw.fill('芋圓 鮮奶&加冰'); await p.waitForTimeout(150);
  const u1 = await p.inputValue('#src');
  assert(new URL(u1).searchParams.get('keyword') === '芋圓 鮮奶&加冰' && u1.includes('size=L&page=2'), 'editing a value rebuilds the URL with correct encoding');
  assert((await p.evaluate(() => document.activeElement.classList.contains('pv'))), 'focus stays in the value field while typing');
  await p.click('#plist-q .prow:nth-child(2) [data-act="del"]'); await p.waitForTimeout(150);
  assert(!(await p.inputValue('#src')).includes('size=L'), 'delete removes the parameter');
  await p.click('#toastHost button'); await p.waitForTimeout(150);
  assert((await p.inputValue('#src')) === u1, 'delete can be undone');
  await p.click('#sec-q [data-act="add"]'); await p.keyboard.type('coupon'); await p.keyboard.press('Tab'); await p.keyboard.type('滿百折十'); await p.waitForTimeout(150);
  assert(new URL(await p.inputValue('#src')).searchParams.get('coupon') === '滿百折十', 'new parameter added to the URL');
  // nested: parse the redirect URL, then go back
  const before = await p.inputValue('#src');
  await p.click('#plist-q [data-act="open"]'); await p.waitForTimeout(250);
  assert((await p.inputValue('#src')) === 'https://m.example.tw/cart?id=7&from=首頁' || (await p.inputValue('#src')).startsWith('https%3A') === false && (await p.isVisible('#crumb')), 'nested URL opened with a way back');
  await p.click('#backBtn'); await p.waitForTimeout(200);
  assert((await p.inputValue('#src')) === before && !(await p.isVisible('#crumb')), 'back restores the outer URL');
  // OAuth fragment → JWT → verify
  await p.evaluate(() => window.__jd.loadSample('oauth', false)); await p.waitForTimeout(250);
  await p.click('#plist-f [data-act="open"]'); await p.waitForTimeout(400);
  s = await st(); assert(s.kind === 'jwt' && s.v === 'ok', 'id_token from the URL fragment opens as a verified JWT');
  // copy: tap a claim row, copy payload
  await p.click('.row[data-cl="sub"]'); await p.waitForTimeout(150);
  assert((await p.evaluate(() => navigator.clipboard.readText())) === 'user_8a2f61', 'tapping a claim copies its value');
  await p.click('#sec-pay [data-act="copy-pay"]'); await p.waitForTimeout(150);
  assert(JSON.parse(await p.evaluate(() => navigator.clipboard.readText())).name === '王小明', 'copy payload JSON');
  await p.click('#sec-claims [data-act="copy-report"]'); await p.waitForTimeout(150);
  assert(/到期時間（exp）：\d{4}\/.*台灣時間/.test(await p.evaluate(() => navigator.clipboard.readText())), 'copy summary includes readable times');
  // live countdown
  const near = await p.evaluate(() => { const J = window.__jd.J, now = Math.floor(Date.now() / 1000); return J.b64urlEnc(J.te.encode('{"alg":"HS256"}')) + '.' + J.b64urlEnc(J.te.encode(JSON.stringify({ exp: now + 30 }))) + '.abc'; });
  await p.fill('#src', near); await p.waitForTimeout(100);
  const c1 = await p.textContent('[data-tk="exp"]'); await p.waitForTimeout(2100); const c2 = await p.textContent('[data-tk="exp"]');
  assert(/還有 \d+ 秒過期/.test(c1) && c1 !== c2, `countdown ticks live (${c1} → ${c2})`);
  // clear + undo
  await p.click('#clearBtn'); await p.waitForTimeout(100);
  assert((await p.inputValue('#src')) === '' && await p.isVisible('#sec-guide'), 'clear shows the empty guide');
  await p.click('#toastHost button'); await p.waitForTimeout(100);
  assert((await p.inputValue('#src')) === near, 'clear can be undone');
  // persistence: own token + public key survive reload, the HMAC secret does not (as the page says)
  await p.evaluate(() => window.__jd.loadSample('oidc', false)); await p.waitForTimeout(200);
  const rsTok = await p.inputValue('#src');
  await p.fill('#src', rsTok); await p.waitForTimeout(300);
  await p.reload(); await ready(p); await p.waitForTimeout(300);
  s = await st();
  assert((await p.inputValue('#src')) === rsTok && s.v === 'ok' && !(await p.isVisible('#sampleChip')), 'input and public key survive a reload (still verifies)');
  await p.fill('#src', T); await p.waitForTimeout(200); await p.fill('#secret', 'pocket-apps-範例密鑰-請勿用於正式環境'); await p.waitForTimeout(300);
  await p.reload(); await ready(p); await p.waitForTimeout(200);
  assert((await p.inputValue('#src')) === T && (await p.inputValue('#secret')) === '' && (await st()).v === 'need', 'HMAC secret is not stored (page says so)');
  // rapid real touch taps (8/s, alternating targets) via CDP
  const cdp = await ctx.newCDPSession(p);
  await p.locator('.segc').scrollIntoViewIfNeeded();
  const centers = await p.evaluate(() => ['text', 'b64', 'hex'].map(f => { const r = document.querySelector(`.segc [data-enc="${f}"]`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  let okTaps = 0;
  for (let k = 0; k < 24; k++) {
    const f = k % 3, [x, y] = centers[f];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(125);
    if (await p.evaluate(e => document.querySelector('.segc [aria-pressed="true"]').dataset.enc === e, ['text', 'b64', 'hex'][f])) okTaps++;
  }
  assert(okTaps === 24, `24 rapid touch taps at 8/s all registered exactly once (${okTaps}/24)`);
  await p.click('.segc [data-enc="text"]');
  // big input stays responsive
  const big = b64u({ alg: 'HS256' }) + '.' + b64u({ data: 'x'.repeat(60000), list: Array.from({ length: 2000 }, (_, i) => i) }) + '.abc';
  const tb = Date.now(); await p.evaluate(t => { const ta = document.getElementById('src'); ta.value = t; ta.dispatchEvent(new Event('input')); }, big); await p.waitForFunction(() => window.__jd.an && window.__jd.an.payload && window.__jd.an.payload.obj && window.__jd.an.payload.obj.list); const bt = Date.now() - tb - 160;
  assert(bt < 800 && (await p.evaluate(() => window.__jd.an.payload.obj.list.length)) === 2000, `100 KB token decoded and rendered in ${bt} ms`);
  await p.evaluate(() => window.__jd.loadSample('login', false)); await p.waitForTimeout(200);
  const key1 = await p.evaluate(() => { const ta = document.getElementById('src'); ta.value += ' '; const t = performance.now(); ta.dispatchEvent(new Event('input')); return performance.now() - t; });
  assert(key1 < 50, `typing in a normal token re-renders in ${key1.toFixed(1)} ms`);
  const typ = await p.evaluate(() => { const ta = document.getElementById('src'); ta.value = 'https://a.tw/?' + Array.from({ length: 300 }, (_, i) => 'k' + i + '=%E5%80%BC').join('&'); const t = performance.now(); ta.dispatchEvent(new Event('input')); return performance.now() - t; });
  assert(typ < 30, `keystroke in a 300-parameter URL echoes in ${typ.toFixed(1)} ms (analysis waits for a pause)`);
  await p.waitForFunction(() => window.__jd.url && window.__jd.url.params.length === 300);
  assert((await p.$$('#plist-q .prow')).length === 300, 'all 300 parameters listed after the pause');
  await ctx.close();


  // ---------- review fixes ----------
  {
    const c = await browser.newContext({ ...touch(390, 844), permissions: ['clipboard-read', 'clipboard-write'] }); const q = await c.newPage(); watch(q, 'fixes');
    await q.goto(URL0); await ready(q);
    const st2 = () => q.evaluate(() => ({ kind: window.__jd.det.kind, tiles: [...document.querySelectorAll('#verdict .tile b')].map(b => b.textContent), subs: [...document.querySelectorAll('#verdict .tile > span')].map(b => b.textContent) }));
    // 1. private keys typed into the public-key box are never stored, even unparseable ones
    await q.evaluate(() => window.__jd.loadSample('oidc', false)); await q.waitForTimeout(200);
    await q.fill('#src', await q.inputValue('#src')); await q.waitForTimeout(150); // make it the user's own token
    for (const [name, key] of [['OpenSSH', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQ\n-----END OPENSSH PRIVATE KEY-----'],
      ['encrypted PKCS#8', '-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIFHzBJBgkqhkiG9w0BBQ0wPDAbBgkqhkiG9w0BBQwwDgQI\n-----END ENCRYPTED PRIVATE KEY-----'], ['private JWK', '{"kty":"EC","crv":"P-256","x":"a","y":"b","d":"c"}']]) {
      await q.fill('#pubkey', key); await q.waitForTimeout(300);
      const stored = await q.evaluate(() => localStorage.getItem('jwt-decode:v1:key'));
      await q.reload(); await ready(q); await q.waitForTimeout(200);
      assert(!stored && (await q.inputValue('#pubkey')) === '', `${name} private key is not stored and is gone after reload`);
    }
    await q.fill('#pubkey', JSON.stringify({ kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' })); await q.waitForTimeout(300);
    assert(!!(await q.evaluate(() => localStorage.getItem('jwt-decode:v1:key'))), 'a public JWK is still remembered');
    const c3 = await browser.newContext(touch(390, 844)); const q3 = await c3.newPage(); watch(q3, 'purge');
    await q3.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('jwt-decode:v1:key', JSON.stringify('-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----')); } } catch (e) {} });
    await q3.goto(URL0); await q3.waitForFunction(() => window.__jdReady);
    assert((await q3.evaluate(() => localStorage.getItem('jwt-decode:v1:key'))) === null, 'a private key stored by an older version is purged on load');
    await c3.close();
    // 2. millisecond timestamps: tile and rows agree
    const msTok = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ iat: 1700000000000, exp: 1700003600000 }) + '.abc';
    await q.fill('#src', msTok); await q.waitForTimeout(250);
    let v = await st2(); const pill = await q.textContent('[data-tk="exp"]');
    assert(v.tiles[1] === '已過期' && /約 2\.9 年/.test(v.subs[1]) && /已過期 約 2\.9 年/.test(pill) && !/未來/.test(await q.textContent('#verdict')), `ms timestamps read one way: tile「${v.subs[1]}」row「${pill}」`);
    await q.fill('#src', b64u({ alg: 'HS256' }) + '.' + Buffer.from('{"exp":1e400}').toString('base64url') + '.abc'); await q.waitForTimeout(250);
    assert(!/Infinity|null|NaN/.test(await q.evaluate(() => document.body.innerText.replace(/"exp": 1e400/, ''))), 'exp 1e400: no Infinity / null text anywhere');
    // 3. a blank added row never reaches the URL
    await q.fill('#src', 'https://e.com/?a=1&b=2'); await q.waitForTimeout(200);
    await q.click('#sec-q [data-act="add"]'); await q.locator('#plist-q .pv').first().fill('9'); await q.waitForTimeout(150);
    assert((await q.inputValue('#src')) === 'https://e.com/?a=9&b=2', 'blank new row does not add "&=": ' + await q.inputValue('#src'));
    // 4. rapid taps on 新增 (8/s, real touch) never scroll onto a delete button
    await q.fill('#src', 'https://e.com/?a=1'); await q.waitForTimeout(200);
    await q.evaluate(() => document.getElementById('sec-q').scrollIntoView({ block: 'start' })); await q.waitForTimeout(100);
    const cdp = await c.newCDPSession(q);
    const y0 = await q.evaluate(() => scrollY);
    const ab = await q.evaluate(() => { const r = document.querySelector('#sec-q [data-act="add"]').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    for (let k = 0; k < 20; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ab[0], y: ab[1] }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await q.waitForTimeout(125); }
    const after = await q.evaluate(() => ({ y: scrollY, rows: document.querySelectorAll('#plist-q .prow').length }));
    assert((await q.inputValue('#src')) === 'https://e.com/?a=1' && after.rows === 2 && Math.abs(after.y - y0) < 2, `20 rapid taps on 新增: URL intact, one blank row, page did not scroll (rows ${after.rows}, Δy ${after.y - y0})`);
    // multi-step undo
    await q.fill('#src', 'https://e.com/?a=1&b=2&c=3'); await q.waitForTimeout(200);
    await q.click('#plist-q .prow:nth-child(1) [data-act="del"]'); await q.waitForTimeout(120);
    await q.click('#plist-q .prow:nth-child(1) [data-act="del"]'); await q.waitForTimeout(120);
    assert((await q.inputValue('#src')) === 'https://e.com/?c=3', 'two deletes');
    await q.click('#toastHost button'); await q.waitForTimeout(120); await q.click('#toastHost button'); await q.waitForTimeout(120);
    assert((await q.inputValue('#src')) === 'https://e.com/?a=1&b=2&c=3', 'undo is multi-step: both deleted params come back');
    // 5. URL inside a sentence
    await q.fill('#src', '請看 https://e.com/?a=1 謝謝'); await q.waitForTimeout(200);
    v = await st2();
    assert(v.kind === 'url' && /找到網址/.test(await q.textContent('#legend')), 'URL in a sentence is extracted and the page says so');
    await q.locator('#plist-q .pv').first().fill('二'); await q.waitForTimeout(150);
    assert((await q.inputValue('#src')) === '請看 https://e.com/?a=%E4%BA%8C 謝謝', 'editing keeps the surrounding text');
    // 7. OAuth tile wording, theme cycle back to system
    await q.evaluate(() => window.__jd.loadSample('oauth', false)); await q.waitForTimeout(200);
    v = await st2(); assert(v.tiles[1] === '5 個片段參數' && !/另有/.test(v.subs[1]), `fragment-only tile: ${v.tiles[1]} / ${v.subs[1]}`);
    await q.fill('#src', 'https://e.com/?a=100%&b=%'); await q.waitForTimeout(150);
    v = await st2(); assert(/有編碼錯誤/.test(v.subs[1]) && !/都已解碼/.test(v.subs[1]), 'bad %XX: tile says 有編碼錯誤');
    const th = [];
    for (let k = 0; k < 3; k++) { await q.click('#themeBtn'); th.push(await q.evaluate(() => document.documentElement.dataset.theme || 'auto')); }
    assert(th.join() === 'dark,light,auto' && (await q.evaluate(() => localStorage.getItem('jwt-decode:v1:theme'))) === null, 'theme cycles dark → light → follow system: ' + th.join());
    // exp row copies the Taiwan time it shows
    await q.evaluate(() => window.__jd.loadSample('login', false)); await q.waitForTimeout(200);
    await q.click('.row[data-cl="exp"]'); await q.waitForTimeout(120);
    const clip = await q.evaluate(() => navigator.clipboard.readText());
    assert(/^\d{4}\/\d\d\/\d\d（.）\d\d:\d\d:\d\d 台灣時間（\d{10}）$/.test(clip), 'exp row copies shown Taiwan time plus raw: ' + clip);
    // 6. huge inputs never block the page for long
    // the text is built and put on a DataTransfer first; only the tasks after the paste (the app's own work) are measured
    const longest = async text => q.evaluate(async t => {
      const ta = document.getElementById('src'); ta.focus();
      const dt = new DataTransfer(); dt.setData('text/plain', t);
      await new Promise(r => setTimeout(r, 50));
      let max = 0; const po = new PerformanceObserver(l => l.getEntries().forEach(e => { max = Math.max(max, e.duration); })); po.observe({ entryTypes: ['longtask'] });
      await new Promise(r => setTimeout(r, 0));
      const t0 = performance.now();
      const pe = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      if (ta.dispatchEvent(pe)) { ta.value = t; ta.dispatchEvent(new Event('input')); }
      max = Math.max(max, performance.now() - t0);
      await new Promise(r => setTimeout(r, 600)); await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
      po.disconnect(); return { max, kind: window.__jd.det.kind };
    }, text);
    const bigJwt = b64u({ alg: 'HS256' }) + '.' + b64u({ blob: 'x'.repeat(950000) }) + '.abc';
    let L = await longest(bigJwt);
    assert(L.kind === 'jwt' && L.max < 1500, `1.3 MB JWT: longest main-thread block ${Math.round(L.max)} ms`);
    assert(await q.evaluate(() => { const ta = document.getElementById('src'); return ta.readOnly && ta.value.length < 3000 && /MB，太長不在框內顯示/.test(ta.value) && window.__jd.an.payload.obj.blob.length === 950000; }), 'huge JWT: decoded in full, the box shows a short read-only preview');
    await q.click('#clearBtn'); await q.waitForTimeout(100);
    assert(await q.evaluate(() => !document.getElementById('src').readOnly && document.getElementById('src').value === ''), 'clear leaves huge mode');
    await q.click('#toastHost button'); await q.waitForTimeout(200);
    assert(await q.evaluate(() => window.__jd.an && window.__jd.an.payload.obj.blob.length === 950000), 'undo brings the huge JWT back');
    const ten = 'log line '.repeat(1100000) + ' Bearer ' + b64u({ alg: 'HS256' }) + '.' + b64u({ sub: 'x' }) + '.abc';
    L = await longest(ten);
    assert(L.kind === 'jwt' && L.max < 1500 && (await q.inputValue('#src')).length < 200, `10 MB paste: longest main-thread block ${Math.round(L.max)} ms, only the JWT found inside is kept`);
    assert(/MB，只保留裡面找到的 JWT/.test(await q.textContent('#toastHost')), 'huge paste explained');
    L = await longest('無關文字 '.repeat(260000)); assert(L.kind === 'empty' && L.max < 1500 && /找不到 JWT 或網址/.test(await q.textContent('#toastHost')), `huge paste with nothing inside: explained, ${Math.round(L.max)} ms`);
    // round 3: long unbroken runs used to make the in-text URL search quadratic (and the saved text froze every reload)
    const tok3 = b64u({ alg: 'HS256' }) + '.' + b64u({ sub: 'r3' }) + '.abc';
    const reloadMs = async () => { const t = Date.now(); await q.reload(); await q.waitForFunction(() => window.__jdReady, null, { polling: 20 }); return Date.now() - t; };
    const hex9 = require('crypto').randomBytes(460000).toString('hex');
    L = await longest(hex9 + '\n' + tok3);
    assert(L.kind === 'jwt' && L.max < 1500 && await q.evaluate(t => window.__jd.det.token === t, tok3), `900 KB hex dump + JWT (kept whole): ${Math.round(L.max)} ms`);
    let R = await reloadMs(); assert(R < 1000 && await q.evaluate(t => window.__jd.det.token === t, tok3), `…reopens in ${R} ms`);
    const tok30 = b64u({ alg: 'RS256' }) + '.' + b64u({ groups: Array.from({ length: 2000 }, (_, i) => 'group-' + i) }) + '.' + 'B'.repeat(342);
    L = await longest('2026-10-24T10:00:00Z INFO auth ok token=' + tok30);
    assert(L.kind === 'jwt' && L.max < 1000, `log line + 30 KB JWT: ${Math.round(L.max)} ms`);
    R = await reloadMs(); assert(R < 1000 && await q.evaluate(t => window.__jd.det.token === t, tok30), `…reopens in ${R} ms`);
    L = await longest('x'.repeat(10 * 1048576) + '\n' + tok3);
    assert(L.kind === 'jwt' && L.max < 1500 && await q.evaluate(t => window.__jd.det.token === t, tok3), `10 MB of x + JWT: found past the first million characters, ${Math.round(L.max)} ms`);
    R = await reloadMs(); assert(R < 1000, `…reopens in ${R} ms`);
    L = await longest('https://e.com/?' + 'a=b&'.repeat(2600000));
    assert(L.kind === 'url' && L.max < 1500 && /網址太長/.test(await q.textContent('#toastHost')), `10 MB one-line URL: first 200,000 characters kept and parsed, ${Math.round(L.max)} ms`);
    assert(await q.evaluate(() => document.querySelectorAll('.prow').length <= 300 && /只列出前 300 個/.test(document.getElementById('plist-q').textContent)), '…only the first 300 parameter rows are listed, with a note');
    R = await reloadMs(); assert(R < 1000 && await q.evaluate(() => window.__jd.det.kind === 'url'), `…reopens in ${R} ms`);
    await q.click('#clearBtn');
    await c.close();
    // storage blocked → correct message
    const c4 = await browser.newContext(touch(390, 844)); const q4 = await c4.newPage(); watch(q4, 'blocked');
    await q4.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'SecurityError'); }; });
    await q4.goto(URL0); await ready(q4);
    await q4.fill('#src', 'https://e.com/?a=1'); await q4.waitForTimeout(150);
    assert(/不允許網頁儲存/.test(await q4.textContent('#toastHost')), 'storage blocked: says it is blocked, not full');
    await c4.close();
  }

  // ---------- cover ----------
  for (const scheme of ['light', 'dark']) {
    const c2 = await browser.newContext({ ...touch(390, 520), colorScheme: scheme }); const p2 = await c2.newPage(); watch(p2, 'cover');
    await p2.goto(URL0); await ready(p2); await p2.waitForTimeout(400);
    await p2.screenshot({ path: `${OUT}/cover-390x520${scheme === 'dark' ? '-dark' : ''}.png` }); await c2.close();
  }
  await browser.close();
  console.log(errors.length ? `\n${errors.length} problem(s):\n` + errors.join('\n') : '');
  console.log(`${passN} passed, ${errors.length} failed`);
  process.exit(errors.length ? 1 : 0);
})();
