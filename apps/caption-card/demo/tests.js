// 字卡產生器：上架評分 9.5 重審的回歸測試（node tests.js，約 20 秒）。觸控用真實 CDP Input.dispatchTouchEvent。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'caption-card-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];

(async () => {
  const browser = await chromium.launch();
  async function open(w = 390, h = 844, opt = {}, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true, ...opt });
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__photoReady);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i + 1 })) });
    const frames = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    const tap = async (q, wob = 0) => { await touch('touchStart', [q]); if (wob) await touch('touchMove', [[q[0] + wob, q[1] + wob]]); await touch('touchEnd', []); await frames(); };
    // canvas point (in output pixels) -> viewport point
    const at = async (x, y) => { const b = await p.locator('#cv').boundingBox(); const [W, H] = await p.evaluate(() => { const s = __cc.st(); return s.size === '4:5' ? [1080, 1350] : [1080, 1080]; }); return [b.x + x / W * b.width, b.y + y / H * b.height]; };
    const L = () => p.evaluate(() => __cc.layoutCard(1080, 1350));
    return { ctx, p, touch, tap, frames, at, L };
  }

  // 1. 壞掉的草稿／自存範本不會讓 app 開不起來；每個欄位個別驗證
  {
    const t = await open(390, 844, {}, () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('caption-card:v1:draft', JSON.stringify({ title: 42, sub: '好副標', author: null, size: 'huge', cw: 'x', fmt: 'exe', fontSize: 'abc', color: 'red', bg: '#123456', bgType: 'video', weight: 500, lh: 9, vy: -3, autoSize: 'yes', deco: 'bar' }));
      localStorage.setItem('caption-card:v1:presets', JSON.stringify([null, 5, { name: 7, style: { bg: '#00ff00', weight: 'bold' } }, { name: '好的', style: 'nope' }, { name: '可用', style: { color: '#ABCDEF' } }]));
    });
    const s = await t.p.evaluate(() => { const s = __cc.st(); return { title: s.title, sub: s.sub, author: s.author, size: s.size, fmt: s.fmt, fontSize: s.fontSize, color: s.color, bg: s.bg, bgType: s.bgType, weight: s.weight, lh: s.lh, vy: s.vy, autoSize: s.autoSize, deco: s.deco }; });
    eq([s.sub, s.bg, s.deco], ['好副標', '#123456', 'bar'], '有效欄位照常還原');
    assert(typeof s.title === 'string' && typeof s.author === 'string' && s.size === '4:5' && s.fmt === 'png' && s.fontSize === 96 && /^#[0-9a-f]{6}$/.test(s.color) && ['solid', 'grad', 'photo'].includes(s.bgType) && [400, 700, 900].includes(s.weight) && s.lh === 2 && s.vy === 0 && typeof s.autoSize === 'boolean',
      '壞欄位退回預設或夾到範圍內：' + JSON.stringify(s));
    await t.p.click('#tplBtn');
    eq(await t.p.$$eval('#presetGrid .tpl span', a => a.map(e => e.textContent)), ['我的範本 1', '可用'], '壞的自存範本被略過，沒名字的給預設名');
    await t.p.click('#preset-0'); eq(await t.p.evaluate(() => [__cc.st().bg, __cc.st().weight]), ['#00ff00', 900], '自存範本的壞欄位用預設值');
    await t.ctx.close();
  }

  // 2. 草稿在 pagehide 時立刻寫入（不用等 0.5 秒的延遲儲存）
  {
    const t = await open();
    await t.p.fill('#title', '馬上離開也不會掉');
    await t.p.evaluate(() => dispatchEvent(new Event('pagehide')));
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('caption-card:v1:draft')).title), '馬上離開也不會掉', 'pagehide 立刻寫入草稿');
    await t.p.click('#weightRow-400');
    await t.p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    eq(await t.p.evaluate(() => JSON.parse(localStorage.getItem('caption-card:v1:draft')).weight), 400, '切到背景（visibilitychange）也立刻寫入');
    await t.p.reload(); await t.p.waitForFunction(() => window.__photoReady);
    eq(await t.p.inputValue('#title'), '馬上離開也不會掉', '重新整理後文字還在');
    await t.ctx.close();
  }

  // 3. 預覽與輸出一致：照片模糊與文字陰影要依縮放換算（以前預覽的模糊約是輸出的 1.8 倍）
  {
    const t = await open();
    const diff = async () => t.p.evaluate(async () => {
      await new Promise(r => setTimeout(r, 200));
      const cv = document.getElementById('cv'); const bm = await createImageBitmap(await __cc.renderBlob());
      const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
      const a = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, e = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - e[i]) + Math.abs(a[i + 1] - e[i + 1]) + Math.abs(a[i + 2] - e[i + 2]); return d / (a.length / 4) / 3;
    });
    await t.p.click('#tab-bg'); await t.p.click('#bgTypeRow-photo');
    await t.p.fill('#title', ''); await t.p.fill('#sub', ''); await t.p.fill('#author', '');
    await t.p.fill('#dim', '0'); await t.p.dispatchEvent('#dim', 'input');
    await t.p.fill('#blur', '20'); await t.p.dispatchEvent('#blur', 'input');
    const db = await diff(); assert(db < 2, `模糊 20：預覽與輸出平均差 ${db.toFixed(2)} < 2`);
    await t.p.fill('#blur', '0'); await t.p.dispatchEvent('#blur', 'input');
    await t.p.click('#bgTypeRow-solid'); await t.p.fill('#bgColor', '#ffffff'); await t.p.dispatchEvent('#bgColor', 'input');
    await t.p.click('#tab-text'); await t.p.fill('#title', '陰影陰影'); await t.p.check('#shadow');
    const ds = await diff(); assert(ds < 4, `文字陰影：預覽與輸出平均差 ${ds.toFixed(2)} < 4`);
    await t.ctx.close();
  }

  // 4. 觸控：輕點文字（手指晃 3px）不會挪動位置；拖曳會移動並在中間吸附；雙指縮放不受第一指位移影響；雙擊跳到對應欄位
  {
    const t = await open();
    await t.p.fill('#title', '輕點不該移動'); await t.p.fill('#sub', '副標'); await t.p.locator('#sub').blur();
    await t.p.fill('#fsize', '80'); await t.p.dispatchEvent('#fsize', 'input'); // manual size leaves room to move the block
    await t.p.evaluate(() => scrollTo(0, 0)); await t.p.waitForTimeout(250);
    let L = await t.L();
    const mid = await t.at(540, L.top + L.titleH / 2);
    await t.tap(mid, 3); await t.p.waitForTimeout(450);
    eq(await t.p.evaluate(() => __cc.st().vy), 0.5, '輕點文字（晃 3px）vy 仍是 0.5，「中」仍被選取');
    eq(await t.p.getAttribute('#vposRow-0x5', 'aria-checked'), 'true', '垂直位置「中」保持選取');
    // drag down
    await t.touch('touchStart', [mid]); for (let k = 1; k <= 8; k++) await t.touch('touchMove', [[mid[0], mid[1] + k * 10]]); await t.touch('touchEnd', []); await t.frames();
    const vy1 = await t.p.evaluate(() => __cc.st().vy); assert(vy1 > 0.6, `往下拖 80px：vy ${vy1.toFixed(2)}`);
    // drag back to just off the middle (vy 0.515): snaps to exactly 0.5 so 「中」 lights up again
    L = await t.L(); const m2 = await t.at(540, L.top + L.blockH / 2);
    const bh = (await t.p.locator('#cv').boundingBox()).height, dy = (vy1 - 0.515) * (L.availH - L.blockH) * bh / 1350;
    await t.touch('touchStart', [m2]); for (let k = 1; k <= 8; k++) await t.touch('touchMove', [[m2[0], m2[1] - dy * k / 8]]); await t.touch('touchEnd', []); await t.frames();
    eq(await t.p.evaluate(() => __cc.st().vy), 0.5, '拖到中間附近吸附到正中間');
    eq(await t.p.getAttribute('#vposRow-0x5', 'aria-checked'), 'true', '吸附後「中」重新被選取');
    // double tap on the subtitle line focuses #sub
    L = await t.L(); const sp = await t.at(540, L.top + L.qH + L.titleH + L.g1 + L.subH / 2);
    await t.tap(sp); await t.tap(sp);
    eq(await t.p.evaluate(() => document.activeElement.id), 'sub', '觸控雙擊副標位置 → 副標欄位取得焦點');
    // pinch: first finger drifts, second finger arrives -> drift undone, size changes
    await t.p.locator('#sub').blur(); await t.p.waitForTimeout(350); await t.p.evaluate(() => scrollTo(0, 0)); await t.p.waitForTimeout(100);
    L = await t.L(); const c = await t.at(540, L.top + L.blockH / 2);
    const f0 = await t.p.evaluate(() => __cc.st().fontSize);
    await t.touch('touchStart', [c]); await t.touch('touchMove', [[c[0], c[1] + 30]]);
    await t.touch('touchStart', [[c[0], c[1] + 30], [c[0] + 40, c[1] + 30]]);
    for (let k = 1; k <= 6; k++) await t.touch('touchMove', [[c[0] - k * 8, c[1] + 30], [c[0] + 40 + k * 8, c[1] + 30]]);
    await t.touch('touchEnd', []); await t.frames();
    const pz = await t.p.evaluate(() => ({ vy: __cc.st().vy, fs: __cc.st().fontSize }));
    assert(pz.vy === 0.5 && pz.fs > f0, `雙指張開：字級 ${f0}→${pz.fs}、vy 不受第一指位移影響（${pz.vy}）`);
    await t.ctx.close();
  }

  // 5. 套用範本／自存範本可以從提示「復原」；刪除自存範本也可復原；新範本名稱不重複；提示不蓋住任何控制項
  {
    const t = await open();
    await t.p.fill('#title', '範本復原'); await t.p.click('#weightRow-400'); await t.p.click('#alignRow-left');
    const before = await t.p.evaluate(() => JSON.stringify(__cc.st()));
    await t.p.click('#tplBtn'); await t.p.click('#tpl-5');
    assert(await t.p.evaluate(() => __cc.st().deco === 'quote'), '套用「引言」');
    const tr = await t.p.$eval('.toast', e => e.getBoundingClientRect().toJSON()), sr = await t.p.$eval('#stage', e => e.getBoundingClientRect().toJSON());
    assert(tr.top >= sr.top && tr.bottom <= sr.bottom, '提示放在預覽區內，不蓋住按鈕或輸入欄');
    const covered = await t.p.evaluate(() => { const r = document.querySelector('.toast').getBoundingClientRect(); return [...document.querySelectorAll('button,input,select,textarea')].filter(e => !e.closest('.toast') && e.offsetParent && (b => b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom)(e.getBoundingClientRect())).map(e => e.id); });
    eq(covered, [], '提示底下沒有任何控制項');
    await t.p.click('#toastUndo');
    eq(await t.p.evaluate(() => JSON.stringify(__cc.st())), before, '「復原」還原套用前的全部樣式');
    await t.p.click('#tplBtn'); await t.p.click('#savePreset'); await t.p.click('#savePreset'); await t.p.click('#savePreset');
    eq(await t.p.$$eval('#presetGrid .tpl span', a => a.map(e => e.textContent)), ['我的範本 1', '我的範本 2', '我的範本 3'], '存三組');
    await t.p.click('#preset-1 .del');
    eq(await t.p.$$eval('#presetGrid .tpl span', a => a.map(e => e.textContent)), ['我的範本 1', '我的範本 3'], '刪除第 2 組');
    await t.p.click('#toastUndo');
    eq(await t.p.$$eval('#presetGrid .tpl span', a => a.map(e => e.textContent)), ['我的範本 1', '我的範本 2', '我的範本 3'], '「復原」把刪掉的範本放回原位');
    await t.p.click('#preset-0 .del'); await t.p.click('#savePreset');
    eq(await t.p.$$eval('#presetGrid .tpl span', a => a.map(e => e.textContent)), ['我的範本 2', '我的範本 3', '我的範本 4'], '刪除後新存的名稱不重複');
    const del = await t.p.$eval('#preset-0 .del', e => e.getBoundingClientRect().toJSON());
    assert(del.width >= 44 && del.height >= 44, `刪除鈕 ${del.width}×${del.height} ≥ 44`);
    await t.p.click('#tplClose');
    await t.p.click('#tab-bg'); await t.p.click('#bgTypeRow-photo');
    const small = await t.p.$eval('#pickBg', e => e.getBoundingClientRect().height); await t.p.click('#tab-text'); const color = await t.p.$eval('#color', e => e.getBoundingClientRect().height);
    assert(small >= 44 && color >= 44, `「選擇背景照片」${small}px、色塊 ${color}px 高 ≥ 44`);
    await t.ctx.close();
  }

  // 6. 輸出：沒有 downloads 能力時一按就直接下載（PNG / JPG），並顯示圖片可長按；返回鍵與 Esc 關閉面板；面板開著時背景不可操作
  {
    const t = await open();
    await t.p.fill('#title', '直接下載');
    await t.p.click('#dlBtn');
    assert(await t.p.evaluate(() => document.querySelector('.app').inert), '面板開著時背景 inert');
    const [d1] = await Promise.all([t.p.waitForEvent('download'), t.p.click('#dlGo')]);
    assert(/^caption-\d{8}-\d{4}\.png$/.test(d1.suggestedFilename()), '按「下載」直接下載 ' + d1.suggestedFilename());
    const buf = fs.readFileSync(await d1.path()); assert(buf.slice(1, 4).toString() === 'PNG', '檔案是 PNG');
    assert(await t.p.isVisible('#outImg') && await t.p.isVisible('#outHint'), '同時顯示圖片與長按提示');
    await t.p.click('#fmtRow-jpg'); assert(await t.p.isHidden('#outImg'), '換格式後舊圖收起');
    const [d2] = await Promise.all([t.p.waitForEvent('download'), t.p.click('#dlGo')]);
    const jb = fs.readFileSync(await d2.path());
    assert(/\.jpg$/.test(d2.suggestedFilename()) && jb[0] === 0xff && jb[1] === 0xd8, 'JPG 92% 下載為 JPEG ' + d2.suggestedFilename());
    await t.p.goBack(); await t.p.waitForTimeout(150);
    assert(await t.p.isHidden('#dlOv') && !(await t.p.evaluate(() => document.querySelector('.app').inert)), 'Android 返回鍵（history.back）關閉面板，背景恢復可操作');
    eq(await t.p.evaluate(() => location.protocol), 'file:', '返回鍵沒有離開頁面');
    await t.p.click('#tplBtn'); await t.p.keyboard.press('Escape');
    assert(await t.p.isHidden('#tplOv'), 'Esc 關閉範本面板');
    await t.p.waitForTimeout(150); eq(await t.p.evaluate(() => history.state && history.state.ccSheet || null), null, '用按鈕／Esc 關閉時同時退回歷史紀錄');
    await t.ctx.close();
  }
  {
    // with the downloads capability: saved through it, no anchor download
    const t = await open(390, 844, {}, () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, type: data.type }); } } : null }; });
    await t.p.click('#dlBtn'); await t.p.click('#dlGo'); await t.p.waitForFunction(() => window.__saved.length === 1);
    assert(await t.p.evaluate(() => /^caption-.*\.png$/.test(__saved[0].filename) && __saved[0].type === 'image/png' && !window.__downloaded), '有 downloads 能力時走它儲存');
    await t.ctx.close();
  }

  // 7. 長文字保持順暢；斷行規則不變
  {
    const t = await open();
    const ms = await t.p.evaluate(() => { const s = __cc.st(); const out = {}; for (const n of [1000, 3000, 5000]) { s.title = '測試長文字，abc '.repeat(n / 10); const t0 = performance.now(); __cc.layoutCard(1080, 1350); out[n] = performance.now() - t0; } return out; });
    assert(Object.values(ms).every(v => v < 120), '自動字級排版 1000/3000/5000 字：' + Object.entries(ms).map(([k, v]) => k + '字 ' + v.toFixed(0) + 'ms').join('、'));
    const big = '休息，是為了走更長遠的路；堅持，才能看見風景。'.repeat(120);
    const t0 = Date.now(); await t.p.fill('#title', big); await t.frames(); const dt = Date.now() - t0;
    assert(dt < 1500 && await t.p.isVisible('#overflow'), `貼上 ${big.length} 字：${dt}ms 內畫完並提示超出版面`);
    const NS = '，。、！？；：」』）】》〉〕…‥・·,.!?;:)]}％%';
    const bad = await t.p.evaluate(NS => { const S = ['今天天氣很好，我們一起去公園散步吧。', 'Hello 世界，this is a mixed sentence，中英混排測試。', '他問：「真的嗎？」我說：「真的。」', '……沉默了很久，他終於開口。', '週末市集時間：10:00–17:00，地點：中山公園。'];
      const bad = []; for (const s of S) for (let w = 160; w <= 900; w += 23) { const L = __cc.breakLines(s, w, 64);
        L.forEach((l, i) => { if (i > 0 && NS.includes([...l.text][0])) bad.push(s + '@' + w + ':' + l.text); });
        if (L.map(l => l.text).join('').replace(/\s/g, '') !== s.replace(/\s/g, '')) bad.push('LOST ' + s + '@' + w); } return bad; }, NS);
    eq(bad, [], '避頭點規則與不掉字（5 句 × 33 種寬度）');
    await t.ctx.close();
  }

  // 8. 橫向矮螢幕整張預覽都看得到；手機打字時預覽縮小，離開欄位後恢復
  {
    const t = await open(844, 390);
    const b = await t.p.locator('#cv').boundingBox();
    assert(b.y >= 0 && b.y + b.height <= 390, `844×390：預覽 ${Math.round(b.y)}–${Math.round(b.y + b.height)} 完整在畫面內`);
    await t.ctx.close();
    const u = await open(360, 640);
    const h0 = (await u.p.locator('#cv').boundingBox()).height;
    await u.p.focus('#sub'); await u.p.waitForTimeout(150);
    const h1 = (await u.p.locator('#cv').boundingBox()).height;
    assert(h1 < h0 && await u.p.isVisible('#sizeRow'), `打字時預覽縮小 ${Math.round(h0)}→${Math.round(h1)}px，尺寸列仍可點`);
    await u.p.locator('#sub').blur(); await u.p.waitForTimeout(350);
    assert(Math.abs((await u.p.locator('#cv').boundingBox()).height - h0) < 2, '離開欄位後恢復');
    await u.ctx.close();
  }

  await browser.close();
  try { fs.rmSync(path.dirname(WRAP), { recursive: true }); } catch (e) {}
  assert(!errors.length, '沒有 page/console error' + (errors.length ? '：' + errors.join(' | ') : ''));
  console.log(fails ? `${fails} 項失敗` : '全部通過');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
