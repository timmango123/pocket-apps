// Regression tests for 星塊落陣 (falling-blocks): core rules in Node, then the page in Chromium with real CDP touch.
// Each block maps to a release-review finding (qa/release/falling-blocks/score.json, 2026-11-01).
// Usage: node tests.js   (about 30-60 s; waits on conditions, never on frame timing)
const fs = require('fs'), path = require('path'), http = require('http');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {makeGame, SHAPES, gravityMs, lockDelayMs, garbageChance, garbageEvery, GARB_WARN, COLS, ROWS, HID, CLEAR_MS};')();
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('FAIL  ', name, '-', String(e.message || e).slice(0, 300)); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms; let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch (e) {} await sleep(40); }
  throw new Error('timed out waiting for ' + what + ' (last ' + JSON.stringify(v) + ')');
}

(async () => {
  console.log('Core');
  await t('difficulty keeps rising past L20 (gravity) and L30 (lock delay)', () => {
    for (let L = 2; L <= 80; L++) ok(C.gravityMs(L) <= C.gravityMs(L - 1) + 1e-9 && C.lockDelayMs(L) <= C.lockDelayMs(L - 1), 'monotone at ' + L);
    ok(C.gravityMs(30) < C.gravityMs(20) - 10 && C.gravityMs(42) < C.gravityMs(30), 'gravity past L20 ' + [20, 30, 42].map(C.gravityMs));
    ok(C.lockDelayMs(30) === 300 && C.lockDelayMs(40) < 300 && C.lockDelayMs(45) === 180, 'lock delay ' + [30, 40, 45].map(C.lockDelayMs));
    ok(C.garbageEvery(25) < C.garbageEvery(15) && C.garbageEvery(45) < C.garbageEvery(35), 'star-dust beat speeds up');
  });
  await t('star-dust rows rise on a fixed beat (no 25% coin flip) with a 1 s warning first', () => {
    // no gravity (zen) so nothing tops out; star-dust forced on at level 15
    const g = C.makeGame({ mode: 'marathon', zen: true, garbage: true, level: 15, seed: 3 }); g.start();
    let warned = false, at = -1;
    for (let i = 0; i < 31000 / 10 && at < 0; i++) {
      if (g.garbIn() <= C.GARB_WARN && g.st.garbage === 0) warned = true;
      g.update(10); if (g.st.garbage > 0) at = g.time;
    }
    ok(warned, 'warning window seen');
    ok(at >= 29990 && at <= 30020, 'first row at ' + at);
    ok(C.makeGame({ mode: 'sprint', garbage: false }).garbIn() === Infinity, 'no warning when star-dust is off');
  });
  await t('unseeded games get different star-dust gaps; a seeded game repeats them', () => {
    const gaps = seed => { const g = C.makeGame(seed == null ? { mode: 'zen', zen: true } : { mode: 'zen', zen: true, seed }); g.start(); const out = [];
      for (let k = 0; k < 8; k++) { g.addGarbage(); const row = g.board.subarray((C.ROWS - 1) * C.COLS); out.push(row.indexOf(0)); } return out.join(','); };
    ok(gaps() !== gaps() || gaps() !== gaps(), 'unseeded gaps repeat');
    ok(gaps(77) === gaps(77), 'seeded gaps differ');
  });
  await t('help text documents the 0-line T-spin bonus and the star-dust schedule', () => {
    ok(/沒消行的星旋也有 400 × 等級/.test(html), 'T-spin zero');
    ok(/升起前 1 秒/.test(html), 'warning text');
    const g = C.makeGame({ mode: 'zen', zen: true, seed: 1 }); ok(typeof g.garbIn === 'function');
  });
  await t('downward swipe has one speed threshold for soft vs hard drop (no dead band)', () => {
    ok(/sp < FLICK_V/.test(html) && /vel\(p\) >= FLICK_V/.test(html), 'shared FLICK_V');
    ok(/!p\.axis && dist < AXIS_PX/.test(html) && !/dur < 180/.test(html), 'tap = never reached the drag threshold, any duration');
  });

  console.log('Page');
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(APP)); });
  await new Promise(res => server.listen(0, '127.0.0.1', res)); server.unref();
  const URL = 'http://127.0.0.1:' + server.address().port + '/';
  const errors = [];
  async function open(w, h, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: opts.scheme || 'dark' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    if (opts.init) await page.addInitScript(opts.init, opts.arg);
    await page.goto(URL);
    await waitFor(() => page.evaluate(() => !!window.__fb), 'page');
    const cdp = await ctx.newCDPSession(page);
    const f = {};
    const pts = () => Object.entries(f).map(([id, p]) => ({ x: p.x, y: p.y, id: +id }));
    const T = {
      down: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts() }); },
      move: async (id, x, y) => { f[id] = { x, y }; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts() }); },
      up: async id => { const p = f[id]; delete f[id]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: p.x, y: p.y, id: +id }] }); },
    };
    T.tap = async (x, y, id = 9, hold = 40) => { await T.down(id, x, y); await sleep(hold); await T.up(id); };
    const snap = () => page.evaluate(() => window.__fb.snap());
    const state = () => page.evaluate(() => window.__fb.snap(true).state);
    const acts = () => page.evaluate(() => window.__fb.acts());
    return { ctx, page, T, snap, state, acts };
  }
  const skipCoach = () => { try { localStorage.setItem('fblocks.coach', 'true'); } catch (e) {} };
  const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.classList.contains('hidden') && e.getBoundingClientRect().height > 0; }, sel);
  const tapEl = async (P, sel) => { const b = await P.page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, sel); await P.T.tap(b.x, b.y); };
  // hard-drop with the keyboard until the score is > 0 and the run has been saved
  async function scoreSome(P, n = 3) {
    for (let i = 0; i < n; i++) {
      const pid = (await P.snap()).pieceId;
      await P.page.keyboard.press(' ');
      await waitFor(async () => { const s = await P.snap(); return s.pieceId !== pid || s.state !== 'play'; }, 'next piece ' + JSON.stringify(await P.page.evaluate(() => [window.__fb.snap(true), window.__fb.acts(), document.activeElement.tagName])));
    }
    return (await P.snap()).score;
  }

  try {
    await t('first game shows the gesture map over the board; a tap starts play; never shown again', async () => {
      const P = await open(390, 844);
      await tapEl(P, '#tPlay');
      await waitFor(() => visible(P.page, '#coach'), 'coach');
      ok(await P.state() === 'coach', 'game waits while the coach is up');
      const r = await P.page.evaluate(() => { const w = document.getElementById('coachWell').getBoundingClientRect(), l = window.__fb.snap().layout; return [w.left, w.top, w.width, w.height, l.wx, l.wy, l.ww, l.wh]; });
      ok(Math.abs(r[0] - r[4]) < 2 && Math.abs(r[1] - r[5]) < 2 && Math.abs(r[2] - r[6]) < 2, 'coach drawn on the board ' + r);
      const a0 = await P.acts();
      await P.T.tap(200, 500);
      await waitFor(async () => await P.state() === 'play', 'play after coach');
      const a1 = await P.acts(); ok(!a1.cw && !a1.ccw && !a0.cw, 'the dismissing tap does not rotate');
      await P.page.reload(); await waitFor(() => P.page.evaluate(() => !!window.__fb), 'reload');
      await tapEl(P, '#tResume'); await waitFor(async () => await P.state() === 'pause', 'resumed paused');
      await tapEl(P, '#pQuit'); await tapEl(P, '#pQuit'); await waitFor(async () => await P.state() === 'title', 'title');
      await tapEl(P, '#tPlay'); await waitFor(async () => await P.state() === 'play', 'second game starts directly');
      ok(!(await visible(P.page, '#coach')), 'coach shown twice');
      await P.ctx.close();
    });

    const Z = await open(390, 844, { init: skipCoach });
    await tapEl(Z, '.mb[data-mode="zen"]');
    await waitFor(async () => await Z.state() === 'play', 'zen play');
    const lay = (await Z.snap()).layout, left = [lay.wx + lay.ww * 0.25, lay.wy + lay.wh * 0.55], right = [lay.wx + lay.ww * 0.75, lay.wy + lay.wh * 0.55];
    const rotN = async () => { const a = await Z.acts(); return (a.cw || 0) + (a.ccw || 0); };
    await t('two-thumb overlap: the second finger is not swallowed (probe-tap overlap)', async () => {
      for (let i = 0; i < 4; i++) {
        const a0 = await Z.acts();
        await Z.T.down(1, ...left); await sleep(60); await Z.T.down(2, ...right); await sleep(40); await Z.T.up(1); await sleep(60); await Z.T.up(2);
        await waitFor(async () => { const a = await Z.acts(); return (a.ccw || 0) - (a0.ccw || 0) === 1 && (a.cw || 0) - (a0.cw || 0) === 1; }, 'both rotations, round ' + i);
      }
    });
    await t('slow taps (held 200-600 ms) still rotate (probe-tap hold150/200, gestSlow190/230)', async () => {
      for (const hold of [200, 350, 600]) { const n0 = await rotN(); await Z.T.tap(...right, 9, hold); await waitFor(async () => await rotN() === n0 + 1, 'rotation after ' + hold + ' ms hold'); }
    });
    await t('a tap that wobbles 11 px still rotates (gestWobble11)', async () => {
      const n0 = await rotN();
      await Z.T.down(3, ...right); await Z.T.move(3, right[0] + 6, right[1] + 4); await Z.T.move(3, right[0] + 9, right[1] + 6); await sleep(30); await Z.T.up(3);
      await waitFor(async () => await rotN() === n0 + 1, 'wobbly tap rotation');
    });
    await t('8 alternating taps, each held 150 ms, all arrive exactly once', async () => {
      const n0 = await rotN();
      for (let i = 0; i < 8; i++) await Z.T.tap(...(i % 2 ? right : left), 10 + i, 150);
      await waitFor(async () => await rotN() === n0 + 8, '8 rotations');
      await sleep(200); ok(await rotN() === n0 + 8, 'no double count');
    });
    await t('restart from pause needs a second tap', async () => {
      await scoreSome(Z, 2);
      await tapEl(Z, '#bPause'); await waitFor(async () => await Z.state() === 'pause', 'pause');
      const pieces = (await Z.snap()).full.pieces;
      await tapEl(Z, '#pRestart');
      ok(await Z.state() === 'pause' && (await Z.snap()).full.pieces === pieces, 'one tap restarted the game');
      ok(/確認/.test(await Z.page.textContent('#pRestart')), 'asks for confirmation');
      await tapEl(Z, '#pRestart');
      await waitFor(async () => { const s = await Z.snap(); return s.state === 'play' && s.full.pieces === 0; }, 'restarted');
    });
    await Z.ctx.close();

    await t('game in progress survives a reload, best score is kept, resume needs no redo (persist.midGameAfterReload)', async () => {
      const P = await open(390, 844, { init: skipCoach });
      await tapEl(P, '#tPlay'); await waitFor(async () => await P.state() === 'play', 'play');
      const sc = await scoreSome(P, 3); ok(sc > 0, 'scored');
      const pieces = (await P.snap()).full.pieces;
      await waitFor(() => P.page.evaluate(p => { const r = JSON.parse(localStorage.getItem('fblocks.run') || 'null'); return r && r.g.pieces >= p && +localStorage.getItem('fblocks.best') > 0; }, pieces), 'saved on lock');
      await P.page.reload(); await waitFor(() => P.page.evaluate(() => !!window.__fb), 'reload');
      ok(await visible(P.page, '#tResume'), 'title offers 繼續上一局');
      const best = await P.page.textContent('#tBest'); ok(/無盡最高 [1-9]/.test(best), 'best kept: ' + best);
      await tapEl(P, '#tResume');
      await waitFor(async () => await P.state() === 'pause', 'resumes into pause');
      const s = await P.snap(); ok(s.full.pieces === pieces && s.score >= sc, 'same game ' + s.score + '/' + sc);
      await tapEl(P, '#pResume'); await waitFor(async () => await P.state() === 'play', 'play');
      // quitting keeps the score as best and clears the saved run
      const sc2 = await scoreSome(P, 2);
      await tapEl(P, '#bPause'); await tapEl(P, '#pQuit'); ok(await P.state() === 'pause', 'quit needs confirm'); await tapEl(P, '#pQuit');
      await waitFor(async () => await P.state() === 'title', 'title');
      const b2 = await P.page.evaluate(() => +localStorage.getItem('fblocks.best'));
      ok(b2 >= sc2, 'best after quit ' + b2 + ' < ' + sc2);
      ok(!(await visible(P.page, '#tResume')) && !(await P.page.evaluate(() => localStorage.getItem('fblocks.run'))), 'run cleared after quit');
      await P.ctx.close();
    });

    await t('starting a new game over an unfinished one asks first', async () => {
      const P = await open(390, 844, { init: skipCoach });
      await tapEl(P, '#tPlay'); await waitFor(async () => await P.state() === 'play', 'play');
      await scoreSome(P, 2);
      const pieces = (await P.snap()).full.pieces;
      await P.page.reload(); await waitFor(() => P.page.evaluate(() => !!window.__fb), 'reload');
      await tapEl(P, '.mb[data-mode="sprint"]');
      await waitFor(() => visible(P.page, '#confirm'), 'confirm');
      ok(await P.state() === 'title', 'did not start yet');
      await tapEl(P, '#cKeep'); await waitFor(async () => await P.state() === 'pause', 'kept old game');
      ok((await P.snap()).full.pieces === pieces, 'old game resumed');
      await P.ctx.close();
    });

    await t('records, stats and history are saved when the game ends, before the result animation', async () => {
      const P = await open(390, 844, { init: skipCoach });
      await tapEl(P, '#tPlay'); await waitFor(async () => await P.state() === 'play', 'play');
      for (let i = 0; i < 80 && await P.state() === 'play'; i++) {
        const pid = (await P.snap()).pieceId; await P.page.keyboard.press(' ');
        await waitFor(async () => { const s = await P.snap(); return s.pieceId !== pid || s.state !== 'play'; }, 'piece');
      }
      const st = await P.state(); ok(st === 'dying' || st === 'result', 'game over ' + st);
      const r = await P.page.evaluate(() => [JSON.parse(localStorage.getItem('fblocks.records')), localStorage.getItem('fblocks.run')]);
      ok(r[0].games === 1 && r[0].stats.marathon.games === 1 && r[0].hist.marathon.length === 1 && r[1] === null, JSON.stringify(r).slice(0, 200));
      await waitFor(async () => await P.state() === 'result', 'result', 10000);
      ok(/已玩 1 局/.test(await P.page.textContent('#rHist')), 'history line on the result');
      await P.ctx.close();
    });

    await t('settings: segmented buttons and sliders are at least 44 px tall', async () => {
      const P = await open(390, 844, { init: skipCoach });
      await tapEl(P, '#tSet'); await waitFor(() => visible(P.page, '#settings'), 'settings');
      const hs = await P.page.evaluate(() => [...document.querySelectorAll('#settings .seg button, #settings input[type=range], #settings .sw')].map(e => e.offsetHeight));
      ok(hs.every(h => h >= 44), 'heights ' + hs);
      await P.ctx.close();
    });

    await t('landscape 844x390: sound and vibration switches visible without scrolling the settings card', async () => {
      const P = await open(844, 390, { init: skipCoach });
      await tapEl(P, '#tSet'); await waitFor(() => visible(P.page, '#settings'), 'settings');
      const r = await P.page.evaluate(() => ['sSnd', 'sVib', 'sDone'].map(id => document.getElementById(id).getBoundingClientRect().bottom));
      ok(r.every(b => b <= 390), 'bottoms ' + r);
      await P.ctx.close();
    });

    await t('board uses the height of tall phones; lobby 375x500 button mode keeps >= 16 px cells', async () => {
      for (const [w, h, ctl, min] of [[390, 844, 'gesture', 620], [430, 932, 'gesture', 700], [375, 500, 'buttons', 320], [360, 640, 'buttons', 400]]) {
        const P = await open(w, h, { init: c => { try { localStorage.setItem('fblocks.coach', 'true'); localStorage.setItem('fblocks.settings', JSON.stringify({ ctl: c })); } catch (e) {} }, arg: ctl });
        await P.page.evaluate(c => { const s = JSON.parse(localStorage.getItem('fblocks.settings')); if (s.ctl !== c) throw 0; }, ctl);
        await tapEl(P, '#tPlay'); await waitFor(async () => await P.state() === 'play', 'play');
        const l = (await P.snap()).layout;
        ok(l.wh >= min && l.cell >= 16, `${w}x${h} ${ctl}: board ${l.ww}x${l.wh}`);
        const over = await P.page.evaluate(() => { const b = [...document.querySelectorAll('.cb')].map(e => e.getBoundingClientRect()); return b.filter(r => r.width && (r.width < 44 || r.height < 44 || r.right > innerWidth + 0.5)).length; });
        ok(over === 0, 'buttons under 44 px or cut off');
        await P.ctx.close();
      }
    });

    await t('light mode: piece colours have more contrast; the next queue is not faded', () => {
      const pal = html.match(/const PAL_L = \[([^\]]+)\]/)[1].match(/#[0-9a-f]{6}/g);
      const lum = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
      const cr = h => (lum('#fffbf4') + 0.05) / (lum(h) + 0.05);
      ok(pal.slice(0, 7).every(c => cr(c) >= 2.1), 'contrast ' + pal.slice(0, 7).map(c => cr(c).toFixed(2)));
      ok(/i === 0 \? 1 : 1 - i \* 0\.04/.test(html), 'next queue alpha');
    });

    await t('score popups and level banner avoid the spawn rows and the falling piece', async () => {
      const P = await open(390, 844, { init: skipCoach });
      await tapEl(P, '.mb[data-mode="zen"]'); await waitFor(async () => await P.state() === 'play', 'play');
      const res = await P.page.evaluate(() => {
        const l = window.__fb.snap().layout, c = window.__fb.snap().cur, y = freeY(80);
        return { y, top: l.wy + l.cell * 3, pieceBottom: l.wy + (c.y + 2 - 2) * l.cell };
      });
      ok(res.y - 40 >= res.top && res.y - 40 >= res.pieceBottom, JSON.stringify(res));
      ok(/if \(t > 1\.4\)/.test(html) && /POP_T = 1\.0/.test(html), 'shorter on-board text');
      await P.ctx.close();
    });

    await t('no page or console errors', () => { ok(!errors.length, errors.slice(0, 3).join(' | ')); });
  } finally {
    await browser.close();
  }
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
