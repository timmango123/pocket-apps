// Regression tests for 照片拼貼 (photo-collage): photos and placement survive a reload (IndexedDB + localStorage), real CDP
// touch (second finger resting on the margin or on the preview, fast / 0.6 s / 1 s taps, no ghost clicks), remove with
// undo and no remove from the thumbnail centre, flip after rotate, >9 photos, settings flush + sanitising, file errors,
// toast never blocks taps, fixed tab bar / landscape preview fit, cached blur background, iOS export width, details.
// Usage: node tests.js   (waits on conditions, no fixed-timing assertions; nothing is written to disk)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + HTML + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KS = 'photo-collage:v1:settings', KD = 'photo-collage:v1:doc';

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const ready = page => page.waitForFunction(() => window.__pc && !window.__pc.restoring && document.querySelectorAll('#countRow .chip').length === 9);
  async function open(w, h, opts = {}) {
    const { seed, ...ctxOpts } = opts;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...ctxOpts });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    page.on('request', r => { if (!r.url().startsWith(URL) && !/^(data|blob):/.test(r.url())) errors.push('request ' + r.url()); });
    if (seed) await page.addInitScript(s => { if (!sessionStorage.seeded) { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.seeded = 1; } }, seed);
    // counts clicks that reach the page (the ghost-click filter runs earlier, on window) and file-dialog opens
    await page.addInitScript(() => { window.__c = {}; window.__fc = 0;
      document.addEventListener('click', e => { const t = e.target.closest && e.target.closest('[id]'); const k = t ? t.id : '?'; window.__c[k] = (window.__c[k] || 0) + 1; }, true);
      const o = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__fc++; return; } return o.call(this); };
      window.__toasts = []; new MutationObserver(ms => ms.forEach(m => { m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); });
        const b = document.getElementById('busy'); if (b && (m.target === b || m.target.parentNode === b)) window.__toasts.push(b.textContent); })).observe(document, { childList: true, subtree: true, characterData: true }); });
    await page.goto(URL); await ready(page);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // scrolls the control into view first when it is off screen or under the fixed tab bar, as a user would
    const at = async sel => page.$eval(sel, e => { let b = e.getBoundingClientRect(); const tabs = document.querySelector('.tabs'), lim = getComputedStyle(tabs).position === 'fixed' && !e.closest('.tabs') ? tabs.getBoundingClientRect().top : innerHeight;
      if (b.top < 0 || b.bottom > lim) { scrollBy(0, b.top - (lim - b.height) / 2); b = e.getBoundingClientRect(); } return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    let nid = 10;
    // CDP touchEnd releases exactly the points it lists
    const tap = async (sel, hold = 40, others = []) => { const p = { ...(typeof sel === 'string' ? await at(sel) : sel), id: nid++, radiusX: 4, radiusY: 4 }; await T('touchStart', [...others, p]); await sleep(hold); await T('touchEnd', [p]); };
    const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
    const clicks = () => page.evaluate(() => { const c = window.__c; window.__c = {}; return c; });
    const toasts = () => page.evaluate(() => { const t = window.__toasts; window.__toasts = []; return t; });
    const cellPt = i => page.evaluate(i => { const r = document.getElementById('cv').getBoundingClientRect(), rc = __pc.cellRects(1080, 1080 * __pc.ratioOf(), __pc.layout().cells)[i];
      return { x: r.left + (rc.x + rc.w / 2) / 1080 * r.width, y: r.top + (rc.y + rc.h / 2) / (1080 * __pc.ratioOf()) * r.height }; }, i);
    return { ctx, page, T, at, tap, settle, clicks, toasts, cellPt };
  }
  // PNG files made in the page: [w, h, colour] or [w, h, 'quad'] (red / blue / green / yellow quadrants)
  async function pngs(page, specs) {
    const b64 = await page.evaluate(async specs => { const out = [];
      for (const [w, h, col] of specs) { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        if (col === 'quad') { [['#ff0000', 0, 0], ['#0000ff', 1, 0], ['#00ff00', 0, 1], ['#ffff00', 1, 1]].forEach(([f, i, j]) => { x.fillStyle = f; x.fillRect(i * w / 2, j * h / 2, w / 2, h / 2); }); }
        else { x.fillStyle = col; x.fillRect(0, 0, w, h); }
        const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); out.push(btoa(s)); }
      return out; }, specs);
    return b64.map((b, i) => ({ name: `p${i}.png`, mimeType: 'image/png', buffer: Buffer.from(b, 'base64') }));
  }
  const S = page => page.evaluate(() => ({ n: __pc.st.photos.length, lay: __pc.st.layoutId, sel: __pc.st.sel, ratio: __pc.st.ratio, bg: __pc.st.bg, blur: __pc.st.blurBg,
    cells: __pc.st.cells.map(c => c.pid).join(','), rot: __pc.st.cells.map(c => c.rot).join(''), tab: (document.querySelector('.tab[aria-selected=true]') || {}).id,
    ov: !document.getElementById('exportOv').hidden, browseN: __pc.st.browseN, fc: window.__fc, exp: window.__lastExport ? window.__lastExport.size : 0 }));

  // ---------- 1. photos, layout, rotation and pan survive a reload ----------
  {
    const { ctx, page, T, tap, settle, cellPt, toasts } = await open(390, 844);
    await page.setInputFiles('#fileInput', await pngs(page, [[1200, 800, '#ff0000'], [800, 1200, '#00ff00'], [1000, 1000, '#0000ff']]));
    await page.waitForFunction(() => __pc.st.photos.length === 3 && !__pc.st.photos.some(p => p.sample));
    await tap('#lay-3c'); await settle();
    await page.evaluate(() => scrollTo(0, 0)); await settle();
    await tap(await cellPt(0)); await settle();
    await tap('#cRotate'); await settle();
    // pan cell 1 with one finger
    const c1 = await cellPt(1);
    await page.evaluate(() => { const c = __pc.st.cells[1]; c.ox = 0; });
    const P = (x, y) => ({ x, y, id: 3, radiusX: 4, radiusY: 4 });
    await T('touchStart', [P(c1.x, c1.y)]);
    for (let i = 1; i <= 6; i++) await T('touchMove', [P(c1.x, c1.y - i * 8)]);
    await T('touchEnd', [P(c1.x, c1.y - 48)]);
    await settle();
    const before = await page.evaluate(() => ({ lay: __pc.st.layoutId, n: __pc.st.photos.length, cells: __pc.st.cells.map(c => ({ ...c })), dims: __pc.st.photos.map(p => p.w + 'x' + p.h) }));
    ok(before.lay === '3c' && before.cells[0].rot === 1 && Math.abs(before.cells[1].oy) > 0.01, 'setup: 3c, cell 1 rotated, cell 2 panned ' + JSON.stringify(before.cells[1]));
    await page.waitForFunction(async () => { try { const r = indexedDB.open('photo-collage'); const db = await new Promise(res => r.onsuccess = () => res(r.result)); const n = await new Promise(res => { const q = db.transaction('photos').objectStore('photos').count(); q.onsuccess = () => res(q.result); }); db.close(); return n === 3; } catch (e) { return false; } });
    await page.reload(); await ready(page);
    const after = await page.evaluate(() => ({ lay: __pc.st.layoutId, n: __pc.st.photos.length, sample: __pc.st.photos.some(p => p.sample), cells: __pc.st.cells.map(c => ({ ...c })), dims: __pc.st.photos.map(p => p.w + 'x' + p.h), banner: !document.getElementById('sampleBar').hidden }));
    const same = after.cells.every((c, i) => c.pid === before.cells[i].pid && c.rot === before.cells[i].rot && c.flip === before.cells[i].flip && Math.abs(c.ox - before.cells[i].ox) < 1e-4 && Math.abs(c.oy - before.cells[i].oy) < 1e-4 && Math.abs(c.s - before.cells[i].s) < 1e-4);
    ok(after.n === 3 && !after.sample && !after.banner && after.lay === '3c' && same && after.dims.join() === before.dims.join(), 'reload keeps photos, layout 3c, rotation and pan: ' + JSON.stringify(after.cells.map(c => [c.pid, c.rot, +c.oy.toFixed(3)])));
    // export after reload still shows the photos
    const px = await page.evaluate(async () => { const b = await __pc.exportBlob(); const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return Array.from(x.getImageData(bm.width * 0.25, bm.height / 2, 1, 1).data.slice(0, 3)); });
    ok(px[0] > 200 && px[1] < 40 && px[2] < 40, 'restored photo is drawn in the export: ' + px);

    // ---------- 2. remove: × is its own button below the thumbnail, centre tap never removes, undo restores ----------
    await tap('#tab-photos'); await settle();
    const thumb = await page.$eval('.ph', e => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; });
    const rmBox = await page.$eval('.rm', e => e.getBoundingClientRect().toJSON());
    ok(rmBox.width >= 44 && rmBox.height >= 44 && rmBox.top >= thumb.y + thumb.h / 2, `remove button is ≥44×44 (${rmBox.width}×${rmBox.height}) and below the thumbnail`);
    const hitsRm = await page.evaluate(({ x, y, w, h }) => { let n = 0; for (let dx = -w / 2 + 2; dx < w / 2; dx += 6) for (let dy = -h / 2 + 2; dy < h / 2; dy += 6) { const e = document.elementFromPoint(x + dx, y + dy); if (e && e.closest('[data-rm]')) n++; } return n; }, thumb);
    ok(hitsRm === 0, 'no point on the thumbnail hits the remove button');
    await page.evaluate(() => { __pc.st.sel = 0; }); await tap(thumb); await settle();
    ok((await S(page)).n === 3, 'tapping the thumbnail centre does not remove the photo');
    await toasts();
    const cellsBefore = (await S(page)).cells;
    await tap('.rm', 40); await settle();
    let s = await S(page);
    ok(s.n === 2, 'one tap on × 移除 removes exactly one photo (next one slid under the finger is safe): ' + s.n);
    ok((await toasts()).some(t => /已移除/.test(t) && /復原/.test(t)), 'remove shows 已移除・復原');
    await tap('.toast button'); await settle();
    s = await S(page);
    ok(s.n === 3 && s.cells === cellsBefore, 'undo puts the photo back in its cell: ' + s.cells + ' vs ' + cellsBefore);
    // clear cell + undo
    await page.evaluate(() => scrollTo(0, 0)); await settle();
    await tap(await cellPt(2)); await settle();
    await tap('#cClear'); await settle();
    ok(await page.evaluate(() => __pc.st.cells[2].pid === null), '清空 empties the cell');
    await tap('.toast button'); await settle();
    s = await S(page);
    ok(s.cells === cellsBefore, '清空 can be undone');
    await ctx.close();
  }

  // ---------- 3. touch: second finger resting, fast / slow taps, every control fires exactly once ----------
  {
    const { ctx, page, T, at, tap, settle, clicks, cellPt } = await open(390, 844);
    await page.setInputFiles('#fileInput', await pngs(page, [[600, 600, '#ff0000'], [600, 600, '#00ff00'], [600, 600, '#0000ff'], [600, 600, '#ffff00'], [600, 600, '#00ffff']]));
    await page.waitForFunction(() => __pc.st.photos.length === 5);
    await page.evaluate(() => __pc.setLayout('4a')); await settle();
    const C = [
      ['addTop', '#addTop', null, (x, y) => y.fc === x.fc + 1],
      ['ratio', '#ratio-1x1', () => page.evaluate(() => { __pc.st.ratio = '4:5'; }), (x, y) => y.ratio === '1:1'],
      ['tab', '#tab-frame', () => page.evaluate(() => document.getElementById('tab-layout').click()), (x, y) => y.tab === 'tab-frame'],
      ['count', '#cnt-3', () => page.evaluate(() => { document.getElementById('tab-layout').click(); __pc.st.browseN = 0; __pc.setLayout('4a'); }), (x, y) => y.browseN === 3],
      ['layout', '#lay-4c', () => page.evaluate(() => { document.getElementById('tab-layout').click(); __pc.setLayout('4a'); document.getElementById('cnt-4').click(); }), (x, y) => y.lay === '4c'],
      ['swatch', '#sw-4', () => page.evaluate(() => { document.getElementById('tab-bg').click(); document.getElementById('sw-0').click(); }), (x, y) => y.bg === '#000000'],
      ['checkbox', 'label[for=blurBg]', () => page.evaluate(() => document.getElementById('tab-bg').click()), (x, y) => y.blur !== x.blur],
      ['thumb', '.ph.pool', () => page.evaluate(() => { document.getElementById('tab-photos').click(); __pc.setLayout('4a'); __pc.st.sel = 1; }), (x, y) => y.cells !== x.cells],
      ['rotate', '#cRotate', () => page.evaluate(() => { scrollTo(0, 0); __pc.st.sel = 0; document.getElementById('cDone').click(); }).then(async () => { await settle(); await tap(await cellPt(0)); await settle(); }), (x, y) => y.rot !== x.rot],
      ['export', '#exportBtn', () => page.evaluate(() => { document.getElementById('exClose').click(); scrollTo(0, 0); }), (x, y) => y.ov],
      ['exGo', '#exGo', () => page.evaluate(() => { window.__lastExport = null; if (document.getElementById('exportOv').hidden) document.getElementById('exportBtn').click(); }), (x, y) => y.exp > 0],
      ['exClose', '#exClose', () => page.evaluate(() => { if (document.getElementById('exportOv').hidden) document.getElementById('exportBtn').click(); }), (x, y) => !y.ov],
    ];
    const SLOW = ['ratio', 'tab', 'checkbox', 'thumb', 'rotate', 'exClose'];
    const run = async (mode, hold) => { const bad = [];
      for (const [name, sel, prep, check] of C) { if (hold > 100 && !SLOW.includes(name)) continue;
        if (prep) await prep(); await settle();
        if (sel !== '#exGo' && sel !== '#exClose' && sel !== '#exportBtn' && sel !== '#addTop') await page.$eval(sel, e => e.scrollIntoView({ block: 'center' }));
        await settle(); const x = await S(page); await clicks();
        let rest = null;
        if (mode === 'margin') { const t = await at(sel); rest = { x: 4, y: Math.round(t.y < 400 ? t.y + 120 : t.y - 120), id: 1, radiusX: 4, radiusY: 4 }; }
        if (mode === 'canvas') { const r = await page.$eval('#cv', e => e.getBoundingClientRect().toJSON()); const y = r.top + r.height * 0.25; if (y > 0 && y < 844 && !/^#ex/.test(sel)) rest = { x: r.left + r.width * 0.25, y, id: 1, radiusX: 4, radiusY: 4 }; else continue; }
        if (rest) { await T('touchStart', [rest]); await sleep(60); }
        await tap(sel, hold, rest ? [rest] : []);
        if (sel === '#exGo') await page.waitForFunction(() => window.__lastExport, null, { timeout: 15000 }).catch(() => {});
        await settle();
        if (rest) { await T('touchEnd', [rest]); await settle(); }
        const y = await S(page), c = await clicks(), n = Object.values(c).reduce((a, b) => a + b, 0);
        if (!check(x, y) || n !== 1) bad.push(`${name}: acted=${check(x, y)} clicks=${JSON.stringify(c)}`);
      }
      ok(!bad.length, `${mode} ${hold}ms: every control fires once ${bad.join(' | ')}`); };
    await run('single', 40); await run('single', 600); await run('single', 1000);
    await run('margin', 60); await run('margin', 600); await run('canvas', 60);

    // ghost: tap the export backdrop over the ratio chips → closes, chip below untouched
    await page.evaluate(() => { scrollTo(0, 0); __pc.st.ratio = '4:5'; document.getElementById('exportBtn').click(); }); await settle();
    const chip = await page.evaluate(() => { const b = document.getElementById('ratio-1x1').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    for (const hold of [40, 600]) {
      await page.evaluate(() => { if (document.getElementById('exportOv').hidden) document.getElementById('exportBtn').click(); }); await settle();
      await tap(chip, hold); await settle(); await sleep(120);
      const y = await S(page); ok(!y.ov && y.ratio === '4:5', `backdrop tap (${hold}ms) closes the sheet without hitting the chip below`);
    }
    // a page-wide trusted click right after a tap is swallowed even when it lands on another control
    await tap('#ratio-1x1'); await page.mouse.click(5, 5).catch(() => {});
    await page.evaluate(() => { __pc.st.ratio = '4:5'; });
    // rapid alternate 8/s: 16 taps, 16 results
    await page.evaluate(() => scrollTo(0, 0)); await settle();
    const a = await at('#ratio-1x1'), b = await at('#ratio-4x5'); const seq = [];
    for (let i = 0; i < 16; i++) { await tap(i % 2 ? b : a, 30); await settle(); seq.push((await S(page)).ratio); }
    ok(seq.every((r, i) => r === (i % 2 ? '4:5' : '1:1')), 'rapid alternating ratio taps all counted: ' + seq.join(' '));
    // the toast does not catch taps: a tap through a toast still hits the control under it
    await page.evaluate(() => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = 'x'.repeat(40); document.body.appendChild(t); setTimeout(() => t.remove(), 2000); });
    const tb = await page.$eval('.toast', e => e.getBoundingClientRect().toJSON());
    const under = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && !e.closest('.toast'); }, { x: tb.left + tb.width / 2, y: tb.top + tb.height / 2 });
    ok(under && (await page.$eval('.toast', e => getComputedStyle(e).pointerEvents)) === 'none', 'toasts let taps through (pointer-events:none)');
    ok(errors.length === 0, 'no errors so far ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ---------- 4. flip after rotate mirrors left-right on screen; >9 photos; file errors; progress ----------
  {
    const { ctx, page, tap, settle, toasts, cellPt } = await open(390, 844);
    await page.setInputFiles('#fileInput', await pngs(page, [[800, 800, 'quad']]));
    await page.waitForFunction(() => __pc.st.photos.length === 1 && __pc.st.layoutId === '1a');
    await page.evaluate(() => { __pc.st.ratio = '1:1'; __pc.st.border = 0; });
    const quads = () => page.evaluate(async () => { const b = await __pc.exportBlob(); const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0);
      const name = p => { const [r, g, b2] = p; return r > 200 && g > 200 ? 'Y' : r > 200 ? 'R' : g > 200 ? 'G' : b2 > 200 ? 'B' : '?'; };
      return [[.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([u, v]) => name(x.getImageData(bm.width * u, bm.height * v, 1, 1).data)).join(''); });
    ok(await quads() === 'RBGY', 'quadrant photo exported as is');
    await tap(await cellPt(0)); await settle();
    await tap('#cRotate'); await settle();
    const rot = await quads();
    await tap('#cFlip'); await settle();
    const rf = await quads();
    const mirror = q => q[1] + q[0] + q[3] + q[2];
    ok(rot === 'GRYB' && rf === mirror(rot), `rotate then flip = left-right mirror of the rotated photo (${rot} → ${rf})`);
    await tap('#cRotate'); await settle();
    const rf2 = await quads();
    ok(rf2 === 'BRYG', `rotate while flipped still turns clockwise on screen (${rf} → ${rf2})`);
    await page.evaluate(() => { __pc.st.cells[0].rot = 0; __pc.st.cells[0].flip = false; });
    await toasts();
    // 12 photos at once → a 9-cell layout and a note about the rest
    await page.setInputFiles('#fileInput', await pngs(page, Array.from({ length: 11 }, (_, i) => [120, 90, `hsl(${i * 30},80%,50%)`])));
    await page.waitForFunction(() => __pc.st.photos.length === 12);
    const t9 = await toasts();
    ok(await page.evaluate(() => __pc.st.cells.length === 9 && __pc.st.cells.every(c => c.pid != null)), '12 photos → 9-cell layout, all filled');
    ok(t9.some(t => /3 張/.test(t) && /待用/.test(t)), 'toast says the other 3 photos wait in 照片: ' + JSON.stringify(t9));
    ok(t9.some(t => /讀取中 \d+\/11/.test(t)), 'import shows 讀取中 n/N progress');
    // non-image files are named; a broken image alone keeps the samples
    await page.setInputFiles('#fileInput', [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]);
    await page.waitForFunction(() => window.__toasts.length > 0);
    ok((await toasts()).some(t => /不是圖片：notes\.txt/.test(t)), 'a .txt file says 不是圖片：notes.txt');
    // truncated PNG is flagged
    const [full] = await pngs(page, [[300, 300, '#336699']]);
    await page.setInputFiles('#fileInput', [{ name: 'cut.png', mimeType: 'image/png', buffer: full.buffer.subarray(0, full.buffer.length - 20) }]);
    await page.waitForFunction(() => window.__toasts.some(t => /不完整|無法讀取/.test(t)), null, { timeout: 10000 });
    ok((await toasts()).some(t => /cut\.png/.test(t)), 'a truncated PNG is reported');
    await ctx.close();
    const fresh = await open(390, 844);
    await fresh.page.setInputFiles('#fileInput', [{ name: 'bad.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a jpeg at all') }]);
    await fresh.page.waitForFunction(() => window.__toasts.some(t => /無法讀取/.test(t)));
    ok(await fresh.page.evaluate(() => __pc.st.photos.length === 4 && __pc.st.photos.every(p => p.sample) && __pc.st.cells.every(c => c.pid != null)), 'only a broken file: the sample photos stay');
    await fresh.ctx.close();
  }

  // ---------- 5. settings: flushed on reload, junk values fall back; old keys still load ----------
  {
    const seed = { [KS]: JSON.stringify({ ratio: '1:1', layoutId: '3c', border: 'abc', gap: 1e9, radius: -5, bg: '#123456', blurBg: 'yes', outW: '2160', fmt: 'png' }) };
    const { ctx, page } = await open(390, 844, { seed });
    const s = await page.evaluate(() => ({ b: __pc.st.border, g: __pc.st.gap, r: __pc.st.radius, ratio: __pc.st.ratio, lay: __pc.st.layoutId, bg: __pc.st.bg, blur: __pc.st.blurBg, outW: __pc.st.outW, fmt: __pc.st.fmt, n: __pc.st.photos.length }));
    ok(s.b === 24 && s.g === 60 && s.r === 0 && s.blur === false, 'junk border/gap/radius/blur fall back or clamp: ' + JSON.stringify(s));
    ok(s.ratio === '1:1' && s.lay === '3c' && s.bg === '#123456' && s.outW === 2160 && s.fmt === 'png' && s.n === 4, 'old settings key loads; saved layout kept with the 4 samples');
    const px = await page.evaluate(async () => { const b = await __pc.exportBlob(); const bm = await createImageBitmap(b); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return Array.from(x.getImageData(bm.width / 4, bm.height / 2, 1, 1).data.slice(0, 3)); });
    ok(px.join() !== '18,52,86', 'collage still drawn (not blank background)');
    await page.evaluate(() => { const g = document.getElementById('gap'); g.value = 33; g.dispatchEvent(new Event('input')); });
    await page.reload(); await ready(page);
    ok(await page.evaluate(() => __pc.st.gap) === 33, 'a slider change right before reload is kept');
    await ctx.close();
  }

  // ---------- 6. layout: fixed tabs at 360×640, landscape preview fits, details; blur cache; iOS width ----------
  {
    const { ctx, page, tap, settle } = await open(360, 640);
    const tb = await page.$eval('#tab-bg', e => e.getBoundingClientRect().toJSON());
    ok(tb.bottom <= 640 && tb.top >= 560, 'tabs are on the first screen at 360×640 (top ' + Math.round(tb.top) + ')');
    await tap('#tab-frame'); await settle();
    const pane = await page.$eval('#pane-frame', e => e.getBoundingClientRect().toJSON());
    ok((await S(page)).tab === 'tab-frame' && pane.top < 640 - 56, 'switching tab brings the pane into view');
    const cv = await page.$eval('#cv', e => e.getBoundingClientRect().toJSON());
    ok(cv.bottom > 0, 'some of the preview is still in view while editing the frame');
    await page.evaluate(() => scrollTo(0, 0)); await settle();
    const fade = await page.$eval('#countRow', e => e.className);
    ok(/moreR/.test(fade), 'count row fades at the right edge when it scrolls');
    // free-grid label below its cells
    await page.evaluate(() => document.getElementById('tab-layout').click());
    const free = await page.$eval('#lay-free4', b => { const lab = b.querySelector('.free').getBoundingClientRect(); return [...b.querySelectorAll('i:not(.free)')].every(i => i.getBoundingClientRect().bottom <= lab.top + 0.5); });
    ok(free, '「自由」 label sits below the grid cells');
    // blur background is cached while panning
    await page.evaluate(() => { __pc.st.blurBg = true; document.getElementById('blurBg').checked = true; });
    const frame = () => page.evaluate(() => new Promise(r => { __pc.draw(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
    await frame(); const b0 = await page.evaluate(() => __pc.blurBuilds);
    for (let i = 0; i < 5; i++) { await page.evaluate(i => { __pc.st.cells[0].ox = (i % 2) * 0.02; }, i); await frame(); }
    const b1 = await page.evaluate(() => __pc.blurBuilds);
    ok(b1 - b0 <= 1, `blurred background built once, not every frame (${b1 - b0} builds for 5 redraws)`);
    await ctx.close();
    const land = await open(844, 390);
    const r = await land.page.$eval('#cv', e => e.getBoundingClientRect().toJSON());
    ok(r.bottom <= 390 && r.top >= 0, `landscape 844×390: whole preview on screen (bottom ${Math.round(r.bottom)})`);
    const ph = await land.page.evaluate(() => [...document.querySelectorAll('.tab')].map(t => { t.click(); return Math.round(document.getElementById('tab-layout').getBoundingClientRect().top); }));
    ok(new Set(ph).size === 1, 'landscape: tabs stay put when panes change ' + ph);
    ok(await land.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'landscape: no horizontal scroll');
    await land.ctx.close();
    const ios = await open(390, 844, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', seed: { [KS]: JSON.stringify({ ratio: '9:16', outW: 3240 }) } });
    await ios.page.evaluate(() => document.getElementById('exportBtn').click());
    ok(/2160 × 3840/.test(await ios.page.textContent('#exInfo')), 'iPhone: 3240 × 9:16 steps down to 2160 × 3840 and says so');
    await ios.ctx.close();
  }

  await browser.close(); srv.close();
  ok(errors.length === 0, 'no page errors, console errors or outside requests ' + JSON.stringify(errors));
  console.log(fail ? `FAIL ${fail} of ${pass + fail}` : `ALL ${pass} PASSED`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
