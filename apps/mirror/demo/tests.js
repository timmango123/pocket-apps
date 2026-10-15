// Unit tests for 鏡子 (mirror), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {ZMIN,ZMAX,clampZoom,clampPan,zoomAt,pinch,doubleTapZoom,coverRect,visibleSource,mirrorRect,mirrorX,bcFactors,filterCSS,applyBC,RING_TONES,ringPx,photoName,DEFAULTS,sanitizeSettings};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
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
  t('settings sanitized', s.mirrored === false && s.brightness === 50 && s.contrast === -12 && s.ring.on === true && s.ring.width === 25 && s.ring.tone === 'neutral' && s.facing === 'environment'); }
t('defaults not mutated by sanitize', C.DEFAULTS.ring.width === 12 && (C.sanitizeSettings({}).ring.width = 3, C.DEFAULTS.ring.width === 12));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
