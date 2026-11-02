// GIF 製作器：上架評分 toFix 的回歸測試（node tests.js，約 30–60 秒，不需要 ffmpeg / PIL）
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-maker-'));
const WRAP = path.join(DIR, 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const T = 30000;

(async () => {
  const browser = await chromium.launch();
  const ctxs = [];
  async function open(w = 390, h = 844) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); ctxs.push(ctx);
    const p = await ctx.newPage(); watch(p);
    await p.goto(URL); await p.waitForFunction(() => window.__gm, null, { timeout: T });
    return { ctx, p };
  }
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message)); };
  const cdp = new Map();
  async function tap(p, sel) {
    const loc = p.locator(sel); await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox();
    if (!cdp.has(p)) cdp.set(p, await p.context().newCDPSession(p)); const s = cdp.get(p);
    const pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const toastText = p => p.evaluate(() => document.querySelector('#toast').hidden ? '' : document.querySelector('#toastT').textContent);
  const waitToast = (p, re) => p.waitForFunction(re => !document.querySelector('#toast').hidden && new RegExp(re).test(document.querySelector('#toastT').textContent), re, { timeout: T }).then(() => true, () => false);
  // PNGs drawn in the page: [w, h, fill or null(transparent), inner square colour]
  const png = (p, w, h, col, inner) => p.evaluate(async ([w, h, col, inner]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    if (col) { x.fillStyle = col; x.fillRect(0, 0, w, h); } if (inner) { x.fillStyle = inner; x.fillRect(w / 4, h / 4, w / 2, h / 2); }
    const b = await new Promise(r => c.toBlob(r, 'image/png')); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }, [w, h, col, inner]).then(b => Buffer.from(b, 'base64'));
  const file = (name, buffer, mimeType = 'image/png') => ({ name, mimeType, buffer });
  const gen = async p => { await p.click('#genBtn'); await p.waitForSelector('#barDone:not([hidden])', { timeout: 90000 }); };
  // parse the GIF the app produced: size, per-frame delays (ms), NETSCAPE loop count
  const gifInfo = p => p.evaluate(async () => { const u = new Uint8Array(await window.__lastGif.blob.arrayBuffer()); const w = u[6] | u[7] << 8, h = u[8] | u[9] << 8; let i = 13; if (u[10] & 0x80) i += 3 * (1 << ((u[10] & 7) + 1));
    const d = []; let loop = null;
    while (i < u.length) { const b = u[i]; if (b === 0x3B) break;
      if (b === 0x21) { const l = u[i + 1]; i += 2; if (l === 0xF9) d.push((u[i + 2] | u[i + 3] << 8) * 10); if (l === 0xFF && String.fromCharCode(...u.slice(i + 1, i + 12)) === 'NETSCAPE2.0') loop = u[i + 14] | u[i + 15] << 8; while (u[i]) i += u[i] + 1; i++; }
      else if (b === 0x2C) { const f = u[i + 9]; i += 10; if (f & 0x80) i += 3 * (1 << ((f & 7) + 1)); i++; while (u[i]) i += u[i] + 1; i++; } else break; }
    return { w, h, d, loop, n: d.length }; });
  const gifPx = (p, x, y) => p.evaluate(async ([x, y]) => { const im = new Image(); im.src = URL.createObjectURL(window.__lastGif.blob); await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return [...g.getImageData(x, y, 1, 1).data]; }, [x, y]);
  const settled = p => p.waitForFunction(() => __gm.pending.size === 0, null, { timeout: T });
  // a short WebM made in the page (MediaRecorder), colour changes every 0.5 s
  const makeVideo = p => p.evaluate(async () => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const x = c.getContext('2d'); const st = c.captureStream(15);
    const rec = new MediaRecorder(st, { mimeType: 'video/webm' }); const parts = []; rec.ondataavailable = e => parts.push(e.data);
    const cols = ['#e00', '#0b0', '#00e', '#ee0']; let k = 0; const draw = () => { x.fillStyle = cols[k++ % 4]; x.fillRect(0, 0, 160, 120); };
    draw(); rec.start(); const iv = setInterval(draw, 500); await new Promise(r => setTimeout(r, 2100)); clearInterval(iv); const done = new Promise(r => rec.onstop = r); rec.stop(); await done;
    const b = new Blob(parts, { type: 'video/webm' }); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }).then(b => Buffer.from(b, 'base64'));

  // ---- 1. visible 選擇圖片 button; add tile first ----
  {
    const { p } = await open(360, 640);
    const r = await p.evaluate(() => { const b = document.getElementById('pickImg').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, w: b.width, h: b.height, vh: innerHeight, first: document.getElementById('strip').firstElementChild.id, txt: document.getElementById('pickImg').textContent }; });
    assert(r.bottom <= r.vh - 70 && r.h >= 44 && r.w >= 200, `360×640：「選擇圖片」一打開就看得到 (${Math.round(r.top)}–${Math.round(r.bottom)} / ${r.vh})`);
    assert(r.first === 'addImg' && r.txt.includes('選擇圖片'), '影格條的「＋ 加入」在最前面');
    assert(await p.isVisible('#sampleNote'), '範例狀態有說明「選擇圖片後會取代範例」');
    assert(await p.getAttribute('#frDelay', 'inputmode') === 'numeric' && await p.getAttribute('#loopN', 'inputmode') === 'numeric', 'frDelay / loopN inputmode=numeric');
  }

  // ---- 2. typed delay then tap next frame (CDP touch): tap not swallowed, delay lands on right frame ----
  {
    const { p } = await open();
    await tap(p, '#fr-0'); await p.waitForFunction(() => __gm.S.sel === 0);
    await tap(p, '#frDelay'); await p.keyboard.type('500');
    await tap(p, '#fr-1');
    await p.waitForFunction(() => __gm.S.sel === 1, null, { timeout: 3000 }).catch(() => {});
    let st = await p.evaluate(() => ({ sel: __gm.S.sel, d: __gm.S.frames.map(f => f.delay) }));
    assert(st.sel === 1 && st.d[0] === 500 && st.d[1] === null, `輸入 500 後直接點第 2 格：選到第 2 格、第 1 格為 500 (sel ${st.sel}, ${st.d.slice(0, 2)})`);
    assert((await p.textContent('#fr-0 .d')) === '500ms', '影格條第 1 格顯示 500ms');
    await tap(p, '#frDelay'); await p.keyboard.type('900'); await tap(p, '#fr-2');
    await p.waitForFunction(() => __gm.S.sel === 2, null, { timeout: 3000 }).catch(() => {});
    st = await p.evaluate(() => ({ sel: __gm.S.sel, d: __gm.S.frames.map(f => f.delay) }));
    assert(st.sel === 2 && st.d[1] === 900 && st.d[0] === 500, `再輸入 900 點第 3 格：900 套到第 2 格 (${st.d.slice(0, 3)})`);
    // <20 ms: clamped with a message
    await tap(p, '#frDelay'); await p.keyboard.type('15'); await tap(p, '#fr-3');
    assert(await waitToast(p, '最少 20 ms'), '每格延遲輸入 15：提示最少 20 ms');
    assert(await p.evaluate(() => __gm.S.frames[2].delay) === 20, '15 改為 20');
    // strip ms follow speed
    await p.selectOption('#speed', '2');
    assert((await p.textContent('#fr-4 .d')) === '75ms' && (await p.textContent('#fr-0 .d')) === '250ms', '2× 時影格條顯示 75ms / 250ms');
    await p.selectOption('#speed', '1');
  }

  // ---- 3. persistence: images, delays, order, mode survive reload ----
  {
    const { p } = await open();
    await p.setInputFiles('#fileImg', [file('紅🎈.png', await png(p, 400, 300, '#ff0000')), file('b.png', await png(p, 400, 300, '#0000ff')), file('c.png', await png(p, 400, 300, '#00ff00'))]);
    await p.waitForFunction(() => __gm.S.frames.length === 3 && !__gm.S.sample, null, { timeout: T });
    assert((await p.textContent('#pickImg')).includes('加入圖片') && await p.isVisible('#clearAll'), '加入後按鈕變「加入圖片」並出現「清除全部」');
    await p.click('#fr-0'); await p.fill('#frDelay', '700'); await p.dispatchEvent('#frDelay', 'change');
    await p.click('#frRight'); // red moves to slot 2
    await settled(p);
    await p.reload(); await p.waitForFunction(() => window.__gm && !__gm.S.restoring && __gm.S.frames.length === 3, null, { timeout: T }).catch(() => {});
    await p.evaluate(() => __gm.restored);
    const st = await p.evaluate(() => __gm.S.frames.map(f => { const d = f.src.getContext('2d').getImageData(5, 5, 1, 1).data; return { d: f.delay, c: d[0] > 200 ? 'R' : d[2] > 200 ? 'B' : 'G', name: f.name }; }));
    assert(st.length === 3 && st.map(x => x.c).join('') === 'BRG', '重新整理後 3 格、順序 BRG 都還在 ' + JSON.stringify(st.map(x => x.c)));
    assert(st[1].d === 700 && st[1].name === '紅🎈.png' && st[0].d === null, '每格延遲 700 與檔名還在');
    assert(!(await p.isVisible('#sampleTag')), '還原後不是範例');
    await gen(p); const g = await gifInfo(p);
    assert(g.n === 3 && g.d[1] === 700, '還原的影格可以直接產生 GIF');
    await p.click('#againBtn');
    // delete with undo
    await p.click('#fr-0'); await p.click('#frDel');
    assert(await p.evaluate(() => __gm.S.frames.length) === 2 && await p.isVisible('#toastBtn'), '刪除後 toast 有「復原」');
    await tap(p, '#toastBtn');
    assert(await p.evaluate(() => __gm.S.frames.map(f => f.name).join()) === 'b.png,紅🎈.png,c.png', '按復原後回到原位置');
    await p.click('#clearAll'); assert(await p.evaluate(() => __gm.S.frames.length) === 0, '清除全部');
    await p.click('#toastBtn'); assert(await p.evaluate(() => __gm.S.frames.length) === 3, '清除全部可復原');
    // mode persists
    await p.click('#mode-vid'); await p.reload(); await p.waitForFunction(() => window.__gm && !__gm.S.restoring, null, { timeout: T });
    assert(await p.evaluate(() => __gm.S.mode) === 'vid', '影片模式重新整理後還在');
  }

  // ---- 4. sample edits persist too (old settings key still loads) ----
  {
    const { p } = await open();
    await p.evaluate(() => localStorage.setItem('gif-maker:v1:settings', JSON.stringify({ width: 240, delay: 300 })));
    await p.click('#fr-7'); await p.click('#frDel'); await p.reload(); await p.waitForFunction(() => window.__gm);
    assert(await p.evaluate(() => __gm.S.frames.length === 7 && __gm.S.sample && __gm.set.width === 240) && await p.inputValue('#width') === '240', '範例刪一格與舊設定鍵重新整理後還在');
  }

  // ---- 5. busy lock + stale job never shown ----
  {
    const { p } = await open();
    const r = await p.evaluate(() => { document.getElementById('genBtn').click(); const q = s => document.querySelector(s).inert; const out = { set: q('#setBox'), mode: q('#modeSeg'), src: q('#srcImg') };
      const w = document.getElementById('width'); w.value = '240'; w.dispatchEvent(new Event('change')); out.idle = !document.getElementById('barIdle').hidden; return out; });
    assert(r.set && r.mode && r.src, '產生中：設定、模式、影格都鎖住 (inert)');
    assert(r.idle, '產生中改設定：舊工作取消、回到「產生 GIF」');
    await gen(p); const g = await gifInfo(p);
    assert(g.w === 240 && await p.evaluate(() => __lastGif.w) === 240, '重新產生的成品是新設定 240 寬');
    assert(await p.isDisabled('#playBtn') && !(await p.isVisible('#sampleTag')) && await p.isVisible('#gifTag'), 'GIF 成品：播放鈕停用、不貼「範例影格」標籤');
    const inPv = await p.evaluate(() => document.getElementById('pv').contains(document.getElementById('gifTag')));
    assert(!inPv, '「GIF 成品」標籤不蓋在畫面上');
    // mode switch while busy (programmatic): result of old job must not appear in video mode
    await p.click('#againBtn');
    await p.evaluate(() => { document.getElementById('genBtn').click(); __gm.setMode('vid'); });
    await p.waitForTimeout(50);
    assert(await p.evaluate(() => document.getElementById('gifImg').hidden && !document.getElementById('barIdle').hidden), '產生中切模式：不顯示舊的 GIF');
  }

  // ---- 6. correctness fixes: transparency, loop count, extreme ratio, 150 limit, non-image, memory ----
  {
    const { p } = await open();
    await p.setInputFiles('#fileImg', [file('t.png', await png(p, 400, 300, null, '#ff0000')), file('t2.png', await png(p, 400, 300, null, '#0000ff'))]);
    await p.waitForFunction(() => __gm.S.frames.length === 2);
    await gen(p); let px = await gifPx(p, 5, 5);
    assert(px[0] > 240 && px[1] > 240 && px[2] > 240, '透明 PNG＋裁切填滿：透明處用底色（白）不是黑 ' + px);
    await p.click('#againBtn'); await p.fill('#bgc', '#00ff00').catch(async () => { await p.evaluate(() => { const e = document.getElementById('bgc'); e.value = '#00ff00'; e.dispatchEvent(new Event('change')); }); });
    await gen(p); px = await gifPx(p, 5, 5);
    assert(px[1] > 200 && px[0] < 60, '底色在裁切模式也有作用 ' + px);
    await p.click('#againBtn');
    await p.selectOption('#loop', 'n');
    await p.fill('#loopN', '1'); await p.dispatchEvent('#loopN', 'change');
    assert(await p.inputValue('#loop') === '1', '播放次數填 1 → 改選「播放 1 次」');
    await gen(p); assert((await gifInfo(p)).loop === null, '播放 1 次：沒有 NETSCAPE 循環');
    await p.click('#againBtn'); await p.selectOption('#loop', 'n');
    await p.fill('#loopN', '250'); await p.dispatchEvent('#loopN', 'change');
    assert(await p.inputValue('#loopN') === '100' && await waitToast(p, '最多 100'), '填 250 → 欄位改 100 並提示');
    await p.fill('#loopN', '0'); await p.dispatchEvent('#loopN', 'change');
    assert(await p.inputValue('#loopN') === '2', '填 0 → 欄位改 2');
    await p.fill('#loopN', '5'); await p.dispatchEvent('#loopN', 'change');
    await gen(p); assert((await gifInfo(p)).loop === 4, '填 5 → 循環欄位 4（共播 5 次）');
    await p.click('#againBtn'); await p.selectOption('#loop', '0');
    // non-image / video in image mode
    await p.setInputFiles('#fileImg', [file('a.txt', Buffer.from('hello'), 'text/plain')]);
    assert(await waitToast(p, '只支援圖片'), '選到文字檔：提示只支援圖片');
    await p.setInputFiles('#fileImg', [file('v.webm', Buffer.from('xx'), 'video/webm')]);
    assert(await waitToast(p, '切到.*影片」模式'), '圖片模式選影片：提示切到影片模式');
    // extreme ratio
    await p.click('#clearAll');
    await p.setInputFiles('#fileImg', [file('tall1.png', await png(p, 5, 2000, '#ff0000')), file('tall2.png', await png(p, 5, 2000, '#0000ff'))]);
    await p.waitForFunction(() => __gm.S.frames.length === 2);
    await gen(p); const g = await gifInfo(p);
    assert(g.h <= 4096 && g.h >= 2 && g.w >= 2 && g.n === 2, `5×2000：輸出 ${g.w}×${g.h}，高度不超過 4096`);
    assert(await waitToast(p, '高度上限'), '極端比例有提示');
    await p.click('#againBtn'); await p.click('#clearAll');
    // big image stored at ≤800 px
    await p.setInputFiles('#fileImg', [file('big.png', await png(p, 3000, 2000, '#336699'))]);
    await p.waitForFunction(() => __gm.S.frames.length === 1);
    assert(await p.evaluate(() => Math.max(__gm.S.frames[0].w, __gm.S.frames[0].h)) === 800, '大圖存成最長邊 800');
    // 151 images → 150 added, toast says so
    await p.click('#clearAll'); const one = await png(p, 8, 8, '#888888');
    await p.setInputFiles('#fileImg', Array.from({ length: 151 }, (_, i) => file(`p${i}.png`, one)));
    assert(await waitToast(p, '已加入 150 張.*其餘 1 張未加入'), '選 151 張：「已加入 150 張；最多 150 格，其餘 1 張未加入」 ' + await toastText(p));
    assert(await p.evaluate(() => __gm.S.frames.length) === 150, '實際 150 格');
  }

  // ---- 7. video: single preview, first frame shown at once, fps note, delay rounding, persistence ----
  {
    const { p } = await open();
    const webm = await makeVideo(p);
    await p.click('#mode-vid');
    await p.setInputFiles('#fileVid', file('clip.webm', webm, 'video/webm'));
    await p.waitForSelector('#vBox:not([hidden])', { timeout: T });
    const drawn = await p.waitForFunction(() => { const c = document.getElementById('pvc'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3] > 0 && d[0] + d[1] + d[2] > 100; }, null, { timeout: 8000 }).then(() => true, () => false);
    assert(drawn, '影片載入後上方預覽立刻有畫面（不必拖動起點）');
    const vb = await p.evaluate(() => document.getElementById('vid').getBoundingClientRect());
    assert(vb.width <= 2 && vb.height <= 2, '影片模式只有一個預覽（原始影片不另外佔版面）');
    assert(await p.isVisible('#bgc'), '底色欄兩種模式都可用（透明處底色）');
    // fps downgrade shown when choosing (simulate a 12 s clip on the range)
    await p.evaluate(() => { __gm.S.vDur = 20; for (const id of ['vStart', 'vEnd']) document.getElementById(id).max = 20; const e = document.getElementById('vEnd'); e.value = 12; document.getElementById('vStart').value = 0; e.dispatchEvent(new Event('input')); });
    await p.selectOption('#fps', '15');
    assert(/144 格.*降為 12 fps/.test(await p.textContent('#vLen')), '15 fps 12 秒：選的時候就顯示降為 12 fps ' + await p.textContent('#vLen'));
    await p.evaluate(() => { __gm.S.vDur = __gm.S.video.duration; const e = document.getElementById('vEnd'); document.getElementById('vStart').value = 0; e.value = 1; e.dispatchEvent(new Event('input')); });
    await gen(p); const g = await gifInfo(p);
    const sum = g.d.reduce((a, b) => a + b, 0);
    assert(g.n === 15 && sum === 1000 && g.d.includes(60) && g.d.includes(70), `15 fps 1 秒：每格 60/70 交替、總長 1000 ms (${g.d.join(',')})`);
    await p.click('#againBtn');
    await p.evaluate(() => { const e = document.getElementById('vStart'); e.value = 0.5; e.dispatchEvent(new Event('input')); });
    await settled(p);
    await p.reload(); await p.waitForFunction(() => window.__gm, null, { timeout: T }); await p.evaluate(() => __gm.restored);
    const r = await p.evaluate(() => ({ mode: __gm.S.mode, v: !!__gm.S.video, a: +document.getElementById('vStart').value, b: +document.getElementById('vEnd').value, box: !document.getElementById('vBox').hidden }));
    assert(r.mode === 'vid' && r.v && r.box && r.a === 0.5 && r.b === 1, '影片與起訖點重新整理後還在 ' + JSON.stringify(r));
    const ok = await p.waitForFunction(() => { const c = document.getElementById('pvc'); const d = c.getContext('2d').getImageData(c.width / 2, c.height / 2, 1, 1).data; return d[3] > 0 && d[0] + d[1] + d[2] > 100; }, null, { timeout: 8000 }).then(() => true, () => false);
    assert(ok, '還原的影片預覽有畫面');
  }

  // ---- 8. no horizontal scroll at 360 with a toast + undo showing ----
  {
    const { p } = await open(360, 640);
    await p.click('#fr-0'); await p.click('#frDel');
    const r = await p.evaluate(() => { const b = document.getElementById('toastBtn').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, w: innerWidth, bh: b.height, bw: b.width, right: b.right }; });
    assert(r.sw <= r.w && r.right <= r.w && r.bh >= 44 && r.bw >= 44, `360 寬：toast 的「復原」≥44 且不溢出 (${r.bw}×${r.bh})`);
  }

  assert(errors.length === 0, '沒有 console / page error ' + JSON.stringify(errors.slice(0, 3)));
  for (const c of ctxs) await c.close().catch(() => {});
  await browser.close(); fs.rmSync(DIR, { recursive: true, force: true });
  console.log(fails ? `FAIL ${fails} 項` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
