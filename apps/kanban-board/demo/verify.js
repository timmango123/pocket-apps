// 看板待辦 visual + flow check: node verify.js
// Opens the page at the lobby iframe sizes and common phone/desktop sizes in light and dark, asserts no errors and no
// horizontal scroll, walks the main flows and writes screenshots (incl. cover-390x520.png) next to this file.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const OUT = __dirname;
const WRAP = path.join(OUT, '_wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
let n = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); n++; console.log('ok  ' + m); };

(async () => {
  const browser = await chromium.launch();
  const errors = [], requests = [];
  const watch = (p, tag) => {
    p.on('console', m => { if (m.type() === 'error') errors.push(tag + ': ' + m.text()); });
    p.on('pageerror', e => errors.push(tag + ': ' + e.message));
    p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) requests.push(r.url()); });
  };
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [1280, 800]];
  for (const [w, h] of sizes) for (const scheme of ['light', 'dark']) {
    const mobile = w < 1000;
    const ctx = await browser.newContext({viewport:{width:w, height:h}, isMobile:mobile, hasTouch:mobile, deviceScaleFactor:2, colorScheme:scheme});
    const p = await ctx.newPage(); watch(p, `${w}x${h} ${scheme}`);
    const t0 = Date.now();
    await p.goto(URL); await p.waitForSelector('html[data-ready="1"]');
    const load = Date.now() - t0;
    await p.waitForTimeout(250);
    const m = await p.evaluate(() => ({sw:document.documentElement.scrollWidth, iw:innerWidth, sh:document.documentElement.scrollHeight, ih:innerHeight,
      small:[...document.querySelectorAll('button:not([hidden]),[role=button]')].filter(b => { const r = b.getBoundingClientRect(); return r.width && r.height && b.offsetParent && (r.width < 44 || r.height < 44); }).map(b => b.className || b.id)}));
    assert(m.sw <= m.iw && m.sh <= m.ih, `${w}x${h} ${scheme}: no page scroll (${m.sw}x${m.sh} in ${m.iw}x${m.ih}), loaded in ${load} ms`);
    assert(!m.small.length, `${w}x${h} ${scheme}: tap targets >= 44px ${m.small.join(',')}`);
    await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}.png`});
    if (w === 390 && h === 844){
      await p.click('#col0 .card >> nth=0'); await p.waitForTimeout(400);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-card.png`});
      await p.keyboard.press('Escape'); await p.waitForTimeout(350);
      await p.click('#menuBtn'); await p.waitForTimeout(400);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-menu.png`});
      await p.click('#mImport'); await p.waitForTimeout(400);
      await p.fill('#iText', '{"boards": [');
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-import.png`});
      await p.keyboard.press('Escape'); await p.waitForTimeout(350);
      await p.click('#boardBtn'); await p.waitForTimeout(400);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-boards.png`});
      await p.keyboard.press('Escape'); await p.waitForTimeout(350);
      await p.click('#tab1'); await p.waitForTimeout(500);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-doing.png`});
    }
    if (w === 360){
      await p.click('#col0 .card .adv'); await p.waitForTimeout(300);
      const tw = await p.evaluate(() => { const s = document.getElementById('toastMsg').getBoundingClientRect(); return {w:s.width, h:s.height}; });
      assert(tw.w > 120 && tw.h < 60, `360px: toast text uses the width (${Math.round(tw.w)}x${Math.round(tw.h)})`);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-toast.png`});
    }
    if (w === 375 && h === 500){
      await p.click('#col0 [data-add]'); await p.keyboard.type('寄回收押金單'); await p.waitForTimeout(200);
      await p.screenshot({path:`${OUT}/${w}x${h}-${scheme}-compose.png`});
    }
    await ctx.close();
  }

  // cover
  {
    const ctx = await browser.newContext({viewport:{width:390, height:520}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
    const p = await ctx.newPage(); watch(p, 'cover');
    await p.goto(URL); await p.waitForSelector('html[data-ready="1"]');
    await p.evaluate(() => { document.getElementById('sampleBar').hidden = true; });
    await p.waitForTimeout(300);
    await p.screenshot({path:`${OUT}/cover-390x520.png`});
    // a mid-drag frame for review
    const cdp = await ctx.newCDPSession(p);
    const r = await p.locator('#col0 .card >> nth=1').boundingBox();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x, y, id:1}]}); await p.waitForTimeout(420);
    for (let i = 1; i <= 8; i++){ await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:x + i * 4, y:y + i * 14, id:1}]}); await p.waitForTimeout(20); }
    await p.waitForTimeout(250);
    await p.screenshot({path:`${OUT}/drag-390x520.png`});
    assert(await p.evaluate(() => __kb.D.on), 'long-press picks the card up');
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]}); await p.waitForTimeout(400);
    await ctx.close();
  }

  // flows: add, edit, delete+undo, new board, export text, import, refresh persistence
  {
    const ctx = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true});
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const p = await ctx.newPage(); watch(p, 'flow');
    await p.goto(URL); await p.waitForSelector('html[data-ready="1"]');
    const cols = () => p.evaluate(() => __kb.board().cols.map(l => l.map(c => c.title)));
    await p.click('#sampleClear'); await p.waitForTimeout(150);
    assert((await cols()).flat().length === 0 && await p.isVisible('#col0 .composer textarea'), '清空範例 empties the board and opens the composer');
    await p.keyboard.type('寫週報'); await p.keyboard.press('Enter');
    await p.keyboard.type('回覆客戶信'); await p.keyboard.press('Enter');
    assert((await cols())[0].join() === '寫週報,回覆客戶信', 'Enter adds cards in typed order (2 taps per card)');
    await p.click('#col0 .card >> nth=0');
    await p.fill('#dTitle', '寫週報（含數據）');
    await p.click('[data-due="1"]'); await p.click('#dColor [data-color="blue"]');
    await p.fill('#dNote', '第一行\n第二行');
    await p.click('.sheet .sfoot [data-close]'); await p.waitForTimeout(350);
    const c = await p.evaluate(() => __kb.board().cols[0][0]);
    const tomorrow = await p.evaluate(() => __kb.KB.addDays(__kb.KB.ymd(new Date()), 1));
    assert(c.title === '寫週報（含數據）' && c.due === tomorrow && c.color === 'blue' && c.note === '第一行\n第二行', 'sheet edits title, due, colour, note');
    assert((await p.textContent('#col0 .card >> nth=0')).includes('明天到期'), 'card shows 明天到期');
    await p.click('#col0 .card >> nth=1'); await p.click('#dDel'); await p.waitForTimeout(350);
    assert((await cols())[0].length === 1, 'delete removes the card');
    await p.click('#toastAct'); await p.waitForTimeout(150);
    assert((await cols())[0].length === 2, 'toast 復原 restores it');
    await p.click('#col0 .card >> nth=0'); await p.fill('#dTitle', '   '); await p.click('.sheet .sfoot [data-close]'); await p.waitForTimeout(350);
    assert((await cols())[0][0] === '寫週報（含數據）', 'blank title is not saved');
    // new board
    await p.click('#boardBtn'); await p.fill('#bNew', '讀書計畫'); await p.click('#bAdd'); await p.waitForTimeout(350);
    assert(await p.textContent('#bName') === '讀書計畫' && (await p.evaluate(() => __kb.state.boards.length)) === 2, 'new board created and selected');
    await p.keyboard.type('第一章'); await p.keyboard.press('Enter');
    // export text -> import as new boards
    await p.click('#menuBtn'); await p.click('#mCopy'); await p.waitForTimeout(200);
    const txt = await p.inputValue('#mOut');
    const ex = JSON.parse(txt);
    assert(ex.app === 'kanban-board' && ex.boards.length === 2 && ex.boards[1].columns[0].cards[0].title === '第一章', 'export JSON has both boards');
    await p.click('#mImport'); await p.fill('#iText', '{"boards": [');
    assert((await p.textContent('#iPrev')).includes('JSON 格式有誤') && await p.isDisabled('#iGo'), 'broken JSON is explained and blocked');
    await p.fill('#iText', txt);
    assert((await p.textContent('#iPrev')).includes('2 個看板、3 張卡片'), 'import preview counts');
    await p.click('#iGo'); await p.waitForTimeout(350);
    assert((await p.evaluate(() => __kb.state.boards.length)) === 4, 'import adds boards');
    await p.click('#undoBtn'); await p.waitForTimeout(150);
    assert((await p.evaluate(() => __kb.state.boards.length)) === 2, 'import can be undone');
    // theme
    await p.click('#menuBtn'); await p.click('#mTheme [data-t="dark"]'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'manual dark theme');
    await p.reload(); await p.waitForSelector('html[data-ready="1"]');
    assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme persists');
    assert(await p.textContent('#bName') === '讀書計畫' && (await cols())[0][0] === '第一章', 'board and cards persist after reload');
    // corrupt storage does not crash and keeps a copy
    await p.evaluate(k => localStorage.setItem(k, '{broken'), await p.evaluate(() => __kb.KEY));
    await p.reload(); await p.waitForSelector('html[data-ready="1"]');
    const keys = await p.evaluate(() => Object.keys(localStorage).filter(k => k.includes('corrupt')).length);
    assert(keys === 1 && (await p.evaluate(() => __kb.state.boards.length)) === 1, 'corrupt save: backup kept, app starts with sample');
    await ctx.close();
  }
  assert(!errors.length, 'no page/console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  assert(!requests.length, 'no network requests' + (requests.length ? ': ' + requests.join(' ') : ''));
  await browser.close();
  try { fs.unlinkSync(WRAP); } catch (e) {}
  console.log(`verify: ${n} checks passed`);
})().catch(e => { console.log(e.message); try { fs.unlinkSync(WRAP); } catch (_) {} process.exit(1); });
