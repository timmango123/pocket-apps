// Tests for 圖片壓縮 (image-squeeze): one regression check per release-review finding (2026-11-07), plus basics.
// Runs the real page in Chromium over http (IndexedDB needs a real origin). Waits on conditions, never on fixed sleeps.
// Usage: node tests.js   (prints "N passed, 0 failed"; exit code 1 on failure)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const PAGE = SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>';
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const T = { timeout: 60000 };

// In-page helpers: make images with a canvas and feed them through the real drop handler.
const HELPERS = () => {
  window.__mk = async (w, h, type, opts = {}) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    if (opts.noise) { const d = x.createImageData(w, h); let s = 7; for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; d.data[i] = s & 255; d.data[i + 1] = (s >> 8) & 255; d.data[i + 2] = (s >> 16) & 255; d.data[i + 3] = 255; } x.putImageData(d, 0, 0); }
    else { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#c44'); g.addColorStop(1, '#48c'); x.fillStyle = g; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(0, 0, Math.max(1, w / 4), Math.max(1, h / 8)); }
    return new Uint8Array(await (await new Promise(r => c.toBlob(r, type, 0.9))).arrayBuffer());
  };
  window.__drop = files => { const dt = new DataTransfer(); files.forEach(f => dt.items.add(f)); document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); };
  window.__settled = () => window.__sq && !window.__sq.running && window.__sq.items.length && window.__sq.items.every(i => ['done', 'warn', 'err', 'wait'].includes(i.status) && (i.thumb || i.status === 'err'));
  window.__allDone = () => window.__sq && !window.__sq.running && window.__sq.items.every(i => ['done', 'warn', 'err'].includes(i.status));
  // orientation-6 JPEG: insert a minimal big-endian EXIF APP1 after SOI
  window.__orient6 = u8 => { const app = [0xFF, 0xE1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    const out = new Uint8Array(u8.length + app.length); out.set(u8.subarray(0, 2)); out.set(app, 2); out.set(u8.subarray(2), 2 + app.length); return out; };
};

function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE); });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const srv = await serve(), URL_ = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(HELPERS);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const ev = (f, a) => page.evaluate(f, a);
  const waitFor = (f, a) => page.waitForFunction(f, a, T);
  await page.goto(URL_);
  await waitFor(() => window.__sq && window.__sq.items.length === 3 && window.__settled());

  // ---------- pure helpers ----------
  {
    const r = await ev(async () => {
      const S = window.__sq;
      const png = await __mk(321, 123, 'image/png'), jpg = await __mk(640, 480, 'image/jpeg'), webp = await __mk(77, 55, 'image/webp');
      const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
      return { png: S.headDims(png), jpg: S.headDims(jpg), webp: S.headDims(webp), gif: S.headDims(gif), junk: S.headDims(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])),
        mimes: [S.sniffMime(png), S.sniffMime(jpg), S.sniffMime(webp), S.sniffMime(gif)],
        cap: (() => { const d = S.targetDims(9000, 9000, { sizeMode: 'none' }); return [d[0], d[1], d.capped]; })(),
        nocap: S.targetDims(4000, 3000, { sizeMode: 'long', sizeVal: 1600 }).capped,
        dims: JSON.stringify([S.targetDims(4000, 3000, { sizeMode: 'long', sizeVal: 1600 }), S.targetDims(500, 400, { sizeMode: 'width', sizeVal: 1000, upscale: true }), S.targetDims(4000, 3000, { sizeMode: 'pct', sizeVal: 50 })]),
        keyPngQ: S.setKeyOf({ fmt: 'png', quality: 10, sizeMode: 'long', sizeVal: 1600, keepOrig: true, fill: '#fff' }) === S.setKeyOf({ fmt: 'png', quality: 90, sizeMode: 'long', sizeVal: 1600, keepOrig: true, fill: '#000' }),
        keyJpgQ: S.setKeyOf({ fmt: 'jpeg', quality: 10, sizeMode: 'long', sizeVal: 1600, keepOrig: true }) === S.setKeyOf({ fmt: 'jpeg', quality: 90, sizeMode: 'long', sizeVal: 1600, keepOrig: true }),
        crc: S.crc32(new TextEncoder().encode('123456789')).toString(16) };
    });
    ok(JSON.stringify(r.png) === '[321,123]', 'PNG header dims ' + r.png);
    ok(JSON.stringify(r.jpg) === '[640,480]', 'JPEG SOF dims ' + r.jpg);
    ok(JSON.stringify(r.webp) === '[77,55]', 'WebP header dims ' + r.webp);
    ok(JSON.stringify(r.gif) === '[1,1]', 'GIF header dims');
    ok(r.junk === null, 'unknown bytes → no header dims');
    ok(r.mimes.join() === 'image/jpeg'.replace('jpeg', 'png') + ',image/jpeg,image/webp,image/gif', 'sniffed formats ' + r.mimes);
    ok(r.cap[0] === 4096 && r.cap[1] === 4096 && r.cap[2] === true && r.nocap === false, 'memory cap flagged on targetDims ' + r.cap);
    ok(r.dims === '[[1600,1200],[1000,800],[2000,1500]]', 'size formulas ' + r.dims);
    ok(r.keyPngQ && !r.keyJpgQ, 'setting key ignores quality/fill for PNG but not for JPG');
    ok(r.crc === 'cbf43926', 'crc32 check value');
  }

  // ---------- toFix 12 slider height / 10 theme label ----------
  {
    await ev(() => { document.querySelector('#setCard').open = true; });
    const h = await ev(() => document.querySelector('#quality').getBoundingClientRect().height);
    ok(h >= 44, 'quality slider ≥ 44px tall (' + h + ')');
    const t1 = await ev(() => document.querySelector('#themeBtn .tl').textContent);
    await page.click('#themeBtn');
    const t2 = await ev(() => document.querySelector('#themeBtn .tl').textContent);
    await page.click('#themeBtn'); await page.click('#themeBtn');
    ok(t1 === '自動' && t2 === '淺色', 'theme button shows the current mode as text (' + t1 + '→' + t2 + ')');
    const tb = await ev(() => { const r = document.querySelector('#themeBtn').getBoundingClientRect(), c = document.querySelector('#clearBtn').getBoundingClientRect(); return { w: r.width, h: r.height, gap: c.left - r.right, sw: document.documentElement.scrollWidth }; });
    ok(tb.h >= 44 && tb.w >= 44 && tb.gap >= 0 && tb.sw <= 360, 'theme button fits at 360px without overlap ' + JSON.stringify(tb));
  }

  // ---------- toFix 11 toast does not block taps ----------
  {
    await page.click('#dropSamples');
    await page.click('#clearBtn'); // empty list → plain toast
    await waitFor(() => !document.querySelector('#toast').hidden);
    const r = await ev(() => { const t = document.querySelector('#toast'); const b = t.getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { pe: getComputedStyle(t).pointerEvents, through: !t.contains(el) }; });
    ok(r.pe === 'none' && r.through, 'plain toast lets taps through ' + JSON.stringify(r));
  }

  // ---------- add own files: no-type file, bad file, GIF, wide image ----------
  await ev(async () => {
    const jpg = await __mk(800, 600, 'image/jpeg'), png = await __mk(400, 300, 'image/png');
    const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));
    const o6 = __orient6(await __mk(400, 200, 'image/jpeg'));
    __drop([new File([jpg], 'a-photo.jpg', { type: 'image/jpeg' }), new File([png], 'b-logo.png', { type: 'image/png' }),
      new File([jpg], 'photo', { type: '' }), new File([new Uint8Array(500).fill(7)], 'broken.jpg', { type: 'image/jpeg' }),
      new File([gif], 'dot.gif', { type: 'image/gif' }), new File([o6], 'rot6.jpg', { type: 'image/jpeg' }),
      new File(['hello'], 'readme.txt', { type: 'text/plain' })]);
  });
  await waitFor(() => window.__sq.items.length === 6 && window.__settled());
  {
    const r = await ev(() => window.__sq.items.map(i => ({ n: i.name, st: i.status, w: i.srcW, h: i.srcH, f: i.fatal, m: i.mime })));
    const by = n => r.find(x => x.n === n) || {};
    ok(!r.some(x => x.n === 'readme.txt'), 'text/plain file is skipped');
    ok(by('photo').st === 'wait' && by('photo').m === 'image/jpeg' && by('photo').w === 800, 'JPEG with no extension and no type is accepted (toFix 4) ' + JSON.stringify(by('photo')));
    ok(by('broken.jpg').st === 'err' && by('broken.jpg').f === true, 'undecodable file → fatal error');
    ok(by('rot6.jpg').w === 200 && by('rot6.jpg').h === 400, 'orientation 6 swaps header dims ' + JSON.stringify(by('rot6.jpg')));
    const th = await ev(async () => { const it = window.__sq.items.find(i => i.name === 'rot6.jpg'); const b = await createImageBitmap(await (await fetch(it.thumb)).blob()); return [b.width, b.height]; });
    ok(th[0] === 60 && th[1] === 120, 'fast thumbnail is decoded at 120px and upright ' + th);
    const row = await ev(() => { const it = window.__sq.items.find(i => i.name === 'broken.jpg'); const li = document.querySelector(`li[data-id="${it.id}"]`); return { dims: li.querySelectorAll('.line')[0].textContent, broken: !!li.querySelector('.thumb .broken'), err: li.querySelector('.state.err svg').innerHTML }; });
    ok(row.dims === '—', 'error row shows — instead of 讀取中… (toFix 7) ' + row.dims);
    ok(row.broken, 'error row thumbnail shows a broken-image icon (toFix 14)');
    const sb = await ev(() => document.querySelector('#startBtn').textContent);
    ok(/（5）/.test(sb), 'start button counts 5 images, not the broken one (toFix 8) ' + sb);
  }

  // ---------- compress with 原格式 ----------
  await page.click('#fmt-orig');
  await page.click('#startBtn');
  await waitFor(() => window.__allDone() && /已完成/.test(document.querySelector('#startBtn').textContent));
  {
    const r = await ev(() => window.__sq.items.map(i => ({ n: i.name, st: i.status, m: i.outMime, note: i.note })));
    const g = r.find(x => x.n === 'dot.gif');
    ok(g.m === 'image/jpeg' && /原格式（GIF）無法輸出，已轉成 JPG/.test(g.note), 'GIF in 原格式 says it became JPG (toFix 9) ' + g.note);
    ok(r.find(x => x.n === 'b-logo.png').m === 'image/png' && r.find(x => x.n === 'photo').m === 'image/jpeg', 'other formats kept');
    const st = await ev(() => ({ t: document.querySelector('#startBtn').textContent, d: document.querySelector('#startBtn').disabled }));
    ok(st.t === '已完成' && st.d, 'after a batch with a broken file the button says 已完成 (toFix 8) ' + JSON.stringify(st));
  }

  // ---------- toFix 13: changing a setting keeps results, flags them ----------
  {
    await page.click('#fmt-jpeg');
    const r = await ev(() => ({ outs: window.__sq.items.filter(i => i.outBlob).length, flags: document.querySelectorAll('.flag.stale').length, bar: !document.querySelector('#warnBar').hidden, start: document.querySelector('#startBtn').textContent, dis: document.querySelector('#startBtn').disabled }));
    ok(r.outs === 5 && r.flags >= 1 && r.bar && !r.dis && /壓縮（\d）/.test(r.start), 'setting change keeps results and asks to re-run ' + JSON.stringify(r));
    await page.click('#fmt-orig');
    const back = await ev(() => ({ flags: document.querySelectorAll('.flag.stale').length, start: document.querySelector('#startBtn').textContent, bar: document.querySelector('#warnBar').hidden }));
    ok(back.flags === 0 && back.start === '已完成' && back.bar, 'switching back to the used setting clears the flags ' + JSON.stringify(back));
  }

  // ---------- toFix 1 (veto): list and outputs survive a reload ----------
  {
    const before = await ev(async () => { await window.__sq.flush(); return window.__sq.items.map(i => [i.name, i.status, i.outBlob ? i.outBlob.size : 0, i.outName || ''].join('|')); });
    await page.reload();
    await waitFor(n => window.__sq && window.__sq.items.length === n && window.__settled(), before.length);
    const after = await ev(() => window.__sq.items.map(i => [i.name, i.status, i.outBlob ? i.outBlob.size : 0, i.outName || ''].join('|')));
    ok(JSON.stringify(before) === JSON.stringify(after), 'items, statuses and outputs restored after reload');
    const r = await ev(() => ({ sample: window.__sq.items.some(i => i.sample), banner: document.querySelector('#sampleBanner').hidden, info: document.querySelector('#listInfo').textContent, start: document.querySelector('#startBtn').textContent }));
    ok(!r.sample && r.banner && /已存在本機/.test(r.info) && r.start === '已完成', 'no samples after reload; list says it is saved ' + JSON.stringify(r));
    const px = await ev(async () => { const it = window.__sq.items.find(i => i.name === 'a-photo.jpg'); const b = await createImageBitmap(it.outBlob); return [b.width, b.height]; });
    ok(px[0] === 800 && px[1] === 600, 'restored output still decodes');
  }

  // ---------- toFix 6: single remove can be undone, also after several removes ----------
  {
    const names = () => ev(() => window.__sq.items.map(i => i.name).join(','));
    const n0 = await names();
    await page.locator('li.item').nth(1).locator('[data-act="rm"]').click();
    await waitFor(() => !document.querySelector('#toast').hidden && document.querySelector('#toast .act'));
    ok((await names()).split(',').length === 5, 'remove takes the row out');
    await page.locator('li.item').nth(1).locator('[data-act="rm"]').click();
    const tt = await ev(() => document.querySelector('#toast').textContent);
    ok(/已移除 2 張/.test(tt), 'second remove stacks in the same undo toast ' + tt);
    await page.click('#toast .act');
    ok((await names()) === n0, 'undo puts both rows back in their places');
    await ev(() => window.__sq.flush()); await page.reload();
    await waitFor(n => window.__sq && window.__sq.items.length === n && window.__settled(), n0.split(',').length);
    ok((await names()) === n0, 'undone rows are saved again');
  }

  // ---------- toFix 5: typed numbers saved without leaving the field ----------
  {
    await ev(() => { document.querySelector('#setCard').open = true; });
    await page.selectOption('#sizeMode', 'long');
    await page.fill('#sizeVal', '777');
    await page.check('#targetOn'); await page.fill('#targetKB', '123');
    await page.reload();
    await waitFor(() => window.__sq && window.__sq.items.length > 0);
    const r = await ev(() => [window.__sq.settings.sizeVal, window.__sq.settings.targetKB, document.querySelector('#sizeVal').value]);
    ok(r[0] === 777 && r[1] === 123 && r[2] === '777', 'typed size and target KB survive a reload ' + r);
    await ev(() => { document.querySelector('#setCard').open = true; });
    await page.uncheck('#targetOn'); await page.fill('#sizeVal', '1600');
  }

  // ---------- toFix 2: changing settings during a batch ----------
  {
    await waitFor(() => window.__settled());
    await ev(() => { document.querySelector('#fmt-webp').click(); });
    await waitFor(() => !document.querySelector('#startBtn').disabled);
    // start the batch with WebP, then switch to PNG while it runs (same task, so it is always mid-run)
    const mid = await ev(() => { document.querySelector('#startBtn').click(); const was = window.__sq.running; document.querySelector('#fmt-png').click(); return was; });
    ok(mid === true, 'format changed while the batch was running');
    await waitFor(() => window.__allDone());
    const r = await ev(() => ({ outs: [...new Set(window.__sq.items.filter(i => i.outBlob).map(i => i.outMime))], sum: document.querySelector('#setSummary').textContent, start: document.querySelector('#startBtn').textContent, dis: document.querySelector('#startBtn').disabled, flags: document.querySelectorAll('.flag.stale').length }));
    ok(r.outs.join() === 'image/webp' && /^PNG/.test(r.sum), 'batch used its starting settings ' + JSON.stringify(r));
    ok(!r.dis && /壓縮（5）/.test(r.start) && r.flags === 5, 'results made with the old setting are flagged and the button offers a re-run ' + JSON.stringify(r));
    await page.click('#startBtn');
    await waitFor(() => window.__allDone() && /已完成/.test(document.querySelector('#startBtn').textContent));
    const r2 = await ev(() => [...new Set(window.__sq.items.filter(i => i.outBlob).map(i => i.outMime))].join());
    ok(r2 === 'image/png', 're-run produces PNG ' + r2);
  }

  // ---------- toFix 3: memory cap is explained; toFix 14: warn icon differs from error ----------
  {
    await ev(() => { document.querySelector('#fmt-png').click(); });
    await page.selectOption('#sizeMode', 'none');
    await ev(async () => { const w = await __mk(8300, 60, 'image/png'), n = await __mk(300, 300, 'image/png', { noise: true });
      __drop([new File([w], 'wide.png', { type: 'image/png' }), new File([n], 'noise.png', { type: 'image/png' })]); });
    await waitFor(() => window.__sq.items.length === 8 && window.__settled());
    await page.check('#targetOn'); await page.fill('#targetKB', '5'); await page.press('#targetKB', 'Tab');
    await page.click('#startBtn');
    await waitFor(() => window.__allDone() && !document.querySelector('#startBtn').textContent.includes('處理中'));
    const r = await ev(() => { const w = window.__sq.items.find(i => i.name === 'wide.png'), n = window.__sq.items.find(i => i.name === 'noise.png');
      const li = document.querySelector(`li[data-id="${n.id}"]`), bad = document.querySelector('.state.err svg');
      return { wW: w.outW <= 8192, wNote: w.note, nSt: n.status, warnSvg: li.querySelector('.state.warn svg') && li.querySelector('.state.warn svg').innerHTML, errSvg: bad && bad.innerHTML }; });
    ok(r.wW && /超過記憶體上限，已縮成 \d+×\d+/.test(r.wNote), 'memory cap note shown (toFix 3) ' + r.wNote);
    ok(r.nSt === 'warn' && r.warnSvg && r.errSvg && r.warnSvg !== r.errSvg, 'target-missed icon differs from the error icon (toFix 14)');
    await page.uncheck('#targetOn'); await page.selectOption('#sizeMode', 'long');
  }

  // ---------- clear all also clears the saved list ----------
  {
    await page.click('#clearBtn'); await page.click('#clearBtn');
    await ev(() => window.__sq.flush());
    ok(await ev(() => window.__sq.items.length === 0), 'clear all empties the list');
    await page.reload();
    await waitFor(() => window.__sq && window.__sq.items.length === 3 && window.__sq.items.every(i => i.sample));
    ok(true, 'after clear all, a reload shows the samples again');
    const sw = await ev(() => document.documentElement.scrollWidth);
    ok(sw <= 360, 'no horizontal scroll at 360px');
  }

  await browser.close(); srv.close();
  ok(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
