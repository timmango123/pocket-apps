// Regression tests for json-viewer (release review 2026-11-07 findings). Run: node tests.js
// Real CDP touch events for the touch checks; every wait is on a condition, not on a fixed sleep.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' +
  fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)}${JSON.stringify(a) === JSON.stringify(b) ? '' : ' != ' + JSON.stringify(b)}`);
const W = { timeout: 30000 };

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.once('listening', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const mobile = async (w = 390, h = 844, extra = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...extra });
    const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console: ${m.text()}`); });
    return { ctx, page, cdp };
  };
  const ready = p => p.waitForFunction(() => window.__jvReady, null, W);
  const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4 })) });
  const tapAt = async (cdp, x, y) => { await T(cdp, 'touchStart', [[x, y, 1]]); await T(cdp, 'touchEnd', []); };
  const center = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const rowAt = (p, text, dx = 0) => p.evaluate(([t, dx]) => { const r = [...document.querySelectorAll('.r')].find(r => r.style.display !== 'none' && r.textContent.includes(t)); r.scrollIntoView({ block: 'nearest' }); const b = r.getBoundingClientRect(); return [b.left + 140 + dx, b.top + b.height / 2]; }, [text, dx]);
  const rowText = (p, text) => p.evaluate(t => ([...document.querySelectorAll('.r')].find(r => r.style.display !== 'none' && r.textContent.includes(t)) || {}).textContent || '', text);
  const sheetOpen = p => p.evaluate(() => !document.getElementById('sheetBg').hidden);
  const toastText = p => p.evaluate(() => document.getElementById('toastHost').textContent);
  const fresh = async p => { await p.goto(URL); await ready(p); await p.evaluate(() => { localStorage.clear(); }); await p.goto(URL); await ready(p); };

  /* ---------- correctness details ---------- */
  {
    const { ctx, page: p } = await mobile(); await fresh(p);
    const status = async t => { await p.evaluate(t => window.__jv.load(t), t); return p.textContent('#status'); };
    let s = await status('{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n{"a":5,}\n{"a":6}');
    ok(s.startsWith('第 5 行第 7 欄') && s.includes('JSON Lines 第 5 筆') && s.includes('尾逗號'), 'JSONL with one bad line points at that line: ' + s.split('\n')[0]);
    s = await status('{"a":1}\r\n{"b":2}\r\n\r\n[3]'); ok(s.includes('JSONL，共 3 筆'), 'valid CRLF JSONL still detected');
    s = await status('{\n  "a": 1\n  "b": 2\n}'); ok(s.startsWith('第 3 行第 3 欄') && s.includes('缺少逗號'), 'ordinary multi-line JSON error unchanged: ' + s.split('\n')[0]);
    // trailing comma: the caret points at the comma itself (round 2)
    s = await status('{"a":1,}'); ok(s.startsWith('第 1 行第 7 欄') && s.includes('尾逗號'), 'object trailing comma at the comma: ' + s.split('\n')[0]);
    s = await status('[1,2,]'); ok(s.startsWith('第 1 行第 5 欄') && s.includes('尾逗號'), 'array trailing comma at the comma: ' + s.split('\n')[0]);
    s = await status('{\n  "a": 1,\n}'); ok(s.startsWith('第 2 行第 9 欄'), 'multi-line trailing comma on the comma line: ' + s.split('\n')[0]);
    eq(await p.evaluate(() => { const t = document.querySelector('.ctx').textContent.split('\n'); return t[1].indexOf('^') === t[0].indexOf(','); }), true, 'caret under the comma');
    s = await status('[1e400, -1e400, 1e-400]'); ok(s.includes('3 個數字超過安全精度'), 'overflow/underflow numbers flagged: ' + s);
    eq(await p.$$eval('.warnb', e => e.filter(x => x.textContent.includes('精度')).length), 3, 'precision badges on overflow numbers');
    s = await status('[0, -0, 0.0, 1.5, 1e5]'); ok(!s.includes('精度'), 'ordinary numbers not flagged');
    s = await status('{"a":1,"b":{"a":3},"a":2}'); ok(s.includes('1 個重複鍵') && s.includes('"a"'), 'duplicate key reported: ' + s);
    ok(await p.$$eval('.warnb', e => e.some(x => x.textContent === '重複鍵')), 'duplicate key badge in tree');
    await p.evaluate(() => window.__jv.load('{"nl\\nk":1,"t\\tq\'":2,"u\\u0001":3}'));
    eq(await p.evaluate(() => [1, 2, 3].map(i => window.__jv.jsonPath(i))), ["$['nl\\nk']", "$['t\\tq\\'']", "$['u\\u0001']"], 'paths escape control characters');
    // repair lists what it changed
    await p.evaluate(() => { const s = document.getElementById('src'); s.value = "{a: NaN, 'b': undefined, c: True, // x\n d: [1,],}"; s.dispatchEvent(new Event('input')); });
    await p.waitForFunction(() => !document.getElementById('fixBtn').hidden, null, W);
    await p.click('#fixBtn');
    const tt = await toastText(p);
    ok(['NaN 改成 null', 'undefined 改成 null', 'True 改成 true', '刪除註解', '刪除尾逗號', '鍵名加上雙引號', '單引號改雙引號'].every(k => tt.includes(k)), 'repair toast lists kinds: ' + tt);
    eq(JSON.parse(await p.inputValue('#src')), { a: null, b: null, c: true, d: [1] }, 'repair result');
    ok(tt.startsWith('已修復') && !tt.includes('仍有錯誤'), 'repair toast describes the repaired (valid) result: ' + tt);
    await p.click('.toast .tact'); await p.waitForFunction(() => document.getElementById('src').value.includes('NaN'), null, W);
    ok(true, 'repair can be undone');
    // reviewer's case: {a: 'x', b: True, // c\n}
    await p.evaluate(() => window.__jv.load("{a: 'x', b: True, // c\n}"));
    await p.click('#fixBtn');
    const t2 = await toastText(p);
    ok(t2.startsWith('已修復') && !t2.includes('仍有錯誤') && (await p.textContent('#status')).includes('合法 JSON'), 'repair toast agrees with the green status: ' + t2);
    await ctx.close();
  }

  /* ---------- touch: overlapping fingers, resting finger, long press ---------- */
  {
    const { ctx, page: p, cdp } = await mobile(); await fresh(p);
    await p.evaluate(() => document.getElementById('colBtn').click());
    await p.waitForFunction(() => [...document.querySelectorAll('.r')].some(r => r.textContent.includes('"data":{…}')), null, W);
    // root is open, children collapsed: the paging row is visible and collapsed
    const [x, y] = await rowAt(p, '"paging"');
    ok((await rowText(p, '"paging"')).includes('{…}'), 'paging starts collapsed');
    // fast-tap checks: on a loaded CI box CDP can take > 500 ms between touchStart and touchEnd, which the app would
    // rightly treat as a long press; widen the threshold for these checks only (the long-press checks below use 500 ms)
    await p.evaluate(() => window.__jv.setLongPress(5000));
    // 15 taps by two alternating fingers, each pressed before the previous one lifts (A down, B down, A up, A down, B up, ...)
    // (CDP touchEnd releases the points it lists)
    const fingers = [[x - 12, y, 1], [x + 12, y, 2]];
    const down = new Map();
    const press = async i => { const f = fingers[i % 2]; down.set(f[2], f); await T(cdp, 'touchStart', [...down.values()]); };
    const lift = async i => { const f = fingers[i % 2]; down.delete(f[2]); await T(cdp, 'touchEnd', [f]); };
    const before = await p.evaluate(() => window.__jv.tapStats.rows);
    await press(0);
    for (let i = 1; i < 15; i++) { await press(i); await lift(i - 1); }
    await lift(14);
    eq(await p.evaluate(() => window.__jv.tapStats.rows) - before, 15, 'overlapping two-finger taps: 15 sent, 15 handled');
    ok((await rowText(p, '"paging"')).includes('▾'), 'overlapping taps toggled the row 15 times (odd => open): ' + await rowText(p, '"paging"'));
    eq(await sheetOpen(p), false, 'overlapping taps open no sheet');
    // single finger, fast: 4 more taps -> still open (even)
    for (let i = 0; i < 4; i++) await tapAt(cdp, x, y);
    eq(await p.evaluate(() => window.__jv.tapStats.rows) - before, 19, 'four quick single taps: none lost or doubled');
    ok((await rowText(p, '"paging"')).includes('▾'), 'row state after 19 taps is open');
    // a finger resting on the page (status box) + tap on 全部摺疊 (resting finger lifts last)
    const [cx, cy] = await center(p, '#colBtn');
    const [sx, sy] = await center(p, '#status');
    await T(cdp, 'touchStart', [[sx, sy, 2]]);
    await T(cdp, 'touchStart', [[sx, sy, 2], [cx, cy, 1]]);
    await T(cdp, 'touchEnd', [[cx, cy, 1]]);
    await T(cdp, 'touchEnd', [[sx, sy, 2]]);
    ok((await rowText(p, '"paging"')).includes('{…}'), 'resting finger + tap 全部摺疊: received');
    eq(await sheetOpen(p), false, 'resting finger opens no sheet');
    // resting finger + tap on a row, the resting finger lifting first
    const [dx, dy] = await rowAt(p, '"data"');
    await T(cdp, 'touchStart', [[sx, sy, 2]]);
    await T(cdp, 'touchStart', [[sx, sy, 2], [dx, dy, 1]]);
    await T(cdp, 'touchEnd', [[sx, sy, 2]]);
    await T(cdp, 'touchEnd', [[dx, dy, 1]]);
    ok((await rowText(p, '"data"')).includes('▾'), 'resting finger + row tap: tapped row toggled');
    eq(await sheetOpen(p), false, 'no sheet from a two-finger row tap');
    await p.evaluate(() => window.__jv.setLongPress(500));
    // long press: sheet opens and stays open after the finger lifts
    await p.evaluate(() => document.getElementById('colBtn').click());
    const [lx, ly] = await rowAt(p, '"data"');
    await T(cdp, 'touchStart', [[lx, ly, 1]]);
    await p.waitForFunction(() => !document.getElementById('sheetBg').hidden, null, W);
    await T(cdp, 'touchEnd', []);
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50))));
    eq(await sheetOpen(p), true, 'long press: sheet stays open after release');
    eq(await p.textContent('#shPath'), '$.data', 'long press sheet path');
    ok((await rowText(p, '"data"')).includes('{…}'), 'long press did not toggle the row: ' + await rowText(p, '"data"'));
    // tap on the backdrop closes it
    await tapAt(cdp, 195, 40);
    eq(await sheetOpen(p), false, 'backdrop tap closes the sheet');
    // the ⋯ button on a container row opens its sheet
    const mo = await p.evaluate(() => { const r = [...document.querySelectorAll('.r')].find(r => r.textContent.includes('"paging"')); const m = r.querySelector('.more').getBoundingClientRect(); return [m.left + m.width / 2, m.top + m.height / 2, m.width, m.height]; });
    ok(mo[2] >= 44 && mo[3] >= 44, `⋯ target is ${mo[2]}x${mo[3]}`);
    await tapAt(cdp, mo[0], mo[1]);
    eq(await p.textContent('#shPath'), '$.paging', '⋯ opens the container sheet');
    ok((await rowText(p, '"paging"')).includes('{…}'), '⋯ does not toggle the row');
    // leaf sheet: no empty grid cell when 展開子項 is hidden
    await tapAt(cdp, ...(await center(p, '#shClose')));
    eq(await sheetOpen(p), false, 'close button');
    await p.evaluate(() => document.getElementById('expBtn').click());
    await tapAt(cdp, ...(await rowAt(p, '"status"')));
    eq(await p.evaluate(() => [document.getElementById('shToggle').hidden, getComputedStyle(document.getElementById('shCopyKey')).gridColumnStart, getComputedStyle(document.getElementById('shCopyKey')).gridColumnEnd]), [true, '1', '-1'], 'leaf sheet: 複製鍵名 spans the row');
    await p.keyboard.press('Escape');
    // single taps on buttons count once each
    await p.fill('#q', 'a'); await p.waitForFunction(() => document.getElementById('cnt').textContent.startsWith('1/'), null, W);
    const [nx, ny] = await center(p, '#nextBtn');
    for (let i = 0; i < 5; i++) await tapAt(cdp, nx, ny);
    ok((await p.textContent('#cnt')).startsWith('6/'), 'five taps on ↓ -> 6/n: ' + await p.textContent('#cnt'));
    // two fingers: one resting on the search field, the other taps ↓ three times
    const [ix, iy] = await center(p, '#q');
    for (let i = 0; i < 3; i++) { await T(cdp, 'touchStart', [[ix, iy, 2]]); await T(cdp, 'touchStart', [[ix, iy, 2], [nx, ny, 1]]); await T(cdp, i % 2 ? 'touchEnd' : 'touchEnd', i % 2 ? [[ix, iy, 2]] : [[nx, ny, 1]]); await T(cdp, 'touchEnd', []); }
    ok((await p.textContent('#cnt')).startsWith('9/'), 'button taps with another finger down count once each: ' + await p.textContent('#cnt'));
    // slow taps: a button held 0.6 s or 1 s and released still acts, exactly once (round 2 veto)
    const hold = async (sel, ms) => { const [hx, hy] = await center(p, sel); await T(cdp, 'touchStart', [[hx, hy, 1]]); await new Promise(r => setTimeout(r, ms)); await T(cdp, 'touchEnd', []); };
    for (const ms of [600, 1000]) {
      const c0 = +(await p.textContent('#cnt')).split('/')[0];
      await hold('#nextBtn', ms);
      eq(+(await p.textContent('#cnt')).split('/')[0], c0 + 1, `↓ held ${ms} ms: one step`);
      await hold('#tabText', ms);
      eq(await p.getAttribute('#tabText', 'aria-selected'), 'true', `文字 tab held ${ms} ms`);
      await hold('#tabTree', ms);
      eq(await p.getAttribute('#tabTree', 'aria-selected'), 'true', `樹狀 tab held ${ms} ms`);
      await hold('#colBtn', ms);
      ok((await rowText(p, '"data"')).includes('{…}'), `全部摺疊 held ${ms} ms`);
      await hold('#expBtn', ms);
      ok((await rowText(p, '"data"')).includes('▾'), `全部展開 held ${ms} ms`);
      const k0 = await p.evaluate(() => document.getElementById('sortChk').checked);
      await hold('label.tog', ms);
      eq(await p.evaluate(() => document.getElementById('sortChk').checked), !k0, `鍵名排序 held ${ms} ms toggles once`);
      const wasOpen = await p.isVisible('#src');
      await hold('#editTog', ms);
      eq(await p.isVisible('#src'), !wasOpen, `編輯輸入/收合 held ${ms} ms`);
      if (!(await p.isVisible('#src'))) await hold('#editTog', 50);
      await p.evaluate(() => window.__jv.load('{"z":[1,2]}'));
      await hold('#fmtBtn', ms);
      eq(await p.inputValue('#src'), await p.evaluate(() => window.__jv.serialize('{"z":[1,2]}', document.getElementById('indentSel').value === 'tab' ? '\t' : ' '.repeat(+document.getElementById('indentSel').value), document.getElementById('sortChk').checked)), `格式化 held ${ms} ms`);
      ok((await toastText(p)).startsWith('已格式化'), `格式化 held ${ms} ms: toast once`);
      // back to the sample for the next round
      await p.evaluate(() => document.getElementById('sampleBtn').click());
      await p.fill('#q', 'a'); await p.waitForFunction(() => document.getElementById('cnt').textContent.startsWith('1/'), null, W);
    }
    // a slow press that slides off the button does nothing
    { const [hx, hy] = await center(p, '#nextBtn'); const c0 = await p.textContent('#cnt');
      await T(cdp, 'touchStart', [[hx, hy, 1]]); await T(cdp, 'touchMove', [[hx + 30, hy + 30, 1]]); await new Promise(r => setTimeout(r, 600)); await T(cdp, 'touchEnd', []);
      eq(await p.textContent('#cnt'), c0, 'press dragged 40 px off ↓ is not a tap'); }
    // rows keep the 500 ms rule: held 0.6 s is a long press (sheet), not a toggle
    await p.evaluate(() => document.getElementById('colBtn').click());
    { const [rx, ry] = await rowAt(p, '"paging"'); await T(cdp, 'touchStart', [[rx, ry, 1]]); await p.waitForFunction(() => !document.getElementById('sheetBg').hidden, null, W); await T(cdp, 'touchEnd', []);
      ok((await rowText(p, '"paging"')).includes('{…}'), 'row held: sheet, no toggle'); await p.keyboard.press('Escape'); }
    // checkbox label with another finger down
    const [kx, ky] = await center(p, 'label.tog');
    await T(cdp, 'touchStart', [[ix, iy, 2]]); await T(cdp, 'touchStart', [[ix, iy, 2], [kx, ky, 1]]); await T(cdp, 'touchEnd', [[kx, ky, 1]]); await T(cdp, 'touchEnd', []);
    eq(await p.evaluate(() => document.getElementById('sortChk').checked), true, 'sort checkbox toggles with another finger down');
    await tapAt(cdp, kx, ky);
    eq(await p.evaluate(() => document.getElementById('sortChk').checked), false, 'sort checkbox single tap toggles once');
    await ctx.close();
  }

  /* ---------- ghost clicks: an action that ran on a slow finger's pointerup must not leak a click/focus (round 3 veto) ---------- */
  // full matrix at 390x844; at 360x640 the two reported cases (backdrop, 文字 tab) to keep the run short
  for (const [w, h, full] of [[390, 844, true], [360, 640, false]]) {
    const { ctx, page: p, cdp } = await mobile(w, h); await fresh(p);
    await p.evaluate(() => { const s = document.getElementById('src'); window.__srcHits = []; // real 500 ms long-press setting
      for (const t of ['mousedown', 'focus', 'click']) s.addEventListener(t, () => window.__srcHits.push(t), true); });
    const hold = async (sel, ms) => { const [hx, hy] = await center(p, sel); await T(cdp, 'touchStart', [[hx, hy, 1]]); await new Promise(r => setTimeout(r, ms)); await T(cdp, 'touchEnd', []); return [hx, hy]; };
    const holdAt = async (x, y, ms) => { await T(cdp, 'touchStart', [[x, y, 1]]); await new Promise(r => setTimeout(r, ms)); await T(cdp, 'touchEnd', []); };
    const settle = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30))));
    const clean = async label => { await settle(); const r = await p.evaluate(() => { const h = window.__srcHits.slice(); window.__srcHits = []; return { h, active: document.activeElement && document.activeElement.id }; });
      ok(!r.h.length && r.active !== 'src', `${w}x${h} ${label}: no mousedown/focus/click on #src (${r.h.join(',') || 'none'}, active ${r.active})`); };
    const openInput = async () => { if (await p.isHidden('#src')) { await p.click('#editTog'); } await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__srcHits = []; }); };
    for (const ms of [600, 1000]) {
      // reviewer's repro: input open, node sheet open, hold the backdrop
      await openInput();
      await p.evaluate(() => { const r = [...document.querySelectorAll('.r')].find(r => r.textContent.includes('"status"')); r.scrollIntoView({ block: 'center' }); });
      await tapAt(cdp, ...(await rowAt(p, '"status"')));
      await p.waitForFunction(() => !document.getElementById('sheetBg').hidden, null, W);
      // hold the backdrop right over the input when it shows above the sheet (that is where the ghost focus went)
      const [bx, by] = await p.evaluate(() => { const top = document.querySelector('.sheet').getBoundingClientRect().top, s = document.getElementById('src').getBoundingClientRect();
        const y = s.bottom > 10 && s.top < top - 10 ? (Math.max(s.top, 0) + Math.min(s.bottom, top)) / 2 : top / 2; return [Math.round(innerWidth / 2), Math.max(10, Math.round(y))]; });
      await holdAt(bx, by, ms);
      eq(await sheetOpen(p), false, `${w}x${h} backdrop held ${ms} ms closes the sheet`);
      await clean(`backdrop held ${ms} ms`);
      // sheet buttons that close the sheet
      for (const btn of full ? ['#shClose', '#shToggle'] : []) {
        await openInput();
        // open the container's sheet with ⋯ (held), then close it with a held button
        const mo = await p.evaluate(() => { const r = [...document.querySelectorAll('.r')].find(r => r.textContent.includes('"data"')); r.scrollIntoView({ block: 'center' }); const m = r.querySelector('.more').getBoundingClientRect(); return [m.left + m.width / 2, m.top + m.height / 2]; });
        await holdAt(mo[0], mo[1], ms); // ⋯ held: opens the sheet, no ghost on what is under it
        await p.waitForFunction(() => !document.getElementById('sheetBg').hidden, null, W);
        await clean(`⋯ held ${ms} ms`);
        await hold(btn, ms);
        eq(await sheetOpen(p), false, `${w}x${h} ${btn} held ${ms} ms closes the sheet`);
        await clean(`${btn} held ${ms} ms`);
      }
      // controls that change what is under the finger
      await openInput();
      // every control at 0.6 s; at 1 s the ones that reveal or move what is under the finger most (keeps the run under 90 s)
      for (const sel of !full ? ['#tabText', '#tabTree'] : ms === 600 ? ['#tabText', '#tabTree', '#colBtn', '#expBtn', '#fmtBtn', '#minBtn', '#sampleBtn', '#editTog'] : ['#tabText', '#tabTree', '#editTog']) {
        if (await p.isHidden(sel)) continue;
        await hold(sel, ms); await clean(`${sel} held ${ms} ms`);
        if (sel === '#sampleBtn' || sel === '#editTog') await openInput();
      }
      // toast 復原 held
      await p.click('#sampleBtn'); await openInput();
      if (full && ms === 600 && await p.isVisible('.toast .tact')) { await hold('.toast .tact', ms); await clean(`復原 held ${ms} ms`); }
      await p.evaluate(() => document.getElementById('sampleBtn').click());
    }
    // intended focus still works after a slow tap: 編輯輸入 / preview and 清除 put the caret in the input
    await p.evaluate(() => document.getElementById('sampleBtn').click());
    if (await p.isVisible('#peek')) { await hold('#peek', 600); await settle(); eq(await p.evaluate(() => document.activeElement.id), 'src', `${w}x${h} folded preview held: input opens with the caret`); }
    else { await hold('#editTog', 600); await settle(); eq(await p.evaluate(() => document.activeElement.id), 'src', `${w}x${h} 編輯輸入 held: input opens with the caret`); }
    await p.evaluate(() => document.activeElement.blur());
    await hold('#clearBtn', 600); await settle();
    eq(await p.evaluate(() => document.activeElement.id), 'src', `${w}x${h} 清除 held: caret in the empty input`);
    // a quick tap right after a slow-tap action is not swallowed by the guard
    await p.click('.toast .tact').catch(() => {}); await p.evaluate(() => document.getElementById('sampleBtn').click());
    await hold('#colBtn', 600); await tapAt(cdp, ...(await center(p, '#expBtn')));
    ok((await rowText(p, '"data"')).includes('▾'), `${w}x${h} quick tap right after a slow tap still works`);
    await ctx.close();
  }

  /* ---------- round 4: ⋯ held 0.6 s / 1 s opens the sheet; every other control audited for a held press ---------- */
  for (const [w, h, full] of [[390, 844, true], [360, 640, false]]) {
    const { ctx, page: p, cdp } = await mobile(w, h);
    await ctx.addInitScript(() => { window.__clip = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip.push(t); return Promise.resolve(); }, readText: () => Promise.resolve('{"pasted":1}') } }); });
    await fresh(p); // real 500 ms long-press setting here
    await p.evaluate(() => document.getElementById('colBtn').click());
    const hold = async (sel, ms) => { const [hx, hy] = await center(p, sel); await T(cdp, 'touchStart', [[hx, hy, 1]]); await new Promise(r => setTimeout(r, ms)); await T(cdp, 'touchEnd', []); };
    const moreOf = key => p.evaluate(k => { const r = [...document.querySelectorAll('.r')].find(r => r.style.display !== 'none' && r.textContent.includes(k)); r.scrollIntoView({ block: 'center' }); const m = r.querySelector('.more').getBoundingClientRect(); return [m.left + m.width / 2, m.top + m.height / 2]; }, key);
    for (const ms of [600, 1000]) {
      const [mx, my] = await moreOf('"paging"'), before = await rowText(p, '"paging"');
      await T(cdp, 'touchStart', [[mx, my, 1]]); await new Promise(r => setTimeout(r, ms)); await T(cdp, 'touchEnd', []);
      eq(await sheetOpen(p) && await p.textContent('#shPath'), '$.paging', `${w}x${h} ⋯ held ${ms} ms opens the sheet`);
      eq(await rowText(p, '"paging"'), before, `${w}x${h} ⋯ held ${ms} ms does not fold the row`);
      if (full) {
        await p.evaluate(() => { window.__clip = []; });
        await hold('#shCopyPath', ms);
        await p.waitForFunction(() => window.__clip.length === 1, null, W).catch(() => {});
        eq(await p.evaluate(() => window.__clip), ['$.paging'], `${w}x${h} 複製路徑 held ${ms} ms copies once`);
        await hold('#shCopyVal', ms);
        await p.waitForFunction(() => window.__clip.length === 2, null, W).catch(() => {});
        eq(await p.evaluate(() => window.__clip.length), 2, `${w}x${h} 複製值 held ${ms} ms copies once`);
      }
      await hold('#shClose', ms);
      eq(await sheetOpen(p), false, `${w}x${h} 關閉 held ${ms} ms`);
    }
    if (full) {
      // remaining controls held 0.6 s: 複製, 下載, 貼上, error link, 復原, 鍵名排序
      await p.evaluate(() => { window.__clip = []; });
      await hold('#copyBtn', 600);
      await p.waitForFunction(() => window.__clip.length === 1, null, W).catch(() => {});
      eq(await p.evaluate(() => window.__clip.length), 1, '複製 held 0.6 s copies once');
      const [dl] = await Promise.all([p.waitForEvent('download', W), hold('#dlBtn', 600)]);
      eq(dl.suggestedFilename(), 'formatted.json', '下載 held 0.6 s downloads');
      await hold('#pasteBtn', 600);
      await p.waitForFunction(() => document.getElementById('src').value === '{"pasted":1}', null, W).then(() => ok(true, '貼上 held 0.6 s pastes'), () => ok(false, '貼上 held 0.6 s pastes'));
      await hold('.toast .tact', 600);
      ok((await p.inputValue('#src')) !== '{"pasted":1}', '復原 held 0.6 s undoes the paste');
      await p.evaluate(() => window.__jv.load('{"a":1,}'));
      await hold('#errJump', 600);
      eq(await p.evaluate(() => [document.activeElement.id, document.getElementById('src').selectionStart]), ['src', 6], 'error link held 0.6 s puts the caret on the comma');
      await p.evaluate(() => document.activeElement.blur());
      await hold('#fixBtn', 600);
      ok((await p.textContent('#status')).includes('合法 JSON'), '嘗試修復 held 0.6 s repairs');
      await p.evaluate(() => document.getElementById('sampleBtn').click());
      if (await p.isVisible('#peek')) { await hold('#peek', 1000); eq(await p.evaluate(() => document.activeElement.id), 'src', 'folded preview held 1 s opens the input'); await p.evaluate(() => document.activeElement.blur()); }
      const q0 = await p.evaluate(() => document.getElementById('sortChk').checked);
      await hold('label.tog', 1000);
      eq(await p.evaluate(() => document.getElementById('sortChk').checked), !q0, '鍵名排序 held 1 s toggles once');
    }
    await ctx.close();
  }

  /* ---------- saving: big input, quick reload, undo ---------- */
  {
    const { ctx, page: p } = await mobile(); await fresh(p);
    // old saved data under the old key still loads
    await p.evaluate(() => localStorage.setItem('json-viewer:v1:last', JSON.stringify('{"old":true}')));
    await p.reload(); await ready(p);
    eq(await p.inputValue('#src'), '{"old":true}', 'old localStorage key still loads');
    // 3 MB input survives a reload (IndexedDB)
    await p.evaluate(() => { const a = []; for (let i = 0; i < 20000; i++) a.push({ id: i, name: '項目 ' + i, note: 'x'.repeat(120) }); window.__jv.load(JSON.stringify(a)); });
    await p.waitForFunction(() => localStorage.getItem('json-viewer:v1:bigLast'), null, W);
    eq(await p.evaluate(() => localStorage.getItem('json-viewer:v1:last')), null, 'big input: small key removed after IndexedDB save');
    await p.reload(); await ready(p);
    ok((await p.textContent('#status')).includes('80,001 個節點') && await p.isHidden('#sampleChip'), 'big input restored after reload: ' + await p.textContent('#status'));
    // back to a small input: marker removed, small key used
    await p.evaluate(() => window.__jv.load('{"small":1}'));
    eq(await p.evaluate(() => [localStorage.getItem('json-viewer:v1:bigLast'), localStorage.getItem('json-viewer:v1:last')]), [null, JSON.stringify('{"small":1}')], 'small input goes back to localStorage');
    // typed text survives an immediate reload (pagehide flush)
    await p.evaluate(() => { const s = document.getElementById('src'); s.value = '{"typed":"z"}'; s.dispatchEvent(new Event('input')); });
    await p.reload(); await ready(p);
    eq(await p.inputValue('#src'), '{"typed":"z"}', 'reload right after typing keeps the last characters');
    // invalid input is saved too
    await p.evaluate(() => { const s = document.getElementById('src'); s.value = '{"broken":'; s.dispatchEvent(new Event('input')); });
    await p.reload(); await ready(p);
    eq(await p.inputValue('#src'), '{"broken":', 'unfinished (invalid) input survives reload');
    // clear -> undo; sample -> undo
    await p.click('#clearBtn');
    eq(await p.inputValue('#src'), '', 'clear empties the input');
    await p.click('.toast .tact');
    eq(await p.inputValue('#src'), '{"broken":', 'clear can be undone');
    await p.click('#sampleBtn'); ok((await p.textContent('#status')).includes('範例資料'), 'sample loaded (marked in the status on phones)');
    await p.click('.toast .tact');
    eq(await p.inputValue('#src'), '{"broken":', 'sample can be undone');
    await p.reload(); await ready(p);
    eq(await p.inputValue('#src'), '{"broken":', 'undone content is saved');
    await ctx.close();
  }
  {
    // no storage at all for large content -> the page says it will not be kept
    const { ctx, page: p } = await mobile();
    await ctx.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); } }); });
    await p.goto(URL); await ready(p);
    await p.evaluate(() => window.__jv.load('["' + '中'.repeat(1100000) + '"]'));
    await p.waitForFunction(() => (document.getElementById('saveWarn').textContent || '').includes('不會保留'), null, W);
    const sw = await p.textContent('#saveWarn');
    ok(sw.includes('3.15 MB'), 'unsaveable note gives the size in bytes (3.15 MB, not 1.05 M chars): ' + sw);
    await ctx.close();
  }
  {
    // big save in progress: 儲存中… is shown, and a reload before the write ends warns next time instead of silently showing the sample
    const { ctx, page: p } = await mobile(); await fresh(p);
    const shown = await p.evaluate(() => { const a = []; for (let i = 0; i < 30000; i++) a.push({ id: i, name: '項目 ' + i, note: 'x'.repeat(100) }); window.__jv.load(JSON.stringify(a));
      const w = document.getElementById('saveWarn'); return !w.hidden && w.textContent; });
    ok(typeof shown === 'string' && shown.includes('儲存中'), 'big save shows 儲存中… until IndexedDB finishes: ' + shown);
    const bu = await p.evaluate(() => { const a = []; for (let i = 0; i < 30000; i++) a.push({ id: i, name: '項目 ' + i, note: 'z'.repeat(100) }); window.__jv.load(JSON.stringify(a));
      const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; });
    eq(bu, true, 'beforeunload asks to stay while a big save is in progress');
    await p.waitForFunction(() => document.getElementById('saveWarn').hidden, null, W);
    eq(await p.evaluate(() => localStorage.getItem('json-viewer:v1:bigPending')), null, 'pending marker cleared once saved');
    eq(await p.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; }), false, 'no beforeunload prompt once saved');
    // a page closed during the write: simulate the marker it leaves behind
    await p.evaluate(() => localStorage.setItem('json-viewer:v1:bigPending', JSON.stringify({ bytes: 11192130, at: Date.now() })));
    await p.reload(); await ready(p);
    const w2 = await p.textContent('#saveWarn');
    ok(await p.isVisible('#saveWarn') && w2.includes('上次內容未存完') && w2.includes('10.67 MB'), 'next open warns 上次內容未存完: ' + w2);
    ok((await p.textContent('#status')).includes('120,001 個節點'), 'the last fully saved content is still restored');
    // the write finished but the page closed before hearing so: the stored text has the pending length -> restored, no warning
    const len = await p.evaluate(() => JSON.parse(localStorage.getItem('json-viewer:v1:bigLast')).chars);
    await p.evaluate(len => { localStorage.removeItem('json-viewer:v1:bigLast'); localStorage.setItem('json-viewer:v1:bigPending', JSON.stringify({ bytes: len, chars: len, at: 1 })); }, len);
    await p.reload(); await ready(p);
    ok((await p.textContent('#status')).includes('120,001 個節點') && await p.isHidden('#saveWarn'), 'write that completed unacknowledged is restored without a warning');

    // real quick reload right after opening a big file: either restored or warned, never silently lost
    await p.evaluate(() => { const a = []; for (let i = 0; i < 40000; i++) a.push({ k: i, v: 'quick-' + i, pad: 'y'.repeat(150) }); window.__jv.load(JSON.stringify(a)); location.reload(); });
    await ready(p);
    const st = await p.textContent('#status'), wn = await p.isVisible('#saveWarn') ? await p.textContent('#saveWarn') : '';
    ok(st.includes('160,001 個節點') || wn.includes('上次內容未存完'), `reload during the save: restored or warned (status: ${st.slice(0, 30)} / ${wn.slice(0, 20)})`);
    await ctx.close();
  }

  /* ---------- layout, sizes, copy/download, progress ---------- */
  {
    const { ctx, page: p } = await mobile(360, 640); await fresh(p);
    const m = await p.evaluate(() => { const vp = document.getElementById('vp').getBoundingClientRect(), dock = document.querySelector('.dock').getBoundingClientRect(); return { tree: Math.round(Math.min(innerHeight, dock.top) - vp.top), sw: document.documentElement.scrollWidth }; });
    ok(m.tree >= 220, `360x640: ${m.tree}px of the tree on the first screen (>= 5 rows)`);
    eq(m.sw, 360, '360x640 no horizontal scroll');
    eq(await p.textContent('.inhead b'), '輸入', 'input label is Chinese');
    eq(await p.evaluate(() => [document.getElementById('sampleBtn').classList.contains('ghost'), document.getElementById('clearBtn').classList.contains('ghost')]), [false, true], 'clear is the quieter button');
    const small = await p.evaluate(() => [...document.querySelectorAll('button,select,label.tog')].filter(e => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).map(e => e.id || e.tagName));
    eq(small, [], 'all visible controls >= 44x44 (tabs, indent select)');
    // edit toggle shows the textarea in place
    // folded: the first line holds 貼上 / 開啟檔案 / 編輯輸入, and they stay put when the input opens
    const pos = () => p.evaluate(() => ['pasteBtn', 'fileBtn', 'editTog'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; }));
    const p0 = await pos();
    eq(await p.evaluate(() => ['fmtBtn', 'minBtn', 'src'].map(id => !!document.getElementById(id).offsetParent)), [false, false, false], 'folded: textarea, 格式化, 壓縮 hidden');
    await p.click('#editTog'); ok(await p.isVisible('#src'), '編輯輸入 shows the textarea');
    eq(await pos(), p0, 'unfolding does not move 貼上 / 開啟檔案 / 編輯輸入');
    await p.click('#editTog'); ok(await p.isHidden('#src'), 'folded again');
    // invalid JSON loaded while folded (e.g. 貼上): the input opens by itself, the buttons stay put
    await p.evaluate(() => window.__jv.load('{\n  "a": 1,\n}'));
    await p.waitForSelector('#errJump', W);
    ok(await p.isVisible('#src'), 'invalid JSON unfolds the input');
    eq(await pos(), p0, 'auto-unfold does not move the first-line buttons');
    const gap = await p.evaluate(() => Math.round(document.querySelector('.ctx').getBoundingClientRect().top - document.getElementById('errJump').getBoundingClientRect().bottom));
    ok(gap <= 4, 'error card: no big gap between the message and the context box: ' + gap + 'px');
    const jb = await p.evaluate(() => document.getElementById('errJump').getBoundingClientRect().height);
    ok(jb >= 44, 'error jump button height ' + jb);
    await p.click('#editTog'); ok(await p.isHidden('#src'), '收合 hides the textarea');
    await p.click('#errJump'); ok(await p.isVisible('#src'), 'error jump opens the textarea');
    await ctx.close();
  }
  {
    // lobby size 375x500: more of the tree on the first screen
    const { ctx, page: p } = await mobile(375, 500); await fresh(p);
    const t = await p.evaluate(() => { const vp = document.getElementById('vp').getBoundingClientRect(), dock = document.querySelector('.dock').getBoundingClientRect(); return Math.round(Math.min(innerHeight, dock.top) - vp.top); });
    ok(t >= 132, `375x500: ${t}px of the tree visible (>= 3 rows; was 83)`);
    eq(await p.evaluate(() => document.documentElement.scrollWidth), 375, '375x500 no horizontal scroll');
    await ctx.close();
  }
  {
    const { ctx, page: p } = await mobile(360, 640); await fresh(p);
    // download without a host capability
    await p.evaluate(() => window.__jv.load('{"d":1}'));
    ok(await p.isVisible('#dlBtn'), 'download button visible on a plain page');
    const [dl] = await Promise.all([p.waitForEvent('download', W), p.click('#dlBtn')]);
    eq(dl.suggestedFilename(), 'formatted.json', 'download file name');
    const body = fs.readFileSync(await dl.path(), 'utf8'); eq(JSON.parse(body), { d: 1 }, 'downloaded content');
    await ctx.close();
  }
  {
    // clipboard refused + 3 MB: no execCommand freeze, points to 下載; text tab shows progress first
    const { ctx, page: p } = await mobile();
    await ctx.addInitScript(() => {
      const no = () => Promise.reject(new Error('denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: no, write: no, readText: no }, configurable: true });
      const ex = document.execCommand.bind(document); window.__exec = 0; document.execCommand = (...a) => { window.__exec++; return ex(...a); };
    });
    await p.goto(URL); await ready(p);
    await p.evaluate(() => { const a = []; for (let i = 0; i < 20000; i++) a.push({ id: i, note: 'x'.repeat(140) }); window.__jv.load(JSON.stringify(a)); });
    // the formatted text is built in the background after loading, so 文字 / 複製 do not wait
    await p.waitForFunction(() => window.__jv.textReady(), null, W);
    ok(true, 'big content: formatted text ready in the background without any tap');
    await p.evaluate(() => { window.__txt = []; new MutationObserver(() => window.__txt.push(document.getElementById('txt').textContent.slice(0, 10))).observe(document.getElementById('txt'), { childList: true, characterData: true, subtree: true }); });
    await p.click('#tabText');
    await p.waitForFunction(() => window.__txt.length >= 1, null, W);
    ok((await p.evaluate(() => window.__txt[0])).startsWith('['), 'text tab shows the text at once when it is ready');
    await p.click('#tabTree');
    // not ready yet (settings just changed): 處理中 first, then the text
    await p.evaluate(() => { window.__txt = []; document.getElementById('sortChk').click(); document.getElementById('tabText').click(); });
    ok((await p.evaluate(() => window.__txt[0] || document.getElementById('txt').textContent)).startsWith('處理中'), 'text tab shows 處理中 first when not ready');
    await p.waitForFunction(() => document.getElementById('txt').textContent.startsWith('['), null, W);
    ok(await p.evaluate(() => window.__jv.textReady() && document.getElementById('txt').textContent.includes('僅顯示前 600,000 字')), 'text tab fills in afterwards');
    await p.click('#tabTree');
    await p.evaluate(() => document.getElementById('sortChk').click()); // drop the text cache
    await p.click('#copyBtn');
    await p.waitForFunction(() => document.getElementById('toastHost').textContent.includes('下載'), null, W);
    eq(await p.evaluate(() => window.__exec), 0, 'big copy without clipboard API does not use execCommand');
    // small copy still falls back to execCommand
    await p.evaluate(() => window.__jv.load('{"s":1}'));
    await p.click('#copyBtn');
    await p.waitForFunction(() => window.__exec > 0, null, W).then(() => ok(true, 'small copy falls back to execCommand'), () => ok(false, 'small copy falls back to execCommand'));
    await ctx.close();
  }
  {
    // desktop mouse: row click toggles once, right click opens the sheet
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('desktop pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push('desktop console: ' + m.text()); });
    await fresh(p); await p.evaluate(() => window.__jv.setLongPress(5000));
    await p.click('#colBtn');
    const r = await p.evaluate(() => { const r = [...document.querySelectorAll('.r')].find(r => r.textContent.includes('"paging"')); const b = r.getBoundingClientRect(); return [b.left + 120, b.top + b.height / 2]; });
    await p.mouse.click(r[0], r[1]);
    ok((await rowText(p, '"paging"')).includes('▾'), 'mouse click on a row toggles it once');
    eq(await p.evaluate(() => window.__jv.tapStats.rows), 1, 'one mouse click = one row action');
    await p.mouse.click(r[0], r[1], { button: 'right' });
    eq(await p.textContent('#shPath'), '$.paging', 'right click opens the sheet');
    await p.mouse.click(5, 5); eq(await sheetOpen(p), false, 'click on backdrop closes');
    await ctx.close();
  }

  await browser.close(); srv.close();
  for (const e of errors) { fail++; console.log('FAIL', e); }
  console.log(`\n${fail ? 'FAIL' : 'ALL PASS'}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); process.exit(1); });
