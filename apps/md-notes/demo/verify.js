// Playwright verification for md-notes. Run: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
// The artifact host wraps the page in a document with a viewport meta; reproduce that for testing.
const WRAP = path.resolve(__dirname, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const OUT = __dirname;
const errors = [];
const assert = (c, m) => { if (!c) { errors.push('ASSERT: ' + m); console.log('FAIL', m); } else console.log('ok  ', m); };

(async () => {
  const browser = await chromium.launch();
  const sizes = [
    { name: '390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '360x780', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: '844x390', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    { name: 'dark-390x844', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' },
    { name: 'desktop-1280x800', viewport: { width: 1280, height: 800 } },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext(s);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(s.name + ' console: ' + m.text()); });
    page.on('pageerror', e => errors.push(s.name + ' pageerror: ' + e.message));
    page.on('dialog', d => { errors.push('dialog opened: ' + d.message()); d.dismiss(); });
    await page.goto(URL);
    await page.waitForFunction(() => window.__mdReady);
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(sw[0] <= sw[1], `${s.name} no horizontal scroll (${sw[0]}<=${sw[1]})`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.name === '390x844') {
      await page.click('#tabPrev');
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}/${s.name}-preview.png` });
      await page.click('#menuDrawerBtn'); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/${s.name}-drawer.png` });
      await page.click('#scrim', { position: { x: 370, y: 400 } });
      await page.click('#moreBtn'); await page.waitForTimeout(100);
      await page.screenshot({ path: `${OUT}/${s.name}-menu.png` });
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  }

  // ---- functional flow ----
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('flow pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('flow console: ' + m.text()); });
  page.on('dialog', d => { errors.push('dialog opened: ' + d.message()); d.dismiss(); });
  await page.goto(URL); await page.waitForFunction(() => window.__mdReady);

  // new note
  await page.click('#menuDrawerBtn'); await page.waitForTimeout(250);
  await page.click('#newBtn'); await page.waitForTimeout(150);
  assert(await page.inputValue('#editor') === '', 'new note is empty');
  await page.focus('#editor');
  await page.keyboard.type('# 購物清單\n\n- 牛奶');
  await page.keyboard.press('Enter');
  await page.keyboard.type('雞蛋');
  let v = await page.inputValue('#editor');
  assert(v === '# 購物清單\n\n- 牛奶\n- 雞蛋', 'Enter continues list: ' + JSON.stringify(v));
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  v = await page.inputValue('#editor');
  assert(v === '# 購物清單\n\n- 牛奶\n- 雞蛋\n', 'Enter on empty item ends list: ' + JSON.stringify(v));
  // task via toolbar
  await page.click('[data-act="task"]');
  await page.keyboard.type('買咖啡豆');
  // bold toolbar on selection
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await page.keyboard.type('重要');
  await page.keyboard.down('Shift'); for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowLeft'); await page.keyboard.up('Shift');
  await page.click('[data-act="bold"]');
  v = await page.inputValue('#editor');
  assert(v.endsWith('- [ ] 買咖啡豆\n**重要**'), 'task + bold wrap: ' + JSON.stringify(v));
  // undo
  await page.click('[data-act="undo"]');
  v = await page.inputValue('#editor');
  assert(v.endsWith('\n重要'), 'undo removes bold: ' + JSON.stringify(v.slice(-12)));
  await page.click('[data-act="redo"]');
  assert((await page.inputValue('#editor')).endsWith('**重要**'), 'redo restores bold');
  // XSS payloads
  await page.evaluate(() => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(e.value.length, e.value.length); });
  await page.keyboard.type('\n\n<img src=x onerror="window.__xss=1">\n\n[點我](javascript:window.__xss=2)\n\n<script>window.__xss=3</script>\n');
  await page.click('#tabPrev'); await page.waitForTimeout(300);
  const prev = await page.evaluate(() => ({ html: document.getElementById('mdOut').innerHTML, imgs: document.querySelectorAll('#mdOut img').length, scripts: document.querySelectorAll('#mdOut script').length, js: document.querySelectorAll('#mdOut a[href^="javascript" i]').length, xss: window.__xss }));
  assert(prev.imgs === 0 && prev.scripts === 0 && prev.js === 0 && prev.xss === undefined, 'XSS payloads inert: ' + JSON.stringify({ i: prev.imgs, s: prev.scripts, j: prev.js, x: prev.xss }));
  assert(prev.html.includes('<h1') && prev.html.includes('<strong>重要</strong>'), 'preview renders heading & bold');
  // checkbox writes back
  await page.click('#mdOut input[type=checkbox]');
  await page.waitForTimeout(100);
  v = await page.inputValue('#editor');
  assert(v.includes('- [x] 買咖啡豆'), 'checkbox toggle writes back to source');
  await page.screenshot({ path: `${OUT}/flow-preview.png` });
  // counts
  const st = await page.textContent('#stCount');
  assert(/中文 \d+/.test(st), 'word count shown: ' + st);
  // persistence after reload
  await page.waitForTimeout(700);
  await page.reload(); await page.waitForFunction(() => window.__mdReady);
  v = await page.inputValue('#editor');
  assert(v.includes('- [x] 買咖啡豆'), 'content persists after reload');
  assert((await page.textContent('#titleBtn')) === '購物清單', 'title derived from first line');
  // rename
  await page.click('#titleBtn'); await page.fill('#titleInput', '週末採買'); await page.keyboard.press('Enter');
  assert((await page.textContent('#titleBtn')) === '週末採買', 'rename works');
  // search
  await page.click('#menuDrawerBtn'); await page.waitForTimeout(250);
  await page.fill('#searchInput', '咖啡豆');
  let items = await page.$$eval('#noteList .it', els => els.map(e => e.textContent));
  assert(items.length === 1 && items[0] === '週末採買', 'search finds note: ' + JSON.stringify(items));
  await page.fill('#searchInput', '');
  // tag filter (sample has #範例)
  await page.click('.chip');
  items = await page.$$eval('#noteList .it', els => els.map(e => e.textContent));
  assert(items.length === 1 && items[0].startsWith('範例'), 'tag filter: ' + JSON.stringify(items));
  await page.click('.chip');
  // delete via swipe button then undo toast
  const before = await page.$$eval('#noteList .item', e => e.length);
  await page.evaluate(() => document.querySelector('#noteList .item .del').click());
  await page.waitForTimeout(150);
  const after = await page.$$eval('#noteList .item', e => e.length);
  assert(after === before - 1, 'delete removes note');
  await page.click('.toast button'); await page.waitForTimeout(150);
  assert((await page.$$eval('#noteList .item', e => e.length)) === before, 'undo delete restores note');
  await page.click('#scrim', { position: { x: 370, y: 400 } });
  // export fallback (no downloads capability in file://) -> copy dialog
  await page.click('#moreBtn'); await page.click('[data-m="html"]'); await page.waitForTimeout(300);
  const exp = await page.inputValue('#copyArea');
  assert(exp.startsWith('<!doctype html>') && exp.includes('<title>' + (await page.textContent('#titleBtn')) + '</title>') && !exp.includes('data-line'), 'html export standalone: ' + exp.slice(0, 300).replace(/\n/g, ' '));
  assert(!/<script/i.test(exp.replace(/&lt;script/g, '')), 'html export contains no script');
  await page.click('#cdClose');
  // empty note auto cleanup
  await page.click('#menuDrawerBtn'); await page.waitForTimeout(250);
  const n0 = await page.$$eval('#noteList .item', e => e.length);
  await page.click('#newBtn'); await page.waitForTimeout(100);
  await page.click('#menuDrawerBtn'); await page.waitForTimeout(250);
  await page.click('#noteList .item:not(.cur) .open');
  await page.click('#menuDrawerBtn'); await page.waitForTimeout(250);
  assert((await page.$$eval('#noteList .item', e => e.length)) === n0, 'empty note removed when leaving');
  await ctx.close();

  // ---- desktop sync scroll ----
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const dp = await dctx.newPage();
  dp.on('pageerror', e => errors.push('desk pageerror: ' + e.message));
  await dp.goto(URL); await dp.waitForFunction(() => window.__mdReady);
  await dp.evaluate(() => { const e = document.getElementById('editor'); let t = ''; for (let i = 1; i <= 40; i++) t += `## 段落 ${i}\n\n` + '這是一段用來測試同步捲動的文字。'.repeat(4) + '\n\n'; e.value = t; e.dispatchEvent(new Event('input')); });
  await dp.waitForTimeout(400);
  await dp.evaluate(() => { const e = document.getElementById('editor'); e.scrollTop = e.scrollHeight / 2; });
  await dp.waitForTimeout(300);
  const sync = await dp.evaluate(() => { const p = document.getElementById('preview'); const hs = [...document.querySelectorAll('#mdOut h2')]; const top = p.getBoundingClientRect().top; const vis = hs.find(h => h.getBoundingClientRect().bottom > top); return { st: p.scrollTop, vis: vis && vis.textContent }; });
  assert(sync.st > 100 && /段落 (1[5-9]|2[0-6])/.test(sync.vis), 'desktop sync scroll aligns preview: ' + JSON.stringify(sync));
  await dctx.close();

  await browser.close();
  console.log('\nerrors:', errors.length ? errors : 'none');
  process.exit(errors.length ? 1 : 0);
})();
