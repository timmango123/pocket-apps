// Verification for 自訂拼圖 (photo-jigsaw).
// Plays a real 12-piece puzzle with touch drags from the tray (CDP touch events), checks snapping, groups, rotation mode,
// save/continue, photo upload, scatter/zoom/ghost/edge buttons, at 390x844 and the three in-lobby iframe sizes, light and dark.
// Writes cover-390x520.png (a 48-piece puzzle half done) and a few screenshots.
// Usage: node verify.js
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const APP = 'file://' + path.resolve(__dirname, '..', 'index.html');
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function check(c, msg) { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); }

async function touchDrag(cdp, pts, stepMs = 16) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0][0], y: pts[0][1] }] });
  for (let i = 1; i < pts.length; i++) { await sleep(stepMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); }
  await sleep(30);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tap(cdp, x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
async function tapSel(cdp, page, sel, wait = 150) { await page.locator(sel).scrollIntoViewIfNeeded(); const b = await page.locator(sel).boundingBox(); await tap(cdp, b.x + b.width / 2, b.y + b.height / 2); await sleep(wait); }
function line(a, b, n) { const out = []; for (let i = 0; i <= n; i++) out.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return out; }

// Drag piece `id` out of the tray and drop its centre at target(tid) + (dx,dy) (page coordinates, read after the pull-out
// because the camera may nudge while the piece leaves the tray). Returns the destination, or null if the piece was not in the tray.
async function dragFromTray(page, cdp, id, tid, dx, dy) {
  const el = page.locator('.tp[data-id="' + id + '"]');
  if (!(await el.count())) return null;
  await el.scrollIntoViewIfNeeded(); await sleep(80);
  const b = await el.boundingBox(); const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
  const side = await page.evaluate(() => matchMedia('(orientation:landscape) and (max-height:560px)').matches);
  const px = side ? sx - 60 : sx, py = side ? sy : sy - 60;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
  for (const p of line([sx, sy], [px, py], 5)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
  await sleep(30);
  const ps = await page.evaluate(id => window.__game.pieceScreen(id), id);
  if (!ps) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return null; }
  const t = await page.evaluate(id => window.__game.target(id), tid), tx = t.x + dx, ty = t.y + dy;
  const fx = px + (tx - ps.x), fy = py + (ty - ps.y);
  for (const p of line([px, py], [fx, fy], 12)) { await sleep(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p[0], y: p[1] }] }); }
  await sleep(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(120);
  return { x: tx, y: ty };
}

async function newPage(browser, w, h, dark) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(APP); await sleep(500);
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, errors };
}

async function fullPlay(browser) {
  console.log('--- full play at 390x844 (light) ---');
  const { ctx, page, cdp, errors } = await newPage(browser, 390, 844, false);
  await page.screenshot({ path: path.join(OUT, 'title-390x844.png') });
  check(await page.isVisible('#title') && (await page.locator('.gt').count()) === 11 && (await page.locator('.gt[data-id="daily"] .day').count()) === 1, 'title screen shows 9 built-in pictures + the daily picture + photo tile');
  check((await page.textContent('#prevTag')).includes('= 30 片') && await page.evaluate(() => { const c = document.getElementById('prevCv'), d = c.getContext('2d').getImageData(320, 240, 1, 1).data; return d[3] > 0; }), 'title preview shows the picture with the real cut (6 × 5 = 30 片)');
  await tapSel(cdp, page, '.chip[data-n="12"]');
  await tapSel(cdp, page, '.gt[data-id="bay"]');
  await tapSel(cdp, page, '#bStart'); await sleep(500);
  let st = await page.evaluate(() => window.__game.state());
  check(st && st.count === 12 && st.tray === 12 && !st.rotMode, '12-piece puzzle starts with all pieces in the tray');
  // drop piece 0 roughly next to the board but not on it: should stay loose
  const far = await dragFromTray(page, cdp, 0, 0, 10, -80);
  check(far, 'piece 0 pulled out of the tray');
  let ps = await page.evaluate(() => window.__game.pieceScreen(0));
  check(ps && !ps.locked && Math.abs(ps.x - far.x) < 6 && Math.abs(ps.y - far.y) < 6, 'piece dropped away from its slot stays loose where dropped');
  // piece 1 dropped near piece 0 at the right relative offset: joins into a group of 2
  await dragFromTray(page, cdp, 1, 1, 15, -76);
  ps = await page.evaluate(() => window.__game.pieceScreen(1));
  check(ps && ps.n === 2 && !ps.locked, 'neighbour dropped close by snaps into a 2-piece group');
  // drag the group (by piece 0) onto the board: both lock
  ps = await page.evaluate(() => window.__game.pieceScreen(0));
  const t0 = await page.evaluate(() => window.__game.target(0));
  await touchDrag(cdp, line([ps.x, ps.y], [t0.x + 6, t0.y - 5], 14));
  await sleep(150);
  st = await page.evaluate(() => window.__game.state());
  check(st.locked === 2, 'group dragged onto the board locks both pieces (' + st.locked + ')');
  // wrong spot on the board: should not lock
  await dragFromTray(page, cdp, 5, 6, 0, 0);
  ps = await page.evaluate(() => window.__game.pieceScreen(5));
  check(ps && !ps.locked, 'piece dropped on the wrong cell does not lock');
  const t5 = await page.evaluate(() => window.__game.target(5));
  await touchDrag(cdp, line([ps.x, ps.y], [t5.x + 3, t5.y + 3], 10)); await sleep(120);
  ps = await page.evaluate(() => window.__game.pieceScreen(5));
  check(ps && ps.locked, 'moved to its own cell it locks');
  { const c0 = (await page.evaluate(() => window.__game.state())).cam; const p5 = await page.evaluate(() => window.__game.pieceScreen(5)); await touchDrag(cdp, line([p5.x, p5.y], [p5.x + 40, p5.y + 30], 8)); const c1 = (await page.evaluate(() => window.__game.state())).cam; const p5b = await page.evaluate(() => window.__game.pieceScreen(5)); check(p5b.locked && (Math.abs(c1.tx - c0.tx - 40) < 3 || Math.abs(c1.ty - c0.ty - 30) < 3) && Math.abs(p5b.x - p5.x - (c1.tx - c0.tx)) < 2, 'dragging on a locked piece pans the table instead of moving it (axis that has room)'); await touchDrag(cdp, line([p5b.x, p5b.y], [p5b.x - 40, p5b.y - 30], 8)); }
  // rapid alternating taps (8/s) on two chips later on the title; here: 8 quick ghost toggles must all register
  for (let i = 0; i < 8; i++) { await tapSel(cdp, page, i % 2 ? '#bEdge' : '#bGhost', 65); }
  check((await page.getAttribute('#bGhost', 'aria-pressed')) === 'false' && (await page.getAttribute('#bEdge', 'aria-pressed')) === 'false', '8 rapid alternating taps on two HUD toggles all register (4+4 → both back off)');
  // a diagonal pull (about 50° from horizontal) still brings the piece out, and no gesture is left hanging afterwards
  {
    const it = (await page.evaluate(() => window.__game.trayInfo())).find(t => t.box && !t.box.cut && t.box.x > 150);
    const a = [it.box.x + it.box.w / 2, it.box.y + it.box.h / 2], e = [a[0] - 250, a[1] - 300];
    await touchDrag(cdp, line(a, e, 12)); await sleep(150);
    const q = await page.evaluate(id => window.__game.pieceScreen(id), it.id), d = await page.evaluate(() => window.__game.dbg());
    check(q && !d.drag && !d.pan && d.pointers.length === 0, 'diagonal pull from the tray brings the piece out and ends cleanly');
    // grab that lands just outside the piece still picks it up (forgiving touch); the table must not pan instead
    const v = await page.evaluate(() => window.__game.view()), c0 = (await page.evaluate(() => window.__game.state())).cam;
    const gx = q.x + v.cellW * 0.5 + 9, gy = q.y;
    const hitBefore = await page.evaluate(a => window.__game.hitAt(a[0], a[1]), [gx, gy]);
    await touchDrag(cdp, line([gx, gy], [gx + 30, gy + 20], 8)); await sleep(120);
    const q2 = await page.evaluate(id => window.__game.pieceScreen(id), it.id), c1 = (await page.evaluate(() => window.__game.state())).cam;
    check((hitBefore === null || hitBefore.id !== it.id) ? Math.abs(q2.x - q.x - 30) < 3 && Math.abs(c1.tx - c0.tx) < 0.5 : true, 'touch a few px outside a loose piece grabs that piece, the table stays put');
    // drop it under the zoom buttons: it slides out so it can be picked up again
    const zb = await page.locator('#bZoomOut').boundingBox();
    await touchDrag(cdp, line([q2.x, q2.y], [zb.x + zb.width / 2, zb.y + zb.height / 2], 10)); await sleep(120);
    const q3 = await page.evaluate(id => window.__game.pieceScreen(id), it.id);
    const top = await page.evaluate(a => { const el = document.elementFromPoint(a[0], a[1]); return el && el.id; }, [q3.x, q3.y]);
    check(q3 && top === 'cv', 'piece dropped under a floating button is moved clear of it (' + top + ')');
    // drop it hanging off the left edge of the screen: it stays fully on screen
    await touchDrag(cdp, line([q3.x, q3.y], [2, q3.y - 120], 10)); await sleep(120);
    const q4 = await page.evaluate(id => window.__game.pieceScreen(id), it.id), v4 = await page.evaluate(() => window.__game.view());
    check(q4 && q4.x - v4.cellW / 2 >= v4.left - 1, 'piece dropped off the screen edge is kept on screen');
    // horizontal swipe that starts on a tray piece scrolls the tray (with momentum) and pulls nothing out
    const n0 = (await page.evaluate(() => window.__game.trayIds())).length, it2 = (await page.evaluate(() => window.__game.trayInfo())).find(t => t.box && !t.box.cut && t.box.x > 200);
    await touchDrag(cdp, line([it2.box.x + 40, it2.box.y + 40], [it2.box.x - 150, it2.box.y + 46], 8)); await sleep(400);
    const sl = await page.evaluate(() => document.getElementById('trayScroll').scrollLeft), n1 = (await page.evaluate(() => window.__game.trayIds())).length;
    check(sl > 120 && n1 === n0, 'sideways swipe on a tray piece scrolls the tray (' + Math.round(sl) + 'px) without pulling a piece');
    await touchDrag(cdp, line([200, it2.box.y + 40], [380, it2.box.y + 40], 8)); await sleep(500);
    // a shallow pull (about 22° above horizontal) still takes the piece out once the finger leaves the tray
    { const it3 = (await page.evaluate(() => window.__game.trayInfo())).find(t => t.box && !t.box.cut && t.box.x > 200); const a3 = [it3.box.x + it3.box.w / 2, it3.box.y + it3.box.h / 2];
      await touchDrag(cdp, line(a3, [a3[0] - 260, a3[1] - 105], 14)); await sleep(150);
      const q5 = await page.evaluate(id => window.__game.pieceScreen(id), it3.id);
      check(!!q5, 'shallow 22° pull from the tray still brings the piece out');
      if (q5 && !q5.locked) { const t5 = await page.evaluate(id => window.__game.target(id), it3.id); await touchDrag(cdp, line([q5.x, q5.y], [t5.x, t5.y], 12)); await sleep(150); } }
    // put it back where it belongs so the rest of the run is unchanged
    const t4 = await page.evaluate(id => window.__game.target(id), it.id);
    await touchDrag(cdp, line([q4.x, q4.y], [t4.x, t4.y], 12)); await sleep(150);
  }
  // toggle ghost + edge filter
  await tapSel(cdp, page, '#bGhost'); check((await page.getAttribute('#bGhost', 'aria-pressed')) === 'true', 'ghost preview toggles on');
  await tapSel(cdp, page, '#bEdge'); check((await page.getAttribute('#bEdge', 'aria-pressed')) === 'true' && (await page.evaluate(() => [...document.querySelectorAll('.tp')].filter(e => getComputedStyle(e).display !== 'none').every(e => e.classList.contains('edge')))), 'edge filter hides inner pieces in the tray');
  await tapSel(cdp, page, '#bEdge');
  // zoom in/out
  const s0 = (await page.evaluate(() => window.__game.state())).cam.s;
  await tapSel(cdp, page, '#bZoomIn'); const s1 = (await page.evaluate(() => window.__game.state())).cam.s;
  await tapSel(cdp, page, '#bZoomOut'); const s2 = (await page.evaluate(() => window.__game.state())).cam.s;
  check(s1 > s0 * 1.2 && Math.abs(s2 - s0) < 1e-6, 'zoom buttons zoom in and back out');
  await page.screenshot({ path: path.join(OUT, 'play-390x844.png') });
  // save + continue: reload the page mid-game
  await page.evaluate(() => window.__game.save());
  const before = await page.evaluate(() => window.__game.state());
  await page.reload(); await sleep(600);
  check(await page.isVisible('#contSec'), 'after reload the title offers 繼續上次');
  const cdp2 = await ctx.newCDPSession(page);
  await tapSel(cdp2, page, '#bContinue'); await sleep(400);
  const after = await page.evaluate(() => window.__game.state());
  check(after && after.count === 12 && after.locked === before.locked && after.groups === before.groups && after.elapsed >= before.elapsed - 50, 'continue restores locked count, groups and timer');
  // finish the puzzle: drag every remaining piece to its slot
  for (let id = 0; id < 12; id++) {
    const s = await page.evaluate(() => window.__game.state()); if (s.won) break;
    const inTray = await dragFromTray(page, cdp2, id, id, 4, -3);
    if (!inTray) { const t = await page.evaluate(id => window.__game.target(id), id); const p = await page.evaluate(id => window.__game.pieceScreen(id), id); if (p && !p.locked) { await touchDrag(cdp2, line([p.x, p.y], [t.x + 3, t.y + 2], 10)); await sleep(120); } }
  }
  await sleep(1800);
  st = await page.evaluate(() => window.__game.state());
  check(st.won && st.locked === 12 && await page.isVisible('#win'), 'all 12 pieces placed: puzzle completes and the win card shows');
  check(await page.evaluate(() => !localStorage.getItem('photo-jigsaw:v1:save') && !!localStorage.getItem('photo-jigsaw:v1:best')), 'finished puzzle clears the save and records a best time');
  await page.screenshot({ path: path.join(OUT, 'win-390x844.png'), timeout: 120000 });
  // play again from the win card
  await tapSel(cdp2, page, '#wAgain'); await sleep(300);
  st = await page.evaluate(() => window.__game.state());
  check(st && !st.won && st.tray === 12, '再拼一次 reshuffles the same picture');
  // rotation mode via the API
  await page.evaluate(() => window.__game.start('mosaic', 12, true)); await sleep(300);
  st = await page.evaluate(() => window.__game.state()); check(st.rotMode, 'rotation mode puzzle started');
  const ids = await page.evaluate(() => window.__game.trayIds());
  const rid = ids[0], other = (rid + 2) % 12;   // drop on a wrong cell so it stays loose and on screen
  await dragFromTray(page, cdp2, rid, other, 0, 0);
  let rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  const rot0 = rp.rot; await tap(cdp2, rp.x, rp.y); await sleep(150);
  rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  console.log('DBG rot', rot0, rp, await page.evaluate(() => window.__game.dbg())); check(rp.rot === (rot0 + 1) % 4, 'tapping a piece in rotation mode turns it 90°');
  while (rp.rot !== 0) { await tap(cdp2, rp.x, rp.y); await sleep(150); rp = await page.evaluate(id => window.__game.pieceScreen(id), rid); }
  const tr = await page.evaluate(id => window.__game.target(id), rid);
  await touchDrag(cdp2, line([rp.x, rp.y], [tr.x + 3, tr.y + 2], 10)); await sleep(150);
  rp = await page.evaluate(id => window.__game.pieceScreen(id), rid);
  check(rp.locked, 'rotated back to upright it locks into the board');
  // scatter
  await tapSel(cdp2, page, '#bScatter'); st = await page.evaluate(() => window.__game.state());
  check(st.tray === 0 || st.tray < 11, 'scatter button moves tray pieces onto the table (tray now ' + st.tray + ')');
  // pause / menu
  await tapSel(cdp2, page, '#bMenu'); check(await page.isVisible('#pause'), 'menu opens the pause card');
  await tapSel(cdp2, page, '#pQuit'); check(await page.isVisible('#title'), '回到首頁 returns to the title');
  // photo upload: make an image file with the page itself, then pick it
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 900; c.height = 1400; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 900, 1400); gr.addColorStop(0, '#f94144'); gr.addColorStop(0.5, '#f9c74f'); gr.addColorStop(1, '#577590'); g.fillStyle = gr; g.fillRect(0, 0, 900, 1400); for (let i = 0; i < 300; i++) { g.fillStyle = `hsl(${i * 7 % 360} 80% ${30 + i % 50}%)`; g.beginPath(); g.arc(Math.random() * 900, Math.random() * 1400, 10 + Math.random() * 60, 0, 7); g.fill(); } return c.toDataURL('image/png'); });
  const photo = path.join(OUT, 'sample-photo.png'); fs.writeFileSync(photo, Buffer.from(png.split(',')[1], 'base64'));
  await page.setInputFiles('#fileInput', photo); await sleep(800);
  check((await page.getAttribute('#gtPhoto', 'aria-pressed')) === 'true' && (await page.textContent('#gtPhoto')).includes('我的照片'), 'photo picked: tile shows 我的照片 and is selected');
  await tapSel(cdp2, page, '.chip[data-n="20"]'); await tapSel(cdp2, page, '#bStart'); await sleep(500);
  st = await page.evaluate(() => window.__game.state());
  check(st && st.rows > st.cols && st.count >= 16 && st.count <= 24, 'portrait photo puzzle uses more rows than columns (' + st.cols + 'x' + st.rows + ')');
  await page.evaluate(() => window.__game.save());
  await page.reload(); await sleep(900);
  check(await page.isVisible('#contSec') && (await page.textContent('#contName')).includes('我的照片'), 'photo puzzle restores after reload (photo kept in IndexedDB)');
  await page.screenshot({ path: path.join(OUT, 'photo-390x844.png') });
  check(errors.length === 0, 'no page errors during full play' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

// release-review fixes: overlapping two-thumb taps, tray tap while a table piece is held, long press on the tray,
// pause mid-drag, turning the phone, coach bubble vs buttons, hint toast vs board, photo swap vs save, long panoramas, daily picture
async function fixes(browser) {
  console.log('--- review fixes ---');
  const { ctx, page, cdp, errors } = await newPage(browser, 390, 844, false);
  // count every 90° turn (the game vibrates 6 ms once per turn) and log each touch's down/up time and travel, so the test
  // can tell what the game should have done even when a loaded machine stretches the touches
  await page.evaluate(() => { window.__rot = 0; navigator.vibrate = p => { if (p === 6) window.__rot++; return true; }; window.__pt = {};
    addEventListener('pointerdown', e => { window.__pt[e.pointerId] = { t0: performance.now(), x: e.clientX, y: e.clientY, mv: 0 }; }, true);
    addEventListener('pointermove', e => { const q = window.__pt[e.pointerId]; if (q) q.mv = Math.max(q.mv, Math.hypot(e.clientX - q.x, e.clientY - q.y)); }, true);
    addEventListener('pointerup', e => { const q = window.__pt[e.pointerId]; if (q) q.t1 = performance.now(); }, true); });
  const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await page.evaluate(() => window.__game.start('bay', 30, true, 7)); await sleep(500);
  await page.evaluate(() => window.__game.scatter()); await sleep(250);
  const loose = await page.evaluate(() => { const o = []; for (let id = 0; id < 30; id++) { const q = window.__game.pieceScreen(id); if (q && !q.locked) o.push(Object.assign({ id }, q)); } return o; });
  const A = loose[0], B = loose.find(q => Math.hypot(q.x - A.x, q.y - A.y) > 120);
  // two thumbs alternating at 8/s, the next one landing 30 ms before the previous lifts (CDP touchEnd lists the lifted point)
  {
    await page.evaluate(() => { window.__rot = 0; window.__pt = {}; });
    const f = [{ x: A.x, y: A.y, id: 1 }, { x: B.x, y: B.y, id: 2 }];
    await T('touchStart', [f[0]]); await sleep(95);
    for (let i = 1; i < 12; i++) { const cur = f[i % 2], prev = f[(i + 1) % 2]; await T('touchStart', [prev, cur]); await sleep(30); await T('touchEnd', [prev]); await sleep(95); }
    await T('touchEnd', [f[1]]); await sleep(300);
    const n = await page.evaluate(() => window.__rot), d = await page.evaluate(() => window.__game.dbg()), cam = await page.evaluate(() => window.__game.state().cam);
    // every one of these touches overlapped the other thumb, so each is a tap if it lasted < 700 ms (what a loaded machine may stretch)
    const exp = await page.evaluate(() => Object.values(window.__pt).filter(q => q.t1 && q.t1 - q.t0 < 700 && q.mv <= 8).length);
    check(n === exp && exp >= 8 && !d.drag && !d.pan && !d.pinch && d.pointers.length === 0, 'overlapping two-thumb taps (30 ms overlap): ' + n + ' turns for ' + exp + ' taps' + (exp < 12 ? ' (' + (12 - exp) + ' held > 700 ms by machine load)' : '') + ', no pinch, nothing left hanging');
    check(Math.abs(cam.s - cam.fit) < 1e-6, 'overlapping taps never zoom the table');
  }
  // a real pinch still zooms: second finger lands, both move apart
  {
    const c0 = (await page.evaluate(() => window.__game.state())).cam.s;
    await T('touchStart', [{ x: 150, y: 330, id: 1 }]); await sleep(40); await T('touchStart', [{ x: 150, y: 330, id: 1 }, { x: 240, y: 330, id: 2 }]);
    for (let i = 1; i <= 8; i++) { await sleep(16); await T('touchMove', [{ x: 150 - i * 8, y: 330, id: 1 }, { x: 240 + i * 8, y: 330, id: 2 }]); }
    await T('touchEnd', [{ x: 240 + 64, y: 330, id: 2 }]); await sleep(30); await T('touchEnd', [{ x: 150 - 64, y: 330, id: 1 }]); await sleep(150);
    const c1 = (await page.evaluate(() => window.__game.state())).cam.s;
    check(c1 > c0 * 1.3, 'two fingers moving apart still pinch-zoom (' + (c1 / c0).toFixed(2) + 'x)');
    await tapSel(cdp, page, '#bZoomOut'); await tapSel(cdp, page, '#bZoomOut'); await tapSel(cdp, page, '#bZoomOut');
  }
  // tray tap with the other thumb while a table piece is held
  {
    const q = await page.evaluate(id => window.__game.pieceScreen(id), A.id);
    const tr = (await page.evaluate(() => window.__game.trayInfo())).find(t => t.box && !t.box.cut);
    await T('touchStart', [{ x: q.x, y: q.y, id: 1 }]); await sleep(80);
    await T('touchStart', [{ x: q.x, y: q.y, id: 1 }, { x: tr.box.x + 40, y: tr.box.y + 40, id: 2 }]); await sleep(70);
    await T('touchEnd', [{ x: tr.box.x + 40, y: tr.box.y + 40, id: 2 }]); await sleep(900);
    await T('touchEnd', [{ x: q.x, y: q.y, id: 1 }]); await sleep(150);
    const r1 = (await page.evaluate(id => window.__game.trayInfo().find(t => t.id === id), tr.id)).rot, q1 = await page.evaluate(id => window.__game.pieceScreen(id), A.id);
    check(r1 === (tr.rot + 1) % 4, 'tray tap registers while the other thumb holds a table piece');
    check(q1.rot === q.rot, 'the table piece held for ~1 s is not turned');
  }
  // long press on a tray piece (1 s, no movement) turns nothing, like on the table
  {
    const tr = (await page.evaluate(() => window.__game.trayInfo())).find(t => t.box && !t.box.cut);
    await T('touchStart', [{ x: tr.box.x + 40, y: tr.box.y + 40 }]); await sleep(1000); await T('touchEnd', []); await sleep(150);
    const r1 = (await page.evaluate(id => window.__game.trayInfo().find(t => t.id === id), tr.id)).rot;
    check(r1 === tr.rot, 'long press on a tray piece does not turn it');
    let ok2 = false;
    for (let k = 0; k < 3 && !ok2; k++) { // retried only when machine load stretched the tap past 400 ms
      await page.evaluate(() => { window.__pt = {}; }); const r0 = (await page.evaluate(id => window.__game.trayInfo().find(t => t.id === id), tr.id)).rot;
      await tap(cdp, tr.box.x + 40, tr.box.y + 40); await sleep(200);
      const held = await page.evaluate(() => Object.values(window.__pt).map(q => q.t1 - q.t0)[0]);
      ok2 = (await page.evaluate(id => window.__game.trayInfo().find(t => t.id === id), tr.id)).rot === (r0 + 1) % 4;
      if (!ok2 && held < 400) break;
    }
    check(ok2, 'a short tap on a tray piece still turns it');
  }
  // opening the menu mid-drag ends the drag: the piece no longer follows the finger
  {
    const q = await page.evaluate(id => window.__game.pieceScreen(id), B.id);
    await T('touchStart', [{ x: q.x, y: q.y }]); for (let i = 1; i <= 4; i++) { await sleep(16); await T('touchMove', [{ x: q.x + i * 5, y: q.y }]); }
    await page.keyboard.press('Escape'); await sleep(100);
    const during = await page.evaluate(id => window.__game.pieceScreen(id), B.id);
    for (let i = 1; i <= 6; i++) { await sleep(16); await T('touchMove', [{ x: q.x + 20 + i * 15, y: q.y }]); } await T('touchEnd', []); await sleep(100);
    const after = await page.evaluate(id => window.__game.pieceScreen(id), B.id), d = await page.evaluate(() => window.__game.dbg());
    check(await page.isVisible('#pause') && Math.abs(after.x - during.x) < 1 && !d.drag, 'menu opened mid-drag ends the drag (piece stays put)');
    await tapSel(cdp, page, '#pResume');
  }
  // turning the phone: a loose piece parked above the board stays on screen
  {
    const v = await page.evaluate(() => window.__game.view()), q = await page.evaluate(id => window.__game.pieceScreen(id), A.id);
    await touchDrag(cdp, line([q.x, q.y], [v.left + v.width / 2, v.top + 40], 10)); await sleep(150);
    const fit0 = (await page.evaluate(() => window.__game.state())).cam.fit;
    await page.setViewportSize({ width: 844, height: 390 });
    for (let k = 0; k < 40 && (await page.evaluate(() => window.__game.state())).cam.fit === fit0; k++) await sleep(100); // wait for the resize event
    await sleep(200);
    const bad = await page.evaluate(() => { const v = window.__game.view(), s = window.__game.state(), out = []; for (let id = 0; id < s.count; id++) { const q = window.__game.pieceScreen(id); if (q && !q.locked && (q.x < v.left || q.x > v.left + v.width || q.y < v.top || q.y > v.top + v.height)) out.push(id); } return out; });
    check(bad.length === 0, 'after turning to 844x390 every loose piece is on screen' + (bad.length ? ' (off: ' + bad.join(',') + ')' : ''));
    await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  }
  // first-ever game: the coach bubble clears the zoom buttons; the zoom hint sits over the HUD timer, not the board
  for (const [w, h] of [[360, 640], [390, 844]]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    const p2 = await c2.newPage(); await p2.goto(APP); await sleep(400);
    await p2.evaluate(() => window.__game.start('garden', 99, false, 3)); await sleep(900);
    const r = await p2.evaluate(() => { const box = id => document.getElementById(id).getBoundingClientRect(), ov = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const c = box('coach'), t = box('toast'), v = window.__game.view(), hm = document.querySelector('.hmid').getBoundingClientRect();
      return { coachShown: c.width > 0, coachClear: ['bZoomIn', 'bZoomOut', 'bScatter'].every(id => !ov(c, box(id))), toastShown: !document.getElementById('toast').classList.contains('hidden'), toastInHud: t.top >= hm.top - 1 && t.bottom <= hm.bottom + 1, toastOffBoard: t.bottom <= v.top + 1 }; });
    check(r.coachShown && r.coachClear, `${w}x${h}: first-game coach bubble does not cover the zoom or scatter buttons`);
    check(r.toastShown && r.toastInHud && r.toastOffBoard, `${w}x${h}: zoom hint shows over the HUD timer, not over the board`);
    await c2.close();
  }
  // photo puzzle in progress, then another photo is picked: 繼續 still resumes the first photo with its own cut
  {
    const mk = (w, h, col) => page.evaluate(a => { const c = document.createElement('canvas'); c.width = a[0]; c.height = a[1]; const g = c.getContext('2d'); g.fillStyle = a[2]; g.fillRect(0, 0, a[0], a[1]); g.fillStyle = '#fff'; for (let i = 0; i < 40; i++) g.fillRect(i * 37 % a[0], i * 53 % a[1], 20, 20); return c.toDataURL('image/png'); }, [w, h, col]);
    const tall = path.join(OUT, 'tmp-tall.png'), wide = path.join(OUT, 'tmp-wide.png');
    fs.writeFileSync(tall, Buffer.from((await mk(300, 2400, '#2a9d8f')).split(',')[1], 'base64'));
    fs.writeFileSync(wide, Buffer.from((await mk(1200, 900, '#e76f51')).split(',')[1], 'base64'));
    await tapSel(cdp, page, '#bMenu'); await tapSel(cdp, page, '#pQuit');
    await page.setInputFiles('#fileInput', tall); await sleep(1200);
    const tile = await page.evaluate(() => { const c = document.querySelector('#gtPhoto canvas'); return !!c; });
    await tapSel(cdp, page, '.chip[data-n="99"]'); await tapSel(cdp, page, '#bStart'); await sleep(600);
    const st0 = await page.evaluate(() => window.__game.state()), v0 = await page.evaluate(() => window.__game.view());
    check(tile && st0.cols * 2.5 >= st0.rows * 0.9 && v0.cellW >= 24, '1:8 photo is cropped to the middle: 99 pieces are ' + st0.cols + 'x' + st0.rows + ', cells ' + v0.cellW.toFixed(0) + 'px');
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__game.place(i); window.__game.save(); });
    await tapSel(cdp, page, '#bMenu'); await tapSel(cdp, page, '#pQuit');
    await page.setInputFiles('#fileInput', wide); await sleep(1200);
    const cont = await page.evaluate(() => !document.getElementById('contSec').classList.contains('hidden') && document.getElementById('contName').textContent);
    check(cont && cont.startsWith('上一張照片'), '繼續 after picking a new photo names the earlier photo (' + cont + ')');
    await page.reload(); await sleep(1200);
    const cdp3 = await ctx.newCDPSession(page);
    await tapSel(cdp3, page, '#bContinue'); await sleep(600);
    const st1 = await page.evaluate(() => window.__game.state()), v1 = await page.evaluate(() => window.__game.view());
    check(st1 && st1.cols === st0.cols && st1.rows === st0.rows && st1.locked === 5 && Math.abs(v1.boardW / v1.boardH - v0.boardW / v0.boardH) < 0.01, 'after reload 繼續 restores the first photo puzzle with its own picture and 5 placed pieces');
    await tapSel(cdp3, page, '#bMenu'); await tapSel(cdp3, page, '#pQuit');
    await tapSel(cdp3, page, '.chip[data-n="12"]'); await tapSel(cdp3, page, '#gtPhoto'); await sleep(300);
    await tapSel(cdp3, page, '#bStart'); await sleep(500);
    const st2 = await page.evaluate(() => window.__game.state());
    check(st2 && st2.cols > st2.rows, 'starting a puzzle now uses the new (landscape) photo');
    fs.unlinkSync(tall); fs.unlinkSync(wide);
    // daily picture: selectable and playable
    await tapSel(cdp3, page, '#bMenu'); await tapSel(cdp3, page, '#pQuit');
    await tapSel(cdp3, page, '.gt[data-id="daily"]'); await tapSel(cdp3, page, '#bStart'); await sleep(500);
    const hn = await page.textContent('#hName');
    check(/今日風景 \d+\/\d+/.test(hn), 'daily picture starts a puzzle named with today\'s date (' + hn + ')');
  }
  check(errors.length === 0, 'no page errors in the fix checks' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await ctx.close();
}

async function sizes(browser) {
  for (const [w, h] of [[375, 500], [390, 610], [430, 740], [360, 640], [844, 390], [430, 932]]) for (const dark of (w === 844 || w === 360 || w === 430 && h === 932) ? [false] : [false, true]) {
    const { ctx, page, cdp, errors } = await newPage(browser, w, h, dark);
    const tag = `${w}x${h}-${dark ? 'dark' : 'light'}`;
    await page.screenshot({ path: path.join(OUT, `title-${tag}.png`) });
    await tapSel(cdp, page, '.chip[data-n="30"]'); await tapSel(cdp, page, '.gt[data-id="balloons"]');
    await tapSel(cdp, page, '#bStart'); await sleep(400);
    const st = await page.evaluate(() => window.__game.state());
    const ids = await page.evaluate(() => window.__game.trayIds());
    await dragFromTray(page, cdp, ids[0], ids[0], 3, -2);
    const ps = await page.evaluate(id => window.__game.pieceScreen(id), ids[0]);
    check(st && st.count >= 26 && ps && ps.locked, `${tag}: puzzle starts (${st.count} pieces) and a tray drag locks a piece`);
    const vis = await page.evaluate(() => ['bMenu', 'bGhost', 'bEdge', 'bZoomIn', 'bZoomOut', 'bScatter', 'trayScroll', 'hTime', 'hName'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 20 && r.height > 10 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; }) && document.documentElement.scrollWidth <= innerWidth);
    check(vis, `${tag}: all controls on screen, no horizontal overflow`);
    const bb = await page.evaluate(() => { const v = window.__game.view(), z = document.getElementById('bZoomOut').getBoundingClientRect(); return v.boardTop + v.boardH <= z.top + 1 || v.boardLeft + v.boardW <= z.left - 1; });
    check(bb, `${tag}: fitted board is not covered by the zoom buttons`);
    if (w > h) check(await page.evaluate(() => { const t = document.getElementById('tray').getBoundingClientRect(), c = document.getElementById('cv').getBoundingClientRect(); return t.left >= c.right - 1 && t.height > innerHeight * 0.6; }), `${tag}: short landscape puts the tray on the right so the board keeps its height`);
    await page.evaluate(ids => ids.slice(1, 8).forEach(id => window.__game.place(id)), ids); await sleep(100);
    await page.screenshot({ path: path.join(OUT, `play-${tag}.png`) });
    check(errors.length === 0, `${tag}: no page errors` + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }
}

async function cover(browser) {
  const { ctx, page, cdp, errors } = await newPage(browser, 390, 520, false);
  await page.evaluate(() => window.__game.start('balloons', 48, false)); await sleep(300);
  const st = await page.evaluate(() => window.__game.state());
  const cols = st.cols, rows = st.rows, place = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || (r <= 2 && c <= 3) || (r === 1 && c <= 5)) place.push(r * cols + c); }
  await page.evaluate(ids => ids.forEach(id => window.__game.place(id)), place);
  // one loose piece on the table, dragged mid-way
  const ids = await page.evaluate(() => window.__game.trayIds());
  await dragFromTray(page, cdp, ids[0], ids[0], 70, 24);
  await tapSel(cdp, page, '#bGhost');
  await page.evaluate(() => { document.getElementById('hTime').textContent = '03:42'; });
  await sleep(200);
  await page.screenshot({ path: path.join(OUT, 'cover-390x520.png') });
  check(fs.existsSync(path.join(OUT, 'cover-390x520.png')) && errors.length === 0, 'cover written, no errors');
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { await fullPlay(browser); await fixes(browser); await sizes(browser); await cover(browser); }
  catch (e) { fails++; console.log('FAIL exception', e); }
  await browser.close();
  console.log(fails ? `VERIFY FAILED (${fails})` : 'VERIFY OK');
  process.exit(fails ? 1 : 0);
})();
