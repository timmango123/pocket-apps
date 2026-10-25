// Browser check for 平台跳躍. Opens the page at 390x844 and the three lobby iframe sizes in light and dark, walks the
// main flows (title → level 1 → touch controls → win card → next level, level select, pause, settings, refresh
// persistence), replays a stored solution through real key presses with a lock-stepped clock, counts rapid touch taps,
// and writes demo/cover-390x520.png (gameplay) for the lobby. Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const FILE = path.resolve(__dirname, '..', 'index.html'), URL = 'file://' + FILE;
const SOL = JSON.parse(fs.readFileSync(path.join(__dirname, 'solutions.json'), 'utf8')).levels;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const decode = str => { const out = []; for (const p of str.split('.')) { if (!p) continue; const c = +p[0], k = parseInt(p.slice(1), 36); for (let i = 0; i < k; i++) out.push(c); } return out; };
// fake clock: the page advances only when we call __step(n)
const LOCK = `(() => { let q = [], t = 1000; window.requestAnimationFrame = cb => { q.push(cb); return q.length; }; window.cancelAnimationFrame = () => {};
  performance.now = () => t; window.__step = n => { for (let i = 0; i < n; i++) { t += 1000 / 60; const c = q; q = []; c.forEach(f => f(t)); } }; })();`;

async function page(browser, w, h, scheme, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
  if (opts.lock) await ctx.addInitScript(LOCK);
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('request', r => { if (!r.url().startsWith('file:') && !r.url().startsWith('data:')) errs.push('network request ' + r.url()); });
  await p.goto(URL);
  return { ctx, p, errs };
}
const vis = (p, id) => p.evaluate(id => !document.getElementById(id).hidden, id);
async function play(p, codes, upto) {
  // drive the stored inputs through real keyboard events, one frame per tick
  let h = 0, j = false;
  for (let i = 0; i < Math.min(codes.length, upto || 1e9); i++) {
    const c = codes[i], nh = (c >> 1) - 1, nj = !!(c & 1);
    if (nh !== h) { if (h) await p.keyboard.up(h < 0 ? 'ArrowLeft' : 'ArrowRight'); if (nh) await p.keyboard.down(nh < 0 ? 'ArrowLeft' : 'ArrowRight'); h = nh; }
    if (nj !== j) { if (nj) await p.keyboard.down('Space'); else await p.keyboard.up('Space'); j = nj; }
    await p.evaluate(() => window.__step(1));
  }
  if (h) await p.keyboard.up(h < 0 ? 'ArrowLeft' : 'ArrowRight'); if (j) await p.keyboard.up('Space');
}

(async () => {
  const browser = await chromium.launch();
  // ---- look & layout at every size and theme ----
  for (const [w, h] of [[390, 844], [375, 500], [390, 610], [430, 740], [360, 640], [844, 390]]) for (const scheme of ['light', 'dark']) {
    const { ctx, p, errs } = await page(browser, w, h, scheme);
    await p.waitForTimeout(500);
    ok(await vis(p, 'title'), `${w}x${h} ${scheme}: title screen shows`);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(over <= 0, `${w}x${h} ${scheme}: no horizontal scroll`);
    await p.click('#tPlay');
    await p.waitForTimeout(200);
    if (await vis(p, 'intro')) await p.click('#iOk');
    ok(await p.evaluate(() => window.__game.scene === 'play' && !document.getElementById('hud').hidden), `${w}x${h} ${scheme}: playing after 開始`);
    const r = await p.evaluate(() => { const k = window.__game.keyRects(); return [k.L, k.R, k.J].every(b => b.w >= 44 && b.h >= 44 && b.x >= 0 && b.y >= 0 && b.x + b.w <= innerWidth + 0.5 && b.y + b.h <= innerHeight + 0.5); });
    ok(r, `${w}x${h} ${scheme}: touch keys at least 44px and on screen`);
    // keys must not cover each other
    const sep = await p.evaluate(() => { const k = window.__game.keyRects(), o = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; return !o(k.L, k.R) && !o(k.L, k.J) && !o(k.R, k.J); });
    ok(sep, `${w}x${h} ${scheme}: keys do not overlap`);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(__dirname, `play-${w}x${h}-${scheme}.png`) });
    ok(!errs.length, `${w}x${h} ${scheme}: no errors ${errs.join(' | ')}`);
    await ctx.close();
  }

  // ---- full flow with a lock-stepped clock ----
  {
    const { ctx, p, errs } = await page(browser, 390, 844, 'light', { lock: true });
    await p.evaluate(() => window.__step(10));
    await p.click('#tPlay'); await p.evaluate(() => window.__step(2));
    if (await vis(p, 'intro')) { await p.click('#iOk'); await p.evaluate(() => window.__step(2)); }
    ok(await p.evaluate(() => window.__game.level === 1), 'new player starts at level 1');
    // touch: hold ▶ with one finger, tap jump with another
    const cdp = await ctx.newCDPSession(p), k = await p.evaluate(() => window.__game.keyRects());
    const R = { x: k.R.x + k.R.w / 2, y: k.R.y + k.R.h / 2, id: 1 }, J = { x: k.J.x + k.J.w / 2, y: k.J.y + k.J.h / 2, id: 2 };
    const x0 = (await p.evaluate(() => window.__game.run())).x;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [R] });
    await p.evaluate(() => window.__step(20));
    const s1 = await p.evaluate(() => window.__game.run());
    ok(s1.x > x0 + 1.5 && s1.vx > 6, 'holding ▶ runs right');
    ok(await p.evaluate(() => document.getElementById('kR').classList.contains('on')), '▶ key shows pressed');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [R, J] });
    await p.evaluate(() => window.__step(1));
    const s2 = await p.evaluate(() => window.__game.run());
    ok(!s2.ground && s2.vy < -10, 'jump key jumps on the very next frame');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [J] });
    await p.evaluate(() => window.__step(3));
    const s3 = await p.evaluate(() => window.__game.run());
    ok(s3.vx > 6, 'direction finger keeps running while the jump finger lifts');
    // slide the direction finger onto ◀
    const Lk = { x: k.L.x + k.L.w / 2, y: k.L.y + k.L.h / 2, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [Lk] });
    await p.evaluate(() => window.__step(15));
    ok((await p.evaluate(() => window.__game.run())).vx < 0, 'sliding the finger from ▶ to ◀ turns around');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [Lk] });
    await p.evaluate(() => window.__step(60));
    // rapid taps: 8 per second on the jump key, alternating with taps on ◀ ▶ — every press must reach the game once
    const before = await p.evaluate(() => window.__game.input());
    for (let i = 0; i < 24; i++) {
      const pt = i % 3 === 2 ? Lk : J;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pt, id: 10 + i }] });
      await p.evaluate(() => window.__step(2));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...pt, id: 10 + i }] });
      await p.evaluate(() => window.__step(6)); // 8 frames = 133 ms between taps (7.5 taps/s)
    }
    const after = await p.evaluate(() => window.__game.input());
    ok(after.presses - before.presses === 16, 'rapid taps: 16 jump presses registered exactly once each: ' + (after.presses - before.presses));
    ok(after.used === after.presses, 'rapid taps: every press reached the game');
    ok(after.h === 0 && !after.held, 'no stuck keys after rapid taps');
    // restart level 1 and play the stored solution with the keyboard
    await p.evaluate(() => window.__game.startLevel(1, { skipIntro: true }));
    await play(p, decode(SOL[1].inputs));
    await p.evaluate(() => window.__step(90));
    ok(await vis(p, 'win'), 'level 1 cleared → win card');
    const sv = await p.evaluate(() => window.__game.save());
    ok(sv.max === 1 && sv.lv[1] && sv.lv[1].t > 0, 'progress saved after the win');
    await p.click('#wNext'); await p.evaluate(() => window.__step(2));
    ok(await p.evaluate(() => window.__game.level === 2 && window.__game.scene === 'play'), '下一關 starts level 2');
    // pause, settings, level select
    await p.click('#bPause'); await p.evaluate(() => window.__step(1));
    ok(await vis(p, 'pause') && await p.evaluate(() => window.__game.paused), 'pause button pauses');
    const t0 = (await p.evaluate(() => window.__game.run())).ticks; await p.evaluate(() => window.__step(30));
    ok((await p.evaluate(() => window.__game.run())).ticks === t0, 'time stops while paused');
    await p.click('#pSet'); ok(await vis(p, 'settings'), 'settings open from pause');
    await p.click('#setSnd'); await p.click('#setOk');
    await p.click('#pSelect'); ok(await vis(p, 'select'), 'level select opens');
    const tiles = await p.evaluate(() => [...document.querySelectorAll('#grid .lt')].map(e => e.className));
    ok(tiles.length === 20 && tiles[0].includes('done') && !tiles[1].includes('lock') && tiles[2].includes('lock'), 'grid shows cleared, next and locked levels');
    ok(await p.evaluate(() => document.querySelectorAll('#tabs .tab').length === 5), 'five world tabs');
    await p.click('#grid .lt >> nth=0'); await p.evaluate(() => window.__step(2));
    ok(await p.evaluate(() => window.__game.level === 1 && window.__game.scene === 'play'), 'choosing a level starts it');
    // reach the flag in level 9 then refresh: the run resumes at the flag
    await p.evaluate(() => window.__game.startLevel(9, { skipIntro: true }));
    const codes9 = decode(SOL[9].inputs);
    let i = 0; for (; i < codes9.length; i += 30) { await play(p, codes9.slice(i, i + 30)); if ((await p.evaluate(() => window.__game.run())).cp >= 0) break; }
    const mid = await p.evaluate(() => window.__game.run());
    ok(mid.cp === 0, 'touched the flag in level 9');
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    ok(!errs.length, 'flow: no errors ' + errs.join(' | '));
    await ctx.close();
  }
  // ---- persistence across a real reload ----
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForTimeout(300);
    await p.evaluate(() => { localStorage.setItem('platform-jump:v1:save', JSON.stringify({ lv: { 1: { g: 3, t: 400, d: 0, c: 1 }, 2: { g: 1, t: 500, d: 2, c: 1 } }, max: 2, seen: {} })); localStorage.setItem('platform-jump:v1:run', JSON.stringify({ n: 3, cp: -1, gems: 1, deaths: 2, ticks: 600, t: 600 })); });
    await p.reload(); await p.waitForTimeout(400);
    ok(/繼續 第 3 關/.test(await p.textContent('#tPlayLab')), 'title offers to continue the saved run');
    ok(/星星 4 \/ 300/.test(await p.textContent('#tMeta')), 'title shows saved stars');
    await p.click('#tPlay'); await p.waitForTimeout(200);
    if (await vis(p, 'intro')) await p.click('#iOk');
    const r = await p.evaluate(() => window.__game.run());
    ok(r && r.deaths === 2 && r.gems === 1 && r.ticks >= 600 && r.ticks < 700, 'saved run restored (time, failures, stars) ' + JSON.stringify(r && [r.deaths, r.gems, r.ticks]));
    // corrupted storage must not break the page
    await p.evaluate(() => { localStorage.setItem('platform-jump:v1:save', '{oops'); localStorage.setItem('platform-jump:v1:set', 'null'); });
    await p.reload(); await p.waitForTimeout(300);
    ok(await vis(p, 'title') && !errs.length, 'corrupted save is ignored safely ' + errs.join(' | '));
    await ctx.close();
  }
  // ---- cover: gameplay in world 2 ----
  {
    const { ctx, p, errs } = await page(browser, 390, 520, 'light', { lock: true });
    await p.evaluate(() => window.__step(5));
    const N = 22, codes = decode(SOL[N].inputs);
    await p.evaluate(n => window.__game.startLevel(n, { skipIntro: true }), N);
    const at = +(process.env.COVER_AT || 280);
    await play(p, codes, at);
    await p.evaluate(() => window.__step(1));
    await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(__dirname, 'cover-390x520.png') });
    ok(fs.statSync(path.join(__dirname, 'cover-390x520.png')).size > 20000, 'cover written');
    ok(!errs.length, 'cover: no errors');
    await ctx.close();
  }
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
