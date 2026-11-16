// 提詞機：上架重審第 1 輪的回歸測試（node tests.js，約 40 秒）。
// 每一項對應 score.json 的 toFix：觸控（另一指放著、兩指重疊、按住、detail 0 補發 click）、壞存檔、
// Unicode 字數、倒數中點畫面／暫停鍵、刪除可復原與匯出／匯入、px/秒 預估、清空內容、焦點外框、HUD 高度、「無」寬度。
// 頁面用本機 http 伺服器載入（重新整理要保留 localStorage）。
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let fails = 0, passes = 0;
const assert = (c, m) => { if (c) { passes++; if (process.env.V) console.log('ok   ' + m); } else { fails++; console.log('FAIL ' + m); } };
const eq = (a, b, m) => { const A = JSON.stringify(a), B = JSON.stringify(b); assert(A === B, A === B ? m : `${m}: ${A} != ${B}`); };
const errors = [];
const W = ms => new Promise(r => setTimeout(r, ms));
const K = 'teleprompter:v1:';

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(SKELETON + fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8') + '</body></html>'); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const open = async (w, h, opt = {}) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, acceptDownloads: true });
    const p = await ctx.newPage();
    const tag = opt.tag || `${w}x${h}`;
    p.on('pageerror', e => { (opt.errs || errors).push(`${tag} ${e.message}`); });
    p.on('console', m => { if (m.type() === 'error') (opt.errs || errors).push(`${tag} console ${m.text()}`); });
    if (opt.init) await p.addInitScript(opt.init, opt.arg);
    await p.goto(URL); await p.waitForFunction(() => window.__tp);
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id: id || 1, radiusX: 1, radiusY: 1 })) });
    const center = sel => p.$eval(sel, e => { const b0 = e.getBoundingClientRect(); if (b0.top < 0 || b0.bottom > innerHeight - 90) e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
    const tap = async (sel, hold = 40) => { const c = await center(sel); await T('touchStart', [[c[0], c[1], 1]]); await W(hold); await T('touchEnd', [[c[0], c[1], 1]]); await W(40); };
    return { ctx, p, T, center, tap };
  };
  const st = p => p.evaluate(() => { const c = __tp.cur().cfg; return { theme: document.documentElement.getAttribute('data-theme'), mode: c.mode, cd: c.cd, fg: c.fg, mx: c.mx, wpm: c.wpm, list: !document.getElementById('dlgList').hidden, player: !document.getElementById('player').hidden, playing: __tp.P.playing, cdUntil: __tp.P.cdUntil, n: __tp.scripts.length }; });
  const d0 = (p, sel) => p.$eval(sel, e => e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));

  try {
    // ---------- 1. touch: resting finger, overlapping taps, holds, detail-0 replay ----------
    {
      const { ctx, p, T, center, tap } = await open(390, 844);
      const reset = () => p.evaluate(() => { __tp.setCfg('mode', 'wpm'); __tp.setCfg('cd', 3); __tp.setCfg('fg', '#ffffff'); __tp.setCfg('bg', '#000000'); __tp.setCfg('mx', false); });
      const withRest = async (restSel, sel) => {
        const r = await center(restSel); const c = await center(sel);
        await T('touchStart', [[r[0], r[1], 7]]); await W(150);
        await T('touchStart', [[r[0], r[1], 7], [c[0], c[1], 8]]); await W(50);
        await T('touchEnd', [[c[0], c[1], 8]]); await W(60); await T('touchEnd', [[r[0], r[1], 7]]); await W(60);
      };
      const cases = [
        ['#segMode button[data-v=pxs]', (a, b) => b.mode === 'pxs' && a.mode === 'wpm', '字/分→px/秒'],
        ['#segCd button[data-v="5"]', (a, b) => b.cd === 5 && a.cd === 3, '倒數 5 秒'],
        ['#swatches .sw:nth-child(2)', (a, b) => b.fg === '#ffe14d', '配色 黃/黑'],
        ['#btnTheme', (a, b) => a.theme !== b.theme, '主題'],
        ['label.tg:nth-child(1)', (a, b) => a.mx !== b.mx, '水平鏡像'],
      ];
      for (const [sel, ok, name] of cases) {
        await reset(); await W(850);
        let a = await st(p); await withRest('.syntax', sel); let b = await st(p);
        assert(ok(a, b), `finger resting: ${name} acts`);
        await reset(); await W(850);
        a = await st(p); await tap(sel); await d0(p, sel);
        await p.$eval(sel, e => { const r = e.getBoundingClientRect(); document.elementFromPoint(r.right - 1, r.bottom - 1).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); });
        b = await st(p); assert(ok(a, b), `tap then detail-0 clicks: ${name} ran exactly once`);
        for (const hold of [600, 1000]) { await reset(); await W(850); a = await st(p); await tap(sel, hold); assert(ok(a, await st(p)), `hold ${hold} ms: ${name} acts once`); }
      }
      await reset(); await W(850);
      await p.evaluate(() => scrollTo(0, 0)); await withRest('.syntax', '#btnList'); assert((await st(p)).list, 'finger resting: 講稿 opens the list');
      await tap('[data-close]'); assert(!(await st(p)).list, '關閉 closes the list');
      eq(await p.evaluate(() => ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)), false, 'no text field focused after closing the list');
      for (const order of ['first', 'second']) {
        await reset(); await W(850);
        await p.$eval('#segCd', e => e.scrollIntoView({ block: 'center' }));
        const a = await center('#segMode button[data-v=pxs]'), b = await center('#segCd button[data-v="5"]');
        await T('touchStart', [[a[0], a[1], 3]]); await W(50); await T('touchStart', [[a[0], a[1], 3], [b[0], b[1], 4]]); await W(50);
        if (order === 'first') { await T('touchEnd', [[a[0], a[1], 3]]); await W(30); await T('touchEnd', [[b[0], b[1], 4]]); }
        else { await T('touchEnd', [[b[0], b[1], 4]]); await W(30); await T('touchEnd', [[a[0], a[1], 3]]); }
        await W(60); const s = await st(p);
        assert(s.mode === 'pxs' && s.cd === 5, `overlapping taps px/秒 + 5 秒 (${order} lifts first): both act (${s.mode}, ${s.cd})`);
      }
      // lone detail-0 click (keyboard / screen reader) still acts once
      await reset(); await W(850);
      let a = await st(p); await d0(p, '#btnTheme'); assert((await st(p)).theme !== a.theme, 'lone detail-0 click on 主題 acts once');
      // player: +10 / −10 with a finger resting on the stage, detail-0 replay, focus ring
      await p.evaluate(() => { __tp.setCfg('cd', 0); __tp.setCfg('wpm', 180); });
      await W(850); await p.evaluate(() => scrollTo(0, 0)); await tap('#btnGo');
      await p.waitForFunction(() => __tp.P.on && __tp.P.playing);
      await W(100);
      eq(await p.$eval('#hPlay', e => getComputedStyle(e).outlineStyle), 'none', 'touch start: no focus ring on the pause button');
      await tap('#hPlay'); await p.waitForFunction(() => !__tp.P.playing);
      a = await st(p);
      await withRest('#pflag', '#hFast'); eq((await st(p)).wpm - a.wpm, 10, 'player, finger resting: +10 adds 10');
      await W(850); a = await st(p); await withRest('#pflag', '#hSlow'); eq((await st(p)).wpm - a.wpm, -10, 'player, finger resting: −10 subtracts 10');
      // finger resting on the stage while tapping ⏯: the resting finger's lift is not a stage tap
      await W(850); a = await st(p); await withRest('#guideLine', '#hPlay'); assert((await st(p)).playing !== a.playing, 'player, finger resting on stage: ⏯ toggles exactly once');
      await tap('#hPlay'); await p.waitForFunction(() => !__tp.P.playing);
      await W(850); a = await st(p); const fc = await center('#hFast'); await tap('#hFast');
      await p.evaluate(([x, y]) => { const f = document.getElementById('hFast'), r = f.getBoundingClientRect(), mk = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }); f.dispatchEvent(mk()); document.elementFromPoint(r.right - 1, r.bottom - 1).dispatchEvent(mk()); document.elementFromPoint(x, y).dispatchEvent(mk()); }, fc);
      eq((await st(p)).wpm - a.wpm, 10, 'tap +10 then three detail-0 clicks: +10 once');
      // 結束 changes the screen; a detail-0 click right after must not run what is underneath
      const ex = await center('#hExit'); const th = (await st(p)).theme; await tap('#hExit');
      await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); }, ex);
      const s = await st(p); assert(!s.player && !s.list && s.theme === th, 'tap 結束 + detail-0 click: back in editor, nothing underneath ran');
      await ctx.close();
    }

    // ---------- 2. corrupt storage ----------
    {
      const bad = [
        ['scripts', '[null]'], ['scripts', '["x"]'], ['scripts', '[1]'], ['scripts', '{"a":1}'], ['scripts', '[[1],{"id":5,"title":null,"body":{"x":1},"cfg":"x"}]'],
        ['scripts', JSON.stringify([{ id: 'a', title: 't', body: 'hello world', cfg: { wpm: 0 }, updated: 1 }])],
        ['scripts', JSON.stringify([{ id: 'a', title: 't', body: 'hello world', cfg: { wpm: 'abc', pxs: -5, size: 1e9, lh: null, margin: 'x', guide: [], cd: 7, mode: 'zz', fg: 'red' }, updated: 'x' }])],
        ['defaults', '{"wpm":0,"size":"huge","cd":"9"}'], ['defaults', '[1]'], ['current', '{"x":1}'], ['theme', '42'], ['scripts', 'not json'],
      ];
      for (const [k, v] of bad) {
        const errs = [];
        const { ctx, p } = await open(390, 844, { errs, tag: `bad ${k}=${v.slice(0, 30)}`, init: ([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('seeded', '1'); } }, arg: [K + k, v] });
        const r = await p.evaluate(() => { const c = __tp.cur().cfg; return { t: document.getElementById('stTime').textContent, c, n: __tp.scripts.length }; });
        assert(!errs.length && !/NaN|Infinity/.test(r.t) && r.n >= 1, `bad ${k}=${v.slice(0, 40)}: loads (${r.t}) ${errs.join(' ')}`);
        const c = r.c; assert(c.wpm >= 60 && c.wpm <= 400 && c.pxs >= 10 && c.pxs <= 300 && c.size >= 24 && c.size <= 120 && c.lh >= 1.2 && c.lh <= 2.2 && c.margin >= 0 && c.margin <= 25 && c.guide >= 20 && c.guide <= 60 && [0, 3, 5].includes(c.cd) && ['wpm', 'pxs'].includes(c.mode) && /^#[0-9a-f]{6}$/.test(c.fg), `bad ${k}: cfg clamped ${JSON.stringify(c)}`);
        if (/wpm":0/.test(v) && k === 'scripts') {
          eq(r.t, '0:02', 'cfg.wpm=0 → clamped to 60 字/分: 2 words = 0:02');
          await p.evaluate(() => { __tp.setCfg('cd', 0); __tp.open(); }); await W(400);
          assert(await p.evaluate(() => __tp.P.y > 0 && Number.isFinite(__tp.P.v)), 'cfg.wpm=0: playback moves');
        }
        await ctx.close();
      }
      // existing (valid) data loads unchanged
      const good = [{ id: 'k1', title: '舊講稿', body: 'Hello world 你好', cfg: { mode: 'pxs', wpm: 185, pxs: 75, size: 64, lh: 1.7, margin: 10, fg: '#ffe14d', bg: '#000000', mx: true, my: false, guide: 40, cd: 5, pz: false }, updated: 1700000000000 }];
      const { ctx, p } = await open(390, 844, { init: (g) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('teleprompter:v1:scripts', g); localStorage.setItem('teleprompter:v1:current', '"k1"'); sessionStorage.setItem('seeded', '1'); } }, arg: JSON.stringify(good) });
      eq(await p.evaluate(() => __tp.scripts), good, 'valid saved scripts load unchanged');
      await ctx.close();
    }

    // ---------- 3. word counting ----------
    {
      const { ctx, p } = await open(390, 844);
      const cw = t => p.evaluate(t => __tp.countWords(t), t);
      eq(await cw('Привет мир как дела. '.repeat(20)), 80, 'Russian: 80 words');
      eq(await cw('Καλημέρα κόσμε'), 2, 'Greek: 2 words');
      eq(await cw('２０２６年'), 2, 'full-width digits ２０２６ + 年 = 2');
      eq(await cw('大家好 Hello world'), 5, 'CJK per char + English per word');
      eq(await cw("don't stop-gap 3.14"), 3, 'apostrophes, hyphens and decimals keep one word');
      eq(await cw('😀🎉👍'), 3, 'emoji-only: one each');
      assert((await cw('… ★ ※ ☆ ♪ ……')) >= 1, 'symbols-only non-empty body has a floor > 0');
      eq(await cw('   '), 0, 'blank body counts 0');
      await p.evaluate(() => { __tp.setBody('Привет мир как дела. '.repeat(20)); __tp.setCfg('mode', 'wpm'); __tp.setCfg('wpm', 180); __tp.setCfg('cd', 0); });
      eq(await p.$eval('#stTime', e => e.textContent), '0:27', 'Russian ×20 at 180 字/分: estimate 0:27');
      await p.evaluate(() => __tp.open()); await W(1500);
      assert(await p.evaluate(() => __tp.P.on && !__tp.P.ended && __tp.P.y < __tp.P.H * 0.2), 'Russian ×20 at 180 字/分: still scrolling after 1.5 s');
      await ctx.close();
    }

    // ---------- 4. tap during countdown starts playing ----------
    {
      const { ctx, p, tap, T } = await open(390, 844);
      await p.evaluate(() => __tp.setCfg('cd', 5)); await W(850); await p.evaluate(() => scrollTo(0, 0));
      await tap('#btnGo'); await p.waitForFunction(() => __tp.P.cdUntil > 0);
      await W(300); await T('touchStart', [[195, 400, 1]]); await W(40); await T('touchEnd', [[195, 400, 1]]); await W(80);
      let s = await st(p); assert(s.playing && !s.cdUntil && await p.$eval('#cd', e => e.hidden), 'tap screen during countdown: countdown skipped, playing');
      const y0 = await p.evaluate(() => __tp.P.y); await W(400); assert((await p.evaluate(() => __tp.P.y)) > y0, 'after skipping the countdown the text scrolls');
      await p.evaluate(() => __tp.close()); await W(850);
      await p.evaluate(() => scrollTo(0, 0)); await tap('#btnGo'); await p.waitForFunction(() => __tp.P.cdUntil > 0); await W(900);
      await tap('#hPlay'); s = await st(p); assert(s.playing && !s.cdUntil, 'pause button during countdown: countdown skipped, playing');
      await tap('#hPlay'); assert(!(await st(p)).playing, 'pause button after that pauses');
      await p.evaluate(() => __tp.close());
      await ctx.close();
    }

    // ---------- 5. delete undo, export, import ----------
    {
      const { ctx, p, tap } = await open(390, 844);
      await p.evaluate(() => scrollTo(0, 0)); await tap('#btnList'); await W(100);
      await tap('#btnNew'); await W(100);
      await p.evaluate(() => __tp.setBody('第二份講稿內容'));
      await W(850); await tap('#btnList'); await W(100);
      const n0 = (await st(p)).n; const delSel = `[data-del="${await p.evaluate(() => __tp.cur().id)}"]`;
      await tap(delSel); await W(100); await tap('#delYes'); await W(100);
      eq((await st(p)).n, n0 - 1, 'delete removes the script');
      assert(await p.$eval('#toastUndo', e => !e.hidden), 'delete shows an undo button');
      await W(850); await tap('#toastUndo'); await W(100);
      const s = await st(p);
      assert(s.n === n0 && await p.evaluate(() => __tp.cur().body === '第二份講稿內容'), 'undo restores the deleted script and makes it current again');
      eq(await p.evaluate(() => JSON.parse(localStorage.getItem('teleprompter:v1:scripts')).length), n0, 'undo is saved');
      if (!s.list) { await tap('#btnList'); await W(100); }
      const [dl] = await Promise.all([p.waitForEvent('download'), tap('#btnExport')]);
      const file = await dl.path(); const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert(/\.json$/.test(dl.suggestedFilename()) && data.scripts.length === n0, `export downloads ${dl.suggestedFilename()} with ${n0} scripts`);
      // import: duplicates skipped, a new one added, junk skipped
      data.scripts.push({ id: data.scripts[0].id, title: '匯入的講稿', body: '新內容', cfg: { wpm: 999 } }, null, 'x');
      await W(850);
      const [fc] = await Promise.all([p.waitForEvent('filechooser'), tap('#btnImport')]);
      await fc.setFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
      await p.waitForFunction(n => __tp.scripts.length === n + 1, n0);
      const imp = await p.evaluate(() => __tp.scripts.find(x => x.title === '匯入的講稿'));
      assert(imp && imp.cfg.wpm === 400 && new Set((await p.evaluate(() => __tp.scripts.map(x => x.id)))).size === n0 + 1, 'import adds new script with unique id and clamped cfg, skips duplicates/junk');
      eq(await p.evaluate(() => __tp.importText('{bad')), 0, 'import of a broken file adds nothing');
      await ctx.close();
    }

    // ---------- 6. details ----------
    {
      const { ctx, p, tap } = await open(390, 844);
      // px/秒 estimate vs the actual player height
      await p.evaluate(() => { __tp.setCfg('pz', false); __tp.setCfg('mode', 'pxs'); __tp.setCfg('pxs', 60); __tp.setCfg('cd', 0); });
      await W(300);
      const est = await p.$eval('#stTime', e => e.textContent);
      assert(/^約 \d+:\d\d$/.test(est), `px/秒 mode gives a time estimate (${est})`);
      await p.evaluate(() => __tp.open()); await W(300);
      const real = await p.evaluate(() => __tp.P.H / __tp.P.cfg.pxs); await p.evaluate(() => __tp.close());
      const [m, ss] = est.slice(2).split(':').map(Number);
      assert(Math.abs(m * 60 + ss - real) <= 2, `px/秒 estimate ${m * 60 + ss} s ≈ real ${real.toFixed(1)} s`);
      // clear the sample + undo
      await W(850); await p.evaluate(() => scrollTo(0, 0));
      const body0 = await p.$eval('#body', e => e.value);
      await tap('#btnClear');
      assert((await p.$eval('#body', e => e.value)) === '' && await p.$eval('#btnGo', e => e.disabled), '清空內容 empties the sample, 開始 disabled');
      eq(await p.evaluate(() => ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)), false, '清空內容 by touch does not raise the keyboard');
      await W(850); await tap('#toastUndo');
      eq(await p.$eval('#body', e => e.value), body0, 'undo brings the sample back');
      // 無 width
      assert((await p.$eval('#segCd button[data-v="0"]', e => e.getBoundingClientRect().width)) >= 44, '「無」 segment ≥ 44 px wide');
      // HUD height portrait / landscape
      // headless Chromium cannot resize a fullscreen window: keep the player in-page for the rotation check
      await p.evaluate(() => { Element.prototype.requestFullscreen = undefined; __tp.setCfg('cd', 0); __tp.open(); }); await W(300);
      const hp = await p.$eval('#hud', e => e.getBoundingClientRect().height);
      assert(hp <= 96, `portrait HUD height ${hp.toFixed(0)} ≤ 96 px (about one line at 56 px × 1.5)`);
      await p.setViewportSize({ width: 844, height: 390 }); await W(300);
      const hl = await p.$eval('#hud', e => e.getBoundingClientRect().height);
      assert(hl <= 390 / 6, `landscape HUD height ${hl.toFixed(0)} ≤ 1/6 of the screen`);
      const [ov, cut] = await p.evaluate(() => { const bs = [...document.querySelectorAll('#hud button')].map(b => b.getBoundingClientRect()); let o = false; for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (bs[i].right > bs[j].left && bs[j].right > bs[i].left && bs[i].bottom > bs[j].top && bs[j].bottom > bs[i].top) o = true; return [o, bs.some(b => b.right > innerWidth || b.bottom > innerHeight || b.height < 44 || b.width < 44)]; });
      assert(!ov && !cut, 'landscape HUD buttons ≥ 44 px, not overlapping or cut off');
      await p.evaluate(() => __tp.close());
      await ctx.close();
    }
  } catch (e) { fails++; console.log('FAIL exception ' + (e.stack || e)); }
  eq(errors, [], 'no page errors');
  await browser.close(); srv.close();
  console.log(fails ? `${fails} 項失敗，${passes} 項通過` : `全部 ${passes} 項通過`);
  process.exit(fails ? 1 : 0);
})();
