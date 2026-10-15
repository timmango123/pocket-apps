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
    assert(!/�/.test(SRC), 'no literal U+FFFD'); assert(Buffer.byteLength(SRC) < 400 * 1024, 'size < 400KB (' + Buffer.byteLength(SRC) + ' bytes)');
    const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
    await page.goto(URL); await page.waitForTimeout(300);
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(iw === 390 && sw <= iw, 'innerWidth 390, no horizontal scroll');
    assert((await page.locator('#inInfo').textContent()).startsWith('範例'), 'sample shown as 範例');
    const r = await page.evaluate(() => { const h = __ph;
      const z = s => h.tag(s).toks.filter(t => !t.plain).map(t => t.ch + h.zDisp(t.z)).join(' ');
      // round-trip every syllable in dictionary: zhuyin -> numbered pinyin -> zhuyin
      let bad = []; for (const s of h.SYL) { const p = h.pinyinOf(s, 'num'); const back = h.pinyinToZhuyin(p); const norm = s.endsWith('˙') ? '˙' + s.slice(0, -1) : s; if (back !== norm) bad.push(s + '>' + p + '>' + back); }
      return { s1: z('我們去銀行，再走一段路回家'), s2: z('銀行'), s3: z('行走'), s4: z('長大'), s5: z('成長'), s6: z('头发很长'), s7: z('音樂快樂'),
        lv: h.numToMark('lü4'), lv2: h.numToMark('lv4'), zhi: h.pinyinToZhuyin('zhi1'), yue: h.pinyinToZhuyin('yue4'), hao: h.pinyinOf('ㄏㄠˇ', 'mark'), hao3: h.pinyinOf('ㄏㄠˇ', 'num'),
        samples: ['ㄐㄩ', 'ㄑㄩㄝˋ', 'ㄋㄩˇ', 'ㄌㄩㄝˋ', 'ㄒㄩㄥˊ', 'ㄨㄥ', 'ㄧㄡˇ', 'ㄍㄨㄟˋ', 'ㄉㄨㄣˋ', 'ㄦˊ', 'ㄗ', 'ㄙˋ', 'ㄖˋ', 'ㄧㄣ', 'ㄧㄥˊ', 'ㄩㄢˊ', 'ㄩㄣˊ', 'ㄨㄛˇ', 'ㄌㄧㄡˊ', 'ㄒㄧㄝˋ', 'ㄐㄧㄤ', 'ㄓㄨㄤˋ', 'ㄔㄨㄢ', 'ㄕㄨㄟˇ', 'ㄇㄜ˙'].map(s => h.pinyinOf(s, 'mark')).join(' '),
        sylN: h.SYL.length, bad: bad.slice(0, 8), badN: bad.length, plain: (h.P.type = 'zhuyin', h.tag('你好'), null) }; });
    console.log('  ', r.s1); console.log('  ', r.s6, '|', r.s7); console.log('   pinyin samples:', r.samples);
    assert(r.s1 === '我ㄨㄛˇ 們˙ㄇㄣ 去ㄑㄩˋ 銀ㄧㄣˊ 行ㄏㄤˊ 再ㄗㄞˋ 走ㄗㄡˇ 一ㄧ 段ㄉㄨㄢˋ 路ㄌㄨˋ 回ㄏㄨㄟˊ 家ㄐㄧㄚ', '「我們去銀行，再走一段路回家」 all correct, 行=ㄏㄤˊ');
    assert(r.s3 === '行ㄒㄧㄥˊ 走ㄗㄡˇ' && r.s4 === '長ㄓㄤˇ 大ㄉㄚˋ' && r.s5 === '成ㄔㄥˊ 長ㄓㄤˇ', '行走 / 長大 / 成長');
    assert(r.s6 === '头ㄊㄡˊ 发ㄈㄚˇ 很ㄏㄣˇ 长ㄔㄤˊ', 'simplified input converted for lookup (头发很长), original chars kept');
    assert(r.lv === 'lǜ' && r.lv2 === 'lǜ' && r.zhi === 'ㄓ' && r.yue === 'ㄩㄝˋ' && r.hao === 'hǎo' && r.hao3 === 'hao3', 'lü4->lǜ, zhi1->ㄓ, yue4->ㄩㄝˋ');
    assert(r.samples === 'jū què nǚ lüè xióng wēng yǒu guì dùn ér zī sì rì yīn yíng yuán yún wǒ liú xiè jiāng zhuàng chuān shuǐ me', '25-syllable pinyin table');
    assert(r.badN === 0, `all ${r.sylN} dictionary syllables round-trip zhuyin->pinyin->zhuyin ` + r.bad.join(','));
    await page.screenshot({ path: OUT + '/390x844.png' });
    // set test sentence, check vertical layout no overlap at 32px
    await page.fill('#input', '我們去銀行，再走一段路回家。銀行旁邊有一家書店，店裡的音樂很好聽，大家都很快樂。');
    await page.waitForTimeout(400);
    await page.locator('#fontSize').fill('32'); await page.waitForTimeout(100);
    const ov = await page.evaluate(() => { const els = [...document.querySelectorAll('#pv .t')].map(e => e.getBoundingClientRect()); let o = 0;
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i], b = els[j]; const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (x > 1 && y > 1) o++; }
      const pv = document.getElementById('preview'); return { o, n: els.length, wrap: pv.scrollWidth <= pv.clientWidth, lines: new Set(els.map(e => Math.round(e.top))).size }; });
    assert(ov.o === 0 && ov.wrap && ov.lines > 2, `32px vertical zhuyin: ${ov.n} chars, no overlap, wraps into ${ov.lines} lines`);
    await page.screenshot({ path: OUT + '/390x844-32px.png' });
    // polyphone override
    const polyIdx = await page.evaluate(() => [...document.querySelectorAll('#pv [data-k]')].findLastIndex(e => e.textContent.startsWith('樂') && e.classList.contains('poly')));
    assert(polyIdx >= 0, '樂 marked as polyphone');
    const el = page.locator('#pv [data-k]').nth(polyIdx); await el.click();
    assert(await page.locator('#pop').isVisible(), 'candidate menu opens');
    await page.screenshot({ path: OUT + '/390x844-popover.png' });
    const cands = await page.locator('#popCands button b').allTextContents(); console.log('   樂 candidates:', cands.join(' '));
    await page.locator('#popCands button', { hasText: 'ㄩㄝˋ' }).first().click(); await page.waitForTimeout(150);
    assert((await page.evaluate(() => __ph.plainOut())).includes('樂(ㄩㄝˋ)。'), 'override applied (快樂 -> 樂 ㄩㄝˋ)');
    await page.reload(); await page.waitForTimeout(400);
    assert((await page.evaluate(() => __ph.plainOut())).includes('快(ㄎㄨㄞˋ)樂(ㄩㄝˋ)'), 'override persists after reload');
    await page.evaluate(() => { localStorage.removeItem('phonetic-tag:v1:overrides'); }); await page.reload(); await page.waitForTimeout(300);
    // plain text / html output
    await page.fill('#input', '你好'); await page.waitForTimeout(300);
    assert((await page.evaluate(() => __ph.plainOut())) === '你(ㄋㄧˇ)好(ㄏㄠˇ)', 'plain text 你(ㄋㄧˇ)好(ㄏㄠˇ)');
    assert((await page.evaluate(() => __ph.htmlOut())) === '<ruby>你<rt>ㄋㄧˇ</rt></ruby><ruby>好<rt>ㄏㄠˇ</rt></ruby>', 'HTML ruby output');
    await page.locator('#tPinyin').click(); assert((await page.evaluate(() => __ph.plainOut())) === '你(nǐ)好(hǎo)', 'pinyin mode');
    await page.locator('#toneNum').click(); assert((await page.evaluate(() => __ph.plainOut())) === '你(ni3)好(hao3)', 'numbered tones');
    await page.locator('#toneMark').click(); await page.locator('#tBoth').click();
    await page.fill('#input', '一定不要一起'); await page.waitForTimeout(300);
    await page.locator('label.tg:has(#sandhi)').click(); await page.waitForTimeout(100);
    assert((await page.evaluate(() => __ph.plainOut())) === '一(ㄧˊ yí)定(ㄉㄧㄥˋ dìng)不(ㄅㄨˊ bú)要(ㄧㄠˋ yào)一(ㄧˋ yì)起(ㄑㄧˇ qǐ)', 'sandhi option: 一定 yí, 不要 bú, 一起 yì');
    await page.screenshot({ path: OUT + '/390x844-both.png' });
    await page.locator('label.tg:has(#sandhi)').click();
    await page.locator('#tZhuyin').click(); await page.locator('#posTop').click();
    await page.fill('#input', '我們去銀行，再走一段路回家。'); await page.waitForTimeout(300);
    assert(await page.locator('#pv ruby').count() === 12, 'top mode uses <ruby>');
    await page.locator('label.tg:has(#grid)').click(); await page.selectOption('#perLine', '8'); await page.waitForTimeout(150);
    await page.screenshot({ path: OUT + '/390x844-top-grid.png' });
    // only new chars
    await page.locator('#posRight').click(); await page.locator('label.tg:has(#grid)').click(); await page.selectOption('#perLine', '0');
    await page.locator('label.tg:has(#onlyNew)').click(); await page.fill('#newChars', '銀段'); await page.waitForTimeout(300);
    assert((await page.evaluate(() => __ph.plainOut())) === '我們去銀(ㄧㄣˊ)行，再走一段(ㄉㄨㄢˋ)路回家。', 'only-new-chars mode');
    await page.locator('label.tg:has(#onlyNew)').click();
    // unknown char + PNG
    await page.fill('#input', '𠮷野家'); await page.waitForTimeout(300);
    assert(await page.locator('#pv .t.unk').count() === 1, 'rare char marked unknown');
    await page.fill('#input', '我們去銀行，再走一段路回家。'); await page.waitForTimeout(300);
    await page.locator('#showPng').click(); await page.waitForTimeout(800);
    const img = await page.evaluate(() => { const i = document.querySelector('#imgBox img'); return i ? [i.naturalWidth, i.naturalHeight] : null; });
    assert(img && img[0] > 300, 'PNG generated via foreignObject (' + img + ')');
    await page.screenshot({ path: OUT + '/390x844-png.png' });
    await page.locator('#imgClose').click();
    // large input chunked render
    const t0 = Date.now(); await page.fill('#input', '我們去銀行，再走一段路回家。'.repeat(450)); await page.waitForTimeout(1500);
    const cnt = await page.locator('#pv .t').count(); assert(cnt === 12 * 450, `6300-char input rendered in chunks (${cnt} annotated han chars, ${Date.now() - t0} ms)`);
    await page.fill('#input', ''); await page.waitForTimeout(300);
    assert((await page.locator('#inInfo').textContent()).startsWith('範例'), 'empty input shows sample');
    await ctx.close();
    // downloads capability stub
    { const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, ...mobile });
      await page.addInitScript(() => { window.__saved = []; window.claude = { use: async (n) => n === 'downloads' ? { save: async (o) => { window.__saved.push([o.filename, o.data instanceof Blob ? 'blob:' + o.data.type + ':' + o.data.size : typeof o.data]); } } : null }; });
      await page.goto(URL); await page.waitForTimeout(300);
      assert(await page.locator('#dlPng').isVisible() && await page.locator('#showPng').isHidden(), 'downloads available: PNG/HTML buttons shown');
      await page.locator('#dlPng').click(); await page.waitForTimeout(800); await page.locator('#dlHtml').click(); await page.waitForTimeout(200);
      const saved = await page.evaluate(() => window.__saved); console.log('   saved:', JSON.stringify(saved));
      assert(saved.length === 2 && saved[0][0].endsWith('.png') && saved[0][1].startsWith('blob:image/png') && saved[1][0].endsWith('.html'), 'dl.save called for png + html');
      await ctx.close(); }
    for (const [w, h, name, opt] of [[360, 780, '360x780', mobile], [844, 390, '844x390', mobile], [1280, 800, 'desktop', {}]]) {
      const { ctx, page } = await mk({ viewport: { width: w, height: h }, ...opt });
      await page.goto(URL); await page.waitForTimeout(300);
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      assert(iw === w && sw <= iw, `${name}: innerWidth ${w}, no h-scroll`);
      await page.screenshot({ path: `${OUT}/${name}.png` }); await ctx.close();
    }
    { const { ctx, page } = await mk({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', ...mobile });
      await page.goto(URL); await page.waitForTimeout(300); await page.locator('#preview').scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + '/390x844-dark.png' }); await ctx.close(); }
    assert(errors.length === 0, 'no console errors: ' + errors.join(' | '));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  finally { await browser.close(); fs.unlinkSync(WRAP); }
})();
