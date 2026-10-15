// Verify caption-card: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL_ = 'file://' + WRAP, OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('  ok -', m); };
const mockDl = () => { window.__saved = []; window.claude = { use: async n => n === 'downloads' ? { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } } : null }; };

const SENTENCES = [
  '今天天氣很好，我們一起去公園散步吧。', '你好，世界！這是一段測試文字，用來檢查斷行。', '「學而時習之，不亦說乎？」——論語', '他說：「我明天會來。」然後就走了。',
  '人生就像一盒巧克力，你永遠不知道下一顆是什麼味道。', '把今天過好，就是最好的計畫。', '休息，是為了走更長遠的路；堅持，才能看見風景。', '咖啡、茶、果汁，你要喝哪一種？',
  'Hello 世界，this is a mixed sentence，中英混排測試。', '早安！今天也要加油喔！！', '（備註）本活動名額有限，額滿為止。', '價格：NT$1,200，含運。',
  '他問：「真的嗎？」我說：「真的。」', '一二三四五六七八九十，一二三四五六七八九十。', '讀書筆記：《原子習慣》第三章，重點是環境設計。', '……沉默了很久，他終於開口。',
  '晚安。明天見。', '週末市集時間：10:00–17:00，地點：中山公園。', '別忘了：喝水、伸展、深呼吸。', '這是一句非常非常非常非常非常非常長的句子，用來測試標點符號在行尾時的處理方式，對吧？',
];
const NO_START = '，。、！？；：」』）】》〉〕…‥・·,.!?;:)]}％%';

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const watch = p => { p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e))); };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(mockDl);
  const page = await ctx.newPage(); watch(page);
  await page.goto(URL_); await page.waitForTimeout(500);
  assert(await page.evaluate(() => innerWidth) === 390, 'innerWidth 390');
  assert(await page.isVisible('#sampleNote'), 'sample card + 範例 note visible on first open');
  assert(await page.evaluate(() => __previewLines.join('/')) === '把今天過好，/就是最好的計畫。', 'sample title keeps manual line breaks');
  await page.screenshot({ path: path.join(OUT, '390x844.png') });

  // kinsoku: 20 sentences x many widths -> no forbidden punctuation at line start
  const kin = await page.evaluate(({ S, NS }) => { const bad = []; let lines = 0;
    for (const s of S) for (let w = 160; w <= 900; w += 37) { const L = __cc.breakLines(s, w, 64); lines += L.length;
      L.forEach((l, i) => { if (i > 0 && NS.includes([...l.text][0])) bad.push(s + ' @' + w + ' -> ' + l.text); });
      const joined = L.map(l => l.text).join('').replace(/\s/g, ''); if (joined !== s.replace(/\s/g, '')) bad.push('LOST ' + s + ' @' + w); }
    return { bad, lines }; }, { S: SENTENCES, NS: NO_START });
  assert(kin.bad.length === 0, `20 sentences x 21 widths (${kin.lines} lines): no punctuation at line start, no lost chars ${kin.bad.slice(0, 3).join(' | ')}`);
  const ex = await page.evaluate(() => __cc.breakLines('你好，世界', 64 * 2.2, 64).map(l => l.text));
  console.log('   example "你好，世界" @2.2em ->', ex);
  assert(ex[0] !== undefined && !ex.some((t, i) => i > 0 && t.startsWith('，')), 'comma pulled with previous char');

  // type own text (clears sample flag); auto font size 1 char .. 100 chars fits
  await page.fill('#title', '好'); await page.waitForTimeout(80);
  const one = await page.evaluate(() => __cc.layoutCard(1080, 1350));
  assert(!one.overflow && one.size > 200, '1 char: auto size ' + one.size.toFixed(0) + 'px fits');
  const hundred = '一二三四五六七八九十'.repeat(10);
  await page.fill('#title', hundred); await page.waitForTimeout(80);
  const h = await page.evaluate(() => __cc.layoutCard(1080, 1350));
  assert(!h.overflow && h.tl.every(l => l.w <= h.availW + 0.5) && h.titleH <= h.availH * 0.6 + 0.5, `100 chars: ${h.size.toFixed(1)}px, ${h.tl.length} lines, fits width & 60% height`);
  assert(!(await page.isVisible('#sampleNote')), 'sample note hidden after editing');
  // 500 chars -> overflow hint, no errors
  await page.fill('#title', '測試長文字，'.repeat(84)); await page.waitForTimeout(120);
  const l500 = await page.evaluate(() => __cc.layoutCard(1080, 1350));
  console.log('   504 chars ->', l500.size.toFixed(1) + 'px', l500.tl.length, 'lines, overflow', l500.overflow);
  await page.fill('#title', '測試長文字，'.repeat(160)); await page.waitForTimeout(120);
  assert(await page.isVisible('#overflow'), '960 chars at min 24px still overflows -> shows 文字超出版面');
  // emoji only
  await page.fill('#title', '🎉🎉🌈✨'); await page.waitForTimeout(80);
  assert(!(await page.isVisible('#overflow')), 'emoji-only title renders without overflow');
  // empty -> placeholder in preview, not in export
  await page.fill('#title', ''); await page.waitForTimeout(80);
  assert(await page.evaluate(() => __previewLines[0]) === '在這裡輸入標題', 'empty title shows placeholder in preview');
  await page.evaluate(async () => { await __cc.renderBlob(); });
  assert(await page.evaluate(() => __exportLines.length) === 0, 'placeholder not drawn in export');

  // real content; preview vs export line breaks identical
  await page.fill('#title', '休息，是為了走更長遠的路；堅持，才能看見風景。');
  await page.fill('#sub', '給忙碌的你'); await page.fill('#author', '— 小編');
  await page.click('#sizeRow-4x5');
  await page.click('#dlBtn'); assert((await page.textContent('#dlInfo')).startsWith('1080 × 1350'), 'dl sheet 1080 x 1350');
  await page.click('#dlGo'); await page.waitForFunction(() => window.__saved.length === 1);
  const sv = await page.evaluate(async () => { const s = window.__saved[0]; const b = await createImageBitmap(s.data); return { name: s.filename, w: b.width, h: b.height, type: s.data.type, pv: __previewLines, ex: __exportLines }; });
  assert(sv.w === 1080 && sv.h === 1350 && sv.type === 'image/png' && /^caption-\d{8}-\d{4}\.png$/.test(sv.name), `exported ${sv.name} ${sv.w}x${sv.h}`);
  assert(JSON.stringify(sv.pv) === JSON.stringify(sv.ex), 'preview and export line breaks identical: ' + sv.ex.join(' / '));
  await page.click('#dlClose');

  // templates change style not text
  await page.click('#tplBtn'); await page.click('#tpl-5');
  const t5 = await page.evaluate(() => { const s = __cc.st(); return { deco: s.deco, font: s.font, title: s.title, bg: s.bg }; });
  assert(t5.deco === 'quote' && t5.font === 'serif' && t5.bg === '#1f2a44' && t5.title.startsWith('休息'), 'template 引言 applied, text unchanged');
  // save preset, then apply another template, then re-apply preset
  await page.click('#tplBtn'); await page.click('#savePreset');
  assert((await page.textContent('#presetCount')).startsWith('1'), 'preset saved (1 / 20)');
  await page.click('#tpl-1'); assert(await page.evaluate(() => __cc.st().bg === '#111111'), 'template 黑底黃字 applied');
  await page.click('#tplBtn'); await page.click('#preset-0'); assert(await page.evaluate(() => __cc.st().deco === 'quote'), 'own preset re-applied');
  // text tab controls
  await page.click('#weightRow-400'); await page.click('#alignRow-right');
  await page.fill('#strokeW', '6'); await page.dispatchEvent('#strokeW', 'input'); await page.check('#shadow');
  const ts = await page.evaluate(() => { const s = __cc.st(); return [s.weight, s.align, s.strokeW, s.shadow]; });
  assert(JSON.stringify(ts) === '[400,"right",6,true]', 'weight/align/stroke/shadow set ' + JSON.stringify(ts));
  // manual font size
  await page.fill('#fsize', '120'); await page.dispatchEvent('#fsize', 'input');
  assert(await page.evaluate(() => { const L = __cc.layoutCard(1080, 1350); return !__cc.st().autoSize && Math.abs(L.size - 120) < 0.01; }), 'manual size 120px');
  // drag text block down on canvas -> vy grows
  const vy0 = await page.evaluate(() => __cc.st().vy);
  const box = await page.locator('#cv').boundingBox();
  const L = await page.evaluate(() => __cc.layoutCard(1080, 1350));
  const ty = box.y + (L.top + L.blockH / 2) / 1350 * box.height;
  await page.mouse.move(box.x + box.width / 2, ty); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, ty + 60, { steps: 5 }); await page.mouse.up();
  const vy1 = await page.evaluate(() => __cc.st().vy);
  assert(vy1 > vy0 + 0.05, `drag moves text down vy ${vy0} -> ${vy1.toFixed(2)}`);
  // background photo via file input (canvas-generated)
  await page.click('#tab-bg');
  const b64 = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1200, 0); g.addColorStop(0, '#0a7'); g.addColorStop(1, '#a07'); x.fillStyle = g; x.fillRect(0, 0, 1200, 800);
    const b = await new Promise(r => c.toBlob(r, 'image/jpeg', .9)); const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); });
  await page.setInputFiles('#bgFile', { name: 'bg.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await page.waitForFunction(() => __cc.hasPhoto() && __cc.st().bgType === 'photo');
  await page.fill('#dim', '60'); await page.dispatchEvent('#dim', 'input');
  // drag photo focus (outside text)
  await page.click('#tab-layout'); await page.click('#vposRow-0'); await page.click('#tab-bg');
  const fx0 = await page.evaluate(() => __cc.st().fx);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 15); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height - 15, { steps: 4 }); await page.mouse.up();
  assert(await page.evaluate(f => __cc.st().fx > f, fx0), 'dragging background moves photo focus');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll 390');
  await page.screenshot({ path: path.join(OUT, '390x844-photo.png') });
  // reload: draft + photo restored
  await page.waitForTimeout(700);
  await page.reload(); await page.waitForFunction(() => window.__photoReady);
  const r = await page.evaluate(() => ({ t: __cc.st().title, bgType: __cc.st().bgType, dim: __cc.st().dim, photo: __cc.hasPhoto(), size: __cc.st().size }));
  assert(r.t.startsWith('休息') && r.bgType === 'photo' && r.dim === 60 && r.photo && r.size === '4:5', 'draft text, style and IndexedDB photo restored after reload');
  assert(!(await page.isVisible('#sampleNote')), 'no sample note when a draft exists');
  // sizes
  await page.click('#sizeRow-16x9'); assert((await page.textContent('#sizeInfo')).startsWith('1920 × 1080'), '16:9 -> 1920 x 1080');
  await page.click('#sizeRow-custom'); await page.fill('#cWidth', '800'); await page.dispatchEvent('#cWidth', 'change');
  assert((await page.textContent('#sizeInfo')).startsWith('800 ×'), 'custom width 800');
  await page.fill('#cWidth', '50'); await page.dispatchEvent('#cWidth', 'change');
  assert((await page.inputValue('#cWidth')) === '800', 'custom width 50 rejected');
  await page.evaluate(async () => { localStorage.clear(); await new Promise(r => { const q = indexedDB.deleteDatabase('caption-card'); q.onsuccess = q.onerror = q.onblocked = r; }); });
  await ctx.close();

  const shots = [
    ['360x780', { width: 360, height: 780 }, 'light', true],
    ['844x390', { width: 844, height: 390 }, 'light', true],
    ['390x844-dark', { width: 390, height: 844 }, 'dark', true],
    ['1280x800', { width: 1280, height: 800 }, 'light', false],
  ];
  for (const [name, vp, scheme, mobile] of shots) {
    const c = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2, colorScheme: scheme });
    const p = await c.newPage(); watch(p); await p.goto(URL_); await p.waitForTimeout(500);
    assert(await p.evaluate(w => innerWidth === w && document.documentElement.scrollWidth <= innerWidth, vp.width), name + ' width ok, no h-scroll');
    if (name === '390x844-dark') {
      await p.click('#tplBtn'); await p.waitForTimeout(100); await p.screenshot({ path: path.join(OUT, '390x844-dark-templates.png') }); await p.click('#tpl-6');
      await p.click('#dlBtn'); await p.click('#dlGo'); await p.waitForSelector('#outImg:not([hidden])');
      assert(await p.isVisible('#outHint'), 'no downloads -> image shown for long-press save'); await p.click('#dlClose');
    }
    if (name === '360x780') { await p.click('#tab-layout'); }
    await p.screenshot({ path: path.join(OUT, name + '.png') });
    await c.close();
  }
  await browser.close(); fs.unlinkSync(WRAP);
  assert(errors.length === 0, 'no console errors ' + JSON.stringify(errors));
  console.log('ALL PASSED');
})().catch(e => { console.error(e); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
