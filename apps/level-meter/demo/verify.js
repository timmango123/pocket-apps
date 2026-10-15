// Browser check for 水平儀 with synthetic sensor events. Run: node verify.js
// Writes screenshots next to this file (not committed) and, with --cover, apps/tool-hub/covers/level-meter.jpg.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs');
const SRC = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const WRAP = path.join(__dirname, 'preview.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>' + SRC + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname, COVER = process.argv.includes('--cover');
let n = 0;
const assert = (c, m) => { if (!c) throw new Error('ASSERT: ' + m); n++; console.log('ok -', m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const G = 9.81, rad = d => d * Math.PI / 180;
const tiltX = d => [G * Math.sin(rad(d)), 0, G * Math.cos(rad(d))];

// 60 Hz in-page feeder: set window.__fd.motion / .orient and events keep coming like a real sensor.
const FEEDER = () => {
  window.__fd = { motion: null, orient: null, jitter: 0 };
  setInterval(() => {
    const f = window.__fd, j = () => (Math.random() - 0.5) * f.jitter;
    if (f.motion) dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: f.motion[0] + j(), y: f.motion[1] + j(), z: f.motion[2] }, interval: 16 }));
    if (f.orient) dispatchEvent(new DeviceOrientationEvent('deviceorientation', f.orient));
  }, 16);
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (opts = {}, init) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ...opts });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    if (init) await page.addInitScript(init);
    await page.goto(URL); await sleep(200);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[0] <= w[1], `no horizontal scroll at ${w[1]}px (${w})`);
    return { ctx, page };
  };
  const feed = (page, k, v) => page.evaluate(([k, v]) => { window.__fd[k] = v; }, [k, v]);
  const txt = (page, s) => page.locator(s).innerText();
  const num = async (page, s) => parseFloat((await txt(page, s)).replace('−', '-'));
  const settle = () => sleep(900);
  try {
    {
      const { ctx, page } = await mk();
      await page.evaluate(FEEDER);
      // nothing is read before the tap
      await feed(page, 'motion', tiltX(3)); await sleep(300);
      assert(await txt(page, '#r1') === '—', 'no readings before tapping 啟用感測器 (no prompt on load)');
      assert(await page.locator('#gate').isVisible() && await page.locator('#goBtn').isVisible(), 'start gate visible');
      const gh = await page.locator('#goBtn').evaluate(e => e.getBoundingClientRect().height);
      assert(gh >= 56, 'start button is 56px tall');
      await page.screenshot({ path: OUT + '/390x844-gate.png' });

      await page.click('#goBtn'); await settle();
      assert(await page.locator('#gate').isHidden() && await page.locator('#ctrls').isVisible(), 'gate replaced by controls once data arrives');
      assert(near(await num(page, '#r1'), 3, 0.05) && near(await num(page, '#r2'), 0, 0.05), 'flat: right side raised 3° -> X 3.0, Y 0.0');
      let tr = await page.evaluate(() => getComputedStyle(document.getElementById('fBubble')).transform);
      let m = tr.match(/matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)/);
      assert(m && +m[1] > 25 && Math.abs(+m[2]) < 1, 'bubble moves toward the raised (right) side: ' + tr);
      await feed(page, 'motion', [0, G * Math.sin(rad(2)), G * Math.cos(rad(2))]); await settle();
      assert(near(await num(page, '#r2'), 2, 0.05), 'flat: top raised 2° -> Y 2.0');
      tr = await page.evaluate(() => getComputedStyle(document.getElementById('fBubble')).transform);
      m = tr.match(/matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)/);
      assert(m && +m[2] < -15, 'bubble moves up when the top is raised');
      await feed(page, 'motion', tiltX(25)); await settle();
      const rb = await page.evaluate(() => { const v = document.getElementById('vial').getBoundingClientRect(), b = document.getElementById('fBubble').getBoundingClientRect(); return Math.hypot(b.x + b.width / 2 - v.x - v.width / 2, b.y + b.height / 2 - v.y - v.height / 2) + b.width / 2 <= v.width / 2; });
      assert(rb, 'bubble stays inside the vial at 25°');

      // level
      await feed(page, 'motion', [0.01, -0.01, G]); await settle();
      assert(await page.evaluate(() => document.body.classList.contains('is-level')), 'level < 0.3° -> green background');
      assert((await txt(page, '#statusText')) === '已水平', 'status says 已水平');
      await page.screenshot({ path: OUT + '/390x844-level.png' });
      await feed(page, 'motion', tiltX(1)); await settle();
      assert(!(await page.evaluate(() => document.body.classList.contains('is-level'))), 'leaves level at 1°');

      // stability
      await page.evaluate(() => { window.__fd.jitter = 1.2; }); await sleep(500);
      assert((await txt(page, '#statusText')) === '請保持穩定', 'shaky readings -> 請保持穩定');
      await page.evaluate(() => { window.__fd.jitter = 0; }); await settle();

      // lock
      await page.click('#lockBtn'); const locked = await txt(page, '#r1');
      await feed(page, 'motion', tiltX(-4)); await settle();
      assert(await txt(page, '#r1') === locked && await page.evaluate(() => document.body.classList.contains('is-locked')), 'lock freezes the reading (' + locked + ')');
      await page.click('#lockBtn'); await sleep(200);
      assert(near(await num(page, '#r1'), -4, 0.05), 'unlock resumes: X -4.0');

      // calibration: phone reads 0.6° / -0.4° on a level surface
      const bias = [G * Math.sin(rad(0.6)), G * Math.sin(rad(-0.4)), G];
      await feed(page, 'motion', bias); await settle();
      await page.click('#calBtn');
      assert(await page.locator('#calDlg').isVisible(), 'calibration sheet opens');
      await page.click('#calStep'); await page.waitForFunction(() => document.getElementById('calStep').textContent === '記錄第二點', null, { timeout: 5000 });
      await page.click('#calStep'); await page.waitForFunction(() => document.getElementById('calStep').textContent === '完成', null, { timeout: 5000 });
      const off = await page.evaluate(() => __level.S.offset);
      assert(near(off.x, 0.6, 0.02) && near(off.y, -0.4, 0.02), 'two-step calibration stores offsets ' + JSON.stringify(off));
      await page.click('#calStep');
      await settle();
      assert(Math.abs(await num(page, '#r1')) < 0.3 && Math.abs(await num(page, '#r2')) < 0.3, 'after calibration the same surface reads < 0.3°');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('level-meter.v1')));
      assert(saved && near(saved.offset.x, 0.6, 0.02), 'offset saved under level-meter.v1');

      // upright in flat mode -> suggest edge mode
      await feed(page, 'motion', [0, G, 0.5]); await settle();
      assert((await txt(page, '#statusText')).includes('接近直立'), 'flat mode upright -> hint');
      await page.click('#status button.link'); await sleep(200);
      assert(await page.evaluate(() => __level.S.mode) === 'edge', '改用邊緣 switches to edge mode');

      // edge mode (portrait)
      await feed(page, 'motion', [G * Math.sin(rad(1.2)), G * Math.cos(rad(1.2)), 0]); await settle();
      assert(near(await num(page, '#eBig'), 1.2, 0.05), 'edge: turned 1.2° counter-clockwise -> 1.2°');
      tr = await page.evaluate(() => getComputedStyle(document.getElementById('eBubble')).transform);
      assert(/matrix\(1, 0, 0, 1, (\d[\d.]*), 0\)/.test(tr) && parseFloat(tr.split(',')[4]) > 5, 'tube bubble moves right (raised end): ' + tr);
      await page.screenshot({ path: OUT + '/390x844-edge.png' });
      // landscape: screen.orientation.angle = 90, right end raised 1.5°
      await page.evaluate(() => __level.setForceAngle(90));
      await feed(page, 'motion', [G * Math.cos(rad(1.5)), -G * Math.sin(rad(1.5)), 0]); await settle();
      assert(near(await num(page, '#eBig'), 1.5, 0.05), 'edge, landscape 90°: right end raised -> +1.5 (not reversed)');
      await page.evaluate(() => __level.setForceAngle(270));
      await feed(page, 'motion', [-G * Math.cos(rad(1.5)), G * Math.sin(rad(1.5)), 0]); await settle();
      assert(near(await num(page, '#eBig'), 1.5, 0.05), 'edge, landscape 270°: right end raised -> +1.5');
      await page.evaluate(() => __level.setForceAngle(null));
      // plumb
      await feed(page, 'motion', [G * Math.cos(rad(0.8)), G * Math.sin(rad(0.8)), 0]); await settle();
      assert((await txt(page, '#eRef')) === '以垂直為準' && near(await num(page, '#eBig'), -0.8, 0.05), 'edge near 90° reads against plumb: -0.8°');

      // protractor
      await page.click('[data-mode=prot]');
      await feed(page, 'motion', [0, G * Math.sin(rad(35)), G * Math.cos(rad(35))]); await settle();
      assert(near(await num(page, '#pBig'), 35, 0.1), 'protractor vs horizontal: 35.0°');
      await feed(page, 'motion', tiltX(10)); await settle();
      await page.click('#calBtn'); await sleep(50);
      assert((await txt(page, '#pRef')) === '基準：已歸零', '歸零 sets the reference');
      await feed(page, 'motion', tiltX(40)); await settle(); await settle();
      assert(near(await num(page, '#pBig'), 30, 0.15), 'protractor after zero at 10°, now 40° -> 30.0°');
      const nd = await page.evaluate(() => document.getElementById('pNeedle').getAttribute('transform'));
      assert(/rotate\(-(29|30)\./.test(nd), 'needle rotated to 30°: ' + nd);
      await page.screenshot({ path: OUT + '/390x844-prot.png' });

      // double-tap the stage cycles modes
      const box = await page.locator('#stage').boundingBox();
      await page.touchscreen.tap(box.x + 20, box.y + 20); await sleep(80); await page.touchscreen.tap(box.x + 20, box.y + 20); await sleep(150);
      assert(await page.evaluate(() => __level.S.mode) === 'flat', 'double-tap cycles 量角器 -> 平面');
      await ctx.close();
    }
    {
      // iOS: permission granted, accelerationIncludingGravity inverted -> auto-detected from orientation
      const { ctx, page } = await mk({}, () => {
        DeviceMotionEvent.requestPermission = () => Promise.resolve('granted');
        DeviceOrientationEvent.requestPermission = () => Promise.resolve('granted');
      });
      await page.evaluate(FEEDER);
      assert(await page.evaluate(() => __level.R.sign) === -1, 'iOS-like browser starts with inverted gravity sign');
      await page.click('#goBtn');
      await feed(page, 'motion', tiltX(3)); await feed(page, 'orient', { alpha: 0, beta: 0, gamma: -3 }); await settle();
      assert(await page.evaluate(() => __level.R.sign) === 1, 'sign vote flips to +1 when the vector agrees with beta/gamma');
      assert(near(await num(page, '#r1'), 3, 0.05), 'X 3.0 after sign detection');
      await ctx.close();
    }
    {
      // Android-default sign, but the browser reports gravity inverted (as iOS Safari does) -> detected and corrected
      const { ctx, page } = await mk();
      await page.evaluate(FEEDER);
      await page.click('#goBtn');
      await feed(page, 'motion', tiltX(3).map(v => -v)); await feed(page, 'orient', { alpha: 0, beta: 0, gamma: -3 }); await settle();
      assert(await page.evaluate(() => __level.R.sign) === -1, 'inverted accelerationIncludingGravity detected (sign -1)');
      assert(near(await num(page, '#r1'), 3, 0.05), 'X 3.0 with inverted gravity');
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({}, () => { DeviceMotionEvent.requestPermission = () => Promise.resolve('denied'); DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); });
      await page.click('#goBtn'); await sleep(200);
      assert((await txt(page, '#gateMsg')).includes('動作與方向取用被拒絕') && (await txt(page, '#gateMsg')).includes('設定 > Safari'), 'iOS denied -> settings instructions');
      await ctx.close();
    }
    {
      // orientation-only device (no devicemotion values)
      const { ctx, page } = await mk();
      await page.evaluate(FEEDER);
      await page.click('#goBtn');
      await feed(page, 'orient', { alpha: 0, beta: 12, gamma: 0 }); await settle();
      assert(near(await num(page, '#r2'), 12, 0.05), 'deviceorientation fallback: beta 12 -> Y 12.0');
      await ctx.close();
    }
    {
      // desktop / blocked: no events at all
      const { ctx, page } = await mk({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
      await page.click('#goBtn'); await sleep(2400);
      const t = await txt(page, '#gateMsg');
      assert(t.includes('這台裝置沒有感測器或瀏覽器不提供'), 'no events in 2 s -> no-sensor message');
      const href = await page.locator('#gateMsg a').getAttribute('href');
      assert(href === 'https://timmango123.github.io/pocket-apps/tools/#level-meter' && await page.locator('#gateMsg a').getAttribute('target') === '_blank', 'off-site: links to the website version in a new tab');
      assert((await txt(page, '#goBtn')).includes('再試一次'), 'retry offered');
      await page.screenshot({ path: OUT + '/desktop-nosensor.png' });
      await ctx.close();
    }
    {
      const { ctx, page } = await mk({ viewport: { width: 360, height: 740 }, colorScheme: 'dark' });
      await page.evaluate(FEEDER); await page.click('#goBtn');
      await feed(page, 'motion', [G * Math.sin(rad(1.6)), G * Math.sin(rad(-2.4)), G]); await settle();
      await page.screenshot({ path: OUT + '/360x740-dark.png' });
      const w = await page.evaluate(() => document.documentElement.scrollWidth);
      assert(w <= 360, 'no overflow at 360px while running');
      await ctx.close();
    }
    if (COVER) {
      const { ctx, page } = await mk({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 300 / 390 });
      await page.evaluate(FEEDER); await page.click('#goBtn');
      await feed(page, 'motion', [G * Math.sin(rad(1.6)), G * Math.sin(rad(-2.4)), G]); await sleep(1500);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }); await sleep(100);
      const cov = path.resolve(__dirname, '../../tool-hub/covers/level-meter.jpg');
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
function near(a, b, e) { return Math.abs(a - b) <= e; }
