// Regression tests for 推推殭屍 (push-zombie): one check per release-review toFix item (2026-11-08), in mobile Chromium
// with real CDP touch. Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message.split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  async function open(w = 390, h = 844, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP);
    await page.waitForFunction(() => window.__game && document.getElementById('btnSurvival').getBoundingClientRect().height > 40, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ev = (f, a) => page.evaluate(f, a);
    const st = () => ev(() => window.__game.state());
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 30000, polling: 30 });
    const ctr = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tapAt = async (c, hold = 50, id = 9) => { await touch('touchStart', [{ ...c, id }]); await sleep(hold); await touch('touchEnd', [{ ...c, id }]); await sleep(80); };
    const tap = async (sel, hold) => tapAt(await ctr(sel), hold);
    const fires = () => ev(() => window.__game.fires());
    const toPlay = async m => { await ev(x => { window.__game.start(x); window.__game.skipReady(); }, m); await until(() => window.__game.state().screen === 'play'); };
    const toOver = async () => { await toPlay('survival'); await ev(() => window.__game.warp(600)); await until(() => window.__game.state().screen === 'over', null, 40000); };
    return { ctx, page, touch, ev, st, until, ctr, tapAt, tap, fires, toPlay, toOver };
  }

  const P = await open();
  const hitId = sel => P.ev(s => { const r = document.querySelector(s).getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return (e.closest('button') || e).id; }, sel);

  console.log('Mute above the overlays');
  await t('mute is the top element on title / paused / over and toggles on title', async () => {
    ok(await hitId('#muteBtn') === 'muteBtn', 'title');
    const m0 = await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-pressed'));
    await P.tap('#muteBtn');
    const m1 = await P.ev(() => document.getElementById('muteBtn').getAttribute('aria-pressed'));
    ok(m0 !== m1, 'mute toggled on title'); await P.tap('#muteBtn');
    await P.toPlay('survival'); await P.tap('#pauseBtn'); await P.until(() => window.__game.state().screen === 'paused');
    ok(await hitId('#muteBtn') === 'muteBtn', 'paused');
    ok(await P.ev(() => getComputedStyle(document.getElementById('pauseBtn')).display === 'none'), 'pause button hidden while paused');
    await P.tap('#btnResume'); await P.until(() => window.__game.state().screen === 'play');
    ok(await P.ev(() => getComputedStyle(document.getElementById('pauseBtn')).display !== 'none'), 'pause button back after resume');
    await P.toOver(); ok(await hitId('#muteBtn') === 'muteBtn', 'over');
  });
  await t('result screen: frozen zombies cleared, reason line shown', async () => {
    const s = await P.st();
    ok(s.graves.every(g => !g.z) && s.particles === 0, 'graves empty after game over');
    const why = await P.ev(() => document.getElementById('overWhy').textContent);
    ok(/出局/.test(why) && /溜走 \d+/.test(why) && /敲到貓 \d+/.test(why), 'why: ' + why);
  });
  await t('result buttons ignore taps in the first 700 ms, then work', async () => {
    await P.ev(() => window.__game.start('survival')); await P.ev(() => window.__game.warp(600));
    await P.until(() => window.__game.state().screen === 'over', null, 40000);
    await P.tap('#btnRetry', 30);
    ok((await P.st()).screen === 'over', 'retry fired inside the guard');
    await sleep(750); await P.tap('#btnRetry');
    ok(['ready', 'play'].includes((await P.st()).screen), 'retry after the guard');
  });

  console.log('Touch rules');
  const scen = [
    ['#btnSurvival', async () => { await P.toPlay('survival'); await P.page.keyboard.press('p'); await P.ev(() => document.getElementById('btnMenu1').click()); }, s => ['ready', 'play'].includes(s.screen)],
    ['#pauseBtn', () => P.toPlay('survival'), s => s.screen === 'paused'],
    ['#btnResume', async () => { await P.toPlay('survival'); await P.ev(() => document.getElementById('pauseBtn').click()); }, s => s.screen === 'play'],
    ['#btnRestart', async () => { await P.toPlay('timed'); await sleep(300); await P.ev(() => document.getElementById('pauseBtn').click()); }, s => ['ready', 'play'].includes(s.screen) && s.time < 0.5],
    ['#btnMenu1', async () => { await P.toPlay('survival'); await P.ev(() => document.getElementById('pauseBtn').click()); }, s => s.screen === 'title'],
    ['#muteBtn', () => P.toPlay('survival'), null],
    ['#btnMenu2', async () => { await P.toOver(); await sleep(750); }, s => s.screen === 'title'],
  ];
  for (const [sel, setup, expect] of scen) {
    await t(sel + ': single, 0.6 s hold, 1 s hold, other finger down -> exactly one fire each', async () => {
      for (const [way, hold, other] of [['single', 50], ['hold600', 600], ['hold1000', 1000], ['otherFinger', 60, true]]) {
        await setup();
        const id = sel.slice(1), f0 = (await P.fires())[id] || 0;
        const c = await P.ctr(sel);
        if (other) { await P.touch('touchStart', [{ x: 30, y: 830, id: 1 }]); await sleep(100); }
        const others = other ? [{ x: 30, y: 830, id: 1 }] : [];
        await P.touch('touchStart', [...others, { ...c, id: 7 }]); await sleep(hold);
        await P.touch('touchEnd', [{ ...c, id: 7 }]); await sleep(150);
        if (other) { await P.touch('touchEnd', [{ x: 30, y: 830, id: 1 }]); await sleep(50); }
        const f1 = (await P.fires())[id] || 0, s = await P.st();
        ok(f1 - f0 === 1, `${way}: fired ${f1 - f0} times`);
        if (expect) ok(expect(s), `${way}: screen ${s.screen}`);
      }
    });
  }
  await t('pointer clicks are swallowed; keyboard activation still works', async () => {
    await P.toPlay('survival'); await P.page.keyboard.press('p'); await P.ev(() => document.getElementById('btnMenu1').click()); // detail 0 = keyboard-like
    ok((await P.st()).screen === 'title', 'keyboard-style click works');
    const f0 = (await P.fires()).muteBtn || 0;
    await P.ev(() => document.getElementById('muteBtn').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    ok(((await P.fires()).muteBtn || 0) === f0, 'detail>0 click ignored');
  });
  await t('a finger that lands while dying does not fire 再來一次 when the result appears', async () => {
    await P.toPlay('survival'); await P.ev(() => window.__game.warp(600));
    await P.until(() => window.__game.state().screen === 'dying', null, 40000);
    const c = await P.ctr('#btnRetry').catch(() => null) || { x: 195, y: 560 };
    await P.touch('touchStart', [{ ...c, id: 3 }]);
    await P.until(() => window.__game.state().screen === 'over'); await sleep(800);
    const r = await P.ctr('#btnRetry');
    await P.touch('touchEnd', [{ ...r, id: 3 }]); await sleep(150);
    ok((await P.st()).screen === 'over', 'retry fired by a carried-over finger');
  });
  await t('canvas touchstart only cancels when cancelable', () => ok(/touchstart',e=>\{\s*if\(e\.cancelable\)e\.preventDefault\(\)/.test(html)));

  console.log('Rules and content');
  await t('help text states the real combo rule', () => ok(html.includes('每連擊 8 下得分 <em>×1.5</em>，最高 <em>×3</em>（速推不加倍）') && !html.includes('連擊加倍')));
  await t('per-mode rule line under each mode button', () => {
    ok(/btnSurvival"><span>生存模式<small>[^<]*溜走或敲貓 -♥/.test(html), 'survival');
    ok(/btnTimed"><span>計時挑戰<small>[^<]*敲貓 -20/.test(html), 'timed');
    ok(/btnRush"><span>速推模式<small>[^<]*只敲全出來/.test(html), 'rush');
  });
  await t('survival: a cat hit in the first 60 s costs 20 points, not a heart; later it costs a heart', async () => {
    await P.toPlay('survival'); await P.until(() => window.__game.state().graves.every(g => g.ready)); await P.ev(() => { window.__game.clear(); window.__game.warp(20); });
    await P.ev(() => window.__game.put(4, 'cat')); await sleep(80);
    let g = (await P.st()).graves[4]; const h0 = (await P.st()).hearts;
    await P.tapAt(g.tap);
    let s = await P.st(); ok(s.hearts === h0 && s.catHits === 1, `early: hearts ${h0}->${s.hearts}`);
    await P.ev(() => { window.__game.clear(); window.__game.warp(61); });
    await P.until(() => { const s = window.__game.state(); return s.rows === 4 && s.graves.every(g => !g.z && g.ready); });
    await P.ev(() => window.__game.put(4, 'cat')); await sleep(80);
    g = (await P.st()).graves[4]; await P.tapAt(g.tap);
    s = await P.st(); ok(s.hearts === h0 - 1, `late: hearts ${h0}->${s.hearts} ` + JSON.stringify(s.graves.map(g => g.z && g.z.type)));
  });
  await t('survival: big zombies (3 hits) from 90 s, burrowers (change holes) from 150 s', async () => {
    await P.toPlay('survival');
    let c = await P.ev(() => { window.__game.warp(60); return window.__game.pick(2000); });
    ok(!c.big && !c.mole, 'none before 90 s: ' + JSON.stringify(c));
    c = await P.ev(() => { window.__game.warp(100); return window.__game.pick(2000); });
    ok(c.big > 100 && !c.mole, 'big after 90 s: ' + JSON.stringify(c));
    c = await P.ev(() => { window.__game.warp(160); return window.__game.pick(2000); });
    ok(c.big > 100 && c.mole > 100, 'mole after 150 s: ' + JSON.stringify(c));
    await P.ev(() => { window.__game.clear(); window.__game.warp(100); });
    await P.until(() => { const s = window.__game.state(); return s.rows === 4 && s.cols === 4 && s.graves.every(g => !g.z && g.ready); });
    await P.ev(() => window.__game.put(4, 'big'));
    for (let i = 0; i < 2; i++) { await P.until(() => window.__game.state().graves[4].z.p > 0.95); await P.tapAt((await P.st()).graves[4].tap); }
    let z = (await P.st()).graves[4].z; ok(z && z.hp === 1 && z.phase !== 'bonk', 'big survives two hits');
    await P.until(() => window.__game.state().graves[4].z.p > 0.95); await P.tapAt((await P.st()).graves[4].tap);
    ok((await P.st()).graves[4].z.phase === 'bonk', 'third hit bonks');
    await P.ev(() => { window.__game.clear(); }); await P.until(() => window.__game.state().graves.every(g => !g.z));
    await P.ev(() => window.__game.put(4, 'mole')); await P.tapAt((await P.st()).graves[4].tap);
    const gs = (await P.st()).graves; ok(!gs[4].z && gs.some(g => g.z && g.z.type === 'mole' && g.z.phase === 'cue'), 'mole moved to another hole');
  });
  await t('per-mode medals on the title, survival seconds saved', async () => {
    const Q = await open(390, 844, () => { localStorage.setItem('push-zombie:best:rush', '160'); localStorage.setItem('push-zombie:best:timed', '4100'); localStorage.setItem('push-zombie:bestSec:survival', '70'); });
    const m = await Q.ev(() => ['bestR', 'bestS', 'bestT'].map(id => { const i = document.querySelector('#' + id + ' .medal'); return i ? i.className : ''; }));
    ok(m[0].includes('m2') && m[1].includes('m1') && m[2].includes('m3'), JSON.stringify(m));
    ok(await Q.ev(() => document.getElementById('bestR').textContent === '最佳 160'), 'best text kept');
    await Q.toOver();
    ok(await Q.ev(() => +localStorage.getItem('push-zombie:bestSec:survival') >= 70), 'bestSec kept');
    await Q.ctx.close();
  });

  console.log('Layout');
  await t('landscape 844x390: HUD in side columns, 4x4 graveyard cells >= 70 px', async () => {
    const L = await open(844, 390);
    await L.toPlay('survival'); await L.ev(() => { window.__game.clear(); window.__game.warp(70); });
    await L.until(() => window.__game.state().cols === 4 && window.__game.state().rows === 4);
    const s = await L.st();
    ok(s.sideHUD && s.cellW >= 70 && s.boardRight - s.boardLeft >= 300, JSON.stringify({ side: s.sideHUD, cellW: s.cellW, bw: s.boardRight - s.boardLeft }));
    await L.ctx.close();
  });
  const L2 = await open(375, 500);
  for (const [w, h] of [[375, 500], [844, 390], [360, 640], [390, 610]]) {
    await t(`title card fits without scrolling at ${w}x${h}, clear of the mute button`, async () => {
      await L2.page.setViewportSize({ width: w, height: h }); await sleep(250);
      const r = await L2.ev(() => { const o = document.getElementById('title'), c = o.querySelector('.card').getBoundingClientRect(), m = document.getElementById('muteBtn').getBoundingClientRect();
        return { scroll: o.scrollHeight > o.clientHeight + 1, clear: c.top >= m.bottom || c.right <= m.left }; });
      ok(!r.scroll && r.clear, JSON.stringify(r));
    });
  }
  await L2.ctx.close();
  await t('no page or console errors', () => ok(!errors.length, errors.slice(0, 3).join(' | ')));

  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  if (fail) { console.log('FAIL'); process.exit(1); }
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
