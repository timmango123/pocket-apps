// Independent release review for 飛行棋 (aeroplane-chess). Usage: node review.js <phase...>
// phases: tiers rapid latency targets layout rotate perf misc  (default all). Writes review-results.json + PNGs here.
// Serves the app file unchanged from a fake origin (all other requests aborted and logged), mobile Chromium (hasTouch, isMobile, DPR 2), real CDP touch.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const APP = '' + require('path').resolve(__dirname, '../../../apps/aeroplane-chess/index.html') + '', OUT = process.env.OUT || __dirname, URL = 'http://aero.test/';
const html = fs.readFileSync(APP, 'utf8');
const AP = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] + ';return AP;')();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RES_FILE = path.join(OUT, 'review-results.json');
const R = fs.existsSync(RES_FILE) ? JSON.parse(fs.readFileSync(RES_FILE, 'utf8')) : {};
const save = () => fs.writeFileSync(RES_FILE, JSON.stringify(R, null, 1));
const external = [];
const INIT = `(() => {
  window.__ptr = []; ['pointerdown', 'pointerup'].forEach(t => document.addEventListener(t, e => window.__ptr.push([t, performance.now(), (e.target.id || e.target.className || e.target.tagName) + '']), true));
  const orig = window.requestAnimationFrame.bind(window); window.__fr = [];
  window.requestAnimationFrame = cb => orig(ts => { const t0 = performance.now(); cb(ts); window.__fr.push([t0, performance.now() - t0]); if (window.__fr.length > 40000) window.__fr.splice(0, 20000); });
  window.__lt = []; try { new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration]))).observe({ entryTypes: ['longtask'] }); } catch (e) {}
})();`;
async function open(browser, vp, o = {}) {
  const ctx = o.ctx || await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: o.scheme || 'light' });
  if (!o.ctx) {
    await ctx.addInitScript(INIT);
    await ctx.route('**/*', r => { const u = r.request().url(); if (u === URL) return r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }); external.push(u); return r.abort(); });
  }
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + String(e.stack || e).slice(0, 300)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console.' + m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('worker', w => w.on('console', m => { if (m.type() === 'error') errors.push('worker: ' + m.text()); }));
  const t0 = Date.now(); await page.goto(URL); const navMs = Date.now() - t0;
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors, navMs };
}
let tid = 1;
async function touch(cdp, x, y, hold = 50) { const id = tid++; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }); await sleep(hold); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function box(s, sel) { const b = await s.page.locator(sel).first().boundingBox(); if (!b) throw new Error('no box ' + sel); return b; }
// adapted to the fixed UI: seats live under 進階設定 (#mAdv), the first start opens the tutorial, and a running game asks before being replaced
async function openAdv(s) { if (!(await s.page.$eval('#mAdv', d => d.open))) { await tapSel(s, '#mAdv summary'); await sleep(200); } }
async function startGame(s) { await tapSel(s, '#mStart'); await sleep(300); if (await s.page.isVisible('#confirm')) { await tapSel(s, '#cfYes'); await sleep(300); } if (await s.page.isVisible('#tut')) { await tapSel(s, '#tutSkip'); await sleep(200); } }
async function tapSel(s, sel, hold) { await s.page.locator(sel).first().scrollIntoViewIfNeeded().catch(() => {}); const b = await box(s, sel); await touch(s.cdp, b.x + b.width / 2, b.y + b.height / 2, hold); }
const gs = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state())));
// gaussian
function gauss(R) { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const TIER = {
  clumsy: { react: [650, 200], pos: 40, pick: (st, R, k) => { const n = AP.legal(st, st.turn, st.d).length; return (R() < .15 || R() < .5) ? Math.floor(R() * n) : AP.think(st, 2, 0, k).i; } },
  casual: { react: [400, 100], pos: 20, pick: (st, R, k) => { const n = AP.legal(st, st.turn, st.d).length; return (R() < .06 || R() < .15) ? Math.floor(R() * n) : AP.think(st, 2, 0, k).i; } },
  skilled: { react: [260, 50], pos: 10, pick: (st, R, k) => R() < .02 ? Math.floor(R() * AP.legal(st, st.turn, st.d).length) : AP.think(st, 3, 0, k).i },
  world: { react: [180, 25], pos: 4, pick: (st, R, k) => R() < .003 ? Math.floor(R() * AP.legal(st, st.turn, st.d).length) : AP.think(st, 4, 0, k).i },
  superhuman: { react: [16, 0], pos: 0, pick: (st, R, k) => AP.think(st, 5, 0, k).i }
};
// one full game in the page as the human (red). Returns log.
async function playGame(s, tierId, o = {}) {
  const T = TIER[tierId], R = AP.rng(1000 + tierId.length), log = { tier: tierId, rolls: 0, picks: 0, missTaps: 0, wrongPlane: 0, chooser: 0, skipTaps: 0, noEffect: 0, refresh: null, maxStatusClip: 0 };
  const t0 = Date.now(); let lastSkip = 0;
  for (let step = 0; step < 20000; step++) {
    if (Date.now() - t0 > (o.capMs || 900000)) { log.timeout = true; break; }
    const g = await gs(s.page);
    if (g.over) break;
    if (o.refreshAt && !log.refresh && g.human && !g.busy && g.ui === 'await-roll' && g.st.turnNo >= o.refreshAt) {
      const before = JSON.stringify(g.st); await s.page.reload(); await sleep(900);
      const rec = { turnNo: g.st.turnNo, resumeBtn: await s.page.isVisible('#mResume') };
      if (rec.resumeBtn) { await tapSel(s, '#mResume'); await sleep(600); }
      const g2 = await gs(s.page); rec.sameState = JSON.stringify(g2.st) === before; rec.ui = g2.ui; log.refresh = rec; continue;
    }
    if (g.human && !g.busy && g.ui === 'await-roll') {
      await sleep(Math.max(16, T.react[0] + gauss(R) * T.react[1]));
      const b = await box(s, '#diceBtn'); const k0 = g.st.k;
      await touch(s.cdp, b.x + b.width / 2 + gauss(R) * T.pos * .3, b.y + b.height / 2 + gauss(R) * T.pos * .3);
      log.rolls++; await sleep(120);
      const g2 = await gs(s.page); if (g2.st.k === k0) { await sleep(300); if ((await gs(s.page)).st.k === k0) log.noEffect++; }
      if (o.statusClip) { const c = await s.page.evaluate(() => { const e = document.getElementById('status'); return e.scrollHeight - e.clientHeight; }); log.maxStatusClip = Math.max(log.maxStatusClip, c); }
      continue;
    }
    if (g.human && !g.busy && g.ui === 'choose' && g.legal > 0) {
      const st = g.st, L = AP.legal(st, st.turn, st.d), want = L[T.pick(st, R, 77 + step)];
      await sleep(Math.max(16, T.react[0] * 1.3 + gauss(R) * T.react[1]));
      if (g.chooser) { await tapSel(s, want.stack ? '#chAll' : '#chOne'); log.chooser++; await sleep(200); continue; }
      const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [want.c, want.pl[0]]);
      const before = JSON.stringify(st.pos);
      await touch(s.cdp, x + gauss(R) * T.pos, y + gauss(R) * T.pos); log.picks++;
      await sleep(220);
      const g2 = await gs(s.page);
      if (g2.chooser) { await tapSel(s, want.stack ? '#chAll' : '#chOne'); log.chooser++; await sleep(200); }
      else if (JSON.stringify(g2.st.pos) === before && g2.ui === 'choose') log.missTaps++;
      else { // which plane moved
        const moved = st.pos[0].map((p, i) => g2.st.pos[0][i] !== p ? i : -1).filter(i => i >= 0);
        if (moved.length && !moved.includes(want.pl[0])) log.wrongPlane++;
      }
      continue;
    }
    if (o.skip && !g.human && g.busy && Date.now() - lastSkip > 700) { lastSkip = Date.now(); const b = await box(s, '#cv'); await touch(s.cdp, b.width * (.2 + R() * .6), b.height * .45); log.skipTaps++; }
    await sleep(60);
  }
  for (let k = 0; k < 40 && !(await s.page.isVisible('#result')); k++) await sleep(100);
  const g = await gs(s.page);
  log.over = g.st.over; log.myRank = g.st.over ? g.st.over.ranking.indexOf(0) + 1 : null; log.turnNo = g.st.turnNo; log.caps = g.st.caps[0]; log.hit = g.st.hit[0];
  log.resultTitle = await s.page.textContent('#rTitle'); log.ms = Date.now() - t0;
  return log;
}
const phases = process.argv.slice(2);
const want = p => !phases.length || phases.includes(p);
(async () => {
  const browser = await chromium.launch(process.env.SWIFT ? { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {});
  try {
    if (want('tiers')) {
      R.tiers = R.tiers || {};
      const only = process.env.TIERS ? process.env.TIERS.split(',') : Object.keys(TIER);
      for (const tier of only) {
        const scheme = tier === 'casual' || tier === 'superhuman' ? 'dark' : 'light', vp = tier === 'clumsy' ? { width: 360, height: 640 } : { width: 390, height: 844 };
        const s = await open(browser, vp, { scheme }); await sleep(800);
        if (process.env.QUICK) { await tapSel(s, '#mMode button[data-v="2"]'); await sleep(200); }
        await startGame(s); await sleep(700);
        await tapSel(s, '#bSpeed'); await sleep(200);   // 2x -> 4x
        const log = await playGame(s, tier, { skip: true, capMs: 780000, refreshAt: tier === 'skilled' ? 40 : tier === 'world' ? 60 : 0, statusClip: tier === 'clumsy' });
        if (tier === 'casual') await s.page.screenshot({ path: path.join(OUT, '390x844-dark-result.png') });
        // stats persist across reload
        await s.page.reload(); await sleep(800);
        await tapSel(s, '#mStats'); await sleep(300);
        log.statsAfterReload = (await s.page.textContent('#statsBody')).slice(0, 80);
        log.errors = s.errors; log.longtasks = await s.page.evaluate(() => window.__lt.filter(x => x[1] > 100).length);
        R.tiers[tier] = log; save(); await s.ctx.close();
        console.log('tier', tier, JSON.stringify({ rank: log.myRank, turns: log.turnNo, ms: log.ms, miss: log.missTaps, wrong: log.wrongPlane, noEff: log.noEffect, refresh: log.refresh, errs: s.errors.length }));
      }
    }
    if (want('rapid')) {
      const s = await open(browser, { width: 390, height: 844 }); await sleep(800);
      const rec = {};
      // A: menu personality buttons of seats 2 and 3 alternating at 8/s (menu re-renders on every tap)
      await openAdv(s); await s.page.locator('.pe[data-pe="2"]').scrollIntoViewIfNeeded(); await sleep(200); const p1 = await box(s, '.pe[data-pe="1"]'), p2 = await box(s, '.pe[data-pe="2"]');
      const pe0 = await s.page.evaluate(() => JSON.parse(localStorage.getItem('aeroplane.settings') || 'null'));
      let e1 = 1, e2 = 2, miss = 0;
      for (let k = 0; k < 40; k++) { const t = Date.now(), b = k % 2 ? p2 : p1; await touch(s.cdp, b.x + b.width / 2, b.y + b.height / 2, 40); if (k % 2) e2 = (e2 + 1) % 3; else e1 = (e1 + 1) % 3; const v = await s.page.evaluate(() => { const x = JSON.parse(localStorage.getItem('aeroplane.settings')); return [x.seats[1].pe, x.seats[2].pe]; }); if (v[0] !== e1 || v[1] !== e2) miss++; const w = 125 - (Date.now() - t); if (w > 0) await sleep(w); }
      rec.menuPersonalityAlt = { taps: 40, mismatches: miss, pointerdowns: await s.page.evaluate(() => window.__ptr.filter(p => p[0] === 'pointerdown').length) };
      await startGame(s); await sleep(700);
      // B: toolbar 快轉 ↔ 音效 alternating at 8/s
      const b1 = await box(s, '#bSpeed'), b2 = await box(s, '#bSnd'); let spd = 2, snd = true; miss = 0;
      await s.page.evaluate(() => { window.__ptr = []; });
      for (let k = 0; k < 40; k++) { const t = Date.now(), b = k % 2 ? b2 : b1; await touch(s.cdp, b.x + b.width / 2, b.y + b.height / 2, 40); if (k % 2) snd = !snd; else spd = spd >= 4 ? 1 : spd * 2; const v = await s.page.evaluate(() => { const x = JSON.parse(localStorage.getItem('aeroplane.settings')); return [x.speed, x.snd, document.getElementById('spd').textContent]; }); if (v[0] !== spd || v[1] !== snd || v[2] !== spd + '×') miss++; const w = 125 - (Date.now() - t); if (w > 0) await sleep(w); }
      rec.toolbarAlt = { taps: 40, mismatches: miss, pointerdowns: await s.page.evaluate(() => window.__ptr.filter(p => p[0] === 'pointerdown').length) };
      await s.page.evaluate(() => window.__game.setSpeed(4));
      // C: 8/s alternating dice <-> a board spot for 60 taps through live play; every dice tap made while it was ready must roll exactly once
      const d = await box(s, '#diceBtn'); let diceReady = 0, rolled = 0, extra = 0, planeTaps = 0, moved = 0;
      for (let k = 0; k < 60; k++) {
        const t = Date.now(); const g = await gs(s.page);
        if (k % 2 === 0) { const ready = g.human && !g.busy && g.ui === 'await-roll'; await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2, 40); const g2 = await gs(s.page); const dk = g2.st.k - g.st.k; if (ready) { diceReady++; if (dk >= 1) rolled++; } else if (dk > 0 && g.human) extra++; }
        else { if (g.human && g.ui === 'choose' && !g.busy && g.legal) { const L = AP.legal(g.st, g.st.turn, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [L[0].c, L[0].pl[0]]); await touch(s.cdp, x, y, 40); planeTaps++; await sleep(5); const g2 = await gs(s.page); if (g2.ui !== 'choose' || g2.chooser) moved++; if (g2.chooser) await tapSel(s, '#chOne'); } else { const b = await box(s, '#cv'); await touch(s.cdp, b.width / 2, b.height * .4, 40); } }
        const w = 125 - (Date.now() - t); if (w > 0) await sleep(w);
      }
      rec.diceBoardAlt = { diceTapsWhileReady: diceReady, rolledOnce: rolled, rollsWhenNotReady: extra, planeTaps, planeTapsTakenFirstTime: moved };
      // D: double tap on the ready dice -> exactly one roll
      const dbl = [];
      for (let n = 0; n < 4; n++) {
        for (let k = 0; k < 300; k++) { const g = await gs(s.page); if (g.human && !g.busy && g.ui === 'await-roll') break; if (g.human && g.ui === 'choose' && !g.busy) { if (g.chooser) await tapSel(s, '#chOne'); else { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]); await touch(s.cdp, x, y); } } await sleep(100); }
        const k0 = (await gs(s.page)).st.k; await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2, 30); await sleep(50); await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2, 30); await sleep(1000);
        dbl.push((await gs(s.page)).st.k - k0);
      }
      rec.diceDouble = dbl;
      // E: double tap on a plane during choose -> one move
      const pd = [];
      for (let n = 0; n < 6 && pd.length < 3; n++) {
        for (let k = 0; k < 400; k++) { const g = await gs(s.page); if (g.human && !g.busy && g.ui === 'choose' && g.legal >= 1) break; if (g.human && !g.busy && g.ui === 'await-roll') await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(80); }
        const g = await gs(s.page); const L = AP.legal(g.st, 0, g.st.d); const single = L.find(m => !L.some(o => o !== m && o.from === m.from)); if (!single) continue;
        const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, single.pl[0]]);
        const k0 = g.st.k, pos0 = g.st.pos[0].slice(); await touch(s.cdp, x, y, 30); await sleep(50); await touch(s.cdp, x, y, 30); await sleep(1500);
        const g2 = await gs(s.page); pd.push({ legal: L.length, planesChanged: g2.st.pos[0].filter((p, i) => p !== pos0[i]).length, rollsBetween: g2.st.k - k0, ui: g2.ui });
      }
      rec.planeDouble = pd; rec.errors = s.errors;
      R.rapid = rec; save(); await s.ctx.close(); console.log('rapid', JSON.stringify(rec));
    }
    if (want('latency')) {
      const s = await open(browser, { width: 390, height: 844 }); await sleep(800);
      await startGame(s); await sleep(700); await s.page.evaluate(() => window.__game.setSpeed(4));
      await s.page.evaluate(() => {
        window.__lat = []; const cube = document.getElementById('cube');
        new MutationObserver(() => { const t = performance.now(); requestAnimationFrame(f => window.__lat.push(['dice', t, performance.now()])); }).observe(cube, { attributes: true, attributeFilter: ['style'] });
        let was = false; const loop = () => { const b = window.__game.state().busy; if (b && !was) window.__lat.push(['busy', performance.now()]); was = b; requestAnimationFrame(loop); }; requestAnimationFrame(loop);
      });
      const res = { dice: [], plane: [] };
      const d = await box(s, '#diceBtn');
      for (let n = 0; n < 40 && (res.dice.length < 10 || res.plane.length < 10); n++) {
        for (let k = 0; k < 400; k++) { const g = await gs(s.page); if (g.human && !g.busy && (g.ui === 'await-roll' || (g.ui === 'choose' && g.legal >= 1 && !g.chooser))) break; await sleep(60); }
        const g = await gs(s.page);
        await s.page.evaluate(() => { window.__lat.length = 0; window.__ptr.length = 0; });
        if (g.ui === 'await-roll') { await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2, 40); await sleep(250); const v = await s.page.evaluate(() => { const up = window.__ptr.find(p => p[0] === 'pointerup'), l = window.__lat.find(x => x[0] === 'dice'); return up && l ? [l[2] - up[1], l[1] - up[1]] : null; }); if (v) res.dice.push(v); }
        else { const L = AP.legal(g.st, 0, g.st.d), m = L.find(x => !L.some(o => o !== x && o.from === x.from)); if (!m) { await tapSel(s, '#bHint'); await sleep(50); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]); await touch(s.cdp, x, y); await sleep(300); if ((await gs(s.page)).chooser) await tapSel(s, '#chOne'); continue; }
          const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, m.pl[0]]); await touch(s.cdp, x, y, 40); await sleep(250);
          const v = await s.page.evaluate(() => { const up = window.__ptr.find(p => p[0] === 'pointerup'), l = window.__lat.find(x => x[0] === 'busy'); return up && l ? l[1] - up[1] : null; }); if (v != null) res.plane.push(v); }
      }
      const fr = await s.page.evaluate(() => { const f = window.__fr.slice(-600), dt = []; for (let i = 1; i < f.length; i++) dt.push(f[i][0] - f[i - 1][0]); return dt.sort((a, b) => a - b)[Math.floor(dt.length / 2)]; });
      res.medianFrameMs = fr; res.errors = s.errors; R.latency = res; save(); await s.ctx.close(); console.log('latency', JSON.stringify(res));
    }
    if (want('targets')) {
      const out = {};
      for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 640 }, { width: 375, height: 500 }]) {
        const s = await open(browser, vp); await sleep(800);
        const menu = await s.page.$$eval('#menu button', bs => bs.filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.id || b.className || b.textContent.trim().slice(0, 6), Math.round(r.width), Math.round(r.height)]; }));
        await startGame(s); await sleep(700);
        const bar = await s.page.$$eval('#bar button, #diceBtn', bs => bs.map(b => { const r = b.getBoundingClientRect(); return [b.id, Math.round(r.width), Math.round(r.height)]; }));
        const u = await s.page.evaluate(() => { const a = window.__game.planeXY(0, 0), b = window.__game.planeXY(0, 1); return { hangarSpacing: Math.round(Math.hypot(a[0] - b[0], a[1] - b[1])), cell: Math.round(document.getElementById('boardBox').getBoundingClientRect().height / 15 * 10) / 10 }; });
        out[vp.width + 'x' + vp.height] = { menuSmall: menu.filter(m => m[1] < 44 || m[2] < 44), menuCount: menu.length, bar, boardCellPx: u.cell, planeHitDiameterPx: Math.round(u.cell * 1.5), hangarSpacing: u.hangarSpacing, errors: s.errors };
        if (vp.height === 500) await s.page.screenshot({ path: path.join(OUT, '375x500-light-lobby-play.png') });
        await s.ctx.close();
      }
      R.targets = out; save(); console.log('targets', JSON.stringify(out));
    }
    if (want('layout')) {
      const out = {};
      const shots = [['360x640', 360, 640, 'light', 'menu'], ['360x640', 360, 640, 'dark', 'play'], ['390x844', 390, 844, 'light', 'play'], ['430x932', 430, 932, 'dark', 'play'], ['844x390', 844, 390, 'light', 'play'], ['844x390', 844, 390, 'dark', 'menu']];
      for (const [n, w, h, scheme, what] of shots) {
        const s = await open(browser, { width: w, height: h }, { scheme }); await sleep(900);
        const rec = { navMs: s.navMs };
        if (what === 'play') {
          await startGame(s); await sleep(700); await s.page.evaluate(() => window.__game.setSpeed(4));
          // play a few human turns so planes are out
          const d = await box(s, '#diceBtn');
          for (let k = 0; k < 900; k++) { const g = await gs(s.page); if (g.st.turnNo > 40 && g.human && g.ui === 'choose' && !g.busy) break; if (g.human && !g.busy && g.ui === 'await-roll') await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); else if (g.human && !g.busy && g.ui === 'choose') { if (g.chooser) await tapSel(s, '#chOne'); else { const L = AP.legal(g.st, 0, g.st.d); const m = L[AP.think(g.st, 3, 0, k).i]; const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, m.pl[0]]); await touch(s.cdp, x, y); } } await sleep(90); }
        }
        await sleep(300);
        rec.checks = await s.page.evaluate(() => {
          const W = innerWidth, H = innerHeight, o = { overflowX: document.documentElement.scrollWidth - W, overflowY: document.documentElement.scrollHeight - H };
          const vis = [...document.querySelectorAll('button, .pc, #status, #rollTip')].filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed').filter(e => !e.closest('[hidden]'));
          o.offscreen = vis.map(e => [e.id || e.className || e.textContent.slice(0, 8), e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && (r.left < -1 || r.right > W + 1 || r.top < -1 || r.bottom > H + 1) && !document.getElementById('menu').contains(document.activeElement)).map(([n, r]) => n + ' ' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom));
          const st = document.getElementById('status'); o.statusClip = st.scrollHeight - st.clientHeight;
          o.ellipsis = [...document.querySelectorAll('.pc .nm, .pc .sub, .step span')].filter(e => e.offsetParent && e.scrollWidth > e.clientWidth + 1).map(e => e.textContent);
          const bb = document.getElementById('boardBox').getBoundingClientRect(); o.board = [Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height)];
          const els = [...document.querySelectorAll('#app > .row, #dz, #bar')].map(e => e.getBoundingClientRect());
          o.overlapWithBoard = els.filter(r => !(r.bottom <= bb.top + 1 || r.top >= bb.bottom - 1 || r.right <= bb.left + 1 || r.left >= bb.right - 1)).length;
          o.land = document.body.classList.contains('land');
          return o;
        });
        rec.errors = s.errors;
        await s.page.screenshot({ path: path.join(OUT, `${n}-${scheme}-${what}.png`) });
        out[`${n}-${scheme}-${what}`] = rec; await s.ctx.close();
      }
      R.layout = out; save(); console.log('layout', JSON.stringify(out));
    }
    if (want('rotate')) {
      const s = await open(browser, { width: 390, height: 844 }); await sleep(800);
      await startGame(s); await sleep(700);
      const meas = () => s.page.evaluate(() => { const bb = document.getElementById('boardBox').getBoundingClientRect(), d = document.getElementById('diceBtn').getBoundingClientRect(); return { W: innerWidth, H: innerHeight, board: [Math.round(bb.left), Math.round(bb.top), Math.round(bb.width), Math.round(bb.height)], dice: [Math.round(d.left), Math.round(d.top)], land: document.body.classList.contains('land'), ox: document.documentElement.scrollWidth - innerWidth, plane: window.__game.planeXY(0, 0).map(Math.round), cv: [document.getElementById('cv').width, document.getElementById('cv').height] }; });
      const seq = [await meas()];
      for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }, { width: 360, height: 640 }, { width: 430, height: 932 }]) { await s.page.setViewportSize(vp); await sleep(500); seq.push(await meas()); if (vp.width === 844) await s.page.screenshot({ path: path.join(OUT, 'rotate-844x390.png') }); }
      // a tap on the dice after rotation still rolls
      const d = await box(s, '#diceBtn'); const k0 = (await gs(s.page)).st.k; await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(300);
      R.rotate = { seq, rollAfterRotate: (await gs(s.page)).st.k - k0, errors: s.errors }; save(); await s.ctx.close(); console.log('rotate', JSON.stringify(R.rotate));
    }
    if (want('perf')) {
      const out = {};
      // first load
      const loads = [];
      for (let n = 0; n < 3; n++) { const s = await open(browser, { width: 390, height: 844 }); const t = await s.page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), firstFrame: window.__fr.length ? Math.round(window.__fr[0][0]) : null }; }); t.nav = s.navMs; loads.push(t); await s.ctx.close(); }
      out.loads = loads;
      // busiest: 4 computers (no human) at 1x, dark mode (runway lights), 30 s
      for (const [label, scheme, speed] of [['allCpu-1x-dark', 'dark', 1], ['allCpu-4x-light', 'light', 4]]) {
        const s = await open(browser, { width: 390, height: 844 }, { scheme }); await sleep(800);
        await openAdv(s); await tapSel(s, '.seat:nth-child(1) [data-t="c"]'); await sleep(200); await startGame(s); await sleep(500);
        await s.page.evaluate(v => window.__game.setSpeed(v), speed);
        await s.page.evaluate(() => { window.__fr.length = 0; window.__lt.length = 0; });
        const k0 = (await gs(s.page)).st.k; await sleep(30000);
        const r = await s.page.evaluate(() => { const f = window.__fr, dt = []; for (let i = 1; i < f.length; i++) dt.push(f[i][0] - f[i - 1][0]); const sc = f.map(x => x[1]).sort((a, b) => a - b), d2 = dt.slice().sort((a, b) => a - b); const span = (f[f.length - 1][0] - f[0][0]) / 1000; return { frames: f.length, fps: +(f.length / span).toFixed(1), dtMedian: +d2[Math.floor(d2.length / 2)].toFixed(1), dtP95: +d2[Math.floor(d2.length * .95)].toFixed(1), over33ms: dt.filter(x => x > 33.4).length, scriptMedian: +sc[Math.floor(sc.length / 2)].toFixed(2), scriptP95: +sc[Math.floor(sc.length * .95)].toFixed(2), scriptMax: +sc[sc.length - 1].toFixed(1), longtasks: window.__lt.length }; });
        r.rolls = (await gs(s.page)).st.k - k0; r.errors = s.errors; out[label] = r; await s.ctx.close();
      }
      out.external = external.slice(); R.perf = out; save(); console.log('perf', JSON.stringify(out));
    }
    if (want('misc')) {
      const rec = {};
      const s = await open(browser, { width: 390, height: 844 }); await sleep(800);
      // boot: 回到棋盤 on first visit
      rec.bootStartBtn = await s.page.$eval('#mStart', b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight]; }); rec.bootCloseVisible = await s.page.isVisible('#mClose');
      if (rec.bootCloseVisible) { await tapSel(s, '#mClose'); await sleep(300); const d = await box(s, '#diceBtn'); const g0 = await gs(s.page); await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(700); const g1 = await gs(s.page); rec.bootClose = { ui: g1.ui, rolled: g1.st.k - g0.st.k, status: await s.page.textContent('#status') }; await s.page.screenshot({ path: path.join(OUT, '390x844-light-boot-close.png') }); }
      await tapSel(s, '#bMenu'); await sleep(300); await startGame(s); await sleep(700);
      rec.statusFirst = await s.page.textContent('#status'); rec.rollTipFirst = await s.page.textContent('#rollTip');
      // menu opened mid-game during computer turns: does the game keep running underneath?
      const d = await box(s, '#diceBtn');
      for (let k = 0; k < 200; k++) { const g = await gs(s.page); if (!g.human) break; if (g.ui === 'await-roll' && !g.busy) await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); else if (g.ui === 'choose' && !g.busy) { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]); await touch(s.cdp, x, y); await sleep(200); if ((await gs(s.page)).chooser) await tapSel(s, '#chOne'); } await sleep(100); }
      const k0 = (await gs(s.page)).st.k; await tapSel(s, '#bMenu'); await sleep(3000); rec.menuOpenRollsUnderneath = (await gs(s.page)).st.k - k0; await tapSel(s, '#mClose'); await sleep(300);
      // undo reveals future dice: roll, note die, undo, roll again
      for (let k = 0; k < 300; k++) { const g = await gs(s.page); if (g.human && !g.busy && g.ui === 'await-roll' && g.st.turnNo > 8) break; if (g.human && !g.busy && g.ui === 'choose') { if (g.chooser) await tapSel(s, '#chOne'); else { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]); await touch(s.cdp, x, y); } } else if (g.human && !g.busy && g.ui === 'await-roll') await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(100); }
      const seen = []; const g0 = await gs(s.page); const turn0 = g0.st.turnNo;
      await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(1200); seen.push((await gs(s.page)).st.d);
      // play on until the human's next roll, recording all dice
      for (let k = 0; k < 400; k++) { const g = await gs(s.page); if (g.human && !g.busy && g.ui === 'await-roll' && g.st.turnNo > turn0) break; if (g.human && !g.busy && g.ui === 'choose') { if (g.chooser) await tapSel(s, '#chOne'); else { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[L.length - 1].pl[0]]); await touch(s.cdp, x, y); } } await sleep(80); }
      const kA = (await gs(s.page)).st.k; rec.undoEnabled = !(await s.page.$eval('#bUndo', b => b.disabled));
      await tapSel(s, '#bUndo'); await sleep(500); const gU = await gs(s.page); rec.undoBackTo = { turnNo: gU.st.turnNo, k: gU.st.k, wasK: g0.st.k };
      await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); await sleep(1200); rec.undoSameDie = (await gs(s.page)).st.d === seen[0];
      rec.futureDiceKnown = 'die index ' + g0.st.k + '..' + kA + ' are fixed: ' + Array.from({ length: kA - g0.st.k }, (_, i) => AP.die(g0.st.seed, g0.st.k + i)).join('');
      // hint
      for (let k = 0; k < 300; k++) { const g = await gs(s.page); if (g.human && !g.busy && g.ui === 'choose' && g.legal > 1) break; if (g.human && !g.busy && g.ui === 'await-roll') await touch(s.cdp, d.x + d.width / 2, d.y + d.height / 2); else if (g.human && !g.busy && g.ui === 'choose') { const L = AP.legal(g.st, 0, g.st.d); const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]); await touch(s.cdp, x, y); } await sleep(80); }
      await tapSel(s, '#bHint'); await sleep(300); rec.hintToast = await s.page.textContent('#toast');
      await s.page.screenshot({ path: path.join(OUT, '390x844-light-hint.png') });
      // long-press preview
      rec.hintUi = (await gs(s.page)).ui; const g = await gs(s.page); const L = g.ui === 'choose' ? AP.legal(g.st, 0, g.st.d) : []; if (L.length) { const [x, y] = await s.page.evaluate(([c, i]) => window.__game.planeXY(c, i), [0, L[0].pl[0]]);
      const id = tid++; await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }); await sleep(700);
      await s.page.screenshot({ path: path.join(OUT, '390x844-light-longpress.png') });
      await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(300);
      rec.afterLongPressUi = (await gs(s.page)).ui; }
      rec.errors = s.errors; R.misc = rec; save(); await s.ctx.close(); console.log('misc', JSON.stringify(rec));
    }
  } finally { await browser.close(); R.external = external; save(); }
})();
