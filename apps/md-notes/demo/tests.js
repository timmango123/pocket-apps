// Regression tests for md-notes (release review 2026-11-07 findings). Run: node tests.js
// Served over http like the site, phone-sized with real CDP touch where touch matters. Waits on conditions, no fixed sleeps.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const SKEL = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const HTML = SKEL + fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8') + '</body></html>';
let fails = 0, passes = 0;
const ok = (c, m) => { if (c) { passes++; console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(HTML); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/`;
  // a UTF-8 locale, or Chromium on a C-locale runner renames non-ASCII downloads (第一則.md) to "download"
  const browser = await chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdn-'));
  async function phone(w = 390, h = 844, extra = {}) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, extra));
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push('pageerror ' + e.message));
    p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ' ' + m.text()); });
    p.on('dialog', d => { errors.push('dialog ' + d.message()); d.dismiss(); });
    const cdp = await ctx.newCDPSession(p);
    return { ctx, p, cdp };
  }
  const go = async p => { await p.goto(URL); await p.waitForFunction(() => window.__mdReady === true); };
  const tap = async (cdp, x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  const rect = (p, sel) => p.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }, sel);
  const setBody = (p, body) => p.evaluate(b => { ed.value = b; ed.dispatchEvent(new Event('input')); }, body);
  const toastText = p => p.evaluate(() => document.getElementById('toastHost').textContent);

  try {
    // ---------- pure parser / helpers ----------
    {
      const { p } = await phone(); await go(p);
      const r = await p.evaluate(() => {
        const t0 = performance.now(); let quote = 'ok'; try { MD.render('>'.repeat(6000) + ' x'); } catch (e) { quote = 'THROW ' + e.message; }
        const t1 = performance.now(); MD.render(Array.from({ length: 800 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n')); const listMs = performance.now() - t1;
        return {
          quote, quoteMs: t1 - t0, listMs,
          ol: MD.render('我在\n2024. 年搬家').html, ol1: MD.render('a\n1. b').html,
          ent: MD.render('&copy; &amp; &#169; &#x1F600; &nbsp;x `&copy;` \\&copy; &bogus;').html,
          title: deriveTitle('a' + '😀'.repeat(15)), title20: deriveTitle('b' + '😀'.repeat(30)), safe: safeName('😀'.repeat(70)),
          words: countText('e-mail well-known x').words,
        };
      });
      ok(r.quote === 'ok', 'depth: 6000 nested quotes render without throwing (' + r.quote + ')');
      ok(r.listMs < 4000, 'depth: 800-level list renders in ' + Math.round(r.listMs) + ' ms (was 1.3 s, 1600 levels 15 s)');
      ok(!/<ol/.test(r.ol) && /<p[^>]*>我在\n2024\. 年搬家<\/p>/.test(r.ol), 'ordered list not starting at 1 does not interrupt a paragraph');
      ok(/<ol/.test(r.ol1), 'ordered list starting at 1 still interrupts a paragraph');
      ok(r.ent.includes('© &amp; © 😀  x <code>&amp;copy;</code> &amp;copy; &amp;bogus;'), 'HTML entities decoded (code/escaped/unknown kept literal): ' + r.ent);
      ok(r.title === 'a' + '😀'.repeat(15) && r.title20 === 'b' + '😀'.repeat(19), 'deriveTitle cuts by character, no half emoji: ' + JSON.stringify([r.title, r.title20]));
      ok(!/[\uD800-\uDBFF]$/.test(r.safe) && Array.from(r.safe).length === 60, 'safeName cuts by character');
      ok(r.words === 3, 'word count keeps hyphenated words together: ' + r.words);
      await p.context().close();
    }

    // ---------- editing, toolbar, preview on a phone ----------
    {
      const { p, cdp } = await phone(360, 640); await go(p);
      // undo/redo pinned at the right end, outside the scrolling part
      const tb = await p.evaluate(() => ({ undo: document.getElementById('undoBtn').getBoundingClientRect().right, redo: document.getElementById('redoBtn').getBoundingClientRect().right, inScroll: !!document.getElementById('undoBtn').closest('#tbScroll'), w: innerWidth }));
      ok(!tb.inScroll && tb.redo <= tb.w && tb.undo <= tb.w, 'undo/redo visible at 360 px without scrolling the toolbar: ' + JSON.stringify(tb));
      const tbtn = await rect(p, '#titleBtn');
      ok(tbtn.h >= 44, 'title button is at least 44 px tall: ' + tbtn.h);
      // italic on a bold selection -> ***ab***, and back
      await setBody(p, 'x **ab** y');
      await p.evaluate(() => { ed.focus(); ed.setSelectionRange(4, 6); ACTS.italic(); });
      ok(await p.inputValue('#editor') === 'x ***ab*** y', 'italic on bold text gives ***ab***');
      await p.evaluate(() => ACTS.italic());
      ok(await p.inputValue('#editor') === 'x **ab** y', 'italic again removes only the italic');
      await p.evaluate(() => { ed.setSelectionRange(2, 8); ACTS.bold(); });
      ok(await p.inputValue('#editor') === 'x ab y', 'bold on a selection that includes ** removes the bold');
      // preview is not re-rendered while hidden behind the edit tab
      await setBody(p, '第一段 alpha\n\n第二段 beta\n\n- [ ] 任務一\n- [ ] 任務二');
      await p.waitForFunction(() => /\d/.test(document.getElementById('stCount').textContent) && document.getElementById('saveState').textContent === '已儲存');
      ok(!(await p.evaluate(() => document.getElementById('mdOut').textContent.includes('alpha'))), 'hidden preview is not rendered while editing on a phone');
      await tap(cdp, (await rect(p, '#tabPrev')).cx, (await rect(p, '#tabPrev')).cy);
      await p.waitForFunction(() => document.getElementById('mdOut').textContent.includes('alpha'));
      ok(true, 'preview renders when its tab is shown');
      // checkbox: tapping 20 px right of the box centre still toggles
      const box = await rect(p, '#mdOut input[data-task]');
      await tap(cdp, box.cx + 20, box.cy);
      await p.waitForFunction(() => ed.value.includes('- [x] 任務一'));
      ok(true, 'task box toggles from a tap 20 px right of its centre');
      const box2 = await rect(p, '#mdOut li.task:nth-child(2) input');
      await tap(cdp, box2.cx, box2.cy + 14);
      await p.waitForFunction(() => ed.value.includes('- [x] 任務二'));
      ok(true, 'task box toggles from a tap 14 px below its centre');
      // single taps on two different paragraphs are not a double tap; two taps on one spot are
      const tabAfter = await p.evaluate(() => {
        const ps = document.querySelectorAll('#mdOut p');
        const click = (el, dx = 0) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 10 + dx, clientY: r.top + 5 })); };
        click(ps[0]); click(ps[1]);
        const a = tab;
        lastTap = null; click(ps[0]); click(ps[0], 4);
        return [a, tab, ed.selectionStart];
      });
      ok(tabAfter[0] === 'prev', 'two quick single taps on different paragraphs stay in the preview');
      ok(tabAfter[1] === 'edit' && tabAfter[2] === 0, 'double tap on one paragraph jumps to its source line');
      ok(/連點兩下/.test(await toastText(p)), 'first tap in the preview shows the double-tap hint once');
      // menu open: a tap outside only closes it
      await setBody(p, 'abc');
      await p.waitForFunction(() => document.getElementById('saveState').textContent === '已儲存');
      const more = await rect(p, '#moreBtn'); await tap(cdp, more.cx, more.cy);
      await p.waitForFunction(() => !document.getElementById('menu').hidden);
      const bBtn = await rect(p, '[data-act="bold"]'); await tap(cdp, bBtn.cx, bBtn.cy);
      await p.waitForFunction(() => document.getElementById('menu').hidden);
      ok(await p.inputValue('#editor') === 'abc', 'tap on B while the menu is open only closes the menu');
      await p.evaluate(() => setTab('prev'));
      await tap(cdp, more.cx, more.cy); await p.waitForFunction(() => !document.getElementById('menu').hidden);
      const tEd = await rect(p, '#tabEdit'); await tap(cdp, tEd.cx, tEd.cy);
      await p.waitForFunction(() => document.getElementById('menu').hidden);
      ok(await p.evaluate(() => tab) === 'prev', 'tap on 編輯 while the menu is open does not switch tabs');
      await tap(cdp, tEd.cx, tEd.cy); await p.waitForFunction(() => tab === 'edit');
      await tap(cdp, bBtn.cx, bBtn.cy);
      await p.waitForFunction(() => ed.value.includes('**'));
      ok(true, 'next tap on B works normally');
      // drawer: no autofocus of the search box on touch; swipe hint once; markdown-free preview line
      await p.evaluate(() => newNote('# 標題\n這是**粗體**與[連結](https://a.b)'));
      await p.evaluate(() => { document.getElementById('toastHost').innerHTML = ''; });
      const mb = await rect(p, '#menuDrawerBtn'); await tap(cdp, mb.cx, mb.cy);
      await p.waitForFunction(() => document.getElementById('drawer').classList.contains('open'));
      await p.waitForFunction(() => document.querySelector('#noteList .item.cur .ip'));
      const dr = await p.evaluate(() => new Promise(r => setTimeout(() => r({ active: document.activeElement.id, ip: document.querySelector('#noteList .item.cur .ip').textContent, toast: document.getElementById('toastHost').textContent }), 400)));
      ok(dr.active !== 'searchInput', 'opening the list on a phone does not focus the search box: ' + dr.active);
      ok(dr.ip === '這是粗體與連結', 'list preview line has no Markdown symbols: ' + dr.ip);
      ok(/向左滑/.test(dr.toast), 'swipe-to-delete hint shown: ' + dr.toast);
      // new note straight from the top bar
      const nb = await rect(p, '#scrim'); await tap(cdp, nb.x + nb.w - 10, 300);
      await p.waitForFunction(() => document.getElementById('drawer').getBoundingClientRect().right <= 0); // slid away
      const before = await p.evaluate(() => notes.length);
      const nt = await rect(p, '#newTopBtn'); await tap(cdp, nt.cx, nt.cy);
      await p.waitForFunction(n => notes.length === n + 1 && ed.value === '', before);
      ok(true, 'top-bar 新筆記 button creates a note in one tap');
      await p.context().close();
    }

    // ---------- multi-touch: controls act on pointerup (review round 2 veto) ----------
    {
      const { p, cdp } = await phone(); await go(p);
      const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 4, radiusY: 4 })) });
      const idle = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
      let tid = 100;
      // finger 2 lands while finger 1 is still down, then finger 1 lifts (real fast two-thumb alternation).
      // CDP: touchStart lists every active point; touchEnd lists the points being lifted.
      async function overlap(A, B, n) {
        let prev = null;
        for (let i = 0; i < n; i++) {
          const c = i % 2 ? B : A, cur = [c.x, c.y, tid++];
          await T('touchStart', prev ? [prev, cur] : [cur]);
          if (prev) await T('touchEnd', [prev]);
          prev = cur; await idle();
        }
        await T('touchEnd', [prev]); await idle();
      }
      // the release reviewer's probe sequence (qa/release/md-notes/r2/overlap.js): it lifts the new point and re-lists the old one
      async function overlapProbe(A, B, n) {
        let prev = null, id = 1;
        for (let i = 0; i < n; i++) {
          const c = i % 2 ? B : A, cur = [c.x, c.y, id++];
          await T('touchStart', prev ? [prev, cur] : [cur]);
          if (prev) await T('touchEnd', [cur]);
          prev = cur; await idle();
        }
        await T('touchEnd', []); await idle();
      }
      await p.evaluate(() => { hints.swipe = hints.jump = 1; window.__n = { bold: 0, italic: 0 }; for (const k of ['bold', 'italic']) { const f = ACTS[k]; ACTS[k] = () => { __n[k]++; f(); }; } ed.focus(); });
      const cB = await rect(p, '[data-act=bold]'), cI = await rect(p, '[data-act=italic]');
      for (const [name, fn] of [['real overlap', overlap], ['reviewer probe sequence', overlapProbe]]) {
        await p.evaluate(() => { __n.bold = __n.italic = 0; });
        await fn({ x: cB.cx, y: cB.cy }, { x: cI.cx, y: cI.cy }, 16);
        await p.waitForFunction(() => __n.bold + __n.italic >= 16, null, { timeout: 5000 }).catch(() => {});
        await idle();
        const nBI = await p.evaluate(() => Object.assign({}, __n));
        ok(nBI.bold === 8 && nBI.italic === 8, `overlapping two-finger taps on B/I (${name}): 16/16 ` + JSON.stringify(nBI));
      }
      await p.evaluate(() => { window.__t = { prev: 0, edit: 0 }; const o = setTab; window.setTab = t => { __t[t]++; o(t); }; });
      const tP = await rect(p, '#tabPrev'), tE = await rect(p, '#tabEdit');
      for (const [name, fn] of [['real overlap', overlap], ['reviewer probe sequence', overlapProbe]]) {
        await p.evaluate(() => { __t.prev = __t.edit = 0; });
        await fn({ x: tP.cx, y: tP.cy }, { x: tE.cx, y: tE.cy }, 16);
        await p.waitForFunction(() => __t.prev + __t.edit >= 16, null, { timeout: 5000 }).catch(() => {});
        await idle();
        const nT = await p.evaluate(() => Object.assign({}, __t));
        ok(nT.prev === 8 && nT.edit === 8, `overlapping two-finger taps on the tabs (${name}): 16/16 ` + JSON.stringify(nT));
      }
      await p.evaluate(() => { window.setTab = __t && setTab; });
      // a tap with another finger resting on the editor works on every kind of control
      await p.evaluate(async () => { await newNote('# 甲\n\n段落\n\n- [ ] 一\n- [ ] 二\n'); window.__c = 0; window.__ct = 0; document.addEventListener('click', e => { __c++; if (e.isTrusted) __ct++; }); });
      const R = () => p.evaluate(() => { closeMenu(); closeDrawer(); dlgHost.innerHTML = ''; toastHost.innerHTML = ''; setTab('edit'); });
      async function withRest(sel, rest = [200, 400]) {
        const c = await rect(p, sel);
        await T('touchStart', [[rest[0], rest[1], tid]]);
        await T('touchStart', [[rest[0], rest[1], tid], [c.cx, c.cy, tid + 1]]); await idle();
        await T('touchEnd', [[c.cx, c.cy, tid + 1]]); await idle(); // the tap ends while the other finger still rests
        await T('touchEnd', [[rest[0], rest[1], tid]]); tid += 2; await idle();
      }
      const st = () => p.evaluate(() => ({ drawer: drawer.classList.contains('open'), menu: !menu.hidden, tab, dlg: !!document.querySelector('.dlg'), n: notes.length, theme: prefs.theme, body: ed.value, boxes: [...document.querySelectorAll('#mdOut li.task input')].map(i => i.checked ? 1 : 0).join('') }));
      const cases = [
        ['B', '', '[data-act=bold]', s => s.body.includes('**')],
        ['預覽 tab', '', '#tabPrev', s => s.tab === 'prev'],
        ['☰', '', '#menuDrawerBtn', s => s.drawer],
        ['⋮', '', '#moreBtn', s => s.menu],
        ['新筆記 (top)', '', '#newTopBtn', (s, s0) => s.n === s0.n + 1],
        ['menu 深色', 'openMenu()', '[data-theme-v=dark]', s => s.theme === 'dark'],
        ['task box', 'openNote(notes.find(n => n.body.startsWith("# 甲"))).then(() => setTab("prev"))', '#mdOut label.tbox', s => s.boxes === '10'],
        ['dialog 取消', 'void ask("刪除筆記","x",[{v:false,t:"取消"},{v:true,t:"刪除",cls:"dan"}])', '.dlg .btn', s => !s.dlg],
      ];
      for (const [name, setup, sel, check] of cases) {
        await R(); await p.evaluate(s => s ? eval(s) : null, setup); await idle(); await idle();
        const s0 = await st();
        await withRest(sel, name === 'menu 深色' ? [100, 400] : [200, 400]);
        const s1 = await st();
        ok(check(s1, s0), `tap with another finger resting: ${name} works`);
      }
      await p.evaluate(() => { prefs.theme = 'auto'; applyPrefs(); });
      // single, 0.6 s and 1 s taps fire exactly once, with no extra click reaching the page
      await R(); await p.evaluate(() => { window.__nb = 0; const f = ACTS.bold; ACTS.bold = () => { __nb++; f(); }; });
      for (const hold of [0, 600, 1000]) {
        await p.evaluate(() => { __nb = 0; __c = 0; __ct = 0; });
        const t0 = Date.now();
        await T('touchStart', [[cB.cx, cB.cy, tid]]);
        await p.waitForFunction(ms => performance.now() >= ms, (await p.evaluate(() => performance.now())) + hold);
        await T('touchEnd', []); tid++;
        await p.waitForFunction(() => __nb >= 1, null, { timeout: 5000 }).catch(() => {});
        await p.evaluate(() => new Promise(r => setTimeout(r, 450)));
        const r = await p.evaluate(() => [__nb, __c, __ct]);
        ok(r[0] === 1 && r[1] === 1 && r[2] === 0, `B pressed ${hold} ms fires exactly once, no browser click follows (actions, clicks, trusted) = ${r}`);
      }
      // the dialog backdrop (not a button) still closes on a plain tap right after a button tap
      await R(); await p.evaluate(() => { void ask('刪除筆記', 'x', [{ v: false, t: '取消' }, { v: true, t: '刪除', cls: 'dan' }]); });
      await p.waitForSelector('.dlg .btn');
      const db = await rect(p, '.dlg .btn'); await tap(cdp, db.cx, db.cy);
      await p.waitForFunction(() => !document.querySelector('.dlg'));
      await p.evaluate(() => { void ask('刪除筆記', 'x', [{ v: false, t: '取消' }, { v: true, t: '刪除', cls: 'dan' }]); });
      await tap(cdp, 20, 100);
      await p.waitForFunction(() => !document.querySelector('.dlg'), null, { timeout: 5000 }).catch(() => {});
      ok(await p.evaluate(() => !document.querySelector('.dlg')), 'tapping the dialog backdrop right after a button tap closes it');
      // buttons that remove themselves on tap (dialog, copy dialog, toast) must not let the touch fall through to the editor
      for (const [name, open, sel] of [
        ['dialog 取消', () => { void ask('刪除筆記', 'x', [{ v: false, t: '取消' }, { v: true, t: '刪除', cls: 'dan' }]); }, '.dlg .btn'],
        ['dialog 刪除', () => { void ask('刪除筆記', 'x', [{ v: false, t: '取消' }, { v: true, t: '刪除', cls: 'dan' }]); }, '.dlg .btn.dan'],
        ['copy 關閉', () => copyDialog('Markdown 原文', 'abc'), '#cdClose'],
        ['toast 復原', () => toast('已刪除', '復原', () => {}), '.toast button'],
      ]) {
        await R(); await p.evaluate(() => { setTab('edit'); ed.value = 'x\n'.repeat(400); ed.setSelectionRange(0, 0); ed.blur(); });
        await p.evaluate(open); await p.waitForSelector(sel);
        const c = await rect(p, sel);
        const under = await p.evaluate(([x, y, s]) => { const el = document.querySelector(s); el.style.visibility = 'hidden'; const u = document.elementFromPoint(x, y); el.style.visibility = ''; return u && u.id; }, [c.cx, c.cy, sel]);
        await tap(cdp, c.cx, c.cy); await idle(); await idle();
        await p.evaluate(() => new Promise(r => setTimeout(r, 150)));
        const f = await p.evaluate(() => [document.activeElement.id, ed.selectionStart]);
        ok(f[0] !== 'editor' && f[1] === 0, `${name} tap does not focus the editor underneath (under: ${under}): ` + f);
      }
      // two fingers landing in the same touch event, lifting one after the other: both act
      await R(); await p.evaluate(() => { __nb = 0; window.__ni = 0; const f = ACTS.italic; ACTS.italic = () => { __ni++; f(); }; });
      await T('touchStart', [[cB.cx, cB.cy, tid], [cI.cx, cI.cy, tid + 1]]); await idle();
      await T('touchEnd', [[cB.cx, cB.cy, tid]]); await idle();
      await T('touchEnd', [[cI.cx, cI.cy, tid + 1]]); tid += 2; await idle();
      ok(await p.evaluate(() => __nb === 1 && __ni === 1), 'B and I pressed in the same touch event both act once');
      // the 復原 toast sits above the toolbar
      await R(); await p.evaluate(() => toast('已刪除', '復原', () => {}));
      const ov = await p.evaluate(() => { const t = document.querySelector('.toast').getBoundingClientRect(); return [t.bottom, document.getElementById('toolbar').getBoundingClientRect().top]; });
      ok(ov[0] <= ov[1], 'undo toast does not cover the toolbar: ' + ov);
      // an outside press on the open menu that turns into a scroll leaves no swallow flag behind
      await R(); await p.evaluate(() => openMenu()); await idle();
      await T('touchStart', [[200, 500, tid]]);
      for (let i = 1; i <= 6; i++) await T('touchMove', [[200, 500 - i * 30, tid]]);
      await T('touchEnd', []); tid++; await idle();
      const leak = await p.evaluate(() => ({ menu: !menu.hidden, flag: swallowClick }));
      await p.evaluate(() => document.getElementById('tabPrev').focus()); await p.keyboard.press('Enter');
      ok(!leak.menu && !leak.flag && await p.evaluate(() => tab) === 'prev', 'outside scroll-press closes the menu and keyboard Enter still works ' + JSON.stringify(leak));
      // task rows: a tap 13 px below a box toggles that same item
      await R(); await p.evaluate(async () => { await openNote(notes.find(n => n.body.startsWith('# 甲'))); ed.value = '- [ ] 一\n- [ ] 二\n- [ ] 三'; ed.dispatchEvent(new Event('input')); setTab('prev'); });
      const b1 = await rect(p, '#mdOut li.task input');
      await tap(cdp, b1.cx, b1.cy + 13);
      await p.waitForFunction(() => ed.value.startsWith('- [x] 一'));
      ok(await p.evaluate(() => ed.value === '- [x] 一\n- [ ] 二\n- [ ] 三'), 'tap 13 px below the first box toggles the first item only');
      const lh = await p.evaluate(() => [...document.querySelectorAll('#mdOut li.task')].map(l => Math.round(l.getBoundingClientRect().height)));
      ok(lh.every(h => h >= 44), 'task rows are at least 44 px tall: ' + lh);
      // hint toasts let taps through; tags never wrap; segment buttons 44 px; 6th toolbar button at least half visible at 360 px
      await p.evaluate(() => toast('提示'));
      ok(await p.evaluate(() => getComputedStyle(document.querySelector('.toast')).pointerEvents) === 'none', 'hint toast (no button) does not block taps');
      await p.evaluate(() => { ed.value = 'x #範例'; renderNow(); openMenu(); });
      const misc = await p.evaluate(() => ({ tag: getComputedStyle(document.querySelector('#mdOut .tag')).whiteSpace, seg: Math.min(...[...document.querySelectorAll('.menu .seg button')].map(b => b.getBoundingClientRect().height)) }));
      ok(misc.tag === 'nowrap' && misc.seg >= 44, 'tag pill nowrap, segment buttons ≥ 44 px ' + JSON.stringify(misc));
      await p.context().close();
      const { p: p3 } = await phone(360, 640); await go(p3);
      const six = await p3.evaluate(() => { const sc = document.getElementById('tbScroll').getBoundingClientRect(); const b = document.querySelectorAll('#tbScroll .tb')[5].getBoundingClientRect(); return (Math.min(b.right, sc.right) - b.left) / b.width; });
      ok(six >= 0.5, '6th toolbar button visible at 360 px: ' + Math.round(six * 100) + '%');
      // intraword underscores stay literal
      const us = await p3.evaluate(() => [MD.render('中文_強調_中文').html, MD.render('snake_case_name').html, MD.render('a _強調_ b').html]);
      ok(!us[0].includes('<em>') && !us[1].includes('<em>') && us[2].includes('<em>強調</em>'), 'underscore emphasis only at word boundaries: ' + us.join(' | '));
      // huge note: switching to the preview shows a busy message first
      await p3.evaluate(() => { ed.value = 'x'.repeat(1100000); ed.dispatchEvent(new Event('input')); });
      const deb = await p3.evaluate(() => new Promise(r => { const t0 = performance.now(); const o = Store.putNote; Store.putNote = n => { Store.putNote = o; r(performance.now() - t0); return o.call(Store, n); }; ed.value += 'y'; ed.dispatchEvent(new Event('input')); }));
      ok(deb >= 1900, 'huge note waits about 2 s after the last keystroke before saving: ' + Math.round(deb) + ' ms');
      const busy = await p3.evaluate(() => { setTab('prev'); return document.getElementById('mdOut').textContent; });
      ok(/處理中/.test(busy), 'huge note shows 處理中… before rendering the preview');
      await p3.waitForFunction(() => !/處理中/.test(document.getElementById('mdOut').textContent), null, { timeout: 60000 });
      await p3.context().close();
      const dctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }); const dp = await dctx.newPage();
      dp.on('pageerror', e => errors.push('desk pageerror ' + e.message));
      await go(dp);
      await dp.evaluate(() => { window.__nb = 0; const f = ACTS.bold; ACTS.bold = () => { __nb++; f(); }; });
      await dp.click('[data-act=bold]');
      await dp.focus('[data-act=italic]'); await dp.keyboard.press('Enter');
      const dr = await dp.evaluate(() => [__nb, prefs.fs, ed.value.includes('***粗體文字***')]);
      ok(dr[0] === 1 && dr[2], 'desktop mouse click acts once, keyboard Enter on a button acts: ' + dr);
      await dctx.close();
    }

    // ---------- data safety ----------
    {
      const { p } = await phone();
      await p.addInitScript(() => { window.__persist = 0; try { const s = navigator.storage; if (s) s.persist = () => { window.__persist++; return Promise.resolve(true); }; } catch {} });
      await go(p);
      // quick reload right after typing keeps the last characters
      await p.focus('#editor'); await p.keyboard.press('End');
      await p.evaluate(() => { ed.setSelectionRange(ed.value.length, ed.value.length); });
      await p.keyboard.type('最後幾個字XYZ');
      await p.reload(); await p.waitForFunction(() => window.__mdReady === true);
      ok((await p.inputValue('#editor')).endsWith('最後幾個字XYZ'), 'text typed right before a reload survives');
      ok(await p.evaluate(() => localStorage.getItem('md-notes:v1:pending')) === null, 'pending copy cleared after it is applied');
      ok(await p.evaluate(() => window.__persist) === 0, 'storage.persist() is not requested on save');
      // delete within the save delay, then undo: the last keystrokes come back
      await p.evaluate(() => newNote('第一則'));
      await p.focus('#editor'); await p.keyboard.press('End');
      await p.evaluate(() => ed.setSelectionRange(ed.value.length, ed.value.length));
      await p.keyboard.type('尾巴');
      await p.evaluate(() => { openDrawer(); document.querySelector('#noteList .item.cur .del').click(); });
      await p.waitForFunction(() => /已刪除/.test(document.getElementById('toastHost').textContent));
      await p.click('.toast button');
      await p.waitForFunction(() => ed.value === '第一則尾巴');
      ok(true, 'undo after deleting an unsaved note restores the last keystrokes');
      await p.evaluate(() => closeDrawer());
      // export downloads real files; backup round-trips through import
      await p.click('#moreBtn');
      const [dmd] = await Promise.all([p.waitForEvent('download'), p.click('[data-m="md"]')]);
      ok(/\.md$/.test(dmd.suggestedFilename()) && fs.readFileSync(await dmd.path(), 'utf8') === '第一則尾巴', '匯出 .md downloads a file: ' + dmd.suggestedFilename());
      await p.click('#moreBtn');
      const [dbk] = await Promise.all([p.waitForEvent('download'), p.click('[data-m="backup"]')]);
      const bkPath = path.join(tmp, dbk.suggestedFilename()); await dbk.saveAs(bkPath);
      const bk = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
      ok(/^md-notes-backup-\d{8}\.json$/.test(dbk.suggestedFilename()) && bk.notes.length >= 2, 'backup downloads a JSON file with every note');
      ok(/改用複製/.test(await toastText(p)), 'download toast offers the copy fallback');
      await p.evaluate(() => notes.splice(0).forEach(n => Store.delNote(n.id)));
      await p.setInputFiles('#importFile', bkPath);
      await p.waitForFunction(() => /已匯入/.test(document.getElementById('toastHost').textContent));
      ok(await p.evaluate(n => notes.length === n, bk.notes.length), 'backup file imports back');
      // import reports skipped entries
      const bad = path.join(tmp, 'mixed.json');
      fs.writeFileSync(bad, JSON.stringify({ notes: [{ id: 'imp-ok', body: '好的' }, { id: 3, body: 'x' }, { id: 'a' }, null] }));
      await p.setInputFiles('#importFile', bad);
      await p.waitForFunction(() => /略過 3 則/.test(document.getElementById('toastHost').textContent));
      ok(true, 'import says how many entries were skipped');
      // overwriting import can be undone from its toast
      const ow = path.join(tmp, 'ow.json');
      fs.writeFileSync(ow, JSON.stringify({ notes: [{ id: 'imp-ok', body: '覆蓋後' }, { id: 'imp-new', body: '新來的' }] }));
      await p.evaluate(() => { toastHost.innerHTML = ''; });
      await p.setInputFiles('#importFile', ow);
      await p.waitForSelector('.dlg .btn.dan'); await p.click('.dlg .btn.dan');
      await p.waitForFunction(() => /已匯入 2/.test(document.getElementById('toastHost').textContent));
      await p.click('.toast button');
      await p.waitForFunction(() => /已復原/.test(document.getElementById('toastHost').textContent));
      ok(await p.evaluate(() => notes.find(n => n.id === 'imp-ok')?.body === '好的' && !notes.some(n => n.id === 'imp-new')), 'undo of an overwriting import restores the old note and drops the new one');
      // deeply nested note: boots fine and shows a message instead of a stack overflow
      await p.evaluate(async () => { ed.value = '>'.repeat(20000) + ' x\n\n' + Array.from({ length: 300 }, (_, i) => ' '.repeat(i * 2) + '- y').join('\n'); markDirty(); await saveNow(); });
      await p.reload(); await p.waitForFunction(() => window.__mdReady === true);
      await p.click('#tabPrev'); await p.waitForFunction(() => document.getElementById('mdOut').textContent.length > 0);
      ok((await p.inputValue('#editor')).length > 20000, 'deeply nested note boots and opens');
      await p.context().close();
    }
  } catch (e) { fails++; console.log('FAIL exception: ' + (e && e.stack || e)); }
  ok(errors.length === 0, 'no page or console errors: ' + JSON.stringify(errors.slice(0, 5)));
  await browser.close(); srv.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`${fails ? 'FAIL' : 'PASS'} md-notes: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
