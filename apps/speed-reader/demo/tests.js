// 閱讀速度訓練：上架重審第 1 輪的回歸測試（node tests.js，約 40 秒）。
// 每一項對應 score.json 的 toFix：觸控（另一指放著、兩指重疊、detail 0 補發 click）、打字後馬上重新整理、
// 25 萬字長文、壞存檔、閱讀畫面不切字（四種尺寸 × 範例全部詞組）、清空可復原、.md 匯入、小測未作答、
// 英文中夾中文、預估時間（獨立手算）、暫停跳句後結束要存位置、開始鈕不用捲動、1/2/3 鈕高度、統計圖刻度。
// 頁面用本機 http 伺服器載入（重新整理要保留 localStorage 和 IndexedDB）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const open = async (w, h, ctx0) => {
    const ctx = ctx0 || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(`${w}x${h} ${e.message}`));
    p.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    await p.goto(URL); await p.waitForFunction(() => window.__sr); await p.evaluate(() => __sr.ready);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b0 = e.getBoundingClientRect(); if (b0.top < 0 || b0.bottom > innerHeight - 90) e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async (sel, hold = 40) => { const c = await center(sel); await T('touchStart', [[c[0], c[1], 1]]); await W(hold); await T('touchEnd', [[c[0], c[1], 1]]); await W(30); };
    return { ctx, p, T, center, tap };
  };
  const st = p => p.evaluate(() => ({ speed: __sr.R.speed, i: __sr.R.i, playing: __sr.R.playing, reader: !document.getElementById('reader').hidden, theme: __sr.theme(), chunk: __sr.prefs.chunk, lib: !document.getElementById('libDlg').hidden, stats: !document.getElementById('statsDlg').hidden }));

  try {
    // ---------- 1. touch ----------
    {
      const { ctx, p, T, center, tap } = await open(390, 844);
      await tap('#startBtn'); await p.waitForFunction(() => __sr.R.playing);
      await tap('#playBtn'); await p.waitForFunction(() => !__sr.R.playing);
      const rest = await center('#rTitle');
      const withRest = async (sel, fn) => {
        await T('touchStart', [[rest[0], rest[1], 7]]); await W(150);
        const c = await center(sel); await T('touchStart', [[rest[0], rest[1], 7], [c[0], c[1], 8]]); await W(40);
        await T('touchEnd', [[c[0], c[1], 8]]); await W(40); if (fn) await fn(); await T('touchEnd', [[rest[0], rest[1], 7]]); await W(40);
      };
      let s0 = await st(p); await withRest('#faster'); let s1 = await st(p);
      eq(s1.speed - s0.speed, 25, 'finger resting: +25 acts once');
      await withRest('#slower'); eq((await st(p)).speed - s1.speed, -25, 'finger resting: −25 acts once');
      s0 = await st(p); await withRest('#nextSent'); s1 = await st(p); assert(s1.i > s0.i, 'finger resting: 句 › moves on');
      await withRest('#playBtn'); assert((await st(p)).playing, 'finger resting: 繼續 resumes');
      await withRest('#playBtn'); assert(!(await st(p)).playing, 'finger resting: 暫停 pauses');
      // overlapping two-finger taps, both lift orders
      for (const order of ['first', 'second']) {
        s0 = await st(p); const a = await center('#faster'), b = await center('#nextSent');
        await T('touchStart', [[a[0], a[1], 3]]); await W(50); await T('touchStart', [[a[0], a[1], 3], [b[0], b[1], 4]]); await W(50);
        if (order === 'first') { await T('touchEnd', [[a[0], a[1], 3]]); await W(30); await T('touchEnd', [[b[0], b[1], 4]]); }
        else { await T('touchEnd', [[b[0], b[1], 4]]); await W(30); await T('touchEnd', [[a[0], a[1], 3]]); }
        await W(40); s1 = await st(p);
        assert(s1.speed - s0.speed === 25 && s1.i > s0.i, `overlapping taps (${order} lifts first): both act (speed ${s1.speed - s0.speed}, i ${s0.i}→${s1.i})`);
      }
      // detail-0 click after a tap: on the button, its edge point and elementFromPoint → once
      s0 = await st(p); const fc = await center('#faster'); await tap('#faster');
      await p.evaluate(([x, y]) => {
        const f = document.getElementById('faster'), r = f.getBoundingClientRect(), mk = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
        f.dispatchEvent(mk()); document.elementFromPoint(r.right - 1, r.bottom - 1).dispatchEvent(mk()); document.elementFromPoint(x, y).dispatchEvent(mk());
      }, fc);
      eq((await st(p)).speed - s0.speed, 25, 'tap +25 then three detail-0 clicks: +25 once');
      await W(850); s0 = await st(p);
      await p.evaluate(() => document.getElementById('faster').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      eq((await st(p)).speed - s0.speed, 25, 'lone detail-0 click (keyboard / screen reader) acts once');
      s0 = await st(p); await tap('#nextSent');
      await p.evaluate(() => document.getElementById('nextSent').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
      s1 = await st(p); const sentOf = i => p.evaluate(i => __sr.R.doc.items[i].sent, i);
      eq((await sentOf(s1.i)) - (await sentOf(s0.i)), 1, 'tap 句 › then detail-0 click: one sentence');
      // held taps
      for (const hold of [600, 1000]) { s0 = await st(p); await tap('#faster', hold); eq((await st(p)).speed - s0.speed, 25, `hold ${hold} ms on +25 acts once`); }
      // 結束 changes the screen: a detail-0 click at that point must not run what is now underneath
      const ex = await center('#exitBtn'); const th0 = (await st(p)).theme;
      await tap('#exitBtn');
      await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, ex);
      s1 = await st(p); assert(!s1.reader && s1.theme === th0 && !s1.lib && !s1.stats, '結束 closes the reader and nothing on the main screen runs');
      eq(await p.evaluate(() => document.activeElement.tagName), 'BUTTON', 'no text field focused after the screen change');
      // main screen buttons with a finger resting on the heading
      const restM = await center('h1');
      const withRestM = async sel => { await T('touchStart', [[restM[0], restM[1], 7]]); await W(150); const c = await center(sel);
        await T('touchStart', [[restM[0], restM[1], 7], [c[0], c[1], 8]]); await W(40); await T('touchEnd', [[c[0], c[1], 8]]); await W(40); await T('touchEnd', [[restM[0], restM[1], 7]]); await W(40); };
      await withRestM('#themeBtn'); assert((await st(p)).theme !== th0, 'finger resting: theme button acts');
      await tap('#themeBtn'); await tap('#themeBtn');
      eq((await st(p)).theme, th0, 'theme cycles back after three taps');
      await withRestM('#chunk3'); eq((await st(p)).chunk, 3, 'finger resting: 每次 3 acts');
      await tap('#chunk1'); eq((await st(p)).chunk, 1, 'tap 每次 1');
      await withRestM('#libBtn'); assert((await st(p)).lib, 'finger resting: 文庫 opens');
      await tap('#libClose'); assert(!(await st(p)).lib, '關閉 closes 文庫');
      const pc0 = await p.evaluate(() => __sr.prefs.punct); await tap('label.tg'); eq(await p.evaluate(() => __sr.prefs.punct), !pc0, 'tap on a toggle label flips it once');
      await tap('label.tg'); eq(await p.evaluate(() => __sr.prefs.punct), pc0, 'second tap flips it back');
      await withRestM('#startBtn'); assert((await st(p)).reader, 'finger resting: 開始閱讀 opens the reader');
      await tap('#exitBtn');
      await ctx.close();
    }

    // ---------- 2/3. saving typed text, long text ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      let { p } = await open(390, 844, ctx);
      await p.fill('#text', ''); await p.locator('#text').pressSequentially('我今天讀了一本書', { delay: 10 }); await W(20);
      await p.reload(); await p.waitForFunction(() => window.__sr); await p.evaluate(() => __sr.ready);
      eq(await p.$eval('#text', e => e.value), '我今天讀了一本書', 'typed text survives a reload 20 ms later');
      await p.locator('#text').pressSequentially('，關閉前', { delay: 10 }); await W(20);
      await p.close({ runBeforeUnload: true });
      p = await ctx.newPage(); p.on('pageerror', e => errors.push('reopen ' + e.message)); await p.goto(URL); await p.waitForFunction(() => window.__sr); await p.evaluate(() => __sr.ready);
      eq(await p.$eval('#text', e => e.value), '我今天讀了一本書，關閉前', 'typed text survives closing the tab');
      const big = '長篇小說的第一章，主角走進了城市。'.repeat(16000).slice(0, 250000);
      await p.evaluate(t => { const ta = document.getElementById('text'); ta.value = t; ta.dispatchEvent(new Event('input')); }, big);
      await p.waitForFunction(() => document.getElementById('saveWarn').hidden); await W(300);
      await p.reload(); await p.waitForFunction(() => window.__sr); await p.evaluate(() => __sr.ready);
      eq(await p.$eval('#text', e => e.value.length), 250000, '250 000-character text is still there after reload (IndexedDB)');
      assert(await p.$eval('#text', e => e.value) === big, '…with exactly the same content');
      await p.fill('#text', '短文。'); await W(50); await p.reload(); await p.waitForFunction(() => window.__sr); await p.evaluate(() => __sr.ready);
      eq(await p.$eval('#text', e => e.value), '短文。', 'going back to a short text after a long one restores the short one');
      // 6. 清空 + 復原
      await p.fill('#text', '我自己貼上的重要文章內容。'); await W(50);
      const cdp = await ctx.newCDPSession(p); const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1 })) });
      const tap = async sel => { const c = await p.$eval(sel, e => { e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }); await T('touchStart', [c]); await W(40); await T('touchEnd', [c]); await W(40); };
      await tap('#clearText'); eq(await p.$eval('#text', e => e.value), '', '清空 empties the box');
      assert(await p.$eval('#toastAct', e => !e.hidden && e.textContent === '復原'), '清空 shows a 復原 button');
      await tap('#toastAct'); eq(await p.$eval('#text', e => e.value), '我自己貼上的重要文章內容。', '復原 brings the text back');
      await p.reload(); await p.waitForFunction(() => window.__sr); eq(await p.$eval('#text', e => e.value), '我自己貼上的重要文章內容。', 'restored text is saved');
      // 7. .md import
      const md = '# 標題\n\n> 引言一句\n\n- 項目 **粗體** 和 *斜體* 與 _底線_\n\n內文 file_name.txt，3 > 2，a*b=c，`code` 與 [連結](https://x.y)。\n\n---\n';
      const mdPath = path.join(os.tmpdir(), 'sr-test-' + process.pid + '.md'); fs.writeFileSync(mdPath, md);
      await p.setInputFiles('#fileIn', mdPath); await p.waitForFunction(() => document.getElementById('text').value.startsWith('標題'));
      fs.unlinkSync(mdPath);
      eq(await p.$eval('#text', e => e.value), '標題\n\n引言一句\n\n項目 粗體 和 斜體 與 底線\n\n內文 file_name.txt，3 > 2，a*b=c，code 與 連結。\n\n', '.md import strips only Markdown syntax');
      await ctx.close();
    }

    // ---------- 4/12. corrupted storage ----------
    {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', 1); const P = 'speed-reader:v1:';
        localStorage.setItem(P + 'library', '[null,5,{"t":7},{"h":"x","title":null,"t":"有效的文本內容。","date":"x"}]');
        localStorage.setItem(P + 'history', '[null,{"wpm":"x"},7,{"wpm":321,"score":"9","lang":3,"date":1790000000000}]');
        localStorage.setItem(P + 'progress', '{"a":null,"b":5,"c":{"i":"3"}}');
        localStorage.setItem(P + 'prefs', '{"speedZh":1e9,"speedEn":-4,"chunk":"9","fontSize":-5,"punct":"no"}');
        localStorage.setItem(P + 'theme', '7'); localStorage.setItem(P + 'current', '[null]'); });
      const { p, tap } = await open(360, 640, ctx);
      const pr = await p.evaluate(() => ({ ...__sr.prefs }));
      eq([pr.speedZh, pr.speedEn, pr.chunk, pr.fontSize, pr.punct], [1200, 100, 1, 24, true], 'prefs clamped / defaulted');
      eq(await p.$eval('#themeBtn', e => e.textContent), '自動', 'bad theme falls back to 自動');
      eq(await p.evaluate(() => __sr.lib().map(x => x.title)), ['有效的文本內容。'], 'library keeps only valid entries');
      eq(await p.evaluate(() => __sr.history().map(x => [x.wpm, x.score, x.lang])), [[321, null, 'zh']], 'history keeps only valid entries');
      eq(await p.evaluate(() => Object.keys(__sr.progress())), [], 'bad progress entries dropped');
      await tap('#libBtn'); assert(await p.$eval('#libDlg', e => !e.hidden) && await p.$$eval('#libMine .libitem', l => l.length) === 1, '文庫 opens with the valid entry');
      await tap('#libClose'); await tap('#statsBtn'); assert(await p.$eval('#statsDlg', e => !e.hidden), '統計 opens'); await tap('#statsClose');
      await p.evaluate(() => { const t = document.getElementById('text'); t.value = '另一篇要存的文章。'; t.dispatchEvent(new Event('input')); });
      await tap('#saveText'); eq(await p.evaluate(() => __sr.lib().length), 2, '存入文庫 works with a repaired library');
      await ctx.close();
    }

    // ---------- 5. no clipped words ----------
    {
      const extra = 'Internationalization and telecommunications professionals discussed counterrevolutionary characteristics, see https://example.com/a/very/long/path/to/some/resource?with=query&and=more. 臺灣大學電機資訊學院資訊工程學系的同學們討論了報告。';
      for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
        const { ctx, p } = await open(w, h);
        const res = await p.evaluate(async extra => {
          const texts = [...__sr.BUILTIN.map(b => b.text), extra], $ = id => document.getElementById(id), out = { n: 0, bad: [] };
          for (const fsz of [40, 72]) for (const chunk of [1, 2, 3]) for (const t of texts) {
            __sr.prefs.chunk = chunk; __sr.prefs.fontSize = fsz; $('text').value = t; await __sr.openReader(false); if (__sr.R.playing) $('playBtn').click();
            const st = $('stage').getBoundingClientRect(), word = $('word');
            __sr.R.doc.items.forEach((it, i) => {
              __sr.show(i); out.n++;
              const shown = $('wPre').textContent + $('wFc').textContent + $('wPost').textContent;
              let clip = shown !== it.text;
              if (word.classList.contains('wrap')) clip = clip || word.scrollHeight > st.height || word.scrollWidth > word.clientWidth + 1;
              else for (const id of ['wPre', 'wFc', 'wPost']) { const e = $(id), r = e.getBoundingClientRect(); if (e.scrollWidth > e.clientWidth + 1 || (e.textContent && (r.left < st.left - 1 || r.right > st.right + 1))) clip = true; }
              if (clip && out.bad.length < 5) out.bad.push(`${fsz}px/${chunk}: ${it.text}`);
            });
            document.getElementById('exitBtn').click();
          }
          return out;
        }, extra);
        assert(res.n > 4000 && !res.bad.length, `${w}x${h}: ${res.n} chunks at 40/72 px × 1/2/3 per flash, none clipped ${res.bad.join(' | ')}`);
        if (w === 390) {
          const r = await p.evaluate(() => { const $ = id => document.getElementById(id); __sr.prefs.chunk = 3; __sr.prefs.fontSize = 40; $('text').value = __sr.BUILTIN[0].text; return __sr.openReader(false).then(() => {
            if (__sr.R.playing) $('playBtn').click(); const i = __sr.R.doc.items.findIndex(x => x.text === '拿來當作藥材，'); __sr.show(i);
            const post = $('wPost'), fs = parseFloat(getComputedStyle($('word')).fontSize); const out = { i, full: $('wPre').textContent + $('wFc').textContent + post.textContent, fits: post.scrollWidth <= post.clientWidth, fs }; $('exitBtn').click(); return out; }); });
          assert(r.i >= 0 && r.full === '拿來當作藥材，' && r.fits && r.fs >= 24, `390 3 per flash: 「拿來當作藥材，」 shown whole with its comma at ${r.fs}px`);
        }
        await ctx.close();
      }
    }

    // ---------- 8/9/10/11/13/14/15 ----------
    {
      const { ctx, p, tap } = await open(390, 844);
      // 9. Chinese sentence inside English text
      const mix = await p.evaluate(() => { const t = 'Reading quickly is a useful skill that anyone can practise every day. 這是一個中文句子，裡面有很多詞語需要分開閱讀。 Then we go back to plain English again for a while.'; const d = __sr.build(t, { chunk: 1 });
        return { lang: d.lang, items: d.items.map(x => x.text), joined: d.items.map(x => x.text).join('').replace(/\s/g, ''), want: t.replace(/\s/g, ''), units: d.units, count: __sr.countUnits(t, 'en') }; });
      eq(mix.lang, 'en', 'mixed text detected as English');
      eq(mix.joined, mix.want, 'mixed text: every character shown once, in order');
      assert(Math.max(...mix.items.filter(x => /[一-鿿]/.test(x)).map(x => (x.match(/[一-鿿]/g) || []).length)) <= 4, 'Chinese sentence split into words: ' + mix.items.join('/'));
      eq(mix.units, mix.count, 'word count on the main screen = items the reader flashes');
      // 10. estimate, computed by hand: per sentence 7 words × 200 ms (300/min) + comma 100 + long word 60 + period 200 = 1760; ×20, last item paragraph 2.5× instead of 2× (+100)
      const est = await p.evaluate(() => { const t = 'one two three, four extraordinary six seven. '.repeat(20).trim(); const ta = document.getElementById('text'); ta.value = t; ta.dispatchEvent(new Event('input'));
        __sr.prefs.speedEn = 300; __sr.prefs.punct = true; __sr.prefs.ramp = false; __sr.prefs.chunk = 1; return __sr.estimateMs(t); });
      eq(Math.round(est), 20 * 1760 + 100, 'estimate includes punctuation pauses and the long-word factor (35.3 s)');
      await p.waitForFunction(() => /35 秒/.test(document.getElementById('estInfo').textContent));
      assert(await p.$eval('#longHint', e => !e.hidden && /8 個字母/.test(e.textContent) && /×1.3/.test(e.textContent)), 'long-word ×1.3 explained on screen for English text');
      // actual run takes what the estimate says (fake clock)
      await p.clock.install(); await p.evaluate(() => __sr.openReader(false)); await p.clock.runFor(36000);
      await p.waitForFunction(() => !document.getElementById('doneDlg').hidden);
      const dur = await p.evaluate(() => __sr.R.playMs); assert(Math.abs(dur - 35300) < 400, `real run ${Math.round(dur)} ms ≈ estimate 35 300 ms`);
      await p.evaluate(() => document.getElementById('skipResult').click());
      await ctx.close();
    }
    {
      const { ctx, p, tap } = await open(390, 844);
      // 8. quiz without answers
      const toEnd = async () => { await p.evaluate(() => { __sr.prefs.speedZh = 1200; __sr.prefs.punct = false; }); await p.evaluate(() => __sr.openReader(false));
        await p.evaluate(() => { __sr.R.i = __sr.R.doc.items.length - 2; }); await p.waitForFunction(() => !document.getElementById('doneDlg').hidden); await W(50); };
      await toEnd(); const h0 = await p.evaluate(() => __sr.history().length);
      await tap('#saveResult');
      const rec = await p.evaluate(() => __sr.history().slice(-1)[0]);
      assert(rec && rec.score === null && (await p.evaluate(() => __sr.history().length)) === h0 + 1, 'quiz with no answers records 未作答 (score null), not 0%');
      assert(/未作答/.test(await p.$eval('#toastMsg', e => e.textContent)), 'toast says 未作答');
      await tap('#saveResult');
      await toEnd(); await tap('#q0o1'); await tap('#q1o0'); await tap('#saveResult');
      eq(await p.evaluate(() => __sr.history().slice(-1)[0].score), 33, 'one right of three answered → 33%');
      await tap('#saveResult');
      // 11. 結束 after paused skipping saves the new position
      await p.evaluate(() => { __sr.prefs.speedZh = 400; }); await tap('#startBtn'); await p.waitForFunction(() => __sr.R.playing);
      await tap('#playBtn'); await tap('#nextSent'); await tap('#nextSent'); await tap('#nextSent');
      const iNow = await p.evaluate(() => __sr.R.i); await tap('#exitBtn');
      const pg = await p.evaluate(() => __sr.progress()[Object.keys(__sr.progress())[0]]);
      eq(pg && pg.i, iNow, '結束 after paused skipping saves the new position');
      await tap('#resumeBtn'); eq(await p.evaluate(() => __sr.R.i), iNow, '續讀 starts at that position');
      await tap('#exitBtn');
      // 14. 1/2/3 buttons
      const hs = await p.$$eval('.seg button', l => l.map(b => b.getBoundingClientRect().height));
      assert(hs.every(x => x >= 44), '每次 1/2/3 buttons ≥ 44 px tall: ' + hs.join(','));
      // 15. stats axis
      eq(await p.evaluate(() => [[250, 500], [212, 236], [80, 1450], [400, 400]].map(([a, b]) => { const r = __sr.niceAxis(a, b); return [r.lo <= a && r.hi >= b, [1, 2, 2.5, 5].some(m => [1, 10, 100, 1000].some(q => Math.abs(m * q - r.step) < 1e-9)), Math.round((r.hi - r.lo) / r.step) <= 6]; })),
        [[true, true, true], [true, true, true], [true, true, true], [true, true, true]], 'nice axis: covers the data, 1-2-2.5-5 steps, ≤ 6 intervals');
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(() => { localStorage.setItem('speed-reader:v1:history', JSON.stringify([250, 333, 417, 500, 288].map((w, i) => ({ date: 1790000000000 + i * 864e5, words: 1000, wpm: w, duration: 100, score: null, title: 't', lang: 'zh' })))); });
      const { p, tap } = await open(360, 640, ctx);
      await tap('#statsBtn');
      const ax = await p.evaluate(() => { const svg = document.querySelector('#chartBox svg'), vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
        const labels = [...svg.querySelectorAll('text')].map(t => t.textContent).filter(t => /^\d+$/.test(t)).map(Number);
        const fs = parseFloat(getComputedStyle(svg.querySelector('text')).fontSize) * r.width / vb.width; return { labels, fs }; });
      assert(ax.labels.length >= 3 && ax.labels.every(v => v % 25 === 0), 'stats Y labels are round numbers: ' + ax.labels.join(','));
      assert(ax.fs >= 11.5, `stats labels render at ${ax.fs.toFixed(1)} px on a 360 screen`);
      await ctx.close();
    }
    // 13. 開始閱讀 visible without scrolling
    for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
      const { ctx, p } = await open(w, h);
      const v = await p.evaluate(() => { const b = document.getElementById('startBtn'), r = b.getBoundingClientRect(); return { bottom: r.bottom, top: r.top, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b, H: innerHeight, sw: document.documentElement.scrollWidth, W: innerWidth }; });
      assert(v.top >= 0 && v.bottom <= v.H && v.hit, `${w}x${h}: 開始閱讀 visible without scrolling (${Math.round(v.top)}–${Math.round(v.bottom)} of ${v.H})`);
      assert(v.sw <= v.W, `${w}x${h}: no horizontal scroll`);
      await ctx.close();
    }
  } catch (e) { fails++; console.log('FAIL', e.stack || e); }
  eq(errors, [], 'no page errors');
  await browser.close(); srv.close();
  console.log(fails ? `${fails} 項失敗，${passes} 項通過` : `全部 ${passes} 項通過`);
  process.exit(fails ? 1 : 0);
})();
