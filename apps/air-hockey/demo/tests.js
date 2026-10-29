// Regression tests for 霓虹冰球 (air-hockey). Usage: node tests.js [--core]
// 1) Core (Node, the game's own CORE-START..CORE-END): physics, wedge/stall, rules, overtime, save/restore, AI moves.
// 2) Browser (Chromium, real CDP touch, 390x844 + landscape): tutorial, top-half hint, multi-touch, mid-match resume,
//    two-player hints, landscape HUD, title panel, score box fade, no console errors.
const fs = require('fs'), path = require('path');
const APP = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(APP, 'utf8');
const C = new Function(html.match(/\/\*CORE-START\*\/([\s\S]*?)\/\*CORE-END\*\//)[1] +
  '\nreturn {newMatch, stepMatch, difficulty, targetScore, aiParams, aiStep, levelRule, otWiden, applyGeom, RULES, OT_T, OT_MAX, geom: function () { return { GX0: GX0, GX1: GX1, DAMP: DAMP, WALL_E: WALL_E }; }};')();
const { makeBot } = require('./bot.js');
let pass = 0, fail = 0;
function ok(c, msg) { if (c) pass++; else { fail++; console.log('FAIL', msg); } }
const step = (M, s) => { for (let i = 0; i < Math.round(s * 60); i++) { C.stepMatch(M, 1 / 60); } };

// ---------- wedge: the "rush the puck" player that used to pin the puck in a corner at speed 1288 ----------
{
  let wedges = 0, worstStill = 0, maxRelease = 0;
  for (const n of [10, 50, 100]) for (let g = 0; g < 8; g++) {
    const M = C.newMatch(n, { seed: 900 + g * 131 + n }), h = []; let t = 0, fx = 180, fy = 564, anc = null, found = false;
    while (!M.over && t < 300 && !found) {
      h.push([t, M.puck.x, M.puck.y]); while (h.length > 2 && h[1][0] <= t - 0.26) h.shift();
      const q = h[0], tx = q[1], ty = Math.max(q[2] + 10, 330), dx = tx - fx, dy = ty - fy, d = Math.hypot(dx, dy);
      if (d <= 40) { fx = tx; fy = ty; } else { fx += dx / d * 40; fy += dy / d * 40; }
      M.m[1].tx = fx; M.m[1].ty = fy; C.stepMatch(M, 1 / 60); M.ev.length = 0; t += 1 / 60;
      const p = M.puck, v = Math.hypot(p.vx, p.vy);
      if (!p.on || M.freeze > 0 || v <= 40 || !anc || Math.hypot(p.x - anc.x, p.y - anc.y) > 1) anc = { x: p.x, y: p.y, t };
      else { worstStill = Math.max(worstStill, t - anc.t); if (t - anc.t > 2) found = true; }
    }
    if (found) wedges++;
  }
  ok(wedges === 0, 'rush player: no puck stuck in place at speed > 40 for 2 s (was 12/24), got ' + wedges + ' (longest ' + worstStill.toFixed(2) + ' s)');
  // pin the puck into the bottom-right corner with the mallet pressing on it: no energy pumped in, no wall-sound spam, reset in ~3 s
  // (the state the reviewer found: puck at (344,624) moving at 1288 px/s, mallet at (303,609), finger pushing into the corner)
  const M = C.newMatch(1, { seed: 5 }); M.freeze = 0; M.m[0].x = 180; M.m[0].y = 60;
  const p = M.puck; p.x = 344; p.y = 624; p.vx = 1209; p.vy = 443; M.m[1].x = 303; M.m[1].y = 609;
  let walls = 0, resetAt = -1, vmax = 0;
  for (let i = 0; i < 6 * 60; i++) {
    M.m[1].tx = 360; M.m[1].ty = 640; // finger keeps pushing into the corner
    C.stepMatch(M, 1 / 60);
    for (const e of M.ev) { if (e.t === 'wall') walls++; if (e.t === 'reset' && resetAt < 0) resetAt = i / 60; }
    M.ev.length = 0;
    if (resetAt < 0 && i > 60) vmax = Math.max(vmax, Math.hypot(p.vx, p.vy));
  }
  ok(vmax < 60, 'puck pressed into a corner loses its speed instead of keeping ~1288 px/s (max after 1 s: ' + Math.round(vmax) + ')');
  ok(walls <= 6, 'a puck pressed against the walls fires one wall event per contact, not one per substep (got ' + walls + ')');
  ok(resetAt > 2.5 && resetAt < 4.5, 'a puck stuck in a corner is moved back to the centre line after about 3 s (at ' + resetAt.toFixed(2) + ' s)');
  // mallet lifted after the wedge: puck does not shoot out at top speed
  const M2 = C.newMatch(1, { seed: 6 }); M2.freeze = 0; M2.puck.x = 330; M2.puck.y = 610; M2.puck.vx = 500; M2.puck.vy = 500;
  for (let i = 0; i < 90; i++) { M2.m[1].tx = 360; M2.m[1].ty = 640; C.stepMatch(M2, 1 / 60); }
  let rel = 0; for (let i = 0; i < 30; i++) { M2.m[1].tx = 180; M2.m[1].ty = 480; C.stepMatch(M2, 1 / 60); rel = Math.max(rel, Math.hypot(M2.puck.vx, M2.puck.vy)); }
  ok(rel < 400, 'moving the mallet off a cornered puck does not fire it out at ~1300 px/s (got ' + Math.round(rel) + ')');
}
// ---------- normal wall bounce still makes exactly one event ----------
{
  const M = C.newMatch(1, { seed: 7 }); M.freeze = 0; M.m[1].x = M.m[1].tx = 180; M.m[1].y = M.m[1].ty = 600; M.m[0].x = 180; M.m[0].y = 40;
  M.puck.x = 100; M.puck.y = 400; M.puck.vx = -600; M.puck.vy = 0; let w = 0;
  for (let i = 0; i < 20; i++) { C.stepMatch(M, 1 / 60); for (const e of M.ev) if (e.t === 'wall') w++; M.ev.length = 0; }
  ok(w === 1 && M.puck.vx > 0, 'a single side-wall bounce gives one wall event and reverses the puck (' + w + ')');
}
// ---------- level 10 move "迎擊移動球" is real ----------
{
  ok(!C.aiParams(9).hitMoving && C.aiParams(10).hitMoving, 'hitMoving switches on at level 10');
  const st = n => { const M = C.newMatch(n, { seed: 3 }); M.freeze = 0; M.t = 5; const p = M.puck; p.x = 120; p.y = 200; p.vx = 300; p.vy = 30;
    for (let i = 0; i < 240; i++) { M.buf[i * 4] = p.x; M.buf[i * 4 + 1] = p.y; M.buf[i * 4 + 2] = p.vx; M.buf[i * 4 + 3] = p.vy; }
    M.m[0].x = 180; M.m[0].y = 80; C.aiStep(M, 0); return M.ai[0].st; };
  ok(st(9) === 'def' && st(10) === 'app', 'a puck sliding at 300 px/s in its half: level 9 waits (' + st(9) + '), level 10 goes for it (' + st(10) + ')');
}
// ---------- table variations ----------
{
  const rs = []; for (let n = 1; n <= 100; n++) rs.push(C.levelRule(n) ? C.levelRule(n).k : '');
  ok(rs.slice(0, 10).every(r => !r), 'levels 1-10 use the plain table');
  ok(rs[12] === 'slick' && rs[14] === 'wide' && rs[16] === 'bouncy' && rs[92] === 'slick' && rs[96] === 'bouncy' && !rs[19] && !rs[99], 'from level 11: 3rd slick, 5th wide goals, 7th bouncy walls in every ten');
  ok(rs.filter(Boolean).length === 27, 'three varied tables in each block of ten from level 11 (27 total)');
  const M = C.newMatch(15, {}); C.applyGeom(M); const g = C.geom();
  ok(g.GX1 - g.GX0 === 120 + 2 * C.RULES.wide.gw, 'wide-goal level has wider goals (' + (g.GX1 - g.GX0) + ')');
  const glide = n => { const M = C.newMatch(n, { seed: 1 }); M.freeze = 0; M.m[0].x = 30; M.m[1].x = 330; M.m[1].tx = 330; M.puck.x = 180; M.puck.y = 320; M.puck.vx = 0; M.puck.vy = 0; M.puck.vx = 400; step(M, 1); return Math.abs(M.puck.vx); };
  ok(glide(13) > glide(12) * 1.2, 'slick ice keeps the puck faster than normal ice (' + Math.round(glide(13)) + ' vs ' + Math.round(glide(12)) + ')');
  const two = C.newMatch(50, { mode: 'two', N: 5 }), demo = C.newMatch(64, { mode: 'demo', N: 99 });
  ok(!two.rule && !demo.rule && C.newMatch(1, {}).rule === '', 'two-player and demo matches use the plain table');
}
// ---------- overtime: long matches end ----------
{
  ok(C.otWiden(C.OT_T - 1) === 0 && C.otWiden(C.OT_T) > 0 && C.otWiden(1e4) === C.OT_MAX, 'goals widen only after ' + C.OT_T + ' s, capped at +' + C.OT_MAX);
  let prev = 0, mono = true; for (let t = 0; t < 600; t += 5) { const w = C.otWiden(t); if (w < prev) mono = false; prev = w; } ok(mono, 'overtime widening never shrinks');
  const M = C.newMatch(100, { seed: 2 }); M.t = C.OT_T - 0.5; let ot = 0;
  for (let i = 0; i < 120; i++) { C.stepMatch(M, 1 / 60); for (const e of M.ev) if (e.t === 'ot') ot++; M.ev.length = 0; }
  ok(ot === 1 && C.geom().GX0 < 120, 'one overtime event when the goals first widen; physics uses the wider goal');
  const lens = [];
  for (const n of [75, 100]) for (let g = 0; g < 3; g++) {
    const M2 = C.newMatch(n, { seed: 40 + g }), plan = makeBot(g * 31 + 7), hist = []; let t = 0, fx = M2.m[1].x, fy = M2.m[1].y, tgt = { x: fx, y: fy };
    while (!M2.over && t < 900) {
      const p = M2.puck; hist.push({ t, px: p.x, py: p.y, pvx: p.vx, pvy: p.vy, on: p.on, freeze: M2.freeze, mx: M2.m[1].x, my: M2.m[1].y, ox: M2.m[0].x, oy: M2.m[0].y });
      while (hist.length > 2 && hist[1].t <= t - 0.15) hist.shift();
      if (t >= 0.15) tgt = plan(hist[0], t);
      const dx = tgt.x - fx, dy = tgt.y - fy, d = Math.hypot(dx, dy), s = 2600 / 60; if (d <= s) { fx = tgt.x; fy = tgt.y; } else { fx += dx / d * s; fy += dy / d * s; }
      M2.m[1].tx = fx; M2.m[1].ty = fy; C.stepMatch(M2, 1 / 60); M2.ev.length = 0; t += 1 / 60;
    }
    lens.push(Math.round(t));
  }
  ok(Math.max(...lens) < 480, 'late-level matches (75, 100) finish in under 8 minutes of game time: ' + lens.join(', ') + ' s');
}
// ---------- scores, difficulty, restore ----------
{
  ok(C.targetScore(1) === 3 && C.targetScore(30) === 3 && C.targetScore(31) === 5 && C.targetScore(70) === 5 && C.targetScore(71) === 6 && C.targetScore(100) === 6, 'first to 3 / 5 / 6');
  let prev = 0, mono = true; for (let n = 1; n <= 100; n++) { const d = C.difficulty(n); if (d <= prev) mono = false; prev = d; } ok(mono, 'difficulty strictly increases');
  const M = C.newMatch(12, { score: [1, 2], serve: 0 });
  ok(M.score[0] === 1 && M.score[1] === 2 && !M.puck.on && M.freeze > 0, 'a restored match keeps its score and starts with a serve');
  let served = null; for (let i = 0; i < 120 && served === null; i++) { C.stepMatch(M, 1 / 60); for (const e of M.ev) if (e.t === 'serve') served = e.s; M.ev.length = 0; }
  ok(served === 0 && M.puck.y < 320, 'the restored match serves to the side that conceded last');
}
console.log('core:', pass, 'passed,', fail, 'failed');

if (process.argv.includes('--core')) { if (fail) process.exit(1); return; }

// ---------------- browser ----------------
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
async function tap(cdp, page, sel, after = 350) { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await T(cdp, 'touchStart', [{ x: b.x + b.width / 2, y: b.y + b.height / 2, id: 9 }]); await sleep(50); await T(cdp, 'touchEnd', []); await sleep(after); }
const st = page => page.evaluate(() => window.__game.state());
(async () => {
  const browser = await chromium.launch(), errors = [];
  async function open(w, h, scheme, keep) {
    const ctx = keep || await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme || 'dark' });
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('file://' + APP); await sleep(500); return { ctx, page, cdp: await ctx.newCDPSession(page) };
  }
  async function toLevel(o, n) {
    await tap(o.cdp, o.page, '#tSelect', 500);
    if ((await o.page.getAttribute('#unlockSw', 'aria-checked')) !== 'true') await tap(o.cdp, o.page, '#unlockSw', 300);
    await tap(o.cdp, o.page, '.lt[data-n="' + n + '"]', 600); await tap(o.cdp, o.page, '#vGo', 300);
  }
  try {
    // tutorial + top-half hint + multi-touch
    {
      const o = await open(390, 844); const { page, cdp } = o;
      const panel = await page.evaluate(() => getComputedStyle(document.querySelector('.tbtns')).backgroundColor);
      ok(panel && !/rgba\(0, 0, 0, 0\)|transparent/.test(panel), 'title buttons sit on a solid panel over the demo match (' + panel + ')');
      ok(await page.isHidden('#tCont'), 'no "continue" button without a saved match');
      await tap(cdp, page, '#tPlay', 500); await tap(cdp, page, '#vGo', 300);
      ok((await st(page)).tut === true, 'first level-1 match shows the drag tutorial');
      const L = await page.evaluate(() => window.__game.layout()), S = (x, y) => ({ x: L.ox + x * L.s, y: L.oy + y * L.s });
      let p = S(180, 150); await T(cdp, 'touchStart', [{ x: p.x, y: p.y, id: 1 }]); await sleep(60); await T(cdp, 'touchEnd', []); await sleep(150);
      const t1 = await page.evaluate(() => [document.querySelector('#toast').textContent, !document.querySelector('#toast').classList.contains('hidden')]);
      ok(t1[1] && /下半場/.test(t1[0]), 'tapping the top half in single play says only the lower half works (' + t1[0] + ')');
      // multi-touch: finger 1 holds lower-left, finger 2 lands lower-right -> mallet target stays with finger 1
      await sleep(1500);
      const a = S(80, 560), b = S(290, 560);
      await T(cdp, 'touchStart', [{ x: a.x, y: a.y, id: 1 }]); await sleep(80);
      await T(cdp, 'touchStart', [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }]); await sleep(80);
      await T(cdp, 'touchMove', [{ x: a.x, y: a.y, id: 1 }, { x: b.x + 10, y: b.y, id: 2 }]); await sleep(80);
      let s1 = await st(page);
      ok(Math.abs(s1.tx - 80) < 2, 'a second finger in the same half does not steal the mallet (target x ' + s1.tx.toFixed(1) + ')');
      await T(cdp, 'touchEnd', [{ x: a.x, y: a.y, id: 1 }]); await sleep(60);
      // first finger lifts: the drag tutorial ends after real dragging
      for (let k = 0; k < 24; k++) { const q = S(60 + (k % 2) * 240, 520 + (k % 3) * 30); await T(cdp, k ? 'touchMove' : 'touchStart', [{ x: q.x, y: q.y, id: 3 }]); await sleep(40); }
      await T(cdp, 'touchEnd', []); await sleep(200);
      ok((await st(page)).tut === false && await page.evaluate(() => localStorage.getItem('hockey.tut')) === '1', 'the tutorial goes away after dragging and is remembered');
      // mid-match save and resume
      await page.evaluate(() => window.__game.shoot(1)); await sleep(1600);
      const before = await st(page);
      ok(before.score[1] === 1, 'player goal counted (' + before.score + ')');
      await page.reload(); await sleep(700);
      const cont = await page.textContent('#tCont');
      ok(await page.isVisible('#tCont') && /第 1 關/.test(cont) && /1 : 0/.test(cont), 'after a reload the title offers to continue the match (' + cont + ')');
      await tap(cdp, page, '#tCont', 400);
      const after = await st(page);
      ok(after.scene === 'play' && after.level === 1 && after.score[0] === 0 && after.score[1] === 1 && after.tut === false, 'continuing restores level and score (' + after.score + ')');
      await tap(cdp, page, '#bPause', 300); await tap(cdp, page, '#pQuit', 400);
      await page.reload(); await sleep(600);
      ok(await page.isHidden('#tCont'), 'leaving the match clears the saved match');
      // score box fades while the puck passes under it
      await toLevel(o, 2); await sleep(1700);
      const alphaAt = (x, y) => page.evaluate(([x, y]) => new Promise(r => { let n = 0; const iv = setInterval(() => { window.__game.place(x, y, 0, 0); if (++n > 25) { clearInterval(iv); r(window.__game.state().scoreAlpha); } }, 16); }), [x, y]);
      const under = await alphaAt(24, 330), away = await alphaAt(200, 520);
      ok(under < 0.5 && away > 0.9, 'score boxes fade while the puck is under them (' + under.toFixed(2) + ') and come back (' + away.toFixed(2) + ')');
      await o.ctx.close();
    }
    // round 2: a win survives a reload right after the winning goal
    {
      const o = await open(390, 844); const { page, cdp } = o;
      await tap(cdp, page, '#tPlay', 500); await tap(cdp, page, '#vGo', 300);
      for (let g = 0; g < 3; g++) {
        for (let k = 0; k < 200 && !(await page.evaluate(() => window.__game.shoot(1))); k++) await sleep(30);
        for (let k = 0; k < 200 && (await st(page)).score[1] === g; k++) await sleep(10);
      }
      const end = await st(page);
      await page.reload(); await sleep(500);
      const saved = await page.evaluate(() => ({ p: localStorage.getItem('hockey.progress'), s: localStorage.getItem('hockey.stars'), st: JSON.parse(localStorage.getItem('hockey.stats') || '{}'), m: localStorage.getItem('hockey.match') }));
      ok(end.over && end.scene === 'play' && saved.p === '1' && /"1":3/.test(saved.s) && saved.st.wins === 1 && saved.st.matches === 1 && !saved.m,
        'reloading right after the winning goal (before the result screen) keeps progress, stars and stats (' + JSON.stringify(saved) + ')');
      await o.ctx.close();
    }
    // round 2: leaving the page during the slow motion before a goal cannot cancel that goal
    {
      const o = await open(390, 844); const { page, cdp } = o;
      await toLevel(o, 2);
      const L = await page.evaluate(() => window.__game.layout()), q = { x: L.ox + 60 * L.s, y: L.oy + (430 + L.offset) * L.s };
      await T(cdp, 'touchStart', [{ x: q.x, y: q.y, id: 4 }]);
      for (let k = 0; k < 200 && (await st(page)).freeze > 0; k++) await sleep(20);
      await sleep(300);
      const r = await page.evaluate(() => { window.__game.place(200, 540, 0, 1100); const bound = window.__game.state().score.slice(); window.dispatchEvent(new Event('pagehide')); return { before: bound, after: window.__game.state().score, saved: JSON.parse(localStorage.getItem('hockey.match') || 'null') }; });
      await T(cdp, 'touchEnd', []);
      ok(r.before[0] === 0 && r.after[0] === 1 && r.saved && r.saved.score[0] === 1 && r.saved.serve === 1,
        'a goal already in slow motion is counted before the save on page leave (' + JSON.stringify(r) + ')');
      // round 2: starting another match while one is saved asks first
      await page.reload(); await sleep(500);
      await tap(cdp, page, '#tPlay', 400);
      const msg = await page.textContent('#cfMsg');
      ok(await page.isVisible('#confirm') && msg === '放棄第 2 關 0:1？', '開始挑戰 with a saved match asks first (' + msg + ')');
      await tap(cdp, page, '#cfNo', 400);
      ok(await page.isVisible('#tCont') && (await page.evaluate(() => localStorage.getItem('hockey.match'))) !== null, 'cancel keeps the saved match');
      await tap(cdp, page, '#tSelect', 500); await tap(cdp, page, '.lt[data-n="3"]', 400);
      ok(await page.isVisible('#confirm'), 'picking a level with a saved match asks first');
      await tap(cdp, page, '#cfYes', 500);
      ok(await page.isVisible('#vs') && /第 3 關/.test(await page.textContent('#vLv')) && (await page.evaluate(() => localStorage.getItem('hockey.match'))) === null, 'confirming drops the saved match and opens the chosen level');
      await o.ctx.close();
    }
    // two-player hints are drawn on the table for both players, not as a toast over the top goal
    {
      const o = await open(390, 844); await tap(o.cdp, o.page, '#tTwo', 400);
      ok(await o.page.isHidden('#toast'), 'two-player start shows no single toast over the top goal');
      await o.ctx.close();
    }
    // landscape HUD
    for (const [w, h] of [[844, 390], [640, 360]]) {
      const o = await open(w, h, 'light'); await toLevel(o, 37); await sleep(400);
      const r = await o.page.evaluate(() => { const s = document.querySelector('#hSub'), m = document.querySelector('#bMute').getBoundingClientRect(), L = window.__game.layout(); return { sw: s.scrollWidth, cw: s.clientWidth, txt: s.textContent, muteR: m.right, tableL: L.ox - 12 * L.s, w: document.documentElement.scrollWidth }; });
      ok(r.sw <= r.cw + 1 && /先得 5 分/.test(r.txt), w + 'x' + h + ': level line is shown in full (' + r.txt + ')');
      ok(r.muteR <= r.tableL, w + 'x' + h + ': HUD stays clear of the table (mute right ' + Math.round(r.muteR) + ' <= table ' + Math.round(r.tableL) + ')');
      ok(r.w <= w, w + 'x' + h + ': no horizontal scroll');
      await o.ctx.close();
    }
    ok(errors.length === 0, 'no page or console errors: ' + errors.join(' | '));
  } finally { await browser.close(); }
  console.log('air-hockey tests:', pass, 'passed,', fail, 'failed');
  if (fail) process.exit(1);
})();
