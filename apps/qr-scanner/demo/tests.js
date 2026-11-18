// Tests for QR 碼掃描器 (qr-scanner): regression checks for the release-review rounds 1 and 2.
// Runs the real page in Chromium (Playwright) with CDP touch events. Every image is drawn in the page itself
// (QR codes with the page's own encoder, no-QR textures from a seeded random generator), so no files are needed.
//  1. Wi‑Fi values wrapped in double quotes (qifi.org style) lose the quotes; escaped quotes stay.
//  2. No-QR textures finish within the time limit and leave the page responsive, in the Worker and in the
//     main-thread fallback (no single long task over 200 ms); real codes still decode on both paths.
//  3. Taps fire exactly once: single tap, 0.6 s and 1 s holds, and with another finger already down.
//  4. History: single delete and 清空歷史 both have 復原; data survives a reload; export downloads a CRLF .txt.
//  5. After picking an image the first result's buttons are in view (360×640).
//  6. Closing the history sheet by tapping its backdrop never focuses the paste zone underneath (844×390 and 360×640).
// Usage: node tests.js   (prints "N passed, 0 failed"; exit code 1 on failure)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }

const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const HIST_KEY = 'qr-scanner:v1:history';
const seedHistory = n => JSON.stringify(Array.from({ length: n }, (_, i) => ({ text: `https://example.com/item/${i + 1}`, type: 'url', label: '網址', time: 1767225600000 - i * 60000, source: 'image' })));

// In-page helpers (installed with addInitScript): QR code and no-QR texture images as Files.
function pageHelpers() {
  window.__t = {
    qr(text, scale = 6) {
      const q = QRCore.encodeQR(text, { ecl: 'M' }), n = q.size, side = (n + 8) * scale, c = document.createElement('canvas');
      c.width = c.height = side; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, side, side); x.fillStyle = '#000';
      for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.modules[r * n + k]) x.fillRect((k + 4) * scale, (r + 4) * scale, scale, scale);
      return c;
    },
    texture(kind) {
      let z = 12345; const rnd = () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const W = kind === 'fakefinders' ? 1600 : 1400, c = document.createElement('canvas'); c.width = c.height = W; const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, W);
      if (kind === 'noise') { const d = x.getImageData(0, 0, W, W); for (let i = 0; i < d.data.length; i += 4) { const v = rnd() < .5 ? 0 : 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; } x.putImageData(d, 0, 0); }
      if (kind === 'gravel') for (let i = 0; i < 9000; i++) { const g = 40 + rnd() * 180 | 0; x.fillStyle = `rgb(${g},${g},${g})`; x.beginPath(); x.ellipse(rnd() * W, rnd() * W, 3 + rnd() * 14, 3 + rnd() * 10, rnd() * 3, 0, 7); x.fill(); }
      if (kind === 'fakefinders') for (let i = 0; i < 400; i++) { // finder-like 1:1:3:1:1 rings that never form a code
        const s = 3 + rnd() * 5, X = rnd() * (W - 8 * s), Y = rnd() * (W - 8 * s);
        x.fillStyle = '#000'; x.fillRect(X, Y, 7 * s, 7 * s); x.fillStyle = '#fff'; x.fillRect(X + s, Y + s, 5 * s, 5 * s); x.fillStyle = '#000'; x.fillRect(X + 2 * s, Y + 2 * s, 3 * s, 3 * s);
      }
      return c;
    },
    file: c => new Promise(r => c.toBlob(b => r(new File([b], 'img.png', { type: 'image/png' })), 'image/png')),
    longtasks: [],
  };
  try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__t.longtasks.push(Math.round(e.duration)))).observe({ type: 'longtask' }); } catch {}
}

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const URL0 = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const mobile = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW', timezoneId: 'Asia/Taipei', acceptDownloads: true });
  async function open(w, h, { noWorker = false, history = null } = {}) {
    const ctx = await browser.newContext(mobile(w, h)), page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console: ${m.text()}`); });
    await page.addInitScript(pageHelpers);
    if (noWorker) await page.addInitScript(() => { window.__noWorker = true; });
    if (history != null) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, [HIST_KEY, history]);
    await page.goto(URL0);
    await page.waitForFunction(() => document.querySelector('#results .card') && !document.getElementById('status').classList.contains('busy'));
    const cdp = await ctx.newCDPSession(page);
    const T = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const tap = async (x, y, hold = 40) => { await T('touchStart', [{ x, y, id: 1 }]); await page.waitForTimeout(hold); await T('touchEnd', [{ x, y, id: 1 }]); };
    const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const tapSel = async (sel, hold) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await center(sel); await tap(x, y, hold); };
    return { ctx, page, T, tap, tapSel, center };
  }
  const idle = page => page.waitForFunction(() => !document.getElementById('status').classList.contains('busy'), null, { timeout: 15000 });

  // ---------- 1. Wi‑Fi quoted values ----------
  {
    const { ctx, page } = await open(390, 844);
    const c = await page.evaluate(() => [
      'WIFI:S:Home;T:WPA;P:"12345678";;', 'WIFI:S:"616263";T:WPA;P:abc;;', 'WIFI:S:Café;T:WPA;P:\\"ab\\";;', 'WIFI:S:x;T:WPA;P:"ab\\";;',
      'WIFI:T:WPA;S:巷口咖啡\\:2F;P:p@ss\\;w\\,rd;;', 'WIFI:S:x;T:WPA;P:"";;'].map(t => { const r = classify(t); return [r.ssid, r.pw]; }));
    ok(c[0][1] === '12345678', `P:"12345678" → password 12345678 (got ${c[0][1]})`);
    ok(c[1][0] === '616263', `S:"616263" → network name 616263 (got ${c[1][0]})`);
    ok(c[2][1] === '"ab"', `escaped quotes are part of the password (got ${c[2][1]})`);
    ok(c[3][1] === '"ab"', `closing quote escaped → value kept as written (got ${c[3][1]})`);
    ok(c[4][0] === '巷口咖啡:2F' && c[4][1] === 'p@ss;w,rd', 'backslash escapes still work');
    ok(c[5][1] === '', `P:"" is an empty password (got ${c[5][1]})`);
    await ctx.close();
  }

  // ---------- 2. no-QR images finish within the limit; responsiveness; main-thread fallback ----------
  for (const noWorker of [false, true]) {
    const tag = noWorker ? '主執行緒後備' : 'Worker';
    const { ctx, page } = await open(390, 844, { noWorker });
    for (const kind of ['noise', 'gravel', 'fakefinders']) {
      const r = await page.evaluate(async kind => {
        const f = await __t.file(__t.texture(kind)); __t.longtasks.length = 0; const t = performance.now();
        const p = handleBlob(f, 'image');
        const probe = await new Promise(res => setTimeout(() => { const s = performance.now(); document.getElementById('btn-history').click(); requestAnimationFrame(() => res({ late: Math.round(s - t - 300), opened: !document.getElementById('hist-sheet').hidden })); }, 300));
        await p; document.getElementById('hist-sheet').hidden = true;
        return { ms: Math.round(performance.now() - t), probe, cards: document.querySelectorAll('#results .card').length, status: document.getElementById('status').textContent, longest: Math.max(0, ...__t.longtasks) };
      }, kind);
      ok(r.ms < 2300 && r.cards === 0 && /找不到/.test(r.status), `${tag}: no-QR ${kind} ends in ${r.ms} ms with 找不到 (limit 1.5 s + image load)`);
      ok(r.probe.opened && r.probe.late < 250, `${tag}: 歷史 opens while ${kind} decodes (timer ${r.probe.late} ms late)`);
      ok(r.longest < 200, `${tag}: longest main-thread task during ${kind} is ${r.longest} ms (< 200)`);
    }
    for (const text of ['https://example.com/掃描測試?id=42', 'WIFI:S:Home;T:WPA;P:"12345678";;']) {
      const r = await page.evaluate(async text => { const f = await __t.file(__t.qr(text)); await handleBlob(f, 'image'); return [...document.querySelectorAll('#results .card')].map(c => c._text); }, text);
      ok(r.length === 1 && r[0] === text, `${tag}: decodes ${text.slice(0, 30)}`);
    }
    await ctx.close();
  }

  // ---------- 3. taps fire exactly once (single, 0.6 s, 1 s, another finger down) ----------
  {
    const { ctx, page, T, tap, tapSel, center } = await open(390, 844);
    await page.evaluate(() => { renderResults([{ text: 'WIFI:S:Home;T:WPA;P:"12345678";;' }], false); });
    const btn = '#results [data-act="showpw"]', state = () => page.evaluate(() => [document.querySelector('#results [data-act="showpw"]').textContent, document.querySelector('#results .pw').textContent]);
    await page.locator(btn).scrollIntoViewIfNeeded();
    const expect = ['隱藏', '顯示', '隱藏', '顯示'];
    const holds = [40, 600, 1000];
    for (let i = 0; i < holds.length; i++) { await tapSel(btn, holds[i]); await page.waitForFunction(s => document.querySelector('#results [data-act="showpw"]').textContent === s, expect[i], { timeout: 2000 }).catch(() => {}); await page.waitForTimeout(150); ok((await state())[0] === expect[i], `顯示 toggles exactly once on a ${holds[i]} ms tap`); }
    // another finger already down on a blank spot
    const blank = await page.evaluate(() => { const r = document.querySelector('header, h1').getBoundingClientRect(); return [Math.min(innerWidth - 10, r.right - 8), Math.max(4, r.top + 4)]; });
    const [bx, by] = await center(btn);
    await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(60);
    await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }, { x: bx, y: by, id: 2 }]); await page.waitForTimeout(50);
    await T('touchEnd', [{ x: bx, y: by, id: 2 }]); await page.waitForTimeout(250);
    await T('touchEnd', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(150);
    const s = await state();
    ok(s[0] === '顯示' && s[1].startsWith('•'), `tap with another finger down fires once (${s[0]})`);
    await tapSel(btn); await page.waitForTimeout(200);
    ok((await state())[1] === '12345678', `password shows without quotes (${(await state())[1]})`);
    // a tap that opens the sheet must not close it through the backdrop under the finger; × closes it once
    await tapSel('#btn-history', 40); await page.waitForTimeout(400);
    ok(await page.evaluate(() => !document.getElementById('hist-sheet').hidden), '歷史 opens and stays open after the tap');
    await tapSel('#hist-close'); await page.waitForTimeout(250);
    ok(await page.evaluate(() => document.getElementById('hist-sheet').hidden), '× closes the sheet');
    await ctx.close();
  }

  // ---------- 4. history: delete/clear undo, reload, export ----------
  {
    const { ctx, page, tapSel } = await open(390, 844, { history: seedHistory(4) });
    const texts = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '[]').map(h => h.text), HIST_KEY);
    const start = await texts();
    ok(start.length >= 4 && start.includes('https://example.com/item/2'), `seeded history loads (${start.length} items, sample decode added on top)`);
    await page.evaluate(() => document.getElementById('btn-history').click());
    const i2 = start.indexOf('https://example.com/item/2');
    await tapSel(`#hist-list [data-del="${i2}"]`); await page.waitForTimeout(200);
    ok(!(await texts()).includes('https://example.com/item/2'), 'single delete removes the item');
    await tapSel('#toast .toast-act'); await page.waitForTimeout(200);
    ok(JSON.stringify(await texts()) === JSON.stringify(start), 'single delete 復原 restores it in place');
    await tapSel('#hist-clear'); await page.waitForTimeout(150);
    ok((await texts()).length === start.length && await page.evaluate(() => !document.getElementById('hist-confirm').hidden), '清空歷史 asks once before clearing');
    await tapSel('#hist-clear'); await page.waitForTimeout(200);
    ok((await texts()).length === 0 && await page.evaluate(() => document.querySelectorAll('#hist-list li').length === 0 && document.getElementById('hist-clear').disabled), '清空歷史 clears the list (and disables itself)');
    ok(await page.evaluate(() => !document.getElementById('toast').hidden && document.querySelector('#toast .toast-act')?.textContent === '復原'), '清空歷史 offers 復原');
    await tapSel('#toast .toast-act'); await page.waitForTimeout(200);
    ok(JSON.stringify(await texts()) === JSON.stringify(start) && await page.evaluate(n => document.querySelectorAll('#hist-list li').length === n, start.length), '清空歷史 復原 brings every item back');
    await page.reload(); await idle(page); await page.waitForTimeout(200);
    const after = await texts();
    ok(start.every(t => after.includes(t)), 'restored history survives a reload');
    await page.evaluate(() => document.getElementById('btn-history').click());
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), tapSel('#hist-export')]);
    const body = fs.readFileSync(await dl.path(), 'utf8');
    ok(/^qr-history-\d{8}\.txt$/.test(dl.suggestedFilename()) && body.includes('\r\n') && start.every(t => body.includes(t)), `export downloads ${dl.suggestedFilename()} with every item and CRLF`);
    await ctx.close();
  }

  // ---------- 5. picked image: first result's buttons in view ----------
  for (const [w, h] of [[360, 640], [390, 844]]) {
    const { ctx, page } = await open(w, h);
    await page.evaluate(() => scrollTo(0, 0));
    await page.evaluate(async () => { const f = await __t.file(__t.qr('https://example.org/menu?t=7')); const dt = new DataTransfer(); dt.items.add(f); const inp = document.getElementById('file-input'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('#results .card')?._text === 'https://example.org/menu?t=7', null, { timeout: 8000 });
    let last = null, stable = 0; // wait for the smooth scroll to settle
    for (let i = 0; i < 40 && stable < 3; i++) { await page.waitForTimeout(50); const y = await page.evaluate(() => scrollY); stable = y === last ? stable + 1 : 0; last = y; }
    const r = await page.evaluate(() => { const b = document.querySelector('#results .card .card-actions .btn').getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), vh: innerHeight }; });
    ok(r.top >= 0 && r.bottom <= r.vh, `${w}×${h}: first result's button is in view after picking an image (${r.top}–${r.bottom} of ${r.vh})`);
    await ctx.close();
  }

  // ---------- 6. closing the sheet by its backdrop never focuses the paste zone ----------
  for (const [w, h, n] of [[844, 390, 3], [360, 640, 0]]) {
    const { ctx, page, tap, tapSel } = await open(w, h, { history: seedHistory(n) });
    await page.evaluate(() => scrollTo(0, 0)); await tapSel('#btn-paste');
    await page.waitForFunction(() => !document.getElementById('pastezone').hidden, null, { timeout: 3000 });
    for (const hold of [40, 600, 1000]) {
      // landscape: paste zone scrolled near the top (beside the panel); portrait: page at the top, paste zone below the short panel
      await page.evaluate(land => { document.activeElement.blur(); const z = document.getElementById('pastezone'); scrollTo(0, land ? z.getBoundingClientRect().top + scrollY - 20 : 0); }, w > h);
      await page.waitForTimeout(150);
      await page.evaluate(() => document.getElementById('btn-history').click()); await page.waitForTimeout(200);
      const p = await page.evaluate(() => { const z = document.getElementById('pastezone').getBoundingClientRect(), pn = document.querySelector('#hist-sheet .panel').getBoundingClientRect();
        // a spot over the paste zone that is outside the panel (the backdrop)
        for (let y = z.top + 4; y < z.bottom - 2; y += 4) for (const x of [z.left + 20, z.right - 20]) if (document.elementFromPoint(x, y)?.id === 'hist-sheet' && (y > pn.bottom || x < pn.left || x > pn.right)) return { x, y };
        return null; });
      ok(!!p, `${w}×${h}: backdrop covers the paste zone (test setup)`);
      if (!p) { await page.evaluate(() => { document.getElementById('hist-sheet').hidden = true; }); continue; }
      await tap(p.x, p.y, hold);
      await page.waitForFunction(() => document.getElementById('hist-sheet').hidden, null, { timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
      const a = await page.evaluate(() => ({ closed: document.getElementById('hist-sheet').hidden, active: document.activeElement.id || document.activeElement.tagName }));
      ok(a.closed && a.active === 'BODY', `${w}×${h}: ${hold} ms backdrop tap closes the sheet and focus stays on BODY (got ${a.active})`);
    }
    await ctx.close();
  }

  ok(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
