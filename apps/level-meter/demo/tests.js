// Math unit tests for 水平儀 (level-meter), run against the tool's own core (CORE-START..CORE-END in index.html).
// Usage: node tests.js
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1];
const C = new Function(src + '\nreturn {norm180,norm360,screenAngle,toScreen,gravityFromOrientation,tilt,edgeDeviation,calibOffset,calibOffsetAngle,lowpass,lowpassAngle,stdev,angleBetween,signVote,bubbleOffset,tubeOffset,levelState,beepInterval,slopePct,slopeFlat,downEdge,calibEdge,offsetOnScreen,isFaceDown};')();
let pass = 0, fail = 0;
function t(name, cond) { if (cond) pass++; else { fail++; console.log('FAIL', name); } }
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const G = 9.81, rad = d => d * Math.PI / 180;

// --- angle helpers ---
t('norm180 wraps 190 -> -170', near(C.norm180(190), -170));
t('norm180 keeps 180', C.norm180(180) === 180 && C.norm180(-180) === 180);
t('norm360 wraps -10 -> 350', near(C.norm360(-10), 350));
t('screenAngle prefers screen.orientation.angle', C.screenAngle(90, 0) === 90);
t('screenAngle falls back to window.orientation (-90 -> 270)', C.screenAngle(undefined, -90) === 270);
t('screenAngle defaults to 0', C.screenAngle(undefined, undefined) === 0);

// --- tilt from gravity (W3C up-vector: flat face-up = (0,0,+g)) ---
{ const r = C.tilt(0, 0, G, 0); t('flat on table reads 0/0', near(r.x, 0) && near(r.y, 0) && near(r.total, 0)); }
{ const th = 2; const r = C.tilt(G * Math.sin(rad(th)), 0, G * Math.cos(rad(th)), 0);
  t('right side raised 2° -> x = +2.0', near(r.x, 2, 1e-9) && near(r.y, 0)); }
{ const r = C.tilt(-G * Math.sin(rad(5)), 0, G * Math.cos(rad(5)), 0); t('left side raised 5° -> x = -5', near(r.x, -5, 1e-9)); }
{ const r = C.tilt(0, G * Math.sin(rad(3)), G * Math.cos(rad(3)), 0); t('top raised 3° -> y = +3', near(r.y, 3, 1e-9) && near(r.x, 0)); }
{ const r = C.tilt(0, G, 0, 0); t('upright portrait -> edge 0, total 90', near(r.edge, 0) && near(r.total, 90)); }
{ const th = 7; const r = C.tilt(G * Math.sin(rad(th)), G * Math.cos(rad(th)), 0, 0);
  t('upright, turned 7° counter-clockwise -> edge +7', near(r.edge, 7, 1e-9)); }
{ const r = C.tilt(-G * Math.sin(rad(4)), G * Math.cos(rad(4)), 0, 0); t('upright, turned clockwise 4° -> edge -4', near(r.edge, -4, 1e-9)); }

// --- tilt from deviceorientation beta/gamma (fallback source) ---
{ const g = C.gravityFromOrientation(0, 0); t('beta=gamma=0 -> up = +z', near(g[0], 0) && near(g[1], 0) && near(g[2], 1)); }
{ const g = C.gravityFromOrientation(90, 0); t('beta=90 (upright) -> up = +y', near(g[1], 1) && near(g[2], 0)); }
{ const g = C.gravityFromOrientation(0, 30); const r = C.tilt(g[0], g[1], g[2], 0);
  t('gamma +30 (right side down) -> x = -30', near(r.x, -30, 1e-9)); }
{ const g = C.gravityFromOrientation(12, 0); const r = C.tilt(g[0], g[1], g[2], 0); t('beta +12 (top up) -> y = +12', near(r.y, 12, 1e-9)); }
{ const g = C.gravityFromOrientation(20, -15); t('orientation gravity is a unit vector', near(Math.hypot(...g), 1)); }

// --- screen-rotation compensation ---
{ const s = C.toScreen(1, 0, 90); t('landscape 90: device +x is screen up', near(s[0], 0) && near(s[1], 1)); }
{ const s = C.toScreen(0, 1, 90); t('landscape 90: device +y is screen left', near(s[0], -1) && near(s[1], 0)); }
{ const s = C.toScreen(0, 1, 270); t('landscape 270: device +y is screen right', near(s[0], 1) && near(s[1], 0)); }
{ const s = C.toScreen(0.3, -0.7, 180); t('upside-down 180 negates both axes', near(s[0], -0.3) && near(s[1], 0.7)); }
// phone rotated a quarter turn counter-clockwise (screen.orientation.angle = 90) and held upright on an edge
{ const r = C.tilt(G, 0, 0, 90); t('landscape upright: long edge level reads 0', near(r.edge, 0)); }
{ const th = 1.5; // in landscape, tip the right end (= device bottom) up 1.5°
  const r = C.tilt(G * Math.cos(rad(th)), -G * Math.sin(rad(th)), 0, 90);
  t('landscape upright: right end raised 1.5° -> edge +1.5 (not reversed)', near(r.edge, 1.5, 1e-9)); }
{ const th = 1.5; const r = C.tilt(-G * Math.cos(rad(th)), G * Math.sin(rad(th)), 0, 270);
  t('landscape 270: right end raised 1.5° -> edge +1.5', near(r.edge, 1.5, 1e-9)); }
{ const th = 2; // flat in landscape 90: screen-right is device -y; raising it gives device y < 0 component of up
  const r = C.tilt(0, -G * Math.sin(rad(th)), G * Math.cos(rad(th)), 90);
  t('flat landscape: screen-right side raised 2° -> x = +2', near(r.x, 2, 1e-9) && near(r.y, 0)); }

// --- edge reference: level or plumb ---
t('edge 0.4 -> level dev 0.4', near(C.edgeDeviation(0.4).dev, 0.4) && C.edgeDeviation(0.4).ref === 'level');
t('edge 89.2 -> plumb dev -0.8', near(C.edgeDeviation(89.2).dev, -0.8, 1e-9) && C.edgeDeviation(89.2).ref === 'plumb');
t('edge -91 -> plumb dev -1', near(C.edgeDeviation(-91).dev, -1) && C.edgeDeviation(-91).ref === 'plumb');
t('edge 179.5 -> level dev -0.5', near(C.edgeDeviation(179.5).dev, -0.5, 1e-9) && C.edgeDeviation(179.5).ref === 'level');

// --- two-step calibration ---
{ const bias = 0.7, slope = 1.3; // surface tilted 1.3°, phone+case bias 0.7°
  const r1 = slope + bias, r2 = -slope + bias; // turned 180° about the vertical
  const off = C.calibOffset(r1, r2);
  t('calibration recovers the bias, not the surface slope', near(off, bias));
  t('after calibration both placements read ±slope', near(r1 - off, slope) && near(r2 - off, -slope)); }
t('angular calibration across ±180', near(C.calibOffsetAngle(179, -177), -179, 1e-9));
t('angular calibration near 0', near(C.calibOffsetAngle(0.9, 0.3), 0.6, 1e-9));
{ // full pipeline: a phone whose sensor reads 0.5° right-high when truly level
  const biasX = 0.5, g1 = [G * Math.sin(rad(biasX)), 0, G * Math.cos(rad(biasX))];
  const a = C.tilt(...g1, 0).x, b = C.tilt(...g1, 0).x; // on a level table both placements read the bias
  const off = C.calibOffset(a, b); t('level table: calibrated reading < 0.3°', Math.abs(C.tilt(...g1, 0).x - off) < 0.3); }

// --- filtering / stability ---
{ let v = 0; for (let i = 0; i < 40; i++) v = C.lowpass(v, 10); t('low-pass (0.15) converges toward 10', v > 9.8 && v < 10); }
t('low-pass first step is 15%', near(C.lowpass(0, 10), 1.5));
{ let v = 179; for (let i = 0; i < 60; i++) v = C.lowpassAngle(v, -179); t('angle low-pass crosses ±180 the short way', Math.abs(C.norm180(v - -179)) < 0.1 && Math.abs(v) > 178); }
t('stdev of steady readings is 0', C.stdev([1, 1, 1, 1]) === 0);
t('stdev of shaky readings > 0.5', C.stdev([0, 1.5, -1, 2, -0.5, 1, 0, 2, -1, 1]) > 0.5);
t('stdev of fine jitter < 0.5', C.stdev([0.1, 0.12, 0.08, 0.11, 0.09]) < 0.5);

// --- protractor ---
t('protractor: same pose = 0', near(C.angleBetween([0, 0, 9.8], [0, 0, 9.8]), 0));
t('protractor: flat to upright = 90', near(C.angleBetween([0, 9.8, 0], [0, 0, 1]), 90));
{ const g = [0, G * Math.sin(rad(35)), G * Math.cos(rad(35))]; t('protractor: 35° slope vs zero on flat', near(C.angleBetween(g, [0, 0, 9.8]), 35, 1e-9)); }
{ const ref = [G * Math.sin(rad(10)), 0, G * Math.cos(rad(10))], g = [G * Math.sin(rad(40)), 0, G * Math.cos(rad(40))];
  t('protractor: zeroed at 10°, now 40° -> 30', near(C.angleBetween(g, ref), 30, 1e-9)); }

// --- iOS accelerationIncludingGravity sign detection ---
t('Android-style vector agrees with orientation -> +1', C.signVote([0, 0, 9.8], 0, 0) === 1);
t('iOS-style inverted vector -> -1', C.signVote([0, 0, -9.8], 0, 0) === -1);
t('upright iOS-style -> -1', C.signVote([0, -9.8, 0], 90, 0) === -1);
t('free fall / tiny vector -> no vote', C.signVote([0, 0, 0.5], 0, 0) === 0);

// --- bubble placement ---
{ const o = C.bubbleOffset(2, 0, 10, 100); t('2° right-high -> bubble 20px right', near(o[0], 20) && near(o[1], 0)); }
{ const o = C.bubbleOffset(0, 5, 10, 100); t('top-high -> bubble moves up (negative y)', near(o[1], -50)); }
{ const o = C.bubbleOffset(30, 30, 10, 100); t('bubble clamped inside the circle', near(Math.hypot(o[0], o[1]), 100)); }
t('tube offset clamps at the ends', C.tubeOffset(9, 5, 120) === 120 && C.tubeOffset(-9, 5, 120) === -120 && near(C.tubeOffset(1, 5, 120), 24));

// --- level feedback ---
t('enters level below 0.3°', C.levelState(false, 0.25) === true && C.levelState(false, -0.29) === true);
t('not level at 0.35° from outside', C.levelState(false, 0.35) === false);
t('stays level at 0.35° (hysteresis)', C.levelState(true, 0.35) === true);
t('leaves level above 0.4°', C.levelState(true, 0.45) === false);
t('sound: continuous tone when level', C.beepInterval(0.1) === 0);
t('sound: faster beeps closer to level', C.beepInterval(1) < C.beepInterval(5) && C.beepInterval(5) < C.beepInterval(9.5));
t('sound: silent beyond 10°', C.beepInterval(12) === null);
t('slope: 45° = 100%', near(C.slopePct(45), 100, 1e-9));
t('slope: 1° ≈ 1.75%', near(C.slopePct(1), 1.7455, 1e-3));

// --- release review fixes (pure math) ---
{ const T = d => Math.tan(rad(d)), exp = (a, b) => Math.hypot(T(a), T(b)) * 100;
  t('flat slope 10°/10° = 24.9% (was 25.2)', near(C.slopeFlat(10, 10), exp(10, 10), 1e-9) && C.slopeFlat(10, 10).toFixed(1) === '24.9');
  t('flat slope 20°/20° = 51.5% (was 53.8)', C.slopeFlat(20, 20).toFixed(1) === '51.5');
  t('flat slope 40°/40° = 118.7% (was 151.5)', C.slopeFlat(40, 40).toFixed(1) === '118.7');
  t('flat slope uses the true total tilt for the 60° cut-off', C.slopeFlat(55, 55) === null && C.slopeFlat(50, 50) !== null && C.slopeFlat(91, 0) === null); }
t('edge calibration on a long edge with the screen in portrait (raw -88.7 / -90.3) -> 0.5', near(C.calibEdge(-88.7, -90.3), 0.5, 1e-9));
t('edge calibration in landscape still works (1.3 / -0.3) -> 0.5', near(C.calibEdge(1.3, -0.3), 0.5, 1e-9));
t('edge calibration across an in-plane flip (89.5 / -89.5) -> 0', near(C.calibEdge(89.5, -89.5), 0, 1e-9));
t('down edge from gravity: long edge down', C.downEdge(9.8, 0.3) === 'long' && C.downEdge(-9.8, 0.3) === 'long');
t('down edge from gravity: short edge down', C.downEdge(0.2, 9.8) === 'short');
{ const o = C.offsetOnScreen({ x: 0.6, y: -0.4 }, 90); t('device-frame offset (0.6,-0.4) seen in landscape 90 -> (0.4, 0.6)', near(o[0], 0.4) && near(o[1], 0.6)); }
{ // the reviewer's case: offset taken in portrait, same level table, screen in landscape -> reads 0/0
  const g = [G * Math.sin(rad(0.6)), G * Math.sin(rad(-0.4)), G], d = C.tilt(...g, 0), s = C.tilt(...g, 90), o = C.offsetOnScreen({ x: d.x, y: d.y }, 90);
  t('calibrated in portrait, read in landscape: residual < 0.01°', Math.abs(s.x - o[0]) < 0.01 && Math.abs(s.y - o[1]) < 0.01); }
t('face down detected below -2 m/s²', C.isFaceDown(-9.8) && !C.isFaceDown(-1) && !C.isFaceDown(9.8));

// --- release review fixes (in the browser) ---
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const PAGE = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + html + '</body></html>';
const FEEDER = () => {
  window.__fd = { motion: null, orient: null };
  setInterval(() => { const f = window.__fd; if (f.motion) dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: f.motion[0], y: f.motion[1], z: f.motion[2] }, interval: 16 })); }, 16);
};
const up = (ax, ay) => { const v = [Math.tan(rad(ax)), Math.tan(rad(ay)), 1], n = Math.hypot(...v); return v.map(c => c / n * G); };
const inplane = e => [G * Math.sin(rad(e)), G * Math.cos(rad(e)), 0];
const W = { timeout: 30000 };

(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (w, h, init) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    if (init) await page.addInitScript(init);
    await page.goto(URL);
    const cdp = await ctx.newCDPSession(page);
    return { ctx, page, cdp };
  };
  const feed = (page, v) => page.evaluate(v => { window.__fd.motion = v; }, v);
  const start = async (page, v) => { await page.evaluate(FEEDER); await feed(page, v); await page.click('#goBtn'); await page.waitForFunction(() => __level.R.got, null, W); };
  // wait until the filtered reading has converged (never a fixed sleep)
  const conv = (page, k, v, e = 0.03) => page.waitForFunction(([k, v, e]) => { const r = __level.readings(); return r && Math.abs(r[k] - v) < e; }, [k, v, e], W);
  const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const txt = (page, s) => page.locator(s).innerText();
  const center = async (page, s) => { const b = await page.locator(s).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const touch = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (page, cdp, s) => { const p = typeof s === 'string' ? await center(page, s) : s; await touch(cdp, 'touchStart', [{ ...p, id: 1 }]); await touch(cdp, 'touchEnd', []); };
  const pressed = (page, s) => page.getAttribute(s, 'aria-pressed');
  const calibrate = async (page, v1, v2) => {
    await feed(page, v1); await page.click('#calBtn');
    await page.click('#calStep');
    await page.waitForFunction(() => document.getElementById('calStep').textContent === '記錄第二點' && !document.getElementById('calStep').disabled, null, { timeout: 20000 });
    await feed(page, v2); await page.click('#calStep');
    await page.waitForFunction(() => !document.getElementById('calStep').disabled && /✓|過大|沒有資料/.test(document.getElementById('cd2').textContent), null, { timeout: 20000 });
    const out = { cd2: await txt(page, '#cd2'), offset: await page.evaluate(() => ({ ...__level.S.offset })) };
    await page.click('#calCancel');
    return out;
  };
  try {
    { // idle look, calibration across rotation, failed calibration, face down, slope, edge labels and cards
      const { ctx, page, cdp } = await mk(390, 844);
      t('before the sensors start the instrument is greyed out and says 未啟用',
        await page.evaluate(() => document.body.classList.contains('no-data') && getComputedStyle(document.getElementById('fBubble')).opacity === '0') && await page.locator('#vial .idle-tag').isVisible());
      await start(page, up(0.6, -0.4)); await page.waitForFunction(() => !document.body.classList.contains('no-data'), null, W);
      t('the grey look goes away once data arrives', !(await page.locator('#vial .idle-tag').isVisible()));
      let c = await calibrate(page, up(0.6, -0.4), up(0.6, -0.4));
      t('flat calibration stores the device-frame bias (0.60, -0.40)', near(c.offset.x, 0.6, 0.02) && near(c.offset.y, -0.4, 0.02));
      await page.evaluate(() => __level.setForceAngle(90)); await feed(page, up(0.6, -0.4).map(v => v * 1.0000001));
      await conv(page, 'x', 0, 0.05).catch(() => {}); await conv(page, 'y', 0, 0.05).catch(() => {});
      const rr = await page.evaluate(() => __level.readings());
      t('calibrated in portrait, same level table in landscape reads 0/0 (was X -0.2, Y 1.0)', Math.abs(rr.x) < 0.05 && Math.abs(rr.y) < 0.05);
      await page.evaluate(() => __level.setForceAngle(0));
      // a rejected flat calibration leaves the edge (and the old flat) offsets alone
      await page.evaluate(() => { __level.S.offset.edge = 0.5; });
      c = await calibrate(page, up(9, 0), up(9, 0));
      t('rejected flat calibration keeps edge 0.50 and the previous flat offset', /過大/.test(c.cd2) && near(c.offset.edge, 0.5, 1e-9) && near(c.offset.x, 0.6, 0.02));
      await page.evaluate(() => { __level.S.offset.x = 0; __level.S.offset.y = 0; __level.S.offset.edge = 0; });
      // slope with both axes tilted
      await feed(page, up(40, 40)); await conv(page, 'x', 40, 0.002); await conv(page, 'y', 40, 0.002); await frame(page);
      t('flat 40°/40° slope shows 118.7% (was 151.5%)', (await txt(page, '#r3')).startsWith('118.7'));
      // face down
      await feed(page, [0, 0, -G]); await page.waitForFunction(() => /手機朝下/.test(document.getElementById('statusText').textContent), null, W);
      t('face down: readings show — and the status says the phone is face down', (await txt(page, '#r1')).startsWith('—') && (await txt(page, '#r3')).startsWith('—') && !(await page.evaluate(() => document.body.classList.contains('is-level'))));
      // edge: long edge down with the screen still in portrait
      await page.click('[data-mode=edge]');
      await feed(page, inplane(-90 + 0.1)); await page.waitForFunction(() => document.getElementById('statusText').textContent === '已水平', null, W);
      t('edge, portrait screen, phone on its long edge: 長邊以水平為準 / 已水平 (was 以垂直為準 / 已垂直)', (await txt(page, '#eRef')).startsWith('長邊以水平為準・螢幕未轉橫'));
      await feed(page, inplane(-90 + 2)); await conv(page, 'dev', 2, 0.002); await frame(page);
      const big = (await txt(page, '#eBig')).replace(/\s/g, ''), cards = [await txt(page, '#r1'), await txt(page, '#r2'), await txt(page, '#r3')].map(s => s.replace(/\s/g, ''));
      t('edge cards add information instead of repeating the big number (' + big + ' | ' + cards.join(' | ') + ')',
        big === '2.0°' && cards[0] === '3.5%' && cards[1] === '35mm' && cards[2] === '88.0°' && !(await page.locator('#eRaw').count()));
      const ticks = await page.evaluate(() => {
        const svg = document.getElementById('tubeTicks'), W = svg.getBoundingClientRect().width;
        const xs = [...svg.querySelectorAll('line')].map(l => +l.getAttribute('x1') - W / 2);
        const frameX = Math.max(...[...svg.querySelectorAll('line.zero')].map(l => Math.abs(+l.getAttribute('x1') - W / 2)));
        const minor = xs.filter((x, i) => svg.querySelectorAll('line')[i].classList.contains('minor')).map(Math.abs);
        return { labels: [...svg.querySelectorAll('text')].map(t => t.textContent), frameX, minMinor: Math.min(...minor) };
      });
      t('tube has 1° and 5° labels and the ±1° tick sits outside the framing lines', ticks.labels.filter(l => l === '1°').length === 2 && ticks.labels.filter(l => l === '5°').length === 2 && ticks.minMinor > ticks.frameX + 4);
      // edge calibration with the screen in portrait and the phone on its long edge
      c = await calibrate(page, inplane(-90 + 1.3), inplane(-90 - 0.3));
      t('edge calibration with the screen in portrait succeeds with bias 0.50 (was rejected)', c.cd2 === '✓' && near(c.offset.edge, 0.5, 0.02));
      // status link and toast
      await page.click('[data-mode=flat]'); await feed(page, [0, G, 0.5]);
      await page.waitForSelector('#status button.link', W);
      const lb = await page.locator('#status button.link').boundingBox();
      t('改用邊緣 link is at least 44×44', lb.width >= 44 && lb.height >= 44);
      await page.locator('#status button.link').click();
      t('改用邊緣 still switches to edge mode', await page.evaluate(() => __level.S.mode) === 'edge');
      await page.click('[data-mode=flat]');
      await tap(page, cdp, '#sndBtn'); await page.waitForSelector('#toast:not([hidden])', W);
      t('toast does not catch taps', await page.evaluate(() => getComputedStyle(document.getElementById('toast')).pointerEvents) === 'none');
      const th = await page.locator('#themeBtn').boundingBox(), to = await page.locator('#toast').boundingBox();
      t('toast does not cover the theme button', to.y >= th.y + th.height);
      await tap(page, cdp, '#sndBtn');
      await ctx.close();
    }
    { // second finger, overlapping fingers, single taps, double-tap gesture
      const { ctx, page, cdp } = await mk(390, 844);
      await start(page, up(2, 1));
      const flips = async (sel, fn) => { const before = await pressed(page, sel); await fn(); await frame(page); return before !== await pressed(page, sel); };
      for (const rest of ['.top h1', '#vial', '#r1']) {
        const a = await center(page, rest), b = await center(page, '#lockBtn');
        const was = await pressed(page, '#lockBtn');
        await touch(cdp, 'touchStart', [{ ...a, id: 1 }]);
        await touch(cdp, 'touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]);
        await touch(cdp, 'touchEnd', [{ ...a, id: 1 }]);
        await touch(cdp, 'touchEnd', []); await frame(page);
        t('one finger resting on ' + rest + ', the other taps 鎖定讀數 -> it toggles once', was !== await pressed(page, '#lockBtn'));
      }
      if (await pressed(page, '#lockBtn') === 'true') await page.click('#lockBtn');
      { const a = await center(page, '#lockBtn'), b = await center(page, '#sndBtn');
        await touch(cdp, 'touchStart', [{ ...a, id: 1 }]);
        await touch(cdp, 'touchStart', [{ ...a, id: 1 }, { ...b, id: 2 }]);
        await touch(cdp, 'touchEnd', [{ ...a, id: 1 }]);
        await touch(cdp, 'touchEnd', []); await frame(page);
        t('overlapping fingers on 鎖定 and 聲音: both toggle', await pressed(page, '#lockBtn') === 'true' && await pressed(page, '#sndBtn') === 'true'); }
      await page.click('#lockBtn'); await page.click('#sndBtn');
      let ok = true;
      for (let i = 0; i < 6; i++) ok = ok && await flips('#lockBtn', () => tap(page, cdp, '#lockBtn'));
      t('6 single taps on 鎖定讀數 toggle 6 times (no double fire from pointerup + click)', ok && await pressed(page, '#lockBtn') === 'false');
      await page.focus('#lockBtn'); await page.keyboard.press('Enter'); await frame(page);
      t('keyboard Enter still works', await pressed(page, '#lockBtn') === 'true');
      await page.keyboard.press('Enter'); await frame(page);
      // stage, button, stage within 320 ms is not a double-tap
      const st = await center(page, '#vial');
      await tap(page, cdp, st); await tap(page, cdp, '#lockBtn'); await tap(page, cdp, st); await frame(page);
      t('tap instrument, tap a button, tap instrument -> mode unchanged', await page.evaluate(() => __level.S.mode) === 'flat');
      await tap(page, cdp, '#lockBtn');
      // a burst of 8 quick taps on the instrument switches at most once
      // 8 taps 50 ms apart on the instrument (timestamps controlled in the page, so machine load cannot spread them out)
      const switches = await page.evaluate(() => {
        const v = document.getElementById('vial'), b = v.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2;
        let n = 0, m = __level.S.mode; const realNow = performance.now.bind(performance), t0 = realNow();
        for (let i = 0; i < 8; i++) {
          performance.now = () => t0 + i * 50;
          const o = { bubbles: true, isPrimary: true, pointerType: 'touch', pointerId: 7, clientX: x, clientY: y };
          v.dispatchEvent(new PointerEvent('pointerdown', o)); v.dispatchEvent(new PointerEvent('pointerup', o));
          if (__level.S.mode !== m) { n++; m = __level.S.mode; }
        }
        performance.now = realNow; return n;
      });
      t('8 quick taps on the instrument switch modes once (was 3 times): ' + switches, switches === 1);
      await ctx.close();
    }
    { // lock + protractor zero survive a reload; sound preference and auto-start are remembered
      const { ctx, page } = await mk(390, 844);
      await start(page, up(10, 0));
      await page.click('[data-mode=prot]'); await conv(page, 'p', 10, 0.03);
      await page.click('#calBtn'); await feed(page, up(25, 0)); await conv(page, 'p', 15, 0.03); await frame(page);
      await page.click('#lockBtn'); await page.click('#sndBtn');
      const lockedTxt = await txt(page, '#pBig');
      t('locked protractor reads 15.0°', lockedTxt.startsWith('15.0'));
      await page.evaluate(() => { window.__fd.motion = null; });
      await page.reload(); await page.waitForFunction(() => !!window.__level);
      t('after reload (no sensors yet): the locked reading is shown at once', (await txt(page, '#pBig')) === lockedTxt && await pressed(page, '#lockBtn') === 'true' && (await txt(page, '#r1')).startsWith('15.0'));
      t('after reload: protractor base still 已歸零', (await txt(page, '#pRef')) === '基準：已歸零' && await page.locator('#pClear').isVisible());
      t('after reload: sound preference shows 開', await pressed(page, '#sndBtn') === 'true');
      // auto-start: this browser needs no permission prompt and worked before -> starts by itself
      await page.evaluate(FEEDER); await feed(page, up(30, 0));
      await page.waitForFunction(() => __level.R.got, null, W);
      t('auto-starts on a browser without a permission prompt (gate gone without a tap)', await page.locator('#gate').isHidden() && await page.locator('#ctrls').isVisible());
      await page.waitForFunction(() => Math.abs(__level.R.p - 15) > 5, null, W);
      t('still locked after the sensors start: shows the old 15.0°', (await txt(page, '#pBig')) === lockedTxt);
      await page.click('#lockBtn'); await conv(page, 'p', 20, 0.05); await frame(page);
      t('unlock: the restored zero is used (30° now reads 20.0°)', (await txt(page, '#pBig')).startsWith('20.0'));
      await ctx.close();
      // old saved data (before these fields existed) still loads
      const o = await mk(390, 844);
      await o.page.evaluate(() => { localStorage.setItem('level-meter.v1', JSON.stringify({ mode: 'edge', offset: { x: 0.3, y: -0.2, edge: 0.4 }, sound: true, theme: 'dark' })); });
      await o.page.reload(); await o.page.waitForFunction(() => !!window.__level);
      t('old v1 data loads (mode, offsets, theme)', await o.page.evaluate(() => __level.S.mode === 'edge' && __level.S.offset.x === 0.3 && __level.S.offset.edge === 0.4 && document.documentElement.dataset.theme === 'dark' && !__level.R.locked));
      await o.ctx.close();
      // iOS-style permission prompt: never auto-start
      const i = await mk(390, 844, () => { DeviceMotionEvent.requestPermission = () => Promise.resolve('granted'); localStorage.setItem('level-meter.v1', JSON.stringify({ auto: true })); });
      await i.page.evaluate(FEEDER); await i.page.evaluate(() => { window.__fd.motion = [0, 0, 9.81]; });
      await i.page.evaluate(() => new Promise(r => setTimeout(r, 300)));
      t('iOS (permission prompt): keeps the start button, no auto-start', await i.page.locator('#goBtn').isVisible() && !(await i.page.evaluate(() => __level.R.got)));
      await i.ctx.close();
    }
    // ghost clicks: the click after a handled pointerup must not hit what appears underneath
    for (const [w, h] of [[360, 640], [844, 390]]) {
      const { ctx, page, cdp } = await mk(w, h);
      await start(page, up(0.6, -0.4));
      await page.evaluate(() => { __level.S.offset.x = 0.6; __level.S.offset.y = -0.4; window.__clk = []; document.addEventListener('click', e => { const b = e.target.closest('button'); if (b) __clk.push(b.id || b.dataset.mode || b.className); }); });
      const hold = async s => { const p = await center(page, s); await touch(cdp, 'touchStart', [{ ...p, id: 1 }]); await page.evaluate(() => new Promise(r => setTimeout(r, 60))); await touch(cdp, 'touchEnd', []); await frame(page); await page.evaluate(() => new Promise(r => setTimeout(r, 150))); };
      const state = () => page.evaluate(() => ({ x: __level.S.offset.x, lock: document.getElementById('lockBtn').getAttribute('aria-pressed'), snd: document.getElementById('sndBtn').getAttribute('aria-pressed'), open: !document.getElementById('calDlg').hidden, cd1: document.getElementById('cd1').textContent, mode: __level.S.mode }));
      await page.locator('#calBtn').scrollIntoViewIfNeeded();
      await hold('#calBtn'); let st = await state();
      t(`${w}×${h}: tap 校正 opens the sheet and nothing under it fires (清除校正 / 記錄第一點)`, st.open && near(st.x, 0.6, 1e-9) && st.cd1 === '');
      await hold('#calCancel'); st = await state();
      t(`${w}×${h}: tap 關閉 closes the sheet without toggling 鎖定 / 聲音`, !st.open && st.lock === 'false' && st.snd === 'false');
      await page.click('#calBtn'); await page.click('#calStep');
      await page.waitForFunction(() => document.getElementById('calStep').textContent === '記錄第二點' && !document.getElementById('calStep').disabled, null, { timeout: 20000 });
      await page.click('#calStep');
      await page.waitForFunction(() => document.getElementById('calStep').textContent === '完成', null, { timeout: 20000 });
      await hold('#calStep'); st = await state();
      t(`${w}×${h}: tap 完成 does not turn on 聲音提示 or lock`, !st.open && st.lock === 'false' && st.snd === 'false');
      await feed(page, [0, G, 0.5]); await page.waitForSelector('#status button.link', W);
      await hold('#status button.link'); st = await state();
      t(`${w}×${h}: tap 改用邊緣 switches mode and nothing else`, st.mode === 'edge' && st.lock === 'false' && st.snd === 'false');
      await ctx.close();
    }
    { // 清除校正 can be undone
      const { ctx, page, cdp } = await mk(390, 844);
      await start(page, up(0, 0));
      await page.evaluate(() => { __level.S.offset.x = 0.6; __level.S.offset.y = -0.4; });
      await page.click('#calBtn'); await tap(page, cdp, '#calReset');
      const cleared = await page.evaluate(() => __level.S.offset.x);
      await page.waitForSelector('#toast button', W);
      await tap(page, cdp, '#toast button');
      const back = await page.evaluate(() => ({ ...__level.S.offset, saved: JSON.parse(localStorage.getItem('level-meter.v1')).offset }));
      t('清除校正 toast offers 復原, which restores and saves the offsets', cleared === 0 && near(back.x, 0.6, 1e-9) && near(back.y, -0.4, 1e-9) && near(back.saved.x, 0.6, 1e-9));
      await ctx.close();
    }
    // short screens and landscape: start button, then 鎖定讀數, on the first screen in every mode
    for (const [w, h] of [[375, 500], [390, 610], [360, 640], [844, 390], [667, 375], [430, 932]]) {
      const { ctx, page } = await mk(w, h);
      const bottom = s => page.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return b.bottom; }, s);
      const go = await bottom('#goBtn');
      t(`${w}×${h}: 啟用感測器 on the first screen (${go.toFixed(0)} ≤ ${h})`, go <= h);
      await start(page, up(1, 2));
      for (const m of ['flat', 'edge', 'prot']) {
        await page.click(`[data-mode=${m}]`); await frame(page);
        const lk = await bottom('#lockBtn'), sw = await page.evaluate(() => document.documentElement.scrollWidth);
        t(`${w}×${h} ${m}: 鎖定讀數 on the first screen (${lk.toFixed(0)} ≤ ${h}), no sideways scroll`, lk <= h && sw <= w);
      }
      if (w <= 430) {
        const lines = await page.evaluate(() => { const f = document.getElementById('fine'), r = document.createRange(); r.selectNodeContents(f); const rects = [...r.getClientRects()]; const ys = [...new Set(rects.map(x => Math.round(x.top)))]; const last = rects.filter(x => Math.round(x.top) === Math.max(...ys)).reduce((a, x) => a + x.width, 0); return { n: ys.length, last }; });
        t(`${w}×${h}: footer hint does not leave a lone word on its last line`, lines.n === 1 || lines.last > 60);
      }
      if (w > h) {
        await page.click('[data-mode=flat]'); await frame(page);
        const vw = await page.evaluate(() => document.getElementById('vial').getBoundingClientRect().width);
        t(`${w}×${h}: landscape vial uses the column height (${vw.toFixed(0)} px)`, vw >= h - 110);
        const v = await page.evaluate(() => { const a = document.getElementById('stage').getBoundingClientRect(), b = document.getElementById('reads').getBoundingClientRect(); return a.right <= b.left; });
        t(`${w}×${h}: landscape puts the instrument beside the readings`, v);
      }
      await ctx.close();
    }
    t('no console errors or warnings in the browser checks ' + JSON.stringify(errors.slice(0, 3)), errors.length === 0);
  } catch (e) { fail++; console.log('FAIL browser checks threw:', e.message.split('\n')[0], (e.stack.match(/tests\.js:\d+/g) || []).join(' ')); }
  await browser.close(); srv.close();
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
