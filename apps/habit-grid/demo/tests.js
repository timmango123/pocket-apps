// habit-grid regression tests (one per release-review finding, 2026-11-02): node tests.js
// Runs in CI via qa/smoke/run.js. No screenshots, no fixed sleeps: every wait is on a condition.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');
const fs = require('fs');
const URL = 'https://artifact.local/index.html';
const SRC = () => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8') + '</body></html>';
const KEY = 'habit-grid:v1:data';
const FIXED = new Date('2026-10-12T21:00:00+08:00'); // Monday evening, Taipei
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function open(w, h, o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: 'light', timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
    if (!o.ctx) await ctx.route('https://artifact.local/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SRC() }));
    const p = await ctx.newPage();
    await p.clock.setFixedTime(FIXED);
    p.on('pageerror', e => errs.push(String(e)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    if (o.init) await p.addInitScript(o.init);
    await p.goto(URL); await p.waitForSelector('#list .card, #list .empty');
    return { ctx, p };
  }
  const T = 20000;
  // sheets autofocus their first field after a short delay; wait for it so typing never races it
  const sheetReady = p => p.waitForFunction(() => document.activeElement && document.activeElement.id === 'habit-name', null, { timeout: T });

  // ---------- 390x844 main flow ----------
  {
    const { ctx, p } = await open(390, 844);
    // [5] tap targets: handle 44 wide, clear-sample 44 high, every visible control >= 44 except the browse-only heatmap cells
    const small = await p.evaluate(() => [...document.querySelectorAll('button,input,label,[role=tab]')].filter(e => {
      if (e.closest('#hgrid') || e.closest('[hidden]') || e.closest('.scrim')) return false; const b = e.getBoundingClientRect(); return b.width > 0 && (b.width < 44 || b.height < 44); })
      .map(e => (e.id || e.className) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
    ok(small.length === 0, 'all main-screen controls >= 44x44 ' + small.join(', '));
    const hb = await p.locator('[data-handle]').first().boundingBox();
    ok(hb.width >= 44 && hb.height >= 44, `drag handle ${hb.width}x${hb.height}`);
    const cs = await p.locator('#clear-sample').boundingBox();
    ok(cs.height >= 44, `清除範例 height ${cs.height}`);

    // [4] visible edit entry: ⋯ on each card opens the edit dialog; the sample banner tells first-time users
    ok(await p.locator('#list .card [data-more]').count() === 4, '⋯ edit button on every card');
    ok((await p.locator('#sample-banner').innerText()).includes('⋯'), 'first-use banner mentions ⋯ to edit');
    await p.locator('.card', { hasText: '閱讀' }).locator('[data-more]').click();
    await sheetReady(p);
    ok(await p.inputValue('#habit-name') === '閱讀 20 分鐘', '⋯ opens edit dialog for that habit');
    await p.click('#edit-cancel');

    // [4 detail] tapping a card scrolls its heatmap into view when it is off-screen
    await p.setViewportSize({ width: 390, height: 520 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.locator('.card', { hasText: '吃維他命' }).locator('[data-body]').click();
    await p.waitForFunction(() => { const r = document.querySelector('#hgrid').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }, null, { timeout: T }).then(() => ok(true, 'card tap scrolls heatmap into view'), () => ok(false, 'card tap scrolls heatmap into view'));
    await p.setViewportSize({ width: 390, height: 844 });

    // [8] switching habits updates cells in place (no rebuild)
    await p.evaluate(() => { window.__cell = document.querySelector('#hgrid .c[data-k="2026-10-01"]'); });
    await p.click('#tab-all');
    await p.locator('.tab', { hasText: '喝水' }).click();
    ok(await p.evaluate(() => window.__cell.isConnected && window.__cell === document.querySelector('#hgrid .c[data-k="2026-10-01"]')), 'tab switch keeps the same cell elements');
    ok(await p.locator('#hgrid .c').count() === 22 * 7, '22x7 cells after switches');

    // [6] month / weekday / legend labels >= 12px and >= 4.5:1 contrast on the panel
    const lab = await p.evaluate(() => {
      const lum = c => { const v = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(x => { x = x / 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
      const bg = lum(getComputedStyle(document.querySelector('.panel')).backgroundColor);
      return ['.mlab', '.wd', '.legend'].map(s => { const e = document.querySelector(s), st = getComputedStyle(e), L = lum(st.color); return { s, px: parseFloat(st.fontSize), cr: (Math.max(L, bg) + .05) / (Math.min(L, bg) + .05) }; });
    });
    ok(lab.every(x => x.px >= 12 && x.cr >= 4.5), 'heatmap labels >= 12px and >= 4.5:1 ' + JSON.stringify(lab));

    // [5] back-fill: a heatmap tap opens a calendar with >= 44px days; the toggle saves at once and no toast covers anything
    const water = p.locator('.card', { hasText: '喝水' });
    await p.click('#hgrid .c[data-k="2026-09-29"]');
    await p.waitForSelector('#cal-sheet:not([hidden])');
    ok(await p.locator('#cal-month').innerText() === '2026 年 9 月', 'calendar opens on the tapped month');
    ok(await p.locator('#cal .cd.hl[data-k="2026-09-29"]').count() === 1, 'tapped day highlighted in calendar');
    const sizes = await p.$$eval('#cal .cd:not(.blank)', bs => bs.map(b => b.getBoundingClientRect()).map(r => Math.min(r.width, r.height)));
    ok(sizes.length === 30 && Math.min(...sizes) >= 44, `calendar days >= 44px (min ${Math.min(...sizes)})`);
    await p.click('#cal [data-k="2026-09-29"]');
    ok((await p.locator('#cal-msg').innerText()).includes('9/29（週二）已補打卡'), 'calendar back-fill message');
    ok(await p.evaluate(k => JSON.parse(localStorage.getItem(k)).checks[__hg.data.order[0]].includes('2026-09-29'), KEY), 'back-fill saved immediately');
    ok(await p.locator('#toast').isHidden(), 'no toast while back-filling');
    const s1 = await water.locator('small').innerText();
    ok(/連續 \d+ 天/.test(s1) && !s1.includes('連續 12 天'), `streak extended after back-fill (${s1})`);
    await p.click('#cal [data-k="2026-09-29"]');
    ok((await p.locator('#cal-msg').innerText()).includes('已取消打卡') && (await water.locator('small').innerText()).includes('連續 12 天'), 'second tap undoes back-fill');
    await p.click('#cal-next');
    ok(await p.locator('#cal-month').innerText() === '2026 年 10 月' && await p.locator('#cal-next').isDisabled(), 'next month stops at current month');
    ok(await p.locator('#cal [data-k="2026-10-13"]').isDisabled(), 'future day disabled in calendar');
    await p.click('#cal-close');
    await p.waitForSelector('#cal-sheet', { state: 'hidden' });

    // [5] nothing fixed covers the heatmap: add button is in the flow; toast is at the top and lets taps through
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('.addbar')).position !== 'fixed'), 'add bar is not fixed over content');
    // The toast is shown for real (placed by the app) and checked at several scroll positions, with the default font and
    // with a wide, tall fallback font, since CI runners have different fonts and so different element heights.
    const FONTS = { default: '', wide: '*{font-family:"DejaVu Sans Mono","Liberation Mono",monospace!important;letter-spacing:.08em!important;line-height:1.8!important}' };
    const SCROLLS = { gridBottom: 'g.bottom - innerHeight + 4', gridTop0: 'g.top', gridTop60: 'g.top - 60', gridTop30: 'g.top - 30', gridMid: 'g.top - innerHeight / 2', pageTop: '-1e6' };
    for (const [font, css] of Object.entries(FONTS)) {
      await p.evaluate(css => { let st = document.getElementById('test-font'); if (!st) { st = document.createElement('style'); st.id = 'test-font'; document.head.appendChild(st); } st.textContent = css; }, css);
      for (const vh of [640, 500, 844]) {
        await p.setViewportSize({ width: 390, height: vh });
        const { bad, checked } = await p.evaluate(async SCROLLS => {
          const frame = () => new Promise(r => requestAnimationFrame(r));
          const stamp = () => [scrollX, scrollY, innerWidth, innerHeight].map(Math.round).join();
          const ov = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);
          const bad = []; let checked = 0;
          for (const [where, expr] of Object.entries(SCROLLS)) {
            scrollTo(0, 0);
            __hg.toast('已刪除「一二三四五六七八九十一二三四五六七八九十」', () => {});
            const g = document.querySelector('#hgrid').getBoundingClientRect(); scrollBy(0, eval(expr));
            // the app re-places the toast on the frame after a scroll; wait for it (condition, not a timer)
            for (let i = 0; i < 600 && document.querySelector('#toast').dataset.at !== stamp(); i++) await frame();
            await frame(); await frame(); // let scroll and layout settle on slow runners
            for (let i = 0; i < 600 && document.querySelector('#toast').dataset.at !== stamp(); i++) await frame();
            const scEl = document.querySelector('#scroller'), t = document.querySelector('#toast').getBoundingClientRect(), sc = scEl.getBoundingClientRect(), se = document.querySelector('#settings-btn').getBoundingClientRect();
            let vis = 0; const cells = [];
            for (const c of document.querySelectorAll('#hgrid .c:not([disabled])')) { const b = c.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
              // only cells the scroller actually shows (cells clipped by its overflow can't be tapped, they aren't "covered")
              if (y < Math.max(0, sc.top) || y > sc.bottom || y >= innerHeight || x < sc.left || x > sc.right || x >= innerWidth) continue;
              vis++; const e = document.elementFromPoint(x, y); if (e !== c) cells.push(c.dataset.k + '@' + Math.round(x) + ',' + Math.round(y) + '>' + (e ? (e.id || e.className || e.tagName) : 'null')); }
            const sx = se.x + se.width / 2, sy = se.y + se.height / 2, seVis = sy > 0 && sy < innerHeight && sx > 0 && sx < innerWidth;
            const R = r => [r.left, r.top, r.right, r.bottom].map(Math.round).join(',');
            const atEnd = scEl.scrollWidth - scEl.clientWidth - scEl.scrollLeft < 2;
            const cov = { atEnd, scrollLeft: Math.round(scEl.scrollLeft), maxLeft: scEl.scrollWidth - scEl.clientWidth, toast: R(t), grid: R(sc), settings: R(se), scrollY: Math.round(scrollY), vh: innerHeight, placed: document.querySelector('#toast').dataset.at === stamp(), shown: !document.querySelector('#toast').hidden, vis, cells, overGrid: sc.bottom > 0 && sc.top < innerHeight && ov(t, sc), overSettings: seVis && (ov(t, se) || !document.elementFromPoint(sx, sy)?.closest('#settings-btn')) };
            checked += vis;
            if (!cov.placed || !cov.shown || cells.length || cov.overGrid || cov.overSettings) bad.push({ where, ...cov });
          }
          return { bad, checked };
        }, SCROLLS);
        // full detail, one short line per fact so CI logs (which cut lines at 200 chars) keep all of it
        for (const b of bad) {
          console.log(`FAIL   detail ${font} 390x${vh} ${b.where}: toast=${b.toast} grid=${b.grid} settings=${b.settings} scrollY=${b.scrollY} vh=${b.vh}`);
          console.log(`FAIL   detail ${font} 390x${vh} ${b.where}: atEnd=${b.atEnd} scrollLeft=${b.scrollLeft}/${b.maxLeft} placed=${b.placed} shown=${b.shown} overGrid=${b.overGrid} overSettings=${b.overSettings} vis=${b.vis}`);
          for (let i = 0; i < b.cells.length; i += 4) console.log(`FAIL   detail ${font} 390x${vh} ${b.where}: covered ${b.cells.slice(i, i + 4).join(' ')}`);
        }
        ok(bad.length === 0 && checked > 50, `${font} font 390x${vh}: toast never covers a heatmap cell or the settings button (6 scroll positions, ${checked} cell checks)${bad.length ? ' failed at ' + bad.map(b => b.where).join(',') : ''}`);
      }
    }
    await p.evaluate(() => { document.getElementById('test-font').remove(); document.querySelector('#toast').hidden = true; });
    // the heatmap stays on the newest week when its width changes (e.g. a scrollbar or font change narrows it)
    const pin = await p.evaluate(async () => {
      const frame = () => new Promise(r => requestAnimationFrame(r)); const sc = document.querySelector('#scroller');
      sc.scrollLeft = sc.scrollWidth; await frame(); await frame();
      const st = document.createElement('style'); st.id = 'narrow'; st.textContent = '.wd{width:70px}'; document.head.appendChild(st);
      for (let i = 0; i < 600 && sc.scrollWidth - sc.clientWidth - sc.scrollLeft >= 2; i++) await frame();
      const r = { gap: sc.scrollWidth - sc.clientWidth - sc.scrollLeft, max: sc.scrollWidth - sc.clientWidth }; st.remove(); await frame(); await frame(); return r; });
    ok(pin.gap < 2 && pin.max > 0, `heatmap re-pinned to the newest week after narrowing (gap ${pin.gap}px of ${pin.max})`);
    await p.setViewportSize({ width: 390, height: 844 });

    // [1] weekly-target habit stats are in weeks
    await p.locator('.tab', { hasText: '運動' }).click();
    const st = (await p.locator('#stats').innerText()).replace(/\s+/g, ' ');
    ok(/本月達標 \d+\/\d+ 週/.test(st) && /最長連續達標 \d+ 週/.test(st) && !/本月完成/.test(st), 'weekly habit stats counted in weeks: ' + st);
    const wk = await p.evaluate(() => { const S = a => new Set(a), { monthWeekly: mw, longestWeekly: lw } = __hg;
      return { m: mw({ createdAt: '2026-08-01', target: 3 }, S(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-12']), '2026-10-12'),
        l: lw(S(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-22', '2026-09-23', '2026-09-24']), 3, '2026-10-12', '2026-08-01') }; });
    ok(wk.m.done === 2 && wk.m.den === 3, `monthWeekly: weeks of 9/28, 10/5 achieved, 10/12 running = 2/3 (${wk.m.done}/${wk.m.den})`);
    ok(wk.l === 2, `longestWeekly = 2 (${wk.l})`);
    // polish 3: a week spanning two months counts in the month of its Thursday
    const th = await p.evaluate(() => { const { monthWeeks: mw } = __hg, h = { createdAt: '2026-08-01' };
      return { nov2: mw(h, '2026-11-02'), nov30: mw(h, '2026-11-30'), dec1: mw(h, '2026-12-01'), oct1: mw(h, '2026-10-01') }; });
    ok(th.nov2.join() === '2026-11-02', 'week of 10/26 (Thu 10/29) is October, not November ' + th.nov2);
    ok(th.nov30.join() === '2026-11-02,2026-11-09,2026-11-16,2026-11-23', 'week of 11/30 (Thu 12/3) is December ' + th.nov30);
    ok(th.dec1.join() === '2026-11-30' && th.oct1.join() === '2026-09-28', 'week of 9/28 (Thu 10/1) is October; 11/30 counts for December');
    // 全部: a weekly habit's rest day does not count as missed
    const lv = await p.evaluate(() => { const d = __hg.data; const run = d.habits.find(h => h.name === '運動'); const k = '2026-10-05';
      const c = document.querySelector('#hgrid .c[data-k="' + k + '"]'); return { done: d.checks[run.id].includes(k) }; });
    await p.click('#tab-all');
    const lab2 = await p.getAttribute('#hgrid .c[data-k="2026-10-12"]', 'aria-label');
    const expect = await p.evaluate(() => { const d = __hg.data, k = '2026-10-12'; const hs = d.habits.filter(h => !h.archived && h.createdAt <= k); const rel = hs.filter(h => h.target >= 7 || d.checks[h.id].includes(k)); return `${rel.filter(h => d.checks[h.id].includes(k)).length}/${rel.length}`; });
    ok(lab2.endsWith('完成 ' + expect) && expect.endsWith('/3'), `全部 cell excludes weekly rest day: ${lab2} (${JSON.stringify(lv)})`);

    // [1] grapheme-correct lengths
    await p.click('#add-btn'); await sheetReady(p);
    await p.fill('#habit-emoji', '👨‍👩‍👧‍👦');
    ok(await p.inputValue('#habit-emoji') === '👨‍👩‍👧‍👦', 'family emoji kept whole in icon field');
    await p.fill('#habit-name', '💧'.repeat(12));
    ok(await p.inputValue('#habit-name') === '💧'.repeat(12), '12 emoji name not cut');
    await p.fill('#habit-name', '一二三四五六七八九十一二三四五六七八九十多');
    ok(await p.inputValue('#habit-name') === '一二三四五六七八九十一二三四五六七八九十', '21 characters clamp to 20');
    await p.fill('#habit-name', '💧'.repeat(12));
    // [2] start date earlier than today
    await p.fill('#habit-start', '2026-10-01');
    await p.click('#edit-save');
    await p.waitForSelector('#edit-sheet', { state: 'hidden' });
    const nh = await p.evaluate(() => __hg.data.habits[__hg.data.habits.length - 1]);
    ok(nh.name === '💧'.repeat(12) && nh.emoji === '👨‍👩‍👧‍👦' && nh.createdAt === '2026-10-01', 'saved name/emoji/start date ' + JSON.stringify([nh.name, nh.emoji, nh.createdAt]));
    ok(!(await p.locator('#hgrid .c[data-k="2026-10-02"]').getAttribute('class')).includes('pre'), 'days after the start date are back-fillable');
    // calendar: a day before the start asks once, then moves the start date and checks it
    await p.click('#cal-open'); await p.waitForSelector('#cal-sheet:not([hidden])');
    await p.click('#cal-prev');
    await p.click('#cal [data-k="2026-09-20"]');
    ok((await p.locator('#cal-msg').innerText()).includes('再點一次') && await p.evaluate(() => __hg.data.habits[__hg.data.habits.length - 1].createdAt) === '2026-10-01', 'pre-start day: first tap only asks');
    await p.click('#cal [data-k="2026-09-20"]');
    const nh2 = await p.evaluate(() => { const h = __hg.data.habits[__hg.data.habits.length - 1]; return { c: h.createdAt, k: __hg.data.checks[h.id] }; });
    ok(nh2.c === '2026-09-20' && nh2.k.includes('2026-09-20'), 'second tap moves start date and back-fills ' + JSON.stringify(nh2));
    await p.click('#cal-close');
    await p.click('#edit-sel'); await sheetReady(p);
    await p.fill('#habit-start', '2026-10-05');
    await p.click('#edit-save');
    ok((await p.locator('#edit-msg').innerText()).includes('第一次打卡'), 'start date later than first check-in rejected');
    await p.fill('#habit-start', '1999-12-31');
    await p.click('#edit-save');
    ok((await p.locator('#edit-msg').innerText()).includes('最早是 2000/1/1'), 'start date before 2000 explains the earliest date');
    await p.click('#edit-cancel');

    // [3 detail] CSV formula injection
    await p.click('#add-btn'); await sheetReady(p); await p.fill('#habit-name', '=1+1'); await p.click('#edit-save');
    await p.locator('.card', { hasText: '=1+1' }).locator('[data-check]').click();
    const csvText = await p.evaluate(() => new Promise(res => { try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { res(t); return Promise.resolve(); } }, configurable: true }); } catch (e) {} document.querySelector('#settings-btn').click(); document.querySelector('#copy-csv').click(); }));
    ok(csvText.includes(`2026-10-12,"'=1+1",1`), 'CSV prefixes formula-like names with \'');
    await p.click('#set-close');

    await ctx.close();
  }

  // ---------- [3] corrupt saved data is kept and announced ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Asia/Taipei', locale: 'zh-TW' });
    await ctx.route('https://artifact.local/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: SRC() }));
    const good = JSON.stringify({ v: 1, habits: [{ id: 'h1', name: '我的習慣', emoji: '✅', color: '#2f7d4f', target: 7, createdAt: '2026-10-01', archived: false }], checks: { h1: ['2026-10-10'] }, order: ['h1'], celebrated: {}, sample: false });
    const bad = good.slice(0, -1);
    const { p } = await open(390, 844, { ctx });
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, bad]);
    await p.reload(); await p.waitForSelector('#list .empty, #list .card');
    ok(await p.locator('#corrupt').isVisible(), 'corrupt banner shown');
    ok(await p.locator('#sample-banner').isHidden() && await p.locator('#list .card').count() === 0, 'no sample data shown over corrupt data');
    const stash = await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('habit-grid:v1:corrupt-')).map(k => localStorage.getItem(k)));
    ok(stash.length === 1 && stash[0] === bad, 'raw corrupt data kept under its own key');
    await p.reload(); await p.waitForSelector('#list .empty');
    ok(await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('habit-grid:v1:corrupt-')).length) === 1, 'reload does not stash it twice');
    await p.click('#corrupt-get');
    ok((await p.inputValue('#export-out')) === bad, '取出 shows the raw data');
    await p.click('#set-close');
    await p.click('#add-btn'); await sheetReady(p); await p.fill('#habit-name', '新'); await p.click('#edit-save');
    ok(await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('habit-grid:v1:corrupt-')).map(k => localStorage.getItem(k))[0]) === bad, 'corrupt copy survives new saves');
    await p.click('#corrupt-ok');
    ok(await p.locator('#corrupt').isHidden(), '重新開始 dismisses banner');
    // polish 4: the stash stays reachable from settings after the banner is gone and after reload
    await p.reload(); await p.waitForSelector('#list .card');
    ok(await p.locator('#corrupt').isHidden(), 'no banner once data is valid again');
    await p.click('#settings-btn');
    await p.waitForSelector('#corrupt-set');
    ok(await p.locator('#corrupt-box').isVisible(), 'settings offers 取出舊資料 while a corrupt copy exists');
    await p.click('#corrupt-set');
    ok((await p.inputValue('#export-out')) === bad, '取出舊資料 shows the stashed raw data');
    await p.click('#set-close');

    // ---------- [3] two tabs: a write in one is picked up by the other ----------
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, good]);
    await p.reload(); await p.waitForSelector('#list .card');
    const p2 = await ctx.newPage(); p2.on('pageerror', e => errs.push(String(e)));
    await p2.goto(URL); await p2.waitForSelector('#list .card');
    await p.click('#add-btn'); await sheetReady(p); await p.fill('#habit-name', 'B-tab1'); await p.click('#edit-save');
    await p2.waitForFunction(() => [...document.querySelectorAll('#list .card b')].some(b => b.textContent === 'B-tab1'), null, { timeout: T })
      .then(() => ok(true, 'other tab shows habit added in tab 1'), () => ok(false, 'other tab shows habit added in tab 1'));
    await p2.locator('.card', { hasText: '我的習慣' }).locator('[data-check]').click();
    await p.reload(); await p.waitForSelector('#list .card');
    ok(await p.locator('.card', { hasText: 'B-tab1' }).count() === 1, 'tab 2 check-in did not erase tab 1 habit');
    // import validation keeps whole graphemes
    await p.evaluate(() => localStorage.setItem('habit-grid:v1:data', JSON.stringify({ habits: [{ id: 'a', name: '💧'.repeat(20), emoji: '👨‍👩‍👧‍👦x' }], checks: {} })));
    await p.reload(); await p.waitForSelector('#list .card');
    const h = await p.evaluate(() => __hg.data.habits[0]);
    ok(h && h.name === '💧'.repeat(20) && h.emoji === '👨‍👩‍👧‍👦', 'stored 20-emoji name valid, icon keeps first whole grapheme');
    await ctx.close();
  }

  // ---------- [6] 844x390: no month label cut at the heatmap's left edge ----------
  {
    const { ctx, p } = await open(844, 390);
    await p.locator('#list .card').first().locator('[data-body]').click();
    for (const x of [null, 37, 101]) {
      if (x != null) { await p.evaluate(x => { document.querySelector('#scroller').scrollLeft = x; }, x); }
      await p.waitForFunction(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))));
      const r = await p.evaluate(() => { const L = document.querySelector('#scroller').getBoundingClientRect().left; const labs = [...document.querySelectorAll('.mlab')].filter(m => m.textContent);
        return { cut: labs.filter(m => m.getBoundingClientRect().left < L - .5).map(m => m.textContent), first: labs.length ? labs[0].getBoundingClientRect().left - L : 99 }; });
      ok(r.cut.length === 0 && r.first < 60, `844x390 scroll ${x}: no clipped month label, first label near left edge (${JSON.stringify(r)})`);
    }
    await ctx.close();
  }

  // ---------- polish 2: calendar opens at the top at 844x390 ----------
  {
    const { ctx, p } = await open(844, 390);
    await p.locator('.card', { hasText: '運動' }).locator('[data-body]').click();
    await p.click('#cal-open');
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'cal-h', null, { timeout: T });
    const r = await p.evaluate(() => { const sc = document.querySelector('#cal-sheet'), t = document.querySelector('#cal-prev').getBoundingClientRect(); return { top: sc.scrollTop, prev: t.top, h: innerHeight }; });
    ok(r.top === 0 && r.prev >= 0 && r.prev < r.h, '844x390 calendar opens at the top with month buttons visible ' + JSON.stringify(r));
    await ctx.close();
  }

  // ---------- polish 1 + 6: 360 wide: toast clear of the settings button; weekly card breaks at · ----------
  for (const w of [360, 390]) {
    const { ctx, p } = await open(w, 640);
    await p.evaluate(() => { document.querySelector('#toast-text').textContent = '已刪除「一二三四五六七八九十一二三四五六七八九十」'; document.querySelector('#toast-undo').hidden = false; document.querySelector('#toast').hidden = false; });
    const r = await p.evaluate(() => { const a = document.querySelector('#toast').getBoundingClientRect(), b = document.querySelector('#settings-btn').getBoundingClientRect();
      return { overlap: !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right), hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).closest('#settings-btn') !== null }; });
    ok(!r.overlap && r.hit, `${w}: toast does not cover the settings button ${JSON.stringify(r)}`);
    const lines = await p.evaluate(() => [...document.querySelectorAll('.card small .nw')].map(e => { const r = document.createRange(); r.selectNodeContents(e); return new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.bottom))).size; }));
    ok(lines.length === 2 && lines.every(n => n === 1), `${w}: weekly meta parts never split (break only at ·) ${lines}`);
    await ctx.close();
  }

  ok(errs.length === 0, 'no page/console errors ' + errs.join(' | '));
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('FAIL uncaught: ' + String((e && e.message) || e).split('\n').slice(0, 3).join(' ')); process.exit(1); });
