// Verification for 推箱子 (sokoban). Opens the page at 390x844 and the three lobby iframe sizes, light and dark, asserting
// no page errors, then plays through the real UI: level 1 with touch swipes on the board, level 2 with tap-to-walk plus the
// on-screen D-pad (checking undo and restart), level 3 with the keyboard at desktop size. Finally writes cover-390x520.png.
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return {DX,DY,DCH,parseLevel,initState,tryMove,replay,pathTo,nb,reach};')();
const LEVELS = new Function(html.match(/\/\*LEVELS-START\*\/([\s\S]*?)\/\*LEVELS-END\*\//)[1] + ';return LEVELS;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };

async function swipe(cdp, x, y, d) {
  const DX = [0, 1, 0, -1][d], DY = [-1, 0, 1, 0][d], len = 50, steps = 4;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) { await sleep(15); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + DX * len * i / steps, y: y + DY * len * i / steps }] }); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapXY(cdp, x, y) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(50);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, page, sel) { const b = await page.locator(sel).boundingBox(); await tapXY(cdp, b.x + b.width / 2, b.y + b.height / 2); }
async function idle(page) { for (let k = 0; k < 1500; k++) { const st = await page.evaluate(() => window.__game.state()); if (!st.animating) return st; await sleep(20); } return page.evaluate(() => window.__game.state()); }
function newPage(browser, w, h, dark, touch) {
  return browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: !!touch, isMobile: !!touch, colorScheme: dark ? 'dark' : 'light' }).then(async ctx => {
    const page = await ctx.newPage(), errors = []; page.setDefaultTimeout(120000); // shared CI boxes can be slow to capture
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP); await sleep(400);
    return { ctx, page, errors };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  // 1) every size, light and dark: loads, no errors, title -> play -> HUD visible, board fits
  for (const [w, h] of [[390, 844], [375, 500], [390, 610], [430, 740]]) for (const dark of [false, true]) {
    const { ctx, page, errors } = await newPage(browser, w, h, dark, true);
    ok(await page.isVisible('#title'), `${w}x${h} ${dark ? 'dark' : 'light'}: title shown`);
    // title vignette sits between the progress pill and the buttons, not under them
    const tv = await page.evaluate(() => { const t = window.__game.titleScene(), a = document.getElementById('tProg').getBoundingClientRect(), b = document.querySelector('.tbtns').getBoundingClientRect(); return { ok: t.s < 18 || (t.y >= a.bottom && t.y + t.s * 3 <= b.top && t.x >= 0 && t.x + t.s * 7 <= innerWidth), s: t.s }; });
    ok(tv.ok, `${w}x${h}: title scene fits between the title and the buttons (cell ${tv.s})`);
    await page.click('#tPlay'); await sleep(300);
    if (await page.isVisible('#hOk')) { await page.click('#hOk'); await sleep(200); }
    ok(await page.isVisible('#hud') && await page.isVisible('#dpad'), `${w}x${h}: HUD and D-pad visible`);
    const fit = await page.evaluate(() => { const L = window.__game.level(), c = window.__game.cellCenter(L.n - 1), c0 = window.__game.cellCenter(0); const hud = document.getElementById('hud').getBoundingClientRect().bottom, bot = document.getElementById('bottom').getBoundingClientRect().top; return c0.y > hud && c.y < bot && c0.x > 0 && c.x < innerWidth; });
    ok(fit, `${w}x${h}: board sits between HUD and controls`);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    ok(theme === (dark ? 'dark' : 'light'), `${w}x${h}: theme follows system (${theme})`);
    await page.screenshot({ path: path.join(OUT, `shot-${w}x${h}-${dark ? 'dark' : 'light'}.png`) });
    ok(errors.length === 0, `${w}x${h} ${dark ? 'dark' : 'light'}: no page errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  // 2) touch play-through at 390x844
  {
    const { ctx, page, errors } = await newPage(browser, 390, 844, false, true);
    const cdp = await ctx.newCDPSession(page);
    await tap(cdp, page, '#tPlay'); for (let k = 0; k < 50 && await page.isVisible('#title'); k++) await sleep(100); await sleep(200);
    for (let k = 0; k < 30 && !(await page.isVisible('#hOk')); k++) await sleep(100);
    if (await page.isVisible('#hOk')) { await sleep(400); await tap(cdp, page, '#hOk'); for (let k = 0; k < 30 && await page.isVisible('#help'); k++) await sleep(100); }
    ok(!(await page.isVisible('#help')) && (await page.evaluate(() => window.__game.state())).status === 'play', 'help closes and play starts');
    // level 1 by swipes
    const sol1 = LEVELS[0].s;
    for (const ch of sol1) { await swipe(cdp, 195, 400, C.DCH.indexOf(ch)); await sleep(60); await idle(page); }
    let st = await idle(page);
    ok(st.won && st.level === 1 && st.moves === sol1.length, `level 1 solved by swipes (moves ${st.moves}/${sol1.length}, won ${st.won})`);
    const placed = await page.textContent('#hPlaced');
    ok(placed === '1/1', 'HUD placed counter shows 1/1 (' + placed + ')');
    for (let k = 0; k < 50 && !(await page.isVisible('#win')); k++) await sleep(100);
    ok(await page.isVisible('#win'), 'win card appears');
    const stars = await page.locator('#wStars .on').count();
    ok(stars === 3, 'three stars at par (' + stars + ')');
    const prog = await page.evaluate(() => window.__game.prog());
    ok(prog[1] && prog[1].m === sol1.length && prog[1].s === 3, 'progress saved for level 1 ' + JSON.stringify(prog[1]) + ' ' + JSON.stringify(await page.evaluate(() => window.__game.state())) + ' ' + errors.join(' | '));
    await tap(cdp, page, '#wNext'); await sleep(400);
    st = await idle(page);
    ok(st.level === 2 && st.status === 'play', 'next level starts level 2');
    // level 2: walk by tapping floor cells, push with the D-pad
    const L2 = C.parseLevel(LEVELS[1].m), S2 = C.initState(L2);
    const sol2 = LEVELS[1].s;
    let i = 0, walkUsed = 0, padUsed = 0;
    while (i < sol2.length) {
      // gather a run of non-push steps
      const probe = { p: S2.p, box: new Uint8Array(S2.box) };
      let j = i, target = S2.p;
      while (j < sol2.length) { const d = C.DCH.indexOf(sol2[j]); const to = C.nb(L2, probe.p, d); if (probe.box[to]) break; probe.p = to; target = to; j++; }
      if (j > i + 1) {
        const xy = await page.evaluate(c => window.__game.cellCenter(c), target);
        await tapXY(cdp, xy.x, xy.y); await sleep(80); await idle(page);
        for (let k = i; k < j; k++) C.tryMove(L2, S2, C.DCH.indexOf(sol2[k]));
        const snap = await page.evaluate(() => window.__game.snap());
        ok(snap.p === target, 'tap-to-walk reached the tapped cell');
        walkUsed++; i = j;
      } else {
        const d = C.DCH.indexOf(sol2[i]);
        await tap(cdp, page, `.dk[data-d="${d}"]`); await sleep(60); await idle(page);
        C.tryMove(L2, S2, d); i++; padUsed++;
      }
    }
    st = await idle(page);
    const snap = await page.evaluate(() => window.__game.snap());
    const exp = []; for (let k = 0; k < L2.n; k++) if (S2.box[k]) exp.push(k);
    ok(JSON.stringify(snap.box) === JSON.stringify(exp) && snap.p === S2.p, 'board matches the core after walks + D-pad pushes');
    ok(st.won && st.level === 2, `level 2 solved with tap-to-walk (${walkUsed} walks) and D-pad (${padUsed} presses); moves ${st.moves}, par ${sol2.length}`);
    for (let k = 0; k < 50 && !(await page.isVisible('#win')); k++) await sleep(100);
    await tap(cdp, page, '#wNext'); await sleep(400);
    // level 3: undo and restart via the buttons
    st = await idle(page);
    const d0 = C.DCH.indexOf(LEVELS[2].s[0]);
    await tap(cdp, page, `.dk[data-d="${d0}"]`); await sleep(50); await idle(page);
    st = await page.evaluate(() => window.__game.state());
    ok(st.moves === 1, 'one D-pad press = one move');
    await tap(cdp, page, '#bUndo'); await sleep(50); await idle(page);
    st = await page.evaluate(() => window.__game.state());
    ok(st.moves === 0 && st.p === C.parseLevel(LEVELS[2].m).p0, 'undo button restores the start');
    ok(await page.evaluate(() => document.getElementById('bUndo').disabled), 'undo disabled with empty history');
    await tap(cdp, page, `.dk[data-d="${d0}"]`); await sleep(50); await idle(page);
    await tap(cdp, page, '#bRestart'); await sleep(200);
    st = await page.evaluate(() => window.__game.state());
    ok(st.moves === 0 && st.pushes === 0, 'restart resets counters');
    // one swipe = one step, even when the finger stays down afterwards
    {
      const L3 = C.parseLevel(LEVELS[2].m), S3 = C.initState(L3); let dd = 0;
      for (let k = 0; k < 4; k++) { const t = C.nb(L3, S3.p, k); if (t >= 0 && !L3.wall[t] && !S3.box[t]) { dd = k; break; } }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420 }] });
      for (let k = 1; k <= 4; k++) { await sleep(15); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + C.DX[dd] * 12 * k, y: 420 + C.DY[dd] * 12 * k }] }); }
      await sleep(900);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(page);
      st = await page.evaluate(() => window.__game.state());
      ok(st.moves === 1, 'a held swipe moves exactly one step (' + st.moves + ')');
      await tap(cdp, page, '#bRestart'); await sleep(200);
      // a short flick (18 px, below the step distance) still counts as one step
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 420 }] });
      for (let k = 1; k <= 3; k++) { await sleep(15); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + C.DX[dd] * 6 * k, y: 420 + C.DY[dd] * 6 * k }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(page);
      st = await page.evaluate(() => window.__game.state());
      ok(st.moves === 1, 'a short 18 px flick moves one step (' + st.moves + ')');
      await tap(cdp, page, '#bRestart'); await sleep(200);
    }
    // pause / level select shows progress
    await tap(cdp, page, '#bPause'); await sleep(200);
    ok(await page.isVisible('#pause'), 'pause card opens');
    await tap(cdp, page, '#pSelect'); await sleep(300);
    ok(await page.isVisible('#select'), 'level select opens from pause');
    const doneCount = await page.locator('.lt.done').count(), lockCount = await page.locator('.lt.lock').count();
    ok(doneCount === 2 && lockCount === LEVELS.length - 3, `level select: 2 done, ${lockCount} locked`);
    await page.locator('.lt[data-n="1"]').scrollIntoViewIfNeeded();
    await tap(cdp, page, '.lt[data-n="1"]'); await sleep(300);
    st = await page.evaluate(() => window.__game.state());
    ok(st.level === 1 && st.status === 'play', 'picking a level from the grid starts it');
    // theme toggle persists
    await tap(cdp, page, '#bPause'); await sleep(200);
    await tap(cdp, page, '#sTheme [data-v="dark"]'); await sleep(100);
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dark', 'manual dark theme applies');
    const saved = await page.evaluate(() => localStorage.getItem('sokoban:v1:theme'));
    ok(saved === '"dark"', 'theme saved under sokoban:v1:');
    ok(errors.length === 0, 'touch play-through: no page errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 3) keyboard at desktop size: solve level 3, then open level 100 and check it renders
  {
    const { ctx, page, errors } = await newPage(browser, 1024, 768, false, false);
    await page.click('#tPlay'); await sleep(300);
    if (await page.isVisible('#hOk')) { await page.click('#hOk'); await sleep(200); }
    await page.evaluate(() => window.__game.go(3)); await sleep(200);
    const sol3 = LEVELS[2].s, KEYS = ['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'];
    for (const ch of sol3) { await page.keyboard.press(KEYS[C.DCH.indexOf(ch)]); await idle(page); }
    let st = await idle(page);
    ok(st.won && st.level === 3, 'level 3 solved with the keyboard');
    for (let k = 0; k < 50 && !(await page.isVisible('#win')); k++) await sleep(100);
    await page.keyboard.press('Enter'); await sleep(300);
    st = await page.evaluate(() => window.__game.state());
    ok(st.level === 4, 'Enter on the win card goes to the next level');
    await page.keyboard.press('z'); await page.keyboard.press('r'); await page.keyboard.press('Escape'); await sleep(150);
    ok(await page.isVisible('#pause'), 'Esc pauses');
    await page.keyboard.press('Escape'); await sleep(150);
    ok(!(await page.isVisible('#pause')), 'Esc again resumes');
    // a crate pushed against a wall with no goal on it is flagged as stuck (red outline + toast)
    {
      const n = (() => { for (let k = 1; k <= LEVELS.length; k++) { const L = C.parseLevel(LEVELS[k - 1].m), S = C.initState(L); for (let d = 0; d < 4; d++) { const b = C.nb(L, S.p, d), t = b < 0 ? -1 : C.nb(L, b, d); if (b >= 0 && S.box[b] && t >= 0 && !L.wall[t] && !S.box[t] && !L.goal[t]) { const u = C.nb(L, t, d); const side = [C.nb(L, t, (d + 1) % 4), C.nb(L, t, (d + 3) % 4)]; if (u >= 0 && L.wall[u] && (L.wall[side[0]] || L.wall[side[1]])) return [k, d]; } } } return null; })();
      if (n) {
        await page.evaluate(n => window.__game.go(n), n[0]); await sleep(300);
        await page.keyboard.press(KEYS[n[1]]); await idle(page); await sleep(400);
        const stuck = await page.evaluate(() => window.__game.stuckCount());
        ok(stuck >= 1, 'pushing a crate into a corner marks it stuck (level ' + n[0] + ')');
        ok(await page.isVisible('#toast') && /卡住/.test(await page.textContent('#toast')), 'stuck toast tells the player to undo');
        await page.keyboard.press('z'); await idle(page);
        ok(await page.evaluate(() => window.__game.stuckCount()) === 0, 'undo clears the stuck mark');
      } else ok(true, 'no corner push available at a level start');
    }
    await page.evaluate(() => window.__game.go(100)); await sleep(300);
    const r100 = C.replay(C.parseLevel(LEVELS[99].m), LEVELS[99].s);
    ok(r100.won, 'level 100 stored solution replays to a win');
    for (const ch of LEVELS[99].s.slice(0, 12)) { await page.keyboard.press(KEYS[C.DCH.indexOf(ch)]); await idle(page); }
    st = await idle(page);
    ok(st.moves === 12 && st.level === 100, 'level 100 plays');
    await page.screenshot({ path: path.join(OUT, 'shot-desktop-level100.png') });
    ok(errors.length === 0, 'desktop: no page errors ' + errors.join(' | '));
    await ctx.close();
  }
  // 3b) touch helpers for long levels: crate select + auto push, aim/confirm ring on small cells, hint, demo,
  //     idle redraw stop, resume after reload, single button on the last win card, level-set update notice
  {
    const { ctx, page, errors } = await newPage(browser, 390, 844, false, true);
    const cdp = await ctx.newCDPSession(page);
    await page.evaluate(() => localStorage.setItem('sokoban:v1:help', 'true'));
    await page.click('#tPlay'); await sleep(300);
    // auto push: pick a crate that has a destination dot 2+ cells away
    let done = false;
    for (const n of [30, 40, 45, 50, 60]) {
      await page.evaluate(n => window.__game.go(n), n); await sleep(300);
      const L = C.parseLevel(LEVELS[n - 1].m); const boxes = []; for (let k = 0; k < L.n; k++) if (L.box0[k]) boxes.push(k);
      for (const b of boxes) {
        const c = await page.evaluate(k => window.__game.cellCenter(k), b); await tapXY(cdp, c.x, c.y); await sleep(150);
        const selI = await page.evaluate(() => window.__game.selected());
        if (!selI) continue;
        const far = selI.dests.find(t => Math.abs(t % L.w - b % L.w) + Math.abs(((t / L.w) | 0) - ((b / L.w) | 0)) >= 2);
        if (far == null) { await tapXY(cdp, c.x, c.y); await sleep(100); continue; }
        const t = await page.evaluate(k => window.__game.cellCenter(k), far); await tapXY(cdp, t.x, t.y); await sleep(100); await idle(page);
        const snap = await page.evaluate(() => window.__game.snap()), st = await page.evaluate(() => window.__game.state());
        ok(snap.box.includes(far) && !snap.box.includes(b) && st.moves > 1, `level ${n}: tap crate, tap a dot -> crate pushed there (${st.moves} moves, ${st.pushes} pushes)`);
        await tap(cdp, page, '#bUndo'); await sleep(100); await idle(page);
        ok((await page.evaluate(() => window.__game.state())).moves === 0, 'one undo takes back the whole auto push');
        done = true; break;
      }
      if (done) break;
    }
    ok(done, 'found a crate to auto-push');
    // small cells (level 100 at 390 wide): first tap aims, second tap goes
    await page.evaluate(() => window.__game.go(100)); await sleep(300);
    const rect = await page.evaluate(() => window.__game.boardRect());
    ok(rect.s < 36, 'level 100 cells are small at 390 wide (' + rect.s + ' px)');
    const L100 = C.parseLevel(LEVELS[99].m), S100 = C.initState(L100), R = C.reach(L100, S100);
    let far = -1; for (let k = 0; k < L100.n; k++) if (R.dist[k] >= 4 && (far < 0 || R.dist[k] > R.dist[far])) far = k;
    const fc = await page.evaluate(k => window.__game.cellCenter(k), far);
    await tapXY(cdp, fc.x, fc.y); await sleep(150);
    ok((await page.evaluate(() => window.__game.pending())) === far && (await page.evaluate(() => window.__game.state())).moves === 0, 'first tap on a small cell only aims (ring shown)');
    await tapXY(cdp, fc.x + rect.s * 0.6, fc.y); await sleep(100); await idle(page);
    ok((await page.evaluate(() => window.__game.snap())).p === far, 'second tap near the ring walks there');
    // hint = next push of the reference solution
    await tap(cdp, page, '#bRestart'); await sleep(200);
    await tap(cdp, page, '#bHint'); await sleep(150);
    const h = await page.evaluate(() => window.__game.hint());
    const T = C.initState(L100); let firstPush = null; for (const ch of LEVELS[99].s) { const r = C.tryMove(L100, T, C.DCH.indexOf(ch)); if (r && r.push) { firstPush = { b: r.bFrom, d: C.DCH.indexOf(ch) }; break; } }
    ok(h && h.b === firstPush.b && h.d === firstPush.d, 'hint shows the next push of the master solution');
    await sleep(6500);
    let still = false; for (let k = 0; k < 40 && !(still = await page.evaluate(() => window.__game.idle())); k++) await sleep(250); // last frames can lag on a loaded box
    ok(still, 'nothing moving: the canvas stops redrawing ' + JSON.stringify(await page.evaluate(() => window.__game.busyWhy())));
    // demo plays the solution, a tap stops it
    await tap(cdp, page, '#bPause'); await sleep(200); await tap(cdp, page, '#pDemo'); await sleep(1500);
    let st = await page.evaluate(() => window.__game.state());
    for (let k = 0; k < 40 && st.moves <= 3; k++) { await sleep(250); st = await page.evaluate(() => window.__game.state()); } // slow shared machines draw few frames
    ok(st.status === 'demo' && st.moves > 3, 'master demo plays (' + st.moves + ' moves)');
    await tapXY(cdp, 195, 420); await sleep(300);
    st = await page.evaluate(() => window.__game.state());
    ok(st.status === 'play' && st.moves === 0, 'a tap stops the demo and gives the level back');
    // resume after reload
    for (const ch of LEVELS[99].s.slice(0, 5)) { await page.evaluate(d => window.__game.move(d), C.DCH.indexOf(ch)); await idle(page); }
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.reload(); await sleep(500);
    ok(/繼續第 100 關/.test(await page.textContent('#tPlay')), 'title offers to continue level 100');
    await tap(cdp, page, '#tPlay'); await sleep(300);
    st = await page.evaluate(() => window.__game.state());
    ok(st.level === 100 && st.moves === 5, 'level in progress resumed after reload (' + st.moves + ' moves)');
    // last level win card has one way back to the level list
    for (const ch of LEVELS[99].s.slice(5)) await page.evaluate(d => window.__game.move(d), C.DCH.indexOf(ch));
    for (let k = 0; k < 60 && !(await page.isVisible('#win')); k++) await sleep(100);
    ok(await page.isVisible('#win') && !(await page.isVisible('#wSelect')) && /回關卡選擇/.test(await page.textContent('#wNext')), 'L100 win card: a single 回關卡選擇 button');
    ok(errors.length === 0, 'helpers: no page errors ' + errors.join(' | '));
    await ctx.close();
    // returning player from the old level set is told their stars were reset
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } }); const p2 = await c2.newPage();
    await p2.addInitScript(() => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', 1); localStorage.setItem('sokoban:v1:lvver', '2'); localStorage.setItem('sokoban:v1:prog', JSON.stringify({ 1: { m: 5, p: 2, s: 3 } })); } });
    await p2.goto('file://' + APP); await sleep(1200);
    ok(/重新設計/.test(await p2.textContent('#toast')) && await p2.isVisible('#toast'), 'level-set update notice for returning players');
    await c2.close();
  }
  // 4) cover: 390x520, a mid-game position on a mid-level room
  {
    const { ctx, page, errors } = await newPage(browser, 390, 520, false, true);
    await page.click('#tPlay'); await sleep(300);
    if (await page.isVisible('#hOk')) { await page.click('#hOk'); await sleep(200); }
    const n = 34;
    await page.evaluate(n => window.__game.go(n), n); await sleep(200);
    const sol = LEVELS[n - 1].s, cut = Math.floor(sol.length * 0.55);
    for (const ch of sol.slice(0, cut)) { await page.evaluate(d => window.__game.move(d), C.DCH.indexOf(ch)); await idle(page); }
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    ok(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover written');
    ok(errors.length === 0, 'cover: no page errors');
    await ctx.close();
  }
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL exception', e); process.exit(1); });
