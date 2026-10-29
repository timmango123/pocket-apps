// Regression tests for 隕石風暴 (asteroid-storm): rule checks on the CORE block, then the real page in mobile Chromium
// with CDP touch for each release-review finding (2026-10-25). Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {waveConfig, CFG, lifeAfter, comboMult, firstWave, SHIPS};')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('Core rules');
  await t('extra lives at 10k, 30k, 60k, 100k, then every 50k', () => {
    eq([0, 9999, 10000, 29999, 30000, 60000, 100000, 149999, 150000].map(C.lifeAfter), [10000, 10000, 30000, 30000, 60000, 100000, 150000, 150000, 200000]);
  });
  await t('combo multiplier x1 / x1.5 / x2 / x3 at 10 / 20 / 30', () => eq([1, 9, 10, 19, 20, 29, 30, 80].map(C.comboMult), [1, 1, 1.5, 1.5, 2, 2, 3, 3]));
  await t('feature intro waves: ships 4, metal 8, explosive 13 (12 is a rest wave), storm 16', () => {
    ok(C.waveConfig(12).rest, 'wave 12 is a rest wave'); eq(C.waveConfig(12).expl, 0);
    eq([C.firstWave('enemies'), C.firstWave('metal'), C.firstWave('expl'), C.firstWave('storm')], [4, 8, 13, 16]);
    ok(/第 13 波爆裂隕石/.test(html) && !/第 12 波爆裂/.test(html), 'help text says wave 13');
  });
  await t('rock speed: faster ramp on waves 2-19, unchanged from wave 20, never decreasing', () => {
    for (let w = 2; w <= 60; w++) ok(C.waveConfig(w).speed >= C.waveConfig(w - 1).speed, 'speed drops at ' + w);
    ok(C.waveConfig(10).speed > 40 * Math.pow(1.04, 9) * 1.1, 'wave 10 boosted');
    for (const w of [20, 25, 30]) ok(Math.abs(C.waveConfig(w).speed - Math.min(180, 40 * Math.pow(1.04, w - 1))) < 1e-9, 'wave ' + w + ' base curve');
  });
  await t('power-up drop rate 15%, combo drop every 15; ship types differ in handling', () => {
    eq(C.CFG.dropRate, 0.15); eq(C.CFG.comboDrop, 15); eq(C.SHIPS.length, 3);
    eq(C.SHIPS[0].fire, 6); ok(C.SHIPS[1].fire > C.SHIPS[0].fire && C.SHIPS[1].max < C.SHIPS[0].max, 'disc: fire up, speed down');
    ok(C.SHIPS[2].max > C.SHIPS[0].max && C.SHIPS[2].fire < C.SHIPS[0].fire, 'delta: speed up, fire down');
  });
  await t('light help card uses theme colours, no hard-coded neon', () => ok(!/#4fe08a|#e8c33a|style="color:#5aa8ff"/.test(html)));

  console.log('Page (390x844 touch)');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'dark' });
    if (o.init) await ctx.addInitScript(o.init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP); await page.waitForFunction(() => window.G && G.state === 'title' && document.getElementById('bStart').getBoundingClientRect().height > 40, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ctr = async sel => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 30000, polling: 50 });   // game time runs slow under load: wait on state, not wall time
    const tap = async sel => { const c = await ctr(sel); await touch('touchStart', [{ ...c, id: 9 }]); await sleep(40); await touch('touchEnd', [{ ...c, id: 9 }]); await sleep(60); };
    const safe = () => page.evaluate(() => { G.ship.invul = 1e9; });   // stray rocks must not end the run between tests
    const start = async () => { await tap('#bStart'); await until(() => G.state === 'play' && G.w >= 1); await safe(); };
    return { ctx, page, touch, ctr, tap, start, until, safe, ev: (f, a) => page.evaluate(f, a) };
  }

  let P = await open();
  await P.start();
  await t('last-life crash: crossing a life threshold mid-crash respawns instead of ending', async () => {
    const s0 = await P.ev(() => { G.score = 9990; G.lives = 1; G.ship.invul = 0; G.ship.dead = false; hurt(); addScore(20); return { overT: G.overT, respawn: G.ship.respawn }; });
    eq(s0.overT, 0, 'game-over timer cancelled'); ok(s0.respawn > 0, 'respawn scheduled');
    await P.until(() => !G.ship.dead || G.state !== 'play');
    const s = await P.ev(() => ({ st: G.state, lives: G.lives, dead: G.ship.dead, next: G.nextLife }));
    eq(s.st, 'play'); eq(s.lives, 1); eq(s.dead, false, 'ship respawned'); eq(s.next, 30000);
    await P.safe();
  });
  await t('extra-life thresholds in play: 30k gives a life, 20k does not', async () => {
    const s = await P.ev(() => { G.lives = 2; addScore(20000 - G.score); const a = G.lives; addScore(10000); return [a, G.lives, G.nextLife]; });
    eq(s, [2, 3, 60000]);
  });
  await t('combo multiplier applies to score and resets when hit', async () => {
    const s = await P.ev(() => {
      const rk = spawnRock(2, 'n', 30, true, 10, 10); G.combo = 9; G.lastKill = G.time; const s0 = G.score;
      breakRock(rk); const d = G.score - s0, c = G.combo;
      G.ship.invul = 0; G.shield = false; hurt(); G.lives = 3; return [d, c, G.combo];
    });
    eq(s, [150, 10, 0]);
    await P.until(() => !G.ship.dead); await P.safe();
  });
  await t('combo label disappears once the 2 s window runs out', async () => {
    await P.ev(() => { G.combo = 0; for (let i = 0; i < 5; i++) killCombo(); });
    await P.until(() => /連擊/.test(document.getElementById('hCombo').textContent));
    await P.ev(() => { G.lastKill = G.time - CFG.comboGap - 0.1; });   // window ran out; no new kill
    await P.until(() => document.getElementById('hCombo').textContent === '' && G.combo === 0);
  });
  await t('HUD shows wave progress instead of repeating the wave number', async () => {
    await P.until(() => /^\d+%$/.test(document.getElementById('hDiff').textContent));
    ok(!/難度/.test(await P.ev(() => document.getElementById('hud').textContent)));
  });
  await t('explosive rocks are introduced on wave 13 (banner + at least one), metal always present on wave 8', async () => {
    const r = await P.ev(() => {
      const out = [];
      for (let k = 0; k < 12; k++) {
        G.rocks = []; G.w = 12; nextWave(); out.push([G.banner.sub, G.rocks.filter(r => r.kind === 'x').length]);
        G.rocks = []; G.w = 7; nextWave(); out.push([G.banner.sub, G.rocks.filter(r => r.kind === 'm').length]);
      }
      G.rocks = []; G.w = 0; nextWave(); return out;
    });
    for (const [sub, n] of r) { ok(/爆裂|金屬/.test(sub), sub); ok(n >= 1, 'none of the new rock kind: ' + sub); }
  });
  await t('toast sits below the boss bar and power-up bars', async () => {
    await P.ev(() => { G.spreadT = 1e6; G.shield = true; G.slowT = 1e6; document.getElementById('bossbar').classList.remove('hidden'); });
    await P.until(() => document.querySelectorAll('#pbars .pb').length === 3);
    await P.ev(() => toast('<b>+1 命</b>　測試'));
    const g = await P.ev(() => { const a = document.querySelector('.pbars').getBoundingClientRect(), b = document.querySelector('.toast'); return [a.bottom, parseFloat(getComputedStyle(b).top)]; });
    ok(g[1] >= g[0], 'toast top ' + g[1] + ' < bars bottom ' + g[0]);
    await P.ev(() => { G.spreadT = 0; G.shield = false; G.slowT = 0; document.getElementById('bossbar').classList.add('hidden'); });
  });
  await t('wrap-in hint for a rock coming up from under the thumbs', async () => {
    const n = await P.ev(() => { const rk = spawnRock(1, 'n', 0, true, WW / 2, WH - 10, 0, -60); const n = wrapHints().list.length; rk.dead = true; return n; });
    ok(n >= 1, 'no hint');
  });
  await t('background music plays while in a wave', async () => {
    ok(await P.ev(() => typeof musicTick === 'function'));
    const st = await P.ev(() => A.ctx && A.ctx.state);
    if (st === 'running') await P.until(() => MUS.step > 0); else console.log('        (audio context ' + st + ' in headless; checked musicTick exists)');
  });
  await t('pause with one thumb still on a stick (real two-finger touch)', async () => {
    await P.touch('touchStart', [{ x: 90, y: 680, id: 1 }]);
    await P.until(() => !!sticks.L);
    const c = await P.ctr('#bPause');
    await P.touch('touchStart', [{ x: 90, y: 680, id: 1 }, { ...c, id: 2 }]);
    await P.until(() => G.state === 'paused');
    await P.touch('touchEnd', [{ ...c, id: 2 }]); await sleep(60);
    eq(await P.ev(() => G.state), 'paused');
    await P.touch('touchEnd', [{ x: 90, y: 680, id: 1 }]); await sleep(60);
  });
  await t('leaving from the pause menu keeps best score, best wave and stats', async () => {
    const before = await P.ev(() => JSON.parse(localStorage.getItem('asteroids.stats') || '{"games":0}').games);
    await P.ev(() => { G.score = 0; addScore(760); G.w = 3; });
    await P.tap('#bMenu'); await P.until(() => G.state === 'title');
    const s = await P.ev(() => [document.getElementById('tBest').textContent, document.getElementById('tWave').textContent, +localStorage.getItem('asteroids.best'), JSON.parse(localStorage.getItem('asteroids.stats')).games]);
    eq(s.slice(0, 3), ['760', '第 3 波', 760]); eq(s[3], before + 1);
    await P.start(); await P.tap('#bPause'); await P.until(() => G.state === 'paused');
    await P.ev(() => { addScore(1000 - G.score); });
    await P.tap('#bRestart'); await P.until(() => G.state === 'play' && G.score === 0);
    eq(await P.ev(() => best), 1000); await P.safe();
  });
  await t('再玩一次 works while a thumb is still down after the crash', async () => {
    await P.touch('touchStart', [{ x: 90, y: 680, id: 1 }]);
    await P.until(() => !!sticks.L);
    await P.ev(() => { G.lives = 1; G.ship.invul = 0; G.shield = false; hurt(); G.overT = 0.01; });   // skip the crash animation
    await P.until(() => G.state === 'over' && !document.getElementById('over').classList.contains('hidden'));
    await P.ev(() => new Promise(r => setTimeout(r, 400)));   // let the card's pop-in animation settle so the box is final
    const c = await P.ctr('#bAgain');
    await P.touch('touchStart', [{ x: 90, y: 680, id: 1 }, { ...c, id: 2 }]); await sleep(40);
    await P.touch('touchEnd', [{ ...c, id: 2 }]);   // CDP touchEnd lists the point that lifts
    await P.until(() => G.state === 'play' && G.score === 0);
    await P.touch('touchEnd', [{ x: 90, y: 680, id: 1 }]);
    await P.safe();
  });
  await t('ship type changes handling (delta wing tops out faster)', async () => {
    // fixed-dt step on an injected, live ship; independent of real frame timing
    const v = await P.ev(() => {
      const o = skin, out = [];
      for (const k of [0, 2]) {
        skin = k; G.state = 'play'; G.ship.dead = false; G.ship.respawn = 0; G.overT = 0; G.ship.vx = 1000; G.ship.vy = 0;
        update(1 / 60); out.push(Math.hypot(G.ship.vx, G.ship.vy));
      }
      skin = o; return out;
    });
    ok(Math.abs(v[0] - 320) < 1, 'arrow top speed ' + v[0]); ok(v[1] > 330 && v[1] <= 370.01, 'delta top speed ' + v[1]);
  });
  await P.ctx.close();

  P = await open({ w: 360, h: 640, scheme: 'light' });
  await t('light help card: 散彈 / 護盾 / 時緩 readable (contrast >= 3)', async () => {
    await P.tap('#bHelp'); await P.until(() => !document.getElementById('help').classList.contains('hidden'));
    const r = await P.ev(() => {
      const lum = c => { const m = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(v => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
      const bg = lum('rgb(255,255,255)');
      return [...document.querySelectorAll('#help .hrow b')].filter(b => /散彈|護盾|時緩/.test(b.textContent)).map(b => { const l = lum(getComputedStyle(b).color); return [b.textContent, (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)]; });
    });
    eq(r.length, 3); for (const [n, c] of r) ok(c >= 3, n + ' contrast ' + c.toFixed(2));
  });
  await t('corner mute button hides while help / achievements are open, returns after', async () => {
    const muteHidden = () => P.ev(() => document.getElementById('bMuteT').classList.contains('hidden'));
    eq(await muteHidden(), true);
    await P.tap('[data-close=help]'); await P.until(() => document.getElementById('help').classList.contains('hidden')); eq(await muteHidden(), false);
    await P.tap('#bAch'); await P.until(() => !document.getElementById('achov').classList.contains('hidden')); eq(await muteHidden(), true);
    await P.tap('[data-close=achov]'); await P.until(() => document.getElementById('achov').classList.contains('hidden')); eq(await muteHidden(), false);
  });
  await P.ctx.close();

  for (const bad of ['{"games":2}', '[]', '"x"', '{"games":"a","kills":null}']) {
    const n0 = errors.length;
    P = await open({ init: `try{localStorage.setItem('asteroids.stats', ${JSON.stringify(bad)})}catch(e){}` });
    await t('damaged stats ' + bad + ' still open the achievements screen', async () => {
      await P.tap('#bAch'); await P.until(() => !document.getElementById('achov').classList.contains('hidden')); const txt = await P.ev(() => document.getElementById('lstats').textContent);
      ok(/遊玩局數/.test(txt) && /累計擊碎/.test(txt), txt); eq(errors.length, n0, errors.slice(n0).join(' | '));
    });
    await P.ctx.close();
  }
  await browser.close();
  await t('no page or console errors', () => eq(errors, []));
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
