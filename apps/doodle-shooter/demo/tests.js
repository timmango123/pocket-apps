// Regression tests for 塗鴉射擊 (doodle-shooter): the real page in mobile Chromium with real CDP touch, one check per
// release-review finding (2026-11-01). The page is served from memory with a hook appended inside the game closure
// (served copy only, the file on disk is untouched); every external request is aborted (= offline). Usage: node tests.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const HOOK = `
window.__ds = { P, get boss() { return boss; }, get state() { return state; }, get phase() { return phase; }, get stage() { return stage; },
  get score() { return score; }, get paused() { return paused; }, get cleared() { return cleared; }, get best() { return best; },
  get muted() { return muted; }, get drag() { return drag; }, stars, get ebn() { return ebs.filter(b => b.on).length; },
  inv(v) { P.inv = v; }, bossHp(n) { if (boss) boss.hp = n; }, setScore(n) { score = n; },
  skipToBoss() { queue.length = 0; qi = 0; for (const e of ens) e.on = false; nEnemies = 0; gapT = 0; phase = 'waves'; waveIdx = nWaves() - 1; },
  bossFor(n) { const s = stage; stage = n; spawnBoss(); const r = { kind: boss.kind, pats: boss.pats.slice(), name: boss.name, sz: boss.sz }; stage = s; boss = null; return r; },
  forcePat(n, p) { stage = n; for (const b of ebs) b.on = false; spawnBoss(); phase = 'boss'; boss.t = 3; boss.y = boss.ty; boss.pat = p; boss.patT = 99; boss.shotT = 0; },
  over() { gameOver(); },
  swayMax(sz) { return LW * 0.27 * Math.min(1, 1 / sz); }, LW };
`;
const marker = 'requestAnimationFrame(frame);\n})();';
ok(html.lastIndexOf(marker) > 0, 'hook marker present');
const served = '<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">' +
  html.slice(0, html.lastIndexOf(marker)) + HOOK + html.slice(html.lastIndexOf(marker)) + '</body></html>';
const URL = 'http://ds.test/apps/doodle-shooter/';

(async () => {
  console.log('Static');
  await t('no web-font / external links in the file (fonts are system stacks)', () => {
    ok(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+https?:/i.test(html), 'external font link'); ok(!/src=["']https?:/i.test(html), 'external script');
  });

  const browser = await chromium.launch();
  const errors = [], external = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    await page.route('**/*', r => { const u = r.request().url(); if (u === URL) r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: served }); else { external.push(u); r.abort(); } });
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__ds && document.getElementById('startBtn').getBoundingClientRect().height > 40, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page), f = {};
    const pts = () => Object.entries(f).map(([id, p]) => ({ x: p.x, y: p.y, id: +id }));
    const H = {
      down: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); },
      move: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); },
      up: async id => { const p = f[id]; delete f[id]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: +id }] }); },   // touchEnd lists the lifted point
    };
    H.tap = async (x, y, id = 9, hold = 40) => { await H.down(id, x, y); await sleep(hold); await H.up(id); };
    const ev = (fn, a) => page.evaluate(fn, a);
    const until = (fn, a, ms) => page.waitForFunction(fn, a, { timeout: ms || 30000, polling: 30 });
    const ctr = sel => ev(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }; }, sel);
    const tapSel = async sel => { const c = await ctr(sel); await H.tap(c.x, c.y); await sleep(60); };
    const start = async () => { await tapSel('#startBtn'); await until(() => __ds.state === 'play'); await ev(() => __ds.inv(1e9)); };
    const clearStage = async () => { await ev(() => __ds.skipToBoss()); await until(() => __ds.phase === 'boss' && __ds.boss && __ds.boss.y > 0); await ev(() => __ds.bossHp(1)); await until(() => __ds.phase === 'clear'); };
    return { ctx, page, H, ev, until, ctr, tapSel, start, clearStage };
  }

  console.log('Page (390x844 touch)');
  let A = await open();
  await t('offline load: zero external requests, zero console errors', async () => { await sleep(300); eq(external, [], 'external'); eq(errors, [], 'errors'); });
  await t('single-finger taps on mute at 8/s: 10 taps -> 10 toggles (no double fire)', async () => {
    const c = await A.ctr('#muteBtn'); const m0 = await A.ev(() => __ds.muted); let n = 0, prev = m0;
    for (let i = 0; i < 10; i++) { await A.H.tap(c.x, c.y, 3 + (i % 2), 40); await sleep(85); const m = await A.ev(() => __ds.muted); if (m !== prev) { n++; prev = m; } }
    eq(n, 10, 'toggles'); eq(await A.ev(() => __ds.muted), m0, 'even count back to start');
  });
  await t('keyboard activation still works once (Enter on focused mute)', async () => {
    await sleep(1100); const m0 = await A.ev(() => __ds.muted); await A.ev(() => document.getElementById('muteBtn').focus()); await A.page.keyboard.press('Enter');
    await sleep(100); eq(await A.ev(() => __ds.muted), !m0); await A.page.keyboard.press('Enter'); await sleep(100); eq(await A.ev(() => __ds.muted), m0);
  });
  await t('mute and pause sit above every overlay (not covered) and pause is hidden outside play', async () => {
    const cov = () => A.ev(() => ['#muteBtn', '#pauseBtn'].map(s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); if (getComputedStyle(e).display === 'none') return 'off'; const h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e.contains(h) ? 'ok' : 'covered'; }));
    eq(await cov(), ['ok', 'off'], 'title');
    await A.tapSel('#selectBtn'); await A.until(() => !document.getElementById('ovSelect').hidden); eq(await cov(), ['ok', 'off'], 'select');
    await A.tapSel('#selBack');
  });
  await t('pause is display:none on menus so mute sits in the corner; in play nothing moves', async () => {
    const pos = () => A.ev(() => { const m = document.getElementById('muteBtn').getBoundingClientRect(), p = document.getElementById('page').getBoundingClientRect(); return { gap: Math.round(p.right - m.right), x: Math.round(m.left), pd: getComputedStyle(document.getElementById('pauseBtn')).display }; });
    const t0 = await pos(); eq(t0.pd, 'none'); ok(t0.gap <= 12, 'mute in the corner, gap ' + t0.gap);
    await A.start(); const a = await pos(), pb = await A.ctr('#pauseBtn');
    await A.H.down(1, 195, 650); await A.H.move(1, 160, 640); await sleep(100); await A.H.up(1);
    const b = await pos(), pb2 = await A.ctr('#pauseBtn'); eq([a.x, pb.x, pb.y], [b.x, pb2.x, pb2.y], 'tools fixed during play'); ok(a.pd !== 'none', 'pause shown in play');
    await A.H.tap(pb.x, pb.y, 5, 40); await A.until(() => __ds.paused); eq((await A.ctr('#pauseBtn')).x, pb.x, 'pause stays put on the pause card');
    await A.tapSel('#quitBtn'); await A.until(() => __ds.state === 'title'); await A.tapSel('#selBack');
  });
  await t('touch taps leave no focus ring: canvas after 開始, buttons after 暫停 / 繼續 / 選關', async () => {
    const rings = () => A.ev(() => [...document.querySelectorAll(':focus-visible')].map(e => e.id || e.tagName));
    await A.start(); eq(await rings(), [], 'after start'); eq(await A.ev(() => getComputedStyle(document.getElementById('cv')).outlineStyle), 'none');
    const pb = await A.ctr('#pauseBtn'); await A.H.tap(pb.x, pb.y, 5, 40); await A.until(() => __ds.paused); eq(await rings(), [], 'after pause');
    await A.tapSel('#resumeBtn'); await A.until(() => !__ds.paused); eq(await rings(), [], 'after resume');
    await A.H.tap(pb.x, pb.y, 5, 40); await A.until(() => __ds.paused); await A.tapSel('#quitBtn'); await A.until(() => !document.getElementById('ovSelect').hidden);
    eq(await rings(), [], 'after quit to select'); await A.tapSel('#selBack'); eq(await rings(), [], 'after back');
    await A.page.keyboard.press('Tab'); await A.page.keyboard.press('Escape'); await A.tapSel('#selectBtn');   // a key then a tap: still no ring
    eq(await rings(), [], 'tap after a key'); await A.tapSel('#selBack');
  });
  await t('keyboard users still get focus moved to the next control', async () => {
    await A.ev(() => document.getElementById('selectBtn').focus()); await A.page.keyboard.press('Enter');
    await A.until(() => !document.getElementById('ovSelect').hidden); eq(await A.ev(() => document.activeElement.classList.contains('lv')), true);
    await A.ev(() => document.getElementById('selBack').focus()); await A.page.keyboard.press('Enter'); await A.until(() => !document.getElementById('ovStart').hidden);
    eq(await A.ev(() => document.activeElement.id), 'startBtn');
  });
  await t('thumb held on the canvas: 2nd finger taps mute 20x at 8/s -> 20 toggles; pause pauses; resume resumes', async () => {
    await A.start();
    await A.H.down(1, 195, 650); await sleep(60);
    const c = await A.ctr('#muteBtn'); let n = 0, prev = await A.ev(() => __ds.muted);
    for (let i = 0; i < 20; i++) { await A.H.tap(c.x, c.y, 3 + (i % 2), 40); await sleep(85); const m = await A.ev(() => __ds.muted); if (m !== prev) { n++; prev = m; } }
    eq(n, 20, 'mute toggles with a thumb down');
    const p = await A.ctr('#pauseBtn'); await A.H.tap(p.x, p.y, 5, 40); await A.until(() => __ds.paused);
    ok(!(await A.ev(() => document.getElementById('ovPause').hidden)), 'pause overlay shown');
    const r = await A.ctr('#resumeBtn'); await A.H.tap(r.x, r.y, 6, 40); await A.until(() => !__ds.paused);
    // the thumb that never lifted steers again after resume
    const x0 = await A.ev(() => __ds.P.x); await A.H.move(1, 165, 650); await A.until(x => Math.abs(__ds.P.x - x) > 20, x0, 5000);
    await A.H.up(1);
  });
  await t('second finger lifts: the thumb still on the canvas takes the drag back', async () => {
    await A.H.down(1, 200, 650); await A.H.move(1, 210, 650);
    await A.H.down(2, 120, 600); await A.H.move(2, 100, 600); await A.H.up(2);
    const x0 = await A.ev(() => __ds.P.x); await A.H.move(1, 250, 650);
    await A.until(x => __ds.P.x > x + 30, x0, 5000); eq(await A.ev(() => __ds.drag && __ds.drag.id != null), true);
    await A.H.up(1); await A.until(() => !__ds.drag);
  });
  await t('quitting mid-run (pause -> 回選關) saves the best score', async () => {
    await A.clearStage(); const sc = await A.ev(() => __ds.score); ok(sc > 2500, 'scored ' + sc);
    await A.ev(() => __ds.setScore(__ds.score + 1));
    const p = await A.ctr('#pauseBtn'); await A.H.tap(p.x, p.y); await A.until(() => __ds.paused);
    await A.tapSel('#quitBtn'); await A.until(() => __ds.state === 'title');
    eq(await A.ev(() => JSON.parse(localStorage.getItem('doodleShooter.best'))), sc + 1, 'stored best');
  });
  await t('stage cleared without losing a life -> 3 stars saved and shown on the level button', async () => {
    eq(await A.ev(() => JSON.parse(localStorage.getItem('doodleShooter.stars'))[1].s), 3);
    ok(/★★★/.test(await A.ev(() => document.querySelectorAll('#lvwrap .lv')[0].textContent)), 'stars on button');
    eq(await A.ev(() => __ds.cleared), 1, 'progress 1');
  });
  await t('pagehide during a run also saves the best score', async () => {
    await A.tapSel('#selBack'); await A.start(); await A.ev(() => __ds.setScore(987654));
    await A.ev(() => dispatchEvent(new Event('pagehide'))); eq(await A.ev(() => JSON.parse(localStorage.getItem('doodleShooter.best'))), 987654);
  });
  await A.ctx.close();

  console.log('Unlock all = practice');
  A = await open({ init: () => { if (!sessionStorage.x) { sessionStorage.x = 1; localStorage.setItem('doodleShooter.cleared', '3'); localStorage.setItem('doodleShooter.best', '1000'); localStorage.setItem('doodleShooter.unlockAll', 'true'); } } });
  await t('old saved keys still load (best 1000, cleared 3, unlockAll on)', async () => {
    eq(await A.ev(() => [__ds.best, __ds.cleared, document.getElementById('startBtn').textContent]), [1000, 3, '繼續第 4 關']);
  });
  await t('beating stage 60 via "unlock all" leaves real progress and best score alone', async () => {
    await A.tapSel('#selectBtn');
    await A.ev(() => document.querySelectorAll('#lvwrap .lv')[59].scrollIntoView({ block: 'center' })); await sleep(100);
    const c = await A.ev(() => { const b = document.querySelectorAll('#lvwrap .lv')[59].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await A.H.tap(c.x, c.y); await A.until(() => __ds.state === 'play' && __ds.stage === 60); await A.ev(() => __ds.inv(1e9));
    await A.clearStage();
    eq(await A.ev(() => [__ds.cleared, JSON.parse(localStorage.getItem('doodleShooter.cleared')), __ds.best, !!__ds.stars[60]]), [3, 3, 1000, false]);
    await A.ev(() => { __ds.inv(0); __ds.P.lives = 1; }); await A.until(() => __ds.state === 'over', null, 60000);
    eq(await A.ev(() => [document.getElementById('overPrac').hidden, document.getElementById('overNew').hidden, __ds.best]), [false, true, 1000]);
    eq(await A.ev(() => document.getElementById('overTitle').textContent), '被擦掉了！', 'title does not repeat the 新紀錄 stamp');
  });
  await t('the next real stage (4) still counts with "unlock all" on', async () => {
    await A.tapSel('#overSelect'); await A.ev(() => document.querySelectorAll('#lvwrap .lv')[3].scrollIntoView({ block: 'center' })); await sleep(100);
    const c = await A.ev(() => { const b = document.querySelectorAll('#lvwrap .lv')[3].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await A.H.tap(c.x, c.y); await A.until(() => __ds.state === 'play' && __ds.stage === 4); await A.ev(() => __ds.inv(1e9));
    await A.clearStage(); eq(await A.ev(() => __ds.cleared), 4);
  });
  await A.ctx.close();

  console.log('Content and layout');
  A = await open({ init: () => { localStorage.setItem('doodleShooter.stars', '{"bad'); } });
  await t('broken stars data falls back to empty', async () => eq(await A.ev(() => Object.keys(__ds.stars).length), 0));
  await t('chapters 7-10 each bring a signature boss pattern, and two new boss looks join', async () => {
    const r = await A.ev(() => [61, 71, 81, 91, 100].map(n => __ds.bossFor(n)));
    eq(r.map(b => b.pats.includes(6 + Math.min(3, Math.floor((([61, 71, 81, 91, 100])[r.indexOf(b)] - 61) / 10)))), [true, true, true, true, true]);
    const kinds = await A.ev(() => { const k = new Set(); for (let n = 61; n < 100; n++) k.add(__ds.bossFor(n).kind); return [...k].sort(); });
    eq(kinds, [0, 1, 2, 3, 4]); eq(await A.ev(() => __ds.bossFor(10).pats.some(p => p > 5)), false, 'early stages unchanged');
  });
  await t('each new pattern fires bullets in play without errors', async () => {
    await A.start();
    for (const [n, p] of [[61, 6], [71, 7], [81, 8], [91, 9]]) { await A.ev(([n, p]) => __ds.forcePat(n, p), [n, p]); await A.until(() => __ds.ebn > 5); }
    eq(errors, []);
  });
  await t('stage 100 boss stays on the page while swaying', async () => {
    const r = await A.ev(() => { const sz = __ds.bossFor(100).sz; return __ds.LW / 2 - __ds.swayMax(sz) - 62 * sz; }); ok(r >= 0, 'left edge ' + r);
  });
  await t('touch device hides the keyboard hint', async () => eq(await A.ev(() => getComputedStyle(document.querySelector('.kbd')).display), 'none'));
  await A.ctx.close();

  for (const [w, h] of [[375, 500], [844, 390], [360, 640]]) {
    A = await open({ w, h });
    await t(w + 'x' + h + ': 返回 in level select and 選關 on the result card are on screen without scrolling', async () => {
      await A.tapSel('#selectBtn'); await A.until(() => !document.getElementById('ovSelect').hidden);
      const s = await A.ev(() => { const o = document.getElementById('ovSelect'), b = document.getElementById('selBack').getBoundingClientRect(), w = document.getElementById('lvwrap').getBoundingClientRect(); return { bottom: b.bottom, H: innerHeight, over: o.scrollHeight - o.clientHeight, grid: w.height }; });
      ok(s.bottom <= s.H && (h > 560 || s.over <= 1), '返回 bottom ' + s.bottom + ' / ' + s.H + ', overlay overflow ' + s.over); ok(s.grid >= 90, 'grid height ' + s.grid);
      await A.tapSel('#selBack'); await A.start(); await A.ev(() => { __ds.setScore(123456); __ds.over(); document.getElementById('overNew').hidden = false; document.getElementById('overPrac').hidden = false; });   // worst case: both labels
      const o = await A.ev(() => { const v = document.getElementById('ovOver'), b = document.getElementById('overSelect').getBoundingClientRect(), a = document.getElementById('againBtn').getBoundingClientRect(); return { bottom: b.bottom, H: innerHeight, over: v.scrollHeight - v.clientHeight, ah: a.height, bh: b.height }; });
      ok(o.bottom <= o.H && (h > 560 || o.over <= 1), '選關 bottom ' + o.bottom + ' / ' + o.H + ', overflow ' + o.over); ok(o.ah >= 44 && o.bh >= 44, 'buttons >= 44 tall');
      const m = await A.ev(() => { const e = document.getElementById('muteBtn'), b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); }); ok(m, 'mute on top of the result card');
    });
    await A.ctx.close();
  }
  for (const [w, h] of [[360, 640], [844, 390]]) {
    A = await open({ w, h });
    await t(w + 'x' + h + ': no overlay covers mute; mute toggles on title/select; level buttons >= 44 wide', async () => {
      const chk = () => A.ev(() => { const e = document.getElementById('muteBtn'), b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)); });
      ok(await chk(), 'title'); const m0 = await A.ev(() => __ds.muted); await A.tapSel('#muteBtn'); eq(await A.ev(() => __ds.muted), !m0, 'mute on title');
      await A.tapSel('#selectBtn'); await A.until(() => !document.getElementById('ovSelect').hidden); ok(await chk(), 'select');
      // tall screens: the note starts below the button; short screens: the button sits over the note's corner, clear of the title
      const notes = await A.ev(() => { const m = document.getElementById('muteBtn').getBoundingClientRect(), n = document.querySelector('#ovSelect .note').getBoundingClientRect(), t = document.querySelector('#ovSelect h2').getBoundingClientRect(); return { below: n.top - m.bottom, title: t.right <= m.left || t.top >= m.bottom }; });
      ok(h <= 560 ? notes.title : notes.below > 0, 'select note vs mute ' + JSON.stringify(notes));
      const lw = await A.ev(() => Math.min(...[...document.querySelectorAll('#lvwrap .lv')].map(b => b.getBoundingClientRect().width)));
      ok(lw >= 44, 'level button width ' + lw);
      if (w > h) {
        eq(await A.ev(() => Math.round(document.getElementById('page').getBoundingClientRect().width)), Math.round(h * 0.75), 'wider landscape page');
        await A.tapSel('#selBack');
        eq(await A.ev(() => getComputedStyle(document.querySelector('#ovStart li')).display !== 'none'), true, 'drag hint kept in landscape');
      }
    });
    await A.ctx.close();
  }
  await t('no page or console errors, no external requests overall', () => { eq(errors, []); eq(external, []); });
  await browser.close();
  console.log((fail ? 'FAIL ' : '') + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e); process.exit(1); });
