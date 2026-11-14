// Tests for 正規表示式測試 (regex-lab): regression checks for release review round 1.
// Runs the real page in Chromium (Playwright) with CDP touch events; no files needed.
//  1. Edits are saved at once: reload 100 ms after typing (pattern, text, replacement, flag), pagehide/hidden flush.
//  2. Test text over 200,000 characters survives a reload; when storage is full the page says it will not be saved.
//  3. Loading a sample over the user's own text offers 復原 (and 還原 in the library); deleting a favourite has 復原;
//     favourites export to JSON and import back (duplicates skipped).
//  4. Taps fire exactly once: single tap, 0.6 s and 1 s holds, another finger already down; a tap that opens or
//     closes a sheet never fires the control under the finger.
//  5. 360/320 wide: title not covered by the buttons, no horizontal scroll; library sheet does not scroll sideways.
//  6. Typing in the test text keeps the highlights (no flash to zero); identical results do not rebuild the list.
//  7. Explainer: [\b] is backspace, \u{41} without u is a literal u + quantifier, [] / [^] follow JS; counts in code points.
//  8. Pattern error shows 模式錯誤 in 取代/分割; 清除文字 with 復原; explainer indents only the code column; label is Chinese.
// Usage: node tests.js   (prints "N passed, 0 failed"; exit code 1 on failure)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; } else { fail++; console.log('FAIL', msg); } }

const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
const K = 'regex-lab:v1:';

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const URL0 = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, { seed = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-TW', acceptDownloads: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(`${w}x${h} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console: ${m.text()}`); });
    if (seed) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('seeded')) { for (const [a, b] of Object.entries(v)) localStorage.setItem(k + a, b); sessionStorage.setItem('seeded', '1'); } }, [K, seed]);
    await page.goto(URL0); await ready(page);
    const cdp = await ctx.newCDPSession(page);
    const T = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const tap = async (x, y, hold = 40) => { await T('touchStart', [{ x, y, id: 1 }]); await page.waitForTimeout(hold); await T('touchEnd', [{ x, y, id: 1 }]); };
    const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
    const tapSel = async (sel, hold) => { await page.locator(sel).first().scrollIntoViewIfNeeded(); const [x, y] = await center(sel); await tap(x, y, hold); };
    return { ctx, page, T, tap, tapSel, center };
  }
  const ready = page => page.waitForFunction(() => window.__rlReady);
  const settle = page => page.waitForTimeout(260).then(() => page.waitForFunction(() => !window.__rl.pending && document.getElementById('stat').textContent !== '執行中…', null, { timeout: 5000 }));
  const state = page => page.evaluate(k => JSON.parse(localStorage.getItem(k + 'state') || 'null'), K);
  const view = page => page.evaluate(() => ({ p: document.getElementById('pattern').value, t: document.getElementById('text').value, r: document.getElementById('repl').value, f: document.getElementById('flagEcho').textContent }));

  // ---------- 1. immediate save ----------
  {
    const { ctx, page } = await open(390, 844);
    await page.fill('#pattern', ''); await page.click('#pattern'); await page.keyboard.type('\\d+');
    await page.fill('#text', 'abc 123'); await settle(page);
    await page.click('#pattern'); await page.keyboard.press('End'); await page.keyboard.type('Z');
    await page.waitForTimeout(100); await page.reload(); await ready(page);
    ok((await view(page)).p === '\\d+Z', `pattern typed 100 ms before reload is kept (${(await view(page)).p})`);
    await page.click('#text'); await page.keyboard.press('End'); await page.keyboard.type('Q');
    await page.waitForTimeout(30); await page.reload(); await ready(page);
    ok((await view(page)).t === 'abc 123Q', `text typed 30 ms before reload is kept (${(await view(page)).t})`);
    await page.evaluate(() => document.getElementById('tab-repl').click()); await page.click('#repl'); await page.keyboard.type('#'); await page.waitForTimeout(30); await page.reload(); await ready(page);
    { const rv = (await view(page)).r; ok(rv.includes('#'), `replacement typed 30 ms before reload is kept (${rv})`); }
    await page.evaluate(() => document.getElementById('flag-i').click()); await page.waitForTimeout(10); await page.reload(); await ready(page);
    ok((await view(page)).f.includes('i'), 'flag change 10 ms before reload is kept');
    // big text is written on a short timer; pagehide / hidden flush it immediately
    await page.evaluate(() => { const t = document.getElementById('text'); t.value = 'x'.repeat(210000) + 'END'; t.dispatchEvent(new Event('input', { bubbles: true })); dispatchEvent(new PageTransitionEvent('pagehide')); });
    ok(await page.evaluate(k => (localStorage.getItem(k + 'bigtext') || '').endsWith('END'), K), 'pagehide flushes the pending big-text save');
    await page.evaluate(() => { const t = document.getElementById('text'); t.value = 'short'; t.dispatchEvent(new Event('input', { bubbles: true })); });
    ok((await state(page)).text === 'short' && await page.evaluate(k => localStorage.getItem(k + 'bigtext') === null, K), 'going back under 200k saves inline and drops the big-text key');
    await ctx.close();
  }
  // old saved state (v1 key format) still loads
  {
    const { ctx, page } = await open(390, 844, { seed: { state: JSON.stringify({ pattern: 'a(b)', flags: 'gi', text: 'ab AB', repl: '$1', tab: 'repl' }) } });
    await settle(page);
    const v = await view(page);
    ok(v.p === 'a(b)' && v.f === 'gi' && v.t === 'ab AB' && v.r === '$1' && await page.evaluate(() => !document.getElementById('pane-repl').hidden), 'existing regex-lab:v1:state loads unchanged');
    ok(await page.evaluate(() => document.getElementById('replOut').textContent) === 'b B', 'replacement output for the stored state');
    await ctx.close();
  }

  // ---------- 2. text over 200,000 characters ----------
  {
    const { ctx, page } = await open(390, 844);
    await page.evaluate(() => { const t = document.getElementById('text'); t.value = ('一段測試文字 abc 123\n').repeat(17334).slice(0, 260000); t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForTimeout(150); await page.reload(); await ready(page);
    ok((await view(page)).t.length === 260000, `260,000-character text survives a reload (${(await view(page)).t.length})`);
    ok(await page.evaluate(() => document.getElementById('saveNote').hidden), 'no warning when the big text was saved');
    // storage full: the page says so instead of silently saving nothing
    await page.evaluate(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(v).length > 200000) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
    await page.evaluate(() => { const t = document.getElementById('text'); t.value = 'y'.repeat(300000); t.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => !document.getElementById('saveNote').hidden, null, { timeout: 2000 }).catch(() => {});
    const note = await page.evaluate(() => document.getElementById('saveNote').hidden ? '' : document.getElementById('saveNote').textContent);
    ok(/不會保存/.test(note), `storage-full text is marked 不會保存 (${note.slice(0, 40)})`);
    await page.reload(); await ready(page);
    const n2 = await page.evaluate(() => document.getElementById('saveNote').hidden ? '' : document.getElementById('saveNote').textContent);
    ok(/沒有保存/.test(n2), `after reload the page says the long text was not saved (${n2.slice(0, 30)})`);
    await ctx.close();
  }

  // ---------- 3. sample undo, favourites undo, export/import ----------
  {
    const { ctx, page, tapSel } = await open(390, 844);
    await page.fill('#pattern', 'my(own)'); await page.fill('#text', '我自己的文字 myown'); await page.evaluate(() => { const r = document.getElementById('repl'); r.value = 'R'; r.dispatchEvent(new Event('input', { bubbles: true })); }); await settle(page);
    await tapSel('#libBtn'); await page.waitForFunction(() => !document.getElementById('libSheet').hidden);
    await tapSel('#libList .libi:nth-child(2) .pick'); await settle(page);
    ok((await view(page)).p.includes('@'), 'sample loads');
    ok(await page.evaluate(() => document.querySelector('#toastHost .toast-act')?.textContent === '復原'), 'loading a sample over own text offers 復原');
    await tapSel('#toastHost .toast-act'); await settle(page);
    let v = await view(page);
    ok(v.p === 'my(own)' && v.t === '我自己的文字 myown' && v.r === 'R' && v.f === 'g', '復原 restores pattern, flags, text and replacement');
    // load again, edit something, then restore from the library
    await tapSel('#libBtn'); await tapSel('#libList .libi:nth-child(3) .pick'); await settle(page);
    await page.evaluate(() => document.getElementById('flag-i').click()); await page.waitForTimeout(500);
    await tapSel('#libBtn');
    ok(await page.evaluate(() => !document.getElementById('restoreBtn').hidden), 'library offers 還原載入範例前的內容 after further edits');
    await tapSel('#restoreBtn'); await settle(page);
    v = await view(page);
    ok(v.p === 'my(own)' && v.t === '我自己的文字 myown', 'library 還原 brings the own content back');
    await page.reload(); await ready(page);
    ok((await view(page)).p === 'my(own)', 'restored content is saved');
    // favourites: save two, delete one with undo
    await tapSel('#saveBtn'); await page.fill('#pattern', 'second'); await tapSel('#saveBtn');
    const saved = () => page.evaluate(k => JSON.parse(localStorage.getItem(k + 'saved') || '[]').map(x => x.pattern), K);
    ok(JSON.stringify(await saved()) === '["second","my(own)"]', 'two favourites saved');
    await tapSel('#libBtn');
    await tapSel('#savedList .libi:nth-child(2) .btn'); await page.waitForTimeout(100);
    ok(JSON.stringify(await saved()) === '["second"]', 'delete removes the favourite');
    await tapSel('#toastHost .toast-act'); await page.waitForTimeout(100);
    ok(JSON.stringify(await saved()) === '["second","my(own)"]' && await page.evaluate(() => document.querySelectorAll('#savedList .libi').length === 2), 'delete 復原 puts it back in place');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), tapSel('#expBtn')]);
    const file = path.join(os.tmpdir(), 'rl-fav-' + process.pid + '.json'); await dl.saveAs(file);
    const body = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(/^regex-lab-favorites-\d{8}\.json$/.test(dl.suggestedFilename()) && body.saved.length === 2, `export downloads ${dl.suggestedFilename()} with 2 favourites`);
    await page.evaluate(k => localStorage.setItem(k + 'saved', '[]'), K);
    await page.evaluate(() => document.getElementById('libBtn').click()); await page.evaluate(() => document.getElementById('libBtn').click());
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), tapSel('#impBtn')]);
    await chooser.setFiles(file); await page.waitForFunction(() => /已匯入/.test(document.getElementById('toastHost').textContent), null, { timeout: 3000 }).catch(() => {});
    ok(JSON.stringify(await saved()) === '["second","my(own)"]', 'import brings both favourites back');
    const [ch2] = await Promise.all([page.waitForEvent('filechooser', { timeout: 5000 }), tapSel('#impBtn')]);
    await ch2.setFiles(file); await page.waitForFunction(() => /重複/.test(document.getElementById('toastHost').textContent), null, { timeout: 3000 }).catch(() => {});
    ok((await saved()).length === 2 && /2 筆重複/.test(await page.evaluate(() => document.getElementById('toastHost').textContent)), 'importing again skips duplicates and says so');
    fs.unlinkSync(file);
    await ctx.close();
  }

  // ---------- 4. taps fire exactly once ----------
  for (const [w, h] of [[360, 640], [390, 844]]) {
    const { ctx, page, T, tap, tapSel, center } = await open(w, h);
    await settle(page);
    const flagOn = () => page.evaluate(() => document.getElementById('flag-i').getAttribute('aria-pressed') === 'true');
    let expect = await flagOn();
    for (const hold of [40, 600, 1000]) { await tapSel('#flag-i', hold); expect = !expect; await page.waitForTimeout(150); ok(await flagOn() === expect, `${w}×${h}: flag i toggles exactly once on a ${hold} ms tap`); }
    const [bx, by] = await center('#flag-i'), blank = [8, h - 8];
    for (const hold of [40, 700]) {
      await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(60);
      await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }, { x: bx, y: by, id: 2 }]); await page.waitForTimeout(hold);
      await T('touchEnd', [{ x: bx, y: by, id: 2 }]); await page.waitForTimeout(150);
      await T('touchEnd', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(100);
      expect = !expect; ok(await flagOn() === expect, `${w}×${h}: flag tap (${hold} ms) with another finger down fires once`);
    }
    // tabs, with another finger down
    const [tx, ty] = await center('#tab-explain');
    await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(40);
    await T('touchStart', [{ x: blank[0], y: blank[1], id: 1 }, { x: tx, y: ty, id: 2 }]); await page.waitForTimeout(40);
    await T('touchEnd', [{ x: tx, y: ty, id: 2 }]); await T('touchEnd', [{ x: blank[0], y: blank[1], id: 1 }]); await page.waitForTimeout(100);
    ok(await page.evaluate(() => !document.getElementById('pane-explain').hidden), `${w}×${h}: tab switches with another finger down`);
    await tapSel('#tab-list');
    // sheet opens on a 1 s hold and stays open; × closes it once and nothing under the finger fires
    for (const hold of [40, 600, 1000]) {
      await page.evaluate(() => scrollTo(0, 0));
      await tapSel('#libBtn', hold); await page.waitForTimeout(250);
      ok(await page.evaluate(() => !document.getElementById('libSheet').hidden), `${w}×${h}: 範例庫 opens and stays open (${hold} ms)`);
      const before = await view(page);
      await tapSel('#libSheet [data-close]', hold); await page.waitForTimeout(300);
      const a = await page.evaluate(() => ({ closed: document.getElementById('libSheet').hidden, active: document.activeElement.id }));
      ok(a.closed && JSON.stringify(await view(page)) === JSON.stringify(before) && a.active !== 'pattern' && a.active !== 'text', `${w}×${h}: 關閉 closes once without touching what is underneath (${hold} ms, focus ${a.active})`);
    }
    // backdrop tap closes, the textarea underneath is not focused
    await tapSel('#csBtn'); await page.waitForTimeout(200);
    const bp = await page.evaluate(() => { const r = document.querySelector('#csSheet .sheet').getBoundingClientRect(); return [innerWidth / 2, Math.max(10, r.top - 30)]; });
    await tap(bp[0], bp[1], 600); await page.waitForTimeout(300);
    const b2 = await page.evaluate(() => ({ closed: document.getElementById('csSheet').hidden, active: document.activeElement.tagName }));
    ok(b2.closed && b2.active !== 'TEXTAREA' && b2.active !== 'INPUT', `${w}×${h}: backdrop tap closes 速查表 and focuses nothing underneath (${b2.active})`);
    // cheat-sheet item inserts exactly once
    await page.fill('#pattern', 'a'); await page.evaluate(() => { const p = document.getElementById('pattern'); p.focus(); p.setSelectionRange(1, 1); p.blur(); });
    await tapSel('#csBtn'); await page.waitForTimeout(200);
    await tapSel('#csBody .cs button', 1000); await page.waitForTimeout(200);
    ok((await view(page)).p === 'a.' && await page.evaluate(() => document.getElementById('csSheet').hidden), `${w}×${h}: 速查表 item inserts once on a 1 s hold (${(await view(page)).p})`);
    // match list item flashes the mark
    await page.fill('#pattern', '\\d'); await page.fill('#text', 'a1 b2 c3'); await settle(page);
    await tapSel('#mlist li:nth-child(2) button', 600);
    ok(await page.evaluate(() => document.querySelector('#hl mark[data-k="1"]').classList.contains('flash')), `${w}×${h}: match list item fires on release`);
    // keyboard activation still works
    await page.focus('#flag-m'); const m0 = await page.evaluate(() => document.getElementById('flag-m').getAttribute('aria-pressed'));
    await page.keyboard.press('Enter'); await page.waitForTimeout(50);
    ok(await page.evaluate(() => document.getElementById('flag-m').getAttribute('aria-pressed')) !== m0, `${w}×${h}: Enter on a flag still toggles it`);
    await ctx.close();
  }

  // ---------- 5. narrow layout ----------
  for (const [w, h] of [[320, 568], [360, 640], [390, 844]]) {
    const { ctx, page } = await open(w, h);
    const r = await page.evaluate(() => { const h1 = document.querySelector('.brand h1'), lb = document.getElementById('libBtn'); return { h1r: h1.getBoundingClientRect().right, lbl: lb.getBoundingClientRect().left, full: h1.scrollWidth <= h1.clientWidth, sw: document.documentElement.scrollWidth, iw: innerWidth }; });
    ok(r.h1r <= r.lbl, `${w}×${h}: title ends (${Math.round(r.h1r)}) before 範例庫 (${Math.round(r.lbl)})`);
    if (w >= 360) ok(r.full, `${w}×${h}: title shown in full`);
    ok(r.sw <= r.iw, `${w}×${h}: no horizontal scroll (${r.sw} ≤ ${r.iw})`);
    await page.evaluate(() => document.getElementById('libBtn').click());
    const s = await page.evaluate(() => { const sh = document.querySelector('#libSheet .sheet'), pts = [...document.querySelectorAll('#libList .pt')]; return { sw: sh.scrollWidth, cw: sh.clientWidth, ell: pts.every(p => p.getBoundingClientRect().right <= sh.getBoundingClientRect().right) }; });
    ok(s.sw <= s.cw && s.ell, `${w}×${h}: library sheet has no sideways scroll (${s.sw} ≤ ${s.cw}) and long patterns stay inside`);
    await ctx.close();
  }

  // ---------- 6. typing keeps highlights; identical results do not rebuild the list ----------
  {
    const { ctx, page } = await open(390, 844);
    await page.fill('#pattern', '\\d+'); await page.fill('#text', Array.from({ length: 60 }, (_, i) => `line ${i} value ${i * 7}`).join('\n')); await settle(page);
    const marks0 = await page.evaluate(() => document.querySelectorAll('#hl mark').length);
    const seen = await page.evaluate(async () => {
      const t = document.getElementById('text'), counts = [];
      const mo = new MutationObserver(() => counts.push(document.querySelectorAll('#hl mark').length)); mo.observe(document.getElementById('hl'), { childList: true });
      t.focus(); t.setSelectionRange(5, 5);
      for (const ch of 'abc') { t.setRangeText(ch, t.selectionStart, t.selectionStart, 'end'); t.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' })); await new Promise(r => setTimeout(r, 30)); }
      await new Promise(r => setTimeout(r, 400)); mo.disconnect(); return counts;
    });
    ok(marks0 === 120 && seen.length && Math.min(...seen) >= 119, `typing keeps the highlights (${marks0} → min ${Math.min(...seen)} during typing)`);
    ok(await page.evaluate(() => { const ms = [...document.querySelectorAll('#hl mark')]; return ms.length > 100 && ms.every(m => /^\d+$/.test(m.textContent)); }), 'marks after the edit point stay on the right text');
    const same = await page.evaluate(async () => {
      const li = document.querySelector('#mlist li'); const t = document.getElementById('text');
      t.value += ' x'; t.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 400)); return document.querySelector('#mlist li') === li;
    });
    ok(same, 'an edit that does not change the matches keeps the list as is');
    const lat = await page.evaluate(async () => { // best of three (shared CI machines are noisy)
      const p = document.getElementById('pattern'), best = [];
      for (const [pt, first] of [['\\d{2}', '14'], ['\\d', '0'], ['\\d{2}', '14'], ['\\d', '0'], ['\\d{2}', '14']]) {
        const t0 = performance.now(); p.value = pt; p.dispatchEvent(new Event('input', { bubbles: true }));
        while (document.querySelector('#mlist .mt')?.textContent !== first && performance.now() - t0 < 3000) await new Promise(r => requestAnimationFrame(r));
        best.push(performance.now() - t0); await new Promise(r => setTimeout(r, 100));
      }
      return Math.min(...best);
    });
    ok(lat < 190, `pattern input to result in ${Math.round(lat)} ms`);
    await ctx.close();
  }

  // ---------- 7 + 8. explainer, counts, error output, clear text, label ----------
  {
    const { ctx, page, tapSel } = await open(390, 844);
    const explain = async (p, f) => { await page.evaluate(([p, f]) => { document.querySelectorAll('.flag').forEach(b => { if ((b.getAttribute('aria-pressed') === 'true') !== f.includes(b.dataset.f)) b.click(); }); const e = document.getElementById('pattern'); e.value = p; e.dispatchEvent(new Event('input', { bubbles: true })); }, [p, f]); await settle(page);
      return page.evaluate(() => [...document.querySelectorAll('#explain .tok')].map(r => r.querySelector('code').textContent + ' = ' + r.querySelector('span').textContent)); };
    let ex = await explain('[\\b]', 'g');
    ok(/退格/.test(ex[0]) && !/單字邊界(?!）)/.test(ex[0].replace('不是單字邊界', '')), `[\\b] is backspace (${ex[0]})`);
    ex = await explain('\\u{41}', 'g');
    ok(/字面上的「u」/.test(ex[0]) && /剛好 41 次/.test(ex[1] || ''), `\\u{41} without u: literal u then {41} (${ex.slice(0, 2).join(' | ')})`);
    ex = await explain('\\u{41}', 'gu');
    ok(/U\+0041/.test(ex[0]), '\\u{41} with u: code point A');
    ex = await explain('[]a]', 'g');
    ok(/^\[\] = 空集合/.test(ex[0]) && ex.some(x => x.startsWith('a]') || x.startsWith('a')), `[]a] → empty set then literal (${ex.slice(0, 2).join(' | ')})`);
    ex = await explain('[^]', 'g');
    ok(/^\[\^\] = 任一字元（含換行）/.test(ex[0]), '[^] is any character');
    await page.fill('#text', '👋🏽 hi'); await explain('\\p{Emoji}+', 'gu');
    const head = await page.evaluate(() => document.querySelector('#mlist .mh').textContent);
    ok(/2 字元（4 個 UTF-16 單位）/.test(head), `count in code points with UTF-16 noted (${head})`);
    // indentation only in the code column
    await explain('(a(b))c', 'g');
    const xs = await page.evaluate(() => [...document.querySelectorAll('#explain .tok span')].map(s => Math.round(s.getBoundingClientRect().left)));
    ok(new Set(xs).size === 1, `explanation column stays aligned (${[...new Set(xs)].join(',')})`);
    // pattern error
    await explain('(a', 'g');
    const outs = await page.evaluate(() => [document.getElementById('replOut').textContent, document.getElementById('splitOut').textContent]);
    ok(/模式錯誤/.test(outs[0]) && /模式錯誤/.test(outs[1]), `取代/分割 say 模式錯誤 (${outs.join(' / ')})`);
    // clear text with undo
    await page.fill('#text', 'keep me'); await page.waitForTimeout(50);
    await tapSel('#clearBtn'); await page.waitForTimeout(100);
    ok((await view(page)).t === '' && (await state(page)).text === '', '清除文字 empties the text');
    await tapSel('#toastHost .toast-act'); await page.waitForTimeout(100);
    ok((await view(page)).t === 'keep me' && (await state(page)).text === 'keep me', '清除文字 復原 brings it back');
    ok(await page.evaluate(() => /測試文字/.test(document.querySelector('.lab').textContent) && !/TEST TEXT/.test(document.body.textContent)), 'section label is 測試文字');
    await ctx.close();
  }

  ok(!errors.length, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e && e.stack || e); console.log(`${pass} passed, ${fail + 1} failed`); process.exit(1); });
