// Verification for 坦克大戰 (tank-battle). Opens the page inside the lobby skeleton at 390×844, the three in-lobby
// iframe sizes and landscape, light and dark, and drives the real UI with touch: start screen -> level 1, joystick
// drag moves the tank and releasing stops it, the fire button fires (8 taps/s: every tap is a shell), pause and
// resume, the level is cleared by the built-in brain (stepped deterministically), progress survives a reload, level
// select, a lost level explains why. Writes cover-390x520.png (gameplay, light) and a few screenshots.
// Usage: node verify.js
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const html = SKEL + fs.readFileSync(APP, 'utf8') + '</body></html>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
let base = '', external = 0;
function serve() {
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  return new Promise(r => srv.listen(0, () => { base = 'http://localhost:' + srv.address().port + '/app/tank-battle/'; r(srv); }));
}
async function open(browser, w, h, scheme, dpr, ctxIn) {
  const ctx = ctxIn || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr || 1, isMobile: true, hasTouch: true, colorScheme: scheme });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) external++; });
  const t0 = Date.now();
  await page.goto(base, { waitUntil: 'load' });
  const loadMs = Date.now() - t0;
  await sleep(400);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors, loadMs };
}
const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tap(cdp, page, sel, hold) {
  const b = await page.locator(sel).boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await touch(cdp, 'touchStart', [{ x, y, id: 9 }]); await sleep(hold || 50); await touch(cdp, 'touchEnd', [{ x, y, id: 9 }]); await sleep(90);
}
const st = page => page.evaluate(() => window.__game.state());
const tick = (page, ms) => page.evaluate(ms => { window.__game.tick(ms); return window.__game.state(); }, ms);

async function fullFlow(browser, w, h, scheme) {
  const tag = `${w}x${h} ${scheme}`;
  const { ctx, page, cdp, errors, loadMs } = await open(browser, w, h, scheme, 2);
  ok(loadMs < 1500, tag + ' loads fast (' + loadMs + ' ms)');
  ok(await page.isVisible('#ovStart'), tag + ' start screen shown');
  const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ow <= 1, tag + ' no horizontal overflow (' + ow + ')');
  const s0 = await st(page);
  ok(s0 && s0.mode === 'attract', tag + ' demo battle runs behind the menu');
  const cvb = await page.locator('#cv').boundingBox(), padb = await page.locator('#pad').boundingBox(), fb = await page.locator('#fireBtn').boundingBox(), hud = await page.locator('#hud').boundingBox();
  ok(cvb.x >= 0 && cvb.y >= hud.y + hud.height - 1 && cvb.x + cvb.width <= w + 1 && cvb.y + cvb.height <= h + 1, tag + ' battlefield fully visible below the HUD');
  ok(padb.y >= cvb.y + cvb.height - 1 && fb.y >= cvb.y + cvb.height - 1 && padb.y + padb.height <= h + 1 && fb.y + fb.height <= h + 1, tag + ' controls below the battlefield and on screen');
  ok(padb.width >= 44 && fb.width >= 44 && padb.x + padb.width <= fb.x, tag + ' controls big and apart');
  ok(cvb.width >= Math.min(w, h - 200) * 0.8, tag + ' battlefield uses the space (' + Math.round(cvb.width) + 'px)');
  // start level 1 with a real tap
  await tap(cdp, page, '#startBtn');
  await page.evaluate(() => window.__game.manual(true));
  // the intro card does not swallow input: a fire tap and a short 250 ms push right after 出擊 both count
  const pb0 = await page.locator('#pad').boundingBox(), fb0 = await page.locator('#fireBtn').boundingBox();
  let sh0 = await page.evaluate(() => window.__game.inputStats().shots);
  await touch(cdp, 'touchStart', [{ x: fb0.x + fb0.width / 2, y: fb0.y + fb0.height / 2, id: 2 }]); await touch(cdp, 'touchEnd', [{ x: fb0.x + fb0.width / 2, y: fb0.y + fb0.height / 2, id: 2 }]);
  let sb = await tick(page, 100), sh1 = await page.evaluate(() => window.__game.inputStats().shots);
  ok(sh1 === sh0 + 1 && sb.hold <= 0, tag + ' a fire tap during the intro card fires and ends the card (' + (sh1 - sh0) + ' shell)');
  const yb = sb.player.y; await touch(cdp, 'touchStart', [{ x: pb0.x + pb0.width / 2, y: pb0.y + pb0.height / 2, id: 1 }]); await touch(cdp, 'touchMove', [{ x: pb0.x + pb0.width / 2, y: pb0.y + pb0.height / 2 - 45, id: 1 }]);
  sb = await tick(page, 250); await touch(cdp, 'touchEnd', [{ x: pb0.x + pb0.width / 2, y: pb0.y + pb0.height / 2 - 45, id: 1 }]);
  ok(sb.player.y < yb - 0.5, tag + ' a 250 ms push right after the start moves the tank (' + yb.toFixed(2) + ' -> ' + sb.player.y.toFixed(2) + ')');
  let s = await tick(page, 1700);
  ok(s.mode === 'stage' && s.level === 1 && s.playing && s.hold <= 0 && !(await page.isVisible('#ovStart')), tag + ' level 1 started from the menu');
  // joystick: drag up, the tank drives up; release stops it
  const y0 = s.player.y, cx = padb.x + padb.width / 2, cy = padb.y + padb.height / 2;
  await touch(cdp, 'touchStart', [{ x: cx, y: cy, id: 1 }]); await touch(cdp, 'touchMove', [{ x: cx, y: cy - 45, id: 1 }]); await sleep(40);
  s = await tick(page, 400);
  ok(s.player.y < y0 - 1 && s.player.dir === 0, tag + ' joystick up drives the tank up (' + y0.toFixed(2) + ' -> ' + s.player.y.toFixed(2) + ')');
  await touch(cdp, 'touchMove', [{ x: cx - 45, y: cy, id: 1 }]); await sleep(40);
  const s2 = await tick(page, 300);
  ok(s2.player.x < s.player.x - 0.3 && s2.player.dir === 3, tag + ' joystick left turns and drives left (' + s.player.x.toFixed(2) + ' -> ' + s2.player.x.toFixed(2) + ')');
  await touch(cdp, 'touchEnd', [{ x: cx - 45, y: cy, id: 1 }]); await sleep(40);
  const s3 = await tick(page, 300), s4 = await tick(page, 300);
  ok(s4.player.x === s3.player.x && s4.player.y === s3.player.y, tag + ' releasing the joystick stops the tank');
  // fire: one tap = one shell, in the same frame
  let i0 = await page.evaluate(() => window.__game.inputStats());
  await tap(cdp, page, '#fireBtn');
  let i1 = await page.evaluate(() => { window.__game.tick(17); return window.__game.inputStats(); });
  ok(i1.fireDowns === i0.fireDowns + 1 && i1.shots === i0.shots + 1, tag + ' a tap on the fire button fires one shell');
  // rapid taps, 8 per second, alternating with joystick touches: none dropped, none doubled
  i0 = i1;
  for (let k = 0; k < 16; k++) {
    const fx = fb.x + fb.width / 2 + (k % 3 - 1) * 12, fy = fb.y + fb.height / 2 + (k % 2) * 10;
    await touch(cdp, 'touchStart', [{ x: fx, y: fy, id: 2 }]); await page.evaluate(() => window.__game.tick(50)); await touch(cdp, 'touchEnd', [{ x: fx, y: fy, id: 2 }]);
    await page.evaluate(() => window.__game.tick(75));
    if (k % 4 === 3) { await touch(cdp, 'touchStart', [{ x: cx, y: cy + 40, id: 1 }]); await page.evaluate(() => window.__game.tick(30)); await touch(cdp, 'touchEnd', [{ x: cx, y: cy + 40, id: 1 }]); }
  }
  i1 = await page.evaluate(() => { window.__game.tick(300); return window.__game.inputStats(); });
  ok(i1.fireDowns - i0.fireDowns === 16 && i1.shots - i0.shots === 16, tag + ' 16 taps at 8/s with joystick touches in between -> 16 presses, 16 shells (' + (i1.fireDowns - i0.fireDowns) + ', ' + (i1.shots - i0.shots) + ')');
  // pause / resume
  await tap(cdp, page, '#pauseBtn');
  ok(await page.isVisible('#ovPause') && (await st(page)).paused, tag + ' pause opens');
  await tap(cdp, page, '#resumeBtn');
  ok(!(await page.isVisible('#ovPause')) && !(await st(page)).paused, tag + ' resume closes the pause sheet');
  // the brain clears the level
  await page.evaluate(() => window.__game.auto(true));
  let won = false;
  for (let k = 0; k < 120 && !won; k++) { s = await tick(page, 2000); if (s.status !== 'play') won = s.status === 'won'; }
  ok(won, tag + ' level 1 cleared by the built-in brain (' + s.status + ' ' + s.reason + ')');
  await tick(page, 2500);
  ok(await page.isVisible('#ovResult'), tag + ' result sheet shown');
  ok((await page.textContent('#resTitle')).includes('任務完成') && (await page.locator('#resStars svg.on').count()) >= 1, tag + ' result shows stars');
  if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-win-${scheme}.png`) });
  const pr = await page.evaluate(() => window.__game.progress());
  ok(pr.prog[1] >= 1 && pr.best[1] > 0, tag + ' progress and best score saved');
  // reload: progress persists, the start button offers level 2
  await page.reload({ waitUntil: 'load' }); await sleep(300);
  ok((await page.textContent('#startN')).trim() === '2' && (await page.textContent('#startDone')).trim() === '1', tag + ' progress survives a reload');
  // level select
  await tap(cdp, page, '#selectBtn');
  ok(await page.isVisible('#ovSelect') && await page.locator('.lv').count() === 10 && await page.locator('.chaps button').count() === 10, tag + ' level select with 10 chapters × 10 levels');
  ok(await page.locator('.lv[data-n="3"]').isDisabled() && !(await page.locator('.lv[data-n="2"]').isDisabled()), tag + ' locked levels are locked');
  if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-select-${scheme}.png`) });
  await tap(cdp, page, '.lv[data-n="2"]');
  await page.evaluate(() => window.__game.manual(true));
  s = await tick(page, 1700);
  ok(s.level === 2 && s.mode === 'stage', tag + ' level 2 started from the select screen');
  // refresh mid-level: the level is kept and comes back on the pause sheet
  s = await tick(page, 4000); const tSaved = s.time, kSaved = s.kills;
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.reload({ waitUntil: 'load' }); await sleep(300);
  ok((await page.textContent('#startVerb')).trim() === '繼續' && (await page.textContent('#startN')).trim() === '2', tag + ' after a refresh mid-level the start button offers 繼續 第 2 關');
  await tap(cdp, page, '#startBtn');
  s = await st(page);
  ok(await page.isVisible('#ovPause') && s.level === 2 && s.paused && Math.abs(s.time - tSaved) < 0.05 && s.kills === kSaved, tag + ' 繼續 restores the level where it was, paused (t ' + tSaved.toFixed(2) + ' -> ' + s.time.toFixed(2) + ')');
  await tap(cdp, page, '#resumeBtn'); await page.evaluate(() => window.__game.manual(true));
  s = await tick(page, 500);
  ok(s.level === 2 && s.time > tSaved && !s.paused, tag + ' the restored level plays on');
  // lose: the base falls -> result explains why
  await page.evaluate(() => { const g = window.__game.sim(); g.baseHp = 1; g.status = 'lost'; g.reason = 'base'; g.events.push({ t: 'lost', reason: 'base' }); });
  await tick(page, 3000);
  ok(await page.isVisible('#ovResult') && (await page.textContent('#resTitle')).includes('失敗') && (await page.textContent('#resReason')).includes('基地'), tag + ' a lost level says why');
  if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-lose-${scheme}.png`) });
  await tap(cdp, page, '#resSelect');
  ok(await page.isVisible('#ovSelect'), tag + ' result -> level select');
  await tap(cdp, page, '#selBack');
  // how-to
  await tap(cdp, page, '#howBtn');
  ok(await page.isVisible('#ovHow'), tag + ' how-to opens');
  const hb = await page.locator('#howBack').boundingBox();
  ok(hb && hb.y + hb.height <= h + 1 || await page.evaluate(() => document.getElementById('ovHow').scrollHeight > document.getElementById('ovHow').clientHeight), tag + ' how-to button reachable');
  if (w === 390 && h === 844) await page.screenshot({ path: path.join(OUT, `shot-how-${scheme}.png`) });
  ok(errors.length === 0, tag + ' no page errors: ' + errors.join(' | '));
  await ctx.close();
}

async function quick(browser, w, h, scheme) {
  const tag = `${w}x${h} ${scheme}`;
  const { ctx, page, cdp, errors } = await open(browser, w, h, scheme, 2);
  const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ow <= 1, tag + ' no horizontal overflow');
  const sb = await page.locator('#startBtn').boundingBox();
  ok(sb && sb.y >= 0 && sb.y + sb.height <= h, tag + ' start button on screen');
  await page.screenshot({ path: path.join(OUT, `shot-start-${w}x${h}-${scheme}.png`) });
  await tap(cdp, page, '#startBtn');
  await page.evaluate(() => { window.__game.manual(true); window.__game.auto(true); window.__game.tick(9000); });
  const cvb = await page.locator('#cv').boundingBox(), padb = await page.locator('#pad').boundingBox(), fb = await page.locator('#fireBtn').boundingBox();
  const ovl = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  ok(cvb.x >= 0 && cvb.y >= 0 && cvb.x + cvb.width <= w + 1 && cvb.y + cvb.height <= h + 1, tag + ' battlefield fully visible');
  ok(!ovl(cvb, padb) && !ovl(cvb, fb) && !ovl(padb, fb), tag + ' joystick, fire button and battlefield do not overlap');
  ok(padb.y + padb.height <= h + 1 && fb.y + fb.height <= h + 1 && padb.x >= 0 && fb.x + fb.width <= w + 1, tag + ' controls on screen');
  await page.screenshot({ path: path.join(OUT, `shot-play-${w}x${h}-${scheme}.png`) });
  ok(errors.length === 0, tag + ' no page errors: ' + errors.join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  await fullFlow(browser, 390, 844, 'light');
  await fullFlow(browser, 375, 500, 'dark');
  for (const [w, h] of [[375, 500], [390, 610], [430, 740], [360, 640], [430, 932], [844, 390]]) for (const sc of ['light', 'dark']) await quick(browser, w, h, sc);
  // cover: real gameplay mid-battle, light
  {
    const { ctx, page, errors } = await open(browser, 390, 520, 'light', 2);
    await page.evaluate(() => { try { localStorage.setItem('tank-battle:v1:played', 'true'); } catch (e) {} });
    await page.evaluate(() => { window.__game.startStage(12); window.__game.manual(true); window.__game.auto(true); window.__game.tick(1700); });
    // play until the field is busy (several enemies, shells in flight), then grab the frame
    let bestS = -1;
    for (let k = 0; k < 90; k++) {
      const s = await page.evaluate(() => { window.__game.tick(150); const st = window.__game.state(), sm = window.__game.sim(), G = sm.grid;
        // enemies the eye can see: done spawning and not hidden under trees
        st.seen = sm.tanks.filter((t, i) => i && t.alive && t.spawnT <= 0 && G[Math.floor(t.y + 1) * 26 + Math.floor(t.x + 1)] !== 4).length; return st; });
      const score = s.seen * 4 + Math.min(4, s.bullets) + (s.player.alive ? 3 : -20);
      if (s.status !== 'play') break;
      if (score > bestS && k > 10) { bestS = score; await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') }); }
    }
    ok(fs.existsSync(path.join(OUT, 'cover-390x520.png')), 'cover written');
    ok(errors.length === 0, 'cover: no page errors');
    await ctx.close();
  }
  ok(external === 0, 'no external requests (' + external + ')');
  await browser.close(); srv.close();
  console.log(checks - fails + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
