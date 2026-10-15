// Run: node verify.js  (uses globally installed playwright + chromium)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'); const fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n' + SRC + '\n</body></html>');
const URL = 'file://' + WRAP; const OUT = __dirname;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); console.log('ok -', m); };
(async () => {
  const browser = await chromium.launch(); const errors = [];
  const mk = async (opts) => { const ctx = await browser.newContext(opts); const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); return { ctx, page }; };
  const mobile = { isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
  try {
    assert(!/�/.test(SRC), 'no literal U+FFFD'); assert(SRC.length < 1.5e6, 'size < 1.5MB (' + SRC.length + ' chars)');
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.clock.install({ time: new Date('2026-10-13T09:00:00') });
    await page.goto(URL); await page.waitForTimeout(100);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    assert((await page.locator('#srcInfo').textContent()).startsWith('範例'), 'sample text marked 範例');
    await page.screenshot({ path: OUT + '/390x844.png' });
    // segmentation: Segmenter and fallback dictionary
    const seg = await page.evaluate(() => { const s = __sr; const a = s.segWords('我們去銀行辦事情').filter(x => x.word).map(x => x.t).join('/');
      s.forceFallback.on = true; const b = s.segWords('我們去銀行辦事情，然後回家').filter(x => x.word).map(x => x.t).join('/'); s.forceFallback.on = false; return { a, b, has: s.hasSeg }; });
    console.log('  segmenter:', seg.a, '| fallback:', seg.b);
    assert(seg.b.includes('我們') && seg.b.includes('銀行') && seg.b.includes('然後'), 'fallback FMM uses embedded word list');
    // ORP focus english
    const orp = await page.evaluate(() => { const d = __sr.build('Reading quickly is a skill, internationalization matters.', { chunk: 1, lang: 'en' }); return d.items.map(i => [i.text, [...i.text][i.focus]]); });
    console.log('  ORP:', JSON.stringify(orp));
    assert(orp[0][1] === 'a' && orp[3][1] === 'a' && orp[1][1] === 'i', 'ORP focus = round(len*0.35)');
    // timing: 1200 CJK chars @600 with punctuation off = 120 s
    const t = await page.evaluate(() => { const s = __sr; let txt = ''; let n = 0; const base = s.BUILTIN.filter(b => b.lang === 'zh').map(b => b.text).join('\n\n');
      for (const ch of base.repeat(3)) { if (/[一-鿿]/.test(ch)) { if (n === 1200) break; n++; } txt += ch; }
      const d = s.build(txt, { chunk: 2 }); const ms = d.items.reduce((a, it) => a + s.delayMs(it, 600, false), 0); const ms2 = d.items.reduce((a, it) => a + s.delayMs(it, 600, true), 0);
      return { units: d.units, ms, ms2, txt, maxChunk: Math.max(...d.items.map(i => i.units)) }; });
    assert(t.units === 1200 && Math.abs(t.ms - 120000) < 1, `1200 字 @600 字/分, 標點延長關 = ${t.ms / 1000}s (with 標點延長 ${Math.round(t.ms2 / 1000)}s)`);
    assert(t.maxChunk <= 4, 'chunk 2 => at most 4 chars per group');
    // live run with fake clock
    await page.fill('#text', t.txt); await page.waitForTimeout(300);
    await page.evaluate(() => { __sr.prefs.speedZh = 600; __sr.prefs.punct = false; __sr.prefs.chunk = 2; __sr.prefs.ramp = false; document.getElementById('punct').checked = false; });
    await page.locator('#startBtn').click(); await page.clock.runFor(1000);
    assert(await page.locator('#reader').isVisible(), 'reader opened');
    const fc1 = await page.evaluate(() => { const r = document.getElementById('wFc').getBoundingClientRect(); return r.left + r.width / 2; });
    await page.screenshot({ path: OUT + '/390x844-reading.png' });
    await page.clock.runFor(40000);
    const fc2 = await page.evaluate(() => { const r = document.getElementById('wFc').getBoundingClientRect(); return r.left + r.width / 2; });
    assert(Math.abs(fc1 - fc2) < 1 && Math.abs(fc1 - 195) < 2, `focus char stays centered (${fc1.toFixed(1)} / ${fc2.toFixed(1)})`);
    // pause & context
    await page.locator('#stage').click(); await page.clock.runFor(100);
    assert(await page.locator('#ctx').isVisible() && await page.locator('#ctx mark').count() === 1, 'pause shows context with highlight');
    await page.screenshot({ path: OUT + '/390x844-paused.png' });
    const i0 = await page.evaluate(() => __sr.R.i);
    await page.locator('#nextSent').click(); const i1 = await page.evaluate(() => __sr.R.i);
    await page.locator('#prevSent').click(); await page.locator('#prevSent').click(); const i2 = await page.evaluate(() => __sr.R.i);
    assert(i1 > i0 && i2 < i1, `sentence jump (${i0} -> ${i1} -> ${i2})`);
    // swipe left on stage via pointer events
    const sb = await page.locator('#stage').boundingBox();
    await page.mouse.move(sb.x + 300, sb.y + 60); await page.mouse.down(); await page.mouse.move(sb.x + 150, sb.y + 62, { steps: 5 }); await page.mouse.move(sb.x + 60, sb.y + 62, { steps: 3 }); await page.mouse.up();
    const i3 = await page.evaluate(() => __sr.R.i); assert(i3 > i2, 'swipe left jumps to next sentence');
    // exit -> resume
    await page.locator('#exitBtn').click();
    assert(await page.locator('#resumeBtn').isVisible(), 'resume button appears for same text');
    await page.reload(); await page.waitForTimeout(100);
    assert(await page.locator('#resumeBtn').isVisible() && (await page.locator('#text').inputValue()) === t.txt, 'resume survives reload');
    await page.evaluate(() => { __sr.prefs.punct = false; __sr.prefs.speedZh = 600; __sr.prefs.chunk = 2; document.getElementById('punct').checked = false; });
    await page.locator('#startBtn').click();
    await page.clock.runFor(115000);
    assert(await page.locator('#doneDlg').isHidden(), 'not finished at 115 s');
    await page.clock.runFor(10000);
    assert(await page.locator('#doneDlg').isVisible(), 'finished by 125 s (target 120 s ±10 s)');
    const dw = await page.locator('#dWpm').textContent(); console.log('  measured', dw, '字/分, time', await page.locator('#dTime').textContent());
    assert(Math.abs(+dw - 600) <= 18, 'measured speed within 3% of 600');
    await page.locator('#self4').click(); await page.locator('#saveResult').click();
    // builtin + quiz
    await page.locator('#libBtn').click(); await page.screenshot({ path: OUT + '/390x844-library.png' });
    await page.locator('#libBuiltin .open').nth(3).click();
    assert((await page.locator('#srcInfo').textContent()).includes('英文'), 'english sample loaded');
    assert((await page.locator('#speedOut').textContent()).includes('詞/分'), 'english speed unit');
    await page.locator('#startBtn').click(); await page.clock.runFor(200000);
    assert(await page.locator('#doneDlg').isVisible() && await page.locator('.qz').count() === 3, 'builtin article ends with 3 quiz questions');
    await page.locator('#q0o1').click(); await page.locator('#q1o1').click(); await page.locator('#q2o0').click();
    await page.locator('#saveResult').click();
    assert(await page.locator('.qz .right').count() === 3 && await page.locator('.qz .wrong').count() === 1, 'quiz graded (2/3)');
    await page.screenshot({ path: OUT + '/390x844-quiz.png' });
    await page.locator('#saveResult').click();
    await page.locator('#statsBtn').click(); await page.waitForTimeout(50);
    assert(await page.locator('#chartBox svg .pt').count() === 1 && (await page.locator('#sScore').textContent()) === '74%', 'stats: chart shows latest language only (1 point), avg comprehension 74% ((80+67)/2 rounded)');
    await page.screenshot({ path: OUT + '/390x844-stats.png' });
    await ctx.close();
    for (const [w, h, name] of [[360, 780, '360x780'], [844, 390, '844x390']]) {
      const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...mobile });
      await page.goto(URL); await page.waitForTimeout(100);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(iw === w && sw <= iw, `${name}: innerWidth ${w}, no h-scroll`);
      await page.screenshot({ path: `${OUT}/${name}.png` });
      if (name === '844x390') { await page.locator('#startBtn').click(); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${name}-reading.png` }); }
      await ctx.close();
    }
    { const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile });
      await page.goto(URL); await page.waitForTimeout(100); await page.screenshot({ path: OUT + '/390x844-dark.png' });
      await page.locator('#startBtn').click(); await page.waitForTimeout(400); await page.locator('#stage').click(); await page.screenshot({ path: OUT + '/390x844-dark-paused.png' }); await ctx.close(); }
    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); fs.unlinkSync(WRAP); }
})();
