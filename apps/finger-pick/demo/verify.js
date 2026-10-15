// Verify finger-pick: node verify.js  (multi-touch simulated with CDP Input.dispatchTouchEvent)
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const mk = async (o = {}) => {
    const vp = o.viewport || { width: 390, height: 844 };
    const ctx = await browser.newContext({ viewport: vp, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, deviceScaleFactor: 2, colorScheme: o.dark ? 'dark' : 'light', reducedMotion: o.reduce ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage(); const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    // Playwright reports maxTouchPoints = 1; emulate a 10-point phone screen like real devices
    if (o.mobile !== false) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    await page.goto(URL); await page.waitForTimeout(200);
    ok(await page.evaluate(() => innerWidth) === vp.width, `innerWidth == ${vp.width}`);
    const stage = await (await page.$('#stage')).boundingBox();
    const pts = list => list.map(([id, x, y]) => ({ id, x: stage.x + x, y: stage.y + y, radiusX: 10, radiusY: 10, force: 1 }));
    const touch = async (type, list) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts(list || []) });
    return { ctx, page, errors, touch, stage };
  };
  ok(!fs.readFileSync(SRC, 'utf8').includes('�'), 'no U+FFFD in source');
  const P = page => page.evaluate(() => window.__fp.phase);

  // pure decision checks
  {
    const { ctx, page, errors } = await mk();
    const r = await page.evaluate(() => {
      const D = window.__fp.decide, ids = ['a', 'b', 'c', 'd', 'e'];
      const cnt = { a: 0, b: 0, c: 0, d: 0, e: 0 };
      for (let i = 0; i < 50000; i++) cnt[[...D(ids, 'pick1', 1).chosen][0]]++;
      const t = D(ids, 'teams', 2); const sizes = [0, 0]; t.team.forEach(v => sizes[v]++);
      const o = D(ids, 'order', 0); const ranks = [...o.rank.values()].sort().join('');
      const k = D(ids, 'pickk', 3).chosen.size;
      return { dev: Math.max(...Object.values(cnt).map(c => Math.abs(c / 50000 - 0.2))), sizes: sizes.sort().join('/'), ranks, k };
    });
    ok(r.dev < 0.01, `pick1 uniform over 5 fingers, 50000 runs (max deviation ${r.dev.toFixed(4)})`);
    ok(r.sizes === '2/3' && r.ranks === '12345' && r.k === 3, `teams 5 into 2 -> ${r.sizes}; order ranks ${r.ranks}; pick 3 -> ${r.k}`);
    ok(errors.length === 0, 'no errors (logic)');
    await ctx.close();
  }

  // full multi-touch flow at 390x844
  {
    const { ctx, page, errors, touch } = await mk();
    // speed up: stable 1s, countdown 1s
    await page.click('#settings-btn');
    await page.click('#cd-minus'); await page.click('#cd-minus');
    await page.click('#st-minus');
    ok((await page.textContent('#cd-val')) === '1 秒' && (await page.textContent('#st-val')) === '1 秒', 'settings: countdown 1s, stable 1s');
    await page.screenshot({ path: `${OUT}/390x844-settings.png` });
    await page.click('#set-done');
    await page.screenshot({ path: `${OUT}/390x844.png` });

    // 1 finger: not enough
    await touch('touchStart', [[1, 80, 200]]);
    await sleep(150);
    ok((await page.textContent('#detect')).includes('1') && /需要更多手指/.test(await page.textContent('#msg')), '1 finger -> "需要更多手指"');
    // 5 fingers
    const five = [[1, 80, 200], [2, 290, 180], [3, 180, 330], [4, 90, 470], [5, 280, 500]];
    await touch('touchStart', five); await sleep(150);
    ok((await page.textContent('#detect')).includes('5') && await P(page) === 'stable', `5 fingers detected, phase stable`);
    // move a finger: rings follow
    const moved = five.map(p => p[0] === 3 ? [3, 200, 360] : p);
    await touch('touchMove', moved); await sleep(50);
    const pos = await page.evaluate(() => { const t = [...window.__fp.touches.values()][2]; return [Math.round(t.x), Math.round(t.y)]; });
    ok(pos[0] === 200 && pos[1] === 360, `ring follows finger to ${pos}`);
    await sleep(1100);
    ok(await P(page) === 'countdown', 'countdown after 1s stable');
    await page.screenshot({ path: `${OUT}/390x844-countdown.png` });
    // lift one finger during countdown -> cancel and restart stability
    const four = moved.filter(p => p[0] !== 5);
    await touch('touchEnd', [[5, 280, 500]]); await sleep(100);  // lift finger 5 only
    ok(await P(page) === 'stable' && (await page.textContent('#detect')).includes('4'), 'lifting a finger mid-countdown cancels it (back to stable wait)');
    // add a finger during countdown also cancels
    await sleep(1050);
    ok(await P(page) === 'countdown', 'countdown again');
    await touch('touchStart', [[6, 300, 620]]); await sleep(100);
    ok(await P(page) === 'stable', 'adding a finger mid-countdown cancels it');
    await sleep(2300);
    ok(await P(page) === 'result', 'result after stable + countdown');
    const chosen = await page.evaluate(() => [...window.__fp.touches.values()].filter(t => t.chosen).length);
    ok(chosen === 1, `pick1 chose exactly ${chosen}`);
    await sleep(500);
    await page.screenshot({ path: `${OUT}/390x844-result.png` });
    // new finger after result does not change it
    await touch('touchStart', [[7, 200, 700]]); await sleep(100);
    const after = await page.evaluate(() => ({ chosen: [...window.__fp.touches.values()].filter(t => t.chosen).length, late: [...window.__fp.touches.values()].filter(t => t.late).length, ph: window.__fp.phase }));
    ok(after.chosen === 1 && after.late === 1 && after.ph === 'result', 'finger added after result is ignored (late)');
    // release all -> reset after 0.5s
    await touch('touchEnd', []); await sleep(200);
    ok(await P(page) === 'result', 'still showing result 0.2s after release');
    await sleep(500);
    ok(await P(page) === 'wait' && (await page.textContent('#detect')).includes('0'), 'reset 0.5s after all fingers lifted');

    // teams mode K=2 with 5 fingers
    await page.click('#mode-teams');
    ok(await page.isVisible('#kbox') && (await page.textContent('#k-val')) === '2', 'teams mode shows K stepper (2)');
    await touch('touchStart', five); await sleep(2300);
    const teams = await page.evaluate(() => { const s = [0, 0]; window.__fp.touches.forEach(t => s[t.team]++); return s.sort().join('/'); });
    ok(await P(page) === 'result' && teams === '2/3', `5 fingers into 2 teams -> ${teams}`);
    await sleep(500); await page.screenshot({ path: `${OUT}/390x844-teams.png` });
    await touch('touchEnd', []); await sleep(700);

    // pick K=2 with only 2 fingers -> needs more
    await page.click('#mode-pickk');
    await touch('touchStart', [[1, 100, 200], [2, 250, 300]]); await sleep(2300);
    ok(await P(page) === 'wait' && /需要更多手指/.test(await page.textContent('#msg')), 'pick 2 with 2 fingers -> "需要更多手指", no pick');
    await touch('touchStart', [[3, 180, 450]]); await sleep(2300);
    const pk = await page.evaluate(() => [...window.__fp.touches.values()].filter(t => t.chosen).length);
    ok(await P(page) === 'result' && pk === 2, `pick 2 of 3 -> ${pk} chosen`);
    await touch('touchEnd', []); await sleep(700);

    // order mode
    await page.click('#mode-order');
    await touch('touchStart', five.slice(0, 4)); await sleep(2300);
    const ranks = await page.evaluate(() => [...window.__fp.touches.values()].map(t => t.rank).sort().join(''));
    ok(ranks === '1234', `order mode ranks ${ranks}`);
    await sleep(400); await page.screenshot({ path: `${OUT}/390x844-order.png` });
    await touch('touchEnd', []); await sleep(700);
    // no page scroll/zoom from touches
    const sc = await page.evaluate(() => [scrollX, scrollY, visualViewport ? visualViewport.scale : 1, document.documentElement.scrollWidth <= innerWidth]);
    ok(sc[0] === 0 && sc[1] === 0 && sc[2] === 1 && sc[3], `no scroll/zoom after multi-touch (${sc})`);
    // settings persist
    await page.reload(); await page.waitForTimeout(200);
    ok(await page.evaluate(() => window.__fp.S.mode === 'order' && window.__fp.S.countdownSec === 1), 'settings persisted');
    ok(errors.length === 0, `flow no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // desktop mouse simulation
  {
    const { ctx, page, errors, stage } = await mk({ viewport: { width: 1280, height: 800 }, mobile: false });
    ok(await page.evaluate(() => navigator.maxTouchPoints) === 0 && /沒有觸控/.test(await page.textContent('#msg')), 'desktop without touch -> simulation hint');
    await page.evaluate(() => { window.__fp.S.stableSec = 1; window.__fp.S.countdownSec = 1; });
    await page.screenshot({ path: `${OUT}/1280x800.png` });
    await page.mouse.click(stage.x + 300, stage.y + 300);
    await page.mouse.click(stage.x + 700, stage.y + 250);
    await page.mouse.click(stage.x + 500, stage.y + 450);
    await page.mouse.click(stage.x + 500, stage.y + 450);  // removes the third dot
    ok(await page.evaluate(() => window.__fp.touches.size) === 2, 'mouse: click adds, click again removes');
    await sleep(2300);
    ok(await P(page) === 'result', 'mouse simulation reaches result');
    await sleep(400); await page.screenshot({ path: `${OUT}/1280x800-result.png` });
    await page.mouse.click(stage.x + 50, stage.y + 50);
    ok(await P(page) === 'wait' && await page.evaluate(() => window.__fp.touches.size) === 0, 'click after result clears and restarts');
    ok(errors.length === 0, `desktop no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // other sizes + dark
  for (const s of [{ name: '360x780', viewport: { width: 360, height: 780 } }, { name: '844x390', viewport: { width: 844, height: 390 } }, { name: '390x844-dark', viewport: { width: 390, height: 844 }, dark: true }]) {
    const { ctx, page, errors, touch } = await mk(s);
    await page.evaluate(() => { window.__fp.S.stableSec = 1; window.__fp.S.countdownSec = 1; });
    const w = s.viewport.width, h = s.viewport.height;
    const sw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth, document.documentElement.scrollHeight, innerHeight]);
    ok(sw[0] <= sw[1] && sw[2] <= sw[3], `${s.name} no page scroll (${sw})`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.w < 44 || r.h < 44));
    ok(small.length === 0, `${s.name} touch targets >= 44px ${JSON.stringify(small)}`);
    const tiny = await page.evaluate(() => [...document.querySelectorAll('.app *')].filter(e => e.offsetParent && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 11).length);
    ok(tiny === 0, `${s.name} text >= 11px`);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    if (s.dark) {
      await touch('touchStart', [[1, 80, 200], [2, 280, 260], [3, 160, 420]]); await sleep(2400);
      await page.screenshot({ path: `${OUT}/390x844-dark-result.png` });
      await touch('touchEnd', []);
    } else if (w > h) {
      await touch('touchStart', [[1, 120, 100], [2, 380, 150], [3, 640, 120]]); await sleep(1200);
      await page.screenshot({ path: `${OUT}/${s.name}-countdown.png` });
      await touch('touchEnd', []);
    }
    ok(errors.length === 0, `${s.name} no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }
  await browser.close();
  fs.unlinkSync(WRAP);
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
