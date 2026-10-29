// Regression tests for 山頭砲戰 (cannon-duel): the page in Chromium with real CDP touch.
// Each block maps to a 9.5 release re-review finding (2026-10-29).
// Usage: node tests.js   (about 40-70 s; waits on conditions, no timing-based assertions)
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {genWorld, simulate, params, NC};')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEEN = { first: 1, wall: 1, rocks: 1, steel: 1, clouds: 1, height: 1, gust: 1 };

// a level-1 direct hit at wind 0, found with the game's own physics
function directHit(n) {
  const W = C.genWorld(n);
  for (let a = 30; a <= 80; a++) for (let p = 40; p <= 100; p++) { const r = C.simulate(W, 0, a, p, 'std', 0, null, 2); if (r.ev === 'tower' && r.hit === 1) return { a, p }; }
  return null;
}
function mkBattle(n, extra) {
  const W = C.genWorld(n);
  return Object.assign({ v: 1, level: n, daily: null, top: Array.from(W.top), scorch: '0'.repeat(C.NC), rocks: W.rocks ? W.rocks.cells.map(() => 1) : null,
    towers: W.towers.map(t => ({ y: t.y, hp: t.max })), ammo: { ...W.P.ammo }, aiAmmo: { ...W.P.ammo }, weapon: 'std', aim: { a: 45, p: 60 }, aiA: 45, aiMem: 1,
    turn: 2, wind: 0, gt: 1, game: { shots: 1, hits: 0, directs: 0, lastDmgFall: false }, ghosts: [[], []], fired: null }, extra || {});
}

(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  async function open(w, h, prep, scheme) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme || 'light' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto('file://' + APP);
    await page.evaluate(p => { localStorage.clear(); localStorage.setItem('cannon.mute', 'true'); localStorage.setItem('cannon.intro', JSON.stringify(p.seen));
      for (const k in p.prep) localStorage.setItem('cannon.' + k, typeof p.prep[k] === 'string' ? p.prep[k] : JSON.stringify(p.prep[k])); }, { prep: prep || {}, seen: SEEN });
    await page.reload();
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  }
  const waitFor = async (page, fn, arg, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + fn.toString().slice(0, 90)); await sleep(30); } };
  const st = page => page.evaluate(() => window.__game.state());
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden') && e.getBoundingClientRect().width > 0; }, sel);
  const pts = arr => arr.map((p, i) => ({ x: p.x, y: p.y, id: p.id != null ? p.id : i + 1 }));
  const touch = (cdp, type, list) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts(list) });
  async function tap(cdp, page, sel) {
    await waitFor(page, s => { const e = document.querySelector(s); return e && !e.classList.contains('hidden') && !e.closest('.hidden') && !e.disabled; }, sel);
    const b = await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
    await touch(cdp, 'touchStart', [b]); await sleep(40); await touch(cdp, 'touchEnd', []); await sleep(60);
  }
  async function playLevel(page, cdp, n) {
    await tap(cdp, page, '#tSelect');
    if (await page.getAttribute('#unlockSw', 'aria-checked') !== 'true') await tap(cdp, page, '#unlockSw');
    await page.evaluate(n => document.querySelector('.lt[data-n="' + n + '"]').scrollIntoView({ block: 'center' }), n);
    await tap(cdp, page, '.lt[data-n="' + n + '"]');
    await waitFor(page, () => window.__game.state().phase === 'aim');
  }
  const midField = page => page.evaluate(() => { const s = window.__game.safe(); return { x: s.x + s.w * 0.5, y: s.y + s.h * 0.45 }; });
  // every control in the bottom panel and HUD is fully on screen, not covered, and at least `min` px in both directions
  const controlsFit = (page, min) => page.evaluate(min => {
    const bad = [];
    document.querySelectorAll('#panel button, #hud button, #hud .hp').forEach(e => {
      const r = e.getBoundingClientRect(), name = e.id || e.dataset.k || e.className;
      if (r.left < -0.5 || r.right > innerWidth + 0.5 || r.top < -0.5 || r.bottom > innerHeight + 0.5) bad.push(name + ' off-screen ' + Math.round(r.left) + '..' + Math.round(r.right));
      else if (r.width < (e.classList.contains('hp') ? 70 : min) || r.height < 40) bad.push(name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      else { const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (top && !e.contains(top)) bad.push(name + ' covered by ' + (top.id || top.className)); }
    });
    return bad;
  }, min);

  await t('controls are never cut off: 320 portrait and 568/667 landscape (were clipped at both edges)', async () => {
    for (const [w, h, min] of [[320, 568, 44], [390, 844, 44], [375, 500, 44], [667, 375, 44], [568, 320, 40], [844, 390, 44]]) {
      const { ctx, page, cdp } = await open(w, h);
      await playLevel(page, cdp, 85); // all five weapons
      eq(await controlsFit(page, min), [], w + 'x' + h);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll at ' + w);
      await ctx.close();
    }
  });

  await t('rotation re-lays out the field: safe area, aim tip and controls follow the new size', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 1);
    ok(await visible(page, '#aimtip'), 'aim tip on level 1');
    await page.setViewportSize({ width: 844, height: 390 }); await sleep(400);
    const g = await page.evaluate(() => ({ s: window.__game.safe(), hud: document.getElementById('hud').getBoundingClientRect().bottom, pan: document.getElementById('panel').getBoundingClientRect().top, tip: parseFloat(document.getElementById('aimtip').style.top) }));
    ok(Math.abs(g.s.y - (g.hud + 4)) < 1 && Math.abs(g.s.y + g.s.h - (g.pan - 2)) < 1, 'safe area matches the landscape HUD/panel ' + JSON.stringify(g));
    ok(Math.abs(g.tip - (g.s.y + 8)) < 1, 'aim tip moved under the landscape HUD');
    eq(await controlsFit(page, 44), [], 'landscape');
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
    eq(await controlsFit(page, 44), [], 'back to portrait');
    await ctx.close();
  });

  await t('a press held through the computer\'s turn starts aiming when your turn begins (was dropped)', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 1);
    await tap(cdp, page, '#bFire');
    await waitFor(page, () => window.__game.state().phase === 'ai', null, 20000);
    const m = await midField(page);
    await touch(cdp, 'touchStart', [m]);
    const won = await waitFor(page, () => { const s = window.__game.state(); return s.phase === 'aim' || s.won || s.lost ? s.phase : null; }, null, 25000);
    if (won !== 'aim') { await touch(cdp, 'touchEnd', []); await ctx.close(); return; } // computer won on its shot: nothing to aim
    const before = (await st(page)).aim;
    await touch(cdp, 'touchMove', [{ x: m.x - 80, y: m.y + 80 }]); await sleep(50);
    await touch(cdp, 'touchMove', [{ x: m.x - 100, y: m.y + 100 }]); await sleep(50);
    const after = (await st(page)).aim;
    await touch(cdp, 'touchEnd', []);
    eq(after, { a: 45, p: 71 }, 'aim from the held press (before ' + JSON.stringify(before) + ')');
    await ctx.close();
  });

  await t('only the first finger aims: a second finger on the field cannot take the aim over', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 2);
    const m = await midField(page), f1 = { x: m.x, y: m.y, id: 1 };
    await touch(cdp, 'touchStart', [f1]);
    await touch(cdp, 'touchMove', [{ x: m.x - 60, y: m.y + 104, id: 1 }]); await sleep(40);
    const a1 = (await st(page)).aim;
    eq(a1, { a: 60, p: 60 }, 'first finger');
    const f2 = { x: m.x + 100, y: m.y - 150, id: 2 };
    await touch(cdp, 'touchStart', [{ x: m.x - 60, y: m.y + 104, id: 1 }, f2]);
    await touch(cdp, 'touchMove', [{ x: m.x - 60, y: m.y + 104, id: 1 }, { x: f2.x - 150, y: f2.y + 10, id: 2 }]); await sleep(40);
    eq((await st(page)).aim, a1, 'second finger ignored');
    await touch(cdp, 'touchMove', [{ x: m.x - 100, y: m.y + 100, id: 1 }, { x: f2.x - 150, y: f2.y + 10, id: 2 }]); await sleep(40);
    eq((await st(page)).aim, { a: 45, p: 71 }, 'first finger still aims while the second is down');
    await touch(cdp, 'touchEnd', []);
    // a later press works normally
    await touch(cdp, 'touchStart', [m]); await touch(cdp, 'touchMove', [{ x: m.x - 50, y: m.y }]); await sleep(40); await touch(cdp, 'touchEnd', []);
    eq((await st(page)).aim, { a: 0, p: 25 }, 'next press');
    await ctx.close();
  });

  await t('battle resumes after a reload: terrain, HP, ammo, wind and turn kept, not counted as a new game', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 30);
    await tap(cdp, page, '#wbar .wb[data-k="heavy"]');
    await tap(cdp, page, '#bFire');
    await waitFor(page, () => { const s = window.__game.state(); return (s.phase === 'aim' && s.turns === 2) || s.won || s.lost; }, null, 30000);
    const s0 = await st(page);
    if (s0.won || s0.lost) { await ctx.close(); return; }
    const top0 = await page.evaluate(() => Array.from(window.__game.world().top).join(','));
    const games = await page.evaluate(() => JSON.parse(localStorage.getItem('cannon.stats')).games);
    await page.reload();
    ok(await visible(page, '#tResume'), 'title offers to continue');
    ok((await page.textContent('#tResumeInfo')).includes('第 30 關・你 ' + s0.hp[0] + '／電腦 ' + s0.hp[1]), 'resume info');
    await tap(cdp, page, '#tResume');
    await waitFor(page, () => window.__game.state().phase === 'aim');
    const s1 = await st(page);
    eq([s1.level, s1.hp, s1.ammo, s1.wind, s1.turns], [30, s0.hp, s0.ammo, s0.wind, 2]);
    eq(await page.evaluate(() => Array.from(window.__game.world().top).join(',')), top0, 'terrain');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('cannon.stats')).games), games, 'games count');
    // going to the menu keeps it; starting another level replaces it
    await tap(cdp, page, '#bPause'); await tap(cdp, page, '#pSelect');
    ok(await visible(page, '#tResume'), 'kept after 回到選單');
    await playLevel(page, cdp, 3);
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('cannon.battle')).level), 3, 'new battle saved');
    await ctx.close();
  });

  await t('a reload during your shot replays that shot instead of taking it back', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 18);
    await tap(cdp, page, '#aUp'); await tap(cdp, page, '#aUp'); await tap(cdp, page, '#pDn');
    await tap(cdp, page, '#wbar .wb[data-k="triple"]');
    await tap(cdp, page, '#bFire');
    await waitFor(page, () => window.__game.state().phase === 'fly');
    const shot = (await st(page)).lastShot;
    await page.reload();
    await tap(cdp, page, '#tResume');
    await waitFor(page, () => window.__game.state().phase === 'fly');
    const s = await st(page);
    eq([s.lastShot.a, s.lastShot.p, s.lastShot.kind, s.ammo.triple], [47, 59, 'triple', 0], 'same shot, ammo spent once');
    ok(Math.abs(s.lastShot.t0 - shot.t0) < 1e-9, 'same launch time (clouds/gusts line up)');
    await ctx.close();
  });

  await t('the replayed shot finishes the battle: win shown, save cleared, progress kept', async () => {
    const hit = directHit(1); ok(hit, 'level 1 has a direct hit');
    const b = mkBattle(1, { fired: { a: hit.a, p: hit.p, kind: 'std', t0: 2, ws: null } }); b.towers[1].hp = 1;
    const { ctx, page, cdp } = await open(390, 844, { battle: b });
    await tap(cdp, page, '#tResume');
    await waitFor(page, () => window.__game.state().won, null, 20000);
    eq(await page.evaluate(() => [localStorage.getItem('cannon.battle'), JSON.parse(localStorage.getItem('cannon.progress'))]), [null, { 1: 1 }]);
    await tap(cdp, page, '#wSelect'); await tap(cdp, page, '#sBack');
    ok(!(await visible(page, '#tResume')), 'no resume after the battle ended');
    await ctx.close();
  });

  await t('damaged saved data never breaks the app (stats, stars, progress, battle)', async () => {
    const bad = mkBattle(5); bad.top[7] = 'x';
    const { ctx, page, cdp } = await open(390, 844, { stats: { shots: 'x', hits: 5, games: -2, wins: 3 }, stars: { 1: '3', 2: 9, 3: 2, x: 1 }, progress: '[1,2]', battle: bad, ach: '[]' });
    ok(await visible(page, '#title'), 'title shown');
    ok(!(await visible(page, '#tResume')), 'bad battle not offered');
    eq(await page.evaluate(() => localStorage.getItem('cannon.battle')), null, 'bad battle removed');
    await tap(cdp, page, '#tStats');
    const txt = await page.textContent('#statG');
    ok(!/NaN|undefined|null/.test(txt), 'stats render: ' + txt);
    ok(/星星2/.test(txt.replace(/\s/g, '')), 'only the valid star entry counts: ' + txt);
    await tap(cdp, page, '#stOk'); await tap(cdp, page, '#tSelect');
    ok(/星星 2 \/ 300/.test(await page.textContent('#selSum')), 'select summary');
    await tap(cdp, page, '#sBack');
    for (const v of ['{"v":1}', '"x"', '[]', JSON.stringify(mkBattle(5, { fired: { a: 40, p: 50, kind: 'drill', t0: 3, ws: null } }))]) {
      await page.evaluate(v => localStorage.setItem('cannon.battle', v), v); await page.reload();
      ok(await visible(page, '#title') && !(await visible(page, '#tResume')), 'rejected ' + v.slice(0, 40));
    }
    await ctx.close();
  });

  await t('a daily battle from another day is not resumed; today\'s is', async () => {
    const d = new Date(), seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const r = (a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; })(seed);
    const dn = 30 + Math.floor(r() * 45), scene = Math.floor(r() * 10), W = C.genWorld(dn, seed, scene);
    const mk = sd => ({ ...mkBattle(1), level: 0, daily: { n: dn, seed: sd, scene }, top: Array.from(W.top), rocks: W.rocks ? W.rocks.cells.map(() => 1) : null, towers: W.towers.map(t => ({ y: t.y, hp: t.max })), ammo: { ...W.P.ammo }, aiAmmo: { ...W.P.ammo } });
    const { ctx, page, cdp } = await open(390, 844, { battle: mk(seed - 1) });
    ok(!(await visible(page, '#tResume')), 'yesterday dropped');
    await page.evaluate(v => localStorage.setItem('cannon.battle', v), JSON.stringify(mk(seed))); await page.reload();
    ok((await page.textContent('#tResumeInfo')).startsWith('每日戰場'), 'today offered');
    await tap(cdp, page, '#tResume'); await waitFor(page, () => window.__game.state().phase === 'aim');
    eq((await st(page)).level, 0);
    await ctx.close();
  });

  await t('leaving the app pauses the battle and keeps the checkpoint', async () => {
    const { ctx, page, cdp } = await open(390, 844);
    await playLevel(page, cdp, 4);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    ok(await visible(page, '#pause'), 'paused');
    ok(/第 4 關・/.test(await page.textContent('#pInfo')), 'pause info names the scene');
    eq(await page.evaluate(() => JSON.parse(localStorage.getItem('cannon.battle')).level), 4);
    await ctx.close();
  });

  await t('no page or console errors', () => { eq(errors, []); });
  await browser.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
