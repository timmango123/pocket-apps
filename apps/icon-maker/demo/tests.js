// Regression tests for icon-maker (release review 2026-11-02). Usage: node tests.js
// Real Chromium at phone size; waits on conditions, never on wall-clock frame timing.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SRC = path.resolve(__dirname, '..', 'index.html');
const SKELETON = '<!doctype html><html lang="zh-Hant"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0;
const t = (name, cond, info) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('FAIL', name, info === undefined ? '' : JSON.stringify(info)); } };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => {
  const b = data instanceof Blob ? data : new Blob([data]); window.__saved.push({ filename, size: b.size, text: /\.json$/.test(filename) ? await b.text() : '' }); } } : null }; };
const hash = () => { const c = document.querySelector('#mini16 canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i++) h = (h * 31 + d[i]) | 0; return h; };
const frames = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(SRC, 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch(); const errors = [];
  const watch = p => { p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.addInitScript(mockDl);
    const p = await ctx.newPage(); watch(p); const cdp = await ctx.newCDPSession(p);
    const touch = (pts, type) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q.x, y: q.y, id: i, radiusX: 4, radiusY: 4, force: 1 })) });
    const ready = () => p.waitForFunction(() => window.__im && document.querySelector('#mainCv').width > 0);
    await p.goto(url); await ready();

    console.log('IME composition (注音)');
    await p.fill('#txt', '記帳'); await p.focus('#txt'); await p.evaluate(() => document.querySelector('#txt').setSelectionRange(2, 2));
    for (const s of ['ㄅ', 'ㄅㄣ', 'ㄅㄣˇ']) await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    const mid = await p.inputValue('#txt');
    await cdp.send('Input.insertText', { text: '本' });
    await p.waitForFunction(() => __im.S.text === '記帳本', null, { timeout: 5000 }).catch(() => {});
    t('composing a 3rd char is not cut while composing', mid === '記帳ㄅㄣˇ', mid);
    t('committed 3rd char kept: 記帳本', (await p.inputValue('#txt')) === '記帳本' && (await p.evaluate(() => __im.S.text)) === '記帳本', await p.inputValue('#txt'));
    await p.fill('#txt', '記'); await p.focus('#txt');
    for (const s of ['ㄓ', 'ㄓㄤ', 'ㄓㄤˋ']) await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    t('preview text not changed by an uncommitted syllable', (await p.evaluate(() => __im.S.text)) === '記');
    await cdp.send('Input.insertText', { text: '帳' }); await p.waitForFunction(() => __im.S.text === '記帳', null, { timeout: 5000 }).catch(() => {});
    t('記 + 帳 via IME = 記帳', (await p.inputValue('#txt')) === '記帳');
    await p.fill('#txt', 'ABCD'); t('typed (non-IME) 4th char still cut to 3', (await p.inputValue('#txt')) === 'ABC');

    console.log('Saving');
    await p.fill('#txt', '快'); await p.reload(); await ready();
    t('setting typed right before reload is kept (pagehide flush)', (await p.evaluate(() => __im.S.text)) === '快');
    const png = Buffer.from(await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 200, 200); x.fillStyle = '#0000ff'; x.fillRect(200, 0, 200, 200); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
    await p.click('#tabImg'); await p.setInputFiles('#imgFile', { name: 'wide.png', mimeType: 'image/png', buffer: png });
    await p.waitForFunction(() => __im.userImg && /已存在/.test(document.querySelector('#imgNote').textContent), null, { timeout: 15000 });
    const px = () => p.evaluate(() => { const c = __im.renderMaster(); const g = (a, b) => [...c.getContext('2d').getImageData(a, b, 1, 1).data].slice(0, 3).join(); return [g(300, 512), g(724, 512)]; });
    const before = await px(); await p.reload(); await ready();
    await p.waitForFunction(() => !!__im.userImg, null, { timeout: 10000 }).catch(() => {});
    const after = await px();
    t('picked image survives reload (IndexedDB)', before[0] === '255,0,0' && before[1] === '0,0,255' && after.join('|') === before.join('|'), { before, after });
    t('file name shown again after reload', (await p.textContent('#imgName')) === 'wide.png' && (await p.evaluate(() => __im.S.tab)) === 'image');
    await p.click('#tabText');

    console.log('Damaged storage');
    for (const v of ['{"bg1":null,"fg":5,"shape":"star","sizes":null,"scale":"x"}', '{', '[]']) {
      const n0 = errors.length; await p.evaluate(v => localStorage.setItem('icon-maker:v1:current', v), v); await p.reload(); await ready();
      const S = await p.evaluate(() => ({ bg1: __im.S.bg1, fg: __im.S.fg, shape: __im.S.shape, scale: __im.S.scale, s16: __im.S.sizes['16'] }));
      t('bad current ' + v.slice(0, 16) + ' -> defaults, no error', errors.length === n0 && S.bg1 === '#0B6B57' && S.fg === '#FFFFFF' && S.shape === 'rounded' && S.scale === 62 && S.s16 === 1, S);
    }
    { const n0 = errors.length; await p.evaluate(() => localStorage.setItem('icon-maker:v1:saved', '[{"conf":null},5,{"conf":{"text":"OK","bg1":"red","name":"好"}}]'));
      await p.click('#savedBtn'); await p.waitForSelector('#savedList');
      t('bad saved items skipped, valid one listed', errors.length === n0 && (await p.locator('#savedList .it').count()) === 1, errors.slice(n0));
      await p.click('#ovClose'); await p.evaluate(() => localStorage.removeItem('icon-maker:v1:saved')); }

    console.log('My icons: undo, backup, cache');
    await p.fill('#txt', 'B1'); await p.click('#savedBtn'); await p.click('#saveCur');
    await p.click('#ovClose'); await p.fill('#txt', 'B2'); await p.click('#savedBtn'); await p.click('#saveCur');
    const names = () => p.evaluate(() => JSON.parse(localStorage.getItem('icon-maker:v1:saved')).map(i => i.conf.text).join());
    t('two saved', (await names()) === 'B2,B1');
    await p.evaluate(() => { document.querySelector('#savedList .it canvas').__mark = 1; });
    await p.click('#ovClose'); await p.click('#savedBtn');
    t('thumbnails reused from cache on reopen', await p.evaluate(() => document.querySelector('#savedList .it canvas').__mark === 1));
    await p.click('#savedList .it:nth-child(1) .x'); await p.click('#savedList .it:nth-child(1) .x');
    t('delete needs 2 taps, then removed', (await names()) === 'B1');
    t('undo offered in toast', await p.isVisible('#toast button'));
    await p.click('#toast button');
    t('undo restores item at same place', (await names()) === 'B2,B1' && (await p.locator('#savedList .it').count()) === 2);
    await p.click('#expSaved'); await p.waitForFunction(() => __saved.some(s => /\.json$/.test(s.filename)));
    const bk = await p.evaluate(() => __saved.find(s => /\.json$/.test(s.filename)).text);
    t('export writes JSON backup with both icons', JSON.parse(bk).saved.length === 2 && JSON.parse(bk).app === 'icon-maker');
    await p.evaluate(() => localStorage.removeItem('icon-maker:v1:saved'));
    await p.click('#ovClose'); await p.click('#savedBtn');
    await p.setInputFiles('#impFile', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(bk) });
    await p.waitForFunction(() => document.querySelectorAll('#savedList .it').length === 2, null, { timeout: 5000 }).catch(() => {});
    t('import restores the backup', (await names()) === 'B2,B1');
    await p.evaluate(b => __im.importSaved(b), bk); t('re-import adds no duplicates', (await names()) === 'B2,B1');
    await p.evaluate(() => __im.importSaved('{oops')); t('broken backup file -> clear message', /JSON/.test(await p.textContent('#toast')));
    await p.click('#ovClose');

    console.log('Layout: sticky preview, ZIP near preview');
    await p.evaluate(() => scrollTo(0, 0)); await p.fill('#txt', 'A');
    const z = await p.evaluate(() => { const b = document.querySelector('#zipBtn2').getBoundingClientRect(); return b.bottom <= innerHeight && b.width >= 44 && b.height >= 44; });
    t('download ZIP button in the first screen', z);
    await p.evaluate(() => document.querySelector('#pad').scrollIntoView({ block: 'center' })); await frames(p);
    const vis = await p.evaluate(() => { const m = document.querySelector('#mainpv').getBoundingClientRect(), s = document.querySelector('#pad').getBoundingClientRect(); return { m: [m.top, m.bottom], s: s.top, ok: m.top >= 0 && m.bottom <= s.top && m.bottom > 100 }; });
    t('preview stays visible while editing 內距', vis.ok, vis);
    await p.click('#zipBtn2'); await p.waitForFunction(() => __saved.some(s => s.filename === 'icons.zip'), null, { timeout: 30000 });
    t('ZIP from the preview card downloads', true);
    const mini = await p.evaluate(() => [...document.querySelectorAll('.mini')].map(b => Math.round(b.getBoundingClientRect().bottom)));
    t('5 small previews on one row at 390', new Set(mini).size === 1, mini);
    t('emoji category chips wrap (no hidden sideways scroll)', await p.evaluate(() => { const c = document.querySelector('#cats'); return c.scrollWidth <= c.clientWidth + 1; }));

    console.log('Gestures on the preview');
    await p.evaluate(() => { scrollTo(0, 0); __im.S.ox = __im.S.oy = 0; __im.changed(); }); await frames(p);
    const c = await p.evaluate(() => { const r = document.querySelector('#mainpv').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const h0 = await p.evaluate(hash);
    await touch([c], 'touchStart'); for (let i = 1; i <= 8; i++) await touch([{ x: c.x + 4 * i, y: c.y - 1 * i }], 'touchMove');
    await frames(p);
    const mid2 = await p.evaluate(h => ({ ox: __im.S.ox, same: h === (() => { const cv = document.querySelector('#mini16 canvas'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let k = 0; for (let i = 0; i < d.length; i++) k = (k * 31 + d[i]) | 0; return k; })() }), h0);
    await touch([], 'touchEnd'); await frames(p);
    t('sideways drag moves content', mid2.ox > 0.1, mid2);
    t('small previews wait while dragging (only big preview redraws)', mid2.same);
    t('small previews update when the finger lifts', (await p.evaluate(hash)) !== h0);
    await p.click('#resetPos'); await p.evaluate(() => scrollTo(0, 0)); await frames(p);
    await touch([{ x: c.x, y: c.y + 40 }], 'touchStart'); for (let i = 1; i <= 10; i++) await touch([{ x: c.x, y: c.y + 40 - 15 * i }], 'touchMove');
    await touch([], 'touchEnd'); await p.waitForFunction(() => scrollY > 20, null, { timeout: 3000 }).catch(() => {});
    const sw = await p.evaluate(() => ({ y: scrollY, ox: __im.S.ox, oy: __im.S.oy }));
    t('vertical swipe on preview scrolls the page, content not moved', sw.y > 20 && sw.ox === 0 && sw.oy === 0, sw);
    await p.evaluate(() => scrollTo(0, 0)); await frames(p);
    await touch([{ x: c.x - 15, y: c.y }, { x: c.x + 15, y: c.y }], 'touchStart');
    for (let i = 1; i <= 6; i++) await touch([{ x: c.x - 15 - 4 * i, y: c.y }, { x: c.x + 15 + 4 * i, y: c.y }], 'touchMove');
    await touch([], 'touchEnd'); await frames(p);
    t('pinch zooms', (await p.evaluate(() => __im.S.zoom)) > 1.3, await p.evaluate(() => __im.S.zoom));
    await p.click('#resetPos');

    console.log('Output details');
    const ctr = await p.evaluate(() => { const S = __im.S, keep = Object.assign({}, S); Object.assign(S, { tab: 'text', text: 'A', shape: 'none', ox: 0, oy: 0, zoom: 1, dy: 0, shadow: false });
      const d = __im.renderMaster().getContext('2d').getImageData(0, 0, 1024, 1024).data; let a = 1e9, b = -1; for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (d[(y * 1024 + x) * 4 + 3] > 128) { if (y < a) a = y; b = y; }
      Object.assign(S, keep); return (a + b) / 2; });
    t('"A" is vertically centred (within 1%)', Math.abs(ctr - 512) < 10, ctr);
    await p.evaluate(() => { __im.S.name = 'A😀😀😀😀😀😀😀😀😀😀😀😀'; });
    const sn = JSON.parse(await p.evaluate(() => __im.manifest())).short_name;
    t('short_name cut by characters (no lone surrogate)', sn === 'A😀😀😀😀😀😀😀😀😀😀😀', sn);
    await p.evaluate(() => { __im.S.name = '範例 App'; });
    for (const k of ['192', '512', 'm512']) await p.uncheck('#sz' + k);
    t('no manifest icons -> snippet has no manifest link', !(await p.evaluate(() => __im.snippet())).includes('manifest'));
    t('no manifest icons -> warning shown', await p.isVisible('#outWarn') && /webmanifest/.test(await p.textContent('#outWarn')));
    const n0 = await p.evaluate(() => __saved.length); await p.click('#zipBtn'); await p.waitForFunction(n => __saved.length > n, n0, { timeout: 30000 });
    const zipNames = await p.evaluate(async () => { const b = window.__lastZip; const u = new Uint8Array(await b.arrayBuffer()); const out = []; for (let i = 0; i + 30 < u.length; i++) if (u[i] === 0x50 && u[i + 1] === 0x4b && u[i + 2] === 3 && u[i + 3] === 4) { const n = u[i + 26] | u[i + 27] << 8; out.push(new TextDecoder().decode(u.slice(i + 30, i + 30 + n))); } return out; });
    t('ZIP without manifest icons leaves out site.webmanifest', !zipNames.includes('site.webmanifest') && zipNames.includes('favicon.ico'), zipNames);
    for (const k of ['192', '512', 'm512']) await p.check('#sz' + k);
    t('manifest back when 192 checked', (await p.evaluate(() => __im.snippet())).includes('site.webmanifest') && await p.isHidden('#outWarn'));
    await p.fill('#txt', ''); t('empty text -> hint shown', await p.isVisible('#emptyWarn') && await p.isVisible('#outWarn'));
    await p.fill('#txt', 'A'); t('hint gone with text', await p.isHidden('#emptyWarn'));
    const th = [await p.textContent('#themeTxt')]; await p.click('#themeBtn'); th.push(await p.textContent('#themeTxt')); await p.click('#themeBtn'); th.push(await p.textContent('#themeTxt')); await p.click('#themeBtn');
    t('theme button shows current mode', th.join() === '自動,淺色,深色', th);
    await ctx.close();

    for (const [w, h] of [[360, 640], [375, 500]]) {
      const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); const q = await c2.newPage(); watch(q);
      await q.goto(url); await q.waitForFunction(() => window.__im);
      const m = await q.evaluate(() => ({ rows: new Set([...document.querySelectorAll('.mini')].map(b => Math.round(b.getBoundingClientRect().bottom))).size, sw: document.documentElement.scrollWidth <= innerWidth,
        small: [...document.querySelectorAll('button,input,select')].filter(b => b.offsetParent && b.type !== 'checkbox' && (b.getBoundingClientRect().width < 44 || b.getBoundingClientRect().height < 44)).map(b => b.id) }));
      t(w + 'x' + h + ': no sideways scroll, minis one row, targets >= 44', m.sw && m.rows === 1 && !m.small.length, m);
      await c2.close();
    }
  } catch (e) { fail++; console.log('FAIL exception', e.message); }
  await browser.close(); srv.close();
  t('no page or console errors', !errors.length, errors);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
