// Regression tests for 波塞迪亞 (atlantis). Real headless Chromium, 390×844 @2x touch, every request except the page
// itself is refused (offline). Draw calls are stubbed for speed except on the first page, which renders for real.
// Waits are on game state (never fixed sleeps for game-time effects), so a busy machine only makes it slower.
// Usage: node tests.js
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const HTML = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*{box-sizing:border-box}html,body{margin:0}</style></head><body>' + SRC + '</body></html>';
const NODRAW = `for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) if (C) for (const f of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']) if (C.prototype[f]) C.prototype[f] = function () {};`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message.split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const allErrors = [];

let browser;
async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const ext = [];
  await ctx.route('**/*', r => { const u = r.request().url(); if (u === 'http://game.test/') return r.fulfill({ body: HTML, contentType: 'text/html' }); ext.push(u); return r.abort(); });
  if (!opts.draw) await ctx.addInitScript(NODRAW);
  if (opts.init) await ctx.addInitScript(opts.init);
  const env = { ctx, ext };
  env.page = await newPage(env);
  const cdp = await ctx.newCDPSession(env.page);
  env.T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  env.center = sel => env.page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel);
  env.tap = async (sel, id = 0) => { const c = await env.center(sel); await env.T('touchStart', [{ ...c, id }]); await sleep(40); await env.T('touchEnd', []); await sleep(150); };
  return env;
}
async function newPage(env) {
  const page = await env.ctx.newPage();
  page.on('pageerror', e => allErrors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') allErrors.push('console: ' + m.text()); });
  await page.goto('http://game.test/');
  await page.waitForFunction(() => !document.getElementById('start').disabled && window.__poseidia && __poseidia.fieldsReady() === 6, null, { timeout: 60000 });
  return page;
}
// put the player on the nearest free spot to (x, z)
const place = (page, x, z, yaw) => page.evaluate(([x, z, yaw]) => {
  const P = __poseidia.player;
  for (let r = 0; r < 8; r += 0.5) for (let a = 0; a < 6.3; a += 0.4) { const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r; if (!__poseidia.blocked(px, pz)) { P.x = px; P.z = pz; if (yaw != null) P.yaw = yaw; return [px, pz]; } }
  return null;
}, [x, z, yaw]);
const sfx = page => page.evaluate(() => __poseidia.state().sfx);
const pressed = page => page.evaluate(() => document.getElementById('soundBtn').getAttribute('aria-pressed'));

(async () => {
  const T0 = Date.now();
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });

  console.log('Offline / self-contained (round 1 veto), antialias');
  await t('source has no font links, no CDN script', () => {
    ok(!/fonts\.googleapis|fonts\.gstatic|cdnjs|<link\b/i.test(SRC), 'external link left');
    ok(!/<script[^>]+\bsrc=/i.test(SRC), 'external script tag');
    ok(/<script id="three-r128">/.test(SRC), 'three r128 not inlined');
  });
  const A = await open({ draw: true });
  await t('real rendering, every external request refused: ready, 0 requests, antialias on at DPR 2', async () => {
    ok(A.ext.length === 0, 'external requests: ' + A.ext.join(', '));
    ok(await A.page.evaluate(() => document.getElementById('start').textContent === '踏上島嶼'));
    const aa = await A.page.evaluate(() => { const c = document.querySelector('#view canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); return g && g.getContextAttributes().antialias; });
    ok(aa === true, 'antialias ' + aa);
  });
  await A.ctx.close();

  const B = await open();
  console.log('Taps: never lost, never doubled (round 2 veto)');
  await B.tap('#start');
  await t('8 taps/s alternating 音效 / left half / right half: 16 taps on 音效 = exactly 16 toggles', async () => {
    const sb = await B.center('#soundBtn');
    await B.page.evaluate(() => { const b = document.getElementById('soundBtn'); let last = b.getAttribute('aria-pressed'); window.__tog = 0; new MutationObserver(() => { const v = b.getAttribute('aria-pressed'); if (v !== last) { __tog++; last = v; } }).observe(b, { attributes: true }); });
    const pend = [], tgt = [sb, { x: 90, y: 620 }, { x: 300, y: 450 }], t0 = Date.now();
    for (let i = 0; i < 48; i++) { const q = tgt[i % 3]; pend.push(B.T('touchStart', [{ x: q.x, y: q.y, id: 10 + i }])); await sleep(40); pend.push(B.T('touchEnd', [])); const w = t0 + (i + 1) * 125 - Date.now(); if (w > 0) await sleep(w); }
    await Promise.all(pend);
    await sleep(600);   // let late (batched) clicks arrive: they must not toggle again
    const tog = await B.page.evaluate(() => __tog);
    ok(tog === 16, 'toggles ' + tog);
    ok(await B.page.evaluate(() => !document.getElementById('joy').classList.contains('on')), 'joystick left on');
  });
  await t('a drag that starts on 音效 (camera turn) does not toggle', async () => {
    const sb = await B.center('#soundBtn'), p0 = await pressed(B.page);
    await B.T('touchStart', [{ ...sb, id: 70 }]); await B.T('touchMove', [{ x: sb.x - 20, y: sb.y + 10, id: 70 }]); await B.T('touchMove', [{ x: sb.x - 60, y: sb.y + 30, id: 70 }]); await B.T('touchEnd', []); await sleep(200);
    ok(await pressed(B.page) === p0, 'drag toggled sound');
  });
  await t('joystick held + second finger on ? → help opens; joystick does not stick', async () => {
    const hb = await B.center('#helpBtn');
    await B.T('touchStart', [{ x: 80, y: 650, id: 3 }]); await B.T('touchMove', [{ x: 80, y: 600, id: 3 }]); await sleep(150);
    await B.T('touchStart', [{ x: 80, y: 600, id: 3 }, { ...hb, id: 4 }]); await sleep(60);
    ok(await B.page.evaluate(() => !document.getElementById('intro').hidden), 'help did not open');
    await B.T('touchEnd', [{ ...hb, id: 4 }]); await sleep(100); await B.T('touchEnd', []); await sleep(150);
    ok(await B.page.evaluate(() => !document.getElementById('joy').classList.contains('on')), 'joystick stuck on');
    await B.tap('#start', 5);
    ok(await B.page.evaluate(() => document.getElementById('intro').hidden), 'did not resume');
  });
  await t('joystick held + second finger taps 音效 → toggles once; then a single tap toggles once', async () => {
    const sb = await B.center('#soundBtn'), p0 = await pressed(B.page);
    await B.T('touchStart', [{ x: 80, y: 650, id: 6 }]); await B.T('touchMove', [{ x: 80, y: 600, id: 6 }]); await sleep(150);
    await B.T('touchStart', [{ x: 80, y: 600, id: 6 }, { ...sb, id: 7 }]); await sleep(60);
    await B.T('touchEnd', [{ ...sb, id: 7 }]); await sleep(150); await B.T('touchEnd', []); await sleep(400);
    ok(await pressed(B.page) !== p0, 'no toggle with joystick held');
    await B.tap('#soundBtn', 8); await sleep(300);
    ok(await pressed(B.page) === p0, 'single tap did not toggle exactly once');
  });
  await t('keyboard Enter on 音效 still toggles (click with detail 0)', async () => {
    const p0 = await pressed(B.page); await B.page.focus('#soundBtn'); await B.page.keyboard.press('Enter'); await sleep(100);
    ok(await pressed(B.page) !== p0, 'Enter did nothing'); await B.page.keyboard.press('Enter'); await sleep(100); ok(await pressed(B.page) === p0);
  });

  console.log('Guide follows streets and bridges');
  await t('every spot tested gets a route; the waypoint is in clear sight; no straight line across water', async () => {
    const r = await B.page.evaluate(() => {
      const m = __poseidia, out = [];
      // quay corners where straight-line walkers got stuck, and the thin slivers from the round-2 null-route probe
      // (the last four are hair-thin slivers: they must get a route, sight lines there are not meaningful)
      const spots = [[20, 118.5], [33.5, 73.5], [43.7, 73.8], [27, 129], [-26.5, -35.5], [79.5, -90.5], [17, -100.5]];
      for (const [x, z] of spots) {
        if (m.blocked(x, z)) { out.push('blocked ' + x + ',' + z); continue; }
        for (const id of ['bridge', 'market', 'harbor']) {
          const rt = m.route(id, x, z); if (!rt) { out.push('null ' + id + ' ' + x + ',' + z); continue; }
          if (Math.hypot(rt.x - x, rt.z - z) < 0.05) { out.push('waypoint on the spot ' + id + ' ' + x + ',' + z); continue; }
          if (spots.indexOf(spots.find(q => q[0] === x && q[1] === z)) > 2) continue;
          const n = Math.ceil(Math.hypot(rt.x - x, rt.z - z) / 0.25);
          for (let i = 1; i <= n; i++) if (m.blocked(x + (rt.x - x) * i / n, z + (rt.z - z) * i / n)) { out.push('hidden ' + id + ' ' + x + ',' + z); break; }
        }
      }
      let x = 45, z = 12; for (let k = 0; k < 60 && m.blocked(x, z); k++) { x += 0.3; z -= 0.2; }
      const rt = m.route('temple', x, z); if (!rt || m.groundAt(rt.x, rt.z) <= 0 || rt.steps < 30) out.push('temple across canal ' + JSON.stringify(rt));
      return out;
    });
    ok(!r.length, r.slice(0, 4).join(' | '));
  });
  await t('on the inner bridge: the temple circle edge shows ≥1 步; inside both circles both count', async () => {
    await place(B.page, 0, 33.2, Math.PI);   // just outside the temple circle (r 11 around z 22)
    await B.page.waitForFunction(() => __poseidia.found().includes('bridge'), null, { timeout: 15000 });
    await B.page.waitForFunction(() => { const g = __poseidia.guide(); return g && g.id === 'temple' && g.steps >= 1; }, null, { timeout: 5000 });
    await place(B.page, 0, 32.6, Math.PI);
    await B.page.waitForFunction(() => __poseidia.found().length >= 2, null, { timeout: 15000 }).catch(async () => { throw new Error(JSON.stringify(await B.page.evaluate(() => ({ f: __poseidia.found(), p: [__poseidia.player.x, __poseidia.player.z], st: __poseidia.state().paused, intro: document.getElementById('intro').hidden })))); });
    const f = await B.page.evaluate(() => __poseidia.found());
    ok(f.includes('bridge') && f.includes('temple'), f.join());
    await B.page.waitForFunction(() => __poseidia.guide() && __poseidia.guide().steps >= 1, null, { timeout: 5000 });
  });
  await t('caption sits low: clear of minimap, below the middle of the view, above the control hints', async () => {
    const r = await B.page.evaluate(() => { const c = document.getElementById('caption').getBoundingClientRect(), m = document.getElementById('map').getBoundingClientRect(), gh = document.getElementById('joyGhost').getBoundingClientRect(); return { c: [c.top, c.bottom], m: m.bottom, h: innerHeight, gh: gh.top, on: document.getElementById('caption').classList.contains('on') }; });
    ok(r.on, 'caption not shown'); ok(r.c[0] > r.m + 8, 'overlaps minimap ' + JSON.stringify(r)); ok(r.c[0] > r.h * 0.5, 'caption in upper half ' + JSON.stringify(r));
    ok(r.gh === 0 || r.c[1] <= r.gh + 1, 'covers the joystick hint ' + JSON.stringify(r));
  });
  await t('HUD and intro explain jars and the timer (jar icon, 陶罐, 計時, 委託, medal times)', async () => {
    const s = await B.page.evaluate(() => ({ hud: !!document.querySelector('#extra .jarIco') && /陶罐/.test(document.getElementById('extra').textContent), how: document.querySelector('.how').textContent }));
    ok(s.hud, 'no jar icon/text in HUD'); ok(/陶罐/.test(s.how) && /計時/.test(s.how) && /委託/.test(s.how) && /金 1:30/.test(s.how), s.how);
  });

  console.log('Real-time timer, saved position');
  await t('timer counts real time while playing and stops while paused', async () => {
    const t0 = await B.page.evaluate(() => __poseidia.state().run.t); const w0 = Date.now(); await sleep(1500);
    const t1 = await B.page.evaluate(() => __poseidia.state().run.t), w = (Date.now() - w0) / 1000;
    ok(t1 - t0 > w - 0.6 && t1 - t0 < w + 0.6, 'counted ' + (t1 - t0).toFixed(2) + ' s for ' + w.toFixed(2) + ' s');
    await B.tap('#helpBtn'); const t2 = await B.page.evaluate(() => __poseidia.state().run.t); await sleep(800);
    ok(Math.abs(await B.page.evaluate(() => __poseidia.state().run.t) - t2) < 0.05, 'timer ran while paused');
    await B.tap('#start');
  });
  await t('position and view survive a reload; old keys still load', async () => {
    const at = await place(B.page, 0, 160, 0.7);
    await B.page.evaluate(() => { __poseidia.player.pitch = 0.2; });
    await B.page.waitForFunction(at => { const p = __poseidia.player; return Math.hypot(p.x - at[0], p.z - at[1]) < 1; }, at);
    await B.page.evaluate(() => dispatchEvent(new Event('pagehide')));
    await B.page.close(); B.page = await newPage(B);
    const s = await B.page.evaluate(() => ({ x: __poseidia.player.x, z: __poseidia.player.z, pitch: __poseidia.player.pitch, today: document.getElementById('today').textContent, found: document.getElementById('found').textContent }));
    ok(Math.hypot(s.x - at[0], s.z - at[1]) < 3, 'position lost ' + JSON.stringify(s));
    ok(Math.abs(s.pitch - 0.2) < 0.05, 'pitch lost'); ok(/接續/.test(s.today), s.today); ok(/已探索 [23] \/ 6/.test(s.found), s.found);
  });
  await B.ctx.close();
  const O = await open({ init: () => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('poseidia.found', '["harbor"]'); localStorage.setItem('poseidia.muted', 'true'); } } catch (e) {} } });
  await t('pre-update save (found + muted keys only) loads: 1 / 6, muted, run not timed', async () => {
    const s = await O.page.evaluate(() => ({ f: document.getElementById('found').textContent, m: document.getElementById('soundBtn').getAttribute('aria-pressed'), fresh: __poseidia.state().run.fresh }));
    ok(/已探索 1 \/ 6/.test(s.f), s.f); ok(s.m === 'false', 'mute lost'); ok(s.fresh === false, 'partial run must not set a best time');
  });
  await O.ctx.close();

  console.log('Replay: completion card, medals, jars, re-explore, daily commission');
  const C = await open();
  await C.tap('#start');
  await t('8 jars on reachable open ground; walking onto one collects it (run and lifetime count)', async () => {
    const jars = await C.page.evaluate(() => __poseidia.state().run.jars);
    ok(jars.length === 8, 'jars ' + jars.length);
    ok(await C.page.evaluate(js => js.every(q => !__poseidia.blocked(q[0], q[1])), jars), 'jar on blocked cell');
    await place(C.page, jars[0][0], jars[0][1]);
    await C.page.waitForFunction(() => __poseidia.state().run.got.length === 1, null, { timeout: 10000 });
    await C.page.waitForFunction(() => __poseidia.state().jarTotal === 1 && /陶罐 1 \/ 8/.test(document.getElementById('extra').textContent), null, { timeout: 5000 });
  });
  await t('all six: opaque completion card, caption hidden, time + best + medal + list; best stored', async () => {
    for (const p of await C.page.evaluate(() => __poseidia.pois())) { await place(C.page, p.x, p.z); await C.page.waitForFunction(id => __poseidia.found().includes(id), p.id, { timeout: 15000 }); }
    await C.page.waitForFunction(() => !document.getElementById('done').hidden, null, { timeout: 15000 });
    const s = await C.page.evaluate(() => ({ list: document.querySelectorAll('#dList li').length, time: document.getElementById('dTime').textContent, best: document.getElementById('dBest').textContent, nb: document.getElementById('newBest').textContent, ls: localStorage.getItem('poseidia.best'), paused: __poseidia.state().paused, cap: document.getElementById('caption').classList.contains('on'), bg: getComputedStyle(document.querySelector('#done .card')).backgroundColor, medal: document.querySelectorAll('#medals .m.got').length, guide: document.getElementById('guide').hidden }));
    ok(s.list === 6, 'list ' + s.list); ok(/^\d+:\d\d$/.test(s.time), s.time); ok(s.best === s.time, s.best + ' vs ' + s.time);
    ok(s.nb === '新紀錄！', s.nb); ok(+s.ls > 0, 'best not saved'); ok(s.paused, 'not paused under the card');
    ok(!s.cap, 'caption still showing under the card'); ok(/^rgb\(/.test(s.bg), 'card not opaque: ' + s.bg); ok(s.medal === 1, 'no medal for a fast run'); ok(s.guide, 'guide still shown');
  });
  await t('重新探索 clears landmarks and jars, keeps best, restarts timer at a start gate', async () => {
    const before = await C.page.evaluate(() => __poseidia.state().best);
    await C.tap('#doneAgain');
    const s = await C.page.evaluate(() => ({ f: __poseidia.found().length, st: __poseidia.state(), p: [__poseidia.player.x, __poseidia.player.z], done: document.getElementById('done').hidden }));
    ok(s.f === 0, 'found ' + s.f); ok(s.st.best === before, 'best changed'); ok(s.st.run.t < 2 && s.st.run.got.length === 0 && s.st.run.fresh, JSON.stringify(s.st.run));
    ok(Math.abs(Math.hypot(s.p[0], s.p[1]) - 131) < 0.5, 'not at a start gate'); ok(s.done, 'card still open');
  });
  await t('today\'s commission: 3 landmarks in order, timed, medal targets; finish card; back to exploring where you were', async () => {
    const home = await place(C.page, 0, 128, 0);
    await C.tap('#helpBtn'); await C.tap('#taskBtn');
    const k = await C.page.evaluate(() => __poseidia.task());
    ok(k && k.ids.length === 3 && new Set(k.ids).size === 3 && k.gold < k.silver && k.silver < k.bronze, JSON.stringify(k));
    await C.page.waitForFunction(id => __poseidia.guide() && __poseidia.guide().id === id, k.ids[0], { timeout: 5000 });
    const pois = await C.page.evaluate(() => __poseidia.pois());
    const second = pois.find(p => p.id === k.ids[1]); await place(C.page, second.x, second.z);   // out of order: must not count
    await C.page.waitForFunction(id => { const p = __poseidia.player, q = __poseidia.pois().find(o => o.id === id); return Math.hypot(p.x - q.x, p.z - q.z) < q.r; }, k.ids[1]);
    await sleep(500);
    ok(await C.page.evaluate(() => __poseidia.task().idx) === 0, 'out-of-order landmark counted');
    for (let i = 0; i < 3; i++) { const p = pois.find(q => q.id === k.ids[i]); await place(C.page, p.x, p.z); await C.page.waitForFunction(n => __poseidia.task().idx >= n, i + 1, { timeout: 15000 }); }
    await C.page.waitForFunction(() => !document.getElementById('done').hidden, null, { timeout: 15000 });
    const s = await C.page.evaluate(() => ({ eb: document.getElementById('doneEyebrow').textContent, list: [...document.querySelectorAll('#dList li')].map(l => l.textContent), daily: JSON.parse(localStorage.getItem('poseidia.daily')), found: __poseidia.found().length }));
    ok(/委託/.test(s.eb), s.eb); ok(s.list.length === 3 && /^1\./.test(s.list[0]), s.list.join()); ok(s.daily && s.daily.best > 0, 'daily best not stored');
    ok(s.found === 0, 'commission changed the exploration');
    await C.tap('#doneGo');
    const back = await C.page.evaluate(() => ({ task: __poseidia.task(), x: __poseidia.player.x, z: __poseidia.player.z }));
    ok(!back.task && Math.hypot(back.x - home[0], back.z - home[1]) < 1, 'not back at the exploration spot ' + JSON.stringify(back));
  });
  await t('each new exploration varies start gate and jars; each load varies the sky', async () => {
    const samples = await C.page.evaluate(() => { const o = []; for (let i = 0; i < 12; i++) o.push(__poseidia.sampleRun()); return o; });
    ok(new Set(samples.map(s => s.start)).size >= 2, 'start never changes'); ok(new Set(samples.map(s => JSON.stringify(s.jars[0]))).size >= 10, 'jars repeat');
    const skies = [];
    for (const v of [0.05, 0.95]) {
      const pg = await C.ctx.newPage();
      await pg.addInitScript(v => { Math.random = () => v; try { localStorage.clear(); } catch (e) {} }, v);
      await pg.goto('http://game.test/'); await pg.waitForFunction(() => !document.getElementById('start').disabled, null, { timeout: 60000 });
      skies.push(await pg.evaluate(() => __poseidia.state().sky)); await pg.close();
    }
    ok(skies[0] !== skies[1], skies.join());
  });
  await C.ctx.close();

  console.log('Bump feedback, action sounds, resolution drop');
  const D = await open({ init: () => { try { localStorage.setItem('poseidia.muted', 'false'); } catch (e) {} } });
  await D.tap('#start');
  await t('walking plays footsteps', async () => {
    await place(D.page, 0, 128, 0);   // outer ring road, facing the city
    const s0 = await sfx(D.page);
    await D.T('touchStart', [{ x: 80, y: 650, id: 1 }]); await D.T('touchMove', [{ x: 80, y: 610, id: 1 }]);
    await D.page.waitForFunction(s0 => __poseidia.state().sfx >= s0 + 2, s0, { timeout: 10000 }).catch(() => {});
    await D.T('touchEnd', []);
    ok(await sfx(D.page) >= s0 + 2, 'no footsteps');
  });
  await t('pushing into the canal: thud, hint toast about the bridge, bridge pulses on the minimap', async () => {
    const spot = await D.page.evaluate(() => {
      const m = __poseidia;
      for (const [r, sg] of [[117.6, -1], [77.6, -1], [41.6, -1], [28.4, 1], [64.4, 1], [102.4, 1]]) for (let a = 0.3; a < 6.2; a += 0.04) {
        if (Math.abs(Math.sin(2 * a)) < 0.25) continue;
        const x = Math.sin(a) * r, z = Math.cos(a) * r, wx = Math.sin(a) * (r + sg * 1.2), wz = Math.cos(a) * (r + sg * 1.2);
        const tx = Math.cos(a) * 0.8, tz = -Math.sin(a) * 0.8;
        if (!m.blocked(x, z) && m.groundAt(wx, wz) < 0 && !m.blocked(x + tx, z + tz) && !m.blocked(x - tx, z - tz)) { m.player.x = x; m.player.z = z; m.player.yaw = Math.atan2(-(wx - x), -(wz - z)); return [x, z]; }
      }
      return null;
    });
    ok(spot, 'no quay spot found');
    const s0 = await sfx(D.page);
    await D.T('touchStart', [{ x: 80, y: 650, id: 2 }]); await D.T('touchMove', [{ x: 80, y: 600, id: 2 }]);
    await D.page.waitForFunction(() => /運河/.test(__poseidia.state().toast), null, { timeout: 15000 });
    const s = await D.page.evaluate(() => __poseidia.state());
    await D.T('touchEnd', []);
    ok(s.flash, 'no minimap pulse'); ok(s.sfx > s0, 'no thud');
  });
  await t('mute silences action sounds', async () => {
    await D.tap('#soundBtn');
    await D.page.waitForFunction(() => document.getElementById('soundBtn').getAttribute('aria-pressed') === 'false', null, { timeout: 3000 });
    await place(D.page, 0, 128, 0);
    const s0 = await sfx(D.page), p0 = await D.page.evaluate(() => __poseidia.player.z);
    await D.T('touchStart', [{ x: 80, y: 650, id: 3 }]); await D.T('touchMove', [{ x: 80, y: 610, id: 3 }]);
    await D.page.waitForFunction(p0 => Math.abs(__poseidia.player.z - p0) > 4, p0, { timeout: 15000 });   // walked several steps
    await D.T('touchEnd', []);
    ok(await sfx(D.page) === s0, 'sound while muted');
  });
  await t('very slow frames (≥0.1 s, three in a row) drop the resolution to 1x', async () => {
    // (a busy test machine may already have tripped it; then just check the result)
    if (await D.page.evaluate(() => __poseidia.state().pixelRatio) > 1) await D.page.evaluate(() => { const end = performance.now() + 1500; (function f() { const t = performance.now(); while (performance.now() - t < 130); if (performance.now() < end) requestAnimationFrame(f); })(); });
    await D.page.waitForFunction(() => __poseidia.state().degraded, null, { timeout: 10000 });
    ok(await D.page.evaluate(() => __poseidia.state().pixelRatio) === 1);
  });
  await t('no page or console errors in any session', async () => { ok(!allErrors.length, allErrors.slice(0, 3).join(' | ')); });
  await D.ctx.close();
  await browser.close();
  console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed (${Math.round((Date.now() - T0) / 1000)} s)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed:', e.message); process.exit(1); });
