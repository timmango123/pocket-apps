// Regression tests for periodic-table (run by qa/smoke/run.js). Real CDP touch for every tap check.
// node apps/periodic-table/demo/tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>';
const URL = 'http://pt.test/apps/periodic-table/';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('ok   - ' + m); } else { fails++; console.log('FAIL - ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();

async function open(browser, w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, ...opts });
  const errors = [], requests = [];
  await ctx.route('**/*', r => { if (r.request().url().startsWith('http://pt.test/')) return r.fulfill({ body: HTML, contentType: 'text/html; charset=utf-8' }); requests.push(r.request().url()); return r.abort(); });
  // logs every click (native ones included) before the app's own listeners run
  await ctx.addInitScript(() => { window.__all = []; addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); __all.push(b ? (b.id || (b.dataset.z ? 'z' + b.dataset.z : '') || b.textContent.trim().slice(0, 6)) : e.target.tagName); }, true); });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const load = async (init) => {
    if (init) await page.evaluate(init);
    await page.goto(URL); await page.waitForFunction(() => window.__pt);
    await page.evaluate(() => { window.__eff = [];
      addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) __eff.push(b.id || (b.dataset.z ? 'z' + b.dataset.z : '') || (b.dataset.nz ? 'n' + b.dataset.nz : '') || b.textContent.trim().slice(0, 6)); }); });
  };
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(p => ({ x: p.x, y: p.y, id: p.id || 1, radiusX: 3, radiusY: 3, force: 1 })) });
  const pt = (sel) => page.evaluate(s => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return null; const b = e.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2, h = document.elementFromPoint(x, y); return { x, y, w: b.width, h: b.height, hit: !!h && (h === e || e.contains(h)) }; }, sel);
  const reset = () => page.evaluate(() => { __eff.length = 0; __all.length = 0; });
  // every click seen at all (window capture, before the app) must be the one effective click
  const eff = () => page.evaluate(() => __all.length === __eff.length ? __eff.slice() : __all.map(x => 'ALL:' + x));
  // single finger tap held `hold` ms; waits for the native click (if the browser sends one) so a double would be seen
  const tap = async (p, hold = 40) => { await reset(); await touch('touchStart', [p]); await sleep(hold); await touch('touchEnd', []);
    await page.waitForFunction(() => __eff.length > 0, null, { timeout: 1500 }).catch(() => {}); await sleep(120); return eff(); };
  // finger A held, finger B taps; order = which finger lifts first (CDP touchEnd releases the points it lists)
  const twoFinger = async (A, B, order, hold = 60) => { await reset(); A.id = 1; B.id = 2;
    await touch('touchStart', [A]); await sleep(60); await touch('touchStart', [A, B]); await sleep(hold);
    if (order === 'B') { await touch('touchEnd', [B]); await sleep(60); await touch('touchEnd', [A]); }
    else { await touch('touchEnd', [A]); await sleep(60); await touch('touchEnd', [B]); }
    await page.waitForFunction(() => __eff.length > 0, null, { timeout: 1500 }).catch(() => {}); await sleep(120); return eff(); };
  return { ctx, page, cdp, errors, requests, load, touch, pt, tap, twoFinger, reset, eff };
}

(async () => {
  const browser = await chromium.launch();
  const allErrors = [], allReq = [];
  try {
    // ---------- 390x844 portrait: taps, two fingers, zoom buttons, near grid, drag handle ----------
    { const m = await open(browser, 390, 844); const { page } = m; await m.load();
      const st = () => page.evaluate(() => ({ view: __pt.S.view, open: !document.getElementById('detail').classList.contains('closed'), full: document.getElementById('detail').classList.contains('full'),
        z: +((document.querySelector('#detInner .big .n') || {}).textContent || 0), theme: document.getElementById('themeBtn').textContent, zoom: __pt.zoom }));
      // single taps at three hold times: exactly one action, no ghost click
      for (const hold of [40, 600, 1000]) {
        await page.evaluate(() => { __pt.setView('table'); __pt.setZoom(1); scrollTo(0, 0); });
        const before = (await st()).theme; let e = await m.tap(await m.pt('#themeBtn'), hold);
        ok(e.length === 1 && e[0] === 'themeBtn' && (await st()).theme !== before, `hold ${hold}ms: theme tap fires once (${e.join(',')})`);
        e = await m.tap(await m.pt('.el[data-z="26"]'), hold); let s = await st();
        ok(e.length === 1 && s.open && s.z === 26, `hold ${hold}ms: cell Fe tap opens Fe once (${e.join(',')})`);
        e = await m.tap(await m.pt('#nextEl'), hold); s = await st();
        ok(e.length === 1 && s.z === 27, `hold ${hold}ms: next tap moves exactly one element (${s.z} ${e})`);
      }
      // second finger while another finger is already down, both release orders
      const A = await m.pt('h1'); A.x -= 40;
      for (const order of ['B', 'A']) {
        await page.evaluate(() => { __pt.setView('table'); scrollTo(0, 0); });
        let e = await m.twoFinger({ ...A }, await m.pt('#mList'), order);
        ok((await st()).view === 'list' && e.length === 1, `two fingers (${order} lifts first): 清單 switches view once (${e.join(',')})`);
        e = await m.twoFinger({ ...A }, await m.pt('#mTable'), order);
        ok((await st()).view === 'table' && e.length === 1, `two fingers (${order} first): 表格 switches back`);
        await page.evaluate(() => { document.getElementById('closeDet').click(); scrollTo(0, 0); });
        e = await m.twoFinger({ ...A }, await m.pt('.el[data-z="29"]'), order); let s = await st();
        ok(s.open && s.z === 29 && e.length === 1, `two fingers (${order} first): cell Cu opens (${e.join(',')})`);
        e = await m.twoFinger({ ...A }, await m.pt('#nextEl'), order); s = await st();
        ok(s.z === 30 && e.length === 1, `two fingers (${order} first): next in detail`);
        // anchor finger resting on the table's empty area, tap a cell
        const blank = await page.evaluate(() => { const a = document.querySelector('.el[data-z="1"]').getBoundingClientRect(), b = document.querySelector('.el[data-z="2"]').getBoundingClientRect(); return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 }; });
        e = await m.twoFinger(blank, await m.pt('.el[data-z="8"]'), order); s = await st();
        ok(s.z === 8 && e.length === 1, `two fingers (${order} first): finger on table blank + tap O opens O`);
        await page.evaluate(() => { __pt.setView('quiz'); document.getElementById('qNext').click(); scrollTo(0, 0); });
        const asked0 = await page.evaluate(() => __pt.QZ.asked);
        e = await m.twoFinger({ ...A }, await m.pt('#qOpts button:nth-child(2)'), order);
        ok(await page.evaluate(() => __pt.QZ.asked) === asked0 + 1 && e.length === 1, `two fingers (${order} first): quiz option answered once`);
        await page.evaluate(() => __pt.setView('table'));
      }
      // slow second-finger taps (held 0.6 s / 1 s) with another finger down
      for (const hold of [600, 1000]) { await page.evaluate(() => { __pt.setView('table'); scrollTo(0, 0); });
        const before = (await st()).theme; const e = await m.twoFinger({ ...A }, await m.pt('#themeBtn'), 'B', hold);
        ok(e.length === 1 && (await st()).theme !== before, `two fingers, second held ${hold}ms: theme fires once`); }
      // a finger that slides more than 10 px is not a tap
      { await page.evaluate(() => { __pt.setView('table'); scrollTo(0, 0); }); const p = await m.pt('#themeBtn'), before = (await st()).theme; await m.reset();
        await m.touch('touchStart', [p]); for (let i = 1; i <= 4; i++) await m.touch('touchMove', [{ x: p.x + i * 6, y: p.y }]); await m.touch('touchEnd', []); await sleep(200);
        ok((await st()).theme === before && (await m.eff()).length === 0, 'sliding 24 px off a button does not fire it'); }
      // pinch with both fingers on the table must not open anything
      await page.evaluate(() => { document.getElementById('closeDet').click(); __pt.setZoom(1); scrollTo(0, 0); });
      { const a = await m.pt('.el[data-z="56"]'), b = await m.pt('.el[data-z="60"]'); a.id = 1; b.id = 2;
        await m.reset(); await m.touch('touchStart', [a]); await m.touch('touchStart', [a, b]);
        for (let i = 1; i <= 6; i++) await m.touch('touchMove', [{ ...a, x: a.x - i * 8 }, { ...b, x: b.x + i * 8 }]);
        await m.touch('touchEnd', [b]); await m.touch('touchEnd', [a]); await sleep(250); const s = await st();
        ok(s.zoom > 1.05 && !s.open && (await m.eff()).length === 0, `pinch zooms (${s.zoom.toFixed(2)}) without opening a cell`); }
      // zoom buttons stay put; tapping the same spot twice zooms twice
      await page.evaluate(() => { __pt.setZoom(1); scrollTo(0, 0); __pt.openDetail(26); });
      { const p0 = await m.pt('#zoomIn'); await m.tap(p0); const p1 = await m.pt('#zoomIn');
        ok(Math.abs(p0.x - p1.x) < 1 && Math.abs(p0.y - p1.y) < 1, `＋ does not move after zooming (${p0.y.toFixed(0)} -> ${p1.y.toFixed(0)})`);
        await m.tap(p0); const s = await st(); ok(s.zoom > 2 && s.z === 26, `second tap on the same spot zooms again (zoom ${s.zoom.toFixed(2)}), no cell opened`);
        const hz = await m.pt('#zoomOut'); ok(p1.hit && hz.hit, '＋／− not covered while the detail sheet is open at 2.25×'); }
      // near grid: correct a wrong tap without closing the sheet
      await page.evaluate(() => { __pt.setZoom(1); __pt.openDetail(26); document.querySelector('#near button[data-nz="27"]').scrollIntoView({ block: 'center' }); });
      { const e = await m.tap(await m.pt('#near button[data-nz="27"]')); const s = await st();
        ok(s.z === 27 && e.length === 1, 'near-element grid in the sheet: tap Co opens Co');
        const sizes = await page.evaluate(() => [...document.querySelectorAll('#near button')].map(b => Math.min(b.offsetWidth, b.offsetHeight)));
        ok(sizes.length >= 9 && Math.min(...sizes) >= 44, `near buttons ≥ 44px (${Math.min(...sizes)})`); }
      // tap just outside a cell edge (table gap / blank) snaps to the nearest cell
      await page.evaluate(() => { document.getElementById('closeDet').click(); scrollTo(0, 0); });
      { const be = await page.evaluate(() => { const r = document.querySelector('.el[data-z="4"]').getBoundingClientRect(); return { x: r.right + 4, y: r.top + r.height / 2 }; });
        await m.tap(be); const s = await st(); ok(s.open && s.z === 4, 'tap 4px right of Be (empty table area) opens Be'); }
      // drag handle actually drags: down closes, up expands
      await page.evaluate(() => __pt.openDetail(8));
      for (const [dy, want, label] of [[-160, 'full', 'drag handle up expands'], [160, 'half', 'drag down from full collapses'], [200, 'closed', 'drag handle down closes']]) {
        const g = await m.pt('#grab'); await m.touch('touchStart', [g]);
        for (let i = 1; i <= 8; i++) await m.touch('touchMove', [{ x: g.x, y: g.y + dy * i / 8 }]);
        await m.touch('touchEnd', []); await sleep(150); const s = await st();
        ok(want === 'full' ? s.full : want === 'half' ? (s.open && !s.full) : !s.open, label); }
      // list: filter banner, column widths
      await page.evaluate(() => { __pt.setView('list'); scrollTo(0, 0); });
      await m.tap(await m.pt('#legend button:nth-child(3)'));
      { const t = await page.evaluate(() => [document.getElementById('listFilt').hidden, document.getElementById('listFilt').textContent, document.querySelectorAll('#list .row').length]);
        ok(!t[0] && /只顯示：過渡金屬/.test(t[1]) && t[2] < 118, `list shows the legend filter banner (${t[1]}, ${t[2]} rows)`);
        await m.tap(await m.pt('#clearLegend'));
        ok(await page.evaluate(() => document.querySelectorAll('#list .row').length) === 118, 'banner × clears the filter'); }
      ok(await page.evaluate(() => getComputedStyle(document.querySelector('#list .row')).gridTemplateColumns.split(' ')[0]) === '30px', 'list number column is 2em');
      // quiz: options and 下一題 never move between questions/answers; 8 taps/s alternating option <-> next all land
      await page.evaluate(() => { __pt.setView('quiz'); scrollTo(0, 0); });
      { const ys = await page.evaluate(() => { const s = new Set(); for (let i = 0; i < 60; i++) { document.getElementById('qNext').click(); s.add(Math.round(document.getElementById('qOpts').getBoundingClientRect().top)); document.querySelector('#qOpts button').click(); s.add(Math.round(document.getElementById('qOpts').getBoundingClientRect().top) + ':' + Math.round(document.getElementById('qNext').getBoundingClientRect().top)); } return [...s]; });
        ok(ys.length === 2, 'quiz layout does not shift between question types or after answering (' + ys + ')');
        await page.evaluate(() => document.getElementById('qNext').click());
        const o = await m.pt('#qOpts button:nth-child(1)'), n = await m.pt('#qNext'); const a0 = await page.evaluate(() => __pt.QZ.asked); await m.reset(); const t0 = Date.now();
        for (let i = 0; i < 16; i++) { const p = i % 2 ? n : o; await m.touch('touchStart', [p]); await sleep(30); await m.touch('touchEnd', []); const w = t0 + 125 * (i + 1) - Date.now(); if (w > 0) await sleep(w); }
        await page.waitForFunction(n0 => __pt.QZ.asked >= n0 + 8, a0, { timeout: 3000 }).catch(() => {}); await sleep(150);
        const r = await page.evaluate(() => [__pt.QZ.asked, __all.length, __eff.length]);
        ok(r[0] - a0 === 8 && r[1] === 16 && r[2] === 16, `8 taps/s option<->next: 8 answers, 16 clicks (${r[0] - a0}, ${r[1]}, ${r[2]})`); }
      // quiz reset can be undone
      await page.evaluate(() => { __pt.setView('quiz'); scrollTo(0, 0); });
      { const before = await page.evaluate(() => __pt.QZ.asked); ok(before >= 2, 'quiz has records before reset');
        await m.tap(await m.pt('#qReset')); ok(await page.evaluate(() => __pt.QZ.asked) === 0 && await page.evaluate(() => !document.getElementById('toast').hidden && !!document.getElementById('toastAct')), 'reset shows 復原');
        await m.tap(await m.pt('#toastAct')); const after = await page.evaluate(() => [__pt.QZ.asked, JSON.parse(localStorage.getItem('periodic-table:v1:quiz')).asked]);
        ok(after[0] === before && after[1] === before, `復原 restores and saves the records (${after})`); }
      // temperature: number field, ±1 K, presets; slider only updates the "目前溫度下" row
      await page.evaluate(() => { __pt.setView('table'); scrollTo(0, 0); }); await page.selectOption('#colorBy', 'phase'); await page.evaluate(() => __pt.openDetail(80));
      await page.fill('#tempN', '234'); ok(await page.evaluate(() => __pt.S.tempK) === 234 && await page.getAttribute('.el[data-z="80"]', 'data-key') === 'ps', 'typing 234 K sets the temperature (Hg solid)');
      await m.tap(await m.pt('#tUp')); ok(await page.evaluate(() => __pt.S.tempK) === 235 && await page.getAttribute('.el[data-z="80"]', 'data-key') === 'pl', '＋1 K -> 235 K, Hg liquid');
      await m.tap(await m.pt('#tDown')); ok(await page.evaluate(() => __pt.S.tempK) === 234, '−1 K -> 234 K');
      await page.evaluate(() => { document.querySelector('#detInner .tile').dataset.mark = '1'; });
      await m.tap(await m.pt('.tpre button[data-t="373"]'));
      ok(await page.evaluate(() => __pt.S.tempK === 373 && document.querySelector('#detInner .tile').dataset.mark === '1' && /液態（373 K）/.test(document.getElementById('tNow').textContent)), 'preset 100 °C; detail not rebuilt, 目前溫度下 row updated');
      // persistence of zoom + legend
      await page.selectOption('#colorBy', 'cat'); await page.evaluate(() => __pt.setZoom(1.5)); await m.tap(await m.pt('#legend button:nth-child(3)'));
      await page.evaluate(() => dispatchEvent(new Event('pagehide'))); await page.reload(); await page.waitForFunction(() => window.__pt);
      ok(await page.evaluate(() => Math.abs(__pt.zoom - 1.5) < 0.01 && document.querySelector('#legend button:nth-child(3)').getAttribute('aria-pressed') === 'true'), 'zoom and legend filter survive reload');
      allErrors.push(...m.errors); allReq.push(...m.requests); await m.ctx.close(); }

    // ---------- data correctness ----------
    { const m = await open(browser, 390, 844); const { page } = m; await m.load();
      const r = await page.evaluate(() => { const p = __pt, ph = (z, T) => p.phaseAt(p.E[z - 1], T);
        return { C: [ph(6, 3000), ph(6, 4500), ph(6, 6000)], P: [ph(15, 300), ph(15, 400), ph(15, 600)], As: [ph(33, 800), ph(33, 900), ph(33, 1100)], He: [ph(2, 0), ph(2, 0.5), ph(2, 5)],
          liquid6000: p.E.filter(e => p.phaseAt(e, 6000) === 'l' && e.sym !== 'W').map(e => e.sym),
          s: ['aluminum', 'caesium', 'sulphur', '８', 'ｆｅ', '氫氣', '26號', 'cesium', 'ＯＸＹＧＥＮ', '第 8 號元素'].map(q => (p.search(q) || []).map(e => e.z).join('|')),
          rad: [p.E[1].radius, p.E[9].radius, p.E[17].radius], zr: p.E[39].mass }; });
      ok(r.C.join() === 's,g,g', 'C sublimes (~3915 K): ' + r.C); ok(r.P.join() === 's,l,g', 'P boils at 553.7 K: ' + r.P);
      ok(r.As.join() === 's,g,g', 'As sublimes at 887 K: ' + r.As); ok(r.He.join() === 'l,l,g', 'He never solid at 1 atm: ' + r.He);
      ok(r.liquid6000.length === 0, 'nothing but W (bp 6203 K) liquid at 6000 K (' + r.liquid6000 + ')');
      ok(JSON.stringify(r.s) === JSON.stringify(['13', '55', '16', '8', '26', '1', '26', '55', '8', '8']), 'search normalisation/aliases: ' + r.s.join(' '));
      ok(r.rad.join() === '31,38,71', 'noble-gas radii from one source (He 31, Ne 38, Ar 71)'); ok(r.zr === '91.224', 'Zr 91.224');
      await page.evaluate(() => __pt.openDetail(6)); ok(/常壓下昇華/.test(await page.textContent('#detInner')), 'C detail notes sublimation');
      await page.evaluate(() => __pt.openDetail(2)); ok(/常壓下不凝固/.test(await page.textContent('#detInner')), 'He detail notes no solid at 1 atm');
      allErrors.push(...m.errors); await m.ctx.close(); }

    // ---------- corrupted saved data ----------
    for (const [label, settings, quiz] of [
      ['colorBy zzz', { colorBy: 'zzz' }, null], ['view/temp/zoom junk', { view: 'bogus', tempK: 1e9, zoom: 'x', unitTemp: 7, legend: 'q9' }, null],
      ['quiz perElement junk', null, { asked: 5, correct: 3, perElement: { 999: { n: 1, wrong: 1 }, abc: { n: 1, wrong: 1 }, 26: { n: 2, wrong: 1 }, 0: null } }]]) {
      const m = await open(browser, 390, 844); const { page } = m;
      await page.route('**/*', r => r.fulfill({ body: '<!doctype html><title>x</title>', contentType: 'text/html' }));
      await page.goto(URL); await page.evaluate(([s, q]) => { localStorage.clear(); if (s) localStorage.setItem('periodic-table:v1:settings', JSON.stringify(s)); if (q) localStorage.setItem('periodic-table:v1:quiz', JSON.stringify(q)); }, [settings, quiz]);
      await page.unroute('**/*'); await m.load();
      await page.evaluate(() => { __pt.setView('quiz'); for (let i = 0; i < 12; i++) { document.querySelector('#qOpts button').click(); document.getElementById('qNext').click(); } __pt.setView('table'); });
      const s = await page.evaluate(() => [__pt.S.colorBy, __pt.S.view, __pt.S.tempK, document.querySelectorAll('.el').length]);
      ok(m.errors.length === 0 && s[3] === 118 && ['cat', 'phase'].includes(s[0]) && s[2] <= 6000, `corrupt ${label}: starts cleanly (${s}) ${m.errors.join('|')}`);
      await m.ctx.close(); }

    // ---------- 360x640: sheet open + zoomed, controls reachable ----------
    { const m = await open(browser, 360, 640); const { page } = m; await m.load();
      await page.evaluate(() => { __pt.openDetail(26); __pt.setZoom(2.25); scrollTo(0, 0); });
      const a = await m.pt('#zoomIn'), b = await m.pt('#zoomOut'); ok(a.hit && b.hit, '360x640: ＋／− visible with sheet open at 2.25×');
      const sw = await page.evaluate(() => document.documentElement.scrollWidth); ok(sw <= 360, '360x640 no horizontal scroll');
      allErrors.push(...m.errors); await m.ctx.close(); }

    // ---------- 844x390 landscape: side panel, cells reachable ----------
    { const m = await open(browser, 844, 390); const { page } = m; await m.load();
      const r = await page.evaluate(() => { const d = document.getElementById('detail').getBoundingClientRect(), w = document.getElementById('wrap').getBoundingClientRect();
        let hit = 0; document.querySelectorAll('.el').forEach(c => { const b = c.getBoundingClientRect(); const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); if (h && c.contains(h)) hit++; });
        return { overlap: !(d.left >= w.right || d.top >= w.bottom), hit, open: !document.getElementById('detail').classList.contains('closed') }; });
      ok(r.open && !r.overlap && r.hit === 118, `844x390: detail is a side panel, ${r.hit} cells tappable on load`);
      ok((await m.pt('#zoomIn')).hit && (await m.pt('#zoomOut')).hit && (await m.pt('#nextEl')).hit, '844x390: zoom and next reachable');
      const e = await m.tap(await m.pt('.el[data-z="11"]')); ok(e.length === 1 && /鈉/.test(await page.textContent('#detInner h2')), '844x390: tap Na opens Na');
      await page.evaluate(() => __pt.setZoom(3)); const cell = await page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('ptable')).getPropertyValue('--cell')));
      ok(cell <= 72.5, `844x390 max zoom capped at ~72px/cell (${cell.toFixed(1)})`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth) <= 844, '844x390 no horizontal scroll');
      allErrors.push(...m.errors); allReq.push(...m.requests); await m.ctx.close(); }

    // ---------- desktop keyboard still works ----------
    { const m = await open(browser, 1280, 800, { isMobile: false, hasTouch: false }); const { page } = m; await m.load();
      await page.locator('.el[data-z="26"]').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
      ok(/鈷/.test(await page.textContent('#detInner h2')), 'desktop: arrow + Enter opens Co');
      await page.evaluate(() => { __eff.length = 0; }); await page.click('#themeBtn'); await sleep(100);
      ok(await page.textContent('#themeBtn') === '淺色' && (await page.evaluate(() => __eff.length)) === 1, 'desktop: mouse click on theme fires once');
      allErrors.push(...m.errors); await m.ctx.close(); }

    ok(allErrors.length === 0, 'no page/console errors ' + allErrors.join(' | '));
    ok(allReq.length === 0, 'no external requests ' + allReq.join(' '));
  } catch (e) { fails++; console.log('FAIL - exception: ' + (e && e.stack || e)); }
  finally { await browser.close(); }
  const msg = `${passes} passed, ${fails} failed (${((Date.now() - T0) / 1000).toFixed(1)}s)`;
  console.log(fails ? 'FAIL ' + msg : 'PASS ' + msg); process.exit(fails ? 1 : 0);
})();
