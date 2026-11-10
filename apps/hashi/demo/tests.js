// Regression tests for 群島橋匠 (hashi). Usage: node tests.js [--node-only]
// Part 1 (node): the game's own core (CORE-START/CORE-END) and level table.
// Part 2 (browser, one short Chromium run with real CDP touch events): touch and controls fixes from the
// 2026-10-25 release review — short-bridge taps, island touch radius, tap-island-then-neighbour, hint box,
// undoable restart, double-tap zoom on 11x15, "continue" returns to the last unfinished level, undo survives reload,
// weekday daily sea, title layout.
// 2026-11-02 review: restart + undo brings back the hints and time (no clean record), boards touching the edge are
// centred on their islands, the L100 win animation draws at most 14 beams and no per-island glow gradient.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const core = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(core + '\nreturn {parseLevel, logicSolve, levelParams, makeCandidate};')();
const LEVELS = JSON.parse(html.match(/var LEVELS = (\[[\s\S]*?\n\]);/)[1]);
const goalSecs = new Function(html.match(/function goalSecs\(score\)\{[^\n]*\}/)[0] + '\nreturn goalSecs;')();
const DAILY_L = JSON.parse(html.match(/var DAILY_L = (\[[^\]]*\])/)[1]);
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

(async () => {
  console.log('Core and levels');
  await t('all 100 levels: logic solver finishes (unique), score matches the table, scores strictly rise', () => {
    let prev = 0;
    for (let n = 1; n <= LEVELS.length; n++) {
      const r = C.logicSolve(C.parseLevel(LEVELS[n - 1][0]));
      ok(r.status === 'solved', 'L' + n + ' ' + r.status); ok(r.score === LEVELS[n - 1][1], 'L' + n + ' score'); ok(r.score > prev, 'L' + n + ' not harder'); prev = r.score;
      const pr = C.levelParams(n), P = C.parseLevel(LEVELS[n - 1][0]);
      ok(P.isl.length === pr.I, 'L' + n + ' islands'); if (pr.needTrial) ok(r.used.trial, 'L' + n + ' trial'); if (pr.needIso) ok(r.used.iso, 'L' + n + ' iso');
      if (pr.dense) ok(P.isl.some(i => i.n >= 7), 'L' + n + ' 7/8'); if (pr.mask) ok(P.mask.some(x => x), 'L' + n + ' coast');
    }
  });
  await t('late levels (56-100) have 4-6 islands and loops, not only 1-3 trees', () => {
    let mid = 0, isl = 0, loops = 0, k = 0;
    for (let n = 56; n <= 100; n++) {
      const P = C.parseLevel(LEVELS[n - 1][0]), r = C.logicSolve(P);
      mid += P.isl.filter(i => i.n >= 4 && i.n <= 6).length; isl += P.isl.length;
      loops += r.S.lo.filter(v => v).length - P.isl.length + 1; k++;
    }
    console.log('        4-6 share', (mid / isl).toFixed(2), 'loops/level', (loops / k).toFixed(1));
    ok(mid / isl >= 0.25, '4-6 share ' + (mid / isl).toFixed(2)); ok(loops / k >= 3, 'loops ' + (loops / k).toFixed(1));
  });
  await t('three-star goal follows the level score, not island count (L1 0:20, rising, same ratio early and late)', () => {
    ok(goalSecs(LEVELS[0][1]) === 20, 'L1 goal ' + goalSecs(LEVELS[0][1]));
    let prev = 0; for (const [, sc] of LEVELS) { const g = goalSecs(sc); ok(g >= prev, 'goal falls'); prev = g; }
    const r1 = goalSecs(LEVELS[0][1]) / Math.pow(LEVELS[0][1], 0.84), r100 = goalSecs(LEVELS[99][1]) / Math.pow(LEVELS[99][1], 0.84);
    ok(Math.abs(r1 / r100 - 1) < 0.1, 'early/late ratio ' + (r1 / r100).toFixed(2));
    ok(!/secs <= I \* 4|fmt\(I \* 4\)/.test(html), 'old island x 4 s rule still in code');
  });
  await t('daily sea varies by weekday (7 sizes) and each one can be generated', () => {
    ok(DAILY_L.length === 7 && new Set(DAILY_L).size === 7, 'weekday table');
    const sizes = new Set(DAILY_L.map(L => C.levelParams(L).w)); ok(sizes.size >= 3, 'board sizes ' + [...sizes]);
    for (const L of [Math.min(...DAILY_L), Math.max(...DAILY_L)]) {
      let c = null; for (let s = 1; s <= 400 && !c; s++) { const x = C.makeCandidate(L, 12345 + s * 7919); if (x && x.used.iso) c = x; }
      ok(c, 'no daily candidate for L' + L);
    }
  });
  await t('win animation: beams capped, dark glow from a cached image (no gradient per island per frame)', () => {
    ok(/var BEAMS_MAX = 14;/.test(html) && /litIdx\[i\] % bStep === 0/.test(html), 'beam cap');
    ok(/if \(PAL\.glow\)\{ var GS = glowSprite\(r\)/.test(html), 'glow sprite');
  });
  await t('hint box: pop animation keeps translateX(-50%) and the box lets touches through', () => {
    ok(/@keyframes hpop\{0%\{transform:translateX\(var\(--tx\)\) scale/.test(html), 'keyframes');
    ok(/\.hintbox\{--tx:-50%;[^}]*pointer-events:none/.test(html), 'box pointer-events');
    ok(/\.hintbox \.x\{pointer-events:auto/.test(html), 'close button clickable');
  });

  if (!process.argv.includes('--node-only')) await browser();
  console.log(fail ? 'FAIL ' + fail + ' of ' + (pass + fail) : 'all ' + pass + ' tests passed');
  process.exit(fail ? 1 : 0);
})();

async function browser() {
  let chromium; try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e) { console.log('  (playwright missing, browser tests skipped)'); return; }
  console.log('Browser (CDP touch)');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const br = await chromium.launch({ args: ['--disable-gpu'] });
  const errors = [];
  const ctx = await br.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const touch = async (pts) => { // pts: [[x,y], ...] start ... end
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1], id: 1 }] });
    for (let i = 1; i < pts.length; i++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1], id: 1 }] }); }
    await sleep(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(40);
  };
  const tap = (x, y) => touch([[x, y]]);
  const drag = (a, b, n = 6) => touch([...Array(n + 1)].map((_, i) => [a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]));
  const G = (f, ...a) => page.evaluate(f, ...a);
  const seen = { zoom: 1 }; for (const n of [1, 2, 3, 20, 40, 60, 85]) seen['i' + n] = 1;
  await page.goto('file://' + APP);
  await G(s => { localStorage.clear(); localStorage.setItem('hashi.unlockAll', 'true'); localStorage.setItem('hashi.seen', JSON.stringify(s)); }, seen);
  const open = async n => { await page.reload(); await sleep(300); await page.click('#tSelect'); await sleep(150); await page.click('.lt[data-n="' + n + '"]'); await sleep(250); };
  // geometry helper: all edges with island screen positions
  const geo = () => G(() => { const g = window.__game, E = g.edges(); return E.map((e, i) => ({ i, a: e.a, b: e.b, A: g.islandXY(e.a), B: g.islandXY(e.b) })); });
  try {
    await open(100);
    let st = await G(() => window.__game.state()), E = await geo(), cs = st.cs;
    const short = E.filter(e => Math.abs(Math.hypot(e.A[0] - e.B[0], e.A[1] - e.B[1]) - 2 * cs) < 1);
    await t('360x640 L100: a two-cell bridge can be tapped in its middle (1 -> 2 -> 0)', async () => {
      ok(short.length, 'no two-cell edge'); const e = short[0];
      await drag(e.A, e.B); let c = (await G(() => window.__game.cnt()))[e.i]; ok(c === 1, 'drag built ' + c);
      const m = await G(i => window.__game.bridgeMid(i), e.i);
      await tap(m[0], m[1]); c = (await G(() => window.__game.cnt()))[e.i]; ok(c === 2, 'tap 1 -> ' + c);
      await tap(m[0] + (e.A[1] === e.B[1] ? cs * 0.15 : 0), m[1] + (e.A[0] === e.B[0] ? cs * 0.15 : 0)); c = (await G(() => window.__game.cnt()))[e.i]; ok(c === 0, 'tap 2 -> ' + c);
    });
    await t('island touch radius is 0.7 cell (min 22 px): a drag starting 0.6 cell off the centre builds', async () => {
      const e = E.find(x => Math.abs(x.A[1] - x.B[1]) < 1 && !short.includes(x)) || E[0];
      const off = Math.max(cs * 0.6, 19), s = [e.A[0], e.A[1] + off], end = [e.B[0], e.B[1] + off];
      const before = (await G(() => window.__game.cnt()))[e.i];
      await drag(s, [s[0] + (end[0] - s[0]) * 0.6, s[1]]);
      const c = (await G(() => window.__game.cnt()))[e.i]; ok(c === (before + 1) % 3, before + ' -> ' + c);
    });
    await t('tap an island, then tap its neighbour: one bridge more each time', async () => {
      const e = E.find(x => x !== short[0]); const before = (await G(() => window.__game.cnt()))[e.i];
      await tap(e.A[0], e.A[1]); let s2 = await G(() => window.__game.state()); ok(s2.sel === e.a, 'selected ' + s2.sel);
      await tap(e.B[0], e.B[1]); const c = (await G(() => window.__game.cnt()))[e.i];
      ok(c === (before + 1) % 3, before + ' -> ' + c);
    });
    await t('hint box: centred during its pop animation, touches pass through, never over the hinted bridge', async () => {
      await page.click('#bHint'); await sleep(90);
      const r = await G(() => { const b = document.getElementById('hintBox').getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, pe: getComputedStyle(document.getElementById('hintBox')).pointerEvents }; });
      ok(Math.abs((r.l + r.r) / 2 - 180) < 3, 'centre ' + ((r.l + r.r) / 2).toFixed(1)); ok(r.r <= 360, 'off screen');
      ok(r.pe === 'none', 'pointer-events ' + r.pe);
      const h = (await G(() => window.__game.state())).hint, e = (await geo())[h];
      const inBox = p => p[0] > r.l && p[0] < r.r && p[1] > r.t && p[1] < r.b; ok(!inBox(e.A) && !inBox(e.B), 'hinted bridge under the box');
      // a drag that starts under the box reaches the board
      const under = (await geo()).find(x => inBox(x.A) && x.i !== h);
      if (under) { const b0 = (await G(() => window.__game.cnt()))[under.i]; await drag(under.A, [under.A[0] + (under.B[0] - under.A[0]) * 0.6, under.A[1] + (under.B[1] - under.A[1]) * 0.6]); const b1 = (await G(() => window.__game.cnt()))[under.i]; ok(b1 !== b0, 'drag under hint box swallowed'); }
      await page.click('#hintX');
    });
    await t('pause -> restart can be undone, and the undo stack survives a reload', async () => {
      const before = (await G(() => window.__game.cnt())).join('');
      ok(/[12]/.test(before), 'nothing built');
      await page.click('#bPause'); await sleep(100); await page.click('#pRestart'); await sleep(150);
      ok(!/[12]/.test((await G(() => window.__game.cnt())).join('')), 'restart did not clear');
      await page.reload(); await sleep(300);
      ok(/第 100 關/.test(await page.textContent('#tPlay')), 'continue button: ' + await page.textContent('#tPlay'));
      await page.click('#tPlay'); await sleep(250);
      ok((await G(() => window.__game.state())).n === 100, 'continue went elsewhere');
      ok(!(await page.isDisabled('#bUndo')), 'undo disabled after reload');
      await page.click('#bUndo'); await sleep(80);
      ok((await G(() => window.__game.cnt())).join('') === before, 'undo of restart did not restore');
    });
    await t('continue returns to the last unfinished level (L30 with bridges, reload -> L30)', async () => {
      await open(30); const e = (await geo())[0]; await drag(e.A, e.B);
      await page.reload(); await sleep(300); await page.click('#tPlay'); await sleep(250);
      const s3 = await G(() => window.__game.state()); ok(s3.n === 30, 'went to L' + s3.n);
      ok((await G(() => window.__game.cnt()))[0] === 1, 'board not restored');
    });
    await t('restart then undo restores the hint count and the clock (no clean three-star record)', async () => {
      await open(8); const e = (await geo())[0]; await drag(e.A, e.B);
      await page.click('#bHint'); await sleep(60); await page.click('#hintX'); await page.click('#bHint'); await sleep(60); await page.click('#hintX');
      let s0 = null; for (let k = 0; k < 200; k++) { s0 = await G(() => window.__game.state()); if (s0.elapsed >= 1500) break; await sleep(50); }
      ok(s0.hints === 2, 'hints ' + s0.hints); ok(s0.elapsed >= 1500, 'clock ' + s0.elapsed);
      await page.click('#bPause'); await sleep(100); s0 = await G(() => window.__game.state());
      await page.click('#pRestart'); await sleep(150);
      let s1 = await G(() => window.__game.state()); ok(s1.hints === 0 && s1.elapsed < s0.elapsed, 'restart did not reset');
      await page.reload(); await sleep(300); await page.click('#tPlay'); await sleep(250); // the stored undo entry keeps them too
      await page.click('#bUndo'); await sleep(80);
      const s2 = await G(() => window.__game.state());
      ok(s2.n === 8 && s2.hints === 2, 'hints after undo ' + s2.hints); ok(s2.elapsed >= s0.elapsed, 'clock after undo ' + s2.elapsed + ' < ' + s0.elapsed);
      ok((await G(() => window.__game.cnt()))[e.i] === 1, 'bridges not restored');
    });
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(200);
    await t('390x844 L1: islands touching the board edge are centred (left gap = right gap)', async () => {
      await open(1); const P = (await geo()).flatMap(e => [e.A, e.B]);
      const l = Math.min(...P.map(p => p[0])), r = Math.max(...P.map(p => p[0]));
      ok(Math.abs((l + r) / 2 - 195) < 3, 'centre ' + ((l + r) / 2).toFixed(1));
    });
    await t('390x844 11x15 board (L31): double-tap on water zooms in', async () => {
      await open(31); const s4 = await G(() => window.__game.state()); ok(s4.z === 1, 'start zoom');
      // find a water point: midway between the first two island rows, away from islands
      const E2 = await geo(), I = E2.flatMap(e => [e.A, e.B]);
      let w = null; for (let y = 120; y < 700 && !w; y += 7) for (let x = 30; x < 360 && !w; x += 7) if (I.every(p => Math.hypot(p[0] - x, p[1] - y) > 40)) w = [x, y];
      ok(w, 'no water'); await tap(w[0], w[1]); await sleep(60); await tap(w[0], w[1]); await sleep(60);
      const z = (await G(() => window.__game.state())).z; ok(z > 1.2, 'zoom ' + z);
    });
    await t('daily sea: size follows the weekday, generated without blocking', async () => {
      await page.reload(); await sleep(300);
      const want = DAILY_L[new Date().getDay()]; ok(/週/.test(await page.textContent('#tDaily')), 'daily label');
      await page.click('#tDaily');
      let s5 = null; for (let k = 0; k < 250 && !(s5 && s5.n === 0); k++) { await sleep(100); s5 = await G(() => window.__game.state()); }
      ok(s5 && s5.n === 0, 'daily did not start'); ok(s5.dailyL === want, 'daily L ' + s5.dailyL + ' != ' + want);
    });
    await t('title: demo board sits between the title text and the buttons', async () => {
      await page.reload(); await sleep(400);
      const r = await G(() => { const a = document.querySelector('.ttl').getBoundingClientRect(), b = document.querySelector('.tbtns').getBoundingClientRect(); return { top: a.bottom, bot: b.top }; });
      ok(r.bot > r.top, 'no space'); ok(/titleP = tt\.height/.test(html), 'title board measured from the DOM');
    });
    await t('no page or console errors', () => { ok(!errors.length, errors.join(' | ')); });
  } finally { await br.close(); }
}
