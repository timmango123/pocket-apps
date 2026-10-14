// Verify flash-cards: node verify.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const mk = async (o = {}) => {
    const vp = o.viewport || { width: 390, height: 844 };
    const ctx = await browser.newContext({ viewport: vp, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(URL); await page.waitForTimeout(400);
    ok(await page.evaluate(() => innerWidth) === vp.width, `innerWidth == ${vp.width}`);
    return { ctx, page, errors };
  };
  ok(!fs.readFileSync(SRC, 'utf8').includes('�'), 'no U+FFFD in source');
  const layoutChecks = async (page, name) => {
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    ok(sw[0] <= sw[1], `${name} no horizontal scroll (${sw})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, select, input:not([type=checkbox]), textarea')].filter(e => e.offsetParent && getComputedStyle(e).visibility !== 'hidden').map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${name} touch targets >= 44px ${JSON.stringify(small.slice(0, 4))}`);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).map(e => e.className || e.tagName));
    ok(tiny.length === 0, `${name} text >= 11px ${tiny.slice(0, 3)}`);
  };

  // ---- scheduler unit tests ----
  {
    const { ctx, page, errors } = await mk();
    ok(await page.evaluate(() => window.__fc.mode) === 'idb', `storage mode: ${await page.evaluate(() => window.__fc.mode)}`);
    const t = await page.evaluate(() => {
      const S = window.__fc.schedule, M = 60000, D = 86400000, now = 1e12, out = [];
      const base = { state: 'new', due: 0, interval: 0, ease: 2.5, reps: 0, lapses: 0, step: 0 };
      const a = S(base, 3, now, false); out.push(['new+good -> 10 min learning', a.state === 'learning' && a.due - now === 10 * M]);
      const b = S(a, 3, now, false); out.push(['+good -> review 1 day', b.state === 'review' && b.interval === 1 && b.due - now === D]);
      const c = S(b, 3, now, false); out.push(['+good -> 2.5 days', c.interval === 2.5 && c.due - now === 2.5 * D]);
      const d = S(base, 1, now, false); out.push(['new+again -> 1 min', d.state === 'learning' && d.step === 0 && d.due - now === M]);
      const e = S(base, 4, now, false); out.push(['new+easy -> 4 days', e.state === 'review' && e.interval === 4]);
      const f = S(base, 2, now, false); out.push(['new+hard -> 5.5 min (shown as 6 分)', f.due - now === 5.5 * M && window.__fc.fmtIv(f.due - now) === '6 分']);
      const r = { state: 'review', interval: 10, ease: 2.5, reps: 5, lapses: 0, step: 0, due: now };
      const g = S(r, 1, now, false); out.push(['review again: lapse, ease 2.3, iv 5, relearn 10 min', g.lapses === 1 && g.ease === 2.3 && g.interval === 5 && g.state === 'relearning' && g.due - now === 10 * M]);
      const h = S(g, 3, now, false); out.push(['relearn good -> back to review 5 days', h.state === 'review' && h.due - now === 5 * D]);
      const i = S(r, 2, now, false); out.push(['review hard: iv 12, ease 2.35', i.interval === 12 && i.ease === 2.35]);
      const j = S(r, 3, now, false); out.push(['review good: iv 25', j.interval === 25 && j.ease === 2.5]);
      const k = S(r, 4, now, false); out.push(['review easy: iv 32.5, ease 2.65', k.interval === 32.5 && k.ease === 2.65]);
      const l = S(Object.assign({}, r, { ease: 1.3 }), 1, now, false), m = S(Object.assign({}, r, { ease: 3 }), 4, now, false), n = S(Object.assign({}, r, { interval: 3000 }), 4, now, false);
      out.push(['ease floor 1.3 / cap 3.0 / interval cap 3650', l.ease === 1.3 && m.ease === 3 && n.interval === 3650]);
      let lo = 1e9, hi = 0; for (let q = 0; q < 2000; q++) { const z = S(Object.assign({}, r, { interval: 100 }), 3, now, true).interval; lo = Math.min(lo, z); hi = Math.max(hi, z); }
      out.push([`jitter on 250-day interval within +-5% (${lo}..${hi})`, lo >= 237.5 && hi <= 262.5 && hi - lo > 15]);
      const s2 = S(b, 3, now, true); out.push(['no jitter below 3 days', s2.interval === 2.5]);
      return out;
    });
    t.forEach(([m, v]) => ok(v, 'SM-2: ' + m));
    const fm = await page.evaluate(() => ['1 分', '10 分', '1 天', '2.5 天', '4 天', '1.2 個月'].join() === [60000, 600000, 86400000, 2.5 * 86400000, 4 * 86400000, 36 * 86400000].map(window.__fc.fmtIv).join());
    ok(fm, 'interval labels 1 分 / 10 分 / 1 天 / 2.5 天 / 4 天 / 1.2 個月');
    // batch parse: 100 lines with 3 bad
    const bp = await page.evaluate(() => {
      const lines = []; for (let i = 1; i <= 100; i++) { const seps = ['\t', ' | ', ' - ', ', ']; lines.push(i === 17 || i === 58 || i === 99 ? '沒有分隔的錯誤行' + i : `word${i}${seps[i % 4]}單字${i}`); }
      const r = window.__fc.parseBatch(lines.join('\n'), ['word5']); return { ok: r.ok.length, dup: r.ok.filter(x => x.dup).length, fail: r.fail.map(f => f.line).join(',') };
    });
    ok(bp.ok === 97 && bp.fail === '17,58,99' && bp.dup === 1, `batch parse 100 lines: ok ${bp.ok}, failed lines ${bp.fail}, dup ${bp.dup}`);
    ok(errors.length === 0, `unit no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---- screenshots ----
  for (const s of [
    { name: '390x844', viewport: { width: 390, height: 844 } },
    { name: '360x780', viewport: { width: 360, height: 780 } },
    { name: '844x390', viewport: { width: 844, height: 390 } },
    { name: '390x844-dark', viewport: { width: 390, height: 844 }, dark: true },
    { name: '1280x800', viewport: { width: 1280, height: 800 }, mobile: false },
  ]) {
    const { ctx, page, errors } = await mk(s);
    ok((await page.textContent('body')).includes('旅遊英文') && (await page.textContent('body')).includes('範例'), `${s.name} opens with labelled sample deck`);
    await layoutChecks(page, s.name + ' home');
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    // review view
    await page.click('#btn-all'); await page.waitForTimeout(200);
    await layoutChecks(page, s.name + ' review');
    await page.click('#rv-card'); await page.waitForTimeout(400);
    await layoutChecks(page, s.name + ' flipped');
    const fit = await page.evaluate(() => { const a = document.querySelector('#rv-actions').getBoundingClientRect(), c = document.querySelector('#rv-card').getBoundingClientRect(); return a.bottom <= innerHeight + 1 && c.bottom <= a.top + 1 && c.height > 120; });
    ok(fit, `${s.name} card + rating buttons fit on screen`);
    await page.screenshot({ path: `${OUT}/${s.name}-review.png` });
    if (s.name === '390x844') {
      await page.click('#rv-exit'); await page.waitForTimeout(150);
      await page.click('[data-open]'); await page.waitForTimeout(150);
      await layoutChecks(page, s.name + ' deck');
      await page.screenshot({ path: `${OUT}/390x844-deck.png` });
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---- functional flow ----
  {
    const { ctx, page, errors } = await mk({ reduce: true });
    // Make a deck through the UI
    await page.click('#btn-new-deck'); await page.fill('#nd-name', '測試卡組'); await page.click('#nd-ok'); await page.waitForFunction(() => location.hash.startsWith('#/deck/') && document.querySelector('#deck-add'));
    await page.click('#deck-add'); await page.fill('#cd-front', 'ephemeral'); await page.fill('#cd-back', '短暫的'); await page.click('#cd-save');
    await page.waitForFunction(() => (document.querySelector('#card-list') || {}).textContent?.includes('ephemeral'), null, { timeout: 3000 }).catch(() => {});
    ok((await page.textContent('#card-list')).includes('ephemeral'), 'card added via editor');
    const deckId = await page.evaluate(() => decodeURIComponent(location.hash.split('/')[2]));
    // acceptance: good, good, good -> 10 min, 1 day, ~2.5 days
    const T0 = new Date(2026, 9, 12, 10, 0, 0).getTime();
    await page.evaluate(t => window.__fc.setClock(() => t), T0);
    await page.click('#deck-review'); await page.waitForTimeout(100);
    ok((await page.textContent('#rv-front')) === 'ephemeral', 'review shows front');
    ok((await page.textContent('#iv-1')) === '1 分' && (await page.textContent('#iv-2')) === '6 分' && (await page.textContent('#iv-3')) === '10 分' && (await page.textContent('#iv-4')) === '4 天', 'new card buttons preview 1 分 / 6 分 / 10 分 / 4 天');
    await page.keyboard.press('Space'); await page.keyboard.press('3');
    let card = await page.evaluate(() => [...window.__fc.db.cards.values()].find(c => c.front === 'ephemeral'));
    ok(card.due - T0 === 10 * 60000 && card.state === 'learning', `good #1 -> due +${(card.due - T0) / 60000} min`);
    // learning card comes back (learn-ahead) in the same session
    ok((await page.textContent('#rv-front')) === 'ephemeral' && (await page.textContent('#iv-3')) === '1 天', 'learning card re-queued in session; good now previews 1 天');
    await page.keyboard.press('Space'); await page.keyboard.press('3');
    card = await page.evaluate(() => [...window.__fc.db.cards.values()].find(c => c.front === 'ephemeral'));
    ok(card.due - T0 === 86400000 && card.state === 'review', `good #2 -> due +${(card.due - T0) / 86400000} day`);
    ok(!(await page.isHidden('#rv-done')) && (await page.textContent('#dn-count')) === '2', 'done screen shows 2 reviewed');
    await page.screenshot({ path: `${OUT}/390x844-done.png` });
    const T1 = T0 + 86400000;
    await page.evaluate(t => window.__fc.setClock(() => t), T1);
    await page.click('#dn-home'); await page.waitForTimeout(100);
    await page.click('#deck-review'); await page.waitForTimeout(100);
    await page.keyboard.press('Space');
    ok((await page.textContent('#iv-3')) === '2.5 天', 'next day: good previews 2.5 天');
    await page.keyboard.press('3');
    card = await page.evaluate(() => [...window.__fc.db.cards.values()].find(c => c.front === 'ephemeral'));
    ok(Math.abs((card.due - T1) / 86400000 - 2.5) < 1e-9 && card.interval === 2.5, `good #3 -> due +${(card.due - T1) / 86400000} days`);
    // undo
    const nrev = await page.evaluate(() => window.__fc.db.reviews.length);
    await page.keyboard.press('Control+z'); await page.waitForTimeout(50);
    card = await page.evaluate(() => [...window.__fc.db.cards.values()].find(c => c.front === 'ephemeral'));
    ok(card.interval === 1 && await page.evaluate(() => window.__fc.db.reviews.length) === nrev - 1 && !(await page.isHidden('#rate-3')), 'Ctrl+Z restores card, removes review log, back on answer side');
    // swipe right = good via touch
    const cdp = await ctx.newCDPSession(page);
    const bb = await (await page.$('#rv-card')).boundingBox();
    const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
    const swipe = async (dx, dy) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
      for (let k = 1; k <= 10; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dx * k / 10, y: cy + dy * k / 10 }] }); await sleep(30); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(80);
    };
    await swipe(150, 0);
    let last = await page.evaluate(() => window.__fc.db.reviews.at(-1).rating);
    ok(last === 3, `swipe right -> rating ${last} (記得)`);
    // swipe left = again, up = easy on sample deck
    await page.evaluate(() => window.__fc.setClock(null));
    await page.click('#dn-home'); await page.waitForTimeout(80); await page.goto(URL + '#/review/all'); await page.waitForTimeout(400);
    await page.click('#rv-card'); await page.waitForTimeout(50); await swipe(-150, 0);
    last = await page.evaluate(() => window.__fc.db.reviews.at(-1).rating); ok(last === 1, `swipe left -> rating ${last} (重來)`);
    await page.click('#rv-card'); await page.waitForTimeout(50); await swipe(0, -220);
    last = await page.evaluate(() => window.__fc.db.reviews.at(-1).rating); ok(last === 4, `swipe up -> rating ${last} (簡單)`);
    await page.click('#rv-card'); await page.waitForTimeout(50); await swipe(40, 0);
    ok(await page.evaluate(() => window.__fc.db.reviews.at(-1).rating) === 4 && !(await page.isHidden('#rate-1')), 'short swipe springs back without rating');
    // queue order: new cards interleave 1 per 4 reviews
    const qo = await page.evaluate(() => {
      const F = window.__fc, d = F.newDeck('排序'); F.saveDeck(d); const now = Date.now(), cs = [];
      for (let i = 0; i < 8; i++) { const c = F.newCard(d.id, 'r' + i, 'x'); c.state = 'review'; c.interval = 3; c.due = now - (10 - i) * 1000; cs.push(c); }
      for (let i = 0; i < 3; i++) cs.push(F.newCard(d.id, 'n' + i, 'x'));
      F.saveCards(cs); const q = F.buildQueue([d.id]); const r = q.main.map(id => F.db.cards.get(id).front).join(' '); F.delDeck(d.id); return r;
    });
    ok(qo === 'r0 r1 r2 r3 n0 r4 r5 r6 r7 n1 n2', `queue interleave: ${qo}`);
    // rollover at 4am
    const ro = await page.evaluate(() => {
      const F = window.__fc, d = F.newDeck('換日'); F.saveDeck(d);
      const D = new Date(2026, 9, 12, 5, 0, 0).getTime(); const c = F.newCard(d.id, 'x', 'y'); c.state = 'review'; c.interval = 1; c.due = D; F.saveCards([c]);
      const before = F.todayCounts(d.id, new Date(2026, 9, 12, 3, 30).getTime()).due, after = F.todayCounts(d.id, new Date(2026, 9, 12, 4, 30).getTime()).due;
      const k1 = F.dayKey(new Date(2026, 9, 12, 3, 59).getTime()), k2 = F.dayKey(new Date(2026, 9, 12, 4, 0).getTime());
      F.delDeck(d.id); return { before, after, k1, k2 };
    });
    ok(ro.before === 0 && ro.after === 1 && ro.k1 === '2026-10-11' && ro.k2 === '2026-10-12', `rollover 4am: due 03:30=${ro.before}, 04:30=${ro.after}; day keys ${ro.k1} / ${ro.k2}`);
    // new-card daily limit
    const lim = await page.evaluate(() => { const F = window.__fc, d = F.newDeck('上限'); d.newPerDay = 5; F.saveDeck(d); F.saveCards(Array.from({ length: 12 }, (_, i) => F.newCard(d.id, 'q' + i, 'a'))); const c = F.todayCounts(d.id); F.delDeck(d.id); return c.nw; });
    ok(lim === 5, `new per day limit 5 of 12 -> ${lim}`);

    // batch paste via UI with 100 lines (3 bad)
    await page.goto(URL + '#/deck/' + encodeURIComponent(deckId)); await page.waitForTimeout(400);
    await page.click('#deck-batch');
    const lines = []; for (let i = 1; i <= 100; i++) lines.push(i === 17 || i === 58 || i === 99 ? 'bad line ' + i : `term${i}\t定義 ${i}`);
    await page.fill('#bt-text', lines.join('\n'));
    ok((await page.textContent('#bt-fail')) === '17、58、99' && (await page.textContent('#bt-n')) === '97', 'batch preview: 97 ok, failed lines 17、58、99');
    await page.screenshot({ path: `${OUT}/390x844-batch.png` });
    await page.click('#bt-ok'); await page.waitForTimeout(200);
    const n = await page.evaluate(id => [...window.__fc.db.cards.values()].filter(c => c.deckId === id).length, deckId);
    ok(n === 98, `after batch import deck has ${n} cards (1 + 97)`);
    // export JSON (no downloads capability -> copy sheet)
    await page.click('#btn-menu').catch(async () => { await page.click('#deck-back'); await page.click('#btn-menu'); });
    await page.click('#mn-json'); await page.waitForTimeout(150);
    const json = await page.inputValue('#ex-text');
    ok(/"app": "flash-cards"/.test(json), 'export without downloads capability shows copyable JSON');
    // downloads capability path
    const saved = await page.evaluate(async () => { let got = null; window.claude = { use: async () => ({ save: async o => { got = o; } }) }; document.querySelector('[data-close]').click(); document.querySelector('#btn-menu').click(); document.querySelector('#mn-json').click(); await new Promise(r => setTimeout(r, 100)); delete window.claude; return got && got.filename + '|' + got.data.length; });
    ok(/^flash-cards-\d{4}-\d\d-\d\d\.json\|\d+/.test(saved || ''), `with downloads capability dl.save called: ${saved}`);
    // wipe & re-import
    const before = await page.evaluate(() => JSON.stringify([...window.__fc.db.cards.values()].sort((a, b) => a.id < b.id ? -1 : 1)));
    await page.evaluate(() => { [...window.__fc.db.decks.keys()].forEach(id => window.__fc.delDeck(id)); window.__fc.db.reviews.length = 0; window.__fc.rerender(); });
    await page.waitForTimeout(300); await page.reload(); await page.waitForTimeout(400);
    ok(await page.evaluate(() => window.__fc.db.cards.size) === 0 && (await page.textContent('body')).includes('建立範例卡組'), 'after wipe + reload: empty state offers sample deck');
    await page.setInputFiles('#file-in', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(json) });
    await page.waitForTimeout(400);
    await page.reload(); await page.waitForTimeout(400);
    const after = await page.evaluate(() => JSON.stringify([...window.__fc.db.cards.values()].sort((a, b) => a.id < b.id ? -1 : 1)));
    ok(after === before, `JSON export -> wipe -> import -> reload: ${JSON.parse(after).length} cards identical incl. schedule`);
    // CSV import (Anki style txt too)
    await page.setInputFiles('#file-in', { name: 'jp.txt', mimeType: 'text/plain', buffer: Buffer.from('#separator:tab\nねこ\t貓\nいぬ\t狗\n') });
    await page.waitForTimeout(300);
    ok((await page.textContent('body')).includes('jp') && await page.evaluate(() => [...window.__fc.db.decks.values()].some(d => d.name === 'jp')), 'Anki tab text imported as deck "jp"');
    await page.setInputFiles('#file-in', { name: 'csvdeck.csv', mimeType: 'text/csv', buffer: Buffer.from('正面,背面,標籤\n"hello, world",你好\n"multi\nline",多行\n') });
    await page.waitForTimeout(300);
    const cs = await page.evaluate(() => { const d = [...window.__fc.db.decks.values()].find(d => d.name === 'csvdeck'); return [...window.__fc.db.cards.values()].filter(c => c.deckId === d.id).map(c => c.front).sort().join('|'); });
    ok(cs === 'hello, world|multi\nline', `CSV with quotes/newlines imported: ${JSON.stringify(cs)}`);
    // 10k cards performance
    const perf = await page.evaluate(() => {
      const F = window.__fc, d = F.newDeck('一萬張'); F.saveDeck(d); const now = Date.now(), cs = [];
      for (let i = 0; i < 10000; i++) { const c = F.newCard(d.id, 'w' + i, 'm' + i); if (i % 3) { c.state = 'review'; c.interval = 5; c.due = now + (i % 40 - 20) * 86400000; } cs.push(c); }
      F.saveCards(cs);
      const t0 = performance.now(); const cnt = F.todayCounts(d.id); const q = F.buildQueue([d.id]); const t1 = performance.now();
      location.hash = '#/deck/' + encodeURIComponent(d.id); F.rerender(); const t2 = performance.now();
      return { q: t1 - t0, r: t2 - t1, due: cnt.due, qlen: q.main.length, rows: document.querySelectorAll('#card-list li').length };
    });
    ok(perf.q < 100 && perf.r < 100 && perf.rows === 50, `10k cards: due query ${perf.q.toFixed(1)}ms, deck render ${perf.r.toFixed(1)}ms (50 rows), queue ${perf.qlen}`);
    // deck swipe-to-delete on home list
    await page.goto(URL + '#/'); await page.waitForTimeout(400);
    const rows0 = await page.$$eval('.deck', e => e.length);
    const rb = await (await page.$('.deck:last-child .open')).boundingBox();
    const ry = rb.y + rb.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rb.x + rb.width - 30, y: ry }] });
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rb.x + rb.width - 30 - k * 15, y: ry }] }); await sleep(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
    await page.screenshot({ path: `${OUT}/390x844-swipe-delete.png` });
    await page.click('.deck:last-child .del'); await page.click('.deck:last-child .del'); await page.waitForTimeout(150);
    ok(await page.$$eval('.deck', e => e.length) === rows0 - 1, `swipe left reveals delete; two taps delete (${rows0} -> ${rows0 - 1})`);
    await page.goto(URL + '#/stats'); await page.waitForTimeout(400);
    await layoutChecks(page, 'stats');
    await page.screenshot({ path: `${OUT}/390x844-stats.png`, fullPage: true });
    ok(errors.length === 0, `flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
