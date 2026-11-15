// 苔原光蛇：上架評分 toFix 的回歸測試（node tests.js，約 40–70 秒）
// Part 1 runs the game's own core (CORE markers): maze layouts, speed presets, beginner-friendly start.
// Part 2 drives the real page (served over local http so localStorage survives reloads) in mobile Chromium with real CDP
// touch (touchEnd releases only the points it lists): resting finger, overlapping two-finger taps, detail-0 click replay
// after a tap, lone detail-0 click, corrupt storage, best/stats saved at the moment of death, tap-to-turn start, d-pad
// spacing, landscape HUD column, quick mute, maze picker, settings scroll hint, speed setting.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + '\nreturn {newGame, step, qDir, interval, tickMs, speedMul, bodyAt, rawNb, flood, MAZES, GN, GW, GH};')();
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.now();

// ---------- core ----------
{
  ok(C.MAZES.length >= 6, 'maze layouts: ' + C.MAZES.length);
  C.MAZES.forEach((M, i) => {
    const G = C.newGame({ mode: 'maze', maze: i, seed: 3 });
    let total = 0; for (let c = 0; c < C.GN; c++) if (!G.blk[c]) total++;
    const reach = C.flood(G, C.bodyAt(G, 0), false, new Uint8Array(C.GN), true);
    let lane = true; for (let y = 5; y <= 15; y++) if (G.blk[y * C.GW + 7]) lane = false;
    ok(reach === total && lane && G.maze === i, `maze ${i}: every open cell connected (${reach}/${total}), start lane clear 7+ cells ahead`);
  });
  const N = C.newGame({ seed: 1 }), Sl = C.newGame({ seed: 1, speed: 'slow' }), F = C.newGame({ seed: 1, speed: 'fast' });
  ok(N.speed === 'normal' && C.interval(N) >= 210, 'default speed starts gently: ' + C.interval(N).toFixed(0) + ' ms/cell (was 160)');
  N.t = 45000; ok(Math.abs(C.interval(N) - C.tickMs(0)) < 0.01, 'default speed reaches the full curve after 45 s');
  ok(C.interval(Sl) > C.interval(C.newGame({ seed: 1 })) && C.interval(F) < C.tickMs(0), `slow ${C.interval(Sl).toFixed(0)} ms > normal; fast ${C.interval(F).toFixed(0)} ms < 160`);
  ok(C.newGame({ seed: 1, speed: 'bogus' }).speed === 'normal', 'unknown speed falls back to normal');
  // beginner protection: 悠閒 steers away from a wall; 標準 does so in the first 30 s, then stops one tick before a crash
  const run = (speed, t0) => { const G = C.newGame({ seed: 5, speed }); G.foods = []; G.goldNext = 1e9; G.t = t0; let n = 0; while (G.alive && n < 40) { const ev = C.step(G); n++; if (ev.die) return { G, n, ev }; } return { G, n }; };
  let r = run('slow', 0); ok(r.G.alive && r.G.assists > 0, '悠閒: heading straight at the wall the snake turns away (' + r.G.assists + ' assists, alive after 40 ticks)');
  r = run('normal', 0); ok(r.G.alive && r.G.assists > 0, '標準 first 30 s: snake turns away from the wall');
  r = run('normal', 60000); ok(!r.G.alive && r.G.stalls === 1 && r.n === 14, '標準 after 30 s: one-tick stop at the wall, then the crash (' + r.n + ' ticks)');
  r = run('fast', 0); ok(!r.G.alive && r.G.stalls === 0 && r.n === 13, '快速: no buffer, crash on tick 13');
  { const G = C.newGame({ seed: 5, speed: 'normal' }); G.foods = []; G.goldNext = 1e9; G.t = 60000; for (let i = 0; i < 12; i++) C.step(G); C.step(G); ok(G.alive && G.stall === 1, 'stalled at the wall'); C.qDir(G, 1); C.step(G); ok(G.alive && G.dir === 1 && G.stall === 0, 'a turn during the stop saves the run'); }
}

// ---------- browser ----------
const srv = http.createServer((q, r) => { if (q.url.split('?')[0] === '/' || q.url.startsWith('/index.html')) { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); } else { r.writeHead(404); r.end(); } });
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/index.html';
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  async function open(o = {}) {
    const ctx = await browser.newContext({ viewport: { width: o.w || 390, height: o.h || 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    if (o.init) await ctx.addInitScript(o.init[0], o.init[1]);
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push((o.tag || '') + ' ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push((o.tag || '') + ' ' + m.text()); });
    await p.goto(URL); await p.waitForFunction(() => window.__game && __game.state() === 'title');
    const cdp = await ctx.newCDPSession(p);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(q => ({ radiusX: 2, radiusY: 2, force: 1, ...q })) });
    return { ctx, p, T };
  }
  const box = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const tap = async (T, x, y, id = 1, hold = 60) => { await T('touchStart', [{ x, y, id }]); await wait(hold); await T('touchEnd', [{ x, y, id }]); };
  const tapSel = async (s, sel, id = 1) => { const c = await box(s.p, sel); await tap(s.T, c.x, c.y, id); };
  const st = p => p.evaluate(() => __game.state());
  const shown = (p, id) => p.evaluate(id => !document.getElementById(id).classList.contains('hidden'), id);
  const until = (p, fn, arg, ms = 4000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
  const sw = (p, k) => p.evaluate(k => document.querySelector(`#settings .sw[data-k="${k}"]`).getAttribute('aria-checked'), k);

  // 1. resting finger: every button still fires on pointerup while another finger rests on the board
  {
    const s = await open({ init: [() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('snakeglide.settings', JSON.stringify({ wrap: true })); sessionStorage.setItem('seeded', 1); } }] }), { p, T } = s, rest = { x: 30, y: 300, id: 9 };
    await T('touchStart', [rest]); await wait(200);
    let c = await box(p, '#tSet'); await T('touchStart', [rest, { x: c.x, y: c.y, id: 2 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 2 }]);
    ok(await until(p, () => !document.getElementById('settings').classList.contains('hidden')), 'resting finger: 設定 opens');
    const w0 = await sw(p, 'wrap'); c = await box(p, '#settings .sw[data-k="wrap"]');
    await T('touchStart', [rest, { x: c.x, y: c.y, id: 3 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 3 }]); await wait(150);
    ok((await sw(p, 'wrap')) !== w0, 'resting finger: switch flips');
    await T('touchStart', [rest, { x: c.x, y: c.y, id: 3 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 3 }]); await wait(150);
    ok((await sw(p, 'wrap')) === w0, 'resting finger: switch flips back on second tap');
    c = await box(p, '#sOk'); await T('touchStart', [rest, { x: c.x, y: c.y, id: 4 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 4 }]); await wait(150);
    c = await box(p, '#mNormal'); await T('touchStart', [rest, { x: c.x, y: c.y, id: 5 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 5 }]);
    ok(await until(p, () => __game.state() === 'ready'), 'resting finger: 開始遊戲 starts a game');
    await T('touchEnd', [rest]); await wait(100);
    // in play: another finger rests on the board, tap pause / 繼續 / pause / 主選單
    await T('touchStart', [{ x: 195, y: 500, id: 6 }]); await wait(20); await T('touchMove', [{ x: 225, y: 500, id: 6 }]); await wait(20);
    ok(await until(p, () => __game.state() === 'play'), 'swipe with the resting finger starts play');
    const r2 = { x: 225, y: 500, id: 6 };
    for (const [sel, want] of [['#bPause', 'pause'], ['#pResume', 'play'], ['#bPause', 'pause'], ['#pHome', 'title']]) {
      await wait(250); c = await box(p, sel); await T('touchStart', [r2, { x: c.x, y: c.y, id: 7 }]); await wait(60); await T('touchEnd', [{ x: c.x, y: c.y, id: 7 }]);
      ok(await until(p, w => __game.state() === w, want), `resting finger: ${sel} -> ${want}`);
    }
    await T('touchEnd', [r2]);
    await s.ctx.close();
  }

  // 2. overlapping two-finger taps on two switches (2nd finger 50 ms later), both lift orders: both flip once
  for (const order of ['first lifts first', 'second lifts first']) {
    const s = await open(), { p, T } = s;
    await tapSel(s, '#tSet'); await until(p, () => !document.getElementById('settings').classList.contains('hidden')); await wait(300);
    const a = await box(p, '#settings .sw[data-k="wrap"]'), b = await box(p, '#settings .sw[data-k="vib"]');
    const w0 = await sw(p, 'wrap'), v0 = await sw(p, 'vib');
    const A = { x: a.x, y: a.y, id: 1 }, B = { x: b.x, y: b.y, id: 2 };
    await T('touchStart', [A]); await wait(50); await T('touchStart', [A, B]); await wait(60);
    if (order === 'first lifts first') { await T('touchEnd', [A]); await wait(40); await T('touchEnd', [B]); } else { await T('touchEnd', [B]); await wait(40); await T('touchEnd', [A]); }
    await wait(900);
    ok((await sw(p, 'wrap')) !== w0 && (await sw(p, 'vib')) !== v0, `overlapping taps (${order}): both switches flipped once`);
    await s.ctx.close();
  }

  // 3. a detail-0 click replayed after a real tap does not run again (centre, edge, elementFromPoint)
  {
    const s = await open(), { p, T } = s;
    await tapSel(s, '#tSet'); await until(p, () => !document.getElementById('settings').classList.contains('hidden')); await wait(300);
    const w0 = await sw(p, 'wrap');
    await tapSel(s, '#settings .sw[data-k="wrap"]'); await wait(50);
    await p.evaluate(() => {
      const el = document.querySelector('#settings .sw[data-k="wrap"]'), r = el.getBoundingClientRect(), mk = () => new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 });
      el.dispatchEvent(mk()); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: r.right - 1, clientY: r.bottom - 1 }));
      const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); e && e.dispatchEvent(mk());
    });
    await wait(100);
    ok((await sw(p, 'wrap')) !== w0, 'detail-0 replay after tapping a switch: switch flipped exactly once');
    await wait(900);
    await tapSel(s, '#sOk'); await wait(900);
    await tapSel(s, '#mNormal'); await until(p, () => __game.state() === 'ready');
    await p.evaluate(() => { window.__g1 = __game.G(); const el = document.getElementById('mNormal'); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(r.left + 20, r.top + 20); e && e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })); });
    await wait(100);
    ok(await p.evaluate(() => window.__g1 === __game.G() && __game.state() === 'ready'), 'detail-0 replay after 開始遊戲: one game, not restarted');
    // a lone detail-0 click (keyboard / screen reader) with no recent tap acts once
    await wait(900);
    await p.evaluate(() => document.getElementById('bPause').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    ok((await st(p)) === 'pause', 'lone detail-0 click (no tap in 800 ms) acts once: pause opens');
    // a tap that changes the screen does not fire the control under the finger on the new screen
    const c = await box(p, '#pHome'); await tap(T, c.x, c.y); await wait(60);
    ok((await st(p)) === 'title' && !(await shown(p, 'settings')) && !(await shown(p, 'stats')), '主選單 tap lands on the title and nothing on it fires');
    ok(await p.evaluate(() => !document.activeElement || document.activeElement === document.body), 'no control took focus from a tap');
    await s.ctx.close();
  }

  // 4. corrupt storage: no error, no NaN, Start and 紀錄 work; valid saves load unchanged
  for (const [k, v] of [['best', 'null'], ['best', '5'], ['best', '[]'], ['ach', 'null'], ['ach', '[]'], ['stats', 'null'], ['stats', '"x"'], ['stats', '{"games":"x","food":null,"sum":-3}'], ['settings', 'null'], ['settings', '{"ctrl":7,"speed":"warp","sound":"no"}']]) {
    const before = errors.length;
    const s = await open({ tag: k + '=' + v, init: [([k, v]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('snakeglide.' + k, v); sessionStorage.setItem('seeded', 1); } }, [k, v]] }), { p } = s;
    await tapSel(s, '#tStats'); await wait(900);
    const txt = await p.evaluate(() => document.getElementById('statsBody').textContent);
    await p.evaluate(() => document.getElementById('stOk').click()); await wait(300);
    await tapSel(s, '#mNormal'); const started = await until(p, () => __game.state() === 'ready');
    await p.evaluate(() => { const G = __game.G(); G.score = 999; }); await wait(100);
    ok(errors.length === before && started && !/NaN|undefined/.test(txt) && !(await p.evaluate(() => /NaN/.test(document.getElementById('hud').textContent))), `corrupt snakeglide.${k}=${v}: no error, no NaN, 紀錄 and 開始遊戲 work`);
    await s.ctx.close();
  }
  {
    const best = { normal: 420, 'classic-w': 90 }, stats = { games: 7, food: 55, moves: 900, sum: 1200, ptrips: 3, bestLen: 33 }, ach = { len50: 1700000000000 };
    const s = await open({ init: [([b, st, a]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('snakeglide.best', b); localStorage.setItem('snakeglide.stats', st); localStorage.setItem('snakeglide.ach', a); sessionStorage.setItem('seeded', 1); } }, [JSON.stringify(best), JSON.stringify(stats), JSON.stringify(ach)]] }), { p } = s;
    const got = await p.evaluate(() => [document.querySelector('[data-best="normal"]').textContent, localStorage.getItem('snakeglide.stats')]);
    await tapSel(s, '#tStats'); await wait(200);
    const txt = await p.evaluate(() => document.getElementById('statsBody').textContent);
    ok(got[0] === '最高 420' && /遊玩局數7/.test(txt) && /最長蛇身33/.test(txt) && /★長度 50/.test(txt), 'valid saves load unchanged (best 420, 7 games, achievement kept)');
    await s.ctx.close();
  }

  // 5. best and stats are saved the moment the snake dies: reload within 300 ms keeps them
  {
    const s = await open(), { p, T } = s;
    await p.evaluate(() => { localStorage.removeItem('snakeglide.best'); localStorage.removeItem('snakeglide.stats'); });
    await tapSel(s, '#mNormal'); await until(p, () => __game.state() === 'ready');
    await tap(T, 195, 600); // a tap is not a swipe: still ready
    await p.evaluate(() => { const G = __game.G(); G.score = 52; });
    await T('touchStart', [{ x: 195, y: 600, id: 1 }]); await wait(20); await T('touchMove', [{ x: 195, y: 560, id: 1 }]); await wait(20); await T('touchEnd', [{ x: 195, y: 560, id: 1 }]);
    await p.evaluate(() => { const G = __game.G(); G.score = 52; G.foods = []; G.t = 60000; G.goldNext = 1e9; });
    ok(await until(p, () => __game.state() === 'dead', null, 8000), 'snake hits the wall');
    await wait(150); await p.reload(); await p.waitForFunction(() => window.__game && __game.state() === 'title');
    const r = await p.evaluate(() => [JSON.parse(localStorage.getItem('snakeglide.best') || '{}').normal, JSON.parse(localStorage.getItem('snakeglide.stats') || '{}').games, document.querySelector('[data-best="normal"]').textContent]);
    ok(r[0] === 52 && r[1] === 1 && r[2] === '最高 52', 'reload 150 ms after death keeps best 52 and 1 game: ' + JSON.stringify(r));
    await s.ctx.close();
  }

  // 6. tap-to-turn: the tap that starts the run does not turn; later taps do. Quick mute in the HUD.
  {
    const s = await open({ init: [() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('snakeglide.settings', JSON.stringify({ ctrl: 'tap', wrap: true })); sessionStorage.setItem('seeded', 1); } }] }), { p, T } = s;
    await tapSel(s, '#mNormal'); await until(p, () => __game.state() === 'ready'); await wait(300);
    await tap(T, 300, 500); await wait(30);
    const a = await p.evaluate(() => ({ st: __game.state(), dir: __game.G().dir, q: __game.G().q.length }));
    ok(a.st === 'play' && a.dir === 0 && a.q === 0, 'tap-to-turn: starting tap does not turn ' + JSON.stringify(a));
    await tap(T, 300, 500); await until(p, () => __game.G().dir === 1, null, 1500);
    ok(await p.evaluate(() => __game.G().dir === 1), 'tap-to-turn: next tap on the right half turns right');
    const m0 = await p.evaluate(() => JSON.parse(localStorage.getItem('snakeglide.settings')).sound !== false);
    await tapSel(s, '#bMute'); await wait(100);
    const m1 = await p.evaluate(() => [JSON.parse(localStorage.getItem('snakeglide.settings')).sound, __game.state(), document.getElementById('bMute').getAttribute('aria-label')]);
    ok(m0 && m1[0] === false && m1[1] === 'play' && m1[2] === '開啟音效', 'quick mute during play mutes without pausing ' + JSON.stringify(m1));
    await s.ctx.close();
  }

  // 7. d-pad buttons do not overlap and still steer per finger on pointerdown
  {
    const s = await open({ init: [() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('snakeglide.settings', JSON.stringify({ ctrl: 'pad', wrap: true })); sessionStorage.setItem('seeded', 1); } }] }), { p, T } = s;
    await tapSel(s, '#mNormal'); await until(p, () => __game.state() === 'ready'); await wait(200);
    const rs = await p.evaluate(() => [...document.querySelectorAll('.dpad button')].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }));
    let ov = 0; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const A = rs[i], B = rs[j]; if (Math.min(A[2], B[2]) - Math.max(A[0], B[0]) > 0.5 && Math.min(A[3], B[3]) - Math.max(A[1], B[1]) > 0.5) ov++; }
    ok(ov === 0, 'd-pad: no two buttons overlap');
    const r = await box(p, '.dpad .r'), u = await box(p, '.dpad .u');
    await T('touchStart', [{ x: r.x, y: r.y, id: 1 }]); await wait(30);
    ok(await until(p, () => __game.state() === 'play' && (__game.G().dir === 1 || __game.G().q[0] === 1), null, 1000), 'd-pad right starts and turns');
    await T('touchStart', [{ x: r.x, y: r.y, id: 1 }, { x: u.x, y: u.y, id: 2 }]); await wait(30);
    ok(await until(p, () => __game.G().dir === 0 || __game.G().q.includes(0), null, 1500), 'd-pad up with another finger still on right turns up');
    await T('touchEnd', [{ x: r.x, y: r.y, id: 1 }, { x: u.x, y: u.y, id: 2 }]);
    await s.ctx.close();
  }

  // 8. landscape 844x390: HUD in a side column, board as tall as the screen allows
  {
    const s = await open({ w: 844, h: 390 }), { p } = s;
    await tapSel(s, '#mNormal'); await until(p, () => __game.state() === 'ready'); await wait(300);
    const L = await p.evaluate(() => { const h = document.querySelector('#hud .hcard').getBoundingClientRect(), G = __game; return { hudR: h.right, hudB: h.bottom, cs: window.CS, bx: window.BX, by: window.BY }; });
    ok(L.cs >= 14 && L.bx >= L.hudR && L.hudB <= 390, 'landscape: cell ' + L.cs + ' px (was 11), board right of the HUD column ' + JSON.stringify(L));
    await s.ctx.close();
  }

  // 9. maze picker: choose a layout, or random
  {
    const s = await open(), { p } = s;
    await tapSel(s, '#mMaze'); await until(p, () => !document.getElementById('mazePick').classList.contains('hidden')); await wait(300);
    ok(await p.evaluate(() => document.querySelectorAll('#mazeList .mz').length >= 6), 'maze picker lists 6 layouts');
    await tapSel(s, '#mz4'); await until(p, () => __game.state() === 'ready');
    ok(await p.evaluate(() => __game.G().mode === 'maze' && __game.G().maze === 4), 'chosen maze 4 is played');
    await s.ctx.close();
  }

  // 10. settings at 360x640: "scroll for more" hint until the list is scrolled down; speed setting is applied
  {
    const s = await open({ w: 360, h: 640 }), { p } = s;
    await tapSel(s, '#tSet'); await until(p, () => !document.getElementById('settings').classList.contains('hidden')); await wait(400);
    const h0 = await p.evaluate(() => !document.getElementById('setMore').classList.contains('off'));
    await p.evaluate(() => { const b = document.querySelector('#settings .set'); b.scrollTop = b.scrollHeight; const c = document.getElementById('settings'); c.scrollTop = c.scrollHeight; });
    const h1 = await until(p, () => document.getElementById('setMore').classList.contains('off'), null, 1500);
    ok(h0 && h1, 'settings 360x640: scroll hint shown, hidden at the bottom');
    await p.evaluate(() => { const b = document.querySelector('#settings .set'); b.scrollTop = 0; }); await wait(200);
    await tapSel(s, '#settings .seg[data-k="speed"] [data-v="slow"]'); await wait(900);
    await tapSel(s, '#sOk'); await wait(900);
    await tapSel(s, '#mClassic'); await until(p, () => __game.state() === 'ready');
    ok(await p.evaluate(() => __game.G().speed === 'slow' && __game.core.interval(__game.G()) > 220), 'speed 悠閒 is used by the next game');
    await s.ctx.close();
  }

  ok(errors.length === 0, 'no page / console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close(); srv.close();
  console.log(`${fails ? 'FAILED ' + fails : 'all passed'} in ${((Date.now() - T0) / 1000).toFixed(0)} s`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
