// 手寫簽名板 regression tests. Usage: node tests.js
// Served over http://127.0.0.1 so localStorage behaves like the site.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const SRC = path.resolve(__dirname, '..', 'index.html');
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>';
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

(async () => {
  const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html; charset=utf-8'); r.end(PAGE); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/apps/sign-pad/`;
  const b = await chromium.launch();
  const errs = [];
  async function open(opts = PHONE, init) {
    const ctx = await b.newContext(opts); if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(), cdp = await ctx.newCDPSession(p);
    p.on('pageerror', e => errs.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto(url); await p.waitForFunction(() => window.__spReady);
    return { ctx, p, cdp };
  }
  const reload = async p => { await p.reload(); await p.waitForFunction(() => window.__spReady); };
  async function touch(cdp, pts, rad = 4) {
    const tp = (x, y) => [{ x, y, radiusX: rad, radiusY: rad, force: 1, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(...pts[0]) });
    for (const q of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(...q) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const line = (x0, y0, dx, dy, n = 15) => Array.from({ length: n + 1 }, (_, i) => [x0 + dx * i / n, y0 + dy * i / n + (i % 2 ? 3 : -3)]);
  const count = p => p.evaluate(() => window.__sp.strokes.length);
  const toastText = p => p.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toastMsg').textContent);

  // ---- finger widths draw; palm rejected only after a stylus was used ----
  {
    const { ctx, p, cdp } = await open();
    for (const rad of [2, 12, 25]) {
      await p.evaluate(() => localStorage.clear()); await reload(p);
      const r = await p.locator('#cv').boundingBox();
      await touch(cdp, line(r.x + 40, r.y + r.height / 2, 180, 0), rad); await p.waitForTimeout(50);
      ok(await count(p) === 1, `finger touch radius ${rad} draws a stroke`);
    }
    await p.evaluate(() => localStorage.clear()); await reload(p);
    await p.evaluate(() => {
      const cv = document.getElementById('cv'), r = cv.getBoundingClientRect();
      const ev = (t, x) => new PointerEvent(t, { pointerId: 7, pointerType: 'pen', isPrimary: true, pressure: 0.6, clientX: r.left + x, clientY: r.top + r.height / 2, bubbles: true, cancelable: true });
      cv.dispatchEvent(ev('pointerdown', 30)); cv.dispatchEvent(ev('pointermove', 80)); cv.dispatchEvent(ev('pointerup', 120));
      document.getElementById('clearBtn').click();
    });
    ok(await count(p) === 0, 'cleared after pen stroke');
    const r = await p.locator('#cv').boundingBox();
    await touch(cdp, line(r.x + 40, r.y + r.height / 2, 180, 0), 25); await p.waitForTimeout(50);
    ok(await count(p) === 0, 'wide touch after pen use is ignored as a palm');
    await ctx.close();
  }

  // ---- [veto fix] the signature being written and its undo history survive a reload ----
  {
    const { ctx, p, cdp } = await open();
    const r = await p.locator('#cv').boundingBox();
    for (let i = 0; i < 3; i++) await touch(cdp, line(r.x + 30, r.y + 40 + i * 50, 250, 10));
    ok(await count(p) === 3, 'three strokes written');
    const before = await p.evaluate(() => JSON.stringify(window.__sp.strokes));
    await reload(p);
    ok(await p.evaluate(() => JSON.stringify(window.__sp.strokes)) === before, 'draft strokes identical after reload');
    ok(await p.evaluate(() => document.getElementById('cnt').textContent) === '3 筆畫', 'stroke count shown after reload');
    ok(!(await p.evaluate(() => document.getElementById('undoBtn').disabled)), 'undo available after reload');
    await p.click('#undoBtn'); ok(await count(p) === 2, 'undo after reload removes last stroke');
    await reload(p); ok(await count(p) === 2, 'undo state persisted');
    ok(!(await p.evaluate(() => document.getElementById('redoBtn').disabled)), 'redo persisted');
    await p.click('#redoBtn'); await p.click('#clearBtn');
    ok((await toastText(p)).includes('已清空') && await p.isVisible('#toastAct'), 'clear toast offers 復原');
    await reload(p);
    ok(await count(p) === 0, 'cleared canvas stays empty after reload (empty array saved)');
    await p.click('#undoBtn'); ok(await count(p) === 3, 'clear is undoable after reload');
    await reload(p);
    const ink = await p.evaluate(() => { const c = document.getElementById('cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 100) n++; return n; });
    ok(ink > 500, `restored draft is painted (${ink} ink px)`);
    // [detail fix] pen-up adds the stroke to the cached layer instead of repainting everything
    const pc = await p.evaluate(() => ({ full: window.__sp.paints.full, inc: window.__sp.paints.inc }));
    await touch(cdp, line(r.x + 30, r.y + 180, 200, -20));
    const pc2 = await p.evaluate(() => ({ full: window.__sp.paints.full, inc: window.__sp.paints.inc }));
    ok(pc2.full === pc.full && pc2.inc === pc.inc + 1, `pen-up paints incrementally (${JSON.stringify(pc)} -> ${JSON.stringify(pc2)})`);
    // [detail fix] each finished stroke is one filled outline (no seams between segments)
    const fills = await p.evaluate(() => { const proto = CanvasRenderingContext2D.prototype, f = proto.fill; let n = 0; proto.fill = function (...a) { n++; return f.apply(this, a); }; window.__sp.renderPNG(); proto.fill = f; return [n, window.__sp.strokes.length]; });
    ok(fills[0] === fills[1], `one fill per stroke (${fills[0]} fills for ${fills[1]} strokes)`);
    await ctx.close();
  }

  // ---- [fix] trash button no longer inside the writing area; a stroke from that corner draws ----
  {
    const { ctx, p, cdp } = await open();
    ok(await p.evaluate(() => !document.querySelector('#sheet button')), 'no button inside the signing sheet');
    const r = await p.locator('#cv').boundingBox();
    await touch(cdp, line(r.x + r.width - 20, r.y + r.height - 20, -120, -40));
    ok(await count(p) === 1, 'stroke starting at bottom-right corner draws instead of clearing');
    // [fix] segmented buttons are at least 44px tall
    const segH = await p.$$eval('.seg button', bs => Math.min(...bs.map(x => x.getBoundingClientRect().height)));
    ok(segH >= 44, `.seg buttons >= 44px (${segH})`);
    await ctx.close();
  }

  // ---- [fix] 360 wide: 全部換成此色 wraps aligned with the swatches ----
  {
    const { ctx, p } = await open({ ...PHONE, viewport: { width: 360, height: 640 } });
    const xs = await p.evaluate(() => [document.getElementById('c-black').getBoundingClientRect().left, document.getElementById('recolorBtn').getBoundingClientRect().left, document.documentElement.scrollWidth, innerWidth]);
    ok(Math.abs(xs[0] - xs[1]) < 1, `recolor button aligned with first swatch (${xs[0]} vs ${xs[1]})`);
    ok(xs[2] <= xs[3], '360 no horizontal scroll');
    await ctx.close();
  }

  // ---- [fix] portrait big canvas really gets bigger (stage turned 90°) and input maps correctly ----
  {
    const { ctx, p, cdp } = await open();
    const small = await p.locator('#sheet').boundingBox();
    await p.click('#bigBtn'); await p.waitForTimeout(150);
    const big = await p.locator('#sheet').boundingBox();
    ok(big.height >= 500 && big.width >= 300 && big.height * big.width > small.width * small.height * 1.8, `portrait big canvas fills the screen (${Math.round(big.width)}x${Math.round(big.height)} vs ${Math.round(small.width)}x${Math.round(small.height)})`);
    ok(await p.evaluate(() => window.__sp.rot90), 'portrait big mode is rotated');
    const bar = await p.evaluate(() => [...document.querySelectorAll('.bigbar button')].map(x => { const r = x.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; }));
    ok(bar.every(Boolean), 'big-mode buttons on screen');
    // a stroke down the screen near its right edge = left-to-right along the top of the board
    await touch(cdp, line(big.x + big.width - 60, big.y + 60, 0, 300));
    const pts = await p.evaluate(() => window.__sp.strokes[0].points.map(q => [q.x, q.y]));
    const xsr = pts.map(q => q[0]), ysr = pts.map(q => q[1]);
    ok(xsr[xsr.length - 1] - xsr[0] > 0.4 && Math.max(...ysr) < 0.4, `rotated input maps to board (x ${xsr[0].toFixed(2)}→${xsr[xsr.length - 1].toFixed(2)}, y≤${Math.max(...ysr).toFixed(2)})`);
    const ink = await p.evaluate(([x, y]) => { const c = document.getElementById('cv'); return c.getContext('2d').getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data[3]; }, pts[Math.floor(pts.length / 2)]);
    ok(ink > 100, 'rotated stroke painted at the touched spot');
    await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(200);
    ok(!(await p.evaluate(() => window.__sp.rot90)), 'landscape big mode is not rotated');
    await p.click('#bDone'); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(150);
    const back = await p.locator('#sheet').boundingBox();
    ok(Math.abs(back.width - small.width) < 2, 'exit big restores the normal sheet');
    await ctx.close();
  }

  // ---- [fix] download PNG / SVG without the downloads capability ----
  {
    const { ctx, p } = await open({ viewport: { width: 1280, height: 800 } });
    await p.evaluate(() => window.__sp.commit(window.__sp.sampleSig()));
    ok(await p.isVisible('#pngBtn') && await p.isVisible('#svgBtn'), 'download buttons visible without capability');
    for (const [id, ext, check] of [['#pngBtn', '.png', s => s.slice(1, 4).toString() === 'PNG'], ['#svgBtn', '.svg', s => s.toString().startsWith('<svg')]]) {
      const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click(id)]);
      const data = fs.readFileSync(await dl.path());
      ok(dl.suggestedFilename().endsWith(ext) && check(data), `${id} downloads a real ${ext} (${dl.suggestedFilename()}, ${data.length} B)`);
    }
    await ctx.close();
  }

  // ---- [detail fix] auto-crop uses the drawn curve, not control points ----
  {
    const { ctx, p } = await open();
    const r = await p.evaluate(() => {
      const pts = []; for (let i = 0; i < 21; i++) pts.push({ x: 0.1 + i * 0.03, y: i % 2 ? 0.3 : 0.7, t: i * 20, p: 0, w: 5 });
      window.__sp.commit([{ color: '#111111', bw: 2.5, points: pts }]);
      const c = window.__sp.renderPNG(), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let top = c.height, bot = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { top = Math.min(top, y); bot = Math.max(bot, y); }
      return { top, bottom: c.height - 1 - bot };
    });
    ok(r.top >= 12 && r.top <= 22 && r.bottom >= 12 && r.bottom <= 22, `zigzag crop margins ~16px (top ${r.top}, bottom ${r.bottom})`);
    await ctx.close();
  }

  // ---- saved signatures: old key loads, names, rename, delete/wipe undo, backup ----
  {
    const old = [{ id: 'abc', name: '簽名 1', at: 1700000000000, strokes: [{ color: '#1b2a5e', bw: 2.5, points: [{ x: 0.2, y: 0.5, t: 0, p: 0, w: 5 }, { x: 0.6, y: 0.55, t: 50, p: 0, w: 5 }] }] }];
    const { ctx, p, cdp } = await open();
    await p.evaluate(o => { localStorage.clear(); localStorage.setItem('sign-pad:v1:saved', JSON.stringify(o)); }, old);
    await reload(p);
    ok(JSON.stringify(await p.evaluate(() => window.__sp.saved)) === JSON.stringify(old), 'saved data under the old key loads unchanged');
    const r = await p.locator('#cv').boundingBox();
    await touch(cdp, line(r.x + 30, r.y + 80, 250, 10));
    await p.click('#saveBtn'); await p.click('#saveBtn');
    ok((await toastText(p)) === '已存成「簽名 3」', 'save reports success with next number');
    await p.click('#savedBtn'); await p.waitForTimeout(50);
    await p.click('[aria-label="刪除 簽名 1"]'); await p.click('[aria-label="刪除 簽名 1"]');
    ok((await toastText(p)).includes('已刪除「簽名 1」') && await p.isVisible('#toastAct'), 'delete offers 復原');
    await p.click('#toastAct');
    ok((await p.evaluate(() => window.__sp.saved.map(s => s.name))).includes('簽名 1'), 'delete undone');
    await reload(p);
    ok((await p.evaluate(() => window.__sp.saved.map(s => s.name))).includes('簽名 1'), 'undone delete persisted');
    await p.click('#savedBtn'); await p.click('[aria-label="刪除 簽名 1"]'); await p.click('[aria-label="刪除 簽名 1"]');
    await p.click('#dClose'); await p.click('#saveBtn');
    const names = await p.evaluate(() => window.__sp.saved.map(s => s.name));
    ok(new Set(names).size === names.length && names[0] === '簽名 4', `names unique after delete (${names.join(',')})`);
    await p.click('#savedBtn'); await p.click('[aria-label="重新命名 簽名 4"]');
    await p.fill('.item .meta input', '英文簽名'); await p.keyboard.press('Enter');
    ok(!(await p.evaluate(() => document.getElementById('drawer').hidden)), 'Enter in rename keeps drawer open');
    await reload(p);
    ok((await p.evaluate(() => window.__sp.saved[0].name)) === '英文簽名', 'rename persisted');
    await p.click('#savedBtn');
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }), p.click('#expBtn')]);
    const backup = fs.readFileSync(await dl.path(), 'utf8');
    ok(JSON.parse(backup).saved.length === 3 && dl.suggestedFilename().endsWith('.json'), 'export backup is JSON of all saved');
    await p.click('#wipeBtn'); await p.click('#wipeBtn');
    ok(await p.evaluate(() => window.__sp.saved.length) === 0 && await p.isVisible('#toastAct'), 'wipe offers 復原');
    await p.click('#toastAct');
    ok(await p.evaluate(() => window.__sp.saved.length) === 3, 'wipe undone');
    await p.click('#wipeBtn'); await p.click('#wipeBtn');
    const tmp = path.join(os.tmpdir(), `sign-pad-backup-${process.pid}.json`); fs.writeFileSync(tmp, backup);
    await p.setInputFiles('#impFile', tmp); await p.waitForTimeout(150);
    { const dbg = await p.evaluate(() => [window.__sp.saved.length, document.getElementById('toastMsg').textContent]); ok(dbg[0] === 3, 'import restores backup ' + dbg); }
    await reload(p); ok(await p.evaluate(() => window.__sp.saved.length) === 3, 'imported signatures persisted');
    await p.click('#savedBtn');
    await p.setInputFiles('#impFile', tmp); await p.waitForTimeout(150);
    ok(await p.evaluate(() => window.__sp.saved.length) === 3 && (await toastText(p)).includes('已存在'), 'importing twice skips duplicates');
    fs.writeFileSync(tmp, '{not json'); await p.setInputFiles('#impFile', tmp); await p.waitForTimeout(150);
    { const t = await toastText(p); ok(t.includes('不是簽名備份'), 'bad backup file rejected with a message: ' + t); }
    fs.unlinkSync(tmp);
    await ctx.close();
  }

  // ---- [fix] corrupt saved data: drawer still opens, broken entry skipped ----
  {
    const { ctx, p } = await open();
    await p.evaluate(() => localStorage.setItem('sign-pad:v1:saved', JSON.stringify([
      { id: 'z', name: 'x', at: 1, strokes: [{ color: '#000', bw: 2, points: 'bad' }] },
      { id: 'y', name: '好的', at: 1, strokes: [{ color: '#000', bw: 2, points: [{ x: 0.3, y: 0.5, w: 4 }] }] },
      null, 5])));
    await p.evaluate(() => localStorage.setItem('sign-pad:v1:draft', '{"v":1,"pool":[{"points":7},null],"cur":[0,1,9],"undo":"x"}'));
    await reload(p); await p.click('#savedBtn'); await p.waitForTimeout(100);
    ok(!(await p.evaluate(() => document.getElementById('drawer').hidden)), 'drawer opens with corrupt saved data');
    ok(await p.evaluate(() => window.__sp.saved.map(s => s.name).join()) === '好的', 'broken entries dropped, good one kept');
    ok((await toastText(p)).includes('損壞'), 'user told about skipped entries');
    ok(await count(p) === 0, 'corrupt draft ignored');
    await ctx.close();
  }

  // ---- [fix] blocked storage: saving never claims success ----
  {
    const { ctx, p, cdp } = await open(PHONE, () => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    const r = await p.locator('#cv').boundingBox();
    await touch(cdp, line(r.x + 30, r.y + 80, 250, 10));
    ok((await toastText(p)).includes('無法寫入'), 'draft write failure is reported');
    await p.click('#saveBtn');
    const t = await toastText(p);
    ok(!t.startsWith('已存成') && t.includes('無法寫入'), `save with blocked storage warns (${t})`);
    await ctx.close();
  }

  ok(errs.length === 0, 'no page/console errors: ' + errs.join(' | '));
  await b.close(); server.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
