// Verification for 鞭炮貓老街 (bomb-maze). Opens the page inside the lobby skeleton at 390×844 and the three
// in-lobby iframe sizes, light and dark, and drives the real UI with touch: start screen -> stage 1, joystick
// drag moves the cat, the big button plants a firecracker that explodes, pause works, the stage is cleared by the
// built-in brain (stepped deterministically), progress is saved, a battle against 3 CPUs runs to its end.
// Writes cover-390x520.png (gameplay, light) and a few result screenshots. Usage: node verify.js
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const html = SKEL + fs.readFileSync(APP, 'utf8') + '</body></html>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

async function tap(cdp, page, sel) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
}
let base = '';
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  return new Promise(r => srv.listen(0, () => { base = 'http://localhost:' + srv.address().port + '/app/bomb-maze/'; r(srv); }));
}
async function open(browser, w, h, scheme, dpr) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr || 1, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base, { waitUntil: 'load' });
  await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}
async function st(page) { return page.evaluate(() => window.__game.state()); }

async function fullFlow(browser, w, h, scheme) {
  const { ctx, page, cdp, errors } = await open(browser, w, h, scheme);
  const tag = `${w}x${h} ${scheme}`;
  ok(await page.isVisible('#ovStart'), tag + ' start screen shown');
  const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ow <= 1, tag + ' no horizontal overflow (' + ow + ')');
  const s0 = await st(page);
  ok(s0 && s0.mode === 'attract' && s0.status === 'play', tag + ' attract-mode battle running behind the menu');
  // canvas fully visible inside the viewport, controls below it and not overlapping
  const cvb = await page.locator('#cv').boundingBox(), padb = await page.locator('#pad').boundingBox(), bb = await page.locator('#bombBtn').boundingBox();
  ok(cvb.x >= 0 && cvb.y >= 0 && cvb.x + cvb.width <= w + 1 && cvb.y + cvb.height <= h + 1, tag + ' maze fully visible');
  ok(padb.y >= cvb.y + cvb.height - 1 && bb.y >= cvb.y + cvb.height - 1, tag + ' controls do not cover the maze');
  ok(padb.width >= 44 && padb.height >= 44 && bb.width >= 44 && bb.height >= 44, tag + ' touch targets big enough');
  // start stage 1 with a real tap
  await tap(cdp, page, '#startBtn');
  await page.evaluate(() => { window.__game.manual(true); window.__game.tick(1300); });
  let s = await st(page);
  ok(s.mode === 'stage' && s.playing && !(await page.isVisible('#ovStart')), tag + ' stage 1 started from the menu');
  // joystick: drag down on the pad, the cat walks down the open left lane; drag up brings it back
  const py0 = s.player.y;
  const cx = padb.x + padb.width / 2, cy = padb.y + padb.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy + 40 }] });
  await sleep(50);
  s = await page.evaluate(() => { window.__game.tick(450); return window.__game.state(); });
  ok(s.player.y > py0 + 0.5, tag + ' joystick drag down moves the cat down (' + py0.toFixed(2) + ' -> ' + s.player.y.toFixed(2) + ')');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - 40 }] });
  await sleep(50);
  const s2 = await page.evaluate(() => { window.__game.tick(450); return window.__game.state(); });
  ok(s2.player.y < s.player.y - 0.4, tag + ' joystick drag up moves the cat back up');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(50);
  const s3 = await page.evaluate(() => { window.__game.tick(300); return window.__game.state(); });
  ok(Math.abs(s3.player.y - s2.player.y) < 1e-6 && Math.abs(s3.player.x - s2.player.x) < 1e-6, tag + ' releasing the joystick stops the cat');
  // bomb button plants a firecracker; the brain runs away from it; it explodes and the cat survives
  await tap(cdp, page, '#bombBtn');
  s = await page.evaluate(() => { window.__game.tick(50); return window.__game.state(); });
  ok(s.bombs === 1, tag + ' bomb button plants a firecracker');
  ok((await page.textContent('#bombN')) === '0', tag + ' the bomb button badge counts down to 0 firecrackers left');
  if (h >= 600) {
    const info = await page.evaluate(() => { const el = document.getElementById('info'), r = el.getBoundingClientRect(), c = document.getElementById('cv').getBoundingClientRect(), p = document.getElementById('pad').getBoundingClientRect();
      return { shown: getComputedStyle(el).display !== 'none', icons: el.querySelectorAll('.mon img').length, text: el.textContent, below: r.top >= c.bottom - 1 && r.bottom <= p.top + 1 }; });
    ok(info.shown && info.icons >= 1 && /×2/.test(info.text) && info.below, tag + ' objective strip shows the monsters left between the maze and the controls ' + JSON.stringify(info));
  }
  await page.evaluate(() => window.__game.auto(true));
  let fired = false;
  for (let i = 0; i < 40 && !fired; i++) { const q = await page.evaluate(() => { window.__game.tick(100); return window.__game.state(); }); if (q.fires > 0) fired = true; }
  ok(fired, tag + ' the firecracker exploded');
  ok((await st(page)).player.alive, tag + ' the cat walked clear of its own blast');
  await page.evaluate(() => { window.__game.auto(false); window.__game.manual(false); });
  // pause button, resume
  await tap(cdp, page, '#pauseBtn');
  ok(await page.isVisible('#ovPause') && (await st(page)).paused, tag + ' pause overlay');
  const tPaused = (await st(page)).time; await sleep(400);
  ok(Math.abs((await st(page)).time - tPaused) < 1e-6, tag + ' time stands still while paused');
  await tap(cdp, page, '#resumeBtn');
  ok(!(await page.isVisible('#ovPause')), tag + ' resumed');
  // hidden page pauses the game
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(100);
  ok((await st(page)).paused && await page.isVisible('#ovPause'), tag + ' pauses when the page is hidden');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await tap(cdp, page, '#resumeBtn');
  // let the built-in brain clear stage 1 (deterministic stepping, 4 minutes of game time max)
  await page.evaluate(() => { window.__game.manual(true); window.__game.auto(true); });
  let res = null;
  for (let i = 0; i < 240 && !res; i++) {
    const q = await page.evaluate(() => { window.__game.tick(1000); return window.__game.state(); });
    if (q.status !== 'play') res = q;
  }
  ok(res && res.status === 'won', tag + ' stage 1 cleared by the built-in brain (' + (res ? res.status + ' at ' + res.time.toFixed(0) + 's' : 'timeout') + ')');
  await page.evaluate(() => window.__game.tick(1500));
  await sleep(150);
  ok(await page.isVisible('#ovResult'), tag + ' result overlay shown');
  const prog = await page.evaluate(() => window.__game.progress());
  ok(prog[1] >= 1, tag + ' progress saved (stars ' + prog[1] + ')');
  const stored = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('bomb-maze:v1:progress')); } catch (e) { return null; } });
  ok(stored && stored[1] >= 1, tag + ' progress in localStorage under bomb-maze:v1:');
  if (w === 390 && h === 610 && scheme === 'light') await page.screenshot({ path: path.join(OUT, 'result-stage1.png') });
  // next stage button goes to stage 2
  await tap(cdp, page, '#resMain');
  s = await st(page);
  ok(s.mode === 'stage' && s.status === 'play' && (await page.textContent('#hudLab')).indexOf('2') >= 0, tag + ' next stage starts');
  // level select shows the unlock
  await page.evaluate(() => window.__game.manual(false));
  await tap(cdp, page, '#pauseBtn'); await tap(cdp, page, '#quitBtn');
  ok(await page.isVisible('#ovStart'), tag + ' quit returns to the start screen');
  await tap(cdp, page, '#selectBtn');
  ok(await page.isVisible('#ovSelect'), tag + ' level select opens');
  const tiles = await page.evaluate(() => ({ n: document.querySelectorAll('.lv').length, open: document.querySelectorAll('.lv:not([disabled])').length, done: document.querySelectorAll('.lv.done').length }));
  ok(tiles.n === 100 && tiles.open === 2 && tiles.done === 1, tag + ' 100 tiles, stage 2 unlocked, stage 1 marked done ' + JSON.stringify(tiles));
  await tap(cdp, page, '#selBack');
  // battle vs 3 CPUs, played by the brain until it ends
  await tap(cdp, page, '#battleBtn');
  ok(await page.isVisible('#ovBattle'), tag + ' battle setup');
  await tap(cdp, page, '#battleGo');
  s = await st(page);
  ok(s.mode === 'battle' && s.status === 'play', tag + ' battle started');
  await page.evaluate(() => { window.__game.manual(true); window.__game.auto(true); });
  res = null;
  for (let i = 0; i < 200 && !res; i++) {
    const q = await page.evaluate(() => { window.__game.tick(1000); return window.__game.state(); });
    if (q.status !== 'play') res = q;
  }
  ok(res && res.status === 'over', tag + ' battle ended (winner ' + (res && res.winner) + ' at ' + (res && res.time.toFixed(0)) + 's)');
  await page.evaluate(() => window.__game.tick(2000));
  await sleep(150);
  ok(await page.isVisible('#ovBattleEnd'), tag + ' battle result overlay');
  if (w === 390 && h === 610) await page.screenshot({ path: path.join(OUT, 'result-battle-' + scheme + '.png') });
  ok(errors.length === 0, tag + ' no page errors: ' + errors.join(' | '));
  await ctx.close();
}

async function landscape(browser) {
  const { ctx, page, errors } = await open(browser, 844, 390, 'light');
  await page.evaluate(() => { window.__game.manual(true); window.__game.startStage(3); window.__game.tick(1400); });
  const b = await page.evaluate(() => ['pad', 'cv', 'bombBtn'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }));
  ok(b[0].r <= b[1].l + 1 && b[2].l >= b[1].r - 1, 'landscape: stick left of the maze, bomb button right of it');
  ok(b[1].t >= 0 && b[1].b <= 391 && b[0].b <= 391 && b[2].b <= 391, 'landscape: everything fits the height');
  ok(errors.length === 0, 'landscape: no page errors');
  await ctx.close();
}

async function padEdge(browser) {
  const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
  await page.evaluate(() => { window.__game.manual(true); window.__game.startStage(3); window.__game.tick(1500); });
  const b = await page.locator('#pad').boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  for (const [dx, dy, want] of [[76, 0, 1], [0, -82, 0], [-72, 8, 3]]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx + dx, y: cy + dy, id: 1 }] });
    const g = await page.evaluate(() => { window.__game.tick(20); return window.__game.sim().bombers[0].inDir; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ok(g === want, 'a thumb landing ' + Math.round(Math.hypot(dx, dy)) + ' px from the stick centre (outside the ring) still steers (' + g + ')');
  }
  ok(errors.length === 0, 'pad edge: no page errors');
  await ctx.close();
}

// 360 px wide, stage 100 with every power-up: the status bar keeps the pause button whole and it still answers a tap
async function narrowHud(browser) {
  for (const [w, h] of [[360, 640], [320, 568], [375, 667]]) {
    const { ctx, page, cdp, errors } = await open(browser, w, h, 'light');
    await page.evaluate(() => { const g = window.__game; g.manual(true); g.startStage(100); g.tick(1100); const b = g.sim().bombers[0]; b.bombs = 8; b.fire = 8; b.speed = 5.2; b.kick = true; b.shield = true; g.sim().lives = 3; g.tick(30); });
    const m = await page.evaluate(() => { const r = id => document.getElementById(id).getBoundingClientRect(), hd = r('hud'), p = r('pauseBtn'), pw = document.getElementById('hudPw');
      return { p: [p.left, p.right, p.top, p.bottom], hd: [hd.top, hd.bottom], vw: innerWidth, chips: pw.textContent, pwCut: pw.scrollWidth - pw.clientWidth }; });
    ok(m.p[1] <= m.vw && m.p[0] >= 0 && m.p[2] >= m.hd[0] - 0.5 && m.p[3] <= m.hd[1] + 0.5 && m.p[1] - m.p[0] >= 44 && m.p[3] - m.p[2] >= 44, `${w}x${h} L100 all power-ups: 44x44 pause button fully inside the bar ` + JSON.stringify(m));
    ok(m.pwCut <= 0 && /炮8/.test(m.chips) && /火8/.test(m.chips) && /鞋4/.test(m.chips) && /踢/.test(m.chips) && /符/.test(m.chips), `${w}x${h} every power-up chip readable: ` + m.chips);
    await page.evaluate(() => window.__game.manual(false));
    await tap(cdp, page, '#pauseBtn');
    ok(await page.isVisible('#ovPause'), `${w}x${h} the pause button answers a real tap at stage 100`);
    ok(errors.length === 0, `${w}x${h} narrow HUD: no page errors`);
    await ctx.close();
  }
}

// clear stage 7, result screen 選關, then 返回: the start screen shows the new numbers
async function staleStart(browser) {
  const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
  await page.evaluate(() => { localStorage.setItem('bomb-maze:v1:progress', JSON.stringify({ 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3 })); });
  await page.reload(); await sleep(400);
  ok((await page.textContent('#startN')) === '7', 'start screen offers stage 7 after 6 cleared');
  await tap(cdp, page, '#startBtn');
  await page.evaluate(() => { window.__game.manual(true); window.__game.auto(true); });
  let res = null;
  for (let i = 0; i < 300 && !res; i++) { const q = await page.evaluate(() => { window.__game.tick(1000); return window.__game.state(); }); if (q.status !== 'play') res = q; }
  ok(res && res.status === 'won', 'stage 7 cleared by the built-in brain');
  await page.evaluate(() => { window.__game.tick(1500); window.__game.auto(false); window.__game.manual(false); }); await sleep(150);
  await tap(cdp, page, '#resSelect'); await tap(cdp, page, '#selBack');
  const t = await page.evaluate(() => [document.getElementById('startN').textContent, document.getElementById('startDone').textContent]);
  ok(t[0] === '8' && t[1] === '7', 'after 選關 → 返回 the start screen says 第 8 關 and 已通過 7 (' + t + ')');
  ok(errors.length === 0, 'stale start: no page errors');
  await ctx.close();
}

// the first-stage tip shows on short screens too (in the intro banner); a touch during the intro starts at once
async function introAndHint(browser) {
  for (const [w, h] of [[375, 500], [390, 610], [390, 844]]) {
    const { ctx, page, cdp, errors } = await open(browser, w, h, 'light');
    await tap(cdp, page, '#startBtn');
    const bn = await page.evaluate(() => window.__game.banner());
    ok(bn && /放炮炸紅磚/.test(bn.sub), `${w}x${h} stage 1 intro banner carries the tip: ` + JSON.stringify(bn));
    await page.evaluate(() => window.__game.manual(true));
    await tap(cdp, page, '#bombBtn');
    const s = await page.evaluate(() => { window.__game.tick(17); return { hold: window.__game.sim().hold, bombs: window.__game.sim().bombs.length, t: window.__game.sim().time }; });
    ok(s.hold <= 0 && s.bombs === 1 && s.t < 0.1, `${w}x${h} a tap on 放炮 during the intro plants at once ` + JSON.stringify(s));
    ok(errors.length === 0, `${w}x${h} intro: no page errors`);
    await ctx.close();
  }
}

// reload in the middle of a stage: 繼續 brings back the same stage, clock and power-ups
async function resumeAfterReload(browser) {
  const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
  await page.evaluate(() => { const g = window.__game; g.startStage(12); g.manual(true); g.tick(1200); g.sim().bombers[0].fire = 5; g.auto(true); g.tick(12000); g.auto(false); });
  const before = await page.evaluate(() => { const s = window.__game.sim(); return { t: s.time, kills: s.kills, lives: s.lives, fire: s.bombers[0].fire, x: s.bombers[0].x, alive: s.enemies.filter(e => e.alive).length }; });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.reload(); await sleep(500);
  ok(await page.isVisible('#contBtn') && (await page.textContent('#contN')) === '12', 'after a reload the start screen offers 繼續第 12 關');
  await tap(cdp, page, '#contBtn');
  const after = await page.evaluate(() => { const s = window.__game.sim(); return { t: s.time, kills: s.kills, lives: s.lives, fire: s.bombers[0].fire, x: s.bombers[0].x, alive: s.enemies.filter(e => e.alive).length, paused: window.__game.state().paused }; });
  ok(Math.abs(after.t - before.t) < 0.01 && after.kills === before.kills && after.lives === before.lives && after.fire === 5 && Math.abs(after.x - before.x) < 1e-6 && after.alive === before.alive, 'resumed stage matches the saved one ' + JSON.stringify([before, after]));
  ok(after.paused && await page.isVisible('#ovPause'), 'a resumed stage waits on the pause panel');
  await tap(cdp, page, '#resumeBtn'); await sleep(1600);
  ok((await st(page)).time > before.t, 'and runs on after 繼續 (and its 1 s intro)');
  await tap(cdp, page, '#pauseBtn'); await tap(cdp, page, '#quitBtn');
  ok(!(await page.isVisible('#contBtn')), 'leaving the stage clears the saved game');
  ok(errors.length === 0, 'resume: no page errors');
  await ctx.close();
}

// clear a stage and go on: the power-ups come along; portrait cells are bigger and the camera keeps the cat in view
async function runAndCamera(browser) {
  const { ctx, page, cdp, errors } = await open(browser, 390, 844, 'light');
  await tap(cdp, page, '#startBtn');
  await page.evaluate(() => { const g = window.__game; g.manual(true); g.tick(1100); const b = g.sim().bombers[0]; b.bombs = 3; b.fire = 4; b.kick = true; g.auto(true); });
  let res = null;
  for (let i = 0; i < 240 && !res; i++) { const q = await page.evaluate(() => { window.__game.tick(1000); return window.__game.state(); }); if (q.status !== 'play') res = q; }
  await page.evaluate(() => { window.__game.tick(1500); window.__game.auto(false); }); await sleep(150);
  ok(res && res.status === 'won' && /帶著/.test(await page.textContent('#resInfo')), 'result screen says what the next stage brings along');
  await tap(cdp, page, '#resMain');
  const k = await page.evaluate(() => { const b = window.__game.sim().bombers[0]; return { bombs: b.bombs, fire: b.fire, kick: b.kick, n: window.__game.run() }; });
  ok(k.bombs >= 3 && k.fire >= 4 && k.kick, 'stage 2 starts with the power-ups from stage 1 ' + JSON.stringify(k));
  await page.evaluate(() => window.__game.startStage(24));
  const v = await page.evaluate(() => window.__game.view());
  ok(v.cell >= 30, '390x844 portrait cells are at least 30 px (' + v.cell + ')');
  const pts = [];
  for (const x of [1.5, 7.5, 13.5]) pts.push(await page.evaluate(x => { const g = window.__game; g.sim().bombers[0].x = x; g.tick(1500); const v = g.view(); return { x, px: x * v.cell - v.camX, w: v.viewW }; }, x));
  ok(pts.every(p => p.px > 0 && p.px < p.w), 'the camera keeps the cat on screen across the maze ' + JSON.stringify(pts));
  ok(errors.length === 0, 'run/camera: no page errors');
  await ctx.close();
}

// landscape: 選關 and 對戰 panels show 返回 without scrolling
async function landscapePanels(browser) {
  for (const [w, h] of [[844, 390], [667, 375]]) {
    const { ctx, page, cdp, errors } = await open(browser, w, h, 'light');
    for (const [btn, ov, back] of [['#selectBtn', 'ovSelect', 'selBack'], ['#battleBtn', 'ovBattle', 'battleBack'], ['#howBtn', 'ovHow', 'howBack']]) {
      await tap(cdp, page, btn);
      const r = await page.evaluate(([ov, back]) => { const el = document.getElementById(ov), b = document.getElementById(back).getBoundingClientRect(); return { bottom: b.bottom, h: innerHeight, scrolled: el.scrollTop }; }, [ov, back]);
      ok(r.bottom <= r.h && r.scrolled === 0, `${w}x${h} ${ov}: 返回 visible without scrolling ` + JSON.stringify(r));
      await tap(cdp, page, '#' + back);
    }
    ok(errors.length === 0, `${w}x${h} panels: no page errors`);
    await ctx.close();
  }
}

async function cover(browser) {
  const { ctx, page, errors } = await open(browser, 390, 520, 'light', 2);
  await page.evaluate(() => { window.__game.manual(true); window.__game.startStage(7); window.__game.auto(true); window.__game.tick(1400); });
  let got = false;
  for (let i = 0; i < 900 && !got; i++) {
    const q = await page.evaluate(() => { window.__game.tick(100); return window.__game.state(); });
    if (q.fires >= 5 && q.time > 6 && q.player.alive) got = true;
  }
  await sleep(120);
  await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
  ok(got, 'cover shows an explosion mid-stage');
  ok(errors.length === 0, 'cover: no page errors');
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740]];
  for (const [w, h] of sizes) for (const scheme of ['light', 'dark']) {
    try { await fullFlow(browser, w, h, scheme); } catch (e) { fails++; console.log('FAIL', w + 'x' + h, scheme, 'threw', e.message.split('\n')[0]); }
  }
  await landscape(browser);
  await padEdge(browser);
  for (const f of [narrowHud, staleStart, introAndHint, resumeAfterReload, runAndCamera, landscapePanels]) {
    try { await f(browser); } catch (e) { fails++; console.log('FAIL', f.name, 'threw', e.message.split('\n')[0]); }
  }
  await cover(browser);
  await browser.close(); srv.close();
  console.log(checks - fails + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
