// Regression tests for 圖案底紋產生器 (pattern-maker): real CDP touch (second finger resting on the preview or title,
// fast taps, slow taps, no ghost clicks), rotated-lattice accuracy, huge rotated PNG, PNG size validation, undo for
// 隨機, favourites undo / export / import / corrupt data, saving on pagehide, rings, pure-CSS dots, layout details.
// Usage: node tests.js   (waits on conditions, no fixed timing assumptions; nothing is written to disk)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + HTML + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = 'pattern-maker:v1:';

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, opts = {}) {
    const { seed, ...ctxOpts } = opts;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...ctxOpts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    page.on('request', r => { if (!r.url().startsWith(URL) && !/^(data|blob):/.test(r.url())) errors.push('request ' + r.url()); });
    if (seed) await page.addInitScript(s => { if (!sessionStorage.seeded) { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.seeded = 1; } }, seed);
    // counts clicks that reach the page (the ghost-click filter runs earlier, on window)
    await page.addInitScript(() => { window.__c = {}; document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[id]'); const k = t ? t.id : '?'; window.__c[k] = (window.__c[k] || 0) + 1; }, true); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__pm && document.querySelectorAll('.ty').length === 16);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const at = async sel => page.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    let nid = 10;
    // CDP touchEnd releases exactly the points it lists
    const tap = async (sel, hold = 40, others = []) => { const p = { ...(typeof sel === 'string' ? await at(sel) : sel), id: nid++, radiusX: 4, radiusY: 4 }; await T('touchStart', [...others, p]); await sleep(hold); await T('touchEnd', [p]); };
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
    const clicks = () => page.evaluate(() => { const c = window.__c; window.__c = {}; return c; });
    return { ctx, page, T, at, tap, settle, clicks };
  }

  // ---------- touch: second finger, fast taps, slow taps, ghost clicks ----------
  {
    const { ctx, page, T, at, tap, settle, clicks } = await open(390, 844);
    const zoom = () => page.$eval('#zOut2', e => e.textContent);
    const cssBtn = await page.$eval('#copyCss', e => e.getBoundingClientRect().toJSON());
    ok(cssBtn.bottom <= 844 && cssBtn.height >= 44, `複製 CSS is on the first screen (bottom ${cssBtn.bottom}) and ≥44 px tall`);
    const hs = await page.$$eval('label.chk, label.chip, #zOut2', es => es.map(e => [e.querySelector('input') ? e.querySelector('input').id : e.id, Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().width)]));
    ok(hs.every(([, h, w]) => h >= 44 && w >= 44), 'checkbox labels and the 100% reset are ≥44×44: ' + JSON.stringify(hs));
    ok(/重設/.test(await page.$eval('#zOut2', e => e.title)), '100% reset has a title');
    await page.evaluate(() => navigator.clipboard && (navigator.clipboard.writeText = () => Promise.resolve()));

    // one finger rests on the preview (the gesture area), another taps controls
    const pv = await page.$eval('#pv', e => { const b = e.getBoundingClientRect(); return { x: b.left + 60, y: b.top + 120 }; });
    const rest = { ...pv, id: 1, radiusX: 4, radiusY: 4 };
    await T('touchStart', [rest]); await sleep(60);
    await clicks();
    const z0 = await zoom();
    await tap('#zIn', 60, [rest]); await settle();
    ok(await zoom() === '125%' && z0 === '100%', `second finger (preview held): ＋ works once (${z0} → ${await zoom()})`);
    const typeBefore = await page.evaluate(() => window.__pm.S.type);
    await tap('#type_diag', 60, [rest]); await settle();
    ok(await page.evaluate(() => window.__pm.S.type) === 'diag' && typeBefore !== 'diag', 'second finger: type button works');
    await tap('#randBtn', 60, [rest]); await settle();
    ok(await page.evaluate(() => !!window.__pm.undo), 'second finger: 隨機 works (undo kept)');
    await tap('#copyCss', 60, [rest]); await settle();
    const nf0 = await page.evaluate(() => window.__pm.favs.length);
    // favAdd is further down: release the resting finger, scroll, rest on the title area of the panel instead
    await T('touchEnd', [rest]); await sleep(50);
    let c = await clicks();
    ok(c.zIn === 1 && c.type_diag === 1 && c.randBtn === 1 && c.copyCss === 1, 'second-finger taps counted exactly once each: ' + JSON.stringify(c));
    await page.$eval('#favAdd', e => e.scrollIntoView({ block: 'center' })); await settle();
    const h2 = await page.$eval('#favAdd', e => { const b = e.closest('.panel').getBoundingClientRect(); return { x: b.left + 20, y: b.top + 12 }; });
    const rest2 = { ...h2, id: 2, radiusX: 4, radiusY: 4 };
    await T('touchStart', [rest2]); await sleep(60);
    await tap('#favAdd', 60, [rest2]); await settle();
    await T('touchEnd', [rest2]); await sleep(50);
    ok(await page.evaluate(() => window.__pm.favs.length) === nf0 + 1, 'second finger (panel held): 收藏 works once');
    await page.evaluate(() => scrollTo(0, 0)); await settle();
    // title held, tap the checkbox label
    const title = await page.$eval('h1', e => { const b = e.getBoundingClientRect(); return { x: b.left + 40, y: b.top + b.height / 2 }; });
    const rest3 = { ...title, id: 3, radiusX: 4, radiusY: 4 };
    await T('touchStart', [rest3]); await sleep(60);
    const f0 = await page.$eval('#showFrame', e => e.checked);
    await tap('#showFrame', 60, [rest3]); await settle();
    await T('touchEnd', [rest3]); await sleep(50);
    ok(await page.$eval('#showFrame', e => e.checked) === !f0, 'second finger (title held): 顯示單元框 toggles once');
    await sleep(300); await clicks();

    // fast single taps, about 8 per second, alternating ＋ / −
    await page.tap('#zOut2'); await settle(); await clicks();
    const zi = await at('#zIn'), zo = await at('#zOut');
    for (let i = 0; i < 16; i++) { await tap(i % 2 ? zo : zi, 40); await sleep(85); }
    await sleep(400); c = await clicks();
    ok(c.zIn === 8 && c.zOut === 8 && await zoom() === '100%', `16 fast taps → 8 ＋ / 8 − exactly (${JSON.stringify(c)}, ${await zoom()})`);
    // slow taps (held 0.6 s and 1 s) count once, on a button and on a checkbox label
    for (const hold of [600, 1000]) {
      const zb = await zoom(); await tap('#zIn', hold); await settle(); await sleep(250); c = await clicks();
      ok(c.zIn === 1 && await zoom() !== zb, `slow tap ${hold} ms on ＋ counts once (${JSON.stringify(c)})`);
    }
    await page.$eval('#bgT', e => e.scrollIntoView({ block: 'center' })); await settle();
    for (const hold of [40, 600, 1000]) {
      const b0 = await page.evaluate(() => window.__pm.S.bgT); await tap('label.chk:has(#bgT)', hold); await settle(); await sleep(250);
      ok(await page.evaluate(() => window.__pm.S.bgT) === !b0, `tap ${hold} ms on 透明 toggles exactly once`);
    }
    // a tap that drags off the button does nothing
    await page.evaluate(() => scrollTo(0, 0)); await settle(); const zq = await at('#zIn');
    const zb2 = await zoom(); const id = 90; await T('touchStart', [{ ...zq, id }]); await sleep(30); await T('touchMove', [{ x: zq.x - 40, y: zq.y, id }]); await sleep(30); await T('touchEnd', [{ x: zq.x - 40, y: zq.y, id }]); await settle();
    ok(await zoom() === zb2, 'a finger that slides off ＋ does not press it');
    // favourites: × with touch deletes, toast 復原 brings it back
    await page.$eval('#favEdit', e => e.scrollIntoView({ block: 'center' })); await settle();
    await tap('#favEdit'); await settle();
    const nfa = await page.evaluate(() => window.__pm.favs.length);
    await tap('#fav0 .x'); await settle();
    ok(await page.evaluate(() => window.__pm.favs.length) === nfa - 1 && await page.isVisible('#toastAct'), 'fav × deletes and offers 復原');
    await tap('#toastAct'); await settle();
    ok(await page.evaluate(() => window.__pm.favs.length) === nfa && await page.evaluate(() => JSON.parse(localStorage.getItem('pattern-maker:v1:favorites')).length) === nfa, 'toast 復原 restores the deleted favourite (saved)');
    await ctx.close();
  }

  // ---------- rotated lattice accuracy ----------
  {
    const { ctx, page } = await open(390, 844);
    const r = await page.evaluate(() => { const pm = window.__pm; const wrap = d => { d = ((d % 360) + 540) % 360 - 180; return Math.abs(d); };
      let n = 0, hidden = 0, maxSide = 0; const bad = [];
      for (const w of [8, 24, 48, 60, 120, 200]) for (const s of [0.25, 1, 4]) for (let a = 1; a < 180; a += (w > 60 ? 2 : 1)) {
        const L = pm.fitLattice(w, w, s, a); const [A, B, C, D] = L.m; n++; maxSide = Math.max(maxSide, L.X, L.Y);
        const ax = wrap(Math.atan2(B, A) * 180 / Math.PI - a), ay = wrap(Math.atan2(-C, D) * 180 / Math.PI - a), e = Math.max(ax, ay);
        const sc = Math.max(Math.abs(Math.hypot(A, B) / s - 1), Math.abs(Math.hypot(C, D) / s - 1));
        if (Math.abs(e - L.err) > 1e-6) hidden++;              // the reported error must be the real one
        if ((e > 0.2 && L.err <= 0.2) || sc > 0.02) bad.push([w, s, a, +e.toFixed(3), +sc.toFixed(4)]); }
      const small = [1, 89, 91, 179].map(a => { const L = pm.fitLattice(48, 48, 1, a); return [a, +L.err.toFixed(3), L.X]; });
      return { n, hidden, bad: bad.slice(0, 5), nbad: bad.length, maxSide, small }; });
    ok(r.nbad === 0, `lattice: every fit is within 0.2° (or reports its real angle) and scale within 2% (${r.n} fits, bad ${JSON.stringify(r.bad)})`);
    ok(r.hidden === 0, 'lattice: reported error matches the measured one');
    ok(r.maxSide <= 4096, 'rotated tile capped at 4096 px: ' + r.maxSide);
    ok(r.small.every(([, e]) => e <= 0.2), 'dots 48px at 1°/89°/91°/179° rotate within 0.2°: ' + JSON.stringify(r.small));
    // UI: an angle that cannot be met within the cap says what it actually used
    await page.evaluate(() => { const s = window.__pm.S; s.type = 'dots'; s.params.dots.size = 200; s.scale = 400; s.angle = 2; window.__pm.S = s; }); await page.waitForFunction(() => /實際/.test(document.getElementById('tileInfo').textContent));
    ok(/實際旋轉約/.test(await page.textContent('#tileInfo')) && !await page.isHidden('#pWarn'), 'large tile at 2° shows the actual angle and a warning: ' + await page.textContent('#tileInfo'));
    await page.evaluate(() => { const s = window.__pm.S; s.params.dots.size = 48; s.scale = 100; s.angle = 1; window.__pm.S = s; }); await page.waitForFunction(() => /已旋轉/.test(document.getElementById('tileInfo').textContent));
    ok(true, '48px dots at 1° are periodic without approximation');

    // huge rotated tile at 2×: PNG is not blank (was 0% foreground)
    const cov = await page.evaluate(async () => { const s = window.__pm.S; s.type = 'dots'; s.params.dots = { size: 200, r: 100 * 0.3 }; s.scale = 400; s.angle = 20; s.bgT = false; s.opacity = 100; window.__pm.S = s; window.__pm.draw();
      const t = window.__pm.buildTile({ k: 2 });
      document.getElementById('pngSize').value = '1920x1080'; const out = {}; for (const k2 of [false, true]) { document.getElementById('png2x').checked = k2;
        const c = await window.__pm.makePNG(); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let fg = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 97) { n++; if (Math.abs(d[i] - 0x1d) < 30 && Math.abs(d[i + 1] - 0x5a) < 30 && Math.abs(d[i + 2] - 0x48) < 30) fg++; }
        out[k2 ? 'x2' : 'x1'] = fg / n; out[k2 ? 'w2' : 'w1'] = c.width; }
      out.tile = t.w; return out; });
    ok(cov.x2 > 0.05 && Math.abs(cov.x2 - cov.x1) < 0.03 && cov.w2 === 3840, `huge rotated tile (${cov.tile}px at 2×) PNG has foreground like 1× (${(cov.x1 * 100).toFixed(1)}% vs ${(cov.x2 * 100).toFixed(1)}%)`);
    await page.evaluate(() => { document.getElementById('png2x').checked = false; });

    // custom PNG size validation
    await page.selectOption('#pngSize', 'custom'); await page.waitForFunction(() => !document.getElementById('customRow').hidden);
    for (const [w, h] of [['0', '800'], ['-5', '800'], ['', '800'], ['12.5', '800'], ['1200', '9000']]) {
      await page.fill('#pngW', w); await page.fill('#pngH', h);
      const r2 = await page.evaluate(async () => { try { const c = await window.__pm.makePNG(); return c.width + 'x' + c.height; } catch (e) { return 'refused'; } });
      ok(r2 === 'refused' && await page.isVisible('#pngErr'), `custom PNG ${JSON.stringify(w)}×${h} refused with a message`);
    }
    await page.fill('#pngW', '300'); await page.fill('#pngH', '200');
    ok(await page.evaluate(async () => { const c = await window.__pm.makePNG(); return c.width === 300 && c.height === 200; }) && await page.isHidden('#pngErr'), 'custom PNG 300×200 accepted, message cleared');

    // rings: line wider than ring spacing → inner rings drawn as discs, warning shown
    await page.evaluate(() => { const s = window.__pm.S; s.type = 'rings'; s.params.rings = { size: 200, n: 12, width: 20 }; s.angle = 0; s.scale = 100; window.__pm.S = s; }); await page.waitForFunction(() => !document.getElementById('pWarn').hidden);
    const rg = await page.evaluate(() => { const g = window.__pm.gen('rings', { size: 200, n: 12, width: 20 }, '#000'); return { neg: /r='-/.test(g.body), disc: (g.body.match(/fill='#000'/g) || []).length }; });
    ok(!rg.neg && rg.disc >= 1 && /圈距/.test(await page.textContent('#pWarn')), 'rings: no negative radius, inner ring is a disc, spacing warning: ' + JSON.stringify(rg));

    // pure CSS dots match the SVG size (gradient centred on r)
    await page.evaluate(() => { const s = window.__pm.S; s.type = 'dots'; s.params.dots = { size: 24, r: 4 }; s.angle = 0; s.scale = 100; s.opacity = 100; window.__pm.S = s; });
    ok((await page.evaluate(() => window.__pm.pureCSS())).includes('3.75px, transparent 4.25px'), 'pure CSS dot edge runs r−0.25 → r+0.25');

    // clipboard blocked: SVG lands in the output box and the label says SVG
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) }, configurable: true }); });
    await page.$eval('#copySvg', e => e.scrollIntoView({ block: 'center' })); await page.click('#copySvg');
    await page.waitForFunction(() => /SVG/.test(document.getElementById('outKind').textContent));
    ok((await page.textContent('#cssOut')).startsWith('<svg'), 'clipboard blocked: SVG shown in the output box labelled SVG');
    await ctx.close();
  }

  // ---------- data: undo for 隨機, save on pagehide, corrupt storage, export/import ----------
  {
    const { ctx, page, settle } = await open(390, 844);
    const before = await page.evaluate(() => JSON.stringify(window.__pm.S));
    await page.click('#randBtn'); await settle();
    ok(await page.isVisible('#undoBtn') && await page.isVisible('#toastAct'), '隨機 shows 復原 (preview button and toast)');
    const after = await page.evaluate(() => JSON.stringify(window.__pm.S));
    await page.reload(); await page.waitForFunction(() => window.__pm);
    ok(await page.evaluate(() => JSON.stringify(window.__pm.S)) === after && await page.isVisible('#undoBtn'), 'random result and its undo survive a reload');
    await page.click('#undoBtn'); await settle();
    ok(await page.evaluate(() => JSON.stringify(window.__pm.S)) === before, '復原 after reload restores the pattern from before 隨機');
    ok(/重做/.test(await page.textContent('#undoBtn')), 'button turns into 重做');
    await page.click('#undoBtn'); await settle();
    ok(await page.evaluate(() => JSON.stringify(window.__pm.S)) === after, '重做 brings the random pattern back');

    // a slider change is saved even when the page is reloaded right away
    await page.$eval('#c_opacity', e => { e.value = 37; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.reload(); await page.waitForFunction(() => window.__pm);
    ok(await page.evaluate(() => window.__pm.S.opacity) === 37, 'change saved on pagehide (reload within the debounce)');

    // export → import round trip
    await page.evaluate(() => { localStorage.setItem('pattern-maker:v1:favorites', JSON.stringify([{ type: 'hex', params: { r: 20, stroke: 3 }, colors: { fg: '#112233', bg: '#ffeedd', bgT: false, fg2: '#445566', use2: true }, seed: null, angle: 30, scale: 100, opacity: 100 }, { type: 'random', params: { size: 80, n: 10, r: 3, seed: 5 }, colors: { fg: '#000000', bg: '#ffffff', bgT: true, fg2: '#ff0000', use2: false }, seed: 5, angle: 0, scale: 150, opacity: 80 }])); });
    await page.reload(); await page.waitForFunction(() => window.__pm);
    await page.$eval('#favExport', e => e.scrollIntoView({ block: 'center' })); await page.click('#favExport'); await page.waitForSelector('#fio:not([hidden])');
    const exported = await page.inputValue('#fioText'); await page.click('#fioClose');
    await page.evaluate(() => localStorage.removeItem('pattern-maker:v1:favorites')); await page.reload(); await page.waitForFunction(() => window.__pm);
    ok(await page.locator('.fav').count() === 0, 'favourites cleared');
    await page.click('#favImport'); await page.fill('#fioText', '{not json'); await page.click('#fioGo');
    ok(await page.isVisible('#fioErr') && /JSON/.test(await page.textContent('#fioErr')), 'bad import text is refused with a message');
    await page.fill('#fioText', exported); await page.click('#fioGo'); await settle();
    ok(await page.locator('.fav').count() === 2 && await page.isHidden('#fio'), 'import restores the 2 exported favourites');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('pattern-maker:v1:favorites')).length) === 2, 'imported favourites are saved');
    await page.click('#favImport'); await page.fill('#fioText', exported); await page.click('#fioGo');
    ok(/已經/.test(await page.textContent('#fioErr')), 'importing the same backup again skips duplicates');
    await page.click('#fioClose');
    await page.click('#fav1'); await settle();
    ok(await page.evaluate(() => window.__pm.S.type === 'random' && window.__pm.S.params.random.seed === 5 && window.__pm.S.opacity === 80), 'loading an imported favourite restores it (seed, opacity)');
    await ctx.close();
  }
  {
    // corrupt storage: unknown types, null, strings for numbers → no crash, values clamped
    const seed = { [K + 'favorites']: JSON.stringify([null, { type: 'nope', params: {} }, 'x', { type: 'dots', params: { size: 'abc', r: null }, colors: 5 }]),
      [K + 'current']: JSON.stringify({ type: 'dots', params: { dots: { size: '9999', r: null }, random: { seed: 'zz' } }, angle: 'x', scale: null, opacity: '50', fg: 7 }),
      [K + 'undo']: '"junk"' };
    const { ctx, page } = await open(390, 844, { seed });
    ok(await page.locator('.fav').count() === 1, 'corrupt favourites: invalid entries skipped, valid one shown');
    const st = await page.evaluate(() => window.__pm.S);
    ok(st.params.dots.size === 200 && st.params.dots.r === 4 && st.angle === 0 && st.scale === 100 && st.opacity === 50 && st.fg === '#1d5a48' && st.params.random.seed === 20261013, 'corrupt state clamped to slider ranges / defaults: ' + JSON.stringify([st.params.dots, st.angle, st.scale, st.opacity]));
    ok(!/NaN/.test(await page.textContent('#tileInfo')) && await page.isHidden('#undoBtn'), 'no NaN in tile info, junk undo ignored');
    await page.click('#fav0'); ok(await page.evaluate(() => window.__pm.S.params.dots.size === 24), 'corrupt favourite loads with defaults');
    await ctx.close();
  }

  // ---------- layout details ----------
  {
    const { ctx, page } = await open(430, 932, { colorScheme: 'dark' });
    ok(await page.$eval('#types', e => e.classList.contains('more-r')), '430 wide: type row fades on the right (more to scroll)');
    await page.$eval('#types', e => { e.scrollLeft = e.scrollWidth; }); await page.waitForFunction(() => { const e = document.getElementById('types'); return e.classList.contains('more-l') && !e.classList.contains('more-r'); });
    ok(true, 'scrolled to the end: fade moves to the left');
    ok(/d3e2db/i.test(await page.$eval('.ty i', e => decodeURIComponent(getComputedStyle(e).backgroundImage))), 'dark mode: type thumbnails use the lighter foreground');
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at 430');
    await ctx.close();
    for (const [w, h] of [[360, 640], [844, 390]]) {
      const o = await open(w, h);
      const r = await o.page.evaluate(() => { const a = document.getElementById('copyCss').getBoundingClientRect(), b = document.getElementById('undoBtn').getBoundingClientRect(), t = document.getElementById('sampleTag').getBoundingClientRect();
        return { noScroll: document.documentElement.scrollWidth <= innerWidth, cssOnScreen: a.bottom <= innerHeight, tagClear: t.right <= a.left }; });
      ok(r.noScroll && r.cssOnScreen && r.tagClear, `${w}x${h}: no h-scroll, 複製 CSS on screen, tag clear of it ` + JSON.stringify(r));
      await o.ctx.close();
    }
  }

  // ---------- round 2: native fields by touch, resting thumb, multi-level undo, CSS-rotated drag preview, PNG cells, toast ----------
  {
    const { ctx, page, T, at, tap, settle, clicks } = await open(390, 844);
    await page.evaluate(() => { window.__pk = {}; const n = el => window.__pk[el.id] = (window.__pk[el.id] || 0) + 1;
      HTMLInputElement.prototype.showPicker = function () { n(this); }; HTMLSelectElement.prototype.showPicker = function () { n(this); };
      document.addEventListener('focusin', e => { if (e.target.matches('input[type=number]')) n(e.target); });
      const s = window.__pm.S; s.type = 'random'; s.use2 = true; window.__pm.S = s; });
    await page.selectOption('#pngSize', 'custom'); await page.evaluate(() => document.activeElement.blur()); await settle();
    const pk = () => page.evaluate(() => { const c = window.__pk; window.__pk = {}; return c; });
    const ids = ['fg', 'bg', 'fg2', 'pngSize', 'seed', 'pngW', 'pngH'];
    for (const second of [true, false]) {
      await pk(); await clicks();
      for (const id of ids) {
        await page.$eval('#' + id, e => e.scrollIntoView({ block: 'center' })); await page.evaluate(() => document.activeElement && document.activeElement.blur()); await settle();
        const rest = { x: 3, y: 400, id: 5, radiusX: 4, radiusY: 4 };
        if (second) { await T('touchStart', [rest]); await sleep(40); }
        await tap('#' + id, 50, second ? [rest] : []); await settle();
        if (second) await T('touchEnd', [rest]);
        await sleep(60);
      }
      await sleep(300); const got = await pk(), c = await clicks();
      ok(ids.every(id => got[id] === 1) && ids.every(id => !c[id]), `${second ? 'second finger' : 'single finger'}: colour/select pickers and number fields open exactly once (${JSON.stringify(got)}, native clicks ${JSON.stringify(c)})`);
    }
    // a thumb resting on 圓點 while another finger taps ＋ does not switch type when it lifts
    await page.evaluate(() => { scrollTo(0, 0); const s = window.__pm.S; s.type = 'diag'; window.__pm.S = s; }); await settle();
    const th = { ...(await at('#type_dots')), id: 6, radiusX: 4, radiusY: 4 }, z0 = await page.$eval('#zOut2', e => e.textContent);
    await T('touchStart', [th]); await sleep(60); await tap('#zIn', 50, [th]); await sleep(60); await T('touchEnd', [th]); await settle();
    ok(await page.evaluate(() => window.__pm.S.type) === 'diag' && await page.$eval('#zOut2', e => e.textContent) !== z0, 'resting thumb on 圓點 does not fire after another finger tapped ＋');
    // overlapping quick taps with two fingers (A down, B down, A up, B up) both count
    await clicks(); const A = { ...(await at('#zIn')), id: 7 }, B = { ...(await at('#zOut')), id: 8 };
    await T('touchStart', [A]); await sleep(30); await T('touchStart', [A, B]); await sleep(30); await T('touchEnd', [A]); await sleep(30); await T('touchEnd', [B]); await sleep(300);
    const oc = await clicks(); ok(oc.zIn === 1 && oc.zOut === 1, 'overlapping two-finger taps both count: ' + JSON.stringify(oc));
    // toast: only its button takes taps
    await page.click('#randBtn'); await settle();
    const thru = await page.$eval('#toastMsg', e => { const b = e.getBoundingClientRect(), u = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !document.getElementById('toast').contains(u); });
    ok(thru && await page.$eval('#toastAct', e => getComputedStyle(e).pointerEvents) === 'auto', 'action toast lets taps through except on its button');
    // multi-level undo, kept across reload
    await page.evaluate(() => { localStorage.removeItem('pattern-maker:v1:undo'); }); await page.reload(); await page.waitForFunction(() => window.__pm);
    const st0 = await page.evaluate(() => JSON.stringify(window.__pm.S)); const seen = [st0];
    for (let i = 0; i < 4; i++) { await page.click('#randBtn'); await settle(); seen.push(await page.evaluate(() => JSON.stringify(window.__pm.S))); }
    await page.reload(); await page.waitForFunction(() => window.__pm);
    let back = true; for (let i = 3; i >= 0; i--) { await page.click('#undoBtn'); await settle(); back = back && await page.evaluate(() => JSON.stringify(window.__pm.S)) === seen[i]; }
    ok(back && await page.evaluate(() => window.__pm.undo.u.length === 0 && window.__pm.undo.r.length === 4), 'four 隨機 in a row undo step by step back to the own pattern after a reload');
    await page.evaluate(() => window.__pm.doRedo()); ok(await page.evaluate(() => JSON.stringify(window.__pm.S)) === seen[1], 'redo steps forward');
    ok(await page.evaluate(() => { for (let i = 0; i < 15; i++) document.getElementById('randBtn').click(); return window.__pm.undo.u.length; }) === 10, 'undo history keeps 10 steps');
    // dragging a slider on a rotated pattern: CSS-rotated unrotated tile; exact tile again on release
    await page.evaluate(() => { const s = window.__pm.S; s.type = 'random'; s.params.random = { size: 200, n: 200, r: 3, seed: 1 }; s.scale = 400; s.angle = 10; window.__pm.S = s; }); await settle();
    await page.$eval('#c_angle', e => { e.value = 20; e.dispatchEvent(new Event('input', { bubbles: true })); }); await settle();
    const q = await page.$eval('#pvFill', e => ({ quick: e.dataset.quick, tr: e.style.transform, rot: /patternTransform/.test(decodeURIComponent(e.style.backgroundImage)), size: e.style.backgroundSize }));
    ok(q.quick === '1' && /rotate\(20deg\)/.test(q.tr) && !q.rot && q.size === '800px 800px', 'drag: preview rotates the plain 800px tile with CSS: ' + JSON.stringify(q));
    await page.$eval('#c_angle', e => e.dispatchEvent(new Event('change', { bubbles: true }))); await settle();
    const q2 = await page.$eval('#pvFill', e => ({ quick: e.dataset.quick, tr: e.style.transform, rot: /patternTransform/.test(decodeURIComponent(e.style.backgroundImage)) }));
    ok(!q2.quick && !q2.tr && q2.rot, 'release: exact rotated tile drawn again');
    // non-integer cell (hex 27.71 px): the unit PNG holds whole cells instead of stretching one
    const hx = await page.evaluate(async () => { const s = window.__pm.S; s.type = 'hex'; s.params.hex = { r: 16, stroke: 2 }; s.angle = 0; s.scale = 100; window.__pm.S = s; window.__pm.draw();
      document.getElementById('pngSize').value = 'unit'; document.getElementById('png2x').checked = false; const c = await window.__pm.makePNG(); return { w: c.width, h: c.height, note: c.dataset.note }; });
    ok(Math.abs(hx.w - 7 * 16 * Math.sqrt(3)) < 0.05 && hx.h === 336 && /不是整數/.test(hx.note), 'hex 27.71 px: unit PNG is 7×7 cells (' + hx.w + '×' + hx.h + ') with a note');
    await ctx.close();
  }

  ok(errors.length === 0, 'no page/console errors or requests: ' + errors.slice(0, 5).join(' | '));
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} pattern-maker ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
