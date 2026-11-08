// Regression tests for 麻將接龍 (mahjong-solitaire). Usage: node tests.js
// Part 1 runs the game's own core (CORE-START..CORE-END) in Node; part 2 drives index.html in headless Chromium
// with real CDP touch events at phone size. Every wait polls a condition (no timing-sensitive sleeps).
const fs = require('fs'), path = require('path');
const APPF = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APPF, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {makeLevel,levelParams,replayCheck,newCounts,freeGroups,countPairs,SHUF_AT,UNDO_AT};')();
const LEVELS = JSON.parse(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1]);
let pass = 0, fail = 0;
function t(name, cond, info) { if (cond) pass++; else { fail++; console.log('FAIL', name, info !== undefined ? JSON.stringify(info).slice(0, 300) : ''); } if (process.env.KV && cond) console.log('ok  ', name); }

// ---------- part 1: rules / level data ----------
{
  let okAll = true, prevS = -1, shPrev = 5, unPrev = Infinity, steps = true;
  for (let n = 1; n <= LEVELS.length; n++) {
    const [ti, seed, mode, S] = LEVELS[n - 1], L = C.makeLevel(n, ti, seed, mode);
    if (!L || !C.replayCheck(L.lay, L.faces, L.order) || !(S > prevS)) okAll = false;
    prevS = S;
    const p = L.p; if (p.sh > shPrev || shPrev - p.sh > 1 || p.un > unPrev || (unPrev !== Infinity && unPrev - p.un > 1)) steps = false;
    shPrev = p.sh; unPrev = p.un;
  }
  t('all 100 levels deal a solvable board and difficulty rises every level', okAll);
  t('shuffles and undos only ever drop by one between neighbouring levels (no sudden wall)', steps);
  t('shuffle schedule 5 -> 1, undo limited from level 26', C.SHUF_AT(1) === 5 && C.SHUF_AT(100) === 1 && C.UNDO_AT(25) === Infinity && C.UNDO_AT(26) === 8 && C.UNDO_AT(100) === 2);
  let maxOpen = 0;
  for (let n = 1; n <= 20; n++) { const [ti, seed, mode] = LEVELS[n - 1], L = C.makeLevel(n, ti, seed, mode), pr = new Uint8Array(L.lay.n).fill(1);
    maxOpen = Math.max(maxOpen, C.countPairs(C.freeGroups(L.lay, pr, L.faces, C.newCounts(L.lay, pr)))); }
  t('levels 1-20 open with at most 16 ready pairs (was up to 31)', maxOpen <= 16, maxOpen);
  t('falling-leaf particles live at most 0.8 s', /life:0\.5\+Math\.random\(\)\*0\.3/.test(html));
}

// ---------- part 2: the page ----------
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const t0 = Date.now();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__ev = []; window.__up = 0; window.__progAt = [];
    addEventListener('pointerup', () => { window.__up = performance.now(); }, true);
    document.addEventListener('click', e => { window.__ev.push({ trusted: e.isTrusted, id: (e.target.closest && e.target.closest('button') || e.target).id || '' }); });
    const si = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'mjsol:progress') window.__progAt.push(performance.now() - window.__up); return si.call(this, k, v); };
    const di = CanvasRenderingContext2D.prototype.drawImage; window.__draws = 0;
    CanvasRenderingContext2D.prototype.drawImage = function () { if (this.canvas && this.canvas.id === 'cv') window.__draws++; return di.apply(this, arguments); };
  });
  await page.goto('file://' + APPF);
  const cdp = await ctx.newCDPSession(page);
  const T = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const wf = (fn, arg, ms = 20000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 20 });
  const st = () => page.evaluate(() => window.__game.state());
  const vis = sel => page.isVisible(sel);
  const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; };
  const tapXY = async (x, y, hold = 40, id = 1) => { await T('touchStart', [{ x, y, id }]); if (hold) await sleep(hold); await T('touchEnd', []); };
  const tap = async (sel, hold) => { const c = await center(sel); await tapXY(c.x, c.y, hold); };
  const waitVis = (sel, on = true) => wf(([s, on]) => { const e = document.querySelector(s); return !!e && !e.closest('.hidden') === on; }, [sel, on]);
  const tc = i => page.evaluate(i => window.__game.tileCenter(i), i);
  const freePairs = async () => { const plan = await page.evaluate(() => window.__game.plan()), out = [];
    for (const [a, b] of plan) { const A = await tc(a), B = await tc(b); if (A.present && B.present && A.free && B.free) out.push([A, B, a, b]); } return out; };
  const settle = () => wf(() => { const s = window.__game.state(); return !s.flying; });
  async function toTitle() {
    for (let k = 0; k < 6 && !(await vis('#title')); k++) {
      if (await vis('#confirm')) await tap('#cBtns .btn:last-child');
      else if (await vis('#win')) await tap('#wSelect');
      else if (await vis('#select')) await tap('#sBack');
      else if (await vis('#intro')) await tap('#iOk');
      else if (await vis('#menu')) await tap('#mHome');
      else if (await vis('#fail')) await tap('#fSelect');
      else if (await vis('#bar')) await tap('#bMenu');
      await sleep(80);
    }
    await waitVis('#title');
  }
  async function startLevel(n) {
    await toTitle(); await tap('#tSelect'); await waitVis('#select');
    if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') { await tap('#unlockSw'); await wf(() => document.getElementById('unlockSw').getAttribute('aria-checked') === 'true'); }
    await page.locator('.lt[data-n="' + n + '"]').scrollIntoViewIfNeeded();
    await tap('.lt[data-n="' + n + '"]');
    await wf(n => { const c = document.getElementById('confirm'), i = document.getElementById('intro'); const s = window.__game.state();
      return !c.classList.contains('hidden') || !i.classList.contains('hidden') || (s.status === 'play' && s.n === n); }, n);
    if (await vis('#confirm')) { await tap('#cBtns .btn:nth-child(2)'); }
    await wf(n => { const s = window.__game.state(); return s.status === 'play' && s.n === n; }, n);
    if (await vis('#intro')) { await tap('#iOk'); await waitVis('#intro', false); }
  }
  async function playPairs(k) { for (let m = 0; m < k; m++) { const fp = await freePairs(); const [A, B] = fp[0]; const r0 = (await st()).rem;
    await tapXY(A.x, A.y); await wf(() => window.__game.state().sel >= 0); await tapXY(B.x, B.y); await wf(r => window.__game.state().rem === r - 2, r0); } }

  try {
    // first ever game: level 1 explains the rules and outlines a pair
    await tap('#tPlay'); await waitVis('#intro');
    t('first game opens with a how-to-play card', /怎麼玩/.test(await page.textContent('#iTitle')) && /相同/.test(await page.textContent('#iBody')));
    await tap('#iOk'); await waitVis('#intro', false);

    // --- buttons: slow taps, ghost clicks, a second finger already down ---
    await toTitle();
    for (const hold of [50, 600, 1000]) {
      await page.evaluate(() => { window.__ev = []; });
      await tap('#tHelp', hold); await waitVis('#help'); await sleep(250);
      const ev1 = await page.evaluate(() => window.__ev);
      await tap('#hOk', hold); await waitVis('#help', false); await sleep(250);
      const ev2 = await page.evaluate(() => window.__ev);
      t('button held ' + hold + ' ms acts once and its follow-up click never reaches the page', ev1.length === 1 && !ev1[0].trusted && ev1[0].id === 'tHelp' && ev2.length === 2 && ev2[1].id === 'hOk' && !ev2[1].trusted && await vis('#title'), { ev1, ev2 });
    }
    { // finger 1 resting on the background, finger 2 taps 設定
      const b = await center('#tSet');
      await T('touchStart', [{ x: 20, y: 20, id: 1 }]); await sleep(60);
      await T('touchStart', [{ x: 20, y: 20, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(60);
      await T('touchEnd', [{ x: 20, y: 20, id: 1 }]); await sleep(60);
      await T('touchEnd', []);
      await waitVis('#settings');
      t('a button tap works while another finger is already down', await vis('#settings'));
      const seg = await page.evaluate(() => [...document.querySelectorAll('#sStyle button')].map(e => [e.offsetWidth, e.offsetHeight]));
      t('style segmented buttons are at least 44x44 (layout size, ignoring the pop-in animation)', seg.every(([w, h]) => w >= 44 && h >= 44), seg);
      await tap('#setOk'); await waitVis('#title');
    }

    // --- board taps: hold, wobble, two thumbs ---
    await startLevel(3);
    for (const hold of [600, 1000]) {
      const [A] = (await freePairs())[0];
      await tapXY(A.x, A.y, hold); await wf(() => window.__game.state().sel >= 0, null, 5000).catch(() => {});
      const s1 = await st(); t('tile tap held ' + hold + ' ms selects', s1.sel >= 0, s1);
      await tapXY(A.x, A.y); await wf(() => window.__game.state().sel < 0, null, 5000).catch(() => {});
    }
    for (const wob of [12, 16]) {
      const [A] = (await freePairs())[0];
      await T('touchStart', [{ x: A.x, y: A.y, id: 1 }]); await sleep(30);
      await T('touchMove', [{ x: A.x + wob * 0.6, y: A.y + wob * 0.8, id: 1 }]); await sleep(30);
      await T('touchEnd', []);
      await wf(() => window.__game.state().sel >= 0, null, 5000).catch(() => {});
      t('finger wobbling ' + wob + ' px still selects the tile', (await st()).sel >= 0);
      await tapXY(A.x, A.y); await wf(() => window.__game.state().sel < 0, null, 5000).catch(() => {});
    }
    for (const [d1, d2, d3] of [[80, 30, 70], [40, 20, 60], [120, 60, 40], [60, 100, 40]]) {
      const [A, B] = (await freePairs())[0]; const r0 = (await st()).rem;
      await T('touchStart', [{ x: A.x, y: A.y, id: 11 }]); await sleep(d1);
      await T('touchStart', [{ x: A.x, y: A.y, id: 11 }, { x: B.x, y: B.y, id: 12 }]); await sleep(d2);
      await T('touchEnd', [{ x: B.x, y: B.y, id: 12 }]); await sleep(d3);
      await T('touchEnd', []);
      await wf(r => window.__game.state().rem === r - 2, r0, 5000).catch(() => {});
      t('two overlapping thumbs on a pair both count (' + [d1, d2, d3] + ')', (await st()).rem === r0 - 2, { r0, now: (await st()).rem });
      await settle();
    }

    { const s0 = await st(); await tap('#bShuf'); await wf(n => window.__game.state().shuf === n - 1, s0.shuf, 8000).catch(() => {});
      const s1 = await st(); t('shuffle uses one shuffle and keeps every tile', s1.shuf === s0.shuf - 1 && s1.rem === s0.rem, { s0, s1 }); }

    // --- idle frames draw nothing; animation frames do ---
    await wf(() => !window.__game.state().busy);
    let d0 = await page.evaluate(() => window.__draws); await sleep(800); let d1 = await page.evaluate(() => window.__draws);
    t('board at rest does not redraw the canvas', d1 === d0, { d0, d1 });
    { const [A, B] = (await freePairs())[0]; await tapXY(A.x, A.y); await tapXY(B.x, B.y); await sleep(150); }
    t('a match animates (canvas redraws)', (await page.evaluate(() => window.__draws)) > d1);
    await settle();

    // --- the game in progress survives a reload and 「繼續」 resumes it ---
    await startLevel(2); await playPairs(3);
    await tap('#bHint'); await wf(() => window.__game.state().hints === 1);
    const before = await st();
    await page.reload(); await waitVis('#title');
    t('title offers 繼續 for the saved game', /繼續・第 2 關/.test(await page.textContent('#tPlay')));
    await tap('#tPlay'); await wf(() => { const s = window.__game.state(); return s.status === 'play'; });
    const after = await st();
    t('resumed game has the same board, hints and time', after.n === 2 && after.rem === before.rem && after.hints === 1 && Math.abs(after.t - before.t) < 6, { before, after });
    await tap('#bUndo'); await wf(r => window.__game.state().rem === r + 2, after.rem, 5000).catch(() => {});
    t('undo works on the resumed game', (await st()).rem === after.rem + 2);

    // --- starting another game does not silently overwrite it ---
    await toTitle(); await tap('#tDaily'); await waitVis('#confirm');
    t('starting another game asks before dropping the saved one', /放棄/.test(await page.textContent('#cTitle')));
    await tap('#cBtns .btn:last-child'); await waitVis('#title');
    t('cancel keeps the saved game', /第 2 關/.test(await page.textContent('#tPlay')) && JSON.parse(await page.evaluate(() => localStorage.getItem('mjsol:current'))).n === 2);
    await tap('#tDaily'); await waitVis('#confirm'); await tap('#cBtns .btn:first-child');
    await wf(() => window.__game.state().status === 'play');
    t('「繼續那一局」 resumes it', (await st()).n === 2 && (await st()).mode === 'level');

    // --- the win is stored in the same moment as the last match ---
    await startLevel(1);
    { const plan = await page.evaluate(() => window.__game.plan());
      for (const [a, b] of plan) for (const i of [a, b]) { const c = await tc(i); await tapXY(c.x, c.y, 20); }
      await wf(() => window.__game.state().status === 'won');
      const lag = await page.evaluate(() => window.__progAt[window.__progAt.length - 1]);
      t('win is saved within the last pointerup (no 380 ms gap)', lag !== undefined && lag < 120, lag);
      t('finished game is no longer offered as 繼續', await page.evaluate(() => localStorage.getItem('mjsol:current')) === null);
      await waitVis('#win');
      t('win card states the 2-star rule', /二星/.test(await page.textContent('#wCrit')));
      await tap('#wSelect'); await waitVis('#select');
      t('level select shows the best time', /最佳 \d+:\d\d/.test(await page.textContent('.lt[data-n="1"]')));
    }

    // --- undo limit ---
    await startLevel(40);
    { const s0 = await st(); t('level 40 has a limited undo count shown on the button', s0.undoLeft > 0 && (await page.textContent('#undoN')).trim() === String(s0.undoLeft), s0);
      await playPairs(1); await tap('#bUndo'); await wf(u => window.__game.state().undoLeft === u - 1, s0.undoLeft, 5000).catch(() => {});
      t('undo uses one of them', (await st()).undoLeft === s0.undoLeft - 1); }

    // --- small screens: bigger tiles, view limited to the board area ---
    for (const [w, h] of [[375, 500], [844, 390]]) {
      await page.setViewportSize({ width: w, height: h }); await startLevel(100); await sleep(200);
      const s = await st();
      const g = await page.evaluate(() => { const hc = document.querySelector('.hcard').getBoundingClientRect(), b = document.getElementById('bar').getBoundingClientRect(); return { hr: hc.right, hb: hc.bottom, bt: b.top, bl: b.left }; });
      t(w + 'x' + h + ' tiles are at least 34 px wide on screen', s.TW * s.zm >= 33.5, s);
      // a tile whose centre is under the HUD or toolbar must not be tappable there
      const hits = await page.evaluate(g => { const out = []; for (let i = 0; i < 144; i++) { const c = window.__game.tileCenter(i); if (!c.present) continue;
        const under = (window.innerWidth > window.innerHeight) ? (c.x < g.hr || c.x > g.bl) : (c.y < g.hb || c.y > g.bt); if (under) out.push(window.__game.hitTest(c.x, c.y)); } return out; }, g);
      t(w + 'x' + h + ' tiles hidden under the HUD/toolbar are not hit', hits.every(v => v < 0), hits.slice(0, 5));
      if (w > h) t('landscape HUD sits in a left column', g.hr < 200 && g.bl > w - 120, g);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  } catch (e) { fail++; console.log('FAIL exception', e && e.message); }
  t('no page or console errors', errors.length === 0, errors);
  await browser.close();
  console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  process.exit(fail ? 1 : 0);
})();
