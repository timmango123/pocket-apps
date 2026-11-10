// Regression tests for 紙鶴穿梭 (flap-glider). Usage: node tests.js [--core]
// 1) Core (Node, the game's own CORE-START..CORE-END): warm-up opening, soft ground before the first column, assist
//    strength, difficulty plateau, early variety, determinism, and seeded skill-tier bots (clumsy gets through the
//    opening, world class reaches platinum).
// 2) Browser (Chromium, real CDP touch, phone sizes): damaged saves, old saves, death cause, record saved at the
//    crash, lenient ceiling scored apart, tap timestamps, 375x500 title, landscape HUD and help card, ceiling drawn,
//    fewer redraws behind cards, no console errors.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {makeSim, gapC, colRects, speedAt, gapAt, warmGap, STEP, GRAV, FLAP_V, MAX_FALL, CR_RX, CR_RY, GROUND, WARM_N, ASSIST_GAP};')();
let pass = 0, fail = 0, last = '';
function ok(c, msg) { last = msg; if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const seeds = n => Array.from({ length: n }, (_, i) => 5000 + i * 104729);
function layout(seed, n, o) { const S = C.makeSim(Object.assign({ seed }, o)); S.x = 0; while (S.cols.length < n) { S.x += 400; S.ensure(); } return S.cols.slice(0, n); }

// ---------- warm-up opening (finding: 89/200 clumsy runs died before the first column) ----------
{
  let wide = true, near = true, noFeat = true;
  for (const sd of seeds(60)) {
    const cs = layout(sd, 12);
    for (let i = 0; i < 5; i++) {
      if (cs[i].gaps[0].h < 280 - i * 12 - 1e-6) wide = false;
      if (Math.abs(cs[i].gaps[0].c - 290) > 40 + i * 12 + 1e-6) near = false;
      if (cs[i].amp || cs[i].dbl) noFeat = false;
    }
  }
  ok(wide, 'the first five columns have wide warm-up gaps (280 px narrowing by 12)');
  ok(near, 'the first five gaps sit near the start height (290 ± 40..88)');
  ok(noFeat, 'no swinging or double gaps in the first five columns');
  // the warm-up tapers into the normal curve without a step
  const cs = layout(5000, 14); let step = 0;
  for (let i = 1; i < 14; i++) if (!cs[i].breath && !cs[i - 1].breath) step = Math.max(step, cs[i - 1].gaps[0].h - cs[i].gaps[0].h);
  ok(step <= 16, 'gap narrows smoothly from the warm-up into the normal curve (largest step ' + step.toFixed(1) + ' px)');
}
// ---------- soft ground before the first column ----------
{
  const S = C.makeSim({ seed: 11 }); let deathBy = '';
  while (!S.dead && S.passes === 0 && S.t < 10) { S.step(C.STEP); for (const e of S.events) if (e.type === 'die') deathBy = e.by; S.events.length = 0; }
  ok(S.bounces > 0 && deathBy !== 'ground', 'never tapping: the crane bounces off the ground before the first column (bounces ' + S.bounces + ', died by ' + (deathBy || '-') + ')');
  // after the first column the ground is deadly again
  const T = C.makeSim({ seed: 11 }); let guard = 0;
  while (T.passes === 0 && guard++ < 5000) { T.y = C.gapC(T.cols[0], 0, T.t); T.vy = 0; T.step(C.STEP); T.events.length = 0; }
  T.y = C.GROUND - C.CR_RY - 1; T.vy = 300; T.step(C.STEP);
  ok(T.passes >= 1 && T.deathBy === 'ground', 'after passing a column, falling to the ground ends the run (' + T.deathBy + ', passes ' + T.passes + ')');
}
// ---------- assist mode is stronger (finding: assist clumsy averaged 2.6) ----------
{
  const a = layout(7, 40, { assist: true }), n = layout(7, 40);
  let r = 0; for (let i = 0; i < 40; i++) r = Math.max(r, Math.abs(a[i].gaps[0].h / n[i].gaps[0].h - 1.35));
  ok(r < 1e-9, 'assist gaps are 35% wider than normal ones at every column');
}
// ---------- plateau: speed stops at 40, gaps stop at 145 ----------
ok(C.speedAt(200) === C.speedAt(40) && C.speedAt(39) < C.speedAt(40), 'speed stops rising at score 40 (' + C.speedAt(40).toFixed(0) + ' px/s)');
ok(C.gapAt(500) === 145, 'gaps never narrow below 145 px');
ok(/var MEDALS = \[\[80, '白金牌'/.test(html) && /80 白金/.test(html) && /if \(s >= 80\) unlock\('plat'\)/.test(html), 'platinum medal and achievement are at 80 points');
// ---------- early variety (finding: the first 20 points were always plain columns) ----------
{
  let withSwing = 0;
  for (const sd of seeds(60)) if (layout(sd, 17).slice(8, 17).some(c => c.amp > 0)) withSwing++;
  ok(withSwing >= 45, 'most runs meet a gently swinging column around 10 points (' + withSwing + '/60)');
  const a = JSON.stringify(layout(99, 30).map(c => [c.x, c.gaps, c.amp])), b = JSON.stringify(layout(99, 30).map(c => [c.x, c.gaps, c.amp]));
  ok(a === b, 'same seed gives the same bamboo sequence (daily route)');
}
// ---------- seeded skill-tier bots (SPEC tiers: reaction, aim / timing error, mistakes, tap rate) ----------
{
  const TIERS = { clumsy: { lat: [0.65, 0.2], pos: 40, tim: 0.12, mistake: 0.15, minGap: 0.25 }, world: { lat: [0.18, 0.025], pos: 4, tim: 0.012, mistake: 0.003, minGap: 0.11 } };
  const mul = a => () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const pick = (c, y, t) => { let gi = 0, b = 1e9; for (let k = 0; k < c.gaps.length; k++) { const d = Math.abs(C.gapC(c, k, t) - y); if (d < b) { b = d; gi = k; } } return gi; };
  const aim = (S, T) => { const xa = S.x + S.v * T, c = S.cols.find(c => c.x + c.w + C.CR_RX >= xa); return c ? C.gapC(c, pick(c, S.y, S.t + T), S.t + T) : 290; };
  function run(seed, P) {
    const r = mul(seed * 31 + 7), S = C.makeSim({ seed }); S.flap();
    const flaps = []; let lastAt = 0, L = null, k = 0; const err = new Map();
    while (!S.dead && S.t < 300) {
      while (flaps.length && S.t >= flaps[0] - 1e-9) { S.flap(); flaps.shift(); }
      if (k++ % 2 === 0) {
        if (L == null) L = Math.max(0.05, P.lat[0] + gauss(r) * P.lat[1]);
        if (S.t + L - lastAt >= P.minGap) {
          const c = S.cols.find(c => c.x + c.w + C.CR_RX >= S.x);
          if (c && !err.has(c.idx)) err.set(c.idx, gauss(r) * P.pos);
          let y = S.y, vy = S.vy; const n = Math.round(L / C.STEP), g = C.GRAV + (S.windA || 0);
          for (let q = 1; q <= n; q++) { const tq = S.t + q * C.STEP; if (flaps.some(f => Math.abs(f - tq) < C.STEP / 2 + 1e-9)) vy = C.FLAP_V; vy = Math.min(C.MAX_FALL, vy + g * C.STEP); y += vy * C.STEP; }
          if (y > aim(S, L) + (c ? err.get(c.idx) : 0) + 18) {
            let at = S.t + L + gauss(r) * P.tim; L = null; lastAt = at;
            if (r() < P.mistake) { if (r() < 0.5) at += 0.25 + r() * 0.2; else flaps.push(at + 0.09); }
            flaps.push(Math.max(S.t, at)); flaps.sort((a, b) => a - b);
          }
        }
      }
      S.step(C.STEP); S.events.length = 0;
    }
    return S;
  }
  const cl = seeds(200).map(sd => run(sd, TIERS.clumsy)), cs = cl.map(s => s.score).sort((a, b) => a - b);
  const zero = cl.filter(s => s.passes === 0).length;
  ok(zero <= 40, 'clumsy tier: at most 20% of runs die before the first column (was 89/200), got ' + zero + '/200');
  ok(cs[100] >= 3, 'clumsy tier median score >= 3 (was 1), got ' + cs[100]);
  ok(cs[199] < 50, 'clumsy tier still fails later (best ' + cs[199] + ' < 50)');
  const wl = seeds(200).map(sd => run(sd, TIERS.world)), plat = wl.filter(s => s.score >= 80).length;
  ok(plat >= 10, 'world tier reaches platinum (80) in some runs (was 0/200 at 100), got ' + plat + '/200');
  console.log(`  bots: clumsy median ${cs[100]}, ${zero}/200 before column 1; world platinum ${plat}/200`);
}
if (process.argv.includes('--core')) { console.log(`${fail ? 'FAIL' : 'OK'} core: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

// ---------- browser ----------
(async () => {
  const { chromium } = require('/opt/node22/lib/node_modules/playwright');
  const browser = await chromium.launch();
  const errors = [];
  const URL = 'file://' + APP;
  async function open(w, h, opt) {
    opt = opt || {};
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: opt.scheme || 'light' });
    if (opt.storage) await ctx.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); for (const k in s) localStorage.setItem(k, s[k]); } }, opt.storage);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'x' + h + ' ' + e)); page.on('console', m => { if (m.type() === 'error') errors.push(w + 'x' + h + ' ' + m.text()); });
    await page.goto(URL); await page.waitForFunction(() => window.__game && window.__game.snap());
    const cdp = await ctx.newCDPSession(page);
    const tap = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    // cards pop in with a scale animation: tap only once the target has stopped moving
    const tapEl = async sel => {
      await page.waitForFunction(s => { const e = document.querySelector(s); return e && e.offsetParent && !(e.closest('.card') || e).getAnimations().some(a => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations !== Infinity); }, sel, { timeout: 20000 });
      let b = await page.locator(sel).boundingBox();
      for (let i = 0; i < 40; i++) { await page.waitForTimeout(30); const c = await page.locator(sel).boundingBox(); if (Math.abs(c.x - b.x) + Math.abs(c.y - b.y) + Math.abs(c.width - b.width) < 0.5) break; b = c; }
      await tap(b.x + b.width / 2, b.y + b.height / 2);
    };
    const snap = () => page.evaluate(() => window.__game.snap());
    const until = (fn, arg, ms) => page.waitForFunction(fn, arg, { timeout: ms || 20000 });
    return { ctx, page, tap, tapEl, snap, until };
  }
  try {
    // --- damaged saves (finding: settings "abc" -> TypeError, nothing worked) ---
    {
      const { ctx, page, tapEl, until } = await open(390, 844, { storage: { 'flapglider.settings': '"abc"', 'flapglider.stats': '{"plays":"x","total":"y"}', 'flapglider.ach': '5', 'flapglider.daily': '"zz"', 'flapglider.best': '"q"' } });
      await tapEl('#tStats'); await until(() => !document.getElementById('stats').classList.contains('hidden'));
      const txt = await page.locator('#stGrid').innerText();
      ok(!/NaN|undefined|x\b/.test(txt), 'damaged saves: stats panel shows numbers, no NaN (' + txt.replace(/\s+/g, ' ').slice(0, 60) + ')');
      await tapEl('#stats .x'); await until(() => document.getElementById('stats').classList.contains('hidden'));
      await tapEl('#tPlay');
      await until(() => window.__game.snap().state === 'ready');
      ok(true, 'damaged saves: the game still starts');
      await ctx.close();
    }
    // --- old saves still load ---
    {
      const { ctx, page } = await open(390, 844, { storage: { 'flapglider.settings': '{"sound":false,"vib":true,"ceil":false,"assist":false,"skin":1}', 'flapglider.stats': '{"plays":3,"passes":40,"total":500,"lanterns":2,"centers":5,"grazes":3,"bestAssist":7,"dailyPlays":1}', 'flapglider.best': '42', 'flapglider.ach': '{"gold":1}' } });
      const bl = await page.locator('#bestLine').innerText(), mute = await page.locator('#muteIcon').innerHTML();
      ok(/最高分 42/.test(bl) && /輔助 7/.test(bl), 'old saves: best 42 and assist best 7 shown on the title (' + bl + ')');
      ok(/M17 9l5 6/.test(mute), 'old saves: sound-off setting kept');
      await ctx.close();
    }
    // --- death cause on the result card, record saved at the crash, input counts ---
    {
      const { ctx, page, tap, tapEl, snap, until } = await open(390, 844);
      await tapEl('#tPlay'); await until(() => window.__game.snap().state === 'ready');
      // keep tapping until the crane hits the ceiling
      await tap(195, 600);
      for (let i = 0; i < 40 && (await snap()).state === 'play'; i++) { await tap(195, 600); await page.waitForTimeout(60); }
      await until(() => window.__game.snap().state === 'dead' || window.__game.snap().state === 'over');
      const saved = await page.evaluate(() => ({ st: JSON.parse(localStorage.getItem('flapglider.stats') || 'null'), state: window.__game.snap().state }));
      ok(saved.st && saved.st.plays === 1, 'the run is saved at the crash, before the result card (' + saved.state + ', plays ' + (saved.st && saved.st.plays) + ')');
      await until(() => window.__game.snap().state === 'over');
      const by = (await snap()).by, cause = await page.locator('#oCause').innerText();
      ok(by === 'ceil' && /天頂/.test(cause), 'result card names the cause: ' + by + ' -> ' + cause);
      // medal shine stops, and the scene behind the card is redrawn less
      await until(() => window.__game.perf().medalAnim === 0, null, 20000);
      ok(true, 'medal shine animation ends');
      const p0 = await page.evaluate(() => window.__game.perf()); await until(f => window.__game.perf().frames >= f + 30, p0.frames);
      const p1 = await page.evaluate(() => window.__game.perf());
      ok(p1.renders - p0.renders <= 2, 'game-over card: scene not redrawn every frame once still (' + (p1.renders - p0.renders) + ' redraws in ' + (p1.frames - p0.frames) + ' frames)');
      await tapEl('#oHome'); await until(() => window.__game.snap().state === 'title');
      const q0 = await page.evaluate(() => window.__game.perf()); await until(f => window.__game.perf().frames >= f + 40, q0.frames);
      const q1 = await page.evaluate(() => window.__game.perf()), ratio = (q1.renders - q0.renders) / (q1.frames - q0.frames);
      ok(ratio <= 0.6, 'title: scene drawn at about half the frame rate (' + ratio.toFixed(2) + ')');
      // pause: no redraws
      await tapEl('#tPlay'); await until(() => window.__game.snap().state === 'ready'); await tap(195, 600);
      await until(() => window.__game.snap().state === 'play'); await tapEl('#bPause');
      await until(() => window.__game.snap().state === 'pause');
      const r0 = await page.evaluate(() => window.__game.perf()); await until(f => window.__game.perf().frames >= f + 20, r0.frames);
      const r1 = await page.evaluate(() => window.__game.perf());
      ok(r1.renders - r0.renders <= 1, 'pause: scene not redrawn while paused (' + (r1.renders - r0.renders) + ')');
      await ctx.close();
    }
    // --- tap timestamps: two real taps 90 ms apart, delivered while the main thread is busy, both flap ---
    {
      const { ctx, page, tap, tapEl, snap, until } = await open(390, 844);
      await tapEl('#tPlay'); await until(() => window.__game.snap().state === 'ready'); await tap(195, 600);
      await until(() => window.__game.snap().state === 'play');
      const f0 = (await snap()).flaps;
      await page.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 400) { } }, 30); });
      await page.waitForTimeout(80);
      // both taps reach the page together after the stall; their own event times are 90 ms apart
      const cdp2 = await ctx.newCDPSession(page), t0 = Date.now() / 1000;
      const send = (type, pts, ts) => cdp2.send('Input.dispatchTouchEvent', { type, touchPoints: pts, timestamp: ts });
      await Promise.all([send('touchStart', [{ x: 120, y: 600 }], t0), send('touchEnd', [], t0 + 0.03), send('touchStart', [{ x: 260, y: 600 }], t0 + 0.09), send('touchEnd', [], t0 + 0.12)]);
      await until(f => window.__game.snap().flaps >= f + 2 || window.__game.snap().state !== 'play', f0, 5000).catch(() => {});
      const s = await snap();
      ok(s.flaps - f0 === 2, 'two taps 90 ms apart during a 400 ms main-thread stall count as two flaps (got ' + (s.flaps - f0) + ')');
      await ctx.close();
    }
    // --- lenient ceiling is scored apart and off in the daily route ---
    {
      const { ctx, page, tap, tapEl, snap, until } = await open(390, 844, { storage: { 'flapglider.settings': '{"sound":false,"vib":false,"ceil":true,"assist":false,"skin":0}', 'flapglider.best': '5' } });
      await tapEl('#tPlay'); await until(() => window.__game.snap().state === 'ready');
      const s = await snap(), chip = await page.locator('#modeChip').innerText();
      ok(s.lenient && /天花板寬鬆/.test(chip), 'lenient ceiling run is marked on the HUD (' + chip + ')');
      // 8 taps a second, alternating sides (the lenient ceiling keeps the crane alive): every tap flaps once.
      // The game clock runs at 1/4 so a slow machine cannot reach the first column during the taps.
      await page.evaluate(() => window.__game.setTimeScale(0.25));
      for (let i = 0; i < 8; i++) { await tap(i % 2 ? 300 : 90, 600); await page.waitForTimeout(125); }
      const s1 = await snap();
      ok(s1.flaps === 8 && s1.state === 'play', '8 taps at 8/s on alternating sides -> 8 flaps (got ' + s1.flaps + ', ' + s1.state + ')');
      await page.evaluate(() => window.__game.setTimeScale(1));
      await until(() => window.__game.snap().state === 'over', null, 60000);
      const r = await page.evaluate(() => ({ best: localStorage.getItem('flapglider.best'), lbl: document.getElementById('oLbl').textContent }));
      ok(r.best === '5' && /輔助/.test(r.lbl), 'lenient ceiling run does not touch the normal best (best ' + r.best + ', label ' + r.lbl + ')');
      await tapEl('#oHome'); await until(() => window.__game.snap().state === 'title'); await tapEl('#tDaily'); await until(() => window.__game.snap().state === 'ready');
      const d = await snap();
      ok(d.mode === 'daily' && !d.lenient && !d.assist, 'daily route ignores the lenient ceiling');
      await ctx.close();
    }
    // --- 375x500 portrait (lobby frame on iPhone SE): title stays a column, nothing wraps or overlaps ---
    {
      const { ctx, page } = await open(375, 500);
      const m = await page.evaluate(() => {
        const r = s => document.querySelector(s).getBoundingClientRect(), h1 = r('.logo h1'), sub = r('.logo .sub');
        const fs = parseFloat(getComputedStyle(document.querySelector('.logo h1')).fontSize);
        const small = [...document.querySelectorAll('.tbtns .small .btn')].map(b => b.getBoundingClientRect().height);
        return { h1h: h1.height, fs, subH: sub.height, subFs: parseFloat(getComputedStyle(document.querySelector('.logo .sub')).fontSize), logoB: r('.logo').bottom, btnT: r('.tbtns').top, btnB: r('.tbtns').bottom, small, dir: getComputedStyle(document.getElementById('title')).flexDirection, H: innerHeight };
      });
      ok(m.dir === 'column' && m.btnT >= m.logoB, '375x500: buttons stay below the title (' + m.dir + ', logo bottom ' + Math.round(m.logoB) + ', buttons top ' + Math.round(m.btnT) + ')');
      ok(m.h1h < m.fs * 1.6 && m.subH < m.subFs * 2, '375x500: title and subtitle on one line each');
      ok(m.small.every(h => h <= 52), '375x500: small button labels on one line (' + m.small.map(Math.round).join(',') + ')');
      ok(m.btnB <= m.H, '375x500: buttons inside the screen');
      await ctx.close();
    }
    // --- landscape 844x390: HUD not over the columns ahead, help card fits, larger world ---
    {
      const { ctx, page, tapEl, until } = await open(844, 390, { scheme: 'dark' });
      const pf = await page.evaluate(() => window.__game.perf());
      ok(pf.scale >= 0.64, 'landscape: world drawn at ' + pf.scale.toFixed(3) + ' (was 0.609)');
      await tapEl('#tPlay'); await until(() => window.__game.snap().state === 'ready');
      const sb = await page.evaluate(() => document.querySelector('.scorebox').getBoundingClientRect().right);
      ok(sb < pf.craneX - 20, 'landscape: score box ends left of the crane (' + Math.round(sb) + ' < ' + Math.round(pf.craneX) + ')');
      await tapEl('#bPause'); await until(() => window.__game.snap().state === 'pause');
      await tapEl('#pHome'); await until(() => window.__game.snap().state === 'title'); await tapEl('#tHelp');
      await until(() => !document.getElementById('help').classList.contains('hidden'));
      const h = await page.evaluate(() => { const ov = document.getElementById('help'), b = ov.querySelector('.btn').getBoundingClientRect(); return { b: b.bottom, H: innerHeight, sh: ov.scrollHeight, ch: ov.clientHeight }; });
      ok(h.b <= h.H && h.sh <= h.ch + 1, 'landscape help: 知道了 visible without scrolling the page (button bottom ' + Math.round(h.b) + '/' + h.H + ')');
      await ctx.close();
    }
    // --- the ceiling is drawn on screens with no room above it ---
    for (const [w, hh] of [[360, 640], [844, 390]]) {
      const { ctx, page } = await open(w, hh);
      await page.waitForFunction(() => window.__game.perf().renders > 3);
      const a = await page.evaluate(() => { const c = document.getElementById('cv'); return c.getContext('2d').getImageData(Math.floor(c.width / 2), 1, 1, 1).data[3]; });
      ok(a > 200, w + 'x' + hh + ': ceiling pole drawn along the top edge (alpha ' + a + ')');
      await ctx.close();
    }
  } catch (e) { fail++; console.log('FAIL browser step threw after "' + last + '": ' + String(e && e.message || e).split('\n')[0]); }
  ok(errors.length === 0, 'no page or console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
  console.log(`${fail ? 'FAIL' : 'OK'} flap-glider: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
