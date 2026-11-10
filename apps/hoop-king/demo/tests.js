// Regression tests for 投籃王 (hoop-king). Usage: node tests.js [--core]
// 1) Core (Node, the game's own CORE-START..CORE-END): fire-ball scoring, difficulty steps kept apart, per-attempt variants,
//    a noiseless planShot bot clears the hardest levels.
// 2) Browser (Chromium, real CDP touch): second finger, swipe during "ready", miss reasons, level grid rows, panel vs HUD,
//    landscape scale and cards, 320-wide HUD, settings button height, title subtitle chip, mid-game stats, practice
//    achievements, idle redraw rate, no console errors.
// Waits on page conditions (window.__game.state()) instead of fixed sleeps where timing matters.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const HK = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn HK;')();
const K = HK.K;
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const T0 = Date.now();

// ---------- core: fire ball scoring matches what the player sees ----------
{
  const c = HK.levelCfg(1), g = new HK.Game(c, { noEarly: true }), pts = [];
  for (let n = 0; n < 5; n++) {
    while (!g.canShoot()) g.step();
    const a = HK.planShot(c, g.t, HK.windAt(c, g.t), 0); g.shoot(a.p, a.xT);
    const b = g.balls[g.balls.length - 1];
    while (b.res === 0) g.step();
    const e = g.ev.filter(x => x.type === 'score' && x.b === b)[0]; g.ev.length = 0;
    pts.push({ fire: b.fire, pts: e ? e.pts : null, efire: e && e.fire, swish: e && e.swish });
  }
  ok(pts.every(x => x.pts !== null), 'five planned shots all score on L1 ' + JSON.stringify(pts));
  ok(pts.every(x => x.efire === x.fire), 'the +1 fire bonus goes exactly to balls that left the hand on fire');
  ok(!pts[2].fire && pts[2].pts === (pts[2].swish ? 3 : 2), 'the 3rd make in a row is not a fire ball and gets no bonus (' + pts[2].pts + ')');
  ok(pts[3].fire && pts[3].pts === (pts[3].swish ? 4 : 3), 'the 4th ball is a fire ball and gets +1 (' + pts[3].pts + ')');
}
// ---------- core: difficulty steps are kept apart (no L61 / L81 wall) ----------
{
  const cf = L => HK.levelCfg(L);
  ok(cf(61).dist === cf(60).dist && cf(81).dist === cf(80).dist, 'the shooting distance does not step back at L61 or L81');
  let maxRim = 0; for (let L = 2; L <= 100; L++) maxRim = Math.max(maxRim, cf(L - 1).rimScale - cf(L).rimScale);
  ok(maxRim <= 0.0101 && Math.abs(cf(70).rimScale - 0.9) < 1e-9, 'the rim shrinks 1% a level from L61 to 90% at L70 (biggest step ' + maxRim.toFixed(3) + ')');
  ok(cf(81).G < cf(80).G && cf(76).G <= cf(75).G, 'the target score drops when 25 s (L81) and the panel (L76) arrive: ' + cf(75).G + '/' + cf(76).G + ', ' + cf(80).G + '/' + cf(81).G);
  let maxD = 0, at = 0; for (let L = 51; L <= 100; L++) { const d = cf(L).diff - cf(L - 1).diff; if (d > maxD) { maxD = d; at = L; } }
  ok(maxD <= 3, 'from L50 on the difficulty index never jumps more than 3 between neighbours (was 5 at L61 and L81; max ' + maxD + ' at L' + at + ')');
  let feat = 0; for (let L = 32; L <= 100; L++) { const a = cf(L - 1), b = cf(L); const n = (b.dist !== a.dist) + (b.S !== a.S) + (b.obstacle !== a.obstacle) + (b.rimScale === 0.99); if (n > 1) feat++; }
  ok(feat === 0, 'no level adds two of: step back, 25 s, panel, three-point line at once (' + feat + ')');
  ok(cf(1).G === 10 && cf(100).G <= 55 && cf(1).seed === 2027, 'L1 keeps target 10 and seed 2027 (variant 0)');
}
// ---------- core: per-attempt variants change timing only ----------
{
  const a = HK.levelCfg(50), b = HK.levelCfg(50, false, 17);
  ok(a.phase !== b.phase && a.windDirs.join() !== b.windDirs.join(), 'a variant changes the hoop phase and wind order');
  ok(a.G === b.G && a.A === b.A && a.W === b.W && a.D === b.D && a.diff === b.diff, 'a variant keeps target, swing, wind strength, distance and difficulty');
}
// ---------- core: superhuman planShot bot clears the hardest levels with several variants ----------
{
  let cleared = 0, tot = 0;
  for (const L of [61, 76, 81, 100]) for (const v of [0, 3, 11]) {
    const c = HK.levelCfg(L, false, v), g = new HK.Game(c); tot++;
    while (!g.over) { if (g.canShoot()) { const p = HK.planShot(c, g.t, HK.windAt(c, g.t), 0); if (p) g.shoot(p.p, p.xT); } g.step(); g.ev.length = 0; }
    if (g.result === 'win') cleared++;
  }
  ok(cleared === tot, 'noiseless bot clears L61/76/81/100 in 3 variants each (' + cleared + '/' + tot + ')');
}
if (process.argv.includes('--core')) { console.log((fail ? 'FAIL ' : 'OK ') + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0); }

// ---------- browser ----------
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const URL = 'file://' + APP;
const SEEN = JSON.stringify({ 11: 1, 26: 1, 31: 1, 41: 1, 61: 1, 76: 1, 81: 1, 91: 1 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(browser, w, h, init) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([seen, extra]) => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', '1'); localStorage.setItem('hoop.unlockAll', 'true'); localStorage.setItem('hoop.seen', seen); if (extra) for (const k in extra) localStorage.setItem(k, extra[k]); } }, [SEEN, init || null]);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(URL); await page.waitForFunction(() => window.__game);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errors, cdp };
}
const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const st = page => page.evaluate(() => window.__game.state());
async function startLevel(page, n) {
  await click(page, '#tSelect'); await click(page, '.lt[data-n="' + n + '"]');
  await page.waitForFunction(() => { const s = window.__game.state(); return s.ui === 'play' && s.startDelay === 0; }, null, { timeout: 15000 });
}
// Every CDP touch event carries an explicit timestamp (mixing stamped and unstamped events confuses Chromium's clock).
const ts = () => Date.now() / 1000;
const touch = (cdp, type, touchPoints, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: at || ts() });
// One upward swipe by finger `id` with explicit timestamps; `others` are fingers resting on the glass.
async function swipe(cdp, sw, id, others, opts) {
  opts = opts || {}; const t0 = Date.now() / 1000, rest = others || [], n = opts.n || 10;
  const pt = (k) => ({ x: sw.x0 + sw.dx * k / n, y: sw.y0 + sw.dy * k / n, id });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [...rest, pt(0)], timestamp: t0 });
  for (let k = 1; k <= n; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [...rest, pt(k)], timestamp: t0 + 0.012 * k });
  if (opts.holdOpen) return t0;
  // CDP touchEnd lists the fingers that lift; the others stay down
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [pt(n)], timestamp: t0 + 0.012 * n + 0.004 });
}
async function waitShots(page, n, ms) { return page.waitForFunction(n => window.__game.state().shots >= n, n, { timeout: ms || 8000 }).then(() => true, () => false); }
async function waitCanShoot(page) { await page.waitForFunction(() => { const s = window.__game.state(); return s.canShoot && s.inAir === 0; }, null, { timeout: 10000 }); }

(async () => {
  const browser = await chromium.launch();
  const allErrors = [];
  try {
    // ---- multi-touch: a resting finger and overlapping thumbs ----
    {
      const { ctx, page, errors, cdp } = await open(browser, 390, 844);
      await startLevel(page, 1);
      const sw = await page.evaluate(() => window.__game.swipeFor(0.5, 0, 0.12));
      const rest = { x: 60, y: 780, id: 1 };
      await touch(cdp, 'touchStart', [rest]);
      await swipe(cdp, sw, 2, [rest]);
      ok(await waitShots(page, 1), 'a swipe by a second finger while another finger rests on the screen shoots');
      await touch(cdp, 'touchEnd', []);
      await waitCanShoot(page);
      // left thumb swipes and is still down when the right thumb lands; left releases, then right swipes
      const L0 = { x: sw.x0 - 60, y: sw.y0, id: 3 }, Lend = { x: sw.x0 - 60 + sw.dx, y: sw.y0 + sw.dy, id: 3 };
      const tL = await swipe(cdp, { x0: L0.x, y0: L0.y, dx: sw.dx, dy: sw.dy }, 3, [], { holdOpen: true });
      const R0 = { x: sw.x0 + 60, y: sw.y0, id: 4 };
      await touch(cdp, 'touchStart', [Lend, R0], tL + 0.125);
      await touch(cdp, 'touchEnd', [Lend], tL + 0.13);
      ok(await waitShots(page, 2), 'the first thumb still shoots when a second thumb landed before it let go');
      ok((await st(page)).fingers === 1, 'the second thumb is tracked while it rests');
      await touch(cdp, 'touchEnd', []);
      await waitCanShoot(page);
      await swipe(cdp, { x0: R0.x, y0: R0.y, dx: sw.dx, dy: sw.dy }, 5, []);
      ok(await waitShots(page, 3), 'the other thumb shoots right after');
      allErrors.push(...errors); await ctx.close();
    }
    // ---- swipe during the 0.9 s ready period; miss reasons ----
    {
      const { ctx, page, errors, cdp } = await open(browser, 390, 844);
      await click(page, '#tSelect'); await click(page, '.lt[data-n="1"]');
      const sw = await page.evaluate(() => window.__game.swipeFor(0.5, 0, 0.12));
      await page.waitForFunction(() => { const s = window.__game.state(); return s.ui === 'play' && s.startDelay > 0.6; });
      await swipe(cdp, { x0: sw.x0, y0: sw.y0, dx: sw.dx * 0.5, dy: sw.dy * 0.5 }, 1, [], { n: 4 });
      await page.waitForFunction(() => window.__game.state().fingers === 0);
      const h = await page.evaluate(() => document.getElementById('hint').textContent);
      ok(/還沒開始/.test(h) && (await st(page)).shots === 0, 'a swipe during "ready" says it has not started yet (' + h + ')');
      // a swipe that starts just before "開始！" and is still moving after it: shoots
      await page.waitForFunction(() => window.__game.state().startDelay === 0);
      await restartReady(page);
      await page.waitForFunction(() => { const d = window.__game.state().startDelay; return d > 0 && d < 0.12; }, null, { polling: 'raf' });
      const half = { x0: sw.x0, y0: sw.y0, dx: sw.dx / 2, dy: sw.dy / 2 };
      await swipe(cdp, half, 2, [], { holdOpen: true });
      ok((await st(page)).fingers === 1, 'a finger put down during "ready" is tracked');
      await page.waitForFunction(() => window.__game.state().startDelay === 0);
      for (let k = 1; k <= 6; k++) await touch(cdp, 'touchMove', [{ x: sw.x0, y: sw.y0 + sw.dy / 2 + sw.dy / 2 * k / 6, id: 2 }]);
      await touch(cdp, 'touchEnd', []);
      ok(await waitShots(page, 1), 'a finger put down during "ready" and released after it still shoots');
      for (const [p, x, want] of [[0, 0, '太小力'], [0.5, 0.75, '偏右'], [0.5, -0.75, '偏左']]) {
        await waitCanShoot(page);
        const n = (await st(page)).shots;
        const s2 = await page.evaluate(([p, x]) => window.__game.swipeFor(p, x, 0.12), [p, x]);
        await swipe(cdp, s2, 3, []);
        await waitShots(page, n + 1);
        const got = await page.waitForFunction(() => { const s = window.__game.state(); return s.inAir === 0 && s.lastMiss; }, null, { timeout: 6000 }).then(() => st(page).then(s => s.lastMiss), () => '');
        ok(got === want, 'a miss says why: expected ' + want + ', got ' + got);
        await page.evaluate(() => window.__game.clearMiss());
      }
      const why = await page.evaluate(() => [window.__game.missWhy({ cross: { dx: 0, dz: 0.5 } }), window.__game.missWhy({ hitObs: true })]);
      ok(why[0] === '太大力' && why[1] === '被擋板擋下', 'long shots and panel blocks have their own reason (' + why + ')');
      allErrors.push(...errors); await ctx.close();
    }
    // ---- level grid: rows never overlap; tap on a tile's lower edge opens that tile ----
    for (const [w, h] of [[360, 640], [390, 844], [430, 932], [844, 390]]) {
      const { ctx, page, errors } = await open(browser, w, h);
      await click(page, '#tSelect'); await page.waitForTimeout(100);
      const r = await page.evaluate(() => {
        const t = [...document.querySelectorAll('.lt')].map(e => e.getBoundingClientRect()), cols = t.filter(x => Math.abs(x.top - t[0].top) < 1).length;
        let worst = 1e9; for (let i = 0; i + cols < t.length; i++) worst = Math.min(worst, t[i + cols].top - t[i].bottom);
        t[0] = document.querySelector('.lt[data-n="1"]').getBoundingClientRect();
        const hit = document.elementFromPoint(t[0].left + t[0].width / 2, t[0].bottom - 3).closest('.lt');
        return { worst, cols, hit: hit && hit.dataset.n, h: t[0].height };
      });
      ok(r.worst >= 8, w + 'x' + h + ' level rows keep a gap (min ' + r.worst.toFixed(1) + ' px, tile ' + r.h.toFixed(0) + ' px)');
      ok(r.hit === '1', w + 'x' + h + ' tapping tile 1 near its bottom edge opens level 1 (got ' + r.hit + ')');
      allErrors.push(...errors); await ctx.close();
    }
    // ---- swinging panel stays clear of the HUD; landscape scale ----
    for (const [w, h] of [[360, 640], [375, 500], [390, 610], [390, 844], [844, 390], [667, 375], [320, 568]]) {
      const { ctx, page, errors } = await open(browser, w, h);
      for (const L of (w === 360 ? [80, 100] : [100])) { // L100's panel hangs highest
        if (L === 100 && w === 360) await click(page, '#pMenu').catch(() => {});
        await page.evaluate(() => { const b = document.getElementById('sBack'); if (b.offsetParent) b.click(); });
        await startLevel(page, L);
        const r = await page.evaluate(async () => {
          const ids = ['bPause', 'tRing', 'bMute', 'windPill'], hud = ids.map(i => document.getElementById(i)).filter(e => e.offsetParent || getComputedStyle(e).display !== 'none').map(e => e.getBoundingClientRect());
          hud.push(document.querySelector('.hmid').getBoundingClientRect());
          let bad = 0, n = 0;
          for (let i = 0; i < 16; i++) {
            const o = window.__game.obstRect(); if (o) { n++; const area = (o.r - o.l) * (o.b - o.t); let cov = 0; for (const q of hud) cov += Math.max(0, Math.min(o.r, q.right) - Math.max(o.l, q.left)) * Math.max(0, Math.min(o.b, q.bottom) - Math.max(o.t, q.top)); if (cov > 0.02 * area || o.t < 0) bad++; }
            await new Promise(r => setTimeout(r, 80));
          }
          const b = window.__game.boardRect(); let bcov = 0; for (const q of hud) bcov += Math.max(0, Math.min(b.r, q.right) - Math.max(b.l, q.left)) * Math.max(0, Math.min(b.b, q.bottom) - Math.max(b.t, q.top));
          return { bad, n, bcov, ballBot: b.ballY + b.ballR, H: innerHeight, cam: window.__game.cam() };
        });
        ok(r.n > 8 && r.bad === 0, w + 'x' + h + ' L' + L + ' swinging panel never under the HUD (' + r.bad + '/' + r.n + ' frames)');
        ok(r.bcov === 0 && r.ballBot <= r.H - 30, w + 'x' + h + ' L' + L + ' backboard clear of HUD, ball in hand on screen');
        if (w === 844) ok(r.cam.S >= 0.58, '844x390 L' + L + ' scene scale up from 0.56 (' + r.cam.S.toFixed(2) + ')');
        await page.evaluate(() => document.getElementById('bPause').click());
      }
      if (w === 844) {
        await click(page, '#pMenu'); await click(page, '#sBack');
        await click(page, '#tSelect'); await click(page, '.lt[data-n="5"]');
        await page.waitForFunction(() => window.__game.state().ui === 'play');
        const s = await page.evaluate(() => window.__game.cam().S);
        ok(s >= 0.72, '844x390 L5 (no panel) scene scale ' + s.toFixed(2) + ' (was 0.56)');
      }
      if (w === 320) {
        const over = await page.evaluate(() => { const m = document.querySelector('.hmid'), r = m.getBoundingClientRect(); return Math.max(m.scrollWidth - m.clientWidth, ...[...m.querySelectorAll('*')].map(e => e.getBoundingClientRect().right - r.right)); });
        ok(over <= 0.5, '320x568 HUD middle has no overflow (' + over.toFixed(1) + ' px)');
      }
      allErrors.push(...errors); await ctx.close();
    }
    // ---- landscape cards fit without scrolling; settings buttons >= 44 px ----
    for (const [w, h] of [[844, 390], [667, 375], [390, 844]]) {
      const { ctx, page, errors } = await open(browser, w, h);
      for (const [btn, ov, okb] of [['#tSettings', '#settings', '#setOk'], ['#tHelp', '#help', '#hOk'], ['#tStats', '#stats', '#stOk']]) {
        await click(page, btn); await page.waitForFunction(ov => !document.querySelector(ov + ' .card').getAnimations().length, ov);
        const r = await page.evaluate(([ov, okb]) => { const o = document.querySelector(ov); return { sc: o.scrollHeight - o.clientHeight, bot: document.querySelector(okb).getBoundingClientRect().bottom, H: innerHeight, seg: [...document.querySelectorAll('.seg button')].map(b => b.offsetHeight) }; }, [ov, okb]);
        ok(r.sc <= 1 && r.bot <= r.H, w + 'x' + h + ' ' + ov + ' fits without scrolling (scroll ' + r.sc + ', button bottom ' + Math.round(r.bot) + '/' + r.H + ')');
        if (ov === '#settings') ok(Math.min(...r.seg) >= 44, w + 'x' + h + ' settings buttons are at least 44 px tall (' + Math.min(...r.seg).toFixed(0) + ')');
        await click(page, okb);
      }
      // win / fail / pause cards
      for (const id of ['win', 'fail', 'pause']) {
        const r = await page.evaluate(async id => { const o = document.getElementById(id); o.classList.remove('hidden'); await new Promise(r => setTimeout(r, 380)); const btns = [...o.querySelectorAll('.btn')].map(b => b.getBoundingClientRect().bottom); const res = { sc: o.scrollHeight - o.clientHeight, bot: Math.max(...btns), H: innerHeight }; o.classList.add('hidden'); return res; }, id);
        ok(r.sc <= 1 && r.bot <= r.H, w + 'x' + h + ' ' + id + ' card fits (scroll ' + r.sc + ', last button ' + Math.round(r.bot) + '/' + r.H + ')');
      }
      allErrors.push(...errors); await ctx.close();
    }
    // ---- title subtitle sits on a dark chip; idle redraw rate ----
    {
      const { ctx, page, errors } = await open(browser, 360, 640);
      await page.evaluate(() => { const p = CanvasRenderingContext2D.prototype, d = p.drawImage; window.__draws = 0; p.drawImage = function () { window.__draws++; return d.apply(this, arguments); }; });
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.ttl .sub')).backgroundColor);
      const m = bg.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?/), lum = m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 1, al = m && m[4] !== undefined ? +m[4] : 1;
      ok(lum < 0.25 && al >= 0.7, 'title subtitle has a dark backing chip (' + bg + ')');
      const t0 = await page.evaluate(() => { window.__draws = 0; return performance.now(); }); await page.waitForTimeout(1000);
      const r = await page.evaluate(t0 => window.__draws / ((performance.now() - t0) / 1000), t0);
      ok(r > 3 && r <= 24, 'title screen redraws at about 20 fps, not 60 (' + r.toFixed(1) + '/s)');
      await click(page, '#tSelect'); await page.evaluate(() => { window.__draws = 0; }); await page.waitForTimeout(500);
      ok((await page.evaluate(() => window.__draws)) === 0, 'nothing is redrawn behind the opaque level select');
      allErrors.push(...errors); await ctx.close();
    }
    // ---- leaving mid-game counts the shots; retry changes the variant; practice gives no streak achievements ----
    {
      const { ctx, page, errors, cdp } = await open(browser, 390, 844);
      await startLevel(page, 2);
      const v1 = (await st(page)).variant;
      const sw = await page.evaluate(() => window.__game.swipeFor(0.5, 0, 0.12));
      await swipe(cdp, sw, 1, []); await waitShots(page, 1);
      await page.evaluate(() => document.getElementById('bPause').click()); await click(page, '#pMenu');
      const s1 = JSON.parse(await page.evaluate(() => localStorage.getItem('hoop.stats')));
      ok(s1 && s1.shots === 1, 'a shot taken before leaving mid-level is saved in the stats (' + (s1 && s1.shots) + ')');
      await click(page, '.lt[data-n="2"]'); await page.waitForFunction(() => window.__game.state().ui === 'play');
      const v2 = (await st(page)).variant;
      await page.evaluate(() => document.getElementById('bPause').click()); await click(page, '#pRestart');
      const v3 = (await st(page)).variant;
      ok(v1 > 0 && (v1 !== v2 || v2 !== v3), 'each attempt gets a new hoop/wind variant (' + [v1, v2, v3] + ')');
      // practice: 11 perfect shots in a row (the hoop is still, no wind)
      await page.evaluate(() => document.getElementById('bPause').click()); await click(page, '#pMenu'); await click(page, '#sBack');
      await click(page, '#tPractice');
      await page.waitForFunction(() => { const s = window.__game.state(); return s.ui === 'play' && s.startDelay === 0; });
      const c = HK.practiceCfg();
      for (let i = 0; i < 11; i++) {
        await page.waitForFunction(() => window.__game.state().canShoot, null, { timeout: 10000 });
        const s = await st(page), a = HK.aim(c, s.t + 0.13, 0);
        const sw2 = await page.evaluate(([p, x]) => window.__game.swipeFor(p, x, 0.12), [a.p, a.xT]);
        await swipe(cdp, sw2, 10 + i, []); await waitShots(page, s.shots + 1);
      }
      await page.waitForFunction(() => window.__game.state().inAir === 0, null, { timeout: 10000 });
      const p = await st(page);
      const ach = JSON.parse(await page.evaluate(() => localStorage.getItem('hoop.ach') || '{}'));
      ok(p.makes >= 10, 'practice bot made 10+ in a row (' + p.makes + '/' + p.shots + ')');
      ok(!ach.s10, 'a practice streak does not unlock 手感發燙');
      await page.evaluate(() => document.getElementById('bPause').click()); await click(page, '#pMenu');
      const s2 = JSON.parse(await page.evaluate(() => localStorage.getItem('hoop.stats')));
      ok(s2.shots === 1 + p.shots && s2.bestStreak < 10, 'practice shots count in the totals but not the best streak (' + s2.shots + ', best ' + s2.bestStreak + ')');
      allErrors.push(...errors); await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL exception', e && e.stack || e); }
  ok(allErrors.length === 0, 'no page errors or console errors/warnings: ' + allErrors.slice(0, 3).join(' | '));
  await browser.close();
  console.log((fail ? 'FAIL ' : 'OK ') + pass + ' passed, ' + fail + ' failed (' + ((Date.now() - T0) / 1000).toFixed(1) + ' s)');
  process.exit(fail ? 1 : 0);
})();
async function restartReady(page) {
  await page.evaluate(() => document.getElementById('bPause').click()); await click(page, '#pRestart');
  await page.waitForFunction(() => { const s = window.__game.state(); return s.ui === 'play' && s.startDelay > 0.4; });
}
