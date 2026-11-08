// Unit tests for 鏡子 (mirror), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {ZMIN,ZMAX,clampZoom,clampPan,zoomAt,pinch,doubleTapZoom,coverRect,visibleSource,mirrorRect,mirrorX,bcFactors,filterCSS,applyBC,RING_TONES,ringPx,photoName,DEFAULTS,sanitizeSettings,nextZoomStep,photoSize,camErrorKind};')();
let pass = 0, fail = 0;
function t(name, cond, extra) { if (cond) pass++; else { fail++; console.log('FAIL', name, extra || ''); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const W = 390, H = 844;
// view rect [0,W]x[0,H] must be inside the scaled layer [tx, tx+zW]x[ty, ty+zH]
const covers = s => s.tx <= 1e-9 && s.ty <= 1e-9 && s.tx + s.z * W >= W - 1e-9 && s.ty + s.z * H >= H - 1e-9;

// --- zoom limits ---
t('zoom clamps to 1..5', C.clampZoom(0.3) === 1 && C.clampZoom(9) === 5 && C.clampZoom(2.2) === 2.2 && C.clampZoom(NaN) === 1);
t('double tap 1 -> 2.5 -> 1', C.doubleTapZoom(1) === 2.5 && C.doubleTapZoom(2.5) === 1 && C.doubleTapZoom(4) === 1);

// --- pan clamping: never show black edges ---
t('at 1x pan is locked to 0', JSON.stringify(C.clampPan(1, 50, -80, W, H)) === '{"tx":0,"ty":0}');
t('at 2x cannot drag past the left/top edge', JSON.stringify(C.clampPan(2, 100, 100, W, H)) === '{"tx":0,"ty":0}');
t('at 2x cannot drag past the right/bottom edge', (p => p.tx === -W && p.ty === -H)(C.clampPan(2, -9999, -9999, W, H)));
t('at 5x max pan = 4 view sizes', (p => p.tx === -4 * W && p.ty === -4 * H)(C.clampPan(5, -1e6, -1e6, W, H)));
t('inside range untouched', (p => p.tx === -100 && p.ty === -200)(C.clampPan(3, -100, -200, W, H)));

// --- zoom about a point ---
{ const s = C.zoomAt({ z: 1, tx: 0, ty: 0 }, 2, W / 2, H / 2, W, H);
  t('zoom 2x at center keeps center', near(s.tx, -W / 2) && near(s.ty, -H / 2) && s.z === 2);
  const s2 = C.zoomAt({ z: 1, tx: 0, ty: 0 }, 2.5, 100, 300, W, H);
  t('point under finger stays put', near((100 - s2.tx) / s2.z, 100) && near((300 - s2.ty) / s2.z, 300));
  const s3 = C.zoomAt({ z: 1, tx: 0, ty: 0 }, 3, 0, 0, W, H);
  t('zoom at the corner stays covered', covers(s3) && s3.tx === 0 && s3.ty === 0);
  const s4 = C.zoomAt({ z: 4, tx: -3 * W, ty: -3 * H }, 1.5, W, H, W, H);
  t('zoom out from the far corner re-clamps', covers(s4) && near(s4.tx, W - 1.5 * W) && near(s4.ty, H - 1.5 * H));
  t('zoom capped at 5x', C.zoomAt({ z: 4, tx: 0, ty: 0 }, 20, 10, 10, W, H).z === 5);
  t('zoom out to 1x resets pan', JSON.stringify(C.zoomAt({ z: 3, tx: -200, ty: -300 }, 0.2, 50, 50, W, H)) === '{"z":1,"tx":0,"ty":0}'); }

// --- pinch ---
{ const s0 = { z: 1, tx: 0, ty: 0 }, m = { x: 200, y: 400 };
  const s = C.pinch(s0, 100, 300, m, m, W, H);
  t('pinch spread 3x -> z 3', near(s.z, 3));
  t('pinch keeps the midpoint content fixed', near((m.x - s.tx) / s.z, 200) && near((m.y - s.ty) / s.z, 400));
  const s2 = C.pinch(s0, 100, 2000, m, m, W, H);
  t('pinch to 5x max', s2.z === 5 && covers(s2));
  const s3 = C.pinch({ z: 3, tx: -390, ty: -844 }, 300, 100, m, m, W, H);
  t('pinch close back to 1x covers the view', near(s3.z, 1) && covers(s3));
  const s4 = C.pinch(s0, 100, 200, m, { x: 260, y: 400 }, W, H);
  t('two-finger drag pans while zooming', near((260 - s4.tx) / s4.z, 200));
  let ok = true, s5 = { z: 1, tx: 0, ty: 0 };
  for (let i = 0; i < 2000; i++) { const r = (k => ((Math.sin(i * 9.1 + k) + 1) / 2))(0);
    s5 = C.pinch(s5, 100, 50 + 150 * r, { x: (i * 37) % W, y: (i * 91) % H }, { x: (i * 53) % W, y: (i * 17) % H }, W, H);
    if (!covers(s5) || s5.z < 1 || s5.z > 5) ok = false; }
  t('2,000 random pinches never expose an edge', ok);
  t('degenerate pinch distance survives', isFinite(C.pinch(s0, 0, 0, m, m, W, H).z)); }

// --- cover layout & what is visible ---
{ const r = C.coverRect(1280, 720, W, H);
  t('landscape camera in portrait view: height fills', near(r.h, H) && near(r.w, 1280 * H / 720) && near(r.y, 0) && near(r.x, (W - r.w) / 2));
  const r2 = C.coverRect(720, 1280, W, H);
  t('portrait camera: width fills', near(r2.w, W) || near(r2.h, H));
  t('cover always covers', r2.w >= W - 1e-9 && r2.h >= H - 1e-9);
  const v = C.visibleSource(1280, 720, W, H, 1, 0, 0);
  t('1x: visible strip is centered, full height', near(v.sy, 0) && near(v.sh, 720) && near(v.sx + v.sw / 2, 640) && near(v.sw / v.sh, W / H));
  const v2 = C.visibleSource(1280, 720, W, H, 2, -W / 2, -H / 2);
  t('2x at center: half size, same center', near(v2.sw, v.sw / 2) && near(v2.sh, 360) && near(v2.sx + v2.sw / 2, 640) && near(v2.sy + v2.sh / 2, 360));
  const v3 = C.visibleSource(1280, 720, W, H, 5, 0, 0);
  t('5x top-left corner of view', near(v3.sx, v.sx) && near(v3.sy, 0) && near(v3.sw, v.sw / 5));
  const v4 = C.visibleSource(1280, 720, W, H, 5, W - 5 * W, H - 5 * H);
  t('5x bottom-right stays inside the frame', v4.sx + v4.sw <= 1280 + 1e-6 && v4.sy + v4.sh <= 720 + 1e-6 && near(v4.sx + v4.sw, v.sx + v.sw)); }

// --- mirrored capture coordinates ---
t('mirrorX', C.mirrorX(0, 1280) === 1279 && C.mirrorX(1279, 1280) === 0 && C.mirrorX(640, 1280) === 639);
{ const r = C.mirrorRect({ sx: 100, sy: 50, sw: 300, sh: 200 }, 1280);
  t('left part of the mirror = right part of the raw frame', r.sx === 880 && r.sy === 50 && r.sw === 300 && r.sh === 200);
  t('mirrorRect is its own inverse', JSON.stringify(C.mirrorRect(r, 1280)) === JSON.stringify({ sx: 100, sy: 50, sw: 300, sh: 200 }));
  const v = C.visibleSource(1280, 720, W, H, 1, 0, 0), m = C.mirrorRect(v, 1280);
  t('centered 1x view is symmetric under mirroring', near(m.sx, v.sx)); }
// a mirrored frame: pixel at displayed x is raw pixel W-1-x
{ const w = 8, raw = Array.from({ length: w }, (_, i) => i * 10), disp = raw.map((_, x) => raw[C.mirrorX(x, w)]);
  t('mirrored row reversed', JSON.stringify(disp) === JSON.stringify(raw.slice().reverse())); }

// --- brightness / contrast ---
t('filter none at 0/0', C.filterCSS(0, 0) === 'none');
t('filter string', C.filterCSS(20, -10) === 'brightness(1.2) contrast(0.9)');
t('factors -50..50 -> 0.5..1.5', near(C.bcFactors(-50, 50).b, 0.5) && near(C.bcFactors(-50, 50).c, 1.5));
{ const px = new Uint8ClampedArray([100, 200, 255, 255, 0, 128, 64, 7]);
  C.applyBC(px, 0, 0); t('applyBC 0/0 is identity', JSON.stringify([...px]) === '[100,200,255,255,0,128,64,7]');
  const a = new Uint8ClampedArray([100, 200, 255, 77]); C.applyBC(a, 20, 0);
  t('brightness +20 multiplies by 1.2, clamps, keeps alpha', a[0] === 120 && a[1] === 240 && a[2] === 255 && a[3] === 77);
  const b = new Uint8ClampedArray([255, 0, 128, 255]); C.applyBC(b, 0, 50);
  t('contrast +50 pushes away from mid grey', b[0] === 255 && b[1] === 0 && Math.abs(b[2] - 128) <= 1);
  const c = new Uint8ClampedArray([200, 50, 0, 255]); C.applyBC(c, 0, -50);
  t('contrast -50 pulls toward mid grey', c[0] === Math.round((0.5 + (200 / 255 - 0.5) * 0.5) * 255) && c[1] === Math.round((0.5 + (50 / 255 - 0.5) * 0.5) * 255)); }

// --- ring light, file name, settings ---
t('ring width % of stage width', C.ringPx(12, 390) === 47 && C.ringPx(0, 390) === 0 && C.ringPx(99, 400) === 100);
t('ring tones', C.RING_TONES.neutral === '#ffffff' && !!C.RING_TONES.warm && !!C.RING_TONES.cool);
t('photo file name', C.photoName(new Date(2026, 9, 7, 14, 32, 5)) === 'mirror-20261007-143205.jpg');
t('settings defaults', JSON.stringify(C.sanitizeSettings(null)) === JSON.stringify(C.DEFAULTS));
{ const s = C.sanitizeSettings({ mirrored: false, brightness: 80, contrast: '-12', ring: { on: 1, width: 40, tone: 'pink' }, facing: 'environment' });
  t('settings sanitized', s.mirrored === true && s.mirroredEnv === false && s.brightness === 50 && s.contrast === -12 && s.ring.on === true && s.ring.width === 25 && s.ring.tone === 'neutral' && s.facing === 'environment'); }
t('defaults not mutated by sanitize', C.DEFAULTS.ring.width === 12 && (C.sanitizeSettings({}).ring.width = 3, C.DEFAULTS.ring.width === 12));


// --- review fixes (2026-11-08) ---
t('zoom chip cycles 1 -> 2 -> 3 -> 1', C.nextZoomStep(1) === 2 && C.nextZoomStep(2) === 3 && C.nextZoomStep(3) === 1 && C.nextZoomStep(1.4) === 2 && C.nextZoomStep(2.5) === 3 && C.nextZoomStep(5) === 1);
t('ring width 0 loads as off', (s => s.ring.on === false && s.ring.width === 0)(C.sanitizeSettings({ ring: { on: true, width: 0 } })) && C.sanitizeSettings({ ring: { on: true, width: 5 } }).ring.on === true);
{ const a = C.sanitizeSettings({ mirrored: false, facing: 'user' }), b = C.sanitizeSettings({ mirrored: false, facing: 'environment' }), c = C.sanitizeSettings({ mirrored: false, mirroredEnv: true, facing: 'environment' });
  t('front/back mirror kept apart (old mirror.v1 data migrates)', a.mirrored === false && a.mirroredEnv === false && b.mirrored === true && b.mirroredEnv === false && c.mirrored === false && c.mirroredEnv === true); }
t('photo upscaled to the view pixels, never shrunk, capped at 4096', (s => s.w === 780 && Math.abs(s.h - 144.9 * 780 / 67) <= 1)(C.photoSize(67, 144.9, 780)) && (s => s.w === 1000 && s.h === 500)(C.photoSize(1000, 500, 780)) && C.photoSize(10, 4000, 1e6).h === 4096);
t('blocked camera at top level -> how to allow, not "open the website"', C.camErrorKind('NotAllowedError', { quick: true, inFrame: false }) === 'blocked' && C.camErrorKind('NotAllowedError', { quick: false }) === 'denied');
t('embedded page without camera -> website link', C.camErrorKind('NotAllowedError', { quick: true, inFrame: true }) === 'env' && C.camErrorKind('SecurityError', { policyBlocked: true }) === 'env' && C.camErrorKind('NotAllowedError', { quick: false, inFrame: true }) === 'denied');
t('other errors are classified, not shown raw', C.camErrorKind('NotSupportedError') === 'other' && C.camErrorKind('TypeError') === 'other' && C.camErrorKind('NotFoundError') === 'nocam' && C.camErrorKind('NotReadableError') === 'busy');
t('no raw e.message in the error box', !/errBox\([^\n]*e\.message/.test(html));

// --- in the browser (fake camera, real CDP touch) ---
(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { chromium = null; } }
  if (!chromium) { console.log('playwright missing: browser checks skipped'); return; }
  const http = require('http');
  const SK = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    if (q.url.startsWith('/frame')) r.end(`<!doctype html><body style="margin:0"><iframe src="http://localhost:${srv.address().port}/" style="border:0;width:390px;height:700px"></iframe></body>`); else r.end(SK + html + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const errs = [];
  async function open(w, h, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, permissions: ['camera'], ...opt });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    const cdp = await ctx.newCDPSession(p); return { ctx, p, cdp };
  }
  const W = (p, fn, arg, ms = 5000) => p.waitForFunction(fn, arg, { timeout: ms });
  try {
    // ---- touch on the live mirror ----
    { const { ctx, p, cdp } = await open(390, 844);
      const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q.x, y: q.y, id: q.id })) });
      const ctr = sel => p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
      const hold = (ms) => p.evaluate(ms => new Promise(r => setTimeout(r, ms)), ms);
      async function tap(pt, ms = 40, id = 1) { await T('touchStart', [{ ...pt, id }]); await hold(ms); await T('touchEnd', []); }
      await p.goto(url); await p.evaluate(() => { window.__clicks = 0; document.addEventListener('click', () => window.__clicks++); });
      await tap(await ctr('#startBtn'));
      await W(p, () => document.getElementById('video').videoWidth > 0 && !document.getElementById('stage').hidden, null, 10000);
      t('gesture hint on first open, remembered', await p.evaluate(() => !document.getElementById('gHint').hidden && localStorage.getItem('mirror.hint') === '1'));
      await W(p, () => document.getElementById('gHint').hidden);
      const M = () => p.evaluate(() => ({ frozen: __mirror.st.frozen, ring: __mirror.S.ring.on, z: __mirror.st.z, drawer: !document.getElementById('drawer').hidden, bare: document.getElementById('stage').classList.contains('bare') }));
      const reset = () => p.evaluate(() => { const d = document.getElementById('drawer'); if (!d.hidden) document.getElementById('doneAdj').click(); document.getElementById('stage').classList.remove('bare'); if (__mirror.st.frozen) __mirror.unfreeze(); });
      const glass = { x: 195, y: 420 };
      // another finger already down: on the glass, or on another button; either lift order
      let multi = 0, multiN = 0;
      for (const anchor of ['glass', 'save']) for (const id of ['#freezeBtn', '#adjBtn', '#zoomBtn']) for (const order of ['B', 'A']) {
        await reset(); await hold(60);
        const A = anchor === 'glass' ? glass : await ctr('#saveBtn'), B = await ctr(id), s0 = await M();
        await T('touchStart', [{ ...A, id: 0 }]); await hold(150);
        await T('touchStart', [{ ...A, id: 0 }, { ...B, id: 1 }]); await hold(60);
        if (order === 'B') { await T('touchEnd', [{ ...A, id: 0 }]); await hold(80); await T('touchEnd', []); } else { await T('touchEnd', [{ ...B, id: 1 }]); await hold(30); await T('touchEnd', []); }
        await hold(380); const s1 = await M(); multiN++;
        const key = { '#freezeBtn': 'frozen', '#ringBtn': 'ring', '#adjBtn': 'drawer', '#zoomBtn': 'z' }[id];
        if (s1[key] !== s0[key] && (anchor !== 'glass' || s1.bare === s0.bare)) multi++; else console.log('  multi-finger miss', anchor, id, order, JSON.stringify(s0), JSON.stringify(s1));
        if (s1.ring !== s0.ring && id !== '#ringBtn') multi = -99;
      }
      t('button taps work with another finger already down (and the resting finger does not toggle the controls)', multi === multiN, multi + '/' + multiN);
      await reset(); await p.evaluate(() => { __mirror.setZoom(1); if (__mirror.S.ring.on) document.getElementById('ringBtn').click(); });
      // slow taps on buttons fire once
      for (const ms of [600, 1000]) { const r0 = await p.evaluate(() => __mirror.S.ring.on); await tap(await ctr('#ringBtn'), ms); await hold(50);
        t(`button held ${ms} ms fires once`, await p.evaluate(r0 => __mirror.S.ring.on === !r0, r0)); }
      // fast alternating taps: no double fire
      { const r0 = await p.evaluate(() => __mirror.S.ring.on), f0 = await p.evaluate(() => __mirror.st.frozen);
        for (let i = 0; i < 6; i++) { await tap(await ctr(i % 2 ? '#freezeBtn' : '#ringBtn'), 30); await hold(90); }
        t('6 quick alternating taps -> 3 + 3 actions', await p.evaluate(([r0, f0]) => __mirror.S.ring.on === !!(r0 ^ 1) && __mirror.st.frozen === !!(f0 ^ 1), [r0, f0])); }
      await reset(); await hold(50);
      // slow tap on the glass toggles the controls (0.6 s and 1 s), first tap shows them at once
      for (const ms of [600, 1000]) { await tap(glass, ms); await W(p, () => document.getElementById('stage').classList.contains('bare'), null, 2000).catch(() => {});
        t(`glass held ${ms} ms hides the controls`, await p.evaluate(() => document.getElementById('stage').classList.contains('bare')));
        await tap(glass, ms); t(`glass held ${ms} ms shows them again at once`, await p.evaluate(() => !document.getElementById('stage').classList.contains('bare'))); await hold(400); }
      // ghost clicks: controls hidden, tap where the shutter / zoom / save are; they appear under the finger but must not fire
      for (const sel of ['#freezeBtn', '#zoomBtn', '#saveBtn']) for (const ms of [60, 600, 1000]) {
        await reset(); await p.evaluate(() => { __mirror.setZoom(1); document.getElementById('stage').classList.add('bare'); }); await hold(260);
        const pt = await ctr(sel), s0 = await M(), c0 = await p.evaluate(() => __clicks);
        await tap(pt, ms); await hold(380); const s1 = await M();
        t(`no ghost: tap on hidden ${sel} (${ms} ms) only shows the controls`, !s1.bare && s1.frozen === s0.frozen && s1.z === s0.z && await p.evaluate(c0 => __clicks === c0, c0), JSON.stringify(s1));
      }
      // double tap where the controls appear still zooms
      // (a double tap is timing by nature: an attempt whose two lifts landed > 300 ms apart on a loaded machine is retried)
      await p.evaluate(() => { window.__ups = []; addEventListener('pointerup', () => __ups.push(performance.now()), true); });
      for (let k = 0, done = false; k < 5 && !done; k++) {
        await reset(); await p.evaluate(() => { __mirror.setZoom(1); document.getElementById('stage').classList.add('bare'); __ups.length = 0; }); await hold(400);
        const pt = await ctr('#zoomBtn'); await tap(pt, 10); await tap(pt, 10); await hold(380);
        const r = await p.evaluate(() => ({ z: __mirror.st.z, bare: document.getElementById('stage').classList.contains('bare'), gap: __ups[1] - __ups[0] }));
        if (r.gap < 300 || k === 4) { done = true; t('double tap on hidden controls zooms and keeps them hidden', r.z === 2.5 && r.bare, JSON.stringify(r)); }
      }
      await reset(); await hold(50);
      // zoom chip steps
      await p.evaluate(() => __mirror.setZoom(1)); const zs = [];
      for (let i = 0; i < 3; i++) { await tap(await ctr('#zoomBtn')); await hold(60); zs.push(await p.evaluate(() => __mirror.st.z)); }
      t('zoom chip 1x -> 2x -> 3x -> 1x', zs.join() === '2,3,1', zs.join());
      // drawer: 44 px targets, ring width 0 = off, reset can be undone
      await tap(await ctr('#adjBtn')); await hold(80);
      const small = await p.evaluate(() => [...document.querySelectorAll('#drawer button, #drawer input')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent, r.width, r.height]; }).filter(x => x[1] < 44 || x[2] < 44));
      t('drawer controls are at least 44×44', !small.length, JSON.stringify(small));
      await p.evaluate(() => { const r = document.getElementById('ringW'); r.value = 0; r.dispatchEvent(new Event('input')); });
      t('ring width 0 -> ring off, switch off', await p.evaluate(() => !__mirror.S.ring.on && document.getElementById('ringBtn').getAttribute('aria-pressed') === 'false' && JSON.parse(localStorage.getItem('mirror.v1')).ring.on === false));
      await p.evaluate(() => { const r = document.getElementById('bri'); r.value = 30; r.dispatchEvent(new Event('input')); });
      t('slider change saved immediately', await p.evaluate(() => JSON.parse(localStorage.getItem('mirror.v1')).brightness === 30));
      t('filter on the camera picture', await p.evaluate(() => /brightness\(1\.3\)/.test(getComputedStyle(document.getElementById('video')).filter)));
      const rw = await p.evaluate(() => document.getElementById('resetAdj').getBoundingClientRect().width);
      await tap(await ctr('#resetAdj')); await hold(60);
      t('reset -> 0, the button becomes 復原 in place', await p.evaluate(rw => __mirror.S.brightness === 0 && document.getElementById('resetAdj').textContent === '復原' && Math.abs(document.getElementById('resetAdj').getBoundingClientRect().width - rw) < 1, rw));
      await tap(await ctr('#resetAdj')); await hold(60);
      t('復原 restores brightness (and is saved)', await p.evaluate(() => __mirror.S.brightness === 30 && JSON.parse(localStorage.getItem('mirror.v1')).brightness === 30 && document.getElementById('resetAdj').textContent === '重設'));
      await p.evaluate(() => { const r = document.getElementById('bri'); r.value = 0; r.dispatchEvent(new Event('input')); });
      await tap(await ctr('#doneAdj')); await hold(60);
      t('完成 closes the drawer', await p.evaluate(() => document.getElementById('drawer').hidden));
      // frozen tag colour, photo resolution, close asks first
      await tap(await ctr('#freezeBtn')); await hold(60);
      t('已凍結 tag in the bulb colour, not blue', await p.evaluate(() => !/10, 132, 255/.test(getComputedStyle(document.getElementById('tagFrozen')).backgroundColor)));
      await p.evaluate(() => __mirror.setZoom(5));
      t('5x photo upscaled to the view pixels', await p.evaluate(() => { const c = __mirror.photoCanvas(); return c.width >= 780 - 1 && Math.abs(c.width / c.height - 390 / 844) < 0.02; }));
      await tap(await ctr('#closeBtn')); await hold(60);
      t('關閉 while frozen asks first', await p.evaluate(() => !document.getElementById('stage').hidden && /仍要關閉/.test(document.getElementById('toastActs').textContent)));
      await tap(await ctr('#toastActs button:last-child')); await hold(60);
      t('仍要關閉 closes', await p.evaluate(() => document.getElementById('stage').hidden && !document.getElementById('intro').hidden));
      await tap(await ctr('#startBtn')); await W(p, () => document.getElementById('video').videoWidth > 0 && !document.getElementById('stage').hidden, null, 10000);
      t('hint not shown again', await p.evaluate(() => document.getElementById('gHint').hidden));
      await ctx.close(); }
    // ---- 改用相機鏡子 inside the glass (light mode) at every hold; taps on the lit ring ----
    for (const [w, h] of [[390, 844], [844, 390]]) { const { ctx, p, cdp } = await open(w, h);
      const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q.x, y: q.y, id: 1 })) });
      const ctr = sel => p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel);
      const tap = async (pt, ms) => { await T('touchStart', [pt]); await p.waitForTimeout(ms); await T('touchEnd', []); };
      await p.goto(url);
      for (const ms of [60, 600, 1000]) {
        await tap(await ctr('#lightBtn'), 40); await W(p, () => __mirror.st.mode === 'light' && !document.getElementById('fillMsg').hidden);
        await tap(await ctr('#retryCam'), ms);
        let ok = true; await W(p, () => __mirror.st.mode === 'cam' && document.getElementById('video').videoWidth > 0, null, 8000).catch(() => { ok = false; });
        t(`${w}×${h} 改用相機鏡子 held ${ms} ms switches to the camera`, ok && await p.evaluate(() => !document.getElementById('stage').classList.contains('bare')));
        await p.evaluate(() => document.getElementById('gHint').hidden = true);
        if (ms === 1000) break;
        await tap(await ctr('#closeBtn'), 40); await W(p, () => !document.getElementById('intro').hidden);
      }
      await p.evaluate(() => { if (!__mirror.S.ring.on) document.getElementById('ringBtn').click(); document.getElementById('stage').classList.add('bare'); }); await p.waitForTimeout(300);
      const pt = await p.evaluate(() => { const v = document.getElementById('view').getBoundingClientRect(); return { x: innerWidth / 2, y: (v.bottom + innerHeight) / 2 }; });
      await tap(pt, 60);
      t(`${w}×${h} tap on the lit ring brings the controls back`, await p.evaluate(() => !document.getElementById('stage').classList.contains('bare')));
      await ctx.close(); }
    // ---- landscape drawer, short intro screens ----
    { const { ctx, p } = await open(844, 390);
      await p.goto(url);
      const intro = () => p.evaluate(() => { const v = document.getElementById('vanity').getBoundingClientRect(), l = document.getElementById('lightBtn').getBoundingClientRect(); return { top: v.top, lb: l.bottom, H: innerHeight }; });
      let r = await intro(); t('844×390 intro: mirror whole, 只開補光 on the first screen', r.top >= 0 && r.lb <= r.H, JSON.stringify(r));
      await p.click('#startBtn'); await W(p, () => document.getElementById('video').videoWidth > 0, null, 10000);
      await p.click('#adjBtn'); await p.waitForTimeout(50);
      const d = await p.evaluate(() => { const r = document.getElementById('drawer').getBoundingClientRect(); return { l: r.left, w: r.width, h: r.height, grp: getComputedStyle(document.querySelector('#topBar .grp')).visibility }; });
      t('landscape drawer is a right side panel', d.w <= 340 && d.l >= 844 - 341 && d.h >= 389 && d.grp === 'hidden', JSON.stringify(d));
      await p.setViewportSize({ width: 375, height: 500 }); await p.click('#doneAdj'); await p.click('#closeBtn');
      r = await intro(); t('375×500 intro: mirror whole, 只開補光 on the first screen', r.top >= 0 && r.lb <= r.H, JSON.stringify(r));
      await ctx.close(); }
    // ---- camera errors ----
    for (const [label, init, path, re] of [
      ['top-level page, camera blocked', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); }, '', /權限被封鎖[\s\S]*允許[\s\S]*重新整理[\s\S]*設定 › Safari › 相機/],
      ['other error in Chinese', () => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Not supported', 'NotSupportedError')); }, '', /^(?![\s\S]*Not supported)[\s\S]*無法開啟相機[\s\S]*只開補光/]]) {
      const { ctx, p } = await open(390, 844, { permissions: [] }); await p.addInitScript(init); await p.goto(url + path);
      await p.click('#startBtn'); await W(p, () => !document.getElementById('err').hidden);
      const txt = await p.textContent('#err'); t(label, re.test(txt) && !(await p.$('#err a')), txt); await ctx.close(); }
    { const { ctx, p } = await open(390, 700, { permissions: [] }); await p.goto(url + 'frame');
      const f = p.frames().find(x => x !== p.mainFrame()); await f.waitForSelector('#startBtn'); await f.click('#startBtn'); await f.waitForSelector('#err:not([hidden])');
      t('embedded without camera permission -> website link', /不開放相機/.test(await f.textContent('#err')) && !!(await f.$('#err a[target=_blank]'))); await ctx.close(); }
    t('no page errors in the browser checks', !errs.length, errs.join(' | '));
  } finally { await browser.close(); srv.close(); }
})().then(() => { console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }, e => { console.error(e); process.exit(1); });
