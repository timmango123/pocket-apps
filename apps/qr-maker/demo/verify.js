// QR 碼產生器驗證腳本：node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// Artifact 宿主會把頁面包進含 viewport meta 的文件；測試時重現這一層。
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, '.wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP;
const OUT = __dirname;
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

const mockDownloads = () => {
  window.__saved = [];
  window.claude = { use: async n => n === 'downloads' ? { save: async o => { window.__saved.push({ filename: o.filename, kind: o.data instanceof Blob ? 'blob' : typeof o.data, size: o.data.size || o.data.length }); } } : null };
};

async function decodePreview(page) {
  return page.evaluate(async () => {
    const img = document.getElementById('preview');
    await img.decode();
    const st = effStyle(), n = state.qr.size, total = n + 2 * st.margin, ppm = img.naturalWidth / total;
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const r = decodeCanvas(c, n, st.margin, ppm, st.fg, st.bg, st.transparent);
    return { text: r.text, version: r.version, ecl: r.ecl, payload: state.payload, slug: document.getElementById('slug').textContent };
  });
}
async function decodeSVG(page) {
  return page.evaluate(async () => {
    const st = effStyle(), svg = makeSVG(state.qr, st, state.iconDataUrl), n = state.qr.size, total = n + 2 * st.margin, ppm = 12;
    const im = new Image(); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await im.decode();
    const c = document.createElement('canvas'); c.width = total * ppm; c.height = Math.round(im.naturalHeight / im.naturalWidth * total * ppm);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return decodeCanvas(c, n, st.margin, ppm, st.fg, st.bg, st.transparent).text;
  });
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei' });
  await ctx.addInitScript(mockDownloads);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL_); await page.waitForTimeout(400);

  // ---- 1. 標準向量 ----
  const core = await page.evaluate(() => {
    const m = QRCore.encodeQR('HELLO WORLD', { ecl: 'M' }), q = QRCore.encodeQR('HELLO WORLD', { ecl: 'Q' });
    return {
      mV: m.version, mData: m.dataCodewords, mEcc: m.codewords.slice(16), qData: q.dataCodewords, qEcc: q.codewords.slice(13),
      fmt: [0, 1, 2, 3].map(e => QRCore.formatBits(e, 0).toString(2).padStart(15, '0')),
      fmtQ6: QRCore.formatBits(2, 6).toString(2).padStart(15, '0'),
      v7: QRCore.versionBits(7).toString(2).padStart(18, '0'), v40: QRCore.versionBits(40).toString(2).padStart(18, '0'),
      maxL: QRCore.maxBytes('L'), maxM: QRCore.maxBytes('M'), maxQ: QRCore.maxBytes('Q'), maxH: QRCore.maxBytes('H'),
      num7089: QRCore.encodeQR('1'.repeat(7089), { ecl: 'L' }).version,
      num7090: (() => { try { QRCore.encodeQR('1'.repeat(7090), { ecl: 'L' }); return 'ok'; } catch (e) { return e.code; } })(),
      an4296: QRCore.encodeQR('A'.repeat(4296), { ecl: 'L' }).version,
      b2953: QRCore.encodeQR('a'.repeat(2953), { ecl: 'L' }).version,
      b2954: (() => { try { QRCore.encodeQR('a'.repeat(2954), { ecl: 'L' }); return 'ok'; } catch (e) { return e.code; } })(),
      v1Lnum41: QRCore.encodeQR('1'.repeat(41), { ecl: 'L' }).version, v1Lnum42: QRCore.encodeQR('1'.repeat(42), { ecl: 'L' }).version,
      v1Hbyte7: QRCore.encodeQR('abcdefg', { ecl: 'H' }).version, v1Hbyte8: QRCore.encodeQR('abcdefgh', { ecl: 'H' }).version,
    };
  });
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  ok(core.mV === 1 && eq(core.mData, [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]), 'HELLO WORLD 1-M 資料碼字 = 32 91 11 120 209 114 220 77 67 64 236 17 …');
  ok(eq(core.mEcc, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]), 'HELLO WORLD 1-M RS 碼字 = 196 35 39 119 235 215 231 226 93 23 (got ' + core.mEcc.join(' ') + ')');
  ok(eq(core.qData, [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236]), 'HELLO WORLD 1-Q 資料碼字');
  ok(eq(core.qEcc, [168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]), 'HELLO WORLD 1-Q RS 碼字 = 168 72 22 82 217 54 156 0 46 15 180 122 16 (got ' + core.qEcc.join(' ') + ')');
  ok(eq(core.fmt, ['111011111000100', '101010000010010', '011010101011111', '001011010001001']), '格式資訊 L/M/Q/H 遮罩 0 對照標準表 ' + core.fmt.join(','));
  ok(core.fmtQ6 === '010111011011010', '格式資訊 Q 遮罩 6 = 010111011011010 (got ' + core.fmtQ6 + ')');
  ok(core.v7 === '000111110010010100' && core.v40 === '101000110001101001', '版本資訊 v7 / v40 對照標準表');
  ok(core.maxL === 2953 && core.maxM === 2331 && core.maxQ === 1663 && core.maxH === 1273, `v40 位元組容量 L/M/Q/H = ${core.maxL}/${core.maxM}/${core.maxQ}/${core.maxH}`);
  ok(core.num7089 === 40 && core.num7090 === 'TOO_LONG' && core.an4296 === 40, '數字 7089 / 英數 4296 上限');
  ok(core.b2953 === 40 && core.b2954 === 'TOO_LONG', '位元組 2953 可產生、2954 報錯');
  ok(core.v1Lnum41 === 1 && core.v1Lnum42 === 2 && core.v1Hbyte7 === 1 && core.v1Hbyte8 === 2, '版本 1 容量邊界（1-L 數字 41、1-H 位元組 7）');

  // ---- 2. 全版本 × 全容錯 往返 + 錯誤修正 ----
  const rt = await page.evaluate(() => {
    const bad = [], vers = new Set(); let n = 0, corrected = 0; const t0 = performance.now();
    const samples = ['中文測試：臺灣🀄 QR', 'https://example.com/路徑?q=1', '0123456789', 'HELLO WORLD $%*+-./:'];
    for (let v = 1; v <= 40; v++) for (const ecl of 'LMQH') {
      const text = samples[(v + ecl.charCodeAt(0)) % samples.length] + ' #' + v + ecl;
      const q = QRCore.encodeQR(text, { ecl, minVersion: v }); vers.add(q.version);
      const m = q.modules.slice(), size = q.size;
      // 在資料區刮掉一小塊（3×3）模擬污損
      let flips = 0; const r0 = size - 12, c0 = size - 14;
      for (let r = r0; r < r0 + 3; r++) for (let c = c0; c < c0 + 3; c++) if (!q.isFunction[r * size + c]) { m[r * size + c] ^= 1; flips++; }
      try {
        const d = QRCore.decodeMatrix((r, c) => m[r * size + c], size); n++; corrected += d.corrected;
        if (d.text !== text || d.version !== q.version || d.ecl !== ecl) bad.push(v + ecl + ':' + d.text);
      } catch (e) { bad.push(v + ecl + ' ' + e.message); }
    }
    const t1 = performance.now(); QRCore.encodeQR('x'.repeat(2900), { ecl: 'L' }); const tv40 = performance.now() - t1;
    return { bad, nv: vers.size, n, corrected, ms: Math.round(t1 - t0), tv40: Math.round(tv40) };
  });
  ok(rt.bad.length === 0, `版本 1–40 × L/M/Q/H 共 ${rt.n} 組（涵蓋 ${rt.nv} 個版本）：編碼→刮損 3×3 模組→解碼全數正確（共修正 ${rt.corrected} 個碼字）${rt.bad.slice(0, 5).join(' | ')}`);
  ok(rt.tv40 < 200, `版本 40 編碼＋8 遮罩評分耗時 ${rt.tv40} ms`);

  // ---- 3. 介面流程：實際輸入並從輸出的 PNG 像素解碼 ----
  ok(await page.locator('#example-badge').isVisible(), '開啟時有「範例」標示與預設內容');
  // 文字（中文）
  await page.click('#type-text');
  const zh = '中文測試：臺北市信義區，營業時間 09:00–18:00，歡迎光臨！';
  await page.fill('#f-text-text', zh); await page.waitForTimeout(350);
  let d = await decodePreview(page);
  ok(d.text === zh, `中文文字 PNG 解碼一致（${d.slug}）`);
  ok(await decodeSVG(page) === zh, '中文文字 SVG 解碼一致');
  // 網址（未加 https:// 自動補）
  await page.click('#type-url');
  await page.fill('#f-url-url', 'www.example.com.tw/活動/2026?ref=qr&lang=zh-TW'); await page.waitForTimeout(350);
  d = await decodePreview(page);
  ok(d.text === 'https://www.example.com.tw/活動/2026?ref=qr&lang=zh-TW' && /https/.test(await page.textContent('#form-hint')), '網址自動補 https:// 並 PNG 解碼一致：' + d.text);
  // Wi‑Fi
  await page.click('#type-wifi');
  await page.fill('#f-wifi-ssid', '巷口咖啡:2F'); await page.fill('#f-wifi-pw', 'p@ss;w,rd"\\'); await page.selectOption('#f-wifi-enc', 'WPA');
  await page.check('#f-wifi-hidden'); await page.waitForTimeout(350);
  d = await decodePreview(page);
  const wifiExp = 'WIFI:T:WPA;S:巷口咖啡\\:2F;P:p@ss\\;w\\,rd\\"\\\\;H:true;;';
  ok(d.text === wifiExp, 'Wi‑Fi 字串跳脫並 PNG 解碼一致：' + d.text);
  ok(await decodeSVG(page) === wifiExp, 'Wi‑Fi SVG 解碼一致');
  // vCard、事件 payload 格式
  await page.click('#type-vcard'); await page.waitForTimeout(300);
  d = await decodePreview(page);
  ok(d.text.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\nN:王;小明;;;\r\nFN:王小明\r\n') && d.text.endsWith('END:VCARD'), 'vCard 3.0（CRLF）解碼一致');
  await page.click('#type-event'); await page.fill('#f-event-start', '2026-11-03T14:00'); await page.fill('#f-event-end', '2026-11-03T16:30'); await page.waitForTimeout(300);
  d = await decodePreview(page);
  const tz = await page.evaluate(() => new Date('2026-11-03T14:00').toISOString());
  ok(d.text.includes('DTSTART:20261103T060000Z') && d.text.includes('DTEND:20261103T083000Z'), '事件時間轉 UTC：' + d.text.split('\r\n')[2]);
  await page.click('#type-geo'); await page.fill('#f-geo-lat', '95'); await page.waitForTimeout(300);
  ok((await page.textContent('#form-hint')).includes('緯度'), '緯度超出範圍顯示紅字');
  await page.fill('#f-geo-lat', '25.033964'); await page.waitForTimeout(300);

  // 中央圖示 + 圓點 + 圓角定位點 → 內建解碼器驗證
  await page.click('#type-url'); await page.fill('#f-url-url', 'https://example.com/menu');
  await page.evaluate(() => document.getElementById('style-details').open = true);
  await page.click('#shape-dot'); await page.click('#finder-round');
  await page.fill('#icon-emoji', '☕'); await page.click('#iconsize-l'); await page.waitForTimeout(400);
  const vmsg = await page.textContent('#verify-msg');
  d = await decodePreview(page);
  ok(d.ecl === 'H' && d.text === 'https://example.com/menu' && /可讀，/.test(vmsg), `中央圖示（大）＋圓點：強制 H、仍可解碼（${vmsg}）`);
  await page.screenshot({ path: path.join(OUT, 'styled-390.png'), fullPage: true });
  await page.click('#icon-remove'); await page.click('#shape-square'); await page.click('#finder-square');

  // 色彩對比警告
  await page.fill('#fg', '#dddddd').catch(() => {});
  await page.evaluate(() => { const i = document.getElementById('fg'); i.value = '#e0e0e0'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(300);
  ok(await page.locator('#contrast-warn').isVisible(), '淺前景觸發對比警告');
  await page.evaluate(() => { const i = document.getElementById('fg'); i.value = '#000000'; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // 2953 位元組邊界（UI）
  await page.click('#type-text'); await page.click('#ecl-L');
  await page.fill('#f-text-text', 'a'.repeat(2953)); await page.waitForTimeout(400);
  ok((await page.textContent('#slug')).includes('版本 40'), 'UI：2953 位元組產生版本 40');
  await page.fill('#f-text-text', 'a'.repeat(2954)); await page.waitForTimeout(400);
  ok((await page.textContent('#stage')).includes('內容過長'), 'UI：2954 位元組顯示「內容過長」');
  await page.click('#ecl-M'); await page.click('#btn-clear'); await page.waitForTimeout(250);
  ok((await page.textContent('#stage')).includes('先在上方輸入'), '清空後顯示灰色占位');
  await page.fill('#f-text-text', '中文、網址、Wi‑Fi 都能掃'); await page.waitForTimeout(300);

  // PNG 2048 銳利度 + 下載
  const sharp = await page.evaluate(() => {
    const c = renderCanvas(2048), data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, set = new Set();
    for (let i = 0; i < data.length; i += 4) set.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2] + ',' + data[i + 3]);
    return { w: c.width, colors: set.size };
  });
  ok(sharp.colors === 2 && sharp.w <= 2048 && sharp.w > 1900, `2048 PNG：${sharp.w}px，僅 ${sharp.colors} 種顏色（無模糊）`);
  await page.selectOption('#png-size', '2048');
  await page.click('#btn-png'); await page.click('#btn-svg'); await page.waitForTimeout(400);
  const saved = await page.evaluate(() => window.__saved);
  ok(saved.length === 2 && saved[0].filename.endsWith('.png') && saved[0].kind === 'blob' && saved[1].filename.endsWith('.svg'), '下載 PNG/SVG 透過 downloads 能力：' + JSON.stringify(saved));
  // 歷史
  await page.click('#btn-history'); await page.waitForTimeout(200);
  const hist = await page.locator('#hist-list li').count();
  ok(hist >= 1, '輸出後寫入歷史：' + hist + ' 筆');
  const wifiHist = await page.evaluate(() => JSON.parse(localStorage.getItem('qr-maker:v1:history')).filter(h => h.type === 'wifi'));
  ok(wifiHist.every(h => !h.fields.pw), 'Wi‑Fi 密碼預設不存入歷史');
  await page.click('#hist-close');
  // 全螢幕
  await page.click('#stage'); await page.waitForTimeout(200);
  ok(await page.locator('#full').isVisible(), '點預覽進入全螢幕模式');
  await page.click('#full'); await page.waitForTimeout(100);

  // ---- 4. 無 downloads 能力時 ----
  const ctx2 = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage(); p2.on('pageerror', e => errors.push(String(e))); p2.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p2.goto(URL_); await p2.waitForTimeout(400);
  ok(await p2.locator('#btn-png').isHidden() && await p2.locator('#save-hint').isVisible(), '無 downloads 能力：隱藏下載鈕、顯示長按儲存提示');

  // ---- 5. 截圖與版面 ----
  const shots = [
    ['390x844', { width: 390, height: 844 }, true, 'light'], ['360x780', { width: 360, height: 780 }, true, 'light'],
    ['844x390', { width: 844, height: 390 }, true, 'light'], ['390x844-dark', { width: 390, height: 844 }, true, 'dark'], ['1280x860-desktop', { width: 1280, height: 860 }, false, 'light']];
  for (const [name, vp, mob, scheme] of shots) {
    const c = await browser.newContext({ viewport: vp, isMobile: mob, hasTouch: mob, deviceScaleFactor: 2, colorScheme: scheme });
    await c.addInitScript(mockDownloads);
    const p = await c.newPage(); p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await p.goto(URL_); await p.waitForTimeout(500);
    const sw = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${name}：無水平捲動 (${sw[0]} ≤ ${sw[1]})`);
    const small = await p.evaluate(() => [...document.querySelectorAll('button:not([hidden]),select,input:not([type=file]),.chip')].filter(e => e.offsetParent && !e.closest('[hidden]')).filter(e => { const r = e.getBoundingClientRect(); return r.height < 44 && e.type !== 'checkbox' && e.type !== 'color'; }).map(e => e.id));
    ok(small.length === 0, `${name}：觸控目標 ≥44px ${small.join(',')}`);
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    if (name === '390x844') {
      await p.evaluate(() => document.getElementById('style-details').open = true);
      await p.screenshot({ path: path.join(OUT, '390x844-full.png'), fullPage: true });
      await p.click('#btn-history'); await p.waitForTimeout(200); await p.screenshot({ path: path.join(OUT, '390x844-history.png') });
    }
    await c.close();
  }
  fs.unlinkSync(WRAP);
  ok(errors.length === 0, '無 console error / pageerror ' + errors.join(' | '));
  await browser.close();
  console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
  process.exit(fails ? 1 : 0);
})();
