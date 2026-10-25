// Skill-tier playtest for 填色本 (color-book). A calm, no-fail game: the tiers are measured by how long a picture takes,
// how many taps miss, how often the player has to zoom or ask for a hint, and where they get stuck (frustration points).
// Real headless Chromium, 390×844 @2, touch. Every action is a real CDP touch: taps on palette swatches and regions,
// two-finger pinch to zoom, one-finger drag to pan, taps on the fit / hint buttons. The bot READS __cb.state() and
// __cb.regions() (what a player sees: numbers, grey highlights, sizes on screen) and never calls a state-changing hook,
// except __cb.open(i) to pick the picture (same as tapping its card in the gallery).
// Human time is simulated from the tier model (reaction + aiming + zoom/pan gestures + search), while the touches are
// replayed quickly so a full sweep fits in the time budget; the game's own timer is not used for the tables.
// Usage: node bot.js [tier ...]  → results.json, raw.json
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const OUT = __dirname;
const SRC = fs.readFileSync(path.resolve(__dirname, '../../../apps/color-book/index.html'), 'utf8');
const PAGE = '<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body>\n' + SRC + '\n</body></html>';
const LEVELS = (process.env.LEVELS || '1,10,25,50,75,99,100').split(',').map(Number);

// react: ms mean/sd; pos: motor σ px; mist: chance to tap a wrong-numbered region; zoomK: wants radius on screen >= zoomK·σ (min 7px);
// randomOrder: picks targets in random order instead of nearest-first; search: ms to spot the next target; gesture: ms per pinch/pan
const TIERS = {
  clumsy:     { name: '手殘', react: [650, 200], pos: 40, mist: 0.15, zoomK: 0.9, randomOrder: 0.5, search: 900, gesture: 1500, hintAfter: 2 },
  casual:     { name: '普通', react: [400, 100], pos: 20, mist: 0.06, zoomK: 1.2, randomOrder: 0.15, search: 600, gesture: 1100, hintAfter: 3 },
  skilled:    { name: '熟練', react: [260, 50], pos: 10, mist: 0.02, zoomK: 1.6, randomOrder: 0, search: 380, gesture: 800, hintAfter: 4 },
  world:      { name: '世界級', react: [180, 25], pos: 4, mist: 0.003, zoomK: 2.2, randomOrder: 0, search: 250, gesture: 600, hintAfter: 6 },
  superhuman: { name: '非人', react: [16, 0], pos: 0, mist: 0, zoomK: 0, randomOrder: 0, search: 0, gesture: 120, hintAfter: 99 },
};
function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(browser, url, tierId, level, seed) {
  const T = TIERS[tierId], R = rng(seed);
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.setItem('color-book:v1:set', JSON.stringify({ snd: 0, tut: 1 })); } catch (e) { /* */ } });
  await page.goto(url); await page.waitForFunction(() => window.__cb && __cb.ready(), null, { timeout: 120000 });
  const cdp = await ctx.newCDPSession(page);
  const pic = await page.evaluate(no => __cb.order()[no - 1], level);
  await page.evaluate(i => __cb.open(i), pic.i); await sleep(80); await page.waitForFunction(() => __cb.ready(), null, { timeout: 120000 });
  const stage = await page.evaluate(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const st = { simMs: 0, taps: 0, fills: 0, wrong: 0, dead: 0, zooms: 0, pans: 0, fits: 0, hints: 0, swatch: 0, stuck: [], attempts: {}, noProgress: 0 };
  const tap = async (x, y) => { lastTapXY = Math.round(x) + ',' + Math.round(y); st.taps++; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(8); };
  const tapSel = async sel => { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await tap(b.x + b.width / 2 + gauss(R) * Math.min(T.pos, 8), b.y + b.height / 2 + gauss(R) * Math.min(T.pos, 8)); };
  const pinch = async (cx, cy, k) => {
    st.zooms++; st.simMs += T.gesture;
    // a finger can't leave the screen: spread along whichever axis has more room around the centre
    const roomX = 2 * Math.min(cx - 4, 390 - 4 - cx), roomY = 2 * Math.min(cy - stage.y - 4, stage.y + stage.h - 4 - cy), vert = roomY > roomX;
    const d0 = 70, d1 = Math.max(30, Math.min(340, Math.max(d0 * k, d0 + 40), Math.max(roomX, roomY))), pts = d => vert ? [{ x: cx, y: cy - d / 2, id: 1 }, { x: cx, y: cy + d / 2, id: 2 }] : [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * i / 6) }); await sleep(10); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(40);
    if (process.env.DBG) console.log('   after pinch', JSON.stringify(await page.evaluate(() => { const s = __cb.state(); return [s.view, s.sel, s.filled, document.querySelector('.sheet:not([hidden])') && document.querySelector('.sheet:not([hidden])').id]; })));
  };
  const drag = async (x0, y0, x1, y1) => {
    st.pans++; st.simMs += T.gesture * 0.7;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 6, y: y0 + (y1 - y0) * i / 6 }] }); await sleep(10); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(260);
  };
  const S = () => page.evaluate(() => __cb.state());
  const inStage = (x, y, m) => x > stage.x + m && x < stage.x + stage.w - m && y > stage.y + m && y < stage.y + stage.h - m;
  const t0 = Date.now(); let guard = 0, lastFill = 0, hintStreak = 0, lastSig = '', same = 0, lastBranch = '', edgePans = 0, lastOpen = '', lastTapXY = '';
  while (guard++ < 6000 && Date.now() - t0 < 480000) {
    const s = await S(); if (s.complete) break;
    const sig = [s.filled, s.rec.m, s.view.s.toFixed(3), Math.round(s.view.tx), Math.round(s.view.ty), s.sel].join();
    if (sig === lastSig) { if (++same >= 5) { same = 0; st.noProgress++; if (process.env.DBG) console.log('  NOPROGRESS', sig, lastBranch); if (!(await page.locator('#zFit').isHidden()) && st.noProgress % 2) { st.fits++; st.simMs += 600; await tapSel('#zFit'); await sleep(420); } else { st.hints++; st.simMs += T.search * 3 + 600; await tapSel('#bHint'); await sleep(520); } continue; } } else same = 0;
    lastSig = sig;
    if (process.env.DBG) { const open = await page.evaluate(() => [...document.querySelectorAll('.sheet,#book')].filter(e => !e.hidden).map(e => e.id).join()); if (open && open !== lastOpen) console.log('  SHEET', open, 'after', lastBranch, lastTapXY); lastOpen = open; }
    // colour: keep the current one while it has regions left (the game advances on its own)
    let c = s.sel;
    if (!s.remain[c]) { const open = s.remain.map((v, j) => v > 0 ? j : 0).filter(Boolean); c = open[Math.floor(R() * open.length)]; st.swatch++; st.simMs += 700 + T.react[0]; await tapSel(`.sw[data-c="${c}"]`); await sleep(60); continue; }
    const regs = await page.evaluate(() => { const s = __cb.state(); return __cb.regions().filter(r => !r.f).map(r => { const p = __cb.toScreen(r.x, r.y); return { ...r, sx: p[0], sy: p[1], rs: r.r * s.view.s }; }); });
    const mine = regs.filter(r => r.c === c);
    // what the player can see: regions of this colour on screen big enough to notice (≥2px) — grey highlight
    const visible = mine.filter(r => inStage(r.sx, r.sy, 4) && r.rs >= (tierId === 'superhuman' ? 0 : 2));
    let target;
    if (!visible.length) {
      // nothing in view: zoom out to the whole sheet, and if still nothing visible ask for a hint
      // zoomed in and the region just slid off the edge: a person drags it back into view instead of zooming out
      const mx0 = stage.x + stage.w / 2, my0 = stage.y + stage.h / 2;
      const near = mine.filter(r => r.rs >= 2).sort((a, b) => Math.hypot(a.sx - mx0, a.sy - my0) - Math.hypot(b.sx - mx0, b.sy - my0))[0];
      if (near && s.view.s > s.sFit * 1.01 && Math.hypot(near.sx - mx0, near.sy - my0) < 500 && edgePans < 3) {
        edgePans++; lastBranch = 'edgepan'; let dx = mx0 - near.sx, dy = my0 - near.sy; const L = Math.hypot(dx, dy), m = Math.min(1, 260 / L); dx *= m; dy *= m;
        await drag(mx0 - dx / 2, my0 - dy / 2, mx0 + dx / 2, my0 + dy / 2); continue;
      }
      edgePans = 0;
      if (!(await page.locator('#zFit').isHidden())) { lastBranch = 'fit'; st.fits++; st.simMs += T.search + 400; await tapSel('#zFit'); await sleep(420); continue; }
      lastBranch = 'hint'; st.hints++; st.simMs += T.search * 3 + 600; await tapSel('#bHint'); await sleep(520); continue;
    }
    if (R() < T.randomOrder) target = visible[Math.floor(R() * visible.length)];
    else { const cx = stage.x + stage.w / 2, cy = stage.y + stage.h / 2; target = visible.slice().sort((a, b) => (Math.hypot(a.sx - cx, a.sy - cy) - a.rs * 3) - (Math.hypot(b.sx - cx, b.sy - cy) - b.rs * 3))[0]; }
    st.simMs += T.search;
    if (process.env.DBG) console.log('it', guard, 'sel', c, 'target', target.k, target.rs.toFixed(1), Math.round(target.sx), Math.round(target.sy), 'view', s.view.s.toFixed(2), Math.round(s.view.tx), Math.round(s.view.ty), 'stage', JSON.stringify(stage));
    // too small to hit reliably → pinch around it (or pan it toward the middle first)
    const need = Math.max(7, T.zoomK * T.pos);
    if (tierId !== 'superhuman' && target.rs < need && s.view.s < s.sMax * 0.98) {
      const mx = stage.x + stage.w / 2, my = stage.y + stage.h / 2;
      // fingers start ±35px around the pinch centre; keep both on the sheet canvas (not on the zoom buttons)
      let px = Math.min(Math.max(target.sx, stage.x + 50), stage.x + stage.w - 50), py = Math.min(Math.max(target.sy, stage.y + 30), stage.y + stage.h - 30);
      const ok = (x, y) => page.evaluate(([x, y]) => [[x - 35, y], [x + 35, y], [x, y - 35], [x, y + 35]].every(([a, b]) => { const e = document.elementFromPoint(a, b); return e && e.id === 'cv'; }), [x, y]);
      for (let k = 0; k < 8 && !(await ok(px, py)); k++) { px += (mx - px) * 0.3; py += (my - py) * 0.3; }
      lastBranch = 'pinch';
      if (process.env.DBG) console.log('  pinch at', Math.round(px), Math.round(py));
      await pinch(px, py, Math.min(4, need / target.rs * 1.15)); continue;
    }
    // the tap itself: a wrong-number region by mistake now and then, plus motor noise
    let aim = target;
    if (R() < T.mist) { const others = regs.filter(r => r.c !== c && inStage(r.sx, r.sy, 4) && Math.hypot(r.sx - target.sx, r.sy - target.sy) < 160); if (others.length) aim = others[Math.floor(R() * others.length)]; }
    const x = aim.sx + gauss(R) * T.pos * 0.5, y = aim.sy + gauss(R) * T.pos * 0.5;
    st.simMs += Math.max(16, T.react[0] + gauss(R) * T.react[1]) + (tierId === 'superhuman' ? 0 : 120 + 90 * Math.log2(1 + 120 / Math.max(4, aim.rs * 2)));
    if (!inStage(x, y, 1)) { lastBranch = 'offstage'; st.dead++; continue; }
    const covered = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !e || e.id !== 'cv'; }, [x, y]);
    if (covered) { lastBranch = 'covered:' + (await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className || e.tagName + '<' + (e.closest('[id]') || {}).id); }, [x, y])) + ' @' + Math.round(x) + ',' + Math.round(y); await drag(stage.x + stage.w / 2, stage.y + stage.h / 2, stage.x + stage.w / 2 - 80, stage.y + stage.h / 2 - 80); continue; }
    await tap(x, y); await sleep(15);
    const s2 = await S();
    if (s2.filled > s.filled) { st.fills += s2.filled - s.filled; lastFill = st.taps; hintStreak = 0; }
    else if (s2.rec.m > s.rec.m) st.wrong++;
    else st.dead++;
    if (s2.filled === s.filled && aim === target) {
      const a = (st.attempts[target.k] = (st.attempts[target.k] || 0) + 1);
      if (a === 3) st.stuck.push({ region: target.k, radiusOnScreen: +target.rs.toFixed(1), zoom: +(s.view.s / s.sFit).toFixed(1) });
      if (a >= T.hintAfter + 2 && ++hintStreak) { st.hints++; st.simMs += 800; await tapSel('#bHint'); await sleep(520); st.attempts[target.k] = 0; }
    }
  }
  const s = await S();
  const res = { tier: tierId, level, name: pic.name, cat: pic.cat, regions: pic.n, cleared: s.complete, filledPct: Math.round(100 * s.filled / pic.n), simMin: +(st.simMs / 60000).toFixed(1), secPerRegion: +(st.simMs / 1000 / pic.n).toFixed(2), taps: st.taps, wrong: s.rec.m, dead: st.dead, zooms: st.zooms, pans: st.pans, fits: st.fits, hints: s.rec.h, stuck: st.stuck.length, noProgress: st.noProgress, stuckDetail: st.stuck.slice(0, 5), wallSec: Math.round((Date.now() - t0) / 1000), errors };
  await ctx.close();
  return res;
}

(async () => {
  const tiers = process.argv.slice(2).filter(a => TIERS[a]); const use = tiers.length ? tiers : Object.keys(TIERS);
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(PAGE); }); await new Promise(r => srv.listen(0, r));
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  const rawPath = path.join(OUT, 'raw.json'), raw = fs.existsSync(rawPath) ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : {};
  try {
    for (const t of use) {
      raw[t] = (raw[t] || []).filter(r => LEVELS.includes(r.level) && !process.env.FRESH);
      for (const lv of LEVELS) {
        if (raw[t].some(r => r.level === lv)) continue;
        const r = await run(browser, url, t, lv, 1000 + lv * 7 + Object.keys(TIERS).indexOf(t));
        raw[t].push(r); raw[t].sort((a, b) => a.level - b.level);
        console.log(`${TIERS[t].name}\tNo.${lv}\t${r.name}(${r.regions})\t${r.cleared ? '完成' : '未完成'}\t${r.simMin}分\t${r.secPerRegion}s/塊\t點錯${r.wrong}\t空點${r.dead}\t縮放${r.zooms}\t提示${r.hints}\t卡住${r.stuck}\t${r.errors.length ? 'ERR ' + r.errors[0] : ''}`);
        fs.writeFileSync(rawPath, JSON.stringify(raw, null, 1));
      }
    }
  } finally { await browser.close(); srv.close(); }
})();
