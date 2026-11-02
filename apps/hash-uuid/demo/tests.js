// 雜湊與 UUID：上架評分 toFix 的回歸測試（node tests.js，約 15 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hash-uuid-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const H = (alg, data) => crypto.createHash(alg).update(data).digest('hex');
const SHA_ABC = H('sha256', 'abc');

(async () => {
  const browser = await chromium.launch();
  // every scenario gets its own context (own localStorage); seed is written once, before the page's first load
  async function open(w = 390, h = 844, seed = null) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (seed) await ctx.addInitScript(seed => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in seed) localStorage.setItem('hash-uuid:v1:' + k, seed[k]); } }, seed);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__huReady);
    const cdp = await ctx.newCDPSession(p);
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tap = async sel => {
      await p.$eval(sel, e => e.scrollIntoView({ block: 'center' })); await frames();
      const [x, y] = await p.$eval(sel, e => { const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await frames();
    };
    const digest = a => p.evaluate(a => { for (const c of document.querySelectorAll('.card')) if (c.querySelector('h3').textContent.endsWith(a)) return c.querySelector('.digest').textContent; return null; }, a);
    const reload = async () => { await p.reload(); await p.waitForFunction(() => window.__huReady); };
    return { ctx, p, tap, frames, digest, reload };
  }
  const waitDigest = (t, a, v) => t.p.waitForFunction(([a, v]) => [...document.querySelectorAll('.card')].some(c => c.querySelector('h3').textContent.endsWith(a) && c.querySelector('.digest').textContent === v), [a, v], { timeout: 20000 }).then(() => true, () => false);

  // 1. 一票否決：重新整理後輸入、預期值、CRLF、HMAC、格式、分頁、來源都還在；金鑰標示不保存
  {
    const t = await open();
    await t.p.fill('#text', 'my important text 123\nline2');
    await t.p.fill('#expect', 'deadbeef');
    await t.tap('#crlf'); await t.tap('#hmac');
    await t.p.fill('#hmacKey', 'secret');
    assert(await waitDigest(t, 'SHA-256', crypto.createHmac('sha256', 'secret').update('my important text 123\r\nline2').digest('hex')), 'HMAC＋CRLF 結果正確');
    await t.tap('.card button[data-f="HEX"]');
    await t.p.waitForFunction(() => !window.__hu.S.busy);
    await t.reload();
    const st = await t.p.evaluate(() => ({ text: text.value, expect: expect.value, crlf: crlf.checked, hmac: hmac.checked, box: !hmacBox.hidden, key: hmacKey.value, fmt: window.__hu.S.fmt['SHA-256'] }));
    eq(st, { text: 'my important text 123\nline2', expect: 'deadbeef', crlf: true, hmac: true, box: true, key: '', fmt: 'HEX' }, '重新整理後文字、預期值、CRLF、HMAC 勾選、輸出格式都還在（金鑰刻意不存）');
    assert(/金鑰不保存/.test(await t.p.textContent('#hmacBox')), 'HMAC 金鑰欄旁寫明「金鑰不保存」');
    // 金鑰不保存：重新整理後卡片請使用者輸入金鑰，不顯示空金鑰的結果
    eq(await t.p.evaluate(() => [...document.querySelectorAll('.card')].map(c => [c.dataset.alg, /請輸入 HMAC 金鑰/.test(c.querySelector('.digest').textContent)])), [['SHA-256', true], ['MD5', true]], 'HMAC 開著但金鑰空白（重新整理後）：卡片顯示「請輸入 HMAC 金鑰」');
    eq(await t.p.evaluate(() => document.querySelectorAll('.seal').length), 0, '等金鑰時不標相符／不符');
    await t.p.fill('#hmacKey', 'secret');
    const want = crypto.createHmac('sha256', 'secret').update('my important text 123\r\nline2').digest('hex').toUpperCase();
    assert(await waitDigest(t, 'SHA-256', want), '輸入金鑰後用 CRLF＋HMAC 算出，格式 HEX');
    // 打字後立刻重新整理（還在防抖期間）：pagehide 立即寫入
    await t.p.fill('#text', 'typed then reload'); await t.reload();
    eq(await t.p.inputValue('#text'), 'typed then reload', '防抖期間重新整理，pagehide 立即寫入');
    // 分頁與來源
    await t.tap('#tab-uuid'); await t.reload();
    eq(await t.p.evaluate(() => [document.querySelector('#tab-uuid').getAttribute('aria-selected'), document.querySelector('#pane-uuid').hidden]), ['true', false], '重新整理後停在 UUID 分頁');
    await t.tap('#tab-hash'); await t.tap('#src-file'); await t.reload();
    eq(await t.p.evaluate(() => [window.__hu.S.src, document.querySelector('#fileBox').hidden]), ['file', false], '重新整理後停在檔案來源');
    await t.ctx.close();
  }
  {
    // 舊的 localStorage 鍵照樣讀得到
    const t = await open(390, 844, { algs: JSON.stringify(['SHA-1']), uuidOpts: JSON.stringify({ ver: 'v7', count: 3, upper: true }) });
    eq(await t.p.evaluate(() => [[...document.querySelectorAll('.algs input:checked')].map(i => i.value), window.__hu.U.ver, window.__hu.getUuids().length, /^[0-9A-F-]+$/.test(window.__hu.getUuids()[0]), text.value]), [['SHA-1'], 'v7', 3, true, 'abc'], '舊鍵（algs、uuidOpts）照常載入，沒有新鍵時回到 abc 範例');
    // 超過 100 萬字的文字不保存並說明
    await t.p.evaluate(() => { text.value = 'x'.repeat(1100000); text.dispatchEvent(new Event('input')); });
    await t.p.waitForFunction(() => /不保存/.test(textMeta.textContent), null, { timeout: 20000 }).then(() => assert(true, '超過 100 萬字時標示「文字太大不保存，請改用檔案」'), () => assert(false, '超過 100 萬字時標示不保存'));
    // 7. 大量文字改在 Worker 算，有進度列，結果正確
    assert(await waitDigest(t, 'SHA-1', H('sha1', 'x'.repeat(1100000))), '1.1MB 文字的 SHA-1 正確（Worker 計算）');
    const usedWorker = await t.p.evaluate(() => document.querySelector('#progRow').parentElement.id === 'pSrc');
    assert(usedWorker, '進度列在來源面板內，文字與檔案共用');
    // 2（R2）. 超過 2MB 的貼上：不放進輸入框，以 Blob 計算並顯示摘要
    const big = 'ab\n'.repeat(800000);
    await t.p.evaluate(big => { const dt = new DataTransfer(); dt.setData('text/plain', big); text.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, big);
    eq(await t.p.evaluate(() => [text.hidden, bigBox.hidden, text.value.length, /2,400,000 個字元/.test(bigInfo.textContent)]), [true, false, 0, true], '2.4M 字元的貼上不填進輸入框，改顯示摘要');
    assert(await waitDigest(t, 'SHA-1', H('sha1', big)), '大量貼上的 SHA-1 正確');
    await t.tap('#crlf');
    assert(await waitDigest(t, 'SHA-1', H('sha1', big.replace(/\n/g, '\r\n'))), '大量貼上也套用 CRLF');
    await t.tap('#crlf');
    await t.tap('#bigClear');
    eq(await t.p.evaluate(() => [text.hidden, bigBox.hidden, text.value]), [false, true, ''], '「清除」回到一般輸入框');
    assert(await waitDigest(t, 'SHA-1', H('sha1', '')), '清除後是空字串的雜湊');
    // 3（R2）. 小文字立即保存；大文字等空閒時才保存，pagehide 一定寫入
    await t.p.fill('#text', 'small one');
    await t.p.waitForFunction(() => localStorage.getItem('hash-uuid:v1:hashText') === '"small one"', null, { timeout: 5000 }).then(() => assert(true, '小文字在計算時就保存'), () => assert(false, '小文字在計算時就保存'));
    await t.p.evaluate(() => { window.__writes = 0; const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.endsWith('hashText')) window.__writes++; return o.call(this, k, v); }; });
    const mid = 'y'.repeat(300000);
    for (let i = 0; i < 5; i++) await t.p.evaluate(v => { text.value = v; text.dispatchEvent(new Event('input')); }, mid + i);
    eq(await t.p.evaluate(() => window.__writes), 0, '30 萬字的文字連續打字時不每次寫入');
    await t.p.waitForFunction(() => window.__writes >= 1, null, { timeout: 15000 }).then(() => assert(true, '停下來後在空閒時寫入'), () => assert(false, '停下來後在空閒時寫入'));
    await t.p.evaluate(v => { text.value = v; text.dispatchEvent(new Event('input')); }, mid + 'Z');
    await t.reload();
    eq(await t.p.evaluate(() => text.value.slice(-2)), 'yZ', '大文字打完立刻重新整理，pagehide 寫入最新內容');
    await t.ctx.close();
  }
  {
    // 第一輪修正時文字存在 hashState.text，仍要讀得到
    const t = await open(390, 844, { hashState: JSON.stringify({ text: 'old format', expect: '', crlf: false, hmac: false, fmt: {}, src: 'text' }) });
    eq(await t.p.inputValue('#text'), 'old format', 'hashState.text（舊格式）照常載入');
    await t.ctx.close();
  }

  // 2. 比對預期值先取出雜湊
  {
    const t = await open();
    assert(await waitDigest(t, 'SHA-256', SHA_ABC), '預設 abc 範例算出 SHA-256');
    const md5 = H('md5', 'abc'), b64 = Buffer.from(SHA_ABC, 'hex').toString('base64');
    const cases = [
      [SHA_ABC + '  abc.txt', true], [SHA_ABC + ' *abc.txt', true], ['sha256:' + SHA_ABC, true], ['SHA256: ' + SHA_ABC, true],
      ['SHA256 (abc.txt) = ' + SHA_ABC, true], ['MD5 (abc.txt) = ' + md5, true], ['0x' + SHA_ABC.toUpperCase(), true],
      [SHA_ABC.toUpperCase().match(/.{8}/g).join(' '), true], [b64, true], ['sha256-' + b64, true], [b64.replace(/=+$/, ''), true],
      [SHA_ABC.slice(0, 20), false], ['f'.repeat(64) + '  abc.txt', false],
      [SHA_ABC + '  cafe', true], [SHA_ABC + '  deadbeef', true], [md5 + ' *0123abcd', true], [SHA_ABC + '  ' + 'a'.repeat(64), true],
    ];
    for (const [v, ok] of cases) {
      await t.p.fill('#expect', v);
      await t.p.waitForFunction(() => !window.__hu.S.busy && resMeta.textContent !== '計算中');
      const r = await t.p.evaluate(() => [document.querySelector('#resMeta').textContent, document.querySelectorAll('.card.match').length]);
      eq(r, ok ? ['有相符項目', 1] : ['皆不符', 0], `預期值「${v.length > 40 ? v.slice(0, 40) + '…' : v}」→ ${ok ? '相符' : '皆不符'}`);
    }
    await t.p.fill('#expect', 'my important text!');
    eq(await t.p.evaluate(() => [/看起來不是雜湊值/.test(expectHint.textContent), document.querySelectorAll('.seal.no').length, resMeta.textContent]), [true, 0, '預期值格式不明'], '不是雜湊值時說明「看起來不是雜湊值」，不標紅「不符」');
    await t.p.fill('#expect', SHA_ABC.slice(0, 20));
    assert(/常見長度/.test(await t.p.textContent('#expectHint')), '長度不對的 hex 會說明常見長度');
    // 4. 有相符時其他卡片不標紅
    await t.p.fill('#expect', SHA_ABC);
    eq(await t.p.evaluate(() => [document.querySelectorAll('.card.miss').length, document.querySelectorAll('.seal.no').length, document.querySelectorAll('.seal.dim').length, document.querySelectorAll('.seal.ok').length]), [0, 0, 1, 1], '有相符時其他卡片是灰色「非此演算法」，沒有紅邊紅章');
    await t.p.fill('#expect', 'f'.repeat(64));
    eq(await t.p.evaluate(() => [document.querySelectorAll('.card.miss').length, document.querySelectorAll('.seal.no').length]), [2, 2], '全部不符時才標紅');
    await t.p.fill('#expect', '');

    // 5. 自動大寫／自動校正關閉
    eq(await t.p.evaluate(() => ['text', 'hmacKey', 'expect', 'parse'].map(id => document.getElementById(id).getAttribute('autocapitalize') + '/' + document.getElementById(id).getAttribute('autocorrect'))), Array(4).fill('off/off'), 'text、hmacKey、expect、parse 都關掉自動大寫與自動校正');

    // 點演算法（手機上在結果下面）：多一張或少一張卡，演算法格仍在手指下（畫面位置不變）
    for (const [label, n] of [['勾選', 3], ['取消勾選', 2]]) {
      await t.p.$eval('#alg-sha1', e => e.scrollIntoView({ block: 'center' })); await t.frames();
      const y0 = await t.p.$eval('#alg-sha1', e => Math.round(e.getBoundingClientRect().top));
      await t.tap('#alg-sha1'); await t.p.waitForFunction(() => !window.__hu.S.busy); await t.frames();
      const y1 = await t.p.$eval('#alg-sha1', e => Math.round(e.getBoundingClientRect().top));
      assert(Math.abs(y1 - y0) <= 1, `${label} SHA-1 後演算法格在畫面上的位置不變（${y0} → ${y1}）`);
      eq(await t.p.evaluate(() => document.querySelectorAll('.card').length), n, `CDP 觸控${label}一次，卡片 ${n} 張（不重複觸發）`);
    }

    // 細節：8 碼一段不被換行切開
    await t.tap('#alg-sha512'); await t.p.waitForFunction(() => !window.__hu.S.busy);
    const split = await t.p.evaluate(() => [...document.querySelectorAll('.digest .g')].filter(g => g.getClientRects().length !== 1).length);
    eq(split, 0, '每段 8 碼都在同一行（換行不切開一段）');
    // 細節：來源與輸出格式的選取樣式一致；頁面分頁是另一個層級（大字＋底線，不是填滿的切換鈕）
    const sty = await t.p.evaluate(() => ['#src-text', '.card .fmt button[aria-pressed="true"]'].map(s => { const c = getComputedStyle(document.querySelector(s)); return c.backgroundColor + '|' + c.color; }));
    eq(new Set(sty).size, 1, '來源、輸出格式的選取樣式一致');
    const tab = await t.p.evaluate(() => { const a = getComputedStyle(document.querySelector('#tab-hash')), b = getComputedStyle(document.querySelector('#src-text')); return [a.backgroundColor !== b.backgroundColor, parseFloat(a.fontSize) > parseFloat(b.fontSize), parseFloat(a.borderBottomWidth) >= 3]; });
    eq(tab, [true, true, true], '頁面分頁與文字／檔案切換的外觀層級不同');

    // 細節：取消後有「重新計算」
    const f = path.join(DIR, 'f.bin'); fs.writeFileSync(f, Buffer.alloc(3 * 1024 * 1024, 7));
    await t.tap('#src-file'); await t.p.setInputFiles('#file', f);
    await t.p.evaluate(() => { window.__hu.compute(); document.getElementById('cancel').click(); });
    assert(await t.p.$('#redo') !== null, '取消後出現「重新計算」鈕');
    await t.tap('#redo');
    assert(await waitDigest(t, 'SHA-256', H('sha256', fs.readFileSync(f))), '按「重新計算」後算出正確結果');
    await t.tap('#src-text');
    await t.ctx.close();
  }

  // UUID
  {
    const t = await open();
    await t.tap('#tab-uuid');
    await t.p.fill('#count', '3'); await t.p.locator('#count').blur();
    const before = await t.p.evaluate(() => window.__hu.getUuids().slice());
    eq(before.length, 3, '產生 3 個');
    // 2. 格式選項只重新格式化
    await t.tap('#upper');
    eq(await t.p.evaluate(() => window.__hu.getUuids()), before.map(u => u.toUpperCase()), '勾「大寫」只把同一批改成大寫，不重產');
    await t.tap('#nohyphen'); await t.tap('#braces');
    eq(await t.p.evaluate(() => window.__hu.getUuids()), before.map(u => '{' + u.toUpperCase().replace(/-/g, '') + '}'), '移除連字號、加大括號也是同一批');
    await t.tap('#upper'); await t.tap('#nohyphen'); await t.tap('#braces');
    eq(await t.p.evaluate(() => window.__hu.getUuids()), before, 'CDP 觸控各點兩下回到原樣（每下只切一次）');
    // 3. 重新整理後清單不變
    await t.reload();
    eq(await t.p.evaluate(() => window.__hu.getUuids()), before, '重新整理後 UUID 清單不變');
    // 解析框：使用者輸入的內容不會被產生蓋掉
    const mine = '{01234567-89ab-7def-8123-456789abcdef}';
    await t.p.fill('#parse', mine);
    await t.tap('#gen');
    eq(await t.p.inputValue('#parse'), mine, '按「產生」不覆蓋使用者貼的 UUID');
    await t.p.fill('#count', '4'); await t.p.locator('#count').blur(); await t.p.focus('#parse');
    eq(await t.p.inputValue('#parse'), mine, '改數量後點解析框也不覆蓋');
    await t.reload();
    eq(await t.p.inputValue('#parse'), mine, '解析框內容重新整理後還在');
    await t.tap('#parseClear');
    eq(await t.p.inputValue('#parse'), '', '「清除」清空解析框');
    // 自動填入的範例聚焦時全選，貼上直接取代
    await t.p.evaluate(() => { parse.value = ''; parse.dispatchEvent(new Event('input')); parse.blur(); });
    await t.tap('#gen');
    const first = await t.p.evaluate(() => window.__hu.getUuids()[0]);
    eq(await t.p.inputValue('#parse'), first, '解析框空白時，產生會填入第一個 UUID');
    await t.p.focus('#parse');
    eq(await t.p.evaluate(() => [parse.selectionStart, parse.selectionEnd]), [0, first.length], '聚焦自動填入的範例時全選');
    // 細節：數量 1e3、2.5
    for (const [v, n] of [['1e3', 1000], ['2.5', 3], ['0', 1], ['5000', 1000]]) {
      await t.p.fill('#count', v); await t.p.locator('#count').blur();
      eq(await t.p.evaluate(() => window.__hu.getUuids().length), n, `數量 ${v} → ${n} 個`);
    }
    // 細節：NCS / Microsoft 變體不顯示版本名
    for (const u of ['01234567-89ab-4def-0123-456789abcdef', '01234567-89ab-4def-c123-456789abcdef']) {
      await t.p.fill('#parse', u);
      assert(await t.p.evaluate(() => /沒有版本欄位/.test(parseOut.textContent) && !/v4 隨機/.test(parseOut.textContent)), `${u.slice(19, 23)} 變體不顯示「v4 隨機」`);
    }
    await t.p.fill('#parse', '01234567-89ab-4def-8123-456789abcdef');
    assert(/v4 隨機/.test(await t.p.textContent('#parseOut')), 'RFC 變體仍顯示版本名');
    await t.ctx.close();
  }
  {
    // 細節：未知 ver 回到 v4
    let t = await open(390, 844, { uuidOpts: JSON.stringify({ ver: 'zzz', count: 1 }) });
    eq(await t.p.evaluate(() => [window.__hu.U.ver, document.querySelector('#ver-v4').getAttribute('aria-pressed'), /-4/.test(window.__hu.getUuids()[0]), uuidMeta.textContent]), ['v4', 'true', true, '1 個 · v4'], '未知版本回到 v4，不產生全 0');
    await t.ctx.close();
    t = await open(390, 844, { uuidList: '{bad', hashState: '[1,2', parse: 'null', tab: '"zz"' });
    eq(await t.p.evaluate(() => [window.__hu.getUuids().length, text.value]), [5, 'abc'], '壞掉的存檔不會當掉，回到預設');
    await t.ctx.close();
  }

  // 1（R2）. 手機與大廳尺寸：第一張結果卡完整在第一屏
  for (const [w, h] of [[360, 640], [375, 500], [390, 610], [430, 740], [390, 844]]) {
    const t = await open(w, h);
    await t.p.waitForFunction(() => !window.__hu.S.busy);
    const bot = await t.p.$eval('.card', e => Math.round(e.getBoundingClientRect().bottom));
    assert(bot <= h, `${w}×${h} 第一張結果卡底部 ${bot} ≤ ${h}`);
    await t.ctx.close();
  }

  // 360 寬沒有橫向捲動
  for (const [w, h] of [[360, 640], [844, 390]]) {
    const t = await open(w, h);
    for (const tab of ['#tab-hash', '#tab-uuid']) { await t.tap(tab); eq(await t.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${w}×${h} ${tab.slice(5)} 沒有橫向捲動`); }
    await t.ctx.close();
  }

  eq(errors, [], '沒有 page／console error');
  await browser.close();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `FAIL ${fails} 項失敗` : 'ok 全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + e.message); process.exit(1); });
