// Regression tests for image-crop (release-review fixes): node demo/tests.js  (~30 s)
// Photo + edit saved across reload, gestures during zoom animations, commands during animations, reset / replace undo,
// iOS canvas-area cap, second-finger taps, export width validation, download fallback, layout, dial inertia, details.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
let fails = 0;
const ok = (c, m) => { if (c) console.log('  ok -', m); else { fails++; console.log('FAIL -', m); } };
const mob = (w, h, o = {}) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...o });
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };
const HELPERS = () => {
  // gradient test image as a File: red rises left->right, green top->bottom
  window.__mk = async (w, h, name = 'test.png') => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#f00'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'lighter'; const v = x.createLinearGradient(0, 0, 0, h); v.addColorStop(0, '#000'); v.addColorStop(1, '#0f0'); x.fillStyle = v; x.fillRect(0, 0, w, h);
    const b = await new Promise(r => c.toBlob(r, 'image/png')); return new File([b], name, { type: 'image/png' }); };
  window.__load = async (w, h, name) => { const f = await window.__mk(w, h, name); await window.__ic.loadFile(f); };
};
(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(HTML); });
  await new Promise(r => srv.listen(0, r)); const U = `http://127.0.0.1:${srv.address().port}/`;
  const br = await chromium.launch(); const errors = [];
  const newPage = async (opts, dl = true) => { const ctx = await br.newContext(opts); await ctx.addInitScript(HELPERS); if (dl) await ctx.addInitScript(mockDl); const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); const cdp = await ctx.newCDPSession(p); return { ctx, p, cdp }; };
  const ready = p => p.waitForFunction(() => window.__ic && window.__ic.S.img && !window.__ic.busy());
  const idle = p => p.waitForFunction(() => !window.__ic.busy());
  const st = p => p.evaluate(() => { const S = window.__ic.S; return { name: S.name, sample: S.sample, iw: S.iw, ih: S.ih, k: S.k, a: +S.a.toFixed(2), fx: S.fx, fy: S.fy, ratio: window.__ic.set.ratioId, out: window.__ic.outSize(), label: document.querySelector('[data-r][aria-checked="true"]').textContent, contains: window.__ic.contains(), e: window.__ic.getEdit(), s: S.s }; });
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const tap = async (cdp, [x, y]) => { await touch(cdp, 'touchStart', [[x, y]]); await touch(cdp, 'touchEnd', []); };
  const drag = async (cdp, x0, y0, x1, y1, n = 8) => { await touch(cdp, 'touchStart', [[x0, y0]]); for (let i = 1; i <= n; i++) await touch(cdp, 'touchMove', [[x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]]); await touch(cdp, 'touchEnd', []); };
  const center = async (p, sel) => { const b = await p.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const load = async (p, w, h, name) => { await p.evaluate(([w, h, name]) => window.__load(w, h, name), [w, h, name]); await idle(p); };

  { // ---- main phone context ----
    const { ctx, p, cdp } = await newPage(mob(390, 844));
    await p.goto(U); await ready(p);
    ok(/不會上傳/.test(await p.textContent('.side p.small')), 'says photos stay on the device (不會上傳)');
    const labels = await p.$$eval('.hd', a => a.map(e => e.getAttribute('aria-label')));
    ok(labels.length === 8 && labels.every(l => /^裁切框.+把手$/.test(l) && !/[a-z]/.test(l)), 'handle labels are Chinese: ' + labels.slice(0, 3).join('、'));

    // 1. saved photo + edit survive a reload
    await load(p, 1000, 750, 'g1000x750.png');
    await tap(cdp, await center(p, '#ratio-4x5')); await idle(p);
    await p.focus('#dial'); for (let i = 0; i < 5; i++) await p.keyboard.press('ArrowRight');
    await tap(cdp, await center(p, '#rotR')); await idle(p);
    await p.waitForFunction(() => { try { const m = JSON.parse(localStorage.getItem('image-crop:v1:edit')); return m.photo && m.e.k === 1; } catch (e) { return false; } });
    const before = await st(p);
    await p.reload(); await ready(p);
    const after = await st(p);
    ok(after.name === 'g1000x750' && !after.sample && after.iw === 1000 && after.k === 1 && after.a === 5 && after.ratio === '4:5' && after.label === '5:4',
      `photo and edit restored after reload (${after.name} k${after.k} a${after.a} ${after.label})`);
    ok(after.out.w === before.out.w && after.out.h === before.out.h && Math.abs(after.e.lx - before.e.lx) < 0.5 && after.contains, `crop restored ${after.out.w}x${after.out.h} = ${before.out.w}x${before.out.h}`);

    // 2. a pan that starts during the ratio zoom animation is not swallowed (animation slowed so it is surely running)
    await tap(cdp, await center(p, '#rotL')); await tap(cdp, await center(p, '#ratio-1x1')); await idle(p);
    await p.evaluate(() => window.__ic.setAnimMs(5000));
    await tap(cdp, await center(p, '#ratio-4x5'));
    await p.waitForFunction(() => window.__ic.anim());
    const [ex, ey] = await center(p, '#editor');
    await drag(cdp, ex, ey, ex - 50, ey); await idle(p);
    let s = await st(p);
    ok(Math.abs(s.e.lx * s.s - 50) < 1.5 && s.label === '4:5', `pan during ratio animation applied: crop moved ${(s.e.lx * s.s).toFixed(1)} px (want 50)`);

    // 3. rotate tapped during the ratio animation: label and box agree
    await tap(cdp, await center(p, '#ratio-1x1')); await p.waitForFunction(() => window.__ic.anim());
    await tap(cdp, await center(p, '#ratio-4x5')); await tap(cdp, await center(p, '#rotR')); await idle(p);
    s = await st(p);
    ok(s.label === '5:4' && Math.abs(s.out.w / s.out.h - 1.25) < 0.01 && s.contains, `4:5 then rotate during animation -> label ${s.label}, crop ${s.out.w}x${s.out.h}`);

    // 4. pan right after a handle resize (during the auto zoom-back) is applied
    await tap(cdp, await center(p, '#rotL')); await tap(cdp, await center(p, '#ratio-free')); await idle(p);
    let b = await p.locator('#box').boundingBox();
    await drag(cdp, b.x + b.width - 2, b.y + b.height - 2, b.x + b.width - 100, b.y + b.height - 80);
    await p.waitForFunction(() => window.__ic.anim()); // auto zoom-back running
    const e0 = (await st(p)).e, dir = e0.lx < 0 ? -1 : 1; // pan towards the photo centre so there is room
    await drag(cdp, ex, ey, ex + 60 * dir, ey); await idle(p);
    s = await st(p);
    ok(s.k === 0 && Math.abs(Math.abs(e0.lx - s.e.lx) * s.s - 60 * Math.cos(5 * Math.PI / 180)) < 2, `pan during zoom-back applied: ${(Math.abs(e0.lx - s.e.lx) * s.s).toFixed(1)} px (want 59.8)`);
    await p.evaluate(() => window.__ic.setAnimMs(260));

    // 5. second finger taps 右轉 while the first holds the dial
    const k0 = (await st(p)).k; const d = await center(p, '#dial'), r = await center(p, '#rotR');
    await touch(cdp, 'touchStart', [d]); await touch(cdp, 'touchMove', [[d[0] - 16, d[1]]]);
    await touch(cdp, 'touchStart', [[d[0] - 16, d[1]], r]); await touch(cdp, 'touchEnd', [[d[0] - 16, d[1]]]); await touch(cdp, 'touchEnd', []);
    await idle(p); s = await st(p);
    ok(s.k === (k0 + 1) % 4, `rotate counted while the dial is held (k ${k0} -> ${s.k})`);

    // 6. one tap = one action (pointer handler + click never both fire); keyboard still works
    let k1 = (await st(p)).k; await p.click('#rotR'); await idle(p);
    ok((await st(p)).k === (k1 + 1) % 4, 'mouse click rotates exactly once');
    k1 = (await st(p)).k; await tap(cdp, await center(p, '#rotR')); await idle(p);
    ok((await st(p)).k === (k1 + 1) % 4, 'touch tap rotates exactly once');
    k1 = (await st(p)).k; await p.focus('#rotR'); await p.keyboard.press('Enter'); await idle(p);
    ok((await st(p)).k === (k1 + 1) % 4, 'keyboard Enter rotates once');

    // 7. dial fling then tap the angle: inertia stops at 0.0°
    await drag(cdp, d[0], d[1], d[0] - 120, d[1], 6);
    await tap(cdp, await center(p, '#angleBtn')); await idle(p);
    { const s7 = await st(p), t7 = (await p.textContent('#angleBtn')).trim(); ok(s7.a === 0 && t7 === '0.0°', `zero tap during dial inertia stays at 0.0° (a ${s7.a}, ${t7})`); }
    { // zero tapped with a second finger while the dial is still held, then the dial finger lifts
      await touch(cdp, 'touchStart', [d]); for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', [[d[0] - 20 * i, d[1]]]);
      const z = await center(p, '#angleBtn');
      await touch(cdp, 'touchStart', [[d[0] - 120, d[1]], z]); await touch(cdp, 'touchEnd', [z]); await touch(cdp, 'touchEnd', []);
      await idle(p); await p.waitForTimeout(400);
      ok((await st(p)).a === 0, `zero tapped while the dial is held stays at 0.0° after the dial is released (a ${(await st(p)).a})`);
    }

    // 8. reset keeps the ratio and can be undone
    await tap(cdp, await center(p, '#ratio-1x1')); await idle(p);
    await p.focus('#dial'); for (let i = 0; i < 7; i++) await p.keyboard.press('ArrowLeft');
    await tap(cdp, await center(p, '#flipH')); await idle(p);
    const pre = await st(p);
    await tap(cdp, await center(p, '#resetBtn')); await idle(p);
    s = await st(p);
    ok(s.k === 0 && s.a === 0 && s.fx === 1 && s.ratio === '1:1', 'reset clears rotation/flip but keeps the 1:1 ratio');
    ok(await p.isVisible('.toast button'), 'reset shows an undo button: ' + await p.textContent('.toast'));
    await tap(cdp, await center(p, '.toast button')); await idle(p);
    s = await st(p);
    ok(s.k === pre.k && s.a === pre.a && s.fx === pre.fx && s.out.w === pre.out.w && s.out.h === pre.out.h, `undo restores the edit (a ${s.a}, ${s.out.w}x${s.out.h})`);

    // 9. replacing the photo can be undone (and the saved photo follows)
    await load(p, 640, 480, 'second.png');
    ok((await st(p)).name === 'second' && await p.isVisible('.toast button'), 'replace photo shows undo toast');
    await tap(cdp, await center(p, '.toast button')); await idle(p);
    s = await st(p);
    ok(s.name === 'g1000x750' && s.iw === 1000 && s.a === pre.a, `undo brings back the previous photo and its edit (${s.name} ${s.iw} a${s.a}/${pre.a})`);
    await p.waitForFunction(() => { try { const m = JSON.parse(localStorage.getItem('image-crop:v1:edit')); return m.name === 'g1000x750' && m.photo; } catch (e) { return false; } });
    await p.reload(); await ready(p);
    ok((await st(p)).name === 'g1000x750' && (await st(p)).iw === 1000, 'after undo + reload the previous photo is the saved one');

    // 10. export width validation
    await p.click('#doneBtn'); await p.click('#size-width');
    for (const v of ['9000', '10', '']) {
      await p.fill('#outWidth', v);
      const w = await p.evaluate(() => ({ err: document.querySelector('#wErr').textContent, dis: document.querySelector('#exGo').disabled, info: document.querySelector('#outInfo').textContent }));
      ok(w.err && w.dis && /—/.test(w.info), `width "${v}" -> error "${w.err}", button disabled`);
    }
    await p.fill('#outWidth', '9000'); await p.locator('#outWidth').blur();
    let w = await p.evaluate(() => ({ v: document.querySelector('#outWidth').value, err: document.querySelector('#wErr').textContent, dis: document.querySelector('#exGo').disabled, info: document.querySelector('#outInfo').textContent }));
    ok(w.v === '8192' && !w.dis && /8192/.test(w.err) && /^\d+ × \d+ px/.test(w.info), `on blur 9000 is clamped to 8192 (${w.err}): ${w.info}`);
    await p.fill('#outWidth', '1200');
    ok((await p.textContent('#outInfo')).startsWith('1200 ×') && !(await p.textContent('#wErr')), 'valid width clears the error');
    await p.click('#size-orig'); await p.click('#exClose');

    // 11. old settings key still loads
    await p.evaluate(() => localStorage.setItem('image-crop:v1:settings', JSON.stringify({ ratioId: '16:9', custom: [3, 2], fmt: 'png', q: 80, sizeMode: 'orig', width: 1080 })));
    await p.reload(); await ready(p);
    ok(await p.evaluate(() => window.__ic.set.ratioId === '16:9' && window.__ic.set.fmt === 'png'), 'settings under the old key still load');

    // 12. details: floor at 45° (no output pixel outside the photo), '.png' name, full-width custom ratio
    await p.evaluate(() => window.__ic.setAngle(45)); await idle(p);
    s = await st(p);
    ok(s.out.w <= s.e.bw + 1e-6 && s.out.h <= s.e.bh + 1e-6, `45° 16:9 output ${s.out.w}x${s.out.h} within exact ${s.e.bw.toFixed(2)}x${s.e.bh.toFixed(2)}`);
    await p.click('#doneBtn'); await p.click('#exGo'); await p.waitForFunction(() => window.__saved.length > 0); await p.click('#exClose');
    const alpha = await p.evaluate(async () => { const b = await createImageBitmap(window.__saved[0].data); const c = new OffscreenCanvas(b.width, b.height), x = c.getContext('2d'); x.drawImage(b, 0, 0);
      return [[0, 0], [b.width - 1, 0], [0, b.height - 1], [b.width - 1, b.height - 1]].map(([u, v]) => x.getImageData(u, v, 1, 1).data[3]); });
    ok(alpha.every(a => a === 255), '45° PNG corners fully opaque: ' + alpha);
    await load(p, 300, 200, '.png');
    ok((await st(p)).name === 'image', '".png" file -> name "image"');
    await p.click('#ratio-custom'); await p.fill('#cw', '３'); await p.fill('#ch', '２'); await p.click('#cApply'); await idle(p);
    s = await st(p);
    ok(!(await p.textContent('#cErr')) && Math.abs(s.out.w / s.out.h - 1.5) < 0.02, `full-width ３：２ accepted -> ${s.out.w}x${s.out.h}`);

    // 13. iOS canvas area cap
    await p.click('#ratio-free'); await load(p, 5712, 4284, 'big.png');
    const f = await p.evaluate(() => window.__ic.finalSize());
    await p.click('#doneBtn');
    const info = await p.textContent('#outInfo');
    ok(f.capped && f.w * f.h <= 16777216 && Math.abs(f.w / f.h - 5712 / 4284) < 0.002 && /縮小/.test(info), `24 MP output capped to ${f.w}x${f.h}: ${info}`);
    await p.click('#exClose');
    await ctx.close();
  }

  { // ---- no downloads API: real download link ----
    const { ctx, p } = await newPage(mob(390, 844), false);
    await p.goto(U); await ready(p);
    await p.click('#doneBtn'); await p.click('#exGo'); await p.waitForSelector('#dlLink', { state: 'visible' });
    const a = await p.evaluate(() => ({ href: document.querySelector('#dlLink').href, dl: document.querySelector('#dlLink').getAttribute('download'), hint: document.querySelector('#outHint').textContent }));
    ok(a.href.startsWith('blob:') && /-crop\.(jpg|png|webp)$/.test(a.dl) && !/無法直接下載/.test(a.hint), `download link ${a.dl}, hint "${a.hint}"`);
    // headless Chromium drops non-ASCII download names, so check the real download with an ASCII-named photo
    await p.click('#exClose'); await load(p, 400, 300, 'shot.png'); await p.click('#doneBtn'); await p.click('#exGo'); await p.waitForSelector('#dlLink', { state: 'visible' });
    const [dlEv] = await Promise.all([p.waitForEvent('download'), p.click('#dlLink')]);
    ok(dlEv.suggestedFilename() === 'shot-crop.jpg', 'clicking 下載 downloads ' + dlEv.suggestedFilename());
    await ctx.close();
  }

  // ---- layout: tools / dial on the first screen, size tag clear of handles ----
  for (const [vw, vh, sel] of [[360, 640, '.tools'], [390, 844, '.tools'], [430, 932, '.tools'], [844, 390, '.dialWrap'], [844, 390, '.tools']]) {
    const { ctx, p } = await newPage(mob(vw, vh));
    await p.goto(U); await ready(p);
    const r = await p.evaluate(sel => { const b = document.querySelector(sel).getBoundingClientRect(), t = document.querySelector('#sizeTag').getBoundingClientRect();
      const hit = [...document.querySelectorAll('.hd')].some(h => { const q = h.getBoundingClientRect(); return t.left < q.right && t.right > q.left && t.top < q.bottom && t.bottom > q.top; });
      return { bottom: Math.round(b.bottom), ih: innerHeight, hit, sw: document.documentElement.scrollWidth }; }, sel);
    ok(r.bottom <= r.ih && !r.hit && r.sw <= vw, `${vw}x${vh}: ${sel} bottom ${r.bottom} <= ${r.ih}, size tag clear of handles`);
    await ctx.close();
  }

  await br.close(); srv.close();
  ok(errors.length === 0, 'no console / page errors ' + JSON.stringify(errors.slice(0, 3)));
  console.log(fails ? `FAIL ${fails} check(s)` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); console.log('FAIL', String(e)); process.exit(1); });
