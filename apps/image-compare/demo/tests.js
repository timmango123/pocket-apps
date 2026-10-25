// Tests for 圖片比較 (image-compare).
// Part 1: pure functions between the CORE markers of ../index.html, checked against answers computed here independently.
// Part 2: the real page in Chromium (Playwright): loading files (picker, EXIF, errors), every compare mode, PNG and GIF
// export decoded pixel by pixel, undo, refresh persistence and rapid taps.
// Usage: node tests.js   (prints "N passed, 0 failed"; exit code 1 on failure)
const fs = require('fs'), path = require('path'), zlib = require('zlib'), http = require('http');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const IC = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return IC;')();
let pass = 0, fail = 0; const failed = [];
function ok(c, msg) { if (c) pass++; else { fail++; failed.push(msg); console.log('FAIL', msg); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const eqR = (r, e) => near(r.x, e.x) && near(r.y, e.y) && near(r.w, e.w) && near(r.h, e.h);

// ---------- placement ----------
{
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'contain', .5, .5), { x: 50, y: 0, w: 100, h: 100 }), 'contain: square B centred in 2:1 A');
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'contain', 0, 0), { x: 0, y: 0, w: 100, h: 100 }), 'contain: anchored left');
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'contain', 1, 1), { x: 100, y: 0, w: 100, h: 100 }), 'contain: anchored right');
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'cover', .5, .5), { x: 0, y: -50, w: 200, h: 200 }), 'cover: square B fills 2:1 A, cropped top/bottom');
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'cover', .5, 0), { x: 0, y: 0, w: 200, h: 200 }), 'cover: anchored top');
  ok(eqR(IC.placeRect(200, 100, 100, 100, 'stretch', 0, 0), { x: 0, y: 0, w: 200, h: 100 }), 'stretch ignores aspect and anchor');
  ok(eqR(IC.placeRect(200, 100, 50, 40, 'original', 1, 1), { x: 150, y: 60, w: 50, h: 40 }), 'original: 1:1 pixels bottom-right');
  ok(eqR(IC.placeRect(100, 100, 400, 200, 'original', .5, .5), { x: -150, y: -50, w: 400, h: 200 }), 'original: larger B overflows evenly');
  ok(eqR(IC.placeRect(4032, 3024, 2016, 1512, 'contain', .5, .5), { x: 0, y: 0, w: 4032, h: 3024 }), 'same aspect, half resolution: scaled up exactly');
  ok(eqR(IC.placeRect(1, 1, 3000, 10, 'contain', .5, .5), { x: 0, y: (1 - 10 / 3000) / 2, w: 1, h: 10 / 3000 }), 'extreme aspect into 1×1');
  ok(JSON.stringify(IC.overlapPx({ x: 50, y: 0, w: 100, h: 100 }, 200, 100, 1)) === JSON.stringify({ x0: 50, y0: 0, x1: 150, y1: 100 }), 'overlap px for contain');
  ok(JSON.stringify(IC.overlapPx({ x: 0, y: -50, w: 200, h: 200 }, 100, 50, .5)) === JSON.stringify({ x0: 0, y0: 0, x1: 100, y1: 50 }), 'overlap clipped to frame, scaled');
  ok(IC.overlapPx({ x: 300, y: 0, w: 10, h: 10 }, 200, 100, 1) === null, 'no overlap → null');
  const ws = IC.workSize(4000, 3000, 1600); ok(ws.w === 1600 && ws.h === 1200, 'work size capped to 1600');
  ok(IC.workSize(800, 600, 1600).k === 1, 'small frame compared at full size');
  const cs = IC.capSize(10000, 10000, 4096, 16e6); ok(cs.w * cs.h <= 16e6 && cs.w === cs.h && cs.w === 4000, 'cap by area for huge square');
}
// ---------- pixel difference ----------
function raster(w, h, f) { const a = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y), i = (y * w + x) * 4; a[i] = c[0]; a[i + 1] = c[1]; a[i + 2] = c[2]; a[i + 3] = c.length > 3 ? c[3] : 255; } return a; }
{
  const W = [255, 255, 255], K = [0, 0, 0];
  const a = raster(100, 100, () => W), b = raster(100, 100, (x, y) => x >= 20 && x < 30 && y >= 40 && y < 50 ? K : W), full = { x0: 0, y0: 0, x1: 100, y1: 100 };
  let s = IC.diffPass(a, a, 100, 100, full, 0, 'mark', 1, null);
  ok(s.nd === 0 && s.pct === 0 && s.psnr === Infinity && s.maxD === 0, 'identical: 0%, PSNR ∞');
  s = IC.diffPass(a, b, 100, 100, full, 0, 'mark', 1, null);
  ok(s.nd === 100 && near(s.pct, 1) && s.maxD === 255, 'black 10×10 square on white 100×100 = 1.00%');
  ok(near(s.mean, 100 * 255 / 10000), 'mean abs diff = 2.55');
  ok(near(s.psnr, 10 * Math.log10(65025 / (100 * 3 * 65025 / 30000))), 'PSNR of the square = 20 dB');
  ok(near(s.psnr, 20), 'PSNR is exactly 20 dB');
  const c = raster(10, 10, () => [100, 100, 100]), d = raster(10, 10, () => [105, 100, 100]), all = { x0: 0, y0: 0, x1: 10, y1: 10 };
  ok(IC.diffPass(c, d, 10, 10, all, 8, 'mark', 1, null).pct === 0, 'diff 5 within tolerance 8 → 0%');
  ok(IC.diffPass(c, d, 10, 10, all, 4, 'mark', 1, null).pct === 100, 'diff 5 over tolerance 4 → 100%');
  ok(IC.diffPass(c, d, 10, 10, all, 5, 'mark', 1, null).pct === 0, 'diff equal to tolerance is not different');
  const e = raster(10, 10, () => [110, 110, 110]);
  ok(near(IC.diffPass(c, e, 10, 10, all, 0, 'mark', 1, null).psnr, 10 * Math.log10(65025 / 100)), 'uniform diff 10 → PSNR 28.13 dB');
  const t1 = raster(4, 1, () => [0, 0, 0, 0]), t2 = raster(4, 1, () => [0, 0, 0, 255]);
  ok(IC.diffPass(t1, t2, 4, 1, { x0: 0, y0: 0, x1: 4, y1: 1 }, 10, 'mark', 1, null).pct === 100, 'transparent vs opaque black counts as different (alpha)');
  const half = { x0: 0, y0: 0, x1: 50, y1: 100 };
  s = IC.diffPass(a, b, 100, 100, half, 0, 'mark', 1, null); ok(s.n === 5000 && s.nd === 100 && near(s.pct, 2), 'only the overlap is counted');
  s = IC.diffPass(a, b, 100, 100, null, 0, 'mark', 1, null); ok(s.n === 0 && s.pct === 0, 'no overlap → nothing compared');
  const out = new Uint8ClampedArray(100 * 100 * 4); IC.diffPass(a, b, 100, 100, full, 0, 'mark', 1, out);
  const px = (o, x, y) => [...o.slice((y * 100 + x) * 4, (y * 100 + x) * 4 + 3)];
  ok(px(out, 25, 45).join() === '255,61,139' && px(out, 5, 5)[0] < 140, 'mark view: differing pixel pink, same pixel dim grey');
  IC.diffPass(c, d, 10, 10, all, 0, 'value', 6, out);
  ok(out[0] === 30 && out[1] === 0 && out[3] === 255, 'value view: |Δ|×gain (5×6 = 30)');
  IC.diffPass(c, e, 10, 10, all, 0, 'value', 40, out); ok(out[0] === 255, 'value view clamps at 255');
}
// ---------- fast diff (prep + stats + paint) must match diffPass ----------
{
  const w = 61, h = 37, rnd = (() => { let z = 7; return () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const a = raster(w, h, () => [rnd() * 255, rnd() * 255, rnd() * 255, rnd() < .1 ? rnd() * 255 : 255]);
  const b = raster(w, h, (x, y) => { const i = (y * w + x) * 4; return rnd() < .5 ? [a[i], a[i + 1], a[i + 2], a[i + 3]] : [rnd() * 255, a[i + 1], a[i + 2], a[i + 3]]; });
  const ov = { x0: 5, y0: 3, x1: 50, y1: 30 }, P = IC.diffPrep(a, b, w, h, ov);
  let same = true, paintOk = true;
  for (const tol of [0, 1, 8, 64, 200, 255]) {
    const o1 = new Uint8ClampedArray(w * h * 4), s1 = IC.diffPass(a, b, w, h, ov, tol, 'mark', 1, o1), s2 = IC.diffStats(P, tol);
    if (s1.n !== s2.n || s1.nd !== s2.nd || !near(s1.mean, s2.mean, 1e-9) || s1.maxD !== s2.maxD || !(s1.psnr === s2.psnr || near(s1.psnr, s2.psnr, 1e-9))) same = false;
    const o2 = new Uint8ClampedArray(w * h * 4); IC.diffPaint(P, a, b, 'mark', tol, 1, new Uint32Array(o2.buffer));
    for (let i = 0; i < o1.length; i++) if (Math.abs(o1[i] - o2[i]) > 1) { paintOk = false; break; }
  }
  for (const gain of [1, 6, 20]) {
    const o1 = new Uint8ClampedArray(w * h * 4); IC.diffPass(a, b, w, h, ov, 0, 'value', gain, o1);
    const o2 = new Uint8ClampedArray(w * h * 4); IC.diffPaint(P, a, b, 'value', 0, gain, new Uint32Array(o2.buffer));
    for (let i = 0; i < o1.length; i++) if (Math.abs(o1[i] - o2[i]) > 1) { paintOk = false; break; }
  }
  ok(same, 'fast diff statistics equal the reference pass at 6 tolerances');
  ok(paintOk, 'fast diff picture equals the reference pass (mark and value views)');
  ok(IC.diffStats(IC.diffPrep(a, b, w, h, null), 0).n === 0, 'fast diff: no overlap');
}
// ---------- JPEG metadata & orientation ----------
function fakeJpeg(w, h, o, le) {
  const sof = [0xFF, 0xC0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  let app = [];
  if (o) {
    const tiff = le ? [0x49, 0x49, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, o, 0, 0, 0, 0, 0, 0, 0]
      : [0x4D, 0x4D, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
    const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]; app = [0xFF, 0xE1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
  }
  return new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0, 16, 0x4A, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, ...app, ...sof, 0xFF, 0xDA, 0, 2, 0xFF, 0xD9]);
}
{
  for (let o = 1; o <= 8; o++) { const m = IC.parseJpegMeta(fakeJpeg(640, 480, o, o % 2)); ok(m.jpeg && m.orientation === o && m.width === 640 && m.height === 480, `parse orientation ${o} (${o % 2 ? 'II' : 'MM'})`); }
  const m0 = IC.parseJpegMeta(fakeJpeg(33, 7, 0)); ok(m0.orientation === 1 && m0.width === 33 && m0.height === 7, 'no EXIF → orientation 1, size from SOF');
  ok(!IC.parseJpegMeta(new Uint8Array([0x89, 0x50, 0x4E, 0x47])).jpeg, 'PNG bytes are not JPEG');
  ok(IC.parseJpegMeta(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE1, 0xFF])).orientation === 1, 'truncated JPEG does not throw');
  ok(IC.parseJpegMeta(new Uint8Array(0)).jpeg === false, 'empty bytes');
  const ins = IC.withExifOrientation(fakeJpeg(10, 20, 0), 6), mi = IC.parseJpegMeta(ins); ok(mi.orientation === 6 && mi.width === 10 && mi.height === 20, 'inserted EXIF block is read back');
  // EXIF spec: where raw pixel (x,y) of a w×h image appears after correcting each orientation
  const expect = { 1: (x, y, w, h) => [x, y], 2: (x, y, w) => [w - 1 - x, y], 3: (x, y, w, h) => [w - 1 - x, h - 1 - y], 4: (x, y, w, h) => [x, h - 1 - y],
    5: (x, y) => [y, x], 6: (x, y, w, h) => [h - 1 - y, x], 7: (x, y, w, h) => [h - 1 - y, w - 1 - x], 8: (x, y, w) => [y, w - 1 - x] };
  const w = 5, h = 3;
  for (let o = 1; o <= 8; o++) {
    const r = IC.orientMatrix(o, w, h), [a, b, c, d, e, f] = r.m; let good = (o >= 5 ? r.w === h && r.h === w : r.w === w && r.h === h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = Math.floor(a * (x + .5) + c * (y + .5) + e), Y = Math.floor(b * (x + .5) + d * (y + .5) + f), [ex, ey] = expect[o](x, y, w, h); if (X !== ex || Y !== ey) good = false; }
    ok(good, `orientation ${o} maps every pixel like the EXIF spec`);
  }
}
// ---------- view maths ----------
{
  const W = 1200, H = 800, pw = 360, ph = 300;
  let v = IC.clampView({ z: 1, cx: 0, cy: 0 }, W, H, pw, ph); ok(v.z === 1 && v.cx === 600 && v.cy === 400, 'at 1× the frame is centred');
  v = IC.clampView({ z: 0.2, cx: 600, cy: 400 }, W, H, pw, ph); ok(v.z === 1, 'cannot zoom out past fit');
  const z = IC.zoomAround({ z: 1, cx: 600, cy: 400 }, 3, 300, 100, W, H, pw, ph);
  const before = IC.toFrame({ z: 1, cx: 600, cy: 400 }, W, H, pw, ph, 300, 100), after = IC.toFrame(z, W, H, pw, ph, 300, 100);
  ok(z.z === 3 && near(before.x, after.x, 1e-6) && near(before.y, after.y, 1e-6), 'pinch keeps the point under the fingers');
  v = IC.clampView({ z: 4, cx: -999, cy: 99999 }, W, H, pw, ph); const s = IC.fitScale(pw, ph, W, H) * 4;
  ok(near(v.cx, pw / 2 / s) && near(v.cy, H - ph / 2 / s), 'panning stops at the frame edges');
  ok(IC.clampView({ z: 1e9, cx: 0, cy: 0 }, W, H, pw, ph).z === IC.zoomMax(pw, ph, W, H), 'zoom capped');
  ok(IC.zoomMax(pw, ph, 2, 2) === 8, 'tiny image: zoom max 8×');
  const vr = IC.visibleRect({ z: 2, cx: 600, cy: 400 }, W, H, pw, ph); ok(near(vr.w, 600) && near(vr.x, 300), 'visible rect at 2× is the middle half');
  let L = IC.sideLayout(360, 600, 1200, 800, 'auto', 4); ok(L.dir === 'v' && near(L.panes[1].y, 302), 'auto side-by-side on a tall phone: stacked');
  L = IC.sideLayout(1000, 400, 1200, 800, 'auto', 4); ok(L.dir === 'h' && near(L.panes[0].w, 498), 'auto side-by-side on a wide screen: left|right');
  L = IC.sideLayout(360, 640, 600, 1600, 'auto', 4); ok(L.dir === 'h', 'tall photos on a tall phone: left|right (0.297 > 0.199 scale)');
  L = IC.sideLayout(360, 600, 800, 1200, 'auto', 4); ok(L.dir === 'v', '2:3 photos on a 360×600 pane: stacked is larger (0.248 > 0.2225)');
}
// ---------- export plans & helpers ----------
{
  let e = IC.exportSize(1200, 800, 480, 720); ok(e.w === 480 && e.h === 320, 'GIF 480 wide keeps aspect');
  e = IC.exportSize(200, 100, 480, 720); ok(e.w === 200 && e.h === 100, 'GIF never upscales');
  e = IC.exportSize(10, 4000, 480, 720); ok(e.h === 720 && e.w === 2, 'very tall: height capped, aspect kept');
  e = IC.exportSize(4000, 10, 480, 720); ok(e.w === 480 && e.h === 1, 'very wide: at least 1 px tall');
  ok(near(IC.pngScale(8000, 2000, 4096), 0.512) && IC.pngScale(100, 100, 4096) === 1, 'PNG scale cap');
  const sw = IC.gifPlan('sweep', 'mid'); ok(sw.length === 24 && near(sw[0].p, 0.08) && near(sw[12].p, 0.92) && sw[0].delay === 520 && sw[1].delay === 60, 'sweep: 24 frames 8%→92%, holds at the ends');
  ok(sw.every(f => f.delay % 10 === 0 && f.delay >= 20), 'delays are whole centiseconds');
  const sl = IC.gifPlan('sweep', 'slow'); ok(sl[1].delay === 90 && sl[0].delay === 780, 'slow = 1.5×');
  const bl = IC.gifPlan('blink', 'fast'); ok(bl.length === 2 && bl[0].t === 0 && bl[1].t === 1 && bl[0].delay === 480, 'blink: A then B');
  const fd = IC.gifPlan('fade', 'mid'); ok(fd.length === 16 && fd[0].t === 0 && fd[8].t === 1 && near(fd[4].t, .5) && near(fd[12].t, .5), 'fade: A, 7 steps, B, 7 steps back');
  ok(IC.pickSlot(true, true, 'B') === 'A' && IC.pickSlot(false, true, 'A') === 'B' && IC.pickSlot(false, false, 'A') === 'B' && IC.pickSlot(false, false, 'B') === 'A', 'single image goes to the sample slot, else the older slot');
  ok(IC.fmtBytes(0) === '0 B' && IC.fmtBytes(1536) === '2 KB' && IC.fmtBytes(1048576 * 1.5) === '1.50 MB' && IC.fmtBytes(1048576 * 12.34) === '12.3 MB', 'byte formatting');
  ok(IC.fmtPct(0) === '0%' && IC.fmtPct(0.004) === '<0.01%' && IC.fmtPct(1) === '1.00%' && IC.fmtPct(12.345) === '12.3%' && IC.fmtPct(100) === '100.0%' && IC.fmtPct(99.999) === '>99.99%', 'percent formatting');
  ok(IC.isImageName('a.HEIC', '') && IC.isImageName('x', 'image/png') && !IC.isImageName('a.txt', 'text/plain') && !IC.isImageName('', ''), 'image file detection');
}
// ---------- GIF encoder, checked by an independent decoder ----------
function decodeGif(buf) {
  const u = buf; let p = 0; const r8 = () => u[p++], r16 = () => { const v = u[p] | (u[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...u.slice(0, 6)); p = 6; if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('sig');
  const W = r16(), H = r16(), fl = r8(); r8(); r8(); let gct = null;
  if (fl & 0x80) { const n = 1 << ((fl & 7) + 1); gct = []; for (let i = 0; i < n; i++) gct.push([r8(), r8(), r8()]); }
  const frames = [], canvas = new Uint8Array(W * H * 4); let gce = null, loop = null;
  for (;;) {
    const b = r8();
    if (b === 0x3B) break;
    if (b === 0x21) { const lab = r8(); const blocks = []; for (let n = r8(); n; n = r8()) { blocks.push(u.slice(p, p + n)); p += n; }
      if (lab === 0xF9) { const d = blocks[0]; gce = { disp: (d[0] >> 2) & 7, tr: d[0] & 1, delay: d[1] | (d[2] << 8), ti: d[3] }; }
      if (lab === 0xFF && String.fromCharCode(...blocks[0]) === 'NETSCAPE2.0') loop = blocks[1][1] | (blocks[1][2] << 8);
      continue; }
    if (b !== 0x2C) throw new Error('block ' + b);
    const x0 = r16(), y0 = r16(), w = r16(), h = r16(), f2 = r8(); let ct = gct;
    if (f2 & 0x80) { const n = 1 << ((f2 & 7) + 1); ct = []; for (let i = 0; i < n; i++) ct.push([r8(), r8(), r8()]); }
    const minCode = r8(); const data = []; for (let n = r8(); n; n = r8()) { for (let i = 0; i < n; i++) data.push(u[p + i]); p += n; }
    // LZW decode
    const clear = 1 << minCode, eoi = clear + 1; let size = minCode + 1, dict = [], prev = null, out = [], bit = 0;
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = null; size = minCode + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0; for (let i = 0; i < size; i++) { const byte = data[(bit + i) >> 3]; if (byte === undefined) { code = eoi; break; } code |= ((byte >> ((bit + i) & 7)) & 1) << i; } bit += size;
      if (code === clear) { reset(); continue; } if (code === eoi) break;
      let entry; if (code < dict.length && dict[code]) entry = dict[code]; else if (code === dict.length && prev) entry = prev.concat(prev[0]); else throw new Error('lzw');
      out.push(...entry); if (prev) { dict.push(prev.concat(entry[0])); if (dict.length === (1 << size) && size < 12) size++; } prev = entry;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = out[y * w + x]; if (gce && gce.tr && k === gce.ti) continue; const c = ct[k], i = ((y + y0) * W + x + x0) * 4; canvas[i] = c[0]; canvas[i + 1] = c[1]; canvas[i + 2] = c[2]; canvas[i + 3] = 255; }
    frames.push({ px: canvas.slice(), delay: gce ? gce.delay * 10 : 0 }); gce = null;
  }
  return { W, H, frames, loop };
}
{
  const enc = IC.encoderModule(), w = 40, h = 20;
  const mk = f => raster(w, h, f).buffer;
  const fr = [mk(x => x < 20 ? [230, 20, 20] : [20, 20, 230]), mk(x => x < 30 ? [230, 20, 20] : [20, 20, 230]), mk(() => [20, 200, 40])];
  const chunks = enc({ frames: fr.map(b => b.slice(0)), w, h, delays: [500, 60, 100], colors: 256, dither: false, loop: 0, optimize: true }, () => {});
  const bytes = Buffer.concat(chunks.map(c => Buffer.from(c)));
  const g = decodeGif(bytes);
  const at = (f, x, y) => [...g.frames[f].px.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
  ok(g.W === 40 && g.H === 20 && g.frames.length === 3 && g.loop === 0, 'GIF: size, 3 frames, loops forever');
  ok(g.frames.map(f => f.delay).join() === '500,60,100', 'GIF: frame delays');
  ok(close(at(0, 5, 5), [230, 20, 20]) && close(at(0, 35, 5), [20, 20, 230]), 'GIF frame 1 colours');
  ok(close(at(1, 25, 5), [230, 20, 20]) && close(at(1, 35, 15), [20, 20, 230]), 'GIF frame 2 (only changed area re-sent) composes right');
  ok(close(at(2, 0, 0), [20, 200, 40]) && close(at(2, 39, 19), [20, 200, 40]), 'GIF frame 3 full change');
  // bigger noisy frame exercises code-size growth and table resets
  const noise = raster(300, 200, (x, y) => [(x * 7 + y * 13) & 255, (x * x + y) & 255, (x ^ y) & 255]).buffer;
  const nb = Buffer.concat(enc({ frames: [noise.slice(0)], w: 300, h: 200, delays: [100], colors: 256, dither: true, loop: 0, optimize: true }, () => {}).map(c => Buffer.from(c)));
  let decOk = true; try { const d = decodeGif(nb); decOk = d.frames.length === 1 && d.frames[0].px[3] === 255; } catch (e) { decOk = false; }
  ok(decOk, 'GIF: 300×200 noise with dithering decodes (LZW table resets)');
}

{
  ok(IC.fmtMean(0) === '0.0' && IC.fmtMean(0.04) === '<0.1' && IC.fmtMean(0.1) === '0.1' && IC.fmtMean(2.55) === '2.5' || IC.fmtMean(2.55) === '2.6', 'mean difference: tiny values show <0.1, not 0.0');
  // ordered dithering: smoother than plain mapping on a >256-colour gradient, and position-stable between frames
  const enc = IC.encoderModule(), w = 256, h = 64;
  const grad = raster(w, h, (x, y) => [x, (y * 4 + x / 3) & 255, 255 - x / 2]);
  const run = d => decodeGif(Buffer.concat(enc({ frames: [grad.buffer.slice(0)], w, h, delays: [100], colors: 256, dither: d, loop: 0, optimize: true }, () => {}).map(c => Buffer.from(c))));
  const blockErr = g => { let e = 0, n = 0; for (let by = 0; by < h; by += 8) for (let bx = 0; bx < w; bx += 8) for (let c = 0; c < 3; c++) { let s1 = 0, s2 = 0; for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) { const i = (y * w + x) * 4; s1 += g.frames[0].px[i + c]; s2 += grad[i + c]; } e += Math.abs(s1 - s2) / 64; n++; } return e / n; };
  const eNone = blockErr(run(false)), eOrd = blockErr(run('ordered'));
  ok(eOrd < eNone * 0.7, `ordered dithering reduces banding (block error ${eOrd.toFixed(2)} vs ${eNone.toFixed(2)})`);
  const half = raster(w, h, (x, y) => x < 128 ? [x, (y * 4 + x / 3) & 255, 255 - x / 2] : [200, 30, 30]);
  const two = Buffer.concat(enc({ frames: [grad.buffer.slice(0), half.buffer.slice(0)], w, h, delays: [100, 100], colors: 256, dither: 'ordered', loop: 0, optimize: true }, () => {}).map(c => Buffer.from(c)));
  // the second frame should only re-send the changed right half: find its image descriptor x-offset
  let p = two.indexOf(0x2C, 13 + 3 * 256), p2 = -1; for (let i = p + 10; i < two.length - 9; i++) if (two[i] === 0x21 && two[i + 1] === 0xF9 && two[i + 2] === 4) { p2 = two.indexOf(0x2C, i + 8); break; }
  ok(p2 > 0 && (two[p2 + 1] | (two[p2 + 2] << 8)) >= 120, 'ordered dithering keeps unchanged areas identical (second frame starts near x=128)');
}
// ---------- Part 2: the real page ----------
function crc32(buf) { let c, crc = 0xFFFFFFFF; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; }
function png(w, h, f) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const c = f(x, y), i = y * (w * 4 + 1) + 1 + x * 4; raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; raw[i + 3] = c.length > 3 ? c[3] : 255; } }
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
const RED = [230, 20, 20], BLUE = [20, 20, 230];
const F = {
  red: { name: 'red.png', mimeType: 'image/png', buffer: png(200, 100, () => RED) },
  blue: { name: 'blue.png', mimeType: 'image/png', buffer: png(200, 100, () => BLUE) },
  sq: { name: '方塊.png', mimeType: 'image/png', buffer: png(100, 100, () => [0, 0, 0]) },
  white: { name: 'white.png', mimeType: 'image/png', buffer: png(100, 100, () => [255, 255, 255]) },
  dot: { name: 'dot.png', mimeType: 'image/png', buffer: png(100, 100, (x, y) => x >= 20 && x < 30 && y >= 40 && y < 50 ? [0, 0, 0] : [255, 255, 255]) },
  one: { name: '1px.png', mimeType: 'image/png', buffer: png(1, 1, () => [10, 200, 10]) },
  wide: { name: 'wide.png', mimeType: 'image/png', buffer: png(4000, 10, x => x < 2000 ? RED : BLUE) },
  alpha: { name: 'alpha.png', mimeType: 'image/png', buffer: png(100, 100, x => x < 50 ? [0, 0, 0, 0] : [255, 255, 255, 255]) },
  txt: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  empty: { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
  bad: { name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5, 6, 7, 8]) },
  svg: { name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="32" height="32" fill="#e61414"/><rect x="32" width="32" height="32" fill="#1414e6"/></svg>') },
};
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';

(async () => {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('playwright missing: page tests skipped'); return done(); }
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, r)); const URL0 = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errs = [], ext = [];
  page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith(URL0) && !/^(data|blob):/.test(r.url())) ext.push(r.url()); });
  await page.goto(URL0); await page.evaluate(() => window.__ic.ready);
  const st = () => page.evaluate(() => { const { S, set } = window.__ic; return { A: S.A && { w: S.A.w, h: S.A.h, ow: S.A.ow, oh: S.A.oh, name: S.A.name, sample: S.A.sample, fixed: S.A.fixed }, B: S.B && { w: S.B.w, h: S.B.h, ow: S.B.ow, oh: S.B.oh, name: S.B.name, sample: S.B.sample }, mode: set.mode, toast: document.getElementById('toast').classList.contains('on') ? document.getElementById('toastT').textContent : '' }; });
  const frames2 = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const settle = () => page.waitForFunction(() => window.__ic.S.busy === 0).then(() => page.waitForTimeout(30)).then(frames2);
  const put = async (...files) => { await page.setInputFiles('#file', files); await settle(); };
  const pickInto = async (slot, file) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#slot' + slot)]); await fc.setFiles(file); await settle(); };
  // export via the page, read the result back as bytes
  const exportNow = async (cfg) => page.evaluate(async cfg => {
    const { set, makeExport, EX } = window.__ic; Object.assign(set, cfg); EX.blob = null; await makeExport();
    const t0 = Date.now(); while (!EX.blob && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 30));
    if (!EX.blob) return null; return { type: EX.blob.type, bytes: [...new Uint8Array(await EX.blob.arrayBuffer())] };
  }, cfg);
  const pngPixels = async bytes => page.evaluate(async bytes => {
    const bm = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height;
    const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return { w: c.width, h: c.height, at: (pts => pts.map(([px, py]) => [...x.getImageData(px, py, 1, 1).data]))(window.__pts || []) };
  }, bytes);
  const pixelsAt = async (bytes, pts) => { await page.evaluate(p => window.__pts = p, pts); return pngPixels(bytes); };
  const close = (a, b, e = 6) => a && b.every((v, i) => Math.abs(a[i] - v) <= e);

  // 1. first screen: the generated sample pair
  let s = await st();
  ok(s.A.sample && s.B.sample && s.A.w === 1200 && s.B.h === 800 && s.mode === 'slider', 'opens with the built-in sample pair in slider mode');
  ok(await page.isVisible('#badge') && (await page.textContent('#badge')).includes('範例'), 'sample is marked 範例');
  // 2. two files at once → A and B
  await put(F.red, F.blue); s = await st();
  ok(!s.A.sample && s.A.name === 'red.png' && s.B.name === 'blue.png' && s.A.w === 200, 'two picked files become A and B');
  ok(!(await page.isVisible('#badge')), 'sample badge gone after loading own images');
  // 3. slider PNG at 50 %
  await page.evaluate(() => { window.__ic.set.split = 0.5; window.__ic.set.mode = 'slider'; window.__ic.set.rg = 'full'; });
  let ex = await exportNow({ fmt: 'png', exLab: false }); let pp = await pixelsAt(ex.bytes, [[50, 50], [150, 50], [10, 90], [190, 10]]);
  ok(ex.type === 'image/png' && pp.w === 200 && pp.h === 100, 'slider PNG: full resolution 200×100');
  ok(close(pp.at[0], [...RED, 255]) && close(pp.at[2], [...RED, 255]) && close(pp.at[1], [...BLUE, 255]) && close(pp.at[3], [...BLUE, 255]), 'slider PNG: left half A, right half B');
  await page.evaluate(() => { window.__ic.set.dir = 'h'; window.__ic.set.split = 0.5; });
  ex = await exportNow({ fmt: 'png' }); pp = await pixelsAt(ex.bytes, [[100, 10], [100, 45], [100, 55], [100, 90]]);
  ok(close(pp.at[0], [...RED, 255]) && close(pp.at[1], [...RED, 255]) && close(pp.at[2], [...BLUE, 255]) && close(pp.at[3], [...BLUE, 255]), 'horizontal split at the middle: A on top, B below');
  await page.evaluate(() => { window.__ic.set.split = 0; });
  ex = await exportNow({ fmt: 'png' }); pp = await pixelsAt(ex.bytes, [[5, 2], [195, 98]]);
  ok(close(pp.at[0], [...BLUE, 255]) && close(pp.at[1], [...BLUE, 255]), 'divider dragged past the image edge: all B');
  await page.evaluate(() => { window.__ic.set.dir = 'v'; window.__ic.set.split = 0.5; });
  // 4. onion at 50 %
  await page.click('[data-mode="onion"]'); await page.evaluate(() => { window.__ic.set.opa = 50; });
  ex = await exportNow({ fmt: 'png', exLab: false }); pp = await pixelsAt(ex.bytes, [[100, 50]]);
  ok(close(pp.at[0], [125, 20, 125, 255], 4), 'onion PNG: 50% blend of red and blue = (125,20,125)');
  // 5. side by side
  await page.click('[data-mode="side"]'); await page.click('[data-side="h"]');
  ex = await exportNow({ fmt: 'png', exLab: false }); pp = await pixelsAt(ex.bytes, [[100, 50], [300, 50]]);
  ok(pp.w === 402 && pp.h === 100 && close(pp.at[0], [...RED, 255]) && close(pp.at[1], [...BLUE, 255]), 'side-by-side PNG: 200 + 2 gap + 200, A left, B right');
  await page.click('[data-side="v"]'); ex = await exportNow({ fmt: 'png', exLab: false }); pp = await pixelsAt(ex.bytes, []);
  ok(pp.w === 200 && pp.h === 202, 'side-by-side stacked PNG: 200×202');
  await page.click('[data-side="auto"]');
  // 6. GIF sweep, decoded independently
  await page.click('[data-mode="slider"]');
  ex = await exportNow({ fmt: 'gif', fx: 'sweep', gw: 480, sp: 'mid', exLab: false });
  let g = decodeGif(Uint8Array.from(ex.bytes));
  const gat = (f, x, y) => [...g.frames[f].px.slice((y * g.W + x) * 4, (y * g.W + x) * 4 + 3)];
  const gclose = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 14);
  ok(g.W === 200 && g.H === 100 && g.frames.length === 24 && g.loop === 0, 'GIF sweep: 200×100 (no upscaling), 24 frames, loops');
  ok(gclose(gat(0, 5, 50), RED) && gclose(gat(0, 60, 50), BLUE), 'GIF sweep frame 1: split at 8%');
  ok(gclose(gat(12, 170, 50), RED) && gclose(gat(12, 195, 50), BLUE), 'GIF sweep frame 13: split at 92%');
  ok(g.frames[0].delay === 520 && g.frames[1].delay === 60, 'GIF sweep delays');
  ex = await exportNow({ fmt: 'gif', fx: 'blink' }); g = decodeGif(Uint8Array.from(ex.bytes));
  ok(g.frames.length === 2 && gclose(gat(0, 100, 50), RED) && gclose(gat(1, 100, 50), BLUE), 'GIF blink: A frame then B frame');
  ex = await exportNow({ fmt: 'gif', fx: 'fade', exLab: true }); g = decodeGif(Uint8Array.from(ex.bytes));
  // A dithered pixel can land well over 14 away from its colour when the palette also holds the labels' anti-aliased
  // edge shades, and those depend on the fonts and CPU (with labels 左/右 one pixel here comes out 15 off). What the
  // frame must get right is the colour on average, so compare the mean of an 8×8 block (whole 4×4 Bayer tiles).
  const gmean = (f, x0, y0) => { const m = [0, 0, 0]; for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) gat(f, x, y).forEach((v, k) => m[k] += v / 64); return m; };
  const fm = gmean(4, 144, 76);
  ok(g.frames.length === 16 && fm.every((v, k) => Math.abs(v - [125, 20, 125][k]) <= 6), `GIF fade: middle frame is a 50% blend (mean ${fm.map(v => v.toFixed(1)).join(',')})`);
  // 7. difference: 10×10 black square in 100×100 white
  await put(F.white, F.dot); await page.click('[data-mode="diff"]'); await page.click('[data-dm="mark"]');
  await page.evaluate(() => { window.__ic.set.tol = 8; window.__ic.render(); });
  let stat = await page.evaluate(() => { window.__ic.ensureDiff(); return Object.assign({}, window.__ic.S.stats); });
  // the chip is painted by the render that follows the app's deferred comparison: wait for that instead of hoping it ran
  const diffShown = () => page.waitForFunction(() => window.__ic.S.stats && !window.__ic.S.diffPending).then(frames2);
  await diffShown();
  ok(stat.nd === 100 && near(stat.pct, 1) && near(stat.psnr, 20, 1e-9), 'diff: 1.00% different, PSNR 20 dB');
  ok((await page.textContent('#stat')).includes('1.00%'), 'diff chip shows 1.00%');
  await put(F.white, F.white); await page.evaluate(() => window.__ic.render()); await diffShown();
  ok((await page.textContent('#stat')).includes('完全相同'), 'identical images: 完全相同');
  // 8. different sizes: A 200×100 red, B 100×100 black, contain/centre: overlap is B's square only
  await put(F.red, F.sq); await page.evaluate(() => { window.__ic.set.fit = 'contain'; window.__ic.set.ax = .5; window.__ic.set.tol = 0; window.__ic.S.work = null; window.__ic.ensureDiff(); });
  stat = await page.evaluate(() => Object.assign({}, window.__ic.S.stats));
  ok(stat.n === 10000 && stat.nd === 10000, 'contain: only the 100×100 overlap is compared');
  await page.click('[data-mode="slider"]');
  ex = await exportNow({ fmt: 'png', exLab: false }); pp = await pixelsAt(ex.bytes, [[25, 50], [120, 50], [175, 50]]);
  ok(close(pp.at[0], [...RED, 255]) && close(pp.at[1], [0, 0, 0, 255]) && pp.at[2][3] === 0, 'contain: B centred, empty strip transparent in PNG');
  await page.evaluate(() => { window.__ic.set.ax = 1; window.__ic.set.split = 0; window.__ic.S.work = null; });
  ex = await exportNow({ fmt: 'png' }); pp = await pixelsAt(ex.bytes, [[60, 50], [120, 50], [195, 50]]);
  ok(pp.at[0][3] === 0 && close(pp.at[1], [0, 0, 0, 255]) && close(pp.at[2], [0, 0, 0, 255]), 'anchor right: B sits at the right edge');
  ok(await page.evaluate(() => { window.__ic.ensureDiff(); const o = window.__ic.S.work.ov; return o.x0 === 100 && o.x1 === 200 && o.y0 === 0 && o.y1 === 100; }), 'anchor right: compared area is x 100–200');
  await page.evaluate(() => { window.__ic.set.split = 0.5; });
  await page.evaluate(() => { window.__ic.set.fit = 'stretch'; window.__ic.S.work = null; });
  ex = await exportNow({ fmt: 'png' }); pp = await pixelsAt(ex.bytes, [[120, 50], [195, 5]]);
  ok(close(pp.at[0], [0, 0, 0, 255]) && close(pp.at[1], [0, 0, 0, 255]), 'stretch: B covers the whole frame');
  await page.evaluate(() => { window.__ic.set.fit = 'contain'; window.__ic.set.ax = .5; window.__ic.set.tol = 8; window.__ic.S.work = null; });
  // 9. EXIF orientation: a 40×20 JPEG (left red, right blue) tagged "rotate 90° CW" must load as 20×40 with red on top
  const exif = await page.evaluate(async () => {
    const out = {};
    for (const o of [6, 3, 8]) {
      const c = document.createElement('canvas'); c.width = 40; c.height = 20; const x = c.getContext('2d'); x.fillStyle = '#e61414'; x.fillRect(0, 0, 20, 20); x.fillStyle = '#1414e6'; x.fillRect(20, 0, 20, 20);
      const u8 = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', .95))).arrayBuffer());
      const f = new File([window.__ic.IC.withExifOrientation(u8, o)], `o${o}.jpg`, { type: 'image/jpeg' });
      await window.__ic.takeFiles([f], 'A'); const A = window.__ic.S.A;
      const d = document.createElement('canvas'); d.width = A.w; d.height = A.h; const dx = d.getContext('2d'); dx.drawImage(A.src, 0, 0);
      const px = (X, Y) => [...dx.getImageData(X, Y, 1, 1).data].slice(0, 3);
      out[o] = { w: A.w, h: A.h, fixed: A.fixed, tl: px(2, 2), br: px(A.w - 3, A.h - 3) };
    }
    return out;
  });
  const isR = c => c[0] > 180 && c[2] < 90, isB = c => c[2] > 180 && c[0] < 90;
  ok(exif[6].w === 20 && exif[6].h === 40 && isR(exif[6].tl) && isB(exif[6].br) && exif[6].fixed, 'EXIF 6 (90° CW): 20×40, red on top');
  ok(exif[3].w === 40 && exif[3].h === 20 && isB(exif[3].tl) && isR(exif[3].br), 'EXIF 3 (180°): blue on the left');
  ok(exif[8].w === 20 && exif[8].h === 40 && isB(exif[8].tl) && isR(exif[8].br), 'EXIF 8 (90° CCW): blue on top');
  // 10. bad inputs: explained, nothing replaced
  await put(F.red, F.blue);
  for (const [f, re, what] of [[F.txt, /不是圖片/, 'text file'], [F.empty, /空檔案/, '0-byte file'], [F.bad, /無法讀取/, 'corrupt JPEG']]) {
    await put(f); s = await st(); ok(re.test(s.toast) && s.A.name === 'red.png' && s.B.name === 'blue.png', `${what}: explained (${s.toast.slice(0, 18)}…) and nothing replaced`);
  }
  await put(F.red, F.txt); s = await st(); ok(s.A.name === 'red.png' && /不是圖片/.test(s.toast), 'one good + one bad file: good one kept, bad one explained');
  await put(F.white, F.dot, F.sq); s = await st(); ok(s.A.name === 'white.png' && s.B.name === 'dot.png', 'three files: first two used');
  // 11. odd sizes
  await put(F.one, F.wide); s = await st(); ok(s.A.w === 1 && s.B.w === 4000 && s.B.h === 10, '1×1 vs 4000×10 loads');
  for (const m of ['slider', 'side', 'onion', 'diff']) await page.click(`[data-mode="${m}"]`);
  ex = await exportNow({ fmt: 'gif', fx: 'sweep' }); ok(ex && decodeGif(Uint8Array.from(ex.bytes)).W === 1, '1×1 frame exports a 1×1 GIF');
  await put(F.wide, F.one); await page.click('[data-mode="slider"]'); ex = await exportNow({ fmt: 'png' }); pp = await pixelsAt(ex.bytes, []); ok(pp.w === 4000 && pp.h === 10, '4000×10 frame exports at full size');
  await put(F.svg, F.alpha); s = await st(); ok(s.A.w === 64 && s.A.h === 32 && s.B.w === 100, 'SVG and transparent PNG load');
  const big = { name: 'big.png', mimeType: 'image/png', buffer: png(6000, 4000, (x, y) => x < 3000 ? [200, 30, 30] : [30, 30, 200]) };
  const t0 = Date.now(); await put(big, F.red); s = await st();
  ok(s.A.w === 4096 && s.A.h === 2731 && s.A.ow === 6000, `24 MP image capped to 4096×2731 for comparison, original size kept (${Date.now() - t0} ms)`);
  ok((await page.textContent('#slotA .l2')).includes('6000×4000'), 'slot shows the original size');
  await page.click('[data-mode="diff"]'); await page.waitForFunction(() => window.__ic.S.work && !window.__ic.S.diffPending, null, { timeout: 20000 }).catch(() => {});
  ok(await page.evaluate(() => !!window.__ic.S.work && window.__ic.S.work.w === 1600), 'big frame compared at 1600 px');
  // 12. labels: emoji, CJK, long, empty
  await put(F.red, F.blue); await page.click('[data-mode="slider"]');
  await page.click('#adjBtn'); await page.waitForTimeout(350);
  await page.fill('#labA', '修圖前😀👍🏽很長很長很長的標籤'); await page.fill('#labB', '');
  const labs = await page.evaluate(() => [window.__ic.set.la, window.__ic.set.lb]);
  ok(labs[0].length <= 16 && labs[1] === '', 'label input limited to 16 chars; empty allowed');
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'long emoji label: no horizontal overflow');
  ex = await exportNow({ fmt: 'png', exLab: true }); ok(ex && ex.bytes.length > 100, 'PNG with emoji label exports');
  await page.evaluate(() => { window.__ic.set.la = '前'; window.__ic.set.lb = '後'; });
  // 13. swap and undo
  await page.click('#swapBtn'); s = await st(); ok(s.A.name === 'blue.png' && s.B.name === 'red.png', 'swap exchanges A and B');
  await page.click('#swapBtn');
  await pickInto('B', { name: 'green.png', mimeType: 'image/png', buffer: png(50, 50, () => [0, 200, 0]) }); s = await st();
  ok(s.B.name === 'green.png' && s.A.name === 'red.png', 'tapping B replaces only B');
  await page.click('#toastBtn'); s = await st(); ok(s.B.name === 'blue.png', '復原 brings the replaced image back');
  // 14. refresh keeps images and settings
  // settings are saved 120 ms after a change and the images through IndexedDB: wait for both, not a fixed 300 ms
  await page.click('[data-mode="onion"]'); await page.evaluate(() => window.__ic.persist());
  await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('image-compare:v1:settings')).mode === 'onion'; } catch (e) { return false; } }, null, { timeout: 10000 }).catch(() => {});
  await page.reload(); await page.evaluate(() => window.__ic.ready); s = await st();
  ok(s.A.name === 'red.png' && s.B.name === 'blue.png' && !s.A.sample && s.mode === 'onion', 'after refresh: same two images and mode');
  await page.click('#adjBtn'); await page.waitForTimeout(350); await page.click('#resetSample'); s = await st();
  ok(s.A.sample && s.B.sample, '換回範例圖 works'); await page.click('#toastBtn'); s = await st(); ok(s.A.name === 'red.png', 'and can be undone');
  // 16a. long labels on small exports: chips shortened with …, never overlapping, inside the image
  await put({ name: 'l.png', mimeType: 'image/png', buffer: png(400, 300, () => RED) }, { name: 'r.png', mimeType: 'image/png', buffer: png(400, 300, () => BLUE) });
  await page.click('[data-mode="slider"]');
  const longA = '二〇二四年十月修圖前的原始照片', longB = '二〇二四年十月修圖後的最終版本';
  const tagsFor = async (cfg, size) => page.evaluate(async ([cfg, size]) => {
    const { set, tagLog, renderPng, pngPlan, gifPlanNow } = window.__ic; Object.assign(set, cfg); tagLog.length = 0;
    const c = document.createElement('canvas'); const pl = pngPlan(); if (size) { pl.w = size[0]; pl.h = size[1]; if (pl.pw) { pl.gap = 2; pl.pw = (size[0] - 2) / 2; pl.ph = size[1]; } }
    renderPng(c, pl); return { W: c.width, H: c.height, tags: tagLog.slice() };
  }, [cfg, size]);
  const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (t, W, H) => t.x >= 0 && t.y >= 0 && t.x + t.w <= W + 0.5 && t.y + t.h <= H + 0.5;
  let T = await tagsFor({ la: longA, lb: longB, exLab: true, dir: 'v', split: 0.5, mode: 'slider' });
  let [ta, tb] = T.tags;
  ok(ta.text.length >= 5 && tb.text.length >= 5 && tb.text.endsWith('…') && tb.text.startsWith('二〇二四'), `400×300 slider PNG: both long labels keep several characters (A「${ta.text}」 B「${tb.text}」)`);
  ok(Math.abs([...ta.text].length - [...tb.text].length) <= 1, 'left and right labels get the same room');
  ok(!overlap(ta, tb) && inside(ta, T.W, T.H) && inside(tb, T.W, T.H), '400×300: chips inside the image and apart');
  T = await tagsFor({ mode: 'onion', opa: 30 }); tb = T.tags[1];
  ok(tb.text.endsWith(' 30%') && tb.text.length > 5 && !overlap(T.tags[0], tb), `onion export keeps the percentage (「${tb.text}」)`);
  for (const [mode, dir] of [['slider', 'v'], ['slider', 'h'], ['onion', 'v'], ['side', 'v']]) {
    T = await tagsFor({ mode, dir, side: 'h' }, [120, 80]);
    const tg = T.tags; let good = tg.every(t => inside(t, T.W, T.H)); for (let i = 0; i < tg.length; i++) for (let j = i + 1; j < tg.length; j++) if (overlap(tg[i], tg[j])) good = false;
    ok(good, `tiny 120×80 export (${mode}/${dir}): labels fit and do not overlap`);
  }
  T = await tagsFor({ mode: 'slider', dir: 'v', la: '前', lb: '後' }); ok(T.tags[0].text === '前' && T.tags[1].text === '後', 'short labels untouched');
  await page.evaluate(() => { Object.assign(window.__ic.set, { la: '前', lb: '後', mode: 'slider', dir: 'v', split: 0.5 }); window.__ic.render(); });
  // 16b. three files: the "only two" note stays readable
  await put(F.white, F.dot, F.sq); await page.waitForTimeout(1200); s = await st();
  ok(/最多比較兩張/.test(s.toast), `three files: warning still visible after 1.2 s (「${s.toast}」)`);
  // 16c. segmented buttons are at least 44 px tall everywhere
  await page.click('#exportBtn'); await page.waitForTimeout(400);
  const segMin = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.seg button, .modes button')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect().height)));
  ok(segMin >= 44, `segmented buttons ≥ 44 px (min ${segMin})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  for (const m of ['side', 'diff', 'slider']) { await page.click(`[data-mode="${m}"]`); const h2 = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.ctx:not([hidden]) .seg button')].map(b => b.getBoundingClientRect().height))); ok(h2 >= 44 || h2 === Infinity, `${m} bar buttons ≥ 44 px (${h2})`); }
  // 16d. tiny mean difference reads <0.1
  await put({ name: 'g1.png', mimeType: 'image/png', buffer: png(100, 100, () => [100, 100, 100]) }, { name: 'g2.png', mimeType: 'image/png', buffer: png(100, 100, (x, y) => y === 0 && x < 30 ? [109, 100, 100] : [100, 100, 100]) });
  await page.click('[data-mode="diff"]'); await page.evaluate(() => { window.__ic.set.tol = 8; window.__ic.ensureDiff(); window.__ic.render(); });
  const chip = await page.textContent('#stat'); ok(/不同 0\.30%/.test(chip) && /平均差 <0\.1/.test(chip), `diff chip: 「${chip}」`);
  await page.click('[data-mode="slider"]'); await put(F.red, F.blue);
  // 15. rapid taps with real touch events: 16 taps at 8/s alternating two mode buttons → every tap lands once
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => { window.__modeLog = []; for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => window.__modeLog.push(b.dataset.mode)); });
  const ctr = async sel => page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
  const P1 = await ctr('[data-mode="side"]'), P2 = await ctr('[data-mode="diff"]');
  for (let i = 0; i < 16; i++) {
    const [x, y] = i % 2 ? P2 : P1;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(85);
  }
  await page.waitForTimeout(200);
  const log = await page.evaluate(() => window.__modeLog);
  ok(log.length === 16 && log.every((m, i) => m === (i % 2 ? 'diff' : 'side')) && (await st()).mode === 'diff', `16 rapid touch taps → 16 mode changes in order (${log.length})`);
  // rapid swap taps: even count leaves order unchanged
  const SP = await ctr('#swapBtn');
  for (let i = 0; i < 16; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: SP[0], y: SP[1] }] }); await page.waitForTimeout(40); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(85); }
  await page.waitForTimeout(400); s = await st(); ok(s.A.name === 'red.png' && s.B.name === 'blue.png', '16 rapid swaps leave A/B as they were');
  // 16. drag the divider with touch
  await page.click('[data-mode="slider"]'); await page.evaluate(() => { window.__ic.S.view.z = 1; });
  const sb = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x + sb.w * .5, y: sb.y + sb.h * .5 }] });
  for (let i = 1; i <= 5; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sb.x + sb.w * (.5 - i * .06), y: sb.y + sb.h * .5 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
  const sp = await page.evaluate(() => window.__ic.set.split); ok(near(sp, 0.2, 0.01), `touch drag moves the divider to 20% (${sp.toFixed(3)})`);
  // pinch zoom with two touch points
  const c0 = { x: sb.x + sb.w / 2, y: sb.y + sb.h / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c0.x - 30, y: c0.y, id: 1 }, { x: c0.x + 30, y: c0.y, id: 2 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: c0.x - 30 - i * 15, y: c0.y, id: 1 }, { x: c0.x + 30 + i * 15, y: c0.y, id: 2 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
  const z = await page.evaluate(() => window.__ic.S.view.z); ok(z > 2.5 && z < 4.5, `pinch zooms in (${z.toFixed(2)}×, expected 4×)`);
  // a pinch that starts away from the knob at 1× must not move the divider; a still tap does (on lift)
  await page.evaluate(() => { const { S, set } = window.__ic; S.view = { z: 1, cx: S.A.w / 2, cy: S.A.h / 2 }; set.split = 0.5; window.__ic.render(); });
  const yMid = sb.y + sb.h * .5, f1 = sb.x + sb.w * .2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f1, y: yMid, id: 1 }] }); await page.waitForTimeout(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: f1, y: yMid, id: 1 }, { x: f1 + 80, y: yMid + 20, id: 2 }] });
  for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: f1 - i * 4, y: yMid, id: 1 }, { x: f1 + 80 + i * 20, y: yMid + 20, id: 2 }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
  const ps = await page.evaluate(() => ({ split: window.__ic.set.split, z: window.__ic.S.view.z }));
  ok(ps.z > 1.5 && near(ps.split, 0.5, 0.01), `pinch from 20% zooms (${ps.z.toFixed(2)}×) and leaves the divider at 50% (${ps.split.toFixed(3)})`);
  await page.evaluate(() => { const { S, set } = window.__ic; S.view = { z: 1, cx: S.A.w / 2, cy: S.A.h / 2 }; set.split = 0.5; window.__ic.render(); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x + sb.w * .3, y: yMid }] }); await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(100);
  const tapSplit = await page.evaluate(() => window.__ic.set.split); ok(near(tapSplit, 0.3, 0.02), `slow still tap moves the divider on lift (${tapSplit.toFixed(3)})`);
  ok(errs.length === 0, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  ok(ext.length === 0, 'no network requests' + (ext.length ? ': ' + ext[0] : ''));
  await browser.close(); srv.close(); done();
})().catch(e => { console.log('FAIL exception', e && e.stack || e); fail++; done(); });
// qa/smoke/run.js only shows the last line, so the names of failed checks go on it too
function done() { console.log(`${pass} passed, ${fail} failed` + (failed.length ? ' — ' + failed.map(m => String(m).slice(0, 80)).join(' | ') : '')); process.exit(fail ? 1 : 0); }
