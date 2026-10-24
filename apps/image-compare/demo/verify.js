// Visual and flow check for 圖片比較 (image-compare) in Chromium.
// - every lobby iframe size plus 390×844, 360×640, 430×932 and 844×390 landscape, light and dark:
//   no page/console errors, no sideways scroll, every mode renders, both sheets open with their main button on screen
// - first-load time, frame rate while dragging the divider over two 12 MP photos zoomed in, offline use
// - writes demo/cover-390x520.png (lobby cover) and screenshots to $SHOTS_DIR (default: OS temp dir/image-compare-shots)
// Usage: node verify.js   (--perf: only the load / frame-rate / offline part)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = path.resolve(__dirname, '..', 'index.html'), OUT = process.env.SHOTS_DIR || path.join(require('os').tmpdir(), 'image-compare-shots');
fs.mkdirSync(OUT, { recursive: true });
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const SIZES = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [1280, 800]];

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(SKELETON + fs.readFileSync(HTML, 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, r)); const URL0 = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const open = async (w, h, scheme, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage(); const errs = [], ext = [];
    page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(URL0) && !/^(data|blob):/.test(r.url())) ext.push(r.url()); });
    if (opts.init) await page.addInitScript(opts.init);
    const t0 = Date.now(); await page.goto(URL0); await page.evaluate(() => window.__ic.ready); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    return { ctx, page, errs, ext, loadMs: Date.now() - t0 };
  };
  const inView = (page, sel) => page.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1; }, sel);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const PERF_ONLY = process.argv.includes('--perf');
  if (!PERF_ONLY) for (const [w, h] of SIZES) for (const scheme of ['light', 'dark']) {
    const { ctx, page, errs, ext } = await open(w, h, scheme);
    const tag = `${w}x${h}-${scheme}`;
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(ov <= 0, `${tag}: no sideways scroll (${ov})`);
    for (const sel of ['#exportBtn', '#adjBtn', '#themeBtn', '[data-mode="diff"]', '#slotA', '#slotB', '#swapBtn', '#divider .knob']) ok(await inView(page, sel), `${tag}: ${sel} fully on screen`);
    const stageH = await page.evaluate(() => document.getElementById('stage').getBoundingClientRect().height); ok(stageH >= 190, `${tag}: compare area ${Math.round(stageH)} px tall`);
    await page.screenshot({ path: path.join(OUT, `${tag}-slider.png`) });
    for (const m of ['side', 'onion', 'diff']) {
      await page.click(`[data-mode="${m}"]`); await wait(120);
      const painted = await page.evaluate(() => { const c = document.getElementById('cv'), x = c.getContext('2d'); return [[.25, .5], [.75, .5], [.5, .25], [.5, .75]].some(([u, v]) => x.getImageData(Math.floor(c.width * u), Math.floor(c.height * v), 1, 1).data[3] > 0); });
      ok(painted, `${tag}: ${m} view paints`);
      if (w === 390 && h === 844 || w === 375) await page.screenshot({ path: path.join(OUT, `${tag}-${m}.png`) });
    }
    await page.click('[data-mode="slider"]');
    await page.click('#adjBtn'); await wait(350); ok(await inView(page, '#adjSheet [data-close]'), `${tag}: size sheet close button on screen`);
    if (w === 375 || w === 844) await page.screenshot({ path: path.join(OUT, `${tag}-adjust.png`) });
    await page.keyboard.press('Escape'); await wait(350);
    await page.click('#exportBtn'); await wait(800);
    ok(await inView(page, '#goBtn'), `${tag}: export button on screen without scrolling`);
    ok(await inView(page, '#pv'), `${tag}: export preview on screen`);
    if (w === 375 || w === 844 || w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `${tag}-export.png`) });
    await page.click('#goBtn'); await page.waitForFunction(() => window.__ic.EX.blob, null, { timeout: 30000 });
    ok(await inView(page, '#saveBtn'), `${tag}: 下載 button on screen after export`);
    if (w === 375) await page.screenshot({ path: path.join(OUT, `${tag}-exported.png`) });
    await page.keyboard.press('Escape'); await wait(350);
    ok(errs.length === 0, `${tag}: no errors` + (errs.length ? ': ' + errs[0] : ''));
    ok(ext.length === 0, `${tag}: no network requests`);
    await ctx.close();
  }

  // Lobby cover: the sample at its most attractive.
  {
    const { ctx, page } = await open(390, 520, 'light', { init: () => { try { localStorage.setItem('image-compare:v1:settings', JSON.stringify({ hintSeen: true, split: 0.44 })); } catch (e) {} } });
    await wait(250); await page.screenshot({ path: path.join(__dirname, 'cover-390x520.png') }); ok(fs.statSync(path.join(__dirname, 'cover-390x520.png')).size > 20000, 'cover written');
    await ctx.close();
  }

  // First load and frame rate with two 12 MP photos, zoomed 3×, dragging the divider for 3 s.
  {
    const { ctx, page, loadMs } = await open(390, 844, 'light');
    ok(loadMs < 1500, `first load to usable: ${loadMs} ms`);
    const mk = await page.evaluate(async () => {
      const mkf = async (hue, name) => { const c = document.createElement('canvas'); c.width = 4000; c.height = 3000; const x = c.getContext('2d');
        for (let i = 0; i < 60; i++) { x.fillStyle = `hsl(${hue + i * 3},60%,${30 + (i % 7) * 7}%)`; x.fillRect((i * 997) % 4000, (i * 631) % 3000, 900, 700); }
        return new File([await new Promise(r => c.toBlob(r, 'image/jpeg', .85))], name, { type: 'image/jpeg' }); };
      const t0 = performance.now(); await window.__ic.takeFiles([await mkf(10, 'a.jpg'), await mkf(40, 'b.jpg')]); return performance.now() - t0;
    });
    ok(mk < 8000, `two 12 MP JPEGs decoded and shown in ${Math.round(mk)} ms (spinner after 180 ms)`);
    await page.evaluate(() => { const { S } = window.__ic; S.view.z = 3; });
    const cdp = await ctx.newCDPSession(page);
    const box = await page.evaluate(() => { const r = document.getElementById('divider').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.evaluate(() => { window.__fr = []; const loop = t => { window.__fr.push(t); if (window.__fr.length < 100000) requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    const T = Date.now(); let i = 0; while (Date.now() - T < 3000) { const x = 60 + 270 * (0.5 + 0.5 * Math.sin(i++ / 8)); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: box.y }] }); await wait(8); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const fr = await page.evaluate(() => { const f = window.__fr; const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); d.sort((a, b) => a - b); return { fps: (f.length - 1) / ((f[f.length - 1] - f[0]) / 1000), p95: d[Math.floor(d.length * .95)] }; });
    console.log(`  divider drag over 12 MP pair at 3×: ${fr.fps.toFixed(1)} fps, 95th percentile frame ${fr.p95.toFixed(1)} ms (software rendering)`);
    const cost = await page.evaluate(() => { const { set } = window.__ic; const t = performance.now(); for (let i = 0; i < 40; i++) { set.split = 0.2 + (i % 10) * 0.06; window.__ic.render(); } return (performance.now() - t) / 40; });
    console.log(`  main-thread cost per divider frame: ${cost.toFixed(2)} ms; host load average ${require('os').loadavg()[0].toFixed(1)} on ${require('os').cpus().length} cores`);
    ok(cost < 4, `divider frame costs ${cost.toFixed(2)} ms of script (budget 16 ms)`);
    // diff mode on the 12 MP pair: first diff and tolerance changes
    const dt = await page.evaluate(async () => { const { setMode, set } = window.__ic; let t = performance.now(); setMode('diff'); while (!(window.__ic.S.work && window.__ic.S.work.prep)) await new Promise(r => setTimeout(r, 10)); const first = performance.now() - t;
      const el = document.getElementById('dv'); const times = []; for (let v = 0; v < 10; v++) { t = performance.now(); el.value = v * 5; el.dispatchEvent(new Event('input')); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); times.push(performance.now() - t); }
      const t2 = performance.now(); for (let v = 0; v < 10; v++) { set.tol = v * 6; window.__ic.ensureDiff(); } const script = (performance.now() - t2) / 10;
      return { first, avg: times.reduce((a, b) => a + b) / times.length, script }; });
    console.log(`  difference view: first ${Math.round(dt.first)} ms, tolerance change ${Math.round(dt.avg)} ms to screen, ${Math.round(dt.script)} ms of script (1600×1200 comparison)`);
    ok(dt.first < 4000 && dt.script < 150, `difference view on 12 MP: tolerance change ${Math.round(dt.script)} ms of script (spinner shown while the first pass runs)`);
    await ctx.close();
  }

  // Offline: load, cut the network, everything still works (export included).
  {
    const { ctx, page, errs } = await open(390, 844, 'light');
    await ctx.setOffline(true);
    for (const m of ['side', 'onion', 'diff', 'slider']) await page.click(`[data-mode="${m}"]`);
    await page.click('#exportBtn'); await wait(300); await page.click('[data-fmt="gif"]'); await page.click('#goBtn');
    const ok1 = await page.waitForFunction(() => window.__ic.EX.blob, null, { timeout: 30000 }).then(() => true, () => false);
    ok(ok1 && errs.length === 0, 'offline: every mode and GIF export work');
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception', e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
