// Regression tests for 森林糖果樹屋 (rope-cut): the level data in Node, then the page in Chromium with real CDP touch input.
// Each block maps to a finding of the 2026-11-15 release review (round 1).
// Usage: node tests.js   (about 40-70 s; waits on conditions, no timing-based assertions)
// In-play checks run on virtual time (requestAnimationFrame driven by the test), so vines stand still while fingers move.
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {normLevel, simulate, anchorAt, newWorld, stepWorld, applyOp};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const lv = n => C.normLevel(JSON.parse(JSON.stringify(LEVELS[n - 1])));
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
function eq(a, b, m) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((m || '') + ' expected ' + B + ' got ' + A); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLINTRO = { 1: 1, 4: 1, 11: 1, 21: 1, 31: 1, 41: 1, 51: 1, 61: 1, 71: 1, 81: 1, 91: 1 };

(async () => {
  console.log('Levels');
  await t('every stored solution still clears its level with 3 stars', () => {
    for (let n = 1; n <= LEVELS.length; n++) { const W = C.simulate(lv(n), lv(n).sol, 2600); ok(W.status === 1 && W.nst === 3, 'level ' + n); }
  });
  await t('L87 ghost demo: the moving-peg cut comes after step 600, when that vine is clear of vine 2', () => {
    const L = lv(87), op = L.sol.find(o => o[1] === 0 && o[2] === 3);
    ok(op[0] > 600, 'cut at ' + op[0]);
    const W = C.newWorld(L); let k = 0;
    while (W.t < op[0]) { while (k < L.sol.length && L.sol[k][0] <= W.t) { C.applyOp(L, W, L.sol[k][1], L.sol[k][2]); k++; } C.stepWorld(L, W); }
    const a3 = C.anchorAt(L, 3, W.t, [0, 0]), a2 = C.anchorAt(L, 2, W.t, [0, 0]), p = [a3[0] + (W.x - a3[0]) * 0.35, a3[1] + (W.y - a3[1]) * 0.35];
    const dx = W.x - a2[0], dy = W.y - a2[1], u = Math.max(0, Math.min(1, ((p[0] - a2[0]) * dx + (p[1] - a2[1]) * dy) / (dx * dx + dy * dy)));
    ok(Math.hypot(p[0] - a2[0] - u * dx, p[1] - a2[1] - u * dy) > 10, 'vines apart at the cut');
  });

  console.log('Page');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  // served over http, not file://: Chromium can drop a localStorage write across a reload of a file:// page
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'light' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => { errs.push(e.message); errors.push('pageerror: ' + e.message); });
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    if (o.vt) await page.addInitScript(() => {
      const q = []; let now = 1000;
      window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
      window.__vt = n => { for (let i = 0; i < n; i++) { now += 1000 / 60; q.splice(0).forEach(cb => cb(now)); } };
    });
    await page.goto(URL);
    await page.evaluate(p => { localStorage.clear(); localStorage.setItem('ropecut.mute', 'true'); localStorage.setItem('ropecut.unlockAll', 'true'); for (const k in p) localStorage.setItem('ropecut.' + k, typeof p[k] === 'string' ? p[k] : JSON.stringify(p[k])); }, Object.assign({ intro: ALLINTRO }, o.prep || {}));
    await page.reload();
    await page.waitForFunction(() => window.__game);
    if (o.vt) await page.evaluate(() => __vt(2));
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => { window.__mc = 0; new MutationObserver(() => window.__mc++).observe(document.getElementById('muteIcon'), { childList: true }); });
    return { ctx, page, cdp, errs };
  }
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ x: q[0], y: q[1], id: q[2] || 1, radiusX: 6, radiusY: 6, force: 1 })) });
  const waitFor = async (page, fn, arg, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await page.evaluate(fn, arg); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + fn.toString().slice(0, 90)); await sleep(25); } };
  const st = page => page.evaluate(() => window.__game.state());
  const visible = (page, id) => page.evaluate(id => { const e = document.getElementById(id); return !!e && !e.classList.contains('hidden') && !e.closest('.hidden'); }, id);
  // the centre of a button once it has stopped moving (cards pop in with a scale animation)
  async function center(page, sel) {
    await waitFor(page, s => { const e = document.querySelector(s); return e && !e.closest('.hidden') && e.getBoundingClientRect().width > 0; }, sel);
    let b, prev = '';
    for (let t0 = Date.now(); ; await sleep(30)) {
      b = await page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) { e.scrollIntoView({ block: 'center' }); } const q = e.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2, l: q.left, r: q.right, t: q.top, b: q.bottom }; }, sel);
      const k = [b.x, b.y, b.r].map(v => v.toFixed(1)).join(); if (k === prev || Date.now() - t0 > 2000) break; prev = k;
    }
    return b;
  }
  async function tapAt(cdp, x, y, id = 1, hold = 40, others = []) { await touch(cdp, 'touchStart', [...others, [x, y, id]]); await sleep(hold); await touch(cdp, 'touchEnd', [[x, y, id]]); }
  async function tap(g, sel) { const b = await center(g.page, sel); await tapAt(g.cdp, b.x, b.y); await sleep(60); return b; }
  const d0 = (page, sel) => page.evaluate(s => document.querySelector(s).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })), sel);
  const d0At = (page, x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); if (e) e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: x, clientY: y })); }, [x, y]);
  async function gotoLevel(g, n) {
    await tap(g, '#tSelect');
    await waitFor(g.page, () => !document.getElementById('select').classList.contains('hidden'));
    await tap(g, '.lt[data-n="' + n + '"]');
    await waitFor(g.page, n => { const s = window.__game.state(); return s.mode === 'ready' && s.level === n; }, n);
  }
  function segX(a, b, c, d) {
    const r1x = b[0] - a[0], r1y = b[1] - a[1], r2x = d[0] - c[0], r2y = d[1] - c[1], den = r1x * r2y - r1y * r2x;
    if (Math.abs(den) < 1e-9) return false;
    const u = ((c[0] - a[0]) * r2y - (c[1] - a[1]) * r2x) / den, v = ((c[0] - a[0]) * r1y - (c[1] - a[1]) * r1x) / den;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }
  // a swipe across vine i that crosses no other vine and starts away from tappable gadgets (screen coords)
  async function plan(page, i, len = 36) {
    const info = await page.evaluate(() => ({ segs: __game.ropeSegs(), taps: __game.tappables(), sc: __game.scale() }));
    const me = info.segs.find(s => s.rope === i);
    for (const f of [0.3, 0.2, 0.4, 0.5, 0.6, 0.7]) for (const l of [len, 28, 48]) {
      const k = Math.min(me.p.length - 2, Math.round(f * (me.p.length - 1))), P = me.p[k], Q = me.p[k + 1];
      const dx = Q[0] - P[0], dy = Q[1] - P[1], dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl, mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
      const A = [mx - nx * l, my - ny * l], B = [mx + nx * l, my + ny * l];
      if (info.segs.some(s => s.rope !== i && s.p.some((q, j) => j < s.p.length - 1 && segX(A, B, q, s.p[j + 1])))) continue;
      if (info.taps.every(q => Math.hypot(q[0] - A[0], q[1] - A[1]) >= 40 * info.sc)) return [A, B];
    }
    throw new Error('no clean swipe across vine ' + i);
  }
  const lerp = (A, B, k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k];
  async function swipe(cdp, A, B, id = 1, others = []) {
    await touch(cdp, 'touchStart', [...others, [A[0], A[1], id]]);
    for (let i = 1; i <= 4; i++) await touch(cdp, 'touchMove', [...others, [...lerp(A, B, i / 4), id]]);
    await touch(cdp, 'touchEnd', [[B[0], B[1], id]]);
  }
  const cuts = async page => (await st(page)).ops.filter(o => o[1] === 0).map(o => o[2]).sort();
  const winCard = page => waitFor(page, () => { __vt(10); return !document.getElementById('win').classList.contains('hidden'); }, null, 15000);

  console.log(' fingers and taps');
  await t('a tap on a button fires once while another finger rests on the title background or the playfield', async () => {
    const g = await open();
    const m = await center(g.page, '#tMute');
    await touch(g.cdp, 'touchStart', [[195, 330, 2]]); await sleep(150);
    await tapAt(g.cdp, m.x, m.y, 1, 50, [[195, 330, 2]]);
    await waitFor(g.page, () => window.__mc === 1);
    await touch(g.cdp, 'touchEnd', [[195, 330, 2]]); await sleep(300);
    eq(await g.page.evaluate(() => __mc), 1, 'mute toggles');
    // holds of 0.6 s and 1 s fire once each
    for (const hold of [600, 1000]) { const a = await g.page.evaluate(() => __mc); await tapAt(g.cdp, m.x, m.y, 1, hold); await sleep(250); eq(await g.page.evaluate(() => __mc) - a, 1, 'hold ' + hold); }
    await gotoLevel(g, 2);
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    await touch(g.cdp, 'touchStart', [[195, 700, 2]]); await sleep(150);
    const p = await center(g.page, '#bPause');
    await tapAt(g.cdp, p.x, p.y, 1, 50, [[195, 700, 2]]);
    await waitFor(g.page, () => window.__game.state().paused && !document.getElementById('pause').classList.contains('hidden'));
    const r = await center(g.page, '#pMute'), a = await g.page.evaluate(() => __mc);
    await tapAt(g.cdp, r.x, r.y, 1, 50, [[195, 700, 2]]);
    await waitFor(g.page, a => window.__mc === a + 1, a);
    await touch(g.cdp, 'touchEnd', [[195, 700, 2]]); await sleep(250);
    eq(await g.page.evaluate(() => __mc), a + 1, 'pause-card mute once');
    await g.ctx.close();
  });

  await t('a real tap followed by a detail-0 click (Chromium 141) runs once; a lone detail-0 click still runs', async () => {
    const g = await open();
    const m = await tap(g, '#tMute');
    await d0(g.page, '#tMute'); await d0At(g.page, m.r + 2, m.y); await d0At(g.page, m.x, m.y);
    await sleep(200);
    eq(await g.page.evaluate(() => __mc), 1, 'tap + replays');
    await sleep(900);
    await d0(g.page, '#tMute'); await sleep(100);
    eq(await g.page.evaluate(() => __mc), 2, 'lone detail-0 click');
    // a tap that changes the screen: the replayed click must not hit what is under the finger on the new screen
    const b = await tap(g, '#tSelect');
    await d0(g.page, '#tSelect'); await d0At(g.page, b.x, b.y);
    await sleep(200);
    const s = await st(g.page);
    ok(s.mode === 'select' && await visible(g.page, 'select'), 'still on level select: ' + s.mode);
    // keyboard: Enter on a focused button still works right after a tap
    await g.page.focus('#sBack'); await g.page.keyboard.press('Enter');
    await waitFor(g.page, () => window.__game.state().mode === 'title');
    await g.ctx.close();
  });

  await t('first swipe on the ready screen starts the level and cuts (L1, L4); win L1, 下一關 + detail-0 lands on L2', async () => {
    const g = await open({ vt: true });
    for (const n of [4, 1]) {
      if (n === 1) { await tap(g, '#bPause'); await tap(g, '#pSelect'); await tap(g, '.lt[data-n="1"]'); await waitFor(g.page, () => window.__game.state().mode === 'ready' && window.__game.state().level === 1); }
      else await gotoLevel(g, n);
      const [A, B] = await plan(g.page, 0);
      await swipe(g.cdp, A, B);
      const s = await st(g.page);
      eq([s.mode, (await cuts(g.page))], ['play', [0]], 'L' + n + ' first swipe');
    }
    await winCard(g.page);
    const nb = await tap(g, '#wNext');
    await d0(g.page, '#wNext'); await d0At(g.page, nb.x, nb.y); await d0At(g.page, nb.x, nb.b + 3);
    await sleep(200);
    const s = await st(g.page);
    eq([s.mode, s.level], ['ready', 2], 'one level forward');
    await g.ctx.close();
  });

  await t('two fingers crossing two vines at once cut both; a finger already down still cuts after the other one', async () => {
    const g = await open({ vt: true });
    await gotoLevel(g, 4);
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    const s0 = await plan(g.page, 0), s1 = await plan(g.page, 1);
    await touch(g.cdp, 'touchStart', [[...s0[0], 1]]); await touch(g.cdp, 'touchStart', [[...s0[0], 1], [...s1[0], 2]]);
    for (let i = 1; i <= 4; i++) await touch(g.cdp, 'touchMove', [[...lerp(s0[0], s0[1], i / 4), 1], [...lerp(s1[0], s1[1], i / 4), 2]]);
    await touch(g.cdp, 'touchEnd', [[...s0[1], 1], [...s1[1], 2]]);
    eq(await cuts(g.page), [0, 1], 'simultaneous');
    await tap(g, '#bRestart');
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    const r0 = await plan(g.page, 0), r1 = await plan(g.page, 1);
    await touch(g.cdp, 'touchStart', [[...r1[0], 2]]);
    await swipe(g.cdp, r0[0], r0[1], 1, [[...r1[0], 2]]);
    eq(await cuts(g.page), [0], 'first finger');
    for (let i = 1; i <= 4; i++) await touch(g.cdp, 'touchMove', [[...lerp(r1[0], r1[1], i / 4), 2]]);
    await touch(g.cdp, 'touchEnd', [[...r1[1], 2]]);
    eq(await cuts(g.page), [0, 1], 'resting finger swipes later');
    await g.ctx.close();
  });

  console.log(' saves');
  await t('a corrupt save (hat 99, junk stars) loads without errors and is ignored', async () => {
    for (const hat of ['99', '2.5', '"x"', '-7']) {
      const g = await open({ vt: true, prep: { hat, stars: '{"2":99,"3":2.5,"abc":3,"200":3,"5":3,"6":"3"}' } });
      await g.page.evaluate(() => __vt(30));
      const sv = await g.page.evaluate(() => __game.saved());
      eq([sv.hat, sv.stars], [-1, 3], 'hat ' + hat);
      await gotoLevel(g, 1); await g.page.evaluate(() => __vt(30));
      eq(g.errs, [], 'page errors');
      await g.ctx.close();
    }
  });

  await t('3-star records: best time and fewest cuts are saved and shown on the win card and the level tile', async () => {
    const g = await open({ vt: true });
    await gotoLevel(g, 1);
    const [A, B] = await plan(g.page, 0);
    await swipe(g.cdp, A, B);
    await winCard(g.page);
    const rec = await g.page.textContent('#wRec');
    ok(/三星紀錄 [\d.]+s · 1 刀/.test(rec) && /達人/.test(rec), 'win card: ' + rec);
    const best = await g.page.evaluate(() => JSON.parse(localStorage.getItem('ropecut.best')));
    ok(best && best[1] && best[1].c === 1 && best[1].t > 0, 'saved ' + JSON.stringify(best));
    await tap(g, '#wSelect');
    const tile = await g.page.evaluate(() => document.querySelector('.lt[data-n="1"]').textContent);
    ok(/\ds·1刀/.test(tile), 'tile shows the record: ' + tile);
    await g.ctx.close();
  });

  await t('a play is counted (and saved) as soon as it starts, also when the level is restarted midway', async () => {
    const g = await open({ vt: true });
    await gotoLevel(g, 3);
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    await tap(g, '#bRestart');
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    eq(await g.page.evaluate(() => JSON.parse(localStorage.getItem('ropecut.stats')).plays), 2);
    await g.ctx.close();
  });

  await t('看提示 on the fail card is disabled with its reason once the hint is used', async () => {
    const g = await open({ vt: true, prep: { hints: { 1: 1 } } });
    await gotoLevel(g, 1);
    await tapAt(g.cdp, 195, 800); await waitFor(g.page, () => window.__game.state().mode === 'play');
    await g.page.evaluate(() => { while (__game.state().t < 170) __vt(1); });
    const [A, B] = await plan(g.page, 0);
    await swipe(g.cdp, A, B); // cut between steps ~170 and 200: the candy misses the fox
    await waitFor(g.page, () => { __vt(10); return !document.getElementById('fail').classList.contains('hidden'); }, null, 15000);
    const h = await g.page.evaluate(() => { const b = document.getElementById('fHint'); return [b.disabled, b.textContent]; });
    eq(h, [true, '提示已用過']);
    await g.ctx.close();
  });

  console.log(' layout');
  await t('HUD: the third star stays inside the level card at 360 and 320 wide', async () => {
    for (const [w, h] of [[360, 640], [320, 568], [390, 844]]) {
      const g = await open({ w, h });
      await gotoLevel(g, 100);
      await g.page.evaluate(() => { document.getElementById('hStars').innerHTML = '<span class="on">★</span><span class="on">★</span><span class="on">★</span>'; });
      const r = await g.page.evaluate(() => { const c = document.querySelector('.hmid').getBoundingClientRect(), s = document.querySelectorAll('#hStars span'), l = s[2].getBoundingClientRect(), n = document.getElementById('hLevel').getBoundingClientRect(); return [l.right, c.right, n.right, s[0].getBoundingClientRect().left]; });
      ok(r[0] <= r[1] - 2 && r[2] <= r[3], w + ': ' + r.map(Math.round));
      await g.ctx.close();
    }
  });

  await t('L1 start prompt does not cover the fox (head to feet) or the candy', async () => {
    for (const [w, h] of [[390, 844], [360, 640], [320, 568], [430, 932], [844, 390]]) {
      const g = await open({ w, h });
      await gotoLevel(g, 1);
      const r = await g.page.evaluate(() => { const p = document.getElementById('ready').getBoundingClientRect(), f = __game.fox(), s = __game.scale(), c = __game.screen(__game.state().x, __game.state().y);
        const hit = (ax, ay, bx, by) => ax < p.right && bx > p.left && ay < p.bottom && by > p.top;
        return [hit(f[0] - 50 * s, f[1] - 50 * s, f[0] + 50 * s, f[1] + 70 * s), hit(c[0] - 18 * s, c[1] - 18 * s, c[0] + 18 * s, c[1] + 18 * s), document.getElementById('ready').textContent]; });
      eq(r, [false, false, '用手指劃過藤蔓就能切斷它'], w + 'x' + h);
      await g.ctx.close();
    }
  });

  await t('844x390 landscape: the playfield is clearly larger than 0.54 and clear of the HUD', async () => {
    const g = await open({ w: 844, h: 390, vt: true });
    for (const n of [1, 50, 100]) {
      if (n === 1) await gotoLevel(g, 1);
      else { await tap(g, '#bPause'); await tap(g, '#pSelect'); await tap(g, '.lt[data-n="' + n + '"]'); await waitFor(g.page, n => window.__game.state().level === n && window.__game.state().mode === 'ready', n); }
      const r = await g.page.evaluate(() => { const b = __game.box(), l = document.querySelector('.hmid').getBoundingClientRect(), h = document.getElementById('bHint').getBoundingClientRect(); return { s: __game.scale(), b, l: l.right, h: h.left }; });
      ok(r.s >= 0.65, 'L' + n + ' scale ' + r.s.toFixed(2));
      ok(r.b[0] >= r.l && r.b[2] <= r.h, 'L' + n + ' box clear of the HUD columns ' + JSON.stringify(r));
    }
    // L100 is taller than the screen: the view follows the candy, which stays on screen while it falls
    await tapAt(g.cdp, 30, 370); await waitFor(g.page, () => window.__game.state().mode === 'play');
    for (let i = 0; i < 12; i++) {
      const c = await g.page.evaluate(() => { __vt(10); const s = __game.state(); return __game.screen(s.x, s.y).concat(s.mode); });
      if (c[2] !== 'play') break;
      ok(c[1] > 0 && c[1] < 390, 'candy on screen ' + c);
    }
    await g.ctx.close();
  });

  await browser.close();
  if (errors.length) { fail++; console.log('FAIL   page errors:', errors.slice(0, 5).join(' | ')); }
  console.log(`${fail ? 'FAIL' : 'PASS'} rope-cut tests: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
