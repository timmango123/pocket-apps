// Regression tests for 高壓洗淨 (pressure-washer): one check per release-review toFix item (2026-11-08), in mobile
// Chromium with real CDP touch. Usage: node tests.js
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const SKELETON = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>';
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { fail++; console.log('  FAIL', name, '-', e.message.split('\n')[0]); } }
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// superhuman tier-bot times (qa/skill-tiers bot, 30 fps lock-step, aim through __pw.fingerFor) used to calibrate est
const SUPER = { 1: 58.4, 2: 17.4, 3: 20.2, 4: 18.8, 5: 62, 8: 22.8, 10: 64.9, 14: 30.2, 18: 28.8, 20: 73.8, 25: 76.6, 28: 26.7, 35: 87.5, 38: 29.8, 42: 57.2,
  47: 39.4, 50: 106, 57: 57.4, 63: 52.4, 66: 129.7, 69: 53.2, 76: 84, 82: 96.6, 88: 46.7, 94: 49.1, 97: 86.9, 99: 70.1, 100: 190.7 };
const CLUMSY_L100 = 287.3; // clumsy bot clear time on L100 (2026-11-14): must not reach 3 stars

(async () => {
  const browser = await chromium.launch();
  const errors = [], external = [];
  async function open(w = 390, h = 844, init) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.route('**/*', r => { const u = r.request().url(); if (u.startsWith('http://pw.test/')) return r.fulfill({ body: SKELETON + fs.readFileSync(APP, 'utf8'), contentType: 'text/html' }); external.push(u); r.abort(); });
    await ctx.addInitScript(`try{localStorage.setItem('pw_muted','true');${init || ''}}catch(e){}`);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://pw.test/');
    await page.waitForFunction(() => window.__pw && document.getElementById('contBtn').getBoundingClientRect().height > 40, null, { timeout: 30000 });
    const cdp = await ctx.newCDPSession(page);
    const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const ev = (f, a) => page.evaluate(f, a);
    const until = (f, a, ms) => page.waitForFunction(f, a, { timeout: ms || 20000, polling: 30 });
    const ctr = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
    const tap = async (sel, hold = 50) => { const c = await ctr(sel); await T('touchStart', [{ ...c, id: 9 }]); await sleep(hold); await T('touchEnd', [{ ...c, id: 9 }]); await sleep(60); };
    const state = () => ev(() => window.__pw.state);
    const fires = () => ev(() => Object.assign({}, window.__pw.fires));
    const kclick = sel => ev(s => document.querySelector(s).click(), sel); // detail 0 = keyboard-style activation
    const play = async lv => { await ev(() => { if (!document.getElementById('done').hidden) document.getElementById('toMenuBtn').click(); else if (window.__pw.state !== 'menu') document.getElementById('menuBtn').click(); });
      await ev(() => { localStorage.removeItem('pw_resume'); }); if (lv) { await ev(() => { if (document.getElementById('unlockAll').getAttribute('aria-checked') !== 'true') document.getElementById('unlockAll').click(); }); await kclick('#lv' + lv); } else await kclick('#contBtn');
      await until(() => window.__pw.state === 'play'); };
    return { ctx, page, T, ev, until, ctr, tap, state, fires, kclick, play };
  }

  const P = await open();
  console.log('2 操控：第二指與觸控規則');
  await t('second finger: nozzles / mute / menu fire exactly once at 60, 600, 1000 ms while the first finger sprays or rests on the tool bar', async () => {
    await P.play(1);
    const st = await P.ev(() => window.__pw.stage());
    const bad = [];
    for (const hold of [60, 600, 1000]) for (const restOn of ['canvas', 'toolbar']) for (const sel of ['#nozJet', '#nozWide', '#muteBtn', '#menuBtn']) {
      if ((await P.state()) !== 'play') { await P.kclick('#contBtn'); await P.until(() => window.__pw.state === 'play'); }
      const rest = restOn === 'canvas' ? { x: Math.round(st.x + 360 * st.s), y: Math.round(st.y + 450 * st.s), id: 0 } : { x: 195, y: 832, id: 0 };
      const c = await P.ctr(sel), f0 = await P.fires(), a = await P.ev(() => ({ noz: __pw.nozzle, muted: localStorage.getItem('pw_muted'), water: __pw.dbg().water }));
      await P.T('touchStart', [rest]); await sleep(120);
      await P.T('touchStart', [rest, { ...c, id: 1 }]); await sleep(hold); await P.T('touchEnd', [{ ...c, id: 1 }]); await sleep(120);
      const m = await P.ev(() => ({ noz: __pw.nozzle, muted: localStorage.getItem('pw_muted'), menu: !document.getElementById('menu').hidden, water: __pw.dbg().water }));
      await P.T('touchEnd', [rest]); await sleep(60);
      const f1 = await P.fires(), id = sel.slice(1), n = (f1[id] || 0) - (f0[id] || 0);
      const want = sel === '#nozJet' ? m.noz === 1 : sel === '#nozWide' ? m.noz === 0 : sel === '#muteBtn' ? m.muted !== a.muted : m.menu;
      if (n !== 1 || !want) bad.push(`${hold}/${restOn}/${sel}: fired ${n}`);
      if (restOn === 'canvas' && !(m.water > a.water)) bad.push(`${hold}/${sel}: first finger was not spraying`);
      if (sel === '#muteBtn' && m.muted === 'false') { await P.kclick('#muteBtn'); }
    }
    ok(!bad.length, bad.join('; '));
  });
  await t('8/s two-finger alternation (jet / wide) while spraying: 16 sent, 16 received, ends on the right nozzle', async () => {
    if ((await P.state()) !== 'play') await P.play(1);
    const st = await P.ev(() => window.__pw.stage()), rest = { x: Math.round(st.x + 100), y: Math.round(st.y + 200), id: 0 };
    const j = await P.ctr('#nozJet'), w = await P.ctr('#nozWide'), f0 = await P.fires();
    await P.T('touchStart', [rest]); const t0 = Date.now();
    for (let k = 0; k < 16; k++) { const c = k % 2 ? w : j; await P.T('touchStart', [rest, { ...c, id: 1 }]); await sleep(40); await P.T('touchEnd', [{ ...c, id: 1 }]); await sleep(Math.max(0, 125 * (k + 1) - (Date.now() - t0))); }
    await P.T('touchEnd', [rest]); await sleep(100);
    const f1 = await P.fires(), n = (f1.nozJet - (f0.nozJet || 0)) + (f1.nozWide - (f0.nozWide || 0));
    ok(n === 16, `received ${n}`); ok((await P.ev(() => __pw.nozzle)) === 0, 'last tap was wide');
  });
  await t('menu and result buttons: single, 0.6 s, 1 s, and with another finger down -> exactly one fire each', async () => {
    const bad = [];
    const cases = [
      ['#contBtn', async () => { await P.play(1); await P.kclick('#menuBtn'); }, () => __pw.state === 'play'],
      ['#unlockAll', async () => { await P.ev(() => { if (window.__pw.state === 'play') document.getElementById('menuBtn').click(); }); }, null],
      ['#lv2', async () => { await P.ev(() => { if (window.__pw.state === 'play') document.getElementById('menuBtn').click(); if (document.getElementById('unlockAll').getAttribute('aria-checked') !== 'true') document.getElementById('unlockAll').click(); document.getElementById('lv2').scrollIntoView({ block: 'center' }); }); }, () => __pw.state === 'play' && __pw.lvl === 1],
      ['#retryBtn', async () => { await P.play(4); await P.ev(() => __pw.warp(999)); await P.until(() => __pw.state === 'fail'); }, () => __pw.state === 'play' && __pw.lvl === 3],
      ['#nextBtn', async () => { await P.play(2); await P.ev(() => __pw.washTo(1)); await P.until(() => __pw.state === 'done', null, 8000); }, () => __pw.state === 'play' && __pw.lvl === 2],
      ['#toMenuBtn', async () => { await P.play(2); await P.ev(() => __pw.washTo(1)); await P.until(() => __pw.state === 'done', null, 8000); }, () => __pw.state === 'menu'],
    ];
    for (const [sel, setup, expect] of cases) for (const [way, hold, other] of [['single', 50], ['hold600', 600], ['hold1000', 1000], ['otherFinger', 60, true]]) {
      await setup();
      const c = await P.ctr(sel), id = sel.slice(1), f0 = (await P.fires())[id] || 0, edge = { x: 4, y: 300, id: 2 };
      if (other) { await P.T('touchStart', [edge]); await sleep(80); }
      await P.T('touchStart', [...(other ? [edge] : []), { ...c, id: 7 }]); await sleep(hold); await P.T('touchEnd', [{ ...c, id: 7 }]); await sleep(120);
      if (other) { await P.T('touchEnd', [edge]); await sleep(40); }
      const n = ((await P.fires())[id] || 0) - f0;
      if (n !== 1) bad.push(`${sel} ${way}: fired ${n}`);
      else if (expect && !(await P.ev(expect))) bad.push(`${sel} ${way}: wrong result (${await P.state()})`);
    }
    ok(!bad.length, bad.join('; '));
  });
  await t('a finger spraying when the level ends does not fire 下一關 when lifted over it; a tap on 下一關 does not start spraying', async () => {
    await P.play(2);
    const st = await P.ev(() => window.__pw.stage()), f = { x: Math.round(st.x + 360 * st.s), y: Math.round(st.y + 400 * st.s), id: 3 };
    await P.T('touchStart', [f]); await P.ev(() => __pw.washTo(1)); await P.until(() => __pw.state === 'done', null, 8000); await sleep(200);
    const nb = await P.ctr('#nextBtn'), f0 = (await P.fires()).nextBtn || 0;
    await P.T('touchMove', [{ ...nb, id: 3 }]); await P.T('touchEnd', [{ ...nb, id: 3 }]); await sleep(150);
    ok(((await P.fires()).nextBtn || 0) === f0 && (await P.state()) === 'done', 'carried-over finger fired 下一關');
    await P.tap('#nextBtn'); await P.until(() => __pw.state === 'play');
    await sleep(200); ok((await P.ev(() => __pw.dbg().elapsed)) === 0, 'the tap that started the level also started the spray');
  });
  await t('pointer clicks are swallowed; keyboard activation still works', async () => {
    await P.play(1);
    const f0 = (await P.fires()).nozJet || 0;
    await P.ev(() => document.getElementById('nozJet').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })));
    ok(((await P.fires()).nozJet || 0) === f0, 'detail>0 click fired');
    await P.ev(() => document.getElementById('nozJet').focus()); await P.page.keyboard.press('Enter');
    ok((await P.ev(() => __pw.nozzle)) === 1, 'Enter on 集中噴嘴'); await P.page.keyboard.press('1');
    ok((await P.ev(() => __pw.nozzle)) === 0, 'key 1');
  });

  console.log('8 效能：對外請求');
  await t('no external requests (fonts are system stacks)', async () => {
    ok(!/fonts\.(googleapis|gstatic)\.com|<link[^>]+https?:/i.test(html), 'font link still in the file');
    ok(!external.length, 'requests: ' + external.slice(0, 3).join(', '));
  });

  console.log('5 / 4 提示與回饋');
  await t('wide fan on thick dirt for 1.5 s: toast + 集中噴嘴 flashes, once per level', async () => {
    await P.play(99);
    const pts = await P.ev(() => { const g = __pw.dbg().grid, out = []; for (let y = 30; y < 70; y += 2) for (let x = 25; x < 50; x += 2) if (g[y * 72 + x] === '2') out.push(__pw.fingerFor(x * 10 + 5, y * 10 + 5)); return out; });
    ok(pts.length > 20, 'no mud on L99?');
    await P.T('touchStart', [{ x: Math.round(pts[0].x), y: Math.round(pts[0].y), id: 4 }]);
    for (let k = 0; k < 60 && !(await P.ev(() => __pw.wideMudShown)); k++) { const p = pts[k % pts.length]; await P.T('touchMove', [{ x: Math.round(p.x), y: Math.round(p.y), id: 4 }]); await sleep(60); }
    await P.T('touchEnd', [{ x: Math.round(pts[0].x), y: Math.round(pts[0].y), id: 4 }]);
    ok(await P.ev(() => __pw.wideMudShown), 'hint not shown');
    ok(await P.ev(() => document.getElementById('nozJet').classList.contains('flash') && /集中噴嘴/.test(document.getElementById('toast').textContent)), 'no flash / toast');
  });
  await t('at 90%+ the remaining dirt pulses; the failed card says how far short and shows where', async () => {
    await P.play(4);
    await P.ev(() => __pw.washTo(0.905)); await P.until(() => __pw.pct >= 0.9 && __pw.pulseT > 0.3, null, 5000);
    await P.ev(() => __pw.warp(999)); await P.until(() => __pw.state === 'fail');
    const r = await P.ev(() => ({ sub: document.getElementById('doneSub').textContent, map: !document.getElementById('failMap').hidden, stars: document.getElementById('stars').hidden }));
    ok(/差 \d+\.\d%/.test(r.sub), r.sub); ok(r.map && r.stars, 'map shown, stars hidden');
    const yellow = await P.ev(() => { const d = document.getElementById('failMap').getContext('2d').getImageData(0, 0, 240, 300).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 240 && d[i + 1] > 190 && d[i + 2] < 60) n++; return n; });
    ok(yellow > 100, 'no dirt marked on the map: ' + yellow);
  });

  console.log('4 樂趣：新元素');
  await t('new objects at L28 / L47 / L76, quick-wash rings from L11 (two from L61), announced once', async () => {
    const r = await P.ev(() => ({ o: [27, 46, 75, 37].map(i => __pw.objOf(i)), n: [10, 27, 46, 60, 75, 5].map(i => __pw.news(i)) }));
    ok(r.o[0] === '消防栓' && r.o[1] === '溜滑梯' && r.o[2] === '店招牌' && r.o[3] === '消防栓', r.o.join());
    ok(r.n.slice(0, 5).every(Boolean) && !r.n[5], JSON.stringify(r.n));
    await P.play(10); ok((await P.ev(() => __pw.rings().length)) === 0, 'L10 ring');
    await P.play(61); ok((await P.ev(() => __pw.rings().length)) === 2, 'L61 rings');
    await P.play(11); ok((await P.ev(() => __pw.rings().length)) === 1, 'L11 ring');
    await P.ev(() => { __pw.warp(0); __pw.washTo(1); }); await P.until(() => __pw.state === 'done', null, 8000);
    const m = await P.ev(() => ({ line: document.getElementById('medalLine').textContent, saved: JSON.parse(localStorage.getItem('pw_prog2'))[10].medal }));
    ok(/拿到了/.test(m.line) && m.saved === true, JSON.stringify(m));
  });

  console.log('3 難度');
  const info = await P.ev(() => { const o = []; for (let i = 0; i < 100; i++) o.push(__pw.info(i)); return o; });
  await t('3-star target leaves the superhuman bot >= 20% headroom (mean >= 25%), limits never undercut it, clumsy stays below 3 stars on L100', async () => {
    const bad = []; let sum = 0, n = 0;
    for (const [lv, s] of Object.entries(SUPER)) { const I = info[lv - 1]; sum += 1 - s / I.par; n++; if (s > 0.8 * I.par) bad.push(`L${lv} par ${I.par} vs ${s}`); if (I.limit && I.budget < s * 1.2) bad.push(`L${lv} limit ${I.budget} vs ${s}`); if (lv > 10 && I.par > s * 2.1) bad.push(`L${lv} par ${I.par} too loose for ${s}`); }
    ok(sum / n >= 0.25, 'mean headroom ' + (sum / n).toFixed(2));
    ok(info[99].par < CLUMSY_L100, 'L100 par ' + info[99].par);
    ok(!bad.length, bad.join('; '));
  });
  await t('targets and limit budgets change smoothly level to level (no L99 -> L100 wall)', async () => {
    const bad = [];
    for (let i = 1; i < 100; i++) {
      const a = info[i - 1], b = info[i];
      if (b.target < a.target - 0.05 || b.target - a.target > 0.3) bad.push(`target L${i}->L${i + 1} ${a.target}->${b.target}`);
      if (i >= 4 && a.limit && b.limit) { const ra = a.budget / a.est, rb = b.budget / b.est; if (Math.abs(rb / (a.limit === b.limit ? ra : ra * (b.limit === 'water' ? 0.96 : 1 / 0.96)) - 1) > 0.05) bad.push(`budget L${i}->L${i + 1} ${ra.toFixed(2)}->${rb.toFixed(2)}`); }
    }
    ok(!bad.length, bad.slice(0, 4).join('; '));
  });

  console.log('1 穩定：中途保存');
  await t('mid-level progress survives a reload and resumes from the menu; the resumed clock waits for the first touch', async () => {
    const Q = await open(390, 844, "localStorage.setItem('pw_prog2', JSON.stringify({0:{stars:3,time:20}}));");
    ok(/已完成 1 \//.test(await Q.ev(() => document.getElementById('menuStats').textContent)), 'old progress key not loaded');
    await Q.play(2);
    const st = await Q.ev(() => __pw.stage()), f = { x: Math.round(st.x + 300 * st.s), y: Math.round(st.y + 300 * st.s), id: 1 };
    await Q.T('touchStart', [f]); await sleep(300); await Q.T('touchEnd', [f]);
    await Q.ev(() => { __pw.washTo(0.45); __pw.scribble(150); }); await sleep(300);
    const before = await Q.ev(() => ({ pct: __pw.pct, el: __pw.dbg().elapsed }));
    await Q.page.reload(); await Q.until(() => window.__pw && document.getElementById('contBtn').textContent.length > 0);
    const txt = await Q.ev(() => document.getElementById('contBtn').textContent);
    ok(/繼續未完成・第 2 關/.test(txt), txt);
    await Q.tap('#contBtn'); await Q.until(() => __pw.state === 'play' && __pw.pct > 0.3);
    const after = await Q.ev(() => ({ pct: __pw.pct, el: __pw.dbg().elapsed, lvl: __pw.lvl }));
    ok(after.lvl === 1 && Math.abs(after.pct - before.pct) < 0.03 && Math.abs(after.el - before.el) < 1.5, JSON.stringify({ before, after }));
    await sleep(500); ok((await Q.ev(() => __pw.dbg().elapsed)) === after.el && !(await Q.ev(() => __pw.started)), 'clock ran before the first touch');
    await Q.T('touchStart', [f]); await sleep(300); await Q.T('touchEnd', [f]);
    ok((await Q.ev(() => __pw.dbg().elapsed)) > after.el, 'clock did not start on touch');
    await Q.ctx.close();
  });
  await t('L100 save is compact (< 100 KB after heavy partial washing) and fast (< 16 ms)', async () => {
    const Q = await open(); await Q.play(100);
    const st = await Q.ev(() => __pw.stage());
    await Q.T('touchStart', [{ x: Math.round(st.x + 20), y: Math.round(st.y + 60), id: 1 }]);
    for (let k = 0; k < 60; k++) { await Q.T('touchMove', [{ x: Math.round(st.x + (k % 2 ? 350 : 20)), y: Math.round(st.y + 60 + k * 6), id: 1 }]); await sleep(40); }
    await Q.T('touchEnd', [{ x: 20, y: 400, id: 1 }]);
    await Q.ev(() => __pw.scribble(600));
    const times = []; for (let k = 0; k < 5; k++) times.push(await Q.ev(() => __pw.save()));
    times.sort((a, b) => a - b);
    const size = await Q.ev(() => localStorage.getItem('pw_resume').length);
    ok(size < 100000, 'size ' + size); ok(times[2] < 16, 'median save ' + times[2].toFixed(1) + ' ms');
    await Q.ctx.close();
  });
  await t('a failing setItem (quota) neither throws nor touches the saved progress', async () => {
    const Q = await open(390, 844, "localStorage.setItem('pw_prog2', JSON.stringify({0:{stars:2,time:30}}));");
    await Q.play(1); await Q.ev(() => __pw.warp(1));
    await Q.ev(() => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === 'pw_resume') throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; });
    await Q.ev(() => __pw.save()); await Q.kclick('#menuBtn');
    const r = await Q.ev(() => ({ res: localStorage.getItem('pw_resume'), prog: localStorage.getItem('pw_prog2'), menu: !document.getElementById('menu').hidden }));
    ok(r.res === null && r.menu && JSON.parse(r.prog)[0].stars === 2, JSON.stringify(r));
    await Q.ctx.close();
  });
  await t('malformed stored values fall back to defaults (null / string / bad entries)', async () => {
    const bad = [];
    for (const [init, want] of [
      ["localStorage.setItem('pw_prog2','null');localStorage.setItem('pw_seen','null');localStorage.setItem('pw_muted','\"x\"');localStorage.setItem('pw_unlockAll','5');localStorage.setItem('pw_resume','{\"v\":2,\"lvl\":\"x\"}');", '已完成 0 / 100 關・星星 0 / 300'],
      ["localStorage.setItem('pw_prog2','\"abc\"');localStorage.setItem('pw_seen','[1]');localStorage.setItem('pw_resume','{\"v\":2,\"lvl\":1,\"elapsed\":5,\"water\":5,\"pct\":0.2,\"g\":\"!!\",\"m\":\"\"}');", '已完成 0 / 100 關・星星 0 / 300'],
      ["localStorage.setItem('pw_prog2','{\"0\":{\"stars\":\"x\"},\"1\":{\"stars\":2,\"time\":12},\"abc\":1,\"5\":null}');localStorage.setItem('pw_seen','\"s\"');", '已完成 1 / 100 關・星星 2 / 300'],
    ]) {
      const Q = await open(390, 844, init);
      const stats = await Q.ev(() => document.getElementById('menuStats').textContent);
      if (stats !== want) bad.push(stats);
      await Q.kclick('#contBtn'); await Q.until(() => __pw.state === 'play');
      await Q.play(11); // pw_seen read on entering a level with news
      if ((await Q.ev(() => __pw.lvl)) !== 10) bad.push('L11 did not start');
      await Q.ctx.close();
    }
    ok(!bad.length, bad.join('; '));
  });

  console.log('7 版面');
  await t('menu card top is reachable (scrollTop 0 -> card top >= 0) at 360x640, 375x500, 390x610, 844x390', async () => {
    const bad = [];
    for (const [w, h] of [[360, 640], [375, 500], [390, 610], [844, 390]]) {
      const Q = await open(w, h);
      const r = await Q.ev(() => { const m = document.getElementById('menu'), c = m.querySelector('.card'); m.scrollTop = 0; const top = c.getBoundingClientRect().top; m.scrollTop = 1e5; return { top, bottom: c.getBoundingClientRect().bottom, vh: innerHeight }; });
      if (r.top < 0 || r.bottom > r.vh + 1) bad.push(`${w}x${h} ${JSON.stringify(r)}`);
      await Q.ctx.close();
    }
    ok(!bad.length, bad.join('; '));
  });
  await t('landscape 844x390: side columns, stage uses the height (>= 290x360), nozzles >= 56 px; rotate back restores portrait', async () => {
    const Q = await open(844, 390); await Q.play(1);
    const r = await Q.ev(() => { const s = __pw.stage(), top = document.getElementById('top').getBoundingClientRect(), tools = document.getElementById('tools').getBoundingClientRect(), n = [...document.querySelectorAll('.noz')].map(b => b.getBoundingClientRect().height); return { w: 720 * s.s, h: 900 * s.s, x0: s.x, x1: s.x + 720 * s.s, topR: top.right, toolsL: tools.left, n, land: __pw.land }; });
    ok(r.land && r.w >= 290 && r.h >= 360, JSON.stringify(r)); ok(r.x0 >= r.topR - 1 && r.x1 <= r.toolsL + 1, 'stage under a column ' + JSON.stringify(r)); ok(r.n.every(h => h >= 56), 'nozzle ' + r.n);
    await Q.page.setViewportSize({ width: 390, height: 844 }); await sleep(250);
    const s2 = await Q.ev(() => ({ s: __pw.stage(), land: __pw.land }));
    ok(!s2.land && Math.abs(s2.s.s * 900 - 900 * 0.5139) < 8, JSON.stringify(s2));
    await Q.ctx.close();
  });
  await t('360x640: touching the stage bottom edge aims at the bottom (offset eases to 0); mid-stage keeps the 70 px offset; the lance shows above the tool bar', async () => {
    const Q = await open(360, 640); await Q.play(1);
    const st = await Q.ev(() => __pw.stage()), toolsTop = await Q.ev(() => document.getElementById('tools').getBoundingClientRect().top);
    const yb = Math.floor(st.y + 900 * st.s - 2); ok(yb < toolsTop - 8, 'stage bottom under tool bar');
    const x = Math.round(st.x + 360 * st.s);
    await Q.T('touchStart', [{ x, y: yb, id: 1 }]); await sleep(100); const a = await Q.ev(() => __pw.aimAt());
    await Q.T('touchEnd', [{ x, y: yb, id: 1 }]);
    ok(a.ty > 880, 'bottom aim ' + a.ty.toFixed(0));
    const ym = Math.round(st.y + 450 * st.s);
    await Q.T('touchStart', [{ x, y: ym, id: 1 }]); await sleep(100); const b = await Q.ev(() => __pw.aimAt()); const w = await Q.ev(() => __pw.wand()); await Q.T('touchEnd', [{ x, y: ym, id: 1 }]);
    ok(w && w.y < w.toolsTop - 60 && w.oy <= w.toolsTop, 'lance hidden under the tool bar: ' + JSON.stringify(w));
    ok(Math.abs((ym - 70 - st.y) / st.s - b.ty) < 2, 'mid aim ' + b.ty.toFixed(0));
    await Q.ctx.close();
  });

  console.log('6 視覺與細節');
  await t('owl level hedge is flat (low luminance spread) instead of dark/light blobs', async () => {
    await P.play(99);
    const sp = await P.ev(() => __pw.bgSpread(0, 0, 720, 200));
    ok(sp < 9, 'spread ' + sp.toFixed(1));
  });
  await t('touch phones: no keyboard hint; title shows level once (no 難度 N)', async () => {
    await P.play(5);
    const r = await P.ev(() => ({ kbd: getComputedStyle(document.querySelector('.kbd-only')).display, title: document.getElementById('lvNum').textContent }));
    ok(r.kbd === 'none', 'kbd hint ' + r.kbd); ok(!/難度/.test(r.title) && /^第 5 關/.test(r.title), r.title);
  });

  ok(true);
  console.log(errors.length ? '  FAIL page errors: ' + errors.slice(0, 3).join(' | ') : '  ok   no page / console errors');
  if (errors.length) fail++; else pass++;
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
