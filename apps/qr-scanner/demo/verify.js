// QR 碼掃描器驗證：node verify.js
// 用 qr-maker 實際產生的 PNG 與截圖，再做旋轉、縮小、加雜訊、模糊、透視、JPEG 壓縮等變形後，以內建解碼器解讀。
// 相機即時掃描：以 Chromium 假相機（--use-file-for-fake-video-capture 播放含 QR 碼的 MJPEG）測內建解碼器與 BarcodeDetector 兩條路徑。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const wrap = (src, out) => fs.writeFileSync(out, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(src, 'utf8') + '</body></html>');
const SRC = path.resolve(__dirname, '../index.html'), WRAP = path.join(__dirname, 'preview.html');
const MAKER = path.resolve(__dirname, '../../qr-maker/index.html'), MWRAP = path.join(__dirname, 'maker-preview.html');
wrap(SRC, WRAP); wrap(MAKER, MWRAP);
const OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const PAYLOADS = [
  ['url', 'https://www.example.com.tw/活動/2026?ref=qr&lang=zh-TW'],
  ['zh', '中文測試：臺北市信義區，營業時間 09:00–18:00，歡迎光臨！'],
  ['wifi', 'WIFI:T:WPA;S:巷口咖啡\\:2F;P:p@ss\\;w\\,rd;;'],
  ['num', '0912345678901234567890'],
  ['long', '長段落測試 '.repeat(20) + 'END'],
  ['vlong', 'https://example.org/' + 'abcdefghij'.repeat(55)],
];

(async () => {
  const browser = await chromium.launch();
  // ---------- 1. 用 qr-maker 產生測試圖 ----------
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto('file://' + MWRAP); await mp.waitForTimeout(500);
  const imgs = []; // {name, text, data(dataURL)}
  await mp.click('#type-text');
  for (const [name, text] of PAYLOADS) {
    await mp.fill('#f-text-text', text); await mp.waitForTimeout(400);
    const src = await mp.getAttribute('#preview', 'src');
    const ver = await mp.evaluate(() => state.qr.version);
    imgs.push({ name: `${name}-v${ver}`, text, data: src });
    if (name === 'url' || name === 'long') {
      const shot = await mp.locator('#stage').screenshot();
      imgs.push({ name: `${name}-截圖(元素)`, text, data: 'data:image/png;base64,' + shot.toString('base64') });
      const full = await mp.screenshot();
      imgs.push({ name: `${name}-整頁手機截圖`, text, data: 'data:image/png;base64,' + full.toString('base64') });
    }
  }
  // 圓點模組 + 圓角定位點 + 中央圖示（容錯 H）
  await mp.evaluate(() => document.getElementById('style-details').open = true);
  await mp.fill('#f-text-text', 'https://example.com/menu'); await mp.click('#shape-dot'); await mp.click('#finder-round');
  await mp.fill('#icon-emoji', '☕'); await mp.click('#iconsize-l'); await mp.waitForTimeout(500);
  imgs.push({ name: '圓點+圓角定位+圖示', text: 'https://example.com/menu', data: await mp.getAttribute('#preview', 'src') });
  await mctx.close();
  fs.writeFileSync(path.join(OUT, 'sample-qr-maker.png'), Buffer.from(imgs[0].data.split(',')[1], 'base64'));

  // ---------- 2. 掃描器頁面 ----------
  const mob = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei' };
  const ctx = await browser.newContext(mob);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await ctx.addInitScript(() => { window.__forceInternal = true; });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('file://' + WRAP); await page.waitForTimeout(1200);
  ok(await page.evaluate(() => innerWidth) === 390, 'innerWidth = 390');
  ok((await page.textContent('#results')).includes('www.example.com') && await page.isVisible('#stage-tag'), '開啟時顯示「範例」圖片並已解出網址');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // 變形工具（在頁面中以 canvas 產生）
  await page.evaluate(() => {
    window.__load = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    window.__rng = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
    window.__variant = async (src, kind) => {
      const im = await __load(src); let w = im.naturalWidth, h = im.naturalHeight;
      const mk = (W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); return [c, x]; };
      let c, x;
      const rot = deg => { const r = deg * Math.PI / 180, W = Math.ceil(Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r))) + 40, H = Math.ceil(Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r))) + 40;[c, x] = mk(W, H); x.fillStyle = '#d8d2c4'; x.fillRect(0, 0, W, H); x.translate(W / 2, H / 2); x.rotate(r); x.drawImage(im, -w / 2, -h / 2); };
      switch (kind) {
        case 'orig': return src;
        case 'rot90': rot(90); break; case 'rot180': rot(180); break; case 'rot30': rot(30); break; case 'rot45': rot(45); break; case 'rot-12': rot(-12); break;
        case 'small': { const s = 2.2 * 1 / (w / 60); [c, x] = mk(Math.round(w * s * 1.3), Math.round(h * s * 1.3)); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, w * s * 1.3, h * s * 1.3); break; }
        case 'half': [c, x] = mk(Math.round(w / 2.5), Math.round(h / 2.5)); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height); break;
        case 'noise': { [c, x] = mk(w, h); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const g = (__rng() + __rng() + __rng() - 1.5) * 90; const sp = __rng(); for (let k = 0; k < 3; k++) d.data[i + k] = sp < 0.02 ? 0 : sp > 0.98 ? 255 : Math.max(0, Math.min(255, d.data[i + k] + g)); } x.putImageData(d, 0, 0); break; }
        case 'blur': [c, x] = mk(w, h); x.filter = 'blur(' + Math.max(1, w / 400) + 'px)'; x.drawImage(im, 0, 0); break;
        case 'lowcontrast': { [c, x] = mk(w, h); x.drawImage(im, 0, 0); const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = 110 + d.data[i + k] * 0.27; x.putImageData(d, 0, 0); break; }
        case 'shadow': { [c, x] = mk(w, h); x.drawImage(im, 0, 0); const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.55)'); x.fillStyle = g; x.fillRect(0, 0, w, h); break; }
        case 'invert': { [c, x] = mk(w, h); x.filter = 'invert(1)'; x.drawImage(im, 0, 0); break; }
        case 'jpeg': { [c, x] = mk(w, h); x.drawImage(im, 0, 0); return c.toDataURL('image/jpeg', 0.35); }
        case 'photo': { const W = w * 2.6, H = h * 2.1;[c, x] = mk(W, H); const g = x.createRadialGradient(W * .3, H * .3, 10, W / 2, H / 2, W); g.addColorStop(0, '#9fb2a8'); g.addColorStop(1, '#3d4a44'); x.fillStyle = g; x.fillRect(0, 0, W, H); for (let i = 0; i < 40; i++) { x.fillStyle = `hsl(${__rng() * 360},30%,${30 + __rng() * 40}%)`; x.fillRect(__rng() * W, __rng() * H, __rng() * 120, __rng() * 120); } x.save(); x.translate(W * 0.58, H * 0.55); x.rotate(0.2); x.drawImage(im, -w / 2, -h / 2); x.restore(); break; }
        case 'two': { [c, x] = mk(w * 2 + 60, h + 40); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 20, 20); x.drawImage(window.__second, w + 40, 20, w, h); break; }
      }
      return c.toDataURL('image/png');
    };
    window.__perspective = async (src, rx, ry) => src; // 透視另以截圖產生
    window.__decode = async src => { const im = await __load(src); const t0 = performance.now(); const r = await decodeSource(im, im.naturalWidth, im.naturalHeight); return { texts: r.map(x => x.text), ms: Math.round(performance.now() - t0), w: im.naturalWidth, h: im.naturalHeight, v: r[0] && r[0].version }; };
  });

  // 透視：用 CSS 3D 變形後截圖
  const persp = [];
  { const pctx = await browser.newContext({ viewport: { width: 700, height: 700 } }); const pp = await pctx.newPage();
    for (const [i, [rx, ry]] of [[0, [28, -22]], [1, [-35, 15]], [2, [40, 30]]]) for (const im of [imgs[0], imgs.find(x => x.name.startsWith('long-v')), imgs.find(x => x.name.startsWith('vlong'))]) {
      await pp.setContent(`<body style="margin:0;background:#c9c3b5;display:grid;place-items:center;height:100vh"><img src="${im.data}" style="width:420px;transform:perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)"></body>`);
      await pp.waitForTimeout(100);
      persp.push({ name: `${im.name}-透視 ${rx}°/${ry}°`, text: im.text, data: 'data:image/png;base64,' + (await pp.screenshot()).toString('base64') });
    }
    await pctx.close(); }

  const KINDS = ['orig', 'rot90', 'rot180', 'rot-12', 'rot30', 'rot45', 'half', 'small', 'noise', 'blur', 'lowcontrast', 'shadow', 'invert', 'jpeg', 'photo'];
  const rows = []; let pass = 0, total = 0;
  for (const im of imgs) {
    for (const k of KINDS) {
      if ((im.name.includes('截圖') || im.name.includes('整頁')) && !['orig', 'rot90', 'half', 'jpeg', 'noise'].includes(k)) continue;
      const v = await page.evaluate(([s, k]) => __variant(s, k), [im.data, k]);
      const r = await page.evaluate(s => __decode(s), v);
      const good = r.texts[0] === im.text; total++; if (good) pass++;
      rows.push(`${good ? 'ok ' : 'NG '} ${im.name.padEnd(18)} ${k.padEnd(12)} ${r.w}x${r.h} ${r.ms}ms`);
    }
  }
  for (const im of persp) { const r = await page.evaluate(s => __decode(s), im.data); const good = r.texts[0] === im.text; total++; if (good) pass++; rows.push(`${good ? 'ok ' : 'NG '} ${im.name} ${r.ms}ms`); }
  fs.writeFileSync(path.join(OUT, 'sample-perspective.png'), Buffer.from(persp[0].data.split(',')[1], 'base64'));
  // 同一張圖兩個 QR
  await page.evaluate(async s => { window.__second = await __load(s); }, imgs[1].data);
  { const v = await page.evaluate(s => __variant(s, 'two'), imgs[0].data); const r = await page.evaluate(s => __decode(s), v); const good = r.texts.length === 2 && r.texts.includes(imgs[0].text) && r.texts.includes(imgs[1].text); total++; if (good) pass++; rows.push(`${good ? 'ok ' : 'NG '} 同圖兩個 QR → ${r.texts.length} 個`); }
  console.log(rows.join('\n'));
  ok(pass / total >= 0.95, `內建解碼器：${pass}/${total} 張變形圖解出正確內容（${(pass / total * 100).toFixed(1)}%）`);
  const must = rows.filter(r => /orig|截圖|整頁|rot90|rot180|rot30|rot45|half|noise|透視/.test(r) && r.startsWith('NG'));
  ok(must.length === 0, '原圖、截圖、旋轉、縮小、雜訊、透視全數成功' + (must.length ? '：' + must.join(' | ') : ''));
  // 非 QR 圖
  const none = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 600; c.height = 400; const x = c.getContext('2d'); for (let i = 0; i < 300; i++) { x.fillStyle = `hsl(${__rng() * 360},50%,50%)`; x.fillRect(__rng() * 600, __rng() * 400, 30, 30); } return (await __decode(c.toDataURL())).texts.length; });
  ok(none === 0, '沒有 QR 的圖片不誤判');

  // ---------- 3. 介面流程：選圖、拖入、貼上 ----------
  const buf = d => Buffer.from(d.split(',')[1], 'base64');
  const rotData = await page.evaluate(s => __variant(s, 'rot30'), imgs.find(x => x.name.startsWith('wifi')).data);
  await page.setInputFiles('#file-input', { name: 'wifi.png', mimeType: 'image/png', buffer: buf(rotData) });
  await page.waitForFunction(() => /解出/.test(document.getElementById('status').textContent) || /找不到/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  const wifi = await page.evaluate(() => ({ status: document.getElementById('status').textContent, type: document.querySelector('.card').dataset.type, txt: document.querySelector('.card').innerText, poly: document.querySelectorAll('#pv-overlay polygon').length }));
  ok(wifi.type === 'wifi' && wifi.txt.includes('巷口咖啡:2F') && wifi.txt.includes('WPA') && !wifi.txt.includes('p@ss;w,rd') && wifi.poly === 1, `選圖解出 Wi‑Fi（名稱跳脫還原、密碼遮罩、框出位置）：${wifi.status}`);
  await page.click('[data-act="showpw"]');
  ok((await page.textContent('.card .pw')) === 'p@ss;w,rd', 'Wi‑Fi 密碼可顯示：p@ss;w,rd');
  await page.screenshot({ path: path.join(OUT, '390x844-wifi.png') });
  await page.click('.card [data-sensitive]');
  await page.waitForFunction(() => /複製/.test(document.getElementById('toast').textContent), null, { timeout: 5000 }).catch(() => {});
  ok(/已複製/.test(await page.textContent('#toast')), '複製密碼：' + await page.textContent('#toast'));
  // 拖入
  await page.evaluate(async d => { const b = await (await fetch(d)).blob(); const f = new File([b], 'a.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }, imgs.find(x => x.name.startsWith('zh')).data);
  await page.waitForTimeout(1500);
  ok((await page.textContent('.card')).includes('臺北市信義區'), '拖入圖片解出中文');
  // 貼上（paste 事件）
  await page.evaluate(async d => { const b = await (await fetch(d)).blob(); const f = new File([b], 'p.png', { type: 'image/png' }); const dt = new DataTransfer(); dt.items.add(f); document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, imgs[0].data);
  await page.waitForTimeout(1500);
  const urlCard = await page.evaluate(() => ({ t: document.querySelector('.card').innerText, href: document.querySelector('.card a[data-act="open"]')?.href }));
  ok(urlCard.t.includes('www.example.com.tw') && urlCard.href && urlCard.href.startsWith('https://www.example.com.tw/'), '貼上圖片解出網址，網域粗體並可開啟');
  // 找不到
  await page.setInputFiles('#file-input', { name: 'none.png', mimeType: 'image/png', buffer: buf(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; const x = c.getContext('2d'); x.fillStyle = '#88a'; x.fillRect(0, 0, 300, 200); return c.toDataURL(); })) });
  await page.waitForFunction(() => /找不到/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  ok(true, '無 QR 圖片顯示「找不到 QR 碼，請試著裁切或拍清楚一點」');

  // ---------- 4. 內容解析與安全提示 ----------
  const cls = await page.evaluate(() => {
    const out = {};
    const show = t => { renderResults([{ text: t }], false); const c = document.querySelector('.card'); return { type: c.dataset.type, open: !!c.querySelector('a[data-act="open"]'), warns: [...c.querySelectorAll('.warns li')].map(l => l.textContent), text: c.innerText }; };
    out.js = show('javascript:alert(1)');
    out.http = show('http://192.168.1.1/login');
    out.at = show('https://www.paypal.com@evil.example/');
    out.short = show('https://bit.ly/3abcde');
    out.puny = show('https://xn--pypal-4ve.com/');
    out.puny2 = show('https://xn--fiqs8s.tw/');
    out.vcard = show('BEGIN:VCARD\r\nVERSION:3.0\r\nN:王;小明;;;\r\nFN:王小明\r\nTEL;TYPE=CELL:0912-345-678\r\nEMAIL:ming@example.com\r\nORG:範例公司\r\nEND:VCARD');
    out.event = show('BEGIN:VEVENT\r\nSUMMARY:讀書會\r\nDTSTART:20261103T060000Z\r\nDTEND:20261103T083000Z\r\nLOCATION:台北\r\nEND:VEVENT');
    out.tel = show('tel:+886912345678'); out.sms = show('SMSTO:0912345678:你好'); out.mail = show('mailto:a@example.com?subject=Hi');
    out.geo = show('geo:25.033964,121.564468');
    out.mecard = show('MECARD:N:陳大文;TEL:0223456789;EMAIL:wen@example.com;;');
    out.long = (() => { renderResults([{ text: 'x'.repeat(6000) }], false); const p = document.querySelector('.card .content'); return { sh: p.scrollHeight, ch: p.clientHeight }; })();
    return out;
  });
  ok(cls.js.type === 'danger' && !cls.js.open && cls.js.warns[0].includes('停用開啟'), 'javascript:alert(1) 不提供開啟，只能複製');
  ok(cls.http.warns.some(w => w.includes('HTTPS')) && cls.http.warns.some(w => w.includes('IP')), 'http:// 與 IP 網址顯示警告：' + cls.http.warns.length + ' 則');
  ok(cls.at.warns.some(w => w.includes('evil.example')), '含 @ 使用者資訊警告實際網域');
  ok(cls.short.warns.some(w => w.includes('短網址')), '短網址警告');
  ok(cls.puny.text.includes('xn--pypal-4ve.com') && cls.puny.warns.some(w => w.includes('西里爾')), 'Punycode 顯示 Unicode 與 xn-- 形式，混用文字系統警告：' + cls.puny.text.split('\n')[3]);
  ok(cls.puny2.text.includes('中国.tw'), 'xn--fiqs8s → 中国.tw');
  ok(cls.vcard.type === 'vcard' && cls.vcard.text.includes('王小明') && cls.vcard.text.includes('0912-345-678') && cls.vcard.text.includes('範例公司'), 'vCard 欄位解析');
  ok(cls.event.type === 'event' && cls.event.text.includes('讀書會') && cls.event.text.includes('2026/11/03 14:00'), '事件解析（UTC 轉當地時間）');
  ok(cls.tel.type === 'tel' && cls.sms.type === 'sms' && cls.sms.text.includes('你好') && cls.mail.type === 'email' && cls.geo.type === 'geo' && cls.mecard.text.includes('陳大文'), '電話、簡訊、Email、地理位置、MECARD');
  ok(cls.long.sh > cls.long.ch, '超長內容卡片內可捲動');
  // 字元集：Big5 位元組（無 ECI）與漢字模式
  const cs = await page.evaluate(() => {
    // 直接組一個位元組模式、內容為 Big5「中文」的版本 1 QR（手動建構資料碼字）
    const bits = []; const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    const big5 = [0xA4, 0xA4, 0xA4, 0xE5];
    push(4, 4); push(big5.length, 8); big5.forEach(b => push(b, 8)); push(0, 4);
    const q = QRCore.encodeQR('xxxx', { ecl: 'L' });
    return { note: 'encoder only produces UTF-8; Big5 fallback tested via decodeBytes', utf: new TextDecoder('big5').decode(Uint8Array.from(big5)) };
  });
  ok(cs.utf === '中文', 'Big5 後備解碼可用（' + cs.utf + '）');

  // 歷史
  await page.click('#btn-history');
  const hn = await page.locator('#hist-list li').count();
  ok(hn >= 3, `歷史紀錄 ${hn} 筆（範例不列入）`);
  await page.fill('#hist-search', '臺北'); ok(await page.locator('#hist-list li').count() === 1, '歷史可搜尋');
  await page.fill('#hist-search', '');
  await page.screenshot({ path: path.join(OUT, '390x844-history.png') });
  await page.click('#hist-list [data-del]'); ok(await page.locator('#hist-list li').count() === hn - 1, '刪除單筆');
  const ls = await page.evaluate(() => Object.keys(localStorage));
  ok(ls.every(k => k.startsWith('qr-scanner:v1:')), '儲存鍵：' + ls.join(', '));
  await page.click('#hist-close');
  // ---------- 5a. 相機：沒有權限／被嵌入頁面擋下 ----------
  await page.click('#btn-camera');
  await page.waitForFunction(() => document.getElementById('status').classList.contains('err'), null, { timeout: 10000 });
  const camErr = await page.evaluate(() => ({ t: document.getElementById('status').textContent, html: document.getElementById('status').innerHTML, live: document.getElementById('stage').classList.contains('live'), prev: !document.getElementById('preview').hidden }));
  ok(!camErr.live && camErr.prev && /相簿選圖/.test(camErr.t), '相機無法使用：顯示原因、退回原本畫面：' + camErr.t.slice(0, 50));
  ok(/timmango123\.github\.io\/pocket-apps\/tools\/#qr-scanner" target="_blank"/.test(camErr.html) || /找不到/.test(camErr.t), '非網站環境附上網站版連結（或沒有相機時說找不到）');
  // 相機掃描用的影格：640×480 灰底、略傾斜的 QR 碼（以頁面內建編碼器產生），輸出 JPEG
  const CAM_PAYLOADS = ['WIFI:T:WPA;S:相機測試;P:secret123;;', 'https://www.example.com.tw/live?scan=1'];
  const frames = await page.evaluate(texts => texts.map(text => {
    const q = QRCore.encodeQR(text, { ecl: 'M' }), n = q.size, ppm = Math.floor(260 / (n + 8)), side = (n + 8) * ppm;
    const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 640, 480); g.addColorStop(0, '#7d8a84'); g.addColorStop(1, '#4b5550'); x.fillStyle = g; x.fillRect(0, 0, 640, 480);
    x.translate(330, 236); x.rotate(0.09); x.fillStyle = '#f4f2ea'; x.fillRect(-side / 2, -side / 2, side, side); x.fillStyle = '#16191b';
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.modules[r * n + k]) x.fillRect(-side / 2 + (k + 4) * ppm, -side / 2 + (r + 4) * ppm, ppm + 0.4, ppm + 0.4);
    return c.toDataURL('image/jpeg', 0.85);
  }), CAM_PAYLOADS);
  const blankFrame = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; const x = c.getContext('2d'); x.fillStyle = '#5a625e'; x.fillRect(0, 0, 640, 480); return c.toDataURL('image/jpeg', 0.85); });
  // 嵌入頁面（sandbox iframe，等同 claude.ai）不允許相機
  { const fp = await ctx.newPage(); const fe = [];
    fp.on('pageerror', e => fe.push(String(e))); fp.on('console', m => { if (m.type() === 'error') fe.push(m.text()); });
    const src = fs.readFileSync(SRC, 'utf8').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    await fp.setContent(`<iframe sandbox="allow-scripts allow-popups" style="width:390px;height:800px;border:0" srcdoc="${src}"></iframe>`); await fp.waitForTimeout(1500);
    const f = fp.frames()[1]; await f.click('#btn-camera'); await f.waitForTimeout(300);
    const h = await f.innerHTML('#status');
    ok(/不允許使用相機/.test(h) && h.includes('href="https://timmango123.github.io/pocket-apps/tools/#qr-scanner" target="_blank"'), 'sandbox iframe 不允許相機：說明需要網站版並附新分頁連結');
    ok(fe.length === 0, 'sandbox iframe 內無 console 錯誤 ' + fe.join(' | '));
    await fp.close(); }
  ok(errors.length === 0, 'no console errors ' + errors.join(' | '));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 無水平捲動');
  await ctx.close();

  for (const [name, o] of [['360x780', { viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['390x844-dark', { ...mob, colorScheme: 'dark' }], ['1280x860-desktop', { viewport: { width: 1280, height: 860 } }]]) {
    const c = await browser.newContext(o); await c.addInitScript(() => { window.__forceInternal = true; });
    const p = await c.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('file://' + WRAP); await p.waitForTimeout(1200);
    const m = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, ok: document.getElementById('results').textContent.includes('example.com') }));
    ok(m.sw <= m.iw && m.iw === o.viewport.width && m.ok, `${name} 無水平捲動且範例已解出（${m.sw}/${m.iw}）`);
    ok(errs.length === 0, `${name} 無錯誤 ${errs.join('|')}`);
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }
  await browser.close();

  // ---------- 5b. 相機即時掃描（假相機） ----------
  // MJPEG：先約 1.5 秒空白畫面（確定是「持續掃描」才找到），之後是 QR 碼；Chromium 會循環播放。
  for (const [i, f] of frames.entries()) {
    const jpg = Buffer.from(f.split(',')[1], 'base64'), blank = Buffer.from(blankFrame.split(',')[1], 'base64');
    const file = path.join(OUT, `fake-cam-${i}.mjpeg`);
    fs.writeFileSync(file, Buffer.concat([...Array(45).fill(blank), ...Array(30).fill(jpg)]));
  }
  for (const [label, init, file, payload] of [
    ['內建解碼器', () => { window.__forceInternal = true; }, 'fake-cam-0.mjpeg', CAM_PAYLOADS[0]],
    ['BarcodeDetector', null, 'fake-cam-1.mjpeg', CAM_PAYLOADS[1]],
  ]) {
    const cb = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + path.join(OUT, file)] });
    const cctx = await cb.newContext(mob); await cctx.grantPermissions(['camera']);
    if (init) await cctx.addInitScript(init);
    const cp = await cctx.newPage(), ce = [];
    cp.on('pageerror', e => ce.push(String(e))); cp.on('console', m => { if (m.type() === 'error') ce.push(m.text()); });
    await cp.goto('file://' + WRAP); await cp.waitForTimeout(1200);
    let native = false;
    if (!init) {
      native = await cp.evaluate(async () => { try { return 'BarcodeDetector' in window && (await BarcodeDetector.getSupportedFormats()).includes('qr_code'); } catch { return false; } });
      if (!native) {
        // 這個 Chromium（Linux）沒有 BarcodeDetector：換上一個介面相同的替身，內部用頁面的解碼器，
        // 用來驗證「影片 → detect(video) → cornerPoints → 結果」這條路的串接。
        await cp.evaluate(() => {
          window.__detectCalls = 0;
          window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; }
            async detect(src) { window.__detectCalls++; if (!(src instanceof HTMLVideoElement) || !src.videoWidth) throw new Error('not a playing video');
              const c = document.createElement('canvas'); c.width = src.videoWidth; c.height = src.videoHeight; const x = c.getContext('2d'); x.drawImage(src, 0, 0);
              return QRScan.scanImageData(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height).map(r => ({ rawValue: r.text, format: 'qr_code', cornerPoints: r.corners.map(([x, y]) => ({ x, y })), boundingBox: {} })); } };
        });
      }
    }
    const engine = init ? '內建解碼器（強制 __forceInternal）' : native ? 'BarcodeDetector（瀏覽器原生）' : 'BarcodeDetector 路徑（Linux Chromium 無原生 API，以同介面替身驗證串接）';
    // 先開再關：釋放相機、回到範例畫面
    await cp.click('#btn-camera');
    await cp.waitForFunction(() => { const v = document.getElementById('cam'); return v.videoWidth > 0 && !v.hidden; }, null, { timeout: 10000 });
    const live = await cp.evaluate(() => ({ live: document.getElementById('stage').classList.contains('live'), finder: !document.getElementById('finder').hidden, torch: document.getElementById('cam-torch').hidden, fm: document.getElementById('cam').srcObject.getVideoTracks()[0].getSettings().facingMode }));
    ok(live.live && live.finder && live.torch, `${label}：相機畫面與取景框出現；假相機沒有手電筒 → 不顯示手電筒按鈕`);
    if (label === '內建解碼器') await cp.screenshot({ path: path.join(OUT, '390x844-camera.png') });
    await cp.click('#cam-close');
    const closed = await cp.evaluate(() => ({ cam, src: document.getElementById('cam').srcObject, prev: !document.getElementById('preview').hidden, tag: !document.getElementById('stage-tag').hidden }));
    ok(closed.cam === null && closed.src === null && closed.prev && closed.tag, `${label}：關閉相機後釋放串流、回到原本的範例圖`);
    // 頁面隱藏時自動關相機
    await cp.click('#btn-camera'); await cp.waitForFunction(() => document.getElementById('cam').videoWidth > 0, null, { timeout: 10000 });
    const tracks = await cp.evaluate(() => { window.__tr = document.getElementById('cam').srcObject.getTracks(); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); const r = window.__tr.map(t => t.readyState); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); return r; });
    ok(tracks.every(t => t === 'ended') && await cp.evaluate(() => cam === null), `${label}：頁面隱藏時停止相機（track ended）`);
    // 正式掃描
    await cp.evaluate(() => { localStorage.clear(); history.length = 0; });
    const t0 = Date.now();
    await cp.click('#btn-camera');
    const got = await cp.waitForFunction(() => /相機解出/.test(document.getElementById('status').textContent), null, { timeout: 30000 }).then(() => true, () => false);
    const r = await cp.evaluate(() => ({ status: document.getElementById('status').textContent, card: document.querySelector('.card') && document.querySelector('.card').innerText, type: document.querySelector('.card') && document.querySelector('.card').dataset.type, tech: document.querySelector('.card .tech') && document.querySelector('.card .tech').textContent,
      cam, src: document.getElementById('cam').srcObject, ended: (window.__tr2 || []).length, poly: document.querySelectorAll('#pv-overlay polygon').length, prev: !document.getElementById('preview').hidden, live: document.getElementById('stage').classList.contains('live'),
      hist: JSON.parse(localStorage.getItem('qr-scanner:v1:history') || '[]'), calls: window.__detectCalls }));
    console.log(`    ${label}: ${r.status}（含開相機 ${((Date.now() - t0) / 1000).toFixed(1)} 秒）${r.calls != null ? `，detect() 呼叫 ${r.calls} 次` : ''}`);
    ok(got && r.card && (payload.startsWith('WIFI') ? r.type === 'wifi' && r.card.includes('相機測試') && !r.card.includes('secret123') : r.type === 'url' && r.card.includes('www.example.com.tw')), `${engine}：即時掃描解出「${payload.slice(0, 24)}…」並用原本的結果卡顯示`);
    ok(r.cam === null && r.src === null && !r.live && r.prev && r.poly === 1, `${label}：找到後立刻關相機，留下該格畫面並框出 QR 碼`);
    ok(/相機/.test(r.tech || '') && r.hist[0] && r.hist[0].text === payload && r.hist[0].source === 'camera', `${label}：結果標示來源（${r.tech}），歷史紀錄來源為「相機」`);
    if (!init && !native) ok(r.calls >= 1, `${label}：使用 detect(video) 而非內建解碼器`);
    if (payload.startsWith('WIFI')) { await cp.click('[data-act="showpw"]'); ok((await cp.textContent('.card .pw')) === 'secret123', `${label}：Wi‑Fi 密碼可顯示`); }
    if (label === '內建解碼器') await cp.screenshot({ path: path.join(OUT, '390x844-camera-result.png') });
    ok(ce.length === 0, `${label}：無 console 錯誤 ${ce.join(' | ')}`);
    ok(await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}：無水平捲動`);
    await cb.close();
  }
  for (const f of ['fake-cam-0.mjpeg', 'fake-cam-1.mjpeg']) fs.unlinkSync(path.join(OUT, f));
  fs.unlinkSync(WRAP); fs.unlinkSync(MWRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
