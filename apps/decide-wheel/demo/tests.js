// 隨機決定器：上架評分 toFix 的回歸測試（node tests.js，約 40 秒）。只等條件，不用畫面時間算數值。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const WRAP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'decide-wheel-')), 'index.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>');
const URL = 'file://' + WRAP;
const NS = 'decide-wheel:v1:';
let fails = 0;
const assert = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const errors = [];
const T = { timeout: 15000 };

(async () => {
  const browser = await chromium.launch();
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
      colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.motion ? 'no-preference' : 'reduce' });
    if (o.init) await ctx.addInitScript(o.init);
    const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(e.message));
    await p.goto(URL); await p.waitForFunction(() => window.__dw, null, T);
    const cdp = await ctx.newCDPSession(p);
    const tp = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    const c = async sel => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, w: r.width, h: r.height }; }, sel);
    const tap = async sel => { const q = await c(sel); await tp('touchStart', q.x, q.y); await tp('touchEnd'); };
    return { ctx, p, tp, c, tap, cdp };
  }
  const txt = (p, s) => p.evaluate(s => document.querySelector(s).textContent.trim(), s);
  const hist = p => p.evaluate(k => JSON.parse(localStorage.getItem(k + 'history') || '[]').length, NS);
  const reload = async p => { await p.reload(); await p.waitForFunction(() => window.__dw, null, T); };

  // 1. 骰子 3D 方塊不擋住下方控制項（各尺寸 1–6 顆，擲完檢查命中），真觸控「+」「擲骰子」每次都生效
  for (const [w, h] of [[360, 640], [390, 844], [430, 932]]) {
    // reduced motion: cubes jump straight to their final 3D pose (same geometry as after the 1s transition)
    const { ctx, p } = await open({ w, h });
    await p.click('#mode-dice');
    let bad = [];
    for (let k = 0; k < 12; k++) {
      const n = 1 + k % 6;
      await p.evaluate(n => { const $ = id => document.getElementById(id); while (+$('dc-count').textContent < n) $('dc-plus').click(); while (+$('dc-count').textContent > n) $('dc-minus').click(); }, n);
      await p.click('#roll'); await p.waitForFunction(() => !document.getElementById('roll').disabled, null, T);
      bad = bad.concat(await p.evaluate(n => [...document.querySelectorAll('#dice-ctl button, #dice-ctl input, .actions button, .seg button, #roll')].filter(b => {
        if (!b.offsetParent) return false; const q = b.getBoundingClientRect(); if (q.top < 0 || q.bottom > innerHeight) return false;
        const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return !(e === b || b.contains(e) || (e && e.closest('label') && e.closest('label').contains(b)));
      }).map(b => n + ':' + b.id), n));
    }
    assert(bad.length === 0, `${w}x${h} 擲 1–6 顆 d6（各 2 次）後控制項中心都點得到自己 ${bad.join(',')}`);
    await ctx.close();
  }
  {
    const { ctx, p, tap } = await open();
    await p.click('#mode-dice'); await p.click('#dc-plus'); await p.click('#roll');
    await p.waitForFunction(() => !document.getElementById('roll').disabled, null, T);
    await p.evaluate(() => document.getElementById('dc-minus').click()); // 2 dice
    for (let i = 0; i < 4; i++) { await tap('#dc-plus'); await p.waitForFunction(n => +document.getElementById('dc-count').textContent === n, 3 + i > 6 ? 6 : 3 + i, T).catch(() => {}); }
    assert(await txt(p, '#dc-count') === '6', `真觸控「+」4 次：2 → ${await txt(p, '#dc-count')}（應為 6）`);
    let started = 0;
    for (let k = 0; k < 4; k++) {
      const h0 = await hist(p); await tap('#roll');
      started += await p.waitForFunction(h0 => JSON.parse(localStorage.getItem('decide-wheel:v1:history') || '[]').length > h0, h0, T).then(() => 1, () => 0);
      await p.waitForFunction(() => !document.getElementById('roll').disabled, null, T);
    }
    assert(started === 4, `6 顆骰子擲完後真觸控「擲骰子」4 次都開始擲（${started}/4）`);
    // 每秒 8 次交替「+」(顆數) 與修正值「+」
    await p.evaluate(() => { const $ = id => document.getElementById(id); while (+$('dc-count').textContent > 1) $('dc-minus').click(); if (!$('mod-on').checked) $('mod-on').click(); });
    for (let i = 0; i < 8; i++) { await tap(i % 2 ? '#mod-plus' : '#dc-plus'); await p.waitForTimeout(125); }
    assert(await txt(p, '#dc-count') === '5' && await txt(p, '#mod-val') === '+4', `每秒 8 次交替：顆數 ${await txt(p, '#dc-count')}（5）、修正 ${await txt(p, '#mod-val')}（+4）`);
    await ctx.close();
  }

  // 2. 抽籤往上滑抽一張；點一次抽一張；滑出牌堆也算；不會一次抽 2 張
  {
    const { ctx, p, tp, c, tap } = await open();
    await p.click('#mode-deck');
    const left = async () => +(await txt(p, '#deck-left'));
    const n0 = await left();
    const swipe = async (dy) => { const q = await c('#deck'); await tp('touchStart', q.x, q.y + 40); for (let k = 1; k <= 6; k++) await tp('touchMove', q.x, q.y + 40 - dy * k / 6); await tp('touchEnd'); };
    await swipe(120); await p.waitForTimeout(400);
    assert(await left() === n0 - 1, `往上滑 120px 抽 1 張（${n0} → ${await left()}）`);
    await tap('#deck'); await p.waitForTimeout(400);
    assert(await left() === n0 - 2, `點 1 次抽 1 張（→ ${await left()}）`);
    const q = await c('#deck'); await swipe(q.h / 2 + 120); await p.waitForTimeout(400);
    assert(await left() === n0 - 3, `往上滑出牌堆也抽 1 張（→ ${await left()}）`);
    await swipe(120); await tap('#deck'); await p.waitForTimeout(400);
    assert(await left() === n0 - 5, `上滑後立刻再點：共 2 張，不吞也不重複（→ ${await left()}）`);
    for (let i = 0; i < 3; i++) { await tap('#deck'); await p.waitForTimeout(125); }
    await p.waitForTimeout(300);
    assert(await left() === n0 - 8 || (n0 - 8 < 0 && await left() === 0), `每秒 8 次連點 3 下抽 3 張（→ ${await left()}）`);
    await p.click('#reshuffle'); const m0 = await left();
    const q2 = await c('#deck'); await p.mouse.click(q2.x, q2.y); await p.waitForTimeout(300);
    assert(await left() === m0 - 1, `滑鼠點一下只抽 1 張（${m0} → ${await left()}）`);
    await p.focus('#deck'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    assert(await left() === m0 - 2, `鍵盤 Enter 抽 1 張（→ ${await left()}）`);
    await ctx.close();
  }

  // 3. emoji 選項與清單名稱用字元數截斷，重新整理後完全一樣；4./5. 快速重新整理也保存
  {
    const { ctx, p } = await open();
    const e20 = Array.from({ length: 20 }, (_, i) => String.fromCodePoint(0x1F600 + i)).join('');
    const a29 = 'a' + Array.from({ length: 29 }, (_, i) => String.fromCodePoint(0x1F680 + i)).join('');
    const e40 = Array.from({ length: 40 }, (_, i) => String.fromCodePoint(0x1F330 + i)).join('');
    await p.click('#edit-btn');
    await p.click('#paste-toggle'); await p.fill('#paste-text', e20 + '\n' + a29); await p.click('#paste-add');
    await p.fill('#item-0', e40);
    const v0 = await p.inputValue('#item-0');
    assert(Array.from(v0).length === 30 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(v0), `輸入 40 個 emoji 截到 30 個字元、沒有半個字（${Array.from(v0).length}）`);
    await p.fill('#list-name', '🍣'.repeat(25));
    await reload(p); // no wait: pending 300ms save must be flushed on pagehide
    const items = await p.evaluate(k => JSON.parse(localStorage.getItem(k + 'lists'))[0], NS);
    const texts = items.items.map(i => i.text);
    assert(texts.includes(e20) && texts.includes(a29), '20 個 emoji 與 a+29 emoji 重新整理後完全一樣');
    assert(texts[0] === v0, '截斷後的第一項重新整理後不變');
    assert(items.name === '🍣'.repeat(20), `清單名稱以 20 字元截斷（${Array.from(items.name).length}）`);
    await p.click('#edit-btn'); await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'ed-close', null, T);
    await p.fill('#item-1', '鍋貼'); await p.keyboard.type('x');
    await reload(p);
    assert(await p.evaluate(k => JSON.parse(localStorage.getItem(k + 'lists'))[0].items[1].text, NS) === '鍋貼x', '打字後立刻重新整理，最後一個字也保存');
    await ctx.close();
  }

  // 4. 抽籤進度與轉盤淘汰重新整理後還在；1. 淘汰不帶進抽籤
  {
    const { ctx, p } = await open();
    await p.click('#spin'); await p.click('#remove');
    assert(await p.isVisible('#restore'), '轉盤淘汰 1 項，出現還原清單');
    await p.click('#mode-deck');
    assert(await txt(p, '#deck-left') === '8', `淘汰不帶進抽籤：牌堆 ${await txt(p, '#deck-left')} 張（8）`);
    for (let i = 0; i < 3; i++) await p.click('#deck');
    const card = await txt(p, '#card-text');
    await reload(p);
    assert(await txt(p, '#deck-left') === '5' && await txt(p, '#card-text') === card && await p.isVisible('#card'), `重新整理後抽籤進度還在（剩 ${await txt(p, '#deck-left')}，最後一張 ${card}）`);
    await p.click('#mode-wheel');
    assert(await p.isVisible('#restore') && /已淘汰 1 項/.test(await txt(p, '#res-detail')), '回到轉盤，淘汰狀態還在且有說明');
    await reload(p);
    assert(await p.isVisible('#restore'), '重新整理後轉盤淘汰狀態還在');
    // 9. 重新洗牌只出現在抽籤
    await p.click('#mode-deck'); assert(await p.isVisible('#reshuffle'), '抽籤有重新洗牌');
    await p.click('#mode-wheel'); assert(!(await p.isVisible('#reshuffle')), '轉盤沒有重新洗牌');
    await p.click('#mode-dice'); assert(!(await p.isVisible('#reshuffle')), '擲骰沒有重新洗牌');
    await ctx.close();
  }

  // 6. 刪除選項可復原；清空選項可復原；新增空白清單；複製含權重、貼上解析權重
  {
    const { ctx, p } = await open();
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await p.selectOption('#list-select', 'pay');
    await p.click('#edit-btn');
    assert(await p.evaluate(() => !document.activeElement || document.activeElement.tagName !== 'INPUT'), '開編輯面板不會自動聚焦輸入框（不彈鍵盤）');
    const snap = await p.evaluate(() => [...document.querySelectorAll('#items input')].map(i => i.value));
    await p.click('#item-3-del');
    assert(await p.isVisible('#undo') && /我自己/.test(await txt(p, '#undo-msg')), `刪除後出現「${await txt(p, '#undo-msg')}・復原」`);
    await p.click('#undo-btn');
    const after = await p.evaluate(() => [...document.querySelectorAll('#items input')].map(i => i.value));
    assert(JSON.stringify(after) === JSON.stringify(snap), '按復原後選項回到原位');
    const w = await p.evaluate(() => document.querySelector('[data-i="3"] .stepper output').textContent);
    assert(w === '2', `復原保留權重（${w}）`);
    await p.click('#clear-items');
    assert(await p.locator('#items .item').count() === 0 && await p.isVisible('.items-empty'), '清空選項後顯示空白引導');
    await p.click('#undo-btn');
    assert(await p.locator('#items .item').count() === 4, '清空可復原');
    await p.click('#copy-list');
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null) || await p.inputValue('#paste-text');
    assert(clip === '小明\n阿華\n佳佳\n我自己*2', `複製清單文字含權重：${JSON.stringify(clip)}`);
    await p.click('#new-list');
    const nl = await p.evaluate(k => { const l = JSON.parse(localStorage.getItem(k + 'lists')); return l[l.length - 1]; }, NS);
    assert(nl.name === '新清單' && nl.items.length === 2 && await p.evaluate(() => document.activeElement.id) === 'item-0', '新增空白清單：2 個空白欄位、聚焦第一欄');
    if (!(await p.isVisible('#paste-box'))) await p.click('#paste-toggle');
    await p.fill('#paste-text', clip + '\n鍋貼＊3\n2*3*12'); await p.click('#paste-add');
    await p.waitForFunction(k => JSON.parse(localStorage.getItem(k + 'lists')).slice(-1)[0].items.length > 2, NS, T).catch(() => {});
    const got = await p.evaluate(k => { const l = JSON.parse(localStorage.getItem(k + 'lists')); return l[l.length - 1].items.map(i => i.text + ':' + i.weight).join(','); }, NS);
    assert(got === '小明:1,阿華:1,佳佳:1,我自己:2,鍋貼:3,2*3:10', `貼上解析 *N 權重：${got}`);
    await ctx.close();
  }
  // r2: IME 組字送出超過 30 字：欄位與存檔一致並提示；刪除後再編輯，復原只插回被刪的那一項；清空後再編輯就收起復原
  {
    const { ctx, p, cdp } = await open();
    await p.click('#edit-btn'); await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'ed-close', null, T);
    await p.focus('#item-0'); await p.keyboard.press('End');
    const s32 = '測'.repeat(32);
    await cdp.send('Input.imeSetComposition', { text: s32, selectionStart: 32, selectionEnd: 32 });
    await cdp.send('Input.insertText', { text: s32 });
    await p.waitForFunction(() => /最多 30 字/.test(document.getElementById('ed-msg').textContent), null, T).catch(() => {});
    const f = await p.evaluate(() => [...document.getElementById('item-0').value].length);
    const msg = await txt(p, '#ed-msg');
    await reload(p);
    const saved = await p.evaluate(k => [...JSON.parse(localStorage.getItem(k + 'lists'))[0].items[0].text].length, NS);
    assert(f === 30 && saved === 30 && /最多 30 字/.test(msg), `IME 送出 34 字：欄位 ${f}、存檔 ${saved}，提示「${msg}」`);
    await p.click('#edit-btn'); await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'ed-close', null, T);
    await p.fill('#list-name', ''); await p.focus('#list-name'); await p.keyboard.press('End');
    await cdp.send('Input.imeSetComposition', { text: '名'.repeat(25), selectionStart: 25, selectionEnd: 25 });
    await cdp.send('Input.insertText', { text: '名'.repeat(25) });
    await p.waitForFunction(() => /最多 20 字/.test(document.getElementById('ed-msg').textContent), null, T).catch(() => {});
    assert([...(await p.inputValue('#list-name'))].length === 20 && /最多 20 字/.test(await txt(p, '#ed-msg')), `IME 清單名稱截到 20 字並提示（${[...(await p.inputValue('#list-name'))].length}）`);
    await p.selectOption('#list-select', 'drink');
    const orig = await p.evaluate(() => [...document.querySelectorAll('#items input')].map(i => i.value));
    await p.click('#item-0-del');
    await p.focus('#item-0'); await p.keyboard.press('End'); await p.keyboard.type('Z');
    await p.click('#item-1-wplus');
    await p.click('#undo-btn');
    const rows = await p.evaluate(() => [...document.querySelectorAll('#items .item')].map(r => r.querySelector('input').value + ':' + r.querySelector('output').textContent));
    assert(rows[0] === orig[0] + ':1' && rows[1] === orig[1] + 'Z:1' && rows[2] === orig[2] + ':2' && rows.length === orig.length, `刪除後再編輯，復原只插回被刪的項、保留後來的修改：${rows.slice(0, 3).join(',')}`);
    await p.click('#clear-items'); assert(await p.isVisible('#undo'), '清空後出現復原');
    await p.click('#add-item'); await p.fill('#item-0', '新的');
    assert(!(await p.isVisible('#undo')), '清空後再編輯，復原列收起（不會把後來的修改還原掉）');
    await ctx.close();
  }
  {
    const { ctx, p } = await open({ w: 360, h: 640 });
    await p.click('#edit-btn'); await p.waitForTimeout(350);
    await p.click('#add-item'); await p.fill('#item-8', '九'); // long enough list to scroll
    await p.click('#item-3-del');
    await p.evaluate(() => { const b = document.querySelector('.ed-body'); b.scrollTop = b.scrollHeight; });
    const cov = await p.evaluate(() => { const u = document.getElementById('undo').getBoundingClientRect(); return [...document.querySelectorAll('.ed-body button, .ed-body input')].filter(e => { const r = e.getBoundingClientRect(); return r.height && r.bottom > u.top && r.top < u.bottom && r.right > u.left && r.left < u.right && r.top < innerHeight; }).map(e => e.id || e.textContent.trim()); });
    assert(await p.isVisible('#undo') && cov.length === 0, `360x640 捲到底時復原列不蓋住任何控制項 ${cov.join(',')}`);
    await ctx.close();
  }
  // 10. 權重 −/+ 至少 44×44，360 寬也放得下
  {
    const { ctx, p } = await open({ w: 360, h: 640 });
    await p.click('#edit-btn'); await p.waitForTimeout(350);
    const sz = await p.evaluate(() => [...document.querySelectorAll('#items .stepper button, #items .del')].map(b => { const r = b.getBoundingClientRect(); return [r.width, r.height, r.right]; }));
    assert(sz.length && sz.every(([w, h, r]) => w >= 44 && h >= 44 && r <= 360), `360 寬編輯清單權重 −/+、刪除都 ≥ 44×44 且不超出畫面（${sz.length} 個）`);
    await ctx.close();
  }

  // 7. 擲骰途中切模式不會把骰子結果顯示在轉盤；擲骰途中改顆數，結果仍是那一次擲的
  {
    const { ctx, p } = await open({ motion: true });
    await p.click('#mode-dice');
    const h0 = await hist(p);
    await p.click('#roll'); await p.click('#mode-wheel');
    await p.waitForTimeout(1300);
    assert(!/總和/.test(await txt(p, '#res-cap')) && await hist(p) === h0 + 1, `擲骰途中切到轉盤：轉盤標題「${await txt(p, '#res-cap')}」，擲骰紀錄仍保存`);
    await p.click('#mode-dice');
    await p.click('#roll'); await p.click('#dc-plus');
    const cap = await txt(p, '#res-cap'), det = await txt(p, '#res-detail'), big = +(await txt(p, '#res-big'));
    const nums = det.split('=')[0].match(/\d+/g).map(Number);
    assert(cap === '2 顆 d6 總和' && nums.length === 2 && nums[0] + nums[1] === big && await txt(p, '#dc-count') === '3', `擲骰途中按「+」：先結算這次（${cap} ${det}），再變 3 顆`);
    // 擲骰途中重新整理：結果已記錄
    const h1 = await hist(p);
    await p.click('#roll'); await reload(p);
    assert(await hist(p) === h1 + 1, '擲骰途中重新整理，結果仍寫進紀錄');
    // 轉盤轉動中分頁停用；轉動中重新整理，結果仍寫進紀錄
    await p.click('#mode-wheel');
    const h2 = await hist(p);
    await p.click('#spin');
    assert(await p.isDisabled('#mode-deck') && await p.isDisabled('#edit-btn'), '轉動中分頁與編輯鈕顯示為停用');
    await reload(p);
    assert(await hist(p) === h2 + 1, '轉動中重新整理，結果仍寫進紀錄');
    await ctx.close();
  }

  // 12. 橫式 844x390 擲骰：結果不用捲動就看得到
  {
    const { ctx, p, c } = await open({ w: 844, h: 390 });
    await p.click('#mode-dice'); await p.click('#roll');
    await p.waitForFunction(() => /總和/.test(document.getElementById('res-cap').textContent), null, T);
    const r = await c('#res-big'), d = await c('#res-detail'), roll = await c('#roll');
    const sy = await p.evaluate(() => scrollY);
    assert(sy === 0 && r.top >= 0 && d.bottom <= 390 && roll.bottom <= 390, `844x390 擲完總和與算式在畫面內（big ${Math.round(r.top)}–${Math.round(r.bottom)}，detail 底 ${Math.round(d.bottom)}）`);
    await ctx.close();
  }

  // 13. 360 寬轉盤標籤先縮字再截斷：4 字中文完整
  {
    // 字型因機器而異（CI 可能沒有中文字型）：字縮到下限仍放不下時才允許截斷
    const init = () => { const f = CanvasRenderingContext2D.prototype.fillText; window.__labels = []; CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__labels.push({ t, px: parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]), dpr: devicePixelRatio }); return f.call(this, t, ...a); }; };
    const { ctx, p } = await open({ w: 360, h: 640, init });
    await p.waitForFunction(() => window.__labels.length >= 8, null, T);
    const labels = await p.evaluate(() => window.__labels.slice(-8));
    const okLabel = l => !l.t.endsWith('…') || l.px <= 12 * l.dpr + 0.01;
    assert(labels.some(l => l.t.startsWith('義大')) && labels.every(okLabel), `360 寬轉盤標籤先縮字再截斷：${labels.map(l => l.t + '@' + l.px).join('、')}`);
    await ctx.close();
  }

  // 15. 手改存檔的骰子設定被夾回範圍
  {
    const { ctx, p } = await open();
    await p.evaluate(k => localStorage.setItem(k + 'settings', JSON.stringify({ sound: true, vibrate: true, dice: { count: 99, sides: 7, modOn: true, mod: 'abc' } })), NS);
    await reload(p); await p.click('#mode-dice');
    const n = await p.locator('#dice .die').count();
    await p.click('#roll'); await p.waitForFunction(() => /總和/.test(document.getElementById('res-cap').textContent), null, T);
    assert(n === 6 && await txt(p, '#mod-val') === '0' && /^6 顆 d6/.test(await txt(p, '#res-cap')) && /^\d+$/.test(await txt(p, '#res-big')), `壞的骰子設定夾回 6 顆 d6、修正 0（${n} 顆，${await txt(p, '#res-cap')} ${await txt(p, '#res-big')}）`);
    await ctx.close();
  }

  // 16. 深色模式翻開的籤卡和背景分得開
  {
    const { ctx, p } = await open({ dark: true });
    await p.click('#mode-deck'); await p.click('#deck');
    const cs = await p.evaluate(() => { const g = e => getComputedStyle(e); const c = g(document.getElementById('card')); return { bg: c.backgroundColor, page: g(document.body).backgroundColor, shadow: c.boxShadow }; });
    assert(cs.bg !== cs.page && cs.bg !== 'rgb(24, 28, 37)' && /inset/.test(cs.shadow), `深色籤卡 ${cs.bg}（頁面 ${cs.page}）有紅色頂邊`);
    await ctx.close();
  }

  assert(errors.length === 0, '全程沒有 console / page error ' + errors.join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
