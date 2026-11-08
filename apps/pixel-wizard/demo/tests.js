// Regression tests for 像素法師 (pixel-wizard): the real page in mobile Chromium with CDP touch, one check per
// release-review finding (2026-11-08). Usage: node tests.js
const fs = require('fs'), path = require('path'), os = require('os');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
// same skeleton the lobby / Artifact host wraps the page in (doctype + viewport)
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-tests-'));
const PAGE = path.join(TMP, 'index.html');
fs.writeFileSync(PAGE, SKELETON + html + '</body></html>');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message || e).split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('Source');
  await t('no external fonts, preconnects or other network URLs', () => {
    ok(!/fonts\.googleapis|fonts\.gstatic|<link[^>]+href=["']https?:/i.test(html), 'external stylesheet / preconnect');
    ok(!/<script[^>]+src=/i.test(html), 'external script');
    ok(!/近乎不可能/.test(html), 'old "nearly impossible" wording');
  });

  console.log('Page (CDP touch)');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [], requests = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(`try{localStorage.setItem('pw-muted','true')}catch(e){}`);
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) requests.push(r.url()); });
    await page.goto('file://' + PAGE);
    await page.waitForFunction(() => window.__pw && __pw.wiz, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ctr = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 30000, polling: 30 });
    const ev = (f, a) => page.evaluate(f, a);
    // tap with finger `id`; other fingers listed in `others` stay down (they are repeated in touchStart, not in touchEnd)
    const tapAt = async (c, id = 9, hold = 40, others = []) => {
      await touch('touchStart', [...others, { ...c, id }]); await sleep(hold);
      await touch('touchEnd', [{ ...c, id }]); await sleep(40);
    };
    const tap = async (sel, id, hold, others) => tapAt(await ctr(sel), id, hold, others);
    const safe = () => ev(() => { __pw.wiz.inv = 1e9; __pw.wiz.hp = 100; });
    return { ctx, page, touch, ctr, tap, tapAt, until, ev, safe };
  }

  // ---- first load: nothing moves until the first input; hint does not cover the wizard ----
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    const P = await open({ w, h });
    await t(`${w}x${h}: waits for the first input, hint sits above the wizard`, async () => {
      const a = await P.ev(() => ({ s: __pw.spawnT, wait: __pw.waiting }));
      eq(a.wait, true, 'waiting on load');
      await P.until(() => performance.now() > 1500);
      const b = await P.ev(() => {
        const r = document.getElementById('hint').getBoundingClientRect(), S = __pw.S, dpr = devicePixelRatio;
        return { s: __pw.spawnT, n: __pw.wisps.length, hp: __pw.wiz.hp, hintBottom: r.bottom, wizTop: (__pw.wiz.y - 26) * S / dpr, hidden: document.getElementById('hint').hidden };
      });
      eq(b.s, a.s, 'spawn timer frozen'); eq(b.n, 0, 'no wisps'); eq(b.hp, 100, 'no damage while reading');
      ok(!b.hidden && b.hintBottom < b.wizTop, `hint bottom ${b.hintBottom} must be above wizard top ${b.wizTop}`);
      await P.tapAt({ x: w / 2, y: h * 0.45 });
      await P.until(() => !__pw.waiting && __pw.spawnT < 2.1);
      await P.until(() => document.getElementById('hint').hidden);
    });
    if (h < w) await t(`${w}x${h}: ground line is above the control row`, async () => {
      const r = await P.ev(() => ({ g: __pw.groundY * __pw.S / devicePixelRatio, c: document.getElementById('controls').getBoundingClientRect().top }));
      ok(r.g <= r.c, `ground ${r.g} vs controls top ${r.c}`);
    });
    await P.ctx.close();
  }

  // ---- HUD buttons with another finger already down ----
  let P = await open();
  await P.tapAt({ x: 195, y: 380 }); await P.safe();
  await t('single tap on mute toggles exactly once', async () => {
    const m0 = await P.ev(() => __pw.muted);
    await P.tap('#muteBtn'); await sleep(150);
    eq(await P.ev(() => __pw.muted), !m0);
  });
  for (const hold of [600, 1000]) await t(`slow tap held ${hold} ms toggles mute once`, async () => {
    const m0 = await P.ev(() => __pw.muted);
    await P.tap('#muteBtn', 9, hold); await sleep(150);
    eq(await P.ev(() => __pw.muted), !m0);
  });
  await t('thumb holding ◀: 20 mute taps at 8/s with a second finger → 20 toggles, wizard keeps walking', async () => {
    await P.safe();
    const L = await P.ctr('#bL'), thumb = { ...L, id: 1 }, mute = await P.ctr('#muteBtn');
    await P.ev(() => { window.__mt = 0; const o = new MutationObserver(() => window.__mt++); o.observe(document.getElementById('muteBtn'), { attributes: true, attributeFilter: ['aria-pressed'] }); });
    await P.touch('touchStart', [thumb]);
    for (let i = 0; i < 20; i++) { await P.touch('touchStart', [thumb, { ...mute, id: 2 + (i % 3) }]); await sleep(45); await P.touch('touchEnd', [{ ...mute, id: 2 + (i % 3) }]); await sleep(60); }
    await sleep(150);
    const r = await P.ev(() => ({ n: window.__mt, held: __pw.held.L }));
    await P.touch('touchEnd', [thumb]);
    eq(r.n, 20, 'toggles'); eq(r.held, true, '◀ still held');
  });
  await t('thumb holding ◀: pause, day/night, then stage list all respond to the second finger', async () => {
    const thumb = { ...(await P.ctr('#bL')), id: 1 };
    await P.touch('touchStart', [thumb]);
    await P.tap('#pauseBtn', 5, 40, [thumb]);
    eq(await P.ev(() => __pw.paused), true, 'paused');
    await P.tap('#pauseBtn', 6, 40, [thumb]);
    eq(await P.ev(() => __pw.paused), false, 'resumed');
    const d0 = await P.ev(() => document.getElementById('dayBtn').getAttribute('aria-label'));
    await P.tap('#dayBtn', 7, 40, [thumb]); await sleep(100);
    ok(await P.ev(d => document.getElementById('dayBtn').getAttribute('aria-label') !== d, d0), 'day button label flips');
    await P.tap('#lvBtn', 8, 40, [thumb]);
    eq(await P.ev(() => !document.getElementById('levels').hidden), true, 'stage list open');
    await P.touch('touchEnd', [thumb]);
    await P.tap('#lvClose'); await sleep(100);
    eq(await P.ev(() => document.getElementById('levels').hidden), true, 'closed');
  });
  await t('thumb resting on the canvas: pause still works', async () => {
    const thumb = { x: 60, y: 400, id: 1 };
    await P.touch('touchStart', [thumb]);
    await P.tap('#pauseBtn', 4, 40, [thumb]);
    const p = await P.ev(() => __pw.paused);
    await P.touch('touchEnd', [thumb]);
    await P.tap('#pauseBtn');
    eq(p, true);
    eq(await P.ev(() => __pw.paused), false);
  });
  await t('keyboard Enter / Space on mute still toggle once each', async () => {
    const m0 = await P.ev(() => __pw.muted);
    await P.page.focus('#muteBtn'); await P.page.keyboard.press('Enter');
    eq(await P.ev(() => __pw.muted), !m0, 'Enter');
    await P.page.keyboard.press(' ');
    eq(await P.ev(() => __pw.muted), m0, 'Space');
  });
  await t('day/night button shows a sun by day and a moon by night', async () => {
    await P.ev(() => __pw.setDay(0.5)); await P.until(() => document.getElementById('moonIco').style.display === 'none');
    ok(await P.ev(() => document.getElementById('sunIco').style.display !== 'none'), 'sun');
    await P.ev(() => __pw.setDay(0.0)); await P.until(() => document.getElementById('sunIco').style.display === 'none');
    ok(/夜晚，切換成白天/.test(await P.ev(() => document.getElementById('dayBtn').getAttribute('aria-label'))), 'label');
  });
  await t('screen change: tapping the stage-list button does not press what appears under the finger', async () => {
    await P.tap('#lvBtn'); await sleep(300);
    eq(await P.ev(() => !document.getElementById('levels').hidden), true, 'still open (close button not ghost-pressed)');
    await P.tapAt({ x: 5, y: 422 }); await sleep(100);  // backdrop
    eq(await P.ev(() => document.getElementById('levels').hidden), true, 'backdrop tap closes');
  });
  await t('weak-point hit floats "x2"', async () => {
    await P.safe();
    const r = await P.ev(() => { const w = __pw.wiz; __pw.spawnWisp(false, { x: w.x + 20, y: w.y - 30, type: 0, hp: 500, vx: 0 }); const q = __pw.wisps[__pw.wisps.length - 1]; __pw.damage(q, 12, 1); return __pw.texts.map(t => t.s); });
    ok(r.includes('x2'), JSON.stringify(r));
  });
  await t('new wisp kinds: shield blocks one hit, crystal resists, split leaves two small wisps', async () => {
    const r = await P.ev(() => {
      const w = __pw.wiz, mk = () => { __pw.spawnWisp(false, { x: w.x + 30, y: w.y - 40, type: 0, hp: 100, vx: 0 }); return __pw.wisps[__pw.wisps.length - 1]; };
      const a = mk(); a.shield = true; __pw.damage(a, 18, 0); const shieldHp = a.hp, shieldOn = a.shield; __pw.damage(a, 18, 0);
      const b = mk(); b.trait = 'crystal'; __pw.damage(b, 20, 0);
      const c = mk(); c.trait = 'split'; const n0 = __pw.wisps.length; __pw.damage(c, 500, 2);
      const kids = __pw.wisps.slice(n0).filter(q => !q.dead && q.mini).length;
      return { shieldHp, shieldOn, after: a.hp, crystal: b.hp, kids, b10: __pw.bossKind(10), b30: __pw.bossKind(30), b40: __pw.bossKind(40), b50: __pw.bossKind(50), b100: __pw.bossKind(100), from: __pw.TRAITS.map(t => t.from) };
    });
    eq([r.shieldHp, r.shieldOn, r.after], [100, false, 82], 'shield');
    eq(r.crystal, 88, 'crystal x0.6'); eq(r.kids, 2, 'split');
    eq([r.b10, r.b30, r.b40, r.b50, r.b100], [0, 1, 2, 3, 4], 'boss kinds'); eq(r.from, [15, 30, 45, 60]);
    await P.ev(() => { for (const q of __pw.wisps) q.dead = true; });
  });
  await t('portrait: wisps use the tall sky (band under the HUD, not a fixed 70 px)', async () => {
    const r = await P.ev(() => { const [low, span] = __pw.flyBand(false); return { low, span, top: low - span, hud: __pw.hudBuf, g: __pw.groundY }; });
    ok(r.span > 100, 'span ' + r.span); ok(r.top >= r.hud, 'below HUD'); ok(r.low <= r.g - 40, 'above wizard');
  });
  await t('difficulty labels: stage 25 and 50 no longer read "hard" / "extreme"', async () => {
    const r = await P.ev(() => [25, 50, 75, 100].map(n => __pw.stageParams(n).tier));
    ok(r[0] !== '困難' && r[1] !== '極難', JSON.stringify(r));
    ok(await P.ev(() => document.querySelectorAll('#lvLegend li').length === 6), 'legend');
  });
  await P.ctx.close();

  // ---- result card: guard window, finger across the card appearing, death card buttons, progress ----
  P = await open({ init: `try{if(!sessionStorage.getItem('x')){sessionStorage.setItem('x',1);localStorage.setItem('pw-progress','{"unlocked":1,"stars":[],"best":[],"last":1}');localStorage.removeItem('pw-unlock-all')}}catch(e){}` });
  await P.tapAt({ x: 195, y: 380 }); await P.safe();
  await t('finger down before the clear card appears and lifted after it: no button fires', async () => {
    const c = await P.ctr('#again').catch(() => null);
    const pt = c && c.x ? c : { x: 195, y: 520 };
    await P.touch('touchStart', [{ ...pt, id: 3 }]);
    await P.ev(() => __pw.finish());
    await P.until(() => !document.getElementById('over').hidden);
    const at = await P.ctr('#again');
    await P.touch('touchEnd', [{ ...at, id: 3 }]); await sleep(150);
    eq(await P.ev(() => ({ st: __pw.state, wave: __pw.wave })), { st: 'clear', wave: 1 });
  });
  await t('card shown: overShownAt stamped; taps inside the 350 ms guard are ignored, later taps work', async () => {
    ok(await P.ev(() => performance.now() - __pw.overShownAt < 5000), 'stamped on show');
    await P.ev(() => { __pw.overShownAt = performance.now() + 60000; });   // pretend it just appeared
    await P.tap('#again'); await sleep(100);
    eq(await P.ev(() => __pw.state), 'clear', 'guarded tap ignored');
    await P.ev(() => { __pw.overShownAt = -1e9; });
    await P.tap('#again');
    await P.until(() => __pw.state === 'play' && __pw.wave === 2);
  });
  await t('after clearing stage 1 the save continues at stage 2', async () => {
    eq(await P.ev(() => ({ last: __pw.prog.last, un: __pw.prog.unlocked, st: __pw.prog.stars[0] })), { last: 2, un: 2, st: 3 });
    await sleep(600); await P.page.reload();  // let Chromium commit localStorage to its storage service before the reload await P.until(() => window.__pw && __pw.wiz);
    eq(await P.ev(() => __pw.wave), 2, 'reload resumes at 2');
    await P.tapAt({ x: 195, y: 380 }); await P.safe();
  });
  await t('death card: "再試一次" + "上一關" (no duplicate retry); 上一關 goes back one stage', async () => {
    await P.ev(() => { __pw.wiz.inv = 0; __pw.wiz.hp = 0; });
    await P.until(() => !document.getElementById('over').hidden);
    const r = await P.ev(() => ({ a: document.getElementById('again').textContent, b: document.getElementById('oRetry').textContent, hid: document.getElementById('oRetry').hidden, h: document.getElementById('oRetry').getBoundingClientRect().height }));
    eq([r.a, r.b, r.hid], ['再試一次', '上一關', false]); ok(r.h >= 44, 'small button height ' + r.h);
    await P.ev(() => { __pw.overShownAt = -1e9; });
    await P.tap('#oRetry');
    await P.until(() => __pw.state === 'play' && __pw.wave === 1);
    await P.tapAt({ x: 195, y: 380 }); await P.ev(() => { __pw.wiz.inv = 0; __pw.wiz.hp = 0; });
    await P.until(() => !document.getElementById('over').hidden);
    eq(await P.ev(() => [document.getElementById('oRetry').hidden, document.getElementById('oLevels').classList.contains('wide')]), [true, true], 'stage 1: only 選擇關卡 beside retry');
  });
  await t('practice ("unlock all") stage 50 cleared: real progress, stars and best untouched', async () => {
    await P.ev(() => { __pw.overShownAt = -1e9; });
    await P.tap('#oLevels'); await P.until(() => !document.getElementById('levels').hidden);
    await P.tap('#ulkBtn'); await P.until(() => !document.querySelector('.lv[data-n="50"]').disabled);
    await P.page.locator('.lv[data-n="50"]').scrollIntoViewIfNeeded();
    await P.tap('.lv[data-n="50"]');
    await P.until(() => __pw.state === 'play' && __pw.wave === 50);
    eq(await P.ev(() => __pw.practice), true, 'practice');
    await P.safe(); await P.ev(() => __pw.finish());
    await P.until(() => !document.getElementById('over').hidden);
    const r = await P.ev(() => ({ un: __pw.prog.unlocked, s: __pw.prog.stars[49] || 0, b: __pw.prog.best[49] || 0, last: __pw.prog.last, txt: document.getElementById('oBest').textContent }));
    eq([r.un, r.s, r.b, r.last], [2, 0, 0, 1]); ok(/練習/.test(r.txt), r.txt);
    await P.ev(() => { __pw.overShownAt = -1e9; });
    await P.tap('#oLevels'); await P.until(() => !document.getElementById('levels').hidden);
    await P.tap('#ulkBtn'); await sleep(150);
    eq(await P.ev(() => document.querySelectorAll('.lv:not(:disabled)').length), 2, 'only 2 stages after switching off');
  });
  await P.ctx.close();

  // ---- saves: damaged values are clamped, an old good save loads unchanged ----
  await t('damaged save loads, stage list opens, values clamped', async () => {
    const Q = await open({ init: `localStorage.setItem('pw-progress', JSON.stringify({stars:[9,-1,'x',2.7],best:[-5,'a',30,1e400],unlocked:1e9,last:-3}))` });
    const r = await Q.ev(() => { __pw.openLevels(); return { p: __pw.prog, n: document.querySelectorAll('.lv').length }; });
    eq(r.p, { unlocked: 100, stars: [3, 0, 0, 2], best: [0, 0, 30, 0], last: 1 }); eq(r.n, 100);
    await Q.ctx.close();
  });
  await t('old save (same keys) still loads; robes unlock from total stars and persist', async () => {
    const save = { unlocked: 12, stars: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2], best: [48, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150], last: 11 };
    const Q = await open({ init: `if(!sessionStorage.getItem('y')){sessionStorage.setItem('y',1);localStorage.setItem('pw-progress', ${JSON.stringify(JSON.stringify(save))});localStorage.removeItem('pw-robe')}` });
    eq(await Q.ev(() => ({ p: __pw.prog, w: __pw.wave, s: __pw.totalStars() })), { p: save, w: 11, s: 32 });
    await Q.tapAt({ x: 195, y: 380 });
    await Q.tap('#lvBtn'); await Q.until(() => !document.getElementById('levels').hidden);
    const st = await Q.ev(() => [...document.querySelectorAll('.robe')].map(b => b.disabled));
    eq(st, [false, false, true, true, true]);
    const box = await Q.page.locator('.robe[data-r="1"]').boundingBox(); ok(box.width >= 44 && box.height >= 44, 'robe button size');
    await Q.tap('.robe[data-r="1"]');
    eq(await Q.ev(() => __pw.robe), 1);
    await sleep(600); await Q.page.reload();  // (same: localStorage commit is asynchronous across a reload) await Q.until(() => window.__pw && __pw.wiz);
    eq(await Q.ev(() => __pw.robe), 1, 'robe kept after reload');
    await Q.ctx.close();
  });

  // ---- landscape stage list: two columns, cells >= 44, at least 3 rows visible ----
  for (const [w, h] of [[844, 390], [667, 375]]) await t(`${w}x${h} stage list: cells >= 44 px, >= 3 rows visible`, async () => {
    const Q = await open({ w, h });
    const r = await Q.ev(() => {
      __pw.openLevels();
      const g = document.getElementById('lvGrid'), c = g.querySelector('.lv').getBoundingClientRect(), x = document.getElementById('lvClose').getBoundingClientRect();
      return { cw: c.width, ch: c.height, gh: g.clientHeight, closeVis: x.top >= 0 && x.bottom <= innerHeight, sw: document.documentElement.scrollWidth };
    });
    ok(r.cw >= 44 && r.ch >= 44, `cell ${r.cw}x${r.ch}`); ok(r.gh >= 3 * 52, 'grid height ' + r.gh); ok(r.closeVis, 'close visible'); ok(r.sw <= w, 'no horizontal scroll');
    await Q.ctx.close();
  });

  await t('no page / console errors and no network requests in any of the above', () => {
    eq(errors, [], 'errors'); eq(requests, [], 'requests');
  });
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL harness', e); process.exit(1); });
