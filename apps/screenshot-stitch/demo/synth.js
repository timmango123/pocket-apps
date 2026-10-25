// 合成手機截圖（測試用）：長頁面 + 依捲動位置切出截圖，加上時間不同的狀態列、頂欄、底欄、懸浮按鈕等。
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function img(w, h, bg) { const px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255; } return { w, h, px }; }
function rect(im, x, y, w, h, c) {
  for (let yy = Math.max(0, y); yy < Math.min(im.h, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(im.w, x + w); xx++) { const p = (yy * im.w + xx) * 4; im.px[p] = c[0]; im.px[p + 1] = c[1]; im.px[p + 2] = c[2]; }
}
// 一行「字」：一串高度、寬度不一的小方塊，像文字筆畫
function textLine(im, r, x, y, w, lh, c) {
  let cx = x;
  while (cx < x + w - 6) {
    const gw = 4 + Math.floor(r() * 9);
    for (let k = 0; k < 3; k++) { const sx = cx + Math.floor(r() * gw), sy = y + Math.floor(r() * (lh - 4)), sw = 1 + Math.floor(r() * 3), sh = 2 + Math.floor(r() * (lh / 2)); rect(im, sx, sy, sw, Math.min(sh, y + lh - sy), c); }
    rect(im, cx, y + Math.floor(lh * 0.4), gw, 1 + (r() < 0.5 ? 1 : 0), c);
    cx += gw + 2 + (r() < 0.12 ? 8 : 0);
  }
}
// 頁面：段落、聊天泡泡、圖片、分隔線，opt.repeat = 重複同樣區塊（近似重複內容），opt.dark = 深色
function page(w, h, seed, opt = {}) {
  const r = rng(seed), bg = opt.dark ? [18, 20, 24] : [246, 246, 243], ink = opt.dark ? [220, 222, 228] : [30, 32, 40];
  const im = img(w, h, bg);
  let y = 10;
  const block = (rr) => {
    const t = rr();
    if (t < 0.45) { // 段落
      const lines = 1 + Math.floor(rr() * 4);
      for (let i = 0; i < lines && y < h; i++) { textLine(im, rr, 12, y, Math.floor(w * (0.5 + rr() * 0.45)), 14, ink); y += 20; }
      y += 10 + Math.floor(rr() * 16);
    } else if (t < 0.75) { // 泡泡
      const right = rr() < 0.5, bw = Math.floor(w * (0.3 + rr() * 0.4)), lines = 1 + Math.floor(rr() * 3), bh = lines * 18 + 12;
      const bx = right ? w - bw - 10 : 10, col = right ? [80, 140, 255] : (opt.dark ? [52, 56, 64] : [255, 255, 255]);
      rect(im, bx, y, bw, bh, col);
      for (let i = 0; i < lines; i++) textLine(im, rr, bx + 8, y + 6 + i * 18, bw - 16, 12, right ? [255, 255, 255] : ink);
      y += bh + 10 + Math.floor(rr() * 10);
    } else if (t < 0.88) { // 圖片
      const ih = 40 + Math.floor(rr() * 60), c0 = [rr() * 255, rr() * 255, rr() * 255];
      for (let yy = 0; yy < ih && y + yy < h; yy++) for (let xx = 20; xx < w - 20; xx++) { const p = ((y + yy) * w + xx) * 4; im.px[p] = (c0[0] + yy * 2) & 255; im.px[p + 1] = (c0[1] + xx) & 255; im.px[p + 2] = (c0[2] + xx + yy) & 255; }
      y += ih + 12;
    } else { rect(im, 12, y, w - 24, 1, opt.dark ? [60, 60, 70] : [210, 210, 215]); y += 14 + Math.floor(rr() * 30); }
  };
  if (opt.repeat) {
    // 重複的清單項目：每項同樣外觀，只有少數項目不同
    const per = opt.repeat;
    let idx = 0;
    while (y < h - per) {
      rect(im, 12, y + 4, 36, 36, [200, 120, 60]);
      const rr = rng(opt.uniqueEvery && idx % opt.uniqueEvery === 0 ? 1000 + idx : 77);
      textLine(im, rr, 56, y + 6, w - 80, 12, ink); textLine(im, rr, 56, y + 24, Math.floor(w * 0.4), 12, [120, 120, 130]);
      rect(im, 12, y + per - 1, w - 24, 1, [210, 210, 215]);
      y += per; idx++;
    }
    return im;
  }
  while (y < h) block(r);
  return im;
}
function crop(src, y0, h) { const im = img(src.w, h, [0, 0, 0]); im.px.set(src.px.subarray(y0 * src.w * 4, (y0 + h) * src.w * 4)); return im; }
function paste(dst, src, y) { dst.px.set(src.px.subarray(0, Math.min(src.h, dst.h - y) * src.w * 4), y * dst.w * 4); }
// 狀態列：時間（不同截圖不同）+ 右側電量；頂欄：標題；底欄：分頁列
function statusBar(w, sh, k, opt) {
  const im = img(w, sh, opt.dark ? [18, 20, 24] : [250, 250, 250]);
  const r = rng(500 + k * 31);
  textLine(im, r, 14, Math.floor(sh / 2) - 6, 34, 12, opt.dark ? [240, 240, 240] : [0, 0, 0]);
  rect(im, w - 40, Math.floor(sh / 2) - 5, 24, 10, opt.dark ? [240, 240, 240] : [0, 0, 0]);
  rect(im, w - 39, Math.floor(sh / 2) - 4, Math.floor(22 * (0.4 + 0.1 * (k % 3))), 8, [52, 199, 89]);
  return im;
}
function navBar(w, nh, opt) { const im = img(w, nh, opt.dark ? [28, 30, 36] : [255, 255, 255]); textLine(im, rng(9), Math.floor(w * 0.3), Math.floor(nh / 2) - 8, Math.floor(w * 0.4), 16, opt.dark ? [230, 230, 230] : [10, 10, 10]); rect(im, 0, nh - 1, w, 1, [200, 200, 205]); rect(im, 10, 10, 12, nh - 20, [80, 140, 255]); return im; }
function tabBar(w, th, opt) { const im = img(w, th, opt.dark ? [28, 30, 36] : [252, 252, 252]); rect(im, 0, 0, w, 1, [200, 200, 205]); for (let i = 0; i < 4; i++) rect(im, Math.floor(w * (i + 0.5) / 4) - 10, 8, 20, 20, i === 1 ? [80, 140, 255] : [150, 150, 160]); rect(im, Math.floor(w / 2) - 40, th - 8, 80, 4, [20, 20, 20]); return im; }

// 依捲動位置產生一組截圖。回傳 {shots:[img], expect:img}（expect = 理想拼接結果）
// opt.navFirst / opt.tabFirst：第一張的頂欄／底欄高度不同（iOS 大標題收合、Safari 工具列縮小）
function shots(opt) {
  const w = opt.w || 200, H = opt.h || 400, sh = opt.status ?? 20, th0 = opt.tab ?? 40, nh0 = opt.nav ?? 30;
  const offs = opt.offs, last = offs[offs.length - 1];
  const geo = offs.map((o, k) => { const nh = k === 0 && opt.navFirst != null ? opt.navFirst : nh0, th = k === 0 && opt.tabFirst != null ? opt.tabFirst : th0; return { nh, th, bodyH: H - sh - nh - th }; });
  const bodyH = geo[geo.length - 1].bodyH;
  const pg = page(w, last + Math.max(...geo.map(g => g.bodyH)) + 20, opt.seed || 1, opt);
  const out = [];
  offs.forEach((o, k) => {
    const g = geo[k], im = img(w, H, [0, 0, 0]);
    if (sh) paste(im, statusBar(w, sh, k, opt), 0);
    if (g.nh) paste(im, navBar(w, g.nh, opt), sh);
    paste(im, crop(pg, o, g.bodyH), sh + g.nh);
    if (g.th) paste(im, tabBar(w, g.th, opt), H - g.th);
    if (opt.fab) rect(im, w - 50, H - g.th - 50, 36, 36, [255, 80, 60]);
    out.push(im);
  });
  let expect = null;
  const contiguous = offs.every((o, i) => i === 0 || o - offs[i - 1] <= geo[i - 1].bodyH);
  if (contiguous && !opt.fab) {
    const top = sh + geo[0].nh, total = top + (last - offs[0] + bodyH) + th0;
    expect = img(w, total, [0, 0, 0]);
    paste(expect, crop(out[0], 0, top), 0);
    paste(expect, crop(pg, offs[0], last - offs[0] + bodyH), top);
    paste(expect, crop(out[out.length - 1], H - geo[geo.length - 1].th, geo[geo.length - 1].th), total - geo[geo.length - 1].th);
  }
  return { shots: out, expect, bodyH, pg };
}
function noise(im, amp, seed) { const r = rng(seed), o = img(im.w, im.h, [0, 0, 0]); for (let i = 0; i < im.px.length; i++) o.px[i] = (i & 3) === 3 ? 255 : im.px[i] + Math.round((r() * 2 - 1) * amp); return o; }
// 依切片組出拼接結果
function compose(ims, slices, H) {
  const w = ims[0].w, out = img(w, H, [0, 0, 0]);
  for (const s of slices) out.px.set(ims[s.k].px.subarray(s.sy * w * 4, s.ey * w * 4), s.oy * w * 4);
  return out;
}
function diffRows(a, b) { if (a.w !== b.w || a.h !== b.h) return -1; let bad = 0; for (let y = 0; y < a.h; y++) { const s = y * a.w * 4; for (let i = 0; i < a.w * 4; i++) if (a.px[s + i] !== b.px[s + i]) { bad++; break; } } return bad; }
module.exports = { rng, img, rect, page, shots, crop, paste, noise, compose, diffRows };
