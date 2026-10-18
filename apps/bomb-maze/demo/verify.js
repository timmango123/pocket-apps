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
  if (h >= 640) {
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
  await cover(browser);
  await browser.close(); srv.close();
  console.log(checks - fails + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
