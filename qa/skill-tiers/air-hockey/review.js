// Independent release review probes for air-hockey. Usage: node review.js [sections...]
// sections: load touch latency layout shots rotate persist two perf extra   (default: all)
// All input is real CDP touch (Input.dispatchTouchEvent). Hooks are only read, never used to play.
const fs = require('fs'), path = require('path'), http = require('http');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { makeTierBot } = require('./tierbot.js');
const OUT = __dirname, APP = path.resolve(__dirname, '../../../apps/air-hockey/index.html');
const SKEL = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>';
const raw = fs.readFileSync(APP, 'utf8');
const html = /^\s*<!doctype/i.test(raw) ? raw : SKEL + raw + '</body></html>';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const want = process.argv.slice(2); const on = s => !want.length || want.includes(s);
const R = { errors: [], external: [] };
let base = '';
const INIT = `(() => { const raf = window.requestAnimationFrame.bind(window); window.__perf = { cb: [], iv: [], lastTs: 0, on: false };
  window.requestAnimationFrame = function (fn) { return raf(function (ts) { const t0 = performance.now(); fn(ts); const P = window.__perf; if (P.on) { P.cb.push(performance.now() - t0); if (P.lastTs) P.iv.push(ts - P.lastTs); P.lastTs = ts; } }); };
  window.__cnt = { pd: 0, pu: 0, click: {} };
  addEventListener('pointerdown', e => { if (e.target.id === 'cv') window.__cnt.pd++; }, true);
  addEventListener('pointerup', e => { if (e.target.id === 'cv') window.__cnt.pu++; }, true);
  addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b && b.id) window.__cnt.click[b.id] = (window.__cnt.click[b.id] || 0) + 1; }, true);
})();`;
async function open(browser, w, h, scheme, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, offline: !!opts.offline });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage(); const tag = `${w}x${h}-${scheme}`;
  page.on('pageerror', e => R.errors.push(tag + ' pageerror ' + e));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') R.errors.push(tag + ' console.' + m.type() + ' ' + m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('file:') && !u.startsWith('data:') && !u.startsWith('blob:')) R.external.push(u); });
  const t0 = Date.now(); await page.goto(opts.offline ? 'file://' + APP : base, { waitUntil: 'load' }); const loadMs = Date.now() - t0;
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, loadMs, tag };
}
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function center(page, sel) { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height }; }
async function tapSel(cdp, page, sel, hold = 50, after = 150) { const c = await center(page, sel); await T(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 7 }]); await sleep(hold); await T(cdp, 'touchEnd', []); await sleep(after); }
const st = page => page.evaluate(() => window.__game.state());
const L = page => page.evaluate(() => window.__game.layout());
const scr = (Ly, x, y) => ({ x: Ly.ox + x * Ly.s, y: Ly.oy + y * Ly.s });
async function toPlay(cdp, page, level) {
  if (level && level > 1) {
    await tapSel(cdp, page, '#tSelect', 50, 500);
    if ((await page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') await tapSel(cdp, page, '#unlockSw', 50, 300);
    await page.locator('.lt[data-n="' + level + '"]').scrollIntoViewIfNeeded(); await sleep(300);
    await tapSel(cdp, page, '.lt[data-n="' + level + '"]', 50, 700);
  } else await tapSel(cdp, page, '#tPlay', 50, 600);
  await tapSel(cdp, page, '#vGo', 50, 200);
}
// visible controls: size, inside viewport, overlaps between them
async function controlsAudit(page) {
  return page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, els = [...document.querySelectorAll('button, .opp, .dchip, .tprog, h1, h2, .sub, .score, .stars, p, .vname, .dbar, .chips')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !e.closest('.hidden'); });
    const out = { vw, vh, scrollW: document.documentElement.scrollWidth, small: [], outside: [], overlap: [] };
    const rs = els.map(e => ({ id: e.id || e.className || e.tagName, r: e.getBoundingClientRect(), btn: e.tagName === 'BUTTON', e }));
    for (const a of rs) {
      if (a.btn && (a.r.width < 44 - 0.5 || a.r.height < 44 - 0.5)) out.small.push([a.id, Math.round(a.r.width), Math.round(a.r.height)]);
      const sc = a.e.closest('.ov, .grid, .helpscroll');
      if (!sc && (a.r.left < -0.5 || a.r.right > vw + 0.5 || a.r.top < -0.5 || a.r.bottom > vh + 0.5)) out.outside.push([a.id, Math.round(a.r.left), Math.round(a.r.top), Math.round(a.r.right), Math.round(a.r.bottom)]);
      if (sc && (a.r.left < -0.5 || a.r.right > vw + 0.5)) out.outside.push([a.id, 'x', Math.round(a.r.left), Math.round(a.r.right)]);
    }
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j]; if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix > 1 && iy > 1) out.overlap.push([a.id, b.id, Math.round(ix), Math.round(iy)]);
    }
    return out;
  });
}
// table rect vs HUD / score boxes in play
async function playGeom(page) {
  return page.evaluate(() => {
    const Ly = window.__game.layout(), RIM = 12; const tb = { l: Ly.ox - RIM * Ly.s, t: Ly.oy - RIM * Ly.s, r: Ly.ox + (360 + RIM) * Ly.s, b: Ly.oy + (640 + RIM) * Ly.s };
    const hud = document.getElementById('hud').getBoundingClientRect(); const kids = [...document.querySelectorAll('#hud > *')].map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, l: r.left, t: r.top, r: r.right, b: r.bottom }; });
    const hit = kids.filter(k => Math.min(k.r, tb.r) - Math.max(k.l, tb.l) > 1 && Math.min(k.b, tb.b) - Math.max(k.t, tb.t) > 1).map(k => k.id);
    return { W: Ly.W, H: Ly.H, s: +Ly.s.toFixed(3), table: { l: Math.round(tb.l), t: Math.round(tb.t), r: Math.round(tb.r), b: Math.round(tb.b) }, hud: kids.map(k => [k.id, Math.round(k.l), Math.round(k.t), Math.round(k.r), Math.round(k.b)]), hudOverTable: hit, tableInside: tb.l >= -0.5 && tb.t >= -0.5 && tb.r <= Ly.W + 0.5 && tb.b <= Ly.H + 0.5, bodyLand: document.body.classList.contains('land') };
  });
}
// in-browser tier bot (perception delay in wall-clock ms)
async function botPlay(page, cdp, tier, seed, maxMs, stopOnOver = true) {
  const Ly = await L(page), bot = makeTierBot(tier, seed), hist = [];
  const t0 = Date.now(); let s = await st(page), fx = s.mx, fy = s.my + Ly.offset, down = false, last = Date.now(), moves = 0;
  while (Date.now() - t0 < maxMs) {
    s = (await cdp.send('Runtime.evaluate', { expression: 'window.__game.state()', returnByValue: true })).result.value;
    if (stopOnOver && (s.scene === 'result' || s.over)) break;
    if (s.scene !== 'play') { await sleep(50); continue; }
    const now = Date.now(), tt = (now - t0) / 1000; hist.push(Object.assign({ at: now }, s));
    const D = bot.curDelay(tt) * 1000;
    while (hist.length > 2 && hist[1].at <= now - D) hist.shift();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const seen = hist[0], tg = bot.plan(seen, tt, (now - seen.at) / 1000);
    const tx = tg.x, ty = tg.y + Ly.offset, dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy), stp = bot.T.fspd * dt;
    if (d <= stp) { fx = tx; fy = ty; } else { fx += dx / d * stp; fy += dy / d * stp; }
    fx = Math.max(-5, Math.min(365, fx)); fy = Math.max(fy, 330); fy = Math.min(fy, 652);
    const p = scr(Ly, fx, fy);
    if (!down) await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]);
    else cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] }).catch(() => {});
    down = true; moves++;
    await sleep(8);
  }
  await T(cdp, 'touchEnd', []);
  return { secs: Math.round((Date.now() - t0) / 1000), moves, state: await st(page) };
}

(async () => {
  const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); s.end(html); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r)); base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const res = fs.existsSync(path.join(OUT, 'review-results.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'review-results.json'), 'utf8')) : {};
  const save = () => fs.writeFileSync(path.join(OUT, 'review-results.json'), JSON.stringify(Object.assign(res, { errors: R.errors, external: [...new Set(R.external)] }), null, 1));
  try {
    if (on('load')) {
      const o = res.load = {};
      for (let i = 0; i < 3; i++) {
        const { ctx, page, loadMs } = await open(browser, 390, 844, 'dark', { offline: i === 2 });
        const tm = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const p = performance.getEntriesByName('first-contentful-paint')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: p ? Math.round(p.startTime) : null }; });
        if (i === 2) { const cdp = await ctx.newCDPSession(page); await toPlay(cdp, page, 1); await sleep(3000); tm.offlinePlayScene = await page.evaluate(() => window.__game.scene); }
        o['run' + i + (i === 2 ? '-offline-file' : '')] = Object.assign({ wallMs: loadMs }, tm, { scene: await page.evaluate(() => window.__game.scene) });
        await ctx.close();
      }
      save();
    }
    if (on('touch')) {
      const out = res.touch = {};
      for (const [w, h] of [[390, 844], [360, 640], [844, 390]]) {
        const { ctx, page, cdp, tag } = await open(browser, w, h, 'dark');
        await sleep(400); await toPlay(cdp, page, 1); await sleep(300);
        const Ly = await L(page), o = out[tag] = {};
        // rapid taps: 8/s alternating left/right of the player half; check every tap moved the mallet to that side
        const pts = [[80, 470], [280, 590]], N = 40; let ok = 0, wrong = [];
        const pd0 = await page.evaluate(() => window.__cnt.pd);
        for (let i = 0; i < N; i++) {
          const [wx, wy] = pts[i % 2], p = scr(Ly, wx, wy);
          await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(45); await T(cdp, 'touchEnd', []); await sleep(70);
          const s = await st(page); const ex = Math.max(28, Math.min(332, wx));
          if (Math.abs(s.mx - ex) < 40) ok++; else wrong.push([i, Math.round(s.mx), ex]);
          await sleep(5);
        }
        const pd1 = await page.evaluate(() => window.__cnt.pd);
        o.rapid = { sent: N, pointerdownsSeen: pd1 - pd0, malletReachedTapSide: ok, wrong: wrong.slice(0, 8) };
        // two-finger: hold left, tap right repeatedly (second finger)
        const a = scr(Ly, 70, 560), b = scr(Ly, 290, 560); let follow = 0;
        await T(cdp, 'touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(150);
        for (let i = 0; i < 6; i++) { await T(cdp, 'touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(60); await T(cdp, 'touchEnd', [{ x: b.x, y: b.y, id: 2 }]); await sleep(60); const s = await st(page); if (s.mx > 180) follow++; }
        await sleep(200); const sAfter = await st(page);
        await T(cdp, 'touchEnd', []);
        o.secondFinger = { taps: 6, malletOnSecondFingerSide: follow, malletAfterReleaseX: Math.round(sAfter.mx) };
        // pause / resume alternation 8/s (alternating targets: pause button then resume button)
        let toggles = 0; const sc = [];
        for (let i = 0; i < 16; i++) {
          const sel = i % 2 === 0 ? '#bPause' : '#pResume';
          const c = await center(page, sel).catch(() => null);
          if (!c) { sc.push('missing ' + sel); continue; }
          await T(cdp, 'touchStart', [{ x: c.x, y: c.y, id: 3 }]); await sleep(40); await T(cdp, 'touchEnd', []); await sleep(80);
          const sn = await page.evaluate(() => window.__game.scene); sc.push(sn); if (sn === (i % 2 === 0 ? 'paused' : 'play')) toggles++;
        }
        o.pauseResume = { sent: 16, correct: toggles, clicks: await page.evaluate(() => window.__cnt.click), seq: sc.join(',') };
        o.sizes = await page.evaluate(() => ['bPause', 'bMute'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, r.width, r.height]; }));
        await ctx.close();
      }
      save();
    }
    if (on('latency')) {
      const { ctx, page, cdp } = await open(browser, 390, 844, 'dark');
      await sleep(400); await toPlay(cdp, page, 1); await sleep(1500);
      const Ly = await L(page);
      await page.evaluate(() => { window.__lt = { ev: [], seen: [] }; addEventListener('pointermove', e => { window.__lt.ev.push(e.timeStamp); }, true); addEventListener('pointerdown', e => { window.__lt.ev.push(e.timeStamp); }, true);
        let prev = null; const loop = ts => { const s = window.__game.state(); if (prev != null && Math.abs(s.mx - prev) > 0.5) window.__lt.seen.push(performance.now()); prev = s.mx; requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
      const lat = [];
      for (let i = 0; i < 30; i++) {
        const x = i % 2 ? 100 : 260, p = scr(Ly, x, 560);
        await page.evaluate(() => { window.__lt.ev.length = 0; window.__lt.seen.length = 0; });
        await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(150); await T(cdp, 'touchEnd', []); await sleep(120);
        const r = await page.evaluate(() => { const e = window.__lt.ev[0], s = window.__lt.seen.find(t => t >= e); return e && s ? s - e : null; });
        if (r != null) lat.push(r);
      }
      lat.sort((a, b) => a - b);
      res.latency = { n: lat.length, p50: +lat[lat.length >> 1].toFixed(1), p90: +lat[Math.floor(lat.length * 0.9)].toFixed(1), max: +lat[lat.length - 1].toFixed(1), note: 'pointerdown timeStamp -> first rAF in which the mallet has moved' };
      await ctx.close(); save();
    }
    if (on('layout')) {
      const out = res.layout = {};
      for (const [w, h, sch] of [[360, 640, 'dark'], [390, 844, 'light'], [430, 932, 'dark'], [844, 390, 'light'], [375, 500, 'dark'], [390, 610, 'light'], [430, 740, 'dark'], [640, 360, 'dark']]) {
        const { ctx, page, cdp, tag } = await open(browser, w, h, sch); await sleep(500);
        const o = out[tag] = {};
        o.title = await controlsAudit(page);
        await tapSel(cdp, page, '#tHelp', 50, 400); o.help = await controlsAudit(page); await tapSel(cdp, page, '#hOk', 50, 300);
        await tapSel(cdp, page, '#tStats', 50, 400); o.stats = await controlsAudit(page); await tapSel(cdp, page, '#stOk', 50, 300);
        await tapSel(cdp, page, '#tSelect', 50, 500); o.select = await controlsAudit(page);
        o.selectTile = await page.evaluate(() => { const r = document.querySelector('.lt').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
        await tapSel(cdp, page, '.lt[data-n="1"]', 50, 600); o.vs = await controlsAudit(page);
        await tapSel(cdp, page, '#vGo', 50, 600); o.play = await playGeom(page); o.playCtl = await controlsAudit(page);
        await tapSel(cdp, page, '#bPause', 50, 400); o.pause = await controlsAudit(page);
        await tapSel(cdp, page, '#pResume', 50, 200);
        await ctx.close();
      }
      save();
    }
    if (on('shots')) {
      const D = path.join(OUT, 'shots');
      // 360x640 dark title, 390x844 light play, 430x932 dark play, 844x390 light play, 360x640 light select, result 390 dark
      { const { ctx, page } = await open(browser, 360, 640, 'dark'); await sleep(900); await page.screenshot({ path: D + '/360x640-title-dark.png' }); await ctx.close(); }
      for (const [w, h, sch] of [[390, 844, 'light'], [430, 932, 'dark'], [844, 390, 'light']]) {
        const { ctx, page, cdp } = await open(browser, w, h, sch); await sleep(400); await toPlay(cdp, page, 37);
        await botPlay(page, cdp, 'skilled', 5, 3500, false); await page.screenshot({ path: D + `/${w}x${h}-play-${sch}.png` }); await ctx.close();
      }
      { const { ctx, page, cdp } = await open(browser, 360, 640, 'light'); await sleep(400); await tapSel(cdp, page, '#tSelect', 50, 600); await page.screenshot({ path: D + '/360x640-select-light.png' });
        await tapSel(cdp, page, '.lt[data-n="1"]', 50, 700); await page.screenshot({ path: D + '/360x640-vs-light.png' }); await ctx.close(); }
      save();
    }
    if (on('rotate')) {
      const { ctx, page, cdp } = await open(browser, 390, 844, 'dark'); await sleep(400); await toPlay(cdp, page, 1); await sleep(600);
      const o = res.rotate = { before: await playGeom(page) };
      await page.setViewportSize({ width: 844, height: 390 }); await sleep(500); o.land = await playGeom(page);
      const Ly = await L(page); const p = scr(Ly, 300, 560); await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(300); o.landTouchMx = Math.round((await st(page)).mx); await T(cdp, 'touchEnd', []);
      await page.setViewportSize({ width: 390, height: 844 }); await sleep(500); o.back = await playGeom(page);
      await page.screenshot({ path: path.join(OUT, 'shots', 'rotated-back-390x844.png') });
      // pause overlay after rotation
      await tapSel(cdp, page, '#bPause', 50, 300); o.pauseAfter = await controlsAudit(page);
      await ctx.close(); save();
    }
    if (on('persist')) {
      const { ctx, page, cdp } = await open(browser, 390, 844, 'dark'); await sleep(400);
      const o = res.persist = {};
      await tapSel(cdp, page, '#bMute').catch(() => {});
      await toPlay(cdp, page, 1);
      await tapSel(cdp, page, '#bMute', 50, 200); o.mutedSet = await page.evaluate(() => localStorage.getItem('hockey.mute'));
      const r = await botPlay(page, cdp, 'superhuman', 1, 240000);
      o.l1 = { secs: r.secs, score: r.state.score, winner: r.state.winner };
      for (let k = 0; k < 40 && (await page.evaluate(() => window.__game.scene)) !== 'result'; k++) await sleep(100);
      await sleep(1200);
      o.result = await page.evaluate(() => ({ title: document.getElementById('rTitle').textContent, stars: document.querySelectorAll('#rStars .on').length, main: document.getElementById('rMain').textContent, ach: document.getElementById('rAch').textContent }));
      o.resultAudit = await controlsAudit(page);
      await page.screenshot({ path: path.join(OUT, 'shots', '390x844-result-dark.png') });
      // replay and share do not throw
      await tapSel(cdp, page, '#rReplay', 50, 2500); o.replayScene = await page.evaluate(() => window.__game.scene);
      await tapSel(cdp, page, '#rpExit', 50, 400);
      await tapSel(cdp, page, '#rShare', 50, 1200); o.shareShown = await page.evaluate(() => !document.getElementById('share').classList.contains('hidden'));
      await tapSel(cdp, page, '#shOk', 50, 300);
      o.storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
      await page.reload({ waitUntil: 'load' }); await sleep(600);
      o.afterReload = await page.evaluate(() => ({ tProg: document.getElementById('tProg').textContent, mute: localStorage.getItem('hockey.mute') }));
      await tapSel(cdp, page, '#tStats', 50, 400); o.statsAfter = await page.evaluate(() => document.getElementById('stGrid').innerText.replace(/\n/g, ' '));
      await tapSel(cdp, page, '#stOk', 50, 200);
      // mid-match reload
      await toPlay(cdp, page, 2); await botPlay(page, cdp, 'casual', 3, 5000, false);
      o.midBefore = await st(page); await page.reload({ waitUntil: 'load' }); await sleep(600);
      o.midAfter = await page.evaluate(() => ({ scene: window.__game.scene, tProg: document.getElementById('tProg').textContent }));
      await ctx.close(); save();
    }
    if (on('two')) {
      const { ctx, page, cdp } = await open(browser, 390, 844, 'dark'); await sleep(400);
      await tapSel(cdp, page, '#tTwo', 50, 1500);
      const Ly = await L(page), a = scr(Ly, 80, 120), b = scr(Ly, 280, 520);
      await T(cdp, 'touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(400);
      const s = await st(page);
      await T(cdp, 'touchEnd', []);
      res.two = { top: [Math.round(s.ox), Math.round(s.oy)], bottom: [Math.round(s.mx), Math.round(s.my)], expectTop: [80, 120 + 36], expectBottom: [280, 520 - 36] };
      await page.screenshot({ path: path.join(OUT, 'shots', '390x844-two-dark.png') });
      await ctx.close(); save();
    }
    if (on('wedge')) {
      // push the puck slowly into the player's bottom-right corner, then lift the finger
      const o = res.wedge = { trials: [] };
      for (let trial = 0; trial < 4 && !o.found; trial++) {
        const { ctx, page, cdp } = await open(browser, 390, 844, 'dark'); await sleep(400); await toPlay(cdp, page, 1);
        const Ly = await L(page), mv = async (x, y) => { const p = scr(Ly, x, y + Ly.offset); await T(cdp, 'touchMove', [{ x: p.x, y: p.y, id: 1 }]); };
        let p = scr(Ly, 60, 560 + Ly.offset); await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(150);
        await mv(60, 440); await sleep(150); const dx = 0.751, dy = 0.660, sx = 180 - 48 * dx, sy = 480 - 48 * dy; await mv(sx, sy);
        while ((await st(page)).freeze > 0) await sleep(20);
        const sp = 60 + trial * 30, t0 = Date.now(); let d = 0;
        while (d < 240) { d = (Date.now() - t0) / 1000 * sp; await mv(Math.min(330, sx + dx * d), Math.min(612, sy + dy * d)); await sleep(16); }
        await sleep(600); const pushed = await st(page);
        await T(cdp, 'touchEnd', []);
        const a = await st(page); await sleep(5000); const b = await st(page);
        const tr = { pushSpeed: sp, pushed: { px: +pushed.px.toFixed(1), py: +pushed.py.toFixed(1), v: Math.round(Math.hypot(pushed.pvx, pushed.pvy)), score: pushed.score },
          after5sFingerUp: { px: +b.px.toFixed(1), py: +b.py.toFixed(1), v: Math.round(Math.hypot(b.pvx, b.pvy)), moved: +Math.hypot(b.px - a.px, b.py - a.py).toFixed(1), mx: Math.round(b.mx), my: Math.round(b.my), score: b.score } };
        if (tr.after5sFingerUp.moved < 1 && tr.after5sFingerUp.v > 40) {
          o.found = true; await page.screenshot({ path: path.join(OUT, 'shots', '390x844-wedged-corner.png') });
          p = scr(Ly, 180, 470 + Ly.offset); await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]);
          let vmax = 0; for (let k = 0; k < 15; k++) { const s2 = await st(page); vmax = Math.max(vmax, Math.hypot(s2.pvx, s2.pvy)); await sleep(30); }
          await T(cdp, 'touchEnd', []); tr.releaseMaxSpeed = Math.round(vmax);
        }
        o.trials.push(tr); await ctx.close();
      }
      save();
    }
    if (on('perf')) {
      // busiest: level 100 rally with world-class bot (fast puck, particles, trails, goal bursts), 30 s
      const { ctx, page, cdp } = await open(browser, 390, 844, 'dark'); await sleep(400); await toPlay(cdp, page, 100); await sleep(200);
      await page.evaluate(() => { window.__perf.on = true; window.__perf.cb.length = 0; window.__perf.iv.length = 0; window.__perf.lastTs = 0; });
      await botPlay(page, cdp, 'world', 11, 30000, false);
      const p = await page.evaluate(() => { const P = window.__perf; P.on = false; const q = (a, f) => { const b = a.slice().sort((x, y) => x - y); return +b[Math.floor(b.length * f)].toFixed(2); }; return { frames: P.iv.length, fps: +(1000 / (P.iv.reduce((a, b) => a + b, 0) / P.iv.length)).toFixed(1), ivP50: q(P.iv, 0.5), ivP95: q(P.iv, 0.95), over20: P.iv.filter(x => x > 20).length, cbP50: q(P.cb, 0.5), cbP95: q(P.cb, 0.95), cbMax: +Math.max(...P.cb).toFixed(2) }; });
      const lo = fs.readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).join(' ');
      res.perf = Object.assign(p, { loadavg: lo, score: (await st(page)).score });
      await ctx.close(); save();
    }
  } finally { save(); await browser.close(); srv.close(); }
})();
