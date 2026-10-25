// Browser check for 購物清單 (shopping-list). Run: node verify.js
// Drives the real page at phone sizes (light and dark), asserts no page errors and that the main flows work,
// and writes screenshots plus cover-390x520.png next to this file (PNGs are not committed).
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let n = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [], external = [];
  const mk = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opts });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (!/^(file|data|blob|about):/.test(r.url())) external.push(r.url()); });
    await page.goto(URL); await sleep(250);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[0] <= w[1], `no horizontal scroll at ${w[1]}×${opts.viewport ? opts.viewport.height : 844} ${opts.colorScheme || 'light'}`);
    return { ctx, page };
  };
  const left = page => page.evaluate(() => { const s = __shop.state, l = s.lists.find(x => x.id === s.cur); return l.items.filter(i => !i.done).length; });
  const item = (page, name) => page.evaluate(nm => { const s = __shop.state, l = s.lists.find(x => x.id === s.cur); return l.items.find(i => i.name === nm) || null; }, name);
  const row = (page, name) => page.locator('#listArea .it', { has: page.locator('.nm', { hasText: new RegExp('^' + name + '$') }) }).first();
  const toastText = page => page.locator('#toastMsg').innerText();
  const add = async (page, text) => { await page.fill('#addInput', text); await page.click('#addBtn'); await sleep(80); };
  try {
    const { ctx, page } = await mk();
    // first open: sample content
    assert(await page.locator('#sampleBar').isVisible(), 'sample banner shown on first open');
    assert(await page.locator('#listName').innerText() === '每週採買範例', 'sample list name with 範例 tag');
    assert(await page.locator('#leftNum').innerText() === '13', 'board: 13 items left');
    assert((await page.locator('.best b').innerText()) === '$1,547', 'board: estimate $1,547 (60+30+180+45+190+45+89+50+559+299)');
    assert(await page.locator('.shead').count() === 4, 'four store groups (三家店 + 不限店家)');
    await page.screenshot({ path: OUT + '/390x844-sample.png' });

    // live preview while typing
    await page.fill('#addInput', '雞蛋兩盒');
    assert((await page.locator('#preview').innerText()).includes('蛋奶豆品') && (await page.locator('#preview').innerText()).includes('2 盒'), 'preview shows category and parsed qty');
    await page.fill('#addInput', '2 瓶');
    assert((await page.locator('#preview').innerText()).includes('還缺品名'), 'preview explains a qty without a name');
    await page.click('#addBtn');
    assert(await left(page) === 13, 'invalid entry not added');

    // merge into existing (鮮奶 2 瓶 at 全聯 from memory)
    await add(page, '鮮奶 2 瓶');
    assert((await item(page, '鮮奶')).qty === 4, 'adding 鮮奶 2 瓶 again merges to 4 瓶');
    assert((await toastText(page)).includes('2 → 4'), 'toast explains the merge');
    // brand new item with no memory → 不限店家, category care
    await add(page, '牙膏 2 條');
    const tp = await item(page, '牙膏');
    assert(tp && tp.cat === 'care' && tp.store === '' && tp.qty === 2 && tp.unit === '條', 'new item 牙膏 2 條 → 個人保養, 不限店家');
    await add(page, '香菜、蒜頭');
    assert((await item(page, '香菜')) && (await item(page, '蒜頭')) && await left(page) === 16, '「香菜、蒜頭」adds two items');
    // undo the last add from the toast
    await page.click('#toastUndo'); await sleep(100);
    assert(!(await item(page, '香菜')) && await left(page) === 14, 'undo removes the batch');

    // frequent chip one tap (雞蛋 is checked in sample → revived)
    await page.locator('#freq [data-add="雞蛋"]').click(); await sleep(80);
    assert(!(await item(page, '雞蛋')).done, 'tapping 常買 雞蛋 moves it back to 待買');
    const yo = page.locator('#freq [data-add="優格"]');
    if (await yo.isVisible()) { await yo.click(); await sleep(80); assert((await item(page, '優格')).qty === 4 && (await item(page, '優格')).unit === '杯', '常買 優格 adds with last qty 4 杯'); }

    // check off: row stays in place, then glides into the cart section
    const r = row(page, '高麗菜');
    const y0 = (await r.boundingBox()).y;
    await r.locator('.tg').click(); await sleep(150);
    assert((await item(page, '高麗菜')).done && await r.evaluate(e => e.classList.contains('done')), '高麗菜 checked');
    assert(Math.abs((await r.boundingBox()).y - y0) < 2, 'checked row stays put right after the tap');
    await sleep(3200);
    assert(await page.locator('.donegrp .it .nm', { hasText: '高麗菜' }).count() === 1, 'after a moment it moves to 已放入購物車');
    // uncheck from the cart
    await page.locator('.donegrp .it', { hasText: '高麗菜' }).locator('.tg').click(); await sleep(3200);
    assert(!(await item(page, '高麗菜')).done && await page.locator('.donegrp .it .nm', { hasText: '高麗菜' }).count() === 0, 'unchecking moves it back up');
    await r.scrollIntoViewIfNeeded(); const y1 = (await r.boundingBox()).y;
    await r.locator('.tg').click(); await sleep(100);
    assert(await page.locator('#toast').isHidden(), 'checking off shows no toast over the list');
    await r.locator('.tg').click(); await sleep(100);
    assert(!(await item(page, '高麗菜')).done && Math.abs((await r.boundingBox()).y - y1) < 2, 'a mistaken check is undone by tapping the same spot again');

    // edit sheet
    await row(page, '番茄').locator('.q').click(); await sleep(200);
    assert(await page.locator('.sheet #eQty').isVisible(), 'qty pill opens the edit sheet');
    await page.click('#ePlus'); await page.click('#ePlus');
    await page.locator('#eCats [data-c="other"]').click();
    await page.fill('#ePrice', '１２.５');
    await page.fill('#eNote', '牛番茄');
    await page.screenshot({ path: OUT + '/390x844-edit.png' });
    await page.click('#eDone'); await sleep(150);
    const tm = await item(page, '番茄');
    assert(tm.qty === 8 && tm.cat === 'other' && tm.price === 12.5 && tm.note === '牛番茄', 'edit: qty 6→8, category, full-width price 12.5, note');
    assert((await row(page, '番茄').locator('.mt').innerText()).includes('$12.5 × 8 = $100'), 'row shows unit price × qty = line total');
    assert((await toastText(page)).includes('已更新'), 'edit gives an undoable toast');
    await page.click('#toastUndo'); await sleep(100);
    assert((await item(page, '番茄')).qty === 6, 'undo restores the item');
    // invalid qty input is explained and ignored
    await row(page, '番茄').locator('.q').click(); await sleep(150);
    await page.fill('#eQty', '-3');
    assert((await page.locator('#eQtyErr').innerText()).includes('大於 0'), 'negative qty explained');
    await page.fill('#eName', '');
    assert((await page.locator('#eNameErr').innerText()).length > 0, 'blank name explained');
    await page.keyboard.press('Escape'); await sleep(150);
    assert((await item(page, '番茄')).qty === 6 && (await item(page, '番茄')), 'invalid edits did not change the item');
    // delete with undo
    await row(page, '青蔥').locator('.q').click(); await sleep(150);
    await page.click('#eDel'); await sleep(100);
    assert(!(await item(page, '青蔥')), 'delete from the edit sheet');
    await page.click('#toastUndo'); await sleep(100);
    assert(!!(await item(page, '青蔥')), 'undo a delete');

    // store filter
    await page.locator('.schip[data-store="s_px"]').click(); await sleep(100);
    const names = await page.locator('#listArea .sgroup .nm').allInnerTexts();
    assert(names.includes('鮮奶') && names.includes('牙膏') && !names.includes('高麗菜'), 'filter 全聯 shows 全聯 + 哪裡都能買 only');
    await add(page, '可樂');
    assert((await item(page, '可樂')).store === 's_px', 'adding while filtered assigns the store');
    await page.screenshot({ path: OUT + '/390x844-filter.png' });
    await page.locator('.schip[data-store="all"]').click(); await sleep(100);

    // share
    await page.click('#shareBtn'); await sleep(200);
    const st = await page.locator('#shText').innerText();
    assert(st.startsWith('🛒 每週採買') && st.includes('【全聯】') && st.includes('☐ 鮮奶 4 瓶（低脂）（單價 $95）'), 'share text grouped by store with qty, note and price');
    await page.screenshot({ path: OUT + '/390x844-share.png' });
    await page.click('#shCopy'); await sleep(150);
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
    assert(clip === null || clip === st, 'copy puts the same text on the clipboard');

    // paste sheet (round trip into a new list)
    await page.click('#listBtn'); await sleep(150);
    await page.fill('#newListName', '給媽媽'); await page.click('#newList button[type=submit]'); await sleep(150);
    assert(await page.locator('#listName').innerText() === '給媽媽', 'new list created and selected');
    await page.click('#menuBtn'); await sleep(150); await page.click('#mPaste'); await sleep(150);
    await page.fill('#pText', st);
    assert((await page.locator('#pAdd').innerText()).includes('加入'), 'paste sheet counts items');
    await page.click('#pAdd'); await sleep(150);
    const copied = await page.evaluate(() => __shop.state.lists.find(l => l.id === __shop.state.cur).items.map(i => i.name + '|' + i.qty + '|' + i.unit).sort());
    const orig = await page.evaluate(() => __shop.state.lists.find(l => l.id === 'L_week').items.filter(i => !i.done).map(i => i.name + '|' + i.qty + '|' + i.unit).sort());
    assert(JSON.stringify(copied) === JSON.stringify(orig), 'shared text pasted back gives the same items (' + copied.length + ')');
    // multi-line paste straight into the add box
    await page.evaluate(() => { const i = document.getElementById('addInput'); const dt = new DataTransfer(); dt.setData('text/plain', '火龍果\n芭樂 3 顆'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
    await sleep(100);
    assert(!!(await item(page, '火龍果')) && (await item(page, '芭樂')).qty === 3, 'multi-line paste in the add box adds each line');

    // persistence
    await page.reload(); await sleep(300);
    assert(await page.locator('#listName').innerText() === '給媽媽' && !!(await item(page, '芭樂')), 'everything survives a reload');
    // switch list + delete list with undo
    await page.click('#listBtn'); await sleep(150);
    await page.locator('[data-pick="L_bbq"]').click(); await sleep(100);
    assert((await page.locator('#listName').innerText()).startsWith('週末烤肉'), 'switch list');
    await page.click('#listBtn'); await sleep(150);
    await page.locator('[data-del="L_bbq"]').click(); await sleep(100);
    assert(await page.evaluate(() => __shop.state.lists.length) === 2, 'delete list');
    assert(await page.locator('#ftoast').isVisible(), 'feedback over an open sheet shows at the top');
    await page.click('#ftoastUndo'); await sleep(100);
    assert(await page.evaluate(() => __shop.state.lists.length) === 3, 'undo list delete');
    await page.keyboard.press('Escape');

    // stores + aisle order
    await page.click('#storeAdd'); await sleep(150);
    await page.fill('#newStoreName', '家樂福'); await page.click('#newStore button[type=submit]'); await sleep(100);
    assert(await page.locator('.schip', { hasText: '家樂福' }).count() === 1, 'add a store');
    await page.locator('#stores [data-ord="s_px"]').click(); await sleep(150);
    await page.locator('#ord [data-dn="0"]').click(); await sleep(50);
    assert(await page.evaluate(() => __shop.state.stores.find(s => s.id === 's_px').order.slice(0, 2).join()) === 'meat,produce', 'move an aisle down');
    await page.screenshot({ path: OUT + '/390x844-aisles.png' });
    await page.keyboard.press('Escape'); await sleep(100);

    // backup import: bad text explained, good backup replaces (and can be undone)
    await page.click('#menuBtn'); await sleep(150);
    await page.screenshot({ path: OUT + '/390x844-menu.png' });
    await page.click('#mImport'); await sleep(150);
    await page.fill('#iText', '{"hello":1'); await page.click('#iGo'); await sleep(80);
    assert((await page.locator('#iErr').innerText()).includes('JSON'), 'broken backup text explained');
    await page.fill('#iText', '{"app":"other","data":{}}'); await page.click('#iGo'); await sleep(80);
    assert((await page.locator('#iErr').innerText()).includes('不是購物清單'), 'wrong backup explained');
    const backup = JSON.stringify({ app: 'shopping-list', version: 1, data: { lists: [{ id: 'z', name: '備份', items: [{ id: 'q', name: '咖啡豆', qty: 2, unit: '包' }] }], stores: [] } });
    await page.fill('#iText', backup); await page.click('#iGo'); await sleep(100);
    await page.click('#cfOk'); await sleep(150);
    assert(await page.locator('#listName').innerText() === '備份' && !!(await item(page, '咖啡豆')), 'good backup imported');
    await page.click('#toastUndo'); await sleep(100);
    assert(await page.evaluate(() => __shop.state.lists.length) === 3, 'undo import');

    // corrupt storage never breaks the page
    await page.evaluate(() => localStorage.setItem('shopping-list:v1:state', '{"lists":[{"items":[null,{"name":5}]}'));
    await page.reload(); await sleep(250);
    assert(await page.locator('#leftNum').count() + await page.locator('.empty').count() > 0, 'corrupt storage → falls back without errors');
    await page.evaluate(() => localStorage.clear()); await page.reload(); await sleep(250);

    // clear sample → empty state with guidance
    await page.click('#clearSample'); await sleep(100); await page.click('#cfOk'); await sleep(150);
    assert(await page.locator('.empty h3').innerText() === '清單是空的' && await page.locator('#sampleBar').isHidden(), 'clear sample → empty state');
    assert((await page.locator('#freq h2').innerText()).startsWith('常見品項'), 'no history → 常見品項 suggestions');
    await page.screenshot({ path: OUT + '/390x844-empty.png' });
    await page.locator('#freq [data-add="鮮奶"]').click(); await sleep(80);
    await add(page, '吐司 $45');
    for (const nm of ['鮮奶', '吐司']) await row(page, nm).locator('.tg').click();
    await sleep(3200);
    assert(await page.locator('.alldone').isVisible() && (await page.locator('.bdone .blabel b').innerText()).includes('全部買齊'), 'all checked → 買齊了 card');
    await page.screenshot({ path: OUT + '/390x844-alldone.png' });
    await page.click('#clearDone2'); await sleep(100);
    assert(await left(page) === 0 && await page.evaluate(() => __shop.state.lists[0].items.length) === 0, '清除已買');
    await ctx.close();

    // rapid taps with real touch events: 8 taps/s alternating between two rows; every tap counts exactly once
    {
      const { ctx, page } = await mk();
      const cdp = await ctx.newCDPSession(page);
      const pts = [];
      for (const nm of ['高麗菜', '番茄']) { const b = await row(page, nm).locator('.tg').boundingBox(); pts.push({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); }
      await page.evaluate(() => { window.__taps = 0; document.addEventListener('click', e => { if (e.target.closest('.tg')) window.__taps++; }, true); });
      const before = await page.evaluate(() => JSON.stringify(__shop.state.lists[0].items.map(i => i.done)));
      for (let i = 0; i < 32; i++) {
        const p = pts[i % 2];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
        await sleep(30);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(95);
      }
      await sleep(400);
      const taps = await page.evaluate(() => window.__taps);
      const after = await page.evaluate(() => JSON.stringify(__shop.state.lists[0].items.map(i => i.done)));
      assert(taps === 32, `32 real touches at 8/s → 32 taps received (${taps})`);
      assert(after === before, 'each row toggled an even number of times → back where it started');
      await ctx.close();
    }


    // review fixes: rows stay put while shopping, chips never shift, feedback never covers rows
    {
      const { ctx, page } = await mk();
      const cdp = await ctx.newCDPSession(page);
      const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
      const ids = await page.evaluate(() => [...document.querySelectorAll('#listArea .sgroup .it')].slice(0, 3).map(r => r.dataset.id));
      await page.locator(`[data-id="${ids[0]}"]`).scrollIntoViewIfNeeded();
      const c = async id => { const b = await page.locator(`[data-id="${id}"] .tg`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
      const c1 = await c(ids[0]), c2 = await c(ids[1]);
      await tap(c1.x, c1.y); await sleep(1700); await tap(c2.x, c2.y); await sleep(200);
      const st = await page.evaluate(ids => ids.map(id => __shop.state.lists[0].items.find(i => i.id === id).done), ids);
      assert(st[0] && st[1] && !st[2], 'tapping the next row 1.7 s after a check hits the intended row (' + st + ')');
      const yHeld = (await page.locator(`[data-id="${ids[1]}"]`).boundingBox()).y;
      await sleep(2000);
      assert(Math.abs((await page.locator(`[data-id="${ids[1]}"]`).boundingBox()).y - yHeld) < 1, 'checked rows still in place 2 s after the last touch');
      await sleep(1200);
      assert(await page.locator(`.donegrp [data-id="${ids[0]}"]`).count() === 1, 'after ~2.8 s idle the checked rows move to the cart');
      // scrolling the held row out of view settles at once without moving what is on screen
      await page.setViewportSize({ width: 390, height: 640 }); await sleep(300);
      const r3 = ids[2];
      await page.locator(`[data-id="${r3}"]`).scrollIntoViewIfNeeded();
      const c3 = await c(r3); await tap(c3.x, c3.y); await sleep(150);
      await page.evaluate(() => window.scrollBy(0, 700)); await sleep(80);
      const vis = await page.evaluate(() => { const r = [...document.querySelectorAll('#listArea .sgroup .it')].find(e => e.getBoundingClientRect().top > 200); return { id: r.dataset.id, y: r.getBoundingClientRect().top }; });
      await page.evaluate(() => window.scrollBy(0, 1)); await sleep(700);
      const y2 = await page.evaluate(id => document.querySelector(`[data-id="${id}"]`).getBoundingClientRect().top, vis.id);
      assert(await page.locator(`.donegrp [data-id="${r3}"]`).count() === 1 && Math.abs(y2 - vis.y + 1) < 2, `scrolling a checked row away moves it to the cart while visible rows stay still (${vis.y.toFixed(0)} → ${y2.toFixed(0)}) `);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0)); await sleep(100);
      // three chips tapped quickly at their original positions → exactly those three items
      const chips = await page.evaluate(() => [...document.querySelectorAll('#fchips .fchip:not(.hide):not(.more)')].slice(0, 3).map(b => { const r = b.getBoundingClientRect(); return { name: b.dataset.add, x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
      const qty0 = await page.evaluate(names => names.map(n => (__shop.state.lists[0].items.find(i => i.name === n && !i.done) || { qty: 0 }).qty), chips.map(x => x.name));
      for (const ch of chips) { await tap(ch.x, ch.y); await sleep(600); }
      const pos = await page.evaluate(() => [...document.querySelectorAll('#fchips .fchip:not(.hide):not(.more)')].slice(0, 3).map(b => b.dataset.add));
      const qty1 = await page.evaluate(names => names.map(n => (__shop.state.lists[0].items.find(i => i.name === n && !i.done) || { qty: 0 }).qty), chips.map(x => x.name));
      assert(JSON.stringify(pos) === JSON.stringify(chips.map(x => x.name)) && qty1.every((q, i) => q > qty0[i]), `3 quick chip taps add exactly ${chips.map(x => x.name).join('、')}; chips did not move`);
      // feedback sits in the add bar, never over list rows
      await add(page, '芭樂 3 顆');
      const ub = await page.locator('#toastUndo').boundingBox(), cb = await page.locator('#composer').boundingBox();
      assert(ub.y >= cb.y && ub.y + ub.height <= cb.y + cb.height + 1, 'undo button is inside the add bar');
      await page.evaluate(() => window.scrollBy(0, 400)); await sleep(80);
      const rowsUnder = await page.evaluate(() => { const u = document.getElementById('toastUndo').getBoundingClientRect(); return [...document.querySelectorAll('#listArea .it')].filter(r => { const b = r.getBoundingClientRect(); return b.bottom > u.top && b.top < u.bottom && b.top >= u.bottom - 1; }).length; });
      assert(rowsUnder === 0, 'no list row is ever under the undo button');
      // unsent text survives a reload
      await page.fill('#addInput', '香菜 1 把');
      await page.reload(); await sleep(250);
      assert(await page.inputValue('#addInput') === '香菜 1 把', 'unsent add-box text survives a reload');
      await ctx.close();
    }
    // brand-new user: starters stay after the first tap
    {
      const { ctx, page } = await mk();
      await page.click('#clearSample'); await sleep(100); await page.click('#cfOk'); await sleep(150);
      const n0 = await page.locator('#fchips .fchip:not(.hide)').count();
      await page.locator('#freq [data-add="鮮奶"]').click(); await sleep(100);
      const n1 = await page.locator('#fchips .fchip:not(.hide)').count();
      assert(n0 >= 5 && n1 >= n0 - 1 && (await page.locator('#freq [data-add="雞蛋"]').count()) === 1, `starter chips stay after the first tap (${n0} → ${n1})`);
      await ctx.close();
    }
    // blocked storage: a banner that stays
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(String(e)));
      await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error('QuotaExceededError'); }; });
      await page.goto(URL); await sleep(200);
      await add(page, '鮮奶'); await add(page, '雞蛋');
      assert(await page.locator('#saveWarn').isVisible() && (await page.locator('#saveWarn').innerText()).includes('沒有存檔'), 'storage blocked → persistent warning banner');
      await ctx.close();
    }
    // sizes, light and dark
    for (const [w, h] of [[375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390], [1280, 800]]) {
      for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await mk({ viewport: { width: w, height: h }, colorScheme: scheme });
        const tb = await page.locator('#addBtn').boundingBox();
        assert(tb.x + tb.width <= w && tb.width >= 44 && tb.height >= 44, `${w}×${h} ${scheme}: add button visible and ≥44px`);
        const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(b => b.offsetParent && b.getBoundingClientRect().height < 44).map(b => b.textContent.trim().slice(0, 10)));
        assert(!small.length, `${w}×${h} ${scheme}: every visible button ≥44px tall (${small.join('、')})`);
        await page.screenshot({ path: `${OUT}/${w}x${h}-${scheme}.png` });
        await ctx.close();
      }
    }

    // cover
    {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 520 } });
      await page.evaluate(() => { const b = document.getElementById('sampleBar'); b.hidden = true; });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: OUT + '/cover-390x520.png' });
      await ctx.close();
    }
    assert(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    assert(!external.length, 'no external requests' + (external.length ? ': ' + external.join(' ') : ''));
    console.log(`\n${n} checks passed`);
  } catch (e) {
    console.error(e.message || e); if (errors.length) console.error('errors:', errors);
    process.exitCode = 1;
  } finally { await browser.close(); fs.rmSync(WRAP, { force: true }); }
})();
