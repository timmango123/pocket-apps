// QR 碼產生器：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qr-maker-t-')), WRAP = path.join(TMP, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, KEY = 'qr-maker:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 1×1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const pngWidth = buf => buf.readUInt32BE(16);
const seedHist = n => Array.from({ length: n }, (_, i) => ({ type: 'url', fields: { url: 'https://example.com/a-very-long-path/that-does-not-wrap/' + 'x'.repeat(40) + i }, style: {}, createdAt: 1760000000000 - i * 1000 }));

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, init, opt = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => typeof state !== 'undefined' && (state.qr || state.err || !state.payload));
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const center = async sel => { const b = await p.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tap = async (sel, hold = 0) => { if (typeof sel === 'string') await p.locator(sel).scrollIntoViewIfNeeded(); const c = typeof sel === 'string' ? await center(sel) : sel; await touch('touchStart', [{ ...c, id: 1 }]); if (hold) await sleep(hold); await touch('touchEnd', [{ ...c, id: 1 }]); await sleep(30); };
    return { ctx, p, touch, tap, center };
  }
  const reload = async p => { await p.reload(); await p.waitForFunction(() => typeof state !== 'undefined' && (state.qr || state.err || !state.payload)); };
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toast-text').textContent);

  // ---- 1. 表單內容保存（否決項）----
  {
    const { ctx, p } = await open();
    await p.click('#type-wifi'); await p.click('#btn-clear');
    await p.fill('#f-wifi-ssid', 'MyHome'); await p.fill('#f-wifi-pw', 'secret123');
    await p.click('#type-text'); await p.click('#btn-clear'); await p.fill('#f-text-text', '我的重要筆記 123');
    await reload(p);   // right after typing: pagehide writes at once
    assert(await p.inputValue('#f-text-text') === '我的重要筆記 123', '文字內容重新整理後還在');
    await p.click('#type-wifi');
    assert(await p.inputValue('#f-wifi-ssid') === 'MyHome' && await p.inputValue('#f-wifi-pw') === '', 'Wi‑Fi 名稱還在，密碼照 savepw 規則不存');
    assert((await p.textContent('#pw-note')).includes('密碼不保存'), '密碼欄旁寫明「密碼不保存」');
    await p.fill('#f-wifi-pw', 'secret123'); await p.check('#f-wifi-savepw');
    await reload(p);
    assert(await p.inputValue('#f-wifi-pw') === 'secret123' && (await p.textContent('#pw-note')).includes('會記在'), '勾選記住密碼後重新整理密碼還在');
    // uploaded icon survives reload (downscaled data URL)
    await p.click('#style-details summary');
    await p.setInputFiles('#icon-file', { name: 'logo.png', mimeType: 'image/png', buffer: PNG });
    await p.waitForFunction(() => state.style.icon.kind === 'image' && state.iconImg);
    await reload(p);
    const ic = await p.waitForFunction(() => state.style.icon.kind === 'image' && state.iconImg && state.iconDataUrl.startsWith('data:image/png'), null, { timeout: 5000 }).then(() => true, () => false);
    assert(ic, '上傳的中央圖片重新整理後還在');
    await ctx.close();
  }
  // old saved data (no 'fields' key) still loads; corrupt data does not break the page
  {
    const { ctx, p } = await open();
    await p.evaluate(K => { localStorage.clear(); localStorage.setItem(K + 'type', '"tel"'); localStorage.setItem(K + 'style', JSON.stringify({ fg: '#112233', bg: '#ffffff', ecl: 'Q', margin: 2, shape: 'dot', finder: 'round', icon: { kind: 'none', emoji: '', size: 'm' }, label: '', eci: false, pngSize: 512 })); localStorage.setItem(K + 'history', JSON.stringify([{ type: 'text', fields: { text: '舊紀錄' }, style: {}, createdAt: 1 }])); }, KEY);
    await reload(p);
    const old = await p.evaluate(() => ({ t: state.type, ecl: state.style.ecl, shape: state.style.shape, num: state.fields.tel.num, slug: document.getElementById('slug').textContent }));
    assert(old.t === 'tel' && old.ecl === 'Q' && old.shape === 'dot' && old.num === '0912-345-678' && old.slug.includes('容錯 Q'), '舊版 localStorage（無 fields）照常載入：' + JSON.stringify(old));
    for (const [style, hist] of [['{"ecl":"Z","margin":"x"}', 'null'], ['"oops"', '{}'], ['{"icon":null,"fg":5,"pngSize":7}', '[{"type":"wifi","fields":null},{"type":"nope"},5,{"type":"url","fields":{"url":3}}]'], ['not json', '[null]']]) {
      const n0 = errors.length;
      await p.evaluate(([K, s, h]) => { localStorage.setItem(K + 'style', s); localStorage.setItem(K + 'history', h); localStorage.setItem(K + 'fields', '{"wifi":null,"text":{"text":7}}'); }, [KEY, style, hist]);
      await reload(p);
      await p.click('#btn-history');
      const r = await p.evaluate(() => ({ img: !!document.getElementById('preview').src, hist: !document.getElementById('history').hidden, rows: document.querySelectorAll('#hist-list li').length }));
      await p.click('#hist-close');
      assert(errors.length === n0 && r.img && r.hist, `壞掉的 style=${style} history=${hist}：不當掉、有預覽、歷史可開（${r.rows} 筆）`);
    }
    await ctx.close();
  }

  // ---- 2. 歷史清單在手機上完整顯示（否決項）＋刪除不跳、可復原 ----
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    const { ctx, p, tap, center } = await open(w, h);
    await p.evaluate(H => localStorage.setItem('qr-maker:v1:history', H), JSON.stringify(seedHist(5)));
    await tap('#btn-history');
    const g = await p.evaluate(() => {
      const sheet = document.querySelector('#history .sheet').getBoundingClientRect(), ov = document.getElementById('history');
      const btns = [...document.querySelectorAll('#hist-list .btn')].map(b => b.getBoundingClientRect());
      return { right: sheet.right, maxBtn: Math.max(...btns.map(b => b.right)), minW: Math.min(...btns.map(b => b.width)), minH: Math.min(...btns.map(b => b.height)), scroll: ov.scrollWidth - ov.clientWidth, vw: innerWidth };
    });
    assert(g.maxBtn <= g.right && g.scroll <= 0 && g.right <= g.vw && g.minW >= 44 && g.minH >= 44, `${w}×${h}：歷史的載入/刪除都在 sheet 內（按鈕右緣 ${g.maxBtn.toFixed(0)} ≤ ${g.right.toFixed(0)}，無橫向捲動）`);
    if (w === 390) {
      const before = await p.evaluate(() => [...document.querySelectorAll('#hist-list li')].map(li => li.getBoundingClientRect().top));
      const pt = await center('#hist-del-0');
      await tap(pt);
      const after = await p.evaluate(() => ({ tops: [...document.querySelectorAll('#hist-list li')].map(li => li.getBoundingClientRect().top), n: JSON.parse(localStorage.getItem('qr-maker:v1:history')).length }));
      assert(after.n === 4 && JSON.stringify(after.tops) === JSON.stringify(before), '刪除一筆後列的位置都不動（已存 4 筆）');
      assert((await toastText(p)).includes('已刪除') && await p.isVisible('#toast-act'), '刪除後有「已刪除・復原」提示');
      for (const ms of [150, 300, 450]) { await sleep(ms); await tap(pt); }
      const st = await p.evaluate(() => ({ open: !document.getElementById('history').hidden, n: JSON.parse(localStorage.getItem('qr-maker:v1:history')).length }));
      assert(st.open && st.n === 4, '在同一點再點三下：沒有刪到別筆、歷史沒被關掉');
      // top row: also must not hit 關閉
      await tap('#hist-undo-0');
      const un = await p.evaluate(() => ({ n: JSON.parse(localStorage.getItem('qr-maker:v1:history')).length, first: document.querySelector('#hist-list li b').textContent }));
      assert(un.n === 5 && un.first.endsWith('x0'), '列內「復原」把那筆放回原位');
      await tap('#hist-del-2'); await tap('#toast-act');
      assert(await p.evaluate(() => JSON.parse(localStorage.getItem('qr-maker:v1:history')).length) === 5, 'toast 的「復原」也能救回刪掉的那筆');
      await tap('#hist-clear'); await tap('#hist-confirm-yes'); await tap('#toast-act');
      assert(await p.evaluate(() => JSON.parse(localStorage.getItem('qr-maker:v1:history')).length) === 5, '「全部清除」也可以復原');
    }
    await ctx.close();
  }

  // ---- 3. 打字時看得到 QR 碼（sticky 小預覽）----
  {
    const { ctx, p, tap } = await open(390, 844);
    for (const [type, last] of [['wifi', '#f-wifi-savepw'], ['vcard', '#f-vcard-note']]) {
      await p.click('#type-' + type);
      await p.locator(last).scrollIntoViewIfNeeded(); await p.focus(last);
      if (type === 'vcard') await p.fill('#f-vcard-note', '測試備註');
      await p.waitForFunction(() => state.payload.includes('NOTE') || state.type === 'wifi');
      const m = await p.evaluate(() => { const r = document.getElementById('mini-img').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width, same: document.getElementById('mini-img').src === document.getElementById('preview').src }; });
      assert(m.top >= 0 && m.bottom <= 844 && m.w >= 50 && m.same, `390×844 ${type}：捲到最後一欄時小 QR 預覽仍在畫面內（y=${m.top.toFixed(0)}–${m.bottom.toFixed(0)}）且與預覽同步`);
    }
    await tap('#mini');
    const vis = await p.waitForFunction(() => { const r = document.getElementById('stage').getBoundingClientRect(); return r.top >= -1 && r.bottom <= innerHeight + 1; }, null, { timeout: 3000 }).then(() => true, () => false);
    assert(vis, '點小預覽捲到完整預覽');
    await ctx.close();
  }

  // ---- 4. 有圖示時每次輸入只做一次編碼；驗證分段在背景完成，結果與一次跑完相同 ----
  {
    const { ctx, p } = await open();
    await p.click('#type-text');
    const r = await p.evaluate(async () => {
      const enc = QRCore.encodeQR; let n = 0; QRCore.encodeQR = (...a) => { n++; return enc(...a); };
      state.style.icon = { kind: 'emoji', emoji: '☕', size: 'l' }; syncStyleUI();
      const ta = document.getElementById('f-text-text'); ta.value = '測'.repeat(330); ta.dispatchEvent(new Event('input', { bubbles: true }));
      generate(); finishVerify();
      const per = [], times = [];
      for (let i = 0; i < 12; i++) {
        ta.value += 'abc'[i % 3]; ta.dispatchEvent(new Event('input', { bubbles: true }));
        n = 0; const t0 = performance.now(); generate(); times.push(performance.now() - t0); per.push(n);
      }
      // background steps: each runs one encode
      const steps = []; while (job) { n = 0; const t0 = performance.now(); stepVerify(true); steps.push([n, performance.now() - t0]); }
      const final = state.qr.version;
      // reference: the original one-shot loop from the base version
      const st = effStyle(), base = enc(state.payload, { ecl: 'H' }); let q = base;
      for (;;) { const c = checkReadable(q, st, state.payload); if ((c.ok && c.load <= 0.75) || q.version >= Math.min(40, base.version + 6)) break; q = enc(state.payload, { ecl: 'H', minVersion: q.version + 1 }); }
      QRCore.encodeQR = enc;
      times.sort((a, b) => a - b);
      return { per, steps, final, ref: q.version, med: times[6], msg: document.getElementById('verify-msg').textContent };
    });
    assert(r.per.every(x => x <= 1), '有圖示時每次輸入最多 1 次編碼：' + r.per.join(','));
    assert(r.steps.every(([x]) => x <= 1), '背景驗證每一步最多 1 次編碼（' + r.steps.length + ' 步）');
    assert(r.final === r.ref && r.msg.includes('讀回驗證'), `背景驗證後版本 ${r.final} 與一次跑完的結果 ${r.ref} 相同`);
    console.log(`     (每次輸入 generate 中位數 ${r.med.toFixed(1)} ms)`);
    // after typing stops the check finishes by itself, and exports wait for it
    await p.fill('#f-text-text', 'https://example.com/' + 'q'.repeat(200));
    const done = await p.waitForFunction(() => !job && document.getElementById('verify-msg').textContent.includes('讀回'), null, { timeout: 10000 }).then(() => true, () => false);
    assert(done, '停止打字後背景驗證自己完成');
    // ---- 5. 打字防抖 ≤ 60ms；樣式按鈕立即產生 ----
    const deb = await p.evaluate(async () => {
      state.style.icon = { kind: 'none', emoji: '', size: 'm' }; syncStyleUI(); generate();
      const ta = document.getElementById('f-text-text'); ta.value = 'debounce-1'; ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 70));
      const typed = state.payload === 'debounce-1';
      document.getElementById('ecl-Q').click(); const q = document.getElementById('slug').textContent.includes('容錯 Q');
      document.getElementById('shape-dot').click(); const dot = state.style.shape === 'dot' && !!state.qr;
      return { typed, q, dot };
    });
    assert(deb.typed, '打字後 60ms 內就重新產生');
    assert(deb.q && deb.dot, '容錯／形狀切換立即產生（不經防抖）');
    await ctx.close();
  }

  // ---- 6. 經緯度、電話嚴格驗證；± 鍵；鍵盤屬性 ----
  {
    const { ctx, p, tap } = await open();
    await p.click('#type-geo');
    const geo = async (a, b) => { await p.fill('#f-geo-lat', a); await p.fill('#f-geo-lng', b); await p.waitForFunction(() => document.getElementById('payload').textContent.length > 0); await sleep(80); await p.evaluate(() => generate()); return p.evaluate(() => ({ p: state.payload, h: document.getElementById('form-hint').textContent })); };
    let g = await geo('25,03', '121,56'); assert(g.p === '' && g.h.includes('小數點'), '經緯度用逗號：不產生，提示「請用小數點」');
    g = await geo('25abc', '121.5xyz'); assert(g.p === '' && g.h.includes('只能是數字'), '經緯度含字母：不產生並提示');
    g = await geo('33.8688', '151.2093'); assert(g.p === 'geo:33.8688,151.2093', '正常經緯度：' + g.p);
    await tap('#f-geo-lat-sign'); await tap('#f-geo-lng-sign'); await p.evaluate(() => generate());
    g = await p.evaluate(() => state.payload); assert(g === 'geo:-33.8688,-151.2093', '± 鍵切換負號（iOS 小數鍵盤沒有負號）：' + g);
    const sb = await p.locator('#f-geo-lat-sign').boundingBox(); assert(sb.width >= 44 && sb.height >= 44, '± 鍵 ≥ 44×44');
    await p.click('#type-tel');
    await p.fill('#f-tel-num', 'abc'); await p.evaluate(() => generate());
    let t = await p.evaluate(() => ({ p: state.payload, h: document.getElementById('form-hint').textContent }));
    assert(t.p === '' && t.h.includes('只能有數字'), '電話 abc：不產生 tel:abc 並提示');
    await p.fill('#f-tel-num', '+886 (2) 2345-6789,123#'); await p.evaluate(() => generate());
    assert(await p.evaluate(() => state.payload) === 'tel:+886223456789,123#', '電話允許 + 數字 , #，略過空白與括號');
    await p.click('#type-wifi');
    const at = await p.evaluate(() => ['f-wifi-ssid', 'f-wifi-pw'].map(id => { const e = document.getElementById(id); return [e.getAttribute('autocapitalize'), e.getAttribute('autocorrect'), e.getAttribute('spellcheck')].join('/'); }));
    assert(at.every(x => x === 'off/off/false'), 'SSID 與密碼欄關閉自動大寫、自動修正、拼字檢查：' + at.join(' '));
    // ---- 7. 清空可復原 ----
    await tap('#btn-clear');
    assert(await p.inputValue('#f-wifi-ssid') === '' && (await toastText(p)).includes('已清空'), '清空後出現「已清空・復原」');
    await tap('#toast-act');
    assert(await p.inputValue('#f-wifi-ssid') === '巷口咖啡-Guest', '按「復原」還原清空前的內容');
    await ctx.close();
  }

  // ---- 8. 沒有 downloads 能力（GitHub Pages）時用 <a download>；PNG 尺寸等於所選 ----
  {
    const { ctx, p } = await open();
    await p.click('#type-text'); await p.fill('#f-text-text', 'a'.repeat(2300)); await p.waitForFunction(() => state.qr && state.qr.version === 40);
    assert(await p.isVisible('#btn-png') && await p.isVisible('#btn-svg'), '沒有 downloads 能力時下載鈕仍顯示');
    await p.selectOption('#png-size', '256');
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#btn-png')]);
    const w = d ? pngWidth(fs.readFileSync(await d.path())) : 0;
    assert(d && d.suggestedFilename().endsWith('.png') && w === 256, `版本 40 選 256 px：下載 ${d && d.suggestedFilename()}，寬 ${w}px`);
    await p.selectOption('#png-size', '1024'); await p.fill('#f-text-text', 'hi'); await p.waitForFunction(() => state.qr && state.qr.version === 1);
    const [d2] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#btn-png')]);
    assert(d2 && pngWidth(fs.readFileSync(await d2.path())) === 1024, '版本 1 選 1024 px：寬 1024px');
    const [d3] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('#btn-svg')]);
    assert(d3 && d3.suggestedFilename().endsWith('.svg') && fs.readFileSync(await d3.path(), 'utf8').startsWith('<svg'), '下載 SVG');
    // ---- 9. 細節 ----
    await p.click('#style-details summary'); await p.click('#ecl-L');
    await p.fill('#f-text-text', 'a'.repeat(3000)); await p.waitForFunction(() => state.err === 'TOO_LONG');
    const tl = await p.textContent('#stage');
    assert((tl.match(/容錯 L/g) || []).length === 1 && tl.includes('縮短') && tl.includes('網址'), '已是 L 時「內容過長」不重複 L 上限，並提示縮短或改用網址');
    await p.click('#ecl-M'); await p.waitForFunction(() => document.getElementById('stage').textContent.includes('容錯 M'));
    assert((await p.textContent('#stage')).includes('可改用容錯 L（最多約 2,953 位元組），或縮短內容'), '容錯 M 時「內容過長」改寫成「可改用容錯 L（最多約 2,953 位元組），或縮短內容」');
    await p.click('#ecl-L');
    await p.fill('#f-text-text', 'hello'); await p.fill('#icon-emoji', '☕');
    await p.waitForFunction(() => state.qr && !job);
    const hb = await p.evaluate(() => { const b = document.getElementById('ecl-H'), cs = getComputedStyle(b); return { op: cs.opacity, pressed: b.getAttribute('aria-pressed'), dis: b.disabled, bg: cs.backgroundColor, l: getComputedStyle(document.getElementById('ecl-L')).opacity }; });
    assert(hb.pressed === 'true' && hb.dis && hb.op === '1' && hb.l !== '1', '有圖示時已選的 H 不像停用（不透明、深色底），其他等級才淡化');
    // emoji keeps a ring of background inside the cleared square
    const ring = await p.evaluate(() => {
      const st = effStyle(), c = renderCanvas(0, 10), ctx = c.getContext('2d'), box = iconBox(state.qr.size, st), mg = st.margin, ppm = 10;
      const d = ctx.getImageData(0, 0, c.width, c.height).data; let bad = 0;
      const a = (box.a + mg) * ppm, b = (box.b + mg) * ppm, pad = Math.round(1.25 * ppm);
      for (let y = a; y < b; y++) for (let x = a; x < b; x++) {
        if (x >= a + pad && x < b - pad && y >= a + pad && y < b - pad) continue;
        const i = (y * c.width + x) * 4; if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) bad++;
      }
      return bad;
    });
    assert(ring === 0, 'emoji 圖示外留一圈底色（清空區外圈 1.25 模組內沒有非底色像素：' + ring + '）');
    await ctx.close();
  }
  {
    const { ctx, p } = await open(360, 640);
    const f = await p.evaluate(() => document.getElementById('type-chips').classList.contains('more'));
    await p.evaluate(() => { const c = document.getElementById('type-chips'); c.scrollLeft = c.scrollWidth; });
    await p.waitForFunction(() => !document.getElementById('type-chips').classList.contains('more'), null, { timeout: 2000 }).catch(() => {});
    const g = await p.evaluate(() => document.getElementById('type-chips').classList.contains('more'));
    assert(f && !g, '360 寬：類型 chip 列右側有漸層提示，捲到底後消失');
    await ctx.close();
  }

  // ---- 10. 觸控：pointerup 觸發、不重複、不連帶點到新出現的按鈕 ----
  {
    const { ctx, p, tap, touch, center } = await open();
    await p.click('#type-wifi');
    const lbl = () => p.textContent('#f-wifi-pw-show');
    let ok = true; const seq = [];
    for (const hold of [0, 0, 600, 1000]) { const b = await lbl(); await tap('#f-wifi-pw-show', hold); const a = await lbl(); seq.push(a); if (a === b) ok = false; }
    assert(ok, '單點、慢點 0.6s、1s：顯示/隱藏各切換一次（' + seq.join('→') + '）');
    // checkbox label and <summary>: one toggle per tap, also slow
    let cb = true;
    for (const hold of [0, 1000]) { const c0 = await p.isChecked('#f-wifi-hidden'); await tap('label[for=f-wifi-hidden]', hold); if (await p.isChecked('#f-wifi-hidden') === c0) cb = false; }
    const d0 = await p.evaluate(() => document.getElementById('style-details').open); await tap('#style-details summary');
    const d1 = await p.evaluate(() => document.getElementById('style-details').open); await tap('#style-details summary', 600);
    assert(cb && d1 !== d0 && await p.evaluate(() => document.getElementById('style-details').open) === d0, '勾選框的標籤、樣式設定的展開列：快點與慢點都只切換一次');
    // another finger already down on blank space
    await p.locator('#f-wifi-pw-show').scrollIntoViewIfNeeded();
    const blank = { ...(await center('#form-title')), id: 2 };   // plain heading text, nothing tappable
    const pw = await center('#f-wifi-pw-show'), b0 = await lbl();
    await touch('touchStart', [blank]); await touch('touchStart', [blank, { ...pw, id: 3 }]); await touch('touchEnd', [{ ...pw, id: 3 }]); await sleep(30);
    const mid = await lbl(); await touch('touchEnd', [blank]); await sleep(30);
    assert(mid !== b0 && await lbl() === mid, '另一指按著時再點一下也會觸發，且只觸發一次');
    // 8 taps a second, alternating between two controls
    await p.click('#style-details summary');
    let miss = 0;
    for (let i = 0; i < 8; i++) { const v = i % 2 ? 'L' : 'Q'; await tap('#ecl-' + v); if (await p.evaluate(() => state.style.ecl) !== v) miss++; await sleep(60); }
    assert(miss === 0, '每秒約 8 下交替點容錯 Q/L：0 遺漏');
    // keyboard still works
    const k0 = await lbl(); await p.focus('#f-wifi-pw-show'); await p.keyboard.press('Enter'); const k1 = await lbl(); await p.keyboard.press('Space');
    assert(k1 !== k0 && await lbl() === k0, '鍵盤 Enter／Space 仍可操作按鈕');
    // screen changes: the button that appears under the finger must not fire
    await p.evaluate(() => scrollTo(0, 0));
    await tap('#btn-history');
    assert(await p.isVisible('#history'), '點「歷史」打開後沒有連帶點到「關閉」');
    await tap('#hist-close'); assert(await p.isHidden('#history'), '關閉歷史');
    await p.locator('#stage').scrollIntoViewIfNeeded();
    await tap('#stage'); await sleep(120);
    assert(await p.isVisible('#full'), '點預覽進全螢幕後沒有被同一下關掉');
    await tap('#full-close'); assert(await p.isHidden('#full'), '全螢幕的「關閉」');
    await p.evaluate(() => { let n = 0; const b = document.getElementById('shape-round'); const h = () => n++; b.addEventListener('click', h); window.__cnt = () => { b.removeEventListener('click', h); return n; }; });
    await tap('#shape-round'); await sleep(350);
    assert(await p.evaluate(() => window.__cnt()) === 1, '一次觸控只送出一次 click 給按鈕（後續的原生 click 被吞掉）');
    await ctx.close();
  }

  // ---- 11. 關掉上層的那一下，不能讓底下的輸入框取得焦點或 click（第 2 輪否決項）----
  {
    const { ctx, p, tap, touch } = await open();
    await p.evaluate(H => localStorage.setItem('qr-maker:v1:history', H), JSON.stringify(seedHist(1)));
    const fieldLog = () => p.evaluate(() => { window.__f = []; for (const el of document.querySelectorAll('input,textarea,select')) for (const t of ['focusin', 'click']) el.addEventListener(t, () => window.__f.push(t + ':' + el.id)); });
    const active = () => p.evaluate(() => ({ tag: document.activeElement.tagName, id: document.activeElement.id, log: window.__f.join(',') }));
    // move the page so that `sel` sits under viewport point y
    const putUnder = (sel, y) => p.evaluate(([sel, y]) => { const r = document.querySelector(sel).getBoundingClientRect(); scrollBy(0, r.top + r.height / 2 - y); }, [sel, y]);
    // 1) 名片清空 → toast「復原」蓋在 email 欄上
    await p.click('#type-vcard'); await tap('#btn-clear');
    const tb = await p.locator('#toast-act').boundingBox(), ty = tb.y + tb.height / 2;
    await putUnder('#f-vcard-email', ty); await p.evaluate(() => document.activeElement.blur()); await fieldLog();
    const under1 = await p.evaluate(([x, y]) => { const t = document.getElementById('toast'); t.style.visibility = 'hidden'; const e = document.elementFromPoint(x, y); t.style.visibility = ''; return e.id; }, [tb.x + tb.width / 2, ty]);
    await tap({ x: tb.x + tb.width / 2, y: ty }); await sleep(300);
    let a = await active();
    assert(under1 === 'f-vcard-email' && await p.inputValue('#f-vcard-last') === '王' && !/INPUT|TEXTAREA|SELECT/.test(a.tag) && !a.log, `toast「復原」蓋在 email 欄上：復原成功、底下欄位沒有 focus/click（active=${a.tag}#${a.id} ${a.log}）`);
    // 2) 全螢幕：點網址欄正上方的空白處
    await p.click('#type-url'); await p.evaluate(() => scrollTo(0, 0)); await p.click('#btn-full'); await p.evaluate(() => document.activeElement.blur());
    await putUnder('#f-url-url', 120); await fieldLog();
    const fr = await p.evaluate(() => { const r = document.getElementById('f-url-url').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
    const hit2 = await p.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [fr.x, fr.y]);
    await tap(fr); await sleep(300); a = await active();
    assert(hit2 === 'full' && await p.isHidden('#full') && !/INPUT|TEXTAREA|SELECT/.test(a.tag) && !a.log, `全螢幕點網址欄上方空白：關閉，網址欄沒有 focus/click（active=${a.tag}#${a.id} ${a.log}）`);
    // 3) 歷史 sheet 下方的暗色背景蓋在網址欄上
    await p.evaluate(() => scrollTo(0, 0)); await tap('#btn-history');
    const sheetBottom = await p.evaluate(() => document.querySelector('#history .sheet').getBoundingClientRect().bottom);
    await putUnder('#f-url-url', sheetBottom + 80); await p.evaluate(() => document.activeElement.blur()); await fieldLog();
    const fr3 = await p.evaluate(() => { const r = document.getElementById('f-url-url').getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 }; });
    const hit3 = await p.evaluate(([x, y]) => document.elementFromPoint(x, y).id, [fr3.x, fr3.y]);
    await tap(fr3); await sleep(300); a = await active();
    assert(hit3 === 'history' && await p.isHidden('#history') && !/INPUT|TEXTAREA|SELECT/.test(a.tag) && !a.log, `歷史點暗色背景（蓋在網址欄上）：關閉，網址欄沒有 focus/click（active=${a.tag}#${a.id} ${a.log}）`);
    // a normal tap on a field still focuses it (keyboard comes up)
    await sleep(650); await tap(fr3); await sleep(100);
    a = await active(); assert(a.id === 'f-url-url', '一般點輸入框仍會取得焦點，可以打字');
    await p.keyboard.press('End'); await p.keyboard.type('x'); assert((await p.inputValue('#f-url-url')).endsWith('x'), '點完可以直接打字');
    // ---- 12. 「輸出」捷徑：長表單也能一下到下載 PNG ----
    for (const t of ['wifi', 'vcard']) {
      await p.click('#type-' + t); await p.locator('#f-' + t + (t === 'wifi' ? '-savepw' : '-note')).scrollIntoViewIfNeeded();
      await tap('#btn-go-export');
      const ok = await p.waitForFunction(() => { const r = document.getElementById('btn-png').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: 3000 }).then(() => true, () => false);
      assert(ok, `${t}：固定標題列的「輸出」捲到「下載 PNG」`);
    }
    void touch;
    await ctx.close();
  }
  // ---- 13. 打字時預覽用 toBlob＋object URL（舊的會 revoke）；PNG 整數倍模組 ----
  {
    const { ctx, p } = await open();
    await p.click('#type-text'); await p.fill('#f-text-text', 'first'); await p.waitForFunction(() => document.getElementById('preview').src.startsWith('blob:'));
    const u1 = await p.evaluate(() => { window.__rv = []; const r = URL.revokeObjectURL; URL.revokeObjectURL = u => { window.__rv.push(u); r.call(URL, u); }; return document.getElementById('preview').src; });
    await p.fill('#f-text-text', 'second'); await p.waitForFunction(u1 => document.getElementById('preview').src !== u1, u1);
    const gone = await p.evaluate(u1 => window.__rv.includes(u1), u1);
    assert(gone, '預覽改用 blob URL，換新圖後舊的 URL 已 revoke');
    const px = await p.evaluate(() => {
      document.getElementById('f-text-text').value = 'a'.repeat(2300); document.getElementById('f-text-text').dispatchEvent(new Event('input', { bubbles: true })); generate();
      const c = exportCanvas(256), d = c.getContext('2d').getImageData(0, 0, c.width, 1).data;
      // module widths along row through the top-left finder's top edge
      const st = effStyle(), ppm = Math.floor(256 / (state.qr.size + 2 * st.margin));
      const row = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, runs = []; let y = 0;
      for (y = 0; y < c.height; y++) { const i = (y * c.width + Math.floor(c.width / 2)) * 4; if (row[i] < 128) break; }
      let run = 0, prev = null; for (let x = 0; x < c.width; x++) { const v = row[(y * c.width + x) * 4] < 128; if (v === prev) run++; else { if (prev !== null) runs.push(run); run = 1; prev = v; } }
      return { w: c.width, ppm, bad: runs.slice(1, -1).filter(r => r % ppm).length, v: state.qr.version, d: d.length };
    });
    assert(px.w === 256 && px.bad === 0, `版本 ${px.v} 選 256 px：寬 256，每個模組都是 ${px.ppm} px 的整數倍`);
    await ctx.close();
  }

  assert(errors.length === 0, '沒有 page error / console error' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
