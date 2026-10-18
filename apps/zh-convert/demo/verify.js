// Verify zh-convert in a browser: run with `node verify.js`
// Opens the page at 390×844 and the three lobby iframe sizes (375×500, 390×610, 430×740), light and dark,
// asserts no page errors / horizontal overflow, drives the main flows, and writes cover-390x520.png.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'zh-convert-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, mobile: true },
    { name: '375x500', viewport: { width: 375, height: 500 }, mobile: true },
    { name: '390x610', viewport: { width: 390, height: 610 }, mobile: true },
    { name: '430x740', viewport: { width: 430, height: 740 }, mobile: true },
    { name: '375x500-dark', viewport: { width: 375, height: 500 }, mobile: true, dark: true },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, mobile: true, dark: true },
    { name: '844x390', viewport: { width: 844, height: 390 }, mobile: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: s.viewport, isMobile: s.mobile, hasTouch: s.mobile, deviceScaleFactor: 2, colorScheme: s.dark ? 'dark' : 'light', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL);
    await page.waitForTimeout(250);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]} <= ${sw[1]})`);
    // sample content visible with the 範例 chip and highlighted marks
    const marks = await page.locator('#out .m').count();
    ok(marks > 10, `${s.name} sample converted with ${marks} marks`);
    ok(await page.locator('#sample-chip').isVisible(), `${s.name} 範例 chip shown on first open`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });

    if (s.name === '390x844') {
      const outText = () => page.evaluate(() => document.getElementById('out').textContent);
      ok(/頭髮/.test(await outText()) && /麵條/.test(await outText()) && /一隻貓/.test(await outText()), 'sample: 头发→頭髮, 面条→麵條, 一只→一隻');
      // 台灣用語 is on by default (the title promises 台灣正體); the hint shows what the switch does right now
      ok((await page.isChecked('#opt-tw')) && /軟體/.test(await outText()) && /品質/.test(await outText()) && /計程車/.test(await outText()), '台灣用語 on by default: 軟體 / 品質 / 計程車');
      ok((await page.locator('#out .m.tw').count()) >= 3, 'vocabulary marks use the tw style');
      ok((await page.textContent('#tw-hint')) === '软件→軟體', '台灣用語 hint while on: ' + (await page.textContent('#tw-hint')));
      await page.click('#opt-tw + .sw'); await page.waitForTimeout(100);
      ok(!/軟體/.test(await outText()) && /軟件/.test(await outText()) && (await page.textContent('#tw-hint')) === '软件→軟件', '台灣用語 off: characters only (软件→軟件), hint follows');
      await page.click('#opt-tw + .sw'); await page.waitForTimeout(100);
      // type own text: chip disappears, counts update
      await page.fill('#src', '他的头发很干净');
      await page.waitForTimeout(150);
      ok((await outText()) === '他的頭髮很乾淨', 'typed text converts: ' + (await outText()));
      ok(!(await page.locator('#sample-chip').isVisible()), '範例 chip hidden after typing');
      ok(/7 字/.test(await page.textContent('#in-meta')), 'character count shows 7 字: ' + (await page.textContent('#in-meta')));
      ok(/處變更/.test(await page.textContent('#out-meta')), 'change count shown: ' + (await page.textContent('#out-meta')));
      // tap a mark -> sheet with alternatives, pick one
      await page.click('#out .m:has-text("頭髮")');
      await page.waitForTimeout(250);
      ok(await page.locator('#sheet.on').isVisible(), 'alternatives sheet opens');
      const alts = await page.locator('#sheet-alts button').allTextContents();
      ok(alts[0] === '頭髮' && alts.includes('頭發'), 'alternatives listed: ' + alts.join('/'));
      await page.click('#sheet-alts button:has-text("頭發")');
      ok((await outText()) === '他的頭發很乾淨', 'picking an alternative updates the result');
      // add to custom dictionary from the sheet
      await page.click('#sheet-dict');
      await page.waitForTimeout(250);
      ok(!(await page.locator('#sheet.on').isVisible()), 'sheet closes after adding to dictionary');
      ok(/1 筆/.test(await page.textContent('#dict-n')), 'dictionary has 1 entry');
      ok((await page.locator('#out .m.cus').count()) === 1, 'custom entry is highlighted in the cus style');
      // persisted
      await page.reload(); await page.waitForTimeout(250);
      ok((await page.inputValue('#src')) === '他的头发很干净' && (await outText()) === '他的頭發很乾淨' && (await page.isChecked('#opt-tw')), 'text, dictionary and toggle persist after reload');
      // delete the entry
      await page.click('#dict summary');
      await page.click('#dict-list .del');
      await page.waitForTimeout(100);
      ok((await outText()) === '他的頭髮很乾淨', 'deleting the entry restores the built-in conversion');
      // add via the form
      await page.fill('#dict-from', '土豆'); await page.fill('#dict-to', '洋芋'); await page.click('#dict-add');
      await page.fill('#src', '土豆和软件');
      await page.waitForTimeout(150);
      ok((await outText()) === '洋芋和軟體', 'form entry applies with vocabulary: ' + (await outText()));
      // swap direction moves the result into the input
      await page.click('#swap');
      await page.waitForTimeout(150);
      ok((await page.inputValue('#src')) === '洋芋和軟體' && (await page.getAttribute('#dir-t2s', 'aria-pressed')) === 'true', 'swap puts result into input and flips direction');
      ok((await outText()) === '洋芋和软件', 't2s with vocabulary: ' + (await outText()));
      ok(!(await page.locator('#opt-tai-wrap').isVisible()), '臺/台 option hidden in t2s');
      // clear and copy
      await page.click('#clear');
      ok((await page.inputValue('#src')) === '' && (await outText()) === '', 'clear empties both panes');
      await page.fill('#src', '乾淨');
      await page.waitForTimeout(150);
      await page.click('#copy');
      await page.waitForTimeout(100);
      const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      ok(clip === '干净', 'copy writes the result to the clipboard: ' + clip);
      ok(/已複製/.test(await page.textContent('#toast')), 'toast confirms copy');
      // theme toggle
      await page.click('#theme-btn');
      ok((await page.getAttribute('html', 'data-theme')) === 'light', 'theme button cycles to light');
      await page.click('#theme-btn');
      ok((await page.getAttribute('html', 'data-theme')) === 'dark', 'theme button cycles to dark');
      // clear can be undone from the toast (back in 簡→繁)
      await page.click('#dir-s2t');
      await page.fill('#src', '头发'); await page.waitForTimeout(150);
      await page.click('#clear'); await page.waitForTimeout(100);
      ok(await page.locator('#empty').isVisible() && await page.locator('#e-paste').isVisible(), 'empty state with paste / open / sample actions');
      ok(await page.isDisabled('#copy'), 'copy disabled while empty');
      await page.click('#toast-act');
      await page.waitForTimeout(150);
      ok((await page.inputValue('#src')) === '头发' && (await outText()) === '頭髮', 'clear undone from the toast');
      // marks toggle hides highlights but keeps the text
      await page.click('#opt-marks + .sw'); await page.waitForTimeout(300);
      ok(await page.evaluate(() => getComputedStyle(document.querySelector('#out .m')).backgroundColor === 'rgba(0, 0, 0, 0)'), 'marks toggle shows plain text');
      await page.click('#opt-marks + .sw');
      // paste button reads the clipboard; result equals the engine output; Ctrl+Enter copies
      await page.evaluate(() => navigator.clipboard.writeText('冲咖啡要用热水冲。这只是一个开始。'));
      await page.click('#paste'); await page.waitForTimeout(150);
      ok((await outText()) === '沖咖啡要用熱水沖。這只是一個開始。', 'paste button converts clipboard text: ' + (await outText()));
      await page.evaluate(() => navigator.clipboard.writeText(''));
      await page.keyboard.press('Control+Enter'); await page.waitForTimeout(100);
      ok((await page.evaluate(() => navigator.clipboard.readText())) === '沖咖啡要用熱水沖。這只是一個開始。', 'Ctrl+Enter copies the result');
      // open a GBK-encoded text file (legacy mainland encoding) and a Big5 one
      const gbk = Buffer.from([0xcd, 0xb7, 0xb7, 0xa2, 0xb8, 0xc9, 0xbe, 0xbb]); // 头发干净
      await page.setInputFiles('#file', { name: 'gbk.txt', mimeType: 'text/plain', buffer: gbk });
      await page.waitForTimeout(250);
      ok((await page.inputValue('#src')) === '头发干净' && (await outText()) === '頭髮乾淨', 'GBK file decoded and converted: ' + (await page.inputValue('#src')));
      await page.setInputFiles('#file', { name: 'u8.srt', mimeType: '', buffer: Buffer.from('﻿1\n00:00:01,000 --> 00:00:02,000\n后来的面条\n', 'utf8') });
      await page.waitForTimeout(250);
      const res = () => page.evaluate(() => window.__zc.result());
      ok((await res()) === '1\n00:00:01,000 --> 00:00:02,000\n後來的麵條\n', 'UTF-8 subtitle file with BOM keeps lines: ' + JSON.stringify(await res()));
      ok((await page.locator('#out .p').count()) === 3, 'each line is its own block in the result');
      await page.setInputFiles('#file', { name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]) });
      await page.waitForTimeout(150);
      ok(/不是文字/.test(await page.textContent('#toast-msg')) && /後來/.test(await outText()), 'non-text file refused with a plain message, text kept');
      // download the result as .txt
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
      const dlPath = await dl.path(); const dlText = fs.readFileSync(dlPath, 'utf8');
      // (headless Chromium reports non-ASCII download names as "download", so only the content is checked here)
      ok(dlText === '1\n00:00:01,000 --> 00:00:02,000\n後來的麵條\n', 'download writes the full result as UTF-8 text');
      // 100k characters: no long freeze, result identical to a one-shot conversion, copy works
      const big = ('他的头发很长，公司的发展很快。这个软件的质量很高，程序运行得很快，冲咖啡要用热水冲。\n').repeat(2300);
      await page.evaluate(() => { window.__lf = 0; let last = performance.now(); (function f() { const n = performance.now(); window.__lf = Math.max(window.__lf, n - last); last = n; requestAnimationFrame(f); })(); });
      const t0 = Date.now();
      await page.evaluate(t => { const s = document.getElementById('src'); s.value = t; s.dispatchEvent(new Event('input')); }, big);
      await page.waitForFunction(() => /處變更/.test(document.getElementById('out-meta').textContent), null, { timeout: 15000 });
      const bigMs = Date.now() - t0;
      await page.click('#src'); await page.keyboard.press('Control+Home'); await page.keyboard.type('发', { delay: 60 }); await page.waitForTimeout(400);
      const lf = await page.evaluate(() => window.__lf);
      ok(lf < 450, `100k characters: converted in ${bigMs} ms, longest frame ${Math.round(lf)} ms`);
      const same = await page.evaluate(() => { const r = window.__zc.result(); return r.length; });
      const want = await page.evaluate(() => { const ZCs = document.getElementById('src').value; return ZCs.length; });
      ok(same === want, `100k result has the same length as the input (${same} / ${want})`);
      ok((await page.evaluate(() => window.__zc.result().slice(0, 9))) === '發他的頭髮很長，公', 'typed character at the top converted');
      ok(await page.evaluate(() => window.__zc.result() === ZC.join(ZC.convert(document.getElementById('src').value, { dir: 's2t', tw: document.getElementById('opt-tw').checked, tai: true }))), '100k block-by-block result equals a one-shot conversion');
      // ---- second review fixes ----
      await page.click('#clear'); await page.click('#e-sample'); await page.reload(); await page.waitForTimeout(300);
      ok(await page.locator('#sample-chip').isVisible(), 'sample shown again');
      // first input replaces the sample instead of mixing with it
      await page.click('#src'); await page.waitForTimeout(100);
      await page.keyboard.type('头发');
      await page.waitForTimeout(150);
      ok((await page.inputValue('#src')) === '头发', 'typing on first focus replaces the sample: ' + (await page.inputValue('#src')).slice(0, 40));
      // one-to-one marks are faint, one-to-many marks are strong
      await page.fill('#src', '他说头发很长，发现了问题。'); await page.waitForTimeout(150);
      const cls = await page.evaluate(() => [...document.querySelectorAll('#out .m')].map(m => m.textContent + ':' + (m.classList.contains('one') ? 'one' : 'amb')));
      ok(cls.includes('說:one') && cls.includes('頭髮:amb') && cls.includes('發:amb') && cls.includes('現:one'), 'faint one-to-one marks, strong one-to-many marks: ' + cls.join(' '));
      // a tap just beside a one-character mark opens it
      const mb = await page.locator('#out .m', { hasText: '說' }).boundingBox();
      await page.mouse.click(mb.x + mb.width + 5, mb.y + mb.height / 2); await page.waitForTimeout(250);
      ok(await page.locator('#sheet.on').isVisible(), 'tap 5px beside a one-character mark opens it');
      await page.click('#sheet-close'); await page.waitForTimeout(250);
      // a choice is remembered after reload, after editing elsewhere in the line and after toggling 台灣用語
      await page.click('#out .m:has-text("頭髮")'); await page.waitForTimeout(250);
      await page.click('#sheet-alts button:has-text("頭發")'); await page.click('#sheet-close'); await page.waitForTimeout(200);
      const res2 = () => page.evaluate(() => window.__zc.result());
      ok((await res2()) === '他說頭發很長，發現了問題。', 'choice applied');
      await page.reload(); await page.waitForTimeout(300);
      ok((await res2()) === '他說頭發很長，發現了問題。', 'choice remembered after reload');
      await page.fill('#src', '他说头发很长，发现了问题。我们走吧'); await page.waitForTimeout(150);
      ok((await res2()) === '他說頭發很長，發現了問題。我們走吧', 'choice kept after editing elsewhere in the line: ' + (await res2()));
      await page.click('#opt-tw + .sw'); await page.waitForTimeout(150);
      ok(/頭發/.test(await res2()), 'choice kept after toggling 台灣用語');
      await page.click('#opt-tw + .sw'); await page.waitForTimeout(150);
      ok((await page.locator('#out .m.picked').count()) === 1, 'remembered choice is styled as picked');
      // custom dictionary export and import
      await page.click('#dict summary').catch(() => {});
      if (!(await page.locator('#dict[open]').count())) await page.click('#dict summary');
      await page.fill('#dict-from', '土豆'); await page.fill('#dict-to', '洋芋'); await page.click('#dict-add');
      ok((await page.getAttribute('#dict-from', 'enterkeyhint')) === 'next' && (await page.getAttribute('#dict-to', 'enterkeyhint')) === 'done', 'dictionary inputs have enterkeyhint');
      const [dx] = await Promise.all([page.waitForEvent('download'), page.click('#dict-export')]);
      const dtext = fs.readFileSync(await dx.path(), 'utf8');
      ok(/土豆\t洋芋\t簡→繁/.test(dtext), 'dictionary export writes tab-separated lines');
      await page.click('#dict-list .del'); await page.waitForTimeout(100);
      await page.setInputFiles('#dict-file', { name: 'd.txt', mimeType: 'text/plain', buffer: Buffer.from(dtext + '面条,面線,簡→繁\n壞行\n', 'utf8') });
      await page.waitForTimeout(250);
      ok(/2 筆/.test(await page.textContent('#dict-n')) && /匯入 2 筆新詞，略過 1 行/.test(await page.textContent('#toast-msg')), 'dictionary import adds entries and reports bad lines: ' + (await page.textContent('#toast-msg')));
      await page.click('#toast-act'); await page.waitForTimeout(150);
      ok(/0 筆/.test(await page.textContent('#dict-n')), 'import can be undone');
      // ---- third review fixes ----
      // export → delete everything → import gives back exactly the same dictionary (commas, arrows, =>, 繁→簡, # at the start)
      const tricky = [['軟體', '软件', 't2s'], ['A,B', 'C', 's2t'], ['甲→乙', '丙=>丁', 's2t'], ['x=>y', 'p,q→r', 't2s'], ['#井號', '#號', 's2t']];
      for (const [f, t, d] of tricky) { await page.click('#dict-dir-' + d); await page.fill('#dict-from', f); await page.fill('#dict-to', t); await page.click('#dict-add'); await page.waitForTimeout(30); }
      const dictBefore = await page.evaluate(() => localStorage.getItem('zh-convert:v1:dict'));
      const [dx2] = await Promise.all([page.waitForEvent('download'), page.click('#dict-export')]);
      const dtext2 = fs.readFileSync(await dx2.path(), 'utf8');
      while (await page.locator('#dict-list .del').count()) { await page.click('#dict-list .del'); await page.waitForTimeout(20); }
      ok(/0 筆/.test(await page.textContent('#dict-n')), 'dictionary emptied');
      await page.setInputFiles('#dict-file', { name: 'back.txt', mimeType: 'text/plain', buffer: Buffer.from(dtext2, 'utf8') });
      await page.waitForTimeout(250);
      const dictAfter = await page.evaluate(() => localStorage.getItem('zh-convert:v1:dict'));
      ok(dictAfter === dictBefore && JSON.parse(dictAfter).length === 5, 'export → delete all → import restores the dictionary exactly: ' + dictAfter);
      while (await page.locator('#dict-list .del').count()) { await page.click('#dict-list .del'); await page.waitForTimeout(20); }
      await page.click('#dict-dir-s2t');
      // a choice belongs to one spot: an identical other line keeps the default, before and after reload
      await page.click('#clear'); await page.waitForTimeout(100);
      await page.fill('#src', '他的头发很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(200);
      await page.locator('#out .m', { hasText: '頭髮' }).first().click(); await page.waitForTimeout(250);
      await page.click('#sheet-alts button:has-text("頭發")'); await page.click('#sheet-close'); await page.waitForTimeout(150);
      ok((await res2()) === '他的頭發很長\n今天天氣很好\n他的頭髮很長', 'choice changes only the tapped line');
      await page.reload(); await page.waitForTimeout(300);
      ok((await res2()) === '他的頭發很長\n今天天氣很好\n他的頭髮很長', 'after reload the identical other line still has the default: ' + JSON.stringify(await res2()));
      // editing right before the spot (within 6 characters) keeps the choice on it
      await page.fill('#src', '今天早上他的头发很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(200);
      ok((await res2()) === '今天早上他的頭發很長\n今天天氣很好\n他的頭髮很長', 'choice kept after adding text just before it: ' + JSON.stringify(await res2()));
      await page.fill('#src', '今天早上他说他的头发真的很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(200);
      ok((await res2()) === '今天早上他說他的頭發真的很長\n今天天氣很好\n他的頭髮很長', 'choice kept after editing on both sides: ' + JSON.stringify(await res2()));
      await page.fill('#src', '新的一行\n今天早上他说他的头发真的很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(200);
      ok((await res2()) === '新的一行\n今天早上他說他的頭發真的很長\n今天天氣很好\n他的頭髮很長', 'choice follows its line when a line is added above');
      await page.reload(); await page.waitForTimeout(300);
      ok((await res2()) === '新的一行\n今天早上他說他的頭發真的很長\n今天天氣很好\n他的頭髮很長', 'choice still on the right spot after edits and reload');
      // deleting the word tells the person instead of dropping the choice silently; putting it back restores it
      await page.fill('#src', '新的一行\n今天早上他说\n今天天气很好\n他的头发很长'); await page.waitForTimeout(250);
      ok(/改選.*暫不套用/.test(await page.textContent('#toast-msg')) && (await res2()) === '新的一行\n今天早上他說\n今天天氣很好\n他的頭髮很長', 'removed spot is reported, the other line keeps the default: ' + (await page.textContent('#toast-msg')));
      await page.fill('#src', '新的一行\n今天早上他说他的头发真的很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(250);
      ok((await res2()) === '新的一行\n今天早上他說他的頭發真的很長\n今天天氣很好\n他的頭髮很長', 'choice comes back when the text comes back');
      const pickToast = () => page.evaluate(() => document.getElementById('toast').classList.contains('on') && /暫不套用/.test(document.getElementById('toast-msg').textContent));
      ok(!(await pickToast()), 'the notice goes away once the choice applies again');
      // a notice about a lost choice never stays next to a choice that applies: switching 台灣用語 off and on takes it away
      await page.fill('#src', '新的一行\n今天早上他说\n今天天气很好\n他的头发很长'); await page.waitForTimeout(250);
      await page.fill('#src', '新的一行\n今天早上他说他的头发真的很长\n今天天气很好\n他的头发很长'); await page.waitForTimeout(100);
      await page.click('label.opt:has(#opt-tw)'); await page.waitForTimeout(250);
      ok(!(await pickToast()) && /頭發/.test(await res2()), '台灣用語 off: the choice applies and no 暫不套用 notice is shown');
      await page.click('label.opt:has(#opt-tw)'); await page.waitForTimeout(250);
      // 對調 twice (簡→繁→簡→繁) brings back the original text with its choice
      const before2 = await res2();
      await page.click('#swap'); await page.waitForTimeout(200);
      await page.click('#swap'); await page.waitForTimeout(200);
      ok((await res2()) === before2 && (await page.inputValue('#src')) === '新的一行\n今天早上他说他的头发真的很长\n今天天气很好\n他的头发很长' && (await page.locator('#out .m.picked').count()) === 1, 'swap twice keeps the original text and the choice: ' + JSON.stringify(await res2()));
      // one-to-one marks are hidden until 一對一 is switched on in the legend
      const oneStyle = () => page.evaluate(() => { const m = document.querySelector('#out .m.one'); const cs = m && getComputedStyle(m); return cs ? cs.textDecorationLine + '|' + cs.backgroundColor : 'none'; });
      ok((await page.getAttribute('#lg-0', 'aria-pressed')) === 'false' && /^none\|rgba\(0, 0, 0, 0\)$/.test(await oneStyle()), 'one-to-one marks hidden by default: ' + (await oneStyle()));
      await page.click('#lg-0'); await page.waitForTimeout(100);
      ok((await page.getAttribute('#lg-0', 'aria-pressed')) === 'true' && /underline/.test(await oneStyle()), 'legend 一對一 shows them: ' + (await oneStyle()));
      { const bb = await page.locator('#lg-0').boundingBox(); ok(bb.height >= 44, 'legend 一對一 switch is at least 44px tall: ' + Math.round(bb.width) + '×' + Math.round(bb.height)); }
      await page.reload(); await page.waitForTimeout(300);
      ok((await page.getAttribute('#lg-0', 'aria-pressed')) === 'true', '一對一 choice remembered');
      await page.click('#lg-0'); await page.waitForTimeout(100);
      // a long system paste (long-press → 貼上) switches to big-file mode
      await page.click('#clear'); await page.waitForTimeout(100);
      const longPaste = ('他的头发很长，公司的发展很快。这个软件的质量很高。\n').repeat(8000);
      await page.evaluate(t => { const s = document.getElementById('src'); s.focus(); s.value = t; s.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste', bubbles: true })); }, longPaste);
      await page.waitForFunction(() => /處變更/.test(document.getElementById('out-meta').textContent), null, { timeout: 60000 });
      const bm = await page.evaluate(() => ({ big: document.body.classList.contains('bigmode'), marks: document.querySelectorAll('#out .m').length, nodes: document.getElementById('out').getElementsByTagName('*').length, len: window.__zc.result().length }));
      ok(bm.big && bm.marks === 0 && bm.nodes < 5000 && bm.len === longPaste.length, 'system paste of ' + longPaste.length + ' characters enters big-file mode: ' + JSON.stringify(bm));
      await page.click('#clear'); await page.waitForTimeout(150);
      await page.fill('#src', '他说头发很长，发现了问题。'); await page.waitForTimeout(150);
      // empty file keeps the text; too-large file explained; CRLF kept on download
      const keep = await page.inputValue('#src');
      await page.setInputFiles('#file', { name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('') });
      await page.waitForTimeout(150);
      ok(/空的檔案/.test(await page.textContent('#toast-msg')) && (await page.inputValue('#src')) === keep, 'empty file explained, text kept');
      await page.setInputFiles('#file', { name: 'huge.txt', mimeType: 'text/plain', buffer: Buffer.alloc(10 * 1024 * 1024 + 10, 0x61) });
      await page.waitForTimeout(150);
      ok(/上限 10 MB/.test(await page.textContent('#toast-msg')), 'file over 10 MB explained');
      await page.setInputFiles('#file', { name: 'win.txt', mimeType: 'text/plain', buffer: Buffer.from('头发\r\n面条\r\n', 'utf8') });
      await page.waitForTimeout(200);
      const [dw] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
      ok(fs.readFileSync(await dw.path(), 'utf8') === '頭髮\r\n麵條\r\n', 'download keeps Windows line breaks');
      // a 1500+ character line is only cut at a safe place: 理发店 after 1499 characters stays one word
      await page.fill('#src', 'he'.repeat(750) + '理发店很好'); await page.waitForTimeout(200);
      ok((await res2()).endsWith('理髮店很好'), 'long line cut does not split 理发店');
      await page.fill('#src', '他'.repeat(1499) + '理发店'); await page.waitForTimeout(250);
      ok((await res2()).endsWith('理髮店'), 'long CJK line without punctuation is not split inside a word');
      // big mode: 1,000,000 characters
      const huge = ('他的头发很长，公司的发展很快。这个软件的质量很高，程序运行得很快。\n').repeat(30000);
      await page.evaluate(t => navigator.clipboard.writeText(t), huge);
      await page.evaluate(() => { window.__lf = 0; let last = performance.now(); (function f() { const n = performance.now(); window.__lf = Math.max(window.__lf, n - last); last = n; requestAnimationFrame(f); })(); });
      await page.click('#paste');
      await page.waitForFunction(() => document.body.classList.contains('bigmode') && /處變更/.test(document.getElementById('out-meta').textContent), null, { timeout: 60000 });
      const lf2 = await page.evaluate(() => window.__lf);
      ok(lf2 < 700 && (await page.evaluate(() => document.body.classList.contains('bigmode'))), `1M characters in big mode, longest frame ${Math.round(lf2)} ms`);
      ok(await page.evaluate(() => window.__zc.result().length) === huge.length && /\.\.\.|……/.test(await page.textContent('#out .more')), 'big mode result complete, display trimmed with a note');
      await page.click('#clear'); await page.waitForTimeout(150);
      ok(!(await page.evaluate(() => document.body.classList.contains('bigmode'))) && !(await page.isEditable('#src')) === false, 'clear leaves big mode');
      // back to a sample state for the cover: reset storage and reload
      await page.evaluate(() => localStorage.clear());
    }
    if (s.name === '375x500') {
      // everything important reachable in the small lobby frame
      const dirBox = await page.locator('#dir-s2t').boundingBox();
      ok(dirBox && dirBox.height >= 44 && dirBox.y >= 0, 'direction buttons at least 44px tall');
      const btns = await page.evaluate(() => [...document.querySelectorAll('button:not(.m)')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.textContent.trim(), r.width, r.height]; }).filter(x => x[1] < 44 || x[2] < 36));
      ok(btns.length === 0, 'no tiny tap targets: ' + JSON.stringify(btns));
    }
    ok(errors.length === 0, `${s.name} no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // cover: 390x520, sample with 台灣用語 on so all three mark styles show
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'light' });
    const page = await ctx.newPage();
    await page.goto(URL);
    await page.waitForTimeout(250);
    await page.click('#opt-tw + .sw');
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${OUT}/cover-390x520.png` });
    ok(fs.existsSync(`${OUT}/cover-390x520.png`), 'cover-390x520.png written');
    await ctx.close();
  }
  await browser.close();
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
