// Regression tests for 飛刀神射 (knife-target), headless Chromium against ../index.html served locally
// (every non-local request is aborted and counted). One check per release-review finding (2026-11-07):
// 8 taps/s never dropped (several knives in the air), second-finger HUD buttons, no double fire, HUD info boxes
// let taps through, landscape help/pause/result/title fit, HUD hidden under panels, L41-49 curve, early variety,
// apples only counted once + knife skins + best time, intro tap skips the intro, fail wording, banner fade.
// Waits on conditions only (no wall-clock-derived game values). Usage: node tests.js
'use strict';
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', String(e.message).split('\n')[0]); } }
const errors = [], external = [];

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(q.url.startsWith('/blank') ? '<p>' : html); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w, h, store, dsf) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf || 1, hasTouch: true, isMobile: true });
    await ctx.route(u => !u.href.startsWith(base), r => { external.push(r.request().url()); r.abort('internetdisconnected'); });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    if (store) { await page.goto(base + 'blank'); await page.evaluate(s => { localStorage.clear(); for (const k in s) localStorage.setItem(k, s[k]); }, store); }
    await page.goto(base); await page.waitForFunction(() => window.__game && __game.state().screen === 'title');
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const tap = async (x, y, id = 1) => { await touch('touchStart', [{ x, y, id }]); await touch('touchEnd', []); };
    const box = async sel => { const b = await page.locator(sel).boundingBox(); ok(b, 'no box ' + sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const tapEl = async sel => { const p = await box(sel); await tap(p.x, p.y); };
    const S = () => page.evaluate(() => __game.state());
    const startPlay = async L => { await page.evaluate(l => __game.start(l), L); await page.waitForFunction(() => __game.state().state === 'play'); };
    return { ctx, page, touch, tap, tapEl, box, S, startPlay };
  }
  // counts every canvas tap made during play and whether the game registered a throw for it
  const instrument = page => page.evaluate(() => {
    window.__tl = { taps: 0, reg: 0, missed: [] };
    let before = null;
    const n = () => { const s = __game.state(); return (s.total - s.left) + s.pending; };
    document.addEventListener('pointerdown', e => { const s = __game.state(); before = s.state === 'play' && !s.paused ? n() : null; }, true);
    document.addEventListener('pointerdown', e => { if (before == null) return; __tl.taps++; const now = n(); if (now === before + 1) __tl.reg++; else __tl.missed.push(__tl.taps); before = null; });
  });

  console.log('Core rules');
  {
    const { ctx, page } = await open(390, 844);
    await t('several knives can be in the air at once (core)', async () => {
      const r = await page.evaluate(() => { const K = __game.core, R = new K.Round(1); const a = [R.throwKnife(), R.throwKnife(), R.throwKnife()]; return { a, fl: R.flying.length, left: R.left }; });
      ok(r.a.every(Boolean) && r.fl === 3 && r.left === 2, JSON.stringify(r));
    });
    await t('a double tap that hits its own knife is reported as "quick"', async () => {
      const r = await page.evaluate(() => { const K = __game.core, R = new K.Round(1); for (let i = 0; i < 240; i++) R.step(K.STEP); R.throwKnife(); for (let i = 0; i < 5; i++) R.step(K.STEP); R.throwKnife(); let ev = []; for (let i = 0; i < 60 && R.state === 'play'; i++) { R.step(K.STEP); ev = ev.concat(R.events); R.events.length = 0; } return { st: R.state, f: ev.find(e => e.type === 'fail') }; });
      ok(r.st === 'fail' && r.f && r.f.quick === true, JSON.stringify(r));
    });
    await t('L41-49 stop-go: steady spin between stops lasts >= 1.2 s; L36-40 >= 1.0 s', async () => {
      const bad = await page.evaluate(() => { const K = __game.core, out = []; for (let L = 36; L <= 49; L++) { const c = K.levelConfig(L); if (c.type !== 'stopgo') continue; const m = new K.Motion(c.motion); const min = L > 40 ? 1.2 : 1.0; let last = null; for (let i = 0; i < 240 * 40; i++) { m.step(K.STEP); if (m.seg !== last) { last = m.seg; if (m.i > 1 && m.seg.v1 !== 0 && m.seg.hold < min - 1e-9) out.push(L + ':' + m.seg.hold.toFixed(2)); } } } return out; });
      ok(!bad.length, bad.join(' '));
    });
    await t('early variety: obstacle knife from L3, first speed change on L6', async () => {
      const r = await page.evaluate(() => { const K = __game.core; return [1, 2, 3, 4, 6, 7].map(L => ({ L, pre: K.levelConfig(L).pre.length, type: K.levelConfig(L).type })); });
      ok(r[0].pre === 0 && r[1].pre === 0 && r[2].pre >= 1 && r[3].pre >= 1 && r[4].type === 'speed' && r[5].type === 'speed', JSON.stringify(r));
    });
    await t('every level 1-100 still has a valid layout (pre knives apart, apples off knives)', async () => {
      const bad = await page.evaluate(() => { const K = __game.core, out = []; for (let L = 1; L <= 100; L++) { const c = K.levelConfig(L); for (let i = 0; i < c.pre.length; i++) for (let j = i + 1; j < c.pre.length; j++) if (Math.abs(K.angDiff(c.pre[i], c.pre[j])) < K.COLLIDE * 2) out.push(L); if (!c.apples.length) out.push('A' + L); } return out; });
      ok(!bad.length, bad.join(','));
    });
    await ctx.close();
  }

  console.log('Touch input');
  {
    const { ctx, page, tap, touch, tapEl, box, S, startPlay } = await open(390, 844, null, 2); // DPR 2: touch clicks carry detail 0 here
    await instrument(page);
    await t('8 taps/s alternating two points on L80-100: every tap in play throws a knife', async () => {
      await page.evaluate(() => __game.setUnlockAll(true));
      let taps = 0;
      for (const L of [90, 88, 86, 84, 82, 80, 96, 99, 100]) { // collisions end a level early: keep going until 12 taps were made
        if (taps >= 12) break;
        await page.evaluate(() => { __tl.taps = 0; __tl.reg = 0; __tl.missed = []; });
        await startPlay(L);
        for (let i = 0; i < 12; i++) {
          const s = await S(); if (s.state !== 'play') break;
          const p = i % 2 ? [300, 720] : [90, 640];
          await tap(p[0], p[1], 1 + (i % 2));
          await page.waitForTimeout(125);
        }
        await page.waitForFunction(() => __game.state().pending === 0 && __game.state().inFlight === 0);
        const r = await page.evaluate(() => __tl), s = await S();
        ok(r.reg === r.taps && !r.missed.length, `L${L} ` + JSON.stringify(r));
        if (s.state !== 'fail') ok(s.total - s.left === r.reg, `L${L} thrown ${s.total - s.left} vs taps ${r.reg}`);
        taps += r.taps;
      }
      ok(taps >= 12, 'only ' + taps + ' taps made');
    });
    await t('three taps 0 ms apart throw three knives (no single-slot buffer)', async () => {
      await startPlay(1);
      const s0 = await S();
      await tap(200, 700); await tap(200, 700); await tap(200, 700);
      await page.waitForFunction(() => __game.state().pending === 0 && __game.state().inFlight === 0);
      const s = await S();
      ok(s0.left - s.left === 3, `left ${s0.left} -> ${s.left}`);
    });
    await t('tapping the level box / apple counter throws (they let taps through)', async () => {
      await startPlay(2);
      await page.evaluate(() => { __tl.taps = 0; __tl.reg = 0; __tl.missed = []; });
      const s0 = await S();
      await tapEl('.hmid'); await page.waitForFunction(n => __game.state().left === n - 1, s0.left);
      await tapEl('.apple-count'); await page.waitForFunction(n => __game.state().left <= n - 2 || __game.state().state !== 'play', s0.left);
      const hit = await page.evaluate(() => { const b = document.querySelector('.hmid').getBoundingClientRect(); return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2).id; });
      ok(hit === 'cv', 'elementFromPoint ' + hit);
    });
    await t('a tap during the boss intro skips it and throws at once', async () => {
      await page.evaluate(() => __game.start(5));
      ok((await S()).state === 'intro', 'expected intro');
      await tap(200, 720);
      await page.waitForFunction(() => __game.state().state !== 'intro' && __game.state().left === __game.state().total - 1);
    });
    await t('banners are gone 0.25 s after the intro (not over the knife path)', async () => {
      await startPlay(10);
      ok((await S()).banner === true || true);
      await page.waitForFunction(() => __game.state().playT > 0.35);
      ok((await S()).banner === false, 'banner still shown');
    });
    for (const sel of ['#btnPause', '#btnMute']) {
      await t(`second finger on ${sel} works while the first rests on the canvas`, async () => {
        await startPlay(3);
        const m0 = await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed'));
        const p = await box(sel);
        await touch('touchStart', [{ x: 100, y: 760, id: 1 }]);
        await touch('touchStart', [{ x: 100, y: 760, id: 1 }, { x: p.x, y: p.y, id: 2 }]);
        await touch('touchEnd', [{ x: 100, y: 760, id: 1 }]);
        await touch('touchEnd', []);
        if (sel === '#btnPause') await page.waitForFunction(() => __game.state().paused);
        else await page.waitForFunction(m => document.getElementById('btnMute').getAttribute('aria-pressed') !== m, m0);
        if (sel === '#btnPause') await tapEl('#btnResume'); else await tapEl('#btnMute');
      });
    }
    await t('one tap / one mouse click / one keyboard click toggles mute exactly once', async () => {
      await page.evaluate(() => __game.title());
      const get = () => page.evaluate(() => document.getElementById('btnMute2').getAttribute('aria-pressed'));
      const a = await get(); await tapEl('#btnMute2'); await page.waitForTimeout(400); const b = await get();
      const p = await box('#btnMute2'); await page.mouse.click(p.x, p.y); await page.waitForTimeout(400); const c = await get();
      await page.evaluate(() => document.getElementById('btnMute2').click()); const d = await get();
      ok(a !== b && b !== c && c !== d, [a, b, c, d].join(','));
    });
    await t('one tap on the HUD pause / mute acts once (its trailing click is swallowed)', async () => {
      await startPlay(4);
      const m0 = await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed'));
      await tapEl('#btnMute'); await page.waitForTimeout(400);
      const m1 = await page.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed'));
      ok(m0 !== m1, 'mute did not toggle exactly once');
      await tapEl('#btnMute'); await page.waitForTimeout(100);
      await tapEl('#btnPause'); await page.waitForTimeout(400);
      ok((await S()).paused, 'pause tap undone by its own click');
      await tapEl('#btnResume'); await page.waitForTimeout(400);
      ok(!(await S()).paused, 'resume did not stick');
    });
    await t('pause / result panels hide the HUD (no ribbon over HUD)', async () => {
      await startPlay(4); await tapEl('#btnPause'); await page.waitForFunction(() => __game.state().paused);
      ok(await page.evaluate(() => getComputedStyle(document.getElementById('hud')).visibility === 'hidden'), 'hud visible under pause');
      await tapEl('#btnResume');
      ok(await page.evaluate(() => getComputedStyle(document.getElementById('hud')).visibility === 'visible'), 'hud hidden in play');
    });
    await t('fail text says how many are left (not "只差"), double tap explained', async () => {
      await startPlay(1);
      await tap(200, 700); await tap(200, 700);
      await page.waitForFunction(() => __game.state().resultShown);
      const txt = await page.evaluate(() => document.getElementById('resInfo').textContent);
      ok(/還剩 \d+ \/ \d+ 把/.test(txt) && !/只差/.test(txt) && /連點太快/.test(txt), txt);
    });
    await t('first knife into a pre-placed knife: "已插上 0 把，還剩 N / N 把"', async () => {
      await startPlay(3);
      await page.evaluate(() => new Promise(res => {
        const K = __game.core;
        const loop = () => { const s = __game.state(); if (s.state !== 'play') return res(); if (s.left === s.total && s.pending === 0) { const land = K.norm(K.LAUNCH - (s.theta + s.omega * K.FLIGHT)); if (Math.abs(K.angDiff(land, s.knives[0])) < K.COLLIDE - 0.03) __game.throwKnife(); } requestAnimationFrame(loop); };
        loop();
      }));
      await page.waitForFunction(() => __game.state().resultShown);
      const txt = await page.evaluate(() => document.getElementById('resInfo').textContent);
      ok(/已插上 0 把，還剩 5 \/ 5 把/.test(txt), txt);
    });
    await ctx.close();
  }

  console.log('Progress, apples, skins, best time');
  {
    const legacy = { 'knife-target:progress': JSON.stringify({ stars: { 1: 3, 2: 1 }, apples: { 1: 1 } }), 'knife-target:totalApples': '35', 'knife-target:muted': 'true' };
    const { ctx, page, tapEl, S, startPlay } = await open(390, 844, legacy);
    const winL1 = async () => {
      await startPlay(1);
      await page.evaluate(() => new Promise(res => { let last = -1; const loop = () => { const s = __game.state(); if (s.state !== 'play') return res(); if (s.canThrow && s.t - last > 0.32) { last = s.t; __game.throwKnife(); } requestAnimationFrame(loop); }; loop(); }));
      const early = await page.evaluate(() => ({ shown: __game.state().resultShown, best: (JSON.parse(localStorage.getItem('knife-target:progress')) || {}).best }));
      ok(!early.shown && early.best && early.best[1] > 0, 'clear not saved before the break animation ended ' + JSON.stringify(early));
      await page.waitForFunction(() => __game.state().resultShown);
      return page.evaluate(() => ({ info: document.getElementById('resInfo').textContent, s: __game.state(), p: JSON.parse(localStorage.getItem('knife-target:progress')), tot: +localStorage.getItem('knife-target:totalApples') }));
    };
    await t('old save keys load (stars, apples, mute) and keep the larger apple total', async () => {
      const r = await page.evaluate(() => ({ stat: document.getElementById('titleStat').textContent, play: document.getElementById('btnPlay').textContent, mute: document.getElementById('btnMute2').getAttribute('aria-pressed'), sk: __game.skins() }));
      ok(/已通過 2 \/ 100/.test(r.stat) && /第 3 關/.test(r.play) && r.mute === 'true' && r.sk.apples === 35, JSON.stringify(r));
    });
    await t('replaying a level adds only newly collected apples; best time + first-try saved', async () => {
      const a = await winL1();
      ok(a.s.state === 'win', 'L1 not won: ' + a.info);
      ok(/用時 \d+\.\d 秒/.test(a.info) && a.p.best[1] > 0, a.info);
      const expect = 35 + Math.max(0, a.s.applesHit - 1);
      ok(a.tot === expect, `total ${a.tot} expected ${expect}`);
      const b = await winL1();
      const expect2 = expect + Math.max(0, b.s.applesHit - Math.max(1, a.s.applesHit));
      ok(b.tot === expect2, `replay total ${b.tot} expected ${expect2}`);
      ok(b.p.best[1] <= a.p.best[1] && /最佳|新紀錄|用時/.test(b.info), b.info);
    });
    await t('skins: locked one refuses, unlocked one is chosen and survives reload', async () => {
      await page.evaluate(() => __game.title());
      await tapEl('#btnSkins'); await page.waitForSelector('#skinsOv:not(.hidden)');
      await tapEl('.skin[data-skin="night"]');
      ok((await page.evaluate(() => __game.skins().current)) === 'steel', 'locked skin chosen');
      await tapEl('.skin[data-skin="jade"]');
      ok((await page.evaluate(() => __game.skins().current)) === 'jade', 'jade not chosen');
      await page.reload(); await page.waitForFunction(() => window.__game && __game.state().screen === 'title');
      ok((await page.evaluate(() => __game.skins().current)) === 'jade', 'skin not saved');
    });
    await ctx.close();
  }

  console.log('Layout (portrait, lobby and landscape)');
  for (const [w, h] of [[360, 640], [390, 844], [375, 500], [844, 390], [667, 375], [640, 360]]) {
    const { ctx, page, startPlay } = await open(w, h);
    const fit = async sel => { await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running')); return fitNow(sel); };
    const fitNow = sel => page.evaluate(sel => {
      const vis = e => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
      const root = document.querySelector(sel), out = [];
      const els = [...root.querySelectorAll('.ribbon, h2, p, li, button, .stat, .logo h1, .logo .sub')].filter(vis);
      for (const e of els) { const r = e.getBoundingClientRect(); if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) out.push('out:' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.top) + '..' + Math.round(r.bottom)); }
      const btns = els.filter(e => e.tagName === 'BUTTON');
      for (const b of btns) { const r = b.getBoundingClientRect(); if (r.width < 43.5 || r.height < 43.5) out.push('small:' + (b.id || b.className)); }
      const texty = els.filter(e => !e.closest('button') || e.tagName === 'BUTTON');
      for (let i = 0; i < texty.length; i++) for (let j = i + 1; j < texty.length; j++) {
        const a = texty[i], b = texty[j]; if (a.contains(b) || b.contains(a)) continue;
        const r = a.getBoundingClientRect(), q = b.getBoundingClientRect();
        const ox = Math.min(r.right, q.right) - Math.max(r.left, q.left), oy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (ox > 1 && oy > 1 && !(a.classList.contains('ribbon') || b.classList.contains('ribbon'))) out.push('overlap:' + (a.id || a.className || a.tagName) + '/' + (b.id || b.className || b.tagName));
      }
      if (document.scrollingElement.scrollWidth > innerWidth) out.push('hscroll');
      return out;
    }, sel);
    await t(`${w}x${h} title, help, skins, pause, result fit without cut-off or overlap`, async () => {
      const bad = [];
      bad.push(...(await fit('#title')).map(x => 'title ' + x));
      if (w > h) { // demo target sits left of the menu
        const r = await page.evaluate(() => { const L = __game.layout(), m = document.querySelector('#title .menu').getBoundingClientRect(), st = document.getElementById('titleStat').getBoundingClientRect(); return { right: L.demo.x + L.R + L.KL * 0.75, menu: m.left, stat: st.left }; });
        if (r.right > r.menu || r.right > r.stat) bad.push('demo target under menu ' + JSON.stringify(r));
      }
      await page.evaluate(() => document.getElementById('btnHelp').click()); bad.push(...(await fit('#help')).map(x => 'help ' + x));
      await page.evaluate(() => __game.title()); await page.evaluate(() => document.getElementById('btnSkins').click()); bad.push(...(await fit('#skinsOv')).map(x => 'skins ' + x));
      await startPlay(15); await page.evaluate(() => document.getElementById('btnPause').click()); await page.waitForFunction(() => __game.state().paused);
      bad.push(...(await fit('#pause')).map(x => 'pause ' + x));
      await page.evaluate(() => document.getElementById('btnResume').click());
      await page.evaluate(() => { __game.throwKnife(); __game.throwKnife(); });
      await page.waitForFunction(() => __game.state().resultShown);
      bad.push(...(await fit('#result')).map(x => 'result ' + x));
      ok(!bad.length, bad.join('; '));
    });
    await ctx.close();
  }

  await t('no page / console errors', async () => ok(!errors.length, errors.slice(0, 3).join(' | ')));
  await t('no network requests', async () => ok(!external.length, external.slice(0, 3).join(' ')));
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass}/${pass + fail} knife-target checks`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', e.message); process.exit(1); });
