// Browser check for 指南針 with synthetic orientation events. Run: node verify.js [--cover]
// Writes screenshots next to this file (not committed) and, with --cover, apps/tool-hub/covers/compass.jpg.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname, COVER = process.argv.includes('--cover');
let n = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FEEDER = () => {
  window.__fd = { abs: null, rel: null, jitter: 0 };
  setInterval(() => {
    const f = window.__fd, j = () => (Math.random() - 0.5) * f.jitter;
    if (f.abs) dispatchEvent(new DeviceOrientationEvent('deviceorientationabsolute', { ...f.abs, alpha: (f.abs.alpha + j() + 360) % 360, absolute: true }));
    if (f.rel) { const e = new DeviceOrientationEvent('deviceorientation', f.rel); if (f.rel.webkitCompassHeading != null) { Object.defineProperty(e, 'webkitCompassHeading', { value: f.rel.webkitCompassHeading }); Object.defineProperty(e, 'webkitCompassAccuracy', { value: f.rel.webkitCompassAccuracy }); } dispatchEvent(e); }
  }, 16);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts = {}, init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opts });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    if (init) await page.addInitScript(init);
    await page.goto(URL); await sleep(200);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[0] <= w[1], `no horizontal scroll at ${w[1]}px (${w})`);
    await page.evaluate(FEEDER);
    return { ctx, page };
  };
  const feed = (page, k, v) => page.evaluate(([k, v]) => { window.__fd[k] = v; }, [k, v]);
  const txt = (page, s) => page.locator(s).innerText();
  const deg = async page => parseInt(await txt(page, '#hDeg'), 10);
  const rose = page => page.evaluate(() => parseFloat(document.getElementById('rose').getAttribute('transform').match(/rotate\(([-\d.]+)/)[1]));
  const settle = () => sleep(700);
  try {
    {
      const { ctx, page } = await mk();
      await feed(page, 'abs', { alpha: 233, beta: 0, gamma: 0 }); await sleep(300);
      assert(await txt(page, '#hDeg') === '—°', 'nothing read before tapping 啟用指南針');
      assert(await page.locator('#goBtn').evaluate(e => e.getBoundingClientRect().height) >= 56, 'start button 56px');
      const dial = await page.locator('#dialbox').boundingBox();
      assert(Math.round(dial.width) === 300 && dial.x >= 16 && dial.x + dial.width <= 374, 'dial is 300px and centred at 390px');
      await page.screenshot({ path: OUT + '/390x844-gate.png' });

      await page.click('#goBtn'); await settle();
      assert(await deg(page) === 127 && await txt(page, '#hName') === '東南', 'Android absolute alpha 233 -> 127° 東南');
      assert(Math.abs(await rose(page) + 127) < 0.5, 'dial rotated by -heading');
      assert(await page.locator('#gate').isHidden() && await page.locator('#tgtBtn').isVisible(), 'gate hidden, target button shown');
      assert((await txt(page, '#accText')) === '精度良好', 'steady readings -> 精度良好');
      // tilt compensation: pitching up / rolling does not move the heading
      await feed(page, 'abs', { alpha: 233, beta: 40, gamma: 0 }); await settle();
      assert(await deg(page) === 127, 'pitched 40° still 127°');
      await feed(page, 'abs', { alpha: 233, beta: 0, gamma: 50 }); await settle();
      assert(await deg(page) === 127 && (await txt(page, '#accText')).includes('放平'), 'rolled 50° still 127°, with 請將手機放平');
      await feed(page, 'abs', { alpha: 233, beta: 2, gamma: -1 }); await settle();

      // wrap: 355 -> 5 takes the short way (rose angle moves continuously)
      await feed(page, 'abs', { alpha: 5, beta: 0, gamma: 0 }); await sleep(1200);
      assert(await deg(page) === 355, 'alpha 5 -> 355°');
      const a0 = await rose(page);
      const track = page.evaluate(() => new Promise(res => { const v = []; const t0 = performance.now(); const f = () => { v.push(parseFloat(document.getElementById('rose').getAttribute('transform').match(/rotate\(([-\d.]+)/)[1])); if (performance.now() - t0 < 900) requestAnimationFrame(f); else res(v); }; requestAnimationFrame(f); }));
      await feed(page, 'abs', { alpha: 355, beta: 0, gamma: 0 });
      const path1 = await track;
      const span = Math.max(...path1) - Math.min(...path1);
      assert(span < 11 && Math.min(...path1) >= a0 - 10.5, `355° -> 5° turns the dial ~10°, not a full circle (span ${span.toFixed(1)}°)`);
      assert(await deg(page) === 5 && await txt(page, '#hName') === '北', 'now 5° 北');

      // landscape compensation
      await page.evaluate(() => __compass.setForceAngle(90));
      await feed(page, 'abs', { alpha: 233, beta: 0, gamma: 0 }); await sleep(1200);
      assert(await deg(page) === 217, 'landscape 90°: 127 + 90 = 217°');
      await page.evaluate(() => __compass.setForceAngle(null));
      await feed(page, 'abs', { alpha: 233, beta: 0, gamma: 0 }); await sleep(1200);

      // true north
      await page.click('#trueBtn'); await sleep(200);
      assert(await deg(page) === 123 && (await txt(page, '#refChip')).startsWith('真北'), 'true north with -4.5° -> 123° (122.5 rounded)');
      await page.fill('#declIn', '3'); await page.locator('#declIn').dispatchEvent('change'); await sleep(200);
      assert(await deg(page) === 130, 'declination +3 -> 130°');
      await page.click('#declMinus'); await sleep(150);
      assert(await page.locator('#declIn').inputValue() === '2.5', '− button steps 0.5');
      await page.fill('#declIn', '-4.5'); await page.locator('#declIn').dispatchEvent('change');
      await page.click('#magBtn'); await sleep(200);
      assert(await deg(page) === 127, 'back to magnetic 127°');

      // target lock + turn hint
      await page.click('#tgtBtn'); await sleep(200);
      assert(await page.evaluate(() => Math.round(__compass.S.target)) === 127 && await page.locator('#tgt').isVisible(), 'locked target 127° with green marker');
      await feed(page, 'abs', { alpha: 256, beta: 0, gamma: 0 }); await settle(); await settle();
      assert((await txt(page, '#turn')) === '向右轉 23°', 'heading 104°, target 127° -> 向右轉 23°');
      const mk1 = await page.locator('#tgt path').boundingBox(), db = await page.locator('#dialbox').boundingBox();
      assert(mk1.x + mk1.width / 2 > db.x + db.width / 2, 'target marker sits right of the lubber line');
      await page.screenshot({ path: OUT + '/390x844-target.png' });
      await feed(page, 'abs', { alpha: 200, beta: 0, gamma: 0 }); await settle(); await settle();
      assert((await txt(page, '#turn')) === '向左轉 33°', 'heading 160° -> 向左轉 33°');
      await feed(page, 'abs', { alpha: 234, beta: 0, gamma: 0 }); await settle(); await settle();
      assert((await txt(page, '#turn')) === '方向正確' && await page.locator('#turn.ok').isVisible(), 'within 3° -> 方向正確');
      // 16-point mode
      await page.click('#hubBtn'); await sleep(150);
      assert(await page.evaluate(() => __compass.S.mode) === '16pt' && await page.locator('#readout.alt').count() === 1, 'tap dial centre -> 16-point emphasis');
      await page.click('#hubBtn');
      // long-press copy
      const rb = await page.locator('#readout').boundingBox();
      await page.mouse.move(rb.x + rb.width / 2, rb.y + 20); await page.mouse.down(); await sleep(700); await page.mouse.up(); await sleep(150);
      assert(/^已複製：12[67]° 東南（磁北）$/.test(await txt(page, '#toast')), 'long-press copies the heading: ' + await txt(page, '#toast'));
      // jitter -> calibration hint
      await page.evaluate(() => { window.__fd.jitter = 70; }); await sleep(1800);
      assert((await txt(page, '#accText')).includes('8 字形'), 'noisy readings -> 需要校正（8 字形）');
      await page.evaluate(() => { window.__fd.jitter = 0; });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('compass.v1')));
      assert(saved && saved.declination === -4.5 && Math.round(saved.target) === 127 && saved.trueNorth === false, 'settings saved under compass.v1');
      await ctx.close();
    }
    {
      // iOS: webkitCompassHeading, permission requested on tap
      const { ctx, page } = await mk({}, () => { window.__asked = 0; DeviceOrientationEvent.requestPermission = () => { window.__asked++; return Promise.resolve('granted'); }; });
      assert(await page.evaluate(() => window.__asked) === 0, 'iOS: no permission prompt on load');
      await page.click('#goBtn');
      assert(await page.evaluate(() => window.__asked) === 1, 'iOS: permission requested from the tap');
      await feed(page, 'rel', { alpha: 10, beta: 5, gamma: 0, absolute: false, webkitCompassHeading: 291, webkitCompassAccuracy: 10 }); await settle();
      assert(await deg(page) === 291 && await txt(page, '#hName') === '西北偏西', 'webkitCompassHeading 291 -> 291° 西北偏西');
      assert((await txt(page, '#accText')) === '精度良好', 'accuracy 10 -> 精度良好');
      await feed(page, 'rel', { alpha: 10, beta: 5, gamma: 0, absolute: false, webkitCompassHeading: 291, webkitCompassAccuracy: 35 }); await sleep(300);
      assert((await txt(page, '#accText')).includes('需要校正'), 'accuracy 35 -> 需要校正');
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({}, () => { DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); });
      await page.click('#goBtn'); await sleep(200);
      assert((await txt(page, '#gateMsg')).includes('被拒絕') && (await txt(page, '#gateMsg')).includes('設定 > Safari'), 'iOS denied -> settings instructions');
      await ctx.close();
    }
    {
      // only relative alpha (no absolute, no webkitCompassHeading)
      const { ctx, page } = await mk({ colorScheme: 'dark' });
      await page.click('#goBtn');
      await feed(page, 'rel', { alpha: 40, beta: 1, gamma: 0, absolute: false }); await sleep(2400);
      assert((await txt(page, '#gateMsg')).includes('此裝置不提供絕對方位') && await txt(page, '#hDeg') === '—°', 'relative-only alpha -> 不提供絕對方位, no heading shown');
      await page.screenshot({ path: OUT + '/390x844-relative-dark.png' });
      await ctx.close();
    }
    {
      // deviceorientation with absolute: true (no separate absolute event)
      const { ctx, page } = await mk();
      await page.click('#goBtn');
      await feed(page, 'rel', { alpha: 90, beta: 0, gamma: 0, absolute: true }); await settle();
      assert(await deg(page) === 270 && await txt(page, '#hName') === '西', 'deviceorientation absolute:true alpha 90 -> 270° 西');
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      await page.click('#goBtn'); await sleep(2400);
      assert((await txt(page, '#gateMsg')).includes('這台裝置沒有感測器或瀏覽器不提供'), 'no events in 2 s -> no-sensor message');
      assert(await page.locator('#gateMsg a').getAttribute('href') === 'https://timmango123.github.io/pocket-apps/tools/#compass', 'off-site: link to the website version');
      await page.screenshot({ path: OUT + '/desktop-nosensor.png' });
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 375, height: 667 }, colorScheme: 'dark' });
      await page.click('#goBtn'); await feed(page, 'abs', { alpha: 233, beta: 4, gamma: -3 }); await settle();
      const small = await page.evaluate(() => [...document.querySelectorAll('button, input')].filter(e => e.offsetParent && e.id !== 'hubBtn').map(e => { const r = e.getBoundingClientRect(); return [e.id || e.textContent, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
      assert(small.length === 0, 'controls are touch-sized at 375px ' + JSON.stringify(small));
      const ov = await page.evaluate(() => { const d = document.getElementById('dialbox').getBoundingClientRect(), b = document.getElementById('tgtBtn').getBoundingClientRect(); return d.bottom <= b.top; });
      assert(ov, 'dial and buttons do not overlap at 375px');
      await page.screenshot({ path: OUT + '/375x667-dark.png', fullPage: true });
      await ctx.close();
    }
    if (COVER) {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 300 / 390 });
      await page.click('#goBtn'); await feed(page, 'abs', { alpha: 233, beta: 3, gamma: -2 }); await sleep(800);
      await page.click('#tgtBtn'); await feed(page, 'abs', { alpha: 268, beta: 4, gamma: -3 }); await sleep(1500);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); document.getElementById('toast').hidden = true; }); await sleep(100);
      const cov = path.resolve(__dirname, '../../tool-hub/covers/compass.jpg');
      await page.screenshot({ path: cov, type: 'jpeg', quality: 85 });
      console.log('cover ->', cov);
      await ctx.close();
    }
    assert(errors.length === 0, 'no console/page errors ' + JSON.stringify(errors));
    console.log(`${n} checks passed`);
  } finally {
    await browser.close();
    fs.unlinkSync(WRAP);
  }
})().catch(e => { console.error(e); process.exit(1); });
