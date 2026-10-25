// 長截圖拼接：測試。用法：node tests.js
// 1) 核心演算法（node）：用 synth.js 合成各種截圖組（不同重疊量、沒重疊、固定頂欄／底欄、時間不同的狀態列、
//    懸浮按鈕、重複清單、雜訊、深色、大標題收合、Safari 工具列縮小、重複截圖…），拼接結果必須和原始頁面逐像素相同；
//    找不到重疊時必須「不重疊」而不是亂接。另測 PNG 編碼（用 zlib 解回來比對）、分段、排序、手動調整。
// 2) 頁面（Playwright）：上傳 PNG／JPEG／不同寬度的截圖、匯出（單張、串流 PNG、分段 JPEG）並解碼檢查尺寸與像素、
//    重新整理後還在、刪除可復原、依內容排序、連點計數。
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const G = require('./synth.js');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const SS = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return SS;')();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const B = { w: 390, h: 844, status: 47, nav: 50, tab: 83 };
const feats = ims => ims.map(s => SS.features(s.px, s.w, s.h));
function stitch(opt) {
  const { shots, expect } = G.shots(opt);
  const ims = opt.noise ? shots.map((s, i) => G.noise(s, opt.noise, i + 1)) : shots;
  const f = feats(ims), pairs = SS.analyzeAll(f), pl = SS.plan(f, pairs, []);
  return { shots, expect, f, pairs, pl, out: G.compose(shots, pl.slices, pl.H) };
}

// ---------- 1. 固定情境：必須逐像素還原 ----------
const T0 = Date.now();
const exact = [
  ['重疊 50%', { offs: [0, 332], seed: 1 }],
  ['重疊 10%', { offs: [0, 600], seed: 2 }],
  ['重疊 90%（只捲一點）', { offs: [0, 66], seed: 3 }],
  ['剛好相接（無重疊）', { offs: [0, 664], seed: 4 }],
  ['五張不同重疊', { offs: [0, 400, 700, 1200, 1500], seed: 6 }],
  ['沒有頂欄底欄', { status: 0, nav: 0, tab: 0, offs: [0, 300, 700], seed: 7 }],
  ['重複清單中有少數不同項目', { offs: [0, 370], seed: 8, repeat: 100, uniqueEvery: 3 }],
  ['雜訊 ±3（像 JPEG）', { offs: [0, 240, 520], seed: 9, noise: 3 }],
  ['雜訊 ±6', { offs: [0, 300, 610], seed: 19, noise: 6 }],
  ['深色模式', { offs: [0, 200, 450], seed: 11, dark: true }],
  ['兩張完全相同', { offs: [0, 0], seed: 12 }],
  ['iOS 大標題收合', { navFirst: 110, offs: [0, 300, 600], seed: 14 }],
  ['Safari 工具列縮小', { tabFirst: 140, offs: [0, 300, 600], seed: 15 }],
  ['大標題與工具列同時改變（兩張）', { navFirst: 100, tabFirst: 130, offs: [0, 250], seed: 16 }],
  ['3x 解析度 1170×2532 四張', { w: 1170, h: 2532, status: 140, nav: 150, tab: 250, offs: [0, 900, 1700, 2600], seed: 13 }],
  ['窄圖 200×400', { w: 200, h: 400, status: 20, nav: 30, tab: 40, offs: [0, 150, 300], seed: 17 }]
];
for (const [name, o] of exact) {
  const r = stitch({ ...B, ...o });
  ok(r.expect && G.diffRows(r.out, r.expect) === 0, `${name}：拼接結果與原頁面相同（輸出 ${r.pl.H}，應為 ${r.expect && r.expect.h}，不同列 ${r.expect ? G.diffRows(r.out, r.expect) : '-'}）`);
}
// 剛好相接要判定為不重疊；兩張相同要判定為重複
{ const r = stitch({ ...B, offs: [0, 664], seed: 4 }); ok(r.pl.seams[0].mode === 'none', '剛好相接 → 不重疊'); }
{ const r = stitch({ ...B, offs: [0, 0], seed: 12 }); ok(r.pl.seams[0].mode === 'dup' && r.pl.H === 844, '重複截圖只保留一份'); }
// 中間缺一段：不能硬接，必須是不重疊，輸出 = 兩張去掉重複頂欄底欄後相接
{ const r = stitch({ ...B, offs: [0, 800], seed: 5 }); ok(r.pairs[0].best < 0 && r.pl.seams[0].mode === 'none', '中間缺一段 → 不重疊'); ok(r.pl.H === 844 * 2 - (r.pl.seams[0].cropA + r.pl.seams[0].cropB), '不重疊時高度 = 兩張相加減去裁掉的頂欄底欄'); ok(r.pl.seams[0].cropB >= 97 && r.pl.seams[0].cropA >= 83, `略過狀態列＋頂欄（${r.pl.seams[0].cropB}）與底欄（${r.pl.seams[0].cropA}）`); }
// 懸浮按鈕：位移正確（結果中按鈕會出現多次，這是預期）
{ const r = stitch({ ...B, offs: [0, 300], seed: 10, fab: true }); ok(r.pl.seams[0].d === 300, '懸浮按鈕不影響對齊 d=' + r.pl.seams[0].d); }
// 完全重複的清單：無法判斷，必須標成「請確認」並列出候選
{ const r = stitch({ ...B, offs: [0, 370], seed: 8, repeat: 100 }); ok(r.pairs[0].amb && r.pairs[0].cands.length >= 2, '完全重複的清單 → 標示待確認並列出多個候選'); }
// 狀態列時間不同仍被當成固定頂欄
{ const r = stitch({ ...B, offs: [0, 332], seed: 1 }); ok(r.pairs[0].hdr >= 97, '時間、電量不同的狀態列仍算固定頂欄 hdr=' + r.pairs[0].hdr); }

// ---------- 2. 隨機壓力：不准有錯誤對齊或亂接 ----------
{
  let wrong = 0, falsePos = 0, miss = 0, n = 0, found = 0;
  const bodyH = 664;
  for (let s = 100; s < 160; s++) {
    const r = G.rng(s), k = 2 + Math.floor(r() * 3), offs = [0], opt = { ...B, seed: s };
    if (r() < 0.2) opt.navFirst = 50 + Math.floor(r() * 80);
    if (r() < 0.2) opt.tabFirst = 83 + Math.floor(r() * 80);
    if (r() < 0.15) opt.dark = true;
    const b0 = 844 - 47 - (opt.navFirst ?? 50) - (opt.tabFirst ?? 83);
    for (let i = 1; i < k; i++) { const bh = i === 1 ? b0 : bodyH, gap = r() < 0.15; offs.push(offs[i - 1] + (gap ? bh + 20 + Math.floor(r() * 200) : 40 + Math.floor(r() * (bh - 60)))); }
    opt.offs = offs; if (r() < 0.3) opt.noise = 3;
    const x = stitch(opt); n++;
    x.pairs.forEach((p, i) => { const gap = offs[i + 1] - offs[i] > (i === 0 ? b0 : bodyH); if (gap && p.best >= 0) falsePos++; if (!gap && p.best < 0) miss++; if (!gap && p.best >= 0) found++; });
    if (x.expect && x.pl.seams.every(sm => sm.mode !== 'none') && G.diffRows(x.out, x.expect) !== 0) wrong++;
  }
  ok(wrong === 0, `隨機 ${n} 組：找到的對齊全部正確（錯 ${wrong}）`);
  ok(falsePos === 0, `隨機 ${n} 組：沒重疊的接縫不會被硬接（誤接 ${falsePos}）`);
  ok(found >= 0.93 * (found + miss), `隨機 ${n} 組：有重疊的接縫找到 ${found}/${found + miss}（漏掉的都是重疊太少，會改成直接相接）`);
}

// ---------- 3. 手動調整、接縫位置 ----------
{
  const { shots } = G.shots({ ...B, offs: [0, 300, 600], seed: 21 });
  const f = feats(shots), pairs = SS.analyzeAll(f);
  const auto = SS.plan(f, pairs, []);
  const d = auto.seams[0].d;
  const p1 = SS.plan(f, pairs, [{ m: 'o', d: d - 5, c: 0 }, null]);
  ok(p1.seams[0].d === d - 5 && p1.seams[0].L === auto.seams[0].L + 5 && !p1.seams[0].auto, '手動增加重疊 5 px');
  const p2 = SS.plan(f, pairs, [{ m: 'o', d, c: -40 }, null]);
  const out2 = G.compose(shots, p2.slices, p2.H), out0 = G.compose(shots, auto.slices, auto.H);
  ok(p2.seams[0].cutDelta === -40 && G.diffRows(out2, out0) === 0, '移動接縫位置（對齊不變）結果不變');
  const p3 = SS.plan(f, pairs, [{ m: 'n' }, null]);
  ok(p3.seams[0].mode === 'none' && p3.H === auto.H + (p3.seams[0].endA - auto.seams[0].endA) + (auto.seams[0].startB - p3.seams[0].startB), '改成不重疊');
  const p4 = SS.plan(f, pairs, [{ m: 'n', e: 700, s: 150 }, null]);
  ok(p4.seams[0].endA === 700 && p4.seams[0].startB === 150, '不重疊時手動裁切上下張');
  const p5 = SS.plan(f, pairs, [{ m: 'o', d: 999999, c: 0 }, { m: 'o', d: -50, c: 99999 }]);
  ok(p5.seams[0].d === p5.seams[0].dNone - 1 && p5.seams[1].d === 0 && p5.slices.every(s => s.ey >= s.sy), '超出範圍的手動值會被夾住，不會產生負高度');
  ok(SS.snap(f[0], f[1], pairs[0], d + 9, 14) === d, '手動拖到附近會自動貼齊到正確位置');
  const one = SS.plan([f[0]], [], []);
  ok(one.H === 844 && one.slices.length === 1, '只有一張時輸出就是原圖');
  ok(SS.plan([], [], []).H === 0, '沒有圖片時高度 0');
}

// ---------- 4. 依內容排序 ----------
{
  const { shots } = G.shots({ ...B, offs: [0, 300, 650, 950, 1300], seed: 31 });
  const f = feats(shots), perm = [3, 0, 4, 2, 1], pf = perm.map(i => f[i]), n = 5;
  const w = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    const c = SS.chrome(pf[i], pf[j]), D = { aTop: c.hdr, aBot: 844 - c.ftr, bTop: c.hdr, bBot: 844 - c.ftr, dup: c.dup }, r = SS.overlap(pf[i], pf[j], D);
    w[i][j] = r.best >= 0 ? r.cands[0].info + 1 : 0;
  }
  const ord = SS.orderByContent(n, w).map(k => perm[k]);
  ok(ord.join() === '0,1,2,3,4', '打亂的 5 張依內容排回正確順序 ' + ord.join());
  const big = Array.from({ length: 12 }, (_, i) => Array.from({ length: 12 }, (_, j) => j === (i + 5) % 12 && i !== 6 ? 10 : 0));
  const o2 = SS.orderByContent(12, big);
  ok(o2.length === 12 && new Set(o2).size === 12, '12 張（貪婪）排序是完整的排列');
  ok(SS.natCmp('IMG_9.PNG', 'IMG_10.PNG') < 0 && SS.natCmp('截圖 2', '截圖 11') < 0, '檔名自然排序（9 在 10 前）');
}

// ---------- 5. 分段 ----------
{
  const good = y => y % 500 === 0;
  const parts = SS.splitRows(42000, 14000, good);
  ok(parts.every(p => p[1] - p[0] <= 14000) && parts[0][0] === 0 && parts[parts.length - 1][1] === 42000 && parts.every((p, i) => i === 0 || p[0] === parts[i - 1][1]), '分段：每段不超過上限、首尾相接');
  ok(parts.slice(0, -1).every(p => good(p[1])), '分段點落在空白列');
  const p2 = SS.splitRows(1000, 300, () => false);
  ok(p2.length === 4 && p2[0][1] === 300, '找不到空白列就切在上限');
  ok(SS.splitRows(10, 300, () => true).length === 1, '不超過上限就不切');
}

// ---------- 6. PNG 編碼：zlib 解回來逐像素比對 ----------
function decodePng(buf) {
  ok(buf.subarray(0, 8).equals(Buffer.from(SS.SIG)), 'PNG 簽章');
  let o = 8, w = 0, h = 0; const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    const crc = buf.readUInt32BE(o + 8 + len);
    if ((SS.crc32(buf.subarray(o + 4, o + 8 + len)) ^ 0xffffffff) >>> 0 !== crc) { ok(false, 'CRC ' + type); }
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rl = w * 3, out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (rl + 1)], row = raw.subarray(y * (rl + 1) + 1, (y + 1) * (rl + 1));
    for (let i = 0; i < rl; i++) {
      const a = i >= 3 ? out[y * rl + i - 3] : 0, b = y ? out[(y - 1) * rl + i] : 0, c = i >= 3 && y ? out[(y - 1) * rl + i - 3] : 0;
      let v = row[i];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1; else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[y * rl + i] = v & 255;
    }
  }
  return { w, h, rgb: out };
}
function encodePng(im) {
  const prev = new Uint8Array(im.w * 3), raw = new Uint8Array(im.h * (1 + im.w * 3));
  SS.filterRows(im.px, im.w, im.h, prev, raw);
  return Buffer.concat([Buffer.from(SS.SIG), Buffer.from(SS.ihdr(im.w, im.h)), Buffer.from(SS.chunk('IDAT', zlib.deflateSync(raw))), Buffer.from(SS.chunk('IEND', new Uint8Array(0)))]);
}
{
  const im = G.page(123, 77, 5, {});
  for (let i = 0; i < 400; i++) im.px[i * 4 + 3] = 128;   // 半透明像素疊白底
  const d = decodePng(encodePng(im));
  let same = d.w === 123 && d.h === 77;
  for (let i = 0; i < 123 * 77 && same; i++) {
    const a = im.px[i * 4 + 3] / 255, exp = [0, 1, 2].map(c => im.px[i * 4 + 3] === 255 ? im.px[i * 4 + c] : Math.round(im.px[i * 4 + c] * a + 255 * (1 - a)));
    if (exp.some((v, c) => v !== d.rgb[i * 3 + c])) same = false;
  }
  ok(same, 'PNG 編碼（含半透明疊白底）解碼後逐像素相同');
  // 分批寫（模擬串流）：結果與一次寫相同
  const prev = new Uint8Array(123 * 3), r1 = new Uint8Array(77 * (1 + 369)), prev2 = new Uint8Array(123 * 3), r2 = new Uint8Array(77 * (1 + 369));
  SS.filterRows(im.px, 123, 77, prev, r1);
  let o = 0; for (let y = 0; y < 77; y += 20) { const n = Math.min(20, 77 - y); o += SS.filterRows(im.px.subarray(y * 123 * 4), 123, n, prev2, r2.subarray(o)); }
  ok(Buffer.compare(Buffer.from(r1), Buffer.from(r2)) === 0, 'PNG 分批濾波與一次濾波結果相同');
}

// ---------- 7. 頁面 ----------
(async () => {
  console.log('core', Date.now() - T0, 'ms');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const WRAP = path.resolve(__dirname, '_tests.html');
  fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + html + '</body></html>');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const p = await ctx.newPage(), errs = [], reqs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) reqs.push(r.url()); });
  const idle = () => p.waitForFunction(() => window.__ss && __ss.phase === 'idle' && __ss.plan, null, { timeout: 60000 });
  await p.goto('file://' + WRAP); await idle();
  // 範例
  const sm = await p.evaluate(() => ({ n: __ss.items.length, seams: __ss.plan.seams.map(s => [s.mode, s.auto, s.amb]), H: __ss.plan.H, sample: __ss.S.sample }));
  ok(sm.sample && sm.n === 4 && sm.seams.every(s => s[0] === 'overlap' && s[1] && !s[2]), '範例：4 張、3 個接縫都自動對齊 ' + JSON.stringify(sm.seams));
  // 範例的拼接結果要等於原始聊天頁：拼接後再比對每個切片和下一張重疊區逐像素相同（以原圖驗證）
  const sampleOk = await p.evaluate(() => {
    const pl = __ss.plan, it = __ss.items; let bad = 0;
    pl.seams.forEach((s, i) => {
      const A = it[i].canvas.getContext('2d').getImageData(0, s.endA - 40, 780, 80).data, Bc = it[i + 1].canvas.getContext('2d').getImageData(0, s.startB - 40, 780, 80).data;
      for (let k = 0; k < A.length; k++) if (A[k] !== Bc[k]) { bad++; break; }
    });
    return bad;
  });
  ok(sampleOk === 0, '範例每個接縫前後 40 列，上下兩張逐像素相同');

  // 上傳自己的 PNG：三張重疊 + 雜訊 JPEG + 不同寬度
  const { shots, expect } = G.shots({ ...B, offs: [0, 330, 640], seed: 41 });
  const files = shots.map((s, i) => ({ name: `IMG_${i + 1}.PNG`, mimeType: 'image/png', buffer: encodePng(s) }));
  await p.setInputFiles('#fileInput', files); await p.waitForTimeout(100); await idle();
  let st = await p.evaluate(() => ({ n: __ss.items.length, sample: __ss.S.sample, H: __ss.plan.H, W: __ss.Wc, seams: __ss.plan.seams.map(s => s.mode) }));
  ok(!st.sample && st.n === 3 && st.W === 390 && st.H === expect.h && st.seams.every(m => m === 'overlap'), `上傳 3 張 PNG → 範例移除、輸出 ${st.W}×${st.H}（應為 390×${expect.h}）`);
  // 匯出 PNG 並逐像素比對原頁面
  await p.evaluate(b64 => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); window.__expect = u; }, Buffer.from(expect.px).toString('base64'));
  const cmpOut = async (fmt, area) => p.evaluate(async ([fmt, area]) => {
    if (area) __ss.LIM.area = area;
    const r = await __ss.buildExport(fmt, 1, () => {}, () => false), b = r.files[0].blob, bm = await createImageBitmap(b);
    const c = document.createElement('canvas'); c.width = bm.width; c.height = bm.height; const g = c.getContext('2d'); g.drawImage(bm, 0, 0);
    const d = g.getImageData(0, 0, bm.width, bm.height).data, e = __expect; let diff = d.length === e.length ? 0 : -1;
    if (!diff) for (let i = 0; i < d.length; i++) if ((i & 3) !== 3 && d[i] !== e[i]) diff++;
    return { mode: r.mode, n: r.files.length, w: bm.width, h: bm.height, type: b.type, diff };
  }, [fmt, area]);
  const exp1 = await cmpOut('png');
  ok(exp1.mode === 'single' && exp1.type === 'image/png' && exp1.w === expect.w && exp1.h === expect.h && exp1.diff === 0, `匯出 PNG ${exp1.w}×${exp1.h} 與原頁面逐像素相同（不同 ${exp1.diff}）`);
  const exp2 = await cmpOut('png', 200000);
  ok(exp2.mode === 'stream' && exp2.n === 1 && exp2.w === expect.w && exp2.h === expect.h && exp2.diff === 0, `超過畫布上限：PNG 串流編碼成完整一張，逐像素相同（不同 ${exp2.diff}）`);
  // JPEG 超過上限要分段，高度加總正確
  const exp3 = await p.evaluate(async () => { const r = await __ss.buildExport('jpeg', 1, () => {}, () => false); const hs = []; for (const f of r.files) { const bm = await createImageBitmap(f.blob); hs.push([bm.width, bm.height, f.blob.type, f.name]); } return { mode: r.mode, hs, plan: __ss.expPlan('jpeg', 1) }; });
  ok(exp3.mode === 'split' && exp3.hs.length >= 3 && exp3.hs.every(h => h[0] === 390 && h[0] * h[1] <= 200000 && h[2] === 'image/jpeg') && exp3.hs.reduce((a, h) => a + h[1], 0) === expect.h && exp3.plan.parts === exp3.hs.length, `JPEG 超過上限分成 ${exp3.hs.length} 張、總高 ${exp3.hs.reduce((a, h) => a + h[1], 0)}、檔名 ${exp3.hs[0][3]}`);
  const exp4 = await p.evaluate(async () => { __ss.LIM.area = 16777216; const r = await __ss.buildExport('jpeg', 0.5, () => {}, () => false); const bm = await createImageBitmap(r.files[0].blob); return [r.files.length, bm.width, bm.height]; });
  ok(exp4[0] === 1 && exp4[1] === 195 && Math.abs(exp4[2] - Math.round(expect.h / 2)) <= 1, '50% JPEG 尺寸 ' + exp4.join('×'));
  // 匯出面板：按下儲存會下載
  await p.click('#goBtn'); await p.waitForFunction(() => !document.querySelector('#saveBtn').disabled, null, { timeout: 15000 });
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#saveBtn')]);
  ok(dl && /^long-screenshot-\d{8}-\d{4}\.png$/.test(dl.suggestedFilename()), '儲存下載檔名 ' + (dl && dl.suggestedFilename()));
  await p.click('#expSheet [data-close]'); await p.waitForTimeout(300);

  // 重新整理後還在（IndexedDB），手動調整也還在
  await p.evaluate(() => __ss.setOv(0, { m: 'o', d: __ss.plan.seams[0].d - 4, c: 0 }));
  const Hman = await p.evaluate(() => __ss.plan.H);
  await p.waitForTimeout(400);
  await p.reload(); await idle();
  st = await p.evaluate(() => ({ n: __ss.items.length, names: __ss.items.map(i => i.name), H: __ss.plan.H, man: !__ss.plan.seams[0].auto }));
  ok(st.n === 3 && st.names.join() === 'IMG_1.PNG,IMG_2.PNG,IMG_3.PNG' && st.H === Hman && st.man, '重新整理後截圖、順序、手動調整都還在 ' + JSON.stringify(st));
  await p.evaluate(() => __ss.setOv(0, null)); await p.waitForTimeout(200);

  // 刪除 → 復原
  await p.tap('.tile[data-id]:nth-of-type(2)'); await p.waitForTimeout(150);
  const delName = await p.evaluate(() => __ss.items[0].name);
  await p.tap('#selDel'); await idle();
  ok(await p.evaluate(() => __ss.items.length) === 2, '刪除一張');
  await p.tap('#toast button'); await idle();
  ok(await p.evaluate(() => __ss.items.map(i => i.name).join()) === 'IMG_1.PNG,IMG_2.PNG,IMG_3.PNG' && delName === 'IMG_1.PNG', '復原後回到原位');

  // 打亂順序 → 依內容排序
  await p.evaluate(() => { const it = __ss.items; [it[0], it[2]] = [it[2], it[0]]; }); await p.evaluate(() => __ss.processAll()); await idle();
  ok(await p.evaluate(() => __ss.plan.seams.some(s => s.mode === 'none')), '順序錯 → 有接縫找不到重疊');
  ok(await p.isVisible('#hint'), '順序錯時顯示提示');
  // 排序的 promise 會等背景執行緒的結果。直接交給 page.evaluate 等，CDP 偶爾回報「Promise was collected」
  // （Playwright 改寫成「Execution context was destroyed」），所以在頁面裡留一個強參考，等它設好完成旗標
  await p.evaluate(() => { window.__sortDone = false; window.__sortP = __ss.sortByContent().then(() => { window.__sortDone = true; }); });
  await p.waitForFunction(() => window.__sortDone === true, null, { timeout: 60000 }); await p.waitForTimeout(100); await idle();
  ok(await p.evaluate(() => __ss.items.map(i => i.name).join()) === 'IMG_1.PNG,IMG_2.PNG,IMG_3.PNG', '依內容排序後恢復正確順序');

  // JPEG 有損＋寬度不同（第 2 張放大 1.5 倍）也能對齊
  const mixed = await p.evaluate(async (bufs) => {
    const out = [];
    for (let i = 0; i < bufs.length; i++) {
      const bin = atob(bufs[i]), u8 = new Uint8Array(bin.length); for (let j = 0; j < bin.length; j++) u8[j] = bin.charCodeAt(j); const bm = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
      const k = i === 1 ? 1.5 : 1, c = document.createElement('canvas'); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bm, 0, 0, c.width, c.height);
      const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.72));
      const ab = new Uint8Array(await b.arrayBuffer()); let str = ''; for (let j = 0; j < ab.length; j++) str += String.fromCharCode(ab[j]); out.push(btoa(str));
    }
    return out;
  }, files.map(f => f.buffer.toString('base64')));
  if (await p.evaluate(() => document.querySelector('#selbar').classList.contains('off'))) await p.click('#tray .tile[data-id]'); await p.click('#selMore'); await p.waitForTimeout(300); await p.click('[data-act=clear]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __ss.items.length) === 0 && await p.isVisible('#empty'), '清除全部 → 顯示空白引導');
  await p.setInputFiles('#fileInput', mixed.map((b, i) => ({ name: `j${i}.jpg`, mimeType: 'image/jpeg', buffer: Buffer.from(b, 'base64') }))); await idle();
  st = await p.evaluate(() => ({ W: __ss.Wc, d: __ss.plan.seams.map(s => s.d), modes: __ss.plan.seams.map(s => s.mode), hs: __ss.items.map(i => i.h) }));
  ok(st.W === 390 && st.hs[1] === 844 && st.modes.every(m => m === 'overlap') && Math.abs(st.d[0] - 330) <= 1 && Math.abs(st.d[1] - 310) <= 1, 'JPEG（品質 0.72）＋第 2 張寬度不同：縮成同寬並對齊 ' + JSON.stringify(st));

  // 壞檔、非圖片
  await p.setInputFiles('#fileInput', [{ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png at all') }]); await p.waitForTimeout(300); await idle();
  ok(await p.evaluate(() => __ss.items.length) === 3 && /無法讀取/.test(await p.textContent('#toast')), '壞掉的圖片會被略過並說明');
  await p.setInputFiles('#fileInput', [{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }]); await p.waitForTimeout(200);
  ok(/只能加入圖片/.test(await p.textContent('#toast')), '非圖片檔會提示');

  // 接縫微調：快速連點 8 次（真實觸控）計數正確
  await p.tap('#strip .chip'); await p.waitForTimeout(700);
  ok(await p.isVisible('#seamSheet') && await p.evaluate(() => __ss.plan.seams[0].mode === 'overlap'), '點接縫圓點打開放大鏡 ' + await p.evaluate(() => __ss.plan.seams.map(s => s.mode).join()));
  // 按住超過 0.42 秒本來就會連發。機器很忙時 touchEnd 可能晚到，瀏覽器看到的就是一次長按，那一輪不算數，重來（最多 3 輪）。
  // 每一下在頁面裡記錄 pointerdown → pointerup 的時間，只有每下都是短按的那一輪才拿來判斷，判斷本身不放寬。
  const cdp = await ctx.newCDPSession(p);
  const bb = await p.locator('#stp0 button:last-child').boundingBox();
  let tapRes = null;
  for (let attempt = 0; attempt < 3 && !tapRes; attempt++) {
    if (attempt) { await p.click('#seamReset'); await p.waitForTimeout(400); }
    await p.evaluate(() => { const b = document.querySelector('#stp0 button:last-child'); window.__press = []; window.__pd = 0; b.onpointerdown = e => { window.__pd = e.timeStamp; }; b.onpointerup = e => { window.__press.push(e.timeStamp - window.__pd); }; window.__clk = []; b.onclick = e => window.__clk.push(e.detail); });
    const L0 = await p.evaluate(() => __ss.plan.seams[0].L);
    for (let i = 0; i < 8; i++) {
      const pt = [{ x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(125);
    }
    await p.waitForTimeout(700);
    const r = await p.evaluate(() => ({ L: __ss.plan.seams[0].L, press: window.__press.map(Math.round), clk: window.__clk.join('') }));
    if (r.press.length === 8 && r.press.every(t => t < 380)) tapRes = { d: r.L - L0, press: r.press, clk: r.clk };
    else console.log('（機器忙，觸控長度 ' + r.press.join(',') + ' ms，這一輪重來）');
  }
  ok(tapRes && tapRes.d === 8, `每秒 8 下連點「增加重疊」：+${tapRes && tapRes.d}（應為 +8；每下按住 ${tapRes && tapRes.press.join(',')} ms，click detail ${tapRes && tapRes.clk}）`);
  // 主執行緒卡住時：放開（事件時間只按了 50 ms）比連發計時器晚處理，也只能算一下
  const stall = await p.evaluate(async () => {
    const b = document.querySelector('#stp0 button:last-child'), L0 = __ss.plan.seams[0].L;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, isPrimary: true, button: 0, pointerType: 'touch' }));
    const t = performance.now(); while (performance.now() - t < 50) {}
    const up = new PointerEvent('pointerup', { bubbles: true, pointerId: 7, isPrimary: true, button: 0, pointerType: 'touch' });
    while (performance.now() - t < 600) {}
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    const mid = __ss.plan.seams[0].L - L0;
    b.dispatchEvent(up);
    await new Promise(r => setTimeout(r, 300));
    return { mid, d: __ss.plan.seams[0].L - L0 };
  });
  ok(stall.d === 1, `主執行緒卡住時短按只算一下（計時器先跑了 +${stall.mid}，放開後 +${stall.d}）`);
  // 鍵盤（click、detail 0）仍然算一下
  await p.waitForTimeout(1600);
  const kb = await p.evaluate(async () => { const b = document.querySelector('#stp0 button:last-child'), L0 = __ss.plan.seams[0].L; b.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); await new Promise(r => setTimeout(r, 100)); return __ss.plan.seams[0].L - L0; });
  ok(kb === 1, `鍵盤啟動算一下（+${kb}）`);
  // 真的按住會連發
  const held = await p.evaluate(async () => {
    const b = document.querySelector('#stp0 button:last-child'), L0 = __ss.plan.seams[0].L;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8, isPrimary: true, button: 0, pointerType: 'touch' }));
    await new Promise(r => setTimeout(r, 1200));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 8, isPrimary: true, button: 0, pointerType: 'touch' }));
    await new Promise(r => setTimeout(r, 300));
    return __ss.plan.seams[0].L - L0;
  });
  ok(held >= 5, `按住 1.2 秒會連發（+${held}）`);
  await p.click('#seamReset'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => __ss.plan.seams[0].auto), '還原自動');
  // 疊合檢查：對齊時沒有紅點，錯開時有
  await p.click('#diffTog'); await p.waitForTimeout(900);
  const badRows = await p.evaluate(() => { const c = document.querySelector('#magCv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 110 && d[i + 2] < 90) r++; return r; });
  await p.evaluate(() => __ss.setOv(0, { m: 'o', d: __ss.plan.seams[0].d + 6, c: 0 })); await p.waitForTimeout(900);
  const badRows2 = await p.evaluate(() => { const c = document.querySelector('#magCv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let r = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 110 && d[i + 2] < 90) r++; return r; });
  ok(badRows2 > 2000 && badRows2 > badRows * 5, `疊合檢查：錯開 6 px 時紅點明顯增加（${badRows} → ${badRows2}）`);
  await p.click('#seamDone');

  ok(errs.length === 0, '沒有頁面錯誤 ' + errs.slice(0, 3).join(' | '));
  ok(reqs.length === 0, '沒有任何對外請求 ' + reqs.slice(0, 3).join(' '));
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
