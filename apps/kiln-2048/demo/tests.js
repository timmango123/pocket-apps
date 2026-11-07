// Regression tests for 窯變 2048, run in headless Chromium against ../index.html (offline: every non-local request is aborted).
// One check per release-review finding: two-finger swipes, text/tap-target fit at phone + lobby + landscape sizes,
// no network, sound + mute, save on every move, daily first-game-counts + share, 3×3 target, stats, hint, new-game confirm,
// record wording, tier names past 4096, legacy save keys. Usage: node tests.js
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const body = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + html + '</body></html>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message.split('\n')[0]); } }
const errors = [], external = [];
const INIT = () => {
  window.claude = { hot: { snapshot(fn) { window.__save = fn; } } };
  window.__osc = 0;
  const AC = window.AudioContext;
  if (AC) { const o = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__osc++; return o.call(this); }; }
};
const G = { undosLeft: 3, history: [], won: false, keepGoing: false, timeLeft: 0, stepsLeft: 0, started: true, over: false, stones: [], seed: 0, skin: 'kiln' };

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(q.url.startsWith('/blank') ? '<p>' : body); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  async function open(w, h, setup, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: o.dark ? 'dark' : 'light' });
    await ctx.addInitScript(INIT);
    await ctx.route(u => !u.href.startsWith(base), r => { external.push(r.request().url()); r.abort('internetdisconnected'); });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${w}x${h} ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${w}x${h} console ${m.text()}`); });
    if (setup) { await page.goto(base + 'blank'); await page.evaluate(setup.fn, setup.arg); }
    await page.goto(base); await page.waitForSelector('#board .tile');
    return { ctx, page };
  }
  const setGame = (id, game, extra) => ({ fn: ([id, g, x]) => { localStorage.setItem('kiln2048-mode', id); if (g) localStorage.setItem('kiln2048-game-' + id, JSON.stringify(g)); Object.entries(x || {}).forEach(([k, v]) => localStorage.setItem(k, v)); }, arg: [id, game, extra] });
  const S = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__save())));
  const stored = (page, id) => page.evaluate(id => JSON.parse(localStorage.getItem('kiln2048-game-' + id)), id);

  console.log('Layout (phone, lobby iframe and landscape sizes)');
  const geom = page => page.evaluate(() => {
    const vis = e => e.offsetParent && e.getBoundingClientRect().width > 0;
    const clip = [...document.querySelectorAll('h1, .title, .score, .bar p, .modes button, .modes small, .skins button, .ladder-cap span, .face, .overlay button')].filter(vis)
      .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent.trim().slice(0, 10));
    const btns = [...document.querySelectorAll('button')].filter(vis).map(b => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim().slice(0, 6) || b.id, r }; });
    const bd = document.getElementById('board').getBoundingClientRect(), se = document.scrollingElement;
    return { ox: se.scrollWidth - innerWidth, clip, small: btns.filter(b => b.r.width < 43.5 || b.r.height < 43.5).map(b => b.t),
      outside: btns.filter(b => b.r.left < 0 || b.r.right > innerWidth + .5 || b.r.top < 0 || b.r.bottom > innerHeight + .5).map(b => b.t),
      board: { l: bd.left, t: bd.top, r: bd.right, b: bd.bottom, w: bd.width }, inView: bd.top >= 0 && bd.bottom <= innerHeight + .5 && bd.left >= 0 && bd.right <= innerWidth + .5,
      h1: document.querySelector('h1').getBoundingClientRect().height, modes: document.getElementById('modes').getBoundingClientRect(),
      em: Math.min(...[...document.querySelectorAll('.tile:not(.stone) .face em')].map(e => parseFloat(getComputedStyle(e).fontSize))) };
  });
  for (const [w, h, mode, dark] of [[360, 640, 'timed'], [375, 500, 'daily'], [390, 610, 'classic'], [430, 740, 'large'], [360, 780, 'timed', 1], [390, 844, 'large'], [844, 390, 'timed'], [667, 375, 'daily', 1]]) {
    await t(`${w}x${h} ${mode}: nothing cut off, all buttons ≥44 px and on screen, board fully visible`, async () => {
      const { ctx, page } = await open(w, h, setGame(mode), { dark });
      const g = await geom(page);
      ok(g.ox <= 0, 'horizontal overflow ' + g.ox); ok(!g.clip.length, 'clipped: ' + g.clip); ok(!g.small.length, 'small: ' + g.small);
      ok(!g.outside.length, 'off screen: ' + g.outside); ok(g.inView, 'board not fully visible ' + JSON.stringify(g.board));
      ok(g.board.w >= 280, 'board too small ' + g.board.w);
      ok(g.em >= 10, '5×5 tier names too small ' + g.em);
      if (w > h) { ok(g.h1 < 70, 'title wraps in landscape ' + g.h1); ok(g.board.l >= g.modes.right - 1 || g.modes.width === 0, 'landscape board not beside controls'); }
      // mode & theme sheet opens, fits, and switching a mode from it works
      await page.click('#menu');
      await page.waitForSelector('#sheet:not([hidden])');
      const s = await geom(page);
      ok(!s.clip.length, 'sheet clipped: ' + s.clip); ok(!s.small.length, 'sheet small: ' + s.small); ok(!s.outside.length, 'sheet off screen: ' + s.outside);
      await page.click('#sheet [data-mode="small"]');
      ok(await page.evaluate(() => document.getElementById('sheet').hidden), 'sheet stays open after picking a mode');
      ok((await S(page)).mode === 'small', 'mode not switched from sheet');
      await ctx.close();
    });
  }

  await t('header: title, mode pill and score boxes never overlap (long themes, 5–6 digit scores, small portrait + landscape)', async () => {
    const bad = [];
    for (const [w, h] of [[360, 640], [360, 780], [375, 667], [667, 375], [740, 360]]) {
      const { ctx, page } = await open(w, h);
      for (const skin of ['kiln', 'candy', 'gems']) for (const sc of [31492, 123456]) {
        await page.goto(base + 'blank');
        await page.evaluate(([skin, sc]) => { localStorage.clear(); localStorage.setItem('kiln2048-skin', skin); localStorage.setItem('kiln2048-best-classic', String(sc)); localStorage.setItem('kiln2048-mode', 'classic');
          localStorage.setItem('kiln2048-game-classic', JSON.stringify({ mode: 'classic', cells: [[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]], stones: [], score: sc, undosLeft: 3, history: [], won: false, keepGoing: false, timeLeft: 0, stepsLeft: 0, started: true, over: false, seed: 0 })); }, [skin, sc]);
        await page.goto(base); await page.waitForSelector('#board .tile');
        const r = await page.evaluate(() => {
          const sb = document.querySelector('.scores').getBoundingClientRect(), mu = document.getElementById('mute').getBoundingClientRect(); let worst = 0;
          for (const e of [...document.querySelectorAll('#skinName,#skinSub,#modeSub')].filter(e => getComputedStyle(e).display !== 'none')) {
            const rg = document.createRange(); rg.selectNodeContents(e); const q = rg.getBoundingClientRect();
            if (q.width && q.right - sb.left > 0.5 && q.bottom > sb.top && q.top < sb.bottom) worst = Math.max(worst, q.right - sb.left);
          }
          const scoreClip = [...document.querySelectorAll('.score')].some(e => e.scrollWidth > e.clientWidth + 1);
          return { worst, scoreClip, sbOverMute: sb.right > mu.left + 0.5 && sb.bottom > mu.top && sb.top < mu.bottom, muteOff: mu.right > innerWidth };
        });
        if (r.worst || r.scoreClip || r.sbOverMute || r.muteOff) bad.push(`${w}x${h} ${skin} ${sc} ${JSON.stringify(r)}`);
      }
      await ctx.close();
    }
    ok(!bad.length, bad.slice(0, 3).join('; '));
  });

  const P = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 4, 0, 4]], score: 0 }));
  const page = P.page, cdp = await P.ctx.newCDPSession(page);
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const bc = await page.evaluate(() => { const r = document.getElementById('board').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });

  console.log('Touch');
  const LEFTABLE = [[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 4, 0, 4]];
  const slideLeft = c => c.map(r => { const v = r.filter(Boolean), o = []; for (let i = 0; i < v.length; i++) { if (v[i] === v[i + 1]) { o.push(v[i] * 2); i++; } else o.push(v[i]); } while (o.length < r.length) o.push(0); return o; });
  const leftApplied = (before, after) => { const p = slideLeft(before); let d = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (p[r][c] !== after[r][c]) { if (p[r][c] !== 0) return false; d++; } return d === 1; };
  const reset = async () => { // fresh board that can move left, through the app's own save/restore path
    await page.goto(base + 'blank');
    await page.evaluate(g => localStorage.setItem('kiln2048-game-classic', JSON.stringify(g)), { ...G, mode: 'classic', cells: LEFTABLE, score: 0 });
    await page.goto(base); await page.waitForSelector('#board .tile');
  };
  // Chromium's Input.dispatchTouchEvent: a touchEnd lists the finger(s) being lifted; an empty touchEnd lifts the rest
  await t('two fingers: first finger swipes while the second is held; lifting the second, then the first, still moves the board (6/6)', async () => {
    for (let k = 0; k < 6; k++) {
      await reset(); const [x, y] = bc; const s0 = await S(page);
      await T('touchStart', [{ x: x - 60, y, id: 1 }]); await T('touchStart', [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }]);
      for (let i = 1; i <= 4; i++) await T('touchMove', [{ x: x - 60 - 15 * i, y, id: 1 }, { x: x + 60, y, id: 2 }]);
      await T('touchEnd', [{ x: x + 60, y, id: 2 }]);   // second finger (not moved) lifts
      await T('touchEnd', []);                           // first finger lifts after its left swipe
      ok(leftApplied(s0.cells, (await S(page)).cells), `run ${k}: first finger's swipe was dropped`);
    }
  });
  await t('two fingers: first finger swipes and lifts while the second is held; then the second swipes too = two moves (4/4)', async () => {
    for (let k = 0; k < 4; k++) {
      await reset(); const [x, y] = bc; const s0 = await S(page);
      await T('touchStart', [{ x: x - 60, y, id: 1 }]); await T('touchStart', [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }]);
      for (let i = 1; i <= 4; i++) await T('touchMove', [{ x: x - 60 - 15 * i, y, id: 1 }, { x: x + 60, y, id: 2 }]);
      await T('touchEnd', [{ x: x - 120, y, id: 1 }]);  // first finger lifts, second still down
      const mid = await S(page); ok(leftApplied(s0.cells, mid.cells), `run ${k}: first finger's swipe dropped`);
      for (let i = 1; i <= 4; i++) await T('touchMove', [{ x: x + 60, y: y + 15 * i, id: 2 }]);
      await T('touchEnd', []);
      ok(JSON.stringify((await S(page)).cells) !== JSON.stringify(mid.cells), `run ${k}: first finger's later swipe dropped`);
    }
  });
  await t('single swipe = exactly one move', async () => {
    for (let k = 0; k < 3; k++) {
      await reset(); const [x, y] = bc; const s0 = await S(page);
      await T('touchStart', [{ x, y }]); for (let i = 1; i <= 4; i++) await T('touchMove', [{ x: x - 18 * i, y }]); await T('touchEnd', []);
      ok(leftApplied(s0.cells, (await S(page)).cells), 'swipe not applied exactly once');
    }
  });

  console.log('Saving');
  await t('every move is written to storage at once (no pagehide needed)', async () => {
    for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft']) {
      await page.keyboard.press(k);
      const live = await S(page), st = await stored(page, 'classic');
      if (live.over) break;
      ok(JSON.stringify(st.cells) === JSON.stringify(live.cells) && st.score === live.score, 'stored board lags behind after ' + k);
    }
  });

  console.log('New game');
  await t('新局 mid-game asks first; 繼續這局 keeps the board, 開新局 starts over', async () => {
    let s = await S(page);
    if (!s.started || s.over) { await page.click('.overlay [data-a="new"]').catch(() => {}); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight'); s = await S(page); }
    await page.click('#newGame');
    ok(await page.textContent('.overlay h2') === '開新局？', 'no confirm card');
    await page.keyboard.press('ArrowUp');
    ok(JSON.stringify((await S(page)).cells) === JSON.stringify(s.cells), 'board moved / changed under the confirm card');
    await page.click('.overlay [data-a="cancel"]');
    ok(!(await page.$('.overlay')) && JSON.stringify((await S(page)).cells) === JSON.stringify(s.cells), 'cancel lost the board');
    await page.click('#newGame'); await page.click('.overlay [data-a="new"]');
    const n = await S(page); ok(n.score === 0 && !n.started && !(await page.$('.overlay')), 'new game not started');
  });
  await t('first-move hint shows on a fresh board and goes away after the first move', async () => {
    ok(await page.isVisible('#boardHint'), 'hint hidden on fresh board');
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) { await page.keyboard.press(k); if ((await S(page)).started) break; }
    ok(!(await page.isVisible('#boardHint')), 'hint still shown after moving');
  });
  await t('stats: games played and best tier per mode are kept and drawn on the ladder', async () => {
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('kiln2048-stats')));
    ok(st.classic.games >= 1 && st.classic.top >= 4, 'stats not counted ' + JSON.stringify(st));
    ok(await page.$$eval('#ladder span.ever', a => a.length) >= 1, 'no record marks on the ladder');
  });

  console.log('Sound');
  await t('moves make sound; the mute button (≥44 px) silences it and is remembered', async () => {
    const box = await page.locator('#mute').boundingBox(); ok(box.width >= 44 && box.height >= 44, 'mute too small');
    const o0 = await page.evaluate(() => window.__osc);
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight']) await page.keyboard.press(k);
    const o1 = await page.evaluate(() => window.__osc); ok(o1 > o0, 'no sound on moves');
    await page.click('#mute');
    ok(await page.getAttribute('#mute', 'aria-pressed') === 'true' && await page.evaluate(() => localStorage.getItem('kiln2048-mute')) === '1', 'mute not saved');
    for (const k of ['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(k);
    ok(await page.evaluate(() => window.__osc) === o1, 'sound while muted');
    await page.reload(); await page.waitForSelector('#board .tile');
    ok(await page.getAttribute('#mute', 'aria-pressed') === 'true', 'mute forgotten after reload');
    await page.click('#mute');
  });
  await P.ctx.close();

  console.log('Cards and rules');
  await t('3×3 小窯 wins at 128; win-card buttons ≥44 px', async () => {
    const { ctx, page } = await open(390, 844, setGame('small', { ...G, mode: 'small', cells: [[64, 64, 0], [0, 0, 0], [0, 0, 0]], score: 0 }));
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.overlay [data-a="go"]');
    const sizes = await page.$$eval('.overlay button', bs => bs.map(b => b.getBoundingClientRect().height));
    ok(sizes.every(h => h >= 44), 'card buttons ' + sizes); await ctx.close();
  });
  await t('tying the old best is not called a new record; beating it is', async () => {
    const { ctx, page } = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 96, rec: false }, { 'kiln2048-best-classic': '100' }));
    await page.keyboard.press('ArrowLeft');
    let s = await S(page); ok(s.score === 100 && s.rec === false, 'tie marked as record ' + JSON.stringify([s.score, s.rec]));
    await ctx.close();
    const b = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]], score: 100, rec: false, over: true }, { 'kiln2048-best-classic': '100' }));
    ok(!/新紀錄/.test(await b.page.textContent('.overlay')), 'tie card says new record'); await b.ctx.close();
    const c = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[4, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], score: 100, rec: false }, { 'kiln2048-best-classic': '100' }));
    await c.page.keyboard.press('ArrowLeft'); s = await S(c.page); ok(s.rec === true, 'beating the best not marked'); await c.ctx.close();
  });
  await t('result card celebrates a tier this mode never reached before', async () => {
    const { ctx, page } = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 64, 64]], score: 10 }, { 'kiln2048-stats': JSON.stringify({ classic: { games: 3, top: 64 } }) }));
    await page.keyboard.press('ArrowLeft');
    await page.waitForSelector('.overlay h2');
    ok(/第一次合成「霽藍」/.test(await page.textContent('.overlay')), 'no celebration: ' + await page.textContent('.overlay')); await ctx.close();
  });
  await t('tiles past 4096 get their own name (曜變×2)', async () => {
    const { ctx, page } = await open(390, 844, setGame('classic', { ...G, mode: 'classic', cells: [[8192, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 2]], score: 0 }));
    const names = await page.$$eval('.tile .face em', es => es.map(e => e.textContent));
    ok(names.includes('曜變×2'), 'names ' + names); await ctx.close();
  });
  await t('old saves under the original keys still load (kiln2048-game, kiln2048-best)', async () => {
    const { ctx, page } = await open(390, 844, { fn: () => { localStorage.setItem('kiln2048-game', JSON.stringify({ cells: [[2, 4, 8, 16], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 32]], score: 280, undosLeft: 2, history: [] })); localStorage.setItem('kiln2048-best', '900'); } });
    const s = await S(page); ok(s.score === 280 && s.cells[3][3] === 32, 'legacy game not loaded');
    ok(await page.textContent('#best') === '900', 'legacy best not loaded'); await ctx.close();
  });

  console.log('每日一窯');
  await t('only the first game of the day counts; replays are practice; result can be copied', async () => {
    const { ctx, page } = await open(390, 844, setGame('daily'));
    for (const k of ['ArrowLeft', 'ArrowUp', 'ArrowRight']) await page.keyboard.press(k);
    const first = await S(page); ok(first.official === true, 'first game not official');
    await page.click('#newGame'); ok(/今日成績/.test(await page.textContent('.overlay p')), 'confirm does not mention today\'s score');
    await page.click('.overlay [data-a="new"]');
    const key = await page.evaluate(() => Object.keys(localStorage).find(k => /^kiln2048-best-daily-/.test(k)));
    const official = await page.evaluate(k => localStorage.getItem(k), key);
    ok(+official === first.score, 'official score not kept ' + official + ' vs ' + first.score);
    ok((await S(page)).official === false && /練習/.test(await page.textContent('#goal')), 'replay not marked as practice');
    for (let i = 0; i < 40; i++) { const s = await S(page); if (s.over) break; await page.keyboard.press(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowDown'][i % 4]); }
    ok(await page.evaluate(k => localStorage.getItem(k), key) === official, 'practice changed today\'s score');
    await page.reload(); await page.waitForSelector('#board .tile');
    ok((await S(page)).official === false, 'practice became official after reload');
    // share from an end card
    const sv = await S(page); sv.over = true; sv.cells = [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]];
    await page.goto(base + 'blank');   // leaving the page saves the live game, so write the finished one afterwards
    await page.evaluate(s => localStorage.setItem('kiln2048-game-daily', JSON.stringify(s)), sv);
    await page.goto(base); await page.waitForSelector('.overlay [data-a="share"]');
    await page.evaluate(() => { window.__copied = null; try { Object.defineProperty(navigator, 'clipboard', { value: { writeText: t => { window.__copied = t; return Promise.resolve(); } } }); } catch {} });
    await page.click('.overlay [data-a="share"]');
    await page.waitForFunction(() => /已複製/.test(document.querySelector('.overlay [data-a="share"]').textContent));
    const txt = await page.evaluate(() => window.__copied);
    ok(txt && /每日一窯/.test(txt) && txt.includes(official + ' 分'), 'copied text ' + txt);
    await ctx.close();
  });

  await t('no network requests and no console/page errors (offline)', async () => {
    ok(!external.length, 'external: ' + external.slice(0, 3)); ok(!errors.length, 'errors: ' + errors.slice(0, 3));
  });
  await browser.close(); srv.close();
  console.log(`${fail ? 'FAIL' : 'PASS'} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });
