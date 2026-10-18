// Verification for 生態水族箱 (eco-aquarium): opens the page at 390×844 and the three in-lobby iframe sizes, light and dark,
// asserts no page errors, drives the main flows (feed, water change, light, add/remove species, stats, fish card, offline catch-up),
// writes screenshots and demo/cover-390x520.png (the lobby cover, showing the tank with sample life).
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = path.resolve(__dirname, '..', 'index.html'), OUT = __dirname;
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const html = SKELETON + fs.readFileSync(APP, 'utf8') + '</body></html>';
  const srv = require('http').createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); });
  await new Promise(r => srv.listen(0, r)); const URL = 'http://localhost:' + srv.address().port + '/app/eco-aquarium/';
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const sizes = [[390, 844], [375, 500], [390, 610], [430, 740]];
  for (const scheme of ['dark', 'light']) for (const [w, h] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(URL, { waitUntil: 'load' }); await sleep(900);
    const tap = sel => page.evaluate(s => document.querySelector(s).click(), sel);
    const st = () => page.evaluate(() => { const s = window.__eco.st; return { fish: s.fish.length, food: s.food.length, light: s.light, nitrate: s.water.nitrate, plants: s.plants.length, cleaners: s.cleaners.length, t: s.t }; });
    ok(await page.isVisible('#intro'), `${w}x${h} ${scheme}: intro shown on first open`);
    await tap('#bStart');
    const a = await st();
    ok(a.fish >= 17 && a.plants >= 7 && a.cleaners === 5, `${w}x${h} ${scheme}: sample tank populated (${a.fish} fish)`);
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(ow <= 1, `${w}x${h} ${scheme}: no horizontal overflow (${ow}px)`);
    // all bar buttons inside the viewport
    const boxes = await page.evaluate(() => [...document.querySelectorAll('.bar button, .top button')].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, r.width, r.height]; }));
    ok(boxes.every(b => b[0] >= 0 && b[1] >= 0 && b[2] <= w + 0.5 && b[3] <= h + 0.5 && b[4] >= 44 && b[5] >= 44), `${w}x${h} ${scheme}: all controls on screen and at least 44px ${JSON.stringify(boxes.map(b => b.map(Math.round)))}`);
    await tap('#bFeed'); const b = await st(); ok(b.food === a.food + 8, `${w}x${h} ${scheme}: feeding drops flakes`);
    await tap('#bLight'); ok((await st()).light === (a.light + 1) % 4, `${w}x${h} ${scheme}: light cycles`);
    await page.evaluate(() => { window.__eco.st.water.nitrate = 50; }); await tap('#bWater');
    ok(Math.abs((await st()).nitrate - 35) < 0.6, `${w}x${h} ${scheme}: water change dilutes`);
    await tap('#bLife'); await sleep(150);
    ok(await page.isVisible('#sheetLife'), `${w}x${h} ${scheme}: life sheet opens`);
    const sheetBox = await page.evaluate(() => { const r = document.querySelector('#sheetLife').getBoundingClientRect(); return [r.top, r.bottom, r.height]; });
    ok(sheetBox[0] >= 0 && sheetBox[1] <= h + 0.5, `${w}x${h} ${scheme}: sheet fits the viewport`);
    await tap('button[data-add="fish:betta"]'); ok((await st()).fish === a.fish + 1, `${w}x${h} ${scheme}: added a betta`);
    await tap('button[data-add="plant:moss"]'); ok((await st()).plants === a.plants + 1, `${w}x${h} ${scheme}: planted moss`);
    await tap('button[data-rem="fish:betta"]'); ok((await st()).fish === a.fish, `${w}x${h} ${scheme}: removed the betta`);
    if (w === 390 && h === 844 && scheme === 'dark') await page.screenshot({ path: path.join(OUT, 'shot-life.png') });
    await tap('#sheetLife [data-close]');
    await tap('#bStats'); await sleep(250);
    ok(await page.isVisible('#graph') && (await page.textContent('#logList')).length > 0, `${w}x${h} ${scheme}: stats sheet with graph and log`);
    if (w === 375 && scheme === 'dark') await page.screenshot({ path: path.join(OUT, 'shot-stats-375.png') });
    await tap('#sheetStats [data-close]');
    // tap a fish with a real touch
    const pt = await page.evaluate(() => { const s = window.__eco.st, S = window.__eco.S(); const f = s.fish.filter(x => x.size >= 1 && x.y * S > 90 && x.y * S < innerHeight - 90).sort((p, q) => q.size - p.size)[0]; return f ? { x: f.x * S, y: f.y * S, name: f.name } : null; });
    if (pt) {
      await page.touchscreen.tap(pt.x, pt.y); await sleep(200);
      const shown = await page.isVisible('#card');
      ok(shown && (await page.textContent('#card')).includes(pt.name), `${w}x${h} ${scheme}: touching a fish opens its card`);
      if (shown) { const cb = await page.evaluate(() => { const r = document.querySelector('#card').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }); ok(cb[0] >= 0 && cb[1] >= 0 && cb[2] <= w + 0.5 && cb[3] <= h + 0.5, `${w}x${h} ${scheme}: card inside the viewport`); }
      if (w === 375 && scheme === 'dark') await page.screenshot({ path: path.join(OUT, 'shot-card-375.png') });
      if (w === 430 && scheme === 'light') await page.screenshot({ path: path.join(OUT, 'shot-card-430-light.png') });
      await tap('#cClose');
    } else ok(false, `${w}x${h} ${scheme}: found a fish to tap`);
    // offline catch-up
    await page.evaluate(() => { window.__eco.save(); const k = 'eco-aquarium:v1:save'; const o = JSON.parse(localStorage.getItem(k)); o.savedAt -= 20 * 60 * 1000; localStorage.setItem(k, JSON.stringify(o)); window.__eco.load(); });
    await sleep(100);
    const after = await st();
    ok(after.t - a.t > 2 * 86400 - 1000 && (await page.textContent('#toasts')).includes('離開'), `${w}x${h} ${scheme}: offline catch-up (capped 2 days) with notice`);
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, `shot-${w}x${h}-${scheme}.png`) });
    ok(errors.length === 0, `${w}x${h} ${scheme}: no page errors (${errors.join(' | ')})`);
    await ctx.close();
  }
  // cover: sample tank, light on, a flake drop and an open fish card, 390×520
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(URL, { waitUntil: 'load' }); await sleep(600);
    await page.evaluate(() => { document.querySelector('#bStart').click(); window.__eco.feed(); });
    await sleep(1400);
    await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
    await ctx.close();
  }
  srv.close();
  await Promise.race([browser.close(), sleep(5000)]);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL', e.message); console.log(pass + ' passed, ' + (fail + 1) + ' failed'); process.exit(1); });
