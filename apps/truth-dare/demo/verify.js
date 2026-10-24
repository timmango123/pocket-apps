// Verify 真心話大冒險 (truth-dare) in Chromium: `node verify.js`
// Layout at phone sizes (360×640, the three lobby iframes, 390×844, 430×932, 844×390 landscape, desktop), light and dark;
// the whole turn loop; skip limits; undo; persistence across reload; custom bank + import/export; family mode;
// rapid real touch taps via CDP; spin landing and frame rate; no network requests. Writes demo/cover-390x520.png.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path'), fs = require('fs'), os = require('os');
const SRC = path.resolve(__dirname, '../index.html');
const WRAP = path.join(os.tmpdir(), 'truth-dare-wrapped.html');
fs.writeFileSync(WRAP, '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>' + fs.readFileSync(SRC, 'utf8') + '</body></html>');
const URL = 'file://' + WRAP, OUT = __dirname;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const mk = async (opt = {}) => {
    const ctx = await browser.newContext({ viewport: opt.viewport || { width: 390, height: 844 }, isMobile: opt.mobile !== false, hasTouch: opt.mobile !== false, deviceScaleFactor: 2, colorScheme: opt.dark ? 'dark' : 'light', reducedMotion: opt.motion ? 'no-preference' : 'reduce' });
    const page = await ctx.newPage(), errors = [], requests = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { if (!/^(file|data|blob):/.test(r.url())) requests.push(r.url()); });
    await page.goto(URL); await page.waitForTimeout(150);
    // the app ignores taps for 350 ms after a new row of buttons appears (anti double-tap); scripted clicks wait it out
    const click0 = page.click.bind(page);
    page.click = async (sel, o) => { await page.waitForFunction(() => !window.__td || !window.__td.guarded, null, { timeout: 5000 }).catch(() => {}); return click0(sel, o); };
    return { ctx, page, errors, requests };
  };
  const G = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__td.G)));
  const checkLayout = async (page, label, noScroll) => {
    const r = await page.evaluate(() => {
      const W = innerWidth, H = innerHeight;
      const vis = e => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (x.hidden || s.display === 'none' || s.visibility === 'hidden' || +s.opacity < .05) return false; } return true; };
      const els = [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=file]), textarea, label.switch, canvas')].filter(vis);
      const small = els.filter(e => e.tagName !== 'CANVAS').map(e => { const b = e.getBoundingClientRect(); return { n: e.id || e.textContent.trim().slice(0, 8) || e.className, w: Math.round(b.width), h: Math.round(b.height) }; }).filter(b => b.w < 44 || b.h < 44);
      const out = els.map(e => { const b = e.getBoundingClientRect(); return { n: e.id || e.textContent.trim().slice(0, 8), l: b.left, r: b.right, b: b.bottom + scrollY }; }).filter(b => b.l < -1 || b.r > W + 1);
      // text clipped by ellipsis is allowed only on names; check headline isn't cut
      const docks = [...document.querySelectorAll('#docks .dock:not([hidden]) button')].filter(vis).map(e => e.getBoundingClientRect().bottom);
      return { sw: document.documentElement.scrollWidth, W, H, small, out, dockBottom: Math.max(0, ...docks) };
    });
    ok(r.sw <= r.W, `${label}: no horizontal scroll (${r.sw} <= ${r.W})`);
    ok(r.small.length === 0, `${label}: touch targets >= 44px ${JSON.stringify(r.small)}`);
    ok(r.out.length === 0, `${label}: nothing cut off at the sides ${JSON.stringify(r.out)}`);
    if (noScroll) ok(r.dockBottom <= r.H + 0.5, `${label}: game controls fit without scrolling (${Math.round(r.dockBottom)} <= ${r.H})`);
  };

  // ---------- sizes × themes × screens ----------
  const sizes = [[360, 640], [375, 500], [390, 610], [430, 740], [390, 844], [430, 932], [844, 390], [1280, 800, false]];
  for (const dark of [false, true]) for (const [w, h, mob] of sizes) {
    const label = `${w}x${h}${dark ? '-dark' : ''}`;
    const { ctx, page, errors, requests } = await mk({ viewport: { width: w, height: h }, dark, mobile: mob });
    await checkLayout(page, label + ' spin', true);
    await page.click('#spin-btn'); await page.waitForTimeout(700);
    await checkLayout(page, label + ' choose', true);
    if (w === 375 || w === 844 || w === 360) await page.screenshot({ path: `${OUT}/${label}-choose.png` });
    await page.click('#pick-T'); await page.waitForTimeout(300);
    await checkLayout(page, label + ' card', true);
    const fit = await page.evaluate(() => { const b = document.querySelector('.qbody'); const c = document.getElementById('qcard').getBoundingClientRect(); return { over: b.scrollHeight - b.clientHeight, h: c.height }; });
    ok(fit.over <= 1 && fit.h >= 150, `${label} card: question fits inside the card (overflow ${fit.over}, card ${Math.round(fit.h)}px)`);
    if (w === 375 || w === 844 || w === 360) await page.screenshot({ path: `${OUT}/${label}-card.png` });
    for (const v of ['players', 'bank', 'stats']) { await page.click('#tab-' + v); await page.waitForTimeout(80); await checkLayout(page, `${label} ${v}`); }
    if (w === 375) { await page.click('#tab-players'); await page.screenshot({ path: `${OUT}/${label}-players.png` }); await page.click('#tab-bank'); await page.screenshot({ path: `${OUT}/${label}-bank.png` }); }
    ok(errors.length === 0, `${label}: no console errors ${errors.join(' | ')}`);
    ok(requests.length === 0, `${label}: no network requests ${requests.join(' ')}`);
    await ctx.close();
  }

  // ---------- full turn loop, skip limit, undo, persistence ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    ok(await page.isVisible('#v-game') && (await page.textContent('#sub')).includes('6 位玩家'), 'first open: game ready with 6 sample players');
    await page.click('#tab-players'); ok(await page.isVisible('#sample-badge'), 'players: sample list marked 範例'); await page.click('#tab-game');
    await page.click('#spin-btn'); await page.waitForTimeout(600);
    let g = await G(page);
    ok(g.phase === 'choose' && g.cur && g.cur.pid, 'spin -> choose phase with a player');
    const who = (await page.textContent('#who-name')).trim(), names = await page.evaluate(() => window.__td.players.map(p => p.name));
    const idx = await page.evaluate(() => { const t = window.__td; return t.TD.indexAt(t.G.theta, t.players.length, t.S.style); });
    ok(names[idx] === who, `wheel stops under the pointer on the announced player (${who})`);
    await page.click('#pick-D'); await page.waitForTimeout(300);
    g = await G(page); const q1 = (await page.textContent('#q-text')).trim();
    ok(g.phase === 'card' && g.cur.t === 'D' && q1.length > 2 && (await page.textContent('#q-type')) === '大冒險', 'dare card shown: ' + q1);
    ok(!/\{某人\}/.test(q1), 'placeholder resolved to a player name');
    // reload mid-card: same card comes back
    await page.reload(); await page.waitForTimeout(200);
    ok((await page.textContent('#q-text')).trim() === q1 && await page.isVisible('#dock-card'), 'reload mid-turn restores the same card');
    // skip twice, third refused
    await page.click('#skip-btn'); await page.waitForTimeout(80); const q2 = (await page.textContent('#q-text')).trim();
    await page.click('#skip-btn'); await page.waitForTimeout(80); const q3 = (await page.textContent('#q-text')).trim();
    ok(q2 !== q1 && q3 !== q2 && q3 !== q1, 'skip draws new questions');
    ok((await page.textContent('#skip-left')).includes('剩 0'), 'skip counter shows 剩 0');
    await page.click('#skip-btn'); await page.waitForTimeout(80);
    ok((await page.textContent('#q-text')).trim() === q3 && (await page.textContent('#toast-msg')).includes('用完'), 'third skip refused with a message');
    await page.click('#done-btn'); await page.waitForTimeout(100);
    g = await G(page);
    ok(g.phase === 'spin' && g.round === 2 && g.log.filter(l => l.res === 'done').length === 1 && g.log.filter(l => l.res === 'skip').length === 2, 'done -> round 2, log has 1 done + 2 skips');
    const pid = g.log[g.log.length - 1].pid; ok(g.stats[pid].done === 1 && g.stats[pid].D === 1 && g.stats[pid].skip === 2 && g.stats[pid].picked === 1, 'per-player stats counted');
    // undo
    await page.click('#toast-btn'); await page.waitForTimeout(100);
    g = await G(page); ok(g.phase === 'card' && g.round === 1 && (await page.textContent('#q-text')).trim() === q3, 'undo puts the card back');
    await page.click('#quit-btn'); await page.waitForTimeout(80);
    g = await G(page); ok(g.stats[pid].quit === 1 && g.stats[pid].done === 0, 'quit counted after undo');
    // play several rounds in fair mode: 6 players each picked once in the first 6 spins
    const picked = [pid];
    for (let i = 0; i < 5; i++) { await page.click('#spin-btn'); await page.waitForTimeout(550); g = await G(page); picked.push(g.cur.pid); await page.click('#pick-R'); await page.waitForTimeout(80); await page.click('#done-btn'); await page.waitForTimeout(60); }
    ok(new Set(picked).size === 6, 'fair mode: 6 spins pick all 6 players');
    await page.click('#tab-stats'); await page.waitForTimeout(80);
    ok((await page.$$('.ps')).length === 6 && (await page.$$('#log li')).length === 8, 'stats: 6 player cards, 8 log rows');
    await page.screenshot({ path: `${OUT}/375x500-stats.png` });
    // rename + remove + undo, persisted
    await page.click('#tab-players');
    await page.fill('#plist li:nth-child(1) input', '小明明'); await page.press('#plist li:nth-child(1) input', 'Enter'); await page.waitForTimeout(50);
    await page.fill('#add-name', '阿華'); await page.click('#add-btn'); ok((await page.textContent('#add-err')).includes('已經有'), 'duplicate name explained');
    await page.fill('#add-name', '  '); await page.click('#add-btn'); ok((await page.textContent('#add-err')).includes('不能空白'), 'blank name explained');
    await page.fill('#add-name', '大雄、靜香'); await page.click('#add-btn'); await page.waitForTimeout(50);
    ok((await page.$$('#plist li')).length === 8 && !(await page.isVisible('#sample-badge')), 'two names added at once; sample badge gone');
    await page.click('#plist li:nth-child(8) .x'); await page.waitForTimeout(50); ok((await page.$$('#plist li')).length === 7, 'remove a player');
    await page.click('#toast-btn'); await page.waitForTimeout(50); ok((await page.$$('#plist li')).length === 8, 'undo remove');
    await page.reload(); await page.waitForTimeout(150); await page.click('#tab-players');
    const names2 = await page.$$eval('#plist input', a => a.map(x => x.value));
    ok(names2.length === 8 && names2[0] === '小明明' && names2[7] === '靜香', 'players persist across reload');
    ok((await G(page)).log.length === 8, 'log persists across reload');
    // new game + undo
    await page.click('#newgame-btn'); await page.waitForTimeout(50); ok((await G(page)).log.length === 0, 'new game clears the log');
    await page.click('#toast-btn'); await page.waitForTimeout(50); ok((await G(page)).log.length === 8, 'undo new game');
    ok(errors.length === 0, `turn loop: no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---------- custom bank, builtin off, import 1000, export, family mode ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 610 } });
    await page.click('#tab-bank');
    await page.click('#new-q'); await page.waitForTimeout(50);
    await page.click('#m-save'); ok((await page.textContent('#m-err')).includes('太短'), 'empty custom question explained');
    await page.fill('#m-q', '你最近一次在捷運上睡過站是什麼時候？'); await page.click('#m-save'); await page.waitForTimeout(50);
    await page.click('#new-q'); await page.click('#m-type button[data-v="D"]'); await page.fill('#m-q', '跟 {某人} 比賽憋笑 10 秒。'); await page.click('#m-lv button[data-v="1"]'); await page.click('#m-save'); await page.waitForTimeout(50);
    await page.click('#new-q'); await page.fill('#m-q', '你手機裡最常打開的 App 是哪一個？'); await page.click('#m-save');
    ok((await page.textContent('#m-err')).includes('已經有'), 'duplicate of built-in refused'); await page.click('#m-cancel');
    await page.uncheck('#use-builtin'); await page.waitForTimeout(50);
    ok((await page.textContent('#c-all')).trim() === '2', 'builtin off: 2 drawable questions');
    await page.click('#tab-game'); await page.click('#spin-btn'); await page.waitForTimeout(600);
    await page.click('#pick-D'); await page.waitForTimeout(200);
    const dq = (await page.textContent('#q-text')).trim();
    ok(/^跟 .+ 比賽憋笑 10 秒。$/.test(dq) && await page.isVisible('#timer-btn'), 'custom dare drawn with a player name and a 10-second timer: ' + dq);
    await page.click('#timer-btn'); await page.waitForTimeout(1150);
    ok(/9 秒|8 秒/.test(await page.textContent('#timer-btn')), 'timer counts down: ' + (await page.textContent('#timer-btn')).trim());
    await page.click('#done-btn');
    await page.reload(); await page.waitForTimeout(150); await page.click('#tab-bank');
    ok((await page.textContent('#c-all')).trim() === '2' && !(await page.isChecked('#use-builtin')), 'custom bank and builtin switch persist');
    await page.check('#use-builtin');
    // import 1000 lines + broken lines
    const lines = Array.from({ length: 1000 }, (_, i) => (i % 2 ? '大冒險' : '真心話') + '｜' + ['輕鬆', '普通', '刺激'][i % 3] + '｜匯入測試第 ' + i + ' 題') .join('\n') + '\nx\n' + '長'.repeat(250);
    await page.click('#import-btn'); await page.waitForTimeout(50);
    const t0 = Date.now();
    // paste (Playwright's fill types slowly on mobile emulation, so set the value and fire input like a paste does)
    await page.evaluate(l => { const ta = document.getElementById('i-text'); ta.value = l; ta.dispatchEvent(new Event('input')); }, lines); await page.waitForTimeout(50);
    ok((await page.textContent('#i-prev')).includes('可匯入 1000 題') && (await page.textContent('#i-err')).includes('太短') && (await page.textContent('#i-err')).includes('太長'), 'import preview: 1000 ok + 2 problems explained');
    await page.click('#i-go'); await page.waitForTimeout(50);
    ok(Date.now() - t0 < 2500, 'import 1000 + render in ' + (Date.now() - t0) + 'ms');
    ok((await page.$$('#qlist li')).length === 60 && await page.isVisible('#more-btn'), 'long list renders in pages');
    const tq = Date.now(); await page.fill('#q-search', '第 999 題'); await page.waitForTimeout(250);
    ok((await page.$$('#qlist li')).length === 1, 'search finds one item in ' + (Date.now() - tq) + 'ms');
    await page.fill('#q-search', '');
    await page.waitForTimeout(200);
    // export
    await page.click('#export-btn'); await page.waitForTimeout(50);
    const exp = await page.inputValue('#e-text');
    ok(/1002 題|共 1002/.test(await page.textContent('#sheet')) || exp.split('\n').filter(l => l && l[0] !== '#').length === 1002, 'export lists all custom questions');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#e-json')]);
    const p = await dl.path(); const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    ok(data.app === 'truth-dare' && data.items.length === 1002 && /\.json$/.test(dl.suggestedFilename()), 'download JSON backup ' + dl.suggestedFilename() + ' items ' + data.items.length);
    await page.click('#e-close');
    // delete + undo custom
    await page.click('#f-src button[data-v="mine"]'); await page.waitForTimeout(50);
    const before = await page.evaluate(() => window.__td.custom.length);
    await page.click('#qlist li:first-child button[data-a="del"]'); await page.waitForTimeout(30);
    const mid = await page.evaluate(() => window.__td.custom.length);
    await page.click('#toast-btn'); await page.waitForTimeout(30);
    ok(mid === before - 1 && await page.evaluate(() => window.__td.custom.length) === before, 'delete custom question + undo');
    // broken file content via import box
    await page.click('#import-btn'); await page.fill('#i-text', '{"oops":'); await page.waitForTimeout(30);
    ok((await page.textContent('#i-err')).includes('JSON') && await page.isDisabled('#i-go'), 'broken JSON import explained and blocked'); await page.click('#i-cancel');
    // family mode: draw many truths, never a ♥ item, no repeats
    await page.evaluate(() => { localStorage.setItem('truth-dare:v1:custom', '[]'); });
    await page.reload(); await page.waitForTimeout(100);
    await page.click('#tab-players'); await page.check('#family'); await page.click('#skip-plus'); await page.click('#skip-plus'); await page.click('#skip-plus'); await page.click('#skip-plus');
    ok((await page.textContent('#skip-val')).trim() === '∞', 'skip limit can be unlimited');
    await page.click('#tab-game'); await page.click('#spin-btn'); await page.waitForTimeout(600); await page.click('#pick-T'); await page.waitForTimeout(100);
    const seen = new Set(); let hearts = 0;
    for (let i = 0; i < 120; i++) { seen.add((await page.textContent('#q-text')).trim()); if (await page.isVisible('#q-heart')) hearts++; await page.click('#skip-btn'); }
    const g = await G(page);
    const rom = await page.evaluate(ids => ids.filter(id => (window.__td.TD.BANK.find(b => b.id === id) || {}).r).length, g.used.T);
    ok(hearts === 0 && rom === 0, 'family mode: 120 truths, no ♥ question');
    ok(seen.size === 120, 'no repeated question within a session (120 draws, ' + seen.size + ' distinct)');
    ok(errors.length === 0, `bank flows: no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---------- real touch: rapid taps 8/s, flick spin, frame rate, load time ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 844 }, motion: true });
    const cdp = await ctx.newCDPSession(page);
    const tap = async sel => {
      const b = await page.$eval(sel, e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b[0], y: b[1] }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const nav = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fp = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint'); return { dcl: n.domContentLoadedEventEnd, fcp: fp ? fp.startTime : -1 }; });
    ok(nav.dcl < 1000 && nav.fcp < 1000, `first load: DOMContentLoaded ${Math.round(nav.dcl)}ms, first paint ${Math.round(nav.fcp)}ms`);
    // rapid taps on 轉一下 while it spins: exactly one spin
    for (let i = 0; i < 8; i++) { await tap('#spin-btn'); await sleep(125); }
    let g = await G(page);
    ok(g.phase === 'choose' && Object.values(g.stats).reduce((a, s) => a + s.picked, 0) === 1, '8 rapid taps on spin: one spin only');
    // frame rate during the spin (busiest moment)
    const fps = await page.evaluate(() => new Promise(res => { let n = 0, worst = 0, last = performance.now(); const t0 = last; (function f(now) { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < 1500) requestAnimationFrame(f); else res({ fps: n / ((now - t0) / 1000), worst }); })(t0); }));
    ok(fps.fps > 40, `(shared, heavily loaded CI box: >40 required) spin animation ${fps.fps.toFixed(1)} fps (worst frame ${fps.worst.toFixed(1)}ms)`);
    await page.waitForFunction(() => !window.__td.spinning, null, { timeout: 8000 });
    g = await G(page);
    const idx = await page.evaluate(() => { const t = window.__td; return t.TD.indexAt(t.G.theta, t.players.length, t.S.style); });
    ok(await page.evaluate(i => window.__td.players[i].id, idx) === g.cur.pid, 'animated spin lands on the picked player');
    await page.waitForFunction(() => !window.__td.guarded); await tap('#pick-T'); await sleep(600);
    // unlimited skips, 16 taps at 8/s -> exactly 16 skips
    await page.evaluate(() => { window.__td.S.skips = -1; });
    const before = (await G(page)).stats[g.cur.pid].skip;
    for (let i = 0; i < 16; i++) { await tap('#skip-btn'); await sleep(125); }
    g = await G(page);
    ok(g.stats[g.cur.pid].skip - before === 16 && g.log.filter(l => l.res === 'skip').length === 16, `16 touch taps at 8/s on 換一題 -> ${g.stats[g.cur.pid].skip - before} skips recorded`);
    // rapid taps on 完成: one round only
    await page.waitForFunction(() => !window.__td.guarded);
    for (let i = 0; i < 6; i++) { await tap('#done-btn'); await sleep(125); }
    g = await G(page);
    ok(g.round === 2 && g.log.filter(l => l.res === 'done').length === 1, '6 rapid taps on 完成: one round recorded');
    ok(g.phase === 'spin' && !(await page.evaluate(() => window.__td.spinning)), 'the extra taps did not start the next spin');
    await sleep(400);
    // flick the wheel with a touch drag -> spins
    const c = await page.$eval('#wheel', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; });
    const pts = [[-0.7, -0.3], [-0.45, -0.62], [-0.1, -0.75], [0.25, -0.7], [0.55, -0.5]].map(([dx, dy]) => ({ x: c.x + dx * c.r, y: c.y + dy * c.r }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
    for (const p of pts.slice(1)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(100);
    ok(await page.evaluate(() => window.__td.spinning), 'flicking the wheel starts a spin');
    await page.waitForFunction(() => !window.__td.spinning, null, { timeout: 8000 });
    ok((await G(page)).phase === 'choose', 'flick spin ends on a player');
    // bottle style spin
    await page.click('#tab-players'); await page.click('#seg-style button[data-v="bottle"]'); await page.click('#tab-game');
    await page.click('#pick-T'); await sleep(200); await page.click('#done-btn'); await sleep(200);
    await page.click('#spin-btn'); await page.waitForFunction(() => !window.__td.spinning, null, { timeout: 8000 });
    g = await G(page);
    const bi = await page.evaluate(() => { const t = window.__td; return t.TD.indexAt(t.G.theta, t.players.length, 'bottle'); });
    ok(await page.evaluate(i => window.__td.players[i].id, bi) === g.cur.pid, 'bottle points at the picked player');
    await page.screenshot({ path: `${OUT}/390x844-bottle.png` });
    ok(errors.length === 0, `touch/animation: no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---------- corrupt storage doesn't break the app ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    await page.evaluate(() => { localStorage.setItem('truth-dare:v1:game', '{bad'); localStorage.setItem('truth-dare:v1:players', '"x"'); localStorage.setItem('truth-dare:v1:custom', '[{"q":5},null]'); localStorage.setItem('truth-dare:v1:settings', '{"levels":[],"pick":"zzz","skips":99}'); });
    await page.reload(); await page.waitForTimeout(150);
    await page.click('#spin-btn'); await page.waitForTimeout(600); await page.click('#pick-T'); await page.waitForTimeout(100);
    ok(await page.isVisible('#dock-card') && errors.length === 0, 'corrupt storage: falls back to defaults and still plays ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- review fixes: long custom questions fit at every size (light/dark), before and after reload ----------
  {
    const LONG = n => ('你有沒有在半夜三點，一個人坐在便利商店外面，邊吃關東煮邊想人生的經驗？如果有，那天到底發生了什麼事，讓你這麼晚還不回家，最後又是怎麼想通的？').repeat(5).slice(0, n - 1) + '？';
    const checkCard = (page, label) => page.evaluate(lbl => {
      const body = document.getElementById('qbody'), t = document.getElementById('q-text');
      const b = body.getBoundingClientRect(), r = t.getBoundingClientRect(), fs = parseFloat(getComputedStyle(t).fontSize);
      const scroll = body.classList.contains('scroll');
      let okTop = r.top >= b.top - 1, okBottom = r.bottom <= b.bottom + 1;
      if (scroll) { body.scrollTop = body.scrollHeight; const r2 = t.getBoundingClientRect(); okBottom = r2.bottom <= b.bottom + 1 && body.scrollHeight > body.clientHeight; body.scrollTop = 0; }
      return { lbl, okTop, okBottom, fs, scroll, len: t.textContent.length };
    }, label);
    for (const [w, h] of [[360, 640], [375, 500], [390, 610], [430, 740], [390, 844], [430, 932], [844, 390]]) for (const dark of [false, true]) {
      const { ctx, page, errors } = await mk({ viewport: { width: w, height: h }, dark });
      for (const n of [60, 120, 200]) {
        await page.evaluate(q => { localStorage.setItem('truth-dare:v1:custom', JSON.stringify([{ id: 'c1', t: 'T', lv: 2, r: 0, q }])); const s = JSON.parse(localStorage.getItem('truth-dare:v1:settings') || '{}'); s.builtin = false; localStorage.setItem('truth-dare:v1:settings', JSON.stringify(s)); localStorage.removeItem('truth-dare:v1:game'); }, LONG(n));
        await page.reload(); await page.waitForTimeout(100);
        await page.click('#spin-btn'); await page.waitForTimeout(600); await page.click('#pick-T'); await page.waitForTimeout(150);
        let c = await checkCard(page);
        const tag = `${w}x${h}${dark ? '-dark' : ''} ${n}-char question`;
        ok(c.len === n && c.okTop && c.okBottom && c.fs >= 13, `${tag}: whole text visible on first show (font ${c.fs}px${c.scroll ? ', scrolls' : ''})`);
        if (n === 200 && w === 375 && !dark) await page.screenshot({ path: `${OUT}/375x500-long200.png` });
        if (c.scroll) {
          // a real touch swipe on the card scrolls to the end of the question
          const cdp = await ctx.newCDPSession(page);
          const bx = await page.$eval('#qbody', e => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height - 12, h: r.height }; });
          for (let k = 0; k < 4 && !(await page.$eval('#qbody', e => e.classList.contains('end'))); k++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bx.x, y: bx.y }] });
            for (let st = 1; st <= 8; st++) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bx.x, y: bx.y - st * (bx.h - 30) / 8 }] }); }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(250);
          }
          const sc = await page.$eval('#qbody', e => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight, end: e.classList.contains('end') }));
          ok(sc.end && sc.top >= sc.max - 4, `${tag}: a touch swipe scrolls to the end of the question (${Math.round(sc.top)}/${sc.max})`);
          await page.$eval('#qbody', e => { e.scrollTop = 0; });
          await cdp.detach();
        }
        if (n === 120 && w === 360 && !dark) await page.screenshot({ path: `${OUT}/360x640-long120.png` });
        await page.reload(); await page.waitForTimeout(150);
        const c2 = await checkCard(page);
        ok(c2.okTop && c2.okBottom && Math.abs(c2.fs - c.fs) <= 1, `${tag}: same fit after reload (${c.fs} → ${c2.fs}px)`);
      }
      // the built-in bank at its default size never needs scrolling
      ok(errors.length === 0, `${w}x${h}${dark ? '-dark' : ''} long-card: no errors ${errors.join(' | ')}`);
      await ctx.close();
    }
  }

  // ---------- review fixes: respin, double taps, reload mid-spin, long names, undo during spin, NaN round, quick family toggle, backup ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 390, height: 844 }, motion: true });
    const cdp = await ctx.newCDPSession(page);
    const tapAt = async (x, y) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
    const centre = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const settle = () => page.waitForFunction(() => !window.__td.spinning && !window.__td.guarded, null, { timeout: 9000 });
    // fair mode: reach the last player of a round, then 換人重轉 4 times: never the same person
    await page.evaluate(() => { const g = window.__td.G; g.bag = [window.__td.players[3].id]; g.last = window.__td.players[3].id; });
    let same = 0;
    for (let i = 0; i < 4; i++) {
      await page.click('#spin-btn'); await settle();
      const a = (await G(page)).cur.pid;
      await page.click('#respin'); await settle();
      const b = (await G(page)).cur.pid; if (a === b) same++;
      await page.click('#pick-T'); await settle(); await page.click('#done-btn'); await settle();
    }
    ok(same === 0, `換人重轉 never lands on the same player (${same}/4 repeats)`);
    // double tap on 真心話: the second tap 150 ms later must not finish the card
    await page.click('#spin-btn'); await settle();
    const [px, py] = await centre('#pick-T');
    await tapAt(px, py); await sleep(150); await tapAt(px, py); await sleep(100);
    let g = await G(page);
    ok(g.phase === 'card' && g.log.filter(l => l.res === 'done').length === 4, 'double tap on 真心話: card stays open (second tap ignored)');
    await settle();
    const [dx, dy] = await centre('#done-btn');
    await tapAt(dx, dy); await sleep(150); await tapAt(dx, dy); await sleep(100);
    g = await G(page);
    ok(g.phase === 'spin' && !(await page.evaluate(() => window.__td.spinning)), 'double tap on 完成了: the next spin does not start by accident');
    // 8 taps/s alternating 真心話 / 大冒險: the 完成了 that appears under the finger is held (dimmed) for 350 ms, nothing finished unseen
    await settle(); await page.click('#spin-btn'); await settle();
    const t1 = await centre('#pick-T'), t2 = await centre('#pick-D');
    const doneBefore = (await G(page)).log.length;
    await tapAt(...t1); await sleep(40);
    const arm = await page.evaluate(() => ({ done: document.getElementById('done-btn').classList.contains('arming'), skip: document.getElementById('skip-btn').classList.contains('arming'), op: getComputedStyle(document.getElementById('done-btn')).opacity }));
    ok(arm.done && !arm.skip && +arm.op < 0.7, `the button that appears under the finger is shown dimmed while held (opacity ${arm.op}); 換一題 is not held`);
    await sleep(85); await tapAt(...t2); await sleep(125); await tapAt(...t1); await sleep(60);
    g = await G(page);
    ok(g.phase === 'card' && g.log.length === doneBefore, `alternating taps at 8/s: the card stays open for the hold window (phase ${g.phase})`);
    await sleep(300);
    ok(!(await page.evaluate(() => document.getElementById('done-btn').classList.contains('arming'))), 'the hold ends after 350 ms and does not extend');
    await page.click('#done-btn'); await settle();
    // 換一題 tapped 8/s right after the card appears: every tap counts (it was not under the finger)
    await page.evaluate(() => { window.__td.S.skips = -1; });
    await page.click('#spin-btn'); await settle();
    const sk0 = (await G(page)).log.filter(l => l.res === 'skip').length;
    await tapAt(...t1); await sleep(125);
    const sp = await centre('#skip-btn');
    for (let i = 0; i < 8; i++) { await tapAt(...sp); await sleep(125); }
    g = await G(page);
    ok(g.log.filter(l => l.res === 'skip').length - sk0 === 8, `8 taps/s on 換一題 right after the card appears: ${g.log.filter(l => l.res === 'skip').length - sk0}/8 counted`);
    await settle(); await page.click('#done-btn'); await settle();
    // a deliberate tap on 真心話 150 ms after the wheel stops (nobody was tapping) works
    await page.click('#spin-btn'); await page.waitForFunction(() => !window.__td.spinning, null, { timeout: 9000 }); await sleep(150);
    await tapAt(...t1); await sleep(80);
    ok((await G(page)).phase === 'card', '真心話 tapped 150 ms after the wheel stops is accepted');
    await settle(); await page.click('#done-btn'); await settle();
    // reload during a spin: pointer on the announced player (5 tries)
    let wrong = 0;
    for (let i = 0; i < 5; i++) {
      await page.click('#spin-btn'); await sleep(400 + i * 300);
      await page.reload(); await page.waitForTimeout(250);
      const r = await page.evaluate(() => { const t = window.__td; return { idx: t.TD.indexAt(t.G.theta, t.players.length, t.S.style), pid: t.G.cur.pid, ids: t.players.map(p => p.id), who: document.getElementById('who-name').textContent }; });
      if (r.ids[r.idx] !== r.pid) wrong++;
      await settle(); await page.click('#pick-T'); await settle(); await page.click('#done-btn'); await settle();
    }
    ok(wrong === 0, `reload mid-spin: pointer matches the announced player (${5 - wrong}/5)`);
    // undo during a spin: one row of buttons only
    await page.click('#spin-btn'); await settle(); await page.click('#pick-D'); await settle(); await page.click('#done-btn'); await settle();
    await page.click('#spin-btn'); await sleep(300);
    await page.click('#toast-btn'); await sleep(200);
    const rows = await page.$$eval('#docks .dock', ds => ds.filter(d => !d.hidden && getComputedStyle(d).visibility !== 'hidden').map(d => d.id));
    ok(rows.length === 1 && rows[0] === 'dock-card' && !(await page.evaluate(() => window.__td.spinning)), 'undo during a spin: the card returns, spin stops, one button row (' + rows.join(',') + ')');
    await settle(); await page.click('#done-btn'); await settle();
    // 12-character names fit the 輪到 headline at 390 and 430
    for (const nm of ['WWWWWWWWWWWW', '鬱鬱鬱鬱鬱鬱鬱鬱鬱鬱鬱鬱']) {
      await page.evaluate(n => { const ps = JSON.parse(localStorage.getItem('truth-dare:v1:players')) || window.__td.players; ps[0].name = n; localStorage.setItem('truth-dare:v1:players', JSON.stringify(ps)); const g = JSON.parse(localStorage.getItem('truth-dare:v1:game')); g.phase = 'choose'; g.cur = { pid: ps[0].id }; localStorage.setItem('truth-dare:v1:game', JSON.stringify(g)); }, nm);
      for (const w of [390, 430, 360]) {
        await page.setViewportSize({ width: w, height: 800 }); await page.reload(); await page.waitForTimeout(150);
        const f = await page.$eval('#who .n', e => ({ sw: e.scrollWidth, cw: e.clientWidth, fs: parseFloat(getComputedStyle(e).fontSize) }));
        ok(f.sw <= f.cw + 1 && f.fs >= 15, `12-char name 「${nm}」 fits the headline at ${w}px (${f.fs}px)`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    // corrupted round number
    await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('truth-dare:v1:game')); g.round = 'abc'; localStorage.setItem('truth-dare:v1:game', JSON.stringify(g)); });
    await page.reload(); await page.waitForTimeout(150);
    ok(/第 \d+ 回合/.test(await page.textContent('#sub')), 'corrupted round number repaired: ' + (await page.textContent('#sub')));
    // family mode reachable from the game screen
    await page.evaluate(() => { const g = JSON.parse(localStorage.getItem('truth-dare:v1:game')); g.phase = 'spin'; g.cur = null; localStorage.setItem('truth-dare:v1:game', JSON.stringify(g)); }); await page.reload(); await page.waitForTimeout(150);
    ok(await page.isVisible('#fam-quick'), 'family-mode toggle is on the game screen');
    await page.click('#fam-quick'); ok((await page.getAttribute('#fam-quick', 'aria-pressed')) === 'true' && await page.evaluate(() => window.__td.S.family), 'quick toggle turns family mode on');
    await page.click('#fam-quick'); ok(!(await page.evaluate(() => window.__td.S.family)), 'and off again');
    await page.click('#rules-quick'); ok(await page.isVisible('#v-players'), '規則與難度 opens the rules');
    // backup restores disabled built-in questions
    await page.click('#tab-bank');
    await page.click('#qlist li:nth-child(1) button[data-a="hide"]'); await page.click('#qlist li:nth-child(2) button[data-a="hide"]'); await page.click('#qlist li:nth-child(3) button[data-a="hide"]');
    const hid = await page.evaluate(() => Object.keys(window.__td.hidden).sort());
    await page.click('#export-btn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#e-json')]);
    const backup = fs.readFileSync(await dl.path(), 'utf8'); await page.click('#e-close');
    await page.evaluate(() => { localStorage.removeItem('truth-dare:v1:hidden'); localStorage.removeItem('truth-dare:v1:custom'); }); await page.reload(); await page.waitForTimeout(100);
    await page.click('#tab-bank'); await page.click('#import-btn');
    await page.evaluate(t => { const ta = document.getElementById('i-text'); ta.value = t; ta.dispatchEvent(new Event('input')); }, backup);
    ok((await page.textContent('#i-prev')).includes('還原 3 題停用設定'), 'import preview mentions the 3 disabled questions');
    await page.click('#i-go'); await page.waitForTimeout(50);
    ok(JSON.stringify(await page.evaluate(() => Object.keys(window.__td.hidden).sort())) === JSON.stringify(hid), 'restoring the backup disables the same 3 built-in questions');
    // binary file
    await page.click('#import-btn');
    await page.setInputFiles('#i-file', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff, 0xd8, 0xfe, 0x00, 0x10]) });
    await page.waitForTimeout(150);
    ok((await page.textContent('#i-err')).includes('不是文字檔') && await page.isDisabled('#i-go') && (await page.textContent('#i-prev')).trim() === '', 'binary file refused with one clear explanation (no 「可匯入 0 題」)');
    await page.click('#i-cancel');
    // bank tab speed with 1000 custom + 350 built-in
    await page.evaluate(() => { localStorage.setItem('truth-dare:v1:custom', JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({ id: 'c' + i, t: i % 2 ? 'D' : 'T', lv: 1 + i % 3, r: 0, q: '自訂題目第 ' + i + ' 題，看看渲染速度' })))); });
    await page.reload(); await page.waitForTimeout(150);
    const ms = await page.evaluate(() => new Promise(res => { const t0 = performance.now(); document.getElementById('tab-bank').click(); requestAnimationFrame(() => setTimeout(() => res(performance.now() - t0), 0)); }));
    ok(ms < 200, `題庫 tab with 1,350 questions opens in ${Math.round(ms)}ms`);
    ok(errors.length === 0, `review-fix flows: no console errors ${errors.join(' | ')}`);
    await ctx.close();
  }

  // ---------- footer: long player name + timer button at 375×500 ----------
  {
    const { ctx, page, errors } = await mk({ viewport: { width: 375, height: 500 } });
    await page.evaluate(() => {
      localStorage.setItem('truth-dare:v1:players', JSON.stringify([{ id: 'a', name: '歐陽娜娜歐陽娜娜歐陽娜娜' }, { id: 'b', name: 'WWWWWWWWWWWW' }]));
      localStorage.setItem('truth-dare:v1:custom', JSON.stringify([{ id: 'c1', t: 'D', lv: 1, r: 0, q: '做一個鬼臉，維持 10 秒。' }]));
      localStorage.setItem('truth-dare:v1:settings', JSON.stringify({ builtin: false }));
    });
    for (let i = 0; i < 2; i++) {
      await page.reload(); await page.waitForTimeout(100);
      await page.click('#spin-btn'); await page.waitForTimeout(600); await page.click('#pick-D'); await page.waitForTimeout(150);
      const f = await page.$eval('#q-player', e => ({ sw: e.scrollWidth, cw: e.clientWidth, fs: parseFloat(getComputedStyle(e).fontSize), t: e.textContent }));
      ok(await page.isVisible('#timer-btn') && f.sw <= f.cw + 1, `375x500 footer 「${f.t}」 fits beside the timer (${f.fs}px)`);
      await page.click('#done-btn'); await page.waitForTimeout(100);
    }
    ok(errors.length === 0, 'footer check: no errors ' + errors.join(' | '));
    await ctx.close();
  }

  // ---------- cover ----------
  {
    const { ctx, page } = await mk({ viewport: { width: 390, height: 520 } });
    await page.click('#spin-btn'); await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/cover-390x520.png` });
    ok(fs.existsSync(`${OUT}/cover-390x520.png`), 'cover-390x520.png written');
    await ctx.close();
  }

  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
