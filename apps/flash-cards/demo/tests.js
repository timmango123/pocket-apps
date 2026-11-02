// Regression tests for flash-cards (run by qa/smoke/run.js): node tests.js
// One check per release-review finding (drafts, big import, long deck name, auto-speak, Anki text, JSON
// normalisation, export/paste import, delete undo, storage fallbacks, edit in review, progress, tags, toast, …).
// Waits on conditions only; no timing values are derived from wall-clock deltas.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const SRC = path.resolve(__dirname, '../index.html');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const HTML = SKELETON + fs.readFileSync(SRC, 'utf8') + '</body></html>';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) passes++; else fails++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const T = { timeout: 20000 };

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const allErrors = [];
  const mk = async (o = {}) => {
    const ctx = await browser.newContext({ viewport: o.vp || { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduce ? 'reduce' : 'no-preference', acceptDownloads: true });
    // every toast text is recorded, so tests never depend on catching a toast while it is visible
    await ctx.addInitScript(() => { window.__toasts = []; document.addEventListener('DOMContentLoaded', () => { const t = document.querySelector('#toast'); if (t) new MutationObserver(() => { if (!t.hidden && t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] }); }); });
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') allErrors.push(m.text()); });
    page.on('pageerror', e => allErrors.push(String(e)));
    page.on('dialog', d => d.accept().catch(() => {}));
    const cdp = await ctx.newCDPSession(page);
    const touch = async (pts) => { // pts: [[x,y],...] start, moves, end
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
      for (const [x, y] of pts.slice(1)) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const ready = () => page.waitForFunction(() => window.__fc && document.querySelector('#col-a .top, #view-review:not([hidden]) #rv-left, #view-stats .top'), null, T);
    await page.goto(o.hash ? URL + o.hash : URL); await ready();
    return { ctx, page, touch, ready };
  };
  const sampleId = p => p.evaluate(() => [...window.__fc.db.decks.values()].find(d => d.name === '旅遊英文').id);
  const toastHas = (p, s) => p.waitForFunction(t => window.__toasts.some(x => x.includes(t)), s, T);
  const lastToast = (p, s) => p.evaluate(t => window.__toasts.filter(x => x.includes(t)).pop() || '', s);
  const goDeck = async (p, id) => { await p.goto(URL + '#/deck/' + encodeURIComponent(id)); await p.waitForFunction(id => location.hash === '#/deck/' + encodeURIComponent(id) && document.querySelector('#deck-set') && document.querySelector('#sheet').hidden, id, T); };

  // 1. drafts survive a reload (add card + batch paste), cancel clears them
  {
    const { ctx, page, ready } = await mk();
    const id = await sampleId(page);
    await goDeck(page, id);
    await page.click('#deck-add'); await page.fill('#cd-front', 'serendipity'); await page.fill('#cd-back', '意外的好運');
    await page.reload(); await ready();
    await page.waitForSelector('#cd-front', T);
    ok(await page.inputValue('#cd-front') === 'serendipity' && await page.inputValue('#cd-back') === '意外的好運', 'add-card draft restored after reload');
    // tapping the grey area or Esc keeps the draft and offers 復原
    await page.mouse.click(10, 10);
    await page.waitForFunction(() => document.querySelector('#sheet').hidden, null, T);
    await toastHas(page, '草稿已保留');
    ok(JSON.parse(await page.evaluate(() => localStorage.getItem('flash-cards:v1:draft')) || '{}').front === 'serendipity', 'tap outside the sheet keeps the draft');
    await page.click('#toast-act'); await page.waitForSelector('#cd-front', T);
    ok(await page.inputValue('#cd-front') === 'serendipity' && await page.inputValue('#cd-back') === '意外的好運', '復原 reopens the sheet with the draft');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('#sheet').hidden && document.querySelector('#toast-act'), null, T);
    ok(JSON.parse(await page.evaluate(() => localStorage.getItem('flash-cards:v1:draft')) || '{}').back === '意外的好運', 'Esc keeps the draft too');
    await page.click('#toast-act'); await page.waitForSelector('#cd-front', T);
    await page.click('#sheet-box [data-close]');
    ok(await page.evaluate(() => localStorage.getItem('flash-cards:v1:draft')) === null, 'cancel (×) clears the card draft');
    await page.click('#deck-batch'); await page.fill('#bt-text', Array.from({ length: 50 }, (_, i) => `w${i}, 字${i}`).join('\n'));
    await page.reload(); await ready(); await page.waitForSelector('#bt-text', T);
    ok((await page.inputValue('#bt-text')).split('\n').length === 50 && await page.textContent('#bt-n') === '50', 'batch-paste draft (50 lines) restored after reload');
    await page.click('#bt-ok');
    ok(await page.evaluate(() => localStorage.getItem('flash-cards:v1:draft')) === null, 'import clears the batch draft');
    // add & continue: confirmation inside the sheet, not a toast over its buttons
    await page.click('#deck-add'); await page.fill('#cd-front', 'a1'); await page.fill('#cd-back', 'b1');
    const nT = await page.evaluate(() => window.__toasts.length);
    await page.click('#cd-save-next');
    const after = await page.evaluate(() => window.__toasts.slice());
    ok((await page.textContent('#cd-err')).includes('已新增') && after.length === nT, `新增並繼續 confirms inside the sheet (no toast over buttons) ${JSON.stringify(after.slice(nT))}`);
    await page.click('#sheet-box [data-close]');
    await ctx.close();
  }

  // 2. big import: toast only after it is on disk; an interrupted import never leaves an empty deck shell
  {
    const { ctx, page, ready } = await mk();
    const persistCalls = await page.evaluate(() => { window.__pc = 0; if (navigator.storage) navigator.storage.persist = () => { window.__pc++; return Promise.resolve(true); }; return window.__pc; });
    ok(persistCalls === 0, 'persist() not requested on first load');
    const big = Array.from({ length: 6000 }, (_, i) => `word${i}\t意思${i}`).join('\n');
    await page.setInputFiles('#file-in', { name: 'big.txt', mimeType: 'text/plain', buffer: Buffer.from(big) });
    await toastHas(page, '已匯入 6000 張');
    ok(await page.evaluate(() => window.__pc) === 1 && (await lastToast(page, '已匯入 6000 張')).includes('持久儲存'), 'persist() asked once after the first import, with an explanation');
    await page.reload(); await ready();
    const n = await page.evaluate(() => { const d = [...window.__fc.db.decks.values()].find(d => d.name === 'big'); return d ? [...window.__fc.db.cards.values()].filter(c => c.deckId === d.id).length : -1; });
    ok(n === 6000, `reload right after "已匯入" keeps all 6000 cards (${n})`);
    const big2 = Array.from({ length: 12000 }, (_, i) => `term${i}\t定義${i}`).join('\n');
    await page.setInputFiles('#file-in', { name: 'cut.txt', mimeType: 'text/plain', buffer: Buffer.from(big2) });
    await page.waitForFunction(() => window.__fc.busy > 0 || [...window.__fc.db.decks.values()].some(d => d.name === 'cut'), null, T);
    await page.reload(); await ready();
    const r = await page.evaluate(() => { const F = window.__fc, d = [...F.db.decks.values()].find(d => d.name === 'cut'); return { mode: F.mode, cut: d ? [...F.db.cards.values()].filter(c => c.deckId === d.id).length : 0, has: !!d, orphans: [...F.db.cards.values()].filter(c => !F.db.decks.has(c.deckId)).length, big: [...F.db.decks.values()].some(d => d.name === 'big') }; });
    ok(r.mode === 'idb' && r.big && r.orphans === 0 && (!r.has || r.cut === 12000), `interrupted import: no half-empty deck (deck ${r.has}, cards ${r.cut}, orphans ${r.orphans}, mode ${r.mode})`);
    ok(!/還沒有任何卡組/.test(await page.textContent('#col-a')), 'home never shows the empty state while data exists');
    await ctx.close();
  }

  // 3. long deck name does not widen the page at 360×640
  {
    const { ctx, page, ready } = await mk({ vp: { width: 360, height: 640 } });
    const id = await page.evaluate(() => { const F = window.__fc, d = F.newDeck('多益必考單字第一週到第四週完整版本多益必考單字第一週到第四週'); F.saveDeck(d); return d.id; });
    await goDeck(page, id);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, set: document.querySelector('#deck-set').getBoundingClientRect().right, rev: document.querySelector('#deck-review').getBoundingClientRect().right }));
    ok(m.sw <= 360 && m.set <= 360 && m.rev <= 360, `long deck name at 360px: scrollWidth ${m.sw}, settings button right ${Math.round(m.set)}`);
    await ctx.close();
  }

  // 4. auto-speak reads the front when flipped, in normal and reversed decks; speak button only with a voice, in the corner
  {
    const stub = `window.__spoken=[];(function(){const S=window.speechSynthesis;if(!S)return;S.speak=u=>window.__spoken.push({text:u.text,lang:u.lang});S.cancel=()=>{};window.SpeechSynthesisUtterance=class{constructor(t){this.text=t;this.lang='';this.voice=null;}};S.getVoices=()=>[{lang:'en-US',name:'Fake EN'}];})();`;
    const { ctx, page } = await mk({ init: stub });
    for (const reverse of [false, true]) {
      const id = await page.evaluate(rv => { const F = window.__fc, d = [...F.db.decks.values()].find(d => d.name === '旅遊英文'); F.saveDeck(Object.assign({}, d, { autoSpeak: true, reverse: rv })); window.__spoken = []; location.hash = '#/review/' + encodeURIComponent(d.id); return d.id; }, reverse);
      await page.waitForFunction(() => window.__fc.ses && window.__fc.ses.cur && !document.querySelector('#view-review').hidden, null, T);
      const onShow = await page.evaluate(() => window.__spoken.length);
      await page.click('#rv-show');
      const sp = await page.evaluate(() => ({ s: window.__spoken.slice(), front: window.__fc.db.cards.get(window.__fc.ses.cur).front }));
      ok(onShow === 0 && sp.s.length === 1 && sp.s[0].text === sp.front.replace('[音]', '').trim() && sp.s[0].lang === 'en-US', `auto-speak ${reverse ? 'reversed' : 'normal'}: silent on show, reads front "${sp.s[0] && sp.s[0].text}" on flip`);
      const b = await page.evaluate(() => { const s = document.querySelector('#rv-say'), c = document.querySelector('#rv-card').getBoundingClientRect(), r = s.getBoundingClientRect(); return { vis: !s.hidden, w: r.width, h: r.height, corner: c.right - r.right < 20 && c.bottom - r.bottom < 20 }; });
      ok(b.vis && b.w >= 44 && b.h >= 44 && b.corner, 'speak button visible in the card corner, 44×44');
      await page.evaluate(() => { location.hash = '#/'; }); await page.waitForFunction(() => !document.querySelector('#view-main').hidden, null, T);
    }
    await ctx.close();
  }

  // 5. review: no voice → no speak button, tapping card centre flips; progress; edit; toast placement; fly-out; card height
  {
    const { ctx, page, touch } = await mk({ hash: '#/review/all' });
    await page.waitForFunction(() => window.__fc.ses && window.__fc.ses.cur, null, T);
    ok(await page.isHidden('#rv-say'), 'no matching voice: no disabled speak button on the card');
    const c = await page.evaluate(() => { const r = document.querySelector('#rv-card').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height }; });
    ok(c.h > 844 * 0.6, `portrait card uses the free height (${Math.round(c.h)}px > 60vh)`);
    await touch([[c.x, c.y]]);
    await page.waitForFunction(() => window.__fc.ses.flipped, null, T);
    ok(true, 'tap on card centre flips');
    const p0 = await page.textContent('#rv-left');
    await page.click('#rate-1');
    const p1 = await page.evaluate(() => ({ t: document.querySelector('#rv-left').textContent, w: parseFloat(document.querySelector('#rv-bar').style.width) }));
    ok(p0 === '0／10' && /^1／10/.test(p1.t) && p1.t.includes('+1 重學'), `progress keeps the round size: ${p0} → ${p1.t}`);
    // edit this card during review
    const cur = await page.evaluate(() => window.__fc.ses.cur);
    await page.click('#rv-edit'); await page.waitForSelector('#cd-back', T);
    await page.fill('#cd-back', '改過的背面'); await page.click('#cd-save');
    await page.waitForFunction(() => document.querySelector('#sheet').hidden, null, T);
    const e = await page.evaluate(id => ({ cur: window.__fc.ses.cur, back: window.__fc.db.cards.get(id).back, shown: document.querySelector('#rv-back').textContent, route: location.hash }), cur);
    ok(e.cur === cur && e.back === '改過的背面' && e.shown === '改過的背面' && e.route === '#/review/all', `edit in review saves and stays on the same card ${e.cur === cur} ${JSON.stringify([e.back, e.shown, e.route])}`);
    // toast stays above the rating buttons
    await page.click('#rv-show'); await page.click('#rate-3'); await page.click('#rv-undo');
    const tp = await page.evaluate(() => ({ t: document.querySelector('#toast').getBoundingClientRect().bottom, a: document.querySelector('#rv-actions').getBoundingClientRect().top }));
    ok(tp.t <= tp.a, `undo toast clears the rating buttons (${Math.round(tp.t)} <= ${Math.round(tp.a)})`);
    // swipe right: rating recorded at once, card flies out as a ghost
    const n0 = await page.evaluate(() => window.__fc.db.reviews.length);
    const pts = [[c.x, c.y]]; for (let k = 1; k <= 8; k++) pts.push([c.x + k * 22, c.y]);
    await touch(pts);
    const sw = await page.evaluate(() => ({ n: window.__fc.db.reviews.length, r: window.__fc.db.reviews.at(-1).rating, ghost: !!document.querySelector('.ghost') }));
    ok(sw.n === n0 + 1 && sw.r === 3 && sw.ghost, 'swipe right rates 記得 immediately with a fly-out ghost');
    await page.waitForFunction(() => !document.querySelector('.ghost'), null, T);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.kbd-keys')).display) === 'none', 'keyboard hint hidden on touch devices');
    await ctx.close();
  }

  // 6. pure parsing / normalisation
  {
    const { ctx, page } = await mk();
    const r = await page.evaluate(() => {
      const F = window.__fc, out = {};
      const a = F.parseBatch('#separator:tab\n#html:true\n#tags column:3\ndog\t狗\tanimal\ncat<br>貓\t<b>貓</b>&nbsp;咪\tanimal pet\n"multi\nline"\t多行\t\n', []);
      out.anki = a.ok.map(x => [x.front, x.back, x.tags]); out.ankiSkipped = a.skipped; out.ankiFail = a.fail.length;
      const pl = F.parseBatch('<div>, 區塊元素\nHTML <b> tag, 粗體標籤\nx&amp;y\t和\na<br>b, 換行', []);
      out.plainHtml = pl.ok.map(x => [x.front, x.back]);
      const h = F.parseBatch('#include, 引入標頭檔\n#hashtag, 主題標籤\n# 這是註解\nx, y', []);
      out.hash = h.ok.map(x => x.front); out.hashSkipped = h.skipped;
      F.importJSON({ decks: [{ id: 'x1', name: '舊格式' }], cards: [{ id: 'c1', deckId: 'x1', front: 'a', back: 'b', state: 'new' }, { id: 'c2', deckId: 'x1', front: 'c', back: 'd', state: 'weird', due: 'x' }] });
      const tc = F.todayCounts('x1'); out.norm = [tc.nw, tc.due, F.db.cards.get('c2').state, F.db.cards.get('c2').due];
      out.bin = [F.looksBinary('PK\u0003\u0004\u0000\u0000abc'), F.looksBinary('apple, 蘋果\nbanana, 香蕉')];
      out.sound = [F.render('a [音] b [音]'), F.plain('x[音]y[音]')];
      return out;
    });
    ok(JSON.stringify(r.anki) === JSON.stringify([['dog', '狗', ['animal']], ['cat\n貓', '**貓** 咪', ['animal', 'pet']], ['multi\nline', '多行', []]]) && r.ankiSkipped === 3 && r.ankiFail === 0, `Anki plain text: tags column, HTML, quoted multi-line ${JSON.stringify(r.anki)}`);
    ok(JSON.stringify(r.plainHtml) === JSON.stringify([['<div>', '區塊元素'], ['HTML <b> tag', '粗體標籤'], ['x&amp;y', '和'], ['a\nb', '換行']]), `plain text without Anki header keeps HTML literally ${JSON.stringify(r.plainHtml)}`);
    ok(JSON.stringify(r.hash) === JSON.stringify(['#include', '#hashtag', 'x']) && r.hashSkipped === 1, `# lines: only "# comment" skipped ${JSON.stringify(r.hash)}`);
    ok(JSON.stringify(r.norm) === JSON.stringify([2, 0, 'new', 0]), `importJSON fills missing deck limits / card state ${JSON.stringify(r.norm)}`);
    ok(r.bin[0] === true && r.bin[1] === false, 'binary text is rejected, normal text is not');
    ok(!r.sound[0].includes('[音]') && r.sound[1] === 'xy', 'every [音] marker is hidden');
    // file-level: binary file and broken JSON give Chinese, actionable errors
    await page.setInputFiles('#file-in', { name: 'garbage.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0xff, 0xfe, 0, 1, 2, 3, 0, 0, 0x89, 0x50]) });
    await toastHas(page, '匯入失敗');
    ok((await lastToast(page, '匯入失敗')).includes('不是文字檔') && !(await page.evaluate(() => [...window.__fc.db.decks.values()].some(d => d.name === 'garbage'))), 'binary file blocked with an explanation');
    await page.setInputFiles('#file-in', { name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"flash-cards",\n"decks":[\n{"id":"a"') });
    await toastHas(page, 'JSON 格式錯誤');
    const jt = await lastToast(page, 'JSON 格式錯誤');
    ok(/第 3 行附近中斷/.test(jt), `broken JSON explained in Chinese: ${jt}`);
    await ctx.close();
  }

  // 7. export downloads a file; paste import restores; delete undo; settings validation; tags; deck swipe-delete reset
  {
    const { ctx, page, ready, touch } = await mk();
    await page.click('#btn-menu');
    const [dl] = await Promise.all([page.waitForEvent('download', T), page.click('#mn-json')]);
    const json = fs.readFileSync(await dl.path(), 'utf8');
    ok(/^flash-cards-.*\.json$/.test(dl.suggestedFilename()) && JSON.parse(json).cards.length === 10, `export downloads ${dl.suggestedFilename()}`);
    const id = await sampleId(page);
    await page.evaluate(id => window.__fc.delDeck(id), id);
    await page.waitForFunction(() => new Promise(res => { const q = indexedDB.open('flash-cards'); q.onsuccess = () => { const t = q.result.transaction('cards'); const c = t.objectStore('cards').count(); t.oncomplete = () => { q.result.close(); res(c.result === 0); }; }; q.onerror = () => res(false); }), null, T);
    await page.reload(); await ready();
    await page.click('#btn-menu'); await page.click('#mn-paste'); await page.fill('#pi-text', json); await page.click('#pi-ok');
    await toastHas(page, '已匯入 1 個卡組');
    ok(await page.evaluate(() => window.__fc.db.cards.size) === 10, 'pasted JSON backup restores the deck');
    // delete deck → 復原
    await goDeck(page, id);
    await page.click('#deck-set'); await page.click('#ds-del'); await page.click('#ds-del');
    await toastHas(page, '已刪除');
    await page.waitForSelector('#toast-act', T); await page.click('#toast-act');
    // wait until the restored deck and its cards are in IndexedDB itself, not just in memory
    await page.waitForFunction(id => new Promise(res => { const q = indexedDB.open('flash-cards'); q.onsuccess = () => { const t = q.result.transaction(['decks', 'cards']); const d = t.objectStore('decks').get(id), c = t.objectStore('cards').index('deckId').count(id); t.oncomplete = () => { q.result.close(); res(!!d.result && c.result === 10); }; }; q.onerror = () => res(false); }), id, T);
    await page.reload(); await ready();
    ok(await page.evaluate(id => window.__fc.db.decks.has(id) && [...window.__fc.db.cards.values()].filter(c => c.deckId === id).length === 10, id), 'deleted deck restored with its 10 cards via 復原 (survives reload)');
    // settings: blank / out of range are refused with a message
    await goDeck(page, id);
    await page.click('#deck-set'); await page.fill('#ds-new', ''); await page.click('#ds-ok');
    const v1 = await page.evaluate(() => ({ open: !document.querySelector('#sheet').hidden, err: document.querySelector('#ds-err').textContent }));
    await page.fill('#ds-new', '20'); await page.fill('#ds-rev', '-5'); await page.click('#ds-ok');
    const v2 = await page.evaluate(id => ({ open: !document.querySelector('#sheet').hidden, err: document.querySelector('#ds-err').textContent, d: window.__fc.db.decks.get(id) }), id);
    ok(v1.open && v1.err.includes('0–200') && v2.open && v2.err.includes('1–9999') && v2.d.newPerDay === 20 && v2.d.reviewLimit === 200, 'deck settings reject blank / out-of-range limits and stay open');
    await page.click('#sheet-box [data-close]');
    // tags shown and filterable
    await page.evaluate(id => { const F = window.__fc; const c = [...F.db.cards.values()].find(c => c.deckId === id); F.saveCards([Object.assign({}, c, { tags: ['機場'] })]); F.rerender(); }, id);
    await page.waitForSelector('#tag-bar button[data-tag="機場"]', T);
    await page.click('#tag-bar button[data-tag="機場"]');
    ok(await page.$$eval('#card-list [data-card]', e => e.length) === 1 && (await page.textContent('#card-list')).includes('#機場'), 'tag chip filters the card list and tags show on the card row');
    // swipe-to-delete: armed state resets after 3 s, tapping elsewhere folds it away
    await page.goto(URL + '#/'); await page.waitForFunction(() => location.hash === '#/' && document.querySelector('.deck .open'), null, T);
    const rb = await page.evaluate(() => { const r = document.querySelector('.deck .open').getBoundingClientRect(); return { x: r.right - 30, y: r.top + r.height / 2 }; });
    const pts = [[rb.x, rb.y]]; for (let k = 1; k <= 8; k++) pts.push([rb.x - k * 15, rb.y]);
    await touch(pts);
    await page.waitForSelector('.deck.reveal .del', T);
    await page.click('.deck.reveal .del');
    ok(await page.textContent('.deck .del') === '確定？', 'first tap arms delete');
    await page.waitForFunction(() => document.querySelector('.deck .del').textContent === '刪除', null, T);
    await touch([[20, 20]]);
    await page.waitForFunction(() => !document.querySelector('.deck.reveal'), null, T);
    ok(await page.evaluate(id => window.__fc.db.decks.has(id), id), 'armed delete resets after 3 s and folds away on an outside tap');
    await ctx.close();
  }

  // 8. localStorage mode flushes before unload and warns when full; memory mode warns on home
  {
    const noIDB = 'Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });';
    const { ctx, page, ready } = await mk({ init: noIDB });
    ok(await page.evaluate(() => window.__fc.mode) === 'ls', 'falls back to localStorage without IndexedDB');
    await page.evaluate(() => { const F = window.__fc, d = [...F.db.decks.values()][0]; F.saveCards([F.newCard(d.id, 'quick', '快')]); });
    await page.reload(); await ready();
    ok(await page.evaluate(() => [...window.__fc.db.cards.values()].some(c => c.front === 'quick')), 'localStorage mode: card added just before reload is kept');
    await page.evaluate(() => { const orig = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'flash-cards:v1:data') throw new DOMException('full', 'QuotaExceededError'); return orig.call(this, k, v); }; const F = window.__fc, d = [...F.db.decks.values()][0]; F.saveCards([F.newCard(d.id, 'big', '大')]); });
    await page.waitForSelector('#save-warn', T);
    ok((await page.textContent('#save-warn')).includes('儲存空間已滿'), 'localStorage full: banner asks for a backup');
    await ctx.close();
    const noLS = noIDB + 'Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });';
    const m = await mk({ init: noLS });
    ok(await m.page.evaluate(() => window.__fc.mode) === 'mem' && (await m.page.textContent('#save-warn')).includes('關閉頁面後會消失'), 'memory-only mode shows a permanent warning on home');
    await m.ctx.close();
  }

  // 9. dark chart: 重來 bar brighter than before
  {
    const { ctx, page } = await mk({ dark: true });
    const v = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bar-again').trim());
    ok(v && v !== '#4a5462', `dark 重來 bar colour ${v}`);
    await ctx.close();
  }

  ok(allErrors.length === 0, `no console/page errors ${allErrors.slice(0, 3).join(' | ')}`);
  await browser.close(); srv.close();
  console.log(fails ? `FAIL ${fails} of ${passes + fails}` : `ALL PASS (${passes})`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
